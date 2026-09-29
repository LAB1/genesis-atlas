/* L1 — AI Orchestration Plane. Planner writes a task DAG; a durable engine, queue and agent workers execute it
 * with events, a human checkpoint, critic-driven replanning and budget accounting. */
(function () {
  var DX = { refs: 355, script: 500, board: 645, gate: 775, shot: 910, edit: 1080, critic: 1235 };
  var CY = 385;
  var SHOT_Y = [245, 301, 357, 413, 469, 525];
  var CAPS = [400000, 7200, 10];
  var TOK_RATE = 2.8e-6;           /* blended $/token: 212k tok -> $0.59 (see step 8) */
  var GPU_RATE = 2.5 / 3600;       /* $/GPU-second at $2.50 per H100-hour */

  function stCol(ctx, st) {
    return { pending: ctx.C.faint, run: ctx.C.magenta, done: ctx.C.lime, fail: ctx.C.red, wait: ctx.C.cyan, old: '#5a3a4c' }[st];
  }

  /* DAG task node: status stroke, status dot, progress bar */
  function dagNode(ctx, parent, x, y, title, sub, o) {
    o = o || {};
    var w = o.w || 116;
    var n = ctx.node({ x: x, y: y, w: w, h: 44, title: title, sub: sub, color: 'faint', kind: o.kind || 'box', titleSize: 13, subSize: 11, glow: false, parent: parent });
    n.ticks = Array.prototype.slice.call(n.querySelectorAll('path')).filter(function (p) { return p !== n.body; });
    if (n.subEl) n.subEl.setAttribute('fill', ctx.C.dim);
    var inset = o.kind === 'hex' ? 24 : 8;
    n.dot = ctx.circle(n.box.r - (o.kind === 'hex' ? 22 : 9), n.box.t + 9, 3.5, { fill: ctx.C.faint, parent: n });
    ctx.rect(n.box.l + inset, n.box.b - 6, w - 2 * inset, 3, { rx: 1.5, fill: 'rgba(255,255,255,0.07)', parent: n });
    n.bar = ctx.rect(n.box.l + inset, n.box.b - 6, 0, 3, { rx: 1.5, fill: ctx.C.magenta, parent: n });
    n.barW = w - 2 * inset;
    return n;
  }

  function setSt(ctx, n, st) {
    var c = stCol(ctx, st);
    n.body.setAttribute('stroke', c);
    n.ticks.forEach(function (p) { p.setAttribute('stroke', c); });
    n.dot.setAttribute('fill', c);
    if (st === 'run' || st === 'fail' || st === 'wait') n.body.setAttribute('filter', 'url(#fx-glow)');
    else n.body.removeAttribute('filter');
    if (n.titleEl) n.titleEl.setAttribute('opacity', st === 'old' ? 0.45 : 1);
    n.st = st;
  }

  function runTask(ctx, n, ms, delay) {
    return ctx.wait(delay || 0).then(function () {
      setSt(ctx, n, 'run');
      n.bar.setAttribute('fill', ctx.C.magenta);
      return ctx.animate(n.bar, { width: [0, n.barW] }, ms, 'inOut');
    }).then(function () {
      setSt(ctx, n, 'done');
      n.bar.setAttribute('fill', ctx.C.lime);
    });
  }

  /* custom component box (no auto title), used for runtime row */
  function comp(ctx, parent, cx, cy, w, h, color, icon, title, sub) {
    var n = ctx.node({ x: cx, y: cy, w: w, h: h, color: color, kind: 'box', parent: parent });
    var x0 = cx - w / 2, y0 = cy - h / 2;
    ctx.icon(icon, x0 + 24, y0 + 24, 22, color, { parent: n });
    n.titleEl = ctx.text(x0 + 44, y0 + 18, title, { size: 15, weight: 600, font: 'display', color: 'white', parent: n });
    ctx.text(x0 + 44, y0 + 36, sub, { size: 11, font: 'mono', color: ctx.alpha(color, 0.9), parent: n });
    return n;
  }

  /* ---------- budget panel ---------- */
  function fmtK(v) { return Math.round(v / 1000) + 'k'; }
  function fmtI(v) { return Math.round(v).toLocaleString('en-US'); }
  function fmtD(v) { return '$' + v.toFixed(2); }

  function drawBudget(ctx, S) {
    var B = S.bud;
    var usd = B.tok * TOK_RATE + B.gpu * GPU_RATE;
    var vals = [B.tok, B.gpu, usd];
    var res = [0, B.res, B.res * GPU_RATE];
    var fm = [fmtK, fmtI, fmtD];
    var capS = ['400k', '7,200', '$10'];
    S.meters.forEach(function (m, i) {
      var fw = 135 * Math.min(1, vals[i] / CAPS[i]);
      var rw = Math.min(135 - fw, 135 * res[i] / CAPS[i]);
      m.fill.setAttribute('width', Math.max(0, fw));
      m.res.setAttribute('x', 1420 + fw);
      m.res.setAttribute('width', Math.max(0, rw));
      m.val.textContent = fm[i](vals[i]) + ' / ' + capS[i];
    });
  }

  function setBudget(ctx, S, t, ms) {
    var B = S.bud;
    var f = { tok: B.tok, gpu: B.gpu, res: B.res };
    var to = { tok: t.tok === undefined ? B.tok : t.tok, gpu: t.gpu === undefined ? B.gpu : t.gpu, res: t.res === undefined ? B.res : t.res };
    return ctx.tween(ms || 800, function (e) {
      B.tok = f.tok + (to.tok - f.tok) * e;
      B.gpu = f.gpu + (to.gpu - f.gpu) * e;
      B.res = f.res + (to.res - f.res) * e;
      drawBudget(ctx, S);
    }, 'out');
  }

  function ledger(ctx, S, str, color) {
    if (S.ledger.length >= 4) { var old = S.ledger.shift(); if (old.parentNode) old.parentNode.removeChild(old); }
    var t = ctx.text(1420, 0, str, { size: 11, font: 'mono', color: color || 'text', parent: S.gBud });
    S.ledger.push(t);
    S.ledger.forEach(function (e, i) { e.setAttribute('y', 490 + i * 22); e.setAttribute('opacity', 0.5 + 0.5 * (i + 1) / S.ledger.length); });
  }

  /* ---------- runtime helpers ---------- */
  function setQ(ctx, S, k) {
    S.qn = Math.max(0, Math.min(8, k));
    S.qslots.forEach(function (r, i) {
      r.setAttribute('fill', i < S.qn ? ctx.alpha('magenta', 0.55) : 'rgba(255,255,255,0.04)');
      r.setAttribute('stroke', i < S.qn ? ctx.C.magenta : ctx.C.faint);
    });
  }

  function setW(ctx, S, i, label) {
    var w = S.wslots[i];
    w.txt.textContent = label || 'idle';
    w.txt.setAttribute('fill', label ? ctx.C.white : ctx.C.dim);
    w.rect.setAttribute('stroke', label ? ctx.C.magenta : ctx.C.faint);
    w.rect.setAttribute('fill', label ? ctx.alpha('magenta', 0.18) : 'rgba(255,255,255,0.03)');
  }

  function setEng(S, str) { S.engState.textContent = str; }

  /* an event chip travelling along the bus to a consumer */
  function busEvent(ctx, S, x0, x1, str, color) {
    if (ctx.instant) return Promise.resolve();
    var g = ctx.group({ parent: S.gBus });
    ctx.label(0, 0, str, { color: color || 'teal', size: 11, parent: g });
    ctx.place(g, x0, 752);
    return ctx.transform(g, { x: x1 }, Math.abs(x1 - x0) * 1.6 + 200, 'inOut').then(function () { return ctx.remove(g, 250); });
  }

  /* dispatch one DAG task through engine -> queue -> worker -> tools -> fleet */
  function dispatch(ctx, S, n, slot, label, ms, delay) {
    return ctx.wait(delay || 0).then(function () {
      setQ(ctx, S, S.qn + 1);
      return ctx.packet(S.lEQ, { color: 'magenta', dur: 350, label: label });
    }).then(function () {
      setQ(ctx, S, S.qn - 1);
      setW(ctx, S, slot, label);
      return ctx.packet(S.lQW, { color: 'magenta', dur: 350 });
    }).then(function () {
      return Promise.all([
        runTask(ctx, n, ms),
        ctx.packet(S.lWT, { color: 'amber', dur: 300 }).then(function () { return ctx.packet(S.lTF, { color: 'red', dur: 300 }); })
      ]);
    }).then(function () {
      setW(ctx, S, slot, '');
      return busEvent(ctx, S, 760, 200, 'done:' + label, 'teal');
    });
  }

  Atlas.register({
    id: 'orchestration',
    refs: [
      'Anthropic, <i>Building Effective Agents</i> (workflows vs agents), 2024',
      'Kim et al., <i>An LLM Compiler for Parallel Function Calling</i> (LLMCompiler), ICML 2024',
      'Shen et al., <i>HuggingGPT: Solving AI Tasks with ChatGPT and its Friends in Hugging Face</i>, NeurIPS 2023',
      'Madaan et al., <i>Self-Refine: Iterative Refinement with Self-Feedback</i>, NeurIPS 2023',
      'Anthropic, <i>How we built our multi-agent research system</i>, 2025',
      'Kreps, Narkhede &amp; Rao, <i>Kafka: a Distributed Messaging System for Log Processing</i>, NetDB 2011',
      'Temporal Technologies, <i>Temporal durable execution</i> documentation (workflows, activities, signals), 2020–2025',
      'Moritz et al., <i>Ray: A Distributed Framework for Emerging AI Applications</i>, OSDI 2018'
    ],
    steps: [
      /* 1 ---------------------------------------------------------------- */
      {
        title: 'The control plane',
        say: 'Zoom into the orchestration plane, the control brain of the system. It never renders a pixel itself. Instead it decides what must happen, in what order, on whose budget, and makes sure it actually happens. On the left, a planner agent turns intent into a plan, and a crew of specialist agents will carry it out. Along the bottom runs the machinery: a durable workflow engine, a task queue, a pool of agent runtime workers, a tool registry built on the Model Context Protocol, and the model fleet those tools call.',
        deep: '<p>The orchestration plane is a <b>control plane</b>: small messages, strong consistency, modest compute. The <b>data plane</b> (encoders, diffusion transformers, codecs) moves gigabytes and burns GPU-hours. Separating them lets each scale, fail and be priced independently.</p>' +
          '<table><tr><th>Component</th><th>Job</th><th>Typical tech</th></tr>' +
          '<tr><td>Planner</td><td>intent → task DAG</td><td>frontier reasoning LLM + JSON Schema</td></tr>' +
          '<tr><td>Workflow engine</td><td>durable execution of the DAG</td><td>Temporal, Restate, Step Functions, Inngest</td></tr>' +
          '<tr><td>Task queue</td><td>decouple scheduling from execution; leases, priorities</td><td>Temporal task queues, SQS, Redis Streams</td></tr>' +
          '<tr><td>Agent runtime</td><td>runs one agent loop per task</td><td>stateless, autoscaled workers</td></tr>' +
          '<tr><td>Tool registry</td><td>typed tools, discovery, auth</td><td>MCP servers</td></tr>' +
          '<tr><td>Model fleet</td><td>LLM, VLM, DiT, TTS endpoints</td><td>vLLM / SGLang, custom DiT serving</td></tr></table>' +
          '<div class="note">Design rule: LLMs make <i>decisions</i>; deterministic code owns <i>side effects</i>, retries and accounting.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.gArch = ctx.group();
          S.gDag = ctx.group();
          S.gBus = ctx.group();
          S.gBud = ctx.group();

          S.planner = ctx.node({ x: 150, y: 250, w: 220, h: 76, title: 'Planner', sub: 'director agent', icon: 'brain', color: 'magenta', titleSize: 17, parent: S.gArch });
          S.crew = ctx.node({ x: 150, y: 455, w: 220, h: 170, kind: 'ghost', color: 'magenta', parent: S.gArch });
          ctx.text(150, 388, 'AGENT CREW', { size: 12, font: 'mono', color: 'magenta', anchor: 'middle', weight: 600, parent: S.crew, spacing: 2 });
          S.roles = ['Director', 'Writer', 'Storyboard', 'Camera', 'Editor', 'Critic'].map(function (r, i) {
            return ctx.node({ x: 97 + (i % 2) * 106, y: 420 + Math.floor(i / 2) * 40, w: 98, h: 28, kind: 'pill', title: r, titleSize: 12, color: 'magenta', glow: false, parent: S.crew });
          });

          S.eng = comp(ctx, S.gArch, 175, 660, 250, 90, 'magenta', 'gear', 'Workflow Engine', 'durable · event-sourced');
          S.engState = ctx.text(69, 690, 'state: idle', { size: 12, font: 'mono', color: 'text', parent: S.eng });
          S.queue = comp(ctx, S.gArch, 455, 660, 210, 90, 'magenta', 'queue', 'Task Queue', 'leases · priority');
          S.qslots = [];
          for (var i = 0; i < 8; i++) S.qslots.push(ctx.rect(368 + i * 23, 672, 20, 20, { rx: 3, fill: 'rgba(255,255,255,0.04)', stroke: 'faint', sw: 1, parent: S.queue }));
          S.qn = 0;
          S.workers = comp(ctx, S.gArch, 760, 660, 290, 90, 'magenta', 'agent', 'Agent Runtime', 'workers run the agent loop');
          S.wslots = [];
          for (var j = 0; j < 6; j++) {
            var wx = 627 + j * 45;
            S.wslots.push({
              rect: ctx.rect(wx, 670, 42, 24, { rx: 4, fill: 'rgba(255,255,255,0.03)', stroke: 'faint', sw: 1, parent: S.workers }),
              txt: ctx.text(wx + 21, 682, 'idle', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.workers })
            });
          }
          S.tools = comp(ctx, S.gArch, 1075, 660, 240, 90, 'magenta', 'tool', 'Tool Registry', 'MCP servers · schemas');
          ctx.text(975, 690, 'gen_video · tts · search · edl', { size: 11, font: 'mono', color: 'dim', parent: S.tools });
          S.fleet = comp(ctx, S.gArch, 1395, 660, 270, 90, 'red', 'gpu', 'Model Fleet', 'GPU pools (data plane)');
          [['LLM', 'amber'], ['VLM', 'violet'], ['DiT', 'lime'], ['TTS', 'orange']].forEach(function (p, k) {
            ctx.label(1304 + k * 56, 687, p[0], { color: p[1], size: 11, w: 46, parent: S.fleet });
          });

          S.lEQ = ctx.link(S.eng, S.queue, { color: 'magenta', straight: true, parent: S.gArch });
          S.lQW = ctx.link(S.queue, S.workers, { color: 'magenta', straight: true, parent: S.gArch });
          S.lWT = ctx.link(S.workers, S.tools, { color: 'amber', straight: true, parent: S.gArch });
          S.lTF = ctx.link(S.tools, S.fleet, { color: 'red', straight: true, parent: S.gArch });

          S.ghost = ctx.group();
          ctx.rect(300, 212, 1090, 350, { rx: 14, stroke: ctx.alpha('magenta', 0.35), dash: '6 8', parent: S.ghost });
          ctx.text(845, 372, 'PLAN · a task DAG is written here for every request', { size: 15, font: 'mono', color: 'dim', anchor: 'middle', parent: S.ghost });
          ctx.text(845, 400, 'control plane decides · data plane (GPUs) does the work', { size: 12, font: 'mono', color: 'faint', anchor: 'middle', parent: S.ghost });

          ctx.reveal(S.planner, { from: 'left' });
          ctx.reveal(S.crew, { from: 'left', delay: 200 });
          ctx.reveal([S.eng, S.queue, S.workers, S.tools, S.fleet], { from: 'up', stagger: 140, delay: 300 });
          ctx.reveal([S.lEQ, S.lQW, S.lWT, S.lTF], { from: 'draw', stagger: 140, delay: 900 });
          ctx.reveal(S.ghost, { delay: 600 });
          ctx.hotspot(S.eng, 'durable-exec');
          ctx.hotspot(S.workers, 'agent-loop');
          ctx.hotspot(S.tools, 'tool-calling');
          ctx.hotspot(S.crew, 'multi-agent', { hint: 'CREW ⤢' });
          return ctx.wait(1600).then(function () {
            return ctx.packet(S.lEQ, { color: 'magenta', dur: 450, label: 'task' });
          }).then(function () {
            return ctx.packet(S.lQW, { color: 'magenta', dur: 450, label: 'lease' });
          }).then(function () {
            return ctx.packet(S.lWT, { color: 'amber', dur: 450, label: 'tool_use' });
          }).then(function () {
            return ctx.packet(S.lTF, { color: 'red', dur: 450, label: 'RPC' });
          });
        }
      },
      /* 2 ---------------------------------------------------------------- */
      {
        title: 'Intent to plan',
        say: 'The creator\'s request arrives as intent plus references. The planner, a strong reasoning model acting as the director, does not start rendering. It writes a plan: a typed JSON document, constrained by a schema, listing tasks, the agent that owns each one, and their dependencies. The engine validates it and compiles it into a directed acyclic graph. Analyze the references, write the script, storyboard it, wait for approval, fan out six shots in parallel while voice and music are produced, then edit and critique.',
        deep: '<p>Planning maps an underspecified goal to a graph <code>G = (V, E)</code>. Each vertex carries <code>{agent, inputs, output_schema, est_cost}</code>; edges are <b>artifact dependencies</b>, not chat messages.</p>' +
          '<div class="eq">ready(v) ⇔ ∀ (u,v) ∈ E : state(u) = done</div>' +
          '<ul><li><b>Explicit parallelism</b>: the DAG\'s width (6 shots + audio) is visible to the scheduler. LLMCompiler-style planners cut latency by issuing independent calls concurrently instead of one ReAct step at a time.</li>' +
          '<li><b>Estimates before spending</b>: T ≥ Σ<sub>v∈critical path</sub> t<sub>v</sub> and cost = Σ<sub>v∈V</sub> ĉ<sub>v</sub> are computable before a single GPU is booked.</li>' +
          '<li><b>Validation</b>: schema check, acyclicity (Kahn topological sort, O(|V|+|E|)), tool availability and budget are checked first; violations go back to the planner as a repair turn.</li></ul>' +
          '<div class="note">The plan is produced with schema-constrained decoding, so it always parses. What constraints cannot guarantee is <i>semantic</i> validity; that is the validator\'s job.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.intent = ctx.label(150, 180, 'intent + 3 sketches + memo', { color: 'cyan', size: 11 });
          ctx.reveal(S.intent, { from: 'down' });
          S.lIn = ctx.link({ x: 150, y: 192 }, S.planner, { color: 'cyan', straight: true, to: 't' });
          ctx.reveal(S.lIn, { from: 'draw', delay: 200 });
          ctx.fadeOut(S.ghost, 400, true);
          S.plan = ctx.code({ x: 300, y: 212, w: 640, title: 'plan.json  (schema-constrained)', lang: 'json', typing: true, size: 13, color: 'magenta', lines: S.planLines = [
            '{"goal": "30s trailer: fox astronaut, ice moon",',
            ' "tasks": [',
            '  {"id":"refs",     "agent":"vision", "deps":[]},',
            '  {"id":"script",   "agent":"writer", "deps":["refs"]},',
            '  {"id":"board",    "agent":"board",  "deps":["script"]},',
            '  {"id":"approve",  "agent":"human",  "deps":["board"]},',
            '  {"id":"shot_1..6","agent":"camera", "deps":["approve"]},',
            '  {"id":"vo_music", "agent":"audio",  "deps":["script"]},',
            '  {"id":"edit",     "agent":"editor", "deps":["shot_*","vo_music"]},',
            '  {"id":"critic",   "agent":"critic", "deps":["edit"]}]}'
          ] });
          ctx.reveal(S.plan, { from: 'up', dur: 400, delay: 300 });

          /* budget panel */
          S.bud = { tok: 0, gpu: 0, res: 0 };
          ctx.rect(1405, 180, 165, 405, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha('magenta', 0.5), parent: S.gBud });
          ctx.text(1420, 203, 'BUDGET', { size: 14, font: 'display', weight: 700, color: 'magenta', parent: S.gBud });
          ctx.text(1557, 203, 'job 7f3a', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.gBud });
          S.meters = ['LLM tokens', 'GPU-seconds', 'USD'].map(function (nm, i) {
            var y0 = 240 + i * 72;
            ctx.text(1420, y0, nm, { size: 12, color: 'text', parent: S.gBud });
            var m = {};
            m.val = ctx.text(1557, y0 + 20, '', { size: 12, font: 'mono', color: 'white', anchor: 'end', parent: S.gBud });
            ctx.rect(1420, y0 + 34, 135, 8, { rx: 3, fill: 'rgba(255,255,255,0.06)', parent: S.gBud });
            m.fill = ctx.rect(1420, y0 + 34, 0, 8, { rx: 3, fill: ['amber', 'lime', 'magenta'][i], parent: S.gBud });
            m.res = ctx.rect(1420, y0 + 34, 0, 8, { rx: 3, fill: ctx.alpha('white', 0.25), stroke: 'white', sw: 0.8, dash: '2 2', parent: S.gBud });
            return m;
          });
          ctx.text(1420, 462, 'LEDGER', { size: 11, font: 'mono', color: 'dim', parent: S.gBud, spacing: 2 });
          S.ledger = [];
          drawBudget(ctx, S);
          ctx.reveal(S.gBud, { from: 'right', delay: 200 });

          return ctx.wait(500).then(function () {
            return ctx.packet(S.lIn, { color: 'cyan', dur: 400 });
          }).then(function () {
            ctx.pulse(S.planner, { color: 'magenta', times: 2, dur: 700 });
            var typing = S.planLines.reduce(function (p, str) {
              return p.then(function () {
                var pr = S.plan.addLine(str);
                var t = S.plan.lineEls[S.plan.lineEls.length - 1];
                t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
                t.style.whiteSpace = 'pre';
                return pr;
              });
            }, Promise.resolve());
            return Promise.all([typing, setBudget(ctx, S, { tok: 14000 }, 2500)]);
          }).then(function () {
            ledger(ctx, S, '+14k tok planner', 'amber');
            return ctx.wait(400);
          }).then(function () {
            return ctx.fadeOut(S.plan, 450, true);
          }).then(function () {
            var P = S.gDag;
            S.n = {};
            S.n.refs = dagNode(ctx, P, DX.refs, CY, 'Analyze refs', 'vision');
            S.n.script = dagNode(ctx, P, DX.script, CY, 'Script', 'writer');
            S.n.board = dagNode(ctx, P, DX.board, CY, 'Storyboard', 'board');
            S.n.gate = dagNode(ctx, P, DX.gate, CY, 'Approve', 'human', { kind: 'hex', w: 104 });
            S.n.voice = dagNode(ctx, P, DX.board, 505, 'Voice+music', 'audio');
            S.n.shots = SHOT_Y.map(function (y, i) { return dagNode(ctx, P, DX.shot, y, 'Shot ' + (i + 1), 'camera', { w: 120 }); });
            S.n.edit = dagNode(ctx, P, DX.edit, CY, 'Edit', 'editor');
            S.n.critic = dagNode(ctx, P, DX.critic, CY, 'Critic', 'critic');
            var ln = function (a, b, o) { o = o || {}; o.parent = P; o.color = o.color || ctx.alpha('magenta', 0.55); o.sw = 1.4; return ctx.link(a, b, o); };
            S.e = {};
            S.e.rs = ln(S.n.refs, S.n.script, { straight: true });
            S.e.sb = ln(S.n.script, S.n.board, { straight: true });
            S.e.bg = ln(S.n.board, S.n.gate, { straight: true });
            S.e.sv = ln(S.n.script, S.n.voice, { from: 'b', to: 'l', curve: 0.45 });
            S.e.gs = S.n.shots.map(function (sn) { return ln(S.n.gate, sn, { from: 'r', to: 'l', curve: 0.4 }); });
            S.e.se = S.n.shots.map(function (sn) { return ln(sn, S.n.edit, { from: 'r', to: 'l', curve: 0.4 }); });
            S.e.ve = ln(S.n.voice, S.n.edit, { from: 'r', to: 'b', bend: { x: 908, y: 714 } });
            S.e.ec = ln(S.n.edit, S.n.critic, { straight: true });
            var waves = [[S.n.refs], [S.n.script], [S.n.board, S.n.voice], [S.n.gate], S.n.shots, [S.n.edit], [S.n.critic]];
            var edgesW = [[], [S.e.rs], [S.e.sb, S.e.sv], [S.e.bg], S.e.gs, S.e.se.concat([S.e.ve]), [S.e.ec]];
            var all = [];
            waves.forEach(function (w, k) {
              all.push(ctx.reveal(w, { from: 'scale', s0: 0.7, delay: k * 260, stagger: 50, dur: 450 }));
              all.push(ctx.reveal(edgesW[k], { from: 'draw', delay: k * 260 - 120, stagger: 30, dur: 380 }));
            });
            setEng(S, 'plan v1 · 13 tasks');
            return Promise.all(all);
          }).then(function () {
            S.lPlan = ctx.path('M40,262 C4,262 4,660 50,660', { color: ctx.alpha('magenta', 0.7), sw: 1.6, arrow: true, dash: '4 5', parent: S.gArch });
            S.lPlan.len = S.lPlan.getTotalLength();
            return ctx.reveal(S.lPlan, { from: 'draw', dur: 500 });
          }).then(function () {
            return ctx.packet(S.lPlan, { color: 'magenta', dur: 900, label: 'plan v1' });
          });
        }
      },
      /* 3 ---------------------------------------------------------------- */
      {
        title: 'Workflows vs agents',
        say: 'There are two ways to wire language models into software. In a workflow, code owns the control flow: models fill in steps along predefined paths, like chaining, routing or parallel sections. In an agent, the model owns the control flow: it picks the next action from what it observes, until it judges the task done. Workflows are predictable, cheap and testable. Agents handle open-ended problems but cost more and fail in stranger ways. Production systems blend them: an agentic planner writes the graph, a deterministic engine runs it, and agents work inside the leaves.',
        deep: '<p>Anthropic\'s taxonomy (<i>Building Effective Agents</i>, 2024): <b>workflows</b> orchestrate LLMs and tools through predefined code paths; <b>agents</b> dynamically direct their own processes and tool usage.</p>' +
          '<table><tr><th>Pattern</th><th>Who decides</th><th>Here</th></tr>' +
          '<tr><td>Prompt chaining</td><td>code</td><td>script → shot prompts</td></tr>' +
          '<tr><td>Routing</td><td>code + classifier</td><td>pick video model per shot type</td></tr>' +
          '<tr><td>Parallelization</td><td>code</td><td>6 shots; best-of-n seeds</td></tr>' +
          '<tr><td>Orchestrator–workers</td><td>LLM plans, code runs</td><td>planner → DAG → workers</td></tr>' +
          '<tr><td>Evaluator–optimizer</td><td>LLM loop</td><td>critic ↔ re-render</td></tr>' +
          '<tr><td>Autonomous agent</td><td>LLM</td><td>inside each leaf task</td></tr></table>' +
          '<p>Why bound autonomy? If each dependent step succeeds independently with probability p, an n-step chain succeeds with p<sup>n</sup>: 0.95<sup>20</sup> ≈ 0.36. Checkpoints, validators and retries between short agentic leaves reset that decay.</p>' +
          '<div class="note">Rule of thumb: add autonomy only where the path cannot be known in advance, and pay for it with evals and budgets.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var O = S.ov = ctx.group();
          ctx.rect(300, 188, 1090, 410, { rx: 14, fill: 'rgba(5,10,22,0.96)', stroke: 'magenta', parent: O, glow: true });
          ctx.text(330, 216, 'WHO OWNS THE CONTROL FLOW?', { size: 17, font: 'display', weight: 700, color: 'white', parent: O });
          ctx.text(1368, 216, 'after Anthropic, Building Effective Agents (2024)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: O });
          ctx.line(855, 245, 855, 470, { color: 'line', parent: O });
          /* left: workflow */
          ctx.text(330, 258, 'WORKFLOW · code owns the path', { size: 13, font: 'mono', weight: 600, color: 'cyan', parent: O });
          var wf = [['LLM', 'script', 405], ['check', 'code', 520], ['LLM', 'prompts', 635], ['DiT', 'render', 750]];
          var wn = wf.map(function (d, i) {
            return ctx.node({ x: d[2], y: 322, w: 92, h: 44, title: d[0], sub: d[1], titleSize: 13, subSize: 11, color: i === 1 ? 'teal' : (i === 3 ? 'lime' : 'cyan'), kind: i === 1 ? 'hex' : 'box', glow: false, parent: O });
          });
          var wl = [];
          for (var i = 0; i < 3; i++) wl.push(ctx.link(wn[i], wn[i + 1], { color: 'cyan', straight: true, parent: O }));
          var retry = ctx.path('M520,344 C520,392 405,392 405,346', { color: ctx.alpha('teal', 0.8), sw: 1.4, dash: '4 4', arrow: true, parent: O });
          ctx.text(462, 398, 'fixed retry', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: O });
          var chips = [['prompt chaining', 390], ['routing', 488], ['parallelization', 600], ['orchestrator-workers', 435, 452], ['evaluator-optimizer', 635, 452]];
          chips.forEach(function (c) { ctx.label(c[1], c[2] || 426, c[0], { color: 'cyan', size: 11, parent: O }); });
          /* right: agent */
          ctx.text(880, 258, 'AGENT · the model owns the path', { size: 13, font: 'mono', weight: 600, color: 'magenta', parent: O });
          var llm = ctx.node({ x: 945, y: 335, w: 110, h: 46, title: 'LLM', sub: 'policy', icon: 'brain', color: 'amber', titleSize: 14, subSize: 11, glow: false, parent: O });
          var env = ctx.node({ x: 1275, y: 335, w: 140, h: 46, title: 'Tools', sub: 'environment', icon: 'tool', color: 'teal', titleSize: 14, subSize: 11, glow: false, parent: O });
          var top = ctx.path('M1000,318 C1060,272 1150,272 1205,318', { color: 'magenta', sw: 1.8, arrow: true, parent: O });
          var bot = ctx.path('M1205,352 C1150,398 1060,398 1000,352', { color: 'teal', sw: 1.8, arrow: true, parent: O });
          ctx.text(1102, 322, 'action: tool_use', { size: 11, font: 'mono', color: 'magenta', anchor: 'middle', parent: O });
          ctx.text(1102, 347, 'observation: tool_result', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: O });
          ctx.para(880, 430, ['model chooses the next action · unknown number of steps', 'needs stop conditions, turn caps, budgets, sandboxes'], { size: 12, color: 'text', font: 'mono', lh: 18, parent: O });
          var dot = ctx.circle(0, 0, 5, { fill: 'amber', glow: true, parent: O });
          var tl = top.getTotalLength(), bl = bot.getTotalLength();
          S.ovLoop = ctx.loop(function (t) {
            var f = (t / 2.2) % 1, p;
            p = f < 0.5 ? top.getPointAtLength(tl * f * 2) : bot.getPointAtLength(bl * (f * 2 - 1));
            dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
          });
          /* spectrum */
          var x0 = 340, W = 1010;
          for (var k = 0; k < 40; k++) ctx.rect(x0 + k * W / 40, 512, W / 40 + 0.5, 14, { rx: 0, fill: ctx.mix('cyan', 'magenta', k / 39), opacity: 0.75, parent: O });
          ctx.text(x0, 492, 'predictable · cheap · testable', { size: 11, font: 'mono', color: 'cyan', parent: O });
          ctx.text(x0 + W, 492, 'flexible · open-ended · costly', { size: 11, font: 'mono', color: 'magenta', anchor: 'end', parent: O });
          [['prompt chaining', 0.06], ['routing', 0.18], ['parallelization', 0.30], ['orchestrator-workers', 0.52], ['evaluator-optimizer', 0.66], ['autonomous agent', 0.92]].forEach(function (m, j) {
            var x = x0 + W * m[1];
            ctx.line(x, 508, x, 530, { color: 'white', sw: 1.2, parent: O });
            ctx.text(x, j % 2 ? 562 : 544, m[0], { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: O });
          });
          S.sysMark = ctx.group({ parent: O });
          ctx.path('M845,505 V499 H1067 V505', { color: 'amber', sw: 2, parent: S.sysMark });
          ctx.text(956, 476, 'THIS SYSTEM: agentic planner · durable engine · agentic leaves', { size: 11, font: 'mono', weight: 600, color: 'amber', anchor: 'middle', parent: S.sysMark });

          ctx.focus([O], 0.18);
          ctx.reveal(O, { from: 'scale', s0: 0.94, dur: 500 });
          ctx.reveal(S.sysMark, { from: 'down', delay: 2600 });
          return ctx.wait(700).then(function () {
            return wl.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'cyan', dur: 450 }); }); }, Promise.resolve());
          }).then(function () {
            return ctx.packet(retry, { color: 'teal', dur: 600 });
          }).then(function () { return ctx.wait(1200); });
        }
      },
      /* 4 ---------------------------------------------------------------- */
      {
        title: 'Dispatch & events',
        say: 'Execution begins. The workflow engine finds the tasks whose dependencies are satisfied and puts them on a task queue. A stateless agent worker leases a task, runs its agent loop, and calls tools through the registry, which in turn calls the model fleet. Every state change is published to an append-only event bus. Consumers build the current state, stream progress to the client and charge the budget. Outputs never travel inline: agents pass references to immutable artifacts. Notice that the audio branch starts as soon as the script exists.',
        deep: '<p>The engine is an event-driven scheduler over the dependency graph:</p>' +
          '<pre>on task_completed(u):\n  history.append(event)   # durable\n  for v in succ(u):\n    if all(done(p) for p in pred(v)):\n      budget.reserve(v.est_cost)\n      queue.put(v, prio=-slack(v))</pre>' +
          '<p>Priority by <b>slack</b> (latest start − earliest start) runs critical-path tasks first.</p>' +
          '<ul><li><b>Leases</b>: a worker holds a task with heartbeats (e.g. every 10 s, 30 s timeout). A dead pod means one retry, not a lost job.</li>' +
          '<li><b>At-least-once + idempotency</b>: delivery can repeat, so every side-effecting tool call carries an idempotency key <code>(job, task, attempt)</code>.</li>' +
          '<li><b>Event bus</b>: a partitioned append-only log (Kafka-like) keyed by <code>job_id</code>, giving per-job ordering; consumers track offsets and can replay to rebuild state.</li>' +
          '<li><b>Artifacts by reference</b>: <code>artifact://board@sha256:3b0d…</code>. Content addressing gives dedup, caching and reproducibility, and keeps megabytes of media out of LLM context.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.ovLoop) S.ovLoop.stop();
          ctx.fade(S.ov, 0, 400).then(function () { if (S.ov.parentNode) S.ov.parentNode.removeChild(S.ov); });
          ctx.focus(null);
          /* event bus + stores */
          var B = S.gBus;
          ctx.rect(40, 740, 1520, 24, { rx: 12, fill: ctx.alpha('teal', 0.08), stroke: ctx.alpha('teal', 0.6), parent: B });
          ctx.text(56, 752, 'EVENT BUS', { size: 11, font: 'mono', weight: 700, color: 'teal', parent: B, spacing: 1.5 });
          ctx.text(1545, 752, 'append-only log · partitioned by job_id', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B });
          [175, 455, 760, 1075, 1395].forEach(function (x) { ctx.line(x, 705, x, 740, { color: ctx.alpha('teal', 0.5), sw: 1.2, dash: '3 3', parent: B }); });
          var stores = [['State Store', 'workflow + task state', 200, 'teal'], ['Artifact Store', 's3:// content-addressed', 510, 'teal'], ['Budget Ledger', 'reserve · commit', 820, 'magenta'], ['Traces', 'OpenTelemetry spans', 1130, 'pink'], ['Client stream', 'SSE progress events', 1420, 'cyan']];
          S.stores = stores.map(function (s) {
            ctx.line(s[2], 764, s[2], 807, { color: ctx.alpha(s[3], 0.5), sw: 1.2, parent: B });
            return ctx.node({ x: s[2], y: 835, w: 220, h: 56, kind: 'cyl', title: s[0], sub: s[1], color: s[3], titleSize: 13, subSize: 11, glow: false, parent: B });
          });
          ctx.reveal(B, { from: 'up', dur: 500, opacity: 1 });
          setEng(S, 'running · ready: refs');
          return ctx.wait(600).then(function () {
            return dispatch(ctx, S, S.n.refs, 0, 'refs', 900);
          }).then(function () {
            S.tags = ctx.group({ parent: S.gDag });
            ctx.text(428, 350, '#9f2c', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.tags });
            setBudget(ctx, S, { tok: 34000, gpu: 10 }, 500);
            ledger(ctx, S, '+20k tok vision', 'amber');
            setEng(S, 'running · ready: script');
            return dispatch(ctx, S, S.n.script, 1, 'script', 800);
          }).then(function () {
            ctx.text(572, 350, '#a17e', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.tags });
            setBudget(ctx, S, { tok: 59000 }, 500);
            ledger(ctx, S, '+25k tok writer', 'amber');
            setEng(S, 'running · board ‖ audio');
            return Promise.all([
              dispatch(ctx, S, S.n.board, 2, 'board', 1100),
              dispatch(ctx, S, S.n.voice, 3, 'audio', 1300, 150)
            ]);
          }).then(function () {
            ctx.text(710, 350, '#3b0d', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.tags });
            ledger(ctx, S, '+38k tok board+audio', 'amber');
            ledger(ctx, S, '+50 GPU-s keyframes', 'lime');
            ledger(ctx, S, '+80 GPU-s voice+music', 'lime');
            setEng(S, 'ready: approve (human)');
            return Promise.all([
              setBudget(ctx, S, { tok: 97000, gpu: 140 }, 700),
              busEvent(ctx, S, 760, 510, 'artifact:board', 'teal'),
              busEvent(ctx, S, 900, 1420, 'progress 22%', 'cyan')
            ]);
          });
        }
      },
      /* 5 ---------------------------------------------------------------- */
      {
        title: 'Human checkpoint',
        say: 'Before spending real GPU money, the plan contains a human checkpoint. The storyboard, six keyframes with camera notes, is streamed to the creator. The workflow simply suspends on a durable signal. No worker, no GPU and no language model is held while the human thinks, whether that takes ten seconds or a whole day. When the creator clicks approve, the signal is recorded as an event and execution resumes exactly where it stopped.',
        deep: '<p>Human-in-the-loop is a <b>signal-wait</b> node, not a blocked thread:</p>' +
          '<pre>board = await activity(storyboard_agent, script)\nawait notify(client, "review", board.uri)\nd = await workflow.wait_signal("approve",\n                              timeout=24h)\nif d.revise:\n    board = await activity(revise, board, d.notes)</pre>' +
          '<ul><li>While waiting, the workflow exists only as its event history in the store: memory ≈ 0, compute = 0. On the signal, a worker replays history and continues.</li>' +
          '<li>Placement is economic: the gate sits right <i>before</i> the most expensive fan-out. Reviewing 6 keyframes costs ~50 GPU-s; rejecting 6 rendered shots would waste ~4,500.</li>' +
          '<li>Other gates worth a human: irreversible side effects (publishing, spending above a threshold), use of a real person\'s likeness, policy-borderline prompts.</li></ul>' +
          '<div class="note">The cheapest GPU-second is the one never scheduled because a human said “not like that” early.</div>',
        run: function (ctx) {
          var S = ctx.state;
          setSt(ctx, S.n.gate, 'wait');
          setEng(S, 'WAIT signal: approve');
          var C = S.card = ctx.group({ x: -34 });
          ctx.rect(470, 176, 365, 158, { rx: 10, fill: 'rgba(6,14,28,0.97)', stroke: 'cyan', parent: C, glow: true });
          ctx.icon('phone', 490, 196, 16, 'cyan', { parent: C });
          ctx.text(504, 196, 'CLIENT · storyboard review', { size: 12, font: 'mono', weight: 600, color: 'cyan', parent: C });
          var r = ctx.rng(11);
          for (var i = 0; i < 6; i++) {
            var tx = 486 + (i % 3) * 78, ty = 212 + Math.floor(i / 3) * 50;
            ctx.rect(tx, ty, 70, 42, { rx: 4, fill: '#0a1830', stroke: ctx.alpha('violet', 0.7), sw: 1, parent: C });
            ctx.circle(tx + 14 + r() * 40, ty + 12 + r() * 8, 6 + r() * 4, { fill: ctx.alpha('cyan', 0.5), parent: C });
            ctx.poly([[tx + 30 + r() * 20, ty + 36], [tx + 38 + r() * 12, ty + 20], [tx + 50 + r() * 12, ty + 36]], { fill: ctx.alpha('orange', 0.75), parent: C });
            ctx.text(tx + 4, ty + 35, String(i + 1), { size: 11, font: 'mono', color: 'white', parent: C });
          }
          S.btnA = ctx.label(778, 232, 'Approve', { color: 'lime', size: 12, w: 84, parent: C });
          ctx.label(778, 270, 'Revise', { color: 'dim', size: 12, w: 84, parent: C });
          S.cardSt = ctx.text(486, 318, '0 GPUs · 0 workers held while waiting', { size: 11, font: 'mono', color: 'dim', parent: C });
          var cursor = ctx.poly([[0, 0], [0, 16], [4, 12], [7, 19], [9, 18], [6, 11], [11, 11]], { fill: 'white', stroke: '#000', parent: C });
          ctx.place(cursor, 700, 310);
          S.lSig = ctx.link({ x: 744, y: 334 }, S.n.gate, { color: 'cyan', straight: true, to: 't', dash: '4 4' });
          ctx.reveal(C, { from: 'up', dur: 500 });
          ctx.reveal(S.lSig, { from: 'draw', delay: 400 });
          return ctx.pulse(S.n.gate, { color: 'cyan', times: 2, dur: 700 }).then(function () {
            return busEvent(ctx, S, 760, 1420, 'review.requested', 'cyan');
          }).then(function () {
            return ctx.transform(cursor, { x: 790, y: 236 }, 900, 'inOut');
          }).then(function () {
            ctx.pulse(S.btnA, { color: 'lime', dur: 500 });
            return ctx.wait(300);
          }).then(function () {
            return ctx.packet(S.lSig, { color: 'lime', dur: 500, label: 'signal: approve' });
          }).then(function () {
            setSt(ctx, S.n.gate, 'done');
            S.n.gate.bar.setAttribute('width', S.n.gate.barW);
            S.n.gate.bar.setAttribute('fill', ctx.C.lime);
            setEng(S, 'resumed · replayed 9 events');
            S.cardSt.textContent = 'approved ✓ · signal stored as an event';
            S.cardSt.setAttribute('fill', ctx.C.lime);
            return busEvent(ctx, S, 1420, 200, 'human.approved', 'lime');
          });
        }
      },
      /* 6 ---------------------------------------------------------------- */
      {
        title: 'Parallel fan-out',
        say: 'Approval unlocks the widest part of the graph. Six shot tasks are enqueued at once. Each camera agent turns its storyboard panel into a precise prompt with reference images and camera moves, then submits a video generation job. The six jobs run in parallel on the video pool, each spread across eight GPUs. The audio branch finished earlier, in parallel with the storyboard. Watch the GPU seconds meter: this fan-out is where almost the entire bill is spent. When every branch is done, the editor assembles the cut.',
        deep: '<p>With k shots of G GPUs each, wall-clock and cost decouple:</p>' +
          '<div class="eq">T<sub>fan-out</sub> ≈ max<sub>i</sub> t<sub>i</sub> ≈ 95 s &nbsp;&nbsp; cost = Σ<sub>i</sub> G · t<sub>i</sub> ≈ 6 × 8 × 95 = 4,560 GPU-s</div>' +
          '<ul><li><b>Admission</b>: before enqueueing, the engine <i>reserves</i> each shot\'s p90 estimate with the budget controller; the GPU scheduler gang-places an 8-GPU job only when all 8 are free (no partial allocation deadlock).</li>' +
          '<li><b>Concurrency caps</b>: per-job and per-tenant limits (e.g. ≤ 6 concurrent DiT jobs) stop one trailer from starving the fleet.</li>' +
          '<li><b>Stragglers</b>: a slow tail shot can be hedged with a duplicate at lower priority; first result wins, the loser is cancelled and refunded.</li>' +
          '<li><b>Async tools</b>: <code>generate_video</code> returns a job handle immediately; the worker releases its slot and the engine awaits a completion event, so an agent loop never holds a lease for 95 s of GPU time.</li>' +
          '<li><b>Fan-in barrier</b>: <code>edit</code> is ready only when all 7 predecessors are done; the edit decision list references shots by content hash, so the cut is reproducible.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut([S.card, S.lSig], 400, true);
          setEng(S, 'running · 6 shots parallel');
          ctx.hud('6 shots × 8 GPUs in parallel');
          S.e.gs.forEach(function (e) { e.setAttribute('stroke', ctx.C.magenta); });
          setQ(ctx, S, 6);
          setBudget(ctx, S, { res: 4560 }, 400);
          var shots = S.n.shots.map(function (n, i) {
            return ctx.wait(300 + i * 140).then(function () {
              setQ(ctx, S, S.qn - 1);
              setW(ctx, S, i, 's' + (i + 1));
              return ctx.packet(S.lQW, { color: 'magenta', dur: 300 });
            }).then(function () {
              setW(ctx, S, i, '');
              setSt(ctx, n, 'run');
              return ctx.animate(n.bar, { width: [0, n.barW] }, 1800 + ((i * 37) % 5) * 260, 'inOut');
            }).then(function () {
              setSt(ctx, n, 'done');
              n.bar.setAttribute('fill', ctx.C.lime);
            });
          });
          var gpu = ctx.wait(500).then(function () {
            return Promise.all([
              setBudget(ctx, S, { gpu: 4700, res: 0, tok: 133000 }, 2900),
              ctx.packet(S.lTF, { color: 'lime', dur: 500, label: 'generate_video ×6' })
            ]);
          });
          return Promise.all(shots.concat([gpu])).then(function () {
            ledger(ctx, S, '+36k tok camera ×6', 'amber');
            ledger(ctx, S, '+4,560 GPU-s shots', 'lime');
            S.e.gs.forEach(function (e) { e.setAttribute('stroke', ctx.alpha('magenta', 0.55)); });
            setEng(S, 'running · edit (fan-in)');
            return dispatch(ctx, S, S.n.edit, 0, 'edit', 900);
          }).then(function () {
            setBudget(ctx, S, { tok: 145000, gpu: 4730 }, 500);
            ledger(ctx, S, '+30 GPU-s edit', 'orange');
            setSt(ctx, S.n.critic, 'run');
            S.n.critic.bar.setAttribute('width', S.n.critic.barW * 0.5);
            setEng(S, 'running · critic');
            return ctx.wait(300);
          });
        }
      },
      /* 7 ---------------------------------------------------------------- */
      {
        title: 'Critic & replanning',
        say: 'The critic, a vision language model with scoring rubrics, watches the cut. Shot three fails: the fox\'s helmet and fur pattern drifted away from the character sheet. This is where agentic planning earns its keep. The failure event reaches the planner, which patches the graph instead of restarting it: add a new version of shot three with the character sheet as a reference image and a locked seed, then re-run the edit and the critic. The budget controller reserves the extra GPU seconds first. Everything else is reused.',
        deep: '<p><b>Evaluator–optimizer</b> at graph level. The critic returns structured, thresholded scores:</p>' +
          '<pre>{"shot":3, "identity":0.61, "style":0.82,\n "continuity":0.79, "min":{"identity":0.75},\n "fix":"ref=fox_sheet.png; lock seed"}</pre>' +
          '<p>Identity can be scored as mean cosine similarity between an embedding of the reference character and per-frame crops:</p>' +
          '<div class="eq">s<sub>id</sub> = (1/F) Σ<sub>f</sub> cos(e<sub>ref</sub>, e<sub>f</sub>)</div>' +
          '<p><b>Dynamic replanning</b> is a graph patch applied atomically by the engine:</p>' +
          '<pre>G\' = G ∪ {shot_3.v2 → edit.v2 → critic.v2}\n     − {shot_3 → edit}      # superseded</pre>' +
          '<ul><li>Completed nodes keep their artifacts (memoised by content hash): only 1/6 of the fan-out is recomputed.</li>' +
          '<li>Loops are bounded: <code>max_revisions = 2</code> per shot, then escalate to the human.</li>' +
          '<li>Use a critic from a different model family than the planner, to reduce self-preference bias.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('replan: 1 of 6 shots recomputed');
          var P = S.cp = ctx.group();
          ctx.rect(1140, 428, 255, 140, { rx: 10, fill: 'rgba(6,12,24,0.95)', stroke: ctx.alpha('magenta', 0.6), parent: P });
          ctx.text(1155, 448, 'CRITIC · shot 3 rubric', { size: 12, font: 'mono', weight: 600, color: 'magenta', parent: P });
          S.crit = [['identity', 0.61, 0.75], ['style', 0.82, 0.7], ['continuity', 0.79, 0.7]].map(function (m, i) {
            var y = 478 + i * 30;
            ctx.text(1155, y, m[0], { size: 12, font: 'mono', color: 'text', parent: P });
            ctx.rect(1240, y - 6, 110, 12, { rx: 3, fill: 'rgba(255,255,255,0.06)', parent: P });
            var bar = ctx.rect(1240, y - 6, 0, 12, { rx: 3, fill: m[1] < m[2] ? 'red' : 'lime', parent: P });
            ctx.line(1240 + 110 * m[2], y - 10, 1240 + 110 * m[2], y + 10, { color: 'white', sw: 1.5, parent: P });
            var v = ctx.text(1388, y, m[1].toFixed(2), { size: 12, font: 'mono', color: m[1] < m[2] ? 'red' : 'lime', anchor: 'end', parent: P });
            ctx.animate(bar, { width: [0, 110 * m[1]] }, 700, 'out', 200 + i * 150);
            return { bar: bar, v: v };
          });
          ctx.reveal(P, { from: 'up', dur: 400 });
          S.fb = ctx.path('M1235,363 V215 Q1235,200 1220,200 H165 Q150,200 150,210', { color: ctx.alpha('red', 0.8), sw: 1.6, dash: '5 5', arrow: true, parent: S.gDag });
          S.fb.len = S.fb.getTotalLength();
          return ctx.wait(1100).then(function () {
            setSt(ctx, S.n.shots[2], 'fail');
            S.n.shots[2].bar.setAttribute('fill', ctx.C.red);
            setSt(ctx, S.n.critic, 'fail');
            ctx.pulse(S.n.shots[2], { color: 'red', times: 2, dur: 600 });
            return ctx.reveal(S.fb, { from: 'draw', dur: 700 });
          }).then(function () {
            return Promise.all([ctx.packet(S.fb, { color: 'red', dur: 1300, label: 'critic.failed(shot 3)' }), busEvent(ctx, S, 1235, 200, 'critic.failed', 'red')]);
          }).then(function () {
            ctx.pulse(S.planner, { color: 'magenta', times: 2, dur: 600 });
            setEng(S, 'plan v2 · patch +3 tasks');
            ledger(ctx, S, '+33k tok critic+plan', 'amber');
            return setBudget(ctx, S, { tok: 178000, res: 760 }, 800);
          }).then(function () {
            ledger(ctx, S, 'reserve 760 GPU-s ok', 'white');
            S.n.s3v2 = dagNode(ctx, S.gDag, DX.edit, 265, 'Shot 3 v2', 'ref + seed', { w: 120 });
            S.e.old = S.e.se[2];
            S.e.old.setAttribute('stroke', ctx.alpha('red', 0.35));
            S.e.old.setAttribute('stroke-dasharray', '3 5');
            S.e.v2a = ctx.link(S.n.shots[2], S.n.s3v2, { color: ctx.alpha('red', 0.7), from: 'r', to: 'l', dash: '4 4', sw: 1.4, parent: S.gDag });
            S.e.v2b = ctx.link(S.n.s3v2, S.n.edit, { color: ctx.alpha('magenta', 0.8), from: 'b', to: 't', straight: true, sw: 1.4, parent: S.gDag });
            ctx.reveal(S.n.s3v2, { from: 'scale', s0: 0.6, dur: 500 });
            ctx.reveal([S.e.v2a, S.e.v2b], { from: 'draw', delay: 300, stagger: 150 });
            return ctx.packet(S.lPlan, { color: 'magenta', dur: 800, label: 'plan v2' });
          }).then(function () {
            setSt(ctx, S.n.shots[2], 'old');
            setSt(ctx, S.n.edit, 'pending');
            S.n.edit.bar.setAttribute('width', 0);
            S.n.critic.bar.setAttribute('width', 0);
            setSt(ctx, S.n.critic, 'pending');
            S.n.edit.titleEl.textContent = 'Edit v2';
            S.n.critic.titleEl.textContent = 'Critic v2';
            return Promise.all([runTask(ctx, S.n.s3v2, 1400), setBudget(ctx, S, { gpu: 5490, res: 0, tok: 184000 }, 1400)]);
          }).then(function () {
            ledger(ctx, S, '+760 GPU-s shot 3 v2', 'lime');
            return runTask(ctx, S.n.edit, 700);
          }).then(function () {
            setBudget(ctx, S, { gpu: 5520, tok: 212000 }, 900);
            return runTask(ctx, S.n.critic, 900);
          }).then(function () {
            S.crit[0].bar.setAttribute('fill', ctx.C.lime);
            S.crit[0].v.setAttribute('fill', ctx.C.lime);
            S.crit[0].v.textContent = '0.88';
            setEng(S, 'completed ✓ · 2 plan versions');
            return Promise.all([ctx.animate(S.crit[0].bar, { width: [110 * 0.61, 110 * 0.88] }, 600, 'out'), busEvent(ctx, S, 1235, 1420, 'job.completed', 'lime')]);
          });
        }
      },
      /* 8 ---------------------------------------------------------------- */
      {
        title: 'Budget accounting',
        say: 'Every action has a price, so the orchestrator keeps books in three currencies: language model tokens, GPU seconds and dollars. Before a task is enqueued, its estimated cost is reserved. When it finishes, the actual cost is committed, and anything unused is refunded. Look at the shape of the bill. All the thinking done by every agent costs well under a dollar, while the pixels cost nearly four. That is why cheap planning, early human checkpoints and targeted re-renders matter far more than shaving prompt tokens.',
        deep: '<table><tr><th>Line item</th><th>Quantity</th><th>Cost</th></tr>' +
          '<tr><td>LLM, all agents</td><td>190k in (60% cached) + 22k out</td><td>$0.59</td></tr>' +
          '<tr><td>Ref encoding + keyframes</td><td>60 GPU-s</td><td>$0.04</td></tr>' +
          '<tr><td>Voice + music</td><td>80 GPU-s</td><td>$0.06</td></tr>' +
          '<tr><td>Shots v1 (6 × 8 GPU × 95 s)</td><td>4,560 GPU-s</td><td>$3.17</td></tr>' +
          '<tr><td>Shot 3 v2</td><td>760 GPU-s</td><td>$0.53</td></tr>' +
          '<tr><td>Edit + encode (×2)</td><td>60 GPU-s</td><td>$0.04</td></tr>' +
          '<tr><th>Total</th><th>212k tok · 5,520 GPU-s</th><th>≈ $4.43</th></tr></table>' +
          '<p class="muted">Illustrative list prices: $2.50 per H100-hour; $3 / M input, $0.30 / M cached input, $15 / M output tokens.</p>' +
          '<div class="eq">admit(v) ⇔ spent + reserved + ĉ<sub>v</sub><sup>p90</sup> ≤ cap</div>' +
          '<ul><li><b>Estimator</b>: ĉ(GPU-s) ≈ f(model, resolution, frames, steps) fitted on history; reserve the p90, commit actuals, refund the rest.</li>' +
          '<li><b>Degrade, don\'t fail</b>: near the cap, switch to draft resolution, a step-distilled student (50 → 4–8 steps), or skip best-of-n.</li>' +
          '<li><b>Attribution</b>: every charge carries <code>(tenant, job, task, span_id)</code> so cost shows up in traces, not just invoices.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var O = S.bill = ctx.group();
          ctx.rect(300, 188, 1090, 410, { rx: 14, fill: 'rgba(5,10,22,0.96)', stroke: 'magenta', parent: O, glow: true });
          ctx.text(330, 216, 'THE BILL · one 30 s trailer', { size: 17, font: 'display', weight: 700, color: 'white', parent: O });
          S.total = ctx.text(1366, 218, '$0.00', { size: 24, font: 'mono', weight: 700, color: 'magenta', anchor: 'end', parent: O });
          ctx.text(1250, 218, '212k tok · 5,520 GPU-s', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: O });
          var rows = [['LLM · all agents', 0.59, 'amber', '212k tokens'], ['refs + keyframes', 0.04, 'violet', '60 GPU-s'], ['voice + music', 0.06, 'orange', '80 GPU-s'],
            ['shots v1 ×6', 3.17, 'lime', '4,560 GPU-s'], ['shot 3 v2', 0.53, 'red', '760 GPU-s'], ['edit + encode', 0.04, 'cyan', '60 GPU-s']];
          var sc = 560 / 3.17;
          var anims = [];
          rows.forEach(function (r, i) {
            var y = 262 + i * 38;
            ctx.text(540, y, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: O });
            ctx.rect(555, y - 12, 560, 24, { rx: 4, fill: 'rgba(255,255,255,0.025)', parent: O });
            var b = ctx.rect(555, y - 12, 0, 24, { rx: 4, fill: ctx.alpha(r[2], 0.55), stroke: r[2], sw: 1, parent: O });
            var w = Math.max(3, r[1] * sc);
            anims.push(ctx.animate(b, { width: [0, w] }, 700, 'out', 300 + i * 150));
            var t = ctx.text(555 + w + 10, y, '$' + r[1].toFixed(2) + '  ' + r[3], { size: 12, font: 'mono', color: r[2], parent: O });
            if (555 + w + 10 > 1000) { t.setAttribute('x', 555 + w - 10); t.setAttribute('text-anchor', 'end'); t.setAttribute('fill', ctx.C.white); }
            ctx.reveal(t, { delay: 800 + i * 150 });
          });
          /* reservation lifecycle */
          var steps = [['estimate ĉ (p90)', 'violet'], ['reserve', 'white'], ['run', 'magenta'], ['commit actual', 'lime'], ['refund ĉ − c', 'teal']];
          var xs = [400, 548, 660, 780, 925];
          steps.forEach(function (s, i) {
            ctx.label(xs[i], 518, s[0], { color: s[1], size: 12, parent: O });
            if (i < steps.length - 1) {
              var a = xs[i] + (s[0].length * 12 * 0.62 + 18) / 2 + 4, b = xs[i + 1] - (steps[i + 1][0].length * 12 * 0.62 + 18) / 2 - 4;
              ctx.line(a, 518, b, 518, { color: 'dim', sw: 1.4, arrow: true, parent: O });
            }
          });
          ctx.text(330, 566, 'admit(v) ⇔ spent + reserved + ĉᵥ ≤ cap', { size: 15, font: 'mono', color: 'white', parent: O });
          ctx.text(1366, 566, 'agent thinking ≈ 13% of the bill', { size: 13, font: 'mono', weight: 600, color: 'amber', anchor: 'end', parent: O });
          ctx.focus([O, S.gBud], 0.18);
          ctx.reveal(O, { from: 'scale', s0: 0.94, dur: 500 });
          ctx.pulse(S.gBud.firstChild, { color: 'magenta', times: 2, dur: 700 });
          ctx.hud('bill ≈ $4.43 · GPUs 87%');
          return Promise.all(anims.concat([ctx.counter(S.total, 0, 4.43, 1600, function (v) { return '$' + v.toFixed(2); })])).then(function () { return ctx.wait(1500); });
        }
      },
      /* 9 ---------------------------------------------------------------- */
      {
        title: 'Zoom deeper',
        say: 'That is the orchestration plane: a planner that writes graphs, an engine that executes them durably, workers that run agent loops, tools exposed through a common protocol, events that make everything observable, and a budget that keeps it honest. Four chambers go deeper from here. The agent loop, where a language model becomes an agent. Tool calling and the Model Context Protocol. Multi-agent collaboration inside the crew. And durable execution, which guarantees the film survives crashes. Click any of them to zoom in.',
        deep: '<p>Invariants the orchestration plane maintains:</p>' +
          '<ol><li><b>Plans are data</b>: versioned DAGs (v1, v2 …) validated before execution; replanning is a patch, never a restart.</li>' +
          '<li><b>Exactly-once effects</b> from at-least-once delivery: durable history + idempotency keys.</li>' +
          '<li><b>Artifacts by reference</b>, content-addressed; contexts carry URIs and summaries, not media.</li>' +
          '<li><b>Everything is an event</b>: state, progress, traces and billing are projections of one log.</li>' +
          '<li><b>Money is admitted, not discovered</b>: reserve → commit → refund.</li></ol>' +
          '<p>Go deeper:</p><ul>' +
          '<li><b>The Agent Loop</b>: how sampling, tool calls and context management turn an LLM into an agent.</li>' +
          '<li><b>Tool Calling &amp; MCP</b>: JSON Schema, constrained decoding, JSON-RPC, sandboxes.</li>' +
          '<li><b>Multi-Agent Collaboration</b>: supervisor vs handoff vs blackboard; context isolation.</li>' +
          '<li><b>Durable Execution</b>: event sourcing, deterministic replay, sagas, GPU-job checkpoints.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          [S.bill, S.cp].forEach(function (g) {
            ctx.fade(g, 0, 400).then(function () { if (g.parentNode) g.parentNode.removeChild(g); });
          });
          ctx.focus(null);
          var targets = [[S.workers, 'agent loop'], [S.tools, 'tool calling · MCP'], [S.crew, 'multi-agent'], [S.eng, 'durable execution']];
          S.tagsZ = ctx.group();
          targets.forEach(function (t) {
            var b = t[0].box;
            var lb = ctx.label(b.cx, b.t - 18, '⤢ ' + t[1], { color: 'magenta', size: 12, parent: S.tagsZ, bgAlpha: 0.25 });
            lb.style.pointerEvents = 'none';
          });
          ctx.reveal(S.tagsZ, { delay: 400 });
          return targets.reduce(function (p, t) {
            return p.then(function () { return ctx.pulse(t[0], { color: 'magenta', dur: 700 }); });
          }, ctx.wait(500));
        }
      }
    ]
  });
})();
