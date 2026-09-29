/* L2 — The Transformer Block. Pre-norm residual block: RMSNorm, GQA attention with RoPE, SwiGLU MLP (and its
 * MoE variant), parameter accounting, and how depth composes circuits (induction heads).
 * Every step is a sequence of beats (see docs/SCENE_API.md). */
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
      'Vaswani et al., <i>Attention Is All You Need</i>, NeurIPS 2017',
      'Xiong et al., <i>On Layer Normalization in the Transformer Architecture</i> (pre-LN), ICML 2020; Veit, Wilber &amp; Belongie, <i>Residual Networks Behave Like Ensembles of Relatively Shallow Networks</i>, NeurIPS 2016',
      'Zhang &amp; Sennrich, <i>Root Mean Square Layer Normalization</i>, NeurIPS 2019; Sun et al., <i>Massive Activations in Large Language Models</i>, COLM 2024',
      'Kaplan et al., <i>Scaling Laws for Neural Language Models</i>, 2020',
      'Shazeer, <i>GLU Variants Improve Transformer</i>, 2020; Geva et al., <i>Transformer Feed-Forward Layers Are Key-Value Memories</i>, EMNLP 2021',
      'Su et al., <i>RoFormer: Enhanced Transformer with Rotary Position Embedding</i>, 2021; Peng et al., <i>YaRN: Efficient Context Window Extension of Large Language Models</i>, ICLR 2024',
      'Ainslie et al., <i>GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints</i>, EMNLP 2023',
      'Shazeer, <i>Fast Transformer Decoding: One Write-Head is All You Need</i> (MQA), 2019',
      'Llama Team, Meta AI, <i>The Llama 3 Herd of Models</i>, 2024',
      'Fedus, Zoph &amp; Shazeer, <i>Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity</i>, JMLR 2022',
      'DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i>, 2024',
      'Elhage et al., <i>A Mathematical Framework for Transformer Circuits</i>, Transformer Circuits 2021',
      'Olsson et al., <i>In-context Learning and Induction Heads</i>, 2022'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Anatomy of a block',
        beats: [
          {
            say: 'This is one of the eighty blocks inside the language model, all identical in shape but each with its own weights. The horizontal line is the residual stream, carrying one vector of eight thousand one hundred ninety two numbers per token.',
            card: { tag: 'NUMBERS', title: 'One vector per token', stat: { v: '8,192', u: 'numbers', l: 'per token on the stream: the model width d of a 70B model' } },
            deep: '<p>The stream is a tensor <code>x ∈ ℝ<sup>T×8192</sup></code> in BF16: one row per position. Every block maps it to a tensor of the same shape, so blocks stack freely. This is the <b>pre-norm</b> decoder block used by essentially every modern LLM (Llama, Qwen, DeepSeek, Mistral, Gemma).</p>' +
              '<p>Per block (70B config): ≈ 151 M attention + 705 M MLP parameters, about 856 M in all.</p>'
          },
          {
            say: 'Two sublayers branch off it. Attention reads a normalised copy of the vector, mixes information across positions, and adds its result back to the stream. Watch the vector for the token ice pick up its first update.',
            card: { tag: 'HOW IT WORKS', title: 'Read, mix, add back', body: 'Norm, then attention across positions, then add. The stream itself is never replaced.' },
            deep: '<div class="eq">h = x + Attn(RMSNorm(x))</div>' +
              '<ul><li><b>Pre-norm</b> (norm inside the branch) keeps an unnormalised identity path from input to output: gradients reach early layers without passing through any normalisation, so very deep stacks train stably and Pre-LN models can drop the learning-rate warm-up that post-norm needs (Xiong et al. 2020). The price: the stream norm grows with depth, so a final RMSNorm precedes the unembedding.</li>' +
              '<li>Attention is the only op that moves information <i>between</i> positions; everything else is position-wise.</li></ul>'
          },
          {
            say: 'Then the MLP reads the updated stream, transforms each position on its own, and adds again. After both updates the vector has moved, yet everything it started with is still inside it.',
            card: { tag: 'HOW IT WORKS', title: 'Rewrite, per position', body: 'The MLP works on each position independently: it rewrites features, then adds the change back.' },
            deep: '<div class="eq">y = h + MLP(RMSNorm(h))</div>' +
              '<p>The MLP has no interaction between positions, so during prefill all T rows are processed as one big matrix multiply. Shapes: <code>[T, 8192] → [T, 28672] → [T, 8192]</code>.</p>' +
              '<p>Roughly 82% of the block’s parameters live here, and the sublayer is where key–value memories and feature detectors are stored (Geva et al. 2021).</p>'
          },
          {
            say: 'Every update is additive. Nothing is overwritten, so the identity path from the embedding to the last layer survives all eighty blocks, and a block that has nothing to add can simply output zero.',
            card: { tag: 'WHY IT MATTERS', title: 'The identity path', body: 'Updates are added, so a block can be near-identity. That keeps eighty layers trainable.' },
            deep: '<div class="eq">y = x + f(x) &nbsp;⇒&nbsp; ∂y/∂x = I + ∂f/∂x</div>' +
              '<p>The identity term lets gradients (and information) skip any block. With L residual sublayers the input-to-output map expands into 2<sup>L</sup> paths (here L = 160), which is why deep residual networks behave like ensembles of shallower ones (Veit et al. 2016).</p>' +
              '<p>The same property is why early exit, layer skipping and the logit lens work at all.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.diagram = ctx.group();
          var D = S.diagram;
          S.stream = ctx.path('M70,' + SY + ' H1530', { stroke: ctx.alpha('white', 0.85), sw: 3, arrow: true, parent: D });
          ctx.text(80, SY + 28, 'residual stream   x ∈ ℝ^(T × 8192)', { size: 13, font: 'mono', color: 'dim', parent: D });
          ctx.text(1520, SY + 28, 'to block ℓ+1', { size: 13, font: 'mono', color: 'dim', anchor: 'end', parent: D });
          ctx.label(1440, 196, 'block ℓ of 80', { color: 'amber', size: 12, parent: D });
          /* the attention branch (revealed in beat 1) */
          S.attnG = ctx.group({ parent: D, opacity: 0 });
          var AG = S.attnG;
          S.norm1 = ctx.node({ x: 265, y: 330, w: 130, h: 54, title: 'RMSNorm', color: 'white', titleSize: 15, parent: AG, glow: false });
          S.attn = ctx.node({ x: 470, y: 330, w: 200, h: 72, title: 'Attention', sub: 'GQA 64q/8kv · RoPE', color: 'amber', titleSize: 17, subSize: 11, parent: AG });
          S.pA = ctx.path('M170,' + SY + ' V330 H' + S.norm1.box.l, { stroke: ctx.alpha('white', 0.7), sw: 1.8, arrow: true, parent: AG });
          S.lA = ctx.link(S.norm1, S.attn, { color: 'white', parent: AG });
          S.pA2 = ctx.path('M' + S.attn.box.r + ',330 H640 V' + (SY - 15), { stroke: 'amber', sw: 1.8, arrow: true, parent: AG });
          S.add1 = addCircle(ctx, AG, 640, SY);
          ctx.text(470, 236, 'h = x + Attn(RMSNorm(x))', { size: 16, font: 'mono', weight: 700, color: 'amber', anchor: 'middle', parent: AG });
          ctx.text(470, 260, 'mixes information across positions', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: AG });
          /* the MLP branch (revealed in beat 2) */
          S.mlpG = ctx.group({ parent: D, opacity: 0 });
          var MG = S.mlpG;
          S.norm2 = ctx.node({ x: 830, y: 330, w: 130, h: 54, title: 'RMSNorm', color: 'white', titleSize: 15, parent: MG, glow: false });
          S.mlp = ctx.node({ x: 1050, y: 330, w: 220, h: 72, title: 'MLP', sub: 'SwiGLU 8192→28672→8192', color: 'orange', titleSize: 17, subSize: 11, parent: MG });
          S.pB = ctx.path('M725,' + SY + ' V330 H' + S.norm2.box.l, { stroke: ctx.alpha('white', 0.7), sw: 1.8, arrow: true, parent: MG });
          S.lB = ctx.link(S.norm2, S.mlp, { color: 'white', parent: MG });
          S.pB2 = ctx.path('M' + S.mlp.box.r + ',330 H1230 V' + (SY - 15), { stroke: 'orange', sw: 1.8, arrow: true, parent: MG });
          S.add2 = addCircle(ctx, MG, 1230, SY);
          ctx.text(1050, 236, 'y = h + MLP(RMSNorm(h))', { size: 16, font: 'mono', weight: 700, color: 'orange', anchor: 'middle', parent: MG });
          ctx.text(1050, 260, 'transforms each position independently', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: MG });

          /* explainer panel with the three sequential ops */
          var g = panel(ctx, S, 'ONE TOKEN THROUGH ONE BLOCK   (token "·ice", position t)', 'amber');
          var eqs = [['x', 'row t of the stream, 8,192 numbers', 'white'], ['h = x + Δattn', 'attention pulls context from earlier tokens', 'amber'], ['y = h + Δmlp', 'MLP rewrites features at this position', 'orange']];
          S.eqRows = eqs.map(function (e, i) {
            var rg = ctx.group({ parent: g, opacity: i ? 0 : 1 }), y = 632 + i * 60;
            ctx.text(100, y, e[0], { size: 18, font: 'mono', weight: 700, color: e[2], parent: rg });
            ctx.text(360, y, e[1], { size: 14, font: 'mono', color: 'text', parent: rg });
            return rg;
          });
          S.note = ctx.text(100, 830, 'no sublayer overwrites the stream: every update is additive, so the identity path survives all 80 blocks', { size: 13, font: 'mono', color: 'dim', parent: g, opacity: 0 });
          var r0 = ctx.rng(12);
          S.vals = [];
          for (var k = 0; k < 16; k++) S.vals.push(r0() * 2 - 1);
          S.bigVec = ctx.matrix(1040, 612, 3, 16, { cell: 22, gap: 4, cmap: 'diverge', parent: g, values: function (r, c) { return r === 0 ? S.vals[c] : 0; } });
          ctx.text(1030, 623, 'x', { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: g });
          var lblH = ctx.text(1030, 649, 'h', { size: 13, font: 'mono', color: 'amber', anchor: 'end', parent: g, opacity: 0 });
          var lblY = ctx.text(1030, 675, 'y', { size: 13, font: 'mono', color: 'orange', anchor: 'end', parent: g, opacity: 0 });
          ctx.text(1040, 712, 'first 16 of 8,192 dims', { size: 11, font: 'mono', color: 'dim', parent: g });
          var sumLbl = ctx.text(1040, 745, 'y = x + Δattn + Δmlp: all three still in the stream', { size: 13, font: 'mono', weight: 700, color: 'orange', parent: g, opacity: 0 });
          S.bigVec.cells[1].forEach(function (c) { c.setAttribute('opacity', 0); });
          S.bigVec.cells[2].forEach(function (c) { c.setAttribute('opacity', 0); });

          /* the flowing token vector */
          S.vec = ctx.group();
          var vm = ctx.matrix(-6, -36, 8, 1, { cell: 8, gap: 1, cmap: 'diverge', parent: S.vec, values: function (r) { return S.vals[r]; } });
          ctx.rect(-9, -39, 18, 78, { rx: 4, stroke: 'white', sw: 1.2, parent: S.vec, glow: true });
          ctx.text(0, -52, '·ice', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.vec });
          S.vecM = vm;
          ctx.place(S.vec, 100, SY);
          var r1 = ctx.rng(40);
          var dA = S.vals.map(function () { return (r1() * 2 - 1) * 0.6; });
          var dM = S.vals.map(function () { return (r1() * 2 - 1) * 0.6; });
          function applyRow(row, fn) {
            for (var c = 0; c < 16; c++) { S.bigVec.cells[row][c].setAttribute('fill', ctx.cmap('diverge', fn(c))); S.bigVec.cells[row][c].setAttribute('opacity', 1); }
          }
          /* beat 0: the stream and one token vector on it */
          ctx.reveal(D, { from: 'fade', dur: 700 });
          ctx.reveal(S.stream, { from: 'draw', dur: 900, delay: 200 });
          return ctx.reveal(S.vec, { delay: 500 }).then(function () {
            return ctx.transform(S.vec, { x: 170 }, 500, 'inOut');
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the attention branch */
            ctx.reveal(AG, { dur: 400 });
            ctx.reveal([S.pA, S.lA, S.pA2], { from: 'draw', stagger: 120, delay: 200 });
            return ctx.wait(500).then(function () {
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
              ctx.reveal([S.eqRows[1], lblH], { dur: 300 });
              applyRow(1, function (c) { return S.vals[c] + dA[c]; });
              vm.set(function (r) { return S.vals[r] + dA[r]; });
              return ctx.transform(S.vec, { x: 725 }, 350, 'inOut');
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the MLP branch */
            ctx.reveal(MG, { dur: 400 });
            ctx.reveal([S.pB, S.lB, S.pB2], { from: 'draw', stagger: 120, delay: 200 });
            return ctx.wait(500).then(function () {
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
              ctx.reveal([S.eqRows[2], lblY], { dur: 300 });
              applyRow(2, function (c) { return S.vals[c] + dA[c] + dM[c]; });
              vm.set(function (r) { return S.vals[r] + dA[r] + dM[r]; });
              return ctx.transform(S.vec, { x: 1330 }, 600, 'inOut');
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: everything is additive, the identity path survives */
            ctx.reveal([S.note, sumLbl], { from: 'up', dur: 500 });
            ctx.pulse(S.add1, { color: 'amber', dur: 500 });
            return ctx.pulse(S.stream, { color: 'white', times: 2, dur: 600 }).then(function () {
              return ctx.pulse(S.add2, { color: 'orange', dur: 500 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'RMSNorm',
        beats: [
          {
            say: 'Each branch starts with RMSNorm. It divides the vector by its root mean square, so the sublayer always sees inputs of the same scale, whatever magnitude the stream has grown to.',
            card: { tag: 'KEY IDEA', title: 'Normalise the scale', body: 'Divide by the root mean square. Every sublayer then sees inputs of comparable size, at any depth.' },
            deep: '<div class="eq">RMSNorm(x) = x / √(1/d · Σ<sub>i</sub> x<sub>i</sub>² + ε) ⊙ γ</div>' +
              '<p>The reduction runs over the d = 8,192 coordinates of one token, independently for every position. ε ≈ 10<sup>−5</sup> guards against division by zero. Sixteen of the 8,192 values are drawn here; the tallest bar is a deliberate outlier.</p>'
          },
          {
            say: 'Dividing by that one number rescales the whole vector to unit root mean square. The shape is unchanged, and only the overall magnitude is fixed.',
            card: { tag: 'NUMBERS', title: 'One number per token', more: '<p>RMSNorm is invariant to input scale: RMSNorm(αx) = RMSNorm(x) for α &gt; 0. That is what lets the stream norm grow with depth without destabilising each sublayer’s input distribution; only the gains γ set the absolute scale a sublayer sees.</p>', stat: { v: '1.78', l: 'rms of this toy vector: every bar is divided by it, so the new rms is exactly 1' } },
            deep: '<ul><li>RMSNorm drops re-centring and β: one reduction instead of two; empirically equal quality (Zhang &amp; Sennrich 2019). The reduction is done in FP32 even under BF16 training.</li>' +
              '<li>It is <b>memory-bound</b> (≈ 3 FLOPs per element, reads and writes the whole activation), so kernels fuse it with the residual add and the following matmul’s input quantisation.</li></ul>' +
              '<details><summary>Go deeper</summary><p>Let r = ‖x‖/√d, so that RMSNorm(x) = γ ⊙ x/r. Ignoring ε, its Jacobian is</p>' +
              '<div class="eq">∂y/∂x = diag(γ) · (1/r) · (I − x̂x̂ᵀ), &nbsp; x̂ = x/‖x‖</div>' +
              '<p>a projection that removes the radial direction: the output does not depend on ‖x‖, and gradients flowing back through the norm are orthogonal to x. That is the scale invariance of the card, seen from the backward pass.</p></details>'
          },
          {
            say: 'Then a learned gain per dimension rescales each coordinate, so the network can reshape the normalisation where useful. Unlike LayerNorm, there is no mean subtraction and no bias, which is cheaper and works just as well.',
            card: { tag: 'HOW IT WORKS', title: 'Gain, no bias', body: 'γ has one number per dimension, 8,192 in total. No centring and no β: one reduction instead of two.' },
            deep: '<div class="eq">LayerNorm(x) = (x − μ)/√(σ² + ε) ⊙ γ + β</div>' +
              '<p>Compared with LayerNorm, RMSNorm saves the mean, the subtraction and the bias. At 80 blocks × 2 norms × 8,192 gains, the whole model has about 1.3 M norm parameters, a rounding error next to 70 B.</p>' +
              '<ul><li>Variants: <b>QK-norm</b> (RMSNorm on q and k per head; OLMo 2, Qwen3, Gemma 3) bounds attention logits; <b>sandwich / post-norm</b> placements return in some recent models for stability.</li></ul>'
          },
          {
            say: 'Notice the outlier dimension. Large models develop a few huge activations. They dominate the root mean square, so normalising shrinks every other coordinate, and they are the main headache for low precision quantisation.',
            card: { tag: 'PITFALL', title: 'Massive activations', body: 'A few coordinates can be up to 10⁵× the median. They inflate the rms and make INT8 and FP8 activation quantisation hard.' },
            deep: '<ul><li><b>Massive activations</b> (Sun et al. 2024): a few activations, at fixed dimensions and specific tokens such as BOS or the first delimiter, are orders of magnitude larger than the median (the paper’s abstract cites, for example, 100,000×). They inflate rms(x), so every other coordinate is scaled down; they act as implicit biases that create attention sinks, and together with channel outliers they are the main headache for INT8/FP8 activation quantisation.</li>' +
              '<li>Mitigations: per-channel or rotated activation quantisation (SmoothQuant, QuaRot), keeping the outlier channels in higher precision, or attention-sink tokens with explicit biases.</li></ul>'
          }
        ],
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
          S.ghost = ctx.group({ parent: g, opacity: 0 });
          X.forEach(function (v, i) {
            var h = Math.min(Math.abs(v) * SC, 165);
            ctx.rect(104 + i * 44, v >= 0 ? BY - h : BY, bw, h, { rx: 3, stroke: ctx.alpha('white', 0.35), sw: 1, dash: '3 3', parent: S.ghost });
          });
          ctx.text(104 + 3 * 44 + 17, BY - 1.9 * SC - 12, 'raw x', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.ghost });
          S.nbars = X.map(function (v, i) {
            return ctx.rect(104 + i * 44, BY, bw, 0, { rx: 3, fill: ctx.alpha(i === 12 ? 'pink' : 'cyan', 0.55), stroke: i === 12 ? 'pink' : 'cyan', sw: 1, parent: g });
          });
          S.rmsLine = ctx.rect(100, BY - rms * SC - 1, 704, 2, { rx: 1, fill: ctx.alpha('amber', 0.9), parent: g });
          S.rmsLbl = ctx.text(800, BY - rms * SC - 11, 'rms = ' + rms.toFixed(2), { size: 12, font: 'mono', color: 'amber', anchor: 'end', parent: g });
          S.phase = ctx.text(100, 624, '', { size: 15, font: 'mono', weight: 700, color: 'white', parent: g });
          S.outTxt = ctx.text(104 + 12 * 44 + 17, 850, 'outlier dim', { size: 11, font: 'mono', color: 'pink', anchor: 'middle', parent: g, opacity: 0 });
          var outShare = Math.round(100 * X[12] * X[12] / X.reduce(function (a, v) { return a + v * v; }, 0));
          S.outLbl = ctx.label(880, 640, 'holds ' + outShare + '% of Σx²', { size: 12, color: 'pink', anchor: 'end', parent: g, opacity: 0 });
          S.outBox = ctx.rect(104 + 12 * 44 - 5, 596, bw + 10, 174, { rx: 6, stroke: 'pink', sw: 1.6, dash: '5 4', parent: g, opacity: 0 });
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
          var fA = ctx.para(920, 630, ['rms(x) = √( (1/d) Σ x_i² + ε )', 'y_i   = x_i / rms(x) · γ_i'], { size: 14, font: 'code', color: 'text', lh: 30, parent: c });
          keepWS(fA);
          var fB = ctx.para(920, 720, ['no mean subtraction, no bias β', 'd = 8,192 gains γ per norm (tiny)', 'fp32 reduction, fused with the', 'residual add in real kernels'], { size: 14, font: 'code', color: 'text', lh: 30, parent: c, opacity: 0 });
          keepWS(fB);
          var zeros = X.map(function () { return 0; });
          var Xn = X.map(function (v) { return v / rms; });
          var Xg = Xn.map(function (v, i) { return v * G[i]; });
          setBars(zeros);
          S.phase.textContent = 'x  (raw stream values)';
          /* beat 0: raw values and their root mean square */
          return ctx.wait(500).then(function () {
            return morph(zeros, X, 800);
          }).then(function () { return ctx.pulse(S.rmsLine, { color: 'amber', dur: 700 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: divide by rms */
            S.phase.textContent = 'x / rms(x)   (unit RMS)';
            ctx.reveal(S.ghost, { dur: 400 });
            ctx.animate(S.rmsLine, { y: [BY - rms * SC - 1, BY - SC - 1] }, 800);
            S.rmsLbl.textContent = 'rms = 1.00';
            S.rmsLbl.setAttribute('y', BY - SC - 11);
            return morph(X, Xn, 900);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: learned gain per dimension */
            S.phase.textContent = 'x / rms(x) · γ   (learned gain per dim)';
            ctx.reveal(fB, { from: 'up', dur: 500 });
            /* after the gain the rms is no longer exactly 1: it moves to rms(γ ⊙ x̂) */
            var rmsG = Math.sqrt(Xg.reduce(function (a, v) { return a + v * v; }, 0) / Xg.length);
            ctx.animate(S.rmsLine, { y: [BY - SC - 1, BY - rmsG * SC - 1] }, 900);
            S.rmsLbl.textContent = 'rms = ' + rmsG.toFixed(2);
            S.rmsLbl.setAttribute('y', BY - rmsG * SC - 11);
            return morph(Xn, Xg, 900);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the outlier dimension */
            ctx.reveal([S.outTxt, S.outLbl, S.outBox], { from: 'up', dur: 400 });
            return ctx.pulse(S.nbars[12], { color: 'pink', times: 3, dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Attention sublayer',
        beats: [
          {
            say: 'Inside the attention sublayer, the normalised vector is projected three times: into queries, keys and values. The queries ask what to look for, the keys say what each position offers, and the values carry the content.',
            card: { tag: 'HOW IT WORKS', title: 'Three projections', body: 'Q, K and V are three learned linear maps of the same normalised vector: W_Q is 8192×8192, W_K and W_V are 8192×1024.' },
            deep: '<div class="eq">Q = xW<sub>Q</sub> ∈ ℝ<sup>T×64×128</sup>, &nbsp; K = xW<sub>K</sub>, V = xW<sub>V</sub> ∈ ℝ<sup>T×8×128</sup></div>' +
              '<p>One fused GEMM computes all three: <code>[T, 8192] · [8192, 10240]</code>, since 8192 (Q) + 1024 (K) + 1024 (V) = 10,240 output columns. RoPE is then applied to Q and K only (next step).</p>'
          },
          {
            say: 'The seventy billion model has sixty four query heads, each with its own query, but only eight key value heads. This layout is called grouped query attention.',
            card: { tag: 'NUMBERS', title: 'Heads, queries and keys', stat: { v: '64 / 8', l: 'query heads over key-value heads in Llama 3 70B, 128 dimensions each' } },
            deep: '<div class="eq">head<sub>j</sub> = softmax(q<sub>j</sub>K<sub>g(j)</sub>ᵀ/√128 + M) V<sub>g(j)</sub>, &nbsp; g(j) = ⌊j/8⌋</div>' +
              '<p>Every query head j keeps its own q<sub>j</sub> ∈ ℝ<sup>T×128</sup>, but reads the keys and values of group g(j). MHA is the special case with 64 KV heads; multi-query attention (MQA, Shazeer 2019) is the other extreme with one.</p>' +
              '<details><summary>Go deeper</summary><p>If the entries of q and k are independent with zero mean and unit variance, q·k has variance d<sub>h</sub>, so unscaled scores have a spread of √128 ≈ 11.3. The softmax then saturates to a near one-hot and its Jacobian vanishes. Dividing by √d<sub>h</sub> restores unit-variance scores; newer models add QK-norm, which bounds the scores directly.</p></details>'
          },
          {
            say: 'Each group of eight query heads shares one key and one value head, which shrinks the key value cache eight fold with almost no quality loss.',
            card: { tag: 'NUMBERS', title: 'A smaller cache', more: '<p>KV cache per token = 2 (K and V) × 80 layers × n<sub>kv</sub> heads × 128 dims × 2 bytes. With n<sub>kv</sub> = 64 (MHA) that is 2.5 MiB; with n<sub>kv</sub> = 8 it is 327,680 B = 320 KiB. For a 12,000-token context: 3.7 GiB versus 29.3 GiB.</p>', stat: { v: '8×', l: 'less KV cache: 320 KiB per token instead of 2.5 MiB with MHA' } },
            deep: '<table><tr><th></th><th>MHA</th><th>GQA-8</th><th>MQA</th></tr>' +
              '<tr><td>KV heads</td><td>64</td><td>8</td><td>1</td></tr>' +
              '<tr><td>KV cache / token (80 L, BF16)</td><td>2.5 MiB</td><td>320 KiB</td><td>40 KiB</td></tr>' +
              '<tr><td>attn params / block</td><td>268 M</td><td>151 M</td><td>136 M</td></tr></table>' +
              '<p>GQA-8 recovers almost all of MHA’s quality (Ainslie et al. 2023) while cutting decode bandwidth, the dominant serving cost. An existing MHA checkpoint can be converted by mean-pooling each group’s K and V heads and uptraining for about 5% of the original compute; most new models simply train with GQA from scratch.</p>'
          },
          {
            say: 'Head outputs are concatenated and projected back to the stream width by the output matrix. That result is the update that gets added to the residual stream.',
            card: { tag: 'HOW IT WORKS', title: 'Concat, then mix', body: 'Sixty four head outputs of 128 numbers make 8,192; W_O mixes them into the update added to the stream.' },
            deep: '<div class="eq">Attn(x) = [head<sub>0</sub>; …; head<sub>63</sub>] W<sub>O</sub></div>' +
              '<p>DeepSeek-V2/V3 go further with <b>MLA</b>: K and V are reconstructed from a 512-dim compressed latent (+64-dim decoupled RoPE key), caching ≈ 70 KB per token for a 61-layer model. The mechanism itself is covered in the Attention chamber.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          mark(ctx, S, S.attn, 'amber');
          var g = panel(ctx, S, 'GROUPED-QUERY ATTENTION   64 query heads share 8 KV heads', 'amber');
          /* projections */
          ctx.text(90, 630, 'x', { size: 16, font: 'mono', weight: 700, color: 'white', parent: g });
          ctx.text(90, 652, '[T, 8192]', { size: 11, font: 'mono', color: 'dim', parent: g });
          var projs = [['W_Q', '8192×8192', 'amber', 640], ['W_K', '8192×1024', 'cyan', 730], ['W_V', '8192×1024', 'teal', 820]];
          var projG = ctx.group({ parent: g, opacity: 0 });
          projs.forEach(function (p) {
            ctx.line(170, 640, 214, p[3] - 2, { color: ctx.alpha(p[2], 0.6), parent: projG });
            ctx.label(260, p[3], p[0], { color: p[2], size: 12, w: 80, parent: projG });
            ctx.text(310, p[3], p[1], { size: 11, font: 'mono', color: 'dim', parent: projG });
          });
          /* 64 q heads in 8 groups, 8 kv heads */
          S.qCells = [];
          S.kvCells = [];
          var GX = 470;
          var qG = ctx.group({ parent: g, opacity: 0 }), kvG = ctx.group({ parent: g, opacity: 0 });
          for (var gI = 0; gI < 8; gI++) {
            var gx = GX + gI * 84;
            for (var h = 0; h < 8; h++) {
              var q = ctx.rect(gx + (h % 4) * 17, 634 + Math.floor(h / 4) * 17, 14, 14, { rx: 2, fill: ctx.alpha('amber', 0.3), stroke: 'amber', sw: 0.8, parent: qG });
              S.qCells.push(q);
            }
            var kv = ctx.rect(gx + 18, 760, 30, 24, { rx: 4, fill: ctx.alpha('cyan', 0.3), stroke: 'cyan', sw: 1.2, parent: kvG });
            ctx.path('M' + (gx + 33) + ',758 L' + (gx + 33) + ',672', { stroke: ctx.alpha('cyan', 0.5), sw: 1.2, dash: '3 3', parent: kvG });
            ctx.text(gx + 33, 800, 'kv' + gI, { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: kvG });
            S.kvCells.push(kv);
          }
          ctx.text(GX, 618, 'query heads q0 … q63 (d_h = 128), 8 groups', { size: 12, font: 'mono', color: 'amber', parent: qG });
          ctx.text(GX, 826, 'shared K/V heads: cache stores only these', { size: 12, font: 'mono', color: 'cyan', parent: kvG });
          /* output card */
          var c = ctx.group({ parent: g });
          ctx.rect(1170, 596, 350, 264, { rx: 10, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('amber', 0.3), parent: c });
          var cvA = ctx.para(1190, 628, ['concat 64 × 128 = 8192', '· W_O (8192×8192)', '→ Δattn added to stream'], { size: 13, font: 'code', color: 'text', lh: 28, parent: c, opacity: 0 });
          keepWS(cvA);
          var cvB = ctx.para(1190, 740, ['KV cache per token:', ' MHA   2.5 MiB', ' GQA-8 320 KiB  (8× less)', ' MQA   40 KiB'], { size: 13, font: 'code', color: 'text', lh: 28, parent: c, opacity: 0 });
          keepWS(cvB);
          /* beat 0: x is projected three ways */
          return ctx.wait(600).then(function () {
            return ctx.reveal(projG, { from: 'left', dur: 600 });
          }).then(function () { return ctx.pulse(projG, { color: 'amber', dur: 700 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: 64 query heads, 8 key-value heads */
            ctx.reveal(qG, { from: 'up', dur: 600 });
            return ctx.wait(500).then(function () { return ctx.reveal(kvG, { from: 'up', dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: eight query heads share each key-value head */
            ctx.reveal(cvB, { from: 'left', dur: 500 });
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
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: concatenate the heads and project back */
            ctx.reveal(cvA, { from: 'left', dur: 500 });
            return ctx.tween(900, function (t) {
              S.qCells.forEach(function (q, i) { q.setAttribute('fill', ctx.alpha('amber', 0.25 + 0.6 * Math.abs(Math.sin(t * 3 + i * 0.37)))); });
            }, 'linear').then(function () { return ctx.pulse(c, { color: 'amber', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'RoPE',
        beats: [
          {
            say: 'Attention by itself is blind to order. Rotary position embedding fixes that by rotating each pair of query and key dimensions by an angle proportional to the token position.',
            card: { tag: 'KEY IDEA', title: 'Position as rotation', body: 'Instead of adding a position vector, RoPE rotates each (q, k) pair by m·θ. Order enters through geometry.' },
            deep: '<div class="eq">θ<sub>i</sub> = b<sup>−2i/d<sub>h</sub></sup>, &nbsp; R<sub>m</sub> = ⊕<sub>i</sub> [[cos mθ<sub>i</sub>, −sin mθ<sub>i</sub>],[sin mθ<sub>i</sub>, cos mθ<sub>i</sub>]]</div>' +
              '<p>Llama 3: d<sub>h</sub> = 128 (64 pairs), base b = 500,000. Each pair (q<sub>2i</sub>, q<sub>2i+1</sub>) is treated as a complex number and multiplied by e<sup>imθ<sub>i</sub></sup>. Applied to q and k only, after projection; V is not rotated. Three of the 64 pairs are drawn.</p>'
          },
          {
            say: 'Every pair has its own speed. Fast pairs spin a full turn every few tokens; slow pairs barely move across thousands of tokens, so together they act like the hands of a clock.',
            card: { tag: 'NUMBERS', title: 'Fast and slow hands', stat: { v: '2.6 M', u: 'tokens', l: 'wavelength of the slowest rotary pair, versus 6.3 tokens for the fastest' } },
            deep: '<p>Pair 0 turns 1 rad per token (λ = 6.3 tokens); pair 63 has λ ≈ 2.6 M tokens. Geometric spacing of wavelengths gives a multi-scale code: high-frequency pairs resolve neighbouring tokens, low-frequency pairs distinguish far-apart regions.</p>' +
              '<p>A larger base b (10,000 in the original RoFormer, 500,000 in Llama 3) stretches the slow end, which is the first step toward long context.</p>'
          },
          {
            say: 'Because both query and key are rotated, their dot product depends only on the distance between them, not on absolute position. Watch both vectors advance together: in every plane the angle between them stays fixed.',
            card: { tag: 'KEY IDEA', title: 'Relative position, free', more: '<p>Write q and k as complex numbers per pair. Rotating by mθ is multiplication by e<sup>imθ</sup>, so Re[(q e<sup>imθ</sup>)·conj(k e<sup>inθ</sup>)] = Re[q·conj(k)·e<sup>i(m−n)θ</sup>]: the dot product depends on m − n only.</p>', body: 'q at position m and k at position n keep the same angle whenever m − n is fixed, so scores depend on distance only.' },
            deep: '<div class="eq">⟨R<sub>m</sub>q, R<sub>n</sub>k⟩ = ⟨q, R<sub>n−m</sub>k⟩</div>' +
              '<p>Rotations are orthogonal, so R<sub>m</sub>ᵀR<sub>n</sub> = R<sub>n−m</sub>: the absolute positions cancel and only the offset survives. There are no position parameters to learn, and the scheme extrapolates naturally to any offset the frequencies can represent. The catch is that offsets beyond the training length produce angles the model has never seen, which is what the last beat repairs.</p>'
          },
          {
            say: 'Now try it yourself. Click an offset chip and watch the three planes. The fast pair reacts to a shift of a few tokens, while the slow pair barely moves until offsets reach the tens of thousands.',
            card: { tag: 'TRY IT', title: 'Click an offset', body: 'Δ = m − n turns q relative to k by Δ·θ in each plane. Fast planes wrap around for small Δ; slow planes barely move.' },
            deep: '<p>The angle between q and k in plane i is the base angle plus Δ·θ<sub>i</sub>. For Δ = 50: plane 0 turns 50 rad (about 8 full turns), plane 16 turns 1.9 rad (108°), plane 48 turns 0.003 rad. At Δ = 500 the middle plane has gone round 3 times and plane 48 has moved just 1.5°.</p>' +
              '<p>So a head can read <i>near</i> offsets from the fast planes and <i>far</i> offsets from the slow ones. Plane 48 needs Δ ≈ 19,000 tokens to turn by one radian and the slowest pair about 400,000, so those planes are almost constant over any context, which makes them usable as channels for position-independent, semantic matching.</p>'
          },
          {
            say: 'To reach long context, Llama three point one rescales the slow frequencies by a factor of eight and leaves the fast ones alone. Continued training on long sequences then stretches the window from eight thousand to one hundred twenty eight thousand tokens.',
            card: { tag: 'STATE OF THE ART', title: 'Stretching the clock', body: 'Scale slow pairs by 8×, keep fast ones, ramp in between. About 800B tokens of long-sequence training then cover 128k.' },
            deep: '<p><b>Context extension</b>: pairs whose wavelength exceeds the training length never completed a rotation, so unseen angles appear at longer contexts. Fixes rescale frequencies:</p>' +
              '<ul><li><b>Position interpolation</b>: θ<sub>i</sub>/s for all i (blurs local order).</li>' +
              '<li><b>NTK-aware</b> scaling raises the base b, stretching low frequencies most and high ones least; <b>YaRN</b> ("NTK-by-parts") leaves high-frequency pairs untouched, fully interpolates low-frequency ones with a ramp between, and adds an attention temperature; it needs only a few hundred fine-tuning steps (400 for a 16× extension in the paper).</li>' +
              '<li><b>Llama 3.1</b>: factor 8 on pairs with λ &gt; 8,192, untouched below λ = 2,048, smooth ramp between, followed by continued pretraining on long sequences (≈ 800 B tokens, context raised in six stages from 8k to 128k).</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          mark(ctx, S, S.attn, 'amber');
          var g = panel(ctx, S, 'ROTARY POSITION EMBEDDING   rotate (q, k) pairs by m·θ_i', 'cyan');
          var base = 500000, dh = 128;
          var planeG = ctx.group({ parent: g, opacity: 0 });
          var planes = [0, 16, 48].map(function (i, j) {
            var cx = 170 + j * 205, cy = 730, R = 72;
            var pg = ctx.group({ parent: planeG });
            ctx.circle(cx, cy, R, { stroke: ctx.alpha('white', 0.18), parent: pg });
            ctx.line(cx - R - 6, cy, cx + R + 6, cy, { color: ctx.alpha('white', 0.08), parent: pg });
            ctx.line(cx, cy - R - 6, cx, cy + R + 6, { color: ctx.alpha('white', 0.08), parent: pg });
            var th = Math.pow(base, -2 * i / dh);
            ctx.text(cx, 624, 'pair i = ' + i, { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: pg });
            ctx.text(cx, 642, 'θ = ' + (th >= 0.01 ? th.toFixed(4) : th.toExponential(1)) + ' rad/tok', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pg });
            var q = ctx.line(cx, cy, cx + R, cy, { color: 'amber', sw: 2.6, arrow: true, parent: pg });
            var k = ctx.line(cx, cy, cx + R, cy, { color: 'cyan', sw: 2.6, arrow: true, parent: pg });
            var arc = ctx.path('', { stroke: 'white', sw: 1.2, parent: pg });
            var angT = ctx.text(cx, 822, '', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: pg });
            return { cx: cx, cy: cy, R: R, th: th, q: q, k: k, arc: arc, angT: angT, q0: 0.35, k0: 1.25 };
          });
          ctx.text(90, 850, 'amber = q at position m  ·  cyan = k at position n', { size: 12, font: 'mono', color: 'dim', parent: planeG });
          S.posTxt = ctx.text(450, 850, '', { size: 13, font: 'mono', weight: 700, color: 'white', parent: g, opacity: 0 });
          function setPos(m, n, offMode) {
            planes.forEach(function (p) {
              var aq = p.q0 + m * p.th, ak = p.k0 + n * p.th;
              p.q.setAttribute('x2', p.cx + p.R * Math.cos(aq)); p.q.setAttribute('y2', p.cy - p.R * Math.sin(aq));
              p.k.setAttribute('x2', p.cx + p.R * Math.cos(ak)); p.k.setAttribute('y2', p.cy - p.R * Math.sin(ak));
              var r = 26;
              var sx = p.cx + r * Math.cos(aq), sy = p.cy - r * Math.sin(aq), ex = p.cx + r * Math.cos(ak), ey = p.cy - r * Math.sin(ak);
              var dd = ((ak - aq) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
              p.arc.setAttribute('d', 'M' + sx.toFixed(1) + ',' + sy.toFixed(1) + ' A' + r + ',' + r + ' 0 ' + (dd > Math.PI ? 1 : 0) + ' 0 ' + ex.toFixed(1) + ',' + ey.toFixed(1));
              p.angT.textContent = 'q to k: ' + Math.round(dd * 180 / Math.PI) + '°';
            });
            S.posTxt.textContent = offMode ? 'm = ' + Math.round(m) + '   n = ' + Math.round(n) + '   Δ = m − n = ' + Math.round(m - n)
              : 'm = ' + Math.round(m) + '   n = ' + Math.round(n) + '   m − n = ' + Math.round(m - n) + '   fixed angle';
          }
          setPos(5, 0);
          /* offset chips (beat 3): a fixed q position, k moved back by Δ */
          var offG = ctx.group({ parent: g, opacity: 0 });
          ctx.text(712, 668, 'Δ = m − n', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: offG });
          var OFFS = [0, 5, 50, 500];
          S.offChips = OFFS.map(function (d, i) {
            var c = ctx.label(712, 700 + i * 34, 'Δ = ' + d, { color: 'cyan', size: 11, w: 84, parent: offG });
            c.style.cursor = 'pointer';
            c.addEventListener('click', function (ev) { ev.stopPropagation(); S.setOffset(d, 700); });
            return c;
          });
          S.curD = 5;
          S.setOffset = function (d, ms) {
            if (!S.offReady) return Promise.resolve();
            S.offChips.forEach(function (c, i) { c.firstChild.setAttribute('fill', ctx.alpha('cyan', OFFS[i] === d ? 0.45 : 0.14)); });
            var from = S.curD;
            S.curD = d;
            return ctx.tween(ms, function (t) { var dv = from + (d - from) * t; setPos(500, 500 - dv, true); }, 'inOut');
          };

          /* wavelength plot (beat 1) with the Llama 3.1 rescaling (beat 3) */
          var WX = 800, WY = 612, WW = 680, WH = 200;
          var wg = ctx.group({ parent: g, opacity: 0 });
          ctx.text(WX, 602, 'wavelength λ_i = 2π/θ_i (tokens, log)', { size: 12, font: 'mono', color: 'cyan', parent: wg });
          ctx.line(WX, WY + WH, WX + WW, WY + WH, { color: 'faint', parent: wg });
          ctx.line(WX, WY, WX, WY + WH, { color: 'faint', parent: wg });
          function py(lam) { return WY + WH - (Math.log10(lam) / 7.6) * WH; }
          function px(i) { return WX + i / 63 * WW; }
          [10, 1000, 100000].forEach(function (v) { ctx.text(WX - 6, py(v), v >= 1000 ? (v / 1000) + 'k' : String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: wg }); });
          ctx.text(WX + WW, WY + WH + 16, 'pair index i → 63', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: wg });
          ctx.label(WX + 92, 852, 'cyan: Llama 3 base 500k', { size: 11, color: 'cyan', parent: wg });
          var d1 = '', d2 = '';
          for (var i = 0; i < 64; i++) {
            var lam = 2 * Math.PI * Math.pow(base, 2 * i / dh);
            var lam2 = lam;
            if (lam > 8192) lam2 = lam * 8;
            else if (lam > 2048) { var sm = (8192 / lam - 1) / (4 - 1); lam2 = lam / ((1 - sm) / 8 + sm); }
            d1 += (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(lam).toFixed(1) + ' ';
            d2 += (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(lam2).toFixed(1) + ' ';
          }
          S.w1 = ctx.path(d1, { stroke: 'cyan', sw: 2.2, parent: wg });
          var wg2 = ctx.group({ parent: g, opacity: 0 });
          S.w2 = ctx.path(d2, { stroke: 'pink', sw: 2, dash: '5 4', parent: wg2 });
          [[8192, '8k train ctx', 'amber'], [131072, '128k target', 'lime']].forEach(function (h) {
            ctx.line(WX, py(h[0]), WX + WW, py(h[0]), { color: ctx.alpha(h[2], 0.5), dash: '3 5', parent: wg2 });
            ctx.text(WX + 8, py(h[0]) - 9, h[1], { size: 11, font: 'mono', color: h[2], parent: wg2 });
          });
          ctx.label(WX + WW - 135, 852, 'pink: Llama 3.1 rescale (×8 for λ > 8k)', { size: 11, color: 'pink', parent: wg2 });
          /* beat 0: pairs of query and key vectors, one rotation plane per pair */
          return ctx.wait(500).then(function () {
            return ctx.reveal(planeG, { from: 'up', dur: 600 });
          }).then(function () { return ctx.pulse(planes[0].q, { color: 'amber', dur: 600 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: every pair has its own wavelength */
            ctx.reveal(wg, { dur: 400 });
            return ctx.reveal(S.w1, { from: 'draw', dur: 1200, delay: 300 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: q and k advance together, the angle between them stays fixed */
            ctx.reveal(S.posTxt, { dur: 300 });
            ctx.camera(380, 740, 1.6, 900);
            return ctx.wait(500).then(function () {
              return ctx.tween(4200, function (t) { var m = 5 + t * 55; setPos(m, m - 5); }, 'inOut');
            }).then(function () { return ctx.camera(null, null, null, 800); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: try offsets: q stays put, k moves back by Δ; fast planes react first */
            ctx.reveal(offG, { from: 'left', dur: 400 });
            S.offReady = true;
            return ctx.tween(700, function (t) { setPos(60 + 440 * t, 55 + 440 * t, true); }, 'inOut').then(function () {
              return S.setOffset(50, 1400);
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: Llama 3.1 rescales the slow pairs */
            ctx.reveal(wg2, { dur: 300 });
            return ctx.reveal(S.w2, { from: 'draw', dur: 1200, delay: 200 });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 5 */
      {
        title: 'SwiGLU MLP',
        beats: [
          {
            say: 'Now the MLP, which holds about four fifths of the block parameters. Its hidden layer has twenty eight thousand six hundred seventy two neurons, three and a half times the stream width.',
            card: { tag: 'NUMBERS', title: 'Where the parameters are', more: '<p>Parameter parity with a classic MLP: two matrices of size d × 4d = 8d². Three matrices of size d × d<sub>ff</sub> = 3·d·d<sub>ff</sub>; equating gives d<sub>ff</sub> = 8/3·d ≈ 2.67 d. Llama 3 70B uses 3.5 d (28,672), wider than that parity point.</p>', stat: { v: '705 M', l: 'parameters per MLP: 3·d·d_ff, about 82% of the block, with d_ff = 28,672 = 3.5 d' } },
            deep: '<div class="eq">MLP(x) = (SiLU(xW<sub>1</sub>) ⊙ xW<sub>3</sub>) W<sub>2</sub>, &nbsp; SiLU(z) = z·σ(z)</div>' +
              '<p>W<sub>1</sub>, W<sub>3</sub> ∈ ℝ<sup>d×d<sub>ff</sub></sup>, W<sub>2</sub> ∈ ℝ<sup>d<sub>ff</sub>×d</sup>: <b>3·d·d<sub>ff</sub></b> parameters. With d<sub>ff</sub> = 8/3·d the count matches a classic 4d GELU MLP (2 matrices × 4d²); Llama 3 70B uses d<sub>ff</sub> = 28,672 = 3.5 d → 705 M params, ≈ 1.4 GFLOP per token.</p>'
          },
          {
            say: 'The vector is projected up to that width twice: a gate projection and an up projection. Both are dot products of the input with thousands of learned weight rows.',
            card: { tag: 'HOW IT WORKS', title: 'Two parallel projections', body: 'Gate g = xW₁ and up u = xW₃, each 28,672 numbers wide. They come from the same input, with different weights.' },
            deep: '<p>Both projections read the same normalised input, so implementations fuse W<sub>1</sub> and W<sub>3</sub> into a single <code>[8192, 57344]</code> matrix and split the output: one GEMM, one pass over the activations.</p>' +
              '<p>Shapes per token: <code>g, u ∈ ℝ<sup>28672</sup></code>. For a batch of T tokens the two products are [T×8192]·[8192×28672] matrix multiplies, the dominant compute of prefill.</p>'
          },
          {
            say: 'The gate passes through SiLU, a smooth switch that is nearly zero for negative inputs and nearly the identity for positive ones. A small dip below zero lets a little negative signal leak through.',
            card: { tag: 'HOW IT WORKS', title: 'SiLU, the soft switch', body: 'SiLU(z) = z·σ(z): about 0 for large negative z, about z for large positive z, smooth in between.' },
            deep: '<ul><li>GLU variants beat ReLU/GELU MLPs at equal compute (Shazeer 2020) and are now universal.</li>' +
              '<li>SiLU/Swish is smooth and non-monotonic, with a minimum of ≈ −0.28 at z ≈ −1.28.</li>' +
              '<li>Gating multiplies a linear branch by a learned, input-dependent switch, a multiplicative interaction that a plain activation cannot express.</li></ul>'
          },
          {
            say: 'Its output multiplies the up projection element by element, so each hidden neuron acts like a soft switch on a feature. Then a down projection returns to the stream width, and that result is the update.',
            card: { tag: 'KEY IDEA', title: 'Neurons as soft switches', body: 'Each hidden neuron = gate × up. Where the gate is off, nothing is written; where it is on, the up value passes.' },
            deep: '<ul><li><b>Key–value memory view</b> (Geva et al.): rows of W<sub>1</sub>/W<sub>3</sub> detect input patterns (keys), columns of W<sub>2</sub> write output directions (values), e.g. a neuron that fires on "cold surface" contexts and writes toward "ice", "frozen".</li>' +
              '<li>Activation sparsity: SwiGLU outputs are not exactly zero, but most |activations| are small, which activation-sparsity inference methods exploit.</li></ul>'
          },
          {
            say: 'Click the highlighted neuron to zoom into a single neuron and see how one of those twenty eight thousand units is actually computed.',
            card: { tag: 'TRY IT', title: 'Open a single neuron', body: 'Click the glowing neuron, or the white dot under the MLP node, to open the Single Neuron chamber.' },
            deep: '<p>The zoom target is neuron #16 of this toy layer: one row of W<sub>1</sub> and W<sub>3</sub> and one column of W<sub>2</sub>. In the real model there are 28,672 of them per layer × 80 layers = 2.3 M neurons in the MLPs.</p>' +
              '<p>The Neuron chamber shows the weighted sum, the activation function, gradient descent and how a layer of them becomes one matrix multiply on a tensor core.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          mark(ctx, S, S.mlp, 'orange');
          /* persistent mini-neurons under the MLP node (zoom target) */
          S.nDots = ctx.group({ parent: S.diagram, opacity: 0 });
          for (var q = 0; q < 7; q++) {
            if (q === 3) continue;
            ctx.circle(990 + q * 20, 394, 5, { fill: ctx.alpha('orange', 0.5), stroke: 'orange', sw: 1, parent: S.nDots });
          }
          ctx.text(990 - 12, 394, '28,672 neurons', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.nDots });
          S.nDot = ctx.group({ parent: S.diagram, opacity: 0 });
          ctx.circle(1050, 394, 6, { fill: 'white', parent: S.nDot, glow: true });
          S.nDot.box = boxOf(1042, 386, 16, 16);
          ctx.hotspot(S.nDot, 'neuron', { hint: 'NEURON ⤢' });
          var g = panel(ctx, S, 'SwiGLU MLP   (SiLU(x W1) ⊙ x W3) W2', 'orange');
          var r = ctx.rng(17);
          var xs = [];
          for (var i = 0; i < 12; i++) xs.push(r() * 2 - 1);
          var gx = ctx.group({ parent: g });
          ctx.text(110, 604, 'x', { size: 14, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: gx });
          ctx.matrix(102, 614, 12, 1, { cell: 16, gap: 3, cmap: 'diverge', values: function (rr) { return xs[rr]; }, parent: gx });
          ctx.text(110, 856, '8192', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: gx });
          var N = 24, HX = 250;
          var gate = [], up = [];
          for (var k = 0; k < N; k++) { gate.push(r() * 5 - 2.8); up.push(r() * 2 - 1); }
          gate[16] = 2.6; up[16] = 0.9;
          var act = gate.map(function (z, k) { return silu(z) * up[k]; });
          /* gate and up projections (beat 1) */
          var gGU = ctx.group({ parent: g, opacity: 0 });
          S.gateM = ctx.matrix(HX, 624, 1, N, { cell: 17, gap: 3, cmap: 'diverge', values: function () { return 0; }, parent: gGU });
          S.upM = ctx.matrix(HX, 700, 1, N, { cell: 17, gap: 3, cmap: 'diverge', values: function () { return 0; }, parent: gGU });
          ctx.text(HX, 612, 'g = x W1   (gate, 28,672 of them)', { size: 12, font: 'mono', color: 'orange', parent: gGU });
          ctx.text(HX, 688, 'u = x W3   (up)', { size: 12, font: 'mono', color: 'orange', parent: gGU });
          ctx.line(126, 640, HX - 6, 632, { color: ctx.alpha('orange', 0.5), arrow: true, parent: gGU });
          ctx.line(126, 700, HX - 6, 708, { color: ctx.alpha('orange', 0.5), arrow: true, parent: gGU });
          /* SiLU on the gate (beat 2) */
          var gS = ctx.group({ parent: g, opacity: 0 });
          ctx.text(HX + N * 20 + 6, 634, 'SiLU', { size: 12, font: 'mono', color: 'pink', parent: gS });
          var pl = ctx.plot(930, 620, 250, 150, silu, { xDomain: [-5, 4], yDomain: [-0.5, 4], color: 'pink', sw: 2.2, parent: gS, xLabel: 'z', yLabel: 'SiLU(z) = z·σ(z)' });
          var z0 = pl.toPx(0, 0);
          ctx.line(930, z0.y, 1180, z0.y, { color: ctx.alpha('white', 0.12), parent: gS });
          S.dot = ctx.circle(pl.toPx(-5, silu(-5)).x, pl.toPx(-5, silu(-5)).y, 5, { fill: 'white', parent: gS, glow: true });
          /* hidden neurons, down projection and update (beat 3) */
          var gA = ctx.group({ parent: g, opacity: 0 });
          S.actM = ctx.matrix(HX, 790, 1, N, { cell: 17, gap: 3, cmap: 'diverge', values: function () { return 0; }, parent: gA });
          ctx.text(HX, 778, 'a = SiLU(g) ⊙ u   (hidden neurons)', { size: 12, font: 'mono', color: 'amber', parent: gA });
          ctx.text(HX + N * 20 + 6, 752, '⊙', { size: 20, font: 'mono', color: 'amber', parent: gA });
          ctx.path('M' + (HX + N * 20 + 16) + ',644 V780', { stroke: ctx.alpha('amber', 0.4), dash: '3 4', arrow: true, parent: gA });
          ctx.path('M' + (HX + N * 20 + 2) + ',799 H' + (HX + N * 20 + 60), { stroke: ctx.alpha('orange', 0.6), arrow: true, parent: gA });
          ctx.text(HX + N * 20 + 30, 820, 'W2', { size: 12, font: 'mono', color: 'orange', anchor: 'middle', parent: gA });
          var out = ctx.matrix(HX + N * 20 + 70, 614, 12, 1, { cell: 16, gap: 3, cmap: 'diverge', values: function () { return 0; }, parent: gA });
          ctx.text(HX + N * 20 + 78, 604, 'Δ', { size: 14, font: 'mono', weight: 700, color: 'orange', anchor: 'middle', parent: gA });
          /* the neuron hotspot (beat 4) */
          var nc = S.actM.cellCenter(0, 16);
          S.neuronG = ctx.group({ parent: g, opacity: 0 });
          ctx.rect(nc.x - 13, nc.y - 13, 26, 26, { rx: 5, stroke: 'white', sw: 2, parent: S.neuronG, glow: true });
          ctx.text(nc.x, nc.y + 30, 'neuron #16', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: S.neuronG });
          S.neuronG.box = boxOf(nc.x - 16, nc.y - 16, 32, 32);
          /* parameter card */
          var c = ctx.group({ parent: g });
          ctx.rect(1220, 596, 300, 264, { rx: 10, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('orange', 0.3), parent: c });
          var cA = ctx.para(1238, 626, ['d_ff = 28,672 = 3.5 d', 'params 3·d·d_ff = 705 M', '≈ 82% of the block', 'FLOPs 6·d·d_ff/token', '  = 1.4 GFLOP'], { size: 13, font: 'code', color: 'text', lh: 28, parent: c });
          keepWS(cA);
          var cB = ctx.para(1238, 794, ['rows of W1,W3 = keys', 'cols of W2 = values'], { size: 13, font: 'code', color: 'text', lh: 28, parent: c, opacity: 0 });
          keepWS(cB);
          /* beat 0: the mini-neurons under the MLP node, the input vector, the parameter card */
          return Promise.all([ctx.reveal([S.nDots, S.nDot], { from: 'scale' }), ctx.reveal(gx, { delay: 300 })]).then(function () {
            return ctx.pulse(S.mlp, { color: 'orange', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: gate and up projections */
            ctx.reveal(gGU, { from: 'right', dur: 500 });
            return ctx.wait(500).then(function () {
              return ctx.tween(800, function (t) {
                S.gateM.set(function (rr, cc) { return Math.tanh(gate[cc] / 2) * t; });
                S.upM.set(function (rr, cc) { return up[cc] * t; });
              }, 'out');
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: SiLU gates the gate values */
            ctx.reveal(gS, { dur: 400 });
            ctx.reveal(pl.curve, { from: 'draw', dur: 700, delay: 200 });
            return ctx.wait(700).then(function () {
              return ctx.tween(1200, function (t) {
                var z = -5 + 9 * t, p = pl.toPx(z, silu(z));
                S.dot.setAttribute('cx', p.x); S.dot.setAttribute('cy', p.y);
                S.gateM.set(function (rr, cc) { var gz = gate[cc]; return Math.tanh((gz + (silu(gz) - gz) * t) / 2); });
              }, 'inOut');
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: gate times up, then the down projection */
            ctx.reveal(gA, { from: 'up', dur: 400 });
            return ctx.wait(400).then(function () {
              return ctx.tween(700, function (t) { S.actM.set(function (rr, cc) { return Math.tanh(act[cc]) * t; }); }, 'out');
            }).then(function () {
              return ctx.tween(600, function (t) { out.set(function (rr) { return Math.sin(rr * 1.7 + 0.4) * 0.8 * t; }); }, 'out');
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: one hidden neuron becomes a zoom target */
            ctx.reveal(cB, { from: 'left', dur: 400 });
            ctx.hotspot(S.neuronG, 'neuron', { hint: 'NEURON ⤢' });
            return ctx.reveal(S.neuronG, { from: 'scale' }).then(function () {
              return ctx.pulse(S.neuronG, { color: 'white', dur: 700, times: 2 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Mixture of Experts',
        beats: [
          {
            say: 'Frontier models often replace this dense MLP with a mixture of experts. A small router scores many expert MLPs for each token, here eight of them, and the bars show how much it likes each one.',
            card: { tag: 'KEY IDEA', title: 'Many MLPs, one router', body: 'The router is a tiny linear layer, x·W_r. Its scores decide which expert MLPs see this token.' },
            deep: '<div class="eq">y = Σ<sub>i∈TopK(s)</sub> g<sub>i</sub> · E<sub>i</sub>(x) + E<sub>shared</sub>(x), &nbsp; s = softmax(x W<sub>r</sub>) or σ(x W<sub>r</sub>)</div>' +
              '<p>Each expert E<sub>i</sub> is a small SwiGLU MLP. The router W<sub>r</sub> ∈ ℝ<sup>d×n<sub>experts</sub></sup> is tiny (7,168 × 256 = 1.8 M parameters for DeepSeek-V3), so scoring costs almost nothing next to the experts.</p>'
          },
          {
            say: 'It sends the token only to the top few, plus a shared expert that always runs. Here the ice token goes to experts four and one, and the other six stay idle for this token.',
            card: { tag: 'HOW IT WORKS', title: 'Top-k routing', body: 'Only the highest-scoring experts run. The shared expert always runs, for knowledge every token needs.' },
            deep: '<ul><li>Each expert is a small SwiGLU MLP. DeepSeek-V3 (d = 7,168): 256 routed experts with d<sub>ff</sub> = 2,048, top-8 + 1 shared → 3·7168·2048 = 44 M params per expert.</li>' +
              '<li>Sparsity is per token and per layer: neighbouring tokens go to different experts, and the same token can pick different experts in every layer.</li></ul>'
          },
          {
            say: 'The chosen experts’ outputs are weighted by their gate values and summed together with the shared expert. The result is the MLP update, exactly like the dense case.',
            card: { tag: 'HOW IT WORKS', title: 'Weighted sum of experts', body: 'Gate values are the router scores renormalised over the chosen experts: here 0.60 and 0.40.' },
            deep: '<p>The weights g<sub>i</sub> are the router probabilities, renormalised over the selected top-k so that they sum to 1 (DeepSeek-V3 uses sigmoid scores, normalised the same way). The output has the same shape as a dense MLP’s, <code>[T, 8192]</code>, so the block around it is unchanged.</p>' +
              '<p>Tokens are dispatched to experts on other GPUs (expert parallelism) with two all-to-all exchanges per layer; capacity factors cap per-expert batches.</p>'
          },
          {
            say: 'DeepSeek V3 has two hundred fifty six routed experts per layer and activates eight, so each layer stores eleven billion parameters but computes with only about four hundred million. Zoom in for routing and load balancing.',
            card: { tag: 'NUMBERS', title: 'Stored versus computed', more: '<p>Per expert: 3·7,168·2,048 = 44.0 M parameters. Stored: (256 routed + 1 shared) × 44.0 M = 11.3 B. Active per token: (8 routed + 1 shared) × 44.0 M = 0.40 B. Over the 58 MoE layers of DeepSeek-V3 that is 656 B stored in experts, of which 23 B are active.</p>', stat: { v: '11.3 B', l: 'parameters stored per DeepSeek-V3 MoE layer, of which 0.40 B run per token' } },
            deep: '<ul><li><b>11.3 B stored, 0.40 B active</b> per MoE layer (DeepSeek-V3: 256 routed experts + 1 shared, top-8).</li>' +
              '<li><b>Load balancing</b> is the crux: auxiliary losses (Switch/GShard), or DeepSeek-V3’s aux-loss-free bias terms added to routing scores, prevent expert collapse.</li>' +
              '<li><b>Systems cost</b>: experts live on other GPUs, so every layer pays two all-to-all exchanges, and capacity factors cap per-expert batches.</li>' +
              '<li>Granularity trend: a few large experts (Mixtral 8×7B, top-2) → many fine-grained experts (DeepSeek-V3: 256 routed + 1 shared, top-8; Qwen3-235B-A22B: 128, top-8; Kimi K2: 384 + 1 shared, top-8).</li></ul>' +
              '<details><summary>Go deeper</summary><p><b>Switch / GShard loss</b>: add α·N·Σ<sub>i</sub> f<sub>i</sub>P<sub>i</sub>, with f<sub>i</sub> the fraction of tokens sent to expert i and P<sub>i</sub> its mean router probability; it is smallest (α) when both are uniform. DeepSeek-V3 largely avoids that competing gradient: a per-expert bias, added to the scores only when picking the top-k, is nudged down for overloaded experts and up for idle ones (a tiny sequence-level balance loss remains as a safeguard).</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          mark(ctx, S, S.mlp, 'orange');
          S.moeTag = ctx.label(1050, 432, 'or: Mixture of Experts', { color: 'orange', size: 11, parent: S.diagram, opacity: 0 });
          S.moeTag.box = boxOf(1050 - S.moeTag.w / 2, 432 - S.moeTag.h / 2, S.moeTag.w, S.moeTag.h);
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
          S.shared.setAttribute('opacity', 0);
          S.sum = addCircle(ctx, S.moeG, 1010, 720);
          S.sum.setAttribute('opacity', 0);
          S.moeLinks = top.map(function (ti) { return ctx.link(S.experts[ti], S.sum, { color: 'orange', parent: S.moeG, from: 'r', to: 'l', label: 'g=' + (p[ti] / gsum).toFixed(2), labelDx: -30, labelDy: -12 }); });
          S.shLink = ctx.link(S.shared, S.sum, { color: 'teal', parent: S.moeG, from: 'r', to: 'b' });
          S.inLinks = top.map(function (ti) { return ctx.link({ x: 632, y: 720 }, S.experts[ti], { color: 'magenta', parent: S.moeG, to: 'l' }); });
          S.outArrow = ctx.line(1025, 720, 1066, 720, { color: 'orange', arrow: true, parent: S.moeG, opacity: 0 });
          var pA = ctx.para(1080, 640, ['Δmlp = Σ g_i E_i(x) + E_shared(x)', 'here: top-2 of 8 experts'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: S.moeG, opacity: 0 });
          var pB = ctx.para(1080, 718, ['DeepSeek-V3 per MoE layer:', ' 256 routed + 1 shared, top-8', ' 11.3 B stored, 0.40 B active', ' experts live on other GPUs:', ' all-to-all dispatch + combine'], { size: 13, font: 'code', color: 'text', lh: 26, parent: S.moeG, opacity: 0 });
          keepWS(pB);
          S.moeG.box = boxOf(80, 606, 1440, 258);
          [S.moeLinks, S.inLinks].forEach(function (arr) { arr.forEach(function (l) { l.setAttribute('opacity', 0); if (l.labelEl) l.labelEl.setAttribute('opacity', 0); }); });
          S.shLink.setAttribute('opacity', 0);
          /* beat 0: the router scores every expert */
          return ctx.reveal(S.moeTag, {}).then(function () {
            return ctx.wait(500);
          }).then(function () {
            return Promise.all(S.rBars.map(function (b, i) { return ctx.animate(b[0], { width: [0, b[1]] }, 600, 'out', i * 60); }));
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: top-2 experts plus the shared expert */
            ctx.reveal(S.inLinks, { from: 'draw', stagger: 150 });
            ctx.reveal(S.shared, { from: 'up', dur: 500 });
            top.forEach(function (ti) { ctx.fade(S.experts[ti], 1, 400); ctx.pulse(S.experts[ti], { color: 'orange', dur: 600 }); });
            return ctx.wait(800);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: gate-weighted sum */
            ctx.reveal(S.sum, { from: 'scale', dur: 500 });
            S.moeLinks.forEach(function (l) { ctx.reveal(l.labelEl, {}); });
            return ctx.reveal(S.moeLinks, { from: 'draw', stagger: 150 }).then(function () {
              return ctx.reveal(S.shLink, { from: 'draw' });
            }).then(function () {
              ctx.reveal([S.outArrow, pA], { dur: 400 });
              return ctx.pulse(S.sum, { color: 'orange', dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: what DeepSeek-V3 stores and computes */
            ctx.hotspot(S.moeG, 'moe', { hint: 'MoE ⤢' });
            return ctx.reveal(pB, { from: 'left', dur: 600 }).then(function () {
              return ctx.pulse(pB, { color: 'orange', dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Parameter accounting',
        beats: [
          {
            say: 'Let us count. The classic transformer block has twelve times d squared parameters: four d squared in attention, and eight d squared in a four times wide MLP. At a width of eight thousand one hundred ninety two, that is eight hundred five million.',
            card: { tag: 'NUMBERS', title: 'The classic count', stat: { v: '12d²', l: 'parameters in a classic block: 4d² attention + 8d² MLP = 805 M at d = 8,192' } },
            deep: '<div class="eq">classic: 4d² (W<sub>Q</sub>,W<sub>K</sub>,W<sub>V</sub>,W<sub>O</sub>) + 8d² (d→4d→d) = 12d²</div>' +
              '<p>At d = 8,192, d² = 67.1 M, so attention has 268 M parameters and the 4×-wide GELU MLP 537 M. This is the counting rule behind the folklore estimate N ≈ 12·L·d² for a dense transformer (Kaplan et al. 2020).</p>'
          },
          {
            say: 'Llama style blocks change the split. Grouped query attention shrinks the key and value projections, and the wider SwiGLU MLP grows, so attention falls to one hundred fifty one million and the MLP rises to seven hundred five million.',
            card: { tag: 'TRADE-OFF', title: 'Trade attention for MLP', more: '<p>Attention per block: W<sub>Q</sub> and W<sub>O</sub> are d × d = 67.1 M each; W<sub>K</sub> and W<sub>V</sub> are d × 1,024 = 8.4 M each. Total 151.0 M. MLP: 3 × 8,192 × 28,672 = 704.6 M. Block = 855.6 M; × 80 = 68.45 B.</p>', body: 'GQA frees 117 M attention parameters; the wider SwiGLU MLP takes 168 M more. Net: +6% per block.' },
            deep: '<div class="eq">Llama-3-70B: 2d² + 2·d·(n<sub>kv</sub>d<sub>h</sub>) + 3·d·d<sub>ff</sub> = 134.2 M + 16.8 M + 704.6 M = 855.6 M</div>' +
              '<table><tr><th>per block</th><th>attention</th><th>MLP</th><th>total</th></tr>' +
              '<tr><td>classic 12d², d=8192</td><td>268 M</td><td>537 M</td><td>805 M</td></tr>' +
              '<tr><td>Llama 3 70B</td><td>151 M</td><td>705 M</td><td>856 M</td></tr>' +
              '<tr><td>DeepSeek-V3 MoE layer</td><td>MLA ≈ 187 M</td><td>11.3 B (0.40 B active)</td><td>—</td></tr></table>' +
              '<p>The shift is deliberate: attention parameters are cheap in FLOPs but expensive in KV-cache bytes, so modern designs shrink them (GQA, MLA) and spend the savings on the MLP.</p>'
          },
          {
            say: 'The result, eight hundred fifty six million per block, times eighty blocks, plus the embedding tables, is the seventy billion parameter model.',
            card: { tag: 'NUMBERS', title: 'From block to model', stat: { v: '70.6 B', l: '80 × 855.6 M, plus 1.05 B each for the embedding and unembedding tables' } },
            deep: '<p>80 × 855.6 M = 68.4 B of block parameters, + 1.05 B embedding + 1.05 B unembedding = <b>70.6 B</b>. Weights: 141 GB in BF16, 71 GB in FP8.</p>' +
              '<p>The bar in the last row is one block’s width divided by 80: at this scale, the stack of 80 nearly identical blocks is the model, and everything else (embeddings, norms) is a 3% rounding term.</p>'
          },
          {
            say: 'In compute, each block costs about twice its active parameters in FLOPs per token, plus a small attention term that grows with context. Norms, rotary embeddings and residual adds are negligible in FLOPs, but they move a lot of memory.',
            card: { tag: 'WHY IT MATTERS', title: 'Small FLOPs, big traffic', body: 'Norms, RoPE and adds are under 0.1% of FLOPs yet a large share of memory traffic, so kernels fuse them.' },
            deep: '<p><b>FLOPs per token per block</b> ≈ 2 × active params + 4·T·d for attention scores and weighted values: at T = 8k, 1.71 G + 0.27 G. Norms, RoPE and residual adds are &lt; 0.1% of FLOPs but a large share of memory traffic — hence kernel fusion.</p>' +
              '<p>Times 80 blocks: ≈ 137 GFLOP of parameter FLOPs per token plus 21 GFLOP of attention at T = 8k, in line with the 2N ≈ 141 GFLOP rule of thumb from the LLM chamber.</p>'
          }
        ],
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
          S.pRows = rows.map(function (row, i) {
            var rg = ctx.group({ parent: g, opacity: 0 });
            var y = 640 + i * 70, x = 380;
            ctx.text(360, y, row[0], { size: 14, font: 'mono', color: 'white', anchor: 'end', parent: rg });
            var bars = [];
            row[1].forEach(function (seg) {
              var w = seg[1] * SC * 0.95;
              var b = ctx.rect(x, y - 16, 0, 32, { rx: 4, fill: ctx.alpha(seg[2], 0.45), stroke: seg[2], sw: 1, parent: rg });
              var t = ctx.text(x + 8, y, w > 60 ? seg[0] : '', { size: 12, font: 'mono', color: 'white', parent: rg, opacity: 0 });
              var t2 = w <= 60 ? ctx.text(x + w / 2, y + 28, seg[0], { size: 11, font: 'mono', color: seg[2], anchor: 'middle', parent: rg, opacity: 0 }) : null;
              bars.push([b, w - 2, t, t2]);
              x += w;
            });
            var tot = row[2] ? ctx.text(x + 12, y, row[2], { size: 14, font: 'mono', weight: 700, color: 'amber', parent: rg, opacity: 0 }) : null;
            return { g: rg, bars: bars, tot: tot };
          });
          S.flopTxt = ctx.text(380, 848, 'FLOPs/token/block ≈ 2 × active params + 4·T·d  =  1.71 G + 0.27 G at T = 8k', { size: 13, font: 'mono', color: 'text', parent: g, opacity: 0 });
          function showRow(i) {
            var row = S.pRows[i];
            ctx.reveal(row.g, { dur: 250, delay: 200 });
            return ctx.wait(300).then(function () {
              return Promise.all(row.bars.map(function (b, k) {
                return ctx.animate(b[0], { width: [0, b[1]] }, 700, 'out', k * 220).then(function () {
                  return ctx.reveal([b[2], b[3]].filter(function (e) { return e; }), { dur: 300, stagger: 0 });
                });
              }));
            }).then(function () { return row.tot ? ctx.reveal(row.tot, { from: 'left', dur: 300 }) : null; });
          }
          /* beat 0: the classic 12 d^2 block */
          return showRow(0).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the Llama split */
            return showRow(1);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: times eighty blocks */
            return showRow(2);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: compute per token */
            return ctx.reveal(S.flopTxt, { from: 'up', dur: 500 });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Depth builds circuits',
        beats: [
          {
            say: 'Why stack eighty blocks? Because blocks compose through the residual stream. A classic example is the induction circuit, and it needs two heads in different layers.',
            card: { tag: 'KEY IDEA', title: 'Depth builds circuits', body: 'Later blocks read what earlier blocks wrote. Two simple heads compose into a behaviour neither has alone.' },
            deep: '<p>Depth is a <i>serial</i> compute budget: multi-hop reasoning needs several layers per hop, one motivation for chain-of-thought, which trades depth for sequence length. Mechanistic interpretability reads models as <b>circuits</b>: heads and MLPs wired together through the residual stream (Elhage et al. 2021).</p>' +
              '<p class="muted">The layers and heads named here are illustrative.</p>'
          },
          {
            say: 'In an early layer, a previous token head writes into each position which token came just before it. Every position now carries a note about its predecessor.',
            card: { tag: 'HOW IT WORKS', title: 'A note about the past', body: 'Each position stores its predecessor: at moon, the stream now says "before me: ice".' },
            deep: '<p><b>Induction circuit</b> (Olsson et al. 2022), step 1: a <i>previous-token head</i> in layer ℓ₁ writes "my predecessor is A" into position j’s stream. Attention here is a fixed shift by one position, and its OV circuit copies the previous token’s identity into a subspace reserved for later heads.</p>'
          },
          {
            say: 'Much later, an induction head at the current ice asks: where did ice appear before, and what followed it? Its keys read those notes, and the earlier moon matches.',
            card: { tag: 'HOW IT WORKS', title: 'K-composition', body: 'The later head’s keys read the subspace the earlier head wrote. A match means: the token before j was ice.' },
            deep: '<p>Step 2: an <i>induction head</i> in layer ℓ₂ &gt; ℓ₁ uses <b>K-composition</b>: its keys read that subspace, so the query "current token = A" matches positions whose predecessor was A.</p>' +
              '<div class="eq">[… ice moon …] … ice → attend to "moon"</div>' +
              '<p>Q- and V-composition are the other two ways a later head can read an earlier head’s output. Induction needs K-composition because it must match on the <i>previous</i> token of each key position, not on the key’s own token.</p>'
          },
          {
            say: 'It finds moon and copies it forward, raising the score of moon as the next token. That is in-context copying from a sentence the model has never seen before.',
            card: { tag: 'WHY IT MATTERS', title: 'Where copying begins', body: 'Induction heads appear abruptly early in training, at the same moment in-context learning jumps.' },
            deep: '<div class="eq">… attend to "moon" → OV copies E[moon] → boost logit(" moon")</div>' +
              '<ul><li>Its OV circuit writes the attended token’s identity toward the unembedding, so the logit of " moon" rises: the model literally completes a repeated pattern.</li>' +
              '<li>Induction heads form abruptly early in training and coincide with a jump in in-context learning ability, visible as a bump in the loss curve (Olsson et al. 2022). In small models, ablating them removes most of the in-context learning; in large models the evidence is correlational and more heads share the job.</li></ul>'
          },
          {
            say: 'Two simple heads in different layers implement copying that neither can do alone. And between them, the MLP layers hold individual neurons and experts, which you can open from here.',
            card: { tag: 'TRY IT', title: 'Open a neuron or experts', body: 'Click the neuron dot or the Mixture of Experts tag in the block diagram above.' },
            deep: '<ul><li>Composition types: Q-, K- and V-composition between heads; MLPs act as lookup tables in between.</li>' +
              '<li>Circuits generalise: names, dates, syntax and arithmetic all use chains of heads and MLP features, found by ablation, patching and attribution graphs.</li></ul>' +
              '<div class="note">Zoom targets from this chamber: the <b>Neuron</b> (in the MLP) and <b>Mixture of Experts</b>.</div>'
          }
        ],
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
          S.pred = ctx.label(x + 60, 760, '→ ·moon ?', { color: 'amber', size: 14, parent: g, opacity: 0 });
          var t1 = ctx.text(100, 616, 'layer 2 · previous-token head: each position stores "who came before me"', { size: 12, font: 'mono', color: 'cyan', parent: g, opacity: 0 });
          var t2 = ctx.text(100, 850, 'layer 5 · induction head at the last "·ice": find earlier "·ice", copy what followed it', { size: 12, font: 'mono', color: 'pink', parent: g, opacity: 0 });
          S.prevArcs = [];
          for (var i = 1; i < toks.length; i++) {
            if (i === 4 || i === 5) continue;
            var a = xs[i - 1], b = xs[i];
            S.prevArcs.push(ctx.path('M' + b + ',744 Q' + ((a + b) / 2) + ',690 ' + a + ',744', { stroke: ctx.alpha('cyan', 0.7), sw: 1.4, arrow: true, parent: g, opacity: 0 }));
          }
          S.ind = ctx.path('M' + xs[9] + ',778 Q' + ((xs[9] + xs[3]) / 2) + ',860 ' + xs[3] + ',778', { stroke: 'pink', sw: 2.4, arrow: true, parent: g, opacity: 0 });
          S.copy = ctx.path('M' + xs[3] + ',744 Q' + ((xs[3] + x + 30) / 2) + ',640 ' + (x + 20) + ',744', { stroke: 'amber', sw: 2, dash: '6 4', arrow: true, parent: g, opacity: 0 });
          var copyLbl = ctx.text((xs[3] + x + 30) / 2, 666, 'OV copies "moon"', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: g, opacity: 0 });
          var kc = ctx.group({ parent: g, opacity: 0 });
          ctx.rect(1040, 600, 480, 262, { rx: 10, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('pink', 0.3), parent: kc });
          ctx.text(1058, 630, 'K-COMPOSITION, step by step', { size: 12, font: 'mono', weight: 700, color: 'pink', parent: kc });
          var kp = ctx.para(1058, 662, ['1  L2 head at "·moon" writes  prev = ice', '2  L5 query at last "·ice":  q = W_Q h_t', '3  L5 keys read that subspace: k_j = W_K h_j', '4  q·k_j is large  ⇔  token before j was ice', '5  OV circuit writes E[·moon] direction', '6  unembedding: logit(·moon) goes up'], { size: 12, font: 'code', color: 'text', lh: 32, parent: kc });
          keepWS(kc);
          /* beat 0: a sentence in which "ice moon" occurred earlier */
          return ctx.reveal(S.tk, { from: 'up', stagger: 60, dur: 350 }).then(function () {
            return ctx.pulse(S.tk[2], { color: 'cyan', dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the previous-token head */
            ctx.reveal(t1, { dur: 400 });
            return ctx.reveal(S.prevArcs, { from: 'draw', stagger: 120, dur: 400 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the induction head looks back */
            ctx.reveal(t2, { dur: 400 });
            ctx.pulse(S.tk[9], { color: 'pink', dur: 600 });
            return ctx.reveal(S.ind, { from: 'draw', dur: 900 });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: copy moon forward */
            ctx.pulse(S.tk[3], { color: 'amber', dur: 600 });
            ctx.reveal(copyLbl, { dur: 400 });
            return ctx.reveal(S.copy, { from: 'draw', dur: 800 }).then(function () {
              return ctx.reveal(S.pred, { from: 'left' });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the recipe, and the doors to neurons and experts */
            ctx.reveal(kc, { from: 'up', dur: 500 });
            return ctx.wait(400).then(function () {
              return Promise.all([ctx.pulse(S.nDot, { color: 'orange', times: 2, dur: 600 }), ctx.pulse(S.moeTag, { color: 'orange', times: 2, dur: 600 }), ctx.pulse(S.attn, { color: 'amber', times: 2, dur: 600 })]);
            });
          });
        }
      }
    ]
  });
})();
