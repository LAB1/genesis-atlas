/* L2 — Contrastive Alignment. CLIP / SigLIP: two towers, one shared embedding space; how it is trained and how this system uses it. */
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
  function nb(s) { return s.replace(/ {2,}/g, function (m) { return new Array(m.length + 1).join(' '); }); }

  Atlas.register({
    id: 'contrastive',
    refs: [
      'Radford et al., <i>Learning Transferable Visual Models From Natural Language Supervision (CLIP)</i>, ICML 2021',
      'van den Oord et al., <i>Representation Learning with Contrastive Predictive Coding</i> (InfoNCE), 2018',
      'Zhai et al., <i>Sigmoid Loss for Language Image Pre-Training (SigLIP)</i>, ICCV 2023',
      'Tschannen et al., <i>SigLIP 2: Multilingual Vision-Language Encoders with Improved Semantic Understanding, Localization, and Dense Features</i>, 2025',
      'Liang et al., <i>Mind the Gap: Understanding the Modality Gap in Multi-modal Contrastive Representation Learning</i>, NeurIPS 2022',
      'Hessel et al., <i>CLIPScore: A Reference-free Evaluation Metric for Image Captioning</i>, EMNLP 2021',
      'Yuksekgonul et al., <i>When and Why Vision-Language Models Behave like Bags-of-Words</i>, ICLR 2023',
      'Wan Team, <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, 2025; Kong et al., <i>HunyuanVideo</i>, 2024'
    ],
    steps: [
      {
        title: 'Two towers',
        say: 'Contrastive alignment is how a vision encoder learns to speak language in the first place. Take a batch of images and their captions, scraped from the web. An image encoder and a separate text encoder each turn their input into a single vector. Nothing tells the model what a fox is; the only signal is which caption belongs to which image. Our batch has six pairs, starting with a fox astronaut on an ice moon. Real training batches hold thirty two thousand.',
        deep: '<p><b>Dual encoder</b>: image tower f (ViT) and text tower g (Transformer), each followed by a linear projection to a shared width d (CLIP ViT-L/14: d = 768; SigLIP so400m: 1152).</p>' +
          '<div class="eq">x<sub>i</sub> = f(I<sub>i</sub>) ∈ ℝ<sup>d</sup>, &nbsp; y<sub>i</sub> = g(T<sub>i</sub>) ∈ ℝ<sup>d</sup></div>' +
          '<p>Image vector = pooled output ([CLS] token, or SigLIP\'s attention-pooling "MAP" head); text vector = the [EOS] token (CLIP) or last-token pooled output.</p>' +
          '<table><tr><th></th><th>CLIP (2021)</th><th>SigLIP / SigLIP 2</th></tr>' +
          '<tr><td>data</td><td>400 M pairs (WIT)</td><td>WebLI, ~10 B images, 100+ languages</td></tr>' +
          '<tr><td>batch</td><td>32,768</td><td>32 k typical (up to 1 M studied)</td></tr>' +
          '<tr><td>loss</td><td>softmax InfoNCE</td><td>pairwise sigmoid</td></tr></table>' +
          '<div class="note">The towers never see each other\'s input: at inference you can embed millions of images offline and match them to any new text in one dot product — the property that makes retrieval and zero-shot classification cheap.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.imgs = ctx.group();
          for (var i = 0; i < N; i++) thumb(ctx, S.imgs, i, TX0, rowY(i) - 30);
          S.caps = ctx.group();
          CAPS.forEach(function (c, i) {
            ctx.rect(1236, rowY(i) - 17, 304, 34, { rx: 8, fill: ctx.alpha('cyan', 0.08), stroke: ctx.alpha('cyan', 0.55), sw: 1, parent: S.caps });
            ctx.text(1250, rowY(i), '"' + c + '"', { size: 13, font: 'mono', color: 'cyan', parent: S.caps });
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
          S.xLab = ctx.text(372, 262 - 20, 'x_i ∈ ℝᵈ', { size: 13, font: 'mono', color: 'violet', anchor: 'middle', parent: S.eL });
          S.yLab = ctx.text(1056, 262 - 20, 'y_i ∈ ℝᵈ', { size: 13, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.eL });
          S.batchTx = [
            ctx.text(766, 502, 'batch of N = 6 (image, caption) pairs', { size: 16, color: 'dim', anchor: 'middle', parent: S.eL }),
            ctx.text(766, 528, 'the only supervision: which caption goes with which image', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: S.eL })
          ];
          ctx.reveal(S.imgs, { from: 'left' });
          ctx.reveal(S.caps, { from: 'right', delay: 200 });
          ctx.reveal([S.fI, S.gT], { from: 'scale', delay: 500, stagger: 150 });
          S.xv.concat(S.yv).forEach(function (v) { v.setAttribute('opacity', 0); });
          ctx.reveal(S.eL, { delay: 800 });
          return ctx.wait(1300).then(function () {
            return ctx.reveal(S.xv.concat(S.yv), { from: 'scale', stagger: 90 });
          });
        }
      },
      {
        title: 'Unit hypersphere',
        say: 'Both vectors are L2 normalised, which puts every image and every caption on the surface of the same unit hypersphere. After that, similarity is just a dot product: the cosine of the angle between two points. Training will pull each image toward its own caption and push it away from everybody else\'s. In the picture, a two dimensional circle stands in for a sphere in more than a thousand dimensions.',
        deep: '<div class="eq">x̂ = x / ‖x‖₂, &nbsp; ŷ = y / ‖y‖₂, &nbsp; s<sub>ij</sub> = x̂<sub>i</sub>·ŷ<sub>j</sub> = cos θ<sub>ij</sub> ∈ [−1, 1]</div>' +
          '<p>Why normalise? Without it the model can lower the loss by inflating norms instead of learning directions; with it, the only free scale is the learned temperature. Normalisation also makes nearest-neighbour search equivalent under inner product, cosine and Euclidean distance: ‖x̂ − ŷ‖² = 2 − 2 x̂·ŷ.</p>' +
          '<p>Geometry in high dimension is unintuitive: two random unit vectors in ℝ<sup>1152</sup> have cos ≈ 0 ± 1/√1152 ≈ ±0.03. That is why CLIP cosines of 0.30 for a correct pair versus 0.10 for a wrong one are a large margin, even though they look small.</p>' +
          '<div class="note">Alignment and uniformity (Wang &amp; Isola, 2020): contrastive losses optimise both — matched pairs close together, all embeddings spread uniformly over the sphere.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.batchTx, 0, 300);
          var cx = 766, cy = 492, R = 190;
          S.sph = ctx.group();
          ctx.circle(cx, cy, R, { stroke: ctx.alpha('white', 0.35), sw: 1.4, dash: '5 6', parent: S.sph });
          ctx.circle(cx, cy, 3, { fill: 'dim', parent: S.sph });
          ctx.text(cx, cy + R + 28, 'unit sphere (2-D stand-in for ℝ¹¹⁵²) · cos θ = x̂ · ŷ', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: S.sph });
          var ang = [-2.5, -1.75, -0.95, 0.15, 1.05, 2.05], r = ctx.rng(12), pts = [];
          for (var i = 0; i < N; i++) {
            [0, 1].forEach(function (m) {
              var a = ang[i] + (m ? 0.16 : -0.02), r0 = R * (0.45 + 0.9 * r());
              var dot = ctx.circle(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a), 7, { fill: m ? 'cyan' : 'violet', stroke: 'white', sw: 1, parent: S.sph });
              pts.push({ dot: dot, a: a, r0: r0, m: m, i: i });
            });
          }
          var pairs = [];
          for (var k = 0; k < N; k++) {
            var a0 = ang[k] - 0.02, a1 = ang[k] + 0.16;
            pairs.push(ctx.path('M' + (cx + R * Math.cos(a0)).toFixed(1) + ',' + (cy + R * Math.sin(a0)).toFixed(1) + ' A' + R + ',' + R + ' 0 0 1 ' + (cx + R * Math.cos(a1)).toFixed(1) + ',' + (cy + R * Math.sin(a1)).toFixed(1), { stroke: 'amber', sw: 3, parent: S.sph }));
          }
          var lab = ctx.text(cx + (R + 18) * Math.cos(-2.45), cy + (R + 18) * Math.sin(-2.45), 'fox pair: cos 0.34', { size: 12, font: 'mono', color: 'amber', anchor: 'end', parent: S.sph });
          var rays = [];
          pts.forEach(function (p) { rays.push(ctx.line(cx, cy, cx + p.r0 * Math.cos(p.a), cy + p.r0 * Math.sin(p.a), { color: ctx.alpha(p.m ? 'cyan' : 'violet', 0.35), sw: 1, parent: S.sph })); });
          ctx.reveal(S.sph, { dur: 500 });
          pairs.concat([lab]).forEach(function (e) { e.setAttribute('opacity', 0); });
          ctx.hud('x̂ = x / ‖x‖  →  similarity = dot product');
          return ctx.wait(700).then(function () {
            return ctx.tween(1600, function (t) {
              pts.forEach(function (p, i) {
                var rr = ctx.lerp(p.r0, R, t);
                p.dot.setAttribute('cx', (cx + rr * Math.cos(p.a)).toFixed(1)); p.dot.setAttribute('cy', (cy + rr * Math.sin(p.a)).toFixed(1));
                rays[i].setAttribute('x2', (cx + rr * Math.cos(p.a)).toFixed(1)); rays[i].setAttribute('y2', (cy + rr * Math.sin(p.a)).toFixed(1));
              });
            }, 'inOut');
          }).then(function () { return ctx.reveal(pairs.concat([lab]), { from: 'fade', stagger: 120 }); });
        }
      },
      {
        title: 'Similarity matrix',
        say: 'Now compare every image with every caption in the batch. That is one matrix multiply, image embeddings times text embeddings transposed, giving an N by N grid of cosine similarities. The diagonal holds the true pairs; everything off the diagonal is a negative, a caption that belongs to some other image. With a batch of thirty two thousand, each image is contrasted against thirty two thousand captions at once, which is why batch size matters so much for this family of losses.',
        deep: '<div class="eq">S = X̂ Ŷᵀ ∈ ℝ<sup>N×N</sup>, &nbsp; logits = S / τ &nbsp; (CLIP: τ learnable, init 0.07, 1/τ clipped at 100)</div>' +
          '<pre>x = normalize(f(I)); y = normalize(g(T))\nx, y = all_gather(x), all_gather(y)\nlogits = x @ y.T * scale  # 1/τ\nlab = arange(N)            # N = 32k\nloss = (ce(logits, lab)\n      + ce(logits.T, lab)) / 2</pre>' +
          '<p>Cost: the matrix is 32,768² ≈ 1.07 B logits per step — trivial FLOPs next to the encoders, but the <b>all-gather</b> of embeddings and the N×N softmax memory are what limit batch size; CLIP shards the matrix so each device holds only its rows.</p>' +
          '<div class="note">Hard negatives come for free: the fox-astronaut image is also fairly similar to "a glowing ice moon" (0.24) and "a rocket crash-landing" (0.21). Those off-diagonal cells carry most of the gradient.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.sph, 500);
          ctx.fade([S.fI, S.gT], 0.35, 500);
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
          ctx.reveal([S.mat, S.colLab], { dur: 500 });
          /* move text embeddings to column heads, image embeddings next to rows */
          var moves = S.yv.map(function (v, k) { return ctx.transform(v, { x: colX(k) - 38 - 1022, y: MY - 30 - (rowY(k) - 6) }, 1000, 'inOut', 200 + k * 60); });
          var moves2 = S.xv.map(function (v, k) { return ctx.transform(v, { x: 440 - 338 }, 800, 'inOut', 200); });
          S.diag = [];
          return Promise.all(moves.concat(moves2)).then(function () {
            return ctx.tween(2200, function (t) {
              var n = Math.floor(t * N * N);
              for (var k = 0; k < N * N; k++) {
                var i2 = Math.floor(k / N), j3 = k % N, on = k <= n;
                S.mat.cells[i2][j3].setAttribute('fill', on ? ctx.cmap(i2 === j3 ? 'amber' : 'violet', Math.min(1, COS[i2][j3] / 0.36)) : '#0a1224');
                S.valEls[i2][j3].setAttribute('opacity', on ? 1 : 0);
              }
            }, 'linear');
          }).then(function () {
            for (var d = 0; d < N; d++) S.diag.push(S.mat.cells[d][d]);
            S.diag.forEach(function (c) { c.setAttribute('stroke', ctx.C.amber); c.setAttribute('stroke-width', 2.2); });
            S.glow = ctx.loop(function (t) {
              S.diag.forEach(function (c, k) { c.setAttribute('stroke-opacity', (0.4 + 0.6 * Math.abs(Math.sin(t * 2.4 - k * 0.5))).toFixed(2)); });
            });
            ctx.hud('S = X̂Ŷᵀ · 6×6 here · 32,768² in CLIP training');
            return ctx.wait(1200);
          });
        }
      },
      {
        title: 'Symmetric InfoNCE',
        say: 'The CLIP loss treats each row as a classification problem: given this image, which of the N captions is its own? Divide the similarities by a temperature, take a softmax across the row, and apply cross entropy with the diagonal as the correct answer. Then do the same down every column: given this caption, which image? The final loss averages both directions. It is exactly the InfoNCE objective: minimising it raises a lower bound on the mutual information between images and text.',
        deep: '<div class="eq">ℒ<sub>i→t</sub> = −(1/N) Σ<sub>i</sub> log [ exp(s<sub>ii</sub>/τ) / Σ<sub>j</sub> exp(s<sub>ij</sub>/τ) ]</div>' +
          '<div class="eq">ℒ<sub>t→i</sub> = −(1/N) Σ<sub>j</sub> log [ exp(s<sub>jj</sub>/τ) / Σ<sub>i</sub> exp(s<sub>ij</sub>/τ) ], &nbsp; ℒ = ½(ℒ<sub>i→t</sub> + ℒ<sub>t→i</sub>)</div>' +
          '<p>Gradient intuition: ∂ℒ/∂s<sub>ij</sub> = (p<sub>ij</sub> − 𝟙[i=j]) / (Nτ) per direction — every negative is pushed away in proportion to how much probability it steals, so hard negatives dominate.</p>' +
          '<p>InfoNCE bound: I(X; Y) ≥ log N − ℒ<sub>InfoNCE</sub>. Larger N tightens the bound — another reason CLIP wants huge batches.</p>' +
          '<p>At τ = 0.07 for our batch: row 1 gives p(correct) = 0.69, loss 0.38; the mass stolen by "ice moon" (0.16) and "rocket" (0.11) is what the gradient attacks.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.fade([S.caps, S.gT], 0.08, 500);
          S.card = card(ctx, 1040, 236, 505, 530, '', 'violet');
          var G = S.card;
          ctx.text(1064, 266, 'row 1 · image → text  (softmax over captions)', { size: 14, font: 'mono', color: 'violet', parent: G });
          S.rowBars = ctx.bars(1070, 290, 440, 120, [0, 0, 0, 0, 0, 0], { color: ['#ffbf3a', '#9b7bff', '#9b7bff', '#9b7bff', '#9b7bff', '#9b7bff'], labels: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], gap: 14, parent: G });
          ctx.text(1064, 452, 'column 1 · text → image  (softmax over images)', { size: 14, font: 'mono', color: 'cyan', parent: G });
          S.colBars = ctx.bars(1070, 476, 440, 120, [0, 0, 0, 0, 0, 0], { color: ['#ffbf3a', '#22e4ff', '#22e4ff', '#22e4ff', '#22e4ff', '#22e4ff'], labels: ['I1', 'I2', 'I3', 'I4', 'I5', 'I6'], gap: 14, parent: G });
          S.lossTx = ctx.text(1064, 640, '', { size: 15, font: 'mono', color: 'amber', parent: G });
          S.lossTx2 = ctx.text(1064, 666, '', { size: 13, font: 'mono', color: 'text', parent: G });
          S.tauTx = ctx.text(1064, 692, '', { size: 13, font: 'mono', color: 'dim', parent: G });
          S.formula = ctx.text(1064, 740, 'ℒ = ½ ( CE(S/τ, diag) + CE(Sᵀ/τ, diag) )', { size: 14, font: 'mono', color: 'white', parent: G });
          S.rowHl = ctx.rect(MX - 8, MY - 8, PITCH * N - (PITCH - CELL) + 16, CELL + 16, { rx: 8, stroke: 'violet', sw: 2.4, dash: '6 4' });
          S.colHl = ctx.rect(MX - 8, MY - 8, CELL + 16, PITCH * N - (PITCH - CELL) + 16, { rx: 8, stroke: 'cyan', sw: 2.4, dash: '6 4' });
          S.setTau = function (tau, ms) {
            var s = 1 / tau, pr = softmax(COS[0], s), pc = softmax(col(0), s);
            S.tau = tau;
            for (var i = 0; i < N; i++) {
              var p = softmax(COS[i], s);
              for (var j = 0; j < N; j++) S.mat.cells[i][j].setAttribute('fill', ctx.cmap(i === j ? 'amber' : 'violet', 0.1 + 0.9 * p[j]));
            }
            S.lossTx.textContent = 'row 1: p(T1) = ' + pr[0].toFixed(2) + '   loss = ' + (-Math.log(pr[0])).toFixed(3);
            S.lossTx2.textContent = 'batch ℒ (both directions) = ' + clipLoss(s).toFixed(3) + '   (uniform: ln 6 = 1.792)';
            S.tauTx.textContent = 'τ = ' + tau + '  →  logit scale 1/τ = ' + Math.round(s);
            return Promise.all([S.rowBars.update(pr, ms), S.colBars.update(pc, ms)]);
          };
          ctx.reveal(G, { from: 'right' });
          ctx.reveal(S.rowHl, { delay: 300 });
          ctx.reveal(S.colHl, { delay: 900 });
          ctx.hud('cell colour = row softmax at τ · numbers = cosines');
          return ctx.wait(700).then(function () { return S.setTau(0.07, 1200); }).then(function () { return ctx.wait(1200); });
        }
      },
      {
        title: 'Temperature',
        say: 'The temperature controls how peaked those softmaxes are. At a temperature of one, cosines between minus one and one barely change the distribution, and the loss stays near its maximum. CLIP starts at zero point zero seven and learns the value; by the end of training the logit scale saturates at one hundred, so the model is extremely confident. Click the temperature buttons to see the rows sharpen and the loss fall.',
        deep: '<div class="eq">p<sub>ij</sub> = softmax<sub>j</sub>(s<sub>ij</sub> / τ), &nbsp; τ = exp(−t′), t′ learnable (CLIP init t′ = ln(1/0.07) ≈ 2.66)</div>' +
          '<table><tr><th>τ</th><th>1/τ</th><th>p(T1 | I1)</th><th>batch ℒ</th></tr>' +
          '<tr><td>1.0</td><td>1</td><td>≈ 0.20</td><td>≈ 1.61 (ln 6 = 1.79)</td></tr>' +
          '<tr><td>0.1</td><td>10</td><td>≈ 0.54</td><td>≈ 0.46</td></tr>' +
          '<tr><td>0.07</td><td>14.3</td><td>≈ 0.69</td><td>≈ 0.24</td></tr>' +
          '<tr><td>0.01</td><td>100</td><td>≈ 1.00</td><td>&lt; 10<sup>−4</sup></td></tr></table>' +
          '<p><span class="muted">Computed on this 6×6 batch; with N = 32 k negatives the same τ gives far larger losses.</span></p>' +
          '<p>Too low a temperature early in training makes gradients vanish for all but the hardest negatives and destabilises learning; too high and the loss cannot distinguish near-misses. Making it learnable (with a clip at 100) lets the model anneal itself.</p>' +
          '<div class="note">Temperature is also why raw CLIP cosines look "small" (0.2–0.35): the model only needs relative differences of ~0.05 once they are multiplied by 100.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var G = S.card;
          ctx.fade(S.colHl, 0, 300);
          var opts = [1, 0.1, 0.07, 0.01];
          S.tauChips = opts.map(function (tau, i) {
            var g = ctx.group({ parent: G });
            ctx.label(1120 + i * 112, 712, 'τ = ' + tau, { color: 'amber', size: 13, w: 100, parent: g });
            g.style.cursor = 'pointer';
            g.addEventListener('click', function () { S.setTau(tau, 500); mark(tau); });
            return { g: g, tau: tau };
          });
          function mark(tau) { S.tauChips.forEach(function (c) { c.g.setAttribute('opacity', c.tau === tau ? 1 : 0.45); }); }
          ctx.fade(S.formula, 0, 300);
          var hint = ctx.text(1064, 750, 'click a temperature ↑', { size: 12, font: 'mono', color: 'amber', parent: G });
          ctx.reveal(S.tauChips.map(function (c) { return c.g; }).concat([hint]), { from: 'up', stagger: 100 });
          S.tauTx.setAttribute('opacity', 0);
          mark(0.07);
          ctx.hud('learnable τ · CLIP init 0.07 · 1/τ capped at 100');
          var seq = [1, 0.1, 0.07, 0.01];
          return seq.reduce(function (p, tau) {
            return p.then(function () { mark(tau); return S.setTau(tau, 700); }).then(function () { return ctx.wait(900); });
          }, ctx.wait(500));
        }
      },
      {
        title: 'SigLIP: sigmoid loss',
        say: 'SigLIP replaces the softmax with a sigmoid on every cell independently. Each pair is a binary question: do these two belong together, yes or no? The diagonal is labelled plus one, everything else minus one, with a learnable temperature and bias. There is no normalisation across the row, so no device needs to see the whole batch: text embeddings are passed around a ring of accelerators chunk by chunk. It trains better at small batches and scales with less memory.',
        deep: '<div class="eq">ℒ = −(1/|B|) Σ<sub>i</sub> Σ<sub>j</sub> log σ( z<sub>ij</sub> · (t · x̂<sub>i</sub>·ŷ<sub>j</sub> + b) ), &nbsp; z<sub>ij</sub> = +1 if i = j else −1</div>' +
          '<p>Init: t = exp(t′) with t′ = log 10, and b = −10, so the ~N² negatives start with small loss and do not swamp the N positives.</p>' +
          '<ul><li><b>No global normaliser</b>: each device computes its local b×b block, then passes its text chunk to the neighbour (ring / collective-permute) — memory O(b²) per device instead of materialising N×N; no all-gather of the full batch.</li>' +
          '<li><b>Batch size</b>: sigmoid beats softmax clearly below ~16 k; both saturate around 32 k; going to 1 M does not help (Zhai et al.).</li>' +
          '<li><b>Hard negatives</b> visible in the matrix: (fox image, "ice moon") has cos 0.24 → σ ≈ 0.27 at the illustrative t = 100, b = −25, a large per-pair loss.</li></ul>' +
          '<p><b>SigLIP 2</b> (2025) adds a captioning decoder (LocCa), self-distillation and masked prediction for dense features, multilingual data, and NaFlex native-aspect variants — the encoder family most 2025 open VLMs build on.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.card, 400);
          ctx.fade([S.rowHl, S.colHl], 0, 300);
          S.card2 = card(ctx, 1040, 236, 505, 530, '', 'magenta');
          var G = S.card2;
          ctx.text(1064, 266, 'σ(t·cos + b) per cell · labels z = ±1', { size: 14, font: 'mono', color: 'magenta', parent: G });
          ctx.text(1064, 290, 'cells: σ value · lime z = +1 (pair) · magenta z = −1', { size: 12, font: 'mono', color: 'text', parent: G });
          ctx.text(1064, 310, 'illustrative learned t = 100, b = −25', { size: 12, font: 'mono', color: 'dim', parent: G });
          /* device ring demo: 4 devices, 8x8 batch, each owns 2 images + 2 captions */
          var bx = 1110, by = 330, bc = 30;
          var blocks = [];
          for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
            blocks.push({ r: r, c: c, el: ctx.rect(bx + c * (2 * bc + 4), by + r * (2 * bc + 4), 2 * bc, 2 * bc, { rx: 4, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('magenta', 0.35), sw: 1, parent: G }) });
          }
          for (var d = 0; d < 4; d++) {
            ctx.text(bx - 10, by + d * (2 * bc + 4) + bc, 'dev ' + d, { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          }
          var ringTx = ctx.text(bx + 140, by + 4 * (2 * bc + 4) + 20, 'step 0: local blocks', { size: 12, font: 'mono', color: 'magenta', anchor: 'middle', parent: G });
          ctx.para(1064, 630, ['each device: 2 images × all 8 captions', 'captions hop around the ring (collective-permute)', 'no all-gather · no N×N softmax · memory O(b²)'], { size: 13, font: 'mono', color: 'text', lh: 22, parent: G });
          ctx.text(1064, 720, 'batch 32k ≈ saturation · beats softmax < 16k', { size: 13, font: 'mono', color: 'amber', parent: G });
          ctx.reveal(G, { from: 'right' });
          ctx.hud('SigLIP: per-pair sigmoid · no row normalisation');
          /* matrix recolour to sigmoid probabilities with z labels */
          var sv = [];
          for (var i = 0; i < N; i++) { sv.push([]); for (var j = 0; j < N; j++) sv[i].push(sig(100 * COS[i][j] - 25)); }
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
            return [0, 1, 2, 3].reduce(function (p, s) {
              return p.then(function () {
                ringTx.textContent = s === 0 ? 'step 0: local blocks' : 'step ' + s + ': captions shifted by ' + s;
                blocks.forEach(function (b) {
                  if ((b.c - b.r + 4) % 4 === s) { b.el.setAttribute('fill', ctx.alpha('magenta', b.c === b.r ? 0.6 : 0.3)); b.el.setAttribute('stroke', ctx.C.magenta); }
                });
                return ctx.wait(650);
              });
            }, Promise.resolve());
          });
        }
      },
      {
        title: 'Zero-shot & geometry',
        say: 'A trained contrastive model classifies without any training labels. Write each class as a prompt, a photo of a fox, a photo of a cat, embed the prompts, and pick the one closest to the image. Our fox astronaut sketch votes mostly fox, with astronaut a clear second, which is fair. There is also a quirk of geometry: images and texts occupy two separate cones on the sphere, the modality gap, so a matched image and caption sit much further apart than two similar images.',
        deep: '<div class="eq">ŷ<sub>c</sub> = normalize(g("a photo of a {c}")), &nbsp; p(c | I) = softmax<sub>c</sub>(x̂ · ŷ<sub>c</sub> / τ)</div>' +
          '<p>CLIP ViT-L/14@336 reaches 76.2% ImageNet top-1 zero-shot; SigLIP so400m/14@384 ≈ 83%. Prompt ensembling (80 templates averaged) adds 1–5 points.</p>' +
          '<p><b>Modality gap</b> (Liang et al., 2022): embeddings of each modality occupy a narrow cone, caused by initialisation (random encoders already map inputs to cones) and preserved by the contrastive loss at low temperature. Typical numbers: matched image–text cos ≈ 0.3, near-duplicate images cos ≈ 0.8–0.9.</p>' +
          '<p>Practical consequences for this system:</p>' +
          '<ul><li>never compare an image–image score with an image–text score; calibrate thresholds per modality pair;</li>' +
          '<li>for sketch-vs-keyframe style checks use image–image similarity (optionally DINOv2 features, which are more sensitive to style and layout);</li>' +
          '<li>for text→image retrieval, rank within modality only.</li></ul>',
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
          var bars = [];
          prompts.forEach(function (q, i) {
            var y = 420 + i * 58;
            ctx.text(290, y + 12, '"a photo of a ' + q[0] + '"', { size: 13, font: 'mono', color: 'cyan', parent: G });
            ctx.text(290, y + 32, 'cos ' + q[1].toFixed(2), { size: 11, font: 'mono', color: 'dim', parent: G });
            ctx.rect(560, y + 4, 240, 24, { rx: 4, fill: 'rgba(255,255,255,0.04)', parent: G });
            var b = ctx.rect(560, y + 4, 0.01, 24, { rx: 4, fill: ctx.alpha(i === 0 ? 'amber' : 'violet', 0.7), parent: G });
            var t = ctx.text(810, y + 16, (p[i] * 100).toFixed(1) + '%', { size: 13, font: 'mono', color: i === 0 ? 'amber' : 'text', parent: G });
            bars.push({ b: b, w: 240 * p[i], t: t });
          });
          ctx.text(560, 402, 'softmax(cos × 100)', { size: 12, font: 'mono', color: 'dim', parent: G });
          /* modality gap */
          ctx.line(880, 262, 880, 770, { color: 'line', sw: 1, dash: '4 6', parent: G });
          ctx.text(910, 272, 'The modality gap', { size: 17, font: 'display', weight: 700, color: 'white', parent: G });
          var cx = 1215, cy = 520, R = 210;
          ctx.circle(cx, cy, R, { stroke: ctx.alpha('white', 0.3), sw: 1.2, dash: '5 6', parent: G });
          var r = ctx.rng(9), dots = [];
          for (var k = 0; k < 14; k++) {
            var a1 = -2.55 + (r() - 0.5) * 0.55, a2 = -1.55 + (r() - 0.5) * 0.55;
            dots.push(ctx.circle(cx + R * Math.cos(a1), cy + R * Math.sin(a1), 5, { fill: 'violet', parent: G }));
            dots.push(ctx.circle(cx + R * Math.cos(a2), cy + R * Math.sin(a2), 5, { fill: 'cyan', parent: G }));
          }
          var gi = { x: cx + R * 0.93 * Math.cos(-2.55), y: cy + R * 0.93 * Math.sin(-2.55) }, gt = { x: cx + R * 0.93 * Math.cos(-1.55), y: cy + R * 0.93 * Math.sin(-1.55) };
          var gap = ctx.line(gi.x, gi.y, gt.x, gt.y, { color: 'amber', sw: 2.4, arrow: true, parent: G });
          ctx.text(cx - R * 0.95, cy - R * 0.72, 'image cone', { size: 13, font: 'mono', color: 'violet', anchor: 'end', parent: G });
          ctx.text(cx + 70, cy - R - 26, 'text cone',{ size: 13, font: 'mono', color: 'cyan', parent: G });
          ctx.text((gi.x + gt.x) / 2 + 10, (gi.y + gt.y) / 2 + 26, 'gap', { size: 13, font: 'mono', color: 'amber', parent: G });
          ctx.para(910, 640, ['matched image–caption cos ≈ 0.3', 'similar image–image cos ≈ 0.8', '→ never mix thresholds across modalities'], { size: 13, font: 'mono', color: 'text', lh: 22, parent: G });
          ctx.reveal(G, { from: 'scale', s0: 0.95 });
          dots.forEach(function (d) { d.setAttribute('opacity', 0); });
          gap.setAttribute('opacity', 0);
          return ctx.wait(600).then(function () {
            return ctx.tween(1200, function (t) { bars.forEach(function (b) { b.b.setAttribute('width', Math.max(0.01, b.w * t).toFixed(1)); }); }, 'out');
          }).then(function () { return ctx.reveal(dots, { from: 'scale', stagger: 30 }); })
            .then(function () { return ctx.reveal(gap, { from: 'draw', dur: 700 }); });
        }
      },
      {
        title: 'Uses in this system',
        say: 'In the video pipeline, contrastive embeddings do four jobs. They retrieve reference assets from vector memory by text or by image. They score rendered shots against the prompt, CLIPScore style. They check that generated keyframes match the creator\'s sketches. And they condition generators: an image embedding of the reference can steer image to video models. For text conditioning, though, modern video diffusion transformers mostly use T5 or large language model encoders, because CLIP\'s text tower is weak at long, compositional prompts.',
        deep: '<ul><li><b>Retrieval</b>: all reference crops and generated keyframes are embedded once and indexed (HNSW); the storyboard agent queries "fox astronaut, cracked visor, rim light" → top-k crops passed to the video model as references.</li>' +
          '<li><b>CLIPScore</b> (Hessel et al.): <code>2.5 · max(cos(E<sub>I</sub>(frame), E<sub>T</sub>(prompt)), 0)</code>, averaged over sampled frames; cheap, but blind to motion and counting — used as a first-pass filter before the VLM critic.</li>' +
          '<li><b>Style / identity match</b>: image–image cosine between keyframes and the identity crop / sketches; thresholds calibrated on held-out pairs (e.g. re-render if &lt; 0.80).</li>' +
          '<li><b>Conditioning</b>: CLIP-image features feed I2V and adapter paths (Wan 2.1 I2V, IP-Adapter). Text encoders of 2025 video DiTs: umT5-XXL (Wan 2.1), a decoder MLLM plus CLIP-L pooled vector (HunyuanVideo), T5-XXL + CLIP-L/G (SD3-style MM-DiT). CLIP text is capped at 77 tokens and behaves like a bag of words.</li></ul>' +
          '<div class="note">Known blind spots: word order and relations ("fox on moon" vs "moon on fox"), counting, negation, typographic attacks (ARO, Winoground). The critic therefore pairs embedding scores with a VLM judge.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.zs, 400);
          S.use = card(ctx, 60, 236, 1485, 600, 'Where contrastive embeddings work in the video pipeline', 'violet');
          var G = S.use;
          ctx.focus([S.use], 0.08);
          var boxes = [
            [80, 290, 'Retrieve references', 'teal', ['query: "fox astronaut, cracked visor"', 'ŷ = g(query) → HNSW over vector memory', 'top-3 crops: cos 0.31 · 0.29 · 0.27', '→ passed to video model as refs']],
            [820, 290, 'Score shots (CLIPScore)', 'pink', ['shot_03, 8 frames vs shot prompt', '2.5 · max(cos, 0) = 2.5 · 0.31 = 0.78', 'first-pass filter, then VLM critic', 'blind to motion, counting, order']],
            [80, 540, 'Style & identity match', 'amber', ['keyframe vs sketch_2 identity crop', 'image–image cos 0.74 < 0.80 threshold', '→ critic sends shot_03 back', 'DINOv2 features: more style-sensitive']],
            [820, 540, 'Conditioning generators', 'lime', ['I2V / IP-Adapter: CLIP image features', 'text: umT5-XXL (Wan 2.1),', 'MLLM + CLIP-L pooled (HunyuanVideo)', 'CLIP text: 77 tokens, bag-of-words']]
          ];
          var gs = boxes.map(function (b) {
            var g = ctx.group({ parent: G });
            ctx.rect(b[0], b[1], 705, 225, { rx: 12, fill: ctx.alpha(b[3], 0.05), stroke: ctx.alpha(b[3], 0.6), sw: 1.3, parent: g });
            ctx.text(b[0] + 22, b[1] + 32, b[2], { size: 17, font: 'display', weight: 700, color: b[3], parent: g });
            b[4].forEach(function (l, i) { ctx.text(b[0] + 22, b[1] + 72 + i * 34, l, { size: 15, font: 'mono', color: 'text', parent: g }); });
            return g;
          });
          ctx.text(80, 800, 'Thumbnails: every reference and keyframe is embedded once (SigLIP 2, 1152-d) → cosine everywhere downstream.', { size: 13, font: 'mono', color: 'dim', parent: G });
          ctx.reveal(G, { from: 'scale', s0: 0.96 });
          return ctx.reveal(gs, { from: 'up', stagger: 350, delay: 300 }).then(function () {
            return gs.reduce(function (p, g) { return p.then(function () { return ctx.pulse(g, { color: 'violet', dur: 500 }); }); }, Promise.resolve());
          });
        }
      }
    ]
  });
})();
