/* L2 — Contrastive Alignment. CLIP / SigLIP: two towers, one shared embedding space; how it is trained and how this system uses it.
 * Beat format: each step = beats (narration, callout card, deep-dive chunk, gated animation segment). */
(function () {
  var N = 6;
  var CAPS = ['a fox astronaut on an ice moon', 'a glowing ice moon at night', 'a rocket crash-landing in snow', 'a cat asleep on a sofa', 'a neon city skyline in rain', 'a misty pine forest'];
  /* illustrative cosine similarities (CLIP-like scale: matched pairs ~0.3, unrelated ~0.05-0.1) */
  var COS = [
    [0.34, 0.24, 0.21, 0.08, 0.06, 0.07],
    [0.22, 0.33, 0.12, 0.05, 0.09, 0.08],
    [0.19, 0.11, 0.31, 0.04, 0.10, 0.09],
    [0.07, 0.05, 0.04, 0.32, 0.11, 0.06],
    [0.06, 0.10, 0.08, 0.09, 0.35, 0.07],
    [0.08, 0.09, 0.10, 0.06, 0.07, 0.30]
  ];
  var TX0 = 76, ROW0 = 292, PITCH = 84;         /* thumbnails column and row pitch */
  var MX = 520, MY = 256, CELL = 72;             /* similarity matrix: cells 72, pitch 84 */

  function rowY(i) { return ROW0 + i * PITCH; }
  function colX(j) { return MX + CELL / 2 + j * PITCH; }

  function softmax(v, s) {
    var m = Math.max.apply(null, v), e = v.map(function (x) { return Math.exp((x - m) * s); }), z = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (x) { return x / z; });
  }
  function col(j) { return COS.map(function (r) { return r[j]; }); }
  function sig(x) { return 1 / (1 + Math.exp(-x)); }
  function clipLoss(s) {
    var L = 0;
    for (var i = 0; i < N; i++) { L -= Math.log(softmax(COS[i], s)[i]); L -= Math.log(softmax(col(i), s)[i]); }
    return L / (2 * N);
  }
  function hide(list) { list.forEach(function (e) { e.setAttribute('opacity', 0); }); }

  /* six tiny concept thumbnails (84 x 60) */
  function thumb(ctx, parent, k, x, y) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, 84, 60, { rx: 5, fill: '#08112a', stroke: ctx.alpha('violet', 0.6), sw: 1, parent: g });
    var cx = x + 42, cy = y + 30;
    if (k === 0) {
      ctx.path('M' + x + ',' + (y + 52) + ' Q' + cx + ',' + (y + 42) + ' ' + (x + 84) + ',' + (y + 52) + ' V' + (y + 60) + ' H' + x + ' Z', { fill: ctx.alpha('cyan', 0.3), parent: g });
      ctx.circle(cx, cy - 4, 13, { stroke: 'white', sw: 1.2, fill: ctx.alpha('cyan', 0.12), parent: g });
      ctx.poly([[cx - 8, cy], [cx - 7, cy - 13], [cx - 3, cy - 8], [cx + 3, cy - 8], [cx + 7, cy - 13], [cx + 8, cy], [cx, cy + 5]], { fill: 'orange', parent: g });
      ctx.rect(cx - 7, cy + 9, 14, 12, { rx: 3, fill: '#dfe9ff', parent: g });
    } else if (k === 1) {
      ctx.circle(cx, cy, 20, { fill: ctx.alpha('cyan', 0.35), stroke: 'cyan', sw: 1.2, parent: g, glow: true });
      ctx.circle(cx - 6, cy - 5, 4, { stroke: ctx.alpha('white', 0.6), sw: 1, parent: g });
      ctx.circle(cx + 7, cy + 6, 3, { stroke: ctx.alpha('white', 0.6), sw: 1, parent: g });
    } else if (k === 2) {
      ctx.rect(x, y + 48, 84, 12, { rx: 0, fill: ctx.alpha('white', 0.35), parent: g });
      ctx.poly([[cx + 16, cy - 18], [cx + 4, cy + 8], [cx - 2, cy + 3]], { fill: '#c8d4ea', parent: g });
      ctx.poly([[cx - 2, cy + 3], [cx + 4, cy + 8], [cx - 14, cy + 20]], { fill: 'orange', parent: g });
    } else if (k === 3) {
      ctx.rect(x + 10, y + 34, 64, 18, { rx: 6, fill: ctx.alpha('red', 0.45), parent: g });
      ctx.circle(cx, cy - 2, 11, { fill: '#9aa7bd', parent: g });
      ctx.poly([[cx - 10, cy - 6], [cx - 8, cy - 17], [cx - 2, cy - 11]], { fill: '#9aa7bd', parent: g });
      ctx.poly([[cx + 10, cy - 6], [cx + 8, cy - 17], [cx + 2, cy - 11]], { fill: '#9aa7bd', parent: g });
    } else if (k === 4) {
      [[6, 30], [18, 18], [30, 36], [44, 12], [58, 26], [70, 20]].forEach(function (b, i) {
        ctx.rect(x + b[0], y + b[1], 11, 60 - b[1], { rx: 1, fill: ctx.alpha(i % 2 ? 'pink' : 'cyan', 0.55), parent: g });
      });
    } else {
      [[16, 1], [34, 0.8], [52, 1.1], [68, 0.9]].forEach(function (t) {
        ctx.poly([[x + t[0], y + 54 - 40 * t[1]], [x + t[0] - 11, y + 54], [x + t[0] + 11, y + 54]], { fill: ctx.alpha('lime', 0.55), parent: g });
      });
    }
    return g;
  }
  function card(ctx, x, y, w, h, title, colr) {
    var g = ctx.group();
    ctx.rect(x, y, w, h, { rx: 14, fill: 'rgba(5,10,22,0.96)', stroke: colr || 'violet', sw: 1.4, parent: g, glow: true });
    if (title) ctx.text(x + 24, y + 30, title, { size: 17, font: 'display', weight: 700, color: 'white', parent: g });
    return g;
  }
  function nb(s) { return s.replace(/ {2,}/g, function (m) { return new Array(m.length + 1).join(' '); }); }

  Atlas.register({
    id: 'contrastive',
    poster: 1,
    refs: [
      'Radford et al., <i>Learning Transferable Visual Models From Natural Language Supervision (CLIP)</i>, ICML 2021',
      'van den Oord et al., <i>Representation Learning with Contrastive Predictive Coding</i> (InfoNCE), 2018',
      'Zhai et al., <i>Sigmoid Loss for Language Image Pre-Training (SigLIP)</i>, ICCV 2023; Tschannen et al., <i>SigLIP 2: Multilingual Vision-Language Encoders with Improved Semantic Understanding, Localization, and Dense Features</i>, 2025',
      'Wang &amp; Isola, <i>Understanding Contrastive Representation Learning through Alignment and Uniformity on the Hypersphere</i>, ICML 2020',
      'Liang et al., <i>Mind the Gap: Understanding the Modality Gap in Multi-modal Contrastive Representation Learning</i>, NeurIPS 2022',
      'Hessel et al., <i>CLIPScore: A Reference-free Evaluation Metric for Image Captioning</i>, EMNLP 2021',
      'Yuksekgonul et al., <i>When and Why Vision-Language Models Behave like Bags-of-Words, and What to Do About It?</i>, ICLR 2023',
      'Team Wan et al., <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025',
      'Kong et al., <i>HunyuanVideo: A Systematic Framework for Large Video Generative Models</i>, arXiv 2412.03603, 2024'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Two towers',
        beats: [
          {
            say: 'Contrastive alignment is how a vision encoder learns to speak language in the first place. Take a batch of images and their captions, scraped from the web.',
            card: { tag: 'KEY IDEA', title: 'Web pairs are the supervision', body: 'Hundreds of millions to billions of scraped image and caption pairs. No class labels and no boxes: the pairing itself is the label.' },
            deep: '<p>Contrastive vision-language pretraining needs nothing but <b>(image, alt-text) pairs</b> found on the web, which is why it scales to billions of examples where human-labelled datasets stop at millions.</p>' +
              '<table><tr><th></th><th>CLIP (2021)</th><th>SigLIP / SigLIP 2</th></tr>' +
              '<tr><td>data</td><td>400 M pairs (WIT)</td><td>WebLI, ~10 B images (SigLIP 2: 12 B alt-texts, 109 languages)</td></tr></table>' +
              '<p>Captions are noisy and loosely aligned (alt-text says "IMG_2043" as often as it describes the picture); scale and filtering average that noise away.</p>'
          },
          {
            say: 'An image encoder and a separate text encoder each turn their input into a single vector.',
            card: { tag: 'HOW IT WORKS', title: 'Two towers, one width', body: 'A ViT and a text Transformer never see each other\'s input. Each ends in a linear projection to the same width d.', more: '<p>Pooling: the image vector is the [CLS] token, or SigLIP\'s attention-pooling "MAP" head; the text vector is the [EOS] token (CLIP) or the last-token pooled output. Widths: CLIP ViT-L/14 uses d = 768, SigLIP so400m uses 1152.</p>' },
            deep: '<p><b>Dual encoder</b>: image tower f (ViT) and text tower g (Transformer), each followed by a linear projection to a shared width d (CLIP ViT-L/14: d = 768; SigLIP so400m: 1152).</p>' +
              '<div class="eq">x<sub>i</sub> = f(I<sub>i</sub>) ∈ ℝ<sup>d</sup>, &nbsp; y<sub>i</sub> = g(T<sub>i</sub>) ∈ ℝ<sup>d</sup></div>' +
              '<p>Image vector = pooled output ([CLS] token, or SigLIP\'s attention-pooling "MAP" head); text vector = the [EOS] token (CLIP) or last-token pooled output.</p>'
          },
          {
            say: 'Nothing tells the model what a fox is. The only signal is which caption belongs to which image.',
            card: { tag: 'KEY IDEA', title: 'Which goes with which', body: 'Caption 1 belongs to image 1 and to no other image. That single fact, repeated billions of times, is all the model gets.' },
            deep: '<div class="note">The towers never see each other\'s input: at inference you can embed millions of images offline and match them to any new text in one dot product, the property that makes retrieval and zero-shot classification cheap.</div>' +
              '<p>The supervision is <i>relative</i>: the loss never says "this is a fox", only "this caption fits this image better than any other caption in the batch". Concepts such as fox, ice and helmet emerge because they are the features that best solve the matching game.</p>'
          },
          {
            say: 'Our batch has six pairs, starting with a fox astronaut on an ice moon. Real training batches hold thirty two thousand.',
            card: { tag: 'NUMBERS', title: 'Batch size', stat: { v: '32,768', u: 'pairs', l: 'per CLIP training batch (2^15). This figure shows N = 6' } },
            deep: '<table><tr><th></th><th>CLIP (2021)</th><th>SigLIP / SigLIP 2</th></tr>' +
              '<tr><td>batch</td><td>32,768</td><td>32 k typical (up to 1 M studied)</td></tr>' +
              '<tr><td>loss</td><td>softmax InfoNCE</td><td>pairwise sigmoid</td></tr></table>' +
              '<p>Every other pair in the batch acts as a free <b>negative</b>, so a bigger batch means more and harder negatives per step. That is why the next steps care so much about how the loss scales with N.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.imgs = ctx.group(); S.thumbs = [];
          for (var i = 0; i < N; i++) S.thumbs.push(thumb(ctx, S.imgs, i, TX0, rowY(i) - 30));
          S.caps = ctx.group(); S.capRows = [];
          CAPS.forEach(function (c, i) {
            var g = ctx.group({ parent: S.caps });
            ctx.rect(1236, rowY(i) - 17, 304, 34, { rx: 8, fill: ctx.alpha('cyan', 0.08), stroke: ctx.alpha('cyan', 0.55), sw: 1, parent: g });
            ctx.text(1250, rowY(i), '"' + c + '"', { size: 13, font: 'mono', color: 'cyan', parent: g });
            S.capRows.push(g);
          });
          S.fI = ctx.node({ x: 262, y: 502, w: 116, h: 470, title: 'f(image)', sub: 'ViT', color: 'violet', titleSize: 15, subSize: 12 });
          S.gT = ctx.node({ x: 1158, y: 502, w: 116, h: 470, title: 'g(text)', sub: 'Transformer', color: 'cyan', titleSize: 15, subSize: 12 });
          var r = ctx.rng(3);
          S.xv = []; S.yv = [];
          S.eL = ctx.group();
          for (var k = 0; k < N; k++) {
            S.xv.push(ctx.vector(338, rowY(k) - 6, 7, { horizontal: true, cell: 9, gap: 2, cmap: 'violet', values: function () { return 0.2 + 0.8 * r(); }, parent: S.eL }));
            S.yv.push(ctx.vector(1022, rowY(k) - 6, 7, { horizontal: true, cell: 9, gap: 2, cmap: 'cyan', values: function () { return 0.2 + 0.8 * r(); }, parent: S.eL }));
          }
          S.xLab = ctx.text(372, 242, 'x_i ∈ ℝᵈ', { size: 13, font: 'mono', color: 'violet', anchor: 'middle', parent: S.eL });
          S.yLab = ctx.text(1056, 242, 'y_i ∈ ℝᵈ', { size: 13, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.eL });
          S.batchTx = [
            ctx.text(766, 502, 'batch of N = 6 (image, caption) pairs', { size: 16, color: 'dim', anchor: 'middle' }),
            ctx.text(766, 528, 'the only supervision: which caption goes with which image', { size: 13, font: 'mono', color: 'dim', anchor: 'middle' })
          ];
          hide([S.fI, S.gT, S.eL, S.batchTx[0], S.batchTx[1]]);
          hide(S.xv); hide(S.yv);

          /* beat 0: a batch of web pairs */
          ctx.reveal(S.imgs, { from: 'left' });
          ctx.reveal(S.caps, { from: 'right', delay: 200 });
          return ctx.reveal(S.batchTx[0], { delay: 500 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: two towers, one vector per item */
            ctx.reveal([S.fI, S.gT], { from: 'scale', stagger: 150 });
            ctx.reveal(S.eL, { delay: 700 });
            return ctx.wait(1000).then(function () {
              return ctx.reveal(S.xv.concat(S.yv), { from: 'scale', stagger: 90 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the only supervision is the pairing */
            S.badges = ctx.group();
            for (var b = 0; b < N; b++) {
              [TX0 - 20, 1556].forEach(function (x) {
                ctx.circle(x, rowY(b), 10, { fill: '#1a1206', stroke: 'amber', sw: 1.4, parent: S.badges });
                ctx.text(x, rowY(b), String(b + 1), { size: 11, font: 'mono', color: 'amber', anchor: 'middle', weight: 600, parent: S.badges });
              });
            }
            S.pairHl = [ctx.highlight(S.thumbs[0], { color: 'amber', pad: 5 }), ctx.highlight(S.capRows[0], { color: 'amber', pad: 5 })];
            ctx.reveal(S.batchTx[1], { from: 'up' });
            return ctx.reveal(S.badges, { stagger: 0, dur: 500 }).then(function () {
              return Promise.all([ctx.pulse(S.thumbs[0], { color: 'amber', dur: 700 }), ctx.pulse(S.capRows[0], { color: 'amber', dur: 700 })]);
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: 6 pairs here, 32,768 in real training */
            S.nTxG = ctx.group();
            ctx.text(766, 590, 'this figure: N = 6', { size: 15, font: 'mono', color: 'dim', anchor: 'middle', parent: S.nTxG });
            var big = ctx.text(766, 640, 'CLIP training: N = 6', { size: 26, font: 'display', weight: 700, color: 'amber', anchor: 'middle', parent: S.nTxG });
            return ctx.reveal(S.nTxG, { from: 'up' }).then(function () {
              return ctx.counter(big, 6, 32768, 1800, function (v) { return 'CLIP training: N = ' + Math.round(v).toLocaleString('en-US'); });
            }).then(function () { return ctx.pulse(big, { color: 'amber', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Unit hypersphere',
        beats: [
          {
            say: 'Both vectors are L two normalised, which puts every image and every caption on the surface of the same unit hypersphere.',
            card: { tag: 'KEY IDEA', title: 'Only direction matters', body: 'Dividing each embedding by its length puts images and captions on one unit sphere. Norms carry no information any more.' },
            deep: '<div class="eq">x̂ = x / ‖x‖₂, &nbsp; ŷ = y / ‖y‖₂</div>' +
              '<p>Why normalise? Without it the model can lower the loss by inflating norms instead of learning directions; with it, the only free scale is the learned temperature.</p>' +
              '<p>Every embedding now lives on <code>S<sup>d−1</sup></code>, the unit sphere in ℝ<sup>d</sup> (d = 768 for CLIP ViT-L, 1152 for SigLIP so400m).</p>'
          },
          {
            say: 'After that, similarity is just a dot product: the cosine of the angle between two points.',
            card: { tag: 'HOW IT WORKS', title: 'Similarity is a dot product', body: 'For unit vectors x̂·ŷ = cos θ ∈ [−1, 1]. One matrix multiply compares a whole batch against a whole batch.' },
            deep: '<div class="eq">s<sub>ij</sub> = x̂<sub>i</sub>·ŷ<sub>j</sub> = cos θ<sub>ij</sub> ∈ [−1, 1]</div>' +
              '<p>Normalisation also makes nearest-neighbour search equivalent under inner product, cosine and Euclidean distance:</p>' +
              '<div class="eq">‖x̂ − ŷ‖² = 2 − 2 x̂·ŷ</div>' +
              '<p>So a vector database can use any of the three metrics on these embeddings and return identical rankings.</p>'
          },
          {
            say: 'Training will pull each image toward its own caption and push it away from everybody else\'s.',
            card: { tag: 'KEY IDEA', title: 'Pull pairs, push the rest', body: 'The loss shrinks the angle of matched pairs and grows the angle to every mismatched caption.' },
            deep: '<div class="note">Alignment and uniformity (Wang &amp; Isola, 2020): contrastive losses optimise both. Matched pairs are pulled close (alignment), and all embeddings are spread evenly over the sphere (uniformity), so no region collapses.</div>' +
              '<p>The push term acts hardest on the negatives that are currently <i>closest</i>: the fox image is nearer to "ice moon" than to "cat on a sofa", so it is pushed from the moon caption first.</p>'
          },
          {
            say: 'In the picture, a two dimensional circle stands in for a sphere in more than a thousand dimensions.',
            card: { tag: 'NUMBERS', title: 'Random pairs are orthogonal', stat: { v: '± 0.03', l: 'spread of cosine between two random unit vectors in ℝ¹¹⁵², about 1/√1152' } },
            deep: '<p>Geometry in high dimension is unintuitive: two random unit vectors in ℝ<sup>1152</sup> have cos ≈ 0 ± 1/√1152 ≈ ±0.03. That is why CLIP cosines of 0.30 for a correct pair versus 0.10 for a wrong one are a large margin, even though they look small.</p>' +
              '<div class="eq">cos θ ≈ 𝒩(0, 1/d) &nbsp;⇒&nbsp; 0.30 · √1152 ≈ 10 σ above chance</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.batchTx.concat([S.nTxG]), 0, 300);
          var cx = 766, cy = 492, R = 190;
          S.sph = ctx.group();
          ctx.circle(cx, cy, R, { stroke: ctx.alpha('white', 0.35), sw: 1.4, dash: '5 6', parent: S.sph });
          ctx.circle(cx, cy, 3, { fill: 'dim', parent: S.sph });
          var cap1 = ctx.text(cx, cy + R + 28, 'unit sphere (2-D stand-in for ℝ¹¹⁵²) · cos θ = x̂ · ŷ', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: S.sph });
          var ang = [-2.5, -1.75, -0.95, 0.15, 1.05, 2.05], r = ctx.rng(12), pts = [];
          for (var i = 0; i < N; i++) {
            [0, 1].forEach(function (m) {
              var a = ang[i] + (m ? 0.16 : -0.02), r0 = R * (0.45 + 0.9 * r());
              var dot = ctx.circle(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a), 7, { fill: m ? 'cyan' : 'violet', stroke: 'white', sw: 1, parent: S.sph });
              pts.push({ dot: dot, a: a, r0: r0, m: m, i: i });
            });
          }
          var rays = [];
          pts.forEach(function (p) { rays.push(ctx.line(cx, cy, cx + p.r0 * Math.cos(p.a), cy + p.r0 * Math.sin(p.a), { color: ctx.alpha(p.m ? 'cyan' : 'violet', 0.35), sw: 1, parent: S.sph })); });
          function at(p, rr) { return { x: cx + rr * Math.cos(p.a), y: cy + rr * Math.sin(p.a) }; }

          /* beat 0: embeddings of every length snap onto the unit sphere */
          ctx.hud('x̂ = x / ‖x‖  →  similarity = dot product');
          ctx.reveal(S.sph, { dur: 500 });
          return ctx.wait(700).then(function () {
            return ctx.tween(1600, function (t) {
              pts.forEach(function (p, i) {
                var rr = ctx.lerp(p.r0, R, t), q = at(p, rr);
                p.dot.setAttribute('cx', q.x.toFixed(1)); p.dot.setAttribute('cy', q.y.toFixed(1));
                rays[i].setAttribute('x2', q.x.toFixed(1)); rays[i].setAttribute('y2', q.y.toFixed(1));
              });
            }, 'inOut');
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the angle between the fox image and its caption is the similarity */
            var p0 = at(pts[0], R), p1 = at(pts[1], R), a0 = pts[0].a, a1 = pts[1].a, ar = 58;
            var wedge = ctx.group({ parent: S.sph });
            ctx.line(cx, cy, p0.x, p0.y, { color: 'violet', sw: 2.4, parent: wedge });
            ctx.line(cx, cy, p1.x, p1.y, { color: 'cyan', sw: 2.4, parent: wedge });
            ctx.path('M' + (cx + ar * Math.cos(a0)).toFixed(1) + ',' + (cy + ar * Math.sin(a0)).toFixed(1) + ' A' + ar + ',' + ar + ' 0 0 1 ' + (cx + ar * Math.cos(a1)).toFixed(1) + ',' + (cy + ar * Math.sin(a1)).toFixed(1), { stroke: 'amber', sw: 2, parent: wedge });
            ctx.text(cx + 86 * Math.cos((a0 + a1) / 2), cy + 86 * Math.sin((a0 + a1) / 2), 'θ', { size: 16, font: 'display', weight: 700, color: 'amber', anchor: 'middle', parent: wedge });
            S.pairs = [];
            for (var k = 0; k < N; k++) {
              var b0 = ang[k] - 0.02, b1 = ang[k] + 0.16;
              S.pairs.push(ctx.path('M' + (cx + R * Math.cos(b0)).toFixed(1) + ',' + (cy + R * Math.sin(b0)).toFixed(1) + ' A' + R + ',' + R + ' 0 0 1 ' + (cx + R * Math.cos(b1)).toFixed(1) + ',' + (cy + R * Math.sin(b1)).toFixed(1), { stroke: 'amber', sw: 3, parent: S.sph }));
            }
            S.lab = ctx.text(cx + (R + 18) * Math.cos(-2.45), cy + (R + 18) * Math.sin(-2.45), 'fox pair: cos 0.34', { size: 12, font: 'mono', color: 'amber', anchor: 'end', parent: S.sph });
            ctx.fade(rays, 0.12, 400);
            ctx.reveal(wedge, { dur: 500 });
            return ctx.reveal(S.pairs.concat([S.lab]), { from: 'fade', stagger: 120 });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: pull the matched pair together, push the near-miss captions away */
            ctx.remove(rays, 300);
            var f = at(pts[0], R), moon = at(pts[3], R), rocket = at(pts[5], R);
            S.force = ctx.group({ parent: S.sph });
            ctx.path('M' + f.x.toFixed(1) + ',' + f.y.toFixed(1) + ' L' + moon.x.toFixed(1) + ',' + moon.y.toFixed(1), { stroke: 'red', sw: 1.8, dash: '5 4', arrow: true, parent: S.force });
            ctx.path('M' + f.x.toFixed(1) + ',' + f.y.toFixed(1) + ' L' + rocket.x.toFixed(1) + ',' + rocket.y.toFixed(1), { stroke: 'red', sw: 1.8, dash: '5 4', arrow: true, parent: S.force });
            ctx.text(cx - 10, cy - 105, 'push apart', { size: 13, font: 'mono', color: 'red', anchor: 'middle', parent: S.force });
            ctx.text(cx - 175, cy - 185, 'pull together', { size: 13, font: 'mono', color: 'lime', anchor: 'middle', parent: S.force });
            ctx.reveal(S.force, { from: 'fade', dur: 600 });
            return ctx.wait(500).then(function () {
              return Promise.all([ctx.pulse(pts[0].dot, { color: 'lime', times: 2, dur: 500 }), ctx.pulse(pts[1].dot, { color: 'lime', times: 2, dur: 500 })]);
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: high-dimensional geometry: random pairs sit at cosine 0 +- 0.03 */
            var cap2 = ctx.text(cx, cy + R + 52, 'two random unit vectors in ℝ¹¹⁵²: cos ≈ 0 ± 0.03 · a matched 0.30 is ~10σ out', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.sph });
            var bell = ctx.plot(690, 548, 152, 66, function (x) { return 13.3 * Math.exp(-0.5 * Math.pow(x / 0.03, 2)); }, { xDomain: [-0.3, 0.45], yDomain: [0, 14], color: 'cyan', sw: 1.8, samples: 150, parent: S.sph });
            var mk = ctx.line(690 + 152 * 0.6 / 0.75, 556, 690 + 152 * 0.6 / 0.75, 614, { color: 'amber', sw: 2, parent: S.sph });
            var t1 = ctx.text(751, 536, 'random: 0 ± 0.03', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.sph });
            var t2 = ctx.text(820, 552, 'match', { size: 11, font: 'mono', color: 'amber', anchor: 'start', parent: S.sph });
            var ticks = [[-0.3, '−0.3'], [0, '0'], [0.3, '0.3']].map(function (t) { return ctx.text(690 + (t[0] + 0.3) / 0.75 * 152, 628, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.sph }); });
            var els = [cap2, bell, mk, t1, t2].concat(ticks);
            hide(els);
            return ctx.reveal(els, { from: 'fade', stagger: 90 }).then(function () { return ctx.pulse(mk, { color: 'amber', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Similarity matrix',
        beats: [
          {
            say: 'Now compare every image with every caption in the batch. That is one matrix multiply, image embeddings times text embeddings transposed, giving an N by N grid of cosine similarities.',
            card: { tag: 'HOW IT WORKS', title: 'One matmul, N² scores', body: 'S = X̂ Ŷᵀ scores every image against every caption at once, entirely on tensor cores.' },
            deep: '<div class="eq">S = X̂ Ŷᵀ ∈ ℝ<sup>N×N</sup>, &nbsp; logits = S / τ &nbsp; (CLIP: τ learnable, init 0.07, 1/τ clipped at 100)</div>' +
              '<pre>x = normalize(f(I)); y = normalize(g(T))\nx, y = all_gather(x), all_gather(y)\nlogits = x @ y.T * scale  # 1/τ\nlab = arange(N)            # N = 32k\nloss = (ce(logits, lab)\n      + ce(logits.T, lab)) / 2</pre>'
          },
          {
            say: 'The diagonal holds the true pairs. Everything off the diagonal is a negative: a caption that belongs to some other image.',
            card: { tag: 'NUMBERS', title: 'Positives and negatives', stat: { v: '6 vs 30', l: 'N true pairs against N² − N negatives; at N = 32,768 that is 32 k against 1.07 B' } },
            deep: '<p>Row <i>i</i> has exactly one positive (its own caption) and N − 1 negatives; column <i>j</i> likewise. Over the whole matrix: <b>N positives, N² − N negatives</b>. The ratio grows with the batch, so the negatives dominate the loss.</p>' +
              '<p>No labels are needed for the negatives: "not paired in this batch" is treated as "does not match". Occasional false negatives (two fox images in one batch) add a little label noise that scale washes out.</p>'
          },
          {
            say: 'Some negatives are hard. The fox image is also fairly similar to the ice moon caption and to the rocket caption, and those cells carry most of the gradient.',
            card: { tag: 'WHY IT MATTERS', title: 'Hard negatives carry the gradient', body: 'Cells like (fox image, ice moon) at 0.24 hold most of the learning signal; the easy zeros barely matter.', more: '<p>For the row loss, ∂ℒ/∂s<sub>ij</sub> = (p<sub>ij</sub> − 𝟙[i=j]) / (Nτ). For the fox row at τ = 0.07 the ice-moon cell has p = 0.16, about ten times the cat-on-a-sofa cell (0.017), so it receives roughly ten times the push.</p>' },
            deep: '<div class="note">Hard negatives come for free: the fox-astronaut image is also fairly similar to "a glowing ice moon" (0.24) and "a rocket crash-landing" (0.21). Those off-diagonal cells carry most of the gradient.</div>' +
              '<p>Because the softmax gradient on cell (<i>i</i>, <i>j</i>) is proportional to its predicted probability p<sub>ij</sub>, near-misses dominate and clearly unrelated pairs (0.04 to 0.08) contribute almost nothing. Bigger batches are more likely to contain such near-misses.</p>'
          },
          {
            say: 'With a batch of thirty two thousand, each image is contrasted against thirty two thousand captions at once, which is why batch size matters so much for this family of losses.',
            card: { tag: 'NUMBERS', title: 'The real matrix', stat: { v: '1.07 B', u: 'logits', l: '32,768² similarity scores per step, sharded across devices' } },
            deep: '<p>Cost: the matrix is 32,768² ≈ 1.07 B logits per step. That is trivial FLOPs next to the encoders, but the <b>all-gather</b> of embeddings and the N×N softmax memory are what limit batch size; CLIP shards the matrix so each device holds only its rows.</p>' +
              '<p>Larger N means more negatives, a tighter InfoNCE bound (I ≥ log N − ℒ) and better embeddings, up to a saturation point near 32 k.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.sph, 500);
          ctx.remove([S.fI, S.gT], 500);
          ctx.fade([S.xLab, S.yLab], 0, 300);
          S.mat = ctx.matrix(MX, MY, N, N, { cell: CELL, gap: PITCH - CELL, values: function () { return '#0a1224'; }, stroke: ctx.alpha('violet', 0.35) });
          S.vals = ctx.group();
          S.valEls = [];
          for (var i = 0; i < N; i++) {
            S.valEls.push([]);
            for (var j = 0; j < N; j++) {
              var c = S.mat.cellCenter(i, j);
              var t = ctx.text(c.x, c.y, COS[i][j].toFixed(2), { size: 15, font: 'mono', color: i === j ? 'white' : 'text', anchor: 'middle', parent: S.vals });
              t.setAttribute('opacity', 0);
              S.valEls[i].push(t);
            }
          }
          S.colLab = ctx.group();
          for (var j2 = 0; j2 < N; j2++) ctx.text(colX(j2), MY - 44, 'T' + (j2 + 1), { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.colLab });
          ctx.text(MX - 20, MY - 44, 'X̂ Ŷᵀ', { size: 13, font: 'mono', color: 'amber', anchor: 'end', parent: S.colLab });
          S.diag = [];
          for (var d = 0; d < N; d++) S.diag.push(S.mat.cells[d][d]);

          /* beat 0: the matmul: embeddings slide to the borders, the grid fills with cosines */
          ctx.reveal([S.mat, S.colLab], { dur: 500 });
          var moves = S.yv.map(function (v, k) { return ctx.transform(v, { x: colX(k) - 38 - 1022, y: MY - 30 - (rowY(k) - 6) }, 1000, 'inOut', 200 + k * 60); });
          var moves2 = S.xv.map(function (v, k) { return ctx.transform(v, { x: 440 - 338 }, 800, 'inOut', 200); });
          return Promise.all(moves.concat(moves2)).then(function () {
            return ctx.tween(2200, function (t) {
              var n = Math.floor(t * N * N);
              for (var k = 0; k < N * N; k++) {
                var i2 = Math.floor(k / N), j3 = k % N, on = k <= n || t >= 1;
                S.mat.cells[i2][j3].setAttribute('fill', on ? ctx.cmap(i2 === j3 ? 'amber' : 'violet', Math.min(1, COS[i2][j3] / 0.36)) : '#0a1224');
                S.valEls[i2][j3].setAttribute('opacity', on ? 1 : 0);
              }
            }, 'linear');
          }).then(function () {
            ctx.hud('S = X̂Ŷᵀ · 6×6 here, 32,768² in CLIP');
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: diagonal = positives, off-diagonal = negatives */
            S.diag.forEach(function (c) { c.setAttribute('stroke', ctx.C.amber); c.setAttribute('stroke-width', 2.2); });
            S.glow = ctx.loop(function (t) {
              S.diag.forEach(function (c, k) { c.setAttribute('stroke-opacity', (0.4 + 0.6 * Math.abs(Math.sin(t * 2.4 - k * 0.5))).toFixed(2)); });
            });
            S.posNeg = ctx.group();
            ctx.text(1040, 300, 'diagonal: N true pairs', { size: 13, font: 'mono', color: 'amber', parent: S.posNeg });
            ctx.text(1040, 322, 'positives', { size: 12, font: 'mono', color: 'dim', parent: S.posNeg });
            ctx.text(1040, 400, 'off-diagonal: N² − N', { size: 13, font: 'mono', color: 'violet', parent: S.posNeg });
            ctx.text(1040, 422, 'negatives', { size: 12, font: 'mono', color: 'dim', parent: S.posNeg });
            return ctx.reveal(S.posNeg, { from: 'left' }).then(function () { return ctx.wait(700); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: hard negatives in the fox row */
            S.hard = ctx.group();
            [1, 2].forEach(function (j4) {
              var cc = S.mat.cellCenter(0, j4);
              ctx.rect(cc.x - CELL / 2 - 4, cc.y - CELL / 2 - 4, CELL + 8, CELL + 8, { rx: 8, stroke: 'red', sw: 2.4, dash: '6 4', parent: S.hard });
            });
            ctx.text(1040, 496, 'hard negatives:', { size: 13, font: 'mono', color: 'red', parent: S.hard });
            ctx.text(1040, 518, 'fox vs "ice moon" 0.24', { size: 12, font: 'mono', color: 'text', parent: S.hard });
            ctx.text(1040, 538, 'fox vs "rocket" 0.21', { size: 12, font: 'mono', color: 'text', parent: S.hard });
            return ctx.reveal(S.hard, { from: 'fade', dur: 500 }).then(function () {
              return Promise.all([ctx.pulse(S.mat.cells[0][1], { color: 'red', dur: 600 }), ctx.pulse(S.mat.cells[0][2], { color: 'red', dur: 600 })]);
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the real batch is 32,768 wide */
            S.big = ctx.group();
            ctx.text(1120, 620, 'CLIP batch', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.big });
            var bn = ctx.text(1120, 654, '32,768²', { size: 26, font: 'display', weight: 700, color: 'amber', anchor: 'middle', parent: S.big });
            var bl = ctx.text(1120, 690, '0 logits', { size: 14, font: 'mono', color: 'text', anchor: 'middle', parent: S.big });
            ctx.reveal(S.big, { from: 'up' });
            return ctx.counter(bl, 0, 1.07, 1600, function (v) { return '≈ ' + v.toFixed(2) + ' B logits'; }).then(function () {
              return ctx.pulse(bn, { color: 'amber', dur: 700 });
            });
          });
        }
      },

      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Symmetric InfoNCE',
        beats: [
          {
            say: 'The CLIP loss treats each row as a classification problem: given this image, which of the N captions is its own?',
            card: { tag: 'KEY IDEA', title: 'Each row is a classifier', body: 'For image 1 the model must pick its own caption out of all N. The diagonal cell is the correct class.', more: '<p>Derivation: ℓ<sub>i</sub> = −s<sub>ii</sub>/τ + log Σ<sub>j</sub> exp(s<sub>ij</sub>/τ), so ∂ℓ<sub>i</sub>/∂s<sub>ij</sub> = (p<sub>ij</sub> − δ<sub>ij</sub>)/τ. Positives are pulled with weight 1 − p<sub>ii</sub>, negatives pushed with weight p<sub>ij</sub>, and the gradient vanishes as p<sub>ii</sub> → 1.</p>' },
            deep: '<div class="eq">ℒ<sub>i→t</sub> = −(1/N) Σ<sub>i</sub> log [ exp(s<sub>ii</sub>/τ) / Σ<sub>j</sub> exp(s<sub>ij</sub>/τ) ]</div>' +
              '<p>This is an N-way softmax cross-entropy with the diagonal as the label, one classification problem per image. The "classes" are the other captions in the batch, which change every step.</p>'
          },
          {
            say: 'Divide the similarities by a temperature, take a softmax across the row, and apply cross entropy with the diagonal as the correct answer.',
            card: { tag: 'NUMBERS', title: 'Row 1 at τ = 0.07', stat: { v: '0.69', l: 'probability of the right caption for the fox image; loss = −ln 0.69 = 0.38' } },
            deep: '<p>At τ = 0.07 for our batch: row 1 gives p(correct) = 0.69, loss 0.38; the mass stolen by "ice moon" (0.16) and "rocket" (0.11) is what the gradient attacks.</p>' +
              '<p>Gradient intuition: ∂ℒ/∂s<sub>ij</sub> = (p<sub>ij</sub> − 𝟙[i=j]) / (Nτ) per direction: every negative is pushed away in proportion to how much probability it steals, so hard negatives dominate.</p>'
          },
          {
            say: 'Then do the same down every column: given this caption, which image is it? That is the reverse retrieval task, with its own softmax over the images.',
            card: { tag: 'HOW IT WORKS', title: 'And down every column', body: 'Column 1 asks the reverse question: given the fox caption, which of the N images is it? Same softmax, other axis.' },
            deep: '<div class="eq">ℒ<sub>t→i</sub> = −(1/N) Σ<sub>j</sub> log [ exp(s<sub>jj</sub>/τ) / Σ<sub>i</sub> exp(s<sub>ij</sub>/τ) ]</div>' +
              '<p>Text-to-image retrieval is a different task from image-to-text, with different negatives, and a symmetric loss trains both towers with both signals. On this batch the reverse probability for the fox caption is 0.74.</p>'
          },
          {
            say: 'The final loss averages the two directions, so both towers learn from both kinds of question. A random guesser would score the natural log of six.',
            card: { tag: 'HOW IT WORKS', title: 'Average both directions', body: 'ℒ = ½ (ℒ image to text + ℒ text to image). A random guesser scores ln 6 = 1.79 on this batch.' },
            deep: '<div class="eq">ℒ = ½ ( ℒ<sub>i→t</sub> + ℒ<sub>t→i</sub> ) = ½ ( CE(S/τ, diag) + CE(Sᵀ/τ, diag) )</div>' +
              '<p>For the six pairs shown, ℒ = 0.235 at τ = 0.07, against ln 6 = 1.792 for a uniform guess. In implementation both terms are one call each to <code>cross_entropy</code> on the logits and their transpose.</p>'
          },
          {
            say: 'It is exactly the InfoNCE objective: minimising it raises a lower bound on the mutual information between images and text.',
            card: { tag: 'KEY IDEA', title: 'A bound on mutual information', body: 'I(X;Y) ≥ log N − ℒ. Larger N tightens the bound, one more reason CLIP wants enormous batches.' },
            deep: '<div class="eq">I(X; Y) ≥ log N − ℒ<sub>InfoNCE</sub></div>' +
              '<p>InfoNCE (van den Oord et al., 2018) estimates a lower bound on the mutual information between the two views. The bound can never exceed log N, so with N = 6 it saturates at 1.79 nats, while N = 32,768 allows up to 10.4 nats: bigger batches can certify richer dependence between image and text.</p>' +
              '<details><summary>Go deeper</summary><p>Derivation sketch: the optimal critic satisfies exp(s(x,y)/τ) ∝ p(y|x)/p(y), so the softmax over N−1 negatives plus the positive estimates the density ratio; Jensen\'s inequality on the log of the average density ratio gives I ≥ log N − ℒ.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.fade(S.caps, 0.08, 500);
          ctx.remove([S.posNeg, S.hard, S.big], 300);
          S.card = card(ctx, 1040, 236, 505, 530, '', 'violet');
          var G = S.card;
          ctx.text(1064, 266, 'row 1 · image → text  (softmax over captions)', { size: 14, font: 'mono', color: 'violet', parent: G });
          S.rowBars = ctx.bars(1070, 290, 440, 120, [0, 0, 0, 0, 0, 0], { color: ['#ffbf3a', '#9b7bff', '#9b7bff', '#9b7bff', '#9b7bff', '#9b7bff'], labels: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], gap: 14, parent: G });
          S.colG = ctx.group({ parent: G });
          ctx.text(1064, 452, 'column 1 · text → image  (softmax over images)', { size: 14, font: 'mono', color: 'cyan', parent: S.colG });
          S.colBars = ctx.bars(1070, 476, 440, 120, [0, 0, 0, 0, 0, 0], { color: ['#ffbf3a', '#22e4ff', '#22e4ff', '#22e4ff', '#22e4ff', '#22e4ff'], labels: ['I1', 'I2', 'I3', 'I4', 'I5', 'I6'], gap: 14, parent: S.colG });
          S.lossTx = ctx.text(1064, 640, '', { size: 15, font: 'mono', color: 'amber', parent: G });
          S.lossTx2 = ctx.text(1064, 666, '', { size: 13, font: 'mono', color: 'text', parent: G });
          S.tauTx = ctx.text(1064, 692, '', { size: 13, font: 'mono', color: 'dim', parent: G });
          S.boundTx = ctx.text(1064, 716, 'I(X;Y) ≥ log N − ℒ    (N = 6: log N = 1.79)', { size: 13, font: 'mono', color: 'lime', parent: G });
          S.formula = ctx.text(1064, 740, 'ℒ = ½ ( CE(S/τ, diag) + CE(Sᵀ/τ, diag) )', { size: 14, font: 'mono', color: 'white', parent: G });
          hide([S.colG, S.lossTx, S.lossTx2, S.tauTx, S.boundTx, S.formula]);          S.rowHl = ctx.rect(MX - 8, MY - 8, PITCH * N - (PITCH - CELL) + 16, CELL + 16, { rx: 8, stroke: 'violet', sw: 2.4, dash: '6 4' });
          S.colHl = ctx.rect(MX - 8, MY - 8, CELL + 16, PITCH * N - (PITCH - CELL) + 16, { rx: 8, stroke: 'cyan', sw: 2.4, dash: '6 4' });
          hide([S.rowHl, S.colHl]);
          S.setRow = function (tau, ms) {
            var s = 1 / tau, pr = softmax(COS[0], s);
            S.tau = tau;
            for (var i = 0; i < N; i++) {
              var p = softmax(COS[i], s);
              for (var j = 0; j < N; j++) S.mat.cells[i][j].setAttribute('fill', ctx.cmap(i === j ? 'amber' : 'violet', 0.1 + 0.9 * p[j]));
            }
            S.lossTx.textContent = 'row 1: p(T1) = ' + pr[0].toFixed(2) + '   loss = ' + (-Math.log(pr[0])).toFixed(3);
            S.tauTx.textContent = 'τ = ' + tau + '  →  logit scale 1/τ = ' + Math.round(s);
            return S.rowBars.update(pr, ms);
          };
          S.setCol = function (tau, ms) { return S.colBars.update(softmax(col(0), 1 / tau), ms); };
          S.setLoss = function (tau) { S.lossTx2.textContent = 'batch ℒ (both directions) = ' + clipLoss(1 / tau).toFixed(3) + '   (uniform: ln 6 = 1.792)'; };
          S.setTau = function (tau, ms) { S.setLoss(tau); return Promise.all([S.setRow(tau, ms), S.setCol(tau, ms)]); };

          /* beat 0: each row is an N-way classification; an untrained model guesses 1/N */
          S.rowBars.update([1 / N, 1 / N, 1 / N, 1 / N, 1 / N, 1 / N], 0);
          S.lossTx.textContent = 'untrained guess: p(T1) = 1/N = 0.17   loss = ln 6 = 1.792';
          ctx.reveal(G, { from: 'right' });
          ctx.reveal(S.rowHl, { delay: 300 });
          ctx.reveal(S.lossTx, { from: 'up', delay: 600 });
          ctx.hud('one row = one N-way classification');
          return ctx.wait(900).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: softmax across the row at tau = 0.07 */
            ctx.hud('colour = row softmax · numbers = cosines');
            ctx.reveal(S.tauTx, { from: 'up', delay: 150 });
            return S.setRow(0.07, 1200).then(function () { return ctx.wait(500); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the same down the column */
            ctx.reveal(S.colG, { from: 'up' });
            ctx.reveal(S.colHl, { delay: 300 });
            return ctx.wait(500).then(function () { return S.setCol(0.07, 1000); }).then(function () { return ctx.wait(400); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: average of both directions */
            S.setLoss(0.07);
            ctx.reveal(S.lossTx2, { from: 'up' });
            return ctx.reveal(S.formula, { from: 'up', delay: 200 }).then(function () { return ctx.pulse(S.formula, { color: 'amber', dur: 700 }); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: InfoNCE lower bound */
            return ctx.reveal(S.boundTx, { from: 'left' }).then(function () { return ctx.pulse(S.boundTx, { color: 'lime', times: 2, dur: 600 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Temperature',
        beats: [
          {
            say: 'The temperature controls how peaked those softmaxes are. A small value stretches the cosines so the correct caption can win by a wide margin.',
            card: { tag: 'KEY IDEA', title: 'Temperature sets sharpness', body: 'Cosines live in [−1, 1]. Dividing by a small τ stretches them so the softmax can become confident.' },
            deep: '<div class="eq">p<sub>ij</sub> = softmax<sub>j</sub>(s<sub>ij</sub> / τ), &nbsp; τ = exp(−t′), t′ learnable (CLIP init t′ = ln(1/0.07) ≈ 2.66)</div>' +
              '<p>Small τ means large logit scale 1/τ: a cosine gap of 0.1 turns into a logit gap of 1/τ · 0.1. The temperature is a single scalar parameter learned along with the towers.</p>'
          },
          {
            say: 'At a temperature of one, cosines between minus one and one barely change the distribution, and the loss stays near its maximum.',
            card: { tag: 'NUMBERS', title: 'τ = 1: nearly uniform', stat: { v: '1.61', l: 'batch loss at τ = 1, close to the uniform value ln 6 = 1.79; p(correct) only 0.20' } },
            deep: '<table><tr><th>τ</th><th>1/τ</th><th>p(T1 | I1)</th><th>batch ℒ</th></tr>' +
              '<tr><td>1.0</td><td>1</td><td>≈ 0.20</td><td>≈ 1.61 (ln 6 = 1.79)</td></tr></table>' +
              '<p>With τ = 1 the largest possible logit gap is 2 (cosine −1 to +1), and realistic gaps are 0.1–0.3, so the softmax barely leaves uniform and gradients tell the model little about which negatives matter.</p>'
          },
          {
            say: 'CLIP starts at zero point zero seven and learns the value. The paper clips the logit scale at one hundred for stability, and at that cap the softmax is extremely confident.',
            card: { tag: 'NUMBERS', title: 'Logit scale cap', stat: { v: '100', l: 'CLIP clips 1/τ at 100 (τ = 0.01); it starts at 1/0.07 = 14.3' }, more: '<p>Too low a temperature early in training makes gradients vanish for all but the hardest negatives and destabilises learning; too high and the loss cannot distinguish near-misses. Making τ learnable (with a clip at 100) lets the model anneal itself.</p>' },
            deep: '<table><tr><th>τ</th><th>1/τ</th><th>p(T1 | I1)</th><th>batch ℒ</th></tr>' +
              '<tr><td>0.1</td><td>10</td><td>≈ 0.54</td><td>≈ 0.46</td></tr>' +
              '<tr><td>0.07</td><td>14.3</td><td>≈ 0.69</td><td>≈ 0.24</td></tr>' +
              '<tr><td>0.01</td><td>100</td><td>≈ 1.00</td><td>&lt; 10<sup>−4</sup></td></tr></table>' +
              '<p><span class="muted">Computed on this 6×6 batch; with N = 32 k negatives the same τ gives far larger losses.</span></p>' +
              '<div class="note">Temperature is also why raw CLIP cosines look "small" (0.2–0.35): the model only needs relative differences of ~0.05 once they are multiplied by 100.</div>'
          },
          {
            say: 'Now try it yourself. Click the temperature buttons to see the rows sharpen and the loss fall.',
            card: { tag: 'TRY IT', title: 'Click a temperature', body: 'Pick τ = 1, 0.1, 0.07 or 0.01. Watch the bars sharpen, the cells re-colour and the loss fall.' },
            deep: '<p>Rule of thumb from the experiment you can run here: the loss decreases monotonically with 1/τ on a <i>fixed</i> similarity matrix, because a larger scale can only make the correct answer more confident. In real training the matrix changes too, and that trade-off is what the learned τ resolves.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = S.card;
          ctx.fade(S.colHl, 0, 300);
          ctx.fade([S.formula, S.tauTx, S.boundTx], 0, 300);
          var opts = [1, 0.1, 0.07, 0.01];
          function mark(tau) { S.tauChips.forEach(function (c) { c.g.setAttribute('opacity', c.tau === tau ? 1 : 0.45); }); }
          S.tauChips = opts.map(function (tau) {
            var g = ctx.group({ parent: G });
            ctx.label(1120 + opts.indexOf(tau) * 112, 712, 'τ = ' + tau, { color: 'amber', size: 13, w: 100, parent: g });
            g.style.cursor = 'pointer';
            g.addEventListener('click', function () { S.setTau(tau, 500); mark(tau); });
            return { g: g, tau: tau };
          });
          var hint = ctx.text(1064, 750, 'click a temperature ↑', { size: 12, font: 'mono', color: 'amber', parent: G });
          var chipEls = S.tauChips.map(function (c) { return c.g; });
          hide(chipEls); hide([hint]);
          S.setTau(0.07, 0);

          /* beat 0: the controls appear at tau = 0.07 */
          ctx.hud('learnable τ · init 0.07 · 1/τ capped at 100');
          return ctx.reveal(chipEls.concat([hint]), { from: 'up', stagger: 100 }).then(function () {
            mark(0.07);
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: tau = 1, almost uniform */
            mark(1);
            return S.setTau(1, 900).then(function () { return ctx.wait(700); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: CLIP's learned value, then the saturated logit scale of 100 */
            mark(0.07);
            return S.setTau(0.07, 800).then(function () { return ctx.wait(700); }).then(function () {
              mark(0.01);
              return S.setTau(0.01, 800);
            }).then(function () { return ctx.wait(600); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: hand the controls to the viewer */
            mark(0.07);
            return S.setTau(0.07, 700).then(function () { return ctx.pulse(S.tauChips[2].g, { color: 'amber', times: 2, dur: 600 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 6 */
      {
        title: 'SigLIP: sigmoid loss',
        beats: [
          {
            say: 'SigLIP replaces the softmax with a sigmoid on every cell independently. Each pair is a binary question: do these two belong together, yes or no?',
            card: { tag: 'KEY IDEA', title: 'Every cell is its own question', body: 'No softmax across the row. Each image and caption pair gets an independent yes or no verdict from a sigmoid.' },
            deep: '<p>Softmax couples every cell in a row through its normaliser. SigLIP replaces it with an independent <b>binary classification per pair</b>: σ(s) is the probability that the two items match.</p>' +
              '<p>The matrix recolours from row-softmax weights to per-cell sigmoid probabilities: the six diagonal cells saturate near 1, while the fox row keeps a visible 0.27 on "ice moon".</p>'
          },
          {
            say: 'The diagonal is labelled plus one, everything else minus one, with a learnable temperature and bias.',
            card: { tag: 'NUMBERS', title: 'A negative bias to start', stat: { v: '− 10', l: 'initial bias b, so the ~N² negatives start with small loss and do not swamp the N positives' } },
            deep: '<div class="eq">ℒ = −(1/|B|) Σ<sub>i</sub> Σ<sub>j</sub> log σ( z<sub>ij</sub> · (t · x̂<sub>i</sub>·ŷ<sub>j</sub> + b) ), &nbsp; z<sub>ij</sub> = +1 if i = j else −1</div>' +
              '<p>Init: t = exp(t′) with t′ = log 10, and b = −10, so the ~N² negatives start with small loss and do not swamp the N positives. Both t and b are learned.</p>'
          },
          {
            say: 'There is no normalisation across the row, so no device needs to see the whole batch: text embeddings are passed around a ring of accelerators chunk by chunk.',
            card: { tag: 'HOW IT WORKS', title: 'A ring, not an all-gather', body: 'Each device scores its own images against a text chunk, then hands the chunk to its neighbour. Memory stays O(b²).' },
            deep: '<ul><li><b>No global normaliser</b>: each device computes its local b×b block, then passes its text chunk to the neighbour (ring / collective-permute). Memory is O(b²) per device instead of materialising N×N, and no all-gather of the full batch is needed.</li></ul>' +
              '<p>After D steps around a ring of D devices every image has met every caption; the per-device losses are simply summed, since each cell\'s term is independent.</p>'
          },
          {
            say: 'In practice it trains better at small batch sizes, matches softmax around thirty two thousand, and scales to large batches with far less memory.',
            card: { tag: 'NUMBERS', title: 'Where sigmoid wins', stat: { v: '~ 32 k', l: 'batch size where SigLIP saturates; sigmoid helps most at small batches, and 1 M gives only diminishing returns' } },
            deep: '<ul><li><b>Batch size</b>: sigmoid beats softmax at smaller batches (the gap is clearest below roughly 16 k); performance saturates around 32 k, and going up to 1 M brings only diminishing returns (Zhai et al.).</li>' +
              '<li><b>Hard negatives</b> visible in the matrix: (fox image, "ice moon") has cos 0.24 → σ ≈ 0.27 at the illustrative t = 100, b = −25, a per-pair loss of 0.31 while easy cells contribute nearly nothing.</li></ul>'
          },
          {
            say: 'SigLIP two, released in twenty twenty five, adds a captioning decoder, self distillation and masked prediction, and extends the SigLIP line that many open vision language models build on.',
            card: { tag: 'STATE OF THE ART', title: 'SigLIP 2 (2025)', body: 'Adds a captioning decoder, self-distillation, masked prediction, multilingual data and native-aspect variants to the sigmoid recipe.' },
            deep: '<p><b>SigLIP 2</b> (2025) adds a captioning decoder (LocCa), self-distillation and masked prediction for dense features, multilingual data, and NaFlex native-aspect variants (patch-16 checkpoints, sequence lengths up to 1024 patches). Its SigLIP lineage is the vision tower of PaliGemma, Gemma 3, Idefics3 and SmolVLM, among others; Qwen2.5-VL and InternVL bring their own ViTs.</p>' +
              '<div class="note">This is the vision tower inside the chapter <i>Vision Encoders</i>: a SigLIP 2 so400m/14 with 27 blocks and width 1152.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.card, 400);
          ctx.fade([S.rowHl, S.colHl], 0, 300);
          S.card2 = card(ctx, 1040, 236, 505, 530, '', 'magenta');
          var G = S.card2;
          ctx.text(1064, 266, 'σ(t·cos + b) per cell · labels z = ±1', { size: 14, font: 'mono', color: 'magenta', parent: G });
          var legend = ctx.group({ parent: G });
          ctx.text(1064, 290, 'cells: σ value · lime z = +1 (pair) · magenta z = −1', { size: 12, font: 'mono', color: 'text', parent: legend });
          ctx.text(1064, 312, 'illustrative learned t = 100, b = −25', { size: 12, font: 'mono', color: 'dim', parent: legend });
          var formula = ctx.group({ parent: G });
          ctx.text(1064, 348, 'ℒ = −(1/|B|) Σᵢⱼ log σ( zᵢⱼ · (t·x̂ᵢ·ŷⱼ + b) )', { size: 13, font: 'mono', color: 'white', parent: formula });
          ctx.text(1064, 370, 'init: t = exp(log 10) = 10, b = −10', { size: 12, font: 'mono', color: 'amber', parent: formula });
          hide([legend, formula]);
          /* device ring demo: 4 devices, 8x8 batch, each owns 2 images + 2 captions */
          var bx = 1110, by = 396, bc = 22, bp = 2 * bc + 4;
          var ring = ctx.group({ parent: G });
          var blocks = [];
          for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
            blocks.push({ r: r, c: c, el: ctx.rect(bx + c * bp, by + r * bp, 2 * bc, 2 * bc, { rx: 4, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('magenta', 0.35), sw: 1, parent: ring }) });
          }
          for (var d = 0; d < 4; d++) ctx.text(bx - 10, by + d * bp + bc, 'dev ' + d, { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: ring });
          var ringTx = ctx.text(bx + 2 * bp - 2, by + 4 * bp + 16, 'step 0: local blocks', { size: 12, font: 'mono', color: 'magenta', anchor: 'middle', parent: ring });
          var para = ctx.para(1064, 640, ['each device: 2 images × all 8 captions', 'captions hop around the ring (collective-permute)', 'no all-gather · no N×N softmax · memory O(b²)'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: G });
          hide([ring, para]);
          /* illustrative batch-size curves (shape only, after Zhai et al.) */
          var curves = ctx.group({ parent: G });
          ctx.text(1330, 384, 'quality vs batch size', { size: 11, font: 'mono', color: 'dim', parent: curves });
          var pl1 = ctx.plot(1330, 396, 190, 150, [[0, 0.42], [0.5, 0.60], [1, 0.74], [1.5, 0.81], [2, 0.83], [3, 0.83]], { xDomain: [0, 3], yDomain: [0.3, 0.9], color: 'cyan', sw: 2, parent: curves });
          ctx.plot(1330, 396, 190, 150, [[0, 0.55], [0.5, 0.69], [1, 0.78], [1.5, 0.82], [2, 0.83], [3, 0.83]], { xDomain: [0, 3], yDomain: [0.3, 0.9], color: 'magenta', sw: 2, axes: false, parent: curves });
          ctx.line(1330 + 190 * 0.5, 396, 1330 + 190 * 0.5, 546, { color: 'faint', sw: 1, dash: '3 4', parent: curves });
          [[0, '1k'], [1.5, '32k'], [3, '1M']].forEach(function (t) { ctx.text(1330 + t[0] / 3 * 190, 562, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: curves }); });
          ctx.text(1345, 411, 'sigmoid', { size: 11, font: 'mono', color: 'magenta', parent: curves });
          ctx.text(1345, 427, 'softmax', { size: 11, font: 'mono', color: 'cyan', parent: curves });
          hide([curves]);
          var bt = ctx.text(1064, 700, 'illustrative shape · sigmoid wins below ~16k, saturates near 32k', { size: 12, font: 'mono', color: 'amber', parent: G });
          var s2 = ctx.para(1064, 726, ['SigLIP 2 (2025): + captioning decoder (LocCa) + self-distillation', '+ masked prediction · multilingual · NaFlex native aspect'], { size: 12, font: 'mono', color: 'lime', lh: 20, parent: G });
          hide([bt, s2]);
          var sv = [];
          for (var i = 0; i < N; i++) { sv.push([]); for (var j = 0; j < N; j++) sv[i].push(sig(100 * COS[i][j] - 25)); }

          /* beat 0: every cell gets its own sigmoid verdict */
          ctx.reveal(G, { from: 'right' });
          ctx.hud('SigLIP: per-pair sigmoid, no row softmax');
          return ctx.wait(500).then(function () {
            return ctx.tween(1400, function (t) {
              for (var i2 = 0; i2 < N; i2++) for (var j2 = 0; j2 < N; j2++) {
                var v = sv[i2][j2];
                S.mat.cells[i2][j2].setAttribute('fill', ctx.cmap(i2 === j2 ? 'lime' : 'magenta', ctx.lerp(0.2, 0.15 + 0.85 * v, t)));
                if (t > 0.5) S.valEls[i2][j2].textContent = v.toFixed(2);
                if (t > 0.5 && i2 === j2) S.valEls[i2][j2].setAttribute('fill', '#05080f');
              }
            }, 'inOut');
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: +1 on the diagonal, -1 elsewhere, learnable t and b */
            for (var i3 = 0; i3 < N; i3++) for (var j3 = 0; j3 < N; j3++) {
              S.mat.cells[i3][j3].setAttribute('stroke', i3 === j3 ? ctx.C.lime : ctx.alpha('magenta', 0.5));
              S.mat.cells[i3][j3].setAttribute('stroke-width', i3 === j3 ? 2.4 : 1);
            }
            ctx.reveal([legend, formula], { from: 'up', stagger: 200 });
            return ctx.wait(900).then(function () { return ctx.pulse(S.mat.cells[0][0], { color: 'lime', dur: 600 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the ring of devices */
            ctx.reveal([ring, para], { from: 'up', stagger: 200 });
            return [0, 1, 2, 3].reduce(function (p, s) {
              return p.then(function () {
                ringTx.textContent = s === 0 ? 'step 0: local blocks' : 'step ' + s + ': captions shifted by ' + s;
                blocks.forEach(function (b) {
                  if ((b.c - b.r + 4) % 4 === s) { b.el.setAttribute('fill', ctx.alpha('magenta', b.c === b.r ? 0.6 : 0.3)); b.el.setAttribute('stroke', ctx.C.magenta); }
                });
                return ctx.wait(650);
              });
            }, ctx.wait(500));
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: where sigmoid wins: batch-size behaviour */
            ctx.reveal([curves, bt], { from: 'up', stagger: 150 });
            return ctx.reveal(pl1.curve, { from: 'draw', dur: 900 }).then(function () { return ctx.wait(400); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: SigLIP 2 */
            return ctx.reveal(s2, { from: 'up' }).then(function () { return ctx.pulse(s2, { color: 'lime', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Zero-shot & geometry',
        beats: [
          {
            say: 'A trained contrastive model classifies without any training labels. Write each class as a prompt, a photo of a fox, a photo of a cat, embed the prompts, and pick the one closest to the image.',
            card: { tag: 'NUMBERS', title: 'Zero-shot ImageNet', stat: { v: '83 %', l: 'ImageNet top-1 for SigLIP so400m/14 at 384 px with no ImageNet training labels (CLIP ViT-L/14@336: 76.2 %)' } },
            deep: '<div class="eq">ŷ<sub>c</sub> = normalize(g("a photo of a {c}")), &nbsp; p(c | I) = softmax<sub>c</sub>(x̂ · ŷ<sub>c</sub> / τ)</div>' +
              '<p>CLIP ViT-L/14@336 reaches 76.2% ImageNet top-1 zero-shot; SigLIP so400m/14@384 ≈ 83%. In the CLIP paper, a "A photo of a {label}." template adds 1.3 points on ImageNet and an ensemble of 80 prompts another 3.5, nearly 5 in total.</p>' +
              '<p>The class list is just text, so new categories cost one forward pass of the text tower, not a new labelled dataset.</p>'
          },
          {
            say: 'Our fox astronaut sketch votes mostly fox, with astronaut a clear second, which is fair.',
            card: { tag: 'NUMBERS', title: 'The sketch votes fox', stat: { v: '88 %', l: 'fox, against 12 % astronaut, from softmax over cosine × 100; cats and dogs get about 0' } },
            deep: '<p>Cosines to the five prompts are 0.29, 0.27, 0.17, 0.14 and 0.12. With logit scale 100 the softmax turns the 0.02 gap between fox and astronaut into e<sup>−2</sup> ≈ 0.135 relative weight, so fox gets 88.1% and astronaut 11.9%.</p>' +
              '<p>The other prompts sit 0.10 or more below the winner, i.e. e<sup>−10</sup> or less, and are effectively zero.</p>'
          },
          {
            say: 'There is also a quirk of geometry: images and texts occupy two separate cones on the sphere, the modality gap.',
            card: { tag: 'KEY IDEA', title: 'Two cones, not one blob', body: 'Even after training, image embeddings and text embeddings sit in separate narrow cones of the sphere.', more: '<p>Liang et al. (2022) trace the gap to the cone effect at initialisation and to low temperature, and show that shifting embeddings along the gap vector changes zero-shot behaviour: the gap is a design knob and a diagnostic, not a bug.</p>' },
            deep: '<p><b>Modality gap</b> (Liang et al., 2022): embeddings of each modality occupy a narrow cone, caused by initialisation (random encoders already map inputs to cones) and preserved by the contrastive loss at low temperature.</p>' +
              '<p>The gap is not simply a bug to fix: contrastive training at low temperature preserves it, moving embeddings along the gap changes zero-shot accuracy and fairness, and it leaves the ranking <i>within</i> one modality almost unchanged, which is what retrieval uses.</p>'
          },
          {
            say: 'So a matched image and caption sit much further apart than two similar images do, and that changes how similarity thresholds must be set.',
            card: { tag: 'PITFALL', title: 'Never mix modality thresholds', body: 'Matched image–text cosine is about 0.3, while similar image–image cosine is about 0.8. Calibrate thresholds per modality pair.' },
            deep: '<p>Typical numbers: matched image–text cos ≈ 0.3, near-duplicate images cos ≈ 0.8–0.9. Practical consequences for this system:</p>' +
              '<ul><li>never compare an image–image score with an image–text score; calibrate thresholds per modality pair;</li>' +
              '<li>for sketch-vs-keyframe style checks use image–image similarity (optionally DINOv2 features, which are more sensitive to style and layout);</li>' +
              '<li>for text→image retrieval, rank within modality only.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          if (S.glow) S.glow.stop();
          ctx.remove(S.card2, 400);
          S.zs = card(ctx, 250, 236, 1295, 560, '', 'violet');
          var G = S.zs;
          ctx.focus([S.zs], 0.1);
          ctx.text(280, 272, 'Zero-shot classification', { size: 17, font: 'display', weight: 700, color: 'white', parent: G });
          thumb(ctx, G, 0, 290, 300);
          ctx.text(332, 380, 'sketch_2', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: G });
          var prompts = [['fox', 0.29], ['astronaut', 0.27], ['rocket', 0.17], ['dog', 0.14], ['cat', 0.12]];
          var p = softmax(prompts.map(function (q) { return q[1]; }), 100);
          var bars = [], rowsG = [];
          prompts.forEach(function (q, i) {
            var y = 420 + i * 58;
            var g = ctx.group({ parent: G });
            ctx.text(290, y + 12, '"a photo of a ' + q[0] + '"', { size: 13, font: 'mono', color: 'cyan', parent: g });
            ctx.text(290, y + 32, 'cos ' + q[1].toFixed(2), { size: 11, font: 'mono', color: 'dim', parent: g });
            ctx.rect(560, y + 4, 240, 24, { rx: 4, fill: 'rgba(255,255,255,0.04)', parent: g });
            var b = ctx.rect(560, y + 4, 0.01, 24, { rx: 4, fill: ctx.alpha(i === 0 ? 'amber' : 'violet', 0.7), parent: g });
            var t = ctx.text(810, y + 16, '', { size: 13, font: 'mono', color: i === 0 ? 'amber' : 'text', parent: g });
            bars.push({ b: b, w: 240 * p[i], t: t, pct: (p[i] * 100).toFixed(1) + '%' });
            rowsG.push(g);
          });
          var sm = ctx.text(560, 402, 'softmax(cos × 100)', { size: 12, font: 'mono', color: 'dim', parent: G });
          hide([sm]);
          /* modality gap (right half) */
          var gapG = ctx.group({ parent: G });
          ctx.line(880, 262, 880, 770, { color: 'line', sw: 1, dash: '4 6', parent: gapG });
          ctx.text(910, 272, 'The modality gap', { size: 17, font: 'display', weight: 700, color: 'white', parent: gapG });
          var cx = 1290, cy = 520, R = 180;
          ctx.circle(cx, cy, R, { stroke: ctx.alpha('white', 0.3), sw: 1.2, dash: '5 6', parent: gapG });
          var r = ctx.rng(9), dots = [];
          for (var k = 0; k < 14; k++) {
            var a1 = -2.55 + (r() - 0.5) * 0.55, a2 = -1.55 + (r() - 0.5) * 0.55;
            dots.push(ctx.circle(cx + R * Math.cos(a1), cy + R * Math.sin(a1), 5, { fill: 'violet', parent: gapG }));
            dots.push(ctx.circle(cx + R * Math.cos(a2), cy + R * Math.sin(a2), 5, { fill: 'cyan', parent: gapG }));
          }
          var conLab = [
            ctx.text(cx - R * 0.95, cy - R * 0.72, 'image cone', { size: 13, font: 'mono', color: 'violet', anchor: 'end', parent: gapG }),
            ctx.text(cx + 70, cy - R - 26, 'text cone', { size: 13, font: 'mono', color: 'cyan', parent: gapG })
          ];
          var gi = { x: cx + R * 0.93 * Math.cos(-2.55), y: cy + R * 0.93 * Math.sin(-2.55) }, gt = { x: cx + R * 0.93 * Math.cos(-1.55), y: cy + R * 0.93 * Math.sin(-1.55) };
          var gapArrow = ctx.group({ parent: G });
          ctx.line(gi.x, gi.y, gt.x, gt.y, { color: 'amber', sw: 2.4, arrow: true, parent: gapArrow });
          ctx.text((gi.x + gt.x) / 2 + 10, (gi.y + gt.y) / 2 + 26, 'gap', { size: 13, font: 'mono', color: 'amber', parent: gapArrow });
          var gapNote = ctx.para(910, 640, ['matched image–caption cos ≈ 0.3', 'similar image–image cos ≈ 0.8', '→ never mix thresholds across modalities'], { size: 13, font: 'mono', color: 'text', lh: 22, parent: G });
          hide([gapG, gapArrow, gapNote]); hide(dots); hide(conLab);

          /* beat 0: classes become prompts; one cosine per prompt */
          ctx.reveal(G, { from: 'scale', s0: 0.95 });
          return ctx.wait(700).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the softmax vote */
            ctx.reveal(sm, { from: 'up' });
            return ctx.tween(1200, function (t) {
              bars.forEach(function (b) { b.b.setAttribute('width', Math.max(0.01, b.w * t).toFixed(1)); b.t.textContent = t > 0.3 ? b.pct : ''; });
            }, 'out').then(function () { bars.forEach(function (b) { b.t.textContent = b.pct; }); return ctx.pulse(rowsG[0], { color: 'amber', dur: 700 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: two separate cones */
            ctx.reveal(gapG, {});
            ctx.reveal(dots, { from: 'scale', stagger: 30, delay: 400 });
            return ctx.reveal(conLab, { delay: 1000, stagger: 200 });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the gap itself */
            return ctx.reveal(gapArrow, { from: 'fade', dur: 700 }).then(function () {
              return ctx.reveal(gapNote, { from: 'up' });
            }).then(function () { return ctx.pulse(gapArrow, { color: 'amber', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Uses in this system',
        beats: [
          {
            say: 'In the video pipeline, contrastive embeddings do four jobs. Every reference and every keyframe is embedded once, and cosine similarity does the rest.',
            card: { tag: 'KEY IDEA', title: 'One embedding, four jobs', body: 'Every reference and keyframe is embedded once with SigLIP 2. After that, cosine similarity does retrieval, scoring, checking and conditioning.' },
            deep: '<p>Because the towers are independent, <b>each asset is embedded exactly once</b> (a 1152-d vector) and stored. All four jobs below are then dot products against that store, cheap enough to run inside the agent loop.</p>' +
              '<p>Storage is modest: a 1152-d float16 vector is 2.3 kB, so a million reference crops and keyframes fit in about 2.3 GB, and an HNSW index returns the top-k neighbours in milliseconds.</p>'
          },
          {
            say: 'First, they retrieve reference assets from vector memory, by text or by image, so the storyboard agent can find the fox again.',
            card: { tag: 'HOW IT WORKS', title: 'Retrieve by similarity', body: 'The storyboard agent asks for "fox astronaut, cracked visor" and gets the nearest reference crops back.' },
            deep: '<p><b>Retrieval</b>: all reference crops and generated keyframes are embedded once and indexed (HNSW); the storyboard agent queries "fox astronaut, cracked visor, rim light" → top-k crops passed to the video model as references.</p>' +
              '<p>Because of the modality gap, text-to-image ranking is done <i>within</i> the text-to-image score list, never mixed with image-to-image scores.</p>'
          },
          {
            say: 'Second, they score rendered shots against the prompt, in the style of CLIPScore, as a cheap first pass before the critic looks.',
            card: { tag: 'NUMBERS', title: 'CLIPScore for shot 3', stat: { v: '0.78', l: '2.5 × max(cos, 0) with cos = 0.31 between eight sampled frames and the shot prompt' } },
            deep: '<p><b>CLIPScore</b> (Hessel et al.): <code>2.5 · max(cos(E<sub>I</sub>(frame), E<sub>T</sub>(prompt)), 0)</code>, averaged over sampled frames; cheap, but blind to motion and counting, so it is used as a first-pass filter before the VLM critic.</p>' +
              '<p>Averaging over eight frames smooths single-frame noise, but a shot with one bad frame can still score well, which is another reason CLIPScore is only a gate and never the final verdict.</p>' +
              '<p><span class="muted">Calibration: the weight 2.5 rescales CLIP ViT-B/32 cosines (typically 0.2–0.35) onto roughly [0, 1]. With a SigLIP 2 tower the cosine scale is different, so this system recalibrates the weight and the pass threshold on held-out (prompt, shot) pairs rather than reusing 2.5.</span></p>'
          },
          {
            say: 'Third, they check that generated keyframes still match the creator\'s sketches, and send a shot back when the similarity falls too low.',
            card: { tag: 'NUMBERS', title: 'Style check fails', stat: { v: '0.74', l: 'image–image cosine of shot 3 to the three sketches, below the 0.80 threshold, so the critic re-renders it (identity cosine 0.81 passes)' } },
            deep: '<p><b>Style / identity match</b>: image–image cosine between keyframes and the identity crop (0.81 for shot_03, above the 0.80 gate) and between keyframes and the three sketches (style score 0.74, below it). These are the same two numbers the reference analysis of the parent chamber stored for shot_03. Thresholds are calibrated on held-out pairs; DINOv2 features are more sensitive to style and layout and can be blended in.</p>' +
              '<p>An image–image score is a much tighter measure than image–text: near-duplicate images reach 0.8–0.9, which is why these thresholds sit far above CLIPScore\'s image–text values of about 0.3.</p>'
          },
          {
            say: 'And they condition generators: an image embedding of the reference can steer image to video models. For text conditioning, though, modern video diffusion transformers mostly use T five or large language model encoders, because CLIP\'s text tower is weak at long, compositional prompts.',
            card: { tag: 'STATE OF THE ART', title: 'CLIP for images, LLMs for text', body: 'CLIP image features feed I2V and adapter paths. Text conditioning in 2025 video DiTs comes from umT5-XXL or an MLLM, not CLIP.' },
            deep: '<p><b>Conditioning</b>: CLIP-image features feed I2V and adapter paths (Wan 2.1 I2V, IP-Adapter). Text encoders of 2025 video DiTs: umT5-XXL (Wan 2.1), a decoder MLLM plus CLIP-L pooled vector (HunyuanVideo), T5-XXL + CLIP-L/G (SD3-style MM-DiT). CLIP text is capped at 77 tokens and behaves like a bag of words.</p>' +
              '<div class="note">Known blind spots: word order and relations ("fox on moon" vs "moon on fox", measured by ARO and Winoground), counting, negation and typographic attacks. The critic therefore pairs embedding scores with a VLM judge.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.zs, 400);
          S.use = card(ctx, 60, 236, 1485, 600, 'Where contrastive embeddings work in the video pipeline', 'violet');
          var G = S.use;
          ctx.focus([S.use], 0.08);
          var boxes = [
            [80, 290, 'Retrieve references', 'teal', ['query: "fox astronaut, cracked visor"', 'ŷ = g(query) → HNSW over vector memory', 'top-3 crops: cos 0.31 · 0.29 · 0.27', '→ passed to video model as refs']],
            [820, 290, 'Score shots (CLIPScore)', 'pink', ['shot_03, 8 frames vs shot prompt', '2.5 · max(cos, 0) = 2.5 · 0.31 = 0.78', 'first-pass filter, then VLM critic', 'blind to motion, counting, order']],
            [80, 540, 'Style & identity match', 'amber', ['identity crop: cos 0.81 ≥ 0.80  ✓', 'sketches (style): cos 0.74 < 0.80  ✗', '→ critic sends shot_03 back', 'DINOv2 features: more style-sensitive']],
            [820, 540, 'Conditioning generators', 'lime', ['I2V / IP-Adapter: CLIP image features', 'text: umT5-XXL (Wan 2.1),', 'MLLM + CLIP-L pooled (HunyuanVideo)', 'CLIP text: 77 tokens, bag-of-words']]
          ];
          var gs = boxes.map(function (b) {
            var g = ctx.group({ parent: G });
            ctx.rect(b[0], b[1], 705, 225, { rx: 12, fill: ctx.alpha(b[3], 0.05), stroke: ctx.alpha(b[3], 0.6), sw: 1.3, parent: g });
            ctx.text(b[0] + 22, b[1] + 32, b[2], { size: 17, font: 'display', weight: 700, color: b[3], parent: g });
            b[4].forEach(function (l, i) { ctx.text(b[0] + 22, b[1] + 72 + i * 34, l, { size: 15, font: 'mono', color: 'text', parent: g }); });
            return g;
          });
          var foot = ctx.text(80, 800, 'Thumbnails: every reference and keyframe is embedded once (SigLIP 2, 1152-d) → cosine everywhere downstream.', { size: 13, font: 'mono', color: 'dim', parent: G });
          hide(gs); hide([foot]);

          /* beat 0: one embedding per asset, four jobs */
          ctx.reveal(G, { from: 'scale', s0: 0.96 });
          return ctx.reveal(foot, { delay: 400 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            return ctx.reveal(gs[0], { from: 'up' }).then(function () { return ctx.pulse(gs[0], { color: 'teal', dur: 600 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            return ctx.reveal(gs[1], { from: 'up' }).then(function () { return ctx.pulse(gs[1], { color: 'pink', dur: 600 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            return ctx.reveal(gs[2], { from: 'up' }).then(function () { return ctx.pulse(gs[2], { color: 'amber', dur: 600 }); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            return ctx.reveal(gs[3], { from: 'up' }).then(function () { return ctx.pulse(gs[3], { color: 'lime', dur: 600 }); });
          });
        }
      }
    ]
  });
})();
