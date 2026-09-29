/* L2 — Spatiotemporal VAE. Why latents, causal 3D conv encoders, chunked caches, tiling, losses and the compression trade-off. */
(function () {
  /* pseudo-3D tensor block. o: cx, cy, w, h, d, color, parent, mosaic fn(r,c,n)->css color, n */
  function cube(ctx, o) {
    var g = ctx.group({ parent: o.parent });
    var d = o.d, col = o.color;
    var x0 = o.cx - (o.w + d) / 2, y0 = o.cy - (o.h - d) / 2;
    ctx.poly([[x0, y0], [x0 + d, y0 - d], [x0 + o.w + d, y0 - d], [x0 + o.w, y0]], { fill: ctx.alpha(col, 0.28), stroke: col, sw: 1.2, parent: g });
    ctx.poly([[x0 + o.w, y0], [x0 + o.w + d, y0 - d], [x0 + o.w + d, y0 + o.h - d], [x0 + o.w, y0 + o.h]], { fill: ctx.alpha(col, 0.16), stroke: col, sw: 1.2, parent: g });
    ctx.rect(x0, y0, o.w, o.h, { rx: 2, fill: ctx.alpha(col, 0.12), stroke: col, sw: 1.4, parent: g });
    if (o.mosaic) {
      var n = o.n || 5, cw = (o.w - 6) / n, ch = (o.h - 6) / n;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) ctx.rect(x0 + 3 + j * cw, y0 + 3 + i * ch, cw - 0.6, ch - 0.6, { rx: 0, fill: o.mosaic(i, j, n), parent: g });
    }
    g.box = { x: x0, y: y0 - d, w: o.w + d, h: o.h + d, cx: o.cx, cy: o.cy, l: x0, r: x0 + o.w + d, t: y0 - d, b: y0 + o.h };
    g.color = ctx.color(col);
    return g;
  }
  function miniFrame(ctx, parent, x, y, w, h, k) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 2, fill: '#081026', stroke: ctx.alpha('lime', 0.55), sw: 1, parent: g });
    ctx.circle(x + w * 0.76, y + h * 0.3, h * 0.17, { fill: '#d2f3ff', parent: g, opacity: 0.95 });
    ctx.rect(x + 0.5, y + h * 0.76, w - 1, h * 0.24 - 0.5, { rx: 0, fill: ctx.alpha('cyan', 0.35), parent: g });
    ctx.circle(x + w * (0.14 + 0.36 * k), y + h * 0.62, h * 0.13, { fill: '#ff8a3d', stroke: '#e8f1ff', sw: 1, parent: g });
    return g;
  }
  function newBench(ctx, S, title) {
    if (S.wb) ctx.remove(S.wb, 350);
    S.wb = ctx.group();
    if (S.wbTitle) S.wbTitle.textContent = title;
    return S.wb;
  }
  function latentMosaic(seed, ctx) {
    var r = ctx.rng(seed);
    return function () { var k = 50 + 150 * r(); return 'rgb(' + Math.round(k * 0.7) + ',' + Math.round(k) + ',' + Math.round(k * 0.8) + ')'; };
  }
  function logBar(v, lo, hi, W) { return W * (Math.log(v) / Math.LN10 - lo) / (hi - lo); }

  Atlas.register({
    id: 'video-vae',
    refs: [
      'Kingma &amp; Welling, <i>Auto-Encoding Variational Bayes</i>, ICLR 2014',
      'Esser, Rombach &amp; Ommer, <i>Taming Transformers for High-Resolution Image Synthesis (VQGAN)</i>, CVPR 2021; Rombach et al., <i>Latent Diffusion Models</i>, CVPR 2022',
      'Zhang et al., <i>The Unreasonable Effectiveness of Deep Features as a Perceptual Metric (LPIPS)</i>, CVPR 2018',
      'Yu et al., <i>Language Model Beats Diffusion — Tokenizer is Key to Visual Generation (MAGVIT-v2)</i>, ICLR 2024',
      'Yang et al., <i>CogVideoX</i>, 2024; Kong et al., <i>HunyuanVideo</i>, 2024 (3D causal VAEs)',
      'Wan Team, <i>Wan: Open and Advanced Large-Scale Video Generative Models</i> (Wan-VAE; Wan 2.2 high-compression VAE), 2025',
      'HaCohen et al., <i>LTX-Video: Realtime Video Latent Diffusion</i>, 2025',
      'Yao et al., <i>Reconstruction vs. Generation: Taming Optimization Dilemma in Latent Diffusion Models (VA-VAE)</i>, CVPR 2025; Chen et al., <i>Deep Compression Autoencoder (DC-AE)</i>, ICLR 2025'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Why a latent space',
        say: 'Our five second shot, as raw pixels, is one hundred and twenty one frames of seven twenty by twelve eighty by three colour channels: about three hundred thirty four million numbers, for a single activation. A transformer cannot attend over that. But most of those numbers encode detail our eyes barely notice, and neighbouring frames are almost identical. The video VAE removes that redundancy once, up front, so the diffusion model can spend its capacity on meaning and motion.',
        deep: '<p>Raw clip: <code>121 × 720 × 1280 × 3 = 334,540,800</code> values (669 MB in bf16) — and a network holds dozens of activations of at least that size.</p>' +
          '<table><tr><th>Operate on</th><th>Tokens (2×2 patch after VAE, or 16×16 pixel patch)</th><th>Pairs N²</th></tr>' +
          '<tr><td>pixels, 16×16 patches per frame</td><td>121·45·80 = 435,600 (768 values each)</td><td>1.9×10¹¹</td></tr>' +
          '<tr><td>latent 4×8×8, 16 ch</td><td>31·45·80 = 111,600 (64 values each)</td><td>1.25×10¹⁰</td></tr></table>' +
          '<p>Rombach et al. split lossy compression into two regimes on the rate–distortion curve: <b>perceptual compression</b> (high rate: remove imperceptible high-frequency detail — the autoencoder’s job) and <b>semantic compression</b> (low rate: what the generative model learns). Training the diffusion model only in the second regime is what made latent diffusion affordable.</p>' +
          '<div class="note">The VAE is trained once, frozen, and then shared by training and inference of the DiT. Its compression factor sets the token budget — and therefore the O(N²) attention bill — of everything downstream.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.stack = ctx.group();
          for (var i = 7; i >= 0; i--) miniFrame(ctx, S.stack, 90 + i * 14, 290 - i * 10, 300, 170, i / 7);
          S.stackLab = ctx.group({ parent: S.stack });
          ctx.line(90, 478, 390, 478, { color: 'dim', sw: 1, parent: S.stackLab });
          ctx.text(240, 494, '1280 px', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.stackLab });
          ctx.line(78, 290, 78, 460, { color: 'dim', sw: 1, parent: S.stackLab });
          ctx.text(70, 375, '720', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.stackLab });
          ctx.line(395, 285, 495, 215, { color: 'dim', sw: 1, dash: '3 4', parent: S.stackLab });
          ctx.text(500, 208, '121 frames', { size: 12, font: 'mono', color: 'dim', parent: S.stackLab });
          S.stack.box = { x: 90, y: 220, w: 418, h: 250, cx: 299, cy: 345, l: 90, r: 508, t: 220, b: 470 };
          ctx.reveal(S.stack, { from: 'left' });
          S.g1 = ctx.group();
          ctx.text(90, 540, '121 × 720 × 1280 × 3', { size: 15, font: 'mono', color: 'text', parent: S.g1 });
          S.cnt1 = ctx.text(90, 574, '0', { size: 28, font: 'mono', weight: 700, color: 'white', parent: S.g1 });
          ctx.text(90, 606, 'values · 669 MB in bf16, for one activation', { size: 13, font: 'mono', color: 'dim', parent: S.g1 });
          /* right: token budgets */
          ctx.text(620, 210, 'WHAT A TRANSFORMER WOULD HAVE TO ATTEND OVER', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: S.g1 });
          var rows = [['pixels · 16×16 patches', 435600, 'red', '435,600 tokens × 768 values', 'N² = 1.9×10¹¹'], ['latent 4×8×8 · 2×2 patches', 111600, 'lime', '111,600 tokens × 64 values', 'N² = 1.25×10¹⁰  (15× fewer)']];
          S.tb = rows.map(function (r, i) {
            var y = 250 + i * 96;
            ctx.text(620, y, r[0], { size: 15, font: 'mono', weight: 600, color: r[2], parent: S.g1 });
            var b = ctx.rect(620, y + 16, 880 * r[1] / 435600, 26, { rx: 4, fill: ctx.alpha(r[2], 0.4), stroke: r[2], sw: 1, parent: S.g1 });
            ctx.text(620, y + 62, r[3] + '   ·   ' + r[4], { size: 13, font: 'mono', color: 'text', parent: S.g1 });
            return b;
          });
          ctx.text(620, 470, 'and 7.14 M latent values instead of 334.5 M pixels: 46.8× smaller', { size: 14, font: 'mono', color: 'lime', parent: S.g1 });
          /* rate-distortion schematic */
          ctx.text(620, 540, 'RATE–DISTORTION (schematic, after Rombach et al. 2022)', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 1, parent: S.g1 });
          var PL = { x: 650, y: 570, w: 520, h: 250 };
          ctx.rect(PL.x + PL.w * 0.3, PL.y, PL.w * 0.7, PL.h, { rx: 0, fill: ctx.alpha('lime', 0.06), parent: S.g1 });
          ctx.rect(PL.x, PL.y, PL.w * 0.3, PL.h, { rx: 0, fill: ctx.alpha('violet', 0.08), parent: S.g1 });
          S.rd = ctx.plot(PL.x, PL.y, PL.w, PL.h, function (x) { return 0.92 * Math.exp(-9 * x) + 0.06; }, { color: 'white', sw: 2.2, xLabel: 'rate (bits / pixel) →', yLabel: 'distortion', parent: S.g1 });
          ctx.para(PL.x + PL.w * 0.3 + 14, PL.y + 50, ['perceptual compression', 'drop invisible detail', '→ the VAE'], { size: 13, font: 'mono', color: 'lime', lh: 20, parent: S.g1 });
          ctx.para(PL.x + 40, PL.y + 22, ['semantic', 'compression', '→ the DiT'], { size: 13, font: 'mono', color: 'violet', lh: 20, parent: S.g1 });
          ctx.para(1210, 600, [
            'Most bits of a frame are',
            'high-frequency texture that',
            'costs rate but barely moves',
            'distortion. Frames 1/24 s',
            'apart are nearly identical.',
            '',
            'Compress that away once,',
            'then generate in the small',
            'space that is left.'
          ], { size: 13, font: 'mono', color: 'text', lh: 22, parent: S.g1 });
          ctx.reveal(S.g1, { delay: 300 });
          ctx.reveal(S.rd.curve, { from: 'draw', delay: 900, dur: 1200 });
          S.tb.forEach(function (b, i) {
            var w = parseFloat(b.getAttribute('width'));
            b.setAttribute('width', 0);
            ctx.animate(b, { width: [0, w] }, 900, 'out', 700 + i * 400);
          });
          ctx.hud('raw clip = 334.5 M values');
          return ctx.counter(S.cnt1, 0, 334540800, 1600).then(function () { return ctx.wait(1200); });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'The encoder',
        say: 'Here is the encoder, a stack of three dimensional convolutions. Three downsampling stages each halve height and width, and the last two of them also halve time. Channels grow from ninety six to three hundred eighty four while the grid shrinks. A final head predicts a mean and a variance for sixteen latent channels, and one sample gives the latent: thirty one by ninety by one hundred sixty. Notice that the largest tensors are not the input. They are the first full resolution feature maps.',
        deep: '<p>Wan-VAE-style encoder (base width 96, multipliers 1-2-4-4, ~127 M params in total with the decoder):</p>' +
          '<table><tr><th>Stage</th><th>C × T × H × W</th><th>Values</th></tr>' +
          '<tr><td>input</td><td>3 × 121 × 720 × 1280</td><td>0.33 G</td></tr>' +
          '<tr><td>stage 0 (res blocks)</td><td>96 × 121 × 720 × 1280</td><td><b>10.7 G</b></td></tr>' +
          '<tr><td>↓2 hw → stage 1</td><td>192 × 121 × 360 × 640</td><td>5.35 G</td></tr>' +
          '<tr><td>↓2 thw → stage 2</td><td>384 × 61 × 180 × 320</td><td>1.35 G</td></tr>' +
          '<tr><td>↓2 thw → stage 3 + mid (attn)</td><td>384 × 31 × 90 × 160</td><td>171 M</td></tr>' +
          '<tr><td>head → (μ, log σ²)</td><td>32 × 31 × 90 × 160</td><td>14.3 M</td></tr>' +
          '<tr><td>z = μ + σ·ε</td><td>16 × 31 × 90 × 160</td><td>7.14 M</td></tr></table>' +
          '<p>Causal temporal downsampling keeps the first frame separate: T → 1 + (T − 1)/2, so 121 → 61 → 31. Compression 4×8×8 in space-time, 3 → 16 channels.</p>' +
          '<p>Sampling z = μ + σ·ε is used in training; at inference most pipelines take z = μ (σ is tiny anyway because of the weak KL term). Latents are then normalised per channel before they reach the DiT.</p>' +
          '<div class="note">Stage-0 activations alone are 10.7 G values = 21.4 GB in bf16 — per tensor, and a res block holds several. Encoding a whole 720p clip in one pass is impractical even on an 80 GB GPU; hence chunking (two steps ahead).</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.g1, 400);
          ctx.remove(S.stackLab, 300);
          ctx.transform(S.stack, { x: 12, y: 245, s: 0.42 }, 1000, 'inOut');
          ctx.hud('');
          S.pipe = ctx.group();
          var cy = 390;
          var st = [
            { cx: 350, w: 150, h: 84, d: 22, col: 'lime', shape: '96×121×720×1280', val: 10.7e9, lab: 'stage 0' },
            { cx: 545, w: 104, h: 58, d: 32, col: 'lime', shape: '192×121×360×640', val: 5.35e9, lab: 'stage 1' },
            { cx: 718, w: 72, h: 40, d: 44, col: 'lime', shape: '384×61×180×320', val: 1.35e9, lab: 'stage 2' },
            { cx: 872, w: 50, h: 28, d: 44, col: 'lime', shape: '384×31×90×160', val: 1.71e8, lab: 'stage 3 + attn' },
            { cx: 1020, w: 50, h: 28, d: 12, col: 'amber', shape: '32×31×90×160', val: 1.43e7, lab: 'μ, log σ²' },
            { cx: 1200, w: 56, h: 32, d: 10, col: 'lime', shape: '16×31×90×160', val: 7.14e6, lab: 'z' }
          ];
          S.cubes = st.map(function (s, i) {
            var g = ctx.group({ parent: S.pipe });
            cube(ctx, { cx: s.cx, cy: cy, w: s.w, h: s.h, d: s.d, color: s.col, parent: g, n: i === 5 ? 5 : 0, mosaic: i === 5 ? latentMosaic(3, ctx) : null });
            ctx.text(s.cx, 300, s.lab, { size: 12, font: 'mono', weight: 600, color: s.col, anchor: 'middle', parent: g });
            ctx.text(s.cx, 482, s.shape, { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: g });
            g.valEl = ctx.text(s.cx, 502, '', { size: 12, font: 'mono', weight: 600, color: s.col, anchor: 'middle', parent: g });
            g.s = s;
            return g;
          });
          ctx.text(118, 300, 'input', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', parent: S.pipe });
          ctx.text(138, 482, '3×121×720×1280', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: S.pipe });
          ctx.text(138, 502, '334.5 M', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', parent: S.pipe });
          var arrows = [[229, 260, 'conv'], [440, 473, '↓hw'], [617, 656, '↓thw'], [780, 821, '↓thw'], [923, 985, 'head'], [1055, 1163, 'sample']];
          S.arr = arrows.map(function (a) {
            var g = ctx.group({ parent: S.pipe });
            ctx.line(a[0], cy + 12, a[1], cy + 12, { color: 'dim', sw: 1.5, arrow: true, parent: g });
            ctx.text((a[0] + a[1]) / 2, cy + 30, a[2], { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
            return g;
          });
          ctx.text(1110, 356, 'z = μ + σ·ε', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: S.pipe });
          S.zNote = ctx.group({ parent: S.pipe });
          ctx.rect(1290, 330, 250, 124, { rx: 10, fill: ctx.alpha('lime', 0.07), stroke: ctx.alpha('lime', 0.6), parent: S.zNote });
          ctx.para(1306, 356, ['latent z', '16 × 31 × 90 × 160', '= 7.14 M values', '4×8×8 (t·h·w), 3 → 16 ch'], { size: 13, font: 'mono', color: 'lime', lh: 23, parent: S.zNote });
          S.cubes.forEach(function (c) { c.setAttribute('opacity', 0); });
          S.arr.forEach(function (a) { a.setAttribute('opacity', 0); });
          S.zNote.setAttribute('opacity', 0);
          /* divider + workbench */
          S.div = ctx.group();
          ctx.line(40, 548, 1560, 548, { color: 'line', sw: 1, parent: S.div });
          ctx.text(60, 568, 'CLOSE-UP ▸', { size: 12, font: 'mono', weight: 600, color: 'lime', spacing: 2, parent: S.div });
          S.wbTitle = ctx.text(170, 568, '', { size: 12, font: 'mono', color: 'dim', parent: S.div });
          ctx.reveal(S.div, { delay: 400 });
          var wb = newBench(ctx, S, 'values per stage (log scale): the peak is at full resolution');
          var rows = [['input', 3.345e8, 'dim'], ['stage 0', 10.7e9, 'red'], ['stage 1', 5.35e9, 'amber'], ['stage 2', 1.35e9, 'lime'], ['stage 3', 1.71e8, 'lime'], ['z', 7.14e6, 'lime']];
          S.vb = rows.map(function (r, i) {
            var y = 588 + i * 42;
            ctx.text(240, y + 13, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: wb });
            var b = ctx.rect(254, y, logBar(r[1], 6, 10.2, 640), 26, { rx: 4, fill: ctx.alpha(r[2], 0.4), stroke: r[2], sw: 1, parent: wb });
            var gb = r[1] * 2 / 1e9;
            ctx.text(254 + logBar(r[1], 6, 10.2, 640) + 10, y + 13, (r[1] >= 1e9 ? (r[1] / 1e9).toFixed(2) + ' G' : (r[1] / 1e6).toFixed(1) + ' M') + '  ·  ' + (gb >= 1 ? gb.toFixed(1) + ' GB' : (gb * 1000).toFixed(0) + ' MB') + ' bf16', { size: 12, font: 'mono', color: r[2], parent: wb });
            return b;
          });
          ctx.para(1100, 600, [
            'channels grow as the grid shrinks,',
            'so compute per stage stays balanced,',
            'but memory peaks at stage 0:',
            '96 × 121 × 720 × 1280 = 10.7 G values',
            '= 21.4 GB for ONE bf16 tensor.',
            '',
            'no GPU holds a dozen of those →',
            'encode causally, chunk by chunk.'
          ], { size: 13, font: 'mono', color: 'text', lh: 24, parent: wb });
          ctx.reveal(wb, { delay: 600 });
          S.vb.forEach(function (b, i) {
            var w = parseFloat(b.getAttribute('width'));
            b.setAttribute('width', 0);
            ctx.animate(b, { width: [0, w] }, 700, 'out', 1600 + i * 150);
          });
          ctx.hud('334.5 M pixels → 7.14 M latents (÷46.8)');
          var chain = ctx.wait(900);
          S.cubes.forEach(function (c, i) {
            chain = chain.then(function () {
              ctx.reveal(S.arr[i], { dur: 250 });
              ctx.reveal(c, { from: 'scale', s0: 0.5, dur: 450 });
              return ctx.counter(c.valEl, 0, c.s.val, 420, function (v) { return v >= 1e9 ? (v / 1e9).toFixed(2) + ' G' : (v / 1e6).toFixed(v >= 1e8 ? 0 : 2) + ' M'; });
            });
          });
          return chain.then(function () { return ctx.reveal(S.zNote, { from: 'right' }); }).then(function () {
            return ctx.pulse(S.cubes[5], { color: 'lime', dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Causal 3D convolution',
        say: 'Zoom into one convolution along the time axis. The kernel spans three frames, but instead of padding one frame on each side, a causal convolution pads two frames at the front and none at the back. So the output at time t only ever sees frames t, t minus one and t minus two, never the future. The first frame is therefore encoded on its own, which makes a still image just a one frame video, and lets one VAE serve images, image to video, and video.',
        deep: '<div class="eq">y<sub>t</sub> = Σ<sub>k=0..2</sub> W<sub>k</sub> ∗<sub>hw</sub> x<sub>t−k</sub>,   x<sub>−1</sub> = x<sub>−2</sub> = 0 (or cached)</div>' +
          '<p>Padding (k<sub>t</sub> − 1, 0) in time instead of symmetric ((k<sub>t</sub>−1)/2, (k<sub>t</sub>−1)/2). Spatial padding stays symmetric. Temporal down-sampling uses stride 2 on frames 1..T−1 while frame 0 passes alone, giving T → 1 + (T − 1)/2.</p>' +
          '<ul><li><b>Images and videos share one latent space</b>: E(image) = first latent frame of E(video starting with that image). Enables joint image-video training (billions of images, far fewer good videos) and I2V conditioning by encoding just frame 0.</li>' +
          '<li><b>Streaming</b>: causality means a chunk can be encoded/decoded given only a small cache of the past — the basis of the next step.</li>' +
          '<li>Lineage: MAGVIT-v2 causal 3D CNN tokenizer → CogVideoX, HunyuanVideo, Wan, Cosmos tokenizers.</li></ul>' +
          '<div class="note">Cost: a 3×3×3 conv from C to C channels costs 2·27·C² FLOPs per output voxel — 0.5 MFLOP at C = 96. Stage 0 has 121 · 720 · 1280 = 111.5 M voxels, so one such conv layer costs ≈ 5.5×10¹³ FLOPs; the whole encoder + decoder lands around 10¹⁵.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'causal temporal padding · kernel k_t = 3');
          ctx.focus([wb], 0.03);
          var X0 = 262, DX = 92, CW = 80, Y0 = 628;
          ctx.text(X0, 604, 'input frames (time →)', { size: 14, font: 'mono', weight: 600, color: 'dim', parent: wb });
          S.inCells = [];
          for (var i = 0; i < 11; i++) {
            var x = X0 + i * DX;
            if (i < 2) {
              ctx.rect(x, Y0, CW, 52, { rx: 4, fill: 'rgba(255,255,255,0.02)', stroke: 'dim', sw: 1.2, dash: '4 4', parent: wb });
              ctx.text(x + CW / 2, Y0 + 26, 'pad 0', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: wb });
            } else {
              miniFrame(ctx, wb, x, Y0, CW, 52, (i - 2) / 8);
              ctx.text(x + CW / 2, Y0 + 66, 'x' + (i - 2), { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: wb });
            }
          }
          S.outCells = [];
          for (var j = 0; j < 9; j++) {
            var ox = X0 + (j + 2) * DX;
            S.outCells.push(ctx.rect(ox, 752, CW, 36, { rx: 4, fill: ctx.alpha('lime', 0.06), stroke: ctx.alpha('lime', 0.4), sw: 1, parent: wb }));
            ctx.text(ox + CW / 2, 770, 'y' + j, { size: 13, font: 'mono', color: 'lime', anchor: 'middle', parent: wb });
          }
          ctx.text(X0, 770, 'output', { size: 13, font: 'mono', color: 'dim', parent: wb });
          S.win = ctx.rect(X0 - 6, Y0 - 8, 2 * DX + CW + 12, 68, { rx: 8, stroke: 'amber', sw: 2.2, parent: wb, glow: true });
          S.kl = [0, 1, 2].map(function () { return ctx.line(0, 0, 0, 0, { color: ctx.alpha('amber', 0.7), sw: 1.4, parent: wb }); });
          S.ghost = ctx.group({ parent: wb });
          ctx.rect(X0 + 5 * DX - 6, Y0 - 14, 2 * DX + CW + 12, 80, { rx: 8, stroke: 'red', sw: 1.6, dash: '6 5', parent: S.ghost });
          ctx.text(X0 + 7 * DX + CW / 2 + 60, Y0 - 24, '✗ symmetric pad: y4 would read x5 (future)', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: S.ghost });
          S.ghost.setAttribute('opacity', 0);
          ctx.text(X0, 830, 'y_t = Σₖ Wₖ ∗ x_(t−k),  k = 0,1,2  →  y0 sees only x0: an image is a 1-frame video', { size: 15, font: 'mono', color: 'white', parent: wb });
          ctx.text(X0, 860, 'temporal stride 2 on x1..x(T−1), x0 alone:  T → 1 + (T − 1)/2   ·   121 → 61 → 31', { size: 13, font: 'mono', color: 'amber', parent: wb });
          function setK(k) {
            var x = X0 + k * DX;
            S.win.setAttribute('x', x - 6);
            S.kl.forEach(function (l, i) {
              l.setAttribute('x1', X0 + (k + i) * DX + CW / 2); l.setAttribute('y1', Y0 + 52);
              l.setAttribute('x2', X0 + (k + 2) * DX + CW / 2); l.setAttribute('y2', 752);
            });
            S.outCells.forEach(function (c, j) { c.setAttribute('fill', j <= k ? ctx.alpha('lime', 0.4) : ctx.alpha('lime', 0.06)); });
          }
          setK(0);
          ctx.hud('output at t sees only frames ≤ t');
          return ctx.camera(762, 700, 1.5, 1100).then(function () {
            return ctx.tween(3600, function (p) { setK(Math.min(8, Math.floor(p * 9))); }, 'linear');
          }).then(function () {
            return ctx.fade(S.ghost, 1, 400);
          }).then(function () { return ctx.wait(1400); }).then(function () {
            return ctx.fade(S.ghost, 0.35, 400);
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Chunks & feature cache',
        say: 'Causality pays off in memory. The encoder processes the clip in chunks: first frame zero alone, then four frames at a time, producing one latent frame per chunk. Each causal convolution keeps a fixed size cache, the last two frames of its input from the previous chunk, so the result is the same as encoding the whole clip at once. Peak memory now depends on the chunk, not on the length of the video.',
        deep: '<pre># cache: last 2 frames per causal conv\ncache = {}\nz = [enc(x[0:1], cache)]        # z0\nfor k in range(1, 31):\n    z.append(enc(x[4k-3:4k+1], cache))\nz = cat(z, dim=t)  # 16×31×90×160</pre>' +
          '<p>Every temporal conv is causal with k<sub>t</sub> = 3, and in Wan-VAE the norms (RMSNorm over channels) and mid-block attention act per frame. Replacing the zero padding by the cached 2 frames therefore makes chunked and full-sequence outputs <b>mathematically identical</b> (differences only from floating-point summation order). VAEs with GroupNorm over time lack this property. The decoder mirrors the scheme: 1 latent frame → 1 frame, then 1 → 4.</p>' +
          '<table><tr><th>Tensor (bf16)</th><th>Size</th></tr>' +
          '<tr><td>whole clip, stage 0, 96 × 121 × 720 × 1280</td><td>21.4 GB</td></tr>' +
          '<tr><td>one 4-frame chunk, stage 0</td><td>0.71 GB</td></tr>' +
          '<tr><td>feature cache: 2 frames × input of every causal conv. Stage 0: 4 convs × 96 ch × 2 × 0.92 M px = 0.71 G values; stages 1–3 + mid ≈ 0.58 G</td><td>≈ 1.3 G values ≈ 2.6 GB, resident but constant</td></tr></table>' +
          '<ul><li>Cost: the chunk loop is sequential in time (no temporal parallelism) — fine for a VAE that is &lt;1% of the FLOPs.</li>' +
          '<li>Non-causal VAEs need overlapping temporal tiles and blending instead, and can show flicker at tile borders.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'chunked causal encoding with a feature cache');
          ctx.camera(null, null, null, 900);
          ctx.focus(null);
          var X0 = 80, FW = 1440 / 121;
          ctx.text(X0, 596, '121 frames → 31 chunks: [x0] [x1..x4] [x5..x8] … [x117..x120]', { size: 13, font: 'mono', color: 'text', parent: wb });
          S.ch = [];
          S.lat = [];
          for (var k = 0; k < 31; k++) {
            var f0 = k === 0 ? 0 : 4 * k - 3, n = k === 0 ? 1 : 4;
            var x = X0 + f0 * FW;
            S.ch.push(ctx.rect(x + 1, 612, n * FW - 2, 34, { rx: 3, fill: ctx.alpha('cyan', 0.08), stroke: ctx.alpha('cyan', 0.5), sw: 1, parent: wb }));
            var lx = x + n * FW / 2 - 8;
            S.lat.push(ctx.rect(lx, 694, 16, 24, { rx: 2, fill: ctx.alpha('lime', 0.08), stroke: ctx.alpha('lime', 0.5), sw: 1, parent: wb }));
          }
          ctx.text(X0, 740, 'latent frames z0 … z30 (one per chunk)', { size: 12, font: 'mono', color: 'lime', parent: wb });
          S.cache = ctx.group({ parent: wb });
          ctx.rect(-36, 656, 52, 24, { rx: 5, fill: ctx.alpha('amber', 0.2), stroke: 'amber', sw: 1.4, parent: S.cache });
          ctx.text(-10, 668, 'cache', { size: 11, font: 'mono', weight: 600, color: 'amber', anchor: 'middle', parent: S.cache });
          ctx.place(S.cache, X0 + FW, 0);
          S.encArrow = ctx.line(0, 648, 0, 690, { color: 'lime', sw: 1.6, arrow: true, parent: wb });
          /* memory bars */
          var mem = [['whole clip · stage-0 tensor', 21.4, 'red'], ['4-frame chunk · stage-0 tensor', 0.71, 'lime'], ['resident feature cache (all convs)', 2.6, 'amber']];
          mem.forEach(function (m, i) {
            var y = 768 + i * 34;
            ctx.text(420, y + 12, m[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: wb });
            var b = ctx.rect(432, y, Math.max(4, 700 * m[1] / 21.4), 24, { rx: 4, fill: ctx.alpha(m[2], 0.4), stroke: m[2], sw: 1, parent: wb });
            ctx.text(432 + Math.max(4, 700 * m[1] / 21.4) + 10, y + 12, (m[1] >= 1 ? m[1].toFixed(1) : m[1].toFixed(2)) + ' GB' + (i === 2 ? ' (≈)' : ''), { size: 13, font: 'mono', color: m[2], parent: wb });
            var w = parseFloat(b.getAttribute('width'));
            b.setAttribute('width', 0);
            ctx.animate(b, { width: [0, w] }, 700, 'out', 600 + i * 200);
          });
          ctx.text(1270, 790, 'peak memory ∝ chunk,', { size: 14, font: 'mono', color: 'lime', parent: wb });
          ctx.text(1270, 814, 'not ∝ video length', { size: 14, font: 'mono', color: 'lime', parent: wb });
          ctx.reveal(wb, {});
          ctx.hud('chunk = 4 frames → 1 latent frame');
          function setC(k) {
            S.ch.forEach(function (c, i) { c.setAttribute('fill', i < k ? ctx.alpha('cyan', 0.28) : (i === k ? ctx.alpha('amber', 0.45) : ctx.alpha('cyan', 0.08))); });
            S.lat.forEach(function (c, i) { c.setAttribute('fill', i <= k ? ctx.alpha('lime', 0.7) : ctx.alpha('lime', 0.08)); });
            var f0 = k === 0 ? 0 : 4 * k - 3, n = k === 0 ? 1 : 4;
            var cx = X0 + (f0 + n / 2) * FW;
            S.encArrow.setAttribute('x1', cx); S.encArrow.setAttribute('x2', cx);
            ctx.place(S.cache, X0 + f0 * FW, 0);
            S.cache.setAttribute('opacity', k === 0 ? 0 : 1);
          }
          setC(0);
          return ctx.wait(500).then(function () {
            return ctx.tween(4200, function (p) { setC(Math.min(30, Math.floor(p * 31))); }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Spatial tiling',
        say: 'Time is handled by chunks; space is handled by tiles. At ten eighty p or four K, even one chunk at full resolution is too large, so the decoder works on overlapping spatial tiles. Each tile is decoded independently, and in the overlap the two results are cross faded with linear ramps. Without blending you would see seams, because a convolutional decoder near a tile border sees different context than it would in the full frame.',
        deep: '<p>Typical settings (diffusers-style): 256-px tiles = 32 × 32 latents, 25% overlap, linear ramps. For a 1080p latent (135 × 240):</p>' +
          '<div class="eq">rows = ⌈(135 − 32)/24⌉ + 1 = 6,   cols = ⌈(240 − 32)/24⌉ + 1 = 10  →  60 tiles per chunk</div>' +
          '<div class="eq">x̂(p) = Σ<sub>i</sub> w<sub>i</sub>(p)·D(z<sub>tile i</sub>)(p) / Σ<sub>i</sub> w<sub>i</sub>(p),   w<sub>i</sub> = linear ramp to 0 across the overlap</div>' +
          '<ul><li>Overlap costs compute: 25% overlap in both axes ≈ 1.8× decoder FLOPs (4/3 per axis).</li>' +
          '<li>Receptive field matters: GroupNorm statistics and the mid-block attention see only the tile, so large tiles with generous overlap look best; some VAEs replace GroupNorm with per-frame / per-channel norms to make tiling exact-ish.</li>' +
          '<li>Temporal tiling (for non-causal VAEs) uses the same blend along time.</li>' +
          '<li>Decode is embarrassingly parallel across tiles → it can be spread over the same 8 GPUs that ran the DiT (sequence-parallel VAE decode in xDiT-style serving stacks).</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'overlapping spatial tiles with linear blending');
          var F = { x: 80, y: 592, w: 480, h: 270 };
          var bg = ctx.group({ parent: wb });
          miniFrame(ctx, bg, F.x, F.y, F.w, F.h, 0.4);
          bg.setAttribute('opacity', 0.55);
          var tiles = [];
          for (var r = 0; r < 2; r++) for (var c = 0; c < 3; c++) tiles.push([F.x + c * 148, F.y + r * 120, 184, 150]);
          var cols = ['cyan', 'violet', 'amber', 'lime', 'pink', 'teal'];
          S.tiles = tiles.map(function (t, i) {
            var rr = ctx.rect(t[0] + 1, t[1] + 1, t[2] - 2, t[3] - 2, { rx: 4, fill: ctx.alpha(cols[i], 0.13), stroke: cols[i], sw: 1.6, parent: wb });
            rr.setAttribute('opacity', 0);
            return rr;
          });
          ctx.text(F.x + F.w + 12, F.y + 12, '1080p frame', { size: 12, font: 'mono', color: 'dim', parent: wb });
          ctx.text(F.x + F.w + 12, F.y + 32, '(schematic 3×2', { size: 12, font: 'mono', color: 'dim', parent: wb });
          ctx.text(F.x + F.w + 12, F.y + 50, ' of ~60 tiles)', { size: 12, font: 'mono', color: 'dim', parent: wb });
          /* blend ramp plot */
          var PX = 720, PY = 612, PW = 340, PH = 120;
          ctx.text(PX, 598, 'blend weights across one overlap', { size: 12, font: 'mono', color: 'dim', parent: wb });
          ctx.line(PX, PY + PH, PX + PW, PY + PH, { color: 'faint', parent: wb });
          ctx.rect(PX + 120, PY, 100, PH, { rx: 0, fill: ctx.alpha('white', 0.05), parent: wb });
          ctx.poly([[PX, PY], [PX + 120, PY], [PX + 220, PY + PH]], { stroke: 'cyan', closed: false, sw: 2.2, parent: wb });
          ctx.poly([[PX + 120, PY + PH], [PX + 220, PY], [PX + PW, PY]], { stroke: 'violet', closed: false, sw: 2.2, parent: wb });
          ctx.text(PX + 20, PY + 16, 'tile A', { size: 12, font: 'mono', color: 'cyan', parent: wb });
          ctx.text(PX + PW - 60, PY + 16, 'tile B', { size: 12, font: 'mono', color: 'violet', parent: wb });
          ctx.text(PX + 170, PY + PH + 16, 'overlap', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: wb });
          ctx.text(PX, 790, 'w_A + w_B = 1 everywhere', { size: 13, font: 'mono', color: 'text', parent: wb });
          ctx.text(PX, 816, '256-px tiles · 25% overlap', { size: 13, font: 'mono', color: 'text', parent: wb });
          ctx.text(PX, 842, '≈ 1.8× decoder FLOPs', { size: 13, font: 'mono', color: 'amber', parent: wb });
          /* seam comparison */
          var SX = 1110, SW = 420;
          function strip(y, blend, label, col) {
            for (var i = 0; i < 42; i++) {
              var u = i / 41, base = 0.35 + 0.35 * u;
              var off = blend ? 0.12 * (1 - 2 * ctx.clamp((u - 0.4) / 0.2, 0, 1)) : (u < 0.5 ? 0.12 : -0.12);
              ctx.rect(SX + i * SW / 42, y, SW / 42 + 0.5, 60, { rx: 0, fill: ctx.cmap('cyan', base + off), parent: wb });
            }
            ctx.text(SX, y - 12, label, { size: 13, font: 'mono', color: col, parent: wb });
          }
          strip(620, false, 'hard cut between tiles: visible seam', 'red');
          ctx.line(SX + SW / 2, 614, SX + SW / 2, 686, { color: 'red', sw: 1.2, dash: '3 3', parent: wb });
          strip(740, true, 'linear cross-fade: seamless', 'lime');
          ctx.reveal(wb, {});
          ctx.hud('1080p latent 135×240 → ~60 tiles');
          return ctx.wait(500).then(function () {
            return S.tiles.reduce(function (p, t) {
              return p.then(function () { return ctx.fade(t, 1, 380); });
            }, Promise.resolve());
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Training losses',
        say: 'How is such a VAE trained? Reconstruct the input and penalise the difference in several ways. An L one pixel loss gets colours and coarse structure right but is happy with blur. A perceptual LPIPS loss compares deep network features and restores texture. A tiny KL term keeps the latent smooth and bounded. And a three dimensional patch discriminator, switched on later in training, pushes the decoder toward crisp, realistic detail and stable motion.',
        deep: '<div class="eq">L = ‖x − x̂‖<sub>1</sub> + λ<sub>p</sub>·LPIPS(x, x̂) + λ<sub>kl</sub>·KL( q(z|x) ‖ N(0, I) ) + λ<sub>adv</sub>·L<sub>GAN</sub>(D(x̂))</div>' +
          '<ul><li><b>L1</b> (sometimes + L2): the MSE optimum is the conditional mean → blur. Anchors colour, exposure and low frequencies.</li>' +
          '<li><b>LPIPS</b>: distance between normalised VGG/AlexNet activations (per frame), calibrated on human 2AFC judgements; restores texture.</li>' +
          '<li><b>KL</b>: λ<sub>kl</sub> ≈ 10⁻⁶ — the VAE is “almost an autoencoder”. Its role is to keep latents bounded and smooth, not to match a prior; latents are then scaled/normalised (per-channel mean/std) before diffusion.</li>' +
          '<li><b>GAN</b>: 3D (spatiotemporal) PatchGAN or StyleGAN-style discriminator with hinge loss and adaptive weight; enabled after reconstructions stabilise. Removes blur and temporal flicker.</li></ul>' +
          '<p>Training recipe: images first (low res), then short low-res videos, then long high-res clips; image and video batches mixed throughout thanks to causality. Reported reconstruction for 4×8×8×16 video VAEs is typically in the low-to-mid 30s dB PSNR at 720p.</p>' +
          '<div class="note">Thumbnails on the right are illustrative renderings of each failure mode, not model outputs.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'reconstruction objective: four terms, four jobs');
          var defs = ctx.el('defs', {}, wb);
          var f1 = ctx.el('filter', { id: 'vae-blur-6', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
          ctx.el('feGaussianBlur', { stdDeviation: 3.2 }, f1);
          var f2 = ctx.el('filter', { id: 'vae-blur-6b', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
          S.blur6 = ctx.el('feGaussianBlur', { stdDeviation: 3.2 }, f2);
          /* mini pipeline */
          miniFrame(ctx, wb, 80, 600, 96, 60, 0.3);
          ctx.text(128, 676, 'x', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: wb });
          ctx.node({ x: 262, y: 630, w: 110, h: 46, title: 'Encoder', color: 'lime', titleSize: 14, parent: wb, kind: 'box' });
          cube(ctx, { cx: 410, cy: 632, w: 36, h: 30, d: 12, color: 'amber', parent: wb, n: 4, mosaic: latentMosaic(8, ctx) });
          ctx.text(410, 676, 'z ~ q(z|x)', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: wb });
          ctx.node({ x: 560, y: 630, w: 110, h: 46, title: 'Decoder', color: 'lime', titleSize: 14, parent: wb, kind: 'box' });
          miniFrame(ctx, wb, 660, 600, 96, 60, 0.3).setAttribute('filter', 'url(#vae-blur-6b)');
          ctx.text(708, 676, 'x̂', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: wb });
          [[176, 207], [317, 386], [436, 505], [615, 656]].forEach(function (a) { ctx.line(a[0], 630, a[1], 630, { color: 'dim', sw: 1.5, arrow: true, parent: wb }); });
          var terms = [
            ['L1  ‖x − x̂‖₁', 'colour, exposure, low freq', 'cyan', 1.0],
            ['LPIPS', 'deep-feature distance → texture', 'violet', 0.8],
            ['KL · λ ≈ 1e-6', 'smooth, bounded latent', 'amber', 0.12],
            ['GAN (3D PatchGAN)', 'sharp detail, no flicker', 'pink', 0.45]
          ];
          S.lt = terms.map(function (t, i) {
            var y = 712 + i * 38;
            var g = ctx.group({ parent: wb });
            ctx.label(80, y, t[0], { color: t[2], size: 13, anchor: 'start', w: 200, parent: g });
            ctx.text(296, y, t[1], { size: 13, font: 'mono', color: 'text', parent: g });
            return g;
          });
          ctx.reveal(S.lt, { from: 'left', stagger: 350, delay: 300 });
          ctx.text(560, 872, 'L = L1 + λp·LPIPS + λkl·KL + λadv·GAN', { size: 14, font: 'mono', weight: 600, color: 'white', anchor: 'middle', parent: wb });
          /* reconstructions */
          var R = [['input', 'lime', null], ['L1 only: blurry', 'cyan', 'url(#vae-blur-6)'], ['+ LPIPS + GAN: sharp', 'pink', null]];
          S.rec = R.map(function (r, i) {
            var g = ctx.group({ parent: wb });
            var x = 880 + i * 222, y = 610;
            var fr = miniFrame(ctx, g, x, y, 200, 120, 0.35);
            if (r[2]) fr.setAttribute('filter', r[2]);
            ctx.rect(x, y, 200, 120, { rx: 2, stroke: r[1], sw: 1.6, parent: g });
            ctx.text(x + 100, y + 142, r[0], { size: 13, font: 'mono', color: r[1], anchor: 'middle', parent: g });
            return g;
          });
          ctx.para(880, 800, [
            'MSE/L1 optimum = conditional mean → blur; LPIPS and the',
            'discriminator restore the high frequencies the DiT relies on.'
          ], { size: 13, font: 'mono', color: 'dim', lh: 24, parent: wb });
          ctx.reveal(S.rec, { from: 'up', stagger: 400, delay: 600 });
          ctx.hud('L1 + LPIPS + KL + GAN');
          /* x̂ in the mini pipeline sharpens as the perceptual and adversarial terms switch on */
          return ctx.wait(700).then(function () {
            return ctx.animate(S.blur6, { stdDeviation: [3.2, 0.01] }, 1900, 'inOut');
          }).then(function () { return ctx.wait(500); });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Compression trade-off',
        say: 'How much should a VAE compress? The common choice, four by eight by eight with sixteen channels, gives our clip about one hundred eleven thousand tokens. Wan two point two squeezes space sixteen fold with forty eight channels, and LTX Video reaches one to one hundred ninety two, cutting tokens by eight and attention cost by over sixty. But reconstruction gets harder, and high dimensional latents are harder to generate. More compression is not free.',
        deep: '<table><tr><th>VAE</th><th>t×h×w</th><th>ch</th><th>ratio</th><th>tokens (5 s)</th></tr>' +
          '<tr><td>Wan 2.1 / HunyuanVideo / CogVideoX</td><td>4×8×8</td><td>16</td><td>48×</td><td>111,600 (p 1×2×2, 720p)</td></tr>' +
          '<tr><td>Wan 2.2 (TI2V-5B)</td><td>4×16×16</td><td>48</td><td>64×</td><td>27,280 (p 1×2×2, 1280×704)</td></tr>' +
          '<tr><td>LTX-Video</td><td>8×32×32</td><td>128</td><td>192×</td><td>14,080 (p 1, 1280×704)</td></tr></table>' +
          '<p>ratio = (t·h·w·3)/ch. Attention ∝ N²: Wan 2.2 needs ~17× less, LTX ~63× less than the 4×8×8 design for the same clip.</p>' +
          '<p><b>The dilemma</b> (VA-VAE, Yao et al. 2025): raising latent channels improves reconstruction but makes the latent distribution higher-dimensional and less structured, so the diffusion model converges slower and generates worse at fixed compute. Remedies:</p>' +
          '<ul><li>align latents with vision-foundation features (VA-VAE / REPA-style losses);</li>' +
          '<li>let the decoder finish the job — LTX’s decoder also performs the last denoising step, recovering detail lost by aggressive compression;</li>' +
          '<li>deep-compression AEs with residual shortcuts (DC-AE: 32–64× spatial for images).</li></ul>' +
          '<div class="note">The curve on the right is schematic (qualitative trend reported across these papers), not measured data.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'more compression: fewer tokens, harder reconstruction and generation');
          ctx.focus([wb, S.div, S.cubes[5], S.zNote], 0.3);
          var hdr = ['VAE', 't×h×w', 'ch', 'ratio', 'tokens for our 5 s clip', 'attention'];
          var cx = [80, 420, 530, 600, 690, 1010];
          hdr.forEach(function (h, i) { ctx.text(cx[i], 596, h, { size: 12, font: 'mono', weight: 600, color: 'dim', parent: wb }); });
          var rows = [
            ['Wan 2.1 · Hunyuan · CogVideoX', '4×8×8', '16', '48×', 111600, '1×', 'lime'],
            ['Wan 2.2 (TI2V-5B)', '4×16×16', '48', '64×', 27280, '1/17', 'cyan'],
            ['LTX-Video', '8×32×32', '128', '192×', 14080, '1/63', 'violet']
          ];
          S.tokBars = rows.map(function (r, i) {
            var y = 630 + i * 50;
            ctx.text(cx[0], y + 12, r[0], { size: 14, font: 'mono', weight: 600, color: r[6], parent: wb });
            ctx.text(cx[1], y + 12, r[1], { size: 14, font: 'mono', color: 'text', parent: wb });
            ctx.text(cx[2], y + 12, r[2], { size: 14, font: 'mono', color: 'text', parent: wb });
            ctx.text(cx[3], y + 12, r[3], { size: 14, font: 'mono', color: 'text', parent: wb });
            var b = ctx.rect(cx[4], y, 200 * r[4] / 111600, 24, { rx: 4, fill: ctx.alpha(r[6], 0.4), stroke: r[6], sw: 1, parent: wb });
            ctx.text(cx[4] + 200 * r[4] / 111600 + 8, y + 12, r[4].toLocaleString('en-US'), { size: 13, font: 'mono', color: r[6], parent: wb });
            ctx.text(cx[5], y + 12, r[5], { size: 14, font: 'mono', weight: 600, color: r[6], parent: wb });
            return b;
          });
          ctx.text(80, 800, 'ratio = t·h·w·3 / ch   ·   Wan 2.2 and LTX at 1280×704   ·   attention ∝ N²', { size: 12, font: 'mono', color: 'dim', parent: wb });
          ctx.text(80, 830, 'LTX: decoder also performs the final denoising step to recover detail lost to 1:192', { size: 13, font: 'mono', color: 'violet', parent: wb });
          ctx.text(80, 858, 'VA-VAE / REPA: align latents with vision-foundation features to make them easier to generate', { size: 13, font: 'mono', color: 'text', parent: wb });
          /* schematic trade-off */
          var PX = 1110, PY = 600, PW = 400, PH = 200;
          ctx.text(PX + PW, 590, 'schematic, not measured', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: wb });
          var rc = ctx.plot(PX, PY, PW, PH, function (x) { return 0.92 - 0.55 * x * x; }, { color: 'cyan', sw: 2.2, xLabel: 'compression →', yLabel: 'quality', parent: wb });
          var gc = ctx.plot(PX, PY, PW, PH, function (x) { return 0.35 + 0.9 * x - 1.05 * x * x; }, { color: 'amber', sw: 2.2, axes: false, parent: wb });
          ctx.text(PX + 60, PY + 50, 'reconstruction', { size: 12, font: 'mono', color: 'cyan', parent: wb });
          ctx.text(PX + 40, PY + PH - 14, 'generation @ fixed compute', { size: 12, font: 'mono', color: 'amber', parent: wb });
          var pk = gc.toPx(0.43, 0.35 + 0.9 * 0.43 - 1.05 * 0.43 * 0.43);
          ctx.circle(pk.x, pk.y, 5, { fill: 'amber', parent: wb, glow: true });
          ctx.text(pk.x, pk.y - 14, 'sweet spot', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: wb });
          ctx.reveal(wb, {});
          ctx.reveal([rc.curve, gc.curve], { from: 'draw', delay: 500, stagger: 300, dur: 1000 });
          S.tokBars.forEach(function (b, i) {
            var w = parseFloat(b.getAttribute('width'));
            b.setAttribute('width', 0);
            ctx.animate(b, { width: [0, w] }, 800, 'out', 400 + i * 250);
          });
          ctx.hud('111,600 → 27,280 → 14,080 tokens');
          return ctx.wait(2600);
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Decode & recap',
        say: 'After the diffusion transformer finishes, the decoder runs the pipeline in reverse: the sixteen channel latent is upsampled in space and time, chunk by chunk and tile by tile, back into one hundred and twenty one frames of pixels. It runs once per clip, costs a small fraction of the generation FLOPs, but it sets the memory peak, and its quality ceiling is the ceiling of the whole video model.',
        deep: '<p>The decoder mirrors the encoder (Wan-VAE: widths 384-384-384-192-96, one extra res block per stage, nearest-neighbour ×2 upsampling + causal conv; temporal upsampling 1 → 2 per stage on frames after the first). It is roughly 2× the encoder’s FLOPs and dominates VAE memory.</p>' +
          '<table><tr><th>Summary</th><th>Value</th></tr>' +
          '<tr><td>compression</td><td>4×8×8, 3 → 16 ch (48× by value)</td></tr>' +
          '<tr><td>our clip</td><td>334.5 M → 7.14 M values; 111,600 DiT tokens</td></tr>' +
          '<tr><td>causality</td><td>first frame alone; images = 1-frame videos</td></tr>' +
          '<tr><td>memory tricks</td><td>chunked causal cache (time), overlapped tiles (space)</td></tr>' +
          '<tr><td>losses</td><td>L1 + LPIPS + tiny KL + 3D GAN</td></tr>' +
          '<tr><td>FLOPs share</td><td>decode ≈ 9×10¹⁴ vs DiT 1.3×10¹⁸: ≈ 0.1% of a 50-step, CFG clip — but the memory peak</td></tr></table>' +
          '<div class="note">Serving: decode on the same GPUs right after the last denoising step (tiles spread across devices), or hand the latent to a separate decode pool so the DiT GPUs start the next job — a classic pipeline split in video-serving stacks.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'the decoder: the same pipeline in reverse');
          ctx.focus(null);
          var z = cube(ctx, { cx: 140, cy: 690, w: 56, h: 32, d: 10, color: 'lime', parent: wb, n: 5, mosaic: latentMosaic(3, ctx) });
          ctx.text(140, 740, '16×31×90×160', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: wb });
          var dec = [
            { cx: 330, w: 50, h: 28, d: 44, shape: '384×31×90×160' },
            { cx: 500, w: 72, h: 40, d: 44, shape: '384×61×180×320' },
            { cx: 690, w: 104, h: 58, d: 32, shape: '192×121×360×640' },
            { cx: 905, w: 150, h: 84, d: 22, shape: '96×121×720×1280' }
          ];
          S.dec = dec.map(function (s) {
            var g = ctx.group({ parent: wb });
            cube(ctx, { cx: s.cx, cy: 690, w: s.w, h: s.h, d: s.d, color: 'teal', parent: g });
            ctx.text(s.cx, 760, s.shape, { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: g });
            g.setAttribute('opacity', 0);
            return g;
          });
          [[177, 279, 'conv'], [381, 438, '↑thw'], [562, 618, '↑thw'], [762, 815, '↑hw'], [995, 1066, 'head']].forEach(function (a) {
            ctx.line(a[0], 690, a[1], 690, { color: 'dim', sw: 1.5, arrow: true, parent: wb });
            ctx.text((a[0] + a[1]) / 2, 674, a[2], { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: wb });
          });
          S.out = ctx.group({ parent: wb });
          for (var i = 5; i >= 0; i--) miniFrame(ctx, S.out, 1080 + i * 12, 640 - i * 8, 170, 96, i / 5);
          ctx.text(1190, 770, '121 × 720 × 1280 × 3', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: S.out });
          S.out.setAttribute('opacity', 0);
          ctx.para(1345, 610, ['runs once per clip', '~0.1% of FLOPs', 'but the memory peak', 'and the quality ceiling'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: wb });
          var chips = [['4×8×8 · 16 ch', 'lime'], ['causal: image = 1 frame', 'amber'], ['chunk cache (time)', 'cyan'], ['overlap tiles (space)', 'violet'], ['L1 + LPIPS + KL + GAN', 'pink']];
          var x = 80;
          S.chips = chips.map(function (c) {
            var ch = ctx.label(x, 848, c[0], { color: c[1], size: 12, anchor: 'start', parent: wb });
            x += ch.w + 14;
            return ch;
          });
          ctx.reveal(S.chips, { from: 'up', stagger: 120, delay: 400 });
          ctx.hud('7.14 M latents → 334.5 M pixels');
          var chain = ctx.wait(500);
          S.dec.forEach(function (g) {
            chain = chain.then(function () { return ctx.reveal(g, { from: 'scale', s0: 0.5, dur: 450 }); });
          });
          return chain.then(function () { return ctx.reveal(S.out, { from: 'left', dur: 600 }); }).then(function () {
            return ctx.pulse(S.out, { color: 'lime', dur: 700 });
          });
        }
      }
    ]
  });
})();
