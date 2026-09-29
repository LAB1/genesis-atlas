/* L2 — Durable Workflow Execution. Temporal/Cadence-style event-sourced workflows: deterministic replay,
 * task queues, timeouts + heartbeats + retries, checkpointed diffusion, idempotency, outbox, sagas, signals.
 * Beat format: every step is split into beats (say + card + deep + a gated animation segment). */
(function () {
  var LH = 12.5 * 1.55;
  function lineY(n) { return 165 + 46 + n * LH; }
  function nb(lines) { return lines.map(function (s) { return s.replace(/^ +/, function (m) { return ' '.repeat(m.length); }); }); }
  function hide(list) { [].concat(list).forEach(function (e) { if (e) e.setAttribute('opacity', 0); }); }
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
      'Temporal Technologies, <i>Temporal documentation: Workflows, Activities, Signals, Event History, Retry Policies, Versioning</i>, 2024–2025',
      'Uber Engineering, <i>Conducting Better Business with Uber\'s Open Source Orchestration Tool, Cadence</i>, Uber Blog 2019',
      'Burckhardt et al., <i>Durable Functions: Semantics for Stateful Serverless</i>, OOPSLA 2021',
      'Garcia-Molina &amp; Salem, <i>Sagas</i>, ACM SIGMOD 1987',
      'Helland, <i>Life beyond Distributed Transactions: an Apostate\'s Opinion</i>, CIDR 2007',
      'Brooker, <i>Exponential Backoff and Jitter</i>, AWS Architecture Blog, 2015',
      'Llama Team, Meta AI, <i>The Llama 3 Herd of Models</i>, 2024',
      'Richardson, <i>Pattern: Transactional Outbox</i>, microservices.io'
    ],
    steps: [
      /* 1 ------------------------------------------------------------------ */
      {
        title: 'Workflow vs activities',
        beats: [
          {
            say: 'A thirty second trailer is a long-running distributed transaction: minutes of GPU time, paid API calls, and a human approval that may take hours. Something will crash along the way.',
            card: { tag: 'NUMBERS', title: 'Failure is the steady state', stat: { v: '419', l: 'unexpected interruptions in 54 days on Meta\'s 16,384-GPU Llama 3 job' },
              more: '<p>Llama 3 log: 419 unexpected interruptions in 54 days (1,296 h). Assuming all 16,384 GPUs ran the whole time, that is ≈ 21 M GPU-hours, about one interruption per 50,700 GPU-hours. One trailer burns 6 shots × 8 GPUs × ~95 s ≈ 1.3 GPU-hours, so P(hit) ≈ 2.5·10<sup>−5</sup> per trailer. A 10,000-GPU render fleet running flat out logs about 5 such interruptions a day, before counting node drains, preemptions and deploys.</p>' },
            deep: '<p><b>Why:</b> at fleet scale failure is routine. Meta logged 419 unexpected interruptions in 54 days on a 16k-H100 job, about one every 3 hours, roughly 78% attributed to confirmed or suspected hardware issues. That is one interruption per ~50,000 GPU-hours.</p>' +
              '<p>A single 6-shot trailer (48 GPUs for under two minutes) almost never meets one. But at the same rate a 10,000-GPU fleet meets a few per day, and node drains, preemptions and deploys are far more frequent. The trailer also waits on a human and calls paid APIs, so it must survive all of them.</p>'
          },
          {
            say: 'Durable execution splits the program in two. Workflow code is the orchestration logic: it decides what happens next, and it must be deterministic.',
            card: { tag: 'TRADE-OFF', title: 'Determinism is the price', body: 'Workflow code may not read the clock, roll dice, spawn threads or touch the network. In return it can be <b>replayed</b> anywhere, any time.' },
            deep: '<p>Workflow code is the <b>orchestration logic</b>: it decides what to do next, and it must be <b>deterministic given its history</b>. It runs on a workflow worker and may last from seconds to months.</p>' +
              '<p>Forbidden inside a workflow: wall clock, random numbers, threads, network calls. Deterministic substitutes: <code>workflow.now()</code>, <code>workflow.random()</code>, <code>workflow.sleep()</code> (a durable timer) and <code>workflow.uuid4()</code>, each recorded in or derived from history.</p>' +
              '<p><span class="muted">The code on the stage is Temporal-style pseudocode: <code>act(f, x, …)</code> abbreviates <code>workflow.execute_activity(f, x, start_to_close_timeout=…, heartbeat_timeout=…, retry_policy=…)</code>.</span></p>'
          },
          {
            say: 'Activities are the side effects: LLM calls, renders, payments and uploads. They may fail and be retried, so they must be idempotent.',
            card: { tag: 'KEY IDEA', title: 'Activities run at least once', body: 'Anything that touches the world lives in an activity: <b>retried by policy</b>, bounded by timeouts, and idempotent by design.' },
            deep: '<table><tr><th></th><th>Workflow code</th><th>Activity</th></tr>' +
              '<tr><td>Does</td><td>decides what to do next</td><td>does it (I/O, GPU, APIs)</td></tr>' +
              '<tr><td>Must be</td><td>deterministic given history</td><td>idempotent (runs ≥1×)</td></tr>' +
              '<tr><td>Forbidden</td><td>wall clock, random, threads, network</td><td>—</td></tr>' +
              '<tr><td>Failure</td><td>replayed on another worker</td><td>retried by policy</td></tr>' +
              '<tr><td>Duration</td><td>seconds → months</td><td>ms → hours (with heartbeats)</td></tr></table>'
          },
          {
            say: 'A service in the middle, Temporal style, records everything the workflow decides and hands out work through task queues.',
            card: { tag: 'HOW IT WORKS', title: 'A log and three queues', body: 'The service keeps the append-only <b>event history</b> and matches tasks to workers through named <b>task queues</b>. Workers only ever pull.' },
            deep: '<p>The Temporal service is made of four services: a <b>frontend</b> (API gateway), a <b>history</b> service that owns each workflow\'s append-only event log, a <b>matching</b> service that owns the task queues, and an internal worker service for background jobs. Cadence (open-sourced by Uber in 2017) is the ancestor; Azure Durable Functions (Burckhardt et al., 2021) formalized the same semantics.</p>' +
              '<div class="note">The engine gives <b>effectively-once workflow logic</b> on top of <b>at-least-once activities</b>. Exactly-once <i>effects</i> additionally need idempotent activities (step 7).</div>'
          },
          {
            say: 'Watch one round trip. The workflow emits a command to schedule plan trailer, an activity worker polls it from a queue and runs the language model call, and the result flows back into the history.',
            card: { tag: 'HOW IT WORKS', title: 'Commands out, results in', body: 'The workflow only <b>emits commands</b>. Results arrive later as events that unblock the awaiting line of code.' },
            deep: '<ol><li>A workflow task runs code until every coroutine is blocked and returns commands: <code>ScheduleActivityTask(plan_trailer)</code>.</li>' +
              '<li>The server appends <i>ActivityTaskScheduled</i> and enqueues a task on <code>activity-tq</code>.</li>' +
              '<li>An activity worker long-polls, receives it, runs the LLM call, and reports the result.</li>' +
              '<li>The server appends <i>ActivityTaskCompleted</i> (payload = an <code>ArtifactRef</code>, not bytes) and schedules a new workflow task.</li></ol>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          S.codeG = ctx.group();
          S.code = ctx.code({ x: 36, y: 165, w: 540, title: 'trailer_workflow.py · runs on a Workflow Worker', lang: 'py', size: 12.5, color: 'magenta', parent: S.codeG, lines: nb(CODE) });
          S.cur = ctx.rect(40, lineY(4) - 10, 532, 20, { rx: 3, fill: ctx.alpha('amber', 0.14), stroke: ctx.alpha('amber', 0.6), sw: 1, parent: S.codeG, opacity: 0 });
          S.res = ctx.text(566, lineY(4) + 0.5, '→ plan.json (ref)', { size: 11.5, font: 'mono', color: 'lime', anchor: 'end', parent: S.codeG, opacity: 0 });
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
          /* workers */
          S.wrkG = ctx.group();
          S.wA = ctx.node({ x: 1345, y: 250, w: 400, h: 72, title: 'Workflow Worker A', sub: 'runs workflow code · sticky cache', icon: 'code', color: 'magenta', parent: S.wrkG });
          S.wAct = ctx.node({ x: 1345, y: 420, w: 400, h: 72, title: 'Activity Worker', sub: 'LLM · storage · payments', icon: 'server', color: 'amber', parent: S.wrkG });
          S.pool = ctx.node({ x: 1345, y: 628, w: 420, h: 116, kind: 'ghost', color: 'red', parent: S.wrkG });
          S.poolT = ctx.text(1145, 552, 'GPU RENDER POOL · 8×H100 per node', { size: 12, font: 'mono', color: 'red', parent: S.wrkG });
          S.gpu = ['gpu-17', 'gpu-42', 'gpu-88'].map(function (n, i) {
            return ctx.node({ x: 1210 + i * 135, y: 632, w: 120, h: 60, kind: 'chip', title: n, sub: 'idle', color: 'red', titleSize: 14, subSize: 11, parent: S.wrkG });
          });
          /* links */
          S.qlWf = ctx.link({ x: 1066, y: 630 }, S.wA, { from: 'r', to: 'l', curve: 0.25, color: ctx.alpha('magenta', 0.6), dash: '4 5', parent: S.srvG });
          S.qlAct = ctx.link({ x: 1066, y: 672 }, S.wAct, { from: 'r', to: 'l', curve: 0.25, color: ctx.alpha('amber', 0.6), dash: '4 5', parent: S.srvG });
          S.qlGpu = ctx.link({ x: 1066, y: 714 }, S.pool, { from: 'r', to: 'l', curve: 0.3, color: ctx.alpha('red', 0.6), dash: '4 5', parent: S.srvG });
          S.cmdL = ctx.link(S.wA, { x: 1086, y: 250 }, { from: 'l', color: 'magenta', parent: S.srvG });
          hide([S.codeG, S.actG, S.srvG, S.wA, S.wAct, S.pool, S.poolT, S.qlWf, S.qlAct, S.qlGpu, S.cmdL]); hide(S.gpu);
          /* beat 0: the program we must not lose */
          return ctx.reveal(S.codeG, { from: 'left' }).then(function () {
            ctx.hud('Llama 3: 419 unexpected interruptions, 54 days');
            return ctx.pulse(S.code, { color: 'red', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: workflow code, on a workflow worker */
            ctx.hud('');
            return Promise.all([ctx.reveal(S.wA, { from: 'right' }), ctx.fade(S.cur, 1, 400)]).then(function () {
              return ctx.pulse(S.cur, { color: 'amber', times: 2, dur: 500 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: activities and the workers that run them */
            return Promise.all([
              ctx.reveal(S.actG, { from: 'up' }),
              ctx.reveal([S.wAct, S.pool, S.poolT], { from: 'right', delay: 200, stagger: 150 }),
              ctx.reveal(S.gpu, { from: 'scale', delay: 600, stagger: 100 })
            ]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the service in the middle */
            return ctx.reveal(S.srvG, { from: 'scale', s0: 0.95 }).then(function () {
              return ctx.reveal([S.qlWf, S.qlAct, S.qlGpu, S.cmdL], { from: 'draw', stagger: 120 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: one round trip */
            ctx.pulse(S.cur, { color: 'amber', dur: 600 });
            return ctx.packet(S.cmdL, { color: 'magenta', dur: 800, label: 'ScheduleActivityTask' }).then(function () {
              return ctx.packet(S.qlAct, { color: 'amber', dur: 900, label: 'plan_trailer' });
            }).then(function () {
              ctx.pulse(S.wAct, { color: 'amber' });
              return ctx.wait(400);
            }).then(function () {
              return ctx.packet(S.qlAct, { color: 'lime', dur: 900, reverse: true, label: 'result: plan.json ref' });
            }).then(function () {
              return ctx.packet(S.cmdL, { color: 'lime', dur: 700, reverse: true, label: 'result event' });
            }).then(function () {
              ctx.pulse(S.res, { color: 'lime', dur: 600 });
              return ctx.fade(S.res, 1, 300);
            });
          });
        }
      },
      /* 2 ------------------------------------------------------------------ */
      {
        title: 'Event history',
        beats: [
          {
            say: 'Every decision becomes an event in an append-only history. The workflow starts. It schedules an activity to plan the trailer, the activity starts and completes, and its result, a reference to plan dot json, is written into the history.',
            card: { tag: 'HOW IT WORKS', title: 'Facts, appended once', body: 'Only <b>events</b> are persisted, and never updated in place. The workflow proposes <b>commands</b>; the server records each one as an event.' },
            deep: '<p>The history holds events only: facts such as <i>ActivityTaskCompleted</i> with its result payload. At the end of each workflow task the code proposes <b>commands</b> (<i>ScheduleActivityTask</i>, <i>StartTimer</i>, <i>CompleteWorkflowExecution</i>), and the server records each one as an event.</p>' +
              '<ul><li><i>ActivityTaskStarted</i> is written lazily together with the completion, so retries do not bloat the history.</li>' +
              '<li>Results are <b>payloads in history</b>: keep them small. Here the payload is an artifact reference, never the plan itself.</li></ul>'
          },
          {
            say: 'The same rhythm repeats for the script and then the storyboard: a workflow task thinks, an activity is scheduled, it completes, and each result lands in the log as a small reference.',
            card: { tag: 'NUMBERS', title: 'One think, three events', stat: { v: '3', u: 'events', l: 'per workflow task: scheduled, started, completed' } },
            deep: '<p>A <b>workflow task</b> (Scheduled / Started / Completed triple) is one “think” step: the worker runs code until every coroutine is blocked, then returns commands.</p>' +
              '<p>That is why the log alternates <code>WorkflowTask ×3</code> with activity events: events 2–4, 8–10 and 14–16 are the code deciding what to do next, and the events between them are the world answering.</p>'
          },
          {
            say: 'Then the workflow reaches a human approval. It waits on a condition, and when the creator approves, that signal is appended to the history like any other event.',
            card: { tag: 'KEY IDEA', title: 'Waiting is free', body: 'The workflow sleeps in <code>wait_condition</code> holding no worker, no thread and no GPU. Seven minutes or seven days costs the same.' },
            deep: '<p>A <b>signal</b> is an asynchronous message appended to the history (<i>WorkflowExecutionSignaled</i>). The workflow blocked in <code>wait_condition</code> is woken by the next workflow task. While it waits, nothing is running anywhere: the state is the log.</p>' +
              '<p>A durable timer can send a reminder or auto-cancel after 48&nbsp;h; timers live in the server, not in a process.</p>'
          },
          {
            say: 'Then six render activities are scheduled at once, one event each, and the workflow blocks on all of them.',
            card: { tag: 'NUMBERS', title: 'Six commands, one task', stat: { v: '6', l: 'render tasks scheduled by one workflow task (events 27 to 32)' } },
            deep: '<p><code>gather(*[act(render_shot, s) for s in board.shots])</code> creates six coroutines that each block on an activity future. The workflow task ends only when all are blocked, and returns six <code>ScheduleActivityTask</code> commands together: events 27 to 32.</p>' +
              '<p>Each command names its activity type, task queue, timeouts and retry policy, so the server can enforce them without ever running the workflow again.</p>'
          },
          {
            say: "The workflow's state is never stored directly. It is a pure function, a fold, over this log. The frontier marks where the next event will be appended.",
            card: { tag: 'KEY IDEA', title: 'State is a fold over events', body: 'Any worker can rebuild the workflow\'s state by folding the history from event 1. The log is the database.',
              more: '<p><b>Limits</b>: Temporal caps a payload at about 2&nbsp;MB and a history at 51,200 events or 50&nbsp;MB (warnings at 10k). Hence artifact references, and <code>continue_as_new</code> for very long workflows.</p>' },
            deep: '<div class="eq">state<sub>n</sub> = fold(apply, state<sub>0</sub>, [e<sub>1</sub>, …, e<sub>n</sub>])</div>' +
              '<ul><li>Temporal limits blobs to ~2&nbsp;MB and histories to 51,200 events / 50&nbsp;MB (warnings at 10k), hence artifact references, and <code>continue_as_new</code> for very long workflows.</li>' +
              '<li>History is sharded by workflow ID across history-service shards on Cassandra, PostgreSQL or MySQL; each append is a conditional write on the shard (optimistic concurrency).</li></ul>'
          }
        ],
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
          /* play events [a, b): move the code cursor, append rows */
          function play(a, b) {
            var chain = ctx.wait(200);
            EV.slice(a, b).forEach(function (e, k) {
              var i = a + k;
              chain = chain.then(function () {
                var from = parseFloat(S.cur.getAttribute('y')), to = lineY(e[3]) - 10;
                var mv = Math.abs(from - to) > 1 ? ctx.animate(S.cur, { y: [from, to] }, 220, 'out') : Promise.resolve();
                return mv.then(function () {
                  if (e[4] === 'amber' && i !== 3) ctx.packet(S.cmdL, { color: 'magenta', dur: 350 });
                  return ctx.reveal(S.rows[i], { from: 'left', dur: 260, dist: 14 });
                });
              });
            });
            return chain;
          }
          /* beat 0: start + plan_trailer */
          return play(0, 5).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: script and storyboard */
            return play(5, 11);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: wait for the approval signal */
            return play(11, 14).then(function () { return ctx.pulse(S.rows[12], { color: 'cyan', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: six renders at once */
            return play(14, 15).then(function () { return ctx.pulse(S.rows[14], { color: 'amber', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: state = fold(events) */
            ctx.hud('state = fold(events) · 32 events');
            return ctx.reveal(S.frontier, { dur: 400 }).then(function () { return ctx.pulse(S.frontier, { color: 'magenta', dur: 700 }); });
          });
        }
      },
      /* 3 ------------------------------------------------------------------ */
      {
        title: 'Task queues & workers',
        beats: [
          {
            say: 'Workers do not receive pushes; they long-poll task queues. The workflow worker polls for decisions, the activity worker polls for LLM calls, and each poll is a request that waits until work exists.',
            card: { tag: 'KEY IDEA', title: 'Pull, not push', body: 'Workers <b>long-poll</b> for tasks. The server never needs to know where workers live, and a busy worker simply stops polling.' },
            deep: '<ul><li><b>Matching service</b> owns task queues (partitioned, 4 partitions by default). Workers issue long-poll RPCs (~60&nbsp;s); a task is handed to whichever poller is waiting: natural <b>pull-based load balancing</b> and back-pressure.</li>' +
              '<li><b>Sticky execution</b>: after a workflow task, the worker keeps the workflow state in an in-memory cache and the next task goes to its sticky queue (5&nbsp;s timeout, then the normal queue). Cache hit ⇒ no replay.</li></ul>'
          },
          {
            say: 'GPU workers poll a dedicated render queue, so a GPU only accepts work when it actually has capacity. Six render tasks arrive, but only three GPU nodes are free.',
            card: { tag: 'NUMBERS', title: 'Six tasks, three free GPUs', stat: { v: '6 vs 3', l: 'render tasks queued vs free GPU nodes: half must wait' } },
            deep: '<ul><li><b>Queue per resource class</b>: <code>gpu-render-tq</code> is polled only by workers on 8×H100 nodes with the DiT weights resident; <code>activity-tq</code> by cheap CPU pods. Routing by queue name replaces a scheduler for this layer.</li>' +
              '<li><b>Concurrency caps</b>: <code>max_concurrent_activities=1</code> per GPU worker; slots, not threads, bound HBM usage.</li></ul>'
          },
          {
            say: 'So three tasks wait. That waiting time, schedule to start latency, is exactly the signal the autoscaler watches.',
            card: { tag: 'KEY IDEA', title: 'Queue wait is the signal', body: '<b>schedule_to_start</b> is time spent waiting for a worker. Autoscalers (KEDA-style) scale on it, or on the backlog itself.',
              more: '<p>Little’s law: backlog <i>L</i> = λ·<i>W</i>, so the wait is <i>W</i> = <i>L</i>/λ, with λ the throughput of the pool. Three waiting tasks and three nodes at ~90&nbsp;s per render give λ ≈ 1 task per 30&nbsp;s and <i>W</i> ≈ 90&nbsp;s. That wait, not the raw queue length, is what the autoscaler should act on.</p>' },
            deep: '<div class="eq">schedule_to_start latency ≈ backlog / service rate &nbsp;→ autoscaling signal</div>' +
              '<p>Here: 6 tasks, 3 free nodes, ~90&nbsp;s per render ⇒ without scale-out the 4th to 6th shots would wait ~90&nbsp;s. Queue wait is the honest utilization signal: CPU or GPU utilization of the busy workers says nothing about work that has not started.</p>'
          },
          {
            say: 'The autoscaler promotes three warm standby nodes that already hold the model weights in memory.',
            card: { tag: 'TRADE-OFF', title: 'Warm nodes cost idle GPUs', body: 'A warm node starts work in seconds. A cold one must provision, pull a multi-GB image and load ~30 GB of weights: <b>minutes</b>.' },
            deep: '<p>The autoscaler promotes 3 <b>warm-standby</b> nodes whose workers already hold the DiT weights in HBM. A cold node costs minutes: provision, pull a multi-GB image, load ~30&nbsp;GB of bf16 weights (a 14B DiT), warm up and compile kernels.</p>' +
              '<p>The trade is idle-GPU cost against tail latency; pool size is set from the arrival burstiness, not the mean load.</p>'
          },
          {
            say: 'The waiting shots are dispatched to them, and the backlog drains in about four seconds instead of ninety.',
            card: { tag: 'NUMBERS', title: 'Backlog gone in seconds', stat: { v: '≈ 4 s', l: 'wait for shots 4 to 6 with warm standby, versus ~90 s without' } },
            deep: '<p>S4 to S6 start after ~4&nbsp;s: the time for the autoscaler to observe the backlog, promote the nodes, and for each worker\'s next long-poll to pick up a task.</p>' +
              '<p>Note what did <i>not</i> happen: the workflow was not involved at all. It scheduled six activities; the queue and the worker pool absorbed the capacity mismatch.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.rowG, 0.45, 400);
          S.qTok = ctx.group({ parent: S.srvG });
          var toks = [];
          for (var i = 0; i < 6; i++) {
            var t = ctx.group({ parent: S.qTok });
            ctx.rect(1030 - i * 40, 704, 34, 20, { rx: 4, fill: ctx.alpha('lime', 0.3), stroke: 'lime', sw: 1, parent: t });
            ctx.text(1047 - i * 40, 714.5, 'S' + (i + 1), { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: t });
            t.setAttribute('opacity', 0);
            toks.push(t);
          }
          S.toks = toks;
          var wft = ctx.group({ parent: S.qTok });
          ctx.rect(1030, 620, 34, 20, { rx: 4, fill: ctx.alpha('magenta', 0.3), stroke: 'magenta', sw: 1, parent: wft });
          ctx.text(1047, 630.5, 'wft', { size: 11, font: 'mono', color: 'magenta', anchor: 'middle', parent: wft });
          wft.setAttribute('opacity', 0);
          /* beat 0: workers long-poll, a workflow task is handed over */
          ctx.reveal(wft, { delay: 300, dur: 300 });
          return ctx.wait(700).then(function () {
            ctx.fadeOut(wft, 300, true);
            return Promise.all([
              ctx.packet(S.qlWf, { color: 'magenta', dur: 700, label: 'long-poll → wft' }),
              ctx.wait(300).then(function () { return ctx.packet(S.qlAct, { color: 'amber', dur: 700, label: 'long-poll' }); })
            ]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: six render tasks, three GPUs free */
            return ctx.reveal(toks, { from: 'left', stagger: 120, dur: 300 }).then(function () {
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
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the backlog is the signal */
            [3, 4, 5].forEach(function (k, j) { ctx.transform(toks[k], { x: 120 }, 500, 'inOut', j * 80); });
            S.backlog = ctx.label(930, 744, 'backlog 3 · waiting for a GPU slot', { color: 'amber', size: 11, parent: S.srvG });
            ctx.hud('gpu-render-tq backlog 3 · schedule_to_start ↑');
            ctx.pulse(S.qlGpu, { color: 'amber', times: 2, dur: 500 });
            return ctx.reveal(S.backlog, { from: 'up', delay: 300 });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: autoscaler promotes warm standby nodes (weights already resident) */
            S.warmT = ctx.text(1145, 699, 'AUTOSCALER → +3 warm-standby nodes (weights in HBM)', { size: 11, font: 'mono', color: 'amber', parent: S.wrkG });
            S.warm = ['gpu-51', 'gpu-63', 'gpu-77'].map(function (n, i) {
              return ctx.node({ x: 1210 + i * 135, y: 744, w: 120, h: 50, kind: 'chip', title: n, sub: 'warm', color: 'red', titleSize: 13, subSize: 10.5, parent: S.wrkG });
            });
            ctx.reveal(S.warmT, { dur: 300 });
            return ctx.reveal(S.warm, { from: 'scale', stagger: 120, dur: 400 });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the waiting shots start; the backlog drains */
            var ps = [3, 4, 5].map(function (k, j) {
              return ctx.wait(j * 200).then(function () {
                ctx.fadeOut(toks[k], 250, true);
                return ctx.packet(S.qlGpu, { color: 'lime', dur: 600, label: 'S' + (k + 1) });
              }).then(function () {
                S.warm[j].subEl.textContent = 'S' + (k + 1) + ' · step 0/50';
                return ctx.pulse(S.warm[j], { color: 'lime', dur: 450 });
              });
            });
            return Promise.all(ps).then(function () {
              ctx.remove(S.backlog, 250);
              S.backlog2 = ctx.label(930, 744, 'backlog 0 · S4–S6 waited ~4 s', { color: 'lime', size: 11, parent: S.srvG });
              ctx.hud('backlog → autoscale +3 warm nodes · wait ≈ 4 s');
              return ctx.reveal(S.backlog2, { from: 'up', dur: 300 });
            });
          });
        }
      },
      /* 4 ------------------------------------------------------------------ */
      {
        title: 'Crash & replay',
        beats: [
          {
            say: 'Now the workflow worker dies, killed mid-run by a node drain. Nothing is lost, because the state was never inside that process.',
            card: { tag: 'KEY IDEA', title: 'Workers are disposable', body: 'The worker held only a cache. The truth is in the <b>event history</b>, so any other worker can take over.' },
            deep: '<p>What the SIGKILL destroyed: the worker\'s sticky cache and the suspended coroutine stacks of the workflow. What survives: the event history, every activity result, every pending timer (they live in the server), and the six renders already running on the GPU pool.</p>' +
              '<p>The server notices when the workflow task times out (or the sticky poller disappears) and reschedules it on the normal queue.</p>'
          },
          {
            say: 'Worker B picks up the next workflow task. It has no cached state, so it downloads the history and replays the workflow code from the top.',
            card: { tag: 'HOW IT WORKS', title: 'Cold start: fetch, then replay', body: '<code>GetWorkflowExecutionHistory</code> pages the events over gRPC, and the SDK feeds them to a fresh copy of the workflow code.' },
            deep: '<pre>replay(history):\n  for e in history:\n    if e.is_activity_result:\n      fut[e.sched_id].set(e.result)\n    run_until_blocked()\n    cmds = drain_commands()\n    assert cmds == recorded(e)\n  # mismatch ⇒ NonDeterminismError\n  # frontier ⇒ emit commands live</pre>' +
              '<p>The SDK feeds each recorded result into the matching future, lets the coroutines run until they block, and compares the commands they emit with the commands recorded next to that event.</p>'
          },
          {
            say: 'Each await that already has a completion event in the history returns the recorded result instantly, without calling the LLM or the GPU again.',
            card: { tag: 'NUMBERS', title: 'Nothing is paid twice', stat: { v: '0', u: 're-runs', l: 'LLM calls or GPU-seconds re-spent during replay' } },
            deep: '<ul><li>Replay is <b>CPU-only and cheap</b>: 32 events replay in milliseconds of workflow logic; the main cost is fetching the history (paged gRPC).</li>' +
              '<li>No activity is re-executed: the plan, script and storyboard LLM calls (and their tokens) are not paid twice, and renders already scheduled are not duplicated.</li></ul>'
          },
          {
            say: 'When the code reaches the frontier, the end of the recorded history, execution continues live and emits new commands.',
            card: { tag: 'HOW IT WORKS', title: 'Replay ends at the frontier', body: 'Past the last recorded event, the same code emits <b>new commands</b>. The workflow carries on as if nothing had happened.' },
            deep: '<p>The frontier is where replay turns into execution: the six render futures are still pending, so the worker issues no new commands and waits for the next completion event. If the crash had happened just after a completion, worker B would immediately schedule the next activity.</p>' +
              '<p>The workflow observed no failure; only the server saw a worker come and go.</p>'
          },
          {
            say: 'If the code ever issued a different command than the history recorded, replay would stop with a non determinism error.',
            card: { tag: 'PITFALL', title: 'Non-determinism breaks replay', body: 'Reordering two awaits, reading <code>datetime.now()</code> or iterating a set can change commands. The task fails and retries until a <b>fixed worker</b> deploys.',
              more: '<p>Ban in workflow code: wall-clock reads, random numbers, UUIDs, unordered iteration, thread scheduling, network or file I/O, global mutable state, and floating-point reductions whose order can change. Anything needed must arrive as an event or through a recorded side-effect API.</p>' },
            deep: '<ul><li><b>NonDeterminismError</b> fires if replayed code emits a command that disagrees with history, e.g. someone reordered two <code>await</code>s, used <code>datetime.now()</code>, or iterated a <code>set</code>. The workflow task fails and retries until a fixed worker is deployed (the history is untouched).</li>' +
              '<li>The Python SDK runs workflows in a sandbox that re-imports modules and blocks non-deterministic calls; Go uses a static analyzer (<code>workflowcheck</code>).</li>' +
              '<li>Changing workflow code for in-flight runs needs versioning (step 9).</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.fade(S.rowG, 1, 300);
          S.nd = ctx.text(44, 481, 'replayed command ≠ recorded command → NonDeterminismError', { size: 11.5, font: 'mono', color: '#ff9aad', parent: S.codeG, opacity: 0 });
          S.live = ctx.label(1345, 202, '▶ LIVE · emits new commands', { color: 'lime', size: 12, parent: S.wrkG, opacity: 0 });
          S.checks = ctx.group({ parent: S.srvG });
          S.chk = EV.map(function (e, i) {
            return ctx.text(627, 250 + i * 21, '✓', { size: 12.5, weight: 700, color: 'lime', parent: S.checks, opacity: 0 });
          });
          /* beat 0: worker A is killed */
          return ctx.wait(400).then(function () {
            S.wA.body.setAttribute('stroke', ctx.C.red);
            S.kill = ctx.label(1345, 206, '✕ SIGKILL · node drained', { color: 'red', size: 12, parent: S.wrkG });
            ctx.reveal(S.kill, { from: 'scale' });
            return ctx.pulse(S.wA, { color: 'red', times: 2, dur: 450 });
          }).then(function () {
            return Promise.all([ctx.fadeOut(S.wA, 500, true), ctx.fadeOut(S.kill, 500, true)]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: worker B fetches the history */
            S.wB = ctx.node({ x: 1345, y: 250, w: 400, h: 72, title: 'Workflow Worker B', sub: 'cold · no cache → replay', icon: 'code', color: 'lime', parent: S.wrkG });
            return ctx.reveal(S.wB, { from: 'scale' }).then(function () {
              return ctx.packet(S.cmdL, { color: 'cyan', dur: 900, reverse: true, label: 'GetWorkflowExecutionHistory' });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: replay against the recorded events */
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
            return chain.then(function () {
              ctx.hud('replay: 0 LLM calls · 0 GPU-s re-spent');
              S.wB.subEl.textContent = 'replayed 32 events';
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: past the frontier, live again */
            ctx.pulse(S.frontier, { color: 'magenta', dur: 600 });
            S.wB.subEl.textContent = 'replayed 32 events → live';
            ctx.reveal(S.live, { from: 'down', dur: 350 });
            return ctx.packet(S.cmdL, { color: 'magenta', dur: 700, label: 'next commands (live)' });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: what a divergence would look like */
            ctx.pulse(S.code, { color: 'red', times: 2, dur: 500 });
            return ctx.fade(S.nd, 1, 400);
          });
        }
      },
      /* 5 ------------------------------------------------------------------ */
      {
        title: 'GPU failure & retries',
        beats: [
          {
            say: 'Shot four is rendering on a GPU node, and the render activity heartbeats every ten seconds, reporting its denoising step.',
            card: { tag: 'HOW IT WORKS', title: 'A heartbeat is a liveness proof', body: '<code>activity.heartbeat()</code> tells the server the attempt is alive and carries <b>progress details</b>, such as the step and a checkpoint URI.' },
            deep: '<p><code>activity.heartbeat()</code> can be called every denoising step; the SDK coalesces calls and flushes an RPC at most every min(0.8 × heartbeat_timeout, <code>max_heartbeat_throttle_interval</code>). Here the worker caps it at 10&nbsp;s.</p>' +
              '<p>Each heartbeat carries <code>details</code> (step, checkpoint URI) that survive into the next attempt.</p>'
          },
          {
            say: 'Then the node fails with a hardware error: the GPU fell off the bus. The process is gone, and nobody tells the server.',
            card: { tag: 'PITFALL', title: 'Silent death is the norm', body: 'A dead GPU does not send a failure message. <b>Xid 79</b> means the device dropped off the PCIe bus; the only symptom is silence.' },
            deep: '<p>Classify errors: <b>Xid 79</b> (GPU fell off the bus), <b>Xid 48</b> (double-bit ECC error), <b>Xid 94</b> (contained memory error), CUDA OOM, preemption and 5xx are all <i>retryable</i>. <code>PolicyViolation</code> and invalid prompts are not.</p>' +
              '<p>At Llama 3 scale about 78% of unexpected interruptions were attributed to confirmed or suspected hardware issues: this is the expected failure, not the exotic one.</p>'
          },
          {
            say: 'The heartbeats stop, and thirty seconds after the last one, the heartbeat timeout fires. The server does not wait for the twenty minute start to close timeout.',
            card: { tag: 'NUMBERS', title: 'Detected in thirty seconds', stat: { v: '30 s', l: 'to detect a dead GPU, instead of 20 min for start_to_close' },
              more: '<p>Choose heartbeat_timeout ≥ 3× the heartbeat interval so that one lost RPC does not kill a healthy attempt. Here 10&nbsp;s beats and a 30&nbsp;s timeout tolerate two missed beats; the price is a worst-case detection latency of the full 30&nbsp;s.</p>' },
            deep: '<table><tr><th>Timeout</th><th>Bounds</th><th>Trailer value</th></tr>' +
              '<tr><td>schedule_to_start</td><td>time waiting in the queue</td><td>alert only (backlog)</td></tr>' +
              '<tr><td>start_to_close</td><td>one attempt</td><td>20 min</td></tr>' +
              '<tr><td>heartbeat</td><td>max gap between heartbeats</td><td>30 s</td></tr>' +
              '<tr><td>schedule_to_close</td><td>all attempts incl. backoff</td><td>60 min</td></tr></table>' +
              '<p>Without heartbeats a dead GPU is detected only at start_to_close (20&nbsp;min); with them, ≤30&nbsp;s after the last heartbeat reached the server.</p>'
          },
          {
            say: 'The retry policy schedules attempt two after a short exponential backoff, and another GPU node picks it up from the queue. It finishes at one hundred fifty three seconds, because it resumes from a checkpoint, which the next step explains.',
            card: { tag: 'NUMBERS', title: 'Attempt two lands at 153 s', stat: { v: '153 s', l: 'attempt 2 ends, resumed from a checkpoint (from scratch: 208 s)' } },
            deep: '<p>The server applies the retry policy itself: the failed attempt is recorded, a new <i>ActivityTaskScheduled</i> goes to <code>gpu-render-tq</code> after the backoff, and any idle GPU worker (here <code>gpu-17</code>, which has just finished shot 1) polls it.</p>' +
              '<p>Without a checkpoint attempt 2 would redo all 50 steps (~101&nbsp;s, about 2&nbsp;s each) and end at 208&nbsp;s; with one it resumes and ends at 153&nbsp;s.</p>'
          },
          {
            say: 'Retries follow an exponential backoff, doubling from one second up to a cap of sixty, with jitter so that a thousand failed shots do not retry in lockstep. Some errors, like a policy violation, never retry at all.',
            card: { tag: 'HOW IT WORKS', title: 'Backoff with full jitter', body: 'Delays double up to a cap. <b>Full jitter</b>, a uniform draw up to the delay, spreads retries so failures do not synchronize (Brooker, 2015).' },
            deep: '<div class="eq">delay<sub>n</sub> = min(initial · c<sup>n−1</sup>, max_interval) &nbsp;= 1, 2, 4, 8, 16, 32, 60 s</div>' +
              '<p>Temporal applies this server-side (defaults: 1&nbsp;s, ×2, cap 100× initial, unlimited attempts). For client-side retries inside an activity (the video API returning 429/503), add <b>full jitter</b>, <code>sleep = U(0, delay<sub>n</sub>)</code>, so a thousand failed shots do not retry in lock-step.</p>' +
              '<p>Non-retryable types (<code>PolicyViolation</code>, <code>InvalidPrompt</code>) fail fast: no amount of retrying fixes a rejected prompt.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.codeG, 400); ctx.remove(S.actG, 400); ctx.remove(S.srvG, 400);
          ctx.fade([S.wB, S.wAct, S.live], 0.22, 400);
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
          S.ghostT = ctx.text(X(180), 366, 'no checkpoint: 101 s → would end at 208 s', { size: 11, font: 'mono', color: '#ff9aad', anchor: 'end', parent: S.tlG, opacity: 0 });
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
          S.retryT = ctx.text(X(110), 303, 'retry · 1 s backoff + poll', { size: 11, font: 'mono', color: 'amber', parent: S.tlG, opacity: 0 });
          S.done = ctx.text(X(153) + 8, 341, '✓ 153 s', { size: 13, font: 'mono', weight: 600, color: 'lime', parent: S.tlG, opacity: 0 });
          ctx.text(56, 426, 'schedule_to_start: queue wait · start_to_close 20 min: one attempt · heartbeat 30 s: liveness', { size: 12, font: 'mono', color: 'dim', parent: S.tlG });
          hide(S.tlG);
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
          hide(S.boG);
          var flags = {};
          function upd(tt) {
            S.b1.setAttribute('width', Math.max(0, X(Math.min(tt, 78)) - X(4)));
            S.hb1.forEach(function (d, jj) { d.setAttribute('opacity', tt >= 14 + 10 * jj ? 1 : 0); });
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
            S.hb2.forEach(function (d, jj) { d.setAttribute('opacity', tt >= 117 + 10 * jj ? 1 : 0); });
            S.done.setAttribute('opacity', tt >= 153 ? 1 : 0);
          }
          upd(0);
          /* beat 0: attempt 1 heartbeats */
          return ctx.reveal(S.tlG, { from: 'up', delay: 200 }).then(function () {
            return ctx.tween(4200, function (e, raw) { upd(raw * 76); }, 'linear');
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the GPU falls off the bus */
            return ctx.tween(900, function (e, raw) { upd(76 + raw * 4); }, 'linear').then(function () { return ctx.wait(500); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: silence, then the heartbeat timeout */
            return ctx.tween(2600, function (e, raw) { upd(80 + raw * 25); }, 'linear').then(function () {
              ctx.hud('dead GPU detected in 30 s, not 20 min');
              return ctx.wait(400);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: retry on another node, attempt 2 */
            return ctx.tween(3600, function (e, raw) { upd(105 + raw * 55); }, 'linear');
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: backoff schedule and retry policy */
            ctx.hud('');
            return ctx.reveal(S.boG, { from: 'up', dur: 500 }).then(function () {
              return ctx.reveal(S.boBars, { from: 'up', stagger: 90, dist: 10 });
            });
          });
        }
      },
      /* 6 ------------------------------------------------------------------ */
      {
        title: 'Checkpoint & resume',
        beats: [
          {
            say: 'Retrying from scratch would waste the steps already computed. So the render activity checkpoints its latent tensor every ten denoising steps.',
            card: { tag: 'KEY IDEA', title: 'Checkpoint every ten steps', body: 'The activity saves the latent <code>z</code> and sampler state to object storage at steps 10, 20, 30…: a bounded loss instead of starting over.' },
            deep: '<ul><li><b>What to save</b>: z<sub>t</sub>, step index k, sampler state (multistep solvers such as DPM-Solver++ or UniPC keep previous model outputs), RNG state if the sampler is stochastic, and a hash of the conditioning (prompt embedding, refs, seed, model version).</li>' +
              '<li>The write is asynchronous and content-addressed, so a torn write can never be mistaken for a valid checkpoint.</li></ul>'
          },
          {
            say: 'Each checkpoint is about ten megabytes: the latent tensor plus the step index and random state. That is tiny next to the work it protects.',
            card: { tag: 'NUMBERS', title: 'A checkpoint is tiny', stat: { v: '9.7 MB', l: 'one checkpoint: a 16×21×90×160 bf16 latent, written asynchronously' } },
            deep: '<p>Wan-2.x-style VAE (4× temporal, 8×8 spatial, 16 channels) on an 81-frame 720p clip (≈5&nbsp;s at 16&nbsp;fps):</p>' +
              '<div class="eq">z<sub>t</sub> ∈ ℝ<sup>16×21×90×160</sup> = 4.84 M values → 9.7 MB (bf16)</div>' +
              '<p>This scene assumes ~2&nbsp;s per step on an 8-GPU sequence-parallel node (illustrative: it is the running example’s ~95 s per shot spread over 50 steps, which assumes a production sampler; an undistilled 14B DiT at 720p with CFG typically needs several seconds per step even on 8 GPUs, which only strengthens the case). Assuming the write is asynchronous and takes about 0.1&nbsp;s, a checkpoint every 10 steps costs &lt;1% overhead either way.</p>'
          },
          {
            say: 'The checkpoint URI rides in the heartbeat details, so no extra database is needed. The next attempt simply reads it back.',
            card: { tag: 'HOW IT WORKS', title: 'The heartbeat carries the pointer', body: '<code>activity.heartbeat(ckpt, k)</code> stores the URI in the history; the next attempt reads <code>heartbeat_details</code> on start.' },
            deep: '<p><b>Where the URI travels</b>: <code>activity.heartbeat(ckpt_uri, k)</code>; the next attempt reads <code>activity.info().heartbeat_details</code>. No extra database needed.</p>' +
              '<p><b>Validate</b> before resuming: check the hash and the model version, and discard a checkpoint written by a different model build.</p>' +
              '<p>Heartbeat details live in the history, so keep them tiny: a URI and a step index, never the tensor. Heartbeats are throttled, so the recorded step may lag the real one; resuming from an older checkpoint is always safe, because the steps are deterministic.</p>'
          },
          {
            say: 'Now the node fails at step thirty seven. Attempt two reads the heartbeat details, loads the latent from step thirty, and resumes from there.',
            card: { tag: 'WHY IT MATTERS', title: 'Loss is bounded', body: 'With a checkpoint every 10 steps, a failure never costs more than <b>9 completed steps</b> of recomputation, whenever it strikes.',
              more: '<p>Young–Daly: the interval that minimizes expected waste is τ ≈ √(2·δ·M), with checkpoint cost δ and mean time between failures M. For an assumed blocking cost δ = 0.05&nbsp;s and M = 1&nbsp;h (a preemptible pool, where drains and preemptions dominate hardware faults) τ ≈ 19&nbsp;s, about 10 steps at 2&nbsp;s each.</p>' },
            deep: '<p>The last heartbeat reported step 37; the last checkpoint was at step 30. Steps 31 to 37 (about 14&nbsp;s at 2&nbsp;s per step) are recomputed; everything before is loaded from storage in well under a second.</p>' +
              '<p>The interval trades write overhead (&lt;1%) against expected recomputation: with a checkpoint every <i>c</i> steps the expected loss is about <i>c</i>/2 steps.</p>'
          },
          {
            say: 'Only seven steps of work are lost instead of thirty seven, and the resumed trajectory is the one the first attempt was already on.',
            card: { tag: 'NUMBERS', title: 'Sixty percent saved', stat: { v: '60%', l: 'of the shot\'s denoising not repeated: 30 of 50 steps reused' } },
            deep: '<ul><li><b>Exactness</b>: deterministic ODE samplers (flow-matching Euler, DDIM) resume on the identical trajectory, up to floating-point non-associativity across GPUs (bitwise differences, visually irrelevant).</li>' +
              '<li>A stochastic sampler (SDE or ancestral) must checkpoint its RNG state too. Otherwise the resumed run is still a valid sample from the same distribution, but a different video.</li></ul>' +
              '<div class="eq">saved = 30 / 50 steps = 60% of this shot’s denoising compute</div>'
          },
          {
            say: 'Now break it yourself. Click any denoising step to crash the node there, and see how much work the last checkpoint saves.',
            card: { tag: 'TRY IT', title: 'Click a step to crash there', body: 'Resume snaps back to the last multiple of ten, so you redo at most <b>9 completed steps</b>. From scratch you could redo up to 49.' },
            deep: '<div class="eq">resume = 10·⌊k/10⌋, &nbsp; lost = k mod 10, &nbsp; saved = resume / 50</div>' +
              '<p>If the crash step is uniform over the 50 steps, the expected recomputation is 4.5 steps (about 9&nbsp;s) with checkpoints every 10 steps, against 24.5 steps (about 50&nbsp;s) from scratch: 5.4× less repeated work, for four small asynchronous writes.</p>' +
              '<p>Crashes right after a checkpoint (k = 10, 20, 30, 40) lose nothing. Crashes before step 10 restart from noise: there is no checkpoint yet, so the seed and the conditioning are all that the retry needs.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.boG, 400);
          ctx.fade(S.tlG, 0.35, 400);
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
          S.ck = [10, 20, 30, 40].map(function (k) {
            var g = ctx.group({ parent: S.ckG });
            diamond(ctx, 69 + k * 20, 526, 6, 'teal', g);
            ctx.text(69 + k * 20 + 10, 525, 'ckpt', { size: 11, font: 'mono', color: 'teal', parent: g });
            g.setAttribute('opacity', 0);
            return g;
          });
          S.xk = ctx.text(70 + 37 * 20 + 9, 548, '✕', { size: 18, weight: 700, color: 'red', anchor: 'middle', parent: S.ckG, opacity: 0 });
          var leg = ctx.group({ parent: S.ckG });
          S.legT = [];
          [['attempt 1 · gpu-51', 'lime', 70], ['lost · steps 31–37', 'red', 280], ['attempt 2 · resumed from 30', 'cyan', 460]].forEach(function (l) {
            ctx.rect(l[2], 616, 14, 12, { rx: 2, fill: ctx.alpha(l[1], 0.6), parent: leg });
            S.legT.push(ctx.text(l[2] + 22, 622, l[0], { size: 12, font: 'mono', color: l[1], parent: leg }));
          });
          /* latent tensor slabs */
          S.lat = ctx.group({ parent: S.ckG });
          for (var q = 5; q >= 0; q--) {
            var ox = 80 + q * 16, oy = 650 + q * 14;
            ctx.poly([[ox, oy + 30], [ox + 150, oy + 30], [ox + 180, oy], [ox + 30, oy]], { fill: ctx.alpha('violet', 0.12 + q * 0.05), stroke: ctx.alpha('violet', 0.8), parent: S.lat });
          }
          var rg = ctx.rng(9);
          for (var p = 0; p < 18; p++) ctx.circle(170 + rg() * 110, 735 + rg() * 20, 1.4, { fill: ctx.cmap('heat', rg()), parent: S.lat });
          S.latT = ctx.group({ parent: S.ckG });
          ctx.text(60, 800, 'z_t: 16 × 21 × 90 × 160  (C, T, H, W)', { size: 13, font: 'mono', color: 'violet', parent: S.latT });
          ctx.text(60, 824, '4.84 M values · bf16 ≈ 9.7 MB', { size: 12, font: 'mono', color: 'dim', parent: S.latT });
          ctx.text(60, 848, '+ step k · sampler state · RNG', { size: 12, font: 'mono', color: 'dim', parent: S.latT });
          ctx.text(60, 872, 'async write ≈ 0.1 s (assumed) vs step ≈ 2 s', { size: 12, font: 'mono', color: 'teal', parent: S.latT });
          S.s3 = ctx.node({ x: 440, y: 700, w: 170, h: 84, kind: 'cyl', title: 'ckpt store', sub: 'step30.safetensors', color: 'teal', titleSize: 14, subSize: 10.5, parent: S.ckG });
          S.sv = ctx.link({ x: 290, y: 690 }, S.s3, { to: 'l', color: 'teal', parent: S.ckG });
          S.code = ctx.code({ x: 560, y: 636, w: 516, title: 'render_shot · resumable activity', lang: 'py', size: 12, color: 'teal', parent: S.ckG, lines: nb([
            '@activity.defn',
            'async def render_shot(s: Shot) -> ArtifactRef:',
            '  hb = activity.info().heartbeat_details',
            '  ckpt = hb[0] if hb else None',
            '  k0, z = load(ckpt) if ckpt else (0, noise(s.seed))',
            '  for k in range(k0, 50):',
            '    z = sampler.step(dit, z, sigmas[k], s.cond)',
            '    if (k + 1) % 10 == 0:  # z + sampler history, ~10 MB',
            '      ckpt = save(s.id, k + 1, z, sampler.state())',
            '    activity.heartbeat(ckpt, k + 1)',
            '  return put(vae.decode(z), key=s.idem_key)'
          ]) });
          S.hl = ctx.rect(564, 636 + 46 + 4 * 18.6 - 9, 508, 18, { rx: 3, fill: ctx.alpha('cyan', 0.14), stroke: ctx.alpha('cyan', 0.6), sw: 1, parent: S.ckG, opacity: 0 });
          S.hb = ctx.rect(564, 636 + 46 + 9 * 18.6 - 9, 508, 18, { rx: 3, fill: ctx.alpha('teal', 0.16), stroke: ctx.alpha('teal', 0.7), sw: 1, parent: S.ckG, opacity: 0 });
          hide([S.ckG, S.lat, S.latT, S.s3, S.sv, S.code]);
          function fillTo(n, col, from, row) {
            var cells = row === 2 ? S.cells2 : S.cells;
            return ctx.tween((n - from) * 70, function (e, raw) {
              var m = from + Math.round(raw * (n - from));
              for (var c = from; c < m; c++) { cells[c].setAttribute('fill', ctx.alpha(col, 0.6)); cells[c].setAttribute('stroke', col); }
            }, 'linear');
          }
          /* TRY IT (beat 6): crash after step k; resume from the last multiple of ten */
          S.tryOn = false;
          S.hint6 = ctx.label(880, 503, 'click any step to crash there', { color: 'amber', size: 12, parent: S.ckG, opacity: 0 });
          function setCrash(k) {
            var r = 10 * Math.floor(k / 10), lost = k - r, empty = 'rgba(255,255,255,0.04)';
            for (var c = 0; c < 50; c++) {
              var a1 = S.cells[c], a2 = S.cells2[c], col1 = null;
              if (c < r) col1 = [ctx.alpha('lime', 0.6), ctx.C.lime];
              else if (c < k) col1 = [ctx.alpha('red', 0.45), ctx.C.red];
              a1.setAttribute('fill', col1 ? col1[0] : empty); a1.setAttribute('stroke', col1 ? col1[1] : ctx.C.line);
              if (c >= r) { a2.setAttribute('fill', ctx.alpha('cyan', 0.6)); a2.setAttribute('stroke', ctx.C.cyan); }
              else { a2.setAttribute('fill', empty); a2.setAttribute('stroke', 'rgba(0,0,0,0)'); }
            }
            S.ck.forEach(function (g, j) { g.setAttribute('opacity', 10 * (j + 1) <= k ? 1 : 0); });
            S.xk.setAttribute('x', 70 + k * 20 + 9); S.xk.setAttribute('opacity', 1);
            S.legT[1].textContent = lost > 0 ? 'lost · steps ' + (r + 1) + '–' + k : 'lost · none';
            S.legT[2].textContent = r > 0 ? 'attempt 2 · resumed from ' + r : 'attempt 2 · from scratch';
            S.s3.subEl.textContent = r > 0 ? 'step' + r + '.safetensors' : 'none yet';
            ctx.hud('crash @' + k + ' · resume ' + r + ' · lost ' + lost + ' · saved ' + Math.round(100 * r / 50) + '%');
          }
          S.hit6 = [];
          for (var h = 0; h < 50; h++) {
            (function (i) {
              var hr = ctx.rect(70 + i * 20 - 1, 530, 20, 60, { rx: 3, fill: 'rgba(255,255,255,0.001)', parent: S.ckG });
              hr.style.cursor = 'pointer';
              hr.addEventListener('click', function (ev) {
                ev.stopPropagation();
                if (!S.tryOn) return;
                setCrash(i);
                ctx.pulse(S.cells[i], { color: 'red', dur: 450 });
                if (i >= 10) ctx.packet(S.sv, { color: 'cyan', dur: 500, reverse: true, label: 'load step ' + (10 * Math.floor(i / 10)) });
              });
              S.hit6.push(hr);
            })(h);
          }
          /* beat 0: attempt 1 runs to step 30, checkpointing */
          return ctx.reveal(S.ckG, { from: 'up', delay: 100 }).then(function () {
            return Promise.all([ctx.reveal([S.lat, S.s3], { from: 'left', stagger: 150 }), ctx.reveal(S.sv, { from: 'draw', delay: 300 })]);
          }).then(function () {
            var chain = Promise.resolve();
            [10, 20, 30].forEach(function (k, j) {
              chain = chain.then(function () { return fillTo(k, 'lime', j * 10); }).then(function () {
                ctx.fade(S.ck[j], 1, 200);
                return ctx.packet(S.sv, { color: 'teal', dur: 450 });
              });
            });
            return chain;
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: what a checkpoint weighs */
            ctx.reveal(S.latT, { from: 'up', dur: 400 });
            return ctx.pulse(S.lat, { color: 'violet', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the URI rides in the heartbeat */
            ctx.reveal(S.code, { from: 'up', dur: 450 });
            return ctx.wait(500).then(function () {
              ctx.fade(S.hb, 1, 250);
              return ctx.pulse(S.hb, { color: 'teal', times: 2, dur: 500 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: failure at step 37, attempt 2 loads step 30 */
            return fillTo(37, 'lime', 30).then(function () {
              ctx.fade(S.xk, 1, 150);
              for (var c = 30; c < 37; c++) { S.cells[c].setAttribute('fill', ctx.alpha('red', 0.45)); S.cells[c].setAttribute('stroke', ctx.C.red); }
              return ctx.wait(600);
            }).then(function () {
              ctx.fade(S.hb, 0, 200);
              ctx.fade(S.hl, 1, 200);
              ctx.pulse(S.ck[2], { color: 'cyan', dur: 600 });
              return ctx.packet(S.sv, { color: 'cyan', dur: 600, reverse: true, label: 'load step 30' });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: attempt 2 resumes and finishes */
            return fillTo(50, 'cyan', 30, 2).then(function () {
              ctx.hud('lost 7 steps, not 37 · saved 60% of the shot');
              return ctx.wait(400);
            });
          }).then(function () { return ctx.beat(5); }).then(function () {
            /* beat 5 (TRY IT): the denoising steps become clickable */
            S.tryOn = true;
            return ctx.reveal(S.hint6, { from: 'left', dur: 400 }).then(function () {
              return ctx.pulse(S.hint6, { color: 'amber', times: 2, dur: 600 });
            });
          });
        }
      },
      /* 7 ------------------------------------------------------------------ */
      {
        title: 'Idempotency & outbox',
        beats: [
          {
            say: 'Retries mean activities run at least once, so side effects must be idempotent. Take the charge credits call: it reaches the billing service, which charges the account and stores the result.',
            card: { tag: 'KEY IDEA', title: 'At-least-once needs idempotency', body: 'A retried activity may repeat its side effect. An <b>idempotency key</b> turns a repeated call into a no-op that returns the stored result.' },
            deep: '<p><b>Idempotency key</b> = stable across retries, unique per logical effect:</p>' +
              '<div class="eq">key = hash(workflow_id, activity_id) &nbsp;(never the attempt number)</div>' +
              '<ul><li>Server side: <code>INSERT INTO idem(key, status) ON CONFLICT DO NOTHING</code>; on conflict return the stored response (Stripe may prune a key once it is at least 24&nbsp;h old). A concurrent duplicate while <i>pending</i> → 409, and the client retries.</li></ul>'
          },
          {
            say: "But the worker dies before the acknowledgement is recorded in the history, so from the workflow's point of view the call never finished.",
            card: { tag: 'PITFALL', title: 'The lost acknowledgement', body: 'The charge happened but the workflow never heard. Retrying blindly would <b>charge twice</b>: it cannot tell "never ran" from "ran, unacknowledged".' },
            deep: '<p>This is the fundamental gap of any RPC: a timeout is indistinguishable from a lost response. The activity attempt ends in <i>start_to_close</i> or heartbeat timeout, and the retry policy schedules attempt 2, exactly as designed.</p>' +
              '<p>The only safe protocol is one where repeating the request is harmless: idempotency turns “at-least-once delivery” into “exactly-once effect”.</p>'
          },
          {
            say: 'The retry sends the same idempotency key, derived from the workflow and activity IDs, and billing returns the stored result instead of charging twice.',
            card: { tag: 'HOW IT WORKS', title: 'Same key, same answer', body: 'A key hit returns the <b>stored response</b> with no second charge. The key is derived from workflow and activity IDs, never from the attempt number.',
              more: '<p>Stripe and the IETF <code>Idempotency-Key</code> Internet-Draft (expired at version 07, never an RFC) share these semantics: the same key with the same parameters returns the stored response; the same key with different parameters is rejected (the draft uses 422; Stripe returns a 400-class error), which catches accidental key reuse. Keys are kept for a bounded window (Stripe may prune them once they are at least 24&nbsp;h old), and an in-flight duplicate gets 409 until the first request finishes.</p>' },
            deep: '<ul><li>Object store: content-addressed keys (<code>sha256</code>) + conditional <code>PUT If-None-Match: *</code> make uploads naturally idempotent: a repeated PUT of the same key gets 412 Precondition Failed, which the caller reads as “already stored”.</li>' +
              '<li>GPU renders: the render is deterministic given (seed, cond, model), so key the output path by that hash and a duplicate attempt overwrites identical bytes.</li></ul>'
          },
          {
            say: 'The same thinking applies to events. The shot service writes its state change and an outbox row in one database transaction.',
            card: { tag: 'PITFALL', title: 'The dual-write trap', body: 'Commit the DB, then publish to Kafka: a crash in between loses the event. Publish first: a <b>phantom event</b> for state that never existed.' },
            deep: '<p><b>Transactional outbox</b> solves the dual-write problem (DB commit + Kafka publish cannot be atomic):</p>' +
              '<pre>BEGIN;\n UPDATE shots SET state=\'ready\',\n   uri=$1 WHERE id=$2;\n INSERT INTO outbox(event_id,\n   topic, payload) VALUES (...);\nCOMMIT;\n-- relay (poller / Debezium CDC)\n-- publishes, then marks sent</pre>'
          },
          {
            say: 'A relay then publishes the event after the commit, so the client never sees an event for a state that was not committed.',
            card: { tag: 'TRADE-OFF', title: 'At-least-once delivery', body: 'The relay (polling, or CDC with Debezium) may publish twice after a crash, so consumers <b>dedupe by event id</b>.' },
            deep: '<p>Delivery is at-least-once, so consumers (the SSE gateway) dedupe by <code>event_id</code>. Ordering per shot is preserved by keying the Kafka partition by shot id.</p>' +
              '<p>Inside Temporal itself, workflow code already gets this for free: commands and state commit atomically with the history.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          S.tryOn = false;
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
          hide(L);
          /* outbox */
          var R = ctx.group({ parent: S.idG });
          panel(ctx, 816, 165, 748, 715, 'teal', R);
          head(ctx, 836, 190, 'TRANSACTIONAL OUTBOX · state + event atomically', 'teal', R);
          S.svc = ctx.node({ x: 960, y: 260, w: 220, h: 60, title: 'Shot service', sub: 'shot 4 → ready', icon: 'server', color: 'cyan', titleSize: 14, subSize: 11, parent: R });
          S.db = ctx.node({ x: 960, y: 440, w: 220, h: 150, kind: 'cyl', color: 'teal', parent: R });
          S.pgT = ctx.text(960, 404, 'PostgreSQL', { size: 14, font: 'display', weight: 600, color: 'white', anchor: 'middle', parent: R });
          S.tShots = ctx.label(960, 442, 'shots: state=ready', { color: 'cyan', size: 12, parent: R });
          S.tOut = ctx.label(960, 480, 'outbox: evt_7c1 pending', { color: 'amber', size: 12, parent: R });
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
          /* the relay half of the outbox appears in the last beat */
          S.relayG = [S.relay, S.kafka, S.sse, S.client, S.o2, S.o3, S.o4, S.o5];
          hide(S.relayG);
          S.outNote = [S.tShots, S.tOut];
          hide(S.outNote);
          S.svcG = [S.svc, S.db, S.pgT, S.o1, S.o1.labelEl];
          hide(S.svcG);
          hide(R);
          function msg(k) {
            var m = S.im[k];
            m[0].setAttribute('opacity', 1);
            ctx.fade(m[1], 1, 200);
            return ctx.reveal(m[0], { from: 'draw', dur: 300 }).then(function () { return ctx.packet(m[0], { color: M[k][3], dur: 500, r: 4 }); });
          }
          /* beat 0: call succeeds, response stored */
          return ctx.reveal(L, { from: 'left' }).then(function () { return ctx.wait(300); }).then(function () { return msg(0); }).then(function () {
            ctx.fade(S.row, 1, 250);
            ctx.pulse(S.tbl, { color: 'magenta', dur: 500 });
            return msg(1);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the acknowledgement is lost */
            ctx.fade(S.im[1][0], 0.35, 200);
            ctx.fade(S.lost, 1, 250);
            nA.body.setAttribute('stroke', ctx.C.red);
            return ctx.pulse(nA, { color: 'red', times: 2, dur: 450 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the retry hits the stored response */
            nA.body.setAttribute('stroke', ctx.C.amber);
            return msg(2).then(function () {
              ctx.pulse(S.row, { color: 'lime', dur: 500 });
              ctx.fade(S.hit, 1, 250);
              return msg(3);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: state and outbox row in one transaction */
            return ctx.reveal(R, { from: 'right' }).then(function () {
              ctx.reveal([S.svc, S.db, S.pgT], { from: 'up', stagger: 120 });
              ctx.reveal(S.o1, { from: 'draw', delay: 200 });
              ctx.reveal(S.o1.labelEl, { delay: 500 });
              return ctx.wait(700);
            }).then(function () {
              return ctx.packet(S.o1, { color: 'teal', dur: 600, label: 'BEGIN…COMMIT' });
            }).then(function () {
              ctx.reveal(S.outNote, { from: 'scale', stagger: 120 });
              return ctx.pulse(S.db, { color: 'teal', times: 2, dur: 500 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: relay publishes after commit */
            return Promise.all([
              ctx.reveal([S.relay, S.kafka, S.sse, S.client], { from: 'left', stagger: 150 }),
              ctx.reveal([S.o2, S.o3, S.o4, S.o5], { from: 'draw', delay: 250, stagger: 150 })
            ]).then(function () {
              return ctx.packet(S.o2, { color: 'teal', dur: 500, label: 'poll' });
            }).then(function () { return ctx.packet(S.o3, { color: 'orange', dur: 450 }); })
              .then(function () { return ctx.packet(S.o4, { color: 'orange', dur: 450 }); })
              .then(function () { return ctx.packet(S.o5, { color: 'cyan', dur: 450, label: 'evt_7c1' }); });
          });
        }
      },
      /* 8 ------------------------------------------------------------------ */
      {
        title: 'Sagas',
        beats: [
          {
            say: 'There is no global transaction spanning a payment system, a GPU scheduler and object storage. So the workflow runs a saga: a chain of local steps, each committed on its own.',
            card: { tag: 'KEY IDEA', title: 'No global transaction', body: 'Payments, GPU quota and storage cannot share one ACID transaction. A <b>saga</b> replaces it with local steps T₁…Tₙ plus compensations.' },
            deep: '<p>A <b>saga</b> (Garcia-Molina &amp; Salem, 1987) replaces one ACID transaction T with a sequence T<sub>1</sub>…T<sub>n</sub> and compensations C<sub>1</sub>…C<sub>n−1</sub>. The only guarantee is:</p>' +
              '<div class="eq">T<sub>1</sub>T<sub>2</sub>…T<sub>n</sub> &nbsp;or&nbsp; T<sub>1</sub>…T<sub>j</sub>C<sub>j</sub>…C<sub>1</sub></div>' +
              '<p>Helland (2007) argued the same for large systems: without distributed transactions, applications must manage <i>uncertainty</i> explicitly with idempotent, compensating operations.</p>'
          },
          {
            say: 'Each forward step registers its compensation before it runs, so an undo is always ready, even if the step times out halfway.',
            card: { tag: 'HOW IT WORKS', title: 'Register the undo first', body: 'A timed-out <code>reserve_gpu_quota</code> may still have succeeded, so its compensation is pushed on the stack <b>before</b> the call.',
              more: '<p>This is close to the Try-Confirm/Cancel pattern: <i>reserve</i> a tentative hold with an expiry, then <i>confirm</i> on success or <i>cancel</i> on failure. Reserving credits and GPU quota first and charging only at the end makes most compensations cheap, because a cancelled hold never became a real charge.</p>' },
            deep: '<ul><li>Register the compensation <i>before</i> calling the step: a timed-out <code>reserve_gpu_quota</code> may still have succeeded.</li>' +
              '<li>Compensations must be <b>idempotent</b> (a refund keyed by the original charge id) so that a compensation of a step that did not happen is a harmless no-op.</li>' +
              '<li>Orchestrated sagas (one workflow owns the order) are far easier to reason about than choreographed ones (services reacting to each other’s events).</li></ul>'
          },
          {
            say: 'Some failures are final. Suppose the output safety check rejects the final cut. That is a policy violation, so retrying cannot help.',
            card: { tag: 'PITFALL', title: 'A policy no is not retryable', body: 'A <b>non-retryable</b> error skips the retry policy and triggers the saga: forward progress is impossible, so the workflow unwinds.' },
            deep: '<p>The safety classifier rejected the cut in <code>edit_and_encode</code>. The activity raises <code>PolicyViolation</code>, listed in <code>non_retryable_error_types</code>, so no attempt is repeated. The exception propagates into the workflow, whose <code>except</code> block starts the unwind.</p>' +
              '<p>Steps not yet executed (<code>publish_to_cdn</code>) never run, and never need compensating.</p>'
          },
          {
            say: 'The compensations run in reverse order: delete the partial renditions, delete the rendered clips, release the GPU quota, and refund the credits.',
            card: { tag: 'HOW IT WORKS', title: 'Undo in reverse order', body: 'Last in, first out: C₄, then C₃, C₂, C₁. Each compensation undoes only what its own step did.' },
            deep: '<p>The workflow pops its undo stack: <code>delete_renditions</code>, <code>delete_partial_assets</code>, <code>release_quota</code>, <code>refund_credits</code>. Reverse order matters: later steps may depend on earlier ones (a rendition cannot outlive its clips; a GPU quota must not be released while renders still run).</p>' +
              '<p>Refunds and deletions are <b>semantic</b> undo: a refund is a new ledger entry, not an erased charge.</p>'
          },
          {
            say: 'Compensations are activities too, so they are retried until they succeed. Irreversible steps like publishing go last, after the pivot point.',
            card: { tag: 'TRADE-OFF', title: 'Semantic undo, no isolation', body: 'A refund is a new ledger entry, not a rollback, and other readers may see intermediate states. Put irreversible steps <b>last</b>.' },
            deep: '<ul><li><b>Semantic, not physical, undo</b>: a refund is a new ledger entry; an email cannot be unsent, so put irreversible steps (publish, notify) last, after the pivot.</li>' +
              '<li>Compensations are <b>retried forever</b> (or until a human is paged); a durable engine makes “forever” real.</li>' +
              '<li>No isolation: other readers may observe intermediate states (the creator briefly sees credits reserved). Use semantic locks or pending states if that matters.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
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
          S.irr = ctx.text(1410, 344, 'irreversible → goes last', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.sg, opacity: 0 });
          S.x = ctx.group({ parent: S.sg });
          ctx.text(1105, 236, '✕ PolicyViolation (output safety) · non-retryable', { size: 13, font: 'mono', weight: 600, color: 'red', anchor: 'middle', parent: S.x });
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
          S.scHl = ctx.rect(254, 580 + 46 + 8 * 13.5 * 1.55 - 11, 1092, 22, { rx: 3, fill: ctx.alpha('red', 0.14), stroke: ctx.alpha('red', 0.6), sw: 1, parent: S.sg, opacity: 0 });
          hide(S.fw); hide(S.cp); hide(S.fl); hide(S.vl); hide(S.bl); hide(S.x); hide(S.sc);
          /* beat 0: the forward chain */
          return Promise.all([ctx.reveal(S.fw, { from: 'up', stagger: 120 }), ctx.reveal(S.fl, { from: 'draw', delay: 300, stagger: 120 })]).then(function () {
            return ctx.reveal(S.irr, { dur: 300 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: each step registers its compensation before it runs */
            ctx.reveal(S.sc, { from: 'up', delay: 200 });
            ctx.reveal(S.cp, { from: 'down', stagger: 120, opacity: 0.35 });
            ctx.reveal(S.vl, { from: 'draw', delay: 300, stagger: 100 });
            return ctx.wait(1000).then(function () {
              var chain = Promise.resolve();
              [0, 1, 2].forEach(function (k) {
                chain = chain.then(function () {
                  S.cp[k].setAttribute('data-op', 1);
                  ctx.fade(S.cp[k], 1, 200);
                  return ctx.packet(S.fl[k], { color: 'lime', dur: 450 });
                });
              });
              return chain;
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the safety check rejects the cut */
            ctx.fade(S.cp[3], 1, 200);
            S.fw[3].body.setAttribute('stroke', ctx.C.red);
            ctx.fade(S.x, 1, 250);
            ctx.fade(S.fw[4], 0.3, 300);
            return ctx.pulse(S.fw[3], { color: 'red', times: 2, dur: 450 }).then(function () {
              S.cp[3].body.setAttribute('fill', ctx.alpha('pink', 0.18));
              return ctx.packet(S.vl[3], { color: 'red', dur: 450 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: compensations run in reverse */
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
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: retried until success; the pivot */
            ctx.fade(S.scHl, 1, 300);
            ctx.pulse(S.fw[4], { color: 'cyan', times: 2, dur: 500 });
            ctx.hud('T₁T₂T₃T₄✕ → C₄C₃C₂C₁ · credits refunded');
            return ctx.wait(600);
          });
        }
      },
      /* 9 ------------------------------------------------------------------ */
      {
        title: 'The whole run',
        beats: [
          {
            say: 'Here is the whole trailer workflow on one timeline, measured in compute time. Planning, the script and the storyboard take about forty seconds.',
            card: { tag: 'NUMBERS', title: 'One trailer, start to finish', stat: { v: '≈ 220', u: 's compute', l: 'critical path, not counting the human approval wait' } },
            deep: '<pre>critical path, seconds\n 12 + 10 + 18   plan/script/board\n + [human]      0 workers held\n + 4            S4 queue wait\n + 149          S4: attempts 1 + 2\n + 10 + 14 + 3  critic/edit/publish\n = 220 s compute</pre>' +
              '<p>Compare the failure-free run: S4 would finish at 44 + 101 = 145&nbsp;s and the whole workflow at about 172&nbsp;s. Human think time sits outside this axis: the workflow is simply not running during it.</p>'
          },
          {
            say: "After the storyboard, the workflow waits on a signal for the creator's approval, holding no worker and no GPU while it waits.",
            card: { tag: 'KEY IDEA', title: 'A wait that costs nothing', body: 'A signal is just an event in the history. The workflow sleeps in <code>wait_condition</code>: seven minutes or seven days, no worker, no GPU.' },
            deep: '<p><b>Signals</b> (<code>approve_storyboard</code>): async messages appended to the history; the workflow sleeps in <code>wait_condition</code> with zero workers held. Waiting 7 minutes or 7 days costs the same. A durable timer can send a reminder or auto-cancel after 48&nbsp;h.</p>'
          },
          {
            say: 'Then the shots render in parallel, and the client can query progress at any time without changing the history.',
            card: { tag: 'HOW IT WORKS', title: 'Queries read, signals write', body: 'A <b>query</b> is a synchronous read of the workflow state, never recorded. An <b>update</b> is a validated signal that also returns a result.' },
            deep: '<ul><li><b>Queries</b> (<code>progress()</code>): synchronous, read-only, served by replaying or cached state; never recorded in history.</li>' +
              '<li><b>Updates</b> (<code>change_music(style)</code>): validated, recorded, and they return a result: a signal plus a response.</li></ul>' +
              '<p>Rule of thumb: a signal when the sender needs no answer, an update when it does, a query to read. Only signals and updates enter the history; queries never touch it.</p>'
          },
          {
            say: 'Shot four loses its GPU mid-render, times out on heartbeat, and resumes from its checkpoint on another node.',
            card: { tag: 'NUMBERS', title: 'What one GPU loss costs', stat: { v: '+48 s', l: 'what one lost GPU adds: shot 4 ends at 193 s, not 145 s' } },
            deep: '<pre>S4: 74 s in attempt 1, 7 steps of\n    it lost (31–37); 29 s to detect\n    and reschedule; 46 s resumed\n    from step 30 on gpu-17</pre>' +
              '<div class="eq">193 − 145 = 48 s ≈ 14 (lost steps 31–37) + 29 (detect, reschedule) + 5 (reload, warm-up)</div>' +
              '<p>Without heartbeats the detection alone would take the 20-minute start_to_close; without the checkpoint the resumed attempt would take ~101&nbsp;s instead of 46&nbsp;s. The loss is bounded twice: by the heartbeat timeout and by the checkpoint interval.</p>'
          },
          {
            say: 'And when we deploy a new critic, patching and worker versioning let in-flight histories keep replaying the old code path. Every side effect happens once, and the film finishes despite the crash.',
            card: { tag: 'STATE OF THE ART', title: 'Deploy without breaking replays', body: '<code>workflow.patched("critic-v2")</code> or worker versioning pins running histories to the code that started them, so replay stays deterministic.' },
            deep: '<ul><li><b>Versioning</b>: <code>if workflow.patched("critic-v2"): …</code> writes a marker so new runs take the new branch while old histories replay the old one; or <b>Worker Versioning</b> (Worker Deployment Versions) pins running workflows to the build that started them.</li>' +
              '<li><b>continue_as_new</b> for workflows that would exceed history limits (e.g. a series generator looping over episodes).</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.sg, 450);
          S.full = ctx.group();
          var G = S.full;
          function X(t) { return 250 + t * 5.8; }
          var rows = [
            ['plan', [[0, 12, 'amber']]], ['script', [[12, 22, 'amber']]], ['storyboard', [[22, 40, 'violet']]],
            ['shot 1', [[40, 128, 'lime']]], ['shot 2', [[40, 136, 'lime']]], ['shot 3', [[40, 132, 'lime']]],
            ['shot 4', [[44, 118, 'lime'], [118, 147, 'red'], [147, 193, 'cyan']]], ['shot 5', [[44, 142, 'lime']]], ['shot 6', [[44, 139, 'lime']]],
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
          ctx.label(X(40) + 8, 205, 'signal approve_storyboard · human 7 min · 0 workers held', { color: 'cyan', size: 11.5, anchor: 'start', parent: S.gate });
          S.gate.setAttribute('opacity', 0);
          S.s4 = ctx.group({ parent: G });
          ctx.icon('bolt', X(118), 436, 20, 'red', { parent: S.s4 });
          ctx.text(X(132.5) + 4, 436.5, 'detect + retry', { size: 11.5, font: 'mono', color: '#ff9aad', anchor: 'middle', parent: S.s4 });
          ctx.text(X(170), 436.5, 'resume @ step 30', { size: 11.5, font: 'mono', color: 'white', anchor: 'middle', parent: S.s4 });
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
            g.setAttribute('opacity', 0);
            return g;
          });
          function upd(tt) {
            S.bars.forEach(function (b) { b.el.setAttribute('width', Math.max(0, X(Math.min(tt, b.t1)) - X(b.t0)) * (tt > b.t0 ? 1 : 0)); });
            S.ph.setAttribute('x1', X(tt)); S.ph.setAttribute('x2', X(tt));
          }
          upd(0);
          hide(G);
          /* beat 0: planning, script, storyboard */
          return ctx.reveal(G, { dur: 400 }).then(function () {
            return ctx.tween(2200, function (e, raw) { upd(raw * 40); }, 'linear');
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the approval signal */
            ctx.fade(S.gate, 1, 300);
            ctx.reveal(S.items[0], { from: 'left', dur: 400 });
            return ctx.pulse(S.gate, { color: 'cyan', dur: 700 }).then(function () { return ctx.wait(500); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: shots render in parallel; queries and updates */
            ctx.reveal(S.items.slice(1, 3), { from: 'left', delay: 300, stagger: 200 });
            return ctx.tween(3200, function (e, raw) { upd(40 + raw * 78); }, 'linear');
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: shot 4 loses its GPU and resumes */
            return ctx.tween(2600, function (e, raw) { upd(118 + raw * 75); }, 'linear').then(function () {
              ctx.fade(S.s4, 1, 300);
              return ctx.pulse(S.s4, { color: 'red', dur: 600 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: critic, edit, publish; versioning */
            ctx.reveal(S.items[3], { from: 'left', dur: 400 });
            return ctx.tween(1600, function (e, raw) { upd(193 + raw * 27); }, 'linear').then(function () {
              ctx.fade(S.ph, 0, 400);
              ctx.hud('220 s compute · 1 GPU loss survived');
              return ctx.wait(500);
            });
          });
        }
      }
    ]
  });
})();
