/* L2 — Vision Encoders & Visual Tokens. One sketch goes pixel -> patch -> ViT -> merged token -> LLM space. */
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

  /* SVG collapses runs of spaces: keep code alignment with non-breaking spaces */
  function nb(s) { return s.replace(/ {2,}/g, function (m) { return new Array(m.length + 1).join('\u00a0'); }); }
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

  Atlas.register({
    id: 'vision-encoder',
    refs: [
      'Dosovitskiy et al., <i>An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale (ViT)</i>, ICLR 2021',
      'Zhai et al., <i>Sigmoid Loss for Language Image Pre-Training (SigLIP)</i>, ICCV 2023; Tschannen et al., <i>SigLIP 2</i>, 2025',
      'Dehghani et al., <i>Patch n\' Pack: NaViT, a Vision Transformer for any Aspect Ratio and Resolution</i>, NeurIPS 2023',
      'Arnab et al., <i>ViViT: A Video Vision Transformer</i> (tubelet embedding), ICCV 2021',
      'Bolya et al., <i>Token Merging: Your ViT But Faster (ToMe)</i>, ICLR 2023',
      'Darcet et al., <i>Vision Transformers Need Registers</i>, ICLR 2024',
      'Chen et al., <i>How Far Are We to GPT-4V? InternVL 1.5</i> (pixel shuffle, dynamic tiling), 2024',
      'Bai et al., <i>Qwen2.5-VL Technical Report</i> (window attention, 2-D RoPE, 3-D patches), 2025'
    ],
    steps: [
      {
        title: 'One sketch',
        say: 'Let us follow one of the creator\'s sketches through the vision encoder. After resizing, it is four hundred and forty eight pixels square: about six hundred thousand numbers. The encoder must turn those numbers into a few hundred vectors that capture what is in the picture: a fox, a cracked helmet, an ice moon, a painterly style. The roadmap along the top shows the path: patches, positions, transformer blocks, merging, and the projector into the language model.',
        deep: '<p>Input tensor: <code>[B, 3, 448, 448]</code>, values normalised per channel (SigLIP: <code>(x/255 − 0.5)/0.5</code> → [−1, 1]). 448·448·3 = <b>602,112</b> numbers.</p>' +
          '<p>Reference design used in this chamber (numbers are real, the combination is a typical 2025 VLM):</p>' +
          '<table><tr><th>Stage</th><th>Shape</th></tr>' +
          '<tr><td>patchify 14×14</td><td>[1024, 588]</td></tr>' +
          '<tr><td>linear embed</td><td>[1024, 1152]</td></tr>' +
          '<tr><td>27 ViT blocks (SigLIP-2 so400m)</td><td>[1024, 1152]</td></tr>' +
          '<tr><td>2×2 merge (pixel-shuffle)</td><td>[256, 4608]</td></tr>' +
          '<tr><td>MLP projector</td><td>[256, 3584] → LLM</td></tr></table>' +
          '<div class="note">Everything the planner will ever "see" of this sketch is these 256 vectors. Whatever the encoder discards (thin lines, tiny text, exact hues) is gone for good — which is why the agent re-queries on crops when it needs detail.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.img = ctx.group();
          S.fox = drawFox(ctx, S.img);
          S.cap = ctx.text(IX + IS / 2, IY + IS + 22, 'sketch_2.png → 448 × 448 × 3 = 602,112 values', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: S.img });
          ctx.reveal(S.img, { from: 'scale', s0: 0.85, dur: 900 });
          /* roadmap */
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
          ctx.reveal(S.pills.map(function (p) { return p.g; }), { from: 'left', stagger: 100, delay: 400 });
          /* big number */
          S.intro = ctx.group();
          ctx.text(620, 330, '602,112', { size: 64, font: 'display', weight: 700, color: 'violet', parent: S.intro, glow: true });
          ctx.text(620, 380, 'numbers in', { size: 16, color: 'dim', parent: S.intro });
          ctx.text(620, 470, '256', { size: 64, font: 'display', weight: 700, color: 'amber', parent: S.intro, glow: true });
          ctx.text(620, 520, 'vectors out, each in ℝ³⁵⁸⁴, that the LLM can read', { size: 16, color: 'dim', parent: S.intro });
          ctx.text(620, 600, 'what must survive: identity · pose · materials · palette · style · layout', { size: 14, font: 'mono', color: 'text', parent: S.intro });
          ctx.reveal(S.intro, { from: 'up', delay: 900 });
          return ctx.wait(2400);
        }
      },
      {
        title: 'Patchify & embed',
        say: 'First the image is cut into a grid of fourteen by fourteen pixel patches. Four hundred forty eight divided by fourteen is thirty two, so we get thirty two by thirty two, one thousand and twenty four patches. Each patch holds fourteen times fourteen times three, which is five hundred eighty eight numbers. A single learned matrix projects every flattened patch to a vector of width eleven fifty two. In code, that is just a convolution whose kernel and stride both equal the patch size.',
        deep: '<div class="eq">x<sub>p</sub> ∈ ℝ<sup>P²·C</sup> = ℝ<sup>14·14·3 = 588</sup>, &nbsp; e<sub>p</sub> = W<sub>E</sub> x<sub>p</sub> + b, &nbsp; W<sub>E</sub> ∈ ℝ<sup>1152×588</sup></div>' +
          '<div class="eq">N = (H/P)·(W/P) = (448/14)² = 1024</div>' +
          '<pre>embed = nn.Conv2d(3, 1152, 14, stride=14)\nx = embed(img)       # [B,1152,32,32]\nx = x.flatten(2).mT  # [B,1024,1152]</pre>' +
          '<p>Patch size is the key accuracy/cost knob: tokens scale as 1/P², attention as 1/P⁴. ViT-B/16 at 224² gives 196 tokens; SigLIP so400m/14 at 384² gives 729; at 448², 1024. Smaller patches help OCR and thin strokes (our sketch lines are 2–4 px), larger patches are cheaper.</p>' +
          '<div class="note">The embedding is linear: a patch is only "understood" after attention mixes it with context. A lone 14×14 crop of orange fur is ambiguous — fox, flame or sunset.</div>',
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
          ctx.reveal(S.grid, { dur: 500 });
          ctx.reveal([S.patchHl, S.patchLab], { delay: 400 });
          ctx.hud('N = (448 / 14)² = 1024 patches');
          /* right panel */
          var P = S.p2 = ctx.group();
          panelTitle(ctx, P, 600, 262, 'Patchify + linear embedding');
          var pm = ctx.matrix(600, 300, 14, 14, { cell: 12, gap: 1, parent: P, values: function (i, j) {
            return pix((S.pc + (j + 0.5) / 14) * 100 / 32, (S.pr + (i + 0.5) / 14) * 100 / 32);
          } });
          ctx.text(690, 500, '14 × 14 × 3 = 588 numbers', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: P });
          ctx.line(790, 390, 826, 390, { color: 'violet', arrow: true, parent: P });
          ctx.text(808, 374, 'flatten', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          var flat = [];
          for (var k = 0; k < 28; k++) {
            var i = Math.floor(k / 2), j = (k % 2) * 7 + 3;
            flat.push(pix((S.pc + (j + 0.5) / 14) * 100 / 32, (S.pr + (i + 0.5) / 14) * 100 / 32));
          }
          var fv = ctx.matrix(836, 278, 28, 1, { cell: 8, gap: 1, values: function (r) { return flat[r]; }, parent: P });
          ctx.text(840, 540, 'x ∈ ℝ⁵⁸⁸', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: P });
          ctx.text(875, 400, '×', { size: 22, color: 'dim', anchor: 'middle', parent: P });
          var rr = ctx.rng(4);
          var WE = ctx.matrix(900, 322, 12, 16, { cell: 10, gap: 1, cmap: 'diverge', values: function () { return rr() * 2 - 1; }, parent: P });
          ctx.text(988, 480, 'W_E ∈ ℝ¹¹⁵²ˣ⁵⁸⁸', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: P });
          ctx.text(1100, 400, '=', { size: 22, color: 'dim', anchor: 'middle', parent: P });
          var ev = ctx.vector(1126, 318, 16, { cell: 9, gap: 1, cmap: 'violet', values: function () { return 0.2 + 0.8 * rr(); }, parent: P });
          ctx.text(1131, 302, 'e ∈ ℝ¹¹⁵²', { size: 13, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
          ctx.line(1150, 400, 1196, 400, { color: 'violet', arrow: true, parent: P });
          ctx.text(1173, 384, '× 1024', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          var E = ctx.matrix(1206, 330, 10, 14, { cell: 12, gap: 2, cmap: 'violet', values: function () { return 0.15 + 0.8 * rr(); }, parent: P });
          ctx.text(1300, 490, 'E ∈ ℝ¹⁰²⁴ˣ¹¹⁵²  (one row per patch)', { size: 13, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
          S.code2 = ctx.code({ x: 600, y: 590, w: 900, title: 'patch_embed.py', lang: 'py', size: 13, color: 'violet', lines: [
            'embed = nn.Conv2d(3, 1152, kernel_size=14, stride=14)  # == unfold + matmul',
            'x = embed(img)                   # [B, 3, 448, 448] -> [B, 1152, 32, 32]',
            'x = x.flatten(2).transpose(1, 2) # [B, 1024, 1152]: one token per patch'
          ].map(nb), parent: P });
          [pm, fv, WE, ev, E].forEach(function (m) { m.setAttribute('opacity', 0); });
          ctx.reveal(P, { dur: 300 });
          return ctx.camera(IX + S.pc * 14 + 7, IY + S.pr * 14 + 7, 3, 1000).then(function () {
            return ctx.wait(900);
          }).then(function () {
            ctx.camera(null, null, null, 900);
            return ctx.reveal(pm, { from: 'scale', s0: 0.1, dur: 800, delay: 300 });
          }).then(function () {
            return ctx.reveal([fv, WE, ev, E], { from: 'left', stagger: 350 });
          }).then(function () { return ctx.pulse(E, { color: 'violet', dur: 700 }); });
        }
      },
      {
        title: '2-D positions',
        say: 'Self attention is permutation invariant: shuffle the patches and it would not notice. So each patch needs to know where it sits. The classic ViT adds a learned position vector per grid cell, which must be interpolated when the resolution changes. Newer encoders use two dimensional rotary embeddings: half of each query and key is rotated by an angle set by the row, the other half by the column, so attention scores depend only on relative offsets and any grid size works.',
        deep: '<p><b>Learned absolute</b> (ViT, SigLIP): <code>z<sub>0</sub> = E + P</code>, <code>P ∈ ℝ<sup>32×32×1152</sup></code>. For a new resolution, P is bicubically resized; quality degrades far from the training grid, which is why SigLIP 2 trains <i>NaFlex</i> variants across many sequence lengths.</p>' +
          '<p><b>2-D RoPE</b> (EVA-02, FiT, Qwen2.5-VL ViT): with head dim d<sub>h</sub>, split the d<sub>h</sub>/2 rotary pairs in half.</p>' +
          '<div class="eq">q̃ = [ R(r·θ<sub>1..d/4</sub>) q<sub>:d/2</sub> ; R(c·θ<sub>1..d/4</sub>) q<sub>d/2:</sub> ], &nbsp; θ<sub>i</sub> = 10000<sup>−4i/d<sub>h</sub></sup></div>' +
          '<div class="eq">⟨q̃<sub>(r,c)</sub>, k̃<sub>(r′,c′)</sub>⟩ = g(q, k, r − r′, c − c′)</div>' +
          '<p>Consequences: translation-equivariant attention, no interpolation step, arbitrary aspect ratios, and a natural extension to 3-D (t, h, w) for video — the same trick used by M-RoPE in the LLM and 3-D RoPE in video DiTs.</p>' +
          '<div class="note">Rotations never change vector norms, so RoPE adds position without polluting the content magnitude, unlike additive embeddings.</div>',
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 2);
          ctx.hud('');
          ctx.remove(S.p2, 400);
          ctx.fade([S.patchHl, S.patchLab], 0, 300);
          var P = S.p3 = ctx.group();
          panelTitle(ctx, P, 600, 262, 'Where is each patch? 2-D position encoding');
          ctx.text(IX + IS / 2, IY - 12, 'column c = 0 … 31 →', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: P });
          var rl = ctx.text(40, IY + IS / 2, 'row r = 0 … 31 →', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
          rl.setAttribute('transform', 'rotate(90 40 ' + (IY + IS / 2) + ')');
          var dials = [], th = 0.55;
          for (var r = 0; r < 6; r++) for (var c = 0; c < 6; c++) {
            var cx = 640 + c * 50, cy = 330 + r * 50;
            ctx.circle(cx, cy, 18, { stroke: ctx.alpha('white', 0.25), sw: 1, parent: P });
            var h1 = ctx.line(cx, cy, cx + 15, cy, { color: 'violet', sw: 2.4, parent: P });
            var h2 = ctx.line(cx, cy, cx + 15, cy, { color: 'pink', sw: 2.4, parent: P });
            dials.push({ h1: h1, h2: h2, cx: cx, cy: cy, a1: r * th, a2: c * th });
          }
          for (var i = 0; i < 6; i++) {
            ctx.text(640 + i * 50, 296, 'c=' + i, { size: 11, font: 'mono', color: 'pink', anchor: 'middle', parent: P });
            ctx.text(606, 330 + i * 50, 'r=' + i, { size: 11, font: 'mono', color: 'violet', anchor: 'end', parent: P });
          }
          ctx.text(765, 640, 'violet hand: channels rotated by r·θ', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
          ctx.text(765, 662, 'pink hand: channels rotated by c·θ', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: P });
          ctx.para(960, 300, [
            'Learned absolute (ViT, SigLIP)',
            '  z₀ = E + P,   P ∈ ℝ³²ˣ³²ˣ¹¹⁵²',
            '  new resolution → bicubic-resize P',
            '',
            '2-D RoPE (EVA-02, Qwen2.5-VL ViT)',
            '  half of q,k rotated by r·θᵢ,',
            '  other half by c·θᵢ',
            '  ⟨q̃(r,c), k̃(r′,c′)⟩ = g(Δr, Δc)',
            '  → any grid, any aspect ratio'
          ], { size: 14, font: 'mono', color: 'text', lh: 25, parent: P });
          var pt = ctx.matrix(960, 540, 6, 16, { cell: 14, gap: 2, cmap: 'diverge', values: function (a, b) { return Math.sin(b * 0.7 + a * 0.3) * Math.cos(a * 0.9); }, parent: P });
          ctx.text(960, 660, 'a slice of learned P (6 rows × 16 cols, one channel)', { size: 11, font: 'mono', color: 'dim', parent: P });
          ctx.reveal(P, { dur: 500 });
          ctx.reveal(pt, { from: 'left', delay: 600 });
          function setHands(t) {
            dials.forEach(function (d) {
              d.h1.setAttribute('x2', (d.cx + 15 * Math.cos(d.a1 * t)).toFixed(1)); d.h1.setAttribute('y2', (d.cy - 15 * Math.sin(d.a1 * t)).toFixed(1));
              d.h2.setAttribute('x2', (d.cx + 15 * Math.cos(d.a2 * t)).toFixed(1)); d.h2.setAttribute('y2', (d.cy - 15 * Math.sin(d.a2 * t)).toFixed(1));
            });
          }
          setHands(0);
          return ctx.wait(700).then(function () { return ctx.tween(2200, setHands, 'inOut'); }).then(function () { return ctx.wait(800); });
        }
      },
      {
        title: 'Transformer blocks',
        say: 'Now the one thousand and twenty four tokens pass through a stack of transformer blocks, twenty seven of them in SigLIP so four hundred m. Each block normalises, lets every patch attend to every other patch with sixteen heads, adds the result back to the residual stream, then applies a wide MLP. There is no causal mask: the whole picture is visible at once. The cost is about one teraflop per image, a couple of milliseconds on a modern GPU.',
        deep: '<div class="eq">X′ = X + MHSA(LN(X)), &nbsp; X″ = X′ + MLP(LN(X′))</div>' +
          '<div class="eq">MHSA: A<sub>h</sub> = softmax(Q<sub>h</sub>K<sub>h</sub><sup>ᵀ</sup>/√72) ∈ ℝ<sup>1024×1024</sup>, h = 1..16</div>' +
          '<table><tr><th>SigLIP so400m/14</th><th></th></tr>' +
          '<tr><td>depth / width / MLP</td><td>27 / 1152 / 4304</td></tr>' +
          '<tr><td>heads × head dim</td><td>16 × 72</td></tr>' +
          '<tr><td>params / block</td><td>4d² + 2·d·4304 ≈ 15.2 M</td></tr>' +
          '<tr><td>total</td><td>≈ 0.41 B</td></tr></table>' +
          '<p>FLOPs per 448² image: linear ≈ 2·P·N = 2·0.41 B·1024 ≈ <b>0.84 TFLOP</b>; attention ≈ 4·L·N²·d = 4·27·1024²·1152 ≈ <b>0.13 TFLOP</b>. Total ≈ 1 TFLOP → ~2 ms on an H100 at 50% MFU. Attention is a small share at 1024 tokens but grows quadratically: it breaks even with the linear layers at N = P/(2·L·d) ≈ 6.6 k tokens (≈ 1134² input at patch 14).</p>' +
          '<div class="note">Variants: Qwen2.5-VL\'s ViT uses RMSNorm + SwiGLU and <i>window attention</i> in most layers; InternViT-6B scales width instead of depth; DINOv2 and SigLIP 2 add self-distillation and masked-prediction losses for denser features.</div>',
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 3);
          ctx.remove(S.p3, 400);
          ctx.fade(S.grid, 0.4, 400);
          var P = S.p4 = ctx.group();
          panelTitle(ctx, P, 600, 262, 'Pre-norm ViT block  × 27');
          var xin = ctx.vector(604, 320, 12, { cell: 16, gap: 2, cmap: 'violet', values: function (r) { return 0.3 + 0.05 * r; }, parent: P });
          ctx.text(612, 548, 'X', { size: 14, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
          ctx.text(612, 568, '1024×1152', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          /* stacked plates */
          for (var k = 5; k >= 1; k--) ctx.rect(700 + k * 7, 292 + k * 7, 290, 400, { rx: 12, fill: 'rgba(12,16,34,0.8)', stroke: ctx.alpha('violet', 0.12 + 0.03 * (5 - k)), sw: 1, parent: P });
          ctx.rect(700, 292, 290, 400, { rx: 12, fill: 'rgba(12,16,34,0.95)', stroke: 'violet', sw: 1.4, parent: P });
          var cx = 860;
          var N = [
            ctx.node({ x: cx, y: 330, w: 190, h: 36, title: 'LayerNorm', color: 'violet', titleSize: 13, glow: false, parent: P }),
            ctx.node({ x: cx, y: 405, w: 190, h: 44, title: 'Self-attention', sub: '16 heads × 72', color: 'magenta', titleSize: 13, subSize: 11, glow: false, parent: P }),
            ctx.node({ x: cx, y: 530, w: 190, h: 36, title: 'LayerNorm', color: 'violet', titleSize: 13, glow: false, parent: P }),
            ctx.node({ x: cx, y: 605, w: 190, h: 44, title: 'MLP', sub: '1152→4304→1152', color: 'cyan', titleSize: 13, subSize: 11, glow: false, parent: P })
          ];
          var plus1 = ctx.circle(cx, 468, 11, { stroke: 'white', sw: 1.4, fill: '#0b1324', parent: P });
          ctx.text(cx, 468, '+', { size: 16, color: 'white', anchor: 'middle', parent: P });
          var plus2 = ctx.circle(cx, 666, 11, { stroke: 'white', sw: 1.4, fill: '#0b1324', parent: P });
          ctx.text(cx, 666, '+', { size: 16, color: 'white', anchor: 'middle', parent: P });
          var main = ctx.path('M632,420 H720 V300 H' + cx + ' V312 M' + cx + ',348 V383 M' + cx + ',427 V457 M' + cx + ',479 V512 M' + cx + ',548 V583 M' + cx + ',627 V655 M' + cx + ',677 V700', { stroke: 'violet', sw: 1.6, parent: P });
          var res1 = ctx.path('M720,300 V468 H849', { stroke: ctx.alpha('white', 0.5), sw: 1.4, dash: '4 4', arrow: true, parent: P });
          var res2 = ctx.path('M' + cx + ',490 H735 V666 H849', { stroke: ctx.alpha('white', 0.5), sw: 1.4, dash: '4 4', arrow: true, parent: P });
          ctx.text(742, 560, 'residual', { size: 11, font: 'mono', color: 'dim', anchor: 'start', parent: P });
          ctx.text(998, 290, '× 27', { size: 22, font: 'display', weight: 700, color: 'violet', anchor: 'start', parent: P });
          /* attention matrix */
          var R = cellRegions(), keys = [];
          for (var a = 0; a < 16; a++) keys.push(R[Math.floor(a / 16 * 16)][[2, 5, 8, 8, 8, 11, 13, 7, 8, 9, 4, 14, 1, 6, 10, 12][a]]);
          var am = ctx.matrix(1060, 300, 16, 16, { cell: 13, gap: 2, cmap: 'heat', values: function (i, j) { return i === j ? 1 : (keys[i] === keys[j] ? 0.7 : 0.08 + 0.1 * Math.abs(Math.sin(i * 3 + j))); }, parent: P });
          ctx.text(1180, 556, 'A = softmax(QKᵀ/√72) · bidirectional', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: P });
          ctx.text(1180, 576, '16×16 sample of the 1024×1024 map', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          ctx.para(1060, 620, ['params ≈ 27 × 15.2 M ≈ 0.41 B', 'linear  ≈ 2·P·N ≈ 0.84 TFLOP', 'attn    ≈ 4·L·N²·d ≈ 0.13 TFLOP', '≈ 1 TFLOP / image → ~2 ms on H100'], { size: 13, font: 'mono', color: 'text', lh: 22, parent: P });
          ctx.reveal(P, { dur: 500 });
          ctx.reveal(am, { from: 'scale', delay: 700 });
          ctx.hud('27 blocks · 16 heads · N = 1024 · ~1 TFLOP');
          return ctx.wait(700).then(function () {
            return Promise.all([
              ctx.packet(main, { color: 'violet', dur: 2600, label: 'x' }),
              ctx.wait(500).then(function () { return ctx.packet(res1, { color: 'white', dur: 900, r: 4 }); }),
              ctx.wait(1500).then(function () { return ctx.packet(res2, { color: 'white', dur: 900, r: 4 }); })
            ]);
          }).then(function () { return ctx.pulse(plus2, { color: 'violet', dur: 600 }); });
        }
      },
      {
        title: 'What a patch attends to',
        say: 'Here is an attention map from one query patch on the fox\'s face, in a late layer. It lights up the rest of the head, the helmet, the suit and the tail: the encoder has grouped pixels into an object, far beyond local neighbourhoods. Watch the query move to the ice and to the smoke trail. Notice one bright patch in empty sky: large ViTs repurpose low information patches as scratch registers. Click any patch to move the query yourself.',
        deep: '<div class="eq">α<sub>ij</sub> = exp(q<sub>i</sub>·k<sub>j</sub>/√d<sub>h</sub>) / Σ<sub>j′</sub> exp(q<sub>i</sub>·k<sub>j′</sub>/√d<sub>h</sub>)</div>' +
          '<p>The map shown is illustrative (pooled to the 16×16 merged grid, 28 px cells) but reproduces what probing real encoders shows: early layers attend locally (edges, colour), late layers attend by <b>object and semantics</b>; heads specialise.</p>' +
          '<p><b>Artifact tokens</b> (Darcet et al., 2024): large, well-trained ViTs (DINOv2, OpenCLIP, DeiT-III in the paper) develop high-norm tokens in redundant background patches that aggregate global information; attention maps show bright spots in empty sky. Fix: append 4–16 learnable <i>register</i> tokens that are discarded at the output — cleaner maps and better dense features.</p>' +
          '<p>Why this matters downstream: the critic compares shots with the identity crop in embedding space; if identity is encoded by object-level attention, small pose changes do not break the similarity, while colour drift of the suit does.</p>' +
          '<div class="note">Interactive: click any cell on the sketch. The bars on the right show where the query\'s attention mass goes, per region.</div>',
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 3);
          ctx.hud('');
          ctx.remove(S.p4, 400);
          ctx.fade(S.grid, 0.15, 400);
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
          ctx.para(1200, 410, ['Early layers: local', 'edges and colour.', 'Late layers: whole', 'objects, semantics.', '', 'Bright sky patch =', 'high-norm "artifact"', 'token (registers fix it).'], { size: 13, font: 'mono', color: 'text', lh: 22, parent: P });
          S.clickHint = ctx.label(IX + IS / 2, IY + IS + 22, 'click any patch to move the query', { color: 'amber', size: 12, parent: P });
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
          S.setQ(6, 8, 0);
          ctx.fade(S.cap, 0, 300);
          ctx.reveal([S.heat, P], { dur: 600, stagger: 200 });
          return ctx.wait(1800)
            .then(function () { return S.setQ(14, 3, 500); }).then(function () { return ctx.wait(1400); })
            .then(function () { return S.setQ(2, 13, 500); }).then(function () { return ctx.wait(1400); })
            .then(function () { return S.setQ(6, 8, 500); });
        }
      },
      {
        title: 'Native resolution packing',
        say: 'Real inputs are not square. Squashing a wide storyboard frame into a square distorts it, and padding wastes compute. NaViT style encoders keep each image at its native aspect ratio, cut it into patches, and pack several images into one long sequence. A block diagonal attention mask keeps images from attending to each other. With variable length attention kernels, packing costs nothing extra, and our three different shaped inputs fit in two thousand and eighty tokens instead of almost six thousand padded ones.',
        deep: '<p><b>Patch n\' Pack</b> (NaViT): images of any size → patch sequences of different lengths → concatenated into one row of the batch, with per-image position ids and a block-diagonal mask.</p>' +
          '<table><tr><th>input</th><th>pixels</th><th>patches</th></tr>' +
          '<tr><td>sketch_1 (4:3)</td><td>448×336</td><td>32×24 = 768</td></tr>' +
          '<tr><td>sketch_3 (16:9-ish)</td><td>616×336</td><td>44×24 = 1056</td></tr>' +
          '<tr><td>keyframe thumb</td><td>224×224</td><td>16×16 = 256</td></tr>' +
          '<tr><td><b>packed</b></td><td></td><td><b>2080</b> (vs 3×1936 = 5808 padded, 64% waste)</td></tr></table>' +
          '<pre>cu = [0, 768, 1824, 2080]   # int32 offsets\nout = flash_attn_varlen_func(q, k, v,\n        cu_seqlens_q=cu, cu_seqlens_k=cu,\n        max_seqlen_q=1056, max_seqlen_k=1056)</pre>' +
          '<p>Sides are multiples of 28 so the later 2×2 merge divides evenly. <b>Window attention</b> (Qwen2.5-VL ViT): most layers attend inside 8×8-patch (112 px) windows and only 4 of 32 layers use full attention, so cost grows ~linearly with image area. SigLIP 2 <b>NaFlex</b> ships one checkpoint that handles many sequence lengths and native aspect ratios.</p>' +
          '<div class="note">Packing also enables token dropping during training (NaViT drops random patches per image: faster training, robustness).</div>',
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 1);
          ctx.remove(S.heat, 400);
          ctx.remove(S.p5, 400);
          ctx.transform(S.img, { x: 34.8, y: 134.56, s: 0.42 }, 900, 'inOut');
          var P = S.p6 = ctx.group();
          panelTitle(ctx, P, 300, 262, 'Patch n\' Pack: native aspect ratios, one sequence');
          var ims = [[320, 300, 32, 24, 'violet', 'sketch_1 · 448×336 → 768'], [560, 300, 44, 24, 'pink', 'sketch_3 · 616×336 → 1056'], [870, 300, 16, 16, 'cyan', 'keyframe · 224² → 256']];
          var gs = ims.map(function (m) {
            var g = ctx.group({ parent: P });
            ctx.rect(m[0], m[1], m[2] * 6, m[3] * 6, { rx: 2, fill: ctx.alpha(m[4], 0.15), stroke: m[4], sw: 1.4, parent: g });
            ctx.path(gridPath(m[0], m[1], m[2] * 6, m[3] * 6, m[2], m[3]), { stroke: ctx.alpha(m[4], 0.35), sw: 0.6, parent: g });
            ctx.text(m[0], m[1] + m[3] * 6 + 18, m[5], { size: 12, font: 'mono', color: m[4], parent: g });
            return g;
          });
          ctx.text(1010, 330, 'padding all to 616×616:', { size: 13, font: 'mono', color: 'dim', parent: P });
          ctx.text(1010, 352, '3 × 1936 = 5808 tokens', { size: 13, font: 'mono', color: 'red', parent: P });
          ctx.text(1010, 374, 'packed: 2080 (−64%)', { size: 13, font: 'mono', color: 'lime', parent: P });
          /* sequence bar */
          var tot = 2080, x0 = 320, W = 1200, y0 = 505, acc = 0;
          ctx.text(320, 488, 'packed sequence', { size: 13, font: 'mono', color: 'text', parent: P });
          var segs = ims.map(function (m, i) {
            var n = m[2] * m[3], x = x0 + acc / tot * W, w = n / tot * W;
            var seg = ctx.rect(x, y0, w - 3, 26, { rx: 4, fill: ctx.alpha(m[4], 0.45), stroke: m[4], sw: 1.2, parent: P });
            ctx.text(x, y0 + 42, String(acc), { size: 11, font: 'mono', color: 'dim', parent: P });
            acc += n;
            return seg;
          });
          ctx.text(x0 + W, y0 + 42, '2080', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: P });
          ctx.text(x0 + W / 2, y0 + 62, 'cu_seqlens = [0, 768, 1824, 2080]', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: P });
          /* block-diagonal mask */
          var mx = 320, my = 600, M = 240;
          ctx.rect(mx, my, M, M, { rx: 2, fill: 'rgba(255,77,109,0.06)', stroke: ctx.alpha('red', 0.4), sw: 1, dash: '3 4', parent: P });
          acc = 0;
          var blocks = ims.map(function (m) {
            var n = m[2] * m[3], o = acc / tot * M, s = n / tot * M;
            acc += n;
            return ctx.rect(mx + o, my + o, s, s, { rx: 1, fill: ctx.alpha(m[4], 0.5), stroke: m[4], sw: 1, parent: P });
          });
          ctx.text(mx + M / 2, my + M + 18, 'attention mask: block-diagonal', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: P });
          ctx.para(610, 630, [
            'flash_attn_varlen_func(q, k, v, cu_seqlens)',
            '  → one kernel, zero padding FLOPs, no cross-image leaks',
            'Qwen2.5-VL ViT: window attention in 8×8-patch windows,',
            '  full attention in only 4 of 32 layers → ~linear in area',
            'SigLIP 2 NaFlex: one checkpoint, native aspect,',
            '  variable sequence length'
          ], { size: 14, font: 'mono', color: 'text', lh: 26, parent: P });
          P.setAttribute('opacity', 0);
          return ctx.wait(500).then(function () {
            ctx.reveal(P, { dur: 300 });
            ctx.reveal(gs, { from: 'up', stagger: 200 });
            return ctx.reveal(segs, { from: 'left', stagger: 250, delay: 700 });
          }).then(function () { return ctx.reveal(blocks, { from: 'scale', stagger: 200 }); })
            .then(function () { return ctx.wait(1200); });
        }
      },
      {
        title: 'Video: tubelets',
        say: 'Video reuses the same encoder. The critic samples a ten second shot at two frames per second, giving twenty frames. Instead of encoding each frame separately, consecutive pairs are fused into tubelets of two frames by fourteen by fourteen pixels, so a three dimensional convolution produces one token per tubelet. That halves the count to ten thousand two hundred and forty tokens inside the encoder, and the two by two merge later brings it to two thousand five hundred and sixty for the language model.',
        deep: '<div class="eq">tubelet = T<sub>p</sub>×P×P×C = 2×14×14×3 = 1176 values → Conv3d(k = s = (2,14,14)) → ℝ<sup>d</sup></div>' +
          '<table><tr><th>stage</th><th>count</th></tr>' +
          '<tr><td>10 s × 2 fps</td><td>20 frames</td></tr>' +
          '<tr><td>patches (448², /14)</td><td>20 × 1024 = 20,480</td></tr>' +
          '<tr><td>2-frame tubelets</td><td>10 × 1024 = 10,240 ViT tokens</td></tr>' +
          '<tr><td>2×2 merge</td><td>10 × 256 = <b>2,560</b> LLM tokens</td></tr></table>' +
          '<p>Single images are duplicated into two identical frames so the same Conv3d stem serves both (Qwen2-VL / 2.5-VL). Temporal position ids advance per tubelet; Qwen2.5-VL maps them to absolute time (2 ids per second).</p>' +
          '<p>Trade-offs: tubelets are cheap temporal compression but fuse two frames sampled 0.5 s apart into one token, blurring fast motion; for the critic\'s flicker detection (visor reflection at 2.1–2.9 s) a <b>higher fps on a short window</b> is better than more seconds at low fps. Alternatives: per-frame encoding + temporal pooling (LLaVA-Video), or learned temporal resamplers.</p>' +
          '<div class="note">Rule of thumb: video understanding cost ∝ seconds × fps × (H·W / 28²) / T<sub>p</sub>. The agent chooses fps and resolution per question.</div>',
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 1);
          ctx.remove(S.p6, 400);
          var P = S.p7 = ctx.group();
          panelTitle(ctx, P, 300, 262, 'shot_07.mp4 · 10 s @ 2 fps = 20 frames → 10 tubelets');
          var frames = [];
          for (var i = 0; i < 20; i++) {
            var x = 320 + i * 60, y = 290, g = ctx.group({ parent: P });
            ctx.rect(x, y, 50, 50, { rx: 3, fill: '#071126', stroke: ctx.alpha('lime', 0.6), sw: 1, parent: g });
            ctx.path('M' + x + ',' + (y + 42) + ' Q' + (x + 25) + ',' + (y + 34) + ' ' + (x + 50) + ',' + (y + 42) + ' V' + (y + 50) + ' H' + x + ' Z', { fill: ctx.alpha('cyan', 0.3), parent: g });
            var fx = x + 34 - i * 0.6, fy = y + 10 + i * 1.1;
            ctx.path('M' + (x + 50) + ',' + (y + 1) + ' L' + (fx + 3) + ',' + (fy - 3), { stroke: ctx.alpha('orange', 0.7), sw: 1, dash: '2 2', parent: g });
            ctx.circle(fx, fy, 6, { stroke: 'white', sw: 1, fill: ctx.alpha('cyan', 0.15), parent: g });
            ctx.poly([[fx - 4, fy + 1], [fx - 3, fy - 4], [fx + 3, fy - 4], [fx + 4, fy + 1], [fx, fy + 4]], { fill: 'orange', parent: g });
            frames.push(g);
          }
          var brs = [];
          for (var k = 0; k < 10; k++) {
            var bx = 320 + k * 120;
            var br = ctx.path('M' + (bx + 2) + ',348 v8 H' + (bx + 108) + ' v-8', { stroke: 'lime', sw: 1.6, parent: P });
            ctx.text(bx + 55, 372, k + ' s · t=' + (2 * k), { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: P });
            brs.push(br);
          }
          /* isometric tubelet */
          var cx0 = 360, cy0 = 470, s = 130, dx = 56, dy = -40;
          var cube = ctx.group({ parent: P });
          ctx.rect(cx0 + dx, cy0 + dy, s, s, { rx: 2, fill: ctx.alpha('lime', 0.08), stroke: ctx.alpha('lime', 0.6), sw: 1.2, parent: cube });
          [[0, 0], [s, 0], [0, s], [s, s]].forEach(function (p) { ctx.line(cx0 + p[0], cy0 + p[1], cx0 + p[0] + dx, cy0 + p[1] + dy, { color: ctx.alpha('lime', 0.6), sw: 1.2, parent: cube }); });
          ctx.rect(cx0, cy0, s, s, { rx: 2, fill: ctx.alpha('lime', 0.18), stroke: 'lime', sw: 1.6, parent: cube });
          ctx.path(gridPath(cx0, cy0, s, s, 7, 7), { stroke: ctx.alpha('lime', 0.3), sw: 0.6, parent: cube });
          ctx.text(cx0 + s / 2, cy0 + s + 18, '14 px', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: cube });
          ctx.text(cx0 - 10, cy0 + s / 2, '14 px', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: cube });
          ctx.text(cx0 + s + dx / 2 + 8, cy0 + s + dy / 2 + 4, '2 frames', { size: 12, font: 'mono', color: 'lime', parent: cube });
          ctx.text(cx0 - 20, cy0 + s + 50, 'tubelet 2×14×14×3 = 1176 → Conv3d → 1 token', { size: 13, font: 'mono', color: 'text', parent: cube });
          var lines = [
            '10 s × 2 fps                 =     20 frames',
            '20 frames × 32×32 patches    = 20,480 patches',
            'pair frames → tubelets       = 10,240 ViT tokens',
            '2×2 merge                    =  2,560 LLM tokens',
            'image = frame duplicated ×2 → same Conv3d stem',
            'temporal ids 0, 2, 4 … 18 (2 per second, M-RoPE)'
          ];
          var tl = lines.map(function (s2, i2) {
            var te = ctx.text(700, 470 + i2 * 36, nb(s2), { size: 15, font: 'mono', color: i2 === 3 ? 'amber' : 'text', parent: P });
            return te;
          });
          var hl = ctx.rect(316, 284, 118, 62, { rx: 6, stroke: 'amber', sw: 2, parent: P });
          ctx.reveal(P, { dur: 300 });
          ctx.reveal(frames, { from: 'up', stagger: 40 });
          ctx.reveal(cube, { from: 'scale', delay: 900 });
          tl.forEach(function (t) { t.setAttribute('opacity', 0); });
          ctx.hud('20 frames → 10 tubelets × 256 = 2,560 tokens');
          var sweep = ctx.tween(3000, function (t) { hl.setAttribute('x', 316 + Math.min(9, Math.floor(t * 10)) * 120); }, 'linear', 1000);
          var typed = ctx.reveal(tl, { from: 'left', stagger: 450, delay: 1200 });
          return Promise.all([sweep, typed, ctx.reveal(brs, { from: 'draw', stagger: 300, delay: 1000 })]).then(function () { return ctx.wait(600); });
        }
      },
      {
        title: 'Token compression',
        say: 'Ten thousand tokens is still too many for a language model, so encoders compress. Pixel shuffle takes each two by two neighbourhood of patch features and concatenates them along the channel axis: four times fewer tokens, four times wider, and nothing is thrown away yet; the projector learns what to keep. Token merging, or ToMe, instead finds pairs of very similar tokens inside the ViT and averages them, layer by layer, which roughly doubles throughput without retraining.',
        deep: '<p><b>Pixel shuffle / 2×2 patch merge</b> (InternVL, Qwen2-VL / 2.5-VL, Idefics3 / SmolVLM; MiniCPM-V instead uses a query resampler):</p>' +
          '<div class="eq">[H/14, W/14, C] → reshape → [H/28, W/28, 4C] : &nbsp;32×32×1152 → 16×16×4608</div>' +
          '<p>Lossless reshape; information is only discarded by the following MLP (4608 → 3584).</p>' +
          '<p><b>ToMe</b> (bipartite soft matching), inside each block between attention and MLP:</p>' +
          '<pre>A, B = x[::2], x[1::2]\nS = cos(k[A], k[B])    # key similarity\nj = S.argmax(1)        # best B per A\n# merge top-r edges (size-weighted):\nx_B = (s_A x_A + s_B x_B)/(s_A + s_B)\nlogits += log(s)       # prop. attention</pre>' +
          '<p>With r tokens merged per layer the count drops by r·L; on ViT-L/H this gives ~2× throughput at ~0.2–0.4% ImageNet accuracy cost, training-free. For video, merging across time is even more effective because static background repeats across frames.</p>' +
          '<p><b>Pooling</b>: 2×2 average or bilinear pooling of the feature map (LLaVA-OneVision for video frames), or learned query resamplers for fixed budgets.</p>' +
          '<div class="note">Rule: compress <i>after</i> the encoder has mixed context (pixel-shuffle, pooling) to keep semantics; compress <i>inside</i> (ToMe) to save encoder FLOPs.</div>',
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 4);
          ctx.hud('');
          ctx.remove(S.p7, 400);
          var P = S.p8 = ctx.group();
          panelTitle(ctx, P, 300, 262, 'Pixel-shuffle 2×2 merge');
          ctx.text(300, 290, '8×8 slice of the 32×32 grid → 4×4, channels ×4', { size: 12, font: 'mono', color: 'dim', parent: P });
          var small = [], x0 = 330, y0 = 320;
          for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
            var col = pix((c + 0.5) * 12.5 * 0.5 + 25, (r + 0.5) * 12.5 * 0.5 + 18);
            var e = ctx.rect(x0 + c * 30, y0 + r * 30, 26, 26, { rx: 3, fill: col, stroke: ctx.alpha('white', 0.25), sw: 0.6, parent: P });
            small.push({ e: e, r: r, c: c, x: x0 + c * 30, y: y0 + r * 30 });
          }
          ctx.text(330 + 120, 580, '32×32×1152 → 16×16×4608', { size: 13, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
          ctx.text(330 + 120, 602, 'concat 4 neighbours on the channel axis', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          /* ToMe */
          ctx.text(700, 262, 'ToMe · bipartite soft matching', { size: 19, font: 'display', weight: 700, color: 'white', parent: P });
          var tone = [0.1, 0.8, 0.15, 0.55, 0.85, 0.3, 0.12, 0.78, 0.5, 0.2, 0.9, 0.6];
          var A = [], B = [];
          for (var i = 0; i < 6; i++) {
            A.push({ x: 740 + i * 80, y: 340, v: tone[2 * i] });
            B.push({ x: 740 + i * 80, y: 470, v: tone[2 * i + 1] });
          }
          ctx.text(700, 340, 'A', { size: 16, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
          ctx.text(700, 470, 'B', { size: 16, font: 'mono', color: 'violet', anchor: 'middle', parent: P });
          var edges = [];
          A.forEach(function (a, ia) {
            var bi = 0, bd = 9;
            B.forEach(function (b, j) { var d = Math.abs(a.v - b.v); if (d < bd) { bd = d; bi = j; } });
            a.best = bi; a.sim = 1 - bd;
          });
          var order = A.map(function (a, i) { return i; }).sort(function (p, q) { return A[q].sim - A[p].sim; });
          var top = order.slice(0, 3);
          A.forEach(function (a, ia) {
            var b = B[a.best], hot = top.indexOf(ia) >= 0;
            edges.push(ctx.line(a.x, a.y + 18, b.x, b.y - 18, { color: hot ? 'amber' : ctx.alpha('white', 0.25), sw: hot ? 2.4 : 1, parent: P }));
            ctx.text(a.x + 22, a.y - 14, a.sim.toFixed(2), { size: 11, font: 'mono', color: hot ? 'amber' : 'dim', parent: P });
          });
          var Ac = A.map(function (a) { return ctx.circle(a.x, a.y, 16, { fill: ctx.cmap('heat', a.v), stroke: 'white', sw: 1, parent: P }); });
          var Bc = B.map(function (b) { return ctx.circle(b.x, b.y, 16, { fill: ctx.cmap('heat', b.v), stroke: 'white', sw: 1, parent: P }); });
          ctx.para(700, 540, ['split tokens alternately into A and B', 'each A picks its most similar B (cosine of keys)', 'merge the top-r edges (here r = 3): 12 → 9 tokens', 'size-weighted mean + proportional attention (+log s)', '~2× ViT-L throughput, ~0.3% acc drop, no retraining'], { size: 13, font: 'mono', color: 'text', lh: 23, parent: P });
          ctx.text(330, 660, 'pooling (avg / bilinear 2×2) and learned resamplers are the other two families', { size: 13, font: 'mono', color: 'dim', parent: P });
          ctx.reveal(P, { dur: 400 });
          ctx.reveal(edges, { from: 'draw', stagger: 120, delay: 800 });
          return ctx.wait(1200).then(function () {
            /* merge animation: each small cell becomes one stripe of a merged token */
            var mw = 58, gap = 6, sw = mw / 4;
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
          }).then(function () {
            return ctx.tween(1400, function (t) {
              top.forEach(function (ia) {
                var a = A[ia], b = B[a.best];
                Ac[ia].setAttribute('cy', ctx.lerp(a.y, b.y, t).toFixed(1));
                Ac[ia].setAttribute('cx', ctx.lerp(a.x, b.x, t).toFixed(1));
                Ac[ia].setAttribute('opacity', (1 - t).toFixed(3));
                Bc[a.best].setAttribute('r', (16 + 6 * t).toFixed(1));
                Bc[a.best].setAttribute('fill', ctx.cmap('heat', (a.v + b.v) / 2 * t + b.v * (1 - t)));
              });
            }, 'inOut');
          }).then(function () { return ctx.wait(1000); });
        }
      },
      {
        title: 'Projector into the LLM',
        say: 'Finally, each merged token, now four thousand six hundred and eight numbers wide, goes through a two layer MLP with a GELU in between, landing in the language model\'s embedding space of width three thousand five hundred and eighty four. Every twenty eight by twenty eight pixel square of the sketch has become exactly one token. Two hundred fifty six of them describe this sketch, and the agent can now ask the language model anything about it.',
        deep: '<div class="eq">h = W<sub>2</sub> · GELU(W<sub>1</sub> · LN(z) + b<sub>1</sub>) + b<sub>2</sub>, &nbsp; W<sub>1</sub> ∈ ℝ<sup>3584×4608</sup>, W<sub>2</sub> ∈ ℝ<sup>3584×3584</sup></div>' +
          '<p>≈ 29 M parameters and 2·29 M·256 ≈ 15 GFLOP per image: negligible next to the ViT (~1 TFLOP) and the LLM prefill (2·7.6 B·256 ≈ 3.9 TFLOP for these 256 tokens).</p>' +
          '<table><tr><th>input</th><th>LLM tokens</th></tr>' +
          '<tr><td>one 448² sketch</td><td>256 (1 token = 28×28 px)</td></tr>' +
          '<tr><td>three sketches</td><td>768</td></tr>' +
          '<tr><td>10 s shot @ 2 fps</td><td>2,560</td></tr>' +
          '<tr><td>1080p frame, native res</td><td>(1932/28)·(1092/28) ≈ 2,691</td></tr></table>' +
          '<p>Training the bridge: stage 1 freezes ViT and LLM and trains only the projector on image–caption pairs (≈ 0.5–1 M pairs suffices to align); stage 2 unfreezes everything on interleaved and instruction data, typically with a lower LR for the ViT.</p>' +
          '<div class="note">Design space summary: patch size, resolution policy (fixed / tiles / native), positional scheme, compression (shuffle / ToMe / pooling / resampler) and projector depth — each trades detail for tokens.</div>',
        run: function (ctx) {
          var S = ctx.state;
          road(ctx, S, 6);
          ctx.remove(S.p8, 400);
          ctx.transform(S.img, { x: 0, y: 0, s: 1 }, 900, 'inOut');
          ctx.fade(S.grid, 0.12, 600);
          ctx.fade(S.cap, 1, 600);
          S.mgrid = ctx.path(gridPath(IX, IY, IS, IS, 16, 16), { stroke: ctx.alpha('amber', 0.55), sw: 1, parent: S.img });
          ctx.reveal(S.mgrid, { delay: 800 });
          var P = S.p9 = ctx.group();
          panelTitle(ctx, P, 600, 262, 'MLP projector → LLM embedding space');
          var st = ['#ff8a3d', '#10263f', '#ff8a3d', '#fff2e6'];
          st.forEach(function (c, i) { ctx.rect(604 + i * 12, 306, 12, 48, { rx: 0, fill: c, stroke: ctx.alpha('white', 0.3), sw: 0.5, parent: P }); });
          ctx.text(628, 372, '4608', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
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
          ctx.text(1224, 372, 'ℝ³⁵⁸⁴', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: P });
          /* LLM token column */
          S.llmBox = ctx.node({ x: 1440, y: 540, w: 180, h: 560, title: '', color: 'amber', kind: 'box', glow: true, parent: P });
          ctx.text(1440, 286, 'LLM input', { size: 14, font: 'display', weight: 700, color: 'amber', anchor: 'middle', parent: P });
          var col = ctx.matrix(1374, 310, 32, 8, { cell: 13, gap: 3, values: function () { return 'rgba(255,191,58,0.08)'; }, parent: P });
          S.tokCount = ctx.text(1440, 836, '0 / 256 tokens', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', parent: P });
          var bud = ctx.code({ x: 600, y: 420, w: 700, title: 'budget.txt', lang: 'text', size: 13, color: 'violet', lines: [
            'one 448² sketch      1024 patches → 256 tokens (28×28 px each)',
            'three sketches       768 tokens',
            'shot, 10 s @ 2 fps   20 frames → 2,560 tokens',
            'ViT                  ~1 TFLOP / image  (~2 ms on H100)',
            'projector            29 M params, 15 GFLOP / image',
            'LLM prefill          2·7.6 B·256 ≈ 3.9 TFLOP'
          ].map(nb), parent: P });
          ctx.reveal(P, { dur: 500, delay: 300 });
          ctx.reveal(ls, { from: 'draw', stagger: 150, delay: 900 });
          var cells = [];
          for (var r = 0; r < 32; r++) for (var c = 0; c < 8; c++) cells.push(col.cells[r][c]);
          return ctx.wait(1500).then(function () {
            ls.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'amber', dur: 260 }); }); }, Promise.resolve());
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
        }
      }
    ]
  });
})();
