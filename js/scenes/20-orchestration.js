/* L1 — AI Orchestration Plane. Planner writes a task DAG; a durable engine, queue and agent workers execute it
 * with events, a human checkpoint, critic-driven replanning and budget accounting. Beat-by-beat. */
(function () {
  var DX = { refs: 355, script: 500, board: 645, gate: 775, shot: 910, edit: 1080, critic: 1235 };
  var CY = 385;
  var SHOT_Y = [245, 301, 357, 413, 469, 525];
  var CAPS = [400000, 7200, 10];
  var TOK_RATE = 2.8e-6;           /* blended $/token: 212k tok -> $0.59 (see step 8) */
  var GPU_RATE = 2.5 / 3600;       /* $/GPU-second at $2.50 per H100-hour */

  /* small text in mid-luminance hues (magenta, violet, red, blue, pink) turns pale in the light theme, which inverts
   * luminance; a lighter tint in the dark theme becomes a deeper, readable tone there */
  function lite(ctx, c) {
    return { magenta: 1, violet: 1, red: 1, blue: 1, pink: 1 }[c] ? ctx.mix(c, 'white', 0.4) : ctx.color(c);
  }

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
    ctx.text(x0 + 44, y0 + 36, sub, { size: 11, font: 'mono', color: lite(ctx, color), parent: n });
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

  function buildBudget(ctx, S) {
    S.bud = { tok: 0, gpu: 0, res: 0 };
    ctx.rect(1405, 180, 165, 405, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha('magenta', 0.5), parent: S.gBud });
    ctx.text(1420, 203, 'BUDGET', { size: 14, font: 'display', weight: 700, color: lite(ctx, 'magenta'), parent: S.gBud });
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

  /* engine -> queue: one ready task is enqueued */
  function toQueue(ctx, S, label, delay) {
    return ctx.wait(delay || 0).then(function () {
      setQ(ctx, S, S.qn + 1);
      return ctx.packet(S.lEQ, { color: 'magenta', dur: 350, label: label });
    });
  }

  /* queue -> worker lease -> tools -> fleet; resolves when the task's progress bar is full */
  function toWorker(ctx, S, n, slot, label, ms, delay) {
    return ctx.wait(delay || 0).then(function () {
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
    });
  }

  function dispatch(ctx, S, n, slot, label, ms, delay) {
    return toQueue(ctx, S, label, delay).then(function () { return toWorker(ctx, S, n, slot, label, ms); });
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
        beats: [
          {
            say: 'Zoom into the orchestration plane, the control brain of the system. It never renders a pixel itself. Instead it decides what must happen, in what order, and on whose budget, and makes sure it actually happens.',
            card: { tag: 'KEY IDEA', title: 'Control plane, not data plane', body: 'Small messages, strong consistency, modest compute. The GPUs that move the pixels live on the other side, and each side scales, fails and is priced on its own.' },
            deep: '<p>The orchestration plane is a <b>control plane</b>: small messages, strong consistency, modest compute. The <b>data plane</b> (encoders, diffusion transformers, codecs) moves gigabytes and burns GPU-hours. Separating them lets each scale, fail and be priced independently.</p>' +
              '<p>It is the same split Kubernetes makes: controllers reconcile desired state held in the API server, while kubelets and accelerators do the work. A task message is roughly 10<sup>3</sup> bytes; the media it triggers is 10<sup>7</sup> bytes or more.</p>' +
              '<div class="note">Design rule: LLMs make <i>decisions</i>; deterministic code owns <i>side effects</i>, retries and accounting.</div>' +
              '<details><summary>Go deeper</summary><p>A control plane is a <b>reconciliation loop</b>: observe actual state, diff it against desired state, act, repeat. Because it is <i>level-triggered</i> (it reads the state, not a stream of edge events), a missed event or a restarted controller only delays convergence. The workflow engine below applies the same idea to a task graph: desired state is the DAG, actual state is the event history, and the diff is the set of ready tasks.</p></details>'
          },
          {
            say: 'On the left, a planner agent turns intent into a plan, and a crew of specialist agents will carry it out.',
            card: { tag: 'HOW IT WORKS', title: 'A director and its crew', body: 'The director plans and delegates. Writer, storyboard, camera, editor and critic each own one narrow, typed job, so each can be evaluated and cost-capped alone.' },
            deep: '<table><tr><th>Component</th><th>Job</th><th>Typical tech</th></tr>' +
              '<tr><td>Planner</td><td>intent → task DAG</td><td>frontier reasoning LLM + JSON Schema</td></tr>' +
              '<tr><td>Agent crew</td><td>one narrow role per task</td><td>LLM + role prompt + a small tool set</td></tr></table>' +
              '<p>Narrow agents are easier to evaluate and to bound in cost, and each starts from a clean context window. Anthropic reports that a lead agent delegating to parallel sub-agents beat a single agent by about 90% on its internal research eval, at roughly 15× the tokens of a chat.</p>' +
              '<details><summary>Go deeper</summary><p>The six roles on stage are the long-lived crew; the plan can also name utility workers such as a vision worker (reference analysis) or an audio worker (voice and music). What matters is the contract: each role is a <b>(system prompt, tool subset, output schema, budget)</b> tuple, so swapping the model behind one role never changes the graph.</p></details>'
          },
          {
            say: 'Along the bottom runs the machinery. A durable workflow engine decides which tasks are ready, a task queue hands them out, and a pool of stateless agent runtime workers runs one agent loop per task.',
            card: { tag: 'HOW IT WORKS', title: 'Engine, queue, workers', body: 'Scheduling is decoupled from execution. The engine emits ready tasks, workers lease them, and any worker pod can die without losing the job.' },
            deep: '<table><tr><th>Component</th><th>Job</th><th>Typical tech</th></tr>' +
              '<tr><td>Workflow engine</td><td>durable execution of the DAG</td><td>Temporal, Restate, Step Functions, Inngest</td></tr>' +
              '<tr><td>Task queue</td><td>decouple scheduling from execution; leases, priorities</td><td>Temporal task queues, SQS, Redis Streams</td></tr>' +
              '<tr><td>Agent runtime</td><td>runs one agent loop per task</td><td>stateless, autoscaled workers</td></tr></table>' +
              '<p>Stateless workers autoscale on queue depth. Little\'s law sizes the pool: tasks in flight equal arrival rate times mean task duration.</p>' +
              '<div class="eq">L = λ · W</div>'
          },
          {
            say: 'Workers reach the world through a tool registry built on the Model Context Protocol, and the tools call the model fleet, the GPU pools of the data plane. Watch one task travel the whole chain.',
            card: { tag: 'TRY IT', title: 'Click any ringed component', body: 'Dashed rings mark components with their own chamber: the workflow engine, the agent runtime, the tool registry and the agent crew.' },
            deep: '<table><tr><th>Component</th><th>Job</th><th>Typical tech</th></tr>' +
              '<tr><td>Tool registry</td><td>typed tools, discovery, auth</td><td>MCP servers</td></tr>' +
              '<tr><td>Model fleet</td><td>LLM, VLM, DiT, TTS endpoints</td><td>vLLM / SGLang, custom DiT serving</td></tr></table>' +
              '<p>One task crosses four typed boundaries: enqueue, lease, <code>tool_use</code> to an MCP <code>tools/call</code>, and an RPC into a model endpoint. Each hop can be authorised, traced, rate limited and retried like any other RPC.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.gArch = ctx.group();
          S.gDag = ctx.group();
          S.gBus = ctx.group();
          S.gBud = ctx.group();

          /* beat 0: control plane versus data plane */
          S.ghost = ctx.group();
          ctx.rect(24, 196, 1204, 540, { rx: 16, fill: ctx.alpha('magenta', 0.025), stroke: ctx.alpha('magenta', 0.4), dash: '6 8', parent: S.ghost });
          ctx.rect(1244, 196, 332, 540, { rx: 16, fill: ctx.alpha('red', 0.025), stroke: ctx.alpha('red', 0.4), dash: '6 8', parent: S.ghost });
          ctx.text(626, 240, 'CONTROL PLANE', { size: 20, font: 'display', weight: 700, color: lite(ctx, 'magenta'), anchor: 'middle', spacing: 2, parent: S.ghost });
          ctx.text(626, 267, 'decides · orders · budgets', { size: 13, color: 'dim', anchor: 'middle', parent: S.ghost });
          ctx.text(1410, 240, 'DATA PLANE', { size: 20, font: 'display', weight: 700, color: lite(ctx, 'red'), anchor: 'middle', spacing: 2, parent: S.ghost });
          ctx.text(1410, 267, 'moves the pixels', { size: 13, color: 'dim', anchor: 'middle', parent: S.ghost });
          ctx.text(626, 400, 'PLAN · a task DAG is written here for every request', { size: 15, font: 'mono', color: 'dim', anchor: 'middle', parent: S.ghost });
          ctx.text(626, 428, 'small messages · strong consistency · modest compute', { size: 12, font: 'mono', color: 'faint', anchor: 'middle', parent: S.ghost });
          ctx.text(1410, 400, 'tensors · frames · GPU-hours', { size: 12, font: 'mono', color: 'faint', anchor: 'middle', parent: S.ghost });
          return ctx.reveal(S.ghost, { from: 'scale', s0: 0.96, dur: 700 }).then(function () {
            return ctx.pulse(S.ghost, { color: 'magenta', dur: 800 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the planner and the crew */
            S.planner = ctx.node({ x: 150, y: 250, w: 220, h: 76, title: 'Planner', sub: 'director agent', icon: 'brain', color: 'magenta', titleSize: 17, parent: S.gArch });
            S.crew = ctx.node({ x: 150, y: 455, w: 220, h: 170, kind: 'ghost', color: 'magenta', parent: S.gArch });
            ctx.text(150, 388, 'AGENT CREW', { size: 12, font: 'mono', color: lite(ctx, 'magenta'), anchor: 'middle', weight: 600, parent: S.crew, spacing: 2 });
            S.planner.subEl.setAttribute('fill', lite(ctx, 'magenta'));
            S.roles = ['Director', 'Writer', 'Storyboard', 'Camera', 'Editor', 'Critic'].map(function (r, i) {
              return ctx.node({ x: 97 + (i % 2) * 106, y: 420 + Math.floor(i / 2) * 40, w: 98, h: 28, kind: 'pill', title: r, titleSize: 12, color: 'magenta', glow: false, parent: S.crew });
            });
            ctx.hotspot(S.crew, 'multi-agent', { hint: 'CREW ⤢' });
            return Promise.all([ctx.reveal(S.planner, { from: 'left' }), ctx.reveal(S.crew, { from: 'left', delay: 200 })]).then(function () {
              return ctx.pulse(S.planner, { color: 'magenta', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: engine, queue, agent runtime */
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
            S.lEQ = ctx.link(S.eng, S.queue, { color: 'magenta', straight: true, parent: S.gArch });
            S.lQW = ctx.link(S.queue, S.workers, { color: 'magenta', straight: true, parent: S.gArch });
            ctx.hotspot(S.eng, 'durable-exec');
            ctx.hotspot(S.workers, 'agent-loop');
            return Promise.all([
              ctx.reveal([S.eng, S.queue, S.workers], { from: 'up', stagger: 140 }),
              ctx.reveal([S.lEQ, S.lQW], { from: 'draw', delay: 600, stagger: 140 })
            ]).then(function () {
              return ctx.packet(S.lEQ, { color: 'magenta', dur: 450, label: 'task' });
            }).then(function () {
              return ctx.packet(S.lQW, { color: 'magenta', dur: 450, label: 'lease' });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: tool registry and model fleet, then a task travels the chain */
            S.tools = comp(ctx, S.gArch, 1075, 660, 240, 90, 'magenta', 'tool', 'Tool Registry', 'MCP servers · schemas');
            ctx.text(975, 690, 'gen_video · tts · search · edl', { size: 11, font: 'mono', color: 'dim', parent: S.tools });
            S.fleet = comp(ctx, S.gArch, 1395, 660, 270, 90, 'red', 'gpu', 'Model Fleet', 'GPU pools (data plane)');
            [['LLM', 'amber'], ['VLM', 'violet'], ['DiT', 'lime'], ['TTS', 'orange']].forEach(function (p, k) {
              ctx.label(1304 + k * 56, 687, p[0], { color: p[1], size: 11, w: 46, parent: S.fleet });
            });
            S.lWT = ctx.link(S.workers, S.tools, { color: 'amber', straight: true, parent: S.gArch });
            S.lTF = ctx.link(S.tools, S.fleet, { color: 'red', straight: true, parent: S.gArch });
            ctx.hotspot(S.tools, 'tool-calling');
            return Promise.all([
              ctx.reveal([S.tools, S.fleet], { from: 'up', stagger: 140 }),
              ctx.reveal([S.lWT, S.lTF], { from: 'draw', delay: 500, stagger: 140 })
            ]).then(function () {
              return ctx.packet(S.lWT, { color: 'amber', dur: 450, label: 'tool_use' });
            }).then(function () {
              return ctx.packet(S.lTF, { color: 'red', dur: 450, label: 'RPC' });
            });
          });
        }
      },
      /* 2 ---------------------------------------------------------------- */
      {
        title: 'Intent to plan',
        beats: [
          {
            say: 'The creator\'s request arrives as intent plus references: a short prompt, three sketches and a voice memo. The planner, a strong reasoning model acting as the director, does not start rendering.',
            card: { tag: 'KEY IDEA', title: 'Plan first, render later', body: 'The director\'s first output is a plan, not a pixel. Deferring action lets cost, order and parallelism be inspected before any GPU is booked.' },
            deep: '<p>Planning maps an underspecified goal to a graph <code>G = (V, E)</code>. Each vertex carries <code>{agent, inputs, output_schema, est_cost}</code>; edges are <b>artifact dependencies</b>, not chat messages.</p>' +
              '<p>Planner input: the request, encoder summaries of the references, the tool catalogue, budget caps and past plans as templates. Output: one JSON document, cheap to produce (about 14k tokens here) compared with the GPU work it controls.</p>'
          },
          {
            say: 'It writes a plan: a typed JSON document, constrained by a schema, that lists the tasks, the agent that owns each one, and their dependencies.',
            card: { tag: 'NUMBERS', title: 'Cost of a plan', stat: { v: '≈ 14k', u: 'tokens', l: 'to plan the whole trailer, charged to the budget ledger' } },
            deep: '<p>The plan is produced with <b>schema-constrained decoding</b>, so it always parses. What constraints cannot guarantee is <i>semantic</i> validity: a task whose dependency does not exist, or an agent that lacks the tool it needs. That is the validator\'s job.</p>' +
              '<p><code>deps</code> are artifact dependencies (a task consumes another task\'s output). <code>agent</code> selects a role prompt plus a tool subset, which bounds what that task can ever do.</p>' +
              '<div class="note">Free-form chat between agents is replaced by a typed, diffable, costable document.</div>'
          },
          {
            say: 'The engine then validates the plan: schema, acyclicity, tool availability and budget. Any violation goes back to the planner as a repair turn.',
            card: { tag: 'HOW IT WORKS', title: 'Validate before you spend', body: 'Four cheap checks run before any GPU is touched. A failed check becomes a repair prompt for the planner, not a crashed job.', more: '<p>Kahn\'s algorithm repeatedly removes vertices of in-degree zero. If fewer than |V| vertices are removed, the rest contain a cycle, and their names go into the repair prompt.</p>' },
            deep: '<ul><li><b>Schema</b>: every field present, types and enums correct.</li><li><b>Acyclicity</b>: Kahn topological sort, O(|V|+|E|).</li><li><b>Tools</b>: every referenced agent and tool exists and is permitted for this tenant.</li><li><b>Budget</b>: the summed p90 cost estimate fits under the job cap.</li></ul>' +
              '<p>Repair loops are bounded (two or three attempts) and carry the validator\'s exact error text, so the planner fixes the defect instead of regenerating from scratch.</p>'
          },
          {
            say: 'Compiled, the plan becomes a directed acyclic graph: analyze the references, write the script, storyboard it, wait for approval, fan out six shots in parallel while voice and music are produced, then edit and critique.',
            card: { tag: 'NUMBERS', title: 'Plan v1', stat: { v: '13', u: 'tasks', l: 'six shots and the audio branch run side by side' } },
            deep: '<div class="eq">ready(v) ⇔ ∀ (u,v) ∈ E : state(u) = done</div>' +
              '<ul><li><b>Explicit parallelism</b>: the width of the DAG (6 shots + audio) is visible to the scheduler. LLMCompiler-style planners cut latency by issuing independent calls concurrently instead of one ReAct step at a time (reported up to 3.7× faster).</li>' +
              '<li><b>Estimates before spending</b>: T ≥ Σ<sub>v∈critical path</sub> t<sub>v</sub> and cost = Σ<sub>v∈V</sub> ĉ<sub>v</sub> are computable before a single GPU is booked.</li>' +
              '<li><b>Lineage</b>: the plan-then-dispatch shape follows HuggingGPT (Shen et al., 2023), where an LLM parses a request into tasks, selects expert models and runs them.</li></ul>' +
              '<div class="note">The plan is <i>dynamic</i>: the critic can add nodes later, so the orchestrator re-plans, it does not merely execute.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: the request reaches the planner */
          ctx.fadeOut(S.ghost, 400, true);
          S.intent = ctx.label(150, 180, 'intent + 3 sketches + memo', { color: 'cyan', size: 11 });
          S.lIn = ctx.link({ x: 150, y: 192 }, S.planner, { color: 'cyan', straight: true, to: 't' });
          return Promise.all([ctx.reveal(S.intent, { from: 'down' }), ctx.reveal(S.lIn, { from: 'draw', delay: 200 })]).then(function () {
            return ctx.packet(S.lIn, { color: 'cyan', dur: 500 });
          }).then(function () {
            return ctx.pulse(S.planner, { color: 'magenta', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the plan is written as schema-constrained JSON */
            S.planLines = [
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
            ];
            S.plan = ctx.code({ x: 300, y: 212, w: 640, title: 'plan.json  (schema-constrained)', lang: 'json', typing: true, size: 13, color: 'magenta', lines: S.planLines });
            ctx.reveal(S.plan, { from: 'up', dur: 400 });
            buildBudget(ctx, S);
            ctx.reveal(S.gBud, { from: 'right', delay: 200 });
            return Promise.all([S.plan.typeAll(), setBudget(ctx, S, { tok: 14000 }, 2500)]).then(function () {
              ledger(ctx, S, '+14k tok planner', 'amber');
              return ctx.wait(300);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the engine validates the plan */
            S.valid = ctx.group();
            var chk = ['✓ schema', '✓ acyclic (Kahn)', '✓ tools exist', '✓ within budget'];
            var cx = 330;
            var chips = chk.map(function (s) {
              var w = s.length * 12 * 0.62 + 20;
              var c = ctx.label(cx + w / 2, 190, s, { color: 'lime', size: 12, w: w, parent: S.valid, opacity: 0 });
              cx += w + 10;
              return c;
            });
            S.lPlan = ctx.path('M40,262 C4,262 4,660 50,660', { color: ctx.alpha('magenta', 0.7), sw: 1.6, arrow: true, dash: '4 5', parent: S.gArch });
            S.lPlan.len = S.lPlan.getTotalLength();
            setEng(S, 'validating plan v1');
            return ctx.reveal(S.lPlan, { from: 'draw', dur: 500 }).then(function () {
              return ctx.packet(S.lPlan, { color: 'magenta', dur: 900, label: 'plan v1' });
            }).then(function () {
              return ctx.reveal(chips, { from: 'down', stagger: 260, dur: 350 });
            }).then(function () {
              setEng(S, 'plan v1 accepted');
              return ctx.pulse(S.eng, { color: 'lime', dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the plan is compiled into a DAG, wave by wave */
            ctx.fadeOut(S.plan, 450, true);
            ctx.fadeOut(S.valid, 450, true);
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
            return Promise.all(all).then(function () {
              return ctx.pulse(S.eng, { color: 'magenta', dur: 600 });
            });
          });
        }
      },
      /* 3 ---------------------------------------------------------------- */
      {
        title: 'Workflows vs agents',
        beats: [
          {
            say: 'There are two ways to wire language models into software. In a workflow, code owns the control flow: models fill in steps along predefined paths, like chaining, routing or parallel sections.',
            card: { tag: 'KEY IDEA', title: 'Workflow: code owns the path', body: 'Models fill in steps along a predefined route. Control flow is ordinary code: testable, cheap, and predictable down to the token.' },
            deep: '<p>Anthropic\'s taxonomy (<i>Building Effective Agents</i>, 2024): <b>workflows</b> orchestrate LLMs and tools through predefined code paths; <b>agents</b> dynamically direct their own processes and tool usage. The five workflow patterns and where this system uses them:</p>' +
              '<table><tr><th>Pattern</th><th>Who decides</th><th>Here</th></tr>' +
              '<tr><td>Prompt chaining</td><td>code</td><td>script → shot prompts</td></tr>' +
              '<tr><td>Routing</td><td>code + classifier</td><td>pick video model per shot type</td></tr>' +
              '<tr><td>Parallelization</td><td>code</td><td>6 shots; best-of-n seeds</td></tr>' +
              '<tr><td>Orchestrator–workers</td><td>LLM plans, code runs</td><td>planner → DAG → workers</td></tr>' +
              '<tr><td>Evaluator–optimizer</td><td>LLM loop</td><td>critic ↔ re-render</td></tr></table>'
          },
          {
            say: 'In an agent, the model owns the control flow: it picks the next action from what it observes, until it judges the task done.',
            card: { tag: 'KEY IDEA', title: 'Agent: the model owns the path', body: 'The model chooses each next action from what it observes, for an unknown number of steps. That power needs stop conditions, turn caps and budgets.' },
            deep: '<p>An agent is an LLM in a loop with tools: <code>action = π(context)</code>, <code>observation = env(action)</code>, append, repeat. The number of iterations is not known in advance, so the harness must own the things the model cannot be trusted to enforce: turn limits, token and dollar budgets, wall-clock timeouts, sandboxes.</p>' +
              '<table><tr><th>Pattern</th><th>Who decides</th><th>Here</th></tr><tr><td>Autonomous agent</td><td>LLM</td><td>inside each leaf task</td></tr></table>' +
              '<p>The loop itself is the subject of the next chamber down: <i>The Agent Loop</i>.</p>'
          },
          {
            say: 'Workflows are predictable, cheap and testable. Agents handle open ended problems, but they cost more and fail in stranger ways.',
            card: { tag: 'NUMBERS', title: 'Why autonomy decays', stat: { v: '0.36', l: 'chance a 20-step chain succeeds when every step is 95 percent reliable' }, more: '<p>Derivation: P = p<sup>n</sup> = exp(n ln p) = exp(20 × ln 0.95) = exp(−1.026) ≈ 0.358. Halving the per-step failure rate to 2.5% lifts it to 0.60; that is why shorter agentic stretches with a verifier between them beat one long autonomous run.</p>' },
            deep: '<p>If each dependent step succeeds independently with probability p, an n-step chain succeeds with p<sup>n</sup>:</p>' +
              '<div class="eq">0.95<sup>20</sup> ≈ 0.36 &nbsp;&nbsp; 0.99<sup>20</sup> ≈ 0.82</div>' +
              '<p>Long autonomous chains compound errors. Checkpoints, validators and retries between short agentic stretches reset that decay: each stretch only has to be reliable for a few steps. The cost side is just as blunt: Anthropic measured agents at about 4× the tokens of a chat, and multi-agent systems at about 15×.</p>'
          },
          {
            say: 'Production systems blend them: an agentic planner writes the graph, a deterministic engine runs it, and agents work inside the leaves.',
            card: { tag: 'TRADE-OFF', title: 'Autonomy only where needed', body: 'Agentic planner, deterministic engine, agentic leaves. Add autonomy where the path cannot be known in advance, and pay for it with evals and budgets.' },
            deep: '<p>This system sits in the middle of the spectrum: the planner is agentic (it decides the graph), the workflow engine is deterministic (it decides <i>nothing</i>, it executes and records), and each leaf task runs a bounded agent loop.</p>' +
              '<div class="note">Rule of thumb: add autonomy only where the path cannot be known in advance, and pay for it with evals and budgets.</div>' +
              '<p>The critic-to-planner back-edge (step 7) is the one place where the graph itself is allowed to change at run time.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var O = S.ov = ctx.group();
          ctx.rect(300, 188, 1090, 440, { rx: 14, fill: 'rgba(5,10,22,0.96)', stroke: 'magenta', parent: O, glow: true });
          ctx.text(330, 216, 'WHO OWNS THE CONTROL FLOW?', { size: 17, font: 'display', weight: 700, color: 'white', parent: O });
          ctx.text(1368, 216, 'after Anthropic, Building Effective Agents (2024)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: O });
          ctx.line(855, 245, 855, 470, { color: 'line', parent: O });
          ctx.focus([O], 0.18);
          /* beat 0: the workflow side (code owns the path) */
          var wg = ctx.group({ parent: O, opacity: 0 });
          ctx.text(330, 258, 'WORKFLOW · code owns the path', { size: 13, font: 'mono', weight: 600, color: 'cyan', parent: wg });
          var wf = [['LLM', 'script', 405], ['check', 'code', 520], ['LLM', 'prompts', 635], ['DiT', 'render', 750]];
          var wn = wf.map(function (d, i) {
            return ctx.node({ x: d[2], y: 322, w: 92, h: 44, title: d[0], sub: d[1], titleSize: 13, subSize: 11, color: i === 1 ? 'teal' : (i === 3 ? 'lime' : 'cyan'), kind: i === 1 ? 'hex' : 'box', glow: false, parent: wg });
          });
          var wl = [];
          for (var i = 0; i < 3; i++) wl.push(ctx.link(wn[i], wn[i + 1], { color: 'cyan', straight: true, parent: wg }));
          var retry = ctx.path('M520,344 C520,392 405,392 405,346', { color: ctx.alpha('teal', 0.8), sw: 1.4, dash: '4 4', arrow: true, parent: wg });
          ctx.text(462, 398, 'fixed retry', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: wg });
          var chips = [['prompt chaining', 385], ['routing', 504], ['parallelization', 616], ['orchestrator-workers', 435, 452], ['evaluator-optimizer', 640, 452]].map(function (c) {
            return ctx.label(c[1], c[2] || 426, c[0], { color: 'cyan', size: 11, parent: wg, opacity: 0 });
          });
          return ctx.reveal(O, { from: 'scale', s0: 0.94, dur: 500 }).then(function () {
            return ctx.reveal(wg, { from: 'left', dur: 500 });
          }).then(function () {
            return wl.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'cyan', dur: 450 }); }); }, Promise.resolve());
          }).then(function () {
            return Promise.all([ctx.packet(retry, { color: 'teal', dur: 600 }), ctx.reveal(chips, { from: 'up', stagger: 100 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the agent side (the model owns the path) */
            var ag = ctx.group({ parent: O });
            ctx.text(880, 258, 'AGENT · the model owns the path', { size: 13, font: 'mono', weight: 600, color: lite(ctx, 'magenta'), parent: ag });
            ctx.node({ x: 945, y: 335, w: 110, h: 46, title: 'LLM', sub: 'policy', icon: 'brain', color: 'amber', titleSize: 14, subSize: 11, glow: false, parent: ag });
            ctx.node({ x: 1275, y: 335, w: 140, h: 46, title: 'Tools', sub: 'environment', icon: 'tool', color: 'teal', titleSize: 14, subSize: 11, glow: false, parent: ag });
            var top = ctx.path('M1000,318 C1060,272 1150,272 1205,318', { color: 'magenta', sw: 1.8, arrow: true, parent: ag });
            var bot = ctx.path('M1205,352 C1150,398 1060,398 1000,352', { color: 'teal', sw: 1.8, arrow: true, parent: ag });
            ctx.text(1102, 322, 'action: tool_use', { size: 11, font: 'mono', color: lite(ctx, 'magenta'), anchor: 'middle', parent: ag });
            ctx.text(1102, 347, 'observation: tool_result', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: ag });
            ctx.para(880, 430, ['model chooses the next action · unknown number of steps', 'needs stop conditions, turn caps, budgets, sandboxes'], { size: 12, color: 'text', font: 'mono', lh: 18, parent: ag });
            var dot = ctx.circle(0, 0, 5, { fill: 'amber', glow: true, parent: ag });
            var tl = top.getTotalLength(), bl = bot.getTotalLength();
            S.ovLoop = ctx.loop(function (t) {
              var f = (t / 2.2) % 1, p;
              p = f < 0.5 ? top.getPointAtLength(tl * f * 2) : bot.getPointAtLength(bl * (f * 2 - 1));
              dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
            });
            return ctx.reveal(ag, { from: 'right', dur: 500 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the spectrum from predictable to flexible */
            var sp = ctx.group({ parent: O });
            var x0 = 340, W = 1010;
            for (var k = 0; k < 40; k++) ctx.rect(x0 + k * W / 40, 524, W / 40 + 0.5, 14, { rx: 0, fill: ctx.mix('cyan', 'magenta', k / 39), opacity: 0.75, parent: sp });
            ctx.text(x0, 504, 'predictable · cheap · testable', { size: 11, font: 'mono', weight: 600, color: 'cyan', parent: sp });
            ctx.text(x0 + W, 504, 'flexible · open-ended · costly', { size: 11, font: 'mono', weight: 600, color: lite(ctx, 'magenta'), anchor: 'end', parent: sp });
            [['prompt chaining', 0.06], ['routing', 0.18], ['parallelization', 0.30], ['orchestrator-workers', 0.52], ['evaluator-optimizer', 0.66], ['autonomous agent', 0.92]].forEach(function (m, j) {
              var x = x0 + W * m[1];
              ctx.line(x, 520, x, 542, { color: 'white', sw: 1.2, parent: sp });
              ctx.text(x, j % 2 ? 574 : 556, m[0], { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: sp });
            });
            /* the price of autonomy: errors compound along a chain of dependent steps */
            var rel = ctx.label(1150, 480,'20 steps at 95% each: 0.95^20 = 0.36 end to end', { color: 'red', size: 11, parent: sp });
            return ctx.reveal(sp, { from: 'up', dur: 700 }).then(function () {
              return ctx.pulse(rel, { color: 'red', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: where this system sits */
            S.sysMark = ctx.group({ parent: O });
            ctx.path('M845,587 V593 H1067 V587', { color: 'amber', sw: 2, parent: S.sysMark });
            ctx.text(956, 611, 'THIS SYSTEM: agentic planner · durable engine · agentic leaves', { size: 11, font: 'mono', weight: 600, color: 'amber', anchor: 'middle', parent: S.sysMark });
            return ctx.reveal(S.sysMark, { from: 'down', dur: 600 }).then(function () {
              return ctx.pulse(S.sysMark, { color: 'amber', times: 2, dur: 700 });
            });
          });
        }
      },
      /* 4 ---------------------------------------------------------------- */
      {
        title: 'Dispatch & events',
        beats: [
          {
            say: 'Execution begins. The workflow engine finds the tasks whose dependencies are satisfied and puts them on a task queue.',
            card: { tag: 'HOW IT WORKS', title: 'Ready tasks, not scripts', body: 'A task is enqueued the moment all of its predecessors are done. Priority follows slack, so critical-path tasks jump the queue.' },
            deep: '<p>The engine is an event-driven scheduler over the dependency graph:</p>' +
              '<pre>on task_done(u):\n  log.append(event)  # durable\n  for v in succ(u):\n    if ready(v):\n      budget.reserve(v.est_cost)\n      queue.put(v, prio=slack(v))</pre>' +
              '<p>Priority by <b>slack</b> (latest start minus earliest start; lowest first) runs critical-path tasks first: a task with zero slack delays the whole film if it waits.</p>' +
              '<details><summary>Go deeper</summary><p>Critical path method: earliest start ES(v) = max<sub>u∈pred(v)</sub> EF(u), with EF = ES + t. Backward pass: latest finish LF(v) = min<sub>w∈succ(v)</sub> LS(w), LS = LF − t. Then slack(v) = LS(v) − ES(v), and the critical path is exactly the set of zero-slack tasks. Estimates t are refreshed from completed tasks, so the priorities drift with reality: a slow storyboard makes the audio branch <i>less</i> urgent.</p></details>'
          },
          {
            say: 'A stateless agent worker leases a task, runs its agent loop, and calls tools through the registry, which in turn calls the model fleet.',
            card: { tag: 'KEY IDEA', title: 'Workers lease, never own', body: 'A lease with heartbeats means a dead pod costs one retry, not a lost job. Workers hold no state the engine cannot rebuild.', more: '<p>Delivery is at-least-once, so a task can run twice after a timeout. Idempotency keys make the duplicate harmless: the second side effect is recognised and skipped.</p>' },
            deep: '<ul><li><b>Leases</b>: a worker holds a task with heartbeats (for example every 10 s, 30 s timeout). A dead pod means one retry, not a lost job.</li>' +
              '<li><b>At-least-once + idempotency</b>: delivery can repeat, so every side-effecting tool call carries an idempotency key <code>(job, task, attempt)</code>.</li>' +
              '<li><b>Stateless</b>: the worker rebuilds its context from the task payload and artifact URIs, so autoscaling and preemption are safe. Ray (Moritz et al., OSDI 2018) offers the same lease-and-retry contract for ML tasks and actors, with a different state model.</li></ul>'
          },
          {
            say: 'Every state change is published to an append only event bus. Consumers build the current state, stream progress to the client and charge the budget.',
            card: { tag: 'HOW IT WORKS', title: 'One log, many projections', body: 'State, progress, traces and billing are all consumers of the same append-only bus, ordered per job.', more: '<p>Ordering is per partition, not global: keying by <code>job_id</code> puts every event of a job on one partition, so its consumers see a total order while different jobs proceed in parallel. Consumers commit offsets after applying an event, so a crash replays at most the last few events; projections must therefore be idempotent.</p>' },
            deep: '<p><b>Event bus</b>: a partitioned append-only log (Kafka-like) keyed by <code>job_id</code>, giving per-job ordering. Consumers track offsets and can replay to rebuild state after a crash or to backfill a new projection.</p>' +
              '<p>Because state is a fold over the log, <code>state = reduce(apply, events)</code>, the same stream feeds the state store, the SSE progress feed to the browser, the budget ledger and OpenTelemetry spans. Kreps et al. (Kafka, 2011) built exactly this shape for log processing at LinkedIn.</p>'
          },
          {
            say: 'Outputs never travel inline. Agents pass references to immutable artifacts, so the script reaches the next task as a short content hash, not as megabytes.',
            card: { tag: 'KEY IDEA', title: 'Pass references, not pixels', body: 'Artifacts are immutable and content-addressed. A 40 MB shot costs a few dozen tokens of context, and identical inputs hit the cache.' },
            deep: '<p><b>Artifacts by reference</b>: <code>artifact://board@sha256:3b0d…</code>. Content addressing gives dedup, caching and reproducibility, and keeps megabytes of media out of LLM context.</p>' +
              '<p>The hash tags on the graph edges are these references. Because artifacts are immutable, a task result can be memoised on <code>(task, input hashes)</code>: a replan that leaves a task unchanged reuses its output for free.</p>'
          },
          {
            say: 'Notice that the audio branch starts as soon as the script exists, in parallel with the storyboard. Nobody wrote that in code; it falls out of the dependencies.',
            card: { tag: 'WHY IT MATTERS', title: 'The graph finds parallelism', body: 'Voice and music need only the script, so they run beside the storyboard. Parallelism is a property of the DAG, not of the code.' },
            deep: '<p>Two tasks with no path between them run concurrently. The wall-clock time of the graph is its critical path, not the sum of its parts:</p>' +
              '<div class="eq">T<sub>wall</sub> = max<sub>P</sub> Σ<sub>v∈P</sub> t<sub>v</sub></div>' +
              '<p>The maximum runs over all paths P through the DAG, and it is at most the plain sum Σ t<sub>v</sub> over all tasks. Here the audio branch (20 s) hides entirely behind the shots (95 s), so it adds GPU cost but no latency.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.ovLoop) S.ovLoop.stop();
          ctx.fade(S.ov, 0, 400).then(function () { if (S.ov.parentNode) S.ov.parentNode.removeChild(S.ov); });
          ctx.focus(null);
          setEng(S, 'running · ready: refs');
          /* beat 0: the first ready task goes on the queue */
          return ctx.wait(500).then(function () {
            return toQueue(ctx, S, 'refs');
          }).then(function () {
            return ctx.pulse(S.queue, { color: 'magenta', dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: a worker leases it and the call goes down the tool chain */
            return toWorker(ctx, S, S.n.refs, 0, 'refs', 900);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the event bus and its consumers */
            var B = S.gBus;
            ctx.rect(40, 740, 1520, 24, { rx: 12, fill: ctx.alpha('teal', 0.08), stroke: ctx.alpha('teal', 0.6), parent: B });
            ctx.text(56, 752, 'EVENT BUS', { size: 11, font: 'mono', weight: 700, color: 'teal', parent: B, spacing: 1.5 });
            ctx.text(1545, 752, 'append-only log · partitioned by job_id', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B });
            [175, 455, 760, 1075, 1395].forEach(function (x) { ctx.line(x, 705, x, 740, { color: ctx.alpha('teal', 0.5), sw: 1.2, dash: '3 3', parent: B }); });
            var stores = [['State Store', 'workflow + task state', 200, 'teal'], ['Artifact Store', 's3:// content-addressed', 510, 'teal'], ['Budget Ledger', 'reserve · commit', 820, 'magenta'], ['Traces', 'OpenTelemetry spans', 1130, 'pink'], ['Client stream', 'SSE progress events', 1420, 'cyan']];
            S.stores = stores.map(function (s) {
              ctx.line(s[2], 764, s[2], 807, { color: ctx.alpha(s[3], 0.5), sw: 1.2, parent: B });
              var nd = ctx.node({ x: s[2], y: 835, w: 220, h: 56, kind: 'cyl', title: s[0], sub: s[1], color: s[3], titleSize: 13, subSize: 11, glow: false, parent: B });
              if (nd.subEl) nd.subEl.setAttribute('fill', lite(ctx, s[3]));
              return nd;
            });
            var ev = function (x0, x1, str, col, store, delay) {
              return ctx.wait(delay).then(function () { return busEvent(ctx, S, x0, x1, str, col); }).then(function () {
                return ctx.pulse(S.stores[store], { color: col, dur: 500 });
              });
            };
            return ctx.reveal(B, { from: 'up', dur: 500, opacity: 1 }).then(function () {
              ledger(ctx, S, '+20k tok vision', 'amber');
              return Promise.all([
                setBudget(ctx, S, { tok: 34000, gpu: 10 }, 700),
                ev(760, 200, 'task.done:refs', 'teal', 0, 0),
                ev(760, 820, 'charge', 'magenta', 2, 350),
                ev(760, 1420, 'progress 8%', 'cyan', 4, 700)
              ]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: outputs are references (content hashes), then the script task runs */
            S.tags = ctx.group({ parent: S.gDag });
            var t1 = ctx.text(428, 350, '#9f2c', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.tags });
            setEng(S, 'running · ready: script');
            return ctx.reveal(t1, { from: 'down' }).then(function () {
              return dispatch(ctx, S, S.n.script, 1, 'script', 800);
            }).then(function () {
              var t2 = ctx.text(572, 350, '#a17e', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.tags });
              ledger(ctx, S, '+25k tok writer', 'amber');
              return Promise.all([
                ctx.reveal(t2, { from: 'down' }),
                setBudget(ctx, S, { tok: 59000 }, 500),
                busEvent(ctx, S, 760, 510, 'artifact:script', 'teal')
              ]);
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the storyboard and the audio branch run side by side */
            setEng(S, 'running · board ‖ audio');
            return Promise.all([
              dispatch(ctx, S, S.n.board, 2, 'board', 1100),
              dispatch(ctx, S, S.n.voice, 3, 'audio', 1300, 150)
            ]).then(function () {
              var t3 = ctx.text(710, 350, '#3b0d', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.tags });
              ledger(ctx, S, '+38k tok board+audio', 'amber');
              ledger(ctx, S, '+50 GPU-s keyframes', 'lime');
              ledger(ctx, S, '+80 GPU-s audio', 'lime');
              setEng(S, 'ready: approve (human)');
              return Promise.all([
                ctx.reveal(t3, { from: 'down' }),
                setBudget(ctx, S, { tok: 97000, gpu: 140 }, 700),
                busEvent(ctx, S, 760, 510, 'artifact:board', 'teal'),
                busEvent(ctx, S, 900, 1420, 'progress 22%', 'cyan')
              ]);
            });
          });
        }
      },
      /* 5 ---------------------------------------------------------------- */
      {
        title: 'Human checkpoint',
        beats: [
          {
            say: 'Before spending real GPU money, the plan contains a human checkpoint. The graph reaches the approval gate and stops there.',
            card: { tag: 'KEY IDEA', title: 'A gate before the money', body: 'The approval node sits right before the most expensive fan-out. It is a normal node in the DAG, with a status like any other.' },
            deep: '<p>Placement is economic: the gate sits right <i>before</i> the most expensive fan-out. Reviewing 6 keyframes costs about 50 GPU-s; rejecting 6 rendered shots would waste about 4,500.</p>' +
              '<p>Other gates worth a human: irreversible side effects (publishing, spending above a threshold), the use of a real person\'s likeness, policy-borderline prompts.</p>'
          },
          {
            say: 'The storyboard, six keyframes with camera notes, is streamed to the creator, who can approve it or ask for changes.',
            card: { tag: 'HOW IT WORKS', title: 'Review request as an event', body: 'The engine emits review.requested on the bus. The client stream turns it into a review screen with Approve and Revise.' },
            deep: '<pre>board = await board_agent(script)\nawait notify(client, board)\nd = await signal("approve", 24h)\nif d.revise:\n  board = await revise(board, d)</pre>' +
              '<p>The reviewer sees artifact previews, not full-resolution media: URIs resolve through the CDN, so the review costs the client a few hundred kilobytes.</p>'
          },
          {
            say: 'The workflow simply suspends on a durable signal. No worker, no GPU and no language model is held while the human thinks, whether that takes ten seconds or a whole day.',
            card: { tag: 'NUMBERS', title: 'Cost of waiting', stat: { v: '0', u: 'GPUs held', l: 'no worker, GPU or LLM call is reserved while a human decides' } },
            deep: '<p>While waiting, the workflow exists only as its <b>event history</b> in the store: memory about zero, compute zero. When the signal arrives, a worker replays the history and continues.</p>' +
              '<p>This is why the wait can outlive any process: a 24-hour timeout is a row in a timer table, not a thread. Compare a blocked HTTP handler, which pins a connection, a stack and often a GPU lease.</p>' +
              '<div class="note">The cheapest GPU-second is the one never scheduled because a human said "not like that" early.</div>'
          },
          {
            say: 'When the creator clicks approve, the signal is recorded as an event and execution resumes exactly where it stopped.',
            card: { tag: 'HOW IT WORKS', title: 'Signal, record, resume', body: 'The click becomes a durable event. A worker replays nine events to rebuild the state and the fan-out is released.', more: '<p>Replay is deterministic: workflow code may not read the clock or a random number directly. Those are recorded as events too, which is what lets the same history always lead to the same state.</p>' },
            deep: '<p>Approval is a <b>signal</b>: an external message appended to the workflow\'s history. On delivery the engine schedules a workflow task; a worker fetches the history (here 9 events), re-executes the workflow function deterministically against it, and continues past the <code>wait_signal</code> call.</p>' +
              '<p>The handler is idempotent: a second click finds the gate already open and is ignored, so a double click cannot approve twice.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: the graph stops at the approval gate */
          setSt(ctx, S.n.gate, 'wait');
          setEng(S, 'WAIT signal: approve');
          S.paused = ctx.label(775, 432, 'awaiting human', { color: 'cyan', size: 11, opacity: 0 });
          return Promise.all([ctx.pulse(S.n.gate, { color: 'cyan', times: 2, dur: 700 }), ctx.reveal(S.paused, { from: 'down' })]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the storyboard goes to the creator */
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
            S.cardSt = ctx.text(486, 318, 'waiting for the creator…', { size: 11, font: 'mono', color: 'dim', parent: C });
            S.cursor = ctx.poly([[0, 0], [0, 16], [4, 12], [7, 19], [9, 18], [6, 11], [11, 11]], { fill: 'white', stroke: '#000', parent: C });
            ctx.place(S.cursor, 700, 310);
            S.lSig = ctx.link({ x: 744, y: 334 }, S.n.gate, { color: 'cyan', straight: true, to: 't', dash: '4 4' });
            return Promise.all([ctx.reveal(C, { from: 'up', dur: 500 }), ctx.reveal(S.lSig, { from: 'draw', delay: 400 })]).then(function () {
              return busEvent(ctx, S, 760, 1420, 'review.requested', 'cyan');
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the workflow is suspended, nothing else is held */
            S.idle = [S.queue, S.workers, S.tools, S.fleet, S.lEQ, S.lQW, S.lWT, S.lTF];
            S.cardSt.textContent = '0 GPUs · 0 workers held while waiting';
            S.cardSt.setAttribute('fill', ctx.C.cyan);
            setEng(S, 'suspended · 0 workers held');
            return Promise.all([ctx.fade(S.idle, 0.3, 700), ctx.pulse(S.cardSt, { color: 'cyan', times: 2, dur: 600 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the click, the signal, the resume */
            return ctx.transform(S.cursor, { x: 790, y: 236 }, 900, 'inOut').then(function () {
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
              return Promise.all([ctx.fade(S.idle, 1, 500), ctx.fadeOut(S.paused, 400, true), busEvent(ctx, S, 1420, 200, 'human.approved', 'lime')]);
            });
          });
        }
      },
      /* 6 ---------------------------------------------------------------- */
      {
        title: 'Parallel fan-out',
        beats: [
          {
            say: 'Approval unlocks the widest part of the graph. Six shot tasks become ready at once, and the budget controller reserves the cost of all six before any of them starts.',
            card: { tag: 'NUMBERS', title: 'Reserved before it runs', stat: { v: '4,560', u: 'GPU-s', l: 'reserved for six shots: 6 × 8 GPUs × 95 s' }, more: '<p>Why reserve the p90 and not the mean? A reservation that is too low lets the job overrun its cap mid-flight; one that is too high only delays admission and is refunded on commit. Under-reserving is a correctness problem, over-reserving is a utilisation problem, so the estimator errs high.</p>' },
            deep: '<p>With k shots of G GPUs each, wall-clock and cost decouple:</p>' +
              '<div class="eq">T<sub>fan-out</sub> ≈ max<sub>i</sub> t<sub>i</sub> ≈ 95 s</div>' +
              '<div class="eq">cost = Σ<sub>i</sub> G · t<sub>i</sub> ≈ 6 × 8 × 95 = 4,560 GPU-s</div>' +
              '<p><b>Admission</b>: before enqueueing, the engine <i>reserves</i> each shot\'s p90 estimate with the budget controller. Per-job and per-tenant concurrency caps (for example at most 6 concurrent DiT jobs) stop one trailer from starving the fleet.</p>'
          },
          {
            say: 'Each camera agent turns its storyboard panel into a precise prompt with reference images and camera moves, then submits a video generation job.',
            card: { tag: 'HOW IT WORKS', title: 'Six agent loops, six leases', body: 'Each worker runs one camera agent, which spends about six thousand tokens and ends by calling generate_video.' },
            deep: '<ul><li><b>Async tools</b>: <code>generate_video</code> returns a job handle immediately; the worker releases its slot and the engine awaits a completion event, so an agent loop never holds a lease for 95 s of GPU time.</li>' +
              '<li><b>Per-shot prompt</b>: panel image, character sheet reference, camera enum (<code>dolly_in</code>, <code>orbit</code>, …), seed. The tool schema, not the prompt, decides what is legal.</li></ul>' +
              '<p>Camera agents cost about 36k tokens in total: cheap next to the GPU work they trigger.</p>'
          },
          {
            say: 'The six jobs run in parallel on the video pool, each spread across eight GPUs. Watch the GPU seconds meter: this fan out is where most of the bill is spent.',
            card: { tag: 'WHY IT MATTERS', title: 'Where the bill is', body: 'Six shots cost about 4,560 of the 5,520 GPU-seconds in the whole job. Every other stage is small change beside them.' },
            deep: '<ul><li><b>Gang scheduling</b>: the GPU scheduler places an 8-GPU job only when all 8 are free, so partial allocations cannot deadlock.</li>' +
              '<li><b>Stragglers</b>: a slow tail shot can be hedged with a duplicate at lower priority; the first result wins, and the loser is cancelled and refunded (the tail-at-scale playbook).</li></ul>' +
              '<p>Wall-clock is set by the slowest shot; cost is set by the sum. Speeding up the median shot saves money, speeding up the slowest shot saves time.</p>' +
              '<details><summary>Go deeper</summary><p>Why the maximum is worse than the mean: if shot times are roughly Gaussian, N(μ, σ²), the expected maximum of k = 6 shots is μ + 1.27σ (the expected maximum of six standard normals). With heavier tails, for instance exponential, it grows like μ·H<sub>k</sub> = 2.45μ. The more shots you fan out, the more the tail, not the average, sets the film\'s latency, which is why hedging targets the p95 shot and not the mean.</p></details>'
          },
          {
            say: 'Audio finished long ago, so the edit task becomes ready the moment the sixth shot lands. The editor assembles the cut, and the critic starts to watch it.',
            card: { tag: 'HOW IT WORKS', title: 'Fan-in barrier', body: 'Edit waits for seven predecessors: six shots plus the audio. The edit decision list references shots by content hash, so the cut is reproducible.' },
            deep: '<p><b>Fan-in barrier</b>: <code>edit</code> is ready only when all 7 predecessors are done. In the ready-set formula this is just the AND over incoming edges, no special construct needed.</p>' +
              '<p>The editor is a deterministic compositor driven by an <b>edit decision list</b> that the editor agent writes; the agent decides, the compositor executes. Because the list cites shots by hash, replacing one shot later (next step) changes exactly one input.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut([S.card, S.lSig], 400, true);
          /* beat 0: six shot tasks become ready; the budget is reserved */
          setEng(S, 'ready: 6 shots (fan-out)');
          ctx.hud('6 shots × 8 GPUs in parallel');
          S.e.gs.forEach(function (e) { e.setAttribute('stroke', ctx.C.magenta); });
          setQ(ctx, S, 6);
          return Promise.all([
            setBudget(ctx, S, { res: 4560 }, 800),
            ctx.pulse(S.n.gate, { color: 'lime', dur: 600 }),
            Promise.all(S.n.shots.map(function (n, i) { return ctx.wait(150 + i * 90).then(function () { return ctx.pulse(n, { color: 'magenta', dur: 500 }); }); }))
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: camera agents lease the tasks */
            setEng(S, 'running · 6 camera agents');
            var leases = S.n.shots.map(function (n, i) {
              return ctx.wait(i * 140).then(function () {
                setQ(ctx, S, S.qn - 1);
                setW(ctx, S, i, 's' + (i + 1));
                return ctx.packet(S.lQW, { color: 'magenta', dur: 300 });
              });
            });
            ledger(ctx, S, '+36k tok camera ×6', 'amber');
            return Promise.all(leases.concat([setBudget(ctx, S, { tok: 133000 }, 900)]));
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: six video jobs run in parallel on the GPU pool */
            setEng(S, 'running · 6 shots parallel');
            var shots = S.n.shots.map(function (n, i) {
              return ctx.wait(i * 100).then(function () {
                setW(ctx, S, i, '');
                setSt(ctx, n, 'run');
                return ctx.animate(n.bar, { width: [0, n.barW] }, 1800 + ((i * 37) % 5) * 260, 'inOut');
              }).then(function () {
                setSt(ctx, n, 'done');
                n.bar.setAttribute('fill', ctx.C.lime);
              });
            });
            var gpu = ctx.wait(300).then(function () {
              return Promise.all([
                setBudget(ctx, S, { gpu: 4700, res: 0 }, 2900),
                ctx.packet(S.lTF, { color: 'lime', dur: 500, label: 'generate_video ×6' })
              ]);
            });
            return Promise.all(shots.concat([gpu])).then(function () {
              ledger(ctx, S, '+4,560 GPU-s shots', 'lime');
              S.e.gs.forEach(function (e) { e.setAttribute('stroke', ctx.alpha('magenta', 0.55)); });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: fan-in, edit, and the critic starts */
            setEng(S, 'running · edit (fan-in)');
            ctx.hud('fan-in: edit waits for 6 shots + audio');
            return dispatch(ctx, S, S.n.edit, 0, 'edit', 900).then(function () {
              ledger(ctx, S, '+30 GPU-s edit', 'orange');
              setSt(ctx, S.n.critic, 'run');
              S.n.critic.bar.setAttribute('width', S.n.critic.barW * 0.5);
              setEng(S, 'running · critic');
              return Promise.all([setBudget(ctx, S, { tok: 145000, gpu: 4730 }, 500), busEvent(ctx, S, 760, 820, 'charge', 'magenta')]);
            });
          });
        }
      },
      /* 7 ---------------------------------------------------------------- */
      {
        title: 'Critic & replanning',
        beats: [
          {
            say: 'The critic, a vision language model with scoring rubrics, watches the cut. Shot three fails: the helmet and the fur pattern of the fox drifted away from the character sheet.',
            card: { tag: 'NUMBERS', title: 'A failure a machine can read', stat: { v: '0.61', u: 'identity', l: 'below the 0.75 threshold, so shot 3 fails while style and continuity pass' } },
            deep: '<p><b>Evaluator–optimizer</b> at graph level. The critic returns structured, thresholded scores rather than prose:</p>' +
              '<pre>{"shot":3, "identity":0.61,\n "style":0.82, "continuity":0.79,\n "min":{"identity":0.75},\n "fix":"add ref; lock seed"}</pre>' +
              '<p>Identity can be scored as mean cosine similarity between an embedding of the reference character and per-frame crops:</p>' +
              '<div class="eq">s<sub>id</sub> = (1/F) Σ<sub>f</sub> cos(e<sub>ref</sub>, e<sub>f</sub>)</div>'
          },
          {
            say: 'This is where agentic planning earns its keep. The failure event reaches the planner, which patches the graph instead of restarting the job.',
            card: { tag: 'KEY IDEA', title: 'Patch the graph, do not restart', body: 'The failure is an event on the bus. The planner edits the plan; every completed node keeps its artifact.' },
            deep: '<p>A restart would recompute all six shots (4,560 GPU-s) to fix one. Because artifacts are immutable and memoised by content hash, the planner can treat finished nodes as facts and reason only about what must change.</p>' +
              '<ul><li>Use a critic from a different model family than the planner, to reduce self-preference bias.</li>' +
              '<li>Verbal feedback into the next attempt is the Reflexion / Self-Refine idea, lifted from token level to task-graph level.</li></ul>'
          },
          {
            say: 'The patch adds a new version of shot three with the character sheet as a reference image and a locked seed, then runs the edit and the critic again. The budget controller reserves the extra GPU seconds first.',
            card: { tag: 'HOW IT WORKS', title: 'A graph patch, applied atomically', body: 'Three tasks are added, one edge is superseded, and 760 GPU-seconds are reserved before the new shot may start.', more: '<p>Atomicity matters: the engine applies the patch as one event, so a crash cannot leave the graph with the new shot but without its downstream edit.</p>' },
            deep: '<p><b>Dynamic replanning</b> is a graph patch applied atomically by the engine:</p>' +
              '<pre>G\' = G ∪ {shot_3.v2,\n          edit.v2, critic.v2}\n       − {shot_3 → edit}</pre>' +
              '<p class="muted">The removed edge is superseded, not deleted: the history keeps it.</p>' +
              '<p>The reservation (8 GPUs × 95 s = 760 GPU-s) is admitted against the remaining budget before the task is enqueued; if the cap would be exceeded, the engine degrades (draft resolution, fewer steps) or escalates to the human.</p>'
          },
          {
            say: 'Everything else is reused. Shot three is rendered again, the edit and the critic run again, and this time the identity score clears the bar.',
            card: { tag: 'NUMBERS', title: 'Price of the fix', stat: { v: '17%', l: 'of the original shot cost: 760 of 4,560 GPU-seconds to repair one shot' } },
            deep: '<ul><li>Completed nodes keep their artifacts (memoised by content hash): only 1/6 of the fan-out is recomputed.</li>' +
              '<li>Loops are bounded: <code>max_revisions = 2</code> per shot, then escalate to the human.</li>' +
              '<li>Net cost of the repair: shot 760 + edit 30 GPU-s ≈ $0.55, plus about 67k tokens of critique, replanning and re-checking ≈ $0.19, so roughly $0.75 against $3.17 for the whole first fan-out.</li></ul>' +
              '<div class="note">Self-correction only helps when the critic is a better judge than the generator is a generator; scored, thresholded rubrics keep it honest.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: the critic scores shot 3 and it fails */
          ctx.hud('critic flags shot 3');
          var P = S.cp = ctx.group();
          ctx.rect(1140, 428, 255, 140, { rx: 10, fill: 'rgba(6,12,24,0.95)', stroke: ctx.alpha('magenta', 0.6), parent: P });
          S.critTitle = ctx.text(1155, 448, 'CRITIC · shot 3 rubric', { size: 12, font: 'mono', weight: 600, color: lite(ctx, 'magenta'), parent: P });
          S.crit = [['identity', 0.61, 0.75], ['style', 0.82, 0.7], ['continuity', 0.79, 0.7]].map(function (m, i) {
            var y = 478 + i * 30;
            ctx.text(1155, y, m[0], { size: 12, font: 'mono', color: 'text', parent: P });
            ctx.rect(1240, y - 6, 110, 12, { rx: 3, fill: 'rgba(255,255,255,0.06)', parent: P });
            var bar = ctx.rect(1240, y - 6, 0, 12, { rx: 3, fill: m[1] < m[2] ? 'red' : 'lime', parent: P });
            ctx.line(1240 + 110 * m[2], y - 10, 1240 + 110 * m[2], y + 10, { color: 'white', sw: 1.5, parent: P });
            var v = ctx.text(1388, y, m[1].toFixed(2), { size: 12, font: 'mono', color: m[1] < m[2] ? 'red' : 'lime', anchor: 'end', parent: P });
            return { bar: bar, v: v, score: m[1] };
          });
          return ctx.reveal(P, { from: 'up', dur: 400 }).then(function () {
            return Promise.all(S.crit.map(function (c, i) { return ctx.animate(c.bar, { width: [0, 110 * c.score] }, 700, 'out', 100 + i * 150); }));
          }).then(function () {
            setSt(ctx, S.n.shots[2], 'fail');
            S.n.shots[2].bar.setAttribute('fill', ctx.C.red);
            setSt(ctx, S.n.critic, 'fail');
            return ctx.pulse(S.n.shots[2], { color: 'red', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the failure event travels back to the planner */
            S.fb = ctx.path('M1235,363 V215 Q1235,200 1220,200 H165 Q150,200 150,210', { color: ctx.alpha('red', 0.8), sw: 1.6, dash: '5 5', arrow: true, parent: S.gDag });
            S.fb.len = S.fb.getTotalLength();
            return ctx.reveal(S.fb, { from: 'draw', dur: 700 }).then(function () {
              return Promise.all([ctx.packet(S.fb, { color: 'red', dur: 1300, label: 'critic.failed(shot 3)' }), busEvent(ctx, S, 1235, 200, 'critic.failed', 'red')]);
            }).then(function () {
              ctx.pulse(S.planner, { color: 'magenta', times: 2, dur: 600 });
              setEng(S, 'replanning…');
              ledger(ctx, S, '+33k tok critic+plan', 'amber');
              return setBudget(ctx, S, { tok: 178000 }, 800);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the graph patch and the reservation */
            ctx.hud('replan: 1 of 6 shots recomputed');
            setEng(S, 'plan v2 · patch +3 tasks');
            S.n.s3v2 = dagNode(ctx, S.gDag, DX.edit, 265, 'Shot 3 v2', 'ref + seed', { w: 120 });
            S.e.old = S.e.se[2];
            S.e.old.setAttribute('stroke', ctx.alpha('red', 0.35));
            S.e.old.setAttribute('stroke-dasharray', '3 5');
            S.e.v2a = ctx.link(S.n.shots[2], S.n.s3v2, { color: ctx.alpha('red', 0.7), from: 'r', to: 'l', dash: '4 4', sw: 1.4, parent: S.gDag });
            S.e.v2b = ctx.link(S.n.s3v2, S.n.edit, { color: ctx.alpha('magenta', 0.8), from: 'b', to: 't', straight: true, sw: 1.4, parent: S.gDag });
            return Promise.all([
              ctx.reveal(S.n.s3v2, { from: 'scale', s0: 0.6, dur: 500 }),
              ctx.reveal([S.e.v2a, S.e.v2b], { from: 'draw', delay: 300, stagger: 150 }),
              setBudget(ctx, S, { res: 760 }, 800),
              ctx.packet(S.lPlan, { color: 'magenta', dur: 900, label: 'plan v2' })
            ]).then(function () {
              ledger(ctx, S, 'reserve 760 GPU-s ok', 'white');
              return ctx.pulse(S.n.s3v2, { color: 'magenta', dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: re-render shot 3, re-run edit and critic */
            setSt(ctx, S.n.shots[2], 'old');
            setSt(ctx, S.n.edit, 'pending');
            S.n.edit.bar.setAttribute('width', 0);
            S.n.critic.bar.setAttribute('width', 0);
            setSt(ctx, S.n.critic, 'pending');
            S.n.edit.titleEl.textContent = 'Edit v2';
            S.n.critic.titleEl.textContent = 'Critic v2';
            return Promise.all([runTask(ctx, S.n.s3v2, 1400), setBudget(ctx, S, { gpu: 5490, res: 0, tok: 184000 }, 1400)]).then(function () {
              ledger(ctx, S, '+760 GPU-s shot 3 v2', 'lime');
              return runTask(ctx, S.n.edit, 700);
            }).then(function () {
              setBudget(ctx, S, { gpu: 5520, tok: 212000 }, 900);
              return runTask(ctx, S.n.critic, 900);
            }).then(function () {
              S.crit[0].bar.setAttribute('fill', ctx.C.lime);
              S.crit[0].v.setAttribute('fill', ctx.C.lime);
              S.crit[0].v.textContent = '0.88';
              S.critTitle.textContent = 'CRITIC · shot 3 v2 rubric';
              setEng(S, 'completed ✓ · 2 plan versions');
              return Promise.all([ctx.animate(S.crit[0].bar, { width: [110 * 0.61, 110 * 0.88] }, 600, 'out'), busEvent(ctx, S, 1235, 1420, 'job.completed', 'lime')]);
            });
          });
        }
      },
      /* 8 ---------------------------------------------------------------- */
      {
        title: 'Budget accounting',
        beats: [
          {
            say: 'Every action has a price, so the orchestrator keeps books in three currencies: language model tokens, GPU seconds and dollars, converted at known rates.',
            card: { tag: 'KEY IDEA', title: 'Three currencies', body: 'Tokens and GPU-seconds are metered separately and converted to dollars at published rates, so a bill can be explained and not just paid.' },
            deep: '<p>Two physical meters, one accounting currency:</p>' +
              '<div class="eq">USD = Σ n<sub>tok</sub> · p<sub>tok</sub> + Σ t<sub>GPU</sub> · p<sub>GPU</sub></div>' +
              '<p class="muted">Illustrative prices: p<sub>GPU</sub> = $2.50 per H100-hour = $0.00069 per GPU-s; LLM input $3 / M, cached input $0.30 / M, output $15 / M tokens. Blended over a 60% cache-hit input mix this job comes to about $2.8 per million tokens.</p>' +
              '<p>Keeping tokens and GPU-seconds distinct matters: they scale with different things (context length and turns versus resolution, frames and denoising steps), so they need different levers.</p>'
          },
          {
            say: 'Before a task is enqueued, its estimated cost is reserved. When it finishes, the actual cost is committed, and anything unused is refunded.',
            card: { tag: 'HOW IT WORKS', title: 'Reserve, commit, refund', body: 'Estimate the p90 cost, reserve it before enqueueing, commit the actual on completion, refund the difference. Overspend is impossible by construction.' },
            deep: '<div class="eq">admit(v) ⇔ spent + reserved<br>+ ĉ<sub>v</sub><sup>p90</sup> ≤ cap</div>' +
              '<ul><li><b>Estimator</b>: ĉ(GPU-s) ≈ f(model, resolution, frames, steps) fitted on history; reserve the p90, commit actuals, refund the rest.</li>' +
              '<li><b>Degrade, don\'t fail</b>: near the cap, switch to draft resolution, a step-distilled student (50 → 4–8 steps), or skip best-of-n.</li>' +
              '<li><b>Attribution</b>: every charge carries <code>(tenant, job, task, span_id)</code> so cost shows up in traces, not just invoices.</li></ul>'
          },
          {
            say: 'Look at the shape of the bill. All the thinking done by every agent costs well under a dollar, while the pixels cost nearly four.',
            card: { tag: 'NUMBERS', title: 'One trailer, one bill', stat: { v: '$4.43', l: '212k tokens and 5,520 GPU-seconds, including one re-rendered shot' }, more: '<p>The LLM line: 190k input tokens of which 60% are cache hits, plus 22k output. (76k × $3 + 114k × $0.30) / 1M = $0.26, and 22k × $15 / 1M = $0.33, so $0.59 in total. Output tokens are 10% of the volume but more than half the LLM cost.</p>' },
            deep: '<table><tr><th>Line item</th><th>Quantity</th><th>Cost</th></tr>' +
              '<tr><td>LLM, all agents</td><td>190k in (60% cached) + 22k out</td><td>$0.59</td></tr>' +
              '<tr><td>Ref encoding + keyframes</td><td>60 GPU-s</td><td>$0.04</td></tr>' +
              '<tr><td>Voice + music</td><td>80 GPU-s</td><td>$0.06</td></tr>' +
              '<tr><td>Shots v1 (6 × 8 GPU × 95 s)</td><td>4,560 GPU-s</td><td>$3.17</td></tr>' +
              '<tr><td>Shot 3 v2</td><td>760 GPU-s</td><td>$0.53</td></tr>' +
              '<tr><td>Edit + encode (×2)</td><td>60 GPU-s</td><td>$0.04</td></tr>' +
              '<tr><th>Total</th><th>212k tok · 5,520 GPU-s</th><th>≈ $4.43</th></tr></table>'
          },
          {
            say: 'That is why cheap planning, early human checkpoints and targeted renders of a single shot matter far more than shaving prompt tokens.',
            card: { tag: 'WHY IT MATTERS', title: 'Optimise the pixels', body: 'Agent thinking is about 13 percent of the bill, the GPUs about 87. Halving every prompt saves 7 percent; distilling the shots saves far more.', more: '<p>If shot time scales with denoising steps, going from 50 to 8 steps cuts 4,560 GPU-s to about 730 GPU-s, saving roughly $2.66 of $4.43.</p>' },
            deep: '<p>Where the levers are, in dollars for this trailer:</p>' +
              '<table><tr><th>Lever</th><th>Saves</th></tr>' +
              '<tr><td>Halve all LLM tokens</td><td>≈ $0.30 (7%)</td></tr>' +
              '<tr><td>Human gate before the fan-out</td><td>avoids ≈ $3 per rejected board</td></tr>' +
              '<tr><td>Re-render 1 shot, not 6</td><td>≈ $2.64 vs a full redo</td></tr>' +
              '<tr><td>Step distillation 50 → 8</td><td>up to ≈ $2.7</td></tr></table>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          var O = S.bill = ctx.group();
          ctx.rect(300, 188, 1090, 410, { rx: 14, fill: 'rgba(5,10,22,0.96)', stroke: 'magenta', parent: O, glow: true });
          ctx.text(330, 216, 'THE BILL · one 30 s trailer', { size: 17, font: 'display', weight: 700, color: 'white', parent: O });
          ctx.focus([O, S.gBud], 0.18);
          /* beat 0: three currencies and how they convert */
          var cur = ctx.group({ parent: O, opacity: 0 });
          var tk = ctx.node({ x: 440, y: 340, w: 210, h: 76, title: 'LLM tokens', sub: '212k this job', icon: 'brain', color: 'amber', titleSize: 16, glow: false, parent: cur });
          var us = ctx.node({ x: 850, y: 340, w: 210, h: 76, title: 'Dollars', sub: '$4.43 this job', icon: 'chart', color: 'magenta', titleSize: 16, glow: false, parent: cur });
          var gp = ctx.node({ x: 1260, y: 340, w: 210, h: 76, title: 'GPU-seconds', sub: '5,520 this job', icon: 'gpu', color: 'lime', titleSize: 16, glow: false, parent: cur });
          var l1 = ctx.link(tk, us, { color: 'amber', straight: true, label: '≈ $2.8 per million tokens', labelDy: -26, parent: cur });
          var l2 = ctx.link(gp, us, { color: 'lime', straight: true, label: '$2.50 per H100-hour', labelDy: -26, parent: cur });
          return ctx.reveal(O, { from: 'scale', s0: 0.94, dur: 500 }).then(function () {
            return Promise.all([ctx.reveal(cur, { from: 'up', dur: 500 }), ctx.pulse(S.gBud, { color: 'magenta', times: 2, dur: 700 })]);
          }).then(function () {
            return Promise.all([ctx.packet(l1, { color: 'amber', dur: 800 }), ctx.packet(l2, { color: 'lime', dur: 800, reverse: false })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: reserve, run, commit, refund */
            var steps = [['estimate ĉ (p90)', 'violet'], ['reserve', 'white'], ['run', 'magenta'], ['commit actual', 'lime'], ['refund ĉ − c', 'teal']];
            var xs = [400, 548, 660, 780, 925];
            var lg = ctx.group({ parent: O });
            var items = [];
            steps.forEach(function (s, i) {
              items.push(ctx.label(xs[i], 518, s[0], { color: s[1], textColor: lite(ctx, s[1]), size: 12, parent: lg, opacity: 0 }));
              if (i < steps.length - 1) {
                var a = xs[i] + (s[0].length * 12 * 0.62 + 18) / 2 + 4, b = xs[i + 1] - (steps[i + 1][0].length * 12 * 0.62 + 18) / 2 - 4;
                items.push(ctx.line(a, 518, b, 518, { color: 'dim', sw: 1.4, arrow: true, parent: lg, opacity: 0 }));
              }
            });
            var eq = ctx.text(330, 566, 'admit(v) ⇔ spent + reserved + ĉᵥ ≤ cap', { size: 15, font: 'mono', color: 'white', parent: O, opacity: 0 });
            return ctx.reveal(items, { from: 'left', stagger: 220, dur: 350, dist: 10 }).then(function () {
              return ctx.reveal(eq, { from: 'up' });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the bill, line by line */
            ctx.fadeOut(cur, 400, true);
            S.total = ctx.text(1366, 218, '$0.00', { size: 24, font: 'mono', weight: 700, color: 'magenta', anchor: 'end', parent: O });
            ctx.text(1250, 218, '212k tok · 5,520 GPU-s', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: O });
            var rows = [['LLM · all agents', 0.59, 'amber', '212k tokens'], ['refs + keyframes', 0.04, 'violet', '60 GPU-s'], ['voice + music', 0.06, 'orange', '80 GPU-s'],
              ['shots v1 ×6', 3.17, 'lime', '4,560 GPU-s'], ['shot 3 v2', 0.53, 'red', '760 GPU-s'], ['edit + encode', 0.04, 'cyan', '60 GPU-s']];
            var sc = 560 / 3.17;
            var anims = [];
            S.billBars = [];
            rows.forEach(function (r, i) {
              var y = 262 + i * 38;
              ctx.text(540, y, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: O });
              ctx.rect(555, y - 12, 560, 24, { rx: 4, fill: 'rgba(255,255,255,0.025)', parent: O });
              var b = ctx.rect(555, y - 12, 0, 24, { rx: 4, fill: ctx.alpha(r[2], 0.55), stroke: r[2], sw: 1, parent: O });
              S.billBars.push(b);
              var w = Math.max(3, r[1] * sc);
              anims.push(ctx.animate(b, { width: [0, w] }, 700, 'out', 300 + i * 150));
              var t = ctx.text(555 + w + 10, y, '$' + r[1].toFixed(2) + '  ' + r[3], { size: 12, font: 'mono', color: lite(ctx, r[2]), parent: O });
              if (555 + w + 10 > 1000) { t.setAttribute('x', 555 + w - 10); t.setAttribute('text-anchor', 'end'); t.setAttribute('fill', ctx.C.white); }
              anims.push(ctx.reveal(t, { delay: 800 + i * 150 }));
            });
            anims.push(ctx.counter(S.total, 0, 4.43, 1600, function (v) { return '$' + v.toFixed(2); }));
            return Promise.all(anims);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: where the money is */
            ctx.hud('bill ≈ $4.43 · GPUs 87%');
            var note = ctx.text(1366, 566, 'agent thinking ≈ 13% of the bill', { size: 13, font: 'mono', weight: 600, color: 'amber', anchor: 'end', parent: O, opacity: 0 });
            return Promise.all([ctx.reveal(note, { from: 'up' }), ctx.pulse(S.billBars[0], { color: 'amber', dur: 700 })]).then(function () {
              return ctx.pulse(S.billBars[3], { color: 'lime', times: 2, dur: 700 });
            });
          });
        }
      },
      /* 9 ---------------------------------------------------------------- */
      {
        title: 'Zoom deeper',
        beats: [
          {
            say: 'That is the orchestration plane: a planner that writes graphs, an engine that executes them durably, workers that run agent loops, tools behind a common protocol, events that make everything observable, and a budget that keeps it honest.',
            card: { tag: 'KEY IDEA', title: 'Five invariants', body: 'Plans are data. Effects happen exactly once. Artifacts travel by reference. Everything is an event. Money is admitted, not discovered.' },
            deep: '<p>Invariants the orchestration plane maintains:</p>' +
              '<ol><li><b>Plans are data</b>: versioned DAGs (v1, v2 …) validated before execution; replanning is a patch, never a restart.</li>' +
              '<li><b>Exactly-once effects</b> from at-least-once delivery: durable history + idempotency keys.</li>' +
              '<li><b>Artifacts by reference</b>, content-addressed; contexts carry URIs and summaries, not media.</li>' +
              '<li><b>Everything is an event</b>: state, progress, traces and billing are projections of one log.</li>' +
              '<li><b>Money is admitted, not discovered</b>: reserve → commit → refund.</li></ol>'
          },
          {
            say: 'Four chambers go deeper from here. The first is the agent loop, where a language model becomes an agent. The second is tool calling and the Model Context Protocol.',
            card: { tag: 'TRY IT', title: 'Open the agent loop or tools', body: 'Click Agent Runtime to see how sampling, tool calls and context management turn an LLM into an agent. Click Tool Registry for schemas and MCP.' },
            deep: '<ul><li><b>The Agent Loop</b>: how sampling, tool calls and context management turn an LLM into an agent. Chat templates, context assembly, the loop itself, reasoning patterns, context budgeting, RL post-training on trajectories, failure modes and a complete harness in fifteen lines.</li>' +
              '<li><b>Tool Calling &amp; MCP</b>: tools as JSON Schema contracts, how a <code>tool_use</code> block is emitted, grammar-constrained decoding, parallel calls and errors, the Model Context Protocol (handshake, primitives, transports), tool search at scale, sandboxes and policy, and the full latency budget of one call.</li></ul>'
          },
          {
            say: 'The third is multi agent collaboration inside the crew. The fourth is durable execution, which guarantees the film survives crashes. Click any of them to zoom in.',
            card: { tag: 'TRY IT', title: 'Open the crew or the engine', body: 'Click Agent Crew for supervisor, handoff and blackboard topologies. Click Workflow Engine for event sourcing, deterministic replay and sagas.' },
            deep: '<ul><li><b>Multi-Agent Collaboration</b>: supervisor vs handoff vs blackboard topologies, and why context isolation (each sub-agent starts from a clean window and returns a short summary) is the main reason to split work across agents at all.</li>' +
              '<li><b>Durable Execution</b>: event sourcing, deterministic replay of workflow code, sagas and compensations for partial failure, and checkpoints for long GPU jobs, which together give exactly-once effects on top of at-least-once delivery.</li></ul>' +
              '<div class="note">Each dashed ring on this stage is a live zoom target.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          [S.bill, S.cp].forEach(function (g) {
            ctx.fade(g, 0, 400).then(function () { if (g.parentNode) g.parentNode.removeChild(g); });
          });
          ctx.focus(null);
          var targets = [[S.workers, 'agent loop'], [S.tools, 'tool calling · MCP'], [S.crew, 'multi-agent'], [S.eng, 'durable execution']];
          var labels = targets.map(function (t) {
            var b = t[0].box;
            var lb = ctx.label(b.cx, b.t - 18, '⤢ ' + t[1], { color: 'magenta', size: 12, bgAlpha: 0.25, opacity: 0 });
            lb.style.pointerEvents = 'none';
            return lb;
          });
          var sweep = function (list, dur) {
            return list.reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, { color: 'magenta', dur: dur }); }); }, Promise.resolve());
          };
          /* beat 0: recap: one pulse along the control path */
          return ctx.wait(400).then(function () {
            return sweep([S.planner, S.eng, S.queue, S.workers, S.tools], 450);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the agent loop and tool calling */
            return ctx.reveal([labels[0], labels[1]], { from: 'down', stagger: 200 }).then(function () {
              return sweep([S.workers, S.tools], 700);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: multi-agent and durable execution */
            return ctx.reveal([labels[2], labels[3]], { from: 'down', stagger: 200 }).then(function () {
              return sweep([S.crew, S.eng], 700);
            });
          });
        }
      }
    ]
  });
})();
