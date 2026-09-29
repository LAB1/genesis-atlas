/* L3 — FlashAttention. Why attention is IO-bound on a GPU and how tiling + online softmax fix it:
 * memory hierarchy, naive HBM traffic, tiled forward loop, online softmax algebra, IO complexity and
 * recomputation, FA2 partitioning, FA3 Hopper asynchrony + FP8, FA4 / Blackwell and Flash-Decoding. */
(function () {
  var N_DIT = 75600;
  var SCORES = [0.5, 1.2, -0.3, 0.8, 2.1, 0.4, 1.0, -0.5, 0.2, 1.7, 3.0, 0.9, 1.1, -0.2, 0.6, 2.4];

  function boxOf(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }

  function keepWS(root) {
    Array.prototype.forEach.call(root.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
  }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    if (title) ctx.text(x + 16, y + 22, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = boxOf(x, y, w, h);
    return g;
  }

  function textCard(ctx, x, y, w, h, color, title, lines, o) {
    o = o || {};
    var g = card(ctx, o.parent || null, x, y, w, h, color, title);
    ctx.para(x + 18, y + (o.top || 54), lines, { size: o.size || 14, font: 'mono', color: 'text', lh: o.lh || 27, parent: g });
    keepWS(g);
    return g;
  }

  function clearAll(ctx, S) {
    (S.loops || []).forEach(function (l) { l.stop(); });
    S.loops = [];
    if (S.page) ctx.remove(S.page, 450);
    S.page = ctx.group();
    return S.page;
  }

  /* online-softmax bookkeeping for the demo row */
  function onlineStats() {
    var m = -Infinity, l = 0, out = [];
    for (var b = 0; b < 4; b++) {
      var blk = SCORES.slice(b * 4, b * 4 + 4);
      var rm = Math.max.apply(null, blk);
      var mn = Math.max(m, rm);
      var sc = m === -Infinity ? 0 : Math.exp(m - mn);
      var add = blk.reduce(function (a, s) { return a + Math.exp(s - mn); }, 0);
      l = sc * l + add;
      out.push({ blk: blk, rm: rm, mOld: m, m: mn, sc: sc, l: l });
      m = mn;
    }
    return out;
  }

  Atlas.register({
    id: 'flash-attention',
    refs: [
      'Dao, Fu, Ermon, Rudra, Ré, <i>FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness</i>, NeurIPS 2022',
      'Dao, <i>FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning</i>, ICLR 2024',
      'Shah, Bikshandi, Zhang, Thakkar, Ramani, Dao, <i>FlashAttention-3: Fast and Accurate Attention with Asynchrony and Low-precision</i>, NeurIPS 2024',
      'Dao, Haziza, Massa, Sizov, <i>Flash-Decoding for long-context inference</i>, PyTorch / Stanford CRFM blog, 2023',
      'Milakov &amp; Gimelshein, <i>Online normalizer calculation for softmax</i>, 2018; Rabe &amp; Staats, <i>Self-attention Does Not Need O(n²) Memory</i>, 2021',
      'NVIDIA, <i>H100 Tensor Core GPU Architecture</i> whitepaper, 2022; NVIDIA, <i>Blackwell Architecture Technical Brief</i>, 2024',
      'Zadouri, Hoehnerbach, Shah, Liu, Thakkar, Dao, <i>FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling</i>, arXiv 2026',
      'Zhang et al., <i>SageAttention: Accurate 8-Bit Attention for Plug-and-play Inference Acceleration</i>, ICLR 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Memory hierarchy',
        say: 'To understand FlashAttention, forget FLOPs for a moment and look at where bytes live. An H100 has eighty gigabytes of high bandwidth memory, delivering about three point three five terabytes per second. That sounds fast, but the chip can do almost a thousand teraflops. Each of its one hundred thirty two streaming multiprocessors has a small on chip scratchpad, about two hundred twenty eight kilobytes, that is roughly ten times faster in aggregate. Any operation that does little math per byte is limited by the trip to HBM.',
        deep: '<table><tr><th>Level</th><th>Size (H100 SXM5)</th><th>Bandwidth</th></tr>' +
          '<tr><td>Registers</td><td>256 KB / SM (33.8 MB total)</td><td>feeds tensor cores every cycle</td></tr>' +
          '<tr><td>SMEM / L1</td><td>228 KB / SM (≤ 227 KB as shared memory)</td><td>128 B/clk/SM ≈ 30 TB/s aggregate</td></tr>' +
          '<tr><td>L2</td><td>50 MB</td><td>shared by all 132 SMs</td></tr>' +
          '<tr><td>HBM3</td><td>80 GB (5 stacks)</td><td>3.35 TB/s</td></tr>' +
          '<tr><td>Host DRAM</td><td>TBs</td><td>~64 GB/s per direction (PCIe Gen5 x16)</td></tr></table>' +
          '<div class="eq">ridge point = 989 TFLOP/s ÷ 3.35 TB/s ≈ 295 FLOP/byte</div>' +
          '<p>A kernel with arithmetic intensity below ~295 FLOP per HBM byte cannot saturate the tensor cores. Matmuls with d = 128 inner dimension can clear that bar; <b>softmax, masking, scaling and dropout</b> do a handful of FLOPs per element and are purely bandwidth-bound.</p>' +
          '<div class="note">FlashAttention’s thesis: attention is slow not because of O(n²) FLOPs but because of O(n²) <b>HBM bytes</b>. Fix the bytes.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          S.loops = [];
          var g = S.page = ctx.group();
          var chip = ctx.group({ parent: g });
          ctx.rect(60, 180, 720, 400, { rx: 16, fill: 'rgba(8,14,28,0.9)', stroke: ctx.alpha('red', 0.6), sw: 1.6, parent: chip, glow: true });
          ctx.text(80, 204, 'H100 SXM5 DIE · 132 SMs · 989 TFLOP/s dense BF16', { size: 13, font: 'mono', weight: 700, color: 'red', parent: chip, spacing: 1 });
          S.sms = ctx.matrix(90, 232, 11, 12, { cell: 22, gap: 5, cmap: 'cyan', values: function () { return 0.25; }, parent: chip });
          ctx.text(250, 548, '132 streaming multiprocessors', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: chip });
          ctx.rect(440, 232, 320, 84, { rx: 8, fill: ctx.alpha('blue', 0.12), stroke: 'blue', sw: 1.2, parent: chip });
          ctx.text(600, 262, 'L2 cache · 50 MB', { size: 15, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: chip });
          ctx.text(600, 290, 'shared by every SM', { size: 12, font: 'mono', color: 'blue', anchor: 'middle', parent: chip });
          var sm = card(ctx, chip, 440, 336, 320, 190, 'cyan', 'ONE SM (zoom)');
          ctx.para(456, 384, ['4 tensor cores (4th gen)', 'registers   256 KB', 'SMEM / L1   228 KB', 'TMA async-copy engine'], { size: 13, font: 'mono', color: 'text', lh: 30, parent: sm });
          keepWS(sm);
          var src = S.sms.cellCenter(5, 11);
          ctx.path('M' + (src.x + 11) + ',' + src.y + ' L440,380', { stroke: ctx.alpha('cyan', 0.7), sw: 1.2, dash: '3 3', parent: chip });
          ctx.reveal(chip, { from: 'scale', s0: 0.95 });

          /* HBM stacks + pipes */
          var hbm = ctx.group({ parent: g });
          ctx.line(60, 600, 780, 600, { color: ctx.alpha('white', 0.25), dash: '6 6', parent: hbm });
          ctx.text(630, 613, 'off-chip ↕ on-chip', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: hbm });
          S.pipes = [];
          for (var i = 0; i < 5; i++) {
            var x = 80 + i * 140;
            ctx.rect(x, 628, 120, 62, { rx: 6, fill: ctx.alpha('red', 0.14), stroke: 'red', sw: 1.4, parent: hbm });
            ctx.text(x + 60, 652, 'HBM3', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: hbm });
            ctx.text(x + 60, 672, '16 GB', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: hbm });
            S.pipes.push(ctx.line(x + 60, 626, x + 60, 584, { color: ctx.alpha('red', 0.6), sw: 3, parent: hbm }));
          }
          ctx.text(420, 718, '80 GB · 3.35 TB/s total', { size: 15, font: 'mono', weight: 700, color: 'red', anchor: 'middle', parent: hbm });
          ctx.text(420, 760, 'Every byte of Q, K, V, S, P, O that a kernel writes out', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: hbm });
          ctx.text(420, 784, 'must come back across this 3.35 TB/s boundary.', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: hbm });
          ctx.reveal(hbm, { from: 'up', delay: 400 });

          /* pyramid */
          var pyr = ctx.group({ parent: g });
          var layers = [['Registers', '256 KB per SM', 'amber'], ['SMEM / L1', '228 KB/SM · ~30 TB/s aggr.', 'cyan'], ['L2 cache', '50 MB · all SMs', 'blue'], ['HBM3', '80 GB · 3.35 TB/s', 'red'], ['Host DRAM', 'TBs · PCIe5 ~64 GB/s', 'dim']];
          var CX = 1190;
          function hw(y) { return 90 + 240 * (y - 190) / 370; }
          S.layers = layers.map(function (L, k) {
            var y0 = 190 + k * 74, y1 = y0 + 70;
            var lg = ctx.group({ parent: pyr });
            ctx.poly([[CX - hw(y0), y0], [CX + hw(y0), y0], [CX + hw(y1), y1], [CX - hw(y1), y1]], { fill: ctx.alpha(L[2], 0.16), stroke: L[2], sw: 1.3, parent: lg });
            ctx.text(CX, y0 + 24, L[0], { size: 15, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: lg });
            ctx.text(CX, y0 + 48, L[1], { size: 12, font: 'mono', color: L[2] === 'dim' ? 'text' : L[2], anchor: 'middle', parent: lg });
            return lg;
          });
          ctx.text(822, 214, 'faster', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: pyr });
          ctx.text(822, 232, 'smaller', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: pyr });
          ctx.line(822, 248, 822, 518, { color: ctx.alpha('white', 0.3), sw: 1.2, arrow: true, parent: pyr });
          ctx.text(822, 536, 'bigger', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: pyr });
          ctx.text(822, 554, 'slower', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: pyr });
          ctx.reveal(S.layers, { from: 'down', stagger: 150, delay: 600 });

          var roof = textCard(ctx, 860, 600, 680, 260, 'amber', 'ROOFLINE ARITHMETIC', [
            'ridge = 989 TFLOP/s ÷ 3.35 TB/s ≈ 295 FLOP/byte',
            'QKᵀ, PV matmuls (inner dim 128): can clear it',
            'mask · softmax · scale · dropout: ~1–5 FLOP/byte',
            '→ bandwidth-bound unless fused on-chip',
            'rule for attention: count HBM bytes, not FLOPs'
          ], { lh: 34, parent: g });
          ctx.reveal(roof, { from: 'up', delay: 1200 });

          /* live traffic: packets rising through the HBM pipes, SMs flickering */
          S.pipes.forEach(function (p, i) { S.loops.push(ctx.stream(p, { color: 'red', count: 2, period: 900 + i * 90, r: 3, reverse: true })); });
          S.loops.push(ctx.loop(function (t) {
            for (var r = 0; r < 11; r++) for (var c = 0; c < 12; c++) {
              var v = 0.18 + 0.5 * Math.max(0, Math.sin(t * 1.7 + r * 0.9 + c * 0.55));
              S.sms.cells[r][c].setAttribute('fill', ctx.cmap('cyan', v));
            }
          }));
          return ctx.wait(1600).then(function () {
            return ctx.pulse(S.layers[1], { color: 'cyan', dur: 700 });
          }).then(function () {
            return ctx.pulse(S.layers[3], { color: 'red', dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Naive is IO-bound',
        say: 'Here is standard attention for one head of our video model, where a single shot is seventy five thousand tokens. The kernel computes the score matrix and writes it to HBM: eleven gigabytes. Softmax reads it back and writes the probabilities: another twenty two. The value multiply reads them again. That is forty five gigabytes of traffic for one head in one layer, at least thirteen milliseconds, while the actual math needs only three. The GPU spends most of its time waiting on memory.',
        deep: '<pre>S = Q @ K.T / sqrt(d)     # write n×n\nP = softmax(S)            # read n×n, write n×n\nO = P @ V                 # read n×n</pre>' +
          '<p>One DiT head, n = 75,600 (Wan 2.1 720p shot), d = 128, BF16:</p>' +
          '<table><tr><th>Tensor</th><th>Size</th></tr>' +
          '<tr><td>Q, K, V, O</td><td>n·d·2 B = 19.4 MB each</td></tr>' +
          '<tr><td>S, P</td><td>n²·2 B = 11.4 GB each</td></tr></table>' +
          '<div class="eq">HBM traffic ≥ 4·n²·2 B = 45.7 GB → ≥ 13.6 ms at 3.35 TB/s</div>' +
          '<div class="eq">FLOPs = 4·n²·d = 2.93 TFLOP → 3.0 ms at 989 TFLOP/s</div>' +
          '<p>So the naive kernel is ≥ 4.6× slower than the math requires, and a 40-head × 40-layer model repeats this 1,600 times per denoising step. Worse, 22.9 GB of scratch per head does not even fit alongside activations for training. Kernel fusion (e.g. XLA/torch.compile fusing mask + softmax) removes some passes, but cannot avoid materialising S as long as softmax needs the full row.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('naive: ≥ 45.7 GB HBM traffic per head-layer');
          var g = clearAll(ctx, S);
          S.onchip = ctx.node({ x: 800, y: 240, w: 640, h: 96, title: 'ON-CHIP · registers + SMEM + tensor cores', sub: 'the only place math happens', icon: 'chip', color: 'cyan', titleSize: 17, subSize: 12, parent: g });
          var band = ctx.group({ parent: g });
          ctx.rect(60, 560, 1480, 300, { rx: 14, fill: ctx.alpha('red', 0.05), stroke: ctx.alpha('red', 0.55), dash: '6 6', parent: band });
          ctx.text(80, 584, 'HBM3 · 80 GB · 3.35 TB/s', { size: 13, font: 'mono', weight: 700, color: 'red', parent: band, spacing: 1 });
          function tall(x, name, col) {
            ctx.rect(x, 620, 36, 200, { rx: 4, fill: ctx.alpha(col, 0.35), stroke: col, sw: 1.2, parent: band });
            ctx.text(x + 18, 838, name, { size: 14, font: 'mono', weight: 700, color: col, anchor: 'middle', parent: band });
          }
          tall(130, 'Q', 'amber'); tall(190, 'K', 'cyan'); tall(250, 'V', 'violet'); tall(1100, 'O', 'violet');
          ctx.text(210, 604, 'n × d each: 19.4 MB', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: band });
          S.Sm = ctx.matrix(470, 620, 10, 10, { cell: 18, gap: 2, parent: band, values: function () { return '#0b1222'; } });
          S.Pm = ctx.matrix(790, 620, 10, 10, { cell: 18, gap: 2, parent: band, values: function () { return '#0b1222'; } });
          ctx.text(569, 838, 'S = QKᵀ   n × n = 11.4 GB', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: band });
          ctx.text(889, 838, 'P = softmax(S)   11.4 GB', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: band });
          ctx.reveal([S.onchip, band], { from: 'up', stagger: 200 });

          S.code = ctx.code({ x: 60, y: 180, w: 400, title: 'standard attention · one head', lang: 'py', size: 13, parent: g, lines: [
            'S = Q @ K.T / sqrt(d)',
            'P = softmax(S, dim=-1)',
            'O = P @ V'
          ] });
          S.codeHi = ctx.rect(66, 180 + 46 - 11, 388, 22, { rx: 4, fill: ctx.alpha('amber', 0.15), stroke: ctx.alpha('amber', 0.6), sw: 1, parent: g });
          S.codeHi.setAttribute('opacity', 0);
          ctx.reveal(S.code, { from: 'left', delay: 300 });

          var cc = card(ctx, g, 1160, 330, 380, 200, 'red', 'HBM TRAFFIC · ONE HEAD');
          ctx.text(1176, 376, 'n = 75,600 · d = 128 · BF16', { size: 12, font: 'mono', color: 'dim', parent: cc });
          S.gb = ctx.text(1176, 408, '0.0 GB', { size: 26, font: 'display', weight: 700, color: 'white', parent: cc });
          ctx.text(1176, 440, 'IO time', { size: 12, font: 'mono', color: 'red', parent: cc });
          ctx.text(1176, 486, 'math', { size: 12, font: 'mono', color: 'amber', parent: cc });
          ctx.rect(1250, 430, 270, 20, { rx: 3, fill: 'rgba(255,255,255,0.04)', parent: cc });
          ctx.rect(1250, 476, 270, 20, { rx: 3, fill: 'rgba(255,255,255,0.04)', parent: cc });
          S.ioBar = ctx.rect(1250, 430, 0, 20, { rx: 3, fill: ctx.alpha('red', 0.6), parent: cc });
          S.mathBar = ctx.rect(1250, 476, 0, 20, { rx: 3, fill: ctx.alpha('amber', 0.6), parent: cc });
          S.ioTxt = ctx.text(1520, 462, '', { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: cc });
          S.mathTxt = ctx.text(1520, 508, '', { size: 12, font: 'mono', color: 'amber', anchor: 'end', parent: cc });
          ctx.reveal(cc, { from: 'right', delay: 400 });

          /* transfer paths */
          function up(x0) { return ctx.path('M' + x0 + ',616 C' + x0 + ',420 800,420 800,292', { stroke: ctx.alpha('white', 0.25), sw: 1.4, dash: '4 5', parent: g }); }
          S.pQ = up(148); S.pK = up(208); S.pV = up(268);
          S.pS = up(569); S.pP = up(889);
          S.pO = ctx.path('M800,292 C800,420 1118,420 1118,616', { stroke: ctx.alpha('white', 0.25), sw: 1.4, dash: '4 5', parent: g });
          var hr = ctx.rng(4);
          var heat = []; for (var a = 0; a < 10; a++) { heat.push([]); for (var b = 0; b < 10; b++) heat[a].push(0.2 + hr() * 0.8); }
          function fillM(M, t, cm) { M.set(function (r, c) { return (r * 10 + c) / 100 < t ? ctx.cmap(cm, heat[r][c]) : '#0b1222'; }); }
          function traffic(gb) {
            S.gb.textContent = gb.toFixed(1) + ' GB';
            var ms = gb / 3.35;
            S.ioBar.setAttribute('width', 270 * Math.min(1, ms / 14));
            S.ioTxt.textContent = '≥ ' + ms.toFixed(1) + ' ms';
          }
          function hi(k) { S.codeHi.setAttribute('opacity', 1); S.codeHi.setAttribute('y', 180 + 46 - 11 + k * 13 * 1.55); }
          function endState() {
            fillM(S.Sm, 1, 'heat'); fillM(S.Pm, 1, 'amber'); traffic(45.7);
            S.mathBar.setAttribute('width', 270 * 3.0 / 14); S.mathTxt.textContent = '3.0 ms';
            S.codeHi.setAttribute('opacity', 0);
          }
          if (ctx.instant) { endState(); return Promise.resolve(); }
          traffic(0);
          return ctx.wait(900).then(function () {
            hi(0);
            return Promise.all([ctx.packet(S.pQ, { color: 'amber', dur: 700 }), ctx.packet(S.pK, { color: 'cyan', dur: 700 })]);
          }).then(function () {
            ctx.pulse(S.onchip, { color: 'cyan', dur: 400 });
            ctx.packet(S.pS, { color: 'red', dur: 700, reverse: true, label: 'write S' });
            return ctx.tween(900, function (t) { fillM(S.Sm, t, 'heat'); traffic(11.4 * t); }, 'linear', 400);
          }).then(function () {
            hi(1);
            return ctx.packet(S.pS, { color: 'red', dur: 700, label: 'read S' }).then(function () { traffic(22.8); });
          }).then(function () {
            ctx.packet(S.pP, { color: 'red', dur: 700, reverse: true, label: 'write P' });
            return ctx.tween(900, function (t) { fillM(S.Pm, t, 'amber'); traffic(22.8 + 11.4 * t); }, 'linear', 400);
          }).then(function () {
            hi(2);
            ctx.packet(S.pV, { color: 'violet', dur: 700 });
            return ctx.packet(S.pP, { color: 'red', dur: 700, label: 'read P' });
          }).then(function () {
            traffic(45.7);
            return ctx.packet(S.pO, { color: 'violet', dur: 700 });
          }).then(function () {
            return ctx.tween(700, function (t) { S.mathBar.setAttribute('width', 270 * 3.0 / 14 * t); S.mathTxt.textContent = (3.0 * t).toFixed(1) + ' ms'; }, 'out');
          }).then(function () {
            endState();
            return ctx.pulse(S.ioBar, { color: 'red', dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Tiling',
        say: 'FlashAttention never builds the full matrix. It cuts queries into blocks of one hundred twenty eight rows, and each thread block loads one query block into shared memory. Then it streams key and value blocks through, one at a time, computing a small tile of scores in registers, using it, and throwing it away. Only the final output block is written back. The big n by n matrix exists only virtually, one tile at a time, so it never touches HBM at all.',
        deep: '<pre># one CTA per Q block\nfor i in parallel(n / Br):\n  load Q_i                 # -> SMEM\n  m = -inf; l = 0; O = 0   # registers\n  for j in range(n / Bc):\n    load K_j, V_j          # streamed\n    S  = Q_i @ K_j.T * scale\n    mn = max(m, rowmax(S))\n    P  = exp(S - mn)\n    l  = exp(m - mn) * l + rowsum(P)\n    O  = exp(m - mn) * O + P @ V_j\n    m  = mn\n  write O_i = O / l ;  L_i = m + log(l)</pre>' +
          '<p>SRAM budget (d = 128, BF16, B<sub>r</sub> = B<sub>c</sub> = 128): Q<sub>i</sub> 32 KB + two pipeline stages of K<sub>j</sub>,V<sub>j</sub> 128 KB ≈ 160 KB ≤ 227 KB of shared memory; S and O accumulate in FP32 registers spread over the CTA’s warps.</p>' +
          '<p>Masking, scaling, dropout and softmax are all <b>fused</b> into this single kernel, so they cost zero extra HBM passes.</p>' +
          '<p class="muted">Loop order shown is FA2’s (Q outer, K/V inner). FA1’s Algorithm 1 had K/V outer and Q inner, so O<sub>i</sub>, m<sub>i</sub>, ℓ<sub>i</sub> were re-read and re-written in HBM on every inner step; the IO bound was the same, the constant factor worse.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          var g = clearAll(ctx, S);
          /* virtual S grid */
          var gridG = ctx.group({ parent: g });
          ctx.text(96, 180, 'Q', { size: 13, font: 'mono', weight: 700, color: 'amber', parent: gridG });
          ctx.text(130, 180, 'K, V blocks →', { size: 12, font: 'mono', color: 'cyan', parent: gridG });
          S.qStrip = []; S.kStrip = [];
          for (var i = 0; i < 8; i++) {
            S.qStrip.push(ctx.rect(96, 226 + i * 38, 24, 34, { rx: 3, fill: ctx.alpha('amber', 0.2), stroke: ctx.alpha('amber', 0.7), sw: 1, parent: gridG }));
            S.kStrip.push(ctx.rect(130 + i * 38, 194, 34, 24, { rx: 3, fill: ctx.alpha('cyan', 0.2), stroke: ctx.alpha('cyan', 0.7), sw: 1, parent: gridG }));
          }
          S.grid = ctx.matrix(130, 226, 8, 8, { cell: 34, gap: 4, parent: gridG, values: function () { return '#0b1222'; }, stroke: ctx.alpha('white', 0.08) });
          ctx.text(282, 548, 'virtual S = QKᵀ: 8 × 8 tiles of 128 × 128', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: gridG });
          ctx.text(282, 566, 'never stored anywhere', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: gridG });
          S.tileHi = ctx.rect(128, 224, 38, 38, { rx: 5, stroke: 'white', sw: 2, glow: true, parent: gridG });
          S.tileHi.setAttribute('opacity', 0);
          ctx.reveal(gridG, { from: 'left' });

          S.code = ctx.code({ x: 480, y: 172, w: 1060, title: 'FlashAttention forward (one CTA per Q block)', lang: 'py', size: 14, parent: g, lines: [
            'for i in parallel(cdiv(n, Br)):                # grid of CTAs',
            '    Q_i = load(Q, i);  m = -inf;  l = 0;  O = 0',
            '    for j in range(cdiv(n, Bc)):',
            '        K_j, V_j = load(K, j), load(V, j)       # stream through SMEM',
            '        S = Q_i @ K_j.T * scale                 # Br x Bc tile, registers',
            '        m_new = max(m, rowmax(S));  P = exp(S - m_new)',
            '        l = exp(m - m_new) * l + rowsum(P)',
            '        O = exp(m - m_new) * O + P @ V_j;  m = m_new',
            '    store(O, i, O / l);  store(L, i, m + log(l))  # once'
          ] });
          keepWS(S.code);
          S.codeHi = ctx.rect(486, 172 + 46 - 11, 1048, 22, { rx: 4, fill: ctx.alpha('amber', 0.12), stroke: ctx.alpha('amber', 0.5), sw: 1, parent: g });
          S.codeHi.setAttribute('opacity', 0);
          ctx.reveal(S.code, { from: 'right', delay: 200 });

          /* HBM */
          var hb = card(ctx, g, 60, 590, 560, 270, 'red', 'HBM');
          S.bars = {};
          [['Q', 'amber', 630], ['K', 'cyan', 682], ['V', 'violet', 734], ['O', 'lime', 786]].forEach(function (b) {
            ctx.text(118, b[2] + 16, b[0], { size: 14, font: 'mono', weight: 700, color: b[1], anchor: 'end', parent: hb });
            S.bars[b[0]] = [];
            for (var k = 0; k < 8; k++) {
              S.bars[b[0]].push(ctx.rect(130 + k * 58, b[2], 54, 32, { rx: 3, fill: b[0] === 'O' ? '#0b1222' : ctx.alpha(b[1], 0.3), stroke: ctx.alpha(b[1], 0.8), sw: 1, parent: hb }));
            }
          });
          ctx.text(360, 842, 'each block = 128 tokens × 128 dims = 32 KB', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: hb });
          ctx.reveal(hb, { from: 'up', delay: 300 });

          /* SRAM */
          var sr = card(ctx, g, 660, 590, 450, 270, 'cyan', 'SRAM + REGISTERS (one CTA)');
          function slot(x, y, w, h, name, col) {
            ctx.text(x + w / 2, y - 12, name, { size: 12, font: 'mono', weight: 700, color: col, anchor: 'middle', parent: sr });
            return ctx.rect(x, y, w, h, { rx: 4, fill: '#0b1222', stroke: ctx.alpha(col, 0.8), sw: 1.2, parent: sr });
          }
          S.sQ = slot(684, 648, 90, 44, 'Q_i', 'amber');
          S.sK = slot(790, 648, 90, 44, 'K_j', 'cyan');
          S.sV = slot(896, 648, 90, 44, 'V_j', 'violet');
          ctx.text(1051, 636, 'S_ij', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: sr });
          S.sS = ctx.matrix(1010, 648, 6, 6, { cell: 12, gap: 2, parent: sr, values: function () { return '#0b1222'; } });
          S.sO = slot(684, 760, 200, 40, 'O_i accumulator (fp32)', 'lime');
          S.sM = slot(904, 760, 70, 40, 'm_i', 'amber');
          S.sL = slot(994, 760, 70, 40, 'ℓ_i', 'amber');
          S.mTxt = ctx.text(939, 781, '−∞', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: sr });
          S.lTxt = ctx.text(1029, 781, '0', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: sr });
          ctx.reveal(sr, { from: 'up', delay: 450 });

          var bud = textCard(ctx, 1140, 590, 400, 270, 'amber', 'SRAM BUDGET · d = 128', [
            'Br = Bc = 128, BF16',
            'Q_i            32 KB',
            'K_j,V_j ×2 stg 128 KB',
            'S_ij, O_i   fp32 regs',
            '≈ 160 KB ≤ 227 KB/SM',
            'K,V re-streamed per Q block',
            '  (mostly L2 hits); O once'
          ], { size: 13, lh: 27, parent: g });
          ctx.reveal(bud, { from: 'right', delay: 600 });

          var mvals = ['0.8', '1.4', '1.9', '2.3', '2.3', '2.6', '2.6', '2.7'];
          var lvals = ['2.1', '2.9', '3.3', '4.0', '4.8', '5.1', '5.9', '6.4'];
          function endState() {
            S.grid.set(function (r, c) { return ctx.alpha('amber', 0.1 + 0.12 * ((r + c) % 2)); });
            S.kStrip.forEach(function (k) { k.setAttribute('fill', ctx.alpha('cyan', 0.3)); });
            S.qStrip.forEach(function (k) { k.setAttribute('fill', ctx.alpha('amber', 0.4)); });
            S.bars.O.forEach(function (b) { b.setAttribute('fill', ctx.alpha('lime', 0.45)); });
            S.tileHi.setAttribute('opacity', 0);
            S.codeHi.setAttribute('opacity', 0);
            S.mTxt.textContent = '2.7'; S.lTxt.textContent = '6.4';
            S.sO.setAttribute('fill', ctx.alpha('lime', 0.4));
          }
          if (ctx.instant) { endState(); return Promise.resolve(); }
          function hi(line, n) { S.codeHi.setAttribute('opacity', 1); S.codeHi.setAttribute('y', 172 + 46 - 11 + line * 14 * 1.55); S.codeHi.setAttribute('height', 22 + (n - 1) * 14 * 1.55); }
          function fly(fromEl, toEl, col, dur) {
            var fx = parseFloat(fromEl.getAttribute('x')), fy = parseFloat(fromEl.getAttribute('y'));
            var tx = parseFloat(toEl.getAttribute('x')), ty = parseFloat(toEl.getAttribute('y'));
            var gh = ctx.group({ parent: g });
            ctx.rect(0, 0, 54, 32, { rx: 3, fill: ctx.alpha(col, 0.7), stroke: col, sw: 1, parent: gh });
            ctx.place(gh, fx, fy);
            return ctx.transform(gh, { x: tx + 18, y: ty + 6 }, dur, 'inOut').then(function () { gh.parentNode.removeChild(gh); toEl.setAttribute('fill', ctx.alpha(col, 0.45)); });
          }
          var sr2 = ctx.rng(12);
          var chain = ctx.wait(700).then(function () {
            hi(1, 1);
            S.qStrip[0].setAttribute('fill', ctx.alpha('amber', 0.7));
            return fly(S.bars.Q[0], S.sQ, 'amber', 600);
          });
          for (var j = 0; j < 8; j++) {
            (function (j) {
              chain = chain.then(function () {
                hi(3, j === 0 ? 5 : 5);
                S.kStrip.forEach(function (k, q) { k.setAttribute('fill', ctx.alpha('cyan', q === j ? 0.8 : 0.2)); });
                S.tileHi.setAttribute('opacity', 1);
                S.tileHi.setAttribute('x', 128 + j * 38);
                var dur = j < 2 ? 520 : 300;
                return Promise.all([fly(S.bars.K[j], S.sK, 'cyan', dur), fly(S.bars.V[j], S.sV, 'violet', dur)]);
              }).then(function () {
                S.grid.cells[0][j].setAttribute('fill', ctx.alpha('amber', 0.85));
                S.sS.set(function () { return ctx.cmap('heat', sr2()); });
                S.mTxt.textContent = mvals[j]; S.lTxt.textContent = lvals[j];
                S.sO.setAttribute('fill', ctx.alpha('lime', 0.1 + j * 0.04));
                return ctx.wait(j < 2 ? 420 : 200);
              }).then(function () {
                S.grid.cells[0][j].setAttribute('fill', ctx.alpha('amber', 0.12));
                S.sS.set(function () { return '#0b1222'; });
              });
            })(j);
          }
          return chain.then(function () {
            hi(8, 1);
            S.tileHi.setAttribute('opacity', 0);
            var gh = ctx.group({ parent: g });
            ctx.rect(0, 0, 54, 32, { rx: 3, fill: ctx.alpha('lime', 0.8), parent: gh });
            ctx.place(gh, 700, 764);
            return ctx.transform(gh, { x: 130, y: 786 }, 700, 'inOut').then(function () { gh.parentNode.removeChild(gh); S.bars.O[0].setAttribute('fill', ctx.alpha('lime', 0.45)); });
          }).then(function () {
            hi(0, 1);
            return ctx.tween(1200, function (t) {
              var rows = Math.floor(t * 7);
              for (var r = 1; r <= rows; r++) {
                S.bars.O[r].setAttribute('fill', ctx.alpha('lime', 0.45));
                S.grid.cells[r].forEach(function (c) { c.setAttribute('fill', ctx.alpha('amber', 0.06)); });
                S.qStrip[r].setAttribute('fill', ctx.alpha('amber', 0.5));
              }
            }, 'linear');
          }).then(function () { endState(); });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Online softmax',
        say: 'But softmax needs the maximum and the sum over the whole row, and we only ever see one block. The trick is the online softmax. Keep a running maximum m and a running normalizer l. When a new block arrives with a larger maximum, multiply the old normalizer and the old output accumulator by e to the power of old max minus new max, then add the new block\'s contributions. Watch the earlier bars shrink each time the maximum grows. At the end, divide once. The result is exact, not an approximation.',
        deep: '<div class="eq">m′ = max(m, rowmax(S<sub>j</sub>)), &nbsp; P̃ = exp(S<sub>j</sub> − m′)</div>' +
          '<div class="eq">ℓ′ = e<sup>m−m′</sup> ℓ + rowsum(P̃), &nbsp; O′ = e<sup>m−m′</sup> O + P̃ V<sub>j</sub></div>' +
          '<pre>def online_attn(q, Kb, Vb):\n  m, l, o = -inf, 0.0, zeros(d)\n  for K, V in zip(Kb, Vb):\n    s = K @ q * scale      # tile\n    m_new = max(m, s.max())\n    a = exp(m - m_new)     # rescale\n    p = exp(s - m_new)\n    l = a * l + p.sum()\n    o = a * o + p @ V\n    m = m_new\n  return o / l, m + log(l) # out, LSE</pre>' +
          '<p><b>Why exact:</b> by induction ℓ = Σ<sub>k≤j</sub> e<sup>s<sub>k</sub>−m</sup> and O = Σ<sub>k≤j</sub> e<sup>s<sub>k</sub>−m</sup>v<sub>k</sub> after every block; the rescale only changes the common reference point m. Dividing at the end instead of per block (an FA2 refinement) saves non-matmul FLOPs. The logsumexp L is the only softmax statistic saved for the backward pass.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          var g = clearAll(ctx, S);
          var st = onlineStats();
          var Y0 = 356, U = 40;
          function bx(k) { return 110 + k * 42 + Math.floor(k / 4) * 18; }
          var top = card(ctx, g, 60, 176, 790, 244, 'amber', 'ONE QUERY ROW · 16 KEYS IN 4 BLOCKS · scores s');
          ctx.line(90, Y0, 830, Y0, { color: ctx.alpha('white', 0.25), parent: top });
          S.sBars = SCORES.map(function (s, k) {
            var h = Math.abs(s) * U;
            var b = ctx.rect(bx(k), s >= 0 ? Y0 - h : Y0, 32, h, { rx: 3, fill: ctx.alpha('dim', 0.35), stroke: 'dim', sw: 1, parent: top });
            ctx.text(bx(k) + 16, s >= 0 ? Y0 - h - 10 : Y0 + h + 10, s.toFixed(1), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: top });
            return b;
          });
          for (var b = 0; b < 4; b++) ctx.text(bx(b * 4) + 80, 404, 'block ' + (b + 1), { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: top });
          S.mLine = ctx.line(90, Y0, 90, Y0, { color: 'amber', sw: 2, dash: '6 4', parent: top });
          S.mLbl = ctx.text(840, Y0, '', { size: 13, font: 'mono', weight: 700, color: 'amber', anchor: 'end', parent: top });
          ctx.reveal(top, { from: 'left' });

          var mid = card(ctx, g, 60, 436, 790, 220, 'lime', 'CONTRIBUTIONS  p̃ = exp(s − m_running)');
          var PB = 636, PH = 150;
          ctx.line(90, PB, 830, PB, { color: ctx.alpha('white', 0.25), parent: mid });
          S.pBars = SCORES.map(function (s, k) { return ctx.rect(bx(k), PB, 32, 0, { rx: 3, fill: ctx.alpha('lime', 0.55), stroke: 'lime', sw: 1, parent: mid }); });
          ctx.text(830, 470, 'old bars shrink by e^(m − m′) when the max grows', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: mid });
          ctx.reveal(mid, { from: 'left', delay: 200 });

          var eq = card(ctx, g, 880, 176, 660, 300, 'amber', 'ONLINE SOFTMAX (per query row)');
          ctx.para(904, 226, [
            'm′ = max( m, rowmax(S_j) )',
            'P̃  = exp( S_j − m′ )',
            'ℓ′ = e^(m − m′) · ℓ + rowsum(P̃)',
            'O′ = e^(m − m′) · O + P̃ · V_j',
            'end:  O ← O / ℓ     L = m + log ℓ'
          ], { size: 18, font: 'mono', color: 'white', lh: 48, parent: eq });
          keepWS(eq);
          ctx.reveal(eq, { from: 'right', delay: 300 });

          var ro = card(ctx, g, 880, 496, 660, 160, 'cyan', 'RUNNING STATE');
          S.roM = ctx.text(904, 556, 'm = −∞', { size: 22, font: 'display', weight: 700, color: 'amber', parent: ro });
          S.roL = ctx.text(1120, 556, 'ℓ = 0', { size: 22, font: 'display', weight: 700, color: 'lime', parent: ro });
          S.roS = ctx.text(1330, 556, '', { size: 22, font: 'display', weight: 700, color: 'magenta', parent: ro });
          S.roN = ctx.text(904, 610, 'waiting for block 1', { size: 13, font: 'mono', color: 'dim', parent: ro });
          ctx.reveal(ro, { from: 'right', delay: 400 });

          var tb = card(ctx, g, 60, 676, 1480, 184, 'white', '');
          var cols = [[84, 'block'], [190, 'scores'], [520, 'rowmax'], [650, 'm′'], [770, 'e^(m − m′)'], [940, 'ℓ′'], [1060, 'what happened']];
          cols.forEach(function (c) { ctx.text(c[0], 698, c[1], { size: 12, font: 'mono', weight: 700, color: 'cyan', parent: tb }); });
          var notes = ['first block: m = rowmax', 'bigger max → rescale ℓ and O', 'bigger max again → rescale', 'no new max → scale = 1'];
          S.rows = st.map(function (r, i) {
            var rg = ctx.group({ parent: tb }), y = 726 + i * 28;
            ctx.text(84, y, String(i + 1), { size: 13, font: 'mono', color: 'white', parent: rg });
            ctx.text(190, y, r.blk.map(function (v) { return v.toFixed(1); }).join('  '), { size: 13, font: 'mono', color: 'text', parent: rg });
            ctx.text(520, y, r.rm.toFixed(2), { size: 13, font: 'mono', color: 'text', parent: rg });
            ctx.text(650, y, r.m.toFixed(2), { size: 13, font: 'mono', color: 'amber', parent: rg });
            ctx.text(770, y, i === 0 ? '— (ℓ = 0)' : r.sc.toFixed(3), { size: 13, font: 'mono', color: r.sc < 1 && i > 0 ? 'magenta' : 'text', parent: rg });
            ctx.text(940, y, r.l.toFixed(3), { size: 13, font: 'mono', color: 'lime', parent: rg });
            ctx.text(1060, y, notes[i], { size: 13, font: 'mono', color: 'dim', parent: rg });
            rg.setAttribute('opacity', 0);
            return rg;
          });
          var exact = SCORES.reduce(function (a, s) { return a + Math.exp(s - 3.0); }, 0);
          S.check = ctx.text(84, 842, 'check: Σ_k exp(s_k − 3.00) over all 16 keys = ' + exact.toFixed(3) + '  = ℓ after block 4  ✓ exact, one pass, O(1) extra memory per row', { size: 13, font: 'mono', color: 'white', parent: tb });
          S.check.setAttribute('opacity', 0);
          keepWS(tb);
          ctx.reveal(tb, { from: 'up', delay: 500 });

          function setM(m, upto) {
            var y = Y0 - m * U;
            S.mLine.setAttribute('y1', y); S.mLine.setAttribute('y2', y);
            S.mLine.setAttribute('x2', bx(upto * 4 - 1) + 36);
            S.mLbl.setAttribute('y', y - 12);
            S.mLbl.textContent = 'm = ' + m.toFixed(2);
          }
          function setP(m, upto) {
            SCORES.forEach(function (s, k) {
              var h = k < upto * 4 ? PH * Math.exp(s - m) : 0;
              S.pBars[k].setAttribute('y', PB - h); S.pBars[k].setAttribute('height', h);
            });
          }
          function apply(i) {
            var r = st[i];
            S.mLine.setAttribute('opacity', 1);
            S.rows[i].setAttribute('opacity', 1);
            for (var k = i * 4; k < i * 4 + 4; k++) { S.sBars[k].setAttribute('fill', ctx.alpha('cyan', 0.45)); S.sBars[k].setAttribute('stroke', ctx.C.cyan); }
            S.roM.textContent = 'm = ' + r.m.toFixed(2);
            S.roL.textContent = 'ℓ = ' + r.l.toFixed(3);
            S.roS.textContent = i === 0 ? '' : '×' + r.sc.toFixed(3);
            S.roN.textContent = i === 0 ? 'block 1 sets the reference max' : (r.sc < 1 ? 'max grew: old ℓ and O multiplied by ' + r.sc.toFixed(3) : 'max unchanged: nothing to rescale');
          }
          if (ctx.instant) {
            for (var q = 0; q < 4; q++) apply(q);
            setM(3.0, 4); setP(3.0, 4);
            S.check.setAttribute('opacity', 1);
            return Promise.resolve();
          }
          S.mLine.setAttribute('opacity', 0);
          var chain = ctx.wait(1200);
          st.forEach(function (r, i) {
            chain = chain.then(function () {
              apply(i);
              var mOld = i === 0 ? r.m : st[i - 1].m;
              /* new block's bars appear at the old reference, then everything rescales to the new max */
              setM(mOld, i + 1); setP(mOld, i);
              return ctx.wait(400).then(function () {
                return ctx.tween(900, function (t) {
                  var m = mOld + (r.m - mOld) * t;
                  setM(m, i + 1);
                  SCORES.forEach(function (s, k) {
                    var h;
                    if (k < i * 4) h = PH * Math.exp(s - m);
                    else if (k < i * 4 + 4) h = PH * Math.exp(s - r.m) * t;
                    else h = 0;
                    S.pBars[k].setAttribute('y', PB - h); S.pBars[k].setAttribute('height', h);
                  });
                }, 'inOut');
              }).then(function () {
                if (r.sc < 1 && i > 0) ctx.pulse(S.roS, { color: 'magenta', dur: 500 });
                return ctx.wait(700);
              });
            });
          });
          return chain.then(function () {
            return ctx.reveal(S.check, { from: 'up' });
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'IO & recompute',
        say: 'What does this buy? For one head of our video shot, the extra memory drops from twenty three gigabytes to a third of a megabyte: just the log sum exp per row. And the kernel becomes compute bound. Training needs a backward pass, which would normally reuse the stored probability matrix. FlashAttention stores nothing of size n squared. It recomputes each score tile from Q and K in the backward pass, spending about a quarter more FLOPs to save a mountain of memory traffic, and it is still faster.',
        deep: '<div class="eq">HBM accesses: standard Θ(nd + n²) &nbsp;vs&nbsp; FlashAttention Θ(n²d²/M)</div>' +
          '<p>M = SRAM size in elements. For d = 128 and M ≈ 100 K elements, d²/M ≈ 0.16, and no n×n buffer exists at all. The paper also proves a lower bound: no exact attention algorithm can asymptotically beat this for all M ∈ [d, nd].</p>' +
          '<p><b>Backward</b> (per tile, with D<sub>i</sub> = rowsum(dO<sub>i</sub> ∘ O<sub>i</sub>)):</p>' +
          '<div class="eq">P<sub>ij</sub> = exp(Q<sub>i</sub>K<sub>j</sub>ᵀ·s − L<sub>i</sub>), &nbsp; dV<sub>j</sub> += P<sub>ij</sub>ᵀ dO<sub>i</sub>, &nbsp; dP<sub>ij</sub> = dO<sub>i</sub>V<sub>j</sub>ᵀ</div>' +
          '<div class="eq">dS<sub>ij</sub> = P<sub>ij</sub> ∘ (dP<sub>ij</sub> − D<sub>i</sub>), &nbsp; dQ<sub>i</sub> += s·dS<sub>ij</sub>K<sub>j</sub>, &nbsp; dK<sub>j</sub> += s·dS<sub>ij</sub>ᵀQ<sub>i</sub></div>' +
          '<p>Five tile matmuls (one is the recompute) versus four with a stored P: ~25% more backward FLOPs, but no n² reads. Reported speedups at release: 3× on GPT-2 (seq 1k) training, 15% end-to-end on BERT-large (seq 512) versus the MLPerf 1.1 record, and the first Transformers to beat chance on Path-X (16k) and Path-256 (64k). Times shown here are estimates from bandwidth and FA3-class throughput.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('extra memory per head: 22.9 GB → 0.3 MB');
          var g = clearAll(ctx, S);
          var L = card(ctx, g, 60, 176, 760, 350, 'amber', 'ONE HEAD-LAYER · n = 75,600 · d = 128 · H100');
          ctx.text(80, 226, 'extra HBM memory (log scale)', { size: 12, font: 'mono', color: 'dim', parent: L });
          ctx.text(80, 384, 'time (estimate)', { size: 12, font: 'mono', color: 'dim', parent: L });
          var X = 250, WW = 440;
          function lg(mb) { return (Math.log10(mb) + 1) / 6 * WW; }
          var rows = [
            [256, 'naive', 'S + P = 22.9 GB', lg(22900), 'red'],
            [300, 'Flash', 'L = 0.3 MB', lg(0.3), 'lime'],
            [414, 'naive', '≥ 13.6 ms (HBM-bound)', 13.6 / 14 * WW, 'red'],
            [458, 'FA3', '≈ 4.0 ms (740 TFLOP/s)', 4.0 / 14 * WW, 'lime']
          ];
          S.lBars = rows.map(function (r) {
            ctx.text(X - 12, r[0] + 14, r[1], { size: 13, font: 'mono', weight: 700, color: r[4], anchor: 'end', parent: L });
            ctx.rect(X, r[0], WW, 28, { rx: 4, fill: 'rgba(255,255,255,0.03)', parent: L });
            var b = ctx.rect(X, r[0], 0, 28, { rx: 4, fill: ctx.alpha(r[4], 0.5), stroke: r[4], sw: 1, parent: L });
            var t = ctx.text(X + 8, r[0] + 14, r[2], { size: 12, font: 'mono', color: 'white', parent: L });
            return { b: b, t: t, w: r[3] };
          });
          ctx.text(X, 344, '0.1 MB', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
          ctx.text(X + WW, 344, '100 GB', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
          ctx.text(80, 512, 'forward FLOPs identical (exact attention); only the bytes changed', { size: 12, font: 'mono', color: 'amber', parent: L });
          ctx.reveal(L, { from: 'left' });

          /* backward recompute pipeline */
          var R = card(ctx, g, 850, 176, 690, 350, 'violet', 'BACKWARD: RECOMPUTE, DON’T STORE');
          ctx.text(870, 214, 'forward saved only O and L = m + log ℓ  (n floats)', { size: 12, font: 'mono', color: 'dim', parent: R });
          var nodes = [
            [930, 280, 'Q_i, K_j', 'amber'], [1080, 280, 'S_ij', 'white'], [1230, 280, 'P_ij', 'amber'], [1400, 280, 'dV_j += Pᵀ dO', 'violet'],
            [1230, 380, 'dP = dO Vᵀ', 'violet'], [1080, 380, 'dS = P∘(dP − D)', 'magenta'], [930, 470, 'dQ_i += dS K', 'cyan'], [1230, 470, 'dK_j += dSᵀ Q', 'cyan'],
            [1410, 380, 'dO_i, V_j', 'violet']
          ];
          S.bn = nodes.map(function (n) {
            return ctx.node({ x: n[0], y: n[1], w: n[2].length * 8 + 30, h: 40, title: n[2], color: n[3], kind: 'pill', titleSize: 13, glow: false, parent: R });
          });
          var edges = [[0, 1], [1, 2], [2, 3], [8, 4], [2, 5], [4, 5], [5, 6], [5, 7]];
          S.bl = edges.map(function (e) { return ctx.link(S.bn[e[0]], S.bn[e[1]], { color: ctx.alpha('white', 0.4), sw: 1.3, parent: R }); });
          ctx.text(1080, 322, 'recomputed in SRAM', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: R });
          ctx.reveal(R, { from: 'right', delay: 200 });

          var bot = textCard(ctx, 60, 546, 1480, 314, 'cyan', 'IO COMPLEXITY  (Dao et al., 2022)', [
            'standard attention:  Θ(n·d + n²) HBM accesses        FlashAttention:  Θ(n²·d² / M),  M = SRAM size',
            'd = 128, M ≈ 10⁵ elements  →  d²/M ≈ 0.16, and no n × n buffer ever exists',
            'intensity ≈ Br FLOP per byte of K,V streamed (≈128), plus L2 reuse across concurrent CTAs → compute-bound',
            'backward: 5 tile matmuls (1 recompute) vs 4 with stored P → ~25% more FLOPs, far fewer bytes, net faster',
            'lower bound: no exact algorithm asymptotically beats this for every SRAM size M in [d, n·d]',
            'memory O(n) instead of O(n²): what made 64k+ training contexts and 75k-token video shots practical'
          ], { size: 14, lh: 40, top: 62, parent: g });
          ctx.reveal(bot, { from: 'up', delay: 400 });

          function grow(t) { S.lBars.forEach(function (e) { e.b.setAttribute('width', Math.max(2, e.w * t)); e.t.setAttribute('x', e.w > 300 ? 258 : 250 + Math.max(2, e.w * t) + 8); }); }
          if (ctx.instant) { grow(1); return Promise.resolve(); }
          grow(0);
          return ctx.wait(600).then(function () {
            return ctx.tween(1400, grow, 'out');
          }).then(function () {
            var chain = Promise.resolve();
            S.bl.forEach(function (l, i) { chain = chain.then(function () { return ctx.packet(l, { color: 'violet', dur: 380, r: 4 }); }); });
            return chain;
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'FA2: partitioning',
        say: 'FlashAttention two kept the math and fixed the scheduling. The first version launched one thread block per batch element and head. For our video model with batch one and forty heads, that is forty blocks on a GPU with one hundred thirty two processors: most of the chip idles. Version two also parallelizes over query blocks, so thousands of blocks fill every processor. Inside a block, warps now split the queries instead of the keys, so they never need to exchange partial results through shared memory.',
        deep: '<ul><li><b>Sequence parallelism</b>: grid = batch × heads × ⌈n/B<sub>r</sub>⌉. With B·H = 40 and n = 75.6k: 40 × 591 = 23,640 CTAs instead of 40. Loop order swapped: Q-block outer, K/V inner.</li>' +
          '<li><b>Split-Q, not split-K</b>: FA1 split K/V across 4 warps, so every warp produced partial rows that had to be written to SMEM, synchronised and summed. FA2 gives each warp its own slice of query rows; every warp sees all of K/V and finishes its rows independently.</li>' +
          '<li><b>Fewer non-matmul FLOPs</b>: A100 does 312 TFLOP/s of FP16 matmul but only 19.5 TFLOP/s of FP32 elementwise math, so each non-matmul FLOP costs ~16×. FA2 keeps O un-normalised until the end and stores only the logsumexp.</li>' +
          '<li>Backward parallelises over K/V blocks; dQ is accumulated with atomic adds.</li></ul>' +
          '<p>Result: ~2× over FA1, 50–73% of A100 peak in the forward pass, and up to 225 TFLOP/s per A100 (72% model FLOPs utilisation) in end-to-end GPT training.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          var g = clearAll(ctx, S);
          var L = card(ctx, g, 60, 176, 720, 400, 'cyan', 'CTAs → SMs · 1 video · 40 heads · n = 75.6k');
          S.grid = ctx.matrix(90, 214, 11, 12, { cell: 22, gap: 5, parent: L, values: function () { return '#0b1222'; }, stroke: ctx.alpha('cyan', 0.25) });
          S.modeT = ctx.text(440, 236, 'FlashAttention-1', { size: 16, font: 'display', weight: 700, color: 'white', parent: L });
          S.modeA = ctx.text(440, 270, 'grid = batch × heads', { size: 13, font: 'mono', color: 'text', parent: L });
          S.modeB = ctx.text(440, 294, '     = 1 × 40 = 40 CTAs', { size: 13, font: 'mono', color: 'text', parent: L });
          S.occ = ctx.text(440, 340, 'busy SMs  40 / 132', { size: 20, font: 'display', weight: 700, color: 'red', parent: L });
          S.occSub = ctx.text(440, 368, '70% of the GPU idles', { size: 13, font: 'mono', color: 'red', parent: L });
          ctx.para(440, 420, ['long sequence, small batch:', 'exactly the video-DiT and', 'long-context LLM regime'], { size: 12, font: 'mono', color: 'dim', lh: 20, parent: L });
          keepWS(L);
          ctx.reveal(L, { from: 'left' });
          function paint(n) { S.grid.set(function (r, c) { return r * 12 + c < n ? ctx.alpha('cyan', 0.75) : '#0b1222'; }); }
          paint(40);

          /* warp partitioning */
          var R = card(ctx, g, 810, 176, 730, 400, 'amber', 'INSIDE ONE CTA · 4 WARPS');
          var WC = ['amber', 'cyan', 'lime', 'magenta'];
          function diagram(x0, title, splitQ) {
            ctx.text(x0 + 150, 244, title, { size: 14, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: R });
            for (var w = 0; w < 4; w++) {
              ctx.rect(x0, 268 + w * 30, 70, 28, { rx: 2, fill: splitQ ? ctx.alpha(WC[w], 0.45) : ctx.alpha('white', 0.08), stroke: splitQ ? WC[w] : ctx.alpha('white', 0.3), sw: 1, parent: R });
              ctx.rect(x0 + 110 + w * 46, 268, 44, 70, { rx: 2, fill: splitQ ? ctx.alpha('white', 0.08) : ctx.alpha(WC[w], 0.45), stroke: splitQ ? ctx.alpha('white', 0.3) : WC[w], sw: 1, parent: R });
            }
            ctx.text(x0 + 35, 402, 'Q_i', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: R });
            ctx.text(x0 + 200, 354, 'K_jᵀ, V_j', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: R });
          }
          diagram(840, 'FA1 · split-K', false);
          diagram(1190, 'FA2 · split-Q', true);
          ctx.line(1175, 226, 1175, 540, { color: ctx.alpha('white', 0.15), parent: R });
          S.warnG = ctx.group({ parent: R });
          ctx.icon('warn', 862, 462, 22, 'red', { parent: S.warnG });
          ctx.para(882, 454,['partial rows per warp →', 'write SMEM, __syncthreads,', 'reduce: extra traffic'], { size: 12, font: 'mono', color: 'red', lh: 19, parent: S.warnG });
          S.okG = ctx.group({ parent: R });
          ctx.icon('check', 1212, 462, 22, 'lime', { parent: S.okG });
          ctx.para(1232, 454,['each warp owns its rows,', 'reads all of K/V from SMEM,', 'no inter-warp exchange'], { size: 12, font: 'mono', color: 'lime', lh: 19, parent: S.okG });
          ctx.reveal(R, { from: 'right', delay: 200 });

          var b1 = textCard(ctx, 60, 600, 720, 260, 'magenta', 'FEWER NON-MATMUL FLOPs', [
            'A100: 312 TFLOP/s FP16 matmul vs 19.5 FP32 other',
            '→ each exp / max / scale costs ~16× a matmul FLOP',
            'keep O un-normalised; divide by ℓ once at the end',
            'save only logsumexp L (not m and ℓ) for backward'
          ], { lh: 50, top: 62, parent: g });
          var b2 = textCard(ctx, 810, 600, 730, 260, 'lime', 'RESULT (A100)', [
            '~2× FlashAttention-1',
            '50–73% of peak FLOP/s in the forward pass',
            'end-to-end GPT training: 225 TFLOP/s/GPU (72% MFU)',
            'backward: parallel over K/V blocks, atomic dQ'
          ], { lh: 50, top: 62, parent: g });
          ctx.reveal([b1, b2], { from: 'up', delay: 400, stagger: 150 });

          function fa2() {
            S.modeT.textContent = 'FlashAttention-2';
            S.modeA.textContent = 'grid = batch × heads × n/Br';
            S.modeB.textContent = '     = 40 × 591 = 23,640 CTAs';
            S.occ.textContent = 'busy SMs  132 / 132'; S.occ.setAttribute('fill', ctx.C.lime);
            S.occSub.textContent = '~179 waves at 1 CTA/SM, no idle SMs'; S.occSub.setAttribute('fill', ctx.C.lime);
          }
          if (ctx.instant) {
            fa2(); paint(132);
            S.loops.push(ctx.loop(function (t) { S.grid.set(function (r, c) { return ctx.alpha('cyan', 0.45 + 0.35 * Math.max(0, Math.sin(t * 3 - (r * 12 + c) * 0.08))); }); }));
            return Promise.resolve();
          }
          return ctx.wait(1500).then(function () {
            ctx.pulse(S.occ, { color: 'red', dur: 600 });
            return ctx.wait(1200);
          }).then(function () {
            fa2();
            return ctx.tween(1200, function (t) { paint(40 + Math.round(92 * t)); }, 'out');
          }).then(function () {
            S.loops.push(ctx.loop(function (t) { S.grid.set(function (r, c) { return ctx.alpha('cyan', 0.45 + 0.35 * Math.max(0, Math.sin(t * 3 - (r * 12 + c) * 0.08))); }); }));
            ctx.pulse(S.okG, { color: 'lime', dur: 700 });
            return ctx.pulse(S.occ, { color: 'lime', dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'FA3 on Hopper',
        say: 'Hopper changed the rules again. Its tensor cores are so fast that the exponentials in softmax, computed on slow special function units, can take half as long as the matrix multiplies. FlashAttention three hides them. Producer warps issue asynchronous bulk copies with the TMA engine, while two consumer warpgroups play ping pong: one runs softmax while the other keeps the tensor cores busy with asynchronous matrix multiplies. It also runs in FP8, first rotating queries and keys with a random Hadamard transform to spread out outliers.',
        deep: '<p>H100 SXM5: 989 TFLOP/s dense FP16 matmul but only 3.9 TFLOP/s of MUFU exponentials. With d = 128 there are 512 matmul FLOPs per exp, yet exp throughput is ~256× lower, so exp costs up to ~50% of matmul time unless overlapped.</p>' +
          '<ul><li><b>Warp specialisation</b>: a producer warpgroup issues <b>TMA</b> bulk copies HBM→SMEM (hardware address generation, mbarrier completion); consumers issue <b>WGMMA</b> (asynchronous warpgroup MMA reading operands from SMEM). <code>setmaxnreg</code> moves registers from producers to consumers.</li>' +
          '<li><b>Ping-pong</b>: named barriers force WG1’s softmax to overlap WG2’s GEMMs and vice versa. <b>Intra-warpgroup pipelining</b> overlaps softmax of block j with QKᵀ of block j+1.</li>' +
          '<li><b>FP8</b>: block quantisation (one scale per tile) plus <b>incoherent processing</b>: Q′ = QM, K′ = KM with M = D·H/√d (random ±1 diagonal times Hadamard), so Q′K′ᵀ = QKᵀ while outliers are spread across dimensions; 2.6× lower RMSE than baseline FP8 attention. V is transposed in-kernel to meet FP8 WGMMA k-major layout.</li></ul>' +
          '<p>Result: up to ~740 TFLOP/s BF16 (≈75% of peak), close to 1.2 PFLOP/s FP8, 1.5–2× over FA2 on H100.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('FA3 ≈ 740 TFLOP/s BF16 · ≈ 1.2 PFLOP/s FP8');
          var g = clearAll(ctx, S);
          var G = card(ctx, g, 60, 176, 960, 340, 'amber', 'WARP-SPECIALISED PING-PONG PIPELINE (one CTA, time →)');
          var rowsY = [228, 290, 352, 432];
          ['producer · TMA', 'consumer WG1', 'consumer WG2', 'tensor cores'].forEach(function (s, i) {
            ctx.text(214, rowsY[i] + 14, s, { size: 13, font: 'mono', color: i === 3 ? 'amber' : 'text', anchor: 'end', parent: G });
            ctx.line(224, rowsY[i] + 32, 1000, rowsY[i] + 32, { color: ctx.alpha('white', 0.06), parent: G });
          });
          var X0 = 230, T = 180, blocks = [];
          function blk(row, x, w, col, lab) {
            var r = ctx.rect(x, rowsY[row], w, 28, { rx: 4, fill: ctx.alpha(col, 0.45), stroke: col, sw: 1, parent: G });
            var t = w > 30 ? ctx.text(x + w / 2, rowsY[row] + 14.5, lab, { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: G }) : null;
            blocks.push({ x: x, els: t ? [r, t] : [r] });
          }
          /* producer streams K_j, V_j; WG1 does QK^T | softmax | PV; WG2 is shifted by half a period */
          for (var j2 = 0; j2 < 4; j2++) {
            var b0 = X0 + 30 + j2 * T;
            blk(0, X0 + j2 * T, 56, 'cyan', 'K' + j2);
            blk(0, X0 + j2 * T + 60, 56, 'violet', 'V' + j2);
            /* each warpgroup alternates [PV_(j-1) + QK^T_j] on tensor cores with softmax_j on the MUFU */
            [[1, b0, 'amber'], [2, b0 + 90, 'lime']].forEach(function (c) {
              var x = c[1];
              if (x + 88 > 1004) return;
              blk(c[0], x, 43, 'violet', 'PV');
              blk(c[0], x + 45, 43, 'amber', 'QKᵀ');
              blk(3, x, 88, c[2], c[0] === 1 ? 'WG1' : 'WG2');
              if (x + 176 <= 1004) blk(c[0], x + 90, 86, 'magenta', 'softmax');
            });
          }
          ctx.text(600, 494, 'tensor cores alternate WG1 / WG2 GEMMs while the other warpgroup runs exp() on the MUFU',{ size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          blocks.forEach(function (b) { b.els.forEach(function (e) { e.setAttribute('opacity', 0); }); });
          S.cursor = ctx.line(X0, 214, X0, 470, { color: 'white', sw: 1.5, dash: '3 3', parent: G });
          ctx.reveal(G, { from: 'left' });

          var H = textCard(ctx, 1050, 176, 490, 340, 'cyan', 'HOPPER FEATURES USED', [
            'TMA   async bulk tensor copy',
            '      HBM → SMEM, mbarrier sync',
            'WGMMA async 4-warp MMA from SMEM',
            'setmaxnreg: producers donate regs',
            'ping-pong via named barriers',
            'exp: 3.9 TFLOP/s MUFU vs 989 MMA'
          ], { size: 13, lh: 40, top: 62, parent: g });
          ctx.reveal(H, { from: 'right', delay: 200 });

          /* incoherent processing */
          var I = card(ctx, g, 60, 540, 720, 320, 'magenta', 'FP8 · INCOHERENT PROCESSING  x′ = x·D·H/√d');
          var xr = ctx.rng(31);
          var x = []; for (var k = 0; k < 16; k++) x.push((xr() - 0.5) * 1.0);
          x[5] = 8.0;
          var sg = []; for (var k2 = 0; k2 < 16; k2++) sg.push(xr() < 0.5 ? -1 : 1);
          function had(v) {
            var a = v.slice();
            for (var len = 1; len < 16; len *= 2) for (var i = 0; i < 16; i += 2 * len) for (var q = i; q < i + len; q++) { var u = a[q], w = a[q + len]; a[q] = u + w; a[q + len] = u - w; }
            return a.map(function (z) { return z / 4; });
          }
          var y = had(x.map(function (v, i) { return v * sg[i]; }));
          var ymax = Math.max.apply(null, y.map(Math.abs));
          function barsAt(x0, vals, col, label) {
            ctx.text(x0, 590, label, { size: 12, font: 'mono', color: col, parent: I });
            ctx.line(x0, 720, x0 + 310, 720, { color: ctx.alpha('white', 0.25), parent: I });
            return vals.map(function (v, i) {
              var h = Math.abs(v) * 14;
              return ctx.rect(x0 + i * 19.5, v >= 0 ? 720 - h : 720, 15, h, { rx: 2, fill: ctx.alpha(col, 0.55), stroke: col, sw: 0.8, parent: I });
            });
          }
          S.before = barsAt(90, x, 'red', 'before: one outlier channel (max |x| = 8.0)');
          S.after = barsAt(440, y, 'lime', 'after: spread (max |x| = ' + ymax.toFixed(1) + ')');
          ctx.para(90, 806, ['M = D·H/√d is orthogonal, so (QM)(KM)ᵀ = QKᵀ exactly;', 'per-tile FP8 scales now fit → 2.6× lower RMSE than baseline FP8'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: I });
          S.after.forEach(function (b) { b.setAttribute('opacity', 0); });
          ctx.reveal(I, { from: 'up', delay: 300 });

          var R = card(ctx, g, 810, 540, 730, 320, 'lime', 'THROUGHPUT ON H100 SXM5 (TFLOP/s)');
          var tp = [['BF16 dense peak', 989, 'dim'], ['FA3 BF16 forward', 740, 'amber'], ['FP8 dense peak', 1979, 'dim'], ['FA3 FP8 forward', 1200, 'lime']];
          S.tp = tp.map(function (r, i) {
            var yy = 590 + i * 60;
            ctx.text(1010, yy + 14, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: R });
            var b = ctx.rect(1024, yy, 0, 28, { rx: 4, fill: ctx.alpha(r[2], 0.5), stroke: r[2], sw: 1, parent: R });
            var t = ctx.text(1032, yy + 14, (r[1] === 1200 ? '≈ ' : '') + r[1].toLocaleString('en-US'), { size: 12, font: 'mono', color: 'white', parent: R });
            return { b: b, t: t, w: r[1] / 2000 * 470 };
          });
          ctx.reveal(R, { from: 'up', delay: 450 });

          function grow(t) { S.tp.forEach(function (e) { e.b.setAttribute('width', e.w * t); e.t.setAttribute('x', 1032 + e.w * t); }); }
          function endState() {
            blocks.forEach(function (b) { b.els.forEach(function (e) { e.setAttribute('opacity', 1); }); });
            S.cursor.setAttribute('opacity', 0);
            S.before.forEach(function (b) { b.setAttribute('opacity', 0.4); });
            S.after.forEach(function (b) { b.setAttribute('opacity', 1); });
            grow(1);
          }
          if (ctx.instant) { endState(); return Promise.resolve(); }
          grow(0);
          return ctx.wait(600).then(function () {
            return ctx.tween(3200, function (t) {
              var cx = X0 + t * (1000 - X0);
              S.cursor.setAttribute('x1', cx); S.cursor.setAttribute('x2', cx);
              blocks.forEach(function (b) { if (b.x <= cx) b.els.forEach(function (e) { e.setAttribute('opacity', 1); }); });
            }, 'linear');
          }).then(function () {
            S.cursor.setAttribute('opacity', 0);
            return ctx.tween(900, function (t) {
              S.before.forEach(function (b) { b.setAttribute('opacity', 1 - 0.6 * t); });
              S.after.forEach(function (b) { b.setAttribute('opacity', t); });
            }, 'inOut');
          }).then(function () {
            return ctx.tween(1000, grow, 'out');
          }).then(function () { endState(); });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Blackwell & decoding',
        say: 'Two more chapters. Decoding has the opposite problem: one query per sequence, so there are too few thread blocks to fill the GPU. Flash Decoding splits the long key value cache into chunks, processes them on many processors in parallel, and merges the partial results with exactly the same max and sum algebra. And on Blackwell, FlashAttention four keeps accumulators in the new tensor memory, emulates some exponentials with polynomials, and skips rescaling when the maximum barely moves. Same math, re-derived for every new memory hierarchy.',
        deep: '<p><b>Flash-Decoding</b>: decode has 1 query row per sequence, so there is no Q-block dimension to parallelise; with batch 1 and 8 KV heads (GQA query groups packed into one CTA, as FA3/FlashInfer do) only 8 CTAs exist for 132 SMs. Split the KV cache into s chunks; each CTA returns (õ<sub>s</sub>, m<sub>s</sub>, ℓ<sub>s</sub>), then a small reduction kernel merges them:</p>' +
          '<div class="eq">m = max<sub>s</sub> m<sub>s</sub>, &nbsp; ℓ = Σ<sub>s</sub> e<sup>m<sub>s</sub>−m</sup> ℓ<sub>s</sub>, &nbsp; o = Σ<sub>s</sub> e<sup>m<sub>s</sub>−m</sup> ℓ<sub>s</sub> õ<sub>s</sub> / ℓ</div>' +
          '<p>Reported up to 8× faster decoding at very long sequence lengths. FlashInfer and FlashMLA generalise this for paged, variable-length and MLA caches.</p>' +
          '<p><b>Blackwell (B200/GB200)</b>: 5th-gen tensor cores (<code>tcgen05.mma</code>) write accumulators to <b>Tensor Memory</b> (TMEM, 256 KB per SM) instead of registers, and pairs of CTAs can cooperate on one MMA. FlashAttention-4 (CuTe-DSL) exploits this with deeper async pipelines, <b>software exp2</b> via polynomial approximation on FMA units to relieve the MUFU, and <b>lazy rescaling</b>: O is rescaled only when the running max rises past a threshold, since the final division by ℓ is exact either way. Reported up to 1,613 TFLOP/s BF16 forward on B200 (≈71% of the ~2.25 PFLOP/s dense peak), ~1.3× over cuDNN 9.13; the backward pass uses TMEM and 2-CTA MMA to cut shared-memory traffic and atomics.</p>' +
          '<p class="muted">For video DiTs, 8-bit variants (SageAttention) and block-sparse spatiotemporal attention build on the same tiled kernel.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('Flash-Decoding: split KV, merge by log-sum-exp');
          var g = clearAll(ctx, S);
          var D = card(ctx, g, 60, 176, 870, 380, 'violet', 'FLASH-DECODING · 1 query vs a 128k-token KV cache');
          S.q = ctx.label(120, 286, 'q', { color: 'amber', size: 14, w: 50 });
          D.appendChild(S.q);
          ctx.rect(200, 270, 700, 32, { rx: 5, fill: ctx.alpha('violet', 0.1), stroke: ctx.alpha('violet', 0.6), sw: 1, parent: D });
          ctx.text(550, 254, 'KV cache · 131,072 tokens', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: D });
          S.chunks = []; S.sms = []; S.down = [];
          for (var c = 0; c < 8; c++) {
            var cx = 200 + c * 87.5;
            S.chunks.push(ctx.rect(cx + 2, 272, 83.5, 28, { rx: 3, fill: ctx.alpha('violet', 0.15), parent: D }));
            if (c) ctx.line(cx, 270, cx, 302, { color: ctx.alpha('violet', 0.6), parent: D });
            var sm = ctx.node({ x: cx + 43.75, y: 372, w: 70, h: 40, title: 'SM ' + c, color: 'cyan', kind: 'chip', titleSize: 12, glow: false, parent: D });
            S.sms.push(sm);
            ctx.line(cx + 43.75, 304, cx + 43.75, 346, { color: ctx.alpha('violet', 0.5), sw: 1.2, arrow: true, parent: D });
            S.down.push(ctx.path('M' + (cx + 43.75) + ',398 C' + (cx + 43.75) + ',450 550,440 550,468', { stroke: ctx.alpha('cyan', 0.45), sw: 1.2, parent: D }));
          }
          ctx.line(145, 286, 196, 286, { color: 'amber', sw: 1.5, arrow: true, parent: D });
          S.red = ctx.node({ x: 550, y: 492, w: 300, h: 44, title: 'reduce: (õ_s, m_s, ℓ_s) → o', color: 'magenta', kind: 'pill', titleSize: 14, glow: false, parent: D });
          S.walker = ctx.rect(200, 268, 20, 36, { rx: 3, fill: ctx.alpha('amber', 0.7), parent: D });
          S.walker.setAttribute('opacity', 0);
          S.dNote = ctx.text(80, 546, '', { size: 12, font: 'mono', color: 'dim', parent: D });
          ctx.reveal(D, { from: 'left' });

          var E = textCard(ctx, 960, 176, 580, 380, 'magenta', 'MERGING PARTIAL SOFTMAXES', [
            'each chunk s returns õ_s, m_s, ℓ_s',
            'm = max_s m_s',
            'ℓ = Σ_s e^(m_s − m) · ℓ_s',
            'o = Σ_s e^(m_s − m) · ℓ_s · õ_s / ℓ',
            '',
            'the online-softmax algebra again,',
            'now across SMs instead of loop steps',
            'reported up to 8× faster long decode'
          ], { size: 14, lh: 36, top: 64, parent: g });
          ctx.reveal(E, { from: 'right', delay: 200 });

          var B = textCard(ctx, 60, 580, 870, 280, 'lime', 'BLACKWELL ERA · FlashAttention-4 (B200 / GB200)', [
            'tcgen05 MMA: accumulators in Tensor Memory (256 KB/SM)',
            '2-CTA MMA pairs share operands; deeper async pipelines',
            'exp2 partly emulated with polynomials on FMA units',
            'lazy rescale: touch O only when the max jumps a lot',
            'CuTe-DSL kernels; 1,613 TFLOP/s BF16 on B200 (~71%)'
          ], { size: 14, lh: 40, top: 64, parent: g });
          ctx.reveal(B, { from: 'up', delay: 350 });

          var T = card(ctx, g, 960, 580, 580, 280, 'amber', 'LINEAGE: SAME MATH, NEW HIERARCHY');
          var ev = [['2022', 'FA1', 'tiling +', 'online softmax'], ['2023', 'FA2', 'work', 'partitioning'], ['2023', 'Flash-', 'Decoding', 'split-KV'], ['2024', 'FA3', 'Hopper async', '+ FP8'], ['2025+', 'FA4', 'Blackwell', 'TMEM']];
          ctx.line(1000, 690, 1500, 690, { color: ctx.alpha('amber', 0.5), sw: 2, parent: T });
          S.ev = ev.map(function (e, i) {
            var x = 1010 + i * 120, eg = ctx.group({ parent: T });
            ctx.text(x, 640, e[0], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: eg });
            ctx.text(x, 662, e[1], { size: 14, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: eg });
            ctx.circle(x, 690, 7, { fill: 'amber', parent: eg, glow: true });
            ctx.text(x, 720, e[2], { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: eg });
            ctx.text(x, 738, e[3], { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: eg });
            return eg;
          });
          ctx.text(1250, 800, 'exact attention, re-tiled for every memory level', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: T });
          ctx.text(1250, 826, 'and every new asynchronous instruction', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: T });
          ctx.reveal(T, { from: 'up', delay: 500 });
          ctx.reveal(S.ev, { from: 'up', delay: 800, stagger: 150 });

          function endState() {
            S.walker.setAttribute('opacity', 0);
            S.chunks.forEach(function (c) { c.setAttribute('fill', ctx.alpha('violet', 0.55)); });
            S.dNote.textContent = 'split-KV: all 8 chunks in parallel, then one cheap reduction';
          }
          if (ctx.instant) { endState(); return Promise.resolve(); }
          S.dNote.textContent = 'no split: batch 1 × 8 KV heads = 8 CTAs; one CTA walks the whole cache';
          S.walker.setAttribute('opacity', 1);
          return ctx.wait(700).then(function () {
            return ctx.tween(2000, function (t) { S.walker.setAttribute('x', 200 + t * 680); }, 'linear');
          }).then(function () {
            S.walker.setAttribute('opacity', 0);
            S.dNote.textContent = 'split-KV: 8 chunks run concurrently on 8 SMs (per head) ...';
            S.chunks.forEach(function (c) { c.setAttribute('fill', ctx.alpha('violet', 0.55)); });
            S.sms.forEach(function (s) { ctx.pulse(s, { color: 'cyan', dur: 500 }); });
            return ctx.wait(600);
          }).then(function () {
            return Promise.all(S.down.map(function (p) { return ctx.packet(p, { color: 'cyan', dur: 700, r: 4 }); }));
          }).then(function () {
            endState();
            return ctx.pulse(S.red, { color: 'magenta', dur: 700 });
          });
        }
      }
    ]
  });
})();
