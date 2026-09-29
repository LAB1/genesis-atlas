/* L2 — Attention, Up Close. One head, one layer, six tokens of the trailer script:
 * Q/K/V projections -> QK^T/sqrt(d) -> causal mask -> row softmax (click a token) -> PV,
 * multi-head + W_O, the quadratic wall, the KV cache, and GQA / MQA / MLA / windows / linear hybrids. */
(function () {
  var TOK = ['a', 'fox', 'astronaut', 'lands', 'on', 'ice'];
  /* target attention pattern of the demo head (causal rows sum to 1) */
  var P = [
    [1],
    [0.38, 0.62],
    [0.08, 0.64, 0.28],
    [0.05, 0.20, 0.57, 0.18],
    [0.04, 0.06, 0.13, 0.61, 0.16],
    [0.04, 0.13, 0.19, 0.34, 0.22, 0.08]
  ];
  var SQ = Math.sqrt(128);
  var SX = 1050, SY = 360, SP = 48, SC_ = 44;      /* score matrix geometry */
  var OX = 1372;                                    /* output matrix x */
  var ROW0 = 400, RP = 25;                          /* X/Q/K/V rows */
  var HC = ['amber', 'cyan', 'violet', 'lime', 'orange', 'teal', 'pink', 'blue'];

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

  function textCard(ctx, x, y, w, h, color, title, lines, o) {
    o = o || {};
    var g = card(ctx, null, x, y, w, h, color, title);
    ctx.para(x + 18, y + 54, lines, { size: o.size || 14, font: 'mono', color: 'text', lh: o.lh || 27, parent: g });
    keepWS(g);
    return g;
  }

  function swap(ctx, S, key, g) {
    var old = S[key];
    S[key] = g;
    if (old) ctx.fadeOut(old, 400, true);
  }

  /* token chip centred on its local origin */
  function chip(ctx, parent, str, color, w) {
    var g = ctx.group({ parent: parent });
    g.bg = ctx.rect(-w / 2, -11, w, 22, { rx: 5, fill: ctx.alpha(color, 0.13), stroke: ctx.alpha(color, 0.75), sw: 1, parent: g });
    g.t = ctx.text(0, 0.5, str, { size: 13, font: 'mono', anchor: 'middle', color: 'white', parent: g });
    g.col = color;
    return g;
  }

  function fmt(v) { return (Math.abs(v) < 0.05 ? 0 : v).toFixed(1); }

  function initData(ctx, S) {
    var r = ctx.rng(43);
    S.sc = [];
    for (var i = 0; i < 6; i++) {
      var row = [], mx = Math.max.apply(null, P[i]);
      for (var j = 0; j < 6; j++) row.push(j <= i ? Math.log(P[i][j] / mx) + 2.2 : -1 + r() * 3.4);
      S.sc.push(row);
    }
    var rv = ctx.rng(7);
    S.Xv = []; S.Qv = []; S.Kv = []; S.Vv = [];
    for (var a = 0; a < 6; a++) {
      S.Xv.push([0, 1, 2, 3, 4, 5, 6, 7].map(function () { return rv() * 2 - 1; }));
      S.Qv.push([0, 1, 2, 3].map(function () { return rv() * 2 - 1; }));
      S.Kv.push([0, 1, 2, 3].map(function () { return rv() * 2 - 1; }));
      S.Vv.push([0, 1, 2, 3].map(function () { return rv() * 2 - 1; }));
    }
    S.Ov = S.Vv.map(function (_, i) {
      return [0, 1, 2, 3].map(function (c) {
        var s = 0;
        for (var j = 0; j <= i; j++) s += P[i][j] * S.Vv[j][c];
        return s * 1.6;
      });
    });
  }

  function pOf(i, j) { return j <= i ? P[i][j] : 0; }

  Atlas.register({
    id: 'attention',
    refs: [
      'Vaswani et al., <i>Attention Is All You Need</i>, NeurIPS 2017',
      'Shazeer, <i>Fast Transformer Decoding: One Write-Head is All You Need</i> (MQA), 2019; Ainslie et al., <i>GQA: Training Generalized Multi-Query Transformer Models</i>, EMNLP 2023',
      'DeepSeek-AI, <i>DeepSeek-V2</i> (Multi-head Latent Attention), 2024; <i>DeepSeek-V3 Technical Report</i>, 2024',
      'Dao et al., <i>FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness</i>, NeurIPS 2022',
      'Kwon et al., <i>Efficient Memory Management for LLM Serving with PagedAttention</i>, SOSP 2023',
      'Xiao et al., <i>Efficient Streaming Language Models with Attention Sinks</i>, ICLR 2024',
      'Yang et al., <i>Gated Delta Networks: Improving Mamba2 with Delta Rule</i>, ICLR 2025; Gemma Team, <i>Gemma 3 Technical Report</i>, 2025',
      'Elhage et al., <i>A Mathematical Framework for Transformer Circuits</i>, 2021; Olsson et al., <i>In-context Learning and Induction Heads</i>, 2022'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Tokens talk',
        say: 'Attention is the only place inside a transformer where tokens talk to each other. Take six tokens from our trailer script: a fox astronaut lands on ice. When the model processes ice, it needs to know who landed, and how. Attention lets ice look back at every earlier token, score how relevant each one is, and pull in a weighted blend of their information. The same operation, repeated across thousands of heads, drives both the planning agents and the video diffusion transformer.',
        deep: '<div class="eq">Attention(Q,K,V) = softmax(QKᵀ/√d<sub>k</sub> + M) V</div>' +
          '<p>Norms and MLPs act on one position at a time; attention is the only <b>token-mixing</b> operator. Each output row is a <i>convex combination</i> of value vectors, with weights computed on the fly from content: a differentiable, content-addressed memory read.</p>' +
          '<table><tr><th>Where</th><th>Scale</th></tr>' +
          '<tr><td>Planner LLM (70B-class)</td><td>80 layers × 64 query heads = 5,120 attention maps per token</td></tr>' +
          '<tr><td>Video DiT (Wan 2.1, 720p, 81 frames)</td><td>21 × 45 × 80 = 75,600 spacetime tokens → 5.7×10<sup>9</sup> scores per head per layer</td></tr>' +
          '<tr><td>Agent decode step</td><td>1 new query per head against ~12k cached keys</td></tr></table>' +
          '<div class="note">Throughout this chamber: one head, one layer, n = 6 tokens, d<sub>k</sub> = 128 (only a few columns drawn). Numbers in the matrices are illustrative.</div>',
        run: function (ctx) {
          var S = ctx.state;
          initData(ctx, S);
          S.hdr = ctx.text(60, 172, 'ONE HEAD · ONE LAYER · n = 6 TOKENS OF THE TRAILER SCRIPT', { size: 12, font: 'mono', color: 'dim', spacing: 1 });
          S.chips = TOK.map(function (t, i) {
            var c = chip(ctx, null, t, 'cyan', 100);
            ctx.place(c, 120 + i * 120, 212);
            return c;
          });
          ctx.reveal(S.hdr, {});
          ctx.reveal(S.chips, { from: 'up', stagger: 80, dur: 400 });

          /* arcs from earlier tokens into "ice" */
          S.arcs = ctx.group();
          S.arcEls = [];
          for (var j = 0; j < 5; j++) {
            var x1 = 120 + j * 120, x2 = 720, d = x2 - x1;
            var cy = 232 + 26 + d * 0.2;
            var a = ctx.path('M' + x1 + ',226 Q' + ((x1 + x2) / 2) + ',' + cy + ' ' + x2 + ',226', { stroke: 'amber', sw: 1 + P[5][j] * 11, parent: S.arcs, opacity: Math.min(1, 0.35 + P[5][j] * 2) });
            S.arcEls.push(a);
            var lxp = 0.49 * x1 + 0.42 * ((x1 + x2) / 2) + 0.09 * x2, lyp = 0.58 * 226 + 0.42 * cy;
            ctx.text(lxp - 8, lyp + 8, P[5][j].toFixed(2), { size: 12, font: 'mono', color: 'amber', anchor: 'end', parent: S.arcs });
          }
          ctx.text(720, 196, 'query', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: S.arcs });
          ctx.reveal(S.arcs, { delay: 600 });

          S.eq = ctx.group();
          ctx.rect(880, 160, 660, 110, { rx: 12, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha('amber', 0.6), parent: S.eq, glow: true });
          ctx.text(1210, 198, 'Attention(Q, K, V) = softmax( QKᵀ / √d_k + M ) · V', { size: 22, font: 'display', weight: 700, anchor: 'middle', color: 'white', parent: S.eq });
          ctx.text(1210, 238, 'the only operator in a transformer that moves information between positions', { size: 13, font: 'mono', anchor: 'middle', color: 'amber', parent: S.eq });
          ctx.reveal(S.eq, { from: 'right', delay: 300 });

          S.stats = ctx.group();
          var st = [
            ['IN THE PLANNER LLM', 'amber', ['80 layers × 64 query heads', '= 5,120 attention maps / token', 'd_head 128 · 8 shared KV heads']],
            ['IN THE VIDEO DiT', 'lime', ['Wan 2.1 · 720p · 81 frames', '21 × 45 × 80 = 75,600 tokens', '≈ 5.7 × 10⁹ scores / head / layer']],
            ['IN EVERY AGENT STEP', 'magenta', ['decode: 1 new query per head', 'reads ~12k cached keys & values', 'memory traffic, not FLOPs, dominates']]
          ];
          st.forEach(function (s, i) {
            var c = card(ctx, S.stats, 60 + i * 505, 360, 470, 150, s[1], s[0]);
            ctx.para(78 + i * 505, 410, s[2], { size: 14, font: 'mono', color: 'text', lh: 28, parent: c });
          });
          ctx.reveal(S.stats, { from: 'up', delay: 900 });

          /* chamber roadmap = the residual block context */
          S.road = ctx.group();
          ctx.text(60, 610, 'THE ROADMAP OF THIS CHAMBER', { size: 12, font: 'mono', color: 'dim', spacing: 1, parent: S.road });
          var names = ['X', 'Q · K · V', 'QKᵀ / √d', 'mask+softmax', 'P · V', 'heads · W_O', 'KV cache'];
          var pills = names.map(function (n, i) {
            return ctx.node({ x: 150 + i * 216, y: 664, w: 172, h: 46, title: n, color: i === 6 ? 'violet' : 'amber', kind: 'pill', titleSize: 15, glow: false, parent: S.road });
          });
          for (var k = 0; k < 6; k++) ctx.link(pills[k], pills[k + 1], { color: ctx.alpha('amber', 0.6), parent: S.road, sw: 1.4 });
          ctx.text(800, 770, 'x ─► RMSNorm ─► [ ATTENTION ] ─► ⊕ ─► RMSNorm ─► MLP ─► ⊕ ─► next layer', { size: 16, font: 'mono', color: 'text', anchor: 'middle', parent: S.road });
          ctx.text(800, 804, 'inside every one of the 80 pre-norm residual blocks of the planner model', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: S.road });
          ctx.reveal(S.road, { from: 'up', delay: 1300 });

          return ctx.wait(1300).then(function () {
            return Promise.all(S.arcEls.map(function (a, i) { return ctx.packet(a, { color: 'amber', dur: 900 + i * 60, r: 4 }); }));
          }).then(function () {
            return ctx.pulse(S.chips[5], { color: 'amber', dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Q, K, V',
        say: 'First, every token vector is projected three ways by learned matrices. The query asks: what am I looking for? The key advertises: what do I contain? The value is the payload that actually gets copied. Each is just the token row times a weight matrix, and for all tokens at once it is one big matrix multiply. In a seventy billion parameter model, queries have sixty four heads of width one hundred twenty eight, while keys and values share only eight heads. Position enters here too: rotary embeddings rotate each pair of query and key dimensions by an angle proportional to the token position, so their dot product depends only on the distance between tokens.',
        deep: '<div class="eq">Q = XW<sub>Q</sub>, &nbsp;K = XW<sub>K</sub>, &nbsp;V = XW<sub>V</sub></div>' +
          '<p>X ∈ ℝ<sup>n×d</sup> is the RMS-normalised residual stream; d = 8,192, h = 64 query heads, d<sub>k</sub> = d<sub>v</sub> = 128.</p>' +
          '<table><tr><th>Weight</th><th>Shape</th><th>Params</th></tr>' +
          '<tr><td>W<sub>Q</sub></td><td>8192 × 8192 (64 heads)</td><td>67.1 M</td></tr>' +
          '<tr><td>W<sub>K</sub></td><td>8192 × 1024 (8 KV heads)</td><td>8.4 M</td></tr>' +
          '<tr><td>W<sub>V</sub></td><td>8192 × 1024 (8 KV heads)</td><td>8.4 M</td></tr></table>' +
          '<p>In practice the three are <b>fused</b> into one GEMM X·[W<sub>Q</sub>|W<sub>K</sub>|W<sub>V</sub>] of width 10,240: 2 · 8192 · 10240 ≈ 168 MFLOP per token per layer.</p>' +
          '<p>Position enters here: <b>RoPE</b> rotates each 2-D pair of q and k by angle m·θ<sub>i</sub> (θ<sub>i</sub> = base<sup>−2i/d</sup>), so q<sub>m</sub>·k<sub>n</sub> depends only on the offset m − n. Long-context models raise the base or rescale frequencies (YaRN, Llama 3 scaling) to stretch to 128k.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.arcs, 400);
          ctx.remove(S.stats, 400);
          ctx.remove(S.road, 400);
          S.hdr.textContent = 'ONE HEAD · PROJECTIONS · ROWS = TOKENS, COLUMNS = FEATURES';
          S.chips.forEach(function (c, i) { ctx.transform(c, { x: 100, y: ROW0 + 11 + i * RP }, 800, 'inOut', 150 + i * 60); });

          /* X */
          S.xg = ctx.group();
          S.X = ctx.matrix(165, ROW0, 6, 8, { cell: 22, gap: 3, cmap: 'diverge', values: function (r, c) { return S.Xv[r][c] * 0.8; }, parent: S.xg });
          ctx.text(263, 572, 'X   [n × d_model]', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: S.xg });
          ctx.text(263, 592, '8 of 8,192 dims drawn', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.xg });
          ctx.line(372, ROW0 + 73, 450, ROW0 + 73, { color: ctx.alpha('white', 0.6), sw: 1.4, arrow: true, parent: S.xg });
          ctx.reveal(S.xg, { from: 'left', delay: 500 });

          /* W and results */
          var spec = [['Q', 'amber', 460, 'Qv'], ['K', 'cyan', 590, 'Kv'], ['V', 'violet', 720, 'Vv']];
          S.wg = ctx.group();
          S.res = {};
          var wr = ctx.rng(99);
          spec.forEach(function (s) {
            var wx = s[2] + 21.5;
            ctx.text(s[2] + 48.5, 250, 'W_' + s[0], { size: 14, font: 'mono', weight: 700, color: s[1], anchor: 'middle', parent: S.wg });
            ctx.matrix(wx, 262, 8, 4, { cell: 12, gap: 2, cmap: 'diverge', values: function () { return (wr() * 2 - 1) * 0.7; }, parent: S.wg });
            ctx.rect(wx - 3, 259, 60, 116, { rx: 4, stroke: ctx.alpha(s[1], 0.7), sw: 1.2, parent: S.wg });
            ctx.line(s[2] + 48.5, 380, s[2] + 48.5, ROW0 - 6, { color: ctx.alpha(s[1], 0.8), sw: 1.4, arrow: true, parent: S.wg });
            var g = ctx.group();
            g.m = ctx.matrix(s[2], ROW0, 6, 4, { cell: 22, gap: 3, values: function () { return '#0b1222'; }, parent: g });
            g.frame = ctx.rect(s[2] - 4, ROW0 - 4, 105, 155, { rx: 5, stroke: s[1], sw: 1.4, parent: g });
            ctx.text(s[2] + 48.5, 572, s[0] + ' = X·W_' + s[0], { size: 13, font: 'mono', color: s[1], anchor: 'middle', parent: g });
            ctx.text(s[2] + 48.5, 592, '[n × 128]', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            g.key = s[3];
            S.res[s[0]] = g;
          });
          ctx.reveal(S.wg, { from: 'down', delay: 700 });
          ctx.reveal([S.res.Q, S.res.K, S.res.V], { from: 'up', delay: 800, stagger: 120 });

          swap(ctx, S, 'cardL', textCard(ctx, 60, 630, 880, 230, 'amber', 'SHAPES IN A 70B-CLASS MODEL', [
            'q_i = x_i·W_Q     k_i = x_i·W_K     v_i = x_i·W_V',
            'd_model 8,192 · 64 query heads · 8 KV heads · d_head 128',
            'W_Q 8192×8192 = 67.1 M      W_K, W_V 8192×1024 = 8.4 M each',
            'fused: [n × 8192] · [8192 × 10240]  →  one GEMM',
            'RoPE rotates q, k pairs so q_m·k_n depends on m − n'
          ], { lh: 30 }));
          ctx.reveal(S.cardL, { from: 'up', delay: 1000 });

          /* RoPE: position enters as a rotation of every (q, k) 2-D pair */
          S.rope = card(ctx, null, 860, 350, 680, 262, 'amber', 'RoPE · POSITION = ROTATION OF EACH (q, k) PAIR');
          var RC = { x: 970, y: 484 }, RR = 70, TH = 0.5;
          ctx.circle(RC.x, RC.y, RR, { stroke: ctx.alpha('white', 0.18), sw: 1, parent: S.rope });
          ctx.line(RC.x - RR - 6, RC.y, RC.x + RR + 6, RC.y, { color: ctx.alpha('white', 0.1), sw: 1, parent: S.rope });
          var arms = TOK.map(function (t, m) {
            var hot = m === 3 || m === 5, col = m === 5 ? 'amber' : 'cyan';
            var ln = ctx.line(RC.x, RC.y, RC.x + RR, RC.y, { color: hot ? col : ctx.alpha('cyan', 0.35), sw: hot ? 2.4 : 1.2, arrow: hot, parent: S.rope });
            var lb = ctx.text(RC.x + RR + 10, RC.y, m === 5 ? 'q ice' : (m === 3 ? 'k lands' : t), { size: 11, font: 'mono', color: hot ? col : 'dim', parent: S.rope });
            return { ln: ln, lb: lb, m: m };
          });
          var arc = ctx.path('M' + (RC.x + 34 * Math.cos(1.5)) + ',' + (RC.y - 34 * Math.sin(1.5)) + ' A34,34 0 0 0 ' + (RC.x + 34 * Math.cos(2.5)) + ',' + (RC.y - 34 * Math.sin(2.5)), { stroke: 'white', sw: 1.2, parent: S.rope });
          var arcT = ctx.text(RC.x, RC.y + 34, 'gap = (m−n)·θ = 2θ', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: S.rope });
          ctx.text(RC.x + 6, 588, 'q_m·k_n depends on m − n', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: S.rope });
          function setAngles(t) {
            arms.forEach(function (a) {
              var ang = a.m * TH * t, c = Math.cos(ang), s = Math.sin(ang);
              a.ln.setAttribute('x2', RC.x + RR * c); a.ln.setAttribute('y2', RC.y - RR * s);
              a.lb.setAttribute('x', RC.x + (RR + 10) * c); a.lb.setAttribute('y', RC.y - (RR + 10) * s - (Math.abs(c) < 0.3 ? 6 : 0));
              a.lb.setAttribute('text-anchor', c > 0.3 ? 'start' : (c < -0.3 ? 'end' : 'middle'));
            });
            arc.setAttribute('opacity', t >= 1 ? 1 : 0); arcT.setAttribute('opacity', t >= 1 ? 1 : 0);
          }
          setAngles(0);
          S.hands = [[0, '6.3 tok'], [16, '167 tok'], [48, '118k tok']].map(function (d, k) {
            var cx = 1160 + k * 136, cy = 474;
            ctx.text(cx, 412, 'pair i = ' + d[0], { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: S.rope });
            ctx.circle(cx, cy, 40, { stroke: ctx.alpha('amber', 0.4), sw: 1, parent: S.rope });
            var h = ctx.line(cx, cy, cx + 36, cy, { color: 'amber', sw: 2, parent: S.rope });
            ctx.text(cx, 532, 'λ = ' + d[1], { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: S.rope });
            return { h: h, cx: cx, cy: cy, th: Math.pow(500000, -2 * d[0] / 128) };
          });
          ctx.text(1296, 562, 'θ_i = 500,000^(−2i/128)   (Llama 3 base)', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.rope });
          ctx.text(1296, 588, 'fast pairs: local order · slow pairs: long range', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.rope });
          /* the hands advance at 2 tokens per second: angle = position · θ_i */
          S.ropeLoop = ctx.loop(function (t) {
            S.hands.forEach(function (h) { var a = 2 * t * h.th; h.h.setAttribute('x2', h.cx + 36 * Math.cos(a)); h.h.setAttribute('y2', h.cy - 36 * Math.sin(a)); });
          });
          ctx.reveal(S.rope, { from: 'right', delay: 900 });
          ctx.tween(1400, setAngles, 'inOut', 1500);

          /* row sweep */
          S.xHi = ctx.rect(161, ROW0 - 2, 205, 26, { rx: 4, stroke: 'white', sw: 2, glow: true });
          S.xHi.setAttribute('opacity', 0);
          var done = -1;
          function fillRow(i) {
            ['Q', 'K', 'V'].forEach(function (k) {
              var g = S.res[k];
              g.m.cells[i].forEach(function (c, cc) { c.setAttribute('fill', ctx.cmap('diverge', S[g.key][i][cc] * 0.85)); });
            });
          }
          return ctx.wait(1300).then(function () {
            S.xHi.setAttribute('opacity', 1);
            return ctx.tween(2600, function (t) {
              var k = Math.min(5, Math.floor(t * 6));
              S.xHi.setAttribute('y', ROW0 - 2 + k * RP);
              while (done < k) { done++; fillRow(done); }
              if (t >= 1) { while (done < 5) { done++; fillRow(done); } }
            }, 'linear');
          }).then(function () {
            return ctx.remove(S.xHi, 300);
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Scores QKᵀ/√d',
        say: 'Now every query is compared with every key using a dot product. Ice against lands gives a large raw score, because the model has learned that a surface word should look for the verb that lands on it. Doing this for all pairs gives an n by n score matrix. Then we divide by the square root of the head dimension. With one hundred twenty eight dimensions, raw dot products have a standard deviation around eleven, which would saturate the softmax and kill the gradients.',
        deep: '<div class="eq">s<sub>ij</sub> = q<sub>i</sub>·k<sub>j</sub> / √d<sub>k</sub>, &nbsp; S = QKᵀ/√d<sub>k</sub> ∈ ℝ<sup>n×n</sup></div>' +
          '<p>If the components of q and k are i.i.d. with zero mean and unit variance, Var(q·k) = d<sub>k</sub>. With d<sub>k</sub> = 128 the raw logits have σ ≈ 11.3; the softmax of such logits is nearly one-hot and its Jacobian diag(p) − ppᵀ → 0, so gradients vanish. Dividing by √d<sub>k</sub> restores σ ≈ 1.</p>' +
          '<ul><li>Cost: <b>2n²d<sub>k</sub></b> FLOPs per head, the first quadratic term. One batched GEMM [n×d<sub>k</sub>]·[d<sub>k</sub>×n] per head.</li>' +
          '<li>At scale, logits still drift upward during training. Modern recipes add <b>QK-norm</b> (RMSNorm on q and k: OLMo 2, Qwen3, Gemma 3) or <b>logit soft-capping</b> (Gemma 2: 50·tanh(s/50)).</li>' +
          '<li>The score is bilinear: s<sub>ij</sub> = x<sub>i</sub>W<sub>Q</sub>W<sub>K</sub>ᵀx<sub>j</sub>ᵀ/√d<sub>k</sub>, a learned similarity of rank ≤ d<sub>k</sub>.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          S.ropeLoop.stop();
          ctx.remove(S.rope, 400);
          ctx.fade([S.xg, S.wg, S.res.V, S.cardL], 0.22, 500);
          /* score matrix */
          S.sg = ctx.group();
          S.Sm = ctx.matrix(SX, SY, 6, 6, { cell: SC_, gap: SP - SC_, values: function () { return '#0b1222'; }, parent: S.sg });
          S.sTxt = [];
          for (var i = 0; i < 6; i++) {
            S.sTxt.push([]);
            for (var j = 0; j < 6; j++) {
              var cc = S.Sm.cellCenter(i, j);
              S.sTxt[i].push(ctx.text(cc.x, cc.y + 1, '', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.sg }));
            }
            ctx.text(SX - 10, SY + i * SP + SC_ / 2, TOK[i], { size: 13, font: 'mono', color: 'amber', anchor: 'end', parent: S.sg });
            var lx = SX + i * SP + SC_ / 2 - 4, ly = SY - 10;
            var lab = ctx.text(lx, ly, TOK[i], { size: 13, font: 'mono', color: 'cyan', parent: S.sg });
            lab.setAttribute('transform', 'rotate(-40 ' + lx + ' ' + ly + ')');
          }
          ctx.text(SX - 10, SY - 16, 'q ↓  k →', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.sg });
          S.sLbl = ctx.text(SX + 142, SY + 6 * SP + 18, 'S = QKᵀ   [n × n]', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: S.sg });
          ctx.reveal(S.sg, { from: 'scale', s0: 0.9, delay: 300 });

          swap(ctx, S, 'cardL', textCard(ctx, 60, 630, 880, 230, 'cyan', 'DOT-PRODUCT SCORES', [
            's_ij = q_i · k_j / √d_k',
            'ice · lands = ' + (S.sc[5][3] * SQ).toFixed(1) + '  →  ÷ √128 = ÷ 11.31  →  ' + S.sc[5][3].toFixed(2),
            'if q, k ~ N(0, I):   Var(q·k) = d_k = 128,  σ ≈ 11.3',
            'unscaled → softmax ≈ one-hot → gradients vanish',
            'cost 2·n²·d_k FLOPs per head: the first n² term'
          ], { lh: 30 }));
          ctx.reveal(S.cardL, { from: 'up', delay: 400 });

          function raw(i, j) { return S.sc[i][j] * SQ; }
          function setCell(i, j, v, scale) {
            S.sTxt[i][j].textContent = fmt(v);
            S.Sm.cells[i][j].setAttribute('fill', ctx.cmap('diverge', v / scale));
          }
          if (ctx.instant) {
            for (var a = 0; a < 6; a++) for (var b = 0; b < 6; b++) setCell(a, b, S.sc[a][b], 3);
            S.sLbl.textContent = 'S = QKᵀ / √d_k   [n × n]';
            return Promise.resolve();
          }
          /* slow demo: ice · lands */
          var qHi = ctx.rect(457, ROW0 + 5 * RP - 3, 103, 28, { rx: 4, stroke: 'amber', sw: 2, glow: true });
          var kHi = ctx.rect(587, ROW0 + 3 * RP - 3, 103, 28, { rx: 4, stroke: 'cyan', sw: 2, glow: true });
          var tc = S.Sm.cellCenter(5, 3);
          var l1 = ctx.path('M560,' + (ROW0 + 5 * RP + 11) + ' C800,' + (ROW0 + 5 * RP + 60) + ' 1000,' + (tc.y + 40) + ' ' + (tc.x - 20) + ',' + (tc.y + 6), { stroke: 'amber', sw: 1.6, arrow: true });
          var l2 = ctx.path('M690,' + (ROW0 + 3 * RP + 11) + ' C850,' + (ROW0 + 3 * RP) + ' 1000,' + (tc.y - 60) + ' ' + (tc.x - 20) + ',' + (tc.y - 6), { stroke: 'cyan', sw: 1.6, arrow: true });
          [qHi, kHi].forEach(function (e) { e.setAttribute('opacity', 0); });
          var sweepFrom = 0;
          return ctx.camera(900, 500, 1.35, 1000).then(function () {
            ctx.reveal([qHi, kHi], { dur: 300 });
            ctx.reveal([l1, l2], { from: 'draw', dur: 700 });
            return ctx.wait(700);
          }).then(function () {
            ctx.pulse(S.Sm.cells[5][3], { color: 'white', dur: 600 });
            return ctx.tween(900, function (t) { setCell(5, 3, raw(5, 3) * t, 28); }, 'out');
          }).then(function () {
            ctx.remove([qHi, kHi, l1, l2], 300);
            return ctx.camera(null, null, null, 900);
          }).then(function () {
            return ctx.tween(1800, function (t) {
              var k = Math.floor(t * 36);
              for (var m = sweepFrom; m < Math.min(36, k + 1); m++) {
                var a = Math.floor(m / 6), b = m % 6;
                setCell(a, b, raw(a, b), 28);
              }
              sweepFrom = Math.min(36, k + 1);
            }, 'linear');
          }).then(function () {
            for (var a = 0; a < 6; a++) for (var b = 0; b < 6; b++) setCell(a, b, raw(a, b), 28);
            return ctx.wait(400);
          }).then(function () {
            S.sLbl.textContent = 'S = QKᵀ / √d_k   [n × n]';
            ctx.pulse(S.sLbl, { color: 'cyan', dur: 600 });
            return ctx.tween(1300, function (t) {
              var div = 1 + (SQ - 1) * t;
              for (var a = 0; a < 6; a++) for (var b = 0; b < 6; b++) setCell(a, b, raw(a, b) / div, 28 - 25 * t);
            }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Mask & softmax',
        say: 'A language model must not peek at the future, so a causal mask sets every score above the diagonal to minus infinity. Then each row goes through a softmax: subtract the row maximum for numerical safety, exponentiate, and normalize so the row sums to one. Each row is now a probability distribution over earlier tokens. Try it: click any token on the left to see its attention row. Ice spreads its attention across lands, on and astronaut, while astronaut locks onto fox.',
        deep: '<div class="eq">M<sub>ij</sub> = 0 if j ≤ i, −∞ otherwise</div>' +
          '<div class="eq">p<sub>ij</sub> = exp(s<sub>ij</sub> + M<sub>ij</sub> − m<sub>i</sub>) / Σ<sub>j′</sub> exp(s<sub>ij′</sub> + M<sub>ij′</sub> − m<sub>i</sub>), &nbsp; m<sub>i</sub> = max<sub>j</sub> s<sub>ij</sub></div>' +
          '<p>Subtracting m<sub>i</sub> leaves the result unchanged but keeps exp() in range. This (max, normaliser) pair is exactly what FlashAttention maintains <i>online</i>, one key block at a time.</p>' +
          '<ul><li>The mask makes training parallel: all n next-token predictions come out of one pass, yet each sees only its prefix.</li>' +
          '<li>Encoders and video DiTs use <b>no mask</b>: every spacetime patch attends to every other (bidirectional).</li>' +
          '<li>Row 1 ("a") can only attend to itself, so p = 1. When nothing is relevant, heads dump mass on early tokens: <b>attention sinks</b>, which StreamingLLM keeps in cache to stay stable.</li>' +
          '<li>Softmax Jacobian: ∂p<sub>i</sub>/∂s<sub>j</sub> = p<sub>i</sub>(δ<sub>ij</sub> − p<sub>j</sub>).</li></ul>' +
          '<p class="muted">Click the token chips or any matrix row to inspect it.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade([S.res.Q, S.res.K], 0.22, 500);
          var upper = [];
          for (var i = 0; i < 6; i++) for (var j = i + 1; j < 6; j++) upper.push([i, j]);

          swap(ctx, S, 'cardL', textCard(ctx, 60, 630, 880, 230, 'amber', 'CAUSAL MASK + ROW SOFTMAX', [
            'M_ij = 0 if j ≤ i,  −∞ if j > i        (no peeking ahead)',
            'm_i = max_j s_ij          (subtract for numerical safety)',
            'p_ij = exp(s_ij − m_i) / Σ_j exp(s_ij − m_i)      Σ_j p_ij = 1',
            'row ice: ' + P[5].map(function (p) { return p.toFixed(2); }).join('  '),
            'row a:   1.00  (only itself: a natural attention sink)'
          ], { lh: 30 }));
          ctx.reveal(S.cardL, { from: 'up', delay: 200 });

          /* right card: one attention row as a heatmap + bars */
          S.cardR = card(ctx, null, 960, 680, 580, 180, 'amber', '');
          S.rowTitle = ctx.text(976, 702, '', { size: 13, font: 'mono', weight: 700, color: 'amber', parent: S.cardR, spacing: 1 });
          S.rowBars = TOK.map(function (t, j) {
            var x = 1010 + j * 90;
            var b = {};
            ctx.rect(x - 26, 728, 52, 100, { rx: 4, fill: 'rgba(255,255,255,0.03)', parent: S.cardR });
            b.bar = ctx.rect(x - 26, 828, 52, 0, { rx: 4, fill: ctx.alpha('amber', 0.6), stroke: 'amber', sw: 1, parent: S.cardR });
            b.val = ctx.text(x, 818, '', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.cardR });
            b.lab = ctx.text(x, 845, t, { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: S.cardR });
            return b;
          });
          ctx.reveal(S.cardR, { from: 'up', delay: 300 });
          S.rowHi = ctx.rect(SX - 5, SY - 5, 6 * SP + 6, SC_ + 10, { rx: 6, stroke: 'white', sw: 2, glow: true, parent: S.sg });
          S.rowHi.setAttribute('opacity', 0);

          S.select = function (r, ms) {
            S.sel = r;
            S.rowTitle.textContent = 'ATTENTION ROW · query = ' + TOK[r] + '   (click any token)';
            S.chips.forEach(function (c, k) { c.bg.setAttribute('fill', ctx.alpha(k === r ? 'amber' : 'cyan', k === r ? 0.45 : 0.13)); });
            var y0 = parseFloat(S.rowHi.getAttribute('y')), y1 = SY - 5 + r * SP;
            S.rowHi.setAttribute('opacity', 1);
            if (S.oHi) ctx.animate(S.oHi, { y: [parseFloat(S.oHi.getAttribute('y')), y1] }, ms || 300, 'out');
            var from = S.rowBars.map(function (b) { return parseFloat(b.bar.getAttribute('height')); });
            return ctx.tween(ms || 300, function (t) {
              S.rowHi.setAttribute('y', y0 + (y1 - y0) * t);
              S.rowBars.forEach(function (b, j) {
                var h = from[j] + (pOf(r, j) * 100 - from[j]) * t;
                b.bar.setAttribute('y', 828 - h); b.bar.setAttribute('height', Math.max(0, h));
                b.val.setAttribute('y', 818 - h);
                b.val.textContent = j <= r ? pOf(r, j).toFixed(2) : 'masked';
                b.val.setAttribute('fill', j <= r ? ctx.C.white : ctx.C.dim);
                b.lab.setAttribute('fill', j <= r ? ctx.C.text : ctx.C.faint);
              });
            }, 'out');
          };
          /* interactivity: chips and matrix rows */
          S.chips.forEach(function (c, k) {
            c.style.cursor = 'pointer';
            c.addEventListener('click', function (ev) { ev.stopPropagation(); if (S.select) S.select(k, 350); });
          });
          S.Sm.cells.forEach(function (row, k) {
            row.forEach(function (cell) {
              cell.style.cursor = 'pointer';
              cell.addEventListener('click', function (ev) { ev.stopPropagation(); if (S.select) S.select(k, 350); });
            });
          });
          S.hint = ctx.text(100, ROW0 - 22, 'click a token', { size: 11, font: 'mono', color: 'amber', anchor: 'middle' });
          ctx.reveal(S.hint, { delay: 600 });

          function maskCell(a, b) {
            S.Sm.cells[a][b].setAttribute('fill', '#05080f');
            S.Sm.cells[a][b].setAttribute('stroke', ctx.alpha('red', 0.35));
            S.sTxt[a][b].textContent = '−∞';
            S.sTxt[a][b].setAttribute('fill', ctx.alpha('red', 0.8));
          }
          function probCell(a, b, t) {
            var v = S.sc[a][b] + (P[a][b] - S.sc[a][b]) * t;
            S.sTxt[a][b].textContent = t < 1 ? fmt(v) : P[a][b].toFixed(2);
            var c0 = ctx.cmap('diverge', S.sc[a][b] / 3), c1 = ctx.cmap('amber', Math.sqrt(P[a][b]));
            S.Sm.cells[a][b].setAttribute('fill', t < 1 ? mixRgb(c0, c1, t) : c1);
            S.sTxt[a][b].setAttribute('fill', t > 0.5 && P[a][b] > 0.45 ? '#1a1206' : ctx.C.white);
          }
          function mixRgb(a, b, t) {
            function p(c) { if (c.charAt(0) === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; return c.replace(/[^\d,]/g, '').split(',').map(Number); }
            var x = p(a), y = p(b);
            return 'rgb(' + x.map(function (v, i) { return Math.round(v + (y[i] - v) * t); }).join(',') + ')';
          }
          S.sLbl.textContent = 'P = softmax(S + M)   [n × n]';
          var rowsDone = 0;
          return ctx.tween(900, function (t) {
            var k = Math.floor(t * upper.length);
            for (var m = 0; m < Math.min(upper.length, k + 1); m++) maskCell(upper[m][0], upper[m][1]);
            if (t >= 1) upper.forEach(function (u) { maskCell(u[0], u[1]); });
          }, 'linear').then(function () {
            return ctx.wait(300);
          }).then(function () {
            return ctx.tween(2600, function (t) {
              var f = t * 6, k = Math.min(5, Math.floor(f)), lt = t >= 1 ? 1 : f - k;
              for (var a = rowsDone; a < k; a++) for (var b = 0; b <= a; b++) probCell(a, b, 1);
              rowsDone = k;
              for (var b2 = 0; b2 <= k; b2++) probCell(k, b2, lt);
              if (!ctx.instant) S.rowHi.setAttribute('opacity', 1), S.rowHi.setAttribute('y', SY - 5 + k * SP);
            }, 'linear');
          }).then(function () {
            for (var a = 0; a < 6; a++) for (var b = 0; b <= a; b++) probCell(a, b, 1);
            return S.select(5, 500);
          }).then(function () {
            ctx.pulse(S.chips[5], { color: 'amber', dur: 500 });
            return ctx.wait(400);
          }).then(function () {
            return S.select(2, 500);
          }).then(function () { return ctx.wait(700); }).then(function () {
            return S.select(5, 500);
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Mix the values',
        say: 'Finally each query collects its answer. The output for ice is the sum of every earlier value vector, weighted by the probabilities we just computed: thirty four percent of lands, twenty two percent of on, and so on. As a matrix, that is the attention matrix times V. The result has one row per token, the width of a head, and it now carries context: ice has learned that it is the surface something landed on.',
        deep: '<div class="eq">o<sub>i</sub> = Σ<sub>j≤i</sub> p<sub>ij</sub> v<sub>j</sub>, &nbsp; O = PV ∈ ℝ<sup>n×d<sub>v</sub></sup></div>' +
          '<p>Because p<sub>i</sub> lies on the probability simplex, o<sub>i</sub> is inside the convex hull of the visible values: attention can <i>select</i> and <i>blend</i>, never extrapolate. Another 2n²d<sub>v</sub> FLOPs, so a head costs <b>4n²d<sub>k</sub></b> in total (about half with causal block skipping).</p>' +
          '<pre># naive reference, one head\nfor i in range(n):\n    s = K[:i+1] @ Q[i] / sqrt(dk)\n    p = exp(s - s.max()); p /= p.sum()\n    O[i] = p @ V[:i+1]</pre>' +
          '<p>Note the data dependency: the whole row of scores must exist before it can be normalised, which is why naive kernels materialise P. FlashAttention’s <b>online softmax</b> breaks that dependency and never stores P.</p>' +
          '<p class="muted">Clicking a token now also highlights its output row.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.res.V, 1, 500);
          S.og = ctx.group();
          S.Om = ctx.matrix(OX, SY, 6, 4, { cell: SC_, gap: SP - SC_, values: function () { return '#0b1222'; }, parent: S.og });
          ctx.text(OX + 92, SY - 22, 'O = P·V', { size: 14, font: 'mono', weight: 700, color: 'violet', anchor: 'middle', parent: S.og });
          ctx.text(OX + 92, SY + 6 * SP + 18, '[n × d_v]', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.og });
          ctx.text(OX - 19, SY + 2.5 * SP + 20, '·V', { size: 15, font: 'mono', color: 'violet', anchor: 'middle', parent: S.og });
          ctx.reveal(S.og, { from: 'right', delay: 200 });

          swap(ctx, S, 'cardL', textCard(ctx, 60, 630, 880, 230, 'violet', 'WEIGHTED SUM OF VALUES', [
            'o_i = Σ_j p_ij · v_j                 O = P·V   [n × d_v]',
            'o_ice = .04·v_a + .13·v_fox + .19·v_astronaut',
            '      + .34·v_lands + .22·v_on + .08·v_ice',
            'convex mix: o_i lies inside hull{ v_1 … v_i }',
            'cost: another 2·n²·d_v FLOPs  →  4·n²·d per head'
          ], { lh: 30 }));
          ctx.reveal(S.cardL, { from: 'up', delay: 300 });

          function fillO(i) { S.Om.cells[i].forEach(function (c, k) { c.setAttribute('fill', ctx.cmap('diverge', S.Ov[i][k])); }); }
          function finish() {
            for (var i = 0; i < 6; i++) fillO(i);
            if (!S.oHi) S.oHi = ctx.rect(OX - 5, SY - 5 + (S.sel === undefined ? 5 : S.sel) * SP, 4 * SP + 6, SC_ + 10, { rx: 6, stroke: 'white', sw: 2, glow: true, parent: S.og });
          }
          if (ctx.instant) { finish(); return Promise.resolve(); }
          var target = 5;
          return S.select(target, 400).then(function () {
            var flights = [];
            for (var j = 0; j <= target; j++) {
              (function (j) {
                var gh = ctx.group();
                S.Vv[j].forEach(function (v, c) { ctx.rect(c * RP, 0, 22, 22, { rx: 3, fill: ctx.cmap('diverge', v * 0.85), parent: gh }); });
                ctx.place(gh, 720, ROW0 + j * RP);
                gh.setAttribute('opacity', 0.25 + P[target][j] * 2);
                var hl = ctx.rect(716, ROW0 + j * RP - 3, 105, 28, { rx: 4, stroke: 'violet', sw: 1.5 });
                flights.push(ctx.wait(j * 220).then(function () {
                  return ctx.transform(gh, { x: OX, y: SY + target * SP, s: SP / RP }, 900, 'inOut');
                }).then(function () {
                  ctx.remove(hl, 200);
                  return ctx.fadeOut(gh, 250, true);
                }));
              })(j);
            }
            return Promise.all(flights);
          }).then(function () {
            fillO(target);
            ctx.pulse(S.Om, { color: 'violet', dur: 600 });
            return ctx.wait(400);
          }).then(function () {
            return ctx.tween(1200, function (t) {
              var k = Math.min(5, Math.floor(t * 5));
              for (var i = 0; i <= k; i++) fillO(i);
            }, 'linear');
          }).then(function () {
            finish();
            return ctx.wait(200);
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Many heads',
        say: 'One softmax gives each token a single blend, which is too little. So the model runs many heads in parallel, each with its own small query, key and value projections living in a slice of the embedding. One head tracks the previous token, another links subjects to verbs, another parks attention on the first token as a sink. Their outputs are concatenated and mixed back into the residual stream by the output matrix, W O.',
        deep: '<div class="eq">MHA(X) = Concat(head<sub>1</sub>, …, head<sub>h</sub>) W<sub>O</sub>, &nbsp; head<sub>i</sub> = Attn(XW<sub>Q</sub><sup>(i)</sup>, XW<sub>K</sub><sup>(i)</sup>, XW<sub>V</sub><sup>(i)</sup>)</div>' +
          '<p>With h·d<sub>k</sub> = d, multi-head costs the same FLOPs as one wide head but produces h independent mixing patterns per token, each a bilinear form of rank ≤ d<sub>k</sub>.</p>' +
          '<table><tr><th>Per layer (70B-class, GQA-8)</th><th>Params</th></tr>' +
          '<tr><td>W<sub>Q</sub> + W<sub>O</sub> (8192² each)</td><td>134.2 M</td></tr>' +
          '<tr><td>W<sub>K</sub> + W<sub>V</sub> (8192×1024 each)</td><td>16.8 M</td></tr>' +
          '<tr><td>Total × 80 layers</td><td>≈ 12.1 B (~17% of 70B)</td></tr></table>' +
          '<p>Interpretability finds recurring head types: previous-token heads, <b>induction heads</b> ([A][B] … [A] → predict [B], the circuit behind in-context copying), name movers, and sink heads. In a video DiT, heads similarly split into spatial, temporal and text-conditioning roles. Patterns shown are illustrative.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var old = [S.xg, S.wg, S.res.Q, S.res.K, S.res.V, S.sg, S.og, S.cardR, S.hint, S.eq].concat(S.chips);
          ctx.remove(old, 450);
          S.select = null;
          swap(ctx, S, 'cardL', null);
          S.hdr.textContent = 'MULTI-HEAD ATTENTION · d_model 8,192 = 64 heads × 128';

          /* split bar */
          S.mh = ctx.group();
          S.segs = [];
          for (var i = 0; i < 8; i++) {
            var sg = ctx.group({ parent: S.mh });
            ctx.rect(0, 0, 80, 26, { rx: 4, fill: ctx.alpha(HC[i], 0.3), stroke: HC[i], sw: 1.2, parent: sg });
            ctx.text(40, 13.5, 'h' + (i < 7 ? i + 1 : 64), { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: sg });
            ctx.place(sg, 80 + i * 80, 196);
            S.segs.push(sg);
          }
          S.dots = ctx.text(806, 210, '…', { size: 16, font: 'mono', color: 'dim', parent: S.mh });
          ctx.reveal(S.mh, { from: 'left' });

          /* four head maps */
          var kinds = [
            ['h1 · previous token', function (r, c) { return r === 0 ? 1 : (c === r - 1 ? 0.8 : (c === r ? 0.14 : 0.06 / Math.max(1, r - 1))); }],
            ['h2 · subject ↔ verb', function (r, c) { return pOf(r, c); }],
            ['h3 · attention sink', function (r, c) { return c === 0 ? (r === 0 ? 1 : 0.76) : 0.24 / r; }],
            ['h4 · local decay', function (r, c) { var w = [], s = 0; for (var k = 0; k <= r; k++) { w.push(Math.exp(-(r - k) * 0.9)); s += w[k]; } return w[c] / s; }]
          ];
          S.maps = [];
          S.outs = [];
          var hr = ctx.rng(17);
          kinds.forEach(function (k, h) {
            var x = 80 + h * 210, g = ctx.group();
            ctx.text(x + 67, 282, k[0], { size: 12, font: 'mono', color: HC[h], anchor: 'middle', parent: g });
            g.m = ctx.matrix(x, 298, 6, 6, { cell: 20, gap: 3, parent: g, values: function (r, c) { return c > r ? '#070b14' : ctx.cmap('amber', Math.sqrt(k[1](r, c))); } });
            ctx.rect(x - 4, 294, 142, 142, { rx: 5, stroke: ctx.alpha(HC[h], 0.8), sw: 1.3, parent: g });
            ctx.line(120 + h * 90, 224, x + 67, 268,{ color: ctx.alpha(HC[h], 0.6), sw: 1.2, parent: g });
            ctx.text(x + 67, 452, 'P_' + (h + 1) + ' · V_' + (h + 1), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            var o = ctx.matrix(x + 50, 466, 6, 3, { cell: 10, gap: 2, parent: g, cmap: 'diverge', values: function () { return hr() * 2 - 1; } });
            ctx.rect(x + 47, 463, 40, 76, { rx: 3, stroke: HC[h], sw: 1, parent: g });
            S.maps.push(g);
            S.outs.push(ctx.line(x + 67, 542, 120 + h * 190, 578, { color: ctx.alpha(HC[h], 0.8), sw: 1.4, arrow: true, parent: g }));
          });
          ctx.reveal(S.maps, { from: 'up', delay: 700, stagger: 160 });

          /* concat, W_O, output */
          S.cat = ctx.group();
          for (var c = 0; c < 4; c++) ctx.rect(80 + c * 190, 582, 186, 24, { rx: 3, fill: ctx.alpha(HC[c], 0.3), stroke: HC[c], sw: 1, parent: S.cat });
          ctx.text(842, 594, '…', { size: 16, font: 'mono', color: 'dim', parent: S.cat });
          ctx.text(80, 626, 'concat(head_1 … head_64)   [n × 64·128 = n × 8,192]', { size: 12, font: 'mono', color: 'text', parent: S.cat });
          S.wo = ctx.node({ x: 462, y: 690, w: 330, h: 54, title: 'W_O   8192 × 8192', sub: 'mixes heads back to d_model', color: 'amber', titleSize: 15, subSize: 11, parent: S.cat });
          ctx.line(462, 638, 462, 660, { color: 'amber', sw: 1.4, arrow: true, parent: S.cat });
          ctx.line(462, 718, 462, 752, { color: 'amber', sw: 1.4, arrow: true, parent: S.cat });
          ctx.text(462, 772, 'x ← x + Δh     (residual add, [n × 8,192])', { size: 14, font: 'mono', color: 'white', anchor: 'middle', parent: S.cat });
          ctx.reveal(S.cat, { from: 'up', delay: 1500 });

          S.mhR = ctx.group();
          var c1 = textCard(ctx, 960, 190, 580, 214, 'amber', 'ATTENTION PARAMS PER LAYER', [
            'W_Q  8192 × 8192     67.1 M',
            'W_K  8192 × 1024      8.4 M   (8 KV heads)',
            'W_V  8192 × 1024      8.4 M',
            'W_O  8192 × 8192     67.1 M',
            'Σ 151 M × 80 layers ≈ 12.1 B  (~17% of 70B)'
          ], { lh: 30 });
          var c2 = textCard(ctx, 960, 436, 580, 214, 'cyan', 'WHY MANY HEADS', [
            'one softmax row = one convex blend per token',
            'h heads → h independent blends, same FLOPs',
            'each QₕKₕᵀ has rank ≤ d_head = 128',
            'induction heads: [A][B] … [A] → predict [B]',
            'video DiT heads: spatial / temporal / text'
          ], { lh: 30 });
          S.mhR.appendChild(c1); S.mhR.appendChild(c2);
          ctx.reveal(S.mhR, { from: 'right', delay: 1000 });

          return ctx.wait(300).then(function () {
            return ctx.tween(800, function (t) {
              S.segs.forEach(function (sg, i) { ctx.place(sg, 80 + i * (80 + 10 * t), 196); });
              S.dots.setAttribute('x', 806 + 64 * t);
            }, 'out');
          }).then(function () {
            return ctx.wait(1400);
          }).then(function () {
            return Promise.all(S.outs.map(function (l, i) { return ctx.packet(l, { color: HC[i], dur: 700, r: 4 }); }));
          }).then(function () {
            return ctx.pulse(S.wo, { color: 'amber', dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'The quadratic wall',
        say: 'Here is the catch. Attention compute grows with the square of the sequence length, while everything else grows linearly. For a seventy billion parameter model, attention overtakes all the other matrix multiplies at around fifty thousand tokens. A single video shot is seventy five thousand tokens, so video models live on the wrong side of this curve. Worse, a naive kernel writes the full n by n matrix to memory. The answers: exact but IO aware kernels like FlashAttention, local windows, and linear or sparse hybrids.',
        deep: '<div class="eq">FLOPs/layer ≈ 2·n·N<sub>layer</sub> + 4·n²·d &nbsp; (N<sub>layer</sub> ≈ 856 M, d = 8,192)</div>' +
          '<p>Crossover at n ≈ 2N<sub>layer</sub>/(4d) ≈ <b>52k</b> tokens (≈ 104k with causal block skipping). Materialising S in BF16 costs 2n² bytes per head: <b>32 GiB</b> at n = 128k, per head, per layer.</p>' +
          '<table><tr><th>Approach</th><th>Compute</th><th>Cache / state</th></tr>' +
          '<tr><td>Full + FlashAttention</td><td>O(n²d), exact</td><td>O(n)</td></tr>' +
          '<tr><td>Sliding window w</td><td>O(nwd)</td><td>O(w)</td></tr>' +
          '<tr><td>Linear / SSM (Mamba-2, Gated DeltaNet)</td><td>O(nd²)</td><td>O(d²), constant</td></tr>' +
          '<tr><td>Sparse top-k (NSA, DeepSeek DSA)</td><td>O(nkd) + light indexer</td><td>O(n)</td></tr></table>' +
          '<p>Production long-context models <b>interleave</b>: Gemma 3 (5 local layers with a 1,024-token window : 1 global), MiniMax-01 (7 lightning-attention : 1 softmax), Qwen3-Next and Kimi Linear (3 linear : 1 full). Pure linear layers compress history into a fixed state and lose exact recall, hence the hybrids.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove([S.mh, S.cat, S.mhR].concat(S.maps), 450);
          S.hdr.textContent = 'COST OF ATTENTION vs CONTEXT LENGTH';
          S.q = ctx.group();
          var X0 = 120, Y0 = 236, W = 640, H = 300;
          ctx.text(X0 - 10, 206, 'FLOPs PER LAYER vs n   (70B-class, log–log)', { size: 13, font: 'mono', weight: 700, color: 'amber', parent: S.q, spacing: 1 });
          var dense = ctx.plot(X0, Y0, W, H, function (x) { return 9.2335 + x; }, { xDomain: [3, 6], yDomain: [10, 17], color: 'cyan', sw: 2.5, parent: S.q });
          var att = ctx.plot(X0, Y0, W, H, function (x) { return 4.515 + 2 * x; }, { xDomain: [3, 6], yDomain: [10, 17], color: 'amber', sw: 2.5, axes: false, parent: S.q });
          [[3, '1k'], [4, '10k'], [5, '100k'], [6, '1M']].forEach(function (t) {
            var p = dense.toPx(t[0], 10);
            ctx.text(p.x, Y0 + H + 16, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.q });
          });
          [11, 13, 15, 17].forEach(function (v) {
            var p = dense.toPx(3, v);
            ctx.text(X0 - 8, p.y, '1e' + v, { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.q });
          });
          ctx.text(X0 + W, Y0 + H + 34, 'context length n', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.q });
          var pl = dense.toPx(5.6, 9.2335 + 5.6);
          ctx.text(pl.x + 6, pl.y + 22, 'matmuls 2·n·N_layer', { size: 12, font: 'mono', color: 'cyan', parent: S.q });
          var pa = att.toPx(5.35, 4.515 + 10.7);
          ctx.text(pa.x - 12, pa.y - 4, 'attention 4·n²·d', { size: 12, font: 'mono', color: 'amber', anchor: 'end', parent: S.q });
          var xc = dense.toPx(4.718, 9.2335 + 4.718);
          S.cross = ctx.circle(xc.x, xc.y, 7, { fill: 'white', glow: true, parent: S.q });
          ctx.text(xc.x + 12, xc.y + 14, '≈ 52k', { size: 12, font: 'mono', color: 'white', weight: 700, parent: S.q });
          [[4.079, '12k agent ctx', 'magenta', 0], [4.878, '75.6k DiT shot', 'lime', 1], [5.117, '128k', 'violet', 2]].forEach(function (m) {
            var p = dense.toPx(m[0], 10);
            ctx.line(p.x, Y0 + 4, p.x, Y0 + H, { color: ctx.alpha(m[2], 0.55), dash: '3 4', sw: 1.2, parent: S.q });
            ctx.text(p.x + (m[3] === 2 ? 6 : -6), Y0 + 14 + m[3] * 18, m[1], { size: 11, font: 'mono', color: m[2], anchor: m[3] === 2 ? 'start' : 'end', parent: S.q });
          });
          ctx.reveal(S.q, { delay: 200 });
          [dense.curve, att.curve].forEach(function (c) { c.setAttribute('opacity', 0); });

          S.memCard = textCard(ctx, 60, 610, 740, 250, 'red', 'THE n² MEMORY WALL (naive kernel)', [
            'S = QKᵀ stored in BF16: 2·n² bytes per head',
            'n = 12k    →   288 MB',
            'n = 75.6k  →   11.4 GB',
            'n = 128k   →   32 GiB    per head, per layer',
            'write S, read S, write P, read P  →  IO-bound'
          ], { lh: 30 });
          ctx.reveal(S.memCard, { from: 'up', delay: 800 });

          /* mask menu */
          S.masks = ctx.group();
          var specs = [
            ['full causal', 'amber', function (r, c) { return c <= r ? 0.75 : -1; }, ['O(n²·d) · KV O(n)', 'exact recall']],
            ['sliding window', 'cyan', function (r, c) { return c <= r && r - c < 3 ? 0.75 : (c <= r ? -2 : -1); }, ['O(n·w·d) · KV O(w)', 'Mistral · Gemma 3 5:1']],
            ['linear / gated', 'lime', function (r, c) { return c <= r ? Math.exp(-(r - c) * 0.33) : -1; }, ['O(n·d²) · state O(d²)', 'Qwen3-Next · Kimi 3:1']]
          ];
          specs.forEach(function (s, i) {
            var x = 890 + i * 220;
            ctx.text(x + 74, 214, s[0], { size: 13, font: 'mono', weight: 700, color: s[1], anchor: 'middle', parent: S.masks });
            ctx.matrix(x, 232, 10, 10, { cell: 13, gap: 2, parent: S.masks, values: function (r, c) {
              var v = s[2](r, c);
              if (v === -1) return '#070b14';
              if (v === -2) return '#141a2a';
              return ctx.cmap(s[1] === 'amber' ? 'amber' : (s[1] === 'cyan' ? 'cyan' : 'lime'), v);
            } });
            ctx.para(x + 74, 408, s[3], { size: 12, font: 'mono', color: 'text', anchor: 'middle', lh: 20, parent: S.masks });
          });
          ctx.reveal(S.masks, { from: 'right', delay: 1200 });

          S.flash = ctx.node({ x: 1210, y: 504, w: 640, h: 76, title: 'FlashAttention', sub: 'exact · IO-aware · the n×n matrix never touches HBM', icon: 'bolt', color: 'amber', titleSize: 20, subSize: 12 });
          ctx.reveal(S.flash, { from: 'scale', delay: 1800 });
          ctx.hotspot(S.flash, 'flash-attention');

          S.tool = textCard(ctx, 890, 580, 650, 280, 'teal', 'LONG-CONTEXT TOOLBOX', [
            'exact    FlashAttention · ring / context parallel',
            'local    sliding window, local:global interleave',
            'linear   Mamba-2, Gated DeltaNet, lightning attn',
            'sparse   NSA, DeepSeek Sparse Attention (top-k)',
            'hybrid   3–7 cheap layers : 1 full-attention layer',
            'video    windowed / sparse spatiotemporal DiT attn'
          ], { size: 13, lh: 34 });
          ctx.reveal(S.tool, { from: 'up', delay: 2200 });
          ctx.hud('attention FLOPs > matmul FLOPs beyond n ≈ 52k');

          return ctx.wait(400).then(function () {
            dense.curve.setAttribute('opacity', 1); att.curve.setAttribute('opacity', 1);
            ctx.reveal(dense.curve, { from: 'draw', dur: 1000 });
            return ctx.reveal(att.curve, { from: 'draw', dur: 1300, delay: 200 });
          }).then(function () {
            return ctx.pulse(S.cross, { color: 'white', dur: 700 });
          }).then(function () {
            return ctx.wait(1400);
          }).then(function () {
            return ctx.pulse(S.flash, { color: 'amber', dur: 800 });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'The KV cache',
        say: 'During generation the model emits one token at a time, and recomputing keys and values for the whole prefix every step would be wasteful. So each layer caches them. A new token, moon, computes only its own query, key and value, appends its key and value to the cache, and attends over everything cached. The cache is not free. For a seventy billion parameter model with grouped query attention, each token costs three hundred twenty kilobytes, so one hundred twenty eight thousand tokens of context need forty gigabytes.',
        deep: '<div class="eq">bytes/token = 2 · L · n<sub>kv</sub> · d<sub>head</sub> · b</div>' +
          '<p>Llama-3-70B-class: 2 · 80 · 8 · 128 · 2 B = 327,680 B = <b>320 KiB</b>. At 131,072 tokens: <b>40 GiB</b> per sequence, half an H100, on top of ≈ 140 GB of BF16 weights. With full MHA (n<sub>kv</sub> = 64) it would be 2.5 MiB/token and 320 GiB.</p>' +
          '<ul><li>Decode reads the <i>whole</i> cache for every new token: at 128k, 42.9 GB ÷ 3.35 TB/s ≈ <b>12.8 ms</b> of HBM time per token per GPU-equivalent. Arithmetic intensity ≈ n<sub>q</sub>/n<sub>kv</sub> FLOP/byte in BF16, deep in the memory-bound regime.</li>' +
          '<li><b>PagedAttention</b> stores the cache in fixed blocks (e.g. 16 tokens) addressed through a block table: no fragmentation, copy-on-write sharing.</li>' +
          '<li><b>Prefix caching</b>: our six agents share one long system prompt; its KV blocks are computed once and reused across calls.</li>' +
          '<li>FP8 KV cache halves b; offloading cold blocks to CPU/SSD extends capacity.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove([S.q, S.memCard, S.masks, S.flash, S.tool], 450);
          S.hdr.textContent = 'DECODING · ONE NEW TOKEN PER FORWARD PASS';
          var toks = TOK.concat(['moon']);
          var W8 = [0.03, 0.10, 0.12, 0.30, 0.15, 0.28, 0.02];
          S.kv = ctx.group();
          S.kvChips = toks.map(function (t, i) {
            var c = chip(ctx, S.kv, t, i === 6 ? 'amber' : 'cyan', 86);
            ctx.place(c, 100 + i * 95, 212);
            return c;
          });
          S.kvChips[6].setAttribute('opacity', 0);
          [['K cache', 154, 'cyan'], ['q (moon)', 304, 'amber'], ['V cache', 444, 'violet'], ['o (moon)', 620, 'violet']].forEach(function (h) {
            ctx.text(h[1], 262, h[0], { size: 13, font: 'mono', weight: 700, color: h[2], anchor: 'middle', parent: S.kv });
          });
          var kr = ctx.rng(5);
          S.kRows = []; S.vRows = [];
          for (var i = 0; i < 7; i++) {
            var y = 282 + i * 28;
            S.kRows.push(ctx.matrix(110, y, 1, 4, { cell: 20, gap: 3, cmap: 'diverge', values: function () { return kr() * 2 - 1; }, parent: S.kv }));
            S.vRows.push(ctx.matrix(400, y, 1, 4, { cell: 20, gap: 3, cmap: 'diverge', values: function () { return kr() * 2 - 1; }, parent: S.kv }));
            ctx.text(100, y + 10, toks[i], { size: 11, font: 'mono', color: i === 6 ? 'amber' : 'dim', anchor: 'end', parent: S.kv });
          }
          S.kRows[6].setAttribute('opacity', 0); S.vRows[6].setAttribute('opacity', 0);
          S.qv = ctx.matrix(260, 366, 1, 4, { cell: 20, gap: 3, cmap: 'diverge', values: function () { return kr() * 2 - 1; }, parent: S.kv });
          ctx.rect(256, 362, 97, 28, { rx: 4, stroke: 'amber', sw: 1.5, parent: S.kv });
          S.ov = ctx.matrix(576, 366, 1, 4, { cell: 20, gap: 3, values: function () { return '#0b1222'; }, parent: S.kv });
          ctx.rect(572, 362, 97, 28, { rx: 4, stroke: 'violet', sw: 1.5, parent: S.kv });
          S.qLines = []; S.wBars = []; S.oLines = [];
          for (var j = 0; j < 7; j++) {
            var yy = 292 + j * 28;
            S.qLines.push(ctx.path('M256,376 C230,376 225,' + yy + ' 203,' + yy, { stroke: 'amber', sw: 0.6 + W8[j] * 9, parent: S.kv }));
            S.wBars.push(ctx.rect(497, yy - 6, 0, 12, { rx: 2, fill: ctx.alpha('amber', 0.7), parent: S.kv }));
            S.oLines.push(ctx.path('M' + (500 + W8[j] * 150) + ',' + yy + ' C540,' + yy + ' 545,376 572,376', { stroke: 'violet', sw: 0.6 + W8[j] * 6, parent: S.kv }));
          }
          S.qLines.concat(S.oLines).forEach(function (l) { l.setAttribute('opacity', 0); });
          ctx.text(390, 500, 'this stack exists per layer × per KV head: 80 × 8 = 640 of them', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.kv });
          ctx.reveal(S.kv, { delay: 200 });

          S.kvCard = card(ctx, null, 780, 170, 760, 256,'amber', 'KV CACHE BYTES PER TOKEN');
          ctx.text(1160, 222, 'bytes/token = 2 · L · n_kv · d_head · b', { size: 20, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: S.kvCard });
          S.kvCode = ctx.code({ x: 800, y: 246, w: 720, title: 'Llama-3-70B-class  ·  GQA  ·  BF16', lang: 'text', typing: true, size: 14, maxLines: 4, color: 'amber', parent: S.kvCard, lines: [
            '2 (K,V) · 80 layers · 8 kv-heads · 128 · 2 B',
            '= 327,680 B = 320 KiB per token',
            '× 131,072 tokens (128k context) = 40 GiB',
            'MHA (64 kv-heads): 2.5 MiB/token → 320 GiB'
          ] });
          ctx.reveal(S.kvCard, { from: 'right', delay: 300 });

          S.mem = ctx.group();
          ctx.text(780, 460, 'ONE 128k SEQUENCE vs ONE H100 (80 GB HBM3)', { size: 13, font: 'mono', weight: 700, color: 'violet', parent: S.mem, spacing: 1 });
          ctx.rect(780, 478, 760, 34, { rx: 5, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('violet', 0.4), sw: 1, parent: S.mem });
          S.memBar = ctx.rect(780, 478, 0, 34, { rx: 5, fill: ctx.alpha('violet', 0.5), stroke: 'violet', sw: 1, parent: S.mem });
          S.memTxt = ctx.text(790, 532, '', { size: 13, font: 'mono', color: 'white', parent: S.mem });
          ctx.text(1540, 532, '80 GB', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.mem });
          S.mha = ctx.text(1540, 554,'MHA would need 344 GB ≈ 4.3 H100s for the cache alone', { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: S.mem });
          S.mha.setAttribute('opacity', 0);
          ctx.reveal(S.mem, { delay: 500 });

          S.decCard = textCard(ctx, 60, 540, 680, 320, 'violet', 'WHY DECODE IS MEMORY-BOUND', [
            'prefill: all n tokens at once → writes K,V',
            'decode: 1 query row × n cached keys (GEMV)',
            'every token re-reads the whole cache:',
            '  128k ctx → 42.9 GB / 3.35 TB/s ≈ 12.8 ms',
            '~8 FLOP/byte (GQA-8) vs H100 ridge ≈ 295',
            'batching users amortises weights, not KV'
          ], { lh: 38 });
          ctx.reveal(S.decCard, { from: 'up', delay: 700 });
          S.serve = textCard(ctx, 780, 586, 760, 274, 'teal', 'SERVING TRICKS', [
            'PagedAttention: 16-token blocks + block table',
            'prefix cache: shared agent system prompt reused',
            'FP8 / INT4 KV: halve or quarter the bytes',
            'offload cold blocks to CPU DRAM / NVMe',
            'speculative decoding: k tokens per cache sweep'
          ], { lh: 38 });
          ctx.reveal(S.serve, { from: 'up', delay: 900 });
          ctx.hud('KV cache · 320 KiB/token · 40 GiB at 128k (70B GQA-8)');

          function memAt(t) {
            var tok = 131072 * t, gb = tok * 327680 / 1e9;
            S.memBar.setAttribute('width', 760 * Math.min(1, gb / 80));
            S.memTxt.textContent = Math.round(tok / 1024) + 'k tokens · ' + (tok * 327680 / 1073741824).toFixed(1) + ' GiB';
          }
          function endState() {
            S.kvChips[6].setAttribute('opacity', 1);
            S.kRows[6].setAttribute('opacity', 1); S.vRows[6].setAttribute('opacity', 1);
            S.qLines.concat(S.oLines).forEach(function (l) { l.setAttribute('opacity', 0.85); });
            S.wBars.forEach(function (b, j) { b.setAttribute('width', W8[j] * 150); });
            var orr = ctx.rng(8);
            S.ov.cells[0].forEach(function (c) { c.setAttribute('fill', ctx.cmap('diverge', orr() * 1.6 - 0.8)); });
            memAt(1);
            S.mha.setAttribute('opacity', 1);
          }
          if (ctx.instant) { endState(); return S.kvCode.typeAll(); }
          memAt(0);
          return ctx.wait(900).then(function () {
            return ctx.reveal(S.kvChips[6], { from: 'up', dur: 400 });
          }).then(function () {
            /* new k,v rows fly from the chip into the cache */
            var gk = ctx.group(), gv = ctx.group();
            [gk, gv].forEach(function (g, gi) {
              for (var c = 0; c < 4; c++) ctx.rect(c * 23, 0, 20, 20, { rx: 3, fill: gi ? ctx.alpha('violet', 0.8) : ctx.alpha('cyan', 0.8), parent: g });
              ctx.place(g, 670 - 46, 226);
            });
            return Promise.all([
              ctx.transform(gk, { x: 110, y: 282 + 6 * 28 }, 900, 'inOut'),
              ctx.transform(gv, { x: 400, y: 282 + 6 * 28 }, 900, 'inOut', 150)
            ]).then(function () {
              ctx.remove([gk, gv], 200);
              S.kRows[6].setAttribute('opacity', 1); S.vRows[6].setAttribute('opacity', 1);
              ctx.pulse(S.kRows[6], { color: 'cyan', dur: 500 });
              return ctx.pulse(S.vRows[6], { color: 'violet', dur: 500 });
            });
          }).then(function () {
            S.qLines.forEach(function (l) { l.setAttribute('opacity', 0.85); });
            return ctx.reveal(S.qLines, { from: 'draw', dur: 500, stagger: 70 });
          }).then(function () {
            return ctx.tween(600, function (t) { S.wBars.forEach(function (b, j) { b.setAttribute('width', W8[j] * 150 * t); }); }, 'out');
          }).then(function () {
            S.oLines.forEach(function (l) { l.setAttribute('opacity', 0.85); });
            return ctx.reveal(S.oLines, { from: 'draw', dur: 500, stagger: 50 });
          }).then(function () {
            endState();
            memAt(0);
            ctx.pulse(S.ov, { color: 'violet', dur: 500 });
            return S.kvCode.typeAll();
          }).then(function () {
            return ctx.tween(1800, memAt, 'inOut');
          }).then(function () {
            return ctx.reveal(S.mha, {});
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Shrinking the cache',
        say: 'The fix is to share or compress keys and values. Multi query attention keeps a single key value head for all queries. Grouped query attention, used by Llama, keeps a few groups, cutting the cache eight fold with little quality loss. DeepSeek\'s multi head latent attention goes further: it caches one small latent vector per token and reconstructs every head\'s keys and values from it, folding the up projections into the query and output weights. Next, zoom into FlashAttention to see how the kernel computes all of this without ever storing the score matrix.',
        deep: '<table><tr><th>Scheme</th><th>Elements / token / layer</th><th>70B-class, 80 L, BF16</th></tr>' +
          '<tr><td>MHA (64 KV heads)</td><td>2·64·128 = 16,384</td><td>2,560 KiB</td></tr>' +
          '<tr><td>GQA-8</td><td>2·8·128 = 2,048</td><td>320 KiB</td></tr>' +
          '<tr><td>MQA</td><td>2·1·128 = 256</td><td>40 KiB</td></tr></table>' +
          '<p><b>MLA</b> (DeepSeek-V2/V3): cache c<sup>KV</sup><sub>t</sub> = W<sup>DKV</sup>h<sub>t</sub> ∈ ℝ<sup>512</sup> plus one shared 64-dim RoPE key. Per head k = W<sup>UK</sup>c, v = W<sup>UV</sup>c; at inference W<sup>UK</sup> is absorbed into the query (qᵀW<sup>UK</sup>c) and W<sup>UV</sup> into W<sub>O</sub>, so attention runs directly on the 576-dim latent, MQA-style.</p>' +
          '<div class="eq">DeepSeek-V3: (512 + 64) · 61 layers · 2 B = 70,272 B ≈ 68.6 KiB/token</div>' +
          '<p>versus 3.8 MiB/token for MHA with its 128 heads of 128: about <b>57× smaller</b>, with quality matching or beating MHA in their ablations. GQA can be <i>up-trained</i> from an MHA checkpoint by mean-pooling K/V heads (~5% of pre-training compute).</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove([S.kv, S.kvCard, S.mem, S.decCard, S.serve, S.hdr], 450);
          ctx.hud('MLA: 68.6 KiB/token (DeepSeek-V3) vs 320 KiB GQA-8');
          S.pan = ctx.group();
          var schemes = [
            ['MHA', 8, 'every query head has its own K,V', '2 · h · d_h per layer'],
            ['GQA', 2, 'groups share one K,V head', 'drawn 4:1 · Llama 3 70B 8:1'],
            ['MQA', 1, 'one K,V head for all queries', 'PaLM, Falcon: 1 kv head'],
            ['MLA', 0, 'cache a latent, expand per head', 'DeepSeek-V3: 512 + 64 dims']
          ];
          S.headLines = [];
          schemes.forEach(function (s, p) {
            var x = 60 + p * 372, g = card(ctx, S.pan, x, 186, 350, 290, p === 3 ? 'lime' : 'amber', s[0]);
            var qx = function (i) { return x + 42 + i * 38; };
            ctx.text(x + 334, 208, 'queries', { size: 11, font: 'mono', color: 'amber', anchor: 'end', parent: g });
            for (var i = 0; i < 8; i++) ctx.circle(qx(i), 250, 9, { fill: ctx.alpha('amber', 0.5), stroke: 'amber', sw: 1.2, parent: g });
            if (s[1] > 0) {
              var nk = s[1];
              for (var k = 0; k < nk; k++) {
                var kxx = nk === 8 ? qx(k) : (nk === 2 ? qx(1.5 + k * 4) : qx(3.5));
                ctx.rect(kxx - 10, 352, 20, 20, { rx: 3, fill: ctx.alpha('cyan', 0.5), stroke: 'cyan', sw: 1.2, parent: g });
              }
              for (var q = 0; q < 8; q++) {
                var grp = Math.floor(q * nk / 8);
                var kx = nk === 8 ? qx(q) : (nk === 2 ? qx(1.5 + grp * 4) : qx(3.5));
                var ln = ctx.line(qx(q), 260, kx, 350, { color: ctx.alpha('cyan', 0.6), sw: 1.2, parent: g });
                S.headLines.push(ln);
              }
              ctx.text(x + 334, 386, nk + ' K,V head' + (nk > 1 ? 's' : ''), { size: 11, font: 'mono', color: 'cyan', anchor: 'end', parent: g });
            } else {
              ctx.rect(x + 95, 350, 160, 22, { rx: 4, fill: ctx.alpha('lime', 0.45), stroke: 'lime', sw: 1.4, parent: g, glow: true });
              ctx.text(x + 175, 362, 'c_KV · 576', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: g });
              for (var q2 = 0; q2 < 8; q2++) {
                var ln2 = ctx.line(qx(q2), 260, x + 110 + q2 * 18.5, 348, { color: ctx.alpha('lime', 0.6), sw: 1.2, dash: '3 3', parent: g });
                S.headLines.push(ln2);
              }
              ctx.text(x + 334, 386, 'latent (W_UK, W_UV absorbed)', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: g });
            }
            ctx.text(x + 175, 426, s[2], { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g });
            ctx.text(x + 175, 450, s[3], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          });
          ctx.reveal(S.pan, { from: 'up' });

          /* log-scale bars */
          S.bars = card(ctx, null, 60, 500, 1030, 360, 'violet', 'KV CACHE PER TOKEN   (log scale, BF16)');
          var rows = [
            ['MHA · 70B-class (64 kv)', 2560, 'amber'],
            ['GQA-8 · Llama 3 70B', 320, 'amber'],
            ['MQA · 1 kv head', 40, 'amber'],
            ['MHA · DeepSeek-V3 dims', 3904, 'lime'],
            ['MLA · DeepSeek-V3', 68.6, 'lime']
          ];
          var BX = 400, BW = 560;
          function lx(v) { return BX + (Math.log10(v) - 1) / 3 * BW; }
          [10, 100, 1000, 10000].forEach(function (v) {
            ctx.line(lx(v), 540, lx(v), 836, { color: ctx.alpha('white', 0.08), sw: 1, parent: S.bars });
            ctx.text(lx(v), 848, v >= 1000 ? (v / 1000) + 'k KiB' : v + ' KiB',{ size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.bars });
          });
          S.barEls = rows.map(function (r, i) {
            var y = 560 + i * 54;
            ctx.text(BX - 14, y + 13, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: S.bars });
            var b = ctx.rect(BX, y, 0, 26, { rx: 4, fill: ctx.alpha(r[2], 0.45), stroke: r[2], sw: 1, parent: S.bars });
            var t = ctx.text(BX + 8, y + 13, '', { size: 12, font: 'mono', color: 'white', parent: S.bars });
            return { b: b, t: t, w: lx(r[1]) - BX, v: r[1] };
          });
          ctx.reveal(S.bars, { from: 'up', delay: 400 });

          S.sum = card(ctx, null, 1120, 500, 420, 360, 'amber', 'TAKEAWAYS');
          ctx.para(1138, 552, [
            'attention = content-addressed read',
            'cost 4·n²·d; the n×n matrix is the',
            '  memory wall, not the FLOPs',
            'cache = 2·L·n_kv·d_head·b / token',
            'GQA 8×, MLA ~57× smaller cache',
            'windows / linear layers bound it'
          ], { size: 13, font: 'mono', color: 'text', lh: 27, parent: S.sum });
          keepWS(S.sum);
          S.flash2 = ctx.node({ x: 1330, y: 808, w: 380, h: 62, title: 'FlashAttention', sub: 'zoom into the kernel', icon: 'bolt', color: 'amber', titleSize: 16, subSize: 11, parent: S.sum });
          ctx.reveal(S.sum, { from: 'right', delay: 600 });
          ctx.hotspot(S.flash2, 'flash-attention');

          function grow(t) {
            S.barEls.forEach(function (e) {
              e.b.setAttribute('width', e.w * t);
              e.t.setAttribute('x', BX + e.w * t + 8);
              var v = Math.pow(10, 1 + (Math.log10(e.v) - 1) * t);
              e.t.textContent = t < 1 ? (v >= 1024 ? (v / 1024).toFixed(1) + ' MiB' : v.toFixed(v < 100 ? 1 : 0) + ' KiB') : (e.v >= 1024 ? (e.v / 1024).toFixed(1) + ' MiB' : e.v + ' KiB');
            });
          }
          grow(0);
          return ctx.wait(700).then(function () {
            return ctx.tween(1600, grow, 'out');
          }).then(function () {
            ctx.pulse(S.barEls[4].b, { color: 'lime', dur: 700 });
            return ctx.wait(700);
          }).then(function () {
            return ctx.pulse(S.flash2, { color: 'amber', dur: 800 });
          });
        }
      }
    ]
  });
})();
