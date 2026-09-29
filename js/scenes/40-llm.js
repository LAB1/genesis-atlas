/* L1 — Inside the LLM. End-to-end forward pass: text -> tokens -> embeddings -> residual stream through
 * N blocks -> final norm -> unembedding -> logits -> sampling -> append (autoregressive loop);
 * prefill vs decode, KV cache, roofline, dense vs MoE scale, and where the weights come from.
 * Every step is a sequence of beats (see docs/SCENE_API.md). */
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
    S.seqN = (S.seqN || CONTEXT.length) + 1;
    S.seqLabel.textContent = 'CONTEXT  ·  director agent  ·  ' + S.seqN + ' tokens (' + (S.seqN - CONTEXT.length) + ' sampled)';
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
      'Kaplan et al., <i>Scaling Laws for Neural Language Models</i>, 2020',
      'Hoffmann et al., <i>Training Compute-Optimal Large Language Models</i> (Chinchilla), NeurIPS 2022',
      'Llama Team, Meta AI, <i>The Llama 3 Herd of Models</i>, 2024',
      'DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i>, 2024',
      'Kimi Team, <i>Kimi K2: Open Agentic Intelligence</i>, 2025',
      'Ainslie et al., <i>GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints</i>, EMNLP 2023',
      'Kwon et al., <i>Efficient Memory Management for Large Language Model Serving with PagedAttention</i>, SOSP 2023',
      'Pope et al., <i>Efficiently Scaling Transformer Inference</i>, MLSys 2023',
      'Williams, Waterman &amp; Patterson, <i>Roofline: An Insightful Visual Performance Model for Multicore Architectures</i>, CACM 2009',
      'Elhage et al., <i>A Mathematical Framework for Transformer Circuits</i>, Transformer Circuits 2021',
      'Press &amp; Wolf, <i>Using the Output Embedding to Improve Language Models</i> (weight tying), EACL 2017',
      'nostalgebraist, <i>interpreting GPT: the logit lens</i>, 2020; Belrose et al., <i>Eliciting Latent Predictions from Transformers with the Tuned Lens</i>, 2023'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Next-token machine',
        beats: [
          {
            say: 'Every agent in our film crew is powered by the same machine: a large language model. Here the director agent has written a sentence so far: the fox astronaut crash-lands on a glowing ice.',
            card: { tag: 'KEY IDEA', title: 'One machine, every agent', body: 'Director, writer and critic differ only in prompts and tools. Underneath, each is the same next-token predictor.' },
            deep: '<p>An autoregressive language model factorises the probability of a token sequence left to right:</p>' +
              '<div class="eq">p<sub>θ</sub>(x<sub>1:T</sub>) = ∏<sub>t</sub> p<sub>θ</sub>(x<sub>t</sub> | x<sub>&lt;t</sub>)</div>' +
              '<p>The 16 tokens shown are a toy. The director’s real context (system prompt, tool schemas, history, three sketches, the memo transcript) is around 12,000 tokens, and every one of them is a position the model can attend to.</p>'
          },
          {
            say: 'Strip away the chat interface and the model does exactly one thing. Given a sequence of tokens, it outputs a probability distribution over the next token. Inside sit seventy billion learned parameters, and nearly all of them take part in every token.',
            card: { tag: 'NUMBERS', title: 'The box is just weights', stat: { v: '70 B', u: 'parameters', l: 'dense model: nearly every weight takes part in every generated token' } },
            deep: '<p>One <b>forward pass</b> of a decoder-only transformer maps the prefix to a vector of <code>V</code> logits. The function f<sub>θ</sub> is a stack of identical blocks (next steps) parameterised by θ, a fixed set of tensors that does not change while the agent runs.</p>' +
              '<ul><li>Llama 3 70B: N = 70.6 B parameters, 141 GB in BF16.</li>' +
              '<li>Essentially all N weights are read for every token (the embedding table contributes a single row), which is why decoding is bandwidth-bound (step 6).</li></ul>'
          },
          {
            say: 'The output is one score for every entry in a vocabulary of about one hundred twenty eight thousand tokens, turned into probabilities. After ice, the top candidates are moon, planet and world.',
            card: { tag: 'HOW IT WORKS', title: 'Odds, not a single word', body: 'It emits <b>p(next token | context)</b> over the whole vocabulary. Something else has to choose.' },
            deep: '<p>The last layer produces <b>logits</b> z ∈ ℝ<sup>V</sup>, with V = 128,256 for Llama&nbsp;3. A softmax converts them into a distribution:</p>' +
              '<div class="eq">p<sub>i</sub> = e<sup>z<sub>i</sub></sup> / Σ<sub>j</sub> e<sup>z<sub>j</sub></sup></div>' +
              '<p>The six bars are the top candidates, renormalised for display; the other 128,250 tokens share the tail. Because the output is a full distribution, the same model can be decoded greedily, sampled, scored (perplexity) or constrained by a grammar.</p>'
          },
          {
            say: 'A sampler draws one token from that distribution, here moon, appends it to the context, and the whole machine runs again. That single loop, repeated, is how the model writes.',
            card: { tag: 'KEY IDEA', title: 'Generation is a loop', body: 'Sample, append, repeat. Each new token is fed back as input, so the model conditions on its own output.' },
            deep: '<p>Each new token costs one full forward pass, so text is generated <b>serially</b>: latency ≈ T<sub>out</sub> × TPOT, and extra parallel hardware does not remove that dependency (speculative decoding only amortises it).</p>' +
              '<p>Sampling turns the distribution into a choice, so a different draw gives a different film. Temperature 0 picks the arg-max and is deterministic in principle, though batch-dependent floating-point reductions can still flip near-ties.</p>' +
              '<p class="muted">Probabilities shown are illustrative.</p>'
          },
          {
            say: 'Everything an agent does, from plans to tool calls, is this loop. And it is expensive: for a seventy billion parameter model, each token costs about one hundred forty one billion floating point operations and reads one hundred forty one gigabytes of weights.',
            card: { tag: 'NUMBERS', title: 'The cost of one token', more: '<p>Each parameter takes part in one multiply and one add per token, so a dense model costs 2N FLOPs. Attention adds, per layer, QKᵀ (2·T·d<sub>attn</sub>) and AV (2·T·d<sub>attn</sub>) for the one new token against T cached positions: 4·L·T·d<sub>attn</sub> in total. Long contexts therefore cost compute as well as memory.</p>', stat: { v: '141', u: 'GFLOP', l: 'plus 141 GB of BF16 weights read from memory: 2N FLOPs, 2N bytes' } },
            deep: '<div class="eq">FLOPs/token ≈ 2N + 4·L·T·d<sub>attn</sub></div>' +
              '<p>≈ 141 GFLOP for N = 70.6 B, plus an attention term (QKᵀ and AV against T cached positions, d<sub>attn</sub> = 64·128 = 8,192) that grows with context: +31 GFLOP at T = 12k.</p>' +
              '<div class="note">Plans, JSON tool calls, critiques and the final shot list are all produced by this one loop. "Agent" behaviour is a property of the <i>harness</i> around it (see the Agent Loop chamber), not a different kind of model.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: the director's context, one chip per token */
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
          return ctx.reveal(chips, { from: 'up', stagger: 40, dur: 350 }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the black box, full of weights */
            S.inArrow = ctx.path('M125,216 V290', { stroke: ctx.alpha('cyan', 0.7), sw: 1.6, arrow: true });
            S.core = ctx.node({ x: 560, y: PY, w: 1020, h: 260, title: 'LLM   pθ( x_t | x_<t )', sub: '70B params · 1 forward pass / token', icon: 'brain', color: 'amber', titleSize: 26, subSize: 14 });
            var wr = ctx.rng(3);
            S.wField = ctx.matrix(545, 328, 10, 30, { cell: 13, gap: 3, cmap: 'amber', parent: S.core, values: function () { return 0.1 + wr() * 0.35; } });
            ctx.text(545 + 238, 512, 'θ: 80 layers × ~856 M weights, read for every token', { size: 12, font: 'mono', color: ctx.alpha('amber', 0.8), anchor: 'middle', parent: S.core });
            var wr2 = ctx.rng(9);
            S.wLoop = ctx.loop(function () {
              for (var q = 0; q < 12; q++) {
                var rr = Math.floor(wr2() * 10), cc = Math.floor(wr2() * 30);
                S.wField.cells[rr][cc].setAttribute('fill', ctx.cmap('amber', 0.08 + wr2() * 0.5));
              }
            });
            return Promise.all([ctx.reveal(S.inArrow, { from: 'draw' }), ctx.reveal(S.core, { from: 'scale', s0: 0.92, delay: 200 })]).then(function () {
              return ctx.pulse(S.core, { color: 'amber', dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the next-token distribution */
            S.outArrow = ctx.line(1058, PY, 1092, PY, { color: 'amber', sw: 1.6, arrow: true });
            S.distHead = ctx.text(1100, 302, 'next-token distribution', { size: 12, font: 'mono', color: 'amber' });
            S.dist = distPanel(ctx, null, 1170, 330);
            return ctx.reveal([S.outArrow, S.distHead, S.dist], { from: 'right', stagger: 120 }).then(function () {
              return S.dist.set(DIST_A.labels, softmax(DIST_A.logits, 1), 700);
            }).then(function () { return ctx.pulse(S.dist.rows[0].bar, { color: 'amber', dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: sample, append, run again */
            S.sampler = ctx.node({ x: 1455, y: PY, w: 140, h: 62, title: 'Sample', sub: 'x_t ~ p', icon: 'spark', color: 'amber', titleSize: 15, subSize: 11 });
            S.sArrow = ctx.line(1340, PY, 1381, PY, { color: 'amber', sw: 1.6, arrow: true });
            S.loop = ctx.path('M1455,388 V252 Q1455,240 1443,240 H1080', { stroke: ctx.alpha('amber', 0.8), sw: 1.6, dash: '5 5', arrow: true });
            S.loopLbl = ctx.text(1300, 226, 'append x_t, repeat', { size: 12, font: 'mono', color: 'amber', anchor: 'middle' });
            return Promise.all([
              ctx.reveal([S.sArrow, S.sampler], { from: 'right', stagger: 120 }),
              ctx.reveal(S.loop, { from: 'draw', delay: 400, dur: 700 }),
              ctx.reveal(S.loopLbl, { delay: 800 })
            ]).then(function () {
              return ctx.pulse(S.sampler, { color: 'amber', dur: 600 });
            }).then(function () {
              return appendToken(ctx, S, ' moon');
            }).then(function () {
              ctx.pulse(S.core, { color: 'amber', dur: 500 });
              return S.dist.set(DIST_B.labels, softmax(DIST_B.logits, 1), 500);
            }).then(function () {
              return appendToken(ctx, S, ',');
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the loop in code, and what one token costs */
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
            ctx.para(680, 660, ['compute   2N ≈ 141 GFLOP', 'weights   141 GB read (BF16)', 'KV cache  +320 KiB per token', 'context   attends to all T previous'], { size: 13, font: 'code', color: 'text', lh: 24, parent: c2 });
            keepWS(c2);
            S.rowC = g;
            return ctx.reveal(g, { from: 'up' }).then(function () { return ctx.pulse(c2, { color: 'amber', dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Tokens to vectors',
        beats: [
          {
            say: 'Open the box. First the tokenizer turns text into integer ids using byte level byte pair encoding: common words become one token, rare words split into pieces.',
            card: { tag: 'KEY IDEA', title: 'Text becomes integers', body: 'Sixteen chunks of text become sixteen integer ids. The model never sees letters, only numbers.' },
            deep: '<p>The tokenizer is a deterministic, invertible map from a byte string to a list of integer ids in <code>[0, V)</code>. It runs on the CPU before any GPU work, at roughly 10 MB/s per core in optimised libraries such as tiktoken, which is negligible next to the model.</p>' +
              '<ul><li>Byte-level BPE (GPT-2, Llama 3, Qwen): frequent byte sequences are merged into tokens; anything unseen falls back to raw bytes.</li>' +
              '<li>English prose ≈ 4 bytes (about 0.75 words) per token at V = 128k; Meta reports 3.94 characters per token for Llama 3 against 3.17 for Llama 2. Code and non-Latin scripts cost more tokens per character.</li></ul>' +
              '<p class="muted">Token boundaries here are illustrative; the Tokenization chamber takes them apart.</p>'
          },
          {
            say: 'Then each id selects one row of the embedding matrix, a table with one vector of eight thousand one hundred ninety two numbers per vocabulary entry.',
            card: { tag: 'HOW IT WORKS', title: 'One id, one row', body: 'Token id 39,935 (space fox; ids here are illustrative) names row 39,935. Rows are learned in training, never hand designed.' },
            deep: '<div class="eq">E ∈ ℝ<sup>V×d</sup>, &nbsp; V = 128,256, &nbsp; d = 8,192</div>' +
              '<p>Each row is a learned vector. Rows for related tokens end up near each other only because the training loss rewards it (see the Tokenization chamber for the geometry).</p>' +
              '<ul><li>1.05 B parameters = 2.1 GB in BF16, about 1.5% of the 70 B total.</li>' +
              '<li>Under tensor parallelism E is sharded along V: each of 8 GPUs owns V/8 rows.</li></ul>'
          },
          {
            say: 'Mathematically it is a one hot vector times a matrix, but in practice it is just a memory gather. Four token rows are copied into the input matrix, and no multiplication happens at all.',
            card: { tag: 'NUMBERS', title: 'A lookup, not a matmul', stat: { v: '0', u: 'FLOPs', l: 'for the lookup itself; a one-hot matmul would cost 2.1 GFLOP per token' } },
            deep: '<div class="eq">e = onehot(id)ᵀ · E = E[id, :] ∈ ℝ<sup>d</sup></div>' +
              '<p>A dense matmul would cost 2·V·d ≈ 2.1 GFLOP per token and multiply mostly by zeros. The gather moves d × 2 B = 16 KiB from HBM and does no arithmetic: O(T·d) bytes for T tokens.</p>' +
              '<p><b>Backward</b>: ∂L/∂E is non-zero only for rows whose ids occurred in the batch, so the gradient is row-sparse.</p>'
          },
          {
            say: 'The result is a matrix with one row per position, ready for the first block. The table alone holds over a billion parameters in a seventy billion model, and small models often tie it to the output layer.',
            card: { tag: 'TRY IT', title: 'Open Tokenization', body: 'Click the dashed ring around Tokenizer and Embed: BPE, chat templates, embedding geometry.' },
            deep: '<div class="eq">X = E[ids] ∈ ℝ<sup>T×d</sup></div>' +
              '<ul><li><b>Tied</b> output layer W<sub>U</sub> = Eᵀ (Press &amp; Wolf 2017) saves V·d parameters: decisive at 1B scale, negligible at 70B, where Llama 3 keeps them <b>untied</b>.</li>' +
              '<li>Positions are not added here: modern LLMs inject order inside attention with RoPE (Transformer Block chamber).</li>' +
              '<li>Multimodal rows replace some of these gathers with encoder outputs.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: open the box; the tokenizer */
          ctx.fadeOut(S.core, 500, true).then(function () { S.wLoop.stop(); });
          if (S.rowC) { ctx.fadeOut(S.rowC, 400, true); S.rowC = null; }
          S.frame = ctx.rect(50, 288, 1020, 266, { rx: 14, stroke: ctx.alpha('amber', 0.45), sw: 1.2, dash: '6 6', fill: 'rgba(255,191,58,0.02)' });
          S.frameLbl = ctx.text(146, 306, 'fθ  ·  decoder-only transformer', { size: 12, font: 'mono', color: ctx.alpha('amber', 0.8) });
          S.inArrow2 = ctx.path('M125,292 V385', { stroke: ctx.alpha('cyan', 0.7), sw: 1.6, arrow: true });
          S.tok = ctx.node({ x: 125, y: PY, w: 130, h: 62, title: 'Tokenizer', sub: 'byte BPE', color: 'amber', titleSize: 15, subSize: 11 });
          return Promise.all([
            ctx.reveal([S.frame, S.frameLbl], { delay: 300 }),
            ctx.reveal(S.inArrow2, { from: 'draw', delay: 400 }),
            ctx.reveal(S.tok, { from: 'left', delay: 500 })
          ]).then(function () { return ctx.pulse(S.tok, { color: 'amber', dur: 600 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the embedding table */
            S.emb = ctx.node({ x: 290, y: PY, w: 130, h: 62, title: 'Embed', sub: 'gather E[id]', color: 'amber', titleSize: 15, subSize: 11 });
            S.l_te = ctx.link(S.tok, S.emb, { color: 'amber' });
            S.tokGhost = ctx.node({ x: 207, y: PY, w: 310, h: 112, kind: 'ghost', color: 'amber' });
            ctx.hotspot(S.tokGhost, 'tokenization');
            var g = ctx.group();
            var gE = ctx.group({ parent: g });
            ctx.text(80, 628, 'EMBEDDING LOOKUP   onehot(id) · E  =  E[id]', { size: 13, font: 'mono', weight: 700, color: 'amber', parent: gE, spacing: 1 });
            var toks = [[' fox', 39935, 2], [' astronaut', 47733, 7], [' glowing', 49592, 4], [' ice', 10054, 10]];
            var r = ctx.rng(11);
            var E = ctx.matrix(320, 650, 12, 14, { cell: 12, gap: 2, cmap: 'diverge', parent: gE, values: function () { return (r() * 2 - 1) * 0.8; } });
            ctx.text(417, 836, 'E   128,256 × 8,192', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: gE });
            ctx.text(417, 856, '1.05 B params · 2.1 GB BF16', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: gE });
            var gX = ctx.group({ parent: g, opacity: 0 });
            var X = ctx.matrix(640, 700, 4, 14, { cell: 12, gap: 2, cmap: 'gray', values: function () { return 0.08; }, parent: gX });
            ctx.text(737, 772, 'X   T × 8,192  (BF16)', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: gX });
            ctx.text(737, 792, 'one row per position', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: gX });
            var idEls = toks.map(function (t, i) {
              var y = 672 + i * 44;
              ctx.text(150, y, t[0].replace(' ', '·'), { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: gE });
              ctx.label(210, y, String(t[1]), { color: 'cyan', size: 11, parent: gE });
              var rc = E.cellCenter(t[2], 0);
              return ctx.path('M246,' + y + ' C280,' + y + ' 285,' + rc.y + ' 314,' + rc.y, { stroke: ctx.alpha('cyan', 0.5), sw: 1.2, parent: g, arrow: true, opacity: 0 });
            });
            var side = ctx.para(880, 690, ['no FLOPs: a memory gather', 'grad is row-sparse', 'tied: W_U = Eᵀ (small models)', 'untied in Llama 3 70B'], { size: 12, font: 'mono', color: 'dim', lh: 22, parent: g, opacity: 0 });
            swapRowC(ctx, S, g);
            S.gX = gX;
            return Promise.all([
              ctx.reveal(S.emb, { from: 'left' }),
              ctx.reveal(S.l_te, { from: 'draw', delay: 300 }),
              ctx.reveal(S.tokGhost, { delay: 500 }),
              ctx.reveal(g, { from: 'up', delay: 300 })
            ]).then(function () { return ctx.pulse(S.emb, { color: 'amber', dur: 600 }); }).then(function () { return ctx.beat(2); }).then(function () {
              /* beat 2: the gather, row by row */
              ctx.reveal(gX, { dur: 300 });
              var chain = ctx.wait(300);
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
            }).then(function () { return ctx.beat(3); }).then(function () {
              /* beat 3: the matrix X, its size, tied and untied; X is handed to block 1 */
              S.ph = ctx.group();
              ctx.rect(400, 340, 630, 150, { rx: 10, stroke: ctx.alpha('amber', 0.4), sw: 1.2, dash: '4 6', fill: 'rgba(255,191,58,0.03)', parent: S.ph });
              ctx.text(715, 402, 'X ∈ ℝ^(T × 8192)  enters block 1 of 80', { size: 13, font: 'mono', color: ctx.alpha('amber', 0.9), anchor: 'middle', parent: S.ph });
              ctx.text(715, 430, 'the transformer stack, next step', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.ph });
              ctx.path('M368,' + PY + ' H396', { stroke: 'amber', sw: 1.6, arrow: true, parent: S.ph });
              return Promise.all([ctx.reveal(side, { from: 'left' }), ctx.reveal(S.ph, { from: 'left', delay: 200 }), ctx.pulse(gX, { color: 'amber', dur: 700 }), ctx.pulse(S.tokGhost, { color: 'amber', dur: 700 })]);
            });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'The residual stream',
        beats: [
          {
            say: 'Now the deep part: eighty transformer blocks, identical in shape but each with its own weights. Together they hold almost all of the model’s parameters, about sixty eight billion of them.',
            card: { tag: 'NUMBERS', title: 'The depth of the stack', stat: { v: '80', u: 'blocks', l: 'each ≈ 856 M parameters; every slab drawn stands for 5 blocks' } },
            deep: '<p>Every block maps <code>[T, 8192] → [T, 8192]</code>, so blocks compose freely and can be split across GPUs by pipeline parallelism, a few layers per stage. The stack holds all but two billion of the 70 B parameters; the other two are the embedding and unembedding tables.</p>' +
              '<p>Depth versus width: at a fixed budget, deeper models compose more steps of computation, wider ones parallelise better. Llama 3 405B uses 126 layers at d = 16,384; Llama 3 8B uses 32 layers at d = 4,096.</p>'
          },
          {
            say: 'Think of each position as owning a vector that flows along a residual stream. Every block reads that vector, computes an update, and adds it back. Nothing is overwritten, only accumulated.',
            card: { tag: 'KEY IDEA', title: 'The stream is a bus', body: 'Every block reads and writes the same 8,192-number vector, by small additive updates.', more: '<p>Because every update is added, the final hidden state is the sum of the embedding and all 160 sublayer outputs: h<sup>(L)</sup> = x + Σ<sub>ℓ</sub>(Δattn<sub>ℓ</sub> + Δmlp<sub>ℓ</sub>). Circuit analysis reads a model by tracing single terms of this sum.</p>' },
            deep: '<div class="eq">h<sup>(ℓ)</sup> = h<sup>(ℓ−1)</sup> + Attn<sub>ℓ</sub>(·) + MLP<sub>ℓ</sub>(·)</div>' +
              '<p>The residual stream is a d = 8,192-dimensional <b>communication bus</b>: blocks write into subspaces that later blocks read. Because every block is additive, the network behaves like an ensemble of many shallow paths, and gradients flow through the identity path unattenuated.</p>' +
              '<ul><li><b>Attention</b> moves information <i>between</i> positions.</li><li><b>MLP</b> transforms information <i>within</i> a position (key–value memories, feature detectors).</li></ul>'
          },
          {
            say: 'If you decode the stream early with the output matrix, a trick called the logit lens, you can watch the prediction sharpen with depth. After twenty layers the readout is still generic words like the and a.',
            card: { tag: 'HOW IT WORKS', title: 'Read the stream mid-way', body: 'Apply the final norm and unembedding to a middle layer. Every layer writes in one coordinate system.' },
            deep: '<div class="eq">p<sup>(ℓ)</sup> = softmax(W<sub>U</sub> · RMSNorm(h<sup>(ℓ)</sup>))</div>' +
              '<p><b>Logit lens</b> (nostalgebraist 2020): apply the final norm and W<sub>U</sub> to an intermediate h<sup>(ℓ)</sup>. Early layers were never trained to be read this way, so the <i>tuned lens</i> (Belrose et al. 2023) learns a small affine probe per layer and is more faithful.</p>' +
              '<p class="muted">The readouts shown are illustrative.</p>'
          },
          {
            say: 'Watch the prediction sharpen. By layer forty, planet leads. By layer sixty, moon has taken over, and at the last layer it holds roughly two thirds of the probability.',
            card: { tag: 'NUMBERS', title: 'Moon takes over', stat: { v: '0.68', l: 'probability of moon at layer 80 (illustrative), up from 0.14 at layer 40' } },
            deep: '<p>Predictions typically become recognisable in the middle layers and sharpen late; the last layers mostly refine and calibrate the distribution instead of introducing new candidates.</p>' +
              '<p><b>Why the readout works at all</b>: every block writes into the same coordinate system that W<sub>U</sub> reads, so a mid-stream state is already a noisy vector of evidence for tokens. Where it fails, tuned lenses or sparse-autoencoder probes are used instead.</p>' +
              '<p class="muted">Real profiles vary by prompt; these numbers are illustrative.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: eighty blocks, drawn as sixteen slabs */
          if (S.rowC) { ctx.fadeOut(S.rowC, 400, true); S.rowC = null; }
          ctx.fadeOut(S.ph, 400, true);
          S.stack = ctx.group();
          ctx.text(585, 318, '80 × transformer block   (each slab = 5 layers)', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: S.stack });
          S.slabs = [];
          for (var i = 0; i < 16; i++) {
            S.slabs.push(ctx.rect(398 + i * 23.5, 336, 15, 170, { rx: 3, fill: ctx.alpha('amber', 0.08 + i * 0.012), stroke: ctx.alpha('amber', 0.6), sw: 1, parent: S.stack, opacity: 0 }));
          }
          S.stream = ctx.line(355, PY, 790, PY, { color: ctx.alpha('white', 0.75), sw: 2, arrow: true, parent: S.stack });
          [3, 7, 11, 15].forEach(function (k, j) {
            ctx.text(398 + k * 23.5 + 7.5, 524, 'L' + (20 * (j + 1)), { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.stack });
          });
          S.stack.box = boxOf(380, 300, 410, 238);
          ctx.hotspot(S.stack, 'transformer');
          return ctx.reveal(S.stack, { from: 'scale', s0: 0.95 }).then(function () {
            return ctx.reveal(S.slabs, { from: 'fade', stagger: 30, dur: 250 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: a token vector travels the stack; every slab adds an update */
            var g = ctx.group();
            S.rowC = g;
            var c2 = card(ctx, g, 60, 612, 400, 230, 'white', 'THE STREAM IS A BUS');
            ctx.para(80, 660, ['h ← h + Attn(norm(h))   mix positions', 'h ← h + MLP(norm(h))    per position', '', 'blocks only ADD to the stream', '‖Δ‖ small vs ‖h‖: near-identity', 'identity path carries gradients', 'd = 8,192 dims, T positions'], { size: 12, font: 'code', color: 'text', lh: 22, parent: c2 });
            keepWS(c2);
            ctx.reveal(g, { from: 'up', delay: 200 });
            S.vec = vecGlyph(ctx, null, 5);
            ctx.place(S.vec, 355, PY);
            ctx.reveal(S.vec, { delay: 200 });
            var r = ctx.rng(21);
            var lastSlab = -1;
            return ctx.wait(600).then(function () {
              return ctx.tween(3200, function (t) {
                var x = 355 + t * 430;
                ctx.place(S.vec, x, PY);
                var k = Math.floor((x - 398) / 23.5);
                if (k >= 0 && k < 16 && k !== lastSlab && x > 398 + k * 23.5 + 7) {
                  lastSlab = k;
                  S.slabs[k].setAttribute('fill', ctx.alpha('amber', 0.45));
                  S.vec.m.set(function () { return r() * 2 - 1; });
                }
              }, 'linear');
            }).then(function () {
              S.slabs.forEach(function (s, i) { s.setAttribute('fill', ctx.alpha('amber', 0.08 + i * 0.012)); });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the logit lens, early layers */
            var lg = ctx.group({ parent: S.rowC });
            ctx.text(500, 628, 'LOGIT LENS   softmax(W_U · norm(h⁽ˡ⁾))   illustrative', { size: 13, font: 'mono', weight: 700, color: 'teal', parent: lg, spacing: 1 });
            var lens = [['L20', [[' the', 0.08], [' a', 0.06], [' cold', 0.05]]], ['L40', [[' planet', 0.21], [' moon', 0.14], [' world', 0.11]]],
              ['L60', [[' moon', 0.48], [' planet', 0.19], [' world', 0.07]]], ['L80', [[' moon', 0.68], [' planet', 0.15], [' world', 0.08]]]];
            S.lensRows = lens.map(function (row, i) {
              var y = 668 + i * 44, rg = ctx.group({ parent: lg });
              ctx.text(500, y, row[0], { size: 13, font: 'mono', weight: 700, color: 'teal', parent: rg });
              row[1].forEach(function (c, j) {
                var x = 550 + j * 170;
                ctx.text(x, y, c[0].replace(' ', '·'), { size: 12, font: 'mono', color: j === 0 ? 'white' : 'dim', parent: rg });
                ctx.rect(x + 66, y - 7, 56 * c[1] / 0.7, 14, { rx: 3, fill: ctx.alpha(c[0] === ' moon' ? 'amber' : 'teal', 0.55), parent: rg });
                ctx.text(x + 70 + 56 * c[1] / 0.7, y, c[1].toFixed(2), { size: 11, font: 'mono', color: 'dim', parent: rg });
              });
              rg.setAttribute('opacity', 0);
              return rg;
            });
            ctx.reveal(lg, { from: 'up' });
            return ctx.wait(300).then(function () {
              return ctx.reveal(S.lensRows[0], { from: 'left', dur: 400 });
            }).then(function () { return ctx.pulse(S.lensRows[0], { color: 'teal', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the readout sharpens toward moon, layer 40, 60, 80 */
            return ctx.reveal(S.lensRows[1], { from: 'left', dur: 400 }).then(function () {
              return ctx.reveal(S.lensRows[2], { from: 'left', dur: 400 });
            }).then(function () {
              return ctx.reveal(S.lensRows[3], { from: 'left', dur: 400 });
            }).then(function () { return ctx.pulse(S.lensRows[3], { color: 'amber', times: 2, dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Inside one block',
        beats: [
          {
            say: 'Zoom into a single block. It has two sublayers, each wrapped by a normalisation and a residual addition.',
            card: { tag: 'KEY IDEA', title: 'Two sublayers per block', body: 'Attention, then MLP. Each reads a normalised copy of the stream and adds its result back.' },
            deep: '<div class="eq">h = x + Attn(RMSNorm(x)),&nbsp;&nbsp; y = h + MLP(RMSNorm(h))</div>' +
              '<p>This is the <b>pre-norm</b> block: the norm sits inside each branch, so an unnormalised identity path runs from the first block to the last and gradients reach early layers undisturbed. Shown here: block ℓ = 46 of 80, zoomed out of the stack; the Transformer Block chamber takes it apart piece by piece.</p>'
          },
          {
            say: 'Attention is the only place where positions talk to each other. Watch the current token, ice, reach back toward the keys of every earlier token.',
            card: { tag: 'HOW IT WORKS', title: 'Where positions mix', body: 'Everything else acts on one position at a time. Attention lets ice read every earlier token, never later ones.' },
            deep: '<div class="eq">Attn(Q,K,V) = softmax(QKᵀ/√d<sub>h</sub> + M<sub>causal</sub>) V</div>' +
              '<p>The causal mask M sets scores of later positions to −∞, so position t reads only positions ≤ t. That is what lets training run in parallel over all T positions while inference stays autoregressive.</p>' +
              '<p>Per head, Q, K, V have shape <code>[T, 128]</code> and the score matrix is <code>[T, T]</code>: attention cost grows with the square of context (see the FlashAttention chamber).</p>'
          },
          {
            say: 'Each head computes how relevant every earlier token is, then pulls in a weighted mix of their values. Here a semantic head puts most of its weight on glowing, fox and astronaut.',
            card: { tag: 'HOW IT WORKS', title: 'A weighted mix of values', body: 'Line thickness is the attention weight. The head returns the weighted mix of the keys’ value vectors.' },
            deep: '<p>Weights come from a softmax over the T scores, so they sum to 1 for each query. The output of one head is Σ<sub>j</sub> a<sub>j</sub>·v<sub>j</sub> ∈ ℝ<sup>128</sup>; the 64 head outputs are concatenated and mixed by W<sub>O</sub>.</p>' +
              '<p>70B-class config: 64 query heads of d<sub>h</sub> = 128, but only <b>8 KV heads</b> (grouped-query attention): each K/V head is shared by 8 query heads, shrinking the KV cache 8× relative to MHA.</p>'
          },
          {
            say: 'Different heads learn different jobs. Click the head chip to cycle through a semantic head, a previous token head, and an attention sink that parks its weight on the first token.',
            card: { tag: 'TRY IT', title: 'Click the head chip', body: 'Cycle three heads: semantic, previous-token, attention sink. Same query, three different patterns.' },
            deep: '<p>Heads specialise: <b>previous-token</b> heads, <b>induction</b> heads (copy what followed an earlier match), semantic and entity heads, and <b>attention sinks</b> that park probability mass on the first token when nothing is relevant (softmax must sum to 1).</p>' +
              '<p class="muted">Patterns shown are illustrative; real heads are messier, and many are redundant or can be pruned with little loss.</p>'
          },
          {
            say: 'The second sublayer is the MLP. It works on each position separately, and it holds about four fifths of the block’s parameters, which is why the next steps open it up.',
            card: { tag: 'NUMBERS', title: 'Where the weights live', stat: { v: '82%', u: 'of params', l: 'of a block sit in the MLP: 705 M of 856 M in a 70B-class block' } },
            deep: '<p>The MLP is a <b>SwiGLU</b> with d<sub>ff</sub> = 28,672 (3.5 d): W<sub>1</sub>, W<sub>3</sub> ∈ ℝ<sup>8192×28672</sup> and W<sub>2</sub> ∈ ℝ<sup>28672×8192</sup>, i.e. 3·d·d<sub>ff</sub> = 705 M parameters against 151 M for attention and 16 k for the two norms.</p>' +
              '<p>Its inputs never mix positions, so it parallelises trivially over T and is where individual neurons and experts live.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: zoom from one slab into a pre-norm block */
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

          /* attention pattern of the current token over earlier keys (revealed in beat 1) */
          var keys = ['<bos>', 'Director', ' the', ' fox', ' astronaut', ' crash', ' on', ' a', ' glowing', ' ice'];
          var heads = [
            { name: 'head 17 · semantic', w: [0.04, 0.02, 0.02, 0.2, 0.16, 0.12, 0.02, 0.02, 0.28, 0.12] },
            { name: 'head 3 · prev-token', w: [0.03, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.02, 0.9, 0.05] },
            { name: 'head 0 · attn sink', w: [0.82, 0.02, 0.01, 0.02, 0.02, 0.02, 0.02, 0.02, 0.03, 0.02] }
          ];
          var ag = ctx.group({ parent: g, opacity: 0 });
          ctx.text(700, 628, 'query ·ice attends to earlier keys (causal)', { size: 12, font: 'mono', color: 'amber', parent: ag });
          var qx = 975, qy = 752;
          S.attLines = keys.map(function (k, i) {
            var y = 658 + i * 22;
            ctx.text(800, y, k.replace(' ', '·'), { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: ag });
            return ctx.path('M808,' + y + ' C900,' + y + ' 900,' + qy + ' ' + (qx - 34) + ',' + qy, { stroke: 'amber', sw: 1, parent: ag });
          });
          ctx.label(qx, qy, '·ice', { color: 'amber', size: 13, parent: ag });
          var agc = ctx.group({ parent: g, opacity: 0 });
          S.headChip = ctx.label(qx, 680, heads[0].name, { color: 'cyan', size: 11, w: 150, parent: agc });
          S.clickHint = ctx.text(qx, 704, 'click to cycle heads', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: agc, opacity: 0 });
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
          S.headChip.addEventListener('click', function (ev) { ev.stopPropagation(); if (S.headReady) S.setHead((S.head + 1) % 3, 500); });
          S.attLines.forEach(function (l) { l.setAttribute('opacity', 0.1); });
          S.blockPanel = g;
          swapRowC(ctx, S, g);
          ctx.hotspot(S.attn, 'attention');
          /* persistent attention handle inside fθ: stays reachable after the close-up is swapped out */
          S.attnChip = ctx.label(207, 522, 'attention · 64 heads × 80 layers', { color: 'amber', size: 11 });
          S.attnChip.box = boxOf(207 - S.attnChip.w / 2, 522 - S.attnChip.h / 2, S.attnChip.w, S.attnChip.h);
          ctx.hotspot(S.attnChip, 'attention', { hint: 'ATTN ⤢' });
          ctx.focus([S.stack, S.hl, g, S.attnChip, S.vec], 0.25);
          return Promise.all([ctx.reveal(g, { from: 'up', delay: 200 }), ctx.reveal(S.attnChip, { delay: 600 })]).then(function () {
            return ctx.pulse(S.hl, { color: 'white', dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the current token queries every earlier key */
            return ctx.reveal(ag, { dur: 400 }).then(function () {
              return ctx.packet(S.attLines[8], { color: 'amber', dur: 700, reverse: true });
            }).then(function () {
              return ctx.packet(S.attLines[3], { color: 'amber', dur: 600, reverse: true });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the semantic head's weights */
            ctx.reveal(agc, { dur: 300 });
            S.headReady = true;
            return S.setHead(0, 900).then(function () { return ctx.pulse(S.attn, { color: 'amber', dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: three heads, three jobs */
            ctx.reveal(S.clickHint, { dur: 300 });
            return ctx.pulse(S.headChip, { color: 'cyan', times: 2, dur: 500 }).then(function () {
              return S.setHead(1, 600);
            }).then(function () { return ctx.wait(600); }).then(function () {
              return S.setHead(2, 600);
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the MLP sublayer and its share of the weights */
            var tag = ctx.label(560, 748, '705 M params', { color: 'orange', size: 11, parent: g, opacity: 0 });
            return ctx.reveal(tag, { from: 'up', dur: 400 }).then(function () {
              return ctx.pulse(S.mlp, { color: 'orange', times: 2, dur: 600 });
            });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Logits & sampling',
        beats: [
          {
            say: 'After the last block, the vector for the final position goes through one more RMSNorm and is multiplied by the unembedding matrix. The result is one score, a logit, for each of about one hundred twenty eight thousand tokens.',
            card: { tag: 'NUMBERS', title: 'The last projection', more: '<p>Only the final position needs logits at inference, but training needs all T, so the unembedding GEMM is [T×8192]·[8192×128256]: for T = 4,096 that is 8.6 TFLOP per sequence, comparable to a whole transformer block. Chunked or fused cross-entropy kernels avoid materialising the full [T, V] logits tensor.</p>', stat: { v: '1.05 G', u: 'MACs', l: 'for the 8,192 × 128,256 unembedding of each generated token' } },
            deep: '<div class="eq">z = W<sub>U</sub> · RMSNorm(h<sub>T</sub><sup>(L)</sup>) ∈ ℝ<sup>V</sup></div>' +
              '<p>Only the <b>last position</b> needs logits at inference (training computes all T). The unembedding is a d × V GEMV per sequence: 8,192 × 128,256 ≈ 1.05 G MACs ≈ 2.1 GFLOP, about 1.5% of the 2N per-token budget. The final norm exists because, in a pre-norm network, the stream norm grows with depth.</p>'
          },
          {
            say: 'Softmax with a temperature turns scores into probabilities. Temperature divides every logit before the exponential, so it controls how peaked the distribution is.',
            card: { tag: 'HOW IT WORKS', title: 'T rescales the logits', more: '<p>Because p<sub>i</sub>/p<sub>j</sub> = exp((z<sub>i</sub> − z<sub>j</sub>)/τ), temperature scales log-odds. Here moon versus planet: the odds are e<sup>1.5</sup> ≈ 4.5 at τ = 1, e<sup>5</sup> ≈ 148 at τ = 0.3, and e<sup>1</sup> ≈ 2.7 at τ = 1.5.</p>', body: 'p<sub>i</sub> ∝ exp(z<sub>i</sub> / T). Below 1 sharpens, above 1 flattens; T → 0 is greedy arg-max.' },
            deep: '<div class="eq">p<sub>i</sub> = e<sup>z<sub>i</sub>/τ</sup> / Σ<sub>j</sub> e<sup>z<sub>j</sub>/τ</sup></div>' +
              '<ul><li><b>τ → 0</b>: greedy arg-max. <b>τ = 1</b>: the model distribution. <b>τ &gt; 1</b>: flatter, more diverse, more errors.</li>' +
              '<li>Dividing by τ multiplies the log-odds between any two tokens by 1/τ; it never reorders them.</li></ul>' +
              '<p>Probabilities shown are over the top-6 candidates, renormalised.</p>' +
              '<details><summary>Go deeper</summary><p>With β = 1/τ this is a Boltzmann distribution over energies −z<sub>i</sub>, and the entropy H = log Z − β·E[z] has derivative</p>' +
              '<div class="eq">dH/dτ = Var<sub>p</sub>(z) / τ³ ≥ 0</div>' +
              '<p>so entropy rises monotonically with temperature, from 0 (one-hot) as τ → 0 to log V (uniform) as τ → ∞. For the six logits shown, H = 0.05 nats at τ = 0.3, 1.05 at τ = 1 and 1.42 at τ = 1.5, against a maximum of ln 6 = 1.79.</p></details>'
          },
          {
            say: 'The sampler draws one uniform random number and walks along the cumulative distribution until it lands in a token’s segment. This is inverse transform sampling, and it costs almost nothing.',
            card: { tag: 'HOW IT WORKS', title: 'Inverse-CDF sampling', body: 'Lay the probabilities end to end on [0, 1]. A uniform draw u = 0.62 lands inside the segment of moon, which spans 0 to 0.68.' },
            deep: '<p><b>Inverse-CDF sampling</b>: draw u ~ U(0,1) and pick the first index i with Σ<sub>j≤i</sub> p<sub>j</sub> &gt; u. On GPUs this is a parallel prefix sum over V followed by a binary search per sequence.</p>' +
              '<p>The <b>Gumbel-max trick</b>, arg max<sub>i</sub>(z<sub>i</sub>/τ + g<sub>i</sub>) with g<sub>i</sub> ~ Gumbel(0,1), is an equivalent sampler that avoids the softmax altogether. A fixed random seed makes a run reproducible; every token draw consumes fresh randomness.</p>'
          },
          {
            say: 'Lower temperature sharpens the distribution toward moon, higher temperature flattens it. Click the temperature chips and watch the segments move under the same random draw. At the hottest setting that draw lands on planet instead.',
            card: { tag: 'TRY IT', title: 'Click a temperature chip', body: 'T 0.3 makes moon nearly certain. At T 1.5 the very same draw, u = 0.62, lands on planet. Only the segments moved.' },
            deep: '<p>Agents typically decode tool calls and JSON at low temperature (0–0.3) for reliability, and creative drafts, such as a trailer script, at 0.7–1.0. Temperature interacts with truncation: at high τ, min-p or top-p is usually needed to stop the tail from injecting nonsense tokens.</p>' +
              '<p>Very low temperature also reduces diversity across parallel samples, which hurts best-of-n and self-consistency voting.</p>'
          },
          {
            say: 'Real systems also truncate the tail with top p or min p, and for tool calls a grammar masks illegal tokens before the softmax, so the output is guaranteed to parse. The sampler is the doorway to the decoding chamber.',
            card: { tag: 'STATE OF THE ART', title: 'Valid tool JSON, always', body: 'Grammar masks set illegal-token logits to −∞ each step, so output always parses against the schema.' },
            deep: '<ul><li><b>top-k / top-p (nucleus)</b>: truncate the tail to the smallest set with cumulative mass ≥ p; <b>min-p</b> scales the cut by the max probability.</li>' +
              '<li>For tool calls, a grammar mask sets illegal-token logits to −∞ before softmax (constrained decoding). XGrammar prechecks most tokens ahead of time and overlaps grammar work with GPU execution, while llguidance computes masks on the fly at about 50 microseconds of CPU time per token for a 128k vocabulary, so the mask adds little to decode latency.</li></ul>' +
              '<p>The pink marker on the strip shows top-p 0.9 cutting the tail. Click the sampler to open the Decoding chamber.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: final norm, unembedding, logits */
          ctx.focus(null);
          ctx.fadeOut(S.hl, 300, true);
          S.norm = ctx.node({ x: 860, y: PY, w: 100, h: 62, title: 'RMSNorm', sub: 'final', color: 'amber', titleSize: 14, subSize: 11 });
          S.unemb = ctx.node({ x: 995, y: PY, w: 118, h: 62, title: 'Unembed', sub: 'W_U d×V', color: 'amber', titleSize: 14, subSize: 11 });
          S.l_sn = ctx.path('M792,' + PY + ' H808', { stroke: 'amber', sw: 1.6, arrow: true });
          S.l_nu = ctx.link(S.norm, S.unemb, { color: 'amber' });
          return Promise.all([
            ctx.reveal([S.norm, S.unemb], { from: 'left', stagger: 200 }),
            ctx.reveal([S.l_sn, S.l_nu], { from: 'draw', delay: 300, stagger: 150 })
          ]).then(function () {
            return ctx.transform(S.vec, { x: 860 }, 600, 'inOut');
          }).then(function () {
            ctx.pulse(S.norm, { color: 'amber', dur: 500 });
            return ctx.transform(S.vec, { x: 995 }, 600, 'inOut');
          }).then(function () {
            ctx.pulse(S.unemb, { color: 'amber', dur: 500 });
            return ctx.fadeOut(S.vec, 400, true);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: softmax with a temperature */
            S.tChips = ctx.group();
            ctx.text(1100, 490, 'temperature  (click)', { size: 11, font: 'mono', color: 'dim', parent: S.tChips });
            S.T = 1.0;
            S.tEls = [0.3, 0.7, 1.0, 1.5].map(function (T, i) {
              var c = ctx.label(1128 + i * 64, 516, 'T ' + T.toFixed(1), { color: 'cyan', size: 11, w: 56, parent: S.tChips });
              c.style.cursor = 'pointer';
              c.addEventListener('click', function (ev) { ev.stopPropagation(); S.applyT(T, 500); });
              return c;
            });
            /* row C: equations + inverse-CDF strip (the strip card appears in beat 2) */
            var g = ctx.group();
            var c1 = card(ctx, g, 60, 612, 560, 250, 'amber', 'LOGITS → PROBABILITIES');
            ctx.para(80, 660, ['z   = W_U · RMSNorm(h_T)      # [128,256]', 'p_i = exp(z_i/T) / Σ_j exp(z_j/T)', 'top-p: keep smallest set, Σp ≥ 0.9', 'min-p: drop p_i < 0.05 · max p', 'greedy: argmax z   (T → 0)', 'tool JSON: illegal tokens → -∞'], { size: 13, font: 'code', color: 'text', lh: 30, parent: c1 });
            keepWS(c1);
            S.c2 = card(ctx, g, 660, 612, 880, 250, 'cyan', 'INVERSE-CDF SAMPLING');
            S.c2.setAttribute('opacity', 0);
            var c2 = S.c2;
            S.strip = [];
            for (var i = 0; i < 6; i++) {
              var seg = ctx.rect(690, 680, 10, 34, { rx: 2, fill: ctx.alpha(SEGC[i], 0.45), stroke: SEGC[i], sw: 1, parent: c2 });
              var lab = ctx.text(690, 730, '', { size: 11, font: 'mono', color: SEGC[i], anchor: 'middle', parent: c2 });
              S.strip.push({ seg: seg, lab: lab });
            }
            ctx.text(690, 668, '0', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: c2 });
            ctx.text(1510, 668, '1', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: c2 });
            S.nuc = ctx.rect(0, 672, 2, 94, { rx: 1, fill: ctx.alpha('pink', 0.9), parent: c2, opacity: 0 });
            S.nucTxt = ctx.text(0, 758, '', { size: 11, font: 'mono', color: 'pink', parent: c2, opacity: 0 });
            S.uLine = ctx.rect(0, 664, 3, 66, { rx: 1, fill: 'white', parent: c2, glow: true, opacity: 0 });
            S.uTxt = ctx.text(700, 790, '', { size: 14, font: 'mono', color: 'white', parent: c2 });
            ctx.text(700, 820, 'u = 0.62 is the same draw at every T; T reshapes the segments', { size: 12, font: 'mono', color: 'dim', parent: c2 });
            swapRowC(ctx, S, g);

            S.applyT = function (T, ms) {
              S.T = T;
              S.tEls.forEach(function (c) { var on = Math.abs(parseFloat(c.lastChild.textContent.slice(2)) - T) < 1e-6; c.firstChild.setAttribute('fill', ctx.alpha('cyan', on ? 0.45 : 0.14)); });
              var p = softmax(DIST_A.logits, T);
              var W = 820, x0 = 690;
              var from = S.strip.map(function (s) { return [parseFloat(s.seg.getAttribute('x')), parseFloat(s.seg.getAttribute('width'))]; });
              var cum = 0, tgt = p.map(function (pi) { var a = [x0 + cum * W, pi * W]; cum += pi; return a; });
              var u = 0.62, pick = 0, acc = 0;
              for (var k = 0; k < 6; k++) { acc += p[k]; if (u < acc) { pick = k; break; } }
              S.uLine.setAttribute('x', x0 + u * W - 1.5);
              var cn = 0, kn = 0;
              while (kn < 6 && cn < 0.9) { cn += p[kn]; kn++; }
              S.nuc.setAttribute('x', x0 + cn * W - 1);
              S.nucTxt.setAttribute('x', x0 + cn * W + 6);
              S.nucTxt.textContent = 'top-p 0.9 keeps ' + kn + ' of 6 (tail cut)';
              S.nucTxt.setAttribute('text-anchor', cn > 0.8 ? 'end' : 'start');
              if (cn > 0.8) S.nucTxt.setAttribute('x', x0 + cn * W - 6);
              S.uTxt.textContent = 'u ~ U(0,1) = 0.62  →  ' + DIST_A.labels[pick].replace(' ', '·') + '   (p = ' + p[pick].toFixed(2) + ', T = ' + T.toFixed(1) + ')';
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
            return Promise.all([ctx.reveal(S.tChips, { delay: 200 }), ctx.reveal(g, { from: 'up', delay: 200 })]).then(function () {
              return S.applyT(1.0, 800);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: draw u, land in a segment */
            ctx.reveal(S.c2, { from: 'up', dur: 500 });
            return ctx.wait(400).then(function () {
              ctx.reveal(S.uLine, { from: 'down', dur: 400 });
              return ctx.wait(400);
            }).then(function () {
              ctx.pulse(S.strip[0].seg, { color: 'white', dur: 600 });
              return ctx.pulse(S.sampler, { color: 'amber', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: temperature sharpens and flattens the segments */
            return ctx.pulse(S.tChips, { color: 'cyan', dur: 500 }).then(function () {
              return S.applyT(0.3, 700);
            }).then(function () { return ctx.wait(600); }).then(function () {
              return S.applyT(1.5, 700);
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: back to T = 1, then top-p truncation, grammar masks, and the doorway to decoding */
            ctx.hotspot(S.sampler, 'decoding');
            return S.applyT(1.0, 600).then(function () {
              return Promise.all([ctx.reveal(S.nuc, { from: 'down', dur: 500 }), ctx.reveal(S.nucTxt, { delay: 300 })]);
            }).then(function () {
              return ctx.pulse(S.sampler, { color: 'amber', times: 2, dur: 600 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Prefill vs decode',
        beats: [
          {
            say: 'Serving splits the work into two very different phases. Prefill pushes the whole twelve thousand token agent context through the model in one parallel pass, and writes the key value cache.',
            card: { tag: 'HOW IT WORKS', title: 'Prefill writes the cache', body: 'All 12,000 prompt tokens go in at once; every layer’s keys and values are stored for decode.' },
            deep: '<p><b>Prefill</b> processes all T prompt tokens in one pass and writes K and V for every layer into the <b>KV cache</b>, so decode never recomputes the past.</p>' +
              '<p>KV cache per token (70B, GQA-8, BF16): 2 · 80 layers · 8 heads · 128 · 2 B = <b>320 KiB</b>. A 12k-token agent context therefore holds 3.7 GiB of cache. The chart is drawn per sequence, on 8×H100 with tensor parallelism 8 (one KV head per GPU).</p>'
          },
          {
            say: 'Its giant matrix multiplies saturate the tensor cores, so prefill is compute bound. On eight H100 GPUs the first token can arrive after about four tenths of a second.',
            card: { tag: 'NUMBERS', title: 'Time to first token', more: '<p>Total FLOPs = 2N·T + 2·L·T²·d<sub>attn</sub> = 1.69 + 0.19 PFLOP. Eight H100s deliver 8 × 989 TFLOP/s = 7.9 PFLOP/s at peak; at 60% MFU that is 4.75 PFLOP/s, so 1.88 / 4.75 ≈ 0.40 s.</p>', stat: { v: '≈ 0.4', u: 's', l: '12k-token prefill on 8×H100 at about 60% MFU: roughly 1.9 PFLOP' } },
            deep: '<p><b>Prefill</b> of this 12k-token turn: 2N·T + 2·L·T²·d ≈ 1.69 + 0.19 PFLOP ⇒ TTFT ≈ 0.4 s at ~60% MFU on 8×H100 (4.75 PFLOP/s effective). Treat that as a best case: at 40% MFU, or with all-reduce and scheduling overheads, 0.6 s or more is typical.</p>' +
              '<p>Its GEMMs reach ≈ 4k FLOP/byte once activation reads and writes are counted (the ≈ T rule holds only while T ≪ d), far above the H100 ridge, so the tensor cores are the bottleneck. The quadratic attention term is ~10% of the work at 12k tokens and equals the parameter FLOPs near 108k.</p>'
          },
          {
            say: 'Decode then produces one token per pass, re-reading every weight and the whole cache from memory just to do a tiny amount of math. Eight hundred tokens of plan take about twelve seconds at a typical fifteen milliseconds per token.',
            card: { tag: 'NUMBERS', title: 'Decode idles the chip', more: '<p>Batch-1 decode reads each BF16 weight (2 bytes) and uses it for one multiply-add (2 FLOP): 1 FLOP per byte. The H100 ridge is 989 TFLOP/s ÷ 3.35 TB/s ≈ 295 FLOP/byte, so utilisation is about 1/295 ≈ 0.3% of peak compute: the tensor cores wait on HBM.</p>', stat: { v: '0.3%', u: 'of peak', l: 'compute used at batch 1: about 1 FLOP per byte against a ridge of 295' } },
            deep: '<table><tr><th></th><th>Prefill</th><th>Decode</th></tr>' +
              '<tr><td>Tokens / pass</td><td>T (all prompt tokens)</td><td>1 per sequence</td></tr>' +
              '<tr><td>Math</td><td>GEMM [T×d]·[d×d′]</td><td>GEMV (GEMM with batch B)</td></tr>' +
              '<tr><td>Intensity</td><td>≈ T FLOP/byte (T ≪ d)</td><td>≈ B FLOP/byte</td></tr>' +
              '<tr><td>Metric</td><td>TTFT</td><td>TPOT / inter-token latency</td></tr></table>' +
              '<p><b>Roofline</b> (H100 SXM): 989 TFLOP/s dense BF16 ÷ 3.35 TB/s HBM3 ⇒ ridge ≈ <b>295 FLOP/byte</b>. Decode at batch 1 sits at ≈ 1 FLOP/byte, 0.3% of peak compute. On 8 GPUs (TP=8), reading 141 GB of weights at 26.8 TB/s bounds a token at ≥ 5.3 ms. The 10–20 ms TPOT used here is an assumed typical figure for batch-1, 8-way tensor-parallel decoding: all-reduces and kernel overheads sit on top of that memory bound.</p>'
          },
          {
            say: 'So prefill is compute bound, and decode is memory bandwidth bound, unless you batch many users together. At batch thirty two the same weights serve thirty two sequences, and the point climbs the roofline.',
            card: { tag: 'TRADE-OFF', title: 'Batching buys intensity', body: 'Each extra sequence reuses the same weight read. But each brings its own KV cache and waits for the slowest.' },
            deep: '<p>A weight fetched from HBM does 2B FLOPs for B sequences batched together, so decode intensity ≈ B FLOP/byte (BF16) and reaches the ridge only near B ≈ 300. Real systems stop far short: KV-cache reads scale with B (they are not amortised like weights) and each sequence needs its own cache.</p>' +
              '<div class="note">Hence continuous batching, PagedAttention, prefix caching, prefill/decode disaggregation and speculative decoding — see the LLM Serving chamber.</div>' +
              '<details><summary>Go deeper</summary><p>The amortisation argument covers only the weight GEMMs. Decode attention reads each sequence’s own KV cache once: every cached K or V element (2 bytes) feeds one multiply-add, so 2 FLOP per 2 bytes = 1 FLOP/byte whatever B is. With GQA one K/V byte serves g = 8 query heads, so decode attention sits at ≈ 8 FLOP/byte, far below the ridge of 295.</p>' +
              '<p>Consequence: at long context the cache, not the weights, dominates traffic. Weight bytes are shared by the whole batch (141 GB per step) but cache bytes are per sequence (3.9 GB at 12k tokens, 43 GB at 128k), so cache traffic overtakes weight traffic at B ≈ 36 and B ≈ 3 respectively.</p></details>'
          },
          {
            say: 'The other limit is capacity. The cache costs three hundred twenty kibibytes per token, so this turn holds about four gibibytes, and one full context of one hundred twenty eight thousand tokens holds forty, for a single sequence.',
            card: { tag: 'NUMBERS', title: 'Memory caps the batch', stat: { v: '40 GiB', l: 'KV cache of one 128k-token sequence at 320 KiB per token' } },
            deep: '<p>A full 128k (131,072-token) context holds 40 GiB of KV cache in BF16, per sequence. Weights take 17.6 GB on each of 8 GPUs, leaving roughly 55 GB of HBM per GPU for cache: ≈ 440 GB in total, i.e. about 10 full-length sequences or ≈ 110 turns of 12k tokens.</p>' +
              '<ul><li>GQA (8×) and MLA (DeepSeek, ≈ 70 KB/token) shrink the cache; an FP8 KV cache halves it again.</li>' +
              '<li>PagedAttention removes fragmentation; prefix caching shares the system-prompt cache between agents.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: prefill writes the KV cache */
          var g = ctx.group();
          swapRowC(ctx, S, g);
          var c1 = card(ctx, g, 60, 604, 720, 272, 'amber', 'ONE AGENT TURN ON 8×H100 (TP=8)');
          var X0 = 170;
          ctx.text(80, 668, 'prefill', { size: 13, font: 'mono', color: 'amber', parent: c1 });
          S.decLbl = ctx.text(80, 728, 'decode', { size: 13, font: 'mono', color: 'lime', parent: c1, opacity: 0 });
          ctx.text(80, 800, 'KV cache', { size: 13, font: 'mono', color: 'violet', parent: c1 });
          var pre = ctx.group({ parent: c1 });
          ctx.rect(X0, 648, 170, 40, { rx: 4, fill: ctx.alpha('amber', 0.25), stroke: 'amber', parent: pre });
          for (var i = 1; i < 17; i++) ctx.line(X0 + i * 10, 652, X0 + i * 10, 684, { color: ctx.alpha('amber', 0.45), sw: 1, parent: pre });
          ctx.text(X0 + 85, 668, '12k tokens at once', { size: 12, font: 'mono', color: 'white', anchor: 'middle', weight: 700, parent: pre });
          S.ttft = ctx.text(X0 + 85, 702, 'TTFT ≈ 0.4 s', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: c1, opacity: 0 });
          var ticks = [];
          for (var k = 0; k < 34; k++) ticks.push(ctx.rect(X0 + 176 + k * 11.5, 712, 8, 32, { rx: 2, fill: ctx.alpha('lime', 0.4), stroke: 'lime', sw: 0.8, parent: c1, opacity: 0 }));
          S.decTxt = ctx.text(X0 + 176, 758, '1 token / pass · TPOT ≈ 10–20 ms · 800 tokens ≈ 12 s', { size: 11, font: 'mono', color: 'lime', parent: c1, opacity: 0 });
          ctx.rect(X0, 786, 560, 28, { rx: 4, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('violet', 0.3), sw: 1, parent: c1 });
          S.kvBar = ctx.rect(X0, 786, 0, 28, { rx: 4, fill: ctx.alpha('violet', 0.45), stroke: 'violet', sw: 1, parent: c1 });
          S.kvTxt = ctx.text(X0, 836, '', { size: 12, font: 'mono', color: 'violet', parent: c1 });
          ctx.text(X0 + 560, 836, '320 KiB / token', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: c1 });
          S.kvNote = ctx.text(X0, 858, '128k context = 40 GiB per sequence, half of an H100’s 80 GB', { size: 12, font: 'mono', color: 'violet', parent: c1, opacity: 0 });

          /* roofline (log-log), revealed in beat 1 */
          var c2 = card(ctx, g, 820, 604, 720, 272, 'red', 'ROOFLINE · H100 SXM BF16');
          c2.setAttribute('opacity', 0);
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
            var p = tp(q[0], q[1]), pg = ctx.group({ parent: c2, opacity: 0 });
            ctx.circle(p.x, p.y, 6, { fill: q[3], parent: pg, glow: true });
            ctx.text(p.x + q[4], p.y + q[5], q[2], { size: 11, font: 'mono', color: q[3], anchor: q[4] < 0 ? 'end' : 'start', parent: pg });
            return pg;
          });
          ctx.hud('KV cache ≈ 320 KiB / token · 70B GQA-8 BF16');
          var kv = function (tok) {
            S.kvBar.setAttribute('width', 560 * tok / 12800);
            S.kvTxt.textContent = (tok / 1000).toFixed(1) + 'k tokens · ' + (tok * 320 / 1048576).toFixed(2) + ' GiB';
          };
          kv(0);
          return ctx.reveal(g, { from: 'up' }).then(function () {
            ctx.pulse(pre, { color: 'amber', dur: 700 });
            return ctx.tween(1100, function (t) { kv(12000 * t); }, 'out');
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: prefill sits on the compute roof */
            ctx.reveal(c2, { from: 'up', dur: 500 });
            return ctx.wait(400).then(function () {
              ctx.reveal(S.ttft, { dur: 400 });
              return ctx.reveal(S.roof, { from: 'draw', dur: 900 });
            }).then(function () {
              ctx.reveal(S.rpts[2], { dur: 400 });
              return ctx.pulse(S.rpts[2], { color: 'amber', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: decode, one token per pass, deep in the bandwidth-bound region */
            ctx.reveal([S.decLbl, S.decTxt], { dur: 300 });
            ctx.reveal(S.rpts[0], { delay: 300, dur: 400 });
            return ctx.tween(2400, function (t) {
              var n = Math.round(t * 34);
              ticks.forEach(function (tk, j) { tk.setAttribute('opacity', j < n ? 1 : 0); });
              kv(12000 + 800 * t);
            }, 'linear').then(function () { return ctx.pulse(S.rpts[0], { color: 'lime', dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: batching lifts decode up the memory-bound slope */
            ctx.reveal(S.rpts[1], { dur: 400 });
            return ctx.pulse(S.rpts[1], { color: 'lime', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the cache costs capacity */
            ctx.reveal(S.kvNote, { from: 'up', dur: 400 });
            return ctx.pulse(S.kvBar, { color: 'violet', times: 2, dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Scale: dense vs MoE',
        beats: [
          {
            say: 'Concrete numbers. A seventy billion parameter dense model has a model width of eight thousand one hundred ninety two, eighty layers, sixty four query heads sharing eight key value heads, and a vocabulary of one hundred twenty eight thousand.',
            card: { tag: 'KEY IDEA', title: 'A 70B model in one line', body: 'Width 8,192, 80 layers, 64 query heads sharing 8 KV heads, feed-forward width 28,672: all multiples of 128.' },
            deep: '<p><b>Llama-3-70B-class dense</b>: d = 8,192, L = 80, 64 Q / 8 KV heads, d<sub>h</sub> = 128, d<sub>ff</sub> = 28,672, V = 128,256, context 128k.</p>' +
              '<p>These sizes are multiples of 128 (8,192 = 64·128; 28,672 = 224·128; 128,256 = 1,002·128), so tensor-core tiles divide them evenly: a hardware constraint as much as a modelling choice.</p>'
          },
          {
            say: 'The MLPs hold most of the weights: about eighty percent, against seventeen percent for attention, and only three percent for the two embedding tables. Weights alone take one hundred forty one gigabytes in half precision.',
            card: { tag: 'NUMBERS', title: 'Most weights are MLP', more: '<p>Per block: attention 151 M (2d² for Q and O, 2·d·1,024 for K and V), MLP 705 M (3·d·28,672). Times 80: attention 12.1 B, MLP 56.4 B. Embedding plus unembedding: 2 × 128,256 × 8,192 = 2.1 B. Sum 70.6 B, of which the MLP is 79.9%.</p>', stat: { v: '80%', u: 'are MLP', l: '56.4 B of 70.6 B are feed-forward; attention 12.1 B, embeddings 2.1 B' } },
            deep: '<div class="eq">attn / block = 2d² + 2·d·(8·128) = 151 M</div><div class="eq">mlp / block = 3·d·d<sub>ff</sub> = 705 M</div>' +
              '<p>80 × 856 M = 68.4 B, + embed 1.05 B + unembed 1.05 B ≈ <b>70.6 B</b>. Weights: 141 GB BF16, 71 GB FP8, ≈ 35–40 GB at 4-bit.</p>' +
              '<p>Compute: 2N ≈ 141 GFLOP per token, plus 4·L·d<sub>attn</sub> ≈ 2.6 MFLOP per token of context for attention.</p>'
          },
          {
            say: 'In a dense model, total and active parameters are the same. The largest dense model shown, Llama three point one with four hundred five billion parameters, needs eight hundred ten gigabytes of weight reads for every single token.',
            card: { tag: 'TRADE-OFF', title: 'Dense pays for all', body: 'Every parameter costs 2 FLOPs and 2 bytes of bandwidth per token. Bigger dense means proportionally slower.' },
            deep: '<table><tr><th>Model</th><th>Total</th><th>Active/token</th></tr>' +
              '<tr><td>Llama 3.1 70B (dense)</td><td>70.6 B</td><td>70.6 B</td></tr>' +
              '<tr><td>Llama 3.1 405B (dense)</td><td>405 B</td><td>405 B</td></tr></table>' +
              '<p>For a dense model, memory and compute scale together: 405 B parameters cost 810 GFLOP and 810 GB of weight reads per token in BF16, which is why the 405B model is served in FP8 across 8 GPUs (≈ 405 GB).</p>'
          },
          {
            say: 'Mixtures of experts break that link. DeepSeek V3 stores six hundred seventy one billion parameters but activates thirty seven billion per token, and Kimi K2 stores over a trillion. Compute per token stays modest while memory does not.',
            card: { tag: 'NUMBERS', title: 'Stored versus used', stat: { v: '32 B', u: 'active', l: 'of Kimi K2’s 1.04 T parameters; DeepSeek-V3 uses 37 B of 671 B' } },
            deep: '<table><tr><th>Model</th><th>Total</th><th>Active/token</th></tr>' +
              '<tr><td>Qwen3-235B-A22B</td><td>235 B</td><td>22 B</td></tr>' +
              '<tr><td>DeepSeek-V3 / R1</td><td>671 B</td><td>37 B</td></tr>' +
              '<tr><td>Kimi K2</td><td>1.04 T</td><td>32 B</td></tr></table>' +
              '<p>MoE decouples <i>capacity</i> (total params, memory) from <i>compute</i> (active params, ≈ 2N<sub>active</sub> FLOPs/token), at the price of all-to-all expert-parallel communication and router load balancing.</p>' +
              '<p>Rule of thumb: memory traffic follows what is <b>resident</b> (all experts must be somewhere in HBM), FLOPs follow what is <b>active</b>. DeepSeek-V3 spends about 74 GFLOP per token, roughly half of dense Llama 70B, while holding almost ten times the parameters.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          /* beat 0: the 70B configuration */
          var g = ctx.group();
          swapRowC(ctx, S, g);
          var c1 = card(ctx, g, 60, 604, 720, 272, 'amber', '70B DENSE · WHERE THE PARAMETERS LIVE');
          ctx.para(80, 652, ['d_model 8,192 · layers 80 · heads 64q / 8kv · d_head 128', 'd_ff 28,672 (SwiGLU) · vocab 128,256 · context 128k'], { size: 12, font: 'mono', color: 'text', lh: 22, parent: c1 });
          var parts = [['embed', 1.05, 'cyan'], ['attention', 12.1, 'amber'], ['MLP', 56.4, 'orange'], ['unembed', 1.05, 'violet']];
          var bx = 80, bw = 680 / 70.6, segs = [], segG = ctx.group({ parent: c1, opacity: 0 });
          parts.forEach(function (p, i) {
            var w = p[1] * bw;
            var r = ctx.rect(bx, 710, w, 34, { rx: 3, fill: ctx.alpha(p[2], 0.5), stroke: p[2], sw: 1, parent: segG });
            r.setAttribute('data-w', w);
            r.setAttribute('data-x', bx);
            segs.push(r);
            var lx = i === 0 ? bx : (i === 3 ? bx + w : bx + w / 2);
            ctx.text(lx, i % 2 ? 760 : 776, p[0] + ' ' + p[1] + 'B', { size: 11, font: 'mono', color: p[2], anchor: i === 0 ? 'start' : (i === 3 ? 'end' : 'middle'), parent: segG });
            bx += w;
          });
          ctx.text(760, 694, 'Σ 70.6 B', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: segG });
          var wts = ctx.para(80, 812, ['weights: 141 GB BF16 · 71 GB FP8 · ~38 GB 4-bit', 'compute: 2N ≈ 141 GFLOP/token (+ 4LTd attention)'], { size: 12, font: 'mono', color: 'dim', lh: 22, parent: c1, opacity: 0 });
          segs.forEach(function (r) { r.setAttribute('width', 0); });
          return ctx.reveal(g, { from: 'up' }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the split of the 70.6 B parameters */
            ctx.reveal(segG, { dur: 300 });
            var x = 80;
            return Promise.all(segs.map(function (r, i) {
              var w = parseFloat(r.getAttribute('data-w'));
              r.setAttribute('x', x); x += w;
              return ctx.animate(r, { width: [0, w] }, 500, 'out', i * 250);
            })).then(function () { return ctx.reveal(wts, { dur: 400 }); }).then(function () { return ctx.pulse(segs[2], { color: 'orange', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: dense models, total equals active */
            var c2 = card(ctx, g, 820, 604, 720, 272, 'orange', 'TOTAL vs ACTIVE PARAMETERS PER TOKEN');
            S.c2 = c2;
            var models = [['Llama 3.1 70B', 70.6, 70.6], ['Llama 3.1 405B', 405, 405], ['Qwen3-235B-A22B', 235, 22], ['DeepSeek-V3', 671, 37], ['Kimi K2', 1040, 32]];
            var sc = 400 / 1040;
            S.mBars = [];
            S.addModel = function (i) {
              var m = models[i], y = 654 + i * 40, rg = ctx.group({ parent: c2 });
              ctx.text(1000, y, m[0], { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: rg });
              var tot = ctx.rect(1010, y - 11, 0, 22, { rx: 3, fill: ctx.alpha('orange', 0.12), stroke: ctx.alpha('orange', 0.6), sw: 1, dash: m[1] > m[2] ? '3 3' : null, parent: rg });
              var act = ctx.rect(1010, y - 11, 0, 22, { rx: 3, fill: ctx.alpha('amber', 0.65), stroke: 'amber', sw: 1, parent: rg });
              var lab = m[1] === m[2] ? m[1] + 'B dense' : m[2] + 'B / ' + (m[1] >= 1000 ? (m[1] / 1000).toFixed(2) + 'T' : m[1] + 'B');
              var lx = Math.max(m[1] * sc, 0) + 1018;
              var lt = ctx.text(lx, y, lab, { size: 11, font: 'mono', color: m[1] === m[2] ? 'amber' : 'orange', anchor: 'start', parent: rg, opacity: 0 });
              S.mBars[i] = [tot, act, m[1] * sc, m[2] * sc];
              return Promise.all([ctx.animate(tot, { width: [0, m[1] * sc] }, 700, 'out', 0), ctx.animate(act, { width: [0, m[2] * sc] }, 700, 'out', 300)]).then(function () { return ctx.reveal(lt, { dur: 300 }); });
            };
            ctx.text(1010, 858, 'solid = active per token · dashed = total (memory)', { size: 11, font: 'mono', color: 'dim', parent: c2 });
            ctx.reveal(c2, { from: 'up', dur: 500 });
            return ctx.wait(400).then(function () { return S.addModel(0); }).then(function () { return S.addModel(1); }).then(function () {
              return ctx.pulse(S.mBars[1][1], { color: 'amber', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: mixtures of experts store far more than they use */
            return S.addModel(2).then(function () { return S.addModel(3); }).then(function () { return S.addModel(4); }).then(function () {
              return ctx.pulse(S.mBars[4][0], { color: 'orange', times: 2, dur: 600 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Where weights come from',
        beats: [
          {
            say: 'Finally, where do these weights come from? Pretraining on roughly fifteen trillion tokens of next token prediction costs about six times parameters times tokens floating point operations, several million GPU hours.',
            card: { tag: 'NUMBERS', title: 'The price of pretraining', more: '<p>Forward pass 2N FLOPs per token, backward 4N (two GEMMs per layer), hence 6N per training token. For N = 70.6 B and D = 15 T: 6 × 70.6·10⁹ × 15·10¹² = 6.35·10²⁴ FLOP. At 400 TFLOP/s per H100 (about 40% MFU, the rate Meta reports for its 405B run) that is 4.4 M GPU-hours. Meta’s model card lists about 7.0 M H100-hours for Llama 3.1 70B, which implies roughly 250 TFLOP/s per GPU on this 6ND estimate.</p>', stat: { v: '6.4e24', u: 'FLOP', l: '6ND for 70B on 15T tokens; Meta reports about 7 million H100-hours' } },
            deep: '<div class="eq">C<sub>train</sub> ≈ 6·N·D &nbsp;⇒&nbsp; 6 · 70.6·10⁹ · 15·10¹² ≈ 6.4·10²⁴ FLOP</div>' +
              '<p>(forward 2N + backward 4N per token). Llama 3 405B used ≈ 3.8·10²⁵ FLOP on 15.6 T tokens with up to 16k H100s. Modern recipes <b>over-train</b> well past Chinchilla-optimal (D ≈ 20 N) because a smaller, longer-trained model is cheaper to serve, and serving cost can dominate lifetime spend.</p>' +
              '<p>The curve is a Chinchilla-style parametric fit L(N,D) = E + A/N<sup>α</sup> + B/D<sup>β</sup> at N = 70.6 B, with the constants of the Besiroglu et al. replication (the same ones the training chamber uses): about 1.93 at 15 T tokens, against an irreducible E = 1.82.</p>' +
              '<details><summary>Go deeper</summary><p>Minimise L(N, D) = E + A/N<sup>α</sup> + B/D<sup>β</sup> subject to C = 6ND. The Lagrange condition is αA/N<sup>α</sup> = βB/D<sup>β</sup>, which gives</p>' +
              '<div class="eq">N<sub>opt</sub> ∝ C<sup>β/(α+β)</sup> ≈ C<sup>0.51</sup>, &nbsp; D<sub>opt</sub> ∝ C<sup>α/(α+β)</sup> ≈ C<sup>0.49</sup></div>' +
              '<p>with α = 0.348 and β = 0.366 (the replication fit; the constants printed in the original paper, α = 0.34 and β = 0.28, fit its own data poorly, and the paper’s estimated exponents were 0.46 and 0.54): parameters and tokens should grow almost in proportion, at about 20 tokens per parameter. Llama 3 70B trains on 15 T tokens, about 210 tokens per parameter, more than ten times the Chinchilla ratio, on purpose.</p></details>' +
              '<ol><li><b>Pretrain</b>: cross-entropy on web, code, books, synthetic data.</li></ol>'
          },
          {
            say: 'Mid training then adds long context, code and math with higher quality data. Supervised fine tuning teaches the chat template and the tool call format on curated example trajectories.',
            card: { tag: 'HOW IT WORKS', title: 'Stages that teach format', body: 'Pretraining gives knowledge. Mid-training and SFT teach roles, tool calls, long documents and stopping.' },
            deep: '<ol start="2"><li><b>Mid-train / annealing</b>: high-quality mixes, long-context extension (RoPE rescaling), reasoning data.</li>' +
              '<li><b>SFT</b>: chat template, tool-call format, trajectories.</li></ol>' +
              '<p>These stages use orders of magnitude fewer tokens than pretraining (billions rather than trillions) yet decide how the model behaves as an agent: which tool it calls, how it recovers from an error, when it stops.</p>'
          },
          {
            say: 'Finally, preference optimisation and reinforcement learning on verifiable, multi step tasks turn a next token predictor into a reliable agent. The finished weights are then frozen and used for every token.',
            card: { tag: 'STATE OF THE ART', title: 'Verifiable rewards', body: 'Reward what can be checked: tests pass, the tool call parses, the answer matches. GRPO-style RL does the rest.' },
            deep: '<ol start="4"><li><b>Preference + RL</b>: DPO/RLHF for style and safety; RLVR (e.g. GRPO) on verifiable math, code and multi-step tool tasks.</li></ol>' +
              '<p>The outcome is one tensor file θ: 141 GB in BF16. Everything upstream of this chamber (agents, plans, tools) is software around a frozen function of this shape. The training chamber shows the loop in detail.</p>'
          },
          {
            say: 'Every glowing part of this chamber opens: tokenization, the transformer block, attention, decoding, and training. Click any of them to go deeper.',
            card: { tag: 'TRY IT', title: 'Zoom into any component', body: 'Dashed rings mark five child chambers: Tokenization, Transformer Block, Attention, Decoding, Training.' },
            deep: '<div class="note">Zoom targets: Tokenization · Transformer Block · Attention · Decoding · Training.</div>' +
              '<p>Suggested order for a first pass: <i>Tokenization &amp; Embeddings</i> (what goes in), <i>The Transformer Block</i> (what happens to it), <i>Attention</i> (how positions mix and how the KV cache arises), <i>Decoding</i> (what comes out) and <i>Training</i> (where the weights come from).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: pretraining */
          var g = ctx.group();
          swapRowC(ctx, S, g);
          ctx.rect(60, 604, 1000, 272, { rx: 12, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha('lime', 0.45), parent: g });
          ctx.text(80, 628, 'TRAINING PIPELINE   produces θ once, used for every token', { size: 13, font: 'mono', weight: 700, color: 'lime', parent: g, spacing: 1 });
          var stages = [['Pretrain', '15T tokens · CE', 'lime'], ['Mid-train', 'long ctx · code', 'lime'], ['SFT', 'chat · tool format', 'teal'], ['RL', 'RLHF · RLVR', 'teal']];
          function stageNode(i) {
            return ctx.node({ x: 180 + i * 225, y: 700, w: 176, h: 64, title: stages[i][0], sub: stages[i][1], color: stages[i][2], titleSize: 15, subSize: 11, parent: g });
          }
          S.trainNodes = [stageNode(0)];
          var flops = ctx.para(100, 790, ['6ND ≈ 6.4·10²⁴ FLOP for 70B × 15T tokens', 'reported ≈ 7M H100-hours (Llama 3.1 70B)'], { size: 12, font: 'mono', color: 'dim', lh: 22, parent: g });
          /* Chinchilla-style parametric fit (Besiroglu et al. replication constants) L(N,D) = E + A/N^a + B/D^b at N = 70.6B, D on a log axis */
          var lossFn = function (lg) { return 1.82 + 482.01 / Math.pow(70.6e9, 0.3478) + 2085.43 / Math.pow(Math.pow(10, lg), 0.3658); };
          var lp = ctx.group({ parent: g });
          S.lossPlot = ctx.plot(640, 786, 380, 66, lossFn, { xDomain: [10.5, 13.3], yDomain: [1.8, 2.35], color: 'lime', sw: 2, parent: lp, xLabel: 'tokens D (log) → 15T', yLabel: '' });
          ctx.text(648, 778, 'loss L(N=70.6B, D) = E + A/N^α + B/D^β  (replication fit)', { size: 11, font: 'mono', color: 'lime', parent: lp });
          var pEnd = S.lossPlot.toPx(Math.log10(15e12), lossFn(Math.log10(15e12)));
          var lDot = ctx.circle(pEnd.x, pEnd.y, 4, { fill: 'lime', parent: lp, glow: true });
          ctx.text(pEnd.x - 6, pEnd.y - 12, 'L ≈ ' + lossFn(Math.log10(15e12)).toFixed(2), { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: lp });
          ctx.reveal(g, { from: 'up' });
          return ctx.reveal(S.lossPlot.curve, { from: 'draw', dur: 1000, delay: 300 }).then(function () {
            return ctx.pulse(lDot, { color: 'lime', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: mid-training and supervised fine-tuning */
            S.trainNodes.push(stageNode(1), stageNode(2));
            var links = [ctx.link(S.trainNodes[0], S.trainNodes[1], { color: 'lime', parent: g }), ctx.link(S.trainNodes[1], S.trainNodes[2], { color: 'lime', parent: g })];
            S.trainLinks = links;
            return Promise.all([ctx.reveal([S.trainNodes[1], S.trainNodes[2]], { from: 'left', stagger: 250 }), ctx.reveal(links, { from: 'draw', delay: 300, stagger: 250 })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: reinforcement learning, then the weights are handed to the model */
            S.trainNodes.push(stageNode(3));
            var l3 = ctx.link(S.trainNodes[2], S.trainNodes[3], { color: 'lime', parent: g });
            return Promise.all([ctx.reveal(S.trainNodes[3], { from: 'left' }), ctx.reveal(l3, { from: 'draw', delay: 300 })]).then(function () {
              S.thetaLink = ctx.path('M855,668 C855,600 600,590 600,512', { stroke: 'lime', sw: 1.8, dash: '6 5', arrow: true, parent: g });
              S.thetaLbl = ctx.label(736, 590, 'θ (weights)', { color: 'lime', size: 11, bg: '#0a1224', parent: g });
              S.trainGhost = ctx.node({ x: 518, y: 714, w: 920, h: 100, kind: 'ghost', color: 'lime', parent: g });
              ctx.hotspot(S.trainGhost, 'training');
              return Promise.all([ctx.reveal(S.thetaLink, { from: 'draw', dur: 900 }), ctx.reveal(S.thetaLbl, { delay: 500 }), ctx.reveal(S.trainGhost, { delay: 300 })]);
            }).then(function () {
              return ctx.packet(S.thetaLink, { color: 'lime', dur: 900, label: 'θ' });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the five doors to deeper chambers */
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
            ctx.reveal(sm, { from: 'right' });
            var targets = [S.tokGhost, S.stack, S.attnChip, S.sampler, S.trainGhost];
            return ctx.wait(500).then(function () {
              return targets.reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, { color: 'amber', dur: 450 }); }); }, Promise.resolve());
            });
          });
        }
      }
    ]
  });
})();
