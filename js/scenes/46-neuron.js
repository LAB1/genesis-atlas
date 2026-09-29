/* L3 — A Single Neuron. Weighted sum + bias + nonlinearity, the hyperplane view, gradient descent, backprop
 * through a tiny net, from neuron to layer (matmul) to tensor-core tiles, and polysemantic neurons vs SAE features. */
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
      'McCulloch &amp; Pitts, 1943; Rosenblatt, <i>The Perceptron</i>, Psychological Review 1958',
      'Rumelhart, Hinton &amp; Williams, <i>Learning Representations by Back-propagating Errors</i>, Nature 1986',
      'Hendrycks &amp; Gimpel, <i>Gaussian Error Linear Units (GELUs)</i>, 2016; Ramachandran et al., <i>Searching for Activation Functions</i> (Swish/SiLU), 2017',
      'NVIDIA, <i>H100 Tensor Core GPU Architecture</i> whitepaper, 2022; <i>CUTLASS</i> / PTX ISA docs (mma, wgmma, tcgen05); Blackwell architecture brief, 2024',
      'Elhage et al., <i>Toy Models of Superposition</i>, 2022; Bricken et al., <i>Towards Monosemanticity</i>, Anthropic 2023',
      'Templeton et al., <i>Scaling Monosemanticity</i>, Anthropic 2024; Gao et al., <i>Scaling and Evaluating Sparse Autoencoders</i>, OpenAI 2024; Lieberum et al., <i>Gemma Scope</i>, 2024',
      'Dunefsky et al., <i>Transcoders Find Interpretable LLM Feature Circuits</i>, NeurIPS 2024; Ameisen et al., <i>Circuit Tracing: Revealing Computational Graphs in Language Models</i>, Anthropic 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Weighted sum',
        say: 'Here is the atom of every model in this system: one artificial neuron. It receives numbers from the previous layer, multiplies each by a learned weight, adds them up with a bias, and passes the sum through a nonlinearity. Imagine this one detects an icy surface in the fox trailer: cold pushes it up, warm pushes it down, glow helps. Click the input circles to change their values and watch the weighted sum and the output respond.',
        deep: '<div class="eq">z = Σ<sub>i</sub> w<sub>i</sub>x<sub>i</sub> + b = w·x + b, &nbsp;&nbsp; y = φ(z)</div>' +
          '<ul><li><b>Weights</b> w<sub>i</sub> scale evidence; sign says excitatory (orange) or inhibitory (blue). <b>Bias</b> b shifts the threshold.</li>' +
          '<li>Cost: n multiply–adds (2n FLOPs) for n inputs. An MLP neuron in a 70B LLM has n = 8,192 inputs; a gate neuron reads the whole residual stream.</li>' +
          '<li>Historical lineage: McCulloch–Pitts threshold unit (1943) → Rosenblatt perceptron (1958) with a learning rule → differentiable units trained by backprop (1986).</li>' +
          '<li>Numbers here: w = (0.8, −0.5, 1.2), b = −0.3, φ = ReLU until you pick another activation in the next step.</li></ul>' +
          '<div class="note">Interactive: click x1, x2, x3 to cycle their value through 0 → 0.5 → 1.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.x = [1, 0, 1];
          S.act = 'ReLU';
          S.nd = ctx.group();
          var D = S.nd;
          S.edges = [];
          S.wl = [];
          IN_Y.forEach(function (y, i) {
            var col = W0[i] >= 0 ? 'orange' : 'blue';
            var e = ctx.line(IN_X + 32, y, SIG.x - 44, SIG.y, { color: col, sw: 1.5 + Math.abs(W0[i]) * 4, parent: D });
            S.edges.push(e);
            var mx = (IN_X + 32 + SIG.x - 44) / 2, my = (y + SIG.y) / 2;
            S.wl.push(ctx.label(mx, my - 18, 'w' + (i + 1) + ' = ' + fmt(W0[i]), { color: col, size: 12, parent: D }));
          });
          S.ins = IN_Y.map(function (y, i) {
            var g = ctx.group({ parent: D });
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
          S.sum = ctx.group({ parent: D });
          ctx.circle(SIG.x, SIG.y, 44, { fill: '#101b33', stroke: 'amber', sw: 2.2, parent: S.sum, glow: true });
          ctx.text(SIG.x, SIG.y + 2, 'Σ', { size: 30, color: 'amber', anchor: 'middle', weight: 700, parent: S.sum });
          ctx.line(SIG.x, 530, SIG.x, SIG.y + 48, { color: 'amber', arrow: true, parent: D });
          ctx.label(SIG.x, 546, 'b = ' + fmt(B0), { color: 'amber', size: 12, parent: D });
          S.actN = ctx.node({ x: ACT.x, y: ACT.y, w: 120, h: 64, title: 'ReLU', sub: 'φ(z)', color: 'orange', titleSize: 17, subSize: 12, parent: D });
          S.l1 = ctx.line(SIG.x + 46, SIG.y, ACT.x - 64, ACT.y, { color: 'amber', arrow: true, sw: 2, parent: D });
          S.zLbl = ctx.label((SIG.x + ACT.x) / 2 - 8, SIG.y - 24, 'z', { color: 'amber', size: 12, w: 92, parent: D });
          S.l2 = ctx.line(ACT.x + 62, ACT.y, OUT.x - 38, OUT.y, { color: 'orange', arrow: true, sw: 2, parent: D });
          S.outC = ctx.circle(OUT.x, OUT.y, 36, { fill: ctx.alpha('orange', 0.2), stroke: 'orange', sw: 2.2, parent: D, glow: true });
          S.outT = ctx.text(OUT.x, OUT.y + 1, '', { size: 18, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: D });
          ctx.text(OUT.x, OUT.y + 56, 'y = φ(z)', { size: 13, font: 'mono', color: 'orange', anchor: 'middle', parent: D });
          ctx.text(OUT.x, OUT.y - 54, '"icy surface"', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: D });

          /* live readout */
          S.ro = card(ctx, null, 1090, 190, 450, 380, 'amber', 'LIVE COMPUTATION');
          S.roL = [0, 1, 2, 3, 4, 5, 6].map(function (k) { return ctx.text(1110, 240 + k * 42, '', { size: 15, font: 'mono', color: 'text', parent: S.ro }); });
          keepWS(S.ro);
          S.update = function (ms) {
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
            S.roL[5].textContent = z > 0 ? 'fires: evidence for "icy surface"' : 'silent: below threshold';
            S.roL[6].textContent = 'cost: 3 multiply-adds = 6 FLOPs';
            S.roL[5].setAttribute('fill', z > 0 ? ctx.C.lime : ctx.C.dim);
            return ctx.pulse(S.outC, { color: 'orange', dur: ms || 300 });
          };
          S.update(0);
          S.bottom = card(ctx, null, 60, 612, 1480, 260, 'cyan', 'THE NEURON AS A FEATURE DETECTOR');
          ctx.para(80, 662, ['inputs  = activations of the previous layer (here: cold, warm, glow evidence)', 'weights = learned relevance of each input;  sign = excite / inhibit', 'bias    = learned threshold;  z > 0 means "enough evidence"', 'output  = a new, more abstract feature for the next layer to read', 'in an LLM MLP: 8,192 inputs per neuron, 28,672 neurons per layer, 80 layers'], { size: 15, font: 'mono', color: 'text', lh: 38, parent: S.bottom });
          keepWS(S.bottom);
          ctx.reveal(D, { from: 'fade', dur: 600 });
          ctx.reveal(S.ro, { from: 'right', delay: 300 });
          ctx.reveal(S.bottom, { from: 'up', delay: 500 });
          return ctx.wait(900).then(function () {
            return Promise.all(S.edges.map(function (e, i) { return ctx.packet(e, { color: W0[i] >= 0 ? 'orange' : 'blue', dur: 700 }); }));
          }).then(function () {
            ctx.pulse(S.sum, { color: 'amber', dur: 500 });
            return ctx.packet(S.l1, { color: 'amber', dur: 400 });
          }).then(function () {
            return ctx.packet(S.l2, { color: 'orange', dur: 400 });
          }).then(function () {
            S.x = [1, 0.5, 1];
            return S.update(400);
          }).then(function () { return ctx.wait(500); }).then(function () {
            S.x = [1, 0, 1];
            return S.update(400);
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Nonlinearity',
        say: 'Why the nonlinearity? Stack any number of purely linear layers and you still get one linear map. The activation function bends space, and that is what lets depth build complex functions. ReLU simply clips negatives to zero. GELU and SiLU are smooth cousins that let small negative values leak through; SiLU is the gate inside the SwiGLU layers of modern language models. Click an activation to plug it into the neuron.',
        deep: '<div class="eq">ReLU(z) = max(0, z)</div>' +
          '<div class="eq">GELU(z) = z·Φ(z) ≈ ½z(1 + tanh(√(2/π)(z + 0.044715 z³)))</div>' +
          '<div class="eq">SiLU(z) = z·σ(z) = z / (1 + e<sup>−z</sup>)</div>' +
          '<ul><li><b>Why nonlinear</b>: W<sub>2</sub>(W<sub>1</sub>x) = (W<sub>2</sub>W<sub>1</sub>)x — without φ, depth collapses to one matrix. With φ, a 2-layer MLP is a universal approximator.</li>' +
          '<li><b>ReLU</b>: cheap, sparse, but zero gradient for z &lt; 0 ("dead" units). <b>GELU</b>: BERT/GPT-2/3 era. <b>SiLU/Swish</b>: smooth, non-monotonic dip (min ≈ −0.28 at z ≈ −1.28), used as the gate in SwiGLU (Llama, Qwen, DeepSeek).</li>' +
          '<li>Derivatives: ReLU′ ∈ {0,1}; SiLU′(z) = σ(z)(1 + z(1 − σ(z))). Backprop needs these at every neuron.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.bottom, 300, true);
          var g = card(ctx, null, 60, 612, 1480, 260, 'pink', 'ACTIVATION FUNCTIONS  φ(z)');
          S.bottom = g;
          var pl = ctx.plot(120, 648, 560, 200, ACTS.ReLU, { xDomain: [-4, 3], yDomain: [-0.6, 3], color: 'orange', sw: 2.4, parent: g, xLabel: 'z', yLabel: '' });
          var gl = ctx.plot(120, 648, 560, 200, ACTS.GELU, { xDomain: [-4, 3], yDomain: [-0.6, 3], color: 'violet', sw: 2.4, parent: g, axes: false });
          var sl = ctx.plot(120, 648, 560, 200, ACTS.SiLU, { xDomain: [-4, 3], yDomain: [-0.6, 3], color: 'pink', sw: 2.4, parent: g, axes: false });
          var z0 = pl.toPx(0, 0);
          ctx.line(120, z0.y, 680, z0.y, { color: ctx.alpha('white', 0.15), parent: g });
          ctx.line(z0.x, 648, z0.x, 848, { color: ctx.alpha('white', 0.15), parent: g });
          S.zMark = ctx.rect(0, 648, 2, 200, { rx: 1, fill: ctx.alpha('amber', 0.8), parent: g });
          S.dots = ['ReLU', 'GELU', 'SiLU'].map(function (k) { return ctx.circle(0, 0, 5, { fill: ACOL[k], parent: g, glow: true }); });
          S.zTxt = ctx.text(700, 660, '', { size: 14, font: 'mono', color: 'amber', parent: g });
          S.fTxt = ['ReLU', 'GELU', 'SiLU'].map(function (k, i) { return ctx.text(700, 700 + i * 30, '', { size: 14, font: 'mono', color: ACOL[k], parent: g }); });
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
          /* activation chooser */
          ctx.text(1000, 660, 'plug into the neuron (click):', { size: 13, font: 'mono', color: 'dim', parent: g });
          S.aChips = ['ReLU', 'GELU', 'SiLU'].map(function (k, i) {
            var c = ctx.label(1060 + i * 120, 700, k, { color: ACOL[k], size: 14, w: 100, parent: g });
            c.style.cursor = 'pointer';
            c.addEventListener('click', function (ev) { ev.stopPropagation(); S.setAct(k); });
            return c;
          });
          ctx.para(1000, 752, ['linear ∘ linear = linear', 'depth needs a bend', 'SiLU gates SwiGLU in LLMs'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: g });
          S.setAct = function (k) {
            S.act = k;
            S.aChips.forEach(function (c, i) { c.firstChild.setAttribute('fill', ctx.alpha(ACOL[['ReLU', 'GELU', 'SiLU'][i]], ['ReLU', 'GELU', 'SiLU'][i] === k ? 0.5 : 0.12)); });
            S.actN.body.setAttribute('stroke', ctx.C[ACOL[k]]);
            S.update(300);
            setZ(S.z);
          };
          ctx.reveal(g, { from: 'up' });
          ctx.reveal([pl.curve, gl.curve, sl.curve], { from: 'draw', stagger: 300, dur: 800 });
          setZ(-4);
          return ctx.wait(1000).then(function () {
            return ctx.tween(2600, function (t) { setZ(-4 + 7 * t); }, 'inOut');
          }).then(function () {
            return ctx.tween(800, function (t) { setZ(3 + (S.z - 3) * t); }, 'inOut');
          }).then(function () {
            S.setAct('SiLU');
            return ctx.wait(400);
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'A hyperplane',
        say: 'Now the geometric view. With two inputs, every point in the plane is one possible input, and the neuron computes w dot x plus b. The set where that equals zero is a straight line, a hyperplane in higher dimensions, with the weight vector as its normal. One side fires, the other stays silent. Changing the weights rotates the boundary; changing the bias slides it. Watch the boundary sweep around until it separates icy pixels from rocky ones.',
        deep: '<div class="eq">H = { x : w·x + b = 0 }, &nbsp; dist(x, H) = (w·x + b) / ‖w‖</div>' +
          '<ul><li>w is the <b>normal</b> of H: it points into the firing half-space; ‖w‖ sets how sharply the output changes across H (the "temperature" of the unit).</li>' +
          '<li>−b/‖w‖ is the signed offset of H from the origin.</li>' +
          '<li>A single neuron can only separate <b>linearly separable</b> sets (XOR is the classic failure, Minsky &amp; Papert 1969). A layer of n neurons carves space with n hyperplanes; the next layer combines the cells — this is how depth builds curved, piecewise-linear decision surfaces (a ReLU net is a piecewise-linear function with up to exponentially many regions).</li>' +
          '<li>In d = 8,192 dimensions, "one side of a hyperplane" is a <b>direction test</b> on the residual stream: the neuron asks "how much of feature w is present?"</li></ul>',
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
          ctx.text(P.x + P.w, P.y + P.h + 22, 'x1 (cold)', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: g });
          ctx.text(P.x + 4, P.y - 9, 'x2 (glow) ↑', { size: 12, font: 'mono', color: 'dim', parent: g });
          S.shade = ctx.poly([[0, 0]], { fill: ctx.alpha('lime', 0.1), parent: g });
          S.bLine = ctx.line(0, 0, 0, 0, { color: 'lime', sw: 2.5, parent: g });
          S.nArrow = ctx.line(0, 0, 0, 0, { color: 'white', sw: 2, arrow: true, parent: g });
          S.nLbl = ctx.text(0, 0, 'w', { size: 14, font: 'mono', weight: 700, color: 'white', parent: g });
          var r = ctx.rng(77);
          S.pts = [];
          function gauss() { return (r() + r() + r() - 1.5) * 1.3; }
          for (var i = 0; i < 28; i++) {
            var cls = i % 2, cx = cls ? 1.2 : -1.0, cy = cls ? 1.0 : -0.9;
            var px = cx + gauss() * 0.75, py = cy + gauss() * 0.75;
            px = Math.max(-2.8, Math.min(2.8, px)); py = Math.max(-2.8, Math.min(2.8, py));
            var q = toPx(px, py);
            var el = ctx.circle(q.x, q.y, 7, { fill: cls ? ctx.alpha('cyan', 0.85) : ctx.alpha('orange', 0.85), stroke: cls ? 'cyan' : 'orange', sw: 1, parent: g });
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
          /* right panel */
          var rp = ctx.group();
          var c1 = card(ctx, rp, 640, 380, 900, 490, 'lime', 'THE DECISION BOUNDARY');
          S.hTxt = ctx.text(664, 440, '', { size: 18, font: 'mono', weight: 700, color: 'lime', parent: c1 });
          S.accTxt = ctx.text(664, 480, '', { size: 15, font: 'mono', color: 'text', parent: c1 });
          ctx.para(664, 540, ['w · x + b = 0  is a line (hyperplane in d dims)', 'w is its normal: it points to the firing side', 'rotate w  → boundary turns', 'change b  → boundary slides (offset −b/|w|)', 'one neuron = one cut; a layer = many cuts;', 'the next layer combines the cells'], { size: 15, font: 'mono', color: 'text', lh: 34, parent: c1 });
          keepWS(c1);
          swapMain(ctx, S, rp);
          ctx.reveal(g, { from: 'fade', delay: 300 });
          function setTheta(th, b) {
            var w1 = Math.cos(th) * 1.6, w2 = Math.sin(th) * 1.6;
            var ok = S.drawLine(w1, w2, b);
            S.hTxt.textContent = 'w = (' + fmt(w1) + ', ' + fmt(w2) + ')   b = ' + fmt(b);
            S.accTxt.textContent = 'correctly split: ' + ok + ' / ' + S.pts.length;
          }
          setTheta(-2.6, 0.4);
          return ctx.wait(800).then(function () {
            return ctx.tween(3600, function (t) { setTheta(-2.6 + t * (2.6 + Math.PI / 4 + 2 * Math.PI) , 0.4 - 0.4 * t); }, 'inOut');
          }).then(function () {
            return ctx.tween(900, function (t) { setTheta(Math.PI / 4, -0.6 * Math.sin(t * Math.PI)); }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Learning: gradients',
        say: 'Nobody sets these weights by hand. We define a loss that measures how wrong the neuron is, then use calculus. The chain rule gives the gradient of the loss with respect to every weight, and gradient descent nudges each weight a little in the downhill direction. Starting from a bad boundary, watch forty steps of gradient descent: the loss falls, and the line swings into place between the ice and the rock pixels.',
        deep: '<div class="eq">ŷ = σ(w·x + b), &nbsp; L = −[y log ŷ + (1−y) log(1−ŷ)]</div>' +
          '<div class="eq">∂L/∂w = ∂L/∂ŷ · ∂ŷ/∂z · ∂z/∂w = (ŷ − y)·x, &nbsp; ∂L/∂b = ŷ − y</div>' +
          '<div class="eq">w ← w − η · (1/N) Σ<sub>n</sub> (ŷ<sub>n</sub> − y<sub>n</sub>) x<sub>n</sub></div>' +
          '<p>The sigmoid–cross-entropy pairing makes the gradient simply <i>error × input</i>. Here: full-batch GD, η = 0.5, 40 iterations from w = (−1, 0.3), b = 0.5 — computed live.</p>' +
          '<ul><li>LLMs use the same rule at scale: <b>AdamW</b> (per-parameter adaptive steps, decoupled weight decay), mini-batches of millions of tokens, warm-up + cosine/WSD learning-rate schedules, gradient clipping at norm 1.0, BF16 compute with FP32 master weights.</li>' +
          '<li>Optimizer state: Adam keeps 2 extra FP32 moments per parameter → 16 bytes/param with master weights: 1.1 TB for a 70B model, sharded (ZeRO/FSDP) across GPUs.</li></ul>',
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
          ctx.para(664, 660, ['ŷ = σ(w·x + b)          L = cross-entropy(ŷ, y)', 'dL/dw = (ŷ − y) · x     chain rule: dL/dŷ · dŷ/dz · dz/dw', 'w ← w − η · dL/dw       η = 0.5, full batch, 40 steps', 'LLMs: same idea, AdamW on 10^11 params, millions of tokens per step'], { size: 14, font: 'mono', color: 'text', lh: 38, parent: c1 });
          keepWS(c1);
          lp.curve.setAttribute('opacity', 0.25);
          swapMain(ctx, S, rp);
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
          show(0);
          return ctx.wait(900).then(function () {
            return ctx.tween(4500, function (t) { show(Math.round(t * 40)); }, 'linear');
          }).then(function () {
            ctx.fade(lp.curve, 1, 400);
            return ctx.pulse(S.lossDot, { color: 'amber', dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Backpropagation',
        say: 'Stack neurons and the same chain rule runs backwards through the whole network. Here is a tiny net with two inputs, two ReLU hidden neurons and one output. The forward pass computes activations left to right and a loss against the target. The backward pass sends the error right to left: each weight gradient is the error signal arriving at its output, times the activation at its input. Every number you see is computed exactly.',
        deep: '<div class="eq">z<sub>j</sub> = Σ<sub>i</sub> W<sub>ji</sub>x<sub>i</sub> + b<sub>j</sub>, &nbsp; h<sub>j</sub> = ReLU(z<sub>j</sub>), &nbsp; ŷ = Σ<sub>j</sub> v<sub>j</sub>h<sub>j</sub> + c, &nbsp; L = ½(ŷ − t)²</div>' +
          '<div class="eq">δ<sub>y</sub> = ŷ − t, &nbsp; ∂L/∂v<sub>j</sub> = δ<sub>y</sub>h<sub>j</sub>, &nbsp; δ<sub>j</sub> = δ<sub>y</sub>v<sub>j</sub>·1[z<sub>j</sub>&gt;0], &nbsp; ∂L/∂W<sub>ji</sub> = δ<sub>j</sub>x<sub>i</sub></div>' +
          '<p><b>Reverse-mode autodiff</b>: one backward pass yields all gradients at ≈ 2× the forward cost (hence 6N FLOPs/token for training vs 2N for inference). It must keep forward activations, which is why training memory is dominated by activations; <b>activation checkpointing</b> recomputes them instead.</p>' +
          '<p>In matrix form a layer’s backward pass is two GEMMs: ∂L/∂W = δᵀX and ∂L/∂X = δW — the same tensor-core workload as the forward pass.</p>',
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
          var edges = [];
          [0, 1].forEach(function (j) {
            [0, 1].forEach(function (i) {
              var e = ctx.line(NX[i].x + 40, NX[i].y, NH[j].x - 40, NH[j].y, { color: ctx.alpha('white', 0.35), sw: 1.8, parent: g });
              var t = (i === j) ? 0.3 : 0.62;
              var mx = NX[i].x + 40 + (NH[j].x - 40 - NX[i].x - 40) * t, my = NX[i].y + (NH[j].y - NX[i].y) * t;
              edges.push({ e: e, lbl: ctx.text(mx, my - 12, 'W' + (j + 1) + (i + 1) + '=' + fmt(Wm[j][i]), { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g }),
                grad: ctx.text(mx, my + 14, 'g=' + fmt(dW[j][i]), { size: 12, font: 'mono', weight: 700, color: 'magenta', anchor: 'middle', parent: g }) });
            });
          });
          var vEdges = [0, 1].map(function (j) {
            var e = ctx.line(NH[j].x + 40, NH[j].y, NY.x - 40, NY.y, { color: ctx.alpha('white', 0.35), sw: 1.8, parent: g });
            var mx = (NH[j].x + NY.x) / 2, my = (NH[j].y + NY.y) / 2;
            return { e: e, lbl: ctx.text(mx, my - 14, 'v' + (j + 1) + '=' + fmt(v[j]), { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g }),
              grad: ctx.text(mx, my + 16, 'g=' + fmt(dv[j]), { size: 12, font: 'mono', weight: 700, color: 'magenta', anchor: 'middle', parent: g }) };
          });
          function neuron(p, col, top, mid) {
            var ng = ctx.group({ parent: g });
            ctx.circle(p.x, p.y, 40, { fill: '#0e1830', stroke: col, sw: 2, parent: ng, glow: true });
            ng.val = ctx.text(p.x, p.y + 1, mid, { size: 15, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: ng });
            ctx.text(p.x, p.y - 54, top, { size: 13, font: 'mono', color: col, anchor: 'middle', parent: ng });
            ng.fw = ctx.text(p.x, p.y + 60, '', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: ng });
            ng.bw = ctx.text(p.x, p.y + 78, '', { size: 12, font: 'mono', weight: 700, color: 'magenta', anchor: 'middle', parent: ng });
            return ng;
          }
          var nx = NX.map(function (p, i) { return neuron(p, 'cyan', 'x' + (i + 1), x[i].toFixed(1)); });
          var nh = NH.map(function (p, j) { return neuron(p, 'orange', 'h' + (j + 1) + ' = ReLU(z' + (j + 1) + ')', '?'); });
          var ny = neuron(NY, 'amber', 'ŷ  (c = ' + fmt(c) + ')', '?');
          var lossN = ctx.node({ x: 1010, y: 460, w: 120, h: 56, title: 'L = ?', color: 'pink', titleSize: 15, parent: g });
          var lEdge = ctx.line(NY.x + 40, NY.y, 950, 460, { color: ctx.alpha('pink', 0.6), sw: 1.8, arrow: true, parent: g });
          nh.forEach(function (n, j) { n.fw.textContent = 'b' + (j + 1) + '=' + fmt(bb[j]); });
          ctx.para(90, 736, ['cyan  = forward values  (stored for the backward pass)', 'magenta = backward error signals δ and weight gradients g = dL/dw', 'g(edge) = δ(at its output) × activation(at its input);  backward ≈ 2× forward FLOPs'], { size: 13, font: 'mono', color: 'text', lh: 30, parent: g });
          var grads = edges.map(function (q) { return q.grad; }).concat(vEdges.map(function (q) { return q.grad; }));
          grads.forEach(function (t) { t.setAttribute('opacity', 0); });
          S.bpNet = g;
          /* right: chain rule ledger */
          var rp = ctx.group();
          var c1 = card(ctx, rp, 1130, 380, 410, 490, 'magenta', 'CHAIN RULE LEDGER');
          S.ledger = ['forward', 'z = (' + fmt(z[0]) + ', ' + fmt(z[1]) + ')', 'h = (' + fmt(h[0]) + ', ' + fmt(h[1]) + ')', 'ŷ = ' + fmt(yh) + '   L = ' + L.toFixed(3), 'backward', 'δy = ŷ − t = ' + fmt(dy), 'dL/dv = δy·h = (' + fmt(dv[0]) + ', ' + fmt(dv[1]) + ')', 'δh = δy·v = (' + fmt(dh[0]) + ', ' + fmt(dh[1]) + ')', 'δz = δh·1[z>0] (both z > 0)', 'dL/dW = δz ⊗ x   (g on edges)'].map(function (s, k) {
            return ctx.text(1150, 426 + k * 42, s, { size: 14, font: 'mono', weight: (k === 0 || k === 4) ? 700 : 400, color: k < 4 ? (k === 0 ? 'cyan' : 'text') : (k === 4 ? 'magenta' : 'text'), parent: c1 });
          });
          S.ledger.forEach(function (t) { t.setAttribute('opacity', 0); });
          swapMain(ctx, S, rp);
          ctx.reveal(g, { from: 'fade', delay: 200 });
          var fwd = function () {
            return Promise.all(edges.map(function (q) { return ctx.packet(q.e, { color: 'cyan', dur: 700 }); })).then(function () {
              nh.forEach(function (n, j) { n.val.textContent = h[j].toFixed(2); n.fw.textContent = 'z' + (j + 1) + '=' + fmt(z[j]); });
              [0, 1, 2, 3].forEach(function (k) { S.ledger[k].setAttribute('opacity', 1); });
              return Promise.all(vEdges.map(function (q) { return ctx.packet(q.e, { color: 'cyan', dur: 600 }); }));
            }).then(function () {
              ny.val.textContent = yh.toFixed(2);
              lossN.titleEl.textContent = 'L = ' + L.toFixed(3);
              return ctx.packet(lEdge, { color: 'pink', dur: 300 });
            });
          };
          var bwd = function () {
            ny.bw.textContent = 'δy=' + fmt(dy);
            [4, 5].forEach(function (k) { S.ledger[k].setAttribute('opacity', 1); });
            return Promise.all(vEdges.map(function (q) { return ctx.packet(q.e, { color: 'magenta', dur: 700, reverse: true }); })).then(function () {
              vEdges.forEach(function (q) { ctx.reveal(q.grad, { dur: 300 }); });
              nh.forEach(function (n, j) { n.bw.textContent = 'δz' + (j + 1) + '=' + fmt(dz[j]); });
              [6, 7, 8].forEach(function (k) { S.ledger[k].setAttribute('opacity', 1); });
              return Promise.all(edges.map(function (q) { return ctx.packet(q.e, { color: 'magenta', dur: 700, reverse: true }); }));
            }).then(function () {
              edges.forEach(function (q) { ctx.reveal(q.grad, { dur: 300 }); });
              S.ledger[9].setAttribute('opacity', 1);
              return ctx.wait(300);
            });
          };
          return ctx.wait(700).then(fwd).then(function () { return ctx.wait(400); }).then(bwd).then(function () {
            grads.forEach(function (t) { t.setAttribute('opacity', 1); });
            S.ledger.forEach(function (t) { t.setAttribute('opacity', 1); });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'A layer is a matmul',
        say: 'Now put many neurons side by side. Each neuron is one row of a weight matrix, so a whole layer computes all its weighted sums at once: a matrix times a vector. Watch each row take a dot product with the input to produce one output. Batch many tokens together and the vector becomes a matrix too, so the layer becomes a matrix multiply. The gate projection of one seventy billion MLP layer is exactly that: eight thousand inputs times twenty eight thousand neurons.',
        deep: '<div class="eq">y = φ(Wx + b), &nbsp; W ∈ ℝ<sup>n<sub>out</sub>×n<sub>in</sub></sup> &nbsp;⇒&nbsp; Y = φ(X Wᵀ + b), &nbsp; X ∈ ℝ<sup>B×n<sub>in</sub></sup></div>' +
          '<p>GEMM cost: <b>2·B·n<sub>in</sub>·n<sub>out</sub></b> FLOPs; data: (B·n<sub>in</sub> + n<sub>in</sub>·n<sub>out</sub> + B·n<sub>out</sub>) elements. Arithmetic intensity grows with B — batching is what turns memory-bound GEMVs into compute-bound GEMMs.</p>' +
          '<table><tr><th>70B MLP, per token</th><th>shape</th><th>FLOPs</th></tr>' +
          '<tr><td>gate W<sub>1</sub></td><td>8192 × 28672</td><td>470 M</td></tr>' +
          '<tr><td>up W<sub>3</sub></td><td>8192 × 28672</td><td>470 M</td></tr>' +
          '<tr><td>down W<sub>2</sub></td><td>28672 × 8192</td><td>470 M</td></tr></table>' +
          '<p>Over 80 layers ≈ 113 GFLOP/token of the ≈ 141 GFLOP total — MLP GEMMs dominate. Prefill with T = 4,096 tokens turns each into a [4096 × 8192]·[8192 × 28672] GEMM: 1.9 TFLOP.</p>',
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
          /* batching */
          var bgp = ctx.group({ parent: g });
          ctx.text(80, 620, 'BATCH OF TOKENS → GEMM', { size: 13, font: 'mono', weight: 700, color: 'lime', parent: bgp, spacing: 1 });
          ctx.matrix(100, 650, 4, 8, { cell: 18, gap: 3, cmap: 'cyan', values: function (a, b) { return 0.3 + 0.5 * Math.abs(Math.sin(a * 2 + b)); }, parent: bgp });
          ctx.text(184, 752, 'X  [B × n_in]', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: bgp });
          ctx.text(290, 690, '·', { size: 30, color: 'dim', anchor: 'middle', parent: bgp });
          ctx.matrix(320, 650, 8, 6, { cell: 12, gap: 2, cmap: 'amber', values: function (a, b) { return 0.3 + 0.5 * Math.abs(Math.cos(a + b * 1.3)); }, parent: bgp });
          ctx.text(362, 776, 'Wᵀ [n_in × n_out]', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: bgp });
          ctx.text(440, 690, '=', { size: 26, color: 'dim', anchor: 'middle', parent: bgp });
          ctx.matrix(470, 650, 4, 6, { cell: 18, gap: 3, cmap: 'lime', values: function (a, b) { return 0.3 + 0.5 * Math.abs(Math.sin(a + b)); }, parent: bgp });
          ctx.text(532, 752, 'Y [B × n_out]', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: bgp });
          ctx.para(640, 660, ['FLOPs = 2 · B · n_in · n_out', '70B gate proj: n_in 8192, n_out 28672', '  = 470 MFLOP per token', '  prefill T=4096: 1.9 TFLOP / layer'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: bgp });
          keepWS(bgp);
          bgp.setAttribute('opacity', 0);
          S.mm = g;
          var rp = ctx.group();
          var c1 = card(ctx, rp, 1130, 380, 410, 490, 'amber', 'NEURON → LAYER');
          ctx.para(1150, 430, ['one neuron  = dot(w_i, x) + b_i', 'one layer   = W x + b', 'many tokens = X Wᵀ + b', '', 'neurons are rows of W', 'inputs are columns', 'GPUs love this shape:', 'thousands of identical', 'multiply-adds, no branches'], { size: 14, font: 'mono', color: 'text', lh: 34, parent: c1 });
          keepWS(c1);
          swapMain(ctx, S, rp);
          ctx.reveal(g, { from: 'fade', delay: 200 });
          function row(i) {
            S.rowHi.setAttribute('y', 264 + i * (cell + gap));
            var terms = Wv[i].slice(0, 3).map(function (w, k) { return fmt(w) + '·' + fmt(xv[k]); }).join(' + ');
            S.dotTxt.textContent = 'z' + (i + 1) + ' = ' + terms + ' + … = ' + fmt(zv[i]);
            Zm.cells[i][0].setAttribute('fill', ctx.cmap('diverge', Math.tanh(zv[i])));
            Ym.cells[i][0].setAttribute('fill', ctx.cmap('diverge', Math.tanh(ACTS.SiLU(zv[i]))));
          }
          var chain = ctx.wait(800);
          [0, 1, 2, 3, 4, 5].forEach(function (i) {
            chain = chain.then(function () { row(i); return ctx.pulse(Zm.cells[i][0], { color: 'amber', dur: 420 }); });
          });
          return chain.then(function () {
            return ctx.reveal(bgp, { from: 'up' });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Tensor cores',
        say: 'On the GPU, that matrix multiply is cut into tiles. Each thread block owns one output tile, say one hundred twenty eight by one hundred twenty eight, and marches along the shared dimension, loading a slice of A and a slice of B into on-chip memory and accumulating. Inside the tile, tensor core instructions multiply small fragments of B F sixteen or F P eight inputs and accumulate in thirty two bit floats. Billions of our neurons, executed as these fragments.',
        deep: '<div class="eq">C<sub>tile</sub> += Σ<sub>k</sub> A[m-tile, k-slice] · B[k-slice, n-tile]</div>' +
          '<p>Tile intensity: FLOPs 2·M·N·K<sub>s</sub> over bytes (M + N)·K<sub>s</sub>·2 ⇒ <b>MN/(M+N) = 64 FLOP/byte</b> for a 128×128 BF16 tile (85 for 128×256). That is <i>below</i> the H100 HBM ridge (≈ 295), so a large GEMM stays compute-bound only because neighbouring CTAs re-read the same A/B slices from the 50 MB L2 (tile rasterisation / swizzling) and clusters multicast them with TMA; the tile’s intensity only has to beat the much higher L2 and SMEM bandwidth.</p>' +
          '<table><tr><th>GPU</th><th>MMA path</th><th>dense BF16</th><th>dense FP8</th></tr>' +
          '<tr><td>A100</td><td>mma.sync m16n8k16 (warp)</td><td>312 TF</td><td>—</td></tr>' +
          '<tr><td>H100 SXM</td><td>wgmma m64nNk16 (warpgroup), TMA</td><td>989 TF</td><td>1,979 TF</td></tr>' +
          '<tr><td>B200</td><td>tcgen05.mma, accumulators in TMEM</td><td>≈ 2.25 PF</td><td>≈ 4.5 PF</td></tr></table>' +
          '<ul><li>Inputs BF16/FP8 (Blackwell adds FP4/FP6 microscaled formats), accumulation FP32; the epilogue applies bias, activation and down-cast before writing C.</li>' +
          '<li>Pipelines overlap TMA loads of stage k+1 with MMAs of stage k (warp specialisation); FlashAttention and CUTLASS kernels are built this way.</li></ul>',
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
          S.tileHi = ctx.rect(CX + TC * T - 3, CY + TR * T - 3, T + 4, T + 4, { rx: 4, stroke: 'white', sw: 2.2, parent: g, glow: true });
          S.kTxt = ctx.text(CX, CY + 8 * T + 48, '', { size: 13, font: 'mono', color: 'white', parent: g });
          /* inside one tile */
          var ig = ctx.group({ parent: g });
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
          ctx.path('M' + (CX + TC * T + T) + ',' + (CY + TR * T) + ' L' + IX + ',' + IY, { stroke: ctx.alpha('white', 0.35), dash: '3 5', parent: g });
          ctx.path('M' + (CX + TC * T + T) + ',' + (CY + TR * T + T) + ' L' + IX + ',' + (IY + IS), { stroke: ctx.alpha('white', 0.35), dash: '3 5', parent: g });
          S.tc = g;
          var rp = ctx.group();
          var c1 = card(ctx, rp, 1130, 380, 410, 490, 'red', 'THE HARDWARE VIEW');
          ctx.para(1150, 430, ['HBM → SMEM: TMA loads', 'A-slice and B-slice', 'SMEM → tensor cores:', 'MMA on fragments', 'FP32 accumulate in regs', 'epilogue: +b, φ, cast', '', 'H100: 989 TF BF16 dense', '      1979 TF FP8 dense', 'B200: ≈ 2.25 PF BF16'], { size: 14, font: 'mono', color: 'text', lh: 32, parent: c1 });
          keepWS(c1);
          swapMain(ctx, S, rp);
          ctx.reveal(g, { from: 'fade', delay: 200 });
          function kstep(k) {
            for (var q = 0; q < KS; q++) {
              S.At[TR][q].setAttribute('fill', ctx.alpha('cyan', q === k ? 0.7 : (q < k ? 0.35 : 0.15)));
              S.Bt[q][TC].setAttribute('fill', ctx.alpha('amber', q === k ? 0.7 : (q < k ? 0.35 : 0.15)));
            }
            S.Ct[TR][TC].setAttribute('fill', ctx.alpha('lime', 0.15 + 0.2 * (k + 1)));
            S.kTxt.textContent = 'k-slice ' + (k + 1) + ' / ' + KS + ':  C_tile += A_slice · B_slice';
            S.frag.forEach(function (rowF, fr2) { rowF.forEach(function (f, fc2) { f.setAttribute('fill', ctx.alpha(fr2 < 4 ? 'lime' : 'teal', 0.08 + 0.1 * (k + 1))); }); });
          }
          var chain = ctx.wait(800);
          [0, 1, 2, 3].forEach(function (k) {
            chain = chain.then(function () { kstep(k); return ctx.pulse(S.Ct[TR][TC], { color: 'lime', dur: 500 }); });
          });
          return chain.then(function () {
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
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Polysemantic neurons',
        say: 'Finally, what do real neurons in a language model mean? Usually, many things at once. Because of superposition, a single MLP neuron might fire on icy landscapes, on HTML tags, and on Korean text. Sparse autoencoders untangle this: they learn a much wider dictionary of features, only a few active at a time, that reconstructs the activations. Those features tend to be monosemantic: one for ice and frost, one for markup. Transcoders do the same for whole MLP layers, making circuits traceable.',
        deep: '<div class="eq">f = ReLU(W<sub>e</sub>(x − b<sub>d</sub>) + b<sub>e</sub>), &nbsp; x̂ = W<sub>d</sub>f + b<sub>d</sub>, &nbsp; L = ‖x − x̂‖² + λ‖f‖<sub>1</sub></div>' +
          '<ul><li><b>Superposition</b>: n features ≫ d neurons, stored as nearly orthogonal directions, so the neuron basis is not the feature basis → polysemantic neurons.</li>' +
          '<li><b>SAEs</b>: dictionary width 16× to 1000s× d; Anthropic trained 1M/4M/34M-feature SAEs on Claude 3 Sonnet; OpenAI a 16M-latent TopK SAE on GPT-4; Gemma Scope released JumpReLU SAEs for every Gemma 2 layer. Typical L0: tens of active features per token.</li>' +
          '<li><b>Transcoders / cross-layer transcoders</b> approximate an MLP’s <i>output</i> from its <i>input</i> through sparse features, giving linear, input-independent feature-to-feature edges → attribution graphs of whole computations (Circuit Tracing, 2025).</li>' +
          '<li>Features are causal handles: clamping an "ice" feature steers generations; used for auditing and safety of agent models.</li></ul>' +
          '<p class="muted">Activations shown are illustrative.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.tc, 350, true);
          var g = ctx.group();
          ctx.rect(60, 180, 1040, 690, { rx: 12, fill: 'rgba(7,12,24,0.94)', stroke: ctx.alpha('pink', 0.4), parent: g });
          ctx.text(80, 204, 'ONE MLP NEURON (layer 40, #16) ACROSS CONTEXTS   →   SAE FEATURES', { size: 13, font: 'mono', weight: 700, color: 'pink', parent: g, spacing: 1 });
          var ctxs = ['"…a glowing ice moon"', '"frozen lake at dawn"', '"<div class=nav>"', '"한국어 문장"', '"fox fur in the wind"', '"see 42 U.S.C. § 1983"'];
          var neuronAct = [0.92, 0.78, 0.81, 0.66, 0.12, 0.05];
          var feats = [['F#1203  ice / frost', 'cyan', [0.95, 0.88, 0.0, 0.0, 0.05, 0.0]], ['F#77410  HTML markup', 'amber', [0.0, 0.0, 0.93, 0.0, 0.0, 0.02]], ['F#9002  Korean script', 'violet', [0.0, 0.0, 0.0, 0.9, 0.0, 0.0]]];
          ctx.text(80, 236, 'context', { size: 12, font: 'mono', color: 'dim', parent: g });
          ctx.text(340, 236, 'neuron #16', { size: 12, font: 'mono', color: 'orange', parent: g });
          S.nBars = [];
          ctxs.forEach(function (s, i) {
            var y = 268 + i * 40;
            var t = ctx.text(80, y, s, { size: 13, font: 'mono', color: 'text', parent: g });
            t.style.fontVariantLigatures = 'none';
            ctx.rect(340, y - 10, 140, 20, { rx: 3, fill: 'rgba(255,255,255,0.04)', parent: g });
            S.nBars.push([ctx.rect(340, y - 10, 0, 20, { rx: 3, fill: ctx.alpha('orange', 0.7), parent: g }), 140 * neuronAct[i]]);
          });
          ctx.text(80, 518, 'polysemantic: fires on ice AND markup AND Korean', { size: 13, font: 'mono', weight: 700, color: 'orange', parent: g });
          /* SAE diagram */
          var sg = ctx.group({ parent: g });
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
          ctx.para(850, 280, ['L = |x − x̂|²', '  + λ |f|₁', '', 'few features', 'active at once'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: sg });
          keepWS(sg);
          /* feature bars */
          S.fBars = [];
          feats.forEach(function (f, fi) {
            var x0 = 90 + fi * 330, y0 = 560;
            var fc = ctx.group({ parent: g });
            ctx.rect(x0 - 10, y0, 310, 280, { rx: 8, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha(f[1], 0.5), parent: fc });
            ctx.text(x0 + 4, y0 + 22, f[0], { size: 13, font: 'mono', weight: 700, color: f[1], parent: fc });
            f[2].forEach(function (v, i) {
              var y = y0 + 58 + i * 36;
              ctx.text(x0 + 4, y, ['ice moon', 'frozen lake', '<div>', 'Korean', 'fox fur', 'U.S.C. §'][i], { size: 12, font: 'mono', color: 'dim', parent: fc }).style.fontVariantLigatures = 'none';
              ctx.rect(x0 + 120, y - 9, 160, 18, { rx: 3, fill: 'rgba(255,255,255,0.04)', parent: fc });
              S.fBars.push([ctx.rect(x0 + 120, y - 9, 0, 18, { rx: 3, fill: ctx.alpha(f[1], 0.75), parent: fc }), 160 * v]);
            });
          });
          S.sae = g;
          var rp = ctx.group();
          var c1 = card(ctx, rp, 1130, 380, 410, 490, 'pink', 'FROM NEURONS TO FEATURES');
          ctx.para(1150, 430, ['neurons: the basis the', 'hardware computes in', 'features: the basis the', 'model thinks in', '', 'SAE: wide, sparse,', 'reconstructs x', 'transcoder: replaces the', 'MLP, gives circuit edges', '', 'monosemantic handles', 'for audit and steering'], { size: 14, font: 'mono', color: 'text', lh: 32, parent: c1 });
          keepWS(c1);
          swapMain(ctx, S, rp);
          ctx.reveal(g, { from: 'fade', delay: 200 });
          var lit = [3, 9, 17];
          return ctx.wait(700).then(function () {
            return Promise.all(S.nBars.map(function (b, i) { return ctx.animate(b[0], { width: [0, b[1]] }, 600, 'out', i * 120); }));
          }).then(function () {
            return ctx.tween(800, function (t) {
              lit.forEach(function (k) { S.fRow.cells[k][0].setAttribute('fill', ctx.cmap('lime', 0.04 + 0.9 * t)); });
            }, 'out');
          }).then(function () {
            return Promise.all(S.fBars.map(function (b, i) { return ctx.animate(b[0], { width: [0, b[1]] }, 600, 'out', (i % 6) * 90 + Math.floor(i / 6) * 250); }));
          }).then(function () {
            return ctx.pulse(S.nd, { color: 'amber', dur: 700, parent: S.nd });
          });
        }
      }
    ]
  });
})();
