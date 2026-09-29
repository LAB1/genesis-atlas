/* L2 — Inside the GPU & Interconnect. A camera zoom from an NVL72 rack down to one tensor-core MMA
 * (rack -> node -> die -> SM -> warp -> tensor core), then back out: roofline analysis, the scale-out
 * RDMA fabric, and a FLOP / time budget for one shot of the fox-astronaut trailer.
 * Beat format: every step is built once (all page elements exist from the start) and then revealed
 * beat by beat; each beat has its own narration, callout card, deep-dive chunk and animation segment. */
(function () {
  var CRUMBS = ['FABRIC', 'RACK', 'NODE', 'GPU', 'SM', 'WARP', 'MMA'];

  function bx(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    g.frame = ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    /* the title is a lighter tint of the card colour: readable on dark, and darker (not washed out) in the light theme */
    if (title) ctx.text(x + 16, y + 22, title, { size: 13, font: 'mono', weight: 700, color: ctx.mix(color, 'white', 0.3), parent: g, spacing: 1 });
    g.x0 = x; g.y0 = y; g.w0 = w;
    g.box = bx(x, y, w, h);
    return g;
  }

  /* grow a card frame to height h as its content arrives (keeps .box in sync for pulses) */
  function fit(ctx, g, h, ms) {
    var cur = parseFloat(g.frame.getAttribute('height'));
    g.box = bx(g.x0, g.y0, g.w0, h);
    return ctx.animate(g.frame, { height: [cur, h] }, ms || 500, 'out');
  }

  function stopLoops(S) {
    (S.loops || []).forEach(function (l) { l.stop(); });
    S.loops = [];
  }

  /* red, magenta, blue, violet and pink text turns pale in the inverted light theme: lighten it a little
     (big numerals are left alone) so small labels stay legible in both themes */
  function soften(ctx, root) {
    var map = {};
    ['red', 'magenta', 'blue', 'violet', 'pink'].forEach(function (n) { map[String(ctx.C[n]).toLowerCase()] = ctx.mix(n, 'white', 0.42); });
    var ts = root.getElementsByTagName('text');
    for (var i = 0; i < ts.length; i++) {
      var f = (ts[i].getAttribute('fill') || '').toLowerCase();
      if (map[f] && parseFloat(ts[i].getAttribute('font-size')) < 30) ts[i].setAttribute('fill', map[f]);
    }
  }

  /* hide one element or a list of them (opacity 0) so a later beat can ctx.reveal() them */
  function hide(els) { [].concat(els).forEach(function (e) { if (e) e.setAttribute('opacity', 0); }); }
  function kids(g) { return Array.prototype.slice.call(g.childNodes); }

  /* grow bars from zero width; the value label (b.lab) fades in when the bar is nearly done */
  function grow(ctx, bars, dur, gap, delay) {
    return Promise.all(bars.map(function (b, i) {
      if (b.lab) ctx.reveal(b.lab, { dur: 300, delay: (delay || 0) + i * gap + dur * 0.6 });
      return ctx.animate(b, { width: [0, b.full] }, dur, 'out', (delay || 0) + i * gap);
    }));
  }
  function zeroBars(bars) { bars.forEach(function (b) { b.setAttribute('width', 0); if (b.lab) b.lab.setAttribute('opacity', 0); }); }

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
      soften(ctx, S.crumb);
      ctx.reveal(S.crumb, { from: 'down', dur: 500 });
    }
    S.crumbEls.forEach(function (el, i) {
      ctx.fade(el, active.indexOf(i) >= 0 ? 1 : 0.68, 400);
    });
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
      soften(ctx, g);
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
      soften(ctx, g);
      var p = ctx.reveal(g, { from: 'scale', s0: 1.5, dur: 850, ease: 'out' });
      ctx.camera(null, null, null, 1);
      return p;
    });
  }

  /* ================================================================ RACK */
  function buildRack(ctx, S, g) {
    S.rackHead = ctx.group({ parent: g });
    ctx.rect(150, 166, 380, 700, { rx: 10, fill: 'rgba(8,12,24,0.94)', stroke: ctx.alpha('red', 0.7), sw: 1.6, parent: S.rackHead, glow: true });
    ctx.text(340, 184, 'GB200 NVL72 · ONE RACK', { size: 12, font: 'mono', weight: 700, color: 'red', anchor: 'middle', parent: S.rackHead, spacing: 1 });
    ctx.text(340, 850, '~120 kW · direct liquid cooling', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.rackHead });
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
        ctx.text(168, y + 10, 'SW' + si, { size: 11, font: 'mono', color: 'cyan', parent: t });
        ctx.rect(230, y + 3, 110, 13, { rx: 2, fill: ctx.alpha('cyan', 0.3), stroke: 'cyan', sw: 1, parent: t });
        ctx.rect(360, y + 3, 110, 13, { rx: 2, fill: ctx.alpha('cyan', 0.3), stroke: 'cyan', sw: 1, parent: t });
      } else {
        ci++;
        ctx.text(168, y + 10, 'CT' + (ci < 10 ? '0' : '') + ci, { size: 11, font: 'mono', color: 'dim', parent: t });
        ctx.rect(212, y + 3, 30, 13, { rx: 2, fill: ctx.alpha('blue', 0.3), stroke: 'blue', sw: 1, parent: t });
        ctx.rect(246, y + 3, 30, 13, { rx: 2, fill: ctx.alpha('blue', 0.3), stroke: 'blue', sw: 1, parent: t });
        for (var j = 0; j < 4; j++) {
          S.rackGpu.push(ctx.rect(288 + j * 50, y + 3, 44, 13, { rx: 2, fill: ctx.alpha('red', 0.45), stroke: 'red', sw: 1, parent: t }));
        }
      }
      ctx.line(492, y + 9.5, 510, y + 9.5, { color: ctx.alpha('cyan', 0.6), sw: 1.2, parent: t });
      S.trays.push(t);
    }
    S.spineG = ctx.group({ parent: g });
    S.spine = ctx.path('M510,' + S.trayY[0] + ' L510,' + S.trayY[26], { stroke: ctx.alpha('cyan', 0.75), sw: 3, parent: S.spineG });
    var sl = ctx.text(548, 516, 'NVLINK SPINE · 5,000+ copper cables', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.spineG });
    sl.setAttribute('transform', 'rotate(-90 548 516)');

    /* first-beat annotations: what a compute tray and a switch tray are (removed when the domain card arrives) */
    S.callouts = ctx.group({ parent: g });
    [[S.trayY[0], 'COMPUTE TRAY × 18', 'red', '1U blade: 2 Grace CPUs + 4 Blackwell GPUs', 'front-panel NICs and DPUs; liquid cold plates on the chips'],
     [S.trayY[12], 'NVLINK SWITCH TRAY × 9', 'cyan', '2 NVLink-5 switch chips per tray, 18 in the rack', 'every GPU has one link to every switch chip']].forEach(function (c) {
      ctx.line(494, c[0], 600, c[0], { color: ctx.alpha(c[2], 0.8), sw: 1.4, dash: '4 4', parent: S.callouts });
      ctx.label(612, c[0], c[1], { color: c[2], size: 12, anchor: 'start', parent: S.callouts });
      ctx.text(612, c[0] + 34, c[3], { size: 14, font: 'mono', color: 'white', parent: S.callouts });
      ctx.text(612, c[0] + 60, c[4], { size: 12, font: 'mono', color: 'dim', parent: S.callouts });
    });

    /* card A: the domain */
    S.rackCard = card(ctx, g, 590, 160, 960, 200, 'red', 'ONE NVLINK DOMAIN');
    S.big72 = ctx.text(610, 232, '0', { size: 64, font: 'display', weight: 700, color: 'red', parent: S.rackCard, glow: true });
    ctx.text(720, 222, 'GPUs share one memory fabric', { size: 18, font: 'display', weight: 700, color: 'white', parent: S.rackCard });
    S.rackSub = ctx.text(720, 248, 'load / store / atomics to any peer HBM, one switch hop', { size: 13, font: 'mono', color: 'dim', parent: S.rackCard });
    S.rackLines = ctx.para(612, 296, [
      '18 compute trays × (2 Grace CPU + 4 Blackwell GPU) = 72 GPUs',
      '9 switch trays × 2 NVLink-5 switch chips = 18 NVSwitch',
      'NVLink 5: 18 links × 100 GB/s = 1.8 TB/s bidir per GPU → 130 TB/s',
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
    S.genWhy = ctx.para(1290, 600, ['Why it matters:', 'TP / EP / SP traffic', 'must stay inside the', 'domain. Step outside', 'and bandwidth per GPU', 'drops 9–18× (NIC).'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: S.genCard });
    S.genFox = ctx.text(1070, 842, 'the fox trailer’s DiT shots are gang-scheduled onto one domain', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: S.genCard });
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
        S.nvLinks.push(ctx.path('M' + x + ',347 L' + sx + ',466', { stroke: ctx.alpha('cyan', 0.4), sw: 1, parent: S.fan }));
      });
    });
    S.nicG = ctx.group({ parent: g });
    S.gpuG = ctx.group({ parent: g });
    xs.forEach(function (x, k) {
      ctx.line(x, 211, x, 273, { color: ctx.alpha('blue', 0.8), sw: 1.4, dash: '4 4', parent: S.nicG });
      ctx.node({ x: x, y: 196, w: 86, h: 30, title: 'CX-7 400G', titleSize: 11, color: 'blue', kind: 'pill', glow: false, parent: S.nicG });
      S.nodeGpu.push(ctx.node({ x: x, y: 310, w: 88, h: 74, title: 'GPU ' + k, sub: 'H100 80GB', titleSize: 14, subSize: 11, color: 'red', parent: S.gpuG }));
    });
    S.swG = ctx.group({ parent: g });
    swx.forEach(function (sx, k) {
      S.nodeSw.push(ctx.node({ x: sx, y: 490, w: 150, h: 48, title: 'NVSwitch ' + k, sub: '64 NVLink4 ports', titleSize: 13, subSize: 11, color: 'cyan', kind: 'chip', parent: S.swG }));
    });
    S.cpuG = ctx.group({ parent: g });
    ctx.node({ x: 270, y: 620, w: 300, h: 54, title: 'CPU 0 · Xeon', sub: '1 TB DDR5 · PCIe Gen5 switches', titleSize: 13, subSize: 11, color: 'blue', icon: 'chip', parent: S.cpuG });
    ctx.node({ x: 640, y: 620, w: 300, h: 54, title: 'CPU 1 · Xeon', sub: '1 TB DDR5 · PCIe Gen5 switches', titleSize: 13, subSize: 11, color: 'blue', icon: 'chip', parent: S.cpuG });
    /* legend: a line swatch per link type, then the caption (the third row arrives with the NICs) */
    S.nodePara = ctx.group({ parent: g });
    S.nodeLn = [];
    [[704, 'cyan', null, 'NVLink4: 18 links per GPU, split 5·4·4·5 over 4 NVSwitch = 900 GB/s bidir'],
     [738, null, null, 'any GPU → any GPU is one switch hop; NVLS reduces inside the switch (SHARP)'],
     [772, 'blue', '4 4', 'PCIe Gen5 x16 to one ConnectX-7 per GPU: 400 Gb/s = 50 GB/s per direction']].forEach(function (L) {
      var lg = ctx.group({ parent: S.nodePara });
      if (L[1]) ctx.path('M80,' + L[0] + ' H106', { stroke: L[1], sw: 2, dash: L[2], parent: lg });
      ctx.text(118, L[0], L[3], { size: 13, font: 'mono', color: 'text', parent: lg });
      S.nodeLn.push(lg);
    });

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
      b.lab = ctx.text(944 + w + 10, y + 26, r[1].toLocaleString('en-US'), { size: 14, font: 'mono', weight: 700, color: r[2], parent: S.bwCard });
      S.bwBars.push(b);
    });
    S.cliffTxt = ctx.para(944, 516, ['450 ÷ 50 = 9× cliff at the node boundary:', 'keep tensor / sequence-parallel traffic on NVLink'], { size: 13, font: 'mono', color: 'amber', lh: 22, parent: S.bwCard });

    S.foxCard = card(ctx, g, 920, 584, 630, 276, 'amber', 'FOX SHOT ON THIS NODE (Ulysses SP = 8)');
    S.foxLines = ctx.para(944, 640, [
      '14B video DiT · 75,600 tokens · d = 5,120',
      'per layer per GPU: 4 all-to-alls ≈ 340 MB',
      'NVLink4 450 GB/s → 0.75 ms  (attention ≈ 25 ms)',
      'IB NDR 50 GB/s → 6.8 ms  (+27% of attention time)',
      'verdict: SP group = one NVLink domain'
    ], { size: 13, font: 'mono', color: 'text', lh: 40, parent: S.foxCard });
  }

  /* ================================================================ DIE */
  var DISABLED = { 0: 8, 2: 3, 3: 6, 5: 1, 6: 5, 7: 7 };
  function buildDie(ctx, S, g) {
    S.dieFrame = ctx.group({ parent: g });
    ctx.rect(190, 176, 700, 566, { rx: 12, fill: 'rgba(12,10,20,0.95)', stroke: ctx.alpha('red', 0.75), sw: 1.8, parent: S.dieFrame, glow: true });
    ctx.rect(206, 186, 670, 26, { rx: 4, fill: ctx.alpha('white', 0.04), stroke: ctx.alpha('white', 0.2), sw: 1, parent: S.dieFrame });
    ctx.text(541, 199, 'GigaThread engine (CTA scheduler) · PCIe Gen5 host interface', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.dieFrame });
    ctx.rect(206, 700, 670, 28, { rx: 4, fill: ctx.alpha('cyan', 0.08), stroke: ctx.alpha('cyan', 0.4), sw: 1, parent: S.dieFrame });
    ctx.text(541, 714, '18 × NVLink4 PHY · 900 GB/s   |   PCIe Gen5 x16', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.dieFrame });
    ctx.text(541, 766, 'GH100 · 144 SMs on die, 132 enabled (6 TPCs fused off for yield)', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.dieFrame });
    S.smCells = []; S.gpcs = [];
    for (var gi = 0; gi < 8; gi++) {
      var gg = ctx.group({ parent: g });
      S.gpcs.push(gg);
      var gx = 206 + (gi % 4) * 170, gy = gi < 4 ? 222 : 498;
      ctx.rect(gx, gy, 158, 156, { rx: 6, fill: ctx.alpha('red', 0.05), stroke: ctx.alpha('red', 0.4), sw: 1, parent: gg });
      ctx.text(gx + 8, gy + 14, 'GPC ' + gi, { size: 11, font: 'mono', weight: 700, color: 'red', parent: gg });
      for (var c = 0; c < 9; c++) {
        var off = DISABLED[gi] === c;
        for (var r = 0; r < 2; r++) {
          var cell = ctx.rect(gx + 6 + c * 17, gy + 28 + r * 62, 14, 56, {
            rx: 2, fill: off ? 'rgba(120,130,150,0.08)' : ctx.cmap('red', 0.35), stroke: off ? ctx.alpha('dim', 0.5) : ctx.alpha('red', 0.6), sw: 0.8, dash: off ? '2 2' : null, parent: gg
          });
          if (!off) { cell.cx = gx + 13 + c * 17; cell.cy = gy + 56 + r * 62; S.smCells.push(cell); }
        }
      }
    }
    S.l2G = ctx.group({ parent: g });
    S.l2 = [];
    [[206, 'partition 0'], [552, 'partition 1']].forEach(function (p) {
      var gr = ctx.group({ parent: S.l2G });
      ctx.rect(p[0], 390, 324, 96, { rx: 6, fill: ctx.alpha('blue', 0.14), stroke: 'blue', sw: 1.3, parent: gr });
      ctx.text(p[0] + 162, 428, 'L2 cache · half of 50 MB', { size: 16, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: gr });
      ctx.text(p[0] + 162, 452, p[1], { size: 11, font: 'mono', color: 'blue', anchor: 'middle', parent: gr });
      S.l2.push(gr);
    });
    ctx.text(541, 438, '⇄', { size: 16, color: 'blue', anchor: 'middle', parent: S.l2G });

    /* HBM stacks, memory controllers and the paths between them and L2 */
    S.hbmG = ctx.group({ parent: g });
    ctx.rect(206, 664, 670, 26, { rx: 4, fill: ctx.alpha('red', 0.08), stroke: ctx.alpha('red', 0.35), sw: 1, parent: S.hbmG });
    ctx.text(541, 677, '10 × 512-bit HBM3 memory controllers (5,120-bit bus)', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: S.hbmG });
    S.hbmPaths = [];
    [[66, 224], [66, 394], [66, 564], [914, 224], [914, 394], [914, 564]].forEach(function (h, i) {
      var dead = i === 5;
      ctx.rect(h[0], h[1], 100, 128, { rx: 6, fill: dead ? 'rgba(120,130,150,0.06)' : ctx.alpha('red', 0.14), stroke: dead ? ctx.alpha('dim', 0.6) : 'red', sw: 1.3, dash: dead ? '4 4' : null, parent: S.hbmG });
      for (var l = 0; l < 4; l++) ctx.line(h[0] + 10, h[1] + 34 + l * 18, h[0] + 90, h[1] + 34 + l * 18, { color: ctx.alpha(dead ? 'dim' : 'red', 0.35), sw: 1, parent: S.hbmG });
      ctx.text(h[0] + 50, h[1] + 16, dead ? 'unused' : 'HBM3', { size: 13, font: 'mono', weight: 700, color: dead ? 'dim' : 'white', anchor: 'middle', parent: S.hbmG });
      ctx.text(h[0] + 50, h[1] + 112, dead ? 'no stack' : '16 GB', { size: 12, font: 'mono', color: dead ? 'dim' : 'red', anchor: 'middle', parent: S.hbmG });
      if (!dead) {
        var left = h[0] < 500;
        var sx = left ? 166 : 914, sy = h[1] + 64, tx = left ? 206 : 876;
        S.hbmPaths.push(ctx.path('M' + sx + ',' + sy + ' C' + (left ? 196 : 884) + ',' + sy + ' ' + (left ? 180 : 900) + ',438 ' + tx + ',438', { stroke: ctx.alpha('red', 0.5), sw: 2, parent: S.hbmG }));
      }
    });

    /* card A: what is on the die */
    S.dieCard = card(ctx, g, 1050, 160, 500, 120, 'red', 'H100 SXM5 · GH100');
    S.dieLines = ctx.para(1072, 218, [
      '132 SMs enabled (of 144)',
      '528 tensor cores · 16,896 FP32 lanes',
      'L2 cache 50 MB (two partitions)',
      'HBM3 80 GB (5 × 16 GB) · 3.35 TB/s'
    ], { size: 13, font: 'mono', color: 'text', lh: 30, parent: S.dieCard });
    /* card B: the peak-FLOPs multiplication */
    S.peakCard = card(ctx, g, 1050, 372, 500, 246, 'amber', 'DENSE BF16 PEAK');
    S.tflops = ctx.text(1070, 442, '0', { size: 52, font: 'display', weight: 700, color: 'red', parent: S.peakCard, glow: true });
    ctx.text(1250, 432, 'TFLOP/s', { size: 16, font: 'display', weight: 700, color: 'white', parent: S.peakCard });
    ctx.text(1250, 454, 'dense BF16', { size: 12, font: 'mono', color: 'dim', parent: S.peakCard });
    S.eq = ctx.group({ parent: S.peakCard });
    ctx.rect(1066, 484, 468, 62, { rx: 8, fill: ctx.alpha('amber', 0.08), stroke: ctx.alpha('amber', 0.6), sw: 1, parent: S.eq });
    ctx.text(1300, 505, '132 SM × 4 TC × 1,024 FLOP/clk', { size: 14, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: S.eq });
    ctx.text(1300, 530, '× 1.83 GHz ≈ 989 TFLOP/s', { size: 14, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: S.eq });
    S.peakLines = ctx.para(1072, 574, ['FP8 dense 1,979 TFLOP/s', '700 W · 80 B transistors · TSMC 4N'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: S.peakCard });
    /* card C: newer parts */
    S.newCard = card(ctx, g, 1050, 634, 500, 196, 'red', 'SAME RECIPE, NEWER PARTS');
    S.newLines = ctx.para(1072, 694, [
      'H200  141 GB HBM3e · 4.8 TB/s',
      '      same GH100 compute',
      'B200  2 dies, NV-HBI 10 TB/s link',
      '      192 GB HBM3e · ~8 TB/s',
      '      ~2.25 PF BF16 · FP4 tensor cores'
    ], { size: 13, color: 'text', lh: 26, pre: true, parent: S.newCard });
    S.dieNote = ctx.text(1300, 850, 'HBM → L2 → SMs: all 132 SMs share 3.35 TB/s', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
  }

  /* ================================================================ SM */
  function buildSMSP(ctx, g, k, x0, y0, S) {
    var fr = ctx.group({ parent: g });
    ctx.rect(x0, y0, 395, 280, { rx: 8, fill: 'rgba(14,18,34,0.92)', stroke: ctx.alpha('red', 0.45), parent: fr });
    ctx.text(x0 + 10, y0 + 13, 'SMSP ' + k + ' · L0 I-cache', { size: 12, font: 'mono', color: 'dim', parent: fr });
    S.smspFr.push(fr);
    var inn = ctx.group({ parent: g });
    S.smspIn.push(inn);
    ctx.rect(x0 + 8, y0 + 24, 379, 38, { rx: 5, fill: ctx.alpha('red', 0.12), stroke: ctx.alpha('red', 0.7), sw: 1, parent: inn });
    ctx.text(x0 + 18, y0 + 43, 'WARP SCHEDULER + DISPATCH', { size: 12, font: 'mono', weight: 700, color: 'red', parent: inn });
    var slots = [];
    for (var s = 0; s < 16; s++) slots.push(ctx.rect(x0 + 240 + s * 9, y0 + 38, 7.5, 10, { rx: 2, fill: ctx.alpha('violet', 0.35), parent: inn }));
    S.slots.push(slots);
    ctx.rect(x0 + 8, y0 + 70, 379, 30, { rx: 5, fill: ctx.alpha('blue', 0.12), stroke: ctx.alpha('blue', 0.7), sw: 1, parent: inn });
    ctx.text(x0 + 197, y0 + 85, 'REGISTER FILE · 16,384 × 32-bit = 64 KB', { size: 12, font: 'mono', color: 'blue', anchor: 'middle', parent: inn });
    function unit(ux, w, cols, name, count, col) {
      ctx.rect(x0 + ux, y0 + 108, w, 112, { rx: 5, fill: ctx.alpha(col, 0.05), stroke: ctx.alpha(col, 0.35), sw: 1, parent: inn });
      var gw = cols * 13 - 2, sx = x0 + ux + (w - gw) / 2;
      for (var r = 0; r < 4; r++) for (var c = 0; c < cols; c++) {
        ctx.rect(sx + c * 13, y0 + 118 + r * 13, 11, 11, { rx: 2, fill: ctx.alpha(col, 0.5), parent: inn });
      }
      ctx.text(x0 + ux + w / 2, y0 + 188, name, { size: 12, font: 'mono', weight: 700, color: col, anchor: 'middle', parent: inn });
      ctx.text(x0 + ux + w / 2, y0 + 206, '× ' + count, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: inn });
    }
    unit(8, 70, 4, 'INT32', 16, 'teal');
    unit(84, 112, 8, 'FP32', 32, 'cyan');
    unit(202, 70, 4, 'FP64', 16, 'violet');
    var tc = ctx.group({ parent: inn });
    ctx.rect(x0 + 278, y0 + 108, 109, 112, { rx: 6, fill: ctx.alpha('red', 0.22), stroke: 'red', sw: 1.6, parent: tc, glow: true });
    ctx.text(x0 + 332.5, y0 + 138, 'TENSOR', { size: 13, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: tc });
    ctx.text(x0 + 332.5, y0 + 156, 'CORE', { size: 13, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: tc });
    ctx.text(x0 + 332.5, y0 + 180, '4th gen', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: tc });
    ctx.text(x0 + 332.5, y0 + 200, '1,024 FLOP/clk', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: tc });
    S.tcs.push(tc);
    ctx.rect(x0 + 8, y0 + 228, 186, 42, { rx: 5, fill: ctx.alpha('blue', 0.06), stroke: ctx.alpha('blue', 0.4), sw: 1, parent: inn });
    ctx.text(x0 + 101, y0 + 249, 'LD/ST × 8', { size: 12, font: 'mono', color: 'blue', anchor: 'middle', parent: inn });
    ctx.rect(x0 + 201, y0 + 228, 186, 42, { rx: 5, fill: ctx.alpha('amber', 0.06), stroke: ctx.alpha('amber', 0.4), sw: 1, parent: inn });
    ctx.text(x0 + 294, y0 + 249, 'SFU × 4 (exp, rsqrt)', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: inn });
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
    S.slots = []; S.tcs = []; S.smspFr = []; S.smspIn = [];
    S.smFrame = ctx.group({ parent: g });
    ctx.rect(70, 168, 830, 694, { rx: 12, fill: 'rgba(10,10,20,0.95)', stroke: ctx.alpha('red', 0.75), sw: 1.8, parent: S.smFrame, glow: true });
    ctx.text(485, 185, 'STREAMING MULTIPROCESSOR (Hopper SM) · L1 instruction cache', { size: 12, font: 'mono', weight: 700, color: 'red', anchor: 'middle', parent: S.smFrame, spacing: 1 });
    for (var k = 0; k < 4; k++) buildSMSP(ctx, g, k, 84 + (k % 2) * 405, 200 + Math.floor(k / 2) * 290, S);
    S.l1G = ctx.group({ parent: g });
    ctx.rect(84, 780, 800, 36, { rx: 6, fill: ctx.alpha('blue', 0.14), stroke: 'blue', sw: 1.3, parent: S.l1G });
    ctx.text(484, 798, '256 KB L1 data cache / shared memory  (up to 228 KB as SMEM)', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: S.l1G });
    ctx.rect(84, 822, 800, 30, { rx: 6, fill: ctx.alpha('cyan', 0.08), stroke: ctx.alpha('cyan', 0.5), sw: 1, parent: S.l1G });
    ctx.text(484, 837, 'TMA async bulk-copy engine · texture units · DSMEM link to cluster peers', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.l1G });

    /* latency hiding panel */
    var sim = simWarps(12, 32, 2, ctx.rng(11));
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
    S.utilG = ctx.group({ parent: S.latCard });
    S.utilBars = [];
    [['issue slot busy · 12 warps', sim.util, 'lime', 466], ['issue slot busy · 4 warps', sim4.util, 'orange', 492]].forEach(function (U) {
      ctx.text(950, U[3], U[0], { size: 13, font: 'mono', color: 'text', parent: S.utilG });
      var b = ctx.rect(1190, U[3] - 9, 250 * U[1], 16, { rx: 3, fill: ctx.alpha(U[2], 0.6), stroke: U[2], sw: 1, parent: S.utilG });
      b.full = 250 * U[1];
      b.lab = ctx.text(1535, U[3], Math.round(U[1] * 100) + '%', { size: 13, font: 'mono', weight: 700, color: U[2], anchor: 'end', parent: S.utilG });
      S.utilBars.push(b);
    });
    S.occCard = card(ctx, g, 930, 530, 620, 330, 'red', 'OCCUPANCY & LITTLE’S LAW');
    S.occLines = ctx.para(952, 580, [
      '≤ 64 warps (2,048 threads) resident per SM',
      '65,536 regs/SM: 128 regs/thread → 16 warps',
      '                255 regs/thread →  8 warps',
      'assumed DRAM latency ≈ 0.5 µs ≈ 900 clocks',
      'bytes in flight = 3.35 TB/s × 0.5 µs ≈ 1.7 MB',
      '→ ~13 KB outstanding per SM, all the time',
      'TMA / cp.async keep it in flight without regs'
    ], { size: 13, color: 'text', lh: 36, pre: true, parent: S.occCard });
  }

  function paintWarps(ctx, S, upto) {
    var cols = { 0: ctx.alpha('cyan', 0.3), 1: ctx.alpha('violet', 0.45), 2: ctx.alpha('red', 0.95) };
    S.wm.set(function (r, c) { return c < upto ? cols[S.sim.grid[r][c]] : 'rgba(255,255,255,0.03)'; });
  }

  /* ================================================================ SIMT */
  function buildSIMT(ctx, S, g) {
    S.gridCard = card(ctx, g, 70, 170, 730, 180, 'red', 'GRID · one kernel launch, CTAs scheduled independently');
    S.blocks = ctx.matrix(100, 210, 4, 20, { cell: 22, gap: 6, values: function (r, c) { return (r === 1 && c === 5) ? ctx.alpha('amber', 0.9) : ctx.alpha('red', 0.3); }, parent: S.gridCard });
    ctx.text(100, 334, 'blockIdx = (x, y) · gridDim = (60, 591) for the fox QKV GEMM', { size: 12, font: 'mono', color: 'dim', parent: S.gridCard });
    S.ctaCard = card(ctx, g, 70, 370, 730, 255, 'amber', 'THREAD BLOCK (CTA) · 256 threads = 8 warps · shares SMEM');
    var wr = [];
    for (var i = 0; i < 8; i++) wr.push('warp ' + i);
    S.warps = ctx.matrix(180, 412, 8, 32, { cell: 13, gap: 3, rowLabels: wr, values: function (r) { return r === 2 ? ctx.alpha('lime', 0.8) : ctx.alpha('amber', 0.35); }, parent: S.ctaCard });
    ctx.text(90, 566, 'threadIdx.x = 32 · warp + lane · __syncthreads() is a CTA barrier', { size: 12, font: 'mono', color: 'text', parent: S.ctaCard });
    ctx.text(90, 594, 'one CTA lives on one SM for its lifetime · ≤ 32 CTAs, ≤ 64 warps per SM', { size: 12, font: 'mono', color: 'text', parent: S.ctaCard });
    var p1 = S.blocks.cellCenter(1, 5);
    S.wire1 = ctx.path('M' + (p1.x + 11) + ',' + p1.y + ' H785 V370', { stroke: ctx.alpha('amber', 0.8), sw: 1.4, dash: '3 4', parent: g });
    S.warpCard = card(ctx, g, 70, 640, 730, 220, 'lime', 'WARP · 32 lanes, one instruction at a time (SIMT)');
    S.wire2 = ctx.path('M692,' + (412 + 2 * 16 + 6) + ' H785 V640', { stroke: ctx.alpha('lime', 0.8), sw: 1.4, dash: '3 4', parent: g });
    ctx.text(90, 690, 'if (lane < 12) A(); else B();     // divergent branch', { size: 13, color: 'amber', pre: true, parent: S.warpCard });
    S.maskRows = [];
    [['pass 1 · A · 0x00000FFF', function (l) { return l < 12; }, 'lime'], ['pass 2 · B · 0xFFFFF000', function (l) { return l >= 12; }, 'orange'], ['reconverged · 0xFFFFFFFF', function () { return true; }, 'cyan']].forEach(function (R, k) {
      var rg = ctx.group({ parent: S.warpCard });
      var y = 730 + k * 36;
      ctx.text(90, y, R[0], { size: 12, font: 'mono', color: R[2], parent: rg });
      for (var l = 0; l < 32; l++) ctx.rect(330 + l * 14, y - 6, 11, 12, { rx: 2, fill: R[1](l) ? ctx.alpha(R[2], 0.85) : 'rgba(255,255,255,0.05)', parent: rg });
      S.maskRows.push(rg);
    });
    S.divNote = ctx.text(90, 842, 'divergence serializes the paths: time ≈ t(A) + t(B), half the lanes idle each pass', { size: 12, font: 'mono', color: 'dim', parent: S.warpCard });

    /* waves */
    S.waveCard = card(ctx, g, 860, 160, 690, 440, 'red', 'CTAs → SMs · WAVE QUANTIZATION');
    var wc = S.waveCard;
    S.waveSub = ctx.text(880, 206, 'launch 140 CTAs (1 CTA per SM) on 132 SMs', { size: 12, font: 'mono', color: 'dim', parent: wc });
    S.smGrid = ctx.matrix(882, 226, 11, 12, { cell: 26, gap: 6, values: function () { return 'rgba(255,255,255,0.04)'; }, stroke: ctx.alpha('red', 0.35), parent: wc });
    S.waveT = ctx.text(1272, 250, 'wave –', { size: 22, font: 'display', weight: 700, color: 'white', parent: wc });
    S.waveN = ctx.text(1272, 282, '', { size: 13, font: 'mono', color: 'lime', parent: wc });
    ctx.text(1272, 360, 'SM-time used', { size: 13, font: 'mono', color: 'dim', parent: wc });
    S.effT = ctx.text(1272, 396, '', { size: 28, font: 'display', weight: 700, color: 'orange', parent: wc });
    S.effF = ctx.text(1272, 430, '140 / (2 × 132)', { size: 13, font: 'mono', color: 'dim', parent: wc });
    ctx.rect(1272, 470, 14, 14, { rx: 2, fill: ctx.alpha('lime', 0.8), parent: wc });
    ctx.text(1294, 478, 'running', { size: 12, font: 'mono', color: 'text', parent: wc });
    ctx.rect(1272, 496, 14, 14, { rx: 2, fill: ctx.alpha('red', 0.25), stroke: ctx.alpha('red', 0.6), sw: 0.8, parent: wc });
    ctx.text(1294, 504, 'idle (tail)', { size: 12, font: 'mono', color: 'text', parent: wc });
    ctx.rect(1272, 522, 14, 14, { rx: 2, fill: ctx.alpha('dim', 0.35), parent: wc });
    ctx.text(1294, 530, 'finished', { size: 12, font: 'mono', color: 'text', parent: wc });
    S.waveHint = ctx.group({ parent: wc });
    ctx.text(1272, 558, 'click the SM grid to', { size: 12, font: 'mono', color: 'amber', parent: S.waveHint });
    ctx.text(1272, 576, 'try other launch sizes', { size: 12, font: 'mono', color: 'amber', parent: S.waveHint });
    S.gemmCard = card(ctx, g, 860, 620, 690, 240, 'amber', 'FOX SHOT · DiT QKV PROJECTION GEMM');
    S.gemmLines = ctx.para(882, 668, [
      'M × N × K = 75,600 × 15,360 × 5,120',
      '128×256 tiles → 591 × 60 = 35,460 CTAs',
      '= 268.6 waves → tail waste ≈ 0.14%  (fine)',
      'small grids (decode GEMMs, per-head ops) suffer:',
      'persistent kernels + Stream-K / split-K fix tails',
      'Hopper clusters: up to 16 CTAs share DSMEM'
    ], { size: 13, font: 'mono', color: 'text', lh: 30, parent: S.gemmCard });
  }

  /* final state of a launch of T blocks, one CTA per SM, on 132 SMs: the last wave, its idle tail and the
     SM-time efficiency T / (P · ceil(T/P)). Also drives the click-to-resize demo of the last beat. */
  function showLaunch(ctx, S, T) {
    var P = 132, W = Math.ceil(T / P), r = T - P * (W - 1), eff = T / (P * W);
    S.smGrid.set(function (rr, c) { return rr * 12 + c < r ? ctx.alpha('lime', 0.8) : ctx.alpha('red', 0.25); });
    S.waveSub.textContent = 'launch ' + T.toLocaleString('en-US') + ' CTAs (1 CTA per SM) on 132 SMs';
    S.waveT.textContent = 'wave ' + W;
    S.waveN.textContent = r + ' running, ' + (P - r) + ' idle';
    S.effT.textContent = (eff > 0.9995 ? '100' : eff >= 0.995 ? (eff * 100).toFixed(1) : String(Math.round(eff * 100))) + '%';
    S.effF.textContent = T.toLocaleString('en-US') + ' / (' + W + ' × 132)';
  }

  function paintWaves(ctx, S, t) {
    var lit = ctx.alpha('lime', 0.8), done = ctx.alpha('dim', 0.35), off = 'rgba(255,255,255,0.04)';
    var n1 = t < 0.4 ? Math.floor(t / 0.4 * 132) : 132;
    if (t >= 0.65) { showLaunch(ctx, S, 140); return; }
    S.smGrid.set(function (r, c) {
      var i = r * 12 + c;
      if (t < 0.55) return i < n1 ? lit : off;
      return done;
    });
    if (t < 0.55) { S.waveT.textContent = 'wave 1'; S.waveN.textContent = n1 + ' CTAs running'; S.effT.textContent = ''; }
    else { S.waveT.textContent = 'wave 1 done'; S.waveN.textContent = '8 CTAs left'; }
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
    S.tcMats = ctx.group({ parent: g });
    var M = S.tcMats;
    ctx.text(80, 176, 'MMA · D = A·B + C on one warpgroup tile', { size: 14, font: 'mono', weight: 700, color: 'red', parent: M, spacing: 1 });
    S.mB = ctx.matrix(330, 206, 4, 8, { cell: 30, gap: 4, cmap: 'cyan', values: S.B, stroke: 'none', parent: M });
    S.mA = ctx.matrix(180, 350, 8, 4, { cell: 30, gap: 4, cmap: 'violet', values: S.A, stroke: 'none', parent: M });
    S.mC = ctx.matrix(330, 350, 8, 8, { cell: 30, gap: 4, cmap: 'red', values: function () { return 0.02; }, stroke: 'none', parent: M });
    ctx.text(612, 262, 'B · K×N = 16×256', { size: 13, font: 'mono', color: 'cyan', parent: M });
    ctx.text(612, 282, 'BF16, in SMEM', { size: 12, font: 'mono', color: 'dim', parent: M });
    ctx.text(246, 640, 'A · M×K = 64×16', { size: 13, font: 'mono', color: 'violet', anchor: 'middle', parent: M });
    ctx.text(246, 658, 'BF16, regs or SMEM', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: M });
    ctx.text(464, 640, 'D · M×N = 64×256', { size: 13, font: 'mono', color: 'red', anchor: 'middle', parent: M });
    ctx.text(464, 658, 'FP32 accumulators, in regs', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: M });
    var eq = ctx.group({ parent: M });
    ctx.rect(606, 456, 290, 76, { rx: 8, fill: ctx.alpha('amber', 0.08), stroke: ctx.alpha('amber', 0.6), sw: 1, parent: eq });
    ctx.text(751, 480, 'D[m,n] = C[m,n] +', { size: 14, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: eq });
    ctx.text(751, 508, 'Σₖ A[m,k] · B[k,n]', { size: 14, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: eq });
    ctx.text(612, 566, '(drawn scaled: 8×4 · 4×8)', { size: 12, font: 'mono', color: 'dim', parent: M });
    S.kG = ctx.group({ parent: g });
    S.kT = ctx.text(612, 380, 'k-slice 0 / 4', { size: 18, font: 'display', weight: 700, color: 'amber', parent: S.kG });
    ctx.text(612, 408, 'each k-slice = rank-1', { size: 12, font: 'mono', color: 'text', parent: S.kG });
    ctx.text(612, 426, 'outer-product update', { size: 12, font: 'mono', color: 'text', parent: S.kG });

    /* pipeline */
    S.pipeG = ctx.group({ parent: g });
    ctx.text(80, 700, 'WARP-SPECIALIZED PIPELINE (CUTLASS / FlashAttention-3)', { size: 13, font: 'mono', weight: 700, color: 'red', parent: S.pipeG, spacing: 1 });
    var names = [['HBM', 'weights, acts', 'red'], ['TMA', 'async bulk copy', 'blue'], ['SMEM ring', '4 stages', 'cyan'], ['wgmma', 'tensor cores', 'amber'], ['epilogue', 'bias · act · cast', 'teal']];
    S.pipe = names.map(function (n, q) {
      return ctx.node({ x: 150 + q * 170, y: 752, w: 142, h: 54, title: n[0], sub: n[1], titleSize: 14, subSize: 11, color: n[2], parent: S.pipeG });
    });
    S.pipeLinks = [];
    for (var q = 0; q < 4; q++) S.pipeLinks.push(ctx.link(S.pipe[q], S.pipe[q + 1], { color: S.pipe[q + 1].color, parent: S.pipeG }));
    ctx.text(320, 800, 'producer warp: TMA loads', { size: 12, font: 'mono', color: 'blue', anchor: 'middle', parent: S.pipeG });
    ctx.text(745, 800, 'consumer warpgroups: MMA + epilogue', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: S.pipeG });
    ctx.text(490, 836, 'mbarrier handshake per stage (full / empty) overlaps copy and math', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.pipeG });

    /* right */
    S.code = ctx.code({ parent: g, x: 940, y: 160, w: 610, title: 'one Hopper tensor-core instruction (PTX)', lang: 'text', size: 13, color: 'red', typing: true, lines: [
      'wgmma.mma_async.sync.aligned',
      '  .m64n256k16.f32.bf16.bf16  d, descA, descB, …;',
      '// issued by 1 warpgroup = 4 warps = 128 threads',
      '// 2 · 64 · 256 · 16 = 524,288 FLOP, asynchronous'
    ] });
    S.peakCard = card(ctx, g, 940, 332, 610, 238, 'red', 'DENSE PEAK · TFLOP/s');
    var tb = S.peakCard;
    var cols = [960, 1180, 1370];
    [['format', 'H100 SXM', 'B200'], ['TF32', '495', '~1,100'], ['BF16 / FP16', '989', '~2,250'], ['FP8', '1,979', '~4,500'], ['FP4', '—', '~9,000']].forEach(function (row, ri) {
      row.forEach(function (cell, ci) {
        ctx.text(cols[ci], 382 + ri * 38, cell, { size: ri ? 15 : 12, font: 'mono', weight: ri && ci ? 700 : 400, color: ri === 0 ? 'dim' : (ci === 0 ? 'text' : (ci === 1 ? 'red' : 'violet')), parent: tb });
      });
    });
    S.bwCard2 = card(ctx, g, 940, 590, 610, 270, 'violet', 'BLACKWELL · tcgen05 (5th-gen tensor core)');
    S.bwLines = ctx.para(960, 640, [
      '· MMA issued by a single thread, fully async',
      '· accumulators live in Tensor Memory, 256 KB/SM',
      '· 2-CTA MMA: an SM pair works on one tile',
      '· NVFP4: 16-value blocks + FP8 E4M3 scale',
      '· MXFP8 / MXFP4: 32-value blocks + E8M0 scale',
      '· FP4 rate = 2× FP8 = 4× BF16'
    ], { size: 13, font: 'mono', color: 'text', lh: 34, parent: S.bwCard2 });
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
    ['residual add (elementwise)', 0.167, ['y = x + f(x) in BF16: 1 FLOP per 6 bytes', '(two reads, one write) → I = 1/6 ≈ 0.17 FLOP/B', 'attainable ≈ 0.56 TFLOP/s: pure bandwidth', 'fix: fuse it into the GEMM epilogue so the', 'tensor never makes a round trip to HBM']],
    ['decode GEMV, batch 1', 1, ['each BF16 weight (2 B) feeds one FMA (2 FLOP)', '→ I ≈ 1 FLOP/B → 3.35 TFLOP/s = 0.34% of peak', '70B model, TP=8: 140 GB ÷ (8 × 3.35 TB/s)', '≈ 5.2 ms per token, no matter the FLOPs', 'fixes: batching, FP8/FP4 weights, speculation']],
    ['decode attention, GQA-8', 8, ['each KV element is read once per step and', 'shared by g = 8 query heads → I ≈ g', '≈ 8 FLOP/B → ~27 TFLOP/s', 'batching does not help (KV is per sequence);', 'MLA, larger g, FP8 KV cache do']],
    ['decode GEMM, batch 64', 64, ['B tokens reuse every weight B times: I ≈ B', 'B = 64 → 214 TFLOP/s (22% of peak)', 'the ridge needs B ≳ 300 tokens in flight', 'this is why continuous batching exists and', 'why decode is priced per HBM byte']],
    ['DiT attention tile (FA3)', 128, ['FA3 keeps a 128-row Q tile in SMEM and streams K,V:', 'per tile I ≈ Br = 128 FLOP/B → 429 TF/s if K,V came', 'from HBM every time. But one head’s K,V (39 MB) can sit', 'in the 50 MB L2 and the head’s CTAs share it (best case):', 'HBM sees Q,K,V,O about once → I up to N/2 ≈ 37,800']],
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
    S.roofPaths = []; S.roofLegs = [];
    var R = [[989, 3.35, 'red', null, 'H100 BF16 · 989 TF · 3.35 TB/s'], [989, 4.8, 'orange', null, 'H200 BF16 · 989 TF · 4.8 TB/s'], [2250, 8, 'violet', null, 'B200 BF16 · ~2,250 TF · ~8 TB/s'], [9000, 8, 'violet', '6 5', 'B200 FP4 · ~9,000 TF dense']];
    R.forEach(function (rf, i) {
      var p = ctx.path(roofD(rf[0], rf[1]), { stroke: rf[2], sw: i === 0 ? 3 : 1.8, dash: rf[3], parent: g, glow: i === 0 });
      if (i > 0) p.setAttribute('data-op', 0.75);
      S.roofPaths.push(p);
      var lg = ctx.group({ parent: g });
      ctx.line(172, 214 + i * 24, 196, 214 + i * 24, { color: rf[2], sw: i === 0 ? 3 : 1.8, dash: rf[3], parent: lg });
      ctx.text(204, 214 + i * 24, rf[4], { size: 12, font: 'mono', color: 'text', parent: lg });
      S.roofLegs.push(lg);
    });
    var xr = rX(295);
    S.ridge = ctx.group({ parent: g });
    ctx.line(xr, rY(989), xr, 790, { color: ctx.alpha('red', 0.7), sw: 1.2, dash: '4 4', parent: S.ridge });
    S.ridgeLab = ctx.label(xr, 770, 'ridge ≈ 295', { color: 'red', textColor: 'white', size: 11, parent: S.ridge });
    ctx.text(430, 575, 'memory-bound', { size: 14, font: 'display', weight: 700, color: ctx.alpha('white', 0.35), anchor: 'middle', parent: S.ridge }).setAttribute('transform', 'rotate(-38.7 430 575)');
    ctx.text(800, 410, 'compute-bound', { size: 14, font: 'display', weight: 700, color: ctx.alpha('white', 0.35), anchor: 'middle', parent: S.ridge });

    /* points */
    S.pts = [];
    PTS.forEach(function (p, i) {
      var perf = Math.min(989, p[1] * 3.35);
      var x = rX(p[1]), y = rY(perf);
      var pg = ctx.group({ parent: g });
      var hollow = i === 4;
      ctx.circle(x, y, 7, { fill: hollow ? 'rgba(8,12,24,0.9)' : 'amber', stroke: 'amber', sw: 1.8, parent: pg, glow: !hollow });
      var dx = 12, dy = 15;
      if (i === 5) { dx = -16; dy = 16; }
      if (i === 6) { dx = 12; dy = -16; }
      ctx.text(x + dx, y + dy, String(i + 1), { size: 13, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: pg });
      if (hollow) {
        /* L2 reuse lifts the tile from its HBM-only intensity up onto the compute roof */
        ctx.path('M' + (x + 8) + ',' + (y - 6) + ' Q' + (x + 36) + ',' + (rY(989) + 4) + ' ' + rX(700) + ',' + (rY(989) + 4), { stroke: 'amber', sw: 1.5, dash: '4 3', arrow: true, parent: pg });
        ctx.text(x + 30, y + 22, 'L2 reuse', { size: 11, font: 'mono', color: 'amber', anchor: 'start', parent: pg });
      }
      pg.style.cursor = 'pointer';
      pg.fy = y;
      S.pts.push(pg);
    });

    /* right panel */
    S.eqCard = card(ctx, g, 940, 160, 610, 90, 'red', 'ROOFLINE MODEL');
    var eq = S.eqCard;
    ctx.text(1245, 212, 'P = min( π_peak ,  I · β_HBM )', { size: 18, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: eq });
    S.ridgeTxt = ctx.text(960, 248, 'H100: 989 TF ÷ 3.35 TB/s → ridge I* ≈ 295 FLOP/B', { size: 13, font: 'mono', color: 'red', parent: eq });
    S.ridgeTxt2 = ctx.text(960, 276, 'H200 ≈ 206 · B200 BF16 ≈ 281 · B200 FP4 ≈ 1,125', { size: 13, font: 'mono', color: 'text', parent: eq });
    S.listCard = card(ctx, g, 940, 316, 610, 318, 'amber', 'KERNELS ON AN H100 · click one');
    var lc = S.listCard;
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
    /* a row and its dot become clickable only when they appear (hidden elements still receive clicks otherwise) */
    S.wireKernel = function (i) {
      S.rows[i].addEventListener('click', function () { select(i); });
      S.pts[i].addEventListener('click', function () { select(i); });
    };
    select(1);
  }

  /* ================================================================ FABRIC */
  function buildFabric(ctx, S, g) {
    var spX = [240, 430, 620, 810], lfX = [], gpu = [];
    for (var k = 0; k < 8; k++) lfX.push(115 + k * 108);
    ctx.text(80, 176, 'RAIL-OPTIMIZED FAT-TREE · 4 of N nodes shown', { size: 14, font: 'mono', weight: 700, color: 'red', parent: g, spacing: 1 });
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
    S.spineG = ctx.group({ parent: g });
    S.spines = spX.map(function (x, i) { return ctx.node({ x: x, y: 250, w: 150, h: 40, title: 'spine ' + i, titleSize: 13, color: 'blue', parent: S.spineG }); });
    S.leafG = ctx.group({ parent: g });
    S.leaves = lfX.map(function (x, i) { return ctx.node({ x: x, y: 440, w: 92, h: 36, title: 'rail ' + i, titleSize: 12, color: i === 3 ? 'amber' : 'cyan', parent: S.leafG }); });
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
    S.fabLines = ctx.para(80, 790, [
      '— same rank k → leaf k: DP all-reduce, PP send/recv = 1 switch hop',
      '- - cross-rail: leaf → spine → leaf = 3 hops, shares spine uplinks',
      '· · NCCL PXN: hop over NVLink to the GPU on the right rail first'
    ], { size: 13, font: 'mono', color: 'text', lh: 27, parent: g });

    /* bandwidth ladder */
    S.ladCard = card(ctx, g, 1040, 160, 510, 430, 'red', 'BANDWIDTH LADDER · GB/s per direction');
    var bc = S.ladCard;
    ctx.text(1534, 182, 'log scale', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: bc });
    var L = [['HBM3e (B200)', 8000, 'red'], ['HBM3 (H100)', 3350, 'red'], ['NVLink 5 (per GPU)', 900, 'cyan'], ['NVLink 4 (per GPU)', 450, 'cyan'], ['IB XDR 800G NIC', 100, 'orange'], ['PCIe Gen5 x16', 64, 'blue'], ['IB NDR 400G NIC', 50, 'orange']];
    S.ladder = [];
    L.forEach(function (b, i) {
      var y = 214 + i * 52;
      ctx.text(1060, y, b[0], { size: 12, font: 'mono', color: 'text', parent: bc });
      var w = (Math.log10(b[1]) - 1) / 3 * 330;
      var r = ctx.rect(1060, y + 11, w, 16, { rx: 3, fill: ctx.alpha(b[2], 0.55), stroke: b[2], sw: 1, parent: bc });
      r.full = w;
      r.lab = ctx.text(1060 + w + 10, y + 19, b[1].toLocaleString('en-US'), { size: 13, font: 'mono', weight: 700, color: b[2], parent: bc });
      S.ladder.push(r);
    });

    /* GPUDirect RDMA */
    S.gdCard = card(ctx, g, 1040, 610, 510, 250, 'orange', 'GPUDIRECT RDMA');
    var gd = S.gdCard;
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
  var BUDGET_LINES = [
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
  ];

  /* type lines [a, b) of the budget listing, one after the other */
  function typeBudget(ctx, S, a, b) {
    var p = Promise.resolve();
    for (var i = a; i < b; i++) (function (i) { p = p.then(function () { return S.bcode.addLine(BUDGET_LINES[i]); }); })(i);
    return p;
  }

  function buildBudget(ctx, S, g) {
    S.bcode = ctx.code({ parent: g, x: 70, y: 160, w: 830, title: 'shot_03_budget.txt · fox crash-lands · 5 s · 720p', lang: 'text', size: 14, color: 'red', typing: true, maxLines: 10, lines: BUDGET_LINES });
    S.tcCard = card(ctx, g, 70, 456, 830, 100, 'red', 'WHERE THE SECONDS GO · shot 3 on 8 GPUs');
    var tc = S.tcCard;
    S.flopG = ctx.group({ parent: tc });
    ctx.text(90, 506, 'FLOPs / forward', { size: 13, font: 'mono', color: 'text', parent: S.flopG });
    S.split = [
      ctx.rect(290, 494, 580 * 2.1 / 6.8, 26, { rx: 3, fill: ctx.alpha('amber', 0.55), stroke: 'amber', sw: 1, parent: S.flopG }),
      ctx.rect(290 + 580 * 2.1 / 6.8, 494, 580 * 4.7 / 6.8, 26, { rx: 3, fill: ctx.alpha('red', 0.55), stroke: 'red', sw: 1, parent: S.flopG })
    ];
    ctx.text(290 + 290 * 2.1 / 6.8, 507, 'linear 2.1 PF', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: S.flopG });
    ctx.text(290 + 580 * 2.1 / 6.8 + 290 * 4.7 / 6.8, 507, 'attention 4.7 PF', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: S.flopG });
    var T = [['8×H100 · 50 steps · CFG', 215, 'red'], ['8×B200 · 50 steps · CFG', 94, 'violet'], ['8×H100 · 4-step distilled', 8.6, 'lime'], ['8×B200 · 4-step distilled', 3.8, 'lime']];
    S.tBars = []; S.tRows = [];
    T.forEach(function (b, i) {
      var y = 570 + i * 62;
      var rg = ctx.group({ parent: tc });
      ctx.text(90, y + 10, b[0], { size: 13, font: 'mono', color: 'text', parent: rg });
      var w = Math.max(3, 440 * b[1] / 215);
      var r = ctx.rect(380, y, w, 20, { rx: 3, fill: ctx.alpha(b[2], 0.55), stroke: b[2], sw: 1, parent: rg });
      r.full = w;
      r.lab = ctx.text(380 + w + 10, y + 10, b[1] + ' s', { size: 13, font: 'mono', weight: 700, color: b[2], parent: rg });
      S.tBars.push(r); S.tRows.push(rg);
    });
    S.tNote = ctx.text(90, 832, 'assumes 40% MFU, Ulysses SP = 8 on NVLink; text encoder + VAE decode excluded', { size: 12, font: 'mono', color: 'dim', parent: tc });

    /* shapes ribbon (beat 1 only, replaced by the level ladder in the last beat) */
    S.ribbon = ctx.group({ parent: g });
    var rb = [['video', '81 × 720 × 1280 × 3', 'pixels, 16 fps · 5 s', 'cyan'], ['VAE latent', '21 × 90 × 160 × 16', 'compression 4 × 8 × 8', 'violet'], ['DiT tokens', '75,600 × 5,120', 'patch 1 × 2 × 2 → sequence', 'lime']];
    var rn = rb.map(function (r, i) {
      return ctx.node({ x: 1245, y: 250 + i * 190, w: 360, h: 84, title: r[0] + ' · ' + r[1], sub: r[2], titleSize: 15, subSize: 12, color: r[3], parent: S.ribbon });
    });
    S.ribLinks = [ctx.link(rn[0], rn[1], { color: 'violet', from: 'b', to: 't', parent: S.ribbon, label: 'VAE encode', labelDx: 70 }), ctx.link(rn[1], rn[2], { color: 'lime', from: 'b', to: 't', parent: S.ribbon, label: 'patchify', labelDx: 60 })];
    S.ribNodes = rn;

    S.ldCard = card(ctx, g, 940, 160, 610, 700, 'red', 'WHAT EACH LEVEL OF THE ZOOM DECIDES');
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
      var rg = ctx.group({ parent: S.ldCard });
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
      'NVIDIA, <i>NVIDIA H100 Tensor Core GPU Architecture</i> whitepaper, 2022',
      'NVIDIA, <i>NVIDIA Blackwell Architecture Technical Brief</i>, 2024',
      'NVIDIA, <i>GB200 NVL72</i> datasheet, 2024',
      'Williams, Waterman &amp; Patterson, <i>Roofline: An Insightful Visual Performance Model for Multicore Architectures</i>, CACM 2009',
      'NVIDIA, <i>CUDA C++ Programming Guide</i> and <i>PTX ISA 8.x</i> (thread-block clusters, wgmma, tcgen05), 2024–2025',
      'Shah, Bikshandi, Zhang, Thakkar, Ramani &amp; Dao, <i>FlashAttention-3: Fast and Accurate Attention with Asynchrony and Low-precision</i>, NeurIPS 2024',
      'Osama, Merrill, Cecka, Garland &amp; Owens, <i>Stream-K: Work-centric Parallel Decomposition for Dense Matrix-Matrix Multiplication on the GPU</i>, PPoPP 2023',
      'Gangidi et al. (Meta), <i>RDMA over Ethernet for Distributed AI Training at Meta Scale</i>, SIGCOMM 2024',
      'Team Wan et al., <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 RACK */
      {
        title: 'The NVL72 rack',
        beats: [
          {
            say: 'Every model call in our fox trailer eventually becomes kernels running on GPUs, so let us zoom from the outside in. This is a GB200 NVL72 rack: eighteen compute trays, with nine NVLink switch trays sandwiched in the middle.',
            card: { tag: 'KEY IDEA', title: 'Follow one call down the stack', body: 'Seven zoom levels, from cluster fabric to a single tensor-core instruction. Each one fixes a number that decides how fast a fox shot renders.' },
            deep: '<p>The zoom path is <b>fabric → rack → node → GPU → SM → warp → MMA</b>. At every level we ask the same two questions: how many FLOPs per second can this level issue, and how many bytes per second can reach them?</p>' +
              '<p>The rack is the largest unit that behaves like <i>one machine</i>: 18 compute trays and 9 NVLink switch trays share one liquid-cooled chassis. Compute trays are drawn red and blue; the nine cyan trays in the middle hold the switch chips, and the spine on the right is the copper cable cartridge that joins everything.</p>'
          },
          {
            say: 'Each compute tray holds two Grace CPUs and four Blackwell GPUs. Eighteen trays therefore give seventy two GPUs and thirty six CPUs, all on one memory fabric.',
            card: { tag: 'NUMBERS', title: 'One rack, 72 GPUs', stat: { v: '72', u: 'GPUs', l: '18 trays × (2 Grace CPUs + 4 Blackwell GPUs); 36 CPUs in total' } },
            deep: '<p>A <b>GB200 superchip</b> is one Grace CPU plus two Blackwell GPUs joined by NVLink-C2C (900 GB/s). A compute tray carries two superchips, so NVL72 is 18 trays, 36 Grace CPUs and 72 Blackwell GPUs.</p>' +
              '<div class="eq">18 trays × 4 GPUs = 72 GPUs  ·  18 × 2 = 36 CPUs</div>' +
              '<p>Each Blackwell GPU is itself two reticle-limited dies presented as one device, so the rack holds 144 compute dies. Each Grace CPU has 72 Arm Neoverse V2 cores, and a superchip carries up to 480 GB of LPDDR5X that the GPUs can reach coherently: a natural overflow tier for KV cache.</p>'
          },
          {
            say: 'All seventy two GPUs form one NVLink domain. Any GPU can load, store, or reduce into any other GPU’s memory through a single switch hop, at one point eight terabytes per second each, roughly one hundred thirty terabytes per second in aggregate.',
            card: { tag: 'NUMBERS', title: 'One flat memory fabric', stat: { v: '130', u: 'TB/s', l: 'aggregate NVLink: 72 GPUs × 1.8 TB/s, every pair one switch hop apart' },
              more: '<p>Why 18 switch chips? Each NVLink 5 switch chip has 72 ports and each GPU exposes 18 links, one to every chip. So 72 GPUs × 18 links = 1,296 = 18 chips × 72 ports: every GPU pair is exactly one switch apart and the fabric is non-blocking.</p>' },
            deep: '<p>The <b>NVLink domain</b> is the unit that matters for model parallelism: inside it, GPUs share a flat, memory-semantic fabric (load, store and atomics on peer HBM); outside it, traffic drops to NIC-based RDMA.</p>' +
              '<table><tr><th></th><th>HGX H100</th><th>GB200 NVL72</th></tr>' +
              '<tr><td>GPUs per NVLink domain</td><td>8</td><td>72</td></tr>' +
              '<tr><td>NVLink per GPU (bidir)</td><td>900 GB/s (NVLink 4)</td><td>1.8 TB/s (NVLink 5)</td></tr>' +
              '<tr><td>Switch chips</td><td>4 NVSwitch (on board)</td><td>18 NVSwitch in 9 trays</td></tr>' +
              '<tr><td>Aggregate NVLink</td><td>7.2 TB/s</td><td>130 TB/s</td></tr>' +
              '<tr><td>HBM</td><td>640 GB</td><td>up to 13.4 TB HBM3e</td></tr></table>' +
              '<div class="eq">72 × 1.8 TB/s ≈ 130 TB/s  ·  72 × ~8 TB/s ≈ 576 TB/s HBM</div>' +
              '<p>Rack compute: ~180 PFLOP/s dense BF16 (2.5 PF per GPU at the GB200 power point) and ~720 PFLOP/s dense FP4.</p>'
          },
          {
            say: 'Why does the domain size matter? Tensor, expert, and sequence parallel traffic hits the fabric on every layer, so those groups must fit inside one domain. Step outside and bandwidth per GPU falls nine to eighteen times, which is why growing the domain from eight GPUs to seventy two changes what can be split.',
            card: { tag: 'WHY IT MATTERS', title: 'The domain is the unit of parallelism', body: 'Groups that all-to-all on every layer must live inside one NVLink domain. Domains grew from 8 GPUs (HGX) to 72 (NVL72).' },
            deep: '<p>Placement rule of thumb: <b>TP, EP and SP groups fit inside one NVLink domain; DP and PP may cross the NIC</b>. Leaving the domain costs 9× (NVLink 4 versus a 400G NIC) to 18× (NVLink 5 versus the same NIC) of per-GPU bandwidth.</p>' +
              '<p>The spine is a set of passive copper cable cartridges (over 5,000 cables): copper, not optics, to save power at rack scale. The rack needs about 120 kW of direct liquid cooling. Vera Rubin, announced for 2026, is again a 72-GPU rack and moves to NVLink 6, doubling per-GPU NVLink bandwidth once more to 3.6 TB/s.</p>' +
              '<div class="note">Running example: each of the six trailer shots is gang-scheduled onto GPUs of <i>one</i> domain, so its per-layer all-to-all never touches the NIC.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.loops = [];
          crumb(ctx, S, [1]);
          ctx.hud('GB200 NVL72: 18 compute + 9 switch trays');
          var g = freshPage(ctx, S);
          buildRack(ctx, S, g);
          soften(ctx, g);
          hide([S.rackHead, S.rackCard, S.genCard, S.spineG, S.rackSub, S.callouts]);
          hide(S.nvlDots);
          hide(kids(S.rackLines).slice(1));
          /* beat 0: the rack and its 27 trays */
          return Promise.all([
            ctx.reveal(S.rackHead, { dur: 500 }),
            ctx.reveal(S.trays, { from: 'left', stagger: 30, dur: 400 })
          ]).then(function () {
            return ctx.reveal(S.callouts, { from: 'left', dur: 500 });
          }).then(function () {
            return Promise.all([ctx.pulse(S.trays[0], { color: 'red', dur: 700 }), ctx.pulse(S.trays[12], { color: 'cyan', dur: 700 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: 18 trays x 4 GPUs = 72 */
            ctx.hud('72 GPUs = 18 trays × 4 Blackwell');
            ctx.fadeOut(S.callouts, 400, true);
            return Promise.all([ctx.reveal(S.rackCard, { from: 'up', dur: 500 }), ctx.counter(S.big72, 0, 72, 1200)]).then(function () {
              return Promise.all([ctx.pulse(S.trays[0], { color: 'red', times: 2, dur: 500 }), ctx.pulse(S.trays[24], { color: 'red', times: 2, dur: 500 })]);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the NVLink spine and memory semantics */
            ctx.hud('72 GPUs · 130 TB/s NVLink · 1 switch hop');
            fit(ctx, S.rackCard, 300);
            ctx.reveal(S.spineG, { dur: 400 });
            ctx.reveal(S.spine, { from: 'draw', dur: 700 });
            ctx.reveal(S.rackSub, { from: 'left', delay: 300 });
            ctx.reveal(kids(S.rackLines).slice(1), { from: 'left', stagger: 160, delay: 400 });
            var y3 = S.trayY[2], y15 = S.trayY[21], sw5 = S.trayY[14], y7 = S.trayY[6], y24 = S.trayY[25];
            var pa = ctx.path('M459,' + y3 + ' H510 V' + sw5 + ' H470 H510 V' + y15 + ' H355', { stroke: ctx.alpha('amber', 0.0), parent: S.page });
            var pb = ctx.path('M305,' + y24 + ' H510 V' + S.trayY[12] + ' H340 H510 V' + y7 + ' H407', { stroke: ctx.alpha('cyan', 0.0), parent: S.page });
            return ctx.wait(900).then(function () {
              S.loops.push(ctx.stream(S.spine, { color: 'cyan', count: 5, period: 1800, r: 3 }));
              return Promise.all([
                ctx.packet(pa, { color: 'amber', dur: 1800, label: 'store' }),
                ctx.packet(pb, { color: 'lime', dur: 1800, label: 'reduce' })
              ]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: why the domain size matters */
            ctx.hud('NVLink domain: 8 GPUs → 72 GPUs (× 9)');
            return ctx.reveal(S.genCard, { from: 'up', dur: 500 }).then(function () {
              return Promise.all([ctx.reveal(S.nvlDots, { from: 'scale', stagger: 8, dur: 300 }), ctx.reveal(S.genWhy, { from: 'left', delay: 300 })]);
            }).then(function () { return ctx.pulse(S.genCard, { color: 'red', dur: 800 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 2 NODE */
      {
        title: 'Eight-GPU node',
        beats: [
          {
            say: 'The classic eight GPU node is still the workhorse of many fleets, so zoom into one. Eight H100 GPUs sit in a row, hosted by two Xeon CPUs with a terabyte of DDR5 memory each.',
            card: { tag: 'NUMBERS', title: 'The workhorse box', stat: { v: '8', u: 'GPUs', l: 'per HGX / DGX H100 node: 640 GB of HBM3, about 10 kW at the wall' } },
            deep: '<p><b>HGX / DGX H100</b>: 8 × H100 SXM5 on one baseboard, hosted by 2 × Xeon Platinum (Sapphire Rapids, 2 TB DDR5 in total) over PCIe Gen5. Eight ConnectX-7 NICs, one per GPU, serve the compute fabric; further NICs and NVMe drives handle storage and management.</p>' +
              '<p>The 8-GPU node is the scheduler’s atom: a gang-scheduled job asks for whole nodes, and the node’s NVLink domain is the largest group in which tensor and sequence parallelism are cheap. A DGX H100 draws up to ~10.2 kW.</p>'
          },
          {
            say: 'Each H100 has eighteen NVLink links, spread over four NVSwitch chips. That gives four hundred fifty gigabytes per second in each direction, nine hundred in total, to any peer in the box, and any GPU is exactly one switch hop from any other.',
            card: { tag: 'NUMBERS', title: 'Any peer at full speed', stat: { v: '450', u: 'GB/s', l: 'per direction to any peer: 18 NVLink4 links × 25 GB/s through 4 NVSwitch chips' } },
            deep: '<p><b>HGX / DGX H100 topology</b>: 8 × H100 SXM5, 4 × third-generation NVSwitch (64 NVLink4 ports each). Each GPU’s 18 links are split 5·4·4·5 across the switches, so every GPU pair is one hop apart and the fabric is non-blocking.</p>' +
              '<div class="eq">18 links × 25 GB/s/dir = 450 GB/s/dir = 900 GB/s bidirectional</div>' +
              '<p><b>NVLS</b> (NVLink SHARP) lets the NVSwitch chips perform the reduction of an all-reduce in-network, so each GPU pushes roughly S bytes instead of the ring’s 2(n−1)/n · S (1.75 S for n = 8). Each line in the fan stands for a bundle of 4 or 5 links; the highlighted one sweeping across it is one of the 32 GPU-to-switch bundles.</p>'
          },
          {
            say: 'Each GPU also owns one four hundred gigabit InfiniBand card, which is only fifty gigabytes per second per direction. That nine times cliff at the edge of the node shapes every parallelism decision, so chatty tensor and sequence parallel traffic must stay on NVLink.',
            card: { tag: 'PITFALL', title: 'A TP group must not straddle nodes', body: 'Traffic that leaves the box gets one ninth of the bandwidth. A tensor-parallel group spanning two nodes would stall every layer on the NIC.' },
            deep: '<p>Off-node path: GPU → PCIe Gen5 switch → ConnectX-7 (400 Gb/s = 50 GB/s per direction) → the “rail”. Local HBM3 streams at 3,350 GB/s, NVLink4 at 450 GB/s, PCIe Gen5 x16 at ~64 GB/s and the NIC at 50 GB/s: the first two boundaries each cost a factor of about seven, and the NIC sits just below PCIe.</p>' +
              '<div class="eq">NVLink4 450 GB/s ÷ NDR NIC 50 GB/s = 9×</div>' +
              '<p>Hence the placement rule: tensor and sequence parallel groups stay inside the NVLink domain; data and pipeline parallel traffic, which is rarer and overlappable, may cross the NIC. The bars are drawn on a linear scale, so the NIC bar is almost invisible next to HBM.</p>'
          },
          {
            say: 'Put numbers on it with one fox shot. Sequence parallelism over these eight GPUs moves about three hundred forty megabytes per layer per GPU. On NVLink that costs under a millisecond; over the NIC it would cost nearly seven, more than a quarter of the attention time.',
            card: { tag: 'NUMBERS', title: 'What the cliff costs a shot', stat: { v: '+27%', l: 'of attention time per layer if the Ulysses all-to-alls ran over the NIC: 6.8 ms against ~25 ms' },
              more: '<p>Ulysses does four all-to-alls per layer (Q, K, V in, O out). Each GPU holds N/8 = 9,450 tokens × d = 5,120 channels × 2 B = 96.8 MB and sends 7/8 of it to its seven peers each time:</p><div class="eq">4 × 96.8 MB × 7/8 ≈ 339 MB per layer per GPU</div>' },
            deep: '<p>For one fox shot with Ulysses sequence parallelism over 8 GPUs, each layer does 4 all-to-alls (Q, K, V and O), each GPU sending 7/8 of its N/8 × d BF16 slice:</p>' +
              '<div class="eq">4 × (75,600/8) × 5,120 × 2 B × 7/8 ≈ 339 MB per layer per GPU</div>' +
              '<table><tr><th>Link</th><th>time / layer</th><th>vs attention (~25 ms)</th></tr>' +
              '<tr><td>NVLink4 450 GB/s</td><td>0.75 ms</td><td>3%</td></tr>' +
              '<tr><td>IB NDR 50 GB/s</td><td>6.8 ms</td><td>27%</td></tr></table>' +
              '<p>The 25 ms is per-layer attention per GPU at ~60% of peak (14.6 TFLOP ÷ ~590 TFLOP/s). The NIC row is a worst case with every byte on one 400G port; overlapping the all-to-all with the QKV GEMMs hides some of it, but the algorithm was designed for the NVLink number.</p>' +
              '<div class="note">Placement rule: TP and SP groups ⊆ one NVLink domain; DP and PP may cross the NIC.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [2]);
          ctx.hud('HGX H100 node: 8 GPUs · 640 GB HBM3');
          return zoomInto(ctx, S, 722, 670, 4.2, function (g) {
            buildNode(ctx, S, g);
            hide([S.fan, S.nicG, S.nodePara, S.bwCard, S.foxCard, S.cliffTxt, S.cpuG]);
            hide(S.nodeGpu); hide(S.nodeSw);
            hide(S.nodeLn[2]);
            hide(kids(S.foxLines));
            zeroBars(S.bwBars);
          }).then(function () {
            /* beat 0: eight GPUs and two CPUs */
            return Promise.all([ctx.reveal(S.nodeGpu, { from: 'up', stagger: 70 }), ctx.reveal(S.cpuG, { from: 'up', delay: 400 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: NVSwitch fan, any-to-any */
            ctx.hud('NVLink4: 450 GB/s per direction per GPU');
            ctx.reveal(S.fan, { dur: 200 });
            return Promise.all([
              ctx.reveal(S.nodeSw, { from: 'up', stagger: 100 }),
              ctx.reveal(S.nvLinks, { from: 'draw', delay: 250, stagger: 12, dur: 400 }),
              ctx.reveal(S.nodePara, { dur: 500, delay: 400 })
            ]).then(function () {
              var pairs = [[0, 5, 0], [6, 1, 1], [3, 7, 2], [4, 2, 3]];
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
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the NIC and the 9x cliff */
            ctx.hud('NVLink 450 GB/s vs NIC 50 GB/s = 9× cliff');
            ctx.reveal(S.nicG, { from: 'down', dur: 500 });
            ctx.reveal(S.nodeLn[2], { from: 'left', delay: 300 });
            ctx.reveal(S.bwCard, { from: 'left', dur: 500 });
            return grow(ctx, S.bwBars, 700, 150, 300).then(function () {
              ctx.reveal(S.cliffTxt, { from: 'up' });
              return Promise.all([ctx.pulse(S.bwBars[1], { color: 'cyan', dur: 600 }), ctx.pulse(S.bwBars[3], { color: 'orange', dur: 600 })]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: what the cliff costs one fox shot */
            ctx.hud('SP 8 all-to-all: 0.75 ms NVLink, 6.8 ms NIC');
            ctx.reveal(S.foxCard, { from: 'up', dur: 500 });
            return ctx.reveal(kids(S.foxLines), { from: 'left', stagger: 260, delay: 300, dur: 400 }).then(function () {
              return ctx.pulse(S.foxCard, { color: 'amber', dur: 800 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 3 DIE */
      {
        title: 'The H100 die',
        beats: [
          {
            say: 'Now zoom into one GPU. The H100 die is organized as eight graphics processing clusters holding one hundred forty four streaming multiprocessors, of which one hundred thirty two are enabled. The rest are fused off for yield.',
            card: { tag: 'NUMBERS', title: 'Binned for yield', stat: { v: '132 / 144', u: 'SMs', l: 'enabled on the H100 SXM5 (66 of 72 TPCs); each SM carries 4 tensor cores' } },
            deep: '<p><b>GH100</b>: 8 GPCs × 9 TPCs × 2 SMs = 144 SMs on the die; the H100 SXM5 ships with 132 enabled (66 TPCs). 80 B transistors, TSMC 4N, ~814 mm², 700 W.</p>' +
              '<p>The die sits close to the reticle limit, so some defective units per wafer are unavoidable: fusing off bad TPCs is what makes the part manufacturable. The pale dashed columns in the picture are the fused-off units (their placement here is illustrative); the GigaThread engine at the top hands thread blocks to whichever SMs are free.</p>'
          },
          {
            say: 'Between the clusters sits a fifty megabyte L2 cache, split into two partitions. Every byte that reaches an SM from memory passes through it, which makes it the shared staging area for all one hundred thirty two SMs.',
            card: { tag: 'NUMBERS', title: 'The chip-wide cache', stat: { v: '50 MB', l: 'L2 cache in two partitions behind a crossbar; a far-partition hit takes nearly twice as long in microbenchmarks' } },
            deep: '<p>The L2 is the chip-wide point of coherence and sits between HBM and every SM. A K,V tile fetched by one CTA is served to the next CTA from L2 instead of HBM. That reuse is what lets FlashAttention-3 on a long video sequence sit well above its per-tile roofline point (see the Roofline step).</p>' +
              '<p>Physically the L2 is two partitions. Data resident in the “far” partition pays extra latency and crossbar bandwidth. CUDA exposes residency control (persisting access-policy windows) so a kernel can pin hot data, for example shared KV blocks, in L2.</p>'
          },
          {
            say: 'Around the die, five stacks of HBM3 deliver eighty gigabytes at three point three five terabytes per second, through ten memory controllers on a five thousand bit wide bus.',
            card: { tag: 'NUMBERS', title: 'Memory bandwidth', stat: { v: '3.35', u: 'TB/s', l: 'HBM3: five 16 GB stacks on a 5,120-bit bus; the full GH100 has a sixth site, unused here' } },
            deep: '<div class="eq">5 stacks × 1,024 bit = 5,120 bit  ·  5,120 × 5.23 Gb/s ÷ 8 ≈ 3.35 TB/s</div>' +
              '<p>Each HBM3 stack is an 8-high pile of DRAM dies on a base die, 16 GB behind a 1,024-bit interface, sitting on a silicon interposer (CoWoS) next to the GPU die. That 2.5D packaging is what makes thousands of wires per stack possible, and it is also why HBM capacity is the scarcest resource in LLM inference: the KV cache competes with weights for these 80 GB.</p>'
          },
          {
            say: 'Multiply it out. One hundred thirty two SMs, times four tensor cores each, times one thousand twenty four operations per clock, at about one point eight gigahertz, gives roughly nine hundred eighty nine teraflops of dense BF16.',
            card: { tag: 'NUMBERS', title: 'Peak tensor throughput', stat: { v: '989', u: 'TFLOP/s', l: 'dense BF16; FP8 doubles it to 1,979, and structured sparsity doubles both' },
              more: '<p>A tensor core retires 512 BF16 fused multiply-adds per clock, that is 1,024 FLOP (one multiply and one add each). Per SM: 4 × 1,024 = 4,096 FLOP per clock. The 1.83 GHz is the clock implied by the datasheet peak; under a 700 W power cap real kernels often run lower.</p>' },
            deep: '<div class="eq">π<sub>BF16</sub> = 132 SM × 4 TC × 1,024 FLOP/clk × 1.83 GHz ≈ 989 TFLOP/s</div>' +
              '<p>(1,024 FLOP/clk = 512 dense BF16 FMAs per tensor core per clock; FP8 doubles it to 1,979 TF. The 1.83 GHz is the clock implied by the datasheet peak.) Datasheet peaks assume the tensor cores are fed every cycle; a well-tuned kernel reaches roughly 70–75% of it (FlashAttention-3 reports 740 TFLOP/s in FP16), and a whole training step typically 35–50% MFU (Llama 3 405B reports 38–43% on H100).</p>' +
              '<p>Compare with the FP32 CUDA-core path: 16,896 lanes × 2 FLOP × 1.83 GHz ≈ 62 TFLOP/s (the datasheet says 67, at the 1.98 GHz boost clock). The tensor cores are roughly 15× faster, which is why every performance-critical kernel is written to hit them.</p>'
          },
          {
            say: 'Newer parts keep the recipe and change the numbers. H200 keeps the same compute but swaps in HBM3e: one hundred forty one gigabytes at four point eight terabytes per second. B200 joins two dies with a ten terabyte per second link and adds four bit tensor cores.',
            card: { tag: 'STATE OF THE ART', title: 'Same recipe, more bytes', body: 'H200 adds 43% bandwidth for identical FLOPs, which speeds up memory-bound decode. B200 more than doubles dense BF16 and adds FP4.' },
            deep: '<table><tr><th>Part</th><th>HBM</th><th>BW</th><th>Dense BF16</th></tr>' +
              '<tr><td>H100 SXM5</td><td>80 GB HBM3</td><td>3.35 TB/s</td><td>989 TF</td></tr>' +
              '<tr><td>H200</td><td>141 GB HBM3e</td><td>4.8 TB/s</td><td>989 TF</td></tr>' +
              '<tr><td>B200</td><td>192 GB HBM3e (180–186 exposed)</td><td>~8 TB/s</td><td>~2.25 PF</td></tr></table>' +
              '<p>B200 is two reticle-limited dies joined by a 10 TB/s NV-HBI link and presented to software as one GPU. From H100 to B200, bandwidth grew about 2.4× and dense BF16 about 2.3×, so the BF16 ridge barely moves (295 → 281); the FP4 path (9 PF against the same ~8 TB/s) pushes it out to ~1,125, and H200 changes bandwidth alone (ridge 206). That shifting ridge is exactly what the Roofline step plots.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [3]);
          ctx.hud('H100: 132 of 144 SMs enabled · 8 GPCs');
          return zoomInto(ctx, S, 110, 310, 5, function (g) {
            buildDie(ctx, S, g);
            hide(S.gpcs);
            hide([S.dieCard, S.l2G, S.hbmG, S.peakCard, S.newCard, S.dieNote, S.eq, S.peakLines]);
            hide(kids(S.dieLines).slice(2));
            hide(kids(S.newLines));
          }).then(function () {
            /* beat 0: eight GPCs, 132 live SMs */
            S.loops.push(ctx.loop(function (t) {
              for (var i = 0; i < S.smCells.length; i++) {
                var c = S.smCells[i];
                var v = 0.3 + 0.6 * Math.max(0, Math.sin(t * 2.6 - (c.cx + c.cy * 0.6) / 70));
                c.setAttribute('fill', ctx.cmap('red', v));
              }
            }));
            ctx.reveal(S.dieCard, { from: 'left', dur: 500 });
            return ctx.reveal(S.gpcs, { from: 'fade', stagger: 90, dur: 400 }).then(function () { return ctx.pulse(S.gpcs[0], { color: 'red', dur: 700 }); });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the L2 cache */
            ctx.hud('L2: 50 MB, 2 partitions, between HBM and SMs');
            fit(ctx, S.dieCard, 156);
            ctx.reveal(kids(S.dieLines)[2], { from: 'left' });
            return ctx.reveal(S.l2G, { dur: 500 }).then(function () {
              return Promise.all([ctx.pulse(S.l2[0], { color: 'blue', dur: 700 }), ctx.pulse(S.l2[1], { color: 'blue', dur: 700 })]);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: HBM stacks, memory controllers */
            ctx.hud('HBM3: 5 stacks · 80 GB · 3.35 TB/s');
            fit(ctx, S.dieCard, 196);
            ctx.reveal(kids(S.dieLines)[3], { from: 'left' });
            return ctx.reveal(S.hbmG, { dur: 600 }).then(function () {
              S.hbmPaths.forEach(function (p) { S.loops.push(ctx.stream(p, { color: 'red', count: 3, period: 1400, r: 3 })); });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the multiplication */
            ctx.hud('132 SM × 4 TC × 1,024 × 1.83 GHz = 989 TF');
            ctx.reveal(S.peakCard, { from: 'left', dur: 500 });
            return ctx.counter(S.tflops, 0, 989, 1600).then(function () {
              ctx.reveal(S.peakLines, { from: 'up' });
              return ctx.reveal(S.eq, { from: 'up' });
            }).then(function () { return ctx.pulse(S.eq, { color: 'amber', dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: newer parts */
            ctx.hud('H200: 4.8 TB/s · B200: 2 dies, FP4, 8 TB/s');
            ctx.reveal(S.newCard, { from: 'up', dur: 500 });
            return ctx.reveal(kids(S.newLines), { from: 'left', stagger: 120, delay: 300 }).then(function () { return ctx.reveal(S.dieNote); });
          });
        }
      },
      /* ------------------------------------------------------------ 4 SM */
      {
        title: 'Inside an SM',
        beats: [
          {
            say: 'Zoom into a single streaming multiprocessor. It is split into four sub-partitions that share two hundred fifty six kilobytes of L1 cache and shared memory, plus an asynchronous copy engine called the TMA.',
            card: { tag: 'KEY IDEA', title: 'Four schedulers, one shared memory', body: 'Issue is partitioned four ways, but shared memory is common: a warp issues on its own sub-partition yet reads data that every other warp on the SM can see.' },
            deep: '<p><b>Hopper SM</b> = 4 SM sub-partitions (SMSPs) plus a shared 256 KB L1 / shared-memory array (up to 228 KB configurable as SMEM, at most 227 KB for a single block) and the <b>TMA</b>, the Tensor Memory Accelerator, which copies whole tiles between HBM and shared memory without occupying any threads.</p>' +
              '<p>Thread-block clusters add <b>distributed shared memory</b>: CTAs on neighbouring SMs of one cluster can read and write each other’s SMEM directly, over the SM-to-SM network.</p>'
          },
          {
            say: 'Each sub-partition has its own warp scheduler, a sixty four kilobyte slice of the register file, thirty two FP32 lanes, and one tensor core. Add the four slices and the register file is as large as the L1, and it is where every operand lives.',
            card: { tag: 'NUMBERS', title: 'Registers match L1 in size', stat: { v: '256 KB', l: 'register file per SM (4 × 64 KB), as large as L1 and shared memory together' } },
            deep: '<p>Each SMSP issues <b>one warp-instruction per clock</b> and owns 16,384 × 32-bit registers (64 KB), 32 FP32 lanes, 16 INT32, 16 FP64, one fourth-generation tensor core, 8 load/store units and 4 special-function units (exp, rsqrt, sin).</p>' +
              '<div class="eq">registers per SM = 4 × 16,384 × 4 B = 256 KB  ·  FP32 lanes per SM = 4 × 32 = 128</div>' +
              '<p>A thread can use at most 255 registers, and the more it uses the fewer warps fit on the SM (see the last beat). Register operands are the only near-free access; everything else is a memory operation with latency.</p>'
          },
          {
            say: 'The trick that makes GPUs fast is on the right. When a warp stalls on a memory load that takes hundreds of cycles, the scheduler simply issues from another ready warp, at no switching cost at all.',
            card: { tag: 'KEY IDEA', title: 'Hide latency with warps, not caches', body: 'CPUs fight latency with big caches and out-of-order cores. A GPU keeps dozens of warps resident and switches between them every cycle for free.' },
            deep: '<p><b>Latency hiding</b> is the GPU’s substitute for big caches and out-of-order cores: a stalled warp costs nothing if another is eligible. The chart simulates loose round-robin scheduling on SMSP 0 with 12 resident warps: each warp issues a burst of 2 instructions, then stalls on a load for 10–16 cycles.</p>' +
              '<p>Each row is a warp, each column a clock cycle. Red is the cycle in which that warp owns the issue slot, violet is a warp waiting for memory, cyan a warp that is ready but not chosen. Register state stays resident, so a switch costs zero cycles.</p>'
          },
          {
            say: 'With enough warps resident the latency disappears; with too few, the issue slot sits idle. In this simulation twelve warps keep the scheduler busy every cycle, while four warps leave it half empty.',
            card: { tag: 'NUMBERS', title: 'Twelve warps versus four', stat: { v: '100%', u: 'vs 50%', l: 'issue-slot utilisation with 12 versus 4 resident warps (10–16 cycle stalls)' } },
            deep: '<p>With W warps the pipe stays full while the other warps’ bursts cover one warp’s stall:</p>' +
              '<div class="eq">utilisation ≈ min(1, W · burst / (burst + stall))  →  W ≳ (2 + 13) / 2 ≈ 8</div>' +
              '<p>Twelve warps clear that with margin, four cover only about half of the stall (4 × 2 / 15 ≈ 53%). Loaded HBM latency is of order 0.5 µs ≈ 900 clocks (idle pointer-chase measurements are lower: about 480 clocks, roughly 0.27 µs, in published microbenchmarks of an H800), so the number of independent memory operations in flight needed scales up by roughly two orders of magnitude, from warps per SMSP to bytes per SM.</p>'
          },
          {
            say: 'How many warps is enough? Little’s law says the bytes in flight equal bandwidth times latency. Assume about half a microsecond: that is roughly one point seven megabytes across the chip, thirteen kilobytes on every SM, at every instant. Registers cap the warp count, so Hopper’s TMA keeps those bytes in flight without holding registers.',
            card: { tag: 'NUMBERS', title: 'Bytes that must stay in flight', stat: { v: '≈ 13 KB', l: 'outstanding on every SM, always, to saturate 3.35 TB/s at an assumed ~0.5 µs loaded latency' },
              more: '<p>Little’s law: L = λ · W. Here λ is the memory bandwidth (3.35 TB/s) and W the load latency (~0.5 µs), so L = 3.35e12 × 0.5e-6 ≈ 1.7 MB in flight across the chip, or 1.7 MB ÷ 132 ≈ 13 KB per SM. A 128-bit load per thread of one full warp is only 512 B, so about 25 such warp-loads must be outstanding per SM. The 0.5 µs is an assumed effective, loaded latency (idle pointer-chase measurements are lower), so read 13 KB as an order of magnitude.</p>' },
            deep: '<div class="eq">occupancy = resident warps / 64  ·  warps ≤ 65,536 / (32 · regs per thread)</div>' +
              '<div class="eq">Little: bytes in flight = β × latency = 3.35 TB/s × 0.5 µs ≈ 1.7 MB ≈ 13 KB per SM</div>' +
              '<p>65,536 registers per SM: at 128 registers per thread only 16 warps fit, at 255 only 8. Hopper decouples bytes-in-flight from occupancy: <b>TMA</b> bulk copies and <code>cp.async</code> put bytes in flight without holding registers, so a GEMM with only 1–2 CTAs per SM (low occupancy, huge tiles) can still saturate HBM. Occupancy is a means, not the goal.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [4]);
          ctx.hud('SM: 4 schedulers · 256 KB RF · 228 KB SMEM');
          return zoomInto(ctx, S, 457, 278, 9, function (g) {
            buildSM(ctx, S, g);
            hide(S.smspFr); hide(S.smspIn);
            hide([S.l1G, S.latCard, S.occCard, S.utilG]);
            hide(kids(S.occLines));
            zeroBars(S.utilBars);
          }).then(function () {
            /* beat 0: four sub-partitions and the shared L1 / TMA */
            ctx.reveal(S.l1G, { from: 'up', delay: 700 });
            return ctx.reveal(S.smspFr, { from: 'fade', stagger: 150 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: what one sub-partition contains */
            ctx.hud('SMSP: scheduler · 64 KB RF · 32 FP32 · 1 TC');
            return ctx.reveal(S.smspIn, { from: 'fade', stagger: 150 }).then(function () {
              return ctx.pulse(S.tcs[0], { color: 'red', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: latency hiding, warps issue in turn */
            ctx.hud('a stalled warp is free: issue from another');
            ctx.reveal(S.latCard, { from: 'left', dur: 500 });
            return ctx.tween(3000, function (t) { paintWarps(ctx, S, Math.round(t * 32)); }, 'linear').then(function () {
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
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: 12 warps vs 4 warps */
            ctx.hud('issue slot busy: 12 warps 100%, 4 warps 50%');
            ctx.reveal(S.utilG, { from: 'up', dur: 400 });
            return grow(ctx, S.utilBars, 900, 300, 300).then(function () { return ctx.pulse(S.utilBars[1], { color: 'orange', dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: occupancy and Little's law */
            ctx.hud('Little: 3.35 TB/s × 0.5 µs ≈ 13 KB per SM');
            ctx.reveal(S.occCard, { from: 'up', dur: 500 });
            return ctx.reveal(kids(S.occLines), { from: 'left', stagger: 200, delay: 300 });
          });
        }
      },
      /* ------------------------------------------------------------ 5 SIMT */
      {
        title: 'Threads, warps, grid',
        beats: [
          {
            say: 'This is the programming model the scheduler serves. A kernel launch creates a grid of thread blocks, and each block is scheduled independently onto whichever SM has room.',
            card: { tag: 'KEY IDEA', title: 'Grid, block, warp, lane', body: 'Four nested levels: the grid spans the GPU, a block owns one SM, a warp is the unit of issue, and a lane is one thread.' },
            deep: '<p><b>SIMT hierarchy</b>: grid → thread-block clusters (Hopper: ≤ 8 portable / 16 non-portable CTAs, with distributed shared memory) → CTAs (≤ 1,024 threads, one SM for life) → warps (32 threads issued together) → lanes.</p>' +
              '<p>Blocks of a grid may run in any order on any SM, with no ordering guarantee. That independence lets the same kernel scale from a 16-SM laptop GPU to a 132-SM H100 without changing the source. The amber cell is one block; for the fox QKV GEMM the grid is (60, 591) blocks.</p>'
          },
          {
            say: 'Each block runs on one SM for its whole life and shares that SM’s fast shared memory. The hardware slices the block into warps of thirty two threads that execute one instruction together.',
            card: { tag: 'NUMBERS', title: 'The warp is the unit', stat: { v: '32', u: 'threads per warp', l: 'the unit the SM schedules; up to 64 warps and 32 blocks resident per SM' } },
            deep: '<ul><li><b>CTA</b>: ≤ 1,024 threads sharing SMEM and a barrier (<code>__syncthreads</code>). This one has 256 threads = 8 warps; thread <code>t</code> belongs to warp <code>t / 32</code>, lane <code>t % 32</code>.</li>' +
              '<li><b>Coalescing</b>: 32 lanes loading 32 consecutive 4-byte words form one 128-byte transaction; strided access multiplies memory traffic.</li>' +
              '<li><b>Bank conflicts</b>: shared memory has 32 banks of 4 bytes; lanes that hit the same bank serialize. CUTLASS swizzles tile layouts to avoid it.</li></ul>'
          },
          {
            say: 'If lanes in a warp take different branches, the two paths run one after another, with the other lanes masked off. Divergence costs the sum of both paths, and half the lanes sit idle on each pass.',
            card: { tag: 'PITFALL', title: 'Divergence serializes branches', body: 'A warp issues one instruction at a time, so an if / else on the lane id runs both sides in turn: t(A) + t(B). Keep branch conditions warp-uniform.' },
            deep: '<p>A branch that splits a warp executes both paths under active masks; the cost is t<sub>A</sub> + t<sub>B</sub>, and the warp reconverges afterwards (mask 0xFFFFFFFF). Since Volta, <b>independent thread scheduling</b> gives every thread its own program counter, so diverged lanes can interleave and re-synchronize (<code>__syncwarp</code>), but the two paths still cannot run in parallel.</p>' +
              '<p>Mitigations: predication for short bodies, sorting or bucketing work so neighbouring lanes take the same path, and warp-specialised kernels in which whole warps, not lanes, take different roles.</p>'
          },
          {
            say: 'And blocks arrive in waves. Launch one hundred forty blocks on one hundred thirty two SMs, and the second wave runs only eight of them, wasting almost half of the machine.',
            card: { tag: 'NUMBERS', title: 'Wave quantization', stat: { v: '53%', l: 'SM time used by 140 blocks on 132 SMs: 140 / (2 × 132), one full wave plus a nearly empty second' } },
            deep: '<p>With T tiles (blocks) on P SMs and one block per SM, the kernel takes ⌈T/P⌉ waves of equal duration, so</p>' +
              '<div class="eq">efficiency = T / (P · ⌈T/P⌉)  →  140 / (132 · 2) = 53%</div>' +
              '<p>In the picture, wave one fills all 132 SMs; when it finishes, only 8 blocks are left, so 124 SMs idle for a whole wave. The same effect shows up whenever a grid is just slightly larger than a multiple of the SM count.</p>'
          },
          {
            say: 'For a real GEMM this rarely bites. The fox trailer’s QKV projection launches over thirty five thousand blocks, about two hundred sixty nine waves, so the tail wastes a fraction of a percent. Small grids, like decode GEMMs, are where persistent kernels and Stream-K earn their keep. Click the grid of SMs to try other launch sizes.',
            card: { tag: 'TRY IT', title: 'Resize the launch', body: 'Click the SM grid to cycle launch sizes. 264 blocks leave no tail, 268 runs a third wave of just 4 blocks, and the fox GEMM’s 35,460 tiles waste about 0.14%.' },
            deep: '<p>For the fox shot’s QKV GEMM (M = 75,600, N = 15,360, K = 5,120) with 128×256 tiles, T = 591 × 60 = 35,460 → 268.6 waves; the tail wastes (269 − 268.6) / 269 ≈ 0.14% of SM-time. Decode GEMMs with a handful of tiles are where it bites.</p>' +
              '<p>The SM grid on the stage is now live: each click re-launches with another block count, T = 140, 264, 268, 1,000, 35,460, and recomputes the last wave and the efficiency T / (132 · ⌈T/132⌉): 53%, 100%, 68%, 95%, 99.9%.</p>' +
              '<p><b>Stream-K</b> (Osama et al.) splits the K-loop across SMs so every SM gets equal work; <b>persistent kernels</b> launch exactly one CTA per SM and loop over tiles, overlapping one tile’s epilogue with the next tile’s mainloop; <b>split-K</b> trades a reduction for parallelism. Hopper clusters let up to 16 CTAs share DSMEM.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [5]);
          ctx.hud('warp = 32 threads · CTA → 1 SM · waves of 132');
          return zoomInto(ctx, S, 378, 243, 7, function (g) {
            buildSIMT(ctx, S, g);
            hide([S.ctaCard, S.warpCard, S.waveCard, S.gemmCard, S.wire1, S.wire2, S.blocks, S.divNote, S.waveHint]);
            hide(S.maskRows);
            hide(kids(S.gemmLines));
          }).then(function () {
            /* beat 0: the grid of thread blocks */
            return ctx.reveal(S.blocks, { from: 'up', dur: 600 }).then(function () { return ctx.pulse(S.blocks.cells[1][5], { color: 'amber', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: one block = 8 warps */
            ctx.hud('CTA: 256 threads = 8 warps · lives on 1 SM');
            ctx.reveal(S.wire1, { from: 'draw', dur: 500 });
            return ctx.reveal(S.ctaCard, { from: 'up', delay: 300, dur: 500 }).then(function () {
              return ctx.pulse(S.warps.cells[2][0], { color: 'lime', times: 2, dur: 500 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: divergence inside a warp */
            ctx.hud('divergence: both paths run, lanes masked');
            ctx.reveal(S.wire2, { from: 'draw', dur: 500 });
            return ctx.reveal(S.warpCard, { from: 'up', delay: 300, dur: 500 }).then(function () {
              return ctx.reveal(S.maskRows, { from: 'left', stagger: 500, dur: 500 });
            }).then(function () { return ctx.reveal(S.divNote, { from: 'up' }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: waves */
            ctx.hud('140 blocks on 132 SMs: wave 2 runs only 8');
            ctx.reveal(S.waveCard, { from: 'left', dur: 500 });
            return ctx.tween(3200, function (t) { paintWaves(ctx, S, t); }, 'linear');
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the fox GEMM has 269 waves */
            ctx.hud('fox QKV GEMM: 35,460 CTAs = 268.6 waves');
            ctx.reveal(S.gemmCard, { from: 'up', dur: 500 });
            ctx.reveal(S.waveHint, { from: 'up', delay: 300 });
            /* the SM grid is now clickable: cycle through launch sizes and recompute the tail */
            S.waveSizes = [140, 264, 268, 1000, 35460];
            S.waveIdx = 0;
            S.smGrid.style.cursor = 'pointer';
            S.smGrid.addEventListener('click', function () {
              S.waveIdx = (S.waveIdx + 1) % S.waveSizes.length;
              var T = S.waveSizes[S.waveIdx];
              showLaunch(ctx, S, T);
              ctx.hud('launch ' + T.toLocaleString('en-US') + ' CTAs: ' + S.effT.textContent + ' of SM-time used');
            });
            return ctx.reveal(kids(S.gemmLines), { from: 'left', stagger: 200, delay: 300 });
          });
        }
      },
      /* ------------------------------------------------------------ 6 MMA */
      {
        title: 'Tensor core MMA',
        beats: [
          {
            say: 'At the bottom of the zoom is the tensor core. It computes a small matrix multiply and accumulate, D equals A times B plus C, as a single hardware operation, with low precision inputs and full precision accumulators.',
            card: { tag: 'KEY IDEA', title: 'A matrix unit, not a vector unit', body: 'One instruction retires a whole tile: inputs in BF16 or FP8, accumulation in FP32. This is where nearly all of a transformer’s FLOPs run.' },
            deep: '<p>A GEMM <code>D[M,N] = A[M,K]·B[K,N] + C</code> is tiled three times: a CTA tile (for example 128×256 of D) is fed from shared memory, a warpgroup tile (64×256) is one <code>wgmma</code>, and K is consumed in slices of 16. Inputs are BF16, FP16 or FP8; accumulation is FP32 (a 24-bit significand), which keeps rounding error small for BF16 inputs even when summing K = 5,120 products (FP8 inputs need extra care, see the last beat).</p>' +
              '<p>The three matrices are drawn scaled down (8×4 and 4×8) so the arithmetic is visible; the true shapes are printed under them.</p>'
          },
          {
            say: 'On Hopper, a warp group of one hundred twenty eight threads issues one asynchronous instruction that multiplies a sixty four by sixteen tile by a sixteen by two hundred fifty six tile. That is over half a million floating point operations from a single instruction.',
            card: { tag: 'NUMBERS', title: 'One instruction, half a million FLOPs', stat: { v: '524,288', u: 'FLOP', l: 'per wgmma.m64n256k16, issued once and completed asynchronously' } },
            deep: '<div class="eq">FLOP per wgmma.m64n256k16 = 2 · 64 · 256 · 16 = 524,288</div>' +
              '<p>A warpgroup is 4 warps = 128 threads. Operand B always comes from shared memory through a descriptor, operand A from registers or shared memory, and the 64×256 FP32 accumulator tile is spread over the 128 threads: 16,384 values ÷ 128 = 128 registers per thread. The instruction is <b>asynchronous</b>: threads keep issuing while the tensor cores work and wait on a barrier only when they need the result.</p>'
          },
          {
            say: 'Inside, the tile is built up in slices along K. Each slice adds a rank one outer product to the accumulators, which stay in FP32 registers until the whole tile is finished.',
            card: { tag: 'KEY IDEA', title: 'GEMM is a sum of outer products', body: 'Slice k contributes column k of A times row k of B to every output cell. Watch the accumulator tile brighten as slices arrive.' },
            deep: '<div class="eq">D = C + Σ<sub>k</sub> a<sub>k</sub> b<sub>k</sub><sup>T</sup>,  a<sub>k</sub> ∈ ℝ<sup>M</sup> (column k of A),  b<sub>k</sub> ∈ ℝ<sup>N</sup> (row k of B)</div>' +
              '<p>Each rank-one update touches all M·N accumulators once, so arithmetic intensity grows with the tile size: a 64×256 tile does 2·64·256 = 32,768 FLOP for every 64 + 256 = 320 operand values loaded. The hardware executes k = 16 such updates per instruction. The highlighted column of A and row of B are the current slice; the white outline moves as k advances.</p>'
          },
          {
            say: 'A dedicated copy engine, the TMA, streams tiles from HBM into a ring of shared memory buffers so the tensor cores never wait. One producer warp issues the copies while consumer warpgroups run the math.',
            card: { tag: 'HOW IT WORKS', title: 'Copy and math overlap', body: 'Full and empty flags hand each ring slot between producer and consumers, so HBM latency hides behind the MMA of the previous tile.' },
            deep: '<p><b>Warp specialization</b> (CUTLASS 3, FlashAttention-3): a producer warp issues TMA copies into a 3–5 stage SMEM ring; consumer warpgroups run <code>wgmma</code> and the epilogue. <code>mbarrier</code> “full/empty” flags per stage let copy and math overlap almost perfectly, the standard way to reach more than 70% of the 989 TF peak.</p>' +
              '<pre>for kt in range(K // 64):  # consumer\n  wait(full[s])\n  wgmma(A[s], B[s], acc)\n  arrive(empty[s])\n  s = (s + 1) % STAGES</pre>' +
              '<p>Hopper’s <code>setmaxnreg</code> lets the register-light producer donate registers to the consumers, which need the large accumulator tiles.</p>'
          },
          {
            say: 'Every halving of precision doubles the rate. Blackwell adds tensor memory, single thread issue, and block scaled four bit floating point, for roughly nine thousand dense teraflops per GPU.',
            card: { tag: 'STATE OF THE ART', title: 'FP4 with block scales', stat: { v: '~9,000', u: 'TFLOP/s', l: 'dense FP4 on B200: 2× FP8, 4× BF16, with a scale factor per 16 values' } },
            deep: '<p><b>Precision</b>: inputs BF16/FP16 → FP32 accumulate; FP8 E4M3/E5M2 doubles throughput (per-tensor or per-block scales). Blackwell <code>tcgen05.mma</code> is issued by one thread, accumulates in 256 KB of <b>Tensor Memory</b> per SM (freeing registers), supports 2-SM cooperative MMA, and adds block-scaled <b>NVFP4</b> (16-value blocks, E4M3 scale plus an FP32 tensor scale) and OCP <b>MX</b> formats (32-value blocks, E8M0 scale).</p>' +
              '<p>The trade-off is accuracy: FP4 has only 8 representable magnitudes per value, so the block scale carries most of the dynamic range and quantization-aware recipes are needed. Blackwell numbers are dense; NVIDIA’s headline figures double them with 2:4 sparsity.</p>' +
              '<details><summary>Go deeper</summary><p>Low-precision inputs do not guarantee FP32 accumulation. The DeepSeek-V3 report measured that Hopper’s FP8 tensor-core accumulator keeps only about 14 mantissa bits, giving a maximum relative error near 2% in a K = 4,096 test. Their fix is to promote the partial sums into FP32 registers every 128 elements of K (four wgmma steps), at a small cost in issue slots.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [6]);
          ctx.hud('wgmma m64n256k16 = 524,288 FLOP / instruction');
          return zoomInto(ctx, S, 446, 458, 6, function (g) {
            buildTC(ctx, S, g);
            hide([S.tcMats, S.kG, S.pipeG, S.code, S.peakCard, S.bwCard2]);
            hide(kids(S.bwLines));
          }).then(function () {
            /* beat 0: D = A x B + C */
            return ctx.reveal(S.tcMats, { dur: 500 }).then(function () {
              return ctx.pulse(S.mB, { color: 'cyan', dur: 500 });
            }).then(function () { return ctx.pulse(S.mA, { color: 'violet', dur: 500 }); }).then(function () { return ctx.pulse(S.mC, { color: 'red', dur: 500 }); });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the wgmma instruction */
            ctx.hud('warpgroup = 128 threads · 1 async instruction');
            return ctx.reveal(S.code, { from: 'right', dur: 500 }).then(function () { return S.code.typeAll(); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: k-slices accumulate */
            ctx.hud('accumulate over K: 16 rank-1 updates');
            ctx.reveal(S.kG, { from: 'left', dur: 400 });
            return ctx.tween(3600, function (t) { paintMMA(ctx, S, t); }, 'linear');
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: TMA producer, ring, consumers */
            ctx.hud('TMA producer → SMEM ring → wgmma consumers');
            return ctx.reveal(S.pipeG, { from: 'up', dur: 600 }).then(function () {
              for (var q = 0; q < 4; q++) S.loops.push(ctx.stream(S.pipeLinks[q], { color: S.pipe[q + 1].color, count: 2, period: 1100, r: 3 }));
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: precision ladder and Blackwell */
            ctx.hud('each precision halving = 2× rate · FP4 ~9 PF');
            ctx.reveal(S.peakCard, { from: 'left', dur: 500 });
            ctx.reveal(S.bwCard2, { from: 'up', delay: 400, dur: 500 });
            return ctx.reveal(kids(S.bwLines), { from: 'left', stagger: 180, delay: 800 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 ROOFLINE */
      {
        title: 'Roofline',
        beats: [
          {
            say: 'Zoom back out and ask the key question: is a kernel limited by math or by memory? The roofline answers it. Attainable throughput is the minimum of peak compute, and arithmetic intensity times memory bandwidth.',
            card: { tag: 'KEY IDEA', title: 'Two ceilings, one minimum', body: 'A kernel is capped either by the compute roof or by the sloped bandwidth roof. Arithmetic intensity, FLOPs per byte of HBM traffic, decides which.' },
            deep: '<div class="eq">P(I) = min(π, I · β)   ·   I* = π / β</div>' +
              '<p><b>I</b> = FLOPs / bytes moved to and from HBM. It counts traffic to HBM, not per-tensor bytes: reuse in SMEM or L2 raises it. Williams, Waterman and Patterson introduced the model for multicore CPUs; on a GPU the two roofs are the tensor-core peak π and the HBM bandwidth β, both drawn on log-log axes.</p>'
          },
          {
            say: 'On an H100 the ridge sits near two hundred ninety five operations per byte. Left of it, the kernel is starved for bytes; right of it, it is starved for FLOPs.',
            card: { tag: 'NUMBERS', title: 'The H100 ridge point', stat: { v: '≈ 295', u: 'FLOP/B', l: 'where the roofs meet: 989 TFLOP/s ÷ 3.35 TB/s' },
              more: '<p>Ridge points for other parts: H200 ≈ 206 (same FLOPs, 4.8 TB/s), B200 BF16 ≈ 281 (2,250 TF ÷ 8 TB/s) and B200 FP4 ≈ 1,125 (9,000 TF ÷ 8 TB/s). Each precision halving doubles the peak but not the bandwidth, so low-precision kernels need ever more reuse to stay compute-bound.</p>' },
            deep: '<p>With π = 989 TF and β = 3.35 TB/s the ridge is I* ≈ 295 FLOP/B. The H200’s larger β lowers the ridge to ~206, which is why an H200 decodes faster at identical FLOPs.</p>' +
              '<table><tr><th>Part</th><th>Peak</th><th>β</th><th>Ridge I*</th></tr>' +
              '<tr><td>H100 BF16</td><td>989 TF</td><td>3.35 TB/s</td><td>295</td></tr>' +
              '<tr><td>H200 BF16</td><td>989 TF</td><td>4.8 TB/s</td><td>206</td></tr>' +
              '<tr><td>B200 BF16</td><td>~2,250 TF</td><td>~8 TB/s</td><td>281</td></tr>' +
              '<tr><td>B200 FP4</td><td>~9,000 TF</td><td>~8 TB/s</td><td>1,125</td></tr></table>'
          },
          {
            say: 'LLM decoding at batch one does about one operation per byte, so it runs at a fraction of a percent of peak. Even batch sixty four reaches only a fifth of the machine. Decode is priced in bytes, not FLOPs.',
            card: { tag: 'NUMBERS', title: 'Batch-1 decode is starved', stat: { v: '0.34%', l: 'of H100 peak for a decode GEMV at batch 1: I ≈ 1 FLOP/B gives 3.35 TFLOP/s' } },
            deep: '<table><tr><th>Kernel</th><th>I</th><th>Bound</th></tr>' +
              '<tr><td>residual add</td><td>≈ 0.17</td><td>HBM</td></tr>' +
              '<tr><td>decode GEMV (b = 1)</td><td>≈ 1</td><td>HBM</td></tr>' +
              '<tr><td>GQA decode attention</td><td>≈ group size g</td><td>HBM</td></tr>' +
              '<tr><td>decode GEMM (b = B)</td><td>≈ B</td><td>HBM until B ≈ 300</td></tr></table>' +
              '<p>A 70B model at TP = 8 must stream 140 GB of weights per token: 140 GB ÷ (8 × 3.35 TB/s) ≈ 5.2 ms per token regardless of FLOPs. Batching raises I linearly for weights (each weight is reused B times) but not for the KV cache, which is per sequence. Click a row or a dot to read each derivation.</p>'
          },
          {
            say: 'Prefill and the video diffusion transformer sit far to the right, on the flat compute roof. For them FLOPs, not bytes, set the cost, which is why they want FP8 and sparse attention rather than more bandwidth.',
            card: { tag: 'KEY IDEA', title: 'Same GPU, opposite optimizations', body: 'Agents are priced in HBM bytes: batch, quantize weights, compress KV. The video model is priced in FLOPs: FP8 GEMMs, sparse attention, fewer steps.' },
            deep: '<table><tr><th>Kernel</th><th>I</th><th>Bound</th></tr>' +
              '<tr><td>LLM prefill GEMM, 8k tokens</td><td>≈ 2,731</td><td>compute</td></tr>' +
              '<tr><td>DiT QKV GEMM, 75.6k tokens</td><td>≈ 3,650</td><td>compute</td></tr>' +
              '<tr><td>DiT attention (FA3)</td><td>128 per tile; ≈ N/2 with L2 reuse</td><td>compute</td></tr></table>' +
              '<p>Consequences for the video system: the <b>LLM agents</b> (decode) are priced in HBM bytes, so batching, quantized weights and KV compression pay off; the <b>video DiT</b> is priced in FLOPs, so FP8 GEMMs, sparse or sliding-window attention, fewer sampling steps and caching pay off. Same GPU, opposite optimizations; hence separate serving pools.</p>'
          },
          {
            say: 'Newer parts move the roofs. H200 adds bandwidth and pulls the ridge left, while Blackwell raises the peak, and at four bit precision pushes the ridge far to the right. Click any point to see how its intensity is derived.',
            card: { tag: 'TRY IT', title: 'Click a kernel', body: 'Click any dot or table row to see how its arithmetic intensity is derived and what would move it toward the roof.' },
            deep: '<p>The roofline is an <b>upper bound</b>. Real kernels also hit an L2 or SMEM roofline, instruction-issue limits, tail effects and power-capped clocks, so the achieved point sits below the roof even for well-tuned code.</p>' +
              '<p>Reading the chart: moving a point <i>up</i> at fixed I means better use of bandwidth (coalescing, overlap); moving it <i>right</i> means more reuse (bigger tiles, fusion, batching, KV compression). Fusing the residual add into a GEMM epilogue is the classic move from point 1 toward the right.</p>' +
              '<div class="note">The hollow dot is FlashAttention-3. Per tile it sits at I ≈ 128, but one head’s K and V (2 × 75,600 × 128 × 2 B ≈ 39 MB) can sit in the 50 MB L2 (a best case: the L2 is two partitions) and every CTA of that head re-reads them from there. HBM then sees roughly Q, K, V in and O out once: I ≤ 4N²d<sub>h</sub> / 8Nd<sub>h</sub> = N/2, far past the ridge.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [3]);
          ctx.hud('ridge = 989 TF ÷ 3.35 TB/s ≈ 295 FLOP/byte');
          return zoomOut(ctx, S, function (g) {
            buildRoof(ctx, S, g);
            hide(S.roofPaths); hide(S.roofLegs); hide(S.pts); hide(S.rows);
            hide([S.ridge, S.listCard, S.detail, S.ridgeTxt, S.ridgeTxt2]);
          }).then(function () {
            /* beat 0: the question and the formula */
            return ctx.pulse(S.eqCard, { color: 'red', dur: 800 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the H100 roof and its ridge */
            fit(ctx, S.eqCard, 114);
            return Promise.all([
              ctx.reveal(S.roofPaths[0], { from: 'draw', dur: 900 }),
              ctx.reveal(S.roofLegs[0], { delay: 500 }),
              ctx.reveal(S.ridge, { delay: 900 }),
              ctx.reveal(S.ridgeTxt, { from: 'left', delay: 900 })
            ]).then(function () { return ctx.pulse(S.ridgeLab, { color: 'red', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: decode kernels sit on the bandwidth slope */
            ctx.hud('decode: I ≈ 1 → 0.34% of peak');
            ctx.reveal(S.listCard, { from: 'left', dur: 500 });
            ctx.reveal(S.detail, { from: 'up', delay: 300, dur: 500 });
            ctx.reveal(S.rows.slice(0, 4), { from: 'left', stagger: 150, delay: 300 });
            for (var w = 0; w < 4; w++) S.wireKernel(w);
            S.pts.slice(0, 4).forEach(function (pg, i) {
              pg.setAttribute('opacity', 0);
              ctx.tween(700, function (t) {
                pg.setAttribute('opacity', t.toFixed(3));
                ctx.place(pg, 0, -(1 - t) * 120);
              }, 'out', 200 + i * 260);
            });
            return ctx.wait(200 + 4 * 260 + 700).then(function () { return ctx.pulse(S.pts[1], { color: 'amber', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: prefill and DiT on the flat roof */
            ctx.hud('video DiT: I ≈ 3,650 → on the compute roof');
            ctx.reveal(S.rows.slice(4), { from: 'left', stagger: 150 });
            for (var w = 4; w < 7; w++) S.wireKernel(w);
            S.pts.slice(4).forEach(function (pg, i) {
              pg.setAttribute('opacity', 0);
              ctx.tween(700, function (t) {
                pg.setAttribute('opacity', t.toFixed(3));
                ctx.place(pg, 0, -(1 - t) * 120);
              }, 'out', i * 260);
            });
            return ctx.wait(3 * 260 + 700).then(function () { return ctx.pulse(S.pts[6], { color: 'amber', dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: newer parts move the roofs; the chart is clickable */
            ctx.hud('H200 ridge ≈ 206 · B200 FP4 ridge ≈ 1,125');
            fit(ctx, S.eqCard, 142);
            ctx.reveal(S.ridgeTxt2, { from: 'left' });
            return Promise.all([
              ctx.reveal(S.roofPaths.slice(1), { from: 'draw', stagger: 250, dur: 800 }),
              ctx.reveal(S.roofLegs.slice(1), { stagger: 250, delay: 400 })
            ]).then(function () { return ctx.pulse(S.listCard, { color: 'amber', dur: 800 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 8 FABRIC */
      {
        title: 'Scale-out fabric',
        beats: [
          {
            say: 'Beyond the NVLink domain, GPUs talk over a scale-out fabric. Bandwidth steps down sharply as data moves away from the GPU: local HBM, then NVLink, then PCIe and the network card.',
            card: { tag: 'NUMBERS', title: 'Every hop costs bandwidth', stat: { v: '9–18×', l: 'less bandwidth per GPU once traffic leaves the NVLink domain (NVLink 4 or 5 against a 400G NIC)' } },
            deep: '<table><tr><th>Link (per direction)</th><th>GB/s</th></tr>' +
              '<tr><td>HBM3e, B200</td><td>~8,000</td></tr>' +
              '<tr><td>HBM3, H100</td><td>3,350</td></tr>' +
              '<tr><td>NVLink 5 / NVLink 4 per GPU</td><td>900 / 450</td></tr>' +
              '<tr><td>InfiniBand XDR 800G NIC</td><td>100</td></tr>' +
              '<tr><td>PCIe Gen5 x16</td><td>~64</td></tr>' +
              '<tr><td>InfiniBand NDR 400G NIC</td><td>50</td></tr></table>' +
              '<p>The bars use a log scale, so each step down the ladder loses a factor of roughly 1.3 to 4.5, and the whole ladder spans more than two orders of magnitude. NVLink 5 against an NDR card is 18×; against an XDR card, 9×. Four of many nodes are shown below, each with eight GPUs and its own NVSwitch.</p>'
          },
          {
            say: 'Each GPU has its own network card, and GPUDirect RDMA lets that card read and write GPU memory directly over PCIe, without the CPU and without a bounce through host memory.',
            card: { tag: 'HOW IT WORKS', title: 'The NIC reads HBM directly', body: 'The card DMAs straight from GPU memory across a PCIe peer-to-peer path. No staging copy in host DRAM, no CPU on the data path.' },
            deep: '<ul><li><b>GPUDirect RDMA</b>: the NIC DMA-reads and writes HBM through PCIe peer-to-peer (BAR mapping); no staging in host DRAM, no CPU on the data path.</li>' +
              '<li><b>GPUDirect Async / IBGDA</b> goes further: GPU threads ring the NIC doorbell themselves, so the CPU proxy disappears from the critical path. DeepEP’s low-latency MoE all-to-all kernels are built on it.</li></ul>' +
              '<p>Putting the NIC behind the same PCIe switch as its GPU keeps the transfer off the CPU root complex, which is why each GPU has a dedicated 400 Gb/s ConnectX-7.</p>'
          },
          {
            say: 'The fabric is rail optimized: GPU zero of every node plugs into leaf switch zero, GPU one into leaf one, and so on. Data parallel and pipeline traffic flows between same rank GPUs, so it crosses a single switch.',
            card: { tag: 'KEY IDEA', title: 'Rail k connects GPU k everywhere', body: 'Same-rank GPUs share a leaf switch, so the traffic that must cross nodes every step, DP and PP, travels one hop.' },
            deep: '<p><b>Rail-optimized fat-tree</b>: in a cluster of 8-GPU nodes, NIC k of every node connects to leaf (rail) switch k. Collectives are organized so that rank-k GPUs exchange data among themselves (NCCL rings and trees per rail), so almost all traffic is one hop and spine uplinks can be oversubscribed or even removed (“rail-only” designs).</p>' +
              '<p>NVIDIA’s DGX SuperPOD reference designs follow this pattern, and “rail-only” network studies argue the spine can be dropped for most LLM-training traffic once collectives are rail-aware. The amber lane, rail 3, is the one traced in the packet animation.</p>'
          },
          {
            say: 'Traffic between different rails must climb to the spine, taking three switch hops and sharing uplinks, unless NCCL first moves it across NVLink to a GPU on the right rail. That trick is called PXN.',
            card: { tag: 'TRADE-OFF', title: 'PXN spends NVLink to save hops', body: 'Cross-rail data hops over cheap NVLink to the GPU on the destination rail, then takes one network hop instead of three.' },
            deep: '<ul><li><b>PXN</b> (PCI × NVLink): to reach GPU j on another node, NCCL first moves the data over NVLink to the local GPU j, then sends it on rail j, trading cheap NVLink bytes for spine hops.</li>' +
              '<li><b>Transport</b>: InfiniBand NDR 400 Gb/s (ConnectX-7) → XDR 800 Gb/s (ConnectX-8), or RoCEv2 Ethernet (Spectrum-X; Meta’s 24K-GPU Llama 3 cluster ran without DCQCN, using deep-buffer spines and E-ECMP load balancing); Ultra Ethernet targets the same space.</li></ul>' +
              '<div class="eq">NVLink4 450 GB/s/dir ÷ NDR 50 GB/s/dir = 9×</div>' +
              '<p>Mapping rule this implies (see the Distributed Parallelism chamber): TP, SP and EP inside the NVLink domain, PP between neighbouring nodes, DP across rails.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [0]);
          ctx.hud('scale-out: 9–18× less bandwidth than NVLink');
          return zoomOut(ctx, S, function (g) {
            buildFabric(ctx, S, g);
            hide([S.upLinks, S.downLinks, S.spineG, S.leafG, S.fabLines, S.gdCard, S.ladCard]);
            hide(kids(S.fabLines).slice(1));
            hide(S.nodes);
            zeroBars(S.ladder);
          }).then(function () {
            /* beat 0: the nodes, the bandwidth ladder and a ghost of the switch fabric above the nodes */
            ctx.reveal(S.ladCard, { from: 'left', dur: 500 });
            ctx.reveal(S.nodes, { from: 'up', stagger: 150 });
            ctx.reveal([S.spineG, S.leafG], { opacity: 0.3, stagger: 150, delay: 500 });
            ctx.reveal([S.upLinks, S.downLinks], { opacity: 0.55, stagger: 150, delay: 700 });
            return grow(ctx, S.ladder, 700, 120, 400);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: GPUDirect RDMA */
            ctx.hud('GPUDirect RDMA: NIC ↔ HBM, no CPU copy');
            return ctx.reveal(S.gdCard, { from: 'up', dur: 500 }).then(function () {
              S.loops.push(ctx.stream(S.gdL[0], { color: 'orange', count: 2, period: 1200, r: 3 }));
              S.loops.push(ctx.stream(S.gdL[1], { color: 'orange', count: 2, period: 1200, r: 3 }));
              return ctx.pulse(S.gdN[2], { color: 'orange', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: rails, same-rank traffic is one hop */
            ctx.hud('rail k ↔ leaf k: same rank = 1 switch hop');
            ctx.fade([S.spineG, S.leafG, S.upLinks, S.downLinks], 1, 700);
            ctx.reveal(S.fabLines, { delay: 700 });
            ctx.reveal(kids(S.fabLines)[0], { from: 'left', delay: 900 });
            var same = [];
            for (var k = 0; k < 8; k++) {
              same.push(ctx.path('M' + S.gpuX[0][k] + ',670 L' + S.lfX[k] + ',458 L' + S.gpuX[2][k] + ',670', { stroke: 'rgba(0,0,0,0)', parent: S.page }));
            }
            return ctx.wait(900).then(function () {
              return Promise.all(same.map(function (p, k) { return ctx.packet(p, { color: k === 3 ? 'amber' : 'cyan', dur: 1400, r: 4 }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: cross-rail (3 hops) versus PXN */
            ctx.hud('cross-rail = 3 hops · PXN = NVLink first');
            var cross = ctx.path('M' + S.gpuX[1][1] + ',670 L' + S.lfX[1] + ',458 L' + S.lfX[1] + ',422 L' + S.spX[1] + ',270 L' + S.lfX[6] + ',422 L' + S.lfX[6] + ',458 L' + S.gpuX[3][6] + ',670', { stroke: ctx.alpha('orange', 0.85), sw: 2, dash: '6 5', parent: S.downLinks });
            var pxn = ctx.path('M' + S.gpuX[1][1] + ',700 L' + S.gpuX[1][1] + ',711 L' + S.gpuX[1][6] + ',711 L' + S.gpuX[1][6] + ',670 L' + S.lfX[6] + ',458 L' + S.gpuX[3][6] + ',670', { stroke: ctx.alpha('teal', 0.9), sw: 2, dash: '2 5', parent: S.page });
            cross.setAttribute('opacity', 0); pxn.setAttribute('opacity', 0);
            ctx.reveal(kids(S.fabLines).slice(1), { from: 'left', stagger: 500, delay: 200 });
            ctx.reveal(cross, { from: 'draw', dur: 700 });
            return ctx.packet(cross, { color: 'orange', dur: 1800, label: '3 hops' }).then(function () {
              ctx.reveal(pxn, { from: 'draw', dur: 700 });
              return ctx.packet(pxn, { color: 'teal', dur: 1800, label: 'PXN' });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 9 BUDGET */
      {
        title: 'Budget one shot',
        beats: [
          {
            say: 'Let us put the whole stack to work on one shot of the fox trailer. Five seconds of seven twenty p video becomes a compact latent volume, and then seventy five thousand six hundred tokens for the diffusion transformer.',
            card: { tag: 'NUMBERS', title: 'A shot is a token sequence', stat: { v: '75,600', u: 'tokens', l: 'per 5 s, 720p shot: 21 × 45 × 80 after VAE 4×8×8 compression and 1×2×2 patches' } },
            deep: '<p>A Wan-2.1-14B-class DiT (d = 5,120, L = 40 blocks) generating 81 frames at 720p at 16 fps:</p>' +
              '<div class="eq">tokens N = (1 + 80/4) · (720/16) · (1280/16) = 21 · 45 · 80 = 75,600</div>' +
              '<p>The causal 3D VAE compresses 4× in time and 8× in each spatial axis into 16 latent channels; the transformer then patchifies 1×2×2, so each token spans 16 × 16 pixels of one latent frame. That sequence, not the pixel count, is what attention sees.</p>'
          },
          {
            say: 'One forward pass of a fourteen billion parameter transformer at that length costs about six point eight petaflops. More than two thirds of that is attention, because attention grows with the square of the token count.',
            card: { tag: 'NUMBERS', title: 'Attention dominates the forward', stat: { v: '69%', l: 'of forward FLOPs are attention (4.7 of 6.8 PFLOP), quadratic in tokens' } },
            deep: '<div class="eq">FLOP<sub>fwd</sub> ≈ 2·P·N + 4·N²·d·L = 2.1 + 4.7 ≈ 6.8 PFLOP</div>' +
              '<p>The linear term (QKV, output and MLP projections, 2 FLOP per parameter per token) grows with N; the attention term 4·N²·d·L (QKᵀ and PV, 2 FLOP each) grows with N². At 75,600 tokens the quadratic term is 69% of the total, so cutting attention cost (FP8 attention, sparse or sliding-window spatiotemporal attention) pays off more than shrinking the MLP.</p>' +
              '<details><summary>Go deeper</summary><p>2·P·N slightly over-counts, because the text keys and values are projected once for 512 text tokens, not 75,600. A per-block count (self-attention, cross-attention queries and output, the 13,824-wide FFN) gives about 45 TFLOP of linear work plus 117 TFLOP of attention: 163 TFLOP per block, 6.5 PFLOP per forward, attention at 72%. Both roundings land on about 0.7 EFLOP per shot.</p></details>'
          },
          {
            say: 'Fifty sampling steps with classifier free guidance make it about zero point seven exaflops: three and a half minutes on eight H100s, or about a minute and a half on eight B200s. Distilled to four steps with no guidance, the same shot takes seconds.',
            card: { tag: 'STATE OF THE ART', title: 'Distillation is the biggest lever', stat: { v: '215 s → 8.6 s', l: 'one shot on 8 × H100: 50 CFG steps against a 4-step distilled student (25× fewer forwards)' },
              more: '<p>50 steps × 2 (conditional and unconditional branch for classifier-free guidance) = 100 forward passes. A 4-step student without guidance needs 4, a 25× reduction. On 8 × B200 the times are 94 s and 3.8 s. Step distillation costs quality headroom, so production stacks mix distilled previews with full-step final renders.</p>' },
            deep: '<div class="eq">FLOP<sub>shot</sub> ≈ 6.8 P × 50 steps × 2 (CFG) ≈ 0.68 EFLOP</div>' +
              '<p>At 40% MFU on 8 × H100 (3.2 PFLOP/s effective) that is ≈ 215 s; on 8 × B200 (~2.25 PF dense each) ≈ 94 s. Beyond distillation, production stacks use FP8 attention (SageAttention / FA3-FP8), sparse or sliding-window attention and step-level feature caching. Text encoder and VAE decode are not included in these numbers.</p>' +
              '<p>The atlas’s running example, about 95 s of diffusion per shot on 8 GPUs, is close to the B200 row; on H100s, for this same 75,600-token shot, it corresponds to a sampler doing roughly 2.3× less work (guidance distillation, fewer steps, step caching); for the longer 111,600-token clip of the Video Generation Models chamber the gap is about 4×.</p>'
          },
          {
            say: 'Every level of this zoom sets one of those numbers. The tensor core sets utilization, the GPU decides memory bound or compute bound, the node and rack set the parallel degree, and the fabric sets how many shots run at once.',
            card: { tag: 'WHY IT MATTERS', title: 'Seven levels, one bill', body: 'From the MMA instruction to the InfiniBand rail, each level bounds a factor in the shot’s cost. Next: how parallelism carves a model across this hierarchy.' },
            deep: '<table><tr><th>Level</th><th>What it decides for the trailer</th></tr>' +
              '<tr><td>MMA / SM</td><td>MFU of each GEMM and attention tile</td></tr>' +
              '<tr><td>GPU</td><td>memory-bound agents vs compute-bound renders</td></tr>' +
              '<tr><td>Node / rack</td><td>sequence-parallel degree per shot</td></tr>' +
              '<tr><td>Fabric</td><td>how many shots and agents run concurrently</td></tr></table>' +
              '<div class="note">Next: the <b>Distributed Parallelism</b> chamber shows how DP, TP, PP, EP and SP carve a model across exactly this hierarchy.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          crumb(ctx, S, [0, 1, 2, 3, 4, 5, 6]);
          ctx.hud('one shot ≈ 0.68 EFLOP ≈ 3.6 min on 8×H100');
          stopLoops(S);
          var old = S.page;
          return ctx.fadeOut(old, 600, true).then(function () {
            var g = freshPage(ctx, S);
            buildBudget(ctx, S, g);
            soften(ctx, g);
            hide([S.tcCard, S.ldCard, S.flopG, S.tNote]);
            hide(S.tRows);
            hide(S.ribbon); hide(S.ribLinks);
            zeroBars(S.tBars);
            hide(S.ladRows);
            ctx.reveal(g, { from: 'up', dur: 600 });
            /* beat 0: tokens */
            ctx.reveal(S.ribbon, { from: 'left', delay: 300, dur: 500 });
            ctx.reveal(S.ribLinks, { from: 'draw', delay: 700, stagger: 300 });
            return typeBudget(ctx, S, 0, 3);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: FLOPs per forward */
            ctx.hud('forward ≈ 6.8 PFLOP · attention 69%');
            ctx.reveal(S.tcCard, { from: 'up', dur: 500 });
            ctx.reveal(S.flopG, { from: 'left', delay: 400 });
            return typeBudget(ctx, S, 3, 6).then(function () { return ctx.pulse(S.split[1], { color: 'red', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: sampling, wall-clock, distillation */
            ctx.hud('one shot ≈ 0.68 EFLOP ≈ 3.6 min on 8×H100');
            fit(ctx, S.tcCard, 404);
            ctx.reveal(S.tNote, { delay: 600 });
            ctx.reveal(S.tRows, { from: 'left', stagger: 220, delay: 200 });
            var typed = typeBudget(ctx, S, 6, 10);
            return typed.then(function () { return grow(ctx, S.tBars, 800, 200, 0); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: every level of the zoom decides one factor */
            ctx.hud('7 zoom levels · each one decides a factor');
            ctx.fadeOut(S.ribbon, 500, true);
            ctx.reveal(S.ldCard, { from: 'right', dur: 500 });
            return ctx.reveal(S.ladRows, { from: 'right', stagger: 160, delay: 300 });
          });
        }
      }
    ]
  });
})();
