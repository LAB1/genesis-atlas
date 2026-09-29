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

  /* preserve leading/aligned spaces in code text */
  function keepWS(root) {
    Array.prototype.forEach.call(root.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
  }

  function chipW(str, size) { return Math.max(24, str.length * size * 0.62 + 18); }

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
      var p = S.ring.getPointAtLength(L * (f - Math.floor(f)) );
      S.dot.setAttribute('cx', p.x); S.dot.setAttribute('cy', p.y);
      setStation(ctx, S, Math.floor(((f % 1) + 0.1) * 5) % 5);
    }, 'inOut');
  }

  function row(ctx, S, kind, txt, turn, tagText) {
    var y = 214 + S.rowN * 46; S.rowN++;
    var col = KCOL[kind];
    var g = ctx.group({ parent: S.R });
    ctx.rect(722, y - 19, 826, 38, { rx: 6, fill: ctx.alpha(col, 0.07), stroke: ctx.alpha(col, 0.5), sw: 1, parent: g });
    ctx.label(784, y, tagText || kind, { color: col, size: 11, w: 112, parent: g });
    g.textEl = ctx.text(850, y, txt, { size: 12, font: 'mono', color: 'text', parent: g });
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
    var t = ctx.text(x, y, '', { size: size, font: 'mono', color: 'text', parent: parent });
    var parts = str.split(/(<\|[a-z_]+\|>|<\/?(?:tools|think|tool_call|tool_response)>)/);
    var prevStart = false;
    parts.forEach(function (p) {
      if (!p) return;
      var c = null;
      if (/^<\|/.test(p)) c = ctx.C.magenta;
      else if (/^<\/?[a-z_]+>$/.test(p)) c = ctx.C.violet;
      else if (prevStart) c = ctx.C.amber;
      var ts = ctx.el('tspan', c ? { fill: c } : {}, t);
      ts.textContent = p;
      prevStart = p === '<|im_start|>';
    });
    return t;
  }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.94)', stroke: ctx.alpha(color, 0.6), parent: g });
    ctx.text(x + 16, y + 22, title, { size: 14, font: 'display', weight: 700, color: color, parent: g });
    g.box = { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h };
    return g;
  }

  Atlas.register({
    id: 'agent-loop',
    refs: [
      'Yao et al., <i>ReAct: Synergizing Reasoning and Acting in Language Models</i>, ICLR 2023',
      'Shinn et al., <i>Reflexion: Language Agents with Verbal Reinforcement Learning</i>, NeurIPS 2023',
      'Wang et al., <i>Plan-and-Solve Prompting</i>, ACL 2023',
      'Schick et al., <i>Toolformer: Language Models Can Teach Themselves to Use Tools</i>, NeurIPS 2023',
      'Shao et al., <i>DeepSeekMath</i> (GRPO), 2024; DeepSeek-AI, <i>DeepSeek-R1</i>, Nature 2025; Yu et al., <i>DAPO</i>, 2025',
      'Liu et al., <i>Lost in the Middle: How Language Models Use Long Contexts</i>, TACL 2024; Hong et al., <i>Context Rot</i>, Chroma Research 2025',
      'Anthropic, <i>Effective context engineering for AI agents</i>, 2025; <i>Extended thinking</i> &amp; <i>prompt caching</i> API docs',
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
        say: 'Start with what a language model actually is: a function that, given a sequence of tokens, returns a probability distribution over the next one. Sample a token, append it, repeat. Nothing in that loop acts on the world. But suppose the model has learned that when it needs information, it should emit a special token that opens a tool call. A surrounding program, the harness, watches for that token, stops sampling, and takes over. That small contract is the seed of every agent.',
        deep: '<div class="eq">p<sub>θ</sub>(x<sub>1:T</sub>) = ∏<sub>t</sub> p<sub>θ</sub>(x<sub>t</sub> | x<sub>&lt;t</sub>), &nbsp; x<sub>t</sub> ~ softmax(z<sub>t</sub> / τ)</div>' +
          '<p>Decoding runs one forward pass per token; with a KV cache each step attends over all t previous positions (O(t·d) per layer). An <b>agent</b> wraps a second, outer loop around this one:</p>' +
          '<table><tr><th></th><th>Inner loop (decoder)</th><th>Outer loop (harness)</th></tr>' +
          '<tr><td>unit</td><td>token → token</td><td>turn → turn</td></tr>' +
          '<tr><td>period</td><td>~10–50 ms</td><td>seconds to minutes</td></tr>' +
          '<tr><td>state</td><td>KV cache</td><td>context + external memory</td></tr>' +
          '<tr><td>ends at</td><td>stop token</td><td>end_turn, budget, max turns</td></tr></table>' +
          '<p>Special tokens such as <code>&lt;tool_call&gt;</code> or <code>&lt;&#8202;|im_end|&#8202;&gt;</code> are ordinary vocabulary entries whose meaning is fixed by post-training and by the harness parser. The model never executes anything; it only proposes structured text.</p>' +
          '<div class="note">Agent = LLM + tools + a loop that feeds observations back + memory + a stop rule.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var G = S.g1 = ctx.group();
          ctx.text(70, 198, 'CONTEXT  x<t', { size: 12, font: 'mono', color: 'dim', weight: 600, parent: G, spacing: 1.5 });
          S.sx = 70;
          var addTok = function (str, kind, parent) {
            var w = chipW(str, 12), cx = S.sx + w / 2;
            S.sx += w + 6;
            var col = kind === 'sp' ? 'magenta' : (kind === 'role' ? 'amber' : (kind === 'gen' ? 'lime' : 'cyan'));
            var l = ctx.label(cx, 232, str, { color: col, size: 12, parent: parent || G });
            l.cx = cx;
            return l;
          };
          var toks = [['<|im_start|>', 'sp'], ['user', 'role'], ['Storyboard', 't'], ['shot', 't'], ['3', 't'], ['<|im_end|>', 'sp'], ['<|im_start|>', 'sp'], ['assistant', 'role']];
          var chips = toks.map(function (t) { return addTok(t[0], t[1]); });
          ctx.reveal(chips, { from: 'up', stagger: 60 });
          /* LLM block */
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
          ctx.text(750, 468, 'logits z', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          ctx.reveal(S.llm, { from: 'scale', delay: 300 });
          ctx.reveal([S.aIn, S.aOut], { from: 'draw', delay: 500, stagger: 200 });
          /* distribution */
          var D = S.dist = ctx.group({ parent: G });
          ctx.rect(820, 380, 440, 220, { rx: 10, fill: 'rgba(8,14,28,0.9)', stroke: ctx.alpha('amber', 0.5), parent: D });
          ctx.text(840, 402, 'next-token distribution · softmax(z / τ)', { size: 12, font: 'mono', color: 'amber', parent: D });
          S.drows = [];
          for (var k = 0; k < 5; k++) {
            var y = 438 + k * 34;
            S.drows.push({
              lab: ctx.text(962, y, '', { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: D }),
              bg: ctx.rect(972, y - 8, 230, 16, { rx: 3, fill: 'rgba(255,255,255,0.05)', parent: D }),
              bar: ctx.rect(972, y - 8, 0, 16, { rx: 3, fill: ctx.alpha('amber', 0.45), parent: D }),
              p: ctx.text(1248, y, '', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: D })
            });
          }
          ctx.reveal(D, { from: 'right', delay: 600 });
          var rounds = [
            [['I', 0.41], ['Let', 0.22], ['The', 0.15], ['<tool_call>', 0.12], ['First', 0.05]],
            [['need', 0.58], ['will', 0.21], ['should', 0.09], ['can', 0.06], ['want', 0.03]],
            [['refs', 0.37], ['the', 0.33], ['to', 0.15], ['a', 0.08], ['more', 0.04]],
            [['<tool_call>', 0.71], ['.', 0.12], ['first', 0.08], ['before', 0.05], [':', 0.02]]
          ];
          var doRound = function (rd, idx) {
            rd.forEach(function (c, j) {
              var R = S.drows[j];
              R.lab.textContent = c[0];
              R.lab.setAttribute('fill', /^</.test(c[0]) ? ctx.C.magenta : ctx.C.text);
              R.p.textContent = c[1].toFixed(2);
              R.bar.setAttribute('fill', ctx.alpha('amber', 0.45));
            });
            var anim = rd.map(function (c, j) {
              var R = S.drows[j], w0 = parseFloat(R.bar.getAttribute('width'));
              return ctx.animate(R.bar, { width: [w0, 230 * c[1]] }, 350, 'out');
            });
            S.layers.forEach(function (l, li) { ctx.animate(l, { opacity: [1, 0.35] }, 160, 'linear', li * 50).then(function () { l.setAttribute('opacity', 1); }); });
            return Promise.all(anim).then(function () {
              S.drows[0].bar.setAttribute('fill', idx === 3 ? ctx.C.magenta : ctx.C.amber);
              var str = rd[0][0], w = chipW(str, 12), cx = S.sx + w / 2;
              S.sx += w + 6;
              var fg = ctx.group({ parent: G });
              ctx.label(0, 0, str, { color: idx === 3 ? 'magenta' : 'lime', size: 12, parent: fg, bgAlpha: idx === 3 ? 0.35 : 0.14 });
              ctx.place(fg, 930, 438);
              S.lastTok = fg;
              return ctx.transform(fg, { x: cx, y: 232 }, 550, 'inOut');
            });
          };
          return ctx.wait(900).then(function () {
            return rounds.reduce(function (p, rd, i) { return p.then(function () { return doRound(rd, i).then(function () { return ctx.wait(200); }); }); }, Promise.resolve());
          }).then(function () {
            ctx.pulse(S.lastTok, { color: 'magenta', times: 2, dur: 600 });
            S.harness = ctx.node({ x: 1420, y: 490, w: 250, h: 84, title: 'Harness', sub: 'stop · parse · execute', icon: 'loop', color: 'magenta', parent: G });
            S.aH = ctx.link({ x: 1262, y: 490 }, S.harness, { color: 'magenta', straight: true, parent: G });
            ctx.text(1420, 560, 'the model only emits tokens;', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
            ctx.text(1420, 578, 'the harness acts on them', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
            ctx.reveal(S.harness, { from: 'left' });
            ctx.reveal(S.aH, { from: 'draw', delay: 200 });
            /* agent equation */
            var eq = ctx.group({ parent: G });
            var parts = [['LLM', 'amber'], ['+', null], ['tools', 'magenta'], ['+', null], ['loop', 'cyan'], ['+', null], ['memory', 'teal'], ['+', null], ['stop rule', 'pink'], ['=', null], ['AGENT', 'white']];
            var x = 420;
            parts.forEach(function (p) {
              if (p[1]) { var w = chipW(p[0], 15); ctx.label(x + w / 2, 700, p[0], { color: p[1], size: 15, parent: eq }); x += w + 12; }
              else { ctx.text(x + 4, 700, p[0], { size: 20, font: 'mono', color: 'dim', anchor: 'middle', parent: eq }); x += 22; }
            });
            ctx.text(715, 748, 'inner loop: token → token, milliseconds  ·  outer loop: turn → turn, seconds to minutes', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: eq });
            ctx.reveal(eq, { from: 'up', delay: 500 });
            return ctx.wait(1400);
          });
        }
      },
      /* 2 ---------------------------------------------------------------- */
      {
        title: 'Chat template',
        say: 'Before the model sees anything, the conversation is serialized into one flat token sequence by a chat template. Special tokens mark where each message starts and ends and which role wrote it: system, user, assistant, or tool. Tool definitions are rendered into the system section, the model\'s tool calls appear as tagged JSON, and tool results come back as another message. During fine-tuning, only the assistant\'s tokens receive loss, so the model learns to produce actions, not to imitate tool outputs.',
        deep: '<p>The chat template is part of the model\'s interface contract (shipped as Jinja in <code>tokenizer_config.json</code> for open models). ChatML (Qwen) uses <code>&lt;&#8202;|im_start|&#8202;&gt;role … &lt;&#8202;|im_end|&#8202;&gt;</code>; Llama 3.1 uses <code>&lt;&#8202;|start_header_id|&#8202;&gt;role&lt;&#8202;|end_header_id|&#8202;&gt;</code>, an <code>ipython</code> role for tool output, <code>&lt;&#8202;|python_tag|&#8202;&gt;</code> before built-in tool calls and <code>&lt;&#8202;|eom_id|&#8202;&gt;</code> for “message ends, expect a tool result” (versus <code>&lt;&#8202;|eot_id|&#8202;&gt;</code>, end of turn). Hosted APIs hide the template and expose typed <b>content blocks</b>: <code>text</code>, <code>thinking</code>, <code>tool_use</code>, <code>tool_result</code>.</p>' +
          '<ul><li>Each special token is a <b>single ID</b> (e.g. <code>&lt;&#8202;|im_start|&#8202;&gt;</code> = 151644 in Qwen2). If the tokenizer refuses to produce special IDs from raw user text, role boundaries cannot be spoofed by typing them.</li>' +
          '<li><b>Loss masking</b>: SFT minimises <code>L = −Σ<sub>t</sub> m<sub>t</sub> log p(x<sub>t</sub> | x<sub>&lt;t</sub>)</code> with m<sub>t</sub> = 1 only on assistant tokens (including its end token), 0 on system, user and tool tokens.</li>' +
          '<li>A mismatch between training and serving templates (missing generation prompt, whitespace, tool-schema rendering) is a classic silent quality bug.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.g1, 400);
          var G = S.g2 = ctx.group();
          ctx.rect(60, 172, 960, 306, { rx: 10, fill: 'rgba(6,12,24,0.94)', stroke: ctx.alpha('cyan', 0.5), parent: G });
          ctx.rect(60, 172, 960, 28, { rx: 10, fill: ctx.alpha('cyan', 0.12), parent: G });
          ctx.text(78, 186, 'chat template (ChatML / Qwen-style) · what the tokenizer receives', { size: 12, font: 'mono', color: 'cyan', parent: G });
          var L = [
            ['<|im_start|>system', 0], ['You are the Storyboard agent of job 7f3a. Plan shots, then call tools.', 0],
            ['<tools>[{"name":"search_assets","parameters":{...}}, ...]</tools><|im_end|>', 0],
            ['<|im_start|>user', 1], ['Storyboard 6 shots: fox astronaut crash-lands on a glowing ice moon.<|im_end|>', 1],
            ['<|im_start|>assistant', 2], ['<think>Need the character sheet before drawing keyframes.</think>', 2],
            ['<tool_call>{"name":"search_assets","arguments":{"query":"fox sheet","k":3}}</tool_call><|im_end|>', 2],
            ['<|im_start|>user', 3], ['<tool_response>{"hits":["artifact://fox_sheet@7c1e", ...]}</tool_response><|im_end|>', 3],
            ['<|im_start|>assistant', 4]
          ];
          var lineY = function (i) { return 220 + i * 24; };
          var lines = L.map(function (l, i) { return rich(ctx, G, 76, lineY(i), l[0], 14); });
          ctx.reveal(lines, { from: 'left', stagger: 180, dur: 300, dist: 12 });
          /* role brackets + loss mask */
          ctx.text(1050, 186, 'ROLE', { size: 12, font: 'mono', color: 'dim', weight: 600, parent: G, spacing: 1.5 });
          ctx.text(1255, 186, 'SFT LOSS', { size: 12, font: 'mono', color: 'dim', weight: 600, parent: G, spacing: 1.5 });
          var groups = [[0, 2, 'system', 'cyan', false], [3, 4, 'user', 'blue', false], [5, 7, 'assistant', 'amber', true], [8, 9, 'tool (user role)', 'teal', false], [10, 10, 'gen. prompt', 'amber', false]];
          var br = groups.map(function (g) {
            var b = ctx.group({ parent: G });
            var y0 = lineY(g[0]) - 8, y1 = lineY(g[1]) + 8, ym = (y0 + y1) / 2;
            ctx.path('M1036,' + y0 + ' H1044 V' + y1 + ' H1036', { color: g[3], sw: 1.6, parent: b });
            ctx.label(1054, ym, g[2], { color: g[3], size: 11, anchor: 'start', parent: b });
            ctx.label(1255, ym, g[4] ? 'loss ✓' : 'masked', { color: g[4] ? 'lime' : 'dim', size: 11, anchor: 'start', w: 76, parent: b });
            return b;
          });
          ctx.reveal(br, { from: 'left', stagger: 250, delay: 1600 });
          /* flat token view */
          ctx.text(60, 512, 'WHAT THE MODEL SEES · one flat sequence of integer token IDs', { size: 12, font: 'mono', color: 'dim', weight: 600, parent: G, spacing: 1 });
          var seg = function (c) {
            if (c <= 15) return 0; if (c <= 22) return 1; if (c <= 38) return 2; if (c <= 54) return 3; if (c <= 57) return 4; return 5;
          };
          var special = [0, 15, 16, 22, 23, 38, 39, 54, 55];
          var colOf = function (c) {
            if (special.indexOf(c) >= 0) return ctx.C.magenta;
            return [ctx.alpha('cyan', 0.55), ctx.alpha('blue', 0.6), ctx.alpha('amber', 0.6), ctx.alpha('teal', 0.55), ctx.alpha('amber', 0.3), 'rgba(255,255,255,0.04)'][seg(c)];
          };
          S.tokM = ctx.matrix(150, 534, 2, 64, { cell: 17, gap: 3, values: function () { return 'rgba(255,255,255,0.04)'; }, rowLabels: ['tokens', 'loss'], parent: G });
          ctx.text(60, 608, '<|im_start|> = one ID (151644 in Qwen2) · loss only where the model must learn to act', { size: 12, font: 'mono', color: 'dim', parent: G });
          ctx.reveal(S.tokM, { delay: 400 });
          /* the same tool call in three dialects */
          var dial = [
            [60, 'amber', 'ChatML · Qwen 2.5 / 3', ['<|im_start|>assistant', '<tool_call>{"name": …, "arguments": {…}}</tool_call>', 'result: user turn wrapped in <tool_response>'], true],
            [565, 'cyan', 'Llama 3.1 · built-in tools', ['<|start_header_id|>assistant<|end_header_id|>', '<|python_tag|>brave_search.call(query="…")<|eom_id|>', 'result: <|start_header_id|>ipython<|end_header_id|>'], true],
            [1070, 'magenta', 'Hosted API · typed content blocks', ['assistant: [thinking, text, tool_use{id, name, input}]', 'user: [tool_result{tool_use_id, content, is_error}]', 'template applied server-side, never visible'], false]
          ];
          S.dial = dial.map(function (d) {
            var cg = card(ctx, G, d[0], 650, 470, 126, d[1], d[2]);
            d[3].forEach(function (s, i) {
              if (d[4]) rich(ctx, cg, d[0] + 16, 690 + i * 24, s, 12);
              else ctx.text(d[0] + 16, 690 + i * 24, s, { size: 12, font: 'mono', color: 'text', parent: cg });
            });
            return cg;
          });
          var dialH = ctx.text(60, 634, 'SAME ACTION, THREE WIRE FORMATS · the harness parser must match the template the model was trained on', { size: 12, font: 'mono', color: 'dim', weight: 600, parent: G, spacing: 1 });
          ctx.reveal([dialH].concat(S.dial), { from: 'up', stagger: 200, delay: 2800 });
          return ctx.wait(2400).then(function () {
            return ctx.tween(1600, function (e) {
              var k = Math.round(e * 64);
              for (var c = 0; c < 64; c++) {
                S.tokM.cells[0][c].setAttribute('fill', c < k ? colOf(c) : 'rgba(255,255,255,0.04)');
                var trained = c >= 25 && c <= 38;
                S.tokM.cells[1][c].setAttribute('fill', c < k ? (trained ? ctx.C.lime : 'rgba(255,255,255,0.07)') : 'rgba(255,255,255,0.04)');
              }
            }, 'linear');
          }).then(function () { return ctx.wait(600); });
        }
      },
      /* 3 ---------------------------------------------------------------- */
      {
        title: 'Context assembly',
        say: 'Each turn, a context builder assembles what the model will see. The stable part comes first: tool schemas, then the system prompt with the agent\'s role and rules. Then retrieved memory, like the fox character sheet and style notes, the task from the orchestrator, the conversation history, and the latest observation. Order matters, because the provider can cache the longest unchanged prefix. The window is a fixed budget, two hundred thousand tokens here, and everything the agent knows in this moment must fit inside it.',
        deep: '<p>Context engineering = choosing the smallest set of high-signal tokens for the next step. Typical request for this agent:</p>' +
          '<table><tr><th>Segment</th><th>Tokens</th><th>Changes</th></tr>' +
          '<tr><td>Tool schemas</td><td>~3.4k</td><td>per deployment</td></tr>' +
          '<tr><td>System prompt</td><td>~2.1k</td><td>per agent role</td></tr>' +
          '<tr><td>Retrieved memory</td><td>~4k</td><td>per task</td></tr>' +
          '<tr><td>Task + history + observations</td><td>grows every turn</td><td>every turn</td></tr></table>' +
          '<p><b>Prompt caching</b> keys on an exact prefix in the order tools → system → messages. With a breakpoint after the system prompt, later turns read that prefix at ≈ 0.1× the input price and skip its prefill; writing the cache costs ≈ 1.25× (5-minute TTL; a 1-hour TTL costs 2×). Anything volatile (timestamps, request IDs) must go <i>after</i> the breakpoint or the hit rate collapses.</p>' +
          '<div class="eq">prompt tokens + max_tokens ≤ context window</div>' +
          '<p>Output (including thinking) is reserved up front, here 16k of the 200k window.</p>',
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
          ctx.reveal(S.src, { from: 'left', stagger: 110 });
          ctx.reveal(S.builder, { from: 'scale', delay: 500 });
          ctx.reveal(links, { from: 'draw', delay: 600, stagger: 80 });
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
          keepWS(S.req);
          S.req.lineEls.forEach(function (l) { l.setAttribute('opacity', 0); });
          ctx.reveal(S.req, { from: 'right', delay: 300, dur: 400 });
          var info = ctx.group({ parent: G });
          [['prefix order: tools → system → messages', 'magenta'], ['cache breakpoint after system: turn 2+ reads 5.5k tokens at ≈ 0.1× price', 'cyan'], ['budget: prompt + max_tokens (16k) ≤ 200k window', 'amber']].forEach(function (t, i) {
            ctx.circle(612, 452 + i * 32, 4, { fill: t[1], parent: info });
            ctx.text(626, 452 + i * 32, t[0], { size: 13, font: 'mono', color: 'text', parent: info });
          });
          /* persistent context bar */
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
          ctx.text(BX + 160000 * PX, 742, 'compact at 80%', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: B });
          [50, 100, 150].forEach(function (k) { ctx.text(BX + k * 1000 * PX, 742, k + 'k', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B }); });
          S.cacheL = ctx.group({ parent: B });
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
          ctx.reveal(B, { from: 'up', delay: 200 });
          S.cacheL.setAttribute('opacity', 0);
          return ctx.wait(900).then(function () {
            return Promise.all(S.src.slice(0, 4).map(function (n, i) { return ctx.packet(links[i], { color: SEGC[['tools', 'system', 'memory', 'task'][i]], dur: 700 + i * 80 }); }));
          }).then(function () {
            ctx.pulse(S.builder, { color: 'white' });
            S.req.lineEls.forEach(function (l, i) { ctx.reveal(l, { from: 'left', delay: i * 110, dur: 300, dist: 10, opacity: 1 }); });
            return setCtx(ctx, S, { tools: 3400, system: 2100, memory: 4000, task: 300 }, 1400);
          }).then(function () {
            ctx.reveal(S.cacheL, { opacity: 1 });
            ctx.reveal(info, { from: 'up', stagger: 0 });
            return ctx.wait(1200);
          });
        }
      },
      /* 4 ---------------------------------------------------------------- */
      {
        title: 'The loop',
        say: 'Now the loop itself. Assemble the context, sample a response, and parse it into content blocks: some thinking, maybe some text, and zero or more tool calls. If the stop reason is tool use, the harness executes the calls, appends each result tagged with the call\'s id, and goes around again. Here the storyboard agent searches for the character sheet, then renders six keyframes in parallel, then composes the board and ends its turn. Three iterations, and the context grew with every observation.',
        deep: '<pre>msgs = [user(task)]\nfor turn in range(MAX_TURNS):\n    r = llm(system, tools, msgs)\n    msgs.append(assistant(r.content))\n    if r.stop_reason == "end_turn":\n        return r\n    calls = [b for b in r.content\n             if b.type == "tool_use"]\n    outs = await gather(*map(run, calls))\n    msgs.append(user([tool_result(c.id, o)\n                 for c, o in zip(calls, outs)]))\nraise TurnLimitExceeded</pre>' +
          '<table><tr><th>stop_reason</th><th>Meaning → harness action</th></tr>' +
          '<tr><td><code>tool_use</code></td><td>wants actions → execute, append results</td></tr>' +
          '<tr><td><code>end_turn</code></td><td>done → return final content</td></tr>' +
          '<tr><td><code>max_tokens</code></td><td>truncated; a partial tool_use is invalid → retry with a larger limit</td></tr>' +
          '<tr><td><code>pause_turn</code></td><td>server-side tool loop paused → resend to continue</td></tr>' +
          '<tr><td><code>refusal</code></td><td>policy stop → surface to orchestrator</td></tr></table>' +
          '<p>Parallel calls: several <code>tool_use</code> blocks in one turn; all results go back in the next user message, matched by <code>tool_use_id</code>. Latency per turn ≈ prefill + decode + max(tool latency).</p>',
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
            return ctx.node({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), w: 136, h: 42, title: n[0], sub: n[1], color: n[2], titleSize: 14, subSize: 11, glow: false, parent: LG });
          });
          ctx.text(cx, cy - 36, 'ITERATION', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: LG, spacing: 2 });
          S.iterTxt = ctx.text(cx, cy + 2, '0', { size: 40, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: LG });
          S.stopL = ctx.label(cx, cy + 46, 'stop_reason: —', { color: 'dim', size: 12, w: 196, parent: LG });
          S.exitA = ctx.path('M' + (S.st[2].box.r - 10) + ',' + S.st[2].box.b + ' Q' + (S.st[2].box.r + 6) + ',638 600,640', { color: 'lime', sw: 1.6, arrow: true, dash: '4 4', parent: LG });
          S.exitA.len = S.exitA.getTotalLength();
          S.exitL = ctx.label(666, 640, 'end_turn → return', { color: 'lime', size: 12, parent: LG });
          S.dot = ctx.circle(cx, cy - r, 7, { fill: 'white', glow: 'strong', parent: LG });
          ctx.reveal(S.ring, { from: 'draw', dur: 800 });
          ctx.reveal(S.st, { from: 'scale', stagger: 100, delay: 200 });
          ctx.reveal(arcs, { from: 'draw', stagger: 100, delay: 500 });
          /* transcript panel */
          var R = S.R = ctx.group();
          ctx.rect(690, 170, 870, 450, { rx: 10, fill: 'rgba(6,12,24,0.92)', stroke: ctx.alpha('magenta', 0.45), parent: R });
          ctx.text(706, 188, 'TRANSCRIPT · storyboard agent · content blocks', { size: 12, font: 'mono', weight: 600, color: 'magenta', parent: R, spacing: 1 });
          ctx.reveal(R, { from: 'right', delay: 300 });
          S.rowN = 0;
          var setStop = function (s, col) {
            S.stopL.lastChild.textContent = 'stop_reason: ' + s;
            S.stopL.lastChild.setAttribute('fill', ctx.color(col));
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
                ctx.pulse(S.exitL, { color: 'lime' });
                return ctx.packet(S.exitA, { color: 'lime', dur: 600 });
              }
              return moveDot(ctx, S, 0.4, 0.6, 450).then(function () {
                res();
                return Promise.all([setCtx(ctx, S, ctxR, 600), ctx.wait(700)]);
              }).then(function () {
                return moveDot(ctx, S, 0.6, 1.0, 750);
              });
            });
          };
          return ctx.wait(1000).then(function () {
            return iter(1, function () {
              row(ctx, S, 'thinking', 'need the fox character sheet before drawing', '1');
              row(ctx, S, 'tool_use', 'search_assets({"query":"fox astronaut sheet","k":3})');
            }, { thinking: 150, asst: 250 }, function () {
              row(ctx, S, 'tool_result', '3 hits · fox_sheet@7c1e · helmet@a02b · moon@19fd');
            }, { results: 600 }, 'tool_use');
          }).then(function () {
            return iter(2, function () {
              row(ctx, S, 'thinking', 'draft all six keyframes in parallel, same refs', '2');
              row(ctx, S, 'tool_use', 'render_keyframe({"shot":1..6,"refs":["fox_sheet@7c1e"]})', null, 'tool_use ×6');
            }, { thinking: 350, asst: 700 }, function () {
              var g = row(ctx, S, 'tool_result', '6 images', null, 'tool_result ×6');
              for (var t = 0; t < 6; t++) thumb(ctx, g, 930 + t * 52, g.y - 13, 40 + t);
            }, { results: 10200 }, 'tool_use');
          }).then(function () {
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
        say: 'How the model reasons inside this loop has a few well studied shapes. ReAct interleaves a short thought, an action and an observation. Plan and execute writes a full plan first, then works through it, replanning only when something breaks. Reflection adds a self critique after a failed attempt and stores the lesson for the next try. Modern reasoning models add extended thinking, a private scratchpad before answering, and with interleaved thinking they reason between tool calls too, digesting each result before acting again.',
        deep: '<ul><li><b>ReAct</b> (Yao et al., 2023): trajectories of (thought, action, observation)*. Grounding reasoning in observations reduces hallucination compared with chain-of-thought alone.</li>' +
          '<li><b>Plan-and-execute / Plan-and-Solve</b>: a strong model plans once, cheaper models execute steps; fewer expensive calls, but brittle when the plan is wrong, so add a replan trigger.</li>' +
          '<li><b>Reflexion</b> (Shinn et al., 2023): after a failure the agent writes a verbal reflection into episodic memory and retries; gains come without any weight update.</li>' +
          '<li><b>Extended thinking</b>: RL-trained long chains of thought in dedicated <code>thinking</code> blocks with a budget (e.g. <code>budget_tokens: 4000</code>). <b>Interleaved thinking</b> allows thinking after each <code>tool_result</code>. Thinking blocks must be returned unmodified within the tool loop (they carry a signature).</li></ul>' +
          '<div class="eq">accuracy ≈ a + b · log(thinking tokens) over a wide range (reported for o1-style reasoning models)</div>' +
          '<p class="muted">Trade-off: thinking tokens are output tokens: billed at output price, they add decode latency and they consume the context budget.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.R, 350);
          setStation(ctx, S, -1);
          var R = S.R = ctx.group();
          ctx.rect(690, 170, 870, 450, { rx: 10, fill: 'rgba(6,12,24,0.92)', stroke: ctx.alpha('violet', 0.45), parent: R });
          ctx.text(706, 188, 'REASONING PATTERNS · token timelines', { size: 12, font: 'mono', weight: 600, color: 'violet', parent: R, spacing: 1 });
          var lk = [['think', 'violet'], ['act', 'magenta'], ['observe', 'orange'], ['plan', 'cyan'], ['critique', 'pink'], ['answer', 'amber']];
          lk.forEach(function (k, i) {
            ctx.rect(1086 + i * 78, 182, 11, 11, { rx: 2, fill: ctx.alpha(k[1], 0.7), parent: R });
            ctx.text(1101 + i * 78, 188, k[0], { size: 11, font: 'mono', color: 'text', parent: R });
          });
          var K = { T: ['violet', 26], A: ['magenta', 22], O: ['orange', 38], P: ['cyan', 120], p: ['cyan', 40], C: ['pink', 40], X: ['red', 22], V: ['lime', 22], F: ['amber', 44], t: ['violet', 70] };
          var lanes = [
            ['ReAct', 'thought → action → observation, repeated', 'TAOTAOTAOTF'],
            ['Plan-and-execute', 'plan once, execute, replan on failure', 'PAOAOAOpAOF'],
            ['Reflection', 'attempt, evaluate, reflect, retry with lesson', 'TAOAOXCTAOAOVF'],
            ['Interleaved thinking', 'think between every tool call (signed blocks)', 'tAOtAOtAOtF']
          ];
          S.laneBlocks = [];
          var all = [];
          lanes.forEach(function (ln, i) {
            var y = 250 + i * 98;
            ctx.text(712, y - 24, ln[0], { size: 15, font: 'display', weight: 700, color: 'white', parent: R });
            ctx.text(1544, y - 24, ln[1], { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: R });
            ctx.line(712, y + 14, 1544, y + 14, { color: 'line', sw: 1, parent: R });
            var x = 712;
            ln[2].split('').forEach(function (c, j) {
              var k = K[c];
              var b = ctx.rect(x, y - 2, k[1], 26, { rx: 4, fill: ctx.alpha(k[0], c === 'O' ? 0.3 : 0.6), stroke: k[0], sw: 1, parent: R });
              if (c === 'X') ctx.text(x + 11, y + 11, '✗', { size: 13, color: 'white', anchor: 'middle', parent: R });
              if (c === 'V') ctx.text(x + 11, y + 11, '✓', { size: 13, color: '#05080f', anchor: 'middle', parent: R });
              if (c === 'P') ctx.text(x + 60, y + 11, 'plan: 6 shots', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: R });
              if (c === 'C') ctx.text(x + 20, y + 11, 'note', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: R });
              all.push(ctx.reveal(b, { from: 'left', delay: 300 + j * 150 + i * 60, dur: 250, dist: 8 }));
              x += k[1] + 4;
            });
          });
          ctx.reveal(R, { from: 'right', dur: 400 });
          /* sampling station = where reasoning tokens are produced */
          return ctx.wait(300).then(function () {
            setStation(ctx, S, 1);
            ctx.pulse(S.st[1], { color: 'violet', times: 2, dur: 800 });
            return Promise.all(all);
          }).then(function () { return ctx.wait(800); });
        }
      },
      /* 6 ---------------------------------------------------------------- */
      {
        title: 'Context as budget',
        say: 'Treat the context window as a budget that the loop spends. Every tool result, every image and every thought is appended, and long tasks fill two hundred thousand tokens surprisingly fast. Models also get worse as the window fills, so waiting until it is full is a mistake. Good harnesses act early: keep the stable prefix cached, clear old tool outputs that can be fetched again by reference, compact the history into a summary when usage crosses a threshold, and keep durable notes in files outside the window.',
        deep: '<table><tr><th>Technique</th><th>Mechanism</th><th>Cost</th></tr>' +
          '<tr><td>Prompt caching</td><td>reuse the KV of an identical prefix; cached reads ≈ 0.1× price, lower time-to-first-token</td><td>any prefix change invalidates everything after it</td></tr>' +
          '<tr><td>Tool-result clearing</td><td>replace stale results with stubs + URIs (e.g. context editing)</td><td>re-fetch if needed again</td></tr>' +
          '<tr><td>Compaction</td><td>at ~80%: summarise into decisions, open TODOs, artifact URIs; continue with summary + recent turns</td><td>lossy; summary quality is critical</td></tr>' +
          '<tr><td>External memory</td><td>NOTES.md / memory-tool files, read just-in-time</td><td>needs retrieval discipline</td></tr>' +
          '<tr><td>Sub-agents</td><td>explore in a fresh window, return a 1–2k summary</td><td>coordination overhead</td></tr></table>' +
          '<div class="eq">input tokens at turn k = P + Σ<sub>i&lt;k</sub>(a<sub>i</sub> + o<sub>i</sub>) &nbsp;⇒&nbsp; Σ<sub>k≤K</sub> = O(K²) prefill without caching</div>' +
          '<p>Here a long-running editor-style loop reaches 161k tokens by turn 28; clearing and compaction bring it back to ~20k while the cached 5.5k prefix survives untouched.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.R, 350);
          var R = S.R = ctx.group();
          var cA = card(ctx, R, 700, 172, 420, 220, 'cyan', 'Prompt caching');
          ctx.para(716, 222, ['stable prefix: tools + system (5.5k)', 'turn 2+: cache read ≈ 0.1× input price', 'cache write ≈ 1.25×, TTL 5 min'], { size: 12, font: 'mono', color: 'text', lh: 19, parent: cA });
          ctx.text(716, 302, 'prefix cost over 30 turns', { size: 11, font: 'mono', color: 'dim', parent: cA });
          ctx.rect(716, 316, 260, 18, { rx: 3, fill: ctx.alpha('red', 0.5), parent: cA });
          ctx.text(984, 325, '$0.50 uncached', { size: 11, font: 'mono', color: 'red', parent: cA });
          S.cacheBar = ctx.rect(716, 344, 0, 18, { rx: 3, fill: ctx.alpha('cyan', 0.7), parent: cA });
          ctx.text(984, 353, '$0.07 cached', { size: 11, font: 'mono', color: 'cyan', parent: cA });
          var cB = card(ctx, R, 1140, 172, 420, 220, 'orange', 'Clear stale tool results');
          ctx.para(1156, 222, ['results older than N turns become', 'stubs that keep the artifact URI', 're-fetch on demand if needed'], { size: 12, font: 'mono', color: 'text', lh: 19, parent: cB });
          S.stubs = [];
          for (var i = 0; i < 7; i++) S.stubs.push(ctx.rect(1156 + i * 54, 316, 48, 44, { rx: 4, fill: ctx.alpha('orange', 0.45), stroke: 'orange', sw: 1, parent: cB }));
          S.stubT = ctx.text(1156, 366, '131k → 5k: stubs keep artifact://… URIs', { size: 12, font: 'mono', color: 'orange', parent: cB, opacity: 0 });
          var cC = card(ctx, R, 700, 404, 420, 216, 'white', 'Compaction');
          ctx.para(716, 454, ['trigger at 80% of the window', 'summary keeps: decisions, open TODOs,', 'artifact URIs, user constraints'], { size: 12, font: 'mono', color: 'text', lh: 19, parent: cC });
          S.hist = [];
          for (var j = 0; j < 8; j++) S.hist.push(ctx.rect(716 + j * 46, 550, 40, 40, { rx: 4, fill: ctx.alpha(j % 2 ? 'amber' : 'violet', 0.5), stroke: j % 2 ? 'amber' : 'violet', sw: 1, parent: cC }));
          S.summ = ctx.rect(716, 550, 0, 40, { rx: 4, fill: ctx.alpha('white', 0.8), parent: cC });
          var cD = card(ctx, R, 1140, 404, 420, 216, 'teal', 'External memory');
          ctx.para(1156, 454, ['NOTES.md / memory tool outside the window', 'write facts once, read just-in-time', 'survives compaction and restarts'], { size: 12, font: 'mono', color: 'text', lh: 19, parent: cD });
          ctx.icon('doc', 1180, 568, 40, 'teal', { parent: cD });
          S.notes = ctx.code({ x: 1214, y: 526, w: 330, h: 84, title: 'NOTES.md', lang: 'text', size: 11, color: 'teal', typing: true, lines: ['- fox: orange fur, white visor (7c1e)', '- shot 3 v2 approved; seed 1234'], parent: cD });
          S.cards = [cA, cB, cC, cD];
          ctx.reveal(S.cards, { from: 'up', stagger: 120 });
          ctx.focus([S.R, S.gBar, S.gLoop], 0.2);
          S.gLoop.setAttribute('opacity', 0.45);
          S.gLoop.setAttribute('data-op', 0.45);
          ctx.hud('long-running loop · context pressure');
          return ctx.wait(700).then(function () {
            ctx.highlight(cA, { color: 'cyan', pad: 4, parent: R });
            ctx.pulse(S.cacheL, { color: 'cyan', times: 2, dur: 600 });
            return ctx.animate(S.cacheBar, { width: [0, 36] }, 700, 'out');
          }).then(function () {
            return Promise.all([
              ctx.counter(S.iterTxt, 3, 28, 2800),
              setCtx(ctx, S, { results: 131000, asst: 12300, thinking: 8000 }, 2800)
            ]);
          }).then(function () {
            ctx.pulse(S.thr, { color: 'red', times: 2, dur: 500 });
            ctx.hud('161k / 200k · compaction triggered');
            S.stopL.lastChild.textContent = 'harness: compact()';
            ctx.highlight(cB, { color: 'orange', pad: 4, parent: R });
            ctx.highlight(cC, { color: 'white', pad: 4, parent: R });
            var sh = S.stubs.map(function (s, i) { return ctx.animate(s, { height: [44, 10], y: [316, 333] }, 700, 'inOut', i * 60); });
            var hs = S.hist.map(function (h) { return ctx.fade(h, 0.08, 700); });
            hs.push(ctx.reveal(S.stubT, { delay: 500, opacity: 1 }));
            return Promise.all(sh.concat(hs).concat([ctx.animate(S.summ, { width: [0, 70] }, 800, 'out', 300), setCtx(ctx, S, { results: 5000, asst: 0, thinking: 0, summary: 3500, memory: 5200 }, 1300)]));
          }).then(function () {
            ctx.highlight(cD, { color: 'teal', pad: 4, parent: R });
            ctx.hud('19.5k / 200k after compaction');
            return S.notes.typeAll();
          }).then(function () { return ctx.wait(600); });
        }
      },
      /* 7 ---------------------------------------------------------------- */
      {
        title: 'Why it works',
        say: 'Why does any of this work? Because the model was trained for it. After pretraining on next token prediction, labs fine-tune on demonstrations of multi-step tool use, then run reinforcement learning in sandboxed environments. The model attempts the same task several times, each attempt is scored by a verifier, like a schema check, a unit test or a critic, and attempts that beat the group average are reinforced. Tool outputs are masked out of the loss, so the model learns to act and reason, not to predict the environment.',
        deep: '<p>Pipeline: pretraining → SFT on curated or synthetic tool trajectories (ToolLLM / APIGen-style data) → RL with verifiable rewards in multi-turn environments.</p>' +
          '<p><b>GRPO</b> (Shao et al., 2024) samples G rollouts per prompt and uses the group as its baseline, removing the value network:</p>' +
          '<div class="eq">Â<sub>i</sub> = (r<sub>i</sub> − mean(r)) / std(r)</div>' +
          '<div class="eq">J(θ) = E[ (1/G) Σ<sub>i</sub> (1/|o<sub>i</sub>|) Σ<sub>t</sub> min(ρ<sub>i,t</sub>Â<sub>i</sub>, clip(ρ<sub>i,t</sub>, 1−ε, 1+ε)Â<sub>i</sub>) ] − β·KL(π<sub>θ</sub> ‖ π<sub>ref</sub>)</div>' +
          '<p>with ρ<sub>i,t</sub> = π<sub>θ</sub>(o<sub>i,t</sub> | ·) / π<sub>old</sub>(o<sub>i,t</sub> | ·). In agentic RL the sum over t covers only <b>policy tokens</b>; tool-result tokens are masked. In the figure r = (1, 0, 1, 1, 0, 0.5) → Â ≈ (0.93, −1.30, 0.93, 0.93, −1.30, −0.19).</p>' +
          '<ul><li>Rewards: task success (tests pass, schema valid, critic ≥ τ), optionally minus cost or turn penalties.</li>' +
          '<li>2025 variants: DAPO (decoupled clip-higher, dynamic sampling, token-level loss, no KL) and Dr. GRPO (drops the 1/|o<sub>i</sub>| and std normalisations, which bias toward long wrong answers).</li>' +
          '<li>Hard parts: reward hacking of the verifier, credit assignment over 50+ turns, flaky environments, and keeping rollouts cheap enough to run millions of them.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.R, 350);
          S.gLoop.setAttribute('data-op', 1);
          ctx.focus(null);
          S.iterTxt.textContent = '—';
          S.stopL.lastChild.textContent = 'RL: G = 6 rollouts';
          var R = S.R = ctx.group();
          ctx.rect(690, 170, 870, 450, { rx: 10, fill: 'rgba(6,12,24,0.94)', stroke: ctx.alpha('lime', 0.45), parent: R });
          ctx.text(706, 190, 'POST-TRAINING ON AGENT TRAJECTORIES', { size: 12, font: 'mono', weight: 600, color: 'lime', parent: R, spacing: 1 });
          var stages = [['pretrain · next token', 'cyan', 815], ['SFT · tool trajectories', 'amber', 1060], ['RL · verifiable rewards', 'magenta', 1320]];
          stages.forEach(function (s, i) {
            ctx.label(s[2], 222, s[0], { color: s[1], size: 12, parent: R });
            if (i < 2) ctx.line(s[2] + 90, 222, stages[i + 1][2] - 92, 222, { color: 'dim', arrow: true, parent: R });
          });
          ctx.text(745, 262, 'G = 6 rollouts of the same task', { size: 11, font: 'mono', color: 'dim', parent: R });
          ctx.text(1300, 262, 'reward', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: R });
          ctx.text(1450, 262, 'advantage Â', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: R });
          ctx.line(1450, 274, 1450, 520, { color: 'faint', parent: R });
          var rw = [1, 0, 1, 1, 0, 0.5], adv = [0.93, -1.30, 0.93, 0.93, -1.30, -0.19];
          var rn = ctx.rng(5);
          var anims = [];
          rw.forEach(function (rv, i) {
            var y = 292 + i * 42;
            ctx.text(712, y, 'o' + (i + 1), { size: 12, font: 'mono', color: 'text', parent: R });
            var x = 745, n = 3 + Math.floor(rn() * 3);
            var blocks = ctx.group({ parent: R });
            for (var s = 0; s < n && x < 1090; s++) {
              var tw = 18 + rn() * 26, aw = 14 + rn() * 10, ow = 22 + rn() * 30;
              ctx.rect(x, y - 10, tw, 20, { rx: 3, fill: ctx.alpha('violet', 0.6), parent: blocks }); x += tw + 2;
              ctx.rect(x, y - 10, aw, 20, { rx: 3, fill: ctx.alpha('magenta', 0.7), parent: blocks }); x += aw + 2;
              ctx.rect(x, y - 10, ow, 20, { rx: 3, fill: ctx.alpha('orange', 0.12), stroke: ctx.alpha('orange', 0.7), dash: '2 2', sw: 1, parent: blocks }); x += ow + 2;
            }
            ctx.rect(x, y - 10, 30, 20, { rx: 3, fill: ctx.alpha('amber', 0.7), parent: blocks });
            anims.push(ctx.reveal(blocks, { from: 'left', delay: 300 + i * 150, dur: 400 }));
            var rc = rv === 1 ? 'lime' : (rv === 0 ? 'red' : 'amber');
            var chip = ctx.label(1300, y, 'r = ' + rv, { color: rc, size: 12, w: 70, parent: R });
            anims.push(ctx.reveal(chip, { delay: 1300 + i * 100 }));
            var bw = Math.abs(adv[i]) * 70;
            var bar = ctx.rect(adv[i] >= 0 ? 1450 : 1450 - bw, y - 8, bw, 16, { rx: 3, fill: adv[i] >= 0 ? ctx.alpha('lime', 0.7) : ctx.alpha('red', 0.7), parent: R });
            anims.push(ctx.reveal(bar, { from: adv[i] >= 0 ? 'left' : 'right', delay: 2000 + i * 100, dur: 400, dist: 10 }));
            var vt = ctx.text(adv[i] >= 0 ? 1450 - 6 : 1450 + 6, y, (adv[i] > 0 ? '+' : '') + adv[i].toFixed(2), { size: 11, font: 'mono', color: 'white', anchor: adv[i] >= 0 ? 'end' : 'start', parent: R });
            anims.push(ctx.reveal(vt, { delay: 2100 + i * 100 }));
          });
          var lgd = ctx.group({ parent: R });
          ctx.rect(712, 530, 18, 14, { rx: 3, fill: ctx.alpha('violet', 0.6), parent: lgd });
          ctx.rect(732, 530, 14, 14, { rx: 3, fill: ctx.alpha('magenta', 0.7), parent: lgd });
          ctx.text(754, 537, 'policy tokens: trained', { size: 12, font: 'mono', color: 'text', parent: lgd });
          ctx.rect(960, 530, 30, 14, { rx: 3, fill: ctx.alpha('orange', 0.12), stroke: ctx.alpha('orange', 0.7), dash: '2 2', sw: 1, parent: lgd });
          ctx.text(998, 537, 'tool outputs: masked (no gradient)', { size: 12, font: 'mono', color: 'text', parent: lgd });
          ctx.text(712, 570, 'Âᵢ = (rᵢ − mean r) / std r    θ ← θ + η ∇θ J_GRPO(θ)', { size: 15, font: 'mono', color: 'white', parent: lgd });
          ctx.text(712, 598, 'reward = schema valid ∧ critic ≥ τ ∧ within budget', { size: 12, font: 'mono', color: 'lime', parent: lgd });
          ctx.reveal(R, { from: 'right', dur: 400 });
          ctx.reveal(lgd, { delay: 2600 });
          return Promise.all(anims).then(function () {
            setStation(ctx, S, 1);
            return ctx.pulse(S.st[1], { color: 'lime', times: 2, dur: 700 });
          });
        }
      },
      /* 8 ---------------------------------------------------------------- */
      {
        title: 'Failure modes',
        say: 'Agents fail in characteristic ways. They get stuck in loops, calling the same tool with the same arguments. They hallucinate arguments that do not fit the schema, or refer to files that do not exist. As the context grows, their attention to earlier details degrades, which researchers call context rot. And a small early mistake, like the wrong fur color, silently cascades through every later step. The mitigations are engineering: turn caps and duplicate detection, strict schemas with informative errors, compaction and fresh sub agents, and verifiers at checkpoints.',
        deep: '<table><tr><th>Failure</th><th>Signal</th><th>Mitigation</th></tr>' +
          '<tr><td>Loops</td><td>same (tool, hash(args)) ≥ 3×; no new artifact in k turns</td><td>dedupe, max_turns, inject a “you are repeating” observation, escalate</td></tr>' +
          '<tr><td>Hallucinated args</td><td>schema or semantic validation fails; unknown URIs</td><td>strict schemas via constrained decoding; <code>is_error</code> results with actionable text; enums/IDs instead of free text</td></tr>' +
          '<tr><td>Context rot</td><td>accuracy falls with input length even on easy tasks (Chroma 2025); “lost in the middle” (Liu et al.)</td><td>compaction, just-in-time retrieval, sub-agents with clean windows</td></tr>' +
          '<tr><td>Error cascades</td><td>downstream critic failures trace back to one early artifact</td><td>verifiers at checkpoints, provenance links, roll back to the last good artifact</td></tr></table>' +
          '<p>Compounding: with per-step error ε, P(success over n steps) ≈ (1 − ε)<sup>n</sup>. A verifier that catches a fraction c of errors (and retries) lowers the effective rate to ε(1 − c): ε = 0.05, n = 20 gives 0.36; with c = 0.8 it gives 0.82.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.R, 350);
          setStation(ctx, S, -1);
          var R = S.R = ctx.group();
          /* A: loops */
          var A = card(ctx, R, 700, 172, 420, 224, 'amber', 'Loops & repetition');
          S.loopCalls = [0, 1, 2].map(function (i) {
            return ctx.label(716, 228 + i * 34, 'search_assets("fox sheet")', { color: i < 2 ? 'amber' : 'red', size: 12, anchor: 'start', parent: A });
          });
          S.loopCnt = ctx.text(1100, 250, '×1', { size: 26, font: 'mono', weight: 700, color: 'amber', anchor: 'end', parent: A });
          S.loopStop = ctx.label(1030, 318, 'loop detector: STOP', { color: 'red', size: 12, parent: A });
          ctx.text(716, 376, '✓ dedupe (tool, args), max_turns, escalate', { size: 12, font: 'mono', color: 'lime', parent: A });
          /* B: hallucinated args */
          var B = card(ctx, R, 1140, 172, 420, 224, 'magenta', 'Hallucinated arguments');
          ctx.text(1156, 214, 'generate_video({"shot": 3,', { size: 12, font: 'mono', color: 'text', parent: B });
          S.badArg = ctx.text(1172, 234, '"duration_s": 12,', { size: 12, font: 'mono', color: 'red', parent: B });
          ctx.text(1172, 254, '"ref": "fox_sheet_v9.png"})', { size: 12, font: 'mono', color: 'red', parent: B });
          ctx.text(1544, 234, 'schema: ≤ 10', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B });
          ctx.text(1544, 254, 'no such artifact', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B });
          S.errChip = ctx.label(1156, 292, 'tool_result is_error: "duration_s must be ≤ 10"', { color: 'red', size: 11, anchor: 'start', parent: B });
          S.fixChip = ctx.label(1156, 326, 'retry: duration_s 8 · ref fox_sheet@7c1e ✓', { color: 'lime', size: 11, anchor: 'start', parent: B });
          ctx.text(1156, 376, '✓ strict schemas, IDs not free text', { size: 12, font: 'mono', color: 'lime', parent: B });
          /* C: context rot */
          var Cc = card(ctx, R, 700, 410, 420, 210, 'violet', 'Context rot');
          S.rot = ctx.plot(760, 468, 320, 98, function (x) { return 0.93 - 0.3 * Math.pow(x / 200, 1.3); }, { xDomain: [0, 200], yDomain: [0.5, 1], color: 'violet', xLabel: 'context tokens (k)', yLabel: 'accuracy', parent: Cc });
          var p0 = S.rot.toPx(0, 0.93);
          S.rotDot = ctx.circle(p0.x, p0.y, 5, { fill: 'violet', glow: true, parent: Cc });
          ctx.text(1100, 432, 'illustrative', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: Cc });
          ctx.text(716, 604, '✓ compaction, sub-agents with fresh windows', { size: 12, font: 'mono', color: 'lime', parent: Cc });
          /* D: cascades */
          var D = card(ctx, R, 1140, 410, 420, 210, 'red', 'Error cascades');
          var chain = ['fur: grey', 'script', 'board', 'shots ×6'];
          S.casc = chain.map(function (c, i) {
            return ctx.node({ x: 1206 + i * 100, y: 474, w: 90, h: 34, title: c, titleSize: 12, color: i === 0 ? 'red' : 'faint', glow: false, parent: D });
          });
          for (var i = 0; i < 3; i++) ctx.line(1251 + i * 100, 474, 1259 + i * 100, 474, { color: 'dim', arrow: true, parent: D });
          S.verif = ctx.label(1160, 530, '▲ verifier: fur ≠ character sheet → roll back', { color: 'lime', size: 11, anchor: 'start', parent: D });
          ctx.text(1156, 604, '✓ checkpoints + provenance rollback', { size: 12, font: 'mono', color: 'lime', parent: D });
          [S.loopCalls[1], S.loopCalls[2], S.loopStop, S.errChip, S.fixChip, S.verif].forEach(function (e) { e.setAttribute('opacity', 0); });
          ctx.reveal([A, B, Cc, D], { from: 'up', stagger: 120 });
          return ctx.wait(700).then(function () {
            var a = ctx.reveal(S.loopCalls[1], { from: 'down', delay: 200 }).then(function () {
              S.loopCnt.textContent = '×2';
              return ctx.reveal(S.loopCalls[2], { from: 'down', delay: 400 });
            }).then(function () {
              S.loopCnt.textContent = '×3';
              S.loopCnt.setAttribute('fill', ctx.C.red);
              return ctx.reveal(S.loopStop, { from: 'scale' });
            });
            var b = ctx.pulse(S.badArg, { color: 'red', dur: 600 }).then(function () {
              return ctx.reveal(S.errChip, { from: 'left' });
            }).then(function () { return ctx.reveal(S.fixChip, { from: 'left', delay: 300 }); });
            var c = ctx.tween(2200, function (e) {
              var xv = e * 190, p = S.rot.toPx(xv, 0.93 - 0.3 * Math.pow(xv / 200, 1.3));
              S.rotDot.setAttribute('cx', p.x); S.rotDot.setAttribute('cy', p.y);
            }, 'inOut');
            var d = S.casc.slice(1).reduce(function (p, n) {
              return p.then(function () {
                n.body.setAttribute('stroke', ctx.C.red);
                return ctx.pulse(n, { color: 'red', dur: 400 });
              });
            }, ctx.wait(300)).then(function () {
              return ctx.reveal(S.verif, { from: 'up' });
            }).then(function () {
              S.casc.forEach(function (n) { n.body.setAttribute('stroke', ctx.C.lime); });
              S.casc[0].titleEl.textContent = 'fur: orange';
            });
            return Promise.all([a, b, c, d]);
          }).then(function () { return ctx.wait(600); });
        }
      },
      /* 9 ---------------------------------------------------------------- */
      {
        title: 'The whole harness',
        say: 'Put together, an agent is a small program around a large model. It assembles a context, samples, parses, acts through tools, appends observations, and checks its budget and stop conditions every turn, while managing the context window the way an operating system manages memory. The model supplies judgment; the harness supplies structure, safety and persistence. In our trailer, dozens of these loops run at once, one per task, each a leaf in the orchestrator\'s graph.',
        deep: '<p>Design checklist for a production agent harness:</p>' +
          '<ul><li><b>Stable prefix</b>: version system prompts and tool schemas; keep volatile data after the cache breakpoint.</li>' +
          '<li><b>Few, orthogonal tools</b> with precise descriptions; errors that tell the model how to fix the call.</li>' +
          '<li><b>Hard budgets enforced by code</b>: turns, tokens, wall-clock, dollars; the model is told its budget but never trusted to enforce it.</li>' +
          '<li><b>Context policy</b>: clearing, compaction threshold, external notes, sub-agents for exploration.</li>' +
          '<li><b>Observability</b>: one trace span per turn and per tool call, with token usage, cache hit rate and latency.</li>' +
          '<li><b>Evals</b>: trajectory-level success rate, turns and cost per task, a regression suite of hard cases; replay traces to test prompt changes.</li></ul>' +
          '<div class="note">An LLM call is a function; an agent is a process. Treat it with the same tools you use for processes: supervision, limits, logs and restarts.</div>',
        run: function (ctx) {
          var S = ctx.state;
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
          keepWS(code);
          S.hl = ctx.rect(694, 0, 862, 18, { rx: 3, fill: ctx.alpha('magenta', 0.18), stroke: ctx.alpha('magenta', 0.6), sw: 1, parent: R });
          S.hl.setAttribute('opacity', 0);
          var tail = ctx.group({ parent: R });
          [['model: judgment', 'amber', 800], ['harness: structure · safety · persistence', 'magenta', 1100], ['one loop per DAG leaf', 'lime', 1420]].forEach(function (c) {
            ctx.label(c[2], 560, c[0], { color: c[1], size: 12, parent: tail });
          });
          ctx.text(1125, 608, 'the context window is managed like memory in an operating system', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: tail });
          ctx.reveal(R, { from: 'right', dur: 400 });
          ctx.reveal(tail, { delay: 600 });
          S.iterTxt.textContent = '∞';
          S.stopL.lastChild.textContent = 'stop_reason: per turn';
          var lineY = function (i) { return 170 + 46 + i * 18.6 - 9; };
          var map = [[0, [1, 2, 4]], [1, [5, 6]], [2, [7, 8, 9, 10]], [3, [11]], [4, [12, 13]]];
          var seq = ctx.wait(700);
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
          return seq.then(function () { S.hl.setAttribute('opacity', 0); S.dot.setAttribute('opacity', 0); setStation(ctx, S, 0); return ctx.wait(400); });
        }
      }
    ]
  });
})();
