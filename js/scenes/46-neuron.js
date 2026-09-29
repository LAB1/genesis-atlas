/* L3 — A Single Neuron. Weighted sum + bias + nonlinearity, the hyperplane view, gradient descent, backprop
 * through a tiny net, from neuron to layer (matmul) to tensor-core tiles, and polysemantic neurons vs SAE features.
 * Every step is a sequence of beats (see docs/SCENE_API.md). */
(function () {
  var W0 = [0.8, -0.5, 1.2], B0 = -0.3;
  var IN_Y = [260, 380, 500], IN_X = 230, SIG = { x: 590, y: 380 }, ACT = { x: 790, y: 380 }, OUT = { x: 990, y: 380 };
  var INAMES = ['cold', 'warm', 'glow'];
  var P = { x: 110, y: 196, w: 470, h: 470 };        /* 2-D input-space plot */

  function boxOf(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }
  function keepWS(root) {
    Array.prototype.forEach.call(root.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
  }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }
  var ACTS = {
    ReLU: function (z) { return Math.max(0, z); },
    GELU: function (z) { return 0.5 * z * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z * z * z))); },
    SiLU: function (z) { return z * sigm(z); }
  };
  var ACOL = { ReLU: 'orange', GELU: 'violet', SiLU: 'pink' };
  function fmt(v) { return (v < -0.005 ? '−' : '') + Math.abs(v).toFixed(2); }

  /* straight segment as a <path>: packets and draw-reveals need a path, not a <line> */
  function seg(ctx, x1, y1, x2, y2, o) {
    return ctx.path('M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2, o);
  }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.5), parent: g });
    if (title) ctx.text(x + 16, y + 20, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = boxOf(x, y, w, h);
    return g;
  }
  function swapMain(ctx, S, g) {
    if (S.main) ctx.fadeOut(S.main, 350, true);
    S.main = g;
    ctx.reveal(g, { from: 'up', dur: 500, delay: 150 });
  }

  /* ---- 2-D input space helpers ---- */
  function toPx(x, y) { return { x: P.x + (x + 3) / 6 * P.w, y: P.y + P.h - (y + 3) / 6 * P.h }; }
  function clipHalf(w1, w2, b) {
    var poly = [[-3, -3], [3, -3], [3, 3], [-3, 3]], out = [];
    function f(p) { return w1 * p[0] + w2 * p[1] + b; }
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], c = poly[(i + 1) % poly.length], fa = f(a), fc = f(c);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fc >= 0)) { var t = fa / (fa - fc); out.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]); }
    }
    return out;
  }
  function boundary(w1, w2, b) {
    var pts = [], E = 3;
    function add(x, y) { if (x >= -E - 1e-9 && x <= E + 1e-9 && y >= -E - 1e-9 && y <= E + 1e-9) pts.push([x, y]); }
    if (Math.abs(w2) > 1e-9) { add(-E, (-b + w1 * E) / w2); add(E, (-b - w1 * E) / w2); }
    if (Math.abs(w1) > 1e-9) { add((-b + w2 * E) / w1, -E); add((-b - w2 * E) / w1, E); }
    return pts.slice(0, 2);
  }

  Atlas.register({
    id: 'neuron',
    refs: [
      'McCulloch &amp; Pitts, <i>A Logical Calculus of the Ideas Immanent in Nervous Activity</i>, Bulletin of Mathematical Biophysics 1943; Rosenblatt, <i>The Perceptron</i>, Psychological Review 1958; Minsky &amp; Papert, <i>Perceptrons</i>, MIT Press 1969',
      'Rumelhart, Hinton &amp; Williams, <i>Learning Representations by Back-propagating Errors</i>, Nature 1986',
      'Hendrycks &amp; Gimpel, <i>Gaussian Error Linear Units (GELUs)</i>, 2016; Ramachandran et al., <i>Searching for Activation Functions</i> (Swish/SiLU), 2017',
      'NVIDIA, <i>H100 Tensor Core GPU Architecture</i> whitepaper, 2022; <i>CUTLASS</i> / PTX ISA docs (mma, wgmma, tcgen05); Blackwell architecture brief, 2024',
      'Elhage et al., <i>Toy Models of Superposition</i>, Transformer Circuits 2022; Bricken et al., <i>Towards Monosemanticity</i>, Anthropic 2023',
      'Templeton et al., <i>Scaling Monosemanticity</i>, Anthropic 2024; Gao et al., <i>Scaling and Evaluating Sparse Autoencoders</i>, OpenAI 2024; Lieberum et al., <i>Gemma Scope</i>, 2024',
      'Dunefsky et al., <i>Transcoders Find Interpretable LLM Feature Circuits</i>, NeurIPS 2024; Ameisen et al., <i>Circuit Tracing: Revealing Computational Graphs in Language Models</i>, Anthropic 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Weighted sum',
        beats: [
          {
            say: 'Here is the atom of every model in this system: one artificial neuron. It receives numbers from the previous layer, here three inputs named cold, warm and glow.',
            card: { tag: 'KEY IDEA', title: 'The atom of computation', body: 'Every dense layer of every model here is built from copies of this one unit: numbers in, one number out.' },
            deep: '<p>Inputs are the activations of the previous layer or, in an LLM MLP, the 8,192 numbers of the residual stream. Here three evidence values stand for a tiny "icy surface" detector: x<sub>1</sub> = cold, x<sub>2</sub> = warm, x<sub>3</sub> = glow.</p>' +
              '<ul><li>Historical lineage: McCulloch–Pitts threshold unit (1943) → Rosenblatt perceptron (1958) with a learning rule → differentiable units trained by backprop (1986).</li></ul>'
          },
          {
            say: 'Each input is multiplied by a learned weight. Orange edges excite, blue edges inhibit, and thickness shows how strongly. Cold pushes the neuron up, warm pushes it down, and glow helps.',
            card: { tag: 'HOW IT WORKS', title: 'Weights scale evidence', more: '<p>With w = (0.8, −0.5, 1.2) and b = −0.3 the decision boundary in x-space is 0.8x<sub>1</sub> − 0.5x<sub>2</sub> + 1.2x<sub>3</sub> = 0.3. Every input contributes linearly to z; only the activation φ adds nonlinearity, which is the next step.</p>', body: 'Sign says excite or inhibit, size says how much. Here w = (0.8, −0.5, 1.2), learned rather than chosen.' },
            deep: '<ul><li><b>Weights</b> w<sub>i</sub> scale evidence; sign says excitatory (orange) or inhibitory (blue).</li>' +
              '<li>Cost: n multiply–adds (2n FLOPs) for n inputs. An MLP neuron in a 70B LLM has n = 8,192 inputs; a gate neuron reads the whole residual stream.</li>' +
              '<li>Nobody picks the weights: gradient descent sets them (step 4).</li></ul>'
          },
          {
            say: 'The weighted inputs are added together with a bias, a learned threshold, giving one number, z. The live readout on the right shows every term.',
            card: { tag: 'NUMBERS', title: 'The weighted sum', stat: { v: '6', u: 'FLOPs', l: 'to compute z for three inputs: three multiplies and three adds' } },
            deep: '<div class="eq">z = Σ<sub>i</sub> w<sub>i</sub>x<sub>i</sub> + b = w·x + b</div>' +
              '<p><b>Bias</b> b shifts the threshold: with b = −0.3, the weighted evidence must exceed 0.3 before z turns positive. For n inputs the neuron performs n multiply–adds, that is 2n FLOPs.</p>' +
              '<p>Numbers here: w = (0.8, −0.5, 1.2), b = −0.3.</p>'
          },
          {
            say: 'That sum passes through a nonlinearity to give the output. Imagine this neuron detects an icy surface in the fox trailer: it fires when there is enough evidence.',
            card: { tag: 'KEY IDEA', title: 'A feature detector', body: 'Output = φ(z). Here ReLU: silent below the threshold, proportional to the evidence above it.' },
            deep: '<div class="eq">y = φ(z)</div>' +
              '<p>The output y is a new, more abstract feature that the next layer reads. φ = ReLU until you pick another activation in the next step. Layers of such detectors build up from edges to textures to objects, or, in a language model, from tokens to syntax to meaning.</p>'
          },
          {
            say: 'Click the input circles to change their values and watch the weighted sum and the output respond. Raise warm and drop glow, and the neuron falls silent.',
            card: { tag: 'TRY IT', title: 'Click the inputs', body: 'Each circle cycles through 0, 0.5 and 1. Icy needs cold and glow, but not warm.' },
            deep: '<div class="note">Interactive: click x1, x2, x3 to cycle their value through 0 → 0.5 → 1.</div>' +
              '<p>Try x = (1, 1, 0): z = 0.8 − 0.5 + 0 − 0.3 = 0, so the neuron is silent: the warm evidence cancels the cold. With x = (1, 0, 1): z = 1.7, and it fires strongly.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.x = [1, 0, 1];
          S.act = 'ReLU';
          S.nd = ctx.group();
          var D = S.nd;
          var gIn = ctx.group({ parent: D, opacity: 0 });
          var gW = ctx.group({ parent: D, opacity: 0 });
          var gSum = ctx.group({ parent: D, opacity: 0 });
          var gAct = ctx.group({ parent: D, opacity: 0 });
          S.edges = [];
          S.wl = [];
          IN_Y.forEach(function (y, i) {
            var col = W0[i] >= 0 ? 'orange' : 'blue';
            var e = seg(ctx, IN_X + 32, y, SIG.x - 44, SIG.y, { stroke: col, sw: 1.5 + Math.abs(W0[i]) * 4, parent: gW });
            S.edges.push(e);
            var mx = (IN_X + 32 + SIG.x - 44) / 2, my = (y + SIG.y) / 2;
            S.wl.push(ctx.label(mx, my - 18, 'w' + (i + 1) + ' = ' + fmt(W0[i]), { color: col, size: 12, bg: '#0b1428', parent: gW }));
          });
          S.ins = IN_Y.map(function (y, i) {
            var g = ctx.group({ parent: gIn });
            g.c = ctx.circle(IN_X, y, 32, { fill: ctx.alpha('cyan', 0.15), stroke: 'cyan', sw: 2, parent: g, glow: true });
            g.t = ctx.text(IN_X, y + 1, '', { size: 17, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: g });
            ctx.text(IN_X - 44, y - 8, 'x' + (i + 1), { size: 15, font: 'mono', weight: 700, color: 'cyan', anchor: 'end', parent: g });
            ctx.text(IN_X - 44, y + 12, INAMES[i], { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: g });
            g.style.cursor = 'pointer';
            g.addEventListener('click', function (ev) {
              ev.stopPropagation();
              var v = S.x[i];
              S.x[i] = v === 0 ? 0.5 : (v === 0.5 ? 1 : 0);
              S.update(350);
            });
            return g;
          });
          S.sum = ctx.group({ parent: gSum });
          ctx.circle(SIG.x, SIG.y, 44, { fill: '#101b33', stroke: 'amber', sw: 2.2, parent: S.sum, glow: true });
          ctx.text(SIG.x, SIG.y + 2, 'Σ', { size: 30, color: 'amber', anchor: 'middle', weight: 700, parent: S.sum });
          ctx.line(SIG.x, 530, SIG.x, SIG.y + 48, { color: 'amber', arrow: true, parent: gSum });
          ctx.label(SIG.x, 546, 'b = ' + fmt(B0), { color: 'amber', size: 12, parent: gSum });
          S.actN = ctx.node({ x: ACT.x, y: ACT.y, w: 120, h: 64, title: 'ReLU', sub: 'φ(z)', color: 'orange', titleSize: 17, subSize: 12, parent: gAct });
          S.l1 = seg(ctx, SIG.x + 46, SIG.y, ACT.x - 64, ACT.y, { stroke: 'amber', arrow: true, sw: 2, parent: gAct });
          S.zLbl = ctx.label((SIG.x + ACT.x) / 2 - 8, SIG.y - 24, 'z', { color: 'amber', size: 12, w: 92, bg: '#0b1428', parent: gAct });
          S.l2 = seg(ctx, ACT.x + 62, ACT.y, OUT.x - 38, OUT.y, { stroke: 'orange', arrow: true, sw: 2, parent: gAct });
          S.outC = ctx.circle(OUT.x, OUT.y, 36, { fill: ctx.alpha('orange', 0.2), stroke: 'orange', sw: 2.2, parent: gAct, glow: true });
          S.outT = ctx.text(OUT.x, OUT.y + 1, '', { size: 18, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: gAct });
          ctx.text(OUT.x, OUT.y + 56, 'y = φ(z)', { size: 13, font: 'mono', color: 'orange', anchor: 'middle', parent: gAct });
          ctx.text(OUT.x, OUT.y - 54, '"icy surface"', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: gAct });

          /* live readout */
          S.ro = card(ctx, null, 1090, 190, 450, 380, 'amber', 'LIVE COMPUTATION');
          S.ro.setAttribute('opacity', 0);
          S.roL = [0, 1, 2, 3, 4, 5, 6].map(function (k) { return ctx.text(1110, 240 + k * 42, '', { size: 15, font: 'mono', color: 'text', parent: S.ro }); });
          keepWS(S.ro);
          S.update = function (ms, quiet) {
            var x = S.x, z = B0, terms = [];
            for (var i = 0; i < 3; i++) { z += W0[i] * x[i]; terms.push(W0[i] * x[i]); }
            var y = ACTS[S.act](z);
            S.z = z; S.y = y;
            S.ins.forEach(function (g, i) {
              g.t.textContent = x[i].toFixed(1);
              g.c.setAttribute('fill', ctx.alpha('cyan', 0.1 + 0.5 * x[i]));
              S.edges[i].setAttribute('opacity', (0.25 + 0.75 * Math.min(1, Math.abs(terms[i]) / 1.2)).toFixed(2));
            });
            S.zLbl.lastChild.textContent = 'z = ' + fmt(z);
            S.outT.textContent = y.toFixed(2);
            S.outC.setAttribute('fill', ctx.alpha('orange', 0.12 + 0.5 * Math.min(1, Math.abs(y) / 2)));
            S.actN.titleEl.textContent = S.act;
            S.roL[0].textContent = 'x = (' + x.map(function (v) { return v.toFixed(1); }).join(', ') + ')';
            S.roL[1].textContent = 'w = (0.8, −0.5, 1.2)   b = −0.3';
            S.roL[2].textContent = 'w·x = ' + terms.map(function (t) { return fmt(t); }).join(' + ');
            S.roL[3].textContent = 'z = w·x + b = ' + fmt(z);
            S.roL[4].textContent = 'y = ' + S.act + '(z) = ' + y.toFixed(3);
            var fires = z > 1e-9;
            S.roL[5].textContent = fires ? 'fires: evidence for "icy surface"' : 'silent: below threshold';
            S.roL[6].textContent = 'cost: 3 multiply-adds = 6 FLOPs';
            S.roL[5].setAttribute('fill', fires ? ctx.C.lime : ctx.C.dim);
            return quiet ? Promise.resolve() : ctx.pulse(S.outC, { color: 'orange', dur: ms || 300 });
          };
          S.update(0, true);
          S.bottom = card(ctx, null, 60, 612, 1480, 260, 'cyan', 'THE NEURON AS A FEATURE DETECTOR');
          S.bottom.setAttribute('opacity', 0);
          ctx.para(80, 662, ['inputs  = activations of the previous layer (here: cold, warm, glow evidence)', 'weights = learned relevance of each input;  sign = excite / inhibit', 'bias    = learned threshold;  z > 0 means "enough evidence"', 'output  = a new, more abstract feature for the next layer to read', 'in an LLM MLP: 8,192 inputs per neuron, 28,672 neurons per layer, 80 layers'], { size: 15, font: 'code', color: 'text', lh: 38, parent: S.bottom });
          keepWS(S.bottom);
          /* beat 0: the three inputs */
          return ctx.reveal(gIn, { from: 'left', dur: 600 }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: learned weights on the edges */
            ctx.reveal(gW, { dur: 400 });
            return ctx.wait(300).then(function () {
              return Promise.all(S.edges.map(function (e, i) { return ctx.packet(e, { color: W0[i] >= 0 ? 'orange' : 'blue', dur: 700 }); }));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the sum and the bias, with the live readout */
            ctx.reveal(gSum, { from: 'scale', dur: 500 });
            ctx.reveal(S.ro, { from: 'right', dur: 500, delay: 200 });
            return ctx.wait(500).then(function () { return ctx.pulse(S.sum, { color: 'amber', dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the nonlinearity and the output */
            ctx.reveal(gAct, { from: 'left', dur: 500 });
            ctx.reveal(S.bottom, { from: 'up', dur: 500, delay: 300 });
            return ctx.wait(500).then(function () { return ctx.packet(S.l1, { color: 'amber', dur: 500 }); }).then(function () {
              return ctx.packet(S.l2, { color: 'orange', dur: 500 });
            }).then(function () { return ctx.pulse(S.outC, { color: 'orange', dur: 600 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the inputs change, the output follows: warm up and glow down silences the neuron */
            S.x = [1, 1, 0];
            return S.update(400).then(function () { return ctx.wait(900); }).then(function () {
              S.x = [1, 0, 1];
              return S.update(400);
            });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Nonlinearity',
        beats: [
          {
            say: 'Why the nonlinearity? Stack any number of purely linear layers and you still get one linear map. The activation function bends space, and that is what lets depth build complex functions.',
            card: { tag: 'KEY IDEA', title: 'Depth needs a bend', body: 'Without φ, two layers collapse into one matrix: W₂(W₁x) = (W₂W₁)x. The bend makes depth useful.' },
            deep: '<div class="eq">W<sub>2</sub>(W<sub>1</sub>x) = (W<sub>2</sub>W<sub>1</sub>)x</div>' +
              '<p><b>Why nonlinear</b>: without φ, depth collapses to one matrix. With φ, a 2-layer MLP is a universal approximator.</p>' +
              '<p>The dashed line on the plot is a linear map: however many you compose, the result is still a straight line (a hyperplane in higher dimensions).</p>'
          },
          {
            say: 'ReLU simply clips negatives to zero. It is cheap and sparse, but a unit whose input stays negative gets no gradient at all.',
            card: { tag: 'HOW IT WORKS', title: 'ReLU: clip at zero', body: 'max(0, z). Cheap and sparse, but zero gradient for z < 0: units can die.' },
            deep: '<div class="eq">ReLU(z) = max(0, z)</div>' +
              '<p><b>ReLU</b>: cheap (one comparison), sparse (about half the units are exactly zero for centred inputs), but zero gradient for z &lt; 0: a unit whose input is always negative never updates ("dead" units). Its derivative is ReLU′ ∈ {0, 1}.</p>'
          },
          {
            say: 'GELU and SiLU are smooth cousins that let small negative values leak through. SiLU is the gate inside the SwiGLU layers of modern language models.',
            card: { tag: 'STATE OF THE ART', title: 'SiLU gates modern LLMs', body: 'Llama, Qwen and DeepSeek use SiLU as the gate in SwiGLU; GELU dominated the BERT and GPT-2/3 era.' },
            deep: '<div class="eq">GELU(z) = z·Φ(z) ≈ ½z(1 + tanh(√(2/π)(z + 0.044715 z³)))</div>' +
              '<div class="eq">SiLU(z) = z·σ(z) = z / (1 + e<sup>−z</sup>)</div>' +
              '<ul><li><b>GELU</b>: BERT/GPT-2/3 era. <b>SiLU/Swish</b>: smooth, non-monotonic dip (min ≈ −0.28 at z ≈ −1.28), used as the gate in SwiGLU (Llama, Qwen, DeepSeek).</li></ul>'
          },
          {
            say: 'Click an activation to plug it into the neuron above, and watch the output change.',
            card: { tag: 'TRY IT', title: 'Plug in an activation', body: 'Click ReLU, GELU or SiLU. The neuron above recomputes its output with the new φ.' },
            deep: '<p>At the neuron’s current z = 1.7 the three activations give ReLU 1.700, GELU 1.624 and SiLU 1.437: they differ noticeably only near zero and for negative z. The choice matters most for gradient flow and for how the gating in SwiGLU behaves.</p>' +
              '<ul><li>Derivatives: ReLU′ ∈ {0,1}; SiLU′(z) = σ(z)(1 + z(1 − σ(z))). Backprop needs these at every neuron.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.bottom, 300, true);
          var g = card(ctx, null, 60, 612, 1480, 260, 'pink', 'ACTIVATION FUNCTIONS  φ(z)');
          S.bottom = g;
          var pl = ctx.plot(120, 648, 560, 200, ACTS.ReLU, { xDomain: [-4, 3], yDomain: [-0.6, 3], color: 'orange', sw: 2.4, parent: g, xLabel: 'z', yLabel: '' });
          var gl = ctx.plot(120, 648, 560, 200, ACTS.GELU, { xDomain: [-4, 3], yDomain: [-0.6, 3], color: 'violet', sw: 2.4, parent: g, axes: false });
          var sl = ctx.plot(120, 648, 560, 200, ACTS.SiLU, { xDomain: [-4, 3], yDomain: [-0.6, 3], color: 'pink', sw: 2.4, parent: g, axes: false });
          [pl.curve, gl.curve, sl.curve].forEach(function (c) { c.setAttribute('opacity', 0); });
          var z0 = pl.toPx(0, 0);
          ctx.line(120, z0.y, 680, z0.y, { color: ctx.alpha('white', 0.15), parent: g });
          ctx.line(z0.x, 648, z0.x, 848, { color: ctx.alpha('white', 0.15), parent: g });
          /* a linear map, for contrast (beat 0) */
          var lp0 = pl.toPx(-0.75, -0.6), lp1 = pl.toPx(3, 2.4);
          S.linLine = seg(ctx, lp0.x, lp0.y, lp1.x, lp1.y, { stroke: ctx.alpha('white', 0.7), sw: 2, dash: '6 5', parent: g, opacity: 0 });
          S.linLbl = ctx.text(lp1.x - 8, lp1.y + 14, 'linear: no bend', { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: g, opacity: 0 });
          S.zMark = ctx.rect(0, 648, 2, 200, { rx: 1, fill: ctx.alpha('amber', 0.8), parent: g, opacity: 0 });
          S.dots = ['ReLU', 'GELU', 'SiLU'].map(function (k) { return ctx.circle(0, 0, 5, { fill: ACOL[k], parent: g, glow: true, opacity: 0 }); });
          S.zTxt = ctx.text(700, 660, '', { size: 14, font: 'mono', color: 'amber', parent: g, opacity: 0 });
          S.fTxt = ['ReLU', 'GELU', 'SiLU'].map(function (k, i) { return ctx.text(700, 700 + i * 30, '', { size: 14, font: 'mono', color: ACOL[k], parent: g, opacity: 0 }); });
          function setZ(z) {
            var p = pl.toPx(z, 0);
            S.zMark.setAttribute('x', p.x - 1);
            ['ReLU', 'GELU', 'SiLU'].forEach(function (k, i) {
              var v = ACTS[k](z), q = pl.toPx(z, Math.min(3, v));
              S.dots[i].setAttribute('cx', q.x); S.dots[i].setAttribute('cy', q.y);
              S.fTxt[i].textContent = k + '(' + z.toFixed(2) + ') = ' + v.toFixed(3);
            });
            S.zTxt.textContent = 'z = ' + z.toFixed(2);
          }
          /* activation chooser (beat 3) */
          var chipG = ctx.group({ parent: g, opacity: 0 });
          ctx.text(1000, 660, 'plug into the neuron (click):', { size: 13, font: 'mono', color: 'dim', parent: chipG });
          S.aChips = ['ReLU', 'GELU', 'SiLU'].map(function (k, i) {
            var c = ctx.label(1060 + i * 120, 700, k, { color: ACOL[k], size: 14, w: 100, parent: chipG });
            c.style.cursor = 'pointer';
            c.addEventListener('click', function (ev) { ev.stopPropagation(); S.setAct(k); });
            return c;
          });
          var nt1 = ctx.text(1000, 752, 'linear ∘ linear = linear', { size: 13, font: 'mono', color: 'text', parent: g, opacity: 0 });
          var nt2 = ctx.text(1000, 778, 'depth needs a bend', { size: 13, font: 'mono', color: 'text', parent: g, opacity: 0 });
          var nt3 = ctx.text(1000, 804, 'SiLU gates SwiGLU in LLMs', { size: 13, font: 'mono', color: 'text', parent: g, opacity: 0 });
          S.setAct = function (k) {
            S.act = k;
            S.aChips.forEach(function (c, i) { c.firstChild.setAttribute('fill', ctx.alpha(ACOL[['ReLU', 'GELU', 'SiLU'][i]], ['ReLU', 'GELU', 'SiLU'][i] === k ? 0.5 : 0.12)); });
            S.actN.body.setAttribute('stroke', ctx.C[ACOL[k]]);
            S.update(300);
            setZ(S.z);
          };
          setZ(-4);
          /* beat 0: a linear map cannot bend */
          ctx.reveal(g, { from: 'up' });
          return ctx.wait(600).then(function () {
            return Promise.all([ctx.reveal(S.linLine, { from: 'draw', dur: 900 }), ctx.reveal([nt1, nt2], { from: 'left', stagger: 300, dur: 400 })]);
          }).then(function () { return ctx.reveal(S.linLbl, { dur: 300 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: ReLU */
            ctx.fade([S.linLine, S.linLbl], 0, 400);
            ctx.reveal([S.zMark, S.zTxt, S.dots[0], S.fTxt[0]], { dur: 300, stagger: 0 });
            return ctx.reveal(pl.curve, { from: 'draw', dur: 800 }).then(function () {
              return ctx.tween(1800, function (t) { setZ(-4 + 7 * t); }, 'inOut');
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: GELU and SiLU */
            ctx.reveal([S.dots[1], S.dots[2], S.fTxt[1], S.fTxt[2], nt3], { dur: 300, stagger: 0 });
            return Promise.all([ctx.reveal(gl.curve, { from: 'draw', dur: 800 }), ctx.reveal(sl.curve, { from: 'draw', dur: 800, delay: 300 })]).then(function () {
              return ctx.tween(2200, function (t) { setZ(-4 + 7 * t); }, 'inOut');
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: pick an activation for the neuron */
            ctx.reveal(chipG, { from: 'left', dur: 500 });
            return ctx.tween(800, function (t) { setZ(3 + (S.z - 3) * t); }, 'inOut').then(function () {
              S.setAct('SiLU');
              return ctx.wait(400);
            });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'A hyperplane',
        beats: [
          {
            say: 'Now the geometric view. With two inputs, every point in the plane is one possible input: ice pixels in cyan and rock pixels in orange, described by their cold and glow values.',
            card: { tag: 'KEY IDEA', title: 'Inputs are points', body: 'Two inputs make a plane. Each pixel is one point, and the neuron will draw a line through it.' },
            deep: '<p>Two inputs give a 2-D input space (cold and glow; the warm input is held at 0); the 28 points are synthetic samples, cyan for ice pixels (class 1) and orange for rock pixels (class 0), each drawn from a Gaussian blob. In an LLM the "plane" is the 8,192-dimensional residual stream and each point is one token in one context.</p>' +
              '<p>The neuron from the last two steps has shrunk into the corner; it is the same unit, viewed as a function on this plane.</p>'
          },
          {
            say: 'The neuron computes w dot x plus b. The set where that equals zero is a straight line, a hyperplane in higher dimensions, with the weight vector as its normal. One side fires, the other stays silent.',
            card: { tag: 'HOW IT WORKS', title: 'One neuron, one cut', more: '<p>Write w·x + b = ‖w‖ (ŵ·x) + b with ŵ = w/‖w‖. It is zero exactly when ŵ·x = −b/‖w‖: a plane at that distance from the origin, with normal ŵ. Points on the ŵ side have positive pre-activation.</p>', body: 'w·x + b = 0 is a line. Points on the side w points to fire (green ring); the rest stay silent.' },
            deep: '<div class="eq">H = { x : w·x + b = 0 }, &nbsp; dist(x, H) = (w·x + b) / ‖w‖</div>' +
              '<ul><li>w is the <b>normal</b> of H: it points into the firing half-space.</li>' +
              '<li>The signed distance of a point from H is the neuron’s pre-activation divided by ‖w‖: how far into "fires" or "silent" it lies.</li></ul>'
          },
          {
            say: 'Changing the weights rotates the boundary. Watch it sweep all the way around while its normal, the weight arrow, turns with it.',
            card: { tag: 'HOW IT WORKS', title: 'Weights set the angle', body: 'Rotate w and the boundary turns with it, always perpendicular to w. Its length sets how sharp the switch is.' },
            deep: '<ul><li>‖w‖ sets how sharply the output changes across H (the "temperature" of the unit): doubling w doubles the slope of z across the boundary while leaving the boundary itself where it was.</li>' +
              '<li>In d = 8,192 dimensions, "one side of a hyperplane" is a <b>direction test</b> on the residual stream: the neuron asks "how much of feature w is present?"</li></ul>'
          },
          {
            say: 'Changing the bias slides the boundary without turning it. Together, weights and bias place the line between the icy pixels and the rocky ones, and the counter shows how many points land on the right side.',
            card: { tag: 'HOW IT WORKS', title: 'Bias slides the line', body: 'The offset of H from the origin is −b/‖w‖. A larger b moves the boundary toward the negative side.' },
            deep: '<ul><li>−b/‖w‖ is the signed offset of H from the origin.</li>' +
              '<li>A single neuron can only separate <b>linearly separable</b> sets (XOR is the classic failure, Minsky &amp; Papert 1969). A layer of n neurons carves space with n hyperplanes; the next layer combines the cells — this is how depth builds curved, piecewise-linear decision surfaces (a ReLU net is a piecewise-linear function with up to exponentially many regions).</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut([S.bottom, S.ro], 350, true);
          S.bottom = null; S.ro = null;
          /* shrink the neuron to the top-right corner */
          ctx.transform(S.nd, { x: 1078, y: 90, s: 0.45 }, 900, 'inOut');
          var g = ctx.group();
          ctx.rect(P.x - 20, P.y - 20, P.w + 40, P.h + 60, { rx: 12, fill: 'rgba(7,12,24,0.94)', stroke: ctx.alpha('cyan', 0.4), parent: g });
          ctx.line(P.x, toPx(0, 0).y, P.x + P.w, toPx(0, 0).y, { color: ctx.alpha('white', 0.12), parent: g });
          ctx.line(toPx(0, 0).x, P.y, toPx(0, 0).x, P.y + P.h, { color: ctx.alpha('white', 0.12), parent: g });
          ctx.text(P.x + P.w, P.y + P.h + 22, 'cold (x1) →', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: g });
          ctx.text(P.x + 4, P.y - 9, 'glow (x3) ↑', { size: 12, font: 'mono', color: 'dim', parent: g });
          ctx.text(P.x + P.w - 4, P.y - 9, 'warm (x2) held at 0', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: g });
          S.shade = ctx.poly([[0, 0]], { fill: ctx.alpha('lime', 0.1), parent: g });
          S.bLine = ctx.line(0, 0, 0, 0, { color: 'lime', sw: 2.5, parent: g });
          S.nArrow = ctx.line(0, 0, 0, 0, { color: 'white', sw: 2, arrow: true, parent: g });
          S.nLbl = ctx.text(0, 0, 'w', { size: 14, font: 'mono', weight: 700, color: 'white', parent: g });
          var bg = [S.shade, S.bLine, S.nArrow, S.nLbl];
          bg.forEach(function (e) { e.setAttribute('opacity', 0); });
          var r = ctx.rng(77);
          S.pts = [];
          function gauss() { return (r() + r() + r() - 1.5) * 1.3; }
          for (var i = 0; i < 28; i++) {
            var cls = i % 2, cx = cls ? 1.2 : -1.0, cy = cls ? 1.0 : -0.9;
            var px = cx + gauss() * 0.75, py = cy + gauss() * 0.75;
            px = Math.max(-2.8, Math.min(2.8, px)); py = Math.max(-2.8, Math.min(2.8, py));
            var q = toPx(px, py);
            var el = ctx.circle(q.x, q.y, 7, { fill: cls ? ctx.alpha('cyan', 0.85) : ctx.alpha('orange', 0.85), stroke: cls ? 'cyan' : 'orange', sw: 1, parent: g, opacity: 0 });
            S.pts.push({ x: px, y: py, c: cls, el: el });
          }
          ctx.label(P.x + 70, P.y + P.h + 24, '● ice pixel', { color: 'cyan', size: 11, parent: g });
          ctx.label(P.x + 190, P.y + P.h + 24, '● rock pixel', { color: 'orange', size: 11, parent: g });
          S.plot = g;
          S.drawLine = function (w1, w2, b) {
            var poly = clipHalf(w1, w2, b).map(function (p) { var q = toPx(p[0], p[1]); return q.x.toFixed(1) + ',' + q.y.toFixed(1); }).join(' ');
            S.shade.setAttribute('points', poly || '0,0');
            var bp = boundary(w1, w2, b);
            if (bp.length === 2) {
              var a = toPx(bp[0][0], bp[0][1]), c = toPx(bp[1][0], bp[1][1]);
              S.bLine.setAttribute('x1', a.x); S.bLine.setAttribute('y1', a.y); S.bLine.setAttribute('x2', c.x); S.bLine.setAttribute('y2', c.y);
              var n = Math.sqrt(w1 * w1 + w2 * w2) || 1, m = { x: (bp[0][0] + bp[1][0]) / 2, y: (bp[0][1] + bp[1][1]) / 2 };
              var s = toPx(m.x, m.y), e = toPx(m.x + w1 / n * 0.9, m.y + w2 / n * 0.9);
              S.nArrow.setAttribute('x1', s.x); S.nArrow.setAttribute('y1', s.y); S.nArrow.setAttribute('x2', e.x); S.nArrow.setAttribute('y2', e.y);
              S.nLbl.setAttribute('x', e.x + 8); S.nLbl.setAttribute('y', e.y - 8);
            }
            var ok = 0;
            S.pts.forEach(function (p) {
              var fire = w1 * p.x + w2 * p.y + b > 0;
              if (fire === (p.c === 1)) ok++;
              p.el.setAttribute('stroke-width', fire ? 2.5 : 1);
              p.el.setAttribute('stroke', fire ? ctx.C.lime : (p.c ? ctx.C.cyan : ctx.C.orange));
            });
            return ok;
          };
          /* right panel (beat 1) */
          var rp = ctx.group();
          var c1 = card(ctx, rp, 640, 380, 900, 490, 'lime', 'THE DECISION BOUNDARY');
          S.hTxt = ctx.text(664, 440, '', { size: 18, font: 'mono', weight: 700, color: 'lime', parent: c1 });
          S.accTxt = ctx.text(664, 480, '', { size: 15, font: 'mono', color: 'text', parent: c1 });
          ctx.para(664, 540, ['here w = (w_cold, w_glow), warm held at 0', 'w · x + b = 0  is a line (hyperplane in d dims)', 'w is its normal: it points to the firing side', 'rotate w  → boundary turns', 'change b  → boundary slides (offset −b/|w|)', 'one neuron = one cut; a layer = many cuts;', 'the next layer combines the cells'], { size: 15, font: 'mono', color: 'text', lh: 34, parent: c1 });
          keepWS(c1);
          function setTheta(th, b) {
            var w1 = Math.cos(th) * 1.6, w2 = Math.sin(th) * 1.6;
            var ok = S.drawLine(w1, w2, b);
            S.hTxt.textContent = 'w = (' + fmt(w1) + ', ' + fmt(w2) + ')   b = ' + fmt(b);
            S.accTxt.textContent = 'correctly split: ' + ok + ' / ' + S.pts.length;
          }
          /* beat 0: the input plane and its points */
          return ctx.reveal(g, { from: 'fade', delay: 300 }).then(function () {
            return ctx.reveal(S.pts.map(function (p) { return p.el; }), { from: 'scale', stagger: 25, dur: 300 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the boundary, its normal, the firing side */
            setTheta(-2.6, 0.4);
            swapMain(ctx, S, rp);
            return ctx.reveal(bg, { dur: 500, stagger: 100 }).then(function () { return ctx.pulse(S.accTxt, { color: 'lime', dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: rotating the weights */
            return ctx.tween(3200, function (t) { setTheta(-2.6 + t * (2.6 + Math.PI / 4 + 2 * Math.PI), 0.4); }, 'inOut');
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: sliding the bias */
            return ctx.tween(2200, function (t) { setTheta(Math.PI / 4, 0.4 - 0.4 * t - 0.6 * Math.sin(t * Math.PI)); }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Learning: gradients',
        beats: [
          {
            say: 'Nobody sets these weights by hand. We define a loss that measures how wrong the neuron is, then use calculus. Here the neuron starts from a bad boundary.',
            card: { tag: 'KEY IDEA', title: 'Learning is minimising', body: 'Cross-entropy measures how wrong ŷ is on every point. Training means making that number small.' },
            deep: '<div class="eq">ŷ = σ(w·x + b), &nbsp; L = −[y log ŷ + (1−y) log(1−ŷ)]</div>' +
              '<p>The logistic (sigmoid) output turns z into a probability of "ice". Here: full-batch gradient descent, η = 0.5, 40 iterations from w = (−1, 0.3), b = 0.5, computed live. The starting boundary is deliberately wrong: it sits on the wrong side.</p>'
          },
          {
            say: 'The chain rule gives the gradient of the loss with respect to every weight. For a sigmoid neuron with cross entropy loss, it is simply the error times the input.',
            card: { tag: 'HOW IT WORKS', title: 'Gradient = error × input', more: '<p>σ′(z) = ŷ(1 − ŷ) and ∂L/∂ŷ = (ŷ − y)/(ŷ(1 − ŷ)), so ∂L/∂z = ŷ − y and ∂L/∂w = (ŷ − y)·x. The awkward σ′ cancels. With squared error instead, a saturated wrong neuron (ŷ near 0 or 1) would get a vanishing gradient.</p>', body: 'dL/dw = (ŷ − y)·x. The chain rule collapses to that when a sigmoid meets cross-entropy.' },
            deep: '<div class="eq">∂L/∂w = ∂L/∂ŷ · ∂ŷ/∂z · ∂z/∂w = (ŷ − y)·x, &nbsp; ∂L/∂b = ŷ − y</div>' +
              '<p>The sigmoid–cross-entropy pairing makes the gradient simply <i>error × input</i>: the σ′(z) factor cancels the 1/ŷ terms of the loss derivative, so a confidently wrong neuron gets a large gradient instead of a vanishing one.</p>'
          },
          {
            say: 'Gradient descent then nudges each weight a little in the downhill direction. Watch forty steps: the loss falls, and the line swings into place between the ice and the rock pixels.',
            card: { tag: 'NUMBERS', title: 'Forty small steps', stat: { v: '40', u: 'steps', l: 'of full-batch gradient descent at learning rate 0.5 fix the boundary' } },
            deep: '<div class="eq">w ← w − η · (1/N) Σ<sub>n</sub> (ŷ<sub>n</sub> − y<sub>n</sub>) x<sub>n</sub></div>' +
              '<p>Each step moves against the gradient by η times its size. The logistic loss is convex, so descent cannot get trapped in a local minimum. On separable data like this the loss keeps creeping toward zero as ‖w‖ grows, which is why real systems add regularisation or stop early. Deep networks are not convex, but the same update works remarkably well anyway.</p>'
          },
          {
            say: 'Large language models use exactly this rule at scale: an adaptive optimiser called AdamW, mini batches of millions of tokens, and hundreds of billions of parameters.',
            card: { tag: 'NUMBERS', title: 'Training state is big', stat: { v: '1.1', u: 'TB', l: 'weights plus optimizer state for a 70B model: 16 bytes per parameter' } },
            deep: '<ul><li>LLMs use the same rule at scale: <b>AdamW</b> (per-parameter adaptive steps, decoupled weight decay), mini-batches of millions of tokens, warm-up + cosine/WSD learning-rate schedules, gradient clipping at norm 1.0, BF16 compute with FP32 master weights.</li>' +
              '<li>Optimizer state: Adam keeps 2 extra FP32 moments per parameter → 16 bytes/param with master weights: 1.1 TB for a 70B model, sharded (ZeRO/FSDP) across GPUs.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var X = S.pts.map(function (p) { return [p.x, p.y]; }), Y = S.pts.map(function (p) { return p.c; });
          var w = [-1, 0.3], b = 0.5, eta = 0.5, traj = [];
          function lossAt(w, b) {
            var L = 0;
            X.forEach(function (x, n) { var yh = sigm(w[0] * x[0] + w[1] * x[1] + b); yh = Math.min(1 - 1e-7, Math.max(1e-7, yh)); L -= Y[n] * Math.log(yh) + (1 - Y[n]) * Math.log(1 - yh); });
            return L / X.length;
          }
          for (var it = 0; it <= 40; it++) {
            traj.push({ w: w.slice(), b: b, L: lossAt(w, b) });
            var gw = [0, 0], gb = 0;
            X.forEach(function (x, n) { var e = sigm(w[0] * x[0] + w[1] * x[1] + b) - Y[n]; gw[0] += e * x[0]; gw[1] += e * x[1]; gb += e; });
            w = [w[0] - eta * gw[0] / X.length, w[1] - eta * gw[1] / X.length];
            b -= eta * gb / X.length;
          }
          S.traj = traj;
          var rp = ctx.group();
          var c1 = card(ctx, rp, 640, 380, 900, 490, 'amber', 'GRADIENT DESCENT  (logistic neuron, cross-entropy)');
          var Lmax = traj[0].L;
          var lp = ctx.plot(690, 430, 380, 170, traj.map(function (t, i) { return [i, t.L]; }), { xDomain: [0, 40], yDomain: [0, Lmax * 1.05], color: 'amber', sw: 2.4, parent: c1, xLabel: 'iteration', yLabel: 'loss' });
          S.lossDot = ctx.circle(0, 0, 5, { fill: 'white', parent: c1, glow: true });
          S.itTxt = ctx.text(1110, 440, '', { size: 15, font: 'mono', color: 'white', parent: c1 });
          S.wTxt = ctx.text(1110, 474, '', { size: 14, font: 'mono', color: 'text', parent: c1 });
          S.lTxt = ctx.text(1110, 506, '', { size: 14, font: 'mono', color: 'amber', parent: c1 });
          S.aTxt = ctx.text(1110, 538, '', { size: 14, font: 'mono', color: 'lime', parent: c1 });
          var pl = ['ŷ = σ(w·x + b)          L = cross-entropy(ŷ, y)', 'dL/dw = (ŷ − y) · x     chain rule: dL/dŷ · dŷ/dz · dz/dw', 'w ← w − η · dL/dw       η = 0.5, full batch, 40 steps', 'LLMs: same idea, AdamW on 10^11 params, millions of tokens per step'].map(function (s, i) {
            var t = ctx.text(664, 660 + i * 38, s, { size: 14, font: 'code', color: 'text', parent: c1, opacity: i ? 0 : 1 });
            return t;
          });
          keepWS(c1);
          S.adamNote = ctx.text(664, 830, 'AdamW: 16 B / param → 70B params ≈ 1.1 TB of weights + optimizer state', { size: 13, font: 'mono', color: 'amber', parent: c1, opacity: 0 });
          lp.curve.setAttribute('opacity', 0.25);
          function show(i) {
            var t = traj[i];
            var ok = S.drawLine(t.w[0], t.w[1], t.b);
            var p = lp.toPx(i, t.L);
            S.lossDot.setAttribute('cx', p.x); S.lossDot.setAttribute('cy', p.y);
            S.itTxt.textContent = 'iteration ' + i + ' / 40';
            S.wTxt.textContent = 'w = (' + fmt(t.w[0]) + ', ' + fmt(t.w[1]) + ')  b = ' + fmt(t.b);
            S.lTxt.textContent = 'loss = ' + t.L.toFixed(4);
            S.aTxt.textContent = 'correct = ' + ok + ' / ' + S.pts.length;
          }
          /* beat 0: a bad boundary and its loss */
          swapMain(ctx, S, rp);
          show(0);
          return ctx.wait(700).then(function () { return ctx.pulse(S.lossDot, { color: 'amber', dur: 600 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the gradient of the loss */
            return ctx.reveal(pl[1], { from: 'left', dur: 500 }).then(function () { return ctx.pulse(pl[1], { color: 'amber', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: forty steps of gradient descent */
            ctx.reveal(pl[2], { from: 'left', dur: 500 });
            return ctx.wait(500).then(function () {
              return ctx.tween(4500, function (t) { show(Math.round(t * 40)); }, 'linear');
            }).then(function () {
              ctx.fade(lp.curve, 1, 400);
              return ctx.pulse(S.lossDot, { color: 'amber', dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the same rule at LLM scale */
            ctx.reveal(pl[3], { from: 'left', dur: 500 });
            return ctx.reveal(S.adamNote, { from: 'up', dur: 500, delay: 300 });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Backpropagation',
        beats: [
          {
            say: 'Stack neurons and the same chain rule runs backwards through the whole network. Here is a tiny net with two inputs, two ReLU hidden neurons and one output.',
            card: { tag: 'KEY IDEA', title: 'The chain rule, stacked', body: 'Backpropagation applies the chain rule layer by layer, reusing each layer’s result for the one before.' },
            deep: '<div class="eq">z<sub>j</sub> = Σ<sub>i</sub> W<sub>ji</sub>x<sub>i</sub> + b<sub>j</sub>, &nbsp; h<sub>j</sub> = ReLU(z<sub>j</sub>), &nbsp; ŷ = Σ<sub>j</sub> v<sub>j</sub>h<sub>j</sub> + c, &nbsp; L = ½(ŷ − t)²</div>' +
              '<p>Nine weights and biases (W ∈ ℝ<sup>2×2</sup>, b ∈ ℝ<sup>2</sup>, v ∈ ℝ<sup>2</sup>, c) fully determine the map from x to ŷ. Inputs x = (1.0, 0.5), target t = 1.0.</p>'
          },
          {
            say: 'The forward pass computes activations left to right and a loss against the target. Every hidden value is stored, because the backward pass will need it.',
            card: { tag: 'NUMBERS', title: 'The forward pass', stat: { v: '0.320', l: 'the loss: ŷ = 0.20 against target 1.0 gives L = ½(0.20 − 1)² = 0.32' } },
            deep: '<p>Forward values: z = (0.50, 0.60), h = (0.50, 0.60), ŷ = 0.9·0.5 − 0.5·0.6 + 0.05 = 0.20, L = ½(0.20 − 1.0)² = 0.320.</p>' +
              '<p>Training memory is dominated by these stored activations, which is why <b>activation checkpointing</b> recomputes them in the backward pass instead of storing them.</p>'
          },
          {
            say: 'The backward pass sends the error right to left. At the output the error signal is the prediction minus the target, and each output weight gradient is that signal times the hidden activation feeding it.',
            card: { tag: 'HOW IT WORKS', title: 'Error flows backwards', body: 'δy = ŷ − t = −0.80. Then dL/dv = δy · h: the signal at the output times the value at the input.' },
            deep: '<div class="eq">δ<sub>y</sub> = ŷ − t, &nbsp; ∂L/∂v<sub>j</sub> = δ<sub>y</sub>h<sub>j</sub></div>' +
              '<p>Here δ<sub>y</sub> = 0.20 − 1.0 = −0.80, so ∂L/∂v = (−0.80·0.50, −0.80·0.60) = (−0.40, −0.48). Negative gradients mean: increasing these weights would lower the loss, so a descent step raises them.</p>'
          },
          {
            say: 'The signal keeps travelling to the hidden neurons, passing through the ReLU gate, and every input weight gradient is again the error signal arriving at its output times the activation at its input.',
            card: { tag: 'HOW IT WORKS', title: 'Through the ReLU gate', more: '<p>In matrix form for a layer z = Wx: δ<sub>x</sub> = Wᵀδ<sub>z</sub> flows to the previous layer, and ∂L/∂W = δ<sub>z</sub>xᵀ (an outer product). For a batch X: ∂L/∂W = δᵀX. Each is one GEMM, so the backward pass costs two GEMMs per forward one.</p>', body: 'δz = δh · 1[z > 0]. Both hidden units are active, so the signal passes; a dead unit would block it.' },
            deep: '<div class="eq">δ<sub>j</sub> = δ<sub>y</sub>v<sub>j</sub>·1[z<sub>j</sub>&gt;0], &nbsp; ∂L/∂W<sub>ji</sub> = δ<sub>j</sub>x<sub>i</sub></div>' +
              '<p>δ = (−0.80·0.9, −0.80·(−0.5)) = (−0.72, 0.40). Gradients on the four weights: δ ⊗ x = (−0.72, −0.36; 0.40, 0.20). The indicator 1[z &gt; 0] is exactly why a dead ReLU never learns.</p>' +
              '<p>If z<sub>j</sub> ≤ 0 the gate is closed: δ<sub>j</sub> = 0, none of that unit’s incoming weights gets a gradient this step, and the unit stays silent until its input distribution shifts.</p>'
          },
          {
            say: 'Every number you see is computed exactly. One backward pass costs about twice the forward pass, which is why training costs six times the parameter count in floating point operations per token, against two times for inference.',
            card: { tag: 'NUMBERS', title: 'Backward costs double', stat: { v: '2×', l: 'the forward cost: training ≈ 6N FLOPs per token versus 2N for inference' } },
            deep: '<p><b>Reverse-mode autodiff</b>: one backward pass yields all gradients at ≈ 2× the forward cost (hence 6N FLOPs/token for training vs 2N for inference). It must keep forward activations, which is why training memory is dominated by activations; <b>activation checkpointing</b> recomputes them instead.</p>' +
              '<p>In matrix form a layer’s backward pass is two GEMMs: ∂L/∂W = δᵀX and ∂L/∂X = δW — the same tensor-core workload as the forward pass.</p>' +
              '<p>The six gradients on the stage are what the optimiser consumes next: w ← w − η·g for each weight, moving the prediction from 0.20 toward the target 1.0.</p>' +
              '<details><summary>Go deeper</summary><p>Reverse mode wins because the loss is one scalar and the parameters are billions: one forward and one backward pass give every gradient, where forward mode needs a pass per parameter. The price is storing the activations. Each backward step is a vector–Jacobian product, δ<sub>x</sub> = Wᵀδ<sub>z</sub> and ∂L/∂W = δ<sub>z</sub>xᵀ: the two GEMMs behind the 2× rule.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.plot, 350, true);
          var x = [1.0, 0.5], Wm = [[0.6, -0.4], [0.3, 1.0]], bb = [0.1, -0.2], v = [0.9, -0.5], c = 0.05, tgt = 1.0;
          var z = Wm.map(function (row, j) { return row[0] * x[0] + row[1] * x[1] + bb[j]; });
          var h = z.map(function (q) { return Math.max(0, q); });
          var yh = v[0] * h[0] + v[1] * h[1] + c, L = 0.5 * (yh - tgt) * (yh - tgt);
          var dy = yh - tgt, dv = h.map(function (q) { return dy * q; });
          var dh = v.map(function (q) { return dy * q; }), dz = dh.map(function (q, j) { return z[j] > 0 ? q : 0; });
          var dW = dz.map(function (d) { return [d * x[0], d * x[1]]; });
          var g = ctx.group();
          ctx.rect(60, 180, 1040, 690, { rx: 12, fill: 'rgba(7,12,24,0.94)', stroke: ctx.alpha('cyan', 0.35), parent: g });
          ctx.text(80, 204, 'TINY NET  2 → 2 (ReLU) → 1   target t = 1.0   loss L = ½(ŷ − t)²', { size: 13, font: 'mono', weight: 700, color: 'cyan', parent: g, spacing: 1 });
          var NX = [{ x: 200, y: 330 }, { x: 200, y: 590 }], NH = [{ x: 560, y: 330 }, { x: 560, y: 590 }], NY = { x: 900, y: 460 };
          /* backward-pass text uses a pale magenta: it stays readable when the light theme inverts luminance */
          var MG = ctx.mix('magenta', '#ffffff', 0.5);
          /* edge labels sit on opaque chips centred on the edge, so no link runs through a number */
          function edgeLab(x, y, str, hot) {
            var w = str.length * 7.8 + 16, lg = ctx.group({ parent: g, opacity: hot ? 0 : 1 });
            ctx.rect(x - w / 2, y - 11, w, 22, { rx: 6, fill: '#0a1326', stroke: hot ? ctx.alpha('magenta', 0.8) : ctx.alpha('white', 0.3), sw: 1, parent: lg });
            ctx.text(x, y + 0.5, str, { size: 12, font: 'mono', weight: hot ? 700 : 400, color: hot ? MG : 'text', anchor: 'middle', parent: lg });
            return lg;
          }
          function along(x1, y1, x2, y2, t) { return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }; }
          var edges = [];
          [0, 1].forEach(function (j) {
            [0, 1].forEach(function (i) {
              var x1 = NX[i].x + 40, y1 = NX[i].y, x2 = NH[j].x - 40, y2 = NH[j].y;
              var e = seg(ctx, x1, y1, x2, y2, { stroke: ctx.alpha('white', 0.35), sw: 1.8, parent: g });
              var pa = along(x1, y1, x2, y2, 0.2), pb = along(x1, y1, x2, y2, 0.8);
              edges.push({ e: e, lbl: edgeLab(pa.x, pa.y, 'W' + (j + 1) + (i + 1) + '=' + fmt(Wm[j][i]), false), grad: edgeLab(pb.x, pb.y, 'g=' + fmt(dW[j][i]), true) });
            });
          });
          var vEdges = [0, 1].map(function (j) {
            var x1 = NH[j].x + 40, y1 = NH[j].y, x2 = NY.x - 40, y2 = NY.y;
            var e = seg(ctx, x1, y1, x2, y2, { stroke: ctx.alpha('white', 0.35), sw: 1.8, parent: g });
            var pa = along(x1, y1, x2, y2, 0.28), pb = along(x1, y1, x2, y2, 0.72);
            return { e: e, lbl: edgeLab(pa.x, pa.y, 'v' + (j + 1) + '=' + fmt(v[j]), false), grad: edgeLab(pb.x, pb.y, 'g=' + fmt(dv[j]), true) };
          });
          function neuron(p, col, top, mid) {
            var ng = ctx.group({ parent: g });
            ctx.circle(p.x, p.y, 40, { fill: '#0e1830', stroke: col, sw: 2, parent: ng, glow: true });
            ng.val = ctx.text(p.x, p.y + 1, mid, { size: 15, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: ng });
            ctx.text(p.x, p.y - 54, top, { size: 13, font: 'mono', color: col, anchor: 'middle', parent: ng });
            ng.fw = ctx.text(p.x, p.y + 60, '', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: ng });
            ng.bw = ctx.text(p.x, p.y + 78, '', { size: 12, font: 'mono', weight: 700, color: MG, anchor: 'middle', parent: ng });
            return ng;
          }
          var nx = NX.map(function (p, i) { return neuron(p, 'cyan', 'x' + (i + 1), x[i].toFixed(1)); });
          var nh = NH.map(function (p, j) { return neuron(p, 'orange', 'h' + (j + 1) + ' = ReLU(z' + (j + 1) + ')', '?'); });
          var ny = neuron(NY, 'amber', 'ŷ  (c = ' + fmt(c) + ')', '?');
          var lossN = ctx.node({ x: 1010, y: 460, w: 120, h: 56, title: 'L = ?', color: 'pink', titleSize: 15, parent: g });
          var lEdge = seg(ctx, NY.x + 40, NY.y, 950, 460, { stroke: ctx.alpha('pink', 0.6), sw: 1.8, arrow: true, parent: g });
          nh.forEach(function (n, j) { n.fw.textContent = 'b' + (j + 1) + '=' + fmt(bb[j]); });
          ctx.para(90, 736, ['cyan  = forward values  (stored for the backward pass)', 'magenta = backward error signals δ and weight gradients g = dL/dw', 'g(edge) = δ(at its output) × activation(at its input);  backward ≈ 2× forward FLOPs'], { size: 13, font: 'mono', color: 'text', lh: 30, parent: g });
          S.bpNet = g;
          /* right: chain rule ledger */
          var rp = ctx.group();
          var c1 = card(ctx, rp, 1130, 380, 410, 490, 'magenta', 'CHAIN RULE LEDGER');
          S.ledger = ['forward', 'z = (' + fmt(z[0]) + ', ' + fmt(z[1]) + ')', 'h = (' + fmt(h[0]) + ', ' + fmt(h[1]) + ')', 'ŷ = ' + fmt(yh) + '   L = ' + L.toFixed(3), 'backward', 'δy = ŷ − t = ' + fmt(dy), 'dL/dv = δy·h = (' + fmt(dv[0]) + ', ' + fmt(dv[1]) + ')', 'δh = δy·v = (' + fmt(dh[0]) + ', ' + fmt(dh[1]) + ')', 'δz = δh·1[z>0] (both z > 0)', 'dL/dW = δz ⊗ x   (g on edges)'].map(function (s, k) {
            return ctx.text(1150, 426 + k * 42, s, { size: 14, font: 'mono', weight: (k === 0 || k === 4) ? 700 : 400, color: k < 4 ? (k === 0 ? 'cyan' : 'text') : (k === 4 ? MG : 'text'), parent: c1, opacity: 0 });
          });
          /* beat 0: the tiny network, before any numbers flow */
          swapMain(ctx, S, rp);
          ctx.reveal(g, { from: 'fade', delay: 200 });
          return ctx.wait(900).then(function () {
            return ctx.pulse(nh[0], { color: 'orange', dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: forward pass, activations left to right, then the loss */
            return Promise.all(edges.map(function (q) { return ctx.packet(q.e, { color: 'cyan', dur: 700 }); })).then(function () {
              nh.forEach(function (n, j) { n.val.textContent = h[j].toFixed(2); n.fw.textContent = 'z' + (j + 1) + '=' + fmt(z[j]); });
              ctx.reveal([S.ledger[0], S.ledger[1], S.ledger[2], S.ledger[3]], { from: 'left', stagger: 150, dur: 300 });
              return Promise.all(vEdges.map(function (q) { return ctx.packet(q.e, { color: 'cyan', dur: 600 }); }));
            }).then(function () {
              ny.val.textContent = yh.toFixed(2);
              lossN.titleEl.textContent = 'L = ' + L.toFixed(3);
              return ctx.packet(lEdge, { color: 'pink', dur: 300 });
            }).then(function () { return ctx.pulse(lossN, { color: 'pink', dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the error at the output and the gradients of the output weights */
            ny.bw.textContent = 'δy=' + fmt(dy);
            ctx.reveal([S.ledger[4], S.ledger[5], S.ledger[6]], { from: 'left', stagger: 150, dur: 300 });
            return Promise.all(vEdges.map(function (q) { return ctx.packet(q.e, { color: 'magenta', dur: 700, reverse: true }); })).then(function () {
              vEdges.forEach(function (q) { ctx.reveal(q.grad, { dur: 300 }); });
              return ctx.wait(300);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: through the ReLU gates to the input weights */
            nh.forEach(function (n, j) { n.bw.textContent = 'δz' + (j + 1) + '=' + fmt(dz[j]); });
            ctx.reveal([S.ledger[7], S.ledger[8]], { from: 'left', stagger: 150, dur: 300 });
            return Promise.all(edges.map(function (q) { return ctx.packet(q.e, { color: 'magenta', dur: 700, reverse: true }); })).then(function () {
              edges.forEach(function (q) { ctx.reveal(q.grad, { dur: 300 }); });
              return ctx.wait(300);
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: all gradients are in */
            ctx.reveal(S.ledger[9], { from: 'left', dur: 300 });
            return ctx.wait(300).then(function () { return ctx.pulse(rp, { color: 'magenta', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'A layer is a matmul',
        beats: [
          {
            say: 'Now put many neurons side by side. Each neuron is one row of a weight matrix, so a whole layer computes all its weighted sums at once: a matrix times a vector.',
            card: { tag: 'KEY IDEA', title: 'A layer is a matrix', body: 'Row i of W is neuron i. One matrix–vector product gives every neuron’s weighted sum together.' },
            deep: '<div class="eq">y = φ(Wx + b), &nbsp; W ∈ ℝ<sup>n<sub>out</sub>×n<sub>in</sub></sup></div>' +
              '<p>Here a layer of six neurons reads eight inputs: W is 6 × 8, x has 8 entries, and z = Wx has 6. The highlighted row is neuron n₁; every other neuron is computed the same way, with its own weights.</p>'
          },
          {
            say: 'Watch each row take a dot product with the input to produce one output. Each z is exactly the weighted sum from the first step, computed for six neurons in turn.',
            card: { tag: 'HOW IT WORKS', title: 'Row times vector', body: 'z_i = w_i · x, the same weighted sum as before, once per row. On a GPU, all rows run in parallel.' },
            deep: '<p>Each output z<sub>i</sub> = Σ<sub>k</sub> W<sub>ik</sub>x<sub>k</sub> costs 8 multiply-adds here and 8,192 in the real layer, with no branching: thousands of identical multiply-adds, exactly the workload GPUs are built for.</p>' +
              '<p>Bias b and activation φ are applied element-wise afterwards, usually fused into the same kernel’s epilogue so the pre-activations never round-trip through memory.</p>'
          },
          {
            say: 'Batch many tokens together and the vector becomes a matrix too, so the layer becomes a matrix multiply. That is the operation GPUs are built to do.',
            card: { tag: 'TRADE-OFF', title: 'Batching feeds the GPU', body: 'More tokens per weight read means more FLOPs per byte, turning memory-bound GEMVs into compute-bound GEMMs.' },
            deep: '<div class="eq">Y = φ(X Wᵀ + b), &nbsp; X ∈ ℝ<sup>B×n<sub>in</sub></sup></div>' +
              '<p>GEMM cost: <b>2·B·n<sub>in</sub>·n<sub>out</sub></b> FLOPs; data: (B·n<sub>in</sub> + n<sub>in</sub>·n<sub>out</sub> + B·n<sub>out</sub>) elements. Arithmetic intensity grows with B — batching is what turns memory-bound GEMVs into compute-bound GEMMs.</p>' +
              '<p>For B ≪ n<sub>in</sub>, n<sub>out</sub> the weight matrix dominates the traffic, so intensity ≈ B FLOP/byte in BF16: B = 1 is a bandwidth-bound GEMV, and B in the hundreds crosses the H100 ridge of ≈ 295.</p>'
          },
          {
            say: 'The gate projection of one seventy billion MLP layer is exactly that: eight thousand inputs times twenty eight thousand neurons, about four hundred seventy million floating point operations per token.',
            card: { tag: 'NUMBERS', title: 'One projection', stat: { v: '470 M', u: 'FLOPs', l: 'per token for one 8192 × 28672 projection: 2 × 8,192 × 28,672' } },
            deep: '<table><tr><th>70B MLP, per token</th><th>shape</th><th>FLOPs</th></tr>' +
              '<tr><td>gate W<sub>1</sub></td><td>8192 × 28672</td><td>470 M</td></tr>' +
              '<tr><td>up W<sub>3</sub></td><td>8192 × 28672</td><td>470 M</td></tr>' +
              '<tr><td>down W<sub>2</sub></td><td>28672 × 8192</td><td>470 M</td></tr></table>' +
              '<p>Over 80 layers ≈ 113 GFLOP/token of the ≈ 141 GFLOP total — MLP GEMMs dominate. Prefill with T = 4,096 tokens turns each into a [4096 × 8192]·[8192 × 28672] GEMM: 1.9 TFLOP.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.bpNet, 350, true);
          var g = ctx.group();
          ctx.rect(60, 180, 1040, 690, { rx: 12, fill: 'rgba(7,12,24,0.94)', stroke: ctx.alpha('amber', 0.35), parent: g });
          ctx.text(80, 204, 'A LAYER OF 6 NEURONS   z = W x + b   (each row of W = one neuron)', { size: 13, font: 'mono', weight: 700, color: 'amber', parent: g, spacing: 1 });
          var r = ctx.rng(5);
          var Wv = [], xv = [];
          for (var j = 0; j < 8; j++) xv.push(r() * 2 - 1);
          for (var i = 0; i < 6; i++) { Wv.push([]); for (var k = 0; k < 8; k++) Wv[i].push(r() * 2 - 1); }
          var zv = Wv.map(function (row) { return row.reduce(function (a, w, k) { return a + w * xv[k]; }, 0); });
          var cell = 38, gap = 4;
          var Wm = ctx.matrix(150, 270, 6, 8, { cell: cell, gap: gap, cmap: 'diverge', values: function (a, b) { return Wv[a][b] * 0.9; }, parent: g });
          ctx.text(150 + Wm.w / 2, 250, 'W  (6 × 8)', { size: 14, font: 'mono', color: 'white', anchor: 'middle', parent: g });
          ctx.text(140, 270 + 19, 'n₁', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
          ctx.text(140, 270 + 5 * 42 + 19, 'n₆', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
          ctx.text(520, 400, '×', { size: 30, color: 'dim', anchor: 'middle', parent: g });
          var Xm = ctx.matrix(550, 250, 8, 1, { cell: 30, gap: 4, cmap: 'diverge', values: function (a) { return xv[a]; }, parent: g });
          ctx.text(565, 236, 'x', { size: 14, font: 'mono', color: 'cyan', anchor: 'middle', parent: g });
          ctx.text(620, 400, '=', { size: 30, color: 'dim', anchor: 'middle', parent: g });
          var Zm = ctx.matrix(650, 270, 6, 1, { cell: cell, gap: gap, cmap: 'diverge', values: function () { return 0; }, parent: g });
          ctx.text(669, 250, 'z', { size: 14, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
          ctx.text(730, 400, '→ φ →', { size: 18, font: 'mono', color: 'pink', anchor: 'middle', parent: g });
          var Ym = ctx.matrix(780, 270, 6, 1, { cell: cell, gap: gap, cmap: 'diverge', values: function () { return 0; }, parent: g });
          ctx.text(799, 250, 'y', { size: 14, font: 'mono', color: 'pink', anchor: 'middle', parent: g });
          S.rowHi = ctx.rect(144, 264, Wm.w + 12, cell + 12, { rx: 6, stroke: 'white', sw: 2, parent: g, glow: true });
          S.colHi = ctx.rect(544, 244, 42, 8 * 34 + 8, { rx: 6, stroke: 'cyan', sw: 2, parent: g });
          S.dotTxt = ctx.text(150, 560, '', { size: 14, font: 'mono', color: 'text', parent: g });
          /* batching (beats 2 and 3) */
          var bgp = ctx.group({ parent: g, opacity: 0 });
          ctx.text(80, 620, 'BATCH OF TOKENS → GEMM', { size: 13, font: 'mono', weight: 700, color: 'lime', parent: bgp, spacing: 1 });
          ctx.matrix(100, 650, 4, 8, { cell: 18, gap: 3, cmap: 'cyan', values: function (a, b) { return 0.3 + 0.5 * Math.abs(Math.sin(a * 2 + b)); }, parent: bgp });
          ctx.text(184, 752, 'X  [B × n_in]', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: bgp });
          ctx.text(290, 690, '·', { size: 30, color: 'dim', anchor: 'middle', parent: bgp });
          ctx.matrix(320, 650, 8, 6, { cell: 12, gap: 2, cmap: 'amber', values: function (a, b) { return 0.3 + 0.5 * Math.abs(Math.cos(a + b * 1.3)); }, parent: bgp });
          ctx.text(362, 776, 'Wᵀ [n_in × n_out]', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: bgp });
          ctx.text(440, 690, '=', { size: 26, color: 'dim', anchor: 'middle', parent: bgp });
          ctx.matrix(470, 650, 4, 6, { cell: 18, gap: 3, cmap: 'lime', values: function (a, b) { return 0.3 + 0.5 * Math.abs(Math.sin(a + b)); }, parent: bgp });
          ctx.text(532, 752, 'Y [B × n_out]', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: bgp });
          var bp2 = ctx.para(640, 660, ['FLOPs = 2 · B · n_in · n_out', '70B gate proj: n_in 8192, n_out 28672', '  = 470 MFLOP per token', '  prefill T=4096: 1.9 TFLOP / layer'], { size: 13, font: 'code', color: 'text', lh: 26, parent: bgp, opacity: 0 });
          keepWS(bgp);
          S.mm = g;
          var rp = ctx.group();
          var c1 = card(ctx, rp, 1130, 380, 410, 490, 'amber', 'NEURON → LAYER');
          ctx.para(1150, 430, ['one neuron  = dot(w_i, x) + b_i', 'one layer   = W x + b', 'many tokens = X Wᵀ + b', '', 'neurons are rows of W', 'inputs are columns', 'GPUs love this shape:', 'thousands of identical', 'multiply-adds, no branches'], { size: 14, font: 'code', color: 'text', lh: 34, parent: c1 });
          keepWS(c1);
          function row(i) {
            S.rowHi.setAttribute('y', 264 + i * (cell + gap));
            var terms = Wv[i].slice(0, 3).map(function (w, k) { return '(' + fmt(w) + ')(' + fmt(xv[k]) + ')'; }).join(' + ');
            S.dotTxt.textContent = 'z' + (i + 1) + ' = ' + terms + ' + … = ' + fmt(zv[i]);
            Zm.cells[i][0].setAttribute('fill', ctx.cmap('diverge', Math.tanh(zv[i])));
            Ym.cells[i][0].setAttribute('fill', ctx.cmap('diverge', Math.tanh(ACTS.SiLU(zv[i]))));
          }
          swapMain(ctx, S, rp);
          ctx.reveal(g, { from: 'fade', delay: 200 });
          /* beat 0: W, x, z, y */
          return ctx.wait(900).then(function () { return ctx.pulse(S.rowHi, { color: 'white', dur: 600 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: one dot product per row */
            var chain = ctx.wait(200);
            [0, 1, 2, 3, 4, 5].forEach(function (i) {
              chain = chain.then(function () { row(i); return ctx.pulse(Zm.cells[i][0], { color: 'amber', dur: 420 }); });
            });
            return chain;
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: a batch of tokens, one GEMM */
            return ctx.reveal(bgp, { from: 'up' });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the size of one real projection */
            return ctx.reveal(bp2, { from: 'left', dur: 500 }).then(function () { return ctx.pulse(bp2, { color: 'lime', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Tensor cores',
        beats: [
          {
            say: 'On the GPU, that matrix multiply is cut into tiles. Each thread block owns one output tile, say one hundred twenty eight by one hundred twenty eight.',
            card: { tag: 'KEY IDEA', title: 'Tile the output', body: 'One thread block owns one output tile of C and computes it independently of all the others.' },
            deep: '<div class="eq">C<sub>tile</sub> += Σ<sub>k</sub> A[m-tile, k-slice] · B[k-slice, n-tile]</div>' +
              '<p>A GEMM C = A·B with M, N, K in the thousands launches one CTA (cooperative thread array, or thread block) per output tile, typically 128 × 128 or 128 × 256. Thousands of tiles run concurrently across the 132 SMs of an H100, with no communication between tiles.</p>'
          },
          {
            say: 'It marches along the shared dimension, loading a slice of A and a slice of B into on-chip memory and accumulating into its tile.',
            card: { tag: 'HOW IT WORKS', title: 'March along K', more: '<p>Per K-slice of depth K<sub>s</sub> a 128×128 tile does 2·128·128·K<sub>s</sub> FLOPs and loads (128 + 128)·K<sub>s</sub>·2 bytes: intensity = MN/(M + N) = 64 FLOP/byte. Bigger tiles raise it (128×256 gives 85) but need more registers and shared memory.</p>', body: 'Each step loads one K-slice of A and B on chip and adds their product into the tile: C += A·B.' },
            deep: '<p>Tile intensity: FLOPs 2·M·N·K<sub>s</sub> over bytes (M + N)·K<sub>s</sub>·2 ⇒ <b>MN/(M+N) = 64 FLOP/byte</b> for a 128×128 BF16 tile (85 for 128×256). That is <i>below</i> the H100 HBM ridge (≈ 295), so a large GEMM stays compute-bound only because neighbouring CTAs re-read the same A/B slices from the 50 MB L2 (tile rasterisation / swizzling) and clusters multicast them with TMA; the tile’s intensity only has to beat the much higher L2 and SMEM bandwidth.</p>'
          },
          {
            say: 'Inside the tile, tensor core instructions multiply small fragments of B F sixteen or F P eight inputs and accumulate in thirty two bit floats.',
            card: { tag: 'HOW IT WORKS', title: 'Fragments on tensor cores', body: 'One instruction multiplies a 64×16 by a 16×128 fragment and accumulates in FP32 registers.' },
            deep: '<table><tr><th>GPU</th><th>MMA path</th><th>dense BF16</th><th>dense FP8</th></tr>' +
              '<tr><td>A100</td><td>mma.sync m16n8k16 (warp)</td><td>312 TF</td><td>—</td></tr>' +
              '<tr><td>H100 SXM</td><td>wgmma m64nNk16 (warpgroup), TMA</td><td>989 TF</td><td>1,979 TF</td></tr>' +
              '<tr><td>B200</td><td>tcgen05.mma, accumulators in TMEM</td><td>≈ 2.25 PF</td><td>≈ 4.5 PF</td></tr></table>' +
              '<p>One <code>wgmma.m64n128k16</code> does 2·64·128·16 = 262,144 FLOP per instruction.</p>' +
              '<p>A warpgroup is four warps (128 threads). The two warpgroups in the picture each own 64 rows of the 128×128 tile and issue wgmma asynchronously, so the tensor cores stay busy while TMA prefetches the next K-slice.</p>'
          },
          {
            say: 'Every neuron of every layer we have seen is executed this way, as billions of tiny fragments per token, at nearly a thousand trillion operations per second on one H100.',
            card: { tag: 'NUMBERS', title: 'One H100', stat: { v: '989', u: 'TFLOP/s', l: 'dense BF16 on an H100 SXM; 1,979 in FP8; a B200 reaches ≈ 2.25 PFLOP/s' } },
            deep: '<ul><li>Inputs BF16/FP8 (Blackwell adds FP4/FP6 microscaled formats), accumulation FP32; the epilogue applies bias, activation and down-cast before writing C.</li>' +
              '<li>Pipelines overlap TMA loads of stage k+1 with MMAs of stage k (warp specialisation); FlashAttention and CUTLASS kernels are built this way.</li></ul>' +
              '<p>At 141 GFLOP per token, 60% of one H100’s 989 TFLOP/s corresponds to about 4,000 tokens per second of prefill compute for a 70B model. That is a per-GPU compute budget, not a deployment: the weights need several GPUs, and decode is bound by memory instead (see the LLM chamber).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.mm, 350, true);
          var g = ctx.group();
          ctx.rect(60, 180, 1040, 690, { rx: 12, fill: 'rgba(7,12,24,0.94)', stroke: ctx.alpha('red', 0.4), parent: g });
          ctx.text(80, 204, 'TILED GEMM   C[M×N] = A[M×K] · B[K×N]   one CTA per 128×128 C tile', { size: 13, font: 'mono', weight: 700, color: 'red', parent: g, spacing: 1 });
          var T = 36, CX = 300, CY = 420, KS = 4, KW = 30;
          /* B on top (K x N), A on left (M x K), C grid 8x8 */
          S.Bt = [];
          for (var kk = 0; kk < KS; kk++) {
            S.Bt.push([]);
            for (var c = 0; c < 8; c++) S.Bt[kk].push(ctx.rect(CX + c * T, CY - 18 - (KS - kk) * (KW + 2), T - 2, KW, { rx: 2, fill: ctx.alpha('amber', 0.15), stroke: ctx.alpha('amber', 0.4), sw: 0.8, parent: g }));
          }
          S.At = [];
          for (var rr = 0; rr < 8; rr++) {
            S.At.push([]);
            for (var k2 = 0; k2 < KS; k2++) S.At[rr].push(ctx.rect(CX - 18 - (KS - k2) * (KW + 2), CY + rr * T, KW, T - 2, { rx: 2, fill: ctx.alpha('cyan', 0.15), stroke: ctx.alpha('cyan', 0.4), sw: 0.8, parent: g }));
          }
          S.Ct = [];
          for (var r3 = 0; r3 < 8; r3++) {
            S.Ct.push([]);
            for (var c3 = 0; c3 < 8; c3++) S.Ct[r3].push(ctx.rect(CX + c3 * T, CY + r3 * T, T - 2, T - 2, { rx: 2, fill: ctx.alpha('lime', 0.06), stroke: ctx.alpha('lime', 0.3), sw: 0.8, parent: g }));
          }
          ctx.text(CX + 4 * T, CY - 18 - KS * (KW + 2) - 14, 'B  (K × N), K split into slices', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
          ctx.text(CX - 18 - KS * (KW + 2) / 2, CY + 8 * T + 20, 'A (M × K)', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: g });
          ctx.text(CX + 4 * T, CY + 8 * T + 20, 'C  (M × N)  8 × 8 tiles', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: g });
          var TR = 2, TC = 5;
          S.tileHi = ctx.rect(CX + TC * T - 3, CY + TR * T - 3, T + 4, T + 4, { rx: 4, stroke: 'white', sw: 2.2, parent: g, glow: true, opacity: 0 });
          S.kTxt = ctx.text(CX, CY + 8 * T + 48, '', { size: 13, font: 'mono', color: 'white', parent: g });
          /* inside one tile (beat 2) */
          var ig = ctx.group({ parent: g, opacity: 0 });
          var IX = 680, IY = 300, IS = 300;
          ctx.text(IX + IS / 2, IY - 16, 'inside the 128×128 tile (1 CTA)', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: ig });
          ctx.rect(IX, IY, IS, IS, { rx: 6, fill: ctx.alpha('lime', 0.05), stroke: 'lime', sw: 1.6, parent: ig });
          S.frag = [];
          for (var fr = 0; fr < 8; fr++) {
            S.frag.push([]);
            for (var fc = 0; fc < 4; fc++) {
              var wgc = fr < 4 ? 'lime' : 'teal';
              S.frag[fr].push(ctx.rect(IX + 6 + fc * 72, IY + 6 + fr * 36, 68, 32, { rx: 3, fill: ctx.alpha(wgc, 0.1), stroke: ctx.alpha(wgc, 0.4), sw: 0.8, parent: ig }));
            }
          }
          ctx.text(IX + IS + 10, IY + 75, 'warpgroup 0', { size: 11, font: 'mono', color: 'lime', parent: ig });
          ctx.text(IX + IS + 10, IY + 93, 'rows 0–63', { size: 11, font: 'mono', color: 'dim', parent: ig });
          ctx.text(IX + IS + 10, IY + 219, 'warpgroup 1', { size: 11, font: 'mono', color: 'teal', parent: ig });
          ctx.text(IX + IS + 10, IY + 237, 'rows 64–127', { size: 11, font: 'mono', color: 'dim', parent: ig });
          ctx.para(IX, IY + IS + 30, ['each row of cells = 1 warp: a 16×128 FP32 slice', 'wgmma.m64n128k16  BF16 × BF16 → FP32', '2·64·128·16 = 262,144 FLOP / instruction', 'accumulators in registers (TMEM on B200)'], { size: 12, font: 'mono', color: 'text', lh: 21, parent: ig });
          ctx.path('M' + (CX + TC * T + T) + ',' + (CY + TR * T) + ' L' + IX + ',' + IY, { stroke: ctx.alpha('white', 0.35), dash: '3 5', parent: ig });
          ctx.path('M' + (CX + TC * T + T) + ',' + (CY + TR * T + T) + ' L' + IX + ',' + (IY + IS), { stroke: ctx.alpha('white', 0.35), dash: '3 5', parent: ig });
          S.tc = g;
          var rp = ctx.group();
          var c1 = card(ctx, rp, 1130, 380, 410, 490, 'red', 'THE HARDWARE VIEW');
          ctx.para(1150, 430, ['HBM → SMEM: TMA loads', 'A-slice and B-slice', 'SMEM → tensor cores:', 'MMA on fragments', 'FP32 accumulate in regs', 'epilogue: +b, φ, cast', '', 'H100: 989 TF BF16 dense', '      1979 TF FP8 dense', 'B200: ≈ 2.25 PF BF16'], { size: 14, font: 'code', color: 'text', lh: 32, parent: c1 });
          keepWS(c1);
          rp.setAttribute('opacity', 0);
          function kstep(k) {
            for (var q = 0; q < KS; q++) {
              S.At[TR][q].setAttribute('fill', ctx.alpha('cyan', q === k ? 0.7 : (q < k ? 0.35 : 0.15)));
              S.Bt[q][TC].setAttribute('fill', ctx.alpha('amber', q === k ? 0.7 : (q < k ? 0.35 : 0.15)));
            }
            S.Ct[TR][TC].setAttribute('fill', ctx.alpha('lime', 0.15 + 0.2 * (k + 1)));
            S.kTxt.textContent = 'k-slice ' + (k + 1) + ' / ' + KS + ':  C_tile += A_slice · B_slice';
            S.frag.forEach(function (rowF, fr2) { rowF.forEach(function (f, fc2) { f.setAttribute('fill', ctx.alpha(fr2 < 4 ? 'lime' : 'teal', 0.08 + 0.1 * (k + 1))); }); });
          }
          if (S.main) ctx.fadeOut(S.main, 350, true);
          S.main = null;
          /* beat 0: C is a grid of tiles, one tile picked out */
          ctx.reveal(g, { from: 'fade', delay: 200 });
          return ctx.wait(900).then(function () {
            ctx.reveal(S.tileHi, { dur: 400 });
            return ctx.pulse(S.Ct[TR][TC], { color: 'white', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: march along K, accumulating */
            var chain = ctx.wait(200);
            [0, 1, 2, 3].forEach(function (k) {
              chain = chain.then(function () { kstep(k); return ctx.pulse(S.Ct[TR][TC], { color: 'lime', dur: 500 }); });
            });
            return chain;
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: inside the tile, tensor-core fragments */
            ctx.reveal(ig, { from: 'right', dur: 500 });
            return ctx.wait(500).then(function () {
              return ctx.camera(IX + IS / 2 + 40, IY + IS / 2 + 30, 1.6, 900);
            }).then(function () {
              return ctx.tween(1800, function (t) {
                var n = Math.floor(t * 32);
                S.frag.forEach(function (rowF, fr2) { rowF.forEach(function (f, fc2) { var idx = fr2 * 4 + fc2; f.setAttribute('stroke', idx === n ? ctx.C.white : ctx.alpha(fr2 < 4 ? 'lime' : 'teal', 0.4)); }); });
              }, 'linear');
            }).then(function () {
              S.frag.forEach(function (rowF, fr2) { rowF.forEach(function (f) { f.setAttribute('stroke', ctx.alpha(fr2 < 4 ? 'lime' : 'teal', 0.4)); }); });
              return ctx.camera(null, null, null, 800);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the hardware view */
            swapMain(ctx, S, rp);
            return ctx.wait(600).then(function () { return ctx.pulse(rp, { color: 'red', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Polysemantic neurons',
        beats: [
          {
            say: 'Finally, what do real neurons in a language model mean? Usually, many things at once. One MLP neuron might fire on icy landscapes, on HTML tags, and on Korean text.',
            card: { tag: 'PITFALL', title: 'Neurons are not concepts', body: 'Reading one neuron as one concept fails: it fires for ice, markup and Korean. Its activation has no single meaning.' },
            deep: '<p>Real MLP neurons are frequently <b>polysemantic</b>: they respond to several unrelated features. Interpretability work on vision and language models finds this everywhere; a neuron that fires on both ice and HTML has no clean story to tell.</p>' +
              '<p class="muted">Activations shown are illustrative (layer 40, neuron #16 of a 70B-class model).</p>'
          },
          {
            say: 'This happens because of superposition: the model stores more features than it has neurons, as overlapping directions, so a single neuron ends up taking part in several features.',
            card: { tag: 'KEY IDEA', title: 'Superposition', body: 'n features ≫ d neurons, stored as nearly orthogonal directions. The neuron basis is not the feature basis.' },
            deep: '<ul><li><b>Superposition</b>: n features ≫ d neurons, stored as nearly orthogonal directions, so the neuron basis is not the feature basis → polysemantic neurons.</li>' +
              '<li>It works because real features are sparse: rarely active at the same time, so the interference between overlapping directions is small on average (Elhage et al. 2022).</li></ul>'
          },
          {
            say: 'Sparse autoencoders untangle this. They learn a much wider dictionary of features, only a few active at a time, that reconstructs the layer’s activations.',
            card: { tag: 'HOW IT WORKS', title: 'Sparse autoencoder', more: '<p>Three ways to enforce sparsity: an L1 penalty (shrinks activations, biasing them low), TopK (keep exactly the k largest, no shrinkage; OpenAI 2024) and JumpReLU (learned per-feature thresholds; Gemma Scope). Reconstruction error versus L0 is the trade-off curve used to compare SAEs.</p>', body: 'A wide, sparse code f that reconstructs x. Sparsity keeps only tens of features active per token.' },
            deep: '<div class="eq">f = ReLU(W<sub>e</sub>(x − b<sub>d</sub>) + b<sub>e</sub>), &nbsp; x̂ = W<sub>d</sub>f + b<sub>d</sub>, &nbsp; L = ‖x − x̂‖² + λ‖f‖<sub>1</sub></div>' +
              '<p>Dictionary width 16× to 1000s× d; typical L0 (active features per token): tens. The L1 penalty (or a TopK / JumpReLU activation) pushes most features to zero, so each input is explained by a handful of directions.</p>' +
              '<details><summary>Go deeper</summary><p>Decoder columns are held at unit norm, otherwise the L1 penalty could be cheated by shrinking f and inflating W<sub>d</sub>. Quality is a frontier: reconstruction error against L0, the average number of active features. L1 also shrinks activations, which TopK and JumpReLU avoid.</p></details>'
          },
          {
            say: 'Those features tend to be monosemantic: one for ice and frost, one for markup, one for Korean script. Each fires cleanly on its own kind of context.',
            card: { tag: 'NUMBERS', title: 'Features at scale', stat: { v: '34 M', u: 'features', l: 'in the largest SAE on Claude 3 Sonnet (Templeton et al. 2024)' } },
            deep: '<ul><li><b>SAEs at scale</b>: Anthropic trained 1M/4M/34M-feature SAEs on Claude 3 Sonnet; OpenAI a 16M-latent TopK SAE on GPT-4; Gemma Scope released JumpReLU SAEs for every layer of Gemma 2 2B and 9B.</li>' +
              '<li>Features are causal handles: clamping an "ice" feature steers generations; used for auditing and safety of agent models.</li></ul>' +
              '<p class="muted">Feature numbers and activations shown are illustrative.</p>'
          },
          {
            say: 'Transcoders do the same for whole MLP layers, replacing them with sparse features so that circuits become traceable from input to output.',
            card: { tag: 'STATE OF THE ART', title: 'Transcoders and circuits', body: 'Cross-layer transcoders give linear feature-to-feature edges, so whole computations become attribution graphs.' },
            deep: '<p><b>Transcoders / cross-layer transcoders</b> approximate an MLP’s <i>output</i> from its <i>input</i> through sparse features, giving linear, input-independent feature-to-feature edges → attribution graphs of whole computations (Circuit Tracing, 2025; Dunefsky et al. 2024).</p>' +
              '<p>This closes the loop of the whole chamber: a neuron computes a weighted sum, layers are matrix multiplies, and interpretability recovers the sparse features a network actually thinks in.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.tc, 350, true);
          var g = ctx.group();
          ctx.rect(60, 180, 1040, 690, { rx: 12, fill: 'rgba(7,12,24,0.94)', stroke: ctx.alpha('pink', 0.4), parent: g });
          ctx.text(80, 204, 'ONE MLP NEURON (layer 40, #16) ACROSS CONTEXTS   →   SAE FEATURES', { size: 13, font: 'mono', weight: 700, color: 'pink', parent: g, spacing: 1 });
          var ctxs = ['"…a glowing ice moon"', '"frozen lake at dawn"', '"<div class=nav>"', '"한국어 문장"', '"fox fur in the wind"', '"see 42 U.S.C. § 1983"'];
          var neuronAct = [0.92, 0.78, 0.81, 0.66, 0.12, 0.05];
          var feats = [['F#1203  ice / frost', 'cyan', [0.95, 0.88, 0.0, 0.0, 0.05, 0.0]], ['F#77410  HTML markup', 'amber', [0.0, 0.0, 0.93, 0.0, 0.0, 0.02]], ['F#9002  Korean script', 'violet', [0.0, 0.0, 0.0, 0.9, 0.0, 0.0]]];
          var gN = ctx.group({ parent: g, opacity: 0 });
          ctx.text(80, 236, 'context', { size: 12, font: 'mono', color: 'dim', parent: gN });
          ctx.text(340, 236, 'neuron #16', { size: 12, font: 'mono', color: 'orange', parent: gN });
          S.nBars = [];
          ctxs.forEach(function (s, i) {
            var y = 268 + i * 40;
            var t = ctx.text(80, y, s, { size: 13, font: 'mono', color: 'text', parent: gN });
            t.style.fontVariantLigatures = 'none';
            ctx.rect(340, y - 10, 140, 20, { rx: 3, fill: 'rgba(255,255,255,0.04)', parent: gN });
            S.nBars.push([ctx.rect(340, y - 10, 0, 20, { rx: 3, fill: ctx.alpha('orange', 0.7), parent: gN }), 140 * neuronAct[i]]);
          });
          var polyTxt = ctx.text(80, 518, 'polysemantic: fires on ice AND markup AND Korean', { size: 13, font: 'mono', weight: 700, color: 'orange', parent: g, opacity: 0 });
          /* SAE diagram (beat 2) */
          var sg = ctx.group({ parent: g, opacity: 0 });
          ctx.text(850, 244, 'SAE on the MLP activation', { size: 12, font: 'mono', weight: 700, color: 'pink', parent: sg });
          ctx.matrix(560, 260, 10, 1, { cell: 14, gap: 3, cmap: 'diverge', values: function (a) { return Math.sin(a * 1.9) * 0.8; }, parent: sg });
          ctx.text(567, 440, 'x', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: sg });
          ctx.poly([[590, 262], [680, 225], [680, 455], [590, 425]], { fill: ctx.alpha('pink', 0.15), stroke: 'pink', parent: sg });
          ctx.text(635, 342, 'W_e', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: sg });
          S.fRow = ctx.matrix(690, 222, 24, 1, { cell: 7.5, gap: 2, cmap: 'lime', values: function () { return 0.04; }, parent: sg });
          ctx.text(700, 466, 'f: 2^20+ features', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: sg });
          ctx.poly([[710, 225], [800, 262], [800, 425], [710, 455]], { fill: ctx.alpha('pink', 0.15), stroke: 'pink', parent: sg });
          ctx.text(755, 342, 'W_d', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: sg });
          ctx.matrix(810, 260, 10, 1, { cell: 14, gap: 3, cmap: 'diverge', values: function (a) { return Math.sin(a * 1.9) * 0.75; }, parent: sg });
          ctx.text(817, 440, 'x̂', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: sg });
          var sp = ctx.para(850, 280, ['L = |x − x̂|²', '  + λ |f|₁', '', 'few features', 'active at once'], { size: 13, font: 'code', color: 'text', lh: 24, parent: sg });
          keepWS(sg);
          /* feature bars (beat 3) */
          var gF = ctx.group({ parent: g, opacity: 0 });
          S.fBars = [];
          feats.forEach(function (f, fi) {
            var x0 = 90 + fi * 330, y0 = 560;
            var fc = ctx.group({ parent: gF });
            ctx.rect(x0 - 10, y0, 310, 280, { rx: 8, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha(f[1], 0.5), parent: fc });
            ctx.text(x0 + 4, y0 + 22, f[0], { size: 13, font: 'mono', weight: 700, color: f[1], parent: fc });
            f[2].forEach(function (v, i) {
              var y = y0 + 58 + i * 36;
              ctx.text(x0 + 4, y, ['ice moon', 'frozen lake', '<div>', 'Korean', 'fox fur', 'U.S.C. §'][i], { size: 12, font: 'mono', color: 'dim', parent: fc }).style.fontVariantLigatures = 'none';
              ctx.rect(x0 + 120, y - 9, 160, 18, { rx: 3, fill: 'rgba(255,255,255,0.04)', parent: fc });
              S.fBars.push([ctx.rect(x0 + 120, y - 9, 0, 18, { rx: 3, fill: ctx.alpha(f[1], 0.75), parent: fc }), 160 * v]);
            });
          });
          /* transcoder note (beat 4) */
          var tcLbl = ctx.label(835, 500, 'transcoder: MLP input → sparse features → MLP output', { color: 'amber', size: 12, parent: g, opacity: 0 });
          S.sae = g;
          var rp = ctx.group();
          var c1 = card(ctx, rp, 1130, 380, 410, 490, 'pink', 'FROM NEURONS TO FEATURES');
          var cA = ctx.para(1150, 430, ['neurons: the basis the', 'hardware computes in', 'features: the basis the', 'model thinks in'], { size: 14, font: 'code', color: 'text', lh: 32, parent: c1, opacity: 0 });
          var cB = ctx.para(1150, 590, ['SAE: wide, sparse,', 'reconstructs x'], { size: 14, font: 'code', color: 'text', lh: 32, parent: c1, opacity: 0 });
          var cC = ctx.para(1150, 676, ['transcoder: replaces the', 'MLP, gives circuit edges', '', 'monosemantic handles', 'for audit and steering'], { size: 14, font: 'code', color: 'text', lh: 32, parent: c1, opacity: 0 });
          keepWS(c1);
          swapMain(ctx, S, rp);
          var lit = [3, 9, 17];
          /* beat 0: one neuron, many contexts */
          ctx.reveal(g, { from: 'fade', delay: 200 });
          ctx.reveal(gN, { dur: 400, delay: 400 });
          return ctx.wait(800).then(function () {
            return Promise.all(S.nBars.map(function (b, i) { return ctx.animate(b[0], { width: [0, b[1]] }, 600, 'out', i * 120); }));
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: superposition makes neurons polysemantic */
            ctx.reveal(cA, { from: 'left', dur: 500 });
            return ctx.reveal(polyTxt, { from: 'up', dur: 500 }).then(function () {
              return Promise.all([0, 1, 2, 3].map(function (i) { return ctx.pulse(S.nBars[i][0], { color: 'orange', dur: 600 }); }));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: a sparse autoencoder */
            ctx.reveal(sg, { from: 'up', dur: 500 });
            ctx.reveal(cB, { from: 'left', dur: 500, delay: 300 });
            return ctx.wait(600).then(function () {
              return ctx.tween(800, function (t) {
                lit.forEach(function (k) { S.fRow.cells[k][0].setAttribute('fill', ctx.cmap('lime', 0.04 + 0.9 * t)); });
              }, 'out');
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: monosemantic features */
            ctx.reveal(gF, { from: 'up', dur: 400 });
            return ctx.wait(300).then(function () {
              return Promise.all(S.fBars.map(function (b, i) { return ctx.animate(b[0], { width: [0, b[1]] }, 600, 'out', (i % 6) * 90 + Math.floor(i / 6) * 250); }));
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: transcoders make circuits traceable */
            ctx.reveal(cC, { from: 'left', dur: 500 });
            ctx.reveal(tcLbl, { from: 'down', dur: 500 });
            return ctx.wait(400).then(function () { return ctx.pulse(S.nd, { color: 'amber', dur: 700, parent: S.nd }); });
          });
        }
      }
    ]
  });
})();
