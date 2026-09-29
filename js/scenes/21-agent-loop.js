/* L2 — The Agent Loop: from LLM to Agent. Next-token prediction, chat templates, context assembly,
 * the sample/parse/execute/append loop, reasoning patterns, context budgeting, RL post-training, failure modes. */
(function () {
  var PX = 1440 / 200000;           /* context bar: px per token (200k window over 1440 px) */
  var BX = 80, BY = 690, BH = 36;   /* context bar geometry */
  var ORDER = ['tools', 'system', 'memory', 'task', 'summary', 'asst', 'thinking', 'results'];
  var SEGC = { tools: 'magenta', system: 'cyan', memory: 'teal', task: 'blue', summary: 'white', asst: 'amber', thinking: 'violet', results: 'orange' };
  var SEGN = { tools: 'tool schemas', system: 'system', memory: 'memory', task: 'task', summary: 'summary', asst: 'assistant', thinking: 'thinking', results: 'tool results' };
  var KCOL = { thinking: 'violet', tool_use: 'magenta', tool_result: 'orange', text: 'amber' };
  var LC = { x: 400, y: 420, r: 170 };
  var LANE_K = { T: ['violet', 26], A: ['magenta', 22], O: ['orange', 38], P: ['cyan', 120], p: ['cyan', 40], C: ['pink', 40], X: ['red', 22], V: ['lime', 22], F: ['amber', 44], t: ['violet', 70] };
  var LANES = [
    ['ReAct', 'thought → action → observation, repeated', 'TAOTAOTAOTF'],
    ['Plan-and-execute', 'plan once, execute, replan on failure', 'PAOAOAOpAOF'],
    ['Reflection', 'attempt, evaluate, reflect, retry with lesson', 'TAOAOXCTAOAOVF'],
    ['Interleaved thinking', 'think between every tool call (signed blocks)', 'tAOtAOtAOtF']
  ];

  function chipW(str, size) { return Math.max(24, str.length * size * 0.62 + 18); }

  /* small text in mid-luminance hues turns pale in the light theme (it inverts luminance); a lighter tint in the dark
   * theme becomes a deeper, readable tone there */
  function lite(ctx, c) {
    return { magenta: 1, violet: 1, red: 1, blue: 1, pink: 1 }[c] ? ctx.mix(c, 'white', 0.4) : ctx.color(c);
  }

  /* ---------- context bar ---------- */
  function drawBar(ctx, S) {
    var x = BX, tot = 0;
    ORDER.forEach(function (k) {
      var w = S.cb[k] * PX;
      S.segs[k].setAttribute('x', x);
      S.segs[k].setAttribute('width', Math.max(0, w));
      x += w; tot += S.cb[k];
    });
    S.ctxTxt.textContent = 'used ' + (tot / 1000).toFixed(1) + 'k / 200k · ' + Math.round(tot / 2000) + '%';
    S.ctxTot = tot;
  }

  function setCtx(ctx, S, tgt, ms) {
    var from = {};
    ORDER.forEach(function (k) { from[k] = S.cb[k]; });
    return ctx.tween(ms || 600, function (e) {
      for (var k in tgt) S.cb[k] = from[k] + (tgt[k] - from[k]) * e;
      drawBar(ctx, S);
    }, 'out');
  }

  /* ---------- loop helpers ---------- */
  function setStation(ctx, S, i) {
    S.st.forEach(function (n, j) {
      if (j === i) { n.body.setAttribute('filter', 'url(#fx-glow-strong)'); n.body.setAttribute('stroke-width', 2.6); }
      else { n.body.removeAttribute('filter'); n.body.setAttribute('stroke-width', 1.6); }
    });
  }

  function moveDot(ctx, S, f0, f1, ms) {
    var L = S.ringLen;
    S.dot.setAttribute('opacity', 1);
    return ctx.tween(ms, function (e) {
      var f = f0 + (f1 - f0) * e;
      var p = S.ring.getPointAtLength(L * (f - Math.floor(f)));
      S.dot.setAttribute('cx', p.x); S.dot.setAttribute('cy', p.y);
      setStation(ctx, S, Math.floor(((f % 1) + 0.1) * 5) % 5);
    }, 'inOut');
  }

  function row(ctx, S, kind, txt, turn, tagText) {
    var y = 214 + S.rowN * 46; S.rowN++;
    var col = KCOL[kind];
    var g = ctx.group({ parent: S.R });
    ctx.rect(722, y - 19, 826, 38, { rx: 6, fill: ctx.alpha(col, 0.07), stroke: ctx.alpha(col, 0.5), sw: 1, parent: g });
    ctx.label(784, y, tagText || kind, { color: col, textColor: lite(ctx, col), size: 11, w: 112, parent: g });
    g.textEl = ctx.text(850, y, txt, { size: 12, font: 'code', color: 'text', parent: g });
    if (turn) ctx.text(706, y, turn, { size: 12, font: 'mono', color: 'dim', anchor: 'middle', weight: 700, parent: g });
    g.y = y;
    ctx.reveal(g, { from: 'left', dur: 350 });
    return g;
  }

  function thumb(ctx, parent, x, y, seed) {
    var r = ctx.rng(seed);
    ctx.rect(x, y, 44, 26, { rx: 3, fill: '#0a1830', stroke: ctx.alpha('lime', 0.7), sw: 1, parent: parent });
    ctx.circle(x + 8 + r() * 26, y + 8, 4 + r() * 3, { fill: ctx.alpha('cyan', 0.55), parent: parent });
    ctx.poly([[x + 16 + r() * 10, y + 24], [x + 22 + r() * 8, y + 12], [x + 30 + r() * 8, y + 24]], { fill: ctx.alpha('orange', 0.8), parent: parent });
  }

  /* multi-colour template line: special tokens magenta, tags violet, role names amber */
  function rich(ctx, parent, x, y, str, size) {
    var t = ctx.text(x, y, '', { size: size, font: 'code', color: 'text', parent: parent });
    var parts = str.split(/(<\|[a-z_]+\|>|<\/?(?:tools|think|tool_call|tool_response)>)/);
    var prevStart = false;
    parts.forEach(function (p) {
      if (!p) return;
      var c = null;
      if (/^<\|/.test(p)) c = ctx.C.magenta;
      else if (/^<\/?[a-z_]+>$/.test(p)) c = ctx.C.violet;
      else if (prevStart) c = ctx.C.amber;
      var ts = ctx.el('tspan', c ? { fill: c, 'font-weight': 700 } : {}, t);
      ts.textContent = p;
      prevStart = p === '<|im_start|>';
    });
    return t;
  }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.94)', stroke: ctx.alpha(color, 0.6), parent: g });
    ctx.text(x + 16, y + 22, title, { size: 14, font: 'display', weight: 700, color: lite(ctx, color), parent: g });
    g.box = { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h };
    return g;
  }

  /* one lane of the reasoning-pattern chart; resolves when its blocks have appeared */
  function lane(ctx, S, R, i) {
    var ln = LANES[i];
    var y = 250 + i * 98;
    var g = ctx.group({ parent: R, opacity: 0 });
    ctx.text(712, y - 24, ln[0], { size: 15, font: 'display', weight: 700, color: 'white', parent: g });
    ctx.text(1544, y - 24, ln[1], { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: g });
    ctx.line(712, y + 14, 1544, y + 14, { color: 'line', sw: 1, parent: g });
    var x = 712, all = [ctx.reveal(g, { dur: 300 })];
    ln[2].split('').forEach(function (c, j) {
      var k = LANE_K[c];
      var b = ctx.group({ parent: g });
      ctx.rect(x, y - 2, k[1], 26, { rx: 4, fill: ctx.alpha(k[0], c === 'O' ? 0.3 : 0.6), stroke: k[0], sw: 1, parent: b });
      if (c === 'X') ctx.text(x + 11, y + 11, '✗', { size: 13, color: 'white', anchor: 'middle', parent: b });
      if (c === 'V') ctx.text(x + 11, y + 11, '✓', { size: 13, color: '#05080f', anchor: 'middle', parent: b });
      if (c === 'P') ctx.text(x + 60, y + 11, 'plan: 6 shots', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: b });
      if (c === 'C') ctx.text(x + 20, y + 11, 'note', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: b });
      all.push(ctx.reveal(b, { from: 'left', delay: 300 + j * 150, dur: 250, dist: 8 }));
      x += k[1] + 4;
    });
    return Promise.all(all);
  }

  Atlas.register({
    id: 'agent-loop',
    refs: [
      'Yao et al., <i>ReAct: Synergizing Reasoning and Acting in Language Models</i>, ICLR 2023',
      'Shinn et al., <i>Reflexion: Language Agents with Verbal Reinforcement Learning</i>, NeurIPS 2023',
      'Wang et al., <i>Plan-and-Solve Prompting: Improving Zero-Shot Chain-of-Thought Reasoning by Large Language Models</i>, ACL 2023',
      'Schick et al., <i>Toolformer: Language Models Can Teach Themselves to Use Tools</i>, NeurIPS 2023',
      'Shao et al., <i>DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models</i> (GRPO), 2024',
      'DeepSeek-AI, <i>DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning</i>, 2025',
      'Yu et al., <i>DAPO: An Open-Source LLM Reinforcement Learning System at Scale</i>, 2025',
      'Liu et al., <i>Understanding R1-Zero-Like Training: A Critical Perspective</i> (Dr. GRPO), 2025',
      'Liu et al., <i>Lost in the Middle: How Language Models Use Long Contexts</i>, TACL 2024',
      'Hong, Troynikov &amp; Huber, <i>Context Rot: How Increasing Input Tokens Impacts LLM Performance</i>, Chroma Research 2025',
      'Anthropic, <i>Effective context engineering for AI agents</i>, 2025',
      'Anthropic, <i>Claude API documentation: prompt caching, extended thinking, tool use, vision and context editing</i>, 2025–2026',
      'Packer et al., <i>MemGPT: Towards LLMs as Operating Systems</i>, 2023'
    ],
    setup: function (ctx) {
      /* show <|im_start|> etc. literally (the mono font would ligate "<|" and "|>") */
      ctx.layer.style.fontVariantLigatures = 'none';
    },
    steps: [
      /* 1 ---------------------------------------------------------------- */
      {
        title: 'Next-token predictor',
        beats: [
          {
            say: 'Start with what a language model actually is: a function that, given a sequence of tokens, returns a probability distribution over the next one.',
            card: { tag: 'KEY IDEA', title: 'A function from prefix to distribution', body: 'A decoder maps every token prefix to a probability vector over the whole vocabulary. The only state it carries between steps is the KV cache.' },
            deep: '<div class="eq">p<sub>θ</sub>(x<sub>1:T</sub>) = ∏<sub>t</sub> p<sub>θ</sub>(x<sub>t</sub> | x<sub>&lt;t</sub>)</div>' +
              '<p>The network emits logits <b>z</b><sub>t</sub> ∈ ℝ<sup>|V|</sup> (|V| is around 10<sup>5</sup>) for the next position, and a softmax turns them into probabilities. With a KV cache each step attends over all t previous positions, O(t·d) per layer, instead of recomputing the whole prefix.</p>'
          },
          {
            say: 'Sample a token, append it, and repeat. Nothing in that loop acts on the world: the model only ever extends text.',
            card: { tag: 'TRY IT', title: 'Turn the temperature dial', body: 'Click the distribution panel to cycle τ through 0.5, 1.0 and 1.5. Low τ sharpens the bars toward greedy decoding; high τ flattens them and the model gets adventurous.' },
            deep: '<div class="eq">x<sub>t</sub> ~ softmax(z<sub>t</sub> / τ)</div>' +
              '<p>Temperature τ reshapes the distribution: τ → 0 approaches greedy argmax, τ = 1 samples the model\'s own distribution. Since softmax(z/τ) ∝ p<sup>1/τ</sup>, the bars you see are just the probabilities raised to 1/τ and renormalised over the five shown tokens. Tool-calling turns are often run at low temperature so arguments stay stable.</p>' +
              '<p>Each step costs one forward pass, about 10–50 ms per token for a large model. The floor is memory, not arithmetic.</p>' +
              '<details><summary>Go deeper</summary><p>At batch size 1 every generated token streams all weights from HBM once. A 70B model in FP8 is 70 GB; at 3.35 TB/s (H100 SXM) that is about 21 ms per token before any KV-cache traffic. That is why batching many requests together, not faster arithmetic, is the main lever for serving cost.</p></details>'
          },
          {
            say: 'But suppose the model has learned that when it needs information, it should emit a special token that opens a tool call.',
            card: { tag: 'KEY IDEA', title: 'A token that means act', body: 'The opener of a tool call is an ordinary vocabulary entry. Post-training teaches the model when its probability should spike: here from 0.12 to 0.71.' },
            deep: '<p>Special tokens such as <code>&lt;tool_call&gt;</code> or <code>&lt;&#8202;|im_end|&#8202;&gt;</code> are ordinary vocabulary entries whose meaning is fixed by post-training and by the harness parser. Toolformer (Schick et al., 2023) showed the idea in miniature: a model can be taught to insert API calls exactly where doing so lowers its own next-token loss.</p>' +
              '<p>Modern models learn the same behaviour from supervised tool trajectories and reinforcement learning (step 7), not from self-annotation, but the mechanism is identical: emitting the token <i>is</i> the decision to act.</p>'
          },
          {
            say: 'A surrounding program, the harness, watches for that token, stops sampling, and takes over. It parses the call, runs it, and feeds the result back.',
            card: { tag: 'HOW IT WORKS', title: 'The model proposes, the harness acts', body: 'The model never executes anything. It only proposes structured text; the harness owns the network, the credentials, the timeouts and the retries.' },
            deep: '<p>An <b>agent</b> wraps a second, outer loop around the decoder:</p>' +
              '<table><tr><th></th><th>Inner loop (decoder)</th><th>Outer loop (harness)</th></tr>' +
              '<tr><td>unit</td><td>token → token</td><td>turn → turn</td></tr>' +
              '<tr><td>period</td><td>~10–50 ms</td><td>seconds to minutes</td></tr>' +
              '<tr><td>state</td><td>KV cache</td><td>context + external memory</td></tr>' +
              '<tr><td>ends at</td><td>stop token</td><td>end_turn, budget, max turns</td></tr></table>'
          },
          {
            say: 'That small contract is the seed of every agent: a language model, tools, a loop that feeds observations back, memory, and a stop rule.',
            card: { tag: 'KEY IDEA', title: 'Agent: LLM, tools, loop, memory, stop', body: 'The inner loop runs in milliseconds per token. The outer loop runs in seconds to minutes per turn, and that is where agent engineering lives.' },
            deep: '<div class="note">Agent = LLM + tools + a loop that feeds observations back + memory + a stop rule.</div>' +
              '<p>Every later step in this chamber is one of those five parts made concrete: the template and context builder (memory and prompt), the loop itself, reasoning patterns, budgeting, training, and failure handling.</p>' +
              '<details><summary>Go deeper</summary><p>Formally an agent is a policy over histories in a partially observed decision process: <b>a<sub>t</sub> ~ π<sub>θ</sub>(· | h<sub>t</sub>)</b> with h<sub>t</sub> = (o<sub>1</sub>, a<sub>1</sub>, …, o<sub>t</sub>). The language model is π<sub>θ</sub>, the context window is a lossy, length-limited encoding of h<sub>t</sub>, and the tools are the environment that produces o<sub>t</sub>. Context management is therefore state estimation.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = S.g1 = ctx.group();
          var lbl = ctx.text(70, 198, 'CONTEXT  x<t', { size: 12, font: 'mono', color: 'dim', weight: 600, parent: G, spacing: 1.5 });
          S.sx = 70;
          var addTok = function (str, kind, parent) {
            var w = chipW(str, 12), cx = S.sx + w / 2;
            S.sx += w + 6;
            var col = kind === 'sp' ? 'magenta' : (kind === 'role' ? 'amber' : (kind === 'gen' ? 'lime' : 'cyan'));
            var l = ctx.label(cx, 232, str, { color: col, size: 12, font: 'code', parent: parent || G });
            l.cx = cx;
            return l;
          };
          var toks = [['<|im_start|>', 'sp'], ['user', 'role'], ['Storyboard', 't'], ['shot', 't'], ['3', 't'], ['<|im_end|>', 'sp'], ['<|im_start|>', 'sp'], ['assistant', 'role']];
          var chips = toks.map(function (t) { return addTok(t[0], t[1]); });
          S.llm = ctx.node({ x: 520, y: 480, w: 320, h: 150, color: 'amber', parent: G });
          ctx.text(520, 425, 'TRANSFORMER · L layers', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', weight: 600, parent: S.llm });
          S.layers = [];
          for (var i = 0; i < 5; i++) S.layers.push(ctx.rect(392, 440 + i * 14, 256, 9, { rx: 3, fill: ctx.alpha('amber', 0.22), stroke: ctx.alpha('amber', 0.5), sw: 0.8, parent: S.llm }));
          var pe = ctx.text(520, 532, '', { size: 17, font: 'mono', color: 'white', anchor: 'middle', parent: S.llm });
          [['p(x', 0], ['t', 1], [' | x', 0], ['<t', 1], [')', 0]].forEach(function (p) {
            var ts = ctx.el('tspan', p[1] ? { 'baseline-shift': 'sub', 'font-size': 12 } : {}, pe);
            ts.textContent = p[0];
          });
          S.aIn = ctx.line(520, 252, 520, 400, { color: 'amber', arrow: true, sw: 1.6, parent: G });
          S.aOut = ctx.line(682, 480, 818, 480, { color: 'amber', arrow: true, sw: 1.6, parent: G });
          var lz = ctx.text(750, 468, 'logits z', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          var D = S.dist = ctx.group({ parent: G });
          ctx.rect(820, 380, 440, 220, { rx: 10, fill: 'rgba(8,14,28,0.9)', stroke: ctx.alpha('amber', 0.5), parent: D });
          ctx.text(840, 402, 'next-token distribution · softmax(z / τ)', { size: 12, font: 'mono', color: 'amber', parent: D });
          S.drows = [];
          for (var k = 0; k < 5; k++) {
            var y = 438 + k * 34;
            S.drows.push({
              lab: ctx.text(962, y, '', { size: 12, font: 'code', color: 'text', anchor: 'end', parent: D }),
              bg: ctx.rect(972, y - 8, 230, 16, { rx: 3, fill: 'rgba(255,255,255,0.05)', parent: D }),
              bar: ctx.rect(972, y - 8, 0, 16, { rx: 3, fill: ctx.alpha('amber', 0.45), parent: D }),
              p: ctx.text(1248, y, '', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: D })
            });
          }
          var rounds = [
            [['I', 0.41], ['Let', 0.22], ['The', 0.15], ['<tool_call>', 0.12], ['First', 0.05]],
            [['need', 0.58], ['will', 0.21], ['should', 0.09], ['can', 0.06], ['want', 0.03]],
            [['refs', 0.37], ['the', 0.33], ['to', 0.15], ['a', 0.08], ['more', 0.04]],
            [['<tool_call>', 0.71], ['.', 0.12], ['first', 0.08], ['before', 0.05], [':', 0.02]]
          ];
          /* temperature: the bars show p^(1/tau), renormalised over the five tokens shown (click the panel to cycle tau) */
          var TAUS = [0.5, 1, 1.5];
          S.tau = 1; S.round = null;
          var probs = function (rd) {
            if (S.tau === 1) return rd.map(function (c) { return c[1]; });
            var q = rd.map(function (c) { return Math.pow(c[1], 1 / S.tau); });
            var zs = q.reduce(function (a, b) { return a + b; }, 0);
            return q.map(function (v) { return v / zs; });
          };
          var paint = function (rd, ms) {
            var p = probs(rd);
            S.round = rd;
            return Promise.all(rd.map(function (c, j) {
              var R = S.drows[j], w0 = parseFloat(R.bar.getAttribute('width')) || 0;
              R.lab.textContent = c[0];
              R.lab.setAttribute('fill', /^</.test(c[0]) ? ctx.C.magenta : ctx.C.text);
              R.p.textContent = p[j].toFixed(2);
              return ctx.animate(R.bar, { width: [w0, 230 * p[j]] }, ms, 'out');
            }));
          };
          var tauChip = ctx.label(1205, 402, 'τ = 1.0', { color: 'amber', size: 12, w: 74, parent: D });
          D.style.cursor = 'pointer';
          D.addEventListener('click', function () {
            S.tau = TAUS[(TAUS.indexOf(S.tau) + 1) % TAUS.length];
            tauChip.setText('τ = ' + S.tau.toFixed(1));
            if (S.round) paint(S.round, 300);
          });
          /* the distribution for the next token: bars grow, layers flash (one forward pass) */
          var showDist = function (rd) {
            rd.forEach(function (c, j) { S.drows[j].bar.setAttribute('fill', ctx.alpha('amber', 0.45)); });
            var anim = paint(rd, 350);
            S.layers.forEach(function (l, li) { ctx.animate(l, { opacity: [1, 0.35] }, 160, 'linear', li * 50).then(function () { l.setAttribute('opacity', 1); }); });
            return anim;
          };
          /* pick the top token and append it to the context */
          var sampleTok = function (rd, idx) {
            S.drows[0].bar.setAttribute('fill', idx === 3 ? ctx.C.magenta : ctx.C.amber);
            var str = rd[0][0], w = chipW(str, 12), cx = S.sx + w / 2;
            S.sx += w + 6;
            var fg = ctx.group({ parent: G });
            ctx.label(0, 0, str, { color: idx === 3 ? 'magenta' : 'lime', size: 12, font: 'code', parent: fg, bgAlpha: idx === 3 ? 0.35 : 0.14 });
            ctx.place(fg, 930, 438);
            S.lastTok = fg;
            return ctx.transform(fg, { x: cx, y: 232 }, 550, 'inOut');
          };
          var step = function (rd, i) { return showDist(rd).then(function () { return ctx.wait(150); }).then(function () { return sampleTok(rd, i); }).then(function () { return ctx.wait(150); }); };
          /* beat 0: the function from a prefix to a distribution */
          ctx.reveal([lbl].concat(chips), { from: 'up', stagger: 60 });
          ctx.reveal(S.llm, { from: 'scale', delay: 300 });
          ctx.reveal([S.aIn, S.aOut, lz], { from: 'draw', delay: 500, stagger: 200 });
          return ctx.reveal(D, { from: 'right', delay: 600 }).then(function () {
            return showDist(rounds[0]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: sample, append, repeat */
            return sampleTok(rounds[0], 0).then(function () { return step(rounds[1], 1); }).then(function () { return step(rounds[2], 2); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the special token appears */
            return step(rounds[3], 3).then(function () {
              return ctx.pulse(S.lastTok, { color: 'magenta', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the harness takes over */
            S.harness = ctx.node({ x: 1420, y: 490, w: 250, h: 84, title: 'Harness', sub: 'stop · parse · execute', icon: 'loop', color: 'magenta', parent: G });
            S.aH = ctx.link({ x: 1262, y: 490 }, S.harness, { color: 'magenta', straight: true, parent: G });
            var t1 = ctx.text(1420, 560, 'the model only emits tokens;', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
            var t2 = ctx.text(1420, 578, 'the harness acts on them', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
            S.halt = ctx.label(750, 436, 'sampling halts', { color: 'red', size: 11, parent: G });
            return Promise.all([
              ctx.reveal(S.harness, { from: 'left' }), ctx.reveal(S.aH, { from: 'draw', delay: 200 }),
              ctx.reveal([t1, t2], { delay: 400 }), ctx.reveal(S.halt, { from: 'scale', delay: 200 }),
              ctx.fade(S.llm, 0.55, 600)
            ]).then(function () {
              return ctx.pulse(S.harness, { color: 'magenta', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the agent equation and the two loops */
            var eq = ctx.group({ parent: G });
            var parts = [['LLM', 'amber'], ['+', null], ['tools', 'magenta'], ['+', null], ['loop', 'cyan'], ['+', null], ['memory', 'teal'], ['+', null], ['stop rule', 'pink'], ['=', null], ['AGENT', 'white']];
            var x = 420;
            parts.forEach(function (p) {
              if (p[1]) { var w = chipW(p[0], 15); ctx.label(x + w / 2, 700, p[0], { color: p[1], size: 15, parent: eq }); x += w + 12; }
              else { ctx.text(x + 4, 700, p[0], { size: 20, font: 'mono', color: 'dim', anchor: 'middle', parent: eq }); x += 22; }
            });
            ctx.text(715, 748, 'inner loop: token → token, milliseconds  ·  outer loop: turn → turn, seconds to minutes', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: eq });
            return ctx.reveal(eq, { from: 'up', dur: 700 });
          });
        }
      },
      /* 2 ---------------------------------------------------------------- */
      {
        title: 'Chat template',
        beats: [
          {
            say: 'Before the model sees anything, the conversation is serialized into one flat token sequence by a chat template.',
            card: { tag: 'KEY IDEA', title: 'A conversation becomes one string', body: 'Messages, roles and tool schemas are all flattened into a single sequence. The template is part of the interface contract of the model.' },
            deep: '<p>The chat template is part of the model\'s interface contract (shipped as Jinja in <code>tokenizer_config.json</code> for open models). ChatML (Qwen) uses <code>&lt;&#8202;|im_start|&#8202;&gt;role … &lt;&#8202;|im_end|&#8202;&gt;</code>; Llama 3.1 uses <code>&lt;&#8202;|start_header_id|&#8202;&gt;role&lt;&#8202;|end_header_id|&#8202;&gt;</code>, an <code>ipython</code> role for tool output, <code>&lt;&#8202;|python_tag|&#8202;&gt;</code> before built-in tool calls and <code>&lt;&#8202;|eom_id|&#8202;&gt;</code> for "message ends, expect a tool result" (versus <code>&lt;&#8202;|eot_id|&#8202;&gt;</code>, end of turn).</p>'
          },
          {
            say: 'Special tokens mark where each message starts and ends and which role wrote it: system, user, assistant, or tool. Each one is a single entry in the vocabulary.',
            card: { tag: 'NUMBERS', title: 'A role boundary is one integer', stat: { v: '151644', l: 'the single token ID of the message-start marker in Qwen2, not a string of characters' }, more: '<p>Special tokens are atomic only when the tokenizer is told so. Encoding untrusted text with special tokens disabled turns a user-typed "&lt;|im_start|&gt;" into ordinary characters, which is exactly what stops role spoofing. A serving stack must never enable special-token parsing for user input.</p>' },
            deep: '<ul><li>Each special token is a <b>single ID</b> (for example <code>&lt;&#8202;|im_start|&#8202;&gt;</code> = 151644 in Qwen2). If the tokenizer refuses to produce special IDs from raw user text, role boundaries cannot be spoofed by typing them.</li>' +
              '<li>The flat view below the template is what the model actually receives: a vector of integers. Roles, tags and JSON all become positions in one sequence, and attention is the only thing that tells them apart.</li></ul>'
          },
          {
            say: 'Tool definitions are rendered into the system section, the tool calls of the model appear as tagged JSON, and tool results come back as another message.',
            card: { tag: 'HOW IT WORKS', title: 'Tools ride inside the same string', body: 'Schemas go into the system section, calls come out as tagged JSON, and results return as a message with a tool or user role, depending on the template.' },
            deep: '<p>Open templates differ in where they put the machinery. Qwen renders the tool list inside a <code>&lt;tools&gt;</code> block of the system message and expects <code>&lt;tool_call&gt;</code> JSON back; the result is wrapped in <code>&lt;tool_response&gt;</code> inside a user-role turn. Llama 3.1 uses a dedicated <code>ipython</code> role for results and <code>&lt;&#8202;|eom_id|&#8202;&gt;</code> to say "expect a tool result".</p>' +
              '<p>Hosted APIs hide all of this and expose typed <b>content blocks</b>: <code>text</code>, <code>thinking</code>, <code>tool_use</code>, <code>tool_result</code>.</p>'
          },
          {
            say: 'During fine tuning, only the assistant tokens receive loss, so the model learns to produce actions, not to imitate tool outputs.',
            card: { tag: 'PITFALL', title: 'Train and serve templates must match', body: 'A missing generation prompt, stray whitespace or a different tool-schema rendering is a silent quality bug. Nothing errors; the model just gets worse.' },
            deep: '<div class="eq">L = −Σ<sub>t</sub> m<sub>t</sub> log p(x<sub>t</sub> | x<sub>&lt;t</sub>)</div>' +
              '<p><b>Loss masking</b>: SFT minimises L with m<sub>t</sub> = 1 only on assistant tokens (including its end token), and 0 on system, user and tool tokens. The model is graded on the actions it should take, not on predicting what a tool will print.</p>' +
              '<p>A mismatch between training and serving templates (missing generation prompt, whitespace, tool-schema rendering) is a classic silent quality bug: the model sees a prompt shape it never trained on.</p>'
          },
          {
            say: 'The same action has several wire formats: ChatML tags, Llama header tokens, or the typed content blocks of a hosted API. The parser must match the template the model was trained on.',
            card: { tag: 'HOW IT WORKS', title: 'One action, three wire formats', body: 'The harness parser has to speak whichever dialect the model was trained on, or a perfectly good tool call is silently dropped.' },
            deep: '<p>Serving engines ship per-model <b>tool-call parsers</b> for this reason (for example vLLM\'s <code>--tool-call-parser</code>): they turn tagged text back into structured calls. Hosted APIs perform the same step server-side and return <code>tool_use</code> blocks with a parsed <code>input</code> object.</p>' +
              '<p>Practical rule: never hand-build the prompt string for a chat model. Use the tokenizer\'s <code>apply_chat_template</code> (or the API) so the training-time template is reproduced exactly.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.g1, 400);
          var G = S.g2 = ctx.group();
          var PN = ctx.group({ parent: G });
          ctx.rect(60, 172, 960, 306, { rx: 10, fill: 'rgba(6,12,24,0.94)', stroke: ctx.alpha('cyan', 0.5), parent: PN });
          ctx.rect(60, 172, 960, 28, { rx: 10, fill: ctx.alpha('cyan', 0.12), parent: PN });
          ctx.text(78, 186, 'chat template (ChatML / Qwen-style) · what the tokenizer receives', { size: 12, font: 'mono', color: 'cyan', parent: PN });
          var L = [
            ['<|im_start|>system', 0], ['You are the Storyboard agent of job 7f3a. Plan shots, then call tools.', 0],
            ['<tools>[{"name":"search_assets",...}]</tools><|im_end|>', 0],
            ['<|im_start|>user', 1], ['Storyboard 6 shots: fox astronaut crash-lands on a glowing ice moon.<|im_end|>', 1],
            ['<|im_start|>assistant', 2], ['<think>Need the character sheet before drawing keyframes.</think>', 2],
            ['<tool_call>{"name":"search_assets","arguments":{…}}</tool_call><|im_end|>', 2],
            ['<|im_start|>user', 3], ['<tool_response>{"hits":["fox_sheet@7c1e",…]}</tool_response><|im_end|>', 3],
            ['<|im_start|>assistant', 4]
          ];
          var lineY = function (i) { return 220 + i * 24; };
          var lines = L.map(function (l, i) { return rich(ctx, G, 76, lineY(i), l[0], 14); });
          /* beat 0: the conversation is serialized, line by line */
          ctx.reveal(PN, { from: 'up', dur: 350 });
          return ctx.reveal(lines, { from: 'left', stagger: 180, dur: 300, dist: 12 }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: role brackets and the flat token sequence */
            ctx.text(1050, 186, 'ROLE', { size: 12, font: 'mono', color: 'dim', weight: 600, parent: G, spacing: 1.5 });
            var groups = [[0, 2, 'system', 'cyan'], [3, 4, 'user', 'blue'], [5, 7, 'assistant', 'amber'], [8, 9, 'tool (user role)', 'teal'], [10, 10, 'gen. prompt', 'amber']];
            S.groups = groups;
            var br = groups.map(function (g) {
              var b = ctx.group({ parent: G });
              var y0 = lineY(g[0]) - 8, y1 = lineY(g[1]) + 8, ym = (y0 + y1) / 2;
              ctx.path('M1036,' + y0 + ' H1044 V' + y1 + ' H1036', { color: g[3], sw: 1.6, parent: b });
              ctx.label(1054, ym, g[2], { color: g[3], size: 11, anchor: 'start', parent: b });
              return b;
            });
            var hd = ctx.text(60, 514, 'WHAT THE MODEL SEES · one flat sequence of integer token IDs', { size: 12, font: 'mono', color: 'dim', weight: 600, parent: G, spacing: 1 });
            S.tokM = ctx.matrix(150, 536, 2, 64, { cell: 17, gap: 3, values: function () { return 'rgba(255,255,255,0.04)'; }, rowLabels: ['tokens', 'loss'], parent: G });
            var hint = ctx.text(60, 598, '<|im_start|> is one ID (151644 in Qwen2), never typed characters', { size: 12, font: 'mono', color: 'dim', parent: G });
            S.seg = function (c) { if (c <= 15) return 0; if (c <= 22) return 1; if (c <= 38) return 2; if (c <= 54) return 3; if (c <= 57) return 4; return 5; };
            S.special = [0, 15, 16, 22, 23, 38, 39, 54, 55];
            S.colOf = function (c) {
              if (S.special.indexOf(c) >= 0) return ctx.C.magenta;
              return [ctx.alpha('cyan', 0.55), ctx.alpha('blue', 0.6), ctx.alpha('amber', 0.6), ctx.alpha('teal', 0.55), ctx.alpha('amber', 0.3), 'rgba(255,255,255,0.04)'][S.seg(c)];
            };
            return Promise.all([
              ctx.reveal(br, { from: 'left', stagger: 250 }), ctx.reveal([hd, S.tokM, hint], { stagger: 150, delay: 300 }),
              ctx.wait(900).then(function () {
                return ctx.tween(1600, function (e) {
                  var k = Math.round(e * 64);
                  for (var c = 0; c < 64; c++) S.tokM.cells[0][c].setAttribute('fill', c < k ? S.colOf(c) : 'rgba(255,255,255,0.04)');
                }, 'linear');
              })
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: where tools live inside the template */
            var notes = [[2, 'magenta', 'tool schemas', 700], [7, 'violet', 'proposed call', 870], [9, 'orange', 'tool result', 840]];
            var all = [];
            notes.forEach(function (n) {
              all.push(ctx.highlight(lines[n[0]], { color: n[1], pad: 3, parent: G, rx: 5 }));
              var c = ctx.label(n[3], lineY(n[0]) + 0, n[2], { color: n[1], size: 11, anchor: 'start', parent: G, opacity: 0 });
              all.push(ctx.reveal(c, { from: 'left', delay: 300 }));
            });
            return Promise.all(all).then(function () { return ctx.wait(400); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: only assistant tokens receive loss */
            ctx.text(1255, 186, 'SFT LOSS', { size: 12, font: 'mono', color: 'dim', weight: 600, parent: G, spacing: 1.5 });
            var lossG = S.groups.map(function (g, i) {
              var y0 = lineY(g[0]) - 8, y1 = lineY(g[1]) + 8, ym = (y0 + y1) / 2;
              var on = i === 2;
              return ctx.label(1255, ym, on ? 'loss ✓' : 'masked', { color: on ? 'lime' : 'dim', size: 11, anchor: 'start', w: 76, parent: G, opacity: 0 });
            });
            var hint2 = ctx.text(60, 622, 'loss only where the model must learn to act', { size: 12, font: 'mono', color: 'lime', parent: G, opacity: 0 });
            return Promise.all([
              ctx.reveal(lossG, { from: 'left', stagger: 250 }), ctx.reveal(hint2, { delay: 300 }),
              ctx.tween(1400, function (e) {
                var k = Math.round(e * 64);
                for (var c = 0; c < 64; c++) {
                  var trained = c >= 25 && c <= 38;
                  S.tokM.cells[1][c].setAttribute('fill', c < k ? (trained ? ctx.C.lime : 'rgba(255,255,255,0.07)') : 'rgba(255,255,255,0.04)');
                }
              }, 'linear')
            ]);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the same action in three dialects */
            var dial = [
              [60, 'amber', 'ChatML · Qwen 2.5 / 3', ['<|im_start|>assistant', '<tool_call>{"name": …, "arguments": {…}}</tool_call>', 'result: user turn wrapped in <tool_response>'], true],
              [565, 'cyan', 'Llama 3.1 · built-in tools', ['<|start_header_id|>assistant<|end_header_id|>', '<|python_tag|>brave_search.call(query="…")<|eom_id|>', 'result: <|start_header_id|>ipython<|end_header_id|>'], true],
              [1070, 'magenta', 'Hosted API · typed content blocks', ['assistant: [thinking, text, tool_use{id, name, input}]', 'user: [tool_result{tool_use_id, content, is_error}]', 'template applied server-side, never visible'], false]
            ];
            S.dial = dial.map(function (d) {
              var cg = card(ctx, G, d[0], 686, 470, 126, d[1], d[2]);
              d[3].forEach(function (s, i) {
                if (d[4]) rich(ctx, cg, d[0] + 16, 726 + i * 24, s, 12);
                else ctx.text(d[0] + 16, 726 + i * 24, s, { size: 12, font: 'code', color: 'text', parent: cg });
              });
              return cg;
            });
            var dialH = ctx.text(60, 664, 'SAME ACTION, THREE WIRE FORMATS · the harness parser must match the template the model was trained on', { size: 12, font: 'mono', color: 'dim', weight: 600, parent: G, spacing: 1 });
            return ctx.reveal([dialH].concat(S.dial), { from: 'up', stagger: 200 });
          });
        }
      },
      /* 3 ---------------------------------------------------------------- */
      {
        title: 'Context assembly',
        beats: [
          {
            say: 'Each turn, a context builder assembles what the model will see, pulling from five sources: tool schemas, the system prompt, retrieved memory, the task, and the running history.',
            card: { tag: 'KEY IDEA', title: 'The prompt is built, not written', body: 'A context builder selects the smallest set of high-signal tokens for the next step. Nothing enters the window by accident.' },
            deep: '<p>Context engineering = choosing the smallest set of high-signal tokens for the next step. Typical request for this agent:</p>' +
              '<table><tr><th>Segment</th><th>Tokens</th><th>Changes</th></tr>' +
              '<tr><td>Tool schemas</td><td>~3.4k</td><td>per deployment</td></tr>' +
              '<tr><td>System prompt</td><td>~2.1k</td><td>per agent role</td></tr>' +
              '<tr><td>Retrieved memory</td><td>~4k</td><td>per task</td></tr>' +
              '<tr><td>Task + history + observations</td><td>grows every turn</td><td>every turn</td></tr></table>'
          },
          {
            say: 'The stable part comes first: tool schemas, then the system prompt with the role and rules of the agent. Retrieved memory, such as the fox character sheet, and the task follow, then the conversation so far.',
            card: { tag: 'HOW IT WORKS', title: 'Stable first, volatile last', body: 'Tools, then system, then messages. That order is the cache key: anything that changes early invalidates everything after it.' },
            deep: '<p>The assembled request is ordinary structured data. Prompt caching keys on an exact prefix in the order <b>tools → system → messages</b>, so the builder places the slow-changing segments first and the per-turn material last.</p>' +
              '<p>Anything volatile (timestamps, request IDs, a shuffled tool order) must go <i>after</i> the cache breakpoint, or the hit rate collapses to zero without any visible error.</p>'
          },
          {
            say: 'Everything the agent knows at this moment must fit inside a fixed budget: two hundred thousand tokens here, with room reserved for the reply.',
            card: { tag: 'NUMBERS', title: 'The first request', stat: { v: '9.8k', u: 'of 200k', l: 'tokens in turn one: 3.4k tools, 2.1k system, 4k memory, 0.3k task' }, more: '<p>3.4k + 2.1k + 4k + 0.3k = 9.8k, only 5% of the window. Of that, 5.5k (tools plus system) is the cacheable prefix; the other 4.3k changes per task. The reserved 16k for output is subtracted from the budget before any history is admitted.</p>' },
            deep: '<div class="eq">prompt tokens + max_tokens ≤ context window</div>' +
              '<p>Output (including thinking) is reserved up front, here 16k of the 200k window, so the usable prompt budget is 184k. The bar below is the same window drawn to scale; it will fill turn by turn and is the key resource the rest of this chamber manages.</p>' +
              '<details><summary>Go deeper</summary><p>Why the window is a real budget: the KV cache costs 2 · L · n<sub>kv</sub> · d<sub>head</sub> · bytes per token. For a 70B-class model with grouped-query attention (80 layers, 8 KV heads, head dimension 128, FP16) that is 2 × 80 × 8 × 128 × 2 B = 320 KiB per token, so one 200k-token sequence holds about 65 GB of KV cache, most of an 80 GB H100\'s memory. Long contexts are paid for in GPU memory, not just in tokens.</p></details>'
          },
          {
            say: 'Order matters, because the provider can cache the longest unchanged prefix. Later turns then read those first five and a half thousand tokens at a tenth of the price.',
            card: { tag: 'NUMBERS', title: 'Cached reads are cheap', stat: { v: '0.1×', l: 'input price for reading a cached prefix on most Claude models; a five-minute cache write costs 1.25×' } },
            deep: '<p><b>Prompt caching</b> keys on an exact prefix in the order tools → system → messages. With a breakpoint after the system prompt, later turns read that prefix at ≈ 0.1× the input price (most models; a few newer ones are cheaper still) and skip its prefill; writing the cache costs ≈ 1.25× (5-minute TTL; a 1-hour TTL costs 2×).</p>' +
              '<p>Each cache hit also cuts time to first token, since the KV entries for the prefix are reused rather than recomputed. Cache reads refresh the TTL, so a busy agent keeps its prefix warm for free.</p>' +
              '<details><summary>Go deeper</summary><p>Break-even: over k requests an uncached prefix costs k units, a cached one costs 1.25 + 0.1·(k − 1). Setting 1.25 + 0.1(k − 1) &lt; k gives k &gt; 1.28, so caching already wins on the <i>second</i> use. The catch is the exact-prefix rule: one changed token near the front invalidates everything after it, and a cache write that is never read again is a 25% surcharge.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.g2, 400);
          var G = S.g3 = ctx.group();
          var src = [['Tool schemas', 'MCP registry · 3.4k', 'magenta', 'tool'], ['System prompt', 'role · rules · 2.1k', 'cyan', 'doc'], ['Memory', 'fox sheet · style · 4k', 'teal', 'db'],
            ['Task', 'from orchestrator · 0.3k', 'blue', 'queue'], ['History + obs.', 'grows each turn', 'amber', 'layers']];
          S.src = src.map(function (s, i) {
            return ctx.node({ x: 170, y: 212 + i * 76, w: 230, h: 54, title: s[0], sub: s[1], color: s[2], icon: s[3], titleSize: 14, subSize: 11, glow: false, parent: G });
          });
          S.builder = ctx.node({ x: 470, y: 364, w: 170, h: 80, title: 'Context', sub: 'builder', icon: 'layers', color: 'white', titleSize: 15, parent: G });
          var links = S.src.map(function (n, i) { return ctx.link(n, S.builder, { color: SEGC[['tools', 'system', 'memory', 'task', 'asst'][i]], from: 'r', to: 'l', sw: 1.4, parent: G }); });
          /* beat 0: five sources feed the builder */
          return Promise.all([
            ctx.reveal(S.src, { from: 'left', stagger: 110 }),
            ctx.reveal(S.builder, { from: 'scale', delay: 500 }),
            ctx.reveal(links, { from: 'draw', delay: 600, stagger: 80 })
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the request, in cache order */
            S.req = ctx.code({ x: 600, y: 172, w: 940, title: 'POST /v1/messages · assembled request', lang: 'json', size: 12, color: 'white', lines: [
              '{"model": "<frontier-model>", "max_tokens": 16000,',
              ' "thinking": {"type": "enabled", "budget_tokens": 4000},',
              ' "tools": [{"name": "search_assets", "input_schema": {...}},',
              '           {"name": "render_keyframe", "input_schema": {...}}],',
              ' "system": [{"type": "text", "text": "You are the Storyboard agent...",',
              '             "cache_control": {"type": "ephemeral"}}],',
              ' "messages": [{"role": "user", "content": [',
              '   {"type": "text", "text": "<memory>fox_sheet@7c1e: orange fur, white visor,',
              '     patched suit; palette ice-cyan + ember</memory>"},',
              '   {"type": "text", "text": "Storyboard 6 shots for job 7f3a."}]}]}'
            ], parent: G });
            S.req.lineEls.forEach(function (l) { l.setAttribute('opacity', 0); });
            S.info = [];
            [['prefix order: tools → system → messages', 'magenta'], ['budget: prompt + max_tokens (16k) ≤ 200k window', 'amber'], ['cache breakpoint after system: turn 2+ reads 5.5k tokens at ≈ 0.1× price', 'cyan']].forEach(function (t, i) {
              var g = ctx.group({ parent: G, opacity: 0 });
              ctx.circle(612, 452 + i * 32, 4, { fill: t[1], parent: g });
              ctx.text(626, 452 + i * 32, t[0], { size: 13, font: 'mono', color: 'text', parent: g });
              S.info.push(g);
            });
            ctx.reveal(S.req, { from: 'right', dur: 400 });
            return Promise.all(S.src.slice(0, 4).map(function (n, i) { return ctx.packet(links[i], { color: SEGC[['tools', 'system', 'memory', 'task'][i]], dur: 700 + i * 80 }); })).then(function () {
              ctx.pulse(S.builder, { color: 'white' });
              var lp = S.req.lineEls.map(function (l, i) { return ctx.reveal(l, { from: 'left', delay: i * 110, dur: 300, dist: 10, opacity: 1 }); });
              return Promise.all(lp.concat([ctx.reveal(S.info[0], { from: 'up', delay: 400 })]));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the fixed budget: the context window bar */
            var B = S.gBar = ctx.group();
            ctx.text(BX, 672, 'CONTEXT WINDOW · 200k tokens', { size: 13, font: 'mono', weight: 700, color: 'white', parent: B, spacing: 1 });
            S.ctxTxt = ctx.text(BX + 1440, 672, '', { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: B });
            ctx.rect(BX, BY, 1440, BH, { rx: 6, fill: 'rgba(255,255,255,0.035)', stroke: ctx.alpha('white', 0.25), sw: 1, parent: B });
            var resX = BX + 184000 * PX;
            ctx.rect(resX, BY, 1440 - (resX - BX), BH, { rx: 0, fill: ctx.alpha('white', 0.06), stroke: ctx.alpha('white', 0.35), dash: '3 3', sw: 1, parent: B });
            ctx.text(resX + (1440 - (resX - BX)) / 2, BY + BH / 2, 'max_tokens', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
            S.cb = {}; S.segs = {};
            ORDER.forEach(function (k) { S.cb[k] = 0; S.segs[k] = ctx.rect(BX, BY + 2, 0, BH - 4, { rx: 2, fill: ctx.alpha(SEGC[k], 0.7), stroke: SEGC[k], sw: 0.8, parent: B }); });
            S.thr = ctx.line(BX + 160000 * PX, BY - 6, BX + 160000 * PX, BY + BH + 6, { color: 'red', sw: 2, dash: '4 3', parent: B });
            ctx.text(BX + 160000 * PX, 672, 'compact at 80%', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: B });
            [50, 100, 150].forEach(function (k) { ctx.text(BX + k * 1000 * PX, 742, k + 'k', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B }); });
            S.cacheL = ctx.group({ parent: B, opacity: 0 });
            ctx.line(BX + 5500 * PX, BY - 6, BX + 5500 * PX, BY + BH + 6, { color: 'cyan', sw: 2, parent: S.cacheL });
            ctx.text(BX + 5500 * PX + 6, 742, '◀ cached prefix (tools + system)', { size: 11, font: 'mono', color: 'cyan', parent: S.cacheL });
            var lg = ctx.group({ parent: B });
            var lx = BX;
            ORDER.forEach(function (k) {
              ctx.rect(lx, 780, 12, 12, { rx: 2, fill: ctx.alpha(SEGC[k], 0.7), stroke: SEGC[k], sw: 0.8, parent: lg });
              ctx.text(lx + 18, 786, SEGN[k], { size: 12, font: 'mono', color: 'text', parent: lg });
              lx += 36 + SEGN[k].length * 7.6;
            });
            drawBar(ctx, S);
            ctx.reveal(B, { from: 'up', dur: 500 });
            return Promise.all([ctx.reveal(S.info[1], { from: 'up', delay: 500 }), ctx.wait(500).then(function () { return setCtx(ctx, S, { tools: 3400, system: 2100, memory: 4000, task: 300 }, 1400); })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the cached prefix */
            return Promise.all([ctx.reveal(S.cacheL, { opacity: 1 }), ctx.reveal(S.info[2], { from: 'up', delay: 300 })]).then(function () {
              return ctx.pulse(S.cacheL, { color: 'cyan', times: 2, dur: 600 });
            });
          });
        }
      },
      /* 4 ---------------------------------------------------------------- */
      {
        title: 'The loop',
        beats: [
          {
            say: 'Now the loop itself. Assemble the context, sample a response, and parse it into content blocks: some thinking, maybe some text, and zero or more tool calls.',
            card: { tag: 'KEY IDEA', title: 'Five stations, one lap per turn', body: 'Assemble, sample, parse, execute, append. One lap is one turn, and the harness keeps lapping until the model stops asking for tools.' },
            deep: '<pre>msgs = [user(task)]\nfor turn in range(MAX_TURNS):\n  r = llm(system, tools, msgs)\n  msgs += [assistant(r.content)]\n  if r.stop_reason == "end_turn":\n    return r\n  calls = tool_uses(r.content)\n  outs = await gather(run, calls)\n  msgs += [results(calls, outs)]\nraise TurnLimitExceeded</pre>' +
              '<p>That is the entire control flow. Everything else in this chamber is what goes into <code>llm(...)</code> and what happens inside <code>run</code>.</p>' +
              '<details><summary>Go deeper</summary><p>Cost of the loop: with prefix caching, turn k prefills only the new suffix (its previous output plus the new tool results, s<sub>k</sub> tokens) and decodes a<sub>k</sub> tokens, so <b>latency<sub>k</sub> ≈ s<sub>k</sub>/r<sub>prefill</sub> + a<sub>k</sub>·t<sub>tok</sub> + max tool time</b>. Without caching, prefill reprocesses the whole context each turn and the total grows quadratically in the number of turns.</p></details>'
          },
          {
            say: 'If the stop reason is tool use, the harness executes the calls, appends each result tagged with the id of the call, and goes around again. Here the storyboard agent first searches for the character sheet.',
            card: { tag: 'HOW IT WORKS', title: 'stop_reason drives the loop', body: 'Tool use means run the calls and go around again; end turn means return. Each result carries the id of the call it answers.' },
            deep: '<table><tr><th>stop_reason</th><th>Meaning → harness action</th></tr>' +
              '<tr><td><code>tool_use</code></td><td>wants actions → execute, append results</td></tr>' +
              '<tr><td><code>end_turn</code></td><td>done → return final content</td></tr>' +
              '<tr><td><code>max_tokens</code></td><td>truncated; a partial tool_use is invalid → retry with a larger limit</td></tr>' +
              '<tr><td><code>pause_turn</code></td><td>server-side tool loop paused → resend to continue</td></tr>' +
              '<tr><td><code>refusal</code></td><td>policy stop → surface to orchestrator</td></tr></table>'
          },
          {
            say: 'On the second turn it renders all six keyframes in parallel, in one assistant message, and the six results come back together.',
            card: { tag: 'NUMBERS', title: 'Images are expensive observations', stat: { v: '9.7k', u: 'tokens', l: 'of tool results after turn two: six keyframes at about 1.5k tokens each' }, more: '<p>Image cost scales with pixels: Claude reads 28 × 28 pixel patches, so tokens = ceil(w / 28) · ceil(h / 28). A 1092 × 1092 keyframe costs 1,521 tokens and a 512 × 512 thumbnail only 361. Downscaling a keyframe before returning it to the model, or returning a URI and letting the model ask for a thumbnail, cuts the observation cost by roughly a factor of four.</p>' },
            deep: '<p>Parallel calls: several <code>tool_use</code> blocks in one turn; all results go back in the next user message, matched by <code>tool_use_id</code>. The turn takes as long as the slowest call:</p>' +
              '<div class="eq">latency per turn ≈ prefill + decode + max<sub>i</sub>(tool latency<sub>i</sub>)</div>' +
              '<p>An image costs one token per 28 × 28 pixel patch, roughly (width × height) / 784, so a 1.2 megapixel keyframe (1092 × 1092) is about 1.5k tokens. Returning a URI plus a thumbnail instead of full images is the usual fix when the model only needs to reference the media.</p>' +
              '<details><summary>Go deeper</summary><p>Message-shape rules are a common source of 400 errors: every <code>tool_use</code> in an assistant message needs a matching <code>tool_result</code> in the very next user message, all of them in that single message, and the <code>tool_result</code> blocks must come <i>before</i> any text in its content. The id, not the position, is what pairs a result with its call.</p></details>'
          },
          {
            say: 'On the third turn it composes the board and ends its turn. Three iterations, and the context grew with every observation.',
            card: { tag: 'WHY IT MATTERS', title: 'Every observation is re-read', body: 'Each turn re-reads everything before it. Tool results are the fastest-growing part of the window, which is why the next steps manage them.' },
            deep: '<p>The final assistant message has stop reason <code>end_turn</code> and no <code>tool_use</code> block, so the harness returns it to the orchestrator as the task result: <code>artifact://board@3b0d</code>, a reference and not the panels themselves.</p>' +
              '<p>Three laps here, but production agents routinely run tens of turns. Latency and cost scale with the number of laps and with how much context each lap re-reads, which is the subject of step 6.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.g3, 400);
          var LG = S.gLoop = ctx.group();
          var cx = LC.x, cy = LC.y, r = LC.r;
          S.ring = ctx.path('M' + cx + ',' + (cy - r) + ' A' + r + ',' + r + ' 0 0 1 ' + cx + ',' + (cy + r) + ' A' + r + ',' + r + ' 0 0 1 ' + cx + ',' + (cy - r), { color: ctx.alpha('magenta', 0.25), sw: 2, parent: LG });
          S.ringLen = S.ring.getTotalLength();
          var names = [['Assemble', 'context', 'cyan'], ['Sample', 'LLM decode', 'amber'], ['Parse', 'content blocks', 'magenta'], ['Execute', 'tools · sandbox', 'teal'], ['Append', 'tool_result', 'blue']];
          var arcs = [];
          for (var i = 0; i < 5; i++) {
            var a0 = (-90 + 72 * i + 26) * Math.PI / 180, a1 = (-90 + 72 * (i + 1) - 26) * Math.PI / 180;
            arcs.push(ctx.path('M' + (cx + r * Math.cos(a0)).toFixed(1) + ',' + (cy + r * Math.sin(a0)).toFixed(1) + ' A' + r + ',' + r + ' 0 0 1 ' + (cx + r * Math.cos(a1)).toFixed(1) + ',' + (cy + r * Math.sin(a1)).toFixed(1), { color: 'magenta', sw: 2, arrow: true, parent: LG }));
          }
          S.st = names.map(function (n, i) {
            var a = (-90 + 72 * i) * Math.PI / 180;
            var nd = ctx.node({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), w: 136, h: 42, title: n[0], sub: n[1], color: n[2], titleSize: 14, subSize: 11, glow: false, parent: LG });
            if (nd.subEl) nd.subEl.setAttribute('fill', lite(ctx, n[2]));
            return nd;
          });
          var ic = ctx.group({ parent: LG });
          ctx.text(cx, cy - 36, 'ITERATION', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: ic, spacing: 2 });
          S.iterTxt = ctx.text(cx, cy + 2, '0', { size: 40, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: ic });
          S.stopL = ctx.label(cx, cy + 46, 'stop_reason: —', { color: 'dim', size: 12, w: 196, parent: ic });
          S.exitA = ctx.path('M' + (S.st[2].box.r - 10) + ',' + S.st[2].box.b + ' Q' + (S.st[2].box.r + 6) + ',638 600,640', { color: 'lime', sw: 1.6, arrow: true, dash: '4 4', parent: LG, opacity: 0 });
          S.exitA.len = S.exitA.getTotalLength();
          S.exitL = ctx.label(666, 640, 'end_turn → return', { color: 'lime', size: 12, parent: LG, opacity: 0 });
          S.dot = ctx.circle(cx, cy - r, 7, { fill: 'white', glow: 'strong', parent: LG });
          /* transcript panel */
          var R = S.R = ctx.group();
          ctx.rect(690, 170, 870, 450, { rx: 10, fill: 'rgba(6,12,24,0.92)', stroke: ctx.alpha('magenta', 0.45), parent: R });
          ctx.text(706, 188, 'TRANSCRIPT · storyboard agent · content blocks', { size: 12, font: 'mono', weight: 600, color: lite(ctx, 'magenta'), parent: R, spacing: 1 });
          S.rowN = 0;
          var setStop = function (s, col) {
            S.stopL.lastChild.textContent = 'stop_reason: ' + s;
            S.stopL.lastChild.setAttribute('fill', lite(ctx, col));
            S.stopL.firstChild.setAttribute('stroke', ctx.alpha(col, 0.7));
            S.stopL.firstChild.setAttribute('fill', ctx.alpha(col, 0.14));
          };
          var iter = function (k, asst, ctxA, res, ctxR, stop) {
            S.iterTxt.textContent = String(k);
            setStop('…', 'dim');
            return moveDot(ctx, S, 0, 0.2, 650).then(function () {
              asst();
              return Promise.all([setCtx(ctx, S, ctxA, 500), ctx.wait(700)]);
            }).then(function () {
              return moveDot(ctx, S, 0.2, 0.4, 450);
            }).then(function () {
              setStop(stop, stop === 'end_turn' ? 'lime' : 'magenta');
              if (stop === 'end_turn') {
                S.dot.setAttribute('opacity', 0);
                return Promise.all([ctx.reveal(S.exitA, { from: 'draw', dur: 400 }), ctx.reveal(S.exitL, { from: 'left', dur: 400 })]).then(function () {
                  ctx.pulse(S.exitL, { color: 'lime' });
                  return ctx.packet(S.exitA, { color: 'lime', dur: 600 });
                });
              }
              return moveDot(ctx, S, 0.4, 0.6, 450).then(function () {
                res();
                return Promise.all([setCtx(ctx, S, ctxR, 600), ctx.wait(700)]);
              }).then(function () {
                return moveDot(ctx, S, 0.6, 1.0, 750);
              });
            });
          };
          /* beat 0: the five stations and one lap of the dot */
          return Promise.all([
            ctx.reveal(S.ring, { from: 'draw', dur: 800 }),
            ctx.reveal(S.st, { from: 'scale', stagger: 100, delay: 200 }),
            ctx.reveal(arcs, { from: 'draw', stagger: 100, delay: 500 }),
            ctx.reveal(ic, { delay: 400 }),
            ctx.reveal(R, { from: 'right', delay: 300 })
          ]).then(function () {
            return moveDot(ctx, S, 0, 1, 2400);
          }).then(function () {
            S.dot.setAttribute('opacity', 0);
            setStation(ctx, S, -1);
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: turn 1, the harness runs a search and appends the result */
            return iter(1, function () {
              row(ctx, S, 'thinking', 'need the fox character sheet before drawing', '1');
              row(ctx, S, 'tool_use', 'search_assets({"query":"fox astronaut sheet","k":3})');
            }, { thinking: 150, asst: 250 }, function () {
              row(ctx, S, 'tool_result', '3 hits · fox_sheet@7c1e · helmet@a02b · moon@19fd');
            }, { results: 600 }, 'tool_use');
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: turn 2, six parallel keyframe renders */
            return iter(2, function () {
              row(ctx, S, 'thinking', 'draft all six keyframes in parallel, same refs', '2');
              row(ctx, S, 'tool_use', 'render_keyframe({"shot":1..6,"refs":["fox_sheet@7c1e"]})', null, 'tool_use ×6');
            }, { thinking: 350, asst: 700 }, function () {
              var g = row(ctx, S, 'tool_result', '6 images', null, 'tool_result ×6');
              for (var t = 0; t < 6; t++) thumb(ctx, g, 930 + t * 52, g.y - 13, 40 + t);
            }, { results: 9700 }, 'tool_use');
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: turn 3, the board is composed and the turn ends */
            return iter(3, function () {
              row(ctx, S, 'thinking', 'shot 3 framing matches the script; compose the board', '3');
              row(ctx, S, 'text', 'Storyboard ready: 6 panels -> artifact://board@3b0d');
            }, { thinking: 650, asst: 1900 }, null, null, 'end_turn');
          });
        }
      },
      /* 5 ---------------------------------------------------------------- */
      {
        title: 'Reasoning patterns',
        beats: [
          {
            say: 'How the model reasons inside this loop has a few well studied shapes. ReAct interleaves a short thought, an action and an observation, again and again.',
            card: { tag: 'KEY IDEA', title: 'ReAct: think, act, observe', body: 'Each thought is grounded by the observation before it. Yao et al. reported gains of 34 and 10 points of success rate on ALFWorld and WebShop.' },
            deep: '<ul><li><b>ReAct</b> (Yao et al., 2023): trajectories of (thought, action, observation)*. Grounding reasoning in observations reduces hallucination compared with chain-of-thought alone, and the visible thoughts make traces auditable.</li>' +
              '<li>Cost profile: one model call per step, each re-reading the growing trajectory. Simple and robust, but latency is the sum over all steps.</li></ul>' +
              '<details><summary>Go deeper</summary><p>The paper\'s formulation: the action space is augmented to Â = A ∪ L, where L is the space of language. An action a<sub>t</sub> ∈ L (a thought) does not touch the environment; it only extends the context, c<sub>t+1</sub> = (c<sub>t</sub>, a<sub>t</sub>), which is exactly how a thought can steer later actions without any change to the model. A thought is free computation that the model buys with tokens.</p></details>'
          },
          {
            say: 'Plan and execute writes a full plan first, then works through it, replanning only when something breaks.',
            card: { tag: 'TRADE-OFF', title: 'Plan once, pay less, break more', body: 'A strong model plans once and cheaper models execute, so fewer expensive calls. But a wrong plan is followed faithfully, so add a replan trigger.' },
            deep: '<ul><li><b>Plan-and-execute / Plan-and-Solve</b>: a strong model plans once, cheaper models execute steps; fewer expensive calls, but brittle when the plan is wrong, so add a replan trigger.</li>' +
              '<li>Plan-and-Solve prompting (Wang et al., 2023) showed that "first devise a plan, then carry it out" reduces missing-step errors in zero-shot reasoning.</li>' +
              '<li>The orchestrator\'s task DAG is the same idea one level up: the plan is data, and the critic can trigger a replan.</li></ul>'
          },
          {
            say: 'Reflection adds a self critique after a failed attempt and stores the lesson for the next try.',
            card: { tag: 'HOW IT WORKS', title: 'Reflexion: learn without gradients', body: 'After a failure the agent writes a verbal lesson into episodic memory and retries with it. No weight is updated; the improvement lives in the prompt.' },
            deep: '<ul><li><b>Reflexion</b> (Shinn et al., 2023): after a failure the agent writes a verbal reflection into episodic memory and retries; gains come without any weight update (91% pass@1 on HumanEval in the paper, against 80% for the GPT-4 baseline).</li>' +
              '<li>It needs a reliable failure signal: unit tests, a schema check or a critic score. Without one, reflection can rationalise a wrong answer.</li></ul>'
          },
          {
            say: 'Modern reasoning models add extended thinking, a private scratchpad before answering. With interleaved thinking they also reason between tool calls, digesting each result before acting again.',
            card: { tag: 'STATE OF THE ART', title: 'Interleaved thinking', body: 'Reasoning models think in signed blocks under a token budget or an effort setting, and also after every tool result, so an observation is digested before the next action.' },
            deep: '<ul><li><b>Extended thinking</b>: RL-trained long chains of thought in dedicated <code>thinking</code> blocks with a budget (for example <code>budget_tokens: 4000</code>, minimum 1,024). <b>Interleaved thinking</b> allows thinking after each <code>tool_result</code>. Thinking blocks must be returned unmodified within the tool loop (they carry a signature). Newer Claude models replace the fixed budget with <i>adaptive thinking</i>, an effort setting that interleaves automatically; manual budgets are deprecated on the 4.6 models and rejected from 4.7 on.</li></ul>' +
              '<div class="eq">accuracy ≈ a + b · log(thinking tokens) over a wide range (reported for o1-style reasoning models)</div>' +
              '<p class="muted">Trade-off: thinking tokens are output tokens: billed at output price, they add decode latency and they consume the context budget.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.R, 350);
          setStation(ctx, S, -1);
          var R = S.R = ctx.group();
          ctx.rect(690, 170, 870, 450, { rx: 10, fill: 'rgba(6,12,24,0.92)', stroke: ctx.alpha('violet', 0.45), parent: R });
          ctx.text(706, 188, 'REASONING PATTERNS · token timelines', { size: 12, font: 'mono', weight: 600, color: lite(ctx, 'violet'), parent: R, spacing: 1 });
          var lk = [['think', 'violet'], ['act', 'magenta'], ['observe', 'orange'], ['plan', 'cyan'], ['critique', 'pink'], ['answer', 'amber']];
          lk.forEach(function (k, i) {
            ctx.rect(1086 + i * 78, 182, 11, 11, { rx: 2, fill: ctx.alpha(k[1], 0.7), parent: R });
            ctx.text(1101 + i * 78, 188, k[0], { size: 11, font: 'mono', color: 'text', parent: R });
          });
          /* beat 0: ReAct. The sampling station is where reasoning tokens are produced. */
          ctx.reveal(R, { from: 'right', dur: 400 });
          return ctx.wait(300).then(function () {
            setStation(ctx, S, 1);
            ctx.pulse(S.st[1], { color: 'violet', times: 2, dur: 800 });
            return lane(ctx, S, R, 0);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: plan-and-execute */
            return lane(ctx, S, R, 1);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: reflection */
            return lane(ctx, S, R, 2);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: extended and interleaved thinking */
            ctx.pulse(S.st[1], { color: 'violet', times: 2, dur: 800 });
            return lane(ctx, S, R, 3);
          });
        }
      },
      /* 6 ---------------------------------------------------------------- */
      {
        title: 'Context as budget',
        beats: [
          {
            say: 'Treat the context window as a budget that the loop spends. Every tool result, every image and every thought is appended, and long tasks fill two hundred thousand tokens surprisingly fast.',
            card: { tag: 'NUMBERS', title: 'Turn 28 of a long task', stat: { v: '161k', u: 'tokens', l: 'of 200k in use, past the 80 percent compaction line' } },
            deep: '<div class="eq">input tokens at turn k = P + Σ<sub>i&lt;k</sub>(a<sub>i</sub> + o<sub>i</sub>) &nbsp;⇒&nbsp; Σ<sub>k≤K</sub> = O(K²) prefill without caching</div>' +
              '<p>P is the fixed prefix, a<sub>i</sub> the assistant output and o<sub>i</sub> the tool output of turn i. Context grows linearly, so total prefill work over a K-turn task grows quadratically unless the prefix is cached.</p>' +
              '<p>Models also get worse as the window fills: accuracy on simple retrieval falls with input length (Chroma\'s <i>Context Rot</i> study, 2025), and information in the middle is used less than at the ends (Liu et al., <i>Lost in the Middle</i>). Waiting until the window is full is a mistake.</p>'
          },
          {
            say: 'Good harnesses act early. First, keep the stable prefix cached: reading it costs a tenth of the normal price.',
            card: { tag: 'NUMBERS', title: 'Caching the prefix', stat: { v: '$0.50 → $0.07', l: 'cost of a 5.5k prefix over 30 turns, uncached versus cached' } },
            deep: '<table><tr><th>Technique</th><th>Mechanism</th><th>Cost</th></tr>' +
              '<tr><td>Prompt caching</td><td>reuse the KV of an identical prefix; cached reads ≈ 0.1× price, lower time-to-first-token</td><td>any prefix change invalidates everything after it</td></tr></table>' +
              '<p>Arithmetic: 30 turns × 5.5k tokens × $3/M = $0.50 uncached. Cached: one write at 1.25× plus 29 reads at 0.1× ≈ $0.07.</p>'
          },
          {
            say: 'Second, clear old tool outputs that can be fetched again by reference, leaving a stub with the artifact address.',
            card: { tag: 'HOW IT WORKS', title: 'Stale results become stubs', body: 'A result older than N turns is replaced by a one-line stub that keeps its URI. If the agent needs it again it fetches it; usually it never does.', more: '<p>Anthropic\'s context editing feature implements this server-side (clear_tool_uses): it drops the oldest tool results past a trigger threshold while keeping the most recent few intact.</p>' },
            deep: '<table><tr><th>Technique</th><th>Mechanism</th><th>Cost</th></tr>' +
              '<tr><td>Tool-result clearing</td><td>replace stale results with stubs + URIs (e.g. context editing)</td><td>re-fetch if needed again</td></tr></table>' +
              '<p>Here 131k tokens of accumulated results shrink to about 5k of stubs. Clearing is the cheapest lever because it is lossless in principle: the information lives in the artifact store, and only the copy in the window is dropped.</p>'
          },
          {
            say: 'Third, compact the history into a summary when usage crosses a threshold, keeping decisions, open tasks and artifact addresses.',
            card: { tag: 'TRADE-OFF', title: 'Compaction is lossy', body: 'At about 80 percent the harness summarises the history and continues with summary plus recent turns. The quality of that summary decides the rest of the run.' },
            deep: '<table><tr><th>Technique</th><th>Mechanism</th><th>Cost</th></tr>' +
              '<tr><td>Compaction</td><td>at ~80%: summarise into decisions, open TODOs, artifact URIs; continue with summary + recent turns</td><td>lossy; summary quality is critical</td></tr></table>' +
              '<p>What the summary must keep: user constraints, decisions taken and why, open TODOs, artifact URIs. What it may drop: intermediate tool output that can be re-fetched, dead ends. Here 12.3k of assistant text and 8k of thinking collapse into a 3.5k summary.</p>'
          },
          {
            say: 'Fourth, keep durable notes in files outside the window, and read them back just in time. They survive compaction and restarts.',
            card: { tag: 'KEY IDEA', title: 'Memory outside the window', body: 'Facts written once to NOTES.md or a memory tool survive compaction, restarts and even a change of model. The window only holds what is needed now.' },
            deep: '<table><tr><th>Technique</th><th>Mechanism</th><th>Cost</th></tr>' +
              '<tr><td>External memory</td><td>NOTES.md / memory-tool files, read just-in-time</td><td>needs retrieval discipline</td></tr>' +
              '<tr><td>Sub-agents</td><td>explore in a fresh window, return a 1–2k summary</td><td>coordination overhead</td></tr></table>' +
              '<p>This is the MemGPT idea (Packer et al., 2023) in its simplest form: treat the window like RAM and files like disk, and page deliberately. After all four moves the window is back to about 19.5k tokens.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.R, 350);
          var R = S.R = ctx.group();
          S.gLoop.setAttribute('opacity', 0.45);
          S.gLoop.setAttribute('data-op', 0.45);
          S.stopL.lastChild.textContent = 'stop_reason: tool_use';
          S.stopL.lastChild.setAttribute('fill', lite(ctx, 'magenta'));
          S.stopL.firstChild.setAttribute('stroke', ctx.alpha('magenta', 0.7));
          S.stopL.firstChild.setAttribute('fill', ctx.alpha('magenta', 0.14));
          /* beat 0: the loop runs on; the context grows to 161k */
          ctx.hud('long-running loop · context pressure');
          var Gp = S.growth = ctx.group({ parent: R });
          ctx.rect(690, 170, 870, 450, { rx: 10, fill: 'rgba(6,12,24,0.92)', stroke: ctx.alpha('amber', 0.45), parent: Gp });
          ctx.text(706, 190, 'CONTEXT SIZE PER TURN · illustrative long-running loop', { size: 12, font: 'mono', weight: 600, color: 'amber', parent: Gp, spacing: 1 });
          var rg = ctx.rng(7), inc = [], tot = 0;
          for (var i = 0; i < 28; i++) { inc.push(0.35 + 1.3 * rg()); tot += inc[i]; }
          var pts = [[0, 6000]], acc = 6000;
          inc.forEach(function (d, i) { acc += d / tot * (161100 - 6000); pts.push([i + 1, acc]); });
          S.gr = ctx.plot(750, 236, 760, 300, pts, { xDomain: [0, 40], yDomain: [0, 200000], color: 'amber', xLabel: 'turn', yLabel: 'context tokens', parent: Gp });
          var yAt = function (v) { return S.gr.toPx(0, v).y; };
          ctx.line(750, yAt(160000), 1510, yAt(160000), { color: 'red', sw: 1.4, dash: '5 4', parent: Gp });
          ctx.text(1508, yAt(160000) + 12, 'compact at 80% (160k)', { size: 11, font: 'mono', color: 'red', anchor: 'end', parent: Gp });
          ctx.line(750, yAt(200000), 1510, yAt(200000), { color: 'white', sw: 1, dash: '2 4', parent: Gp, opacity: 0.5 });
          ctx.text(1508, yAt(200000) - 12, 'window: 200k', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: Gp });
          var pxT = function (t) { return S.gr.toPx(t, 0).x; };
          [0, 10, 20, 30].forEach(function (t) { ctx.text(pxT(t), 554, String(t), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: Gp }); });
          ctx.text(742, yAt(100000), '100k', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: Gp });
          var over = ctx.path('M' + pxT(28) + ',' + yAt(161100) + ' L' + pxT(35) + ',' + yAt(200000), { color: 'red', sw: 1.6, dash: '4 4', parent: Gp, opacity: 0 });
          var overT = ctx.text(pxT(35) - 8, yAt(200000) + 44, 'full by turn ~35', { size: 11, font: 'mono', color: 'red', anchor: 'end', parent: Gp, opacity: 0 });
          var dot = ctx.circle(pxT(0), yAt(6000), 5, { fill: 'amber', glow: true, parent: Gp });
          var curve = S.gr.curve, L = curve.getTotalLength();
          ctx.reveal(R, { from: 'right', dur: 400 });
          curve.setAttribute('stroke-dasharray', L + ' ' + L);
          curve.setAttribute('stroke-dashoffset', L);
          return ctx.wait(300).then(function () {
            return ctx.tween(2800, function (e) {
              curve.setAttribute('stroke-dashoffset', L * (1 - e));
              var p = curve.getPointAtLength(L * e);
              dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
              S.iterTxt.textContent = String(Math.round(3 + 25 * e));
              S.cb.results = 9700 + (131000 - 9700) * e;
              S.cb.asst = 1900 + (12300 - 1900) * e;
              S.cb.thinking = 650 + (8000 - 650) * e;
              drawBar(ctx, S);
            }, 'linear');
          }).then(function () {
            curve.removeAttribute('stroke-dasharray');
            curve.removeAttribute('stroke-dashoffset');
            ctx.hud('161k / 200k · past the 80% line');
            ctx.pulse(S.thr, { color: 'red', times: 2, dur: 500 });
            return Promise.all([ctx.reveal([over, overT], { from: 'fade' }), ctx.pulse(dot, { color: 'red', times: 2, dur: 500 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: prompt caching */
            ctx.fadeOut(Gp, 400, true);
            var cA = card(ctx, R, 700, 172, 420, 220, 'cyan', 'Prompt caching');
            ctx.para(716, 222, ['stable prefix: tools + system (5.5k)', 'turn 2+: cache read ≈ 0.1× input price', 'cache write ≈ 1.25×, TTL 5 min'], { size: 12, font: 'mono', color: 'text', lh: 19, parent: cA });
            ctx.text(716, 302, 'prefix cost over 30 turns', { size: 11, font: 'mono', color: 'dim', parent: cA });
            ctx.rect(716, 316, 260, 18, { rx: 3, fill: ctx.alpha('red', 0.5), parent: cA });
            ctx.text(984, 325, '$0.50 uncached', { size: 11, font: 'mono', color: 'red', parent: cA });
            S.cacheBar = ctx.rect(716, 344, 0, 18, { rx: 3, fill: ctx.alpha('cyan', 0.7), parent: cA });
            ctx.text(984, 353, '$0.07 cached', { size: 11, font: 'mono', color: 'cyan', parent: cA });
            ctx.hud('cached prefix: 5.5k tokens at 0.1× price');
            return ctx.reveal(cA, { from: 'up', dur: 500 }).then(function () {
              ctx.highlight(cA, { color: 'cyan', pad: 4, parent: R });
              ctx.pulse(S.cacheL, { color: 'cyan', times: 2, dur: 600 });
              return ctx.animate(S.cacheBar, { width: [0, 36] }, 700, 'out');
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: clear stale tool results */
            var cB = card(ctx, R, 1140, 172, 420, 220, 'orange', 'Clear stale tool results');
            ctx.para(1156, 222, ['results older than N turns become', 'stubs that keep the artifact URI', 're-fetch on demand if needed'], { size: 12, font: 'mono', color: 'text', lh: 19, parent: cB });
            S.stubs = [];
            for (var i = 0; i < 7; i++) S.stubs.push(ctx.rect(1156 + i * 54, 316, 48, 44, { rx: 4, fill: ctx.alpha('orange', 0.45), stroke: 'orange', sw: 1, parent: cB }));
            S.stubT = ctx.text(1156, 380, '131k → 5k: stubs keep artifact://… URIs', { size: 12, font: 'mono', color: 'orange', parent: cB, opacity: 0 });
            return ctx.reveal(cB, { from: 'up', dur: 500 }).then(function () {
              ctx.highlight(cB, { color: 'orange', pad: 4, parent: R });
              ctx.hud('clear old results: 161k → 35k');
              var sh = S.stubs.map(function (s, i) { return ctx.animate(s, { height: [44, 10], y: [316, 333] }, 700, 'inOut', i * 60); });
              return Promise.all(sh.concat([ctx.reveal(S.stubT, { delay: 500, opacity: 1 }), setCtx(ctx, S, { results: 5000 }, 1200)]));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: compaction */
            var cC = card(ctx, R, 700, 404, 420, 216, 'white', 'Compaction');
            ctx.para(716, 454, ['trigger at 80% of the window', 'summary keeps: decisions, open TODOs,', 'artifact URIs, user constraints'], { size: 12, font: 'mono', color: 'text', lh: 19, parent: cC });
            S.hist = [];
            for (var j = 0; j < 8; j++) S.hist.push(ctx.rect(716 + j * 46, 550, 40, 40, { rx: 4, fill: ctx.alpha(j % 2 ? 'amber' : 'violet', 0.5), stroke: j % 2 ? 'amber' : 'violet', sw: 1, parent: cC }));
            S.summ = ctx.rect(716, 550, 0, 40, { rx: 4, fill: ctx.alpha('white', 0.8), parent: cC });
            return ctx.reveal(cC, { from: 'up', dur: 500 }).then(function () {
              ctx.highlight(cC, { color: 'white', pad: 4, parent: R });
              S.stopL.lastChild.textContent = 'harness: compact()';
              ctx.hud('compaction: 35k → 18.3k');
              var hs = S.hist.map(function (h) { return ctx.fade(h, 0.08, 700); });
              return Promise.all(hs.concat([ctx.animate(S.summ, { width: [0, 70] }, 800, 'out', 300), setCtx(ctx, S, { asst: 0, thinking: 0, summary: 3500 }, 1300)]));
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: external memory */
            var cD = card(ctx, R, 1140, 404, 420, 216, 'teal', 'External memory');
            ctx.para(1156, 454, ['NOTES.md / memory tool outside the window', 'write facts once, read just-in-time', 'survives compaction and restarts'], { size: 12, font: 'mono', color: 'text', lh: 19, parent: cD });
            ctx.icon('doc', 1180, 568, 40, 'teal', { parent: cD });
            S.notes = ctx.code({ x: 1214, y: 526, w: 330, h: 84, title: 'NOTES.md', lang: 'text', size: 11, color: 'teal', typing: true, lines: ['- fox: orange fur, white visor (7c1e)', '- shot 3 v2 approved; seed 77'], parent: cD });
            return ctx.reveal(cD, { from: 'up', dur: 500 }).then(function () {
              ctx.highlight(cD, { color: 'teal', pad: 4, parent: R });
              ctx.hud('19.5k / 200k after all four moves');
              return Promise.all([S.notes.typeAll(), setCtx(ctx, S, { memory: 5200 }, 1000)]);
            });
          });
        }
      },
      /* 7 ---------------------------------------------------------------- */
      {
        title: 'Why it works',
        beats: [
          {
            say: 'Why does any of this work? Because the model was trained for it. After pretraining on next token prediction, labs fine-tune on demonstrations of multi step tool use, then run reinforcement learning in sandboxed environments.',
            card: { tag: 'KEY IDEA', title: 'Three stages of training', body: 'Pretraining gives language and knowledge, supervised fine-tuning gives the tool-call format, and reinforcement learning gives judgment about when and how to act.' },
            deep: '<p>Pipeline: pretraining → SFT on curated or synthetic tool trajectories (ToolLLM / APIGen-style data) → RL with verifiable rewards in multi-turn environments.</p>' +
              '<p>SFT teaches the <i>syntax</i> of acting: which token opens a call, how arguments are formatted. RL teaches the <i>policy</i>: which tool, in what order, when to stop. Demonstrations alone plateau because they show only successful paths chosen by someone else; RL lets the model discover its own recoveries.</p>'
          },
          {
            say: 'The model attempts the same task several times, six rollouts in this picture. Each one is a full trajectory of thoughts, tool calls and tool outputs.',
            card: { tag: 'HOW IT WORKS', title: 'Sample a group of rollouts', body: 'GRPO draws G attempts per prompt. Each is a whole trajectory: policy tokens interleaved with tool outputs that came from the environment.' },
            deep: '<p><b>GRPO</b> (Shao et al., 2024) samples G rollouts per prompt and uses the group as its baseline, removing the value network that PPO needs. That drops a second network the size of the policy from training memory and, more importantly, avoids fitting a critic over 50-turn, tool-laden trajectories.</p>' +
              '<p>Rollouts are the expensive part: each is a full agent episode inside a sandbox, so the environment throughput (containers, simulated tools) usually bounds training speed, not the gradient step.</p>'
          },
          {
            say: 'Each attempt is scored by a verifier, like a schema check, a unit test or a critic. Success earns a reward of one, failure zero, and partial credit lands in between.',
            card: { tag: 'PITFALL', title: 'The verifier is the target', body: 'Policies exploit whatever the reward measures. A weak schema check or a lenient critic teaches the model to satisfy the check, not the task.' },
            deep: '<ul><li>Rewards: task success (tests pass, schema valid, critic ≥ τ), optionally minus cost or turn penalties.</li>' +
              '<li>Hard parts: reward hacking of the verifier, credit assignment over 50+ turns, flaky environments, and keeping rollouts cheap enough to run millions of them.</li></ul>' +
              '<p>Verifiable rewards are the reason coding, math and structured tool use improved fastest: a checker exists. Open-ended creative quality has no such checker, which is why the critic in the orchestrator matters.</p>'
          },
          {
            say: 'Attempts that beat the group average are reinforced, and attempts below it are pushed down. The group itself is the baseline, so no separate value network is needed.',
            card: { tag: 'TRY IT', title: 'Flip a reward, watch the advantages', body: 'Click any reward chip to cycle 0, 0.5 and 1. Advantages are re-centred on the group mean and scaled by its spread. Make all six equal and every advantage drops to zero.', more: '<p>Default rewards 1, 0, 1, 1, 0, 0.5: mean 0.583, population standard deviation 0.449, so (1 − 0.583) / 0.449 = +0.93 and (0 − 0.583) / 0.449 = −1.30. Using the unbiased estimator (n − 1) gives 0.85 and −1.19; implementations differ. A group whose rewards are all equal has std = 0 and no learning signal, which is why DAPO\'s dynamic sampling drops such groups.</p>' },
            deep: '<div class="eq">Â<sub>i</sub> = (r<sub>i</sub> − mean(r)) / std(r)</div>' +
              '<div class="eq">J(θ) = E[ (1/G) Σ<sub>i</sub> (1/|o<sub>i</sub>|) Σ<sub>t</sub> min(ρ<sub>i,t</sub>Â<sub>i</sub>, clip(ρ<sub>i,t</sub>, 1−ε, 1+ε)Â<sub>i</sub>) ] − β·KL(π<sub>θ</sub> ‖ π<sub>ref</sub>)</div>' +
              '<p>with ρ<sub>i,t</sub> = π<sub>θ</sub>(o<sub>i,t</sub> | ·) / π<sub>old</sub>(o<sub>i,t</sub> | ·). In the figure r = (1, 0, 1, 1, 0, 0.5) → Â ≈ (0.93, −1.30, 0.93, 0.93, −1.30, −0.19).</p>'
          },
          {
            say: 'Tool outputs are masked out of the loss, so the model learns to act and reason, not to predict the environment.',
            card: { tag: 'KEY IDEA', title: 'Mask what the model did not write', body: 'Gradient flows only through policy tokens. Tool results are environment text; training on them would teach the model to imitate the tools.' },
            deep: '<p>In agentic RL the sum over t covers only <b>policy tokens</b>; tool-result tokens are masked. This is the same idea as SFT loss masking (step 2), applied to the policy-gradient objective.</p>' +
              '<ul><li>2025 variants: DAPO (decoupled clip-higher, dynamic sampling, token-level loss, no KL) and Dr. GRPO (drops the 1/|o<sub>i</sub>| length term, which lets long wrong answers go under-penalised, and the std normalisation, which over-weights very easy or very hard questions).</li>' +
              '<li>DeepSeek-R1 (Nature, 2025) showed that GRPO with rule-based rewards alone (the R1-Zero run) elicits long reasoning and self-correction, with no human-labelled reasoning trajectories.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.R, 350);
          S.gLoop.setAttribute('data-op', 1);
          ctx.focus(null);
          S.iterTxt.textContent = '—';
          var R = S.R = ctx.group();
          ctx.rect(690, 170, 870, 450, { rx: 10, fill: 'rgba(6,12,24,0.94)', stroke: ctx.alpha('lime', 0.45), parent: R });
          ctx.text(706, 190, 'POST-TRAINING ON AGENT TRAJECTORIES', { size: 12, font: 'mono', weight: 600, color: 'lime', parent: R, spacing: 1 });
          var rw = [1, 0, 1, 1, 0, 0.5];
          S.rw = rw.slice(); S.rChip = []; S.aBars = null; S.aTxt = null; S.aStat = null;
          /* group-relative advantage (population std, as in the card); a group with equal rewards has zero signal */
          var advOf = function (r) {
            var m = r.reduce(function (a, b) { return a + b; }, 0) / r.length;
            var sd = Math.sqrt(r.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / r.length);
            return { m: m, sd: sd, a: r.map(function (v) { return sd < 1e-9 ? 0 : (v - m) / sd; }) };
          };
          var rewCol = function (v) { return v === 1 ? 'lime' : (v === 0 ? 'red' : 'amber'); };
          var paintAdv = function () {
            if (!S.aBars) return;
            var st = advOf(S.rw);
            S.aBars.forEach(function (b, i) {
              var a = st.a[i], bw = Math.abs(a) * 70, t = S.aTxt[i];
              b.setAttribute('x', a >= 0 ? 1450 : 1450 - bw);
              b.setAttribute('width', bw);
              b.setAttribute('fill', a >= 0 ? ctx.alpha('lime', 0.7) : ctx.alpha('red', 0.7));
              t.textContent = (a > 0.005 ? '+' : '') + (Math.abs(a) < 0.005 ? '0.00' : a.toFixed(2));
              t.setAttribute('x', a >= 0 ? 1444 : 1456);
              t.setAttribute('text-anchor', a >= 0 ? 'end' : 'start');
            });
            S.aStat.textContent = 'μ ' + st.m.toFixed(2) + ' · σ ' + st.sd.toFixed(2) + (st.sd < 1e-9 ? ' · no signal' : '');
            S.aStat.setAttribute('fill', st.sd < 1e-9 ? ctx.C.red : ctx.C.text);
          };
          var flipReward = function (i) {
            S.rw[i] = S.rw[i] === 0 ? 0.5 : (S.rw[i] === 0.5 ? 1 : 0);
            var chip = S.rChip[i], col = rewCol(S.rw[i]);
            chip.setText('r = ' + S.rw[i]);
            chip.firstChild.setAttribute('stroke', ctx.alpha(col, 0.7));
            chip.firstChild.setAttribute('fill', ctx.alpha(col, 0.14));
            chip.lastChild.setAttribute('fill', lite(ctx, col));
            paintAdv();
          };
          S.toolBlocks = [];
          /* beat 0: pretrain, SFT, RL */
          var stages = [['pretrain · next token', 'cyan', 815], ['SFT · tool trajectories', 'amber', 1060], ['RL · verifiable rewards', 'magenta', 1320]];
          var items = [];
          stages.forEach(function (s, i) {
            items.push(ctx.label(s[2], 222, s[0], { color: s[1], textColor: lite(ctx, s[1]), size: 12, parent: R, opacity: 0 }));
            if (i < 2) items.push(ctx.line(s[2] + 90, 222, stages[i + 1][2] - 92, 222, { color: 'dim', arrow: true, parent: R, opacity: 0 }));
          });
          ctx.reveal(R, { from: 'right', dur: 400 });
          return ctx.wait(300).then(function () {
            return ctx.reveal(items, { from: 'left', stagger: 350, dur: 400, dist: 14 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: G = 6 rollouts of the same task */
            setStation(ctx, S, 1);
            S.stopL.lastChild.textContent = 'RL: G = 6 rollouts';
            var h1 = ctx.text(745, 262, 'G = 6 rollouts of the same task', { size: 11, font: 'mono', color: 'dim', parent: R, opacity: 0 });
            var rn = ctx.rng(5);
            var anims = [ctx.reveal(h1, {}), ctx.pulse(S.st[1], { color: 'lime', times: 2, dur: 700 })];
            rw.forEach(function (rv, i) {
              var y = 292 + i * 42;
              var lab = ctx.text(712, y, 'o' + (i + 1), { size: 12, font: 'mono', color: 'text', parent: R, opacity: 0 });
              anims.push(ctx.reveal(lab, { delay: 200 + i * 150 }));
              var x = 745, n = 3 + Math.floor(rn() * 3);
              var blocks = ctx.group({ parent: R });
              for (var s = 0; s < n && x < 1090; s++) {
                var tw = 18 + rn() * 26, aw = 14 + rn() * 10, ow = 22 + rn() * 30;
                ctx.rect(x, y - 10, tw, 20, { rx: 3, fill: ctx.alpha('violet', 0.6), parent: blocks }); x += tw + 2;
                ctx.rect(x, y - 10, aw, 20, { rx: 3, fill: ctx.alpha('magenta', 0.7), parent: blocks }); x += aw + 2;
                S.toolBlocks.push(ctx.rect(x, y - 10, ow, 20, { rx: 3, fill: ctx.alpha('orange', 0.12), stroke: ctx.alpha('orange', 0.7), dash: '2 2', sw: 1, parent: blocks })); x += ow + 2;
              }
              ctx.rect(x, y - 10, 30, 20, { rx: 3, fill: ctx.alpha('amber', 0.7), parent: blocks });
              anims.push(ctx.reveal(blocks, { from: 'left', delay: 300 + i * 150, dur: 400 }));
            });
            return Promise.all(anims);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the verifier scores each rollout */
            var h2 = ctx.text(1300, 262, 'reward · click to flip', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: R, opacity: 0 });
            var anims = [ctx.reveal(h2, {})];
            rw.forEach(function (rv, i) {
              var y = 292 + i * 42;
              var chip = ctx.label(1300, y, 'r = ' + rv, { color: rewCol(rv), textColor: lite(ctx, rewCol(rv)), size: 12, w: 70, parent: R, opacity: 0 });
              chip.style.cursor = 'pointer';
              chip.addEventListener('click', function () { flipReward(i); });
              S.rChip.push(chip);
              anims.push(ctx.reveal(chip, { from: 'left', delay: 200 + i * 150, dist: 14 }));
            });
            var vr = ctx.text(712, 598, 'reward = schema valid ∧ critic ≥ τ ∧ within budget', { size: 12, font: 'mono', color: 'lime', parent: R, opacity: 0 });
            anims.push(ctx.reveal(vr, { from: 'up', delay: 900 }));
            return Promise.all(anims);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: advantage = reward relative to the group */
            var h3 = ctx.text(1450, 262, 'advantage Â', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: R, opacity: 0 });
            var ax = ctx.line(1450, 274, 1450, 520, { color: 'faint', parent: R, opacity: 0 });
            var anims = [ctx.reveal([h3, ax], {})];
            var st0 = advOf(S.rw), adv = st0.a;
            S.aBars = []; S.aTxt = [];
            rw.forEach(function (rv, i) {
              var y = 292 + i * 42;
              var bw = Math.abs(adv[i]) * 70;
              var bar = ctx.rect(adv[i] >= 0 ? 1450 : 1450 - bw, y - 8, bw, 16, { rx: 3, fill: adv[i] >= 0 ? ctx.alpha('lime', 0.7) : ctx.alpha('red', 0.7), parent: R, opacity: 0 });
              S.aBars.push(bar);
              anims.push(ctx.reveal(bar, { from: adv[i] >= 0 ? 'left' : 'right', delay: 200 + i * 100, dur: 400, dist: 10 }));
              var vt = ctx.text(adv[i] >= 0 ? 1450 - 6 : 1450 + 6, y, (adv[i] > 0 ? '+' : '') + adv[i].toFixed(2), { size: 11, font: 'mono', color: 'white', anchor: adv[i] >= 0 ? 'end' : 'start', parent: R, opacity: 0 });
              S.aTxt.push(vt);
              anims.push(ctx.reveal(vt, { delay: 300 + i * 100 }));
            });
            S.aStat = ctx.text(1450, 552, 'μ ' + st0.m.toFixed(2) + ' · σ ' + st0.sd.toFixed(2), { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: R, opacity: 0 });
            anims.push(ctx.reveal(S.aStat, { delay: 700 }));
            var fm = ctx.text(712, 570, 'Âᵢ = (rᵢ − mean r) / std r    θ ← θ + η ∇θ J_GRPO(θ)', { size: 15, font: 'mono', color: 'white', parent: R, opacity: 0 });
            anims.push(ctx.reveal(fm, { from: 'up', delay: 900 }));
            return Promise.all(anims);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: tool outputs carry no gradient */
            var lgd = ctx.group({ parent: R, opacity: 0 });
            ctx.rect(712, 530, 18, 14, { rx: 3, fill: ctx.alpha('violet', 0.6), parent: lgd });
            ctx.rect(732, 530, 14, 14, { rx: 3, fill: ctx.alpha('magenta', 0.7), parent: lgd });
            ctx.text(754, 537, 'policy tokens: trained', { size: 12, font: 'mono', color: 'text', parent: lgd });
            ctx.rect(960, 530, 30, 14, { rx: 3, fill: ctx.alpha('orange', 0.12), stroke: ctx.alpha('orange', 0.7), dash: '2 2', sw: 1, parent: lgd });
            ctx.text(998, 537, 'tool outputs: masked (no gradient)', { size: 12, font: 'mono', color: 'text', parent: lgd });
            setStation(ctx, S, 3);
            ctx.pulse(S.st[3], { color: 'orange', times: 2, dur: 700 });
            return Promise.all([
              ctx.reveal(lgd, { from: 'up', dur: 500 }),
              ctx.tween(1400, function (e) {
                var a = 0.12 + 0.4 * Math.sin(e * Math.PI);
                S.toolBlocks.forEach(function (b) { b.setAttribute('fill', ctx.alpha('orange', a)); });
              }, 'inOut')
            ]);
          });
        }
      },
      /* 8 ---------------------------------------------------------------- */
      {
        title: 'Failure modes',
        beats: [
          {
            say: 'Agents fail in characteristic ways. They get stuck in loops, calling the same tool with the same arguments. A turn cap and duplicate detection stop the repetition.',
            card: { tag: 'PITFALL', title: 'Loops and repetition', body: 'The same tool with the same arguments three times is a symptom, not a strategy. Dedupe on tool plus argument hash, cap the turns, then escalate.' },
            deep: '<table><tr><th>Failure</th><th>Signal</th><th>Mitigation</th></tr>' +
              '<tr><td>Loops</td><td>same (tool, hash(args)) ≥ 3×; no new artifact in k turns</td><td>dedupe, max_turns, inject a "you are repeating" observation, escalate</td></tr></table>' +
              '<p>Loop detection is cheap: keep a counter keyed by <code>(tool, sha1(args))</code> and a progress signal such as "new artifact produced". Three identical calls with no new artifact means the model is stuck; the harness stops it rather than hoping it notices.</p>'
          },
          {
            say: 'They hallucinate arguments that do not fit the schema, or refer to files that do not exist. Strict schemas and informative errors turn that into one more turn instead of a crash.',
            card: { tag: 'PITFALL', title: 'Hallucinated arguments', body: 'Twelve seconds when the maximum is ten; a file name nobody created. Validate, return an error the model can act on, and prefer IDs to free text.' },
            deep: '<table><tr><th>Failure</th><th>Signal</th><th>Mitigation</th></tr>' +
              '<tr><td>Hallucinated args</td><td>schema or semantic validation fails; unknown URIs</td><td>strict schemas via constrained decoding; <code>is_error</code> results with actionable text; enums/IDs instead of free text</td></tr></table>' +
              '<p>Constrained decoding (next chamber) makes the call <i>parse</i>; it cannot make the values true. Semantic validation (does this artifact exist? is the duration in range?) still belongs in the harness.</p>'
          },
          {
            say: 'As the context grows, their attention to earlier details degrades, which researchers call context rot. Compaction and fresh sub agents keep the window clean.',
            card: { tag: 'PITFALL', title: 'A longer window is not free', body: 'Accuracy on easy retrieval falls as input grows, well below the window limit. More context is not more capability.' },
            deep: '<table><tr><th>Failure</th><th>Signal</th><th>Mitigation</th></tr>' +
              '<tr><td>Context rot</td><td>accuracy falls with input length even on easy tasks (Chroma 2025); "lost in the middle" (Liu et al.)</td><td>compaction, just-in-time retrieval, sub-agents with clean windows</td></tr></table>' +
              '<p>The curve on the stage is illustrative, not a measurement. The robust finding across studies is the direction: performance degrades with length and with distractors, and the position of the relevant fact matters.</p>'
          },
          {
            say: 'And a small early mistake, like the wrong fur color, silently cascades through every later step. Verifiers at checkpoints catch it and roll back to the last good artifact.',
            card: { tag: 'NUMBERS', title: 'What a verifier buys', stat: { v: '0.36 → 0.82', l: 'success of a 20-step task at 5 percent error per step, without and with a verifier that catches 80 percent' }, more: '<p>Without a verifier: 0.95<sup>20</sup> = 0.358. With a verifier that catches 80% of errors and forces a retry, the residual error per step is 0.05 × 0.2 = 0.01, so 0.99<sup>20</sup> = 0.818. The verifier does not need to be perfect; even a weak one changes the exponent base.</p>' },
            deep: '<table><tr><th>Failure</th><th>Signal</th><th>Mitigation</th></tr>' +
              '<tr><td>Error cascades</td><td>downstream critic failures trace back to one early artifact</td><td>verifiers at checkpoints, provenance links, roll back to the last good artifact</td></tr></table>' +
              '<p>Compounding: with per-step error ε, P(success over n steps) ≈ (1 − ε)<sup>n</sup>. A verifier that catches a fraction c of errors (and retries) lowers the effective rate to ε(1 − c): ε = 0.05, n = 20 gives 0.36; with c = 0.8 it gives 0.82.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.R, 350);
          setStation(ctx, S, -1);
          S.stopL.lastChild.textContent = 'stop_reason: per turn';
          var R = S.R = ctx.group();
          /* beat 0: loops */
          var A = card(ctx, R, 700, 172, 420, 224, 'amber', 'Loops & repetition');
          S.loopCalls = [0, 1, 2].map(function (i) {
            return ctx.label(716, 228 + i * 34, 'search_assets("fox sheet")', { color: i < 2 ? 'amber' : 'red', size: 12, font: 'code', anchor: 'start', parent: A, opacity: i ? 0 : 1 });
          });
          S.loopCnt = ctx.text(1100, 250, '×1', { size: 26, font: 'mono', weight: 700, color: 'amber', anchor: 'end', parent: A });
          S.loopStop = ctx.label(1010, 336, 'loop detector: STOP', { color: 'red', size: 12, parent: A, opacity: 0 });
          var mA = ctx.text(716, 376, '✓ dedupe (tool, args), max_turns, escalate', { size: 12, font: 'mono', color: 'lime', parent: A, opacity: 0 });
          return ctx.reveal(A, { from: 'up', dur: 500 }).then(function () {
            return ctx.reveal(S.loopCalls[1], { from: 'down', delay: 200 });
          }).then(function () {
            S.loopCnt.textContent = '×2';
            return ctx.reveal(S.loopCalls[2], { from: 'down', delay: 300 });
          }).then(function () {
            S.loopCnt.textContent = '×3';
            S.loopCnt.setAttribute('fill', ctx.C.red);
            return ctx.reveal(S.loopStop, { from: 'scale' });
          }).then(function () {
            return ctx.reveal(mA, { from: 'up' });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: hallucinated arguments */
            var B = card(ctx, R, 1140, 172, 420, 224, 'magenta', 'Hallucinated arguments');
            ctx.text(1156, 214, 'generate_video({"shot": 3,', { size: 12, font: 'code', color: 'text', parent: B });
            S.badArg = ctx.text(1172, 234, '"duration_s": 12,', { size: 12, font: 'code', color: 'red', parent: B });
            ctx.text(1172, 254, '"ref": "fox_sheet_v9.png"})', { size: 12, font: 'code', color: 'red', parent: B });
            ctx.text(1544, 234, 'schema: ≤ 10', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B });
            ctx.text(1544, 254, 'no such artifact', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B });
            S.errChip = ctx.label(1156, 292, 'tool_result is_error: "duration_s must be ≤ 10"', { color: 'red', size: 11, anchor: 'start', parent: B, opacity: 0 });
            S.fixChip = ctx.label(1156, 326, 'retry: duration_s 5 · ref fox_sheet@7c1e ✓', { color: 'lime', size: 11, anchor: 'start', parent: B, opacity: 0 });
            var mB = ctx.text(1156, 376, '✓ strict schemas, IDs not free text', { size: 12, font: 'mono', color: 'lime', parent: B, opacity: 0 });
            return ctx.reveal(B, { from: 'up', dur: 500 }).then(function () {
              return ctx.pulse(S.badArg, { color: 'red', dur: 600 });
            }).then(function () {
              return ctx.reveal(S.errChip, { from: 'left' });
            }).then(function () {
              return ctx.reveal(S.fixChip, { from: 'left', delay: 200 });
            }).then(function () {
              return ctx.reveal(mB, { from: 'up' });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: context rot */
            var Cc = card(ctx, R, 700, 410, 420, 210, 'violet', 'Context rot');
            S.rot = ctx.plot(760, 468, 320, 98, function (x) { return 0.93 - 0.3 * Math.pow(x / 200, 1.3); }, { xDomain: [0, 200], yDomain: [0.5, 1], color: 'violet', xLabel: 'context tokens (k)', yLabel: 'accuracy', parent: Cc });
            var p0 = S.rot.toPx(0, 0.93);
            S.rotDot = ctx.circle(p0.x, p0.y, 5, { fill: 'violet', glow: true, parent: Cc });
            ctx.text(1100, 432, 'illustrative', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: Cc });
            var mC = ctx.text(716, 604, '✓ compaction, sub-agents with fresh windows', { size: 12, font: 'mono', color: 'lime', parent: Cc, opacity: 0 });
            return ctx.reveal(Cc, { from: 'up', dur: 500 }).then(function () {
              return ctx.tween(2200, function (e) {
                var xv = e * 190, p = S.rot.toPx(xv, 0.93 - 0.3 * Math.pow(xv / 200, 1.3));
                S.rotDot.setAttribute('cx', p.x); S.rotDot.setAttribute('cy', p.y);
              }, 'inOut');
            }).then(function () {
              return ctx.reveal(mC, { from: 'up' });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: error cascades */
            var D = card(ctx, R, 1140, 410, 420, 210, 'red', 'Error cascades');
            var chain = ['fur: grey', 'script', 'board', 'shots ×6'];
            S.casc = chain.map(function (c, i) {
              return ctx.node({ x: 1206 + i * 100, y: 474, w: 90, h: 34, title: c, titleSize: 12, color: i === 0 ? 'red' : 'faint', glow: false, parent: D });
            });
            for (var i = 0; i < 3; i++) ctx.line(1251 + i * 100, 474, 1259 + i * 100, 474, { color: 'dim', arrow: true, parent: D });
            S.verif = ctx.label(1160, 530, '▲ verifier: fur ≠ character sheet → roll back', { color: 'lime', size: 11, anchor: 'start', parent: D, opacity: 0 });
            var mD = ctx.text(1156, 604, '✓ checkpoints + provenance rollback', { size: 12, font: 'mono', color: 'lime', parent: D, opacity: 0 });
            return ctx.reveal(D, { from: 'up', dur: 500 }).then(function () {
              return S.casc.slice(1).reduce(function (p, n) {
                return p.then(function () {
                  n.body.setAttribute('stroke', ctx.C.red);
                  return ctx.pulse(n, { color: 'red', dur: 400 });
                });
              }, ctx.wait(300));
            }).then(function () {
              return ctx.reveal(S.verif, { from: 'up' });
            }).then(function () {
              S.casc.forEach(function (n) { n.body.setAttribute('stroke', ctx.C.lime); });
              S.casc[0].titleEl.textContent = 'fur: orange';
              return ctx.reveal(mD, { from: 'up' });
            });
          });
        }
      },
      /* 9 ---------------------------------------------------------------- */
      {
        title: 'The whole harness',
        beats: [
          {
            say: 'Put together, an agent is a small program around a large model, and here it is in about fifteen lines.',
            card: { tag: 'KEY IDEA', title: 'A small program around a big model', body: 'Fifteen lines of harness turn a next-token predictor into an agent. The model supplies the judgment; every guarantee comes from this code.' },
            deep: '<p>Design checklist for a production agent harness:</p>' +
              '<ul><li><b>Stable prefix</b>: version system prompts and tool schemas; keep volatile data after the cache breakpoint.</li>' +
              '<li><b>Few, orthogonal tools</b> with precise descriptions; errors that tell the model how to fix the call.</li>' +
              '<li><b>One adapter per provider</b>: the wire format (template, content blocks, stop reasons) is the only vendor-specific code; everything else in the harness stays model-agnostic.</li></ul>'
          },
          {
            say: 'It assembles a context, samples, parses, acts through tools, appends observations, and checks its budget and stop conditions on every turn.',
            card: { tag: 'HOW IT WORKS', title: 'Every station is a few lines', body: 'The highlight walks the loop: assemble, sample, parse, execute, append. The last lines are the ones the model is never trusted with: budget and stop.' },
            deep: '<ul><li><b>Hard budgets enforced by code</b>: turns, tokens, wall-clock, dollars; the model is told its budget but never trusted to enforce it.</li>' +
              '<li><code>max_tokens</code> stops are handled explicitly: drop the partial turn (a truncated tool_use is invalid), double the limit, continue.</li>' +
              '<li>Tool calls run in parallel with a sandbox and a timeout; failures become <code>is_error</code> results, not exceptions.</li></ul>'
          },
          {
            say: 'It manages the context window the way an operating system manages memory: caching the prefix, paging out stale results, compacting history, and keeping notes on disk.',
            card: { tag: 'KEY IDEA', title: 'The window has a memory hierarchy', body: 'Prefix cache, tool-result clearing, compaction and external notes play the roles of cache, swap, paging and disk.' },
            deep: '<ul><li><b>Context policy</b>: clearing, compaction threshold, external notes, sub-agents for exploration.</li>' +
              '<li>The compaction check sits <i>before</i> the model call: the harness decides when to page, never the model, because a full window fails the request rather than degrading gracefully.</li></ul>' +
              '<table><tr><th>Operating system</th><th>Context window</th></tr>' +
              '<tr><td>CPU cache</td><td>prompt prefix cache</td></tr>' +
              '<tr><td>page eviction</td><td>tool-result clearing</td></tr>' +
              '<tr><td>swap / compress</td><td>compaction summary</td></tr>' +
              '<tr><td>disk</td><td>NOTES.md, memory tool</td></tr></table>'
          },
          {
            say: 'The model supplies judgment; the harness supplies structure, safety and persistence. In our trailer, dozens of these loops run at once, one per task, each a leaf in the orchestrator graph.',
            card: { tag: 'WHY IT MATTERS', title: 'An agent is a process', body: 'Supervise it like a process: limits, logs, restarts, evals. Dozens of these loops run per trailer, one for every leaf task.' },
            deep: '<ul><li><b>Observability</b>: one trace span per turn and per tool call, with token usage, cache hit rate and latency.</li>' +
              '<li><b>Evals</b>: trajectory-level success rate, turns and cost per task, a regression suite of hard cases; replay traces to test prompt changes.</li></ul>' +
              '<div class="note">An LLM call is a function; an agent is a process. Treat it with the same tools you use for processes: supervision, limits, logs and restarts.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.R, 350);
          var R = S.R = ctx.group();
          var code = ctx.code({ x: 690, y: 170, w: 870, title: 'agent_harness.py', lang: 'py', size: 12, color: 'magenta', parent: R, lines: [
            'def run_agent(task, tools, budget, max_turns=40):',
            '    ctx = Context(system=SYS, tools=tools.schemas(), memory=recall(task))',
            '    ctx.add_user(task); max_out = 16000',
            '    for turn in range(max_turns):',
            '        if ctx.tokens() > 0.8 * WINDOW: ctx.compact()',
            '        r = llm.sample(ctx, max_tokens=max_out, thinking=4000)',
            '        budget.charge(r.usage)',
            '        if r.stop_reason == "max_tokens": max_out *= 2; continue   # drop partial turn',
            '        ctx.add_assistant(r.content)          # keep thinking blocks + signatures',
            '        if r.stop_reason == "end_turn": return r.final()',
            '        calls = [b for b in r.content if b.type == "tool_use"]',
            '        outs = parallel(execute(c, sandbox=True, timeout=120) for c in calls)',
            '        ctx.add_user([tool_result(c.id, o, is_error=o.failed) for c, o in zip(calls, outs)])',
            '        if budget.exhausted() or looping(ctx): return escalate(ctx)',
            '    return escalate(ctx)'
          ] });
          S.hl = ctx.rect(694, 0, 862, 18, { rx: 3, fill: ctx.alpha('magenta', 0.18), stroke: ctx.alpha('magenta', 0.6), sw: 1, parent: R, opacity: 0 });
          var lineY = function (i) { return 170 + 46 + i * 18.6 - 9; };
          S.iterTxt.textContent = '∞';
          S.stopL.lastChild.textContent = 'stop_reason: per turn';
          /* beat 0: the harness in fifteen lines */
          return ctx.reveal(R, { from: 'right', dur: 500 }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: walk the loop, station by station */
            var map = [[0, [1, 2, 4]], [1, [5, 6]], [2, [7, 8, 9, 10]], [3, [11]], [4, [12, 13]]];
            var seq = Promise.resolve();
            map.forEach(function (m, k) {
              seq = seq.then(function () {
                return moveDot(ctx, S, k / 5, k / 5 + 0.001, 10);
              }).then(function () {
                S.hl.setAttribute('opacity', 1);
                var ls = m[1];
                S.hl.setAttribute('y', lineY(ls[0]));
                S.hl.setAttribute('height', (ls[ls.length - 1] - ls[0]) * 18.6 + 18);
                ctx.pulse(S.st[m[0]], { color: S.st[m[0]].color, dur: 600 });
                return moveDot(ctx, S, k / 5, (k + 1) / 5, 900);
              });
            });
            return seq.then(function () {
              /* the guard rails: budget and stop conditions */
              S.dot.setAttribute('opacity', 0);
              setStation(ctx, S, -1);
              S.hl.setAttribute('y', lineY(13));
              S.hl.setAttribute('height', 18);
              return ctx.pulse(S.stopL, { color: 'pink', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the context is managed like memory */
            S.hl.setAttribute('y', lineY(4));
            S.hl.setAttribute('height', 18);
            var note = ctx.text(1125, 608, 'the context window is managed like memory in an operating system', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: R, opacity: 0 });
            return Promise.all([ctx.reveal(note, { from: 'up' }), ctx.pulse(S.gBar, { color: 'white', times: 2, dur: 700 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: model versus harness */
            S.hl.setAttribute('opacity', 0);
            setStation(ctx, S, 0);
            var tail = ctx.group({ parent: R });
            var chips = [['model: judgment', 'amber', 800], ['harness: structure · safety · persistence', 'magenta', 1100], ['one loop per DAG leaf', 'lime', 1420]].map(function (c) {
              return ctx.label(c[2], 560, c[0], { color: c[1], size: 12, parent: tail, opacity: 0 });
            });
            return ctx.reveal(chips, { from: 'up', stagger: 300 });
          });
        }
      }
    ]
  });
})();
