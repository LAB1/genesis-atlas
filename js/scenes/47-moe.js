/* L3 — Mixture of Experts. Dense MLP -> router + experts: top-k gating, weighted combine, fine-grained and
 * shared experts, load balancing (aux loss vs aux-loss-free bias), capacity and dropping, expert-parallel
 * all-to-all with overlap, and the memory-vs-compute economics of serving. */
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

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    if (title) ctx.text(x + 16, y + 22, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = boxOf(x, y, w, h);
    return g;
  }

  function textCard(ctx, parent, x, y, w, h, color, title, lines, o) {
    o = o || {};
    var g = card(ctx, parent, x, y, w, h, color, title);
    ctx.para(x + 18, y + (o.top || 56), lines, { size: o.size || 14, font: 'mono', color: 'text', lh: o.lh || 30, parent: g });
    keepWS(g);
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
      'Fedus, Zoph, Shazeer, <i>Switch Transformers</i>, JMLR 2022; Zoph et al., <i>ST-MoE: Designing Stable and Transferable Sparse Expert Models</i>, 2022',
      'Jiang et al., <i>Mixtral of Experts</i>, 2024',
      'Dai et al., <i>DeepSeekMoE: Towards Ultimate Expert Specialization</i>, ACL 2024; DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i>, 2024',
      'Wang et al., <i>Auxiliary-Loss-Free Load Balancing Strategy for Mixture-of-Experts</i>, 2024',
      'Gale et al., <i>MegaBlocks: Efficient Sparse Training with Mixture-of-Experts</i>, MLSys 2023',
      'Qwen Team, <i>Qwen3 Technical Report</i>, 2025; Kimi Team, <i>Kimi K2: Open Agentic Intelligence</i>, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Sparse capacity',
        say: 'Inside each transformer block, the feed forward network holds most of the parameters. In a dense model, every token multiplies through all of them. A mixture of experts layer replaces that one network with many smaller expert networks and a tiny router that picks a few experts per token. The model can then store far more knowledge than it spends per token. DeepSeek V3 has six hundred seventy one billion parameters, yet each token of our director agent\'s plan touches only thirty seven billion.',
        deep: '<p>Replace the block’s MLP with E expert MLPs and a router; attention stays dense:</p>' +
          '<div class="eq">y = x + Σ<sub>i∈TopK(x)</sub> g<sub>i</sub>(x) · FFN<sub>i</sub>(x)</div>' +
          '<table><tr><th>Model</th><th>Total</th><th>Active / token</th><th>Routing</th></tr>' +
          '<tr><td>Mixtral 8×7B</td><td>46.7 B</td><td>12.9 B</td><td>top-2 of 8</td></tr>' +
          '<tr><td>Qwen3-235B-A22B</td><td>235 B</td><td>22 B</td><td>top-8 of 128</td></tr>' +
          '<tr><td>DeepSeek-V3</td><td>671 B</td><td>37 B</td><td>top-8 of 256 + 1 shared</td></tr>' +
          '<tr><td>Kimi K2</td><td>1.04 T</td><td>32 B</td><td>top-8 of 384 + 1 shared</td></tr></table>' +
          '<p>Training and inference FLOPs scale with <b>active</b> parameters (≈ 2N<sub>active</sub> per token forward), while quality at a fixed compute budget improves with <b>total</b> parameters. The price: every expert must be resident in memory, and routing turns a dense GEMM into data-dependent communication.</p>',
        run: function (ctx) {
          var S = ctx.state;
          S.loops = [];
          var g = S.page = ctx.group();
          /* dense panel */
          var A = card(ctx, g, 60, 176, 420, 350, 'white', 'DENSE FFN');
          var ta = ctx.label(110, 352, 'fox', { color: 'cyan', size: 13, parent: A });
          S.dense = ctx.matrix(190, 244, 10, 8, { cell: 18, gap: 4, parent: A, values: function () { return 0.12; }, cmap: 'amber' });
          ctx.line(140, 352, 184, 352, { color: 'cyan', sw: 1.4, arrow: true, parent: A });
          ctx.line(370, 352, 420, 352, { color: 'amber', sw: 1.4, arrow: true, parent: A });
          ctx.text(440, 352, 'y', { size: 14, font: 'mono', color: 'amber', parent: A });
          ctx.text(270, 490, 'every token × every weight', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: A });
          ctx.text(270, 510, 'Llama 3 70B: 70 B / token', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: A });

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
          S.gl.forEach(function (t) { t.setAttribute('opacity', 0); });
          ctx.text(810, 515, 'only k/E of the FFN weights do work', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          ctx.reveal([A, B], { from: 'up', stagger: 200 });

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
          ctx.reveal(C, { from: 'right', delay: 300 });

          var W = textCard(ctx, g, 60, 550, 1480, 310, 'amber', 'WHY SPARSE', [
            'knowledge capacity grows with TOTAL params; per-token FLOPs ≈ 2 × ACTIVE params',
            'DeepSeek-V3: 671 B total, 37 B active  →  ~74 GFLOP per token instead of ~1.34 TFLOP',
            'every MLP becomes router + E expert MLPs; attention, norms and embeddings stay dense',
            'our trailer: each token of the director agent\'s plan touches ~5.5% of the weights',
            'price: all experts resident in memory, and routing needs all-to-all communication'
          ], { lh: 44, top: 62 });
          ctx.reveal(W, { from: 'up', delay: 500 });

          function bars(t) { S.mb.forEach(function (b) { b.tb.setAttribute('width', b.tw * t); b.ab.setAttribute('width', b.aw * t); }); }
          function endState() {
            [2, 5].forEach(function (k, j) {
              S.exps[k].setAttribute('opacity', 1);
              S.fan[k].setAttribute('stroke', ctx.C[EC[k]]); S.fan[k].setAttribute('stroke-width', j ? 2 : 3);
              S.outs[k].setAttribute('stroke', ctx.C[EC[k]]); S.outs[k].setAttribute('stroke-width', j ? 2 : 3);
            });
            S.gl.forEach(function (t) { t.setAttribute('opacity', 1); });
            S.dense.set(function () { return 0.55; });
            bars(1);
          }
          if (ctx.instant) { endState(); return Promise.resolve(); }
          bars(0);
          return ctx.wait(900).then(function () {
            return ctx.tween(1000, function (t) { S.dense.set(function (r, c) { return (r + c) / 17 < t ? 0.85 : 0.12; }); }, 'linear');
          }).then(function () {
            S.dense.set(function () { return 0.55; });
            ctx.pulse(S.router, { color: 'magenta', dur: 500 });
            return Promise.all([ctx.packet(S.fan[2], { color: 'violet', dur: 600 }), ctx.packet(S.fan[5], { color: 'teal', dur: 600 })]);
          }).then(function () {
            endState(); bars(0);
            return Promise.all([ctx.packet(S.outs[2], { color: 'violet', dur: 600 }), ctx.packet(S.outs[5], { color: 'teal', dur: 600 })]);
          }).then(function () {
            ctx.pulse(S.sum, { color: 'amber', dur: 500 });
            return ctx.tween(1100, bars, 'out');
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'The router',
        say: 'The router is almost embarrassingly small: one matrix that maps the token\'s hidden vector to one score per expert. Softmax turns scores into probabilities, and top k keeps only the best few. Mixtral keeps two of eight and renormalizes their weights, here sixty two and thirty eight percent. DeepSeek V3 instead uses a sigmoid affinity per expert, picks eight of two hundred fifty six, and normalizes among the chosen ones. Everything downstream is a weighted sum using these gates.',
        deep: '<div class="eq">z = x W<sub>r</sub> ∈ ℝ<sup>E</sup>, &nbsp; W<sub>r</sub> ∈ ℝ<sup>d×E</sup></div>' +
          '<ul><li><b>Mixtral</b>: g = softmax(TopK(z, 2)) over the selected logits.</li>' +
          '<li><b>Switch / GShard</b>: p = softmax(z) over all E, keep top-1 / top-2 values (unnormalised in Switch).</li>' +
          '<li><b>DeepSeek-V3</b>: s<sub>i</sub> = σ(u<sub>t</sub>ᵀe<sub>i</sub>) (sigmoid affinity with a learned centroid e<sub>i</sub>), select top-8 of 256, g<sub>i</sub> = s<sub>i</sub> / Σ<sub>j∈TopK</sub> s<sub>j</sub>.</li></ul>' +
          '<p>The router is tiny (7168 × 256 = 1.8 M params per DeepSeek-V3 layer) but numerically sensitive: it is usually kept in FP32, and ST-MoE adds a <b>router z-loss</b> 10<sup>−3</sup>·(log Σ<sub>j</sub> e<sup>z<sub>j</sub></sup>)² to keep logits small. TopK is not differentiable; gradients reach the router only through the gate values g<sub>i</sub> of selected experts (plus balance losses).</p>' +
          '<pre>logits = x @ W_r                 # [T, E]\ntopv, topi = logits.topk(k, -1)\ngates = softmax(topv, -1)        # Mixtral\n# dispatch token t to experts topi[t]</pre>',
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

          var P0 = 760, PU = 300;
          ctx.text(BX, 526, 'p = softmax(z)   →   top-2   →   renormalise', { size: 14, font: 'mono', weight: 700, color: 'text', parent: L });
          ctx.line(BX - 6, P0, BX + 8 * BP, P0, { color: ctx.alpha('white', 0.25), parent: L });
          S.pb = p.map(function (v, i) {
            var b = ctx.rect(BX + i * BP, P0, BW, 0, { rx: 3, fill: ctx.alpha(EC[i], 0.5), stroke: EC[i], sw: 1, parent: L });
            var t = ctx.text(BX + i * BP + BW / 2, P0 - v * PU - 10, v.toFixed(2), { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: L });
            t.setAttribute('opacity', 0);
            ctx.text(BX + i * BP + BW / 2, 780, 'E' + (i + 1), { size: 12, font: 'mono', color: EC[i], anchor: 'middle', parent: L });
            return { b: b, t: t, v: v };
          });
          S.gates = [0, 1].map(function (j) {
            var i = top[j];
            var t = ctx.label(BX + i * BP + BW / 2, 584, 'g = ' + gz[j].toFixed(2), { color: EC[i], size: 12, parent: L });
            t.setAttribute('opacity', 0);
            return t;
          });
          ctx.para(100, 600, ['W_r is tiny:', 'Mixtral', ' 4096 × 8', ' = 32.8 K', 'DeepSeek-V3', ' 7168 × 256', ' ≈ 1.8 M', '(FP32 in', ' practice)'], { size: 12, font: 'mono', color: 'dim', lh: 20, parent: L });
          keepWS(L);
          ctx.reveal(L, { from: 'left' });

          var R = textCard(ctx, g, 910, 176, 630, 330, 'amber', 'GATING VARIANTS', [
            'Mixtral      g = softmax( TopK(z, 2) )',
            'Switch       p = softmax(z), keep top-1',
            'DeepSeek-V3  s_i = sigmoid( u · e_i )',
            '             top-8 of 256 by s_i',
            '             g_i = s_i / Σ_TopK s_j',
            'all          y = Σ_TopK g_i · E_i(x)'
          ], { size: 14, lh: 42, top: 62 });
          ctx.reveal(R, { from: 'right', delay: 200 });
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
          ctx.reveal(K, { from: 'up', delay: 400 });

          function setZ(t) { S.zb.forEach(function (o) { var h = Math.abs(o.z) * ZU * t; o.b.setAttribute('y', o.z >= 0 ? Z0 - h : Z0); o.b.setAttribute('height', h); }); }
          function setP(t) { S.pb.forEach(function (o) { var h = o.v * PU * t; o.b.setAttribute('y', P0 - h); o.b.setAttribute('height', h); }); }
          function pick() {
            S.pb.forEach(function (o, i) { if (top.indexOf(i) < 0) { o.b.setAttribute('opacity', 0.25); o.t.setAttribute('opacity', 0.35); } });
            S.gates.forEach(function (t) { t.setAttribute('opacity', 1); });
          }
          if (ctx.instant) {
            setZ(1); setP(1);
            S.zb.concat(S.pb).forEach(function (o) { o.t.setAttribute('opacity', 1); });
            pick();
            return Promise.resolve();
          }
          setZ(0); setP(0);
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
            S.zb.forEach(function (o) { o.t.setAttribute('opacity', 1); });
            return ctx.tween(900, setP, 'out');
          }).then(function () {
            S.pb.forEach(function (o) { o.t.setAttribute('opacity', 1); });
            return ctx.wait(500);
          }).then(function () {
            pick();
            return Promise.all(S.gates.map(function (t) { return ctx.pulse(t, { color: 'amber', dur: 600 }); }));
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Experts & combine',
        say: 'Each expert is an ordinary SwiGLU feed forward network. The token is sent to its two chosen experts, each output is scaled by its gate, and the results are summed back into the residual stream. DeepSeek pushed this further with fine grained experts: two hundred fifty six small routed experts plus one shared expert that every token uses. Eight of them fire per token, which gives hundreds of trillions of possible combinations, so experts can specialise sharply while the shared expert holds common knowledge.',
        deep: '<div class="eq">FFN<sub>i</sub>(x) = W<sub>2</sub><sup>(i)</sup> ( SiLU(W<sub>1</sub><sup>(i)</sup>x) ⊙ W<sub>3</sub><sup>(i)</sup>x )</div>' +
          '<div class="eq">h′ = h + FFN<sup>(s)</sup>(h) + Σ<sub>i=1..256</sub> g<sub>i</sub> FFN<sub>i</sub><sup>(r)</sup>(h), &nbsp; g<sub>i</sub> ≠ 0 for 8 experts</div>' +
          '<table><tr><th></th><th>Mixtral 8×7B</th><th>DeepSeek-V3</th></tr>' +
          '<tr><td>d<sub>model</sub></td><td>4,096</td><td>7,168</td></tr>' +
          '<tr><td>expert d<sub>ff</sub></td><td>14,336</td><td>2,048</td></tr>' +
          '<tr><td>experts</td><td>8 routed, top-2</td><td>256 routed top-8 + 1 shared</td></tr>' +
          '<tr><td>combinations</td><td>C(8,2) = 28</td><td>C(256,8) ≈ 4.1×10<sup>14</sup></td></tr>' +
          '<tr><td>MoE layers</td><td>32 of 32</td><td>58 of 61 (first 3 dense)</td></tr></table>' +
          '<p>Per DeepSeek-V3 MoE layer: 257 experts × 3·7168·2048 ≈ 44 M params = 11.3 B, of which 9 experts (≈ 0.40 B, 3.5%) run per token. <b>Fine-grained</b> segmentation (split each expert into m smaller ones, route to m·k) keeps FLOPs constant while making routing far more expressive; the <b>shared expert</b> absorbs common knowledge so routed experts need not duplicate it (DeepSeekMoE).</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var L = card(ctx, g, 60, 176, 790, 380, 'amber', 'TOP-2 COMBINE (Mixtral-style)');
          ctx.label(110, 366, 'x', { color: 'cyan', size: 14, w: 40, parent: L });
          S.e3 = ctx.node({ x: 400, y: 266, w: 280, h: 70, title: 'expert 3 · SwiGLU', sub: '4096 → 14336 → 4096', color: 'violet', titleSize: 14, subSize: 11, parent: L });
          S.e6 = ctx.node({ x: 400, y: 466, w: 280, h: 70, title: 'expert 6 · SwiGLU', sub: '4096 → 14336 → 4096', color: 'teal', titleSize: 14, subSize: 11, parent: L });
          S.i3 = ctx.link({ x: 132, y: 366 }, S.e3, { color: 'violet', to: 'l', parent: L });
          S.i6 = ctx.link({ x: 132, y: 366 }, S.e6, { color: 'teal', to: 'l', parent: L });
          S.o3 = ctx.link(S.e3, { x: 676, y: 366 }, { color: 'violet', from: 'r', parent: L, label: '× g = 0.62', labelDy: -58 });
          S.o6 = ctx.link(S.e6, { x: 676, y: 366 }, { color: 'teal', from: 'r', parent: L, label: '× g = 0.38', labelDy: 58 });
          S.plus = ctx.circle(690, 366, 14, { fill: '#1a1206', stroke: 'amber', sw: 1.6, parent: L });
          ctx.text(690, 367, '+', { size: 16, color: 'amber', anchor: 'middle', weight: 700, parent: L });
          ctx.line(704, 366, 760, 366, { color: 'amber', sw: 1.4, arrow: true, parent: L });
          ctx.text(772, 366, 'y', { size: 14, font: 'mono', color: 'amber', parent: L });
          ctx.path('M110,386 V540 H690 V382', { stroke: ctx.alpha('white', 0.35), sw: 1.2, dash: '4 4', arrow: true, parent: L });
          ctx.text(400, 526,'residual: y = x + 0.62·E₃(x) + 0.38·E₆(x)', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
          ctx.reveal(L, { from: 'left' });

          var R = card(ctx, g, 870, 176, 670, 380, 'lime', 'DeepSeek-V3 · 256 ROUTED + 1 SHARED');
          S.grid = ctx.matrix(890, 212, 16, 16, { cell: 16, gap: 3, parent: R, values: function () { return '#101a2c'; } });
          ctx.text(1041, 530, '256 routed experts (d_ff 2048)', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: R });
          S.shared = ctx.node({ x: 1360, y: 250, w: 280, h: 64, title: 'shared expert', sub: 'every token, always on', color: 'orange', titleSize: 15, subSize: 11, parent: R });
          ctx.para(1226, 330, ['top-8 routed per token', 'C(256, 8) ≈ 4.1 × 10¹⁴', 'vs C(8, 2) = 28 (Mixtral)', '', '9 of 257 experts active', '≈ 3.5% of layer params'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: R });
          ctx.reveal(R, { from: 'right', delay: 200 });

          var B = textCard(ctx, g, 60, 580, 1480, 280, 'amber', 'THE EQUATIONS', [
            'expert:        FFN_i(x) = W2 · ( SiLU(W1 · x) ⊙ W3 · x )',
            'Mixtral:       y = x + Σ_{i ∈ Top2} g_i · FFN_i(x)',
            'DeepSeek-V3:   h′ = h + FFN_shared(h) + Σ_{i ∈ Top8 of 256} g_i · FFN_i(h)',
            'fine-grained:  split each expert m ways, route to m·k → same FLOPs, far more combinations',
            'shared expert: common knowledge lives once, routed experts specialise'
          ], { lh: 40, top: 62 });
          ctx.reveal(B, { from: 'up', delay: 400 });

          var rr = ctx.rng(77);
          function choose() {
            var set = {};
            while (Object.keys(set).length < 8) set[Math.floor(rr() * 256)] = 1;
            S.grid.set(function (r, c) { return set[r * 16 + c] ? ctx.C.lime : '#101a2c'; });
          }
          choose();
          S.loops.push(ctx.loop((function () {
            var last = -1;
            return function (t) { var k = Math.floor(t / 0.9); if (k !== last) { last = k; choose(); } };
          })()));
          if (ctx.instant) return Promise.resolve();
          return ctx.wait(700).then(function () {
            return Promise.all([ctx.packet(S.i3, { color: 'violet', dur: 700 }), ctx.packet(S.i6, { color: 'teal', dur: 700 })]);
          }).then(function () {
            ctx.pulse(S.e3, { color: 'violet', dur: 600 });
            return ctx.pulse(S.e6, { color: 'teal', dur: 600 });
          }).then(function () {
            return Promise.all([ctx.packet(S.o3, { color: 'violet', dur: 700 }), ctx.packet(S.o6, { color: 'teal', dur: 700 })]);
          }).then(function () {
            ctx.pulse(S.plus, { color: 'amber', dur: 500 });
            return ctx.pulse(S.shared, { color: 'orange', dur: 800 });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Load imbalance',
        say: 'Left alone, routing collapses. Experts that get picked early get trained more, get better, and get picked even more. Here a batch of sixty four tokens piles onto two experts while others starve. Under expert parallelism the busiest GPU sets the pace for everyone, and overloaded experts start dropping tokens. The classic fix from Switch and GShard is an auxiliary loss that multiplies each expert\'s share of tokens by its average router probability, which is smallest when the load is uniform.',
        deep: '<div class="eq">L<sub>aux</sub> = α · E · Σ<sub>i=1..E</sub> f<sub>i</sub> · P<sub>i</sub></div>' +
          '<p>f<sub>i</sub> = fraction of tokens dispatched to expert i (non-differentiable count), P<sub>i</sub> = mean router probability for expert i (differentiable). With both uniform at 1/E the loss equals α; any concentration raises it. Switch used α = 10<sup>−2</sup>.</p>' +
          '<ul><li><b>Collapse</b> is a positive-feedback loop: selected experts receive gradient, improve, and are selected more.</li>' +
          '<li><b>Systems cost</b>: with expert parallelism a step waits for the most loaded GPU; here max/mean load = 30/8 = 3.75 means 3.75× the ideal expert time.</li>' +
          '<li><b>Router z-loss</b> (ST-MoE): 10<sup>−3</sup>·mean(logsumexp(z)²) keeps logits small and training stable, complementary to balance.</li>' +
          '<li><b>The tension</b>: a large α forces uniformity that fights the language-modelling loss and hurts quality; too small and collapse returns. This trade-off motivated auxiliary-loss-free balancing.</li></ul>' +
          '<p class="muted">Token counts in the animation are illustrative.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          ctx.hud('max / mean expert load: 3.75 → 1.13');
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
          ctx.text(946, 506, 'mean = 8',{ size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          function assign(loads) {
            var out = [], e = 0, k = 0;
            loads.forEach(function (n, ei) { for (var j = 0; j < n; j++) out.push({ e: ei, k: j }); });
            return out;
          }
          S.A0 = assign(SKEW); S.A1 = assign(BAL);
          S.dots = S.src.map(function (p, i) { return ctx.rect(p.x - 7, p.y - 4, 16, 9, { rx: 2, fill: ctx.alpha(EC[S.A0[i].e], 0.8), parent: L }); });
          S.status = ctx.text(500, 316, '', { size: 14, font: 'mono', weight: 700, color: 'red', anchor: 'middle', parent: L });
          ctx.reveal(L, { from: 'left' });

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
          ctx.reveal(R, { from: 'right', delay: 200 });
          var B = textCard(ctx, g, 60, 620, 1480, 240, 'red', 'WHY IT MATTERS', [
            'rich get richer: chosen experts get gradient, improve, and get chosen more  →  routing collapse',
            'expert parallelism: the step waits for the busiest GPU; max/mean = 30 / 8 = 3.75× the ideal time',
            'with capacity limits, overloaded experts drop tokens; starved experts waste memory and FLOPs'
          ], { lh: 44, top: 64 });
          ctx.reveal(B, { from: 'up', delay: 300 });

          function place(A, t0, t1, tt) {
            S.dots.forEach(function (d, i) {
              var a = t0 ? binPos(t0[i].e, t0[i].k) : S.src[i], b = binPos(t1[i].e, t1[i].k);
              d.setAttribute('x', ctx.lerp(a.x, b.x, tt) - 7 + (t0 ? 0 : 0));
              d.setAttribute('y', ctx.lerp(a.y, b.y, tt) - 4);
              d.setAttribute('fill', ctx.alpha(EC[(tt > 0.5 ? t1 : (t0 || t1))[i].e], 0.8));
            });
          }
          function counts(L) { S.cnt.forEach(function (c, e) { c.textContent = String(L[e]); c.setAttribute('fill', L[e] > 12 ? ctx.C.red : (L[e] < 5 ? ctx.C.dim : ctx.C.white)); }); }
          if (ctx.instant) {
            place(null, S.A1, S.A1, 1); counts(BAL);
            S.status.textContent = 'with L_aux: max/mean = 9 / 8 = 1.13';
            S.status.setAttribute('fill', ctx.C.lime);
            S.before.setAttribute('opacity', 1);
            return Promise.resolve();
          }
          return ctx.wait(800).then(function () {
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
          }).then(function () { return ctx.wait(1400); }).then(function () {
            S.before.setAttribute('opacity', 1);
            S.status.textContent = 'train with L_aux ...';
            S.status.setAttribute('fill', ctx.C.amber);
            return ctx.tween(1500, function (t) { place(S.A0, S.A0, S.A1, t); }, 'inOut');
          }).then(function () {
            counts(BAL);
            S.status.textContent = 'with L_aux: max/mean = 9 / 8 = 1.13';
            S.status.setAttribute('fill', ctx.C.lime);
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Aux-loss-free',
        say: 'DeepSeek V3 balances without fighting the language modelling loss. Each expert gets a bias that is added to its affinity only when choosing the top k, never when weighting the output. After every training step, overloaded experts have their bias nudged down and underloaded experts nudged up. Watch the loads flatten while the biases drift apart. The gradients stay clean, only a tiny sequence level balance loss remains, and no tokens are ever dropped.',
        deep: '<div class="eq">selection: TopK<sub>i</sub>(s<sub>i,t</sub> + b<sub>i</sub>), &nbsp; gate: g<sub>i,t</sub> = s<sub>i,t</sub> / Σ<sub>j∈TopK</sub> s<sub>j,t</sub></div>' +
          '<div class="eq">after each step: b<sub>i</sub> ← b<sub>i</sub> − γ · sign(load<sub>i</sub> − mean load)</div>' +
          '<ul><li>γ (bias update speed) = 0.001 for most of DeepSeek-V3 pre-training, 0 at the end; b receives no gradient.</li>' +
          '<li>The bias only changes <i>which</i> experts are chosen, not how their outputs are weighted, so the LM objective is untouched (unlike L<sub>aux</sub>, whose gradient flows into the router).</li>' +
          '<li>A complementary <b>sequence-wise</b> balance loss with a tiny α = 10<sup>−4</sup> prevents extreme imbalance inside single sequences.</li>' +
          '<li><b>Node-limited routing</b>: each token’s 8 experts span at most 4 nodes (top experts chosen per node by summed affinity) to bound cross-node traffic.</li>' +
          '<li>Result reported: better quality than aux-loss balancing at equal balance, and <b>no token dropping</b> in training or inference.</li></ul>' +
          '<p class="muted">Loads and biases in the animation are illustrative (units of γ).</p>',
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
          ctx.text(78, BZ, 'b',{ size: 13, font: 'mono', weight: 700, color: 'lime', anchor: 'end', parent: L });
          ctx.reveal(L, { from: 'left' });

          var R = textCard(ctx, g, 870, 176, 670, 440, 'lime', 'AUX-LOSS-FREE BALANCING (DeepSeek-V3)', [
            'select:  TopK_i ( s_i + b_i )    ← bias here only',
            'gate:    g_i = s_i / Σ_TopK s_j   (no bias)',
            '',
            'after each step:',
            '  b_i ← b_i − γ · sign(load_i − mean)',
            '  γ = 0.001, no gradient through b',
            '',
            '+ sequence-wise balance loss, α = 10⁻⁴',
            '+ node-limited: ≤ 4 nodes per token',
            '→ no token dropping at all'
          ], { size: 14, lh: 36, top: 60 });
          ctx.reveal(R, { from: 'right', delay: 200 });

          var B = card(ctx, g, 60, 640, 1480, 220, 'amber', 'TWO WAYS TO BALANCE');
          var rows = [['', 'gradient into router', 'quality impact', 'balance', 'dropping'],
            ['aux loss (Switch, GShard)', 'yes: α·E·Σ f_i P_i', 'hurts if α large', 'soft', 'capacity + drops'],
            ['aux-loss-free (DeepSeek-V3)', 'no: bias via sign rule', 'none measured', 'tracks load', 'none']];
          rows.forEach(function (r, i) {
            r.forEach(function (c, j) {
              ctx.text(84 + [0, 330, 640, 890, 1110][j], 694 + i * 50, c, { size: 14, font: 'mono', weight: i === 0 ? 700 : 400, color: i === 0 ? 'cyan' : (j === 0 ? 'white' : 'text'), parent: B });
            });
          });
          ctx.reveal(B, { from: 'up', delay: 300 });

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
          if (ctx.instant) { show(4, 4, 1); S.it.textContent = 'step 4 · max/mean 1.13'; return Promise.resolve(); }
          show(0, 0, 1);
          S.bt.forEach(function (t) { t.textContent = '0'; });
          var chain = ctx.wait(1000);
          [1, 2, 3, 4].forEach(function (s) {
            chain = chain.then(function () {
              S.it.textContent = 'step ' + s + ' · max/mean ' + (Math.max.apply(null, ITERS[s]) / 8).toFixed(2);
              return ctx.tween(900, function (t) { show(s - 1, s, t); }, 'inOut');
            }).then(function () { return ctx.wait(350); });
          });
          return chain;
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Capacity & dropping',
        say: 'Hardware wants static shapes, so classic MoE gives every expert a fixed number of slots, its capacity: a capacity factor times the average tokens per expert. Here sixty four tokens with top two routing make one hundred twenty eight assignments, sixteen per expert on average, and a factor of one point two five gives twenty slots. Expert one receives twenty six, so six tokens overflow and are dropped: they skip the expert and ride the residual connection. Dropless systems use grouped matrix multiplies to avoid this entirely.',
        deep: '<div class="eq">C = ⌈ CF · T · k / E ⌉ = ⌈1.25 · 64 · 2 / 8⌉ = 20 slots per expert</div>' +
          '<ul><li>Loads here: [26, 12, 22, 10, 14, 11, 19, 14] → 6 + 2 = 8 of 128 assignments dropped (6.3%). A dropped token gets no update from that expert; with top-2 it may still get its other expert.</li>' +
          '<li>CF trades memory/compute padding against drops: GShard/Switch used 1.0–2.0 in training, often higher at eval.</li>' +
          '<li><b>Dropless MoE</b>: sort tokens by expert and run a <b>grouped GEMM</b> over variable-size groups (MegaBlocks block-sparse kernels; cuBLAS/CUTLASS grouped GEMM). DeepSeek-V3 drops no tokens.</li>' +
          '<li><b>Specialisation</b>: Mixtral’s analysis found routing tracks syntax and token type (code indentation, punctuation, specific words) more than topic, and consecutive tokens often reuse the same expert; fine-grained and shared experts yield sharper, less redundant experts.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var LOADS = [26, 12, 22, 10, 14, 11, 19, 14];
          var L = card(ctx, g, 60, 176, 1040, 440, 'amber', 'EXPERT BUFFERS · T = 64 tokens · top-2 · CF = 1.25');
          ctx.text(580, 244, 'C = ⌈CF · T·k / E⌉ = ⌈1.25 · 64·2 / 8⌉ = 20 slots', { size: 16, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: L });
          S.slots = []; S.over = []; S.lt = [];
          for (var e = 0; e < 8; e++) {
            var x0 = 90 + e * 125;
            ctx.rect(x0 - 4, 414, 100, 126, { rx: 5, fill: ctx.alpha(EC[e], 0.04), stroke: ctx.alpha(EC[e], 0.5), sw: 1, parent: L });
            ctx.text(x0 + 46, 556, 'E' + (e + 1), { size: 13, font: 'mono', weight: 700, color: EC[e], anchor: 'middle', parent: L });
            S.lt.push(ctx.text(x0 + 46, 330, 'load ' + LOADS[e], { size: 12, font: 'mono', color: LOADS[e] > 20 ? 'red' : 'text', anchor: 'middle', parent: L }));
            var sl = [];
            for (var k = 0; k < 20; k++) sl.push(ctx.rect(x0 + (k % 4) * 23, 520 - Math.floor(k / 4) * 24, 19, 19, { rx: 3, fill: '#0b1222', stroke: ctx.alpha(EC[e], 0.25), sw: 0.8, parent: L }));
            S.slots.push(sl);
            var ov = [];
            for (var k2 = 0; k2 < LOADS[e] - 20; k2++) ov.push(ctx.rect(x0 + (k2 % 4) * 23, 386 - Math.floor(k2 / 4) * 24, 19, 19, { rx: 3, fill: ctx.alpha('red', 0.75), stroke: 'red', sw: 1, parent: L }));
            S.over.push(ov);
          }
          ctx.line(80, 412, 1090, 412, { color: 'red', sw: 1.5, dash: '6 4', parent: L });
          ctx.text(1090, 402, 'capacity', { size: 11, font: 'mono', color: 'red', anchor: 'end', parent: L });
          S.drop = ctx.group({ parent: L });
          ctx.rect(84, 574, 1000, 30, { rx: 6, fill: ctx.alpha('red', 0.08), stroke: ctx.alpha('red', 0.5), sw: 1, dash: '4 4', parent: S.drop });
          S.dropTxt = ctx.text(96, 589, 'dropped → skip the expert, pass through the residual only', { size: 12, font: 'mono', color: 'red', parent: S.drop });
          S.dropped = ctx.text(1070, 589, '', { size: 12, font: 'mono', weight: 700, color: 'red', anchor: 'end', parent: S.drop });
          [].concat.apply([], S.over).forEach(function (r) { r.setAttribute('opacity', 0); });
          ctx.reveal(L, { from: 'left' });

          var R = textCard(ctx, g, 1130, 176, 410, 440, 'red', 'THE TRADE-OFF', [
            'CF 1.0  → more drops,',
            '          no padding',
            'CF 2.0  → few drops,',
            '          2× buffer memory',
            '',
            'here: 8 / 128 dropped',
            '      = 6.3% of assignments',
            '',
            'DeepSeek-V3: no drops',
            '(bias balancing + dropless)'
          ], { size: 14, lh: 32, top: 58 });
          ctx.reveal(R, { from: 'right', delay: 200 });
          var B1 = textCard(ctx, g, 60, 640, 720, 220, 'violet', 'EXPERT SPECIALISATION', [
            'Mixtral: routing tracks token type & syntax',
            '  (indentation, punctuation) more than topic',
            'consecutive tokens often reuse one expert',
            'fine-grained + shared → sharper experts'
          ], { lh: 34, top: 58 });
          var B2 = textCard(ctx, g, 800, 640, 740, 220, 'teal', 'DROPLESS COMPUTE', [
            'sort tokens by expert → variable-size groups',
            'grouped GEMM / block-sparse (MegaBlocks)',
            'no capacity, no padding, no dropped tokens',
            'cost: dynamic shapes, load-dependent latency'
          ], { lh: 34, top: 58 });
          ctx.reveal([B1, B2], { from: 'up', delay: 350, stagger: 150 });

          function fill(t) {
            for (var e = 0; e < 8; e++) {
              var n = Math.min(20, Math.round(LOADS[e] * t));
              S.slots[e].forEach(function (r, k) { r.setAttribute('fill', k < n ? ctx.alpha(EC[e], 0.75) : '#0b1222'); });
              var ov = Math.max(0, Math.round(LOADS[e] * t) - 20);
              S.over[e].forEach(function (r, k) { r.setAttribute('opacity', k < ov ? 1 : 0); });
            }
          }
          if (ctx.instant) {
            fill(1);
            [].concat.apply([], S.over).forEach(function (r) { r.setAttribute('opacity', 0.35); });
            S.dropped.textContent = '8 dropped';
            return Promise.resolve();
          }
          fill(0);
          return ctx.wait(900).then(function () {
            return ctx.tween(2200, fill, 'linear');
          }).then(function () {
            ctx.pulse(S.lt[0], { color: 'red', dur: 600 });
            return ctx.pulse(S.lt[2], { color: 'red', dur: 600 });
          }).then(function () {
            var all = [].concat.apply([], S.over);
            return Promise.all(all.map(function (r, i) {
              var y0 = parseFloat(r.getAttribute('y'));
              return ctx.tween(700, function (t) { r.setAttribute('y', y0 + (580 - y0) * t); r.setAttribute('opacity', 1 - 0.65 * t); }, 'in', i * 60).then(function () { r.setAttribute('y', y0); });
            }));
          }).then(function () {
            S.dropped.textContent = '8 dropped';
            return ctx.pulse(S.drop, { color: 'red', dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Expert parallelism',
        say: 'Two hundred fifty six experts do not fit on one GPU, so they are spread across many: expert parallelism. Every MoE layer then needs two all to all exchanges. Dispatch sends each token\'s hidden vector to the GPUs that hold its chosen experts. The experts run, and combine sends the weighted results back home. This communication is huge, so production systems split the batch into micro batches and overlap one batch\'s all to all with another batch\'s computation, hiding most of the network time.',
        deep: '<ul><li><b>Dispatch</b>: token t sends x<sub>t</sub> (d = 7168) to the GPUs owning its top-k experts; <b>combine</b> returns g<sub>i</sub>·FFN<sub>i</sub>(x<sub>t</sub>) to the origin GPU, where the k results are summed.</li>' +
          '<li>DeepSeek-V3 training: dispatch in FP8, combine in BF16; NVLink ≈ 160 GB/s vs InfiniBand ≈ 50 GB/s per GPU, so each token may touch at most <b>4 nodes</b>; IB traffic is sent once per node and forwarded over NVLink.</li>' +
          '<li>Custom all-to-all kernels (open-sourced as <b>DeepEP</b>) use only <b>20 of 132 SMs</b> to saturate IB and NVLink, leaving the rest for GEMMs.</li>' +
          '<li><b>Overlap</b>: DualPipe (training) interleaves forward and backward chunks of two micro-batches so attention/MLP compute hides dispatch/combine; inference overlaps two micro-batches the same way.</li>' +
          '<li>Grouped GEMM on the receive side processes all tokens for local experts in one launch.</li></ul>' +
          '<div class="eq">dispatch bytes/token ≈ k · d · 1 B (FP8) ≈ 8 · 7168 ≈ 57 KB (before node dedup)</div>',
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
          ctx.reveal(G, { from: 'left' });

          var R = textCard(ctx, g, 1130, 176, 410, 400, 'amber', 'ALL-TO-ALL, TWICE', [
            'dispatch: x_t → owners',
            '          of its top-k',
            'combine:  g_i·E_i(x_t) → home',
            '',
            'DeepSeek-V3:',
            ' FP8 dispatch, BF16 combine',
            ' NVLink 160 vs IB 50 GB/s',
            ' ≤ 4 nodes per token',
            ' DeepEP: 20 SMs for comms'
          ], { size: 14, lh: 34, top: 58 });
          ctx.reveal(R, { from: 'right', delay: 200 });

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
          ctx.reveal(T, { from: 'up', delay: 300 });

          function at(tt, back) {
            S.tok.forEach(function (o) {
              var a = back ? o.away : o.home, b = back ? o.home : o.away;
              o.r.setAttribute('x', ctx.lerp(a.x, b.x, tt)); o.r.setAttribute('y', ctx.lerp(a.y, b.y, tt));
            });
          }
          function ghosts() { S.tok.forEach(function (o) { ctx.rect(o.away.x, o.away.y, 20, 20, { rx: 4, stroke: ctx.alpha(EC[o.dest], 0.6), sw: 1, dash: '2 2', parent: G }); }); }
          if (ctx.instant) { ghosts(); at(1, true); S.tok.forEach(function (o) { o.r.setAttribute('stroke', ctx.C.white); }); return Promise.resolve(); }
          return ctx.wait(900).then(function () {
            return ctx.tween(1400, function (t) { at(t, false); }, 'inOut');
          }).then(function () {
            ghosts();
            return Promise.all(S.expN.map(function (n, i) { return ctx.pulse(n, { color: EC[i], dur: 700 }); }));
          }).then(function () {
            S.tok.forEach(function (o) { o.r.setAttribute('stroke', ctx.C.white); });
            return ctx.tween(1400, function (t) { at(t, true); }, 'inOut');
          }).then(function () {
            return ctx.wait(300);
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Serving economics',
        say: 'At inference, a mixture of experts is cheap in compute but expensive in memory. All six hundred seventy one billion parameters must be resident, even though each token uses thirty seven billion. And efficiency depends on batch size: with one token, only eight experts wake up, each reading its weights for a single token, which is pure memory traffic. With a few hundred tokens nearly every expert is busy, but each still sees only a handful of tokens. That is why MoE serving spreads experts over hundreds of GPUs and batches traffic from many users and agents.',
        deep: '<div class="eq">E[# experts touched] = E · (1 − (1 − k/E)<sup>B</sup>) &nbsp; (B tokens, uniform routing)</div>' +
          '<p>DeepSeek-V3 (k = 8, E = 256): B = 1 → 8 experts; B = 32 → ~163; B = 128 → ~252. Tokens per active expert ≈ B·k/touched, so at B = 128 each expert sees ~4 tokens. With FP8 weights each weight byte yields 2 FLOPs per token, so an expert GEMM needs <b>hundreds of tokens</b> to approach the H100 ridge; small batches are HBM-bound.</p>' +
          '<table><tr><th></th><th>DeepSeek-V3</th></tr>' +
          '<tr><td>resident weights (FP8)</td><td>≈ 671 GB: exceeds one 8×H100 node (640 GB); fits 8×H200 (1,128 GB)</td></tr>' +
          '<tr><td>FLOPs / token</td><td>≈ 2 × 37 B = 74 GFLOP (a dense 671 B would need ≈ 1.34 TFLOP)</td></tr>' +
          '<tr><td>prefill deployment</td><td>4 nodes / 32 GPUs, EP32</td></tr>' +
          '<tr><td>decode deployment</td><td>40 nodes / 320 GPUs, EP320: ~1 expert per GPU, 64 GPUs for redundant + shared experts</td></tr></table>' +
          '<p>Hot experts are replicated (“redundant experts”) from live load statistics. For our trailer, this is why agent calls are batched fleet-wide: MoE makes each planning token cheap only when thousands of tokens share every expert pass.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          ctx.hud('DeepSeek-V3: 671 B resident · 37 B active per token');
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
          S.plot.curve.setAttribute('opacity', 0);
          ctx.reveal(L, { from: 'left' });

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
          ctx.reveal(R, { from: 'right', delay: 200 });

          var B = textCard(ctx, g, 60, 580, 1480, 280, 'teal', 'HOW IT IS DEPLOYED (DeepSeek-V3 report)', [
            'prefill: 4 nodes · 32 GPUs · EP32  →  big token batches, compute-bound expert GEMMs',
            'decode:  40 nodes · 320 GPUs · EP320  →  ~1 expert per GPU; 64 GPUs host redundant + shared experts',
            'hot experts replicated from live load statistics; two micro-batches overlap compute and all-to-all',
            'our trailer: the agents\' planning tokens are cheap per token, but only at fleet-scale batch sizes'
          ], { lh: 44, top: 64 });
          ctx.reveal(B, { from: 'up', delay: 400 });

          function grow(t) { S.rb.forEach(function (b) { b.r.setAttribute('width', b.w * t); }); }
          if (ctx.instant) { S.plot.curve.setAttribute('opacity', 1); grow(1); return Promise.resolve(); }
          grow(0);
          S.marks.forEach(function (m) { m.setAttribute('opacity', 0); });
          return ctx.wait(600).then(function () {
            S.plot.curve.setAttribute('opacity', 1);
            return ctx.reveal(S.plot.curve, { from: 'draw', dur: 1400 });
          }).then(function () {
            return ctx.reveal(S.marks, { from: 'up', stagger: 400 });
          }).then(function () {
            return ctx.tween(1200, grow, 'out');
          });
        }
      }
    ]
  });
})();
