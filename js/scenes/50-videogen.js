/* L1 — Video Generation Models. Anatomy of a latent flow-matching text/image-to-video model, with worked numbers. */
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

  Atlas.register({
    id: 'videogen',
    refs: [
      'Rombach et al., <i>High-Resolution Image Synthesis with Latent Diffusion Models</i>, CVPR 2022',
      'Peebles &amp; Xie, <i>Scalable Diffusion Models with Transformers (DiT)</i>, ICCV 2023',
      'Esser et al., <i>Scaling Rectified Flow Transformers for High-Resolution Image Synthesis (SD3)</i>, ICML 2024',
      'Polyak et al., <i>Movie Gen: A Cast of Media Foundation Models</i>, Meta, 2024',
      'Kong et al., <i>HunyuanVideo: A Systematic Framework for Large Video Generative Models</i>, 2024',
      'Wan Team (Alibaba), <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, 2025 (Wan 2.1 / 2.2)',
      'HaCohen et al., <i>LTX-Video: Realtime Video Latent Diffusion</i>, 2025; Gao et al., <i>Seedance 1.0</i>, ByteDance, 2025',
      'Google DeepMind, <i>Veo 3</i> model card / tech report, 2025; OpenAI, <i>Sora 2</i> system card, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'The shot request',
        say: 'Inside the agent crew, the cinematographer has just written shot three: the fox astronaut stumbling out of a smoking capsule onto a glowing ice moon. It calls a single tool, render shot, with a prompt, a reference sketch and a spec: five seconds, twenty four frames per second, seven twenty p. To the agent, the video model is a black box that turns this request into one hundred and twenty one frames. Let us open the box.',
        deep: '<p>To the orchestration plane the video model is a <b>pure, expensive function</b>:</p>' +
          '<div class="eq">clip = render_shot(prompt, refs, spec, seed)</div>' +
          '<p>Given the seed and sampler it is (nearly) deterministic, it costs GPU-minutes, and it has no side effects — so the durable workflow can retry it idempotently and cache it by a hash of its arguments.</p>' +
          '<table><tr><th>Spec</th><th>Value</th></tr>' +
          '<tr><td>duration × fps</td><td>5 s × 24 fps</td></tr>' +
          '<tr><td>frames</td><td>121 = 4·30 + 1</td></tr>' +
          '<tr><td>resolution</td><td>1280 × 720</td></tr>' +
          '<tr><td>sampler</td><td>flow-matching Euler, 50 steps, CFG w = 5</td></tr>' +
          '<tr><td>conditioning</td><td>text + first-frame/reference image</td></tr></table>' +
          '<div class="note">Why 4k+1 frames? The causal video VAE encodes the first frame alone and every following group of 4 frames into one latent frame: T<sub>lat</sub> = 1 + (F − 1)/4 = 31. Wan uses 81 frames at 16 fps, HunyuanVideo 129 at 24 fps — same rule.</div>',
        run: function (ctx) {
          var S = ctx.state;
          /* prompt card (top-left of the diagram band) */
          S.promptCard = ctx.group();
          ctx.rect(50, 188, 205, 54, { rx: 8, fill: '#061520', stroke: 'cyan', sw: 1.2, parent: S.promptCard });
          ctx.text(62, 204, 'prompt · from Camera agent', { size: 11, font: 'mono', color: 'dim', parent: S.promptCard });
          ctx.text(62, 226, '"fox astronaut stumbles…"', { size: 12, font: 'mono', color: 'cyan', parent: S.promptCard });
          S.promptCard.box = box(50, 188, 205, 54);
          S.ref = ctx.group();
          foxSketch(ctx, S.ref, 70, 306, 96);
          ctx.text(118, 394, 'ref sketch #2', { size: 11, font: 'mono', color: 'violet', anchor: 'middle', parent: S.ref });
          S.ref.box = box(70, 306, 96, 72);
          ctx.reveal([S.promptCard, S.ref], { from: 'left', stagger: 200 });

          /* the black box */
          S.black = ctx.group();
          ctx.rect(560, 262, 660, 170, { rx: 16, fill: 'rgba(8,20,10,0.6)', stroke: ctx.alpha('lime', 0.7), sw: 1.6, dash: '8 6', parent: S.black, glow: true });
          ctx.text(890, 326, 'VIDEO GENERATION MODEL', { size: 24, font: 'display', weight: 700, color: 'lime', anchor: 'middle', parent: S.black });
          ctx.text(890, 362, 'text + image  →  121 frames of 1280 × 720', { size: 14, font: 'mono', color: 'dim', anchor: 'middle', parent: S.black });
          ctx.text(890, 392, '? ? ?', { size: 16, font: 'mono', color: ctx.alpha('lime', 0.6), anchor: 'middle', parent: S.black });
          S.black.box = box(560, 262, 660, 170);
          ctx.reveal(S.black, { from: 'scale', s0: 0.85, delay: 300 });

          /* output film strip */
          S.film = ctx.group();
          ctx.rect(1385, 305, 170, 66, { rx: 4, fill: '#050a05', stroke: ctx.alpha('lime', 0.6), sw: 1.2, parent: S.film });
          for (var i = 0; i < 8; i++) {
            ctx.rect(1392 + i * 20, 309, 9, 4, { rx: 1, fill: ctx.alpha('lime', 0.4), parent: S.film });
            ctx.rect(1392 + i * 20, 363, 9, 4, { rx: 1, fill: ctx.alpha('lime', 0.4), parent: S.film });
          }
          S.filmFrames = ctx.group({ parent: S.film });
          ctx.text(1470, 392, 'clip.mp4 · 121 frames', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: S.film });
          S.film.box = box(1385, 305, 170, 66);
          ctx.reveal(S.film, { from: 'right', delay: 500 });

          S.l0a = ctx.link(S.promptCard, S.black, { color: 'cyan', from: 'r', to: 'l' });
          S.l0b = ctx.link(S.ref, S.black, { color: 'violet', from: 'r', to: 'l' });
          S.l0c = ctx.link(S.black, S.film, { color: 'lime', from: 'r', to: 'l' });
          ctx.reveal([S.l0a, S.l0b, S.l0c], { from: 'draw', delay: 600, stagger: 150 });

          /* workbench divider */
          S.div = ctx.group();
          ctx.line(40, 548, 1560, 548, { color: 'line', sw: 1, parent: S.div });
          ctx.text(60, 568, 'CLOSE-UP ▸', { size: 12, font: 'mono', weight: 600, color: 'lime', spacing: 2, parent: S.div });
          S.wbTitle = ctx.text(170, 568, '', { size: 12, font: 'mono', color: 'dim', parent: S.div });
          ctx.reveal(S.div, { delay: 400 });

          var wb = newBench(ctx, S, 'the tool call the agent actually emits');
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
          ctx.reveal(S.call, { from: 'up' });
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
          ctx.reveal(S.tl, { delay: 300 });
          ctx.hud('1 shot = 5 s · 24 fps · 720p = 121 frames');
          return S.call.typeAll().then(function () {
            return ctx.packet(S.l0a, { color: 'cyan', dur: 700, label: 'prompt' });
          }).then(function () {
            return ctx.packet(S.l0c, { color: 'lime', dur: 700 });
          }).then(function () {
            for (var i = 0; i < 3; i++) miniFrame(ctx, S.filmFrames, 1392 + i * 54, 319, 50, 38, i / 2);
            ctx.reveal(S.filmFrames, {});
            return Promise.all(S.tlFrames.map(function (fr, i) { return ctx.fade(fr, 1, 250 + i * 60); }));
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Five components',
        say: 'Every modern video generator has the same five parts. A text encoder turns the prompt into conditioning vectors. A variational autoencoder maps pixels into a compact latent space and back. Generation starts from pure Gaussian noise in that latent space, and a diffusion transformer removes the noise over many small steps, steered by the text. Finally the VAE decoder turns the clean latent into frames. Every glowing part is a chamber you can zoom into.',
        deep: '<p>This is <b>latent diffusion</b> (Rombach et al.) extended to spacetime, with a transformer denoiser (DiT) trained by flow matching:</p>' +
          '<div class="eq">c = E<sub>text</sub>(prompt),  z<sub>1</sub> ~ N(0, I)<br>z<sub>0</sub> = ODESolve( dz/dt = v<sub>θ</sub>(z, t, c),  t: 1 → 0 )<br>video = D<sub>VAE</sub>(z<sub>0</sub>)</div>' +
          '<ul><li><b>Text encoder</b> — frozen (umT5-XXL in Wan, an MLLM + CLIP in HunyuanVideo).</li>' +
          '<li><b>VAE</b> — ~10<sup>8</sup> params (Wan-VAE ≈ 127 M), trained first, then frozen; it fixes the token budget of everything downstream.</li>' +
          '<li><b>DiT</b> — the only part trained in the main stage: 1.3 B–14 B (Wan 2.1), 13 B (HunyuanVideo), 30 B (Movie Gen).</li></ul>' +
          '<p>FLOPs per clip, log scale: text encoder ~10<sup>13</sup> (2 · ~4.6 B non-embedding encoder params · 512 tokens ≈ 5×10<sup>12</sup>), VAE encode + decode ~10<sup>15</sup> (dozens of 3×3×3 convs at up to 96 ch × 111 M voxels), DiT ≈ 1.3×10<sup>18</sup>. The denoiser is ≈ 99.9% of compute — though the VAE decoder is often the <i>memory</i> peak.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove([S.black, S.l0a, S.l0b, S.l0c], 400);
          S.tenc = ctx.node({ x: 400, y: 215, w: 190, h: 52, title: 'Text Encoder', sub: 'umT5-XXL · 512 tok', icon: 'doc', color: 'cyan', titleSize: 15, subSize: 11 });
          S.tok = ctx.matrix(520, 201, 3, 10, { cell: 8, gap: 2, cmap: 'cyan', values: function (r, c) { return 0.3 + 0.6 * Math.abs(Math.sin(r * 2.1 + c * 1.3)); } });
          S.tokL = ctx.text(569, 243, 'c: 512 × 4096', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle' });
          S.venc = ctx.node({ x: 400, y: 340, w: 190, h: 52, title: 'VAE Encoder', sub: 'causal 3D conv', icon: 'layers', color: 'lime', titleSize: 15, subSize: 11 });
          var rN = ctx.rng(5);
          S.noise = cube(ctx, { cx: 632, cy: 340, w: 60, h: 60, d: 20, color: 'lime', n: 6, mosaic: function () { var k = 60 + 150 * rN(); return 'rgb(' + Math.round(k * 0.8) + ',' + Math.round(k) + ',' + Math.round(k * 0.85) + ')'; } });
          S.noiseL = ctx.para(632, 395, ['z₁ ~ N(0, I)', '16×31×90×160'], { size: 11, font: 'mono', color: 'lime', anchor: 'middle', lh: 15 });
          S.dit = ctx.node({ x: 870, y: 340, w: 250, h: 110, title: 'Diffusion Transformer', sub: 'v_θ(z_t, t, c) · 14 B', color: 'lime', titleSize: 17, subSize: 12, glow: 'strong' });
          S.z0 = cube(ctx, { cx: 1100, cy: 340, w: 60, h: 60, d: 20, color: 'lime', n: 6, mosaic: function (i, j, n) { return rgbStr(fieldRGB((j + 0.5) / n, (i + 0.5) / n)); } });
          S.z0L = ctx.text(1100, 395, 'z₀ (clean)', { size: 11, font: 'mono', color: 'lime', anchor: 'middle' });
          S.vdec = ctx.node({ x: 1272, y: 340, w: 170, h: 52, title: 'VAE Decoder', sub: 'latent → pixels', icon: 'film', color: 'lime', titleSize: 15, subSize: 11 });
          /* sampler loop under the DiT */
          S.loopG = ctx.group();
          S.loopP = ctx.path('M945,395 C955,470 785,470 795,395', { stroke: 'lime', sw: 2, arrow: true, parent: S.loopG });
          ctx.label(870, 478, '× 50 steps · ODE sampler', { color: 'lime', size: 11, parent: S.loopG });
          S.loopG.box = box(760, 412, 220, 82);
          var parts = [S.tenc, S.tok, S.tokL, S.venc, S.noise, S.noiseL, S.dit, S.z0, S.z0L, S.vdec, S.loopG];
          ctx.reveal(parts, { from: 'up', stagger: 110, delay: 300 });
          /* links */
          S.lP = ctx.link(S.promptCard, S.tenc, { color: 'cyan', from: 'r', to: 'l' });
          S.lTok = ctx.link({ x: 620, y: 215 }, { x: 830, y: 285 }, { color: 'cyan', label: 'cross-attn', labelDx: 26, labelDy: -12 });
          S.lR = ctx.link(S.ref, S.venc, { color: 'violet', from: 'r', to: 'l' });
          S.lV = ctx.link(S.venc, S.noise, { color: 'lime', from: 'r', to: 'l', label: '⊕ z_ref', labelDy: -16 });
          S.lN = ctx.link(S.noise, S.dit, { color: 'lime', from: 'r', to: 'l' });
          S.lZ = ctx.link(S.dit, S.z0, { color: 'lime', from: 'r', to: 'l' });
          S.lD = ctx.link(S.z0, S.vdec, { color: 'lime', from: 'r', to: 'l' });
          S.lF = ctx.link(S.vdec, S.film, { color: 'lime', from: 'r', to: 'l' });
          var links = [S.lP, S.lR, S.lV, S.lN, S.lTok, S.lZ, S.lD, S.lF];
          ctx.reveal(links, { from: 'draw', delay: 900, stagger: 100 });
          ctx.reveal([S.lTok.labelEl, S.lV.labelEl], { delay: 1500 });
          ctx.hotspot(S.dit, 'dit');
          ctx.hotspot(S.venc, 'video-vae', { hint: 'VAE ⤢' });
          ctx.hotspot(S.vdec, 'video-vae', { hint: 'VAE ⤢' });
          ctx.hotspot(S.loopG, 'diffusion', { hint: 'DIFFUSION ⤢' });

          var wb = newBench(ctx, S, 'the whole model in eight lines');
          S.pseudo = ctx.code({ x: 60, y: 590, w: 690, title: 'generate.py (Wan / HunyuanVideo-style, simplified)', lang: 'py', typing: true, size: 13, maxLines: 7, color: 'lime', parent: wb, lines: [
            'c   = text_encoder(prompt)             # [512, 4096]',
            'zr  = vae.encode(ref_frame)            # [16, 1, 90, 160]',
            'z   = randn(16, 31, 90, 160, seed=1234) # pure noise, t = 1',
            'for t, t_next in schedule(50, shift=5.0):',
            '    v = dit(z, t, c, zr)               # velocity field',
            '    z = z + (t_next - t) * v           # Euler step',
            'frames = vae.decode(z)                 # [121, 720, 1280, 3]'
          ] });
          ctx.reveal(S.pseudo, { from: 'up' });
          /* log-scale FLOPs bars */
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
            ctx.text(x, 800, sup[e],{ size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.fl });
          });
          ctx.text(820, 838, 'the denoiser is ≈ 99.9% of compute — optimise there first', { size: 13, font: 'mono', color: 'lime', parent: S.fl });
          ctx.reveal(S.fl, { delay: 200 });
          S.flBars.forEach(function (b, i) {
            var w = parseFloat(b.getAttribute('width'));
            b.setAttribute('width', 0);
            ctx.animate(b, { width: [0, w] }, 800, 'out', 500 + i * 250);
          });
          ctx.hud('');
          return S.pseudo.typeAll().then(function () {
            return Promise.all([ctx.packet(S.lN, { color: 'lime', dur: 600 }), ctx.packet(S.lTok, { color: 'cyan', dur: 700 })]);
          }).then(function () { return ctx.pulse(S.dit, { color: 'lime', dur: 700 }); });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Text conditioning',
        say: 'Conditioning starts with language. The prompt, usually expanded by an LLM into a dense paragraph that resembles the training captions, is tokenized and run through a large frozen text encoder such as umT5 XXL, giving one four thousand dimensional vector per token. Inside every transformer block, video tokens issue queries that attend to these text vectors through cross attention. So the patch that will become the fox helmet can look up the words fox and astronaut.',
        deep: '<p><b>Encoder.</b> Wan uses umT5-XXL (multilingual T5; 24 bidirectional encoder layers, d = 4096), max 512 tokens, padded; a 2-layer MLP projects 4096 → d<sub>model</sub> = 5120. HunyuanVideo instead uses a decoder-only MLLM with a bidirectional <i>token refiner</i>, plus a pooled CLIP vector fed into the timestep modulation.</p>' +
          '<div class="eq">CrossAttn(X, C) = softmax( (XW<sub>Q</sub>)(CW<sub>K</sub>)ᵀ / √d<sub>h</sub> ) CW<sub>V</sub></div>' +
          '<p>X ∈ ℝ<sup>N×d</sup> are the N ≈ 111.6 k video tokens, C ∈ ℝ<sup>512×d</sup> the text. Cost 4·N·L·d per layer — tiny next to self-attention because L = 512 ≪ N.</p>' +
          '<ul><li><b>MM-DiT alternative</b> (SD3, HunyuanVideo dual→single stream): concatenate text and video tokens into one joint self-attention with modality-specific weights.</li>' +
          '<li><b>Prompt extension</b>: an LLM rewrites a 20-word prompt into ~100 words in the dense-caption style the model was trained on (Wan ships a Qwen-based extender). Big quality lever, zero GPU cost on the DiT.</li>' +
          '<li><b>Condition dropout</b> (~10% empty prompts during training) teaches the same network the unconditional field needed for classifier-free guidance.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'text conditioning · umT5-XXL → cross-attention');
          ctx.focus([S.div, wb, S.promptCard, S.tenc, S.tok, S.tokL, S.lP, S.lTok, S.lTok.labelEl, S.dit], 0.25);
          var toks = ['▁A', '▁fox', '▁astro', 'naut', '▁stumbles', '▁out', '▁of', '▁a', '▁smoking', '▁capsule'];
          var x = 60;
          S.chips = toks.map(function (t) {
            var ch = ctx.label(x, 606, t, { color: 'cyan', size: 12, anchor: 'start', parent: wb });
            x += ch.w + 6;
            return ch;
          });
          ctx.reveal(S.chips, { from: 'up', stagger: 60 });
          S.encBar = ctx.group({ parent: wb });
          ctx.rect(60, 636, 580, 40, { rx: 8, fill: ctx.alpha('cyan', 0.1), stroke: 'cyan', sw: 1.4, parent: S.encBar, glow: true });
          ctx.text(350, 656, 'umT5-XXL encoder · 24 bidirectional layers · d = 4096', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.encBar });
          ctx.reveal(S.encBar, { delay: 600 });
          /* embedding matrix: 8 visible dims x (10 tokens + padding) */
          var r = ctx.rng(31);
          var vals = [];
          for (var i = 0; i < 8; i++) { vals.push([]); for (var j = 0; j < 18; j++) vals[i].push(j < 10 ? 0.15 + 0.8 * r() : 0.05); }
          S.emb = ctx.matrix(90, 700, 8, 18, { cell: 16, gap: 3, cmap: 'cyan', values: function () { return 0.02; }, parent: wb });
          ctx.text(78, 776, 'C', { size: 16, font: 'mono', weight: 700, color: 'cyan', anchor: 'end', parent: wb });
          ctx.para(450, 716, ['10 real tokens', '+ 502 pad (masked)', '= [512 × 4096]', '→ MLP → d 5120'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: wb });
          ctx.reveal(S.emb, { delay: 800 });
          S.embFill = ctx.tween(1200, function (t) {
            var k = t * 18;
            S.emb.set(function (a, b) { return b < k ? vals[a][b] : 0.02; });
          }, 'linear', 900);

          /* right: cross-attention of one query patch */
          var ca = ctx.group({ parent: wb });
          ctx.text(720, 600, 'one video token queries the text (1 of 40 blocks, 1 head)', { size: 12, font: 'mono', color: 'dim', parent: ca });
          miniFrame(ctx, ca, 720, 626, 160, 100, 0.25);
          S.qPatch = ctx.rect(744, 676, 26, 26, { rx: 2, stroke: 'amber', sw: 2, parent: ca, glow: true });
          ctx.text(800, 744, 'query patch q', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: ca });
          ctx.line(884, 680, 930, 680, { color: 'amber', sw: 1.4, arrow: true, parent: ca });
          var att = [0.04, 0.29, 0.21, 0.17, 0.03, 0.01, 0.01, 0.01, 0.05, 0.10];
          var labs = ['A', 'fox', 'astro', 'naut', 'stumbles', 'out', 'of', 'a', 'smoking', 'capsule'];
          S.attBars = ctx.bars(945, 620, 590, 120, att.map(function () { return 0.001; }), { color: 'amber', labels: labs, gap: 8, parent: ca });
          ctx.text(1240, 776, 'attention weights over text tokens', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: ca });
          ctx.text(720, 812, 'o = softmax(q Kᵀ / √d_h) V      K, V ← text C      q ← video tokens X', { size: 13, font: 'mono', color: 'text', parent: ca });
          ctx.text(720, 846, 'MM-DiT variant (SD3, HunyuanVideo): text + video tokens share one joint self-attention', { size: 12, font: 'mono', color: 'dim', parent: ca });
          ctx.reveal(ca, { delay: 400 });
          return ctx.wait(700).then(function () {
            return ctx.packet(S.lP, { color: 'cyan', dur: 600, label: 'tokens' });
          }).then(function () { return S.embFill; }).then(function () {
            return S.attBars.update(att.map(function (a) { return a / 0.29; }), 900);
          }).then(function () { return ctx.packet(S.lTok, { color: 'cyan', dur: 800, label: 'K,V' }); });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Latent arithmetic',
        say: 'Now the numbers that shape everything. Five seconds at twenty four frames per second is one hundred and twenty one frames, about three hundred thirty four million pixel values. The VAE compresses time by four and space by eight in each direction, keeping sixteen channels, which leaves a latent of thirty one by ninety by one hundred sixty. Patchifying two by two in space yields about one hundred and eleven thousand tokens, and full self attention compares every pair of them, in every layer.',
        deep: '<table><tr><th>Stage</th><th>Shape</th><th>Values</th></tr>' +
          '<tr><td>pixels</td><td>121 × 720 × 1280 × 3</td><td>334.5 M</td></tr>' +
          '<tr><td>VAE latent</td><td>16 × 31 × 90 × 160</td><td>7.14 M (÷46.8)</td></tr>' +
          '<tr><td>patchify 1×2×2</td><td>31 × 45 × 80 tokens, 64-d each</td><td>N = 111,600</td></tr>' +
          '<tr><td>embed</td><td>N × 5120 (Wan-14B width)</td><td>571 M activations / layer</td></tr></table>' +
          '<p>Nominal compression 4·8·8·3/16 = 48×; the extra first latent frame makes it 46.8×.</p>' +
          '<p class="muted">The DiT, Attention, GPU and Parallelism chambers quote Wan 2.1’s native 16 fps setting instead (81 frames → 21 latent frames → 75,600 tokens, then frame interpolation to 24 fps in post); same 5 s shot, 1.48× fewer tokens.</p>' +
          '<div class="eq">self-attn FLOPs / layer ≈ 4·N²·d = 4 · (1.116×10⁵)² · 5120 ≈ 2.55×10¹⁴</div>' +
          '<p>FlashAttention makes memory O(N) but compute stays O(N²d): doubling the clip length quadruples attention cost; going to 1080p multiplies N by 2.25 and attention by ~5.</p>' +
          '<div class="note">Levers on N: higher-compression VAEs (Wan 2.2 TI2V-5B: 4×16×16 with 48 channels; LTX-Video ~1:192), larger patches, and sparse / sliding-window spatiotemporal attention. The VAE chamber shows the reconstruction-vs-generation trade-off.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'from pixels to tokens · the budget that sets the cost');
          ctx.focus([S.div, wb, S.venc, S.noise, S.noiseL, S.dit, S.vdec, S.lN], 0.25);
          /* pixel stack */
          var g1 = ctx.group({ parent: wb });
          ctx.text(150, 606, 'PIXELS', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', spacing: 2, parent: g1 });
          for (var i = 5; i >= 0; i--) miniFrame(ctx, g1, 70 + i * 9, 650 - i * 7, 140, 80, i / 5);
          ctx.text(160, 760, '121 × 720 × 1280 × 3', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g1 });
          S.c1 = ctx.text(160, 790, '0', { size: 20, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: g1 });
          ctx.text(160, 816, 'values', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g1 });
          ctx.reveal(g1, { from: 'left' });
          /* arrow 1 */
          var a1 = ctx.group({ parent: wb });
          arrowLabel(ctx, a1, 270, 395, 700, 'VAE encoder', '÷4 t · ÷8 h · ÷8 w', 'lime');
          ctx.reveal(a1, { delay: 700 });
          /* latent cube */
          var g2 = ctx.group({ parent: wb });
          ctx.text(478, 606, 'LATENT', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', spacing: 2, parent: g2 });
          var rr = ctx.rng(9);
          cube(ctx, { cx: 478, cy: 690, w: 84, h: 72, d: 30, color: 'lime', n: 6, parent: g2, mosaic: function () { var k = 50 + 150 * rr(); return 'rgb(' + Math.round(k * 0.7) + ',' + Math.round(k) + ',' + Math.round(k * 0.8) + ')'; } });
          ctx.text(478, 760, '16 × 31 × 90 × 160', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g2 });
          S.c2 = ctx.text(478, 790, '0', { size: 20, font: 'mono', weight: 700, color: 'lime', anchor: 'middle', parent: g2 });
          ctx.text(478, 816, 'values (÷46.8)', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g2 });
          ctx.reveal(g2, { from: 'scale', delay: 900 });
          /* arrow 2 */
          var a2 = ctx.group({ parent: wb });
          arrowLabel(ctx, a2, 565, 690, 700, 'patchify', '1 × 2 × 2 → 64-d', 'lime');
          ctx.reveal(a2, { delay: 1500 });
          /* token grid */
          var g3 = ctx.group({ parent: wb });
          ctx.text(790, 606, 'TOKENS', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', spacing: 2, parent: g3 });
          var rt = ctx.rng(17);
          S.tokGrid = ctx.matrix(706, 646, 7, 12, { cell: 11, gap: 3, cmap: 'lime', values: function () { return 0.25 + 0.6 * rt(); }, parent: g3 });
          ctx.text(790, 760, '31 × 45 × 80', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g3 });
          S.c3 = ctx.text(790, 790, '0', { size: 20, font: 'mono', weight: 700, color: 'lime', anchor: 'middle', parent: g3 });
          ctx.text(790, 816, 'tokens N', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g3 });
          ctx.reveal(g3, { from: 'up', delay: 1700 });
          /* arrow 3 + sequence */
          var a3 = ctx.group({ parent: wb });
          arrowLabel(ctx, a3, 895, 1010, 700, 'Linear', '64 → 5120', 'lime');
          ctx.reveal(a3, { delay: 2300 });
          var g4 = ctx.group({ parent: wb });
          ctx.text(1275, 606, 'SEQUENCE FOR THE DiT', { size: 12, font: 'mono', weight: 600, color: 'dim', anchor: 'middle', spacing: 2, parent: g4 });
          ctx.text(1275, 646, 'X ∈ ℝ^(111,600 × 5120)  + 3D RoPE (t, h, w)', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: g4 });
          for (var s = 0; s < 44; s++) {
            ctx.rect(1030 + s * 11.2, 684, 9.5, 32, { rx: 1.5, fill: ctx.cmap('lime', 0.25 + 0.5 * ((s * 37) % 11) / 11), parent: g4 });
          }
          ctx.text(1275, 760, 'full 3D self-attention: N² ≈ 1.25 × 10¹⁰ pairs', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: g4 });
          ctx.text(1275, 790, '4·N²·d ≈ 2.6 × 10¹⁴ FLOPs per layer', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', parent: g4 });
          ctx.text(1275, 820, '× 40 layers × 100 passes per clip', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g4 });
          ctx.reveal(g4, { from: 'right', delay: 2500 });
          ctx.hud('N = 31 × 45 × 80 = 111,600 tokens per sample');
          var fmtM = function (v) { return (v / 1e6).toFixed(v < 1e7 ? 2 : 1) + ' M'; };
          return Promise.all([
            ctx.counter(S.c1, 0, 334540800, 1200, fmtM),
            ctx.wait(1000).then(function () { return ctx.counter(S.c2, 0, 7142400, 1000, fmtM); }),
            ctx.wait(1800).then(function () { return ctx.counter(S.c3, 0, 111600, 1000); })
          ]).then(function () { return ctx.wait(900); });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'The denoising loop',
        say: 'Generation runs noising in reverse. We sample a latent of pure Gaussian noise at time one. At each step the transformer predicts a velocity, the direction from noise toward data, and a simple Euler update moves the latent a little along it. Fifty steps later, at time zero, structure has emerged: the moon, the ice horizon, the fox. The schedule is shifted toward high noise, where the large scale layout of the shot is decided.',
        deep: '<p><b>Rectified flow / flow matching</b> (SD3, Wan, HunyuanVideo, Movie Gen) uses a straight path between data and noise:</p>' +
          '<div class="eq">z<sub>t</sub> = (1 − t)·x<sub>0</sub> + t·ε,   target v = ε − x<sub>0</sub></div>' +
          '<div class="eq">L = E<sub>t,x₀,ε</sub> ‖ v<sub>θ</sub>(z<sub>t</sub>, t, c) − (ε − x<sub>0</sub>) ‖²</div>' +
          '<p>Sampling integrates dz/dt = v<sub>θ</sub> from t = 1 to 0:</p>' +
          '<div class="eq">z<sub>i+1</sub> = z<sub>i</sub> + (t<sub>i+1</sub> − t<sub>i</sub>) · v<sub>θ</sub>(z<sub>i</sub>, t<sub>i</sub>, c)</div>' +
          '<p><b>Timestep shift</b>: t′ = s·t / (1 + (s − 1)·t), with s ≈ 5 at 720p (Wan default). At high resolution neighbouring latents are redundant, so a given noise level destroys less information; the shift spends more steps at high noise where composition and motion are decided.</p>' +
          '<div class="note">At any step, x̂<sub>0</sub> = z<sub>t</sub> − t·v<sub>θ</sub> is a free preview of the final clip — decoded at low resolution it powers the live “preview.ready” events streamed to the creator.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'flow-matching sampler · z moves from noise (t = 1) to data (t = 0)');
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
          S.grid = ctx.matrix(60, 592, R, Cc, { cell: 11, gap: 1, values: at(1), parent: wb });
          ctx.reveal(S.grid, {});
          ctx.text(60, 782, 'z_t = (1 − t)·x₀ + t·ε', { size: 13, font: 'mono', color: 'text', parent: wb });
          S.readout = ctx.text(60, 812, 'step 0 / 50 · t = 1.000', { size: 15, font: 'mono', weight: 600, color: 'lime', parent: wb });
          ctx.text(60, 842, 'preview x̂₀ = z_t − t·v  (free at any step)', { size: 12, font: 'mono', color: 'dim', parent: wb });
          /* schedule plot */
          var shift = 5;
          function sched(u) { var t = 1 - u; return shift * t / (1 + (shift - 1) * t); }
          S.pl = ctx.plot(470, 600, 300, 180, function (u) { return 1 - u; }, { color: ctx.alpha('dim', 0.8), sw: 1.5, xLabel: 'step i / 50', yLabel: 't', parent: wb });
          S.pl2 = ctx.plot(470, 600, 300, 180, sched, { color: 'lime', sw: 2.2, axes: false, parent: wb });
          ctx.text(700, 632, 'shift s = 5', { size: 12, font: 'mono', color: 'lime', parent: wb });
          ctx.text(620, 740, 'uniform', { size: 11, font: 'mono', color: 'dim', parent: wb });
          S.dot = ctx.circle(470, 600, 6, { fill: 'lime', parent: wb, glow: true });
          ctx.reveal([S.pl, S.pl2], { delay: 200 });
          /* equations */
          var eq = ctx.group({ parent: wb });
          ctx.text(850, 604, 'TRAIN', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: eq });
          ctx.text(850, 632, 'loss = ‖ v_θ(z_t, t, c) − (ε − x₀) ‖²', { size: 15, font: 'mono', color: 'white', parent: eq });
          ctx.text(850, 660, 't ~ logit-normal, ε ~ N(0, I), x₀ = VAE(video)', { size: 12, font: 'mono', color: 'dim', parent: eq });
          ctx.text(850, 704, 'SAMPLE', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: eq });
          ctx.text(850, 732, 'z ← z + (t_{i+1} − t_i) · v_θ(z, t_i, c)', { size: 15, font: 'mono', color: 'white', parent: eq });
          ctx.text(850, 760, 't′ = s·t / (1 + (s − 1)·t)   (resolution shift)', { size: 12, font: 'mono', color: 'dim', parent: eq });
          ctx.text(850, 804, '1 step = 1 DiT forward (2 with CFG) over 111,600 tokens', { size: 13, font: 'mono', color: 'lime', parent: eq });
          ctx.text(850, 834, 'solvers: Euler, Heun, DPM-Solver++ / UniPC (flow variants)', { size: 12, font: 'mono', color: 'dim', parent: eq });
          ctx.reveal(eq, { delay: 400 });
          if (!S.loopStream) S.loopStream = ctx.stream(S.loopP, { color: 'lime', count: 3, period: 900 });
          ctx.hud('50 Euler steps · t: 1 → 0 · shift 5');
          return ctx.tween(4200, function (p) {
            var i = Math.min(50, Math.floor(p * 50 + 1e-6));
            var t = sched(i / 50);
            S.grid.set(at(t));
            var pt = S.pl2.toPx(i / 50, t);
            S.dot.setAttribute('cx', pt.x); S.dot.setAttribute('cy', pt.y);
            S.readout.textContent = 'step ' + i + ' / 50 · t = ' + t.toFixed(3);
          }, 'linear', 500);
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Guidance & compute',
        say: 'Text alone is a weak signal, so samplers use classifier free guidance. Each step runs the transformer twice, once with the prompt and once with an empty prompt. The difference points toward the prompt, and the sampler extrapolates along it by a guidance scale of about five. That doubles the cost. At this resolution one forward pass is about thirteen peta operations, mostly attention, so the whole clip needs over a quintillion operations: roughly one H100 hour.',
        deep: '<div class="eq">v = v<sub>θ</sub>(z, t, ∅) + w · ( v<sub>θ</sub>(z, t, c) − v<sub>θ</sub>(z, t, ∅) ),   w ≈ 5</div>' +
          '<p>Per forward pass (Wan-14B-class: d = 5120, 40 layers, FFN 13824, N = 111,600):</p>' +
          '<table><tr><th>Term</th><th>FLOPs</th></tr>' +
          '<tr><td>self-attention 4N²d × 40</td><td>1.02×10¹⁶ (79%)</td></tr>' +
          '<tr><td>linear (QKVO, FFN, cross Q/O) 2·P<sub>act</sub>·N</td><td>2.67×10¹⁵ (21%)</td></tr>' +
          '<tr><td>cross-attn 4·N·512·d × 40</td><td>4.7×10¹³</td></tr>' +
          '<tr><td><b>total / forward</b></td><td><b>1.29×10¹⁶</b></td></tr></table>' +
          '<p>× 50 steps × 2 (CFG) = <b>1.29×10¹⁸ FLOPs</b>. H100 dense BF16 peak 989 TFLOP/s; at 40% MFU → ≈ 3,260 s ≈ 54 GPU-minutes; 8 GPUs with Ulysses/ring sequence parallelism → ~7 min at ideal scaling (real systems lose 10–30% to all-to-all communication).</p>' +
          '<ul><li>Cond + uncond are batched (or split across GPUs: CFG parallelism).</li>' +
          '<li>High w oversaturates and kills diversity; fixes: guidance interval (only mid-t), APG, CFG-Zero*.</li>' +
          '<li>Guidance- and step-distilled students (DMD2, consistency, adversarial) run 4–8 steps without CFG: ~12–25× fewer passes.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.loopStream) { S.loopStream.stop(); S.loopStream = null; }
          var wb = newBench(ctx, S, 'classifier-free guidance · and what one clip costs');
          ctx.focus([S.div, wb, S.dit, S.loopG, S.tok, S.lTok], 0.25);
          /* two passes */
          var g = ctx.group({ parent: wb });
          S.dC = ctx.node({ x: 170, y: 620, w: 210, h: 50, title: 'DiT(z, t, c)', sub: 'prompt', color: 'lime', titleSize: 14, subSize: 11, parent: g });
          S.dU = ctx.node({ x: 170, y: 720, w: 210, h: 50, title: 'DiT(z, t, ∅)', sub: 'empty prompt', color: 'dim', titleSize: 14, subSize: 11, parent: g });
          ctx.text(170, 790, 'same weights · batched ×2', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          ctx.reveal(g, { from: 'left' });
          /* vector geometry */
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
          ctx.reveal(vg, { delay: 400 });
          S.lC = ctx.line(278, 632, 382, 822, { color: 'lime', sw: 1.2, dash: '4 4', arrow: true, parent: wb });
          S.lU = ctx.line(278, 732, 378, 826, { color: 'dim', sw: 1.2, dash: '4 4', arrow: true, parent: wb });
          ctx.reveal([S.lC, S.lU], { from: 'draw', delay: 500 });
          /* compute panel */
          var cp = ctx.group({ parent: wb });
          ctx.text(820, 600, 'FLOPs PER FORWARD · Wan-14B-class, 720p, 5 s', { size: 12, font: 'mono', color: 'dim', parent: cp });
          var rows = [['self-attention', 1.02, 'amber', '1.02×10¹⁶'], ['linear + FFN', 0.267, 'lime', '2.67×10¹⁵'], ['cross-attention', 0.0047, 'cyan', '4.7×10¹³']];
          S.cBars = rows.map(function (r, i) {
            var y = 620 + i * 36;
            ctx.text(980, y + 12, r[0], { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: cp });
            var b = ctx.rect(992, y, Math.max(2, 400 * r[1] / 1.02), 24, { rx: 3, fill: ctx.alpha(r[2], 0.45), stroke: r[2], sw: 1, parent: cp });
            ctx.text(1402, y + 12, r[3], { size: 12, font: 'mono', color: r[2], parent: cp });
            return b;
          });
          ctx.text(820, 750, '× 50 steps × 2 (CFG) = 100 forwards per clip', { size: 13, font: 'mono', color: 'text', parent: cp });
          S.total = ctx.text(820, 784, '', { size: 22, font: 'mono', weight: 700, color: 'lime', parent: cp });
          ctx.text(820, 816, 'H100 989 TFLOP/s × 40% MFU → ~54 GPU-min · 8 GPUs (seq-parallel) → ~7 min', { size: 12, font: 'mono', color: 'dim', parent: cp });
          ctx.text(820, 844, 'distilled student: 4 steps, no CFG → 4 forwards (25× fewer)', { size: 12, font: 'mono', color: 'amber', parent: cp });
          ctx.reveal(cp, { delay: 300 });
          S.cBars.forEach(function (b, i) {
            var w = parseFloat(b.getAttribute('width'));
            b.setAttribute('width', 0);
            ctx.animate(b, { width: [0, w] }, 700, 'out', 600 + i * 200);
          });
          ctx.hud('1 clip ≈ 1.3×10¹⁸ FLOPs ≈ 1 H100-hour');
          var W = 5;
          return ctx.wait(900).then(function () {
            return ctx.tween(2000, function (t) {
              var w = 1 + (W - 1) * t;
              var gx = vu.x + w * (vc.x - vu.x), gy = vu.y + w * (vc.y - vu.y);
              S.aG.setAttribute('x2', gx); S.aG.setAttribute('y2', gy);
              S.ext.setAttribute('x2', gx); S.ext.setAttribute('y2', gy);
              S.wTxt.textContent = 'w = ' + w.toFixed(1);
            }, 'inOut');
          }).then(function () {
            return ctx.typeText(S.total, '1.29 × 10¹⁸ FLOPs per clip', 700);
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Image & control inputs',
        say: 'The reference sketch enters differently. For image to video, the VAE encodes the conditioning frame, and its latent is concatenated channel wise with the noise, together with a mask that says which frames are given. Image embeddings from a vision encoder add a second cross attention path. The same slots carry other controls: camera trajectories, depth or pose, identity references and keyframes. Keeping the fox the same fox across shots is the job of the control and consistency chamber.',
        deep: '<p><b>Wan 2.1 I2V</b> builds the DiT input by channel concatenation:</p>' +
          '<div class="eq">x<sub>in</sub> = [ z<sub>t</sub> (16) ; m (4) ; E(ref ⊕ 0<sub>120 frames</sub>) (16) ] ∈ ℝ<sup>36×31×90×160</sup></div>' +
          '<p>The mask m marks given frames; since one latent frame packs 4 pixel frames, the per-frame mask is folded into 4 channels. On the input side only the patch-embedding Conv3d (36 → 5120, kernel 1×2×2) changes shape; the I2V model is otherwise the T2V architecture, initialised from it and fine-tuned.</p>' +
          '<p>A second path injects semantics (Wan 2.1): CLIP ViT-H/14 penultimate features of the image (257 × 1280) pass an MLP projector and a <i>decoupled</i> cross-attention (new K<sub>img</sub>, V<sub>img</sub> per block) whose output is added to the text cross-attention. Wan 2.2 drops this CLIP path and relies on the latent concatenation alone.</p>' +
          '<ul><li><b>Camera</b>: per-pixel Plücker ray embeddings (CameraCtrl) or camera tokens.</li>' +
          '<li><b>Structure</b>: depth / pose / edges / optical flow through a context adapter (Wan VACE, ControlNet-style).</li>' +
          '<li><b>Identity</b>: reference-to-video (Phantom, VACE R2V), reference latents as extra tokens.</li>' +
          '<li><b>Time</b>: first-last-frame (FLF2V), and extension by conditioning on the last latent frames of the previous shot.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'image-to-video conditioning and control signals');
          S.ctrl = ctx.node({ x: 400, y: 470, w: 190, h: 52, title: 'Control', sub: 'refs · camera · keys', icon: 'eye', color: 'lime', titleSize: 15, subSize: 11 });
          ctx.reveal(S.ctrl, { from: 'up' });
          S.lCtl = ctx.link(S.ctrl, { x: 748, y: 382 }, { color: 'lime', from: 'r', dash: '5 5', bend: { x: 705, y: 472 } });
          ctx.reveal(S.lCtl, { from: 'draw', delay: 300 });
          ctx.hotspot(S.ctrl, 'consistency', { hint: 'CONTROL ⤢' });
          ctx.focus([S.div, wb, S.ref, S.lR, S.venc, S.lV, S.noise, S.noiseL, S.dit, S.ctrl, S.lCtl], 0.25);
          /* three slabs */
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
          ctx.text(157, 690, '⊕', { size: 18, color: 'white', anchor: 'middle', parent: wb });
          ctx.text(252, 690, '⊕', { size: 18, color: 'white', anchor: 'middle', parent: wb });
          ctx.reveal(S.slabs, { from: 'up', stagger: 200 });
          var ar = ctx.group({ parent: wb });
          arrowLabel(ctx, ar, 345, 410, 690, '', '', 'lime');
          ctx.reveal(ar, { delay: 800 });
          var mg = ctx.group({ parent: wb });
          cube(ctx, { cx: 485, cy: 690, w: 80, h: 90, d: 26, color: 'lime', n: 6, parent: mg, mosaic: function (i, j) { return j < 2 ? '#3d8a3a' : (j < 3 ? '#8a6a20' : '#4b3a88'); } });
          ctx.text(485, 770, '36 × 31 × 90 × 160', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: mg });
          ctx.text(60, 812, 'patch-embed Conv3d(36 → 5120, k = 1×2×2): the only input layer reshaped', { size: 12, font: 'mono', color: 'lime', parent: mg });
          ctx.text(60, 840, 'first frame given, 120 frames free → mask marks frame 0', { size: 12, font: 'mono', color: 'dim', parent: mg });
          ctx.reveal(mg, { from: 'scale', delay: 1000 });
          /* right: second path + control chips */
          var rp = ctx.group({ parent: wb });
          ctx.text(700, 600, 'SEMANTIC PATH', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: rp });
          foxSketch(ctx, rp, 700, 620, 80);
          ctx.line(790, 650, 830, 650, { color: 'violet', arrow: true, parent: rp });
          ctx.label(900, 650, 'CLIP ViT-H/14', { color: 'violet', size: 12, parent: rp });
          ctx.line(970, 650, 1005, 650, { color: 'violet', arrow: true, parent: rp });
          S.clipVec = ctx.matrix(1015, 638, 2, 16, { cell: 11, gap: 2, cmap: 'violet', values: function (r, c) { return 0.3 + 0.6 * Math.abs(Math.sin(r * 3 + c * 0.7)); }, parent: rp });
          ctx.text(1232, 650, '257 × 1280 → decoupled cross-attn', { size: 12, font: 'mono', color: 'violet', parent: rp });
          ctx.text(700, 712, 'CONTROL SIGNALS', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: rp });
          var chips = [['camera path · Plücker rays', 'cyan'], ['depth / pose / edges · VACE', 'teal'], ['identity refs · R2V', 'pink'],
            ['first + last frame · FLF2V', 'amber'], ['extend: last latents of shot 2', 'lime'], ['audio → lip / beat sync', 'orange']];
          S.ctlChips = chips.map(function (c, i) {
            var x = 700 + (i % 3) * 280, y = 748 + Math.floor(i / 3) * 40;
            return ctx.label(x, y, c[0], { color: c[1], size: 12, anchor: 'start', w: 262, parent: rp });
          });
          ctx.reveal(rp, { delay: 600 });
          ctx.reveal(S.ctlChips, { from: 'up', delay: 900, stagger: 90 });
          ctx.hud('I2V input = 16 noise + 4 mask + 16 ref = 36 channels');
          return ctx.wait(1200).then(function () {
            return Promise.all([
              ctx.transform(S.slabs[0], { x: 150 }, 900, 'inOut'),
              ctx.transform(S.slabs[1], { x: 100 }, 900, 'inOut'),
              ctx.transform(S.slabs[2], { x: 55 }, 900, 'inOut')
            ]);
          }).then(function () {
            return Promise.all([ctx.transform(S.slabs[0], { x: 0 }, 700, 'out'), ctx.transform(S.slabs[1], { x: 0 }, 700, 'out'), ctx.transform(S.slabs[2], { x: 0 }, 700, 'out'),
              ctx.packet(S.lR, { color: 'violet', dur: 500 }).then(function () { return ctx.packet(S.lV, { color: 'lime', dur: 600 }); })]);
          }).then(function () { return ctx.pulse(S.ctrl, { color: 'lime', dur: 700 }); });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Decode & sound',
        say: 'When denoising ends, the VAE decoder expands the clean latent back to pixels. It runs causally, chunk by chunk, caching features at chunk borders, so memory stays bounded even for long clips. Frontier systems such as Veo 3 and Sora 2 also generate sound in the same pass. An audio latent stream is denoised jointly with the video, and cross attention between the two streams keeps the crash of the capsule aligned with the frame where it hits the ice.',
        deep: '<p><b>Chunked causal decoding.</b> Latent frame 0 → pixel frame 0; each later latent frame → 4 frames. Every causal Conv3d (temporal kernel 3) keeps a <i>feature cache</i> of its last 2 input frames, so decoding one chunk at a time is exactly equivalent to decoding the whole clip.</p>' +
          '<div class="eq">one full-res activation (Wan-VAE, 96 ch): 121 · 720 · 1280 · 96 · 2 B ≈ 21.4 GB</div>' +
          '<p>— hence chunking in time plus <b>spatial tiling</b> with overlapped, linearly blended tiles for 1080p and above.</p>' +
          '<p><b>Joint audio-video generation.</b> Veo 3 (joint audio + video latent diffusion; architecture details unpublished) and Sora 2 output synchronized dialogue and effects. Open designs: <i>Ovi</i> (twin DiT backbones with bidirectional cross-modal attention) and <i>LTX-2</i> (asymmetric dual-stream). Audio is its own latent sequence (a 1-D VAE over waveform or mel, tens of latent frames per second).</p>' +
          '<ul><li>Sync comes from putting both streams on a <b>common clock</b>: temporal RoPE positions are scaled to seconds so a video token and an audio token at the same instant get matching phases, and the capsule impact at 2.1 s (frame 50) and its audio transient attend to each other strongly.</li>' +
          '<li>Alternative: post-hoc video-to-audio (MMAudio, HunyuanVideo-Foley) — cheaper, but it cannot let sound influence motion.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var wb = newBench(ctx, S, 'chunked causal VAE decode · joint audio stream');
          /* audio row in the diagram */
          S.aud = cube(ctx, { cx: 1100, cy: 472, w: 40, h: 30, d: 12, color: 'orange' });
          S.adec = ctx.node({ x: 1272, y: 472, w: 170, h: 46, title: 'Audio Decoder', sub: 'latent → waveform', icon: 'wave', color: 'orange', titleSize: 14, subSize: 11 });
          var wd = '', rw = ctx.rng(4);
          for (var q = 0; q <= 60; q++) { var env = q > 26 && q < 34 ? 1 : 0.3; wd += (q ? 'L' : 'M') + (1390 + q * 2.6).toFixed(1) + ',' + (472 + (rw() * 2 - 1) * 16 * env).toFixed(1); }
          S.wave = ctx.path(wd, { stroke: 'orange', sw: 1.3 });
          S.audL = ctx.text(1100, 506, 'audio latent', { size: 11, font: 'mono', color: 'orange', anchor: 'middle' });
          S.lA = ctx.link({ x: 995, y: 372 }, S.aud, { color: 'orange', to: 'l' });
          S.lA2 = ctx.link(S.aud, S.adec, { color: 'orange', from: 'r', to: 'l' });
          ctx.reveal([S.aud, S.audL, S.adec, S.wave], { from: 'right', stagger: 150 });
          ctx.reveal([S.lA, S.lA2], { from: 'draw', delay: 300, stagger: 150 });
          ctx.focus([S.div, wb, S.dit, S.z0, S.z0L, S.lZ, S.vdec, S.lD, S.lF, S.film, S.aud, S.audL, S.adec, S.wave, S.lA, S.lA2], 0.25);
          /* left: latent slices -> frames */
          var L = ctx.group({ parent: wb });
          ctx.text(70, 598, 'z₀: 31 latent frames', { size: 12, font: 'mono', color: 'dim', parent: L });
          S.lat = [];
          for (var k = 0; k < 31; k++) S.lat.push(ctx.rect(70 + k * 20.3, 612, 16, 30, { rx: 2, fill: ctx.alpha('lime', 0.25), stroke: 'lime', sw: 0.8, parent: L }));
          S.win = ctx.rect(66, 608, 24, 38, { rx: 4, stroke: 'amber', sw: 2, parent: L, glow: true });
          ctx.text(70, 668, '↓ causal decoder · feature cache (last 2 frames per conv)', { size: 12, font: 'mono', color: 'amber', parent: L });
          S.frm = [];
          for (var f = 0; f < 121; f++) S.frm.push(ctx.rect(70 + f * 5.2, 688, 4, 40, { rx: 0.5, fill: '#0b1a0a', parent: L }));
          S.fcount = ctx.text(70, 752, 'frames decoded: 0 / 121', { size: 13, font: 'mono', weight: 600, color: 'lime', parent: L });
          ctx.text(70, 784, 'full-res activation 121×720×1280×96 ch × 2 B ≈ 21.4 GB', { size: 12, font: 'mono', color: 'text', parent: L });
          ctx.text(70, 810, '→ decode 1 latent (4 frames) at a time, peak ≈ constant', { size: 12, font: 'mono', color: 'dim', parent: L });
          ctx.text(70, 836, '+ spatial tiles with overlap blending for 1080p and up', { size: 12, font: 'mono', color: 'dim', parent: L });
          ctx.reveal(L, {});
          /* right: joint audio-video */
          var Rg = ctx.group({ parent: wb });
          var x0 = 820, x1 = 1520;
          ctx.text(x0, 598, 'JOINT AUDIO-VIDEO DENOISING · Veo 3 · Sora 2 · Ovi · LTX-2', { size: 12, font: 'mono', color: 'dim', parent: Rg });
          ctx.rect(x0, 616, x1 - x0, 26, { rx: 5, fill: ctx.alpha('lime', 0.18), stroke: 'lime', sw: 1.2, parent: Rg });
          ctx.text(x0 + 10, 629, 'video tokens · 111,600', { size: 12, font: 'mono', color: 'lime', parent: Rg });
          ctx.rect(x0, 700, x1 - x0, 26, { rx: 5, fill: ctx.alpha('orange', 0.18), stroke: 'orange', sw: 1.2, parent: Rg });
          ctx.text(x0 + 10, 713, 'audio tokens · tens per second', { size: 12, font: 'mono', color: 'orange', parent: Rg });
          S.xl = [];
          for (var c = 0; c < 9; c++) {
            var xx = x0 + 250 + c * 50;
            S.xl.push(ctx.line(xx, 644, xx, 698, { color: ctx.alpha('amber', 0.6), sw: 1.2, dash: '3 4', parent: Rg }));
          }
          ctx.text(x0 + 10, 671, 'bidirectional cross-attn', { size: 11, font: 'mono', color: 'amber', parent: Rg });
          var d2 = '', rw2 = ctx.rng(12);
          var tImp = x0 + (x1 - x0) * 2.1 / 5;
          for (var p = 0; p <= 175; p++) {
            var xp = x0 + p * 4;
            var e = Math.abs(xp - tImp) < 30 ? 1 - Math.abs(xp - tImp) / 40 : 0.18;
            d2 += (p ? 'L' : 'M') + xp.toFixed(1) + ',' + (784 + (rw2() * 2 - 1) * 26 * e).toFixed(1);
          }
          ctx.path(d2, { stroke: 'orange', sw: 1.2, parent: Rg });
          ctx.line(tImp, 610, tImp, 816, { color: 'white', sw: 1.2, dash: '2 4', parent: Rg });
          ctx.label(tImp, 836, 'capsule impact · 2.1 s · frame 50', { color: 'white', size: 11, parent: Rg });
          ctx.text(x1, 836, 'shared temporal RoPE (seconds)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: Rg });
          ctx.reveal(Rg, { delay: 300 });
          ctx.hud('decode 31 → 121 frames · audio in same pass');
          var flow = ctx.loop(function (t) { S.xl.forEach(function (l, i) { l.setAttribute('stroke-dashoffset', (-t * 20 * (i % 2 ? 1 : -1)).toFixed(1)); }); });
          S.xflow = flow;
          return ctx.wait(500).then(function () {
            return ctx.tween(3200, function (t) {
              var k = Math.min(30, Math.floor(t * 31));
              S.win.setAttribute('x', 66 + k * 20.3);
              var nf = k === 0 ? 1 : 1 + 4 * k;
              if (t >= 1) nf = 121;
              for (var i = 0; i < 31; i++) S.lat[i].setAttribute('fill', i <= k ? ctx.alpha('lime', 0.75) : ctx.alpha('lime', 0.25));
              for (var f = 0; f < 121; f++) S.frm[f].setAttribute('fill', f < nf ? ctx.cmap('lime', 0.35 + 0.5 * Math.abs(Math.sin(f * 0.21))) : '#0b1a0a');
              S.fcount.textContent = 'frames decoded: ' + nf + ' / 121';
            }, 'linear');
          }).then(function () {
            return Promise.all([ctx.packet(S.lF, { color: 'lime', dur: 600 }), ctx.packet(S.lA2, { color: 'orange', dur: 600 })]);
          });
        }
      },
      /* ------------------------------------------------------------------ 9 */
      {
        title: 'The landscape',
        say: 'Here is the landscape across twenty twenty five and twenty six. Closed frontier models, Veo, Sora, Kling and Seedance, lead on quality, duration and native audio. Open weight families, Wan, HunyuanVideo and LTX, share the same recipe: a causal video VAE, a flow matching diffusion transformer and a large text encoder. The recipe has converged; the differences are data, scale, post training and distillation. Zoom into diffusion, the VAE, the DiT, or control to see each piece up close.',
        deep: '<table><tr><th>Model</th><th>Org</th><th>Weights</th><th>Notes</th></tr>' +
          '<tr><td>Veo 3 / 3.1</td><td>Google DeepMind</td><td>closed</td><td>native joint audio, 8 s clips, up to 1080p</td></tr>' +
          '<tr><td>Sora 2</td><td>OpenAI</td><td>closed</td><td>synchronized dialogue + SFX, stronger physics</td></tr>' +
          '<tr><td>Kling 2.x</td><td>Kuaishou</td><td>closed</td><td>high motion quality, 1080p; native audio from 2.6</td></tr>' +
          '<tr><td>Seedance 1.x</td><td>ByteDance</td><td>closed</td><td>1.0: native multi-shot, RLHF, distilled fast inference; 1.5 pro: joint audio-video</td></tr>' +
          '<tr><td>Wan 2.1 / 2.2</td><td>Alibaba</td><td>open (Apache-2.0)</td><td>1.3 B / 14 B; 2.2: two-expert MoE (A14B, high/low-noise experts), TI2V-5B</td></tr>' +
          '<tr><td>HunyuanVideo</td><td>Tencent</td><td>open</td><td>13 B, MLLM text encoder, dual→single-stream DiT; v1.5 ≈ 8.3 B</td></tr>' +
          '<tr><td>LTX-Video / LTX-2</td><td>Lightricks</td><td>open</td><td>~1:192 VAE, faster than real time at low res; LTX-2 adds audio</td></tr></table>' +
          '<div class="note">Converged recipe: causal 3D VAE → flow-matching DiT with 3D RoPE → big text encoder → CFG → post-training (SFT on curated clips, RLHF/DPO on human preference) → step distillation for serving.</div>',
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
          ctx.reveal(S.cards, { from: 'up', stagger: 110 });
          var rec = ctx.group({ parent: wb });
          ctx.text(60, 778, 'CONVERGED RECIPE', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: rec });
          var steps = [['causal 3D VAE', 'lime'], ['flow-matching DiT + 3D RoPE', 'lime'], ['big text encoder', 'cyan'], ['CFG', 'amber'], ['RLHF / DPO post-training', 'magenta'], ['step distillation', 'red']];
          var x = 240;
          steps.forEach(function (s, i) {
            var ch = ctx.label(x, 778, s[0], { color: s[1], size: 12, anchor: 'start', parent: rec });
            x += ch.w + (i < steps.length - 1 ? 30 : 0);
            if (i < steps.length - 1) ctx.text(x - 15, 778, '→', { size: 14, color: 'dim', anchor: 'middle', parent: rec });
          });
          ctx.text(60, 830, 'zoom in:  diffusion & flow matching · spatiotemporal VAE · DiT · control & consistency  (glowing parts above)', { size: 13, font: 'mono', color: 'lime', parent: rec });
          ctx.reveal(rec, { delay: 900 });
          ctx.hud('open: Wan · Hunyuan · LTX  vs  closed APIs');
          return ctx.wait(1400).then(function () {
            return [S.loopG, S.venc, S.dit, S.vdec, S.ctrl].reduce(function (p, n) {
              return p.then(function () { return ctx.pulse(n, { color: 'lime', dur: 550 }); });
            }, Promise.resolve());
          });
        }
      }
    ]
  });
})();
