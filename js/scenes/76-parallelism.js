/* L2 — Distributed Parallelism. How one model spans many GPUs: DP (+ZeRO/FSDP), the collectives
 * (ring all-reduce, all-gather, reduce-scatter, all-to-all), Megatron TP, pipeline schedules, expert
 * parallel all-to-all, ring / Ulysses sequence parallel, and mapping it all onto the NVLink / RDMA topology.
 * Beat format: each step builds its page once (all elements exist) and reveals it beat by beat. */
(function () {
  /* colour language: axes and ranks */
  var AX = { DP: 'cyan', TP: 'amber', PP: 'lime', EP: 'magenta', SP: 'violet' };
  var RK = ['cyan', 'orange', 'lime', 'violet'];

  function bx(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    g.frame = ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    if (title) ctx.text(x + 16, y + 22, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.x0 = x; g.y0 = y; g.w0 = w;
    g.box = bx(x, y, w, h);
    return g;
  }

  /* grow (or shrink) a card frame to height h as its content arrives, keeping .box in sync for pulses */
  function fit(ctx, g, h, ms) {
    var cur = parseFloat(g.frame.getAttribute('height'));
    g.box = bx(g.x0, g.y0, g.w0, h);
    return ctx.animate(g.frame, { height: [cur, h] }, ms || 500, 'out');
  }

  /* hide one element or a list of them (opacity 0) so a later beat can ctx.reveal() them */
  function hide(els) { [].concat(els).forEach(function (e) { if (e) e.setAttribute('opacity', 0); }); }
  function kids(g) { return Array.prototype.slice.call(g.childNodes); }
  function zeroBars(bars) { bars.forEach(function (b) { b.setAttribute('width', 0); if (b.lab) b.lab.setAttribute('opacity', 0); }); }
  /* grow bars from zero width, one after another; the value label (b.lab) fades in when a bar is nearly done */
  function grow(ctx, bars, dur, gap, delay) {
    return Promise.all(bars.map(function (b, i) {
      if (b.lab) ctx.reveal(b.lab, { dur: 300, delay: (delay || 0) + i * gap + dur * 0.6 });
      return ctx.animate(b, { width: [0, b.full] }, dur, 'out', (delay || 0) + i * gap);
    }));
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
    S.modelG = ctx.group({ parent: g });
    var M = S.modelG;
    ctx.text(90, 176, 'ONE MODEL = L layers × hidden width h', { size: 14, font: 'mono', weight: 700, color: 'red', parent: M, spacing: 1 });
    ctx.text(311, 198, 'hidden width →', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: M });
    S.cells = [];
    for (var r = 0; r < 8; r++) {
      ctx.text(122, 230 + r * 46, 'layer ' + r, { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: M });
      for (var c = 0; c < 8; c++) S.cells.push(ctx.rect(130 + c * 46, 210 + r * 46, 40, 40, { rx: 4, fill: ctx.alpha('red', r % 2 ? 0.28 : 0.2), stroke: ctx.alpha('red', 0.5), sw: 1, parent: M }));
    }
    S.tokens = [];
    for (var t = 0; t < 12; t++) S.tokens.push(ctx.rect(130 + t * 30.2, 596, 26, 26, { rx: 4, fill: ctx.alpha('white', 0.12), stroke: ctx.alpha('white', 0.3), sw: 1, parent: M }));
    ctx.text(311, 640, 'input sequence (tokens) · batch of sequences', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: M });
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
    ctx.text(496, 585, 'odd layers = MoE: experts', { size: 11, font: 'mono', color: AX.EP, anchor: 'end', parent: o });
    o = S.ov.SP = ctx.group({ parent: g, opacity: 0 });
    for (t = 0; t < 12; t++) ctx.rect(130 + t * 30.2, 596, 26, 26, { rx: 4, fill: ctx.alpha(RK[Math.floor(t / 3)], 0.7), stroke: RK[Math.floor(t / 3)], sw: 1, parent: o });
    S.axName = ctx.text(560, 250, '', { size: 34, font: 'display', weight: 700, color: 'white', parent: g });
    S.axDesc = ctx.text(560, 284, '', { size: 13, font: 'mono', color: 'text', parent: g });
    S.axDesc2 = ctx.text(560, 306, '', { size: 13, font: 'mono', color: 'dim', parent: g });
    S.foxUse = ctx.para(90, 700, [
      'In the fox-trailer system every axis shows up:',
      '· LLM agents: TP inside a node, DP over replicas',
      '· MoE planner models: EP across the NVLink domain',
      '· video DiT shots: SP = 8 (+ CFG-parallel 2)',
      '· training all of them: DP / FSDP + PP across nodes'
    ], { size: 13, font: 'mono', color: 'text', lh: 26, parent: g });

    /* memory card */
    S.memCard = card(ctx, g, 800, 160, 750, 310, 'red', 'WHY SPLIT? MEMORY PER MODEL vs 80 GB HBM');
    var mc = S.memCard;
    var X0 = 820, SC = 0.46;
    var rows = [['14B video DiT · inference (BF16)', [[28, 'red']], '28 GB'], ['70B LLM · serving, 32 seqs × 8k ctx', [[140, 'red'], [86, 'amber']], '226 GB'], ['70B LLM · training (mixed-precision Adam)', [[140, 'red'], [140, 'orange'], [840, 'violet']], '1,120 GB + activations']];
    S.memRows = []; S.memBarRows = [];
    rows.forEach(function (rw, i) {
      var y = 214 + i * 70;
      var rg = ctx.group({ parent: mc });
      ctx.text(X0, y, rw[0], { size: 13, font: 'mono', color: 'text', parent: rg });
      var x = X0, bars = [];
      rw[1].forEach(function (seg) {
        var w = seg[0] * SC;
        var b = ctx.rect(x, y + 12, w, 22, { rx: 2, fill: ctx.alpha(seg[1], 0.6), stroke: seg[1], sw: 1, parent: rg });
        b.full = w;
        bars.push(b);
        x += w;
      });
      bars[bars.length - 1].lab = ctx.text(Math.max(x + 10, X0 + 80 * SC + 10), y + 23, rw[2], { size: 13, font: 'mono', weight: 700, color: 'white', parent: rg });
      ctx.line(X0 + 80 * SC, y + 6, X0 + 80 * SC, y + 40, { color: 'white', sw: 1.5, dash: '3 3', parent: rg });
      S.memRows.push(rg); S.memBarRows.push(bars);
    });
    ctx.text(X0 + 80 * SC, 431, '↑ 80 GB', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: mc });
    [['weights', 'red'], ['KV cache', 'amber'], ['grads', 'orange'], ['Adam m, v + FP32 master', 'violet']].forEach(function (L, i) {
      var lx = 1000 + i * 118;
      ctx.rect(lx, 424, 12, 12, { rx: 2, fill: ctx.alpha(L[1], 0.7), parent: mc });
      ctx.text(lx + 18, 431, L[0], { size: 11, font: 'mono', color: 'text', parent: mc });
    });
    S.compTxt = ctx.text(X0, 456, 'compute: one fox shot = 0.68 EFLOP → 29 min on 1 H100, 3.6 min on 8', { size: 12, font: 'mono', color: 'amber', parent: mc });

    /* five cuts */
    S.fiveCard = card(ctx, g, 800, 490, 750, 250, 'red', 'FIVE WAYS TO CUT');
    var fc = S.fiveCard;
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
    S.repG = []; S.shards = []; S.grads = []; S.dpIn = []; S.dpOut = [];
    var r = ctx.rng(21);
    S.gradVals = [];
    S.redG = ctx.group({ parent: g });
    for (var i = 0; i < 4; i++) {
      var cx = 170 + i * 200;
      var rg = ctx.group({ parent: g });
      S.repG.push(rg);
      S.shards.push(ctx.label(cx, 208, 'batch shard ' + i, { color: RK[i], size: 12, parent: rg }));
      ctx.node({ x: cx, y: 340, w: 170, h: 180, color: 'red', kind: 'box', parent: rg });
      ctx.text(cx, 266, 'GPU ' + i, { size: 13, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: rg });
      ctx.matrix(cx - 42, 282, 4, 4, { cell: 18, gap: 4, values: function () { return ctx.alpha('red', 0.45); }, parent: rg });
      ctx.text(cx, 382, 'full copy of W', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: rg });
      var vals = [];
      for (var k = 0; k < 8; k++) vals.push(r() * 2 - 1);
      S.gradVals.push(vals);
      S.grads.push(ctx.matrix(cx - 74, 400, 1, 8, { cell: 16, gap: 3, values: function () { return 'rgba(255,255,255,0.05)'; }, parent: rg }));
      S.dpIn.push(ctx.link({ x: cx, y: 222 }, { x: cx, y: 250 }, { color: RK[i], parent: rg, straight: true }));
      S.dpOut.push(ctx.link({ x: cx, y: 430 }, { x: cx, y: 470 }, { color: AX.DP, parent: S.redG, straight: true }));
    }
    S.band = ctx.group({ parent: S.redG });
    ctx.rect(85, 470, 770, 36, { rx: 8, fill: ctx.alpha(AX.DP, 0.12), stroke: AX.DP, sw: 1.4, parent: S.band });
    ctx.text(470, 488, 'ring all-reduce( ∇W ) / N · NCCL · overlapped with backward', { size: 13, font: 'mono', weight: 700, color: AX.DP, anchor: 'middle', parent: S.band });
    S.bandPath = ctx.path('M100,488 L840,488', { stroke: 'rgba(0,0,0,0)', parent: S.redG });
    S.stepT = ctx.text(470, 534, 'then: identical optimizer step on every replica', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.redG });

    /* inference DP */
    S.srvCard = card(ctx, g, 70, 570, 790, 290, 'cyan', 'SERVING: DP = REPLICAS BEHIND THE LOAD BALANCER');
    var ic = S.srvCard;
    S.lb = ctx.node({ x: 190, y: 715, w: 180, h: 54, title: 'Load balancer', sub: 'prefix-aware', icon: 'net', titleSize: 14, subSize: 11, color: 'blue', parent: ic });
    S.reps = [];
    for (i = 0; i < 4; i++) {
      var rn = ctx.node({ x: 470, y: 628 + i * 58, w: 210, h: 42, title: 'replica ' + i + ' · 70B, TP 8', titleSize: 12, color: 'cyan', kind: 'pill', glow: false, parent: ic });
      S.reps.push(ctx.link(S.lb, rn, { color: ctx.alpha('cyan', 0.7), parent: ic, from: 'r', to: 'l' }));
    }
    S.srvTxt = ctx.para(600, 640, ['no gradient traffic:', 'throughput scales ~linearly,', 'latency does not improve;', 'KV/prefix-aware routing', 'picks the replica.'], { size: 12, font: 'mono', color: 'text', lh: 24, parent: ic });

    /* ZeRO */
    S.zeroCard = card(ctx, g, 900, 160, 650, 200, 'cyan', 'ZeRO / FSDP · memory per GPU (Ψ = 7.5B, N = 64)');
    var zc = S.zeroCard;
    S.zHead = ctx.group({ parent: zc });
    ctx.text(920, 206, 'mixed-precision Adam = 2Ψ params + 2Ψ grads + 12Ψ optimizer', { size: 12, font: 'mono', color: 'text', parent: S.zHead });
    ctx.text(920, 226, '(FP32 master weights, momentum, variance) = 16Ψ bytes', { size: 12, font: 'mono', color: 'dim', parent: S.zHead });
    var Z = [['DDP · everything replicated', [15, 15, 90], '120 GB'], ['ZeRO-1 · shard optimizer states', [15, 15, 1.41], '31.4 GB'], ['ZeRO-2 · + shard gradients', [15, 0.234, 1.41], '16.6 GB'], ['ZeRO-3 / FSDP · + shard params', [0.234, 0.234, 1.41], '1.9 GB']];
    var ZC = ['blue', 'orange', 'violet'];
    S.zRows = []; S.zBarRows = [];
    Z.forEach(function (z, i) {
      var y = 300 + i * 76;
      var rg = ctx.group({ parent: zc });
      ctx.text(920, y, z[0], { size: 13, font: 'mono', color: 'white', parent: rg });
      var x = 920, bars = [];
      z[1].forEach(function (v, k) {
        var w = Math.max(1.5, v * 520 / 120);
        var b = ctx.rect(x, y + 14, w, 24, { rx: 2, fill: ctx.alpha(ZC[k], 0.65), stroke: ZC[k], sw: 0.8, parent: rg });
        b.full = w;
        bars.push(b);
        x += w;
      });
      bars[bars.length - 1].lab = ctx.text(x + 10, y + 26, z[2], { size: 13, font: 'mono', weight: 700, color: i === 3 ? 'lime' : 'white', parent: rg });
      S.zRows.push(rg); S.zBarRows.push(bars);
    });
    S.zLeg = ctx.group({ parent: zc });
    [['params (BF16)', 'blue'], ['grads (BF16)', 'orange'], ['optimizer (FP32)', 'violet']].forEach(function (L, i) {
      ctx.rect(920 + i * 190, 250, 12, 12, { rx: 2, fill: ctx.alpha(L[1], 0.7), parent: S.zLeg });
      ctx.text(938 + i * 190, 257, L[0], { size: 12, font: 'mono', color: 'text', parent: S.zLeg });
    });
    S.zLines = ctx.para(920, 626, [
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
    S.gpuG = [];
    for (i = 0; i < 4; i++) {
      var c = RPOS[i];
      var gg = ctx.group({ parent: g });
      S.gpuG.push(gg);
      S.rgpu.push(ctx.node({ x: c[0], y: c[1], w: 180, h: 76, color: 'red', parent: gg }));
      ctx.text(c[0], c[1] - 24, 'GPU ' + i, { size: 13, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: gg });
      S.rcell.push([]); S.cnt.push([1, 1, 1, 1]);
      for (var j = 0; j < 4; j++) S.rcell[i].push(cellG(ctx, gg, c[0] - 77 + j * 40, c[1] - 8, 34, ctx.alpha(RK[j], 0.32), '1', 'white'));
    }
    S.phaseG = ctx.group({ parent: g });
    S.phaseT = ctx.text(RC.x, RC.y - 14, 'start', { size: 20, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: S.phaseG });
    S.phaseS = ctx.text(RC.x, RC.y + 14, 'own gradient only', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.phaseG });
    ctx.text(RC.x, RC.y + 36, 'cell = chunk j', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.phaseG });
    ctx.text(RC.x, RC.y + 54, 'digit = # summed', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.phaseG });

    S.arCard = card(ctx, g, 900, 160, 650, 80, 'cyan', 'ALL-REDUCE = REDUCE-SCATTER + ALL-GATHER');
    var mc = S.arCard;
    var ap = { size: 13, color: 'text', lh: 28, pre: true, parent: mc };
    S.arL0 = ctx.para(920, 212, ['n GPUs, message S bytes, per-link bandwidth B'], ap);
    S.phLab = ctx.text(920, 254, 'PHASE', { size: 11, font: 'mono', color: 'dim', parent: mc });
    S.phChips = ['RS 1', 'RS 2', 'RS 3', 'AG 1', 'AG 2', 'AG 3'].map(function (s, k) {
      return ctx.label(950 + k * 94, 284, s, { color: k < 3 ? 'amber' : 'lime', size: 13, w: 80, parent: mc, opacity: 0.35 });
    });
    S.arRS = ctx.para(920, 334, ['reduce-scatter: n−1 steps of S/n → GPU i owns', '                chunk i+1, fully summed'], ap);
    S.arAG = ctx.para(920, 398, ['all-gather:     n−1 steps of S/n → all have all'], ap);
    S.arT = ctx.para(920, 430, ['sent per GPU = 2(n−1)/n · S   ← bandwidth-optimal', 'T ≈ 2(n−1)·α + 2(n−1)/n · S / B'], ap);
    S.arEx = ctx.group({ parent: mc });
    ctx.text(920, 506, 'EXAMPLE · 7B model, BF16 gradients, S = 14 GB', { size: 12, font: 'mono', weight: 700, color: 'amber', parent: S.arEx, spacing: 1 });
    ctx.para(920, 538, [
      'n = 8 on NVLink4 450 GB/s   → ≈ 54 ms',
      'n = 512 over IB NDR 50 GB/s → ≈ 0.56 s',
      'α-term 2(n−1)·α grows with n → NCCL switches',
      'to (double binary) trees for small messages;',
      'NVLS reduces inside NVSwitch, SHARP in the IB',
      'switches; hierarchical: RS in node → AR across',
      'rails → AG in node'
    ], ap);
    S.arLegend = ctx.para(920, 776, ['amber = reduce (add incoming chunk)', 'lime = gather (overwrite with final chunk)', 'every link busy every step: no idle wires'], { size: 12, font: 'mono', color: 'dim', lh: 24, parent: mc });
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
    S.panels = [];
    S.after = [];
    S.a2a = [];
    P.forEach(function (pn, q) {
      var x0 = pn[0], y0 = pn[1];
      var pc = card(ctx, g, x0, y0, 380, 330, q === 2 ? 'magenta' : 'cyan', pn[2]);
      S.panels.push(pc);
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
          var cg = cellG(ctx, pc, x0 + 46 + j * 34, y0 + 68 + i * 34, 30, ctx.alpha(RK[i], 0.7), i + '' + j);
          cg.src = { x: x0 + 46 + j * 34, y: y0 + 68 + i * 34 };
          cg.dst = { x: x0 + 240 + i * 34, y: y0 + 68 + j * 34 };
          S.a2a.push(cg);
        }
      } else S.after.push(aft);
      ctx.text(x0 + 16, y0 + 228 + 30, pn[3], { size: 12, font: 'mono', color: 'text', parent: pc });
      ctx.text(x0 + 16, y0 + 228 + 56, pn[4], { size: 12, font: 'mono', color: q === 2 ? 'magenta' : 'cyan', parent: pc });
    });

    S.whoCard = card(ctx, g, 900, 160, 650, 300, 'cyan', 'WHO USES WHAT');
    var tc = S.whoCard;
    ctx.text(920, 204, 'collective', { size: 11, font: 'mono', color: 'dim', parent: tc });
    ctx.text(1090, 204, 'bytes / GPU', { size: 11, font: 'mono', color: 'dim', parent: tc });
    ctx.text(1230, 204, 'used by', { size: 11, font: 'mono', color: 'dim', parent: tc });
    S.rowHi = ctx.rect(910, 236 - 17, 630, 34, { rx: 7, fill: ctx.alpha('amber', 0.12), stroke: ctx.alpha('amber', 0.9), sw: 1.4, parent: tc, opacity: 0 });
    S.whoRows = [['all-reduce', '2(n−1)/n·S', 'DP grads · TP activations'], ['reduce-scatter', '(n−1)/n·S', 'FSDP grads · Megatron-SP'], ['all-gather', '(n−1)/n·S', 'FSDP params · Megatron-SP'], ['all-to-all', '(n−1)/n·S', 'MoE dispatch/combine · Ulysses'], ['send / recv', 'S', 'PP activations · KV transfer'], ['broadcast', 'S', 'weights at model load']].map(function (rw, i) {
      var y = 236 + i * 38;
      var rg = ctx.group({ parent: tc });
      ctx.rect(914, y - 15, 622, 30, { rx: 6, fill: i % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.045)', parent: rg });
      ctx.text(920, y, rw[0], { size: 13, font: 'mono', weight: 700, color: 'white', parent: rg });
      ctx.text(1090, y, rw[1], { size: 13, font: 'mono', color: 'amber', parent: rg });
      ctx.text(1230, y, rw[2], { size: 13, font: 'mono', color: 'text', parent: rg });
      return rg;
    });
    S.ncclG = ctx.group({ parent: tc });
    ctx.text(920, 494, 'NCCL · what actually runs', { size: 12, font: 'mono', weight: 700, color: 'cyan', parent: S.ncclG, spacing: 1 });
    ctx.para(920, 526, [
      'picks algorithm × protocol per call, per size:',
      '· ring (bandwidth), tree (latency), NVLS (reduce',
      '  inside NVSwitch), CollNet / SHARP (in-network)',
      '· protocols Simple / LL / LL128: latency vs bandwidth',
      '· kernels occupy SMs → compute and comm contend;',
      '  overlap on separate streams, offload to NVLS',
      '· one-shot / symmetric-memory all-reduce for tiny',
      '  decode messages (latency-bound, ~µs)'
    ], { size: 13, color: 'text', lh: 38, pre: true, parent: S.ncclG });
  }

  /* ================================================================ 5 TENSOR PARALLEL */
  function buildTP(ctx, S, g) {
    S.tpTop = ctx.group({ parent: g });
    var T = S.tpTop;
    ctx.text(90, 176, 'MEGATRON TP · MLP:  Z = GeLU(X · A) · B  on 4 GPUs', { size: 14, font: 'mono', weight: 700, color: AX.TP, parent: T, spacing: 1 });
    ctx.text(150, 202, 'A · h × 4h → split by COLUMNS', { size: 12, font: 'mono', color: 'text', parent: T });
    ctx.matrix(150, 214, 4, 16, { cell: 20, gap: 3, values: function (r, c) { return ctx.alpha(RK[Math.floor(c / 4)], 0.3 + 0.4 * ((r * 7 + c * 3) % 5) / 4); }, parent: T });
    ctx.text(670, 224, 'B · 4h × h', { size: 12, font: 'mono', color: 'text', parent: T });
    ctx.text(670, 244, '→ split by ROWS', { size: 12, font: 'mono', color: 'text', parent: T });
    ctx.matrix(620, 176, 16, 4, { cell: 8, gap: 2, values: function (r, c) { return ctx.alpha(RK[Math.floor(r / 4)], 0.3 + 0.4 * ((r * 3 + c * 5) % 5) / 4); }, parent: T });
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
      L.dot2 = ctx.text(432, cy, '·', { size: 18, color: 'white', anchor: 'middle', parent: g });
      L.B = ctx.group({ parent: g });
      ctx.matrix(444, y0, 4, 4, { cell: 12, gap: 2, values: function (r, c) { return ctx.alpha(RK[i], 0.3 + 0.4 * (((r + 4 * i) * 3 + c * 5) % 5) / 4); }, parent: L.B });
      L.eqT = ctx.text(512, cy, '=', { size: 16, color: 'white', anchor: 'middle', parent: g });
      L.Z = ctx.matrix(525, y0, 4, 4, { cell: 12, gap: 2, values: function (r, c) { return ctx.mix(RK[i], '#1a2233', 0.45 + 0.1 * ((r + c) % 3)); }, parent: g });
      L.zl = ctx.text(552, cy + 38, 'Z' + i + ' partial', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
      L.link = ctx.link({ x: 584, y: cy }, { x: 622, y: cy }, { color: AX.TP, parent: g, straight: true });
      L.cy = cy;
      S.lanes.push(L);
    }
    ctx.text(165, 360, 'X (replicated)', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    ctx.text(237, 360, 'Aᵢ', { size: 12, font: 'mono', weight: 700, color: 'text', anchor: 'middle', parent: g });
    S.hdrY = ctx.text(392, 360, 'Yᵢ', { size: 12, font: 'mono', weight: 700, color: 'text', anchor: 'middle', parent: g });
    ctx.text(471, 360, 'Bᵢ', { size: 12, font: 'mono', weight: 700, color: 'text', anchor: 'middle', parent: g });
    S.arBar = ctx.group({ parent: g });
    ctx.rect(624, 372, 40, 346, { rx: 8, fill: ctx.alpha(AX.TP, 0.14), stroke: AX.TP, sw: 1.4, parent: S.arBar });
    var at = ctx.text(644, 545, 'ALL-REDUCE  Σ Zᵢ  (NVLink)', { size: 13, font: 'mono', weight: 700, color: AX.TP, anchor: 'middle', parent: S.arBar });
    at.setAttribute('transform', 'rotate(-90 644 545)');
    S.zOut = ctx.group({ parent: g });
    ctx.matrix(700, 515, 4, 4, { cell: 14, gap: 2, values: function (r, c) { return ctx.alpha('white', 0.35 + 0.15 * ((r + c) % 3)); }, parent: S.zOut });
    ctx.text(731, 594, 'Z on every GPU', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: S.zOut });
    S.zLink = ctx.link({ x: 666, y: 545 }, { x: 696, y: 545 }, { color: AX.TP, parent: g, straight: true });
    S.tpPara = ctx.para(80, 770, [
      'attention: Q,K,V column-parallel by head (64 heads → 16 per GPU),',
      'output projection row-parallel → 1 all-reduce; MLP → 1 all-reduce',
      'fwd 2 all-reduces / layer, bwd 2 more. Megatron-SP turns each into',
      'reduce-scatter + all-gather and shards LayerNorm / dropout acts.'
    ], { size: 13, font: 'mono', color: 'text', lh: 24, parent: g });

    S.tpCard = card(ctx, g, 900, 160, 650, 110, 'amber', 'WHY ONE ALL-REDUCE IS ENOUGH');
    var mc = S.tpCard;
    S.tpEq = ctx.para(920, 212, [
      'A = [A₁ A₂ A₃ A₄]              column split',
      'B = [B₁; B₂; B₃; B₄]           row split',
      'Yᵢ = GeLU(X·Aᵢ)                no comm: GeLU is',
      '                               elementwise per column',
      'Zᵢ = Yᵢ·Bᵢ                     partial sum, full shape',
      'Z = Σᵢ Zᵢ                      one all-reduce',
      '(split A by rows instead and GeLU(ΣXᵢAᵢ) ≠ ΣGeLU(XᵢAᵢ)',
      ' would force a sync before the nonlinearity)'
    ], { size: 13, color: 'text', lh: 25, pre: true, parent: mc });
    S.tpCost = ctx.group({ parent: mc });
    ctx.text(920, 452, 'COST · 70B (h = 8,192, 80 layers), TP = 8', { size: 12, font: 'mono', weight: 700, color: 'amber', parent: S.tpCost, spacing: 1 });
    ctx.para(920, 484, [
      'prefill 8k tokens: S = 8,192·8,192·2 B = 134 MB',
      '  ring AR on NVLink4: 2·7/8·134 MB ÷ 450 GB/s',
      '  = 0.52 ms × 2 per layer × 80 = 83 ms',
      '  vs ≈ 240 ms of math → overlap or it hurts',
      '  over IB (50 GB/s): 750 ms → TP never leaves',
      '  the NVLink domain',
      'decode 64 tokens: S = 1 MB → pure latency (α)',
      '  → NVLS / one-shot all-reduce kernels'
    ], { size: 13, color: 'text', lh: 25, pre: true, parent: S.tpCost });
    S.tpBarG = ctx.group({ parent: mc });
    ctx.text(920, 712, 'PER LAYER · ms per GPU (prefill 8k, TP 8)', { size: 12, font: 'mono', weight: 700, color: 'amber', parent: S.tpBarG, spacing: 1 });
    S.tpBars = [];
    [['math (GEMM + attn)', 3.0, 'amber'], ['2 × AR, NVLink4', 1.04, 'cyan'], ['2 × AR, IB NDR', 9.4, 'red']].forEach(function (b, i) {
      var y = 744 + i * 36;
      ctx.text(920, y, b[0], { size: 12, font: 'mono', color: 'text', parent: S.tpBarG });
      var w = b[1] / 9.4 * 300;
      var r = ctx.rect(1110, y - 10, w, 20, { rx: 3, fill: ctx.alpha(b[2], 0.55), stroke: b[2], sw: 1, parent: S.tpBarG });
      r.full = w;
      r.lab = ctx.text(1110 + w + 10, y, b[1] + ' ms', { size: 12, font: 'mono', weight: 700, color: b[2], parent: S.tpBarG });
      S.tpBars.push(r);
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
    S.stageG = ctx.group({ parent: g });
    S.stages = [];
    for (var s = 0; s < 4; s++) {
      S.stages.push(ctx.node({ x: 180 + s * 190, y: 232, w: 160, h: 54, title: 'stage ' + s + ' · GPU ' + s, sub: 'layers ' + (s * 20) + '–' + (s * 20 + 19), titleSize: 13, subSize: 11, color: RK[s], parent: S.stageG }));
    }
    S.ppLinks = [];
    for (s = 0; s < 3; s++) S.ppLinks.push(ctx.link(S.stages[s], S.stages[s + 1], { color: AX.PP, parent: S.stageG }));
    S.gp = pipeSim('gpipe', 4, 8);
    S.ob = pipeSim('1f1b', 4, 8);
    S.gpG = ctx.group({ parent: g });
    S.gpCells = drawSched(ctx, S.gpG, 150, 336, S.gp, 'GPipe · all F, then all B', 'cyan');
    ctx.text(150 + 22 * 29 + 10, 336 + 58, 'bubble', { size: 12, font: 'mono', color: 'red', parent: S.gpG });
    S.gpBub = ctx.text(150 + 22 * 29 + 10, 336 + 76, '27%', { size: 16, font: 'display', weight: 700, color: 'red', parent: S.gpG });
    S.legG = ctx.group({ parent: g });
    [['forward of micro-batch k', 'cyan'], ['backward of micro-batch k', 'orange'], ['idle = bubble', 'faint']].forEach(function (L, i) {
      ctx.rect(150 + i * 230, 660, 14, 14, { rx: 2, fill: L[1] === 'faint' ? 'rgba(255,255,255,0.08)' : ctx.alpha(L[1], 0.7), parent: S.legG });
      ctx.text(172 + i * 230, 668, L[0], { size: 12, font: 'mono', color: 'text', parent: S.legG });
    });
    S.obG = ctx.group({ parent: g });
    S.obCells = drawSched(ctx, S.obG, 150, 506, S.ob, '1F1B · one forward, one backward', 'lime');
    ctx.text(150 + 22 * 29 + 10, 506 + 58, 'bubble', { size: 12, font: 'mono', color: 'red', parent: S.obG });
    S.obBub = ctx.text(150 + 22 * 29 + 10, 506 + 76, '27%', { size: 16, font: 'display', weight: 700, color: 'red', parent: S.obG });
    S.memG = ctx.group({ parent: g });
    ctx.text(80, 716, 'ACTIVATION MEMORY · micro-batches held by stage 0', { size: 12, font: 'mono', weight: 700, color: 'text', parent: S.memG, spacing: 1 });
    ctx.text(90, 752, 'GPipe', { size: 12, font: 'mono', color: 'cyan', parent: S.memG });
    S.memA = ctx.rect(170, 742, 8 * 50, 20, { rx: 3, fill: ctx.alpha('cyan', 0.55), stroke: 'cyan', sw: 1, parent: S.memG });
    S.memA.full = 400;
    S.memA.lab = ctx.text(580, 752, 'm = 8', { size: 13, font: 'mono', weight: 700, color: 'cyan', parent: S.memG });
    ctx.text(90, 790, '1F1B', { size: 12, font: 'mono', color: 'lime', parent: S.memG });
    S.memB = ctx.rect(170, 780, 4 * 50, 20, { rx: 3, fill: ctx.alpha('lime', 0.55), stroke: 'lime', sw: 1, parent: S.memG });
    S.memB.full = 200;
    S.memB.lab = ctx.text(380, 790, '≤ p = 4', { size: 13, font: 'mono', weight: 700, color: 'lime', parent: S.memG });
    S.memNote = ctx.text(90, 834, 'same bubble, half the stashed activations → 1F1B is the default', { size: 12, font: 'mono', color: 'dim', parent: S.memG });

    S.ppCard = card(ctx, g, 900, 160, 650, 220, 'lime', 'BUBBLES, SCHEDULES, PLACEMENT');
    var mc = S.ppCard;
    var pp = { size: 13, color: 'text', lh: 30, pre: true, parent: mc };
    S.ppA = ctx.para(920, 214, [
      'bubble fraction = (p − 1) / (m + p − 1)',
      '  p = 4, m = 8   → 3/11 = 27%',
      '  p = 4, m = 32  → 3/35 ≈ 8.6%',
      'more micro-batches shrink the bubble but',
      'grow the global batch (or shrink per-µbatch)'
    ], pp);
    S.ppB = ctx.para(920, 400, [
      '1F1B (PipeDream-Flush): after a warm-up of',
      '  p−1−s forwards, stage s alternates F and B:',
      '  ≤ p micro-batches of activations alive, not m'
    ], pp);
    S.ppC = ctx.para(920, 524, [
      'interleaved 1F1B (v chunks per GPU):',
      '  bubble ÷ v, at v× more p2p messages',
      'zero-bubble (ZB-H1/H2): split B into input-grad',
      '  and weight-grad; W fills the idle slots',
      'DualPipe (DeepSeek-V3): two directions, overlaps',
      '  all-to-all comm with compute of the other'
    ], pp);
    S.ppD = ctx.para(920, 734, [
      'traffic = one activation tensor per micro-batch',
      '  per boundary (b·s·h·2 B): cheap → cross nodes',
      'serving: PP adds a hop per token but lets a',
      '  405B model span 2 nodes (TP 8 × PP 2)'
    ], pp);
  }

  function paintSched(ctx, cells, upto) {
    cells.forEach(function (c) { c.setAttribute('opacity', c.slot < upto ? 1 : 0.08); });
  }

  /* ================================================================ 7 EXPERT PARALLEL */
  function buildEP(ctx, S, g) {
    ctx.text(90, 176, 'EXPERT PARALLEL · 8 experts on 4 GPUs, top-2 routing', { size: 14, font: 'mono', weight: 700, color: AX.EP, parent: g, spacing: 1 });
    var ys = [262, 402, 542, 682];
    S.tok = []; S.exp = []; S.routes = [];
    var r = ctx.rng(77);
    var load = [0, 0, 0, 0, 0, 0, 0, 0];
    S.meshG = ctx.group({ parent: g });
    S.tokG = ctx.group({ parent: g });
    S.expG = ctx.group({ parent: g });
    for (var i = 0; i < 4; i++) {
      ctx.rect(60, ys[i] - 55, 190, 110, { rx: 10, fill: 'rgba(14,10,22,0.92)', stroke: ctx.alpha('red', 0.6), parent: S.tokG });
      ctx.text(72, ys[i] - 36, 'GPU ' + i + ' · tokens', { size: 12, font: 'mono', weight: 700, color: 'red', parent: S.tokG });
      ctx.text(72, ys[i] + 38, 'router → top-2 experts', { size: 11, font: 'mono', color: 'dim', parent: S.tokG });
      ctx.rect(560, ys[i] - 55, 250, 110, { rx: 10, fill: 'rgba(14,10,22,0.92)', stroke: ctx.alpha('red', 0.6), parent: S.expG });
      ctx.text(572, ys[i] - 36, 'GPU ' + i + ' · experts', { size: 12, font: 'mono', weight: 700, color: 'red', parent: S.expG });
      for (var e = 0; e < 2; e++) {
        var id = i * 2 + e;
        S.exp.push(ctx.node({ x: 628 + e * 118, y: ys[i] + 10, w: 104, h: 48, title: 'E' + id, sub: 'SwiGLU FFN', titleSize: 14, subSize: 10, color: 'magenta', parent: S.expG }));
      }
    }
    for (i = 0; i < 4; i++) {
      for (var j = 0; j < 6; j++) {
        var tx = 84 + j * 28, ty = ys[i];
        var e1 = Math.floor(r() * 8), e2 = (e1 + 1 + Math.floor(r() * 7)) % 8;
        if (r() < 0.35) e1 = 2; /* a popular expert → imbalance */
        if (e2 === e1) e2 = (e1 + 3) % 8;
        load[e1]++; load[e2]++;
        var dot = ctx.circle(tx, ty, 9, { fill: ctx.alpha(RK[Math.floor(e1 / 2)], 0.85), stroke: 'white', sw: 1, parent: S.tokG });
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
    S.dispTxt = ctx.text(405, 206, 'dispatch all-to-all →', { size: 12, font: 'mono', color: AX.EP, anchor: 'middle', parent: g });
    S.combTxt = ctx.text(405, 752, '← combine all-to-all', { size: 12, font: 'mono', color: AX.EP, anchor: 'middle', parent: g });
    /* load bars */
    S.loadG = ctx.group({ parent: g });
    ctx.text(80, 790, 'tokens per expert', { size: 12, font: 'mono', color: 'text', parent: S.loadG });
    S.loadBars = [];
    var cap = 1.25 * 2 * 24 / 8;
    for (var k = 0; k < 8; k++) {
      var h = load[k] * 6;
      var over = load[k] > cap;
      var b = ctx.rect(300 + k * 62, 858 - h, 40, h, { rx: 3, fill: ctx.alpha(over ? 'red' : 'magenta', 0.6), stroke: over ? 'red' : 'magenta', sw: 1, parent: S.loadG });
      b.full = h;
      S.loadBars.push(b);
      ctx.text(320 + k * 62, 858 - h - 10, String(load[k]), { size: 11, font: 'mono', weight: 700, color: over ? 'red' : 'white', anchor: 'middle', parent: S.loadG });
      ctx.text(320 + k * 62, 872, 'E' + k, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.loadG });
    }
    S.capLine = ctx.line(290, 858 - cap * 6, 800, 858 - cap * 6, { color: 'amber', sw: 1.4, dash: '5 4', parent: S.loadG });
    ctx.text(80, 814, 'capacity C·k·T/E', { size: 11, font: 'mono', color: 'amber', parent: S.loadG });
    ctx.text(80, 834, '= 1.25·2·24/8 = 7.5', { size: 11, font: 'mono', color: 'amber', parent: S.loadG });

    S.moeCard = card(ctx, g, 900, 160, 650, 100, 'magenta', 'MIXTURE-OF-EXPERTS AT SCALE');
    var mc = S.moeCard;
    var mp = { size: 13, color: 'text', lh: 35, pre: true, parent: mc };
    S.moeA = ctx.para(920, 212, ['y = Σₑ gₑ(x) · FFNₑ(x),  e ∈ TopK(router(x))'], mp);
    S.moeA2 = ctx.para(920, 247, ['dispatch all-to-all → expert GEMMs → combine all-to-all'], mp);
    S.moeB = ctx.para(920, 306, [
      'balance: aux loss (Switch / GShard) or aux-loss-free',
      '  per-expert bias bₑ nudged by observed load;',
      '  overflow past capacity → dropped / re-routed'
    ], mp);
    S.moeC = ctx.para(920, 436, [
      'DeepSeek-V3: 256 routed + 1 shared expert / layer,',
      '  top-8; 671B params, 37B active per token',
      '  training: EP 64 over 8 nodes, node-limited routing',
      '  (each token reaches ≤ 4 nodes) caps IB traffic',
      'per token per layer (h = 7,168, k = 8):',
      '  dispatch FP8  8 · 7,168 · 1 B ≈ 57 KB',
      '  combine BF16  8 · 7,168 · 2 B ≈ 115 KB',
      'DeepEP: NVLink intra-node + RDMA inter-node kernels;',
      '  low-latency decode mode via IBGDA, few SMs',
      'serving on NVL72: wide EP over one NVLink domain,',
      '  attention in DP, experts spread across 72 GPUs'
    ], mp);
  }

  /* ================================================================ 8 SEQUENCE / CONTEXT PARALLEL */
  var SPOS = [[690, 272], [808, 390], [690, 508], [572, 390]];
  function buildSP(ctx, S, g) {
    /* the problem: one shot = 75,600 tokens; SP = 8 splits them (visible from the first beat, replaced by Ulysses later) */
    S.tokBar = ctx.group({ parent: g });
    ctx.text(90, 176, 'ONE FOX SHOT = 75,600 TOKENS · SEQUENCE PARALLEL SPLITS THEM', { size: 14, font: 'mono', weight: 700, color: AX.SP, parent: S.tokBar, spacing: 1 });
    S.tokSegs = [];
    for (var q = 0; q < 8; q++) {
      var sgp = ctx.group({ parent: S.tokBar });
      ctx.rect(100 + q * 88, 250, 80, 56, { rx: 6, fill: ctx.alpha(RK[q % 4], 0.5), stroke: RK[q % 4], sw: 1.2, parent: sgp });
      ctx.text(140 + q * 88, 278, '9,450', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: sgp });
      ctx.text(140 + q * 88, 326, 'GPU ' + q, { size: 12, font: 'mono', color: RK[q % 4], anchor: 'middle', parent: sgp });
      S.tokSegs.push(sgp);
    }
    ctx.text(100, 374, 'N = 21 × 45 × 80 = 75,600 latent tokens, d = 5,120, 40 layers', { size: 13, font: 'mono', color: 'text', parent: S.tokBar });
    ctx.text(100, 402, 'attention = 4·N²·d ≈ 117 TFLOP per layer: 69% of a forward pass', { size: 13, font: 'mono', color: 'amber', parent: S.tokBar });
    ctx.text(100, 430, 'one GPU is too slow for this: split the N tokens over P GPUs', { size: 13, font: 'mono', color: 'dim', parent: S.tokBar });
    /* the N x N attention score matrix: 8 query-row blocks, one per GPU; every row needs all keys */
    S.tokMat = ctx.group({ parent: S.tokBar });
    for (q = 0; q < 8; q++) {
      ctx.text(92, 488 + q * 42, 'GPU ' + q, { size: 11, font: 'mono', color: RK[q % 4], anchor: 'end', parent: S.tokMat });
      for (var w = 0; w < 8; w++) ctx.rect(100 + w * 42, 470 + q * 42, 38, 38, { rx: 4, fill: ctx.alpha(RK[q % 4], 0.3), stroke: ctx.alpha(RK[q % 4], 0.7), sw: 1, parent: S.tokMat });
    }
    ctx.text(100, 458, 'scores Q·Kᵀ: 8 × 8 blocks of the N × N matrix', { size: 12, font: 'mono', color: 'dim', parent: S.tokMat });
    ctx.para(470, 520, [
      'each GPU owns 1/8 of the query rows,',
      'but every row needs ALL the keys and values',
      '→ K,V blocks must travel between GPUs',
      'ring: point-to-point in P−1 steps',
      'Ulysses: two all-to-alls per layer'
    ], { size: 13, font: 'mono', color: 'text', lh: 30, parent: S.tokMat });

    /* ring attention */
    S.ringG = ctx.group({ parent: g });
    var R = S.ringG;
    ctx.text(90, 176, 'RING ATTENTION · sequence split into 4 Q / KV blocks', { size: 14, font: 'mono', weight: 700, color: AX.SP, parent: R, spacing: 1 });
    S.blk = [];
    for (var j = 0; j < 4; j++) ctx.text(210 + j * 86, 208, 'KV' + j, { size: 12, font: 'mono', weight: 700, color: RK[j], anchor: 'middle', parent: R });
    for (var i = 0; i < 4; i++) {
      ctx.text(160, 260 + i * 86, 'GPU ' + i + ' · Q' + i, { size: 12, font: 'mono', weight: 700, color: RK[i], anchor: 'end', parent: R });
      S.blk.push([]);
      for (j = 0; j < 4; j++) {
        var cg = cellG(ctx, R, 170 + j * 86, 220 + i * 86, 80, 'rgba(255,255,255,0.03)', '', 'white');
        cg.t.setAttribute('font-size', 13);
        S.blk[i].push(cg);
      }
    }
    ctx.text(340, 580, 'block (i, j) = softmax-partial of Qᵢ·K_jᵀ, merged online', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: R });
    /* ring of GPUs holding KV */
    S.sArcs = [];
    var mids = [[790, 290], [790, 490], [590, 490], [590, 290]];
    for (i = 0; i < 4; i++) {
      var a = SPOS[i], b = SPOS[(i + 1) % 4];
      S.sArcs.push(ctx.link({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, { color: ctx.alpha('white', 0.35), bend: { x: mids[i][0], y: mids[i][1] }, sw: 1.6, parent: R }));
    }
    S.sG = []; S.kvT = [];
    for (i = 0; i < 4; i++) {
      S.sG.push(ctx.circle(SPOS[i][0], SPOS[i][1], 34, { fill: 'rgba(14,10,22,0.95)', stroke: RK[i], sw: 2, parent: R }));
      ctx.text(SPOS[i][0], SPOS[i][1] - 10, 'GPU ' + i, { size: 12, font: 'mono', weight: 700, color: RK[i], anchor: 'middle', parent: R });
      S.kvT.push(ctx.text(SPOS[i][0], SPOS[i][1] + 10, 'KV' + i, { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: R }));
    }
    S.spStep = ctx.text(690, 390, 'step 0', { size: 14, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: R });
    S.mergeG = ctx.group({ parent: g });
    S.mergeT = ctx.label(690, 205, 'online softmax: merge (m, ℓ, O) per block', { color: 'violet', size: 12, parent: S.mergeG });

    /* Ulysses */
    S.ulyG = ctx.group({ parent: g });
    var U = S.ulyG;
    ctx.text(90, 616, 'DEEPSPEED-ULYSSES · all-to-all swaps the sharded axis', { size: 14, font: 'mono', weight: 700, color: AX.SP, parent: U, spacing: 1 });
    ctx.text(178, 644, 'heads →', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: U });
    S.u1 = []; S.u2 = [];
    for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) {
      S.u1.push(cellG(ctx, U, 100 + j * 40, 656 + i * 40, 36, ctx.alpha(RK[i], 0.7), null));
      var c2 = cellG(ctx, U, 400 + j * 40, 656 + i * 40, 36, ctx.alpha(RK[j], 0.7), null);
      c2.src = { x: 100 + j * 40, y: 656 + i * 40 };
      c2.dst = { x: 400 + j * 40, y: 656 + i * 40 };
      S.u2.push(c2);
    }
    ctx.text(90, 830, 'tokens ↓', { size: 11, font: 'mono', color: 'dim', parent: U });
    ctx.text(178, 830 + 18, '[N/P tokens, all H heads]', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: U });
    ctx.line(280, 734, 380, 734, { color: 'white', sw: 1.6, arrow: true, parent: U });
    ctx.text(330, 718, 'all-to-all', { size: 12, font: 'mono', color: AX.SP, anchor: 'middle', parent: U });
    ctx.text(478, 848, '[all N tokens, H/P heads]', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: U });
    ctx.para(590, 676, ['full attention over', 'all N tokens for its', 'H/P heads, then a', 'second all-to-all', 'restores the layout'], { size: 12, font: 'mono', color: 'text', lh: 22, parent: U });

    S.spCard = card(ctx, g, 900, 160, 650, 120, 'violet', 'FOX SHOT: 75,600 TOKENS ON 8 GPUs');
    var mc = S.spCard;
    var sp = { size: 13, color: 'text', lh: 32, pre: true, parent: mc };
    S.spA = ctx.para(920, 212, ['SP = 8 → 9,450 tokens (and their activations)', '  per GPU; Ulysses: 40 heads / 8 = 5 per GPU'], sp);
    S.spB = ctx.para(920, 300, ['RING / CONTEXT PARALLEL', '· P2P send K,V block to the next GPU, P−1 steps', '· comm of block t+1 hides under compute of t'], sp);
    S.spB2 = ctx.para(920, 414, ['· online softmax merges partial (m, ℓ, O) blocks:', '  the N × N score matrix is never materialized', '· degree not bounded by heads; causal masks need', '  zig-zag sharding for balance (Llama 3 CP)'], sp);
    S.spC = ctx.para(920, 568, ['ULYSSES', '· 4 all-to-alls per layer (Q, K, V in; O out)', '· per-GPU volume ∝ N·h / P: constant when N, P', '  grow together; needs P | #heads'], sp);
    S.spD = ctx.para(920, 722, ['USP (hybrid): Ulysses inside NVLink × ring across;', '  xDiT-style video serving adds CFG-parallel 2', '  (cond / uncond branches on separate GPU groups)'], sp);
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

  /* one ring step: circulate the K,V blocks once, then colour the blocks computed in step t */
  function ringStep(ctx, S, t) {
    paintRingAttn(ctx, S, t);
    if (t === 4) return ctx.wait(300);
    return Promise.all(S.sArcs.map(function (a, i) { return ctx.packet(a, { color: RK[(i - t + 1 + 8) % 4], dur: 900, r: 6, label: 'KV' + ((i - t + 1 + 8) % 4) }); }));
  }

  /* ================================================================ 9 MAPPING */
  function buildMap(ctx, S, g) {
    ctx.text(90, 176, '64 GPUs = 8 nodes × 8 · TP 8 × PP 4 × DP 2', { size: 14, font: 'mono', weight: 700, color: 'red', parent: g, spacing: 1 });
    S.nodeCols = []; S.mcell = []; S.nodeG = [];
    for (var n = 0; n < 8; n++) {
      var x = 150 + n * 80;
      var ng = ctx.group({ parent: g });
      S.nodeG.push(ng);
      ctx.text(x + 34, 212, 'node ' + n, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: ng });
      var col = ctx.rect(x, 222, 68, 500, { rx: 8, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('white', 0.2), sw: 1, parent: ng });
      S.nodeCols.push(col);
      S.mcell.push([]);
      for (var k = 0; k < 8; k++) {
        var st = n % 4;
        S.mcell[n].push(cellG(ctx, ng, x + 6, 230 + k * 61, 56, ctx.alpha(RK[st], 0.35), 'g' + k, 'white'));
      }
    }
    S.railLab = ctx.text(128, 474, 'rail k = row k', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    S.railLab.setAttribute('transform', 'rotate(-90 128 474)');
    S.braceG = ctx.group({ parent: g });
    [[0, 'DP replica 0'], [4, 'DP replica 1']].forEach(function (d) {
      var x0 = 150 + d[0] * 80, x1 = x0 + 3 * 80 + 68;
      ctx.path('M' + x0 + ',764 V774 H' + x1 + ' V764', { stroke: AX.DP, sw: 1.5, parent: S.braceG });
      ctx.text((x0 + x1) / 2, 790, d[1], { size: 12, font: 'mono', weight: 700, color: AX.DP, anchor: 'middle', parent: S.braceG });
    });
    S.stageLeg = ctx.group({ parent: g });
    for (var s = 0; s < 4; s++) {
      ctx.rect(150 + s * 160, 810, 14, 14, { rx: 2, fill: ctx.alpha(RK[s], 0.6), parent: S.stageLeg });
      ctx.text(170 + s * 160, 818, 'PP stage ' + s, { size: 12, font: 'mono', color: 'text', parent: S.stageLeg });
    }
    S.mapNote = ctx.text(150, 848, 'column = TP group (NVLink) · green arcs = PP send · cyan = DP on rail 3', { size: 12, font: 'mono', color: 'dim', parent: g });
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

    S.mapCard = card(ctx, g, 900, 160, 650, 120, 'red', 'PLACEMENT RULE AND REAL MAPPINGS (2024–2026)');
    var mc = S.mapCard;
    var mp = { size: 13, color: 'text', lh: 34, pre: true, parent: mc };
    S.mapRule = ctx.para(920, 212, ['rule: bandwidth demand TP > SP ≈ EP > PP > DP,', '  so map the innermost axis to the fastest link'], mp);
    /* placement rows, revealed one axis per beat and replaced by real systems in the last beat */
    S.mapRows = [
      ['TP', 'amber', 'inside one node', '2 all-reduces per layer, on the critical path', 'NVLink 4 · 450 GB/s'],
      ['SP · EP', 'violet', 'inside the NVLink domain', 'all-to-all or ring, every layer', 'NVLink · 450–900 GB/s'],
      ['PP', 'lime', 'node to node', 'one activation per micro-batch', 'InfiniBand · 50 GB/s'],
      ['DP', 'cyan', 'across the whole cluster', 'one all-reduce per step, over the rails', 'InfiniBand · 50 GB/s']
    ].map(function (r, i) {
      var y = 300 + i * 100, rg = ctx.group({ parent: mc });
      ctx.rect(914, y, 622, 84, { rx: 10, fill: 'rgba(255,255,255,0.025)', stroke: ctx.alpha(r[1], 0.55), parent: rg });
      ctx.label(950, y + 42, r[0], { color: r[1], size: 14, w: 76, parent: rg });
      ctx.text(1010, y + 30, r[2], { size: 15, font: 'mono', weight: 700, color: 'white', parent: rg });
      ctx.text(1010, y + 58, r[3], { size: 12, font: 'mono', color: 'dim', parent: rg });
      ctx.text(1524, y + 30, r[4], { size: 13, font: 'mono', weight: 700, color: r[1], anchor: 'end', parent: rg });
      return rg;
    });
    S.mapReal = ctx.para(920, 300, [
      'Llama 3 405B pretraining · 16,384 H100',
      '  TP 8 × CP 1 × PP 16 × DP 128  (8k seq)',
      '  long-context phase: CP 16 × DP 8',
      'DeepSeek-V3 · 2,048 H800',
      '  PP 16 × EP 64 (8 nodes) × ZeRO-1 DP, no TP'
    ], mp);
    S.mapFox = ctx.para(920, 500, [
      'THE FOX-TRAILER FLEET (serving)',
      '  planner LLM 70B: TP 8 per replica, DP replicas,',
      '    prefill / decode on separate pools',
      '  MoE agents on NVL72: wide EP 72 + DP attention',
      '  video DiT shot: Ulysses SP 8 × CFG-parallel 2',
      '    = 16 GPUs per shot, 6 shots in flight',
      '  VAE decode: spatial tiling, 1 GPU per tile'
    ], mp);
  }

  /* ---- small step helpers ---- */
  function memRow(ctx, S, i) {
    ctx.reveal(S.memRows[i], { from: 'left', dur: 300 });
    return grow(ctx, S.memBarRows[i], 500, 450, 150);
  }

  /* the highlight bar in the "who uses what" table jumps to a row */
  function moveHi(ctx, S, row) {
    var to = 236 + row * 38 - 17;
    if (parseFloat(S.rowHi.getAttribute('opacity')) < 0.05) { S.rowHi.setAttribute('y', to); return ctx.reveal(S.rowHi, { dur: 300 }); }
    return ctx.animate(S.rowHi, { y: [parseFloat(S.rowHi.getAttribute('y')), to] }, 400, 'out');
  }

  /* run a list of steps one after another, each returning a Promise */
  function seq(list, fn) {
    return list.reduce(function (p, item) { return p.then(function () { return fn(item); }); }, Promise.resolve());
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
        beats: [
          {
            say: 'A single GPU is not enough, for two reasons. The first is memory. A fourteen billion parameter video model fits in twenty eight gigabytes, but a seventy billion parameter language model needs one hundred forty gigabytes for its weights alone, and a batch of served sequences adds tens of gigabytes of KV cache.',
            card: { tag: 'NUMBERS', title: 'Serving overflows one GPU', stat: { v: '226 GB', l: '70B LLM serving 32 sequences of 8k tokens: 140 GB of weights + 86 GB of KV cache, against 80 GB of HBM' } },
            deep: '<p>Every parallelism strategy trades <b>memory and compute per GPU</b> for <b>communication</b>. The first pressure is capacity: a GPU has 80 GB (H100) to ~190 GB (B200) of HBM, and a model must fit its weights, its activations and, for serving, the KV cache.</p>' +
              '<div class="eq">KV cache (70B, GQA-8) = 2 · 80 · 8 · 128 · 2 B = 320 KB / token</div>' +
              '<p>32 concurrent 8k-token sequences therefore need ~86 GB of KV on top of 140 GB of weights: three H100s’ worth before any batching headroom. The 14B video DiT (28 GB in BF16) fits, but its activations at 75,600 tokens leave little room.</p>'
          },
          {
            say: 'Training is worse. With mixed precision and Adam, every parameter drags along about sixteen bytes: weights, gradients, a full precision master copy, and two optimizer moments. That is more than a terabyte for the same seventy billion parameters, before any activations.',
            card: { tag: 'NUMBERS', title: 'Training carries 16 bytes per parameter', stat: { v: '1,120 GB', l: 'to train a 70B model with mixed-precision Adam, before activations' },
              more: '<p>16 B = 2 (BF16 weight) + 2 (BF16 gradient) + 4 (FP32 master weight) + 4 (Adam first moment) + 4 (Adam second moment). ZeRO and FSDP, in the next step, shard exactly this state.</p>' },
            deep: '<div class="eq">train memory ≈ 16Ψ bytes (BF16 W, ∇ + FP32 master, m, v) + activations</div>' +
              '<p>For Ψ = 70 B that is 1,120 GB (bars: 140 GB weights, 140 GB gradients, 840 GB optimizer state), spread over at least 14 H100s before the first activation is stored. Activation memory scales with batch × sequence × layers; selective recomputation and sequence parallelism trade FLOPs and communication for it.</p>'
          },
          {
            say: 'The second reason is compute. One shot of the fox trailer costs about seven tenths of an exaflop: half an hour on a single H100, or three and a half minutes if eight GPUs scale perfectly.',
            card: { tag: 'NUMBERS', title: 'Half an hour on one GPU', stat: { v: '29 min', l: 'for one fox shot on one H100 (0.68 EFLOP at 40% MFU); 3.6 min if 8 GPUs scale perfectly' } },
            deep: '<p>The fox shot from the GPU chamber: N = 75,600 tokens, 14B parameters, 50 steps × 2 (CFG). One forward pass is 2·P·N + 4·N²·d·L ≈ 6.8 PFLOP, so</p>' +
              '<div class="eq">6.8 PFLOP × 100 forwards = 0.68 EFLOP  ·  ÷ (989 TFLOP/s × 40%) ≈ 1,719 s ≈ 29 min</div>' +
              '<p>Eight GPUs give 3.6 min only if communication is hidden. Perfect strong scaling is the goal, and every axis in this chamber is judged by how much of it survives its own communication cost.</p>'
          },
          {
            say: 'So we cut the model. There are five ways to cut it. Replicate the model and split the batch. Split every weight matrix across GPUs. Or split the stack of layers into stages.',
            card: { tag: 'TRADE-OFF', title: 'Every cut is paid for in bytes', body: 'Each axis shards something different and needs a different collective. Put the chattiest cut on the fastest link; that placement is the last step of this chamber.' },
            deep: '<p>Three cuts so far:</p>' +
              '<ul><li><b>DP</b> replicates the whole model and splits the batch: the only traffic is the gradient all-reduce, once per step.</li>' +
              '<li><b>TP</b> splits every weight matrix, so each layer needs an all-reduce of activations, on the critical path.</li>' +
              '<li><b>PP</b> assigns consecutive layers to different GPUs and sends one activation tensor per stage boundary.</li></ul>' +
              '<p>The coloured overlay on the model grid shows what each axis slices: the batch (stacked copies), the columns, or the layer rows.</p>'
          },
          {
            say: 'Split the experts of a mixture of experts model across GPUs, or split the token sequence itself. Each cut buys capacity or speed, and each one pays for it in communication, which is the subject of the rest of this chamber.',
            card: { tag: 'TRY IT', title: 'Click a cut to pin it', body: 'Click any row: copies for data, columns for tensor, layers for pipeline, odd layers for experts, token blocks for sequence. Otherwise the five cycle by themselves.' },
            deep: '<table><tr><th>Axis</th><th>Shards</th><th>Collective</th><th>Volume per step</th></tr>' +
              '<tr><td>DP</td><td>batch</td><td>all-reduce ∇</td><td>≈ 2Ψ elements sent per GPU per iteration (train)</td></tr>' +
              '<tr><td>TP</td><td>weight matrices</td><td>all-reduce acts</td><td>4 all-reduces of b·s·h per layer (fwd+bwd)</td></tr>' +
              '<tr><td>PP</td><td>layers</td><td>send/recv</td><td>b·s·h per stage boundary</td></tr>' +
              '<tr><td>EP</td><td>experts</td><td>all-to-all</td><td>2 × k·b·s·h per MoE layer</td></tr>' +
              '<tr><td>SP/CP</td><td>tokens</td><td>ring P2P or all-to-all</td><td>K,V or Q,K,V,O per layer</td></tr></table>' +
              '<p>Axes compose multiplicatively: #GPUs = DP × TP × PP × (CP), with EP usually folded into the DP ranks. EP and SP scale with sequence length and expert count rather than with parameters.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.loops = [];
          ctx.hud('70B serving: 226 GB vs 80 GB of HBM');
          return swapPage(ctx, S, function (g) {
            buildWhy(ctx, S, g);
            hide([S.modelG, S.memCard, S.fiveCard, S.foxUse, S.compTxt]);
            hide(S.memRows); hide(S.cutRows);
            S.memBarRows.forEach(function (bars) { zeroBars(bars); });
          }).then(function () {
            /* beat 0: the model does not fit: memory for weights and KV cache */
            ctx.reveal(S.modelG, { dur: 500 });
            return ctx.reveal(S.memCard, { from: 'left', dur: 500 }).then(function () { return memRow(ctx, S, 0); }).then(function () { return memRow(ctx, S, 1); }).then(function () {
              return ctx.pulse(S.memBarRows[1][1], { color: 'amber', dur: 700 });
            });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: training memory */
            ctx.hud('training: 16 B per parameter = 1,120 GB');
            return memRow(ctx, S, 2).then(function () { return ctx.pulse(S.memBarRows[2][2], { color: 'violet', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: compute, a wave of FLOPs through the model */
            ctx.hud('one fox shot: 0.68 EFLOP = 29 min on 1 H100');
            ctx.reveal(S.compTxt, { from: 'left' });
            return ctx.tween(1800, function (t) {
              S.cells.forEach(function (cell, idx) {
                var r = Math.floor(idx / 8);
                var p = ctx.clamp(t * 2 - r * 0.1, 0, 1);
                cell.setAttribute('fill', ctx.alpha('red', (r % 2 ? 0.28 : 0.2) + 0.55 * Math.sin(Math.PI * p)));
              });
            }, 'linear').then(function () { return ctx.pulse(S.compTxt, { color: 'amber', dur: 800 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: data, tensor and pipeline cuts */
            ctx.hud('5 cuts: DP · TP · PP · EP · SP');
            ctx.reveal(S.fiveCard, { from: 'up', dur: 500 });
            return ctx.wait(400).then(function () {
              return seq([0, 1, 2], function (i) {
                showAxis(ctx, S, i);
                ctx.reveal(S.cutRows[i], { from: 'right', dur: 400 });
                return ctx.wait(1300);
              });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: expert and sequence cuts, then the interactive cycle */
            fit(ctx, S.fiveCard, 370);
            return seq([3, 4], function (i) {
              showAxis(ctx, S, i);
              ctx.reveal(S.cutRows[i], { from: 'right', dur: 400 });
              return ctx.wait(1300);
            }).then(function () {
              ctx.reveal(S.foxUse, { from: 'up' });
              S.axisLoop = ctx.loop(function (t) { showAxis(ctx, S, Math.floor(t / 2.2) % 5); });
              S.loops.push(S.axisLoop);
              S.cutRows.forEach(function (rg, i) {
                rg.style.cursor = 'pointer';
                rg.addEventListener('click', function () { S.axisLoop.stop(); showAxis(ctx, S, i); });
              });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Data parallel & ZeRO',
        beats: [
          {
            say: 'Data parallelism is the simplest cut. Every GPU holds a full copy of the model and processes a different slice of the batch, so the four replicas can run the forward pass without talking to each other.',
            card: { tag: 'KEY IDEA', title: 'Copy the model, split the data', body: 'Four replicas, four batch shards: forward and backward are completely independent. Only the gradients ever need to meet.' },
            deep: '<p><b>DDP</b>: every rank holds the full W, draws its own micro-batch (its batch shard) and runs forward and backward independently. With global batch B and N ranks, each rank sees B/N samples, so activation memory per GPU falls as N grows while parameter memory does not.</p>' +
              '<p>Nothing is communicated during the forward pass. That is what makes DP the most scalable axis and the natural outermost one in the topology mapping at the end of this chamber.</p>'
          },
          {
            say: 'In training, each replica computes different gradients. After the backward pass an all-reduce averages them, and every replica takes the identical optimizer step, so the copies never drift apart.',
            card: { tag: 'HOW IT WORKS', title: 'One all-reduce per step', body: 'Gradient buckets are all-reduced while the backward pass is still running, so most of the communication hides under compute.' },
            deep: '<p><b>DDP</b>: each rank computes ∇W on its shard; bucketed all-reduces overlap with the backward pass (gradients of late layers are ready first). A ring all-reduce sends ≈ 2Ψ <i>elements</i> per GPU per step (reduce-scatter Ψ + all-gather Ψ), i.e. ≈ 4Ψ bytes for BF16 gradients.</p>' +
              '<div class="eq">W ← W − η · Adam( (1/N) Σ<sub>i</sub> ∇W<sub>i</sub> )</div>' +
              '<p>Because every rank applies the same update to the same starting weights, replicas stay bit-identical as long as the all-reduce is deterministic.</p>'
          },
          {
            say: 'For serving, data parallel just means more replicas behind the load balancer. There are no gradients to exchange, so throughput scales almost linearly, but the latency of any single request does not improve.',
            card: { tag: 'TRADE-OFF', title: 'Throughput scales, latency does not', body: 'Twice the replicas serve twice the requests, yet each request still runs on a single replica. Only TP, EP or SP can shorten one request.' },
            deep: '<p>Serving replicas are independent: the only coupling is the load balancer, which routes by prefix or KV-cache affinity so that a conversation returns to the replica already holding its context.</p>' +
              '<div class="note">For our serving fleet DP is trivially parallel: the LLM planner runs as many TP-8 replicas as traffic demands; the load balancer (prefix/KV-aware) is the only coupling.</div>'
          },
          {
            say: 'The catch is memory. Replicating everything costs sixteen bytes per parameter for weights, gradients, and Adam state, so a seven and a half billion parameter model needs one hundred twenty gigabytes on every single GPU.',
            card: { tag: 'NUMBERS', title: 'DDP replicates all model state', stat: { v: '120 GB', l: 'per GPU under plain DDP for a 7.5B-parameter model: 16 bytes × Ψ, on every one of 64 ranks' } },
            deep: '<p>Mixed-precision Adam keeps 2Ψ bytes of BF16 parameters, 2Ψ of BF16 gradients and KΨ of optimizer state with K = 12 (FP32 master copy, momentum, variance):</p>' +
              '<div class="eq">(2 + 2 + K)Ψ = 16Ψ = 16 × 7.5 B = 120 GB</div>' +
              '<p>DDP replicates all of it on every rank, so adding GPUs never reduces model-state memory: DP buys throughput, not capacity. That redundancy is exactly what ZeRO removes.</p>'
          },
          {
            say: 'ZeRO and FSDP shard those states across the replicas. Shard the optimizer first, then the gradients, then the parameters, and per GPU memory shrinks by up to the number of GPUs: under two gigabytes at sixty four ranks.',
            card: { tag: 'NUMBERS', title: 'Sharding removes the redundancy', stat: { v: '1.9 GB', l: 'per GPU with ZeRO-3 / FSDP at N = 64: 16Ψ / N, a 64× cut from 120 GB' },
              more: '<p>The price is communication. DDP moves ~2Ψ elements per GPU per step. ZeRO-3 all-gathers the parameters before the forward and again before the backward, then reduce-scatters the gradients: ~3Ψ, a 1.5× increase, hidden by prefetching the next layer’s all-gather under the current layer’s compute.</p>' },
            deep: '<p><b>ZeRO</b> (Rajbhandari et al.) removes redundancy stage by stage, for Ψ = 7.5B, N = 64, K = 12:</p>' +
              '<table><tr><th>Stage</th><th>Per-GPU memory</th><th>GB</th></tr>' +
              '<tr><td>DDP</td><td>(2 + 2 + K)Ψ</td><td>120</td></tr>' +
              '<tr><td>ZeRO-1 (P<sub>os</sub>)</td><td>4Ψ + KΨ/N</td><td>31.4</td></tr>' +
              '<tr><td>ZeRO-2 (+g)</td><td>2Ψ + (2+K)Ψ/N</td><td>16.6</td></tr>' +
              '<tr><td>ZeRO-3 / FSDP (+p)</td><td>(2+2+K)Ψ/N</td><td>1.9</td></tr></table>' +
              '<p>ZeRO-3 re-materializes each layer’s weights just in time (all-gather), then frees them; grads leave via reduce-scatter. Traffic rises from 2Ψ to ~3Ψ elements per GPU (1.5×) but model-state memory falls N-fold. <b>HSDP</b> shards inside a node and replicates across nodes so the all-gathers stay on NVLink.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('DP: every GPU holds a full copy of W');
          return swapPage(ctx, S, function (g) {
            buildDP(ctx, S, g);
            hide(S.repG); hide([S.redG, S.srvCard, S.zeroCard, S.stepT]);
            hide(S.zRows); hide([S.zHead, S.zLeg]);
            hide(kids(S.zLines));
            S.zBarRows.forEach(function (bars) { zeroBars(bars); });
          }).then(function () {
            /* beat 0: four replicas, four batch shards */
            return ctx.reveal(S.repG, { from: 'up', stagger: 120 }).then(function () {
              return Promise.all(S.dpIn.map(function (l, i) { return ctx.packet(l, { color: RK[i], dur: 700, r: 5 }); }));
            });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: different gradients, all-reduce, identical step */
            ctx.hud('all-reduce ∇W, then an identical optimizer step');
            ctx.reveal(S.redG, { dur: 300 });
            return ctx.tween(900, function (t) {
              S.grads.forEach(function (m, i) { m.set(function (r, c) { return ctx.cmap('diverge', S.gradVals[i][c] * t); }); });
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
              ctx.reveal(S.stepT, { from: 'up' });
              return ctx.pulse(S.band, { color: 'cyan', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: serving replicas */
            ctx.hud('serving: N replicas behind a load balancer');
            ctx.reveal(S.srvCard, { from: 'up', dur: 500 });
            return ctx.wait(500).then(function () {
              return Promise.all(S.reps.map(function (l, i) { return ctx.packet(l, { color: 'cyan', dur: 700 + i * 120, r: 4 }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: DDP memory bill */
            ctx.hud('DDP: 16Ψ bytes per GPU = 120 GB (Ψ = 7.5B)');
            ctx.reveal(S.zeroCard, { from: 'left', dur: 500 });
            ctx.reveal([S.zHead, S.zLeg], { from: 'up', delay: 300 });
            ctx.reveal(S.zRows[0], { from: 'left', delay: 500, dur: 300 });
            return grow(ctx, S.zBarRows[0], 600, 350, 700).then(function () { return ctx.pulse(S.zRows[0], { color: 'red', dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: ZeRO stages */
            ctx.hud('ZeRO-3: 16Ψ / N = 1.9 GB per GPU at N = 64');
            fit(ctx, S.zeroCard, 700);
            return seq([1, 2, 3], function (i) {
              ctx.reveal(S.zRows[i], { from: 'left', dur: 300 });
              return grow(ctx, S.zBarRows[i], 450, 250, 100).then(function () { return ctx.wait(150); });
            }).then(function () { return ctx.reveal(kids(S.zLines), { from: 'left', stagger: 200 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Ring all-reduce',
        beats: [
          {
            say: 'How does an all-reduce actually move bytes? The classic answer is the ring. Arrange the GPUs in a circle and split each gradient into as many chunks as there are GPUs. Each cell here is one chunk, and its digit counts how many GPUs have been added into it.',
            card: { tag: 'KEY IDEA', title: 'n GPUs, n chunks', body: 'Cut the message into n equal chunks. Each GPU sends to its right neighbour and receives from its left, so every link carries exactly one chunk at a time.' },
            deep: '<p>Ring all-reduce (Patarasuk &amp; Yuan) is <b>bandwidth-optimal</b>: to end with Σ everywhere, each GPU must receive at least (n−1)/n·S for the reduction and send (n−1)/n·S of finished data, so 2(n−1)/n·S is a lower bound, and the ring meets it.</p>' +
              '<p>Rank r talks only to r±1 on a logical ring laid over the physical topology; NCCL builds several rings (channels) in parallel so that all NVLink or NIC ports stay busy. The four coloured cells inside each GPU are its four chunks.</p>'
          },
          {
            say: 'In the reduce scatter phase, every GPU passes one chunk to its neighbour, which adds it to its own copy. After n minus one steps, each GPU owns one chunk that is the sum over all GPUs.',
            card: { tag: 'HOW IT WORKS', title: 'Reduce-scatter: n−1 hops', body: 'At every step each GPU forwards one partial chunk and adds the one it receives. After three steps every chunk has visited all four GPUs.' },
            deep: '<pre># reduce-scatter\nfor s in range(n-1):\n  send(chunk[(r-s)%n], r+1)\n  chunk[(r-s-1)%n] += recv(r-1)</pre>' +
              '<p>After step s a chunk has accumulated s+2 contributions, so after n−1 steps chunk (r+1) mod n on GPU r is complete. The animation is driven by exactly these index formulas, and the digit in each cell is the number of contributions summed so far.</p>'
          },
          {
            say: 'In the all gather phase the finished chunks travel around the ring once more, overwriting the partial ones, until every GPU holds every fully summed chunk.',
            card: { tag: 'HOW IT WORKS', title: 'All-gather: broadcast the sums', body: 'Another n−1 hops, but now the data is only copied, never added. Every cell turns into a fully summed chunk marked Σ.' },
            deep: '<pre># all-gather\nfor s in range(n-1):\n  send(chunk[(r+1-s)%n], r+1)\n  chunk[(r-s)%n] = recv(r-1)</pre>' +
              '<p>The all-gather half reuses the same links in the same direction. Together the two phases send 2(n−1) chunks of S/n bytes per GPU, which is where the factor 2(n−1)/n in the cost comes from.</p>'
          },
          {
            say: 'Every link is busy at every step, and each GPU sends only about twice the message size, no matter how many GPUs join. That is why the ring is bandwidth optimal, and why its cost is set by the slowest link.',
            card: { tag: 'NUMBERS', title: 'Cheap on NVLink, dear on the NIC', stat: { v: '54 ms', l: 'ring all-reduce of 14 GB of BF16 gradients on 8 GPUs over NVLink 4 (450 GB/s per direction)' },
              more: '<p>2(n−1)/n · S ÷ B = 2 · 7/8 · 14 GB ÷ 450 GB/s ≈ 54 ms. The same message over 512 GPUs and a 50 GB/s NIC costs 2 · 511/512 · 14 GB ÷ 50 GB/s ≈ 0.56 s: the bandwidth term barely grows with n, but the α term does.</p>' },
            deep: '<div class="eq">T<sub>ring</sub> = 2(n−1)·α + 2·(n−1)/n · S/B</div>' +
              '<details><summary>Go deeper</summary><p>Each of the 2(n−1) steps sends S/n bytes over a link of bandwidth B and pays a latency α, so T = 2(n−1)(α + S/(nB)) = 2(n−1)α + 2(n−1)/n · S/B. The bandwidth term tends to 2S/B; the latency term grows linearly in n.</p></details>' +
              '<p>Because the latency term grows with n, NCCL uses <b>double binary trees</b> for small messages, in-switch reduction (<b>NVLS</b>, <b>SHARP</b>) to halve the bytes each GPU pushes, and <b>hierarchical</b> all-reduces at cluster scale: reduce-scatter over NVLink, all-reduce the 1/8-size shards across rails, all-gather over NVLink.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('a ring of n GPUs, message cut into n chunks');
          return swapPage(ctx, S, function (g) {
            buildRing(ctx, S, g);
            hide(S.arcs); hide(S.gpuG); hide([S.phaseG, S.arCard]);
            hide([S.arRS, S.arAG, S.arT, S.arEx, S.phLab, S.arLegend]); hide(S.phChips);
          }).then(function () {
            /* beat 0: the ring and its chunks */
            ctx.reveal(S.arCard, { from: 'left', dur: 500 });
            ctx.reveal(S.gpuG, { from: 'scale', s0: 0.85, stagger: 120 });
            ctx.reveal(S.arcs, { from: 'draw', stagger: 150, delay: 300, dur: 500 });
            ctx.reveal(S.phaseG, { delay: 700 });
            return ctx.wait(1300).then(function () { return ctx.pulse(S.rgpu[0], { color: 'white', dur: 700 }); });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: reduce-scatter, three hops */
            ctx.hud('reduce-scatter: n−1 hops of S/n bytes');
            fit(ctx, S.arCard, 230);
            ctx.reveal(S.arRS, { from: 'left', delay: 300 });
            ctx.reveal(S.phLab, { delay: 200 });
            ctx.reveal(S.phChips, { opacity: 0.35, from: 'up', stagger: 60, delay: 200 });
            return ctx.wait(500).then(function () { return seq([0, 1, 2], function (ph) { return ringPhase(ctx, S, ph); }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: all-gather, three hops */
            ctx.hud('all-gather: n−1 hops, every GPU gets every Σ');
            fit(ctx, S.arCard, 262);
            ctx.reveal(S.arAG, { from: 'left', delay: 200 });
            return seq([3, 4, 5], function (ph) { return ringPhase(ctx, S, ph); }).then(function () {
              S.phaseT.textContent = 'all-reduced';
              S.phaseS.textContent = 'Σ of all 4 on every GPU';
              return Promise.all(S.rgpu.map(function (n) { return ctx.pulse(n, { color: 'lime', dur: 700 }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the cost */
            ctx.hud('per GPU: 2(n−1)/n · S bytes, bandwidth-optimal');
            fit(ctx, S.arCard, 700);
            ctx.reveal(S.arT, { from: 'left', delay: 300 });
            ctx.reveal(S.arEx, { from: 'up', delay: 700 });
            ctx.reveal(S.arLegend, { from: 'left', delay: 1100 });
            return ctx.wait(1300).then(function () { return ctx.pulse(kids(S.arT)[0], { color: 'cyan', dur: 800 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'The collectives',
        beats: [
          {
            say: 'All distributed training and serving is built from a handful of collectives, communication patterns that every GPU in a group joins at once. Four of them do almost all the work, and the table on the right lists what each costs in bytes per GPU.',
            card: { tag: 'KEY IDEA', title: 'A handful of primitives', body: 'Every parallel strategy reduces to a few group operations. Learn their byte counts and you can price any layout.' },
            deep: '<p>With n ranks and S bytes of logical data, the per-GPU send volumes are:</p>' +
              '<div class="eq">AG = RS = A2A = (n−1)/n · S   ·   AR = 2(n−1)/n · S</div>' +
              '<p>Each panel shows the state before and after one collective on four GPUs: rows are GPUs, columns are chunks. The table on the right maps each collective to the parallel strategy that uses it.</p>'
          },
          {
            say: 'All gather gives every GPU every shard. Fully sharded data parallel uses it to rebuild each layer’s weights just in time, and Megatron sequence parallelism uses it to restore full activations.',
            card: { tag: 'HOW IT WORKS', title: 'All-gather: shards to everyone', body: 'Start: GPU i holds chunk i. End: every GPU holds all chunks. Sends (n−1)/n of S per GPU, and no arithmetic is involved.' },
            deep: '<p><b>All-gather</b> is pure data movement: the output on every rank is the concatenation of all ranks’ inputs. It dominates FSDP forward passes (weights rebuilt layer by layer) and Megatron-SP (activations restored before each column-parallel GEMM).</p>' +
              '<p>On a ring it takes n−1 steps of S/n bytes; on NVSwitch it is one round of direct reads.</p>'
          },
          {
            say: 'Reduce scatter sums the contributions and leaves each GPU with one shard of the result. It is the mirror image of all gather, and sharded training uses it to deliver gradients.',
            card: { tag: 'HOW IT WORKS', title: 'Reduce-scatter: sum, then shard', body: 'Start: every GPU holds a full partial. End: GPU i holds chunk i summed over all GPUs. Same volume as all-gather.' },
            deep: '<p><b>Reduce-scatter</b> is the dual of all-gather: each rank contributes a full-size vector and receives one summed shard. FSDP and ZeRO use it for gradients (each rank only needs the shard it owns), and Megatron-SP replaces each tensor-parallel all-reduce with a reduce-scatter followed by an all-gather.</p>' +
              '<p>Because it performs arithmetic, it consumes SM cycles as well as link bandwidth.</p>'
          },
          {
            say: 'All to all is a distributed transpose: chunk i j travels from GPU i to GPU j. That is exactly how mixture of experts dispatches tokens, and how Ulysses swaps the sequence split for a head split.',
            card: { tag: 'KEY IDEA', title: 'All-to-all is a transpose', body: 'Cell (i, j) moves from row i to row j. Every pair of GPUs exchanges data, so it needs a full-bisection fabric.' },
            deep: '<p>But their <b>traffic patterns</b> differ: rings and trees only use neighbour links, while all-to-all needs every pair. It wants a full-bisection switch (NVSwitch, or a non-blocking fat-tree) and suffers most from congestion and stragglers. That is why MoE all-to-all is usually confined to an NVLink domain or to a few nodes (node-limited routing).</p>' +
              '<p>Volume is (n−1)/n·S per GPU, the same as all-gather, but every byte has a different destination.</p>'
          },
          {
            say: 'Chain a reduce scatter and an all gather and you get all reduce. NCCL implements all of these with rings, trees, and in-switch reductions, and picks the algorithm and protocol per call from the message size.',
            card: { tag: 'STATE OF THE ART', title: 'NCCL tunes every call', body: 'Algorithm (ring, tree, NVLS, CollNet) times protocol (Simple, LL, LL128) is chosen per message size from a latency and bandwidth model.' },
            deep: '<ul><li><b>NCCL</b> tunes (algorithm ∈ {ring, tree, NVLS, CollNet}) × (protocol ∈ {Simple, LL, LL128}) × channels per call from a cost model of α, β.</li>' +
              '<li>Collectives run as <b>kernels on SMs</b>: a TP all-reduce steals SMs from the GEMMs it should overlap with; Hopper/Blackwell mitigate with copy engines, NVLS offload and SM-light kernels (DeepEP uses ~20 SMs).</li>' +
              '<li>Tiny decode-time messages are latency-bound: one-shot all-reduce over symmetric memory (every GPU reads peers’ buffers via NVLink load/store) beats a ring.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('AG = RS = A2A = (n−1)/n·S · AR = 2(n−1)/n·S');
          return swapPage(ctx, S, function (g) {
            buildColl(ctx, S, g);
            hide(S.panels); hide(S.after); hide(S.a2a); hide(S.whoRows); hide([S.whoCard, S.ncclG]);
          }).then(function () {
            /* beat 0: four collectives, before states, and the cost table */
            ctx.reveal(S.panels, { from: 'up', stagger: 150 });
            ctx.reveal(S.whoCard, { from: 'left', delay: 300 });
            return ctx.reveal(S.whoRows, { from: 'left', stagger: 90, delay: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: all-gather */
            ctx.hud('all-gather: (n−1)/n · S bytes per GPU');
            moveHi(ctx, S, 2);
            return ctx.reveal(S.after[0], { from: 'left', dur: 600, delay: 200 }).then(function () { return ctx.pulse(S.panels[0], { color: 'cyan', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: reduce-scatter */
            ctx.hud('reduce-scatter: (n−1)/n · S bytes per GPU');
            moveHi(ctx, S, 1);
            return ctx.reveal(S.after[1], { from: 'left', dur: 600, delay: 200 }).then(function () { return ctx.pulse(S.panels[1], { color: 'cyan', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: all-to-all, the transpose */
            ctx.hud('all-to-all: cell (i,j) moves GPU i → GPU j');
            moveHi(ctx, S, 3);
            return Promise.all(S.a2a.map(function (cg, k) {
              cg.setAttribute('opacity', 1);
              return ctx.transform(cg, { x: cg.dst.x, y: cg.dst.y }, 1100, 'inOut', 300 + k * 60);
            }));
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: all-reduce = RS + AG, and what NCCL runs */
            ctx.hud('all-reduce = reduce-scatter + all-gather');
            moveHi(ctx, S, 0);
            fit(ctx, S.whoCard, 700);
            ctx.reveal(S.ncclG, { from: 'up', delay: 400 });
            return ctx.reveal(S.after[2], { from: 'left', dur: 600, delay: 200 }).then(function () { return ctx.pulse(S.panels[3], { color: 'cyan', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Tensor parallel',
        beats: [
          {
            say: 'Tensor parallelism splits every weight matrix across GPUs. Megatron’s trick for the MLP is to split the first matrix by columns and the second by rows, so each GPU keeps the full input and one slice of each matrix.',
            card: { tag: 'KEY IDEA', title: 'Columns first, rows second', body: 'A is cut into column blocks, B into row blocks. Each GPU holds the full input X, one Aᵢ and the matching Bᵢ.' },
            deep: '<p>For an MLP <code>Z = GeLU(XA)B</code> on t GPUs:</p>' +
              '<div class="eq">A = [A<sub>1</sub> … A<sub>t</sub>],  B = [B<sub>1</sub>; … ; B<sub>t</sub>]</div>' +
              '<p>Shapes per GPU (b·s tokens, hidden h): X is [b·s, h] and replicated; A<sub>i</sub> is [h, 4h/t]; B<sub>i</sub> is [4h/t, h]. The weights and the 4h-wide intermediate activation are both divided by t, which is where the memory saving comes from.</p>'
          },
          {
            say: 'Each GPU multiplies the full input by its column slice and applies GeLU locally. That is legal because the nonlinearity acts on each column independently, so no communication is needed yet.',
            card: { tag: 'PITFALL', title: 'Split A by columns, not rows', body: 'With a row split, GeLU of a sum is not the sum of GeLUs, so every GPU would have to synchronize before the nonlinearity.',
              more: '<p>Column split: GeLU(X·[A₁ … A_t]) = [GeLU(XA₁) … GeLU(XA_t)] because GeLU is elementwise. Row split: XA = Σᵢ XᵢAᵢ, and GeLU(Σᵢ XᵢAᵢ) ≠ Σᵢ GeLU(XᵢAᵢ), so an all-reduce would be needed first.</p>' },
            deep: '<div class="eq">Y<sub>i</sub> = GeLU(X A<sub>i</sub>)   with no communication</div>' +
              '<details><summary>Go deeper</summary><p>GeLU acts on each entry, so it commutes with a column partition: GeLU([XA<sub>1</sub>, …, XA<sub>t</sub>]) = [GeLU(XA<sub>1</sub>), …, GeLU(XA<sub>t</sub>)]. If instead A were split by rows, XA = Σ<sub>i</sub> X<sub>i</sub>A<sub>i</sub> and GeLU(Σ) ≠ ΣGeLU, forcing an all-reduce <i>before</i> the nonlinearity, a second synchronization per MLP.</p></details>' +
              '<p>Megatron wraps the block in conjugate operators: <i>f</i> (identity in the forward pass, all-reduce in the backward) before it and <i>g</i> (all-reduce forward, identity backward) after it.</p>'
          },
          {
            say: 'Then each GPU multiplies by its row slice of the second matrix. The result is a partial sum with the full output shape, holding just one quarter of the terms.',
            card: { tag: 'KEY IDEA', title: 'Partial sums, full shape', body: 'Every GPU now holds a complete-looking output Zᵢ, but it is only its own quarter of the sum over the 4h dimension.' },
            deep: '<div class="eq">Z<sub>i</sub> = Y<sub>i</sub> B<sub>i</sub>  ∈ ℝ<sup>b·s × h</sup>,   Z = Σ<sub>i</sub> Z<sub>i</sub></div>' +
              '<p>Each Z<sub>i</sub> is a rank-(4h/t) contribution to every output entry: dropping the sum would silently give wrong activations. The communication that repairs this has the size of one activation tensor, b·s·h, not the size of any weight matrix, which is why TP traffic scales with tokens rather than parameters.</p>'
          },
          {
            say: 'A single all reduce adds the four partial sums, and every GPU ends with the same output. That is one collective for the whole MLP block, and the next layer cannot start until it finishes.',
            card: { tag: 'HOW IT WORKS', title: 'One all-reduce, on the critical path', body: 'The sum over Zᵢ is a single all-reduce on NVLink. Unlike DP gradients it cannot overlap with anything: the next GEMM needs its result.' },
            deep: '<div class="eq">comm / layer (fwd) = 2 × AR(b·s·h) → 2 · 2(t−1)/t · b·s·h · 2 B</div>' +
              '<p>Unlike DP, this traffic is <b>synchronous</b>: the next GEMM waits for it, and it scales with tokens, not parameters. <b>Megatron-SP</b> replaces each all-reduce with reduce-scatter + all-gather (same bytes) and shards the LayerNorm and dropout activations along the sequence, cutting activation memory by t.</p>'
          },
          {
            say: 'Attention works the same way, with the heads split across GPUs. That makes two all reduces per layer in the forward pass, all on the critical path, so tensor parallelism must stay inside an NVLink domain.',
            card: { tag: 'NUMBERS', title: 'What TP costs a 70B prefill', stat: { v: '83 ms', l: 'of all-reduce time for an 8k-token prefill at TP 8 on NVLink 4, against ~750 ms over 50 GB/s InfiniBand' } },
            deep: '<p>Attention: Q, K, V projections are column-parallel by heads (each GPU runs h/t heads end-to-end), the output projection is row-parallel. Worked for a 70B model (h = 8,192, 80 layers, TP = 8) prefilling 8k tokens:</p>' +
              '<div class="eq">S = 8,192 · 8,192 · 2 B = 134 MB  →  2·7/8·134 MB ÷ 450 GB/s ≈ 0.52 ms per all-reduce</div>' +
              '<p>Two per layer × 80 layers ≈ 83 ms per prefill against ≈ 240 ms of math: worth overlapping. Over 50 GB/s InfiniBand the same traffic costs ≈ 750 ms, longer than the math, so TP never leaves the NVLink domain. For decode (64 tokens, 1 MB messages) the cost is pure latency, which NVLS and one-shot all-reduce kernels attack.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('TP: A by columns, B by rows → 1 all-reduce');
          return swapPage(ctx, S, function (g) {
            buildTP(ctx, S, g);
            var hideL = [];
            S.lanes.forEach(function (L) { hideL.push(L.Y, L.dot2, L.eqT, L.Z, L.gelu, L.zl, L.link); });
            hideL.push(S.zOut, S.zLink, S.arBar, S.hdrY, S.tpPara, S.tpCost, S.tpBarG);
            hide(hideL);
            hide(kids(S.tpEq).slice(2));
            zeroBars(S.tpBars);
          }).then(function () {
            /* beat 0: A split by columns, B by rows: slices fly to the GPUs */
            var flies = [];
            S.lanes.forEach(function (L, i) {
              flies.push(flyFrom(ctx, L.A, 150 + i * 92, 214, 89, 210, L.cy - 27, 54, 1000, i * 150));
              flies.push(flyFrom(ctx, L.B, 620, 176 + i * 40, 38, 444, L.cy - 27, 54, 1000, 500 + i * 150));
            });
            return Promise.all(flies);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: Y_i = GeLU(X A_i), local */
            ctx.hud('Y_i = GeLU(X·A_i): local, no communication');
            fit(ctx, S.tpCard, 170);
            ctx.reveal(kids(S.tpEq).slice(2, 4), { from: 'left', stagger: 150 });
            ctx.reveal(S.hdrY);
            ctx.fade(S.tpTop, 0.25, 500);
            return ctx.camera(420, 560, 1.45, 900).then(function () {
              return seq(S.lanes, function (L) { return ctx.reveal([L.gelu, L.Y], { from: 'left', stagger: 120, dur: 350 }); });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: Z_i = Y_i B_i, partial sums */
            ctx.hud('Z_i = Y_i·B_i: partial sums, full shape');
            fit(ctx, S.tpCard, 200);
            ctx.reveal(kids(S.tpEq)[4], { from: 'left' });
            return seq(S.lanes, function (L) {
              ctx.reveal([L.dot2, L.eqT], { from: 'left', stagger: 60, dur: 250 });
              return ctx.reveal([L.Z, L.zl], { from: 'left', delay: 200, stagger: 100, dur: 350 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: one all-reduce */
            ctx.hud('one all-reduce: Z = Σ Z_i on NVLink');
            fit(ctx, S.tpCard, 290);
            ctx.reveal(kids(S.tpEq).slice(5), { from: 'left', stagger: 150 });
            ctx.fade(S.tpTop, 1, 500);
            return ctx.camera(null, null, null, 700).then(function () {
              S.lanes.forEach(function (L) { ctx.reveal(L.link, { from: 'draw', dur: 300 }); });
              return Promise.all(S.lanes.map(function (L) { return ctx.packet(L.link, { color: 'amber', dur: 600, r: 5 }); }));
            }).then(function () {
              ctx.reveal(S.arBar, { dur: 300 });
              ctx.pulse(S.arBar, { color: 'amber', dur: 700 });
              ctx.reveal(S.zLink, { from: 'draw', dur: 300, delay: 200 });
              return ctx.reveal(S.zOut, { from: 'scale', dur: 600, delay: 300 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 3: attention too, and the price */
            ctx.hud('TP all-reduce: 83 ms on NVLink, 750 ms on IB');
            fit(ctx, S.tpCard, 700);
            ctx.reveal(S.tpPara, { from: 'up' });
            ctx.reveal(S.tpCost, { from: 'up', delay: 200 });
            ctx.reveal(S.tpBarG, { delay: 500 });
            return grow(ctx, S.tpBars, 800, 200, 600);
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Pipeline parallel',
        beats: [
          {
            say: 'Pipeline parallelism splits the layers into stages on different GPUs. Activations flow forward from stage to stage, and gradients flow backward, each hop a simple point to point send.',
            card: { tag: 'KEY IDEA', title: 'Layers split, activations flow', body: 'Stage s owns a contiguous block of layers. The forward pass sends one activation tensor to stage s+1; the backward pass sends its gradient back.' },
            deep: '<p>With p stages, GPU s holds layers [s·L/p, (s+1)·L/p). Memory for weights and optimizer state falls by p, and the only traffic is the activation tensor <code>[b, s, h]</code> at each stage boundary, forward, and its gradient, backward.</p>' +
              '<p>Unlike TP, a single micro-batch touches one stage at a time, so a naive pipeline keeps p−1 of p GPUs idle. The rest of this step is about not doing that.</p>'
          },
          {
            say: 'To keep every stage busy, the batch is cut into micro-batches. Even so, the pipeline must fill and drain, leaving idle bubbles. With four stages and eight micro-batches, twenty seven percent of the time is bubble.',
            card: { tag: 'NUMBERS', title: 'The pipeline bubble', stat: { v: '27%', l: 'of GPU time is idle with p = 4 stages and m = 8 micro-batches: (p − 1) / (m + p − 1) = 3/11' },
              more: '<p>With unit-time F and B, a stage does m forwards and m backwards, but the last stage cannot start before p−1 slots and the first cannot finish its backward until p−1 slots after. Total time 2(m + p − 1), useful work 2m, so the bubble is 2(p − 1) / 2(m + p − 1) = (p − 1)/(m + p − 1).</p>' },
            deep: '<div class="eq">bubble = (p − 1) / (m + p − 1)</div>' +
              '<p>With p stages and m micro-batches, and a backward pass as long as the forward. The animation is produced by a dependency simulator: F(k) at stage s waits for F(k) at s−1; B(k) at s waits for B(k) at s+1. <b>GPipe</b> runs all forwards, then all backwards: both schedules finish in 2(m+p−1) = 22 slots.</p>' +
              '<p>More micro-batches shrink the bubble (m = 32 gives 8.6%) but grow the global batch or shrink each micro-batch, which hurts GEMM efficiency.</p>'
          },
          {
            say: 'The one forward one backward schedule has the same bubble, but it starts backward passes early. A stage then holds at most four micro-batches of activations, instead of all eight.',
            card: { tag: 'TRADE-OFF', title: 'Same bubble, half the memory', body: '1F1B interleaves forward and backward passes, so stage 0 keeps at most p = 4 micro-batches of activations alive instead of m = 8.' },
            deep: '<p><b>1F1B</b> (PipeDream-Flush): after a warm-up of p−1−s forwards, stage s alternates one forward and one backward. Both schedules finish in 22 slots, but GPipe stashes activations for all m micro-batches while 1F1B caps them at p.</p>' +
              '<p>The bars show stage 0, which is the worst case: it holds m activations under GPipe and p under 1F1B. With m ≫ p (the usual setting to shrink the bubble) the saving is m/p, which is why 1F1B is the default in Megatron-LM.</p>'
          },
          {
            say: 'Interleaved stages, zero bubble schedules, and DeepSeek’s DualPipe squeeze the bubble further, trading it for more messages, a more complex schedule, or extra bookkeeping of weight gradients.',
            card: { tag: 'STATE OF THE ART', title: 'Squeezing the bubble', body: 'Interleaving divides it by v, zero-bubble schedules fill it with weight-gradient work, and DualPipe overlaps MoE all-to-all with compute.' },
            deep: '<ul><li><b>Interleaved 1F1B</b> (Megatron): v model chunks per GPU; bubble shrinks by v at the cost of v× more p2p messages.</li>' +
              '<li><b>Zero Bubble</b> (Qi et al., ICLR 2024): split B into B<sub>input</sub> (on the critical path) and W (weight-grad, deferrable) and schedule W into the bubbles.</li>' +
              '<li><b>DualPipe</b> (DeepSeek-V3): feeds micro-batches from both ends and overlaps the MoE all-to-all of one micro-batch with compute of another.</li></ul>' +
              '<p>Each trades the idle time for something else: message count, schedule complexity, or peak memory.</p>'
          },
          {
            say: 'Pipeline traffic is small: one activation tensor per micro-batch per stage boundary. That is why stages can sit on different nodes. For serving, the price is an extra hop of latency for every token.',
            card: { tag: 'NUMBERS', title: 'A cheap boundary', stat: { v: '67 MB', l: 'activation per micro-batch per stage boundary: 1 × 4,096 × 8,192 × 2 B, sent point to point' } },
            deep: '<p>Traffic is one b·s·h activation per boundary per micro-batch (e.g. 1 × 4,096 × 8,192 × 2 B = 64 MiB), point-to-point: the least bandwidth-hungry model-parallel axis, so PP is what crosses node and even rack boundaries and can be overlapped with compute.</p>' +
              '<p>For serving, PP raises throughput and lets a 405B model span two nodes (TP 8 × PP 2), but it adds a hop to each token’s latency, so latency-critical decode prefers TP and EP inside a single NVLink domain.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('PP: layers split into stages, one GPU each');
          return swapPage(ctx, S, function (g) {
            buildPP(ctx, S, g);
            hide([S.gpG, S.obG, S.legG, S.memG, S.ppCard, S.ppA, S.ppB, S.ppC, S.ppD]);
            hide(S.stages); hide(S.ppLinks);
            paintSched(ctx, S.gpCells, 0); paintSched(ctx, S.obCells, 0);
            zeroBars([S.memA, S.memB]);
          }).then(function () {
            /* beat 0: four stages, forward and backward sends */
            S.loops.push(ctx.loop(function (t) {
              var k = Math.floor(t * 1.5) % 3;
              S.ppLinks.forEach(function (l, i) { l.setAttribute('stroke-width', i === k ? 3.2 : 1.8); });
            }));
            return ctx.reveal(S.stages, { from: 'up', stagger: 120 }).then(function () {
              return ctx.reveal(S.ppLinks, { from: 'draw', stagger: 100, dur: 400 });
            }).then(function () {
              return Promise.all(S.ppLinks.map(function (l) { return ctx.packet(l, { color: 'lime', dur: 700, label: 'act' }); }));
            }).then(function () {
              return Promise.all(S.ppLinks.map(function (l) { return ctx.packet(l, { color: 'orange', dur: 700, reverse: true, label: 'grad' }); }));
            });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: micro-batches and the GPipe bubble */
            ctx.hud('bubble = (p−1)/(m+p−1) = 3/11 ≈ 27%');
            ctx.reveal([S.gpG, S.legG], { dur: 400 });
            ctx.reveal(S.ppCard, { from: 'left', dur: 500 });
            ctx.reveal(S.ppA, { from: 'up', delay: 300 });
            return ctx.tween(3600, function (t) { paintSched(ctx, S.gpCells, Math.round(t * 22)); }, 'linear').then(function () {
              return ctx.pulse(S.gpBub, { color: 'red', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: 1F1B, same bubble, less memory */
            ctx.hud('1F1B: same 27% bubble, at most p stashed');
            fit(ctx, S.ppCard, 330);
            ctx.reveal(S.obG, { dur: 400 });
            ctx.reveal(S.ppB, { from: 'up', delay: 300 });
            ctx.reveal(S.memG, { from: 'up', delay: 400 });
            return Promise.all([
              ctx.tween(3600, function (t) { paintSched(ctx, S.obCells, Math.round(t * 22)); }, 'linear'),
              grow(ctx, [S.memA, S.memB], 900, 250, 1200)
            ]).then(function () { return ctx.pulse(S.memB, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: interleaving, zero bubble, DualPipe */
            ctx.hud('interleaved · zero-bubble · DualPipe');
            fit(ctx, S.ppCard, 555);
            return ctx.reveal(S.ppC, { from: 'up', dur: 600 }).then(function () { return ctx.pulse(S.ppC, { color: 'lime', dur: 800 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: cheap traffic, cross-node */
            ctx.hud('PP boundary: 1 activation tensor per micro-batch');
            fit(ctx, S.ppCard, 700);
            ctx.reveal(S.ppD, { from: 'up', dur: 600 });
            return Promise.all(S.ppLinks.map(function (l, i) { return ctx.wait(i * 200).then(function () { return ctx.packet(l, { color: 'lime', dur: 800, label: '67 MB' }); }); }));
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Expert parallel',
        beats: [
          {
            say: 'Mixture of experts models replace each feed forward layer with many experts, and a router sends every token to only its top few. Parameters grow with the number of experts, but the work per token does not.',
            card: { tag: 'KEY IDEA', title: 'Sparse experts, dense parameters', body: 'A router activates k of E experts per token, so capacity grows without FLOPs growing. The experts are what we spread over GPUs.' },
            deep: '<div class="eq">y = Σ<sub>e ∈ TopK(s(x))</sub> g<sub>e</sub>(x) · FFN<sub>e</sub>(x),   s(x) = softmax(x·W<sub>g</sub>) or sigmoid</div>' +
              '<p>Each dot on the left is a token; the router picks two of eight experts for it (the coloured mesh). Eight experts, two per GPU, is a toy version of what production models do with 64 to 256 experts per layer.</p>'
          },
          {
            say: 'Expert parallelism places different experts on different GPUs. Every MoE layer then needs two all to all exchanges. The first, dispatch, ships each token to the GPUs hosting its chosen experts.',
            card: { tag: 'HOW IT WORKS', title: 'Dispatch: tokens travel to experts', body: 'Each token is copied to the GPUs hosting its top-k experts: one all-to-all, with traffic proportional to k times the hidden size.' },
            deep: '<p>Per MoE layer, each token of hidden size h crosses the fabric 2k times: k copies out (dispatch) and k back (combine). Dispatch permutes tokens by expert id so that each GPU receives a contiguous batch for its local experts; the send volume per GPU is roughly k·(tokens per GPU)·h·bytes.</p>' +
              '<p>Because destinations depend on the data, the exchange is an <i>irregular</i> all-to-all: message sizes differ from step to step, unlike the fixed-size collectives of DP or TP.</p>'
          },
          {
            say: 'The experts run their feed forward networks locally. The second exchange, combine, brings the results back to each token’s home GPU, where they are summed with the router weights.',
            card: { tag: 'HOW IT WORKS', title: 'Combine: results travel home', body: 'Expert outputs return by a second all-to-all and are summed with the router weights. Two all-to-alls per layer, both on the critical path.' },
            deep: '<p>The expert GEMMs are grouped by expert (a grouped GEMM over the tokens routed to each local expert). After them, the combine all-to-all returns each token’s k outputs, which are weighted by the gate values g<sub>e</sub>(x) and added.</p>' +
              '<p>Systems hide the two all-to-alls by splitting the batch into two micro-batches and overlapping one’s communication with the other’s compute (DualPipe, DeepEP-based overlap): the layer is communication-bound unless this overlap works.</p>'
          },
          {
            say: 'Routing is data dependent, so some experts get hot while others idle, and the busiest expert sets the layer’s latency. Capacity limits and load balancing keep the traffic even.',
            card: { tag: 'PITFALL', title: 'One hot expert stalls the layer', body: 'The busiest expert decides when the layer finishes. Here E2 exceeds the capacity C = 7.5 tokens; overflow is dropped or rerouted.',
              more: '<p>GShard and Switch add an auxiliary loss α·E·Σₑ fₑPₑ, where fₑ is the fraction of tokens sent to expert e and Pₑ its mean router probability; it is minimized when both are uniform. DeepSeek-V3 drops it: a per-expert bias bₑ is added to the routing scores only for selection and nudged up or down after each step according to observed load, so balance is enforced without gradient interference.</p>' },
            deep: '<ul><li><b>Load balance</b>: GShard/Switch add an auxiliary loss α·E·Σ f<sub>e</sub>P<sub>e</sub>; DeepSeek-V3 instead adds a per-expert bias b<sub>e</sub> to routing scores only, nudged up or down by observed load (aux-loss-free).</li>' +
              '<li><b>Capacity</b> = C·k·T/E tokens per expert; overflow is dropped (training) or rerouted. The chart shows one hot expert (E2) blowing past C = 1.25 (dashed line at 7.5 tokens).</li></ul>'
          },
          {
            say: 'DeepSeek V3 pushes this to the extreme: two hundred fifty six routed experts plus one shared expert per layer, eight chosen per token, spread across sixty four GPUs, with routing limited to four nodes to cap network traffic.',
            card: { tag: 'NUMBERS', title: 'Sparsity at scale', stat: { v: '8 / 256', u: 'experts per token', l: 'DeepSeek-V3 activates 37B of 671B parameters; each token reaches at most 4 nodes' } },
            deep: '<p>For DeepSeek-V3 (h = 7,168, k = 8, 256 routed + 1 shared expert, 37B of 671B params active), dispatch is sent in FP8 (≈ 57 KB/token) and combine in BF16 (≈ 115 KB/token).</p>' +
              '<ul><li><b>Node-limited routing</b>: a token may only pick experts on ≤ 4 nodes, so each token crosses InfiniBand at most 4 times and then fans out over NVLink.</li>' +
              '<li><b>Serving</b>: prefill uses throughput-oriented all-to-all; decode uses latency-oriented kernels (DeepEP low-latency mode via IBGDA). On NVL72, “wide EP” spreads experts over all 72 GPUs at NVLink speed while attention runs data-parallel.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('EP: 2 all-to-alls per MoE layer');
          return swapPage(ctx, S, function (g) {
            buildEP(ctx, S, g);
            hide([S.meshG, S.tokG, S.expG, S.dispTxt, S.combTxt, S.loadG, S.moeCard, S.moeA2, S.moeB, S.moeC]);
            hide(S.loadBars);
          }).then(function () {
            /* beat 0: tokens, router, experts */
            ctx.reveal(S.tokG, { from: 'left' });
            ctx.reveal(S.expG, { from: 'right', delay: 200 });
            ctx.reveal(S.moeCard, { from: 'up', delay: 400 });
            return ctx.reveal(S.meshG, { delay: 700, dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: dispatch all-to-all */
            ctx.hud('dispatch: each token goes to its top-2 experts');
            fit(ctx, S.moeCard, 150);
            ctx.reveal(S.dispTxt, { from: 'up' });
            ctx.reveal(S.moeA2, { from: 'left', delay: 200 });
            return Promise.all(S.routes.map(function (rt) { return ctx.packet(rt.p, { color: rt.col, dur: 1300, r: 4 }); }));
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: expert compute and combine */
            ctx.hud('combine: weighted sum back on the home GPU');
            ctx.reveal(S.combTxt, { from: 'down' });
            return Promise.all(S.exp.map(function (e) { return ctx.pulse(e, { color: 'magenta', dur: 600 }); })).then(function () {
              return Promise.all(S.routes.map(function (rt) { return ctx.packet(rt.p, { color: rt.col, dur: 1300, r: 4, reverse: true }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: load imbalance and capacity */
            ctx.hud('expert E2 is hot: over capacity 7.5 tokens');
            fit(ctx, S.moeCard, 260);
            ctx.reveal(S.loadG, { dur: 400 });
            ctx.reveal(S.moeB, { from: 'up', delay: 400 });
            return ctx.reveal(S.loadBars, { from: 'up', stagger: 60, delay: 200 }).then(function () { return ctx.pulse(S.exp[2], { color: 'red', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: DeepSeek-V3 numbers */
            ctx.hud('DeepSeek-V3: 8 of 256 experts, EP 64');
            fit(ctx, S.moeCard, 700);
            ctx.reveal(S.moeC, { from: 'up', dur: 600 });
            return ctx.pulse(S.moeCard, { color: 'magenta', dur: 800 });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Sequence parallel',
        beats: [
          {
            say: 'Video diffusion transformers have a different problem. One shot of the fox trailer is seventy five thousand tokens, and attention over all of them is the dominant cost. Sequence parallelism splits those tokens across GPUs, but every query still needs every key.',
            card: { tag: 'NUMBERS', title: 'One shot is a long sequence', stat: { v: '75,600', u: 'tokens', l: 'per fox shot; attention costs 4·N²·d per layer, so an 8-way split leaves 9,450 tokens per GPU' } },
            deep: '<p>The latent video has N = 21 × 45 × 80 = 75,600 tokens with d = 5,120 across 40 layers. Attention costs 4·N²·d ≈ 117 TFLOP per layer, 69% of the forward FLOPs, and the score matrix has 5.7 billion entries per head: it can only be computed blockwise.</p>' +
              '<p>Splitting N over P GPUs gives each GPU N/P = 9,450 tokens at P = 8, but a query block still needs every key and value block: the matrix on the left shows 8 × 8 block pairs, and each GPU owns one row of blocks.</p>'
          },
          {
            say: 'In ring attention, each GPU keeps its queries and passes key and value blocks around a ring. After as many steps as there are GPUs, every query has met every key.',
            card: { tag: 'HOW IT WORKS', title: 'Ring: circulate K and V', body: 'Each GPU keeps its query block and forwards its K,V block to the next GPU. After P steps every query has met every key.' },
            deep: '<p><b>Ring attention</b> (Liu et al.): GPU i holds Q<sub>i</sub>, K<sub>i</sub>, V<sub>i</sub>. For t = 0…P−1 it computes the block (Q<sub>i</sub>, K<sub>(i−t) mod P</sub>) and forwards its current K,V block to GPU i+1. In the grid, cell (i, j) is the block Q<sub>i</sub>K<sub>j</sub><sup>T</sup>; the diagonal is computed in step 0, the next diagonal in step 1, and so on.</p>' +
              '<p>The degree P is bounded by the sequence length, not by the number of heads, and each hop moves 2·(N/P)·d·2 B for K and V.</p>'
          },
          {
            say: 'Each step merges its partial result with an online softmax, while the next block is already in flight. The communication hides under compute, and no full attention matrix is ever stored.',
            card: { tag: 'KEY IDEA', title: 'Online softmax makes blocks mergeable', body: 'A running maximum and running sum let partial attention results combine exactly, so the N × N score matrix never exists in memory.',
              more: '<p>For each new block b with local max m_b, sum ℓ_b and unnormalized output O_b, the running state (m, ℓ, O) is rescaled and merged, then normalized by ℓ at the end. The result is bit-for-bit the softmax over all keys, computed in P blocks: this is the FlashAttention recurrence applied across GPUs.</p>' },
            deep: '<div class="eq">m′ = max(m, m<sub>b</sub>),  ℓ′ = e<sup>m−m′</sup>ℓ + e<sup>m<sub>b</sub>−m′</sup>ℓ<sub>b</sub>,  O′ = (e<sup>m−m′</sup>ℓ·O + e<sup>m<sub>b</sub>−m′</sup>ℓ<sub>b</sub>·O<sub>b</sub>) / ℓ′</div>' +
              '<p>Communication hides under compute when the block’s attention FLOPs (4·(N/P)²·d) outlast its K,V transfer (2·(N/P)·d·2 B): true for long sequences. With causal masks (LLMs), naive splits are unbalanced; zig-zag sharding fixes it (used in Llama 3 context parallelism).</p>'
          },
          {
            say: 'Ulysses takes the other route. An all to all trades the sequence split for a head split, each GPU runs ordinary attention over all tokens for its own heads, and a second all to all trades back.',
            card: { tag: 'TRADE-OFF', title: 'Ulysses: simple, but bounded by heads', body: 'Two all-to-alls turn a sequence split into a head split, so unmodified FlashAttention runs. The degree P must divide the head count.' },
            deep: '<p><b>Ulysses</b> (DeepSpeed): all-to-all Q, K, V from [N/P, H] to [N, H/P], run dense attention per head group, all-to-all O back. Bounded by P ≤ H and requires P | H (Wan 2.1 14B: 40 heads, so P ∈ {2, 4, 5, 8, 10, …}).</p>' +
              '<p>Per-GPU communication volume is proportional to N·h/P, so it stays constant when N and P grow together, and on NVLink it is cheap; the ring wins where the head count runs out or the fabric is slow.</p>'
          },
          {
            say: 'Production video serving combines both, with Ulysses inside an NVLink domain and a ring across domains. It also splits the conditional and unconditional guidance branches onto separate GPU groups.',
            card: { tag: 'STATE OF THE ART', title: 'USP plus CFG parallel', body: 'USP composes Ulysses and ring; xDiT adds CFG parallel. Ulysses 8 × CFG 2 puts each fox shot on 16 GPUs.' },
            deep: '<p><b>USP</b> composes both (Ulysses degree inside NVLink × ring degree across), and video engines (xDiT-style) add <b>CFG parallel</b>: the conditional and unconditional branches of classifier-free guidance run on separate GPU groups.</p>' +
              '<p>For the fox shot, SP 8 × CFG 2 = 16 GPUs per shot, with six shots in flight in the cluster. The unconditional branch is independent of the conditional one, so CFG parallel needs only one small exchange per denoising step (the two noise predictions), not per layer.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('fox shot: 75,600 tokens ÷ 8 GPUs = 9,450 each');
          return swapPage(ctx, S, function (g) {
            buildSP(ctx, S, g);
            hide([S.ringG, S.mergeG, S.ulyG, S.spB, S.spB2, S.spC, S.spD, S.tokMat]);
            hide(S.tokSegs); hide(S.u2);
            S.u2.forEach(function (cg) { ctx.place(cg, cg.src.x, cg.src.y); });
            paintRingAttn(ctx, S, 0);
          }).then(function () {
            /* beat 0: 75,600 tokens over 8 GPUs, every row needs every key */
            ctx.reveal(S.tokSegs, { from: 'up', stagger: 80 });
            return ctx.reveal(S.tokMat, { delay: 700, dur: 600 }).then(function () { return ctx.pulse(S.tokSegs[0], { color: 'cyan', dur: 700 }); });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: ring, first two hops */
            ctx.hud('ring: each GPU keeps Q, K/V blocks circulate');
            fit(ctx, S.spCard, 240);
            ctx.fadeOut(S.tokBar, 400, true);
            ctx.reveal(S.spB, { from: 'left', delay: 300 });
            return ctx.reveal(S.ringG, { dur: 500, delay: 300 }).then(function () {
              return ctx.wait(200);
            }).then(function () { return seq([1, 2], function (t) { return ringStep(ctx, S, t); }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: remaining hops with online-softmax merging */
            ctx.hud('online softmax: no N × N matrix is stored');
            fit(ctx, S.spCard, 390);
            ctx.reveal(S.mergeG, { from: 'down' });
            ctx.reveal(S.spB2, { from: 'left', delay: 300 });
            return seq([3, 4], function (t) { return ringStep(ctx, S, t); }).then(function () {
              S.mergeT.setText('4 blocks merged · exact attention');
              return ctx.pulse(S.mergeT, { color: 'violet', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: Ulysses all-to-all */
            ctx.hud('Ulysses: all-to-all swaps sequence for heads');
            fit(ctx, S.spCard, 550);
            ctx.reveal(S.ulyG, { from: 'up', dur: 500 });
            ctx.reveal(S.spC, { from: 'left', delay: 300 });
            return ctx.wait(700).then(function () {
              return Promise.all(S.u2.map(function (cg, k) {
                cg.setAttribute('opacity', 1);
                return ctx.transform(cg, { x: cg.dst.x, y: cg.dst.y }, 1000, 'inOut', (k % 4) * 80);
              }));
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: USP and CFG parallel */
            ctx.hud('Ulysses 8 × CFG 2 = 16 GPUs per shot');
            fit(ctx, S.spCard, 700);
            ctx.reveal(S.spD, { from: 'up', dur: 600 });
            return Promise.all([ctx.pulse(S.ringG, { color: 'violet', dur: 800 }), ctx.pulse(S.ulyG, { color: 'violet', dur: 800 })]);
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Mapping to topology',
        beats: [
          {
            say: 'Finally, map the cuts onto the hardware. Rank the axes by how much and how often they talk: tensor parallel first, then sequence and expert, then pipeline, and data parallel last.',
            card: { tag: 'KEY IDEA', title: 'Chattiest axis, fastest link', body: 'Rank axes by bytes times frequency: TP > SP ≈ EP > PP > DP. Then assign them to links from innermost to outermost.' },
            deep: '<p>The mapping problem: assign each GPU a coordinate (dp, pp, cp/sp, tp) so that the groups with the highest bandwidth × frequency land on the fastest links.</p>' +
              '<table><tr><th>Axis</th><th>Traffic pattern</th><th>Placement</th></tr>' +
              '<tr><td>TP</td><td>2 AR / layer, synchronous</td><td>within 8-GPU node / NVL domain</td></tr>' +
              '<tr><td>SP / CP / EP</td><td>A2A or ring per layer</td><td>NVLink domain; EP may span a few nodes</td></tr>' +
              '<tr><td>PP</td><td>p2p per micro-batch</td><td>across nodes</td></tr>' +
              '<tr><td>DP / FSDP</td><td>once per step, overlappable</td><td>across rails, whole cluster</td></tr></table>'
          },
          {
            say: 'Tensor parallel is chatty and sits on the critical path, so it lives inside a node, on NVLink. Sequence and expert parallel come next, and stay inside the NVLink domain when possible.',
            card: { tag: 'HOW IT WORKS', title: 'TP inside the node', body: 'Two all-reduces per layer, on the critical path: only NVLink is fast enough. SP and EP also stay inside the domain when they can.' },
            deep: '<p>In the diagram each column is a node, and the eight GPUs of a column form one TP group: rank g of the TP group is GPU g of the node. The amber packets are the tensor-parallel all-reduce travelling over the intra-node NVLink fabric.</p>' +
              '<div class="eq">rank = ((dp · P<sub>pp</sub> + pp) · P<sub>cp</sub> + cp) · P<sub>tp</sub> + tp   (TP fastest-varying → same node)</div>' +
              '<p>Making TP the fastest-varying coordinate of the global rank is how Megatron-style launchers guarantee that consecutive ranks land on the same node.</p>'
          },
          {
            say: 'Pipeline stages exchange one activation per micro batch, so they can cross node boundaries. Stage s hands its output to stage s plus one, on another node.',
            card: { tag: 'KEY IDEA', title: 'Pipeline crosses nodes', body: 'One activation tensor per micro-batch per boundary is point to point and overlappable, so stages can sit on different nodes.' },
            deep: '<p>PP groups are the next-fastest-varying coordinate: consecutive stages sit on consecutive nodes, so each boundary is one node-to-node send, riding one NIC per GPU pair. In the picture, stage 0 (cyan) hands off to stage 1 (orange), then lime, then violet, and the four stages repeat for the second replica.</p>' +
              '<p>Stage boundaries are chosen to balance layers (and embedding / loss heads) so that no stage becomes the bottleneck of the whole pipeline.</p>'
          },
          {
            say: 'Data parallel talks least, once per step, so it spans the whole cluster. GPUs of the same rank in different replicas share a rail, so their all reduce crosses a single switch.',
            card: { tag: 'KEY IDEA', title: 'Data parallel rides the rails', body: 'One all-reduce per step. GPU g of a stage and of its replica share rail g, so the reduction crosses a single leaf switch.' },
            deep: '<p>In the diagram, replica 1 mirrors replica 0; the DP all-reduce for GPU g3 of stage s connects node s and node s+4, both on <b>rail 3</b>, so it is one leaf-switch hop. Every rail carries its own DP ring in parallel, which is why the rail-optimized fabric of the GPU chamber fits this mapping.</p>' +
              '<p>Because gradients are only exchanged once per step and can be overlapped with the backward pass, DP tolerates the slowest links, so it is the outermost axis.</p>'
          },
          {
            say: 'Every large system follows this rule, from Llama three’s sixteen thousand GPU pretraining run to DeepSeek V3 and our own fox trailer fleet.',
            card: { tag: 'NUMBERS', title: 'The rule at scale', stat: { v: '16,384', u: 'GPUs', l: 'Llama 3 405B pretraining: TP 8 × PP 16 × DP 128, CP 1 at 8k context' },
              more: '<p>Check: 8 × 16 × 128 = 16,384. In the long-context phase Meta switched to CP 16 × DP 8 (8 × 16 × 16 × 8 = 16,384): context parallelism took over from data parallelism because each 128k sequence no longer fit on one GPU’s activations.</p>' },
            deep: '<div class="note">Serving is the same game with different weights: prefill likes TP/SP (compute), decode likes DP + wide EP (memory bandwidth, batch size), and the video DiT likes SP × CFG inside one NVLink domain. The schedulers in the sibling chambers decide which GPUs form each group.</div>' +
              '<p>Training: Llama 3 405B used TP 8 × CP 1 × PP 16 × DP 128 on 16,384 H100s; DeepSeek-V3 used PP 16 × EP 64 × ZeRO-1 DP on 2,048 H800s with no tensor parallelism at all. Serving: the planner LLM runs TP 8 per replica, MoE agents use wide EP on NVL72, and each video shot uses Ulysses SP 8 × CFG 2 = 16 GPUs.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('TP in node · PP across nodes · DP across rails');
          return swapPage(ctx, S, function (g) {
            buildMap(ctx, S, g);
            hide(S.nodeG); hide([S.braceG, S.stageLeg, S.mapNote, S.mapCard, S.mapReal, S.mapFox, S.railLab]);
            hide(S.ppArrows); hide(S.dpArcs); hide(S.mapRows);
          }).then(function () {
            /* beat 0: 64 GPUs and the ranking rule */
            ctx.reveal(S.nodeG, { from: 'up', stagger: 100 });
            ctx.reveal([S.stageLeg, S.railLab], { delay: 700 });
            return ctx.reveal(S.mapCard, { from: 'left', delay: 400, dur: 500 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: tensor parallel inside a node */
            ctx.hud('TP: 2 all-reduces / layer, inside one node');
            fit(ctx, S.mapCard, 350);
            ctx.reveal(S.mapNote, { from: 'up' });
            ctx.reveal(S.mapRows.slice(0, 2), { from: 'left', stagger: 250, delay: 600 });
            return ctx.camera(184, 470, 1.55, 900).then(function () {
              S.nodeCols.forEach(function (c) { c.setAttribute('stroke', ctx.alpha('amber', 0.9)); c.setAttribute('stroke-width', 2); });
              return Promise.all([
                ctx.packet(S.tpPaths[0], { color: 'amber', dur: 900, label: 'TP AR' }),
                ctx.packet(S.tpPaths[0], { color: 'amber', dur: 900, reverse: true }),
                ctx.pulse(S.nodeCols[0], { color: 'amber', dur: 900 })
              ]);
            }).then(function () { return ctx.camera(null, null, null, 900); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: pipeline sends across nodes */
            ctx.hud('PP: stage s → stage s+1, node to node');
            fit(ctx, S.mapCard, 450);
            ctx.reveal(S.mapRows[2], { from: 'left', delay: 300 });
            ctx.reveal(S.ppArrows, { from: 'draw', stagger: 120, dur: 400 });
            return Promise.all(S.ppArrows.map(function (a, i) { return ctx.wait(i * 120).then(function () { return ctx.packet(a, { color: 'lime', dur: 600, r: 4 }); }); }));
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: data parallel over the rails */
            ctx.hud('DP: same-rank GPUs, one leaf-switch hop');
            fit(ctx, S.mapCard, 550);
            ctx.reveal(S.mapRows[3], { from: 'left', delay: 300 });
            ctx.reveal(S.braceG, { from: 'up' });
            ctx.reveal(S.dpArcs, { from: 'draw', stagger: 150, dur: 500 });
            return Promise.all(S.dpArcs.map(function (a, i) {
              return ctx.wait(500 + i * 150).then(function () {
                return Promise.all([ctx.packet(a, { color: 'cyan', dur: 900, r: 4 }), ctx.packet(a, { color: 'cyan', dur: 900, r: 4, reverse: true })]);
              });
            }));
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: real systems */
            ctx.hud('Llama 3 405B: TP 8 × PP 16 × DP 128');
            fit(ctx, S.mapCard, 620);
            ctx.fadeOut(S.mapRows, 400, true);
            ctx.reveal(S.mapReal, { from: 'up', dur: 600, delay: 300 });
            ctx.reveal(S.mapFox, { from: 'up', delay: 800, dur: 600 });
            return ctx.wait(900).then(function () { return ctx.pulse(S.mapCard, { color: 'red', dur: 800 }); });
          });
        }
      }
    ]
  });
})();
