/* L2 — Video Model Serving. Why one 5 s 720p shot costs ~an H100-hour, and the systems stack that
 * brings it to seconds: sequence parallelism (Ulysses, Ring, USP), CFG parallelism, PipeFusion,
 * step caching, few-step students, cheaper attention, stage pools, tiled VAE, and the speedup ladder.
 * Beat format: every step is a sequence of beats; each beat has its own narration, callout card, deep-dive
 * chunk and animation segment (gated with ctx.beat(k)). */
(function () {
  var HG = ['cyan', 'blue', 'violet', 'magenta', 'pink', 'orange', 'amber', 'lime'];

  function hide(list) { [].concat(list).forEach(function (e) { if (e) e.setAttribute('opacity', 0); }); }
  function heading(ctx, G, x, y, title, sub, col) {
    ctx.text(x, y, title, { size: 19, font: 'display', weight: 700, color: 'white', parent: G });
    if (sub) ctx.text(x, y + 25, sub, { size: 12.5, font: 'mono', color: col || 'dim', parent: G });
  }
  function clearPanel(ctx, S) {
    if (S.panel) ctx.remove(S.panel, 380);
    S.panel = ctx.group();
    return S.panel;
  }
  /* shot pipeline strip in the free top band (x > 860 keeps the title block clear) */
  function buildStrip(ctx, S) {
    if (S.strip) return;
    var G = S.strip = ctx.group();
    ctx.text(884, 108, 'SHOT', { size: 11, font: 'mono', color: 'dim', parent: G });
    var items = [['TEXT ENC', 'amber', 966], ['DiT × 100 fwd', 'lime', 1104], ['VAE', 'lime', 1214], ['ENCODE', 'orange', 1300]];
    S.stripChips = items.map(function (it) { return ctx.label(it[2], 108, it[0], { color: it[1], size: 11, parent: G }); });
    ctx.line(1010, 108, 1038, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G });
    ctx.line(1168, 108, 1190, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G });
    ctx.line(1240, 108, 1268, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G });
    ctx.reveal(G, { from: 'down' });
  }
  function setStrip(S, on) {
    S.stripChips.forEach(function (c, i) { c.setAttribute('opacity', on.indexOf(i) >= 0 ? 1 : 0.28); });
  }
  function gpuChip(ctx, parent, cx, cy, label, col, w, h) {
    var g = ctx.group({ parent: parent });
    w = w || 96; h = h || 34;
    ctx.rect(cx - w / 2, cy - h / 2, w, h, { rx: 5, fill: ctx.alpha(col, 0.12), stroke: col, sw: 1.2, parent: g });
    ctx.icon('gpu', cx - w / 2 + 16, cy, 18, col, { parent: g });
    ctx.text(cx - w / 2 + 30, cy, label, { size: 12, font: 'mono', weight: 600, color: 'white', parent: g });
    g.box = { x: cx - w / 2, y: cy - h / 2, w: w, h: h, cx: cx, cy: cy, l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
    g.color = ctx.color(col);
    return g;
  }

  Atlas.register({
    id: 'video-serving',
    refs: [
      'Jacobs et al., <i>DeepSpeed Ulysses: System Optimizations for Enabling Training of Extreme Long Sequence Transformer Models</i>, arXiv 2309.14509, 2023',
      'Liu, Zaharia &amp; Abbeel, <i>Ring Attention with Blockwise Transformers for Near-Infinite Context</i>, arXiv 2310.01889, 2023',
      'Fang &amp; Zhao, <i>USP: A Unified Sequence Parallelism Approach for Long Context Generative AI</i>, 2024',
      'Fang et al., <i>xDiT: an Inference Engine for Diffusion Transformers (DiTs) with Massive Parallelism</i>, 2024; Fang et al., <i>PipeFusion: Patch-level Pipeline Parallelism for Diffusion Transformers Inference</i>, NeurIPS 2025',
      'Zhang et al., <i>SageAttention: Accurate 8-Bit Attention for Plug-and-play Inference Acceleration</i>, ICLR 2025',
      'Zhang et al., <i>Fast Video Generation with Sliding Tile Attention</i>, ICML 2025',
      'Xi et al., <i>Sparse VideoGen: Accelerating Video Diffusion Transformers with Spatial-Temporal Sparsity</i>, ICML 2025',
      'Liu et al., <i>Timestep Embedding Tells: It\'s Time to Cache for Video Diffusion Model</i> (TeaCache), CVPR 2025; Lv et al., <i>FasterCache: Training-Free Video Diffusion Model Acceleration with High Quality</i>, ICLR 2025; Zhang et al., <i>SageAttention2: Efficient Attention with Thorough Outlier Smoothing and Per-thread INT4 Quantization</i>, ICML 2025',
      'Yin et al., <i>From Slow Bidirectional to Fast Autoregressive Video Diffusion Models</i> (CausVid), CVPR 2025',
      'Huang et al., <i>Self Forcing: Bridging the Train-Test Gap in Autoregressive Video Diffusion</i>, NeurIPS 2025',
      'Yin et al., <i>Improved Distribution Matching Distillation for Fast Image Synthesis</i> (DMD2), NeurIPS 2024',
      'Lin et al., <i>Diffusion Adversarial Post-Training for One-Step Video Generation</i> (Seaweed-APT), ICML 2025',
      'Zheng et al., <i>Large Scale Diffusion Distillation via Score-Regularized Continuous-Time Consistency</i> (rCM), ICLR 2026',
      'Team Wan et al., <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'One shot, one bill',
        beats: [
          {
            say: 'The camera agent calls render shot for shot three of the fox trailer: five seconds of seven twenty p video. Serving this is nothing like serving text. First, a text encoder turns the prompt into embeddings, once, in milliseconds.',
            card: { tag: 'KEY IDEA', title: 'Nothing like serving text', body: 'One request occupies a GPU group for minutes. It is compute bound, cannot hide inside other users\' batches, and every second of it is billed.' },
            deep: '<p><b>The request</b>: <code>render_shot(prompt, refs, seed, 121 frames, 1280×720, 24 fps)</code>. The text encoder (umT5-XXL encoder, about 5.7B parameters of which about 4.6B outside the embedding table, 512 tokens) costs roughly 5 TFLOP per prompt: milliseconds on one H100, and cacheable per unique prompt.</p>' +
              '<p>Unlike LLM serving there is typically <b>one request per GPU group</b>. Batching across users cannot amortise weight reads because the workload is already compute-bound, so the levers are parallelism inside one job, fewer and cheaper forward passes, and pipelining the stages around it.</p>'
          },
          {
            say: 'Then a fourteen billion parameter diffusion transformer, the DiT, runs one hundred forward passes: fifty denoising steps, times two for classifier free guidance. Each pass looks at all one hundred eleven thousand six hundred latent tokens at once.',
            card: { tag: 'NUMBERS', title: 'Tokens in one shot', stat: { v: '111,600', u: 'tokens', l: '5 s at 24 fps and 720p: a 31 × 45 × 80 latent grid, seen by every one of the 100 passes' } },
            deep: '<div class="eq">N = ((121 − 1)/4 + 1) × (720/16) × (1280/16) = 31 × 45 × 80 = 111,600</div>' +
              '<p>The video VAE compresses 4× in time and 8× per spatial axis (16 latent channels), and the DiT patchifies 2 × 2, so one token covers 16 × 16 pixels × 4 frames. The Wan-14B-class DiT has d = 5120, 40 blocks, 40 heads × 128 and FFN width 13,824.</p>' +
              '<p>Each of the 50 steps evaluates the network twice, conditional and unconditional, for classifier-free guidance, so the 40-block network runs 100 times per shot.</p>'
          },
          {
            say: 'One transformer block over that sequence costs about three times ten to the fourteen operations. Forty blocks make one forward pass, guidance doubles it, and fifty steps bring the total to about one point three quintillion operations.',
            card: { tag: 'NUMBERS', title: 'The FLOP bill', stat: { v: '1.29×10¹⁸', u: 'FLOP', l: 'per 5 s shot: 40 blocks × 2 guidance × 50 steps × 3.2 × 10¹⁴ per block' },
              more: '<p>Per block: self-attention 4N²d = 2.55 × 10¹⁴ FLOP, plus linear layers 2·P<sub>blk</sub>·N ≈ 0.67 × 10¹⁴ (P<sub>blk</sub> ≈ 3.0 × 10⁸ parameters act on the latent tokens), total ≈ 3.2 × 10¹⁴. Times 40 blocks: 1.29 × 10¹⁶ per forward pass.</p>' },
            deep: '<p>Worked budget for a Wan-14B-class DiT (d = 5120, 40 blocks, 40 heads × 128, FFN 13,824) at N = 111,600 tokens:</p>' +
              '<table><tr><th>term</th><th>FLOPs</th></tr>' +
              '<tr><td>self-attention 4N²d · 40</td><td>1.02×10¹⁶ (79 %)</td></tr>' +
              '<tr><td>linear layers 2·P·N</td><td>2.67×10¹⁵ (21 %)</td></tr>' +
              '<tr><td><b>one forward</b></td><td><b>1.29×10¹⁶</b></td></tr>' +
              '<tr><td>× 2 CFG × 50 steps</td><td><b>1.29×10¹⁸</b></td></tr></table>' +
              '<p>Rule of thumb per block: linear layers cost 2 · P<sub>blk</sub> · N FLOPs, attention costs 4 · N² · d. The first is linear in the token count, the second quadratic, which is why video, with its 10<sup>5</sup> tokens, behaves so differently from a 4k-token chat prompt.</p>'
          },
          {
            say: 'Nearly all of it is the denoiser: about ninety nine percent of the GPU seconds, while the VAE decode and the encoder share the rest. And inside each pass, self attention takes almost four fifths of the work, because it grows with the square of the token count.',
            card: { tag: 'PITFALL', title: 'n squared is the villain', body: 'Double the clip length and attention cost quadruples; double the resolution in both directions and it grows sixteenfold. Linear layers only double or quadruple.' },
            deep: '<p>Contrast with LLM decode: this workload is <b>compute-bound</b> (attention over 10<sup>5</sup> tokens has arithmetic intensity in the thousands), <b>long-running</b> (minutes, not milliseconds), and has a single request per GPU group.</p>' +
              '<details><summary>Go deeper</summary><p>Attention and linear FLOPs are equal when 4N²d = 2P<sub>blk</sub>N, i.e. N = P<sub>blk</sub> / 2d ≈ 3.0 × 10⁸ / 10,240 ≈ 29,000 tokens. Above that, attention dominates: its share is 1 / (1 + P<sub>blk</sub> / 2Nd) = 79 % at N = 111,600, and would be 91 % at N = 300,000.</p></details>' +
              '<p><span class="muted">The text encoder costs about 5 TFLOP per prompt. VAE decode is only about 10<sup>15</sup> FLOP but runs low-MFU causal 3-D convolutions: on the order of 40 s on one GPU (about 1 % of the GPU-seconds, an estimate), and it is also the <i>memory</i> peak. NVENC is fixed-function hardware that the H100 does not have, so encoding runs on L4 or L40S-class GPUs.</span></p>'
          },
          {
            say: 'At forty percent utilisation of a nine hundred eighty nine teraflop H100, that is about fifty four minutes for one shot, and over five GPU hours for the six shot trailer. The serving target is previews in seconds, and finals well under a minute.',
            card: { tag: 'NUMBERS', title: 'Almost an hour of one GPU', stat: { v: '54 min', l: 'on one H100 at 40 % MFU: 1.29 × 10¹⁸ ÷ (989 TFLOP/s × 0.40) = 3,260 s' } },
            deep: '<div class="eq">t ≈ 1.29×10¹⁸ / (989×10¹² · 0.40) ≈ 3,260 s ≈ 54 H100-minutes</div>' +
              '<p>Six shots for the 30 s trailer ≈ 5.4 GPU-hours before any re-renders. That is the number the rest of this chamber attacks.</p>' +
              '<p><span class="muted">Chambers that quote Wan\'s native 16 fps and 81-frame setting use 21 × 45 × 80 = 75,600 tokens; by the same arithmetic that recipe costs about 27 GPU-minutes per shot.</span></p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'ONE SHOT, ONE BILL', 'render_shot(): 5 s · 24 fps · 1280×720 · 121 frames', 'red');
          S.req = ctx.node({ x: 140, y: 340, w: 180, h: 64, title: 'render_shot()', sub: 'Camera agent', icon: 'tool', color: 'magenta', titleSize: 14, subSize: 11, parent: G });
          S.te = ctx.node({ x: 390, y: 340, w: 190, h: 64, title: 'Text encoder', sub: 'umT5-XXL · 512 tok', icon: 'doc', color: 'amber', titleSize: 14, subSize: 11, parent: G });
          S.dit = ctx.node({ x: 720, y: 340, w: 300, h: 84, title: 'DiT denoiser', sub: '14B · 40 blocks · d = 5120', icon: 'film', color: 'lime', titleSize: 17, subSize: 12, parent: G });
          S.vae = ctx.node({ x: 1070, y: 340, w: 190, h: 64, title: 'VAE decode', sub: '31 → 121 frames', icon: 'layers', color: 'lime', titleSize: 14, subSize: 11, parent: G });
          S.enc = ctx.node({ x: 1350, y: 340, w: 190, h: 64, title: 'Encode', sub: 'L4 / L40S · NVENC', icon: 'film', color: 'orange', titleSize: 14, subSize: 11, parent: G });
          var links = [[S.req, S.te, 'magenta'], [S.te, S.dit, 'amber'], [S.dit, S.vae, 'lime'], [S.vae, S.enc, 'lime']].map(function (p) { return ctx.link(p[0], p[1], { from: 'r', to: 'l', color: p[2], parent: G }); });
          var loop = ctx.path('M820,298 C820,246 620,246 620,298', { stroke: 'lime', sw: 1.8, arrow: true, parent: G });
          var loopL = ctx.text(720, 234, '× 50 steps × 2 (CFG) = 100 forward passes', { size: 12.5, font: 'mono', color: 'lime', anchor: 'middle', parent: G });
          var tokT = ctx.text(720, 402, '121 frames → 31 × 45 × 80 = 111,600 latent tokens', { size: 12.5, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: G });
          /* GPU-seconds split (beat 4) */
          var SB = ctx.group({ parent: G });
          ctx.text(60, 432, 'WHERE THE GPU-SECONDS GO · 1 GPU, no tricks', { size: 12, font: 'mono', color: 'dim', parent: SB });
          var bx0 = 60, BW = 1480;
          [[0.0005, 'amber'], [0.982, 'lime'], [0.0125, 'violet'], [0.0005, 'orange']].forEach(function (s) {
            var w = Math.max(4, BW * s[0]);
            ctx.rect(bx0, 446, w - 2, 26, { rx: 3, fill: ctx.alpha(s[1], 0.45), stroke: s[1], sw: 1, parent: SB });
            bx0 += w;
          });
          ctx.text(760, 459, 'DiT denoising ≈ 99 % of the GPU-seconds', { size: 12.5, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: SB });
          ctx.text(60, 490, 'text encode + encode < 0.1 %', { size: 11.5, font: 'mono', color: 'dim', parent: SB });
          ctx.text(1540, 490, 'VAE decode ≈ 1 % (≈ 40 s on 1 GPU)', { size: 11.5, font: 'mono', color: 'violet', anchor: 'end', parent: SB });
          /* FLOP ladder (beat 3) */
          var LD = ctx.group({ parent: G });
          ctx.text(60, 526, 'THE FLOP BILL (log scale)', { size: 12, font: 'mono', color: 'dim', parent: LD });
          var rows = [['1 DiT block · n = 111,600', 3.23e14, '3.2×10¹⁴'], ['× 40 blocks = 1 forward', 1.29e16, '1.29×10¹⁶'], ['× 2 (CFG: cond + uncond)', 2.58e16, '2.6×10¹⁶'], ['× 50 denoising steps', 1.29e18, '1.29×10¹⁸ FLOP']];
          S.lbars = [];
          rows.forEach(function (r, i) {
            var y = 548 + i * 46;
            ctx.text(60, y + 13, r[0], { size: 13, font: 'mono', color: 'text', parent: LD });
            var w = (Math.log10(r[1]) - 13.5) / 5 * 540;
            var b = ctx.rect(330, y, w, 26, { rx: 4, fill: ctx.alpha(i === 3 ? 'red' : 'lime', 0.45), stroke: i === 3 ? 'red' : 'lime', sw: 1, parent: LD });
            var t = ctx.text(330 + w + 10, y + 13, r[2], { size: 13, font: 'mono', weight: 700, color: i === 3 ? 'red' : 'lime', parent: LD });
            S.lbars.push([b, w, t]);
          });
          /* inside one forward (beat 4) */
          var LD2 = ctx.group({ parent: G });
          ctx.text(60, 760, 'inside one forward:', { size: 12, font: 'mono', color: 'dim', parent: LD2 });
          ctx.rect(330, 748, 540 * 0.79, 24, { rx: 3, fill: ctx.alpha('lime', 0.4), stroke: 'lime', sw: 1, parent: LD2 });
          ctx.rect(330 + 540 * 0.79, 748, 540 * 0.21, 24, { rx: 3, fill: ctx.alpha('amber', 0.4), stroke: 'amber', sw: 1, parent: LD2 });
          ctx.text(330 + 540 * 0.395, 760, 'self-attention 4n²d · 79 %', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: LD2 });
          ctx.text(330 + 540 * 0.895, 760, 'linear 21 %', { size: 11.5, font: 'mono', color: 'white', anchor: 'middle', parent: LD2 });
          ctx.text(60, 806, 'n² is the villain: double the frames or the resolution and attention cost quadruples', { size: 12, font: 'mono', color: 'dim', parent: LD2 });
          /* the clock (beat 5) */
          var RC = ctx.group({ parent: G });
          ctx.text(1010, 540, '÷ (989 TFLOP/s BF16 × 40 % MFU)', { size: 12.5, font: 'mono', color: 'dim', parent: RC });
          ctx.icon('clock', 1030, 598, 40, 'red', { parent: RC });
          S.clock = ctx.text(1066, 598, '0 s', { size: 42, font: 'display', weight: 700, color: 'red', parent: RC });
          ctx.text(1010, 648, '≈ 54 H100-minutes per 5-second shot', { size: 14, font: 'mono', color: 'white', parent: RC });
          ctx.text(1010, 676, '× 6 shots in the trailer ≈ 5.4 GPU-hours', { size: 13, font: 'mono', color: 'text', parent: RC });
          ctx.text(1010, 716, 'serving target: previews in seconds,', { size: 13, font: 'mono', color: 'cyan', parent: RC });
          ctx.text(1010, 738, 'finals well under a minute per shot', { size: 13, font: 'mono', color: 'cyan', parent: RC });
          S.lbars.forEach(function (b) { b[0].setAttribute('width', 0); });
          hide([S.te, S.dit, S.vae, S.enc, links[0], links[1], links[2], links[3], loop, loopL, tokT, SB, LD2, RC]);
          hide(S.lbars.map(function (b) { return b[2]; })); hide([LD]);
          function grow() {
            return S.lbars.reduce(function (p, b) {
              return p.then(function () {
                ctx.reveal(b[0], { dur: 60 });
                return ctx.animate(b[0], { width: [0, b[1]] }, 450, 'out').then(function () { ctx.reveal(b[2], { dur: 250 }); });
              });
            }, Promise.resolve());
          }
          S.lbars.forEach(function (b) { b[0].setAttribute('opacity', 0); });
          /* beat 1: the request and the text encoder */
          return Promise.all([
            ctx.reveal(S.req, { from: 'scale' }),
            ctx.reveal(links[0], { from: 'draw', delay: 300 }),
            ctx.reveal(S.te, { from: 'left', delay: 500 })
          ]).then(function () { return ctx.packet(links[0], { color: 'magenta', dur: 500, label: 'prompt' }); })
            .then(function () { return ctx.pulse(S.te, { color: 'amber', dur: 600 }); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the DiT and its hundred passes */
            return Promise.all([
              ctx.reveal(links[1], { from: 'draw' }),
              ctx.reveal(S.dit, { from: 'scale', delay: 300 }),
              ctx.reveal(loop, { from: 'draw', delay: 800 }),
              ctx.reveal([loopL, tokT], { delay: 1100, stagger: 250 })
            ]).then(function () { return ctx.packet(links[1], { color: 'amber', dur: 450, label: 'c' }); })
              .then(function () { return ctx.packet(loop, { color: 'lime', dur: 900 }); })
              .then(function () { return ctx.pulse(tokT, { color: 'white', dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the FLOP ladder */
            ctx.reveal(LD, { delay: 0 });
            return ctx.wait(200).then(grow);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: where the GPU-seconds go, and n squared */
            ctx.hud('DiT ≈ 99 % of GPU time · attention 79 %');
            return Promise.all([
              ctx.reveal([S.vae, S.enc], { from: 'right', stagger: 150 }),
              ctx.reveal([links[2], links[3]], { from: 'draw', delay: 300, stagger: 200 }),
              ctx.reveal(SB, { from: 'up', delay: 600 })
            ]).then(function () { return ctx.reveal(LD2, { from: 'up' }); }).then(function () { return ctx.pulse(LD2, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: the clock */
            ctx.hud('1.29×10¹⁸ FLOP ≈ 54 H100-min per shot');
            return ctx.reveal(RC, { from: 'right' }).then(function () {
              return ctx.counter(S.clock, 0, 3260, 1400, function (v) { return Math.round(v).toLocaleString('en-US') + ' s'; });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Ulysses: all-to-all',
        beats: [
          {
            say: 'The first lever is to split one shot across eight GPUs. With DeepSpeed Ulysses, the token sequence is cut into eight equal shards, so each GPU owns about fourteen thousand tokens.',
            card: { tag: 'NUMBERS', title: 'A shard per GPU', stat: { v: '13,950', u: 'tokens / GPU', l: '111,600 latent tokens in 8 sequence shards; the 28 GB of BF16 weights are replicated on every GPU' } },
            deep: '<p>Sequence parallelism shards activations along the token axis: <code>X ∈ ℝ<sup>N×d</sup></code> becomes 8 shards of <code>[N/8, d] = [13,950, 5120]</code>. Everything token-local (patch embedding, QKV and output projections, MLP, LayerNorm and adaptive modulation) runs on the local shard with no communication.</p>' +
              '<p>Weights are <b>replicated</b>: every GPU holds the whole 14B model (28 GB in BF16, 14 GB in FP8). Sequence parallelism splits activations and FLOPs, not parameters.</p>'
          },
          {
            say: 'Each GPU computes queries, keys and values for its own tokens, for all forty heads. But attention needs every token to see every other token, so a local shard is not enough.',
            card: { tag: 'KEY IDEA', title: 'Attention is the global step', body: 'Projections, MLP and norms are token-local and parallelise for free. Attention couples all 111,600 tokens, so the split has to change.' },
            deep: '<p>After the projections each GPU holds Q, K and V of shape <code>[N/P, H, d<sub>h</sub>] = [13,950, 40, 128]</code>: 13,950 × 5120 × 2 B = 143 MB per tensor. But head <i>h</i> needs Q, K and V for <b>all</b> N tokens.</p>' +
              '<p>Two ways out: gather every K and V onto every GPU (1.14 GB each per layer, and redundant work), or <b>transpose</b> the partitioning so each GPU owns whole heads. Attention heads are independent, which is what Ulysses exploits.</p>'
          },
          {
            say: 'So an all to all exchange transposes the split. Afterwards each GPU holds all one hundred eleven thousand tokens, but only five of the forty heads, and runs ordinary full attention on them.',
            card: { tag: 'HOW IT WORKS', title: 'Sequence split becomes a head split', body: 'Cell (tokens s, heads h) travels from GPU s to GPU h. Each GPU ends with five complete heads and runs an unmodified FlashAttention kernel.' },
            deep: '<p>Ulysses shards activations along the sequence for everything token-local, and along <b>heads</b> for attention:</p>' +
              '<div class="eq">[N/P, H, d<sub>h</sub>]  —all-to-all→  [N, H/P, d<sub>h</sub>]  —attention→  —all-to-all→  [N/P, H, d<sub>h</sub>]</div>' +
              '<p>The attention kernel is completely unmodified: each GPU sees a normal [N, 5, 128] problem, so FlashAttention-3 and its optimisations apply as they are. This is why Ulysses is the simplest sequence-parallel scheme to adopt.</p>'
          },
          {
            say: 'A second all to all restores the sequence split for the rest of the block. Per layer, the traffic is about five hundred seventy megabytes per GPU, roughly one and a half milliseconds on NVLink, against about a hundred milliseconds of compute.',
            card: { tag: 'NUMBERS', title: 'Communication is nearly free', stat: { v: '< 2 %', l: 'all-to-all time versus compute per layer: 1.5 ms of NVLink traffic against about 100 ms of attention and MLP' },
              more: '<p>Per layer per GPU the all-to-alls move Q, K, V and O: 4 · N·d/P · 2 B = 4 × 143 MB ≈ 571 MB, of which 7/8 leaves the GPU. At an assumed ≈ 350 GB/s effective all-to-all bandwidth on NVLink 4 (about 78 % of its 450 GB/s per direction) that is ≈ 1.5 ms. Compute: 3.2×10¹⁴ FLOP per layer ÷ 8 GPUs at ≈ 400 TFLOP/s ≈ 100 ms.</p>' },
            deep: '<p>Per layer per GPU it moves Q, K, V and O: 4 · N·d/P · 2 B = 4 × 143 MB ≈ 571 MB (7/8 of it off-GPU). On NVLink 4 (assuming ~350 GB/s effective all-to-all) that is ≈ 1.5 ms, against ≈ 100 ms of compute per layer per GPU (3.2×10¹⁴ / 8 at ~400 TFLOP/s): &lt; 2 % overhead.</p>' +
              '<p><b>Comm per GPU ∝ N·d/P</b>, so it stays cheap as P grows, but all-to-all needs a fast fabric (NVLink and NVSwitch) and degrades across nodes.</p>'
          },
          {
            say: 'There are two constraints. The degree must divide the head count, and every GPU still holds all the weights. Scaling is good but not perfect, since HunyuanVideo\'s own eight GPU run is only about five and a half times faster than a single GPU.',
            card: { tag: 'PITFALL', title: 'The head count caps the degree', body: 'Ulysses needs P to divide the 40 heads: 2, 4, 5, 8, 10, 20 or 40. GQA models are limited by their KV heads. Ring attention removes this limit.' },
            deep: '<ul><li><b>Constraint</b>: P must divide the head count (40 heads → P ∈ {2, 4, 5, 8, 10, 20, 40}); GQA models are limited by their KV heads.</li>' +
              '<li>Every GPU still holds the full 28 GB of BF16 weights (or 14 GB in FP8): SP splits activations and FLOPs, not parameters.</li></ul>' +
              '<p>Wan 2.x, HunyuanVideo and xDiT ship Ulysses-style SP for multi-GPU inference. Reported scaling is good but sublinear: HunyuanVideo\'s xDiT-based numbers (720p, 129 frames, 50 steps) fall from 1,904 s on one GPU to 338 s on eight (5.64×), with 3.70× on four.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          buildStrip(ctx, S); setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'SEQUENCE PARALLELISM — DEEPSPEED-ULYSSES', '8 GPUs · each owns 1/8 of the tokens · all-to-all swaps the sequence split for a head split', 'red');
          var XG = function (g) { return 250 + g * 150; };
          /* beat 1: the token bar and the eight GPUs */
          var TB = ctx.group({ parent: G });
          for (var s = 0; s < 8; s++) {
            ctx.rect(XG(s) - 74, 250, 146, 22, { rx: 3, fill: ctx.alpha('teal', 0.12 + 0.04 * (s % 2)), stroke: ctx.alpha('teal', 0.7), sw: 1, parent: TB });
            ctx.text(XG(s), 261, 's' + s + ' · 13,950 tok', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: TB });
          }
          ctx.text(165, 261, '111,600', { size: 11.5, font: 'mono', color: 'teal', anchor: 'end', parent: TB });
          var chips = [];
          for (var g = 0; g < 8; g++) chips.push(gpuChip(ctx, G, XG(g), 308, 'GPU ' + g, 'red', 104, 32));
          /* beat 2: Q K V for all heads (layout A) */
          S.rowL = [];
          for (var h = 0; h < 8; h++) S.rowL.push(ctx.text(186, 362 + h * 28, 'heads ' + (h * 5) + '–' + (h * 5 + 4), { size: 11, font: 'mono', color: HG[h], anchor: 'end', parent: G }));
          S.cells = [];
          var CG = ctx.group({ parent: G });
          for (var gg = 0; gg < 8; gg++) {
            for (var hh = 0; hh < 8; hh++) {
              var c = ctx.group({ parent: CG });
              ctx.rect(-50, -12, 100, 24, { rx: 4, fill: ctx.alpha(HG[hh], 0.4), stroke: HG[hh], sw: 1, parent: c });
              ctx.text(0, 0, 's' + gg + ' · h' + (hh * 5) + '–' + (hh * 5 + 4), { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: c });
              ctx.place(c, XG(gg), 362 + hh * 28);
              S.cells.push({ el: c, s: gg, h: hh });
            }
          }
          S.phase = ctx.text(800, 612, 'layout A · sequence-sharded: GPU g holds Q, K, V for tokens s_g, all 40 heads   [N/8, 40, 128]', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: G });
          var frames = ctx.group({ parent: G });
          for (var f = 0; f < 8; f++) ctx.rect(XG(f) - 56, 344, 112, 234, { rx: 8, stroke: ctx.alpha('lime', 0.8), sw: 1.6, dash: '5 4', parent: frames });
          /* beat 4 and 5 texts */
          var t1 = ctx.text(60, 668, 'per layer, per GPU:  all-to-all(Q, K, V) + all-to-all(O)  =  4 × N·d/P × 2 B  =  4 × 143 MB ≈ 571 MB', { size: 13, font: 'mono', color: 'text', parent: G });
          var t2 = ctx.text(60, 702, 'NVLink 4 all-to-all ≈ 350 GB/s → ≈ 1.5 ms      vs      ≈ 100 ms of attention + MLP compute per layer per GPU  →  < 2 %', { size: 13, font: 'mono', color: 'text', parent: G });
          /* the same comparison as bars (beat 4): the all-to-all is a sliver next to the compute it feeds */
          var CB = ctx.group({ parent: G });
          ctx.text(1000, 668, 'PER LAYER · PER GPU', { size: 11.5, font: 'mono', color: 'dim', parent: CB });
          ctx.text(1000, 696, 'compute', { size: 11.5, font: 'mono', color: 'amber', parent: CB });
          ctx.rect(1090, 686, 430, 20, { rx: 3, fill: ctx.alpha('amber', 0.45), stroke: 'amber', sw: 1, parent: CB });
          ctx.text(1305, 696, '≈ 100 ms', { size: 11.5, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: CB });
          ctx.text(1000, 726, 'all-to-all', { size: 11.5, font: 'mono', color: 'cyan', parent: CB });
          ctx.rect(1090, 716, 6.5, 20, { rx: 1, fill: ctx.alpha('cyan', 0.6), stroke: 'cyan', sw: 1, parent: CB });
          ctx.text(1108, 726, '≈ 1.5 ms · under 2 % of it', { size: 11.5, font: 'mono', weight: 700, color: 'cyan', parent: CB });
          var t3 = ctx.text(60, 736, 'constraint: P divides the head count (40 heads: P = 8 → 5 heads per GPU)  ·  weights are replicated, activations are split', { size: 13, font: 'mono', color: 'text', parent: G });
          var CN = ctx.group({ parent: G });
          var cx0 = 60;
          [['P must divide 40 heads: 2 · 4 · 5 · 8 · 10 · 20 · 40', 'amber'], ['weights replicated: 28 GB (BF16) on every GPU', 'red'], ['HunyuanVideo, 8 GPUs: 5.6× reported', 'lime']].forEach(function (l) {
            var lb = ctx.label(cx0, 796, l[0], { color: l[1], size: 12, anchor: 'start', parent: CN });
            cx0 += lb.w + 14;
          });
          hide([TB, CG, S.phase, frames, t1, t2, t3, CN, CB]); hide(chips); hide(S.rowL);
          /* beat 1 */
          return Promise.all([
            ctx.reveal(TB, { from: 'down' }),
            ctx.reveal(chips, { from: 'up', delay: 400, stagger: 70 })
          ]).then(function () { ctx.hud('13,950 tokens per GPU · weights replicated'); return Promise.all(chips.map(function (cc, i) { return ctx.pulse(cc, { color: HG[i], dur: 500 }); })); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: every GPU computes Q, K, V of its shard, all heads */
            return Promise.all([ctx.reveal(S.rowL, { delay: 100, stagger: 30 }), ctx.reveal(CG, { delay: 300 }), ctx.reveal(S.phase, { from: 'up', delay: 700 })]).then(function () {
              return ctx.wait(500);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the all-to-all */
            S.phase.textContent = 'all-to-all: cell (s_g, heads h) travels from GPU g to GPU h';
            return Promise.all(S.cells.map(function (c) {
              return ctx.transform(c.el, { x: XG(c.h), y: 362 + c.s * 28 }, 1400, 'inOut', (c.s + c.h) * 25);
            })).then(function () {
              S.rowL.forEach(function (t, i) { t.textContent = 'tokens s' + i; t.setAttribute('fill', ctx.C.teal); });
              S.phase.textContent = 'layout B · head-sharded: GPU h holds all 111,600 tokens for 5 heads → plain full attention   [N, 5, 128]';
              ctx.reveal(frames, { dur: 400 });
              return Promise.all(chips.map(function (c, i) { return ctx.pulse(c, { color: HG[i], dur: 700 }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the second all-to-all restores the sequence split; its cost */
            ctx.hud('all-to-all ≈ 1.5 ms vs 100 ms per layer');
            S.phase.textContent = 'second all-to-all: output O returns to the sequence split → MLP and norms are token-local again   [N/8, 40, 128]';
            ctx.fade(frames, 0, 400);
            S.rowL.forEach(function (t, i) { t.textContent = 'heads ' + (i * 5) + '–' + (i * 5 + 4); t.setAttribute('fill', ctx.C[HG[i]]); });
            return Promise.all(S.cells.map(function (c) {
              return ctx.transform(c.el, { x: XG(c.s), y: 362 + c.h * 28 }, 1400, 'inOut', (c.s + c.h) * 25);
            })).then(function () { return ctx.reveal(t1, { from: 'up' }); }).then(function () { return ctx.reveal(t2, { from: 'up' }); }).then(function () { return ctx.reveal(CB, { from: 'up' }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: constraints */
            return ctx.reveal(t3, { from: 'up' }).then(function () { return ctx.reveal(CN, { from: 'up' }); });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Ring attention & USP',
        beats: [
          {
            say: 'Ulysses needs a fast all to all and stops at the head count. Ring attention takes the other route. Every GPU keeps its own queries, and the key value blocks travel around a ring, one hop at a time.',
            card: { tag: 'KEY IDEA', title: 'Queries stay, KV travels', body: 'Each GPU keeps its query block for the whole layer. Key and value blocks circulate to the next neighbour, so no GPU ever holds the full sequence of K and V.' },
            deep: '<p>GPU i holds Q<sub>i</sub>, K<sub>i</sub>, V<sub>i</sub> for N/P tokens. Ring attention (Liu, Zaharia &amp; Abbeel) keeps Q<sub>i</sub> local and circulates the (K<sub>j</sub>, V<sub>j</sub>) blocks around a ring of P GPUs with point-to-point send and receive: each GPU forwards the block it has just used to its neighbour.</p>' +
              '<p>Unlike Ulysses it needs no all-to-all and puts no constraint on the number of heads. Per-GPU activation memory stays O(N/P), because at most two KV blocks (the one in use and the one arriving) are resident.</p>'
          },
          {
            say: 'At each hop a GPU computes one block of the attention matrix and folds it into a running softmax, exactly like FlashAttention does across tiles. Nothing is normalised until the last block has arrived.',
            card: { tag: 'HOW IT WORKS', title: 'Online softmax merges blocks', body: 'Each block updates a running max, a running sum and a running output. The merge is exact and order independent, so partial results can arrive in any order.' },
            deep: '<div class="eq">m′ = max(m, rowmax S),  ℓ′ = e<sup>m−m′</sup>ℓ + Σ e<sup>S−m′</sup>,  O′ = e<sup>m−m′</sup>O + e<sup>S−m′</sup>V</div>' +
              '<p>This is the FlashAttention recurrence applied across GPUs instead of across SRAM tiles. After the last block, O / ℓ is the exact softmax attention output. Because the merge is associative, the order in which KV blocks arrive does not change the result (up to floating-point rounding).</p>'
          },
          {
            say: 'Watch the diagonals fill. After seven hops every query block has met every key value block, and each GPU holds its exact attention output without ever gathering the full keys and values.',
            card: { tag: 'HOW IT WORKS', title: 'P rounds, one block each', body: 'Block (i, j) is computed on GPU i at hop (i − j) mod 8. Eight GPUs need eight rounds: one local block plus seven received.' },
            deep: '<p>For r = 0 … P−1, GPU i computes the block with KV<sub>(i−r) mod P</sub> while it sends its current KV block to GPU i+1. After P−1 hops each (i, j) pair has been computed exactly once.</p>' +
              '<p>Bidirectional (non-causal) attention keeps the load perfectly balanced, since every block costs the same. Causal LLM training has to use zig-zag or striped sharding to balance the masked triangle; video DiTs do not.</p>'
          },
          {
            say: 'Try it yourself. Click any block of the matrix, and the ring highlights the route that key value block travelled to reach that query. The farthest blocks are seven hops away, while the diagonal never leaves its GPU.',
            card: { tag: 'TRY IT', title: 'Click a block, follow its KV', body: 'The amber arcs trace key value block <i>j</i> on its way to GPU <i>i</i>: exactly <code>(i − j) mod 8</code> hops. Local blocks need none, the farthest need seven.' },
            deep: '<p>The schedule is a rotation: at hop r, GPU i holds KV block (i − r) mod P and forwards it to GPU i + 1. Block (i, j) is therefore computed after r = (i − j) mod P hops, and every GPU works on exactly one block per hop, which keeps the load balanced.</p>' +
              '<div class="eq">T<sub>layer</sub> ≈ P · max(t<sub>compute</sub>, t<sub>send</sub>) = 8 × 10 ms = 80 ms = 4N²d / (P · F)</div>' +
              '<p>When the send is hidden, ring attention runs at the speed of perfectly parallel attention: 4·N²·d = 2.55×10¹⁴ FLOP over 8 GPUs at ≈ 400 TFLOP/s is again 80 ms. Nothing is gathered, so each GPU keeps two KV blocks (≈ 0.57 GB) instead of the full 2.3 GB of K and V.</p>'
          },
          {
            say: 'Because each hop\'s compute outlasts its transfer, communication hides completely: two hundred eighty six megabytes takes under six milliseconds over InfiniBand, while the block takes about ten milliseconds to compute.',
            card: { tag: 'NUMBERS', title: 'Transfer hides under compute', stat: { v: '5.7 vs 10 ms', l: 'one 286 MB KV block over 400 Gb/s versus the attention math for it, per hop per layer' },
              more: '<p>KV block: K and V for n = 13,950 tokens at d = 5120 in BF16 = 2 × 13,950 × 5120 × 2 B = 286 MB. A 400 Gb/s NIC moves 50 GB/s, so 286 MB takes 5.7 ms. Compute per hop: QK<sup>T</sup> and PV each cost 2·n²·d FLOP, so 4 × (1.95 × 10<sup>8</sup>) × 5120 = 4.0 TFLOP, about 10 ms at ≈ 400 TFLOP/s effective.</p>' },
            deep: '<p>Per hop, per layer, per GPU: KV block = 2 × 13,950 × 5120 × 2 B = 286 MB, which is ≈ 5.7 ms on a 400 Gb/s NIC and ≈ 0.8 ms on NVLink. Compute is 4·(N/P)²·d ≈ 4.0 TFLOP ≈ 10 ms. Transfer is hidden while it stays below compute, which holds even across nodes.</p>' +
              '<details><summary>Go deeper</summary><p>Compute per hop scales with (N/P)² while the message scales with N/P, so the compute-to-communication ratio falls as 1/P. At P = 8 it is 10 / 5.7 ≈ 1.75; beyond roughly P = 14 on a 400 Gb/s fabric the ring stops hiding its transfers, and per-hop blocks also become too small for peak tensor-core efficiency.</p></details>'
          },
          {
            say: 'Unified sequence parallelism combines both. Ulysses runs inside each NVLink domain, where all to all is cheap, and a ring runs across nodes, where only the key value blocks cross the slow link.',
            card: { tag: 'STATE OF THE ART', title: 'USP: a two dimensional mesh', body: 'Total degree P = u × r: Ulysses degree u inside a node, ring degree r across nodes. xDiT ships this as its long-sequence engine for video and image DiTs.' },
            deep: '<p><b>USP</b> (Fang &amp; Zhao 2024, used by xDiT): a 2-D process mesh P = u × r. The Ulysses degree u lives inside the NVLink domain, the Ring degree r across nodes or slower links. Ulysses supplies bandwidth efficiency, Ring removes the head-count limit: u must divide the heads, but r is free.</p>' +
              '<ul><li>Two nodes of 4 GPUs: u = 4, r = 2; only KV blocks cross the network.</li><li>One node of 8 GPUs: u = 8, r = 1 is usually best; ring adds nothing on a fast fabric.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'RING ATTENTION & USP', 'queries stay put · KV blocks circulate · an online softmax merges partial results', 'red');
          var CX = 400, CY = 470, R = 180;
          function ang(g) { return -Math.PI / 2 + g * Math.PI / 4; }
          /* beat 1: the ring */
          var chips = [];
          for (var g = 0; g < 8; g++) chips.push(gpuChip(ctx, G, CX + R * Math.cos(ang(g)), CY + R * Math.sin(ang(g)), 'GPU ' + g, HG[g], 96, 32));
          S.arcs = [];
          for (var a = 0; a < 8; a++) {
            var a1 = ang(a) + 0.2, a2 = ang(a + 1) - 0.2, RR = R - 38;
            var p = ctx.path('M' + (CX + RR * Math.cos(a1)).toFixed(1) + ',' + (CY + RR * Math.sin(a1)).toFixed(1) + ' A' + RR + ',' + RR + ' 0 0 1 ' + (CX + RR * Math.cos(a2)).toFixed(1) + ',' + (CY + RR * Math.sin(a2)).toFixed(1), { stroke: ctx.alpha('red', 0.6), sw: 1.6, arrow: true, parent: G });
            p.len = p.getTotalLength();
            S.arcs.push(p);
          }
          var ringT = ctx.text(CX, CY - 12, 'KV ring', { size: 15, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: G });
          S.hopT = ctx.text(CX, CY + 14, 'hop 0 / 7', { size: 13, font: 'mono', color: 'red', anchor: 'middle', parent: G });
          /* beat 2: the block matrix */
          var rl = [], cl = [];
          for (var i = 0; i < 8; i++) { rl.push('Q' + i); cl.push('KV' + i); }
          S.M = ctx.matrix(830, 296, 8, 8, { cell: 42, gap: 4, cmap: 'lime', values: function () { return 0.05; }, rowLabels: rl, colLabels: cl, parent: G });
          var mCap = ctx.group({ parent: G });
          ctx.text(830, 680, 'block (i, j) = softmax-merge(Qᵢ · KVⱼ),', { size: 12, font: 'mono', color: 'dim', parent: mCap });
          ctx.text(830, 700, 'computed on GPU i at hop (i − j) mod 8', { size: 12, font: 'mono', color: 'dim', parent: mCap });
          function light(r) {
            for (var q = 0; q < 8; q++) {
              var j = ((q - r) % 8 + 8) % 8;
              S.M.cells[q][j].setAttribute('fill', ctx.mix('#0b1a0a', ctx.C[HG[q]], 0.8 - 0.07 * r));
              S.M.cells[q][j].setAttribute('stroke', ctx.C[HG[q]]);
            }
          }
          /* beat 4: per-hop numbers and the overlap */
          var RP = ctx.group({ parent: G });
          ctx.text(1250, 300, 'PER HOP · PER LAYER · PER GPU', { size: 12, font: 'mono', color: 'dim', parent: RP });
          ctx.para(1250, 330, [
            'KV block = 2 × 13,950 × 5120',
            '× 2 B = 286 MB',
            'send: ≈ 5.7 ms @ 400 Gb/s IB',
            'send: ≈ 0.8 ms @ NVLink',
            'compute: 4·(N/8)²·d',
            '≈ 4.0 TFLOP ≈ 10 ms',
            '→ transfer hidden under compute',
            '→ no head-count limit',
            '→ P2P only, works across nodes'
          ], { size: 12, font: 'mono', color: 'text', parent: RP, lh: 22 });
          var OV = ctx.group({ parent: RP });
          ctx.text(1250, 590, 'compute', { size: 11.5, font: 'mono', color: 'amber', parent: OV });
          ctx.rect(1320, 580, 200, 20, { rx: 3, fill: ctx.alpha('amber', 0.45), stroke: 'amber', sw: 1, parent: OV });
          ctx.text(1250, 622, 'send', { size: 11.5, font: 'mono', color: 'cyan', parent: OV });
          ctx.rect(1320, 612, 114, 20, { rx: 3, fill: ctx.alpha('cyan', 0.45), stroke: 'cyan', sw: 1, parent: OV });
          ctx.text(1442, 622, 'hidden', { size: 11, font: 'mono', color: 'lime', parent: OV });
          /* beat 5: the USP mesh */
          var UM = ctx.group({ parent: G });
          ctx.text(60, 732, 'USP · P = u × r', { size: 14, font: 'display', weight: 700, color: 'white', parent: UM });
          ctx.text(60, 754, 'u = Ulysses (all-to-all over heads)', { size: 11.5, font: 'mono', color: 'dim', parent: UM });
          ctx.text(60, 772, 'r = Ring (P2P KV passing)', { size: 11.5, font: 'mono', color: 'dim', parent: UM });
          [0, 1].forEach(function (n) {
            var x0 = 380 + n * 430;
            ctx.rect(x0, 722, 380, 108, { rx: 10, fill: ctx.alpha('red', 0.04), stroke: ctx.alpha('red', 0.5), dash: '5 4', sw: 1, parent: UM });
            ctx.text(x0 + 12, 740, 'node ' + n + ' · NVLink domain · Ulysses u = 4', { size: 11.5, font: 'mono', color: 'red', parent: UM });
            var pts = [];
            for (var k = 0; k < 4; k++) { var px = x0 + 50 + k * 94; pts.push(px); ctx.rect(px - 30, 770, 60, 28, { rx: 4, fill: ctx.alpha(HG[n * 4 + k], 0.2), stroke: HG[n * 4 + k], sw: 1, parent: UM }); ctx.text(px, 784, 'G' + (n * 4 + k), { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: UM }); }
            for (var u = 0; u < 4; u++) for (var v = u + 1; v < 4; v++) ctx.path('M' + pts[u] + ',770 Q' + ((pts[u] + pts[v]) / 2) + ',' + (752 - 6 * (v - u)) + ' ' + pts[v] + ',770', { stroke: ctx.alpha('red', 0.35), sw: 1, parent: UM });
          });
          ctx.path('M760,812 Q785,850 810,812', { stroke: 'amber', sw: 1.8, arrow: true, parent: UM });
          ctx.path('M810,800 Q785,770 760,800', { stroke: 'amber', sw: 1.8, arrow: true, parent: UM });
          ctx.text(1230, 776, 'ring r = 2 across nodes', { size: 12, font: 'mono', color: 'amber', parent: UM });
          ctx.text(1230, 796, '(slow link carries only KV)', { size: 11.5, font: 'mono', color: 'dim', parent: UM });
          light(0);
          /* beat 4: click a block, follow its KV block around the ring */
          var ARC0 = ctx.alpha('red', 0.6);
          var pickT = ctx.text(830, 244, '', { size: 12.5, font: 'mono', weight: 700, color: 'amber', parent: G });
          var pickBox = ctx.rect(0, 0, 46, 46, { rx: 5, fill: 'none', stroke: 'white', sw: 2, parent: G });
          pickBox.style.pointerEvents = 'none'; pickT.style.pointerEvents = 'none';
          function pick(i, j) {
            var r = ((i - j) % 8 + 8) % 8, c = S.M.cellCenter(i, j);
            pickBox.setAttribute('x', c.x - 23); pickBox.setAttribute('y', c.y - 23);
            S.arcs.forEach(function (p, a) {
              var on = ((a - j) % 8 + 8) % 8 < r;
              p.setAttribute('stroke', on ? ctx.C.amber : ARC0); p.setAttribute('stroke-width', on ? 3 : 1.6);
            });
            pickT.textContent = 'Q' + i + ' · KV' + j + ' → GPU ' + i + ' at hop (' + i + ' − ' + j + ') mod 8 = ' + r + (r ? '' : '  (local)');
          }
          for (var qi = 0; qi < 8; qi++) for (var kj = 0; kj < 8; kj++) {
            (function (qi, kj) { S.M.cells[qi][kj].addEventListener('click', function () { if (S.tryRing) pick(qi, kj); }); })(qi, kj);
          }
          hide(chips); hide(S.arcs); hide([ringT, S.hopT, S.M, mCap, RP, UM, pickBox, pickT]);
          /* beat 1: GPUs on a ring, KV blocks pass to the neighbour */
          return Promise.all([
            ctx.reveal(chips, { from: 'scale', stagger: 60 }),
            ctx.reveal(S.arcs, { from: 'draw', delay: 500, stagger: 50 }),
            ctx.reveal([ringT, S.hopT], { delay: 900, stagger: 100 })
          ]).then(function () {
            return Promise.all(S.arcs.map(function (p, k) { return ctx.packet(p, { color: HG[k], dur: 600, r: 4 }); }));
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: one block per hop, merged by an online softmax */
            return Promise.all([ctx.reveal(S.M, { from: 'right' }), ctx.reveal(mCap, { from: 'up', delay: 400 })]).then(function () {
              return ctx.pulse(S.M, { color: 'lime', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: seven hops fill the diagonals */
            var chain = ctx.wait(300);
            [1, 2, 3, 4, 5, 6, 7].forEach(function (r) {
              chain = chain.then(function () {
                return Promise.all(S.arcs.map(function (p, k) { return ctx.packet(p, { color: HG[((k - r + 1) % 8 + 8) % 8], dur: 420, r: 4 }); })).then(function () {
                  light(r);
                  S.hopT.textContent = 'hop ' + r + ' / 7';
                });
              });
            });
            return chain;
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: try it, click any block; a short tour of four blocks first */
            S.tryRing = true;
            S.M.cells.forEach(function (row) { row.forEach(function (ce) { ce.style.cursor = 'pointer'; }); });
            ctx.hud('click a block: hop = (i − j) mod 8');
            ctx.reveal([pickBox, pickT], { delay: 100 });
            return [[1, 1], [6, 2], [7, 0], [3, 6]].reduce(function (p, ij) {
              return p.then(function () { pick(ij[0], ij[1]); return ctx.wait(900); });
            }, ctx.wait(400));
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: the transfer hides under compute */
            S.tryRing = false;
            ctx.fade([pickBox, pickT], 0, 300);
            S.arcs.forEach(function (p) { p.setAttribute('stroke', ARC0); p.setAttribute('stroke-width', 1.6); });
            ctx.hud('per hop: 286 MB KV vs ≈ 10 ms compute');
            return ctx.reveal(RP, { from: 'right' }).then(function () { return ctx.pulse(OV, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(5); }).then(function () {
            /* beat 6: USP mesh */
            return ctx.reveal(UM, { from: 'up' });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'CFG & PipeFusion',
        beats: [
          {
            say: 'Two more axes of parallelism come almost for free. Classifier free guidance runs the model twice per step, once with the prompt and once without, and blends the two predictions.',
            card: { tag: 'KEY IDEA', title: 'Guidance doubles the work', body: 'Every step evaluates a conditional and an unconditional prediction, then extrapolates from one toward the other with a weight around five.' },
            deep: '<div class="eq">v = v<sub>θ</sub>(z<sub>t</sub>, t, ∅) + w · ( v<sub>θ</sub>(z<sub>t</sub>, t, c) − v<sub>θ</sub>(z<sub>t</sub>, t, ∅) ),   w ≈ 5</div>' +
              '<p>With w = 1 the result is the plain conditional model; larger w trades diversity for prompt adherence. Because both evaluations use the same latent z<sub>t</sub> and only the text conditioning differs, the two branches are <b>independent</b> within a step, which is what makes them parallelisable.</p>'
          },
          {
            say: 'Those two passes are independent, so put the conditional branch on four GPUs and the unconditional one on the other four, and exchange only the fourteen megabyte velocity at the end of each step.',
            card: { tag: 'NUMBERS', title: 'One small tensor per step', stat: { v: '14.3 MB', l: 'the only exchange per step: one 16 × 31 × 90 × 160 latent in BF16' },
              more: '<p>The latent has 16 channels; at 720p and 121 frames that is 16 × 31 × 90 × 160 = 7,142,400 values, 14.3 MB in BF16. Over a 50 GB/s link that takes about 0.3 ms, against several seconds of compute per step on a four-GPU branch (1.29 × 10<sup>16</sup> FLOP per forward ÷ 4 GPUs at ≈ 400 TFLOP/s ≈ 8 s), so the exchange is negligible.</p>' },
            deep: '<p><b>CFG parallelism</b>: degree 2, close to the ideal 2× because the exchange is tiny. Per step each group exchanges one velocity latent <code>v ∈ ℝ<sup>16×31×90×160</sup></code> (14.3 MB in BF16), a tiny all-gather compared with the hundreds of MB per layer inside a Ulysses group.</p>' +
              '<p>Both groups run the same weights, so memory per GPU is unchanged; only the wall-clock per step halves. xDiT lets the CFG axis be combined with the sequence-parallel and PipeFusion axes, as long as the product of the degrees equals the GPU count.</p>'
          },
          {
            say: 'On two four GPU nodes, the guidance split goes across the nodes, since it crosses the slow link only once per step, while Ulysses stays inside each NVLink domain. The cheapest cut belongs on the slowest wire.',
            card: { tag: 'HOW IT WORKS', title: 'Cheapest cut on the slowest link', body: 'CFG moves 14 MB per step; Ulysses moves hundreds of MB per layer. So CFG spans the nodes and Ulysses stays inside NVLink.' },
            deep: '<p>One valid 8-GPU xDiT layout is <code>cfg=2 × ulysses=4</code>. With two 4-GPU nodes, put the CFG split <i>across</i> the nodes (it crosses the slow link once per step) and keep Ulysses inside each NVLink domain. On PCIe boxes without NVLink, <code>cfg=2 × pipefusion=4</code> avoids all-to-all entirely.</p>' +
              '<p>The general rule: order the mesh axes by communication volume per unit of compute and map the heaviest axis onto the fastest links.</p>'
          },
          {
            say: 'PipeFusion goes further on slow interconnects. It cuts the model into layer stages and streams patches of the image through them, so every GPU holds only a quarter of the weights.',
            card: { tag: 'NUMBERS', title: 'A quarter of the weights', stat: { v: '28 → 7', u: 'GB / GPU', l: 'BF16 weights per GPU with four pipeline stages of ten blocks each' } },
            deep: '<p><b>PipeFusion</b> (xDiT): split the 40 blocks into P stages (10 each, ~7 GB of BF16 weights per GPU instead of 28 GB) and the token sequence into M patches. Patch p flows stage by stage, so all stages work on different patches at once.</p>' +
              '<ul><li>Comm: point-to-point activations of one patch (N/M · d), far below sequence-parallel all-to-all, which suits PCIe and Ethernet boxes.</li>' +
              '<li>Pipeline bubbles occur only at the start of the first step; weight memory per GPU drops by P.</li></ul>'
          },
          {
            say: 'The trick is staleness. Each patch attends to fresh keys and values for patches already computed in this step, and slightly stale ones from the previous step for the rest, because adjacent diffusion steps are so similar. That removes the pipeline bubble after the first step.',
            card: { tag: 'TRADE-OFF', title: 'Staleness is an approximation', body: 'Quality is usually indistinguishable at 50 steps, but riskier for four-step students, where adjacent steps differ a lot.' },
            deep: '<p>While a stage computes patch p of step s, its attention uses fresh K/V for patches 0 … p, which this stage has just recomputed in the current step, and <b>stale K/V from step s−1</b> for patches p+1 … M−1. This is valid because the inputs of adjacent diffusion steps are highly similar; a first warm-up step runs synchronously to fill the buffers.</p>' +
              '<p>That is what lets step s+1 start its first patch while step s is still draining: no bubble between steps. The price is an approximation whose error grows as steps get farther apart, so few-step students, where consecutive steps differ a lot, are the risky case.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'CFG PARALLEL · PIPEFUSION', 'independent guidance branches on separate GPU groups · patches pipelined through layer stages', 'red');
          /* CFG (beats 1-3) */
          var L = ctx.group({ parent: G });
          S.zt = ctx.node({ x: 110, y: 450, w: 110, h: 56, title: 'z_t, t', sub: '14.3 MB', color: 'lime', titleSize: 14, subSize: 11, parent: L });
          var cfgChips = [], subT = [], gTitles = [];
          function grp(y, title, col, off) {
            var n = ctx.node({ x: 410, y: y, w: 400, h: 140, kind: 'ghost', color: col, parent: L });
            gTitles.push(ctx.text(222, y - 50, title, { size: 12.5, font: 'mono', color: col, parent: L }));
            for (var k = 0; k < 4; k++) cfgChips.push(gpuChip(ctx, L, 262 + k * 98, y + 6, 'G' + (off + k), col, 84, 34));
            subT.push(ctx.text(410, y + 50, 'Ulysses-4 inside the group', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: L }));
            return n;
          }
          S.gc = grp(345, 'cond · DiT(z_t, t, c)', 'lime', 0);
          S.gu = grp(555, 'uncond · DiT(z_t, t, ∅)', 'dim', 4);
          S.cmb = ctx.node({ x: 700, y: 450, w: 120, h: 64, title: 'combine', sub: 'w ≈ 5', color: 'amber', titleSize: 14, subSize: 11, parent: L });
          var l1 = ctx.link(S.zt, S.gc, { from: 'r', to: 'l', color: 'lime', parent: L });
          var l2 = ctx.link(S.zt, S.gu, { from: 'r', to: 'l', color: 'dim', parent: L });
          var l3 = ctx.link(S.gc, S.cmb, { from: 'r', to: 't', color: 'lime', label: 'v_c', parent: L });
          var l4 = ctx.link(S.gu, S.cmb, { from: 'r', to: 'b', color: 'dim', label: 'v_∅', parent: L });
          var f1 = ctx.text(60, 680, 'v = v_∅ + w · (v_c − v_∅)', { size: 14, font: 'mono', weight: 700, color: 'amber', parent: L });
          var f2 = ctx.text(60, 704, 'exchange per step: one 16×31×90×160 latent = 14.3 MB', { size: 12, font: 'mono', color: 'dim', parent: L });
          var f3 = ctx.text(60, 724, 'ideal scaling 2× for the price of a tiny all-gather', { size: 12, font: 'mono', color: 'dim', parent: L });
          /* PipeFusion (beats 4-5) */
          var P = ctx.group({ parent: G });
          ctx.text(840, 250, 'PIPEFUSION · 4 stages × 4 patches, two diffusion steps', { size: 13, font: 'display', weight: 700, color: 'white', parent: P });
          var X0 = 930, SL = 54, Y0 = 280, RH = 56;
          for (var d = 0; d < 4; d++) {
            ctx.text(X0 - 10, Y0 + d * RH + 22, 'stage ' + d, { size: 11.5, font: 'mono', color: 'text', anchor: 'end', parent: P });
            ctx.text(X0 - 10, Y0 + d * RH + 38, 'L' + d * 10 + '–' + (d * 10 + 9), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: P });
            ctx.rect(X0, Y0 + d * RH, 11 * SL, RH - 8, { rx: 4, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('faint', 0.8), sw: 1, parent: P });
          }
          var PC = ['cyan', 'violet', 'amber', 'pink'];
          var tilesA = [], tilesB = [];
          for (var st = 0; st < 2; st++) for (var pp = 0; pp < 4; pp++) for (var dd = 0; dd < 4; dd++) {
            var slot = st * 4 + pp + dd;
            var tg = ctx.group({ parent: P });
            ctx.rect(X0 + slot * SL + 3, Y0 + dd * RH + 3, SL - 6, RH - 14, { rx: 4, fill: ctx.alpha(PC[pp], st ? 0.55 : 0.3), stroke: PC[pp], sw: 1, parent: tg });
            ctx.text(X0 + slot * SL + SL / 2, Y0 + dd * RH + 24, 'p' + pp, { size: 11.5, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: tg });
            tg.setAttribute('opacity', 0);
            (st ? tilesB : tilesA).push({ el: tg, slot: slot });
          }
          for (var tt = 0; tt <= 10; tt += 2) ctx.text(X0 + tt * SL + SL / 2, Y0 + 4 * RH + 6, 't' + tt, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          ctx.text(X0 + 2 * SL, Y0 - 8, 'step s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          var stepB = ctx.text(X0 + 7 * SL, Y0 - 8, 'step s + 1 (no bubble)', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          var paraA = ctx.text(840, 586, 'each GPU holds 10 of 40 blocks: ~7 GB weights, not 28 GB', { size: 12.5, font: 'mono', color: 'text', parent: G });
          var legP = ctx.group({ parent: G });
          var lgx = ctx.label(840, 540, 'fresh KV: patches ≤ p, this step', { color: 'lime', size: 11.5, anchor: 'start', parent: legP });
          ctx.label(840 + lgx.w + 12, 540, 'stale KV: patches > p, from step s − 1', { color: 'amber', size: 11.5, anchor: 'start', parent: legP });
          /* the K/V buffer that one stage sees while it computes patch p1 of step s + 1 */
          var KVS = ctx.group({ parent: G });
          ctx.text(840, 712, 'K/V buffer of stage 1 while it computes p1 of step s + 1', { size: 12, font: 'mono', color: 'dim', parent: KVS });
          [['p0', 'fresh', 'lime'], ['p1', 'fresh', 'lime'], ['p2', 'stale', 'amber'], ['p3', 'stale', 'amber']].forEach(function (b, k) {
            var fr = b[1] === 'fresh';
            ctx.rect(840 + k * 108, 726, 100, 30, { rx: 5, fill: ctx.alpha(b[2], fr ? 0.35 : 0.1), stroke: b[2], sw: 1.2, dash: fr ? null : '4 3', parent: KVS });
            ctx.text(890 + k * 108, 741, b[0] + ' · ' + b[1], { size: 11.5, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: KVS });
          });
          ctx.text(840, 778, 'stale entries are one step old: cheap to keep, since steps are similar', { size: 11.5, font: 'mono', color: 'dim', parent: KVS });
          var paraB = ctx.para(840, 616, [
            'comm: P2P activations of one patch, no all-to-all',
            'staleness lets step s + 1 start before step s drains',
            '→ good on PCIe / Ethernet; pairs with CFG-parallel'
          ], { size: 12.5, font: 'mono', color: 'text', parent: G, lh: 24 });
          /* layouts (beat 3) */
          var LY = ctx.group({ parent: G });
          ctx.text(60, 780, '8-GPU LAYOUTS', { size: 12, font: 'mono', color: 'dim', parent: LY });
          var lyLab = [];
          [['cfg 2 × ulysses 4', 'one NVLink node', 'lime'], ['cfg 2 (across nodes) × ulysses 4', 'two 4-GPU nodes: only 14 MB / step crosses', 'amber'], ['cfg 2 × pipefusion 4', 'PCIe / L40S boxes', 'violet']].forEach(function (l, i) {
            var x = 60 + i * 500;
            lyLab.push(ctx.label(x, 816, l[0], { color: l[2], size: 12.5, anchor: 'start', parent: LY }));
            ctx.text(x + 12, 846, l[1], { size: 11.5, font: 'mono', color: 'dim', parent: LY });
          });
          hide([S.gc, S.gu, S.cmb, l1, l2, l3, l4, l3.labelEl, l4.labelEl, f1, f2, f3, P, paraA, legP, paraB, LY, stepB, KVS]); hide(cfgChips); hide(subT); hide(gTitles);
          function sweep(list, k0, k1, dur) {
            return ctx.tween(dur, function (t) {
              var k = k0 + (k1 - k0) * t;
              list.forEach(function (ti) { if (ti.slot < k) ti.el.setAttribute('opacity', 1); });
            }, 'linear');
          }
          /* beat 1: two guided evaluations, blended */
          return Promise.all([
            ctx.reveal(S.zt, { from: 'scale' }),
            ctx.reveal([S.gc, S.gu], { from: 'right', delay: 300, stagger: 200 }),
            ctx.reveal(gTitles, { delay: 500, stagger: 200 }),
            ctx.reveal([l1, l2], { from: 'draw', delay: 700, stagger: 100 }),
            ctx.reveal(S.cmb, { from: 'scale', delay: 900 }),
            ctx.reveal([l3, l4], { from: 'draw', delay: 1100, stagger: 100 }),
            ctx.reveal([l3.labelEl, l4.labelEl], { delay: 1500 }),
            ctx.reveal(f1, { from: 'up', delay: 1600 })
          ]).then(function () { return ctx.packet(l1, { color: 'lime', dur: 500 }); })
            .then(function () { return ctx.pulse(S.gc, { color: 'lime', dur: 500 }); })
            .then(function () { return ctx.packet(l2, { color: 'dim', dur: 500 }); })
            .then(function () { return ctx.pulse(S.gu, { color: 'white', dur: 500 }); })
            .then(function () { return ctx.pulse(S.cmb, { color: 'amber', dur: 500 }); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the two branches run on separate GPU groups */
            ctx.hud('CFG-parallel ≈ 2× · one 14 MB exchange / step');
            return Promise.all([ctx.reveal(cfgChips, { from: 'up', stagger: 70 }), ctx.reveal(subT, { delay: 400, stagger: 100 }), ctx.reveal([f2, f3], { from: 'up', delay: 600, stagger: 150 })]).then(function () {
              return Promise.all([ctx.packet(l1, { color: 'lime', dur: 600 }), ctx.packet(l2, { color: 'dim', dur: 600 })]);
            }).then(function () {
              return Promise.all([ctx.pulse(S.gc, { color: 'lime', dur: 600 }), ctx.pulse(S.gu, { color: 'white', dur: 600 })]);
            }).then(function () {
              return Promise.all([ctx.packet(l3, { color: 'lime', dur: 500, label: '14 MB' }), ctx.packet(l4, { color: 'dim', dur: 500 })]);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: eight-GPU layouts */
            return ctx.reveal(LY, { from: 'up' }).then(function () { return ctx.pulse(lyLab[1], { color: 'amber', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: PipeFusion, patches through layer stages */
            ctx.hud('PipeFusion: weights ÷ 4 per GPU');
            ctx.reveal([P, paraA], { from: 'right', stagger: 200 });
            return ctx.wait(700).then(function () { return sweep(tilesA, 0, 7, 3000); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: stale KV lets the next step start early */
            ctx.reveal([stepB, legP, paraB], { from: 'up', stagger: 200 });
            return ctx.wait(500).then(function () { return sweep(tilesB, 4, 11, 3000); }).then(function () {
              ctx.highlight(tilesB[5].el, { color: 'white', pad: 3, parent: P });
              ctx.reveal(KVS, { from: 'up' });
              return ctx.pulse(tilesB[5].el, { color: 'white', dur: 700 });
            });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Step caching',
        beats: [
          {
            say: 'Adjacent denoising steps are remarkably similar, especially in the middle of the trajectory. TeaCache watches a cheap signal: how much the timestep modulated input of the first block changed since the previous step.',
            card: { tag: 'KEY IDEA', title: 'Steps are redundant', body: 'The relative change of the first block\'s modulated input predicts how far the whole network output will move, and it costs almost nothing to compute.' },
            deep: '<p><b>TeaCache</b> (CVPR 2025): the model output difference between steps correlates with the relative L1 change of the <i>timestep-embedding-modulated</i> input of the first block, which is nearly free to compute:</p>' +
              '<div class="eq">Δ<sub>t</sub> = ‖F<sub>t</sub> − F<sub>t+1</sub>‖<sub>1</sub> / ‖F<sub>t+1</sub>‖<sub>1</sub></div>' +
              '<p>The bars show a simulated Δ over a 50-step trajectory: large at the start (layout is being decided), small and smooth in the middle, rising again at the end (fine detail). The TeaCache paper sees this U shape on Open-Sora, while Latte and Open-Sora-Plan show mainly the early peak. A small per-model polynomial maps input change to expected output change.</p>'
          },
          {
            say: 'It accumulates that change, and while the total stays under a threshold it skips all forty blocks and reuses the cached residual from the last full pass. Once the total crosses the threshold, it runs a full forward and resets.',
            card: { tag: 'HOW IT WORKS', title: 'Skip while the drift is small', body: 'Cheap path: output = input + cached residual. Full path: run all 40 blocks, refresh the residual, reset the accumulator to zero.' },
            deep: '<div class="eq">acc += poly(Δ<sub>t</sub>);   skip while acc &lt; δ</div>' +
              '<pre>if acc &lt; δ:       # skip 40 blocks\n  out = x + cached_res\nelse:             # full forward\n  out = DiT(x)\n  cached_res = out − x\n  acc = 0</pre>' +
              '<p>poly is a small polynomial fitted offline per model to map input change to output change. The accumulator is the reason skips come in runs: many small drifts add up until one full forward is due.</p>'
          },
          {
            say: 'Early steps, which set the layout, change fast, and in some models so do the late steps that add detail, so they are computed. The smooth middle is mostly skipped. Here twenty three of fifty forwards run, so roughly every other forward disappears.',
            card: { tag: 'NUMBERS', title: '23 of 50 forwards', stat: { v: '2.2×', l: 'speedup in this simulation: 23 full forwards instead of 50, threshold 0.055' },
              more: '<p>The simulation uses Δ(i) = 0.018 + 0.30·e<sup>−i/2.5</sup> + 0.10·e<sup>(i−49)/3</sup> as the per-step change and δ = 0.055. The accumulator crosses δ on each of the first six steps, then every two to four steps through the middle, then on four of the last five. Real thresholds are tuned per model on a small calibration set.</p>' },
            deep: '<ul><li><b>FasterCache</b> (ICLR 2025): reuses attention outputs on alternating steps with a correction term, and <b>CFG-Cache</b>: cond and uncond outputs differ in a stable, frequency-structured way, so after the first third of sampling the uncond pass is skipped on four of every five steps.</li>' +
              '<li>Related: Δ-DiT, PAB (pyramid attention broadcast), FORA and block-level residual caching.</li></ul>' +
              '<p>Skipping is decided per step from a single scalar, so with sequence parallelism every GPU makes the same decision with no extra communication.</p>'
          },
          {
            say: 'Reported speedups range from about one point four to two point three times on typical video models, with small quality cost. Larger thresholds trade quality for speed, and caching stacks poorly with few step students, which leave little redundancy.',
            card: { tag: 'TRADE-OFF', title: 'The threshold trades quality for speed', body: 'A looser threshold skips more but drifts further from the full trajectory. With four-step students there is little redundancy left to cache.' },
            deep: '<p>Reported: the TeaCache repository lists 1.6× and 2.1× at two thresholds for HunyuanVideo (50 steps) and 1.4× to 2× for Wan 2.1 14B at 720p; the paper reports 1.55× (slow) to 2.25× (fast) on Open-Sora 1.2 and up to 4.4× on 150-step Open-Sora-Plan, where redundancy is larger, at small VBench cost. Larger δ trades quality for speed.</p>' +
              '<p><span class="muted">Caching composes with sequence parallelism (skip decisions are global) but stacks poorly with 4-step students: there is little redundancy left. The two techniques attack the same waste from different sides.</span></p>'
          },
          {
            say: 'Now set the threshold yourself. Click the accumulator chart to move the red line, and watch the count of full forwards change. A stricter line recomputes more steps and stays closer to the exact trajectory.',
            card: { tag: 'TRY IT', title: 'Move the threshold', body: 'Click the accumulator chart. At <b>δ = 0.02</b> nearly every step still runs (37 of 50); at <b>0.11</b> only 14 do. The drift you accept before a refresh grows with δ.' },
            deep: '<p>The count is monotone in δ. In the flat middle of the trajectory the per-step change is Δ ≈ 0.019, so the accumulator needs about δ / Δ steps to cross the line: 2 at δ = 0.03, 3 at δ = 0.055, 6 at δ = 0.11. The early and late steps, where Δ is large, always trigger a refresh, so even a very loose δ cannot skip the two ends of the trajectory.</p>' +
              '<table><tr><th>δ</th><th>0.02</th><th>0.04</th><th>0.055</th><th>0.08</th><th>0.11</th></tr>' +
              '<tr><td>full forwards</td><td>37</td><td>27</td><td>23</td><td>18</td><td>14</td></tr>' +
              '<tr><td>speedup</td><td>1.35×</td><td>1.85×</td><td>2.17×</td><td>2.78×</td><td>3.57×</td></tr></table>' +
              '<p><span class="muted">δ bounds the accumulated change of the <i>input</i> proxy, not the output error. The fitted polynomial ties the two together, so δ has to be calibrated per model and sampler. The numbers are from this chamber\'s simulated Δ.</span></p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'STEP CACHING — SKIP FORWARDS THAT CHANGE LITTLE', 'TeaCache: the timestep-modulated input predicts how much the output will move', 'red');
          var N = 50, X0 = 130, SW = 17.4, BW = 12;
          function rel(i) { return 0.018 + 0.30 * Math.exp(-i / 2.5) + 0.10 * Math.exp((i - 49) / 3); }
          var DELTA = 0.055;
          function simulate(delta) {
            var acc = 0, out = [];
            for (var i = 0; i < N; i++) {
              var comp;
              if (i === 0) { comp = true; acc = 0; }
              else { acc += rel(i); comp = acc >= delta; }
              out.push({ r: rel(i), acc: acc, comp: comp });
              if (comp) acc = 0;
            }
            return out;
          }
          var sim = simulate(DELTA);
          var nComp = sim.filter(function (s) { return s.comp; }).length;
          /* chart 1: relative change (beat 1) */
          var C1 = ctx.group({ parent: G });
          var Y1 = 250, H1 = 200, Y1b = Y1 + H1;
          ctx.text(X0, Y1 - 14, 'Δ_t · relative L1 change of the modulated input (clipped at 0.12)', { size: 12, font: 'mono', color: 'dim', parent: C1 });
          ctx.line(X0 - 4, Y1b, X0 + N * SW, Y1b, { color: 'faint', parent: C1 });
          var bars1 = [];
          for (var b = 0; b < N; b++) {
            var hh = Math.min(0.12, sim[b].r) / 0.12 * H1;
            bars1.push(ctx.rect(X0 + b * SW, Y1b - hh, BW, hh, { rx: 2, fill: ctx.alpha('violet', 0.5), stroke: 'violet', sw: 0.8, parent: C1 }));
          }
          ctx.text(X0, Y1b + 16, 'step 0 (pure noise)', { size: 11, font: 'mono', color: 'dim', parent: C1 });
          ctx.text(X0 + N * SW, Y1b + 16, 'step 49 (clean)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: C1 });
          var cur1 = ctx.rect(X0 - 3, Y1 - 4, BW + 6, H1 + 8, { rx: 4, stroke: 'white', sw: 1.2, parent: G, glow: true });
          /* chart 2: accumulator (beat 2) */
          var C2 = ctx.group({ parent: G });
          var Y2 = 510, H2 = 110, Y2b = Y2 + H2;
          ctx.text(X0, Y2 - 14, 'accumulated Δ since the last full forward', { size: 12, font: 'mono', color: 'dim', parent: C2 });
          ctx.line(X0 - 4, Y2b, X0 + N * SW, Y2b, { color: 'faint', parent: C2 });
          var dy = Y2b - DELTA / 0.12 * H2;
          var dLine = ctx.line(X0 - 4, dy, X0 + N * SW, dy, { color: 'red', sw: 1.2, dash: '6 4', parent: C2 });
          var dLab = ctx.text(X0 + N * SW + 8, dy, 'δ', { size: 14, font: 'mono', weight: 700, color: 'red', parent: C2 });
          var bars2 = [];
          for (var c = 0; c < N; c++) {
            var h2 = Math.min(0.12, sim[c].acc) / 0.12 * H2;
            bars2.push(ctx.rect(X0 + c * SW, Y2b - h2, BW, h2, { rx: 2, fill: ctx.alpha(sim[c].comp ? 'red' : 'amber', 0.5), stroke: sim[c].comp ? 'red' : 'amber', sw: 0.8, parent: C2 }));
          }
          var C3 = ctx.group({ parent: G });
          ctx.text(X0, 660, 'decision', { size: 12, font: 'mono', color: 'dim', parent: C3 });
          var cells = [];
          for (var k = 0; k < N; k++) {
            cells.push(ctx.rect(X0 + k * SW, 676, BW, 22, { rx: 3, fill: sim[k].comp ? ctx.alpha('lime', 0.75) : 'none', stroke: sim[k].comp ? 'lime' : ctx.alpha('lime', 0.5), sw: 1, dash: sim[k].comp ? null : '2 2', parent: C3 }));
          }
          ctx.rect(X0, 716, 14, 12, { rx: 2, fill: ctx.alpha('lime', 0.75), stroke: 'lime', sw: 1, parent: C3 });
          ctx.text(X0 + 20, 722, 'full forward (40 blocks)', { size: 11.5, font: 'mono', color: 'text', parent: C3 });
          ctx.rect(X0 + 230, 716, 14, 12, { rx: 2, fill: 'none', stroke: ctx.alpha('lime', 0.5), dash: '2 2', sw: 1, parent: C3 });
          ctx.text(X0 + 250, 722, 'skip: out = x + cached residual', { size: 11.5, font: 'mono', color: 'text', parent: C3 });
          var cur2 = ctx.rect(X0 - 3, Y2 - 4, BW + 6, 698 - Y2 + 8, { rx: 4, stroke: 'white', sw: 1.2, parent: G, glow: true });
          /* right: counters and code (beat 2), related work (beat 4) */
          var R = ctx.group({ parent: G });
          ctx.text(1060, 262, 'FULL FORWARDS', { size: 12, font: 'mono', color: 'dim', parent: R });
          S.cnt = ctx.text(1060, 304, '0 / 50', { size: 36, font: 'display', weight: 700, color: 'lime', parent: R });
          S.spd = ctx.text(1060, 346, '', { size: 15, font: 'mono', color: 'white', parent: R });
          var code = ctx.code({ parent: G, x: 1060, y: 380, w: 480, title: 'TeaCache · per step', lang: 'py', size: 12, color: 'lime', lines: [
            'F = modulate(x, t_emb)          # 1st block input',
            'acc += poly(l1(F, F_prev) / l1(F_prev))',
            'if acc < delta:                  # cheap path',
            '    out = x + cached_residual',
            'else:                            # full path',
            '    out = dit(x); cached_residual = out - x',
            '    acc = 0'
          ] });
          var relP = ctx.para(1060, 610, [
            'early steps set the layout and change fast;',
            'so do late steps in some models → computed',
            'the middle is smooth → mostly skipped',
            'FasterCache + CFG-Cache: also skip',
            'many unconditional passes'
          ], { size: 12.5, font: 'mono', color: 'text', parent: G, lh: 22 });
          function lit1(n) { for (var q = 0; q < N; q++) bars1[q].setAttribute('opacity', q < n ? 1 : 0.08); cur1.setAttribute('x', X0 + Math.min(N - 1, n) * SW - 3); cur1.setAttribute('opacity', n >= N ? 0 : 1); }
          function lit2(n) {
            var cmp = 0;
            S.shown = n;
            for (var q = 0; q < N; q++) {
              var on = q < n;
              bars2[q].setAttribute('opacity', on ? 1 : 0.08);
              cells[q].setAttribute('opacity', on ? 1 : 0.08);
              if (on && sim[q].comp) cmp++;
            }
            S.cnt.textContent = cmp + ' / ' + n;
            S.spd.textContent = n ? ('speedup ≈ ' + (n / Math.max(1, cmp)).toFixed(2) + '×  ·  δ = ' + DELTA.toFixed(3)) : '';
            cur2.setAttribute('x', X0 + Math.min(N - 1, n) * SW - 3);
            cur2.setAttribute('opacity', n >= N ? 0 : 1);
          }
          lit1(0); lit2(0);
          /* beat 5: the threshold becomes a knob: re-run the simulation for any delta */
          function setDelta(d) {
            var yy = Y2b - d / 0.12 * H2;
            DELTA = d; sim = simulate(d);
            dLine.setAttribute('y1', yy); dLine.setAttribute('y2', yy); dLab.setAttribute('y', yy);
            for (var q = 0; q < N; q++) {
              var cp = sim[q].comp, hq = Math.min(0.12, sim[q].acc) / 0.12 * H2;
              bars2[q].setAttribute('y', Y2b - hq); bars2[q].setAttribute('height', hq);
              bars2[q].setAttribute('fill', ctx.alpha(cp ? 'red' : 'amber', 0.5)); bars2[q].setAttribute('stroke', ctx.color(cp ? 'red' : 'amber'));
              cells[q].setAttribute('fill', cp ? ctx.alpha('lime', 0.75) : 'none');
              cells[q].setAttribute('stroke', cp ? ctx.color('lime') : ctx.alpha('lime', 0.5));
              if (cp) cells[q].removeAttribute('stroke-dasharray'); else cells[q].setAttribute('stroke-dasharray', '2 2');
            }
            lit2(S.shown);
          }
          var dHit = ctx.rect(X0 - 4, Y2, N * SW + 4, H2, { fill: 'rgba(255,255,255,0.001)', parent: G });
          dHit.addEventListener('click', function (ev) {
            if (!S.tryDelta) return;
            var r = dHit.getBoundingClientRect();
            setDelta(ctx.clamp(Math.round((1 - (ev.clientY - r.top) / r.height) * 0.12 / 0.005) * 0.005, 0.02, 0.11));
          });
          hide([C1, cur1, C2, C3, cur2, R, code, relP]);
          /* beat 1: the relative change, step by step */
          ctx.reveal(C1, { from: 'up' }); ctx.reveal(cur1, { delay: 400 });
          return ctx.wait(900).then(function () {
            return ctx.tween(3600, function (t) { lit1(Math.round(t * N)); }, 'linear');
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: accumulate and threshold */
            ctx.reveal([C2, C3, R, code], { from: 'up', stagger: 150 });
            ctx.reveal(cur2, { delay: 500 });
            return ctx.wait(900).then(function () {
              return ctx.tween(2600, function (t) { lit2(Math.round(t * 14)); }, 'linear');
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the rest of the trajectory */
            ctx.hud('TeaCache: ' + nComp + ' of 50 forwards → ≈ ' + (50 / nComp).toFixed(1) + '× faster');
            return ctx.tween(4200, function (t) { lit2(Math.round(14 + t * (N - 14))); }, 'linear');
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: related work and the trade-off */
            return ctx.reveal(relP, { from: 'up' }).then(function () { return ctx.pulse(S.cnt, { color: 'lime', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: try it, click the accumulator chart to move delta; a short tour first */
            S.tryDelta = true;
            dHit.style.cursor = 'crosshair';
            ctx.hud('click the accumulator chart to move δ');
            ctx.highlight(dHit, { color: 'red', pad: 3, parent: G });
            return ctx.wait(500).then(function () { return ctx.tween(1300, function (t) { setDelta(0.055 - 0.035 * t); }, 'inOut'); })
              .then(function () { return ctx.tween(1700, function (t) { setDelta(0.02 + 0.09 * t); }, 'inOut'); })
              .then(function () { return ctx.tween(1200, function (t) { setDelta(t >= 1 ? 0.055 : 0.11 - 0.055 * t); }, 'inOut'); })
              .then(function () { return ctx.pulse(S.cnt, { color: 'lime', times: 2, dur: 600 }); });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Few-step students',
        beats: [
          {
            say: 'Caching trims redundancy; distillation removes it. The teacher integrates a curved probability flow path from noise to data in fifty guided steps, which is one hundred forward passes.',
            card: { tag: 'NUMBERS', title: 'The teacher: 100 forwards', stat: { v: '100', u: 'NFE', l: '50 solver steps × 2 guidance passes along a curved probability-flow path' } },
            deep: '<p>The teacher solves the probability-flow ODE from noise z ~ N(0, I) to data with an ODE solver (Wan\'s default is the higher-order UniPC). Each of the 50 steps needs the conditional and unconditional prediction, so the <b>number of function evaluations (NFE)</b> is 100 per shot.</p>' +
              '<p>The path is curved because the learned velocity field changes direction as noise resolves into structure; a solver with few steps cuts across the curve and lands off the data manifold. Distillation is about teaching a network to take those big steps correctly.</p>'
          },
          {
            say: 'A distilled student learns to jump instead. Each step predicts the clean sample directly, then re-noises to a lower noise level. After four such steps it lands on the same data manifold, with guidance already baked in.',
            card: { tag: 'NUMBERS', title: '25 times fewer forwards', stat: { v: '4', u: 'NFE', l: 'four student steps replace 100 teacher forwards: 25 times fewer per shot' } },
            deep: '<div class="eq">NFE: 50 steps × 2 (CFG) = 100  →  4 (guidance distilled)  ⇒  25× fewer forwards</div>' +
              '<p>Multi-step consistency sampling alternates <i>jump to x̂<sub>0</sub></i> and <i>re-noise to a lower t</i>, which is what the amber path shows. <b>Guidance distillation</b> feeds w as an input embedding so one pass replaces the conditional and unconditional pair.</p>' +
              '<details><summary>Go deeper</summary><p>Distribution matching updates the student G<sub>θ</sub> with ∇<sub>θ</sub>KL ≈ E[ (s<sub>fake</sub>(x<sub>t</sub>) − s<sub>real</sub>(x<sub>t</sub>)) · ∂G<sub>θ</sub>/∂θ ], where s<sub>real</sub> is the frozen teacher score and s<sub>fake</sub> a critic trained online on student samples. Consistency distillation instead trains f<sub>θ</sub> so that f(x<sub>t</sub>, t) = f(x<sub>t′</sub>, t′) along one probability-flow trajectory: every point on the path maps to the same x<sub>0</sub>, which is what allows one to four big jumps.</p></details>'
          },
          {
            say: 'Methods like DMD2 match the teacher\'s output distribution with an adversarial term, and consistency models learn to map any point on the path straight to its end. Causal students such as Self Forcing even stream video as it is generated.',
            card: { tag: 'STATE OF THE ART', title: 'DMD2, rCM, Self Forcing', body: 'Distribution matching, consistency along the ODE, adversarial post-training and causal rollouts: four routes to one to four step video generators.' },
            deep: '<table><tr><th>method</th><th>idea</th><th>steps</th></tr>' +
              '<tr><td>DMD2</td><td>minimise reverse KL to the teacher via the difference of two score networks (real vs fake) + GAN loss</td><td>4, CFG-free</td></tr>' +
              '<tr><td>consistency (sCM, rCM)</td><td>f(x<sub>t</sub>, t) = x<sub>0</sub> for every t on one PF-ODE path; rCM adds score regularisation, distilled Wan 2.1 14B</td><td>1–4</td></tr>' +
              '<tr><td>adversarial post-training (Seaweed-APT)</td><td>GAN fine-tune against real videos</td><td>1</td></tr>' +
              '<tr><td>CausVid / Self Forcing</td><td>causal (frame-autoregressive) students with KV cache, trained on their own rollouts</td><td>few, streaming</td></tr></table>'
          },
          {
            say: 'The price is some diversity and motion richness, because these objectives are mode seeking. One step models are brittle, and fast motion and fine texture can suffer.',
            card: { tag: 'TRADE-OFF', title: 'Speed costs diversity', body: 'Mode-seeking objectives narrow the output distribution. Fast motion and fine texture suffer first, and one-step models are the most brittle.' },
            deep: '<p><b>Trade-offs</b>: mode-seeking objectives (reverse KL, adversarial) reduce diversity because they reward samples that look like <i>some</i> real video rather than covering <i>all</i> of them; fast motion and fine texture can suffer; 1-step models are brittle and hard to steer with prompts.</p>' +
              '<p>Distilled students also lose some controllability: guidance strength is baked in, so the knob that used to trade fidelity for diversity at inference time is gone.</p>'
          },
          {
            say: 'So production systems serve the student for drafts and most finals, and keep the teacher, with caching, for the hero shots that the critic flags.',
            card: { tag: 'WHY IT MATTERS', title: 'A quality dial per call', body: 'The orchestrator picks the rung per request: student for exploration, teacher with caching for hero shots. Same model family, twenty five times apart in cost.' },
            deep: '<p>Production systems often serve the student for drafts and previews and the teacher (with step caching) for hero shots. The routing decision belongs to the orchestration plane: it sees the critic\'s verdict, the deadline and the GPU queue, and picks the cheapest rung that is likely to pass review.</p>' +
              '<p>A common pattern is <b>draft with the student, refine with the teacher</b>: approved draft latents seed the expensive pass (last step of this chamber).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'FEW-STEP STUDENTS — 100 FORWARDS BECOME 4', 'distil the 50-step, CFG-guided teacher into a 4-step, guidance-free student', 'red');
          var P = ctx.group({ parent: G });
          ctx.rect(70, 240, 700, 480, { rx: 12, fill: 'rgba(255,255,255,0.015)', stroke: 'line', sw: 1, parent: P });
          ctx.text(90, 262, 'latent space (schematic)', { size: 11.5, font: 'mono', color: 'dim', parent: P });
          ctx.path('M110,650 C300,600 480,690 740,560', { stroke: ctx.alpha('lime', 0.25), sw: 26, parent: P });
          ctx.text(700, 610, 'data manifold', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: P });
          ctx.circle(170, 300, 9, { fill: 'white', parent: P, glow: true });
          ctx.text(186, 300, 'z ~ N(0, I)', { size: 12.5, font: 'mono', color: 'white', parent: P });
          function tq(t) { var a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; return { x: a * 170 + b * 240 + c * 560, y: a * 300 + b * 590 + c * 622 }; }
          var teacher = ctx.path('M170,300 Q240,590 560,622', { stroke: ctx.alpha('lime', 0.8), sw: 1.6, parent: P });
          var dots = [];
          for (var i = 1; i <= 50; i++) { var pt = tq(i / 50); dots.push(ctx.circle(pt.x, pt.y, 2.6, { fill: 'lime', parent: P })); }
          var tl = ctx.text(96, 694, 'teacher (green dots): 50 solver steps × 2 (CFG) along the curved PF-ODE path', { size: 12, font: 'mono', color: 'lime', parent: P });
          /* student: jump / renoise (beat 2) */
          var J = [[170, 300, 470, 640], [470, 640, 380, 430], [380, 430, 530, 628], [530, 628, 470, 520], [470, 520, 552, 624], [552, 624, 530, 570], [530, 570, 560, 622]];
          var sp = [];
          J.forEach(function (j, k) {
            var jump = k % 2 === 0;
            sp.push(ctx.path('M' + j[0] + ',' + j[1] + ' L' + j[2] + ',' + j[3], { stroke: jump ? 'amber' : ctx.alpha('amber', 0.6), sw: jump ? 2.4 : 1.4, dash: jump ? null : '4 4', arrow: true, parent: P }));
          });
          var slab = ctx.text(470, 380, 'student: 4 jumps to x₀ · re-noise', { size: 12, font: 'mono', color: 'amber', parent: P });
          ctx.circle(560, 622, 7, { fill: 'lime', stroke: 'white', sw: 1.5, parent: P });
          /* NFE bars */
          var NBt = ctx.group({ parent: G });
          ctx.text(70, 762, 'NFEs per shot', { size: 12, font: 'mono', color: 'dim', parent: NBt });
          var tb = ctx.rect(230, 752, 520, 22, { rx: 3, fill: ctx.alpha('lime', 0.4), stroke: 'lime', sw: 1, parent: NBt });
          var tbT = ctx.text(740, 763, 'teacher 100', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: NBt });
          var NBs = ctx.group({ parent: G });
          var sb = ctx.rect(230, 786, 520 * 4 / 100, 22, { rx: 3, fill: ctx.alpha('amber', 0.6), stroke: 'amber', sw: 1, parent: NBs });
          var sbT = ctx.text(262, 797, 'student 4  →  25× fewer forward passes', { size: 12, font: 'mono', weight: 700, color: 'amber', parent: NBs });
          /* methods (beat 3) */
          var M = ctx.group({ parent: G });
          ctx.text(820, 262, 'HOW STUDENTS ARE MADE', { size: 13, font: 'display', weight: 700, color: 'white', parent: M });
          var rows = [
            ['DMD2', 'distribution matching (2 score nets) + GAN', '4 · no CFG'],
            ['sCM / rCM', 'consistency along the PF-ODE; rCM: Wan 14B', '1–4'],
            ['Seaweed-APT', 'adversarial post-training on real video', '1'],
            ['CausVid · Self Forcing', 'causal few-step student, KV-cached rollout', 'streaming'],
            ['guidance distill', 'w becomes an input: 1 pass, not 2', '÷ 2']
          ];
          var rowEls = rows.map(function (r, k) {
            var y = 300 + k * 62;
            var g = ctx.group({ parent: M });
            ctx.rect(820, y - 22, 720, 52, { rx: 8, fill: 'rgba(255,255,255,0.025)', stroke: 'line', sw: 1, parent: g });
            ctx.text(836, y - 3, r[0], { size: 13, font: 'mono', weight: 700, color: 'amber', parent: g });
            ctx.text(836, y + 16, r[1], { size: 12, font: 'mono', color: 'text', parent: g });
            ctx.text(1524, y + 6, r[2], { size: 13, font: 'mono', weight: 700, color: 'lime', anchor: 'end', parent: g });
            return g;
          });
          /* price (beat 4) and routing (beat 5) */
          var price = ctx.para(820, 640, [
            'price: mode-seeking → less diversity; fast motion and fine',
            'texture can stiffen; 1-step models are brittle'
          ], { size: 12.5, font: 'mono', color: 'dim', parent: G, lh: 22 });
          var route = ctx.group({ parent: G });
          ctx.text(820, 700, 'ROUTING, PER CALL', { size: 12, font: 'mono', color: 'dim', parent: route });
          ctx.label(820, 732, 'exploration and drafts → 4-step student', { color: 'cyan', size: 12, anchor: 'start', parent: route });
          ctx.label(820, 768, 'most finals → student, fast path', { color: 'lime', size: 12, anchor: 'start', parent: route });
          ctx.label(820, 804, 'hero shots the critic flags → teacher + step caching', { color: 'amber', size: 12, anchor: 'start', parent: route });
          hide(dots); hide(sp); hide([slab, tl, tb, tbT, NBt, NBs, M, price, route]); hide(rowEls);
          tb.setAttribute('width', 0); sb.setAttribute('width', 0);
          /* beat 1: the teacher's curved path */
          ctx.reveal(P, { from: 'left' });
          ctx.reveal(teacher, { from: 'draw', dur: 900, delay: 300 });
          ctx.reveal(NBt, { from: 'up', delay: 600 });
          return ctx.wait(1000).then(function () {
            ctx.reveal(tl, { dur: 300 });
            ctx.reveal(tb, { dur: 100 }); ctx.reveal(tbT, { delay: 1500, dur: 300 });
            ctx.animate(tb, { width: [0, 520] }, 1800, 'linear');
            return ctx.reveal(dots, { stagger: 36, dur: 120 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: four jumps */
            ctx.hud('100 NFE → 4 NFE (25×)');
            ctx.reveal(NBs, { from: 'up' });
            ctx.reveal(slab, { dur: 300 });
            ctx.animate(sb, { width: [0, 520 * 4 / 100] }, 500, 'out', 200);
            return ctx.reveal(sp, { from: 'draw', stagger: 280, dur: 260 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: how students are made */
            return ctx.reveal(M, { from: 'right' }).then(function () { return ctx.reveal(rowEls, { from: 'right', stagger: 160 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the price */
            return ctx.reveal(price, { from: 'up' }).then(function () { return ctx.pulse(rowEls[0], { color: 'red', dur: 600 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: routing */
            return ctx.reveal(route, { from: 'up' }).then(function () { return ctx.pulse(NBs, { color: 'amber', dur: 700 }); });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Cheaper attention',
        beats: [
          {
            say: 'Since attention is almost eighty percent of the work, it is where to save. But Amdahl\'s law bites: making attention twice as fast speeds the whole model by only one point six five times, and even infinitely fast attention would cap out below five.',
            card: { tag: 'NUMBERS', title: 'Amdahl caps the gain', stat: { v: '1.65×', l: 'end-to-end gain from a 2× faster attention kernel when attention is 79 % of the FLOPs' },
              more: '<p>Amdahl: speedup = 1 / ((1 − a) + a / s). With a = 0.79, s = 2 gives 1 / (0.21 + 0.395) = 1.65; s = 3 gives 2.11; s → ∞ gives 1 / 0.21 = 4.76. The 21 % that is not attention (linear layers) becomes the bottleneck, which is why quantised GEMMs matter too.</p>' },
            deep: '<div class="eq">end-to-end speedup = 1 / ( (1 − a) + a / s ),   a = 0.79:   s = 2 → 1.65×,  s = 3 → 2.11×</div>' +
              '<p>The remaining 21 % (linear layers) can take FP8 GEMMs with per-block scales (the H100\'s FP8 peak is 2× its BF16 peak, so realised gains are smaller, and weights drop to 14 GB), so the Amdahl ceiling moves as well. Attention is 79 % only at N = 111,600; at lower resolution or shorter clips the share is smaller and the gain from attention tricks shrinks accordingly.</p>'
          },
          {
            say: 'SageAttention quantizes it. Queries and keys go to eight bit integers after smoothing out the key\'s shared bias, the softmax stays in higher precision, and in the second version the probability times value product runs in FP8.',
            card: { tag: 'HOW IT WORKS', title: 'Smooth K, then quantize', body: 'Subtracting the token mean of K removes channel outliers and leaves softmax unchanged. Then Q and K fit in INT8, and P times V runs in FP8 with FP32 accumulation.' },
            deep: '<p><b>SageAttention</b>: per-block INT8 quantisation of Q and K; <b>smooth K</b> first (K ← K − mean<sub>tokens</sub>(K)), which removes the channel-wise outliers shared by all tokens and does not change softmax (it shifts every logit in a row by the same constant). P̃V in FP16 (v1) or FP8 with two-level FP32 accumulation (v2, whose default QK path is per-thread INT4, with an INT8 variant shown here).</p>' +
              '<p>The INT8 matmul accumulates in INT32 and is dequantised before the online softmax, so the exponentials and running sums stay in FP32. SageAttention3 targets FP4 on Blackwell.</p>'
          },
          {
            say: 'The papers report kernels two to three times faster than FlashAttention two on an RTX 4090, at negligible quality loss. The linear layers can take FP8 as well, which moves the Amdahl ceiling.',
            card: { tag: 'NUMBERS', title: 'Two to three times faster kernels', stat: { v: '2.1×', l: 'end-to-end gain from a 3× faster attention kernel (SageAttention2 class): 1 / (0.21 + 0.79 / 3)' } },
            deep: '<p>Reported kernel speedups over FlashAttention-2: ≈ 2.1× (v1) and ≈ 3× (v2, on an RTX 4090), at negligible end-to-end metric loss. On Hopper GPUs v2 is reported to match FlashAttention-3\'s FP8 speed with much better accuracy, so against an FA3 baseline expect less than 3×. Applied to the 79 % share, 2× gives 1.65× and 3× gives 2.11× end to end.</p>' +
              '<p>Quantised attention is a plug-and-play kernel swap: no retraining, and it composes with sequence parallelism, since each GPU quantises its own blocks. Validate it per model after distillation: a 4-step student has fewer, larger steps, so quantisation error has fewer steps to average out.</p>'
          },
          {
            say: 'Sparse attention skips work instead. In video most heads look locally in space and time, so sliding tile attention keeps only nearby three dimensional tiles and drops the rest of the matrix.',
            card: { tag: 'HOW IT WORKS', title: 'Keep tiles, not tokens', body: 'Tokens are grouped into 3-D tiles. A query tile attends only to tiles within a window. Every kept block is dense, so the kernel stays at tensor-core speed.' },
            deep: '<p><b>Sparse attention</b>: tokens are ordered in 3-D tiles (t, h, w); a query tile attends only to tiles within a window. At tile granularity every kept block is dense, so kernels stay at tensor-core efficiency, unlike token-level masks which leave the hardware idle.</p>' +
              '<ul><li><b>Sliding Tile Attention</b>: HunyuanVideo 720p 945 s → 685 s training-free, 268 s after fine-tuning (reported).</li>' +
              '<li><b>Sparse VideoGen</b>: profiles heads online as spatial or temporal and applies matching masks, up to ≈ 2.3× end-to-end (2.28× on CogVideoX-v1.5, 2.33× on HunyuanVideo).</li></ul>'
          },
          {
            say: 'Click any query tile to see the three dimensional neighbourhood it attends to. A few global heads stay dense, because the identity of the fox across the shot lives there.',
            card: { tag: 'TRY IT', title: 'Click a query tile', body: 'Each row of the mask is one query tile; the grid on the right shows its space time neighbourhood. Try tile 0 in a corner against tile 23.' },
            deep: '<p>The mask here uses 24 tiles = 4 (t) × 3 (h) × 2 (w) and a window of |Δt| ≤ 1, |Δh| ≤ 1, any w. That keeps 280 of the 576 tile blocks (49 %); a corner tile keeps only 8 neighbours, an interior tile 18. At real scale, with hundreds of tiles per axis, the kept fraction falls to a few percent.</p>' +
              '<p><b>Risk</b>: long-range consistency (the fox\'s helmet across the shot) lives in the few global heads, so production recipes keep a subset of heads dense and sparsify the rest, and often fall back to dense attention in the first steps of the trajectory.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'CHEAPER ATTENTION — IT IS 79 % OF THE FLOPs', 'quantise it (SageAttention) or skip most of it (sliding-tile sparsity)', 'red');
          /* beat 1: Amdahl */
          var AM = ctx.group({ parent: G });
          var am = function (s) { return 1 / (0.21 + 0.79 / s); };
          var PL = ctx.plot(110, 520, 600, 230, am, { xDomain: [1, 5], yDomain: [1, 3.6], color: 'lime', sw: 2.4, yLabel: 'end-to-end speedup', parent: AM });
          ctx.text(710, 788, 'attention kernel speedup s', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: AM });
          [1, 2, 3, 4, 5].forEach(function (v) { ctx.text(PL.toPx(v, 1).x, 766, v + '×', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: AM }); });
          ctx.text(700, 540, 'ceiling 1/(1 − 0.79) = 4.8×', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: AM });
          ctx.text(60, 490, 'AMDAHL: speedup = 1 / ((1 − a) + a / s),  a = 0.79', { size: 13, font: 'display', weight: 700, color: 'white', parent: AM });
          /* beat 3: two marked points */
          var DT = ctx.group({ parent: G });
          [[2, '2× kernel (SageAttention)'], [3, '3× kernel (SageAttention2)']].forEach(function (p) {
            var q = PL.toPx(p[0], am(p[0]));
            ctx.circle(q.x, q.y, 5, { fill: 'amber', parent: DT, glow: true });
            ctx.text(q.x + 8, q.y + 16, am(p[0]).toFixed(2) + '×', { size: 12, font: 'mono', weight: 700, color: 'amber', parent: DT });
            ctx.text(q.x + 8, q.y + 32, p[1], { size: 11, font: 'mono', color: 'dim', parent: DT });
          });
          /* beat 2: Sage dataflow */
          var SG = ctx.group({ parent: G });
          ctx.text(60, 250, 'SAGEATTENTION DATAFLOW (one tile)', { size: 13, font: 'display', weight: 700, color: 'white', parent: SG });
          function mat(x, y, w, h, lab, prec, col) {
            var g = ctx.group({ parent: SG });
            ctx.rect(x, y, w, h, { rx: 4, fill: ctx.alpha(col, 0.2), stroke: col, sw: 1.2, parent: g });
            ctx.text(x + w / 2, y + h / 2, lab, { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: g });
            ctx.label(x + w / 2, y + h + 16, prec, { color: col, size: 11, parent: g });
            return g;
          }
          var ms = [
            mat(60, 290, 70, 90, 'Q', 'INT8', 'amber'),
            mat(160, 290, 70, 90, 'K−mean', 'INT8', 'amber'),
            mat(290, 290, 90, 90, 'S=QKᵀ', 'INT32→FP32', 'violet'),
            mat(420, 290, 90, 90, 'softmax P', 'FP8', 'cyan'),
            mat(530, 290, 70, 90, 'V', 'FP8', 'cyan'),
            mat(640, 290, 90, 90, 'O', 'FP32 acc', 'lime')
          ];
          var sgArr = ctx.group({ parent: SG });
          ctx.text(145, 335, '·', { size: 22, color: 'white', anchor: 'middle', parent: sgArr });
          ctx.line(236, 335, 284, 335, { color: 'dim', arrow: true, parent: sgArr });
          ctx.line(386, 335, 414, 335, { color: 'dim', arrow: true, parent: sgArr });
          ctx.text(520, 335, '·', { size: 22, color: 'white', anchor: 'middle', parent: sgArr });
          ctx.line(606, 335, 634, 335, { color: 'dim', arrow: true, parent: sgArr });
          ctx.text(400, 282, 'online softmax', { size: 11, font: 'mono', color: 'violet', anchor: 'middle', parent: sgArr });
          var sgT = ctx.group({ parent: SG });
          ctx.text(60, 424, 'smooth K: subtract the token-mean → outliers vanish,', { size: 12, font: 'mono', color: 'text', parent: sgT });
          ctx.text(60, 444, 'softmax unchanged (constant shift per row)', { size: 12, font: 'mono', color: 'text', parent: sgT });
          /* beat 4: sliding tile mask */
          var B = ctx.group({ parent: G });
          ctx.text(820, 250, 'SLIDING TILE ATTENTION · 24 tiles = 4 (t) × 3 (h) × 2 (w)', { size: 13, font: 'display', weight: 700, color: 'white', parent: B });
          var T = [];
          for (var t = 0; t < 4; t++) for (var h = 0; h < 3; h++) for (var w = 0; w < 2; w++) T.push([t, h, w]);
          var NT = T.length;
          function near(a, b) { return Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1; }
          var MX = 860, MY = 290, CS = 16;
          var dense = 0;
          for (var q1 = 0; q1 < NT; q1++) for (var k1 = 0; k1 < NT; k1++) if (near(T[q1], T[k1])) dense++;
          S.mask = ctx.matrix(MX, MY, NT, NT, { cell: CS - 2, gap: 2, values: function (r, c) { return near(T[r], T[c]) ? ctx.alpha('red', 0.45) : 'rgba(255,255,255,0.03)'; }, parent: B });
          ctx.text(MX + NT * CS / 2, MY + NT * CS + 18, 'key tiles →', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          ctx.text(MX - 10, MY + NT * CS / 2, 'query tiles', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', rotate: -90, parent: B });
          ctx.text(820, 716, 'kept: ' + dense + ' / ' + NT * NT + ' tile blocks = ' + Math.round(100 * dense / (NT * NT)) + ' % · window |Δt| ≤ 1, |Δh| ≤ 1, any w', { size: 12, font: 'mono', color: 'text', parent: B });
          var stat1 = ctx.para(820, 752, [
            'STA on HunyuanVideo 720p: 945 s → 685 s training-free, 268 s fine-tuned',
            'Sparse VideoGen: spatial vs temporal heads, up to ≈ 2.3× end-to-end'
          ], { size: 12, font: 'mono', color: 'dim', parent: B, lh: 22 });
          /* beat 5: the 3-D neighbourhood of the selected tile */
          var NV = ctx.group({ parent: G });
          ctx.text(1270, 290, 'query tile (solid) + kept', { size: 11.5, font: 'mono', color: 'dim', parent: NV });
          ctx.text(1270, 306, 'h rows × w cols per t slab', { size: 11, font: 'mono', color: 'dim', parent: NV });
          var vt = [];
          for (var tt = 0; tt < 4; tt++) {
            ctx.text(1270, 346 + tt * 94, 't = ' + tt, { size: 11.5, font: 'mono', color: 'dim', parent: NV });
            for (var hh = 0; hh < 3; hh++) for (var ww = 0; ww < 2; ww++) {
              vt.push(ctx.rect(1330 + ww * 58, 322 + tt * 94 + hh * 25, 54, 22, { rx: 3, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('faint', 1), sw: 1, parent: NV }));
            }
          }
          S.rowHi = ctx.rect(MX - 2, MY - 1, NT * CS + 2, CS, { rx: 3, stroke: 'white', sw: 1.4, parent: B, glow: true });
          function selectQ(q) {
            S.rowHi.setAttribute('y', MY + q * CS - 1);
            for (var z = 0; z < NT; z++) {
              var isQ = z === q, nb = near(T[q], T[z]);
              vt[z].setAttribute('fill', isQ ? ctx.alpha('white', 0.8) : (nb ? ctx.alpha('red', 0.5) : 'rgba(255,255,255,0.03)'));
              vt[z].setAttribute('stroke', isQ ? ctx.C.white : (nb ? ctx.C.red : ctx.C.faint));
            }
          }
          for (var rr = 0; rr < NT; rr++) {
            (function (rr) {
              for (var cc = 0; cc < NT; cc++) {
                var cel = S.mask.cells[rr][cc];
                cel.style.cursor = 'pointer';
                cel.addEventListener('click', function () { selectQ(rr); });
              }
            })(rr);
          }
          var guard = ctx.text(820, 818, 'keep global heads dense: identity of the fox across the shot lives there', { size: 12, font: 'mono', color: 'dim', parent: B });
          selectQ(7);
          hide([AM, PL.curve, DT, SG, sgArr, sgT, B, NV, S.rowHi, guard]); hide(ms);
          /* beat 1: Amdahl's law */
          return Promise.all([ctx.reveal(AM, { from: 'left' }), ctx.reveal(PL.curve, { from: 'draw', dur: 1200, delay: 500 })]).then(function () {
            return ctx.pulse(PL.curve, { color: 'lime', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: SageAttention dataflow */
            ctx.reveal(SG, { from: 'up' });
            return ctx.reveal(ms, { from: 'up', stagger: 140, delay: 200 }).then(function () {
              return Promise.all([ctx.reveal(sgArr, { delay: 100 }), ctx.reveal(sgT, { from: 'up', delay: 200 })]);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: kernels 2-3x faster, on the Amdahl curve */
            ctx.hud('attention 2× faster → 1.65× end-to-end');
            return ctx.reveal(DT, {}).then(function () { return ctx.pulse(DT, { color: 'amber', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: sparse tiles */
            return ctx.reveal(B, { from: 'right' }).then(function () { return ctx.pulse(S.mask, { color: 'red', dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: try it; a short automatic tour first */
            ctx.reveal([NV, S.rowHi, guard], { from: 'up', stagger: 150 });
            return [9, 0, 16, 23, 7].reduce(function (p, q) {
              return p.then(function () { selectQ(q); return ctx.wait(800); });
            }, ctx.wait(900));
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Pools, pipelines, VAE',
        beats: [
          {
            say: 'Now zoom out from one forward pass to the whole shot list. Stages have different appetites, so they run on different pools: a small pool encodes prompts, two gangs of eight GPUs run the denoiser, a VAE pool decodes, and hardware encoders package the clips.',
            card: { tag: 'KEY IDEA', title: 'One pool per appetite', body: 'The eight-GPU DiT gang is the scarce resource. Text encoder, VAE and encoders run on cheaper or shared GPUs so that the gang never waits for them.' },
            deep: '<p><b>Stage pools</b>: the DiT gang (8 GPUs, gang-scheduled, NVLink) is the scarce resource; the text encoder and VAE run on cheaper or shared GPUs so the gang never idles. Only latents move between pools (14.3 MB per shot at 720p), never pixels. Encoding needs NVENC blocks, which the H100 lacks, so that lane runs on L4 or L40S-class cards.</p>' +
              '<p>Each pool scales on its own signal: gang availability for the DiT, queue depth for the VAE pool. The scheduler chamber covers gang placement, preemption and cold starts.</p>'
          },
          {
            say: 'The gangs alternate shots, so the scarce GPUs never idle. While a gang denoises shot three, the VAE pool is already decoding shot one, and encoding overlaps both.',
            card: { tag: 'NUMBERS', title: 'A shot every six seconds', stat: { v: '6 s', l: 'two gangs at about 12 s of denoising per shot finish one shot every 6 s; an 8-GPU VAE pool at 6 s per shot keeps pace' } },
            deep: '<p>Illustrative fast path: ≈ 12 s of DiT (4-step student, FP8 attention) plus ≈ 6 s of tiled VAE per shot. Two gangs alternating finish one shot every 6 s, and the VAE pool, at 6 s per shot, exactly keeps pace, so neither stage becomes the bottleneck.</p>' +
              '<p>Six shots complete in about 50 s: three rounds of 12 s of denoising for each gang, the last VAE decode, and the mux. Pipelining hides everything except the first denoise and the last decode.</p>'
          },
          {
            say: 'The VAE decode is itself parallelised. Each latent frame is split into overlapping tiles across the eight GPUs, decoded independently, and feather blended at the seams.',
            card: { tag: 'NUMBERS', title: 'Six times faster decode', stat: { v: '40 → 6 s', l: 'VAE decode of one shot: one GPU versus eight GPUs with overlapping 2 × 4 tiles (estimate)' },
              more: '<p>An ideal 8-way split would take 40 / 8 = 5 s. Overlapping tiles recompute a halo (a 1/8 overlap on each shared edge, about 15 % extra area) and boundary rows must be exchanged, so 5 s × 1.15 ≈ 6 s. Temporal chunking cannot be parallelised because the decoder is causal, so spatial tiling is the only lever.</p>' },
            deep: '<p><b>Tiled VAE decode</b>: split each latent frame spatially into overlapping tiles (here 2 × 4, one per GPU, with about 1/8 overlap), decode tiles on different GPUs (xDiT\'s patch-parallel VAE, DistVAE) and feather-blend the overlaps to avoid seams. Estimate: ≈ 40 s on one GPU → ≈ 6 s on the 8-GPU pool (overlap recompute and halo exchange cost ≈ 15 %):</p>' +
              '<div class="eq">x(p) = Σ<sub>k</sub> w<sub>k</sub>(p)·x<sub>k</sub>(p) / Σ<sub>k</sub> w<sub>k</sub>(p),   w<sub>k</sub> linear ramp over the overlap</div>'
          },
          {
            say: 'In time, a causal VAE decodes in chunks: the first latent frame gives one pixel frame, and every later one gives four, carrying a small cache between chunks. Peak memory is bounded by one chunk instead of the whole clip.',
            card: { tag: 'WHY IT MATTERS', title: 'Memory bounded by a chunk', body: 'Decoding the whole clip at once needs about 21 GB for one full-resolution activation. A causal chunked decode keeps peak memory near one chunk.' },
            deep: '<p><b>Temporal causality</b>: Wan-style causal 3-D VAEs decode one latent frame at a time — latent 0 → 1 pixel frame, every later latent → 4 pixel frames — carrying a small cache of the last causal-conv inputs, so peak memory is bounded by one chunk rather than 121 frames (one full-resolution 96-channel activation of the whole clip would be ~21 GB in BF16).</p>' +
              '<p>Chunked decode also starts streaming pixels before the last latent is even decoded, which is what lets the encode stage overlap with the VAE.</p>'
          },
          {
            say: 'And drafts come first. A quick low resolution preview lets the critic reject bad shots in seconds, before any expensive final render. Approved drafts are then refined at seven twenty p.',
            card: { tag: 'WHY IT MATTERS', title: 'Kill bad shots at draft cost', body: 'A 480p, 4-step draft takes about 5 to 7 seconds. The critic rejects at that price; only approved shots pay for the 720p refinement.' },
            deep: '<p><b>Draft → refine</b>: a 480p, 4-step preview (48,360 tokens; attention ≈ 0.19× of 720p) lets the critic reject bad shots in seconds; approved drafts are refined at 720p, either with a full pass or SDEdit-style by re-noising the upsampled draft latent to t ≈ 0.6 and denoising only the remaining steps.</p>' +
              '<p>Rejected drafts are re-prompted or re-seeded by the creative agents. Because rejection happens at draft cost, the expected GPU bill per accepted shot falls sharply.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [0, 1, 2, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'STAGE POOLS, PIPELINING & TILED VAE', 'keep the scarce 8-GPU DiT gangs busy 100 % of the time', 'red');
          /* Gantt (beats 1-2) */
          var GT = ctx.group({ parent: G });
          var X0 = 240, SC = 14.4, Y0 = 262, RH = 50, TMAX = 50;
          var lanes = [['text enc · 1 GPU', 'amber'], ['DiT gang A · 8 GPU', 'lime'], ['DiT gang B · 8 GPU', 'lime'], ['VAE pool · 8 GPU', 'violet'], ['encode / mux · L4', 'orange']];
          lanes.forEach(function (l, i) {
            ctx.text(X0 - 12, Y0 + i * RH + 18, l[0], { size: 12, font: 'mono', color: l[1], anchor: 'end', parent: GT });
            ctx.rect(X0, Y0 + i * RH, TMAX * SC, RH - 12, { rx: 4, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('faint', 0.7), sw: 1, parent: GT });
          });
          for (var s = 0; s <= TMAX; s += 10) ctx.text(X0 + s * SC, Y0 + 5 * RH + 4, s + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: GT });
          var SHC = ['cyan', 'violet', 'amber', 'pink', 'teal', 'orange'];
          var blocks = [];
          function blk(lane, t0, t1, shot, lab) {
            var r = ctx.group({ parent: GT });
            ctx.rect(X0 + t0 * SC + 1, Y0 + lane * RH + 3, Math.max(4, (t1 - t0) * SC - 2), RH - 18, { rx: 3, fill: ctx.alpha(SHC[shot], 0.45), stroke: SHC[shot], sw: 1, parent: r });
            if (lab && (t1 - t0) * SC > 34) ctx.text(X0 + (t0 + t1) / 2 * SC, Y0 + lane * RH + 18, lab, { size: 11, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: r });
            r.t0 = t0;
            r.setAttribute('opacity', 0);
            blocks.push(r);
          }
          for (var k = 0; k < 6; k++) {
            var gang = k % 2, slot = Math.floor(k / 2);
            var te0 = slot * 12 + gang * 6;
            blk(0, te0, te0 + 0.3, k, '');
            var d0 = te0 + 0.3, d1 = d0 + 12;
            blk(1 + gang, d0, d1, k, 'shot ' + (k + 1));
            var v0 = d1, v1 = v0 + 5.8;
            blk(3, v0, v1, k, 'shot ' + (k + 1));
            blk(4, v1, v1 + 0.8, k, '');
          }
          var gNote = ctx.group({ parent: G });
          ctx.text(X0, Y0 + 5 * RH + 30, 'illustrative fast path: ≈ 12 s DiT (4-step student, FP8 attn) + ≈ 6 s tiled VAE per shot;', { size: 11.5, font: 'mono', color: 'dim', parent: gNote });
          ctx.text(X0, Y0 + 5 * RH + 48, 'two gangs finish a shot every 6 s, so an 8-GPU VAE pool at 6 s / shot keeps pace', { size: 11.5, font: 'mono', color: 'dim', parent: gNote });
          /* tiled VAE (beat 3) */
          var VT = ctx.group({ parent: G });
          ctx.text(1060, 262, 'TILED + CAUSAL VAE DECODE', { size: 13, font: 'display', weight: 700, color: 'white', parent: VT });
          var FX = 1080, FY = 284, FW = 420, FH = 236;
          ctx.rect(FX, FY, FW, FH, { rx: 4, fill: '#081026', stroke: ctx.alpha('violet', 0.7), sw: 1.2, parent: VT });
          ctx.circle(FX + FW * 0.76, FY + FH * 0.3, 30, { fill: '#d2f3ff', opacity: 0.9, parent: VT });
          ctx.rect(FX + 1, FY + FH * 0.76, FW - 2, FH * 0.24 - 1, { rx: 0, fill: ctx.alpha('cyan', 0.3), parent: VT });
          ctx.circle(FX + FW * 0.5, FY + FH * 0.62, 24, { fill: '#ff8a3d', stroke: '#e8f1ff', sw: 2, parent: VT });
          var tiles = [];
          var tw = FW / 4, th = FH / 2, ov = 9;
          for (var ty = 0; ty < 2; ty++) for (var tx = 0; tx < 4; tx++) {
            var gi = ty * 4 + tx;
            var x = FX + tx * tw - (tx ? ov : 0), y = FY + ty * th - (ty ? ov : 0);
            var w = tw + (tx ? ov : 0) + (tx < 3 ? ov : 0), h = th + (ty ? ov : 0) + (ty < 1 ? ov : 0);
            var tg = ctx.group({ parent: VT });
            ctx.rect(x, y, Math.min(w, FX + FW - x), Math.min(h, FY + FH - y), { rx: 3, fill: ctx.alpha(HG[gi], 0.1), stroke: HG[gi], sw: 1.4, dash: '6 3', parent: tg });
            ctx.label(FX + tx * tw + tw / 2, FY + ty * th + (ty ? 36 : 16), 'GPU ' + gi, { color: HG[gi], size: 11, parent: tg });
            tiles.push(tg);
          }
          ctx.text(FX, FY + FH + 20, '2 × 4 tiles, one per GPU · overlap feather-blended · xDiT', { size: 11.5, font: 'mono', color: 'text', parent: VT });
          /* causal chunks (beat 4) */
          var VC = ctx.group({ parent: G });
          ctx.text(FX, FY + FH + 52, 'time: 1 frame, then 4 frames per latent frame + causal cache', { size: 11.5, font: 'mono', color: 'dim', parent: VC });
          var chunks = [];
          for (var c = 0; c < 9; c++) {
            var cw = c === 0 ? 14 : 40;
            var cx0 = FX + (c === 0 ? 0 : 20 + (c - 1) * 46);
            chunks.push(ctx.rect(cx0, FY + FH + 66, cw, 18, { rx: 3, fill: ctx.alpha('violet', 0.5), stroke: 'violet', sw: 1, parent: VC }));
          }
          /* draft → refine (beat 5) */
          var DR = ctx.group({ parent: G });
          ctx.text(60, 604, 'DRAFT → REFINE', { size: 13, font: 'display', weight: 700, color: 'white', parent: DR });
          var n1 = ctx.node({ x: 170, y: 680, w: 210, h: 64, title: 'draft 480p', sub: '4 steps · ≈ 5–7 s', color: 'cyan', titleSize: 14, subSize: 11, parent: DR });
          var n2 = ctx.node({ x: 450, y: 680, w: 210, h: 64, title: 'critic / creator', sub: 'approve or re-prompt', icon: 'eye', color: 'magenta', titleSize: 14, subSize: 11, parent: DR });
          var n3 = ctx.node({ x: 760, y: 680, w: 250, h: 64, title: 'refine 720p', sub: 're-noise to t≈0.6, denoise', color: 'lime', titleSize: 14, subSize: 11, parent: DR });
          var d1l = ctx.link(n1, n2, { from: 'r', to: 'l', color: 'cyan', parent: DR });
          var d2l = ctx.link(n2, n3, { from: 'r', to: 'l', color: 'lime', label: 'approved', parent: DR });
          var d3l = ctx.link(n2, n1, { from: 'b', to: 'b', color: 'magenta', bend: { x: 310, y: 790 }, dash: '4 4', label: 'rejected: new seed', labelDy: 26, parent: DR });
          ctx.text(60, 838, 'the critic kills bad shots at draft cost, not final cost', { size: 12, font: 'mono', color: 'dim', parent: DR });
          hide([gNote, VT, VC, DR, d1l, d2l, d3l, d2l.labelEl, d3l.labelEl]); hide(tiles); hide(chunks);
          /* beat 1: stage pools as lanes */
          ctx.reveal(GT, { from: 'up' });
          return ctx.wait(700).then(function () {
            return ctx.pulse(GT, { color: 'lime', dur: 800 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: shots pipelined across the pools */
            ctx.hud('DiT gangs stay busy; VAE and encode overlap');
            ctx.reveal(gNote, { from: 'up', delay: 2600 });
            return ctx.tween(3600, function (t) {
              var now = t * TMAX;
              blocks.forEach(function (b) { if (b.t0 <= now) b.setAttribute('opacity', 1); });
            }, 'linear');
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: spatial tiles of the VAE */
            return ctx.reveal(VT, { from: 'right' }).then(function () {
              return ctx.reveal(tiles, { from: 'scale', stagger: 120 });
            }).then(function () { return Promise.all(tiles.map(function (tg, i) { return ctx.pulse(tg, { color: HG[i], dur: 600 }); })); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: temporal chunks */
            return ctx.reveal(VC, { from: 'up' }).then(function () { return ctx.reveal(chunks, { from: 'left', stagger: 90, dur: 250 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: draft, critic, refine */
            return ctx.reveal(DR, { from: 'up' }).then(function () { return ctx.reveal([d1l, d2l, d3l], { from: 'draw', stagger: 150 }); })
              .then(function () { ctx.reveal([d2l.labelEl, d3l.labelEl], { dur: 300 }); return ctx.packet(d1l, { color: 'cyan', dur: 500 }); })
              .then(function () { return ctx.packet(d2l, { color: 'lime', dur: 600 }); });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 9 */
      {
        title: 'The speedup ladder',
        beats: [
          {
            say: 'Here is the whole ladder for one five second shot. On a single GPU with fifty guided steps, about fifty four minutes. Eight GPUs with guidance and sequence parallelism bring it to under eight minutes.',
            card: { tag: 'NUMBERS', title: 'Parallelism: seven times', stat: { v: '54 → 7.7', u: 'min', l: '1 GPU to 8 GPUs with CFG 2 × Ulysses 4 at an assumed 88 % scaling efficiency' } },
            deep: '<p>Modelled from the FLOP budget (H100, 40 % MFU); each rung uses a published technique, and gains are typical rather than guaranteed:</p>' +
              '<table><tr><th>rung</th><th>per shot</th><th>×</th></tr>' +
              '<tr><td>1 GPU, 50 steps, CFG, BF16</td><td>3,260 s</td><td>—</td></tr>' +
              '<tr><td>8 GPUs: CFG 2 × Ulysses 4 (≈ 88 % eff.)</td><td>463 s</td><td>7.0</td></tr></table>' +
              '<p>Efficiency below 100 % comes from the all-to-alls, the CFG exchange and load imbalance: 8 × 0.88 = 7.0. The 88 % is an assumption: xDiT\'s published HunyuanVideo run reaches 3.70× on four GPUs (93 %), and CFG parallelism adds a further split with almost no communication, whereas pure sequence parallelism on eight GPUs reached 5.64× there.</p>'
          },
          {
            say: 'Step caching nearly halves that, and quantized attention takes it to around two and a half minutes. Both are training free: they change how the same model is executed, not the model itself.',
            card: { tag: 'NUMBERS', title: 'Training-free: 3× more', stat: { v: '463 → 156', u: 's', l: 'TeaCache (≈ 1.8×) then SageAttention-class attention (Amdahl 1.65×), same weights' } },
            deep: '<table><tr><th>rung</th><th>per shot</th><th>×</th></tr>' +
              '<tr><td>+ TeaCache (≈ 1.8×)</td><td>257 s</td><td>1.8</td></tr>' +
              '<tr><td>+ FP8/INT8 attention (s = 2 → Amdahl 1.65×)</td><td>156 s</td><td>1.65</td></tr></table>' +
              '<p>These two rungs need no retraining, so they apply to any released checkpoint. Caching cuts the number of forwards; quantised attention cuts the cost of each forward that remains.</p>' +
              '<p>The ladder uses 1.8×, inside the 1.4× to 2.1× that the TeaCache repository reports for 720p Wan 2.1 14B and HunyuanVideo, rather than the 2.17× of this chamber\'s simulation: 463 s ÷ 1.8 ÷ 1.65 = 156 s, against 463 s × 23/50 ÷ 1.65 ≈ 129 s with the simulated skip rate. The two compose almost independently, because the skip decision reads only the timestep-modulated input of the first block, before any attention kernel runs.</p>'
          },
          {
            say: 'Switch to a four step distilled student and the denoiser needs about twelve seconds, twenty with decoding. A low resolution draft appears in a few seconds. That is how an agent can afford to iterate on a film.',
            card: { tag: 'NUMBERS', title: 'Distillation: 160 times overall', stat: { v: '≈ 20 s', l: 'per 5 s shot with a 4-step CFG-free student, 8 GPUs, FP8 attention and tiled VAE; drafts in about 6 s' },
              more: '<p>Student arithmetic: 3,260 s × 4/100 = 130 s on one GPU, ÷ (8 × 0.85) ≈ 19 s, ÷ 1.65 ≈ 12 s of DiT, plus ≈ 6 s of tiled VAE and ≈ 1 s of encode and mux ≈ 20 s. Against 3,260 s that is about 160×.</p>' },
            deep: '<table><tr><th>rung</th><th>per shot</th><th>×</th></tr>' +
              '<tr><td>4-step CFG-free student, Ulysses 8, FP8 attn, + ≈ 6 s tiled VAE</td><td>≈ 20 s</td><td>≈ 7.8</td></tr>' +
              '<tr><td>480p draft, 4 steps</td><td>≈ 5–7 s</td><td></td></tr></table>' +
              '<p>Not everything multiplies: caching and students overlap (both exploit step redundancy); sparse attention and SP interact (sparsity makes per-GPU compute smaller, so the communication share grows). Measure end to end.</p>' +
              '<p>A guidance-free student has only one branch per step, so CFG parallelism is gone and all 8 GPUs go to Ulysses (u = 8, five heads per GPU). The 4 forwards then cost 4 × 1.29×10¹⁶ FLOP = 5.2×10¹⁶, or 130 s on one GPU at the same 40 % MFU.</p>'
          },
          {
            say: 'For the whole thirty second trailer, two DiT gangs plus the VAE pool finish the fast path cut in about fifty seconds. The critic then sends two hero shots back to the teacher path, about two and a half minutes each.',
            card: { tag: 'HOW IT WORKS', title: 'The orchestrator picks the rung', body: 'Drafts for exploration, students for most finals, the teacher with caching for hero shots. The critic\'s verdict decides which shots pay for the expensive path.' },
            deep: '<div class="note">For the 30 s trailer (6 shots): two DiT gangs plus the VAE pool finish the fast-path cut in ≈ 50 s (Gantt of the previous step); the critic sends two hero shots back to the teacher path (≈ 2.6 min each on its own gang).</div>' +
              '<p>The plane that chooses the rung per call is the orchestration layer: it sees the deadline, the queue and the critic\'s score, and treats GPU-seconds as a budget.</p>'
          },
          {
            say: 'The bill drops accordingly. Naively the trailer costs five point four GPU hours. Eighteen drafts, six fast finals and two hero re-renders cost about one point two, the same order as the overview\'s seventy six GPU minutes.',
            card: { tag: 'NUMBERS', title: 'The trailer\'s GPU bill', stat: { v: '5.4 → 1.2', u: 'GPU-h', l: '18 drafts, 6 fast finals and 2 hero re-renders versus 6 naive teacher renders' } },
            deep: '<p>GPU budget: 18 drafts ≈ 0.24 GPU-h, 6 finals ≈ 0.24, 2 hero re-renders ≈ 0.69, total ≈ 1.2 GPU-h versus 5.4 naive, close to the ≈ 76 GPU-min the overview books as 6 shots × 8 GPUs × ~95 s. That figure is the same budget by another route: ≈ 95 s per shot is the 156 s teacher path with roughly 1.6× more from sparse attention or a shorter schedule, and no drafts. The Infrastructure chamber reaches the same ~95 s a different way: a plain 100-pass recipe at 75,600 tokens on eight B200s.</p>' +
              '<p><span class="muted">Hero re-render: 156 s × 8 GPUs = 0.35 GPU-h each. Drafts: about 6 s × 8 GPUs = 0.013 GPU-h each. Not everything multiplies: the caching and student rungs both mine step redundancy, so the totals here are estimates, not guarantees.</span></p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [0, 1, 2, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'THE SPEEDUP LADDER — ONE 5 s 720p SHOT', 'modelled wall-clock from the FLOP budget (H100, 40 % MFU) · each rung is a published technique', 'red');
          var LX = 520, DEC = 160;
          function lx(sec) { return LX + Math.log10(sec) * DEC; }
          var AX = ctx.group({ parent: G });
          [[1, '1 s'], [10, '10 s'], [60, '1 min'], [600, '10 min'], [3600, '1 h']].forEach(function (t) {
            ctx.line(lx(t[0]), 250, lx(t[0]), 668, { color: ctx.alpha('faint', 0.6), sw: 1, dash: '2 5', parent: AX });
            ctx.text(lx(t[0]), 686, t[1], { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: AX });
          });
          ctx.text(lx(3600), 706, 'log scale', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: AX });
          var rungs = [
            ['1× H100 · 50 steps · CFG · BF16', 3260, '54 min', 'red', ''],
            ['8× H100 · CFG 2 × Ulysses 4', 463, '7.7 min', 'orange', '7.0× faster'],
            ['+ TeaCache step caching', 257, '4.3 min', 'amber', '1.8× faster'],
            ['+ FP8/INT8 attention (Sage)', 156, '2.6 min', 'amber', '1.65× faster'],
            ['4-step student · 8 GPUs · + VAE', 20, '≈ 20 s', 'lime', '7.8× faster'],
            ['480p draft preview · 4 steps', 6, '≈ 6 s', 'cyan', 'preview']
          ];
          S.rb = [];
          rungs.forEach(function (r, i) {
            var y = 262 + i * 68;
            var rg = ctx.group({ parent: G });
            ctx.text(60, y + 16, r[0], { size: 13.5, font: 'mono', color: 'text', parent: rg });
            var w = lx(r[1]) - LX;
            var b = ctx.rect(LX, y, w, 32, { rx: 5, fill: ctx.alpha(r[3], 0.45), stroke: r[3], sw: 1.2, parent: rg, glow: i === 4 });
            var t = ctx.text(LX + w + 12, y + 16, r[2], { size: 15, font: 'mono', weight: 700, color: r[3], parent: rg });
            var m = r[4] ? ctx.label(LX - 66, y + 16, r[4], { color: r[3], size: 11, parent: rg }) : null;
            b.setAttribute('width', 0); t.setAttribute('opacity', 0); if (m) m.setAttribute('opacity', 0);
            rg.setAttribute('opacity', 0);
            S.rb.push({ g: rg, b: b, w: w, t: t, m: m });
          });
          /* trailer panel (beat 4) and GPU-hours (beat 5) */
          var R = ctx.group({ parent: G });
          ctx.rect(1170, 250, 370, 420, { rx: 12, fill: ctx.alpha('lime', 0.04), stroke: ctx.alpha('lime', 0.5), sw: 1.2, parent: R });
          var R1 = ctx.group({ parent: R });
          ctx.text(1190, 278, 'THE TRAILER · 6 SHOTS · 30 s', { size: 13, font: 'display', weight: 700, color: 'lime', parent: R1 });
          ctx.para(1190, 310, [
            'fast path: 2 DiT gangs + VAE pool',
            'whole cut in ≈ 50 s',
            'critic re-renders 2 hero shots',
            'on the teacher path (≈ 2.6 min',
            'each, on a third gang)'
          ], { size: 13, font: 'mono', color: 'text', parent: R1, lh: 23 });
          var R2 = ctx.group({ parent: R });
          ctx.text(1190, 440, 'GPU-HOURS FOR THE TRAILER', { size: 12, font: 'mono', color: 'dim', parent: R2 });
          var GH = 330 / 5.4;
          ctx.text(1190, 466, 'naive', { size: 11.5, font: 'mono', color: 'dim', parent: R2 });
          var ghN = ctx.rect(1190, 476, 5.4 * GH, 22, { rx: 4, fill: ctx.alpha('red', 0.45), stroke: 'red', sw: 1, parent: R2 });
          ctx.text(1190 + 5.4 * GH - 8, 487, '5.4 GPU-h', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: R2 });
          ctx.text(1190, 520, 'served', { size: 11.5, font: 'mono', color: 'dim', parent: R2 });
          var parts = [[0.24, 'cyan', 'drafts'], [0.24, 'lime', 'finals'], [0.69, 'amber', 'hero']];
          var gx = 1190, ghS = [];
          parts.forEach(function (p) {
            ghS.push(ctx.rect(gx, 530, p[0] * GH - 1, 22, { rx: 3, fill: ctx.alpha(p[1], 0.55), stroke: p[1], sw: 1, parent: R2 }));
            gx += p[0] * GH;
          });
          ctx.text(gx + 10, 541, '≈ 1.2 GPU-h', { size: 12, font: 'mono', weight: 700, color: 'lime', parent: R2 });
          parts.forEach(function (p, i) {
            var lx0 = 1190 + i * 112;
            ctx.rect(lx0, 572, 12, 12, { rx: 2, fill: ctx.alpha(p[1], 0.55), stroke: p[1], sw: 1, parent: R2 });
            ctx.text(lx0 + 18, 578, p[2] + ' ' + p[0].toFixed(2), { size: 11, font: 'mono', color: 'text', parent: R2 });
          });
          ctx.text(1190, 612, '18 drafts (3 per shot) · 6 fast finals', { size: 11, font: 'mono', color: 'dim', parent: R2 });
          ctx.text(1190, 632, '2 hero shots × 156 s × 8 GPUs', { size: 11, font: 'mono', color: 'dim', parent: R2 });
          ctx.place(R2, 0, 14);
          var foot = ctx.group({ parent: G });
          ctx.text(60, 750, 'not everything multiplies: caching and students both mine step redundancy; sparsity shrinks per-GPU compute so SP comm grows', { size: 12.5, font: 'mono', color: 'dim', parent: foot });
          ctx.text(60, 776, 'the orchestration plane chooses the rung per call: drafts for exploration, students for most finals, teacher for hero shots', { size: 12.5, font: 'mono', color: 'dim', parent: foot });
          hide([R, R1, R2, foot]);
          function climb(idx) {
            return idx.reduce(function (p, i) {
              var r = S.rb[i];
              return p.then(function () {
                ctx.reveal(r.g, { dur: 250 });
                if (r.m) ctx.reveal(r.m, { from: 'scale', dur: 300 });
                return ctx.animate(r.b, { width: [0, r.w] }, 700, 'out').then(function () { return ctx.reveal(r.t, { dur: 250 }); });
              });
            }, Promise.resolve());
          }
          /* beat 1: one GPU, then eight */
          ctx.reveal(AX, {});
          return ctx.wait(500).then(function () { return climb([0, 1]); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the training-free rungs */
            return climb([2, 3]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the student and the draft */
            ctx.hud('54 min → ≈ 20 s per shot (≈ 160×)');
            return climb([4, 5]).then(function () { return ctx.pulse(S.rb[4].b, { color: 'lime', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the trailer */
            ctx.reveal(R, { from: 'right' });
            return ctx.wait(400).then(function () { return ctx.reveal(R1, { from: 'up' }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: the GPU bill */
            return ctx.reveal(R2, { from: 'up' }).then(function () {
              ctx.reveal(foot, { from: 'up' });
              ctx.pulse(ghN, { color: 'red', dur: 500 });
              return Promise.all(ghS.map(function (e) { return ctx.pulse(e, { color: 'lime', dur: 600 }); }));
            });
          });
        }
      }
    ]
  });
})();
