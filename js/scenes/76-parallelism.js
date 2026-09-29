/* L2 — Distributed Parallelism. How one model spans many GPUs: DP (+ZeRO/FSDP), the collectives
 * (ring all-reduce, all-gather, reduce-scatter, all-to-all), Megatron TP, pipeline schedules, expert
 * parallel all-to-all, ring / Ulysses sequence parallel, and mapping it all onto the NVLink / RDMA topology. */
(function () {
  /* colour language: axes and ranks */
  var AX = { DP: 'cyan', TP: 'amber', PP: 'lime', EP: 'magenta', SP: 'violet' };
  var RK = ['cyan', 'orange', 'lime', 'violet'];

  function bx(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    if (title) ctx.text(x + 16, y + 22, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = bx(x, y, w, h);
    return g;
  }

  function keepWS(root) {
    Array.prototype.forEach.call(root.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
  }

  /* a small cell = group(rect + optional text) in local coords, placed at (x,y) */
  function cellG(ctx, parent, x, y, size, fill, txt, tcol) {
    var g = ctx.group({ parent: parent });
    g.r = ctx.rect(0, 0, size, size, { rx: 3, fill: fill, stroke: 'rgba(255,255,255,0.12)', sw: 0.8, parent: g });
    if (txt !== undefined && txt !== null) g.t = ctx.text(size / 2, size / 2 + 0.5, txt, { size: 11, font: 'mono', weight: 700, color: tcol || 'white', anchor: 'middle', parent: g });
    ctx.place(g, x, y);
    return g;
  }

  function stopLoops(S) { (S.loops || []).forEach(function (l) { l.stop(); }); S.loops = []; }

  /* page swap: old page drifts out, new page settles in */
  function swapPage(ctx, S, build) {
    stopLoops(S);
    var old = S.page;
    var p0 = old ? ctx.fadeOut(old, 450, true) : Promise.resolve();
    return p0.then(function () {
      S.page = ctx.group();
      build(S.page);
      return ctx.reveal(S.page, { from: 'scale', s0: 0.96, dur: 650, ease: 'out' });
    });
  }

  /* fly a group from a source top-left/size to its own final layout (lx,ly,lw) */
  function flyFrom(ctx, g, sx, sy, sw, lx, ly, lw, dur, delay) {
    var s = sw / lw;
    ctx.place(g, sx - s * lx, sy - s * ly, s);
    return ctx.transform(g, { x: 0, y: 0, s: 1 }, dur || 900, 'inOut', delay || 0);
  }

  /* pipeline schedule simulator: unit-time F and B, returns grid[stage][slot] = ['F'|'B', k] */
  function pipeSim(kind, p, m) {
    var ops = [], s, k;
    for (s = 0; s < p; s++) {
      var L = [];
      if (kind === 'gpipe') {
        for (k = 0; k < m; k++) L.push(['F', k]);
        for (k = m - 1; k >= 0; k--) L.push(['B', k]);
      } else {
        var w = Math.min(p - s - 1, m);
        for (k = 0; k < w; k++) L.push(['F', k]);
        for (var i = 0; i < m - w; i++) { L.push(['F', w + i]); L.push(['B', i]); }
        for (k = m - w; k < m; k++) L.push(['B', k]);
      }
      ops.push(L);
    }
    var dF = [], dB = [], ptr = [], grid = [];
    for (s = 0; s < p; s++) { dF.push({}); dB.push({}); ptr.push(0); grid.push([]); }
    var T = 0;
    for (var slot = 0; slot < 80; slot++) {
      var go = [];
      for (s = 0; s < p; s++) {
        if (ptr[s] >= ops[s].length) continue;
        var op = ops[s][ptr[s]], kk = op[1], ok;
        if (op[0] === 'F') ok = s === 0 || (dF[s - 1][kk] !== undefined && dF[s - 1][kk] < slot);
        else ok = s === p - 1 ? (dF[s][kk] !== undefined && dF[s][kk] < slot) : (dB[s + 1][kk] !== undefined && dB[s + 1][kk] < slot);
        if (ok) go.push(s);
      }
      go.forEach(function (st) {
        var o = ops[st][ptr[st]];
        grid[st][slot] = o;
        if (o[0] === 'F') dF[st][o[1]] = slot; else dB[st][o[1]] = slot;
        ptr[st]++;
        T = slot + 1;
      });
      var left = 0;
      for (s = 0; s < p; s++) left += ops[s].length - ptr[s];
      if (!left) break;
    }
    return { grid: grid, T: T };
  }

  /* ================================================================ 1 WHY */
  function buildWhy(ctx, S, g) {
    ctx.text(90, 176, 'ONE MODEL = L layers × hidden width h', { size: 14, font: 'mono', weight: 700, color: 'red', parent: g, spacing: 1 });
    ctx.text(311, 198, 'hidden width →', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    S.cells = [];
    for (var r = 0; r < 8; r++) {
      ctx.text(122, 230 + r * 46, 'layer ' + r, { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
      for (var c = 0; c < 8; c++) S.cells.push(ctx.rect(130 + c * 46, 210 + r * 46, 40, 40, { rx: 4, fill: ctx.alpha('red', r % 2 ? 0.28 : 0.2), stroke: ctx.alpha('red', 0.5), sw: 1, parent: g }));
    }
    S.tokens = [];
    for (var t = 0; t < 12; t++) S.tokens.push(ctx.rect(130 + t * 30.2, 596, 26, 26, { rx: 4, fill: ctx.alpha('white', 0.12), stroke: ctx.alpha('white', 0.3), sw: 1, parent: g }));
    ctx.text(311, 640, 'input sequence (tokens) · batch of sequences', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    /* overlays, one per axis */
    S.ov = {};
    var o;
    o = S.ov.DP = ctx.group({ parent: g, opacity: 0 });
    ctx.rect(144, 224, 362, 362, { rx: 6, stroke: AX.DP, sw: 1.5, dash: '6 5', parent: o });
    ctx.rect(158, 238, 362, 362, { rx: 6, stroke: AX.DP, sw: 1.2, dash: '6 5', parent: o, opacity: 0.6 });
    o = S.ov.TP = ctx.group({ parent: g, opacity: 0 });
    for (c = 0; c < 4; c++) ctx.rect(130 + c * 92 - 2, 206, 88, 368, { rx: 5, fill: ctx.alpha(RK[c], 0.16), stroke: ctx.alpha(RK[c], 0.9), sw: 1.4, parent: o });
    o = S.ov.PP = ctx.group({ parent: g, opacity: 0 });
    for (r = 0; r < 4; r++) ctx.rect(126, 206 + r * 92, 370, 88, { rx: 5, fill: ctx.alpha(RK[r], 0.16), stroke: ctx.alpha(RK[r], 0.9), sw: 1.4, parent: o });
    o = S.ov.EP = ctx.group({ parent: g, opacity: 0 });
    for (r = 1; r < 8; r += 2) for (c = 4; c < 8; c++) ctx.rect(130 + c * 46, 210 + r * 46, 40, 40, { rx: 4, fill: ctx.alpha(RK[c - 4], 0.55), stroke: RK[c - 4], sw: 1.2, parent: o });
    ctx.text(496, 604, 'odd layers = MoE: experts', { size: 11, font: 'mono', color: AX.EP, anchor: 'end', parent: o });
    o = S.ov.SP = ctx.group({ parent: g, opacity: 0 });
    for (t = 0; t < 12; t++) ctx.rect(130 + t * 30.2, 596, 26, 26, { rx: 4, fill: ctx.alpha(RK[Math.floor(t / 3)], 0.7), stroke: RK[Math.floor(t / 3)], sw: 1, parent: o });
    S.axName = ctx.text(560, 250, '', { size: 34, font: 'display', weight: 700, color: 'white', parent: g });
    S.axDesc = ctx.text(560, 284, '', { size: 13, font: 'mono', color: 'text', parent: g });
    S.axDesc2 = ctx.text(560, 306, '', { size: 13, font: 'mono', color: 'dim', parent: g });
    ctx.para(90, 700, [
      'In the fox-trailer system every axis shows up:',
      '· LLM agents: TP inside a node, DP over replicas',
      '· MoE planner models: EP across the NVLink domain',
      '· video DiT shots: SP = 8 (+ CFG-parallel 2)',
      '· training all of them: DP / FSDP + PP across nodes'
    ], { size: 13, font: 'mono', color: 'text', lh: 26, parent: g });

    /* memory card */
    var mc = card(ctx, g, 800, 160, 750, 310, 'red', 'WHY SPLIT? MEMORY PER MODEL vs 80 GB HBM');
    var X0 = 820, SC = 0.46;
    var rows = [['14B video DiT · inference (BF16)', [[28, 'red']], '28 GB'], ['70B LLM · serving, 32 seqs × 8k ctx', [[140, 'red'], [86, 'amber']], '226 GB'], ['70B LLM · training (mixed-precision Adam)', [[140, 'red'], [140, 'orange'], [840, 'violet']], '1,120 GB + activations']];
    S.memBars = [];
    rows.forEach(function (rw, i) {
      var y = 214 + i * 70;
      ctx.text(X0, y, rw[0], { size: 13, font: 'mono', color: 'text', parent: mc });
      var x = X0;
      rw[1].forEach(function (seg) {
        var w = seg[0] * SC;
        var b = ctx.rect(x, y + 12, w, 22, { rx: 2, fill: ctx.alpha(seg[1], 0.6), stroke: seg[1], sw: 1, parent: mc });
        b.full = w; b.x0 = x;
        S.memBars.push(b);
        x += w;
      });
      ctx.text(Math.max(x + 10, X0 + 80 * SC + 10), y + 23, rw[2], { size: 13, font: 'mono', weight: 700, color: 'white', parent: mc });
      ctx.line(X0 + 80 * SC, y + 6, X0 + 80 * SC, y + 40, { color: 'white', sw: 1.5, dash: '3 3', parent: mc });
    });
    ctx.text(X0 + 80 * SC, 431, '↑ 80 GB', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: mc });
    [['weights', 'red'], ['KV cache', 'amber'], ['grads', 'orange'], ['Adam m, v + FP32 master', 'violet']].forEach(function (L, i) {
      var lx = 1000 + i * 118 + (i === 3 ? 0 : 0);
      ctx.rect(lx, 424, 12, 12, { rx: 2, fill: ctx.alpha(L[1], 0.7), parent: mc });
      ctx.text(lx + 18, 431, L[0], { size: 11, font: 'mono', color: 'text', parent: mc });
    });
    ctx.text(X0, 456, 'compute: one fox shot = 0.68 EFLOP → 29 min on 1 H100, 3.6 min on 8', { size: 12, font: 'mono', color: 'amber', parent: mc });

    /* five cuts */
    var fc = card(ctx, g, 800, 490, 750, 370, 'red', 'FIVE WAYS TO CUT');
    ctx.text(900, 530, 'splits', { size: 11, font: 'mono', color: 'dim', parent: fc });
    ctx.text(1110, 530, 'communication', { size: 11, font: 'mono', color: 'dim', parent: fc });
    ctx.text(1400, 530, 'placement', { size: 11, font: 'mono', color: 'dim', parent: fc });
    var cuts = [['DP', 'the batch', 'all-reduce ∇ (train only)', 'anywhere'], ['TP', 'every weight matrix', 'all-reduce per block half', 'NVLink only'], ['PP', 'the layers', 'send/recv activations', 'across nodes'], ['EP', 'MoE experts', 'all-to-all of tokens', 'NVLink / RDMA'], ['SP', 'the sequence', 'ring K/V or all-to-all', 'NVLink']];
    S.cutRows = cuts.map(function (cu, i) {
      var y = 546 + i * 60;
      var rg = ctx.group({ parent: fc });
      rg.bg = ctx.rect(814, y, 722, 50, { rx: 8, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha(AX[cu[0]], 0.25), sw: 1, parent: rg });
      ctx.label(852, y + 25, cu[0], { color: AX[cu[0]], size: 14, w: 52, parent: rg });
      ctx.text(900, y + 25, cu[1], { size: 13, font: 'mono', color: 'white', parent: rg });
      ctx.text(1110, y + 25, cu[2], { size: 13, font: 'mono', color: 'text', parent: rg });
      ctx.text(1400, y + 25, cu[3], { size: 13, font: 'mono', color: AX[cu[0]], parent: rg });
      return rg;
    });
  }

  var AXINFO = [
    ['DP', 'replicate the model,', 'split the batch'],
    ['TP', 'split each matrix', 'across GPUs (columns / rows)'],
    ['PP', 'split the layer stack', 'into stages'],
    ['EP', 'place different experts', 'on different GPUs'],
    ['SP', 'split the token sequence', '(context parallel)']
  ];

  function showAxis(ctx, S, i) {
    var names = ['DP', 'TP', 'PP', 'EP', 'SP'];
    names.forEach(function (n, k) {
      S.ov[n].setAttribute('opacity', k === i ? 1 : 0);
      S.cutRows[k].bg.setAttribute('fill', k === i ? ctx.alpha(AX[n], 0.12) : 'rgba(255,255,255,0.02)');
      S.cutRows[k].bg.setAttribute('stroke', k === i ? ctx.alpha(AX[n], 0.9) : ctx.alpha(AX[n], 0.25));
    });
    S.axName.textContent = AXINFO[i][0];
    S.axName.setAttribute('fill', ctx.C[AX[names[i]]]);
    S.axDesc.textContent = AXINFO[i][1];
    S.axDesc2.textContent = AXINFO[i][2];
  }

  /* ================================================================ 2 DP + ZeRO */
  function buildDP(ctx, S, g) {
    ctx.text(90, 176, 'DATA PARALLEL · 4 replicas, 4 batch shards', { size: 14, font: 'mono', weight: 700, color: AX.DP, parent: g, spacing: 1 });
    S.dpG = []; S.shards = []; S.grads = []; S.dpIn = []; S.dpOut = [];
    var r = ctx.rng(21);
    S.gradVals = [];
    for (var i = 0; i < 4; i++) {
      var cx = 170 + i * 200;
      S.shards.push(ctx.label(cx, 208, 'batch shard ' + i, { color: RK[i], size: 12, parent: g }));
      var n = ctx.node({ x: cx, y: 340, w: 170, h: 180, color: 'red', kind: 'box', parent: g });
      ctx.text(cx, 266, 'GPU ' + i, { size: 13, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: g });
      ctx.matrix(cx - 42, 282, 4, 4, { cell: 18, gap: 4, values: function () { return ctx.alpha('red', 0.45); }, parent: g });
      ctx.text(cx, 382, 'full copy of W', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
      var vals = [];
      for (var k = 0; k < 8; k++) vals.push(r() * 2 - 1);
      S.gradVals.push(vals);
      S.grads.push(ctx.matrix(cx - 74, 400, 1, 8, { cell: 16, gap: 3, values: function () { return 'rgba(255,255,255,0.05)'; }, parent: g }));
      S.dpIn.push(ctx.link({ x: cx, y: 222 }, { x: cx, y: 250 }, { color: RK[i], parent: g, straight: true }));
      S.dpOut.push(ctx.link({ x: cx, y: 430 }, { x: cx, y: 470 }, { color: AX.DP, parent: g, straight: true }));
      S.dpG.push(n);
    }
    S.band = ctx.group({ parent: g });
    ctx.rect(85, 470, 770, 36, { rx: 8, fill: ctx.alpha(AX.DP, 0.12), stroke: AX.DP, sw: 1.4, parent: S.band });
    ctx.text(470, 488, 'ring all-reduce( ∇W ) / N  ·  NCCL  ·  overlapped with backward', { size: 13, font: 'mono', weight: 700, color: AX.DP, anchor: 'middle', parent: S.band });
    S.bandPath = ctx.path('M100,488 L840,488', { stroke: 'rgba(0,0,0,0)', parent: g });
    S.stepT = ctx.text(470, 534, 'then: identical optimizer step on every replica', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    keepWS(S.band);

    /* inference DP */
    var ic = card(ctx, g, 70, 570, 790, 290, 'cyan', 'SERVING: DP = REPLICAS BEHIND THE LOAD BALANCER');
    S.lb = ctx.node({ x: 190, y: 715, w: 180, h: 54, title: 'Load balancer', sub: 'prefix-aware', icon: 'net', titleSize: 14, subSize: 11, color: 'blue', parent: ic });
    S.reps = [];
    for (i = 0; i < 4; i++) {
      var rn = ctx.node({ x: 470, y: 628 + i * 58, w: 210, h: 42, title: 'replica ' + i + ' · 70B, TP 8', titleSize: 12, color: 'cyan', kind: 'pill', glow: false, parent: ic });
      S.reps.push(ctx.link(S.lb, rn, { color: ctx.alpha('cyan', 0.7), parent: ic, from: 'r', to: 'l' }));
    }
    ctx.para(600, 640, ['no gradient traffic:', 'throughput scales ~linearly,', 'latency does not improve;', 'KV/prefix-aware routing', 'picks the replica.'], { size: 12, font: 'mono', color: 'text', lh: 24, parent: ic });

    /* ZeRO */
    var zc = card(ctx, g, 900, 160, 650, 700, 'cyan', 'ZeRO / FSDP · memory per GPU (Ψ = 7.5B, N = 64)');
    ctx.text(920, 206, 'mixed-precision Adam = 2Ψ params + 2Ψ grads + 12Ψ optimizer', { size: 12, font: 'mono', color: 'text', parent: zc });
    ctx.text(920, 226, '(FP32 master weights, momentum, variance) = 16Ψ bytes', { size: 12, font: 'mono', color: 'dim', parent: zc });
    var Z = [['DDP · everything replicated', [15, 15, 90], '120 GB'], ['ZeRO-1 · shard optimizer states', [15, 15, 1.41], '31.4 GB'], ['ZeRO-2 · + shard gradients', [15, 0.234, 1.41], '16.6 GB'], ['ZeRO-3 / FSDP · + shard params', [0.234, 0.234, 1.41], '1.9 GB']];
    var ZC = ['blue', 'orange', 'violet'];
    S.zBars = [];
    Z.forEach(function (z, i) {
      var y = 270 + i * 76;
      ctx.text(920, y, z[0], { size: 13, font: 'mono', color: 'white', parent: zc });
      var x = 920;
      z[1].forEach(function (v, k) {
        var w = Math.max(1.5, v * 520 / 120);
        var b = ctx.rect(x, y + 14, w, 24, { rx: 2, fill: ctx.alpha(ZC[k], 0.65), stroke: ZC[k], sw: 0.8, parent: zc });
        b.full = w;
        S.zBars.push(b);
        x += w;
      });
      ctx.text(x + 10, y + 26, z[2], { size: 13, font: 'mono', weight: 700, color: i === 3 ? 'lime' : 'white', parent: zc });
    });
    [['params (BF16)', 'blue'], ['grads (BF16)', 'orange'], ['optimizer (FP32)', 'violet']].forEach(function (L, i) {
      ctx.rect(920 + i * 190, 576, 12, 12, { rx: 2, fill: ctx.alpha(L[1], 0.7), parent: zc });
      ctx.text(938 + i * 190, 583, L[0], { size: 12, font: 'mono', color: 'text', parent: zc });
    });
    ctx.para(920, 626, [
      'ZeRO-3 per layer: all-gather W before fwd and bwd,',
      'reduce-scatter ∇W after bwd → 3Ψ vs 2Ψ elements (DDP)',
      'prefetch layer ℓ+1’s all-gather under layer ℓ compute',
      'HSDP: shard within a node, replicate across nodes',
      'inference never needs this: no grads, no optimizer'
    ], { size: 12, font: 'mono', color: 'text', lh: 44, parent: zc });
  }

  /* ================================================================ 3 RING ALL-REDUCE */
  var RC = { x: 430, y: 520, r: 230 };
  var RPOS = [[430, 290], [660, 520], [430, 750], [200, 520]];
  function buildRing(ctx, S, g) {
    ctx.text(90, 176, 'RING ALL-REDUCE · n = 4 GPUs, message split into n chunks', { size: 14, font: 'mono', weight: 700, color: AX.DP, parent: g, spacing: 1 });
    S.rgpu = []; S.rcell = []; S.cnt = [];
    S.arcs = [];
    var mids = [[590, 350], [600, 690], [270, 690], [270, 350]];
    for (var i = 0; i < 4; i++) {
      var a = RPOS[i], b = RPOS[(i + 1) % 4];
      var p1 = [{ x: a[0] + 90, y: a[1] }, { x: a[0], y: a[1] + 38 }, { x: a[0] - 90, y: a[1] }, { x: a[0], y: a[1] - 38 }][i];
      var p2 = [{ x: b[0], y: b[1] - 38 }, { x: b[0] + 90, y: b[1] }, { x: b[0], y: b[1] + 38 }, { x: b[0] - 90, y: b[1] }][i];
      S.arcs.push(ctx.link(p1, p2, { color: ctx.alpha('white', 0.5), bend: { x: mids[i][0], y: mids[i][1] }, sw: 2, parent: g }));
    }
    for (i = 0; i < 4; i++) {
      var c = RPOS[i];
      S.rgpu.push(ctx.node({ x: c[0], y: c[1], w: 180, h: 76, color: 'red', parent: g }));
      ctx.text(c[0], c[1] - 24, 'GPU ' + i, { size: 13, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: g });
      S.rcell.push([]); S.cnt.push([1, 1, 1, 1]);
      for (var j = 0; j < 4; j++) S.rcell[i].push(cellG(ctx, g, c[0] - 77 + j * 40, c[1] - 8, 34, ctx.alpha(RK[j], 0.32), '1', 'white'));
    }
    S.phaseT = ctx.text(RC.x, RC.y - 14, 'start', { size: 20, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: g });
    S.phaseS = ctx.text(RC.x, RC.y + 14, 'own gradient only', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    ctx.text(RC.x, RC.y + 36, 'cell = chunk j', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    ctx.text(RC.x, RC.y + 54, 'digit = # summed', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });

    var mc = card(ctx, g, 900, 160, 650, 700, 'cyan', 'ALL-REDUCE = REDUCE-SCATTER + ALL-GATHER');
    ctx.para(920, 212, [
      'n GPUs, message S bytes, per-link bandwidth B',
      'reduce-scatter: n−1 steps of S/n → GPU i owns',
      '                chunk i+1, fully summed',
      'all-gather:     n−1 steps of S/n → all have all',
      'sent per GPU = 2(n−1)/n · S   ← bandwidth-optimal',
      'T ≈ 2(n−1)·α + 2(n−1)/n · S / B'
    ], { size: 13, font: 'mono', color: 'text', lh: 28, parent: mc });
    ctx.text(920, 400, 'EXAMPLE · 7B model, BF16 gradients, S = 14 GB', { size: 12, font: 'mono', weight: 700, color: 'amber', parent: mc, spacing: 1 });
    ctx.para(920, 432, [
      'n = 8 on NVLink4 450 GB/s   → ≈ 54 ms',
      'n = 512 over IB NDR 50 GB/s → ≈ 0.56 s',
      'α-term 2(n−1)·α grows with n → NCCL switches',
      'to (double binary) trees for small messages;',
      'NVLS reduces inside NVSwitch, SHARP in the IB',
      'switches; hierarchical: RS in node → AR across',
      'rails → AG in node'
    ], { size: 13, font: 'mono', color: 'text', lh: 28, parent: mc });
    ctx.text(920, 660, 'PHASE', { size: 11, font: 'mono', color: 'dim', parent: mc });
    S.phChips = ['RS 1', 'RS 2', 'RS 3', 'AG 1', 'AG 2', 'AG 3'].map(function (s, k) {
      return ctx.label(950 + k * 94, 692, s, { color: k < 3 ? 'amber' : 'lime', size: 13, w: 80, parent: mc, opacity: 0.35 });
    });
    ctx.para(920, 742, ['amber = reduce (add incoming chunk)', 'lime  = gather (overwrite with final chunk)', 'every link busy every step: no idle wires'], { size: 12, font: 'mono', color: 'dim', lh: 24, parent: mc });
    keepWS(mc);
  }

  function paintRing(ctx, S) {
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
      var n = S.cnt[i][j], cg = S.rcell[i][j];
      cg.r.setAttribute('fill', ctx.alpha(RK[j], 0.12 + 0.2 * n));
      cg.r.setAttribute('stroke', n === 4 ? '#ffffff' : 'rgba(255,255,255,0.12)');
      cg.t.textContent = n === 4 ? 'Σ' : String(n);
    }
  }

  function ringPhase(ctx, S, ph) {
    var rs = ph < 3, s = rs ? ph : ph - 3;
    S.phaseT.textContent = (rs ? 'reduce-scatter ' : 'all-gather ') + (s + 1) + ' / 3';
    S.phaseS.textContent = rs ? 'i → i+1 : chunk (i−' + s + ') mod 4, add' : 'i → i+1 : Σ chunk (i+1−' + s + ') mod 4';
    S.phChips.forEach(function (c, k) { c.setAttribute('opacity', k === ph ? 1 : (k < ph ? 0.6 : 0.35)); });
    var sends = [];
    for (var i = 0; i < 4; i++) sends.push({ from: i, to: (i + 1) % 4, j: rs ? (i - s + 4) % 4 : (i + 1 - s + 4) % 4 });
    return Promise.all(sends.map(function (sd) {
      return ctx.packet(S.arcs[sd.from], { color: RK[sd.j], dur: 900, r: 6, label: 'c' + sd.j });
    })).then(function () {
      var nc = S.cnt.map(function (row) { return row.slice(); });
      sends.forEach(function (sd) {
        nc[sd.to][sd.j] = rs ? S.cnt[sd.to][sd.j] + S.cnt[sd.from][sd.j] : S.cnt[sd.from][sd.j];
      });
      S.cnt = nc;
      paintRing(ctx, S);
      return ctx.wait(250);
    });
  }

  /* ================================================================ 4 COLLECTIVES */
  function buildColl(ctx, S, g) {
    var P = [
      [70, 170, 'ALL-GATHER', 'start: GPU i has chunk i · end: all have all', '(n−1)/n·S per GPU · FSDP params, Megatron-SP'],
      [470, 170, 'REDUCE-SCATTER', 'all hold partials → GPU i ends with Σ chunk i', '(n−1)/n·S per GPU · FSDP / ZeRO grads'],
      [70, 520, 'ALL-TO-ALL', 'chunk (i,j) moves GPU i → GPU j: a transpose', '(n−1)/n·S per GPU · MoE dispatch, Ulysses'],
      [470, 520, 'ALL-REDUCE', '= reduce-scatter then all-gather', '2(n−1)/n·S per GPU · DP grads, TP activations']
    ];
    S.after = [];
    S.a2a = [];
    P.forEach(function (pn, q) {
      var x0 = pn[0], y0 = pn[1];
      var pc = card(ctx, g, x0, y0, 380, 330, q === 2 ? 'magenta' : 'cyan', pn[2]);
      ctx.text(x0 + 114, y0 + 52, 'before', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pc });
      ctx.text(x0 + 308, y0 + 52, 'after', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pc });
      ctx.line(x0 + 192, y0 + 136, x0 + 232, y0 + 136, { color: 'white', sw: 1.6, arrow: true, parent: pc });
      var aft = ctx.group({ parent: pc });
      for (var i = 0; i < 4; i++) {
        ctx.text(x0 + 40, y0 + 83 + i * 34, 'G' + i, { size: 11, font: 'mono', color: RK[i], anchor: 'end', parent: pc });
        for (var j = 0; j < 4; j++) {
          var bxp = x0 + 46 + j * 34, axp = x0 + 240 + j * 34, yy = y0 + 68 + i * 34;
          var off = 'rgba(255,255,255,0.04)';
          if (q === 0) {
            cellG(ctx, pc, bxp, yy, 30, i === j ? ctx.alpha(RK[i], 0.75) : off, i === j ? String(j) : '');
            cellG(ctx, aft, axp, yy, 30, ctx.alpha(RK[j], 0.75), String(j));
          } else if (q === 1) {
            cellG(ctx, pc, bxp, yy, 30, ctx.alpha(RK[j], 0.3), String(j));
            cellG(ctx, aft, axp, yy, 30, i === j ? ctx.alpha(RK[j], 0.95) : off, i === j ? 'Σ' : '');
          } else if (q === 2) {
            cellG(ctx, pc, bxp, yy, 30, ctx.alpha(RK[i], 0.7), i + '' + j);
            ctx.rect(axp, yy, 30, 30, { rx: 3, fill: off, parent: pc });
          } else {
            cellG(ctx, pc, bxp, yy, 30, ctx.alpha(RK[j], 0.3), String(j));
            cellG(ctx, aft, axp, yy, 30, ctx.alpha(RK[j], 0.95), 'Σ');
          }
        }
      }
      if (q === 2) {
        /* flying cells: (i,j) from GPU i row to GPU j row */
        for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) {
          var cg = cellG(ctx, pc, x0 + 240 + i * 34, y0 + 68 + j * 34, 30, ctx.alpha(RK[i], 0.7), i + '' + j);
          cg.src = { x: x0 + 46 + j * 34, y: y0 + 68 + i * 34 };
          cg.dst = { x: x0 + 240 + i * 34, y: y0 + 68 + j * 34 };
          S.a2a.push(cg);
        }
      } else S.after.push(aft);
      ctx.text(x0 + 16, y0 + 228 + 30, pn[3], { size: 12, font: 'mono', color: 'text', parent: pc });
      ctx.text(x0 + 16, y0 + 228 + 56, pn[4], { size: 12, font: 'mono', color: q === 2 ? 'magenta' : 'cyan', parent: pc });
    });

    var tc = card(ctx, g, 900, 160, 650, 700, 'cyan', 'WHO USES WHAT');
    ctx.text(920, 204, 'collective', { size: 11, font: 'mono', color: 'dim', parent: tc });
    ctx.text(1090, 204, 'bytes / GPU', { size: 11, font: 'mono', color: 'dim', parent: tc });
    ctx.text(1230, 204, 'used by', { size: 11, font: 'mono', color: 'dim', parent: tc });
    [['all-reduce', '2(n−1)/n·S', 'DP grads · TP activations'], ['reduce-scatter', '(n−1)/n·S', 'FSDP grads · Megatron-SP'], ['all-gather', '(n−1)/n·S', 'FSDP params · Megatron-SP'], ['all-to-all', '(n−1)/n·S', 'MoE dispatch/combine · Ulysses'], ['send / recv', 'S', 'PP activations · KV transfer'], ['broadcast', 'S', 'weights at model load']].forEach(function (rw, i) {
      var y = 236 + i * 38;
      ctx.rect(914, y - 15, 622, 30, { rx: 6, fill: i % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.045)', parent: tc });
      ctx.text(920, y, rw[0], { size: 13, font: 'mono', weight: 700, color: 'white', parent: tc });
      ctx.text(1090, y, rw[1], { size: 13, font: 'mono', color: 'amber', parent: tc });
      ctx.text(1230, y, rw[2], { size: 13, font: 'mono', color: 'text', parent: tc });
    });
    ctx.text(920, 494, 'NCCL · what actually runs', { size: 12, font: 'mono', weight: 700, color: 'cyan', parent: tc, spacing: 1 });
    ctx.para(920, 526, [
      'picks algorithm × protocol per call, per size:',
      '· ring (bandwidth), tree (latency), NVLS (reduce',
      '  inside NVSwitch), CollNet / SHARP (in-network)',
      '· protocols Simple / LL / LL128: latency vs bandwidth',
      '· kernels occupy SMs → compute and comm contend;',
      '  overlap on separate streams, offload to NVLS',
      '· one-shot / symmetric-memory all-reduce for tiny',
      '  decode messages (latency-bound, ~µs)'
    ], { size: 13, font: 'mono', color: 'text', lh: 38, parent: tc });
    keepWS(tc);
  }

  /* ================================================================ 5 TENSOR PARALLEL */
  function buildTP(ctx, S, g) {
    ctx.text(90, 176, 'MEGATRON TP · MLP:  Z = GeLU(X · A) · B  on 4 GPUs', { size: 14, font: 'mono', weight: 700, color: AX.TP, parent: g, spacing: 1 });
    ctx.text(150, 202, 'A · h × 4h → split by COLUMNS', { size: 12, font: 'mono', color: 'text', parent: g });
    ctx.matrix(150, 214, 4, 16, { cell: 20, gap: 3, values: function (r, c) { return ctx.alpha(RK[Math.floor(c / 4)], 0.3 + 0.4 * ((r * 7 + c * 3) % 5) / 4); }, parent: g });
    ctx.text(670, 224, 'B · 4h × h', { size: 12, font: 'mono', color: 'text', parent: g });
    ctx.text(670, 244, '→ split by ROWS', { size: 12, font: 'mono', color: 'text', parent: g });
    ctx.matrix(620, 176, 16, 4, { cell: 8, gap: 2, values: function (r, c) { return ctx.alpha(RK[Math.floor(r / 4)], 0.3 + 0.4 * ((r * 3 + c * 5) % 5) / 4); }, parent: g });
    S.lanes = [];
    for (var i = 0; i < 4; i++) {
      var cy = 410 + i * 90, y0 = cy - 27;
      var L = {};
      ctx.text(80, cy, 'GPU ' + i, { size: 13, font: 'display', weight: 700, color: RK[i], parent: g });
      L.X = ctx.matrix(130, y0, 4, 4, { cell: 12, gap: 2, values: function () { return ctx.alpha('white', 0.35); }, parent: g });
      ctx.text(200, cy, '·', { size: 18, color: 'white', anchor: 'middle', parent: g });
      L.A = ctx.group({ parent: g });
      ctx.matrix(210, y0, 4, 4, { cell: 12, gap: 2, values: function (r, c) { return ctx.alpha(RK[i], 0.3 + 0.4 * ((r * 7 + (c + 4 * i) * 3) % 5) / 4); }, parent: L.A });
      L.gelu = ctx.text(315, cy, '→ GeLU →', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
      L.Y = ctx.matrix(365, y0, 4, 4, { cell: 12, gap: 2, values: function (r, c) { return ctx.alpha(RK[i], 0.25 + 0.5 * (((r + 1) * (c + 2) + i) % 4) / 3); }, parent: g });
      ctx.text(432, cy, '·', { size: 18, color: 'white', anchor: 'middle', parent: g });
      L.B = ctx.group({ parent: g });
      ctx.matrix(444, y0, 4, 4, { cell: 12, gap: 2, values: function (r, c) { return ctx.alpha(RK[i], 0.3 + 0.4 * (((r + 4 * i) * 3 + c * 5) % 5) / 4); }, parent: L.B });
      ctx.text(512, cy, '=', { size: 16, color: 'white', anchor: 'middle', parent: g });
      L.Z = ctx.matrix(525, y0, 4, 4, { cell: 12, gap: 2, values: function (r, c) { return ctx.mix(RK[i], '#1a2233', 0.45 + 0.1 * ((r + c) % 3)); }, parent: g });
      L.zl = ctx.text(552, cy + 38, 'Z' + i + ' partial', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
      L.link = ctx.link({ x: 584, y: cy }, { x: 622, y: cy }, { color: AX.TP, parent: g, straight: true });
      L.cy = cy;
      S.lanes.push(L);
    }
    ctx.text(165, 360, 'X (replicated)', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    ctx.text(237, 360, 'Aᵢ', { size: 12, font: 'mono', weight: 700, color: 'text', anchor: 'middle', parent: g });
    ctx.text(392, 360, 'Yᵢ', { size: 12, font: 'mono', weight: 700, color: 'text', anchor: 'middle', parent: g });
    ctx.text(471, 360, 'Bᵢ', { size: 12, font: 'mono', weight: 700, color: 'text', anchor: 'middle', parent: g });
    S.arBar = ctx.group({ parent: g });
    ctx.rect(624, 372, 40, 346, { rx: 8, fill: ctx.alpha(AX.TP, 0.14), stroke: AX.TP, sw: 1.4, parent: S.arBar });
    var at = ctx.text(644, 545, 'ALL-REDUCE  Σ Zᵢ  (NVLink)', { size: 13, font: 'mono', weight: 700, color: AX.TP, anchor: 'middle', parent: S.arBar });
    at.setAttribute('transform', 'rotate(-90 644 545)');
    S.zOut = ctx.group({ parent: g });
    ctx.matrix(700, 515, 4, 4, { cell: 14, gap: 2, values: function (r, c) { return ctx.alpha('white', 0.35 + 0.15 * ((r + c) % 3)); }, parent: S.zOut });
    ctx.text(731, 594, 'Z on every GPU', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: S.zOut });
    S.zLink = ctx.link({ x: 666, y: 545 }, { x: 696, y: 545 }, { color: AX.TP, parent: g, straight: true });
    keepWS(S.arBar);
    ctx.para(80, 770, [
      'attention: Q,K,V column-parallel by head (64 heads → 16 per GPU),',
      'output projection row-parallel → 1 all-reduce; MLP → 1 all-reduce',
      'fwd 2 all-reduces / layer, bwd 2 more. Megatron-SP turns each into',
      'reduce-scatter + all-gather and shards LayerNorm / dropout acts.'
    ], { size: 13, font: 'mono', color: 'text', lh: 24, parent: g });

    var mc = card(ctx, g, 900, 160, 650, 700, 'amber', 'WHY ONE ALL-REDUCE IS ENOUGH');
    ctx.para(920, 212, [
      'A = [A₁ A₂ A₃ A₄]            column split',
      'Yᵢ = GeLU(X·Aᵢ)              no comm: GeLU is',
      '                             elementwise per column',
      'B = [B₁; B₂; B₃; B₄]          row split',
      'Z = Σᵢ Yᵢ·Bᵢ                 one all-reduce',
      '',
      '(split A by rows instead and GeLU(ΣXᵢAᵢ) ≠ ΣGeLU(XᵢAᵢ)',
      ' would force a sync before the nonlinearity)'
    ], { size: 13, font: 'mono', color: 'text', lh: 27, parent: mc });
    ctx.text(920, 452, 'COST · 70B (h = 8,192, 80 layers), TP = 8', { size: 12, font: 'mono', weight: 700, color: 'amber', parent: mc, spacing: 1 });
    ctx.para(920, 484, [
      'prefill 8k tokens: S = 8,192·8,192·2 B = 134 MB',
      '  ring AR on NVLink4: 2·7/8·134 MB ÷ 450 GB/s',
      '  = 0.52 ms × 2 per layer × 80 = 83 ms',
      '  vs ≈ 240 ms of math → overlap or it hurts',
      '  over IB (50 GB/s): 750 ms → TP never leaves',
      '  the NVLink domain',
      'decode 64 tokens: S = 1 MB → pure latency (α)',
      '  → NVLS / one-shot all-reduce kernels'
    ], { size: 13, font: 'mono', color: 'text', lh: 27, parent: mc });
    keepWS(mc);
    ctx.text(920, 712, 'PER LAYER · ms per GPU (prefill 8k, TP 8)', { size: 12, font: 'mono', weight: 700, color: 'amber', parent: mc, spacing: 1 });
    S.tpBars = [];
    [['math (GEMM + attn)', 3.0, 'amber'], ['2 × AR, NVLink4', 1.04, 'cyan'], ['2 × AR, IB NDR', 9.4, 'red']].forEach(function (b, i) {
      var y = 744 + i * 36;
      ctx.text(920, y, b[0], { size: 12, font: 'mono', color: 'text', parent: mc });
      var w = b[1] / 9.4 * 300;
      var r = ctx.rect(1110, y - 10, w, 20, { rx: 3, fill: ctx.alpha(b[2], 0.55), stroke: b[2], sw: 1, parent: mc });
      r.full = w;
      S.tpBars.push(r);
      ctx.text(1110 + w + 10, y, b[1] + ' ms', { size: 12, font: 'mono', weight: 700, color: b[2], parent: mc });
    });
  }

  /* ================================================================ 6 PIPELINE */
  function drawSched(ctx, g, x, y, sim, label, color) {
    ctx.text(80, y - 16, label, { size: 13, font: 'mono', weight: 700, color: color, parent: g });
    var cells = [];
    for (var s = 0; s < 4; s++) {
      ctx.text(142, y + s * 29 + 13, 'stage ' + s, { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
      for (var t = 0; t < 22; t++) {
        var op = sim.grid[s][t];
        var cg;
        if (op) cg = cellG(ctx, g, x + t * 29, y + s * 29, 26, ctx.alpha(op[0] === 'F' ? 'cyan' : 'orange', 0.7), String(op[1]), 'white');
        else cg = cellG(ctx, g, x + t * 29, y + s * 29, 26, 'rgba(255,255,255,0.03)', null);
        cg.slot = t;
        cells.push(cg);
      }
    }
    ctx.text(x + 22 * 29 - 3, y + 4 * 29 + 12, 'time →', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
    return cells;
  }

  function buildPP(ctx, S, g) {
    ctx.text(90, 176, 'PIPELINE PARALLEL · p = 4 stages, m = 8 micro-batches', { size: 14, font: 'mono', weight: 700, color: AX.PP, parent: g, spacing: 1 });
    S.stages = [];
    for (var s = 0; s < 4; s++) {
      S.stages.push(ctx.node({ x: 180 + s * 190, y: 232, w: 160, h: 54, title: 'stage ' + s + ' · GPU ' + s, sub: 'layers ' + (s * 20) + '–' + (s * 20 + 19), titleSize: 13, subSize: 11, color: RK[s], parent: g }));
    }
    S.ppLinks = [];
    for (s = 0; s < 3; s++) S.ppLinks.push(ctx.link(S.stages[s], S.stages[s + 1], { color: AX.PP, parent: g }));
    S.gp = pipeSim('gpipe', 4, 8);
    S.ob = pipeSim('1f1b', 4, 8);
    S.gpCells = drawSched(ctx, g, 150, 336, S.gp, 'GPipe · all F, then all B', 'cyan');
    S.obCells = drawSched(ctx, g, 150, 506, S.ob, '1F1B · one forward, one backward', 'lime');
    ctx.text(150 + 22 * 29 + 10, 336 + 58, 'bubble', { size: 12, font: 'mono', color: 'red', parent: g });
    ctx.text(150 + 22 * 29 + 10, 336 + 76, '27%', { size: 16, font: 'display', weight: 700, color: 'red', parent: g });
    ctx.text(150 + 22 * 29 + 10, 506 + 58, 'bubble', { size: 12, font: 'mono', color: 'red', parent: g });
    ctx.text(150 + 22 * 29 + 10, 506 + 76, '27%', { size: 16, font: 'display', weight: 700, color: 'red', parent: g });
    [['forward of micro-batch k', 'cyan'], ['backward of micro-batch k', 'orange'], ['idle = bubble', 'faint']].forEach(function (L, i) {
      ctx.rect(150 + i * 230, 660, 14, 14, { rx: 2, fill: L[1] === 'faint' ? 'rgba(255,255,255,0.08)' : ctx.alpha(L[1], 0.7), parent: g });
      ctx.text(172 + i * 230, 668, L[0], { size: 12, font: 'mono', color: 'text', parent: g });
    });
    ctx.text(80, 716, 'ACTIVATION MEMORY · micro-batches held by stage 0', { size: 12, font: 'mono', weight: 700, color: 'text', parent: g, spacing: 1 });
    ctx.text(90, 752, 'GPipe', { size: 12, font: 'mono', color: 'cyan', parent: g });
    S.memA = ctx.rect(170, 742, 8 * 50, 20, { rx: 3, fill: ctx.alpha('cyan', 0.55), stroke: 'cyan', sw: 1, parent: g });
    ctx.text(580, 752, 'm = 8', { size: 13, font: 'mono', weight: 700, color: 'cyan', parent: g });
    ctx.text(90, 790, '1F1B', { size: 12, font: 'mono', color: 'lime', parent: g });
    S.memB = ctx.rect(170, 780, 4 * 50, 20, { rx: 3, fill: ctx.alpha('lime', 0.55), stroke: 'lime', sw: 1, parent: g });
    ctx.text(380, 790, '≤ p = 4', { size: 13, font: 'mono', weight: 700, color: 'lime', parent: g });
    ctx.text(90, 834, 'same bubble, half the stashed activations → 1F1B is the default', { size: 12, font: 'mono', color: 'dim', parent: g });

    var mc = card(ctx, g, 900, 160, 650, 700, 'lime', 'BUBBLES, SCHEDULES, PLACEMENT');
    ctx.para(920, 212, [
      'bubble fraction = (p − 1) / (m + p − 1)',
      '  p = 4, m = 8   → 3/11 = 27%',
      '  p = 4, m = 32  → 3/35 ≈ 8.6%',
      'more micro-batches shrink the bubble but',
      'grow the global batch (or shrink per-µbatch)',
      '',
      'interleaved 1F1B (v chunks per GPU):',
      '  bubble ÷ v, at v× more p2p messages',
      'zero-bubble (ZB-H1/H2): split B into input-grad',
      '  and weight-grad; W fills the idle slots',
      'DualPipe (DeepSeek-V3): two directions, overlaps',
      '  all-to-all comm with compute of the other',
      '',
      'traffic = one activation tensor per micro-batch',
      '  per boundary (b·s·h·2 B): cheap → cross nodes',
      'serving: PP adds a hop per token but lets a',
      '  405B model span 2 nodes (TP 8 × PP 2)'
    ], { size: 13, font: 'mono', color: 'text', lh: 36, parent: mc });
    keepWS(mc);
  }

  function paintSched(ctx, S, upto) {
    S.gpCells.concat(S.obCells).forEach(function (c) { c.setAttribute('opacity', c.slot < upto ? 1 : 0.08); });
  }

  /* ================================================================ 7 EXPERT PARALLEL */
  function buildEP(ctx, S, g) {
    ctx.text(90, 176, 'EXPERT PARALLEL · 8 experts on 4 GPUs, top-2 routing', { size: 14, font: 'mono', weight: 700, color: AX.EP, parent: g, spacing: 1 });
    var ys = [262, 402, 542, 682];
    S.tok = []; S.exp = []; S.routes = [];
    var r = ctx.rng(77);
    var load = [0, 0, 0, 0, 0, 0, 0, 0];
    S.meshG = ctx.group({ parent: g });
    for (var i = 0; i < 4; i++) {
      ctx.rect(60, ys[i] - 55, 190, 110, { rx: 10, fill: 'rgba(14,10,22,0.92)', stroke: ctx.alpha('red', 0.6), parent: g });
      ctx.text(72, ys[i] - 36, 'GPU ' + i + ' · tokens', { size: 12, font: 'mono', weight: 700, color: 'red', parent: g });
      ctx.text(72, ys[i] + 38, 'router → top-2 experts', { size: 11, font: 'mono', color: 'dim', parent: g });
      var box = ctx.rect(560, ys[i] - 55, 250, 110, { rx: 10, fill: 'rgba(14,10,22,0.92)', stroke: ctx.alpha('red', 0.6), parent: g });
      ctx.text(572, ys[i] - 36, 'GPU ' + i + ' · experts', { size: 12, font: 'mono', weight: 700, color: 'red', parent: g });
      for (var e = 0; e < 2; e++) {
        var id = i * 2 + e;
        S.exp.push(ctx.node({ x: 628 + e * 118, y: ys[i] + 10, w: 104, h: 48, title: 'E' + id, sub: 'SwiGLU FFN', titleSize: 14, subSize: 10, color: 'magenta', parent: g }));
      }
    }
    for (i = 0; i < 4; i++) {
      for (var j = 0; j < 6; j++) {
        var tx = 84 + j * 28, ty = ys[i];
        var e1 = Math.floor(r() * 8), e2 = (e1 + 1 + Math.floor(r() * 7)) % 8;
        if (r() < 0.35) e1 = 2; /* a popular expert → imbalance */
        if (e2 === e1) e2 = (e1 + 3) % 8;
        load[e1]++; load[e2]++;
        var dot = ctx.circle(tx, ty, 9, { fill: ctx.alpha(RK[Math.floor(e1 / 2)], 0.85), stroke: 'white', sw: 1, parent: g });
        S.tok.push(dot);
        [e1, e2].forEach(function (eid, k) {
          var en = S.exp[eid];
          var ex = en.box.l, ey = en.box.cy + (k ? 8 : -8);
          var p = ctx.path('M' + tx + ',' + ty + ' C' + (tx + 220) + ',' + ty + ' ' + (ex - 200) + ',' + ey + ' ' + ex + ',' + ey, { stroke: ctx.alpha(RK[Math.floor(eid / 2)], 0.13), sw: 1, parent: S.meshG });
          S.routes.push({ p: p, col: RK[Math.floor(eid / 2)] });
        });
      }
    }
    S.load = load;
    ctx.text(405, 206, 'dispatch all-to-all →', { size: 12, font: 'mono', color: AX.EP, anchor: 'middle', parent: g });
    ctx.text(405, 752, '← combine all-to-all', { size: 12, font: 'mono', color: AX.EP, anchor: 'middle', parent: g });
    /* load bars */
    ctx.text(80, 790, 'tokens per expert', { size: 12, font: 'mono', color: 'text', parent: g });
    S.loadBars = [];
    var cap = 1.25 * 2 * 24 / 8;
    for (var k = 0; k < 8; k++) {
      var h = load[k] * 7;
      var over = load[k] > cap;
      var b = ctx.rect(300 + k * 62, 858 - h, 40, h, { rx: 3, fill: ctx.alpha(over ? 'red' : 'magenta', 0.6), stroke: over ? 'red' : 'magenta', sw: 1, parent: g });
      b.full = h;
      S.loadBars.push(b);
      ctx.text(320 + k * 62, 858 - h - 10, String(load[k]), { size: 11, font: 'mono', weight: 700, color: over ? 'red' : 'white', anchor: 'middle', parent: g });
      ctx.text(320 + k * 62, 872, 'E' + k, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    }
    ctx.line(290, 858 - cap * 7, 800, 858 - cap * 7, { color: 'amber', sw: 1.4, dash: '5 4', parent: g });
    ctx.text(80, 814, 'capacity C·k·T/E', { size: 11, font: 'mono', color: 'amber', parent: g });
    ctx.text(80, 834, '= 1.25·2·24/8 = 7.5', { size: 11, font: 'mono', color: 'amber', parent: g });

    var mc = card(ctx, g, 900, 160, 650, 700, 'magenta', 'MIXTURE-OF-EXPERTS AT SCALE');
    ctx.para(920, 212, [
      'y = Σₑ gₑ(x) · FFNₑ(x),  e ∈ TopK(router(x))',
      'dispatch all-to-all → expert GEMMs → combine all-to-all',
      '',
      'DeepSeek-V3: 256 routed + 1 shared expert / layer,',
      '  top-8; 671B params, 37B active per token',
      '  training: EP 64 over 8 nodes, node-limited routing',
      '  (each token reaches ≤ 4 nodes) caps IB traffic',
      'per token per layer (h = 7,168, k = 8):',
      '  dispatch FP8  8 · 7,168 · 1 B ≈ 57 KB',
      '  combine BF16  8 · 7,168 · 2 B ≈ 115 KB',
      'DeepEP: NVLink intra-node + RDMA inter-node kernels;',
      '  low-latency decode mode via IBGDA, few SMs',
      '',
      'balance: aux loss (Switch / GShard) or aux-loss-free',
      '  per-expert bias bₑ nudged by observed load;',
      '  overflow past capacity → dropped / re-routed',
      'serving on NVL72: wide EP over one NVLink domain,',
      '  attention in DP, experts spread across 72 GPUs'
    ], { size: 13, font: 'mono', color: 'text', lh: 35, parent: mc });
    keepWS(mc);
  }

  /* ================================================================ 8 SEQUENCE / CONTEXT PARALLEL */
  var SPOS = [[690, 272], [808, 390], [690, 508], [572, 390]];
  function buildSP(ctx, S, g) {
    ctx.text(90, 176, 'RING ATTENTION · sequence split into 4 Q / KV blocks', { size: 14, font: 'mono', weight: 700, color: AX.SP, parent: g, spacing: 1 });
    S.blk = [];
    for (var j = 0; j < 4; j++) ctx.text(210 + j * 86, 208, 'KV' + j, { size: 12, font: 'mono', weight: 700, color: RK[j], anchor: 'middle', parent: g });
    for (var i = 0; i < 4; i++) {
      ctx.text(160, 260 + i * 86, 'GPU ' + i + ' · Q' + i, { size: 12, font: 'mono', weight: 700, color: RK[i], anchor: 'end', parent: g });
      S.blk.push([]);
      for (j = 0; j < 4; j++) {
        var cg = cellG(ctx, g, 170 + j * 86, 220 + i * 86, 80, 'rgba(255,255,255,0.03)', '', 'white');
        cg.t.setAttribute('font-size', 13);
        S.blk[i].push(cg);
      }
    }
    ctx.text(340, 580, 'block (i, j) = softmax-partial of Qᵢ·K_jᵀ, merged online', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    /* ring of GPUs holding KV */
    S.sArcs = [];
    var mids = [[790, 290], [790, 490], [590, 490], [590, 290]];
    for (i = 0; i < 4; i++) {
      var a = SPOS[i], b = SPOS[(i + 1) % 4];
      S.sArcs.push(ctx.link({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, { color: ctx.alpha('white', 0.35), bend: { x: mids[i][0], y: mids[i][1] }, sw: 1.6, parent: g }));
    }
    S.sG = []; S.kvT = [];
    for (i = 0; i < 4; i++) {
      S.sG.push(ctx.circle(SPOS[i][0], SPOS[i][1], 34, { fill: 'rgba(14,10,22,0.95)', stroke: RK[i], sw: 2, parent: g }));
      ctx.text(SPOS[i][0], SPOS[i][1] - 10, 'GPU ' + i, { size: 12, font: 'mono', weight: 700, color: RK[i], anchor: 'middle', parent: g });
      S.kvT.push(ctx.text(SPOS[i][0], SPOS[i][1] + 10, 'KV' + i, { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: g }));
    }
    S.spStep = ctx.text(690, 390, 'step 0', { size: 14, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: g });

    /* Ulysses */
    ctx.text(90, 616, 'DEEPSPEED-ULYSSES · all-to-all swaps the sharded axis', { size: 14, font: 'mono', weight: 700, color: AX.SP, parent: g, spacing: 1 });
    ctx.text(178, 644, 'heads →', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    S.u1 = []; S.u2 = [];
    for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) {
      S.u1.push(cellG(ctx, g, 100 + j * 40, 656 + i * 40, 36, ctx.alpha(RK[i], 0.7), null));
      var c2 = cellG(ctx, g, 400 + j * 40, 656 + i * 40, 36, ctx.alpha(RK[j], 0.7), null);
      c2.src = { x: 100 + j * 40, y: 656 + i * 40 };
      c2.dst = { x: 400 + j * 40, y: 656 + i * 40 };
      S.u2.push(c2);
    }
    ctx.text(90, 830, 'tokens ↓', { size: 11, font: 'mono', color: 'dim', parent: g });
    ctx.text(178, 830 + 18, '[N/P tokens, all H heads]', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: g });
    ctx.line(280, 734, 380, 734, { color: 'white', sw: 1.6, arrow: true, parent: g });
    ctx.text(330, 718, 'all-to-all', { size: 12, font: 'mono', color: AX.SP, anchor: 'middle', parent: g });
    ctx.text(478, 848, '[all N tokens, H/P heads]', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: g });
    ctx.para(590, 676, ['full attention over', 'all N tokens for its', 'H/P heads, then a', 'second all-to-all', 'restores the layout'], { size: 12, font: 'mono', color: 'text', lh: 22, parent: g });

    var mc = card(ctx, g, 900, 160, 650, 700, 'violet', 'FOX SHOT: 75,600 TOKENS ON 8 GPUs');
    ctx.para(920, 212, [
      'SP = 8 → 9,450 tokens (and their activations)',
      '  per GPU; Ulysses: 40 heads / 8 = 5 per GPU',
      '',
      'RING / CONTEXT PARALLEL',
      '· P2P send K,V block to the next GPU, P−1 steps',
      '· comm of block t+1 hides under compute of t',
      '· degree not bounded by heads; causal masks need',
      '  zig-zag sharding for balance (Llama 3 CP)',
      '',
      'ULYSSES',
      '· 4 all-to-alls per layer (Q, K, V in; O out)',
      '· per-GPU volume ∝ N·h / P: constant when N, P',
      '  grow together; needs P | #heads',
      '',
      'USP (hybrid): Ulysses inside NVLink × ring across;',
      '  xDiT-style video serving adds CFG-parallel 2',
      '  (cond / uncond branches on separate GPU groups)'
    ], { size: 13, font: 'mono', color: 'text', lh: 36, parent: mc });
    keepWS(mc);
  }

  function paintRingAttn(ctx, S, t) {
    /* t: number of completed ring steps (0..4) */
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
      var st = (i - j + 4) % 4;
      var cg = S.blk[i][j];
      var on = st < t;
      cg.r.setAttribute('fill', on ? ctx.alpha(RK[j], st === t - 1 ? 0.85 : 0.45) : 'rgba(255,255,255,0.03)');
      cg.t.textContent = on ? 'step ' + st : '';
    }
    var h = t === 0 ? 0 : t - 1; /* KV block currently resident on GPU i: (i − h) mod 4 */
    for (i = 0; i < 4; i++) S.kvT[i].textContent = 'KV' + ((i - h + 4) % 4);
    S.spStep.textContent = t === 0 ? 'ready' : (t >= 4 ? 'done' : 'step ' + (t - 1));
  }

  /* ================================================================ 9 MAPPING */
  function buildMap(ctx, S, g) {
    ctx.text(90, 176, '64 GPUs = 8 nodes × 8 · TP 8 × PP 4 × DP 2', { size: 14, font: 'mono', weight: 700, color: 'red', parent: g, spacing: 1 });
    S.nodeCols = []; S.mcell = [];
    for (var n = 0; n < 8; n++) {
      var x = 150 + n * 80;
      ctx.text(x + 34, 212, 'node ' + n, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
      var col = ctx.rect(x, 222, 68, 500, { rx: 8, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('white', 0.2), sw: 1, parent: g });
      S.nodeCols.push(col);
      S.mcell.push([]);
      for (var k = 0; k < 8; k++) {
        var st = n % 4;
        S.mcell[n].push(cellG(ctx, g, x + 6, 230 + k * 61, 56, ctx.alpha(RK[st], 0.35), 'g' + k, 'white'));
      }
    }
    ctx.text(128, 474, 'rail k = row k', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g }).setAttribute('transform', 'rotate(-90 128 474)');
    [[0, 'DP replica 0'], [4, 'DP replica 1']].forEach(function (d) {
      var x0 = 150 + d[0] * 80, x1 = x0 + 3 * 80 + 68;
      ctx.path('M' + x0 + ',764 V774 H' + x1 + ' V764', { stroke: AX.DP, sw: 1.5, parent: g });
      ctx.text((x0 + x1) / 2, 790, d[1], { size: 12, font: 'mono', weight: 700, color: AX.DP, anchor: 'middle', parent: g });
    });
    for (var s = 0; s < 4; s++) {
      ctx.rect(150 + s * 160, 810, 14, 14, { rx: 2, fill: ctx.alpha(RK[s], 0.6), parent: g });
      ctx.text(170 + s * 160, 818, 'PP stage ' + s, { size: 12, font: 'mono', color: 'text', parent: g });
    }
    ctx.text(150, 848, 'column = TP group (NVLink) · green arcs = PP send · cyan = DP on rail 3', { size: 12, font: 'mono', color: 'dim', parent: g });
    S.ppArrows = []; S.dpArcs = []; S.tpPaths = [];
    for (n = 0; n < 8; n++) {
      var ca = 150 + n * 80 + 34, cb = ca + 80;
      if (n % 4 !== 3) S.ppArrows.push(ctx.path('M' + ca + ',724 Q' + (ca + 40) + ',752 ' + cb + ',726', { stroke: AX.PP, sw: 2.4, arrow: true, parent: g }));
      S.tpPaths.push(ctx.path('M' + (150 + n * 80 + 34) + ',258 V685', { stroke: 'rgba(0,0,0,0)', parent: g }));
    }
    for (n = 0; n < 4; n++) {
      var y = 230 + 3 * 61 + 28;
      var xa = 150 + n * 80 + 34, xb = 150 + (n + 4) * 80 + 34;
      var arc = ctx.path('M' + xa + ',' + y + ' Q' + ((xa + xb) / 2) + ',' + (y - 70 - n * 12) + ' ' + xb + ',' + y, { stroke: ctx.alpha(AX.DP, 0.85), sw: 1.8, dash: '5 4', parent: g });
      S.dpArcs.push(arc);
    }
    S.ppArrows.concat(S.dpArcs).forEach(function (e) { e.setAttribute('opacity', 0); });

    var mc = card(ctx, g, 900, 160, 650, 700, 'red', 'REAL MAPPINGS (2024–2026)');
    ctx.para(920, 212, [
      'rule: bandwidth demand TP > SP ≈ EP > PP > DP,',
      '  so map the innermost axis to the fastest link',
      '',
      'Llama 3 405B pretraining · 16,384 H100',
      '  TP 8 × CP 1 × PP 16 × DP 128  (8k seq)',
      '  long-context phase: CP 16 × DP 8',
      'DeepSeek-V3 · 2,048 H800',
      '  PP 16 × EP 64 (8 nodes) × ZeRO-1 DP, no TP',
      '',
      'THE FOX-TRAILER FLEET (serving)',
      '  planner LLM 70B: TP 8 per replica, DP replicas,',
      '    prefill / decode on separate pools',
      '  MoE agents on NVL72: wide EP 72 + DP attention',
      '  video DiT shot: Ulysses SP 8 × CFG-parallel 2',
      '    = 16 GPUs per shot, 6 shots in flight',
      '  VAE decode: spatial tiling, 1 GPU per tile'
    ], { size: 13, font: 'mono', color: 'text', lh: 38, parent: mc });
    keepWS(mc);
  }

  /* ================================================================ SCENE */
  Atlas.register({
    id: 'parallelism',
    refs: [
      'Shoeybi et al., <i>Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism</i>, 2019; Narayanan et al., <i>Efficient Large-Scale Language Model Training on GPU Clusters Using Megatron-LM</i>, SC 2021; Korthikanti et al., <i>Reducing Activation Recomputation in Large Transformer Models</i> (Megatron-SP), MLSys 2023',
      'Rajbhandari, Rasley, Ruwase &amp; He, <i>ZeRO: Memory Optimizations Toward Training Trillion Parameter Models</i>, SC 2020; Zhao et al., <i>PyTorch FSDP</i>, VLDB 2023',
      'Patarasuk &amp; Yuan, <i>Bandwidth Optimal All-reduce Algorithms for Clusters of Workstations</i>, JPDC 2009',
      'Huang et al., <i>GPipe</i>, NeurIPS 2019; Qi, Wan, Huang &amp; Lin, <i>Zero Bubble Pipeline Parallelism</i>, ICLR 2024',
      'Lepikhin et al., <i>GShard</i>, ICLR 2021; DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i>, 2024',
      'Liu, Zaharia &amp; Abbeel, <i>Ring Attention with Blockwise Transformers for Near-Infinite Context</i>, ICLR 2024; Jacobs et al., <i>DeepSpeed Ulysses</i>, 2023',
      'Fang &amp; Zhao, <i>USP: A Unified Sequence Parallelism Approach for Long Context Generative AI</i>, 2024 (xDiT)',
      'Llama Team (Meta), <i>The Llama 3 Herd of Models</i>, 2024'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Why split a model',
        say: 'A single GPU is not enough, for two reasons. Memory: a seventy billion parameter language model needs one hundred forty gigabytes just for its weights, and training it with Adam needs about sixteen bytes per parameter. Compute: one shot of the fox trailer costs about seven tenths of an exaflop, half an hour on a single GPU. So we cut the model. There are five ways to cut: replicate it and split the batch, split every weight matrix, split the layers, split the experts, or split the sequence. Each cut buys capacity and pays for it in communication.',
        deep: '<p>Every parallelism strategy trades <b>memory and compute per GPU</b> for <b>communication</b>. The art is choosing cuts whose traffic fits the link they land on.</p>' +
          '<table><tr><th>Axis</th><th>Shards</th><th>Collective</th><th>Volume per step</th></tr>' +
          '<tr><td>DP</td><td>batch</td><td>all-reduce ∇</td><td>≈ 2Ψ elements sent per GPU per iteration (train)</td></tr>' +
          '<tr><td>TP</td><td>weight matrices</td><td>all-reduce acts</td><td>4 all-reduces of b·s·h per layer (fwd+bwd)</td></tr>' +
          '<tr><td>PP</td><td>layers</td><td>send/recv</td><td>b·s·h per stage boundary</td></tr>' +
          '<tr><td>EP</td><td>experts</td><td>all-to-all</td><td>2 × k·b·s·h per MoE layer</td></tr>' +
          '<tr><td>SP/CP</td><td>tokens</td><td>ring P2P or all-to-all</td><td>K,V or Q,K,V,O per layer</td></tr></table>' +
          '<div class="eq">train memory ≈ 16Ψ bytes (BF16 W, ∇ + FP32 master, m, v) + activations</div>' +
          '<div class="eq">KV cache (70B, GQA-8) = 2 · 80 · 8 · 128 · 2 B = 320 KB / token</div>' +
          '<p>32 concurrent 8k-token sequences therefore need ~86 GB of KV on top of 140 GB of weights — three H100s’ worth before any batching headroom. Axes compose multiplicatively: #GPUs = DP × TP × PP × (CP) with EP usually folded into DP ranks.</p>',
        run: function (ctx) {
          var S = ctx.state;
          S.loops = [];
          ctx.hud('memory + compute → 5 ways to cut: DP · TP · PP · EP · SP');
          return swapPage(ctx, S, function (g) { buildWhy(ctx, S, g); }).then(function () {
            S.memBars.forEach(function (b, i) { ctx.animate(b, { width: [0, b.full] }, 900, 'out', i * 150); });
            ctx.reveal(S.cutRows, { from: 'right', stagger: 140 });
            showAxis(ctx, S, 0);
            return ctx.wait(1400).then(function () {
              S.loops.push(ctx.loop(function (t) { showAxis(ctx, S, Math.floor(t / 2.2) % 5); }));
            });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Data parallel & ZeRO',
        say: 'Data parallelism is the simplest cut. Every GPU holds a full copy of the model and processes a different slice of the batch. In training, each replica computes different gradients, so after the backward pass an all-reduce averages them and every replica takes the same optimizer step. For serving, data parallel just means more replicas behind the load balancer. The catch is memory: replicating Adam states costs sixteen bytes per parameter. ZeRO and FSDP shard those states across the replicas, shrinking per GPU memory by up to the number of GPUs.',
        deep: '<p><b>DDP</b>: each rank computes ∇W on its shard; bucketed all-reduces overlap with the backward pass (gradients of late layers are ready first). A ring all-reduce sends ≈ 2Ψ <i>elements</i> per GPU per step (reduce-scatter Ψ + all-gather Ψ), i.e. ≈ 4Ψ bytes for BF16 gradients.</p>' +
          '<div class="eq">W ← W − η · Adam( (1/N) Σ<sub>i</sub> ∇W<sub>i</sub> )</div>' +
          '<p><b>ZeRO</b> (Rajbhandari et al.) removes redundancy stage by stage, for Ψ = 7.5B, N = 64, K = 12:</p>' +
          '<table><tr><th>Stage</th><th>Per-GPU memory</th><th>GB</th></tr>' +
          '<tr><td>DDP</td><td>(2 + 2 + K)Ψ</td><td>120</td></tr>' +
          '<tr><td>ZeRO-1 (P<sub>os</sub>)</td><td>4Ψ + KΨ/N</td><td>31.4</td></tr>' +
          '<tr><td>ZeRO-2 (+g)</td><td>2Ψ + (2+K)Ψ/N</td><td>16.6</td></tr>' +
          '<tr><td>ZeRO-3 / FSDP (+p)</td><td>(2+2+K)Ψ/N</td><td>1.9</td></tr></table>' +
          '<p>ZeRO-3 re-materializes each layer’s weights just in time (all-gather), then frees them; grads leave via reduce-scatter. Traffic rises from 2Ψ to ~3Ψ elements per GPU (1.5×) but model-state memory falls N-fold. <b>HSDP</b> shards inside a node and replicates across nodes so the all-gathers stay on NVLink.</p>' +
          '<div class="note">For our serving fleet DP is trivially parallel: the LLM planner runs as many TP-8 replicas as traffic demands; the load balancer (prefix/KV-aware) is the only coupling.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('DP: all-reduce ∇W · ZeRO-3 memory = 16Ψ / N');
          return swapPage(ctx, S, function (g) { buildDP(ctx, S, g); }).then(function () {
            S.zBars.forEach(function (b, i) { ctx.animate(b, { width: [0, b.full] }, 700, 'out', 200 + Math.floor(i / 3) * 250); });
            return Promise.all(S.dpIn.map(function (l, i) { return ctx.packet(l, { color: RK[i], dur: 700, r: 5 }); }));
          }).then(function () {
            /* backward: each replica gets different gradients */
            return ctx.tween(900, function (t) {
              S.grads.forEach(function (m, i) { m.set(function (r, c) { return ctx.cmap('diverge', S.gradVals[i][c] * t); }); });
            });
          }).then(function () {
            return Promise.all(S.dpOut.map(function (l) { return ctx.packet(l, { color: 'cyan', dur: 500, r: 4 }); }));
          }).then(function () {
            return Promise.all([ctx.packet(S.bandPath, { color: 'cyan', dur: 1300, r: 5 }), ctx.packet(S.bandPath, { color: 'cyan', dur: 1300, r: 5, reverse: true })]);
          }).then(function () {
            var avg = [];
            for (var c = 0; c < 8; c++) { var s = 0; for (var i = 0; i < 4; i++) s += S.gradVals[i][c]; avg.push(s / 4); }
            return ctx.tween(900, function (t) {
              S.grads.forEach(function (m, i) { m.set(function (r, c2) { return ctx.cmap('diverge', S.gradVals[i][c2] * (1 - t) + avg[c2] * t); }); });
            });
          }).then(function () {
            ctx.pulse(S.stepT, { color: 'cyan', dur: 700 });
            return Promise.all(S.reps.map(function (l, i) { return ctx.packet(l, { color: 'cyan', dur: 700 + i * 120, r: 4 }); }));
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Ring all-reduce',
        say: 'How does an all-reduce actually move bytes? The classic answer is the ring. Split each GPU’s gradient into as many chunks as there are GPUs. In the reduce-scatter phase, every GPU passes one chunk to its neighbour, which adds it to its own; after n minus one steps each GPU owns one chunk that is fully summed. In the all-gather phase the finished chunks travel around the ring once more. Every link is busy at every step, and each GPU sends only about twice the message size, no matter how many GPUs join.',
        deep: '<p>Ring all-reduce (Patarasuk &amp; Yuan) is <b>bandwidth-optimal</b>: to end with Σ everywhere, each GPU must receive at least (n−1)/n·S for the reduction and send (n−1)/n·S of finished data, so 2(n−1)/n·S is a lower bound — and the ring meets it.</p>' +
          '<div class="eq">T<sub>ring</sub> = 2(n−1)·α + 2·(n−1)/n · S/B</div>' +
          '<pre>for s in range(n-1):            # reduce-scatter\n  send(chunk[(r - s) % n], to=r+1)\n  chunk[(r - s - 1) % n] += recv(frm=r-1)\nfor s in range(n-1):            # all-gather\n  send(chunk[(r + 1 - s) % n], to=r+1)\n  chunk[(r - s) % n] = recv(frm=r-1)</pre>' +
          '<p>The latency term grows linearly in n, so NCCL uses <b>double binary trees</b> (log n depth, still ~full bandwidth) for small/medium messages, and <b>NVLS</b> on NVSwitch or <b>SHARP</b> on InfiniBand to perform the reduction inside the switch, halving the bytes each GPU must push. At cluster scale all-reduces are <b>hierarchical</b>: reduce-scatter over NVLink, all-reduce the 1/8-size shards across rails, all-gather over NVLink.</p>' +
          '<div class="note">Worked number: 14 GB of BF16 grads on 8 GPUs over NVLink4 → 2·7/8·14 GB ÷ 450 GB/s ≈ 54 ms, easily hidden under a backward pass of several seconds.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('each GPU sends 2(n−1)/n · S · bandwidth-optimal');
          return swapPage(ctx, S, function (g) { buildRing(ctx, S, g); }).then(function () {
            ctx.reveal(S.arcs, { from: 'draw', stagger: 150, dur: 500 });
            var chain = ctx.wait(700);
            [0, 1, 2, 3, 4, 5].forEach(function (ph) { chain = chain.then(function () { return ringPhase(ctx, S, ph); }); });
            return chain.then(function () {
              S.phaseT.textContent = 'all-reduced';
              S.phaseS.textContent = 'Σ of all 4 on every GPU';
              return Promise.all(S.rgpu.map(function (n) { return ctx.pulse(n, { color: 'lime', dur: 700 }); }));
            });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'The collectives',
        say: 'All distributed training and serving is built from a handful of collectives. All-gather gives every GPU every shard; fully sharded data parallel uses it to rebuild weights just in time. Reduce-scatter sums and leaves each GPU one shard of the result. All-to-all is a distributed transpose: chunk i j travels from GPU i to GPU j, which is exactly how mixture of experts dispatches tokens and how Ulysses swaps sequence for heads. NCCL implements all of these with rings, trees, and in-switch reductions, and picks the algorithm per message size.',
        deep: '<p>With n ranks and S bytes of logical data, the per-GPU send volumes are:</p>' +
          '<div class="eq">AG = RS = A2A = (n−1)/n · S   ·   AR = 2(n−1)/n · S</div>' +
          '<p>But their <b>traffic patterns</b> differ: rings and trees only use neighbour links, while all-to-all needs every pair — it wants a full-bisection switch (NVSwitch, or a non-blocking fat-tree) and suffers most from congestion and stragglers. That is why MoE all-to-all is usually confined to an NVLink domain or to a few nodes (node-limited routing).</p>' +
          '<ul><li><b>NCCL</b> tunes (algorithm ∈ {ring, tree, NVLS, CollNet}) × (protocol ∈ {Simple, LL, LL128}) × channels per call from a cost model of α, β.</li>' +
          '<li>Collectives run as <b>kernels on SMs</b>: a TP all-reduce steals SMs from the GEMMs it should overlap with; Hopper/Blackwell mitigate with copy engines, NVLS offload and SM-light kernels (DeepEP uses ~20 SMs).</li>' +
          '<li>Tiny decode-time messages are latency-bound: one-shot all-reduce over symmetric memory (every GPU reads peers’ buffers via NVLink load/store) beats a ring.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('AG = RS = A2A = (n−1)/n·S · AR = 2(n−1)/n·S');
          return swapPage(ctx, S, function (g) { buildColl(ctx, S, g); }).then(function () {
            S.after.forEach(function (a) { a.setAttribute('opacity', 0); });
            S.a2a.forEach(function (cg) { ctx.place(cg, cg.src.x, cg.src.y); cg.setAttribute('opacity', 0); });
            var p1 = ctx.reveal(S.after, { from: 'left', stagger: 450, delay: 300, dur: 600 });
            var p2 = ctx.wait(1200).then(function () {
              return Promise.all(S.a2a.map(function (cg, k) {
                cg.setAttribute('opacity', 1);
                return ctx.transform(cg, { x: cg.dst.x, y: cg.dst.y }, 1100, 'inOut', k * 60);
              }));
            });
            return Promise.all([p1, p2]);
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Tensor parallel',
        say: 'Tensor parallelism splits every weight matrix. Megatron’s trick for the MLP is to split the first matrix by columns and the second by rows. Each GPU multiplies the full input by its column slice and applies GeLU locally, because the nonlinearity works column by column. Then it multiplies by its row slice of the second matrix, producing a partial sum. A single all-reduce adds the four partial sums. Attention works the same way by splitting heads. That is two all-reduces per layer in the forward pass, on the critical path, so tensor parallel stays inside NVLink.',
        deep: '<p>For an MLP <code>Z = GeLU(XA)B</code> on t GPUs:</p>' +
          '<div class="eq">A = [A<sub>1</sub> … A<sub>t</sub>],  Y<sub>i</sub> = GeLU(X A<sub>i</sub>),  B = [B<sub>1</sub>; … ; B<sub>t</sub>],  Z = Σ<sub>i</sub> Y<sub>i</sub> B<sub>i</sub></div>' +
          '<p>Megatron wraps this in conjugate operators: <i>f</i> (identity forward, all-reduce backward) before the block and <i>g</i> (all-reduce forward, identity backward) after it. Attention: Q, K, V projections column-parallel by heads (each GPU runs h/t heads end-to-end), output projection row-parallel.</p>' +
          '<div class="eq">comm / layer (fwd) = 2 × AR(b·s·h) → 2 · 2(t−1)/t · b·s·h · 2 B</div>' +
          '<p>Unlike DP, this traffic is <b>synchronous</b> — the next GEMM waits for it — and scales with tokens, not parameters. Worked for a 70B model (h = 8,192, 80 layers, TP = 8) prefilling 8k tokens: 134 MB per all-reduce, ≈ 0.52 ms each on NVLink4, ≈ 83 ms per prefill vs ≈ 240 ms of math; over 50 GB/s InfiniBand it would be ≈ 750 ms. <b>Megatron-SP</b> replaces each all-reduce with reduce-scatter + all-gather (same bytes) and shards the LayerNorm/dropout activations along the sequence, cutting activation memory by t.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('TP: A by columns, B by rows → 1 all-reduce');
          return swapPage(ctx, S, function (g) { buildTP(ctx, S, g); }).then(function () {
            var hideL = [];
            S.lanes.forEach(function (L) { hideL.push(L.Y, L.Z, L.gelu, L.zl, L.link); });
            hideL.push(S.zOut, S.zLink);
            hideL.forEach(function (e) { e.setAttribute('opacity', 0); });
            S.tpBars.forEach(function (b, i) { b.setAttribute('width', 0); ctx.animate(b, { width: [0, b.full] }, 800, 'out', 600 + i * 200); });
            var flies = [];
            S.lanes.forEach(function (L, i) {
              flies.push(flyFrom(ctx, L.A, 150 + i * 92, 214, 89, 210, L.cy - 27, 54, 1000, i * 150));
              flies.push(flyFrom(ctx, L.B, 620, 176 + i * 40, 38, 444, L.cy - 27, 54, 1000, 500 + i * 150));
            });
            return Promise.all(flies);
          }).then(function () {
            return ctx.camera(420, 560, 1.45, 900);
          }).then(function () {
            var chain = Promise.resolve();
            S.lanes.forEach(function (L, i) {
              chain = chain.then(function () {
                ctx.reveal([L.gelu, L.Y], { from: 'left', stagger: 120, dur: 350 });
                return ctx.reveal([L.Z, L.zl], { from: 'left', delay: 250, dur: 350 });
              });
            });
            return chain;
          }).then(function () {
            S.lanes.forEach(function (L) { ctx.reveal(L.link, { from: 'draw', dur: 300 }); });
            return Promise.all(S.lanes.map(function (L) { return ctx.packet(L.link, { color: 'amber', dur: 600, r: 5 }); }));
          }).then(function () {
            ctx.pulse(S.arBar, { color: 'amber', dur: 700 });
            ctx.reveal(S.zLink, { from: 'draw', dur: 300 });
            return ctx.reveal(S.zOut, { from: 'scale', dur: 600 });
          }).then(function () {
            return ctx.camera(null, null, null, 900);
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Pipeline parallel',
        say: 'Pipeline parallelism splits the layers into stages on different GPUs, passing activations forward and gradients backward. To keep every stage busy, the batch is cut into micro-batches. Even so, the pipeline must fill and drain, leaving idle bubbles. With four stages and eight micro-batches, twenty seven percent of the time is bubble. The one forward one backward schedule has the same bubble but holds far fewer activations in memory. Interleaving, zero bubble schedules, and DeepSeek’s DualPipe squeeze the bubble further. Its traffic is small, so pipelines can cross nodes.',
        deep: '<p>With p stages and m micro-batches, and a backward pass as long as the forward:</p>' +
          '<div class="eq">bubble = (p − 1) / (m + p − 1)</div>' +
          '<p>The animation is produced by a dependency simulator: F(k) at stage s waits for F(k) at s−1; B(k) at s waits for B(k) at s+1. Both schedules finish in 2(m+p−1) = 22 slots, but <b>GPipe</b> stashes activations for all m micro-batches, while <b>1F1B</b> (PipeDream-Flush) caps them at p.</p>' +
          '<ul><li><b>Interleaved 1F1B</b> (Megatron): v model chunks per GPU; bubble shrinks by v at the cost of v× more p2p messages.</li>' +
          '<li><b>Zero Bubble</b> (Qi et al., ICLR 2024): split B into B<sub>input</sub> (on the critical path) and W (weight-grad, deferrable) and schedule W into the bubbles.</li>' +
          '<li><b>DualPipe</b> (DeepSeek-V3): feeds micro-batches from both ends and overlaps the MoE all-to-all of one micro-batch with compute of another.</li></ul>' +
          '<p>Traffic is one b·s·h activation per boundary per micro-batch (e.g. 1 × 4,096 × 8,192 × 2 B = 64 MB), point-to-point: the least bandwidth-hungry axis, so PP is what crosses node and even rack boundaries. For serving, PP raises throughput but adds a hop to each token’s latency.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('bubble = (p−1)/(m+p−1) = 3/11 ≈ 27%');
          return swapPage(ctx, S, function (g) { buildPP(ctx, S, g); }).then(function () {
            paintSched(ctx, S, 0);
            S.loops.push(ctx.loop(function (t) {
              var k = Math.floor(t * 1.5) % 3;
              S.ppLinks.forEach(function (l, i) { l.setAttribute('stroke-width', i === k ? 3.2 : 1.8); });
            }));
            ctx.animate(S.memA, { width: [0, 400] }, 900, 'out', 300);
            ctx.animate(S.memB, { width: [0, 200] }, 900, 'out', 500);
            return ctx.tween(4200, function (t) { paintSched(ctx, S, Math.round(t * 22)); }, 'linear');
          }).then(function () {
            return Promise.all(S.ppLinks.map(function (l) { return ctx.packet(l, { color: 'lime', dur: 700, label: 'act' }); }));
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Expert parallel',
        say: 'Mixture of experts models replace the feed forward layer with many experts, and a router sends each token to only its top few. Expert parallelism places different experts on different GPUs. Every MoE layer then needs two all-to-all exchanges: dispatch, which ships each token to the GPUs hosting its chosen experts, and combine, which brings the results back. Routing is data dependent, so some experts get hot while others idle; capacity limits and balancing tricks keep the load even. DeepSeek V3 runs this over sixty four GPUs.',
        deep: '<div class="eq">y = Σ<sub>e ∈ TopK(s(x))</sub> g<sub>e</sub>(x) · FFN<sub>e</sub>(x),   s(x) = softmax(x·W<sub>g</sub>) or sigmoid</div>' +
          '<p>Per MoE layer, each token of hidden size h crosses the fabric 2k times (k copies out, k back). For DeepSeek-V3 (h = 7,168, k = 8, 256 routed + 1 shared expert, 37B of 671B params active), dispatch is sent in FP8 (≈ 57 KB/token) and combine in BF16 (≈ 115 KB/token).</p>' +
          '<ul><li><b>Node-limited routing</b>: a token may only pick experts on ≤ 4 nodes, so each token crosses InfiniBand at most 4 times and then fans out over NVLink.</li>' +
          '<li><b>Load balance</b>: GShard/Switch add an auxiliary loss α·E·Σ f<sub>e</sub>P<sub>e</sub>; DeepSeek-V3 instead adds a per-expert bias b<sub>e</sub> to routing scores only, nudged up/down by observed load (aux-loss-free).</li>' +
          '<li><b>Capacity</b> = C·k·T/E tokens per expert; overflow is dropped (training) or rerouted — the chart shows one hot expert (E2) blowing past C = 1.25.</li>' +
          '<li><b>Serving</b>: prefill uses throughput-oriented all-to-all; decode uses latency-oriented kernels (DeepEP low-latency mode via IBGDA). On NVL72, “wide EP” spreads experts over all 72 GPUs at NVLink speed while attention runs data-parallel.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('EP: dispatch all-to-all → experts → combine all-to-all');
          return swapPage(ctx, S, function (g) { buildEP(ctx, S, g); }).then(function () {
            S.loadBars.forEach(function (b) { b.setAttribute('opacity', 0); });
            return Promise.all(S.routes.map(function (rt) { return ctx.packet(rt.p, { color: rt.col, dur: 1300, r: 4 }); }));
          }).then(function () {
            ctx.reveal(S.loadBars, { from: 'up', stagger: 60 });
            return Promise.all(S.exp.map(function (e) { return ctx.pulse(e, { color: 'magenta', dur: 600 }); }));
          }).then(function () {
            return Promise.all(S.routes.map(function (rt) { return ctx.packet(rt.p, { color: rt.col, dur: 1300, r: 4, reverse: true }); }));
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Sequence parallel',
        say: 'Video diffusion transformers have a different problem: one shot of the fox trailer is seventy five thousand tokens, and attention over all of them is the dominant cost. Sequence parallelism splits the tokens. In ring attention, each GPU keeps its queries and passes key and value blocks around a ring, merging partial results with an online softmax while the next block is already in flight. Ulysses instead uses an all-to-all to trade the sequence split for a head split, runs ordinary attention, and trades back. Production video serving combines both.',
        deep: '<p><b>Ring attention</b> (Liu et al.): GPU i holds Q<sub>i</sub>, K<sub>i</sub>, V<sub>i</sub>. For t = 0…P−1 it computes the block (Q<sub>i</sub>, K<sub>(i−t) mod P</sub>) and merges it with FlashAttention-style running statistics while sending its current K,V block to GPU i+1:</p>' +
          '<div class="eq">m′ = max(m, m<sub>b</sub>),  ℓ′ = e<sup>m−m′</sup>ℓ + e<sup>m<sub>b</sub>−m′</sup>ℓ<sub>b</sub>,  O′ = (e<sup>m−m′</sup>ℓ·O + e<sup>m<sub>b</sub>−m′</sup>ℓ<sub>b</sub>·O<sub>b</sub>) / ℓ′</div>' +
          '<p>Communication hides under compute when the block’s attention FLOPs (4·(N/P)²·d) outlast its K,V transfer (2·(N/P)·d·2 B) — true for long sequences. With causal masks (LLMs), naive splits are unbalanced; zig-zag sharding fixes it.</p>' +
          '<p><b>Ulysses</b> (DeepSpeed): all-to-all Q, K, V from [N/P, H] to [N, H/P], run dense attention per head group, all-to-all O back. Bounded by P ≤ H and requires P | H (Wan 2.1 14B: 40 heads → P ∈ {2, 4, 5, 8, 10, …}).</p>' +
          '<p><b>USP</b> composes both (Ulysses degree inside NVLink × ring degree across), and video engines (xDiT-style) add <b>CFG parallel</b>: conditional and unconditional branches of classifier-free guidance on separate GPU groups — for the fox shot, SP 8 × CFG 2 = 16 GPUs.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('fox shot: 75,600 tokens ÷ 8 GPUs = 9,450 each');
          return swapPage(ctx, S, function (g) { buildSP(ctx, S, g); }).then(function () {
            paintRingAttn(ctx, S, 0);
            S.u2.forEach(function (cg) { ctx.place(cg, cg.src.x, cg.src.y); cg.setAttribute('opacity', 0); });
            var chain = ctx.wait(400);
            [1, 2, 3, 4].forEach(function (t) {
              chain = chain.then(function () {
                paintRingAttn(ctx, S, t);
                if (t === 4) return ctx.wait(300);
                return Promise.all(S.sArcs.map(function (a, i) { return ctx.packet(a, { color: RK[(i - t + 1 + 8) % 4], dur: 900, r: 6, label: 'KV' + ((i - t + 1 + 8) % 4) }); }));
              });
            });
            return chain;
          }).then(function () {
            return Promise.all(S.u2.map(function (cg, k) {
              cg.setAttribute('opacity', 1);
              return ctx.transform(cg, { x: cg.dst.x, y: cg.dst.y }, 1000, 'inOut', (k % 4) * 80);
            }));
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Mapping to topology',
        say: 'Finally, map the cuts onto the hardware. Rank the axes by how much and how often they talk. Tensor parallel is chatty and on the critical path, so it lives inside a node, on NVLink. Sequence and expert parallel come next, inside the NVLink domain when possible. Pipeline stages exchange one activation per micro-batch, so they cross nodes. Data parallel talks least, once per step, so it spans the whole cluster, and because same-rank GPUs share a rail, its all-reduce crosses one switch. Every large system, from Llama three to our fox trailer fleet, follows this rule.',
        deep: '<p>The mapping problem: assign each GPU a coordinate (dp, pp, cp/sp, tp) so that the groups with the highest bandwidth × frequency land on the fastest links.</p>' +
          '<div class="eq">rank = ((dp · P<sub>pp</sub> + pp) · P<sub>cp</sub> + cp) · P<sub>tp</sub> + tp   (TP fastest-varying → same node)</div>' +
          '<table><tr><th>Axis</th><th>Traffic pattern</th><th>Placement</th></tr>' +
          '<tr><td>TP</td><td>2 AR / layer, synchronous</td><td>within 8-GPU node / NVL domain</td></tr>' +
          '<tr><td>SP / CP / EP</td><td>A2A or ring per layer</td><td>NVLink domain; EP may span a few nodes</td></tr>' +
          '<tr><td>PP</td><td>p2p per micro-batch</td><td>across nodes</td></tr>' +
          '<tr><td>DP / FSDP</td><td>once per step, overlappable</td><td>across rails, whole cluster</td></tr></table>' +
          '<p>In the diagram, each column is a node (TP group), stages 0–3 chain left to right, and replica 1 mirrors replica 0; the DP all-reduce for GPU g3 of stage s connects node s and node s+4 — both on <b>rail 3</b>, so it is one leaf-switch hop.</p>' +
          '<div class="note">Serving is the same game with different weights: prefill likes TP/SP (compute), decode likes DP + wide EP (memory bandwidth, batch size), and the video DiT likes SP × CFG inside one NVLink domain. The schedulers in the sibling chambers decide which GPUs form each group.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('TP in node · PP across nodes · DP across rails');
          return swapPage(ctx, S, function (g) { buildMap(ctx, S, g); }).then(function () {
            return ctx.camera(184, 470, 1.55, 900);
          }).then(function () {
            S.nodeCols.forEach(function (c) { c.setAttribute('stroke', ctx.alpha('amber', 0.9)); c.setAttribute('stroke-width', 2); });
            return Promise.all([
              ctx.packet(S.tpPaths[0], { color: 'amber', dur: 900, label: 'TP AR' }),
              ctx.packet(S.tpPaths[0], { color: 'amber', dur: 900, reverse: true }),
              ctx.pulse(S.nodeCols[0], { color: 'amber', dur: 900 })
            ]);
          }).then(function () {
            return ctx.camera(null, null, null, 900);
          }).then(function () {
            ctx.reveal(S.ppArrows, { from: 'draw', stagger: 120, dur: 400 });
            return Promise.all(S.ppArrows.map(function (a, i) { return ctx.wait(i * 120).then(function () { return ctx.packet(a, { color: 'lime', dur: 600, r: 4 }); }); }));
          }).then(function () {
            ctx.reveal(S.dpArcs, { from: 'draw', stagger: 150, dur: 500 });
            return Promise.all(S.dpArcs.map(function (a, i) {
              return ctx.wait(500 + i * 150).then(function () {
                return Promise.all([ctx.packet(a, { color: 'cyan', dur: 900, r: 4 }), ctx.packet(a, { color: 'cyan', dur: 900, r: 4, reverse: true })]);
              });
            }));
          });
        }
      }
    ]
  });
})();
