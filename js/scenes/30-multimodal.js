/* L1 — Multimodal Understanding. How sketches, rendered video and a voice memo become tokens an LLM reasons over. */
(function () {
  var MOD = { img: 'violet', vid: 'lime', aud: 'orange', txt: 'cyan', sp: '#8a97b8' };

  /* stylised fox-astronaut sketch in a local 100x75 box, placed at (x,y) with width w */
  function foxThumb(ctx, parent, x, y, w, v) {
    var pal = [['cyan', 'orange'], ['violet', 'pink'], ['#9aa7bd', '#d9dee8']][v || 0];
    var g = ctx.group({ parent: parent });
    ctx.place(g, x, y, w / 100);
    ctx.rect(0, 0, 100, 75, { rx: 5, fill: '#0a1430', stroke: pal[0], sw: 2, parent: g });
    [[14, 12], [30, 22], [82, 32], [70, 10]].forEach(function (p) { ctx.circle(p[0], p[1], 1.5, { fill: 'white', parent: g, opacity: 0.8 }); });
    ctx.path('M0,60 Q50,46 100,60 L100,75 L0,75 Z', { fill: ctx.alpha(pal[0], 0.28), stroke: pal[0], sw: 1.5, parent: g });
    ctx.path('M96,6 Q78,12 64,24', { stroke: pal[1], sw: 2, dash: '4 3', parent: g });
    ctx.rect(43, 40, 18, 17, { rx: 5, fill: ctx.alpha('white', 0.75), parent: g });
    ctx.poly([[43, 35], [45, 21], [50, 27], [55, 27], [60, 21], [61, 35], [52, 42]], { fill: pal[1], parent: g });
    ctx.circle(52, 31, 14, { stroke: 'white', sw: 1.8, fill: ctx.alpha(pal[0], 0.12), parent: g });
    return g;
  }

  function wave(ctx, x0, yc, w, amp, n, seed, parent, color) {
    var r = ctx.rng(seed), d = '';
    for (var i = 0; i <= n; i++) {
      var env = 0.25 + 0.75 * Math.abs(Math.sin(i / n * Math.PI * 3.3));
      var v = (r() * 2 - 1) * env * amp;
      d += (i ? 'L' : 'M') + (x0 + w * i / n).toFixed(1) + ',' + (yc + v).toFixed(1);
    }
    return ctx.path(d, { stroke: color, sw: 1.2, parent: parent });
  }

  function cap(ctx, parent, x, y, s, col) {
    return ctx.text(x, y, s, { size: 11, font: 'mono', color: col || 'dim', anchor: 'middle', parent: parent });
  }

  function lit(ctx, S, i) { S.heads[i].setAttribute('fill', ctx.C.violet); }

  /* a dark overlay card used for close-ups; returns group */
  function card(ctx, x, y, w, h, title, col) {
    var g = ctx.group();
    ctx.rect(x, y, w, h, { rx: 14, fill: 'rgba(5,10,22,0.95)', stroke: col, sw: 1.5, parent: g, glow: true });
    ctx.text(x + 28, y + 32, title, { size: 17, font: 'display', weight: 700, color: 'white', parent: g });
    return g;
  }

  Atlas.register({
    id: 'multimodal',
    refs: [
      'Radford et al., <i>Learning Transferable Visual Models From Natural Language Supervision (CLIP)</i>, ICML 2021',
      'Alayrac et al., <i>Flamingo: a Visual Language Model for Few-Shot Learning</i>, NeurIPS 2022; Li et al., <i>BLIP-2</i>, ICML 2023',
      'Liu et al., <i>Visual Instruction Tuning (LLaVA)</i>, NeurIPS 2023; <i>Improved Baselines (LLaVA-1.5)</i>, CVPR 2024',
      'Wang et al., <i>Qwen2-VL</i>, 2024; Bai et al., <i>Qwen2.5-VL Technical Report</i>, 2025 (M-RoPE, dynamic resolution)',
      'Chen et al., <i>InternVL: Scaling up Vision Foundation Models</i>, CVPR 2024; Zhu et al., <i>InternVL3</i>, 2025',
      'Chameleon Team (Meta), <i>Chameleon: Mixed-Modal Early-Fusion Foundation Models</i>, 2024',
      'Radford et al., <i>Robust Speech Recognition via Large-Scale Weak Supervision (Whisper)</i>, ICML 2023; Chu et al., <i>Qwen2-Audio</i>, 2024',
      'Tschannen et al., <i>SigLIP 2: Multilingual Vision-Language Encoders</i>, 2025'
    ],
    steps: [
      {
        title: 'Three kinds of input',
        say: 'Our creator did not only type a sentence. They attached three concept sketches and a voice memo, and later the critic agent will need to watch rendered shots. A language model, however, reads nothing but a sequence of vectors. This chamber explains how pixels, video frames and sound pressure waves are turned into tokens that live in the same space as words, so that one model can reason over all of them together.',
        deep: '<p>A decoder LLM consumes exactly one thing: a matrix <code>X ∈ ℝ<sup>N×d</sup></code> of token embeddings (here <code>d = 3584</code>, a 7B-class model). Every modality must be mapped into that space by a learned function:</p>' +
          '<div class="eq">x<sub>tokens</sub> = P<sub>φ</sub>( E<sub>θ</sub>( pre(x<sub>raw</sub>) ) ) ∈ ℝ<sup>N<sub>m</sub>×d</sup></div>' +
          '<p><code>pre</code> = deterministic preprocessing, <code>E</code> = modality encoder, <code>P</code> = projector/adapter.</p>' +
          '<table><tr><th>Input</th><th>Raw size</th></tr>' +
          '<tr><td>sketch 2048×1536 RGB</td><td>9.4 M values each</td></tr>' +
          '<tr><td>rendered shot, 5 s, 1080p24</td><td>746 M values</td></tr>' +
          '<tr><td>voice memo, 42 s, 48 kHz stereo</td><td>4.0 M samples</td></tr>' +
          '<tr><td>prompt text</td><td>~60 BPE tokens</td></tr></table>' +
          '<div class="note">The whole game is <b>compression with the right inductive bias</b>: keep what the planner needs (identity, style, timing, timbre), drop redundancy, and land in a few thousand tokens.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.head = ctx.group();
          S.heads = [[150, 'RAW MEDIA'], [390, 'PREPROCESS'], [630, 'ENCODE'], [910, 'PROJECT'], [1130, 'TOKENS'], [1440, 'LLM']].map(function (h) {
            return ctx.text(h[0], 186, h[1], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', weight: 600, spacing: 2, parent: S.head });
          });
          ctx.line(50, 204, 1560, 204, { color: 'line', sw: 1, parent: S.head });
          lit(ctx, S, 0);
          ctx.reveal(S.head, { from: 'down' });

          S.raw = ctx.group();
          var gi = ctx.group({ parent: S.raw });
          [0, 1, 2].forEach(function (i) { foxThumb(ctx, gi, 56 + i * 64, 243, 60, i); });
          cap(ctx, gi, 150, 304, '3 sketches · 2048×1536 PNG');
          var gv = ctx.group({ parent: S.raw });
          ctx.rect(54, 370, 192, 50, { rx: 4, fill: '#07120a', stroke: 'lime', sw: 1.2, parent: gv });
          [0, 1, 2].forEach(function (i) { foxThumb(ctx, gv, 62 + i * 60, 376, 52, 0); });
          cap(ctx, gv, 150, 434, 'shot_03.mp4 · 5 s · 24 fps');
          var ga = ctx.group({ parent: S.raw });
          ctx.rect(54, 500, 192, 50, { rx: 4, fill: '#140c05', stroke: 'orange', sw: 1.2, parent: ga });
          wave(ctx, 62, 525, 176, 19, 110, 11, ga, 'orange');
          cap(ctx, ga, 150, 566, 'memo.m4a · 42 s · 48 kHz stereo');
          var gt = ctx.group({ parent: S.raw });
          ctx.rect(54, 618, 192, 38, { rx: 4, fill: '#061520', stroke: 'cyan', sw: 1.2, parent: gt });
          ctx.text(150, 637, '"...a fox astronaut crash-"', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: gt });
          cap(ctx, gt, 150, 672, 'prompt · ~60 tokens');
          S.rows = { img: gi, vid: gv, aud: ga, txt: gt };
          ctx.reveal([gi, gv, ga, gt], { from: 'left', stagger: 250 });

          S.llm = ctx.node({ x: 1440, y: 440, w: 220, h: 440, title: 'LLM', sub: 'decoder-only · d 3584', icon: 'brain', color: 'amber', titleSize: 20, subSize: 11 });
          ctx.reveal(S.llm, { from: 'right', delay: 500 });

          S.q = ctx.group();
          ctx.rect(290, 222, 1000, 460, { rx: 16, stroke: ctx.alpha('violet', 0.45), dash: '6 8', parent: S.q });
          ctx.text(790, 395, '?', { size: 72, font: 'display', weight: 700, color: ctx.alpha('violet', 0.5), anchor: 'middle', parent: S.q });
          ctx.text(790, 480, 'pixels · frames · pressure waves  →  vectors in ℝ³⁵⁸⁴', { size: 19, color: 'text', anchor: 'middle', parent: S.q });
          ctx.text(790, 512, 'the LLM only ever reads a sequence of d-dimensional embeddings', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: S.q });
          ctx.reveal(S.q, { delay: 1100, dur: 800 });
          return ctx.wait(1800).then(function () { return ctx.pulse(S.llm, { color: 'amber', dur: 800 }); });
        }
      },
      {
        title: 'Preprocessing',
        say: 'First, deterministic preprocessing brings every input into the shape its encoder was trained on. Sketches are resized to a fixed resolution, or snapped to a multiple of the patch size for native-resolution models. Video is subsampled: at two frames per second, the five second shot keeps ten of its one hundred and twenty frames. Audio is decoded, mixed down to mono and resampled to sixteen kilohertz. Text simply goes through the tokenizer.',
        deep: '<ul><li><b>Images</b>: bicubic resize to the encoder resolution (448² here), normalise per channel, e.g. SigLIP maps to [−1, 1]. Native-resolution models (Qwen2.5-VL) instead round H, W to multiples of 28 under a pixel budget, so a 2048×1536 sketch can keep its 4:3 aspect. Tiling models (LLaVA-NeXT AnyRes, InternVL dynamic tiles) split big images into 448² tiles plus a thumbnail.</li>' +
          '<li><b>Video</b>: decode (NVDEC), sample at a fixed fps (1–2 fps is typical for understanding) or uniformly <i>K</i> frames; frame count is made even so frames can be paired into 2-frame tubelets.</li>' +
          '<li><b>Audio</b>: AAC decode, downmix, anti-alias low-pass at 8 kHz and polyphase resample 48k→16k (decimate by 3). 42 s → 672,000 samples. Whisper-style encoders take 30 s windows, so the memo becomes two windows (30 s + 12 s padded, padding trimmed afterwards).</li>' +
          '<li><b>Text</b>: byte-level BPE (vocab ~150k) straight to token ids.</li></ul>' +
          '<div class="note">Preprocessing is where cheap mistakes hide: wrong colour space (BT.709 vs sRGB), variable-frame-rate phones, or clipping loudness all silently degrade the encoders.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.q, 400);
          lit(ctx, S, 1);
          S.prep = ctx.group();
          /* image: resize into 448x448 with 14px patch grid */
          var gi = ctx.group({ parent: S.prep });
          ctx.rect(350, 225, 80, 80, { rx: 2, fill: ctx.alpha('violet', 0.1), stroke: 'violet', parent: gi });
          foxThumb(ctx, gi, 350, 235, 80, 0);
          for (var k = 1; k < 8; k++) {
            ctx.line(350 + k * 10, 225, 350 + k * 10, 305, { color: ctx.alpha('violet', 0.45), sw: 0.8, parent: gi });
            ctx.line(350, 225 + k * 10, 430, 225 + k * 10, { color: ctx.alpha('violet', 0.45), sw: 0.8, parent: gi });
          }
          cap(ctx, gi, 390, 320, '448² · 32×32 patches of 14 px');
          /* video: 120 frame ticks, 10 selected */
          var gv = ctx.group({ parent: S.prep });
          for (var f = 0; f < 120; f++) ctx.line(300 + f * 1.5, 382, 300 + f * 1.5, 408, { color: ctx.alpha('lime', 0.22), sw: 0.8, parent: gv });
          var sel = [];
          for (var s2 = 0; s2 < 10; s2++) sel.push(ctx.line(304 + s2 * 18, 376, 304 + s2 * 18, 414, { color: 'lime', sw: 2.6, parent: gv }));
          cap(ctx, gv, 390, 434, '2 fps → 10 of 120 frames');
          /* audio: 48 kHz dense samples -> 16 kHz */
          var ga = ctx.group({ parent: S.prep });
          var dense = [], sparse = [];
          for (var i = 0; i < 30; i++) dense.push(ctx.circle(302 + i * 6, 511 + 7 * Math.sin(i * 0.55), 1.6, { fill: ctx.alpha('orange', 0.55), parent: ga }));
          for (var j = 0; j < 10; j++) sparse.push(ctx.circle(302 + j * 18, 540 + 7 * Math.sin(j * 3 * 0.55), 2.8, { fill: 'orange', parent: ga, glow: true }));
          cap(ctx, ga, 390, 566, 'mono · 16 kHz · 672k samples');
          /* text: BPE pieces */
          var gt = ctx.group({ parent: S.prep });
          var xx = 300;
          ['A', '·30', '-second', '·cin'].forEach(function (t) {
            var l = ctx.label(xx, 637, t, { color: 'cyan', size: 11, anchor: 'start', parent: gt });
            xx += l.w + 4;
          });
          cap(ctx, gt, 390, 672, 'byte-level BPE → ids');
          S.prepG = { img: gi, vid: gv, aud: ga, txt: gt };
          var L = [
            ctx.link({ x: 250, y: 265 }, { x: 344, y: 265 }, { color: 'violet', straight: true, parent: S.prep }),
            ctx.link({ x: 250, y: 395 }, { x: 296, y: 395 }, { color: 'lime', straight: true, parent: S.prep }),
            ctx.link({ x: 250, y: 525 }, { x: 296, y: 525 }, { color: 'orange', straight: true, parent: S.prep }),
            ctx.link({ x: 250, y: 637 }, { x: 296, y: 637 }, { color: 'cyan', straight: true, parent: S.prep })
          ];
          ctx.reveal(L, { from: 'draw', stagger: 120 });
          ctx.reveal([gi, gv, ga, gt], { from: 'scale', stagger: 220, delay: 200 });
          ctx.reveal(sel, { from: 'scale', stagger: 110, delay: 900 });
          ctx.reveal(sparse, { from: 'scale', stagger: 70, delay: 1000 });
          return ctx.wait(400).then(function () {
            return Promise.all(L.map(function (p, i) { return ctx.packet(p, { color: [MOD.img, MOD.vid, MOD.aud, MOD.txt][i], dur: 700 }); }));
          }).then(function () { return ctx.wait(1400); });
        }
      },
      {
        title: 'Modality encoders',
        say: 'Each modality now meets a specialist encoder. A vision transformer, usually pretrained contrastively like SigLIP, cuts images and frames into patches and turns each patch into a contextual vector. The same encoder handles video by grouping pairs of frames into small space time tubes. An audio encoder, typically initialised from Whisper, turns the log mel spectrogram into fifty feature frames per second. These encoders understand their modality, but they do not yet speak the language model\'s dialect.',
        deep: '<table><tr><th>Encoder</th><th>Input → output</th></tr>' +
          '<tr><td>ViT, SigLIP-2 so400m/14 (27 blocks, width 1152, ~0.4 B)</td><td>448² image → 32×32 = 1024 patches → <code>[1024, 1152]</code></td></tr>' +
          '<tr><td>same ViT, 2×14×14 tubelets (Qwen2-VL style Conv3d stem)</td><td>10 frames → 5 × 1024 → <code>[5120, 1152]</code></td></tr>' +
          '<tr><td>Whisper-large-v3 encoder (32 layers, width 1280, ~0.6 B)</td><td>128-bin log-mel, 100 frames/s → conv (stride 2) → 50 Hz → <code>[2100, 1280]</code> for 42 s</td></tr></table>' +
          '<p>Why contrastive pretraining? A CLIP/SigLIP encoder is trained so that image features align with text descriptions, so its patch features are already <i>semantic and language-shaped</i> — exactly what an LLM can use. Self-supervised encoders (DINOv2) give sharper spatial features; several VLMs (Cambrian-1, Eagle) concatenate both.</p>' +
          '<div class="note">Encoders are usually frozen during projector alignment, then often unfrozen with a smaller learning rate (e.g. ~5–10× below the LLM\'s) during full multimodal training.</div>',
        run: function (ctx) {
          var S = ctx.state;
          lit(ctx, S, 2);
          S.vit = ctx.node({ x: 630, y: 330, w: 200, h: 190, title: 'Vision Encoder', sub: 'ViT · SigLIP-2 so400m', icon: 'eye', color: 'violet', titleSize: 16, subSize: 11 });
          ctx.text(630, 384, '27 blocks · width 1152', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.vit });
          ctx.text(630, 402, 'images + video tubelets', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.vit });
          S.aud = ctx.node({ x: 630, y: 525, w: 200, h: 76, title: 'Audio Encoder', sub: 'Whisper-v3 enc · 32L', icon: 'mic', color: 'orange', titleSize: 16, subSize: 11 });
          S.con = ctx.node({ x: 630, y: 642, w: 200, h: 58, kind: 'hex', title: 'Contrastive', sub: 'CLIP · SigLIP', icon: 'spark', color: 'violet', titleSize: 15, subSize: 11 });
          ctx.reveal([S.vit, S.aud, S.con], { from: 'scale', stagger: 200 });
          ctx.hotspot(S.vit, 'vision-encoder');
          ctx.hotspot(S.aud, 'audio-encoder');
          ctx.hotspot(S.con, 'contrastive');
          S.encL = ctx.group();
          var L = [
            ctx.link({ x: 434, y: 265 }, { x: 528, y: 265 }, { color: 'violet', straight: true, parent: S.encL }),
            ctx.link({ x: 486, y: 395 }, { x: 528, y: 395 }, { color: 'lime', straight: true, parent: S.encL }),
            ctx.link({ x: 486, y: 525 }, { x: 528, y: 525 }, { color: 'orange', straight: true, parent: S.encL })
          ];
          S.preL = ctx.link(S.con, S.vit, { from: 'r', to: 'r', bend: { x: 800, y: 510 }, dash: '4 5', color: 'violet', label: 'pretrains', labelDx: 40, labelDy: 110, parent: S.encL });
          ctx.reveal(L, { from: 'draw', stagger: 150, delay: 400 });
          ctx.reveal(S.preL, { from: 'draw', delay: 900 });
          ctx.reveal(S.preL.labelEl, { delay: 1300 });
          /* inner shimmer: encoder "thinking" */
          return ctx.wait(700).then(function () {
            return Promise.all([
              ctx.packet(L[0], { color: 'violet', dur: 700, label: 'patches' }),
              ctx.packet(L[1], { color: 'lime', dur: 700 }),
              ctx.packet(L[2], { color: 'orange', dur: 700, label: 'log-mel' })
            ]);
          }).then(function () {
            return Promise.all([ctx.pulse(S.vit, { color: 'violet', dur: 700 }), ctx.pulse(S.aud, { color: 'orange', dur: 700 })]);
          });
        }
      },
      {
        title: 'Projectors & adapters',
        say: 'The bridge between an encoder and the language model is the projector. The simplest and today most common design is a small two layer MLP, often preceded by a two by two merge that folds four neighbouring patches into one token, cutting the count by four. Earlier designs used learned queries: the BLIP-2 Q-Former and Flamingo\'s Perceiver resampler compress any number of patches into a fixed thirty two or sixty four tokens. That is cheaper, but lossier for fine detail such as small text.',
        deep: '<p><b>2×2 merge (pixel-shuffle) + MLP</b> (InternVL, Qwen2-VL / 2.5-VL, Idefics3). Plain per-patch MLPs without merging (LLaVA-1.5, LLaVA-OneVision) keep every patch as a token.</p>' +
          '<div class="eq">z<sub>ij</sub> = [v<sub>2i,2j</sub> ; v<sub>2i,2j+1</sub> ; v<sub>2i+1,2j</sub> ; v<sub>2i+1,2j+1</sub>] ∈ ℝ<sup>4·1152 = 4608</sup></div>' +
          '<div class="eq">h<sub>ij</sub> = W<sub>2</sub> · GELU(W<sub>1</sub> · LN(z<sub>ij</sub>)) ∈ ℝ<sup>3584</sup></div>' +
          '<p>Parameters: 4608·3584 + 3584² ≈ 29 M — about 0.4% of the LLM. 1024 patches → 256 tokens, spatial layout preserved.</p>' +
          '<p><b>Q-Former</b> (BLIP-2): 32 learned queries (dim 768) self-attend and cross-attend to the frozen ViT output → always 32 tokens. <b>Perceiver resampler</b> (Flamingo): 64 latents per image/frame, injected through tanh-gated cross-attention layers into a frozen LM.</p>' +
          '<table><tr><th></th><th>MLP</th><th>Learned queries</th></tr><tr><td>tokens</td><td>∝ image area</td><td>fixed</td></tr><tr><td>OCR / fine detail</td><td>strong</td><td>weak</td></tr><tr><td>trainability</td><td>trivial</td><td>needs pretraining</td></tr></table>' +
          '<div class="note">Training recipe: stage 1 trains only the projector on caption pairs (alignment); stage 2 unfreezes the LLM (and often the ViT) for multimodal instruction tuning.</div>',
        run: function (ctx) {
          var S = ctx.state;
          lit(ctx, S, 3); lit(ctx, S, 4);
          S.projV = ctx.node({ x: 910, y: 330, w: 150, h: 190, title: 'Projector', sub: '2×2 merge + MLP', color: 'violet', titleSize: 16, subSize: 11 });
          S.projA = ctx.node({ x: 910, y: 525, w: 150, h: 76, title: 'Projector', sub: 'pool ×2 + MLP', color: 'orange', titleSize: 15, subSize: 11 });
          ctx.reveal([S.projV, S.projA], { from: 'scale', stagger: 150 });
          S.p4 = ctx.group();
          var L = [
            ctx.link({ x: 732, y: 265 }, { x: 833, y: 265 }, { color: 'violet', straight: true, label: '1024×1152', labelDy: -14, parent: S.p4 }),
            ctx.link({ x: 732, y: 395 }, { x: 833, y: 395 }, { color: 'lime', straight: true, label: '5120×1152', labelDy: -14, parent: S.p4 }),
            ctx.link({ x: 732, y: 525 }, { x: 833, y: 525 }, { color: 'orange', straight: true, label: '2100×1280', labelDy: -14, parent: S.p4 })
          ];
          S.chips = {
            img: ctx.label(1130, 265, '3 × 256 tok', { color: 'violet', size: 12, parent: S.p4 }),
            vid: ctx.label(1130, 395, '1280 tok', { color: 'lime', size: 12, parent: S.p4 }),
            aud: ctx.label(1130, 525, '1050 tok · 25 Hz', { color: 'orange', size: 12, parent: S.p4 })
          };
          var L2 = [
            ctx.link({ x: 987, y: 265 }, { x: 1080, y: 265 }, { color: 'violet', straight: true, parent: S.p4 }),
            ctx.link({ x: 987, y: 395 }, { x: 1090, y: 395 }, { color: 'lime', straight: true, parent: S.p4 }),
            ctx.link({ x: 987, y: 525 }, { x: 1066, y: 525 }, { color: 'orange', straight: true, parent: S.p4 })
          ];
          ctx.text(1130, 292, 'each × 3584', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.p4 });
          ctx.reveal(L, { from: 'draw', stagger: 120 });
          ctx.reveal(L.map(function (l) { return l.labelEl; }), { delay: 300, stagger: 120 });
          ctx.reveal(L2, { from: 'draw', stagger: 120, delay: 700 });
          ctx.reveal([S.chips.img, S.chips.vid, S.chips.aud], { from: 'left', stagger: 150, delay: 900 });

          /* bottom band: three adapter families */
          S.band = ctx.group();
          var B = S.band;
          var cards = [[60, '2×2 merge + MLP', 'InternVL · Qwen2.5-VL · Idefics3'], [480, 'Q-Former', 'BLIP-2 · InstructBLIP'], [900, 'Perceiver resampler', 'Flamingo · Idefics']];
          cards.forEach(function (c) {
            ctx.rect(c[0], 700, 390, 180, { rx: 10, fill: 'rgba(8,12,26,0.9)', stroke: ctx.alpha('violet', 0.5), parent: B });
            ctx.text(c[0] + 16, 720, c[1], { size: 14, font: 'display', weight: 700, color: 'white', parent: B });
            ctx.text(c[0] + 374, 720, c[2], { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B });
          });
          /* A: 2x2 merge -> concat -> MLP -> token */
          var q4 = ctx.matrix(84, 770, 2, 2, { cell: 16, gap: 3, cmap: 'violet', values: [[0.9, 0.6], [0.7, 0.5]], parent: B });
          ctx.line(126, 789, 150, 789, { color: 'violet', arrow: true, parent: B });
          ctx.vector(156, 750, 8, { cell: 9, gap: 1, cmap: 'violet', values: [0.9, 0.8, 0.6, 0.7, 0.7, 0.5, 0.5, 0.6], parent: B });
          ctx.text(160, 842, '4608', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          ctx.line(170, 789, 196, 789, { color: 'violet', arrow: true, parent: B });
          ctx.rect(200, 766, 110, 46, { rx: 6, fill: ctx.alpha('violet', 0.12), stroke: 'violet', parent: B });
          ctx.text(255, 782, 'Linear·GELU', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: B });
          ctx.text(255, 798, '·Linear', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: B });
          ctx.line(312, 789, 338, 789, { color: 'amber', arrow: true, parent: B });
          ctx.vector(344, 750, 8, { cell: 9, gap: 1, cmap: 'amber', values: [0.4, 0.9, 0.3, 0.7, 0.5, 0.8, 0.2, 0.6], parent: B });
          ctx.text(348, 842, '3584', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          ctx.text(76, 862, '4 patches → 1 token · layout kept · ~29 M params', { size: 11, font: 'mono', color: 'violet', parent: B });
          /* B & C: learned queries cross-attending */
          function xattn(x0, nq, qcol, lab1, lab2) {
            var ins = [], qs = [], ls = [];
            for (var i = 0; i < 10; i++) ins.push(ctx.rect(x0 + 20 + i * 20, 746, 14, 14, { rx: 3, fill: ctx.cmap('violet', 0.35 + 0.06 * i), parent: B }));
            for (var q = 0; q < nq; q++) {
              var qx = x0 + 60 + q * 30;
              for (var i2 = 0; i2 < 10; i2++) ls.push(ctx.line(qx + 7, 818, x0 + 27 + i2 * 20, 762, { color: ctx.alpha(qcol, 0.25), sw: 0.8, parent: B }));
              qs.push(ctx.rect(qx, 818, 14, 14, { rx: 7, fill: ctx.alpha(qcol, 0.8), stroke: qcol, sw: 1, parent: B }));
            }
            ctx.text(x0 + 246, 753, 'N patches (any N)', { size: 11, font: 'mono', color: 'dim', parent: B });
            ctx.text(x0 + 60 + nq * 30 + 6, 825, lab1, { size: 11, font: 'mono', color: qcol, parent: B });
            ctx.text(x0 + 16, 862, lab2, { size: 11, font: 'mono', color: qcol, parent: B });
            return { ls: ls, qs: qs };
          }
          var xb = xattn(480, 4, 'magenta', 'queries → 32 tokens', '32 learned queries · fixed cost · lossy OCR');
          var xc = xattn(900, 4, 'pink', 'latents → 64 / frame', '64 latents · tanh-gated x-attn into frozen LM');
          ctx.focus([S.head, S.vit, S.aud, S.con, S.projV, S.projA, S.p4, S.band, S.llm, S.encL], 0.3);
          ctx.reveal(B, { from: 'up', delay: 600 });
          ctx.reveal(xb.ls.concat(xc.ls), { from: 'draw', stagger: 12, delay: 1200, dur: 400 });
          return ctx.wait(1500).then(function () {
            return ctx.tween(1200, function (t) {
              var s = 1 - 0.35 * Math.sin(t * Math.PI);
              q4.cells.forEach(function (row) { row.forEach(function (c) { c.setAttribute('opacity', s.toFixed(3)); }); });
            });
          }).then(function () { return ctx.wait(1500); });
        }
      },
      {
        title: 'One interleaved sequence',
        say: 'Now every modality speaks in vectors of the same width, and they are spliced into one sequence together with the text, in the order the user supplied them. Special marker tokens delimit each image, video and audio span, so the model knows where a picture begins and ends. The language model then runs a single causal forward pass over roughly three thousand tokens, attending freely from words, to pixels, to sound.',
        deep: '<p>Implementation is almost embarrassingly simple: the chat template emits placeholder ids, and their embeddings are overwritten.</p>' +
          '<pre>ids = tok(chat_template(msgs))\n# each image: 256 x IMAGE_PAD placeholders\nemb = llm.embed(ids)          # [N, 3584]\nm   = ids == IMAGE_PAD\nemb[m] = proj(vit(pixels))    # scatter\nout = llm(inputs_embeds=emb,\n          position_ids=mrope_ids)</pre>' +
          '<p>Token count for the trailer request: 3 × 256 (sketches) + 1280 (shot_03) + 1050 (memo) + ~60 text = <b>3,158</b>, plus a dozen start/end marker tokens.</p>' +
          '<p>Attention is causal over the whole sequence in most VLMs; some (PaliGemma, Gemma 3) make attention <i>bidirectional within an image span</i> so every patch sees the full picture.</p>' +
          '<div class="note">Because the visual prefix is identical across the agents\' turns, it is a perfect candidate for <b>prefix (KV) caching</b>: encode the sketches once, reuse the KV blocks for every later question.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.focus(null);
          ctx.remove(S.band, 400);
          var seq = [['t', 5], ['s', 1], ['i', 8], ['s', 1], ['s', 1], ['i', 8], ['s', 1], ['s', 1], ['i', 8], ['s', 1], ['t', 3], ['s', 1], ['v', 14], ['s', 1], ['t', 3], ['s', 1], ['a', 12], ['s', 1], ['t', 5]];
          var colOf = { t: ctx.alpha('cyan', 0.75), s: '#56607a', i: ctx.alpha('violet', 0.85), v: ctx.alpha('lime', 0.8), a: ctx.alpha('orange', 0.85) };
          var flat = [];
          seq.forEach(function (s) { for (var k = 0; k < s[1]; k++) flat.push(s[0]); });
          S.strip = ctx.group();
          ctx.text(110, 734, 'interleaved embedding sequence', { size: 13, font: 'mono', color: 'text', parent: S.strip });
          S.nTok = ctx.text(1250, 734, '0 tokens × 3584', { size: 13, font: 'mono', color: 'amber', anchor: 'end', parent: S.strip });
          var M = ctx.matrix(110, 752, 1, flat.length, { cell: 13, gap: 2, values: function (r, c) { return colOf[flat[c]]; }, parent: S.strip });
          var segs = [[0, 5, 'text', 'cyan'], [5, 35, '3 sketches · 768', 'violet'], [35, 38, 'text', 'cyan'], [38, 54, 'shot_03 · 1280', 'lime'], [57, 71, 'memo · 1050', 'orange']];
          segs.forEach(function (s) {
            var a = M.cellCenter(0, s[0]), b = M.cellCenter(0, s[1] - 1);
            ctx.line(a.x - 6, 778, b.x + 6, 778, { color: ctx.alpha(s[3], 0.7), sw: 1, parent: S.strip });
            ctx.text((a.x + b.x) / 2, 792, s[2], { size: 11, font: 'mono', color: s[3], anchor: 'middle', parent: S.strip });
          });
          var vs = M.cellCenter(0, 5);
          ctx.text(vs.x - 6, 822, '↑ <|vision_start|> … 256 × <|image_pad|> … <|vision_end|>', { size: 11, font: 'mono', color: 'dim', parent: S.strip });
          ctx.reveal(S.strip, { dur: 400 });
          M.cells[0].forEach(function (c) { c.setAttribute('opacity', 0); });
          /* LLM internals + prefill link */
          S.llmIn = ctx.group();
          for (var l = 0; l < 9; l++) ctx.line(1350, 520 + l * 13, 1530, 520 + l * 13, { color: ctx.alpha('amber', 0.25 + 0.05 * l), sw: 1.2, parent: S.llmIn });
          ctx.text(1440, 500, '28 × [attn + MLP]', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: S.llmIn });
          ctx.reveal(S.llmIn, { delay: 300 });
          S.prefill = ctx.link({ x: 1258, y: 758 }, S.llm, { to: 'b', color: 'amber', label: 'prefill', labelDx: 30, labelDy: 6, opacity: 0 });
          S.prefill.labelEl.setAttribute('opacity', 0);
          ctx.hud('sequence: 3,158 tokens · one causal pass');
          /* tokens fly from their sources into the strip */
          var src = { t: { x: 390, y: 655 }, s: { x: 1130, y: 230 }, i: { x: 1130, y: 265 }, v: { x: 1130, y: 395 }, a: { x: 1130, y: 525 } };
          var fly = ctx.group();
          var jobs = flat.map(function (m, c) {
            var dst = M.cellCenter(0, c);
            var delay = c * 22;
            if (ctx.instant) { M.cells[0][c].setAttribute('opacity', 1); return Promise.resolve(); }
            var p = ctx.rect(-6, -6, 12, 12, { rx: 3, fill: colOf[m], parent: fly });
            ctx.place(p, src[m].x, src[m].y);
            p.setAttribute('opacity', 0);
            return ctx.tween(700, function (t) {
              p.setAttribute('opacity', 1);
              ctx.place(p, ctx.lerp(src[m].x, dst.x, t), ctx.lerp(src[m].y, dst.y, t) - Math.sin(t * Math.PI) * 60);
            }, 'inOut', delay).then(function () {
              if (p.parentNode) p.parentNode.removeChild(p);
              M.cells[0][c].setAttribute('opacity', 1);
            });
          });
          ctx.counter(S.nTok, 0, 3158, ctx.instant ? 0 : 2300, function (v) { return Math.round(v).toLocaleString('en-US') + ' tokens × 3584'; });
          return Promise.all(jobs).then(function () {
            if (fly.parentNode) fly.parentNode.removeChild(fly);
            return ctx.reveal([S.prefill, S.prefill.labelEl], { from: 'draw', dur: 600 });
          }).then(function () { return ctx.packet(S.prefill, { color: 'amber', dur: 900 }); })
            .then(function () { return ctx.pulse(S.llm, { color: 'amber', dur: 700 }); });
        }
      },
      {
        title: 'M-RoPE positions',
        say: 'A flat position index would throw away geometry: the patch directly below another would look a whole row of tokens away. Multimodal rotary embedding, introduced in Qwen two VL, gives every token three position ids, for time, height and width. Text tokens use the same value on all three, so they reduce to ordinary RoPE. Image tokens share one time id and vary in height and width. Video tokens also advance in time, and the newer Qwen two point five VL spaces those steps by real seconds.',
        deep: '<p>Standard RoPE rotates each 2-D pair of query/key channels by an angle proportional to position: <code>q′ = R(m·θ<sub>i</sub>) q</code>, with θ<sub>i</sub> = 10000<sup>−2i/d</sup>, so ⟨q′<sub>m</sub>, k′<sub>n</sub>⟩ depends only on m − n.</p>' +
          '<p><b>M-RoPE</b> splits the d<sub>head</sub>/2 = 64 frequency pairs into sections <code>[16, 24, 24]</code> driven by (t, h, w):</p>' +
          '<div class="eq">q′ = R(t·θ<sub>0:16</sub>) ⊕ R(h·θ<sub>16:40</sub>) ⊕ R(w·θ<sub>40:64</sub>) · q &nbsp;⇒&nbsp; score = f(Δt, Δh, Δw)</div>' +
          '<ul><li>Text: t = h = w = index → identical to 1-D RoPE.</li>' +
          '<li>Image (after 2×2 merge, 16×16 grid): t fixed, h, w = offset + row/col. The next text token starts at max(id) + 1, so 256 image tokens consume only 16 position ids — gentler on long-context extrapolation.</li>' +
          '<li>Video: t advances per tubelet. Qwen2.5-VL scales it to absolute time (2 ids per second of video, independent of sampling fps), so the model can answer "at what second does the visor flicker?"</li></ul>' +
          '<p>Follow-ups: VideoRoPE and V2PE revisit which frequencies the temporal axis should get; video DiTs use the same idea as 3-D RoPE over (t, h, w) latents.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          S.mr = card(ctx, 180, 215, 1120, 490, 'M-RoPE · every token gets (t, h, w)', 'violet');
          var G = S.mr;
          var toks = [];
          function cell(x, y, lab, col) {
            var r = ctx.rect(x, y, 46, 46, { rx: 6, fill: ctx.alpha(col, 0.16), stroke: ctx.alpha(col, 0.8), sw: 1.2, parent: G });
            ctx.text(x + 23, y + 23, lab.join(','), { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: G });
            toks.push({ x: x, y: y, id: lab });
            return r;
          }
          var X = [210, 262, 314];
          X.forEach(function (x, i) { cell(x, 350, [i, i, i], 'cyan'); });
          for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) cell(380 + c * 50, 300 + r * 50, [3, 3 + r, 3 + c], 'violet');
          cell(570, 350, [6, 6, 6], 'cyan');
          for (var g = 0; g < 2; g++) for (var r2 = 0; r2 < 3; r2++) for (var c2 = 0; c2 < 3; c2++) cell(634 + g * 172 + c2 * 50, 300 + r2 * 50, [7 + 2 * g, 7 + r2, 7 + c2], 'lime');
          cell(990, 350, [10, 10, 10], 'cyan');
          [[262, 'text'], [455, 'image · t fixed'], [593, 'text'], [707, 'video t = 7'], [879, 't = 9 (+1 s)'], [1013, 'text']].forEach(function (l) {
            ctx.text(l[0], 470, l[1], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          });
          ctx.text(1040, 262, 'label = t,h,w', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          /* dials */
          var dials = [['t', 'lime'], ['h', 'violet'], ['w', 'pink']].map(function (d, i) {
            var cx = 1130, cy = 300 + i * 70;
            ctx.circle(cx, cy, 26, { stroke: ctx.alpha(d[1], 0.6), sw: 1.2, parent: G });
            var hand = ctx.line(cx, cy, cx + 24, cy, { color: d[1], sw: 2.6, parent: G });
            var tx = ctx.text(cx + 40, cy, d[0] + ' = 0', { size: 13, font: 'mono', color: d[1], parent: G });
            return { hand: hand, tx: tx, cx: cx, cy: cy, name: d[0] };
          });
          ctx.text(1130, 505, 'rotation per section', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          /* equation + frequency sections */
          ctx.text(210, 548, 'q′ = R(t·θ[0:16]) ⊕ R(h·θ[16:40]) ⊕ R(w·θ[40:64]) · q      ⟨q′ₘ, k′ₙ⟩ = f(Δt, Δh, Δw)', { size: 15, font: 'mono', color: 'text', parent: G });
          var fv = ctx.vector(210, 590, 64, { horizontal: true, cell: 13, gap: 2, values: function (r, c) { return c < 16 ? ctx.alpha('lime', 0.8) : (c < 40 ? ctx.alpha('violet', 0.8) : ctx.alpha('pink', 0.8)); }, parent: G });
          ctx.text(210 + 8 * 15, 624, 't · 16 pairs', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: G });
          ctx.text(210 + 28 * 15, 624, 'h · 24 pairs', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: G });
          ctx.text(210 + 52 * 15, 624, 'w · 24 pairs', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: G });
          ctx.text(210, 664, 'head_dim 128 → 64 rotary frequency pairs, mrope_section = [16, 24, 24]; next text id = max(previous ids) + 1', { size: 12, font: 'mono', color: 'dim', parent: G });
          var hl = ctx.rect(0, 0, 52, 52, { rx: 8, stroke: 'amber', sw: 2.5, parent: G, glow: true });
          function show(k) {
            var t = toks[k];
            hl.setAttribute('x', t.x - 3); hl.setAttribute('y', t.y - 3);
            dials.forEach(function (d, i) {
              var a = t.id[i] * 0.62;
              d.hand.setAttribute('x2', (d.cx + 24 * Math.cos(a)).toFixed(1));
              d.hand.setAttribute('y2', (d.cy - 24 * Math.sin(a)).toFixed(1));
              d.tx.textContent = d.name + ' = ' + t.id[i];
            });
          }
          var order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 21, 22, 30, 31];
          show(12);
          ctx.focus([S.mr], 0.1);
          ctx.reveal(G, { from: 'scale', s0: 0.92 });
          ctx.reveal(fv, { delay: 600 });
          S.mrLoop = ctx.loop(function (t) {
            var k = order[Math.floor(t / 0.9) % order.length];
            show(k);
          });
          return ctx.wait(4500);
        }
      },
      {
        title: 'Late vs early fusion',
        say: 'Everything so far is late fusion: separately pretrained encoders glued to a language model with adapters. The alternative is early fusion. Chameleon turns images into discrete codes with a vector quantized tokenizer, adds those codes to the vocabulary, and trains one transformer from scratch on interleaved sequences, so it can both read and write images. Late fusion is cheaper and stronger at perception today; early fusion unifies understanding with generation.',
        deep: '<table><tr><th></th><th>Late fusion (adapter)</th><th>Early fusion (native tokens)</th></tr>' +
          '<tr><td>visual input</td><td>continuous ViT features</td><td>discrete VQ codes in the vocab</td></tr>' +
          '<tr><td>example</td><td>LLaVA, Qwen2.5-VL, InternVL3, Gemma 3</td><td>Chameleon, Emu3</td></tr>' +
          '<tr><td>can emit images</td><td>no (needs a separate generator)</td><td>yes, autoregressively</td></tr>' +
          '<tr><td>fine detail / OCR</td><td>strong</td><td>limited by the tokenizer</td></tr>' +
          '<tr><td>training cost</td><td>reuse pretrained parts</td><td>from scratch, trillions of tokens</td></tr></table>' +
          '<p>Chameleon: a VQ tokenizer maps 512×512 → 1024 codes from an 8192-entry codebook; unified vocab of 65,536; stability required QK-Norm and z-loss. <b>Hybrids</b>: Janus-Pro decouples a SigLIP encoder for understanding from a VQ tokenizer for generation; Transfusion and BAGEL keep one transformer but generate images with a diffusion / flow objective on continuous latents.</p>' +
          '<div class="note">This system uses late fusion for <i>understanding</i> and a dedicated latent video DiT for <i>generation</i> (see the Video Generation chamber): each is best in class, and they communicate through text prompts, reference images and embeddings.</div>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.mrLoop) S.mrLoop.stop();
          ctx.remove(S.mr, 400);
          S.fu = card(ctx, 180, 215, 1120, 490, 'Late fusion vs early fusion', 'violet');
          var G = S.fu;
          ctx.line(740, 260, 740, 690, { color: 'line', sw: 1, dash: '4 6', parent: G });
          ctx.text(210, 280, 'LATE FUSION · adapter', { size: 13, font: 'mono', weight: 700, color: 'violet', spacing: 1, parent: G });
          ctx.text(770, 280, 'EARLY FUSION · native discrete tokens', { size: 13, font: 'mono', weight: 700, color: 'lime', spacing: 1, parent: G });
          function chain(xs, names, col, y) {
            var ns = names.map(function (n, i) { return ctx.node({ x: xs[i], y: y, w: 92, h: 40, title: n, color: i === 3 ? 'amber' : col, titleSize: 12, kind: 'box', glow: false, parent: G }); });
            var ls = [];
            for (var i = 0; i < ns.length - 1; i++) ls.push(ctx.link(ns[i], ns[i + 1], { color: col, straight: true, parent: G }));
            return { ns: ns, ls: ls };
          }
          var A = chain([256, 360, 464, 574, 682], ['pixels', 'ViT', 'MLP', 'LLM', 'text'], 'violet', 335);
          var B = chain([818, 920, 1022, 1132, 1240], ['pixels', 'VQ enc', 'vocab', 'one TF', 'ids out'], 'lime', 335);
          ctx.text(412, 372, 'continuous ℝ³⁵⁸⁴ vectors', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          /* continuous soft tokens: real-valued, never in the vocabulary */
          var rc = ctx.rng(15);
          ctx.matrix(210, 400, 2, 24, { cell: 12, gap: 3, cmap: 'violet', values: function () { return 0.15 + 0.8 * rc(); }, parent: G });
          ctx.text(580, 414, 'soft tokens ∉ vocab', { size: 11, font: 'mono', color: 'dim', parent: G });
          ctx.text(971, 372, '1024 codes / 512² · K = 8192', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          var back = ctx.path('M1240,357 C1240,410 1160,410 1100,410', { stroke: 'lime', sw: 1.6, dash: '4 4', arrow: true, parent: G });
          ctx.text(1090, 410, 'VQ dec → image', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: G });
          /* codes strip */
          var r = ctx.rng(5);
          ctx.matrix(770, 440, 2, 24, { cell: 12, gap: 3, values: function () { return ctx.cmap('lime', 0.25 + 0.7 * r()); }, parent: G });
          ctx.text(1140, 454, 'image ids ∈ text vocab', { size: 11, font: 'mono', color: 'dim', parent: G });
          ctx.para(210, 470, ['+ reuses strong pretrained encoders', '+ cheap: align projector, then unfreeze', '+ best perception and OCR today', '− reads images but cannot emit them', '− resolution and token budget fixed by design'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: G });
          ctx.para(770, 510, ['+ one model reads AND writes images', '+ any interleaving, one loss, one vocab', '− VQ discards fine detail', '− from-scratch training, instabilities', '  (needs QK-norm, z-loss)'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: G });
          ctx.text(210, 610, 'LLaVA · Qwen2.5-VL · InternVL3 · Gemma 3', { size: 12, font: 'mono', color: 'violet', parent: G });
          ctx.text(770, 640, 'Chameleon · Emu3 │ hybrids: Janus-Pro, BAGEL', { size: 12, font: 'mono', color: 'lime', parent: G });
          ctx.text(210, 676, 'This system: late-fusion VLM for understanding + separate latent video DiT for generation.', { size: 13, color: 'amber', parent: G });
          ctx.focus([S.fu], 0.1);
          ctx.reveal(G, { from: 'scale', s0: 0.92 });
          return ctx.wait(700).then(function () {
            var pa = A.ls.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'violet', dur: 350 }); }); }, Promise.resolve());
            var pb = B.ls.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'lime', dur: 350 }); }); }, Promise.resolve())
              .then(function () { return ctx.packet(back, { color: 'lime', dur: 600 }); });
            return Promise.all([pa, pb]);
          }).then(function () { return ctx.wait(1500); });
        }
      },
      {
        title: 'Token budgets',
        say: 'Tokens are the currency. Fed naively, the sketches at full resolution plus every frame of the rendered shot would cost about one hundred and seventy thousand tokens, and attention cost grows with the square of that. Resizing, sampling at two frames per second, two frame tubelets and two by two merging bring it down to about three thousand, roughly fifty five times fewer. Prefill then takes about a tenth of a second on one GPU, and the KV cache stays under two hundred megabytes.',
        deep: '<table><tr><th>Input</th><th>Naive</th><th>Engineered</th></tr>' +
          '<tr><td>3 sketches</td><td>3 × 2048·1536/14² ≈ 48 k</td><td>3 × (32²/4) = 768</td></tr>' +
          '<tr><td>shot_03 (5 s)</td><td>120 fr × 1024 (each at 448²) = 122,880</td><td>10 fr → 5 tubelets × 256 = 1280</td></tr>' +
          '<tr><td>memo (42 s)</td><td>50 Hz → 2100</td><td>25 Hz → 1050</td></tr>' +
          '<tr><td>text</td><td>60</td><td>60</td></tr>' +
          '<tr><td><b>total</b></td><td><b>≈ 173 k</b></td><td><b>3,158</b></td></tr></table>' +
          '<p>Cost for a 7.6 B, 28-layer, GQA (4 KV heads × 128) LLM:</p>' +
          '<div class="eq">FLOPs ≈ 2·P·N + 2·L·d·N² (causal: FlashAttention skips masked tiles)</div>' +
          '<div class="eq">N = 3,158: 48 + 2 ≈ 50 TFLOP &nbsp;·&nbsp; N = 173 k: 2.6 + 6.0 ≈ 8.7 PFLOP</div>' +
          '<div class="eq">KV bytes/token = 2 · L · h<sub>kv</sub> · d<sub>h</sub> · 2 B = 56 KiB → 181 MB vs 9.9 GB</div>' +
          '<p>On an H100 (989 TFLOP/s dense BF16) at ~40% MFU: ~0.13 s vs ~22 s of prefill. At 173 k tokens the quadratic attention term already exceeds all the weight matmuls.</p>' +
          '<p>Typical per-image budgets: 256 tokens (448² + 2×2 merge) up to ~1,280 (Qwen2.5-VL with <code>max_pixels = 1280·28²</code>); video frames get a smaller per-frame pixel cap so long clips fit.</p>' +
          '<div class="note">Further levers: ToMe-style token merging inside the ViT, dynamic frame selection (keep frames where content changes), and pooling video tokens more aggressively than images (LLaVA-Video, Qwen2.5-VL max-pixel budgets per frame).</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.fu, 400);
          S.tb = card(ctx, 180, 215, 1120, 490, 'Token budget for the trailer request (log scale)', 'violet');
          var G = S.tb;
          var x0 = 420, W = 800;
          function px(v) { return x0 + (Math.log(v) / Math.LN10) / 6 * W; }
          [1, 10, 100, 1000, 10000, 100000, 1000000].forEach(function (v, i) {
            var x = px(v);
            ctx.line(x, 268, x, 560, { color: 'line', sw: 1, dash: '2 5', parent: G });
            ctx.text(x, 578, ['1', '10', '100', '1k', '10k', '100k', '1M'][i], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          });
          var rows = [['3 sketches', 48149, 768, 'violet', 'full-res patches → 448² + 2×2 merge'], ['shot_03', 122880, 1280, 'lime', '24 fps → 2 fps, tubelets, merge'], ['voice memo', 2100, 1050, 'orange', '50 Hz → 25 Hz pooling'], ['prompt text', 60, 60, 'cyan', 'unchanged']];
          var anims = [];
          rows.forEach(function (r, i) {
            var y = 300 + i * 66;
            ctx.text(400, y + 6, r[0], { size: 14, font: 'mono', color: 'text', anchor: 'end', parent: G });
            ctx.rect(x0, y - 12, px(r[1]) - x0, 12, { rx: 3, fill: 'rgba(255,255,255,0.08)', stroke: ctx.alpha('white', 0.25), sw: 1, parent: G });
            ctx.text(px(r[1]) + 8, y - 6, r[1].toLocaleString('en-US'), { size: 11, font: 'mono', color: 'dim', parent: G });
            var b = ctx.rect(x0, y + 4, px(r[1]) - x0, 16, { rx: 3, fill: ctx.alpha(r[3], 0.55), stroke: r[3], sw: 1, parent: G });
            var lab = ctx.text(px(r[1]) + 8, y + 12, '', { size: 12, font: 'mono', color: r[3], weight: 600, parent: G });
            ctx.text(x0, y + 34, r[4], { size: 11, font: 'mono', color: 'dim', parent: G });
            anims.push({ b: b, lab: lab, from: r[1], to: r[2] });
          });
          var tot = ctx.text(420, 612, '', { size: 16, font: 'mono', color: 'white', weight: 600, parent: G });
          ctx.text(420, 644, 'prefill ≈ 2PN + 2LdN² ≈ 50 TFLOP → ~0.13 s on one H100 · naive: ~8.7 PFLOP, ~22 s', { size: 12, font: 'mono', color: 'dim', parent: G });
          ctx.text(420, 668, 'KV cache 56 KiB/token → 181 MB (naive 9.9 GB)', { size: 12, font: 'mono', color: 'dim', parent: G });
          ctx.focus([S.tb], 0.1);
          ctx.reveal(G, { from: 'scale', s0: 0.92 });
          ctx.hud('context 173k → 3.2k tokens (~55× less)');
          return ctx.wait(900).then(function () {
            return ctx.tween(2200, function (t) {
              var tv = 0;
              anims.forEach(function (a) {
                var v = Math.exp(Math.log(a.from) + (Math.log(a.to) - Math.log(a.from)) * t);
                var w = px(v) - x0;
                a.b.setAttribute('width', Math.max(2, w).toFixed(1));
                a.lab.setAttribute('x', (x0 + w + 8).toFixed(1));
                a.lab.textContent = Math.round(v).toLocaleString('en-US');
                tv += v;
              });
              tot.textContent = 'total ' + Math.round(tv).toLocaleString('en-US') + ' tokens';
            }, 'inOut');
          }).then(function () {
            tot.textContent = 'total 173,189 → 3,158 tokens  (~55× fewer)';
            return ctx.wait(1200);
          });
        }
      },
      {
        title: 'Reference analysis',
        say: 'The output of this stage is not prose but a structured reference analysis the other agents can consume: the fox\'s identity traits, a colour palette taken from the sketches, style descriptors, the narrator\'s voice profile, and the critic\'s verdict on shot three. The embeddings are also written to vector memory for retrieval. To see how each piece works inside, zoom into the vision encoder, the audio encoder, or contrastive alignment.',
        deep: '<p>The understanding agent asks the VLM for JSON that matches a schema; <b>grammar-constrained decoding</b> guarantees it parses. Measurable quantities are not left to the LLM: the agent calls tools.</p>' +
          '<ul><li><b>palette</b>: k-means (k = 4) in CIELAB over sketch pixels — a tool, not a guess.</li>' +
          '<li><b>identity_ref</b>: a grounded crop box predicted by the VLM (Qwen2.5-VL emits absolute pixel boxes), later fed to the video model as a reference image.</li>' +
          '<li><b>voice</b>: speaker embedding (ECAPA-TDNN, 192-d) + f0 via pYIN + speaking rate from ASR timestamps.</li>' +
          '<li><b>critic scores</b>: cosine similarities in SigLIP space between shot frames and the identity crop / sketches.</li></ul>' +
          '<p>Known failure modes of VLM perception: hallucinated attributes, counting, small text, left/right confusion, temporal ordering in long videos. Mitigations: re-query on zoomed crops, higher pixel budgets for detail questions, and cross-checking with embedding similarity.</p>' +
          '<div class="note">Zoom deeper: <b>Vision Encoders</b> (patches, NaViT, tubelets, merging), <b>Audio Encoding</b> (log-mel, Whisper, RVQ codecs, speaker embeddings), <b>Contrastive Alignment</b> (CLIP / SigLIP losses).</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.tb, 400);
          ctx.focus(null);
          lit(ctx, S, 5);
          S.json = ctx.code({ x: 770, y: 222, w: 540, title: 'reference_analysis.json', lang: 'json', color: 'violet', size: 12, typing: true, maxLines: 11, lines: [
            '{ "character": { "species": "red fox", "role": "astronaut",',
            '    "suit": "white EVA, orange trim", "visor": "cracked",',
            '    "identity_ref": "sketch_2.png#box=634,184,1188,1090" },',
            '  "palette": ["#0B1E3F", "#6FE3FF", "#FF7A2F", "#E8F4FF"],',
            '  "style": ["painterly concept art", "rim light", "2.39:1",',
            '            "volumetric ice haze", "low heroic angle"],',
            '  "voice": { "speaker_emb": "mem://voice/memo#ecapa192",',
            '    "f0_median_hz": 118, "rate_wpm": 142,',
            '    "timbre": "warm, slightly breathy" },',
            '  "critic": { "shot_03": { "identity_sim": 0.81,',
            '    "style_sim": 0.74, "fix": "visor flicker 2.1-2.9 s" } } }'
          ].map(function (s) { return s.replace(/ {2,}/g, function (m) { return new Array(m.length + 1).join('\u00a0'); }); }) });
          ctx.focus([S.json, S.llm, S.llmIn, S.vit, S.aud, S.con, S.head], 0.25);
          ctx.reveal(S.json, { from: 'right' });
          S.mem = ctx.node({ x: 1040, y: 640, w: 210, h: 62, kind: 'cyl', title: 'Vector Memory', sub: 'SigLIP / ECAPA embeddings', color: 'teal', titleSize: 14, subSize: 10 });
          S.memL = ctx.link(S.con, S.mem, { from: 'r', to: 'l', color: 'teal', dash: '4 5', label: 'index refs', labelDy: -12 });
          ctx.reveal([S.mem, S.memL], { from: 'fade', delay: 600, stagger: 200 });
          ctx.reveal(S.memL.labelEl, { delay: 1000 });
          return S.json.typeAll().then(function () {
            return [S.vit, S.aud, S.con].reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, { color: 'violet', dur: 600 }); }); }, Promise.resolve());
          });
        }
      }
    ]
  });
})();
