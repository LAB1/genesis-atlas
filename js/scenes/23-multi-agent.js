/* L2 — Multi-Agent Collaboration. A film crew of agents: topologies, pass-by-reference artifacts,
 * a shared production bible, parallel fan-out, a critic gate, cost trade-offs and the A2A protocol.
 * Beat format: every step is split into beats (say + card + deep + a gated animation segment). */
(function () {
  var AG = [
    { t: 'Writer', s: 'beats · script.md', ic: 'doc', tool: 'LLM', tc: 'amber', pk: 'write' },
    { t: 'Storyboard', s: 'shot list · frames', ic: 'image', tool: 'image model', tc: 'violet', pk: 'board' },
    { t: 'Cinematographer', s: 'prompts · camera', ic: 'film', tool: 'video DiT', tc: 'lime', pk: 'shots' },
    { t: 'Sound Designer', s: 'VO · score · foley', ic: 'music', tool: 'TTS · V2A', tc: 'orange', pk: 'audio' },
    { t: 'Editor', s: 'EDL · timeline', ic: 'layers', tool: 'compositor', tc: 'cyan', pk: 'cut' },
    { t: 'Critic', s: 'VLM judge · rubric', ic: 'eye', tool: 'VLM', tc: 'violet', pk: 'judge' }
  ];
  var AX = [150, 410, 670, 930, 1190, 1450];
  var SHOTS = ['descent streak', 'crash on ice', 'fox exits pod', 'visor close-up', 'walk to ridge', 'title reveal'];
  var DUR = [88, 96, 92, 101, 98, 95];           /* seconds per shot render (illustrative; mean 95 s, sum 570 s) */
  var SUM = DUR.reduce(function (a, b) { return a + b; }, 0);
  var SLOW = 40;                                   /* seconds added by the TRY IT straggler (step 5) */
  var RUB = ['adhere', 'identity', 'motion', 'physics', 'contin.', 'aesth.'];
  var WTS = [0.2, 0.3, 0.15, 0.1, 0.15, 0.1];
  var SC = [
    [0.88, 0.90, 0.84, 0.86, 0.85, 0.87],
    [0.83, 0.85, 0.79, 0.80, 0.84, 0.86],
    [0.81, 0.41, 0.82, 0.84, 0.55, 0.83],
    [0.86, 0.89, 0.80, 0.88, 0.86, 0.90],
    [0.84, 0.87, 0.81, 0.83, 0.82, 0.85],
    [0.90, 0.92, 0.88, 0.90, 0.87, 0.91]
  ];
  var SC3B = [0.86, 0.88, 0.84, 0.86, 0.87, 0.85];

  /* SVG collapses leading spaces: indent code lines with no-break spaces */
  function nb(lines) { return lines.map(function (s) { return s.replace(/^ +/, function (m) { return ' '.repeat(m.length); }); }); }
  function total(row) { var s = 0; for (var i = 0; i < row.length; i++) s += row[i] * WTS[i]; return s; }
  function scoreCol(ctx, v) { return v < 0.6 ? ctx.C.red : (v < 0.75 ? ctx.C.amber : ctx.C.lime); }
  function hide(list) { [].concat(list).forEach(function (e) { if (e) e.setAttribute('opacity', 0); }); }
  /* org-chart delegation route: director bottom -> shared bus -> agent top (keeps the fan-out uncluttered) */
  var BUS_Y = 340;
  function busPath(x) {
    var r = 16, s = x > 800 ? 1 : -1;
    return 'M800,297 L800,' + (BUS_Y - r) + ' Q800,' + BUS_Y + ' ' + (800 + s * r) + ',' + BUS_Y +
      ' L' + (x - s * r) + ',' + BUS_Y + ' Q' + x + ',' + BUS_Y + ' ' + x + ',' + (BUS_Y + r) + ' L' + x + ',428';
  }

  function panel(ctx, x, y, w, h, col, parent) {
    return ctx.rect(x, y, w, h, { rx: 12, fill: 'rgba(7,12,26,0.93)', stroke: ctx.alpha(col, 0.5), sw: 1.2, parent: parent });
  }
  function head(ctx, x, y, str, col, parent, anchor) {
    return ctx.text(x, y, str, { size: 13, font: 'mono', weight: 600, color: col, parent: parent, anchor: anchor || 'start', spacing: 1.2 });
  }

  /* tiny procedurally drawn fox astronaut */
  function fox(ctx, cx, cy, s, visor, parent) {
    var g = ctx.group({ parent: parent });
    ctx.el('ellipse', { cx: cx, cy: cy + 7 * s, rx: 5.5 * s, ry: 7 * s, fill: '#e8eef5' }, g);
    ctx.poly([[cx - 5 * s, cy - 1 * s], [cx - 4 * s, cy - 9 * s], [cx - 1.5 * s, cy - 3 * s], [cx + 1.5 * s, cy - 3 * s], [cx + 4 * s, cy - 9 * s], [cx + 5 * s, cy - 1 * s], [cx, cy + 3 * s]], { fill: '#ff8a3d', parent: g });
    ctx.circle(cx, cy - 1 * s, 5.2 * s, { stroke: visor, sw: 1.3, parent: g });
    return g;
  }

  /* 100x56 thumbnail of shot v; bad=true draws the drifted (amber visor) version */
  function thumb(ctx, x, y, v, parent, bad) {
    var w = 100, h = 56, g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 4, fill: v === 3 ? '#1a0a14' : '#060b1a', stroke: ctx.alpha(bad ? 'red' : 'lime', 0.7), sw: 1.2, parent: g });
    var r = ctx.rng(31 + v);
    for (var i = 0; i < 4; i++) ctx.circle(x + 8 + r() * (w - 16), y + 5 + r() * 20, 0.9, { fill: '#cfe3ff', opacity: 0.8, parent: g });
    var teal = ctx.C.teal, vis = bad ? ctx.C.amber : teal;
    if (v === 0) {
      ctx.circle(x + 78, y + 50, 22, { fill: ctx.alpha('violet', 0.35), stroke: ctx.alpha(teal, 0.8), sw: 1, parent: g });
      ctx.line(x + 10, y + 8, x + 58, y + 34, { color: 'orange', sw: 2.2, parent: g, glow: true });
    } else if (v === 1) {
      ctx.poly([[x + 1, y + 44], [x + 40, y + 36], [x + 99, y + 42], [x + 99, y + 55], [x + 1, y + 55]], { fill: ctx.alpha(teal, 0.35), parent: g });
      ctx.circle(x + 52, y + 36, 10, { fill: ctx.alpha('orange', 0.75), parent: g, glow: true });
    } else if (v === 2) {
      ctx.poly([[x + 1, y + 46], [x + 99, y + 42], [x + 99, y + 55], [x + 1, y + 55]], { fill: ctx.alpha(teal, 0.3), parent: g });
      ctx.rect(x + 16, y + 14, 26, 32, { rx: 3, stroke: 'dim', sw: 1.2, parent: g });
      fox(ctx, x + 60, y + 30, 1.25, vis, g);
      if (bad) ctx.circle(x + 60, y + 21, 3, { fill: ctx.alpha('amber', 0.5), parent: g });
    } else if (v === 3) {
      fox(ctx, x + 50, y + 28, 2.2, teal, g);
    } else if (v === 4) {
      ctx.path('M' + (x + 1) + ',' + (y + 44) + ' L' + (x + 30) + ',' + (y + 30) + ' L' + (x + 55) + ',' + (y + 38) + ' L' + (x + 99) + ',' + (y + 24), { stroke: 'violet', sw: 2, parent: g, glow: true });
      fox(ctx, x + 36, y + 40, 0.9, teal, g);
    } else {
      ctx.text(x + 50, y + 29, 'VEGA', { size: 15, font: 'display', weight: 700, anchor: 'middle', color: 'white', parent: g, spacing: 4 });
    }
    return g;
  }

  Atlas.register({
    id: 'multi-agent',
    refs: [
      'Anthropic Engineering, <i>How we built our multi-agent research system</i>, June 2025',
      'Cognition (W. Yan), <i>Don\'t Build Multi-Agents</i>, June 2025',
      'Cemri et al., <i>Why Do Multi-Agent LLM Systems Fail?</i> (MAST taxonomy), arXiv 2503.13657, 2025',
      'Google / Linux Foundation, <i>Agent2Agent (A2A) Protocol Specification</i> v0.3, 2025',
      'Du et al., <i>Improving Factuality and Reasoning in Language Models through Multiagent Debate</i>, ICML 2024',
      'Hong et al., <i>MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework</i>, ICLR 2024',
      'Wu et al., <i>AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation</i>, COLM 2024',
      'Zheng et al., <i>Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena</i>, NeurIPS 2023'
    ],
    steps: [
      /* 1 ------------------------------------------------------------------ */
      {
        title: 'The film crew',
        beats: [
          {
            say: "Zoom into the crew. A creator's brief lands on the director, and the director is a supervisor: it reads the request, writes a plan and a budget, and delegates instead of doing the work itself.",
            card: { tag: 'KEY IDEA', title: 'A supervisor that never renders', body: 'The director <b>plans, budgets, dispatches and joins</b>. Keeping its own context small keeps its decisions auditable.' },
            deep: '<p>A crew is an <b>orchestrator–worker</b> system. The director is a frontier reasoning model whose only tools are <code>spawn</code>, <code>join</code> and <code>budget</code>. Its output is a typed <code>plan.json</code>: a DAG of tasks with per-task token, GPU-second and retry budgets.</p>' +
              '<div class="note">The supervisor never renders anything itself: it plans, dispatches, joins and enforces budgets. That keeps its own context small and its decisions auditable.</div>'
          },
          {
            say: 'Around it sit narrow specialists. A writer drafts the beats, a storyboard agent designs the shots, a cinematographer turns each shot into a precise prompt for the video model, a sound designer handles voice and music, and an editor owns the timeline.',
            card: { tag: 'HOW IT WORKS', title: 'An agent is four things', body: 'A <b>system prompt</b>, a <b>tool subset</b>, a <b>model tier</b> and a <b>budget</b>, joined by JSON-Schema interfaces. Narrow roles are cheaper to run, easier to test, safer to arm.' },
            deep: '<p>Each agent is <b>a system prompt + a tool subset + a model tier + a budget</b>, wired together with typed (JSON-Schema) interfaces. Narrow roles make each agent easier to evaluate, cheaper to run and safer to give tools to.</p>' +
              '<table><tr><th>Agent (model)</th><th>Tools</th><th>Output</th></tr>' +
              '<tr><td>Director (frontier reasoner)</td><td>spawn, join, budget</td><td><code>plan.json</code></td></tr>' +
              '<tr><td>Writer (mid-tier LLM)</td><td>read bible</td><td><code>script.md</code></td></tr>' +
              '<tr><td>Storyboard (LLM + image)</td><td>gen_image, refs</td><td><code>board.json</code></td></tr>' +
              '<tr><td>Cinematographer (LLM)</td><td>render_shot</td><td>shot URIs</td></tr>' +
              '<tr><td>Sound (LLM + TTS/V2A)</td><td>tts, music, foley</td><td>stems</td></tr>' +
              '<tr><td>Editor (LLM + compositor)</td><td>EDL → ffmpeg</td><td><code>cut.mp4</code></td></tr></table>'
          },
          {
            say: 'The sixth member is the critic, a vision language model that judges every clip against a rubric. It never made the clip, so its verdict is an independent check.',
            card: { tag: 'WHY IT MATTERS', title: 'Generator and judge stay apart', body: 'A model tends to approve its own work. A separate critic, with its own prompt and no view of the maker\'s reasoning, catches what the maker cannot see.',
              more: '<p>LLM judges show <b>self-enhancement</b>, position and verbosity biases (Zheng et al., 2023). Where budget allows, run the critic on a different model family from the generator, and calibrate its thresholds against human-labelled clips.</p>' },
            deep: '<p><b>Critic (VLM)</b>: tools <code>frames</code>, <code>embed</code>, <code>score</code>; output a structured <code>verdict</code>. It samples frames, embeds character crops, compares them with the shared bible and scores a rubric (step 6).</p>' +
              '<p>Independence is the design goal: separate prompt, separate context, ideally a different model family, because judges favour their own generations. Steps 6 and 7 show what the critic buys and what it costs.</p>'
          },
          {
            say: 'Each specialist has its own tools, and they all read and write one shared artifact store, the blackboard where scripts, clips and verdicts live.',
            card: { tag: 'HOW IT WORKS', title: 'One shared blackboard', body: 'Agents rarely message each other. They <b>write artifacts</b> to the store and pass small references, so the crew stays decoupled and every step is replayable.' },
            deep: '<p>The <b>artifact store</b> is object storage plus a metadata index: content-addressed, versioned, immutable blobs such as <code>shot03/v1.mp4</code> or <code>bible/v3</code>. Agents get short-lived pre-signed URLs, never bucket credentials.</p>' +
              '<p>Two consequences we exploit next: hand-offs carry <i>references</i>, not bytes, and every artifact has a producer, a version and a hash, so any decision can be audited and replayed.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.crew = ctx.group();
          S.brief = ctx.code({ x: 1010, y: 84, w: 540, title: 'user.request', lang: 'text', typing: true, size: 13, maxLines: 2, color: 'cyan', parent: S.crew, lines: [
            '"30 s trailer: a fox astronaut crash-lands on',
            ' a glowing ice moon" + 3 sketches + voice memo'
          ] });
          S.dir = ctx.node({ x: 800, y: 255, w: 300, h: 84, title: 'Director', sub: 'supervisor · plan · budget', icon: 'agent', color: 'magenta', titleSize: 19, parent: S.crew });
          S.bl = ctx.link({ x: 1010, y: 130 }, S.dir, { to: 'r', color: 'cyan', parent: S.crew });
          S.store = ctx.node({ x: 800, y: 705, w: 440, h: 96, kind: 'cyl', title: 'Artifact Store', sub: 'blackboard · URIs · production bible', icon: 'db', color: 'teal', parent: S.crew });
          S.agG = []; S.ag = []; S.dl = []; S.sl = [];
          AG.forEach(function (a, i) {
            var g = ctx.group({ parent: S.crew });
            var n = ctx.node({ x: AX[i], y: 470, w: 230, h: 84, title: a.t, sub: a.s, icon: a.ic, color: i === 5 ? 'violet' : 'magenta', titleSize: 15, subSize: 11, parent: g });
            ctx.label(AX[i], 548, a.tool, { color: a.tc, size: 12, parent: g });
            S.agG.push(g); S.ag.push(n);
            S.dl.push(ctx.path(busPath(AX[i]), { stroke: ctx.alpha('magenta', 0.75), sw: 1.8, arrow: true, parent: S.crew }));
            S.sl.push(ctx.link({ x: AX[i], y: 562 }, { x: 800 + (i - 2.5) * 62, y: 662 }, { from: 'b', to: 't', color: ctx.alpha('teal', 0.55), dash: '3 5', arrow: false, parent: S.crew }));
          });
          S.caption = ctx.text(800, 805, 'supervisor (orchestrator–worker): one planner, six typed specialists, one shared store', { size: 14, font: 'mono', color: 'dim', anchor: 'middle', parent: S.crew });
          hide([S.brief, S.dir, S.bl, S.store, S.caption]); hide(S.agG); hide(S.dl); hide(S.sl);
          var five = [0, 1, 2, 3, 4];
          /* beat 0: the brief arrives and the director wakes up */
          ctx.reveal(S.brief, { from: 'down', dur: 450 });
          ctx.reveal(S.dir, { from: 'scale', delay: 200 });
          ctx.reveal(S.bl, { from: 'draw', delay: 500 });
          return S.brief.typeAll().then(function () {
            return ctx.packet(S.bl, { color: 'cyan', dur: 700, label: 'brief' });
          }).then(function () {
            return ctx.pulse(S.dir, { color: 'magenta', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: five specialists, delegation packets */
            return Promise.all([
              ctx.reveal(five.map(function (i) { return S.agG[i]; }), { from: 'up', stagger: 110 }),
              ctx.reveal(five.map(function (i) { return S.dl[i]; }), { from: 'draw', delay: 200, stagger: 110 })
            ]).then(function () {
              return Promise.all(five.map(function (i, k) { return ctx.wait(k * 160).then(function () { return ctx.packet(S.dl[i], { color: 'magenta', dur: 900, label: AG[i].pk }); }); }));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the critic */
            return Promise.all([ctx.reveal(S.agG[5], { from: 'up' }), ctx.reveal(S.dl[5], { from: 'draw', delay: 200 })]).then(function () {
              ctx.pulse(S.ag[5], { color: 'violet', times: 2, dur: 600 });
              return ctx.packet(S.dl[5], { color: 'violet', dur: 900, label: AG[5].pk });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the shared artifact store */
            return Promise.all([
              ctx.reveal(S.store, { from: 'up' }),
              ctx.reveal(S.sl, { from: 'draw', delay: 300, stagger: 60 }),
              ctx.reveal(S.caption, { delay: 900 })
            ]).then(function () {
              ctx.pulse(S.store, { color: 'teal', dur: 700 });
              return Promise.all(S.sl.map(function (l, i) { return ctx.wait(i * 90).then(function () { return ctx.packet(l, { color: 'teal', r: 4, dur: 700 }); }); }));
            });
          });
        }
      },
      /* 2 ------------------------------------------------------------------ */
      {
        title: 'Topologies',
        beats: [
          {
            say: 'There is more than one way to wire a crew. In a supervisor topology, one orchestrator delegates and joins. Hierarchies add middle managers, so a lead can own a batch of workers.',
            card: { tag: 'HOW IT WORKS', title: 'Delegate down, summarize up', body: '<b>Supervisor</b>: one hub, simple control, bounded cost. <b>Hierarchy</b>: leads own batches, so dozens of workers scale, at the price of latency and lossy summaries per tier.' },
            deep: '<ul><li><b>Supervisor</b> (orchestrator–worker): a central LLM decomposes, fans out and joins. Control is central, parallelism is fan-out then join, context flows as brief down and summary up. Every join costs a hub LLM hop.</li>' +
              '<li><b>Hierarchical</b>: a tree of leads, here a visual lead over the shots and an audio lead over voice and music. Each level compresses upward, so it scales to dozens of workers, but latency adds per tier and errors compound across tiers.</li></ul>' +
              '<p>Frameworks: LangGraph supervisor graphs, CrewAI’s hierarchical process, and the orchestrator–worker design of Anthropic’s research system.</p>'
          },
          {
            say: 'Handoffs pass control itself from agent to agent, like a relay baton. There is no central hop, but only one agent is active at a time, and the whole history has to travel with the baton.',
            card: { tag: 'TRADE-OFF', title: 'Baton passing is serial', body: 'No hub, and natural for triage and routing. But one agent is active at a time and the full context travels along, so latency is the <b>sum</b> of every turn.' },
            deep: '<p><b>Handoff (swarm)</b>: control transfers together with the conversation. Parallelism: none, one active agent. Context flow: the full history travels.</p>' +
              '<div class="eq">T<sub>handoff</sub> = Σ<sub>turns</sub> t<sub>i</sub> &nbsp;vs&nbsp; T<sub>supervisor</sub> ≈ critical path + one LLM hop per join</div>' +
              '<p>Used for intake and routing (OpenAI Agents SDK <i>handoffs</i>, the earlier Swarm sample). Risks: ping-pong loops between two agents, and context bloat as history accumulates.</p>'
          },
          {
            say: 'A blackboard lets agents coordinate only through shared state. Each one watches for artifacts it can use and writes new ones. It is asynchronous, resumable and auditable, but it needs schemas and versioning.',
            card: { tag: 'KEY IDEA', title: 'Coordinate through data', body: 'Agents are decoupled by artifacts, not messages. Great for resumability and audit; it needs <b>schemas, versions</b> and conflict rules for shared documents.' },
            deep: '<p><b>Blackboard</b>: control is data-driven, execution is asynchronous, and context flows through shared artifacts. The idea dates to the Hearsay-II speech system (1980); MetaGPT revived it as a shared message pool with role subscriptions.</p>' +
              '<ul><li>Needs typed schemas and immutable versions, so readers never see half-written data.</li>' +
              '<li>Shared documents such as the production bible need optimistic concurrency (compare-and-swap on a version) to avoid write conflicts.</li></ul>'
          },
          {
            say: 'And debate, or critique, pits proposers against each other in front of a judge. An independent check finds errors an author would miss, at two to three times the tokens for a critic, and more for a full debate.',
            card: { tag: 'NUMBERS', title: 'The price of a second opinion', stat: { v: '2–3×', l: 'tokens per decision with a critic (rule of thumb); a full debate costs n × r (6× here)' },
              more: '<p>Cost model: <i>n</i> agents × <i>r</i> rounds mean <i>n·r</i> generations, and in every round after the first each agent also reads the other <i>n−1</i> answers, so the extra prompt tokens grow roughly as <i>n·(n−1)·(r−1)·L</i> for answer length <i>L</i>. Du et al. mainly use 3 agents and 2 rounds; in their study accuracy rises with more rounds and plateaus at about four.</p>' },
            deep: '<p><b>Debate</b> (Du et al., 2024): <i>n</i> agents × <i>r</i> rounds cost about <i>n·r</i> generations and improve factuality and arithmetic reasoning. Context flows as exchanged arguments; the judge decides with evidence.</p>' +
              '<p>In media pipelines the cheaper variant usually wins: <b>generate → critique → targeted redo</b>. Caveat: judges share biases with the proposers, so agreement is weaker evidence than it looks.</p>'
          },
          {
            say: 'Our trailer mixes three of them: a supervisor for control, a blackboard for artifacts, and a critic loop for quality. Supervisor latency is the critical path plus one language model hop per join, while a handoff chain pays for every turn.',
            card: { tag: 'KEY IDEA', title: 'Mix topologies per problem', body: 'Trailer: <b>supervisor</b> for control, <b>blackboard</b> for artifacts, <b>critique loop</b> for quality. Choose per sub-problem, not per system.' },
            deep: '<table><tr><th>Topology</th><th>Control</th><th>Context flow</th></tr>' +
              '<tr><td>Supervisor</td><td>central LLM</td><td>brief down, summary up</td></tr>' +
              '<tr><td>Hierarchical</td><td>tree of leads</td><td>compressed per level</td></tr>' +
              '<tr><td>Handoff (swarm)</td><td>baton passes</td><td>full history travels</td></tr>' +
              '<tr><td>Blackboard</td><td>data-driven</td><td>via shared artifacts</td></tr>' +
              '<tr><td>Debate / critique</td><td>judge</td><td>arguments exchanged</td></tr></table>' +
              '<p>Parallelism: fan-out and join (supervisor), high per subtree (hierarchy), none (handoff), asynchronous (blackboard), proposers in parallel (debate).</p>' +
              '<p>Frameworks map onto these: LangGraph supervisor graphs, OpenAI Agents SDK <i>handoffs</i>, AutoGen group chat, MetaGPT SOP pipelines.</p>' +
              '<div class="note">Latency of a supervisor is the critical path through the DAG plus one LLM hop per join; a handoff chain is the <i>sum</i> of all turns.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.crew, 0, 500);
          S.topo = ctx.group();
          S.topoStreams = [];
          var specs = [[], [], [], [], []];
          var cards = [
            { t: 'Supervisor', s: 'orchestrator–worker', used: 'director → 6 specialists',
              p: ['+ simple control, bounded cost', '+ parallel fan-out + join', '− hub context is a bottleneck', '− every join costs an LLM hop'] },
            { t: 'Hierarchical', s: 'tree of leads', used: 'director → shot lead → ×6',
              p: ['+ scales to dozens of workers', '+ leads compress results up', '− latency + loss per level', '− errors compound across tiers'] },
            { t: 'Handoff', s: 'swarm · baton passing', used: 'intake → director only',
              p: ['+ no central hop, agent owns turn', '+ natural for triage / routing', '− serial; can ping-pong', '− full context must travel'] },
            { t: 'Blackboard', s: 'shared artifact state', used: 'artifact store + bible',
              p: ['+ agents decoupled by data', '+ async, resumable, auditable', '− needs schemas + versions', '− write conflicts on shared docs'] },
            { t: 'Debate / critique', s: 'proposers + judge', used: 'critic ↔ cinematographer',
              p: ['+ independent check finds errors', '+ judge decides with evidence', '− 2–3× tokens per decision', '− judges share model biases'] }
          ];
          var cardEls = [], nStream = 0;
          cards.forEach(function (c, i) {
            var x = 36 + i * 309, y = 172, w = 295, cx = x + w / 2;
            var g = ctx.group({ parent: S.topo });
            panel(ctx, x, y, w, 530, 'magenta', g);
            ctx.text(x + 16, y + 28, c.t, { size: 18, font: 'display', weight: 700, color: 'white', parent: g });
            ctx.text(x + 16, y + 52, c.s, { size: 12, font: 'mono', color: 'dim', parent: g });
            var gg = ctx.group({ parent: g });
            function dot(px, py, lab, col) {
              var rr = lab.length > 3 ? 23 : 17;
              ctx.circle(px, py, rr, { fill: ctx.alpha(col, 0.16), stroke: col, sw: 1.5, parent: gg });
              ctx.text(px, py + 0.5, lab, { size: 11, font: 'mono', weight: 600, anchor: 'middle', color: 'white', parent: gg });
              return { x: px, y: py, r: rr };
            }
            function edge(a, b, col, back) {
              var dx = b.x - a.x, dy = b.y - a.y, L = Math.sqrt(dx * dx + dy * dy), ux = dx / L, uy = dy / L;
              var p = ctx.path('M' + (a.x + ux * (a.r + 2)) + ',' + (a.y + uy * (a.r + 2)) + ' L' + (b.x - ux * (b.r + 2)) + ',' + (b.y - uy * (b.r + 2)), { stroke: ctx.alpha(col, 0.55), sw: 1.4, parent: gg });
              specs[i].push({ p: p, o: { color: col, count: 1, period: 1800 + (nStream++ % 5) * 170, r: 3 } });
              if (back) specs[i].push({ p: p, o: { color: 'teal', count: 1, period: 2300, r: 2.6, reverse: true } });
              return p;
            }
            var M = 'magenta';
            if (i === 0) {
              var hub = dot(cx, y + 115, 'Dir', M);
              [-105, -35, 35, 105].forEach(function (dx, k) { edge(hub, dot(cx + dx, y + 265, ['W', 'SB', 'C', 'Ed'][k], M), M, true); });
            } else if (i === 1) {
              var root = dot(cx, y + 100, 'Dir', M), l1 = dot(cx - 70, y + 185, 'Vis', M), l2 = dot(cx + 70, y + 185, 'Aud', 'orange');
              edge(root, l1, M); edge(root, l2, M);
              edge(l1, dot(cx - 110, y + 280, 'S1', 'lime'), M, true); edge(l1, dot(cx - 38, y + 280, 'S2', 'lime'), M, true);
              edge(l2, dot(cx + 38, y + 280, 'VO', 'orange'), 'orange', true); edge(l2, dot(cx + 110, y + 280, 'Mx', 'orange'), 'orange', true);
            } else if (i === 2) {
              var pts = [[cx, y + 105, 'In'], [cx + 95, y + 195, 'Dir'], [cx, y + 285, 'Wr'], [cx - 95, y + 195, 'Ed']];
              pts.forEach(function (p) { dot(p[0], p[1], p[2], M); });
              var ring = ctx.path('M' + cx + ',' + (y + 105) + ' L' + (cx + 95) + ',' + (y + 195) + ' L' + cx + ',' + (y + 285) + ' L' + (cx - 95) + ',' + (y + 195) + ' Z', { stroke: ctx.alpha(M, 0.45), sw: 1.4, dash: '4 5', parent: gg });
              gg.insertBefore(ring, gg.firstChild);
              specs[i].push({ p: ring, o: { color: 'amber', count: 1, period: 4200, r: 6 } });
              ctx.text(cx, y + 195, 'baton', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: gg });
            } else if (i === 3) {
              ctx.rect(cx - 62, y + 160, 124, 70, { rx: 8, fill: ctx.alpha('teal', 0.12), stroke: 'teal', parent: gg });
              ctx.text(cx, y + 186, 'artifacts', { size: 12, font: 'mono', color: 'teal', anchor: 'middle', parent: gg });
              ctx.text(cx, y + 206, 'bible · clips', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: gg });
              [[-105, 100, 'W'], [105, 100, 'SB'], [-105, 292, 'C'], [105, 292, 'Ed']].forEach(function (d) {
                var a = dot(cx + d[0], y + d[1], d[2], M);
                var tgt = { x: cx + (d[0] < 0 ? -62 : 62), y: y + (d[1] < 200 ? 160 : 230) };
                var p = ctx.path('M' + (a.x + (d[0] < 0 ? 14 : -14)) + ',' + (a.y + (d[1] < 200 ? 12 : -12)) + ' L' + tgt.x + ',' + tgt.y, { stroke: ctx.alpha('teal', 0.5), sw: 1.4, parent: gg });
                specs[i].push({ p: p, o: { color: 'teal', count: 1, period: 2000 + d[0] * 3, r: 3 } });
                specs[i].push({ p: p, o: { color: 'magenta', count: 1, period: 2600, r: 2.6, reverse: true } });
              });
            } else {
              var jd = dot(cx, y + 105, 'Judge', 'violet'), A = dot(cx - 85, y + 270, 'A', M), B = dot(cx + 85, y + 270, 'B', M);
              var ab = ctx.path('M' + (cx - 67) + ',' + (y + 262) + ' Q' + cx + ',' + (y + 215) + ' ' + (cx + 67) + ',' + (y + 262), { stroke: ctx.alpha(M, 0.5), sw: 1.4, parent: gg });
              var ba = ctx.path('M' + (cx + 67) + ',' + (y + 280) + ' Q' + cx + ',' + (y + 325) + ' ' + (cx - 67) + ',' + (y + 280), { stroke: ctx.alpha(M, 0.5), sw: 1.4, parent: gg });
              specs[i].push({ p: ab, o: { color: M, count: 1, period: 2000, r: 3 } });
              specs[i].push({ p: ba, o: { color: 'amber', count: 1, period: 2000, r: 3 } });
              edge(A, jd, 'violet'); edge(B, jd, 'violet');
            }
            c.p.forEach(function (line, k) {
              ctx.text(x + 18, y + 355 + k * 25, line, { size: 13, color: line.charAt(0) === '+' ? '#a9f58a' : '#ff9aad', parent: g });
            });
            ctx.line(x + 16, y + 468, x + w - 16, y + 468, { color: 'line', sw: 1, parent: g });
            ctx.text(x + 18, y + 492, 'in the trailer:', { size: 11, font: 'mono', color: 'dim', parent: g });
            ctx.text(x + 18, y + 512, c.used, { size: 12, font: 'mono', color: 'magenta', parent: g });
            hide(g);
            cardEls.push(g);
          });
          S.topoCap = ctx.group({ parent: S.topo });
          ctx.text(800, 748, 'Our trailer composes three of these:', { size: 15, color: 'white', anchor: 'middle', parent: S.topoCap });
          ctx.text(800, 778, 'supervisor (director → specialists)  +  blackboard (artifact store + bible)  +  critique loop (critic ↔ cinematographer)', { size: 14, font: 'mono', color: 'magenta', anchor: 'middle', parent: S.topoCap });
          ctx.text(800, 806, 'latency: supervisor ≈ critical path of the DAG + one LLM hop per join; a handoff chain ≈ the sum of every turn', { size: 12.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.topoCap });
          hide(S.topoCap);
          function show(list) {
            list.forEach(function (i) { specs[i].forEach(function (s) { S.topoStreams.push(ctx.stream(s.p, s.o)); }); });
            return ctx.reveal(list.map(function (i) { return cardEls[i]; }), { from: 'up', stagger: 220, dur: 600 });
          }
          /* beat 0: supervisor + hierarchy */
          return show([0, 1]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: handoff */
            return show([2]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: blackboard */
            return show([3]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: debate */
            return show([4]);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the mix the trailer uses */
            S.topoHl = [0, 3, 4].map(function (i) {
              var r = ctx.rect(36 + i * 309 - 5, 172 - 5, 305, 540, { rx: 14, stroke: 'lime', sw: 2, dash: '8 5', parent: S.topo, glow: true });
              ctx.reveal(r, { dur: 400 });
              return r;
            });
            return ctx.reveal(S.topoCap, { from: 'up', dur: 600 });
          });
        }
      },
      /* 3 ------------------------------------------------------------------ */
      {
        title: 'Pass references',
        beats: [
          {
            say: 'Agents never pass pixels to each other. When the cinematographer finishes shot three, the six megabyte clip goes straight into object storage.',
            card: { tag: 'KEY IDEA', title: 'Bytes stay in the store', body: 'The 6 MB clip is written <b>once</b> to object storage. What moves between agents is a pointer, never the pixels.' },
            deep: '<p><b>Rule: context carries pointers; the store carries bytes.</b> A 5&nbsp;s H.264 shot at about 10&nbsp;Mb/s is roughly 6&nbsp;MB, and it is written exactly once.</p>' +
              '<ul><li><b>Content-addressed</b>: <code>sha256</code> gives dedup and integrity; versions are immutable (<code>v1</code>, <code>v2</code>) so the critic can diff them.</li>' +
              '<li><b>Scoped access</b>: agents receive short-TTL pre-signed GETs, never bucket credentials.</li></ul>'
          },
          {
            say: 'Only a reference travels onward: a URI, a content hash, a duration and a one line summary. The whole message is roughly a hundred tokens.',
            card: { tag: 'NUMBERS', title: 'A whole clip in one line', stat: { v: '≈ 100', u: 'tokens', l: 'the whole artifact_ref: URI, hash, MIME, duration, thumbnail, summary' } },
            deep: '<p>The <code>artifact_ref</code> JSON on the stage is roughly 100 tokens with the hash abbreviated as shown (an estimate; the exact count depends on the tokenizer, and a full 64-character sha256 adds about 30); URIs and hashes tokenize poorly, so do not expect fewer. It carries everything a downstream LLM needs to <i>reason about</i> the clip without seeing it: what it is, who made it, how long it is, a one-line summary and a thumbnail URI.</p>' +
              '<p>Workflow engines enforce the same discipline: Temporal caps a payload at about 2&nbsp;MB, so activities must return references anyway.</p>'
          },
          {
            say: 'Pasting the same clip into context as base sixty four text would cost millions of tokens, and even as sampled video frames it costs tens of thousands, paid again on every turn.',
            card: { tag: 'PITFALL', title: 'Bytes in context are a recurring bill', body: 'Base64 is <b>at least ~3 M tokens</b>, far beyond typical windows. Even sampled frames cost 30,960 at 24 fps, and an agent loop re-sends them every turn.',
              more: '<p>Base64 packs 3 bytes into 4 characters, so 6&nbsp;MB becomes 8 M characters. Tokenizers see near-random strings and merge them poorly: even at a generous 2 to 3 characters per token that is 2.7 to 4 M tokens, and real tokenizers usually do worse, against a typical 200k to 1 M window. A clip is simply not representable as text.</p>' },
            deep: '<div class="eq">C<sub>vis</sub> = f<sub>s</sub> · T · t<sub>frame</sub> &nbsp;⇒&nbsp; 24 fps · 5 s · 258 = 30,960 tokens</div>' +
              '<p>258 tokens per frame is the Gemini API’s default per-frame rate (66 at low media resolution); sampling at 1&nbsp;fps gives 1,290. As base64 text, a 6&nbsp;MB clip becomes 8&nbsp;MB of characters, and even at a generous 2 to 3 characters per token that is at least about 3 M tokens, far beyond typical context windows.</p>' +
              '<p>Worse, an agent loop re-sends its context every turn, so prompt cost grows as Σ<sub>turns</sub>|context| unless a prefix cache absorbs it.</p>'
          },
          {
            say: 'Agents that really need to look, like the critic, fetch and encode the frames themselves, so only the judge pays for dense pixels.',
            card: { tag: 'TRADE-OFF', title: 'Only the judge pays for pixels', body: 'A summary plus a keyframe thumbnail lets any LLM reason about a clip for about 100 tokens. The critic fetches bytes with a <b>pre-signed GET</b> and samples the frames it needs.' },
            deep: '<ul><li><b>Previews</b>: a one-line summary and a keyframe thumbnail let an LLM plan around a clip for about 100 tokens; only the critic pays for dense frames.</li>' +
              '<li><b>Fetch on demand</b>: the critic gets a short-TTL pre-signed GET, decodes the clip itself, samples frames (say 8 to 16) and embeds character crops.</li>' +
              '<li>Its verdict is again a small reference-sized message, so the director’s context grows by hundreds of tokens per shot, not millions.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.topoStreams.forEach(function (h) { h.stop(); });
          ctx.remove(S.topo, 400);
          ctx.fade(S.crew, 1, 500);
          ctx.fade([S.brief, S.bl, S.caption], 0, 400);
          [0, 1, 3, 4].forEach(function (i) { ctx.fade([S.agG[i], S.dl[i], S.sl[i]], 0.2, 500); });
          S.refG = ctx.group();
          /* log-scale token cost bars */
          var bars = ctx.group({ parent: S.refG });
          panel(ctx, 36, 165, 590, 235, 'teal', bars);
          head(ctx, 56, 190, 'TOKENS TO PUT ONE 5 s CLIP IN CONTEXT', 'teal', bars);
          ctx.text(606, 190, 'log scale', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: bars });
          var rows = [['base64 bytes in JSON', 3.0e6, 'red', '≥ 3,000,000'], ['frames @24 fps × 258', 30960, 'amber', '30,960'], ['frames @1 fps × 258', 1290, 'violet', '1,290'], ['artifact_ref (JSON)', 100, 'teal', '~100']];
          S.refBars = []; S.refVals = [];
          rows.forEach(function (r, k) {
            var y = 228 + k * 42;
            ctx.text(56, y, r[0], { size: 13, color: 'text', parent: bars });
            var w = 250 * Math.log(r[1]) / Math.log(3.0e6);
            var b = ctx.rect(250, y - 11, 0, 22, { rx: 4, fill: ctx.alpha(r[2], 0.45), stroke: r[2], sw: 1, parent: bars });
            b.setAttribute('data-w', w);
            S.refVals.push(ctx.text(250 + w + 8, y, r[3], { size: 12, font: 'mono', color: r[2], parent: bars, opacity: 0 }));
            S.refBars.push(b);
          });
          S.refJson = ctx.code({ x: 1000, y: 165, w: 560, title: 'artifact_ref · what actually travels', lang: 'json', size: 13, color: 'teal', typing: true, maxLines: 8, parent: S.refG, lines: nb([
            '{"type": "artifact_ref",',
            ' "uri": "s3://atlas/job-7f3/shot03/v1.mp4",',
            ' "sha256": "9f2c41d0…e41a",',
            ' "mime": "video/mp4", "dur_s": 5.0,',
            ' "thumb": "s3://atlas/job-7f3/shot03/v1_kf.jpg",',
            ' "summary": "fox exits pod, low angle, rim light",',
            ' "producer": "cinematographer#3"}'
          ]) });
          S.fetch = ctx.text(1466, 604, 'fetch frames', { size: 12, font: 'mono', color: 'violet', parent: S.refG, opacity: 0 });
          S.clip = ctx.label(1180, 705, 'stored: shot03/v1.mp4 · 6 MB', { color: 'lime', size: 12, parent: S.refG, opacity: 0 });
          hide([bars, S.refJson]);
          /* beat 0: the clip goes to the store, not to the director */
          ctx.pulse(S.ag[2], { color: 'lime', dur: 600 });
          return ctx.packet(S.sl[2], { color: 'lime', r: 9, dur: 1100, label: 'shot03.mp4 · 6 MB' }).then(function () {
            ctx.reveal(S.clip, { from: 'left', dur: 400 });
            return ctx.pulse(S.store, { color: 'teal', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the reference JSON */
            ctx.reveal(S.refJson, { from: 'right', dur: 450 });
            return S.refJson.typeAll().then(function () {
              return ctx.packet(S.dl[2], { color: 'teal', r: 4, dur: 800, reverse: true, label: 'ref' });
            }).then(function () {
              return ctx.packet(S.dl[5], { color: 'teal', r: 4, dur: 800, label: 'ref · ~100 tok' });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: what pixels would cost */
            return ctx.reveal(bars, { from: 'left', dur: 450 }).then(function () {
              return Promise.all(S.refBars.map(function (b, k) {
                return ctx.animate(b, { width: [0, +b.getAttribute('data-w')] }, 700, 'out', k * 200).then(function () { return ctx.fade(S.refVals[k], 1, 250); });
              }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: only the critic fetches frames */
            ctx.reveal(S.fetch, { dur: 400 });
            return ctx.packet(S.sl[5], { color: 'lime', r: 7, dur: 1000, reverse: true, label: 'GET pre-signed' }).then(function () {
              return ctx.pulse(S.ag[5], { color: 'violet', times: 2, dur: 600 });
            });
          });
        }
      },
      /* 4 ------------------------------------------------------------------ */
      {
        title: 'Production bible',
        beats: [
          {
            say: 'Consistency across six independently rendered shots is the hardest part of AI film. The fix is a shared production bible: a character sheet for the fox, a style guide, and a lighting spec.',
            card: { tag: 'KEY IDEA', title: 'One bible, six shots', body: 'Six workers render in isolation, so identity drifts unless every one of them conditions on the <b>same</b> written and visual specification.' },
            deep: '<p>The bible is one immutable, versioned artifact (<code>bible/v3</code>) consumed two ways:</p>' +
              '<ul><li><b>By LLM agents</b> as a byte-identical <i>prompt prefix</i>: character sheet, style guide, lighting spec, negative prompt.</li>' +
              '<li><b>By the video model</b> as conditioning: reference images of the character, palette and style tokens in every prompt, a fixed negative prompt.</li></ul>' +
              '<div class="note">Consistency is also verified, not just requested: the critic compares every clip against the same sheet (step 6).</div>'
          },
          {
            say: "It also holds a color palette and embeddings of the creator's three sketches, so the video model receives reference images, not only words.",
            card: { tag: 'HOW IT WORKS', title: 'Words plus pictures', body: 'Text steers the LLM agents. The palette and <b>SigLIP embeddings</b> of the sketches condition the video model on subject and style.' },
            deep: '<p>The visual half of the bible: three sketches encoded by SigLIP into embeddings (used for retrieval and for the critic’s identity checks), the same images passed to the video model as <b>subject / identity conditioning</b>, and a five-colour palette repeated as style tokens in every shot prompt.</p>' +
              '<p>A fixed negative prompt (“no text, no extra limbs, no lens warp”) removes the most common artifacts for the price of a few tokens.</p>'
          },
          {
            say: 'Every shot worker starts with exactly the same bible as the prefix of its context, so the serving engine can reuse the cached prefix.',
            card: { tag: 'HOW IT WORKS', title: 'Same bytes, same KV blocks', body: 'vLLM hashes 16-token blocks; SGLang keeps a radix tree. A byte-identical 3.1k-token prefix means its <b>KV cache is computed once</b> and reused.' },
            deep: '<p>Serving engines reuse the KV cache of identical prefixes: vLLM hashes 16-token blocks (automatic prefix caching), SGLang keeps a radix tree (RadixAttention). Any byte change before a block invalidates everything after it, so volatile content (shot brief, tool results) goes <i>after</i> the prefix.</p>' +
              '<p>Here each worker context is 3.1k tokens of bible followed by 0.4k of shot brief.</p>'
          },
          {
            say: 'The first request writes the cache, and the next five read it at a fraction of the cost and latency.',
            card: { tag: 'NUMBERS', title: 'Six workers, one cache write', stat: { v: '−71%', l: 'prefix cost: 1.25P + 5 × 0.1P = 1.75P instead of 6P' },
              more: '<p><b>Fan-out gotcha</b>: a cache entry is usable only after the first request has written it. Six requests fired in the same instant can all miss. Send worker 1 first (or a 1-token warm-up), then fan out, and route all six to the same replica on self-hosted engines.</p>' },
            deep: '<p>Cost with Anthropic-style pricing (5-minute cache write 1.25×, cache read 0.1× the input price) for a prefix of P = 3.1k tokens across 6 workers:</p>' +
              '<div class="eq">1.25P + 5 · 0.1P = 1.75P &nbsp;vs&nbsp; 6P &nbsp;⇒&nbsp; −71% prefix cost</div>' +
              '<p>Cached prefixes also cut time-to-first-token, because prefill of those blocks is skipped. Other providers discount cached input by roughly 50–90%. A prefix must also exceed the model’s minimum cacheable length (512 to 4,096 tokens depending on the Claude model), so a 3.1k prefix qualifies on most models but not on all.</p>' +
              '<p><b>Fan-out gotcha</b>: send worker 1 first, then fan out (the stagger in the animation). Self-hosted engines with a shared radix cache behave the same way within one replica, so use prefix-aware load balancing.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.refG, 400);
          ctx.fade([S.agG[5], S.dl[5], S.sl[5]], 0.2, 400);
          S.bib = ctx.group();
          var bx = 990, by = 160;
          panel(ctx, bx, by, 570, 262, 'teal', S.bib);
          head(ctx, bx + 18, by + 24, 'production_bible.md · v3', 'teal', S.bib);
          ctx.text(bx + 552, by + 24, 'sha256 7e1a…', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.bib });
          var L = [['CHARACTER', 'Vega: red fox, amber eyes, white EVA suit'], ['', 'teal visor, mission patch ARGO-7 (left arm)'], ['STYLE', '2.39:1 anamorphic · 24 fps · fine grain'], ['LIGHT', 'cold 7000K key, teal rim, orange wreck fire'], ['NEGATIVE', 'no text, no extra limbs, no lens warp']];
          L.forEach(function (l, k) {
            ctx.text(bx + 18, by + 56 + k * 24, l[0], { size: 12, font: 'mono', color: 'magenta', parent: S.bib });
            ctx.text(bx + 120, by + 56 + k * 24, l[1], { size: 13, color: 'text', parent: S.bib });
          });
          S.bibB = ctx.group({ parent: S.bib });
          var pal = [['#ff8a3d', 'fur'], ['#e8eef5', 'suit'], ['#2bf5c4', 'visor'], ['#7fd6ff', 'ice'], ['#9b7bff', 'glow']];
          S.sw = pal.map(function (p, k) {
            var g = ctx.group({ parent: S.bibB });
            ctx.rect(bx + 18 + k * 58, by + 186, 46, 30, { rx: 4, fill: p[0], parent: g });
            ctx.text(bx + 41 + k * 58, by + 232, p[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            return g;
          });
          ctx.text(bx + 330, by + 196, 'refs: 3 sketches', { size: 12, font: 'mono', color: 'violet', parent: S.bibB });
          ctx.text(bx + 330, by + 216, '→ SigLIP emb ×3', { size: 12, font: 'mono', color: 'violet', parent: S.bibB });
          [0, 1, 2].forEach(function (k) { ctx.icon('image', bx + 478 + k * 30, by + 206, 24, 'violet', { parent: S.bibB }); });
          hide([S.bib, S.bibB]);
          /* context bars */
          S.ctxG = ctx.group();
          panel(ctx, 36, 160, 590, 262, 'magenta', S.ctxG);
          head(ctx, 56, 184, 'SHOT-WORKER CONTEXTS · SHARED PREFIX', 'magenta', S.ctxG);
          var x0 = 110, pw = 330, sw = 46;
          S.pre = []; S.suf = []; S.tags = [];
          for (var i = 0; i < 6; i++) {
            var y = 212 + i * 32;
            ctx.text(56, y, 'S' + (i + 1), { size: 13, font: 'mono', color: 'text', parent: S.ctxG });
            var p = ctx.rect(x0, y - 10, 0, 20, { rx: 3, fill: ctx.alpha('teal', 0.45), stroke: 'teal', sw: 1, parent: S.ctxG });
            var s = ctx.rect(x0 + pw + 2, y - 10, 0, 20, { rx: 3, fill: ctx.alpha('magenta', 0.45), stroke: 'magenta', sw: 1, parent: S.ctxG });
            var tg = ctx.label(x0 + pw + sw + 44, y, i === 0 ? 'WRITE' : 'HIT', { color: i === 0 ? 'amber' : 'lime', size: 11, w: 58, parent: S.ctxG });
            tg.setAttribute('opacity', 0);
            S.pre.push(p); S.suf.push(s); S.tags.push(tg);
          }
          ctx.text(x0 + pw / 2, 406, 'bible prefix 3.1k tok', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.ctxG });
          ctx.text(x0 + pw + 26, 406, 'brief 0.4k', { size: 11, font: 'mono', color: 'magenta', anchor: 'middle', parent: S.ctxG });
          hide(S.ctxG);
          /* beat 0: the bible text */
          ctx.pulse(S.ag[1], { color: 'magenta', dur: 500 });
          return ctx.reveal(S.bib, { from: 'right', dur: 500 }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: palette + reference embeddings */
            return Promise.all([ctx.reveal(S.bibB, { dur: 350 }), ctx.reveal(S.sw, { from: 'scale', delay: 200, stagger: 90 })]).then(function () {
              return ctx.pulse(S.bibB, { color: 'violet', dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: identical prefix in every worker context */
            return ctx.reveal(S.ctxG, { from: 'left', dur: 500 }).then(function () {
              var ps = [];
              for (var k = 0; k < 6; k++) {
                (function (k) {
                  var path = ctx.path('M990,' + (by + 240) + ' L' + (x0 + pw) + ',' + (212 + k * 32), { parent: S.ctxG });
                  ps.push(ctx.wait(k * 220).then(function () {
                    return ctx.packet(path, { color: 'teal', r: 4, dur: 650 });
                  }).then(function () {
                    return ctx.animate(S.pre[k], { width: [0, pw] }, 450, 'out');
                  }));
                })(k);
              }
              return Promise.all(ps);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: first request writes the cache, the rest hit it */
            var ps = S.suf.map(function (s, k) { return ctx.animate(s, { width: [0, sw] }, 300, 'out', k * 90); });
            return Promise.all(ps).then(function () {
              return ctx.fade(S.tags[0], 1, 300);
            }).then(function () {
              ctx.hud('prefix cost 1.75P vs 6P  (−71%)');
              return Promise.all(S.tags.slice(1).map(function (t, k) { return ctx.wait(k * 140).then(function () { return ctx.fade(t, 1, 250); }); }));
            });
          });
        }
      },
      /* 5 ------------------------------------------------------------------ */
      {
        title: 'Parallel fan-out',
        beats: [
          {
            say: 'Now the director fans out. Six shot workers start at once, each with a fresh context that holds only the bible and its own shot brief.',
            card: { tag: 'KEY IDEA', title: 'A fresh context per worker', body: 'Each worker sees about 3.5k tokens: the bible plus its own brief, not the history of the other five shots.' },
            deep: '<p>Fan-out / fan-in with a concurrency cap derived from the GPU quota:</p>' +
              '<pre>async def film(board, bible_ref):\n  sem = Semaphore(gpu_quota // 8)\n  async def shoot(s):  # 8 GPUs/shot\n    async with sem:\n      return await spawn(\n        "cinematographer",\n        brief=s, prefix=bible_ref,\n        budget=Budget(40e3, redo=2))\n  return await gather(\n    *[shoot(s) for s in board.shots])</pre>' +
              '<p><b>Fresh context</b> per worker (about 3.5k tokens) instead of one agent carrying all six shots’ history.</p>'
          },
          {
            say: 'Each worker calls the video model, and six renders proceed in parallel on the GPU pool, each finishing at its own pace.',
            card: { tag: 'NUMBERS', title: 'Six renders in flight', stat: { v: '6 × 8', u: 'GPUs', l: 'six shot renders at once, each gang-scheduled on an 8-GPU node' } },
            deep: '<p>Every spawn is a <b>durable activity</b> on the GPU queue (see the durable-execution chamber): a crashed worker is retried without re-running the other five.</p>' +
              '<ul><li>The semaphore is sized from the GPU quota: <code>gpu_quota // 8</code> shots may hold a gang at once; the rest wait in the queue.</li>' +
              '<li>Workers return <i>references + a short report</i>, never transcripts, so the director’s context grows by only about 150 tokens per shot.</li></ul>'
          },
          {
            say: 'The director simply awaits all of them, a join barrier. The slowest shot decides when the batch is done.',
            card: { tag: 'PITFALL', title: 'Stragglers set the pace', body: 'The join waits for the <b>slowest</b> of six. Tail latency of the video pool matters more than its mean.' },
            deep: '<ul><li><b>Stragglers</b> set the makespan: the expected maximum of <i>n</i> draws grows with <i>n</i>, so p99 render time matters more than the average.</li>' +
              '<li>Mitigations: hedge a slow shot on a spare gang after a timeout, cap denoising steps with a quality-aware deadline, and keep a warm-standby pool.</li>' +
              '<li>The join is a barrier in the workflow, not a polling loop: it holds no worker while it waits.</li></ul>'
          },
          {
            say: 'Run one after another, the six shots would take nearly ten minutes of wall clock. In parallel, the batch finishes when the slowest shot does, in under two minutes.',
            card: { tag: 'NUMBERS', title: 'Serial versus parallel', stat: { v: '5.6×', l: 'faster: a 101 s makespan instead of 570 s in series' },
              more: '<p>For <i>n</i> independent shot times with mean μ and spread σ, the expected makespan grows like μ + σ·√(2 ln <i>n</i>) at most (for <i>n</i> = 6 the exact normal value is μ + 1.27σ). Doubling the number of shots adds only a little latency, but every extra shot adds a full share of GPU cost.</p>' },
            deep: '<div class="eq">T<sub>serial</sub> = Σ<sub>i</sub> T<sub>i</sub> = 570 s &nbsp;&nbsp; T<sub>par</sub> = max<sub>i</sub> T<sub>i</sub> + ε ≈ 101 s &nbsp;⇒ 5.6×</div>' +
              '<p>The speedup is below 6× because the batch is bound by its slowest member: 570 / 6 = 95 s would be perfect balance, 101 s is what the straggler costs. GPU-seconds are identical either way (6 × 8 GPUs × 95 s ≈ 76 GPU-minutes); parallelism buys latency, not cost.</p>'
          },
          {
            say: 'Now try it yourself. Click any shot lane to make that render forty seconds slower, and watch the whole batch wait for it.',
            card: { tag: 'TRY IT', title: 'Click a lane to slow a shot', body: 'Slow any one shot by 40 s and the batch waits: <b>+27 to +40 s</b> of latency for only <b>+7%</b> GPU cost. Click again to undo.' },
            deep: '<p>One straggler of Δ seconds moves the makespan to max<sub>i</sub>(T<sub>i</sub> + Δ·1[i slow]) but adds only 8·Δ GPU-seconds. With Δ = 40 s: +320 GPU-s on a 4,560 GPU-s job (+7%), while the makespan rises from 101 s to between 128 s and 141 s.</p>' +
              '<p>Real stragglers come from thermal throttling, a slow NVLink, a noisy neighbour or a long-tail prompt. Production pools hedge: after a timeout, launch a duplicate on a spare gang and keep whichever finishes first, paying for one extra shot in exchange for a bounded tail.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.bib, 400); ctx.remove(S.ctxG, 400);
          ctx.fade(S.crew, 0, 500);
          S.fan = ctx.group();
          S.fDir = ctx.node({ x: 150, y: 450, w: 200, h: 76, title: 'Director', sub: 'fan-out · join', icon: 'agent', color: 'magenta', parent: S.fan });
          S.join = ctx.node({ x: 1440, y: 440, w: 200, h: 72, title: 'join()', sub: 'barrier · 6 of 6', icon: 'check', color: 'magenta', parent: S.fan });
          S.wk = []; S.fl = []; S.lanes = []; S.th = []; S.jl = []; S.extra = []; S.hit = [];
          S.laneG = ctx.group({ parent: S.fan });
          var X0 = 580, LW = 560, TMAX = 150;
          [0, 30, 60, 90, 120, 150].forEach(function (t) {
            var x = X0 + LW * t / TMAX;
            ctx.line(x, 186, x, 700, { color: 'faint', sw: 1, dash: '2 6', parent: S.laneG });
            ctx.text(x, 174, t + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.laneG });
          });
          for (var i = 0; i < 6; i++) {
            var y = 215 + i * 90;
            var w = ctx.node({ x: 440, y: y, w: 200, h: 60, title: 'Shot ' + (i + 1), sub: SHOTS[i], icon: 'film', color: 'lime', titleSize: 14, subSize: 11, parent: S.fan });
            S.wk.push(w);
            S.fl.push(ctx.link(S.fDir, w, { from: 'r', to: 'l', color: ctx.alpha('magenta', 0.7), parent: S.fan }));
            ctx.rect(X0, y - 8, LW, 16, { rx: 4, fill: 'rgba(255,255,255,0.03)', stroke: 'line', sw: 1, parent: S.laneG });
            var bar = ctx.rect(X0, y - 8, 0, 16, { rx: 4, fill: ctx.alpha('lime', 0.55), stroke: 'lime', sw: 1, parent: S.laneG });
            bar.setAttribute('data-w', LW * DUR[i] / TMAX);
            var xt = ctx.rect(X0 + LW * DUR[i] / TMAX, y - 8, 0, 16, { rx: 4, fill: ctx.alpha('amber', 0.45), stroke: 'amber', sw: 1, dash: '4 3', parent: S.laneG });
            S.extra.push(xt);
            var tl = ctx.text(X0 + LW * DUR[i] / TMAX, y - 20, DUR[i] + ' s', { size: 11.5, font: 'mono', color: 'lime', anchor: 'end', parent: S.laneG, opacity: 0 });
            S.lanes.push([bar, tl]);
            S.hit.push(ctx.rect(X0 - 6, y - 31, LW + 12, 54, { rx: 8, fill: 'rgba(255,255,255,0.001)', parent: S.laneG }));
            var th = thumb(ctx, 1170, y - 28, i, S.fan, i === 2);
            if (i === 2) th.firstChild.setAttribute('stroke', ctx.alpha('lime', 0.7));   /* the drift is not obvious yet */
            th.setAttribute('opacity', 0);
            S.th.push(th);
            S.jl.push(ctx.link({ x: 1270, y: y }, S.join, { to: 'l', color: ctx.alpha('lime', 0.5), sw: 1.4, parent: S.fan }));
          }
          /* serial vs parallel comparison */
          S.cmpG = ctx.group({ parent: S.fan });
          ctx.text(X0 - 12, 752, 'one agent, serial', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.cmpG });
          ctx.text(X0 - 12, 790, 'fan-out ×6', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.cmpG });
          var CAX = 700;                                    /* comparison axis: 560 px = 700 s */
          var serW = LW * SUM / CAX, parW = LW * 101 / CAX;
          S.serBar = ctx.rect(X0, 742, 0, 20, { rx: 4, fill: ctx.alpha('red', 0.4), stroke: 'red', sw: 1, parent: S.cmpG });
          S.parBar = ctx.rect(X0, 780, 0, 20, { rx: 4, fill: ctx.alpha('lime', 0.5), stroke: 'lime', sw: 1, parent: S.cmpG });
          S.serT = ctx.text(X0 + serW + 10, 752, SUM + ' s', { size: 13, font: 'mono', color: 'red', parent: S.cmpG, opacity: 0 });
          S.parT = ctx.text(X0 + parW + 10, 790, '101 s  (' + (SUM / 101).toFixed(1) + '× faster)', { size: 13, font: 'mono', color: 'lime', parent: S.cmpG, opacity: 0 });
          S.hint = ctx.label(X0 + LW / 2, 848, 'click a lane above: +' + SLOW + ' s straggler', { color: 'amber', size: 12, parent: S.fan, opacity: 0 });
          hide([S.fDir, S.join, S.laneG, S.cmpG]); hide(S.wk); hide(S.fl); hide(S.jl);
          S.slow = [0, 0, 0, 0, 0, 0]; S.tryOn = false;
          /* TRY IT (beat 5): a click adds a straggler to that lane; makespan = max, cost = sum */
          function refreshCmp() {
            var mx = 0, sm = 0;
            for (var q = 0; q < 6; q++) { var d = DUR[q] + (S.slow[q] ? SLOW : 0); if (d > mx) mx = d; sm += d; }
            for (var q2 = 0; q2 < 6; q2++) {
              var tt = DUR[q2] + (S.slow[q2] ? SLOW : 0);
              S.lanes[q2][1].textContent = tt + ' s';
              S.lanes[q2][1].setAttribute('x', X0 + LW * tt / TMAX);
              S.lanes[q2][1].setAttribute('fill', tt === mx ? ctx.C.amber : ctx.C.lime);
            }
            var sw = LW * sm / CAX, pw = LW * mx / CAX;
            ctx.animate(S.serBar, { width: [+S.serBar.getAttribute('width'), sw] }, 350, 'out');
            ctx.animate(S.parBar, { width: [+S.parBar.getAttribute('width'), pw] }, 350, 'out');
            S.serT.textContent = sm + ' s'; S.serT.setAttribute('x', X0 + sw + 10);
            S.parT.textContent = mx + ' s  (' + (sm / mx).toFixed(1) + '× faster)'; S.parT.setAttribute('x', X0 + pw + 10);
            ctx.hud('makespan: max(Tᵢ) = ' + mx + ' s  vs  ΣTᵢ = ' + sm + ' s');
          }
          S.hit.forEach(function (h, i) {
            h.style.cursor = 'pointer';
            h.addEventListener('click', function (ev) {
              ev.stopPropagation();
              if (!S.tryOn) return;
              S.slow[i] = S.slow[i] ? 0 : 1;
              ctx.animate(S.extra[i], { width: [+S.extra[i].getAttribute('width'), S.slow[i] ? LW * SLOW / TMAX : 0] }, 350, 'out');
              refreshCmp();
              if (S.slow[i]) ctx.pulse(S.wk[i], { color: 'amber', dur: 500 });
            });
          });
          /* beat 0: fan out with a fresh context each */
          return Promise.all([
            ctx.reveal(S.fDir, { from: 'scale' }),
            ctx.reveal(S.wk, { from: 'left', delay: 200, stagger: 80 }),
            ctx.reveal(S.fl, { from: 'draw', delay: 300, stagger: 60 })
          ]).then(function () {
            return Promise.all(S.fl.map(function (l, i) { return ctx.packet(l, { color: 'magenta', dur: 700, label: i === 0 ? 'brief + bible_ref' : null }); }));
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: six renders in parallel */
            return ctx.reveal(S.laneG, { dur: 400 }).then(function () {
              return Promise.all(S.lanes.map(function (ln, i) {
                var w = +ln[0].getAttribute('data-w');
                return ctx.animate(ln[0], { width: [0, w] }, 3200 * DUR[i] / 101, 'linear').then(function () {
                  ctx.fade(ln[1], 1, 200);
                  return ctx.reveal(S.th[i], { from: 'scale', dur: 400 });
                });
              }));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the join barrier; the slowest shot decides */
            ctx.reveal(S.join, { from: 'scale' });
            ctx.pulse(S.wk[3], { color: 'amber', times: 2, dur: 600 });
            S.jl.forEach(function (l) { l.setAttribute('opacity', 0); });
            return ctx.reveal(S.jl, { from: 'draw', dur: 400, delay: 200 }).then(function () {
              return Promise.all(S.jl.map(function (l) { return ctx.packet(l, { color: 'lime', dur: 600 }); }));
            }).then(function () { return ctx.pulse(S.join, { color: 'magenta' }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: wall-clock comparison */
            return ctx.reveal(S.cmpG, { dur: 300 }).then(function () {
              ctx.animate(S.serBar, { width: [0, serW] }, 900, 'out');
              ctx.animate(S.parBar, { width: [0, parW] }, 500, 'out', 200);
              ctx.fade(S.serT, 1, 300); ctx.fade(S.parT, 1, 300);
              ctx.hud('makespan: max(Tᵢ) = 101 s  vs  ΣTᵢ = ' + SUM + ' s');
              return ctx.wait(900);
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4 (TRY IT): lanes become clickable */
            S.tryOn = true;
            S.hit.forEach(function (h) { h.setAttribute('stroke', ctx.alpha('amber', 0.35)); h.setAttribute('stroke-dasharray', '3 5'); });
            return ctx.reveal(S.hint, { from: 'up', dur: 400 }).then(function () {
              return ctx.pulse(S.hint, { color: 'amber', times: 2, dur: 600 });
            });
          });
        }
      },
      /* 6 ------------------------------------------------------------------ */
      {
        title: 'Critic & re-render',
        beats: [
          {
            say: 'When the batch joins, the critic scores every shot against a rubric: prompt adherence, character identity, motion, physics, continuity and aesthetics. Most shots sail through.',
            card: { tag: 'HOW IT WORKS', title: 'Six criteria, one gate', body: 'Each shot gets six scores from zero to one. A weighted sum, identity weighted highest at 0.30, is gated at <b>0.75</b>.' },
            deep: '<p>Weighted rubric score per shot, gated at a threshold τ:</p>' +
              '<div class="eq">s = Σ<sub>k</sub> w<sub>k</sub> r<sub>k</sub>, &nbsp; w = (.20, .30, .15, .10, .15, .10), &nbsp; pass ⇔ s ≥ τ = 0.75</div>' +
              '<ul><li><b>Motion / physics</b>: VBench-style dimensions (subject consistency, motion smoothness, dynamic degree) computed on sampled frames.</li>' +
              '<li><b>Aesthetics and adherence</b>: VLM scores against the prompt and the bible, on a fixed rubric with anchored examples.</li></ul>'
          },
          {
            say: "Shot three fails. Between three point one and three point six seconds the fox's visor flips from teal to amber and the mission patch vanishes, so identity scores only point four one and continuity point five five.",
            card: { tag: 'NUMBERS', title: 'Identity fails the shot', stat: { v: '0.41', l: 'identity score on shot 3: the weighted total is 0.66, below the 0.75 gate' },
              more: '<p>Had identity scored 0.88 like its neighbours, the total would be 0.80 and the shot would pass. Identity carries weight 0.30, the largest, because a wrong face is the failure viewers notice first, and a wrong face cannot be fixed in the edit.</p>' },
            deep: '<p>Shot 3 v1: s = 0.2·0.81 + 0.3·0.41 + 0.15·0.82 + 0.1·0.84 + 0.15·0.55 + 0.1·0.83 = <b>0.66</b> → reject.</p>' +
              '<p><b>Identity</b> mixes a metric and a judge: cosine similarity of DINOv2 or SigLIP embeddings of character crops against the sheet, plus VLM yes/no checks (“is the visor teal?”). <b>Continuity</b> asks the same kind of question against the previous shot (“is the ARGO-7 patch on the left arm?”). Binary, checkable questions are far more reliable than a single holistic grade.</p>'
          },
          {
            say: 'The critic returns structured feedback, not prose: which criteria failed, why, and what to change in the prompt and the references.',
            card: { tag: 'KEY IDEA', title: 'Feedback is data, not prose', body: 'A JSON verdict with failed criteria and a <code>fix</code> object lets the director act mechanically, with no re-interpretation of a paragraph.' },
            deep: '<ul><li><b>Judge hygiene</b>: LLM and VLM judges show position, verbosity and self-enhancement biases (Zheng et al.). Calibrate thresholds on human-labelled clips (report Spearman ρ), and use pairwise v1-versus-v2 comparison for re-renders.</li>' +
              '<li>The verdict schema is enforced with constrained decoding, so the director can parse it without a retry loop.</li>' +
              '<li>Include evidence (score plus the observed and expected attribute), so a human reviewing the escalation can audit the call.</li></ul>'
          },
          {
            say: 'The director regenerates only the failing window of shot three, with the character sheet attached as a reference, and the other five shots are never touched.',
            card: { tag: 'TRADE-OFF', title: 'Targeted redo, not a full rerun', body: 'Only one window of one shot is regenerated: about <b>5% extra GPU time</b>, instead of 100%. Budget: at most two redos per shot, then escalate to a human.' },
            deep: '<p>The redo is a new durable activity with the critic’s <code>fix</code> object merged in: the character sheet as an extra reference image, a prompt delta (<code>+teal visor +ARGO-7 patch</code>), and a new seed. The critic localised the defect to 3.1–3.6 s, so only a window of about 1.5 s around it is regenerated, with the neighbouring latent frames frozen as context: about 30 s on 8 GPUs, 240 GPU-seconds.</p>' +
              '<ul><li><b>Budget</b>: max 2 targeted re-renders per shot, then escalate to the human.</li><li>Cost: one window of one shot ≈ 5% extra GPU time (240 of 4,560 GPU-seconds), against 100% for a blind full rerun; regenerating the whole shot would cost 17%.</li></ul>'
          },
          {
            say: 'The critic re-scores version two: it passes, the shot is unlocked, and the join can finally close.',
            card: { tag: 'NUMBERS', title: 'One redo fixes it', stat: { v: '0.66 → 0.86', l: 'weighted score for shot 3 after one targeted re-render' } },
            deep: '<p>Shot 3 v2 scores <b>0.86</b> → pass (identity 0.88, continuity 0.87). Because the comparison is pairwise (v2 versus v1) as well as absolute, the critic also confirms that the fix did not regress motion or physics.</p>' +
              '<div class="note">Spend tokens on the critic and the bible: an LLM call costs cents, while a coordination error that triggers extra renders costs GPU minutes.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          S.tryOn = false;
          ctx.remove(S.laneG, 400);
          ctx.remove(S.cmpG, 400);
          S.crit = ctx.node({ x: 1440, y: 640, w: 200, h: 72, title: 'Critic', sub: 'VLM judge · rubric', icon: 'eye', color: 'violet', parent: S.fan });
          S.cl = ctx.link(S.join, S.crit, { from: 'b', to: 't', color: 'violet', parent: S.fan });
          S.rub = ctx.group({ parent: S.fan });
          var CX = 585, CW = 72, CS = 80;
          RUB.concat(['score']).forEach(function (h, c) {
            ctx.text(CX + c * CS + CW / 2, 176, h, { size: 12, font: 'mono', color: c === 6 ? 'white' : 'dim', anchor: 'middle', parent: S.rub, weight: c === 6 ? 600 : 400 });
          });
          S.cells = [];
          for (var r = 0; r < 6; r++) {
            S.cells.push([]);
            var y = 215 + r * 90;
            for (var c = 0; c < 7; c++) {
              var v = c < 6 ? SC[r][c] : total(SC[r]);
              var g = ctx.group({ parent: S.rub });
              var rc = ctx.rect(CX + c * CS, y - 20, CW, 40, { rx: 6, fill: ctx.alpha(scoreCol(ctx, v), c === 6 ? 0.28 : 0.16), stroke: ctx.alpha(scoreCol(ctx, v), 0.8), sw: c === 6 ? 1.6 : 1, parent: g });
              var tx = ctx.text(CX + c * CS + CW / 2, y + 1, v.toFixed(2), { size: c === 6 ? 15 : 14, font: 'mono', weight: c === 6 ? 700 : 400, color: scoreCol(ctx, v), anchor: 'middle', parent: g });
              g.setAttribute('opacity', 0);
              S.cells[r].push({ g: g, rc: rc, tx: tx });
            }
          }
          ctx.text(CX + 6 * CS + CW / 2, 712, 'pass ≥ 0.75', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.rub });
          S.fb = ctx.code({ x: 36, y: 724, w: 540, title: 'verdict.json · critic → director', lang: 'json', size: 12, color: 'violet', typing: true, maxLines: 6, parent: S.fan, lines: nb([
            '{"shot": 3, "verdict": "reject", "score": 0.66,',
            ' "fail": ["identity 0.41: visor amber @3.1-3.6 s",',
            '          "continuity 0.55: ARGO-7 patch missing"],',
            ' "fix": {"ref_images": ["vega_sheet_v3"],',
            '         "prompt_delta": "+teal visor +ARGO-7 patch",',
            '         "keep_seed": false}}'
          ]) });
          S.fbPath = ctx.path('M1440,676 Q1440,800 1300,800 L582,800', { stroke: ctx.alpha('violet', 0.6), sw: 1.6, dash: '5 5', arrow: true, parent: S.fan });
          hide([S.crit, S.cl, S.rub, S.fb, S.fbPath]);
          /* beat 0: critic scores the batch (shot three still pending) */
          return Promise.all([ctx.reveal(S.crit, { from: 'scale' }), ctx.reveal(S.cl, { from: 'draw', delay: 150 }), ctx.reveal(S.rub, { dur: 400 })]).then(function () {
            return ctx.packet(S.cl, { color: 'lime', dur: 500, label: '6 refs' });
          }).then(function () {
            ctx.pulse(S.crit, { color: 'violet' });
            var all = [];
            [0, 1, 3, 4, 5].forEach(function (r2, n) {
              S.cells[r2].forEach(function (cell, c2) { all.push(ctx.reveal(cell.g, { from: 'scale', dur: 280, delay: c2 * 90 + n * 40 })); });
            });
            return Promise.all(all);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: shot three fails */
            S.th[2].firstChild.setAttribute('stroke', ctx.alpha('red', 0.7));
            return Promise.all(S.cells[2].map(function (cell, c2) { return ctx.reveal(cell.g, { from: 'scale', dur: 280, delay: c2 * 110 }); })).then(function () {
              S.bad = ctx.highlight(S.cells[2][6].g, { color: 'red', pad: 5, parent: S.fan });
              S.badTh = ctx.highlight(S.th[2], { color: 'red', pad: 4, dash: '4 3', parent: S.fan });
              return ctx.pulse(S.th[2], { color: 'red', times: 2, dur: 500 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: structured feedback */
            ctx.reveal(S.fb, { from: 'up', dur: 350 });
            ctx.reveal(S.fbPath, { from: 'draw', dur: 700 });
            return ctx.packet(S.fbPath, { color: 'violet', dur: 1100, label: 'reject S3' }).then(function () { return S.fb.typeAll(); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: redo only shot three */
            return ctx.packet(S.fl[2], { color: 'magenta', dur: 700, label: 'redo S3 v2' }).then(function () {
              return ctx.pulse(S.wk[2], { color: 'lime', times: 2, dur: 600 });
            }).then(function () {
              ctx.remove(S.th[2], 300);
              ctx.remove(S.badTh, 300);
              S.th3b = thumb(ctx, 1170, 215 + 2 * 90 - 28, 2, S.fan, false);
              return ctx.reveal(S.th3b, { from: 'scale', dur: 450 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the critic re-scores v2 */
            return ctx.packet(S.jl[2], { color: 'lime', dur: 500, label: 'v2' }).then(function () {
              return ctx.packet(S.cl, { color: 'lime', dur: 400 });
            }).then(function () {
              ctx.remove(S.bad, 300);
              var row = S.cells[2];
              return Promise.all(row.map(function (cell, c2) {
                var v2 = c2 < 6 ? SC3B[c2] : total(SC3B);
                var col = scoreCol(ctx, v2);
                return ctx.wait(c2 * 90).then(function () {
                  cell.tx.textContent = v2.toFixed(2);
                  cell.tx.setAttribute('fill', col);
                  cell.rc.setAttribute('fill', ctx.alpha(col, c2 === 6 ? 0.28 : 0.16));
                  cell.rc.setAttribute('stroke', ctx.alpha(col, 0.8));
                  return ctx.pulse(cell.g, { color: col, dur: 500 });
                });
              }));
            }).then(function () {
              S.redoTag = ctx.label(1220, 350, 'S3 v2 · was 0.66 ✕', { color: 'amber', size: 11, parent: S.fan });
              ctx.hud('window re-render: 240 GPU-s (≈5% GPU)');
              return ctx.reveal(S.redoTag, { from: 'scale', dur: 350 });
            });
          });
        }
      },
      /* 7 ------------------------------------------------------------------ */
      {
        title: 'Isolation vs cost',
        beats: [
          {
            say: 'Why not one big agent? A single agent keeps one growing window: everything it ever read is re-read on every turn, and details buried in the middle of a long window get diluted.',
            card: { tag: 'PITFALL', title: 'One window, growing forever', body: 'The single agent reaches <b>143k tokens</b>; every turn re-reads all of it, and recall sags in the middle of the window.',
              more: '<p>Example: 40 turns with the context growing linearly to 143k tokens process about 40 × 72k ≈ 2.9 M prompt tokens in total. Prefix caching cuts the <i>price</i> of that re-read by up to about 90%, but the model still has to attend across all 143k tokens on every turn.</p>' },
            deep: '<p>A single thread pays <b>Σ<sub>turns</sub> |context|</b> in prompt tokens: each of the roughly 40 turns re-reads everything before it. Prefix caching cuts the price of that re-read, not the dilution.</p>' +
              '<p>Long-context models show a U-shaped recall curve, strong at both ends and weak in the middle (“lost in the middle”, Liu et al., 2024), so early details such as the bible are the first to be neglected. It also serializes wall-clock: total time is the sum of all turns.</p>'
          },
          {
            say: 'Isolation is the win: each sub-agent gets a fresh, focused context, works in parallel, and returns a compressed result to a small lead.',
            card: { tag: 'KEY IDEA', title: 'Isolate, then compress', body: 'Each sub-agent burns about 28k tokens of its own, then hands back a 1.5k summary. The lead only ever sees summaries.' },
            deep: '<p>Anthropic’s research system uses sub-agents as <b>intelligent filters</b>: each explores a slice of the problem in its own window and returns only what matters. Here the lead uses 22k tokens and six sub-agents use 28k each, about 190k in total.</p>' +
              '<div class="eq">wall-clock ≈ max<sub>i</sub>(sub<sub>i</sub>) &nbsp;vs&nbsp; Σ<sub>turns</sub> t</div>' +
              '<p>The total is higher than the single agent’s 143k, but it is spent in parallel, in clean windows.</p>'
          },
          {
            say: 'But it is not free. Anthropic reported that agents use about four times the tokens of a chat, and multi-agent systems about fifteen times.',
            card: { tag: 'NUMBERS', title: 'Coordination costs tokens', stat: { v: '≈ 15×', l: 'tokens of a chat for a multi-agent system (single agent ≈ 4×)' } },
            deep: '<p><b>Evidence (Anthropic, 2025)</b>: a lead agent (Claude Opus 4) with Sonnet 4 sub-agents beat single-agent Opus 4 by <b>90.2%</b> on an internal research eval. Token usage alone explained about 80% of performance variance on BrowseComp; with tool-call count and model choice, about 95%.</p>' +
              '<div class="eq">Cost ≈ Σ<sub>agents</sub>(in·p<sub>in</sub> + out·p<sub>out</sub>) + Σ<sub>shots</sub> GPU·s · p<sub>gpu</sub> · (1 + redo rate)</div>'
          },
          {
            say: 'Context is lost at hand-off boundaries, and coordination itself fails in characteristic ways: agents ignore each other, withhold information, or stop before verifying.',
            card: { tag: 'PITFALL', title: 'Coordination fails in 14 ways', body: 'MAST groups failures into specification, inter-agent misalignment and verification, from <b>1,600+ annotated traces</b> of open-source frameworks.' },
            deep: '<p><b>MAST</b> (Cemri et al., 2025): 14 failure modes in 3 groups, derived from expert-annotated traces of popular open-source multi-agent frameworks.</p>' +
              '<ul><li><i>Specification &amp; system design</i>: disobey task spec, disobey role spec, step repetition, loss of history, unaware of termination.</li>' +
              '<li><i>Inter-agent misalignment</i>: conversation reset, fail to ask for clarification, task derailment, information withholding, ignored input, reasoning–action mismatch.</li>' +
              '<li><i>Task verification</i>: premature termination, no or incomplete verification, incorrect verification.</li></ul>'
          },
          {
            say: 'So use many agents for broad, parallel, read-heavy work, and a single thread for tightly coupled decisions.',
            card: { tag: 'TRADE-OFF', title: 'Breadth versus coherence', body: 'Parallel, read-heavy research favors many agents. Tightly coupled, write-heavy work, like one shot\'s lighting and camera, wants a single decision-maker.' },
            deep: '<p><b>Counter-evidence (Cognition, 2025)</b>: “actions carry implicit decisions”. Parallel sub-agents that cannot see each other’s traces make conflicting choices (two shots lit differently). Principle: share full context, or keep the task single-threaded.</p>' +
              '<div class="note">In video, the LLM overhead is usually small next to GPU cost (about 212k tokens ≈ $0.6 versus about 76 GPU-minutes ≈ $3.2, at the illustrative prices used across the atlas: LLM input $3 and output $15 per million tokens, GPU $2.5 per H100-hour). The expensive failure is a coordination error that triggers extra renders, so spend tokens on the critic and the bible.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.fan, 450);
          S.cost = ctx.group();
          var G = S.cost;
          /* single agent */
          var top = ctx.group({ parent: G });
          panel(ctx, 36, 165, 740, 300, 'amber', top);
          head(ctx, 56, 190, 'SINGLE AGENT · one growing window', 'amber', top);
          var segs = [['script', 15], ['board', 14], ['S1', 12], ['S2', 12], ['S3', 12], ['S4', 12], ['S5', 12], ['S6', 12], ['critic', 30], ['edit', 12]];
          var sc = 690 / 143, x = 56;
          S.segs = segs.map(function (s, k) {
            var w = s[1] * sc;
            var r = ctx.rect(x, 222, w - 1.5, 38, { rx: 3, fill: ctx.alpha(k % 2 ? 'amber' : 'orange', 0.35 + 0.03 * (k % 3)), stroke: ctx.alpha('amber', 0.8), sw: 1, parent: top });
            ctx.text(x + w / 2, 241, s[0], { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: top });
            r.setAttribute('opacity', 0);
            x += w;
            return r;
          });
          ctx.text(56, 290, '143k tokens in one context · every turn re-reads all of it', { size: 13, color: 'text', parent: top });
          ctx.text(56, 314, 'serial wall-clock · early details diluted (“lost in the middle”)', { size: 13, color: 'text', parent: top });
          for (var q = 0; q < 30; q++) {
            var u = (q + 0.5) / 30, rec = 0.18 + 0.8 * Math.pow(2 * u - 1, 2);
            ctx.rect(56 + q * 23, 334, 21, 12, { rx: 2, fill: ctx.alpha('amber', rec), parent: top });
          }
          ctx.text(56, 362, 'attention recall across the window: strong at the ends, weak in the middle', { size: 11, font: 'mono', color: 'dim', parent: top });
          ctx.text(56, 400, 'wall-clock ≈ Σ turns', { size: 14, font: 'mono', color: 'amber', parent: top });
          ctx.text(56, 430, 'one decision-maker → coherent choices', { size: 13, color: '#a9f58a', parent: top });
          /* multi agent */
          var mt = ctx.group({ parent: G });
          panel(ctx, 824, 165, 740, 300, 'magenta', mt);
          head(ctx, 844, 190, 'LEAD + 6 SUB-AGENTS · isolated windows', 'magenta', mt);
          S.lead = ctx.rect(844, 222, 22 * sc, 30, { rx: 3, fill: ctx.alpha('magenta', 0.45), stroke: 'magenta', sw: 1, parent: mt });
          ctx.text(844 + 22 * sc + 8, 237, 'lead 22k', { size: 12, font: 'mono', color: 'magenta', parent: mt });
          S.subs = [];
          for (var i = 0; i < 6; i++) {
            var yy = 272 + i * 26;
            ctx.text(844, yy + 9, 'sub ' + (i + 1), { size: 11, font: 'mono', color: 'dim', parent: mt });
            var b = ctx.rect(900, yy, 0, 18, { rx: 3, fill: ctx.alpha('lime', 0.35), stroke: ctx.alpha('lime', 0.8), sw: 1, parent: mt });
            b.setAttribute('data-w', 28 * sc);
            S.subs.push(b);
            ctx.text(900 + 28 * sc + 8, yy + 9, '28k → 1.5k summary', { size: 11, font: 'mono', color: 'teal', parent: mt });
          }
          ctx.text(1210, 237, 'total ≈ 190k tokens', { size: 13, font: 'mono', color: 'text', parent: mt });
          ctx.text(1210, 300, 'wall-clock ≈ max(subs)', { size: 14, font: 'mono', color: 'magenta', parent: mt });
          ctx.text(1210, 330, '+ fresh, focused windows', { size: 13, color: '#a9f58a', parent: mt });
          ctx.text(1210, 356, '− context lost at hand-offs', { size: 13, color: '#ff9aad', parent: mt });
          ctx.text(1210, 382, '− implicit decisions conflict', { size: 13, color: '#ff9aad', parent: mt });
          ctx.text(844, 440, 'each sub-agent re-reads bible + tools; lead sees only summaries', { size: 12, font: 'mono', color: 'dim', parent: mt });
          hide([top, mt]);
          /* token multiplier chart */
          var ch = ctx.group({ parent: G });
          panel(ctx, 36, 490, 740, 390, 'cyan', ch);
          head(ctx, 56, 515, 'TOKENS RELATIVE TO A CHAT (Anthropic, 2025)', 'cyan', ch);
          var vals = [['chat', 1, 'cyan'], ['single agent', 4, 'amber'], ['multi-agent', 15, 'magenta']];
          S.mult = vals.map(function (v, k) {
            var bx = 120 + k * 210, h = 250 * v[1] / 15;
            ctx.text(bx + 50, 850, v[0], { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: ch });
            var r = ctx.rect(bx, 830 - h, 100, h, { rx: 4, fill: ctx.alpha(v[2], 0.45), stroke: v[2], sw: 1.2, parent: ch });
            r.setAttribute('data-h', h);
            var t = ctx.text(bx + 50, 830 - h - 16, '≈' + v[1] + '×', { size: 18, font: 'display', weight: 700, color: v[2], anchor: 'middle', parent: ch, opacity: 0 });
            return [r, t];
          });
          ctx.line(90, 830, 740, 830, { color: 'faint', parent: ch });
          ctx.text(90, 556, 'multi-agent vs single agent:', { size: 12, font: 'mono', color: 'dim', parent: ch });
          ctx.text(90, 582, '+90.2% on internal research eval', { size: 15, font: 'mono', weight: 600, color: 'lime', parent: ch });
          ctx.text(90, 608, 'token usage explains ~80% of variance', { size: 12, font: 'mono', color: 'dim', parent: ch });
          hide(ch);
          /* MAST */
          var fm = ctx.group({ parent: G });
          panel(ctx, 824, 490, 740, 390, 'pink', fm);
          head(ctx, 844, 515, 'WHY MULTI-AGENT SYSTEMS FAIL · MAST (14 modes, excerpt)', 'pink', fm);
          var cats = [['Specification & system design', ['disobey task / role spec', 'step repetition', 'loss of conversation history', 'unaware of termination']],
            ['Inter-agent misalignment', ['information withholding', "ignored other agent's input", 'task derailment', 'reasoning–action mismatch']],
            ['Task verification', ['premature termination', 'no or incomplete verification', 'incorrect verification']]];
          S.cats = cats.map(function (c, k) {
            var g = ctx.group({ parent: fm });
            var yy = 545 + k * 112;
            ctx.rect(844, yy, 700, 100, { rx: 8, fill: ctx.alpha('pink', 0.06), stroke: ctx.alpha('pink', 0.4), sw: 1, parent: g });
            ctx.text(860, yy + 20, (k + 1) + '  ' + c[0], { size: 14, weight: 600, color: 'pink', parent: g });
            c[1].forEach(function (m, j) {
              ctx.text(876 + (j % 2) * 340, yy + 48 + Math.floor(j / 2) * 24, '• ' + m, { size: 13, color: 'text', parent: g });
            });
            return g;
          });
          hide(fm); hide(S.cats);
          /* decision rule overlay (beat 4) */
          S.rule = ctx.group();
          ctx.rect(250, 230, 1100, 440, { rx: 16, fill: 'rgba(5,10,22,0.97)', stroke: ctx.alpha('cyan', 0.6), sw: 1.4, parent: S.rule, glow: true });
          ctx.text(800, 268, 'WHEN TO ADD AGENTS', { size: 17, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: S.rule, spacing: 1.5 });
          ctx.text(290, 318, 'MANY AGENTS WHEN…', { size: 14, font: 'mono', weight: 600, color: 'lime', parent: S.rule, spacing: 1.2 });
          ctx.text(840, 318, 'ONE THREAD WHEN…', { size: 14, font: 'mono', weight: 600, color: 'amber', parent: S.rule, spacing: 1.2 });
          ['the work is broad and parallelizable', 'reads dominate writes (research, critique)', 'one window cannot hold it all', 'an independent check adds value'].forEach(function (t, k) {
            ctx.text(290, 360 + k * 40, '+  ' + t, { size: 15, color: '#a9f58a', parent: S.rule });
          });
          ['decisions are tightly coupled', 'every step writes shared state', 'the task fits in one window', 'hand-off latency would dominate'].forEach(function (t, k) {
            ctx.text(840, 360 + k * 40, '•  ' + t, { size: 15, color: '#ffd28a', parent: S.rule });
          });
          ctx.line(290, 540, 1310, 540, { color: 'line', sw: 1, parent: S.rule });
          ctx.text(800, 580, 'In the trailer: fan out shots, research and critique;', { size: 15, color: 'white', anchor: 'middle', parent: S.rule });
          ctx.text(800, 610, 'keep one director for the plan and one editor for the cut.', { size: 15, color: 'white', anchor: 'middle', parent: S.rule });
          ctx.text(800, 646, 'add an agent only if it buys parallelism, isolation or an independent check', { size: 12.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.rule });
          hide(S.rule);
          /* beat 0: the single agent's growing window */
          return ctx.reveal(top, { from: 'up', dur: 450 }).then(function () {
            var chain = Promise.resolve();
            S.segs.forEach(function (r) { chain = chain.then(function () { return ctx.fade(r, 1, 140); }); });
            return chain;
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: isolated sub-agents */
            return ctx.reveal(mt, { from: 'up', dur: 450 }).then(function () {
              return Promise.all(S.subs.map(function (b2, k) { return ctx.animate(b2, { width: [0, +b2.getAttribute('data-w')] }, 700, 'out', k * 90); }));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the token multiplier */
            return ctx.reveal(ch, { dur: 450 }).then(function () {
              ctx.hud('multi-agent ≈ 15× chat tokens');
              return Promise.all(S.mult.map(function (m, k) {
                var h = +m[0].getAttribute('data-h');
                return ctx.animate(m[0], { height: [0, h], y: [830, 830 - h] }, 700, 'out', k * 250).then(function () { return ctx.fade(m[1], 1, 250); });
              }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: failure modes */
            return ctx.reveal(fm, { dur: 450 }).then(function () {
              return ctx.reveal(S.cats, { from: 'left', stagger: 250, dur: 500 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the decision rule */
            ctx.hud('');
            ctx.fade(S.cost, 0.15, 450);
            return ctx.reveal(S.rule, { from: 'scale', s0: 0.94, dur: 550 });
          });
        }
      },
      /* 8 ------------------------------------------------------------------ */
      {
        title: 'A2A protocol',
        beats: [
          {
            say: 'Sometimes a crew member lives in another company. The Agent to Agent protocol, A2A, lets our director hire an external foley studio agent without seeing its internals.',
            card: { tag: 'STATE OF THE ART', title: 'An open standard for agents', body: 'Launched by Google in April 2025, hosted by the Linux Foundation. v0.3 added gRPC and signed cards; v1.0 (March 2026) is the first stable spec. The studio stays <b>opaque</b>: only tasks, messages and artifacts cross.' },
            deep: '<p><b>A2A</b> (Google, April 2025; donated to the Linux Foundation in June 2025 and, since August 2026, hosted in its Agentic AI Foundation alongside MCP). Spec v0.3 added gRPC and signed agent cards. Transport: JSON-RPC 2.0 over HTTPS, SSE for streaming, webhooks for push notifications.</p>' +
              '<p><span class="muted">The wire names on the stage follow v0.3. The first stable spec, v1.0 (March 2026), renames the methods (<code>SendMessage</code>, <code>SendStreamingMessage</code>), merges the part types into one <code>Part</code> and drops the <code>final</code> flag.</span></p>' +
              '<div class="note">The remote agent never sees our bible or tools: pass it a <code>FilePart</code> URI to the locked cut and a <code>DataPart</code> with BPM and mood constraints.</div>'
          },
          {
            say: "First the director fetches the studio's agent card, a public document listing its skills, its input and output types, and its authentication schemes.",
            card: { tag: 'HOW IT WORKS', title: 'Discovery by agent card', body: 'A JSON card at <code>/.well-known/agent-card.json</code> declares skills, MIME modes, streaming support and security schemes.' },
            deep: '<ul><li><b>Agent Card</b> at <code>/.well-known/agent-card.json</code>: name, url, <code>capabilities</code> (streaming, pushNotifications), <code>securitySchemes</code> (OAuth2, API key, mTLS), and <code>skills[]</code> with input and output MIME modes.</li>' +
              '<li>Version 0.3 allows <b>signed</b> cards, so a client can verify who published the capabilities it is about to trust.</li>' +
              '<li>The card is the only thing the client needs to know in advance: no shared code, no shared schema registry.</li></ul>'
          },
          {
            say: 'It then sends a message that creates a task, and the studio streams status updates back over server sent events.',
            card: { tag: 'HOW IT WORKS', title: 'A task with a lifecycle', body: '<code>message/stream</code> creates a task with an id; SSE events report state changes and artifacts while the work runs.' },
            deep: '<ul><li><b>Methods</b>: <code>message/send</code>, <code>message/stream</code>, <code>tasks/get</code>, <code>tasks/cancel</code>, <code>tasks/resubscribe</code>, <code>tasks/pushNotificationConfig/set</code>.</li>' +
              '<li><b>Task states</b>: submitted, working, input-required, auth-required, completed, canceled, failed, rejected (plus unknown).</li>' +
              '<li><b>Message</b> = role + <code>parts[]</code>: TextPart, FilePart (uri or bytes + mimeType) or DataPart (JSON).</li></ul>'
          },
          {
            say: 'When the studio needs a decision, the task becomes input required, and the director answers with a follow-up message on the same task.',
            card: { tag: 'KEY IDEA', title: 'Interrupted, not failed', body: '<b>input-required</b> pauses the task, and servers typically end the stream; the reply carries the same <code>taskId</code> and <code>contextId</code>.' },
            deep: '<p><i>input-required</i> is an <b>interrupted</b> state, not a terminal one. Servers typically mark that status event <code>final: true</code>, meaning the last event of this stream, so the SSE stream closes; the client answers with a new message carrying the same <code>taskId</code> (and <code>contextId</code>). The task then returns to <i>working</i>.</p>' +
              '<p>This is what makes multi-turn negotiation with an opaque agent possible without sharing any internal state.</p>'
          },
          {
            say: 'Finally the score arrives as an artifact and the task completes. MCP connects agents to tools. A2A connects agents to agents.',
            card: { tag: 'KEY IDEA', title: 'Tools versus peers', body: '<b>MCP</b>: schema-typed calls to tools and data. <b>A2A</b>: long-running tasks between opaque agents. They compose: an A2A agent uses MCP inside.' },
            deep: '<p>Results come back as <b>Artifacts</b> via <code>TaskArtifactUpdateEvent</code>; the final status event carries <code>final: true</code>.</p>' +
              '<table><tr><th></th><th>MCP</th><th>A2A</th></tr><tr><td>Peer</td><td>tool / resource server</td><td>opaque agent</td></tr><tr><td>Unit</td><td>tool call (JSON-Schema)</td><td>long-running task</td></tr><tr><td>State</td><td>mostly request/response (long-running Tasks were experimental in the 2025-11 spec and are an official extension since 2026-07)</td><td>task + contextId, multi-turn</td></tr></table>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.cost, 450);
          ctx.remove(S.rule, 450);
          S.a2a = ctx.group();
          var G = S.a2a, XA = 200, XB = 900;
          S.hA = ctx.node({ x: XA, y: 205, w: 250, h: 64, title: 'Director', sub: 'A2A client', icon: 'agent', color: 'magenta', parent: G });
          S.hB = ctx.node({ x: XB, y: 205, w: 270, h: 64, title: 'Foley Studio', sub: 'remote agent · vendor', icon: 'music', color: 'orange', parent: G });
          var llA = ctx.path('M' + XA + ',240 L' + XA + ',690', { stroke: ctx.alpha('magenta', 0.5), sw: 1.4, dash: '4 6', parent: G });
          var llB = ctx.path('M' + XB + ',240 L' + XB + ',690', { stroke: ctx.alpha('orange', 0.5), sw: 1.4, dash: '4 6', parent: G });
          var msgs = [
            [270, 1, 'GET /.well-known/agent-card.json', 'cyan', null],
            [310, -1, 'AgentCard · skills · securitySchemes', 'cyan', null],
            [360, 1, 'message/stream  parts: text + file(uri: cut_v3.mp4)', 'magenta', 0],
            [405, -1, 'SSE  Task t-91 · state: working', 'magenta', 1],
            [450, -1, 'SSE  status: input-required  "synth or orchestral?"', 'amber', 2],
            [500, 1, 'message/stream  taskId t-91  "synth, 90 bpm"', 'magenta', 1],
            [550, -1, 'SSE  artifact-update: score.wav (FilePart uri)', 'orange', 1],
            [595, -1, 'SSE  status: completed  final=true', 'lime', 3]
          ];
          S.msg = msgs.map(function (m) {
            var x1 = m[1] > 0 ? XA + 6 : XB - 6, x2 = m[1] > 0 ? XB - 8 : XA + 8;
            var p = ctx.path('M' + x1 + ',' + m[0] + ' L' + x2 + ',' + m[0], { stroke: m[3], sw: 1.6, arrow: true, parent: G });
            p.setAttribute('opacity', 0);
            var t = ctx.text((XA + XB) / 2, m[0] - 12, m[2], { size: 13.5, font: 'mono', color: m[3], anchor: 'middle', parent: G, opacity: 0 });
            return { p: p, t: t, st: m[4], dir: m[1], col: m[3] };
          });
          S.cmp = ctx.group({ parent: G });
          ctx.text(XA, 720, 'MCP · agent → tool: schema-typed, synchronous call', { size: 13, font: 'mono', color: 'amber', parent: S.cmp, anchor: 'start' });
          ctx.text(XA, 748, 'A2A · agent → agent: opaque peer, long-running task + artifacts', { size: 13, font: 'mono', color: 'magenta', parent: S.cmp });
          ctx.text(XA, 776, 'JSON-RPC 2.0 over HTTPS · SSE streaming · push webhooks · gRPC (v0.3)', { size: 12, font: 'mono', color: 'dim', parent: S.cmp });
          /* agent card */
          S.card = ctx.code({ x: 1080, y: 160, w: 484, title: 'agent-card.json', lang: 'json', size: 12, color: 'orange', maxLines: 11, parent: G, lines: nb([
            '{"name": "foley-studio",',
            ' "url": "https://foley.example/a2a",',
            ' "protocolVersion": "0.3.0",',
            ' "capabilities": {"streaming": true,',
            '                  "pushNotifications": true},',
            ' "securitySchemes": {"oauth2": {...}},',
            ' "skills": [{"id": "score_to_picture",',
            '   "inputModes": ["video/mp4",',
            '                  "text/plain"],',
            '   "outputModes": ["audio/wav"]}]}'
          ]) });
          /* state machine */
          S.sm = ctx.group({ parent: G });
          panel(ctx, 1080, 490, 484, 300, 'magenta', S.sm);
          head(ctx, 1100, 514, 'TASK LIFECYCLE', 'magenta', S.sm);
          var st = [['submitted', 1160, 575, 'cyan'], ['working', 1322, 575, 'magenta'], ['input-required', 1484, 575, 'amber'], ['completed', 1160, 690, 'lime'], ['failed', 1322, 690, 'red'], ['canceled', 1484, 690, 'dim']];
          S.stN = st.map(function (s) { return ctx.node({ x: s[1], y: s[2], w: 130, h: 40, kind: 'pill', title: s[0], color: s[3], titleSize: 13, glow: false, parent: S.sm }); });
          var e = function (a, b, o) { return ctx.link(S.stN[a], S.stN[b], Object.assign({ color: ctx.alpha('#e8f1ff', 0.4), sw: 1.2, parent: S.sm }, o || {})); };
          e(0, 1, { straight: true }); e(1, 2, { straight: true }); e(2, 1, { from: 't', to: 't', bend: { x: 1403, y: 518 } });
          e(1, 3, { from: 'b', to: 't' }); e(1, 4, { from: 'b', to: 't' }); e(1, 5, { from: 'b', to: 't' });
          ctx.text(1322, 760, 'also: auth-required · rejected', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.sm });
          S.cur = ctx.rect(0, 0, 146, 48, { rx: 24, stroke: 'white', sw: 2.4, parent: S.sm, glow: true, opacity: 0 });
          hide([S.hA, S.hB, llA, llB, S.cmp, S.card, S.sm]);
          function mark(k) {
            if (k === null || k === undefined) return Promise.resolve();
            var b = S.stN[k].box;
            S.cur.setAttribute('x', b.x - 4); S.cur.setAttribute('y', b.y - 4);
            S.cur.setAttribute('opacity', 1);
            return ctx.pulse(S.stN[k], { color: st[k][3], dur: 500 });
          }
          function play(k) {
            var m = S.msg[k];
            m.p.setAttribute('opacity', 1);
            ctx.fade(m.t, 1, 200);
            if (k === 1) ctx.reveal(S.card, { from: 'right', dur: 500 });
            return ctx.reveal(m.p, { from: 'draw', dur: 350 }).then(function () {
              return ctx.packet(m.p, { color: m.col, r: 4, dur: 450 });
            }).then(function () { return mark(m.st); });
          }
          /* beat 0: two parties, opaque to each other */
          return Promise.all([ctx.reveal([S.hA, S.hB], { from: 'down', stagger: 150 }), ctx.reveal([llA, llB], { from: 'draw', delay: 300 })]).then(function () {
            return ctx.pulse(S.hB, { color: 'orange', times: 2, dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: discovery */
            return play(0).then(function () { return play(1); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: create a task, stream status */
            ctx.reveal(S.sm, { from: 'right', dur: 500 });
            return play(2).then(function () { return play(3); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: input-required and reply */
            return play(4).then(function () { return play(5); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: artifact, completion, MCP vs A2A */
            ctx.reveal(S.cmp, { from: 'up', dur: 500 });
            return play(6).then(function () { return play(7); });
          });
        }
      },
      /* 9 ------------------------------------------------------------------ */
      {
        title: 'Design rules',
        beats: [
          {
            say: 'Here is the crew again, with what we learned attached. The director plans, budgets and joins, and the specialists run in parallel with fresh contexts.',
            card: { tag: 'KEY IDEA', title: 'Parallelize reads, serialize writes', body: 'Shots, research and critique fan out. One director owns the plan, one editor owns the cut.' },
            deep: '<p><b>Checklist for a production multi-agent media pipeline</b></p>' +
              '<ol><li><b>Parallelize reads, serialize writes.</b> Shots, research and critique fan out; one editor owns the cut, one director owns the plan.</li>' +
              '<li><b>Typed contracts.</b> Each hand-off is a JSON-Schema object (brief, verdict, artifact_ref), validated at the boundary, often with constrained decoding.</li></ol>'
          },
          {
            say: 'Everything they make lands in the store and travels by reference, and one bible keeps the fox looking like the same fox in every shot.',
            card: { tag: 'HOW IT WORKS', title: 'References plus one bible', body: 'URIs, hashes and summaries in context; bytes in the store. One byte-stable bible gives consistency <b>and</b> cache hits.' },
            deep: '<ol start="3"><li><b>Reference, don’t embed.</b> URIs + hashes + summaries in context; bytes in the store. A roughly 100-token <code>artifact_ref</code> stands in for a clip that would cost at least about 3 M tokens as base64.</li>' +
              '<li><b>One bible, byte-stable prefix.</b> Consistency and prompt-cache hits come from the same design decision: six workers share one 3.1k-token prefix and pay 1.75 P instead of 6 P. Every edit is a new version (<code>bible/v4</code>), never an in-place change, so caches and audit trails stay valid.</li></ol>'
          },
          {
            say: 'The critic gates every clip, so only failures are re-rendered, and every agent runs under a budget that the supervisor enforces.',
            card: { tag: 'WHY IT MATTERS', title: 'Gate and budget', body: 'A calibrated critic turns a full rerun into <b>one targeted redo</b>. Per-agent token caps and GPU-second budgets keep the crew from running away.' },
            deep: '<ol start="5"><li><b>Calibrated critic with a budget.</b> Rubric + metrics, threshold tuned on human labels, at most 2 redos and then escalate. One targeted redo of the failing window costs about 5% extra GPU time (a whole-shot redo 17%); a blind rerun costs 100%. Production critics also keep a hard floor per dimension (identity ≥ 0.75), because a weighted average can hide a flicker behind good composition.</li>' +
              '<li><b>Budgets everywhere.</b> Per-agent token caps, per-job GPU-seconds, wall-clock deadlines; the supervisor enforces them, and a breached budget is an event the director must handle, not an exception that vanishes.</li></ol>'
          },
          {
            say: 'And when a crew member lives outside, A2A gives it a clean contract. Next door in the orchestration plane, durable execution makes this whole graph survive crashes.',
            card: { tag: 'KEY IDEA', title: 'Add an agent only for a reason', body: 'Buy parallelism, isolation of a noisy context, or an independent check. Otherwise it is one more hop that can lose information.' },
            deep: '<ol start="7"><li><b>Trace everything.</b> One span per agent turn and tool call (OpenTelemetry GenAI semantic conventions, still marked Development), so cost and failure modes are attributable.</li></ol>' +
              '<div class="note">Rule of thumb: add an agent only when it buys parallelism, isolation of a noisy context, or an independent check. Otherwise, it is just another hop that can lose information.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.a2a, 450);
          ctx.fade(S.crew, 1, 600);
          S.agG.forEach(function (g, i) { ctx.fade([g, S.dl[i], S.sl[i]], 1, 400); });
          ctx.fade(S.caption, 0, 300);
          S.ann = ctx.group();
          var notes = [
            [800, 172, 'plan · budget · join', 'magenta'],
            [540, 384, '6× parallel · fresh ctx', 'lime'],
            [1320, 384, 'rubric gate ≥ 0.75', 'violet'],
            [1060, 384, 'one editor owns the cut', 'cyan'],
            [1290, 705, 'URIs + hashes · bible = cached prefix', 'teal']
          ];
          S.notes = notes.map(function (n) {
            var g = ctx.group({ parent: S.ann });
            var w = n[2].length * 7.6 + 24;
            ctx.rect(n[0] - w / 2, n[1] - 13, w, 26, { rx: 13, fill: '#0b1324', stroke: n[3], sw: 1.2, parent: g });
            ctx.text(n[0], n[1] + 0.5, n[2], { size: 12.5, font: 'mono', color: n[3], anchor: 'middle', parent: g });
            hide(g);
            return g;
          });
          var rules = [];
          rules.push(ctx.text(800, 800, 'Parallelize reads (shots, research, critique) · serialize writes (one plan, one cut)', { size: 15, color: 'white', anchor: 'middle', parent: S.ann, opacity: 0 }));
          rules.push(ctx.text(800, 830, 'Pass references · share one bible · gate with a calibrated critic · budget every agent', { size: 15, color: 'white', anchor: 'middle', parent: S.ann, opacity: 0 }));
          rules.push(ctx.text(800, 862, 'external specialists via A2A (agent card → task → artifacts)', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: S.ann, opacity: 0 }));
          S.nextPill = ctx.label(1300, 862, 'NEXT · durable execution keeps this graph alive', { color: 'magenta', size: 12, parent: S.ann, opacity: 0 });
          /* beat 0: the director and the parallel specialists */
          return ctx.wait(500).then(function () {
            return Promise.all([ctx.reveal([S.notes[0], S.notes[1]], { from: 'scale', stagger: 250 }), ctx.reveal(rules[0], { from: 'up', delay: 400 })]);
          }).then(function () {
            return Promise.all(S.dl.map(function (l, k) { return ctx.wait(k * 120).then(function () { return ctx.packet(l, { color: 'magenta', dur: 800 }); }); }));
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: references and the bible */
            return Promise.all([ctx.reveal(S.notes[4], { from: 'scale' }), ctx.reveal(rules[1], { from: 'up', delay: 300 })]).then(function () {
              return Promise.all(S.sl.map(function (l) { return ctx.packet(l, { color: 'teal', dur: 700, r: 4 }); }));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the critic gate and the single writer */
            ctx.pulse(S.ag[5], { color: 'violet', times: 2, dur: 600 });
            ctx.pulse(S.ag[4], { color: 'cyan', times: 2, dur: 600 });
            return ctx.reveal([S.notes[2], S.notes[3]], { from: 'scale', stagger: 250 });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: external specialists and what comes next */
            ctx.hud('fan-out 5.6× faster · 1 targeted redo, not 6');
            return Promise.all([ctx.reveal(rules[2], { from: 'up' }), ctx.reveal(S.nextPill, { from: 'left', delay: 300 })]).then(function () {
              return ctx.pulse(S.nextPill, { color: 'magenta', times: 2, dur: 600 });
            });
          });
        }
      }
    ]
  });
})();
