/* L1 — Video Generation Models. Anatomy of a latent flow-matching text/image-to-video model, with worked numbers.
 * Beat format: each step is a sequence of beats (say + card + deep + one gated animation segment). */
(function () {
  /* ---------- procedural "fox astronaut on a glowing ice moon" image, u,v in [0,1] -> [r,g,b] ---------- */
  function fieldRGB(u, v) {
    var a = 1.85;
    var r = 8 + 10 * (1 - v), g = 14 + 16 * (1 - v), b = 34 + 30 * (1 - v);
    var dx = (u - 0.76) * a, dy = v - 0.28, dm = Math.sqrt(dx * dx + dy * dy);
    if (dm < 0.19) { var k = 1 - 0.35 * dm / 0.19; r = 205 * k + 30; g = 240 * k + 10; b = 255; }
    else { var h = Math.exp(-(dm - 0.19) * 7); r += 60 * h; g += 170 * h; b += 220 * h; }
    var hor = 0.76 + 0.035 * Math.sin(u * 7);
    if (v > hor) { var s = Math.exp(-(v - hor) * 10); r = 40 + 80 * s; g = 120 + 110 * s; b = 170 + 80 * s; }
    var fx = (u - 0.3) * a, fy = v - 0.56, fd = Math.sqrt(fx * fx + fy * fy);
    if (Math.abs(fx) < 0.13 && fy > 0.12 && fy < 0.36) { r = 205; g = 215; b = 235; }
    if (fx > 0.1 && fx < 0.36 && fy > 0.22 && fy < 0.32) { r = 255; g = 140; b = 60; }
    if (fd < 0.19) {
      if (fd > 0.13) { r = 235; g = 245; b = 255; } else { r = 255; g = 138; b = 61; }
    }
    return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
  }
  function rgbStr(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
  function gauss(r) { var u = Math.max(1e-6, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  /* pseudo-3D tensor block. o: cx, cy, w, h, d, color, parent, mosaic fn(r,c)->css color, n */
  function cube(ctx, o) {
    var g = ctx.group({ parent: o.parent });
    var d = o.d, col = o.color;
    var x0 = o.cx - (o.w + d) / 2, y0 = o.cy - (o.h - d) / 2;
    ctx.poly([[x0, y0], [x0 + d, y0 - d], [x0 + o.w + d, y0 - d], [x0 + o.w, y0]], { fill: ctx.alpha(col, 0.28), stroke: col, sw: 1.2, parent: g });
    ctx.poly([[x0 + o.w, y0], [x0 + o.w + d, y0 - d], [x0 + o.w + d, y0 + o.h - d], [x0 + o.w, y0 + o.h]], { fill: ctx.alpha(col, 0.16), stroke: col, sw: 1.2, parent: g });
    ctx.rect(x0, y0, o.w, o.h, { rx: 2, fill: ctx.alpha(col, 0.1), stroke: col, sw: 1.4, parent: g });
    if (o.mosaic) {
      var n = o.n || 6, cw = (o.w - 6) / n, ch = (o.h - 6) / n;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        ctx.rect(x0 + 3 + j * cw, y0 + 3 + i * ch, cw - 0.6, ch - 0.6, { rx: 0, fill: o.mosaic(i, j, n), parent: g });
      }
    }
    g.box = { x: x0, y: y0 - d, w: o.w + d, h: o.h + d, cx: o.cx, cy: o.cy, l: x0, r: x0 + o.w + d, t: y0 - d, b: y0 + o.h };
    g.color = ctx.color(col);
    return g;
  }

  /* tiny film frame of the running example; k in [0,1] moves the fox */
  function miniFrame(ctx, parent, x, y, w, h, k) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 2, fill: '#081026', stroke: ctx.alpha('lime', 0.55), sw: 1, parent: g });
    ctx.circle(x + w * 0.76, y + h * 0.3, h * 0.17, { fill: '#d2f3ff', parent: g, opacity: 0.95 });
    ctx.rect(x + 0.5, y + h * 0.76, w - 1, h * 0.24 - 0.5, { rx: 0, fill: ctx.alpha('cyan', 0.35), parent: g });
    ctx.circle(x + w * (0.14 + 0.36 * k), y + h * 0.62, h * 0.13, { fill: '#ff8a3d', stroke: '#e8f1ff', sw: 1, parent: g });
    return g;
  }

  /* stylised sketch thumbnail (100x75 local box) */
  function foxSketch(ctx, parent, x, y, w) {
    var g = ctx.group({ parent: parent });
    ctx.place(g, x, y, w / 100);
    ctx.rect(0, 0, 100, 75, { rx: 5, fill: '#0f0b24', stroke: 'violet', sw: 2, parent: g });
    ctx.path('M0,60 Q50,46 100,60 L100,75 L0,75 Z', { fill: ctx.alpha('violet', 0.28), stroke: 'violet', sw: 1.5, parent: g });
    ctx.circle(76, 20, 10, { stroke: 'pink', sw: 1.8, parent: g });
    ctx.rect(43, 40, 18, 17, { rx: 5, fill: ctx.alpha('white', 0.75), parent: g });
    ctx.poly([[43, 35], [45, 21], [50, 27], [55, 27], [60, 21], [61, 35], [52, 42]], { fill: 'orange', parent: g });
    ctx.circle(52, 31, 14, { stroke: 'white', sw: 1.8, fill: ctx.alpha('violet', 0.12), parent: g });
    return g;
  }

  function box(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }

  /* replace the close-up workbench */
  function newBench(ctx, S, title) {
    if (S.wb) ctx.remove(S.wb, 350);
    S.wb = ctx.group();
    S.wbTitle.textContent = title;
    return S.wb;
  }

  function arrowLabel(ctx, parent, x1, x2, y, top, bottom, col) {
    ctx.line(x1, y, x2, y, { color: col || 'dim', sw: 1.6, arrow: true, parent: parent });
    if (top) ctx.text((x1 + x2) / 2, y - 14, top, { size: 12, font: 'mono', color: col || 'text', anchor: 'middle', parent: parent });
    if (bottom) ctx.text((x1 + x2) / 2, y + 16, bottom, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: parent });
  }

  /* one row of the tensor ledger (step 2) */
  function ledgerRow(ctx, parent, i, name, shape, vals, col) {
    var y = 632 + i * 30, g = ctx.group({ parent: parent });
    ctx.text(60, y, name, { size: 13, font: 'mono', weight: 600, color: col, parent: g });
    ctx.text(270, y, shape, { size: 13, font: 'mono', color: 'text', parent: g });
    ctx.text(740, y, vals, { size: 13, font: 'mono', color: 'dim', anchor: 'end', parent: g });
    return g;
  }

  Atlas.register({
    id: 'videogen',
    refs: [
      'Rombach et al., <i>High-Resolution Image Synthesis with Latent Diffusion Models</i>, CVPR 2022',
      'Peebles &amp; Xie, <i>Scalable Diffusion Models with Transformers (DiT)</i>, ICCV 2023',
      'Esser et al., <i>Scaling Rectified Flow Transformers for High-Resolution Image Synthesis (SD3)</i>, ICML 2024',
      'Polyak et al., <i>Movie Gen: A Cast of Media Foundation Models</i>, Meta, 2024',
      'Kong et al., <i>HunyuanVideo: A Systematic Framework for Large Video Generative Models</i>, arXiv 2412.03603, 2024',
      'Wan Team (Alibaba), <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025',
      'HaCohen et al., <i>LTX-Video: Realtime Video Latent Diffusion</i>, 2025',
      'Google DeepMind, <i>Veo 3</i> model card / tech report, 2025; OpenAI, <i>Sora 2</i> system card, 2025; Low et al., <i>Ovi: Twin Backbone Cross-Modal Fusion for Audio-Video Generation</i>, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'The shot request',
        beats: [
          {
            say: 'Inside the agent crew, the cinematographer has just written shot three: the fox astronaut stumbling out of a smoking capsule onto a glowing ice moon. It packages the whole request as one tool call, render shot.',
            card: { tag: 'KEY IDEA', title: 'The model is a function call', body: 'To the agent, video generation is one typed tool call: <code>render_shot(prompt, refs, spec, seed)</code>. Everything else hides behind it.' },
            deep: '<p>To the orchestration plane the video model is a <b>pure, expensive function</b>:</p>' +
              '<div class="eq">clip = render_shot(prompt, refs, spec, seed)</div>' +
              '<p>The agent never sees weights or latents. It emits a schema-validated <code>tool_use</code> block, and the runtime, not the model, executes it, so arguments can be checked, budgeted, traced and retried like any RPC. Given the seed and sampler it is (nearly) deterministic, costs GPU-minutes and has no side effects.</p>'
          },
          {
            say: 'The call carries a reference sketch from the creator and a spec: five seconds, twenty four frames per second, seven twenty p. Those numbers fix the size of the answer before any GPU wakes up.',
            card: { tag: 'NUMBERS', title: 'One spec, one clip size', stat: { v: '121', u: 'frames', l: '5 s × 24 fps = 120, plus one anchor frame, at 1280 × 720' } },
            deep: '<table><tr><th>Spec field</th><th>Value</th></tr>' +
              '<tr><td>duration × fps</td><td>5 s × 24 fps</td></tr>' +
              '<tr><td>frames</td><td>121 = 4·30 + 1</td></tr>' +
              '<tr><td>resolution</td><td>1280 × 720</td></tr>' +
              '<tr><td>sampler</td><td>flow-matching Euler, 50 steps, CFG w = 5</td></tr>' +
              '<tr><td>conditioning</td><td>text + first-frame reference image</td></tr></table>' +
              '<p>Clip length is a model-side limit, not a wish: open models train on 81–129 frames (Wan 81, HunyuanVideo 129) and closed APIs offer clips of roughly 5–10 s (Veo 3: 8 s). Longer shots are chained by conditioning on the last latent frames of the previous clip.</p>'
          },
          {
            say: 'To the agent, the video model is a black box: a prompt and a sketch go in, and a clip comes out. It costs GPU minutes rather than milliseconds, so the call is asynchronous.',
            card: { tag: 'KEY IDEA', title: 'A black box, for now', body: 'Text and an image go in, pixels come out. The next steps open the box into <b>five components</b>.' },
            deep: '<p>Inside the box: a text encoder, a video VAE, a diffusion transformer and a sampler, spread over 8 GPUs for roughly 95 seconds of diffusion per shot in our running example. From the outside only three quantities matter: <b>latency</b> (minutes), <b>cost</b> (GPU-minutes) and <b>variance</b> (same prompt, different seed, different clip).</p>' +
              '<p>The black-box contract also decouples the crew from the model: swapping one backbone for another changes the tool implementation and its price list, not the agent’s prompts or the workflow.</p>'
          },
          {
            say: 'What comes out is exactly one hundred and twenty one frames. The call is a pure function of its arguments, so the workflow engine can retry it safely and cache it by hash. Now let us open the box.',
            card: { tag: 'WHY IT MATTERS', title: 'Pure, cacheable, retryable', body: 'Same prompt, refs, seed and sampler give the same clip, so the durable workflow can <b>retry idempotently</b> and cache by argument hash.', more: '<p>The cache key is a hash of <code>(prompt, content-hash of each reference, spec, seed, model version, sampler config)</code>. A hit skips the GPUs entirely. Bitwise repeatability needs pinned kernels and an identical parallelism layout, because GPU reductions are not associative.</p>' },
            deep: '<div class="note">Why 4k+1 frames? The causal video VAE encodes the first frame alone and every following group of 4 frames into one latent frame: T<sub>lat</sub> = 1 + (F − 1)/4 = 31. Wan uses 81 frames at 16 fps, HunyuanVideo 129 at 24 fps: the same rule.</div>' +
              '<p><b>Idempotency.</b> The workflow engine keys the result by a hash of the whole argument tuple. A retry after a GPU failure reuses the same key, and a cache hit returns the stored clip URI instead of re-running 100 forward passes. “Nearly” deterministic: floating-point reductions on GPUs are order-dependent, so identical output also needs the same kernels and sharding.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          /* divider + close-up workbench */
          S.div = ctx.group();
          ctx.line(40, 548, 1560, 548, { color: 'line', sw: 1, parent: S.div });
          ctx.text(60, 568, 'CLOSE-UP ▸', { size: 12, font: 'mono', weight: 600, color: 'lime', spacing: 2, parent: S.div });
          S.wbTitle = ctx.text(170, 568, '', { size: 12, font: 'mono', color: 'dim', parent: S.div });
          ctx.reveal(S.div, {});
          var wb = newBench(ctx, S, 'the tool call the agent actually emits');
          /* output film strip is created later; prompt card first */
          S.promptCard = ctx.group();
          ctx.rect(50, 188, 205, 54, { rx: 8, fill: '#061520', stroke: 'cyan', sw: 1.2, parent: S.promptCard });
          ctx.text(62, 204, 'prompt · from Camera agent', { size: 11, font: 'mono', color: 'dim', parent: S.promptCard });
          ctx.text(62, 226, '"fox astronaut stumbles…"', { size: 12, font: 'mono', color: 'cyan', parent: S.promptCard });
          S.promptCard.box = box(50, 188, 205, 54);
          S.call = ctx.code({ x: 60, y: 590, w: 690, title: 'tool_use · render_shot', lang: 'json', typing: true, size: 12, maxLines: 8, color: 'lime', parent: wb, lines: [
            '{ "name": "render_shot", "input": {',
            '    "shot_id": "S03",',
            '    "prompt": "A fox astronaut stumbles out of a smoking',
            '       capsule onto a glowing ice moon, low angle, dolly-in",',
            '    "ref_image": "s3://refs/fox_sketch_2.png",',
            '    "duration_s": 5, "fps": 24, "size": [1280, 720],',
            '    "seed": 1234, "steps": 50, "guidance": 5.0',
            '} }'
          ] });
          /* translucent band + accent bar behind code lines i .. i+n-1 (never a dashed frame: it would cut through neighbouring lines) */
          function band(i, n, col) {
            var g = ctx.group({ parent: wb }), y = 636 + i * 18.6 - 9.3;
            ctx.rect(62, y, 688, 18.6 * n, { rx: 3, fill: ctx.alpha(col, 0.15), parent: g });
            ctx.rect(62, y, 3, 18.6 * n, { rx: 1, fill: col, parent: g });
            return g;
          }
          /* beat 1: the agent writes the call */
          ctx.reveal(S.promptCard, { from: 'left' });
          ctx.reveal(S.call, { from: 'up' });
          return S.call.typeAll().then(function () {
            return ctx.pulse(S.promptCard, { color: 'cyan', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: reference sketch and spec lines light up */
            S.ref = ctx.group();
            foxSketch(ctx, S.ref, 70, 306, 96);
            ctx.text(118, 394, 'ref sketch #2', { size: 11, font: 'mono', color: 'violet', anchor: 'middle', parent: S.ref });
            S.ref.box = box(70, 306, 96, 72);
            S.hlRef = band(4, 1, 'violet');
            S.hlSpec = band(5, 2, 'amber');
            S.chRef = ctx.label(738, 636 + 4 * 18.6, 'reference', { color: 'violet', size: 11, anchor: 'end', parent: wb });
            S.chSpec = ctx.label(738, 636 + 5.5 * 18.6, 'spec', { color: 'amber', size: 11, anchor: 'end', parent: wb });
            ctx.hud('1 shot = 5 s · 24 fps · 720p = 121 frames');
            return Promise.all([
              ctx.reveal(S.ref, { from: 'left' }),
              ctx.reveal([S.hlRef, S.chRef], { from: 'left', delay: 300, stagger: 150 }),
              ctx.reveal([S.hlSpec, S.chSpec], { from: 'left', delay: 700, stagger: 150 }),
              ctx.wait(800)
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the black box */
            S.black = ctx.group();
            ctx.rect(560, 262, 660, 170, { rx: 16, fill: 'rgba(8,20,10,0.6)', stroke: ctx.alpha('lime', 0.7), sw: 1.6, dash: '8 6', parent: S.black, glow: true });
            ctx.text(890, 326, 'VIDEO GENERATION MODEL', { size: 24, font: 'display', weight: 700, color: 'lime', anchor: 'middle', parent: S.black });
            ctx.text(890, 362, 'text + image  →  121 frames of 1280 × 720', { size: 14, font: 'mono', color: 'dim', anchor: 'middle', parent: S.black });
            ctx.text(890, 392, '? ? ?', { size: 16, font: 'mono', color: ctx.alpha('lime', 0.6), anchor: 'middle', parent: S.black });
            S.black.box = box(560, 262, 660, 170);
            S.l0a = ctx.link(S.promptCard, S.black, { color: 'cyan', from: 'r', to: 'l' });
            S.l0b = ctx.link(S.ref, S.black, { color: 'violet', from: 'r', to: 'l' });
            return Promise.all([
              ctx.reveal(S.black, { from: 'scale', s0: 0.85 }),
              ctx.reveal([S.l0a, S.l0b], { from: 'draw', delay: 300, stagger: 150 })
            ]).then(function () {
              return Promise.all([
                ctx.packet(S.l0a, { color: 'cyan', dur: 700, label: 'prompt' }),
                ctx.packet(S.l0b, { color: 'violet', dur: 700, label: 'image' })
              ]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the output contract */
            S.film = ctx.group();
            ctx.rect(1385, 305, 170, 66, { rx: 4, fill: '#050a05', stroke: ctx.alpha('lime', 0.6), sw: 1.2, parent: S.film });
            for (var i = 0; i < 8; i++) {
              ctx.rect(1392 + i * 20, 309, 9, 4, { rx: 1, fill: ctx.alpha('lime', 0.4), parent: S.film });
              ctx.rect(1392 + i * 20, 363, 9, 4, { rx: 1, fill: ctx.alpha('lime', 0.4), parent: S.film });
            }
            S.filmFrames = ctx.group({ parent: S.film });
            for (var q = 0; q < 3; q++) miniFrame(ctx, S.filmFrames, 1392 + q * 54, 319, 50, 38, q / 2);
            ctx.text(1470, 392, 'clip.mp4 · 121 frames', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: S.film });
            S.film.box = box(1385, 305, 170, 66);
            S.l0c = ctx.link(S.black, S.film, { color: 'lime', from: 'r', to: 'l' });
            /* timeline of the output clip */
            S.tl = ctx.group({ parent: wb });
            ctx.text(820, 600, 'OUTPUT CONTRACT · 5 s timeline, 12 of 121 frames shown', { size: 12, font: 'mono', color: 'dim', parent: S.tl });
            S.tlFrames = [];
            for (var f = 0; f < 12; f++) {
              var fr = miniFrame(ctx, S.tl, 820 + f * 60, 625, 56, 38, f / 11);
              fr.setAttribute('opacity', 0);
              S.tlFrames.push(fr);
            }
            ctx.line(820, 682, 1536, 682, { color: 'faint', sw: 1, parent: S.tl });
            for (var sec = 0; sec <= 5; sec++) {
              var tx = 820 + sec * 716 / 5;
              ctx.line(tx, 678, tx, 686, { color: 'dim', sw: 1, parent: S.tl });
              ctx.text(tx, 700, sec + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.tl });
            }
            ctx.para(820, 738, [
              '121 frames · 24 fps · 1280×720 · 8-bit RGB',
              'latency budget: minutes, not milliseconds',
              'idempotent: same (prompt, refs, seed) → same clip'
            ], { size: 13, font: 'mono', color: 'text', lh: 26, parent: S.tl });
            return Promise.all([
              ctx.reveal(S.film, { from: 'right' }),
              ctx.reveal(S.l0c, { from: 'draw', delay: 200 })
            ]).then(function () {
              return ctx.packet(S.l0c, { color: 'lime', dur: 800 });
            }).then(function () {
              ctx.reveal(S.filmFrames, {});
              return Promise.all(S.tlFrames.map(function (fr, i) { return ctx.fade(fr, 1, 250 + i * 60); }));
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Five components',
        beats: [
          {
            say: 'Every modern video generator has the same five parts. A text encoder turns the prompt into conditioning vectors. A variational autoencoder maps pixels into a compact latent space and back, and generation starts from pure Gaussian noise in that space.',
            card: { tag: 'KEY IDEA', title: 'Five parts, one recipe', body: 'Text encoder, VAE, latent noise, denoiser, VAE decoder. Wan, HunyuanVideo, LTX and Movie Gen all follow this layout.' },
            deep: '<p>This is <b>latent diffusion</b> (Rombach et al.) extended to spacetime, with a transformer denoiser trained by flow matching. The conditioning side:</p>' +
              '<div class="eq">c = E<sub>text</sub>(prompt),   z<sub>ref</sub> = E<sub>VAE</sub>(ref),   z<sub>1</sub> ~ N(0, I)</div>' +
              '<ul><li><b>Text encoder</b>: frozen (umT5-XXL in Wan, an MLLM plus CLIP in HunyuanVideo).</li>' +
              '<li><b>VAE</b>: ~10<sup>8</sup> parameters (Wan-VAE ≈ 127 M), trained first, then frozen. It fixes the token budget of everything downstream.</li>' +
              '<li><b>Noise</b>: the sampler starts from z<sub>1</sub>, a tensor of the same shape as the clean latent, 16 × 31 × 90 × 160.</li></ul>'
          },
          {
            say: 'A diffusion transformer then removes the noise over many small steps, steered by the text through cross attention. It is a loop: the same network is called about fifty times.',
            card: { tag: 'HOW IT WORKS', title: 'Cross-attention steers the loop', body: 'Video tokens are queries; text vectors are keys and values. The same network runs about <b>50 times</b> along a shifted schedule.' },
            deep: '<div class="eq">z<sub>0</sub> = ODESolve( dz/dt = v<sub>θ</sub>(z, t, c),   t: 1 → 0 )</div>' +
              '<p>The <b>DiT</b> is the only part trained in the main stage: 1.3 B–14 B parameters (Wan 2.1), 13 B (HunyuanVideo), 30 B (Movie Gen). Each block runs self-attention over all spacetime tokens, cross-attention to the text, and an MLP, modulated by the timestep through adaptive layer norm. The same weights are called ~50 times per clip, so the loop is a chamber of its own (diffusion), separate from the network (DiT).</p>' +
              '<details><summary>Go deeper</summary><p><b>Where 14 B comes from</b> (Wan 2.1 14B: d = 5120, 40 blocks, MLP width 13,824). Per block: self-attention 4d² ≈ 105 M, cross-attention 4d² ≈ 105 M (its K and V read the projected text), MLP 2·d·13,824 ≈ 142 M, in total ≈ 351 M. Forty blocks give ≈ 14.0 B. The 1.3 B sibling uses d = 1536 and 30 blocks (≈ 46 M per block).</p></details>'
          },
          {
            say: 'Finally the VAE decoder turns the clean latent back into frames. Every glowing part is a chamber you can zoom into.',
            card: { tag: 'TRY IT', title: 'Open any glowing part', body: 'Dashed rings mark zoom targets: the VAE encoder and decoder, the denoising loop, and the transformer itself.' },
            deep: '<div class="eq">video = D<sub>VAE</sub>(z<sub>0</sub>)   ∈ ℝ<sup>121×720×1280×3</sup></div>' +
              '<p>The decoder is trained jointly with the encoder (reconstruction, perceptual and adversarial losses), then frozen. It mirrors the encoder: 31 latent frames become 121 pixel frames. Wan-VAE decodes causally in chunks with a feature cache, so memory does not grow with clip length. A pure text-to-video call needs only the decoder; image-to-video also runs the encoder on the reference.</p>'
          },
          {
            say: 'In code, the whole model is seven lines: encode the text, encode the reference, draw noise, loop the denoiser with a simple Euler update, then decode.',
            card: { tag: 'HOW IT WORKS', title: 'Seven lines of pseudo-code', body: 'Encode, noise, loop, decode. Production stacks wrap this loop in batching, sharding and offload, but the structure is unchanged.' },
            deep: '<pre>c   = text_encoder(prompt)             # [512, 4096]\n' +
              'zr  = vae.encode(ref_frame)            # [16, 1, 90, 160]\n' +
              'z   = randn(16, 31, 90, 160, seed=1234)  # t = 1\n' +
              'for t, t_next in schedule(50, shift=5.0):\n' +
              '    v = dit(z, t, c, zr)               # velocity\n' +
              '    z = z + (t_next - t) * v           # Euler\n' +
              'frames = vae.decode(z)                 # [121,720,1280,3]</pre>' +
              '<p>Omitted for clarity: classifier-free guidance (a second, unconditional forward per step), per-channel latent normalisation, and sequence-parallel sharding across the 8 GPUs. In image-to-video the reference is padded with zero frames before encoding and a mask channel is added (step 7); the first latent frame is identical either way, because the VAE is causal.</p>'
          },
          {
            say: 'The compute is wildly lopsided. The text encoder costs on the order of ten trillion operations and the VAE on the order of a quadrillion, but the denoiser needs over a quintillion, roughly ninety nine point nine percent of the total.',
            card: { tag: 'NUMBERS', title: 'Where the FLOPs go', stat: { v: '99.9%', u: 'in the DiT', l: 'about 1.3 × 10¹⁸ FLOPs per clip, versus about 10¹⁵ for the VAE and 10¹³ for the text encoder' }, more: '<p>Text encoder: 2 · 4.6 B non-embedding parameters · 512 tokens ≈ 5 × 10¹². VAE: a 3×3×3 convolution at 96 channels costs 2 · 27 · 96² ≈ 0.5 MFLOP per voxel, and stage 0 has 111.5 M voxels, so one layer is 5.5 × 10¹³ and the whole encoder plus decoder lands near 10¹⁵. DiT: 100 forward passes × 1.29 × 10¹⁶.</p>' },
            deep: '<p>FLOPs per clip, log scale: text encoder ~10<sup>13</sup>, VAE encode + decode ~10<sup>15</sup> (dozens of 3×3×3 convs at up to 96 channels × 111 M voxels), DiT ≈ 1.3×10<sup>18</sup> (100 forwards × 1.29×10<sup>16</sup>).</p>' +
              '<p>The denoiser is ≈ 99.9% of compute, so every serving optimisation (sequence parallelism, FP8, step caching, distillation) targets it first. The VAE decoder is nevertheless often the <i>memory</i> peak: 21 GB for a single full-resolution activation, which is why the VAE chamber spends so long on chunking and tiling.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove([S.black, S.l0a, S.l0b, S.l0c], 400);
          ctx.hud('');
          var wb = newBench(ctx, S, 'tensor shapes as data flows through the five parts');
          /* ledger: header + rows that grow with the story */
          S.ledger = ctx.group({ parent: wb });
          ctx.text(60, 604, 'TENSOR', { size: 11, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: S.ledger });
          ctx.text(270, 604, 'SHAPE', { size: 11, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: S.ledger });
          ctx.text(740, 604, 'VALUES', { size: 11, font: 'mono', weight: 600, color: 'dim', anchor: 'end', spacing: 2, parent: S.ledger });
          /* beat 1: the inputs */
          S.tenc = ctx.node({ x: 400, y: 215, w: 190, h: 52, title: 'Text Encoder', sub: 'umT5-XXL · 512 tok', icon: 'doc', color: 'cyan', titleSize: 15, subSize: 11 });
          S.tok = ctx.matrix(520, 201, 3, 10, { cell: 8, gap: 2, cmap: 'cyan', values: function (r, c) { return 0.3 + 0.6 * Math.abs(Math.sin(r * 2.1 + c * 1.3)); } });
          S.tokL = ctx.text(569, 243, 'c: 512 × 4096', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle' });
          S.venc = ctx.node({ x: 400, y: 340, w: 190, h: 52, title: 'VAE Encoder', sub: 'causal 3D conv', icon: 'layers', color: 'lime', titleSize: 15, subSize: 11 });
          var rN = ctx.rng(5);
          S.noise = cube(ctx, { cx: 632, cy: 340, w: 60, h: 60, d: 20, color: 'lime', n: 6, mosaic: function () { var k = 60 + 150 * rN(); return 'rgb(' + Math.round(k * 0.8) + ',' + Math.round(k) + ',' + Math.round(k * 0.85) + ')'; } });
          S.noiseL = ctx.para(632, 395, ['z₁ ~ N(0, I)', '16×31×90×160'], { size: 11, font: 'mono', color: 'lime', anchor: 'middle', lh: 15 });
          S.lP = ctx.link(S.promptCard, S.tenc, { color: 'cyan', from: 'r', to: 'l' });
          S.lR = ctx.link(S.ref, S.venc, { color: 'violet', from: 'r', to: 'l' });
          S.lV = ctx.link(S.venc, S.noise, { color: 'lime', from: 'r', to: 'l', label: '⊕ z_ref', labelDy: -16 });
          ctx.hotspot(S.venc, 'video-vae', { hint: 'VAE ⤢' });
          var r1 = ctx.reveal(S.ledger, {});
          var row0 = ledgerRow(ctx, S.ledger, 0, 'c  (text)', '[512 × 4096]', '2.10 M', 'cyan');
          var row1 = ledgerRow(ctx, S.ledger, 1, 'z_ref  (reference)', '[16 × 1 × 90 × 160]', '0.23 M', 'violet');
          var row2 = ledgerRow(ctx, S.ledger, 2, 'z₁  (noise)', '[16 × 31 × 90 × 160]', '7.14 M', 'lime');
          return Promise.all([
            ctx.reveal([S.tenc, S.tok, S.tokL], { from: 'up', stagger: 110, delay: 200 }),
            ctx.reveal(S.lP, { from: 'draw', delay: 500 }),
            ctx.reveal(row0, { from: 'left', delay: 500 }),
            ctx.reveal(S.venc, { from: 'up', delay: 900 }),
            ctx.reveal(S.lR, { from: 'draw', delay: 1200 }),
            ctx.reveal(row1, { from: 'left', delay: 1200 }),
            ctx.reveal([S.noise, S.noiseL], { from: 'up', stagger: 110, delay: 1500 }),
            ctx.reveal(S.lV, { from: 'draw', delay: 1700 }),
            ctx.reveal(S.lV.labelEl, { delay: 2100 }),
            ctx.reveal(row2, { from: 'left', delay: 1800 }),
            r1
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the diffusion transformer and its loop */
            S.dit = ctx.node({ x: 870, y: 340, w: 250, h: 110, title: 'Diffusion Transformer', sub: 'v_θ(z_t, t, c) · 14 B', color: 'lime', titleSize: 17, subSize: 12, glow: 'strong' });
            S.loopG = ctx.group();
            S.loopP = ctx.path('M945,395 C955,470 785,470 795,395', { stroke: 'lime', sw: 2, arrow: true, parent: S.loopG });
            ctx.label(870, 478, '× 50 steps · ODE sampler', { color: 'lime', size: 11, parent: S.loopG });
            S.loopG.box = box(760, 412, 220, 82);
            S.lN = ctx.link(S.noise, S.dit, { color: 'lime', from: 'r', to: 'l' });
            S.lTok = ctx.link({ x: 620, y: 215 }, { x: 830, y: 285 }, { color: 'cyan', label: 'cross-attn', labelDx: 26, labelDy: -12 });
            ctx.hotspot(S.dit, 'dit');
            ctx.hotspot(S.loopG, 'diffusion', { hint: 'DIFFUSION ⤢' });
            var row3 = ledgerRow(ctx, S.ledger, 3, 'X  (DiT tokens)', '[111,600 × 5120]', '571 M', 'amber');
            var row4 = ledgerRow(ctx, S.ledger, 4, 'v_θ  (velocity)', '[16 × 31 × 90 × 160]', '7.14 M', 'lime');
            return Promise.all([
              ctx.reveal(S.dit, { from: 'scale', s0: 0.85 }),
              ctx.reveal([S.lN, S.lTok], { from: 'draw', delay: 300, stagger: 150 }),
              ctx.reveal(S.lTok.labelEl, { delay: 800 }),
              ctx.reveal(S.loopG, { from: 'up', delay: 600 }),
              ctx.reveal([row3, row4], { from: 'left', delay: 700, stagger: 200 })
            ]).then(function () {
              return Promise.all([ctx.packet(S.lN, { color: 'lime', dur: 600 }), ctx.packet(S.lTok, { color: 'cyan', dur: 700 })]);
            }).then(function () { return ctx.pulse(S.dit, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: decode */
            S.z0 = cube(ctx, { cx: 1100, cy: 340, w: 60, h: 60, d: 20, color: 'lime', n: 6, mosaic: function (i, j, n) { return rgbStr(fieldRGB((j + 0.5) / n, (i + 0.5) / n)); } });
            S.z0L = ctx.text(1100, 395, 'z₀ (clean)', { size: 11, font: 'mono', color: 'lime', anchor: 'middle' });
            S.vdec = ctx.node({ x: 1274, y: 340, w: 180, h: 52, title: 'VAE Decoder', sub: 'latent → pixels', icon: 'film', color: 'lime', titleSize: 14, subSize: 11 });
            S.lZ = ctx.link(S.dit, S.z0, { color: 'lime', from: 'r', to: 'l' });
            S.lD = ctx.link(S.z0, S.vdec, { color: 'lime', from: 'r', to: 'l' });
            S.lF = ctx.link(S.vdec, S.film, { color: 'lime', from: 'r', to: 'l' });
            ctx.hotspot(S.vdec, 'video-vae', { hint: 'VAE ⤢' });
            var row5 = ledgerRow(ctx, S.ledger, 5, 'frames  (pixels)', '[121 × 720 × 1280 × 3]', '334.5 M', 'white');
            return Promise.all([
              ctx.reveal([S.z0, S.z0L, S.vdec], { from: 'up', stagger: 150 }),
              ctx.reveal([S.lZ, S.lD, S.lF], { from: 'draw', delay: 300, stagger: 150 }),
              ctx.reveal(row5, { from: 'left', delay: 600 })
            ]).then(function () {
              return ctx.packet(S.lZ, { color: 'lime', dur: 500 });
            }).then(function () { return ctx.packet(S.lD, { color: 'lime', dur: 500 }); }).then(function () {
              return ctx.packet(S.lF, { color: 'lime', dur: 600, label: '121 frames' });
            }).then(function () { return ctx.pulse(S.film, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the whole model in seven lines */
            ctx.remove(S.ledger, 300);
            S.wbTitle.textContent = 'the whole model in seven lines';
            S.pseudo = ctx.code({ x: 60, y: 590, w: 690, title: 'generate.py (Wan / HunyuanVideo-style, simplified)', lang: 'py', typing: true, size: 13, maxLines: 7, color: 'lime', parent: wb, lines: [
              'c   = text_encoder(prompt)             # [512, 4096]',
              'zr  = vae.encode(ref_frame)            # [16, 1, 90, 160]',
              'z   = randn(16, 31, 90, 160, seed=1234) # t = 1',
              'for t, t_next in schedule(50, shift=5.0):',
              '    v = dit(z, t, c, zr)               # velocity field',
              '    z = z + (t_next - t) * v           # Euler step',
              'frames = vae.decode(z)                 # [121, 720, 1280, 3]'
            ] });
            ctx.reveal(S.pseudo, { from: 'up' });
            return S.pseudo.typeAll().then(function () { return ctx.pulse(S.loopG, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: FLOPs, log scale */
            S.fl = ctx.group({ parent: wb });
            ctx.text(820, 600, 'FLOPs PER CLIP · log scale', { size: 12, font: 'mono', color: 'dim', parent: S.fl });
            var rows = [['text encoder', 13, 'cyan', '~10¹³'], ['VAE enc + dec', 15, 'teal', '~10¹⁵'], ['DiT × 100 passes', 18.1, 'lime', '1.3×10¹⁸']];
            S.flBars = rows.map(function (r, i) {
              var y = 630 + i * 52;
              ctx.text(990, y + 14, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: S.fl });
              ctx.rect(1005, y, 440, 28, { rx: 4, fill: 'rgba(255,255,255,0.03)', parent: S.fl });
              var b = ctx.rect(1005, y, 440 * (r[1] - 10) / 8.5, 28, { rx: 4, fill: ctx.alpha(r[2], 0.45), stroke: r[2], sw: 1, parent: S.fl });
              ctx.text(1455, y + 14, r[3], { size: 12, font: 'mono', color: r[2], parent: S.fl });
              return b;
            });
            var sup = { 10: '10¹⁰', 12: '10¹²', 14: '10¹⁴', 16: '10¹⁶', 18: '10¹⁸' };
            [10, 12, 14, 16, 18].forEach(function (e) {
              var x = 1005 + 440 * (e - 10) / 8.5;
              ctx.text(x, 800, sup[e], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.fl });
            });
            ctx.text(820, 838, 'the denoiser is ≈ 99.9% of compute: optimise there first', { size: 13, font: 'mono', color: 'lime', parent: S.fl });
            var pr = ctx.reveal(S.fl, { delay: 100 });
            var grow = S.flBars.map(function (b, i) {
              var w = parseFloat(b.getAttribute('width'));
              b.setAttribute('width', 0);
              return ctx.animate(b, { width: [0, w] }, 800, 'out', 400 + i * 350);
            });
            ctx.hud('DiT ≈ 99.9% of a clip’s FLOPs');
            return Promise.all([pr].concat(grow)).then(function () { return ctx.pulse(S.dit, { color: 'lime', times: 2, dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Text conditioning',
        beats: [
          {
            say: 'Conditioning starts with language. The prompt, usually expanded by an LLM into a dense paragraph that resembles the training captions, is split into sub word tokens.',
            card: { tag: 'HOW IT WORKS', title: 'Prompts are rewritten first', body: 'An LLM expands about 20 words into a dense ~100-word caption in the training-data style. A big quality lever at zero DiT cost.' },
            deep: '<p><b>Prompt extension.</b> Training captions are long and dense, but users type twenty words. An LLM rewrites the short prompt into a ~100-word paragraph in the caption style: subject, action, lens, lighting, camera motion. Wan ships a Qwen-based extender. It runs on the LLM pool, not on the video GPUs.</p>' +
              '<p>Tokenisation is SentencePiece (umT5 has a 256 k multilingual vocabulary): <code>▁astro</code> + <code>naut</code> shows how sub-word pieces cover rare words.</p>'
          },
          {
            say: 'A large frozen text encoder, from the multilingual T five family, then reads all the tokens together and returns one four thousand dimensional vector per token, padded to five hundred twelve slots.',
            card: { tag: 'NUMBERS', title: 'A matrix per prompt', stat: { v: '512 × 4096', l: 'text conditioning from umT5-XXL: 10 real tokens plus 502 padding slots' } },
            deep: '<p><b>Encoder.</b> Wan uses umT5-XXL (multilingual T5; 24 bidirectional encoder layers, d = 4096), max 512 tokens, padded; a 2-layer MLP projects 4096 → d<sub>model</sub> = 5120. HunyuanVideo instead uses a decoder-only MLLM with a bidirectional <i>token refiner</i>, plus a pooled CLIP vector fed into the timestep modulation.</p>' +
              '<p>The encoder is <b>frozen</b> and bidirectional, so each vector knows the whole sentence. Its output depends only on the prompt: the same 512 × 4096 matrix is reused by all 50 steps, so it is computed once and cached (the unconditional branch has its own matrix, from the empty or negative prompt).</p>' +
              '<details><summary>Go deeper</summary><p><b>Why a T5 and not CLIP?</b> A contrastive text tower is trained to summarise a caption in one vector, so it loses word order, counts and relations. A T5 encoder is trained to reconstruct spans, keeps one contextual vector per token and reads several languages, which is what long, scene-like captions and in-video text (Wan renders Chinese and English glyphs) need. <b>Padding:</b> the public Wan code zero-pads to 512 slots and attends to them without a mask; other stacks mask the pad slots. Either way the cross-attention cost is fixed by 512, not by prompt length.</p></details>'
          },
          {
            say: 'Inside every transformer block, video tokens issue queries that attend to these text vectors through cross attention. The patch that will become the fox helmet can look up the words fox and astronaut.',
            card: { tag: 'KEY IDEA', title: 'Video asks, text answers', body: 'In cross-attention the video tokens supply <b>queries</b>; the text matrix supplies <b>keys and values</b>.' },
            deep: '<div class="eq">CrossAttn(X, C) = softmax( (XW<sub>Q</sub>)(CW<sub>K</sub>)ᵀ / √d<sub>h</sub> ) CW<sub>V</sub></div>' +
              '<p>X ∈ ℝ<sup>N×d</sup> are the N ≈ 111.6 k video tokens, C ∈ ℝ<sup>512×d</sup> the text. Per head the score matrix is N × 512, so the cost 4·N·L·d per layer is tiny next to self-attention because L = 512 ≪ N. Keys and values depend only on the text, so they can be cached across all 50 steps.</p>'
          },
          {
            say: 'The softmax weights concentrate on fox, astro and naut, so the helmet patch pulls in exactly those word vectors. A patch on the smoking capsule would look up different words.',
            card: { tag: 'TRY IT', title: 'Click a patch, read its words', body: 'Click the helmet or the capsule in the mini frame. Each query patch spreads its attention over different words: helmet on fox, astro, naut; capsule on smoking, capsule.' },
            deep: '<ul><li><b>Attention pattern.</b> The softmax row of the helmet patch concentrates on <i>fox</i>, <i>astro</i>, <i>naut</i> (illustrative weights here, summing to 1). The capsule patch weights <i>smoking</i> and <i>capsule</i>; a sky patch would weight scene words such as <i>ice</i> or <i>moon</i>.</li>' +
              '<li>Real heads are messier: many put much of their mass on padding or punctuation slots that act as attention sinks, and different heads and layers specialise on objects, attributes, actions or style.</li>' +
              '<li><b>Condition dropout</b> (~10% empty prompts during training) teaches the same network the unconditional field needed for classifier-free guidance.</li></ul>'
          },
          {
            say: 'Some models, such as Stable Diffusion three and HunyuanVideo, instead concatenate text and video tokens into one joint attention, so the text is updated by the video as well.',
            card: { tag: 'TRADE-OFF', title: 'Cross-attention or joint attention', body: 'Cross-attention keeps the cost at <b>N × 512</b> per layer. MM-DiT joint attention also updates the text tokens, at the price of a longer sequence.' },
            deep: '<p><b>MM-DiT alternative</b> (SD3, HunyuanVideo dual→single stream): concatenate text and video tokens into one joint self-attention with modality-specific weights, so text tokens are also updated layer by layer.</p>' +
              '<div class="eq">softmax( [Q<sub>t</sub>; Q<sub>v</sub>] [K<sub>t</sub>; K<sub>v</sub>]ᵀ / √d<sub>h</sub> ) [V<sub>t</sub>; V<sub>v</sub>],   cost ∝ (N + 512)²·d</div>' +
              '<p>The extra cost over pure cross-attention is negligible in FLOPs (N² already dominates), but the joint layout needs a second set of text-side weights and prevents caching keys and values across steps, because the text stream now changes with the video. It buys better text rendering and prompt following, which is why SD3, Flux and HunyuanVideo adopted it. Wan keeps plain cross-attention.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'text conditioning · umT5-XXL → cross-attention');
          ctx.hud('c: 512 × 4096 text conditioning');
          ctx.focus([S.div, wb, S.promptCard, S.tenc, S.tok, S.tokL, S.lP, S.lTok, S.lTok.labelEl, S.dit], 0.25);
          /* beat 1: the prompt is expanded and tokenised */
          S.ext = ctx.label(60, 590, 'LLM prompt extender · ~20 words → ~100 words', { color: 'amber', size: 12, anchor: 'start', parent: wb });
          var toks = ['▁A', '▁fox', '▁astro', 'naut', '▁stumbles', '▁out', '▁of', '▁a', '▁smoking', '▁capsule'];
          var x = 60;
          S.chips = toks.map(function (t) {
            var ch = ctx.label(x, 620, t, { color: 'cyan', size: 11, anchor: 'start', parent: wb });
            x += ch.w + 5;
            return ch;
          });
          return Promise.all([
            ctx.reveal(S.ext, { from: 'left' }),
            ctx.reveal(S.chips, { from: 'up', delay: 400, stagger: 60 })
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the frozen encoder produces C */
            S.encBar = ctx.group({ parent: wb });
            ctx.rect(60, 646, 580, 38, { rx: 8, fill: ctx.alpha('cyan', 0.1), stroke: 'cyan', sw: 1.4, parent: S.encBar, glow: true });
            ctx.text(350, 665, 'umT5-XXL encoder · 24 bidirectional layers · d = 4096', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.encBar });
            var r = ctx.rng(31);
            var vals = [];
            for (var i = 0; i < 8; i++) { vals.push([]); for (var j = 0; j < 18; j++) vals[i].push(j < 10 ? 0.15 + 0.8 * r() : 0.05); }
            S.emb = ctx.matrix(90, 706, 8, 18, { cell: 16, gap: 3, cmap: 'cyan', values: function () { return 0.02; }, parent: wb });
            S.embC = ctx.text(78, 782, 'C', { size: 16, font: 'mono', weight: 700, color: 'cyan', anchor: 'end', parent: wb });
            S.embP = ctx.para(450, 720, ['10 real tokens', '+ 502 pad slots', '= [512 × 4096]', '→ MLP → d 5120'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: wb });
            return Promise.all([
              ctx.reveal(S.encBar, { from: 'left' }),
              ctx.reveal([S.emb, S.embC, S.embP], { delay: 300 }),
              ctx.packet(S.lP, { color: 'cyan', dur: 700, label: 'tokens' }),
              ctx.tween(1200, function (t) {
                var k = t * 18;
                S.emb.set(function (a, b) { return b < k ? vals[a][b] : 0.02; });
              }, 'linear', 700)
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: cross-attention of one query patch */
            var ca = ctx.group({ parent: wb });
            S.ca = ca;
            ctx.text(720, 600, 'one video token queries the text (1 of 40 blocks, 1 head)', { size: 12, font: 'mono', color: 'dim', parent: ca });
            miniFrame(ctx, ca, 720, 626, 160, 100, 0.25);
            S.qPatch = ctx.rect(744, 676, 26, 26, { rx: 2, stroke: 'amber', sw: 2, parent: ca, glow: true });
            S.qLab = ctx.text(800, 744, 'query patch q', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: ca });
            ctx.line(884, 680, 930, 680, { color: 'amber', sw: 1.4, arrow: true, parent: ca });
            /* illustrative softmax rows (each sums to 1) for the two query patches */
            S.attW = {
              helmet: [0.05, 0.31, 0.23, 0.19, 0.03, 0.01, 0.01, 0.01, 0.05, 0.11],
              capsule: [0.02, 0.04, 0.03, 0.03, 0.04, 0.05, 0.02, 0.02, 0.32, 0.43]
            };
            var labs = ['A', 'fox', 'astro', 'naut', 'stumbles', 'out', 'of', 'a', 'smoking', 'capsule'];
            S.attBars = ctx.bars(945, 620, 590, 120, labs.map(function () { return 0.001; }), { color: 'amber', labels: labs, gap: 8, parent: ca });
            S.attCap = ctx.text(1240, 776, 'attention weights over text tokens (illustrative)', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: ca });
            ctx.text(720, 812, 'o = softmax(q Kᵀ / √d_h) V  ·  K, V ← text C  ·  q ← video tokens X', { size: 13, font: 'mono', color: 'text', parent: ca });
            return Promise.all([
              ctx.reveal(ca, { delay: 100 }),
              ctx.wait(500).then(function () { return ctx.packet(S.lTok, { color: 'cyan', dur: 800, label: 'K, V' }); })
            ]).then(function () { return ctx.pulse(S.qPatch, { color: 'amber', dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the softmax fills in; a second query patch (the capsule) becomes clickable */
            var ca = S.ca;
            S.cap = ctx.group({ parent: ca });
            ctx.rect(782, 690, 26, 14, { rx: 5, fill: '#9aa7c0', stroke: '#e8f1ff', sw: 1, parent: S.cap });
            [[797, 684, 4, 0.4], [802, 677, 3.4, 0.28], [797, 671, 3, 0.2]].forEach(function (c) { ctx.circle(c[0], c[1], c[2], { fill: 'white', opacity: c[3], parent: S.cap }); });
            S.qPatch2 = ctx.rect(778, 664, 34, 42, { rx: 3, stroke: 'amber', sw: 1.4, dash: '4 3', fill: 'rgba(255,255,255,0.01)', parent: S.cap });
            S.qPatch.setAttribute('fill', 'rgba(255,255,255,0.01)');
            var vecs = { helmet: S.attW.helmet, capsule: S.attW.capsule };
            var sums = { helmet: [0.31 + 0.23 + 0.19, 'fox · astro · naut'], capsule: [0.32 + 0.43, 'smoking · capsule'] };
            function select(k, ms) {
              S.sel = k;
              S.qPatch.setAttribute('stroke-dasharray', k === 'helmet' ? 'none' : '4 3'); S.qPatch.setAttribute('stroke-width', k === 'helmet' ? 2 : 1.4);
              S.qPatch2.setAttribute('stroke-dasharray', k === 'capsule' ? 'none' : '4 3'); S.qPatch2.setAttribute('stroke-width', k === 'capsule' ? 2 : 1.4);
              S.qLab.textContent = 'query patch: ' + k;
              S.attCap.textContent = k + ' patch: ' + Math.round(sums[k][0] * 100) + '% of its attention on ' + sums[k][1] + ' (illustrative)';
              return S.attBars.update(vecs[k].map(function (a) { return a / 0.5; }), ms);
            }
            S.qPatch.style.cursor = 'pointer'; S.qPatch2.style.cursor = 'pointer';
            S.qPatch.addEventListener('click', function () { if (!ctx.dead && S.attReady) select('helmet', 500); });
            S.qPatch2.addEventListener('click', function () { if (!ctx.dead && S.attReady) select('capsule', 500); });
            return Promise.all([
              select('helmet', 1000),
              ctx.reveal(S.cap, { delay: 600 })
            ]).then(function () {
              S.attReady = true;
              var hint = ctx.text(884, 704, 'click a patch', { size: 11, font: 'mono', color: 'amber', anchor: 'start', parent: ca });
              return ctx.reveal(hint, { from: 'left' });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: the MM-DiT alternative: one joint sequence */
            var mm = ctx.group({ parent: S.ca });
            ctx.text(720, 846, 'MM-DiT variant (SD3, HunyuanVideo): one joint self-attention over [ text | video ]', { size: 12, font: 'mono', color: 'dim', parent: mm });
            ctx.rect(720, 860, 30, 12, { rx: 2, fill: ctx.alpha('cyan', 0.5), stroke: 'cyan', sw: 1, parent: mm });
            ctx.rect(754, 860, 440, 12, { rx: 2, fill: ctx.alpha('lime', 0.4), stroke: 'lime', sw: 1, parent: mm });
            ctx.text(1206, 866, 'N + 512 tokens, text updated too', { size: 11, font: 'mono', color: 'text', parent: mm });
            return ctx.reveal(mm, { from: 'up' });
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Latent arithmetic',
        beats: [
          {
            say: 'Now the numbers that shape everything. Five seconds at twenty four frames per second is one hundred and twenty one frames of seven twenty by twelve eighty pixels with three colour channels: about three hundred thirty four million numbers.',
            card: { tag: 'NUMBERS', title: 'The raw clip', stat: { v: '334.5 M', u: 'values', l: '121 × 720 × 1280 × 3: 669 MB in bf16 for a single activation' } },
            deep: '<table><tr><th>Stage</th><th>Shape</th><th>Values</th></tr>' +
              '<tr><td>pixels</td><td>121 × 720 × 1280 × 3</td><td>334.5 M</td></tr></table>' +
              '<p>121 = 4·30 + 1 frames of 8-bit RGB. This is the tensor the VAE will compress. A network would hold dozens of activations at least this large, which is why nothing operates on pixels directly: even the 669 MB of one bf16 copy is only the beginning of the memory bill.</p>'
          },
          {
            say: 'The VAE compresses time by four and space by eight in each direction, keeping sixteen channels. That leaves a latent of thirty one by ninety by one hundred sixty, about forty seven times fewer values.',
            card: { tag: 'NUMBERS', title: 'After the VAE', stat: { v: '46.8×', u: 'fewer values', l: '16 × 31 × 90 × 160 = 7.14 M: compression 4 × 8 × 8 in space-time, 3 → 16 channels' } },
            deep: '<table><tr><th>Stage</th><th>Shape</th><th>Values</th></tr>' +
              '<tr><td>pixels</td><td>121 × 720 × 1280 × 3</td><td>334.5 M</td></tr>' +
              '<tr><td>VAE latent</td><td>16 × 31 × 90 × 160</td><td>7.14 M (÷46.8)</td></tr></table>' +
              '<p>Nominal compression 4·8·8·3/16 = 48×; the extra first latent frame (T<sub>lat</sub> = 1 + 120/4 = 31, not 30) makes it 46.8×. Because the VAE is convolutional, the latent keeps the spatial layout: latent pixel (h, w) is a compact code for an 8 × 8 pixel block.</p>'
          },
          {
            say: 'Patchifying two by two in space turns each latent frame into forty five by eighty tokens. Across thirty one frames that is about one hundred and eleven thousand tokens, each sixty four numbers wide.',
            card: { tag: 'NUMBERS', title: 'Tokens for one shot', stat: { v: '111,600', u: 'tokens', l: 'N = 31 × 45 × 80 for a 5 s, 720p shot, patch 1 × 2 × 2, 64 values each' } },
            deep: '<table><tr><th>Stage</th><th>Shape</th><th>Values</th></tr>' +
              '<tr><td>patchify 1×2×2</td><td>31 × 45 × 80 tokens, 64-d each</td><td>N = 111,600</td></tr>' +
              '<tr><td>embed</td><td>N × 5120 (Wan-14B width)</td><td>571 M activations / layer</td></tr></table>' +
              '<p><span class="muted">The DiT, Attention, GPU and Parallelism chambers quote Wan 2.1’s native 16 fps setting instead (81 frames → 21 latent frames → 75,600 tokens, then frame interpolation to 24 fps in post): the same 5 s shot with 1.48× fewer tokens.</span></p>'
          },
          {
            say: 'A linear layer lifts every token to five thousand dimensions, and three dimensional rotary position codes tell attention where each token sits in time, height and width. Full self attention then compares every pair of tokens, in every layer, and that is where the cost explodes.',
            card: { tag: 'PITFALL', title: 'Attention is quadratic in N', body: 'N² ≈ 1.25 × 10¹⁰ pairs per layer. Double the clip and attention cost <b>quadruples</b>; go to 1080p and it grows about 5×.', more: '<p>Per layer, QKᵀ costs 2N²d multiply-adds and the product with V another 2N²d, so 4N²d FLOPs in total. FlashAttention removes the N² <i>memory</i> but not the N²d <i>compute</i>. At 1080p, N grows by 2.25 (pixels) and attention by 2.25² ≈ 5.1.</p>' },
            deep: '<div class="eq">self-attn FLOPs / layer ≈ 4·N²·d = 4 · (1.116×10⁵)² · 5120 ≈ 2.55×10¹⁴</div>' +
              '<p>FlashAttention makes memory O(N) but compute stays O(N²d): doubling the clip length quadruples attention cost; going to 1080p multiplies N by 2.25 and attention by ~5.</p>' +
              '<details><summary>Go deeper</summary><p><b>3D RoPE.</b> The head dimension is split into three groups that rotate with the frame index t, the row h and the column w (Wan: 44, 42 and 42 of 128 dims). Positions enter only through the q·k inner product, so the same weights accept other clip lengths and resolutions, and multi-resolution fine-tuning only changes the position grids. <b>At 1080p</b> (1088 × 1920, 8× VAE, 2×2 patches) N = 31 · 68 · 120 = 252,960 tokens and N² = 6.4×10¹⁰ pairs, 5.1× the 720p cost per layer.</p></details>' +
              '<div class="note">Levers on N: higher-compression VAEs (Wan 2.2 TI2V-5B: 4×16×16 with 48 channels; LTX-Video ~1:192), larger patches, and sparse / sliding-window spatiotemporal attention. The VAE chamber shows the reconstruction-versus-generation trade-off.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'from pixels to tokens · the budget that sets the cost');
          ctx.hud('raw clip = 334.5 M values');
          ctx.focus([S.div, wb, S.venc, S.noise, S.noiseL, S.dit, S.vdec, S.lN], 0.25);
          var fmtM = function (v) { return (v / 1e6).toFixed(v < 1e7 ? 2 : 1) + ' M'; };
          /* beat 1: pixels */
          var g1 = ctx.group({ parent: wb });
          ctx.text(150, 606, 'PIXELS', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', spacing: 2, parent: g1 });
          for (var i = 5; i >= 0; i--) miniFrame(ctx, g1, 70 + i * 9, 650 - i * 7, 140, 80, i / 5);
          ctx.text(160, 760, '121 × 720 × 1280 × 3', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g1 });
          S.c1 = ctx.text(160, 790, '0', { size: 20, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: g1 });
          ctx.text(160, 816, 'values', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g1 });
          return Promise.all([
            ctx.reveal(g1, { from: 'left' }),
            ctx.counter(S.c1, 0, 334540800, 1200, fmtM)
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: VAE compression */
            var a1 = ctx.group({ parent: wb });
            arrowLabel(ctx, a1, 270, 395, 700, 'VAE encoder', '÷4 t · ÷8 h · ÷8 w', 'lime');
            var g2 = ctx.group({ parent: wb });
            ctx.text(478, 606, 'LATENT', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', spacing: 2, parent: g2 });
            var rr = ctx.rng(9);
            cube(ctx, { cx: 478, cy: 690, w: 84, h: 72, d: 30, color: 'lime', n: 6, parent: g2, mosaic: function () { var k = 50 + 150 * rr(); return 'rgb(' + Math.round(k * 0.7) + ',' + Math.round(k) + ',' + Math.round(k * 0.8) + ')'; } });
            ctx.text(478, 760, '16 × 31 × 90 × 160', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g2 });
            S.c2 = ctx.text(478, 790, '0', { size: 20, font: 'mono', weight: 700, color: 'lime', anchor: 'middle', parent: g2 });
            ctx.text(478, 816, 'values (÷46.8)', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g2 });
            return Promise.all([
              ctx.reveal(a1, {}),
              ctx.reveal(g2, { from: 'scale', delay: 400 }),
              ctx.wait(500).then(function () { return ctx.counter(S.c2, 0, 7142400, 1000, fmtM); }),
              ctx.pulse(S.venc, { color: 'lime', dur: 700 })
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: patchify into tokens */
            var a2 = ctx.group({ parent: wb });
            arrowLabel(ctx, a2, 565, 690, 700, 'patchify', '1 × 2 × 2 → 64-d', 'lime');
            var g3 = ctx.group({ parent: wb });
            ctx.text(790, 606, 'TOKENS', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', spacing: 2, parent: g3 });
            var rt = ctx.rng(17);
            S.tokGrid = ctx.matrix(706, 646, 7, 12, { cell: 11, gap: 3, cmap: 'lime', values: function () { return 0.25 + 0.6 * rt(); }, parent: g3 });
            ctx.text(790, 760, '31 × 45 × 80', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g3 });
            S.c3 = ctx.text(790, 790, '0', { size: 20, font: 'mono', weight: 700, color: 'lime', anchor: 'middle', parent: g3 });
            ctx.text(790, 816, 'tokens N', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g3 });
            ctx.hud('N = 31 × 45 × 80 = 111,600 tokens per sample');
            return Promise.all([
              ctx.reveal(a2, {}),
              ctx.reveal(g3, { from: 'up', delay: 400 }),
              ctx.wait(500).then(function () { return ctx.counter(S.c3, 0, 111600, 1000); })
            ]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the sequence the DiT sees, and the quadratic bill */
            var a3 = ctx.group({ parent: wb });
            arrowLabel(ctx, a3, 895, 1010, 700, 'Linear', '64 → 5120', 'lime');
            var g4 = ctx.group({ parent: wb });
            ctx.text(1275, 606, 'SEQUENCE FOR THE DiT', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', spacing: 2, parent: g4 });
            ctx.text(1275, 646, 'X ∈ ℝ^(111,600 × 5120) · 3D RoPE on q, k', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: g4 });
            for (var s = 0; s < 44; s++) {
              ctx.rect(1030 + s * 11.2, 684, 9.5, 32, { rx: 1.5, fill: ctx.cmap('lime', 0.25 + 0.5 * ((s * 37) % 11) / 11), parent: g4 });
            }
            ctx.text(1275, 760, 'full 3D self-attention: N² ≈ 1.25 × 10¹⁰ pairs', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: g4 });
            var f4 = ctx.text(1275, 790, '4·N²·d ≈ 2.6 × 10¹⁴ FLOPs per layer', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', parent: g4 });
            ctx.text(1275, 820, '× 40 layers × 100 passes per clip', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g4 });
            return Promise.all([
              ctx.reveal(a3, {}),
              ctx.reveal(g4, { from: 'right', delay: 300 }),
              ctx.wait(1000).then(function () { return ctx.pulse(f4, { color: 'amber', times: 2, dur: 600 }); })
            ]);
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'The denoising loop',
        beats: [
          {
            say: 'Generation runs noising in reverse. We sample a latent of pure Gaussian noise at time one, with exactly the shape of the clean latent we hope to end with.',
            card: { tag: 'KEY IDEA', title: 'Start from pure noise', body: 'The sampler state <code>z</code> has the shape of the clean latent: 16 × 31 × 90 × 160 = 7.14 M Gaussian values at <code>t = 1</code>.' },
            deep: '<p><b>Rectified flow / flow matching</b> (SD3, Wan, HunyuanVideo, Movie Gen) defines a straight path between data and noise:</p>' +
              '<div class="eq">z<sub>t</sub> = (1 − t)·x<sub>0</sub> + t·ε,   target v = ε − x<sub>0</sub></div>' +
              '<p>At t = 1 the state is pure noise ε ~ N(0, I). The seed fixes ε, so the same seed gives the same starting point: the only randomness in a deterministic sampler. The state is the 7.14 M-value latent, never pixels.</p>'
          },
          {
            say: 'At each step the transformer predicts a velocity, the direction of the straight line between data and noise, and a simple Euler update moves the latent a small step against it, toward the data. With the shifted schedule, the first thirty steps still leave the picture mostly noise.',
            card: { tag: 'HOW IT WORKS', title: 'One step, one DiT forward', body: 'The network predicts <code>v ≈ ε − x₀</code>; Euler moves <code>z</code> by <code>Δt · v</code>. With guidance that is two forwards per step.' },
            deep: '<div class="eq">L = E<sub>t,x₀,ε</sub> ‖ v<sub>θ</sub>(z<sub>t</sub>, t, c) − (ε − x<sub>0</sub>) ‖²</div>' +
              '<p>Sampling integrates dz/dt = v<sub>θ</sub> from t = 1 to 0 with an Euler step per network call:</p>' +
              '<div class="eq">z<sub>i+1</sub> = z<sub>i</sub> + (t<sub>i+1</sub> − t<sub>i</sub>) · v<sub>θ</sub>(z<sub>i</sub>, t<sub>i</sub>, c)</div>' +
              '<p>Training typically samples t from a logit-normal and never runs the ODE. Solvers other than Euler (Heun, DPM-Solver++, UniPC) trade extra evaluations or stored history for accuracy; production video uses 30–50 steps.</p>'
          },
          {
            say: 'In the final twenty steps the picture emerges: the moon, the ice horizon, the fox. Layout and colour are decided first, and fine detail like the helmet rim and the eyes only appears at the very end.',
            card: { tag: 'TRY IT', title: 'Scrub the sampler yourself', body: 'Click or drag along the schedule curve to jump to any of the 50 steps and see when the picture emerges. Most of the visible change happens in the last twenty.' },
            deep: '<div class="note">At any step, x̂<sub>0</sub> = z<sub>t</sub> − t·v<sub>θ</sub> is a free preview of the final clip. Decoded at low resolution it powers the live “preview.ready” events streamed to the creator.</div>' +
              '<p>Because the state is a straight-line blend of an image and noise, the picture becomes visible only once t drops below about 0.6. The transformer, however, has been fixing composition and motion long before the eye can see it.</p>'
          },
          {
            say: 'The schedule is shifted toward high noise, where the large scale layout of the shot is decided. Compare the dashed uniform grid with the shifted one: most of the fifty steps are spent while the latent is still mostly noise.',
            card: { tag: 'NUMBERS', title: 'Steps spent at high noise', stat: { v: '84%', l: 'of the 50 steps (42) have t above 0.5 with shift 5; a uniform grid puts only half of them there' } },
            deep: '<p><b>Timestep shift</b>: t′ = s·t / (1 + (s − 1)·t), with s ≈ 5 at 720p (Wan default). At high resolution neighbouring latents are redundant, so a given noise level destroys less information; the shift spends more steps at high noise where composition and motion are decided.</p>' +
              '<p>With s = 5 and 50 steps, the first 18 steps have t > 0.9, and 42 of the 50 have t > 0.5. The denoising chamber shows why the shift grows with the number of tokens.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.loopStream) { S.loopStream.stop(); S.loopStream = null; }
          var wb = newBench(ctx, S, 'flow-matching sampler · z moves from noise (t = 1) to data (t = 0)');
          ctx.hud('sampler starts at t = 1: pure noise');
          ctx.focus([S.div, wb, S.noise, S.noiseL, S.dit, S.loopG, S.z0, S.z0L, S.lN, S.lZ, S.tok, S.lTok], 0.25);
          var R = 14, Cc = 26;
          var rg = ctx.rng(123);
          var img = [], nz = [];
          for (var i = 0; i < R; i++) {
            img.push([]); nz.push([]);
            for (var j = 0; j < Cc; j++) {
              img[i].push(fieldRGB((j + 0.5) / Cc, (i + 0.5) / R));
              nz[i].push([128 + 60 * gauss(rg), 128 + 60 * gauss(rg), 128 + 60 * gauss(rg)]);
            }
          }
          function at(t) {
            return function (a, b) {
              var p = img[a][b], q = nz[a][b];
              return rgbStr([ctx.clamp((1 - t) * p[0] + t * q[0], 0, 255), ctx.clamp((1 - t) * p[1] + t * q[1], 0, 255), ctx.clamp((1 - t) * p[2] + t * q[2], 0, 255)]);
            };
          }
          var shift = 5;
          function sched(u) { var t = 1 - u; return shift * t / (1 + (shift - 1) * t); }
          /* beat 1: pure noise */
          S.grid = ctx.matrix(60, 592, R, Cc, { cell: 11, gap: 1, values: at(1), parent: wb });
          S.eq1 = ctx.text(60, 782, 'z_t = (1 − t)·x₀ + t·ε', { size: 13, font: 'mono', color: 'text', parent: wb });
          S.readout = ctx.text(60, 812, 'step 0 / 50 · t = 1.000', { size: 15, font: 'mono', weight: 600, color: 'lime', parent: wb });
          S.prev = ctx.text(60, 842, 'preview: x₀ ≈ z_t − t·v  (free at any step)', { size: 12, font: 'mono', color: 'dim', parent: wb });
          function setStep(i) {
            var t = sched(i / 50);
            S.grid.set(at(t));
            S.readout.textContent = 'step ' + i + ' / 50 · t = ' + t.toFixed(3);
            if (S.dot) {
              var pt = S.pl2.toPx(i / 50, t);
              S.dot.setAttribute('cx', pt.x); S.dot.setAttribute('cy', pt.y);
            }
          }
          /* run steps a..b of 50 over dur ms */
          function sweep(a, b, dur) {
            return ctx.tween(dur, function (p) { setStep(Math.min(50, Math.floor(a + (b - a) * p + 1e-6))); }, 'linear');
          }
          return ctx.reveal([S.grid, S.eq1, S.readout, S.prev], { delay: 100, stagger: 120 }).then(function () {
            return ctx.pulse(S.noise, { color: 'lime', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: velocity, Euler step, the schedule plot and the running counter */
            var eq = ctx.group({ parent: wb });
            ctx.text(850, 604, 'TRAIN', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: eq });
            ctx.text(850, 632, 'loss = ‖ v_θ(z_t, t, c) − (ε − x₀) ‖²', { size: 15, font: 'mono', color: 'white', parent: eq });
            ctx.text(850, 660, 't ~ logit-normal, ε ~ N(0, I), x₀ = VAE(video)', { size: 12, font: 'mono', color: 'dim', parent: eq });
            ctx.text(850, 704, 'SAMPLE', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: eq });
            ctx.text(850, 732, 'z ← z + (t_{i+1} − t_i) · v_θ(z, t_i, c)', { size: 15, font: 'mono', color: 'white', parent: eq });
            ctx.text(850, 760, '1 step = 1 DiT forward (2 with CFG) over 111,600 tokens', { size: 12, font: 'mono', color: 'lime', parent: eq });
            ctx.text(850, 790, 'solvers: Euler, Heun, DPM-Solver++ / UniPC (flow variants)', { size: 12, font: 'mono', color: 'dim', parent: eq });
            S.pl2 = ctx.plot(470, 600, 300, 180, sched, { color: 'lime', sw: 2.2, xLabel: 'step i / 50', yLabel: 't', parent: wb });
            ctx.text(700, 632, 'shift s = 5', { size: 12, font: 'mono', color: 'lime', parent: wb });
            S.dot = ctx.circle(470, 600, 6, { fill: 'lime', parent: wb, glow: true });
            S.loopStream = ctx.stream(S.loopP, { color: 'lime', count: 3, period: 900 });
            ctx.hud('50 Euler steps · t: 1 → 0 · shift 5');
            return Promise.all([
              ctx.reveal(eq, { from: 'right' }),
              ctx.reveal(S.pl2, { delay: 200 }),
              ctx.wait(500).then(function () { return sweep(0, 30, 2600); })
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: structure emerges; when the sweep ends the schedule plot becomes a scrubber */
            return sweep(30, 50, 3800).then(function () {
              S.hit5 = ctx.rect(470, 596, 300, 190, { rx: 0, fill: 'rgba(255,255,255,0.01)', parent: wb });
              S.hit5.style.cursor = 'ew-resize';
              function seek(ev) {
                if (ctx.dead) return;
                var svg = S.hit5.ownerSVGElement, pt = svg.createSVGPoint(), m = S.hit5.getScreenCTM();
                if (!m) return;
                pt.x = ev.clientX; pt.y = ev.clientY;
                var p = pt.matrixTransform(m.inverse());
                setStep(Math.round(ctx.clamp((p.x - 470) / 300, 0, 1) * 50));
              }
              S.hit5.addEventListener('click', seek);
              S.hit5.addEventListener('mousemove', function (ev) { if (ev.buttons & 1) seek(ev); });
              var sl = ctx.text(770, 588, 'click or drag the curve to scrub', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: wb });
              return ctx.reveal(sl, { from: 'up' }).then(function () { return ctx.pulse(S.dot, { color: 'lime', dur: 600 }); });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the uniform grid for comparison, and where the 50 steps actually sit */
            S.pl = ctx.plot(470, 600, 300, 180, function (u) { return 1 - u; }, { color: ctx.alpha('dim', 0.8), sw: 1.5, axes: false, parent: wb });
            S.pl.curve.setAttribute('stroke-dasharray', '6 5');
            ctx.text(620, 744, 'uniform', { size: 11, font: 'mono', color: 'dim', parent: wb });
            var half = S.pl2.toPx(0.8333, 0.5);
            var hl = ctx.line(470, half.y, 770, half.y, { color: ctx.alpha('amber', 0.6), sw: 1, dash: '3 4', parent: wb });
            var hlT = ctx.text(776, half.y, 't = 0.5', { size: 11, font: 'mono', color: 'amber', parent: wb });
            var vl = ctx.line(half.x, 600, half.x, 780, { color: ctx.alpha('amber', 0.6), sw: 1, dash: '3 4', parent: wb });
            var tickG = ctx.group({ parent: wb });
            for (var k = 0; k <= 50; k++) {
              var tp = sched(k / 50);
              ctx.line(470 + tp * 300, 812, 470 + tp * 300, 826, { color: ctx.alpha('lime', 0.8), sw: 1, parent: tickG });
            }
            ctx.text(470, 840, 't = 0', { size: 11, font: 'mono', color: 'dim', parent: wb });
            ctx.text(770, 840, 't = 1', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: wb });
            ctx.text(454, 819, '50 steps', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: wb });
            var note = ctx.text(520, 858, '42 of 50 steps have t > 0.5', { size: 12, font: 'mono', color: 'lime', parent: wb });
            wb.appendChild(S.hit5);   /* keep the scrubber on top of the new plot elements */
            return Promise.all([
              ctx.reveal(S.pl.curve, { from: 'draw', dur: 900 }),
              ctx.reveal([hl, hlT, vl], { delay: 300 }),
              ctx.reveal(tickG, { delay: 600 }),
              ctx.reveal(note, { from: 'up', delay: 900 })
            ]).then(function () { return ctx.pulse(S.dot, { color: 'lime', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Guidance & compute',
        beats: [
          {
            say: 'Text alone is a weak signal, so samplers use classifier free guidance. Each step runs the transformer twice, once with the prompt and once with an empty prompt.',
            card: { tag: 'HOW IT WORKS', title: 'Conditional and unconditional', body: 'Same weights, batched by two: one pass sees the prompt <code>c</code>, the other an empty prompt <code>∅</code> (or a negative prompt).' },
            deep: '<p><b>Training</b> drops the condition ~10% of the time (empty prompt), so a single network learns both the conditional and the unconditional velocity field.</p>' +
              '<p><b>Sampling</b> evaluates both at every step. The two branches share weights and the same latent, so they are batched (2×N tokens) or split across GPUs (CFG parallelism). In practice a <i>negative prompt</i> (“blurry, static, distorted…”) replaces ∅ and steers away from unwanted content.</p>'
          },
          {
            say: 'The difference between the two predictions points toward the prompt, and the sampler extrapolates along it by a guidance scale of about five.',
            card: { tag: 'TRADE-OFF', title: 'Adherence bought with diversity', body: 'Around <code>w = 5</code> the prompt is followed closely. Push higher and colour oversaturates, variety drops, motion can freeze.' },
            deep: '<div class="eq">v = v<sub>θ</sub>(z, t, ∅) + w · ( v<sub>θ</sub>(z, t, c) − v<sub>θ</sub>(z, t, ∅) ),   w ≈ 5</div>' +
              '<ul><li>High w oversaturates and kills diversity; fixes: guidance interval (only mid-t), APG (drop the parallel component), CFG-Zero*, CFG-rescale.</li>' +
              '<li>Guidance- and step-distilled students (DMD2, consistency, adversarial) run 4–8 steps without CFG: ~12–25× fewer passes.</li></ul>' +
              '<details><summary>Go deeper</summary><p><b>Why the same formula works on every target.</b> With z<sub>t</sub> = (1 − t)x<sub>0</sub> + tε and v = ε − x<sub>0</sub>, the clean-sample estimate is x̂<sub>0</sub> = z<sub>t</sub> − t·v, which is linear in v. Guiding the velocity therefore guides the x<sub>0</sub> and ε estimates identically: x̂<sub>0,w</sub> = x̂<sub>0,∅</sub> + w(x̂<sub>0,c</sub> − x̂<sub>0,∅</sub>). In score terms the update is ∇log p(z) + w·∇log p(c | z), a Bayes-rule product p(z)·p(c | z)<sup>w</sup>. Two branches with two different conditioning tensors also explain the cost: the text matrices differ, so batching them is a 2× wider batch, not a shared computation.</p></details>'
          },
          {
            say: 'That doubles the cost. At this resolution one forward pass is about thirteen peta operations, roughly four fifths of it self attention.',
            card: { tag: 'NUMBERS', title: 'One forward pass', stat: { v: '12.9', u: 'PFLOPs', l: '1.29 × 10¹⁶ per forward pass: 79% self-attention, 21% linear layers, 0.4% cross-attention' } },
            deep: '<p>Per forward pass (Wan-14B-class: d = 5120, 40 layers, FFN 13824, N = 111,600):</p>' +
              '<table><tr><th>Term</th><th>FLOPs</th></tr>' +
              '<tr><td>self-attention 4N²d × 40</td><td>1.02×10¹⁶ (79%)</td></tr>' +
              '<tr><td>linear (QKVO, FFN, cross Q/O) 2·P<sub>act</sub>·N</td><td>2.67×10¹⁵ (21%)</td></tr>' +
              '<tr><td>cross-attn 4·N·512·d × 40</td><td>4.7×10¹³</td></tr>' +
              '<tr><td><b>total / forward</b></td><td><b>1.29×10¹⁶</b></td></tr></table>' +
              '<details><summary>Go deeper</summary><p><b>Bookkeeping.</b> Per layer QKᵀ costs 2N²d and softmax(·)V another 2N²d multiply-add FLOPs, hence 4N²d; forty layers give 1.02×10¹⁶. The token-wise matmuls touch P<sub>act</sub> ≈ 12.0 B weights (per block: self QKVO 105 M, cross Q and O 52 M, MLP 142 M; the cross K and V act on only 512 text tokens), so they cost 2·P<sub>act</sub>·N = 2.67×10¹⁵. Attention grows as N² and everything else as N, so the attention share rises with resolution and duration: at 1080p it is already about 90%.</p></details>'
          },
          {
            say: 'Fifty steps with two passes each make one hundred forwards: over a quintillion operations for one clip, roughly one hour on a single H one hundred GPU before any optimisation.',
            card: { tag: 'NUMBERS', title: 'The bill for one clip', stat: { v: '≈ 54', u: 'H100-min', l: '1.29 × 10¹⁸ FLOPs at 40% MFU on one H100; about 7 min on 8 GPUs at ideal scaling' }, more: '<p>H100 dense BF16 peak is 989 TFLOP/s. At 40% MFU that is 396 TFLOP/s, so 1.29 × 10¹⁸ / 3.96 × 10¹⁴ ≈ 3,260 s ≈ 54 GPU-minutes. On 8 GPUs with Ulysses or ring sequence parallelism the ideal time is ~7 min; real systems lose 10–30% to all-to-all communication.</p>' },
            deep: '<p>× 50 steps × 2 (CFG) = <b>1.29×10¹⁸ FLOPs</b>. H100 dense BF16 peak 989 TFLOP/s; at 40% MFU → ≈ 3,260 s ≈ 54 GPU-minutes; 8 GPUs with Ulysses/ring sequence parallelism → ~7 min at ideal scaling (real systems lose 10–30% to all-to-all communication).</p>' +
              '<p>The overview’s ~95 s per shot on 8 GPUs (≈ 13 GPU-min) assumes about 4× less work than this baseline: guidance distillation (no second pass), fewer steps and step caching. The distillation section of the diffusion chamber gives the arithmetic.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.loopStream) { S.loopStream.stop(); S.loopStream = null; }
          var wb = newBench(ctx, S, 'classifier-free guidance · and what one clip costs');
          ctx.hud('CFG: two forwards per step');
          ctx.focus([S.div, wb, S.dit, S.loopG, S.tok, S.lTok], 0.25);
          /* beat 1: two passes */
          var g = ctx.group({ parent: wb });
          S.dC = ctx.node({ x: 170, y: 620, w: 210, h: 50, title: 'DiT(z, t, c)', sub: 'prompt', color: 'lime', titleSize: 14, subSize: 11, parent: g });
          S.dU = ctx.node({ x: 170, y: 720, w: 210, h: 50, title: 'DiT(z, t, ∅)', sub: 'empty prompt', color: 'dim', titleSize: 14, subSize: 11, parent: g });
          ctx.text(170, 790, 'same weights · batched ×2', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          return Promise.all([
            ctx.reveal(g, { from: 'left' }),
            ctx.pulse(S.dit, { color: 'lime', times: 2, dur: 600 })
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: extrapolate along the guidance direction */
            var O = { x: 390, y: 835 };
            var vu = { x: O.x + 120, y: O.y - 50 }, vc = { x: O.x + 150, y: O.y - 90 };
            var vg = ctx.group({ parent: wb });
            ctx.circle(O.x, O.y, 4, { fill: 'white', parent: vg });
            S.aU = ctx.line(O.x, O.y, vu.x, vu.y, { color: 'dim', sw: 2.2, arrow: true, parent: vg });
            S.aC = ctx.line(O.x, O.y, vc.x, vc.y, { color: 'lime', sw: 2.2, arrow: true, parent: vg });
            ctx.text(vu.x + 10, vu.y + 12, 'v_uncond', { size: 12, font: 'mono', color: 'dim', parent: vg });
            ctx.text(vc.x + 14, vc.y + 8, 'v_cond', { size: 12, font: 'mono', color: 'lime', parent: vg });
            ctx.line(vu.x, vu.y, vc.x, vc.y, { color: 'amber', sw: 1.2, dash: '3 4', parent: vg });
            S.aG = ctx.line(O.x, O.y, vc.x, vc.y, { color: 'amber', sw: 3, arrow: true, parent: vg, glow: true });
            S.ext = ctx.line(vu.x, vu.y, vc.x, vc.y, { color: ctx.alpha('amber', 0.5), sw: 1.2, dash: '3 4', parent: vg });
            S.wTxt = ctx.text(610, 820, 'w = 1.0', { size: 18, font: 'mono', weight: 700, color: 'amber', parent: vg });
            S.gTxt = ctx.text(610, 846, 'guided velocity', { size: 12, font: 'mono', color: 'amber', parent: vg });
            S.lC = ctx.path('M278,632 L382,822', { stroke: 'lime', sw: 1.2, dash: '4 4', arrow: true, parent: wb });
            S.lU = ctx.path('M278,732 L378,826', { stroke: 'dim', sw: 1.2, dash: '4 4', arrow: true, parent: wb });
            var W = 5;
            return Promise.all([ctx.reveal(vg, { delay: 100 }), ctx.reveal([S.lC, S.lU], { from: 'draw', delay: 200 })]).then(function () {
              return ctx.wait(500);
            }).then(function () {
              return ctx.tween(2000, function (t) {
                var w = 1 + (W - 1) * t;
                var gx = vu.x + w * (vc.x - vu.x), gy = vu.y + w * (vc.y - vu.y);
                S.aG.setAttribute('x2', gx); S.aG.setAttribute('y2', gy);
                S.ext.setAttribute('x2', gx); S.ext.setAttribute('y2', gy);
                S.wTxt.textContent = 'w = ' + w.toFixed(1);
              }, 'inOut');
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: FLOPs per forward pass */
            S.cp = ctx.group({ parent: wb });
            ctx.text(820, 600, 'FLOPs PER FORWARD · Wan-14B-class, 720p, 5 s', { size: 12, font: 'mono', color: 'dim', parent: S.cp });
            var rows = [['self-attention', 1.02, 'amber', '1.02×10¹⁶'], ['linear + FFN', 0.267, 'lime', '2.67×10¹⁵'], ['cross-attention', 0.0047, 'cyan', '4.7×10¹³']];
            S.cBars = rows.map(function (r, i) {
              var y = 620 + i * 36;
              ctx.text(980, y + 12, r[0], { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: S.cp });
              var b = ctx.rect(992, y, Math.max(2, 400 * r[1] / 1.02), 24, { rx: 3, fill: ctx.alpha(r[2], 0.45), stroke: r[2], sw: 1, parent: S.cp });
              ctx.text(1402, y + 12, r[3], { size: 12, font: 'mono', color: r[2], parent: S.cp });
              return b;
            });
            var pr = ctx.reveal(S.cp, { delay: 100 });
            var grow = S.cBars.map(function (b, i) {
              var w = parseFloat(b.getAttribute('width'));
              b.setAttribute('width', 0);
              return ctx.animate(b, { width: [0, w] }, 700, 'out', 400 + i * 200);
            });
            return Promise.all([pr].concat(grow));
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the whole clip */
            var t1 = ctx.text(820, 750, '× 50 steps × 2 (CFG) = 100 forwards per clip', { size: 13, font: 'mono', color: 'text', parent: S.cp });
            S.total = ctx.text(820, 784, '', { size: 22, font: 'mono', weight: 700, color: 'lime', parent: S.cp });
            var t3 = ctx.text(820, 816, 'H100 989 TFLOP/s × 40% MFU → ~54 GPU-min · 8 GPUs (seq-parallel) → ~7 min', { size: 12, font: 'mono', color: 'dim', parent: S.cp });
            var t4 = ctx.text(820, 844, 'distilled student: 4 steps, no CFG → 4 forwards (25× fewer)', { size: 12, font: 'mono', color: 'amber', parent: S.cp });
            ctx.hud('1 clip ≈ 1.3×10¹⁸ FLOPs ≈ 1 H100-hour');
            return Promise.all([
              ctx.reveal([t1, t3, t4], { from: 'up', stagger: 200 }),
              ctx.wait(300).then(function () { return ctx.typeText(S.total, '1.29 × 10¹⁸ FLOPs per clip', 700); })
            ]);
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Image & control inputs',
        beats: [
          {
            say: 'The reference sketch enters differently. For image to video, the VAE encodes the conditioning frame, padded with zeros for the frames to be generated, and its latent is concatenated channel wise with the noise, together with a mask that says which frames are given.',
            card: { tag: 'HOW IT WORKS', title: 'Concatenate along channels', body: 'Noise (16 channels) ⊕ mask (4) ⊕ reference latent (16). The mask marks which frames are given.' },
            deep: '<p><b>Wan 2.1 I2V</b> builds the DiT input by channel concatenation:</p>' +
              '<div class="eq">x<sub>in</sub> = [ z<sub>t</sub> ; m ; E(ref ⊕ 0) ]<br>∈ ℝ<sup>(16 + 4 + 16) × 31 × 90 × 160</sup></div>' +
              '<p>z<sub>t</sub> is the noisy latent (16 channels). The reference is encoded together with 120 all-zero frames, so E(·) sees a full-length clip whose first frame is the sketch (16 channels). The mask m marks which frames are given; since one latent frame packs 4 pixel frames, the per-frame mask is folded into 4 channels.</p>'
          },
          {
            say: 'Stacked together they form a thirty six channel input, and only the patch embedding layer changes shape. The image to video model is otherwise the text to video architecture, initialised from it and fine tuned.',
            card: { tag: 'NUMBERS', title: 'A wider first layer', stat: { v: '36', u: 'channels', l: '16 noise + 4 mask + 16 reference into Conv3d(36 → 5120, kernel 1 × 2 × 2)' } },
            deep: '<p>On the input side only the patch-embedding Conv3d (36 → 5120, kernel 1×2×2) changes shape; the I2V model is otherwise the T2V architecture, initialised from it and fine-tuned. Extra input channels are typically zero-initialised, so at step 0 the I2V model behaves exactly like the T2V model.</p>' +
              '<p>In this channel-concatenation design the whole latent, first frame included, is noised and denoised as usual, and the clean reference reaches the network only through the extra channels. Other designs treat the given frame as clean tokens instead: Wan 2.2 TI2V-5B and LTX-Video overwrite the first latent frame with the reference latent and give those tokens timestep 0, while CogVideoX-I2V adds light noise to the conditioning image so the model does not simply copy it.</p>'
          },
          {
            say: 'Image embeddings from a vision encoder add a second cross attention path that carries the meaning of the sketch, its identity and style, rather than its pixels.',
            card: { tag: 'HOW IT WORKS', title: 'Pixels for layout, CLIP for meaning', body: 'The latent path fixes composition. CLIP ViT-H features (257 × 1280) add semantics through a decoupled cross-attention.' },
            deep: '<p>A second path injects semantics (Wan 2.1): CLIP ViT-H/14 penultimate features of the image (257 × 1280) pass an MLP projector and a <i>decoupled</i> cross-attention (new K<sub>img</sub>, V<sub>img</sub> per block) whose output is added to the text cross-attention.</p>' +
              '<p>Wan 2.2 drops this CLIP path and relies on the latent concatenation alone: the semantic path helps identity but adds parameters and a second conditioning branch to shard and cache.</p>'
          },
          {
            say: 'The same slots carry other controls: camera trajectories, depth or pose, identity references and keyframes. Keeping the fox the same fox across shots is the job of the control and consistency chamber.',
            card: { tag: 'TRY IT', title: 'Open the control chamber', body: 'The lime dashed <b>Control</b> node is a zoom target: camera paths, depth and pose, identity references, keyframes.' },
            deep: '<ul><li><b>Camera</b>: per-pixel Plücker ray embeddings (CameraCtrl) or camera tokens.</li>' +
              '<li><b>Structure</b>: depth / pose / edges / optical flow through a context adapter (Wan VACE, ControlNet-style).</li>' +
              '<li><b>Identity</b>: reference-to-video (Phantom, VACE R2V), reference latents as extra tokens.</li>' +
              '<li><b>Time</b>: first-last-frame (FLF2V), and extension by conditioning on the last latent frames of the previous shot.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'image-to-video conditioning and control signals');
          ctx.hud('I2V: reference enters the DiT input');
          ctx.focus([S.div, wb, S.ref, S.lR, S.venc, S.lV, S.noise, S.noiseL, S.dit], 0.25);
          /* beat 1: three slabs */
          var rn = ctx.rng(77);
          var sl = [
            { cx: 110, w: 48, col: 'lime', lab: 'z_t · 16', mos: function () { var k = 60 + 150 * rn(); return 'rgb(' + Math.round(k * 0.7) + ',' + Math.round(k) + ',' + Math.round(k * 0.8) + ')'; } },
            { cx: 205, w: 18, col: 'amber', lab: 'mask · 4', mos: function (i, j) { return j === 0 ? '#ffbf3a' : '#1a1206'; } },
            { cx: 300, w: 48, col: 'violet', lab: 'E(ref ⊕ 0) · 16', mos: function (i, j, n) { return j < 1 ? rgbStr(fieldRGB(0.3, (i + 0.5) / n)) : '#0f0b24'; } }
          ];
          S.slabs = sl.map(function (s) {
            var g = ctx.group({ parent: wb });
            cube(ctx, { cx: s.cx, cy: 690, w: s.w, h: 90, d: 26, color: s.col, n: 5, mosaic: s.mos, parent: g });
            ctx.text(s.cx, 770, s.lab, { size: 11, font: 'mono', color: s.col, anchor: 'middle', parent: g });
            return g;
          });
          S.plus = ctx.group({ parent: wb });
          ctx.text(157, 690, '⊕', { size: 18, color: 'white', anchor: 'middle', parent: S.plus });
          ctx.text(252, 690, '⊕', { size: 18, color: 'white', anchor: 'middle', parent: S.plus });
          return Promise.all([
            ctx.reveal(S.slabs, { from: 'up', stagger: 200 }),
            ctx.reveal(S.plus, { delay: 700 }),
            ctx.wait(400).then(function () { return ctx.packet(S.lR, { color: 'violet', dur: 600 }); }).then(function () { return ctx.packet(S.lV, { color: 'lime', dur: 600 }); })
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: merge into one 36-channel tensor */
            var ar = ctx.group({ parent: wb });
            arrowLabel(ctx, ar, 345, 410, 690, '', '', 'lime');
            var mg = ctx.group({ parent: wb });
            cube(ctx, { cx: 485, cy: 690, w: 80, h: 90, d: 26, color: 'lime', n: 6, parent: mg, mosaic: function (i, j) { return j < 2 ? '#3d8a3a' : (j < 3 ? '#8a6a20' : '#4b3a88'); } });
            ctx.text(485, 770, '36 × 31 × 90 × 160', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: mg });
            var m1 = ctx.text(60, 812, 'patch-embed Conv3d(36 → 5120, k = 1×2×2): the only input layer reshaped', { size: 12, font: 'mono', color: 'lime', parent: mg });
            var m2 = ctx.text(60, 840, 'first frame given, 120 frames free → mask marks frame 0', { size: 12, font: 'mono', color: 'dim', parent: mg });
            ctx.hud('I2V input = 16 + 4 + 16 = 36 channels');
            return Promise.all([
              ctx.transform(S.slabs[0], { x: 150 }, 900, 'inOut'),
              ctx.transform(S.slabs[1], { x: 100 }, 900, 'inOut'),
              ctx.transform(S.slabs[2], { x: 55 }, 900, 'inOut')
            ]).then(function () {
              return Promise.all([
                ctx.transform(S.slabs[0], { x: 0 }, 700, 'out'), ctx.transform(S.slabs[1], { x: 0 }, 700, 'out'), ctx.transform(S.slabs[2], { x: 0 }, 700, 'out'),
                ctx.reveal(ar, {}), ctx.reveal(mg, { from: 'scale', delay: 200 })
              ]);
            }).then(function () { return ctx.pulse(S.dit, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the semantic path */
            var rp = ctx.group({ parent: wb });
            S.rp = rp;
            ctx.text(700, 600, 'SEMANTIC PATH', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: rp });
            foxSketch(ctx, rp, 700, 620, 80);
            ctx.line(790, 650, 830, 650, { color: 'violet', arrow: true, parent: rp });
            ctx.label(900, 650, 'CLIP ViT-H/14', { color: 'violet', size: 12, parent: rp });
            ctx.line(970, 650, 1005, 650, { color: 'violet', arrow: true, parent: rp });
            S.clipVec = ctx.matrix(1015, 638, 2, 16, { cell: 11, gap: 2, cmap: 'violet', values: function (r, c) { return 0.3 + 0.6 * Math.abs(Math.sin(r * 3 + c * 0.7)); }, parent: rp });
            ctx.text(1232, 650, '257 × 1280 → decoupled cross-attn', { size: 12, font: 'mono', color: 'violet', parent: rp });
            return ctx.reveal(rp, { from: 'right' }).then(function () { return ctx.pulse(S.clipVec, { color: 'violet', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: control signals + the Control node */
            S.ctrl = ctx.node({ x: 400, y: 470, w: 190, h: 52, title: 'Control', sub: 'refs · camera · keys', icon: 'eye', color: 'lime', titleSize: 15, subSize: 11 });
            S.lCtl = ctx.link(S.ctrl, { x: 748, y: 382 }, { color: 'lime', from: 'r', dash: '5 5', bend: { x: 705, y: 472 } });
            ctx.hotspot(S.ctrl, 'consistency', { hint: 'CONTROL ⤢' });
            var cg = ctx.group({ parent: wb });
            ctx.text(700, 712, 'CONTROL SIGNALS', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: cg });
            var chips = [['camera path · Plücker rays', 'cyan'], ['depth / pose / edges · VACE', 'teal'], ['identity refs · R2V', 'pink'],
              ['first + last frame · FLF2V', 'amber'], ['extend: last latents of shot 2', 'lime'], ['audio → lip / beat sync', 'orange']];
            S.ctlChips = chips.map(function (c, i) {
              var x = 700 + (i % 3) * 280, y = 748 + Math.floor(i / 3) * 40;
              return ctx.label(x, y, c[0], { color: c[1], size: 12, anchor: 'start', w: 262, parent: cg });
            });
            return Promise.all([
              ctx.reveal(S.ctrl, { from: 'up' }),
              ctx.reveal(S.lCtl, { from: 'draw', delay: 300 }),
              ctx.reveal(cg, { delay: 200 }),
              ctx.reveal(S.ctlChips, { from: 'up', delay: 500, stagger: 90 })
            ]).then(function () { return ctx.pulse(S.ctrl, { color: 'lime', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Decode & sound',
        beats: [
          {
            say: 'When denoising ends, the VAE decoder expands the clean latent back to pixels. It runs causally, chunk by chunk, caching features at chunk borders, so each latent frame becomes four pixel frames.',
            card: { tag: 'HOW IT WORKS', title: 'Decode one chunk at a time', body: 'Latent frame 0 becomes pixel frame 0; every later latent frame becomes 4 frames. Feature caches make it equal to decoding the whole clip.' },
            deep: '<p><b>Chunked causal decoding.</b> Latent frame 0 → pixel frame 0; each later latent frame → 4 frames. Every causal Conv3d (temporal kernel 3) keeps a <i>feature cache</i> of its last 2 input frames, so decoding one chunk at a time is exactly equivalent to decoding the whole clip.</p>' +
              '<p>The decoder loop is sequential in time (31 chunks) and independent across spatial tiles, which is why serving stacks can spread the tiles of one chunk over all 8 GPUs that just finished the DiT.</p>'
          },
          {
            say: 'One full resolution activation would take twenty one gigabytes, so chunking in time and tiling in space keep peak memory bounded, even for long clips.',
            card: { tag: 'NUMBERS', title: 'Why chunking is mandatory', stat: { v: '21.4 GB', l: 'for one bf16 activation at full resolution: 96 channels × 121 × 720 × 1280' }, more: '<p>Chunking shrinks the stage-0 tensor by 121/4 ≈ 30× to 0.71 GB, but the constant feature caches add a few GB more (about 2.6 GB on the encoder side). Spatial tiling with overlapped, linearly blended tiles handles 1080p and above. Both are covered in the VAE chamber.</p>' },
            deep: '<div class="eq">one full-res activation (Wan-VAE, 96 ch): 121 · 720 · 1280 · 96 · 2 B ≈ 21.4 GB</div>' +
              '<p>A residual block keeps several such tensors alive at once, so decoding a whole 720p clip in one pass would need far more than an 80 GB device. Hence chunking in time plus <b>spatial tiling</b> with overlapped, linearly blended tiles for 1080p and above.</p>'
          },
          {
            say: 'Frontier systems such as Veo three and Sora two also generate sound in the same pass. An audio latent stream is denoised jointly with the video.',
            card: { tag: 'STATE OF THE ART', title: 'Sound generated with the pixels', body: 'Veo 3 and Sora 2 output synchronized dialogue and effects. Open designs: Ovi and LTX-2 run two streams with cross-modal attention.' },
            deep: '<p><b>Joint audio-video generation.</b> Veo 3 (joint audio + video latent diffusion; architecture details unpublished) and Sora 2 output synchronized dialogue and effects. Open designs: <i>Ovi</i> (twin DiT backbones with bidirectional cross-modal attention) and <i>LTX-2</i> (asymmetric dual-stream).</p>' +
              '<p>Audio is its own latent sequence (a 1-D VAE over waveform or mel, tens of latent frames per second), decoded by a separate audio decoder.</p>'
          },
          {
            say: 'Cross attention between the two streams, on a shared clock, keeps the crash of the capsule aligned with the exact frame where it hits the ice.',
            card: { tag: 'HOW IT WORKS', title: 'A shared clock aligns sound', body: 'Temporal RoPE positions are scaled to seconds, so tokens at the same instant attend to each other. Impact at 2.1 s is frame 50.' },
            deep: '<ul><li>Sync comes from putting both streams on a <b>common clock</b>: temporal RoPE positions are scaled to seconds so a video token and an audio token at the same instant get matching phases, and the capsule impact at 2.1 s (frame 50) and its audio transient attend to each other strongly.</li>' +
              '<li>Alternative: post-hoc video-to-audio (MMAudio, HunyuanVideo-Foley) is cheaper, but it cannot let sound influence motion.</li>' +
              '<li>Cost: the audio stream adds only tens of tokens per second next to 111,600 video tokens, so the second stream is nearly free.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'chunked causal VAE decode · joint audio stream');
          ctx.focus([S.div, wb, S.dit, S.z0, S.z0L, S.lZ, S.vdec, S.lD, S.lF, S.film], 0.25);
          /* beat 1: latent frames -> pixel frames, chunk by chunk */
          var L = ctx.group({ parent: wb });
          ctx.text(70, 598, 'z₀: 31 latent frames', { size: 12, font: 'mono', color: 'dim', parent: L });
          S.lat = [];
          for (var k = 0; k < 31; k++) S.lat.push(ctx.rect(70 + k * 20.3, 612, 16, 30, { rx: 2, fill: ctx.alpha('lime', 0.25), stroke: 'lime', sw: 0.8, parent: L }));
          S.win = ctx.rect(66, 608, 24, 38, { rx: 4, stroke: 'amber', sw: 2, parent: L, glow: true });
          ctx.text(70, 668, '↓ causal decoder · feature cache (last 2 frames per conv)', { size: 12, font: 'mono', color: 'amber', parent: L });
          S.frm = [];
          for (var f = 0; f < 121; f++) S.frm.push(ctx.rect(70 + f * 5.2, 688, 4, 40, { rx: 0.5, fill: '#0b1a0a', parent: L }));
          S.fcount = ctx.text(70, 752, 'frames decoded: 0 / 121', { size: 13, font: 'mono', weight: 600, color: 'lime', parent: L });
          ctx.hud('decode 31 → 121 frames · audio in same pass');
          return Promise.all([
            ctx.reveal(L, {}),
            ctx.wait(500).then(function () {
              return ctx.tween(3200, function (t) {
                var kk = Math.min(30, Math.floor(t * 31));
                S.win.setAttribute('x', 66 + kk * 20.3);
                var nf = kk === 0 ? 1 : 1 + 4 * kk;
                if (t >= 1) nf = 121;
                for (var i = 0; i < 31; i++) S.lat[i].setAttribute('fill', i <= kk ? ctx.alpha('lime', 0.75) : ctx.alpha('lime', 0.25));
                for (var q = 0; q < 121; q++) S.frm[q].setAttribute('fill', q < nf ? ctx.cmap('lime', 0.35 + 0.5 * Math.abs(Math.sin(q * 0.21))) : '#0b1a0a');
                S.fcount.textContent = 'frames decoded: ' + nf + ' / 121';
              }, 'linear');
            }).then(function () {
              return Promise.all([ctx.packet(S.lD, { color: 'lime', dur: 500 }), ctx.packet(S.lF, { color: 'lime', dur: 700 })]);
            })
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the memory argument */
            var m = ctx.group({ parent: wb });
            S.memG = m;
            ctx.text(70, 784, 'one full-res activation · whole clip', { size: 12, font: 'mono', color: 'text', parent: m });
            var b1 = ctx.rect(400, 774, 330, 20, { rx: 3, fill: ctx.alpha('red', 0.4), stroke: 'red', sw: 1, parent: m });
            ctx.text(740, 784, '21.4 GB', { size: 12, font: 'mono', weight: 600, color: 'red', parent: m });
            ctx.text(70, 810, 'the same tensor for one 4-frame chunk', { size: 12, font: 'mono', color: 'text', parent: m });
            var b2 = ctx.rect(400, 800, Math.max(4, 330 * 0.71 / 21.4), 20, { rx: 3, fill: ctx.alpha('lime', 0.4), stroke: 'lime', sw: 1, parent: m });
            ctx.text(400 + Math.max(4, 330 * 0.71 / 21.4) + 10, 810, '0.71 GB', { size: 12, font: 'mono', weight: 600, color: 'lime', parent: m });
            ctx.text(70, 838, '+ spatial tiles with overlap blending for 1080p and up', { size: 12, font: 'mono', color: 'dim', parent: m });
            var w1 = parseFloat(b1.getAttribute('width')), w2 = parseFloat(b2.getAttribute('width'));
            b1.setAttribute('width', 0); b2.setAttribute('width', 0);
            return Promise.all([
              ctx.reveal(m, { delay: 100 }),
              ctx.animate(b1, { width: [0, w1] }, 800, 'out', 300),
              ctx.animate(b2, { width: [0, w2] }, 800, 'out', 700)
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the audio latent stream appears */
            S.aud = cube(ctx, { cx: 1100, cy: 472, w: 40, h: 30, d: 12, color: 'orange' });
            S.adec = ctx.node({ x: 1272, y: 472, w: 170, h: 46, title: 'Audio Decoder', sub: 'latent → waveform', icon: 'wave', color: 'orange', titleSize: 14, subSize: 11 });
            var wd = '', rw = ctx.rng(4);
            for (var q = 0; q <= 60; q++) { var env = q > 26 && q < 34 ? 1 : 0.3; wd += (q ? 'L' : 'M') + (1390 + q * 2.6).toFixed(1) + ',' + (472 + (rw() * 2 - 1) * 16 * env).toFixed(1); }
            S.wave = ctx.path(wd, { stroke: 'orange', sw: 1.3 });
            S.audL = ctx.text(1100, 506, 'audio latent', { size: 11, font: 'mono', color: 'orange', anchor: 'middle' });
            S.lA = ctx.link({ x: 995, y: 372 }, S.aud, { color: 'orange', to: 'l' });
            S.lA2 = ctx.link(S.aud, S.adec, { color: 'orange', from: 'r', to: 'l' });
            /* right panel skeleton: two token streams */
            var Rg = ctx.group({ parent: wb });
            S.Rg = Rg;
            var x0 = 820, x1 = 1520;
            ctx.text(x0, 598, 'JOINT AUDIO-VIDEO DENOISING · Veo 3 · Sora 2 · Ovi · LTX-2', { size: 12, font: 'mono', color: 'dim', parent: Rg });
            ctx.rect(x0, 616, x1 - x0, 26, { rx: 5, fill: ctx.alpha('lime', 0.18), stroke: 'lime', sw: 1.2, parent: Rg });
            ctx.text(x0 + 10, 629, 'video tokens · 111,600', { size: 12, font: 'mono', color: 'lime', parent: Rg });
            ctx.rect(x0, 700, x1 - x0, 26, { rx: 5, fill: ctx.alpha('orange', 0.18), stroke: 'orange', sw: 1.2, parent: Rg });
            ctx.text(x0 + 10, 713, 'audio tokens · tens per second', { size: 12, font: 'mono', color: 'orange', parent: Rg });
            return Promise.all([
              ctx.reveal([S.aud, S.audL, S.adec, S.wave], { from: 'right', stagger: 150 }),
              ctx.reveal([S.lA, S.lA2], { from: 'draw', delay: 300, stagger: 150 }),
              ctx.reveal(Rg, { delay: 300 })
            ]).then(function () {
              return Promise.all([ctx.packet(S.lA, { color: 'orange', dur: 600, label: 'audio z' }), ctx.pulse(S.aud, { color: 'orange', dur: 700 })]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: cross-attention on a shared clock */
            var Rg = S.Rg, x0 = 820, x1 = 1520;
            var cg = ctx.group({ parent: Rg });
            S.xl = [];
            for (var c = 0; c < 9; c++) {
              var xx = x0 + 250 + c * 50;
              S.xl.push(ctx.line(xx, 644, xx, 698, { color: ctx.alpha('amber', 0.6), sw: 1.2, dash: '3 4', parent: cg }));
            }
            ctx.text(x0 + 10, 671, 'bidirectional cross-attn', { size: 11, font: 'mono', color: 'amber', parent: cg });
            var d2 = '', rw2 = ctx.rng(12);
            var tImp = x0 + (x1 - x0) * 2.1 / 5;
            for (var p = 0; p <= 175; p++) {
              var xp = x0 + p * 4;
              var e = Math.abs(xp - tImp) < 30 ? 1 - Math.abs(xp - tImp) / 40 : 0.18;
              d2 += (p ? 'L' : 'M') + xp.toFixed(1) + ',' + (784 + (rw2() * 2 - 1) * 26 * e).toFixed(1);
            }
            ctx.path(d2, { stroke: 'orange', sw: 1.2, parent: cg });
            ctx.line(tImp, 610, tImp, 816, { color: 'white', sw: 1.2, dash: '2 4', parent: cg });
            ctx.label(tImp, 836, 'capsule impact · 2.1 s · frame 50', { color: 'white', size: 11, parent: cg });
            ctx.text(x1, 836, 'shared temporal RoPE (seconds)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: cg });
            S.xflow = ctx.loop(function (t) { S.xl.forEach(function (l, i) { l.setAttribute('stroke-dashoffset', (-t * 20 * (i % 2 ? 1 : -1)).toFixed(1)); }); });
            return ctx.reveal(cg, { delay: 100 }).then(function () {
              return Promise.all([ctx.packet(S.lF, { color: 'lime', dur: 600 }), ctx.packet(S.lA2, { color: 'orange', dur: 600 })]);
            }).then(function () { return ctx.pulse(S.adec, { color: 'orange', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 9 */
      {
        title: 'The landscape',
        beats: [
          {
            say: 'Here is the landscape across twenty twenty five and twenty six. Closed frontier models, Veo, Sora, Kling and Seedance, lead on quality, duration and native audio.',
            card: { tag: 'STATE OF THE ART', title: 'Closed models lead on duration and audio', body: 'Veo 3.1, Sora 2, Kling 2.x and Seedance 1.x ship as APIs. Native synchronized audio arrived across them during 2025.' },
            deep: '<table><tr><th>Model</th><th>Org</th><th>Notes</th></tr>' +
              '<tr><td>Veo 3 / 3.1</td><td>Google DeepMind</td><td>native joint audio, 8 s clips, up to 1080p</td></tr>' +
              '<tr><td>Sora 2</td><td>OpenAI</td><td>synchronized dialogue + SFX, stronger physics</td></tr>' +
              '<tr><td>Kling 2.x</td><td>Kuaishou</td><td>high motion quality, 1080p; native audio from 2.6</td></tr>' +
              '<tr><td>Seedance 1.x</td><td>ByteDance</td><td>1.0: native multi-shot, RLHF, distilled fast inference; 1.5 pro: joint audio-video</td></tr></table>' +
              '<p>Their architectures are mostly unpublished. What is public (system cards, API limits, occasional papers) matches the open recipe: latent diffusion transformers trained on very large curated video corpora.</p>'
          },
          {
            say: 'Open weight families, Wan, HunyuanVideo and LTX, publish their weights, so teams can fine tune, distill and self host them.',
            card: { tag: 'NUMBERS', title: 'Open weights at scale', stat: { v: '1.3 – 14 B', l: 'Wan 2.1 DiT sizes, Apache-2.0; HunyuanVideo is 13 B; Wan 2.2 adds a two-expert MoE' } },
            deep: '<table><tr><th>Model (org)</th><th>Weights</th><th>Notes</th></tr>' +
              '<tr><td>Wan 2.1 / 2.2 (Alibaba)</td><td>Apache-2.0</td><td>1.3 B / 14 B; 2.2: two-expert MoE (A14B, high/low-noise experts), TI2V-5B</td></tr>' +
              '<tr><td>HunyuanVideo (Tencent)</td><td>open</td><td>13 B, MLLM text encoder, dual→single-stream DiT; v1.5 ≈ 8.3 B</td></tr>' +
              '<tr><td>LTX-Video / LTX-2 (Lightricks)</td><td>open</td><td>~1:192 VAE, faster than real time at low res; LTX-2 adds audio</td></tr></table>' +
              '<p>Open weights matter for the atlas’s running example: they can be quantised, distilled and pinned to a cluster, which a closed API never allows.</p>'
          },
          {
            say: 'Look closely and the recipe has converged: a causal video VAE, a flow matching diffusion transformer, a large text encoder, guidance, post training on human preference, and step distillation. The differences are data, scale and post training.',
            card: { tag: 'KEY IDEA', title: 'The recipe has converged', body: 'Causal 3D VAE, flow-matching DiT with 3D RoPE, big text encoder, CFG, RLHF or DPO, then step distillation for serving.' },
            deep: '<div class="note">Converged recipe: causal 3D VAE → flow-matching DiT with 3D RoPE → big text encoder → CFG → post-training (SFT on curated clips, RLHF/DPO on human preference) → step distillation for serving.</div>' +
              '<p>Where models still differ: data curation and captioning (the largest lever), how much of the model is spent on motion versus appearance, the text encoder (T5 versus an MLLM), joint audio, and how aggressively the VAE compresses. Each of those is a chamber below this one.</p>' +
              '<p><b>For our trailer</b> the crew would pick an open-weight backbone on its own GPU pool: pinned kernels and fixed seeds make <code>render_shot</code> cacheable (step 1), LoRAs and reference latents carry the fox’s identity across the six shots, and the per-shot cost is known in GPU-seconds, which is what the scheduler and the quota system need. A closed API is the fallback for hero shots or native audio.</p>'
          },
          {
            say: 'Every glowing part is a chamber. Zoom into diffusion, the VAE, the transformer, or control to see each piece up close.',
            card: { tag: 'TRY IT', title: 'Zoom into any glowing part', body: 'The diffusion loop, the VAE encoder and decoder, the DiT and the control node each open their own chamber.' },
            deep: '<p>The four children of this chamber: <b>diffusion &amp; flow matching</b> (the loop and its objective), <b>spatiotemporal VAE</b> (the codec that fixes the token budget), <b>DiT</b> (the transformer and its 3D attention) and <b>control &amp; consistency</b> (how the fox stays the same fox across six shots).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.xflow) { S.xflow.stop(); S.xflow = null; }
          var wb = newBench(ctx, S, '2025–26 landscape · closed frontier vs open weights');
          ctx.focus(null);
          var cards = [
            ['Veo 3 / 3.1', 'Google DeepMind', 0, 'native joint audio', '8 s · up to 1080p'],
            ['Sora 2', 'OpenAI', 0, 'synced dialogue + SFX', 'physics, cameos'],
            ['Kling 2.x', 'Kuaishou', 0, 'strong motion · 1080p', '2.6+: native audio'],
            ['Seedance 1.x', 'ByteDance', 0, 'multi-shot · RLHF', '1.5 pro: joint audio'],
            ['Wan 2.1 / 2.2', 'Alibaba', 1, '1.3B/14B · Apache-2.0', '2.2: MoE A14B, TI2V-5B'],
            ['HunyuanVideo', 'Tencent', 1, '13B · MLLM text enc.', 'v1.5 ≈ 8.3B'],
            ['LTX-Video / 2', 'Lightricks', 1, '1:192 VAE · fast', 'LTX-2: joint audio']
          ];
          S.cards = cards.map(function (c, i) {
            var g = ctx.group({ parent: wb });
            var x = 60 + i * 212, y = 592;
            var col = c[2] ? 'lime' : 'blue';
            ctx.rect(x, y, 200, 150, { rx: 10, fill: 'rgba(8,16,30,0.9)', stroke: ctx.alpha(col, 0.8), sw: 1.3, parent: g });
            ctx.text(x + 14, y + 26, c[0], { size: 15, font: 'display', weight: 700, color: 'white', parent: g });
            ctx.text(x + 14, y + 50, c[1], { size: 11, font: 'mono', color: 'dim', parent: g });
            ctx.label(x + 14, y + 78, c[2] ? 'OPEN WEIGHTS' : 'CLOSED API', { color: col, size: 11, anchor: 'start', parent: g });
            ctx.text(x + 14, y + 108, c[3], { size: 11, font: 'mono', color: 'text', parent: g });
            ctx.text(x + 14, y + 130, c[4], { size: 11, font: 'mono', color: 'text', parent: g });
            return g;
          });
          /* the three open-weight cards belong to beat 2: keep them hidden until then */
          S.cards.slice(4).forEach(function (g) { g.setAttribute('opacity', 0); });
          /* beat 1: the four closed frontier models */
          ctx.hud('open: Wan · Hunyuan · LTX  vs  closed APIs');
          return ctx.reveal(S.cards.slice(0, 4), { from: 'up', stagger: 140 }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the three open-weight families */
            return ctx.reveal(S.cards.slice(4), { from: 'up', stagger: 140 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the converged recipe */
            var rec = ctx.group({ parent: wb });
            ctx.text(60, 778, 'CONVERGED RECIPE', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: rec });
            var steps = [['causal 3D VAE', 'lime'], ['flow-matching DiT + 3D RoPE', 'lime'], ['big text encoder', 'cyan'], ['CFG', 'amber'], ['RLHF / DPO post-training', 'magenta'], ['step distillation', 'red']];
            var x = 240;
            steps.forEach(function (s, i) {
              var ch = ctx.label(x, 778, s[0], { color: s[1], size: 12, anchor: 'start', parent: rec });
              x += ch.w + (i < steps.length - 1 ? 30 : 0);
              if (i < steps.length - 1) ctx.text(x - 15, 778, '→', { size: 14, color: 'dim', anchor: 'middle', parent: rec });
            });
            return ctx.reveal(rec, { from: 'left' });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: point at the zoom targets */
            var zt = ctx.text(60, 830, 'zoom in:  diffusion & flow matching · spatiotemporal VAE · DiT · control & consistency  (glowing parts above)', { size: 13, font: 'mono', color: 'lime', parent: wb });
            return ctx.reveal(zt, { from: 'up' }).then(function () {
              return [S.loopG, S.venc, S.dit, S.vdec, S.ctrl].reduce(function (p, n) {
                return p.then(function () { return ctx.pulse(n, { color: 'lime', dur: 550 }); });
              }, Promise.resolve());
            });
          });
        }
      }
    ]
  });
})();
