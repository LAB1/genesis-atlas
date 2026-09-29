/* L2 — The Transformer Block. Pre-norm residual block: RMSNorm, GQA attention with RoPE, SwiGLU MLP (and its
 * MoE variant), parameter accounting, and how depth composes circuits (induction heads). */
(function () {
  var SY = 470;                      /* residual stream y */
  var PX0 = 60, PY0 = 566, PW = 1480, PH = 310;   /* detail panel */

  function boxOf(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }
  function keepWS(root) {
    Array.prototype.forEach.call(root.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
  }
  function softmax(z) {
    var m = Math.max.apply(null, z), e = z.map(function (v) { return Math.exp(v - m); });
    var s = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (v) { return v / s; });
  }
  function silu(x) { return x / (1 + Math.exp(-x)); }

  /* new detail panel; fades out the previous one */
  function panel(ctx, S, title, color) {
    if (S.panel) ctx.fadeOut(S.panel, 350, true);
    var g = ctx.group();
    ctx.rect(PX0, PY0, PW, PH, { rx: 12, fill: 'rgba(7,12,24,0.94)', stroke: ctx.alpha(color, 0.5), parent: g });
    ctx.text(PX0 + 18, PY0 + 22, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = boxOf(PX0, PY0, PW, PH);
    S.panel = g;
    ctx.reveal(g, { from: 'up', dur: 500, delay: 150 });
    return g;
  }

  /* move the persistent highlight frame onto a node of the block diagram */
  function mark(ctx, S, node, color) {
    if (S.mark) ctx.fadeOut(S.mark, 250, true);
    S.mark = node ? ctx.highlight(node, { color: color || 'white', pad: 7 }) : null;
    if (S.mark) S.diagram.appendChild(S.mark);
  }

  function addCircle(ctx, parent, x, y) {
    var g = ctx.group({ parent: parent });
    ctx.circle(x, y, 13, { fill: '#1a1206', stroke: 'amber', sw: 1.8, parent: g });
    ctx.text(x, y + 1, '+', { size: 18, color: 'amber', anchor: 'middle', weight: 700, parent: g });
    g.box = boxOf(x - 13, y - 13, 26, 26);
    return g;
  }

  Atlas.register({
    id: 'transformer',
    refs: [
      'Vaswani et al., <i>Attention Is All You Need</i>, NeurIPS 2017; Xiong et al., <i>On Layer Normalization in the Transformer Architecture</i> (pre-LN), ICML 2020',
      'Zhang &amp; Sennrich, <i>Root Mean Square Layer Normalization</i>, NeurIPS 2019',
      'Shazeer, <i>GLU Variants Improve Transformer</i>, 2020',
      'Su et al., <i>RoFormer: Enhanced Transformer with Rotary Position Embedding</i>, 2021; Peng et al., <i>YaRN: Efficient Context Window Extension of LLMs</i>, ICLR 2024',
      'Ainslie et al., <i>GQA</i>, EMNLP 2023; Llama Team, <i>The Llama 3 Herd of Models</i>, 2024',
      'Fedus, Zoph &amp; Shazeer, <i>Switch Transformers</i>, JMLR 2022; DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i>, 2024',
      'Elhage et al., <i>A Mathematical Framework for Transformer Circuits</i>, 2021; Olsson et al., <i>In-context Learning and Induction Heads</i>, 2022',
      'Geva et al., <i>Transformer Feed-Forward Layers Are Key-Value Memories</i>, EMNLP 2021'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Anatomy of a block',
        say: 'This is one of the eighty blocks inside the language model, all identical in shape but each with its own weights. The horizontal line is the residual stream carrying one vector per token. Two sublayers branch off it. Attention reads a normalised copy, mixes information across positions, and adds its result back. Then the MLP reads the updated stream, transforms each position on its own, and adds again. Watch the vector for the token ice flow through, collecting two additive updates.',
        deep: '<div class="eq">h = x + Attn(RMSNorm(x))</div><div class="eq">y = h + MLP(RMSNorm(h))</div>' +
          '<p>This is the <b>pre-norm</b> decoder block used by essentially every modern LLM (Llama, Qwen, DeepSeek, Mistral, Gemma). Shapes stay <code>[T, d]</code> = <code>[T, 8192]</code> end to end, so blocks stack freely.</p>' +
          '<ul><li><b>Pre-norm</b> (norm inside the branch) keeps an unnormalised identity path from input to output: gradients reach early layers without passing through any normalisation, so 80–120-layer stacks train stably and are far less sensitive to learning-rate warm-up than post-norm (Xiong et al. 2020). The price: the stream norm grows with depth, so a final RMSNorm precedes the unembedding.</li>' +
          '<li>Attention is the only op that moves information <i>between</i> positions; everything else is position-wise.</li>' +
          '<li>Per block (70B config): ≈ 151 M attention + 705 M MLP parameters.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          S.diagram = ctx.group();
          var D = S.diagram;
          S.stream = ctx.line(70, SY, 1530, SY, { color: ctx.alpha('white', 0.85), sw: 3, arrow: true, parent: D });
          ctx.text(80, SY + 28, 'residual stream   x ∈ ℝ^(T × 8192)', { size: 13, font: 'mono', color: 'dim', parent: D });
          ctx.text(1520, SY + 28, 'to block ℓ+1', { size: 13, font: 'mono', color: 'dim', anchor: 'end', parent: D });
          S.norm1 = ctx.node({ x: 265, y: 330, w: 130, h: 54, title: 'RMSNorm', color: 'white', titleSize: 15, parent: D, glow: false });
          S.attn = ctx.node({ x: 470, y: 330, w: 200, h: 72, title: 'Attention', sub: 'GQA 64q/8kv · RoPE', color: 'amber', titleSize: 17, subSize: 11, parent: D });
          S.norm2 = ctx.node({ x: 830, y: 330, w: 130, h: 54, title: 'RMSNorm', color: 'white', titleSize: 15, parent: D, glow: false });
          S.mlp = ctx.node({ x: 1050, y: 330, w: 220, h: 72, title: 'MLP', sub: 'SwiGLU 8192→28672→8192', color: 'orange', titleSize: 17, subSize: 11, parent: D });
          S.pA = ctx.path('M170,' + SY + ' V330 H' + S.norm1.box.l, { stroke: ctx.alpha('white', 0.7), sw: 1.8, arrow: true, parent: D });
          S.lA = ctx.link(S.norm1, S.attn, { color: 'white', parent: D });
          S.pA2 = ctx.path('M' + S.attn.box.r + ',330 H640 V' + (SY - 15), { stroke: 'amber', sw: 1.8, arrow: true, parent: D });
          S.add1 = addCircle(ctx, D, 640, SY);
          S.pB = ctx.path('M725,' + SY + ' V330 H' + S.norm2.box.l, { stroke: ctx.alpha('white', 0.7), sw: 1.8, arrow: true, parent: D });
          S.lB = ctx.link(S.norm2, S.mlp, { color: 'white', parent: D });
          S.pB2 = ctx.path('M' + S.mlp.box.r + ',330 H1230 V' + (SY - 15), { stroke: 'orange', sw: 1.8, arrow: true, parent: D });
          S.add2 = addCircle(ctx, D, 1230, SY);
          ctx.text(470, 236, 'h = x + Attn(RMSNorm(x))', { size: 16, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: D });
          ctx.text(470, 260, 'mixes information across positions', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: D });
          ctx.text(1050, 236, 'y = h + MLP(RMSNorm(h))', { size: 16, font: 'mono', weight: 700, color: 'orange', anchor: 'middle', parent: D });
          ctx.text(1050, 260, 'transforms each position independently', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: D });
          ctx.label(1440, 196, 'block ℓ of 80', { color: 'amber', size: 12, parent: D });
          ctx.reveal(D, { from: 'fade', dur: 700 });
          ctx.reveal([S.pA, S.lA, S.pA2, S.pB, S.lB, S.pB2], { from: 'draw', stagger: 120, delay: 300 });

          /* explainer panel with the three sequential ops */
          var g = panel(ctx, S, 'ONE TOKEN THROUGH ONE BLOCK   (token "·ice", position t)', 'amber');
          var eqs = [['x', 'row t of the stream, 8,192 numbers', 'white'], ['h = x + Δattn', 'attention pulls context from earlier tokens', 'amber'], ['y = h + Δmlp', 'MLP rewrites features at this position', 'orange']];
          S.eqRows = eqs.map(function (e, i) {
            var rg = ctx.group({ parent: g }), y = 632 + i * 60;
            ctx.text(100, y, e[0], { size: 18, font: 'mono', weight: 700, color: e[2], parent: rg });
            ctx.text(360, y, e[1], { size: 14, font: 'mono', color: 'text', parent: rg });
            return rg;
          });
          ctx.text(100, 830, 'no sublayer overwrites the stream: every update is additive, so the identity path survives all 80 blocks', { size: 13, font: 'mono', color: 'dim', parent: g });
          S.vRow = [];
          var r0 = ctx.rng(12);
          S.vals = [];
          for (var k = 0; k < 16; k++) S.vals.push(r0() * 2 - 1);
          S.bigVec = ctx.matrix(1040, 612, 3, 16, { cell: 22, gap: 4, cmap: 'diverge', parent: g, values: function (r, c) { return r === 0 ? S.vals[c] : 0; } });
          ctx.text(1030, 623, 'x', { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: g });
          ctx.text(1030, 649, 'h', { size: 13, font: 'mono', color: 'amber', anchor: 'end', parent: g });
          ctx.text(1030, 675, 'y', { size: 13, font: 'mono', color: 'orange', anchor: 'end', parent: g });
          ctx.text(1040, 712, 'first 16 of 8,192 dims', { size: 11, font: 'mono', color: 'dim', parent: g });
          S.eqRows.forEach(function (rg) { rg.setAttribute('opacity', 0.2); });

          /* the flowing token vector */
          S.vec = ctx.group();
          var vm = ctx.matrix(-6, -36, 8, 1, { cell: 8, gap: 1, cmap: 'diverge', parent: S.vec, values: function (r) { return S.vals[r]; } });
          ctx.rect(-9, -39, 18, 78, { rx: 4, stroke: 'white', sw: 1.2, parent: S.vec, glow: true });
          ctx.text(0, -52, '·ice', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.vec });
          S.vecM = vm;
          ctx.place(S.vec, 100, SY);
          ctx.reveal(S.vec, { delay: 500 });
          var r1 = ctx.rng(40);
          var dA = S.vals.map(function () { return (r1() * 2 - 1) * 0.6; });
          var dM = S.vals.map(function () { return (r1() * 2 - 1) * 0.6; });
          function applyRow(row, fn) { for (var c = 0; c < 16; c++) S.bigVec.cells[row][c].setAttribute('fill', ctx.cmap('diverge', fn(c))); }
          return ctx.wait(1000).then(function () {
            S.eqRows[0].setAttribute('opacity', 1);
            return ctx.transform(S.vec, { x: 170 }, 400, 'inOut');
          }).then(function () {
            ctx.transform(S.vec, { x: 640 }, 1500, 'inOut');
            return ctx.packet(S.pA, { color: 'white', dur: 500 }).then(function () {
              ctx.pulse(S.norm1, { color: 'white', dur: 400 });
              return ctx.packet(S.lA, { color: 'white', dur: 300 });
            }).then(function () {
              ctx.pulse(S.attn, { color: 'amber', dur: 500 });
              return ctx.packet(S.pA2, { color: 'amber', dur: 600, label: 'Δattn' });
            });
          }).then(function () {
            ctx.pulse(S.add1, { color: 'amber', dur: 400 });
            S.eqRows[1].setAttribute('opacity', 1);
            applyRow(1, function (c) { return S.vals[c] + dA[c]; });
            vm.set(function (r) { return S.vals[r] + dA[r]; });
            return ctx.transform(S.vec, { x: 725 }, 350, 'inOut');
          }).then(function () {
            ctx.transform(S.vec, { x: 1230 }, 1500, 'inOut');
            return ctx.packet(S.pB, { color: 'white', dur: 500 }).then(function () {
              ctx.pulse(S.norm2, { color: 'white', dur: 400 });
              return ctx.packet(S.lB, { color: 'white', dur: 300 });
            }).then(function () {
              ctx.pulse(S.mlp, { color: 'orange', dur: 500 });
              return ctx.packet(S.pB2, { color: 'orange', dur: 600, label: 'Δmlp' });
            });
          }).then(function () {
            ctx.pulse(S.add2, { color: 'orange', dur: 400 });
            S.eqRows[2].setAttribute('opacity', 1);
            applyRow(2, function (c) { return S.vals[c] + dA[c] + dM[c]; });
            vm.set(function (r) { return S.vals[r] + dA[r] + dM[r]; });
            return ctx.transform(S.vec, { x: 1330 }, 600, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'RMSNorm',
        say: 'Each branch starts with RMSNorm. It divides the vector by its root mean square, so the sublayer always sees inputs of the same scale, then multiplies by a learned gain per dimension. Unlike LayerNorm it does not subtract the mean and has no bias, which is cheaper and works just as well. Notice the outlier dimension: large models develop a few huge activations. They dominate the root mean square, so normalising shrinks every other coordinate, and they are the main headache for low precision quantisation.',
        deep: '<div class="eq">RMSNorm(x) = x / √(1/d · Σ<sub>i</sub> x<sub>i</sub>² + ε) ⊙ γ</div>' +
          '<div class="eq">LayerNorm(x) = (x − μ)/√(σ² + ε) ⊙ γ + β</div>' +
          '<ul><li>RMSNorm drops re-centring and β: one reduction instead of two; empirically equal quality (Zhang &amp; Sennrich 2019). The reduction is done in FP32 even under BF16 training.</li>' +
          '<li>It is <b>memory-bound</b> (≈ 3 FLOPs per element, reads and writes the whole activation), so kernels fuse it with the residual add and the following matmul’s input quantisation.</li>' +
          '<li><b>Massive activations</b> (Sun et al. 2024): a few activations — fixed dimensions at specific tokens such as BOS or the first delimiter — are orders of magnitude (up to ~10⁴×) larger than the median. They inflate rms(x), so every other coordinate is scaled down; they act as implicit biases that create attention sinks, and together with channel outliers they are the main headache for INT8/FP8 activation quantisation.</li>' +
          '<li>Variants: <b>QK-norm</b> (RMSNorm on q and k per head; OLMo 2, Qwen3, Gemma 3) bounds attention logits; <b>sandwich / post-norm</b> placements return in some recent models for stability.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          mark(ctx, S, S.norm1, 'white');
          ctx.fadeOut(S.vec, 300, true);
          var g = panel(ctx, S, 'RMSNorm  x / rms(x) · γ', 'white');
          var X = [0.8, -1.2, 0.3, 1.9, -0.5, 0.1, -1.4, 0.6, 1.1, -0.3, 0.2, -0.9, 6.2, 0.4, -1.0, 0.7];
          var rms = Math.sqrt(X.reduce(function (a, v) { return a + v * v; }, 0) / X.length);
          var gr = ctx.rng(8);
          var G = X.map(function () { return 0.7 + gr() * 0.6; });
          var BY = 764, SC = 26, bw = 34;
          ctx.line(100, BY, 100 + 16 * 44, BY, { color: 'faint', parent: g });
          S.ghost = ctx.group({ parent: g });
          X.forEach(function (v, i) {
            var h = Math.min(Math.abs(v) * SC, 165);
            ctx.rect(104 + i * 44, v >= 0 ? BY - h : BY, bw, h, { rx: 3, stroke: ctx.alpha('white', 0.35), sw: 1, dash: '3 3', parent: S.ghost });
          });
          ctx.text(104 + 3 * 44 + 17, BY - 1.9 * SC - 12, 'raw x', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.ghost });
          S.ghost.setAttribute('opacity', 0);
          S.nbars = X.map(function (v, i) {
            return ctx.rect(104 + i * 44, BY, bw, 0, { rx: 3, fill: ctx.alpha(i === 12 ? 'pink' : 'cyan', 0.55), stroke: i === 12 ? 'pink' : 'cyan', sw: 1, parent: g });
          });
          S.rmsLine = ctx.rect(100, BY - rms * SC - 1, 704, 2, { rx: 1, fill: ctx.alpha('amber', 0.9), parent: g });
          S.rmsLbl = ctx.text(810, BY - rms * SC, 'rms = ' + rms.toFixed(2), { size: 12, font: 'mono', color: 'amber', parent: g });
          S.phase = ctx.text(100, 624, '', { size: 15, font: 'mono', weight: 700, color: 'white', parent: g });
          ctx.text(104 + 12 * 44 + 17, 850, 'outlier dim', { size: 11, font: 'mono', color: 'pink', anchor: 'middle', parent: g });
          function setBars(vals) {
            vals.forEach(function (v, i) {
              var h = Math.min(Math.abs(v) * SC, 165);
              S.nbars[i].setAttribute('y', v >= 0 ? BY - h : BY);
              S.nbars[i].setAttribute('height', h);
            });
          }
          function morph(from, to, ms) { return ctx.tween(ms, function (t) { setBars(from.map(function (v, i) { return v + (to[i] - v) * t; })); }, 'inOut'); }
          var c = ctx.group({ parent: g });
          ctx.rect(900, 596, 620, 264, { rx: 10, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('white', 0.2), parent: c });
          ctx.para(920, 630, ['rms(x) = √( (1/d) Σ x_i² + ε )', 'y_i   = x_i / rms(x) · γ_i', '', 'no mean subtraction, no bias β', 'd = 8,192 gains γ per norm (tiny)', 'fp32 reduction, fused with the', 'residual add in real kernels'], { size: 14, font: 'mono', color: 'text', lh: 30, parent: c });
          keepWS(c);
          var Xn = X.map(function (v) { return v / rms; });
          var Xg = Xn.map(function (v, i) { return v * G[i]; });
          setBars(X.map(function () { return 0; }));
          S.phase.textContent = 'x  (raw stream values)';
          return ctx.wait(500).then(function () {
            return morph(X.map(function () { return 0; }), X, 700);
          }).then(function () { return ctx.wait(700); }).then(function () {
            S.phase.textContent = 'x / rms(x)   (unit RMS)';
            ctx.reveal(S.ghost, { dur: 400 });
            ctx.animate(S.rmsLine, { y: [BY - rms * SC - 1, BY - SC - 1] }, 800);
            S.rmsLbl.textContent = 'rms = 1.00';
            S.rmsLbl.setAttribute('y', BY - SC);
            return morph(X, Xn, 800);
          }).then(function () { return ctx.wait(700); }).then(function () {
            S.phase.textContent = 'x / rms(x) · γ   (learned gain per dim)';
            return morph(Xn, Xg, 800);
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Attention sublayer',
        say: 'Inside the attention sublayer, the normalised vector is projected into queries, keys and values. The seventy billion model has sixty four query heads but only eight key value heads: grouped query attention. Each group of eight query heads shares one key and one value head, which shrinks the key value cache eight fold with almost no quality loss. Head outputs are concatenated and projected back to the stream width by the output matrix.',
        deep: '<div class="eq">Q = xW<sub>Q</sub> ∈ ℝ<sup>T×64×128</sup>, &nbsp; K = xW<sub>K</sub>, V = xW<sub>V</sub> ∈ ℝ<sup>T×8×128</sup></div>' +
          '<div class="eq">head<sub>j</sub> = softmax(q<sub>j</sub>K<sub>g(j)</sub>ᵀ/√128 + M) V<sub>g(j)</sub>, &nbsp; g(j) = ⌊j/8⌋</div>' +
          '<div class="eq">Attn(x) = [head<sub>0</sub>; …; head<sub>63</sub>] W<sub>O</sub></div>' +
          '<table><tr><th></th><th>MHA</th><th>GQA-8</th><th>MQA</th></tr>' +
          '<tr><td>KV heads</td><td>64</td><td>8</td><td>1</td></tr>' +
          '<tr><td>KV cache / token (80 L, BF16)</td><td>2.5 MiB</td><td>320 KiB</td><td>40 KiB</td></tr>' +
          '<tr><td>attn params / block</td><td>268 M</td><td>151 M</td><td>136 M</td></tr></table>' +
          '<p>DeepSeek-V2/V3 go further with <b>MLA</b>: K and V are reconstructed from a 512-dim compressed latent (+64-dim decoupled RoPE key), caching ≈ 70 KB per token for a 61-layer model. The mechanism itself is covered in the Attention chamber.</p>',
        run: function (ctx) {
          var S = ctx.state;
          mark(ctx, S, S.attn, 'amber');
          var g = panel(ctx, S, 'GROUPED-QUERY ATTENTION   64 query heads share 8 KV heads', 'amber');
          /* projections */
          ctx.text(90, 630, 'x', { size: 16, font: 'mono', weight: 700, color: 'white', parent: g });
          ctx.text(90, 652, '[T, 8192]', { size: 11, font: 'mono', color: 'dim', parent: g });
          var projs = [['W_Q', '8192×8192', 'amber', 640], ['W_K', '8192×1024', 'cyan', 730], ['W_V', '8192×1024', 'teal', 820]];
          projs.forEach(function (p) {
            ctx.line(170, 640, 214, p[3] - 2, { color: ctx.alpha(p[2], 0.6), parent: g });
            ctx.label(260, p[3], p[0], { color: p[2], size: 12, w: 80, parent: g });
            ctx.text(310, p[3], p[1], { size: 11, font: 'mono', color: 'dim', parent: g });
          });
          /* 64 q heads in 8 groups, 8 kv heads */
          S.qCells = [];
          S.kvCells = [];
          var GX = 470;
          for (var gI = 0; gI < 8; gI++) {
            var gx = GX + gI * 84;
            for (var h = 0; h < 8; h++) {
              var q = ctx.rect(gx + (h % 4) * 17, 634 + Math.floor(h / 4) * 17, 14, 14, { rx: 2, fill: ctx.alpha('amber', 0.3), stroke: 'amber', sw: 0.8, parent: g });
              S.qCells.push(q);
            }
            var kv = ctx.rect(gx + 18, 760, 30, 24, { rx: 4, fill: ctx.alpha('cyan', 0.3), stroke: 'cyan', sw: 1.2, parent: g });
            ctx.path('M' + (gx + 33) + ',758 L' + (gx + 33) + ',672', { stroke: ctx.alpha('cyan', 0.5), sw: 1.2, dash: '3 3', parent: g });
            ctx.text(gx + 33, 800, 'kv' + gI, { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: g });
            S.kvCells.push(kv);
          }
          ctx.text(GX, 618, 'query heads q0 … q63 (d_h = 128), 8 groups', { size: 12, font: 'mono', color: 'amber', parent: g });
          ctx.text(GX, 826, 'shared K/V heads: cache stores only these', { size: 12, font: 'mono', color: 'cyan', parent: g });
          /* output */
          var c = ctx.group({ parent: g });
          ctx.rect(1170, 596, 350, 264, { rx: 10, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('amber', 0.3), parent: c });
          ctx.para(1190, 628, ['concat 64 × 128 = 8192', '· W_O (8192×8192)', '→ Δattn added to stream', '', 'KV cache per token:', ' MHA   2.5 MiB', ' GQA-8 320 KiB  (8× less)', ' MQA   40 KiB'], { size: 13, font: 'mono', color: 'text', lh: 28, parent: c });
          keepWS(c);
          var r = ctx.rng(6);
          return ctx.wait(600).then(function () {
            var ch = Promise.resolve();
            [0, 3, 6].forEach(function (gI) {
              ch = ch.then(function () {
                ctx.pulse(S.kvCells[gI], { color: 'cyan', dur: 500 });
                return ctx.tween(500, function (t) {
                  for (var h = 0; h < 8; h++) S.qCells[gI * 8 + h].setAttribute('fill', ctx.alpha('amber', 0.3 + 0.6 * t));
                }, 'out');
              });
            });
            return ch;
          }).then(function () {
            return ctx.tween(900, function (t) {
              S.qCells.forEach(function (q, i) { q.setAttribute('fill', ctx.alpha('amber', 0.25 + 0.6 * Math.abs(Math.sin(t * 3 + i * 0.37)))); });
            }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'RoPE',
        say: 'Attention by itself is blind to order. Rotary position embedding fixes that by rotating each pair of query and key dimensions by an angle proportional to the token position. Fast pairs spin every token; slow pairs barely move across thousands of tokens. Because both query and key are rotated, their dot product depends only on the distance between them, not on absolute position. Watch both vectors advance together: in every plane the angle between them stays fixed.',
        deep: '<div class="eq">θ<sub>i</sub> = b<sup>−2i/d<sub>h</sub></sup>, &nbsp; R<sub>m</sub> = ⊕<sub>i</sub> [[cos mθ<sub>i</sub>, −sin mθ<sub>i</sub>],[sin mθ<sub>i</sub>, cos mθ<sub>i</sub>]]</div>' +
          '<div class="eq">⟨R<sub>m</sub>q, R<sub>n</sub>k⟩ = ⟨q, R<sub>n−m</sub>k⟩</div>' +
          '<p>Llama 3: d<sub>h</sub> = 128 (64 pairs), base b = 500,000. Pair 0 turns 1 rad per token (λ = 6.3 tokens); pair 63 has λ ≈ 2.6 M tokens. Applied to q and k only, after projection; V is not rotated.</p>' +
          '<p><b>Context extension</b>: pairs whose wavelength exceeds the training length never completed a rotation, so unseen angles appear at longer contexts. Fixes rescale frequencies:</p>' +
          '<ul><li><b>Position interpolation</b>: θ<sub>i</sub>/s for all i (blurs local order).</li>' +
          '<li><b>NTK-aware</b> scaling raises the base b, stretching low frequencies most and high ones least; <b>YaRN</b> ("NTK-by-parts") leaves high-frequency pairs untouched, fully interpolates low-frequency ones with a ramp between, and adds an attention temperature; it adapts with ≈ 0.1% of the pretraining tokens.</li>' +
          '<li><b>Llama 3.1</b>: factor 8 on pairs with λ &gt; 8,192, untouched below λ = 2,048, smooth ramp between → 8k → 128k.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          mark(ctx, S, S.attn, 'amber');
          var g = panel(ctx, S, 'ROTARY POSITION EMBEDDING   rotate (q, k) pairs by m·θ_i', 'cyan');
          var base = 500000, dh = 128;
          var planes = [0, 16, 48].map(function (i, j) {
            var cx = 170 + j * 205, cy = 730, R = 72;
            var pg = ctx.group({ parent: g });
            ctx.circle(cx, cy, R, { stroke: ctx.alpha('white', 0.18), parent: pg });
            ctx.line(cx - R - 6, cy, cx + R + 6, cy, { color: ctx.alpha('white', 0.08), parent: pg });
            ctx.line(cx, cy - R - 6, cx, cy + R + 6, { color: ctx.alpha('white', 0.08), parent: pg });
            var th = Math.pow(base, -2 * i / dh);
            ctx.text(cx, 624, 'pair i = ' + i, { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: pg });
            ctx.text(cx, 642, 'θ = ' + (th >= 0.01 ? th.toFixed(4) : th.toExponential(1)) + ' rad/tok', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pg });
            var q = ctx.line(cx, cy, cx + R, cy, { color: 'amber', sw: 2.6, arrow: true, parent: pg });
            var k = ctx.line(cx, cy, cx + R, cy, { color: 'cyan', sw: 2.6, arrow: true, parent: pg });
            var arc = ctx.path('', { stroke: 'white', sw: 1.2, parent: pg });
            return { cx: cx, cy: cy, R: R, th: th, q: q, k: k, arc: arc, q0: 0.35, k0: 1.25 };
          });
          ctx.text(90, 850, 'amber = q at position m     cyan = k at position n', { size: 12, font: 'mono', color: 'dim', parent: g });
          S.posTxt = ctx.text(600, 850, '', { size: 13, font: 'mono', weight: 700, color: 'white', parent: g });
          function setPos(m, n) {
            planes.forEach(function (p) {
              var aq = p.q0 + m * p.th, ak = p.k0 + n * p.th;
              p.q.setAttribute('x2', p.cx + p.R * Math.cos(aq)); p.q.setAttribute('y2', p.cy - p.R * Math.sin(aq));
              p.k.setAttribute('x2', p.cx + p.R * Math.cos(ak)); p.k.setAttribute('y2', p.cy - p.R * Math.sin(ak));
              var r = 26, a0 = Math.min(aq, ak), a1 = Math.max(aq, ak);
              var d = a1 - a0;
              d = d - 2 * Math.PI * Math.floor(d / (2 * Math.PI));
              var sx = p.cx + r * Math.cos(aq), sy = p.cy - r * Math.sin(aq), ex = p.cx + r * Math.cos(ak), ey = p.cy - r * Math.sin(ak);
              var dd = ((ak - aq) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
              p.arc.setAttribute('d', 'M' + sx.toFixed(1) + ',' + sy.toFixed(1) + ' A' + r + ',' + r + ' 0 ' + (dd > Math.PI ? 1 : 0) + ' 0 ' + ex.toFixed(1) + ',' + ey.toFixed(1));
            });
            S.posTxt.textContent = 'm = ' + Math.round(m) + '   n = ' + Math.round(n) + '   m − n = ' + Math.round(m - n) + '  → angle between q,k fixed';
          }
          setPos(5, 0);

          /* wavelength plot with Llama 3.1 rescaling */
          var WX = 800, WY = 612, WW = 680, WH = 200;
          ctx.text(WX, 602, 'wavelength λ_i = 2π/θ_i (tokens, log)', { size: 12, font: 'mono', color: 'cyan', parent: g });
          ctx.line(WX, WY + WH, WX + WW, WY + WH, { color: 'faint', parent: g });
          ctx.line(WX, WY, WX, WY + WH, { color: 'faint', parent: g });
          function py(lam) { return WY + WH - (Math.log10(lam) / 7.6) * WH; }
          function px(i) { return WX + i / 63 * WW; }
          [10, 1000, 100000].forEach(function (v) { ctx.text(WX - 6, py(v), v >= 1000 ? (v / 1000) + 'k' : String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g }); });
          ctx.text(WX + WW, WY + WH + 16, 'pair index i → 63', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
          var d1 = '', d2 = '';
          for (var i = 0; i < 64; i++) {
            var lam = 2 * Math.PI * Math.pow(base, 2 * i / dh);
            var lam2 = lam;
            if (lam > 8192) lam2 = lam * 8;
            else if (lam > 2048) { var sm = (8192 / lam - 1) / (4 - 1); lam2 = lam / ((1 - sm) / 8 + sm); }
            d1 += (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(lam).toFixed(1) + ' ';
            d2 += (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(lam2).toFixed(1) + ' ';
          }
          S.w1 = ctx.path(d1, { stroke: 'cyan', sw: 2.2, parent: g });
          S.w2 = ctx.path(d2, { stroke: 'pink', sw: 2, dash: '5 4', parent: g });
          [[8192, '8k train ctx', 'amber'], [131072, '128k target', 'lime']].forEach(function (h) {
            ctx.line(WX, py(h[0]), WX + WW, py(h[0]), { color: ctx.alpha(h[2], 0.5), dash: '3 5', parent: g });
            ctx.text(WX + 8, py(h[0]) - 9, h[1], { size: 11, font: 'mono', color: h[2], parent: g });
          });
          ctx.text(WX + WW, 850, 'cyan: Llama 3 base 500k   pink: Llama 3.1 rescale (×8 for λ > 8k)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
          ctx.reveal([S.w1, S.w2], { from: 'draw', dur: 1200, stagger: 600, delay: 400 });
          return ctx.wait(700).then(function () {
            ctx.camera(380, 740, 1.6, 900);
            return ctx.tween(4200, function (t) { var m = 5 + t * 55; setPos(m, m - 5); }, 'inOut');
          }).then(function () {
            return ctx.camera(null, null, null, 800);
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'SwiGLU MLP',
        say: 'Now the MLP, which holds about four fifths of the block parameters. The vector is projected up to twenty eight thousand six hundred seventy two hidden units twice: a gate and an up projection. The gate passes through SiLU and multiplies the up projection element by element, so each hidden neuron acts like a soft switch on a feature. Then a down projection returns to the stream width. Click the highlighted neuron to zoom into a single neuron.',
        deep: '<div class="eq">MLP(x) = (SiLU(xW<sub>1</sub>) ⊙ xW<sub>3</sub>) W<sub>2</sub>, &nbsp; SiLU(z) = z·σ(z)</div>' +
          '<p>W<sub>1</sub>, W<sub>3</sub> ∈ ℝ<sup>d×d<sub>ff</sub></sup>, W<sub>2</sub> ∈ ℝ<sup>d<sub>ff</sub>×d</sup>: <b>3·d·d<sub>ff</sub></b> parameters. With d<sub>ff</sub> = 8/3·d the count matches a classic 4d GELU MLP (2 matrices × 4d²); Llama 3 70B uses d<sub>ff</sub> = 28,672 = 3.5 d → 705 M params, ≈ 1.4 GFLOP per token.</p>' +
          '<ul><li>GLU variants beat ReLU/GELU MLPs at equal compute (Shazeer 2020) and are now universal.</li>' +
          '<li><b>Key–value memory view</b> (Geva et al.): rows of W<sub>1</sub>/W<sub>3</sub> detect input patterns (keys), columns of W<sub>2</sub> write output directions (values) — e.g. a neuron that fires on "cold surface" contexts and writes toward "ice", "frozen".</li>' +
          '<li>Activation sparsity: SwiGLU outputs are not exactly zero, but most |activations| are small, which activation-sparsity inference methods exploit.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          mark(ctx, S, S.mlp, 'orange');
          /* persistent mini-neurons under the MLP node (zoom target) */
          S.nDots = ctx.group({ parent: S.diagram });
          for (var q = 0; q < 7; q++) {
            if (q === 3) continue;
            ctx.circle(990 + q * 20, 394, 5, { fill: ctx.alpha('orange', 0.5), stroke: 'orange', sw: 1, parent: S.nDots });
          }
          ctx.text(990 - 12, 394, '28,672 neurons', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.nDots });
          S.nDot = ctx.group({ parent: S.diagram });
          ctx.circle(1050, 394, 6, { fill: 'white', parent: S.nDot, glow: true });
          S.nDot.box = boxOf(1042, 386, 16, 16);
          ctx.reveal([S.nDots, S.nDot], { from: 'scale' });
          ctx.hotspot(S.nDot, 'neuron', { hint: 'NEURON ⤢' });
          var g = panel(ctx, S, 'SwiGLU MLP   (SiLU(x W1) ⊙ x W3) W2', 'orange');
          var r = ctx.rng(17);
          var xs = [];
          for (var i = 0; i < 12; i++) xs.push(r() * 2 - 1);
          ctx.text(110, 604, 'x', { size: 14, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: g });
          ctx.matrix(102, 614, 12, 1, { cell: 16, gap: 3, cmap: 'diverge', values: function (rr) { return xs[rr]; }, parent: g });
          ctx.text(110, 856, '8192', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          var N = 24, HX = 250;
          var gate = [], up = [];
          for (var k = 0; k < N; k++) { gate.push(r() * 5 - 2.8); up.push(r() * 2 - 1); }
          gate[16] = 2.6; up[16] = 0.9;
          var act = gate.map(function (z, k) { return silu(z) * up[k]; });
          S.gateM = ctx.matrix(HX, 624, 1, N, { cell: 17, gap: 3, cmap: 'diverge', values: function () { return 0; }, parent: g });
          S.upM = ctx.matrix(HX, 700, 1, N, { cell: 17, gap: 3, cmap: 'diverge', values: function () { return 0; }, parent: g });
          S.actM = ctx.matrix(HX, 790, 1, N, { cell: 17, gap: 3, cmap: 'diverge', values: function () { return 0; }, parent: g });
          ctx.text(HX, 612, 'g = x W1   (gate, 28,672 of them)', { size: 12, font: 'mono', color: 'orange', parent: g });
          ctx.text(HX, 688, 'u = x W3   (up)', { size: 12, font: 'mono', color: 'orange', parent: g });
          ctx.text(HX, 778, 'a = SiLU(g) ⊙ u   (hidden neurons)', { size: 12, font: 'mono', color: 'amber', parent: g });
          ctx.line(126, 640, HX - 6, 632, { color: ctx.alpha('orange', 0.5), arrow: true, parent: g });
          ctx.line(126, 700, HX - 6, 708, { color: ctx.alpha('orange', 0.5), arrow: true, parent: g });
          ctx.text(HX + N * 20 + 6, 634, 'SiLU', { size: 12, font: 'mono', color: 'pink', parent: g });
          ctx.text(HX + N * 20 + 6, 752, '⊙', { size: 20, font: 'mono', color: 'amber', parent: g });
          ctx.path('M' + (HX + N * 20 + 16) + ',644 V780', { stroke: ctx.alpha('amber', 0.4), dash: '3 4', arrow: true, parent: g });
          ctx.path('M' + (HX + N * 20 + 2) + ',799 H' + (HX + N * 20 + 60), { stroke: ctx.alpha('orange', 0.6), arrow: true, parent: g });
          ctx.text(HX + N * 20 + 30, 820, 'W2', { size: 12, font: 'mono', color: 'orange', anchor: 'middle', parent: g });
          var out = ctx.matrix(HX + N * 20 + 70, 614, 12, 1, { cell: 16, gap: 3, cmap: 'diverge', values: function () { return 0; }, parent: g });
          ctx.text(HX + N * 20 + 78, 604, 'Δ', { size: 14, font: 'mono', weight: 700, color: 'orange', anchor: 'middle', parent: g });
          /* the neuron hotspot */
          var nc = S.actM.cellCenter(0, 16);
          S.neuronG = ctx.group({ parent: g });
          ctx.rect(nc.x - 13, nc.y - 13, 26, 26, { rx: 5, stroke: 'white', sw: 2, parent: S.neuronG, glow: true });
          ctx.text(nc.x, nc.y + 30, 'neuron #16', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: S.neuronG });
          S.neuronG.box = boxOf(nc.x - 16, nc.y - 16, 32, 32);
          S.neuronG.setAttribute('opacity', 0);
          /* SiLU plot */
          var pl = ctx.plot(930, 620, 250, 150, silu, { xDomain: [-5, 4], yDomain: [-0.5, 4], color: 'pink', sw: 2.2, parent: g, xLabel: 'z', yLabel: 'SiLU(z) = z·σ(z)' });
          var z0 = pl.toPx(0, 0);
          ctx.line(930, z0.y, 1180, z0.y, { color: ctx.alpha('white', 0.12), parent: g });
          S.dot = ctx.circle(pl.toPx(-5, silu(-5)).x, pl.toPx(-5, silu(-5)).y, 5, { fill: 'white', parent: g, glow: true });
          var c = ctx.group({ parent: g });
          ctx.rect(1220, 596, 300, 264, { rx: 10, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('orange', 0.3), parent: c });
          ctx.para(1238, 626, ['d_ff = 28,672 = 3.5 d', 'params 3·d·d_ff = 705 M', '≈ 82% of the block', 'FLOPs 6·d·d_ff/token', '  = 1.4 GFLOP', '', 'rows of W1,W3 = keys', 'cols of W2 = values'], { size: 13, font: 'mono', color: 'text', lh: 28, parent: c });
          keepWS(c);
          return ctx.wait(600).then(function () {
            return ctx.tween(700, function (t) {
              S.gateM.set(function (rr, cc) { return Math.tanh(gate[cc] / 2) * t; });
              S.upM.set(function (rr, cc) { return up[cc] * t; });
            }, 'out');
          }).then(function () {
            return ctx.tween(1200, function (t) {
              var z = -5 + 9 * t, p = pl.toPx(z, silu(z));
              S.dot.setAttribute('cx', p.x); S.dot.setAttribute('cy', p.y);
              S.gateM.set(function (rr, cc) { var gz = gate[cc]; return Math.tanh((gz + (silu(gz) - gz) * t) / 2); });
            }, 'inOut');
          }).then(function () {
            return ctx.tween(700, function (t) { S.actM.set(function (rr, cc) { return Math.tanh(act[cc]) * t; }); }, 'out');
          }).then(function () {
            return ctx.tween(600, function (t) { out.set(function (rr) { return Math.sin(rr * 1.7 + 0.4) * 0.8 * t; }); }, 'out');
          }).then(function () {
            ctx.reveal(S.neuronG, { from: 'scale' });
            ctx.hotspot(S.neuronG, 'neuron', { hint: 'NEURON ⤢' });
            return ctx.pulse(S.neuronG, { color: 'white', dur: 700, times: 2 });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Mixture of Experts',
        say: 'Frontier models often replace this dense MLP with a mixture of experts. A small router scores many expert MLPs for each token and sends the token only to the top few, plus a shared expert that always runs. Here the ice token goes to experts four and one. DeepSeek V3 has two hundred fifty six routed experts per layer and activates eight, so each layer stores eleven billion parameters but computes with only about four hundred million. Zoom in for routing and load balancing.',
        deep: '<div class="eq">y = Σ<sub>i∈TopK(s)</sub> g<sub>i</sub> · E<sub>i</sub>(x) + E<sub>shared</sub>(x), &nbsp; s = softmax(x W<sub>r</sub>) or σ(x W<sub>r</sub>)</div>' +
          '<ul><li>Each expert is a small SwiGLU MLP. DeepSeek-V3 (d = 7,168): 256 routed experts with d<sub>ff</sub> = 2,048, top-8 + 1 shared → 3·7168·2048 = 44 M params per expert; <b>11.3 B stored, 0.40 B active</b> per MoE layer.</li>' +
          '<li><b>Load balancing</b> is the crux: auxiliary losses (Switch/GShard), or DeepSeek-V3\'s aux-loss-free bias terms added to routing scores, prevent expert collapse.</li>' +
          '<li><b>Systems cost</b>: tokens are dispatched to experts on other GPUs (expert parallelism) with two all-to-all exchanges per layer; capacity factors cap per-expert batches.</li>' +
          '<li>Granularity trend: a few large experts (Mixtral 8×7B, top-2) → many fine-grained experts (DeepSeek-V3: 256 routed + 1 shared, top-8; Qwen3-235B-A22B: 128, top-8; Kimi K2: 384 + 1 shared, top-8).</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          mark(ctx, S, S.mlp, 'orange');
          S.moeTag = ctx.label(1050, 432, 'or: Mixture of Experts', { color: 'orange', size: 11, parent: S.diagram });
          S.moeTag.box = boxOf(1050 - S.moeTag.w / 2, 432 - S.moeTag.h / 2, S.moeTag.w, S.moeTag.h);
          ctx.reveal(S.moeTag, {});
          ctx.hotspot(S.moeTag, 'moe', { hint: 'MoE ⤢' });
          var g = panel(ctx, S, 'MIXTURE OF EXPERTS   the MLP, made sparse', 'orange');
          S.moeG = ctx.group({ parent: g });
          var logits = [0.2, 1.9, -0.4, 0.6, 2.3, -1.0, 0.1, 0.5];
          var p = softmax(logits);
          var order = p.map(function (v, i) { return [v, i]; }).sort(function (a, b) { return b[0] - a[0]; });
          var top = [order[0][1], order[1][1]];
          var gsum = p[top[0]] + p[top[1]];
          ctx.label(140, 720, '·ice  x', { color: 'white', size: 13, w: 90, parent: S.moeG });
          var router = ctx.node({ x: 300, y: 720, w: 120, h: 56, title: 'Router', sub: 'x · W_r', color: 'magenta', titleSize: 14, subSize: 11, parent: S.moeG });
          ctx.line(186, 720, 238, 720, { color: 'white', arrow: true, parent: S.moeG });
          /* router scores */
          S.rBars = [];
          for (var i = 0; i < 8; i++) {
            var y = 612 + i * 30;
            ctx.text(420, y, 's' + i, { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.moeG });
            var b = ctx.rect(428, y - 9, 0, 18, { rx: 3, fill: ctx.alpha(top.indexOf(i) >= 0 ? 'magenta' : 'dim', 0.6), parent: S.moeG });
            S.rBars.push([b, 150 * p[i] / p[top[0]]]);
            ctx.text(588, y, p[i].toFixed(2), { size: 11, font: 'mono', color: top.indexOf(i) >= 0 ? 'magenta' : 'dim', parent: S.moeG });
          }
          ctx.line(362, 720, 404, 720, { color: 'magenta', arrow: true, parent: S.moeG });
          /* experts: a column of 8 routed experts + 1 shared */
          S.experts = [];
          for (var e = 0; e < 8; e++) {
            var n = ctx.node({ x: 800, y: 606 + e * 29, w: 150, h: 24, title: 'expert E' + e, color: 'orange', titleSize: 12, parent: S.moeG, glow: false, kind: 'pill' });
            n.setAttribute('opacity', 0.3);
            S.experts.push(n);
          }
          S.shared = ctx.node({ x: 800, y: 848, w: 150, h: 26, title: 'shared expert', color: 'teal', titleSize: 12, parent: S.moeG, glow: false, kind: 'pill' });
          S.sum = addCircle(ctx, S.moeG, 1010, 720);
          S.moeLinks = top.map(function (ti) { return ctx.link(S.experts[ti], S.sum, { color: 'orange', parent: S.moeG, from: 'r', to: 'l', label: 'g=' + (p[ti] / gsum).toFixed(2), labelDx: -30, labelDy: -12 }); });
          S.shLink = ctx.link(S.shared, S.sum, { color: 'teal', parent: S.moeG, from: 'r', to: 'b' });
          S.inLinks = top.map(function (ti) { return ctx.link({ x: 632, y: 720 }, S.experts[ti], { color: 'magenta', parent: S.moeG, to: 'l' }); });
          ctx.line(1025, 720, 1066, 720, { color: 'orange', arrow: true, parent: S.moeG });
          ctx.para(1080, 640, ['Δmlp = Σ g_i E_i(x) + E_shared(x)', 'here: top-2 of 8 experts', '', 'DeepSeek-V3 per MoE layer:', ' 256 routed + 1 shared, top-8', ' 11.3 B stored, 0.40 B active', ' experts live on other GPUs:', ' all-to-all dispatch + combine'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: S.moeG });
          keepWS(S.moeG);
          S.moeG.box = boxOf(80, 606, 1440, 258);
          [S.moeLinks, S.inLinks].forEach(function (arr) { arr.forEach(function (l) { l.setAttribute('opacity', 0); if (l.labelEl) l.labelEl.setAttribute('opacity', 0); }); });
          return ctx.wait(500).then(function () {
            return Promise.all(S.rBars.map(function (b, i) { return ctx.animate(b[0], { width: [0, b[1]] }, 600, 'out', i * 60); }));
          }).then(function () {
            ctx.reveal(S.inLinks, { from: 'draw', stagger: 150 });
            top.forEach(function (ti) { ctx.fade(S.experts[ti], 1, 400); ctx.pulse(S.experts[ti], { color: 'orange', dur: 600 }); });
            return ctx.wait(700);
          }).then(function () {
            S.moeLinks.forEach(function (l) { l.setAttribute('opacity', 1); ctx.reveal(l.labelEl, {}); });
            ctx.reveal(S.moeLinks, { from: 'draw', stagger: 150 });
            return ctx.reveal(S.shLink, { from: 'draw' });
          }).then(function () {
            ctx.hotspot(S.moeG, 'moe', { hint: 'MoE ⤢' });
            return ctx.pulse(S.sum, { color: 'orange', dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Parameter accounting',
        say: 'Let us count. The classic transformer block has twelve times d squared parameters: four d squared in attention and eight d squared in a four times wide MLP. At a width of eight thousand one hundred ninety two, that is eight hundred five million. Llama style blocks change the split: grouped query attention shrinks the key and value projections, and the wider SwiGLU MLP grows. The result, eight hundred fifty six million per block, times eighty blocks, is the seventy billion model.',
        deep: '<div class="eq">classic: 4d² (W<sub>Q</sub>,W<sub>K</sub>,W<sub>V</sub>,W<sub>O</sub>) + 8d² (d→4d→d) = 12d²</div>' +
          '<div class="eq">Llama-3-70B: 2d² + 2·d·(n<sub>kv</sub>d<sub>h</sub>) + 3·d·d<sub>ff</sub> = 134.2 M + 16.8 M + 704.6 M = 855.6 M</div>' +
          '<table><tr><th>per block</th><th>attention</th><th>MLP</th><th>total</th></tr>' +
          '<tr><td>classic 12d², d=8192</td><td>268 M</td><td>537 M</td><td>805 M</td></tr>' +
          '<tr><td>Llama 3 70B</td><td>151 M</td><td>705 M</td><td>856 M</td></tr>' +
          '<tr><td>DeepSeek-V3 MoE layer</td><td>MLA ≈ 187 M</td><td>11.3 B (0.40 B active)</td><td>—</td></tr></table>' +
          '<p><b>FLOPs per token per block</b> ≈ 2 × active params + 4·T·d for attention scores and weighted values: at T = 8k, 1.71 G + 0.27 G. Norms, RoPE and residual adds are &lt; 0.1% of FLOPs but a large share of memory traffic — hence kernel fusion.</p>',
        run: function (ctx) {
          var S = ctx.state;
          mark(ctx, S, null);
          var g = panel(ctx, S, 'PARAMETERS PER BLOCK   (d = 8,192)', 'amber');
          var SC = 1000 / 900;
          var rows = [
            ['classic MHA + 4d GELU', [['W_Q,W_K,W_V,W_O  4d² = 268M', 268.4, 'amber'], ['MLP 8d² = 537M', 536.9, 'orange']], '805 M = 12d²'],
            ['Llama 3 70B (GQA + SwiGLU)', [['Q,O 2d²', 134.2, 'amber'], ['K,V', 16.8, 'cyan'], ['SwiGLU 3·d·d_ff = 705M', 704.6, 'orange']], '856 M'],
            ['× 80 blocks', [['68.4 B + 2.1 B embed/unembed ≈ 70.6 B   (bar ÷ 80)', 855.6, 'lime']], '']
          ];
          S.pBars = [];
          rows.forEach(function (row, i) {
            var y = 640 + i * 70, x = 380;
            ctx.text(360, y, row[0], { size: 14, font: 'mono', color: 'white', anchor: 'end', parent: g });
            row[1].forEach(function (seg) {
              var w = seg[1] * SC * 0.95;
              var b = ctx.rect(x, y - 16, w - 2, 32, { rx: 4, fill: ctx.alpha(seg[2], 0.45), stroke: seg[2], sw: 1, parent: g });
              var t = ctx.text(x + 8, y, w > 60 ? seg[0] : '', { size: 12, font: 'mono', color: 'white', parent: g });
              if (w <= 60) ctx.text(x + w / 2, y + 28, seg[0], { size: 11, font: 'mono', color: seg[2], anchor: 'middle', parent: g });
              S.pBars.push([b, w - 2, t]);
              x += w;
            });
            if (row[2]) ctx.text(x + 12, y, row[2], { size: 14, font: 'mono', weight: 700, color: 'amber', parent: g });
          });
          ctx.text(380, 848, 'FLOPs/token/block ≈ 2 × active params + 4·T·d  =  1.71 G + 0.27 G at T = 8k', { size: 13, font: 'mono', color: 'text', parent: g });
          S.pBars.forEach(function (b) { b[0].setAttribute('width', 0); b[2].setAttribute('opacity', 0); });
          return ctx.wait(500).then(function () {
            return Promise.all(S.pBars.map(function (b, i) {
              return ctx.animate(b[0], { width: [0, b[1]] }, 700, 'out', i * 220).then(function () { return ctx.reveal(b[2], { dur: 300 }); });
            }));
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Depth builds circuits',
        say: 'Why stack eighty blocks? Because blocks compose through the residual stream. A classic example is the induction circuit. In an early layer, a previous token head writes into each position which token came just before it. Much later, an induction head at the current ice asks: where did ice appear before, and what followed it? It finds moon and copies it forward. Two simple heads in different layers implement in-context copying that neither can do alone.',
        deep: '<p><b>Induction circuit</b> (Olsson et al. 2022): (1) a <i>previous-token head</i> in layer ℓ₁ writes "my predecessor is A" into position j\'s stream; (2) an <i>induction head</i> in layer ℓ₂ &gt; ℓ₁ uses <b>K-composition</b> — its keys read that subspace — so the query "current token = A" matches positions whose predecessor was A, and its OV circuit copies the token found there.</p>' +
          '<div class="eq">[… ice moon …] … ice → attend to "moon" → boost logit(" moon")</div>' +
          '<ul><li>Induction heads form abruptly early in training and coincide with a jump in in-context learning ability.</li>' +
          '<li>Composition types: Q-, K- and V-composition between heads; MLPs act as lookup tables in between.</li>' +
          '<li>Depth is a <i>serial</i> compute budget: multi-hop reasoning needs several layers per hop, one motivation for chain-of-thought, which trades depth for sequence length.</li></ul>' +
          '<div class="note">Zoom targets from this chamber: the <b>Neuron</b> (in the MLP) and <b>Mixture of Experts</b>.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var g = panel(ctx, S, 'DEPTH COMPOSES CIRCUITS   an induction head (illustrative)', 'pink');
          var toks = ['a', '·glowing', '·ice', '·moon', '…', '·the', '·fox', '·sees', '·glowing', '·ice'];
          var xs = [], x = 140;
          S.tk = toks.map(function (t, i) {
            var w = Math.max(40, t.length * 9 + 18);
            var c = ctx.label(x + w / 2, 760, t, { color: i === 3 ? 'amber' : (i === 9 ? 'pink' : 'cyan'), size: 13, w: w, parent: g });
            xs.push(x + w / 2);
            x += w + 14;
            return c;
          });
          S.pred = ctx.label(x + 60, 760, '→ ·moon ?', { color: 'amber', size: 14, parent: g });
          ctx.text(100, 616, 'layer 2 · previous-token head: each position stores "who came before me"', { size: 12, font: 'mono', color: 'cyan', parent: g });
          ctx.text(100, 850, 'layer 5 · induction head at the last "·ice": find earlier "·ice", copy what followed it', { size: 12, font: 'mono', color: 'pink', parent: g });
          S.prevArcs = [];
          for (var i = 1; i < toks.length; i++) {
            if (i === 4 || i === 5) continue;
            var a = xs[i - 1], b = xs[i];
            S.prevArcs.push(ctx.path('M' + b + ',744 Q' + ((a + b) / 2) + ',690 ' + a + ',744', { stroke: ctx.alpha('cyan', 0.7), sw: 1.4, arrow: true, parent: g }));
          }
          S.ind = ctx.path('M' + xs[9] + ',778 Q' + ((xs[9] + xs[3]) / 2) + ',860 ' + xs[3] + ',778', { stroke: 'pink', sw: 2.4, arrow: true, parent: g });
          S.copy = ctx.path('M' + xs[3] + ',744 Q' + ((xs[3] + x + 30) / 2) + ',640 ' + (x + 20) + ',744', { stroke: 'amber', sw: 2, dash: '6 4', arrow: true, parent: g });
          ctx.text((xs[3] + x + 30) / 2, 666, 'OV copies "moon"', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
          var kc = ctx.group({ parent: g });
          ctx.rect(1040, 600, 480, 262, { rx: 10, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('pink', 0.3), parent: kc });
          ctx.para(1058, 630, ['K-COMPOSITION, step by step', '1  L2 head at "·moon" writes  prev = ice', '2  L5 query at last "·ice":  q = W_Q h_t', '3  L5 keys read that subspace: k_j = W_K h_j', '4  q·k_j is large  ⇔  token before j was ice', '5  OV circuit writes E[·moon] direction', '6  unembedding: logit(·moon) goes up'], { size: 12, font: 'mono', color: 'text', lh: 32, parent: kc });
          kc.firstChild.nextSibling.firstChild.setAttribute('fill', ctx.C.pink);
          keepWS(kc);
          [S.prevArcs, [S.ind, S.copy]].forEach(function (arr) { arr.forEach(function (p) { p.setAttribute('opacity', 0); }); });
          S.pred.setAttribute('opacity', 0);
          return ctx.wait(500).then(function () {
            S.prevArcs.forEach(function (p) { p.setAttribute('opacity', 1); });
            return ctx.reveal(S.prevArcs, { from: 'draw', stagger: 120, dur: 400 });
          }).then(function () {
            S.ind.setAttribute('opacity', 1);
            return ctx.reveal(S.ind, { from: 'draw', dur: 900 });
          }).then(function () {
            ctx.pulse(S.tk[3], { color: 'amber', dur: 600 });
            S.copy.setAttribute('opacity', 1);
            return ctx.reveal(S.copy, { from: 'draw', dur: 800 });
          }).then(function () {
            ctx.reveal(S.pred, { from: 'left' });
            return ctx.wait(400);
          }).then(function () {
            return Promise.all([ctx.pulse(S.mlp, { color: 'orange', dur: 600 }), ctx.pulse(S.attn, { color: 'amber', dur: 600 })]);
          });
        }
      }
    ]
  });
})();
