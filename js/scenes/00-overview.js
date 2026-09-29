/* L0 — The Whole Machine. Reference implementation for the scene API, including beats:
 * every step is a sequence of beats; each beat has its own narration chunk, callout card (left rail),
 * deep-dive chunk (right rail) and animation segment, gated with ctx.beat(k). */
Atlas.register({
  id: 'overview',
  refs: [
    'Yao et al., <i>ReAct: Synergizing Reasoning and Acting in Language Models</i>, ICLR 2023',
    'Peebles &amp; Xie, <i>Scalable Diffusion Models with Transformers (DiT)</i>, ICCV 2023',
    'Kwon et al., <i>Efficient Memory Management for LLM Serving with PagedAttention</i>, SOSP 2023',
    'OpenAI, <i>Video generation models as world simulators</i> (Sora technical report), 2024',
    'Anthropic, <i>Model Context Protocol</i> specification, 2024–2025',
    'Google DeepMind, <i>Veo 3</i> technical report, 2025; Wan Team, <i>Wan 2.x: Open Large-Scale Video Generative Models</i>, 2025'
  ],
  steps: [
    {
      title: 'One prompt',
      beats: [
        {
          say: 'Everything starts with one human sentence. A creator asks for a thirty second cinematic trailer.',
          card: { tag: 'KEY IDEA', title: 'One sentence, a whole film', body: 'The request is <b>multimodal</b> (text, images, audio) and <b>long-horizon</b>: no single model call can answer it.' },
          deep: '<p>The request cannot be a single inference: it needs <b>planning</b>, dozens of <b>tool invocations</b>, several specialised generative models and minutes of GPU time. The rest of this atlas is the machinery that makes one sentence tractable.</p>'
        },
        {
          say: 'She attaches three concept sketches and a voice memo, and presses enter.',
          card: { tag: 'NUMBERS', title: 'What actually arrives', stat: { v: '3 + 1', l: 'sketches + one 42 second voice memo, plus a 40 word prompt' } },
          deep: '<div class="note">Mental model: an <b>LLM-driven control plane</b> (agents, orchestration) steering a <b>GPU-heavy data plane</b> (encoders, diffusion transformers, codecs).</div>'
        },
        {
          say: 'Behind that button sits a distributed system that will read, plan, reason, render and deliver a film. Let us follow that single request, end to end.',
          card: { tag: 'NUMBERS', title: 'The bill for one trailer', stat: { v: '≈ 76', u: 'GPU-min', l: '6 shots × 8 GPUs × ~95 s of diffusion, before audio and edit' } },
          deep: '<p>Order-of-magnitude budget for a 30&nbsp;s, 1080p, 24&nbsp;fps result:</p>' +
            '<table><tr><th>Stage</th><th>Work</th></tr>' +
            '<tr><td>Planning (LLM)</td><td>~10<sup>4</sup>–10<sup>5</sup> tokens across agents</td></tr>' +
            '<tr><td>Video generation</td><td>6 shots × 5&nbsp;s, each ~10<sup>5</sup> latent tokens × 8–50 denoising steps</td></tr>' +
            '<tr><td>GPU time</td><td>tens of H100/B200-minutes without distillation</td></tr></table>'
        }
      ],
      run: function (ctx) {
        var S = ctx.state;
        S.user = ctx.node({ x: 95, y: 430, w: 140, h: 64, title: 'Creator', sub: 'human', icon: 'user', color: 'white' });
        ctx.reveal(S.user, { from: 'scale' });
        S.prompt = ctx.code({ x: 40, y: 165, w: 560, title: 'prompt.txt  +  3 sketches  +  memo.m4a', lang: 'text', typing: true, maxLines: 4, color: 'cyan', lines: [
          '"A 30-second cinematic trailer: a fox astronaut',
          ' crash-lands on a glowing ice moon. Match the style',
          ' of my sketches. Use my voice memo as narration."'
        ] });
        ctx.reveal(S.prompt, { from: 'up', dur: 500 });
        S.att = ctx.group();
        [0, 1, 2].forEach(function (i) {
          var x = 60 + i * 74, y = 305;
          ctx.rect(x, y, 64, 44, { fill: '#0d1a33', stroke: 'violet', rx: 8, parent: S.att });
          ctx.icon('image', x + 32, y + 22, 22, 'violet', { parent: S.att });
        });
        ctx.rect(290, 305, 110, 44, { fill: '#0d1a33', stroke: 'orange', rx: 8, parent: S.att });
        ctx.icon('wave', 345, 327, 60, 'orange', { parent: S.att });
        S.enter = ctx.label(520, 327, 'press enter  ⏎', { color: 'cyan', size: 12, opacity: 0 });
        /* beat 0: the sentence types itself */
        return S.prompt.typeAll().then(function () { return ctx.beat(1); }).then(function () {
          /* beat 1: the attachments */
          return ctx.reveal(S.att, { from: 'up' }).then(function () { return ctx.beat(2); });
        }).then(function () {
          /* beat 2: submit */
          return ctx.reveal(S.enter, { from: 'left' }).then(function () { return ctx.pulse(S.user, { color: 'cyan', times: 2, dur: 700 }); });
        });
      }
    },
    {
      title: 'Client & transport',
      beats: [
        {
          say: 'The client app splits the sketches and audio into resumable chunks and uploads them straight to object storage with pre-signed URLs, so the media never clogs the API servers.',
          card: { tag: 'KEY IDEA', title: 'Media bypasses the API', body: 'Bytes go <b>directly to object storage</b> over pre-signed URLs. Only a small job request reaches the API.' },
          deep: '<p><b>Upload path</b>: multipart or tus-style resumable upload, parts hashed (SHA-256) for dedup, sent in parallel straight to object storage. A dropped connection resumes from the last acknowledged part.</p>'
        },
        {
          say: 'The prompt itself travels as a small authenticated request through the edge, where TLS terminates and identity is checked.',
          card: { tag: 'HOW IT WORKS', title: 'The edge does the cheap checks first', body: 'TLS 1.3 terminates at the nearest point of presence; a signed token proves who is asking.' },
          deep: '<p><b>Control path</b>: HTTPS/2 or HTTP/3 (QUIC) to an anycast edge, then the API gateway and the job service. The call returns a <code>job_id</code> immediately: it is an <i>asynchronous</i> API, because the work takes minutes.</p>'
        },
        {
          say: 'Rate limits and quotas then decide whether this job may even enter the system, because the expensive resource is the accelerator, not the request.',
          card: { tag: 'TRADE-OFF', title: 'Admit by GPU-seconds', body: 'Counting requests is meaningless when one request costs <b>seconds</b> and another costs <b>GPU-hours</b>. Quotas are charged in GPU-seconds.' },
          deep: '<p><b>Admission</b>: token-bucket rate limits plus a GPU-seconds quota are checked <i>before</i> anything is scheduled. Rejecting early is cheap; rejecting after a GPU has been reserved is not.</p>'
        },
        {
          say: 'A persistent streaming channel stays open so progress can flow back to the browser in real time.',
          card: { tag: 'HOW IT WORKS', title: 'Push, not poll', body: 'Server-Sent Events carry typed progress events: <code>plan.created</code>, <code>shot.progress</code>, <code>preview.ready</code>.' },
          deep: '<p><b>Feedback path</b>: an SSE or WebSocket stream of typed events. On reconnect the client sends <code>Last-Event-ID</code> and the server replays what was missed, so the UI never loses a frame of progress.</p>'
        }
      ],
      run: function (ctx) {
        var S = ctx.state;
        ctx.fade([S.prompt, S.att, S.enter], 0.3, 500);
        S.client = ctx.node({ x: 265, y: 430, w: 160, h: 64, title: 'Client App', sub: 'web · mobile', icon: 'phone', color: 'cyan' });
        S.gw = ctx.node({ x: 462, y: 430, w: 190, h: 64, title: 'Edge + Gateway', sub: 'TLS · auth · quota', icon: 'shield', color: 'blue', titleSize: 15 });
        S.l1 = ctx.link(S.user, S.client, { color: 'cyan' });
        S.l2 = ctx.link(S.client, S.gw, { color: 'blue', label: 'HTTPS / QUIC', labelDy: 50 });
        S.back = ctx.link(S.gw, S.client, { color: 'cyan', from: 't', to: 't', bend: { x: 360, y: 340 }, dash: '3 5', label: 'SSE: progress events', labelDy: -12 });
        ctx.hotspot(S.client, 'client');
        ctx.hotspot(S.gw, 'gateway');
        /* beat 0: the client and the chunked upload */
        return Promise.all([ctx.reveal(S.client, { from: 'left' }), ctx.reveal(S.l1, { from: 'draw', delay: 200 })]).then(function () {
          return ctx.packet(S.l1, { color: 'cyan', dur: 800, label: 'chunks' });
        }).then(function () { return ctx.beat(1); }).then(function () {
          /* beat 1: through the edge */
          return Promise.all([ctx.reveal(S.gw, { from: 'left' }), ctx.reveal(S.l2, { from: 'draw', delay: 200 }), ctx.reveal(S.l2.labelEl, { delay: 500 })]).then(function () {
            return ctx.packet(S.l2, { color: 'blue', dur: 900, label: 'job' });
          });
        }).then(function () { return ctx.beat(2); }).then(function () {
          /* beat 2: admission */
          S.quota = ctx.label(455, 372, 'quota ✓', { color: 'lime', size: 11, opacity: 0 });
          return ctx.pulse(S.gw, { color: 'blue', dur: 700 }).then(function () { return ctx.reveal(S.quota, { from: 'down' }); });
        }).then(function () { return ctx.beat(3); }).then(function () {
          /* beat 3: streaming channel back to the client */
          return Promise.all([ctx.reveal(S.back, { from: 'draw' }), ctx.reveal(S.back.labelEl, { delay: 400 })]).then(function () {
            S.progress = ctx.stream(S.back, { color: 'cyan', count: 4, period: 1600 });
          });
        });
      }
    },
    {
      title: 'Orchestration plane',
      beats: [
        {
          say: 'Now the brain. The orchestration plane turns intent into a plan.',
          card: { tag: 'KEY IDEA', title: 'Intent in, plan out', body: 'A planner model converts one sentence into an explicit, inspectable <b>task graph</b>.' },
          deep: '<p>The plan is <b>data, not code</b>: a DAG <code>G = (V, E)</code> whose vertices are agent tasks and whose edges are artifact dependencies. Being data, it can be logged, diffed, costed and edited by a human before any GPU is touched.</p>'
        },
        {
          say: 'A planner model decomposes the request into a directed acyclic graph of tasks: understand the references, write a script, storyboard it, render each shot, generate audio, edit, and critique.',
          card: { tag: 'HOW IT WORKS', title: 'A dynamic graph', body: 'Independent shots render in parallel. The critic can add a back-edge later: <i>re-render shot 3</i>.' },
          deep: '<div class="eq">T<sub>plan</sub> ≈ critical path of G, &nbsp; cost = Σ<sub>v∈V</sub> resources(v)</div><p>Because the critic can add edges at run time, the graph is <i>dynamic</i>: the orchestrator re-plans, it does not just execute.</p>'
        },
        {
          say: 'A durable workflow engine executes that graph, checkpointing every step, so a crashed GPU never loses the film.',
          card: { tag: 'TRADE-OFF', title: 'Decide vs. guarantee', body: 'The LLM decides <b>what</b> to do. Deterministic infrastructure guarantees it happens <b>exactly once</b>.' },
          deep: '<p>Execution uses a <b>durable workflow engine</b> (Temporal or Cadence style): every task result is appended to an event history, so the orchestrator can crash and deterministically <i>replay</i> to its last state. Retries, timeouts and idempotency live here, not in prompts.</p>'
        }
      ],
      run: function (ctx) {
        var S = ctx.state;
        S.orch = ctx.node({ x: 730, y: 430, w: 250, h: 104, title: 'Orchestrator', sub: 'planner · DAG · durable state', icon: 'gear', color: 'magenta', titleSize: 18 });
        S.l3 = ctx.link(S.gw, S.orch, { color: 'magenta' });
        ctx.hotspot(S.orch, 'orchestration');
        /* beat 0 */
        return Promise.all([ctx.reveal(S.orch, { from: 'scale' }), ctx.reveal(S.l3, { from: 'draw', delay: 250 })]).then(function () {
          return ctx.packet(S.l3, { color: 'magenta', dur: 900, label: 'intent' });
        }).then(function () { return ctx.beat(1); }).then(function () {
          /* beat 1: the task graph */
          S.dag = ctx.group();
          var nodes = [['refs', 560, 225], ['script', 650, 185], ['board', 740, 225], ['shot×6', 830, 185], ['audio', 830, 270], ['edit', 920, 225]];
          var pos = {};
          nodes.forEach(function (n) {
            pos[n[0]] = ctx.label(n[1], n[2], n[0], { color: 'magenta', size: 11, parent: S.dag });
            pos[n[0]].p = { x: n[1], y: n[2] };
          });
          [['refs', 'script'], ['script', 'board'], ['board', 'shot×6'], ['board', 'audio'], ['shot×6', 'edit'], ['audio', 'edit']].forEach(function (e) {
            var a = pos[e[0]].p, b = pos[e[1]].p;
            ctx.line(a.x + 26, a.y, b.x - 26, b.y, { color: ctx.alpha('magenta', 0.6), sw: 1.2, arrow: true, parent: S.dag });
          });
          ctx.text(740, 306, 'task DAG (dynamic)', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: S.dag });
          return ctx.reveal(S.dag, { from: 'down', dur: 800 });
        }).then(function () { return ctx.beat(2); }).then(function () {
          /* beat 2: durability */
          S.hist = ctx.label(730, 350, 'event history · replayable', { color: 'teal', size: 11, opacity: 0 });
          return ctx.reveal(S.hist, { from: 'up' }).then(function () { return ctx.pulse(S.orch, { color: 'teal', times: 2, dur: 700 }); });
        });
      }
    },
    {
      title: 'A crew of agents',
      beats: [
        {
          say: 'Each task is owned by an agent: an LLM running a loop of observe, think, act. The director holds the vision; a writer drafts the script; a storyboard agent designs shots.',
          card: { tag: 'KEY IDEA', title: 'Agent = LLM + tools + memory + loop', body: 'Six narrow, well-typed agents are easier to evaluate and to bound in cost than one giant one.' },
          deep: '<p>An <b>agent</b> is a language model wrapped in a control loop: assemble context, sample a response, execute any <code>tool_use</code> blocks it contains, append the results, repeat until it answers or a budget runs out.</p>'
        },
        {
          say: 'A cinematographer turns them into precise prompts for the video model; an editor assembles the cut; and a critic watches the result and sends shots back when they fail.',
          card: { tag: 'HOW IT WORKS', title: 'A supervisor and its crew', body: 'The director <b>delegates</b>; the critic can send work back. Topologies: supervisor, handoff, blackboard.' },
          deep: '<p>Topologies: <b>supervisor</b> (the director delegates), <b>handoff</b> (agents transfer control) and <b>blackboard</b> (a shared artifact store). Production systems favour a supervisor with narrow sub-agents.</p>'
        },
        {
          say: 'Agents act by calling tools with structured JSON, and every tool call is a network request into the model fleet: the language model, the multimodal encoders and the video generator.',
          card: { tag: 'HOW IT WORKS', title: 'Tools are network calls', body: 'Plan, encode, render: three services behind three arrows.' },
          deep: '<p>A tool call is a typed JSON message. The runtime, <i>not the model</i>, executes it, so it can be authorised, rate limited, traced and retried like any other RPC.</p>'
        },
        {
          say: 'Watch three of those calls fly: encode the sketches, plan the shots, render the first shot.',
          card: { tag: 'TRY IT', title: 'Click any model service', body: 'The dashed rings are zoom targets: try the LLM, the encoders or the video generator.' },
          deep: '<p>Each service is a chamber you can open: <i>Inside the LLM</i>, <i>Multimodal Understanding</i>, <i>Video Generation Models</i>. Every arrow here later becomes a queue, a scheduler and a GPU.</p>'
        }
      ],
      run: function (ctx) {
        var S = ctx.state;
        var names = [['Director', 'agent'], ['Writer', 'doc'], ['Storyboard', 'image'], ['Camera', 'film'], ['Editor', 'layers'], ['Critic', 'eye']];
        S.agents = names.map(function (n, i) {
          var col = i % 3, row = Math.floor(i / 3);
          return ctx.node({ x: 640 + col * 92, y: 530 + row * 44, w: 86, h: 34, title: n[0], color: 'magenta', titleSize: 10.5, kind: 'pill', glow: false });
        });
        S.agentBox = ctx.node({ x: 732, y: 552, w: 300, h: 104, kind: 'ghost', color: 'magenta' });
        S.llm = ctx.node({ x: 1060, y: 250, w: 220, h: 64, title: 'LLM Service', sub: 'reasoning · tools', icon: 'brain', color: 'amber' });
        S.mm = ctx.node({ x: 1060, y: 370, w: 220, h: 64, title: 'Multimodal Encoders', sub: 'vision · audio', icon: 'eye', color: 'violet', titleSize: 15 });
        S.vg = ctx.node({ x: 1060, y: 490, w: 220, h: 64, title: 'Video Generation', sub: 'latent DiT', icon: 'film', color: 'lime' });
        S.m1 = ctx.link(S.orch, S.llm, { color: 'amber', from: 'r', to: 'l' });
        S.m2 = ctx.link(S.orch, S.mm, { color: 'violet', from: 'r', to: 'l' });
        S.m3 = ctx.link(S.orch, S.vg, { color: 'lime', from: 'r', to: 'l' });
        ctx.hotspot(S.agentBox, 'multi-agent', { hint: 'AGENTS ⤢' });
        ctx.hotspot(S.llm, 'llm');
        ctx.hotspot(S.mm, 'multimodal');
        ctx.hotspot(S.vg, 'videogen');
        /* beat 0: the first three agents */
        S.agents.forEach(function (a) { a.setAttribute('opacity', 0); });
        S.agentBox.setAttribute('opacity', 0);
        return Promise.all([ctx.reveal(S.agentBox, {}), ctx.reveal(S.agents.slice(0, 3), { from: 'up', stagger: 120 })]).then(function () { return ctx.beat(1); }).then(function () {
          /* beat 1: the rest of the crew */
          return ctx.reveal(S.agents.slice(3), { from: 'up', stagger: 120 });
        }).then(function () { return ctx.beat(2); }).then(function () {
          /* beat 2: the model services */
          return Promise.all([ctx.reveal([S.llm, S.mm, S.vg], { from: 'right', stagger: 150 }), ctx.reveal([S.m1, S.m2, S.m3], { from: 'draw', delay: 400, stagger: 150 })]);
        }).then(function () { return ctx.beat(3); }).then(function () {
          /* beat 3: three calls in flight */
          return Promise.all([
            ctx.packet(S.m2, { color: 'violet', dur: 800, label: 'encode()' }),
            ctx.packet(S.m1, { color: 'amber', dur: 800, label: 'plan()' }),
            ctx.wait(500).then(function () { return ctx.packet(S.m3, { color: 'lime', dur: 900, label: 'render_shot()' }); })
          ]);
        });
      }
    },
    {
      title: 'The GPU cluster',
      beats: [
        {
          say: 'Every model call lands on the GPU cluster. A global scheduler places work on pools of accelerators.',
          card: { tag: 'KEY IDEA', title: 'Two workloads, two pools', body: 'Latency-sensitive <b>LLM decoding</b> and long-running <b>video diffusion</b> want very different machines.' },
          deep: '<p>Two very different workloads share the fleet, so serious systems run <b>separate serving stacks</b> and a scheduler that understands priorities, preemption and topology.</p>'
        },
        {
          say: 'Latency-sensitive LLM decoding lives on one pool, long-running video diffusion jobs on another, gang-scheduled across eight or more GPUs linked by NVLink.',
          card: { tag: 'NUMBERS', title: 'Gang scheduling', stat: { v: '8', u: 'GPUs', l: 'per video shot, all-or-nothing on one NVLink domain' } },
          deep: '<table><tr><th></th><th>LLM decode</th><th>Video DiT</th></tr>' +
            '<tr><td>Bound by</td><td>HBM bandwidth (KV cache reads)</td><td>Tensor-core FLOPs (attention over ~10<sup>5</sup> tokens)</td></tr>' +
            '<tr><td>Latency</td><td>ms per token, interactive</td><td>tens of seconds to minutes per clip</td></tr>' +
            '<tr><td>Batching</td><td>continuous batching</td><td>per-job, sequence / CFG parallel</td></tr>' +
            '<tr><td>Routing</td><td>prefix / KV-cache affinity</td><td>queue + gang placement</td></tr></table>'
        },
        {
          say: 'Load balancers route LLM requests to replicas that already hold the right prefix in their KV cache, and the video pool shards each shot across GPUs with sequence parallelism.',
          card: { tag: 'HOW IT WORKS', title: 'Route to where the cache is', body: 'Sending a request to the replica that already holds its prefix skips most of the prefill work.' },
          deep: '<p>LLM routing is <b>cache-aware</b>: hash the prompt prefix, prefer the replica that has it, fall back to least-loaded. Video routing is <b>queue-based</b>: a shot waits until a whole gang of GPUs is free.</p>'
        }
      ],
      run: function (ctx) {
        var S = ctx.state;
        S.gpuBox = ctx.node({ x: 1390, y: 430, w: 260, h: 430, color: 'red', kind: 'box', title: '', glow: true });
        S.gpuT = ctx.text(1390, 245, 'GPU CLUSTER', { size: 16, weight: 700, font: 'display', anchor: 'middle', color: 'red' });
        S.gpuS = ctx.text(1390, 266, 'scheduler · LB · serving', { size: 11, font: 'mono', anchor: 'middle', color: 'dim' });
        S.gpus = ctx.matrix(1290, 290, 10, 7, { cell: 22, gap: 4, cmap: 'red', values: function () { return 0.1; } });
        S.poolA = ctx.label(1325, 578, 'LLM pool', { color: 'amber', size: 10 });
        S.poolB = ctx.label(1440, 578, 'Video pool', { color: 'lime', size: 10 });
        S.g1 = ctx.link(S.llm, S.gpuBox, { color: 'red', to: 'l', from: 'r' });
        S.g2 = ctx.link(S.mm, S.gpuBox, { color: 'red', to: 'l', from: 'r' });
        S.g3 = ctx.link(S.vg, S.gpuBox, { color: 'red', to: 'l', from: 'r' });
        ctx.hotspot(S.gpuBox, 'infra');
        /* beat 0: the cluster appears */
        return Promise.all([ctx.reveal(S.gpuBox, { from: 'right' }), ctx.reveal([S.gpuT, S.gpuS], { delay: 200 }), ctx.reveal(S.gpus, { delay: 300 })]).then(function () {
          return ctx.beat(1);
        }).then(function () {
          /* beat 1: two pools, shimmering utilisation (left columns LLM, right columns video gangs) */
          ctx.loop(function (t) {
            for (var i = 0; i < 10; i++) for (var j = 0; j < 7; j++) {
              var v = j < 3 ? 0.35 + 0.35 * Math.abs(Math.sin(t * 2.3 + i * 0.7 + j)) : (Math.floor((i + Math.floor(t / 1.5)) / 2) % 2 ? 0.9 : 0.25);
              S.gpus.cells[i][j].setAttribute('fill', ctx.cmap(j < 3 ? 'amber' : 'lime', v));
            }
          });
          return ctx.reveal([S.poolA, S.poolB], { from: 'up', stagger: 200 });
        }).then(function () { return ctx.beat(2); }).then(function () {
          /* beat 2: requests routed in */
          return ctx.reveal([S.g1, S.g2, S.g3], { from: 'draw', stagger: 120 }).then(function () {
            return Promise.all([ctx.packet(S.g1, { color: 'amber', dur: 700 }), ctx.packet(S.g3, { color: 'lime', dur: 900 })]);
          });
        });
      }
    },
    {
      title: 'Data & memory',
      beats: [
        {
          say: 'State lives in the data plane. Media files and generated clips go to object storage.',
          card: { tag: 'KEY IDEA', title: 'Pass references, not pixels', body: 'Clips are <b>immutable blobs</b> addressed by URI; they never travel inside an LLM context.' },
          deep: '<p><b>Object store</b> (S3-compatible): immutable, content-addressed blobs. Agents exchange <i>URIs</i> to clips, so a 40&nbsp;MB shot costs a few dozen tokens of context, not millions.</p>'
        },
        {
          say: 'An event log records every decision the agents make, so any run can be replayed and audited.',
          card: { tag: 'HOW IT WORKS', title: 'History is the source of truth', body: 'Append-only events feed the job state machine, the durable workflow and the audit trail.' },
          deep: '<p><b>Metadata DB + event log</b>: the job and shot state machine, plus an append-only history that supports replay, debugging and billing reconciliation.</p>'
        },
        {
          say: 'And a vector memory stores embeddings of the sketches, the characters and the style, so later shots can retrieve them and stay visually consistent.',
          card: { tag: 'HOW IT WORKS', title: 'Memory by similarity', body: 'Ask <i>what does the fox look like?</i> and get the nearest reference embeddings back.' },
          deep: '<p><b>Vector memory</b>: CLIP or SigLIP embeddings of references and generated keyframes, indexed for approximate nearest-neighbour search (HNSW). Caches sit alongside: prompt prefixes on the LLM side, encoded latents for reused reference images.</p>'
        }
      ],
      run: function (ctx) {
        var S = ctx.state;
        S.dataBox = ctx.node({ x: 740, y: 735, w: 520, h: 110, kind: 'ghost', color: 'teal' });
        S.db1 = ctx.node({ x: 580, y: 740, w: 150, h: 70, kind: 'cyl', title: 'Object Store', sub: 'media · clips', color: 'teal', titleSize: 13, subSize: 10 });
        S.db2 = ctx.node({ x: 740, y: 740, w: 150, h: 70, kind: 'cyl', title: 'Vector Memory', sub: 'embeddings', color: 'teal', titleSize: 13, subSize: 10 });
        S.db3 = ctx.node({ x: 900, y: 740, w: 150, h: 70, kind: 'cyl', title: 'Event Log', sub: 'state · replay', color: 'teal', titleSize: 13, subSize: 10 });
        S.d1 = ctx.link(S.agentBox, S.dataBox, { color: 'teal', from: 'b', to: 't', flow: true, arrow: false });
        S.d2 = ctx.link(S.client, S.db1, { color: 'teal', from: 'b', to: 'l', dash: '4 6', label: 'pre-signed upload', labelDx: 40, labelDy: 20 });
        ctx.hotspot(S.dataBox, 'data', { hint: 'DATA ⤢' });
        [S.db2, S.db3].forEach(function (n) { n.setAttribute('opacity', 0); });
        /* beat 0: object store + the upload arriving */
        return Promise.all([ctx.reveal(S.dataBox, {}), ctx.reveal(S.db1, { from: 'up' }), ctx.reveal(S.d2, { from: 'draw', delay: 300 }), ctx.reveal(S.d2.labelEl, { delay: 700 })]).then(function () {
          return ctx.packet(S.d2, { color: 'teal', dur: 1100, label: 'sketch.png' });
        }).then(function () { return ctx.beat(1); }).then(function () {
          /* beat 1: event log */
          return Promise.all([ctx.reveal(S.db3, { from: 'up' }), ctx.reveal(S.d1, { from: 'draw', delay: 200 })]);
        }).then(function () { return ctx.beat(2); }).then(function () {
          /* beat 2: vector memory */
          return ctx.reveal(S.db2, { from: 'up' }).then(function () { return ctx.pulse(S.db2, { color: 'teal', times: 2, dur: 700 }); });
        });
      }
    },
    {
      title: 'Post-production & delivery',
      beats: [
        {
          say: 'When the shots are rendered, post-production takes over: narration in the creator\'s voice, music, sound effects and lip-sync.',
          card: { tag: 'HOW IT WORKS', title: 'Sound is generated too', body: 'The voice memo becomes a <b>speaker embedding</b>; music and foley come from audio models.' },
          deep: '<p><b>Audio</b>: codec-LM or flow-matching TTS conditioned on a speaker embedding from the memo; music and foley from video-to-audio models; lip-sync from audio-driven face models.</p>'
        },
        {
          say: 'Then an edit stitches the clips on a timeline, upscales, interpolates frames, and encodes an adaptive bitrate ladder.',
          card: { tag: 'HOW IT WORKS', title: 'The edit is data', body: 'The editor agent writes an <b>edit decision list</b>; a deterministic compositor executes it.' },
          deep: '<p><b>Assembly</b>: an EDL produced by the editor agent drives a deterministic compositor (ffmpeg or a GPU compositor). <b>Encode</b>: NVENC H.264, HEVC or AV1, packaged as an HLS/DASH ladder, for example 1080p at 6&nbsp;Mb/s down to 360p at 0.6&nbsp;Mb/s.</p>'
        },
        {
          say: 'The finished film is pushed to a content delivery network, and the client streams it back, while progress events have been flowing to the user the whole time.',
          card: { tag: 'NUMBERS', title: 'Adaptive by design', stat: { v: '5', u: 'renditions', l: 'from 1080p down to 360p, switched by the player every few seconds' } },
          deep: '<p><b>Delivery</b>: CDN edge caching, signed URLs, and C2PA content credentials embedded in the manifest so provenance travels with the file.</p>'
        }
      ],
      run: function (ctx) {
        var S = ctx.state;
        S.post = ctx.node({ x: 1060, y: 630, w: 220, h: 64, title: 'Post-production', sub: 'audio · edit · encode', icon: 'music', color: 'orange', titleSize: 15 });
        S.p1 = ctx.link(S.vg, S.post, { color: 'orange', from: 'b', to: 't' });
        S.cdn = ctx.node({ x: 360, y: 630, w: 170, h: 60, title: 'CDN Edge', sub: 'HLS / DASH', icon: 'globe', color: 'orange' });
        S.p2 = ctx.link(S.post, S.cdn, { color: 'orange', from: 'l', to: 'r', bend: { x: 700, y: 640 } });
        S.p3 = ctx.link(S.cdn, S.client, { color: 'orange', from: 't', to: 'b' });
        ctx.hotspot(S.post, 'postprod');
        /* beat 0: post-production node fed by the video generator */
        return Promise.all([ctx.reveal(S.post, { from: 'right' }), ctx.reveal(S.p1, { from: 'draw', delay: 200 })]).then(function () {
          return ctx.packet(S.p1, { color: 'orange', dur: 600, label: 'clips' });
        }).then(function () { return ctx.beat(1); }).then(function () {
          /* beat 1: pipeline stages inside post-production */
          return ctx.pulse(S.post, { color: 'orange', times: 3, dur: 600 });
        }).then(function () { return ctx.beat(2); }).then(function () {
          /* beat 2: delivery */
          return Promise.all([ctx.reveal(S.cdn, { from: 'left' }), ctx.reveal([S.p2, S.p3], { from: 'draw', delay: 300, stagger: 250 })]).then(function () {
            return ctx.packet(S.p2, { color: 'orange', dur: 1100, label: 'film.m3u8' });
          }).then(function () { return ctx.packet(S.p3, { color: 'orange', dur: 600 }); });
        });
      }
    },
    {
      title: 'Trust & observability',
      beats: [
        {
          say: 'Wrapped around every hop is the trust layer. Input and output classifiers enforce policy.',
          card: { tag: 'KEY IDEA', title: 'Safety is a layer, not a step', body: 'Text, image and video classifiers guard ingress and egress, and policy checks cover tool <b>arguments</b>, not just words.' },
          deep: '<p><b>Guardrails</b>: safety classifiers at ingress and egress, plus policy checks on tool arguments. A model that never says anything harmful can still call a harmful tool.</p>'
        },
        {
          say: 'Agents are hardened against prompt injection hidden in uploaded media, and every frame is watermarked and signed with content credentials.',
          card: { tag: 'PITFALL', title: 'Uploads are untrusted input', body: 'A sketch can contain text that <i>looks</i> like an instruction. Content from tools and uploads is <b>data</b>, never a command.' },
          deep: '<p><b>Prompt injection</b>: enforced with privilege separation and provenance tags in the context. <b>Provenance</b>: invisible watermarks (SynthID style) plus C2PA manifests signed with a certificate chain.</p>'
        },
        {
          say: 'And distributed tracing follows each agent step and GPU second, so engineers can see exactly where latency and cost went.',
          card: { tag: 'HOW IT WORKS', title: 'One trace per trailer', body: 'OpenTelemetry spans for every agent turn, tool call and GPU job share a single trace id.' },
          deep: '<p><b>Observability</b>: OpenTelemetry spans per agent turn, tool call and GPU job; eval dashboards with VBench-style metrics, human preference and critic scores.</p>'
        }
      ],
      run: function (ctx) {
        var S = ctx.state;
        S.trust = ctx.group();
        S.trustRect = ctx.rect(60, 818, 1480, 46, { rx: 14, fill: ctx.alpha('pink', 0.07), stroke: ctx.alpha('pink', 0.6), dash: '6 6', parent: S.trust });
        ctx.icon('shield', 92, 841, 22, 'pink', { parent: S.trust });
        ctx.text(116, 841, 'SAFETY · PROVENANCE · EVALS · TRACING — spans every hop', { size: 14, color: 'pink', font: 'mono', weight: 500, parent: S.trust });
        S.trust.box = { x: 60, y: 818, w: 1480, h: 46, cx: 800, cy: 841, l: 60, r: 1540, t: 818, b: 864 };
        ctx.hotspot(S.trust, 'trust', { hint: 'TRUST ⤢' });
        function sweep(list, dur) {
          return list.reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, { color: 'pink', dur: dur }); }); }, Promise.resolve());
        }
        /* beat 0: the band, and a policy check at the edge and the orchestrator */
        return ctx.reveal(S.trust, { from: 'up' }).then(function () { return sweep([S.gw, S.orch], 500); }).then(function () { return ctx.beat(1); }).then(function () {
          /* beat 1: agents and the media pipeline */
          return sweep([S.agentBox, S.mm, S.vg], 500);
        }).then(function () { return ctx.beat(2); }).then(function () {
          /* beat 2: the trace follows the whole path */
          return sweep([S.gw, S.orch, S.llm, S.vg, S.post], 350);
        });
      }
    },
    {
      title: 'Where the time goes',
      beats: [
        {
          say: 'Here is the critical path of our trailer. Planning takes seconds, and understanding the references takes a few more.',
          card: { tag: 'NUMBERS', title: 'Wall-clock', stat: { v: '≈ 150', u: 's', l: 'from enter to a playable film on a well-provisioned cluster' } },
          deep: '<p>Illustrative critical path (seconds) for a 30&nbsp;s trailer:</p><pre>plan (LLM, 3 agents)        ██ 12\nunderstand refs (encoders)    █ 4\nshots ×6 (parallel DiT)       ████████████ 95\ncritic + 1 re-render            ████ 30\naudio (overlaps shots)        ███ 20\nedit + encode + CDN              ██ 14</pre>'
        },
        {
          say: 'Then the six shots render in parallel on the video pool, which dominates the wall-clock time and the bill. Audio overlaps with rendering, and the edit and encode close it out.',
          card: { tag: 'WHY IT MATTERS', title: 'Diffusion dominates', body: '<b>95 of 150 seconds</b> and nearly all of the GPU bill are the parallel shots. That is where engineering effort pays.' },
          deep: '<p>Levers that move this chart: <b>step distillation</b> (50 to 4–8 steps), <b>sequence parallelism</b> (one shot across 8 GPUs), <b>step caching</b> (reuse features across denoising steps), <b>speculative planning</b> (draft at low resolution first) and <b>prefix caching</b> for agent prompts.</p>'
        },
        {
          say: 'Every box you have seen can be opened. Click any glowing component, or use the chips below, to zoom in.',
          card: { tag: 'TRY IT', title: 'Now zoom in', body: 'Dashed rings mark every component that has its own chamber. Start with <b>Inside the LLM</b> or <b>Video Generation Models</b>.' },
          deep: '<p>The atlas has four levels: <b>L0</b> this overview, <b>L1</b> ten subsystems, <b>L2</b> components (agent loop, attention, DiT, schedulers), <b>L3</b> primitives (a single neuron, FlashAttention, mixture of experts).</p>'
        }
      ],
      run: function (ctx) {
        var S = ctx.state;
        S.gantt = ctx.group();
        ctx.rect(330, 150, 940, 420, { rx: 20, fill: 'rgba(5,10,22,0.94)', stroke: 'cyan', parent: S.gantt, glow: true });
        ctx.text(360, 185, 'CRITICAL PATH · 30 s trailer', { size: 15, font: 'display', weight: 700, color: 'white', parent: S.gantt });
        ctx.text(1240, 185, 'wall-clock ≈ 150 s', { size: 13, font: 'mono', color: 'cyan', anchor: 'end', parent: S.gantt });
        var rows = [['plan', 0, 12, 'amber'], ['understand', 8, 12, 'violet'], ['shots ×6', 12, 107, 'lime'], ['critic + redo', 107, 137, 'magenta'], ['audio', 20, 40, 'orange'], ['edit+encode', 137, 151, 'cyan']];
        var x0 = 500, sc = 700 / 155;
        S.bars = rows.map(function (r, i) {
          var y = 225 + i * 52;
          ctx.text(485, y + 14, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: S.gantt });
          ctx.rect(x0, y, 700, 28, { rx: 6, fill: 'rgba(255,255,255,0.02)', parent: S.gantt });
          return ctx.rect(x0 + r[1] * sc, y, (r[2] - r[1]) * sc, 28, { rx: 6, fill: ctx.alpha(r[3], 0.5), stroke: r[3], parent: S.gantt });
        });
        for (var s = 0; s <= 150; s += 30) {
          ctx.text(x0 + s * sc, 548, s + 's', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gantt });
        }
        S.bars.forEach(function (b) { b._w = parseFloat(b.getAttribute('width')); b.setAttribute('width', 0); });
        function grow(idx, delay) {
          return Promise.all(idx.map(function (i, n) { return ctx.animate(S.bars[i], { width: [0, S.bars[i]._w] }, 700, 'out', delay + n * 160); }));
        }
        /* beat 0: chart appears, planning and understanding bars */
        ctx.focus([S.gantt], 0.2);
        return ctx.reveal(S.gantt, { from: 'scale', s0: 0.92 }).then(function () { return grow([0, 1], 100); }).then(function () { return ctx.beat(1); }).then(function () {
          /* beat 1: shots dominate */
          ctx.hud('GPU time ≈ 6 shots × 8 GPUs × ~95 s ≈ 76 GPU-min');
          return grow([2, 3, 4, 5], 0).then(function () { return ctx.pulse(S.bars[2], { color: 'lime', times: 2, dur: 700 }); });
        }).then(function () { return ctx.beat(2); }).then(function () {
          /* beat 2: hand the stage back to the components */
          ctx.hud('');
          return ctx.fadeOut(S.gantt, 700, true).then(function () { return ctx.focus(null); });
        });
      }
    }
  ]
});
