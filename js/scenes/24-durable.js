/* L2 — Durable Workflow Execution. Temporal/Cadence-style event-sourced workflows: deterministic replay,
 * task queues, timeouts + heartbeats + retries, checkpointed diffusion, idempotency, outbox, sagas, signals. */
(function () {
  var LH = 12.5 * 1.55;
  function lineY(n) { return 165 + 46 + n * LH; }
  function nb(lines) { return lines.map(function (s) { return s.replace(/^ +/, function (m) { return '\u00a0'.repeat(m.length); }); }); }
  function panel(ctx, x, y, w, h, col, parent) {
    return ctx.rect(x, y, w, h, { rx: 12, fill: 'rgba(7,12,26,0.93)', stroke: ctx.alpha(col, 0.5), sw: 1.2, parent: parent });
  }
  function head(ctx, x, y, str, col, parent, anchor) {
    return ctx.text(x, y, str, { size: 13, font: 'mono', weight: 600, color: col, parent: parent, anchor: anchor || 'start', spacing: 1.2 });
  }
  function diamond(ctx, x, y, r, col, parent) {
    return ctx.poly([[x, y - r], [x + r, y], [x, y + r], [x - r, y]], { fill: col, parent: parent });
  }

  var CODE = [
    '@workflow.defn',
    'class TrailerWorkflow:',
    '  @workflow.run',
    '  async def run(self, req):',
    '    plan = await act(plan_trailer, req)',
    '    script = await act(write_script, plan)',
    '    board = await act(storyboard, script)',
    '    await wait_condition(lambda: self.approved)',
    '    shots = await gather(*[act(render_shot, s,',
    '        start_to_close=20*MIN, heartbeat=30*SEC,',
    '        retry=RetryPolicy(backoff=2.0, max_attempts=8))',
    '        for s in board.shots])',
    '    return await act(edit_and_encode, shots)'
  ];
  /* [event ids, type, detail, code line, color] */
  var EV = [
    ['1', 'WorkflowExecutionStarted', 'req + 3 sketch URIs', 3, 'cyan'],
    ['2–4', 'WorkflowTask ×3', 'sched · start · done', 3, 'dim'],
    ['5', 'ActivityTaskScheduled', 'plan_trailer', 4, 'amber'],
    ['6', 'ActivityTaskStarted', 'attempt 1', 4, 'amber'],
    ['7', 'ActivityTaskCompleted', '→ plan.json (ref)', 4, 'lime'],
    ['8–10', 'WorkflowTask ×3', '', 5, 'dim'],
    ['11', 'ActivityTaskScheduled', 'write_script', 5, 'amber'],
    ['12–13', 'ActivityStarted+Completed', '→ script.md', 5, 'lime'],
    ['14–16', 'WorkflowTask ×3', '', 6, 'dim'],
    ['17', 'ActivityTaskScheduled', 'storyboard', 6, 'amber'],
    ['18–19', 'ActivityStarted+Completed', '→ board.json', 6, 'lime'],
    ['20–22', 'WorkflowTask ×3', 'wait_condition', 7, 'dim'],
    ['23', 'WorkflowExecutionSignaled', 'approve (creator)', 7, 'cyan'],
    ['24–26', 'WorkflowTask ×3', '', 8, 'dim'],
    ['27–32', 'ActivityTaskScheduled ×6', 'render_shot S1…S6', 8, 'amber']
  ];

  Atlas.register({
    id: 'durable-exec',
    refs: [
      'Temporal Technologies, <i>Temporal documentation: Workflows, Activities, Event History, Retry Policies, Versioning</i>, 2024–2025',
      'Uber Engineering, <i>Cadence: fault-oblivious stateful workflow engine</i> (open source), 2017',
      'Burckhardt et al., <i>Durable Functions: Semantics for Stateful Serverless</i>, OOPSLA 2021',
      'Garcia-Molina &amp; Salem, <i>Sagas</i>, ACM SIGMOD 1987',
      'Helland, <i>Life beyond Distributed Transactions: an Apostate\'s Opinion</i>, CIDR 2007',
      'Brooker, <i>Exponential Backoff and Jitter</i>, AWS Architecture Blog, 2015',
      'Llama Team (Meta), <i>The Llama 3 Herd of Models</i> (§3.3.4 reliability: 419 unexpected interruptions in 54 days), 2024',
      'Richardson, <i>Pattern: Transactional Outbox</i>, microservices.io'
    ],
    steps: [
      /* 1 ------------------------------------------------------------------ */
      {
        title: 'Workflow vs activities',
        say: 'A thirty second trailer is a long-running distributed transaction: minutes of GPU time, paid API calls, and a human approval that may take hours. Something will crash along the way. Durable execution splits the program in two. Workflow code is the orchestration logic, and it must be deterministic. Activities are the side effects: LLM calls, renders, payments and uploads. They may fail and be retried. A service in the middle, Temporal style, records everything the workflow decides.',
        deep: '<p><b>Why:</b> at fleet scale failure is the steady state. Meta saw 419 unexpected interruptions in 54 days on a 16k-H100 job (≈ one every 3 h), ~78% hardware-attributed. A 3-minute, 50-GPU trailer job will regularly meet node drains, Xid errors, preemptions and deploys.</p>' +
          '<table><tr><th></th><th>Workflow code</th><th>Activity</th></tr>' +
          '<tr><td>Does</td><td>decides what to do next</td><td>does it (I/O, GPU, APIs)</td></tr>' +
          '<tr><td>Must be</td><td>deterministic given history</td><td>idempotent (runs ≥1×)</td></tr>' +
          '<tr><td>Forbidden</td><td>wall clock, random, threads, network</td><td>—</td></tr>' +
          '<tr><td>Failure</td><td>replayed on another worker</td><td>retried by policy</td></tr>' +
          '<tr><td>Duration</td><td>seconds → months</td><td>ms → hours (with heartbeats)</td></tr></table>' +
          '<p>Deterministic substitutes: <code>workflow.now()</code>, <code>workflow.random()</code>, <code>workflow.sleep()</code> (a durable timer), <code>workflow.uuid4()</code> — each recorded in or derived from history.</p>' +
          '<div class="note">The engine gives <b>effectively-once workflow logic</b> on top of <b>at-least-once activities</b>. Exactly-once <i>effects</i> additionally need idempotent activities (step 7).</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.codeG = ctx.group();
          S.code = ctx.code({ x: 36, y: 165, w: 540, title: 'trailer_workflow.py · runs on a Workflow Worker', lang: 'py', size: 12.5, color: 'magenta', parent: S.codeG, lines: nb(CODE) });
          S.cur = ctx.rect(40, lineY(4) - 10, 532, 20, { rx: 3, fill: ctx.alpha('amber', 0.14), stroke: ctx.alpha('amber', 0.6), sw: 1, parent: S.codeG });
          ctx.reveal(S.codeG, { from: 'left' });
          /* activities */
          S.actG = ctx.group();
          panel(ctx, 36, 490, 540, 270, 'amber', S.actG);
          head(ctx, 56, 514, 'ACTIVITIES · side effects · at-least-once', 'amber', S.actG);
          var acts = [['plan_trailer', 'LLM · ~8 s', 'amber'], ['write_script', 'LLM · ~10 s', 'amber'], ['storyboard', 'image model · ~20 s', 'violet'], ['render_shot', 'GPU 8×H100 · 60–120 s', 'lime'], ['charge_credits', 'payments API', 'magenta'], ['publish', 'CDN + notify', 'cyan']];
          S.actChips = acts.map(function (a, i) {
            var g = ctx.group({ parent: S.actG });
            var x = 52 + (i % 2) * 262, y = 540 + Math.floor(i / 2) * 64;
            ctx.rect(x, y, 246, 50, { rx: 8, fill: ctx.alpha(a[2], 0.08), stroke: ctx.alpha(a[2], 0.6), sw: 1, parent: g });
            ctx.text(x + 14, y + 17, a[0] + '()', { size: 14, font: 'mono', weight: 600, color: a[2], parent: g });
            ctx.text(x + 14, y + 36, a[1], { size: 12, font: 'mono', color: 'dim', parent: g });
            return g;
          });
          ctx.text(56, 744, 'may run more than once → must be idempotent', { size: 12, font: 'mono', color: 'dim', parent: S.actG });
          ctx.reveal(S.actG, { from: 'up', delay: 200 });
          /* Temporal service */
          S.srvG = ctx.group();
          panel(ctx, 616, 165, 470, 595, 'magenta', S.srvG);
          ctx.text(636, 190, 'TEMPORAL SERVICE', { size: 16, font: 'display', weight: 700, color: 'white', parent: S.srvG });
          ctx.text(1066, 190, 'frontend · history · matching', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.srvG });
          head(ctx, 636, 222, 'EVENT HISTORY · wf trailer-7f3', 'magenta', S.srvG);
          ctx.text(1066, 222, 'append-only', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.srvG });
          ctx.line(632, 234, 1070, 234, { color: 'line', sw: 1, parent: S.srvG });
          S.empty = ctx.text(851, 400, '(events are appended here as the workflow runs)', { size: 12, font: 'mono', color: 'faint', anchor: 'middle', parent: S.srvG });
          head(ctx, 636, 590, 'MATCHING · TASK QUEUES', 'magenta', S.srvG);
          ctx.line(632, 602, 1070, 602, { color: 'line', sw: 1, parent: S.srvG });
          S.q = {};
          [['wf', 'workflow-tq', 630], ['llm', 'activity-tq', 672], ['gpu', 'gpu-render-tq', 714]].forEach(function (q) {
            ctx.text(636, q[2], q[1], { size: 12.5, font: 'mono', color: 'text', parent: S.srvG });
            ctx.rect(780, q[2] - 13, 286, 26, { rx: 6, fill: 'rgba(255,255,255,0.03)', stroke: 'line', sw: 1, parent: S.srvG });
            S.q[q[0]] = { y: q[2], tokens: [] };
          });
          ctx.reveal(S.srvG, { from: 'scale', s0: 0.95, delay: 300 });
          /* workers */
          S.wrkG = ctx.group();
          S.wA = ctx.node({ x: 1345, y: 250, w: 400, h: 72, title: 'Workflow Worker A', sub: 'runs workflow code · sticky cache', icon: 'code', color: 'magenta', parent: S.wrkG });
          S.wAct = ctx.node({ x: 1345, y: 420, w: 400, h: 72, title: 'Activity Worker', sub: 'LLM · storage · payments', icon: 'server', color: 'amber', parent: S.wrkG });
          S.pool = ctx.node({ x: 1345, y: 628, w: 420, h: 116, kind: 'ghost', color: 'red', parent: S.wrkG });
          ctx.text(1145, 552, 'GPU RENDER POOL · 8×H100 per node', { size: 12, font: 'mono', color: 'red', parent: S.wrkG });
          S.gpu = ['gpu-17', 'gpu-42', 'gpu-88'].map(function (n, i) {
            return ctx.node({ x: 1210 + i * 135, y: 632, w: 120, h: 60, kind: 'chip', title: n, sub: 'idle', color: 'red', titleSize: 14, subSize: 11, parent: S.wrkG });
          });
          ctx.reveal([S.wA, S.wAct, S.pool], { from: 'right', delay: 400, stagger: 150 });
          ctx.reveal(S.gpu, { from: 'scale', delay: 800, stagger: 100 });
          /* links */
          S.qlWf = ctx.link({ x: 1066, y: 630 }, S.wA, { from: 'r', to: 'l', curve: 0.25, color: ctx.alpha('magenta', 0.6), dash: '4 5', parent: S.srvG });
          S.qlAct = ctx.link({ x: 1066, y: 672 }, S.wAct, { from: 'r', to: 'l', curve: 0.25, color: ctx.alpha('amber', 0.6), dash: '4 5', parent: S.srvG });
          S.qlGpu = ctx.link({ x: 1066, y: 714 }, S.pool, { from: 'r', to: 'l', curve: 0.3, color: ctx.alpha('red', 0.6), dash: '4 5', parent: S.srvG });
          S.cmdL = ctx.link(S.wA, { x: 1086, y: 250 }, { from: 'l', color: 'magenta', parent: S.srvG });
          ctx.reveal([S.qlWf, S.qlAct, S.qlGpu, S.cmdL], { from: 'draw', delay: 900, stagger: 120 });
          return ctx.wait(1400).then(function () {
            ctx.pulse(S.cur, { color: 'amber', dur: 600 });
            return ctx.packet(S.cmdL, { color: 'magenta', dur: 800, label: 'ScheduleActivityTask' });
          }).then(function () {
            return ctx.packet(S.qlAct, { color: 'amber', dur: 900, label: 'plan_trailer' });
          }).then(function () {
            ctx.pulse(S.wAct, { color: 'amber' });
            return ctx.wait(400);
          }).then(function () {
            return ctx.packet(S.qlAct, { color: 'lime', dur: 900, reverse: true, label: 'result: plan.json ref' });
          });
        }
      },
      /* 2 ------------------------------------------------------------------ */
      {
        title: 'Event history',
        say: 'Every decision becomes an event in an append-only history. The workflow starts. It schedules an activity to plan the trailer, the activity starts and completes, and its result, a reference to plan dot json, is written into the history. Then the script, then the storyboard, then a human approval signal, then six render activities scheduled at once. The workflow\'s state is never stored directly. It is a pure function, a fold, over this log.',
        deep: '<div class="eq">state<sub>n</sub> = fold(apply, state<sub>0</sub>, [e<sub>1</sub>, …, e<sub>n</sub>])</div>' +
          '<p>Only two kinds of things are persisted: <b>events</b> (facts: <i>ActivityTaskCompleted</i> with its result payload) and <b>commands</b> the workflow emits at the end of each workflow task (<i>ScheduleActivityTask</i>, <i>StartTimer</i>, <i>CompleteWorkflowExecution</i>), which the server turns into events.</p>' +
          '<ul><li>A <b>workflow task</b> (Scheduled/Started/Completed triple) is one “think” step: the worker runs code until every coroutine is blocked, then returns commands.</li>' +
          '<li><i>ActivityTaskStarted</i> is written lazily together with the completion, so retries do not bloat history.</li>' +
          '<li>Results are <b>payloads in history</b>: keep them small. Temporal limits blobs to ~2&nbsp;MB and histories to 51,200 events / 50&nbsp;MB (warnings at 10k) — hence artifact references, and <code>continue_as_new</code> for very long workflows.</li>' +
          '<li>History is sharded by workflow ID across history-service shards on Cassandra / PostgreSQL / MySQL; each append is a conditional write on the shard (optimistic concurrency).</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.actG, 0.3, 400);
          ctx.remove(S.empty, 200);
          S.rows = [];
          S.rowG = ctx.group({ parent: S.srvG });
          EV.forEach(function (e, i) {
            var y = 250 + i * 21;
            var g = ctx.group({ parent: S.rowG });
            ctx.text(690, y, e[0], { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: g });
            ctx.text(700, y, e[1], { size: 12.5, font: 'mono', color: e[4] === 'dim' ? '#7b8cab' : e[4], parent: g });
            if (e[2]) ctx.text(1068, y, e[2], { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: g });
            g.setAttribute('opacity', 0);
            S.rows.push(g);
          });
          S.frontier = ctx.group({ parent: S.srvG });
          ctx.line(636, 568, 1066, 568, { color: 'magenta', sw: 1.2, dash: '6 4', parent: S.frontier });
          ctx.text(1066, 580, 'frontier · next event 33', { size: 11, font: 'mono', color: 'magenta', anchor: 'end', parent: S.frontier });
          S.frontier.setAttribute('opacity', 0);
          var chain = ctx.wait(400);
          EV.forEach(function (e, i) {
            chain = chain.then(function () {
              var from = parseFloat(S.cur.getAttribute('y')), to = lineY(e[3]) - 10;
              var mv = Math.abs(from - to) > 1 ? ctx.animate(S.cur, { y: [from, to] }, 220, 'out') : Promise.resolve();
              return mv.then(function () {
                if (e[4] === 'amber' && i !== 3) ctx.packet(S.cmdL, { color: 'magenta', dur: 350 });
                return ctx.reveal(S.rows[i], { from: 'left', dur: 260, dist: 14 });
              });
            });
          });
          return chain.then(function () {
            ctx.hud('state = fold(events) · 32 events');
            return ctx.reveal(S.frontier, { dur: 400 });
          });
        }
      },
      /* 3 ------------------------------------------------------------------ */
      {
        title: 'Task queues & workers',
        say: 'Workers do not receive pushes; they long-poll task queues. The workflow worker polls for decisions, the activity worker for LLM calls, and GPU workers poll a dedicated render queue, so a GPU only accepts work when it actually has capacity. Six render tasks arrive, but only three GPU nodes are free, so three tasks wait. That waiting time, schedule to start latency, is exactly the signal the autoscaler watches. Here it promotes three warm standby nodes that already hold the model weights, and the backlog drains in about four seconds.',
        deep: '<ul><li><b>Matching service</b> owns task queues (partitioned, 4 partitions by default). Workers issue long-poll RPCs (~60&nbsp;s); a task is handed to whichever poller is waiting — natural <b>pull-based load balancing</b> and back-pressure: a busy GPU simply stops polling.</li>' +
          '<li><b>Queue per resource class</b>: <code>gpu-render-tq</code> is polled only by workers on 8×H100 nodes with the DiT weights resident; <code>activity-tq</code> by cheap CPU pods. Routing by queue name replaces a scheduler for this layer.</li>' +
          '<li><b>Sticky execution</b>: after a workflow task, the worker keeps the workflow state in an LRU cache and the next task goes to its sticky queue (5&nbsp;s timeout, then the normal queue). Cache hit ⇒ no replay.</li>' +
          '<li><b>Concurrency caps</b>: <code>max_concurrent_activities=1</code> per GPU worker; slots, not threads, bound HBM usage.</li></ul>' +
          '<div class="eq">schedule_to_start latency ≈ backlog / service rate &nbsp;→ autoscaling signal</div>' +
          '<p>Here: 6 tasks, 3 free nodes, ~90&nbsp;s per render ⇒ without scale-out the 4th–6th shots would wait ~90&nbsp;s. The autoscaler (KEDA-style, driven by backlog / schedule_to_start) promotes 3 <b>warm-standby</b> nodes whose workers already hold the DiT weights in HBM, so S4–S6 start after ~4&nbsp;s. A cold node costs minutes: provision, pull a multi-GB image, load ~30&nbsp;GB of bf16 weights (a 14B DiT), warm up / compile kernels.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.rowG, 0.45, 400);
          S.qTok = ctx.group({ parent: S.srvG });
          var toks = [];
          for (var i = 0; i < 6; i++) {
            var t = ctx.group({ parent: S.qTok });
            ctx.rect(1030 - i * 40, 704, 34, 20, { rx: 4, fill: ctx.alpha('lime', 0.3), stroke: 'lime', sw: 1, parent: t });
            ctx.text(1047 - i * 40, 714.5, 'S' + (i + 1), { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: t });
            toks.push(t);
          }
          S.toks = toks;
          var wft = ctx.group({ parent: S.qTok });
          ctx.rect(1030, 620, 34, 20, { rx: 4, fill: ctx.alpha('magenta', 0.3), stroke: 'magenta', sw: 1, parent: wft });
          ctx.text(1047, 630.5, 'wft', { size: 11, font: 'mono', color: 'magenta', anchor: 'middle', parent: wft });
          ctx.reveal(toks, { from: 'left', stagger: 120, dur: 300 });
          ctx.reveal(wft, { delay: 200 });
          return ctx.wait(900).then(function () {
            ctx.fadeOut(wft, 300, true);
            return ctx.packet(S.qlWf, { color: 'magenta', dur: 700, label: 'long-poll → wft' });
          }).then(function () {
            var ps = [0, 1, 2].map(function (k) {
              return ctx.wait(k * 250).then(function () {
                ctx.fadeOut(toks[k], 250, true);
                return ctx.packet(S.qlGpu, { color: 'lime', dur: 700, label: 'S' + (k + 1) });
              }).then(function () {
                S.gpu[k].subEl.textContent = 'S' + (k + 1) + ' · step 0/50';
                return ctx.pulse(S.gpu[k], { color: 'lime', dur: 500 });
              });
            });
            return Promise.all(ps);
          }).then(function () {
            [3, 4, 5].forEach(function (k, j) { ctx.transform(toks[k], { x: 120 }, 500, 'inOut', j * 80); });
            S.backlog = ctx.label(930, 744, 'backlog 3 · waiting for a GPU slot', { color: 'amber', size: 11, parent: S.srvG });
            ctx.reveal(S.backlog, { from: 'up', delay: 400 });
            ctx.hud('gpu-render-tq backlog 3 · schedule_to_start ↑');
            return ctx.wait(1100);
          }).then(function () {
            /* autoscaler promotes warm-standby nodes (weights already resident) */
            S.warmT = ctx.text(1145, 699, 'AUTOSCALER → +3 warm-standby nodes (weights in HBM)', { size: 11, font: 'mono', color: 'amber', parent: S.wrkG });
            S.warm = ['gpu-51', 'gpu-63', 'gpu-77'].map(function (n, i) {
              return ctx.node({ x: 1210 + i * 135, y: 744, w: 120, h: 50, kind: 'chip', title: n, sub: 'warm', color: 'red', titleSize: 13, subSize: 10.5, parent: S.wrkG });
            });
            ctx.reveal(S.warmT, { dur: 300 });
            return ctx.reveal(S.warm, { from: 'scale', stagger: 120, dur: 400 });
          }).then(function () {
            var ps = [3, 4, 5].map(function (k, j) {
              return ctx.wait(j * 200).then(function () {
                ctx.fadeOut(toks[k], 250, true);
                return ctx.packet(S.qlGpu, { color: 'lime', dur: 600, label: 'S' + (k + 1) });
              }).then(function () {
                S.warm[j].subEl.textContent = 'S' + (k + 1) + ' · step 0/50';
                return ctx.pulse(S.warm[j], { color: 'lime', dur: 450 });
              });
            });
            return Promise.all(ps);
          }).then(function () {
            ctx.remove(S.backlog, 250);
            S.backlog2 = ctx.label(930, 744, 'backlog 0 · S4–S6 waited ~4 s', { color: 'lime', size: 11, parent: S.srvG });
            ctx.reveal(S.backlog2, { from: 'up', dur: 300 });
            ctx.hud('backlog → autoscale +3 warm nodes · wait ≈ 4 s');
            return ctx.wait(700);
          });
        }
      },
      /* 4 ------------------------------------------------------------------ */
      {
        title: 'Crash & replay',
        say: 'Now the workflow worker dies, killed mid-run by a node drain. Nothing is lost. Worker B picks up the next workflow task. It has no cached state, so it downloads the history and replays the workflow code from the top. Each await that already has a completion event in the history returns the recorded result instantly, without calling the LLM or the GPU again. When the code reaches the frontier, execution continues live. If the code ever issued a different command than the history recorded, replay would stop with a non determinism error.',
        deep: '<pre>replay(history):\n  for e in history:\n    if e.kind == ActivityTaskCompleted:\n      resolve(fut[e.sched_id], e.result)\n    run coroutines until blocked\n    cmds = drain_commands()\n    assert cmds == recorded(e)  # determinism\n  # frontier → emit new commands live</pre>' +
          '<ul><li>Replay is <b>CPU-only and fast</b>: 32 events replay in &lt;&lt;1&nbsp;ms of logic; the cost is fetching history (paged gRPC).</li>' +
          '<li>No activity is re-executed: the plan, script and storyboard LLM calls (and their tokens) are not paid twice; renders already scheduled are not duplicated.</li>' +
          '<li><b>NonDeterminismError</b> fires if replayed code emits a command that disagrees with history — e.g. someone reordered two <code>await</code>s, used <code>datetime.now()</code>, or iterated a <code>set</code>. The workflow task fails and retries until a fixed worker is deployed (history is untouched).</li>' +
          '<li>The Python SDK runs workflows in a sandbox that re-imports modules and blocks non-deterministic calls; Go uses a static analyzer (<code>workflowcheck</code>).</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.fade(S.rowG, 1, 300);
          S.nd = ctx.text(40, 477, 'replayed command ≠ recorded command → NonDeterminismError', { size: 11.5, font: 'mono', color: '#ff9aad', parent: S.codeG, opacity: 0 });
          S.checks = ctx.group({ parent: S.srvG });
          S.chk = EV.map(function (e, i) {
            return ctx.text(640, 250 + i * 21, '✓', { size: 13, weight: 700, color: 'lime', parent: S.checks, opacity: 0 });
          });
          return ctx.wait(500).then(function () {
            S.wA.body.setAttribute('stroke', ctx.C.red);
            S.kill = ctx.label(1345, 206, '✕ SIGKILL · node drained', { color: 'red', size: 12, parent: S.wrkG });
            ctx.reveal(S.kill, { from: 'scale' });
            return ctx.pulse(S.wA, { color: 'red', times: 2, dur: 450 });
          }).then(function () {
            return Promise.all([ctx.fadeOut(S.wA, 500, true), ctx.fadeOut(S.kill, 500, true)]);
          }).then(function () {
            S.wB = ctx.node({ x: 1345, y: 250, w: 400, h: 72, title: 'Workflow Worker B', sub: 'cold · no cache → replay', icon: 'code', color: 'lime', parent: S.wrkG });
            return ctx.reveal(S.wB, { from: 'scale' });
          }).then(function () {
            return ctx.packet(S.cmdL, { color: 'cyan', dur: 900, reverse: true, label: 'GetWorkflowExecutionHistory' });
          }).then(function () {
            S.cur.setAttribute('fill', ctx.alpha('lime', 0.14));
            S.cur.setAttribute('stroke', ctx.alpha('lime', 0.7));
            ctx.animate(S.cur, { y: [parseFloat(S.cur.getAttribute('y')), lineY(3) - 10] }, 300, 'out');
            var chain = ctx.wait(320);
            EV.forEach(function (e, i) {
              chain = chain.then(function () {
                var from = parseFloat(S.cur.getAttribute('y')), to = lineY(e[3]) - 10;
                if (Math.abs(from - to) > 1) ctx.animate(S.cur, { y: [from, to] }, 90, 'out');
                return ctx.fade(S.chk[i], 1, 110);
              });
            });
            return chain;
          }).then(function () {
            ctx.pulse(S.frontier, { color: 'magenta', dur: 600 });
            S.wB.subEl.textContent = 'replayed 32 events → live';
            ctx.fade(S.nd, 1, 400);
            ctx.hud('replay: 0 LLM calls · 0 GPU-s re-spent');
            return ctx.packet(S.cmdL, { color: 'magenta', dur: 700, label: 'next commands (live)' });
          });
        }
      },
      /* 5 ------------------------------------------------------------------ */
      {
        title: 'GPU failure & retries',
        say: 'Now a GPU node fails in the middle of shot four, with a hardware error: the GPU fell off the bus. The render activity was heartbeating every ten seconds, reporting its denoising step. The heartbeats stop, and thirty seconds after the last one, the heartbeat timeout fires. The server does not wait for the twenty minute start to close timeout. The retry policy schedules attempt two after a short exponential backoff, and another GPU node picks it up from the queue.',
        deep: '<table><tr><th>Timeout</th><th>Bounds</th><th>Trailer value</th></tr>' +
          '<tr><td>schedule_to_start</td><td>time waiting in the queue</td><td>alert only (backlog)</td></tr>' +
          '<tr><td>start_to_close</td><td>one attempt</td><td>20 min</td></tr>' +
          '<tr><td>heartbeat</td><td>max gap between heartbeats</td><td>30 s</td></tr>' +
          '<tr><td>schedule_to_close</td><td>all attempts incl. backoff</td><td>60 min</td></tr></table>' +
          '<p>Without heartbeats a dead GPU is detected only at start_to_close (20&nbsp;min); with them, ≤30&nbsp;s after the last heartbeat reached the server. <code>activity.heartbeat()</code> can be called every denoising step; the SDK coalesces calls and flushes an RPC at most every min(0.8 × heartbeat_timeout, <code>max_heartbeat_throttle_interval</code>) — here the worker caps it at 10&nbsp;s. Each heartbeat carries <code>details</code> (step, checkpoint URI) that survive into the next attempt.</p>' +
          '<div class="eq">delay<sub>n</sub> = min(initial · c<sup>n−1</sup>, max_interval) &nbsp;= 1, 2, 4, 8, 16, 32, 60 s</div>' +
          '<p>Temporal applies this server-side (defaults: 1&nbsp;s, ×2, cap 100× initial, unlimited attempts). For client-side retries inside an activity (the video API returning 429/503), add <b>full jitter</b> — <code>sleep = U(0, delay<sub>n</sub>)</code> — so a thousand failed shots do not retry in lock-step (Brooker, 2015).</p>' +
          '<p>Classify errors: Xid 79/48/94, CUDA OOM, preemption, 5xx → retryable; <code>PolicyViolation</code>, invalid prompt → <code>non_retryable_error_types</code>.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.codeG, 400); ctx.remove(S.actG, 400); ctx.remove(S.srvG, 400);
          ctx.fade([S.wB, S.wAct], 0.22, 400);
          ctx.fade(S.warmT, 0.5, 300);
          S.gpu.forEach(function (g, i) { g.subEl.textContent = 'S' + (i + 1) + ' · rendering'; });
          S.warm.forEach(function (g, i) { g.subEl.textContent = 'S' + (i + 4) + (i === 0 ? ' · step 0/50' : ' · rendering'); });
          /* timeline */
          S.tlG = ctx.group();
          panel(ctx, 36, 165, 1050, 290, 'lime', S.tlG);
          head(ctx, 56, 188, 'ACTIVITY render_shot#4 · attempts on a timeline', 'lime', S.tlG);
          function X(t) { return 210 + t * 4.7; }
          S.X = X;
          ctx.line(X(0), 385, X(180), 385, { color: 'faint', parent: S.tlG });
          for (var t = 0; t <= 180; t += 30) {
            ctx.line(X(t), 381, X(t), 389, { color: 'faint', parent: S.tlG });
            ctx.text(X(t), 400, t + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.tlG });
          }
          ctx.text(56, 245, 'attempt 1', { size: 13, font: 'mono', color: 'text', parent: S.tlG });
          ctx.text(56, 263, 'gpu-51', { size: 11, font: 'mono', color: 'dim', parent: S.tlG });
          ctx.text(56, 330, 'attempt 2', { size: 13, font: 'mono', color: 'text', parent: S.tlG });
          ctx.text(56, 348, 'gpu-17 (S1 done)', { size: 11, font: 'mono', color: 'dim', parent: S.tlG });
          ctx.rect(X(0), 244, X(180) - X(0), 22, { rx: 4, fill: 'rgba(255,255,255,0.02)', parent: S.tlG });
          ctx.rect(X(0), 329, X(180) - X(0), 22, { rx: 4, fill: 'rgba(255,255,255,0.02)', parent: S.tlG });
          diamond(ctx, X(0), 255, 6, 'cyan', S.tlG);
          ctx.text(X(0), 226, 'scheduled', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.tlG });
          S.ghost = ctx.rect(X(107), 329, X(180) - X(107), 22, { rx: 4, stroke: ctx.alpha('red', 0.7), sw: 1.2, dash: '5 4', parent: S.tlG, opacity: 0 });
          S.ghostT = ctx.text(X(180), 366, 'no checkpoint: 106 s → would end at 213 s', { size: 11, font: 'mono', color: '#ff9aad', anchor: 'end', parent: S.tlG, opacity: 0 });
          S.b1 = ctx.rect(X(4), 247, 0, 16, { rx: 3, fill: ctx.alpha('lime', 0.55), stroke: 'lime', sw: 1, parent: S.tlG });
          S.b2 = ctx.rect(X(107), 332, 0, 16, { rx: 3, fill: ctx.alpha('cyan', 0.55), stroke: 'cyan', sw: 1, parent: S.tlG });
          S.hb1 = []; S.hb2 = [];
          for (var j = 0; j < 7; j++) { var d1 = diamond(ctx, X(14 + 10 * j), 238, 4, 'teal', S.tlG); d1.setAttribute('opacity', 0); S.hb1.push(d1); }
          for (var k = 0; k < 4; k++) { var d2 = diamond(ctx, X(117 + 10 * k), 323, 4, 'teal', S.tlG); d2.setAttribute('opacity', 0); S.hb2.push(d2); }
          S.hbT = ctx.text(X(44), 226, 'heartbeat {step, ckpt}', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.tlG, opacity: 0 });
          S.crash = ctx.group({ parent: S.tlG });
          ctx.icon('bolt', X(78), 255, 22, 'red', { parent: S.crash });
          ctx.text(X(78), 226, 'Xid 79', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: S.crash });
          S.crash.setAttribute('opacity', 0);
          S.br = ctx.group({ parent: S.tlG });
          var brL = ctx.line(X(74), 284, X(74), 284, { color: 'red', sw: 1.6, parent: S.br });
          ctx.line(X(74), 279, X(74), 289, { color: 'red', sw: 1.4, parent: S.br });
          S.brL = brL;
          S.brT = ctx.text(X(89), 300, 'heartbeat_timeout 30 s', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: S.br, opacity: 0 });
          S.to = ctx.text(X(104), 257, '✕', { size: 17, weight: 700, color: 'red', anchor: 'middle', parent: S.tlG, opacity: 0 });
          S.retry = ctx.path('M' + X(104) + ',' + 268 + ' C' + X(104) + ',' + 312 + ' ' + X(107) + ',' + 300 + ' ' + X(107) + ',' + 328, { stroke: 'amber', sw: 1.6, arrow: true, parent: S.tlG, opacity: 0 });
          S.retryT = ctx.text(X(110), 312, 'retry · backoff 1 s', { size: 11, font: 'mono', color: 'amber', parent: S.tlG, opacity: 0 });
          S.done = ctx.text(X(153) + 8, 341, '✓ 153 s', { size: 13, font: 'mono', weight: 600, color: 'lime', parent: S.tlG, opacity: 0 });
          ctx.text(56, 426, 'schedule_to_start: queue wait · start_to_close 20 min: one attempt · heartbeat 30 s: liveness', { size: 12, font: 'mono', color: 'dim', parent: S.tlG });
          ctx.reveal(S.tlG, { from: 'up', delay: 300 });
          /* backoff */
          S.boG = ctx.group();
          panel(ctx, 36, 480, 540, 290, 'amber', S.boG);
          head(ctx, 56, 503, 'RETRY BACKOFF · delay per attempt', 'amber', S.boG);
          var ds = [1, 2, 4, 8, 16, 32, 60], rr = ctx.rng(5);
          S.boBars = ds.map(function (d, n) {
            var x = 90 + n * 66, h = 190 * d / 60;
            var g = ctx.group({ parent: S.boG });
            ctx.rect(x, 720 - h, 42, h, { rx: 3, fill: ctx.alpha('amber', 0.16), stroke: ctx.alpha('amber', 0.7), sw: 1, parent: g });
            ctx.circle(x + 21, 720 - h * (0.2 + 0.7 * rr()), 3.5, { fill: 'white', parent: g });
            ctx.text(x + 21, 720 - h - 12, d + ' s', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
            ctx.text(x + 21, 736, 'n=' + (n + 1), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            return g;
          });
          ctx.line(80, 720, 560, 720, { color: 'faint', parent: S.boG });
          ctx.text(56, 757, 'min(1 s·2ⁿ⁻¹, 60 s) · dot = jittered sample U(0, d)', { size: 11.5, font: 'mono', color: 'dim', parent: S.boG });
          ctx.reveal(S.boG, { from: 'up', delay: 400 });
          ctx.reveal(S.boBars, { from: 'up', delay: 600, stagger: 90, dist: 10 });
          S.pol = ctx.code({ x: 600, y: 480, w: 486, title: 'RetryPolicy · render_shot', lang: 'py', size: 12.5, color: 'amber', parent: S.boG, lines: nb([
            'RetryPolicy(',
            '  initial_interval=timedelta(seconds=1),',
            '  backoff_coefficient=2.0,',
            '  maximum_interval=timedelta(seconds=60),',
            '  maximum_attempts=8,',
            '  non_retryable_error_types=[',
            '    "PolicyViolation", "InvalidPrompt"])'
          ]) });
          ctx.text(620, 700, 'retry: Xid · CUDA OOM · preemption · 5xx · 429', { size: 12, font: 'mono', color: 'lime', parent: S.boG });
          ctx.text(620, 724, 'fail fast: policy violation · bad prompt', { size: 12, font: 'mono', color: '#ff9aad', parent: S.boG });
          var flags = {};
          function upd(tt) {
            S.b1.setAttribute('width', Math.max(0, X(Math.min(tt, 78)) - X(4)));
            S.hb1.forEach(function (d, j) { d.setAttribute('opacity', tt >= 14 + 10 * j ? 1 : 0); });
            S.hbT.setAttribute('opacity', tt >= 14 ? 1 : 0);
            if (tt >= 78 && !flags.crash) {
              flags.crash = 1;
              S.crash.setAttribute('opacity', 1);
              S.warm[0].body.setAttribute('fill', ctx.alpha('red', 0.3));
              S.warm[0].body.setAttribute('stroke-dasharray', '4 3');
              S.warm[0].subEl.textContent = 'Xid 79 · off bus';
              S.warm[0].subEl.setAttribute('fill', ctx.C.red);
              ctx.pulse(S.warm[0], { color: 'red', times: 2, dur: 400 });
            }
            if (tt >= 86 && !flags.s1) {
              flags.s1 = 1;
              S.gpu[0].subEl.textContent = 'S1 ✓ · polling';
            }
            S.brL.setAttribute('x2', X(Math.max(74, Math.min(tt, 104))));
            S.br.setAttribute('opacity', tt >= 78 ? 1 : 0);
            S.brT.setAttribute('opacity', tt >= 90 ? 1 : 0);
            S.to.setAttribute('opacity', tt >= 104 ? 1 : 0);
            S.retry.setAttribute('opacity', tt >= 105 ? 1 : 0);
            S.retryT.setAttribute('opacity', tt >= 105 ? 1 : 0);
            S.ghost.setAttribute('opacity', tt >= 107 ? 1 : 0);
            S.ghostT.setAttribute('opacity', tt >= 107 ? 1 : 0);
            if (tt >= 107 && !flags.a2) {
              flags.a2 = 1;
              S.gpu[0].subEl.textContent = 'S4 · attempt 2';
              ctx.pulse(S.gpu[0], { color: 'cyan', dur: 500 });
            }
            S.b2.setAttribute('width', Math.max(0, X(Math.min(tt, 153)) - X(107)));
            S.hb2.forEach(function (d, j) { d.setAttribute('opacity', tt >= 117 + 10 * j ? 1 : 0); });
            S.done.setAttribute('opacity', tt >= 153 ? 1 : 0);
          }
          upd(0);
          return ctx.wait(1000).then(function () {
            return ctx.tween(6500, function (e, raw) { upd(raw * 160); }, 'linear');
          }).then(function () {
            ctx.hud('dead GPU detected in 30 s, not 20 min');
            return ctx.wait(500);
          });
        }
      },
      /* 6 ------------------------------------------------------------------ */
      {
        title: 'Checkpoint & resume',
        say: 'Retrying from scratch would waste the steps already computed. So the render activity checkpoints its latent tensor every ten denoising steps: about ten megabytes to object storage, together with the step index and random state. The checkpoint URI rides in the heartbeat details. Attempt two reads those details, loads the latent at step thirty, and resumes. Only seven steps of work are lost instead of thirty seven, and the resumed trajectory is the one the first attempt was already on.',
        deep: '<p>Wan-2.x-style VAE (4× temporal, 8×8 spatial, 16 channels) on an 81-frame 720p clip (≈5&nbsp;s at 16&nbsp;fps):</p>' +
          '<div class="eq">z<sub>t</sub> ∈ ℝ<sup>16×21×90×160</sup> = 4.84 M values → 9.7 MB (bf16)</div>' +
          '<p>That is tiny next to the work it protects. This scene assumes ~2&nbsp;s per step on an 8-GPU sequence-parallel node (illustrative and optimistic: a 14B DiT at 720p with CFG is closer to 3–5&nbsp;s/step on 8×H100, which only strengthens the case). A checkpoint write (tens of ms to object storage, async) every 10 steps costs &lt;1% overhead either way.</p>' +
          '<ul><li><b>What to save</b>: z<sub>t</sub>, step index k, sampler state (multistep solvers such as DPM-Solver++/UniPC keep previous model outputs), RNG state if the sampler is stochastic, and a hash of the conditioning (prompt embedding, refs, seed, model version).</li>' +
          '<li><b>Where the URI travels</b>: <code>activity.heartbeat(ckpt_uri, k)</code>; the next attempt reads <code>activity.info().heartbeat_details</code>. No extra database needed.</li>' +
          '<li><b>Exactness</b>: deterministic ODE samplers (flow-matching Euler, DDIM) resume on the identical trajectory up to floating-point non-associativity across GPUs (bitwise differences, visually irrelevant).</li>' +
          '<li><b>Validate</b> the checkpoint (hash + model version) before resuming; a checkpoint from a different model build must be discarded.</li></ul>' +
          '<div class="eq">saved = 30 / 50 steps = 60% of this shot’s denoising compute</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.boG, 400);
          S.ckG = ctx.group();
          panel(ctx, 36, 480, 1050, 412, 'teal', S.ckG);
          head(ctx, 56, 503, 'CHECKPOINTED DENOISING · render_shot#4 · 50 steps', 'teal', S.ckG);
          S.cells = []; S.cells2 = [];
          ctx.text(52, 547, 'A1', { size: 11, font: 'mono', color: 'lime', parent: S.ckG });
          ctx.text(52, 575, 'A2', { size: 11, font: 'mono', color: 'cyan', parent: S.ckG });
          for (var i = 0; i < 50; i++) {
            S.cells.push(ctx.rect(70 + i * 20, 536, 18, 22, { rx: 3, fill: 'rgba(255,255,255,0.04)', stroke: 'line', sw: 1, parent: S.ckG }));
            S.cells2.push(ctx.rect(70 + i * 20, 564, 18, 22, { rx: 3, fill: 'rgba(255,255,255,0.04)', stroke: i < 30 ? 'rgba(0,0,0,0)' : 'line', sw: 1, parent: S.ckG }));
          }
          for (var s = 0; s <= 50; s += 10) ctx.text(70 + s * 20 - 1, 600, String(s), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.ckG });
          S.ck = [10, 20, 30].map(function (k) {
            var g = ctx.group({ parent: S.ckG });
            diamond(ctx, 69 + k * 20, 526, 6, 'teal', g);
            ctx.text(69 + k * 20 + 10, 525, 'ckpt', { size: 11, font: 'mono', color: 'teal', parent: g });
            g.setAttribute('opacity', 0);
            return g;
          });
          S.xk = ctx.text(70 + 37 * 20 + 9, 548, '✕', { size: 18, weight: 700, color: 'red', anchor: 'middle', parent: S.ckG, opacity: 0 });
          var leg = ctx.group({ parent: S.ckG });
          [['attempt 1 · gpu-51', 'lime', 70], ['lost · steps 31–37', 'red', 280], ['attempt 2 · resumed from 30', 'cyan', 460]].forEach(function (l) {
            ctx.rect(l[2], 616, 14, 12, { rx: 2, fill: ctx.alpha(l[1], 0.6), parent: leg });
            ctx.text(l[2] + 22, 622, l[0], { size: 12, font: 'mono', color: l[1], parent: leg });
          });
          /* latent tensor slabs */
          S.lat = ctx.group({ parent: S.ckG });
          for (var q = 5; q >= 0; q--) {
            var ox = 80 + q * 16, oy = 650 + q * 14;
            ctx.poly([[ox, oy + 30], [ox + 150, oy + 30], [ox + 180, oy], [ox + 30, oy]], { fill: ctx.alpha('violet', 0.12 + q * 0.05), stroke: ctx.alpha('violet', 0.8), parent: S.lat });
          }
          var rg = ctx.rng(9);
          for (var p = 0; p < 18; p++) ctx.circle(170 + rg() * 110, 735 + rg() * 20, 1.4, { fill: ctx.cmap('heat', rg()), parent: S.lat });
          ctx.text(60, 800, 'z_t ∈ ℝ^(16×21×90×160)', { size: 13, font: 'mono', color: 'violet', parent: S.ckG });
          ctx.text(60, 824, '4.84 M values · bf16 ≈ 9.7 MB', { size: 12, font: 'mono', color: 'dim', parent: S.ckG });
          ctx.text(60, 848, '+ step k · sampler state · RNG', { size: 12, font: 'mono', color: 'dim', parent: S.ckG });
          ctx.text(60, 872, 'write ≈ 10s of ms vs step ≈ 2 s', { size: 12, font: 'mono', color: 'teal', parent: S.ckG });
          S.s3 = ctx.node({ x: 440, y: 700, w: 170, h: 84, kind: 'cyl', title: 'ckpt store', sub: 'step30.safetensors', color: 'teal', titleSize: 14, subSize: 10.5, parent: S.ckG });
          S.sv = ctx.link({ x: 290, y: 690 }, S.s3, { to: 'l', color: 'teal', parent: S.ckG });
          S.code = ctx.code({ x: 560, y: 636, w: 516, title: 'render_shot · resumable activity', lang: 'py', size: 12, color: 'teal', parent: S.ckG, lines: nb([
            '@activity.defn',
            'async def render_shot(s: Shot) -> ArtifactRef:',
            '  hb = activity.info().heartbeat_details',
            '  ckpt = hb[0] if hb else None',
            '  k0, z = restore(ckpt, sampler) if ckpt else (0, noise(s.seed))',
            '  for k in range(k0, 50):',
            '    z = sampler.step(dit, z, sigmas[k], s.cond)',
            '    if (k + 1) % 10 == 0:  # z + sampler history, ~10 MB',
            '      ckpt = save(s.id, k + 1, z, sampler.state())',
            '    activity.heartbeat(ckpt, k + 1)',
            '  return put(vae.decode(z), key=s.idem_key)'
          ]) });
          S.hl = ctx.rect(564, 636 + 46 + 4 * 18.6 - 9, 508, 18, { rx: 3, fill: ctx.alpha('cyan', 0.14), stroke: ctx.alpha('cyan', 0.6), sw: 1, parent: S.ckG, opacity: 0 });
          ctx.reveal(S.ckG, { from: 'up', delay: 200 });
          function fillTo(n, col, from, row) {
            var cells = row === 2 ? S.cells2 : S.cells;
            return ctx.tween((n - from) * 70, function (e, raw) {
              var m = from + Math.round(raw * (n - from));
              for (var c = from; c < m; c++) { cells[c].setAttribute('fill', ctx.alpha(col, 0.6)); cells[c].setAttribute('stroke', col); }
            }, 'linear');
          }
          return ctx.wait(700).then(function () {
            var chain = Promise.resolve();
            [10, 20, 30].forEach(function (k, j) {
              chain = chain.then(function () { return fillTo(k, 'lime', j * 10); }).then(function () {
                ctx.fade(S.ck[j], 1, 200);
                return ctx.packet(S.sv, { color: 'teal', dur: 450 });
              });
            });
            return chain.then(function () { return fillTo(37, 'lime', 30); });
          }).then(function () {
            ctx.fade(S.xk, 1, 150);
            for (var c = 30; c < 37; c++) { S.cells[c].setAttribute('fill', ctx.alpha('red', 0.45)); S.cells[c].setAttribute('stroke', ctx.C.red); }
            return ctx.wait(700);
          }).then(function () {
            ctx.fade(S.hl, 1, 200);
            ctx.pulse(S.ck[2], { color: 'cyan', dur: 600 });
            return ctx.packet(S.sv, { color: 'cyan', dur: 600, reverse: true, label: 'load step 30' });
          }).then(function () {
            return fillTo(50, 'cyan', 30, 2);
          }).then(function () {
            ctx.hud('lost 7 steps, not 37 · saved 60% of the shot');
            return ctx.wait(500);
          });
        }
      },
      /* 7 ------------------------------------------------------------------ */
      {
        title: 'Idempotency & outbox',
        say: 'Retries mean activities run at least once, so side effects must be idempotent. Here the charge credits call succeeds at the billing service, but the worker dies before the acknowledgement is recorded. The retry sends the same idempotency key, derived from the workflow and activity IDs, and billing returns the stored result instead of charging twice. The same thinking applies to events. The shot service writes its state change and an outbox row in one database transaction, and a relay publishes the event afterwards, so the client never sees an event for a state that was not committed.',
        deep: '<p><b>Idempotency key</b> = stable across retries, unique per logical effect:</p>' +
          '<div class="eq">key = hash(workflow_id, activity_id) &nbsp;(never the attempt number)</div>' +
          '<ul><li>Server side: <code>INSERT INTO idem(key, status) ON CONFLICT DO NOTHING</code>; on conflict return the stored response (Stripe-style keys are kept ≥24&nbsp;h). Concurrent duplicate while <i>pending</i> → 409, client retries.</li>' +
          '<li>Object store: content-addressed keys (<code>sha256</code>) + conditional <code>PUT If-None-Match: *</code> make uploads naturally idempotent.</li>' +
          '<li>GPU renders: the render is deterministic given (seed, cond, model) — key the output path by that hash so a duplicate attempt overwrites identical bytes.</li></ul>' +
          '<p><b>Transactional outbox</b> solves the dual-write problem (DB commit + Kafka publish cannot be atomic):</p>' +
          '<pre>BEGIN;\n UPDATE shots SET state=\'ready\',\n   uri=$1 WHERE id=$2;\n INSERT INTO outbox(event_id,\n   topic, payload) VALUES (...);\nCOMMIT;\n-- relay (poller / Debezium CDC)\n-- publishes, then marks sent</pre>' +
          '<p>Delivery is at-least-once, so consumers (the SSE gateway) dedupe by <code>event_id</code>. Inside Temporal itself, workflow code already gets this for free: commands and state commit atomically with the history.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.tlG, 400); ctx.remove(S.ckG, 400); ctx.remove(S.wrkG, 400);
          S.idG = ctx.group();
          var L = ctx.group({ parent: S.idG });
          panel(ctx, 36, 165, 756, 715, 'magenta', L);
          head(ctx, 56, 190, 'IDEMPOTENCY KEYS · exactly-once effect on at-least-once calls', 'magenta', L);
          var XA = 170, XB = 650;
          var nA = ctx.node({ x: XA, y: 240, w: 230, h: 60, title: 'charge_credits', sub: 'activity · attempt 1→2', icon: 'server', color: 'amber', titleSize: 14, subSize: 11, parent: L });
          var nB = ctx.node({ x: XB, y: 240, w: 220, h: 60, title: 'Billing API', sub: 'external service', icon: 'lock', color: 'magenta', titleSize: 14, subSize: 11, parent: L });
          ctx.line(XA, 272, XA, 690, { color: ctx.alpha('amber', 0.5), dash: '4 6', parent: L });
          ctx.line(XB, 272, XB, 610, { color: ctx.alpha('magenta', 0.5), dash: '4 6', parent: L });
          var M = [
            [320, 1, 'POST /charges  Idempotency-Key: 7f3/charge  120 cr', 'amber'],
            [380, -1, '201 {charge_id: ch_91}', 'lime'],
            [490, 1, 'retry: POST /charges  Idempotency-Key: 7f3/charge', 'amber'],
            [550, -1, '200 {charge_id: ch_91}  (stored response)', 'lime']
          ];
          S.im = M.map(function (m) {
            var x1 = m[1] > 0 ? XA + 4 : XB - 4, x2 = m[1] > 0 ? XB - 6 : XA + 6;
            var p = ctx.path('M' + x1 + ',' + m[0] + ' L' + x2 + ',' + m[0], { stroke: m[3], sw: 1.6, arrow: true, parent: L, opacity: 0 });
            var t = ctx.text((XA + XB) / 2, m[0] - 13, m[2], { size: 12.5, font: 'mono', color: m[3], anchor: 'middle', parent: L, opacity: 0 });
            return [p, t];
          });
          S.lost = ctx.group({ parent: L });
          ctx.text(300, 383, '✕', { size: 22, weight: 700, color: 'red', anchor: 'middle', parent: S.lost });
          ctx.text(XA + 8, 425, 'worker dies before the result is recorded', { size: 12, font: 'mono', color: '#ff9aad', parent: S.lost });
          ctx.text(XA + 8, 446, '→ start_to_close timeout → attempt 2', { size: 12, font: 'mono', color: 'amber', parent: S.lost });
          S.lost.setAttribute('opacity', 0);
          /* dedup table */
          S.tbl = ctx.group({ parent: L });
          panel(ctx, 430, 620, 340, 110, 'magenta', S.tbl);
          ctx.text(446, 642, 'idempotency table (billing DB)', { size: 11.5, font: 'mono', color: 'magenta', parent: S.tbl });
          ctx.text(446, 668, 'key', { size: 11, font: 'mono', color: 'dim', parent: S.tbl });
          ctx.text(600, 668, 'response', { size: 11, font: 'mono', color: 'dim', parent: S.tbl });
          ctx.line(446, 678, 754, 678, { color: 'line', sw: 1, parent: S.tbl });
          S.row = ctx.group({ parent: S.tbl });
          ctx.text(446, 700, '7f3/charge', { size: 12.5, font: 'mono', color: 'text', parent: S.row });
          ctx.text(600, 700, '201 ch_91', { size: 12.5, font: 'mono', color: 'lime', parent: S.row });
          S.row.setAttribute('opacity', 0);
          S.hit = ctx.label(600, 755, 'HIT → no second charge', { color: 'lime', size: 12, parent: L });
          S.hit.setAttribute('opacity', 0);
          ctx.text(56, 800, 'key = hash(workflow_id, activity_id)', { size: 14, font: 'mono', color: 'white', parent: L });
          ctx.text(56, 826, 'stable across retries · never include the attempt number', { size: 12, font: 'mono', color: 'dim', parent: L });
          ctx.text(56, 850, 'uploads: content-addressed keys + PUT If-None-Match', { size: 12, font: 'mono', color: 'dim', parent: L });
          ctx.reveal(L, { from: 'left' });
          /* outbox */
          var R = ctx.group({ parent: S.idG });
          panel(ctx, 816, 165, 748, 715, 'teal', R);
          head(ctx, 836, 190, 'TRANSACTIONAL OUTBOX · state + event atomically', 'teal', R);
          S.svc = ctx.node({ x: 960, y: 260, w: 220, h: 60, title: 'Shot service', sub: 'shot 4 → ready', icon: 'server', color: 'cyan', titleSize: 14, subSize: 11, parent: R });
          S.db = ctx.node({ x: 960, y: 440, w: 220, h: 150, kind: 'cyl', color: 'teal', parent: R });
          ctx.text(960, 390, 'PostgreSQL', { size: 14, font: 'display', weight: 600, color: 'white', anchor: 'middle', parent: R });
          S.tShots = ctx.label(960, 430, 'shots: state=ready', { color: 'cyan', size: 12, parent: R });
          S.tOut = ctx.label(960, 470, 'outbox: evt_7c1 pending', { color: 'amber', size: 12, parent: R });
          S.relay = ctx.node({ x: 1230, y: 440, w: 170, h: 60, title: 'Relay / CDC', sub: 'Debezium · poll', icon: 'loop', color: 'teal', titleSize: 14, subSize: 11, parent: R });
          S.kafka = ctx.node({ x: 1450, y: 440, w: 170, h: 60, title: 'Kafka', sub: 'job-events', icon: 'queue', color: 'orange', titleSize: 14, subSize: 11, parent: R });
          S.sse = ctx.node({ x: 1450, y: 620, w: 170, h: 60, title: 'SSE gateway', sub: 'dedupe event_id', icon: 'net', color: 'cyan', titleSize: 14, subSize: 11, parent: R });
          S.client = ctx.node({ x: 1230, y: 620, w: 170, h: 60, title: 'Client', sub: 'shot.ready', icon: 'phone', color: 'cyan', titleSize: 14, subSize: 11, parent: R });
          S.o1 = ctx.link(S.svc, S.db, { from: 'b', to: 't', color: 'teal', parent: R, label: 'one tx', labelDx: 38, labelDy: 0 });
          S.o2 = ctx.link(S.db, S.relay, { from: 'r', to: 'l', color: 'teal', parent: R });
          S.o3 = ctx.link(S.relay, S.kafka, { from: 'r', to: 'l', color: 'orange', parent: R });
          S.o4 = ctx.link(S.kafka, S.sse, { from: 'b', to: 't', color: 'orange', parent: R });
          S.o5 = ctx.link(S.sse, S.client, { from: 'l', to: 'r', color: 'cyan', parent: R });
          ctx.text(836, 740, '✕ dual write: commit DB, then publish → crash in between = lost or phantom event', { size: 12, font: 'mono', color: '#ff9aad', parent: R });
          ctx.text(836, 766, '✓ outbox: event row commits with the state; relay publishes after commit', { size: 12, font: 'mono', color: 'lime', parent: R });
          ctx.text(836, 792, '  at-least-once delivery → consumers dedupe by event_id', { size: 12, font: 'mono', color: 'dim', parent: R });
          ctx.text(836, 830, 'Temporal workflows get this for free: commands + state', { size: 12, font: 'mono', color: 'teal', parent: R });
          ctx.text(836, 852, 'commit atomically with the event history.', { size: 12, font: 'mono', color: 'teal', parent: R });
          ctx.reveal(R, { from: 'right', delay: 200 });
          function msg(k) {
            var m = S.im[k];
            m[0].setAttribute('opacity', 1);
            ctx.fade(m[1], 1, 200);
            return ctx.reveal(m[0], { from: 'draw', dur: 300 }).then(function () { return ctx.packet(m[0], { color: M[k][3], dur: 500, r: 4 }); });
          }
          return ctx.wait(600).then(function () { return msg(0); }).then(function () {
            ctx.fade(S.row, 1, 250);
            return ctx.pulse(S.tbl, { color: 'magenta', dur: 500 });
          }).then(function () { return msg(1); }).then(function () {
            ctx.fade(S.im[1][0], 0.35, 200);
            ctx.fade(S.lost, 1, 250);
            nA.body.setAttribute('stroke', ctx.C.red);
            return ctx.wait(700);
          }).then(function () {
            nA.body.setAttribute('stroke', ctx.C.amber);
            return msg(2);
          }).then(function () {
            ctx.pulse(S.row, { color: 'lime', dur: 500 });
            ctx.fade(S.hit, 1, 250);
            return msg(3);
          }).then(function () {
            return ctx.packet(S.o1, { color: 'teal', dur: 600, label: 'BEGIN…COMMIT' });
          }).then(function () {
            ctx.pulse(S.tShots, { color: 'cyan', dur: 400 }); ctx.pulse(S.tOut, { color: 'amber', dur: 400 });
            return ctx.packet(S.o2, { color: 'teal', dur: 500, label: 'poll' });
          }).then(function () { return ctx.packet(S.o3, { color: 'orange', dur: 450 }); })
            .then(function () { return ctx.packet(S.o4, { color: 'orange', dur: 450 }); })
            .then(function () { return ctx.packet(S.o5, { color: 'cyan', dur: 450, label: 'evt_7c1' }); });
        }
      },
      /* 8 ------------------------------------------------------------------ */
      {
        title: 'Sagas',
        say: 'Some failures are final. Suppose the output safety check rejects the final cut. There is no global transaction spanning a payment system, a GPU scheduler and object storage, so the workflow runs a saga. Each forward step registered its compensation before it ran. On failure, the compensations run in reverse order: delete the partial renditions, delete the rendered clips, release the GPU quota, and refund the credits. Compensations are activities too, so they are retried until they succeed.',
        deep: '<p>A <b>saga</b> (Garcia-Molina &amp; Salem, 1987) replaces one ACID transaction T with a sequence T<sub>1</sub>…T<sub>n</sub> and compensations C<sub>1</sub>…C<sub>n−1</sub>. The only guarantees are:</p>' +
          '<div class="eq">T<sub>1</sub>T<sub>2</sub>…T<sub>n</sub> &nbsp;or&nbsp; T<sub>1</sub>…T<sub>j</sub>C<sub>j</sub>…C<sub>1</sub></div>' +
          '<ul><li><b>Semantic, not physical, undo</b>: a refund is a new ledger entry; an email cannot be unsent — put irreversible steps (publish, notify) last, after the pivot.</li>' +
          '<li>Register the compensation <i>before</i> calling the step: a timed-out <code>reserve_gpu_quota</code> may still have succeeded.</li>' +
          '<li>Compensations must be <b>idempotent and retried forever</b> (or until a human is paged); a durable engine makes “forever” real.</li>' +
          '<li>No isolation: other readers may observe intermediate states (the creator briefly sees credits reserved). Use semantic locks / pending states if that matters.</li>' +
          '<li>Orchestrated sagas (one workflow owns the order) are far easier to reason about than choreographed ones (services reacting to each other’s events).</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.idG, 450);
          S.sg = ctx.group();
          head(ctx, 60, 190, 'SAGA · forward steps T₁…T₅ with compensations C₁…C₄ (reverse order on failure)', 'magenta', S.sg);
          var F = [['reserve_credits', '120 cr hold', 'magenta'], ['reserve_gpu_quota', '6 × 8 GPUs', 'red'], ['render_shots ×6', 's3://…/shot*', 'lime'], ['edit_and_encode', 'cut + ladder', 'orange'], ['publish_to_cdn', 'irreversible', 'cyan']];
          var Cm = ['refund_credits', 'release_quota', 'delete_partial_assets', 'delete_renditions'];
          S.fw = F.map(function (f, i) { return ctx.node({ x: 190 + i * 305, y: 290, w: 250, h: 70, title: f[0], sub: f[1], color: f[2], titleSize: 15, subSize: 11, parent: S.sg }); });
          S.cp = Cm.map(function (c, i) { return ctx.node({ x: 190 + i * 305, y: 470, w: 250, h: 60, title: c, sub: 'C' + (i + 1) + ' · idempotent', color: 'pink', kind: 'box', titleSize: 14, subSize: 11, parent: S.sg }); });
          S.fl = []; S.vl = []; S.bl = [];
          for (var i = 0; i < 4; i++) {
            S.fl.push(ctx.link(S.fw[i], S.fw[i + 1], { from: 'r', to: 'l', color: 'lime', parent: S.sg }));
            S.vl.push(ctx.link(S.fw[i], S.cp[i], { from: 'b', to: 't', color: ctx.alpha('pink', 0.5), dash: '3 5', arrow: false, parent: S.sg }));
          }
          for (var j = 3; j > 0; j--) S.bl.push(ctx.link(S.cp[j], S.cp[j - 1], { from: 'l', to: 'r', color: 'red', parent: S.sg }));
          S.bl.forEach(function (l) { l.setAttribute('opacity', 0); });
          ctx.text(1410, 470, 'irreversible → last', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.sg });
          ctx.reveal(S.fw, { from: 'up', stagger: 120 });
          ctx.reveal(S.cp, { from: 'down', delay: 500, stagger: 120, opacity: 0.35 });
          ctx.reveal(S.vl, { from: 'draw', delay: 600 });
          ctx.reveal(S.fl, { from: 'draw', delay: 300, stagger: 120 });
          S.x = ctx.group({ parent: S.sg });
          ctx.text(1105, 236, '✕ PolicyViolation (output safety) · non-retryable', { size: 13, font: 'mono', weight: 600, color: 'red', anchor: 'middle', parent: S.x });
          S.x.setAttribute('opacity', 0);
          S.sc = ctx.code({ x: 250, y: 580, w: 1100, title: 'saga inside the workflow (Python SDK style)', lang: 'py', size: 13.5, color: 'magenta', parent: S.sg, lines: nb([
            'undo = []',
            'try:',
            '    undo.append(refund_credits);    await act(reserve_credits, job)',
            '    undo.append(release_quota);     await act(reserve_gpu_quota, job)',
            '    undo.append(delete_partial);    shots = await render_all(board)',
            '    undo.append(delete_renditions); cut = await act(edit_and_encode, shots)   # raises PolicyViolation',
            '    await act(publish_to_cdn, cut)                                          # pivot: after this, no undo',
            'except ActivityError:',
            '    for c in reversed(undo): await act(c, job)   # retried until success; each one idempotent',
            '    raise'
          ]) });
          ctx.reveal(S.sc, { from: 'up', delay: 700 });
          return ctx.wait(1200).then(function () {
            var chain = Promise.resolve();
            [0, 1, 2].forEach(function (k) {
              chain = chain.then(function () {
                S.cp[k].setAttribute('data-op', 1);
                ctx.fade(S.cp[k], 1, 200);
                return ctx.packet(S.fl[k], { color: 'lime', dur: 450 });
              });
            });
            return chain;
          }).then(function () {
            ctx.fade(S.cp[3], 1, 200);
            S.fw[3].body.setAttribute('stroke', ctx.C.red);
            ctx.fade(S.x, 1, 250);
            ctx.fade(S.fw[4], 0.3, 300);
            return ctx.pulse(S.fw[3], { color: 'red', times: 2, dur: 450 });
          }).then(function () {
            S.cp[3].body.setAttribute('fill', ctx.alpha('pink', 0.18));
            return ctx.packet(S.vl[3], { color: 'red', dur: 450 });
          }).then(function () {
            var chain = Promise.resolve();
            S.bl.forEach(function (l, k) {
              chain = chain.then(function () {
                l.setAttribute('opacity', 1);
                return ctx.reveal(l, { from: 'draw', dur: 300 });
              }).then(function () { return ctx.packet(l, { color: 'red', dur: 500 }); }).then(function () {
                var c = S.cp[2 - k];
                c.body.setAttribute('fill', ctx.alpha('pink', 0.18));
                return ctx.pulse(c, { color: 'pink', dur: 450 });
              });
            });
            return chain;
          }).then(function () {
            ctx.hud('T₁T₂T₃T₄✕ → C₄C₃C₂C₁ · credits refunded');
            return ctx.wait(500);
          });
        }
      },
      /* 9 ------------------------------------------------------------------ */
      {
        title: 'The whole run',
        say: 'Here is the whole trailer workflow on one timeline. After the storyboard, the workflow waits on a signal for the creator\'s approval, holding no worker and no GPU while it waits. The client can query progress at any time without changing history. Shot four loses its GPU mid-render, times out on heartbeat, and resumes from its checkpoint on another node. And when we deploy a new critic, patching and worker versioning let in-flight histories keep replaying the old code path. Every side effect happens once, and the film finishes despite the crash.',
        deep: '<ul><li><b>Signals</b> (<code>approve_storyboard</code>): async messages appended to history; the workflow sleeps in <code>wait_condition</code> with zero workers held — waiting 7 minutes or 7 days costs the same. A durable timer can send a reminder or auto-cancel after 48&nbsp;h.</li>' +
          '<li><b>Queries</b> (<code>progress()</code>): synchronous, read-only, served by replaying/cached state; never recorded in history.</li>' +
          '<li><b>Updates</b> (<code>change_music(style)</code>): validated, recorded, return a result — a signal plus a response.</li>' +
          '<li><b>Versioning</b>: <code>if workflow.patched("critic-v2"): …</code> writes a marker so new runs take the new branch while old histories replay the old one; or <b>worker versioning</b> (build IDs / deployment versions) pins running workflows to the build that started them.</li>' +
          '<li><b>continue_as_new</b> for workflows that would exceed history limits (e.g. a series generator looping over episodes).</li></ul>' +
          '<pre>critical path\n = 12 + 10 + 18        plan/script/board\n + [human approval]    0 workers held\n + 4                   S4 waits for warm node\n + 149                 S4: attempt 1 + 2\n + 10 + 14 + 3         critic/edit/publish\n ≈ 220 s compute\nS4: 74 s attempt 1, 14 s of it lost\n    (steps 31–37), 29 s to detect +\n    reschedule, 46 s resumed from\n    step 30 on gpu-17</pre>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.sg, 450);
          S.full = ctx.group();
          var G = S.full;
          function X(t) { return 250 + t * 5.8; }
          var rows = [
            ['plan', [[0, 12, 'amber']]], ['script', [[12, 22, 'amber']]], ['storyboard', [[22, 40, 'violet']]],
            ['shot 1', [[40, 122, 'lime']]], ['shot 2', [[40, 135, 'lime']]], ['shot 3', [[40, 128, 'lime']]],
            ['shot 4', [[44, 118, 'lime'], [118, 147, 'red'], [147, 193, 'cyan']]], ['shot 5', [[44, 134, 'lime']]], ['shot 6', [[44, 120, 'lime']]],
            ['audio', [[50, 80, 'orange']]], ['critic', [[193, 203, 'violet']]], ['edit+encode', [[203, 217, 'orange']]], ['publish', [[217, 220, 'cyan']]]
          ];
          ctx.text(60, 186, 'TRAILER WORKFLOW trailer-7f3 · compute-time axis', { size: 13, font: 'mono', weight: 600, color: 'magenta', parent: G, spacing: 1.2 });
          for (var t = 0; t <= 210; t += 30) {
            ctx.line(X(t), 212, X(t), 690, { color: 'faint', sw: 1, dash: '2 6', parent: G });
            ctx.text(X(t), 702, t + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          }
          S.bars = [];
          rows.forEach(function (r, i) {
            var y = 226 + i * 35;
            ctx.text(235, y, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: G });
            r[1].forEach(function (seg) {
              var b = ctx.rect(X(seg[0]), y - 11, 0, 22, { rx: 4, fill: ctx.alpha(seg[2], seg[2] === 'red' ? 0.18 : 0.5), stroke: seg[2], sw: 1, dash: seg[2] === 'red' ? '4 3' : null, parent: G });
              S.bars.push({ el: b, t0: seg[0], t1: seg[1] });
            });
          });
          /* approval gate */
          S.gate = ctx.group({ parent: G });
          ctx.line(X(40), 205, X(40), 690, { color: 'cyan', sw: 2, dash: '6 4', parent: S.gate });
          ctx.label(X(40) + 8, 205, '⏸ signal approve_storyboard · human 7 min · 0 workers held', { color: 'cyan', size: 11.5, anchor: 'start', parent: S.gate });
          S.gate.setAttribute('opacity', 0);
          S.s4 = ctx.group({ parent: G });
          ctx.icon('bolt', X(118), 436, 20, 'red', { parent: S.s4 });
          ctx.text(X(132.5), 454, 'hb timeout', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: S.s4 });
          ctx.text(X(170), 454, 'resume @ step 30', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.s4 });
          S.s4.setAttribute('opacity', 0);
          S.ph = ctx.line(X(0), 208, X(0), 690, { color: 'white', sw: 1.5, parent: G, opacity: 0.8 });
          /* signals / queries / versioning */
          var I = ctx.group({ parent: G });
          var items = [
            ['signal', 'approve_storyboard(user=creator)', 'durable wait, no worker or GPU held', 'cyan'],
            ['query', 'progress() → {"shots_done": 4, "eta_s": 38}', 'read-only, never written to history', 'teal'],
            ['update', 'change_music(style="synth")', 'validated, recorded, returns a result', 'amber'],
            ['version', 'workflow.patched("critic-v2")', 'old histories replay the old branch', 'magenta']
          ];
          S.items = items.map(function (it, k) {
            var g = ctx.group({ parent: I });
            var y = 740 + k * 34;
            ctx.label(100, y, it[0], { color: it[3], size: 12, w: 80, parent: g });
            ctx.text(156, y, it[1], { size: 13, font: 'mono', color: 'white', parent: g });
            ctx.text(1540, y, it[2], { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: g });
            return g;
          });
          ctx.reveal(G, { dur: 400 });
          ctx.reveal(S.items, { from: 'left', delay: 600, stagger: 150 });
          var flags = {};
          function upd(tt) {
            S.bars.forEach(function (b) { b.el.setAttribute('width', Math.max(0, X(Math.min(tt, b.t1)) - X(b.t0)) * (tt > b.t0 ? 1 : 0)); });
            S.ph.setAttribute('x1', X(tt)); S.ph.setAttribute('x2', X(tt));
            if (tt >= 40 && !flags.g) { flags.g = 1; S.gate.setAttribute('opacity', 1); }
            if (tt >= 118 && !flags.c) { flags.c = 1; S.s4.setAttribute('opacity', 1); }
          }
          upd(0);
          return ctx.wait(700).then(function () {
            return ctx.tween(2200, function (e, raw) { upd(raw * 40); }, 'linear');
          }).then(function () {
            ctx.pulse(S.gate, { color: 'cyan', dur: 700 });
            return ctx.wait(900);
          }).then(function () {
            return ctx.tween(5200, function (e, raw) { upd(40 + raw * 180); }, 'linear');
          }).then(function () {
            ctx.fade(S.ph, 0, 400);
            ctx.hud('220 s compute · 1 GPU loss survived');
            return ctx.wait(600);
          });
        }
      }
    ]
  });
})();
