/* L2 — Spatiotemporal VAE. Why latents, causal 3D conv encoders, chunked caches, tiling, losses and the compression trade-off.
 * Beat format: each step is a sequence of beats (say + card + deep + one gated animation segment). */
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
      'Esser, Rombach &amp; Ommer, <i>Taming Transformers for High-Resolution Image Synthesis (VQGAN)</i>, CVPR 2021',
      'Rombach et al., <i>High-Resolution Image Synthesis with Latent Diffusion Models</i>, CVPR 2022',
      'Zhang et al., <i>The Unreasonable Effectiveness of Deep Features as a Perceptual Metric (LPIPS)</i>, CVPR 2018',
      'Yu et al., <i>Language Model Beats Diffusion — Tokenizer is Key to Visual Generation (MAGVIT-v2)</i>, ICLR 2024',
      'Yang et al., <i>CogVideoX: Text-to-Video Diffusion Models with an Expert Transformer</i>, ICLR 2025',
      'Kong et al., <i>HunyuanVideo: A Systematic Framework for Large Video Generative Models</i>, arXiv 2412.03603, 2024',
      'Wan Team (Alibaba), <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025',
      'HaCohen et al., <i>LTX-Video: Realtime Video Latent Diffusion</i>, 2025',
      'Yao et al., <i>Reconstruction vs. Generation: Taming Optimization Dilemma in Latent Diffusion Models (VA-VAE)</i>, CVPR 2025',
      'Chen et al., <i>Deep Compression Autoencoder for Efficient High-Resolution Diffusion Models (DC-AE)</i>, ICLR 2025'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Why a latent space',
        beats: [
          {
            say: 'Our five second shot, as raw pixels, is one hundred and twenty one frames of seven twenty by twelve eighty by three colour channels: about three hundred thirty four million numbers, for a single activation.',
            card: { tag: 'NUMBERS', title: 'The raw clip', stat: { v: '334.5 M', u: 'values', l: '121 × 720 × 1280 × 3: 669 MB in bf16, for one activation' } },
            deep: '<p>Raw clip: <code>121 × 720 × 1280 × 3 = 334,540,800</code> values (669 MB in bf16). A network holds dozens of activations of at least that size, and the input is not even the largest one: the first feature maps have 96 channels.</p>' +
              '<p>Storage is not the only issue. Operating directly on 8-bit pixels forces the generative model to spend capacity on perceptually irrelevant detail: sensor noise, compression texture and sub-pixel jitter.</p>'
          },
          {
            say: 'A transformer cannot attend over that. Cut into sixteen by sixteen pixel patches, frame by frame, the clip would need four hundred thirty five thousand tokens, while the latent needs about one hundred eleven thousand: fifteen times fewer attention pairs.',
            card: { tag: 'WHY IT MATTERS', title: 'Attention pairs shrink 15×', body: 'Per-frame pixel patches give N = 435,600 and 1.9 × 10¹¹ pairs. The latent gives N = 111,600 and 1.25 × 10¹⁰. Same clip, far less attention.' },
            deep: '<table><tr><th>Operate on</th><th>Tokens N</th><th>Pairs N²</th></tr>' +
              '<tr><td>pixels, 16×16 patches</td><td>121·45·80 = 435,600 (768 values each)</td><td>1.9×10¹¹</td></tr>' +
              '<tr><td>latent 4×8×8, 16 ch, 2×2 patches</td><td>31·45·80 = 111,600 (64 values each)</td><td>1.25×10¹⁰</td></tr></table>' +
              '<p>A ViT-style pixel tokenizer emits one token per patch per frame. With the latent, four frames share one token slice and each 4×16×16 pixel block becomes 64 values instead of 3,072 (768 per frame). Attention cost scales with N², so 3.9× fewer tokens is 15× fewer pairs.</p>' +
              '<details><summary>Go deeper</summary><p><b>Is the latent a law of nature?</b> No. A pixel-space transformer could also patchify in time (4×16×16 blocks give about the same 111,600 tokens), but every token then carries 3,072 raw values that a single linear layer must digest, and the generator has to model texture and sensor noise itself. Pixel-space diffusion does work at moderate scale and in cascades (Imagen Video, simple diffusion), yet a learned codec keeps the generator small and is the practical choice for long, high-resolution video.</p></details>'
          },
          {
            say: 'But most of those numbers encode detail our eyes barely notice, and neighbouring frames are almost identical. Compressing that away costs very little perceptual quality.',
            card: { tag: 'KEY IDEA', title: 'Perceptual versus semantic compression', body: 'The autoencoder removes imperceptible detail (high rate, low distortion). The generative model only has to learn what is left.', more: '<p>Rombach et al. locate two regimes on the rate–distortion curve: a first, cheap stage where large rate savings barely change distortion (perceptual compression, the autoencoder’s job), and a second stage where every further bit hurts (semantic compression, learned by the diffusion model).</p>' },
            deep: '<p>Rombach et al. split lossy compression into two regimes on the rate–distortion curve: <b>perceptual compression</b> (high rate: remove imperceptible high-frequency detail, the autoencoder’s job) and <b>semantic compression</b> (low rate: what the generative model learns). Training the diffusion model only in the second regime is what made latent diffusion affordable.</p>' +
              '<p>In video there is a third source of redundancy: consecutive frames 1/24 s apart share almost all content, so temporal compression (4×) is nearly free.</p>'
          },
          {
            say: 'The video VAE removes that redundancy once, up front, so the diffusion model can spend its capacity on meaning and motion. The result is about forty seven times fewer values.',
            card: { tag: 'NUMBERS', title: 'Compress once, generate small', stat: { v: '46.8×', u: 'smaller', l: '7.14 M latent values instead of 334.5 M pixel values' } },
            deep: '<div class="note">The VAE is trained once, frozen, and then shared by training and inference of the DiT. Its compression factor sets the token budget, and therefore the O(N²) attention bill, of everything downstream.</div>' +
              '<p>That is why the VAE gets its own chamber: a bad codec caps quality no matter how large the diffusion transformer, and an over-aggressive one makes the latent hard to generate. The next steps open the encoder, its causal convolutions, the memory tricks and the training losses.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('raw clip = 334.5 M values');
          /* beat 1: the raw clip */
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
          S.gL = ctx.group();
          ctx.text(90, 540, '121 × 720 × 1280 × 3', { size: 15, font: 'mono', color: 'text', parent: S.gL });
          S.cnt1 = ctx.text(90, 574, '0', { size: 28, font: 'mono', weight: 700, color: 'white', parent: S.gL });
          ctx.text(90, 606, 'values · 669 MB in bf16, for one activation', { size: 13, font: 'mono', color: 'dim', parent: S.gL });
          return Promise.all([
            ctx.reveal(S.stack, { from: 'left' }),
            ctx.reveal(S.gL, { delay: 300 }),
            ctx.counter(S.cnt1, 0, 334540800, 1600)
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: token budgets */
            S.gT = ctx.group();
            ctx.text(620, 210, 'WHAT A TRANSFORMER WOULD HAVE TO ATTEND OVER', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: S.gT });
            var rows = [['pixels · 16×16 patches', 435600, 'red', '435,600 tokens × 768 values', 'N² = 1.9×10¹¹'], ['latent 4×8×8 · 2×2 patches', 111600, 'lime', '111,600 tokens × 64 values', 'N² = 1.25×10¹⁰  (15× fewer)']];
            S.tb = rows.map(function (r, i) {
              var y = 250 + i * 96;
              ctx.text(620, y, r[0], { size: 15, font: 'mono', weight: 600, color: r[2], parent: S.gT });
              var b = ctx.rect(620, y + 16, 880 * r[1] / 435600, 26, { rx: 4, fill: ctx.alpha(r[2], 0.4), stroke: r[2], sw: 1, parent: S.gT });
              ctx.text(620, y + 62, r[3] + '   ·   ' + r[4], { size: 13, font: 'mono', color: 'text', parent: S.gT });
              return b;
            });
            var grow = S.tb.map(function (b, i) {
              var w = parseFloat(b.getAttribute('width'));
              b.setAttribute('width', 0);
              return ctx.animate(b, { width: [0, w] }, 900, 'out', 400 + i * 400);
            });
            return Promise.all([ctx.reveal(S.gT, { delay: 100 })].concat(grow));
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: redundancy, the rate-distortion picture */
            S.gR = ctx.group();
            ctx.text(620, 540, 'RATE–DISTORTION (schematic, after Rombach et al. 2022)', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 1, parent: S.gR });
            var PL = { x: 650, y: 570, w: 520, h: 250 };
            ctx.rect(PL.x + PL.w * 0.3, PL.y, PL.w * 0.7, PL.h, { rx: 0, fill: ctx.alpha('lime', 0.06), parent: S.gR });
            ctx.rect(PL.x, PL.y, PL.w * 0.3, PL.h, { rx: 0, fill: ctx.alpha('violet', 0.08), parent: S.gR });
            S.rd = ctx.plot(PL.x, PL.y, PL.w, PL.h, function (x) { return 0.92 * Math.exp(-9 * x) + 0.06; }, { color: 'white', sw: 2.2, xLabel: 'rate (bits / pixel) →', yLabel: 'distortion', parent: S.gR });
            ctx.para(PL.x + PL.w * 0.3 + 14, PL.y + 50, ['perceptual compression', 'drop invisible detail', '→ the VAE'], { size: 13, font: 'mono', color: 'lime', lh: 20, parent: S.gR });
            ctx.para(PL.x + 40, PL.y + 22, ['semantic', 'compression', '→ the DiT'], { size: 13, font: 'mono', color: 'violet', lh: 20, parent: S.gR });
            ctx.para(1210, 600, [
              'Most bits of a frame are',
              'high-frequency texture that',
              'costs rate but barely moves',
              'distortion. Frames 1/24 s',
              'apart are nearly identical.'
            ], { size: 13, font: 'mono', color: 'text', lh: 22, parent: S.gR });
            return Promise.all([
              ctx.reveal(S.gR, { delay: 100 }),
              ctx.reveal(S.rd.curve, { from: 'draw', delay: 500, dur: 1200 })
            ]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: compress once, then generate in the small space */
            S.gS = ctx.group();
            var big = ctx.text(620, 470, 'and 7.14 M latent values instead of 334.5 M pixels: 46.8× smaller', { size: 14, font: 'mono', color: 'lime', parent: S.gS });
            ctx.para(1210, 730, [
              'Compress that away once,',
              'then generate in the small',
              'space that is left.'
            ], { size: 13, font: 'mono', color: 'lime', lh: 22, parent: S.gS });
            ctx.hud('334.5 M pixels → 7.14 M latents');
            return ctx.reveal(S.gS, { from: 'up' }).then(function () { return ctx.pulse(big, { color: 'lime', times: 2, dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'The encoder',
        beats: [
          {
            say: 'Here is the encoder, a stack of three dimensional convolutions. The first stage keeps full resolution and lifts the three colour channels to ninety six feature channels, so it holds the largest tensor of all, bigger than the input itself.',
            card: { tag: 'NUMBERS', title: 'Stage 0 is the biggest tensor', stat: { v: '10.7 G', u: 'values', l: '96 × 121 × 720 × 1280: 32× the input, 21.4 GB in bf16' } },
            deep: '<p>Wan-VAE-style encoder (base width 96, multipliers 1-2-4-4, ~127 M parameters with the decoder):</p>' +
              '<table><tr><th>Stage</th><th>C × T × H × W</th><th>Values</th></tr>' +
              '<tr><td>input</td><td>3 × 121 × 720 × 1280</td><td>0.33 G</td></tr>' +
              '<tr><td>stage 0 (res blocks)</td><td>96 × 121 × 720 × 1280</td><td><b>10.7 G</b></td></tr></table>' +
              '<p>The first conv lifts 3 → 96 channels at full resolution, so stage 0 holds 32× more values than the input, and every residual block in it keeps such a tensor alive.</p>'
          },
          {
            say: 'Three downsampling stages each halve height and width, and the last two also halve time. Channels grow from ninety six to three hundred eighty four as the grid shrinks.',
            card: { tag: 'HOW IT WORKS', title: 'Channels up, grid down', body: 'Widths 96 → 192 → 384 while each stage halves height and width. The last two also halve time: T = 121 → 61 → 31.' },
            deep: '<table><tr><th>Stage</th><th>C × T × H × W</th><th>Values</th></tr>' +
              '<tr><td>↓2 hw → stage 1</td><td>192 × 121 × 360 × 640</td><td>5.35 G</td></tr>' +
              '<tr><td>↓2 thw → stage 2</td><td>384 × 61 × 180 × 320</td><td>1.35 G</td></tr>' +
              '<tr><td>↓2 thw → stage 3 + mid (attn)</td><td>384 × 31 × 90 × 160</td><td>171 M</td></tr></table>' +
              '<p>Causal temporal downsampling keeps the first frame separate: T → 1 + (T − 1)/2, so 121 → 61 → 31. Channels double as the grid shrinks, so FLOPs per stage stay roughly balanced (a 3×3×3 conv costs 2·27·C² per voxel) while memory falls fast.</p>'
          },
          {
            say: 'A final head predicts a mean and a variance for sixteen latent channels, and one sample gives the latent: thirty one by ninety by one hundred sixty.',
            card: { tag: 'HOW IT WORKS', title: 'A Gaussian per latent voxel', body: 'The head outputs μ and log σ² for 16 channels. <code>z = μ + σ·ε</code> is sampled in training; most pipelines use <code>z = μ</code> at inference.' },
            deep: '<table><tr><th>Stage</th><th>C × T × H × W</th><th>Values</th></tr>' +
              '<tr><td>head → (μ, log σ²)</td><td>32 × 31 × 90 × 160</td><td>14.3 M</td></tr>' +
              '<tr><td>z = μ + σ·ε</td><td>16 × 31 × 90 × 160</td><td>7.14 M</td></tr></table>' +
              '<p>Compression 4×8×8 in space-time, 3 → 16 channels. Sampling z = μ + σ·ε is used in training; at inference most pipelines take z = μ (σ is tiny anyway because of the weak KL term). Latents are then normalised per channel (mean and standard deviation) before they reach the DiT.</p>'
          },
          {
            say: 'Notice where the memory goes. That first full resolution tensor alone is twenty one gigabytes in sixteen bit precision, and a residual block holds several of them, so an eighty gigabyte GPU cannot encode a whole clip in one pass. The encoder has to work chunk by chunk.',
            card: { tag: 'PITFALL', title: 'Memory peaks at full resolution', body: 'One stage-0 tensor is 21.4 GB in bf16 and a residual block holds several. A whole 720p clip does not fit on an 80 GB GPU in one pass.', more: '<p>Stage-0 tensor: 96 × 121 × 720 × 1280 × 2 B = 21.4 GB. A residual block keeps its input, an intermediate activation and the skip connection alive, so three or four such tensors coexist: 64–86 GB before weights. Chunking to 4 frames shrinks each by 121/4 ≈ 30×.</p>' },
            deep: '<div class="note">Stage-0 activations alone are 10.7 G values = 21.4 GB in bf16, per tensor, and a res block holds several. Encoding a whole 720p clip in one pass is impractical even on an 80 GB GPU; hence chunking, two steps ahead.</div>' +
              '<p>Compute is balanced across stages but memory is not: it peaks where the grid is largest. That single fact motivates the two memory tricks that follow: a <b>chunked causal cache</b> along time and <b>overlapped tiling</b> along space.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove([S.gL, S.gT, S.gR, S.gS], 400);
          ctx.remove(S.stackLab, 300);
          ctx.hud('');
          /* divider + close-up bench */
          S.div = ctx.group();
          ctx.line(40, 548, 1560, 548, { color: 'line', sw: 1, parent: S.div });
          ctx.text(60, 568, 'CLOSE-UP ▸', { size: 12, font: 'mono', weight: 600, color: 'lime', spacing: 2, parent: S.div });
          S.wbTitle = ctx.text(170, 568, '', { size: 12, font: 'mono', color: 'dim', parent: S.div });
          var wb = newBench(ctx, S, 'values per stage (log scale): the peak is at full resolution');
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
          var arrows = [[229, 260, 'conv'], [440, 473, '↓hw'], [617, 656, '↓thw'], [780, 821, '↓thw'], [923, 985, 'head'], [1055, 1163, 'sample']];
          S.cubes = []; S.arr = [];
          function mkStage(i) {
            var s = st[i], g = ctx.group({ parent: S.pipe });
            cube(ctx, { cx: s.cx, cy: cy, w: s.w, h: s.h, d: s.d, color: s.col, parent: g, n: i === 5 ? 5 : 0, mosaic: i === 5 ? latentMosaic(3, ctx) : null });
            ctx.text(s.cx, 300, s.lab, { size: 12, font: 'mono', weight: 600, color: s.col, anchor: 'middle', parent: g });
            ctx.text(s.cx, 482, s.shape, { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: g });
            g.valEl = ctx.text(s.cx, 502, '', { size: 12, font: 'mono', weight: 600, color: s.col, anchor: 'middle', parent: g });
            g.s = s;
            S.cubes[i] = g;
            var a = ctx.group({ parent: S.pipe });
            ctx.line(arrows[i][0], cy + 12, arrows[i][1], cy + 12, { color: 'dim', sw: 1.5, arrow: true, parent: a });
            ctx.text((arrows[i][0] + arrows[i][1]) / 2, cy + 30, arrows[i][2], { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: a });
            S.arr[i] = a;
            g.setAttribute('opacity', 0); a.setAttribute('opacity', 0);
            return g;
          }
          var fmtV = function (v) { return v >= 1e9 ? (v / 1e9).toFixed(2) + ' G' : (v / 1e6).toFixed(v >= 1e8 ? 0 : 2) + ' M'; };
          function showStage(i, chain) {
            return chain.then(function () {
              var c = S.cubes[i];
              ctx.reveal(S.arr[i], { dur: 250 });
              ctx.reveal(c, { from: 'scale', s0: 0.5, dur: 450 });
              return ctx.counter(c.valEl, 0, c.s.val, 420, fmtV);
            });
          }
          /* bench: one bar per stage, log scale */
          var rows = [['input', 3.345e8, 'dim'], ['stage 0', 10.7e9, 'red'], ['stage 1', 5.35e9, 'amber'], ['stage 2', 1.35e9, 'lime'], ['stage 3', 1.71e8, 'lime'], ['z', 7.14e6, 'lime']];
          function barRow(i) {
            var r = rows[i], y = 588 + i * 42, g = ctx.group({ parent: wb });
            ctx.text(240, y + 13, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: g });
            var w = logBar(r[1], 6, 10.2, 640);
            var b = ctx.rect(254, y, w, 26, { rx: 4, fill: ctx.alpha(r[2], 0.4), stroke: r[2], sw: 1, parent: g });
            var gb = r[1] * 2 / 1e9;
            ctx.text(254 + w + 10, y + 13, (r[1] >= 1e9 ? (r[1] / 1e9).toFixed(2) + ' G' : (r[1] / 1e6).toFixed(1) + ' M') + '  ·  ' + (gb >= 1 ? gb.toFixed(1) + ' GB' : (gb * 1000).toFixed(0) + ' MB') + ' bf16', { size: 12, font: 'mono', color: r[2], parent: g });
            b.setAttribute('width', 0);
            return Promise.all([ctx.reveal(g, {}), ctx.animate(b, { width: [0, w] }, 700, 'out', 300)]);
          }
          /* beat 1: input and the full-resolution stage */
          var shrink = ctx.transform(S.stack, { x: 12, y: 245, s: 0.42 }, 1000, 'inOut');
          ctx.text(118, 300, 'input', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', parent: S.pipe });
          ctx.text(138, 482, '3×121×720×1280', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: S.pipe });
          ctx.text(138, 502, '334.5 M', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', parent: S.pipe });
          mkStage(0);
          return shrink.then(function () {
            return Promise.all([
              ctx.reveal(S.div, {}),
              barRow(0),
              ctx.wait(300).then(function () { return barRow(1); }),
              showStage(0, ctx.wait(200))
            ]);
          }).then(function () { return ctx.pulse(S.cubes[0], { color: 'red', dur: 700 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: three downsampling stages */
            mkStage(1); mkStage(2); mkStage(3);
            var chain = ctx.wait(100);
            [1, 2, 3].forEach(function (i) { chain = showStage(i, chain); });
            return Promise.all([chain, barRow(2), ctx.wait(400).then(function () { return barRow(3); }), ctx.wait(800).then(function () { return barRow(4); })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the head and the sample */
            mkStage(4); mkStage(5);
            S.zNote = ctx.group({ parent: S.pipe });
            ctx.rect(1290, 330, 250, 124, { rx: 10, fill: ctx.alpha('lime', 0.07), stroke: ctx.alpha('lime', 0.6), parent: S.zNote });
            ctx.para(1306, 356, ['latent z', '16 × 31 × 90 × 160', '= 7.14 M values', '4×8×8 (t·h·w), 3 → 16 ch'], { size: 13, font: 'mono', color: 'lime', lh: 23, parent: S.zNote });
            S.zNote.setAttribute('opacity', 0);
            var zEq = ctx.text(1110, 356, 'z = μ + σ·ε', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: S.pipe });
            ctx.hud('334.5 M pixels → 7.14 M latents (÷46.8)');
            var chain = ctx.wait(100);
            [4, 5].forEach(function (i) { chain = showStage(i, chain); });
            return Promise.all([chain.then(function () { return ctx.reveal(S.zNote, { from: 'right' }); }), ctx.reveal(zEq, { from: 'up', delay: 900 }), barRow(5)]).then(function () {
              return ctx.pulse(S.cubes[5], { color: 'lime', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the memory lesson */
            var pg = ctx.para(1100, 600, [
              'channels grow as the grid shrinks,',
              'so compute per stage stays balanced,',
              'but memory peaks at stage 0:',
              '96 × 121 × 720 × 1280 = 10.7 G values',
              '= 21.4 GB for ONE bf16 tensor.',
              '',
              'no GPU holds a dozen of those →',
              'encode causally, chunk by chunk.'
            ], { size: 13, font: 'mono', color: 'text', lh: 24, parent: wb });
            return Promise.all([ctx.reveal(pg, { from: 'left' }), ctx.pulse(S.cubes[0], { color: 'red', times: 2, dur: 600 })]);
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Causal 3D convolution',
        beats: [
          {
            say: 'Zoom into one convolution along the time axis. The kernel spans three frames, and every output frame is a weighted sum of the three input frames under it.',
            card: { tag: 'HOW IT WORKS', title: 'Kernel of three frames in time', body: 'Each output frame sums three input frames, each convolved spatially: <code>y_t = Σ W_k ∗ x_(t−k)</code>, with k = 0, 1, 2.' },
            deep: '<div class="eq">y<sub>t</sub> = Σ<sub>k=0..2</sub> W<sub>k</sub> ∗<sub>hw</sub> x<sub>t−k</sub>,   x<sub>−1</sub> = x<sub>−2</sub> = 0 (or cached)</div>' +
              '<p>A 3×3×3 convolution is three 2D convolutions W<sub>k</sub> applied to three neighbouring frames and summed. Everything below is about <i>which</i> three frames: the spatial part is unchanged. Spatial padding stays symmetric.</p>'
          },
          {
            say: 'Instead of padding one frame on each side, a causal convolution pads two frames at the front and none at the back. So the output at time t only ever sees frames t, t minus one and t minus two, never the future.',
            card: { tag: 'TRY IT', title: 'Click an output: it never sees ahead', body: 'Pad (2, 0) in time, not (1, 1). Click any y_t and the window jumps to frames t − 2, t − 1 and t: never the future.' },
            deep: '<p>Padding is (k<sub>t</sub> − 1, 0) in time instead of the symmetric ((k<sub>t</sub> − 1)/2, (k<sub>t</sub> − 1)/2). Temporal down-sampling uses stride 2 on frames 1..T−1 while frame 0 passes alone, giving T → 1 + (T − 1)/2.</p>' +
              '<p>The front padding is zeros for the first chunk of a clip, and, when decoding or encoding in chunks, the <i>cached</i> last two input frames of the previous chunk: the next step shows why the two are equivalent.</p>'
          },
          {
            say: 'A symmetric kernel would let the output at time four peek at frame five. That leak would break streaming and make early frames depend on later ones, which is exactly what causality forbids.',
            card: { tag: 'PITFALL', title: 'Symmetric padding leaks the future', body: 'A centred kernel at t = 4 reads frame 5. That breaks chunked streaming and lets the first frame depend on later frames.' },
            deep: '<p>With symmetric padding, the output at time t depends on x<sub>t+1</sub>. Then encoding chunk k needs the first frame of chunk k+1, chunk boundaries change the result, and the first frame of a clip is not encoded the same way as an image alone.</p>' +
              '<p>Non-causal video VAEs (symmetric temporal padding, as in several early 3D VAEs) therefore need overlapping temporal tiles with blending, and can show flicker at tile borders. Causal ones such as MAGVIT-v2 and its descendants avoid the problem by construction.</p>'
          },
          {
            say: 'The first frame is therefore encoded on its own, which makes a still image just a one frame video, and lets one VAE serve images, image to video, and video.',
            card: { tag: 'WHY IT MATTERS', title: 'An image is a one-frame video', body: 'y₀ depends only on x₀, so E(image) equals the first latent frame of E(video). One VAE serves images, I2V and video.', more: '<p>Cost of a 3×3×3 conv from C to C channels: 2·27·C² FLOPs per output voxel, 0.5 MFLOP at C = 96. Stage 0 has 121 · 720 · 1280 = 111.5 M voxels, so one such layer is ≈ 5.5×10¹³ FLOPs, and the whole encoder plus decoder lands around 10¹⁵.</p>' },
            deep: '<ul><li><b>Images and videos share one latent space</b>: E(image) = first latent frame of E(video starting with that image). Enables joint image-video training (billions of images, far fewer good videos) and I2V conditioning by encoding just frame 0.</li>' +
              '<li><b>Streaming</b>: causality means a chunk can be encoded or decoded given only a small cache of the past, the basis of the next step.</li>' +
              '<li>Lineage: MAGVIT-v2 causal 3D CNN tokenizer → CogVideoX, HunyuanVideo, Wan, Cosmos tokenizers.</li></ul>' +
              '<div class="note">Cost: a 3×3×3 conv from C to C channels costs 2·27·C² FLOPs per output voxel, 0.5 MFLOP at C = 96; stage 0 has 111.5 M voxels, so one such layer costs ≈ 5.5×10¹³ FLOPs.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'causal temporal padding · kernel k_t = 3');
          ctx.focus([wb], 0.03);
          ctx.hud('output at t sees only frames ≤ t');
          var X0 = 262, DX = 92, CW = 80, Y0 = 628;
          /* beat 1: frames, output cells and a kernel spanning three frames */
          S.inLab = ctx.text(X0, 604, 'input frames (time →)', { size: 14, font: 'mono', weight: 600, color: 'dim', parent: wb });
          S.inCells = [];
          for (var i = 2; i < 11; i++) {
            var x = X0 + i * DX;
            S.inCells.push(miniFrame(ctx, wb, x, Y0, CW, 52, (i - 2) / 8));
            S.inCells.push(ctx.text(x + CW / 2, Y0 + 66, 'x' + (i - 2), { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: wb }));
          }
          S.outCells = [];
          S.outLab = [ctx.text(X0, 770, 'output', { size: 13, font: 'mono', color: 'dim', parent: wb })];
          for (var j = 0; j < 9; j++) {
            var ox = X0 + (j + 2) * DX;
            S.outCells.push(ctx.rect(ox, 752, CW, 36, { rx: 4, fill: ctx.alpha('lime', 0.06), stroke: ctx.alpha('lime', 0.4), sw: 1, parent: wb }));
            S.outLab.push(ctx.text(ox + CW / 2, 770, 'y' + j, { size: 13, font: 'mono', color: 'lime', anchor: 'middle', parent: wb }));
          }
          S.win = ctx.rect(X0 - 6, Y0 - 8, 2 * DX + CW + 12, 60, { rx: 8, stroke: 'amber', sw: 2.2, parent: wb, glow: true });   /* ends above the x labels */
          S.kl = [0, 1, 2].map(function () { return ctx.line(0, 0, 0, 0, { color: ctx.alpha('amber', 0.7), sw: 1.4, parent: wb }); });
          function setK(k, only) {
            var x = X0 + k * DX;
            S.win.setAttribute('x', x - 6);
            S.kl.forEach(function (l, i) {
              l.setAttribute('x1', X0 + (k + i) * DX + CW / 2); l.setAttribute('y1', Y0 + 82);   /* start below the x labels */
              l.setAttribute('x2', X0 + (k + 2) * DX + CW / 2); l.setAttribute('y2', 752);
            });
            S.outCells.forEach(function (c, j) { c.setAttribute('fill', (only ? j === k : j <= k) ? ctx.alpha('lime', 0.4) : ctx.alpha('lime', 0.06)); });
          }
          setK(3, true);
          S.f1 = ctx.text(X0, 826, 'y_t = Σₖ Wₖ ∗ x_(t−k),  k = 0, 1, 2:  three frames in, one frame out', { size: 15, font: 'mono', color: 'white', parent: wb });
          return Promise.all([ctx.camera(762, 700, 1.5, 1100), ctx.reveal(wb, { dur: 700 })]).then(function () {
            return ctx.pulse(S.win, { color: 'amber', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: pad two frames at the front, slide the causal window */
            S.pads = ctx.group({ parent: wb });
            for (var p = 0; p < 2; p++) {
              ctx.rect(X0 + p * DX, Y0, CW, 52, { rx: 4, fill: 'rgba(255,255,255,0.02)', stroke: 'dim', sw: 1.2, dash: '4 4', parent: S.pads });
              ctx.text(X0 + p * DX + CW / 2, Y0 + 26, 'pad 0', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.pads });
            }
            S.f2 = ctx.text(X0, 850, 'causal pad: 2 frames in front, none behind  →  output t sees x_t, x_(t−1), x_(t−2)', { size: 13, font: 'mono', color: 'amber', parent: wb });
            S.outCells.forEach(function (c, j) {
              c.style.cursor = 'pointer';
              c.addEventListener('click', function () { if (!ctx.dead) setK(j); });
            });
            return Promise.all([ctx.reveal([S.pads, S.f2], { from: 'left' }), ctx.wait(500).then(function () {
              return ctx.tween(3600, function (p) { setK(Math.min(8, Math.floor(p * 9))); }, 'linear');
            })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: what a symmetric kernel would do */
            S.ghost = ctx.group({ parent: wb });
            ctx.rect(X0 + 5 * DX - 6, Y0 - 14, 2 * DX + CW + 12, 66, { rx: 8, stroke: 'red', sw: 1.6, dash: '6 5', parent: S.ghost });
            ctx.text(X0 + 7 * DX + CW / 2 + 60, Y0 - 24, '✗ symmetric pad: y4 would read x5 (future)', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: S.ghost });
            S.ghost.setAttribute('opacity', 0);
            setK(4, true);
            return ctx.fade(S.ghost, 1, 400).then(function () { return ctx.wait(1000); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the first frame stands alone */
            setK(0, true);
            S.f3 = ctx.text(X0, 874, 'y₀ sees only x₀ (the two pads are zeros): an image is a 1-frame video.  Stride 2 on x1..x(T−1): 121 → 61 → 31', { size: 13, font: 'mono', color: 'lime', parent: wb });
            return Promise.all([ctx.fade(S.ghost, 0.35, 400), ctx.reveal(S.f3, { from: 'up' })]).then(function () { return ctx.pulse(S.outCells[0], { color: 'lime', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Chunks & feature cache',
        beats: [
          {
            say: 'Causality pays off in memory. The encoder processes the clip in chunks: first frame zero alone, then four frames at a time, producing one latent frame per chunk.',
            card: { tag: 'NUMBERS', title: 'Thirty-one chunks per clip', stat: { v: '31', u: 'chunks', l: '[x0], then 30 groups of 4 frames: each chunk yields exactly one latent frame' } },
            deep: '<pre># cache: last 2 frames per causal conv\ncache = {}\nz = [enc(x[0:1], cache)]        # z0\nfor k in range(1, 31):\n    z.append(enc(x[4k-3:4k+1], cache))\nz = cat(z, dim=t)  # 16×31×90×160</pre>' +
              '<p>The 4k+1 frame count falls out of this loop: one leading frame plus 30 groups of 4, each group producing one latent frame through the two ÷2 temporal stages.</p>'
          },
          {
            say: 'Each causal convolution keeps a fixed size cache, the last two frames of its input from the previous chunk, so the result is the same as encoding the whole clip at once.',
            card: { tag: 'TRY IT', title: 'Click a chunk, see its cache', body: 'Kernel 3 in time needs two past frames. Each chunk starts from the cached last two frames of the previous one instead of zero padding, so chunked output equals full-clip output.', more: '<p>A causal conv output at frame t needs inputs t, t−1, t−2. When a chunk starts at frame s, its first two outputs need frames s−2 and s−1 from the previous chunk: exactly what the cache holds. Per-frame operations (RMSNorm over channels, SiLU, per-frame attention) need no cache, so chunked and full outputs agree up to floating-point order.</p>' },
            deep: '<p>Every temporal conv is causal with k<sub>t</sub> = 3, and in Wan-VAE the norms (RMSNorm over channels) and mid-block attention act per frame. Replacing the zero padding by the cached 2 frames therefore makes chunked and full-sequence outputs <b>mathematically identical</b> (differences only from floating-point summation order). The decoder mirrors the scheme: 1 latent frame → 1 frame, then 1 → 4.</p>'
          },
          {
            say: 'Peak memory now depends on the size of a chunk, not on the length of the video. A four frame chunk at full resolution is thirty times smaller than the whole clip, and the caches add a fixed couple of gigabytes.',
            card: { tag: 'NUMBERS', title: 'Per-chunk tensor', stat: { v: '0.71 GB', l: 'stage-0 tensor for a 4-frame chunk, versus 21.4 GB for the whole clip; caches add about 2.6 GB, constant in clip length' } },
            deep: '<table><tr><th>Tensor (bf16)</th><th>Size</th></tr>' +
              '<tr><td>whole clip, stage 0, 96 × 121 × 720 × 1280</td><td>21.4 GB</td></tr>' +
              '<tr><td>one 4-frame chunk, stage 0</td><td>0.71 GB</td></tr>' +
              '<tr><td>feature cache: 2 frames × input of every causal conv</td><td>≈ 1.3 G values ≈ 2.6 GB, resident but constant</td></tr></table>' +
              '<p>Stage 0: 4 convs × 96 ch × 2 frames × 0.92 M pixels = 0.71 G values; stages 1–3 + mid ≈ 0.58 G.</p>'
          },
          {
            say: 'This is exact rather than approximate, as long as every operation is causal or acts per frame. VAEs that normalise across time need overlapping temporal tiles instead, and can flicker at the seams.',
            card: { tag: 'TRADE-OFF', title: 'Exact, but sequential', body: 'Chunking is exact only if every op is causal or per-frame. It runs in series over time, which is fine for a VAE under 1% of the FLOPs.' },
            deep: '<ul><li>Cost: the chunk loop is sequential in time (no temporal parallelism), fine for a VAE that is &lt;1% of the FLOPs.</li>' +
              '<li>Non-causal VAEs need overlapping temporal tiles and blending, and can show flicker at tile borders. VAEs with GroupNorm over time lack the exactness property.</li>' +
              '<li>The next step handles the other axis: when a single chunk is still too large at 1080p or 4K, the frame is split into spatial tiles.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'chunked causal encoding with a feature cache');
          ctx.camera(null, null, null, 900);
          ctx.focus(null);
          ctx.hud('chunk = 4 frames → 1 latent frame');
          var X0 = 80, FW = 1440 / 121;
          /* beat 1: the chunk partition */
          S.chTxt = ctx.text(X0, 596, '121 frames → 31 chunks: [x0] [x1..x4] [x5..x8] … [x117..x120]', { size: 13, font: 'mono', color: 'text', parent: wb });
          S.ch = []; S.lat = [];
          for (var k = 0; k < 31; k++) {
            var f0 = k === 0 ? 0 : 4 * k - 3, n = k === 0 ? 1 : 4;
            var x = X0 + f0 * FW;
            S.ch.push(ctx.rect(x + 1, 612, n * FW - 2, 34, { rx: 3, fill: ctx.alpha('cyan', 0.08), stroke: ctx.alpha('cyan', 0.5), sw: 1, parent: wb }));
            var lx = x + n * FW / 2 - 8;
            S.lat.push(ctx.rect(lx, 694, 16, 24, { rx: 2, fill: ctx.alpha('lime', 0.08), stroke: ctx.alpha('lime', 0.5), sw: 1, parent: wb }));
          }
          S.latTxt = ctx.text(X0, 740, 'latent frames z0 … z30 (one per chunk)', { size: 12, font: 'mono', color: 'lime', parent: wb });
          function setC(k) {
            S.ch.forEach(function (c, i) { c.setAttribute('fill', i < k ? ctx.alpha('cyan', 0.28) : (i === k ? ctx.alpha('amber', 0.45) : ctx.alpha('cyan', 0.08))); });
            S.lat.forEach(function (c, i) { c.setAttribute('fill', i <= k ? ctx.alpha('lime', 0.7) : ctx.alpha('lime', 0.08)); });
            var f0 = k === 0 ? 0 : 4 * k - 3, n = k === 0 ? 1 : 4;
            var cx = X0 + (f0 + n / 2) * FW;
            S.encArrow.setAttribute('x1', cx); S.encArrow.setAttribute('x2', cx);
            ctx.place(S.cache, X0 + f0 * FW, 0);
            S.cache.setAttribute('opacity', k === 0 ? 0 : 1);
            if (S.chInfo) {
              S.chInfo.textContent = k === 0 ? 'chunk 0 · x0 alone · cache empty (zero padding)'
                : (k === 1 ? 'chunk 1 · x1..x4 · cache = pad, x0'
                  : 'chunk ' + k + ' · x' + f0 + '..x' + (f0 + 3) + ' · cache = x' + (f0 - 2) + ', x' + (f0 - 1));
            }
          }
          return Promise.all([
            ctx.reveal([S.chTxt, S.latTxt], { stagger: 150 }),
            ctx.reveal(S.ch, { from: 'up', dist: 10, stagger: 25, delay: 200 }),
            ctx.reveal(S.lat, { from: 'up', dist: 10, stagger: 25, delay: 500 })
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: sweep with the two-frame cache */
            S.cache = ctx.group({ parent: wb });
            ctx.rect(-36, 656, 52, 24, { rx: 5, fill: ctx.alpha('amber', 0.2), stroke: 'amber', sw: 1.4, parent: S.cache });
            ctx.text(-10, 668, 'cache', { size: 11, font: 'mono', weight: 600, color: 'amber', anchor: 'middle', parent: S.cache });
            ctx.place(S.cache, X0 + FW, 0);
            S.encArrow = ctx.line(0, 648, 0, 690, { color: 'lime', sw: 1.6, arrow: true, parent: wb });
            S.chInfo = ctx.text(700, 596, '', { size: 13, font: 'mono', weight: 600, color: 'amber', parent: wb });
            setC(0);
            return ctx.wait(400).then(function () {
              return ctx.tween(4200, function (p) { setC(Math.min(30, Math.floor(p * 31))); }, 'linear');
            }).then(function () {
              /* the finished sweep becomes a control: click any chunk to see which frames it reads from the cache */
              S.ch.forEach(function (c, k) {
                c.style.cursor = 'pointer';
                c.addEventListener('click', function () { if (!ctx.dead) setC(k); });
              });
              var hint = ctx.text(1520, 596, 'click any chunk ▸', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: wb });
              return ctx.reveal(hint, { from: 'left' });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the memory bars */
            var mem = [['whole clip · stage-0 tensor', 21.4, 'red'], ['4-frame chunk · stage-0 tensor', 0.71, 'lime'], ['resident feature cache (all convs)', 2.6, 'amber']];
            var mg = ctx.group({ parent: wb });
            var bars = mem.map(function (m, i) {
              var y = 768 + i * 34;
              ctx.text(420, y + 12, m[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: mg });
              var b = ctx.rect(432, y, Math.max(4, 700 * m[1] / 21.4), 24, { rx: 4, fill: ctx.alpha(m[2], 0.4), stroke: m[2], sw: 1, parent: mg });
              ctx.text(432 + Math.max(4, 700 * m[1] / 21.4) + 10, y + 12, (m[1] >= 1 ? m[1].toFixed(1) : m[1].toFixed(2)) + ' GB' + (i === 2 ? ' (≈)' : ''), { size: 13, font: 'mono', color: m[2], parent: mg });
              var w = parseFloat(b.getAttribute('width'));
              b.setAttribute('width', 0);
              return { b: b, w: w };
            });
            var t1 = ctx.text(1270, 790, 'peak memory ∝ chunk,', { size: 14, font: 'mono', color: 'lime', parent: mg });
            var t2 = ctx.text(1270, 814, 'not ∝ video length', { size: 14, font: 'mono', color: 'lime', parent: mg });
            return Promise.all([ctx.reveal(mg, { delay: 100 })].concat(bars.map(function (o, i) {
              return ctx.animate(o.b, { width: [0, o.w] }, 700, 'out', 400 + i * 250);
            })));
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: exact for causal ops, not for time-wise normalisation */
            var cg = ctx.group({ parent: wb });
            var c1 = ctx.label(520, 742, '✓ causal conv + per-frame norm: chunked = full, exactly', { color: 'lime', size: 12, anchor: 'start', w: 440, parent: cg });
            var c2 = ctx.label(1000, 742, '✗ time-wise GroupNorm: overlapped tiles, flicker risk', { color: 'amber', size: 12, anchor: 'start', w: 460, parent: cg });
            return ctx.reveal([c1, c2], { from: 'up', stagger: 250 });
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Spatial tiling',
        beats: [
          {
            say: 'Time is handled by chunks; space is handled by tiles. At ten eighty p and beyond, even one chunk at full resolution strains memory, especially on smaller GPUs, so the decoder works on overlapping spatial tiles.',
            card: { tag: 'HOW IT WORKS', title: '256-pixel tiles, 25% overlap', body: 'A 1080p latent (135 × 240) becomes a 6 × 10 grid of 32 × 32 latent tiles at stride 24: about 60 tiles per chunk.' },
            deep: '<p>Typical settings (diffusers-style): 256-px tiles = 32 × 32 latents, 25% overlap, linear ramps. For a 1080p latent (135 × 240):</p>' +
              '<div class="eq">rows = ⌈(135 − 32)/24⌉ + 1 = 6,   cols = ⌈(240 − 32)/24⌉ + 1 = 10  →  60 tiles per chunk</div>' +
              '<p>Stride 24 = 32 − 8, so neighbouring tiles overlap by 8 latent pixels (64 pixels of output). The three-by-two grid on the stage is a schematic of that.</p>'
          },
          {
            say: 'Each tile is decoded independently. Stitch them with a hard cut and you would see seams, because a convolutional decoder near a tile border sees different context than it would in the full frame.',
            card: { tag: 'PITFALL', title: 'Hard cuts show seams', body: 'Normalisation statistics and convolution context differ at tile borders, so independently decoded tiles disagree at the edge.' },
            deep: '<p>Receptive field matters: GroupNorm statistics and the mid-block attention see only the tile, and zero padding at tile borders differs from the true neighbouring content. The resulting brightness and texture mismatch is small, but the eye is very sensitive to a straight line across a smooth region such as the ice horizon.</p>' +
              '<p>Some VAEs replace GroupNorm with per-frame or per-channel norms to make tiling more exact.</p>'
          },
          {
            say: 'In the overlap, the two results are cross faded with linear ramps whose weights add up to one, so the seam disappears.',
            card: { tag: 'HOW IT WORKS', title: 'Linear ramps that sum to one', body: '<code>x̂ = Σ wᵢ·D(zᵢ) / Σ wᵢ</code> with each weight ramping 1 → 0 across the overlap: a cross-fade with no visible edge.' },
            deep: '<div class="eq">x̂(p) = Σ<sub>i</sub> w<sub>i</sub>(p)·D(z<sub>tile i</sub>)(p) / Σ<sub>i</sub> w<sub>i</sub>(p),   w<sub>i</sub> = linear ramp to 0 across the overlap</div>' +
              '<p>Normalising by Σ w<sub>i</sub> makes the blend exact where three or four tiles meet at a corner. Large tiles with generous overlap look best; the trade-off is compute, next.</p>'
          },
          {
            say: 'Overlap costs extra compute, about one point eight times the decoder work, but the tiles are independent, so they spread across all the GPUs that just ran the transformer.',
            card: { tag: 'NUMBERS', title: 'The price of overlap', stat: { v: '1.8×', l: 'decoder FLOPs from 25% overlap on both axes, (32/24)² per tile; tiles are independent and parallel' } },
            deep: '<ul><li>Overlap costs compute: 25% overlap in both axes ≈ 1.8× decoder FLOPs (4/3 per axis).</li>' +
              '<li>Temporal tiling (for non-causal VAEs) uses the same blend along time.</li>' +
              '<li>Decode is embarrassingly parallel across tiles, so it can be spread over the same 8 GPUs that ran the DiT (sequence-parallel VAE decode in xDiT-style serving stacks).</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'overlapping spatial tiles with linear blending');
          ctx.focus([wb, S.div], 0.3);
          ctx.hud('1080p latent 135×240 → ~60 tiles');
          var F = { x: 80, y: 592, w: 480, h: 270 };
          /* beat 1: the frame and its tiles */
          var bg = ctx.group({ parent: wb });
          miniFrame(ctx, bg, F.x, F.y, F.w, F.h, 0.4);
          var tiles = [];
          for (var r = 0; r < 2; r++) for (var c = 0; c < 3; c++) tiles.push([F.x + c * 148, F.y + r * 120, 184, 150]);
          var cols = ['cyan', 'violet', 'amber', 'lime', 'pink', 'teal'];
          S.tiles = tiles.map(function (t, i) {
            var rr = ctx.rect(t[0] + 1, t[1] + 1, t[2] - 2, t[3] - 2, { rx: 4, fill: ctx.alpha(cols[i], 0.13), stroke: cols[i], sw: 1.6, parent: wb });
            rr.setAttribute('opacity', 0);
            return rr;
          });
          var fl = ctx.group({ parent: wb });
          ctx.text(F.x + F.w + 12, F.y + 12, '1080p frame', { size: 12, font: 'mono', color: 'dim', parent: fl });
          ctx.text(F.x + F.w + 12, F.y + 32, '(schematic 3×2', { size: 12, font: 'mono', color: 'dim', parent: fl });
          ctx.text(F.x + F.w + 12, F.y + 50, ' of ~60 tiles)', { size: 12, font: 'mono', color: 'dim', parent: fl });
          return Promise.all([
            ctx.reveal(bg, { opacity: 0.55 }),
            ctx.reveal(fl, { delay: 200 }),
            ctx.wait(400).then(function () {
              return S.tiles.reduce(function (p, t) { return p.then(function () { return ctx.fade(t, 1, 380); }); }, Promise.resolve());
            })
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: what a hard cut looks like */
            var SX = 1110, SW = 420;
            S.seam = ctx.group({ parent: wb });
            for (var i = 0; i < 42; i++) {
              var u = i / 41, base = 0.35 + 0.35 * u;
              var off = u < 0.5 ? 0.12 : -0.12;
              ctx.rect(SX + i * SW / 42, 620, SW / 42 + 0.5, 60, { rx: 0, fill: ctx.cmap('cyan', base + off), parent: S.seam });
            }
            ctx.text(SX, 608, 'hard cut between tiles: visible seam', { size: 13, font: 'mono', color: 'red', parent: S.seam });
            ctx.line(SX + SW / 2, 614, SX + SW / 2, 686, { color: 'red', sw: 1.2, dash: '3 3', parent: S.seam });
            return ctx.reveal(S.seam, { from: 'right' }).then(function () { return ctx.pulse(S.seam, { color: 'red', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: blend ramps */
            var PX = 720, PY = 612, PW = 340, PH = 120, SX = 1110, SW = 420;
            var rg = ctx.group({ parent: wb });
            ctx.text(PX, 598, 'blend weights across one overlap', { size: 12, font: 'mono', color: 'dim', parent: rg });
            ctx.line(PX, PY + PH, PX + PW, PY + PH, { color: 'faint', parent: rg });
            ctx.rect(PX + 120, PY, 100, PH, { rx: 0, fill: ctx.alpha('white', 0.05), parent: rg });
            ctx.poly([[PX, PY], [PX + 120, PY], [PX + 220, PY + PH]], { stroke: 'cyan', closed: false, sw: 2.2, parent: rg });
            ctx.poly([[PX + 120, PY + PH], [PX + 220, PY], [PX + PW, PY]], { stroke: 'violet', closed: false, sw: 2.2, parent: rg });
            ctx.text(PX + 20, PY + 16, 'tile A', { size: 12, font: 'mono', color: 'cyan', parent: rg });
            ctx.text(PX + PW - 60, PY + 16, 'tile B', { size: 12, font: 'mono', color: 'violet', parent: rg });
            ctx.text(PX + 170, PY + PH + 16, 'overlap', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: rg });
            ctx.text(PX, 790, 'w_A + w_B = 1 everywhere', { size: 13, font: 'mono', color: 'text', parent: rg });
            var sg = ctx.group({ parent: wb });
            for (var i = 0; i < 42; i++) {
              var u = i / 41, base = 0.35 + 0.35 * u;
              var off = 0.12 * (1 - 2 * ctx.clamp((u - 0.4) / 0.2, 0, 1));
              ctx.rect(SX + i * SW / 42, 740, SW / 42 + 0.5, 60, { rx: 0, fill: ctx.cmap('cyan', base + off), parent: sg });
            }
            ctx.text(SX, 728, 'linear cross-fade: seamless', { size: 13, font: 'mono', color: 'lime', parent: sg });
            return Promise.all([ctx.reveal(rg, { from: 'up' }), ctx.reveal(sg, { from: 'right', delay: 300 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the price of the overlap */
            var ov = ctx.group({ parent: wb });
            [0, 1].forEach(function (c) { ctx.rect(F.x + c * 148 + 148, F.y, 36, F.h, { rx: 0, fill: ctx.alpha('white', 0.14), stroke: ctx.alpha('white', 0.6), sw: 1, dash: '3 3', parent: ov }); });
            ctx.rect(F.x, F.y + 120, F.w, 30, { rx: 0, fill: ctx.alpha('white', 0.1), stroke: ctx.alpha('white', 0.5), sw: 1, dash: '3 3', parent: ov });
            var tx = ctx.group({ parent: wb });
            ctx.text(720, 816, '256-px tiles · 25% overlap', { size: 13, font: 'mono', color: 'text', parent: tx });
            ctx.text(720, 842, '≈ 1.8× decoder FLOPs · tiles decode in parallel', { size: 13, font: 'mono', color: 'amber', parent: tx });
            return Promise.all([ctx.reveal(ov, {}), ctx.reveal(tx, { from: 'up', delay: 300 })]).then(function () { return ctx.pulse(ov, { color: 'white', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Training losses',
        beats: [
          {
            say: 'How is such a VAE trained? Reconstruct the input and penalise the difference in several ways. An L one pixel loss gets colours and coarse structure right, but it is happy with blur.',
            card: { tag: 'HOW IT WORKS', title: 'L1 anchors colour and structure', body: 'Pixel losses average over plausible outputs (L2 the mean, L1 the median), so they get exposure and low frequencies right but blur texture.' },
            deep: '<div class="eq">L = ‖x − x̂‖<sub>1</sub> + λ<sub>p</sub>·LPIPS(x, x̂) + λ<sub>kl</sub>·KL( q(z|x) ‖ N(0, I) ) + λ<sub>adv</sub>·L<sub>GAN</sub>(D(x̂))</div>' +
              '<ul><li><b>L1</b> (sometimes + L2): the L2 optimum is the conditional mean and the L1 optimum the conditional median; when several sharp reconstructions are plausible both return a blurry blend. They anchor colour, exposure and low frequencies and give a stable gradient early in training.</li></ul>'
          },
          {
            say: 'A perceptual LPIPS loss compares deep network features instead of pixels, and restores texture that the pixel loss smooths away.',
            card: { tag: 'HOW IT WORKS', title: 'LPIPS restores texture', body: 'Distance between normalised VGG or AlexNet activations, calibrated on human similarity judgements, applied per frame.' },
            deep: '<ul><li><b>LPIPS</b>: distance between normalised VGG/AlexNet activations (per frame), with layer weights calibrated on human two-alternative-forced-choice judgements (Zhang et al., 2018). It penalises differences a viewer notices, such as texture, rather than differences in exact pixel values.</li></ul>' +
              '<p>Video VAEs typically apply it to random frames of the clip rather than to every frame, which keeps memory in check.</p>'
          },
          {
            say: 'A tiny KL term keeps the latent smooth and bounded, so it is well behaved as input to the diffusion model. The weight is so small that the VAE is almost a plain autoencoder.',
            card: { tag: 'NUMBERS', title: 'A very weak KL term', stat: { v: '10⁻⁶', u: 'KL weight', l: 'typical λ_kl: the VAE is almost an autoencoder; the term only bounds and smooths the latent' }, more: '<p>Per latent element KL(q(z | x) ‖ N(0, I)) = ½ (μ² + σ² − 1 − log σ²). With λ<sub>kl</sub> ≈ 10⁻⁶ this is a soft penalty on latent magnitude and variance, not a real prior: the latent stays far from N(0, I), which is why it is normalised per channel before diffusion.</p>' },
            deep: '<ul><li><b>KL</b>: λ<sub>kl</sub> ≈ 10⁻⁶. Its role is to keep latents bounded and smooth, not to match a prior; latents are then scaled or normalised (per-channel mean/std) before diffusion.</li></ul>' +
              '<p>A large KL weight would force the posterior toward N(0, I) and destroy detail (posterior collapse); a zero weight leaves latents with arbitrary scale and sharp irregularities that the DiT struggles to model.</p>'
          },
          {
            say: 'And a three dimensional patch discriminator, switched on later in training, pushes the decoder toward crisp, realistic detail and stable motion.',
            card: { tag: 'HOW IT WORKS', title: 'A 3D PatchGAN sharpens motion', body: 'A spatiotemporal discriminator, enabled after reconstructions stabilise, removes blur and flicker with a hinge loss and adaptive weight.' },
            deep: '<ul><li><b>GAN</b>: 3D (spatiotemporal) PatchGAN or StyleGAN-style discriminator with hinge loss; enabled after reconstructions stabilise. Removes blur and temporal flicker. The weight is often set adaptively, λ<sub>adv</sub> = ‖∇<sub>L</sub>L<sub>rec</sub>‖ / (‖∇<sub>L</sub>L<sub>GAN</sub>‖ + δ) at the decoder’s last layer L (Esser et al., 2021).</li></ul>' +
              '<p>The exact mix varies by model: GAN terms are standard in MAGVIT-v2-style and CogVideoX-style tokenizers, and not every open video VAE reports one.</p>' +
              '<p>Training recipe: images first (low res), then short low-res videos, then long high-res clips; image and video batches mixed throughout thanks to causality. Reported reconstruction for 4×8×8×16 video VAEs is typically in the low-to-mid 30s dB PSNR at 720p.</p>' +
              '<div class="note">Thumbnails on the right are illustrative renderings of each failure mode, not model outputs.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'reconstruction objective: four terms, four jobs');
          ctx.focus([wb, S.div], 0.3);
          ctx.hud('L1 + LPIPS + KL + GAN');
          var defs = ctx.el('defs', {}, wb);
          var f1 = ctx.el('filter', { id: 'vae-blur-6', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
          ctx.el('feGaussianBlur', { stdDeviation: 3.2 }, f1);
          var f2 = ctx.el('filter', { id: 'vae-blur-6b', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
          S.blur6 = ctx.el('feGaussianBlur', { stdDeviation: 3.2 }, f2);
          /* mini pipeline */
          var pipe = ctx.group({ parent: wb });
          miniFrame(ctx, pipe, 80, 600, 96, 60, 0.3);
          ctx.text(128, 676, 'x', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: pipe });
          ctx.node({ x: 262, y: 630, w: 110, h: 46, title: 'Encoder', color: 'lime', titleSize: 14, parent: pipe, kind: 'box' });
          S.zc = cube(ctx, { cx: 410, cy: 632, w: 36, h: 30, d: 12, color: 'amber', parent: pipe, n: 4, mosaic: latentMosaic(8, ctx) });
          ctx.text(410, 676, 'z ~ q(z|x)', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: pipe });
          ctx.node({ x: 560, y: 630, w: 110, h: 46, title: 'Decoder', color: 'lime', titleSize: 14, parent: pipe, kind: 'box' });
          miniFrame(ctx, pipe, 660, 600, 96, 60, 0.3).setAttribute('filter', 'url(#vae-blur-6b)');
          ctx.text(708, 676, 'x_rec', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: pipe });
          [[176, 207], [317, 386], [436, 505], [615, 656]].forEach(function (a) { ctx.line(a[0], 630, a[1], 630, { color: 'dim', sw: 1.5, arrow: true, parent: pipe }); });
          var terms = [
            ['L1  ‖x − x_rec‖₁', 'colour, exposure, low freq', 'cyan'],
            ['LPIPS', 'deep-feature distance → texture', 'violet'],
            ['KL · λ ≈ 1e-6', 'smooth, bounded latent', 'amber'],
            ['GAN (3D PatchGAN)', 'sharp detail, no flicker', 'pink']
          ];
          function termRow(i) {
            var t = terms[i], y = 712 + i * 34, g = ctx.group({ parent: wb });
            ctx.label(80, y, t[0], { color: t[2], size: 13, anchor: 'start', w: 200, parent: g });
            ctx.text(296, y, t[1], { size: 13, font: 'mono', color: 'text', parent: g });
            return ctx.reveal(g, { from: 'left', delay: 200 });
          }
          function recon(i) {
            var R = [['input', 'lime', null], ['L1 only: blurry', 'cyan', 'url(#vae-blur-6)'], ['+ LPIPS + GAN: sharp', 'pink', null]][i];
            var g = ctx.group({ parent: wb });
            var x = 880 + i * 222, y = 610;
            var fr = miniFrame(ctx, g, x, y, 200, 120, 0.35);
            if (R[2]) fr.setAttribute('filter', R[2]);
            ctx.rect(x, y, 200, 120, { rx: 2, stroke: R[1], sw: 1.6, parent: g });
            ctx.text(x + 100, y + 142, R[0], { size: 13, font: 'mono', color: R[1], anchor: 'middle', parent: g });
            return ctx.reveal(g, { from: 'up', delay: 300 });
          }
          /* beat 1: L1 gives a blurry reconstruction */
          return Promise.all([ctx.reveal(pipe, {}), termRow(0), recon(0), recon(1)]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: LPIPS sharpens texture */
            return Promise.all([termRow(1), ctx.animate(S.blur6, { stdDeviation: [3.2, 1.4] }, 1200, 'inOut', 300)]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: KL keeps z bounded */
            return Promise.all([termRow(2), ctx.pulse(S.zc, { color: 'amber', times: 2, dur: 600 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the discriminator */
            var f = ctx.text(560, 852, 'L = L1 + λp·LPIPS + λkl·KL + λadv·GAN', { size: 14, font: 'mono', weight: 600, color: 'white', anchor: 'middle', parent: wb });
            var cap = ctx.para(880, 800, [
              'L2 optimum = conditional mean, L1 = median: both blur.',
              'LPIPS and the discriminator restore the high frequencies',
              'the DiT relies on.'
            ], { size: 13, font: 'mono', color: 'text', lh: 24, parent: wb });
            return Promise.all([
              termRow(3), recon(2),
              ctx.reveal([f, cap], { from: 'up', delay: 500, stagger: 150 }),
              ctx.animate(S.blur6, { stdDeviation: [1.4, 0.01] }, 1800, 'inOut', 300)
            ]);
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Compression trade-off',
        beats: [
          {
            say: 'How much should a VAE compress? The common choice, four by eight by eight with sixteen channels, gives our clip about one hundred eleven thousand tokens.',
            card: { tag: 'NUMBERS', title: 'The common design', stat: { v: '48×', l: 'compression ratio t·h·w·3 / ch = 4·8·8·3 / 16 (Wan 2.1, HunyuanVideo, CogVideoX): 111,600 tokens per 5 s clip' } },
            deep: '<table><tr><th>VAE (t×h×w, channels)</th><th>ratio</th><th>tokens (5 s)</th></tr>' +
              '<tr><td>Wan 2.1 / Hunyuan / CogVideoX: 4×8×8, 16 ch</td><td>48×</td><td>111,600 (p 1×2×2, 720p)</td></tr></table>' +
              '<p>ratio = (t·h·w·3)/ch. This is the incumbent: three families converged on it, so most open DiTs, LoRAs and control adapters assume its latent grid and 16 channels.</p>' +
              '<p>The 16 channels are inherited from image models: SD3’s ablation raised the latent from 4 to 16 channels at 8× spatial compression and found better reconstruction, and better generation once the transformer was large enough to use the extra capacity.</p>'
          },
          {
            say: 'Wan two point two downsamples space sixteen fold along each side and uses forty eight channels. LTX Video reaches one to one hundred ninety two, cutting tokens about eightfold and attention cost about sixtyfold.',
            card: { tag: 'NUMBERS', title: 'Attention cost falls with N²', stat: { v: '≈ 60×', l: 'less attention for LTX-Video (14,080 tokens) than for the 4×8×8 design (111,600); Wan 2.2 gets ≈ 16× with 27,280 tokens' } },
            deep: '<table><tr><th>VAE (t×h×w, channels)</th><th>ratio</th><th>tokens (5 s)</th></tr>' +
              '<tr><td>Wan 2.2 (TI2V-5B): 4×16×16, 48 ch</td><td>64×</td><td>27,280 (p 1×2×2, 1280×704)</td></tr>' +
              '<tr><td>LTX-Video: 8×32×32, 128 ch</td><td>192×</td><td>14,080 (p 1, 1280×704)</td></tr></table>' +
              '<p>Attention ∝ N²: Wan 2.2 needs ≈ 16× less, LTX ≈ 60× less than the 4×8×8 design for the same clip. Both are quoted at 1280×704 against a 1280×720 baseline; like for like (109,120 tokens for 4×8×8 at 704 rows) the ratios are 16.0× and 60×.</p>' +
              '<details><summary>Go deeper</summary><p>The per-token cost also changes: the DiT width does not shrink with the token count, so a 27,280-token clip costs roughly 4× less in the linear layers and 16× less in attention. What is lost is capacity per token: the baseline token holds 64 numbers for a 4×16×16 pixel block (3,072 raw values), a Wan 2.2 token holds 192 numbers for a 4×32×32 block (12,288 raw values), and an LTX token holds 128 numbers for 8×32×32 pixels (24,576 raw values), which is why its decoder also has to finish the last denoising step.</p></details>'
          },
          {
            say: 'But reconstruction gets harder, and high dimensional latents are harder to generate. More compression is not free.',
            card: { tag: 'TRADE-OFF', title: 'Reconstruction versus generation', body: 'Richer latents reconstruct better but form a higher-dimensional, less structured space. The DiT converges slower at fixed compute.', more: '<p>A d-channel latent gives the decoder more capacity per token, so reconstruction improves, but the diffusion model must fit a distribution over more dimensions per token with less semantic structure. VA-VAE (Yao et al.) measures this frontier and improves it with a vision-foundation-model alignment loss (using DINOv2 features) on the latent.</p>' },
            deep: '<p><b>The dilemma</b> (VA-VAE, Yao et al. 2025): raising latent channels improves reconstruction but makes the latent distribution higher-dimensional and less structured, so the diffusion model converges slower and generates worse at fixed compute. Aggressive spatial compression has the opposite problem: fewer values must carry the same detail, so reconstruction drops.</p>' +
              '<div class="note">The curve on the right is schematic (the qualitative trend reported across these papers), not measured data.</div>'
          },
          {
            say: 'Current remedies align the latent with vision foundation features, so it is easier to generate, and let the decoder finish the job, as LTX does with a last denoising step.',
            card: { tag: 'STATE OF THE ART', title: 'Make the latent easier to generate', body: 'VA-VAE and REPA-style alignment to vision-foundation features; LTX’s decoder also runs the last denoising step; DC-AE adds residual shortcuts.' },
            deep: '<ul><li>align latents with vision-foundation features (VA-VAE / REPA-style losses);</li>' +
              '<li>let the decoder finish the job: LTX’s decoder also performs the last denoising step, recovering detail lost by aggressive compression;</li>' +
              '<li>deep-compression AEs with residual shortcuts (DC-AE: 32–64× spatial for images).</li></ul>' +
              '<p>None of these is free: alignment needs an extra frozen encoder during VAE training, and a decoder that also denoises is a heavier decoder to run.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'more compression: fewer tokens, harder reconstruction and generation');
          ctx.focus([wb, S.div], 0.3);
          ctx.hud('111,600 → 27,280 → 14,080 tokens');
          var cx = [80, 420, 530, 600, 690, 1010];
          var rows = [
            ['Wan 2.1 · Hunyuan · CogVideoX', '4×8×8', '16', '48×', 111600, '1×', 'lime'],
            ['Wan 2.2 (TI2V-5B)', '4×16×16', '48', '64×', 27280, '≈ 1/16', 'cyan'],
            ['LTX-Video', '8×32×32', '128', '192×', 14080, '≈ 1/60', 'violet']
          ];
          function tableRow(i) {
            var r = rows[i], y = 630 + i * 50, g = ctx.group({ parent: wb });
            ctx.text(cx[0], y + 12, r[0], { size: 14, font: 'mono', weight: 600, color: r[6], parent: g });
            ctx.text(cx[1], y + 12, r[1], { size: 14, font: 'mono', color: 'text', parent: g });
            ctx.text(cx[2], y + 12, r[2], { size: 14, font: 'mono', color: 'text', parent: g });
            ctx.text(cx[3], y + 12, r[3], { size: 14, font: 'mono', color: 'text', parent: g });
            var w = 200 * r[4] / 111600;
            var b = ctx.rect(cx[4], y, w, 24, { rx: 4, fill: ctx.alpha(r[6], 0.4), stroke: r[6], sw: 1, parent: g });
            ctx.text(cx[4] + w + 8, y + 12, r[4].toLocaleString('en-US'), { size: 13, font: 'mono', color: r[6], parent: g });
            ctx.text(cx[5], y + 12, r[5], { size: 14, font: 'mono', weight: 600, color: r[6], parent: g });
            b.setAttribute('width', 0);
            return Promise.all([ctx.reveal(g, { delay: 100 }), ctx.animate(b, { width: [0, w] }, 800, 'out', 400)]);
          }
          /* beat 1: header and the common design */
          var hg = ctx.group({ parent: wb });
          ['VAE', 't×h×w', 'ch', 'ratio', 'tokens for our 5 s clip', 'attention'].forEach(function (h, i) { ctx.text(cx[i], 596, h, { size: 12, font: 'mono', weight: 600, color: 'dim', parent: hg }); });
          var f1 = ctx.text(80, 800, 'ratio = t·h·w·3 / ch   ·   Wan 2.2 and LTX at 1280×704   ·   attention ∝ N²', { size: 12, font: 'mono', color: 'dim', parent: wb });
          return Promise.all([ctx.reveal([hg, f1], { stagger: 150 }), tableRow(0)]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: more aggressive designs */
            return Promise.all([tableRow(1), ctx.wait(500).then(function () { return tableRow(2); })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the trade-off curves */
            var PX = 1110, PY = 600, PW = 400, PH = 200;
            var pg = ctx.group({ parent: wb });
            ctx.text(PX + PW, 590, 'schematic, not measured', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: pg });
            var rc = ctx.plot(PX, PY, PW, PH, function (x) { return 0.92 - 0.55 * x * x; }, { color: 'cyan', sw: 2.2, xLabel: 'compression →', yLabel: 'quality', parent: pg });
            var gc = ctx.plot(PX, PY, PW, PH, function (x) { return 0.35 + 0.9 * x - 1.05 * x * x; }, { color: 'amber', sw: 2.2, axes: false, parent: pg });
            ctx.text(PX + 60, PY + 50, 'reconstruction', { size: 12, font: 'mono', color: 'cyan', parent: pg });
            ctx.text(PX + 40, PY + PH - 14, 'generation @ fixed compute', { size: 12, font: 'mono', color: 'amber', parent: pg });
            var pk = gc.toPx(0.43, 0.35 + 0.9 * 0.43 - 1.05 * 0.43 * 0.43);
            var dot = ctx.circle(pk.x, pk.y, 5, { fill: 'amber', parent: pg, glow: true });
            var lab = ctx.text(pk.x, pk.y - 14, 'sweet spot', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: pg });
            S.dot7 = dot;
            return Promise.all([
              ctx.reveal(pg, {}),
              ctx.reveal([rc.curve, gc.curve], { from: 'draw', delay: 300, stagger: 300, dur: 1000 })
            ]).then(function () { return ctx.pulse(dot, { color: 'amber', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: remedies, as two pills that each push the sweet spot outward */
            var t1 = ctx.label(80, 832, 'LTX: the decoder also performs the final denoising step, recovering detail lost to 1:192', { size: 13, color: 'violet', anchor: 'start', parent: wb });
            var t2 = ctx.label(80, 862, 'VA-VAE / REPA: align latents with vision-foundation features so they are easier to generate', { size: 13, color: 'lime', anchor: 'start', parent: wb });
            return ctx.reveal([t1, t2], { from: 'left', stagger: 300 }).then(function () { return ctx.pulse(S.dot7, { color: 'lime', times: 2, dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Decode & recap',
        beats: [
          {
            say: 'After the diffusion transformer finishes, the decoder runs the pipeline in reverse. The sixteen channel latent goes in, and the first stages upsample it in time and space.',
            card: { tag: 'HOW IT WORKS', title: 'The encoder, mirrored', body: 'Widths 384-384-384-192-96; nearest-neighbour ×2 upsampling plus a causal conv; temporal upsampling 1 → 2 per stage after the first frame.' },
            deep: '<p>The decoder mirrors the encoder (Wan-VAE: widths 384-384-384-192-96, one extra res block per stage, nearest-neighbour ×2 upsampling + causal conv; temporal upsampling 1 → 2 per stage on frames after the first). Latent shapes go 16×31×90×160 → 384×31×90×160 → 384×61×180×320 → 192×121×360×640 → 96×121×720×1280 → RGB.</p>' +
              '<p>It is roughly 1.5× the encoder’s FLOPs (three residual blocks per stage instead of two, so about 9×10<sup>14</sup> against 6×10<sup>14</sup>), and it dominates VAE memory.</p>'
          },
          {
            say: 'Chunk by chunk and tile by tile, it expands back into one hundred and twenty one frames of pixels, ending at full resolution.',
            card: { tag: 'NUMBERS', title: 'Back to pixels', stat: { v: '121', u: 'frames', l: '31 latent frames: the first becomes 1 frame, each of the other 30 becomes 4' } },
            deep: '<p>Each latent frame after the first passes through two temporal upsampling stages (×2 each) and becomes 4 pixel frames; the very first latent frame stays a single pixel frame. That gives 1 + 30·4 = 121 frames, with the same 4k+1 rule as on the encoding side.</p>' +
              '<p>Spatially the grid grows 8× in each direction over three upsampling stages: 90×160 → 180×320 → 360×640 → 720×1280.</p>'
          },
          {
            say: 'It runs once per clip and costs a small fraction of the generation FLOPs, but it sets the memory peak, and its quality ceiling is the ceiling of the whole video model.',
            card: { tag: 'WHY IT MATTERS', title: 'A tiny FLOP share, the memory peak', body: 'Decode is ≈ 9 × 10¹⁴ FLOPs against 1.3 × 10¹⁸ for the DiT: about 0.1%. But it sets peak memory and the quality ceiling.' },
            deep: '<table><tr><th>Summary</th><th>Value</th></tr>' +
              '<tr><td>FLOPs share</td><td>decode ≈ 9×10¹⁴ vs DiT 1.3×10¹⁸: ≈ 0.1% of a 50-step, CFG clip, but the memory peak</td></tr>' +
              '<tr><td>memory tricks</td><td>chunked causal cache (time), overlapped tiles (space)</td></tr></table>' +
              '<div class="note">Serving: decode on the same GPUs right after the last denoising step (tiles spread across devices), or hand the latent to a separate decode pool so the DiT GPUs start the next job: a classic pipeline split in video-serving stacks.</div>'
          },
          {
            say: 'That is the whole chamber: four by eight by eight compression, causal chunks and tiles, and four losses. Next comes the transformer that lives in this latent space.',
            card: { tag: 'KEY IDEA', title: 'The VAE fixes the token budget', body: 'Sequence length, DiT size and attention cost all inherit its 4×8×8 or 4×16×16 choice. Reconstruction quality is a hard ceiling.' },
            deep: '<table><tr><th>Summary</th><th>Value</th></tr>' +
              '<tr><td>compression</td><td>4×8×8, 3 → 16 ch (48× by value)</td></tr>' +
              '<tr><td>our clip</td><td>334.5 M → 7.14 M values; 111,600 DiT tokens</td></tr>' +
              '<tr><td>causality</td><td>first frame alone; images = 1-frame videos</td></tr>' +
              '<tr><td>losses</td><td>L1 + LPIPS + tiny KL + 3D GAN</td></tr></table>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'the decoder: the same pipeline in reverse');
          ctx.focus(null);
          ctx.hud('7.14 M latents → 334.5 M pixels');
          var dec = [
            { cx: 330, w: 50, h: 28, d: 44, shape: '384×31×90×160' },
            { cx: 500, w: 72, h: 40, d: 44, shape: '384×61×180×320' },
            { cx: 690, w: 104, h: 58, d: 32, shape: '192×121×360×640' },
            { cx: 905, w: 150, h: 84, d: 22, shape: '96×121×720×1280' }
          ];
          var arrows = [[177, 279, 'conv'], [381, 438, '↑thw'], [562, 618, '↑thw'], [762, 815, '↑hw'], [995, 1066, 'head']];
          function mkDec(i) {
            var s = dec[i], g = ctx.group({ parent: wb });
            cube(ctx, { cx: s.cx, cy: 690, w: s.w, h: s.h, d: s.d, color: 'teal', parent: g });
            ctx.text(s.cx, 760, s.shape, { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: g });
            return g;
          }
          function mkArrow(i) {
            var a = arrows[i], g = ctx.group({ parent: wb });
            ctx.line(a[0], 690, a[1], 690, { color: 'dim', sw: 1.5, arrow: true, parent: g });
            ctx.text((a[0] + a[1]) / 2, 674, a[2], { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: g });
            return g;
          }
          /* beat 1: the latent and the first two decoder stages */
          var zg = ctx.group({ parent: wb });
          cube(ctx, { cx: 140, cy: 690, w: 56, h: 32, d: 10, color: 'lime', parent: zg, n: 5, mosaic: latentMosaic(3, ctx) });
          ctx.text(140, 740, '16×31×90×160', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: zg });
          var d0 = mkDec(0), d1 = mkDec(1), a0 = mkArrow(0), a1 = mkArrow(1);
          return Promise.all([
            ctx.reveal(zg, { from: 'left' }),
            ctx.reveal(a0, { delay: 300 }), ctx.reveal(d0, { from: 'scale', s0: 0.5, delay: 500, dur: 450 }),
            ctx.reveal(a1, { delay: 1000 }), ctx.reveal(d1, { from: 'scale', s0: 0.5, delay: 1200, dur: 450 })
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the last stages and the frames */
            var d2 = mkDec(2), d3 = mkDec(3), a2 = mkArrow(2), a3 = mkArrow(3), a4 = mkArrow(4);
            S.out = ctx.group({ parent: wb });
            for (var i = 5; i >= 0; i--) miniFrame(ctx, S.out, 1080 + i * 12, 640 - i * 8, 170, 96, i / 5);
            ctx.text(1190, 770, '121 × 720 × 1280 × 3', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: S.out });
            return Promise.all([
              ctx.reveal(a2, { delay: 100 }), ctx.reveal(d2, { from: 'scale', s0: 0.5, delay: 300, dur: 450 }),
              ctx.reveal(a3, { delay: 800 }), ctx.reveal(d3, { from: 'scale', s0: 0.5, delay: 1000, dur: 450 }),
              ctx.reveal(a4, { delay: 1500 }), ctx.reveal(S.out, { from: 'left', delay: 1700, dur: 600 })
            ]).then(function () { return ctx.pulse(S.out, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: cost versus role */
            var pg = ctx.para(1345, 610, ['runs once per clip', '~0.1% of FLOPs', 'but the memory peak', 'and the quality ceiling'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: wb });
            var sh = ctx.group({ parent: wb });
            ctx.text(1345, 728, 'FLOPs per clip, to scale', { size: 12, font: 'mono', color: 'dim', parent: sh });
            ctx.text(1345, 756, 'DiT', { size: 12, font: 'mono', color: 'lime', parent: sh });
            ctx.rect(1396, 748, 136, 16, { rx: 3, fill: ctx.alpha('lime', 0.4), stroke: 'lime', sw: 1, parent: sh });
            ctx.text(1345, 782, 'VAE', { size: 12, font: 'mono', color: 'teal', parent: sh });
            ctx.rect(1396, 774, 2, 16, { rx: 0, fill: 'teal', parent: sh });
            ctx.text(1408, 782, '≈ 0.07%', { size: 12, font: 'mono', color: 'teal', parent: sh });
            return Promise.all([ctx.reveal(pg, { from: 'left' }), ctx.reveal(sh, { from: 'up', delay: 400 })]).then(function () { return ctx.pulse(S.out, { color: 'lime', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: recap chips */
            var chips = [['4×8×8 · 16 ch', 'lime'], ['causal: image = 1 frame', 'amber'], ['chunk cache (time)', 'cyan'], ['overlap tiles (space)', 'violet'], ['L1 + LPIPS + KL + GAN', 'pink']];
            var x = 80;
            S.chips = chips.map(function (c) {
              var ch = ctx.label(x, 848, c[0], { color: c[1], size: 12, anchor: 'start', parent: wb });
              x += ch.w + 14;
              return ch;
            });
            return ctx.reveal(S.chips, { from: 'up', stagger: 150, delay: 200 });
          });
        }
      }
    ]
  });
})();
