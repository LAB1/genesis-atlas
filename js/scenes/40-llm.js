/* L1 — Inside the LLM. End-to-end forward pass: text -> tokens -> embeddings -> residual stream through
 * N blocks -> final norm -> unembedding -> logits -> sampling -> append (autoregressive loop);
 * prefill vs decode, KV cache, roofline, dense vs MoE scale, and where the weights come from. */
(function () {
  var ROWY = 200;            /* context strip centre line */
  var PY = 420;              /* pipeline centre line */
  var DIST_A = { labels: [' moon', ' planet', ' world', ' surface', ' giant', ' field'], logits: [5.1, 3.6, 2.9, 2.3, 1.9, 1.5] };
  var DIST_B = { labels: [',', '.', ' where', ' and', ' as', ' of'], logits: [4.0, 3.5, 2.4, 2.0, 1.6, 1.2] };
  var CONTEXT = ['Director', ':', ' Write', ' shot', ' 3', ':', ' the', ' fox', ' astronaut', ' crash', '-', 'lands', ' on', ' a', ' glowing', ' ice'];
  var SEGC = ['amber', 'orange', 'violet', 'teal', 'blue', 'pink'];

  function softmax(z, T) {
    var m = Math.max.apply(null, z), e = z.map(function (v) { return Math.exp((v - m) / T); });
    var s = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (v) { return v / s; });
  }

  function keepWS(root) {
    Array.prototype.forEach.call(root.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
  }

  function boxOf(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }

  /* token chip drawn at local origin (left edge, vertical centre); leading space shown as a dim dot */
  function chip(ctx, parent, tok, color) {
    var size = 12, lead = tok.charAt(0) === ' ', shown = lead ? tok.slice(1) : tok;
    var w = Math.max(22, (shown.length + (lead ? 1 : 0)) * size * 0.62 + 14);
    var g = ctx.group({ parent: parent });
    ctx.rect(0, -12, w, 24, { rx: 5, fill: ctx.alpha(color, 0.13), stroke: ctx.alpha(color, 0.7), sw: 1, parent: g });
    var t = ctx.text(w / 2, 0.5, '', { size: size, font: 'mono', anchor: 'middle', color: 'white', parent: g });
    if (lead) { var d = ctx.el('tspan', { fill: ctx.C.dim }, t); d.textContent = '·'; }
    var m = ctx.el('tspan', {}, t); m.textContent = shown;
    g.w = w;
    return g;
  }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    if (title) ctx.text(x + 16, y + 20, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = boxOf(x, y, w, h);
    return g;
  }

  /* horizontal next-token distribution: labels right-aligned at x, bars to the right */
  function distPanel(ctx, parent, x, y) {
    var g = ctx.group({ parent: parent });
    g.rows = [];
    for (var i = 0; i < 6; i++) {
      var yy = y + i * 26, r = {};
      r.lab = ctx.text(x, yy, '', { size: 12, font: 'mono', anchor: 'end', color: 'text', parent: g });
      ctx.rect(x + 8, yy - 8, 120, 16, { rx: 3, fill: 'rgba(255,255,255,0.04)', parent: g });
      r.bar = ctx.rect(x + 8, yy - 8, 0, 16, { rx: 3, fill: ctx.alpha('amber', 0.5), stroke: 'amber', sw: 1, parent: g });
      r.p = ctx.text(x + 134, yy, '', { size: 11, font: 'mono', color: 'dim', parent: g });
      g.rows.push(r);
    }
    g.cur = [0, 0, 0, 0, 0, 0];
    g.set = function (labels, probs, ms) {
      labels.forEach(function (l, i) { g.rows[i].lab.textContent = l.charAt(0) === ' ' ? '·' + l.slice(1) : l; });
      var from = g.cur.slice();
      g.cur = probs.slice();
      return ctx.tween(ms === undefined ? 500 : ms, function (t) {
        g.rows.forEach(function (r, i) {
          var v = from[i] + (probs[i] - from[i]) * t;
          r.bar.setAttribute('width', Math.max(0, 120 * v));
          r.p.textContent = v.toFixed(2);
        });
      }, 'out');
    };
    return g;
  }

  /* sample a token: chip flies along the loop path and lands at the end of the context strip */
  function appendToken(ctx, S, tok) {
    var c = chip(ctx, S.seqG, tok, 'amber');
    var tx = S.seqX, ty = ROWY;
    S.seqX += c.w + 5;
    if (ctx.instant) { ctx.place(c, tx, ty); return Promise.resolve(); }
    var L = S.loop.getTotalLength(), w = c.w;
    var p0 = S.loop.getPointAtLength(0);
    ctx.place(c, p0.x - w / 2, p0.y);
    return ctx.tween(900, function (t) {
      var p = S.loop.getPointAtLength(L * t);
      ctx.place(c, p.x - w / 2, p.y);
    }, 'inOut').then(function () {
      return ctx.transform(c, { x: tx, y: ty }, 450, 'out');
    });
  }

  function vecGlyph(ctx, parent, seed) {
    var g = ctx.group({ parent: parent });
    var r = ctx.rng(seed);
    g.m = ctx.matrix(-5, -40, 9, 1, { cell: 8, gap: 1, cmap: 'diverge', values: function () { return r() * 2 - 1; }, parent: g });
    ctx.rect(-8, -43, 16, 86, { rx: 4, stroke: 'white', sw: 1.2, parent: g, glow: true });
    return g;
  }

  function swapRowC(ctx, S, g) {
    var old = S.rowC;
    S.rowC = g;
    if (old) ctx.fadeOut(old, 400, true);
  }

  Atlas.register({
    id: 'llm',
    refs: [
      'Vaswani et al., <i>Attention Is All You Need</i>, NeurIPS 2017',
      'Kaplan et al., <i>Scaling Laws for Neural Language Models</i>, 2020; Hoffmann et al., <i>Training Compute-Optimal LLMs</i> (Chinchilla), NeurIPS 2022',
      'Llama Team, Meta AI, <i>The Llama 3 Herd of Models</i>, 2024',
      'DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i>, 2024; Kimi Team, <i>Kimi K2: Open Agentic Intelligence</i>, 2025',
      'Ainslie et al., <i>GQA: Training Generalized Multi-Query Transformer Models</i>, EMNLP 2023',
      'Kwon et al., <i>Efficient Memory Management for LLM Serving with PagedAttention</i>, SOSP 2023',
      'Pope et al., <i>Efficiently Scaling Transformer Inference</i>, MLSys 2023; Williams et al., <i>Roofline</i>, CACM 2009',
      'nostalgebraist, <i>interpreting GPT: the logit lens</i>, 2020; Elhage et al., <i>A Mathematical Framework for Transformer Circuits</i>, 2021'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Next-token machine',
        say: 'Every agent in our film crew is powered by the same machine: a large language model. Strip away the chat interface and it does exactly one thing. Given a sequence of tokens, it outputs a probability distribution over the next token. The director agent has written "the fox astronaut crash-lands on a glowing ice". The model scores every word in its vocabulary, samples "moon", appends it, and runs again. Everything an agent does, from plans to tool calls, is this loop.',
        deep: '<p>An autoregressive LM factorises the probability of a sequence left to right:</p>' +
          '<div class="eq">p<sub>θ</sub>(x<sub>1:T</sub>) = ∏<sub>t</sub> p<sub>θ</sub>(x<sub>t</sub> | x<sub>&lt;t</sub>)</div>' +
          '<p>One <b>forward pass</b> of a decoder-only transformer maps the prefix to a vector of <code>V</code> logits (V = 128,256 for Llama&nbsp;3). A sampler draws one token, it is appended, and the pass repeats. For a dense model with N parameters, each generated token costs roughly</p>' +
          '<div class="eq">FLOPs/token ≈ 2N + 4·L·T·d<sub>attn</sub></div>' +
          '<p>i.e. ≈ 141 GFLOP for a 70B model plus an attention term (QKᵀ and AV against T cached positions, d<sub>attn</sub> = 64·128 = 8,192) that grows with context: +31 GFLOP at T = 12k.</p>' +
          '<div class="note">Plans, JSON tool calls, critiques and the final shot list are all produced by this one loop. "Agent" behaviour is a property of the <i>harness</i> around it (see the Agent Loop chamber), not a different kind of model.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.seqLabel = ctx.text(60, 166, 'CONTEXT  ·  director agent  ·  16 tokens so far', { size: 12, font: 'mono', color: 'dim', spacing: 1 });
          S.seqG = ctx.group();
          S.seqX = 60;
          var chips = CONTEXT.map(function (tok) {
            var c = chip(ctx, S.seqG, tok, 'cyan');
            ctx.place(c, S.seqX, ROWY);
            S.seqX += c.w + 5;
            return c;
          });
          ctx.reveal(S.seqLabel, {});
          ctx.reveal(chips, { from: 'up', stagger: 40, dur: 350 });

          /* the black box */
          S.inArrow = ctx.line(125, 216, 125, 290, { color: ctx.alpha('cyan', 0.7), sw: 1.6, arrow: true });
          S.core = ctx.node({ x: 560, y: PY, w: 1020, h: 260, title: 'LLM   pθ( x_t | x_<t )', sub: '70B params · 1 forward pass / token', icon: 'brain', color: 'amber', titleSize: 26, subSize: 14 });
          /* the parameters: a shimmering weight field inside the box */
          var wr = ctx.rng(3);
          S.wField = ctx.matrix(545, 328, 10, 30, { cell: 13, gap: 3, cmap: 'amber', parent: S.core, values: function () { return 0.1 + wr() * 0.35; } });
          ctx.text(545 + 238, 512, 'θ: 80 layers × ~856 M weights, all touched for every token', { size: 12, font: 'mono', color: ctx.alpha('amber', 0.8), anchor: 'middle', parent: S.core });
          var wr2 = ctx.rng(9);
          S.wLoop = ctx.loop(function () {
            for (var q = 0; q < 12; q++) {
              var rr = Math.floor(wr2() * 10), cc = Math.floor(wr2() * 30);
              S.wField.cells[rr][cc].setAttribute('fill', ctx.cmap('amber', 0.08 + wr2() * 0.5));
            }
          });
          ctx.reveal(S.inArrow, { from: 'draw', delay: 500 });
          ctx.reveal(S.core, { from: 'scale', s0: 0.92, delay: 400 });

          /* output distribution + sampler + loop */
          S.outArrow = ctx.line(1058, PY, 1092, PY, { color: 'amber', sw: 1.6, arrow: true });
          S.distHead = ctx.text(1100, 302, 'next-token distribution', { size: 12, font: 'mono', color: 'amber' });
          S.dist = distPanel(ctx, null, 1170, 330);
          S.sampler = ctx.node({ x: 1455, y: PY, w: 140, h: 62, title: 'Sample', sub: 'x_t ~ p', icon: 'spark', color: 'amber', titleSize: 15, subSize: 11 });
          S.sArrow = ctx.line(1340, PY, 1381, PY, { color: 'amber', sw: 1.6, arrow: true });
          S.loop = ctx.path('M1455,388 V252 Q1455,240 1443,240 H1080', { stroke: ctx.alpha('amber', 0.8), sw: 1.6, dash: '5 5', arrow: true });
          S.loopLbl = ctx.text(1300, 226, 'append x_t, repeat', { size: 12, font: 'mono', color: 'amber', anchor: 'middle' });
          ctx.reveal([S.outArrow, S.distHead, S.dist, S.sArrow, S.sampler], { from: 'right', delay: 900, stagger: 120 });
          ctx.reveal(S.loop, { from: 'draw', delay: 1500, dur: 700 });
          ctx.reveal(S.loopLbl, { delay: 1800 });

          /* row C: the loop in code + per-token cost */
          var g = ctx.group();
          var code = ctx.code({ x: 60, y: 612, w: 560, title: 'autoregressive decoding', lang: 'py', size: 13, parent: g, lines: [
            'tokens = tokenize(context)          # T = 16 ids',
            'while True:',
            '    logits = f_theta(tokens)[-1]    # [V] = 128,256',
            '    x = sample(softmax(logits / temp))',
            '    if x == EOS: break',
            '    tokens.append(x)                # feed back in'
          ] });
          keepWS(code);
          var c2 = card(ctx, g, 660, 612, 400, 168, 'amber', 'COST OF ONE TOKEN (70B dense)');
          ctx.para(680, 660, ['compute   2N ≈ 141 GFLOP', 'weights   141 GB read (BF16)', 'KV cache  +320 KiB per token', 'context   attends to all T previous'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: c2 });
          S.rowC = g;
          ctx.reveal(g, { from: 'up', delay: 1200 });

          return ctx.wait(1600).then(function () {
            var pA = softmax(DIST_A.logits, 1);
            return S.dist.set(DIST_A.labels, pA, 700);
          }).then(function () {
            ctx.pulse(S.dist.rows[0].bar, { color: 'amber', dur: 600 });
            return ctx.pulse(S.sampler, { color: 'amber', dur: 600 });
          }).then(function () {
            return appendToken(ctx, S, ' moon');
          }).then(function () {
            ctx.pulse(S.core, { color: 'amber', dur: 500 });
            return S.dist.set(DIST_B.labels, softmax(DIST_B.logits, 1), 500);
          }).then(function () {
            return appendToken(ctx, S, ',');
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Tokens to vectors',
        say: 'Open the box. First the tokenizer turns text into integer ids using byte level byte pair encoding: common words become one token, rare words split into pieces. Then each id selects one row of the embedding matrix, a table with one vector of eight thousand one hundred ninety two numbers per vocabulary entry. Mathematically it is a one hot vector times a matrix, but in practice it is just a memory gather. The result is a matrix: one vector per position.',
        deep: '<div class="eq">X = onehot(ids) · E = E[ids] ∈ ℝ<sup>T×d</sup></div>' +
          '<ul><li><b>Tokenizer</b>: byte-level BPE, vocab 32k–256k. English prose averages ≈ 1.3 tokens per word with a 128k vocab; code and non-Latin scripts cost more.</li>' +
          '<li><b>Embedding</b> E ∈ ℝ<sup>V×d</sup>: 128,256 × 8,192 = <b>1.05 B</b> parameters = 2.1 GB in BF16. It is a gather, not a matmul: O(T·d) bytes moved, zero FLOPs.</li>' +
          '<li><b>Backward</b>: gradient is sparse — only the rows of tokens present in the batch are updated.</li>' +
          '<li>Output side: W<sub>U</sub> ∈ ℝ<sup>d×V</sup> maps back to vocabulary; <i>tied</i> (W<sub>U</sub> = Eᵀ) in many small models, untied in Llama&nbsp;3 70B.</li></ul>' +
          '<p class="muted">Token ids shown here are illustrative.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.core, 500, true).then(function () { S.wLoop.stop(); });
          S.frame = ctx.rect(50, 288, 1020, 266, { rx: 14, stroke: ctx.alpha('amber', 0.45), sw: 1.2, dash: '6 6', fill: 'rgba(255,191,58,0.02)' });
          S.frameLbl = ctx.text(146, 306, 'fθ  ·  decoder-only transformer', { size: 12, font: 'mono', color: ctx.alpha('amber', 0.8) });
          ctx.reveal([S.frame, S.frameLbl], { delay: 300 });
          S.inArrow2 = ctx.line(125, 292, 125, 385, { color: ctx.alpha('cyan', 0.7), sw: 1.6, arrow: true });
          S.tok = ctx.node({ x: 125, y: PY, w: 130, h: 62, title: 'Tokenizer', sub: 'byte BPE', color: 'amber', titleSize: 15, subSize: 11 });
          S.emb = ctx.node({ x: 290, y: PY, w: 130, h: 62, title: 'Embed', sub: 'gather E[id]', color: 'amber', titleSize: 15, subSize: 11 });
          S.l_te = ctx.link(S.tok, S.emb, { color: 'amber' });
          ctx.reveal(S.inArrow2, { from: 'draw', delay: 400 });
          ctx.reveal([S.tok, S.emb], { from: 'left', delay: 500, stagger: 200 });
          ctx.reveal(S.l_te, { from: 'draw', delay: 800 });
          S.tokGhost = ctx.node({ x: 207, y: PY, w: 310, h: 112, kind: 'ghost', color: 'amber' });
          ctx.reveal(S.tokGhost, { delay: 900 });
          ctx.hotspot(S.tokGhost, 'tokenization');

          /* row C: embedding gather */
          var g = ctx.group();
          ctx.text(80, 628, 'EMBEDDING LOOKUP   onehot(id) · E  =  E[id]', { size: 13, font: 'mono', weight: 700, color: 'amber', parent: g, spacing: 1 });
          var toks = [[' fox', 39935, 2], [' astronaut', 47733, 7], [' glowing', 49592, 4], [' ice', 10054, 10]];
          var r = ctx.rng(11);
          var E = ctx.matrix(320, 650, 12, 14, { cell: 12, gap: 2, cmap: 'diverge', parent: g, values: function () { return (r() * 2 - 1) * 0.8; } });
          ctx.text(417, 836, 'E   128,256 × 8,192', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g });
          ctx.text(417, 856, '1.05 B params · 2.1 GB BF16', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          var X = ctx.matrix(640, 700, 4, 14, { cell: 12, gap: 2, cmap: 'gray', values: function () { return 0.08; }, parent: g });
          ctx.text(737, 772, 'X   T × 8,192  (BF16)', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g });
          ctx.text(737, 792, 'one row per position', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          var idEls = toks.map(function (t, i) {
            var y = 672 + i * 44;
            ctx.text(150, y, t[0].replace(' ', '·'), { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: g });
            ctx.label(210, y, String(t[1]), { color: 'cyan', size: 11, parent: g });
            var rc = E.cellCenter(t[2], 0);
            return ctx.path('M246,' + y + ' C280,' + y + ' 285,' + rc.y + ' 314,' + rc.y, { stroke: ctx.alpha('cyan', 0.5), sw: 1.2, parent: g, arrow: true });
          });
          var side = ctx.para(880, 690, ['no FLOPs: a memory gather', 'grad is row-sparse', 'tied: W_U = Eᵀ (small models)', 'untied in Llama 3 70B'], { size: 12, font: 'mono', color: 'dim', lh: 22, parent: g });
          swapRowC(ctx, S, g);
          ctx.reveal(g, { from: 'up', delay: 600 });

          var chain = ctx.wait(1300);
          toks.forEach(function (t, i) {
            chain = chain.then(function () {
              ctx.reveal(idEls[i], { from: 'draw', dur: 300 });
              var row = E.cells[t[2]];
              row.forEach(function (c) { c.setAttribute('stroke', ctx.C.amber); c.setAttribute('stroke-width', 1.2); });
              /* fly a copy of the row into X */
              var fly = ctx.group({ parent: g });
              var vals = row.map(function (c) { return c.getAttribute('fill'); });
              vals.forEach(function (f, c) { ctx.rect(320 + c * 14, 650 + t[2] * 14, 12, 12, { rx: 2, fill: f, parent: fly }); });
              var dy = (700 + i * 14) - (650 + t[2] * 14);
              return ctx.transform(fly, { x: 320, y: dy }, 450, 'inOut').then(function () {
                if (fly.parentNode) fly.parentNode.removeChild(fly);
                X.cells[i].forEach(function (c, k) { c.setAttribute('fill', vals[k]); });
              });
            });
          });
          return chain;
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'The residual stream',
        say: 'Now the deep part: eighty transformer blocks, identical in shape but each with its own weights. Think of each position as owning a vector that flows along a residual stream. Every block reads that vector, computes an update, and adds it back. Nothing is overwritten, only accumulated. If you decode the stream early with the output matrix, a trick called the logit lens, you can watch the prediction sharpen with depth: generic words early, planet in the middle, moon near the top.',
        deep: '<div class="eq">h<sup>(ℓ)</sup> = h<sup>(ℓ−1)</sup> + Attn<sub>ℓ</sub>(·) + MLP<sub>ℓ</sub>(·)</div>' +
          '<p>The residual stream is a d = 8,192-dimensional <b>communication bus</b>: blocks write into subspaces that later blocks read. Because every block is additive, the network behaves like an ensemble of many shallow paths, and gradients flow through the identity path unattenuated.</p>' +
          '<ul><li><b>Attention</b> moves information <i>between</i> positions.</li><li><b>MLP</b> transforms information <i>within</i> a position (key–value memories, feature detectors).</li></ul>' +
          '<p><b>Logit lens</b>: apply the final norm and W<sub>U</sub> to an intermediate h<sup>(ℓ)</sup>. Predictions typically become recognisable in the middle layers and sharpen late; the <i>tuned lens</i> (a learned affine probe per layer) is more faithful. The readouts shown are illustrative.</p>' +
          '<div class="note">All 80 blocks run for every token. For a 70B model that is ≈ 856 M parameters per block.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.stack = ctx.group();
          ctx.text(585, 318, '80 × transformer block   (each slab = 5 layers)', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: S.stack });
          S.slabs = [];
          for (var i = 0; i < 16; i++) {
            S.slabs.push(ctx.rect(398 + i * 23.5, 336, 15, 170, { rx: 3, fill: ctx.alpha('amber', 0.08 + i * 0.012), stroke: ctx.alpha('amber', 0.6), sw: 1, parent: S.stack }));
          }
          S.stream = ctx.line(355, PY, 790, PY, { color: ctx.alpha('white', 0.75), sw: 2, arrow: true, parent: S.stack });
          [3, 7, 11, 15].forEach(function (k, j) {
            ctx.text(398 + k * 23.5 + 7.5, 524, 'L' + (20 * (j + 1)), { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.stack });
          });
          S.stack.box = boxOf(380, 300, 410, 238);
          ctx.reveal(S.stack, { from: 'scale', s0: 0.95 });
          ctx.hotspot(S.stack, 'transformer');

          /* row C: logit lens + residual algebra */
          var g = ctx.group();
          ctx.text(80, 628, 'LOGIT LENS   softmax(W_U · norm(h⁽ˡ⁾))   illustrative', { size: 13, font: 'mono', weight: 700, color: 'teal', parent: g, spacing: 1 });
          var lens = [['L20', [[' the', 0.08], [' a', 0.06], [' cold', 0.05]]], ['L40', [[' planet', 0.21], [' moon', 0.14], [' world', 0.11]]],
            ['L60', [[' moon', 0.48], [' planet', 0.19], [' world', 0.07]]], ['L80', [[' moon', 0.68], [' planet', 0.15], [' world', 0.08]]]];
          S.lensRows = lens.map(function (row, i) {
            var y = 668 + i * 44, rg = ctx.group({ parent: g });
            ctx.text(80, y, row[0], { size: 13, font: 'mono', weight: 700, color: 'teal', parent: rg });
            row[1].forEach(function (c, j) {
              var x = 130 + j * 170;
              ctx.text(x, y, c[0].replace(' ', '·'), { size: 12, font: 'mono', color: j === 0 ? 'white' : 'dim', parent: rg });
              ctx.rect(x + 66, y - 7, 56 * c[1] / 0.7, 14, { rx: 3, fill: ctx.alpha(c[0] === ' moon' ? 'amber' : 'teal', 0.55), parent: rg });
              ctx.text(x + 70 + 56 * c[1] / 0.7, y, c[1].toFixed(2), { size: 11, font: 'mono', color: 'dim', parent: rg });
            });
            return rg;
          });
          var c2 = card(ctx, g, 660, 612, 400, 230, 'white', 'THE STREAM IS A BUS');
          ctx.para(680, 660, ['h ← h + Attn(norm(h))   mix positions', 'h ← h + MLP(norm(h))    per position', '', 'blocks only ADD to the stream', '‖Δ‖ small vs ‖h‖: near-identity', 'identity path carries gradients', 'd = 8,192 dims, T positions'], { size: 12, font: 'mono', color: 'text', lh: 22, parent: c2 });
          keepWS(c2);
          swapRowC(ctx, S, g);
          ctx.reveal(g, { from: 'up', delay: 300 });
          S.lensRows.forEach(function (rg) { rg.setAttribute('opacity', 0.15); });

          /* a token vector travels through the stack, updated by every slab */
          S.vec = vecGlyph(ctx, null, 5);
          ctx.place(S.vec, 355, PY);
          ctx.reveal(S.vec, { delay: 400 });
          var r = ctx.rng(21);
          var lastSlab = -1;
          return ctx.wait(700).then(function () {
            return ctx.tween(3200, function (t) {
              var x = 355 + t * 430;
              ctx.place(S.vec, x, PY);
              var k = Math.floor((x - 398) / 23.5);
              if (k >= 0 && k < 16 && k !== lastSlab && x > 398 + k * 23.5 + 7) {
                lastSlab = k;
                S.slabs[k].setAttribute('fill', ctx.alpha('amber', 0.45));
                S.vec.m.set(function () { return r() * 2 - 1; });
                if ((k + 1) % 4 === 0) S.lensRows[(k + 1) / 4 - 1].setAttribute('opacity', 1);
              }
            }, 'linear');
          }).then(function () {
            S.slabs.forEach(function (s, i) { s.setAttribute('fill', ctx.alpha('amber', 0.08 + i * 0.012)); });
            S.lensRows.forEach(function (rg) { rg.setAttribute('opacity', 1); });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Inside one block',
        say: 'Zoom into a single block. It has two sublayers, each wrapped by a normalisation and a residual addition. Attention is the only place where positions talk to each other. For the current token, ice, each head computes how relevant every earlier token is and pulls in a weighted mix of their values. Different heads learn different jobs. Click the head chip to cycle through a semantic head, a previous token head, and an attention sink.',
        deep: '<div class="eq">h = x + Attn(RMSNorm(x)),&nbsp;&nbsp; y = h + MLP(RMSNorm(h))</div>' +
          '<div class="eq">Attn(Q,K,V) = softmax(QKᵀ/√d<sub>h</sub> + M<sub>causal</sub>) V</div>' +
          '<p>70B-class config: 64 query heads of d<sub>h</sub> = 128, but only <b>8 KV heads</b> (grouped-query attention): each K/V head is shared by 8 query heads, shrinking the KV cache 8× relative to MHA.</p>' +
          '<p>Heads specialise: <b>previous-token</b> heads, <b>induction</b> heads (copy what followed an earlier match), semantic/entity heads, and <b>attention sinks</b> that park probability mass on the first token when nothing is relevant (softmax must sum to 1).</p>' +
          '<p>The MLP is a SwiGLU with d<sub>ff</sub> = 28,672 (3.5 d) and holds ~82% of block parameters. Patterns shown are illustrative.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var hl = S.slabs[9];
          S.hl = ctx.rect(398 + 9 * 23.5 - 4, 332, 23, 178, { rx: 4, stroke: 'white', sw: 2, glow: true });
          var g = ctx.group();
          S.zoomL = ctx.path('M' + (398 + 9 * 23.5) + ',510 L60,604 M' + (398 + 9 * 23.5 + 15) + ',510 L1060,604', { stroke: ctx.alpha('white', 0.35), dash: '3 5', sw: 1, parent: g });
          ctx.rect(60, 604, 1000, 272, { rx: 12, fill: 'rgba(8,14,28,0.94)', stroke: ctx.alpha('white', 0.4), parent: g });
          ctx.text(80, 628, 'BLOCK ℓ = 46   pre-norm residual', { size: 13, font: 'mono', weight: 700, color: 'white', parent: g, spacing: 1 });
          /* mini block */
          var RY = 800;
          ctx.line(80, RY, 660, RY, { color: ctx.alpha('white', 0.8), sw: 2, arrow: true, parent: g });
          ctx.text(80, RY + 22, 'x (residual stream)', { size: 11, font: 'mono', color: 'dim', parent: g });
          var n1 = ctx.node({ x: 150, y: 700, w: 96, h: 40, title: 'RMSNorm', color: 'white', titleSize: 12, parent: g, glow: false });
          S.attn = ctx.node({ x: 275, y: 700, w: 130, h: 52, title: 'Attention', sub: 'GQA 64q / 8kv', color: 'amber', titleSize: 14, subSize: 11, parent: g });
          var n2 = ctx.node({ x: 435, y: 700, w: 96, h: 40, title: 'RMSNorm', color: 'white', titleSize: 12, parent: g, glow: false });
          S.mlp = ctx.node({ x: 560, y: 700, w: 130, h: 52, title: 'MLP', sub: 'SwiGLU 28,672', color: 'amber', titleSize: 14, subSize: 11, parent: g });
          ctx.path('M110,' + RY + ' V700 H' + n1.box.l, { stroke: ctx.alpha('white', 0.6), parent: g, arrow: true });
          ctx.link(n1, S.attn, { color: 'white', parent: g });
          ctx.path('M' + S.attn.box.r + ',700 H355 V' + (RY - 12), { stroke: 'amber', parent: g, arrow: true });
          ctx.circle(355, RY, 11, { fill: '#1a1206', stroke: 'amber', sw: 1.6, parent: g });
          ctx.text(355, RY + 1, '+', { size: 16, color: 'amber', anchor: 'middle', weight: 700, parent: g });
          ctx.path('M380,' + RY + ' V700 H' + n2.box.l, { stroke: ctx.alpha('white', 0.6), parent: g, arrow: true });
          ctx.link(n2, S.mlp, { color: 'white', parent: g });
          ctx.path('M' + S.mlp.box.r + ',700 H640 V' + (RY - 12), { stroke: 'amber', parent: g, arrow: true });
          ctx.circle(640, RY, 11, { fill: '#1a1206', stroke: 'amber', sw: 1.6, parent: g });
          ctx.text(640, RY + 1, '+', { size: 16, color: 'amber', anchor: 'middle', weight: 700, parent: g });

          /* attention pattern of the current token over earlier keys */
          var keys = ['<bos>', 'Director', ' the', ' fox', ' astronaut', ' crash', ' on', ' a', ' glowing', ' ice'];
          var heads = [
            { name: 'head 17 · semantic', w: [0.04, 0.02, 0.02, 0.2, 0.16, 0.12, 0.02, 0.02, 0.28, 0.12] },
            { name: 'head 3 · prev-token', w: [0.03, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.02, 0.9, 0.05] },
            { name: 'head 0 · attn sink', w: [0.82, 0.02, 0.01, 0.02, 0.02, 0.02, 0.02, 0.02, 0.03, 0.02] }
          ];
          var ag = ctx.group({ parent: g });
          ctx.text(700, 628, 'query ·ice attends to earlier keys (causal)', { size: 12, font: 'mono', color: 'amber', parent: ag });
          var qx = 975, qy = 752;
          S.attLines = keys.map(function (k, i) {
            var y = 658 + i * 22;
            ctx.text(800, y, k.replace(' ', '·'), { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: ag });
            return ctx.path('M808,' + y + ' C900,' + y + ' 900,' + qy + ' ' + (qx - 34) + ',' + qy, { stroke: 'amber', sw: 1, parent: ag });
          });
          ctx.label(qx, qy, '·ice', { color: 'amber', size: 13, parent: ag });
          S.headChip = ctx.label(qx, 680, heads[0].name, { color: 'cyan', size: 11, w: 150, parent: ag });
          ctx.text(qx, 704, 'click to cycle heads', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: ag });
          S.headChip.style.cursor = 'pointer';
          S.head = 0;
          S.setHead = function (h, ms) {
            S.head = h;
            S.headChip.lastChild.textContent = heads[h].name;
            var from = S.attLines.map(function (l) { return parseFloat(l.getAttribute('data-w') || 0); });
            return ctx.tween(ms, function (t) {
              S.attLines.forEach(function (l, i) {
                var w = from[i] + (heads[h].w[i] - from[i]) * t;
                l.setAttribute('data-w', w);
                l.setAttribute('stroke-width', (0.6 + w * 9).toFixed(2));
                l.setAttribute('opacity', (0.12 + 0.88 * Math.min(1, w * 3)).toFixed(3));
              });
            }, 'out');
          };
          S.headChip.addEventListener('click', function (ev) { ev.stopPropagation(); S.setHead((S.head + 1) % 3, 500); });
          S.attLines.forEach(function (l) { l.setAttribute('opacity', 0.1); });
          S.blockPanel = g;
          swapRowC(ctx, S, g);
          ctx.reveal(g, { from: 'up', delay: 200 });
          ctx.hotspot(S.attn, 'attention');
          /* persistent attention handle inside fθ: stays reachable after the close-up is swapped out */
          S.attnChip = ctx.label(207, 522, 'attention · 64 heads × 80 layers', { color: 'amber', size: 11 });
          S.attnChip.box = boxOf(207 - S.attnChip.w / 2, 522 - S.attnChip.h / 2, S.attnChip.w, S.attnChip.h);
          ctx.reveal(S.attnChip, { delay: 600 });
          ctx.hotspot(S.attnChip, 'attention', { hint: 'ATTN ⤢' });
          ctx.focus([S.stack, S.hl, g, S.attnChip], 0.25);
          return ctx.wait(900).then(function () {
            return ctx.packet(S.attLines[8], { color: 'amber', dur: 600, reverse: true });
          }).then(function () {
            return S.setHead(0, 800);
          }).then(function () { return ctx.wait(700); }).then(function () {
            return S.setHead(1, 600);
          }).then(function () { return ctx.wait(700); }).then(function () {
            return S.setHead(0, 600);
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Logits & sampling',
        say: 'After the last block, the vector for the final position goes through one more RMSNorm and is multiplied by the unembedding matrix, giving one score, a logit, for each of about one hundred twenty eight thousand tokens. Softmax with a temperature turns scores into probabilities, and the sampler draws a uniform random number and walks the cumulative distribution. Click the temperature chips: lower temperature sharpens the distribution toward moon, higher temperature flattens it.',
        deep: '<div class="eq">z = W<sub>U</sub> · RMSNorm(h<sub>T</sub><sup>(L)</sup>) ∈ ℝ<sup>V</sup>, &nbsp; p<sub>i</sub> = e<sup>z<sub>i</sub>/τ</sup> / Σ<sub>j</sub> e<sup>z<sub>j</sub>/τ</sup></div>' +
          '<p>Only the <b>last position</b> needs logits at inference (training computes all T). The unembedding is a d × V GEMV per sequence: 8,192 × 128,256 ≈ 1.05 G MACs.</p>' +
          '<ul><li><b>τ → 0</b>: greedy argmax. <b>τ = 1</b>: the model distribution. <b>τ &gt; 1</b>: flatter, more diverse, more errors.</li>' +
          '<li><b>top-k / top-p (nucleus)</b>: truncate the tail to the smallest set with cumulative mass ≥ p; <b>min-p</b> scales the cut by the max probability.</li>' +
          '<li><b>Inverse-CDF sampling</b>: u ~ U(0,1), pick the first i with Σ<sub>j≤i</sub> p<sub>j</sub> &gt; u.</li>' +
          '<li>For tool calls, a grammar mask sets illegal-token logits to −∞ before softmax (constrained decoding).</li></ul>' +
          '<p>Probabilities shown are over the top-6 candidates, renormalised.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.focus(null);
          ctx.fadeOut(S.hl, 300, true);
          S.norm = ctx.node({ x: 860, y: PY, w: 100, h: 62, title: 'RMSNorm', sub: 'final', color: 'amber', titleSize: 14, subSize: 11 });
          S.unemb = ctx.node({ x: 995, y: PY, w: 118, h: 62, title: 'Unembed', sub: 'W_U d×V', color: 'amber', titleSize: 14, subSize: 11 });
          S.l_sn = ctx.line(792, PY, 808, PY, { color: 'amber', sw: 1.6, arrow: true });
          S.l_nu = ctx.link(S.norm, S.unemb, { color: 'amber' });
          ctx.reveal([S.norm, S.unemb], { from: 'left', stagger: 200 });
          ctx.reveal([S.l_sn, S.l_nu], { from: 'draw', delay: 300, stagger: 150 });
          ctx.hotspot(S.sampler, 'decoding');

          /* temperature chips under the bars */
          S.tChips = ctx.group();
          ctx.text(1100, 490, 'temperature  (click)', { size: 11, font: 'mono', color: 'dim', parent: S.tChips });
          S.T = 1.0;
          S.tEls = [0.3, 0.7, 1.0, 1.5].map(function (T, i) {
            var c = ctx.label(1128 + i * 64, 516, 'T ' + T.toFixed(1), { color: 'cyan', size: 11, w: 56, parent: S.tChips });
            c.style.cursor = 'pointer';
            c.addEventListener('click', function (ev) { ev.stopPropagation(); S.applyT(T, 500); });
            return c;
          });
          ctx.reveal(S.tChips, { delay: 500 });

          /* row C: equations + inverse-CDF strip */
          var g = ctx.group();
          var c1 = card(ctx, g, 60, 612, 560, 250, 'amber', 'LOGITS → PROBABILITIES');
          ctx.para(80, 660, ['z   = W_U · RMSNorm(h_T)      # [128,256]', 'p_i = exp(z_i/T) / Σ_j exp(z_j/T)', 'top-p: keep smallest set, Σp ≥ 0.9', 'min-p: drop p_i < 0.05 · max p', 'greedy: argmax z   (T → 0)', 'tool JSON: illegal tokens → -∞'], { size: 13, font: 'mono', color: 'text', lh: 30, parent: c1 });
          keepWS(c1);
          var c2 = card(ctx, g, 660, 612, 880, 250, 'cyan', 'INVERSE-CDF SAMPLING');
          S.strip = [];
          for (var i = 0; i < 6; i++) {
            var seg = ctx.rect(690, 680, 10, 34, { rx: 2, fill: ctx.alpha(SEGC[i], 0.45), stroke: SEGC[i], sw: 1, parent: c2 });
            var lab = ctx.text(690, 730, '', { size: 11, font: 'mono', color: SEGC[i], anchor: 'middle', parent: c2 });
            S.strip.push({ seg: seg, lab: lab });
          }
          ctx.text(690, 668, '0', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: c2 });
          ctx.text(1510, 668, '1', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: c2 });
          S.nuc = ctx.rect(0, 672, 2, 94, { rx: 1, fill: ctx.alpha('pink', 0.9), parent: c2 });
          S.nucTxt = ctx.text(0, 758, '', { size: 11, font: 'mono', color: 'pink', parent: c2 });
          S.uLine = ctx.rect(0, 664, 3, 66, { rx: 1, fill: 'white', parent: c2, glow: true });
          S.uTxt = ctx.text(700, 790, '', { size: 14, font: 'mono', color: 'white', parent: c2 });
          ctx.text(700, 820, 'u = 0.41 is the same draw at every T; T reshapes the segments', { size: 12, font: 'mono', color: 'dim', parent: c2 });
          S.uLine.setAttribute('opacity', 0);
          swapRowC(ctx, S, g);
          ctx.reveal(g, { from: 'up', delay: 300 });

          S.applyT = function (T, ms) {
            S.T = T;
            S.tEls.forEach(function (c) { var on = Math.abs(parseFloat(c.lastChild.textContent.slice(2)) - T) < 1e-6; c.firstChild.setAttribute('fill', ctx.alpha('cyan', on ? 0.45 : 0.14)); });
            var p = softmax(DIST_A.logits, T);
            var W = 820, x0 = 690;
            var from = S.strip.map(function (s) { return [parseFloat(s.seg.getAttribute('x')), parseFloat(s.seg.getAttribute('width'))]; });
            var cum = 0, tgt = p.map(function (pi) { var a = [x0 + cum * W, pi * W]; cum += pi; return a; });
            var u = 0.41, pick = 0, acc = 0;
            for (var k = 0; k < 6; k++) { acc += p[k]; if (u < acc) { pick = k; break; } }
            S.uLine.setAttribute('x', x0 + u * W - 1.5);
            var cn = 0, kn = 0;
            while (kn < 6 && cn < 0.9) { cn += p[kn]; kn++; }
            S.nuc.setAttribute('x', x0 + cn * W - 1);
            S.nucTxt.setAttribute('x', x0 + cn * W + 6);
            S.nucTxt.textContent = 'top-p 0.9 keeps ' + kn + ' of 6 (tail cut)';
            S.nucTxt.setAttribute('text-anchor', cn > 0.8 ? 'end' : 'start');
            if (cn > 0.8) S.nucTxt.setAttribute('x', x0 + cn * W - 6);
            S.uTxt.textContent = 'u ~ U(0,1) = 0.41  →  ' + DIST_A.labels[pick].replace(' ', '·') + '   (p = ' + p[pick].toFixed(2) + ', T = ' + T.toFixed(1) + ')';
            S.dist.set(DIST_A.labels, p, ms);
            return ctx.tween(ms, function (t) {
              S.strip.forEach(function (s, i) {
                var x = from[i][0] + (tgt[i][0] - from[i][0]) * t, w = from[i][1] + (tgt[i][1] - from[i][1]) * t;
                s.seg.setAttribute('x', x); s.seg.setAttribute('width', Math.max(0, w - 1));
                s.lab.setAttribute('x', x + w / 2);
                s.lab.textContent = w > 46 ? DIST_A.labels[i].replace(' ', '·') : '';
              });
            }, 'out');
          };

          /* vector goes norm -> unembed -> logits */
          return ctx.wait(700).then(function () {
            return ctx.transform(S.vec, { x: 860 }, 600, 'inOut');
          }).then(function () {
            ctx.pulse(S.norm, { color: 'amber', dur: 500 });
            return ctx.transform(S.vec, { x: 995 }, 600, 'inOut');
          }).then(function () {
            ctx.pulse(S.unemb, { color: 'amber', dur: 500 });
            ctx.fadeOut(S.vec, 400, true);
            return S.applyT(1.0, 800);
          }).then(function () {
            S.uLine.setAttribute('opacity', 1);
            ctx.reveal(S.uLine, { from: 'down', dur: 400 });
            ctx.pulse(S.strip[0].seg, { color: 'white', dur: 600 });
            return ctx.pulse(S.sampler, { color: 'amber', dur: 700 });
          }).then(function () { return ctx.wait(400); }).then(function () {
            return S.applyT(0.3, 700);
          }).then(function () { return ctx.wait(600); }).then(function () {
            return S.applyT(1.5, 700);
          }).then(function () { return ctx.wait(600); }).then(function () {
            return S.applyT(1.0, 600);
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Prefill vs decode',
        say: 'Serving splits the work into two very different phases. Prefill pushes the whole twelve thousand token agent context through the model in one parallel pass: giant matrix multiplies that saturate the tensor cores, and it writes the key value cache. Decode then produces one token per pass, re-reading every weight and the whole cache from memory just to do a tiny amount of math. So prefill is compute bound, and decode is memory bandwidth bound, unless you batch many users together.',
        deep: '<table><tr><th></th><th>Prefill</th><th>Decode</th></tr>' +
          '<tr><td>Tokens / pass</td><td>T (all prompt tokens)</td><td>1 per sequence</td></tr>' +
          '<tr><td>Math</td><td>GEMM [T×d]·[d×d′]</td><td>GEMV (GEMM with batch B)</td></tr>' +
          '<tr><td>Intensity</td><td>≈ T FLOP/byte (T ≪ d)</td><td>≈ B FLOP/byte</td></tr>' +
          '<tr><td>Metric</td><td>TTFT</td><td>TPOT / inter-token latency</td></tr></table>' +
          '<p><b>KV cache</b> per token (70B, GQA-8, BF16): 2 · 80 layers · 8 heads · 128 · 2 B = <b>320 KiB</b>. A 12k-token agent context holds 3.7 GiB; a full 128k (131,072-token) context holds 40 GiB — per sequence.</p>' +
          '<p><b>Prefill</b> of this 12k-token turn: 2N·T + 2·L·T²·d ≈ 1.69 + 0.19 PFLOP ⇒ TTFT ≈ 0.4 s at ~60% MFU on 8×H100. Its GEMMs reach ≈ 4k FLOP/byte once activation reads and writes are counted (the ≈ T rule holds only while T ≪ d).</p>' +
          '<p><b>Roofline</b> (H100 SXM): 989 TFLOP/s dense BF16 ÷ 3.35 TB/s HBM3 ⇒ ridge ≈ <b>295 FLOP/byte</b>. Decode at batch 1 sits at ≈ 1 FLOP/byte — 0.3% of peak compute. On 8 GPUs (TP=8) reading 141 GB of weights at 26.8 TB/s bounds a token at ≥ 5.3 ms.</p>' +
          '<div class="note">Hence continuous batching, PagedAttention, prefix caching, prefill/decode disaggregation and speculative decoding — see the LLM Serving chamber.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var g = ctx.group();
          var c1 = card(ctx, g, 60, 604, 720, 272, 'amber', 'ONE AGENT TURN ON 8×H100 (TP=8)');
          var X0 = 170;
          ctx.text(80, 668, 'prefill', { size: 13, font: 'mono', color: 'amber', parent: c1 });
          ctx.text(80, 728, 'decode', { size: 13, font: 'mono', color: 'lime', parent: c1 });
          ctx.text(80, 800, 'KV cache', { size: 13, font: 'mono', color: 'violet', parent: c1 });
          var pre = ctx.group({ parent: c1 });
          ctx.rect(X0, 648, 170, 40, { rx: 4, fill: ctx.alpha('amber', 0.25), stroke: 'amber', parent: pre });
          for (var i = 1; i < 17; i++) ctx.line(X0 + i * 10, 652, X0 + i * 10, 684, { color: ctx.alpha('amber', 0.45), sw: 1, parent: pre });
          ctx.text(X0 + 85, 668, '12k tokens at once', { size: 12, font: 'mono', color: 'white', anchor: 'middle', weight: 700, parent: pre });
          ctx.text(X0 + 85, 702, 'TTFT ≈ 0.4 s', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: pre });
          var ticks = [];
          for (var k = 0; k < 34; k++) ticks.push(ctx.rect(X0 + 176 + k * 11.5, 712, 8, 32, { rx: 2, fill: ctx.alpha('lime', 0.4), stroke: 'lime', sw: 0.8, parent: c1 }));
          ctx.text(X0 + 176, 758, '1 token / pass · TPOT ≈ 10–20 ms · 800 tokens ≈ 12 s', { size: 11, font: 'mono', color: 'lime', parent: c1 });
          ctx.rect(X0, 786, 560, 28, { rx: 4, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('violet', 0.3), sw: 1, parent: c1 });
          S.kvBar = ctx.rect(X0, 786, 0, 28, { rx: 4, fill: ctx.alpha('violet', 0.45), stroke: 'violet', sw: 1, parent: c1 });
          S.kvTxt = ctx.text(X0, 836, '', { size: 12, font: 'mono', color: 'violet', parent: c1 });
          ctx.text(X0 + 560, 836, '320 KiB / token', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: c1 });

          /* roofline (log-log) */
          var c2 = card(ctx, g, 820, 604, 720, 272, 'red', 'ROOFLINE · H100 SXM BF16');
          var PX = 900, PYY = 640, PW = 600, PH = 190;
          function tp(ai, tf) { return { x: PX + Math.log10(ai) / 4 * PW, y: PYY + PH - Math.log10(tf) / 3.3 * PH }; }
          ctx.line(PX, PYY + PH, PX + PW, PYY + PH, { color: 'faint', parent: c2 });
          ctx.line(PX, PYY, PX, PYY + PH, { color: 'faint', parent: c2 });
          ctx.text(PX + PW, PYY + PH + 18, 'FLOP / byte (log)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: c2 });
          ctx.text(PX + 10, PYY + 2, 'TFLOP/s (log)', { size: 11, font: 'mono', color: 'dim', parent: c2 });
          [1, 10, 100, 1000].forEach(function (a) { var p = tp(a, 1); ctx.text(p.x, PYY + PH + 18, String(a), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: c2 }); });
          [10, 100, 1000].forEach(function (f) { var p = tp(1, f); ctx.text(PX - 8, p.y, String(f), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: c2 }); });
          var ridge = tp(295, 989), a0 = tp(1, 3.35), a1 = tp(10000, 989);
          S.roof = ctx.path('M' + a0.x + ',' + a0.y + ' L' + ridge.x + ',' + ridge.y + ' L' + a1.x + ',' + a1.y, { stroke: 'red', sw: 2.5, parent: c2, glow: true });
          ctx.line(ridge.x, ridge.y, ridge.x, PYY + PH, { color: ctx.alpha('red', 0.5), dash: '3 4', parent: c2 });
          ctx.text(ridge.x + 6, PYY + PH - 12, 'ridge ≈ 295', { size: 11, font: 'mono', color: 'red', parent: c2 });
          ctx.text(ridge.x + 60, ridge.y - 12, '989 TFLOP/s', { size: 11, font: 'mono', color: 'red', parent: c2 });
          ctx.text(PX + 110, tp(10, 33).y - 10, '3.35 TB/s', { size: 11, font: 'mono', color: 'red', anchor: 'end', parent: c2 });
          var pts = [[1, 3.35, 'decode B=1', 'lime', 12, 14], [32, 107, 'decode B=32', 'lime', 10, 16], [4000, 989, 'prefill T=12k (≈4k F/B)', 'amber', -8, 22]];
          S.rpts = pts.map(function (q) {
            var p = tp(q[0], q[1]), pg = ctx.group({ parent: c2 });
            ctx.circle(p.x, p.y, 6, { fill: q[3], parent: pg, glow: true });
            ctx.text(p.x + q[4], p.y + q[5], q[2], { size: 11, font: 'mono', color: q[3], anchor: q[4] < 0 ? 'end' : 'start', parent: pg });
            return pg;
          });
          swapRowC(ctx, S, g);
          ctx.reveal(g, { from: 'up' });
          ticks.forEach(function (t) { t.setAttribute('opacity', 0); });
          S.rpts.forEach(function (p) { p.setAttribute('opacity', 0); });
          ctx.hud('KV cache ≈ 320 KiB / token · 70B GQA-8 BF16');
          var kv = function (tok) {
            S.kvBar.setAttribute('width', 560 * tok / 12800);
            S.kvTxt.textContent = (tok / 1000).toFixed(1) + 'k tokens · ' + (tok * 320 / 1048576).toFixed(2) + ' GiB';
          };
          kv(0);
          return ctx.wait(500).then(function () {
            ctx.reveal(S.roof, { from: 'draw', dur: 900 });
            ctx.pulse(pre, { color: 'amber', dur: 700 });
            ctx.reveal(S.rpts[2], { delay: 300 });
            return ctx.tween(900, function (t) { kv(12000 * t); }, 'out');
          }).then(function () {
            ctx.reveal(S.rpts[0], {});
            return ctx.tween(2400, function (t) {
              var n = Math.round(t * 34);
              ticks.forEach(function (tk, j) { tk.setAttribute('opacity', j < n ? 1 : 0); });
              kv(12000 + 800 * t);
            }, 'linear');
          }).then(function () {
            return ctx.reveal(S.rpts[1], {});
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Scale: dense vs MoE',
        say: 'Concrete numbers. A seventy billion parameter dense model has a model width of eight thousand one hundred ninety two, eighty layers, sixty four query heads sharing eight key value heads, and a vocabulary of one hundred twenty eight thousand. The MLPs hold most of the weights. Frontier models are mostly mixtures of experts: hundreds of billions or even a trillion parameters in total, but only a few tens of billions active per token, so compute per token stays modest while memory does not.',
        deep: '<p><b>Llama-3-70B-class dense</b>: d = 8,192, L = 80, 64 Q / 8 KV heads, d<sub>h</sub> = 128, d<sub>ff</sub> = 28,672, V = 128,256.</p>' +
          '<div class="eq">attn/block = 2d² + 2·d·(8·128) = 151 M &nbsp; mlp/block = 3·d·d<sub>ff</sub> = 705 M</div>' +
          '<p>80 × 856 M = 68.4 B, + embed 1.05 B + unembed 1.05 B ≈ <b>70.6 B</b>. Weights: 141 GB BF16, 71 GB FP8, ≈ 35–40 GB at 4-bit.</p>' +
          '<table><tr><th>Model</th><th>Total</th><th>Active/token</th></tr>' +
          '<tr><td>Llama 3.1 405B (dense)</td><td>405 B</td><td>405 B</td></tr>' +
          '<tr><td>Qwen3-235B-A22B</td><td>235 B</td><td>22 B</td></tr>' +
          '<tr><td>DeepSeek-V3 / R1</td><td>671 B</td><td>37 B</td></tr>' +
          '<tr><td>Kimi K2</td><td>1.04 T</td><td>32 B</td></tr></table>' +
          '<p>MoE decouples <i>capacity</i> (total params, memory) from <i>compute</i> (active params, ≈ 2N<sub>active</sub> FLOPs/token), at the price of all-to-all expert-parallel communication and router load balancing.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          var g = ctx.group();
          var c1 = card(ctx, g, 60, 604, 720, 272, 'amber', '70B DENSE · WHERE THE PARAMETERS LIVE');
          ctx.para(80, 652, ['d_model 8,192 · layers 80 · heads 64q / 8kv · d_head 128', 'd_ff 28,672 (SwiGLU) · vocab 128,256 · context 128k'], { size: 12, font: 'mono', color: 'text', lh: 22, parent: c1 });
          var parts = [['embed', 1.05, 'cyan'], ['attention', 12.1, 'amber'], ['MLP', 56.4, 'orange'], ['unembed', 1.05, 'violet']];
          var bx = 80, bw = 680 / 70.6, segs = [];
          parts.forEach(function (p, i) {
            var w = p[1] * bw;
            var r = ctx.rect(bx, 710, w, 34, { rx: 3, fill: ctx.alpha(p[2], 0.5), stroke: p[2], sw: 1, parent: c1 });
            r.setAttribute('data-w', w);
            segs.push(r);
            var lx = i === 0 ? bx : (i === 3 ? bx + w : bx + w / 2);
            ctx.text(lx, i % 2 ? 760 : 776, p[0] + ' ' + p[1] + 'B', { size: 11, font: 'mono', color: p[2], anchor: i === 0 ? 'start' : (i === 3 ? 'end' : 'middle'), parent: c1 });
            bx += w;
          });
          ctx.text(760, 694, 'Σ 70.6 B', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: c1 });
          ctx.para(80, 812, ['weights: 141 GB BF16 · 71 GB FP8 · ~38 GB 4-bit', 'compute: 2N ≈ 141 GFLOP/token (+ 4LTd attention)'], { size: 12, font: 'mono', color: 'dim', lh: 22, parent: c1 });

          var c2 = card(ctx, g, 820, 604, 720, 272, 'orange', 'TOTAL vs ACTIVE PARAMETERS PER TOKEN');
          var models = [['Llama 3.1 70B', 70.6, 70.6], ['Llama 3.1 405B', 405, 405], ['Qwen3-235B-A22B', 235, 22], ['DeepSeek-V3', 671, 37], ['Kimi K2', 1040, 32]];
          var sc = 440 / 1040;
          S.mBars = [];
          models.forEach(function (m, i) {
            var y = 654 + i * 40;
            ctx.text(1000, y, m[0], { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: c2 });
            var tot = ctx.rect(1010, y - 11, m[1] * sc, 22, { rx: 3, fill: ctx.alpha('orange', 0.12), stroke: ctx.alpha('orange', 0.6), sw: 1, dash: m[1] > m[2] ? '3 3' : null, parent: c2 });
            var act = ctx.rect(1010, y - 11, m[2] * sc, 22, { rx: 3, fill: ctx.alpha('amber', 0.65), stroke: 'amber', sw: 1, parent: c2 });
            var lab = m[1] === m[2] ? m[1] + 'B dense' : m[2] + 'B / ' + (m[1] >= 1000 ? (m[1] / 1000).toFixed(2) + 'T' : m[1] + 'B');
            var lx = Math.max(m[1] * sc, 0) + 1016;
            ctx.text(Math.min(lx, 1530), y, lab, { size: 11, font: 'mono', color: m[1] === m[2] ? 'amber' : 'orange', anchor: lx > 1400 ? 'end' : 'start', parent: c2 });
            S.mBars.push([tot, act, m[1] * sc, m[2] * sc]);
          });
          ctx.text(1010, 858, 'solid = active per token · dashed = total (memory)', { size: 11, font: 'mono', color: 'dim', parent: c2 });
          swapRowC(ctx, S, g);
          ctx.reveal(g, { from: 'up' });
          segs.forEach(function (r) { r.setAttribute('width', 0); });
          S.mBars.forEach(function (b) { b[0].setAttribute('width', 0); b[1].setAttribute('width', 0); });
          return ctx.wait(400).then(function () {
            var x = 80;
            segs.forEach(function (r, i) {
              var w = parseFloat(r.getAttribute('data-w'));
              r.setAttribute('x', x); x += w;
              ctx.animate(r, { width: [0, w] }, 500, 'out', i * 250);
            });
            return ctx.wait(1100);
          }).then(function () {
            var ps = S.mBars.map(function (b, i) {
              return Promise.all([ctx.animate(b[0], { width: [0, b[2]] }, 700, 'out', i * 200), ctx.animate(b[1], { width: [0, b[3]] }, 700, 'out', 300 + i * 200)]);
            });
            return Promise.all(ps);
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Where weights come from',
        say: 'Finally, where do these weights come from? Pretraining on roughly fifteen trillion tokens of next token prediction costs about six times parameters times tokens floating point operations, several million GPU hours. Mid training adds long context, code and math. Supervised fine tuning teaches the chat and tool call format, and reinforcement learning on verifiable, multi step tasks turns a predictor into a reliable agent. Every glowing part of this chamber opens: tokenization, the transformer block, attention, decoding, and training.',
        deep: '<div class="eq">C<sub>train</sub> ≈ 6·N·D &nbsp;⇒&nbsp; 6 · 70.6·10⁹ · 15·10¹² ≈ 6.4·10²⁴ FLOP</div>' +
          '<p>(forward 2N + backward 4N per token). Llama 3 405B used ≈ 3.8·10²⁵ FLOP on 15.6 T tokens with up to 16k H100s. Modern recipes <b>over-train</b> well past Chinchilla-optimal (D ≈ 20 N) because inference cost, not training cost, dominates lifetime spend.</p>' +
          '<ol><li><b>Pretrain</b>: cross-entropy on web, code, books, synthetic data.</li>' +
          '<li><b>Mid-train / annealing</b>: high-quality mixes, long-context extension (RoPE rescaling), reasoning data.</li>' +
          '<li><b>SFT</b>: chat template, tool-call format, trajectories.</li>' +
          '<li><b>Preference + RL</b>: DPO/RLHF for style and safety; RLVR (e.g. GRPO) on verifiable math, code and multi-step tool tasks.</li></ol>' +
          '<div class="note">Zoom targets: Tokenization · Transformer Block · Attention · Decoding · Training.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var g = ctx.group();
          ctx.rect(60, 604, 1000, 272, { rx: 12, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha('lime', 0.45), parent: g });
          ctx.text(80, 628, 'TRAINING PIPELINE   produces θ once, used for every token', { size: 13, font: 'mono', weight: 700, color: 'lime', parent: g, spacing: 1 });
          var stages = [['Pretrain', '15T tokens · CE', 'lime'], ['Mid-train', 'long ctx · code', 'lime'], ['SFT', 'chat · tool format', 'teal'], ['RL', 'RLHF · RLVR', 'teal']];
          S.trainNodes = stages.map(function (s, i) {
            return ctx.node({ x: 180 + i * 225, y: 700, w: 176, h: 64, title: s[0], sub: s[1], color: s[2], titleSize: 15, subSize: 11, parent: g });
          });
          var links = [];
          for (var i = 0; i < 3; i++) links.push(ctx.link(S.trainNodes[i], S.trainNodes[i + 1], { color: 'lime', parent: g }));
          ctx.para(100, 790, ['6ND ≈ 6.4·10²⁴ FLOP for 70B × 15T tokens', '≈ 7M H100-hours (Llama 3.1 70B)'], { size: 12, font: 'mono', color: 'dim', lh: 22, parent: g });
          /* Chinchilla parametric fit L(N,D) = E + A/N^a + B/D^b at N = 70.6B, D on a log axis */
          var lossFn = function (lg) { return 1.69 + 406.4 / Math.pow(70.6e9, 0.34) + 410.7 / Math.pow(Math.pow(10, lg), 0.28); };
          S.lossPlot = ctx.plot(640, 786, 380, 66, lossFn, { xDomain: [10.5, 13.3], yDomain: [1.8, 2.35], color: 'lime', sw: 2, parent: g, xLabel: 'tokens D (log) → 15T', yLabel: '' });
          ctx.text(648, 778, 'loss L(N=70.6B, D) = E + A/N^α + B/D^β  (Chinchilla fit)', { size: 11, font: 'mono', color: 'lime', parent: g });
          var pEnd = S.lossPlot.toPx(Math.log10(15e12), lossFn(Math.log10(15e12)));
          ctx.circle(pEnd.x, pEnd.y, 4, { fill: 'lime', parent: g, glow: true });
          ctx.text(pEnd.x - 6, pEnd.y - 12, 'L ≈ ' + lossFn(Math.log10(15e12)).toFixed(2), { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: g });
          S.thetaLink = ctx.path('M855,668 C855,600 600,590 600,512', { stroke: 'lime', sw: 1.8, dash: '6 5', arrow: true, parent: g });
          S.thetaLbl = ctx.label(740, 586, 'θ (weights)', { color: 'lime', size: 11, parent: g });
          S.trainGhost = ctx.node({ x: 518, y: 714, w: 920, h: 100, kind: 'ghost', color: 'lime', parent: g });
          swapRowC(ctx, S, g);
          ctx.reveal(g, { from: 'up' });
          ctx.hotspot(S.trainGhost, 'training');

          /* summary panel */
          var sm = card(ctx, null, 1100, 604, 440, 272, 'amber', 'ZOOM DEEPER');
          var items = [['Tokenization', 'BPE · embeddings'], ['Transformer block', 'norm · RoPE · SwiGLU'], ['Attention', 'QKᵀV · GQA · KV'], ['Decoding', 'sampling · grammars'], ['Training', 'pretrain · SFT · RL']];
          items.forEach(function (it, i) {
            var y = 656 + i * 42;
            ctx.circle(1124, y, 5, { fill: 'amber', parent: sm, glow: true });
            ctx.text(1140, y, it[0], { size: 14, font: 'display', weight: 600, color: 'white', parent: sm });
            ctx.text(1520, y, it[1], { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: sm });
            if (it[0] === 'Attention') {
              S.attnItem = ctx.group({ parent: sm });
              ctx.rect(1114, y - 15, 170, 30, { rx: 8, fill: 'rgba(255,191,58,0.001)', parent: S.attnItem });
              S.attnItem.box = boxOf(1114, y - 15, 170, 30);
            }
          });
          ctx.hotspot(S.attnItem, 'attention', { hint: 'ATTN ⤢' });
          S.summary = sm;
          ctx.reveal(sm, { from: 'right', delay: 500 });
          return ctx.wait(600).then(function () {
            ctx.reveal(links, { from: 'draw', stagger: 200 });
            return ctx.reveal(S.thetaLink, { from: 'draw', dur: 900, delay: 700 });
          }).then(function () {
            return ctx.packet(S.thetaLink, { color: 'lime', dur: 900, label: 'θ' });
          }).then(function () {
            var targets = [S.tokGhost, S.stack, S.attnChip, S.sampler, S.trainGhost];
            return targets.reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, { color: 'amber', dur: 450 }); }); }, Promise.resolve());
          });
        }
      }
    ]
  });
})();
