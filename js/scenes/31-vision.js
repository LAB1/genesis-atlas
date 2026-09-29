/* L2 — Vision Encoders & Visual Tokens. One sketch goes pixel -> patch -> ViT -> merged token -> LLM space.
 * Beat format: each step = beats (narration, callout card, deep-dive chunk, gated animation segment). */
(function () {
  var IX = 60, IY = 232, IS = 448;           /* image placement: 448 scene units == 448 px, 1 patch == 14 units */

  /* ---- geometry of the fox-astronaut sketch (local 0..100 coordinates) ---- */
  function region(u, v) {
    var d = Math.sqrt((u - 50) * (u - 50) + (v - 40) * (v - 40));
    if (d < 17) {
      var hw = v < 44 ? 10 : 10 * (52 - v) / 8;
      if (v >= 30 && v <= 52 && Math.abs(u - 50) <= hw) return 'face';
      return 'helmet';
    }
    if (u >= 36 && u <= 60 && v >= 54 && v <= 82) return 'suit';
    if (Math.sqrt((u - 72) * (u - 72) + (v - 64) * (v - 64)) < 8) return 'tail';
    var s = u / 100;
    if (v > 78 - 28 * s * (1 - s)) return 'ice';
    var t = ((u - 100) * -38 + (v - 2) * 28) / (38 * 38 + 28 * 28);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    if (Math.sqrt(Math.pow(u - (100 - 38 * t), 2) + Math.pow(v - (2 + 28 * t), 2)) < 4.5) return 'trail';
    return 'sky';
  }
  function pix(u, v) {
    var r = region(u, v);
    if (r === 'face') {
      if (Math.hypot(u - 46, v - 41) < 1.4 || Math.hypot(u - 54, v - 41) < 1.4 || Math.hypot(u - 50, v - 48) < 1.3) return '#1a1030';
      if (v > 45 && Math.abs(u - 50) < (52 - v) * 0.9) return '#fff2e6';
      return '#ff8a3d';
    }
    if (r === 'helmet') return Math.hypot(u - 50, v - 40) > 15.8 ? '#e8f1ff' : '#10263f';
    return { suit: '#dfe9ff', tail: '#ff8a3d', ice: '#2a7f93', trail: '#ff9c55', sky: '#081330' }[r];
  }

  function drawFox(ctx, parent) {
    var g = ctx.group({ parent: parent });
    ctx.place(g, IX, IY, IS / 100);
    ctx.rect(0, 0, 100, 100, { rx: 1.5, fill: '#071126', stroke: 'violet', sw: 0.5, parent: g });
    ctx.circle(78, 20, 22, { fill: ctx.alpha('violet', 0.12), parent: g });
    var r = ctx.rng(31);
    for (var i = 0; i < 12; i++) ctx.circle(4 + r() * 92, 3 + r() * 55, 0.35 + r() * 0.35, { fill: 'white', opacity: 0.5 + r() * 0.5, parent: g });
    ctx.path('M100,2 Q80,12 62,30', { stroke: 'orange', sw: 1.2, dash: '3 1.5', parent: g });
    [[88, 9, 2.4], [80, 14, 1.8], [72, 20, 1.3]].forEach(function (p) { ctx.circle(p[0], p[1], p[2], { fill: ctx.alpha('#c8d4ea', 0.25), parent: g }); });
    ctx.path('M0,78 Q50,64 100,78 L100,100 L0,100 Z', { fill: ctx.alpha('cyan', 0.22), stroke: 'cyan', sw: 0.6, parent: g });
    ctx.el('ellipse', { cx: 18, cy: 88, rx: 7, ry: 2, fill: 'none', stroke: ctx.alpha('cyan', 0.6), 'stroke-width': 0.4 }, g);
    ctx.el('ellipse', { cx: 80, cy: 90, rx: 9, ry: 2.4, fill: 'none', stroke: ctx.alpha('cyan', 0.6), 'stroke-width': 0.4 }, g);
    ctx.path('M58,70 Q78,74 76,58', { stroke: 'orange', sw: 4.5, parent: g });
    ctx.circle(76, 58, 2.2, { fill: '#fff2e6', parent: g });
    ctx.rect(36, 56, 6, 14, { rx: 1.5, fill: '#9fb3d9', parent: g });
    ctx.rect(40, 54, 20, 22, { rx: 5, fill: '#dfe9ff', parent: g });
    ctx.line(40, 66, 60, 66, { color: 'orange', sw: 1, parent: g });
    ctx.rect(42, 74, 6, 8, { rx: 1.5, fill: '#cfdcf5', parent: g });
    ctx.rect(52, 74, 6, 8, { rx: 1.5, fill: '#cfdcf5', parent: g });
    ctx.path('M40,60 Q32,64 30,56', { stroke: '#dfe9ff', sw: 3.2, parent: g });
    ctx.circle(50, 40, 17, { stroke: '#e8f1ff', sw: 1.2, fill: ctx.alpha('cyan', 0.1), parent: g });
    ctx.poly([[40, 44], [41, 28], [46, 34], [54, 34], [59, 28], [60, 44], [50, 52]], { fill: '#ff8a3d', parent: g });
    ctx.poly([[43, 45], [50, 52], [57, 45], [50, 47.5]], { fill: '#fff2e6', parent: g });
    [[46, 41], [54, 41]].forEach(function (p) { ctx.circle(p[0], p[1], 1.3, { fill: '#1a1030', parent: g }); });
    ctx.circle(50, 48, 1.2, { fill: '#1a1030', parent: g });
    ctx.path('M58,28 L61,33 L59.5,35 L63,39', { stroke: 'white', sw: 0.5, parent: g });
    ctx.path('M37,36 Q41,27 50,24.5', { stroke: ctx.alpha('white', 0.6), sw: 0.8, parent: g });
    ctx.line(63, 26, 67, 18, { color: '#c8d4ea', sw: 0.7, parent: g });
    ctx.circle(67, 18, 1.2, { fill: 'red', parent: g });
    return g;
  }

  /* one path containing a regular grid (cheap: 1 element) */
  function gridPath(x, y, w, h, nx, ny) {
    var d = '';
    for (var i = 0; i <= nx; i++) d += 'M' + (x + w * i / nx).toFixed(2) + ',' + y + 'V' + (y + h);
    for (var j = 0; j <= ny; j++) d += 'M' + x + ',' + (y + h * j / ny).toFixed(2) + 'H' + (x + w);
    return d;
  }

  var AFF = {
    face: { face: 3, helmet: 1.8, suit: 1.5, tail: 1.3 }, helmet: { helmet: 3, face: 1.8, suit: 1.3 },
    suit: { suit: 3, face: 1.5, helmet: 1.3, tail: 1.4 }, tail: { tail: 3, suit: 1.4, face: 1.3 },
    ice: { ice: 3, trail: 0.6 }, trail: { trail: 3, ice: 0.7, sky: 0.5 }, sky: { sky: 2.2, trail: 0.6 }
  };
  var REGS = ['face', 'helmet', 'suit', 'tail', 'ice', 'trail', 'sky', 'artifact'];

  function cellRegions() {
    var R = [];
    for (var r = 0; r < 16; r++) { R.push([]); for (var c = 0; c < 16; c++) R[r].push(region((c + 0.5) * 6.25, (r + 0.5) * 6.25)); }
    return R;
  }
  /* illustrative attention of query cell (qr,qc) on a 16x16 grid; returns {map, mass} */
  function attention(R, qr, qc) {
    var rq = R[qr][qc], L = [], mx = -1e9;
    for (var r = 0; r < 16; r++) for (var c = 0; c < 16; c++) {
      var aff = (AFF[rq] && AFF[rq][R[r][c]]) || 0;
      var l = 1.4 * aff - 0.12 * Math.hypot(r - qr, c - qc);
      if (r === 1 && c === 2 && !(qr === 1 && qc === 2)) l += 5.4;
      L.push(l); if (l > mx) mx = l;
    }
    var Z = 0, a = L.map(function (l) { var e = Math.exp(l - mx); Z += e; return e; });
    var mass = {}, best = 0;
    REGS.forEach(function (k) { mass[k] = 0; });
    a = a.map(function (e, i) {
      var p = e / Z, r = Math.floor(i / 16), c = i % 16;
      var art = r === 1 && c === 2;
      mass[art ? 'artifact' : R[r][c]] += p;
      if (!art && p > best) best = p;
      return p;
    });
    var map = [];
    for (var r2 = 0; r2 < 16; r2++) { map.push([]); for (var c2 = 0; c2 < 16; c2++) map[r2].push(Math.min(1, Math.pow(a[r2 * 16 + c2] / best, 0.6))); }
    return { map: map, mass: mass };
  }

  function panelTitle(ctx, parent, x, y, s) {
    return ctx.text(x, y, s, { size: 19, font: 'display', weight: 700, color: 'white', parent: parent });
  }
  function road(ctx, S, i) {
    S.pills.forEach(function (p, k) {
      var on = k === i, seen = k < i || (S.seen && S.seen[k]);
      p.r.setAttribute('stroke', on ? ctx.C.violet : (seen ? ctx.alpha('violet', 0.5) : ctx.C.line));
      p.r.setAttribute('fill', on ? ctx.alpha('violet', 0.3) : 'rgba(255,255,255,0.03)');
      p.t.setAttribute('fill', on ? ctx.C.white : (seen ? ctx.C.violet : ctx.C.dim));
    });
    S.seen = S.seen || {};
    for (var k = 0; k <= i; k++) S.seen[k] = true;
  }
  function hide(list) { list.forEach(function (e) { e.setAttribute('opacity', 0); }); }
  function sweep(ctx, list, opts) {
    return list.reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, opts); }); }, Promise.resolve());
  }

  Atlas.register({
    id: 'vision-encoder',
    refs: [
      'Dosovitskiy et al., <i>An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale (ViT)</i>, ICLR 2021; Chen et al., <i>An Empirical Study of Training Self-Supervised Vision Transformers (MoCo v3)</i>, ICCV 2021',
      'Zhai et al., <i>Sigmoid Loss for Language Image Pre-Training (SigLIP)</i>, ICCV 2023; Tschannen et al., <i>SigLIP 2: Multilingual Vision-Language Encoders with Improved Semantic Understanding, Localization, and Dense Features</i>, 2025',
      'Dehghani et al., <i>Patch n\' Pack: NaViT, a Vision Transformer for any Aspect Ratio and Resolution</i>, NeurIPS 2023',
      'Arnab et al., <i>ViViT: A Video Vision Transformer</i> (tubelet embedding), ICCV 2021',
      'Bolya et al., <i>Token Merging: Your ViT But Faster (ToMe)</i>, ICLR 2023',
      'Darcet et al., <i>Vision Transformers Need Registers</i>, ICLR 2024',
      'Chen et al., <i>How Far Are We to GPT-4V? Closing the Gap to Commercial Multimodal Models with Open-Source Suites (InternVL 1.5)</i> (pixel shuffle, dynamic tiling), 2024',
      'Wang et al., <i>Qwen2-VL: Enhancing Vision-Language Model\'s Perception of the World at Any Resolution</i>, 2024; Bai et al., <i>Qwen2.5-VL Technical Report</i>, 2025 (M-RoPE, dynamic resolution)'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'One sketch',
        beats: [
          {
            say: 'Let us follow one of the creator\'s sketches through the vision encoder. After resizing, it is four hundred and forty eight pixels square: about six hundred thousand numbers.',
            card: { tag: 'NUMBERS', title: 'One sketch, raw', stat: { v: '602,112', u: 'numbers', l: '448 × 448 pixels × 3 colour channels, normalised to [−1, 1]' } },
            deep: '<p>Input tensor: <code>[B, 3, 448, 448]</code>, values normalised per channel (SigLIP: <code>(x/255 − 0.5)/0.5</code> → [−1, 1]). 448·448·3 = <b>602,112</b> numbers.</p>' +
              '<p>This is the sketch after the preprocessing of the parent chamber: resized from 2048×1536 to a fixed square (for a native-resolution model it would keep its 4:3 aspect instead).</p>'
          },
          {
            say: 'The encoder must turn those numbers into a few hundred vectors that capture what is in the picture: a fox, a cracked helmet, an ice moon, a painterly style.',
            card: { tag: 'NUMBERS', title: 'What comes out', stat: { v: '256', u: 'vectors', l: 'each 3584 wide, in the language model\'s embedding space: all the LLM will ever see' } },
            deep: '<p>Reference design used in this chamber (numbers are real, the combination is a typical 2025 VLM):</p>' +
              '<table><tr><th>Stage</th><th>Shape</th></tr>' +
              '<tr><td>patchify 14×14</td><td>[1024, 588]</td></tr>' +
              '<tr><td>linear embed</td><td>[1024, 1152]</td></tr>' +
              '<tr><td>27 ViT blocks (SigLIP-2 so400m)</td><td>[1024, 1152]</td></tr>' +
              '<tr><td>2×2 merge (pixel-shuffle)</td><td>[256, 4608]</td></tr>' +
              '<tr><td>MLP projector</td><td>[256, 3584] → LLM</td></tr></table>' +
              '<p><span class="muted">so400m/14 checkpoints ship at 224 or 384 px (27×27 = 729 patches at 384). At 448 px the learned position grid is bicubically resized to 32×32, and VLM recipes normally fine-tune the tower at that resolution. The 3584 width and the 2×2 merge follow the Qwen2.5-VL-7B language side.</span></p>'
          },
          {
            say: 'The roadmap along the top shows the path: patches, positions, transformer blocks, merging, and the projector into the language model.',
            card: { tag: 'HOW IT WORKS', title: 'The road map', body: 'Seven stops: pixels, patchify, 2-D positions, 27 ViT blocks, 2×2 merge, an MLP projector, and finally the LLM.' },
            deep: '<p>Each pill on the roadmap is a step of this chamber. The first four run <i>inside</i> the ViT and produce contextual patch features; the last two adapt them for the language model. The bottom line is that the encoder is a pure function <code>ℝ<sup>3×448×448</sup> → ℝ<sup>256×3584</sup></code>, with about 0.4 B parameters for the ViT and 29 M for the projector.</p>'
          },
          {
            say: 'Everything the planner will ever see of this sketch is those vectors. Whatever the encoder discards, such as thin lines, tiny text or exact hues, is gone for good.',
            card: { tag: 'PITFALL', title: 'What is dropped is gone', body: 'Antenna lights, thin cracks, small print and exact hues can vanish in the bottleneck. The agent re-queries on zoomed crops when it needs detail.' },
            deep: '<div class="note">Everything the planner will ever "see" of this sketch is these 256 vectors. Whatever the encoder discards (thin lines, tiny text, exact hues) is gone for good, which is why the agent re-queries on crops when it needs detail.</div>' +
              '<p>Our sketch lines are only 2–4 px wide, i.e. a fraction of one 14 px patch, so their survival depends on how strongly a patch\'s embedding encodes sub-patch structure.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.img = ctx.group();
          S.fox = drawFox(ctx, S.img);
          S.cap = ctx.text(IX + IS / 2, IY + IS + 22, 'sketch_2.png → 448 × 448 × 3 = 602,112 values', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: S.img });
          /* big numbers */
          S.intro = ctx.group();
          var iA = ctx.group({ parent: S.intro }), iB = ctx.group({ parent: S.intro }), iC = ctx.group({ parent: S.intro });
          var big1 = ctx.text(620, 330, '602,112', { size: 64, font: 'display', weight: 700, color: 'violet', parent: iA, glow: true });
          ctx.text(620, 380, 'numbers in', { size: 16, color: 'dim', parent: iA });
          var big2 = ctx.text(620, 470, '256', { size: 64, font: 'display', weight: 700, color: 'amber', parent: iB, glow: true });
          ctx.text(620, 520, 'vectors out, each in ℝ³⁵⁸⁴, that the LLM can read', { size: 16, color: 'dim', parent: iB });
          ctx.text(620, 600, 'what must survive: identity · pose · materials · palette · style · layout', { size: 14, font: 'mono', color: 'text', parent: iC });
          hide([iA, iB, iC]);
          /* roadmap (built now, revealed in beat 2) */
          S.roadG = ctx.group();
          var names = ['pixels', 'patchify', '+ 2-D pos', 'ViT × 27', 'merge 2×2', 'MLP', 'LLM'];
          S.pills = names.map(function (n, i) {
            var x = 630 + i * 140, g = ctx.group({ parent: S.roadG });
            var r = ctx.rect(x - 58, 176, 116, 30, { rx: 15, fill: 'rgba(255,255,255,0.03)', stroke: 'line', sw: 1.2, parent: g });
            var t = ctx.text(x, 191.5, n, { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            if (i < names.length - 1) ctx.line(x + 60, 191, x + 80, 191, { color: 'faint', arrow: true, parent: S.roadG });
            return { g: g, r: r, t: t };
          });
          road(ctx, S, 0);
          hide([S.roadG]);

          /* beat 0: the raw sketch and its 602,112 numbers */
          ctx.reveal(S.img, { from: 'scale', s0: 0.85, dur: 900 });
          return ctx.wait(700).then(function () {
            ctx.reveal(iA, { from: 'up' });
            return ctx.counter(big1, 0, 602112, 1200);
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: 256 vectors out */
            ctx.reveal(iB, { from: 'up' });
            return ctx.counter(big2, 0, 256, 900).then(function () { return ctx.reveal(iC, { from: 'up' }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the roadmap */
            ctx.reveal(S.roadG, { dur: 300 });
            ctx.reveal(S.pills.map(function (p) { return p.g; }), { from: 'left', stagger: 100, delay: 200 });
            return ctx.wait(1100).then(function () {
              return sweep(ctx, S.pills.map(function (p) { return p.g; }), { color: 'violet', dur: 260 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: fine detail at risk */
            ctx.remove(iA, 300); ctx.remove(iB, 300);
            var risk = ctx.group({ parent: S.intro });
            [[360, 313], [333, 380]].forEach(function (c) { ctx.circle(c[0], c[1], 14, { stroke: 'red', sw: 2, dash: '4 3', parent: risk }); });
            ctx.text(620, 330, 'at risk in the bottleneck', { size: 16, font: 'display', weight: 700, color: 'red', parent: risk });
            ctx.text(620, 362, 'antenna light · about 3 px wide', { size: 14, font: 'mono', color: 'text', parent: risk });
            ctx.text(620, 388, 'visor crack · about 2 px wide', { size: 14, font: 'mono', color: 'text', parent: risk });
            ctx.text(620, 414, 'small print · exact hues · fine texture', { size: 14, font: 'mono', color: 'text', parent: risk });
            ctx.path('M374,313 C470,313 560,330 612,336', { stroke: ctx.alpha('red', 0.7), sw: 1.2, dash: '3 4', parent: risk });
            ctx.path('M347,380 C450,380 560,368 612,364', { stroke: ctx.alpha('red', 0.7), sw: 1.2, dash: '3 4', parent: risk });
            return ctx.reveal(risk, { from: 'fade', dur: 700 }).then(function () { return ctx.pulse(iC, { color: 'red', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Patchify & embed',
        beats: [
          {
            say: 'First the image is cut into a grid of fourteen by fourteen pixel patches. Four hundred forty eight divided by fourteen is thirty two, so we get thirty two by thirty two, one thousand and twenty four patches.',
            card: { tag: 'NUMBERS', title: 'A 32 × 32 grid', stat: { v: '1,024', u: 'patches', l: '(448 / 14)² for a 448 px image cut into 14 px squares' } },
            deep: '<div class="eq">N = (H/P)·(W/P) = (448/14)² = 1024</div>' +
              '<p>Patch size is the key accuracy/cost knob: tokens scale as 1/P², attention as 1/P⁴. ViT-B/16 at 224² gives 196 tokens; SigLIP so400m/14 at 384² gives 729; at 448², 1024.</p>' +
              '<p>The grid drawn over the sketch is exactly this partition: each square is one token-to-be. Patches are non-overlapping and cover every pixel once; 448 is divisible by 14, so no padding or cropping is needed.</p>'
          },
          {
            say: 'Zoom into one patch. It holds fourteen times fourteen times three, which is five hundred eighty eight numbers.',
            card: { tag: 'NUMBERS', title: 'One patch, raw', stat: { v: '588', u: 'numbers', l: '14 × 14 pixels × 3 colour channels for patch (13, 17)' } },
            deep: '<div class="eq">x<sub>p</sub> ∈ ℝ<sup>P²·C</sup> = ℝ<sup>14·14·3 = 588</sup></div>' +
              '<p>The zoom shows the patch at pixel level: a mix of orange fur, a white helmet rim and the dark visor. A lone 14×14 crop of orange fur is ambiguous — fox, flame or sunset — which is why the embedding alone cannot understand the picture.</p>' +
              '<p>The matrix is the raw 14×14 pixel block, three colour planes stacked (588 = 196 pixels × 3). Nothing about neighbouring patches is known yet: the embedding step treats every block independently.</p>'
          },
          {
            say: 'A single learned matrix projects every flattened patch to a vector of width eleven fifty two.',
            card: { tag: 'HOW IT WORKS', title: 'One learned matrix', body: 'Flatten the 588 numbers into a vector and multiply by W_E of shape 1152 × 588. The result is the patch\'s token embedding.' },
            deep: '<div class="eq">e<sub>p</sub> = W<sub>E</sub> x<sub>p</sub> + b, &nbsp; W<sub>E</sub> ∈ ℝ<sup>1152×588</sup></div>' +
              '<p>W<sub>E</sub> holds 1152·588 ≈ 0.68 M parameters, shared across all patches. Its rows look like oriented edge and colour-blob filters, much like the first layer of a CNN.</p>' +
              '<p>Design note: this single linear layer is the only place raw pixels enter the ViT, and it is a known instability source. MoCo v3 (Chen, Xie and He, 2021) found that freezing a <i>random</i> patch projection removed the accuracy dips seen in self-supervised ViT training, evidence that instabilities start at the pixel-to-token boundary.</p>'
          },
          {
            say: 'Do that for all one thousand and twenty four patches and the image becomes a matrix with one row per patch.',
            card: { tag: 'NUMBERS', title: 'The token matrix', stat: { v: '[1024, 1152]', l: 'one row per patch: what the first transformer block will receive' } },
            deep: '<p>Stacking the embeddings gives <code>E ∈ ℝ<sup>1024×1152</sup></code>, the input to block 1. Each row knows its own pixels and, so far, nothing about its neighbours or its position.</p>' +
              '<div class="note">The embedding is linear: a patch is only "understood" after attention mixes it with context.</div>' +
              '<p>Memory: 1024 × 1152 in bf16 is 2.4 MB per image for one copy of the residual stream. At inference only the current layer\'s activations are alive, so a batch of 64 sketches costs ~150 MB of residual stream plus the transient 1024 × 4304 MLP hidden state (8.8 MB per image), which is why ViT inference is compute-bound, not memory-bound.</p>'
          },
          {
            say: 'In code, that is just a convolution whose kernel and stride both equal the patch size, and that patch size is the key accuracy and cost knob.',
            card: { tag: 'TRADE-OFF', title: 'Patch size: cost vs detail', body: 'Tokens scale as 1 over P squared, attention cost as 1 over P to the fourth. Small patches help OCR and thin strokes; large patches are cheaper.' },
            deep: '<pre>embed = nn.Conv2d(3, 1152, 14, stride=14)\nx = embed(img)       # [B,1152,32,32]\nx = x.flatten(2).mT  # [B,1024,1152]</pre>' +
              '<p>Smaller patches help OCR and thin strokes (our sketch lines are 2–4 px), larger patches are cheaper. Halving P quadruples the tokens and multiplies the attention FLOPs by up to 16.</p>' +
              '<table><tr><th>patch P at 448²</th><th>tokens</th><th>attention scores / head</th></tr>' +
              '<tr><td>32</td><td>196</td><td>38 k</td></tr>' +
              '<tr><td>16</td><td>784</td><td>0.61 M</td></tr>' +
              '<tr><td>14</td><td>1,024</td><td>1.05 M</td></tr>' +
              '<tr><td>8</td><td>3,136</td><td>9.8 M</td></tr></table>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 1);
          ctx.remove(S.intro, 400);
          S.grid = ctx.path(gridPath(IX, IY, IS, IS, 32, 32), { stroke: ctx.alpha('violet', 0.45), sw: 0.6, parent: S.img });
          S.pr = 13; S.pc = 17;
          var px0 = IX + S.pc * 14, py0 = IY + S.pr * 14;
          S.patchHl = ctx.rect(px0, py0, 14, 14, { rx: 1, stroke: 'amber', sw: 1.6, parent: S.img });
          S.patchLab = ctx.group({ parent: S.img });
          ctx.line(px0 + 14, py0 + 14, px0 + 24, py0 + 30, { color: 'amber', sw: 1, parent: S.patchLab });
          ctx.rect(px0 + 24, py0 + 30, 160, 22, { rx: 4, fill: 'rgba(5,10,22,0.88)', stroke: 'amber', sw: 1, parent: S.patchLab });
          ctx.text(px0 + 104, py0 + 41, 'patch (13,17) · 14×14 px', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: S.patchLab });
          var P = S.p2 = ctx.group();

          /* beat 0: the 32x32 grid of patches */
          ctx.hud('N = (448 / 14)² = 1024 patches');
          ctx.reveal(S.grid, { dur: 700 });
          return ctx.reveal([S.patchHl, S.patchLab], { delay: 600 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: zoom into one patch, show its 588 numbers */
            panelTitle(ctx, P, 600, 262, 'Patchify + linear embedding');
            var pm = ctx.matrix(600, 300, 14, 14, { cell: 12, gap: 1, parent: P, values: function (i, j) {
              return pix((S.pc + (j + 0.5) / 14) * 100 / 32, (S.pr + (i + 0.5) / 14) * 100 / 32);
            } });
            var t588 = ctx.text(690, 500, '14 × 14 × 3 = 588 numbers', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: P });
            hide([P]);
            return ctx.camera(px0 + 7, py0 + 7, 3, 1000).then(function () {
              return ctx.wait(900);
            }).then(function () {
              ctx.camera(null, null, null, 900);
              ctx.reveal(P, { dur: 300 });
              ctx.reveal(pm, { from: 'scale', s0: 0.1, dur: 800, delay: 300 });
              return ctx.reveal(t588, { delay: 900 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: flatten and project with W_E */
            ctx.line(790, 390, 826, 390, { color: 'violet', arrow: true, parent: P });
            ctx.text(808, 374, 'flatten', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
            var flat = [];
            for (var k = 0; k < 28; k++) {
              var i = Math.floor(k / 2), j = (k % 2) * 7 + 3;
              flat.push(pix((S.pc + (j + 0.5) / 14) * 100 / 32, (S.pr + (i + 0.5) / 14) * 100 / 32));
            }
            var fv = ctx.matrix(836, 278, 28, 1, { cell: 8, gap: 1, values: function (r) { return flat[r]; }, parent: P });
            var xl = ctx.text(840, 540, 'x ∈ ℝ⁵⁸⁸', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: P });
            var mul = ctx.text(875, 400, '×', { size: 22, color: 'dim', anchor: 'middle', parent: P });
            var rr = ctx.rng(4);
            var WE = ctx.matrix(900, 322, 12, 16, { cell: 10, gap: 1, cmap: 'diverge', values: function () { return rr() * 2 - 1; }, parent: P });
            var wl = ctx.text(988, 480, 'W_E ∈ ℝ¹¹⁵²ˣ⁵⁸⁸', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: P });
            var eq = ctx.text(1100, 400, '=', { size: 22, color: 'dim', anchor: 'middle', parent: P });
            S.evals = [];
            for (var q = 0; q < 16; q++) S.evals.push(0.2 + 0.8 * rr());
            var ev = ctx.vector(1126, 318, 16, { cell: 9, gap: 1, cmap: 'violet', values: S.evals, parent: P });
            var el = ctx.text(1131, 302, 'e ∈ ℝ¹¹⁵²', { size: 13, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
            var all = [fv, xl, mul, WE, wl, eq, ev, el];
            hide(all);
            return ctx.reveal(all, { from: 'left', stagger: 220 }).then(function () { return ctx.pulse(ev, { color: 'violet', dur: 700 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: one row per patch */
            var rr2 = ctx.rng(9);
            var ar = ctx.line(1150, 400, 1196, 400, { color: 'violet', arrow: true, parent: P });
            var xt = ctx.text(1173, 384, '× 1024', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
            var E = ctx.matrix(1206, 330, 10, 14, { cell: 12, gap: 2, cmap: 'violet', values: function () { return 0.15 + 0.8 * rr2(); }, parent: P });
            var et = ctx.text(1300, 490, 'E ∈ ℝ¹⁰²⁴ˣ¹¹⁵²  (one row per patch)', { size: 13, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
            hide([ar, xt, E, et]);
            return ctx.reveal([ar, xt, E, et], { from: 'left', stagger: 250 }).then(function () { return ctx.pulse(E, { color: 'violet', dur: 700 }); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: the same thing as a strided convolution */
            S.code2 = ctx.code({ x: 600, y: 590, w: 900, title: 'patch_embed.py', lang: 'py', size: 13, color: 'violet', lines: [
              'embed = nn.Conv2d(3, 1152, kernel_size=14, stride=14)  # == unfold + matmul',
              'x = embed(img)                   # [B, 3, 448, 448] -> [B, 1152, 32, 32]',
              'x = x.flatten(2).transpose(1, 2) # [B, 1024, 1152]: one token per patch'
            ], parent: P });
            return ctx.reveal(S.code2, { from: 'up' });
          });
        }
      },

      /* ------------------------------------------------------------------ 3 */
      {
        title: '2-D positions',
        beats: [
          {
            say: 'Self attention is permutation invariant: shuffle the patches and it would not notice. So each patch needs to know where it sits.',
            card: { tag: 'KEY IDEA', title: 'Attention has no sense of place', body: 'Without position information a transformer treats patches as a bag: shuffle them and the outputs just shuffle with them.' },
            deep: '<p>Self-attention is <b>permutation-equivariant</b>: <code>Attn(ΠX) = Π·Attn(X)</code> for any permutation matrix Π. With no other signal the model cannot tell the sketch from a jigsaw of its own patches.</p>' +
              '<p>The fix is to inject where each patch sits, either <i>additively</i> at the input (learned or sinusoidal embeddings) or <i>multiplicatively</i> inside attention (RoPE).</p>'
          },
          {
            say: 'The classic ViT adds a learned position vector per grid cell, which must be interpolated when the resolution changes.',
            card: { tag: 'HOW IT WORKS', title: 'Learned absolute positions', body: 'One trainable vector per grid cell is added to the patch embedding. A new resolution means resizing the whole table.' },
            deep: '<p><b>Learned absolute</b> (ViT, SigLIP): <code>z<sub>0</sub> = E + P</code>, <code>P ∈ ℝ<sup>32×32×1152</sup></code>. For a new resolution, P is bicubically resized; quality degrades far from the training grid, which is why SigLIP 2 trains <i>NaFlex</i> variants across many sequence lengths.</p>' +
              '<p>The slice on the right is one channel of P for a 6×16 corner: smooth, structured, but tied to one grid.</p>'
          },
          {
            say: 'Newer encoders use two dimensional rotary embeddings: half of each query and key is rotated by an angle set by the row, the other half by the column.',
            card: { tag: 'STATE OF THE ART', title: '2-D rotary embeddings', body: 'EVA-02, FiT and the Qwen2.5-VL ViT rotate half the channels by the row and half by the column. No table, so no interpolation.', more: '<p>Why split the channels in half? It factorises 2-D position into two independent 1-D RoPEs, so the score depends on row and column differences with no cross term. Windowed attention in Qwen2.5-VL relies on exactly this relative form: a window of any shape sees consistent offsets.</p>' },
            deep: '<p><b>2-D RoPE</b> (EVA-02, FiT, Qwen2.5-VL ViT): with head dim d<sub>h</sub>, split the d<sub>h</sub>/2 rotary pairs in half.</p>' +
              '<div class="eq">q̃ = [ R(r·θ<sub>1..d/4</sub>) q<sub>:d/2</sub> ; R(c·θ<sub>1..d/4</sub>) q<sub>d/2:</sub> ], &nbsp; θ<sub>i</sub> = 10000<sup>−4i/d<sub>h</sub></sup></div>' +
              '<p>The dials show each patch\'s two rotation angles growing with its row (violet hand) and column (pink hand).</p>'
          },
          {
            say: 'So attention scores depend only on relative offsets, and any grid size or aspect ratio works.',
            card: { tag: 'WHY IT MATTERS', title: 'Any grid, any aspect ratio', body: 'Scores depend on row and column differences, so the same weights handle a 32 by 32 crop or a wide 44 by 24 frame.' },
            deep: '<div class="eq">⟨q̃<sub>(r,c)</sub>, k̃<sub>(r′,c′)</sub>⟩ = g(q, k, r − r′, c − c′)</div>' +
              '<p>Consequences: translation-equivariant attention, no interpolation step, arbitrary aspect ratios, and a natural extension to 3-D (t, h, w) for video, the same trick used by M-RoPE in the LLM and 3-D RoPE in video DiTs.</p>' +
              '<div class="note">Rotations never change vector norms, so RoPE adds position without polluting the content magnitude, unlike additive embeddings.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 2);
          ctx.hud('');
          ctx.remove(S.p2, 400);
          ctx.remove(S.code2, 400);
          ctx.fade([S.patchHl, S.patchLab], 0, 300);
          var P = S.p3 = ctx.group();
          panelTitle(ctx, P, 600, 262, 'Where is each patch? 2-D position encoding');
          var axC = ctx.text(IX + IS / 2, IY - 12, 'column c = 0 … 31 →', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: P });
          var rl = ctx.text(40, IY + IS / 2, 'row r = 0 … 31 →', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
          rl.setAttribute('transform', 'rotate(90 40 ' + (IY + IS / 2) + ')');
          hide([P]);
          /* beat 0 demo: shuffled patches look identical to attention */
          var demo = ctx.group({ parent: S.p3 });
          var dr = ctx.rng(3);
          var base = [];
          for (var q = 0; q < 16; q++) base.push(0.2 + 0.8 * dr());
          var perm = [5, 12, 3, 9, 0, 14, 7, 2, 11, 6, 15, 1, 8, 13, 4, 10];
          ctx.text(640, 316, 'ordered patches', { size: 12, font: 'mono', color: 'violet', parent: demo });
          ctx.matrix(640, 336, 4, 4, { cell: 24, gap: 3, cmap: 'violet', values: function (r, c) { return base[r * 4 + c]; }, parent: demo });
          ctx.line(772, 388, 812, 388, { color: 'amber', arrow: true, parent: demo });
          ctx.text(792, 372, 'shuffle', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: demo });
          ctx.text(830, 316, 'shuffled patches', { size: 12, font: 'mono', color: 'violet', parent: demo });
          ctx.matrix(830, 336, 4, 4, { cell: 24, gap: 3, cmap: 'violet', values: function (r, c) { return base[perm[r * 4 + c]]; }, parent: demo });
          ctx.text(640, 460, 'without positions: Attn(shuffle(X)) = shuffle(Attn(X))', { size: 13, font: 'mono', color: 'text', parent: demo });
          ctx.text(640, 484, 'the model cannot tell the picture from a jigsaw of it', { size: 13, font: 'mono', color: 'amber', parent: demo });
          hide([demo]);
          /* beat 1 elements: learned absolute */
          var lp = ctx.group({ parent: S.p3 });
          ctx.text(960, 300, 'Learned absolute (ViT, SigLIP)', { size: 14, font: 'mono', color: 'text', parent: lp });
          ctx.text(970, 325, 'z₀ = E + P,   P ∈ ℝ³²ˣ³²ˣ¹¹⁵²', { size: 14, font: 'mono', color: 'text', parent: lp });
          ctx.text(970, 350, 'new resolution → bicubic-resize P', { size: 14, font: 'mono', color: 'text', parent: lp });
          var pt = ctx.matrix(960, 540, 6, 16, { cell: 14, gap: 2, cmap: 'diverge', values: function (a, b) { return Math.sin(b * 0.7 + a * 0.3) * Math.cos(a * 0.9); }, parent: lp });
          ctx.text(960, 660, 'a slice of learned P (6 rows × 16 cols, one channel)', { size: 11, font: 'mono', color: 'dim', parent: lp });
          hide([lp]);
          /* beat 2 elements: 2-D RoPE and the rotating dials */
          var rp = ctx.group({ parent: S.p3 });
          ctx.text(960, 400, '2-D RoPE (EVA-02, Qwen2.5-VL ViT)', { size: 14, font: 'mono', color: 'text', parent: rp });
          ctx.text(970, 425, 'half of q,k rotated by r·θᵢ,', { size: 14, font: 'mono', color: 'text', parent: rp });
          ctx.text(970, 450, 'other half by c·θᵢ', { size: 14, font: 'mono', color: 'text', parent: rp });
          var dialG = ctx.group({ parent: S.p3 });
          var dials = [], th = 0.55;
          for (var r = 0; r < 6; r++) for (var c = 0; c < 6; c++) {
            var cx = 640 + c * 50, cy = 330 + r * 50;
            ctx.circle(cx, cy, 18, { stroke: ctx.alpha('white', 0.25), sw: 1, parent: dialG });
            var h1 = ctx.line(cx, cy, cx + 15, cy, { color: 'violet', sw: 2.4, parent: dialG });
            var h2 = ctx.line(cx, cy, cx + 15, cy, { color: 'pink', sw: 2.4, parent: dialG });
            dials.push({ h1: h1, h2: h2, cx: cx, cy: cy, a1: r * th, a2: c * th });
          }
          for (var i = 0; i < 6; i++) {
            ctx.text(640 + i * 50, 296, 'c=' + i, { size: 11, font: 'mono', color: 'pink', anchor: 'middle', parent: dialG });
            ctx.text(606, 330 + i * 50, 'r=' + i, { size: 11, font: 'mono', color: 'violet', anchor: 'end', parent: dialG });
          }
          ctx.text(765, 640, 'violet hand: channels rotated by r·θ', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: dialG });
          ctx.text(765, 662, 'pink hand: channels rotated by c·θ', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: dialG });
          hide([rp, dialG]);
          function setHands(t) {
            dials.forEach(function (d) {
              d.h1.setAttribute('x2', (d.cx + 15 * Math.cos(d.a1 * t)).toFixed(1)); d.h1.setAttribute('y2', (d.cy - 15 * Math.sin(d.a1 * t)).toFixed(1));
              d.h2.setAttribute('x2', (d.cx + 15 * Math.cos(d.a2 * t)).toFixed(1)); d.h2.setAttribute('y2', (d.cy - 15 * Math.sin(d.a2 * t)).toFixed(1));
            });
          }
          setHands(0);
          /* beat 3 elements */
          var rel = ctx.text(970, 475, '⟨q̃(r,c), k̃(r′,c′)⟩ = g(Δr, Δc)', { size: 14, font: 'mono', color: 'amber', parent: S.p3 });
          var any = ctx.text(970, 500, '→ any grid, any aspect ratio', { size: 14, font: 'mono', color: 'lime', parent: S.p3 });
          hide([rel, any]);

          /* beat 0: attention cannot see order */
          ctx.reveal(P, { dur: 500 });
          return ctx.wait(500).then(function () {
            return ctx.reveal(demo, { from: 'up' });
          }).then(function () {
            return ctx.pulse(demo, { color: 'amber', dur: 700 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: learned absolute position table */
            ctx.remove(demo, 300);
            ctx.reveal(lp, { from: 'up' });
            return ctx.reveal(pt, { from: 'left', delay: 500 });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: 2-D RoPE, two rotations per patch */
            ctx.reveal(rp, { from: 'up' });
            ctx.reveal(dialG, { dur: 500 });
            return ctx.wait(500).then(function () { return ctx.tween(2200, setHands, 'inOut'); }).then(function () { return ctx.wait(400); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: relative-offset property */
            return ctx.reveal([rel, any], { from: 'up', stagger: 250 }).then(function () { return ctx.pulse(rel, { color: 'amber', times: 2, dur: 600 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Transformer blocks',
        beats: [
          {
            say: 'Now the one thousand and twenty four tokens pass through a stack of transformer blocks, twenty seven of them in SigLIP so four hundred m.',
            card: { tag: 'NUMBERS', title: 'A stack of 27 blocks', stat: { v: '27', u: 'blocks', l: 'width 1152, roughly 0.4 B parameters in the SigLIP 2 so400m tower' } },
            deep: '<table><tr><th>SigLIP so400m/14</th><th></th></tr>' +
              '<tr><td>depth / width / MLP</td><td>27 / 1152 / 4304</td></tr>' +
              '<tr><td>heads × head dim</td><td>16 × 72</td></tr>' +
              '<tr><td>params / block</td><td>4d² + 2·d·4304 ≈ 15.2 M</td></tr>' +
              '<tr><td>total (27 blocks)</td><td>≈ 0.41 B</td></tr></table>' +
              '<p>The <b>residual stream</b> (the vertical spine in the diagram) carries the <code>1024×1152</code> token matrix from block to block; each block only adds to it.</p>'
          },
          {
            say: 'Each block normalises, lets every patch attend to every other patch with sixteen heads, and adds the result back to the residual stream.',
            card: { tag: 'HOW IT WORKS', title: 'Pre-norm self-attention', body: 'LayerNorm, then 16 heads of 72 dimensions each, then add to the stream. The 1024 by 1024 map shows who attends to whom.', more: '<p>Per head: <code>Q, K, V ∈ ℝ<sup>1024×72</sup></code>; scores <code>QKᵀ/√72 ∈ ℝ<sup>1024×1024</sup></code>; output <code>AV</code>, heads concatenated to width 1152 and mixed by <code>W<sub>O</sub></code>. SigLIP so400m uses a learned attention-pooling head (MAP) at the very end.</p>' },
            deep: '<div class="eq">X′ = X + MHSA(LN(X))</div>' +
              '<div class="eq">MHSA: A<sub>h</sub> = softmax(Q<sub>h</sub>K<sub>h</sub><sup>ᵀ</sup>/√72) ∈ ℝ<sup>1024×1024</sup>, h = 1..16</div>' +
              '<p>Every one of the 1024 patches computes a probability distribution over all 1024 patches, per head. The map on the right is a 16×16 sample: the diagonal (self-attention) and same-object blocks are brightest.</p>'
          },
          {
            say: 'Then it normalises again and applies a wide MLP, adding that back to the residual stream as well.',
            card: { tag: 'NUMBERS', title: 'A wide MLP', stat: { v: '1152 → 4304', l: 'hidden width, about 3.7× the model width, applied to each token independently' } },
            deep: '<div class="eq">X″ = X′ + MLP(LN(X′))</div>' +
              '<p>The MLP is where most parameters live: <code>2·1152·4304 ≈ 9.9 M</code> per block against <code>4·1152² ≈ 5.3 M</code> for attention. Attention <i>mixes across</i> tokens; the MLP <i>transforms within</i> each token, acting like a key-value memory of features.</p>' +
              '<p>Qwen2.5-VL\'s ViT uses RMSNorm + SwiGLU here instead of LayerNorm + GELU.</p>'
          },
          {
            say: 'There is no causal mask: the whole picture is visible at once, so patches can attend in every direction.',
            card: { tag: 'KEY IDEA', title: 'Bidirectional attention', body: 'Unlike the language model, the ViT never hides the future. All 1024 by 1024 scores are live in every layer.' },
            deep: '<p>An LLM masks the upper triangle so token <i>i</i> cannot see token <i>j &gt; i</i>. A ViT has no notion of "earlier" patch, so it uses the <b>full</b> matrix: 1024² = 1.05 M scores per head and layer, no masking, no KV cache needed at inference.</p>' +
              '<div class="note">Variants: Qwen2.5-VL\'s ViT uses <i>window attention</i> in most layers; InternViT-6B scales the encoder itself to about 6 B parameters (45 layers in InternVL 1.5); DINOv2 and SigLIP 2 add self-distillation and masked-prediction losses for denser features.</div>'
          },
          {
            say: 'The whole stack costs about one teraflop per image, a couple of milliseconds on a modern GPU.',
            card: { tag: 'NUMBERS', title: 'Cost per image', stat: { v: '≈ 1 TFLOP', l: '0.84 linear + 0.13 attention: about 2 ms on an H100 at 50% utilisation' }, more: '<p>Attention breaks even with the linear layers at N = P/(2·L·d) ≈ 6.6 k tokens, i.e. about a 1134² px input at patch 14. Above that, window attention or token merging becomes essential.</p>' },
            deep: '<p>FLOPs per 448² image: linear ≈ 2·P·N = 2·0.41 B·1024 ≈ <b>0.84 TFLOP</b>; attention ≈ 4·L·N²·d = 4·27·1024²·1152 ≈ <b>0.13 TFLOP</b>. Total ≈ 1 TFLOP → ~2 ms on an H100 at 50% MFU.</p>' +
              '<p>Attention is a small share at 1024 tokens but grows quadratically: it breaks even with the linear layers at N = P/(2·L·d) ≈ 6.6 k tokens (≈ 1134² input at patch 14).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 3);
          ctx.remove(S.p3, 400);
          ctx.fade(S.grid, 0.4, 400);
          var P = S.p4 = ctx.group();
          var cx = 860;

          /* beat 0: token matrix in, stack of blocks, the residual stream */
          panelTitle(ctx, P, 600, 262, 'Pre-norm ViT block  × 27');
          var xin = ctx.vector(604, 320, 12, { cell: 16, gap: 2, cmap: 'violet', values: function (r) { return 0.3 + 0.05 * r; }, parent: P });
          var xl1 = ctx.text(612, 548, 'X', { size: 14, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
          var xl2 = ctx.text(612, 568, '1024×1152', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          var plates = [];
          for (var k = 5; k >= 1; k--) plates.push(ctx.rect(700 + k * 7, 292 + k * 7, 290, 400, { rx: 12, fill: 'rgba(12,16,34,0.8)', stroke: ctx.alpha('violet', 0.12 + 0.03 * (5 - k)), sw: 1, parent: P }));
          plates.push(ctx.rect(700, 292, 290, 400, { rx: 12, fill: 'rgba(12,16,34,0.95)', stroke: 'violet', sw: 1.4, parent: P }));
          var main = ctx.path('M632,420 H720 V300 H' + cx + ' V312 M' + cx + ',348 V383 M' + cx + ',427 V457 M' + cx + ',479 V512 M' + cx + ',548 V583 M' + cx + ',627 V655 M' + cx + ',677 V700', { stroke: 'violet', sw: 1.6, parent: P });
          var x27 = ctx.text(998, 290, '× 27', { size: 22, font: 'display', weight: 700, color: 'violet', anchor: 'start', parent: P });
          var b0 = [xin, xl1, xl2].concat(plates, [x27]);
          hide(b0); hide([main]);
          ctx.hud('27 blocks · 16 heads · N = 1024 · ~1 TFLOP');
          ctx.reveal(b0, { dur: 400, stagger: 40 });
          return ctx.reveal(main, { from: 'draw', dur: 900, delay: 500 }).then(function () {
            return ctx.pulse(plates[plates.length - 1], { color: 'violet', dur: 700 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: LayerNorm + multi-head self-attention + residual add */
            var N0 = ctx.node({ x: cx, y: 330, w: 190, h: 36, title: 'LayerNorm', color: 'violet', titleSize: 13, glow: false, parent: P });
            var N1 = ctx.node({ x: cx, y: 405, w: 190, h: 44, title: 'Self-attention', sub: '16 heads × 72', color: 'magenta', titleSize: 13, subSize: 11, glow: false, parent: P });
            var plus1 = ctx.circle(cx, 468, 11, { stroke: 'white', sw: 1.4, fill: '#0b1324', parent: P });
            var pt1 = ctx.text(cx, 468, '+', { size: 16, color: 'white', anchor: 'middle', parent: P });
            S.res1 = ctx.path('M720,300 V468 H849', { stroke: ctx.alpha('white', 0.5), sw: 1.4, dash: '4 4', arrow: true, parent: P });
            /* attention matrix */
            var R = cellRegions(), keys = [];
            for (var a = 0; a < 16; a++) keys.push(R[Math.floor(a / 16 * 16)][[2, 5, 8, 8, 8, 11, 13, 7, 8, 9, 4, 14, 1, 6, 10, 12][a]]);
            S.am = ctx.matrix(1060, 300, 16, 16, { cell: 13, gap: 2, cmap: 'heat', values: function (i, j) { return i === j ? 1 : (keys[i] === keys[j] ? 0.7 : 0.08 + 0.1 * Math.abs(Math.sin(i * 3 + j))); }, parent: P });
            S.amT = [ctx.text(1180, 556, 'A = softmax(QKᵀ/√72) · bidirectional', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: P }),
              ctx.text(1180, 576, '16×16 sample of the 1024×1024 map', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P })];
            S.blk1 = [N0, N1, plus1, pt1];
            hide(S.blk1); hide([S.res1, S.am]); hide(S.amT);
            ctx.reveal(S.blk1, { from: 'down', stagger: 200, dur: 500 });
            ctx.reveal(S.res1, { from: 'draw', delay: 700, dur: 700 });
            ctx.reveal(S.am, { from: 'scale', delay: 900 });
            ctx.reveal(S.amT, { delay: 1500 });
            return ctx.wait(1900).then(function () { return ctx.pulse(N1, { color: 'magenta', dur: 700 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: second norm + MLP + second residual add */
            var N2 = ctx.node({ x: cx, y: 530, w: 190, h: 36, title: 'LayerNorm', color: 'violet', titleSize: 13, glow: false, parent: P });
            var N3 = ctx.node({ x: cx, y: 605, w: 190, h: 44, title: 'MLP', sub: '1152→4304→1152', color: 'cyan', titleSize: 13, subSize: 11, glow: false, parent: P });
            S.plus2 = ctx.circle(cx, 666, 11, { stroke: 'white', sw: 1.4, fill: '#0b1324', parent: P });
            var pt2 = ctx.text(cx, 666, '+', { size: 16, color: 'white', anchor: 'middle', parent: P });
            S.res2 = ctx.path('M' + cx + ',490 H735 V666 H849', { stroke: ctx.alpha('white', 0.5), sw: 1.4, dash: '4 4', arrow: true, parent: P });
            var rs = ctx.text(742, 560, 'residual', { size: 11, font: 'mono', color: 'dim', anchor: 'start', parent: P });
            var els = [N2, N3, S.plus2, pt2];
            hide(els); hide([S.res2, rs]);
            ctx.reveal(els, { from: 'down', stagger: 200, dur: 500 });
            ctx.reveal(S.res2, { from: 'draw', delay: 700, dur: 700 });
            ctx.reveal(rs, { delay: 1200 });
            return ctx.wait(1500).then(function () { return ctx.pulse(N3, { color: 'cyan', dur: 700 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: no causal mask */
            var over = ctx.poly([[1060, 300], [1300, 300], [1300, 540]], { fill: 'rgba(5,10,22,0.9)', stroke: 'red', sw: 1.2, parent: P });
            var chipA = ctx.label(1200, 284, 'causal LLM: upper half masked', { color: 'red', size: 11, parent: P });
            var chipB = ctx.label(1200, 284, 'ViT: no mask, everything visible', { color: 'lime', size: 11, parent: P });
            hide([over, chipA, chipB]);
            return ctx.reveal([over, chipA], { from: 'fade', stagger: 100, dur: 500 }).then(function () {
              return ctx.wait(1100);
            }).then(function () {
              ctx.fade(over, 0, 600); ctx.fade(chipA, 0, 300);
              ctx.reveal(chipB, { from: 'fade', delay: 300 });
              return ctx.pulse(S.am, { color: 'lime', times: 2, dur: 600 });
            }).then(function () { ctx.remove(over, 100); ctx.remove(chipA, 100); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: cost of the whole stack, data flowing through */
            var stats = ctx.para(1060, 620, ['params ≈ 27 × 15.2 M ≈ 0.41 B', 'linear  ≈ 2·P·N ≈ 0.84 TFLOP', 'attn    ≈ 4·L·N²·d ≈ 0.13 TFLOP', '≈ 1 TFLOP / image → ~2 ms on H100'], { size: 13, font: 'code', pre: true, color: 'text', lh: 22, parent: P });
            ctx.reveal(stats, { from: 'up' });
            return ctx.wait(500).then(function () {
              return Promise.all([
                ctx.packet(main, { color: 'violet', dur: 2600, label: 'x' }),
                ctx.wait(500).then(function () { return ctx.packet(S.res1, { color: 'white', dur: 900, r: 4 }); }),
                ctx.wait(1500).then(function () { return ctx.packet(S.res2, { color: 'white', dur: 900, r: 4 }); })
              ]);
            }).then(function () { return ctx.pulse(S.plus2, { color: 'violet', dur: 600 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 5 */
      {
        title: 'What a patch attends to',
        beats: [
          {
            say: 'Here is an illustrative attention map from one query patch on the fox\'s face, in a late layer. It lights up the rest of the head, the helmet, the suit and the tail: the encoder has grouped pixels into an object, far beyond local neighbourhoods.',
            card: { tag: 'KEY IDEA', title: 'Attention groups objects', body: 'From a patch on the fox\'s face, late-layer attention reaches the helmet, suit and tail: whole-object grouping, not local blur.' },
            deep: '<div class="eq">α<sub>ij</sub> = exp(q<sub>i</sub>·k<sub>j</sub>/√d<sub>h</sub>) / Σ<sub>j′</sub> exp(q<sub>i</sub>·k<sub>j′</sub>/√d<sub>h</sub>)</div>' +
              '<p>The map shown is illustrative (pooled to the 16×16 merged grid, 28 px cells) but reproduces what probing real encoders shows: early layers attend locally (edges, colour), late layers attend by <b>object and semantics</b>; heads specialise.</p>'
          },
          {
            say: 'Watch the query move to the ice, and then to the smoke trail. Each time, attention follows the object that the patch belongs to.',
            card: { tag: 'HOW IT WORKS', title: 'Attention follows the object', body: 'Query on the ice: mass stays on the ice. Query on the trail: it spreads to the trail and its neighbours. Bars sum the mass per region.' },
            deep: '<p>Why this matters downstream: the critic compares shots with the identity crop in embedding space; if identity is encoded by object-level attention, small pose changes do not break the similarity, while colour drift of the suit does.</p>' +
              '<p>The bars on the right integrate the attention row over semantic regions (face, helmet, suit, tail, ice, trail, sky) so you can read what each query "looks at" at a glance.</p>'
          },
          {
            say: 'Notice one bright patch in empty sky. Large vision transformers repurpose low information patches as scratch registers, and those artifact tokens show up as bright spots.',
            card: { tag: 'PITFALL', title: 'High-norm artifact tokens', body: 'Big ViTs park global information in redundant background patches. Adding a few register tokens (Darcet et al., 2024) removes the spots.', more: '<p>Diagnosing artifacts: compute the L2 norm of every output token. Artifacts are outliers with roughly 10× the norm of ordinary tokens, about 2% of the tokens in the paper\'s DINOv2 measurement (2.37% above a norm of 150). Registers give the network dedicated scratch space, so the norms flatten and dense tasks such as segmentation improve.</p>' },
            deep: '<p><b>Artifact tokens</b> (Darcet et al., 2024): large, well-trained ViTs (DINOv2, OpenCLIP, DeiT-III in the paper) develop high-norm tokens in redundant background patches that aggregate global information; attention maps show bright spots in empty sky.</p>' +
              '<p>Fix: append a few learnable <i>register</i> tokens (the paper settles on 4 and tests 1 to 16) that are discarded at the output: cleaner maps and better dense features.</p>'
          },
          {
            say: 'Now it is your turn. Click any patch on the sketch to move the query yourself, and read off where its attention mass goes by region.',
            card: { tag: 'TRY IT', title: 'Click any patch', body: 'Move the query anywhere on the sketch. The bars show how its attention mass splits over face, helmet, suit, tail, ice, trail, sky and the artifact.' },
            deep: '<div class="note">Interactive: click any cell on the sketch. The bars on the right show where the query\'s attention mass goes, per region.</div>' +
              '<p>Try a sky patch: most of its mass goes to other sky cells, plus the bright artifact token. Try the ice: it stays on the ice. Try the suit: it reaches face and helmet as well as itself.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 3);
          ctx.hud('');
          ctx.remove(S.p4, 400);
          ctx.fade(S.grid, 0.15, 400);
          ctx.fade(S.cap, 0, 300);
          var R = cellRegions();
          S.heat = ctx.group();
          var cells = [];
          for (var r = 0; r < 16; r++) {
            cells.push([]);
            for (var c = 0; c < 16; c++) {
              var el = ctx.rect(IX + c * 28, IY + r * 28, 28, 28, { rx: 0, fill: '#000', parent: S.heat });
              el.style.cursor = 'pointer';
              (function (rr, cc, e) { e.addEventListener('click', function () { S.setQ(rr, cc, 350); }); })(r, c, el);
              cells[r].push(el);
            }
          }
          var qMark = ctx.rect(0, 0, 28, 28, { rx: 3, stroke: 'white', sw: 2.4, parent: S.heat });
          var P = S.p5 = ctx.group();
          panelTitle(ctx, P, 600, 262, 'Attention from one query patch');
          ctx.text(600, 292, 'layer 24 · head 7 · pooled to the 16×16 merged grid (illustrative)', { size: 12, font: 'mono', color: 'dim', parent: P });
          S.qLab = ctx.text(600, 336, '', { size: 16, font: 'mono', color: 'amber', parent: P });
          ctx.text(600, 372, 'attention mass by region', { size: 13, font: 'mono', color: 'text', parent: P });
          var cols = ['orange', 'white', 'blue', 'orange', 'cyan', 'amber', 'violet', 'pink'];
          S.bars = ctx.bars(600, 400, 560, 200, [0, 0, 0, 0, 0, 0, 0, 0], { color: cols, labels: REGS, gap: 14, labelSize: 12, parent: P });
          var side = ctx.para(1200, 410, ['Early layers: local', 'edges and colour.', 'Late layers: whole', 'objects, semantics.', '', 'Bright sky patch =', 'high-norm "artifact"', 'token (registers fix it).'], { size: 13, font: 'mono', color: 'text', lh: 22, parent: P });
          S.clickHint = ctx.label(IX + IS / 2, IY + IS + 22, 'click any patch to move the query', { color: 'amber', size: 12, parent: P });
          hide([side, S.clickHint]);
          S.setQ = function (qr, qc, ms) {
            var A = attention(R, qr, qc);
            for (var r2 = 0; r2 < 16; r2++) for (var c2 = 0; c2 < 16; c2++) {
              var v = A.map[r2][c2];
              cells[r2][c2].setAttribute('fill', ctx.cmap('heat', v));
              cells[r2][c2].setAttribute('fill-opacity', (0.15 + 0.7 * v).toFixed(3));
            }
            qMark.setAttribute('x', IX + qc * 28); qMark.setAttribute('y', IY + qr * 28);
            S.qLab.textContent = 'query = patch (' + qr + ',' + qc + ') · region: ' + R[qr][qc];
            return S.bars.update(REGS.map(function (k) { return Math.min(1, A.mass[k] * 1.25); }), ms);
          };

          /* beat 0: a face patch attends to the whole astronaut */
          S.setQ(6, 8, 0);
          ctx.reveal([S.heat, P], { dur: 600, stagger: 200 });
          return ctx.wait(1800).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the query moves to the ice, then the trail */
            return S.setQ(14, 3, 500).then(function () { return ctx.wait(1400); }).then(function () {
              return S.setQ(2, 13, 500);
            }).then(function () { return ctx.wait(1200); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: back to the face; the bright artifact patch in empty sky */
            return S.setQ(6, 8, 500).then(function () {
              S.artHl = ctx.highlight(cells[1][2], { color: 'amber', pad: 3, rx: 4 });
              S.artLab = ctx.label(IX + 2 * 28 + 86, IY + 42, 'artifact token', { color: 'amber', size: 11, bg: '#1a1206' });
              ctx.reveal(S.artLab, { from: 'left' });
              return ctx.reveal(side, { from: 'up' });
            }).then(function () { return ctx.pulse(cells[1][2], { color: 'amber', times: 2, dur: 600 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: hand over to the viewer */
            return ctx.reveal(S.clickHint, { from: 'up' }).then(function () { return ctx.pulse(qMark, { color: 'white', times: 2, dur: 600 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Native resolution packing',
        beats: [
          {
            say: 'Real inputs are not square. Squashing a wide storyboard frame into a square distorts it, and padding every image to the same size wastes compute.',
            card: { tag: 'PITFALL', title: 'Squash or pad: both waste', stat: { v: '5,808', u: 'tokens', l: 'three inputs each padded to 616 × 616 (1,936 tokens per image)' } },
            deep: '<table><tr><th>input</th><th>pixels</th><th>patches</th></tr>' +
              '<tr><td>sketch_1 (4:3)</td><td>448×336</td><td>32×24 = 768</td></tr>' +
              '<tr><td>sketch_3 (16:9-ish)</td><td>616×336</td><td>44×24 = 1056</td></tr>' +
              '<tr><td>keyframe thumb</td><td>224×224</td><td>16×16 = 256</td></tr></table>' +
              '<p>Padding all three to 616×616 costs 3 × 1936 = 5808 tokens, 64% of them padding.</p>' +
              '<p>Squashing a 616×336 storyboard frame into 448×448 changes its aspect ratio by 1.8×, turning circles into ellipses; letterbox padding preserves shape but spends compute on blank patches. NaViT-style packing removes both costs.</p>'
          },
          {
            say: 'NaViT style encoders keep each image at its native aspect ratio, cut it into patches, and pack several images into one long sequence.',
            card: { tag: 'NUMBERS', title: 'Packed sequence', stat: { v: '2,080', u: 'tokens', l: 'versus 5,808 padded: 64% fewer, and no distortion of the pictures' }, more: '<p>Training with packing: NaViT samples a different resolution and aspect ratio per image, so one run sees many shapes. Example packing, as in LLM pre-training, keeps utilisation near 100%, and dropping random patches per image acts as regularisation and speeds up training.</p>' },
            deep: '<p><b>Patch n\' Pack</b> (NaViT): images of any size → patch sequences of different lengths → concatenated into one row of the batch, with per-image position ids and a block-diagonal mask.</p>' +
              '<table><tr><th>input</th><th>patches</th></tr><tr><td>packed total</td><td><b>2080</b> (vs 3×1936 = 5808 padded, 64% waste)</td></tr></table>' +
              '<p>Sides are multiples of 28 so the later 2×2 merge divides evenly.</p>'
          },
          {
            say: 'A block diagonal attention mask keeps the images from attending to each other, so packing never leaks information between unrelated pictures.',
            card: { tag: 'HOW IT WORKS', title: 'Block-diagonal mask', body: 'Patches attend freely inside their own image and not at all across images: the mask is three squares along the diagonal.' },
            deep: '<p>The attention mask is <b>block diagonal</b>: block <i>k</i> is all-ones for the <i>n<sub>k</sub></i> patches of image <i>k</i>, and zero everywhere else. Row and column positions restart for every image (NaViT uses factorised x and y position embeddings; RoPE-based encoders reset their 2-D indices), so they are relative to that image.</p>' +
              '<p>Without the mask, a sketch patch could attend to a keyframe patch and its features would depend on which images happened to share a batch row.</p>'
          },
          {
            say: 'With variable length attention kernels, packing costs nothing extra, and our three different shaped inputs fit in two thousand and eighty tokens instead of almost six thousand padded ones.',
            card: { tag: 'HOW IT WORKS', title: 'Varlen kernels, zero padding', body: 'cu_seqlens holds each image\'s start offset. FlashAttention skips everything outside the blocks: no padding FLOPs, no leaks.' },
            deep: '<pre>cu = [0, 768, 1824, 2080]   # int32 offsets\nout = flash_attn_varlen_func(q, k, v,\n        cu_seqlens_q=cu, cu_seqlens_k=cu,\n        max_seqlen_q=1056, max_seqlen_k=1056)</pre>' +
              '<p>One kernel launch, work proportional to Σ n<sub>k</sub>² (768² + 1056² + 256² ≈ 1.77 M scores) instead of 2080² = 4.3 M for full attention over the packed row, or 3 × 1936² = 11.2 M padded.</p>'
          },
          {
            say: 'Qwen two point five VL goes further with window attention in most layers, so cost grows roughly linearly with image area, while SigLIP two ships one native aspect checkpoint for many sequence lengths.',
            card: { tag: 'STATE OF THE ART', title: 'Window attention and NaFlex', body: 'Qwen2.5-VL: 8×8-patch windows in most layers, full attention in only 4 of 32. SigLIP 2 NaFlex: one checkpoint, native aspect ratios.' },
            deep: '<p><b>Window attention</b> (Qwen2.5-VL ViT): most layers attend inside 8×8-patch (112 px) windows and only 4 of 32 layers use full attention, so cost grows ~linearly with image area. SigLIP 2 <b>NaFlex</b> ships one checkpoint that handles many sequence lengths and native aspect ratios.</p>' +
              '<div class="note">Packing also enables token dropping during training (NaViT drops random patches per image: faster training, robustness).</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 1);
          ctx.remove(S.heat, 400);
          ctx.remove(S.p5, 400);
          ctx.remove(S.artHl, 300);
          ctx.remove(S.artLab, 300);
          ctx.transform(S.img, { x: 34.8, y: 134.56, s: 0.42 }, 900, 'inOut');
          var P = S.p6 = ctx.group();
          var ims = [[320, 300, 32, 24, 'violet', 'sketch_1 · 448×336 → 768'], [560, 300, 44, 24, 'pink', 'sketch_3 · 616×336 → 1056'], [870, 300, 16, 16, 'cyan', 'keyframe · 224² → 256']];
          var tot = 2080, x0 = 320, W = 1200, y0 = 505, acc = 0;
          var mx = 320, my = 600, M = 240;

          /* beat 0: three differently shaped inputs; padding wastes compute */
          panelTitle(ctx, P, 300, 262, 'Patch n\' Pack: native aspect ratios, one sequence');
          var gs = ims.map(function (m) {
            var g = ctx.group({ parent: P });
            ctx.rect(m[0], m[1], m[2] * 6, m[3] * 6, { rx: 2, fill: ctx.alpha(m[4], 0.15), stroke: m[4], sw: 1.4, parent: g });
            ctx.path(gridPath(m[0], m[1], m[2] * 6, m[3] * 6, m[2], m[3]), { stroke: ctx.alpha(m[4], 0.35), sw: 0.6, parent: g });
            ctx.text(m[0], m[1] + m[3] * 6 + 18, m[5], { size: 12, font: 'mono', color: m[4], parent: g });
            return g;
          });
          var padTx = ctx.group({ parent: P });
          ctx.text(1010, 330, 'padding all to 616×616:', { size: 13, font: 'mono', color: 'dim', parent: padTx });
          ctx.text(1010, 352, '3 × 1936 = 5808 tokens', { size: 13, font: 'mono', color: 'red', parent: padTx });
          hide([P]);
          return ctx.wait(500).then(function () {
            ctx.reveal(P, { dur: 300 });
            ctx.reveal(gs, { from: 'up', stagger: 200 });
            ctx.reveal(padTx, { from: 'left', delay: 800 });
            return ctx.wait(1400);
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: one packed sequence */
            var pk = ctx.text(1010, 374, 'packed: 2080 (−64%)', { size: 13, font: 'mono', color: 'lime', parent: P });
            var st = ctx.text(320, 488, 'packed sequence', { size: 13, font: 'mono', color: 'text', parent: P });
            var segs = ims.map(function (m) {
              var n = m[2] * m[3], x = x0 + acc / tot * W, w = n / tot * W;
              var seg = ctx.rect(x, y0, w - 3, 26, { rx: 4, fill: ctx.alpha(m[4], 0.45), stroke: m[4], sw: 1.2, parent: P });
              ctx.text(x, y0 + 42, String(acc), { size: 11, font: 'mono', color: 'dim', parent: P });
              acc += n;
              return seg;
            });
            ctx.text(x0 + W, y0 + 42, '2080', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: P });
            var cu = ctx.text(x0 + W / 2, y0 + 62, 'cu_seqlens = [0, 768, 1824, 2080]', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: P });
            hide([pk, st, cu]);
            ctx.reveal([st, pk, cu], { from: 'up', stagger: 200 });
            return ctx.reveal(segs, { from: 'left', stagger: 250, delay: 500 }).then(function () { return ctx.wait(500); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: block-diagonal attention mask */
            ctx.rect(mx, my, M, M, { rx: 2, fill: 'rgba(255,77,109,0.06)', stroke: ctx.alpha('red', 0.4), sw: 1, dash: '3 4', parent: P });
            var a2 = 0;
            var blocks = ims.map(function (m) {
              var n = m[2] * m[3], o = a2 / tot * M, s = n / tot * M;
              a2 += n;
              return ctx.rect(mx + o, my + o, s, s, { rx: 1, fill: ctx.alpha(m[4], 0.5), stroke: m[4], sw: 1, parent: P });
            });
            var mt = ctx.text(mx + M / 2, my + M + 18, 'attention mask: block-diagonal', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: P });
            hide(blocks); hide([mt]);
            ctx.reveal(mt, { delay: 200 });
            return ctx.reveal(blocks, { from: 'scale', stagger: 250 }).then(function () { return ctx.pulse(blocks[1], { color: 'pink', dur: 600 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: varlen attention: no padding FLOPs */
            var pv = ctx.para(610, 630, ['flash_attn_varlen_func(q, k, v, cu_seqlens)', '→ one kernel, zero padding FLOPs, no cross-image leaks'], { size: 14, font: 'mono', color: 'text', lh: 26, parent: P });
            return ctx.reveal(pv, { from: 'up' });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: window attention, NaFlex */
            var pw = ctx.para(610, 686, ['Qwen2.5-VL ViT: window attention in 8×8-patch windows,', '→ full attention in only 4 of 32 layers: ~linear in area', 'SigLIP 2 NaFlex: one checkpoint, native aspect, variable length'], { size: 14, font: 'mono', color: 'text', lh: 26, parent: P });
            return ctx.reveal(pw, { from: 'up' });
          });
        }
      },

      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Video: tubelets',
        beats: [
          {
            say: 'Video reuses the same encoder. The critic samples our five second shot at two frames per second, giving ten frames.',
            card: { tag: 'NUMBERS', title: 'A five second shot', stat: { v: '10', u: 'frames', l: '5 s × 2 fps, each 448 × 448 and worth 1,024 patches' } },
            deep: '<table><tr><th>stage</th><th>count</th></tr>' +
              '<tr><td>5 s × 2 fps</td><td>10 frames</td></tr>' +
              '<tr><td>patches (448², /14)</td><td>10 × 1024 = 10,240</td></tr></table>' +
              '<p>Encoded frame by frame, that is 10,240 ViT tokens and 2,560 LLM tokens after the 2×2 merge for a five-second clip, twice what the parent chamber budgeted. The next beats halve this using time.</p>' +
              '<p>This is shot_03 of the running example: 24 fps on disk, so the sampler drops 11 of every 12 frames and only the ones at 0, 0.5, 1 … 4.5 s reach the encoder.</p>'
          },
          {
            say: 'Instead of encoding each frame separately, consecutive pairs are fused into tubelets of two frames by fourteen by fourteen pixels.',
            card: { tag: 'HOW IT WORKS', title: 'Tubelets: patches with depth', body: 'A tubelet is a 14 by 14 patch taken across two consecutive frames: 2 × 14 × 14 × 3 = 1,176 values.' },
            deep: '<div class="eq">tubelet = T<sub>p</sub>×P×P×C = 2×14×14×3 = 1176 values → Conv3d(k = s = (2,14,14)) → ℝ<sup>d</sup></div>' +
              '<p>This is ViViT\'s "tubelet embedding" (Arnab et al., 2021): the 3-D analogue of patchify. Motion inside the tube (a shifting edge between the two frames) is encoded directly in the token.</p>'
          },
          {
            say: 'A three dimensional convolution produces one token per tubelet. That halves the count to five thousand one hundred and twenty tokens inside the encoder.',
            card: { tag: 'NUMBERS', title: 'Half the tokens', stat: { v: '5,120', u: 'tokens', l: '5 tubelet layers × 1,024 patches inside the ViT, down from 10,240' } },
            deep: '<table><tr><th>stage</th><th>count</th></tr>' +
              '<tr><td>2-frame tubelets</td><td>5 × 1024 = 5,120 ViT tokens</td></tr></table>' +
              '<p>Full attention over 5,120 tokens is 5,120² ≈ 26 M scores per head and layer, 25× the single-image case; this is why Qwen2.5-VL uses window attention in most ViT layers for video. A 60 s clip at the same settings would be 61,440 ViT tokens, impossible without windowing or heavy pooling.</p>'
          },
          {
            say: 'The two by two merge later brings it to twelve hundred and eighty tokens for the language model.',
            card: { tag: 'NUMBERS', title: 'For the LLM', stat: { v: '1,280', u: 'tokens', l: '5 layers × 256 merged tokens: a five second shot at 2 fps' } },
            deep: '<table><tr><th>stage</th><th>count</th></tr>' +
              '<tr><td>2×2 merge</td><td>5 × 256 = <b>1,280</b> LLM tokens</td></tr></table>' +
              '<div class="note">Rule of thumb: video understanding cost ∝ seconds × fps × (H·W / 28²) / T<sub>p</sub>. The agent chooses fps and resolution per question.</div>' +
              '<p>At 1,280 tokens the five-second shot costs as much LLM prefill as five separate sketches, and about 73 MB of KV cache at 56 KiB per token (1,280 × 57,344 B). This is the same 1,280 that the parent chamber counted for shot_03.</p>'
          },
          {
            say: 'A single image is simply a frame duplicated, so one stem serves both, and temporal ids advance two per second. The price is that two frames half a second apart fuse into one token, blurring fast motion.',
            card: { tag: 'TRADE-OFF', title: 'Fast motion blurs', body: 'Tubelets fuse frames 0.5 s apart. The visor flicker at 3.1 to 3.6 s reaches only one sampled frame, blended with a clean one. Sample a short window at higher fps.' },
            deep: '<p>Single images are duplicated into two identical frames so the same Conv3d stem serves both (Qwen2-VL / 2.5-VL). Temporal position ids advance per tubelet; Qwen2.5-VL maps them to absolute time (2 ids per second).</p>' +
              '<p>Trade-offs: tubelets are cheap temporal compression but fuse two frames sampled 0.5 s apart into one token, blurring fast motion. The critic\'s flicker (visor reflection at 3.1–3.6 s) is seen by only one sampled frame, the one at 3.5 s, and tubelet 3 fuses it with the clean frame at 3.0 s: one token carries a diluted flicker and cannot say when it started. A <b>higher fps on a short window</b> is better than more seconds at low fps. Alternatives: per-frame encoding + temporal pooling (LLaVA-Video), or learned temporal resamplers.</p>' +
              '<p>Rule of thumb for the critic: for motion questions (flicker, lip sync) raise the fps and shorten the window; for scene-level questions lower the fps and cover more seconds.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          function padR(s, n) { while (s.length < n) s += ' '; return s; }
          function padL(s, n) { while (s.length < n) s = ' ' + s; return s; }
          function row(l, v) { return padR(l, 29) + '= ' + padL(v, 13); }
          road(ctx, S, 1);
          ctx.remove(S.p6, 400);
          var P = S.p7 = ctx.group();
          panelTitle(ctx, P, 300, 262, 'shot_03.mp4 · 5 s @ 2 fps = 10 frames → 5 tubelets');
          var frames = [];
          for (var i = 0; i < 10; i++) {
            var x = 320 + i * 120, y = 290, g = ctx.group({ parent: P });
            ctx.place(g, x, y, 1.6);
            ctx.rect(0, 0, 50, 50, { rx: 3, fill: '#071126', stroke: ctx.alpha('lime', 0.6), sw: 1, parent: g });
            ctx.path('M0,42 Q25,34 50,42 V50 H0 Z', { fill: ctx.alpha('cyan', 0.3), parent: g });
            var fx = 34 - i * 1.4, fy = 10 + i * 2.0;
            ctx.path('M50,1 L' + (fx + 3) + ',' + (fy - 3), { stroke: ctx.alpha('orange', 0.7), sw: 1, dash: '2 2', parent: g });
            ctx.circle(fx, fy, 6, { stroke: 'white', sw: 1, fill: ctx.alpha('cyan', 0.15), parent: g });
            ctx.poly([[fx - 4, fy + 1], [fx - 3, fy - 4], [fx + 3, fy - 4], [fx + 4, fy + 1], [fx, fy + 4]], { fill: 'orange', parent: g });
            frames.push(g);
          }
          hide([P]);

          /* beat 0: ten sampled frames */
          ctx.reveal(P, { dur: 300 });
          return ctx.reveal(frames, { from: 'up', stagger: 110 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: pairs of frames fuse into tubelets */
            var brs = [], labs = [];
            for (var k = 0; k < 5; k++) {
              var bx = 320 + k * 240;
              brs.push(ctx.path('M' + (bx + 2) + ',378 v9 H' + (bx + 198) + ' v-9', { stroke: 'lime', sw: 1.6, parent: P }));
              labs.push(ctx.text(bx + 100, 406, 'tubelet ' + k + ' · t=' + (2 * k), { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: P }));
            }
            var cx0 = 360, cy0 = 540, s = 130, dx = 56, dy = -40;
            var cube = ctx.group({ parent: P });
            ctx.rect(cx0 + dx, cy0 + dy, s, s, { rx: 2, fill: ctx.alpha('lime', 0.08), stroke: ctx.alpha('lime', 0.6), sw: 1.2, parent: cube });
            [[0, 0], [s, 0], [0, s], [s, s]].forEach(function (p) { ctx.line(cx0 + p[0], cy0 + p[1], cx0 + p[0] + dx, cy0 + p[1] + dy, { color: ctx.alpha('lime', 0.6), sw: 1.2, parent: cube }); });
            ctx.rect(cx0, cy0, s, s, { rx: 2, fill: ctx.alpha('lime', 0.18), stroke: 'lime', sw: 1.6, parent: cube });
            ctx.path(gridPath(cx0, cy0, s, s, 7, 7), { stroke: ctx.alpha('lime', 0.3), sw: 0.6, parent: cube });
            ctx.text(cx0 + s / 2, cy0 + s + 18, '14 px', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: cube });
            ctx.text(cx0 - 10, cy0 + s / 2, '14 px', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: cube });
            ctx.text(cx0 + s + dx / 2 + 8, cy0 + s + dy / 2 + 4, '2 frames', { size: 12, font: 'mono', color: 'lime', parent: cube });
            ctx.text(cx0 - 20, cy0 + s + 50, 'tubelet 2×14×14×3 = 1176 → Conv3d → 1 token', { size: 13, font: 'mono', color: 'text', parent: cube });
            S.hl = ctx.rect(316, 284, 208, 96, { rx: 6, stroke: 'amber', sw: 2, parent: P });
            hide([cube, S.hl]);
            ctx.reveal(brs, { from: 'draw', stagger: 200 });
            ctx.reveal(labs, { stagger: 200, delay: 300 });
            return ctx.wait(1400).then(function () {
              ctx.reveal(S.hl, { dur: 300 });
              return ctx.reveal(cube, { from: 'scale', dur: 700 });
            }).then(function () { return ctx.wait(500); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: a 3-D convolution, one token per tubelet; count in the ViT */
            S.tl = [];
            var rows = [row('5 s × 2 fps', '10 frames'), row('10 frames × 32×32 patches', '10,240 patches'), row('pair frames → tubelets', '5,120 ViT tokens')];
            rows.forEach(function (s2, i2) { S.tl.push(ctx.text(790, 540 + i2 * 36, s2, { size: 15, font: 'code', pre: true, color: 'text', parent: P })); });
            hide(S.tl);
            ctx.hud('10 frames → 5 tubelets → 5,120 ViT tokens');
            var sweepT = ctx.tween(2400, function (t) { S.hl.setAttribute('x', 316 + Math.min(4, Math.floor(t * 5)) * 240); }, 'linear');
            var typed = ctx.reveal(S.tl, { from: 'left', stagger: 450, delay: 300 });
            return Promise.all([sweepT, typed]).then(function () { S.hl.setAttribute('x', 316 + 4 * 240); return ctx.pulse(S.tl[2], { color: 'lime', dur: 600 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the 2x2 merge gives the LLM token count */
            ctx.hud('5 tubelets × 256 = 1,280 LLM tokens');
            var t3 = ctx.text(790, 540 + 3 * 36, row('2×2 merge', '1,280 LLM tokens'), { size: 15, font: 'code', pre: true, color: 'amber', parent: P });
            hide([t3]);
            return ctx.reveal(t3, { from: 'left' }).then(function () { return ctx.pulse(t3, { color: 'amber', dur: 700 }); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: images use the same stem; temporal ids */
            var t4 = ctx.text(790, 540 + 4 * 36, 'image = frame duplicated ×2 → same Conv3d stem', { size: 15, font: 'code', pre: true, color: 'text', parent: P });
            var t5 = ctx.text(790, 540 + 5 * 36, 'temporal ids 0, 2, 4, 6, 8 (2 per second, M-RoPE)', { size: 15, font: 'code', pre: true, color: 'amber', parent: P });
            var fl = ctx.label(1140, 434, 'visor flicker 3.1–3.6 s', { color: 'red', size: 11, bg: '#0d1a33', parent: P });
            hide([t4, t5, fl]);
            S.hl.setAttribute('x', 316 + 3 * 240);
            ctx.reveal(fl, { from: 'down' });
            return ctx.reveal([t4, t5], { from: 'left', stagger: 300 }).then(function () { return ctx.pulse(S.hl, { color: 'red', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Token compression',
        beats: [
          {
            say: 'Five thousand tokens for one short shot is still too many for a language model, so encoders compress them. The first tool is a simple reshape called pixel shuffle.',
            card: { tag: 'WHY IT MATTERS', title: 'Tokens are the bill', body: 'Every visual token costs LLM prefill compute and KV cache for the rest of the conversation. Compression is where the budget is won.' },
            deep: '<p>Every visual token costs LLM prefill compute (2·7.6 B ≈ 15 GFLOP per token) and 56 KiB of KV cache for the rest of the conversation: a 256-token sketch is 3.9 TFLOP and about 15 MB. Compression is where the budget is won.</p>' +
              '<p><b>Pixel shuffle / 2×2 patch merge</b> (InternVL, Qwen2-VL / 2.5-VL and Idefics3 use 2×2; SmolVLM shuffles 3×3 for 9× fewer tokens; MiniCPM-V instead uses a query resampler):</p>' +
              '<div class="eq">[H/14, W/14, C] → reshape → [H/28, W/28, 4C] : &nbsp;32×32×1152 → 16×16×4608</div>' +
              '<p>The slice on the left is an 8×8 corner of the 32×32 feature grid.</p>'
          },
          {
            say: 'Pixel shuffle takes each two by two neighbourhood of patch features and concatenates them along the channel axis: four times fewer tokens, four times wider, and nothing is thrown away yet. The projector learns what to keep.',
            card: { tag: 'NUMBERS', title: 'Four times fewer tokens', stat: { v: '4×', l: '32×32×1152 becomes 16×16×4608: same numbers, reshaped, so the reshape itself is lossless' }, more: '<p>Shape bookkeeping: view [B,32,32,1152] → [B,16,2,16,2,1152] → permute → [B,16,16,2,2,1152] → reshape [B,256,4608]. The reshape is free; the cost moves into the projector, whose first layer now has 4608×3584 weights instead of 1152×3584.</p>' },
            deep: '<p>Lossless reshape; information is only discarded by the following MLP (4608 → 3584). The merged token keeps the 2-D layout: token (<i>i</i>, <i>j</i>) covers a 28×28 pixel block.</p>' +
              '<p><b>Pooling</b> is the alternative: 2×2 average or bilinear pooling of the feature map (LLaVA-OneVision for video frames), or learned query resamplers for fixed budgets. Pooling discards; pixel shuffle defers the decision.</p>'
          },
          {
            say: 'Token merging, or ToMe, instead finds pairs of very similar tokens inside the ViT and averages them, layer by layer.',
            card: { tag: 'HOW IT WORKS', title: 'ToMe: bipartite matching', body: 'Split tokens into two sets, match each A token to its most similar B token, and merge the top r pairs by size-weighted average.' },
            deep: '<p><b>ToMe</b> (bipartite soft matching), inside each block between attention and MLP:</p>' +
              '<pre>A, B = x[::2], x[1::2]\nS = cos(k[A], k[B])    # key similarity\nj = S.argmax(1)        # best B per A\n# merge top-r edges (size-weighted):\nx_B = (s_A x_A + s_B x_B)/(s_A + s_B)\nlogits += log(s)       # prop. attention</pre>' +
              '<p>Proportional attention (adding log of the token size to the attention logits) keeps merged tokens from being under-weighted.</p>'
          },
          {
            say: 'Merging the most similar pairs roughly doubles throughput without any retraining, at a tiny accuracy cost.',
            card: { tag: 'NUMBERS', title: 'ToMe payoff', stat: { v: '~ 2×', l: 'ViT-L/H throughput at 0.2–0.3% ImageNet accuracy cost, with no retraining' } },
            deep: '<p>With r tokens merged per layer the count drops by r·L; on off-the-shelf ViT-L @ 512 and ViT-H @ 518 this gives 2× throughput at a 0.2–0.3% ImageNet accuracy drop, training-free (Bolya et al.). For video the paper reports 2.2× on ViT-L at a similar drop, since static background repeats across frames.</p>' +
              '<div class="note">Rule: compress <i>after</i> the encoder has mixed context (pixel-shuffle, pooling) to keep semantics; compress <i>inside</i> (ToMe) to save encoder FLOPs.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 4);
          ctx.hud('');
          ctx.remove(S.p7, 400);
          var P = S.p8 = ctx.group();
          var small = [], x0 = 330, y0 = 320;

          /* beat 0: an 8x8 slice of the patch-feature grid */
          panelTitle(ctx, P, 300, 262, 'Pixel-shuffle 2×2 merge');
          var sub = ctx.text(300, 290, '8×8 slice of the 32×32 grid → 4×4, channels ×4', { size: 12, font: 'mono', color: 'dim', parent: P });
          var cells = ctx.group({ parent: P });
          for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
            var col = pix((c + 0.5) * 12.5 * 0.5 + 25, (r + 0.5) * 12.5 * 0.5 + 18);
            var e = ctx.rect(x0 + c * 30, y0 + r * 30, 26, 26, { rx: 3, fill: col, stroke: ctx.alpha('white', 0.25), sw: 0.6, parent: cells });
            small.push({ e: e, r: r, c: c, x: x0 + c * 30, y: y0 + r * 30 });
          }
          hide([P]);
          ctx.reveal(P, { dur: 300 });
          return ctx.reveal(cells, { from: 'scale', s0: 0.8, dur: 700, delay: 200 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: neighbours concatenate along channels */
            var sh = ctx.text(330 + 120, 580, '32×32×1152 → 16×16×4608', { size: 13, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
            var sh2 = ctx.text(330 + 120, 602, 'concat 4 neighbours on the channel axis', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
            hide([sh, sh2]);
            var mw = 58, gap = 6, sw = mw / 4;
            ctx.reveal([sh, sh2], { from: 'up', stagger: 200, delay: 900 });
            return ctx.wait(500).then(function () {
              return ctx.tween(1600, function (t) {
                small.forEach(function (s) {
                  var br = s.r >> 1, bc = s.c >> 1, k = (s.r % 2) * 2 + (s.c % 2);
                  var tx = x0 + bc * (mw + gap) + k * sw, ty = y0 + br * (mw + gap);
                  s.e.setAttribute('x', ctx.lerp(s.x, tx, t).toFixed(1));
                  s.e.setAttribute('y', ctx.lerp(s.y, ty, t).toFixed(1));
                  s.e.setAttribute('width', ctx.lerp(26, sw, t).toFixed(1));
                  s.e.setAttribute('height', ctx.lerp(26, mw, t).toFixed(1));
                  s.e.setAttribute('rx', ctx.lerp(3, 0, t).toFixed(1));
                });
              }, 'inOut');
            }).then(function () { return ctx.wait(500); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: ToMe: bipartite matching between similar tokens */
            var T = S.tome = ctx.group({ parent: P });
            ctx.text(700, 262, 'ToMe · bipartite soft matching', { size: 19, font: 'display', weight: 700, color: 'white', parent: T });
            var tone = [0.1, 0.8, 0.15, 0.55, 0.85, 0.3, 0.12, 0.78, 0.5, 0.2, 0.9, 0.6];
            S.tA = []; S.tB = [];
            for (var i = 0; i < 6; i++) {
              S.tA.push({ x: 740 + i * 80, y: 340, v: tone[2 * i] });
              S.tB.push({ x: 740 + i * 80, y: 470, v: tone[2 * i + 1] });
            }
            ctx.text(700, 340, 'A', { size: 16, font: 'mono', color: 'violet', anchor: 'middle', parent: T });
            ctx.text(700, 470, 'B', { size: 16, font: 'mono', color: 'violet', anchor: 'middle', parent: T });
            S.tA.forEach(function (a) {
              var bi = 0, bd = 9;
              S.tB.forEach(function (b, j) { var d = Math.abs(a.v - b.v); if (d < bd) { bd = d; bi = j; } });
              a.best = bi; a.sim = 1 - bd;
            });
            var order = S.tA.map(function (a, i) { return i; }).sort(function (p, q) { return S.tA[q].sim - S.tA[p].sim; });
            S.top = order.slice(0, 3);
            var edges = [];
            S.tA.forEach(function (a, ia) {
              var b = S.tB[a.best], hot = S.top.indexOf(ia) >= 0;
              edges.push(ctx.path('M' + a.x + ',' + (a.y + 18) + ' L' + b.x + ',' + (b.y - 18), { stroke: hot ? 'amber' : ctx.alpha('white', 0.25), sw: hot ? 2.4 : 1, parent: T }));
              ctx.text(a.x + 22, a.y - 14, a.sim.toFixed(2), { size: 11, font: 'mono', color: hot ? 'amber' : 'dim', parent: T });
            });
            S.Ac = S.tA.map(function (a) { return ctx.circle(a.x, a.y, 16, { fill: ctx.cmap('heat', a.v), stroke: 'white', sw: 1, parent: T }); });
            S.Bc = S.tB.map(function (b) { return ctx.circle(b.x, b.y, 16, { fill: ctx.cmap('heat', b.v), stroke: 'white', sw: 1, parent: T }); });
            var pr = ctx.para(700, 540, ['split tokens alternately into A and B', 'each A picks its most similar B (cosine of keys)'], { size: 13, font: 'mono', color: 'text', lh: 23, parent: T });
            hide([T]);
            ctx.reveal(T, { dur: 400 });
            return ctx.reveal(edges, { from: 'draw', stagger: 120, delay: 600 }).then(function () { return ctx.wait(600); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: merge the most similar pairs */
            var T = S.tome;
            var pr2 = ctx.para(700, 586, ['merge the top-r edges (here r = 3): 12 → 9 tokens', 'size-weighted mean + proportional attention (+log s)', '~2× ViT-L throughput, 0.2–0.3% acc drop, no retraining'], { size: 13, font: 'mono', color: 'text', lh: 23, parent: T });
            var pool = ctx.text(330, 660, 'pooling (avg / bilinear 2×2) and learned resamplers are the other two families', { size: 13, font: 'mono', color: 'dim', parent: P });
            hide([pr2, pool]);
            ctx.reveal([pr2, pool], { from: 'up', stagger: 300 });
            return ctx.tween(1400, function (t) {
              S.top.forEach(function (ia) {
                var a = S.tA[ia], b = S.tB[a.best];
                S.Ac[ia].setAttribute('cy', ctx.lerp(a.y, b.y, t).toFixed(1));
                S.Ac[ia].setAttribute('cx', ctx.lerp(a.x, b.x, t).toFixed(1));
                S.Ac[ia].setAttribute('opacity', (1 - t).toFixed(3));
                S.Bc[a.best].setAttribute('r', (16 + 6 * t).toFixed(1));
                S.Bc[a.best].setAttribute('fill', ctx.cmap('heat', (a.v + b.v) / 2 * t + b.v * (1 - t)));
              });
            }, 'inOut').then(function () { return ctx.wait(400); });
          });
        }
      },

      /* ------------------------------------------------------------------ 9 */
      {
        title: 'Projector into the LLM',
        beats: [
          {
            say: 'Finally, each merged token, now four thousand six hundred and eight numbers wide, goes through a two layer MLP with a GELU in between, landing in the language model\'s embedding space of width three thousand five hundred and eighty four.',
            card: { tag: 'NUMBERS', title: 'A small MLP bridge', stat: { v: '≈ 29 M', u: 'params', l: 'LayerNorm, Linear 4608 → 3584, GELU, Linear 3584 → 3584' } },
            deep: '<div class="eq">h = W<sub>2</sub> · GELU(W<sub>1</sub> · LN(z) + b<sub>1</sub>) + b<sub>2</sub>, &nbsp; W<sub>1</sub> ∈ ℝ<sup>3584×4608</sup>, W<sub>2</sub> ∈ ℝ<sup>3584×3584</sup></div>' +
              '<p>≈ 29 M parameters and 2·29 M·256 ≈ 15 GFLOP per image: negligible next to the ViT (~1 TFLOP) and the LLM prefill (2·7.6 B·256 ≈ 3.9 TFLOP for these 256 tokens).</p>'
          },
          {
            say: 'Every twenty eight by twenty eight pixel square of the sketch has become exactly one token.',
            card: { tag: 'KEY IDEA', title: 'One token per 28 × 28 block', body: 'The amber grid is the final token layout: 16 by 16 blocks, each 28 pixels square, each one 3584-dimensional vector.' },
            deep: '<table><tr><th>input</th><th>LLM tokens</th></tr>' +
              '<tr><td>one 448² sketch</td><td>256 (1 token = 28×28 px)</td></tr>' +
              '<tr><td>three sketches</td><td>768</td></tr>' +
              '<tr><td>5 s shot @ 2 fps</td><td>1,280</td></tr>' +
              '<tr><td>1080p frame, native res</td><td>(1932/28)·(1092/28) ≈ 2,691</td></tr></table>' +
              '<p>The amber grid is the same 16×16 layout the LLM receives: token (i, j) sits at row-major position 16i + j, and its M-RoPE height and width ids are the same i and j offsets. The model recovers 2-D structure from the position ids, not from sequence order.</p>'
          },
          {
            say: 'Two hundred fifty six of them describe this sketch, and the agent can now ask the language model anything about it.',
            card: { tag: 'NUMBERS', title: 'The sketch in the LLM', stat: { v: '256', u: 'tokens', l: 'projected vectors enter the language model beside the words of the prompt' } },
            deep: '<p>Training the bridge: in the common two-stage recipe, stage 1 freezes ViT and LLM and trains only the projector on image–caption pairs (558 k pairs in LLaVA-1.5); stage 2 unfreezes the LLM, and in many recipes the ViT at a lower LR, on interleaved and instruction data. Some studies find the first stage can be skipped.</p>' +
              '<div class="note">Design space summary: patch size, resolution policy (fixed / tiles / native), positional scheme, compression (shuffle / ToMe / pooling / resampler) and projector depth — each trades detail for tokens.</div>'
          },
          {
            say: 'The whole detour is cheap: about a teraflop in the encoder, fifteen gigaflops in the projector, and roughly four teraflops for the language model to read these tokens.',
            card: { tag: 'WHY IT MATTERS', title: 'The LLM is the expensive part', body: 'ViT ~1 TFLOP, projector 15 GFLOP, LLM prefill on the 256 tokens ~3.9 TFLOP. Fewer visual tokens directly cut the biggest term.' },
            deep: '<p>Per sketch: ViT 2·0.41 B·1024 + attention ≈ 1 TFLOP (~2 ms on an H100); projector ≈ 15 GFLOP; LLM prefill 2·7.6 B·256 ≈ 3.9 TFLOP (~10 ms). The language model dominates, so merging 2×2 (4× fewer tokens) mostly saves <i>LLM</i> compute and KV cache, not encoder compute. (The 7.6 B here also counts the embedding tables, so the LLM figures are a roughly 15% upper bound.)</p>' +
              '<p>For a three-sketch prompt: 768 visual tokens ≈ 11.7 TFLOP of prefill (2·7.6 B·768) plus about 44 MB of KV cache (768 × 56 KiB), which prefix caching then keeps warm across the agents\' follow-up questions.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 6);
          ctx.remove(S.p8, 400);
          var P = S.p9 = ctx.group();

          /* beat 0: LN -> Linear -> GELU -> Linear */
          panelTitle(ctx, P, 600, 262, 'MLP projector → LLM embedding space');
          var st = ['#ff8a3d', '#10263f', '#ff8a3d', '#fff2e6'];
          var stripe = ctx.group({ parent: P });
          st.forEach(function (c, i) { ctx.rect(604 + i * 12, 306, 12, 48, { rx: 0, fill: c, stroke: ctx.alpha('white', 0.3), sw: 0.5, parent: stripe }); });
          ctx.text(628, 372, '4608', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: stripe });
          var ns = [
            ctx.node({ x: 720, y: 330, w: 84, h: 40, title: 'LN', color: 'violet', titleSize: 13, glow: false, parent: P }),
            ctx.node({ x: 850, y: 330, w: 140, h: 40, title: 'Linear', sub: '4608→3584', color: 'violet', titleSize: 12, subSize: 10, glow: false, parent: P }),
            ctx.node({ x: 980, y: 330, w: 84, h: 40, title: 'GELU', color: 'violet', titleSize: 13, glow: false, parent: P }),
            ctx.node({ x: 1110, y: 330, w: 140, h: 40, title: 'Linear', sub: '3584→3584', color: 'violet', titleSize: 12, subSize: 10, glow: false, parent: P })
          ];
          var ls = [ctx.link({ x: 656, y: 330 }, ns[0], { color: 'violet', straight: true, parent: P })];
          for (var i = 0; i < 3; i++) ls.push(ctx.link(ns[i], ns[i + 1], { color: 'violet', straight: true, parent: P }));
          var outV = ctx.vector(1220, 300, 8, { cell: 7, gap: 1, cmap: 'amber', values: [0.4, 0.9, 0.3, 0.7, 0.5, 0.8, 0.2, 0.6], parent: P });
          ls.push(ctx.link(ns[3], { x: 1214, y: 330 }, { color: 'amber', straight: true, parent: P }));
          var rl = ctx.text(1224, 372, 'ℝ³⁵⁸⁴', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: P });
          hide([P]);
          ctx.reveal(P, { dur: 500 });
          ctx.reveal(ls, { from: 'draw', stagger: 150, delay: 500 });
          return ctx.wait(1400).then(function () {
            return ls.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'amber', dur: 260 }); }); }, Promise.resolve());
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the sketch is now a 16x16 grid of tokens */
            ctx.transform(S.img, { x: 0, y: 0, s: 1 }, 900, 'inOut');
            ctx.fade(S.grid, 0.12, 600);
            ctx.fade(S.cap, 1, 600);
            S.mgrid = ctx.path(gridPath(IX, IY, IS, IS, 16, 16), { stroke: ctx.alpha('amber', 0.55), sw: 1, parent: S.img });
            return ctx.reveal(S.mgrid, { delay: 800, dur: 800 }).then(function () { return ctx.pulse(S.img, { color: 'amber', dur: 700 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: 256 projected tokens flow into the LLM input */
            S.llmBox = ctx.node({ x: 1440, y: 540, w: 180, h: 560, title: '', color: 'amber', kind: 'box', glow: true, parent: P });
            var lt = ctx.text(1440, 286, 'LLM input', { size: 14, font: 'display', weight: 700, color: 'amber', anchor: 'middle', parent: P });
            var col = ctx.matrix(1374, 310, 32, 8, { cell: 13, gap: 3, values: function () { return 'rgba(255,191,58,0.08)'; }, parent: P });
            S.tokCount = ctx.text(1440, 836, '0 / 256 tokens', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', parent: P });
            hide([S.llmBox, lt, col, S.tokCount]);
            ctx.reveal([S.llmBox, lt, col, S.tokCount], { from: 'right', stagger: 100 });
            var cells = [];
            for (var r = 0; r < 32; r++) for (var c = 0; c < 8; c++) cells.push(col.cells[r][c]);
            return ctx.wait(700).then(function () {
              var fly = ctx.group({ parent: P });
              var jobs = [];
              for (var k = 0; k < 256; k++) {
                (function (k) {
                  var sr = Math.floor(k / 16), sc = k % 16;
                  var fill = pix((sc + 0.5) * 6.25, (sr + 0.5) * 6.25);
                  var target = cells[k];
                  if (ctx.instant || k % 4) { target.setAttribute('fill', ctx.mix('#ffbf3a', fill.length === 7 ? fill : '#ffbf3a', 0.35)); return; }
                  var p = ctx.rect(-5, -5, 10, 10, { rx: 2, fill: fill, parent: fly });
                  var sx = IX + sc * 28 + 14, sy = IY + sr * 28 + 14, tx = 1374 + (k % 8) * 16 + 6, ty = 310 + Math.floor(k / 8) * 16 + 6;
                  ctx.place(p, sx, sy);
                  jobs.push(ctx.tween(900, function (t) { ctx.place(p, ctx.lerp(sx, tx, t), ctx.lerp(sy, ty, t) - Math.sin(t * Math.PI) * 80); }, 'inOut', k * 12).then(function () {
                    if (p.parentNode) p.parentNode.removeChild(p);
                  }));
                })(k);
              }
              ctx.counter(S.tokCount, 0, 256, ctx.instant ? 0 : 3000, function (v) { return Math.round(v) + ' / 256 tokens'; });
              return Promise.all(jobs).then(function () {
                cells.forEach(function (cl, k) {
                  var sr = Math.floor(k / 16), sc = k % 16;
                  cl.setAttribute('fill', ctx.mix('#ffbf3a', pix((sc + 0.5) * 6.25, (sr + 0.5) * 6.25), 0.35));
                });
                if (fly.parentNode) fly.parentNode.removeChild(fly);
              });
            }).then(function () { return ctx.pulse(S.llmBox, { color: 'amber', dur: 800 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the compute budget */
            var bud = ctx.code({ x: 600, y: 420, w: 700, title: 'budget.txt', lang: 'text', size: 13, color: 'violet', lines: [
              'one 448² sketch      1024 patches → 256 tokens (28×28 px each)',
              'three sketches       768 tokens',
              'shot, 5 s @ 2 fps    10 frames → 1,280 tokens',
              'ViT                  ~1 TFLOP / image  (~2 ms on H100)',
              'projector            29 M params, 15 GFLOP / image',
              'LLM prefill          2·7.6 B·256 ≈ 3.9 TFLOP'
            ], parent: P });
            hide([bud]);
            return ctx.reveal(bud, { from: 'up' }).then(function () { return ctx.pulse(bud, { color: 'violet', dur: 700 }); });
          });
        }
      }
    ]
  });
})();
