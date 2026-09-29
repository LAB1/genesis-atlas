/* L2 — Decoding & Structured Output. Logits → temperature → truncation → penalties → grammar mask → sample;
 * beam search; XGrammar-style masks; speculative decoding with exact rejection sampling; EAGLE / Medusa / MTP.
 * Beat format: every step is split into beats (say + card + deep + a gated animation segment). */
(function () {
  var Z = [4.1, 3.3, 2.9, 2.4, 2.1, 1.9, 1.5, 1.2, 0.9, 0.6];
  var TOK = ['ice', 'moon', 'surface', 'ridge', 'crater', 'snow', 'plain', 'dust', 'rocks', 'horizon'];
  var CNT = [2, 1, 0, 0, 0, 0, 0, 0, 0, 0];
  var TS = [0.2, 0.5, 0.7, 1.0, 1.5];
  var FILT = [['none', 'none'], ['topk', 'top-k 5'], ['topp', 'top-p .9'], ['minp', 'min-p .15']];
  var BX0 = 110, BW = 64, BG = 92, BASE = 610, BH = 380;

  function nb(lines) { return lines.map(function (s) { return s.replace(/^ +/, function (m) { return '\u00a0'.repeat(m.length); }); }); }
  function hide(list) { [].concat(list).forEach(function (e) { if (e) e.setAttribute('opacity', 0); }); }
  function panel(ctx, x, y, w, h, col, parent) {
    return ctx.rect(x, y, w, h, { rx: 12, fill: 'rgba(7,12,26,0.93)', stroke: ctx.alpha(col, 0.5), sw: 1.2, parent: parent });
  }
  function head(ctx, x, y, str, col, parent, anchor) {
    return ctx.text(x, y, str, { size: 13, font: 'mono', weight: 600, color: col, parent: parent, anchor: anchor || 'start', spacing: 1.2 });
  }
  /* token chip, x = left edge; returns group with .w */
  function chip(ctx, x, y, str, col, parent, o) {
    o = o || {};
    var size = o.size || 14, w = o.w || Math.max(22, str.length * size * 0.6 + 14);
    var g = ctx.group({ parent: parent });
    g.bg = ctx.rect(x, y - (size + 10) / 2, w, size + 10, { rx: 5, fill: ctx.alpha(col, o.bgA === undefined ? 0.14 : o.bgA), stroke: ctx.alpha(col, 0.8), sw: 1, dash: o.dash, parent: g });
    g.tx = ctx.text(x + w / 2, y + 0.5, str, { size: size, font: 'mono', color: o.tc || col, anchor: 'middle', parent: g });
    g.w = w;
    return g;
  }
  /* clickable button */
  function btn(ctx, x, y, w, str, col, parent, onClick) {
    var g = ctx.group({ parent: parent });
    g.bg = ctx.rect(x, y - 15, w, 30, { rx: 15, fill: ctx.alpha(col, 0.08), stroke: ctx.alpha(col, 0.5), sw: 1.2, parent: g });
    g.tx = ctx.text(x + w / 2, y + 0.5, str, { size: 13, font: 'mono', color: col, anchor: 'middle', parent: g });
    g.style.cursor = 'pointer';
    g.addEventListener('click', function (ev) { ev.stopPropagation(); onClick(); });
    g.setOn = function (on) {
      g.bg.setAttribute('fill', ctx.alpha(col, on ? 0.35 : 0.08));
      g.bg.setAttribute('stroke', ctx.alpha(col, on ? 1 : 0.5));
      g.tx.setAttribute('font-weight', on ? 700 : 400);
    };
    return g;
  }

  /* ---- distribution model for the interactive chart ---- */
  function compute(S) {
    var z = Z.map(function (v, i) { return S.pen ? v - 0.3 * CNT[i] - (CNT[i] > 0 ? 0.7 : 0) : v; });
    var m = Math.max.apply(null, z);
    var e = z.map(function (v) { return Math.exp((v - m) / S.T); });
    var sum = e.reduce(function (a, b) { return a + b; }, 0);
    var p = e.map(function (v) { return v / sum; });
    var order = p.map(function (v, i) { return i; }).sort(function (a, b) { return p[b] - p[a]; });
    var keep = p.map(function () { return true; });
    if (S.filt === 'topk') { keep = p.map(function () { return false; }); order.slice(0, 5).forEach(function (i) { keep[i] = true; }); }
    if (S.filt === 'topp') {
      keep = p.map(function () { return false; });
      var c = 0;
      for (var k = 0; k < order.length; k++) { keep[order[k]] = true; c += p[order[k]]; if (c >= 0.9) break; }
    }
    if (S.filt === 'minp') { var pm = p[order[0]]; keep = p.map(function (v) { return v >= 0.15 * pm; }); }
    var ks = 0; p.forEach(function (v, i) { if (keep[i]) ks += v; });
    var q = p.map(function (v, i) { return keep[i] ? v / ks : 0; });
    var H = 0; q.forEach(function (v) { if (v > 0) H -= v * Math.log(v) / Math.LN2; });
    return { z: z, p: p, q: q, keep: keep, order: order, H: H, n: keep.filter(Boolean).length, top: order[0] };
  }

  function drawDeco(ctx, S, r) {
    while (S.deco.firstChild) S.deco.removeChild(S.deco.firstChild);
    if (S.filt === 'topk') {
      var x = BX0 + 5 * BG - (BG - BW) / 2;
      ctx.line(x, 250, x, BASE + 4, { color: 'amber', sw: 1.6, dash: '6 5', parent: S.deco });
      ctx.text(x + 8, 262, 'k = 5: fixed count', { size: 13, font: 'mono', color: 'amber', parent: S.deco });
    } else if (S.filt === 'topp') {
      var c = 0, pts = [[BX0 - 10, BASE]];
      r.order.forEach(function (i) { c += r.p[i]; pts.push([BX0 + i * BG + BW, BASE - c * BH]); });
      ctx.poly(pts, { stroke: 'cyan', sw: 1.8, closed: false, parent: S.deco });
      ctx.line(BX0 - 10, BASE - 0.9 * BH, BX0 + 9 * BG + BW + 8, BASE - 0.9 * BH, { color: 'cyan', sw: 1.2, dash: '5 5', parent: S.deco });
      ctx.text(BX0 + 9 * BG + BW + 8, BASE - 0.9 * BH - 12, 'cumulative mass = 0.9', { size: 12, font: 'mono', color: 'cyan', anchor: 'end', parent: S.deco });
    } else if (S.filt === 'minp') {
      var thr = 0.15 * r.p[r.top];
      ctx.line(BX0 - 10, BASE - thr * BH, BX0 + 9 * BG + BW + 8, BASE - thr * BH, { color: 'violet', sw: 1.6, dash: '6 5', parent: S.deco });
      ctx.text(BX0 + 9 * BG + BW + 8, 262, 'keep p ≥ 0.15 × p_max = ' + thr.toFixed(3) + ' (dashed)', { size: 12, font: 'mono', color: 'violet', anchor: 'end', parent: S.deco });
    }
  }

  function update(ctx, S, dur) {
    var r = compute(S);
    var from = S.bar.map(function (b) { return parseFloat(b.getAttribute('height')); });
    S.bar.forEach(function (b, i) {
      var col = !r.keep[i] ? '#3a4763' : (i === r.top ? ctx.C.lime : ctx.C.amber);
      b.setAttribute('fill', ctx.alpha(col, r.keep[i] ? 0.55 : 0.25));
      b.setAttribute('stroke', col);
      b.setAttribute('stroke-dasharray', r.keep[i] ? '' : '4 3');
    });
    drawDeco(ctx, S, r);
    S.zLab.forEach(function (t, i) {
      t.textContent = 'z=' + r.z[i].toFixed(1);
      t.setAttribute('fill', Math.abs(r.z[i] - Z[i]) > 1e-9 ? ctx.C.orange : ctx.C.dim);
    });
    S.tH.textContent = 'H = ' + r.H.toFixed(2) + ' bits';
    S.tN.textContent = 'kept ' + r.n + ' / 10 · p(top) = ' + r.q[r.top].toFixed(2);
    S.tS.textContent = 'T = ' + S.T.toFixed(1) + (S.filt !== 'none' ? ' · ' + FILT.filter(function (f) { return f[0] === S.filt; })[0][1] : '') + (S.pen ? ' · penalties' : '');
    if (S.tBtn) S.tBtn.forEach(function (b, i) { b.setOn(Math.abs(TS[i] - S.T) < 1e-6); });
    if (S.fBtn) S.fBtn.forEach(function (b, i) { b.setOn(FILT[i][0] === S.filt); });
    if (S.pBtn) S.pBtn.forEach(function (b, i) { b.setOn((i === 1) === !!S.pen); });
    return ctx.tween(dur === undefined ? 600 : dur, function (t) {
      S.bar.forEach(function (b, i) {
        var h = from[i] + (r.p[i] * BH - from[i]) * t;
        b.setAttribute('height', Math.max(0, h)); b.setAttribute('y', BASE - h);
        S.val[i].setAttribute('y', BASE - h - 12);
      });
    }, 'inOut').then(function () {
      S.val.forEach(function (v, i) {
        v.textContent = r.keep[i] ? r.q[i].toFixed(2) : '✕';
        v.setAttribute('fill', r.keep[i] ? (i === r.top ? ctx.C.lime : ctx.C.text) : ctx.C.dim);
      });
    });
  }

  Atlas.register({
    id: 'decoding',
    refs: [
      'Holtzman et al., <i>The Curious Case of Neural Text Degeneration</i> (nucleus sampling), ICLR 2020',
      'Nguyen et al., <i>Turning Up the Heat: Min-p Sampling for Creative and Coherent LLM Outputs</i>, ICLR 2025',
      'Willard &amp; Louf, <i>Efficient Guided Generation for Large Language Models</i> (Outlines), arXiv 2023',
      'Dong et al., <i>XGrammar: Flexible and Efficient Structured Generation Engine for Large Language Models</i>, MLSys 2025',
      'Leviathan, Kalman &amp; Matias, <i>Fast Inference from Transformers via Speculative Decoding</i>, ICML 2023',
      'Chen et al., <i>Accelerating Large Language Model Decoding with Speculative Sampling</i>, arXiv 2023',
      'Cai et al., <i>Medusa: Simple LLM Inference Acceleration Framework with Multiple Decoding Heads</i>, ICML 2024',
      'Li et al., <i>EAGLE: Speculative Sampling Requires Rethinking Feature Uncertainty</i>, ICML 2024',
      'Li et al., <i>EAGLE-3: Scaling up Inference Acceleration of Large Language Models via Training-Time Test</i>, 2025',
      'DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i>, 2024',
      'Tam et al., <i>Let Me Speak Freely? A Study on the Impact of Format Restrictions on Large Language Model Performance</i>, EMNLP 2024 Industry Track',
      'Schaeffer et al., <i>Min-p, Max Exaggeration: A Critical Analysis of Min-p Sampling in Language Models</i>, arXiv 2025'
    ],
    steps: [
      /* 1 ------------------------------------------------------------------ */
      {
        title: 'Logits to a choice',
        beats: [
          {
            say: 'Every token an agent emits comes out of the same funnel. Here the director is writing a logline, and the word after glowing is still unknown.',
            card: { tag: 'KEY IDEA', title: 'One funnel for every token', body: 'Prose, tool-call JSON or code: all of it is produced one token at a time by the <b>same</b> loop of score, filter, sample and append.' },
            deep: '<div class="eq">z = W<sub>U</sub> h<sub>L</sub> ∈ ℝ<sup>V</sup>, &nbsp; p = softmax(z / T), &nbsp; x<sub>t+1</sub> ~ p</div>' +
              '<p>This is the autoregressive factorization p(x<sub>1:n</sub>) = Π<sub>t</sub> p(x<sub>t</sub> | x<sub>&lt;t</sub>) executed one factor at a time. Every token an agent emits, whether prose, JSON or code, goes through this single loop; only the logit processors in the middle differ.</p>'
          },
          {
            say: 'The last hidden state, a vector of about eight thousand numbers, is multiplied by the unembedding matrix to give one score, a logit, for each of roughly a hundred and twenty eight thousand vocabulary entries.',
            card: { tag: 'NUMBERS', title: 'One score per vocabulary entry', stat: { v: '128,256', l: 'one score per vocabulary entry (Llama 3), from an 8,192-d hidden state' } },
            deep: '<p>Llama-3-70B: d = 8192, V = 128,256, so W<sub>U</sub> alone is 1.05 B parameters (8192 × 128,256). Logits are computed in fp32 for the softmax, subtracting the max for stability.</p>' +
              '<details><summary>Go deeper</summary><p>Shapes: h ∈ ℝ<sup>B×d</sup>, W<sub>U</sub> ∈ ℝ<sup>d×V</sup>, logits ∈ ℝ<sup>B×V</sup>. At batch 1 this is a GEMV that reads 2.1&nbsp;GB of bf16 weights, about 1.5% of the model, and only the last position is needed in decode. Llama 3 does not tie W<sub>U</sub> to the input embedding.</p></details>'
          },
          {
            say: 'A small pipeline of logit processors then reshapes those scores: a grammar mask, penalties, temperature and truncation.',
            card: { tag: 'HOW IT WORKS', title: 'Order matters in the pipeline', body: 'Mask first, so truncation can never keep only illegal tokens. Then penalties, temperature, and finally top-k, top-p or min-p.' },
            deep: '<p>Processor order in vLLM V1: <code>grammar bitmask → logit bias / penalties → ÷T → min-p → top-k / top-p → sample</code>. The mask must precede truncation: otherwise top-p could keep only illegal tokens, and masking afterwards would leave an empty or mis-normalized set.</p>' +
              '<p>Each processor is an elementwise or sort/select operation over V = 128k floats per sequence: microseconds on a GPU.</p>'
          },
          {
            say: 'A softmax turns the scores into probabilities, and one token is sampled from them. Here the winner is the word ice.',
            card: { tag: 'HOW IT WORKS', title: 'Sampling without a sort', body: 'The <b>Gumbel-max trick</b> draws an exact sample as an argmax over z/T plus Gumbel noise, with no normalization or cumulative sum.' },
            deep: '<p>Sampling itself is often done with the <b>Gumbel-max trick</b>: <code>argmax(z/T + g)</code>, g ~ Gumbel(0,1), which is an exact sample from softmax(z/T).</p>' +
              '<details><summary>Go deeper</summary><p>With g<sub>i</sub> = −log(−log u<sub>i</sub>), P(argmax<sub>i</sub>(z<sub>i</sub>/T + g<sub>i</sub>) = j) = e<sup>z<sub>j</sub>/T</sup> / Σ<sub>i</sub> e<sup>z<sub>i</sub>/T</sup>. It fuses cleanly into a GPU kernel and avoids materializing the probability vector.</p></details>'
          },
          {
            say: 'The sampled token is appended to the context, and the whole model runs again. The processors cost microseconds, but every single token needs a full forward pass.',
            card: { tag: 'NUMBERS', title: 'The forward pass is the bill', stat: { v: '≈ 21 ms', l: 'per token at batch 1: each of 2 H100s streams 70 GB at 3.35 TB/s' },
              more: '<p>At batch <i>B</i> the weights are read once per step but used <i>B</i> times, so arithmetic intensity is about <i>B</i> FLOP/byte. An H100 needs roughly 295 FLOP/byte to saturate its tensor cores, so the weight matmuls only become compute-bound near <i>B</i> ≈ 300. In practice the KV-cache reads, which scale with <i>B</i>, keep attention memory-bound far beyond that.</p>' },
            deep: '<p><b>Cost asymmetry</b>: the processors cost microseconds; the forward pass costs milliseconds. At batch 1, every token must stream all weights from HBM:</p>' +
              '<div class="eq">t<sub>token</sub> ≳ W<sub>bytes</sub> / (n<sub>gpu</sub> · BW) = 140 GB / (2 × 3.35 TB/s) ≈ 21 ms</div>' +
              '<p><span class="muted">Llama-3-70B in bf16 is about 140 GB; 3.35 TB/s is the HBM3 bandwidth of an H100 SXM.</span></p>' +
              '<p>That memory-bound regime is why batching, quantization and speculative decoding (later steps) matter so much for agents that emit thousands of tokens per turn.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          S.s1 = ctx.group();
          var G = S.s1;
          var ctxT = ['The', 'fox', 'astronaut', 'steps', 'onto', 'the', 'glowing'];
          var x = 60;
          S.ctxChips = ctxT.map(function (t) { var c = chip(ctx, x, 200, t, 'cyan', G); x += c.w + 8; return c; });
          S.nextChip = chip(ctx, x, 200, '?', 'lime', G, { dash: '4 3', w: 70 });
          S.nextX = x;
          S.ctxCap = ctx.text(60, 236, 'context (director agent writing the logline)', { size: 12, font: 'mono', color: 'dim', parent: G });
          /* h × W_U = z */
          var rg = ctx.rng(4);
          S.mmA = ctx.group({ parent: G });
          S.h = ctx.vector(80, 290, 12, { cell: 14, gap: 3, cmap: 'diverge', values: function () { return rg() * 2 - 1; }, parent: S.mmA });
          ctx.text(87, 520, 'h', { size: 16, font: 'mono', color: 'white', anchor: 'middle', parent: S.mmA });
          ctx.text(87, 540, 'd = 8192', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.mmA });
          ctx.text(125, 380, '×', { size: 24, color: 'dim', anchor: 'middle', parent: S.mmA });
          S.W = ctx.matrix(150, 290, 12, 32, { cell: 12, gap: 2, cmap: 'diverge', values: function () { return (rg() * 2 - 1) * 0.7; }, parent: S.mmA });
          ctx.text(374, 480, 'W_U: d × V = 8,192 × 128,256  (1.05 B params)', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', parent: S.mmA });
          S.mmB = ctx.group({ parent: G });
          ctx.text(615, 380, '=', { size: 24, color: 'dim', anchor: 'middle', parent: S.mmB });
          S.zG = ctx.group({ parent: S.mmB });
          for (var i = 0; i < 64; i++) {
            var v = rg() * 0.25 + (i === 17 ? 0.75 : 0) + (i === 41 ? 0.5 : 0) + (i === 5 ? 0.42 : 0) + (i === 52 ? 0.33 : 0);
            ctx.rect(645 + i * 7, 456 - v * 160, 5, v * 160, { rx: 1, fill: ctx.alpha(i === 17 ? 'lime' : 'amber', 0.7), parent: S.zG });
          }
          ctx.line(642, 457, 1096, 457, { color: 'faint', parent: S.zG });
          ctx.text(870, 480, 'z: V = 128,256 logits (fp32)', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', parent: S.mmB });
          ctx.text(768, 282, 'ice', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: S.zG });
          /* processor pipeline */
          var stages = [['logits z', 'amber'], ['grammar mask', 'pink'], ['penalties', 'orange'], ['÷ T', 'amber'], ['top-k / p / min-p', 'violet'], ['softmax', 'amber'], ['sample', 'lime']];
          S.st = stages.map(function (s, k) {
            return ctx.node({ x: 130 + k * 212, y: 600, w: 188, h: 52, title: s[0], color: s[1], titleSize: 14, kind: 'pill', glow: false, parent: G });
          });
          S.pl = [];
          for (var k = 0; k < 6; k++) S.pl.push(ctx.link(S.st[k], S.st[k + 1], { from: 'r', to: 'l', color: ctx.alpha('amber', 0.7), parent: G }));
          S.zL = ctx.path('M870,500 C870,540 130,540 130,574', { stroke: ctx.alpha('amber', 0.6), sw: 1.4, arrow: true, parent: G });
          /* sampled distribution preview */
          S.dp = ctx.group({ parent: G });
          panel(ctx, 1140, 250, 400, 236, 'lime', S.dp);
          head(ctx, 1160, 274, 'p = softmax(z / T) · top-5', 'lime', S.dp);
          S.dpRows = [['ice', 0.42], ['moon', 0.19], ['surface', 0.13], ['ridge', 0.08], ['crater', 0.06]].map(function (r, k2) {
            var y = 310 + k2 * 34, g = ctx.group({ parent: S.dp });
            ctx.text(1160, y, r[0], { size: 13, font: 'mono', color: 'white', parent: g });
            ctx.rect(1250, y - 9, r[1] * 500, 18, { rx: 3, fill: ctx.alpha(k2 === 0 ? 'lime' : 'amber', 0.55), stroke: k2 === 0 ? 'lime' : 'amber', sw: 1, parent: g });
            ctx.text(1250 + r[1] * 500 + 8, y, r[1].toFixed(2), { size: 12, font: 'mono', color: 'text', parent: g });
            return g;
          });
          S.upP = ctx.path('M1402,574 L1402,492', { stroke: 'lime', sw: 1.6, arrow: true, parent: G });
          S.upT = ctx.text(1412, 536, 'x ~ p', { size: 12, font: 'mono', color: 'lime', parent: G });
          S.loopP = ctx.path('M1136,268 C900,268 760,200 ' + (S.nextX + 76) + ',200', { stroke: 'lime', sw: 1.6, dash: '5 5', arrow: true, parent: G });
          S.loopT = ctx.text(1000, 226, 'append → run again', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: G });
          S.bot1 = ctx.text(800, 700, 'processors: microseconds on the logits  ·  forward pass: milliseconds (reads every weight + the KV cache)', { size: 14, font: 'mono', color: 'text', anchor: 'middle', parent: G });
          S.bot2 = ctx.text(800, 730, 'then append the token and run the whole network again: one forward pass per generated token', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          hide(S.ctxChips); hide([S.nextChip, S.ctxCap, S.mmA, S.mmB, S.dp, S.upP, S.upT, S.loopP, S.loopT, S.bot1, S.bot2, S.zL]);
          hide(S.st); hide(S.pl);
          /* beat 0: the context and the missing word */
          return ctx.reveal(S.ctxChips.concat([S.nextChip]), { from: 'down', stagger: 70, dur: 350 }).then(function () {
            ctx.reveal(S.ctxCap, { dur: 300 });
            return ctx.pulse(S.nextChip, { color: 'lime', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: hidden state times the unembedding matrix */
            return ctx.reveal(S.mmA, { from: 'left', dur: 600 }).then(function () {
              return ctx.reveal(S.mmB, { from: 'left', dur: 600 });
            }).then(function () { return ctx.pulse(S.zG, { color: 'amber', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the logit-processor pipeline */
            return ctx.reveal(S.st, { from: 'up', stagger: 90 }).then(function () {
              return ctx.reveal(S.pl.concat([S.zL]), { from: 'draw', stagger: 60 });
            }).then(function () {
              return ctx.packet(S.zL, { color: 'amber', dur: 600 });
            }).then(function () {
              var chain = Promise.resolve();
              S.pl.forEach(function (l) { chain = chain.then(function () { return ctx.packet(l, { color: 'amber', dur: 260 }); }); });
              return chain;
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: softmax and a sampled token */
            return Promise.all([ctx.reveal(S.dp, { from: 'right' }), ctx.reveal(S.upP, { from: 'draw', delay: 200 }), ctx.reveal(S.upT, { delay: 300 })]).then(function () {
              return ctx.packet(S.upP, { color: 'lime', dur: 400 });
            }).then(function () { return ctx.pulse(S.dpRows[0], { color: 'lime', times: 2, dur: 500 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: append and run again */
            return Promise.all([ctx.reveal(S.loopP, { from: 'draw' }), ctx.reveal(S.loopT, { delay: 300 })]).then(function () {
              return ctx.packet(S.loopP, { color: 'lime', dur: 900, label: 'ice' });
            }).then(function () {
              S.nextChip.tx.textContent = 'ice';
              S.nextChip.bg.removeAttribute('stroke-dasharray');
              ctx.reveal([S.bot1, S.bot2], { from: 'up', stagger: 200 });
              return ctx.pulse(S.nextChip, { color: 'lime', dur: 500 });
            });
          });
        }
      },
      /* 2 ------------------------------------------------------------------ */
      {
        title: 'Temperature',
        beats: [
          {
            say: "Temperature divides every logit before the softmax. Watch the bars: at temperature one, we sample the model's own distribution, and ice leads with forty two percent.",
            card: { tag: 'KEY IDEA', title: 'Temperature rescales the gaps', body: 'Dividing logits by T turns every gap Δz into a probability ratio of <code>e^(Δz/T)</code>. T = 1 is the raw model distribution.' },
            deep: '<div class="eq">p<sub>i</sub>(T) = exp(z<sub>i</sub>/T) / Σ<sub>j</sub> exp(z<sub>j</sub>/T), &nbsp; H = −Σ p<sub>i</sub> log<sub>2</sub> p<sub>i</sub></div>' +
              '<p>Limits: T → 0 gives argmax (greedy); T → ∞ gives uniform. Temperature rescales logit <i>gaps</i>: a gap Δz becomes a probability ratio e<sup>Δz/T</sup>. Here ice (z = 4.1) beats moon (3.3) by Δz = 0.8, a ratio of e<sup>0.8</sup> ≈ 2.2 at T = 1.</p>'
          },
          {
            say: 'Lower it to point two, and the distribution collapses onto the top token, almost greedy decoding.',
            card: { tag: 'NUMBERS', title: 'Nearly greedy', stat: { v: '0.98', l: 'p(ice) at T = 0.2, up from 0.42; entropy drops 2.54 → 0.16 bits' } },
            deep: '<table><tr><th>T</th><th>p(ice)</th><th>H (bits)</th></tr>' +
              '<tr><td>0.2</td><td>0.98</td><td>0.16</td></tr><tr><td>1.0</td><td>0.42</td><td>2.54</td></tr><tr><td>1.5</td><td>0.30</td><td>2.95 (max log<sub>2</sub>10 = 3.32)</td></tr></table>' +
              '<p><span class="muted">(over the 10 candidates shown; the other ~128k tokens hold the remaining tail mass)</span></p>' +
              '<p>At T = 0.2 the gap between ice and moon (Δz = 0.8) becomes a ratio of e<sup>0.8/0.2</sup> = e<sup>4</sup> ≈ 55 to 1, which is why ice takes 98% of the mass and the entropy collapses by a factor of 16.</p>'
          },
          {
            say: 'Raise it to one point five, and the tail fattens, so rarer words like crater or horizon get real probability.',
            card: { tag: 'TRADE-OFF', title: 'Diversity costs coherence', body: 'Hot sampling gives rare words real mass. Across a 128k vocabulary the tail adds up: more variety, more chances to derail a sentence.' },
            deep: '<ul><li><b>Tool-call arguments</b>: T ≈ 0–0.3. <b>Script / creative text</b>: 0.7–1.0. Reasoning models are usually run at a fixed recommended setting (e.g. DeepSeek-R1: T = 0.6 recommended, top-p 0.95 in its evaluations).</li>' +
              '<li>At T = 1.5 the top token drops from 0.42 to 0.30 while <i>horizon</i>, the least likely candidate, rises from 0.013 to 0.029: a 2× gain for the tail, a 30% loss for the head.</li></ul>'
          },
          {
            say: 'The entropy readout on the right measures how many choices are effectively in play. Click the temperature chips to try it yourself.',
            card: { tag: 'TRY IT', title: 'Click a temperature chip', body: 'Watch the bars and the entropy readout. Tool arguments want T near 0 to 0.3; scripts and creative text 0.7 to 1.0.' },
            deep: '<p>Entropy H = −Σ p log<sub>2</sub> p is the number of bits of surprise in the next choice; 2<sup>H</sup> is the <i>effective</i> number of equally likely options (≈ 5.8 at T = 1, ≈ 1.1 at T = 0.2).</p>' +
              '<div class="note">T = 0 is not bit-reproducible in production: batch-dependent reduction order in kernels changes logits slightly. Batch-invariant kernels fix this at some throughput cost.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.s1, 400);
          S.T = 1.0; S.filt = 'none'; S.pen = false;
          S.ch = ctx.group();
          panel(ctx, 60, 165, 990, 520, 'amber', S.ch);
          head(ctx, 80, 190, 'NEXT-TOKEN DISTRIBUTION · "…steps onto the glowing ▁"', 'amber', S.ch);
          ctx.text(1030, 190, 'top-10 of V', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.ch });
          [0.25, 0.5, 0.75, 1].forEach(function (pv) {
            var gy = BASE - pv * BH;
            ctx.line(BX0 - 14, gy, BX0 + 9 * BG + BW + 14, gy, { color: ctx.alpha('#7b8cab', 0.18), sw: 1, dash: '2 6', parent: S.ch });
            ctx.text(BX0 - 18, gy, pv.toFixed(2), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.ch });
          });
          ctx.text(BX0 - 18, BASE, '0', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.ch });
          ctx.line(BX0 - 14, BASE, BX0 + 9 * BG + BW + 14, BASE, { color: 'faint', parent: S.ch });
          S.bar = []; S.val = []; S.tokL = []; S.cntL = []; S.zLab = [];
          TOK.forEach(function (t, i) {
            var x = BX0 + i * BG;
            S.bar.push(ctx.rect(x, BASE, BW, 0, { rx: 4, fill: ctx.alpha('amber', 0.55), stroke: 'amber', sw: 1.2, parent: S.ch }));
            S.val.push(ctx.text(x + BW / 2, BASE - 12, '', { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: S.ch }));
            S.zLab.push(ctx.text(x + BW / 2, 651, 'z=' + Z[i].toFixed(1), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.ch }));
            S.tokL.push(ctx.text(x + BW / 2, 630, t, { size: 14, font: 'mono', color: 'white', anchor: 'middle', parent: S.ch }));
            S.cntL.push(ctx.text(x + BW / 2, 671, 'used ×' + CNT[i], { size: 11, font: 'mono', color: 'orange', anchor: 'middle', parent: S.ch, opacity: 0 }));
          });
          S.deco = ctx.group({ parent: S.ch });
          /* control panel */
          S.ctl = ctx.group();
          panel(ctx, 1080, 165, 480, 520, 'amber', S.ctl);
          head(ctx, 1100, 190, 'TEMPERATURE · click', 'amber', S.ctl);
          S.tBtn = TS.map(function (T, i) {
            return btn(ctx, 1100 + i * 90, 226, 80, 'T ' + T.toFixed(1), 'amber', S.ctl, function () { S.T = T; update(ctx, S, 500); });
          });
          S.tS = ctx.text(1100, 470, '', { size: 13, font: 'mono', color: 'dim', parent: S.ctl });
          S.tH = ctx.text(1100, 510, '', { size: 24, font: 'display', weight: 700, color: 'white', parent: S.ctl });
          S.tN = ctx.text(1100, 545, '', { size: 14, font: 'mono', color: 'text', parent: S.ctl });
          ctx.text(1100, 600, 'p_i = exp(z_i / T) / Σ_j exp(z_j / T)', { size: 14, font: 'mono', color: 'amber', parent: S.ctl });
          ctx.text(1100, 628, 'T→0: greedy argmax · T→∞: uniform', { size: 12, font: 'mono', color: 'dim', parent: S.ctl });
          ctx.text(1100, 652, 'bar labels = final sampling probability', { size: 11, font: 'mono', color: 'dim', parent: S.ctl });
          hide([S.ch, S.ctl]);
          /* beat 0: the model's own distribution at T = 1 */
          ctx.reveal(S.ch, { from: 'up', dur: 500 });
          ctx.reveal(S.ctl, { from: 'right', delay: 200, dur: 500 });
          return update(ctx, S, 800).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: T = 0.2 */
            S.T = 0.2; return update(ctx, S, 900);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: T = 1.5 */
            S.T = 1.5; return update(ctx, S, 900);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: back to 1, and an invitation to play */
            S.T = 1.0;
            return update(ctx, S, 700).then(function () {
              ctx.pulse(S.tH, { color: 'amber', times: 2, dur: 600 });
              return ctx.pulse(S.tBtn[4], { color: 'amber', times: 2, dur: 600 });
            });
          });
        }
      },
      /* 3 ------------------------------------------------------------------ */
      {
        title: 'Top-k, top-p, min-p',
        beats: [
          {
            say: 'Sampling from the full tail is risky: across a hundred thousand tokens, the junk adds up. Truncation samplers cut the tail and renormalize what is left.',
            card: { tag: 'PITFALL', title: 'The tail is not harmless', body: 'Each tail token is unlikely, but ~128k of them together can hold real mass. One bad sample derails a sentence, or a JSON key.' },
            deep: '<div class="eq">q<sub>i</sub> = p<sub>i</sub> · 1[i ∈ S] / Σ<sub>j∈S</sub> p<sub>j</sub></div>' +
              '<p>All truncation samplers share this form: choose a keep-set S, zero everything else and renormalize. They differ only in <i>how S is chosen</i>. Here the five lowest tokens alone hold 13% of the visible mass.</p>'
          },
          {
            say: 'Top k keeps a fixed number of tokens, here five, no matter how confident the model is.',
            card: { tag: 'HOW IT WORKS', title: 'Top-k: a fixed count', body: 'Keep the K largest and renormalize. Simple, but shape-blind: too many tokens when the model is sure, too few when it is unsure.' },
            deep: '<ul><li><b>top-k</b>: keep the K largest. Shape-blind: too many when the distribution is peaked, too few when it is flat.</li>' +
              '<li>Here K = 5 keeps 87% of the mass, so p(ice) rises from 0.42 to 0.48 after renormalization.</li>' +
              '<li>Top-k is invariant to temperature: T rescales logits monotonically, so the ranking, and hence the top K, does not change.</li></ul>'
          },
          {
            say: 'Top p, or nucleus sampling, keeps the smallest set whose probability reaches ninety percent, however many tokens that takes.',
            card: { tag: 'NUMBERS', title: 'The nucleus at 0.9', stat: { v: '6', u: 'tokens', l: 'kept by top-p 0.9 at T = 1 (cumulative mass 0.42 … 0.92)' },
              more: '<p>Other truncation rules: <b>typical sampling</b> (Meister et al., 2023) keeps tokens whose surprise is close to the distribution’s entropy; <b>η-sampling</b> (Hewitt et al., 2022) uses an entropy-dependent probability cutoff; <b>top-a</b> uses a threshold proportional to p<sub>max</sub><sup>2</sup>. Min-p, next, is the simplest member of this adaptive family.</p>' },
            deep: '<ul><li><b>top-p</b> (nucleus; Holtzman et al., 2020): smallest set S with Σ<sub>i∈S</sub> p<sub>i</sub> ≥ P. Here P = 0.9 keeps 6 tokens (cumulative .42, .61, .74, .81, .87, .92).</li>' +
              '<li>The size of the nucleus adapts to the shape of the distribution, unlike top-k; it grows when the model is uncertain.</li></ul>'
          },
          {
            say: "Min p keeps tokens with at least fifteen percent of the top token's probability, so it adapts: when the model is sure, it keeps few, and when the distribution is flat, it keeps more.",
            card: { tag: 'STATE OF THE ART', title: 'Min-p scales with confidence', body: 'Threshold = 0.15 × p(top). Nguyen et al. (ICLR 2025) report it keeps quality at higher temperatures, where top-p degrades.' },
            deep: '<ul><li><b>min-p</b>: keep p<sub>i</sub> ≥ p<sub>min</sub> · max<sub>j</sub> p<sub>j</sub>. With p<sub>min</sub> = 0.15 at T = 1 the threshold is 0.063, so 4 tokens survive.</li>' +
              '<li>It scales with confidence: a sure model (p<sub>max</sub> = 0.98) keeps almost nothing else; a flat one keeps many. That is why it tolerates high temperatures for creative text.</li>' +
              '<li>A 2025 re-analysis (Schaeffer et al.) argues that the original paper’s evidence does not support its claimed gains, so treat min-p as a robust default rather than a free win.</li></ul>'
          },
          {
            say: 'Now raise the temperature to one point five. The flatter distribution makes min p keep more tokens, while top k would still keep exactly five.',
            card: { tag: 'TRY IT', title: 'Combine the chips', body: 'Switch filters at T = 1.5. Min-p grows from 4 to <b>7</b> tokens, top-p from 6 to 8, and top-k stays at 5.' },
            deep: '<p>At T = 1.5 the threshold drops to 0.044 and 7 tokens survive min-p. <b>Order matters</b>: temperature before truncation changes which tokens survive top-p and min-p (top-k is invariant to T).</p>' +
              '<p><b>Kernels</b>: exact top-p needs a sort (or radix select) over 128k logits per sequence per step; FlashInfer uses sorting-free rejection sampling to do top-k/top-p in one fused pass.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.fHead = head(ctx, 1100, 280, 'TRUNCATION · click', 'violet', S.ctl);
          S.fBtn = FILT.map(function (f, i) {
            return btn(ctx, 1100 + i * 112, 316, 104, f[1], 'violet', S.ctl, function () { S.filt = f[0]; update(ctx, S, 400); });
          });
          /* the tail bracket (beat 0 only) */
          S.tail = ctx.group({ parent: S.ch });
          var tx0 = BX0 + 5 * BG - 6, tx1 = BX0 + 9 * BG + BW + 6;
          ctx.line(tx0, 552, tx1, 552, { color: 'orange', sw: 1.6, parent: S.tail });
          ctx.line(tx0, 546, tx0, 558, { color: 'orange', sw: 1.6, parent: S.tail });
          ctx.line(tx1, 546, tx1, 558, { color: 'orange', sw: 1.6, parent: S.tail });
          ctx.text((tx0 + tx1) / 2, 530, 'the tail: 5 of 10 tokens hold 13% of the mass', { size: 13, font: 'mono', color: 'orange', anchor: 'middle', parent: S.tail });
          hide([S.fHead, S.tail]); hide(S.fBtn);
          /* beat 0: the tail is not harmless */
          return Promise.all([ctx.reveal(S.tail, { from: 'up', dur: 500 }), ctx.reveal(S.fHead, { dur: 300 }), ctx.reveal(S.fBtn, { from: 'scale', stagger: 80 })]).then(function () {
            return ctx.pulse(S.tail, { color: 'orange', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: top-k */
            ctx.fade(S.tail, 0, 300);
            S.filt = 'topk'; return update(ctx, S, 500);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: top-p */
            S.filt = 'topp'; return update(ctx, S, 500);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: min-p */
            S.filt = 'minp'; return update(ctx, S, 500);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: a flatter distribution keeps more under min-p */
            S.T = 1.5;
            return update(ctx, S, 800).then(function () { return ctx.pulse(S.tN, { color: 'violet', times: 2, dur: 600 }); });
          });
        }
      },
      /* 4 ------------------------------------------------------------------ */
      {
        title: 'Penalties & beams',
        beats: [
          {
            say: 'Two more knobs. Penalties push down tokens the model has already used, so our logline stops repeating itself.',
            card: { tag: 'HOW IT WORKS', title: 'Penalize what was already said', body: 'A <b>presence</b> penalty subtracts a flat amount once a token has appeared. A <b>frequency</b> penalty subtracts more for every repetition.' },
            deep: '<div class="eq">z<sub>i</sub> ← z<sub>i</sub> − α<sub>freq</sub>·c<sub>i</sub> − α<sub>pres</sub>·1[c<sub>i</sub> &gt; 0] &nbsp; (α<sub>freq</sub> = 0.3, α<sub>pres</sub> = 0.7)</div>' +
              '<p>c<sub>i</sub> counts how often token i already appears in the context. The CTRL-style repetition penalty (θ = 1.2 in the CTRL paper) instead rescales the logit of every token already seen: z ← z/θ if z &gt; 0 else z·θ, the sign-aware form used in common libraries.</p>'
          },
          {
            say: 'Our logline already said ice twice and moon once, so the penalties lower their logits, and surface moves to the top.',
            card: { tag: 'NUMBERS', title: 'Ice loses its lead', stat: { v: '4.1 → 2.8', l: 'logit of ice after penalties; surface (2.9) becomes the mode' } },
            deep: '<p>ice: 4.1 − 0.3·2 − 0.7 = 2.8, moon: 3.3 − 0.3·1 − 0.7 = 2.3, so <i>surface</i> (2.9) becomes the mode.</p>' +
              '<p>Ice loses 1.3 in total (0.6 for two uses plus 0.7 for presence), more than its 1.2 lead over surface, which is why the ranking flips. In vLLM, presence and frequency penalties count only generated tokens, while the repetition penalty also covers the prompt.</p>' +
              '<div class="note">Turn penalties <b>off</b> for JSON and code: braces, quotes and keys repeat by design, and penalizing them corrupts tool calls.</div>'
          },
          {
            say: 'Then beam search, the classic alternative to sampling: keep the three best partial sequences by total log probability, and extend them in lockstep.',
            card: { tag: 'HOW IT WORKS', title: 'Beam search keeps the best B', body: 'Extend every beam with every token, keep the B highest cumulative log probabilities, repeat. Here B = 3; dashed candidates are pruned.',
              more: '<p>Length normalization exists because raw log-probability sums penalize long outputs. Even so, larger beams often find higher-likelihood but <i>worse</i> outputs, the “beam search curse” (Yang et al., 2018): the model\'s likelihood is a poor proxy for quality at the mode of the distribution.</p>' },
            deep: '<p><b>Beam search</b> (width B) maximizes Σ<sub>t</sub> log p(y<sub>t</sub>|y<sub>&lt;t</sub>) / |y|<sup>α</sup> (length normalization, α ≈ 0.6–0.7).</p>' +
              '<p>At each step it scores B × V candidates and keeps the top B. In the tree, the three best two-token prefixes are ice→moon (−1.77), moon→surface (−2.19) and ice→field (−2.25); the dashed candidates (moon→dust at −3.40 and surface→comma at −2.61) are pruned.</p>'
          },
          {
            say: 'It is great for translation and speech recognition, but chat models avoid it. It costs beam width times the compute, cannot stream a stable answer, and drifts toward bland, repetitive text.',
            card: { tag: 'TRADE-OFF', title: 'Why chat models sample', body: 'Beams multiply compute and KV cache by B, cannot stream, and favor bland high-likelihood text. Sample N and verify or vote instead.' },
            deep: '<ul><li>High-likelihood text is unnaturally bland and repetitive (Holtzman et al.); bigger beams can be <i>worse</i>.</li>' +
              '<li>B× KV-cache and compute per step, and the leading hypothesis changes, so it cannot stream token by token.</li>' +
              '<li>RL-tuned models are optimized for sampling; for reasoning, <b>sample N and verify / vote</b> (best-of-N, self-consistency) beats beams.</li>' +
              '<li>Still standard where outputs are short and mode-seeking is right: MT, ASR (Whisper uses beam 5).</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          S.pHead = head(ctx, 1100, 370, 'PENALTIES · click', 'orange', S.ctl);
          S.pBtn = ['off', 'on'].map(function (s, i) {
            return btn(ctx, 1100 + i * 90, 406, 80, s, 'orange', S.ctl, function () { S.pen = i === 1; update(ctx, S, 500); });
          });
          S.T = 1.0; S.filt = 'none';
          /* beam search band */
          S.beam = ctx.group();
          panel(ctx, 60, 698, 1500, 190, 'cyan', S.beam);
          head(ctx, 80, 720, 'BEAM SEARCH · B = 3 · score = Σ log p', 'cyan', S.beam);
          var N = {};
          function bn(id, x, y, t, s, kept) {
            var g = ctx.group({ parent: S.beam });
            var w = Math.max(96, (t + ' ' + s).length * 7.4 + 16);
            ctx.rect(x - w / 2, y - 13, w, 26, { rx: 13, fill: kept ? ctx.alpha('cyan', 0.16) : 'rgba(255,255,255,0.02)', stroke: kept ? 'cyan' : '#3a4763', sw: 1.2, dash: kept ? null : '3 3', parent: g });
            ctx.text(x, y + 0.5, t + '  ' + s, { size: 12, font: 'mono', color: kept ? 'white' : 'dim', anchor: 'middle', parent: g });
            g.setAttribute('opacity', 0);
            N[id] = { g: g, x: x, y: y, w: w };
            return g;
          }
          function be(a, b, kept) {
            var A = N[a], B = N[b];
            var l = ctx.line(A.x + A.w / 2, A.y, B.x - B.w / 2, B.y, { color: kept ? ctx.alpha('cyan', 0.7) : '#3a4763', sw: 1.2, parent: S.beam });
            l.setAttribute('opacity', 0);
            return l;
          }
          var lv = [];
          lv.push([bn('r', 160, 812, '…glowing', '0.00', true)]);
          lv.push([bn('a', 380, 763, 'ice', '−0.87', true), bn('b', 380, 823, 'moon', '−1.67', true), bn('c', 380, 868, 'surface', '−2.07', true)]);
          lv.push([bn('aa', 640, 748, 'moon', '−1.77', true), bn('ab', 640, 778, 'field', '−2.25', true), bn('ba', 640, 808, 'surface', '−2.19', true),
            bn('bb', 640, 838, 'dust', '−3.40', false), bn('ca', 640, 868, ',', '−2.61', false)]);
          lv.push([bn('aaa', 900, 748, ',', '−2.10', true), bn('aba', 900, 778, '.', '−2.66', true), bn('baa', 900, 808, '.', '−2.52', true)]);
          var ed = [be('r', 'a', 1), be('r', 'b', 1), be('r', 'c', 1), be('a', 'aa', 1), be('a', 'ab', 1), be('b', 'ba', 1), be('b', 'bb', 0), be('c', 'ca', 0), be('aa', 'aaa', 1), be('ba', 'baa', 1), be('ab', 'aba', 1)];
          ed.forEach(function (e) { S.beam.insertBefore(e, S.beam.children[2]); });
          var edLv = [ed.slice(0, 3), ed.slice(3, 8), ed.slice(8, 11)];
          var why = ['• B× compute + KV cache per step', '• no stable prefix → cannot stream', '• mode-seeking → bland, repetitive', '• used for MT / ASR (Whisper: beam 5)', '• chat / agents: sample (+ verify N)'];
          S.why = why.map(function (w, k) {
            return ctx.text(1060, 748 + k * 27, w, { size: 13.5, color: k < 3 ? '#ff9aad' : 'text', parent: S.beam, opacity: 0 });
          });
          hide([S.pHead, S.beam]); hide(S.pBtn); hide(S.cntL);
          /* beat 0: penalties appear; used tokens are marked */
          return Promise.all([ctx.reveal(S.pHead, { dur: 300 }), ctx.reveal(S.pBtn, { from: 'scale', stagger: 80 }), ctx.fade(S.cntL, 1, 400), update(ctx, S, 500)]).then(function () {
            return ctx.pulse(S.tokL[0], { color: 'orange', dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: penalties on, surface becomes the mode */
            S.pen = true;
            return update(ctx, S, 900).then(function () {
              ctx.hud('penalties: ice 4.1 → 2.8 · surface now the mode');
              return ctx.pulse(S.bar[2], { color: 'lime', times: 2, dur: 500 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: beam search tree, level by level */
            ctx.hud('');
            return ctx.reveal(S.beam, { from: 'up', dur: 500 }).then(function () {
              var chain = ctx.wait(200);
              lv.forEach(function (L, li) {
                chain = chain.then(function () {
                  return Promise.all([ctx.reveal(L, { from: 'left', dur: 300, stagger: 60 }), ctx.reveal(li > 0 ? edLv[li - 1] : [], { dur: 300, stagger: 40 })]);
                });
              });
              return chain;
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: why chat models do not use it */
            return ctx.reveal(S.why, { from: 'left', stagger: 200, dur: 400 });
          });
        }
      },
      /* 5 ------------------------------------------------------------------ */
      {
        title: 'Grammar-masked JSON',
        beats: [
          {
            say: 'Now the director emits a tool call. Free sampling could produce prose, a markdown fence, or a string where the schema demands an integer.',
            card: { tag: 'PITFALL', title: 'Free sampling breaks tool calls', body: 'One stray word, a code fence or a quoted number and the parser throws. Every failure costs a retry, latency and tokens.' },
            deep: '<p>Failure modes of unconstrained tool JSON: a prose preamble, markdown fences, wrong types, values outside an enum, extra keys, truncated braces.</p>' +
              '<ul><li><b>Prompt and retry</b>: costly, and every retry re-pays the whole call.</li><li><b>Fine-tune for format</b>: better, but still probabilistic.</li><li><b>Constrained decoding</b>: a hard guarantee of syntax, at almost no cost (next beats).</li></ul>'
          },
          {
            say: "Grammar constrained decoding prevents all of that. At every step, a matcher compiled from the tool's JSON schema computes which tokens are legal, and the illegal ones get their logits set to minus infinity before sampling.",
            card: { tag: 'KEY IDEA', title: 'Illegal tokens get minus infinity', body: 'A binary mask <code>m ∈ {0,1}^V</code> is applied to the logits before the softmax: legal tokens keep their scores, all others become −∞.',
              more: '<p>In practice the mask is an int32 bitmask of shape <code>[B, ⌈V/32⌉]</code>, and a kernel sets z<sub>i</sub> = −∞ wherever the bit is 0. Because the softmax subtracts the row maximum first, exp(−∞) is exactly 0 and no renormalization pass is needed: the surviving probabilities already sum to one.</p>' },
            deep: '<div class="eq">z̃<sub>i</sub> = z<sub>i</sub> + log m<sub>i</sub>, &nbsp; m ∈ {0,1}<sup>V</sup> &nbsp;⇒&nbsp; p̃<sub>i</sub> = p<sub>i</sub> m<sub>i</sub> / Σ<sub>j</sub> p<sub>j</sub> m<sub>j</sub></div>' +
              '<p>The mask is computed by a grammar matcher from the current parse state, and applied as a fused bitmask kernel just before sampling. Penalties are off and T is low (0.2) for tool arguments; decoding stops when the automaton reaches an accept state.</p>'
          },
          {
            say: 'Watch the first token. The model gives Sure eleven percent and a code fence nine percent, but the grammar only allows an opening brace, so those are struck out and the JSON begins cleanly.',
            card: { tag: 'NUMBERS', title: 'Masking renormalizes', stat: { v: '0.62 → 0.89', l: 'p of the opening brace once Sure, the fence and I are masked' } },
            deep: '<p>At the start, only tokens that begin with <code>{</code> are legal: <code>{"</code> (0.62) and <code>{</code> (0.08). Sure (0.11), the code fence (0.09) and I (0.05) are masked. The legal mass is 0.70, so <code>{"</code> is renormalized to 0.62 / 0.70 = 0.89.</p>' +
              '<p>No preamble and no markdown fence are possible: the grammar has no path for them.</p>'
          },
          {
            say: 'Next comes the shot number. The model put forty one percent on a quote, a string, but the schema demands an integer, so the quote is masked and the digit three rises to eighty five percent.',
            card: { tag: 'NUMBERS', title: 'A string cannot pass', stat: { v: '0.33 → 0.85', l: 'p of the integer 3 once the string quote and "three" are masked' } },
            deep: '<p>At <code>"shot":</code> the model put 0.41 on <code>"</code> (a string), which is masked. The integer <code>3</code> goes from 0.33 to ≈0.85 after renormalization (0.33 / (0.33 + 0.06)).</p>' +
              '<ul><li><b>Guarantee</b>: syntactic validity against the schema (types, enums, required keys, <code>additionalProperties: false</code>). Not semantic correctness: shot 3 might still be the wrong shot.</li>' +
              '<li>Keyword coverage varies by engine: numeric bounds (<code>maximum: 10</code>), <code>format</code> or complex <code>pattern</code>s may be unsupported, approximated or rejected at compile time, one reason to re-validate after decoding.</li></ul>'
          },
          {
            say: 'Then the camera move: zoom is not in the enum, so only prefixes of the five allowed values survive. At the end the grammar closes the object, and the output is valid by construction.',
            card: { tag: 'KEY IDEA', title: 'Valid by construction', body: 'Types, enums, required keys and <code>additionalProperties: false</code> hold for every sample. Semantics still need checking.',
              more: '<p><b>Distortion</b>: per-step renormalization is myopic; it samples from p(x<sub>t</sub> | prefix, legal) rather than p(sequence | whole sequence legal). If the model is far off-distribution, forcing JSON can yield low-quality but valid output. Tam et al. (2024) report strict format constraints can hurt reasoning accuracy.</p>' },
            deep: '<ul><li><b>Distortion</b>: per-step renormalization is myopic; it samples from p(x<sub>t</sub> | prefix, legal) rather than p(sequence | whole sequence legal). If the model is far off-distribution (e.g. wanted to write prose), forcing JSON can yield low-quality but valid output.</li>' +
              '<li><b>Mitigations</b>: put free-form reasoning outside the constrained region (or a <code>"reasoning"</code> field first), keep schemas close to what the model was trained on, allow natural whitespace. Tam et al. (2024) report that strict format constraints can hurt reasoning accuracy.</li>' +
              '<li>Where it lives: OpenAI Structured Outputs (strict), vLLM / SGLang guided decoding (XGrammar, llguidance, Outlines backends), and provider-side strict tool schemas.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.ch, 400); ctx.remove(S.ctl, 400); ctx.remove(S.beam, 400);
          S.s5 = ctx.group();
          var G = S.s5;
          S.oHead = head(ctx, 60, 176, 'OUTPUT TOKENS · tool_use render_shot (␣ = leading space)', 'amber', G);
          var TK = ['{"', 'name', '":', '␣"', 'render', '_shot', '",', '␣"', 'arguments', '":', '␣{"', 'shot', '":', '␣', '3', ',', '␣"', 'camera', '":', '␣"', 'dolly', '_in', '",', '␣"', 'duration', '_s', '":', '␣', '5', '}}'];
          S.outX = 60; S.outY = 214;
          S.outG = ctx.group({ parent: G });
          S.cursor = ctx.rect(60, 201, 3, 26, { rx: 1, fill: 'lime', parent: G });
          /* schema panel */
          S.schema = ctx.code({ x: 60, y: 262, w: 520, title: 'tools[0].input_schema (JSON Schema)', lang: 'json', size: 12, color: 'amber', parent: G, lines: nb([
            '{"type": "object",',
            ' "properties": {',
            '  "shot": {"type": "integer", "minimum": 1},',
            '  "camera": {"enum": ["static", "dolly_in",',
            '     "orbit", "crane_up", "handheld"]},',
            '  "duration_s": {"type": "number", "maximum": 10}},',
            ' "required": ["shot", "camera", "duration_s"],',
            ' "additionalProperties": false}'
          ]) });
          S.pda = ctx.text(60, 520, '', { size: 13, font: 'mono', color: 'pink', parent: G });
          S.pda2 = ctx.text(60, 545, '', { size: 12, font: 'mono', color: 'dim', parent: G });
          /* what free sampling could emit (beat 0 only) */
          S.bad = ctx.group({ parent: G });
          panel(ctx, 620, 262, 940, 330, 'red', S.bad);
          head(ctx, 640, 286, 'WHAT FREE SAMPLING CAN EMIT INSTEAD', 'red', S.bad);
          [['Sure! Here is the tool call:', 'prose preamble'], ['```json {"shot": 3, "camera": ...} ```', 'markdown fence'], ['{"shot": "three", "camera": "zoom in"}', 'string for an integer · value not in the enum']].forEach(function (r, k) {
            var y = 340 + k * 62;
            ctx.rect(640, y - 22, 900, 44, { rx: 8, fill: ctx.alpha('red', 0.06), stroke: ctx.alpha('red', 0.5), sw: 1, dash: '4 4', parent: S.bad });
            ctx.text(660, y + 0.5, r[0], { size: 15, font: 'code', color: '#ffb3c0', parent: S.bad });
            ctx.text(1524, y + 0.5, '✕ ' + r[1], { size: 13, font: 'mono', color: 'red', anchor: 'end', parent: S.bad });
          });
          ctx.text(640, 552, 'parser: JSONDecodeError → retry the whole call', { size: 13, font: 'mono', color: 'dim', parent: S.bad });
          /* candidate panel */
          S.CP = ctx.group({ parent: G });
          panel(ctx, 620, 262, 940, 330, 'pink', S.CP);
          head(ctx, 640, 286, 'MODEL PROPOSALS AT THIS POSITION → MASK → RENORMALIZE', 'pink', S.CP);
          S.candG = ctx.group({ parent: G });
          /* bitmask strip */
          S.BM = ctx.group({ parent: G });
          panel(ctx, 60, 620, 1500, 262, 'pink', S.BM);
          head(ctx, 80, 644, 'TOKEN MASK m ∈ {0,1}^V  (sample of 128,256 ids) · green = legal', 'pink', S.BM);
          S.mask = ctx.matrix(80, 666, 4, 64, { cell: 18, gap: 4, values: function () { return '#1a2438'; }, parent: S.BM });
          ctx.text(80, 770, 'z̃_i = z_i if m_i = 1 else −∞   →   softmax   →   sample', { size: 16, font: 'mono', color: 'white', parent: S.BM });
          ctx.text(80, 802, 'mask computed on CPU by the grammar matcher while the GPU runs the forward pass; applied as a fused bitmask kernel', { size: 12.5, font: 'mono', color: 'dim', parent: S.BM });
          ctx.text(80, 828, 'penalties OFF · T = 0.2 for tool arguments · stop when the automaton reaches an accept state', { size: 12.5, font: 'mono', color: 'dim', parent: S.BM });
          S.maskT = ctx.text(1540, 644, '', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: S.BM });
          hide([S.s5, S.oHead, S.cursor, S.schema, S.bad, S.CP, S.BM]);
          var DEC = {
            0: { st: 'PDA: start → expect value "{"', st2: 'no preamble, no markdown fence allowed', legal: 5, lab: 'ids starting with {', c: [['{"', 0.62, 1], ['Sure', 0.11, 0], ['```', 0.09, 0], ['{', 0.08, 1], ['I', 0.05, 0], ['␣{', 0.03, 0]] },
            14: { st: 'PDA: root › arguments › value("shot")', st2: 'schema: integer, minimum 1 → digits 1-9 only', legal: 9, lab: 'digit ids 1–9…', c: [['"', 0.41, 0], ['3', 0.33, 1], ['three', 0.12, 0], ['4', 0.06, 1], ['null', 0.04, 0], ['-', 0.02, 0]] },
            20: { st: 'PDA: root › arguments › string(enum "camera")', st2: 'legal prefixes: static | dolly_in | orbit | crane_up | handheld', legal: 6, lab: 'enum-prefix ids only', c: [['dolly', 0.38, 1], ['zoom', 0.22, 0], ['orbit', 0.15, 1], ['push', 0.10, 0], ['static', 0.05, 1], ['Dolly', 0.03, 0]] },
            29: { st: 'PDA: root › arguments › after "duration_s" value', st2: 'no properties left, additionalProperties: false → close', legal: 7, lab: 'closers and fraction ids', c: [['}}', 0.52, 1], [',', 0.21, 0], ['}', 0.13, 1], ['\\n', 0.06, 0], ['␣}', 0.04, 0], ['.5', 0.02, 1]] }
          };
          function showCands(d) {
            while (S.candG.firstChild) S.candG.removeChild(S.candG.firstChild);
            S.pda.textContent = d.st; S.pda2.textContent = d.st2;
            var legalSum = d.c.reduce(function (a, c) { return a + (c[2] ? c[1] : 0); }, 0);
            var rows = d.c.map(function (c, k) {
              var y = 322 + k * 42, g = ctx.group({ parent: S.candG });
              chip(ctx, 640, y, c[0], 'white', g, { w: 90, size: 14, bgA: 0.05 });
              var bar = ctx.rect(750, y - 10, c[1] * 560, 20, { rx: 3, fill: ctx.alpha('amber', 0.5), stroke: 'amber', sw: 1, parent: g });
              var pt = ctx.text(750 + c[1] * 560 + 8, y, 'p=' + c[1].toFixed(2), { size: 12, font: 'mono', color: 'text', parent: g });
              var res = ctx.text(1540, y, '', { size: 13, font: 'mono', anchor: 'end', parent: g });
              var strike = ctx.line(636, y, 740, y, { color: 'red', sw: 2, parent: g, opacity: 0 });
              return { g: g, bar: bar, pt: pt, res: res, strike: strike, c: c, legalSum: legalSum };
            });
            ctx.reveal(rows.map(function (r) { return r.g; }), { from: 'left', stagger: 50, dur: 250, dist: 12 });
            return ctx.wait(700).then(function () {
              rows.forEach(function (r) {
                if (r.c[2]) {
                  r.bar.setAttribute('fill', ctx.alpha('lime', 0.5)); r.bar.setAttribute('stroke', ctx.C.lime);
                  r.res.textContent = 'm=1 → p̃=' + (r.c[1] / r.legalSum).toFixed(2);
                  r.res.setAttribute('fill', ctx.C.lime);
                } else {
                  r.bar.setAttribute('fill', ctx.alpha('red', 0.2)); r.bar.setAttribute('stroke', ctx.C.red);
                  r.strike.setAttribute('opacity', 1);
                  r.res.textContent = 'm=0 → −∞';
                  r.res.setAttribute('fill', ctx.C.red);
                }
              });
              var rg = ctx.rng(d.legal * 7 + 3);
              S.mask.set(function () { var ok = rg() < d.legal / 256; return ok ? ctx.C.lime : ctx.alpha('red', 0.35); });
              S.maskT.textContent = 'legal here: ' + d.lab;
              return ctx.wait(1500);
            });
          }
          /* emit tokens [a, b) with the candidate panel shown at the marked positions */
          function emit(a, b) {
            var chain = ctx.wait(500);
            for (var i = a; i < b; i++) {
              (function (i) {
                chain = chain.then(function () {
                  var p = DEC[i] ? showCands(DEC[i]) : Promise.resolve();
                  return p.then(function () {
                    var c = chip(ctx, S.outX, S.outY, TK[i], DEC[i] ? 'lime' : 'amber', S.outG, { size: 13 });
                    S.outX += c.w + 3;
                    S.cursor.setAttribute('x', S.outX);
                    return ctx.reveal(c, { from: 'scale', dur: 120 });
                  });
                });
              })(i);
            }
            return chain;
          }
          /* beat 0: the problem */
          return ctx.reveal(S.s5, { dur: 200 }).then(function () {
            return Promise.all([ctx.reveal([S.oHead, S.cursor, S.schema], { from: 'up', stagger: 120 }), ctx.reveal(S.bad, { from: 'right', delay: 200 })]);
          }).then(function () {
            return ctx.pulse(S.bad, { color: 'red', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the mask mechanism */
            ctx.remove(S.bad, 300);
            return ctx.wait(300).then(function () {
              return Promise.all([ctx.reveal(S.CP, { from: 'up' }), ctx.reveal(S.BM, { from: 'up', delay: 150 })]);
            }).then(function () { return ctx.pulse(S.BM, { color: 'pink', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: position 0, the opening brace */
            return emit(0, 14);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: position 14, integer instead of string */
            return emit(14, 20);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the camera enum, closing the object */
            return emit(20, 30).then(function () {
              ctx.hud('valid by construction · 30 tokens · 0 retries');
              return ctx.wait(400);
            });
          });
        }
      },
      /* 6 ------------------------------------------------------------------ */
      {
        title: 'Building the mask',
        beats: [
          {
            say: 'How is a mask over a hundred and twenty eight thousand tokens computed in microseconds? The schema compiles to a context free grammar, executed by a pushdown automaton whose stack tracks the nested objects.',
            card: { tag: 'HOW IT WORKS', title: 'A grammar plus a stack', body: 'The JSON schema compiles to an EBNF grammar. A <b>pushdown automaton</b> tracks nesting with a stack: push on an opening brace or quote, pop on the closing one.' },
            deep: '<ul><li><b>FSM approach</b> (Outlines; Willard &amp; Louf 2023): regex or bounded JSON → DFA; precompute <code>state → allowed-token set</code> once. O(1) per step, but only regular languages (bounded nesting) and large tables.</li>' +
              '<li><b>PDA approach</b> for full CFGs (nested JSON, code): the stack makes legality depend on context. The automaton state alone no longer decides whether a token is legal.</li></ul>'
          },
          {
            say: 'Engines such as XGrammar split the vocabulary. For most tokens, legality depends only on the current automaton position, so it is precomputed and cached.',
            card: { tag: 'STATE OF THE ART', title: 'Cache what ignores the stack', body: 'XGrammar precomputes an <b>adaptive token-mask cache</b> for every token whose legality is fixed by the automaton position alone.' },
            deep: '<p>XGrammar (Dong et al.) splits tokens into <b>context-independent</b> ones (decidable from the automaton position alone, so cached per position as an adaptive token-mask cache) and a small <b>context-dependent</b> set. It also applies grammar-context expansion to shrink the second set further.</p>' +
              '<p>The cache is built at grammar-compile time, not per request, and shared by every sequence using the same schema.</p>'
          },
          {
            say: 'Only a small context dependent set, the amber cells, has to be checked against the stack at runtime. Everything else is a lookup.',
            card: { tag: 'NUMBERS', title: 'A handful of runtime checks', stat: { v: '< 1%', l: 'of tokens need a runtime stack check (amber; exaggerated here)' },
              more: '<p>Example of a context-dependent token: <code>":</code>. Right after a key string it is a legal quote-then-colon; inside a string <i>value</i> the quote would close the string and the colon would then be illegal. The answer depends on the top of the stack. Context-independent tokens, such as digits inside an integer, never need it.</p>' },
            deep: '<p>The context-dependent tokens are checked against a persistent (tree-structured) stack, so a pushed frame is shared rather than copied when the matcher forks or rolls back.</p>' +
              '<ul><li>Reported results: up to ~100× lower per-token latency on context-free grammars than prior engines, under 40&nbsp;µs per token for JSON Schema, and near-zero end-to-end overhead when overlapped with the GPU step.</li>' +
              '<li>For Llama-3.1 with a JSON grammar the paper counts 1,134 of about 128k tokens (under 1%) as context-dependent, cut to 120 by context expansion.</li>' +
              '<li>microsoft/llguidance (Earley parser on a derivative-based lexer) reports about 50&nbsp;µs of single-core CPU time per mask for a 128k-token vocabulary.</li></ul>'
          },
          {
            say: 'The mask is built on the CPU while the GPU runs the forward pass, so its cost hides completely behind the model.',
            card: { tag: 'NUMBERS', title: 'A mask off the critical path', stat: { v: '16 KB', l: 'bitmask per request per step: ⌈128,256 / 32⌉ int32 words' } },
            deep: '<p><b>Batching</b>: each request has its own matcher; masks are packed as a bitmask tensor <code>[B, ⌈V/32⌉]</code> int32 and applied by one kernel.</p>' +
              '<p>Timeline per step: once token t−1 is sampled, the GPU starts the forward pass for step t (10–40&nbsp;ms for a 70B decode); meanwhile the CPU advances the matcher with token t−1 and builds the mask for step t (tens of µs from cache). It is ready before the logits exist.</p>'
          },
          {
            say: 'The hard part is tokenization: one token can span several grammar symbols, so the matcher walks each candidate token byte by byte.',
            card: { tag: 'PITFALL', title: 'Tokens are not terminals', body: 'A BPE token like <code>":</code> is a quote and a colon at once. The matcher advances byte by byte through each candidate, sharing prefixes in a vocabulary trie.' },
            deep: '<p><b>Token boundaries</b>: BPE tokens do not align with grammar terminals: <code>":</code> is quote + colon, <code>",</code> is quote + comma, <code>␣{"</code> is three symbols. The matcher advances byte by byte through each candidate token (a trie over the vocabulary shares prefixes).</p>' +
              '<p>At the prompt boundary, <b>token healing</b> backs up one token so the model can pick the merged token it would naturally use. The mask must also allow every multi-byte token that is a legal prefix (e.g. <code>dol</code> and <code>dolly_</code> inside the enum trie).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.fade(S.s5, 0, 400);
          S.s6 = ctx.group();
          var G = S.s6;
          /* grammar + stack */
          S.gram = ctx.code({ x: 60, y: 165, w: 500, title: 'compiled grammar (EBNF, excerpt)', lang: 'text', size: 12, color: 'pink', parent: G, lines: nb([
            'args  ::= "{" ws "\\"shot\\":" ws int "," ws',
            '          "\\"camera\\":" ws cam "," ws',
            '          "\\"duration_s\\":" ws num "}"',
            'int   ::= [1-9] [0-9]*',
            'cam   ::= "\\"" ("static" | "dolly_in" | "orbit"',
            '          | "crane_up" | "handheld") "\\""',
            'num   ::= int ("." [0-9]+)?'
          ]) });
          var SK = ctx.group({ parent: G });
          panel(ctx, 60, 360, 500, 250, 'pink', SK);
          head(ctx, 80, 384, 'PUSHDOWN AUTOMATON · stack', 'pink', SK);
          var frames = [['root object {', 'white'], ['"arguments" object {', 'amber'], ['cam: string, enum trie', 'lime']];
          S.fr = frames.map(function (f, k) {
            var g = ctx.group({ parent: SK });
            ctx.rect(90, 570 - k * 48, 300, 40, { rx: 6, fill: ctx.alpha(f[1], 0.12), stroke: f[1], sw: 1.2, parent: g });
            ctx.text(106, 590 - k * 48, f[0], { size: 13, font: 'mono', color: f[1], parent: g });
            g.setAttribute('opacity', 0);
            return g;
          });
          ctx.text(410, 490, 'push on "{" / "\\""', { size: 11.5, font: 'mono', color: 'dim', parent: SK });
          ctx.text(410, 512, 'pop on "}" / "\\""', { size: 11.5, font: 'mono', color: 'dim', parent: SK });
          ctx.text(410, 540, 'input so far:', { size: 11.5, font: 'mono', color: 'dim', parent: SK });
          ctx.text(410, 560, '…"camera": "do', { size: 12, font: 'mono', color: 'white', parent: SK });
          /* vocab grid */
          var VG = ctx.group({ parent: G });
          panel(ctx, 590, 165, 520, 445, 'pink', VG);
          head(ctx, 610, 190, 'VOCAB MASK · 476-id sample of 128,256', 'pink', VG);
          S.grid = ctx.matrix(612, 214, 17, 28, { cell: 14, gap: 3, values: function () { return '#1a2438'; }, parent: VG });
          var rg = ctx.rng(21);
          S.cls = [];
          for (var r = 0; r < 17; r++) { S.cls.push([]); for (var c = 0; c < 28; c++) { var u = rg(); S.cls[r].push(u < 0.035 ? 'dep' : (u < 0.06 ? 'ok' : 'no')); } }
          var leg = [['#8dff5a', 'legal (cached)'], [ctx.alpha('#ff4d6d', 0.45), 'illegal (cached)'], ['#ffbf3a', 'context-dependent → run stack']];
          leg.forEach(function (l, k) {
            ctx.rect(612, 520 + k * 26, 14, 14, { rx: 3, fill: l[0], parent: VG });
            ctx.text(634, 527 + k * 26, l[1], { size: 12, font: 'mono', color: 'text', parent: VG });
          });
          S.gStat = ctx.text(1090, 527, '', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: VG });
          /* overlap timeline */
          var TL = ctx.group({ parent: G });
          panel(ctx, 1140, 165, 420, 445, 'pink', TL);
          head(ctx, 1160, 190, 'OVERLAP WITH THE GPU STEP', 'pink', TL);
          ctx.text(1160, 240, 'GPU', { size: 12, font: 'mono', color: 'red', parent: TL });
          ctx.text(1160, 300, 'CPU', { size: 12, font: 'mono', color: 'cyan', parent: TL });
          S.gpuB = []; S.cpuB = [];
          for (var s = 0; s < 3; s++) {
            var x0 = 1205 + s * 115;
            S.gpuB.push(ctx.rect(x0, 228, 100, 24, { rx: 4, fill: ctx.alpha('red', 0.4), stroke: 'red', sw: 1, parent: TL }));
            ctx.text(x0 + 50, 240, 'fwd t+' + s, { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: TL });
            S.cpuB.push(ctx.rect(x0 + 4, 288, 16, 24, { rx: 3, fill: ctx.alpha('cyan', 0.55), stroke: 'cyan', sw: 1, parent: TL }));
            ctx.text(x0 + 24, 300, 'mask', { size: 11, font: 'mono', color: 'cyan', parent: TL });
            ctx.line(x0 + 100, 252, x0 + 100, 282, { color: ctx.alpha('white', 0.25), sw: 1, dash: '2 3', parent: TL });
          }
          [['forward (decode, 70B)', '≈ 10–40 ms', 350], ['mask (cached PDA)', '≈ tens of µs', 374], ['apply bitmask kernel', '≈ µs', 398]].forEach(function (t) {
            ctx.text(1160, t[2], t[0], { size: 12, font: 'mono', color: 'text', parent: TL });
            ctx.text(1540, t[2], t[1], { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: TL });
          });
          ctx.text(1160, 440, 'mask for step t+1 is ready before', { size: 12, font: 'mono', color: 'lime', parent: TL });
          ctx.text(1160, 460, 'logits of step t+1 exist', { size: 12, font: 'mono', color: 'lime', parent: TL });
          ctx.text(1160, 505, 'batch: bitmask [B, ⌈V/32⌉] int32', { size: 12, font: 'mono', color: 'dim', parent: TL });
          ctx.text(1160, 529, '= 16 KB per request per step', { size: 12, font: 'mono', color: 'dim', parent: TL });
          /* token boundary band */
          var TB = ctx.group({ parent: G });
          panel(ctx, 60, 640, 1500, 245, 'amber', TB);
          head(ctx, 80, 664, 'TOKEN BOUNDARIES ≠ GRAMMAR BOUNDARIES', 'amber', TB);
          /* character-aligned rows over the string ␣"camera":␣"dolly_in", (22 chars) */
          var terms = [['␣', 0, 0], ['"', 1, 1], ['camera', 2, 7], ['"', 8, 8], [':', 9, 9], ['␣', 10, 10], ['"', 11, 11], ['dolly_in', 12, 19], ['"', 20, 20], [',', 21, 21]];
          var toks = [['␣"', 0, 1], ['camera', 2, 7], ['":', 8, 9], ['␣"', 10, 11], ['dolly', 12, 16], ['_in', 17, 19], ['",', 20, 21]];
          var cw = 22, X0 = 290;
          ctx.text(80, 712, 'grammar terminals', { size: 12, font: 'mono', color: 'dim', parent: TB });
          ctx.text(80, 772, 'BPE tokens', { size: 12, font: 'mono', color: 'dim', parent: TB });
          terms.forEach(function (t) {
            chip(ctx, X0 + t[1] * cw, 712, t[0], 'pink', TB, { w: (t[2] - t[1] + 1) * cw - 4, size: 13 });
          });
          S.tokC = toks.map(function (t) {
            var straddle = t[0] === '":' || t[0] === '",' || t[0] === '␣"';
            return chip(ctx, X0 + t[1] * cw, 772, t[0], straddle ? 'amber' : 'cyan', TB, { w: (t[2] - t[1] + 1) * cw - 4, size: 13 });
          });
          ctx.text(1040, 712, 'tokens like  ":  and  ",  cover two terminals;', { size: 13, font: 'mono', color: 'amber', parent: TB });
          ctx.text(1040, 736, 'the matcher walks each token byte by byte', { size: 13, font: 'mono', color: 'amber', parent: TB });
          ctx.text(1040, 760, '(vocabulary trie shares prefix work)', { size: 12, font: 'mono', color: 'dim', parent: TB });
          ctx.text(80, 836, 'token healing: if the prompt ends in ␣" the model would have preferred ␣"d… → back up one token and constrain the regeneration to extend the removed text', { size: 12.5, font: 'mono', color: 'text', parent: TB });
          ctx.text(80, 862, 'mask must also allow every multi-byte token that is a legal prefix (e.g. "dol" and "dolly_" are fine inside the enum trie)', { size: 12.5, font: 'mono', color: 'dim', parent: TB });
          hide([S.s6, S.gram, SK, VG, TL, TB]);
          function paint(stage) {
            var ok = 0, no = 0, dep = 0;
            S.grid.set(function (r2, c2) {
              var k = S.cls[r2][c2];
              if (k === 'dep') { dep++; return stage === 0 ? ctx.C.amber : ((r2 * 7 + c2) % 3 === 0 ? ctx.C.lime : ctx.alpha('#ff4d6d', 0.45)); }
              if (k === 'ok') { ok++; return ctx.C.lime; }
              no++; return ctx.alpha('#ff4d6d', 0.45);
            });
            for (var r3 = 0; r3 < 17; r3++) for (var c3 = 0; c3 < 28; c3++) {
              if (S.cls[r3][c3] === 'dep') { S.grid.cells[r3][c3].setAttribute('stroke', ctx.C.amber); S.grid.cells[r3][c3].setAttribute('stroke-width', stage === 0 ? 0 : 2); }
            }
            S.gStat.textContent = stage === 0 ? 'cache hit: ' + (ok + no) + ' · runtime: ' + dep : 'done · amber ring = checked on stack';
          }
          /* beat 0: the grammar and its stack */
          return ctx.reveal(S.s6, { dur: 200 }).then(function () {
            return Promise.all([ctx.reveal([S.gram, SK], { from: 'left', stagger: 150 })]);
          }).then(function () {
            var chain = Promise.resolve();
            S.fr.forEach(function (f) { chain = chain.then(function () { return ctx.reveal(f, { from: 'down', dur: 300 }); }); });
            return chain;
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the vocabulary split; cached legal / illegal, and the context-dependent few */
            paint(0);
            return ctx.reveal(VG, { from: 'up' }).then(function () { return ctx.pulse(S.grid, { color: 'lime', dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the amber cells are resolved on the stack */
            paint(1);
            ctx.pulse(S.fr[2], { color: 'lime', dur: 500 });
            return ctx.pulse(S.grid, { color: 'amber', dur: 700 });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: overlap with the GPU step */
            return ctx.reveal(TL, { from: 'right' }).then(function () {
              return Promise.all(S.cpuB.map(function (b) { return ctx.pulse(b, { color: 'cyan', dur: 500 }); }));
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: token boundaries */
            return ctx.reveal(TB, { from: 'up' }).then(function () {
              return Promise.all(S.tokC.map(function (c, k) { return ctx.wait(k * 90).then(function () { return ctx.pulse(c, { color: 'amber', dur: 400 }); }); }));
            });
          });
        }
      },
      /* 7 ------------------------------------------------------------------ */
      {
        title: 'Speculative decoding',
        beats: [
          {
            say: "Decoding is memory bound: each token requires reading every weight, so the GPU's compute mostly sits idle. Speculative decoding spends that spare compute.",
            card: { tag: 'KEY IDEA', title: 'Spare FLOPs at batch one', body: 'Decode reads all weights for each token but does little arithmetic per byte, so tensor cores idle. Checking several positions per pass is almost free.' },
            deep: '<p>Roofline view: at batch 1 every weight byte read (bf16: 2 bytes) supports about 2 FLOPs, an arithmetic intensity near 1 FLOP/byte. An H100 SXM needs about 989 TFLOP/s (dense bf16) ÷ 3.35 TB/s ≈ 295 FLOP/byte to be compute-bound, so decode uses well under 1% of the tensor cores.</p>' +
              '<p>Scoring k+1 positions instead of one raises intensity almost k-fold at the same weight traffic: the extra positions ride on reads the GPU pays for anyway.</p>'
          },
          {
            say: 'A cheap draft, a small model or a light head on the target itself, proposes four tokens, one after another.',
            card: { tag: 'HOW IT WORKS', title: 'A cheap draft proposes k tokens', body: 'The draft (a 1B model or an EAGLE head) autoregressively samples k = 4 tokens with probabilities q. It is cheap, but strictly sequential.' },
            deep: '<pre>for i in 1..k:          # draft\n  x_i ~ q(· | prefix, x_&lt;i)</pre>' +
              '<p>The draft only has to be <i>fast and roughly right</i>. Its quality sets the acceptance rate α; its cost c (relative to one target step) sets how much of the gain is spent on drafting. Typical drafts are 20–100× cheaper than the target per token.</p>'
          },
          {
            say: 'The big target model then scores all of them in a single forward pass, just like prefill.',
            card: { tag: 'KEY IDEA', title: 'One pass verifies k tokens', body: 'The target scores all k+1 positions in parallel, exactly like prefill, at nearly the latency of a single decode step.' },
            deep: '<pre>p = target(prefix + x_1..x_k)\n    # ONE forward pass, k+1 positions</pre>' +
              '<p>Verification costs one target pass over k+1 positions, nearly the same latency as one decode step, because decode is bandwidth-bound and the extra positions ride on the same weight reads. The pass yields p<sub>1</sub>…p<sub>k+1</sub>: the target\'s distribution at every draft position, plus one extra.</p>'
          },
          {
            say: 'Each draft token is accepted with probability equal to the smaller of one and p over q. Here ice and field are accepted, but the third draft token, the word and, is rejected.',
            card: { tag: 'NUMBERS', title: 'Why "and" is rejected', stat: { v: '0.23', l: 'accept probability of "and" (p 0.08, q 0.35); the draw 0.64 rejects it' },
              more: '<p>Verification generalizes from a chain to a <b>tree</b> of drafts (SpecInfer, Miao et al., 2024): the target scores every branch in one pass under a tree attention mask, and multi-step speculative sampling verifies the branches while keeping the output distribution exact.</p>' },
            deep: '<pre>for i in 1..k:\n  if U &lt; min(1, p_i(x_i)/q_i(x_i)):\n    accept x_i\n  else:\n    emit y ~ norm((p_i − q_i)₊)\n    stop\nif all accepted:\n  emit bonus x_k+1 ~ p_k+1</pre>' +
              '<p>Position 3: p(and) = 0.08, q(and) = 0.35 → accept probability 0.23, u = 0.64 → reject. Positions 1 and 2 have p/q = 1.13 (always accepted) and 0.83 (u = 0.31 accepts).</p>'
          },
          {
            say: "A replacement comma is sampled from the leftover distribution. Three tokens for the price of one target pass, and the output is distributed exactly as the target's.",
            card: { tag: 'KEY IDEA', title: 'Exact, not approximate', body: 'Rejection sampling with the residual (p − q)₊ makes every emitted token an exact sample from the target. Speculation changes speed, never the distribution.' },
            deep: '<p><b>Why it is exact</b> (Leviathan et al.; Chen et al., 2023): for any token x,</p>' +
              '<div class="eq">P(emit x) = q(x)·min(1, p(x)/q(x)) + (1 − Σ<sub>y</sub> min(p,q)) · (p(x) − q(x))<sub>+</sub> / Σ<sub>y</sub>(p − q)<sub>+</sub> = p(x)</div>' +
              '<details><summary>Go deeper</summary><p>Since min(p,q) + (p − q)<sub>+</sub> = p and 1 − Σ min(p,q) = Σ (p − q)<sub>+</sub>, the two terms sum to p(x). With greedy decoding: accept iff x<sub>i</sub> = argmax p<sub>i</sub>.</p></details>' +
              '<p>Here the residual (p − q)₊ puts 0.60 on the comma at position 3. Three tokens (ice, field, comma) cost one target pass: about 26 ms against 60 ms in three plain steps, roughly 2.3×.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.s5, 300); ctx.remove(S.s6, 400);
          S.s7 = ctx.group();
          var G = S.s7;
          S.cHead = head(ctx, 60, 176, 'CONTEXT  …steps onto the glowing ▁', 'amber', G);
          S.dN = ctx.node({ x: 170, y: 270, w: 220, h: 64, title: 'Draft', sub: 'EAGLE head / 1B · q', icon: 'bolt', color: 'violet', titleSize: 16, parent: G });
          S.tN = ctx.node({ x: 170, y: 500, w: 220, h: 72, title: 'Target', sub: '70B · p · one pass', icon: 'brain', color: 'amber', titleSize: 17, parent: G });
          var COLX = [360, 520, 680, 840, 1000];
          var D = [['ice', 0.55, 0.62, 0.18], ['field', 0.48, 0.40, 0.31], ['and', 0.35, 0.08, 0.64], ['looks', 0.30, 0.22, null]];
          S.dCap = ctx.text(COLX[0], 222, 'draft proposes k = 4 (autoregressive, cheap)', { size: 12, font: 'mono', color: 'violet', parent: G });
          S.dc = D.map(function (d, i) {
            var g = ctx.group({ parent: G });
            chip(ctx, COLX[i], 270, d[0], 'violet', g, { w: 120 });
            ctx.text(COLX[i] + 60, 302, 'q = ' + d[1].toFixed(2), { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: g });
            if (i < 3) ctx.line(COLX[i] + 122, 270, COLX[i + 1] - 4, 270, { color: ctx.alpha('violet', 0.6), sw: 1.2, arrow: true, parent: g });
            g.setAttribute('opacity', 0);
            return g;
          });
          /* verify bracket */
          S.vb = ctx.group({ parent: G });
          ctx.rect(COLX[0] - 10, 470, COLX[4] + 130 - COLX[0], 60, { rx: 10, fill: ctx.alpha('amber', 0.08), stroke: 'amber', sw: 1.4, parent: S.vb });
          ctx.text(COLX[0] + 4, 460, 'target verifies all k+1 positions in one forward pass (like prefill)', { size: 12, font: 'mono', color: 'amber', parent: S.vb });
          S.pv = D.concat([['bonus', 0, 0, null]]).map(function (d, i) {
            return ctx.text(COLX[i] + 60, 500, i < 4 ? 'p = ' + d[2].toFixed(2) : 'p_5(·)', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: S.vb });
          });
          S.vb.setAttribute('opacity', 0);
          S.vl = [0, 1, 2, 3].map(function (i) {
            var l = ctx.path('M' + (COLX[i] + 60) + ',318 L' + (COLX[i] + 60) + ',468', { stroke: ctx.alpha('violet', 0.45), sw: 1.2, dash: '3 4', parent: G });
            l.setAttribute('opacity', 0);
            return l;
          });
          /* accept tests */
          var tests = [['p/q = 1.13', 'accept ✓'], ['p/q = 0.83', 'u = .31 → ✓'], ['p/q = 0.23', 'u = .64 → ✕'], ['discarded', ''], ['bonus only if', 'all accepted']];
          S.tt = [0, 1, 2, 3, 4].map(function (i) {
            var col = i < 2 ? 'lime' : (i === 2 ? 'red' : 'dim');
            var g = ctx.group({ parent: G });
            ctx.text(COLX[i] + 60, 560, tests[i][0], { size: 12.5, font: 'mono', color: col, anchor: 'middle', parent: g });
            ctx.text(COLX[i] + 60, 580, tests[i][1], { size: 12.5, font: 'mono', color: col, anchor: 'middle', parent: g });
            g.setAttribute('opacity', 0);
            return g;
          });
          /* wall-clock comparison: plain row now, speculative row at the end */
          S.cmp = ctx.group({ parent: G });
          head(ctx, 60, 772, 'WALL-CLOCK FOR THESE 3 TOKENS', 'amber', S.cmp);
          ctx.text(60, 808, 'plain decode', { size: 12, font: 'mono', color: 'dim', parent: S.cmp });
          [0, 1, 2].forEach(function (k) {
            ctx.rect(200 + k * 124, 797, 120, 22, { rx: 4, fill: ctx.alpha('amber', 0.45), stroke: 'amber', sw: 1, parent: S.cmp });
            ctx.text(260 + k * 124, 808, 'target', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: S.cmp });
          });
          ctx.text(590, 808, '3 passes ≈ 60 ms', { size: 13, font: 'mono', color: 'amber', parent: S.cmp });
          S.cmpB = ctx.group({ parent: G });
          ctx.text(60, 848, 'speculative', { size: 12, font: 'mono', color: 'dim', parent: S.cmpB });
          [0, 1, 2, 3].forEach(function (k) { ctx.rect(200 + k * 9, 837, 7, 22, { rx: 2, fill: ctx.alpha('violet', 0.7), stroke: 'violet', sw: 1, parent: S.cmpB }); });
          ctx.rect(238, 837, 122, 22, { rx: 4, fill: ctx.alpha('amber', 0.45), stroke: 'amber', sw: 1, parent: S.cmpB });
          ctx.text(299, 848, 'target · 5 pos', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: S.cmpB });
          ctx.text(380, 848, '4 draft steps + 1 pass ≈ 26 ms  →  ≈2.3×', { size: 13, font: 'mono', color: 'lime', parent: S.cmpB });
          /* result */
          S.rHead = ctx.text(60, 640, 'EMITTED THIS ROUND', { size: 13, font: 'mono', weight: 600, color: 'lime', parent: G, spacing: 1.2 });
          var res = [['ice', 'lime'], ['field', 'lime'], [',', 'cyan']];
          S.rc = res.map(function (r, i) {
            var c = chip(ctx, COLX[i], 680, r[0], r[1], G, { w: 120 });
            c.setAttribute('opacity', 0);
            return c;
          });
          S.rcNote = ctx.text(COLX[0], 726, '3 tokens from 1 target pass ("," resampled from the residual; x₄ discarded)', { size: 13, font: 'mono', color: 'text', parent: G, opacity: 0 });
          /* residual panel */
          S.RP = ctx.group({ parent: G });
          panel(ctx, 1170, 165, 390, 560, 'cyan', S.RP);
          head(ctx, 1190, 190, 'POSITION 3 · RESIDUAL', 'cyan', S.RP);
          var rt = ['and', ',', 'where', 'as', '.'], P = [0.08, 0.46, 0.18, 0.12, 0.16], Q = [0.35, 0.25, 0.10, 0.20, 0.10];
          var R = P.map(function (p, i) { return Math.max(0, p - Q[i]); }), Rs = R.reduce(function (a, b) { return a + b; }, 0);
          S.resid = [];
          rt.forEach(function (t, i) {
            var y = 240 + i * 62;
            ctx.text(1190, y + 12, t, { size: 14, font: 'mono', color: 'white', parent: S.RP });
            ctx.rect(1260, y, P[i] * 400, 12, { rx: 2, fill: ctx.alpha('amber', 0.6), parent: S.RP });
            ctx.rect(1260, y + 14, Q[i] * 400, 12, { rx: 2, fill: ctx.alpha('violet', 0.6), parent: S.RP });
            var rr = ctx.rect(1260, y + 28, 0, 12, { rx: 2, fill: ctx.alpha('cyan', 0.8), parent: S.RP });
            rr.setAttribute('data-w', (R[i] / Rs) * 250);
            S.resid.push(rr);
            ctx.text(1540, y + 34, (R[i] / Rs).toFixed(2), { size: 11, font: 'mono', color: 'cyan', anchor: 'end', parent: S.RP });
          });
          [['p (target)', 'amber'], ['q (draft)', 'violet'], ['(p − q)₊ normalized', 'cyan']].forEach(function (l, k) {
            ctx.rect(1190, 560 + k * 24, 14, 10, { rx: 2, fill: ctx.alpha(l[1], 0.7), parent: S.RP });
            ctx.text(1212, 566 + k * 24, l[0], { size: 12, font: 'mono', color: l[1], parent: S.RP });
          });
          ctx.text(1190, 650, 'accept x w.p. min(1, p(x)/q(x))', { size: 12.5, font: 'mono', color: 'white', parent: S.RP });
          ctx.text(1190, 674, 'else sample (p − q)₊ / ‖(p − q)₊‖₁', { size: 12.5, font: 'mono', color: 'white', parent: S.RP });
          ctx.text(1190, 700, '⇒ output ~ p exactly', { size: 13, font: 'mono', weight: 600, color: 'lime', parent: S.RP });
          hide([S.s7, S.dN, S.tN, S.dCap, S.cmp, S.cmpB, S.rHead, S.RP, S.cHead]);
          /* beat 0: the memory-bound baseline */
          return ctx.reveal(S.s7, { dur: 200 }).then(function () {
            return Promise.all([ctx.reveal(S.cHead, { dur: 300 }), ctx.reveal([S.dN, S.tN], { from: 'left', stagger: 150 }), ctx.reveal(S.cmp, { from: 'up', delay: 300 })]);
          }).then(function () {
            return ctx.pulse(S.tN, { color: 'amber', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the draft proposes k = 4 tokens */
            ctx.reveal(S.dCap, { dur: 300 });
            var chain = Promise.resolve();
            S.dc.forEach(function (g) { chain = chain.then(function () { ctx.pulse(S.dN, { color: 'violet', dur: 300 }); return ctx.reveal(g, { from: 'left', dur: 300 }); }); });
            return chain;
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: one verification pass */
            S.vl.forEach(function (l) { l.setAttribute('opacity', 1); });
            ctx.reveal(S.vl, { from: 'draw', dur: 400, stagger: 60 });
            ctx.pulse(S.tN, { color: 'amber', dur: 600 });
            return ctx.reveal(S.vb, { from: 'scale', s0: 0.96, dur: 500 });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: acceptance tests; the residual panel appears */
            ctx.reveal(S.RP, { from: 'right', dur: 500 });
            var chain = Promise.resolve();
            S.tt.forEach(function (g, i) { chain = chain.then(function () { return ctx.reveal(g, { from: 'down', dur: 260, dist: 10 }); }).then(function () { return i === 2 ? ctx.pulse(S.dc[2], { color: 'red', times: 2, dur: 400 }) : null; }); });
            return chain;
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: resample from the residual, emit three tokens */
            return Promise.all(S.resid.map(function (r) { return ctx.animate(r, { width: [0, +r.getAttribute('data-w')] }, 600, 'out'); })).then(function () {
              ctx.fade(S.dc[3], 0.3, 300);
              ctx.reveal(S.rHead, { dur: 300 });
              return ctx.reveal(S.rc, { from: 'up', stagger: 150, dur: 350 });
            }).then(function () {
              ctx.fade(S.rcNote, 1, 300);
              ctx.reveal(S.cmpB, { from: 'up', dur: 400 });
              ctx.hud('3 tokens per pass · distribution unchanged');
              return ctx.wait(500);
            });
          });
        }
      },
      /* 8 ------------------------------------------------------------------ */
      {
        title: 'Speedup & variants',
        beats: [
          {
            say: 'How much faster? It depends on the acceptance rate alpha, the chance that the target agrees with the draft.',
            card: { tag: 'KEY IDEA', title: 'Everything hinges on alpha', body: 'The acceptance rate α is how often the target agrees with the draft. It depends on how well the draft imitates the target, and on the text: JSON is easy, poetry is not.' },
            deep: '<p>The <b>acceptance rate</b> α is the expected probability that a draft token survives the test, α = E<sub>x~q</sub>[min(1, p(x)/q(x))] = 1 − ½‖p − q‖<sub>1</sub>: it is one minus the total variation distance between draft and target.</p>' +
              '<p>So α is a property of the draft-target pair <i>and</i> of the text: boilerplate JSON, code edits and repeated URIs give α close to 1, open-ended creative prose much less.</p>'
          },
          {
            say: 'With k draft tokens, one target pass yields on average one minus alpha to the power k plus one, divided by one minus alpha, tokens.',
            card: { tag: 'HOW IT WORKS', title: 'Expected tokens per pass', body: '<b>E = (1 − α^(k+1)) / (1 − α)</b>. Longer drafts only help when α is high: at α = 0.6, k = 8 barely beats k = 4.',
              more: '<p>The best draft length maximizes E(α, k) / (1 + k·c). For α = 0.8 and c = 0.05: k = 4 gives 2.80×, k = 6 gives 3.04×, k = 8 gives 3.09× (the optimum) and k = 10 gives 3.05×. Past the optimum, the draft cost k·c outgrows the shrinking gain.</p>' },
            deep: '<div class="eq">E[tokens / target pass] = (1 − α<sup>k+1</sup>) / (1 − α), &nbsp; speedup ≈ E / (1 + k·c)</div>' +
              '<details><summary>Go deeper</summary><p>The pass emits 1 + (number of accepted draft tokens). Token i is reached only if all earlier tokens were accepted, probability α<sup>i−1</sup>, so E = Σ<sub>i=0..k</sub> α<sup>i</sup> = (1 − α<sup>k+1</sup>)/(1 − α), a truncated geometric series (the 1 is the always-emitted resampled or bonus token).</p></details>' +
              '<p>c = draft cost relative to one target step. Longer drafts have diminishing returns and rising draft cost k·c.</p>'
          },
          {
            say: 'At alpha point eight and k four, that is about three point four tokens per pass, and after paying for the draft, roughly two to three times faster. Click an alpha chip to read the curves.',
            card: { tag: 'TRY IT', title: 'Click an alpha chip', body: 'The white line reads E and speedup for k = 4 with a draft costing 5% of a target step: α = 0.8 gives 3.36 tokens per pass and about 2.8×.' },
            deep: '<p>With k = 4: α = 0.6 → 2.31, α = 0.8 → 3.36, α = 0.9 → 4.10 tokens/pass; with c = 0.05, α = 0.8 gives ≈ 2.8×.</p>' +
              '<table><tr><th>α</th><th>E (k=4)</th><th>speedup, c = .05</th></tr><tr><td>0.6</td><td>2.31</td><td>1.9×</td></tr><tr><td>0.8</td><td>3.36</td><td>2.8×</td></tr><tr><td>0.9</td><td>4.10</td><td>3.4×</td></tr></table>'
          },
          {
            say: "Modern systems skip the separate draft model. Medusa adds extra decoding heads to the target, and EAGLE drafts from the target's own hidden features.",
            card: { tag: 'STATE OF THE ART', title: 'Draft from the target itself', body: 'Medusa: k extra heads and tree verification, about 2.2 to 2.8×. EAGLE-3 fuses features from several layers: up to ~6.5× at batch 1.' },
            deep: '<ul><li><b>Medusa</b> (Cai et al., 2024): k extra heads on the last hidden state predict t+2…t+k+1; candidates form a tree verified in one pass with <i>tree attention</i>; over 2.2× reported for Medusa-1 (frozen backbone) and 2.3–2.8× for Medusa-2 (fine-tuned jointly).</li>' +
              '<li><b>EAGLE</b> (Li et al.): a one-layer draft that autoregresses on the target’s <i>features</i> (plus the sampled token), which are far more predictable than tokens; EAGLE-2 adds dynamic draft trees, EAGLE-3 fuses low/mid/high-layer features with training-time test: up to ~6.5× reported at batch 1 (HumanEval, Vicuna 13B), and a 1.38× throughput gain at batch 64 in SGLang.</li></ul>'
          },
          {
            say: 'DeepSeek V3 trains multi token prediction modules and reuses them as the drafter, and simple prompt lookup copies spans from the context for free.',
            card: { tag: 'NUMBERS', title: 'Free drafts from training', stat: { v: '85–90%', l: 'acceptance of the 2nd predicted token in DeepSeek-V3, about 1.8× TPS' } },
            deep: '<ul><li><b>MTP</b> (DeepSeek-V3): sequential multi-token-prediction modules trained with an extra loss (densifies the training signal); reused at inference as the drafter: 2nd-token acceptance 85–90%, ≈1.8× TPS.</li>' +
              '<li><b>n-gram / prompt lookup</b>: draft by copying spans from the context, excellent for JSON, code edits and repeated URIs, with zero draft cost.</li></ul>'
          },
          {
            say: 'The catch is batch size. Verifying k plus one tokens per sequence multiplies the arithmetic, so at large batch the free compute disappears and speculation can even slow decoding down. Engines therefore shrink k, or switch it off.',
            card: { tag: 'PITFALL', title: 'Speedups shrink with batch', body: 'Verification is free only while B·(k+1) stays below the H100 ridge, about 295. In an idealized model, k = 4 stops being free at B ≈ 60 and loses to plain decoding by B ≈ 190.',
              more: '<p><b>With grammars</b>: mask both q and p with the same automaton; the matcher advances speculatively along the draft and rolls back rejected tokens (XGrammar’s matcher exposes <code>rollback(k)</code>), so exactness carries over to the masked target.</p>' },
            deep: '<div class="eq">speedup(B, k) = E(α, k) · T(B) / ( T((k+1)·B) + k·c ), &nbsp; T(n) = max(1, n / 295)</div>' +
              '<p>T(n) is the time for n token rows to stream through the weights, in units of one bandwidth-bound step; 295 is the H100 ridge (989 TFLOP/s ÷ 3.35 TB/s). With α = 0.8 and c = 0.05 the model is flat at 2.8× (k = 4) up to B ≈ 59, then falls: 1.4× at B = 128, break-even near B ≈ 190.</p>' +
              '<p>Longer drafts start higher and fall sooner: k = 8 peaks at 3.1× but breaks even at B ≈ 130; k = 2 peaks at 2.2× and holds until B ≈ 230.</p>' +
              '<details><summary>Go deeper</summary><p>Real break-even points come earlier: KV-cache reads grow with B·(k+1) and are memory-bound. Engines pick k per batch, for example by maximizing goodput (SmartSpec, later renamed TurboSpec; Liu et al.), or disable speculation above a concurrency threshold. Tree drafts (Medusa, EAGLE-2) verify more rows and hit the ridge sooner.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.s7, 400);
          S.s8 = ctx.group();
          var G = S.s8;
          var PL = ctx.group({ parent: G });
          panel(ctx, 60, 165, 720, 560, 'amber', PL);
          head(ctx, 80, 190, 'EXPECTED TOKENS PER TARGET PASS', 'amber', PL);
          function E(a, k) { return (1 - Math.pow(a, k + 1)) / (1 - a); }
          var px = 130, py = 230, pw = 600, ph = 380;
          var ks = [[2, 'cyan'], [4, 'amber'], [8, 'lime']];
          S.curves = ks.map(function (kk) {
            return ctx.plot(px, py, pw, ph, function (a) { return E(a, kk[0]); }, { xDomain: [0.3, 0.95], yDomain: [1, 7.5], color: kk[1], sw: 2.4, axes: kk[0] === 2, yLabel: 'E', parent: PL });
          });
          ctx.text(px + pw, py + ph + 40, 'acceptance rate α →', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: PL });
          [1, 2, 3, 4, 5, 6, 7].forEach(function (v) {
            var p = S.curves[0].toPx(0.3, v);
            ctx.text(px - 10, p.y, String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: PL });
          });
          [0.3, 0.5, 0.7, 0.9].forEach(function (v) {
            var p = S.curves[0].toPx(v, 1);
            ctx.text(p.x, py + ph + 16, v.toFixed(1), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: PL });
          });
          S.kLab = ks.map(function (kk, i) {
            var p = S.curves[i].toPx(0.95, E(0.95, kk[0]));
            return ctx.text(p.x + 6, Math.max(py + 8, p.y), 'k=' + kk[0], { size: 12, font: 'mono', color: kk[1], parent: PL, opacity: 0 });
          });
          S.curves.forEach(function (c) { c.curve.setAttribute('opacity', 0); });
          S.mk = ctx.group({ parent: PL });
          S.aLine = ctx.line(0, py, 0, py + ph, { color: 'white', sw: 1, dash: '4 4', parent: S.mk });
          S.dots = ks.map(function (kk) { return ctx.circle(0, 0, 6, { fill: ctx.C[kk[1]], stroke: 'white', sw: 1.5, parent: S.mk }); });
          S.aRead = ctx.text(80, 690, '', { size: 14, font: 'mono', color: 'white', parent: PL });
          function setA(a) {
            S.alpha = a;
            var x = S.curves[0].toPx(a, 1).x;
            S.aLine.setAttribute('x1', x); S.aLine.setAttribute('x2', x);
            ks.forEach(function (kk, i) { var p = S.curves[i].toPx(a, E(a, kk[0])); S.dots[i].setAttribute('cx', p.x); S.dots[i].setAttribute('cy', p.y); });
            S.aRead.textContent = 'α=' + a.toFixed(1) + '  k=4: E=' + E(a, 4).toFixed(2) + '  speedup≈' + (E(a, 4) / 1.2).toFixed(1) + '× (c=.05)';
            if (S.aBtn) S.aBtn.forEach(function (b, i) { b.setOn(Math.abs([0.6, 0.7, 0.8, 0.9][i] - a) < 1e-6); });
          }
          S.aBtn = [0.6, 0.7, 0.8, 0.9].map(function (a, i) {
            return btn(ctx, 420 + i * 88, 190, 80, 'α ' + a.toFixed(1), 'amber', PL, function () { setA(a); ctx.pulse(S.dots[1], { color: 'amber', dur: 400 }); });
          });
          setA(0.8);
          hide([S.mk, S.aRead, S.s8]);
          /* variants */
          var cards = [
            ['Medusa', 'k extra heads on h_t → tree of candidates', 'tree attention verifies the tree in one pass', 'violet'],
            ['EAGLE-1/2/3', 'draft autoregresses on target features', 'dynamic draft tree · up to ~6.5× (batch 1)', 'cyan'],
            ['MTP (DeepSeek-V3)', 'trained multi-token modules, reused as draft', '2nd-token acceptance 85–90% · ~1.8× TPS', 'lime']
          ];
          S.cards = cards.map(function (c, i) {
            var g = ctx.group({ parent: G });
            var y = 165 + i * 190;
            panel(ctx, 810, y, 750, 172, c[3], g);
            ctx.text(830, y + 28, c[0], { size: 18, font: 'display', weight: 700, color: c[3], parent: g });
            ctx.text(830, y + 58, c[1], { size: 13.5, color: 'text', parent: g });
            ctx.text(830, y + 82, c[2], { size: 13.5, color: 'dim', parent: g });
            /* glyph */
            var gx = 1240, gy = y + 95;
            ctx.rect(gx, gy - 20, 70, 40, { rx: 6, fill: ctx.alpha('amber', 0.12), stroke: 'amber', sw: 1.2, parent: g });
            ctx.text(gx + 35, gy + 0.5, i === 2 ? 'main' : 'target', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
            if (i === 0) {
              [0, 1, 2].forEach(function (k) {
                ctx.line(gx + 70, gy, gx + 120, gy - 40 + k * 40, { color: ctx.alpha('violet', 0.7), sw: 1.2, parent: g });
                ctx.rect(gx + 120, gy - 52 + k * 40, 56, 24, { rx: 5, stroke: 'violet', fill: ctx.alpha('violet', 0.12), parent: g });
                ctx.text(gx + 148, gy - 40 + k * 40, 'head' + (k + 1), { size: 11, font: 'mono', color: 'violet', anchor: 'middle', parent: g });
                ctx.line(gx + 176, gy - 40 + k * 40, gx + 206, gy - 52 + k * 40, { color: ctx.alpha('violet', 0.5), parent: g });
                ctx.line(gx + 176, gy - 40 + k * 40, gx + 206, gy - 28 + k * 40, { color: ctx.alpha('violet', 0.5), parent: g });
              });
            } else if (i === 1) {
              ctx.line(gx + 70, gy, gx + 112, gy, { color: 'cyan', sw: 1.4, arrow: true, parent: g });
              ctx.text(gx + 91, gy - 10, 'f_t', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: g });
              [0, 1, 2].forEach(function (k) {
                ctx.rect(gx + 116 + k * 62, gy - 14, 50, 28, { rx: 5, stroke: 'cyan', fill: ctx.alpha('cyan', 0.12), parent: g });
                ctx.text(gx + 141 + k * 62, gy + 0.5, 'f̂' + (k + 1), { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: g });
                if (k < 2) ctx.line(gx + 166 + k * 62, gy, gx + 178 + k * 62, gy, { color: 'cyan', sw: 1.2, arrow: true, parent: g });
              });
            } else {
              ctx.line(gx + 70, gy, gx + 100, gy, { color: 'lime', sw: 1.4, arrow: true, parent: g });
              [0, 1].forEach(function (k) {
                ctx.rect(gx + 104 + k * 88, gy - 16, 74, 32, { rx: 5, stroke: 'lime', fill: ctx.alpha('lime', 0.12), parent: g });
                ctx.text(gx + 141 + k * 88, gy + 0.5, 'MTP ' + (k + 1), { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: g });
                if (k === 0) ctx.line(gx + 178, gy, gx + 190, gy, { color: 'lime', sw: 1.2, arrow: true, parent: g });
              });
            }
            ctx.text(830, y + 140, ['≈2.2–2.8× · needs head fine-tuning', 'needs a trained draft head per model', 'free if the model was trained with MTP'][i], { size: 12, font: 'mono', color: 'dim', parent: g });
            g.setAttribute('opacity', 0);
            return g;
          });
          S.foot = [
            ctx.text(60, 780, 'n-gram / prompt-lookup drafting: copy spans from the context — zero draft cost, high α on JSON, code edits and repeated URIs', { size: 13.5, color: 'text', parent: G, opacity: 0 })
          ];
          /* batch-size panel (beat 6): idealized roofline speedup of speculation as the batch grows */
          S.PB = ctx.group({ parent: G });
          panel(ctx, 60, 165, 720, 560, 'amber', S.PB);
          head(ctx, 80, 190, 'SPECULATION SPEEDUP vs BATCH SIZE · roofline model', 'amber', S.PB);
          var RIDGE = 295, AL = 0.8, CC = 0.05;
          function Tn(n) { return Math.max(1, n / RIDGE); }
          function spdB(x, k) { var B = Math.pow(2, x); return E(AL, k) * Tn(B) / (Tn((k + 1) * B) + k * CC); }
          var bx = 130, by = 240, bw = 600, bh = 360;
          S.bcur = ks.map(function (kk) {
            return ctx.plot(bx, by, bw, bh, function (x) { return spdB(x, kk[0]); }, { xDomain: [0, 9], yDomain: [0, 3.6], color: kk[1], sw: 2.4, axes: kk[0] === 2, yLabel: 'speedup', parent: S.PB, samples: 150 });
          });
          [0, 3, 6, 9].forEach(function (x) {
            ctx.text(S.bcur[0].toPx(x, 0).x, by + bh + 18, String(Math.pow(2, x)), { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.PB });
          });
          [0, 1, 2, 3].forEach(function (v) {
            ctx.text(bx - 10, S.bcur[0].toPx(0, v).y, v + '×', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: S.PB });
          });
          ctx.text(bx + bw, by + bh + 42, 'batch size B (sequences per step, log scale) →', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.PB });
          var one = S.bcur[0].toPx(0, 1).y;
          ctx.line(bx, one, bx + bw, one, { color: 'faint', sw: 1.2, dash: '5 5', parent: S.PB });
          ctx.text(bx + 6, one - 11, '1× = plain decoding', { size: 12, font: 'mono', color: 'dim', anchor: 'start', parent: S.PB });
          S.bLab = ks.map(function (kk) {
            var p = S.bcur[0].toPx(0.25, spdB(0.25, kk[0]));
            return ctx.text(p.x + 4, p.y - 14, 'k=' + kk[0], { size: 12.5, font: 'mono', weight: 600, color: kk[1], parent: S.PB, opacity: 0 });
          });
          S.ridge = ctx.group({ parent: S.PB });
          var rx = S.bcur[0].toPx(Math.log(RIDGE / 5) / Math.LN2, 0).x;
          ctx.line(rx, by, rx, by + bh, { color: 'amber', sw: 1.3, dash: '5 5', parent: S.ridge });
          ctx.text(rx + 8, by + 12, 'k = 4: B·(k+1) = 295', { size: 12, font: 'mono', color: 'amber', parent: S.ridge });
          ctx.text(rx + 8, by + 32, 'ridge reached at B ≈ 59', { size: 12, font: 'mono', color: 'amber', parent: S.ridge });
          S.bev = ctx.group({ parent: S.PB });
          [[8, 130, -15], [4, 190, 17], [2, 230, -15]].forEach(function (b) {
            var kk = ks.filter(function (q) { return q[0] === b[0]; })[0];
            var p = S.bcur[0].toPx(Math.log(b[1]) / Math.LN2, 1);
            ctx.circle(p.x, p.y, 5, { fill: ctx.C[kk[1]], stroke: 'white', sw: 1.2, parent: S.bev });
            ctx.text(p.x, p.y + b[2], String(b[1]), { size: 12, font: 'mono', weight: 600, color: kk[1], anchor: 'middle', parent: S.bev });
          });
          ctx.text(bx + 4, by + bh - 22, 'numbers on the 1× line: break-even batch size', { size: 12, font: 'mono', color: 'dim', parent: S.bev });
          ctx.text(80, 690, 'idealized roofline: α = 0.8, c = 0.05, ridge ≈ 295 FLOP/byte (H100, bf16)', { size: 12, font: 'mono', color: 'text', parent: S.PB });
          ctx.text(80, 712, 'KV-cache traffic ignored, so real break-even points come earlier', { size: 12, font: 'mono', color: 'dim', parent: S.PB });
          hide([S.PB, S.ridge, S.bev]); S.bcur.forEach(function (c) { c.curve.setAttribute('opacity', 0); });
          /* beat 0: the plane of alpha (curves come next) */
          return ctx.reveal(S.s8, { dur: 200 }).then(function () { return ctx.reveal(PL, { from: 'left' }); }).then(function () {
            return ctx.pulse(S.aBtn[2], { color: 'amber', times: 2, dur: 500 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the expected-tokens curves for k = 2, 4, 8 */
            return Promise.all(S.curves.map(function (c) { return ctx.reveal(c.curve, { from: 'draw', dur: 900 }); }).concat([ctx.reveal(S.kLab, { delay: 700, stagger: 100 })]));
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: read the curves at alpha */
            ctx.reveal([S.mk, S.aRead], { dur: 300 });
            setA(0.6);
            return ctx.wait(700).then(function () {
              return ctx.tween(1200, function (t) { setA(0.6 + 0.3 * t); }, 'inOut');
            }).then(function () {
              setA(0.8);
              ctx.hud('α=0.8, k=4 → 3.36 tokens/pass ≈ 2.8×');
              return ctx.pulse(S.dots[1], { color: 'amber', times: 2, dur: 500 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: Medusa and EAGLE */
            ctx.hud('');
            return ctx.reveal(S.cards.slice(0, 2), { from: 'right', stagger: 250 });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: MTP and prompt lookup */
            return Promise.all([ctx.reveal(S.cards[2], { from: 'right' }), ctx.reveal(S.foot[0], { from: 'up', delay: 300 })]);
          }).then(function () { return ctx.beat(5); }).then(function () {
            /* beat 5: the batch caveat: the same speculation, now as a function of batch size */
            PL.style.pointerEvents = 'none';
            ctx.fade(PL, 0, 400);
            ctx.reveal(S.PB, { dur: 400, delay: 200 });
            return ctx.wait(500).then(function () {
              return Promise.all(S.bcur.map(function (c) { return ctx.reveal(c.curve, { from: 'draw', dur: 1000 }); }).concat([ctx.reveal(S.bLab, { delay: 700, stagger: 100 })]));
            }).then(function () {
              ctx.hud('speculation pays only while B·(k+1) < ~295');
              return Promise.all([ctx.reveal(S.ridge, { dur: 400 }), ctx.reveal(S.bev, { dur: 400, delay: 200 })]);
            });
          });
        }
      },
      /* 9 ------------------------------------------------------------------ */
      {
        title: 'Logits to action',
        beats: [
          {
            say: "Put it all together for the director's render shot call. The target model, accelerated by an EAGLE style draft, produces the logits.",
            card: { tag: 'KEY IDEA', title: 'The whole funnel, once', body: 'One tool call touches every mechanism in this chamber: draft and verify, logits, mask, processors, sampling, and validation.' },
            deep: '<p>The agent decides to call <code>render_shot</code>. What follows is the loop of this whole chamber, run about nine times for a ~30-token call (30 tokens at roughly 3.4 tokens per round): draft k tokens, verify them in one target pass, mask and sample, append, repeat.</p>' +
              '<p>The target is a 70B-class model served with an EAGLE-style draft head; the forward pass dominates the cost, everything else on the stage is bookkeeping around it.</p>'
          },
          {
            say: 'Penalties are off for JSON, the temperature is low, and the grammar mask guarantees a valid call.',
            card: { tag: 'TRADE-OFF', title: 'Settings per kind of output', body: 'JSON: T 0 to 0.3, no penalties, grammar on. Script text: T 0.8 to 1.0 with min-p. Reasoning: model-specific, constraints only on the final answer.' },
            deep: '<table><tr><th>Output</th><th>T · truncation</th><th>Constraint</th></tr>' +
              '<tr><td>tool-call JSON</td><td>0–0.3 · none</td><td>JSON-Schema grammar</td></tr>' +
              '<tr><td>script, dialogue</td><td>0.8–1.0 · min-p 0.05–0.1</td><td>none</td></tr>' +
              '<tr><td>reasoning</td><td>0.6–1.0 (model-specific) · top-p 0.95</td><td>final answer only</td></tr>' +
              '<tr><td>video-model prompt</td><td>≈0.7 · top-p 0.9</td><td>length cap, banned terms</td></tr></table>' +
              '<p>Two rules of thumb: never sample tool arguments hot, and never apply repetition penalties to structured output.</p>'
          },
          {
            say: 'Speculative verification still preserves the masked distribution, because the same mask is applied to the draft and the target.',
            card: { tag: 'KEY IDEA', title: 'Same mask, same distribution', body: 'Mask both q and p with the same automaton: rejection sampling then yields exact samples from the <b>masked</b> target, at about 3.4 tokens per pass.' },
            deep: '<p>If the draft proposed a token the grammar forbids, its masked q would be zero and it could never be drafted; the target\'s masked p is renormalized over the same legal set. The residual (p̃ − q̃)₊ lives on legal tokens only, so every emitted token is legal <i>and</i> an exact sample from the constrained target.</p>' +
              '<p>The grammar matcher advances speculatively along the draft and rolls back on rejection.</p>'
          },
          {
            say: 'The finished call streams to the orchestrator, which validates it against the schema once more and executes it.',
            card: { tag: 'HOW IT WORKS', title: 'Defense in depth', body: 'Re-validate arguments (schema plus business rules) even though decoding was constrained: some providers cannot constrain, and schemas evolve.' },
            deep: '<ul><li><b>Defense in depth</b>: the orchestrator re-validates arguments (JSON Schema + business rules: shot exists, duration ≤ budget) even though decoding was constrained. Constrained decoding may be unavailable for some models or providers, and schemas evolve.</li>' +
              '<li><b>Streaming</b>: tokens are detokenized incrementally (UTF-8 boundaries!) and streamed as <code>input_json_delta</code>-style events, so the UI can show the call forming.</li></ul>'
          },
          {
            say: 'From logits to action, in a few milliseconds per token: the forward pass dominates the cost, and the funnel decides the behavior.',
            card: { tag: 'NUMBERS', title: 'A call in a fifth of a second', stat: { v: '≈ 7 ms', l: 'per emitted token: 3.4 tokens per 24 ms round (20 ms pass + drafting)' } },
            deep: '<p><b>Latency budget</b> for this ~30-token call: prefill of the (cached) agent prompt + ≈30 / E decode rounds; with E = 3.36 (α = 0.8, k = 4) and ~24 ms per round (a 20 ms target pass plus ~4 ms of drafting), ≈0.2 s of decode, i.e. ~7 ms per emitted token.</p>' +
              '<div class="note">Deeper chambers on this path: attention and the KV cache feed the forward pass; the LLM serving engine batches thousands of these loops.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.s8, 400);
          S.s9 = ctx.group();
          var G = S.s9;
          var st = [['Target + draft', 'EAGLE · k=4', 'amber', 'brain'], ['Logits', 'fp32 · V=128k', 'amber', 'chart'], ['Grammar mask', 'XGrammar PDA', 'pink', 'lock'], ['Processors', 'no penalty · T=0.2', 'orange', 'gear'], ['Verify + sample', 'rejection sampling', 'lime', 'check'], ['Orchestrator', 'validate · execute', 'magenta', 'agent']];
          S.p9 = st.map(function (s, i) { return ctx.node({ x: 150 + i * 260, y: 300, w: 212, h: 76, title: s[0], sub: s[1], icon: s[3], color: s[2], titleSize: 15, subSize: 11, parent: G }); });
          S.l9 = [];
          for (var i = 0; i < 5; i++) S.l9.push(ctx.link(S.p9[i], S.p9[i + 1], { from: 'r', to: 'l', color: ctx.alpha('amber', 0.7), parent: G }));
          S.back = ctx.path('M' + 1430 + ',' + 262 + ' C1430,190 150,190 150,262', { stroke: ctx.alpha('amber', 0.45), sw: 1.4, dash: '5 5', arrow: true, parent: G });
          S.backT = ctx.text(790, 200, 'append accepted tokens → next forward pass (KV cache grows)', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          S.js = ctx.code({ x: 250, y: 400, w: 1100, title: 'tool_use · streamed as it decodes', lang: 'json', size: 15, color: 'lime', typing: true, maxLines: 3, parent: G, lines: nb([
            '{"type": "tool_use", "name": "render_shot",',
            ' "input": {"shot": 3, "camera": "dolly_in", "duration_s": 5}}'
          ]) });
          var chips = [['penalties OFF for JSON', 'orange'], ['T = 0.2 · top-p 1', 'amber'], ['mask ≈ tens of µs', 'pink'], ['≈3.4 tokens / target pass', 'lime'], ['schema re-validated', 'magenta']];
          S.c9 = chips.map(function (c, i) { return ctx.label(160 + i * 320, 580, c[0], { color: c[1], size: 13, parent: G }); });
          S.sum = [
            ctx.text(800, 660, 'logits  →  grammar mask  →  penalties  →  ÷T  →  top-k / top-p / min-p  →  softmax  →  sample or verify', { size: 17, font: 'mono', color: 'white', anchor: 'middle', parent: G }),
            ctx.text(800, 700, 'every token of every agent turn passes through this funnel; the forward pass dominates the cost, the funnel decides the behavior', { size: 14, color: 'dim', anchor: 'middle', parent: G }),
            ctx.text(800, 760, 'speculation changes speed, never the distribution  ·  masks change validity, not intent  ·  temperature changes diversity, not knowledge', { size: 14, color: 'amber', anchor: 'middle', parent: G })
          ];
          hide([S.s9, S.p9[2], S.p9[3], S.p9[4], S.p9[5], S.l9[1], S.l9[2], S.l9[3], S.l9[4], S.back, S.backT, S.js]); hide(S.c9); hide(S.sum);
          /* beat 0: the target model and its logits */
          return ctx.reveal(S.s9, { dur: 200 }).then(function () {
            return Promise.all([ctx.reveal([S.p9[0], S.p9[1]], { from: 'up', stagger: 110 }), ctx.reveal(S.l9[0], { from: 'draw', delay: 300 })]);
          }).then(function () {
            return ctx.packet(S.l9[0], { color: 'amber', dur: 500 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: mask, penalties, temperature */
            return Promise.all([
              ctx.reveal([S.p9[2], S.p9[3]], { from: 'up', stagger: 110 }),
              ctx.reveal([S.l9[1], S.l9[2]], { from: 'draw', delay: 300, stagger: 100 }),
              ctx.reveal(S.c9.slice(0, 3), { from: 'scale', delay: 500, stagger: 150 })
            ]).then(function () {
              return ctx.packet(S.l9[1], { color: 'amber', dur: 350 });
            }).then(function () { return ctx.packet(S.l9[2], { color: 'amber', dur: 350 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: verification with the same mask */
            return Promise.all([
              ctx.reveal(S.p9[4], { from: 'up' }),
              ctx.reveal(S.l9[3], { from: 'draw', delay: 300 }),
              ctx.reveal(S.c9[3], { from: 'scale', delay: 500 })
            ]).then(function () {
              ctx.pulse(S.p9[4], { color: 'lime', times: 2, dur: 500 });
              return ctx.packet(S.l9[3], { color: 'amber', dur: 350 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the call streams to the orchestrator */
            ctx.reveal(S.js, { from: 'up' });
            return Promise.all([
              ctx.reveal(S.p9[5], { from: 'up' }),
              ctx.reveal(S.l9[4], { from: 'draw', delay: 300 }),
              ctx.reveal(S.c9[4], { from: 'scale', delay: 700 })
            ]).then(function () {
              return Promise.all([S.js.typeAll(), ctx.packet(S.l9[4], { color: 'magenta', dur: 700, label: 'tool_use' })]);
            }).then(function () { return ctx.pulse(S.p9[5], { color: 'magenta', dur: 600 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the loop and the summary */
            return Promise.all([ctx.reveal(S.back, { from: 'draw' }), ctx.reveal(S.backT, { delay: 300 }), ctx.reveal(S.sum, { from: 'up', delay: 400, stagger: 250 })]).then(function () {
              ctx.hud('logits → action: valid tool call, ~0.2 s decode');
              return ctx.packet(S.back, { color: 'amber', dur: 900 });
            });
          });
        }
      }
    ]
  });
})();
