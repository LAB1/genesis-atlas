/* L2 — Inside the GPU & Interconnect. A camera zoom from an NVL72 rack down to one tensor-core MMA
 * (rack -> node -> die -> SM -> warp -> tensor core), then back out: roofline analysis, the scale-out
 * RDMA fabric, and a FLOP / time budget for one shot of the fox-astronaut trailer. */
(function () {
  var CRUMBS = ['FABRIC', 'RACK', 'NODE', 'GPU', 'SM', 'WARP', 'MMA'];

  function bx(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    if (title) ctx.text(x + 16, y + 22, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = bx(x, y, w, h);
    return g;
  }

  function stopLoops(S) {
    (S.loops || []).forEach(function (l) { l.stop(); });
    S.loops = [];
  }

  /* breadcrumb of the zoom path (top-right, below the HUD band) */
  function crumb(ctx, S, active) {
    if (!S.crumb) {
      S.crumb = ctx.group();
      S.crumbEls = [];
      var x = 1128;
      CRUMBS.forEach(function (c, i) {
        var lab = ctx.label(x, 100, c, { color: 'red', size: 12, anchor: 'start', parent: S.crumb });
        S.crumbEls.push(lab);
        x += lab.w;
        if (i < CRUMBS.length - 1) {
          ctx.text(x + 8, 100, '›', { size: 15, color: 'dim', anchor: 'middle', parent: S.crumb });
          x += 16;
        }
      });
      ctx.reveal(S.crumb, { from: 'down', dur: 500 });
    }
    S.crumbEls.forEach(function (el, i) {
      ctx.fade(el, active.indexOf(i) >= 0 ? 1 : 0.6, 400);
    });
  }

  /* runs of spaces -> non-breaking spaces so column alignment survives SVG whitespace collapsing */
  function nbsp(lines) {
    return lines.map(function (s) { return s.replace(/ {2,}/g, function (m) { return ' '.repeat(m.length); }); });
  }

  function freshPage(ctx, S) { S.page = ctx.group(); return S.page; }

  /* zoom-through: camera dives into (x,y) of the current page, the next page grows out of that point */
  function zoomInto(ctx, S, x, y, s, build) {
    stopLoops(S);
    var old = S.page;
    return Promise.all([
      ctx.camera(x, y, s, 1150),
      ctx.wait(450).then(function () { return ctx.fadeOut(old, 650, true); })
    ]).then(function () {
      var g = freshPage(ctx, S);
      build(g);
      var p = ctx.reveal(g, { from: 'scale', s0: 0.25, dur: 850, ease: 'out' });
      ctx.camera(null, null, null, 1);
      return p;
    });
  }

  /* zoom-out: the old page recedes, the new one settles in from larger than life */
  function zoomOut(ctx, S, build) {
    stopLoops(S);
    var old = S.page;
    return Promise.all([ctx.camera(800, 470, 0.45, 900), ctx.fadeOut(old, 800, true)]).then(function () {
      var g = freshPage(ctx, S);
      build(g);
      var p = ctx.reveal(g, { from: 'scale', s0: 1.5, dur: 850, ease: 'out' });
      ctx.camera(null, null, null, 1);
      return p;
    });
  }

  /* ================================================================ RACK */
  function buildRack(ctx, S, g) {
    ctx.rect(150, 166, 380, 700, { rx: 10, fill: 'rgba(8,12,24,0.94)', stroke: ctx.alpha('red', 0.7), sw: 1.6, parent: g, glow: true });
    ctx.text(340, 184, 'GB200 NVL72 · ONE RACK', { size: 12, font: 'mono', weight: 700, color: 'red', anchor: 'middle', parent: g, spacing: 1 });
    S.trays = []; S.rackGpu = []; S.trayY = [];
    var ci = 0, si = 0;
    for (var i = 0; i < 27; i++) {
      var sw = i >= 10 && i < 19;
      var y = 198 + i * 23 + (i >= 10 ? 6 : 0) + (i >= 19 ? 6 : 0);
      S.trayY.push(y + 9.5);
      var t = ctx.group({ parent: g });
      ctx.rect(162, y, 330, 19, { rx: 3, fill: sw ? ctx.alpha('cyan', 0.06) : 'rgba(255,255,255,0.03)', stroke: ctx.alpha(sw ? 'cyan' : 'red', 0.35), sw: 1, parent: t });
      if (sw) {
        si++;
        ctx.text(170, y + 10, 'SW' + si, { size: 11, font: 'mono', color: 'cyan', parent: t });
        ctx.rect(230, y + 3, 110, 13, { rx: 2, fill: ctx.alpha('cyan', 0.3), stroke: 'cyan', sw: 1, parent: t });
        ctx.rect(360, y + 3, 110, 13, { rx: 2, fill: ctx.alpha('cyan', 0.3), stroke: 'cyan', sw: 1, parent: t });
      } else {
        ci++;
        ctx.text(170, y + 10, 'CT' + (ci < 10 ? '0' : '') + ci, { size: 11, font: 'mono', color: 'dim', parent: t });
        ctx.rect(204, y + 3, 32, 13, { rx: 2, fill: ctx.alpha('blue', 0.3), stroke: 'blue', sw: 1, parent: t });
        ctx.rect(240, y + 3, 32, 13, { rx: 2, fill: ctx.alpha('blue', 0.3), stroke: 'blue', sw: 1, parent: t });
        for (var j = 0; j < 4; j++) {
          S.rackGpu.push(ctx.rect(282 + j * 52, y + 3, 46, 13, { rx: 2, fill: ctx.alpha('red', 0.45), stroke: 'red', sw: 1, parent: t }));
        }
      }
      ctx.line(492, y + 9.5, 510, y + 9.5, { color: ctx.alpha('cyan', 0.6), sw: 1.2, parent: t });
      S.trays.push(t);
    }
    S.spine = ctx.path('M510,' + S.trayY[0] + ' L510,' + S.trayY[26], { stroke: ctx.alpha('cyan', 0.75), sw: 3, parent: g });
    var sl = ctx.text(548, 516, 'NVLINK SPINE · ~5,000 copper cables', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: g });
    sl.setAttribute('transform', 'rotate(-90 548 516)');
    ctx.text(340, 850, '~120 kW · direct liquid cooling', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });

    /* card A: the domain */
    S.rackCard = card(ctx, g, 590, 160, 960, 300, 'red', 'ONE NVLINK DOMAIN');
    S.big72 = ctx.text(610, 232, '0', { size: 64, font: 'display', weight: 700, color: 'red', parent: S.rackCard, glow: true });
    ctx.text(720, 222, 'GPUs share one memory fabric', { size: 18, font: 'display', weight: 700, color: 'white', parent: S.rackCard });
    ctx.text(720, 248, 'load / store / atomics to any peer HBM, one switch hop', { size: 13, font: 'mono', color: 'dim', parent: S.rackCard });
    ctx.para(612, 296, [
      '18 compute trays × (2 Grace CPU + 4 Blackwell GPU) = 72 GPUs',
      '9 switch trays × 2 NVLink-5 switch chips = 18 NVSwitch',
      'NVLink 5: 18 links × 100 GB/s = 1.8 TB/s per GPU → 130 TB/s total',
      'HBM3e: up to 13.4 TB, 576 TB/s aggregate',
      '~180 PFLOP/s dense BF16 · ~720 PFLOP/s dense FP4'
    ], { size: 14, font: 'mono', color: 'text', lh: 29, parent: S.rackCard });

    /* card B: domain size by generation */
    S.genCard = card(ctx, g, 590, 486, 960, 380, 'red', 'NVLINK DOMAIN SIZE');
    S.mini = ctx.group({ parent: S.genCard });
    ctx.rect(628, 578, 188, 184, { rx: 8, fill: 'rgba(20,10,20,0.6)', stroke: ctx.alpha('red', 0.6), parent: S.mini });
    var mg = [], ms = [];
    for (var k = 0; k < 4; k++) {
      mg.push(ctx.rect(638 + k * 44, 592, 36, 30, { rx: 3, fill: ctx.alpha('red', 0.4), stroke: 'red', sw: 1, parent: S.mini }));
      ms.push(ctx.rect(638 + k * 44, 658, 36, 20, { rx: 3, fill: ctx.alpha('cyan', 0.35), stroke: 'cyan', sw: 1, parent: S.mini }));
      mg.push(ctx.rect(638 + k * 44, 716, 36, 30, { rx: 3, fill: ctx.alpha('red', 0.4), stroke: 'red', sw: 1, parent: S.mini }));
    }
    mg.forEach(function (gr) {
      var gx = parseFloat(gr.getAttribute('x')) + 18, top = parseFloat(gr.getAttribute('y')) < 650;
      ms.forEach(function (sr) {
        var sx = parseFloat(sr.getAttribute('x')) + 18;
        ctx.line(gx, top ? 622 : 716, sx, top ? 658 : 678, { color: ctx.alpha('cyan', 0.35), sw: 0.8, parent: S.mini });
      });
    });
    ctx.text(722, 786, 'HGX H100 · 8 GPUs', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: S.genCard });
    ctx.text(722, 806, '4 NVSwitch · 900 GB/s', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.genCard });
    ctx.line(846, 670, 950, 670, { color: 'red', sw: 2, arrow: true, parent: S.genCard });
    ctx.text(898, 652, '× 9', { size: 18, font: 'display', weight: 700, color: 'red', anchor: 'middle', parent: S.genCard });
    S.nvlDots = [];
    for (var d = 0; d < 72; d++) {
      S.nvlDots.push(ctx.rect(980 + (d % 12) * 23, 596 + Math.floor(d / 12) * 23, 18, 18, { rx: 3, fill: ctx.alpha('red', 0.45), stroke: 'red', sw: 0.8, parent: S.genCard }));
    }
    ctx.text(1117, 786, 'GB200 NVL72 · 72 GPUs', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: S.genCard });
    ctx.text(1117, 806, '18 NVSwitch · 130 TB/s', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.genCard });
    ctx.para(1290, 600, ['Why it matters:', 'TP / EP / SP traffic', 'must stay inside the', 'domain. Step outside', 'and bandwidth per GPU', 'drops 9–18× (NIC).'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: S.genCard });
    ctx.text(1070, 842, 'the fox trailer’s DiT shots are gang-scheduled onto one domain', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: S.genCard });
  }

  /* ================================================================ NODE */
  function buildNode(ctx, S, g) {
    S.nodeGpu = []; S.nodeSw = []; S.nvLinks = [];
    var xs = [];
    for (var i = 0; i < 8; i++) xs.push(110 + i * 100);
    var swx = [183, 363, 543, 723];
    /* NVLink fan first (behind boxes) */
    S.fan = ctx.group({ parent: g });
    xs.forEach(function (x) {
      swx.forEach(function (sx) {
        S.nvLinks.push(ctx.line(x, 347, sx, 466, { color: ctx.alpha('cyan', 0.4), sw: 1, parent: S.fan }));
      });
    });
    xs.forEach(function (x, k) {
      ctx.line(x, 211, x, 273, { color: ctx.alpha('blue', 0.8), sw: 1.4, dash: '4 4', parent: g });
      ctx.node({ x: x, y: 196, w: 86, h: 30, title: 'CX-7 400G', titleSize: 11, color: 'blue', kind: 'pill', glow: false, parent: g });
      S.nodeGpu.push(ctx.node({ x: x, y: 310, w: 88, h: 74, title: 'GPU ' + k, sub: 'H100 80GB', titleSize: 14, subSize: 11, color: 'red', parent: g }));
    });
    swx.forEach(function (sx, k) {
      S.nodeSw.push(ctx.node({ x: sx, y: 490, w: 150, h: 48, title: 'NVSwitch ' + k, sub: '64 NVLink4 ports', titleSize: 13, subSize: 11, color: 'cyan', kind: 'chip', parent: g }));
    });
    ctx.node({ x: 270, y: 620, w: 300, h: 54, title: 'CPU 0 · Xeon', sub: '1 TB DDR5 · PCIe Gen5 switches', titleSize: 13, subSize: 11, color: 'blue', icon: 'chip', parent: g });
    ctx.node({ x: 640, y: 620, w: 300, h: 54, title: 'CPU 1 · Xeon', sub: '1 TB DDR5 · PCIe Gen5 switches', titleSize: 13, subSize: 11, color: 'blue', icon: 'chip', parent: g });
    ctx.para(80, 700, [
      '— NVLink4: 18 links per GPU, split 5·4·4·5 over 4 NVSwitch = 900 GB/s bidir',
      '- - PCIe Gen5 x16 to one ConnectX-7 per GPU: 400 Gb/s = 50 GB/s per direction',
      'any GPU → any GPU is one switch hop; NVLS reduces inside the switch (SHARP)'
    ], { size: 13, font: 'mono', color: 'text', lh: 28, parent: g });

    /* bandwidth bars */
    S.bwCard = card(ctx, g, 920, 160, 630, 400, 'red', 'PER-GPU BANDWIDTH · GB/s per direction');
    var rows = [['HBM3 (local memory)', 3350, 'red'], ['NVLink4 (to peers in node)', 450, 'cyan'], ['PCIe Gen5 x16 (to host)', 64, 'blue'], ['InfiniBand NDR NIC (off node)', 50, 'orange']];
    S.bwBars = [];
    rows.forEach(function (r, i) {
      var y = 214 + i * 74;
      ctx.text(944, y, r[0], { size: 13, font: 'mono', color: 'text', parent: S.bwCard });
      var w = Math.max(4, 470 * r[1] / 3350);
      var b = ctx.rect(944, y + 14, w, 22, { rx: 3, fill: ctx.alpha(r[2], 0.55), stroke: r[2], sw: 1, parent: S.bwCard });
      b.full = w;
      S.bwBars.push(b);
      ctx.text(944 + w + 10, y + 26, r[1].toLocaleString('en-US'), { size: 14, font: 'mono', weight: 700, color: r[2], parent: S.bwCard });
    });
    ctx.para(944, 516, ['450 ÷ 50 = 9× cliff at the node boundary:', 'keep tensor / sequence-parallel traffic on NVLink'], { size: 13, font: 'mono', color: 'amber', lh: 22, parent: S.bwCard });

    S.foxCard = card(ctx, g, 920, 584, 630, 276, 'amber', 'FOX SHOT ON THIS NODE (Ulysses SP = 8)');
    ctx.para(944, 636, [
      '14B video DiT · 75,600 tokens · d = 5,120',
      'per layer per GPU: 4 all-to-alls ≈ 340 MB',
      'NVLink4 450 GB/s → 0.75 ms  (attention ≈ 25 ms)',
      'IB NDR  50 GB/s → 6.8 ms  → +27% if not overlapped',
      'verdict: SP group = one NVLink domain'
    ], { size: 13, font: 'mono', color: 'text', lh: 40, parent: S.foxCard });
  }

  /* ================================================================ DIE */
  var DISABLED = { 0: 8, 2: 3, 3: 6, 5: 1, 6: 5, 7: 7 };
  function buildDie(ctx, S, g) {
    ctx.rect(190, 176, 700, 566, { rx: 12, fill: 'rgba(12,10,20,0.95)', stroke: ctx.alpha('red', 0.75), sw: 1.8, parent: g, glow: true });
    ctx.rect(206, 186, 670, 26, { rx: 4, fill: ctx.alpha('white', 0.04), stroke: ctx.alpha('white', 0.2), sw: 1, parent: g });
    ctx.text(541, 199, 'GigaThread engine (CTA scheduler) · PCIe Gen5 host interface', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    S.smCells = [];
    for (var gi = 0; gi < 8; gi++) {
      var gx = 206 + (gi % 4) * 170, gy = gi < 4 ? 222 : 498;
      ctx.rect(gx, gy, 158, 156, { rx: 6, fill: ctx.alpha('red', 0.05), stroke: ctx.alpha('red', 0.4), sw: 1, parent: g });
      ctx.text(gx + 8, gy + 14, 'GPC ' + gi, { size: 11, font: 'mono', weight: 700, color: 'red', parent: g });
      for (var c = 0; c < 9; c++) {
        var off = DISABLED[gi] === c;
        for (var r = 0; r < 2; r++) {
          var cell = ctx.rect(gx + 6 + c * 17, gy + 28 + r * 62, 14, 56, {
            rx: 2, fill: off ? 'rgba(120,130,150,0.08)' : ctx.cmap('red', 0.35), stroke: off ? ctx.alpha('dim', 0.5) : ctx.alpha('red', 0.6), sw: 0.8, dash: off ? '2 2' : null, parent: g
          });
          if (!off) { cell.cx = gx + 13 + c * 17; cell.cy = gy + 56 + r * 62; S.smCells.push(cell); }
        }
      }
    }
    S.l2 = [];
    [[206, 'partition 0'], [552, 'partition 1']].forEach(function (p) {
      var gr = ctx.group({ parent: g });
      ctx.rect(p[0], 390, 324, 96, { rx: 6, fill: ctx.alpha('blue', 0.14), stroke: 'blue', sw: 1.3, parent: gr });
      ctx.text(p[0] + 162, 428, 'L2 cache · 25 MB', { size: 16, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: gr });
      ctx.text(p[0] + 162, 452, p[1], { size: 11, font: 'mono', color: 'blue', anchor: 'middle', parent: gr });
      S.l2.push(gr);
    });
    ctx.text(541, 438, '⇄', { size: 16, color: 'blue', anchor: 'middle', parent: g });
    ctx.rect(206, 664, 670, 26, { rx: 4, fill: ctx.alpha('red', 0.08), stroke: ctx.alpha('red', 0.35), sw: 1, parent: g });
    ctx.text(541, 677, '10 × 512-bit HBM3 memory controllers (5,120-bit bus)', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g });
    ctx.rect(206, 700, 670, 28, { rx: 4, fill: ctx.alpha('cyan', 0.08), stroke: ctx.alpha('cyan', 0.4), sw: 1, parent: g });
    ctx.text(541, 714, '18 × NVLink4 PHY · 900 GB/s   |   PCIe Gen5 x16', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: g });
    ctx.text(541, 766, 'GH100 · 144 SMs on die, 132 enabled (6 TPCs fused off for yield)', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });

    /* HBM stacks */
    S.hbmPaths = [];
    [[66, 224], [66, 394], [66, 564], [914, 224], [914, 394], [914, 564]].forEach(function (h, i) {
      var dead = i === 5;
      ctx.rect(h[0], h[1], 100, 128, { rx: 6, fill: dead ? 'rgba(120,130,150,0.06)' : ctx.alpha('red', 0.14), stroke: dead ? ctx.alpha('dim', 0.6) : 'red', sw: 1.3, dash: dead ? '4 4' : null, parent: g });
      for (var l = 0; l < 4; l++) ctx.line(h[0] + 10, h[1] + 34 + l * 18, h[0] + 90, h[1] + 34 + l * 18, { color: ctx.alpha(dead ? 'dim' : 'red', 0.35), sw: 1, parent: g });
      ctx.text(h[0] + 50, h[1] + 16, dead ? 'spacer' : 'HBM3', { size: 13, font: 'mono', weight: 700, color: dead ? 'dim' : 'white', anchor: 'middle', parent: g });
      ctx.text(h[0] + 50, h[1] + 112, dead ? 'no stack' : '16 GB', { size: 12, font: 'mono', color: dead ? 'dim' : 'red', anchor: 'middle', parent: g });
      if (!dead) {
        var left = h[0] < 500;
        var sx = left ? 166 : 914, sy = h[1] + 64, tx = left ? 206 : 876;
        S.hbmPaths.push(ctx.path('M' + sx + ',' + sy + ' C' + (left ? 196 : 884) + ',' + sy + ' ' + (left ? 180 : 900) + ',438 ' + tx + ',438', { stroke: ctx.alpha('red', 0.5), sw: 2, parent: g }));
      }
    });

    /* stats */
    S.dieCard = card(ctx, g, 1050, 160, 500, 620, 'red', 'H100 SXM5 · GH100');
    S.tflops = ctx.text(1070, 226, '0', { size: 52, font: 'display', weight: 700, color: 'red', parent: S.dieCard, glow: true });
    ctx.text(1250, 216, 'TFLOP/s', { size: 16, font: 'display', weight: 700, color: 'white', parent: S.dieCard });
    ctx.text(1250, 238, 'dense BF16', { size: 12, font: 'mono', color: 'dim', parent: S.dieCard });
    ctx.para(1072, 284, [
      '132 SMs enabled (of 144)',
      '528 tensor cores · 16,896 FP32 lanes',
      'L2 50 MB · HBM3 80 GB (5 × 16 GB)',
      'HBM bandwidth 3.35 TB/s',
      'FP8 dense 1,979 TFLOP/s',
      '700 W · 80 B transistors · TSMC 4N'
    ], { size: 13, font: 'mono', color: 'text', lh: 27, parent: S.dieCard });
    S.eq = ctx.group({ parent: S.dieCard });
    ctx.rect(1066, 454, 468, 70, { rx: 8, fill: ctx.alpha('amber', 0.08), stroke: ctx.alpha('amber', 0.6), sw: 1, parent: S.eq });
    ctx.text(1300, 477, '132 SM × 4 TC × 1,024 FLOP/clk', { size: 14, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: S.eq });
    ctx.text(1300, 502, '× 1.83 GHz ≈ 989 TFLOP/s', { size: 14, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: S.eq });
    ctx.text(1072, 552, 'SAME RECIPE, NEWER PARTS', { size: 12, font: 'mono', weight: 700, color: 'red', parent: S.dieCard, spacing: 1 });
    ctx.para(1072, 582, [
      'H200  141 GB HBM3e · 4.8 TB/s',
      '      same GH100 compute',
      'B200  2 dies, NV-HBI 10 TB/s link',
      '      192 GB HBM3e · ~8 TB/s',
      '      ~2.25 PF BF16 · FP4 tensor cores'
    ], { size: 13, font: 'mono', color: 'text', lh: 26, parent: S.dieCard });
    Array.prototype.forEach.call(S.dieCard.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
    ctx.text(1300, 745, 'HBM → L2 → SMs: every byte crosses 3.35 TB/s', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.dieCard });
  }

  /* ================================================================ SM */
  function buildSMSP(ctx, g, k, x0, y0, S) {
    ctx.rect(x0, y0, 395, 280, { rx: 8, fill: 'rgba(14,18,34,0.92)', stroke: ctx.alpha('red', 0.45), parent: g });
    ctx.text(x0 + 10, y0 + 13, 'SMSP ' + k + ' · L0 I-cache', { size: 12, font: 'mono', color: 'dim', parent: g });
    ctx.rect(x0 + 8, y0 + 24, 379, 38, { rx: 5, fill: ctx.alpha('red', 0.12), stroke: ctx.alpha('red', 0.7), sw: 1, parent: g });
    ctx.text(x0 + 18, y0 + 43, 'WARP SCHEDULER + DISPATCH', { size: 12, font: 'mono', weight: 700, color: 'red', parent: g });
    var slots = [];
    for (var s = 0; s < 16; s++) slots.push(ctx.rect(x0 + 208 + s * 11, y0 + 38, 9, 10, { rx: 2, fill: ctx.alpha('violet', 0.35), parent: g }));
    S.slots.push(slots);
    ctx.rect(x0 + 8, y0 + 70, 379, 30, { rx: 5, fill: ctx.alpha('blue', 0.12), stroke: ctx.alpha('blue', 0.7), sw: 1, parent: g });
    ctx.text(x0 + 197, y0 + 85, 'REGISTER FILE · 16,384 × 32-bit = 64 KB', { size: 12, font: 'mono', color: 'blue', anchor: 'middle', parent: g });
    function unit(ux, w, cols, name, count, col) {
      ctx.rect(x0 + ux, y0 + 108, w, 112, { rx: 5, fill: ctx.alpha(col, 0.05), stroke: ctx.alpha(col, 0.35), sw: 1, parent: g });
      var gw = cols * 13 - 2, sx = x0 + ux + (w - gw) / 2;
      for (var r = 0; r < 4; r++) for (var c = 0; c < cols; c++) {
        ctx.rect(sx + c * 13, y0 + 118 + r * 13, 11, 11, { rx: 2, fill: ctx.alpha(col, 0.5), parent: g });
      }
      ctx.text(x0 + ux + w / 2, y0 + 188, name, { size: 12, font: 'mono', weight: 700, color: col, anchor: 'middle', parent: g });
      ctx.text(x0 + ux + w / 2, y0 + 206, '× ' + count, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    }
    unit(8, 70, 4, 'INT32', 16, 'teal');
    unit(84, 120, 8, 'FP32', 32, 'cyan');
    unit(210, 70, 4, 'FP64', 16, 'violet');
    var tc = ctx.group({ parent: g });
    ctx.rect(x0 + 286, y0 + 108, 101, 112, { rx: 6, fill: ctx.alpha('red', 0.22), stroke: 'red', sw: 1.6, parent: tc, glow: true });
    ctx.text(x0 + 336, y0 + 138, 'TENSOR', { size: 13, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: tc });
    ctx.text(x0 + 336, y0 + 156, 'CORE', { size: 13, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: tc });
    ctx.text(x0 + 336, y0 + 180, '4th gen', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: tc });
    ctx.text(x0 + 336, y0 + 200, '1,024 FLOP/clk', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: tc });
    S.tcs.push(tc);
    ctx.rect(x0 + 8, y0 + 228, 186, 42, { rx: 5, fill: ctx.alpha('blue', 0.06), stroke: ctx.alpha('blue', 0.4), sw: 1, parent: g });
    ctx.text(x0 + 101, y0 + 249, 'LD/ST × 8', { size: 12, font: 'mono', color: 'blue', anchor: 'middle', parent: g });
    ctx.rect(x0 + 201, y0 + 228, 186, 42, { rx: 5, fill: ctx.alpha('amber', 0.06), stroke: ctx.alpha('amber', 0.4), sw: 1, parent: g });
    ctx.text(x0 + 294, y0 + 249, 'SFU × 4 (exp, rsqrt)', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
  }

  /* loose-round-robin warp scheduler simulation (deterministic) */
  function simWarps(nw, cycles, burst, rnd) {
    var grid = [], ready = [], left = [], last = -1, busy = 0;
    for (var w = 0; w < nw; w++) { grid.push([]); ready.push(0); left.push(burst); }
    for (var c = 0; c < cycles; c++) {
      var pick = -1;
      if (last >= 0 && left[last] < burst && ready[last] <= c) pick = last; /* finish the current burst */
      else {
        for (var k = 1; k <= nw; k++) {
          var cand = (last + k + nw) % nw;
          if (ready[cand] <= c) { pick = cand; break; }
        }
      }
      for (var w2 = 0; w2 < nw; w2++) grid[w2].push(ready[w2] > c ? 1 : 0);
      if (pick >= 0) {
        grid[pick][c] = 2; busy++;
        left[pick]--;
        last = pick;
        if (left[pick] === 0) { ready[pick] = c + 1 + 10 + Math.floor(rnd() * 7); left[pick] = burst; }
      }
    }
    return { grid: grid, util: busy / cycles };
  }

  function buildSM(ctx, S, g) {
    S.slots = []; S.tcs = [];
    ctx.rect(70, 168, 830, 694, { rx: 12, fill: 'rgba(10,10,20,0.95)', stroke: ctx.alpha('red', 0.75), sw: 1.8, parent: g, glow: true });
    ctx.text(485, 185, 'STREAMING MULTIPROCESSOR (Hopper SM) · L1 instruction cache', { size: 12, font: 'mono', weight: 700, color: 'red', anchor: 'middle', parent: g, spacing: 1 });
    for (var k = 0; k < 4; k++) buildSMSP(ctx, g, k, 84 + (k % 2) * 405, 200 + Math.floor(k / 2) * 290, S);
    ctx.rect(84, 780, 800, 36, { rx: 6, fill: ctx.alpha('blue', 0.14), stroke: 'blue', sw: 1.3, parent: g });
    ctx.text(484, 798, '256 KB L1 data cache / shared memory  (up to 228 KB as SMEM)', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: g });
    ctx.rect(84, 822, 800, 30, { rx: 6, fill: ctx.alpha('cyan', 0.08), stroke: ctx.alpha('cyan', 0.5), sw: 1, parent: g });
    ctx.text(484, 837, 'TMA async bulk-copy engine · texture units · DSMEM link to cluster peers', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: g });

    /* latency hiding panel */
    var r = ctx.rng(11);
    var sim = simWarps(12, 32, 2, r);
    var sim4 = simWarps(4, 32, 2, ctx.rng(11));
    S.sim = sim;
    S.latCard = card(ctx, g, 930, 160, 620, 350, 'red', 'LATENCY HIDING · SMSP 0, 12 resident warps');
    var rows = [];
    for (var w = 0; w < 12; w++) rows.push('w' + w);
    S.wm = ctx.matrix(990, 204, 12, 32, { cell: 14, gap: 2, rowLabels: rows, values: function () { return 'rgba(255,255,255,0.03)'; }, parent: S.latCard });
    ctx.text(1500, 404, 'cycle →', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.latCard });
    [['issue', ctx.alpha('red', 0.95)], ['stalled on memory', ctx.alpha('violet', 0.45)], ['ready, waiting', ctx.alpha('cyan', 0.3)]].forEach(function (L, i) {
      var lx = 950 + i * 170;
      ctx.rect(lx, 422, 14, 14, { rx: 2, fill: L[1], parent: S.latCard });
      ctx.text(lx + 22, 430, L[0], { size: 12, font: 'mono', color: 'text', parent: S.latCard });
    });
    ctx.text(950, 466, 'issue slot busy · 12 warps', { size: 13, font: 'mono', color: 'text', parent: S.latCard });
    ctx.rect(1190, 457, 250 * sim.util, 16, { rx: 3, fill: ctx.alpha('lime', 0.6), stroke: 'lime', sw: 1, parent: S.latCard });
    ctx.text(1535, 466, Math.round(sim.util * 100) + '%', { size: 13, font: 'mono', weight: 700, color: 'lime', anchor: 'end', parent: S.latCard });
    ctx.text(950, 492, 'issue slot busy ·  4 warps', { size: 13, font: 'mono', color: 'text', parent: S.latCard });
    ctx.rect(1190, 483, 250 * sim4.util, 16, { rx: 3, fill: ctx.alpha('orange', 0.6), stroke: 'orange', sw: 1, parent: S.latCard });
    ctx.text(1535, 492, Math.round(sim4.util * 100) + '%', { size: 13, font: 'mono', weight: 700, color: 'orange', anchor: 'end', parent: S.latCard });
    S.occCard = card(ctx, g, 930, 530, 620, 330, 'red', 'OCCUPANCY & LITTLE’S LAW');
    ctx.para(952, 580, [
      '≤ 64 warps (2,048 threads) resident per SM',
      '65,536 regs/SM: 128 regs/thread → 16 warps',
      '                255 regs/thread →  8 warps',
      'global-load latency ≈ 0.5 µs ≈ 900 clocks',
      'bytes in flight = 3.35 TB/s × 0.5 µs ≈ 1.7 MB',
      '→ ~13 KB outstanding per SM, all the time',
      'TMA / cp.async keep it in flight without regs'
    ], { size: 13, font: 'mono', color: 'text', lh: 36, parent: S.occCard });
    Array.prototype.forEach.call(S.occCard.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
  }

  function paintWarps(ctx, S, upto) {
    var cols = { 0: ctx.alpha('cyan', 0.3), 1: ctx.alpha('violet', 0.45), 2: ctx.alpha('red', 0.95) };
    S.wm.set(function (r, c) { return c < upto ? cols[S.sim.grid[r][c]] : 'rgba(255,255,255,0.03)'; });
  }

  /* ================================================================ SIMT */
  function buildSIMT(ctx, S, g) {
    var gb = card(ctx, g, 70, 170, 730, 180, 'red', 'GRID · one kernel launch, CTAs scheduled independently');
    S.blocks = ctx.matrix(100, 210, 4, 20, { cell: 22, gap: 6, values: function (r, c) { return (r === 1 && c === 5) ? ctx.alpha('amber', 0.9) : ctx.alpha('red', 0.3); }, parent: gb });
    ctx.text(100, 334, 'blockIdx = (x, y) · gridDim = (60, 591) for the fox QKV GEMM', { size: 12, font: 'mono', color: 'dim', parent: gb });
    var bb = card(ctx, g, 70, 370, 730, 255, 'amber', 'THREAD BLOCK (CTA) · 256 threads = 8 warps · shares SMEM');
    var wr = [];
    for (var i = 0; i < 8; i++) wr.push('warp ' + i);
    S.warps = ctx.matrix(180, 412, 8, 32, { cell: 13, gap: 3, rowLabels: wr, values: function (r) { return r === 2 ? ctx.alpha('lime', 0.8) : ctx.alpha('amber', 0.35); }, parent: bb });
    ctx.text(90, 566, 'threadIdx.x = 32 · warp + lane · __syncthreads() is a CTA barrier', { size: 12, font: 'mono', color: 'text', parent: bb });
    ctx.text(90, 594, 'one CTA lives on one SM for its lifetime · ≤ 32 CTAs, ≤ 64 warps per SM', { size: 12, font: 'mono', color: 'text', parent: bb });
    var p1 = S.blocks.cellCenter(1, 5);
    ctx.path('M' + (p1.x + 11) + ',' + p1.y + ' H785 V370', { stroke: ctx.alpha('amber', 0.8), sw: 1.4, dash: '3 4', parent: g });
    var wb = card(ctx, g, 70, 640, 730, 220, 'lime', 'WARP · 32 lanes, one instruction at a time (SIMT)');
    ctx.path('M692,' + (412 + 2 * 16 + 6) + ' H785 V640', { stroke: ctx.alpha('lime', 0.8), sw: 1.4, dash: '3 4', parent: g });
    ctx.text(90, 690, 'if (lane < 12) A(); else B();     // divergent branch', { size: 13, font: 'mono', color: 'amber', parent: wb });
    S.maskRows = [];
    [['pass 1 · A · 0x00000FFF', function (l) { return l < 12; }, 'lime'], ['pass 2 · B · 0xFFFFF000', function (l) { return l >= 12; }, 'orange'], ['reconverged · 0xFFFFFFFF', function () { return true; }, 'cyan']].forEach(function (R, k) {
      var rg = ctx.group({ parent: wb });
      var y = 730 + k * 36;
      ctx.text(90, y, R[0], { size: 12, font: 'mono', color: R[2], parent: rg });
      for (var l = 0; l < 32; l++) ctx.rect(330 + l * 14, y - 6, 11, 12, { rx: 2, fill: R[1](l) ? ctx.alpha(R[2], 0.85) : 'rgba(255,255,255,0.05)', parent: rg });
      S.maskRows.push(rg);
    });
    ctx.text(90, 842, 'divergence serializes the paths: time ≈ t(A) + t(B), half the lanes idle each pass', { size: 12, font: 'mono', color: 'dim', parent: wb });
    Array.prototype.forEach.call(wb.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });

    /* waves */
    var wc = card(ctx, g, 860, 160, 690, 440, 'red', 'CTAs → SMs · WAVE QUANTIZATION');
    ctx.text(880, 206, 'launch 140 CTAs (1 CTA per SM) on 132 SMs', { size: 12, font: 'mono', color: 'dim', parent: wc });
    S.smGrid = ctx.matrix(882, 226, 11, 12, { cell: 26, gap: 6, values: function () { return 'rgba(255,255,255,0.04)'; }, stroke: ctx.alpha('red', 0.35), parent: wc });
      S.waveT = ctx.text(1272, 250, 'wave –', { size: 22, font: 'display', weight: 700, color: 'white', parent: wc });
    S.waveN = ctx.text(1272, 282, '', { size: 13, font: 'mono', color: 'lime', parent: wc });
    ctx.text(1272, 360, 'SM-time used', { size: 13, font: 'mono', color: 'dim', parent: wc });
    S.effT = ctx.text(1272, 396, '', { size: 28, font: 'display', weight: 700, color: 'orange', parent: wc });
    ctx.text(1272, 430, '140 / (2 × 132)', { size: 13, font: 'mono', color: 'dim', parent: wc });
    ctx.rect(1272, 470, 14, 14, { rx: 2, fill: ctx.alpha('lime', 0.8), parent: wc });
    ctx.text(1294, 478, 'running', { size: 12, font: 'mono', color: 'text', parent: wc });
    ctx.rect(1272, 496, 14, 14, { rx: 2, fill: ctx.alpha('red', 0.25), stroke: ctx.alpha('red', 0.6), sw: 0.8, parent: wc });
    ctx.text(1294, 504, 'idle (tail)', { size: 12, font: 'mono', color: 'text', parent: wc });
    ctx.rect(1272, 522, 14, 14, { rx: 2, fill: ctx.alpha('dim', 0.35), parent: wc });
    ctx.text(1294, 530, 'finished', { size: 12, font: 'mono', color: 'text', parent: wc });
    var fc = card(ctx, g, 860, 620, 690, 240, 'amber', 'FOX SHOT · DiT QKV PROJECTION GEMM');
    ctx.para(882, 668, [
      'M × N × K = 75,600 × 15,360 × 5,120',
      '128×256 tiles → 591 × 60 = 35,460 CTAs',
      '= 268.6 waves → tail waste ≈ 0.15%  (fine)',
      'small grids (decode GEMMs, per-head ops) suffer:',
      'persistent kernels + Stream-K / split-K fix tails',
      'Hopper clusters: up to 16 CTAs share DSMEM'
    ], { size: 13, font: 'mono', color: 'text', lh: 30, parent: fc });
  }

  function paintWaves(ctx, S, t) {
    var lit = ctx.alpha('lime', 0.8), idle = ctx.alpha('red', 0.25), done = ctx.alpha('dim', 0.35), off = 'rgba(255,255,255,0.04)';
    var n1 = t < 0.4 ? Math.floor(t / 0.4 * 132) : 132;
    S.smGrid.set(function (r, c) {
      var i = r * 12 + c;
      if (t < 0.55) return i < n1 ? lit : off;
      if (t < 0.65) return done;
      return i < 8 ? lit : idle;
    });
    if (t < 0.55) { S.waveT.textContent = 'wave 1'; S.waveN.textContent = n1 + ' CTAs running'; S.effT.textContent = ''; }
    else if (t < 0.65) { S.waveT.textContent = 'wave 1 done'; S.waveN.textContent = '8 CTAs left'; }
    else { S.waveT.textContent = 'wave 2'; S.waveN.textContent = '8 running, 124 idle'; S.effT.textContent = '53%'; }
  }

  /* ================================================================ TENSOR CORE */
  function buildTC(ctx, S, g) {
    var r = ctx.rng(5);
    S.A = []; S.B = [];
    var i, j, k;
    for (i = 0; i < 8; i++) { S.A.push([]); for (k = 0; k < 4; k++) S.A[i].push(0.2 + 0.8 * r()); }
    for (k = 0; k < 4; k++) { S.B.push([]); for (j = 0; j < 8; j++) S.B[k].push(0.2 + 0.8 * r()); }
    var mx = 0;
    for (i = 0; i < 8; i++) for (j = 0; j < 8; j++) { var s = 0; for (k = 0; k < 4; k++) s += S.A[i][k] * S.B[k][j]; mx = Math.max(mx, s); }
    S.cMax = mx;
    ctx.text(80, 176, 'MMA · D = A·B + C on one warpgroup tile', { size: 14, font: 'mono', weight: 700, color: 'red', parent: g, spacing: 1 });
    S.mB = ctx.matrix(330, 206, 4, 8, { cell: 30, gap: 4, cmap: 'cyan', values: S.B, stroke: 'none', parent: g });
    S.mA = ctx.matrix(180, 350, 8, 4, { cell: 30, gap: 4, cmap: 'violet', values: S.A, stroke: 'none', parent: g });
    S.mC = ctx.matrix(330, 350, 8, 8, { cell: 30, gap: 4, cmap: 'red', values: function () { return 0.02; }, stroke: 'none', parent: g });
    ctx.text(612, 262, 'B · K×N = 16×256', { size: 13, font: 'mono', color: 'cyan', parent: g });
    ctx.text(612, 282, 'BF16, in SMEM', { size: 12, font: 'mono', color: 'dim', parent: g });
    ctx.text(246, 640, 'A · M×K = 64×16', { size: 13, font: 'mono', color: 'violet', anchor: 'middle', parent: g });
    ctx.text(246, 658, 'BF16, regs or SMEM', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    ctx.text(464, 640, 'D · M×N = 64×256', { size: 13, font: 'mono', color: 'red', anchor: 'middle', parent: g });
    ctx.text(464, 658, 'FP32 accumulators, in regs', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    S.kT = ctx.text(612, 380, 'k-slice 0 / 4', { size: 18, font: 'display', weight: 700, color: 'amber', parent: g });
    ctx.text(612, 408, 'each k-slice = rank-1', { size: 12, font: 'mono', color: 'text', parent: g });
    ctx.text(612, 426, 'outer-product update', { size: 12, font: 'mono', color: 'text', parent: g });
    var eq = ctx.group({ parent: g });
    ctx.rect(606, 456, 290, 76, { rx: 8, fill: ctx.alpha('amber', 0.08), stroke: ctx.alpha('amber', 0.6), sw: 1, parent: eq });
    ctx.text(751, 480, 'D[m,n] = C[m,n] +', { size: 14, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: eq });
    ctx.text(751, 508, 'Σₖ A[m,k] · B[k,n]', { size: 14, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: eq });
    ctx.text(612, 566, '(drawn scaled: 8×4 · 4×8)', { size: 12, font: 'mono', color: 'dim', parent: g });

    /* pipeline */
    ctx.text(80, 700, 'WARP-SPECIALIZED PIPELINE (CUTLASS / FlashAttention-3)', { size: 13, font: 'mono', weight: 700, color: 'red', parent: g, spacing: 1 });
    var names = [['HBM', 'weights, acts', 'red'], ['TMA', 'async bulk copy', 'blue'], ['SMEM ring', '4 stages', 'cyan'], ['wgmma', 'tensor cores', 'amber'], ['epilogue', 'bias · act · cast', 'teal']];
    S.pipe = names.map(function (n, q) {
      return ctx.node({ x: 150 + q * 170, y: 752, w: 142, h: 54, title: n[0], sub: n[1], titleSize: 14, subSize: 11, color: n[2], parent: g });
    });
    S.pipeLinks = [];
    for (var q = 0; q < 4; q++) S.pipeLinks.push(ctx.link(S.pipe[q], S.pipe[q + 1], { color: S.pipe[q + 1].color, parent: g }));
    ctx.text(320, 800, 'producer warp: TMA loads', { size: 12, font: 'mono', color: 'blue', anchor: 'middle', parent: g });
    ctx.text(745, 800, 'consumer warpgroups: MMA + epilogue', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
    ctx.text(490, 836, 'mbarrier handshake per stage (full / empty) overlaps copy and math', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });

    /* right */
    S.code = ctx.code({ parent: g, x: 940, y: 160, w: 610, title: 'one Hopper tensor-core instruction (PTX)', lang: 'text', size: 13, color: 'red', lines: [
      'wgmma.mma_async.sync.aligned',
      '  .m64n256k16.f32.bf16.bf16  d, descA, descB;',
      '// issued by 1 warpgroup = 4 warps = 128 threads',
      '// 2 · 64 · 256 · 16 = 524,288 FLOP, asynchronous'
    ] });
    Array.prototype.forEach.call(S.code.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
    var tb = card(ctx, g, 940, 332, 610, 238, 'red', 'DENSE PEAK · TFLOP/s');
    var cols = [960, 1180, 1370];
    [['format', 'H100 SXM', 'B200'], ['TF32', '495', '~1,100'], ['BF16 / FP16', '989', '~2,250'], ['FP8', '1,979', '~4,500'], ['FP4', '—', '~9,000']].forEach(function (row, ri) {
      row.forEach(function (cell, ci) {
        ctx.text(cols[ci], 382 + ri * 38, cell, { size: ri ? 15 : 12, font: 'mono', weight: ri && ci ? 700 : 400, color: ri === 0 ? 'dim' : (ci === 0 ? 'text' : (ci === 1 ? 'red' : 'violet')), parent: tb });
      });
    });
    var bw = card(ctx, g, 940, 590, 610, 270, 'violet', 'BLACKWELL · tcgen05 (5th-gen tensor core)');
    ctx.para(960, 640, [
      '· MMA issued by a single thread, fully async',
      '· accumulators live in Tensor Memory, 256 KB/SM',
      '· 2-CTA MMA: an SM pair shares the B tile',
      '· NVFP4: 16-value blocks + FP8 E4M3 scale',
      '· MXFP8 / MXFP4: 32-value blocks + E8M0 scale',
      '· FP4 rate = 2× FP8 = 4× BF16'
    ], { size: 13, font: 'mono', color: 'text', lh: 34, parent: bw });
  }

  function paintMMA(ctx, S, t) {
    var kf = t * 4, k = Math.min(3, Math.floor(kf)), fr = t >= 1 ? 1 : kf - k;
    S.mC.set(function (i, j) {
      var s = 0;
      for (var q = 0; q < k; q++) s += S.A[i][q] * S.B[q][j];
      s += fr * S.A[i][k] * S.B[k][j];
      return 0.03 + 0.97 * s / S.cMax;
    });
    var hi = t < 1;
    for (var i = 0; i < 8; i++) for (var q = 0; q < 4; q++) {
      S.mA.cells[i][q].setAttribute('stroke', hi && q === k ? '#ffffff' : 'none');
      S.mA.cells[i][q].setAttribute('stroke-width', 2);
      S.mB.cells[q][i].setAttribute('stroke', hi && q === k ? '#ffffff' : 'none');
      S.mB.cells[q][i].setAttribute('stroke-width', 2);
    }
    S.kT.textContent = t >= 1 ? 'k-slices 4 / 4 ✓' : 'k-slice ' + (k + 1) + ' / 4';
  }

  /* ================================================================ ROOFLINE */
  function rX(ai) { return 150 + (Math.log10(ai) + 1) / 5 * 750; }
  function rY(tf) { return 790 - (Math.log10(tf) + 1) / 5 * 600; }
  function roofD(peak, bw) {
    var ridge = peak / bw;
    return 'M' + rX(0.1) + ',' + rY(0.1 * bw) + ' L' + rX(ridge) + ',' + rY(peak) + ' L' + rX(10000) + ',' + rY(peak);
  }
  var PTS = [
    ['residual add (elementwise)', 0.17, ['y = x + f(x) in BF16: 1 FLOP per 6 bytes', '(two reads, one write) → I ≈ 0.17 FLOP/B', 'attainable ≈ 0.57 TFLOP/s: pure bandwidth', 'fix: fuse it into the GEMM epilogue so the', 'tensor never makes a round trip to HBM']],
    ['decode GEMV, batch 1', 1, ['each BF16 weight (2 B) feeds one FMA (2 FLOP)', '→ I ≈ 1 FLOP/B → 3.35 TFLOP/s = 0.34% of peak', '70B model, TP=8: 140 GB ÷ (8 × 3.35 TB/s)', '≈ 5.2 ms per token, no matter the FLOPs', 'fixes: batching, FP8/FP4 weights, speculation']],
    ['decode attention, GQA-8', 8, ['each KV element is read once per step and', 'shared by g = 8 query heads → I ≈ g', '≈ 8 FLOP/B → ~27 TFLOP/s', 'batching does not help (KV is per sequence);', 'MLA, larger g, FP8 KV cache do']],
    ['decode GEMM, batch 64', 64, ['B tokens reuse every weight B times: I ≈ B', 'B = 64 → 214 TFLOP/s (22% of peak)', 'the ridge needs B ≳ 300 tokens in flight', 'this is why continuous batching exists and', 'why decode is priced per HBM byte']],
    ['DiT attention tile (FA3)', 128, ['FA3 keeps a 128-row Q tile in SMEM and streams', 'K,V: per tile I ≈ Br = 128 FLOP/B → 429 TF/s', 'but ~132 resident CTAs of one head stream the', 'same K,V blocks together, so L2 serves most', 're-reads: effective I passes the ridge (~75% MFU)']],
    ['LLM prefill GEMM, 8k tok', 2731, ['M = N = K = 8,192 (8k tokens, d = 8,192)', 'I = MNK / (MK + KN + MN) = 8,192 / 3 ≈ 2,731', 'far right of the ridge: compute-bound', 'real kernels sustain ~70–80% of the 989 TF', 'datasheet peak (clocks droop under power cap)']],
    ['DiT QKV GEMM, 75.6k tok', 3654, ['M = 75,600 tokens, K = 5,120, N = 15,360', 'I = MNK / (MK + KN + MN) ≈ 3,650 FLOP/B', 'the video model lives on the flat roof:', 'FLOPs, not bytes, set the cost of a shot', '→ FP8 GEMMs, sparse attention, fewer steps']]
  ];

  function buildRoof(ctx, S, g) {
    var axes = ctx.group({ parent: g });
    ctx.rect(150, 190, 750, 600, { rx: 4, fill: 'rgba(8,12,24,0.7)', stroke: ctx.alpha('white', 0.15), sw: 1, parent: axes });
    [0.1, 1, 10, 100, 1000, 10000].forEach(function (v, i) {
      var x = rX(v);
      ctx.line(x, 190, x, 790, { color: ctx.alpha('white', 0.06), sw: 1, parent: axes });
      ctx.text(x, 808, ['0.1', '1', '10', '100', '1k', '10k'][i], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: axes });
    });
    [0.1, 1, 10, 100, 1000, 10000].forEach(function (v, i) {
      var y = rY(v);
      ctx.line(150, y, 900, y, { color: ctx.alpha('white', 0.06), sw: 1, parent: axes });
      ctx.text(140, y, ['0.1', '1', '10', '100', '1k', '10k'][i], { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: axes });
    });
    ctx.text(525, 836, 'arithmetic intensity I (FLOP per byte of HBM traffic, log)', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: axes });
    ctx.text(150, 174, 'attainable TFLOP/s (log)', { size: 13, font: 'mono', color: 'text', parent: axes });
    S.roofs = [];
    var R = [[989, 3.35, 'red', null, 'H100 BF16 · 989 TF · 3.35 TB/s'], [989, 4.8, 'orange', null, 'H200 BF16 · 989 TF · 4.8 TB/s'], [2250, 8, 'violet', null, 'B200 BF16 · ~2,250 TF · ~8 TB/s'], [9000, 8, 'violet', '6 5', 'B200 FP4 · ~9,000 TF dense']];
    R.forEach(function (rf, i) {
      var p = ctx.path(roofD(rf[0], rf[1]), { stroke: rf[2], sw: i === 0 ? 3 : 1.8, dash: rf[3], parent: g, glow: i === 0 });
      if (i > 0) p.setAttribute('opacity', 0.75);
      S.roofs.push(p);
      var lg = ctx.group({ parent: g });
      ctx.line(172, 214 + i * 24, 196, 214 + i * 24, { color: rf[2], sw: i === 0 ? 3 : 1.8, dash: rf[3], parent: lg });
      ctx.text(204, 214 + i * 24, rf[4], { size: 12, font: 'mono', color: 'text', parent: lg });
      S.roofs.push(lg);
    });
    var xr = rX(295);
    S.ridge = ctx.group({ parent: g });
    ctx.line(xr, rY(989), xr, 790, { color: ctx.alpha('red', 0.7), sw: 1.2, dash: '4 4', parent: S.ridge });
    ctx.label(xr, 770, 'ridge ≈ 295', { color: 'red', size: 11, parent: S.ridge });
    ctx.text(430, 575, 'memory-bound', { size: 14, font: 'display', weight: 700, color: ctx.alpha('white', 0.35), anchor: 'middle', parent: S.ridge }).setAttribute('transform', 'rotate(-38.7 430 575)');
    ctx.text(800, 410, 'compute-bound', { size: 14, font: 'display', weight: 700, color: ctx.alpha('white', 0.35), anchor: 'middle', parent: S.ridge });

    /* points */
    S.pts = [];
    PTS.forEach(function (p, i) {
      var perf = Math.min(989, p[1] * 3.35);
      var x = rX(p[1]), y = rY(perf);
      var pg = ctx.group({ parent: g });
      var hollow = i === 4;
      ctx.circle(x, y, 8, { fill: hollow ? 'rgba(8,12,24,0.9)' : 'amber', stroke: 'amber', sw: 2, parent: pg, glow: !hollow });
      var dx = 12, dy = 15;
      if (i === 5) { dx = -16; dy = 16; }
      if (i === 6) { dx = 12; dy = -16; }
      ctx.text(x + dx, y + dy, String(i + 1), { size: 13, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: pg });
      if (hollow) {
        ctx.line(x + 10, y, x + 70, y, { color: 'amber', sw: 1.5, dash: '4 3', arrow: true, parent: pg });
        ctx.text(x + 76, y, 'L2 reuse', { size: 11, font: 'mono', color: 'amber', anchor: 'start', parent: pg });
      }
      pg.style.cursor = 'pointer';
      pg.fy = y;
      S.pts.push(pg);
    });

    /* right panel */
    var eq = card(ctx, g, 940, 160, 610, 140, 'red', 'ROOFLINE MODEL');
    ctx.text(1245, 212, 'P = min( π_peak ,  I · β_HBM )', { size: 18, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: eq });
    ctx.text(960, 248, 'H100: 989 TF ÷ 3.35 TB/s → ridge I* ≈ 295 FLOP/B', { size: 13, font: 'mono', color: 'red', parent: eq });
    ctx.text(960, 276, 'H200 ≈ 206 · B200 BF16 ≈ 281 · B200 FP4 ≈ 1,125', { size: 13, font: 'mono', color: 'text', parent: eq });
    var lc = card(ctx, g, 940, 316, 610, 318, 'amber', 'KERNELS ON AN H100 · click one');
    ctx.text(1250, 338, 'I (FLOP/B)', { size: 11, font: 'mono', color: 'dim', parent: lc });
    ctx.text(1532, 338, 'attainable', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: lc });
    S.rows = PTS.map(function (p, i) {
      var y = 354 + i * 39;
      var rg = ctx.group({ parent: lc });
      var bg = ctx.rect(952, y, 586, 33, { rx: 6, fill: 'rgba(255,255,255,0.02)', stroke: 'rgba(255,255,255,0.06)', sw: 1, parent: rg });
      ctx.text(972, y + 17, String(i + 1), { size: 13, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: rg });
      ctx.text(990, y + 17, p[0], { size: 13, font: 'mono', color: 'text', parent: rg });
      ctx.text(1250, y + 17, p[1] < 1 ? String(p[1]) : p[1].toLocaleString('en-US'), { size: 13, font: 'mono', color: 'text', parent: rg });
      var perf = Math.min(989, p[1] * 3.35);
      ctx.text(1532, y + 17, (perf < 10 ? perf.toFixed(2) : Math.round(perf)) + ' TF', { size: 13, font: 'mono', weight: 700, color: perf >= 989 ? 'lime' : 'orange', anchor: 'end', parent: rg });
      rg.bg = bg;
      rg.style.cursor = 'pointer';
      return rg;
    });
    S.detail = card(ctx, g, 940, 650, 610, 210, 'amber', '');
    S.detailBody = ctx.group({ parent: S.detail });
    function select(i) {
      S.sel = i;
      S.rows.forEach(function (rg, k) {
        rg.bg.setAttribute('fill', k === i ? ctx.alpha('amber', 0.14) : 'rgba(255,255,255,0.02)');
        rg.bg.setAttribute('stroke', k === i ? ctx.alpha('amber', 0.8) : 'rgba(255,255,255,0.06)');
      });
      while (S.detailBody.firstChild) S.detailBody.removeChild(S.detailBody.firstChild);
      ctx.text(958, 674, (i + 1) + ' · ' + PTS[i][0].toUpperCase(), { size: 13, font: 'mono', weight: 700, color: 'amber', parent: S.detailBody });
      ctx.para(958, 706, PTS[i][2], { size: 13, font: 'mono', color: 'text', lh: 29, parent: S.detailBody });
    }
    S.select = select;
    S.rows.forEach(function (rg, i) { rg.addEventListener('click', function () { select(i); }); });
    S.pts.forEach(function (pg, i) { pg.addEventListener('click', function () { select(i); }); });
    select(1);
  }

  /* ================================================================ FABRIC */
  function buildFabric(ctx, S, g) {
    ctx.text(80, 176, 'RAIL-OPTIMIZED FAT-TREE · 4 of N nodes shown', { size: 14, font: 'mono', weight: 700, color: 'red', parent: g, spacing: 1 });
    var spX = [240, 430, 620, 810], lfX = [], gpu = [];
    for (var k = 0; k < 8; k++) lfX.push(115 + k * 108);
    S.upLinks = ctx.group({ parent: g });
    lfX.forEach(function (lx) { spX.forEach(function (sx) { ctx.line(lx, 422, sx, 270, { color: ctx.alpha('blue', 0.28), sw: 1, parent: S.upLinks }); }); });
    S.downLinks = ctx.group({ parent: g });
    for (var n = 0; n < 4; n++) {
      gpu.push([]);
      for (k = 0; k < 8; k++) {
        var gx = 70 + n * 230 + 18 + k * 25;
        gpu[n].push(gx);
        ctx.line(gx, 670, lfX[k], 458, { color: k === 3 ? ctx.alpha('cyan', 0.85) : ctx.alpha('cyan', 0.28), sw: k === 3 ? 1.8 : 1, parent: S.downLinks });
      }
    }
    S.spines = spX.map(function (x, i) { return ctx.node({ x: x, y: 250, w: 150, h: 40, title: 'spine ' + i, titleSize: 13, color: 'blue', parent: g }); });
    S.leaves = lfX.map(function (x, i) { return ctx.node({ x: x, y: 440, w: 92, h: 36, title: 'rail ' + i, titleSize: 12, color: i === 3 ? 'amber' : 'cyan', parent: g }); });
    S.nodes = [];
    for (n = 0; n < 4; n++) {
      var x0 = 70 + n * 230, ng = ctx.group({ parent: g });
      ctx.rect(x0, 640, 210, 120, { rx: 8, fill: 'rgba(14,10,22,0.92)', stroke: ctx.alpha('red', 0.6), parent: ng });
      ctx.text(x0 + 10, 655, 'node ' + n, { size: 12, font: 'mono', weight: 700, color: 'red', parent: ng });
      for (k = 0; k < 8; k++) {
        ctx.rect(x0 + 8 + k * 25, 670, 20, 30, { rx: 3, fill: ctx.alpha(k === 3 ? 'amber' : 'red', 0.5), stroke: k === 3 ? 'amber' : 'red', sw: 1, parent: ng });
        ctx.text(x0 + 18 + k * 25, 685, String(k), { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: ng });
      }
      ctx.rect(x0 + 8, 720, 195, 22, { rx: 4, fill: ctx.alpha('cyan', 0.14), stroke: ctx.alpha('cyan', 0.6), sw: 1, parent: ng });
      ctx.text(x0 + 105, 731, 'NVSwitch · 900 GB/s', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: ng });
      S.nodes.push(ng);
    }
    S.gpuX = gpu; S.lfX = lfX; S.spX = spX;
    ctx.para(80, 790, [
      '— same rank k → leaf k: DP all-reduce, PP send/recv = 1 switch hop',
      '- - cross-rail: leaf → spine → leaf = 3 hops, shares spine uplinks',
      '· · NCCL PXN: hop over NVLink to the GPU on the right rail first'
    ], { size: 13, font: 'mono', color: 'text', lh: 27, parent: g });

    /* bandwidth ladder */
    var bc = card(ctx, g, 1040, 160, 510, 430, 'red', 'BANDWIDTH LADDER · GB/s per direction');
    ctx.text(1534, 182, 'log scale', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: bc });
    var L = [['HBM3e (B200)', 8000, 'red'], ['HBM3 (H100)', 3350, 'red'], ['NVLink 5 (per GPU)', 900, 'cyan'], ['NVLink 4 (per GPU)', 450, 'cyan'], ['IB XDR 800G NIC', 100, 'orange'], ['PCIe Gen5 x16', 64, 'blue'], ['IB NDR 400G NIC', 50, 'orange']];
    S.ladder = [];
    L.forEach(function (b, i) {
      var y = 214 + i * 52;
      ctx.text(1060, y, b[0], { size: 12, font: 'mono', color: 'text', parent: bc });
      var w = (Math.log10(b[1]) - 1) / 3 * 330;
      var r = ctx.rect(1060, y + 11, w, 16, { rx: 3, fill: ctx.alpha(b[2], 0.55), stroke: b[2], sw: 1, parent: bc });
      r.full = w;
      S.ladder.push(r);
      ctx.text(1060 + w + 10, y + 19, b[1].toLocaleString('en-US'), { size: 13, font: 'mono', weight: 700, color: b[2], parent: bc });
    });

    /* GPUDirect RDMA */
    var gd = card(ctx, g, 1040, 610, 510, 250, 'orange', 'GPUDIRECT RDMA');
    S.gdN = [
      ctx.node({ x: 1120, y: 682, w: 120, h: 44, title: 'GPU HBM', titleSize: 13, color: 'red', parent: gd }),
      ctx.node({ x: 1295, y: 682, w: 120, h: 44, title: 'PCIe switch', titleSize: 13, color: 'blue', parent: gd }),
      ctx.node({ x: 1462, y: 682, w: 110, h: 44, title: 'NIC → wire', titleSize: 13, color: 'orange', parent: gd })
    ];
    S.gdL = [ctx.link(S.gdN[0], S.gdN[1], { color: 'orange', parent: gd, curve: 0 }), ctx.link(S.gdN[1], S.gdN[2], { color: 'orange', parent: gd, curve: 0 })];
    var host = ctx.node({ x: 1295, y: 776, w: 170, h: 36, title: 'host DRAM bounce', titleSize: 12, color: 'dim', kind: 'ghost', parent: gd });
    ctx.line(1295, 704, 1295, 758, { color: ctx.alpha('dim', 0.8), dash: '3 4', parent: gd });
    ctx.line(1204, 760, 1386, 792, { color: 'red', sw: 2, parent: gd, opacity: 0.6 });
    ctx.line(1204, 792, 1386, 760, { color: 'red', sw: 2, parent: gd, opacity: 0.6 });
    ctx.text(1295, 834, 'NIC DMAs HBM directly via PCIe P2P: no copy, no CPU', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: gd });
    host.setAttribute('opacity', 0.8);
  }

  /* ================================================================ BUDGET */
  function buildBudget(ctx, S, g) {
    S.bcode = ctx.code({ parent: g, x: 70, y: 160, w: 830, title: 'shot_03_budget.txt · fox crash-lands · 5 s · 720p', lang: 'text', size: 14, color: 'red', typing: true, maxLines: 10, lines: nbsp([
      'video    81 frames @ 16 fps, 720 × 1280',
      'latent   VAE 4×8×8 → 21 × 90 × 160 × 16 ch',
      'tokens   patch 1×2×2 → 21 × 45 × 80 = 75,600',
      'linear   2 · 14e9 params · 75,600 tok ≈ 2.1 PFLOP',
      'attn     4 · N² · d · L = 4 · 75,600² · 5,120 · 40 ≈ 4.7 PFLOP',
      'forward  ≈ 6.8 PFLOP  (attention = 69%)',
      'sample   50 steps × 2 (CFG) ≈ 0.68 EFLOP',
      '8×H100   989 TF × 40% MFU → ≈ 215 s',
      '8×B200   ~2,250 TF × 40% MFU → ≈ 94 s',
      'distill  4 steps, CFG-free → 25× fewer FLOPs'
    ]) });
    var tc = card(ctx, g, 70, 456, 830, 404, 'red', 'WHERE THE SECONDS GO · shot 3 on 8 GPUs');
    ctx.text(90, 506, 'FLOPs / forward', { size: 13, font: 'mono', color: 'text', parent: tc });
    S.split = [
      ctx.rect(290, 494, 580 * 2.1 / 6.8, 26, { rx: 3, fill: ctx.alpha('amber', 0.55), stroke: 'amber', sw: 1, parent: tc }),
      ctx.rect(290 + 580 * 2.1 / 6.8, 494, 580 * 4.7 / 6.8, 26, { rx: 3, fill: ctx.alpha('red', 0.55), stroke: 'red', sw: 1, parent: tc })
    ];
    ctx.text(290 + 290 * 2.1 / 6.8, 507, 'linear 2.1 PF', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: tc });
    ctx.text(290 + 580 * 2.1 / 6.8 + 290 * 4.7 / 6.8, 507, 'attention 4.7 PF', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: tc });
    var T = [['8×H100 · 50 steps · CFG', 215, 'red'], ['8×B200 · 50 steps · CFG', 94, 'violet'], ['8×H100 · 4-step distilled', 8.6, 'lime'], ['8×B200 · 4-step distilled', 3.8, 'lime']];
    S.tBars = [];
    T.forEach(function (b, i) {
      var y = 570 + i * 62;
      ctx.text(90, y + 10, b[0], { size: 13, font: 'mono', color: 'text', parent: tc });
      var w = Math.max(3, 440 * b[1] / 215);
      var r = ctx.rect(380, y, w, 20, { rx: 3, fill: ctx.alpha(b[2], 0.55), stroke: b[2], sw: 1, parent: tc });
      r.full = w;
      S.tBars.push(r);
      ctx.text(380 + w + 10, y + 10, b[1] + ' s', { size: 13, font: 'mono', weight: 700, color: b[2], parent: tc });
    });
    ctx.text(90, 832, 'assumes 40% MFU, Ulysses SP = 8 on NVLink; text encoder + VAE decode excluded', { size: 12, font: 'mono', color: 'dim', parent: tc });

    var ld = card(ctx, g, 940, 160, 610, 700, 'red', 'WHAT EACH LEVEL OF THE ZOOM DECIDES');
    var rows = [
      ['FABRIC', '50–100 GB/s per GPU (NIC)', 'only DP / PP / KV-transfer traffic crosses it'],
      ['RACK', '72 GPUs · 130 TB/s NVLink', 'TP / EP / SP groups up to 72 wide'],
      ['NODE', '8 GPUs · 450 GB/s/dir each', 'Ulysses SP = 8 for every fox shot'],
      ['GPU', '3.35 TB/s HBM · 989 TF', 'ridge 295: decode vs diffusion transformer'],
      ['SM', '228 KB SMEM · 256 KB RF', 'tile sizes, occupancy, pipelining depth'],
      ['WARP', '32 lanes in lockstep', 'coalescing, divergence, wave tails'],
      ['MMA', '1,024 BF16 FLOP/clk per TC', 'feed it every cycle or lose the cycle']
    ];
    S.ladRows = rows.map(function (r, i) {
      var y = 200 + i * 92;
      var rg = ctx.group({ parent: ld });
      ctx.rect(956, y, 578, 80, { rx: 8, fill: 'rgba(255,255,255,0.025)', stroke: ctx.alpha('red', 0.25), sw: 1, parent: rg });
      ctx.label(972, y + 40, r[0], { color: 'red', size: 12, anchor: 'start', w: 80, parent: rg });
      ctx.text(1072, y + 28, r[1], { size: 15, font: 'mono', weight: 700, color: 'white', parent: rg });
      ctx.text(1072, y + 54, r[2], { size: 12, font: 'mono', color: 'dim', parent: rg });
      return rg;
    });
  }

  /* ================================================================ SCENE */
  Atlas.register({
    id: 'gpu',
    refs: [
      'NVIDIA, <i>NVIDIA H100 Tensor Core GPU Architecture</i> (Hopper whitepaper), 2022',
      'NVIDIA, <i>Blackwell Architecture Technical Brief</i> and <i>GB200 NVL72</i> datasheet, 2024–2025',
      'Williams, Waterman &amp; Patterson, <i>Roofline: An Insightful Visual Performance Model for Multicore Architectures</i>, CACM 2009',
      'NVIDIA, <i>CUDA C++ Programming Guide</i> and <i>PTX ISA 8.x</i> (thread-block clusters, wgmma, tcgen05), 2024–2025',
      'Shah, Bikshandi, Zhang, Thakkar, Ramani &amp; Dao, <i>FlashAttention-3: Fast and Accurate Attention with Asynchrony and Low-precision</i>, NeurIPS 2024',
      'Osama, Merrill, Cecka, Garland &amp; Owens, <i>Stream-K: Work-centric Parallel Decomposition for Dense Matrix-Matrix Multiplication on the GPU</i>, PPoPP 2023',
      'Gangidi et al. (Meta), <i>RDMA over Ethernet for Distributed AI Training at Meta Scale</i>, SIGCOMM 2024',
      'Wan Team (Alibaba), <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 RACK */
      {
        title: 'The NVL72 rack',
        say: 'Every model call in our fox trailer eventually becomes kernels running on GPUs, so let us zoom from the outside in. This is a GB200 NVL72 rack: eighteen compute trays, each holding two Grace CPUs and four Blackwell GPUs, with nine NVLink switch trays in the middle. All seventy two GPUs form one NVLink domain. Any GPU can load, store, or reduce into any other GPU’s memory through a single switch hop, at one point eight terabytes per second each, roughly one hundred thirty terabytes per second in aggregate.',
        deep: '<p>The <b>NVLink domain</b> is the unit that matters for model parallelism: inside it, GPUs share a flat, memory-semantic fabric (load/store/atomics on peer HBM); outside it, traffic drops to NIC-based RDMA.</p>' +
          '<table><tr><th></th><th>HGX H100</th><th>GB200 NVL72</th></tr>' +
          '<tr><td>GPUs per NVLink domain</td><td>8</td><td>72</td></tr>' +
          '<tr><td>NVLink per GPU (bidir)</td><td>900 GB/s (NVLink 4)</td><td>1.8 TB/s (NVLink 5)</td></tr>' +
          '<tr><td>Switch chips</td><td>4 NVSwitch (on board)</td><td>18 NVSwitch in 9 trays</td></tr>' +
          '<tr><td>Aggregate NVLink</td><td>7.2 TB/s</td><td>130 TB/s</td></tr>' +
          '<tr><td>HBM</td><td>640 GB</td><td>up to 13.4 TB HBM3e</td></tr></table>' +
          '<div class="eq">72 × 1.8 TB/s ≈ 130 TB/s  ·  72 × ~8 TB/s ≈ 576 TB/s HBM</div>' +
          '<p>The spine is a passive copper cable cartridge (~5,000 cables) — copper, not optics, to save power at rack scale; the rack draws ~120 kW and is direct-liquid-cooled. A 72-GPU domain lets a whole MoE layer’s expert-parallel all-to-all, or a DiT’s sequence-parallel all-to-all, run at NVLink speed. Vera Rubin (announced for 2026) keeps 72 packages per rack and counts 144 dies.</p>' +
          '<div class="note">Running example: each of the 6–10 trailer shots is gang-scheduled onto GPUs of <i>one</i> domain so its per-layer all-to-all never touches the NIC.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.loops = [];
          crumb(ctx, S, [1]);
          ctx.hud('GB200 NVL72 · 72 GPUs · 130 TB/s NVLink');
          var g = freshPage(ctx, S);
          buildRack(ctx, S, g);
          ctx.reveal(S.trays, { from: 'left', stagger: 30, dur: 400 });
          ctx.reveal(S.spine, { from: 'draw', delay: 700, dur: 700 });
          ctx.reveal(S.rackCard, { from: 'up', delay: 300 });
          ctx.reveal(S.genCard, { from: 'up', delay: 700 });
          ctx.reveal(S.nvlDots, { from: 'scale', delay: 1100, stagger: 8, dur: 300 });
          ctx.counter(S.big72, 0, 72, 1300);
          var y3 = S.trayY[2], y15 = S.trayY[21], sw5 = S.trayY[14], y7 = S.trayY[6], y24 = S.trayY[25];
          var pa = ctx.path('M459,' + y3 + ' H510 V' + sw5 + ' H470 H510 V' + y15 + ' H355', { stroke: ctx.alpha('amber', 0.0), parent: g });
          var pb = ctx.path('M305,' + y24 + ' H510 V' + S.trayY[12] + ' H340 H510 V' + y7 + ' H407', { stroke: ctx.alpha('cyan', 0.0), parent: g });
          return ctx.wait(1500).then(function () {
            S.loops.push(ctx.stream(S.spine, { color: 'cyan', count: 5, period: 1800, r: 3 }));
            return Promise.all([
              ctx.packet(pa, { color: 'amber', dur: 1800, label: 'store' }),
              ctx.packet(pb, { color: 'lime', dur: 1800, label: 'reduce' })
            ]);
          });
        }
      },
      /* ------------------------------------------------------------ 2 NODE */
      {
        title: 'Eight-GPU node',
        say: 'Most fleets still run the classic eight GPU node, so zoom into one. Each H100 has eighteen NVLink links, spread over four NVSwitch chips, giving four hundred fifty gigabytes per second in each direction, nine hundred in total, to every peer in the box. Each GPU also owns one four hundred gigabit InfiniBand NIC, which is only fifty gigabytes per second per direction. That nine times cliff at the edge of the node is the single most important fact in distributed inference: chatty tensor and sequence parallel traffic must stay on NVLink.',
        deep: '<p><b>HGX/DGX H100 topology</b>: 8 × H100 SXM5, 4 × third-gen NVSwitch (64 NVLink4 ports each). Each GPU’s 18 links are split 5·4·4·5 across the switches, so every GPU pair is one hop apart and the fabric is non-blocking.</p>' +
          '<div class="eq">18 links × 25 GB/s/dir = 450 GB/s/dir = 900 GB/s bidirectional</div>' +
          '<p>Off-node: one ConnectX-7 per GPU (400 Gb/s = 50 GB/s/dir) behind a PCIe Gen5 switch — the “rail”. <b>NVLS</b> (NVLink SHARP) lets NVSwitch perform the reduction of an all-reduce in-network, roughly halving GPU-side traffic.</p>' +
          '<p>Why the cliff matters, for one fox shot with Ulysses sequence parallelism over 8 GPUs: each layer does 4 all-to-alls (Q, K, V, O), each GPU sending 7/8 of its N/8 × d BF16 slice:</p>' +
          '<div class="eq">4 × (75,600/8) × 5,120 × 2 B × 7/8 ≈ 339 MB per layer per GPU</div>' +
          '<table><tr><th>Link</th><th>time / layer</th><th>vs attention (~25 ms)</th></tr>' +
          '<tr><td>NVLink4 450 GB/s</td><td>0.75 ms</td><td>3%</td></tr>' +
          '<tr><td>IB NDR 50 GB/s</td><td>6.8 ms</td><td>27%</td></tr></table>' +
          '<div class="note">Placement rule: TP and SP groups ⊆ one NVLink domain; DP and PP may cross the NIC.</div>',
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [2]);
          ctx.hud('per direction: NVLink 450 GB/s vs NIC 50 GB/s → 9× cliff');
          return zoomInto(ctx, S, 722, 670, 4.2, function (g) { buildNode(ctx, S, g); }).then(function () {
            ctx.reveal(S.nvLinks, { from: 'draw', stagger: 12, dur: 400 });
            S.bwBars.forEach(function (b, i) { ctx.animate(b, { width: [0, b.full] }, 700, 'out', 200 + i * 150); });
            var pairs = [[0, 5, 0], [6, 1, 1], [3, 7, 2], [4, 2, 3]];
            return ctx.wait(700).then(function () {
              return Promise.all(pairs.map(function (p, k) {
                var a = 110 + p[0] * 100, b = 110 + p[1] * 100, s = [183, 363, 543, 723][p[2]];
                var path = ctx.path('M' + a + ',347 L' + s + ',466 L' + b + ',347', { stroke: 'rgba(0,0,0,0)', parent: S.page });
                return ctx.packet(path, { color: ['amber', 'lime', 'cyan', 'magenta'][k], dur: 1300, r: 4 });
              }));
            }).then(function () {
              S.loops.push(ctx.loop(function (t) {
                var k = Math.floor(t * 2) % 32;
                S.nvLinks.forEach(function (l, i) { l.setAttribute('stroke', i === k ? ctx.C.cyan : ctx.alpha('cyan', 0.4)); l.setAttribute('stroke-width', i === k ? 2.2 : 1); });
              }));
            });
          });
        }
      },
      /* ------------------------------------------------------------ 3 DIE */
      {
        title: 'The H100 die',
        say: 'Now zoom into one GPU. The H100 die holds eight graphics processing clusters with one hundred thirty two streaming multiprocessors enabled. Between them sits a fifty megabyte L2 cache, split into two partitions. Around the die, five stacks of HBM3 deliver eighty gigabytes at three point three five terabytes per second. Multiply it out: one hundred thirty two SMs, times four tensor cores, times one thousand twenty four operations per clock, at about one point eight gigahertz, gives roughly nine hundred eighty nine teraflops of dense BF16.',
        deep: '<p><b>GH100</b>: 8 GPCs × 9 TPCs × 2 SMs = 144 SMs on die; the H100 SXM5 ships with 132 enabled (66 TPCs) for yield. 80 B transistors, TSMC 4N, ~814 mm², 700 W.</p>' +
          '<div class="eq">π<sub>BF16</sub> = 132 SM × 4 TC × 1,024 FLOP/clk × 1.83 GHz ≈ 989 TFLOP/s</div>' +
          '<p>(1,024 FLOP/clk = 512 dense BF16 FMAs per tensor core per clock; FP8 doubles it → 1,979 TF. The 1.83 GHz is the clock implied by the datasheet peak.)</p>' +
          '<table><tr><th>Part</th><th>HBM</th><th>BW</th><th>Dense BF16</th></tr>' +
          '<tr><td>H100 SXM5</td><td>80 GB HBM3</td><td>3.35 TB/s</td><td>989 TF</td></tr>' +
          '<tr><td>H200</td><td>141 GB HBM3e</td><td>4.8 TB/s</td><td>989 TF</td></tr>' +
          '<tr><td>B200</td><td>192 GB HBM3e (180–186 exposed)</td><td>~8 TB/s</td><td>~2.25 PF</td></tr></table>' +
          '<p>B200 is two reticle-limited dies joined by a 10 TB/s NV-HBI link and presented as one GPU. The L2 is split into two partitions linked by a crossbar; data resident in the “far” partition costs extra latency. Every weight and activation crosses the <b>HBM → L2 → SM</b> path — which is why the next steps care so much about bytes.</p>',
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [3]);
          ctx.hud('H100: 132 SMs · 50 MB L2 · 80 GB @ 3.35 TB/s');
          return zoomInto(ctx, S, 110, 310, 5, function (g) { buildDie(ctx, S, g); }).then(function () {
            S.hbmPaths.forEach(function (p) { S.loops.push(ctx.stream(p, { color: 'red', count: 3, period: 1400, r: 3 })); });
            S.loops.push(ctx.loop(function (t) {
              for (var i = 0; i < S.smCells.length; i++) {
                var c = S.smCells[i];
                var v = 0.3 + 0.6 * Math.max(0, Math.sin(t * 2.6 - (c.cx + c.cy * 0.6) / 70));
                c.setAttribute('fill', ctx.cmap('red', v));
              }
            }));
            return ctx.counter(S.tflops, 0, 989, 1600).then(function () { return ctx.pulse(S.eq, { color: 'amber', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 4 SM */
      {
        title: 'Inside an SM',
        say: 'Zoom into a single streaming multiprocessor. It is split into four sub-partitions. Each has its own warp scheduler, a sixty four kilobyte slice of the register file, thirty two FP32 lanes, and one tensor core. Together they share two hundred fifty six kilobytes of L1 and shared memory. The trick that makes GPUs fast is on the right: when a warp stalls on a memory load that takes hundreds of cycles, the scheduler simply issues from another ready warp. With enough warps resident the latency disappears; with too few, the issue slot sits idle.',
        deep: '<p><b>Hopper SM</b> = 4 SM sub-partitions (SMSPs). Each SMSP per clock can issue one warp-instruction; it owns 16,384 × 32-bit registers (64 KB), 32 FP32, 16 INT32, 16 FP64 lanes, 1 fourth-gen tensor core, LD/ST and SFU units. The SM shares 256 KB of L1/SMEM (≤ 228 KB carve-out as shared memory, ≤ 227 KB per block) and a TMA engine.</p>' +
          '<p><b>Latency hiding</b> is the GPU’s substitute for big caches and out-of-order cores: a stalled warp costs nothing if another is eligible. The chart simulates loose round-robin scheduling (bursts of 2 instructions, then a load stall of 10–16 cycles; real HBM latency is ~0.5 µs ≈ 900 clocks, so the warps needed scale up accordingly).</p>' +
          '<div class="eq">occupancy = resident warps / 64   ·   warps ≤ 65,536 / (32 · regs per thread)</div>' +
          '<div class="eq">Little: bytes in flight = β × latency = 3.35 TB/s × 0.5 µs ≈ 1.7 MB ≈ 13 KB per SM</div>' +
          '<p>Hopper decouples this from occupancy: <b>TMA</b> bulk copies and <code>cp.async</code> put bytes in flight without holding registers, so a GEMM with only 1–2 CTAs per SM (low occupancy, huge tiles) can still saturate HBM. Occupancy is a means, not the goal.</p>',
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [4]);
          ctx.hud('SM: 4 schedulers · 256 KB RF · 228 KB SMEM');
          return zoomInto(ctx, S, 457, 278, 9, function (g) { buildSM(ctx, S, g); }).then(function () {
            return ctx.tween(3000, function (t) { paintWarps(ctx, S, Math.round(t * 32)); }, 'linear');
          }).then(function () {
            S.cursor = ctx.rect(990, 202, 14, 188, { rx: 2, stroke: 'white', sw: 1.5, parent: S.latCard });
            S.loops.push(ctx.loop(function (t) {
              var c = Math.floor(t * 5) % 32;
              S.cursor.setAttribute('x', 989 + c * 16);
              var issuing = -1;
              for (var w = 0; w < 12; w++) if (S.sim.grid[w][c] === 2) issuing = w;
              S.slots[0].forEach(function (s, k) {
                var st = k < 12 ? S.sim.grid[k][c] : -1;
                s.setAttribute('fill', k === issuing ? ctx.C.red : (st === 1 ? ctx.alpha('violet', 0.5) : (st === 0 ? ctx.alpha('cyan', 0.45) : 'rgba(255,255,255,0.06)')));
              });
            }));
            return ctx.pulse(S.tcs[0], { color: 'red', dur: 800 });
          });
        }
      },
      /* ------------------------------------------------------------ 5 SIMT */
      {
        title: 'Threads, warps, grid',
        say: 'This is the programming model the scheduler serves. A kernel launches a grid of thread blocks. Each block runs on one SM and shares its fast shared memory, and the hardware slices it into warps of thirty two threads that execute one instruction together. If lanes in a warp take different branches, the paths run one after another with lanes masked off. And blocks arrive in waves: launch one hundred forty blocks on one hundred thirty two SMs, and the second wave runs only eight of them, wasting almost half the machine.',
        deep: '<p><b>SIMT hierarchy</b>: grid → thread-block clusters (Hopper, ≤ 8 portable / 16 non-portable CTAs with distributed shared memory) → CTAs (≤ 1,024 threads, one SM for life) → warps (32 threads, one program counter per warp for issue) → lanes.</p>' +
          '<ul><li><b>Divergence</b>: a branch that splits a warp executes both paths under active masks; cost ≈ t<sub>A</sub> + t<sub>B</sub>. Independent thread scheduling (Volta+) allows interleaving but not parallelism of the two paths.</li>' +
          '<li><b>Coalescing</b>: 32 lanes loading 32 consecutive 4-byte words = one 128-byte transaction; strided access multiplies traffic.</li>' +
          '<li><b>Wave quantization</b>: with T tiles on P SMs (1 CTA/SM),</li></ul>' +
          '<div class="eq">efficiency = T / (P · ⌈T/P⌉)  →  140 / (132 · 2) = 53%</div>' +
          '<p>For the fox shot’s QKV GEMM (M = 75,600, N = 15,360) with 128×256 tiles, T = 591 × 60 = 35,460 → 268.6 waves; tail loss ≈ 0.4 / 269 ≈ 0.15%. Decode GEMMs with a handful of tiles are where it bites: <b>Stream-K</b> splits the K-loop across SMs so every SM gets equal work; persistent kernels loop over tiles and overlap one tile’s epilogue with the next tile’s mainloop.</p>',
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [5]);
          ctx.hud('warp = 32 threads · CTA → 1 SM · waves of 132');
          return zoomInto(ctx, S, 378, 243, 7, function (g) { buildSIMT(ctx, S, g); }).then(function () {
            ctx.reveal(S.maskRows, { from: 'left', stagger: 500, dur: 500 });
            return ctx.tween(3200, function (t) { paintWaves(ctx, S, t); }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------ 6 MMA */
      {
        title: 'Tensor core MMA',
        say: 'At the bottom of the zoom is the tensor core. It computes a small matrix multiply and accumulate, D equals A times B plus C, in hardware. On Hopper, a warp group of one hundred twenty eight threads issues one asynchronous instruction that multiplies a sixty four by sixteen tile by a sixteen by two hundred fifty six tile, over half a million floating point operations. A dedicated copy engine, the TMA, streams tiles from HBM into a ring of shared memory buffers so the tensor cores never wait. Blackwell adds tensor memory and four bit floating point.',
        deep: '<p>A GEMM <code>C[M,N] = A[M,K]·B[K,N]</code> is tiled three times: CTA tile (e.g. 128×256) in SMEM, warpgroup tile (64×256) per <code>wgmma</code>, and K-slices of 16. Each K-slice is a sum of rank-1 outer products — what the animation accumulates.</p>' +
          '<div class="eq">FLOP per wgmma.m64n256k16 = 2 · 64 · 256 · 16 = 524,288</div>' +
          '<p><b>Warp specialization</b> (CUTLASS 3, FlashAttention-3): a producer warp issues TMA copies into a 3–5 stage SMEM ring; consumer warpgroups run <code>wgmma</code> and the epilogue. <code>mbarrier</code> “full/empty” flags per stage let copy and math overlap perfectly — the only way to hit &gt;70% of 989 TF.</p>' +
          '<pre>for k_tile in range(K // 64):          # consumer\n  wait(full[s]); wgmma(A[s], B[s], acc)\n  arrive(empty[s]); s = (s + 1) % STAGES</pre>' +
          '<p><b>Precision</b>: inputs BF16/FP16 → FP32 accumulate; FP8 E4M3/E5M2 doubles throughput (per-tensor or per-block scales). Blackwell <code>tcgen05.mma</code> is issued by one thread, accumulates in 256 KB of <b>Tensor Memory</b> per SM (freeing registers), supports 2-SM cooperative MMA, and adds block-scaled <b>NVFP4</b> (16-value blocks, E4M3 scale + FP32 tensor scale) and OCP <b>MX</b> formats (32-value blocks, E8M0 scale).</p>',
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [6]);
          ctx.hud('wgmma m64n256k16 = 524,288 FLOP / instruction');
          return zoomInto(ctx, S, 446, 458, 6, function (g) { buildTC(ctx, S, g); }).then(function () {
            for (var q = 0; q < 4; q++) S.loops.push(ctx.stream(S.pipeLinks[q], { color: S.pipe[q + 1].color, count: 2, period: 1100, r: 3 }));
            return ctx.tween(3600, function (t) { paintMMA(ctx, S, t); }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------ 7 ROOFLINE */
      {
        title: 'Roofline',
        say: 'Zoom back out and ask the key question: is a kernel limited by math or by memory? The roofline answers it. Attainable throughput is the minimum of peak compute, and arithmetic intensity times memory bandwidth. On an H100, the ridge sits near two hundred ninety five operations per byte. LLM decoding at batch one does about one operation per byte, so it runs at a fraction of a percent of peak. Prefill and the video diffusion transformer sit far to the right, on the flat compute roof. Click any point to see its derivation.',
        deep: '<div class="eq">P(I) = min(π, I · β)   ·   I* = π / β</div>' +
          '<p><b>I</b> = FLOPs / bytes moved to and from HBM (not FLOPs per byte of the tensor — reuse in SMEM/L2 raises it). With π = 989 TF and β = 3.35 TB/s, I* ≈ 295 FLOP/B; H200’s larger β lowers the ridge to ~206, which is why H200 decodes faster at identical FLOPs.</p>' +
          '<table><tr><th>Kernel</th><th>I</th><th>Bound</th></tr>' +
          '<tr><td>decode GEMV (b = 1)</td><td>≈ 1</td><td>HBM</td></tr>' +
          '<tr><td>decode GEMM (b = B)</td><td>≈ B</td><td>HBM until B ≈ 300</td></tr>' +
          '<tr><td>GQA decode attention</td><td>≈ group size g</td><td>HBM</td></tr>' +
          '<tr><td>GEMM M×N×K</td><td>MNK / (MK+KN+MN)</td><td>compute if all dims ≫ 300</td></tr></table>' +
          '<p>Consequences for the video system: the <b>LLM agents</b> (decode) are priced in HBM bytes — batching, quantized weights and KV compression pay off; the <b>video DiT</b> is priced in FLOPs — FP8 GEMMs, sparse/sliding attention, fewer sampling steps and caching pay off. Same GPU, opposite optimizations; hence separate serving pools.</p>' +
          '<div class="note">The roofline is an upper bound. Real kernels also hit L2/SMEM rooflines, instruction-issue limits and power-capped clocks.</div>',
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [3]);
          ctx.hud('ridge = 989 TF ÷ 3.35 TB/s ≈ 295 FLOP/byte');
          return zoomOut(ctx, S, function (g) { buildRoof(ctx, S, g); }).then(function () {
            ctx.reveal(S.roofs, { from: 'draw', stagger: 200, dur: 700 });
            ctx.reveal(S.ridge, { delay: 800 });
            S.pts.forEach(function (pg, i) {
              pg.setAttribute('opacity', 0);
              ctx.tween(700, function (t) {
                pg.setAttribute('opacity', t.toFixed(3));
                ctx.place(pg, 0, -(1 - t) * 120);
              }, 'out', 1000 + i * 260);
            });
            return ctx.wait(1000 + 7 * 260 + 700).then(function () {
              return ctx.pulse(S.pts[1], { color: 'amber', dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 8 FABRIC */
      {
        title: 'Scale-out fabric',
        say: 'Beyond the NVLink domain, GPUs talk over a scale-out fabric. Each GPU has its own NIC, and GPUDirect RDMA lets that NIC read and write GPU memory directly, without touching the CPU. The fabric is rail optimized: GPU zero of every node plugs into leaf switch zero, GPU one into leaf one, and so on. Data parallel and pipeline traffic flows between same-rank GPUs, so it crosses a single switch. Traffic between different rails must climb to the spine, taking three hops, unless NCCL first moves it across NVLink to the right rail.',
        deep: '<p><b>Rail-optimized fat-tree</b>: in a cluster of 8-GPU nodes, NIC k of every node connects to leaf (rail) switch k. Collectives are organized so that rank-k GPUs exchange data among themselves (NCCL rings/trees per rail), so almost all traffic is 1 hop and spine uplinks can be oversubscribed or even removed (“rail-only” designs).</p>' +
          '<ul><li><b>GPUDirect RDMA</b>: the NIC DMA-reads/writes HBM through PCIe peer-to-peer (BAR mapping); no staging in host DRAM, no CPU on the data path. <b>GPUDirect Async / IBGDA</b> goes further — GPU threads ring the NIC doorbell themselves (used by DeepEP for MoE all-to-all).</li>' +
          '<li><b>PXN</b> (PCI × NVLink): to reach GPU j on another node, NCCL first moves data over NVLink to local GPU j, then sends on rail j — trading cheap NVLink bytes for spine hops.</li>' +
          '<li><b>Transport</b>: InfiniBand NDR 400 Gb/s (ConnectX-7) → XDR 800 Gb/s (ConnectX-8), or RoCEv2 Ethernet (Spectrum-X, Meta’s 24k-GPU RoCE clusters) with ECN/DCQCN or receiver-driven congestion control; Ultra Ethernet targets the same space.</li></ul>' +
          '<div class="eq">NVLink4 450 GB/s/dir ÷ NDR 50 GB/s/dir = 9×</div>' +
          '<p>Mapping rule this implies (see the Distributed Parallelism chamber): TP/SP/EP inside the NVLink domain, PP between neighbouring nodes, DP across rails.</p>',
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [0]);
          ctx.hud('rail k ↔ leaf k: same-rank traffic = 1 switch hop');
          return zoomOut(ctx, S, function (g) { buildFabric(ctx, S, g); }).then(function () {
            S.ladder.forEach(function (b, i) { ctx.animate(b, { width: [0, b.full] }, 700, 'out', i * 120); });
            S.loops.push(ctx.stream(S.gdL[0], { color: 'orange', count: 2, period: 1200, r: 3 }));
            S.loops.push(ctx.stream(S.gdL[1], { color: 'orange', count: 2, period: 1200, r: 3 }));
            var same = [];
            for (var k = 0; k < 8; k++) {
              same.push(ctx.path('M' + S.gpuX[0][k] + ',670 L' + S.lfX[k] + ',458 L' + S.gpuX[2][k] + ',670', { stroke: 'rgba(0,0,0,0)', parent: S.page }));
            }
            var cross = ctx.path('M' + S.gpuX[1][1] + ',670 L' + S.lfX[1] + ',458 L' + S.lfX[1] + ',422 L' + S.spX[1] + ',270 L' + S.lfX[6] + ',422 L' + S.lfX[6] + ',458 L' + S.gpuX[3][6] + ',670', { stroke: ctx.alpha('orange', 0.85), sw: 2, dash: '6 5', parent: S.downLinks });
            var pxn = ctx.path('M' + S.gpuX[1][1] + ',700 L' + S.gpuX[1][1] + ',711 L' + S.gpuX[1][6] + ',711 L' + S.gpuX[1][6] + ',670 L' + S.lfX[6] + ',458 L' + S.gpuX[3][6] + ',670', { stroke: ctx.alpha('teal', 0.9), sw: 2, dash: '2 5', parent: S.page });
            cross.setAttribute('opacity', 0); pxn.setAttribute('opacity', 0);
            return ctx.wait(800).then(function () {
              return Promise.all(same.map(function (p, k) { return ctx.packet(p, { color: k === 3 ? 'amber' : 'cyan', dur: 1400, r: 4 }); }));
            }).then(function () {
              ctx.reveal(cross, { from: 'draw', dur: 700 });
              return ctx.packet(cross, { color: 'orange', dur: 1800, label: '3 hops' });
            }).then(function () {
              ctx.reveal(pxn, { from: 'draw', dur: 700 });
              return ctx.packet(pxn, { color: 'teal', dur: 1800, label: 'PXN' });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 9 BUDGET */
      {
        title: 'Budget one shot',
        say: 'Let us put the whole stack to work on one shot of the fox trailer. Five seconds of seven twenty p video becomes seventy five thousand six hundred latent tokens. One forward pass of a fourteen billion parameter diffusion transformer costs about six point eight petaflops, and more than two thirds of that is attention. Fifty steps with classifier free guidance make it about zero point seven exaflops: three and a half minutes on eight H100s, about a minute and a half on B200s, or seconds once the model is distilled. Every level of this zoom sets one of those numbers.',
        deep: '<p>A Wan-2.1-14B-class DiT (d = 5,120, L = 40 blocks) generating 81 frames at 720p:</p>' +
          '<div class="eq">tokens N = (1 + 80/4) · (720/16) · (1280/16) = 21 · 45 · 80 = 75,600</div>' +
          '<div class="eq">FLOP<sub>fwd</sub> ≈ 2·P·N + 4·N²·d·L = 2.1 + 4.7 ≈ 6.8 PFLOP</div>' +
          '<div class="eq">FLOP<sub>shot</sub> ≈ 6.8 P × 50 steps × 2 (CFG) ≈ 0.68 EFLOP</div>' +
          '<p>At 40% MFU on 8 × H100 (3.2 PFLOP/s effective) that is ≈ 215 s; on 8 × B200 (~2.25 PF dense each) ≈ 94 s. Attention is 69% of FLOPs at this length — quadratic in N — which is why production stacks use FP8 attention (SageAttention/FA3-FP8), sparse or sliding-window spatiotemporal attention, step-level feature caching, and 4–8 step distilled students (≈ 25× fewer forwards than 50 × 2).</p>' +
          '<table><tr><th>Level</th><th>What it decides for the trailer</th></tr>' +
          '<tr><td>MMA / SM</td><td>MFU of each GEMM and attention tile</td></tr>' +
          '<tr><td>GPU</td><td>memory-bound agents vs compute-bound renders</td></tr>' +
          '<tr><td>Node / rack</td><td>sequence-parallel degree per shot</td></tr>' +
          '<tr><td>Fabric</td><td>how many shots and agents run concurrently</td></tr></table>' +
          '<div class="note">Next: the <b>Distributed Parallelism</b> chamber shows how DP, TP, PP, EP and SP carve a model across exactly this hierarchy.</div>',
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [0, 1, 2, 3, 4, 5, 6]);
          ctx.hud('one shot ≈ 0.68 EFLOP ≈ 3.6 min on 8×H100');
          stopLoops(S);
          var old = S.page;
          return ctx.fadeOut(old, 600, true).then(function () {
            var g = freshPage(ctx, S);
            buildBudget(ctx, S, g);
            S.tBars.forEach(function (b) { b.setAttribute('width', 0); });
            ctx.reveal(g, { from: 'up', dur: 600 });
            ctx.reveal(S.ladRows, { from: 'right', stagger: 160, delay: 300 });
            return S.bcode.typeAll().then(function () {
              return Promise.all(S.tBars.map(function (b, i) { return ctx.animate(b, { width: [0, b.full] }, 800, 'out', i * 200); }));
            });
          });
        }
      }
    ]
  });
})();
