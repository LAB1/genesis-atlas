/* L1 — Multimodal Understanding. How sketches, rendered video and a voice memo become tokens an LLM reasons over.
 * Beat format: each step is a sequence of beats; every beat has its own narration, callout card, deep-dive block
 * and gated animation segment (ctx.beat(k)). */
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

  function hide(list) { list.forEach(function (e) { e.setAttribute('opacity', 0); }); }

  function sweep(ctx, list, opts) {
    return list.reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, opts); }); }, Promise.resolve());
  }

  Atlas.register({
    id: 'multimodal',
    refs: [
      'Radford et al., <i>Learning Transferable Visual Models From Natural Language Supervision (CLIP)</i>, ICML 2021',
      'Alayrac et al., <i>Flamingo: a Visual Language Model for Few-Shot Learning</i>, NeurIPS 2022; Li et al., <i>BLIP-2: Bootstrapping Language-Image Pre-training with Frozen Image Encoders and Large Language Models</i>, ICML 2023',
      'Liu et al., <i>Visual Instruction Tuning (LLaVA)</i>, NeurIPS 2023; Liu et al., <i>Improved Baselines with Visual Instruction Tuning (LLaVA-1.5)</i>, CVPR 2024',
      'Wang et al., <i>Qwen2-VL: Enhancing Vision-Language Model\'s Perception of the World at Any Resolution</i>, 2024; Bai et al., <i>Qwen2.5-VL Technical Report</i>, 2025 (M-RoPE, dynamic resolution)',
      'Chen et al., <i>InternVL: Scaling up Vision Foundation Models and Aligning for Generic Visual-Linguistic Tasks</i>, CVPR 2024; Zhu et al., <i>InternVL3: Exploring Advanced Training and Test-Time Recipes for Open-Source Multimodal Models</i>, 2025',
      'Chameleon Team (Meta), <i>Chameleon: Mixed-Modal Early-Fusion Foundation Models</i>, 2024',
      'Radford et al., <i>Robust Speech Recognition via Large-Scale Weak Supervision (Whisper)</i>, ICML 2023',
      'Zhai et al., <i>Sigmoid Loss for Language Image Pre-Training (SigLIP)</i>, ICCV 2023; Tschannen et al., <i>SigLIP 2: Multilingual Vision-Language Encoders with Improved Semantic Understanding, Localization, and Dense Features</i>, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Three kinds of input',
        beats: [
          {
            say: 'Our creator did not only type a sentence. They attached three concept sketches and a forty two second voice memo, so the request already mixes pictures, sound and text.',
            card: { tag: 'KEY IDEA', title: 'Three modalities, one request', body: 'Images, audio and text arrive together, and the planner has to reason over all of them at once.' },
            deep: '<p>Raw inputs are large and highly redundant. What the creator uploaded, before any processing:</p>' +
              '<table><tr><th>Input</th><th>Raw size</th></tr>' +
              '<tr><td>sketch 2048×1536 RGB</td><td>9.4 M values each</td></tr>' +
              '<tr><td>voice memo, 42 s, 48 kHz stereo</td><td>4.0 M samples</td></tr>' +
              '<tr><td>prompt text + chat template</td><td>~60 BPE tokens</td></tr></table>' +
              '<p>Three different signal types: a 2-D spatial grid, a 1-D pressure waveform sampled 48,000 times a second, and a discrete symbol sequence. A transformer cannot ingest all three raw signals directly: even omni-modal models put a modality-specific front end (an encoder or a tokenizer) in front of it.</p>'
          },
          {
            say: 'Later, the critic agent will also have to watch the rendered shots. Five seconds of video at twenty four frames per second is one hundred and twenty frames, a mountain of pixels.',
            card: { tag: 'NUMBERS', title: 'A five second shot', stat: { v: '746 M', u: 'values', l: '120 frames × 1920 × 1080 × 3 channels, about 80 sketches worth of pixels' } },
            deep: '<p>Video adds a time axis: <code>120 × 1080 × 1920 × 3 = 746,496,000</code> values for a single 5&nbsp;s, 1080p, 24&nbsp;fps shot. The trailer has six of them, so the critic faces roughly <b>4.5 G</b> values every review round.</p>' +
              '<p>Video is also the one modality this system <i>produces</i>, so understanding it must be cheap enough to sit inside a generate, critique, regenerate loop. That budget pressure shapes every design choice in this chamber.</p>'
          },
          {
            say: 'A language model, however, reads nothing but a sequence of vectors. Text works because a tokenizer maps words to ids and a lookup table maps ids to vectors. Pixels and sound pressure have no such table.',
            card: { tag: 'KEY IDEA', title: 'The LLM only reads embeddings', body: 'Its input is a matrix of N token embeddings, each 3584 wide in Qwen2.5-7B, our reference model. Everything else must be translated into that space.' },
            deep: '<p>A decoder LLM consumes exactly one thing: a matrix <code>X ∈ ℝ<sup>N×d</sup></code> of token embeddings, here <code>d = 3584</code> (Qwen2.5-7B class: 28 layers, 28 query heads, 4 KV heads).</p>' +
              '<div class="eq">X = E[ids],&nbsp; E ∈ ℝ<sup>V×d</sup>,&nbsp; V ≈ 152 k &nbsp;⇒&nbsp; |E| = 152,064 · 3584 ≈ 0.55 B params</div>' +
              '<p>For text the table <code>E</code> is learned during pre-training. For pixels and waveforms there is no discrete vocabulary to index, so we need a learned <i>function</i> that produces the rows of <code>X</code> instead.</p>'
          },
          {
            say: 'This chamber explains how pixels, video frames and sound waves are turned into tokens that live in the same space as words, so that one model can reason over all of them together.',
            card: { tag: 'HOW IT WORKS', title: 'Preprocess, encode, project', body: 'A deterministic step, a specialist encoder and a small learned projector turn each raw signal into tokens that sit beside the words.', more: '<p>Why not caption everything into text first? Captions are lossy: exact hue, pose, timbre and pacing vanish, and errors compound. Passing <b>embeddings</b> keeps the LLM in touch with the signal itself.</p>' },
            deep: '<div class="eq">x<sub>tokens</sub> = P<sub>φ</sub>( E<sub>θ</sub>( pre(x<sub>raw</sub>) ) ) ∈ ℝ<sup>N<sub>m</sub>×d</sup></div>' +
              '<p><code>pre</code> = deterministic preprocessing, <code>E</code> = modality encoder, <code>P</code> = projector or adapter, <code>N<sub>m</sub></code> = tokens for modality <i>m</i>.</p>' +
              '<div class="note">The whole game is <b>compression with the right inductive bias</b>: keep what the planner needs (identity, style, timing, timbre), drop redundancy, and land in a few thousand tokens.</div>'
          }
        ],
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
          hide([gv]);
          var ga = ctx.group({ parent: S.raw });
          ctx.rect(54, 500, 192, 50, { rx: 4, fill: '#140c05', stroke: 'orange', sw: 1.2, parent: ga });
          wave(ctx, 62, 525, 176, 19, 110, 11, ga, 'orange');
          cap(ctx, ga, 150, 566, 'memo.m4a · 42 s · 48 kHz stereo');
          var gt = ctx.group({ parent: S.raw });
          ctx.rect(54, 618, 192, 38, { rx: 4, fill: '#061520', stroke: 'cyan', sw: 1.2, parent: gt });
          ctx.text(150, 637, '"...a fox astronaut crash-"', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: gt });
          cap(ctx, gt, 150, 672, 'prompt + template · ~60 ids');
          S.rows = { img: gi, vid: gv, aud: ga, txt: gt };
          S.ghost = ctx.group({ parent: S.raw });
          ctx.rect(54, 370, 192, 50, { rx: 4, stroke: ctx.alpha('lime', 0.55), dash: '4 4', sw: 1.2, parent: S.ghost });
          ctx.text(150, 395, 'rendered shots · later', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: S.ghost });

          /* beat 0: sketches, memo and prompt arrive */
          return ctx.reveal([gi, ga, gt, S.ghost], { from: 'left', stagger: 250 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the rendered shot */
            ctx.remove(S.ghost, 300);
            return ctx.reveal(gv, { from: 'left' }).then(function () { return ctx.pulse(gv, { color: 'lime', dur: 700 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the LLM and its text lookup */
            S.llm = ctx.node({ x: 1440, y: 440, w: 220, h: 440, title: 'LLM', sub: 'decoder-only · d 3584', icon: 'brain', color: 'amber', titleSize: 20, subSize: 11 });
            S.txtCode = ctx.code({ x: 880, y: 240, w: 400, title: 'text is already a lookup', lang: 'py', size: 12, color: 'cyan', lines: [
              'ids = tokenizer(prompt)     # [60] ints',
              'X   = embed_table[ids]      # [60, 3584]'
            ] });
            return Promise.all([ctx.reveal(S.llm, { from: 'right' }), ctx.reveal(S.txtCode, { from: 'up', delay: 300 })]).then(function () {
              return ctx.pulse(S.llm, { color: 'amber', dur: 800 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the question this chamber answers */
            S.q = ctx.group();
            ctx.rect(290, 222, 570, 460, { rx: 16, stroke: ctx.alpha('violet', 0.45), dash: '6 8', parent: S.q });
            ctx.text(575, 395, '?', { size: 72, font: 'display', weight: 700, color: ctx.alpha('violet', 0.5), anchor: 'middle', parent: S.q });
            ctx.text(575, 480, 'pixels · frames · pressure waves  →  vectors in ℝ³⁵⁸⁴', { size: 17, color: 'text', anchor: 'middle', parent: S.q });
            ctx.text(575, 512, 'the LLM only ever reads a sequence of d-dimensional embeddings', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.q });
            return ctx.reveal(S.q, { dur: 800 }).then(function () { return ctx.pulse(S.head, { color: 'violet', dur: 900 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Preprocessing',
        beats: [
          {
            say: 'First, deterministic preprocessing brings every input into the shape its encoder was trained on. Sketches are resized to a fixed resolution, or snapped to a multiple of the patch size for native resolution models.',
            card: { tag: 'HOW IT WORKS', title: 'Resize, normalise, snap', body: 'Either a fixed 448 by 448 square, or native aspect ratio with both sides rounded to multiples of 28 under a pixel budget.', more: '<p>Tiling models split a large image into encoder-sized tiles plus a downscaled thumbnail, so global layout and fine detail are both visible. InternVL 1.5 uses 448² tiles (1 to 12 in training, plus the thumbnail); LLaVA-NeXT AnyRes uses 336² tiles.</p>' },
            deep: '<p><b>Images</b>: bicubic resize to the encoder resolution (448² here), then per-channel normalisation, e.g. SigLIP maps pixels to [−1, 1] with <code>(x/255 − 0.5)/0.5</code>.</p>' +
              '<p><b>Native-resolution</b> models (Qwen2.5-VL) instead round H and W to multiples of 28 under a min/max pixel budget, so a 2048×1536 sketch keeps its 4:3 aspect. <b>Tiling</b> models cut big images into fixed-size tiles plus a thumbnail (InternVL: 448² tiles; LLaVA-NeXT AnyRes: 336² tiles).</p>' +
              '<p>Multiples of 28 = the 14 px patch times the later 2×2 merge, so the token grid always divides evenly.</p>'
          },
          {
            say: 'Video is subsampled. At two frames per second, the five second shot keeps ten of its one hundred and twenty frames.',
            card: { tag: 'NUMBERS', title: 'Frame sampling', stat: { v: '10 / 120', l: 'frames kept from the 5 s, 24 fps shot at 2 fps, a 12× cut before any encoding' } },
            deep: '<p><b>Video</b>: decode with NVDEC, then sample at a fixed fps (1–2 fps is typical for understanding) or uniformly <i>K</i> frames. The count is made even so frames can be paired into 2-frame tubelets later.</p>' +
              '<p>Fixed-fps sampling keeps <b>time</b> meaningful (frame <i>i</i> sits at <i>i</i>/fps seconds), which matters for timestamped questions such as "when does the visor flicker?". Uniform-K sampling keeps the token budget constant regardless of clip length.</p>'
          },
          {
            say: 'Audio is decoded, mixed down to mono, and resampled to sixteen kilohertz, the rate speech encoders were trained on.',
            card: { tag: 'NUMBERS', title: 'Audio at 16 kHz mono', stat: { v: '672,000', u: 'samples', l: '42 s of mono audio at 16 kHz, down from 4.0 M at 48 kHz stereo' } },
            deep: '<p><b>Audio</b>: AAC decode, downmix <code>(L+R)/2</code>, anti-alias low-pass (cutoff ≈ 0.9 × 8 kHz) and polyphase resample 48 k → 16 k, i.e. decimate by 3. 42 s → <b>672,000</b> samples.</p>' +
              '<p>Whisper-style encoders take fixed 30 s windows, so the memo becomes two windows: 30 s plus 12 s zero-padded, with the padding trimmed afterwards. Chapter <i>Audio Encoding</i> zooms into every step of this path.</p>'
          },
          {
            say: 'Text simply goes through the tokenizer, which turns the prompt and its chat template into about sixty integer ids.',
            card: { tag: 'HOW IT WORKS', title: 'Text is already discrete', body: 'A byte-level BPE tokenizer with a vocabulary near 152k maps the prompt and chat template to about 60 ids. No learned encoder is needed before the embedding table.' },
            deep: '<p><b>Text</b>: byte-level BPE (vocabulary ≈ 152 k for Qwen2.5) maps any Unicode string to token ids with no out-of-vocabulary case, because the fallback alphabet is the 256 possible bytes.</p>' +
              '<p>The chat template then wraps the ids with role markers (<code>&lt;|im_start|&gt;</code>) and inserts <b>placeholder ids</b> where images, video and audio will be spliced in: those placeholders are overwritten with projected embeddings in step 5.</p>'
          },
          {
            say: 'Preprocessing is also where cheap mistakes hide. A wrong colour space, a variable frame rate phone clip or clipped loudness quietly degrades everything downstream, and nothing ever raises an error.',
            card: { tag: 'PITFALL', title: 'Silent failures live here', body: 'BT.709 versus sRGB, variable frame rate and clipped loudness never raise an error. They just make every later stage a little worse.' },
            deep: '<p>Typical silent bugs and their cures:</p>' +
              '<ul><li><b>Colour space / range</b>: BT.709 limited-range video treated as full-range sRGB shifts every hue and contrast. Convert explicitly.</li>' +
              '<li><b>EXIF rotation</b> on phone sketches: an unrotated image is a different image to the encoder.</li>' +
              '<li><b>Variable frame rate</b>: trust timestamps, never frame counts.</li>' +
              '<li><b>Loudness clipping</b> and phase-inverted stereo channels that cancel in the downmix.</li></ul>' +
              '<div class="note">Hash the preprocessing config into every cache key and unit-test it on golden inputs: a regression here shows up as an unexplained accuracy drop three services later.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.q, 400);
          ctx.remove(S.txtCode, 400);
          lit(ctx, S, 1);
          S.prep = ctx.group();
          S.prepDet = ctx.group();
          function det(y, lines, col) { return ctx.para(540, y, lines, { size: 12, font: 'mono', color: col, lh: 20, parent: S.prepDet }); }
          var gi, gv, ga, gt, dI, dV, dA, dT;

          /* beat 0: images resize to a 448 grid */
          gi = ctx.group({ parent: S.prep });
          ctx.rect(350, 225, 80, 80, { rx: 2, fill: ctx.alpha('violet', 0.1), stroke: 'violet', parent: gi });
          foxThumb(ctx, gi, 350, 235, 80, 0);
          for (var k = 1; k < 8; k++) {
            ctx.line(350 + k * 10, 225, 350 + k * 10, 305, { color: ctx.alpha('violet', 0.45), sw: 0.8, parent: gi });
            ctx.line(350, 225 + k * 10, 430, 225 + k * 10, { color: ctx.alpha('violet', 0.45), sw: 0.8, parent: gi });
          }
          cap(ctx, gi, 390, 320, '448² · 32×32 patches of 14 px');
          var L0 = ctx.link({ x: 250, y: 265 }, { x: 344, y: 265 }, { color: 'violet', straight: true, parent: S.prep });
          dI = det(250, ['bicubic resize · per-channel normalise to [−1, 1]', 'or native aspect: round H, W to multiples of 28', 'or tile: 448² tiles plus a downscaled thumbnail'], 'violet');
          ctx.reveal(L0, { from: 'draw' });
          ctx.reveal(gi, { from: 'scale', delay: 250 });
          return ctx.wait(500).then(function () {
            return Promise.all([ctx.packet(L0, { color: 'violet', dur: 700 }), ctx.reveal(dI, { from: 'left' })]);
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: video ticks, 10 of 120 kept */
            gv = ctx.group({ parent: S.prep });
            for (var f = 0; f < 120; f++) ctx.line(300 + f * 1.5, 382, 300 + f * 1.5, 408, { color: ctx.alpha('lime', 0.22), sw: 0.8, parent: gv });
            var sel = [];
            for (var s2 = 0; s2 < 10; s2++) sel.push(ctx.line(304 + s2 * 18, 376, 304 + s2 * 18, 414, { color: 'lime', sw: 2.6, parent: gv }));
            cap(ctx, gv, 390, 434, '2 fps → 10 of 120 frames');
            var L1 = ctx.link({ x: 250, y: 395 }, { x: 296, y: 395 }, { color: 'lime', straight: true, parent: S.prep });
            dV = det(385, ['decode (NVDEC) · sample at 2 fps · 10 frames', 'even count so frames pair into 2-frame tubelets'], 'lime');
            ctx.reveal(L1, { from: 'draw' });
            ctx.reveal(gv, { from: 'scale', delay: 200 });
            ctx.reveal(sel, { from: 'scale', stagger: 110, delay: 700 });
            return ctx.wait(400).then(function () {
              return Promise.all([ctx.packet(L1, { color: 'lime', dur: 700 }), ctx.reveal(dV, { from: 'left', delay: 300 })]);
            }).then(function () { return ctx.wait(900); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: audio decimation 48 kHz -> 16 kHz */
            ga = ctx.group({ parent: S.prep });
            var sparse = [];
            for (var i = 0; i < 30; i++) ctx.circle(302 + i * 6, 511 + 7 * Math.sin(i * 0.55), 1.6, { fill: ctx.alpha('orange', 0.55), parent: ga });
            for (var j = 0; j < 10; j++) sparse.push(ctx.circle(302 + j * 18, 540 + 7 * Math.sin(j * 3 * 0.55), 2.8, { fill: 'orange', parent: ga, glow: true }));
            cap(ctx, ga, 390, 566, 'mono · 16 kHz · 672k samples');
            var L2 = ctx.link({ x: 250, y: 525 }, { x: 296, y: 525 }, { color: 'orange', straight: true, parent: S.prep });
            dA = det(515, ['AAC → PCM · mono · low-pass 7.2 kHz · keep every 3rd', 'Whisper windows are 30 s: 42 s becomes 2 windows'], 'orange');
            ctx.reveal(L2, { from: 'draw' });
            ctx.reveal(ga, { from: 'scale', delay: 200 });
            ctx.reveal(sparse, { from: 'scale', stagger: 70, delay: 500 });
            return ctx.wait(400).then(function () {
              return Promise.all([ctx.packet(L2, { color: 'orange', dur: 700 }), ctx.reveal(dA, { from: 'left', delay: 300 })]);
            }).then(function () { return ctx.wait(900); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: text tokenised */
            gt = ctx.group({ parent: S.prep });
            var xx = 300;
            ['A', '·30', '-second', '·cin'].forEach(function (t) {
              var l = ctx.label(xx, 637, t, { color: 'cyan', size: 11, anchor: 'start', parent: gt });
              xx += l.w + 4;
            });
            cap(ctx, gt, 390, 672, 'byte-level BPE → ids');
            var L3 = ctx.link({ x: 250, y: 637 }, { x: 296, y: 637 }, { color: 'cyan', straight: true, parent: S.prep });
            dT = det(628, ['byte-level BPE · vocabulary ≈ 152k', 'prompt + template ≈ 60 ids'], 'cyan');
            ctx.reveal(L3, { from: 'draw' });
            ctx.reveal(gt, { from: 'scale', delay: 200 });
            return ctx.wait(400).then(function () {
              return Promise.all([ctx.packet(L3, { color: 'cyan', dur: 700 }), ctx.reveal(dT, { from: 'left', delay: 300 })]);
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: where cheap mistakes hide */
            var W = [[265, 'colour space · EXIF rotation'], [395, 'variable frame rate'], [525, 'clipped loudness · phase'], [637, 'chat template drift']];
            var chips = W.map(function (w) { return ctx.label(1000, w[0], w[1], { color: 'red', size: 11, anchor: 'start', parent: S.prepDet }); });
            ctx.reveal(chips, { from: 'left', stagger: 160 });
            return sweep(ctx, [gi, gv, ga, gt], { color: 'red', dur: 500 });
          });
        }
      },

      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Modality encoders',
        beats: [
          {
            say: 'Each modality now meets a specialist encoder. A vision transformer, usually pretrained contrastively like SigLIP, cuts each image into patches and turns every patch into a contextual vector.',
            card: { tag: 'NUMBERS', title: 'Patches in, vectors out', stat: { v: '[1024, 1152]', l: 'output of the SigLIP 2 so400m ViT for one 448² sketch: 1024 patch vectors' } },
            deep: '<table><tr><th>Encoder</th><th>Input → output</th></tr>' +
              '<tr><td>ViT, SigLIP-2 so400m/14 (27 blocks, width 1152, ~0.4 B)</td><td>448² image → 32×32 = 1024 patches → <code>[1024, 1152]</code></td></tr></table>' +
              '<p>Every output vector is <i>contextual</i>: after 27 blocks of bidirectional self-attention a patch of orange fur already carries information about the helmet and the suit next to it. The Vision Encoders chamber follows one sketch through this stack.</p>' +
              '<p><span class="muted">Reference design: so400m/14 checkpoints ship at 224 or 384 px; at 448 px the learned position grid is bicubically resized from 27×27 to 32×32, and VLM recipes usually fine-tune the tower at that resolution.</span></p>'
          },
          {
            say: 'The same encoder handles video by grouping pairs of frames into small space time tubes, so ten frames become five layers of patches.',
            card: { tag: 'NUMBERS', title: 'Video through the same ViT', stat: { v: '5,120', u: 'tokens', l: 'ten sampled frames as five 2-frame layers, each 32×32 patches' } },
            deep: '<table><tr><th>Encoder</th><th>Input → output</th></tr>' +
              '<tr><td>same ViT, 2×14×14 tubelets (Qwen2-VL style Conv3d stem)</td><td>10 frames → 5 × 1024 → <code>[5120, 1152]</code></td></tr></table>' +
              '<p>Only the stem changes: a Conv3d with kernel and stride <code>(2, 14, 14)</code> replaces the Conv2d, so each token summarises two consecutive frames. Single images are duplicated into two identical frames, letting one set of weights serve both media.</p>'
          },
          {
            say: 'An audio encoder, typically initialised from Whisper, turns the log mel spectrogram into fifty feature frames per second.',
            card: { tag: 'NUMBERS', title: 'Audio features', stat: { v: '50 Hz', l: 'one 1280-wide vector per 20 ms from the Whisper-large-v3 encoder' } },
            deep: '<table><tr><th>Encoder</th><th>Input → output</th></tr>' +
              '<tr><td>Whisper-large-v3 encoder (32 layers, width 1280, ~0.6 B)</td><td>128-bin log-mel, 100 frames/s → conv (stride 2) → 50 Hz → <code>[2100, 1280]</code> for 42 s</td></tr></table>' +
              '<p>Audio LLMs (Qwen2-Audio, Kimi-Audio and others) start from Whisper because large-v3 was trained on about five million hours of weakly labelled and pseudo-labelled audio: its features already encode phonemes, language and much about the speaker, even in noise.</p>'
          },
          {
            say: 'The vision encoder gets its language shaped features from contrastive pretraining on hundreds of millions to billions of web image caption pairs. These encoders understand their modality, but they do not yet speak the language model\'s dialect.',
            card: { tag: 'TRY IT', title: 'Open any encoder', body: 'All three boxes are zoom targets: <b>Vision Encoders</b>, <b>Audio Encoding</b> and <b>Contrastive Alignment</b>. Click one.' },
            deep: '<p>Why contrastive pretraining? A CLIP or SigLIP encoder is trained so that image features align with text descriptions, so its patch features are already <i>semantic and language-shaped</i>, exactly what an LLM can use. Self-supervised encoders (DINOv2) give sharper spatial features; several VLMs combine both (Eagle concatenates the visual tokens of complementary encoders, Cambrian-1 adds a spatial vision aggregator).</p>' +
              '<div class="note">Encoders are usually frozen during projector alignment. In many recipes they are then unfrozen at a smaller learning rate during full multimodal training (LLaVA-OneVision: 2e-6 for the vision tower against 1e-5 for the LLM, 5× lower), while LLaVA-1.5 keeps the ViT frozen throughout. Their output width (1152, 1280) still differs from the LLM\'s 3584: that gap is the projector\'s job.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          lit(ctx, S, 2);
          ctx.remove(S.prepDet, 300);
          S.encL = ctx.group();
          /* beat 0: the vision transformer and the patches flowing in */
          S.vit = ctx.node({ x: 630, y: 330, w: 200, h: 190, title: 'Vision Encoder', sub: 'ViT · SigLIP-2 so400m', icon: 'eye', color: 'violet', titleSize: 16, subSize: 11 });
          ctx.text(630, 384, '27 blocks · width 1152', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.vit });
          S.vitT2 = ctx.text(630, 402, 'images + video tubelets', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.vit });
          S.vitT2.setAttribute('opacity', 0);
          ctx.hotspot(S.vit, 'vision-encoder');
          var L0 = ctx.link({ x: 434, y: 265 }, { x: 528, y: 265 }, { color: 'violet', straight: true, parent: S.encL });
          ctx.reveal(S.vit, { from: 'scale' });
          ctx.reveal(L0, { from: 'draw', delay: 400 });
          return ctx.wait(700).then(function () {
            return ctx.packet(L0, { color: 'violet', dur: 700, label: 'patches' });
          }).then(function () {
            return ctx.pulse(S.vit, { color: 'violet', dur: 700 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: video enters as tubelets */
            var L1 = ctx.link({ x: 486, y: 395 }, { x: 528, y: 395 }, { color: 'lime', straight: true, parent: S.encL });
            ctx.reveal(L1, { from: 'draw' });
            ctx.reveal(S.vitT2, { delay: 300 });
            return ctx.wait(300).then(function () {
              return ctx.packet(L1, { color: 'lime', dur: 700, label: 'tubelets' });
            }).then(function () { return ctx.pulse(S.vit, { color: 'lime', dur: 700 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: audio encoder */
            S.aud = ctx.node({ x: 630, y: 525, w: 200, h: 76, title: 'Audio Encoder', sub: 'Whisper-v3 enc · 32L', icon: 'mic', color: 'orange', titleSize: 16, subSize: 11 });
            ctx.hotspot(S.aud, 'audio-encoder');
            var L2 = ctx.link({ x: 486, y: 525 }, { x: 528, y: 525 }, { color: 'orange', straight: true, parent: S.encL });
            ctx.reveal(S.aud, { from: 'scale' });
            ctx.reveal(L2, { from: 'draw', delay: 300 });
            return ctx.wait(600).then(function () {
              return ctx.packet(L2, { color: 'orange', dur: 700, label: 'log-mel' });
            }).then(function () { return ctx.pulse(S.aud, { color: 'orange', dur: 700 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: contrastive pretraining, and the dialect gap */
            S.con = ctx.node({ x: 630, y: 642, w: 200, h: 58, kind: 'hex', title: 'Contrastive', sub: 'CLIP · SigLIP', icon: 'spark', color: 'violet', titleSize: 15, subSize: 11 });
            ctx.hotspot(S.con, 'contrastive');
            S.preL = ctx.link(S.con, S.vit, { from: 'r', to: 'r', bend: { x: 800, y: 510 }, dash: '4 5', color: 'violet', label: 'pretrains', labelDx: 40, labelDy: 110, parent: S.encL });
            S.gapChip = ctx.label(895, 395, 'not yet LLM tokens', { color: 'red', size: 12 });
            ctx.reveal(S.con, { from: 'scale' });
            ctx.reveal(S.preL, { from: 'draw', delay: 500 });
            ctx.reveal(S.preL.labelEl, { delay: 900 });
            ctx.reveal(S.gapChip, { from: 'left', delay: 1200 });
            return ctx.wait(1500).then(function () {
              return sweep(ctx, [S.vit, S.aud, S.con], { color: 'violet', dur: 600 });
            });
          });
        }
      },

      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Projectors & adapters',
        beats: [
          {
            say: 'The bridge between an encoder and the language model is the projector. It maps encoder features into the embedding width of the language model.',
            card: { tag: 'KEY IDEA', title: 'The projector is the bridge', body: 'A small trainable module maps encoder width (1152 or 1280) to LLM width (3584) and decides how many tokens come out.' },
            deep: '<p>Contract of every projector: <code>[N<sub>enc</sub>, d<sub>enc</sub>] → [N<sub>tok</sub>, d<sub>LLM</sub>]</code>. Two design decisions hide in that arrow: <b>how many tokens</b> come out (N<sub>tok</sub>, the compute bill) and <b>how much capacity</b> the mapping has (the quality of the translation).</p>' +
              '<table><tr><th>input</th><th>encoder out</th><th>LLM tokens</th></tr>' +
              '<tr><td>sketch, 448²</td><td>1024 × 1152</td><td>256 × 3584</td></tr>' +
              '<tr><td>shot, 10 frames</td><td>5120 × 1152</td><td>1280 × 3584</td></tr>' +
              '<tr><td>memo, 42 s</td><td>2100 × 1280</td><td>1050 × 3584</td></tr></table>'
          },
          {
            say: 'The simplest, and today most common, design is a small two layer MLP, often preceded by a two by two merge that folds four neighbouring patches into one token, cutting the count by four.',
            card: { tag: 'NUMBERS', title: 'Merge, then MLP', stat: { v: '1024 → 256', u: 'tokens', l: 'per 448² sketch; the projector itself is only ~29 M parameters' }, more: '<p>Parameter count: <code>4608·3584 + 3584² ≈ 16.5 M + 12.8 M ≈ 29 M</code>, about 0.4% of a 7.6 B LLM, and roughly 15 GFLOP per image against about 1 TFLOP for the ViT.</p>' },
            deep: '<p><b>2×2 merge (pixel-shuffle) + MLP</b> (InternVL, Qwen2-VL / 2.5-VL, Idefics3). Plain per-patch MLPs without merging (LLaVA-1.5; LLaVA-OneVision for single images) keep every patch as a token.</p>' +
              '<div class="eq">z<sub>ij</sub> = [v<sub>2i,2j</sub> ; v<sub>2i,2j+1</sub> ; v<sub>2i+1,2j</sub> ; v<sub>2i+1,2j+1</sub>] ∈ ℝ<sup>4·1152 = 4608</sup></div>' +
              '<div class="eq">h<sub>ij</sub> = W<sub>2</sub> · GELU(W<sub>1</sub> · LN(z<sub>ij</sub>)) ∈ ℝ<sup>3584</sup></div>' +
              '<p>1024 patches → 256 tokens with the 2-D layout preserved: token (i, j) still sits where its 28×28 pixel block sits.</p>'
          },
          {
            say: 'Earlier designs used learned queries. The BLIP two Q-Former and Flamingo\'s Perceiver resampler compress any number of patches into a fixed thirty two or sixty four tokens.',
            card: { tag: 'HOW IT WORKS', title: 'Learned queries: fixed budget', body: '32 or 64 learned vectors cross-attend to every patch, so the token count is constant whatever the image resolution.' },
            deep: '<p><b>Q-Former</b> (BLIP-2): 32 learned queries (dim 768) self-attend to each other and cross-attend to the frozen ViT output, so the output is always 32 tokens. <b>Perceiver resampler</b> (Flamingo): 64 latents per image or frame, whose outputs reach the frozen LM through tanh-gated cross-attention layers.</p>' +
              '<div class="eq">Z = softmax( Q K<sup>ᵀ</sup> / √d ) V,&nbsp; Q ∈ ℝ<sup>32×d</sup> learned,&nbsp; K, V from N patches</div>' +
              '<p>Cost of the resampler is linear in N patches; the LLM sees a constant 32–64 tokens per image, ideal for many-image prompts.</p>'
          },
          {
            say: 'That is cheaper, but lossier for fine detail such as small text, which is why most recent open models went back to the MLP.',
            card: { tag: 'TRADE-OFF', title: 'Cheap tokens or fine detail', body: 'Learned queries fix the cost but blur small text. MLP projectors keep every patch and read OCR well, so most 2025 open VLMs use them.' },
            deep: '<table><tr><th></th><th>MLP</th><th>Learned queries</th></tr><tr><td>tokens</td><td>∝ image area</td><td>fixed</td></tr><tr><td>OCR / fine detail</td><td>strong</td><td>weak</td></tr><tr><td>trainability</td><td>trivial</td><td>needs pretraining</td></tr></table>' +
              '<p>A resampler must decide <i>before</i> seeing the question which few vectors summarise the picture. Thin strokes and small text are exactly what a 32-vector bottleneck drops. Idefics3 dropped its 64-token perceiver resampler for pixel shuffle (169 tokens per 364² tile) precisely to remove an OCR bottleneck, while MiniCPM-V keeps a resampler (64 queries per slice in its first versions) but feeds it many high-resolution slices to compensate.</p>'
          },
          {
            say: 'A popular recipe for training the bridge has two stages. First only the projector learns, on image caption pairs, with the encoder and language model frozen. Then the language model, and in many recipes the encoder too, is unfrozen for multimodal instruction tuning.',
            card: { tag: 'HOW IT WORKS', title: 'A common two-stage recipe', body: 'Stage 1 aligns only the projector. Stage 2 unfreezes the LLM, and in many recipes the ViT at a lower learning rate, on instruction data.' },
            deep: '<p>Stage 1 (alignment): freeze ViT and LLM, train the projector on image–caption pairs. A modest set is enough: LLaVA-1.5 used 558 k pairs. Stage 2 (instruction tuning): unfreeze the LLM on instruction data, e.g. 665 k mixed samples in LLaVA-1.5, which keeps the ViT frozen; LLaVA-OneVision also trains the ViT at a 5× smaller learning rate.</p>' +
              '<div class="note">Recipe in one line: <b>align cheaply, then specialise expensively</b>. The rationale is that a randomly initialised projector would push noisy gradients into a pretrained LLM. The stage is not universal, though: Prismatic VLMs (ICML 2024) found single-stage training matches or beats it and saves 20–25% of the compute.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          lit(ctx, S, 3); lit(ctx, S, 4);
          ctx.remove(S.gapChip, 300);
          ctx.focus([S.head, S.vit, S.aud, S.con, S.llm, S.encL], 0.18);
          S.band = ctx.group();
          var q4;

          /* beat 0: projector nodes and the shapes flowing in */
          S.projV = ctx.node({ x: 910, y: 330, w: 150, h: 190, title: 'Projector', sub: '2×2 merge + MLP', color: 'violet', titleSize: 16, subSize: 11 });
          S.projA = ctx.node({ x: 910, y: 525, w: 150, h: 76, title: 'Projector', sub: 'pool ×2 + MLP', color: 'orange', titleSize: 15, subSize: 11 });
          S.p4 = ctx.group();
          var L = [
            ctx.link({ x: 732, y: 265 }, { x: 833, y: 265 }, { color: 'violet', straight: true, label: '1024×1152', labelDy: -14, parent: S.p4 }),
            ctx.link({ x: 732, y: 395 }, { x: 833, y: 395 }, { color: 'lime', straight: true, label: '5120×1152', labelDy: -14, parent: S.p4 }),
            ctx.link({ x: 732, y: 525 }, { x: 833, y: 525 }, { color: 'orange', straight: true, label: '2100×1280', labelDy: -14, parent: S.p4 })
          ];
          ctx.reveal([S.projV, S.projA], { from: 'scale', stagger: 150 });
          ctx.reveal(L, { from: 'draw', stagger: 120, delay: 300 });
          ctx.reveal(L.map(function (l) { return l.labelEl; }), { delay: 600, stagger: 120 });
          return ctx.wait(1000).then(function () {
            return Promise.all(L.map(function (l, i) { return ctx.packet(l, { color: [MOD.img, MOD.vid, MOD.aud][i], dur: 600 }); }));
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: 2x2 merge + MLP, the tokens that reach the LLM */
            S.p4c = ctx.group();
            S.chips = {
              img: ctx.label(1130, 265, '3 × 256 tok', { color: 'violet', size: 12, parent: S.p4c }),
              vid: ctx.label(1130, 395, '1280 tok', { color: 'lime', size: 12, parent: S.p4c }),
              aud: ctx.label(1130, 525, '1050 tok · 25 Hz', { color: 'orange', size: 12, parent: S.p4c })
            };
            var L2 = [
              ctx.link({ x: 987, y: 265 }, { x: 1080, y: 265 }, { color: 'violet', straight: true, parent: S.p4c }),
              ctx.link({ x: 987, y: 395 }, { x: 1090, y: 395 }, { color: 'lime', straight: true, parent: S.p4c }),
              ctx.link({ x: 987, y: 525 }, { x: 1066, y: 525 }, { color: 'orange', straight: true, parent: S.p4c })
            ];
            ctx.text(1130, 292, 'each × 3584', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.p4c });
            /* bottom band: the 2x2 merge + MLP adapter family */
            var bA = ctx.group({ parent: S.band });
            ctx.rect(60, 706, 390, 176, { rx: 10, fill: 'rgba(8,12,26,0.9)', stroke: ctx.alpha('violet', 0.5), parent: bA });
            ctx.text(76, 725, '2×2 merge + MLP', { size: 14, font: 'display', weight: 700, color: 'white', parent: bA });
            ctx.text(434, 725, 'InternVL · Qwen2.5-VL · Idefics3', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: bA });
            q4 = ctx.matrix(84, 770, 2, 2, { cell: 16, gap: 3, cmap: 'violet', values: [[0.9, 0.6], [0.7, 0.5]], parent: bA });
            ctx.line(126, 789, 150, 789, { color: 'violet', arrow: true, parent: bA });
            ctx.vector(156, 750, 8, { cell: 9, gap: 1, cmap: 'violet', values: [0.9, 0.8, 0.6, 0.7, 0.7, 0.5, 0.5, 0.6], parent: bA });
            ctx.text(160, 842, '4608', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: bA });
            ctx.line(170, 789, 196, 789, { color: 'violet', arrow: true, parent: bA });
            ctx.rect(200, 766, 110, 46, { rx: 6, fill: ctx.alpha('violet', 0.12), stroke: 'violet', parent: bA });
            ctx.text(255, 782, 'Linear·GELU', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: bA });
            ctx.text(255, 798, '·Linear', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: bA });
            ctx.line(312, 789, 338, 789, { color: 'amber', arrow: true, parent: bA });
            ctx.vector(344, 750, 8, { cell: 9, gap: 1, cmap: 'amber', values: [0.4, 0.9, 0.3, 0.7, 0.5, 0.8, 0.2, 0.6], parent: bA });
            ctx.text(348, 842, '3584', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: bA });
            ctx.text(76, 862, '4 patches → 1 token · layout kept · ~29 M params', { size: 11, font: 'mono', color: 'violet', parent: bA });
            S.bA = bA;
            ctx.reveal(L2, { from: 'draw', stagger: 120 });
            ctx.reveal([S.chips.img, S.chips.vid, S.chips.aud], { from: 'left', stagger: 150, delay: 400 });
            ctx.reveal(S.p4c, { dur: 300 });
            ctx.reveal(bA, { from: 'up', delay: 600 });
            return ctx.wait(1500).then(function () {
              return ctx.tween(1200, function (t) {
                var s = 1 - 0.35 * Math.sin(t * Math.PI);
                q4.cells.forEach(function (row) { row.forEach(function (c) { c.setAttribute('opacity', s.toFixed(3)); }); });
              });
            }).then(function () { return ctx.pulse(S.projV, { color: 'violet', dur: 700 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beats 2: learned queries (Q-Former, Perceiver) cross-attending to N patches */
            function xattn(x0, title, sub, qcol, lab1, lab2) {
              var g = ctx.group({ parent: S.band }), ls = [];
              ctx.rect(x0, 706, 390, 176, { rx: 10, fill: 'rgba(8,12,26,0.9)', stroke: ctx.alpha('violet', 0.5), parent: g });
              ctx.text(x0 + 16, 725, title, { size: 14, font: 'display', weight: 700, color: 'white', parent: g });
              ctx.text(x0 + 374, 725, sub, { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
              for (var i = 0; i < 10; i++) ctx.rect(x0 + 20 + i * 20, 746, 14, 14, { rx: 3, fill: ctx.cmap('violet', 0.35 + 0.06 * i), parent: g });
              for (var q = 0; q < 4; q++) {
                var qx = x0 + 60 + q * 30;
                for (var i2 = 0; i2 < 10; i2++) ls.push(ctx.path('M' + (qx + 7) + ',818 L' + (x0 + 27 + i2 * 20) + ',762', { stroke: ctx.alpha(qcol, 0.25), sw: 0.8, parent: g }));
                ctx.rect(qx, 818, 14, 14, { rx: 7, fill: ctx.alpha(qcol, 0.8), stroke: qcol, sw: 1, parent: g });
              }
              ctx.text(x0 + 246, 753, 'N patches (any N)', { size: 11, font: 'mono', color: 'dim', parent: g });
              ctx.text(x0 + 60 + 4 * 30 + 6, 825, lab1, { size: 11, font: 'mono', color: qcol, parent: g });
              ctx.text(x0 + 16, 862, lab2, { size: 11, font: 'mono', color: qcol, parent: g });
              g.ls = ls;
              return g;
            }
            S.bB = xattn(480, 'Q-Former', 'BLIP-2 · InstructBLIP', 'magenta', 'queries → 32 tokens', '32 learned queries · fixed cost · lossy OCR');
            S.bC = xattn(900, 'Perceiver resampler', 'Flamingo · Idefics', 'pink', 'latents → 64 / frame', '64 latents · tanh-gated x-attn into frozen LM');
            ctx.reveal([S.bB, S.bC], { from: 'up', stagger: 200 });
            ctx.reveal(S.bB.ls.concat(S.bC.ls), { from: 'draw', stagger: 12, delay: 700, dur: 400 });
            return ctx.wait(2000);
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the trade-off, made visible */
            S.verd = ctx.group({ parent: S.band });
            var chips = [
              ctx.label(255, 692, 'OCR strong · tokens ∝ area', { color: 'lime', size: 11, bg: '#0d1a33', parent: S.verd }),
              ctx.label(675, 692, 'OCR weak · fixed 32', { color: 'red', size: 11, bg: '#0d1a33', parent: S.verd }),
              ctx.label(1095, 692, 'OCR weak · fixed 64', { color: 'red', size: 11, bg: '#0d1a33', parent: S.verd })
            ];
            ctx.reveal(chips, { from: 'down', stagger: 200 });
            return ctx.wait(700).then(function () {
              return Promise.all([ctx.pulse(S.bB, { color: 'red', dur: 700 }), ctx.pulse(S.bC, { color: 'red', dur: 700 })]);
            }).then(function () { return ctx.pulse(S.bA, { color: 'lime', times: 2, dur: 700 }); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: the two training stages */
            S.train = ctx.group({ parent: S.band });
            ctx.rect(860, 596, 215, 64, { rx: 10, fill: ctx.alpha('violet', 0.1), stroke: 'violet', parent: S.train });
            ctx.text(876, 616, 'STAGE 1 · align', { size: 13, font: 'display', weight: 700, color: 'white', parent: S.train });
            ctx.text(876, 640, 'train projector only', { size: 11, font: 'mono', color: 'violet', parent: S.train });
            ctx.line(1077, 628, 1093, 628, { color: 'amber', arrow: true, parent: S.train });
            ctx.rect(1095, 596, 210, 64, { rx: 10, fill: ctx.alpha('amber', 0.1), stroke: 'amber', parent: S.train });
            ctx.text(1111, 616, 'STAGE 2 · instruct', { size: 13, font: 'display', weight: 700, color: 'white', parent: S.train });
            ctx.text(1111, 640, 'unfreeze LLM (+ ViT, low LR)', { size: 11, font: 'mono', color: 'amber', parent: S.train });
            return ctx.reveal(S.train, { from: 'up' }).then(function () {
              return ctx.pulse(S.projV, { color: 'violet', times: 2, dur: 600 });
            });
          });
        }
      },

      /* ------------------------------------------------------------------ 5 */
      {
        title: 'One interleaved sequence',
        beats: [
          {
            say: 'Now every modality speaks in vectors of the same width, and they are spliced into one sequence with the text, in the order the user supplied them. The prompt opens, then the three sketches arrive.',
            card: { tag: 'KEY IDEA', title: 'Splice, do not stack', body: 'Embeddings of every modality are placed in the same sequence, in user order, exactly where the placeholder ids were.' },
            deep: '<p>Implementation is almost embarrassingly simple: the chat template emits placeholder ids, and their embeddings are overwritten.</p>' +
              '<pre>ids = tok(chat_template(msgs))\n# each image: 256 x IMAGE_PAD placeholders\nemb = llm.embed(ids)          # [N, 3584]\nm   = ids == IMAGE_PAD\nemb[m] = proj(vit(pixels))    # scatter\nout = llm(inputs_embeds=emb,\n          position_ids=mrope_ids)</pre>' +
              '<p>Bookkeeping trap: the number of placeholders per image must be known <i>before</i> the forward pass, n = (H/28)·(W/28) after resizing, so the tokenizer stage and the vision stage have to agree on the resolution. A mismatch is the classic "image features and image tokens do not match" error, and a silent off-by-one shifts every later position id.</p>'
          },
          {
            say: 'Then come the rendered shot and the voice memo, each wrapped in its own text, and the total reaches three thousand one hundred and fifty eight tokens.',
            card: { tag: 'NUMBERS', title: 'The trailer request', stat: { v: '3,158', u: 'tokens', l: '3 × 256 sketches + 1280 shot + 1050 memo + ~60 text' } },
            deep: '<p>Token count for the trailer request: 3 × 256 (sketches) + 1280 (shot_03) + 1050 (memo) + ~60 text = <b>3,158</b>. The ~60 text tokens already include the chat template and marker tokens, so the sum is an honest order of magnitude, not a byte-exact count.</p>' +
              '<p>Interleaving order is free: images may sit between sentences, and multi-turn chats simply append new spans. There is no fixed slot per modality.</p>'
          },
          {
            say: 'Special marker tokens delimit each image, video and audio span, so the model knows where a picture begins and ends.',
            card: { tag: 'HOW IT WORKS', title: 'Markers frame each span', body: 'Start and end tokens (vision_start, vision_end) bracket every run of placeholders, so span boundaries are explicit.' },
            deep: '<p>In Qwen2.5-VL a picture occupies <code>&lt;|vision_start|&gt;</code>, N × <code>&lt;|image_pad|&gt;</code>, <code>&lt;|vision_end|&gt;</code>; video uses <code>&lt;|video_pad|&gt;</code> between the same markers, and audio-capable models add analogous markers of their own. The pad ids are pure placeholders: their embedding-table rows are never used, because the scatter step overwrites them.</p>' +
              '<p>Markers give the LLM learned boundary tokens (with trainable embeddings) so it can attend <i>to a whole image</i> as a unit and cope with several images per prompt.</p>'
          },
          {
            say: 'The language model then runs a single causal forward pass over roughly three thousand tokens, attending freely from words, to pixels, to sound.',
            card: { tag: 'HOW IT WORKS', title: 'One causal pass, prefill', body: 'The LLM reads the whole sequence in a single prefill. Every later token can attend to every earlier word, patch and audio frame.' },
            deep: '<p>Attention is causal over the whole sequence in most VLMs; some make attention <i>bidirectional over the image</i> so every patch sees the full picture: Gemma 3 within each image span, PaliGemma over its whole image-plus-prompt prefix.</p>' +
              '<div class="note">Because the visual prefix is identical across the agents\' turns, it is a perfect candidate for <b>prefix (KV) caching</b>: encode the sketches once, reuse the KV blocks for every later question.</div>'
          }
        ],
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
          M.cells[0].forEach(function (c) { c.setAttribute('opacity', 0); });
          var segs = [[0, 5, 'text', 'cyan', 0], [5, 35, '3 sketches · 768', 'violet', 0], [35, 38, 'text', 'cyan', 0], [38, 54, 'shot_03 · 1280', 'lime', 1], [54, 57, 'text', 'cyan', 1], [57, 71, 'memo · 1050', 'orange', 1]];
          var segEls = [[], []];
          segs.forEach(function (s) {
            var a = M.cellCenter(0, s[0]), b = M.cellCenter(0, s[1] - 1);
            var ln = ctx.line(a.x - 6, 778, b.x + 6, 778, { color: ctx.alpha(s[3], 0.7), sw: 1, parent: S.strip });
            var tx = ctx.text((a.x + b.x) / 2, 792, s[2], { size: 11, font: 'mono', color: s[3], anchor: 'middle', parent: S.strip });
            segEls[s[4]].push(ln, tx);
          });
          hide(segEls[0]); hide(segEls[1]);
          var vs = M.cellCenter(0, 5);
          S.mkTx = ctx.text(vs.x - 6, 822, '↑ <|vision_start|> … 256 × <|image_pad|> … <|vision_end|>', { size: 11, font: 'code', color: 'dim', parent: S.strip });
          S.mkTx.setAttribute('opacity', 0);
          S.strip.setAttribute('opacity', 0);
          /* LLM internals and prefill link */
          S.llmIn = ctx.group();
          for (var l = 0; l < 9; l++) ctx.line(1350, 520 + l * 13, 1530, 520 + l * 13, { color: ctx.alpha('amber', 0.25 + 0.05 * l), sw: 1.2, parent: S.llmIn });
          ctx.text(1440, 500, '28 × [attn + MLP]', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: S.llmIn });
          hide([S.llmIn]);
          S.prefill = ctx.link({ x: 1258, y: 758 }, S.llm, { to: 'b', color: 'amber', label: 'prefill', labelDx: 30, labelDy: 6, opacity: 0 });
          S.prefill.labelEl.setAttribute('opacity', 0);
          var src = { t: { x: 390, y: 655 }, s: { x: 1130, y: 230 }, i: { x: 1130, y: 265 }, v: { x: 1130, y: 395 }, a: { x: 1130, y: 525 } };
          function fly(a, b, ms) {
            var grp = ctx.group(), jobs = [];
            for (var c = a; c < b; c++) {
              (function (c) {
                var m = flat[c], dst = M.cellCenter(0, c);
                if (ctx.instant) { M.cells[0][c].setAttribute('opacity', 1); return; }
                var p = ctx.rect(-6, -6, 12, 12, { rx: 3, fill: colOf[m], parent: grp });
                ctx.place(p, src[m].x, src[m].y);
                p.setAttribute('opacity', 0);
                jobs.push(ctx.tween(700, function (t) {
                  p.setAttribute('opacity', 1);
                  ctx.place(p, ctx.lerp(src[m].x, dst.x, t), ctx.lerp(src[m].y, dst.y, t) - Math.sin(t * Math.PI) * 60);
                }, 'inOut', (c - a) * (ms / Math.max(1, b - a))).then(function () {
                  if (p.parentNode) p.parentNode.removeChild(p);
                  M.cells[0][c].setAttribute('opacity', 1);
                }));
              })(c);
            }
            return Promise.all(jobs).then(function () { if (grp.parentNode) grp.parentNode.removeChild(grp); });
          }
          function count(to) {
            var from = parseInt((S.nTok.textContent || '0').replace(/,/g, ''), 10) || 0;
            return ctx.counter(S.nTok, from, to, ctx.instant ? 0 : 1600, function (v) { return Math.round(v).toLocaleString('en-US') + ' tokens × 3584'; });
          }

          /* beat 0: the prompt opens, three sketches arrive */
          ctx.hud('sequence: 3,158 tokens · one causal pass');
          return ctx.reveal(S.strip, { dur: 400 }).then(function () {
            ctx.reveal(segEls[0], { delay: 900 });
            return Promise.all([fly(0, 38, 1400), count(803)]);
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: shot and memo */
            ctx.reveal(segEls[1], { delay: 800 });
            return Promise.all([fly(38, 76, 1600), count(3158)]);
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: marker tokens light up */
            var marks = [];
            flat.forEach(function (m, c) { if (m === 's') marks.push(M.cells[0][c]); });
            ctx.reveal(S.mkTx, { from: 'up' });
            return ctx.tween(900, function (t) {
              marks.forEach(function (e) { e.setAttribute('fill', ctx.mix('#56607a', '#ffbf3a', t)); });
            }).then(function () { return sweep(ctx, [marks[0], marks[1], marks[marks.length - 1]], { color: 'amber', dur: 500 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: one prefill pass through the LLM */
            ctx.reveal(S.llmIn, { delay: 200 });
            return ctx.reveal([S.prefill, S.prefill.labelEl], { from: 'draw', dur: 600 }).then(function () {
              return ctx.packet(S.prefill, { color: 'amber', dur: 900 });
            }).then(function () { return ctx.pulse(S.llm, { color: 'amber', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 6 */
      {
        title: 'M-RoPE positions',
        beats: [
          {
            say: 'A flat position index would throw away geometry. The patch directly below another would look a whole row of tokens away, and a frame in a video would have no notion of time.',
            card: { tag: 'PITFALL', title: 'Flat positions destroy geometry', body: 'With a 1-D index, vertical neighbours in a 16 by 16 grid are 16 positions apart, and video time is just more of the same counter.' },
            deep: '<p>Standard RoPE rotates each 2-D pair of query/key channels by an angle proportional to the token index <i>m</i>: <code>q′ = R(m·θ<sub>i</sub>) q</code>, with θ<sub>i</sub> = b<sup>−2i/d</sup> (base b = 10<sup>4</sup> in the original paper, 10<sup>6</sup> in Qwen2.5), so ⟨q′<sub>m</sub>, k′<sub>n</sub>⟩ depends only on m − n.</p>' +
              '<p>Flatten an image row by row and that single offset conflates <i>horizontal</i> and <i>vertical</i> distance: a patch one row down is <code>W</code> steps away, while a patch <code>W</code> columns away in the same row is <b>also</b> W steps away. The 2-D structure the ViT worked to preserve is lost at the LLM interface.</p>'
          },
          {
            say: 'Multimodal rotary embedding, introduced in Qwen two VL, gives every token three position ids, for time, height and width.',
            card: { tag: 'TRY IT', title: 'Three ids per token', body: 'Every token carries (t, h, w) and each id drives its own dial. Watch them turn, or click any token cell to pin it and read its ids.' },
            deep: '<p><b>M-RoPE</b> (Qwen2-VL) assigns each token a triple <code>(t, h, w)</code> instead of one index. Each component rotates its own slice of the query/key channels, so an attention score can depend on relative <b>time</b>, <b>row</b> and <b>column</b> separately.</p>' +
              '<p>It adds no parameters and reduces to ordinary RoPE for text. Video DiTs use the same idea as 3-D RoPE over (t, h, w) latents.</p>'
          },
          {
            say: 'Under the hood, the sixty four rotary frequency pairs of each attention head are split into three sections: sixteen for time, twenty four for height and twenty four for width.',
            card: { tag: 'NUMBERS', title: 'How the pairs are split', stat: { v: '16 · 24 · 24', l: 'rotary frequency pairs for t, h, w, out of 64 in a head of dimension 128' }, more: '<p>Relative-position property per axis: for a 2-D pair, ⟨R(mθ)q, R(nθ)k⟩ = qᵀR(mθ)ᵀR(nθ)k = qᵀR((n−m)θ)k, because rotations compose and R(α)ᵀ = R(−α). M-RoPE applies this independently in each section.</p>' },
            deep: '<p><b>M-RoPE</b> splits the d<sub>head</sub>/2 = 64 frequency pairs into sections <code>[16, 24, 24]</code> driven by (t, h, w):</p>' +
              '<div class="eq">q′ = R(t·θ<sub>0:16</sub>) ⊕ R(h·θ<sub>16:40</sub>) ⊕ R(w·θ<sub>40:64</sub>) · q &nbsp;⇒&nbsp; score = f(Δt, Δh, Δw)</div>' +
              '<p>Frequencies are ordered from fast (θ<sub>0</sub> = 1 rad per position) to slow, so this split hands time the <i>fastest</i> 16 pairs and width the slowest 24. The 16/24/24 ratio is an empirical design choice of Qwen2-VL, not something derived: the two spatial axes get more pairs than time because a page of 2-D structure needs more distinct offsets than a short clip needs distinct instants.</p>'
          },
          {
            say: 'Text tokens use the same value on all three axes, so they reduce to ordinary RoPE.',
            card: { tag: 'HOW IT WORKS', title: 'Text collapses to plain RoPE', body: 'For a word at index i the triple is (i, i, i). All three sections rotate together by the same angle, exactly like 1-D RoPE.' },
            deep: '<p>Text: <code>t = h = w = index</code>. Section 1 rotates pairs 0–15 by <code>index · θ<sub>0:16</sub></code>, section 2 pairs 16–39 by <code>index · θ<sub>16:40</sub></code>, section 3 pairs 40–63 by <code>index · θ<sub>40:64</sub></code>. Every pair therefore gets exactly the angle ordinary RoPE would give it, so a text-only prompt is <b>identical to standard RoPE</b>. That keeps the pretrained language ability of the LLM intact when the vision tower is bolted on.</p>'
          },
          {
            say: 'Image tokens share one time id and vary in height and width, so a sixteen by sixteen picture consumes only sixteen position ids.',
            card: { tag: 'NUMBERS', title: 'Positions consumed by an image', stat: { v: '16', u: 'ids', l: 'for 256 image tokens on a 16×16 grid, instead of 256 under a flat index' } },
            deep: '<ul><li>Image (after 2×2 merge, 16×16 grid): <b>t is fixed</b>; h and w = offset + row and column.</li>' +
              '<li>The next text token starts at <code>max(ids) + 1</code>, so 256 image tokens consume only <b>16</b> position ids: gentler on long-context extrapolation, since a page of images no longer pushes text far out of the trained position range.</li></ul>' +
              '<p>In the diagram the sketch occupies ids 3–5 on each axis, so the following text token is <code>(6, 6, 6)</code>.</p>'
          },
          {
            say: 'Video tokens also advance in time, and the newer Qwen two point five VL spaces those steps by real seconds, two ids per second.',
            card: { tag: 'STATE OF THE ART', title: 'Absolute time in position ids', body: 'Qwen2.5-VL ties the temporal id to seconds, not frame index, so the model can answer <i>at what second does the visor flicker?</i>' },
            deep: '<p>Video: t advances per tubelet. Qwen2.5-VL scales it to absolute time (2 ids per second of video, independent of the sampling fps), so a tubelet pair sampled 1 s apart differs by exactly 2 in t.</p>' +
              '<p>Follow-ups: because Qwen2-VL gives time the <i>fastest</i>-rotating pairs, long clips make those channels oscillate and alias distant frames. <b>VideoRoPE</b> moves the temporal axis onto the low-frequency pairs, and Qwen3-VL (2025) interleaves t, h and w across the whole frequency range and adds explicit textual timestamps. <b>V2PE</b> shrinks the position increment for visual tokens to save context range.</p>' +
              '<div class="note">The same trick, seen from the other side: video generation DiTs apply 3-D RoPE over their (t, h, w) latents (see the Video Generation chamber).</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          S.mr = card(ctx, 180, 215, 1120, 490, 'M-RoPE · every token gets (t, h, w)', 'violet');
          var G = S.mr;
          ctx.focus([S.mr], 0.1);
          var toks = [];
          var flatLab = [], triLab = [];
          function cell(x, y, lab, col) {
            var k = toks.length, txt = lab.join(',');
            var rc = ctx.rect(x, y, 46, 46, { rx: 6, fill: ctx.alpha(col, 0.16), stroke: ctx.alpha(col, 0.8), sw: 1.2, parent: G });
            rc.style.cursor = 'pointer';
            rc.addEventListener('click', function () { S.mrSeq = [k]; });
            var t1 = ctx.text(x + 23, y + 23, String(k), { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: G });
            t1.style.pointerEvents = 'none';
            flatLab.push(t1);
            var t2 = ctx.text(x + 23, y + 23, txt, { size: txt.length > 6 ? 10 : 12, font: 'mono', color: 'white', anchor: 'middle', parent: G });
            t2.style.pointerEvents = 'none';
            t2.setAttribute('opacity', 0);
            triLab.push(t2);
            toks.push({ x: x, y: y, id: lab });
          }
          var X = [210, 262, 314];
          X.forEach(function (x, i) { cell(x, 350, [i, i, i], 'cyan'); });
          for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) cell(380 + c * 50, 300 + r * 50, [3, 3 + r, 3 + c], 'violet');
          cell(570, 350, [6, 6, 6], 'cyan');
          for (var g = 0; g < 2; g++) for (var r2 = 0; r2 < 3; r2++) for (var c2 = 0; c2 < 3; c2++) cell(634 + g * 172 + c2 * 50, 300 + r2 * 50, [7 + 2 * g, 7 + r2, 7 + c2], 'lime');
          cell(990, 350, [10, 10, 10], 'cyan');
          ctx.text(1040, 262, 'token cells', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          /* dials */
          var dials = [['t', 'lime'], ['h', 'violet'], ['w', 'pink']].map(function (d, i) {
            var cx = 1130, cy = 300 + i * 70;
            var dg = ctx.group({ parent: G });
            ctx.circle(cx, cy, 26, { stroke: ctx.alpha(d[1], 0.6), sw: 1.2, parent: dg });
            var hand = ctx.line(cx, cy, cx + 24, cy, { color: d[1], sw: 2.6, parent: dg });
            var tx = ctx.text(cx + 40, cy, d[0] + ' = 0', { size: 13, font: 'mono', color: d[1], parent: dg });
            return { g: dg, hand: hand, tx: tx, cx: cx, cy: cy, name: d[0] };
          });
          var dialLab = ctx.text(1130, 505, 'rotation per section', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          hide(dials.map(function (d) { return d.g; })); dialLab.setAttribute('opacity', 0);
          /* equation and frequency sections */
          var eqA = ctx.text(210, 548, 'q′ = R(t·θ[0:16]) ⊕ R(h·θ[16:40]) ⊕ R(w·θ[40:64]) · q', { size: 15, font: 'mono', color: 'text', parent: G });
          var eqB = ctx.text(920, 548, '⟨q′ₘ, k′ₙ⟩ = f(Δt, Δh, Δw)', { size: 15, font: 'mono', color: 'amber', parent: G });
          var fv = ctx.vector(210, 590, 64, { horizontal: true, cell: 13, gap: 2, values: function (r3, c3) { return c3 < 16 ? ctx.alpha('lime', 0.8) : (c3 < 40 ? ctx.alpha('violet', 0.8) : ctx.alpha('pink', 0.8)); }, parent: G });
          var fl = [
            ctx.text(210 + 8 * 15, 624, 't · 16 pairs', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: G }),
            ctx.text(210 + 28 * 15, 624, 'h · 24 pairs', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: G }),
            ctx.text(210 + 52 * 15, 624, 'w · 24 pairs', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: G })
          ];
          var eqC = ctx.text(210, 664, 'head_dim 128 → 64 rotary frequency pairs, mrope_section = [16, 24, 24]; next text id = max(previous ids) + 1', { size: 12, font: 'mono', color: 'dim', parent: G });
          var eqAll = [eqA, eqB, fv, eqC].concat(fl);
          hide(eqAll);
          /* flat-index annotation (beat 0) */
          var flatNote = ctx.group({ parent: G });
          ctx.rect(427, 297, 52, 52, { rx: 8, stroke: 'red', sw: 2, parent: flatNote });
          ctx.rect(427, 347, 52, 52, { rx: 8, stroke: 'red', sw: 2, dash: '4 3', parent: flatNote });
          ctx.text(453, 508, 'flat index: the patch just below (7 vs 4) is 3 ids away; 16 in a real 16×16 grid', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: flatNote });
          /* labels for each token group */
          var gl = {
            text: [[262, 'text'], [593, 'text'], [1013, 'text']].map(function (l) { return ctx.text(l[0], 470, l[1], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: G }); }),
            image: [ctx.text(455, 470, 'image · t fixed', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: G })],
            video: [[707, 'video t = 7'], [879, 't = 9 (+1 s)']].map(function (l) { return ctx.text(l[0], 470, l[1], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: G }); })
          };
          hide(gl.text); hide(gl.image); hide(gl.video);
          var hl = ctx.rect(0, 0, 52, 52, { rx: 8, stroke: 'amber', sw: 2.5, parent: G, glow: true });
          hl.setAttribute('opacity', 0);
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
          S.mrSeq = [12];
          show(12);
          S.mrLoop = ctx.loop(function (t) {
            var seq = S.mrSeq;
            show(seq[Math.floor(t / 0.9) % seq.length]);
          });

          /* beat 0: tokens indexed 0..31 in a single flat line */
          ctx.reveal(G, { from: 'scale', s0: 0.92 });
          return ctx.wait(900).then(function () {
            return ctx.reveal(flatNote, { from: 'up' });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: three ids per token; dials appear */
            ctx.fade(flatNote, 0, 300);
            ctx.fade(flatLab, 0, 400);
            ctx.reveal(triLab, { stagger: 15, dur: 400 });
            ctx.reveal(dials.map(function (d) { return d.g; }).concat([dialLab]), { from: 'left', stagger: 150, delay: 400 });
            ctx.fade(hl, 1, 400);
            S.mrSeq = [12, 4, 7, 14];
            return ctx.wait(2400);
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: how the ids drive rotation: equation and section split */
            ctx.reveal(fv, { from: 'left', dur: 700 });
            ctx.reveal([eqA, eqB, eqC], { from: 'up', stagger: 200, delay: 300 });
            ctx.reveal(fl, { delay: 900, stagger: 150 });
            S.mrSeq = [12, 6, 20];
            return ctx.wait(2200);
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: text tokens */
            ctx.reveal(gl.text, { stagger: 150 });
            S.mrSeq = [0, 1, 2, 12, 31];
            return ctx.wait(2400);
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: image tokens */
            ctx.reveal(gl.image, {});
            S.mrSeq = [3, 4, 5, 6, 7, 8, 9, 10, 11];
            return ctx.wait(3200);
          }).then(function () {
            return ctx.beat(5);
          }).then(function () {
            /* beat 5: video tokens advance in time */
            ctx.reveal(gl.video, { stagger: 150 });
            S.mrSeq = [13, 17, 21, 22, 26, 30];
            return ctx.wait(3200);
          });
        }
      },

      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Late vs early fusion',
        beats: [
          {
            say: 'Everything so far is late fusion: separately pretrained encoders glued to a language model with adapters.',
            card: { tag: 'KEY IDEA', title: 'Late fusion glues parts', body: 'Pixels go through a pretrained ViT and an MLP. The LLM sees continuous soft tokens that are not in its vocabulary.' },
            deep: '<table><tr><th></th><th>Late fusion (adapter)</th></tr>' +
              '<tr><td>visual input</td><td>continuous ViT features</td></tr>' +
              '<tr><td>example</td><td>LLaVA, Qwen2.5-VL, InternVL3, Gemma 3</td></tr>' +
              '<tr><td>can emit images</td><td>no (needs a separate generator)</td></tr>' +
              '<tr><td>fine detail / OCR</td><td>strong</td></tr>' +
              '<tr><td>training cost</td><td>reuse pretrained parts</td></tr></table>' +
              '<p>Soft tokens are real-valued vectors that never appear in the embedding table, so the LLM can read images but has no way to <i>write</i> one.</p>'
          },
          {
            say: 'The alternative is early fusion. Chameleon turns images into discrete codes with a vector quantized tokenizer and adds those codes to the vocabulary.',
            card: { tag: 'NUMBERS', title: 'Images as discrete tokens', stat: { v: '1,024', u: 'codes', l: 'per 512² image from an 8,192-entry VQ codebook, added to the text vocabulary' }, more: '<p>Chameleon\'s unified vocabulary has 65,536 entries: text BPE tokens plus the 8,192 image codes plus specials. Image ids are just more token ids; loss and sampling are shared.</p>' },
            deep: '<p>Chameleon: a VQ tokenizer maps 512×512 → 1024 codes from an 8192-entry codebook; unified vocabulary of 65,536. The <i>same</i> transformer, embedding table and softmax handle text and image ids.</p>' +
              '<div class="eq">z = Enc(x) ∈ ℝ<sup>32×32×d</sup>,&nbsp; k<sub>ij</sub> = argmin<sub>c</sub> ‖z<sub>ij</sub> − e<sub>c</sub>‖,&nbsp; ids = (k<sub>ij</sub>)</div>' +
              '<p>Quantisation is lossy: fine detail such as small text and thin strokes is discarded at the tokenizer, before the transformer ever sees it.</p>'
          },
          {
            say: 'One transformer is then trained from scratch on interleaved sequences, so it can both read and write images.',
            card: { tag: 'KEY IDEA', title: 'One model reads and writes', body: 'Because images are ordinary vocabulary ids, the same model can also sample them autoregressively and decode them back to pixels.' },
            deep: '<p>Training from scratch on trillions of interleaved tokens (Chameleon reports about 9.2 T) gives a single model with one vocabulary, one loss and any interleaving of text and images. Generation runs the loop backwards: sample 1024 image ids, hand them to the VQ decoder, get pixels.</p>' +
              '<p>The price: stability. Chameleon needed QK-Norm and z-loss (plus layer-norm re-ordering) to train at scale, and from-scratch training discards the pretrained ViT/LLM parts that late fusion reuses.</p>'
          },
          {
            say: 'Late fusion is cheaper and stronger at perception today, while early fusion unifies understanding with generation. This system uses late fusion to understand, and a separate video model to generate.',
            card: { tag: 'TRADE-OFF', title: 'Perception vs unification', body: 'Late fusion wins on cost, OCR and detail. Early fusion wins on one model doing both directions. Hybrids try to have both.' },
            deep: '<table><tr><th></th><th>Late</th><th>Early</th></tr>' +
              '<tr><td>can emit images</td><td>no</td><td>yes</td></tr>' +
              '<tr><td>fine detail / OCR</td><td>strong</td><td>limited by tokenizer</td></tr>' +
              '<tr><td>training cost</td><td>reuse parts</td><td>from scratch</td></tr></table>' +
              '<p><b>Hybrids</b>: Janus-Pro decouples a SigLIP encoder for understanding from a VQ tokenizer for generation; Transfusion and BAGEL keep a single backbone but generate images with a diffusion or rectified-flow objective on continuous latents.</p>' +
              '<div class="note">This system uses late fusion for <i>understanding</i> and a dedicated latent video DiT for <i>generation</i> (see the Video Generation chamber). They communicate through text prompts, reference images and embeddings.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.mrLoop) S.mrLoop.stop();
          ctx.remove(S.mr, 400);
          S.fu = card(ctx, 180, 215, 1120, 490, 'Late fusion vs early fusion', 'violet');
          var G = S.fu;
          ctx.focus([S.fu], 0.1);
          function chain(xs, names, col, y) {
            var ns = names.map(function (n, i) { return ctx.node({ x: xs[i], y: y, w: 92, h: 40, title: n, color: i === 3 ? 'amber' : col, titleSize: 12, kind: 'box', glow: false, parent: G }); });
            var ls = [];
            for (var i = 0; i < ns.length - 1; i++) ls.push(ctx.link(ns[i], ns[i + 1], { color: col, straight: true, parent: G }));
            return { ns: ns, ls: ls };
          }
          /* beat 0: late fusion */
          var divider = ctx.line(740, 260, 740, 690, { color: 'line', sw: 1, dash: '4 6', parent: G });
          var hA = ctx.text(210, 280, 'LATE FUSION · adapter', { size: 13, font: 'mono', weight: 700, color: 'violet', spacing: 1, parent: G });
          var A = chain([256, 360, 464, 574, 682], ['pixels', 'ViT', 'MLP', 'LLM', 'text'], 'violet', 335);
          var lateExtra = ctx.group({ parent: G });
          ctx.text(412, 372, 'continuous ℝ³⁵⁸⁴ vectors', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: lateExtra });
          var rc = ctx.rng(15);
          ctx.matrix(210, 400, 2, 24, { cell: 12, gap: 3, cmap: 'violet', values: function () { return 0.15 + 0.8 * rc(); }, parent: lateExtra });
          ctx.text(580, 414, 'soft tokens ∉ vocab', { size: 11, font: 'mono', color: 'dim', parent: lateExtra });
          var prosA = ctx.para(210, 470, ['+ reuses strong pretrained encoders', '+ cheap: align projector, then unfreeze', '+ best perception and OCR today', '− reads images but cannot emit them', '− resolution and token budget fixed by design'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: G });
          var exA = ctx.text(210, 610, 'LLaVA · Qwen2.5-VL · InternVL3 · Gemma 3', { size: 12, font: 'mono', color: 'violet', parent: G });
          hide(A.ns.concat(A.ls)); hide([lateExtra, prosA, exA]);
          /* pre-build early fusion parts, hidden */
          var hB = ctx.text(770, 280, 'EARLY FUSION · native discrete tokens', { size: 13, font: 'mono', weight: 700, color: 'lime', spacing: 1, parent: G });
          var B = chain([818, 920, 1022, 1132, 1240], ['pixels', 'VQ enc', 'vocab', 'one TF', 'ids out'], 'lime', 335);
          var earlyExtra = ctx.group({ parent: G });
          ctx.text(971, 372, '1024 codes / 512² · K = 8192', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: earlyExtra });
          var r5 = ctx.rng(5);
          ctx.matrix(770, 440, 2, 24, { cell: 12, gap: 3, values: function () { return ctx.cmap('lime', 0.25 + 0.7 * r5()); }, parent: earlyExtra });
          ctx.text(1140, 454, 'image ids ∈ text vocab', { size: 11, font: 'mono', color: 'dim', parent: earlyExtra });
          var backG = ctx.group({ parent: G });
          var back = ctx.path('M1240,357 C1240,410 1160,410 1100,410', { stroke: 'lime', sw: 1.6, dash: '4 4', arrow: true, parent: backG });
          ctx.text(1090, 410, 'VQ dec → image', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: backG });
          var prosB = ctx.para(770, 510, ['+ one model reads AND writes images', '+ any interleaving, one loss, one vocab', '− VQ discards fine detail', '− from-scratch training, instabilities', '− needs QK-norm and z-loss to be stable'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: G });
          var exB = ctx.text(770, 640, 'Chameleon · Emu3 │ hybrids: Janus-Pro, BAGEL', { size: 12, font: 'mono', color: 'lime', parent: G });
          var verdict = ctx.text(210, 676, 'This system: late-fusion VLM for understanding + separate latent video DiT for generation.', { size: 13, color: 'amber', parent: G });
          hide([hB].concat(B.ns, B.ls, [earlyExtra, backG, prosB, exB, verdict]));
          ctx.reveal(G, { from: 'scale', s0: 0.92 });
          ctx.reveal([divider, hA], { delay: 200 });
          ctx.reveal(A.ns, { from: 'up', stagger: 100, delay: 300 });
          ctx.reveal(A.ls, { from: 'draw', stagger: 100, delay: 500 });
          ctx.reveal(lateExtra, { delay: 900 });
          return ctx.wait(900).then(function () {
            return A.ls.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'violet', dur: 350 }); }); }, Promise.resolve());
          }).then(function () {
            return ctx.reveal([prosA, exA], { from: 'up', stagger: 200 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: early fusion, discrete VQ codes */
            ctx.reveal(hB, { from: 'left' });
            ctx.reveal(B.ns, { from: 'up', stagger: 100, delay: 200 });
            ctx.reveal(B.ls, { from: 'draw', stagger: 100, delay: 400 });
            ctx.reveal(earlyExtra, { delay: 800 });
            return ctx.wait(900).then(function () {
              return B.ls.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'lime', dur: 350 }); }); }, Promise.resolve());
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the same model writes images back */
            ctx.reveal(backG, { delay: 100 });
            return ctx.reveal(back, { from: 'draw', dur: 700 }).then(function () {
              return ctx.packet(back, { color: 'lime', dur: 700 });
            }).then(function () {
              return ctx.reveal(prosB, { from: 'up' });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the verdict */
            ctx.reveal(exB, { from: 'up' });
            return ctx.reveal(verdict, { from: 'up', delay: 300 }).then(function () {
              return ctx.pulse(verdict, { color: 'amber', dur: 700 });
            });
          });
        }
      },

      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Token budgets',
        beats: [
          {
            say: 'Tokens are the currency. Fed naively, the sketches at full resolution plus every frame of the rendered shot would cost about one hundred and seventy thousand tokens, and attention cost grows with the square of that.',
            card: { tag: 'PITFALL', title: 'Naive input: 173k tokens', stat: { v: '173 k', u: 'tokens', l: 'full-res sketches + all 120 frames at 448² + 50 Hz audio + text' } },
            deep: '<table><tr><th>Input</th><th>Naive</th></tr>' +
              '<tr><td>3 sketches</td><td>3 × 2048·1536/14² ≈ 48 k</td></tr>' +
              '<tr><td>shot_03 (5 s)</td><td>120 fr × 1024 (each at 448²) = 122,880</td></tr>' +
              '<tr><td>memo (42 s)</td><td>50 Hz → 2100</td></tr>' +
              '<tr><td>text</td><td>60</td></tr>' +
              '<tr><td><b>total</b></td><td><b>≈ 173 k</b></td></tr></table>' +
              '<p>Self-attention is quadratic in sequence length, so 55× more tokens is roughly 3,000× more attention work. The naive prompt would not even fit: it exceeds the 131,072-token context window of Qwen2.5-7B.</p>'
          },
          {
            say: 'Resizing, sampling at two frames per second, two frame tubelets and two by two merging bring it down to about three thousand, roughly fifty five times fewer.',
            card: { tag: 'NUMBERS', title: 'Engineered input', stat: { v: '3,158', u: 'tokens', l: '≈ 55× fewer than naive: resize, 2 fps, 2-frame tubelets, 2×2 merge, 25 Hz audio' } },
            deep: '<table><tr><th>Input</th><th>Engineered</th></tr>' +
              '<tr><td>3 sketches</td><td>3 × (32²/4) = 768</td></tr>' +
              '<tr><td>shot_03 (5 s)</td><td>10 fr → 5 tubelets × 256 = 1280</td></tr>' +
              '<tr><td>memo (42 s)</td><td>25 Hz → 1050</td></tr>' +
              '<tr><td>text</td><td>60</td></tr>' +
              '<tr><td><b>total</b></td><td><b>3,158</b></td></tr></table>' +
              '<p>Typical per-image budgets: 256 tokens (448² + 2×2 merge) up to ~1,280 (the Qwen2.5-VL README suggests <code>max_pixels = 1280·28²</code>; the processor default is far higher, 16,384·28²); video frames get a smaller per-frame pixel cap so long clips fit.</p>'
          },
          {
            say: 'Prefill, the single pass that reads all of these tokens, then takes about a tenth of a second on one GPU, instead of more than twenty seconds for the naive version.',
            card: { tag: 'NUMBERS', title: 'Prefill time', stat: { v: '0.13 s', l: 'one H100 at ~40% MFU, versus ~22 s for the naive 173 k-token prompt' }, more: '<p>At 173 k tokens the quadratic attention term (6.0 PFLOP) already exceeds all the weight matmuls (2.6 PFLOP): the wall you hit is attention, not parameters.</p>' },
            deep: '<p>Cost for a 7.6 B, 28-layer, GQA (4 KV heads × 128) LLM, with d = 3584:</p>' +
              '<div class="eq">FLOPs ≈ 2·P·N + 2·L·d·N² (causal: FlashAttention skips masked tiles)</div>' +
              '<div class="eq">N = 3,158: 48 + 2 ≈ 50 TFLOP &nbsp;·&nbsp; N = 173 k: 2.6 + 6.0 ≈ 8.7 PFLOP</div>' +
              '<p>On an H100 (989 TFLOP/s dense BF16) at ~40% MFU: ~0.13 s vs ~22 s of prefill.</p>' +
              '<details><summary>Go deeper</summary><p>Where the two terms come from. Each of the L = 28 layers spends 2·(non-embedding params) FLOP per token on its matmuls, and 4·N·d per query token on QKᵀ plus AV, halved by the causal mask, giving 2·L·d·N² in total. P = 7.6 B also counts the 0.55 B input-embedding table (a lookup, no FLOPs) and the untied 0.55 B output head (applied to the last token only during prefill), so the matmul weight per prompt token is the 6.5 B non-embedding part and the linear term is ~15% lower. The estimate is deliberately upper-bound; the ratio between the two prompts (≈ 175×) is what matters.</p></details>'
          },
          {
            say: 'And the KV cache that the language model keeps for later turns stays under two hundred megabytes, instead of nearly ten gigabytes.',
            card: { tag: 'NUMBERS', title: 'KV cache footprint', stat: { v: '181 MB', l: 'at 56 KiB per token, versus 9.9 GB naive; small enough to keep resident for every agent turn' } },
            deep: '<div class="eq">KV bytes/token = 2 · L · h<sub>kv</sub> · d<sub>h</sub> · 2 B = 2 · 28 · 4 · 128 · 2 = 56 KiB</div>' +
              '<div class="eq">3,158 × 56 KiB ≈ 181 MB &nbsp;vs&nbsp; 173 k × 56 KiB ≈ 9.9 GB</div>' +
              '<p>GQA (4 KV heads instead of 28) is what keeps this small. Further levers: ToMe-style token merging inside the ViT, dynamic frame selection (keep frames where content changes), and pooling video tokens harder than images (LLaVA-Video, per-frame pixel budgets in Qwen2.5-VL).</p>' +
              '<div class="note">Because the sketches\' KV blocks are identical across turns, <b>prefix caching</b> makes the 181 MB a one-time cost.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.fu, 400);
          S.tb = card(ctx, 180, 215, 1120, 490, 'Token budget for the trailer request (log scale)', 'violet');
          var G = S.tb;
          ctx.focus([S.tb], 0.1);
          var x0 = 420, W = 800;
          function px(v) { return x0 + (Math.log(v) / Math.LN10) / 6 * W; }
          [1, 10, 100, 1000, 10000, 100000, 1000000].forEach(function (v, i) {
            var x = px(v);
            ctx.line(x, 268, x, 560, { color: 'line', sw: 1, dash: '2 5', parent: G });
            ctx.text(x, 578, ['1', '10', '100', '1k', '10k', '100k', '1M'][i], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          });
          var rows = [['3 sketches', 48149, 768, 'violet', 'full-res patches → 448² + 2×2 merge'], ['shot_03', 122880, 1280, 'lime', '24 fps → 2 fps, tubelets, merge'], ['voice memo', 2100, 1050, 'orange', '50 Hz → 25 Hz pooling'], ['prompt text', 60, 60, 'cyan', 'unchanged']];
          var anims = [], ghosts = [];
          rows.forEach(function (r, i) {
            var y = 300 + i * 66;
            ctx.text(400, y + 6, r[0], { size: 14, font: 'mono', color: 'text', anchor: 'end', parent: G });
            var gg = ctx.group({ parent: G });
            ctx.rect(x0, y - 12, px(r[1]) - x0, 12, { rx: 3, fill: 'rgba(255,255,255,0.08)', stroke: ctx.alpha('white', 0.25), sw: 1, parent: gg });
            ctx.text(px(r[1]) + 8, y - 6, r[1].toLocaleString('en-US'), { size: 11, font: 'mono', color: 'dim', parent: gg });
            ghosts.push(gg);
            var b = ctx.rect(x0, y + 4, px(r[1]) - x0, 16, { rx: 3, fill: ctx.alpha(r[3], 0.55), stroke: r[3], sw: 1, parent: G });
            var lab = ctx.text(px(r[1]) + 8, y + 12, r[1].toLocaleString('en-US'), { size: 12, font: 'mono', color: r[3], weight: 600, parent: G });
            ctx.text(x0, y + 34, r[4], { size: 11, font: 'mono', color: 'dim', parent: G });
            anims.push({ b: b, lab: lab, from: r[1], to: r[2] });
          });
          hide(ghosts);
          var tot = ctx.text(420, 606, 'naive total 173,189 tokens', { size: 16, font: 'mono', color: 'white', weight: 600, parent: G });
          /* prefill and KV rows (log bars) */
          function mrow(y, name, vN, vE, lo, txN, txE, formula) {
            var g = ctx.group({ parent: G });
            var L = function (v) { return 400 * Math.log(v / lo) / Math.LN10 / 3; };
            ctx.text(400, y + 4, name, { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: g });
            ctx.rect(x0, y - 8, Math.max(3, L(vN)), 8, { rx: 3, fill: ctx.alpha('red', 0.5), stroke: 'red', sw: 1, parent: g });
            ctx.text(x0 + L(vN) + 8, y - 4, txN, { size: 12, font: 'mono', color: 'red', parent: g });
            ctx.rect(x0, y + 4, Math.max(3, L(vE)), 8, { rx: 3, fill: ctx.alpha('amber', 0.6), stroke: 'amber', sw: 1, parent: g });
            ctx.text(x0 + Math.max(3, L(vE)) + 8, y + 8, txE, { size: 12, font: 'mono', color: 'amber', weight: 600, parent: g });
            ctx.text(870, y, formula, { size: 12, font: 'mono', color: 'dim', parent: g });
            return g;
          }
          var rowP = mrow(640, 'prefill time', 22, 0.13, 0.1, 'naive ≈ 22 s', '≈ 0.13 s', '2PN + 2LdN² : 50 TFLOP vs 8.7 PFLOP');
          var rowK = mrow(676, 'KV cache', 9.9, 0.181, 0.1, 'naive ≈ 9.9 GB', '≈ 181 MB', '56 KiB / token · GQA, 4 KV heads');
          hide([rowP, rowK]);

          /* beat 0: the naive bill */
          ctx.reveal(G, { from: 'scale', s0: 0.92 });
          ctx.hud('naive context: 173k tokens');
          return ctx.wait(700).then(function () {
            return ctx.pulse(tot, { color: 'red', times: 2, dur: 600 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the engineered budget, bars shrink against the naive marks */
            ctx.reveal(ghosts, { stagger: 100, dur: 300 });
            ctx.hud('context 173k → 3.2k tokens (~55× less)');
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
            }, 'inOut', 500).then(function () {
              tot.textContent = 'total 173,189 → 3,158 tokens  (~55× fewer)';
              return ctx.wait(500);
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: prefill time */
            return ctx.reveal(rowP, { from: 'up' }).then(function () { return ctx.pulse(rowP, { color: 'amber', dur: 700 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: KV cache */
            return ctx.reveal(rowK, { from: 'up' }).then(function () { return ctx.pulse(rowK, { color: 'amber', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 9 */
      {
        title: 'Reference analysis',
        beats: [
          {
            say: 'The output of this stage is not prose but a structured reference analysis that other agents can consume: the fox\'s identity traits, a colour palette taken from the sketches, and style descriptors.',
            card: { tag: 'KEY IDEA', title: 'Structure, not prose', body: 'The VLM answers against a JSON schema. Grammar-constrained decoding guarantees the output parses, so downstream agents never scrape free text.' },
            deep: '<p>The understanding agent asks the VLM for JSON that matches a schema; <b>grammar-constrained decoding</b> guarantees it parses. Measurable quantities are not left to the LLM: the agent calls tools.</p>' +
              '<ul><li><b>palette</b>: k-means (k = 4) in CIELAB over sketch pixels — a tool, not a guess.</li>' +
              '<li><b>identity_ref</b>: a grounded crop box predicted by the VLM (Qwen2.5-VL emits absolute pixel boxes), later fed to the video model as a reference image.</li></ul>'
          },
          {
            say: 'Alongside it come the narrator\'s voice profile, measured from the memo, and the critic\'s verdict on shot three, with the exact seconds where the visor flickers.',
            card: { tag: 'HOW IT WORKS', title: 'Numbers come from tools', body: 'Voice and critic fields are computed, not imagined: an ECAPA speaker embedding, pitch and rate, and SigLIP cosine similarities.' },
            deep: '<ul><li><b>voice</b>: speaker embedding (ECAPA-TDNN, 192-d) + f0 via pYIN + speaking rate from ASR timestamps.</li>' +
              '<li><b>critic scores</b>: cosine similarities in SigLIP space between shot frames and the identity crop / sketches.</li></ul>' +
              '<p>Known failure modes of VLM perception: hallucinated attributes, counting, small text, left/right confusion, temporal ordering in long videos. Mitigations: re-query on zoomed crops, higher pixel budgets for detail questions, and cross-checking with embedding similarity.</p>'
          },
          {
            say: 'The embeddings are also written to vector memory, so later shots can retrieve the fox and the style by similarity.',
            card: { tag: 'WHY IT MATTERS', title: 'Memory keeps shots consistent', body: 'Reference embeddings persist beyond this prompt: every later shot can query the same fox, palette and voice.' },
            deep: '<p>SigLIP image embeddings (1152-d) of the reference crops and ECAPA voice vectors (192-d) are indexed in the vector store (HNSW). The storyboard and video agents query them by text or by image, so identity is <i>retrieved</i>, not re-described in words that drift from shot to shot.</p>' +
              '<p>Sizing: a 1152-d float16 vector is 2.3 kB, so even 10<sup>6</sup> keyframes and crops are ~2.3 GB plus the graph. An HNSW index (for example M = 16, efSearch in the tens to low hundreds) typically answers a top-k query in milliseconds at high recall, and each modality gets its own index because image–text and image–image cosines live on different scales (see the Contrastive Alignment chamber).</p>'
          },
          {
            say: 'To see how each piece works inside, zoom into the vision encoder, the audio encoder, or contrastive alignment.',
            card: { tag: 'TRY IT', title: 'Zoom into any encoder', body: 'Click the violet dashed boxes: <b>Vision Encoders</b> follows one sketch through the ViT, <b>Audio Encoding</b> the memo, <b>Contrastive Alignment</b> the loss.' },
            deep: '<p>Everything downstream of this chamber consumes the analysis rather than the raw media: the storyboard agent reads the palette and identity crop, the TTS agent reads the voice profile, the critic reads the similarity scores, and the video model receives the reference crops.</p>' +
              '<div class="note">Zoom deeper: <b>Vision Encoders</b> (patches, NaViT, tubelets, merging), <b>Audio Encoding</b> (log-mel, Whisper, RVQ codecs, speaker embeddings), <b>Contrastive Alignment</b> (CLIP / SigLIP losses).</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.tb, 400);
          ctx.focus(null);
          lit(ctx, S, 5);
          S.json = ctx.code({ x: 770, y: 222, w: 540, title: 'reference_analysis.json', lang: 'json', color: 'violet', size: 12, typing: true, maxLines: 11 });
          var nbsp = function (s) { return s.replace(/ {2,}/g, function (m) { return new Array(m.length + 1).join(' '); }); };
          var l1 = [
            '{ "character": { "species": "red fox", "role": "astronaut",',
            '    "suit": "white EVA, orange trim", "visor": "cracked",',
            '    "identity_ref": "sketch_2.png#box=634,184,1188,1090" },',
            '  "palette": ["#0B1E3F", "#6FE3FF", "#FF7A2F", "#E8F4FF"],',
            '  "style": ["painterly concept art", "rim light", "2.39:1",',
            '            "volumetric ice haze", "low heroic angle"],'
          ].map(nbsp);
          var l2 = [
            '  "voice": { "speaker_emb": "mem://voice/memo#ecapa192",',
            '    "f0_median_hz": 118, "rate_wpm": 142,',
            '    "timbre": "warm, slightly breathy" },',
            '  "critic": { "shot_03": { "identity_sim": 0.81,',
            '    "style_sim": 0.74, "fix": "visor flicker 3.1-3.6 s" } } }'
          ].map(nbsp);
          function type(lines) { return lines.reduce(function (p, s) { return p.then(function () { return S.json.addLine(s); }); }, Promise.resolve()); }
          ctx.focus([S.json, S.llm, S.llmIn, S.vit, S.aud, S.con, S.head], 0.25);
          S.mem = ctx.node({ x: 1040, y: 640, w: 210, h: 62, kind: 'cyl', title: 'Vector Memory', sub: 'SigLIP / ECAPA embeddings', color: 'teal', titleSize: 14, subSize: 10 });
          S.memL = ctx.link(S.con, S.mem, { from: 'r', to: 'l', color: 'teal', dash: '4 5', label: 'index refs', labelDy: -12 });
          hide([S.mem, S.memL]); S.memL.labelEl.setAttribute('opacity', 0);

          /* beat 0: character, palette, style */
          ctx.reveal(S.json, { from: 'right' });
          return type(l1).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: voice and critic fields */
            return type(l2).then(function () { return ctx.pulse(S.json, { color: 'violet', dur: 700 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: written to vector memory */
            ctx.reveal([S.mem, S.memL], { from: 'fade', stagger: 200 });
            ctx.reveal(S.memL.labelEl, { delay: 500 });
            return ctx.wait(800).then(function () { return ctx.packet(S.memL, { color: 'teal', dur: 900, label: 'embeddings' }); })
              .then(function () { return ctx.pulse(S.mem, { color: 'teal', times: 2, dur: 700 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: three children to open */
            return sweep(ctx, [S.vit, S.aud, S.con], { color: 'violet', dur: 700 });
          });
        }
      }
    ]
  });
})();
