/* L3 — Mixture of Experts. Dense MLP -> router + experts: top-k gating, weighted combine, fine-grained and
 * shared experts, load balancing (aux loss vs aux-loss-free bias), capacity and dropping, expert-parallel
 * all-to-all with overlap, and the memory-vs-compute economics of serving.
 * Every step is a sequence of beats (one idea each: narration, callout card, deep-dive chunk, animation segment). */
(function () {
  var EC = ['amber', 'cyan', 'violet', 'lime', 'orange', 'teal', 'pink', 'blue'];
  var LOGITS = [0.3, -0.8, 2.1, 0.1, -0.4, 1.6, -1.2, 0.5];
  var SKEW = [30, 4, 18, 2, 3, 1, 5, 1];
  var BAL = [9, 8, 8, 7, 8, 8, 8, 8];
  var ITERS = [SKEW, [22, 6, 14, 4, 5, 3, 6, 4], [15, 7, 11, 6, 6, 5, 7, 7], [11, 8, 9, 7, 7, 7, 8, 7], [9, 8, 8, 8, 8, 7, 8, 8]];

  function boxOf(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }

  function keepWS(root) {
    Array.prototype.forEach.call(root.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
  }

  /* set opacity 0 on elements (or arrays of elements) that a later beat will reveal */
  function hide() {
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      (Array.isArray(a) ? a : [a]).forEach(function (e) { if (e) e.setAttribute('opacity', 0); });
    }
  }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    if (title) ctx.text(x + 16, y + 22, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = boxOf(x, y, w, h);
    return g;
  }

  /* card with column-aligned code-font lines; g.lines = the individual line elements (revealed beat by beat) */
  function textCard(ctx, parent, x, y, w, h, color, title, lines, o) {
    o = o || {};
    var g = card(ctx, parent, x, y, w, h, color, title);
    var p = ctx.para(x + 18, y + (o.top || 56), lines, { size: o.size || 14, font: 'code', color: 'text', lh: o.lh || 30, parent: g });
    keepWS(g);
    g.lines = Array.prototype.slice.call(p.childNodes);
    return g;
  }

  function page(ctx, S) {
    (S.loops || []).forEach(function (l) { l.stop(); });
    S.loops = [];
    if (S.page) ctx.remove(S.page, 450);
    S.page = ctx.group();
    return S.page;
  }

  function softmax(z) {
    var m = Math.max.apply(null, z), e = z.map(function (v) { return Math.exp(v - m); });
    var s = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (v) { return v / s; });
  }

  Atlas.register({
    id: 'moe',
    refs: [
      'Shazeer et al., <i>Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer</i>, ICLR 2017',
      'Lepikhin et al., <i>GShard: Scaling Giant Models with Conditional Computation and Automatic Sharding</i>, ICLR 2021',
      'Fedus, Zoph &amp; Shazeer, <i>Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity</i>, JMLR 2022',
      'Zoph et al., <i>ST-MoE: Designing Stable and Transferable Sparse Expert Models</i>, 2022',
      'Jiang et al., <i>Mixtral of Experts</i>, 2024',
      'DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i>, 2024',
      'Dai et al., <i>DeepSeekMoE: Towards Ultimate Expert Specialization</i>, ACL 2024',
      'Wang et al., <i>Auxiliary-Loss-Free Load Balancing Strategy for Mixture-of-Experts</i>, 2024',
      'Gale et al., <i>MegaBlocks: Efficient Sparse Training with Mixture-of-Experts</i>, MLSys 2023',
      'Kimi Team, <i>Kimi K2: Open Agentic Intelligence</i>, 2025',
      'Qwen Team, <i>Qwen3 Technical Report</i>, 2025',
      'Ludziejewski et al., <i>Scaling Laws for Fine-Grained Mixture of Experts</i>, ICML 2024'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Sparse capacity',
        beats: [
          {
            say: 'Inside each transformer block, the feed forward network holds most of the parameters. In a dense model, every token multiplies through all of them.',
            card: { tag: 'NUMBERS', title: 'Where the weights live', stat: { v: '≈ 80%', l: 'of Llama 3 70B parameters sit in the feed-forward blocks: 56 B of 70 B' } },
            deep: '<p>A dense block\'s MLP (SwiGLU: three matrices of d × d<sub>ff</sub>) dominates the parameter count: Llama 3 70B has 3 · 8192 · 28,672 ≈ 705 M per layer, times 80 layers ≈ 56 B, against ≈ 12 B in attention. Every token multiplies through all of it: ≈ 2N FLOPs, i.e. 140 GFLOP per token at 70 B.</p>' +
              '<p>That FFN is the part a mixture of experts makes sparse. Attention, norms and embeddings stay dense.</p>'
          },
          {
            say: 'A mixture of experts layer replaces that one network with many smaller expert networks and a tiny router that picks a few experts per token.',
            card: { tag: 'KEY IDEA', title: 'A router plus many experts', body: 'Each expert is a full feed-forward network. A tiny router scores them for every token, and only the top few run.' },
            deep: '<p>Replace the block’s MLP with E expert MLPs and a router; attention stays dense:</p>' +
              '<div class="eq">y = x + Σ<sub>i∈TopK(x)</sub> g<sub>i</sub>(x) · FFN<sub>i</sub>(x)</div>' +
              '<p>Shazeer et al. (2017) introduced the sparsely-gated layer for LSTMs; GShard and Switch brought it to Transformers, replacing every second FFN layer with a sparse one.</p>'
          },
          {
            say: 'The model can then store far more knowledge than it spends per token, because only the chosen experts run and their gated outputs are summed.',
            card: { tag: 'HOW IT WORKS', title: 'Only chosen experts run', body: 'Here experts 3 and 6 receive the token. Their outputs are scaled by gates 0.62 and 0.38 and added together.' },
            deep: '<p>Training and inference FLOPs scale with <b>active</b> parameters (≈ 2N<sub>active</sub> per token forward), while quality at a fixed compute budget improves with <b>total</b> parameters (Fedus et al.; the fine-grained MoE scaling laws of Ludziejewski et al.).</p>' +
              '<p>Intuition: capacity to <i>store</i> knowledge grows with the number of experts, but the cost of <i>using</i> it per token grows only with k.</p>'
          },
          {
            say: 'DeepSeek V3 has six hundred seventy one billion parameters, yet each token of our director agent\'s plan touches only thirty seven billion.',
            card: { tag: 'NUMBERS', title: 'Total versus active', stat: { v: '5.5%', l: 'of DeepSeek-V3\'s weights are active per token: 37 B of 671 B' } },
            deep: '<table><tr><th>Model</th><th>Total</th><th>Active / token</th><th>Routing</th></tr>' +
              '<tr><td>Mixtral 8×7B</td><td>46.7 B</td><td>12.9 B</td><td>top-2 of 8</td></tr>' +
              '<tr><td>Qwen3-235B-A22B</td><td>235 B</td><td>22 B</td><td>top-8 of 128</td></tr>' +
              '<tr><td>DeepSeek-V3</td><td>671 B</td><td>37 B</td><td>top-8 of 256 + 1 shared</td></tr>' +
              '<tr><td>Kimi K2</td><td>1.04 T</td><td>32 B</td><td>top-8 of 384 + 1 shared</td></tr></table>' +
              '<p>DeepSeek-V3: 37 B active means ≈ 74 GFLOP per token instead of ≈ 1.34 TFLOP for a dense 671 B model.</p>'
          },
          {
            say: 'The price is memory and communication: every expert must stay resident, and routing turns a dense matrix multiply into data dependent all to all traffic.',
            card: { tag: 'TRADE-OFF', title: 'Cheap FLOPs, costly memory', body: 'All experts must sit in GPU memory, and routing needs all-to-all communication between GPUs.' },
            deep: '<p>Sparsity buys FLOPs, not memory: all 671 B weights must be resident even though only 37 B are used per token, and each token must travel to wherever its experts live. The rest of this chamber is about paying that price well: balancing load, bounding capacity, overlapping communication and batching at fleet scale.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.loops = [];
          var g = S.page = ctx.group();
          /* dense panel */
          var A = card(ctx, g, 60, 176, 420, 350, 'white', 'DENSE FFN');
          ctx.label(110, 352, 'fox', { color: 'cyan', size: 13, parent: A });
          S.dense = ctx.matrix(190, 244, 10, 8, { cell: 18, gap: 4, parent: A, values: function () { return 0.12; }, cmap: 'amber' });
          ctx.line(140, 352, 184, 352, { color: 'cyan', sw: 1.4, arrow: true, parent: A });
          ctx.line(370, 352, 420, 352, { color: 'amber', sw: 1.4, arrow: true, parent: A });
          ctx.text(440, 352, 'y', { size: 14, font: 'mono', color: 'amber', parent: A });
          ctx.text(270, 490, 'every token × every weight', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: A });
          ctx.text(270, 510, 'Llama 3 70B: 70 B / token', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: A });
          hide(A);

          /* MoE panel */
          var B = card(ctx, g, 500, 176, 620, 350, 'amber', 'MoE FFN · top-2 of 8 experts');
          ctx.label(548, 352, 'fox', { color: 'cyan', size: 13, parent: B });
          S.router = ctx.node({ x: 660, y: 352, w: 96, h: 40, title: 'router', color: 'magenta', kind: 'pill', titleSize: 13, glow: false, parent: B });
          ctx.line(578, 352, 610, 352, { color: 'cyan', sw: 1.4, arrow: true, parent: B });
          S.exps = []; S.fan = []; S.outs = [];
          S.sum = ctx.circle(1010, 352, 14, { fill: '#1a1206', stroke: 'amber', sw: 1.6, parent: B });
          ctx.text(1010, 353, '+', { size: 16, color: 'amber', anchor: 'middle', weight: 700, parent: B });
          ctx.line(1024, 352, 1070, 352, { color: 'amber', sw: 1.4, arrow: true, parent: B });
          ctx.text(1090, 352, 'y', { size: 14, font: 'mono', color: 'amber', parent: B });
          for (var e = 0; e < 8; e++) {
            var y = 222 + e * 37;
            var n = ctx.node({ x: 860, y: y, w: 120, h: 28, title: 'expert ' + (e + 1), color: EC[e], kind: 'pill', titleSize: 12, glow: false, parent: B });
            n.setAttribute('opacity', 0.35);
            S.exps.push(n);
            S.fan.push(ctx.path('M708,352 C760,352 760,' + y + ' 800,' + y, { stroke: ctx.alpha('white', 0.18), sw: 1.2, parent: B }));
            S.outs.push(ctx.path('M920,' + y + ' C960,' + y + ' 960,352 996,352', { stroke: ctx.alpha('white', 0.1), sw: 1.2, parent: B }));
          }
          S.gl = [ctx.label(752, 306, 'g 0.62', { color: 'violet', size: 11, parent: B, bgAlpha: 0.35, textColor: 'white' }), ctx.label(752, 404, 'g 0.38', { color: 'teal', size: 11, parent: B, bgAlpha: 0.35, textColor: 'white' })];
          hide(S.gl);
          ctx.text(810, 515, 'only k/E of the FFN weights do work', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          hide(B);

          /* total vs active bars (log) */
          var C = card(ctx, g, 1140, 176, 400, 350, 'amber', 'TOTAL vs ACTIVE (B params, log)');
          var models = [['Mixtral 8×7B', 46.7, 12.9], ['Qwen3-235B-A22B', 235, 22], ['DeepSeek-V3', 671, 37], ['Kimi K2', 1040, 32]];
          function lx(v) { return 1160 + Math.log10(v) / 3.1 * 360; }
          S.mb = models.map(function (m, i) {
            var yy = 236 + i * 70;
            ctx.text(1160, yy - 10, m[0], { size: 12, font: 'mono', color: 'text', parent: C });
            ctx.text(1520, yy - 10, (m[1] >= 1000 ? (m[1] / 1000).toFixed(2) + ' T' : m[1] + ' B') + ' / ' + m[2] + ' B', { size: 12, font: 'mono', color: 'amber', anchor: 'end', parent: C });
            var tb = ctx.rect(1160, yy, 0, 20, { rx: 3, fill: ctx.alpha('white', 0.12), stroke: ctx.alpha('white', 0.4), sw: 1, parent: C });
            var ab = ctx.rect(1160, yy, 0, 20, { rx: 3, fill: ctx.alpha('amber', 0.6), stroke: 'amber', sw: 1, parent: C });
            return { tb: tb, ab: ab, tw: lx(m[1]) - 1160, aw: lx(m[2]) - 1160 };
          });
          ctx.text(1160, 510, 'grey = total · amber = active', { size: 11, font: 'mono', color: 'dim', parent: C });
          hide(C);

          var W = textCard(ctx, g, 60, 550, 1480, 310, 'amber', 'WHY SPARSE', [
            'knowledge capacity grows with TOTAL params; per-token FLOPs ≈ 2 × ACTIVE params',
            'DeepSeek-V3: 671 B total, 37 B active  →  ~74 GFLOP per token instead of ~1.34 TFLOP',
            'every MLP becomes router + E expert MLPs; attention, norms and embeddings stay dense',
            'our trailer: each token of the director agent\'s plan touches ~5.5% of the weights',
            'price: all experts resident in memory, and routing needs all-to-all communication'
          ], { lh: 44, top: 62 });
          hide(W, W.lines);

          function bars(t) { S.mb.forEach(function (b) { b.tb.setAttribute('width', b.tw * t); b.ab.setAttribute('width', b.aw * t); }); }
          function pick() {
            [2, 5].forEach(function (k, j) {
              S.exps[k].setAttribute('opacity', 1);
              S.fan[k].setAttribute('stroke', ctx.C[EC[k]]); S.fan[k].setAttribute('stroke-width', j ? 2 : 3);
              S.outs[k].setAttribute('stroke', ctx.C[EC[k]]); S.outs[k].setAttribute('stroke-width', j ? 2 : 3);
            });
            S.gl.forEach(function (t) { t.setAttribute('opacity', 1); });
          }
          bars(0);

          /* beat 0: a dense FFN, every token times every weight */
          return ctx.reveal(A, { from: 'up' }).then(function () {
            return ctx.tween(1000, function (t) { S.dense.set(function (r, c) { return (r + c) / 17 < t ? 0.85 : 0.12; }); }, 'linear');
          }).then(function () {
            S.dense.set(function () { return 0.55; });
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the router and eight experts */
            return ctx.reveal(B, { from: 'up' }).then(function () {
              return ctx.pulse(S.router, { color: 'magenta', dur: 600 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: only two experts run; gated outputs are summed */
            pick();
            return Promise.all([ctx.packet(S.fan[2], { color: 'violet', dur: 600 }), ctx.packet(S.fan[5], { color: 'teal', dur: 600 })]).then(function () {
              return Promise.all([ctx.packet(S.outs[2], { color: 'violet', dur: 600 }), ctx.packet(S.outs[5], { color: 'teal', dur: 600 })]);
            }).then(function () {
              return ctx.pulse(S.sum, { color: 'amber', dur: 500 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: total versus active parameters */
            ctx.reveal(C, { from: 'right', dur: 600 });
            return ctx.tween(1100, bars, 'out', 400);
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: what the sparsity costs */
            ctx.reveal(W, { from: 'up', dur: 600 });
            return ctx.reveal(W.lines, { from: 'left', dur: 400, stagger: 220, delay: 300 });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'The router',
        beats: [
          {
            say: 'The router is almost embarrassingly small: one matrix that maps the token\'s hidden vector to one score per expert.',
            card: { tag: 'NUMBERS', title: 'A tiny router', stat: { v: '1.8 M', l: 'router weights per DeepSeek-V3 layer (7168 × 256), against about 11 B of expert weights' } },
            deep: '<div class="eq">z = x W<sub>r</sub> ∈ ℝ<sup>E</sup>, &nbsp; W<sub>r</sub> ∈ ℝ<sup>d×E</sup></div>' +
              '<p>The router is tiny (7168 × 256 = 1.8 M params per DeepSeek-V3 layer, 4096 × 8 = 32.8 K in Mixtral) but numerically sensitive: it is usually kept in FP32, and ST-MoE adds a <b>router z-loss</b> 10<sup>−3</sup>·(log Σ<sub>j</sub> e<sup>z<sub>j</sub></sup>)² to keep logits small and training stable.</p>'
          },
          {
            say: 'Softmax turns the scores into probabilities, and top k keeps only the best few: here experts three and six survive.',
            card: { tag: 'HOW IT WORKS', title: 'Softmax, then top-k', body: 'Probabilities over all eight experts, then keep the two largest. TopK itself is not differentiable.' },
            deep: '<p>TopK is not differentiable; gradients reach the router only through the gate values g<sub>i</sub> of the <i>selected</i> experts (plus balance losses). The router therefore learns from the experts it chose, never from the ones it skipped, which is one root of the load-balancing problem in the next steps.</p>' +
              '<pre>logits = x @ W_r         # [T, E]\ntopv, topi = logits.topk(k, -1)\n# dispatch token t to topi[t]</pre>'
          },
          {
            say: 'Mixtral keeps two of eight and renormalizes their weights, here sixty two and thirty eight percent.',
            card: { tag: 'NUMBERS', title: 'Gates after renormalising', stat: { v: '0.62 · 0.38', l: 'weights of the two surviving experts: a softmax over just their logits' }, more: '<p>For two survivors with logits z<sub>3</sub> = 2.1 and z<sub>6</sub> = 1.6: g<sub>3</sub> = e<sup>2.1</sup>/(e<sup>2.1</sup> + e<sup>1.6</sup>) = 1/(1 + e<sup>−0.5</sup>) = σ(0.5) = 0.622 and g<sub>6</sub> = 0.378. Renormalising over the top-k makes the gates independent of the logits of skipped experts; Switch instead keeps the raw softmax probability, so the gate magnitude also carries confidence.</p>' },
            deep: '<div class="eq">g = softmax(TopK(z, 2)) &nbsp;⇒&nbsp; g<sub>3</sub> = σ(z<sub>3</sub> − z<sub>6</sub>) = σ(0.5) = 0.62</div>' +
              '<ul><li><b>Mixtral</b>: g = softmax(TopK(z, 2)) over the selected logits.</li>' +
              '<li><b>Switch / GShard</b>: p = softmax(z) over all E, keep top-1 / top-2 values (unnormalised in Switch).</li></ul>' +
              '<p>With two survivors the renormalised softmax collapses to a sigmoid of the logit difference.</p>'
          },
          {
            say: 'DeepSeek V3 instead uses a sigmoid affinity per expert, picks eight of two hundred fifty six, and normalizes among the chosen ones. Everything downstream is a weighted sum using these gates.',
            card: { tag: 'STATE OF THE ART', title: 'Sigmoid gates, top-8 of 256', body: 'Independent sigmoid affinities, top eight, renormalised among the chosen: experts no longer compete for one probability budget.' },
            deep: '<p><b>DeepSeek-V3</b>: s<sub>i</sub> = σ(u<sub>t</sub>ᵀe<sub>i</sub>) (sigmoid affinity with a learned centroid e<sub>i</sub>), select top-8 of 256, g<sub>i</sub> = s<sub>i</sub> / Σ<sub>j∈TopK</sub> s<sub>j</sub>. Because each affinity is an independent sigmoid, raising one expert’s score does not lower the others’, unlike a softmax.</p>' +
              '<pre>s = sigmoid(x @ E.T)               # [T, 256] independent affinities\n_, idx = (s + bias).topk(8, -1)    # bias steers SELECTION only\ng = s.gather(-1, idx)\ng = g / g.sum(-1, keepdim=True)    # renormalise the chosen 8\ny = shared(x) + sum(g_i * expert_i(x) for i in idx)</pre>' +
              '<p>The <code>bias</code> is the load-balancing mechanism of step 5 (zero here). V3 additionally restricts every token to experts on at most 4 nodes, so the router is also a communication planner.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var p = softmax(LOGITS);
          var top = [2, 5];
          var gz = softmax([LOGITS[2], LOGITS[5]]);
          var L = card(ctx, g, 60, 176, 820, 684, 'magenta', 'ROUTER FOR ONE TOKEN (x = "fox" · Mixtral: d = 4096, E = 8)');
          var xr = ctx.rng(21);
          ctx.text(100, 222, 'x', { size: 14, font: 'mono', weight: 700, color: 'cyan', anchor: 'middle', parent: L });
          S.xv = ctx.vector(90, 236, 12, { cell: 20, gap: 3, cmap: 'diverge', values: function () { return xr() * 2 - 1; }, parent: L });
          ctx.text(126, 374, '·', { size: 22, color: 'white', anchor: 'middle', parent: L });
          ctx.text(240, 222, 'W_r   d × E', { size: 14, font: 'mono', weight: 700, color: 'magenta', anchor: 'middle', parent: L });
          S.wr = ctx.matrix(150, 236, 12, 8, { cell: 20, gap: 3, cmap: 'diverge', values: function () { return (xr() * 2 - 1) * 0.7; }, parent: L });
          S.colHi = ctx.rect(148, 232, 24, 280, { rx: 4, stroke: 'white', sw: 1.6, parent: L });
          S.colHi.setAttribute('opacity', 0);
          ctx.text(360, 374, '=', { size: 20, color: 'white', anchor: 'middle', parent: L });

          var BX = 400, BW = 44, BP = 56, Z0 = 380, ZU = 55;
          ctx.text(BX, 222, 'logits z = x·W_r', { size: 14, font: 'mono', weight: 700, color: 'text', parent: L });
          ctx.line(BX - 6, Z0, BX + 8 * BP, Z0, { color: ctx.alpha('white', 0.25), parent: L });
          S.zb = LOGITS.map(function (z, i) {
            var b = ctx.rect(BX + i * BP, Z0, BW, 0, { rx: 3, fill: ctx.alpha(EC[i], 0.5), stroke: EC[i], sw: 1, parent: L });
            var t = ctx.text(BX + i * BP + BW / 2, z >= 0 ? Z0 - z * ZU - 10 : Z0 - z * ZU + 12, z.toFixed(1), { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: L });
            t.setAttribute('opacity', 0);
            ctx.text(BX + i * BP + BW / 2, 480, 'E' + (i + 1), { size: 12, font: 'mono', color: EC[i], anchor: 'middle', parent: L });
            return { b: b, t: t, z: z };
          });
          ctx.para(100, 600, ['W_r is tiny:', 'Mixtral', ' 4096 × 8', ' = 32.8 K', 'DeepSeek-V3', ' 7168 × 256', ' ≈ 1.8 M', '(FP32 in', ' practice)'], { size: 12, font: 'code', color: 'dim', lh: 20, parent: L });
          keepWS(L);

          /* probabilities, top-2 and gates (revealed in later beats) */
          var pG = ctx.group({ parent: L });
          var P0 = 760, PU = 300;
          ctx.text(BX, 526, 'p = softmax(z)   →   top-2   →   renormalise', { size: 14, font: 'mono', weight: 700, color: 'text', parent: pG });
          ctx.line(BX - 6, P0, BX + 8 * BP, P0, { color: ctx.alpha('white', 0.25), parent: pG });
          S.pb = p.map(function (v, i) {
            var b = ctx.rect(BX + i * BP, P0, BW, 0, { rx: 3, fill: ctx.alpha(EC[i], 0.5), stroke: EC[i], sw: 1, parent: pG });
            var t = ctx.text(BX + i * BP + BW / 2, P0 - v * PU - 10, v.toFixed(2), { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: pG });
            t.setAttribute('opacity', 0);
            ctx.text(BX + i * BP + BW / 2, 780, 'E' + (i + 1), { size: 12, font: 'mono', color: EC[i], anchor: 'middle', parent: pG });
            return { b: b, t: t, v: v };
          });
          hide(pG);
          S.gates = [0, 1].map(function (j) {
            var i = top[j];
            var t = ctx.label(BX + i * BP + BW / 2, 584, 'g = ' + gz[j].toFixed(2), { color: EC[i], size: 12, parent: L });
            t.setAttribute('opacity', 0);
            return t;
          });

          var R = textCard(ctx, g, 910, 176, 630, 330, 'amber', 'GATING VARIANTS', [
            'Mixtral      g = softmax( TopK(z, 2) )',
            'Switch       p = softmax(z), keep top-1',
            'DeepSeek-V3  s_i = sigmoid( u · e_i )',
            '             top-8 of 256 by s_i',
            '             g_i = s_i / Σ_TopK s_j',
            'all          y = Σ_TopK g_i · E_i(x)'
          ], { size: 14, lh: 42, top: 62 });
          hide(R);
          var K = ctx.code({ x: 910, y: 530, w: 630, title: 'router.py', lang: 'py', size: 13, parent: g, lines: [
            'logits = x @ W_r                  # [T, E]',
            'topv, topi = logits.topk(k, dim=-1)',
            'gates = topv.softmax(dim=-1)      # renormalise',
            'z_loss = 1e-3 * logits.logsumexp(-1).pow(2).mean()',
            'for e in range(E):                # dispatch',
            '    t, slot = (topi == e).nonzero(as_tuple=True)',
            '    y[t] += gates[t, slot, None] * experts[e](x[t])'
          ] });
          keepWS(K);
          hide(K);

          function setZ(t) { S.zb.forEach(function (o) { var h = Math.abs(o.z) * ZU * t; o.b.setAttribute('y', o.z >= 0 ? Z0 - h : Z0); o.b.setAttribute('height', h); }); }
          function setP(t) { S.pb.forEach(function (o) { var h = o.v * PU * t; o.b.setAttribute('y', P0 - h); o.b.setAttribute('height', h); }); }
          function pick() {
            S.pb.forEach(function (o, i) { if (top.indexOf(i) < 0) { o.b.setAttribute('opacity', 0.25); o.t.setAttribute('opacity', 0.35); } });
          }
          setZ(0); setP(0);

          /* beat 0: one small matrix maps the token to one score per expert */
          ctx.reveal(L, { from: 'left' });
          return ctx.wait(800).then(function () {
            S.colHi.setAttribute('opacity', 1);
            return ctx.tween(1600, function (t) {
              var c = Math.min(7, Math.floor(t * 8));
              S.colHi.setAttribute('x', 148 + c * 23);
              S.zb.forEach(function (o, i) {
                var f = ctx.clamp(t * 8 - i, 0, 1), h = Math.abs(o.z) * ZU * f;
                o.b.setAttribute('y', o.z >= 0 ? Z0 - h : Z0); o.b.setAttribute('height', h);
                if (f >= 1) o.t.setAttribute('opacity', 1);
              });
            }, 'linear');
          }).then(function () {
            S.colHi.setAttribute('opacity', 0);
            setZ(1);
            S.zb.forEach(function (o) { o.t.setAttribute('opacity', 1); });
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: softmax, then top-2 */
            ctx.reveal(pG, { dur: 400 });
            return ctx.tween(900, setP, 'out').then(function () {
              S.pb.forEach(function (o) { o.t.setAttribute('opacity', 1); });
              return ctx.wait(500);
            }).then(function () {
              pick();
              return ctx.pulse(S.pb[2].b, { color: 'violet', dur: 600 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: renormalise the survivors, 0.62 and 0.38 */
            return ctx.reveal(S.gates, { from: 'down', stagger: 200, dur: 500 }).then(function () {
              return Promise.all(S.gates.map(function (t) { return ctx.pulse(t, { color: 'amber', dur: 600 }); }));
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: other gating variants, and the code */
            ctx.reveal(R, { from: 'right', dur: 600 });
            return ctx.reveal(K, { from: 'up', dur: 600, delay: 300 });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Experts & combine',
        beats: [
          {
            say: 'Each expert is an ordinary SwiGLU feed forward network. The token is sent to its two chosen experts, in parallel.',
            card: { tag: 'HOW IT WORKS', title: 'Experts are ordinary FFNs', body: 'SwiGLU with the same shape as a dense MLP. Mixtral experts map 4096 to 14336 and back to 4096.' },
            deep: '<div class="eq">FFN<sub>i</sub>(x) = W<sub>2</sub><sup>(i)</sup> ( SiLU(W<sub>1</sub><sup>(i)</sup>x) ⊙ W<sub>3</sub><sup>(i)</sup>x )</div>' +
              '<p>Each expert has its own W<sub>1</sub>, W<sub>3</sub> (d × d<sub>ff</sub>) and W<sub>2</sub> (d<sub>ff</sub> × d). In Mixtral d<sub>ff</sub> = 14,336, so each expert has 3 · 4096 · 14336 = 176 M weights and one layer has 8 × 176 M = 1.4 B. Experts share no weights, which is what lets them specialise.</p>'
          },
          {
            say: 'Each output is scaled by its gate, and the results are summed back into the residual stream.',
            card: { tag: 'KEY IDEA', title: 'Gate, sum, add to residual', body: '<code>y = x + 0.62·E₃(x) + 0.38·E₆(x)</code>. The residual keeps the token; the experts add refinements.' },
            deep: '<div class="eq">Mixtral: y = x + Σ<sub>i∈Top2</sub> g<sub>i</sub> · FFN<sub>i</sub>(x)</div>' +
              '<p>The combine is a weighted sum of expert outputs, computed on the GPU that owns the token. Tokens are processed independently: two different tokens in the same sequence may use entirely different experts, which is why MoE routing is a per-token, not a per-sequence, decision.</p>'
          },
          {
            say: 'DeepSeek pushed this further with fine grained experts: two hundred fifty six small routed experts plus one shared expert that every token uses.',
            card: { tag: 'STATE OF THE ART', title: 'Fine-grained + shared', body: 'Split each expert into smaller ones and route to more of them. One always-on shared expert holds common knowledge.' },
            deep: '<table><tr><th></th><th>Mixtral 8×7B</th><th>DeepSeek-V3</th></tr>' +
              '<tr><td>d<sub>model</sub></td><td>4,096</td><td>7,168</td></tr>' +
              '<tr><td>expert d<sub>ff</sub></td><td>14,336</td><td>2,048</td></tr>' +
              '<tr><td>experts</td><td>8 routed, top-2</td><td>256 routed top-8 + 1 shared</td></tr>' +
              '<tr><td>MoE layers</td><td>32 of 32</td><td>58 of 61 (first 3 dense)</td></tr></table>' +
              '<p><b>Fine-grained</b> segmentation (split each expert into m smaller ones, route to m·k) keeps FLOPs constant while making routing far more expressive; the <b>shared expert</b> absorbs common knowledge so routed experts need not duplicate it (DeepSeekMoE).</p>'
          },
          {
            say: 'Eight of them fire per token, which gives hundreds of trillions of possible combinations, so experts can specialise sharply while the shared expert holds common knowledge.',
            card: { tag: 'NUMBERS', title: 'Combinations explode', stat: { v: '4.1 × 10¹⁴', l: 'ways to choose 8 of 256 experts, against only 28 for top-2 of 8' }, more: '<p>C(256, 8) = 256! / (8! · 248!) ≈ 4.1 × 10<sup>14</sup>, versus C(8, 2) = 28. Fine-grained segmentation replaces one big expert by m small ones and routes to m·k of them at equal FLOPs: C(32, 8) ≈ 10<sup>7</sup> already at m = 4 from an 8-expert baseline. Combinatorial flexibility is not the same as usable specialisation, but it removes the bottleneck of forcing all knowledge into a few coarse experts.</p>' },
            deep: '<div class="eq">C(256, 8) ≈ 4.1×10<sup>14</sup> &nbsp; vs &nbsp; C(8, 2) = 28</div>' +
              '<p>The number of distinct expert subsets a token can select is the combinatorial capacity of the router. With fine-grained experts the model can compose narrow skills (a syntax pattern, a domain, a language) in many more ways at the same FLOPs. Each grid cell on the stage is one routed expert; the highlighted eight change from token to token.</p>'
          },
          {
            say: 'In one layer, nine of two hundred fifty seven experts run per token, about three and a half percent of the layer\'s weights.',
            card: { tag: 'NUMBERS', title: 'One layer in numbers', stat: { v: '3.5%', l: '9 of 257 experts active: about 0.4 B of 11.3 B expert weights in a layer' } },
            deep: '<div class="eq">h′ = h + FFN<sup>(s)</sup>(h) + Σ<sub>i=1..256</sub> g<sub>i</sub> FFN<sub>i</sub><sup>(r)</sup>(h), &nbsp; g<sub>i</sub> ≠ 0 for 8 experts</div>' +
              '<p>Per DeepSeek-V3 MoE layer: 257 experts × 3·7168·2048 ≈ 44 M params = 11.3 B, of which 9 experts (≈ 0.40 B, 3.5%) run per token. Multiplying by 58 MoE layers gives the ≈ 650 B expert weights that must be resident.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var L = card(ctx, g, 60, 176, 790, 380, 'amber', 'TOP-2 COMBINE (Mixtral-style)');
          ctx.label(110, 366, 'x', { color: 'cyan', size: 14, w: 40, parent: L });
          S.e3 = ctx.node({ x: 400, y: 266, w: 280, h: 70, title: 'expert 3 · SwiGLU', sub: '4096 → 14336 → 4096', color: 'violet', titleSize: 14, subSize: 11, parent: L });
          S.e6 = ctx.node({ x: 400, y: 466, w: 280, h: 70, title: 'expert 6 · SwiGLU', sub: '4096 → 14336 → 4096', color: 'teal', titleSize: 14, subSize: 11, parent: L });
          S.i3 = ctx.link({ x: 132, y: 366 }, S.e3, { color: 'violet', to: 'l', parent: L });
          S.i6 = ctx.link({ x: 132, y: 366 }, S.e6, { color: 'teal', to: 'l', parent: L });
          hide(L);
          var Lb = ctx.group({ parent: L });
          S.o3 = ctx.link(S.e3, { x: 676, y: 366 }, { color: 'violet', from: 'r', parent: Lb, label: '× g = 0.62', labelDy: -58 });
          S.o6 = ctx.link(S.e6, { x: 676, y: 366 }, { color: 'teal', from: 'r', parent: Lb, label: '× g = 0.38', labelDy: 58 });
          S.plus = ctx.circle(690, 366, 14, { fill: '#1a1206', stroke: 'amber', sw: 1.6, parent: Lb });
          ctx.text(690, 367, '+', { size: 16, color: 'amber', anchor: 'middle', weight: 700, parent: Lb });
          ctx.line(704, 366, 760, 366, { color: 'amber', sw: 1.4, arrow: true, parent: Lb });
          ctx.text(772, 366, 'y', { size: 14, font: 'mono', color: 'amber', parent: Lb });
          ctx.path('M110,386 V540 H690 V382', { stroke: ctx.alpha('white', 0.35), sw: 1.2, dash: '4 4', arrow: true, parent: Lb });
          ctx.text(400, 526, 'residual: y = x + 0.62·E₃(x) + 0.38·E₆(x)', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: Lb });
          hide(Lb);

          var R = card(ctx, g, 870, 176, 670, 380, 'lime', 'DeepSeek-V3 · 256 ROUTED + 1 SHARED');
          S.grid = ctx.matrix(890, 212, 16, 16, { cell: 16, gap: 3, parent: R, values: function () { return '#101a2c'; } });
          ctx.text(1041, 530, '256 routed experts (d_ff 2048)', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: R });
          S.shared = ctx.node({ x: 1360, y: 250, w: 280, h: 64, title: 'shared expert', sub: 'every token, always on', color: 'orange', titleSize: 15, subSize: 11, parent: R });
          var numsP = ctx.para(1226, 330, ['top-8 routed per token', 'C(256, 8) ≈ 4.1 × 10¹⁴', 'vs C(8, 2) = 28 (Mixtral)', '', '9 of 257 experts active', '≈ 3.5% of layer params'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: R });
          hide(R, numsP);

          var B = textCard(ctx, g, 60, 580, 1480, 280, 'amber', 'THE EQUATIONS', [
            'expert:        FFN_i(x) = W2 · ( SiLU(W1 · x) ⊙ W3 · x )',
            'Mixtral:       y = x + Σ_{i ∈ Top2} g_i · FFN_i(x)',
            'DeepSeek-V3:   h′ = h + FFN_shared(h) + Σ_{i ∈ Top8 of 256} g_i · FFN_i(h)',
            'fine-grained:  split each expert m ways, route to m·k → same FLOPs, far more combinations',
            'shared expert: common knowledge lives once, routed experts specialise'
          ], { lh: 40, top: 62 });
          hide(B, B.lines);

          var rr = ctx.rng(77);
          function choose() {
            var set = {};
            while (Object.keys(set).length < 8) set[Math.floor(rr() * 256)] = 1;
            S.grid.set(function (r, c) { return set[r * 16 + c] ? ctx.C.lime : '#101a2c'; });
          }

          /* beat 0: the token goes to its two chosen SwiGLU experts */
          return ctx.reveal(L, { from: 'left' }).then(function () {
            return ctx.wait(400);
          }).then(function () {
            return Promise.all([ctx.packet(S.i3, { color: 'violet', dur: 700 }), ctx.packet(S.i6, { color: 'teal', dur: 700 })]);
          }).then(function () {
            ctx.pulse(S.e3, { color: 'violet', dur: 600 });
            return ctx.pulse(S.e6, { color: 'teal', dur: 600 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: scale by the gates, sum, add to the residual */
            return ctx.reveal(Lb, { dur: 500 }).then(function () {
              return Promise.all([ctx.packet(S.o3, { color: 'violet', dur: 700 }), ctx.packet(S.o6, { color: 'teal', dur: 700 })]);
            }).then(function () {
              return ctx.pulse(S.plus, { color: 'amber', dur: 500 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: 256 small routed experts and a shared one */
            return ctx.reveal(R, { from: 'right', dur: 600 }).then(function () {
              return ctx.pulse(S.shared, { color: 'orange', dur: 800 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: eight routed experts fire per token, a new subset each time */
            choose();
            S.loops.push(ctx.loop((function () {
              var last = -1;
              return function (t) { var k = Math.floor(t / 0.9); if (k !== last) { last = k; choose(); } };
            })()));
            return ctx.reveal(numsP, { from: 'left', dur: 600 });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: the equations of one layer */
            ctx.reveal(B, { from: 'up', dur: 600 });
            return ctx.reveal(B.lines, { from: 'left', dur: 400, stagger: 220, delay: 300 });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Load imbalance',
        beats: [
          {
            say: 'Left alone, routing collapses. Experts that get picked early get trained more, get better, and get picked even more.',
            card: { tag: 'PITFALL', title: 'The rich get richer', body: 'Chosen experts get gradient, improve, and get chosen more. Unchecked, a few experts win and the rest never train.' },
            deep: '<p><b>Collapse</b> is a positive-feedback loop: selected experts receive gradient, improve, and are selected more. TopK routing gives the router no signal about experts it skipped, so a lead compounds. Shazeer et al. (2017) already needed noisy gating and importance losses to prevent it.</p>' +
              '<p>The visible symptom in a trained model: a handful of experts absorb most tokens while the others are dead weight, wasting the very capacity MoE was supposed to add.</p>'
          },
          {
            say: 'Here a batch of sixty four tokens piles onto two experts while the others starve for work.',
            card: { tag: 'NUMBERS', title: 'One expert takes half', stat: { v: '30 / 64', l: 'tokens land on expert 1 alone; the ideal load is 8 per expert' } },
            deep: '<pre>expert  E1 E2 E3 E4 E5 E6 E7 E8\ntokens  30  4 18  2  3  1  5  1</pre>' +
              '<p>64 tokens, top-1 for clarity, mean load 8. Two experts take 48 of 64 tokens; four experts see only one to three tokens each. Token counts are illustrative.</p>'
          },
          {
            say: 'Under expert parallelism the busiest GPU sets the pace for everyone, and overloaded experts start dropping tokens.',
            card: { tag: 'WHY IT MATTERS', title: 'The slowest GPU decides', body: 'A step waits for the busiest expert: 3.75 times the ideal time here. Starved experts waste memory and FLOPs.' },
            deep: '<ul><li><b>Systems cost</b>: with expert parallelism a step waits for the most loaded GPU; here max/mean load = 30/8 = 3.75 means 3.75× the ideal expert time.</li>' +
              '<li>With capacity limits, overloaded experts <b>drop tokens</b> (next steps); starved experts waste resident memory and idle FLOPs.</li>' +
              '<li><b>Router z-loss</b> (ST-MoE): 10<sup>−3</sup>·mean(logsumexp(z)²) keeps logits small and training stable, complementary to balance.</li></ul>'
          },
          {
            say: 'The classic fix from Switch and GShard is an auxiliary loss that multiplies each expert\'s share of tokens by its average router probability, which is smallest when the load is uniform.',
            card: { tag: 'KEY IDEA', title: 'Penalise concentration', body: 'f_i is the share of tokens, P_i the mean router probability. Their scaled sum is smallest when both are uniform.', more: '<p>Because f follows the argmax of the router probabilities, f and P are coupled. The loss is minimised, at value α, by uniform routing, and rises to α·E when one expert takes everything. Gradients flow only through P<sub>i</sub>, weighted by f<sub>i</sub>: the more tokens an expert receives, the harder the router is pushed to lower its probability.</p>' },
            deep: '<div class="eq">L<sub>aux</sub> = α · E · Σ<sub>i=1..E</sub> f<sub>i</sub> · P<sub>i</sub></div>' +
              '<p>f<sub>i</sub> = fraction of tokens dispatched to expert i (non-differentiable count), P<sub>i</sub> = mean router probability for expert i (differentiable). With both uniform at 1/E the loss equals α; any concentration raises it. Switch used α = 10<sup>−2</sup>.</p>' +
              '<p><b>The tension</b>: a large α forces uniformity that fights the language-modelling loss and hurts quality; too small and collapse returns. This trade-off motivated auxiliary-loss-free balancing.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          ctx.hud('');
          var L = card(ctx, g, 60, 176, 900, 420, 'red', 'ONE BATCH · 64 TOKENS · top-1 for clarity');
          S.src = [];
          for (var i = 0; i < 64; i++) S.src.push({ x: 100 + (i % 32) * 26, y: 226 + Math.floor(i / 32) * 22 });
          function binPos(e, k) { return { x: 110 + e * 110 + (k % 2) * 20, y: 560 - Math.floor(k / 2) * 12 }; }
          for (var e = 0; e < 8; e++) {
            ctx.rect(96 + e * 110, 380, 60, 196, { rx: 5, fill: ctx.alpha(EC[e], 0.05), stroke: ctx.alpha(EC[e], 0.4), sw: 1, parent: L });
            ctx.text(126 + e * 110, 588, 'E' + (e + 1), { size: 12, font: 'mono', weight: 700, color: EC[e], anchor: 'middle', parent: L });
          }
          S.cnt = [0, 1, 2, 3, 4, 5, 6, 7].map(function (e) { return ctx.text(126 + e * 110, 362, '', { size: 14, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: L }); });
          ctx.line(90, 514, 950, 514, { color: ctx.alpha('white', 0.3), dash: '4 4', parent: L });
          S.before = ctx.group({ parent: L });
          ctx.text(500, 290, 'dashed = before balancing: loads 30 · 4 · 18 · 2 · 3 · 1 · 5 · 1', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.before });
          SKEW.forEach(function (n, e) {
            var top = 560 - (Math.ceil(n / 2) - 1) * 12 - 7;
            ctx.rect(100 + e * 110, top, 52, 568 - top, { rx: 3, stroke: ctx.alpha(EC[e], 0.7), sw: 1.2, dash: '3 3', parent: S.before });
          });
          S.before.setAttribute('opacity', 0);
          ctx.text(946, 506, 'mean = 8', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          function assign(loads) {
            var out = [];
            loads.forEach(function (n, ei) { for (var j = 0; j < n; j++) out.push({ e: ei, k: j }); });
            return out;
          }
          S.A0 = assign(SKEW); S.A1 = assign(BAL);
          S.dots = S.src.map(function (p, i) { return ctx.rect(p.x - 7, p.y - 4, 16, 9, { rx: 2, fill: ctx.alpha(EC[S.A0[i].e], 0.8), parent: L }); });
          S.status = ctx.text(500, 316, '', { size: 14, font: 'mono', weight: 700, color: 'red', anchor: 'middle', parent: L });

          /* the feedback loop behind collapse */
          var loopG = ctx.group({ parent: L });
          var lp = [['picked more', 200], ['trained more', 400], ['better', 580], ['picked more', 760]];
          lp.forEach(function (q, k) {
            ctx.label(q[1], 322, q[0], { color: 'red', size: 12, parent: loopG });
            if (k < lp.length - 1) ctx.line(q[1] + 52 + (k === 0 ? 6 : 0), 322, lp[k + 1][1] - 52, 322, { color: ctx.alpha('red', 0.7), sw: 1.4, arrow: true, parent: loopG });
          });
          ctx.text(500, 296, 'positive feedback: the rich get richer', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: loopG });
          hide(L, loopG);

          var R = textCard(ctx, g, 990, 176, 550, 420, 'amber', 'SWITCH / GShard AUX LOSS', [
            'f_i = share of tokens sent to i',
            'P_i = mean router prob. of i',
            '',
            'L_aux = α · E · Σ_i f_i · P_i',
            'α ≈ 10⁻²;  minimum at f = P = 1/E',
            '',
            'z-loss: 10⁻³ · mean(logsumexp z)²',
            'too big α → fights the LM loss'
          ], { size: 14, lh: 40, top: 62 });
          hide(R);
          var B = textCard(ctx, g, 60, 620, 1480, 240, 'red', 'WHY IT MATTERS', [
            'rich get richer: chosen experts get gradient, improve, and get chosen more  →  routing collapse',
            'expert parallelism: the step waits for the busiest GPU; max/mean = 30 / 8 = 3.75× the ideal time',
            'with capacity limits, overloaded experts drop tokens; starved experts waste memory and FLOPs'
          ], { lh: 44, top: 64 });
          hide(B);

          function place(t0, t1, tt) {
            S.dots.forEach(function (d, i) {
              var a = t0 ? binPos(t0[i].e, t0[i].k) : S.src[i], b = binPos(t1[i].e, t1[i].k);
              d.setAttribute('x', ctx.lerp(a.x, b.x, tt) - 7);
              d.setAttribute('y', ctx.lerp(a.y, b.y, tt) - 4);
              d.setAttribute('fill', ctx.alpha(EC[(tt > 0.5 ? t1 : (t0 || t1))[i].e], 0.8));
            });
          }
          function counts(Ld) { S.cnt.forEach(function (c, e) { c.textContent = String(Ld[e]); c.setAttribute('fill', Ld[e] > 12 ? ctx.C.red : (Ld[e] < 5 ? ctx.C.dim : ctx.C.white)); }); }

          /* beat 0: collapse is a feedback loop */
          return ctx.reveal(L, { from: 'left' }).then(function () {
            return ctx.reveal(loopG, { from: 'up', dur: 600 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: 64 tokens pile onto two experts */
            ctx.fade(loopG, 0, 400);
            return ctx.wait(500).then(function () {
              return ctx.tween(1500, function (t) {
                S.dots.forEach(function (d, i) {
                  var f = ctx.clamp(t * 1.6 - i / 64 * 0.6, 0, 1);
                  var a = S.src[i], b = binPos(S.A0[i].e, S.A0[i].k);
                  d.setAttribute('x', ctx.lerp(a.x, b.x, f) - 7); d.setAttribute('y', ctx.lerp(a.y, b.y, f) - 4);
                });
              }, 'inOut');
            }).then(function () {
              counts(SKEW);
              S.status.textContent = 'no balancing: max/mean = 30 / 8 = 3.75';
              return ctx.pulse(S.cnt[0], { color: 'red', dur: 700 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the busiest GPU sets the pace */
            ctx.hud('max / mean expert load: 3.75');
            ctx.reveal(B, { from: 'up', dur: 600 });
            return ctx.pulse(S.cnt[0], { color: 'red', dur: 700, times: 2 });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the auxiliary loss rebalances the batch */
            ctx.hud('max / mean expert load: 3.75 → 1.13');
            ctx.reveal(R, { from: 'right', dur: 600 });
            S.before.setAttribute('opacity', 1);
            S.status.textContent = 'train with L_aux ...';
            S.status.setAttribute('fill', ctx.C.amber);
            return ctx.tween(1500, function (t) { place(S.A0, S.A1, t); }, 'inOut', 400).then(function () {
              counts(BAL);
              S.status.textContent = 'with L_aux: max/mean = 9 / 8 = 1.13';
              S.status.setAttribute('fill', ctx.C.lime);
            });
          });
        }
      }
            ,
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Aux-loss-free',
        beats: [
          {
            say: 'DeepSeek V3 balances without fighting the language modelling loss. Each expert gets a bias that is added to its affinity only when choosing the top k, never when weighting the output.',
            card: { tag: 'KEY IDEA', title: 'A bias for selection only', body: 'Bias b_i changes which experts are chosen, not how their outputs are weighted. The language-model gradient stays untouched.' },
            deep: '<div class="eq">selection: TopK<sub>i</sub>(s<sub>i,t</sub> + b<sub>i</sub>), &nbsp; gate: g<sub>i,t</sub> = s<sub>i,t</sub> / Σ<sub>j∈TopK</sub> s<sub>j,t</sub></div>' +
              '<p>The bias only changes <i>which</i> experts are chosen, not how their outputs are weighted, so the LM objective is untouched (unlike L<sub>aux</sub>, whose gradient flows into the router). The dashed bars on the stage show step 0: the collapsed loads from the previous step.</p>'
          },
          {
            say: 'After every training step, overloaded experts have their bias nudged down and underloaded experts nudged up. Watch the loads flatten while the biases drift apart.',
            card: { tag: 'NUMBERS', title: 'A tiny nudge each step', stat: { v: '0.001', u: 'γ', l: 'bias update speed for most of DeepSeek-V3 pre-training; b receives no gradient' } },
            deep: '<div class="eq">after each step: b<sub>i</sub> ← b<sub>i</sub> − γ · sign(load<sub>i</sub> − mean load)</div>' +
              '<ul><li>γ (bias update speed) = 0.001 for most of DeepSeek-V3 pre-training, 0 at the end; b receives no gradient, it is a controller state, not a parameter.</li>' +
              '<li>The rule is a simple integral controller on per-expert load, evaluated once per batch, so balance tracks the data instead of a fixed penalty.</li></ul>' +
              '<p class="muted">Loads and biases in the animation are illustrative (units of γ).</p>'
          },
          {
            say: 'A tiny sequence level balance loss and node limited routing act as guardrails, and no tokens are ever dropped.',
            card: { tag: 'KEY IDEA', title: 'Guardrails, no dropping', body: 'A sequence-wise balance loss with α = 10⁻⁴ prevents extreme imbalance inside one sequence. Each token touches at most four nodes.', more: '<p>Batch-level bias updates balance the <i>average</i> load, but one sequence (say, all code) can still swamp a few experts even when the batch is balanced. The sequence-wise loss is computed per sequence with α = 10<sup>−4</sup>, about 100 times weaker than Switch’s 10<sup>−2</sup>. Node-limited routing bounds every token’s InfiniBand fan-out to 4 nodes, which is what keeps all-to-all affordable at 256 experts.</p>' },
            deep: '<ul><li>A complementary <b>sequence-wise</b> balance loss with a tiny α = 10<sup>−4</sup> prevents extreme imbalance inside single sequences, where batch-level bias updates cannot help.</li>' +
              '<li><b>Node-limited routing</b>: each token’s 8 experts span at most 4 nodes (top experts chosen per node by summed affinity) to bound cross-node traffic.</li>' +
              '<li>Balanced loads mean <b>no token dropping</b>, in training or in inference.</li></ul>'
          },
          {
            say: 'The gradients stay clean, and the authors of the method report both better quality and better load balance than auxiliary loss training.',
            card: { tag: 'TRADE-OFF', title: 'Two ways to balance', body: 'Aux loss is soft but its gradient hurts quality when α is large. The bias tracks the load without touching the loss.' },
            deep: '<table><tr><th></th><th>aux loss</th><th>aux-loss-free</th></tr>' +
              '<tr><td>gradient into router</td><td>yes: α·E·Σ f<sub>i</sub>P<sub>i</sub></td><td>no: bias via sign rule</td></tr>' +
              '<tr><td>quality impact</td><td>hurts if α large</td><td>no interference gradient</td></tr>' +
              '<tr><td>dropping</td><td>capacity + drops</td><td>none</td></tr></table>' +
              '<p>Result reported by Wang et al. on models up to 3 B parameters trained on 200 B tokens: better performance and better load balance than aux-loss balancing; DeepSeek-V3 then adopted the method at 671 B scale. Qwen3 takes a different route, computing its balance loss over the global batch rather than each micro-batch, so that experts may specialise within a sequence; the shared aim is balance without distorting the training signal.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          ctx.hud('');
          var L = card(ctx, g, 60, 176, 780, 440, 'lime', 'LOADS (top) AND ROUTING BIASES b_i (bottom)');
          var LB = 400, LU = 5.5;
          S.it = ctx.text(820, 204, 'step 0', { size: 14, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: L });
          ctx.line(90, LB - 8 * LU, 820, LB - 8 * LU, { color: ctx.alpha('white', 0.35), dash: '4 4', parent: L });
          ctx.text(820, LB - 8 * LU - 10, 'mean', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          S.lb = []; S.bb = []; S.bt = [];
          var BZ = 520;
          ctx.line(90, BZ, 820, BZ, { color: ctx.alpha('white', 0.25), parent: L });
          for (var e = 0; e < 8; e++) {
            var x = 110 + e * 88;
            ctx.rect(x, LB - ITERS[0][e] * LU, 56, ITERS[0][e] * LU, { rx: 3, stroke: ctx.alpha(EC[e], 0.45), sw: 1, dash: '3 3', parent: L });
            S.lb.push(ctx.rect(x, LB, 56, 0, { rx: 3, fill: ctx.alpha(EC[e], 0.55), stroke: EC[e], sw: 1, parent: L }));
            ctx.text(x + 28, LB + 16, 'E' + (e + 1), { size: 12, font: 'mono', weight: 700, color: EC[e], anchor: 'middle', parent: L });
            S.bb.push(ctx.rect(x + 8, BZ, 40, 0, { rx: 3, fill: ctx.alpha('lime', 0.5), stroke: 'lime', sw: 1, parent: L }));
            S.bt.push(ctx.text(x + 28, 596, '0', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: L }));
          }
          ctx.text(820, 226, 'dashed = step 0 (collapsed)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          ctx.text(78, BZ, 'b', { size: 13, font: 'mono', weight: 700, color: 'lime', anchor: 'end', parent: L });
          hide(L);

          var R1 = textCard(ctx, g, 870, 176, 670, 120, 'lime', 'SELECTION vs GATING', [
            'select:  TopK_i ( s_i + b_i )    ← bias here only',
            'gate:    g_i = s_i / Σ_TopK s_j   (no bias)'
          ], { size: 14, lh: 30, top: 54 });
          var R2 = textCard(ctx, g, 870, 308, 670, 120, 'lime', 'UPDATE AFTER EACH STEP', [
            'b_i ← b_i − γ · sign(load_i − mean)',
            'γ = 0.001 · no gradient through b'
          ], { size: 14, lh: 30, top: 54 });
          var R3 = textCard(ctx, g, 870, 440, 670, 176, 'lime', 'GUARDRAILS', [
            '+ sequence-wise balance loss, α = 10⁻⁴',
            '+ node-limited: ≤ 4 nodes per token',
            '→ no token dropping at all'
          ], { size: 14, lh: 32, top: 56 });
          hide(R1, R2, R3);

          var B = card(ctx, g, 60, 640, 1480, 220, 'amber', 'TWO WAYS TO BALANCE');
          var rows = [['', 'gradient into router', 'quality impact', 'balance', 'dropping'],
            ['aux loss (Switch, GShard)', 'yes: α·E·Σ f_i P_i', 'hurts if α large', 'soft', 'capacity + drops'],
            ['aux-loss-free (DeepSeek-V3)', 'no: bias via sign rule', 'no interference', 'tracks load', 'none']];
          rows.forEach(function (r, i) {
            r.forEach(function (c, j) {
              ctx.text(84 + [0, 330, 640, 890, 1110][j], 694 + i * 50, c, { size: 14, font: 'mono', weight: i === 0 ? 700 : 400, color: i === 0 ? 'cyan' : (j === 0 ? 'white' : 'text'), parent: B });
            });
          });
          hide(B);

          var bias = [ITERS.map(function () { return [0, 0, 0, 0, 0, 0, 0, 0]; })][0];
          for (var s = 1; s < ITERS.length; s++) {
            for (var q = 0; q < 8; q++) bias[s][q] = bias[s - 1][q] - Math.sign(ITERS[s - 1][q] - 8);
          }
          function show(s0, s1, t) {
            for (var q = 0; q < 8; q++) {
              var l = ctx.lerp(ITERS[s0][q], ITERS[s1][q], t), h = l * LU;
              S.lb[q].setAttribute('y', LB - h); S.lb[q].setAttribute('height', h);
              var b = ctx.lerp(bias[s0][q], bias[s1][q], t), bh = Math.abs(b) * 14;
              S.bb[q].setAttribute('y', b >= 0 ? BZ - bh : BZ); S.bb[q].setAttribute('height', bh);
              S.bb[q].setAttribute('fill', ctx.alpha(b >= 0 ? 'lime' : 'red', 0.5));
              S.bb[q].setAttribute('stroke', ctx.C[b >= 0 ? 'lime' : 'red']);
              S.bt[q].textContent = (bias[s1][q] > 0 ? '+' : '') + bias[s1][q] + 'γ';
            }
          }
          show(0, 0, 1);
          S.bt.forEach(function (t) { t.textContent = '0'; });

          /* beat 0: selection uses the biased affinity, gating does not */
          ctx.reveal(L, { from: 'left' });
          return ctx.reveal(R1, { from: 'right', delay: 200 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: a sign rule flattens the loads, biases drift apart */
            ctx.reveal(R2, { from: 'right', dur: 500 });
            var chain = ctx.wait(700);
            [1, 2, 3, 4].forEach(function (s) {
              chain = chain.then(function () {
                S.it.textContent = 'step ' + s + ' · max/mean ' + (Math.max.apply(null, ITERS[s]) / 8).toFixed(2);
                return ctx.tween(900, function (t) { show(s - 1, s, t); }, 'inOut');
              }).then(function () { return ctx.wait(350); });
            });
            return chain;
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: guardrails */
            return ctx.reveal(R3, { from: 'right', dur: 600 });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: compare with the auxiliary loss */
            return ctx.reveal(B, { from: 'up', dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Capacity & dropping',
        beats: [
          {
            say: 'Hardware wants static shapes, so classic MoE gives every expert a fixed number of slots, its capacity: a capacity factor times the average tokens per expert.',
            card: { tag: 'KEY IDEA', title: 'Fixed slots per expert', body: 'Static shapes keep kernels and all-to-all buffers predictable. Each expert gets exactly C slots, no more.' },
            deep: '<p>GShard and Switch allocate a fixed-size buffer of C token slots per expert so every tensor has a static shape, which XLA/TPU compilers and all-to-all collectives require. C is a multiple, the <b>capacity factor</b> CF, of the perfectly balanced load T·k/E.</p>' +
              '<p>CF trades memory and compute padding against dropped tokens: GShard/Switch used 1.0–2.0 in training, often higher at evaluation.</p>'
          },
          {
            say: 'Here sixty four tokens with top two routing make one hundred twenty eight assignments, sixteen per expert on average, and a factor of one point two five gives twenty slots.',
            card: { tag: 'NUMBERS', title: 'Twenty slots per expert', stat: { v: '20', u: 'slots', l: 'C = ⌈1.25 · 64 · 2 / 8⌉, against 16 assignments per expert on average' }, more: '<p>Expected load per expert is T·k/E = 64 · 2 / 8 = 16. The buffer must hold the <i>maximum</i> load, not the mean, and with skewed routing the maximum can be several times the mean, so CF is a knob between drops (small CF) and padding compute and memory (large CF). Padding slots are computed anyway: at CF = 1.25, up to 20% of expert FLOPs are spent on zeros even when routing is perfectly balanced.</p>' },
            deep: '<div class="eq">C = ⌈ CF · T · k / E ⌉ = ⌈1.25 · 64 · 2 / 8⌉ = 20 slots per expert</div>' +
              '<p>T = 64 tokens × k = 2 experts = 128 assignments over E = 8 experts: 16 per expert if perfectly balanced. CF = 1.25 leaves 25% headroom for imbalance, at the price of 25% padding compute and buffer memory when the load is balanced.</p>'
          },
          {
            say: 'Expert one receives twenty six and expert three twenty two, so eight tokens overflow and are dropped: they skip the expert and ride the residual connection.',
            card: { tag: 'NUMBERS', title: 'Overflow is dropped', stat: { v: '6.3%', l: 'of assignments dropped here: 8 of 128, from experts 1 and 3' } },
            deep: '<p>Loads here: [26, 12, 22, 10, 14, 11, 19, 14] → 6 + 2 = 8 of 128 assignments dropped (6.3%). A dropped token gets no update from that expert; with top-2 it may still get its other expert, and the residual connection carries it through the layer unchanged.</p>' +
              '<p>Dropping is silent quality loss: the model trains on a different function than it evaluates when CF changes, and dropped tokens are systematically the ones routed to popular experts.</p>'
          },
          {
            say: 'Now turn the knob yourself. At a capacity factor of one, nearly fifteen percent of assignments are dropped; at one and a half almost none, but about a third of the buffer slots sit empty.',
            card: { tag: 'TRY IT', title: 'Turn the capacity knob', body: 'Click CF 1.0, 1.25 or 1.5 on the chart. Drops fall as capacity rises, but empty padded slots grow: you pay for a worst case that rarely happens.' },
            deep: '<table><tr><th>CF</th><th>C</th><th>dropped</th><th>empty slots</th></tr>' +
              '<tr><td>1.0</td><td>16</td><td>19 of 128 (14.8%)</td><td>19 of 128 (14.8%)</td></tr>' +
              '<tr><td>1.25</td><td>20</td><td>8 of 128 (6.3%)</td><td>40 of 160 (25%)</td></tr>' +
              '<tr><td>1.5</td><td>24</td><td>2 of 128 (1.6%)</td><td>66 of 192 (34%)</td></tr></table>' +
              '<p>With the loads [26, 12, 22, 10, 14, 11, 19, 14]: kept = Σ<sub>e</sub> min(load<sub>e</sub>, C) and empty = E·C − kept. Drops fall as C rises while the padding that the all-to-all and the expert GEMMs must still carry grows: the classic memory-versus-quality knob. Real loads change every batch, so production systems pick CF from measured load histograms, or go dropless.</p>' +
              '<p class="muted">Click a chip on the stage to replay the buffers at that factor. Loads are illustrative.</p>'
          },
          {
            say: 'Dropless systems use grouped matrix multiplies to avoid dropping entirely, and analyses of Mixtral show that routing follows syntax and token type more than topic.',
            card: { tag: 'STATE OF THE ART', title: 'Dropless grouped GEMMs', body: 'Sort tokens by expert and run variable-size GEMMs (MegaBlocks). No capacity, no padding, no dropped tokens.' },
            deep: '<ul><li><b>Dropless MoE</b>: sort tokens by expert and run a <b>grouped GEMM</b> over variable-size groups (MegaBlocks block-sparse kernels; cuBLAS/CUTLASS grouped GEMM). DeepSeek-V3 drops no tokens. The cost is dynamic shapes and load-dependent latency.</li>' +
              '<li><b>Specialisation</b>: Mixtral’s analysis found no obvious topic specialisation but some syntactic structure (for example the Python keyword <code>self</code>), and consecutive tokens often reuse the same expert; DeepSeekMoE argues that fine-grained and shared experts give sharper, less redundant experts.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          ctx.hud('');
          var LOADS = [26, 12, 22, 10, 14, 11, 19, 14];
          var TK = 128;                          /* assignments: 64 tokens x top-2 */
          S.cf = 1.25; S.C = 20;
          function capOf(cf) { return Math.ceil(cf * 16 - 1e-9); }
          function cfTxt(cf) { return cf === 1 ? '1.0' : String(cf); }
          function pct(v) { return (Math.round(v * 1000) / 10) + '%'; }
          function statsFor(C) { var kept = 0; LOADS.forEach(function (n) { kept += Math.min(n, C); }); return { drop: TK - kept, slots: 8 * C, empty: 8 * C - kept }; }
          var L = card(ctx, g, 60, 176, 1040, 440, 'amber', 'EXPERT BUFFERS · T = 64 tokens · top-2 · 8 experts');
          S.form = ctx.text(580, 244, 'capacity  C = ⌈ CF · T·k / E ⌉  slots per expert', { size: 16, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: L });
          S.slots = []; S.over = []; S.lt = []; S.bins = []; S.overY = [];
          for (var e = 0; e < 8; e++) {
            var x0 = 90 + e * 125;
            S.bins.push(ctx.rect(x0 - 4, 414, 100, 126, { rx: 5, fill: ctx.alpha(EC[e], 0.04), stroke: ctx.alpha(EC[e], 0.5), sw: 1, parent: L }));
            ctx.text(x0 + 46, 556, 'E' + (e + 1), { size: 13, font: 'mono', weight: 700, color: EC[e], anchor: 'middle', parent: L });
            var lt = ctx.text(x0 + 46, 330, 'load ' + LOADS[e], { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: L });
            lt.setAttribute('opacity', 0);
            S.lt.push(lt);
            /* 24 slot outlines exist (enough for CF 1.5); only the first C are shown */
            var sl = [];
            for (var k = 0; k < 24; k++) sl.push(ctx.rect(x0 + (k % 4) * 23, 520 - Math.floor(k / 4) * 24, 19, 19, { rx: 3, fill: '#0b1222', stroke: ctx.alpha(EC[e], 0.25), sw: 0.8, parent: L }));
            S.slots.push(sl);
            /* overflow squares sit above the capacity line; up to load − 16 of them are needed (CF 1.0) */
            var ov = [];
            for (var k2 = 0; k2 < Math.max(0, LOADS[e] - 16); k2++) ov.push(ctx.rect(x0 + (k2 % 4) * 23, 386 - Math.floor(k2 / 4) * 24, 19, 19, { rx: 3, fill: ctx.alpha('red', 0.75), stroke: 'red', sw: 1, parent: L }));
            S.over.push(ov);
          }
          S.capLine = ctx.line(80, 412, 1090, 412, { color: 'red', sw: 1.5, dash: '6 4', parent: L });
          S.capLbl = ctx.text(1090, 402, 'capacity', { size: 11, font: 'mono', color: 'red', anchor: 'end', parent: L });
          S.avg = ctx.group({ parent: L });
          ctx.line(80, 446, 1090, 446, { color: ctx.alpha('amber', 0.8), sw: 1.2, dash: '3 4', parent: S.avg });
          S.avgT = ctx.text(84, 290, 'amber dashes = balanced load (16 per expert) · red dashes = capacity (20)', { size: 11, font: 'mono', color: 'amber', parent: S.avg });
          hide(S.avg);
          S.drop = ctx.group({ parent: L });
          ctx.rect(84, 574, 1000, 30, { rx: 6, fill: ctx.alpha('red', 0.08), stroke: ctx.alpha('red', 0.5), sw: 1, dash: '4 4', parent: S.drop });
          ctx.text(96, 589, 'dropped → skip the expert, pass through the residual only', { size: 12, font: 'mono', color: 'red', parent: S.drop });
          S.dropped = ctx.text(1070, 589, '', { size: 12, font: 'mono', weight: 700, color: 'red', anchor: 'end', parent: S.drop });
          hide(S.drop);
          /* capacity-factor chips (live from the TRY IT beat on) */
          S.chips = [1.0, 1.25, 1.5].map(function (cf, i) {
            var c = ctx.label(800 + i * 118, 290, 'CF ' + cfTxt(cf), { color: 'amber', size: 12, w: 104, parent: L });
            c.style.cursor = 'pointer';
            c.cf = cf;
            c.setAttribute('opacity', 0);
            return c;
          });
          [].concat.apply([], S.over).forEach(function (r) { r.setAttribute('opacity', 0); });
          hide(L);

          var R = textCard(ctx, g, 1130, 176, 410, 440, 'red', 'THE TRADE-OFF', [
            'capacity factor  CF = 1.25',
            'slots per expert C = 20',
            '',
            'dropped     8 / 128 = 6.3%',
            'empty slots 40 / 160 = 25%',
            '',
            'CF up: fewer drops,',
            '       more padding',
            '',
            'DeepSeek-V3: no drops',
            '(bias balancing + dropless)'
          ], { size: 14, lh: 30, top: 58 });
          hide(R);
          R.lines[4].setAttribute('opacity', 0);
          var B1 = textCard(ctx, g, 60, 640, 720, 220, 'violet', 'EXPERT SPECIALISATION', [
            'Mixtral: routing tracks token type & syntax',
            '  (e.g. Python self) more than topic',
            'consecutive tokens often reuse one expert',
            'fine-grained + shared → sharper experts'
          ], { lh: 34, top: 58 });
          var B2 = textCard(ctx, g, 800, 640, 740, 220, 'teal', 'DROPLESS COMPUTE', [
            'sort tokens by expert → variable-size groups',
            'grouped GEMM / block-sparse (MegaBlocks)',
            'no capacity, no padding, no dropped tokens',
            'cost: dynamic shapes, load-dependent latency'
          ], { lh: 34, top: 58 });
          hide(B1, B2);

          /* geometry for a capacity C (a multiple of 4): bins shrink or grow, the capacity line and the overflow squares follow */
          function layout(C) {
            var binTop = 520 - (C / 4 - 1) * 24 - 8, ly = binTop - 3;
            for (var e = 0; e < 8; e++) {
              S.bins[e].setAttribute('y', binTop); S.bins[e].setAttribute('height', 540 - binTop);
              S.slots[e].forEach(function (r, k) { r.setAttribute('opacity', k < C ? 1 : 0); });
              S.over[e].forEach(function (r, k) { var y = ly - 26 - Math.floor(k / 4) * 24; r.setAttribute('y', y); });
              S.lt[e].setAttribute('fill', LOADS[e] > C ? ctx.C.red : ctx.C.text);
            }
            S.capLine.setAttribute('y1', ly); S.capLine.setAttribute('y2', ly);
            S.capLbl.setAttribute('y', ly - 10);
            S.avgT.textContent = 'amber dashes = balanced load (16 per expert) · red dashes = capacity (' + C + ')';
          }
          function fill(t) {
            var C = S.C;
            for (var e = 0; e < 8; e++) {
              var n = Math.min(C, Math.round(LOADS[e] * t));
              S.slots[e].forEach(function (r, k) { r.setAttribute('fill', k < n ? ctx.alpha(EC[e], 0.75) : '#0b1222'); });
              var ov = Math.max(0, Math.round(LOADS[e] * t) - C);
              S.over[e].forEach(function (r, k) { r.setAttribute('opacity', k < ov ? 1 : 0); });
            }
          }
          /* overflow squares fall towards the "dropped" strip and are left as faint ghosts */
          function dropAnim() {
            var list = [];
            S.over.forEach(function (arr, e) { var ov = Math.max(0, LOADS[e] - S.C); arr.forEach(function (r, k) { if (k < ov) list.push(r); }); });
            return Promise.all(list.map(function (r, i) {
              var y0 = parseFloat(r.getAttribute('y'));
              return ctx.tween(700, function (t) { r.setAttribute('y', y0 + (580 - y0) * t); r.setAttribute('opacity', 1 - 0.65 * t); }, 'in', i * 60).then(function () { r.setAttribute('y', y0); });
            }));
          }
          /* the whole picture for a capacity factor; also rewrites the trade-off card */
          function setCF(cf) {
            S.cf = cf; S.C = capOf(cf);
            layout(S.C); fill(1);
            var s = statsFor(S.C);
            S.form.textContent = 'C = ⌈CF · T·k / E⌉ = ⌈' + cfTxt(cf) + ' · 64·2 / 8⌉ = ' + S.C + ' slots';
            S.dropped.textContent = s.drop + ' dropped';
            R.lines[0].textContent = 'capacity factor  CF = ' + cfTxt(cf);
            R.lines[1].textContent = 'slots per expert C = ' + S.C;
            R.lines[3].textContent = 'dropped     ' + s.drop + ' / ' + TK + ' = ' + pct(s.drop / TK);
            R.lines[4].textContent = 'empty slots ' + s.empty + ' / ' + s.slots + ' = ' + pct(s.empty / s.slots);
            S.chips.forEach(function (c) {
              var on = c.cf === cf;
              c.rectEl.setAttribute('fill', on ? ctx.alpha('amber', 0.5) : ctx.alpha('amber', 0.12));
              c.rectEl.setAttribute('stroke-width', on ? 2.4 : 1);
            });
            ctx.hud('CF ' + cfTxt(cf) + ' · C = ' + S.C + ' · dropped ' + pct(s.drop / TK));
          }
          layout(20);
          S.chips.forEach(function (c) {
            c.addEventListener('click', function (ev) {
              ev.stopPropagation();
              if (!S.interactive || S.busy || S.cf === c.cf) return;
              S.busy = true;
              setCF(c.cf);
              dropAnim().then(function () { S.busy = false; });
            });
          });

          /* beat 0: eight buffers with a fixed capacity */
          return ctx.reveal(L, { from: 'left' }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the arithmetic of capacity */
            S.form.textContent = 'C = ⌈CF · T·k / E⌉ = ⌈1.25 · 64·2 / 8⌉ = 20 slots';
            ctx.reveal(S.avg, { dur: 500 });
            return ctx.pulse(S.form, { color: 'amber', dur: 700, times: 2 });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: routing fills the buffers; two experts overflow and drop tokens */
            ctx.reveal(R, { from: 'right', dur: 600 });
            fill(0);
            return ctx.tween(2200, fill, 'linear', 300).then(function () {
              fill(1);
              S.lt.forEach(function (t) { t.setAttribute('opacity', 1); });
              ctx.pulse(S.lt[0], { color: 'red', dur: 600 });
              return ctx.pulse(S.lt[2], { color: 'red', dur: 600 });
            }).then(function () {
              return dropAnim();
            }).then(function () {
              S.dropped.textContent = '8 dropped';
              ctx.reveal(S.drop, { dur: 400 });
              return ctx.pulse(S.drop, { color: 'red', dur: 600 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the capacity knob: the chips appear and the stage sweeps CF 1.0 → 1.5 → 1.25; then they go live */
            S.busy = true;
            ctx.reveal(S.chips, { from: 'down', stagger: 120, dur: 400 });
            ctx.reveal(R.lines[4], { from: 'left', dur: 400, delay: 300 });
            var seq = [1.0, 1.5, 1.25], ch = ctx.wait(500);
            seq.forEach(function (cf) {
              ch = ch.then(function () { setCF(cf); return dropAnim(); }).then(function () { return ctx.wait(900); });
            });
            return ch.then(function () {
              S.interactive = true;
              S.busy = false;
              ctx.hud('');
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: dropless compute and specialisation */
            return ctx.reveal([B2, B1], { from: 'up', stagger: 200, dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Expert parallelism',
        beats: [
          {
            say: 'Two hundred fifty six experts do not fit on one GPU, so they are spread across many: expert parallelism.',
            card: { tag: 'KEY IDEA', title: 'Experts spread across GPUs', body: 'Here each of four GPUs holds two experts. DeepSeek-V3 decode uses 320 GPUs, roughly one routed expert each.' },
            deep: '<p><b>Expert parallelism</b> (EP) shards the expert set across GPUs: with EP = 4 and E = 8, GPU q owns experts 2q+1 and 2q+2. Attention and the router are replicated or data-parallel, so every GPU holds its own tokens but only some of the experts.</p>' +
              '<p>Scale: one DeepSeek-V3 MoE layer has 11.3 B parameters, i.e. 11.3 GB in FP8; 58 such layers are ≈ 650 GB, which is why experts must be distributed.</p>'
          },
          {
            say: 'Every MoE layer then needs two all to all exchanges. Dispatch sends each token\'s hidden vector to the GPUs that hold its chosen experts.',
            card: { tag: 'HOW IT WORKS', title: 'Dispatch sends tokens out', body: 'Each token\'s hidden vector, 7168 numbers, travels to the owners of its top-8 experts, often on other nodes.' },
            deep: '<ul><li><b>Dispatch</b>: token t sends x<sub>t</sub> (d = 7168) to the GPUs owning its top-k experts.</li>' +
              '<li>DeepSeek-V3 training: dispatch in FP8, combine in BF16; NVLink ≈ 160 GB/s vs InfiniBand ≈ 50 GB/s per GPU, so each token may touch at most <b>4 nodes</b>; IB traffic is sent once per node and forwarded over NVLink.</li></ul>' +
              '<div class="eq">dispatch bytes/token ≈ k · d · 1 B (FP8) ≈ 8 · 7168 ≈ 57 KB (before node dedup)</div>'
          },
          {
            say: 'The experts run their feed forward passes, and combine sends the weighted results back to each token\'s home GPU, where they are summed.',
            card: { tag: 'HOW IT WORKS', title: 'Combine: results come home', body: 'Outputs g_i·FFN_i(x_t) return to the token\'s origin GPU and are summed into the residual stream.' },
            deep: '<p><b>Combine</b> returns g<sub>i</sub>·FFN<sub>i</sub>(x<sub>t</sub>) to the origin GPU, where the k results are summed. On the receive side, grouped GEMM processes all tokens for the local experts in one launch, so a GPU with 2 experts and 300 received tokens does two large matmuls rather than 300 small ones.</p>'
          },
          {
            say: 'This communication is huge, so production systems split the batch into micro batches and overlap one batch\'s all to all with another batch\'s computation, hiding most of the network time.',
            card: { tag: 'NUMBERS', title: 'Comms with few SMs', stat: { v: '20 / 132', u: 'SMs', l: 'DeepSeek-V3\'s custom all-to-all kernels (open-sourced as DeepEP) need only 20 SMs to saturate NVLink and InfiniBand' } },
            deep: '<ul><li>DeepSeek-V3’s custom all-to-all kernels (open-sourced as <b>DeepEP</b>) need only <b>20 of 132 SMs</b> to saturate IB and NVLink, leaving the rest for GEMMs.</li>' +
              '<li><b>Overlap</b>: DualPipe (training) interleaves forward and backward chunks of two micro-batches so attention/MLP compute hides dispatch/combine; inference overlaps two micro-batches the same way.</li></ul>' +
              '<p>Schematic timeline: 16 units serially, 10 units when the network is hidden behind compute.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          ctx.hud('');
          var G = card(ctx, g, 60, 176, 1050, 400, 'red', 'EP = 4 · 8 experts · 2 per GPU · 8 tokens per GPU (top-1 drawn)');
          var rr = ctx.rng(5);
          S.gpus = []; S.tok = []; S.expN = [];
          var recv = [0, 0, 0, 0];
          for (var q = 0; q < 4; q++) {
            var x0 = 80 + q * 258;
            var box = ctx.rect(x0, 212, 240, 350, { rx: 10, fill: ctx.alpha('red', 0.05), stroke: ctx.alpha('red', 0.6), sw: 1.3, parent: G });
            ctx.text(x0 + 14, 234, 'GPU ' + q, { size: 14, font: 'mono', weight: 700, color: 'red', parent: G });
            ctx.text(x0 + 226, 234, 'holds E' + (2 * q + 1) + ', E' + (2 * q + 2), { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: G });
            ctx.text(x0 + 14, 262, 'own tokens', { size: 11, font: 'mono', color: 'dim', parent: G });
            ctx.text(x0 + 14, 330, 'received for local experts', { size: 11, font: 'mono', color: 'dim', parent: G });
            [0, 1].forEach(function (k) {
              var e = 2 * q + k;
              S.expN[e] = ctx.node({ x: x0 + 62 + k * 116, y: 510, w: 100, h: 50, title: 'E' + (e + 1), color: EC[e], kind: 'chip', titleSize: 14, glow: false, parent: G });
            });
            S.gpus.push(box);
            for (var i = 0; i < 8; i++) {
              var dest = Math.floor(rr() * 8);
              var home = { x: x0 + 16 + i * 27, y: 276 };
              var dq = Math.floor(dest / 2);
              var slot = recv[dq]++;
              var away = { x: 80 + dq * 258 + 16 + (slot % 8) * 27, y: 344 + Math.floor(slot / 8) * 26 };
              var r = ctx.rect(home.x, home.y, 20, 20, { rx: 4, fill: ctx.alpha(EC[dest], 0.8), stroke: EC[dest], sw: 1, parent: G });
              S.tok.push({ r: r, home: home, away: away, dest: dest });
            }
          }
          hide(G);

          var R = textCard(ctx, g, 1130, 176, 410, 400, 'amber', 'ALL-TO-ALL, TWICE', [
            'dispatch: x_t → owners',
            '          of its top-k',
            'combine:  g_i·E_i(x_t) → home',
            '',
            'DeepSeek-V3:',
            ' FP8 dispatch, BF16 combine',
            ' NVLink 160 vs IB 50 GB/s',
            ' ≤ 4 nodes per token',
            ' comms kernels: 20 SMs'
          ], { size: 14, lh: 34, top: 58 });
          hide(R);

          /* overlap timeline */
          var T = card(ctx, g, 60, 596, 1480, 264, 'cyan', 'HIDING THE NETWORK: two micro-batches, compute overlaps communication');
          var X0 = 250, U = 60;
          function seg(row, t0, t1, col, lab) {
            var y = [650, 730, 790][row];
            var r = ctx.rect(X0 + t0 * U, y, (t1 - t0) * U - 3, 34, { rx: 4, fill: ctx.alpha(col, 0.45), stroke: col, sw: 1, parent: T });
            ctx.text(X0 + (t0 + t1) / 2 * U, y + 17.5, lab, { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: T });
            return r;
          }
          ctx.text(X0 - 14, 667, 'serial', { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: T });
          ctx.text(X0 - 14, 747, 'compute', { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: T });
          ctx.text(X0 - 14, 807, 'network', { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: T });
          var serial = [[0, 2, 'amber', 'attn'], [2, 4, 'red', 'dispatch'], [4, 6, 'lime', 'experts'], [6, 8, 'red', 'combine'], [8, 10, 'amber', 'attn'], [10, 12, 'red', 'dispatch'], [12, 14, 'lime', 'experts'], [14, 16, 'red', 'combine']];
          S.ser = serial.map(function (s) { return seg(0, s[0], s[1], s[2], s[3]); });
          var over = [[1, 0, 2, 'amber', 'attn A'], [1, 2, 4, 'amber', 'attn B'], [1, 4, 6, 'lime', 'exp A'], [1, 6, 8, 'lime', 'exp B'], [2, 2, 4, 'red', 'disp A'], [2, 4, 6, 'red', 'disp B'], [2, 6, 8, 'red', 'comb A'], [2, 8, 10, 'red', 'comb B']];
          S.ov = over.map(function (s) { return seg(s[0], s[1], s[2], s[3], s[4]); });
          ctx.text(X0 + 16 * U, 700, '16 units', { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: T });
          ctx.text(X0 + 10 * U + 12, 807, '→ 10 units: network hidden behind compute', { size: 12, font: 'mono', color: 'lime', parent: T });
          hide(T);

          function at(tt, back) {
            S.tok.forEach(function (o) {
              var a = back ? o.away : o.home, b = back ? o.home : o.away;
              o.r.setAttribute('x', ctx.lerp(a.x, b.x, tt)); o.r.setAttribute('y', ctx.lerp(a.y, b.y, tt));
            });
          }
          function ghosts() { S.tok.forEach(function (o) { ctx.rect(o.away.x, o.away.y, 20, 20, { rx: 4, stroke: ctx.alpha(EC[o.dest], 0.6), sw: 1, dash: '2 2', parent: G }); }); }

          /* beat 0: four GPUs, each holding two experts and its own tokens */
          return ctx.reveal(G, { from: 'left' }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: dispatch, the first all-to-all */
            ctx.reveal(R, { from: 'right', dur: 600 });
            return ctx.wait(500).then(function () {
              return ctx.tween(1400, function (t) { at(t, false); }, 'inOut');
            }).then(function () {
              ghosts();
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: experts run, combine sends results home */
            return Promise.all(S.expN.map(function (n, i) { return ctx.pulse(n, { color: EC[i], dur: 700 }); })).then(function () {
              S.tok.forEach(function (o) { o.r.setAttribute('stroke', ctx.C.white); });
              return ctx.tween(1400, function (t) { at(t, true); }, 'inOut');
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: overlap two micro-batches to hide the network */
            return ctx.reveal(T, { from: 'up', dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Serving economics',
        beats: [
          {
            say: 'At inference, a mixture of experts is cheap in compute but expensive in memory. All six hundred seventy one billion parameters must be resident, even though each token uses thirty seven billion.',
            card: { tag: 'NUMBERS', title: 'Memory is the bill', stat: { v: '671 GB', l: 'of FP8 weights resident for DeepSeek-V3: more than one 8×H100 node holds (640 GB)' } },
            deep: '<table><tr><th></th><th>DeepSeek-V3</th></tr>' +
              '<tr><td>resident weights (FP8)</td><td>≈ 671 GB: exceeds one 8×H100 node (640 GB); fits 8×H200 (1,128 GB)</td></tr>' +
              '<tr><td>FLOPs / token</td><td>≈ 2 × 37 B = 74 GFLOP (a dense 671 B would need ≈ 1.34 TFLOP)</td></tr></table>' +
              '<p>Compute per token is that of a 37 B model, but the memory footprint is that of a 671 B model, plus KV cache. Serving cost is therefore dominated by how many GPUs are needed to hold the weights.</p>'
          },
          {
            say: 'And efficiency depends on batch size: with one token, only eight experts wake up, each reading its weights for a single token, which is pure memory traffic.',
            card: { tag: 'HOW IT WORKS', title: 'One token, eight experts', body: 'At batch one each active expert streams its whole weight matrix from HBM to serve a single token: pure memory traffic.' },
            deep: '<div class="eq">E[# experts touched] = E · (1 − (1 − k/E)<sup>B</sup>) &nbsp; (B tokens, uniform routing)</div>' +
              '<p>DeepSeek-V3 (k = 8, E = 256): B = 1 → 8 experts. With FP8 weights each weight byte yields 2 FLOPs per token, so an expert GEMM needs <b>hundreds of tokens</b> to approach the H100 ridge; small batches are HBM-bound.</p>'
          },
          {
            say: 'With a batch of just one hundred twenty eight tokens, nearly every expert is busy, but each still sees only about four of them.',
            card: { tag: 'NUMBERS', title: 'A batch wakes everyone', stat: { v: '252 / 256', l: 'experts touched per layer at a batch of 128 tokens, about 4 tokens each' }, more: '<p>With uniform routing each token picks a given expert with probability k/E = 8/256 = 3.1%. After B tokens an expert is still untouched with probability (1 − k/E)<sup>B</sup>, so the expected number touched is E·(1 − (1 − k/E)<sup>B</sup>): 8 at B = 1, 163 at B = 32, 252 at B = 128. Real routing is skewed, so fewer distinct experts are touched, which makes small-batch serving even less efficient.</p>' },
            deep: '<p>B = 32 → ~163 experts touched (1.6 tokens each); B = 128 → ~252 experts (≈ 4 tokens each). Tokens per active expert ≈ B·k/touched, so even at B = 128 each expert GEMM is tiny and still memory-bound. Expert utilisation only approaches dense-model efficiency at batches of thousands of tokens.</p>'
          },
          {
            say: 'That is why MoE serving spreads experts over hundreds of GPUs and batches traffic from many users and agents.',
            card: { tag: 'WHY IT MATTERS', title: 'Batch across the fleet', body: 'Decode runs on 320 GPUs with about one expert each; prefill on 32. Hot experts are replicated from live load statistics.' },
            deep: '<table><tr><th></th><th>DeepSeek-V3 deployment</th></tr>' +
              '<tr><td>prefill</td><td>4 nodes / 32 GPUs, EP32</td></tr>' +
              '<tr><td>decode</td><td>40 nodes / 320 GPUs, EP320: ~1 expert per GPU, 64 GPUs for redundant + shared experts</td></tr></table>' +
              '<p>Hot experts are replicated (“redundant experts”) from live load statistics. For our trailer, this is why agent calls are batched fleet-wide: MoE makes each planning token cheap only when thousands of tokens share every expert pass.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var L = card(ctx, g, 60, 176, 760, 380, 'amber', 'EXPERTS TOUCHED PER LAYER vs BATCH (k = 8, E = 256)');
          var PX = 130, PY = 220, PW = 640, PH = 270;
          function f(lb) { var B = Math.pow(2, lb); return 256 * (1 - Math.pow(1 - 8 / 256, B)); }
          S.plot = ctx.plot(PX, PY, PW, PH, f, { xDomain: [0, 12], yDomain: [0, 260], color: 'amber', sw: 2.5, parent: L, samples: 96 });
          [0, 2, 4, 6, 8, 10, 12].forEach(function (lb) {
            var p = S.plot.toPx(lb, 0);
            ctx.text(p.x, PY + PH + 16, String(Math.pow(2, lb)), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
          });
          [64, 128, 192, 256].forEach(function (v) {
            var p = S.plot.toPx(0, v);
            ctx.text(PX - 8, p.y, String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
            ctx.line(PX, p.y, PX + PW, p.y, { color: ctx.alpha('white', 0.05), parent: L });
          });
          ctx.text(PX + PW, PY + PH + 34, 'tokens per step B (log2)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          S.marks = [[0, '1 tok → 8 experts, 1 token each'], [5, 'B = 32 → 163 experts, ~1.6 tok each'], [7, 'B = 128 → 252 experts, ~4 tok each']].map(function (m, i) {
            var p = S.plot.toPx(m[0], f(m[0]));
            var mg = ctx.group({ parent: L });
            ctx.circle(p.x, p.y, 6, { fill: 'white', parent: mg, glow: true });
            if (i === 0) {
              ctx.line(p.x + 8, p.y - 2, 440, 466, { color: ctx.alpha('white', 0.35), sw: 1, dash: '3 3', parent: mg });
              ctx.text(446, 466, 'B = 1 → 8 experts, 1 token each', { size: 12, font: 'mono', color: 'white', parent: mg });
            } else {
              ctx.text(p.x + 12, p.y + 18, m[1], { size: 12, font: 'mono', color: 'white', parent: mg });
            }
            return mg;
          });
          hide(L, S.plot.curve, S.marks);

          var R = card(ctx, g, 850, 176, 690, 380, 'red', 'MEMORY vs COMPUTE (DeepSeek-V3, FP8 weights)');
          var bars = [
            ['weights resident', 671, 'red', '671 GB (all 257×58 experts + rest)'],
            ['8×H100 node HBM', 640, 'dim', '640 GB  ✗ does not fit'],
            ['8×H200 node HBM', 1128, 'lime', '1,128 GB  ✓'],
            ['weights read / token (B=1)', 37, 'amber', '~37 GB (active experts only)']
          ];
          S.rb = bars.map(function (b, i) {
            var y = 236 + i * 72;
            ctx.text(870, y - 10, b[0], { size: 13, font: 'mono', color: 'text', parent: R });
            var r = ctx.rect(870, y, 0, 26, { rx: 4, fill: ctx.alpha(b[2], 0.45), stroke: b[2], sw: 1, parent: R });
            var bw = b[1] / 1128 * 640;
            var t = ctx.text(bw < 200 ? 870 + bw + 8 : 878, y + 13, b[3], { size: 12, font: 'mono', color: 'white', parent: R });
            return { r: r, t: t, w: bw };
          });
          ctx.text(870, 530, 'FLOPs / token: 74 G active vs 1.34 T if dense', { size: 13, font: 'mono', weight: 700, color: 'amber', parent: R });
          hide(R);

          var B = textCard(ctx, g, 60, 580, 1480, 280, 'teal', 'HOW IT IS DEPLOYED (DeepSeek-V3 report)', [
            'prefill: 4 nodes · 32 GPUs · EP32  →  big token batches, compute-bound expert GEMMs',
            'decode:  40 nodes · 320 GPUs · EP320  →  ~1 expert per GPU; 64 GPUs host redundant + shared experts',
            'hot experts replicated from live load statistics; two micro-batches overlap compute and all-to-all',
            'our trailer: the agents\' planning tokens are cheap per token, but only at fleet-scale batch sizes'
          ], { lh: 44, top: 64 });
          hide(B, B.lines);

          function grow(t) { S.rb.forEach(function (b) { b.r.setAttribute('width', b.w * t); }); }
          grow(0);

          /* beat 0: all the weights must be resident */
          ctx.hud('DeepSeek-V3: 671 B resident, 37 B active');
          return ctx.reveal(R, { from: 'right', dur: 600 }).then(function () {
            return ctx.tween(1200, grow, 'out');
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: at batch one, eight experts wake up */
            ctx.reveal(L, { from: 'left', dur: 600 });
            return ctx.wait(500).then(function () {
              return ctx.reveal(S.plot.curve, { from: 'draw', dur: 1400 });
            }).then(function () {
              return ctx.reveal(S.marks[0], { from: 'up', dur: 500 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: a batch wakes nearly every expert, but each sees a few tokens */
            return ctx.reveal([S.marks[1], S.marks[2]], { from: 'up', stagger: 400, dur: 500 });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: serve at fleet scale */
            ctx.reveal(B, { from: 'up', dur: 600 });
            return ctx.reveal(B.lines, { from: 'left', dur: 400, stagger: 250, delay: 300 });
          });
        }
      }
      

    ]
  });
})();
