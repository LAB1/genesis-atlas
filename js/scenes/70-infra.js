/* L1 — AI Infrastructure & GPU Cluster. Follows the trailer's ~40 LLM calls and 6 video jobs down the stack:
 * workload -> global router / scheduler -> regional Kubernetes clusters -> inference servers -> GPUs & fabrics,
 * then the control plane that keeps it fed (registry, weight distribution, autoscaling, health, observability).
 * Every step is split into beats (one idea each): narration, callout card, deep-dive chunk and animation segment. */
(function () {
  var BANDS = [
    { n: '01', name: 'WORKLOAD', t: 156, b: 234 },
    { n: '02', name: 'GLOBAL', t: 242, b: 334 },
    { n: '03', name: 'REGIONS', t: 342, b: 462 },
    { n: '04', name: 'SERVING', t: 470, b: 602 },
    { n: '05', name: 'HARDWARE', t: 610, b: 884 }
  ];
  var GHOST = [null,
    'global scheduler  +  inference router',
    'regional Kubernetes clusters  ·  node pools',
    'inference servers  ·  vLLM / SGLang / TRT-LLM  ·  DiT workers',
    'GPUs  ·  NVLink / NVSwitch  ·  InfiniBand / RoCE  ·  storage'];
  var CLUSTERS = [
    { x: 370, name: 'k8s · us-east', pools: [['HGX H100 · 1,024 GPU', 'amber'], ['HGX B200 · 512 GPU', 'lime'], ['GB200 NVL72 · 8 racks', 'red']] },
    { x: 670, name: 'k8s · us-central', pools: [['HGX H200 · 768 GPU', 'amber'], ['GB200 NVL72 · 12 racks', 'red'], ['L40S · 256 GPU', 'violet']] },
    { x: 970, name: 'k8s · eu-west', pools: [['HGX H100 · 512 GPU', 'amber'], ['HGX B200 · 256 GPU', 'lime'], ['GB300 NVL72 · 4 racks', 'red']] }
  ];
  var UTIL = [0.86, 0.64, 0.34];      /* busy near the user, idle where it is night */
  var ENGINES = [['vLLM', 'TP4 · FP8 · H100'], ['SGLang', 'TP8 · FP8 · H200'], ['TRT-LLM', 'TP4 · FP4 · B200']];

  /* GPU package: rect + two text lines */
  function chip(ctx, x, y, w, h, t1, t2, col, parent) {
    var g = ctx.group({ parent: parent });
    g.body = ctx.rect(x, y, w, h, { rx: 4, fill: ctx.alpha(col, 0.12), stroke: col, sw: 1.2, parent: g });
    ctx.text(x + w / 2, y + h / 2 - 8, t1, { size: 12, color: 'white', anchor: 'middle', font: 'mono', weight: 600, parent: g });
    ctx.text(x + w / 2, y + h / 2 + 9, t2, { size: 11, color: col, anchor: 'middle', font: 'mono', parent: g });
    g.box = { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h };
    return g;
  }

  /* dark pill tag readable on top of anything */
  function tag(ctx, x, y, str, col, parent, wFixed) {
    var g = ctx.group({ parent: parent });
    var w = wFixed || str.length * 11 * 0.62 + 20;
    ctx.rect(x - w / 2, y - 12, w, 24, { rx: 12, fill: 'rgba(5,8,15,0.94)', stroke: col, sw: 1.2, parent: g });
    ctx.text(x, y + 0.5, str, { size: 11, color: col, anchor: 'middle', font: 'mono', weight: 600, parent: g });
    return g;
  }

  Atlas.register({
    id: 'infra',
    refs: [
      'Kwon et al., <i>Efficient Memory Management for Large Language Model Serving with PagedAttention</i>, SOSP 2023',
      'Zheng et al., <i>SGLang: Efficient Execution of Structured Language Model Programs</i> (RadixAttention), NeurIPS 2024',
      'NVIDIA, <i>GB200 NVL72</i> datasheet, 2024',
      'NVIDIA, <i>NVIDIA Blackwell Architecture Technical Brief</i>, 2024',
      'NVIDIA, <i>NVIDIA H100 Tensor Core GPU Architecture</i> whitepaper, 2022',
      'Llama Team, Meta AI, <i>The Llama 3 Herd of Models</i>, 2024',
      'Jiang et al., <i>MegaScale: Scaling Large Language Model Training to More Than 10,000 GPUs</i>, NSDI 2024',
      'Verma et al., <i>Large-scale cluster management at Google with Borg</i>, EuroSys 2015',
      'Kubernetes SIG Scheduling, <i>Kueue</i> documentation (ClusterQueue, cohorts, Topology-Aware Scheduling), 2025',
      'Kubernetes, <i>Dynamic Resource Allocation (DRA)</i> documentation, 2025',
      'Team Wan et al., <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025',
      'Jacobs et al., <i>DeepSpeed Ulysses: System Optimizations for Enabling Training of Extreme Long Sequence Transformer Models</i>, arXiv 2309.14509, 2023'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'The stack',
        beats: [
          {
            say: 'Every model call from the overview lands here, on the AI infrastructure. Think of it as five layers: a workload layer where requests arrive, a global layer that routes and schedules, regional Kubernetes clusters, inference servers, and finally the GPUs and their fabrics.',
            card: { tag: 'KEY IDEA', title: 'Five layers, five placement questions', body: 'Each layer decides <b>where</b> work runs, at a finer grain and a faster clock: region, node, replica, batch slot, streaming multiprocessor.' },
            deep: '<p>The fleet is a stack of placement layers. Each one answers a single question, at its own time scale, with its own software:</p>' +
              '<table><tr><th>Layer</th><th>Decides</th><th>Cadence</th></tr>' +
              '<tr><td>Global</td><td>which region, which queue</td><td>ms – s</td></tr>' +
              '<tr><td>Regional</td><td>which node, which NVLink domain</td><td>100 ms – s</td></tr>' +
              '<tr><td>Serving</td><td>which replica, which batch slot</td><td>per iteration</td></tr>' +
              '<tr><td>Hardware</td><td>which SM, which link</td><td>µs</td></tr></table>' +
              '<p>Typical software, top to bottom: router, Kueue or Slurm; kube-scheduler or Volcano; vLLM, SGLang or TRT-LLM; CUDA and NCCL. A sixth, orthogonal <b>control plane</b> (registry, weight distribution, autoscaling, health) keeps the layers fed. It arrives in steps six and seven.</p>'
          },
          {
            say: 'Our trailer creates two very different kinds of work. The first is about forty short language model calls from six agents. Each one is latency bound: a slow first token is felt immediately.',
            card: { tag: 'NUMBERS', title: 'Chatty and cache friendly', stat: { v: '≈ 40', u: 'LLM calls', l: 'about 2×10⁵ prompt tokens per trailer, roughly 80% of them served from the prefix cache' } },
            deep: '<p><b>LLM side of one trailer</b>: six agents make about 40 calls. Each re-sends its system prompt and tool schemas, so ~80% of the ~2×10<sup>5</sup> prompt tokens hit the prefix cache and only ~2×10<sup>4</sup> are generated.</p>' +
              '<p>The SLO is interactive (TTFT ≲ 1 s, TPOT ≲ 50 ms). Decode is bound by HBM bandwidth, since every token re-reads all weights plus the KV cache:</p>' +
              '<div class="eq">TPOT ≥ W<sub>bytes</sub> / (n<sub>GPU</sub> · BW<sub>HBM</sub>) = 70 GB / (4 · 3.35 TB/s) ≈ 5 ms</div>' +
              '<p>A batch-1 floor for 70B FP8 on TP4; KV reads, all-reduces and scheduling push real values to 20–50 ms. Batching amortises the weight reads, so one replica serves ~100 streams.</p>'
          },
          {
            say: 'The second is six heavy video jobs, one per shot. Each needs a gang of eight GPUs for over a minute, and nobody cares about the first millisecond, only about total throughput.',
            card: { tag: 'NUMBERS', title: 'Six gangs of eight', stat: { v: '≈ 760', u: 'GPU·s per shot', l: 'eight GPUs held all-or-nothing for ~95 s of denoising' } },
            deep: '<p><b>Video side</b>: one job per 5-second shot. Each denoises a latent of ~75k tokens for 50 steps (Wan-2.1-14B class, 720p, 81 frames) on an exclusive eight-GPU gang. Sequence-parallel attention needs all eight ranks up at once, so a job is admitted <i>all or nothing</i>.</p>' +
              '<p>The SLO is completion in minutes, not milliseconds, and the job is bound by tensor-core FLOPs (attention over ~10<sup>5</sup> tokens), not by HBM. Six such jobs run concurrently:</p>' +
              '<div class="eq">GPU·s<sub>video</sub> ≈ 6 × 8 × 95 s ≈ 4.6×10<sup>3</sup> GPU·s ≈ 76 GPU-min</div>'
          },
          {
            say: 'Put both on one ledger and the video work costs roughly seventy six times more GPU time than all the language calls together. That asymmetry shapes every layer below.',
            card: {
              tag: 'NUMBERS', title: 'Video outweighs language', stat: { v: '≈ 76×', l: 'GPU time of six video shots (≈ 76 GPU-min) versus all ~40 LLM calls (≈ 1 GPU-min)' },
              more: '<p>Where the ~1 GPU-minute comes from: about 4×10⁴ uncached prompt tokens at 10⁴ tok/s per TP4 replica is 4 s × 4 GPUs = 16 GPU·s, and 2×10⁴ output tokens at ~4×10³ tok/s per replica is 5 s × 4 GPUs = 20 GPU·s. Add small-batch inefficiency and the encoders and classifiers, and one GPU-minute is a fair figure.</p>'
            },
            deep: '<p>The two workload classes have opposite physics:</p>' +
              '<table><tr><th></th><th>LLM calls</th><th>Video jobs</th></tr>' +
              '<tr><td>Count / trailer</td><td>~40 (6 agents)</td><td>6 shots</td></tr>' +
              '<tr><td>Unit of work</td><td>prefill + decode tokens</td><td>50 steps × ~75k latent tokens</td></tr>' +
              '<tr><td>SLO</td><td>TTFT ≲ 1 s, TPOT ≲ 50 ms</td><td>completion in minutes</td></tr>' +
              '<tr><td>Bound by</td><td>HBM bandwidth (decode)</td><td>tensor-core FLOPs</td></tr>' +
              '<tr><td>Placement</td><td>shared replica, 1 of ~100 batch slots</td><td>exclusive 8-GPU gang</td></tr></table>' +
              '<div class="eq">GPU·s<sub>video</sub> ≈ 6 × 8 × 95 s ≈ 4.6×10<sup>3</sup> ≫ GPU·s<sub>LLM</sub> ≈ 10<sup>1</sup>–10<sup>2</sup></div>'
          },
          {
            say: 'Follow the two dotted paths down. Small calls will be steered request by request, big jobs will be scheduled as whole blocks, and decisions get faster and more local at every level, from seconds at the top to microseconds at the bottom.',
            card: { tag: 'HOW IT WORKS', title: 'Seconds at the top, microseconds below', body: 'Which region takes seconds. Which node, milliseconds. Which replica and batch slot, an iteration. Which SM, a kernel launch.' },
            deep: '<p>Each layer answers exactly one placement question: <b>which region</b> (global), <b>which node</b> (cluster scheduler), <b>which replica and batch slot</b> (router + engine), <b>which SM</b> (kernel launch). Decisions get faster and more local as you go down:</p>' +
              '<div class="eq">seconds → milliseconds → microseconds</div>' +
              '<p>The amber path is one LLM request: the router picks a replica in &lt; 1 ms, the engine\'s scheduler picks batch slots every ~20 ms iteration, and the GPU\'s hardware scheduler assigns each thread block to an SM in microseconds. The lime path is one shot: a queue admits the gang (seconds), kubelets start eight pods (seconds), then NCCL and CUDA launch kernels (µs).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var p0 = [];
          S.bandsG = ctx.group();
          BANDS.forEach(function (b, i) {
            var g = ctx.group({ parent: S.bandsG });
            ctx.rect(60, b.t, 1115, b.b - b.t, { rx: 8, fill: ctx.alpha('red', 0.025), stroke: ctx.alpha('red', 0.14), sw: 1, parent: g });
            ctx.line(66, b.t + 10, 66, b.b - 10, { color: ctx.alpha('red', 0.7), sw: 2, parent: g });
            var mid = (b.t + b.b) / 2;
            ctx.text(80, mid - 9, b.n, { size: 13, color: 'red', font: 'mono', weight: 700, parent: g });
            ctx.text(80, mid + 9, b.name, { size: 11, color: 'dim', font: 'mono', parent: g });
            p0.push(ctx.reveal(g, { from: 'left', delay: i * 110 }));
          });
          S.ghost = [];
          for (var i = 1; i < 5; i++) {
            var b = BANDS[i];
            var gg = ctx.group();
            ctx.rect(222, b.t + 10, 946, b.b - b.t - 20, { rx: 8, stroke: ctx.alpha('red', 0.35), sw: 1, dash: '5 6', parent: gg });
            ctx.text(695, (b.t + b.b) / 2, GHOST[i], { size: 13, color: 'dim', anchor: 'middle', font: 'mono', parent: gg });
            S.ghost[i] = gg;
            p0.push(ctx.reveal(gg, { delay: 450 + i * 120 }));
          }
          /* beat 0: the five layers */
          return Promise.all(p0).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: LLM calls (orchestrator, 40 cells, first ledger lines) */
            S.orch = ctx.node({ x: 305, y: 195, w: 160, h: 46, title: 'Orchestrator', sub: 'agent crew', icon: 'agent', color: 'magenta', titleSize: 13, subSize: 11 });
            var r = ctx.rng(70);
            S.llmGrid = ctx.matrix(410, 186, 2, 20, { cell: 8, gap: 3, cmap: 'amber', values: function () { return 0.45 + 0.5 * r(); } });
            S.llmLbl = ctx.text(410, 168, '~40 LLM calls · latency-bound', { size: 11, color: 'amber', font: 'mono' });
            S.ledger = ctx.code({ x: 1200, y: 156, w: 365, title: 'trailer.ledger  (one request)', lang: 'text', size: 12, color: 'red', typing: true, maxLines: 9, lines: [] });
            var cells = [];
            S.llmGrid.cells.forEach(function (row) { row.forEach(function (c) { cells.push(c); }); });
            ctx.reveal(S.orch, { from: 'left' });
            ctx.reveal(S.llmLbl, { delay: 200 });
            ctx.reveal(S.ledger, { from: 'right' });
            return Promise.all([
              ctx.reveal(cells, { from: 'fade', dur: 250, stagger: 22, delay: 250 }),
              ctx.wait(300).then(function () {
                return S.ledger.addLine('LLM calls        ~40 across 6 agents').then(function () {
                  return S.ledger.addLine('· prompt tokens  ~2e5 (~80% cached)');
                }).then(function () {
                  return S.ledger.addLine('· output tokens  ~2e4');
                }).then(function () { return S.ledger.addLine('· GPU cost       ~1 GPU-min'); });
              })
            ]).then(function () { return ctx.pulse(S.llmGrid, { color: 'amber', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: six video jobs */
            S.shots = ctx.group();
            S.shotC = [];
            S.shotG = [];
            for (var k = 0; k < 6; k++) {
              var x = 670 + k * 78;
              var sg = ctx.group({ parent: S.shots });
              ctx.rect(x, 182, 66, 30, { rx: 5, fill: ctx.alpha('lime', 0.14), stroke: 'lime', sw: 1.2, parent: sg });
              ctx.text(x + 33, 197, 'shot ' + (k + 1), { size: 11, color: 'lime', anchor: 'middle', font: 'mono', parent: sg });
              S.shotC.push({ x: x + 33, y: 197 });
              S.shotG.push(sg);
            }
            S.vidLbl = ctx.text(670, 168, '6 video jobs · 8 GPUs × ~95 s each · throughput-bound', { size: 11, color: 'lime', font: 'mono' });
            ctx.reveal(S.vidLbl, { delay: 150 });
            return Promise.all([
              ctx.reveal(S.shotG, { from: 'down', dur: 400, stagger: 110 }),
              ctx.wait(350).then(function () {
                return S.ledger.addLine('video jobs       6 shots × 5 s').then(function () {
                  return S.ledger.addLine('· per job        8 GPUs × ~95 s');
                }).then(function () { return S.ledger.addLine('· GPU cost       ~76 GPU-min'); });
              })
            ]).then(function () { return ctx.pulse(S.shots, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the asymmetry on one ledger */
            S.cmp = ctx.group();
            ctx.text(1200, 404, 'GPU-MINUTES PER TRAILER', { size: 12, color: 'red', font: 'display', weight: 700, parent: S.cmp });
            var rows = [['LLM', 1, 'amber'], ['video', 76, 'lime']];
            S.cmpBars = rows.map(function (rw, i) {
              var y = 438 + i * 32, w = Math.max(3, rw[1] / 76 * 250);
              ctx.text(1200, y, rw[0], { size: 12, color: rw[2], font: 'mono', parent: S.cmp });
              ctx.rect(1262, y - 9, 260, 18, { rx: 3, fill: ctx.alpha('white', 0.05), parent: S.cmp });
              var bar = ctx.rect(1262, y - 9, w, 18, { rx: 3, fill: ctx.alpha(rw[2], 0.6), stroke: rw[2], sw: 1, parent: S.cmp });
              bar._w = w;
              ctx.text(1262 + w + 8, y + 0.5, '≈ ' + rw[1], { size: 12, color: rw[2], font: 'mono', weight: 600, parent: S.cmp });
              return bar;
            });
            S.cmpBars.forEach(function (b) { b.setAttribute('width', 0); });
            ctx.reveal(S.cmp, { dur: 300 });
            return Promise.all([
              S.ledger.addLine('bound by         HBM BW  vs  FLOPs').then(function () { return S.ledger.addLine('SLO              TTFT ms vs minutes'); }),
              ctx.animate(S.cmpBars[0], { width: [0, S.cmpBars[0]._w] }, 500, 'out', 200),
              ctx.animate(S.cmpBars[1], { width: [0, S.cmpBars[1]._w] }, 900, 'out', 400)
            ]).then(function () { return ctx.pulse(S.cmpBars[1], { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the descent guides */
            S.drops = ctx.group();
            S.dropA = ctx.path('M518,209 C518,270 300,250 300,330 L300,850', { stroke: ctx.alpha('amber', 0.35), sw: 1.2, dash: '3 6', parent: S.drops });
            S.dropB = ctx.path('M1003,213 C1003,270 1100,250 1100,330 L1100,850', { stroke: ctx.alpha('lime', 0.35), sw: 1.2, dash: '3 6', parent: S.drops });
            return Promise.all([ctx.reveal(S.dropA, { from: 'draw', dur: 900 }), ctx.reveal(S.dropB, { from: 'draw', dur: 900, delay: 150 })]).then(function () {
              return Promise.all([
                ctx.packet(S.dropA, { color: 'amber', dur: 1800, r: 4 }),
                ctx.wait(250).then(function () { return ctx.packet(S.dropA, { color: 'amber', dur: 1600, r: 4 }); }),
                ctx.packet(S.dropB, { color: 'lime', dur: 2400, r: 7, label: '8 GPU' })
              ]);
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Router & scheduler',
        beats: [
          {
            say: 'At the global layer the two kinds of traffic split. Each gets its own door: an inference router for requests, and a scheduler for jobs.',
            card: { tag: 'KEY IDEA', title: 'Two doors, two philosophies', body: 'Requests are pushed through a router in a fraction of a millisecond. Jobs wait in a queue until a whole block of GPUs is available.' },
            deep: '<table><tr><th></th><th>Inference router</th><th>Global scheduler</th></tr>' +
              '<tr><td>Unit</td><td>request (ms–s)</td><td>job / pod group (min–h)</td></tr>' +
              '<tr><td>Decision budget</td><td>&lt; 1 ms, in the data path</td><td>ms–s, off the data path</td></tr>' +
              '<tr><td>State</td><td>replica queue depth, KV-cache contents</td><td>quotas, priorities, free GPUs, topology</td></tr>' +
              '<tr><td>Examples</td><td>Envoy + Gateway API Inference Extension, llm-d, SGLang router, Dynamo</td><td>Kueue, Volcano, Slurm, Ray, Borg-style</td></tr></table>'
          },
          {
            say: 'LLM calls are small and latency critical, so they pass through an inference router that picks a replica in well under a millisecond, ideally one that already caches the agent\'s system prompt.',
            card: {
              tag: 'NUMBERS', title: 'A budget measured in microseconds', stat: { v: '< 1 ms', l: 'routing decision budget: it sits in the data path of every single request' },
              more: '<p>Why not ask every replica for its fresh load on each request? Even an in-datacenter round trip of 0.1–0.5 ms per replica would eat a large part of the budget. Routers therefore read cached metrics refreshed every 10–100 ms, or subscribe to an event stream, and tolerate the staleness.</p>'
            },
            deep: '<p>The <b>router</b> is an L7 proxy with a request-aware policy: Envoy plus the Kubernetes <i>Gateway API Inference Extension</i> (an endpoint picker), llm-d, the SGLang router, or NVIDIA Dynamo. It scores replicas from engine metrics (queue depth, running batch, KV-cache utilisation) and, for prefix affinity, from which KV blocks each replica holds.</p>' +
              '<p>Metrics arrive slightly stale (10–100 ms of scrape or event-bus lag), so the policy must tolerate old information. It must also be O(1) in the number of replicas: 1 ms is already 0.3–0.5% of a 0.2–0.3 s prefix-hit TTFT, so routers use two random probes or a hash lookup, never a scan of the fleet. See <i>Load Balancing</i>.</p>'
          },
          {
            say: 'Video jobs are large and patient, so they enter a scheduler queue. Priority, fair share and quotas decide when each shot gets its block of GPUs.',
            card: { tag: 'HOW IT WORKS', title: 'A queue admits whole gangs', body: 'Each shot is a batch job, not an HTTP call. It waits until quota for all eight GPUs, on one NVLink domain, is free.' },
            deep: '<p>A video shot is submitted as a batch object, not an HTTP call. Kueue wraps the labelled Job in a <code>Workload</code> and admits it only when quota for the whole pod set is free:</p>' +
              '<pre>kind: Workload   # made by Kueue\nspec:\n  queueName: video-batch\n  priorityClassName: interactive-video\n  podSets:\n  - count: 1     # one pod, 8 GPUs\n    topologyRequest:\n      required: kubernetes.io/hostname</pre>' +
              '<p><span class="muted">Abridged: the pod template carries <code>nvidia.com/gpu: 8</code>. Requiring the hostname level keeps the whole gang on one node, i.e. one NVLink domain.</span></p>'
          },
          {
            say: 'Push routing for one, a job queue for the other. The router never holds work, while the scheduler holds it for minutes and releases it only when a whole gang fits.',
            card: { tag: 'TRADE-OFF', title: 'Route the short, schedule the long', body: 'Route what is short and nearly stateless. Schedule what is long and needs exclusive, co-located resources. Mixing the two policies wastes GPUs or breaks the SLO.' },
            deep: '<div class="note">Rule of thumb: <b>route</b> what is short and stateless-ish; <b>schedule</b> what is long and needs exclusive, co-located resources.</div>' +
              '<p>Both doors can share one node inventory, but they must not share one admission logic. In practice the LLM pool and the gang pool are separate node pools, joined by a cohort that lends idle capacity back and forth, with preemption to reclaim it. Each door also has its own child chamber in this atlas.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.ghost[1], 400);
          ctx.fade(S.drops, 0, 400);
          S.glob = ctx.group();
          S.router = ctx.node({ x: 420, y: 288, w: 300, h: 58, title: 'Inference Router', sub: 'L7 · KV/prefix-aware · SLO', icon: 'net', color: 'blue', parent: S.glob });
          S.sched = ctx.node({ x: 858, y: 288, w: 300, h: 58, title: 'Global Scheduler', sub: 'priority · fair share · gangs', icon: 'queue', color: 'red', parent: S.glob });
          ctx.hotspot(S.router, 'load-balancing');
          ctx.hotspot(S.sched, 'scheduler');
          /* beat 0: the two doors */
          return Promise.all([ctx.reveal(S.router, { from: 'up' }), ctx.reveal(S.sched, { from: 'up', delay: 150 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: LLM calls take the router */
            S.lk1 = ctx.link(S.llmGrid, S.router, { color: 'amber', from: 'b', to: 't', parent: S.glob, label: 'push · per request', labelDx: -125, labelDy: 8 });
            return Promise.all([ctx.reveal(S.lk1, { from: 'draw', dur: 700 }), ctx.reveal(S.lk1.labelEl, { delay: 500 })]).then(function () {
              return Promise.all([
                ctx.packet(S.lk1, { color: 'amber', dur: 700, label: 'chat()' }),
                ctx.wait(300).then(function () { return ctx.packet(S.lk1, { color: 'amber', dur: 700 }); }),
                ctx.wait(600).then(function () { return ctx.packet(S.lk1, { color: 'amber', dur: 700 }); })
              ]);
            }).then(function () {
              S.lkStream = ctx.stream(S.lk1, { color: 'amber', count: 3, period: 1400, r: 3 });
              return ctx.pulse(S.router, { color: 'blue', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: video jobs queue up at the scheduler */
            S.qG = ctx.group({ parent: S.glob });
            S.qLbl = ctx.text(1101, 258, 'job queue', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: S.qG });
            for (var i = 0; i < 6; i++) ctx.rect(1040 + i * 21, 272, 17, 32, { rx: 3, stroke: ctx.alpha('lime', 0.45), sw: 1, dash: '3 3', parent: S.qG });
            ctx.reveal(S.qG, { delay: 100 });
            S.qItems = [];
            for (var k = 0; k < 6; k++) {
              var g = ctx.group({ parent: S.glob });
              ctx.rect(-8, -13, 16, 26, { rx: 3, fill: ctx.alpha('lime', 0.55), stroke: 'lime', sw: 1, parent: g });
              ctx.place(g, S.shotC[k].x, S.shotC[k].y);
              S.qItems.push(g);
            }
            ctx.fade(S.shots, 0.35, 600);
            return Promise.all(S.qItems.map(function (g, k) {
              return ctx.transform(g, { x: 1040 + k * 21 + 8.5, y: 288 }, 800, 'inOut', 200 + k * 160);
            })).then(function () { return ctx.pulse(S.sched, { color: 'red', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the scheduler releases whole gangs; the router keeps pushing */
            S.qLbl.textContent = 'admit whole gangs';
            return Promise.all([0, 1].map(function (i) {
              return ctx.transform(S.qItems[i], { x: 1000, y: 288 }, 700, 'inOut', i * 350).then(function () {
                return ctx.fadeOut(S.qItems[i], 250, true);
              });
            })).then(function () { return ctx.pulse(S.sched, { color: 'lime', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Regional clusters',
        beats: [
          {
            say: 'Next, the global layer picks a region. Each region runs Kubernetes clusters, and a cluster owns a set of nodes, their drivers and their network.',
            card: { tag: 'KEY IDEA', title: 'A region is a Kubernetes fleet', body: 'Every cluster runs the GPU Operator, exposes GPUs through the device plugin or DRA, and labels nodes by GPU type and NVLink domain.' },
            deep: '<p>Per-cluster software stack: NVIDIA <b>GPU Operator</b> (driver, container toolkit, device plugin, DCGM exporter), GPUs exposed via the device plugin or <b>DRA</b> (Dynamic Resource Allocation, GA in Kubernetes 1.34), node labels for GPU type, NVLink domain and IB rail.</p>' +
              '<p>Multi-cluster dispatch is a layer above: Kueue <i>MultiKueue</i>, Karmada, or a bespoke global scheduler that sees every cluster\'s free capacity and quota. The clusters shown here are illustrative pools of a studio-sized fleet.</p>'
          },
          {
            say: 'Each cluster has node pools of different accelerators: H100 and H200 servers, newer B200 nodes, and GB200 NVL72 racks where seventy two GPUs share one NVLink domain.',
            card: { tag: 'NUMBERS', title: 'One rack, one NVLink domain', stat: { v: '72', u: 'GPUs', l: 'in a single NVLink domain on a GB200 NVL72 rack, versus 8 on an HGX server' } },
            deep: '<p>Heterogeneous pools are normal. Each pool has a job it is best at:</p>' +
              '<table><tr><th>Pool</th><th>Memory</th><th>Typical role</th></tr>' +
              '<tr><td>L40S</td><td>48 GB GDDR6, 0.86 TB/s</td><td>encoders, VAE decode, safety classifiers</td></tr>' +
              '<tr><td>H100 / H200</td><td>80 GB HBM3 (3.35 TB/s) / 141 GB HBM3e (4.8 TB/s)</td><td>LLM prefill and decode</td></tr>' +
              '<tr><td>B200</td><td>180–192 GB HBM3e, 8 TB/s</td><td>DiT FLOPs, FP4 inference</td></tr>' +
              '<tr><td>GB200 NVL72</td><td>~13.4 TB HBM3e per rack</td><td>sequence parallelism beyond 8 GPUs, big MoE</td></tr></table>'
          },
          {
            say: 'The choice weighs free capacity, network latency to the user, data residency, price, and whether the model weights are already warm there.',
            card: { tag: 'HOW IT WORKS', title: 'Hard constraints, then soft scores', body: 'Residency, quota and model availability filter regions first. Only then do capacity, latency, price and warm weights rank the survivors.' },
            deep: '<p>Region choice is constrained optimisation over normalised terms, each scaled to 0–1:</p>' +
              '<div class="eq">r* = argmax<sub>r ∈ feasible</sub> [ w<sub>1</sub>·free(r) − w<sub>2</sub>·RTT(r) − w<sub>3</sub>·price(r) + w<sub>4</sub>·warm(r) ]</div>' +
              '<p>Hard constraints (residency, model availability, quota) define the feasible set; soft scores rank what is left. The weights w<sub>i</sub> are per workload class, which is the next beat.</p>' +
              '<details><summary>Go deeper</summary><p>Why filter first and score second? A hard constraint such as data residency can never be traded against price, so it must not appear as a weight. Scores need scaling too: RTT over 150 ms, price relative to the dearest region, free capacity as a fraction of the pool. Multi-cluster schedulers such as Karmada use the same filter-then-score shape that kube-scheduler applies per node.</p></details>'
          },
          {
            say: 'LLM calls stay close to the user. Video jobs can travel to wherever GPUs sit idle, because a few extra milliseconds mean nothing to a ninety second render.',
            card: {
              tag: 'TRADE-OFF', title: 'Latency for LLM, capacity for video', body: 'A cross-continent round trip of 80–150 ms eats a big slice of a one second TTFT budget, but vanishes against 95 seconds of denoising.',
              more: '<p>Light in fibre covers about 200 km per millisecond, so an 8,000 km path is ≈ 40 ms one way and ≈ 80 ms round trip before any queueing; real routes add detours, giving 80–150 ms. That is 8–15% of a 1 s TTFT budget, but under 0.2% of a 95 s render.</p>'
            },
            deep: '<p>For interactive LLM traffic w<sub>2</sub> dominates (cross-continent RTT ≈ 80–150 ms is a large slice of a 1 s TTFT budget). For video jobs RTT is noise next to ~95 s of compute, so capacity and price dominate: <b>follow the idle GPUs</b>. Regions in their local night have spare capacity, so batch video follows the sun.</p>' +
              '<p>The weights in the panel are illustrative. Warm weights matter for both: a cold region needs minutes to load hundreds of gigabytes (step six).</p>' +
              '<div class="note">Heterogeneous pools are normal: L40S-class cards for VAE decode, encoders and safety classifiers; H100/H200 for LLM decode; B200 / GB200 for DiT FLOPs.</div>'
          },
          {
            say: 'Try it yourself. Click LLM or video under the score panel. The same four clusters and the same four terms, with different weights, send interactive language calls near the user and batch video to the region with idle, cheap GPUs.',
            card: { tag: 'TRY IT', title: 'Flip the workload class', body: 'Click <b>LLM</b> or <b>video</b>. The scores are recomputed from the same four terms, and the winning region moves from us-east to eu-west.' },
            deep: '<p>The scores behind the bars (illustrative numbers; RTT is scaled by 150 ms):</p>' +
              '<table><tr><th>region</th><th>free</th><th>RTT</th><th>price</th><th>LLM</th><th>video</th></tr>' +
              '<tr><td>us-east</td><td>0.14</td><td>20 ms</td><td>1.0</td><td><b>+0.05</b></td><td>−0.23</td></tr>' +
              '<tr><td>us-central</td><td>0.36</td><td>45 ms</td><td>0.9</td><td>0.00</td><td>+0.08</td></tr>' +
              '<tr><td>eu-west</td><td>0.66</td><td>110 ms</td><td>0.7</td><td>−0.34</td><td><b>+0.29</b></td></tr></table>' +
              '<p>The LLM weights are resident in us-east and us-central, the video model in us-central and eu-west. Video in eu-west: 0.5·0.66 − 0.02·0.73 − 0.3·0.7 + 0.18 = 0.29. The winner flips because the weights changed, not the regions.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.ghost[2], 400);
          if (S.lkStream) S.lkStream.stop();
          S.reg = ctx.group();
          S.cl = [];
          S.poolG = [];
          S.utilBars = [];
          CLUSTERS.forEach(function (c, i) {
            var n = ctx.node({ x: c.x, y: 402, w: 270, h: 104, color: 'red', parent: S.reg });
            var x0 = c.x - 135;
            ctx.icon('server', x0 + 24, 368, 18, 'red', { parent: n });
            ctx.text(x0 + 40, 368, c.name, { size: 13, weight: 600, color: 'white', font: 'display', parent: n });
            S.cl.push(n);
          });
          S.rl = [
            ctx.link(S.router, S.cl[0], { color: 'blue', from: 'b', to: 't', parent: S.reg }),
            ctx.link(S.router, S.cl[1], { color: 'blue', from: 'b', to: 't', parent: S.reg }),
            ctx.link(S.sched, S.cl[1], { color: 'red', from: 'b', to: 't', parent: S.reg }),
            ctx.link(S.sched, S.cl[2], { color: 'red', from: 'b', to: 't', parent: S.reg })
          ];
          /* beat 0: the clusters */
          return Promise.all([
            ctx.reveal(S.cl, { from: 'up', stagger: 160 }),
            ctx.reveal(S.rl, { from: 'draw', delay: 500, stagger: 120 })
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: node pools in every cluster */
            CLUSTERS.forEach(function (c, i) {
              var x0 = c.x - 135;
              var pg = ctx.group({ parent: S.cl[i] });
              c.pools.forEach(function (p, j) {
                var y = 391 + j * 20;
                ctx.rect(x0 + 16, y - 4, 8, 8, { rx: 2, fill: p[1], parent: pg });
                ctx.text(x0 + 32, y, p[0], { size: 11, font: 'mono', color: 'text', parent: pg });
                ctx.rect(x0 + 192, y - 4, 64, 8, { rx: 3, fill: ctx.alpha('white', 0.07), parent: pg });
                S.utilBars.push({ el: ctx.rect(x0 + 192, y - 4, 40, 8, { rx: 3, fill: ctx.alpha(p[1], 0.85), parent: pg }), c: i });
              });
              S.poolG.push(pg);
            });
            S.utilLoop = ctx.loop(function (t) {
              S.utilBars.forEach(function (b, k) {
                b.el.setAttribute('width', (64 * (UTIL[b.c] + 0.08 * Math.sin(t * 0.7 + k * 1.3))).toFixed(1));
              });
            });
            return ctx.reveal(S.poolG, { from: 'left', dur: 500, stagger: 160 }).then(function () {
              return ctx.pulse(S.cl[2], { color: 'red', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: what the region score looks at */
            S.scoreG = ctx.group();
            ctx.text(1200, 522, 'REGION SCORE · per-class weights', { size: 12, color: 'red', font: 'display', weight: 700, parent: S.scoreG });
            S.facRows = [['free GPU capacity', 0.2, 0.5], ['RTT to the user', 0.6, 0.02], ['price per GPU-hour', 0.05, 0.3], ['weights already warm', 0.15, 0.18]];
            S.facTxt = S.facRows.map(function (f, i) {
              var y = 556 + i * 28;
              ctx.circle(1208, y, 3.5, { fill: 'red', parent: S.scoreG });
              return ctx.text(1220, y, f[0], { size: 11, color: 'text', font: 'mono', parent: S.scoreG });
            });
            ctx.rect(1200, 662, 300, 22, { rx: 11, fill: ctx.alpha('pink', 0.1), stroke: ctx.alpha('pink', 0.7), sw: 1, parent: S.scoreG });
            ctx.text(1350, 673, 'hard filter: residency · quota · model', { size: 11, color: 'pink', anchor: 'middle', font: 'mono', parent: S.scoreG });
            return ctx.reveal(S.scoreG, { from: 'right', dur: 600 }).then(function () { return ctx.pulse(S.router, { color: 'red', dur: 500 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: LLM stays close, video follows idle GPUs */
            S.wBars = [];
            S.facRows.forEach(function (f, i) {
              var y = 556 + i * 28;
              [[f[1], 'amber', -4], [f[2], 'lime', 4]].forEach(function (q) {
                var w = Math.max(3, q[0] * 200);
                var bar = ctx.rect(1372, y + q[2] - 3, w, 6, { rx: 2, fill: ctx.alpha(q[1], 0.75), parent: S.scoreG });
                bar._w = w;
                S.wBars.push(bar);
              });
            });
            S.wBars.forEach(function (b) { b.setAttribute('width', 0); });
            S.wLeg = ctx.text(1200, 704, 'amber = LLM weights · lime = video weights', { size: 11, color: 'dim', font: 'mono', parent: S.scoreG });
            ctx.reveal(S.wLeg, { delay: 200 });
            S.hlLLM = ctx.highlight(S.cl[0], { color: 'amber', pad: 6 });
            S.hlVid = ctx.highlight(S.cl[2], { color: 'lime', pad: 6 });
            return Promise.all(S.wBars.map(function (b, i) { return ctx.animate(b, { width: [0, b._w] }, 600, 'out', i * 80); })).then(function () {
              return Promise.all([
                ctx.packet(S.rl[0], { color: 'amber', dur: 600 }),
                ctx.wait(200).then(function () { return ctx.packet(S.rl[0], { color: 'amber', dur: 600 }); }),
                ctx.wait(400).then(function () { return ctx.packet(S.rl[3], { color: 'lime', dur: 900, r: 6 }); })
              ]);
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4 (TRY IT): the same four terms scored with either class's weights */
            var REG = ['us-east', 'us-central', 'eu-west'], RTT = [20, 45, 110], PRICE = [1.0, 0.9, 0.7];
            var WARM = { llm: [1, 1, 0], vid: [0, 1, 1] };
            var X0 = 1408, K = 300;
            var g = ctx.group({ parent: S.scoreG });
            ctx.text(1200, 728, 'TRY IT · pick a workload class', { size: 11, color: 'dim', font: 'mono', parent: g });
            ctx.line(X0, 780, X0, 866, { color: ctx.alpha('white', 0.3), sw: 1, parent: g });
            var rows = REG.map(function (nm, i) {
              var y = 797 + i * 28;
              ctx.text(1200, y, nm, { size: 11, color: 'text', font: 'mono', parent: g });
              var bar = ctx.rect(X0, y - 8, 0, 16, { rx: 3, fill: ctx.alpha('faint', 0.45), stroke: 'faint', sw: 1, parent: g });
              var val = ctx.text(1552, y, '', { size: 12, color: 'text', font: 'mono', weight: 600, anchor: 'end', parent: g });
              return { bar: bar, val: val };
            });
            function score(cls, r) {
              var wi = cls === 'llm' ? 1 : 2, f = S.facRows;
              return f[0][wi] * (1 - UTIL[r]) - f[1][wi] * RTT[r] / 150 - f[2][wi] * PRICE[r] + f[3][wi] * WARM[cls][r];
            }
            S.pickCls = function (cls, animate) {
              var sc = [0, 1, 2].map(function (r) { return score(cls, r); });
              var best = sc.indexOf(Math.max.apply(null, sc)), col = cls === 'llm' ? 'amber' : 'lime', ps = [];
              rows.forEach(function (rw, r) {
                var w = Math.abs(sc[r]) * K, x = sc[r] >= 0 ? X0 : X0 - w, win = r === best;
                rw.bar.setAttribute('fill', win ? ctx.alpha(col, 0.7) : ctx.alpha('faint', 0.45));
                rw.bar.setAttribute('stroke', ctx.color(win ? col : 'faint'));
                rw.val.setAttribute('fill', ctx.color(win ? col : 'text'));
                rw.val.textContent = (sc[r] > 0.004 ? '+' : (sc[r] < -0.004 ? '−' : '')) + Math.abs(sc[r]).toFixed(2);
                if (animate) ps.push(ctx.animate(rw.bar, { x: [parseFloat(rw.bar.getAttribute('x')), x], width: [parseFloat(rw.bar.getAttribute('width')), w] }, 500, 'out'));
                else { rw.bar.setAttribute('x', x); rw.bar.setAttribute('width', w); }
              });
              S.hlLLM.setAttribute('opacity', cls === 'llm' ? 1 : 0.2);
              S.hlVid.setAttribute('opacity', cls === 'llm' ? 0.2 : 1);
              S.clsChips.forEach(function (c) { c.el.setAttribute('opacity', c.k === cls ? 1 : 0.45); });
              S.cls = cls; S.best = best;
              S.clsBusy = true;
              return Promise.all(ps).then(function () { S.clsBusy = false; });
            };
            S.clsChips = [['llm', 'LLM', 'amber', 1262], ['vid', 'video', 'lime', 1352]].map(function (c) {
              var l = ctx.label(c[3], 756, c[1], { color: c[2], size: 12, w: 76, parent: g });
              l.style.cursor = 'pointer';
              l.addEventListener('click', function () {
                if (ctx.dead || S.clsBusy || S.cls === c[0]) return;
                S.pickCls(c[0], true);
                ctx.pulse(S.cl[S.best], { color: c[2], dur: 600 });
              });
              return { el: l, k: c[0] };
            });
            S.pickCls('llm', false);
            ctx.reveal(g, { dur: 400 });
            return ctx.wait(1000).then(function () { return S.pickCls('vid', true); }).then(function () {
              return ctx.pulse(S.cl[S.best], { color: 'lime', dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Inference servers',
        beats: [
          {
            say: 'Inside a cluster, pods run inference servers. For language models these are engines like vLLM, SGLang or TensorRT LLM, each serving one model replica across a tensor parallel group of GPUs.',
            card: { tag: 'KEY IDEA', title: 'Three engines, one contract', body: 'vLLM, SGLang and TensorRT-LLM all take requests in and stream tokens out. They differ in scheduler, kernels and quantisation, not in the basic idea.' },
            deep: '<p><b>LLM engines</b> run one model replica per pod, sharded over a tensor-parallel group: vLLM on 4×H100 (TP4, FP8 weights), SGLang on 8×H200 (TP8), TensorRT-LLM on 4×B200 (TP4, FP4). All three share the same core ideas:</p>' +
              '<ul><li><b>continuous batching</b>: requests are admitted and retired at every decode iteration;</li>' +
              '<li><b>PagedAttention</b>: KV cache in fixed-size blocks;</li>' +
              '<li><b>prefix caching</b> across requests (vLLM block hashing, SGLang radix tree);</li>' +
              '<li><b>chunked prefill</b>, to bound the stall a long prompt inflicts on running decodes.</li></ul>' +
              '<p>The outside contract is an OpenAI-compatible HTTP or gRPC endpoint: a request in, a token stream out.</p>'
          },
          {
            say: 'They keep a continuous batch of many requests on the GPU, admitting new ones at every decode step. Attention keys and values live in a paged KV cache, and tokens stream back as they are produced.',
            card: { tag: 'NUMBERS', title: 'The KV cache is the budget', stat: { v: '≈ 320', u: 'KB per token', l: 'of KV cache for a 70B GQA model in BF16, so one 30k-token prompt pins about 10 GB' } },
            deep: '<p><b>Continuous (iteration-level) batching</b> admits a new request whenever a slot and KV blocks are free, so a replica runs ~100 concurrent streams and never waits for the slowest member of a batch. <b>PagedAttention</b> stores KV in fixed 16-token blocks addressed through a per-request block table, like virtual memory: in the paper\'s measurements under 4% of KV memory is wasted (against 60–80% in earlier systems), and blocks can be shared or copied on write.</p>' +
              '<div class="eq">KV/token = 2 · n<sub>layers</sub> · n<sub>kv</sub> · d<sub>head</sub> · bytes = 2·80·8·128·2 B ≈ 320 KB   (70B-class, GQA, BF16)</div>' +
              '<p>A radix-tree <b>prefix cache</b> keeps the KV blocks of shared system prompts alive, which is how ~80% of the trailer\'s prompt tokens cost nothing.</p>'
          },
          {
            say: 'Video models run in custom diffusion transformer servers. One job owns a whole eight GPU gang, exclusively, with no sharing and no batching across users.',
            card: { tag: 'KEY IDEA', title: 'One job owns the gang', body: 'A DiT worker is a job server, not a request server: weights stay resident, and one shot at a time runs across eight GPUs.' },
            deep: '<p><b>Video DiT server</b> (e.g. Wan-2.1-14B): a long-lived worker that keeps the weights resident (DiT ≈ 28 GB BF16, text encoder ≈ 11 GB, VAE ≈ 0.5 GB) and pulls one job at a time from a queue. Eight ranks run <b>sequence parallelism</b> (Ulysses-style all-to-all over heads), and the two classifier-free-guidance branches are batched together.</p>' +
              '<p>There is no cross-user batching: a single 75k-token sequence already saturates the tensor cores, so batching adds latency, not throughput. The unit of scheduling is therefore a <i>gang</i>, and the unit of failure is the whole job.</p>'
          },
          {
            say: 'The worker loops over fifty denoising steps on a latent of about seventy five thousand tokens, then decodes it to pixels with the VAE.',
            card: { tag: 'NUMBERS', title: 'A latent of 75,600 tokens', stat: { v: '75.6k', u: 'tokens', l: 'latent 16×21×90×160, patchified 1×2×2, for an 81-frame 720p shot' }, more: '<p>Wan\'s VAE compresses 4× in time and 8× in each spatial dimension: 81 frames become 1 + 80/4 = 21 latent frames, 720 becomes 90 and 1280 becomes 160, with 16 channels. The 1×2×2 patchify halves each spatial side, leaving 45 × 80 tokens per frame.</p>' },
            deep: '<p>VAE latent for an 81-frame 720p clip, then patchified for the transformer:</p>' +
              '<div class="eq">z ∈ ℝ<sup>16×21×90×160</sup> &nbsp;→ patch 1×2×2 →&nbsp; N = 21 · 45 · 80 = 75,600 tokens (d = 5120)</div>' +
              '<pre>z = randn(16, 21, 90, 160)\nfor t in schedule(50):\n    c = dit(z, t, text)\n    u = dit(z, t, null)     # CFG\n    g = u + s * (c - u)\n    z = solver_step(z, g, t)\nframes = vae.decode(z)\n# 81 x 720 x 1280 x 3 pixels</pre>' +
              '<p>Wan is a flow-matching (rectified-flow) model, so <code>solver_step</code> integrates a learned velocity field with a UniPC or DPM-Solver++ update; a guidance scale s of about 5 is typical.</p>'
          },
          {
            say: 'Each denoising step costs several petaflops of attention and matrix multiplies, doubled by classifier free guidance. That is why one shot needs a full gang and about a minute and a half of wall clock time.',
            card: { tag: 'NUMBERS', title: 'The compute bill of one shot', stat: { v: '6.8×10¹⁷', u: 'FLOP', l: '50 steps × 2 CFG branches × 6.8 PFLOP, about 95 s on 8×B200 at roughly 40% MFU' } },
            deep: '<p>FLOPs per transformer forward (one denoising step, one CFG branch), with P = 14×10<sup>9</sup> parameters, L = 40 layers, d = 5120, N = 75.6k:</p>' +
              '<div class="eq">F ≈ 2·N·P + 4·L·N²·d ≈ 2.1 + 4.7 ≈ 6.8 PFLOP &nbsp;(×2 with CFG)</div>' +
              '<p>Attention already outweighs the matrix multiplies (the N² term). 50 steps × 2 branches × 6.8 PF ≈ 6.8×10<sup>17</sup> FLOP. Eight B200s deliver ~18 PFLOP/s dense BF16 (2.25 each), so ~95 s is a model-FLOPs utilisation of about 40%: the all-to-alls, norms, RoPE and softmax take the rest. The same shot on 8×H100 (~1 PF each) would need ≈ 215 s at that MFU. Hence gangs, sequence parallelism, step distillation and caching (see <i>Video Model Serving</i>). This is the 75,600-token, 16 fps basis; the atlas’s longer 111,600-token, 24 fps clip on H100s reaches the same ~95 s only with a lighter sampler (about 4× less work, see <i>Video Generation Models</i>).</p>' +
              '<details><summary>Go deeper</summary><p>MFU = (model FLOPs per second) / (peak FLOPs per second). Here: 6.8×10<sup>17</sup> / 95 s = 7.2 PFLOP/s achieved, against 8 × 2.25 = 18 PFLOP/s peak, so MFU = 0.40. Fused attention kernels span roughly 35% (FlashAttention-2 on H100) to 75% (FlashAttention-3, best case) of peak, and large matrix multiplies usually do better than half; what pulls the whole step down to 40% is communication that is not hidden, small-kernel overhead and the CFG batch bookkeeping. The 40% is an assumption that reproduces the running example, not a measurement.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.ghost[3], 400);
          ctx.fade([S.ledger, S.cmp, S.scoreG], 0.3, 500);   /* the earlier side panels recede while the servers take over */
          S.scoreG.style.pointerEvents = 'none';
          S.serv = ctx.group();
          S.engG = [];
          /* LLM engines (titles first; batch slots and KV meter come in the next beat) */
          ENGINES.forEach(function (e, i) {
            var x0 = 232 + i * 138, g = ctx.group({ parent: S.serv });
            ctx.rect(x0, 486, 128, 100, { rx: 8, fill: 'url(#fx-panel-grad)', stroke: 'amber', sw: 1.3, parent: g });
            ctx.text(x0 + 10, 502, e[0], { size: 14, weight: 600, color: 'white', font: 'display', parent: g });
            ctx.text(x0 + 10, 520, e[1], { size: 11, color: 'amber', font: 'mono', parent: g });
            S.engG.push(g);
          });
          S.llmBox = ctx.node({ x: 434, y: 536, w: 424, h: 118, kind: 'ghost', color: 'amber', parent: S.serv });
          ctx.hotspot(S.llmBox, 'llm-serving', { hint: 'LLM SERVING ⤢' });
          S.sl = [ctx.link(S.cl[0], S.llmBox, { color: 'amber', from: 'b', to: 't', parent: S.serv })];
          /* beat 0: engines */
          return Promise.all([
            ctx.reveal(S.engG, { from: 'up', stagger: 120 }),
            ctx.reveal(S.llmBox, { delay: 400 }),
            ctx.reveal(S.sl[0], { from: 'draw', delay: 500 })
          ]).then(function () {
            return ctx.packet(S.sl[0], { color: 'amber', dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: continuous batch + paged KV cache */
            S.kv = []; S.slots = [];
            ENGINES.forEach(function (e, i) {
              var x0 = 232 + i * 138, g = S.engG[i];
              var kg = ctx.group({ parent: g });
              ctx.text(x0 + 10, 540, 'KV', { size: 11, color: 'dim', font: 'mono', parent: kg });
              ctx.rect(x0 + 32, 536, 86, 8, { rx: 3, fill: ctx.alpha('white', 0.07), parent: kg });
              S.kv.push(ctx.rect(x0 + 32, 536, 60, 8, { rx: 3, fill: ctx.alpha('amber', 0.85), parent: kg }));
              var row = [];
              for (var s = 0; s < 8; s++) row.push(ctx.rect(x0 + 10 + s * 13, 556, 10, 16, { rx: 2, fill: ctx.alpha('amber', 0.3), parent: kg }));
              S.slots.push(row);
              ctx.reveal(kg, { from: 'up', dist: 10, delay: i * 120 });
            });
            S.kvChip = ctx.label(434, 626, 'KV ≈ 320 KB per token', { color: 'amber', size: 11 });
            ctx.reveal(S.kvChip, { from: 'down', delay: 300 });
            var lastTick = -1;
            S.llmLoop = ctx.loop(function (t) {
              var tick = Math.floor(t * 5);
              if (tick === lastTick) return;
              lastTick = tick;
              S.slots.forEach(function (row, i) {
                row.forEach(function (el, s) {
                  var on = ((tick * 7 + s * 13 + i * 5) % 11) > 2;
                  el.setAttribute('fill', on ? ctx.alpha('amber', 0.55 + 0.4 * (((s + tick + i) % 3) / 2)) : ctx.alpha('amber', 0.12));
                });
                S.kv[i].setAttribute('width', (86 * (0.6 + 0.3 * Math.abs(Math.sin(tick * 0.09 + i)))).toFixed(1));
              });
            });
            return ctx.wait(1400);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: DiT workers, one gang each */
            S.dit = [];
            [2, 3].forEach(function (shot, i) {
              var x0 = 668 + i * 250, g = ctx.group({ parent: S.serv });
              ctx.rect(x0, 486, 238, 100, { rx: 8, fill: 'url(#fx-panel-grad)', stroke: 'lime', sw: 1.3, parent: g });
              ctx.text(x0 + 10, 502, 'DiT worker · shot ' + shot, { size: 13, weight: 600, color: 'white', font: 'display', parent: g });
              ctx.text(x0 + 10, 520, '8×B200 · SP8 · CFG-batch', { size: 11, color: 'lime', font: 'mono', parent: g });
              S.dit.push(g);
            });
            S.vidBox = ctx.node({ x: 912, y: 536, w: 500, h: 118, kind: 'ghost', color: 'lime', parent: S.serv });
            ctx.hotspot(S.vidBox, 'video-serving', { hint: 'VIDEO SERVING ⤢' });
            S.sl.push(ctx.link(S.cl[2], S.vidBox, { color: 'lime', from: 'b', to: 't', parent: S.serv }));
            return Promise.all([
              ctx.reveal(S.dit, { from: 'up', stagger: 140 }),
              ctx.reveal(S.vidBox, { delay: 300 }),
              ctx.reveal(S.sl[1], { from: 'draw', delay: 400 })
            ]).then(function () { return ctx.packet(S.sl[1], { color: 'lime', dur: 700, r: 6 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the denoising loop over a 75.6k-token latent */
            S.prog = []; S.stepTxt = []; S.lat = [];
            var rn = ctx.rng(74);
            S.noise = [];
            for (var q = 0; q < 42; q++) S.noise.push(rn());
            S.dit.forEach(function (g, i) {
              var x0 = 668 + i * 250;
              var pg = ctx.group({ parent: g });
              ctx.rect(x0 + 10, 534, 150, 8, { rx: 3, fill: ctx.alpha('white', 0.07), parent: pg });
              S.prog.push(ctx.rect(x0 + 10, 534, 60, 8, { rx: 3, fill: ctx.alpha('lime', 0.85), parent: pg }));
              S.stepTxt.push(ctx.text(x0 + 168, 538, 'step 21/50', { size: 11, color: 'text', font: 'mono', parent: pg }));
              S.lat.push(ctx.matrix(x0 + 10, 552, 3, 14, { cell: 7, gap: 2, cmap: 'lime', values: function () { return 0.3; }, parent: pg }));
              ctx.text(x0 + 144, 558, '75.6k tokens', { size: 11, color: 'dim', font: 'mono', parent: pg });
              ctx.text(x0 + 144, 574, '21×45×80', { size: 11, color: 'dim', font: 'mono', parent: pg });
              ctx.reveal(pg, { from: 'up', dist: 10, delay: i * 140 });
            });
            var lastStep = [-1, -1];
            S.ditLoop = ctx.loop(function (t) {
              [0, 1].forEach(function (i) {
                var st = Math.floor((t * 2.75 + i * 21) % 50) + 1;
                if (st === lastStep[i]) return;
                lastStep[i] = st;
                var k = st / 50;
                S.prog[i].setAttribute('width', (150 * k).toFixed(1));
                S.stepTxt[i].textContent = 'step ' + st + '/50';
                S.lat[i].set(function (r, c) {
                  var clean = 0.5 + 0.45 * Math.sin(c * 0.55 + r * 0.9 + i);
                  return (1 - k) * S.noise[r * 14 + c] + k * clean;
                });
              });
            });
            return ctx.wait(1800);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the FLOP bill */
            S.flopChip = ctx.label(912, 626, 'F ≈ 6.8 PFLOP per step  ×  2 CFG', { color: 'lime', size: 11 });
            ctx.reveal(S.flopChip, { from: 'down' });
            ctx.hud('≈ 6.8e17 FLOP per shot · ~95 s on 8×B200');
            return Promise.all([ctx.pulse(S.dit[0], { color: 'lime', dur: 700 }), ctx.pulse(S.dit[1], { color: 'lime', dur: 700 })]).then(function () {
              return ctx.wait(500);
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'GPUs & fabrics',
        beats: [
          {
            say: 'Zoom into the metal. An HGX H100 server has eight GPUs with eighty gigabytes of HBM each, fully connected through NVSwitch at nine hundred gigabytes per second per GPU, counting both directions.',
            card: { tag: 'NUMBERS', title: 'Eight GPUs, one crossbar', stat: { v: '900 GB/s', l: 'NVLink 4 bandwidth per H100, every GPU reaching every other through NVSwitch' } },
            deep: '<p>An <b>HGX H100</b> baseboard carries eight SXM5 GPUs (132 SMs and 80 GB of HBM3 at 3.35 TB/s each) and four NVSwitch chips forming an all-to-all crossbar. Any GPU reaches any other at full NVLink 4 rate: 18 links × 50 GB/s = 900 GB/s bidirectional per GPU.</p>' +
              '<table><tr><th>Link</th><th>Bandwidth (per GPU)</th><th>Scope</th></tr>' +
              '<tr><td>HBM3 (H100) / HBM3e (B200)</td><td>3.35 / 8 TB/s</td><td>on package</td></tr>' +
              '<tr><td>NVLink 4</td><td>900 GB/s (bidir.)</td><td>8 GPUs</td></tr></table>'
          },
          {
            say: 'A GB200 NVL72 rack stretches that NVLink domain to seventy two GPUs, with thirty six Grace CPUs and nine switch trays, all liquid cooled.',
            card: { tag: 'NUMBERS', title: 'A rack that acts like one GPU', stat: { v: '130 TB/s', l: 'aggregate NVLink bandwidth inside one NVL72 rack: 72 GPUs × 1.8 TB/s' } },
            deep: '<p><b>GB200 NVL72</b>: 18 compute trays (each two Grace CPUs and four Blackwell GPUs) plus 9 NVSwitch trays, joined by a copper cable spine into one NVLink 5 domain. 72 GPUs, 36 Grace CPUs, ~13.4 TB of HBM3e, ~120 kW of cooling capacity, liquid cooled.</p>' +
              '<table><tr><th>Link</th><th>Bandwidth (per GPU)</th><th>Scope</th></tr>' +
              '<tr><td>NVLink 5</td><td>1.8 TB/s (bidir.)</td><td>72 GPUs (NVL72)</td></tr></table>' +
              '<p>It matters because sequence-parallel groups of 16–64 GPUs and expert-parallel all-to-alls can now stay on NVLink instead of dropping to the network.</p>'
          },
          {
            say: 'Our video shots run on HGX B200 servers: eight Blackwell GPUs with sequence parallelism, exchanging activations over fifth generation NVLink at one point eight terabytes per second per GPU, counting both directions.',
            card: { tag: 'KEY IDEA', title: 'A shot is one NVLink domain', body: 'Sequence parallel ranks trade activations at every layer, so the gang must sit inside a single NVLink domain, ideally one server.' },
            deep: '<p>A video gang doing Ulysses all-to-all moves ≈ 0.34 GB per GPU per layer (N/p · d · 2 B · 4 tensors · 7/8, with N = 75.6k, d = 5120, p = 8). On NVLink 5 at 900 GB/s per direction:</p>' +
              '<div class="eq">0.34 GB / 900 GB/s ≈ 0.38 ms per layer ≈ 1.5 s per shot (40 layers × 100 forwards)</div>' +
              '<p>That is under 2% of the ~95 s compute. The video gang is the workload that most needs the fast fabric; LLM decode with TP4 also lives on it, but with far smaller messages.</p>'
          },
          {
            say: 'Between servers, traffic crosses InfiniBand or RoCE Ethernet at four hundred to eight hundred gigabits per second per GPU, and GPUDirect RDMA moves tensors from the network card straight into HBM.',
            card: { tag: 'NUMBERS', title: 'The network is one hop slower', stat: { v: '400–800', u: 'Gb/s per GPU', l: 'InfiniBand NDR or XDR, or Spectrum-X RoCE, on a rail-optimised fabric' } },
            deep: '<table><tr><th>Link</th><th>Bandwidth (per GPU)</th><th>Scope</th></tr>' +
              '<tr><td>PCIe Gen5 x16</td><td>~64 GB/s per direction</td><td>host, NIC, NVMe</td></tr>' +
              '<tr><td>IB NDR / XDR, Spectrum-X</td><td>400 / 800 Gb/s = 50 / 100 GB/s</td><td>whole cluster</td></tr></table>' +
              '<p><b>Rail-optimised</b> fabric: GPU k of every node attaches to leaf switch k, so same-rank collectives stay one hop. <b>GPUDirect RDMA</b> lets the NIC DMA directly into HBM (no host bounce buffer); <b>GPUDirect Storage</b> does the same for NVMe. The separate <b>storage / front-end network</b> carries weights, checkpoints and media so it never competes with collective traffic.</p>'
          },
          {
            say: 'That is still roughly nine times slower than NVLink in each direction, which is why placement matters. Watch the traffic: inside a server the packets race, across the fabric they crawl.',
            card: { tag: 'NUMBERS', title: 'Why placement matters', stat: { v: '≈ 9×', l: 'NVLink over InfiniBand, per direction: 450 vs 50 GB/s on H100, 900 vs 100 GB/s on B200 with XDR' } },
            deep: '<p>Bandwidth-bound collective time for a message of S bytes per GPU on p GPUs at per-GPU link bandwidth B:</p>' +
              '<div class="eq">T<sub>all-reduce</sub> ≈ 2·(p−1)/p · S / B<br>T<sub>all-to-all</sub> ≈ (p−1)/p · S / B</div>' +
              '<p>Ulysses is an all-to-all, and the 339 MB per layer computed earlier already contains the (p−1)/p factor. Forced across 50 GB/s InfiniBand it would cost 339 MB / 50 GB/s ≈ 6.8 ms per layer, about 27 s of pure communication per shot (6.8 ms × 40 layers × 100 forwards): more than a quarter of the compute time. Hence: keep a shot inside one NVLink domain, and let only the rare, small collectives (weights, checkpoints, cross-node data parallelism) cross the fabric.</p>' +
              '<details><summary>Go deeper</summary><p>These are lower bounds. NCCL reports <i>bus bandwidth</i> = algorithm bandwidth × 2(p−1)/p for all-reduce and × (p−1)/p for all-to-all, so a healthy NVSwitch domain typically shows most, but not all, of the raw link rate, and a cross-node all-to-all is further limited by the slowest rail and by oversubscription in the spine. Latency terms (α per hop) matter for small messages, which is why decode-time TP all-reduces behave very differently from these 339 MB transfers.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.ghost[4], 400);
          ctx.fade(S.drops, 0, 10);
          ctx.fadeOut([S.kvChip, S.flopChip], 300, true);
          ctx.hud('');
          S.hw = ctx.group();
          /* HGX H100 */
          S.h100 = ctx.node({ x: 410, y: 713, w: 370, h: 182, color: 'amber', parent: S.hw });
          ctx.text(239, 640, 'HGX H100 · LLM pool', { size: 13, weight: 600, color: 'white', font: 'display', parent: S.h100 });
          ctx.text(552, 640, '8 × 80 GB HBM3', { size: 11, color: 'dim', font: 'mono', anchor: 'end', parent: S.h100 });
          S.h100chips = [];
          for (var i = 0; i < 8; i++) {
            var cx = 243 + (i % 4) * 85, cy = i < 4 ? 656 : 740;
            S.h100chips.push(chip(ctx, cx, cy, 74, 42, 'H100', '3.35 TB/s', 'amber', S.h100));
            ctx.line(cx + 37, i < 4 ? 698 : 740, cx + 37, i < 4 ? 708 : 730, { color: ctx.alpha('amber', 0.6), sw: 1.2, parent: S.h100 });
          }
          ctx.rect(243, 708, 329, 22, { rx: 4, fill: ctx.alpha('red', 0.12), stroke: ctx.alpha('red', 0.7), sw: 1, parent: S.h100 });
          S.nvsTxt = ctx.text(407, 719.5, 'NVSwitch · NVLink4 900 GB/s per GPU', { size: 11, color: 'text', anchor: 'middle', font: 'mono', parent: S.h100 });
          ctx.hotspot(S.h100, 'gpu', { hint: 'INSIDE THE GPU ⤢' });
          ctx.focus([S.bandsG, S.hw], 0);
          /* beat 0: the HGX H100 server, camera in on the metal */
          return Promise.all([ctx.reveal(S.h100, { from: 'up' }), ctx.wait(400).then(function () { return ctx.camera(695, 745, 1.6, 1400); })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: GB200 NVL72 rack */
            S.rack = ctx.node({ x: 750, y: 713, w: 270, h: 182, color: 'red', parent: S.hw });
            ctx.text(629, 640, 'GB200 NVL72 rack', { size: 13, weight: 600, color: 'white', font: 'display', parent: S.rack });
            for (var tr = 0; tr < 27; tr++) {
              var isSw = tr >= 10 && tr < 19;
              ctx.rect(629, 654 + tr * 5.2, 120, 4, { rx: 1, fill: isSw ? ctx.alpha('cyan', 0.55) : ctx.alpha('red', 0.5), parent: S.rack });
            }
            ctx.para(760, 662, ['72 Blackwell GPUs', '36 Grace CPUs', '~13.4 TB HBM3e', 'NVLink5 1.8 TB/s', '130 TB/s domain', '~120 kW, liquid'], { size: 11, color: 'text', font: 'mono', lh: 18, parent: S.rack });
            ctx.text(760, 791, 'cyan = NVSwitch', { size: 11, color: 'cyan', font: 'mono', parent: S.rack });
            return ctx.reveal(S.rack, { from: 'up' }).then(function () { return ctx.pulse(S.rack, { color: 'red', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the HGX B200 video gang */
            S.b200 = ctx.node({ x: 1035, y: 713, w: 260, h: 182, color: 'lime', parent: S.hw });
            ctx.text(919, 640, 'HGX B200 · shot 3', { size: 13, weight: 600, color: 'white', font: 'display', parent: S.b200 });
            ctx.text(1122, 640, 'SP = 8', { size: 11, color: 'lime', font: 'mono', anchor: 'end', parent: S.b200 });
            S.b200chips = [];
            for (var j = 0; j < 8; j++) {
              var bx = 919 + (j % 4) * 60, by = j < 4 ? 656 : 740;
              S.b200chips.push(chip(ctx, bx, by, 52, 42, 'B200', 'SP' + j, 'lime', S.b200));
              ctx.line(bx + 26, j < 4 ? 698 : 740, bx + 26, j < 4 ? 708 : 730, { color: ctx.alpha('lime', 0.6), sw: 1.2, parent: S.b200 });
            }
            ctx.rect(919, 708, 232, 22, { rx: 4, fill: ctx.alpha('red', 0.12), stroke: ctx.alpha('red', 0.7), sw: 1, parent: S.b200 });
            ctx.text(1035, 719.5, 'NVLink5 · 1.8 TB/s per GPU', { size: 11, color: 'text', anchor: 'middle', font: 'mono', parent: S.b200 });
            ctx.hotspot(S.b200, 'parallelism', { hint: 'PARALLELISM ⤢' });
            return ctx.reveal(S.b200, { from: 'up' }).then(function () { return ctx.pulse(S.b200, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the fabrics between servers */
            S.fab = ctx.group({ parent: S.hw });
            ctx.line(240, 826, 1150, 826, { color: ctx.alpha('cyan', 0.8), sw: 2.2, parent: S.fab });
            [410, 690, 1035].forEach(function (x) { ctx.line(x, 804, x, 826, { color: ctx.alpha('cyan', 0.8), sw: 1.6, parent: S.fab }); });
            ctx.text(695, 843, 'InfiniBand NDR/XDR or Spectrum-X RoCE · 400–800 Gb/s per GPU · rail-optimized · GPUDirect RDMA', { size: 11, color: 'cyan', anchor: 'middle', font: 'mono', parent: S.fab });
            ctx.line(240, 866, 1150, 866, { color: ctx.alpha('teal', 0.6), sw: 1.4, dash: '6 5', parent: S.fab });
            tag(ctx, 695, 866, 'storage / front-end net · 2×200 GbE → parallel FS + object store', 'teal', S.fab);
            return ctx.reveal(S.fab, { from: 'fade', dur: 800 });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: traffic, fast NVLink versus slower fabric */
            S.pNv1 = ctx.path('M246,703 L569,703', { parent: S.hw });
            S.pNv1b = ctx.path('M246,735 L569,735', { parent: S.hw });
            S.pNv2 = ctx.path('M922,703 L1148,703', { parent: S.hw });
            S.pNv2b = ctx.path('M922,735 L1148,735', { parent: S.hw });
            S.pIb = ctx.path('M240,826 L1150,826', { parent: S.hw });
            S.streams = [
              ctx.stream(S.pNv1, { color: 'amber', count: 4, period: 700, r: 2.5 }),
              ctx.stream(S.pNv1b, { color: 'amber', count: 4, period: 700, r: 2.5, reverse: true }),
              ctx.stream(S.pNv2, { color: 'lime', count: 4, period: 500, r: 2.5 }),
              ctx.stream(S.pNv2b, { color: 'lime', count: 4, period: 500, r: 2.5, reverse: true }),
              ctx.stream(S.pIb, { color: 'cyan', count: 3, period: 5200, r: 3.5 })
            ];
            return ctx.wait(2200);
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Weights & registry',
        beats: [
          {
            say: 'Before a GPU can serve, it needs weights, and weights are huge. A frontier mixture of experts model in FP8 is around seven hundred gigabytes. Our video model plus its text encoder is about forty.',
            card: { tag: 'NUMBERS', title: 'Weights are the payload', stat: { v: '≈ 700 GB', l: 'a DeepSeek-V3-class 671B mixture of experts in FP8; our video model with its encoders is about 40 GB' } },
            deep: '<p>Sizes: DeepSeek-V3-class 671B MoE in FP8 ≈ 700 GB; 70B dense FP8 ≈ 70 GB; Wan-14B DiT BF16 ≈ 28 GB + umT5-XXL encoder ≈ 11 GB + VAE ≈ 0.5 GB.</p>' +
              '<p>At 1 GB/s (one well-tuned node download) 700 GB takes ≈ 12 minutes per node. Multiply by a rollout across hundreds of nodes and start-up, not compute, becomes the bottleneck, which is why the control plane treats weight movement as a first-class problem.</p>'
          },
          {
            say: 'The model registry stores signed, versioned checkpoints. A weight distribution service moves them to the nodes that need them, by digest, never by name.',
            card: { tag: 'PITFALL', title: 'Never deploy "latest"', body: 'Pin <code>model@sha256</code>. A moving tag turns a rollout into a silent behaviour change, and a signed digest is what lets a node verify what it loads.' },
            deep: '<ul><li><b>Integrity</b>: per-shard SHA-256 plus signed manifests (Sigstore-style model signing). The registry pins <code>model@sha</code>, never "latest".</li>' +
              '<li><b>Format</b>: safetensors, so a checkpoint is data, not pickled code, and can be memory-mapped and read tensor by tensor.</li>' +
              '<li><b>Placement</b>: a checkpoint is sharded per tensor-parallel rank, so each GPU fetches only its own slice.</li></ul>'
          },
          {
            say: 'The naive way is to pull from object storage. With sixteen fresh nodes contending for one origin, seven hundred gigabytes takes almost four minutes.',
            card: { tag: 'NUMBERS', title: 'The origin is the bottleneck', stat: { v: '224 s', l: 'time to ready for 16 nodes pulling 700 GB from one origin at 50 GB/s aggregate' } },
            deep: '<p>Time to make N fresh nodes serve-ready with an S-byte checkpoint from a single origin:</p>' +
              '<div class="eq">T<sub>origin</sub> ≈ N·S / B<sub>origin</sub> = 16 · 700 GB / 50 GB/s = 224 s</div>' +
              '<p>Origin bandwidth is shared, so the wait grows linearly with the number of nodes, exactly when you scale out under load.</p>' +
              '<details><summary>Go deeper</summary><p>Where would a 50 GB/s origin come from? One object-store stream delivers roughly 0.1 GB/s, so even a 3 GB/s node needs 30 or more parallel ranged GETs of 8–64 MB parts, and the store side must spread them across key prefixes and front ends. Adding nodes adds no origin bandwidth, so N·S / B<sub>origin</sub> is the right first-order model. Egress and request charges are a second reason to fetch each byte once per region rather than once per node.</p></details>'
          },
          {
            say: 'Node local NVMe caches avoid downloading twice. Peer to peer broadcast lets new nodes copy from their neighbours in chunks, so every node forwards one chunk while it receives the next.',
            card: {
              tag: 'HOW IT WORKS', title: 'Chunked, pipelined broadcast', body: 'Each node forwards chunk k while receiving chunk k+1, so the whole fleet finishes in about one transfer time plus a small depth cost.',
              more: '<p>Cut the file into k chunks of size c = S/k and forward them along h hops. The first chunk needs h·c/B to reach the last node, and the others stream behind it at rate B, so the total is (h + k − 1)·c/B ≈ (S + h·c)/B for k ≫ h. A whole-file binomial tree instead pays S/B once per level, ⌈log<sub>2</sub>N⌉ times. The caveat: every node must upload at line rate, so use a chain or a swarm in which peers serve different chunks; a plain binary tree would halve each parent\'s uplink and cost about 2S/B.</p>'
            },
            deep: '<div class="eq">T<sub>doubling</sub> ≈ ⌈log<sub>2</sub>N⌉ · S / B<sub>NIC</sub>   (whole-file binomial tree)<br>T<sub>pipelined</sub> ≈ (S + h·c) / B<sub>NIC</sub>   (chunked chain or swarm, depth h)</div>' +
              '<p>With c = 64 MB, N = 16 and B<sub>NIC</sub> = 50 GB/s (400 Gb/s): whole-file doubling ≈ 56 s, a chunked pipeline ≈ 14 s plus load (a 15-hop chain adds only 15 · 64 MB / 50 GB/s ≈ 0.02 s of pipeline fill), and a local NVMe hit (~25 GB/s RAID) ≈ 28 s. Chunking is what makes P2P fast: the Dragonfly, Kraken and BitTorrent idea, where each peer serves the chunks it already has. Numbers in the chart are illustrative.</p>'
          },
          {
            say: 'Streaming loaders then push tensors into GPU memory while the rest are still arriving, so each tensor parallel rank reads only its own shard and time to ready drops to seconds.',
            card: { tag: 'STATE OF THE ART', title: 'Load while you download', body: 'Run:ai Model Streamer and fastsafetensors overlap storage reads, host staging and copies to HBM. GPUDirect Storage can skip the CPU bounce buffer.', more: '<p>ServerlessLLM goes further: it exploits the storage hierarchy (NVMe to DRAM to HBM) with chunked, pipelined loading and locality-aware placement, and reports 10 to 200 times lower latency than earlier serverless systems in its evaluation.</p>' },
            deep: '<ul><li><b>Streaming load</b> (Run:ai Model Streamer, fastsafetensors): overlap object-store reads, host staging and host-to-device copies; each TP rank reads only its shard.</li>' +
              '<li><b>GPUDirect Storage</b> can DMA NVMe → HBM, skipping the CPU bounce.</li>' +
              '<li><b>Result</b>: ~14 s of transfer plus a few seconds of overlap for a 700 GB checkpoint, against 224 s from the origin.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.camera(null, null, null, 1000);
          ctx.focus(null);
          ctx.remove(S.ledger, 400);
          ctx.remove(S.cmp, 400);
          ctx.remove(S.scoreG, 400);
          S.ctl = ctx.group();
          var hd = ctx.group({ parent: S.ctl });
          ctx.text(1210, 100, 'CONTROL PLANE', { size: 15, color: 'red', font: 'display', weight: 700, parent: hd });
          ctx.text(1210, 120, 'registry · weights · scaling · health', { size: 11, color: 'dim', font: 'mono', parent: hd });
          S.regN = ctx.node({ x: 1382, y: 168, w: 360, h: 54, title: 'Model Registry', sub: 'versioned · signed · safetensors', icon: 'db', color: 'teal', titleSize: 15, parent: S.ctl });
          S.szMoe = ctx.label(1290, 213, '671B MoE · 700 GB', { color: 'amber', size: 11, parent: S.ctl });
          S.szVid = ctx.label(1470, 213, 'Wan 14B · 40 GB', { color: 'lime', size: 11, parent: S.ctl });
          /* beat 0: the control plane opens with the registry and the size of what it holds */
          return Promise.all([
            ctx.reveal(hd, { from: 'right' }),
            ctx.reveal(S.regN, { from: 'right', delay: 150 }),
            ctx.reveal([S.szMoe, S.szVid], { from: 'up', dist: 12, delay: 500, stagger: 200 })
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: weight distribution, from the registry to the clusters */
            S.wdN = ctx.node({ x: 1382, y: 262, w: 360, h: 54, title: 'Weight Distribution', sub: 'NVMe cache · P2P broadcast · stream', icon: 'layers', color: 'teal', titleSize: 15, parent: S.ctl });
            S.cl1 = ctx.link(S.regN, S.wdN, { color: 'teal', from: 'b', to: 't', parent: S.ctl });
            S.wl = ctx.link(S.wdN, S.cl[2], { color: 'teal', from: 'l', to: 'r', bend: { x: 1188, y: 400 }, dash: '5 5', parent: S.ctl });
            return Promise.all([ctx.reveal(S.wdN, { from: 'right' }), ctx.reveal(S.cl1, { from: 'draw', delay: 300 }), ctx.reveal(S.wl, { from: 'draw', delay: 500 })]).then(function () {
              return ctx.packet(S.cl1, { color: 'teal', dur: 500 });
            }).then(function () { return ctx.packet(S.wl, { color: 'teal', dur: 1000, label: 'weights' }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: baseline, every node pulls from the origin */
            S.ttr = ctx.group({ parent: S.ctl });
            ctx.text(1210, 452, 'time to ready · 16 nodes × 700 GB (illustrative)', { size: 11, color: 'text', font: 'mono', parent: S.ttr });
            S.ttrBars = [];
            S.ttrRow = function (r0, i) {
              var y = 474 + i * 26, w = Math.max(3, r0[1] / 224 * 190);
              var g = ctx.group({ parent: S.ttr });
              ctx.text(1210, y + 8, r0[0], { size: 11, color: 'dim', font: 'mono', parent: g });
              var b = ctx.rect(1312, y, w, 16, { rx: 3, fill: ctx.alpha(r0[2], 0.6), stroke: r0[2], sw: 1, parent: g });
              b._w = w;
              ctx.text(1312 + w + 6, y + 8.5, r0[1] + ' s', { size: 11, color: r0[2], font: 'mono', parent: g });
              b.setAttribute('width', 0);
              S.ttrBars.push(b);
              return { g: g, b: b };
            };
            var row0 = S.ttrRow(['origin pull', 224, 'red'], 0);
            ctx.reveal(S.ttr, { dur: 300 });
            return ctx.animate(row0.b, { width: [0, row0.b._w] }, 1200, 'out', 300).then(function () { return ctx.pulse(row0.b, { color: 'red', dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: NVMe cache and the P2P broadcast tree */
            var row1 = S.ttrRow(['NVMe cache', 28, 'amber'], 1);
            S.tree = ctx.group({ parent: S.ctl });
            ctx.text(1210, 320, 'P2P broadcast', { size: 11, color: 'dim', font: 'mono', parent: S.tree });
            ctx.text(1210, 335, 'chunked, pipelined', { size: 11, color: 'dim', font: 'mono', parent: S.tree });
            var pts = [[1382, 326, 'origin'], [1302, 368, 'n1'], [1462, 368, 'n2'], [1262, 410, 'n3'], [1342, 410, 'n4'], [1422, 410, 'n5'], [1502, 410, 'n6']];
            var edges = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]];
            S.treeE = edges.map(function (e) {
              var a = pts[e[0]], b = pts[e[1]];
              return ctx.path('M' + a[0] + ',' + (a[1] + 9) + ' L' + b[0] + ',' + (b[1] - 9), { stroke: ctx.alpha('teal', 0.6), sw: 1.3, arrow: true, parent: S.tree });
            });
            pts.forEach(function (p, i) {
              var w = i === 0 ? 56 : 32;
              ctx.rect(p[0] - w / 2, p[1] - 9, w, 18, { rx: 4, fill: ctx.alpha('teal', 0.15), stroke: 'teal', sw: 1, parent: S.tree });
              ctx.text(p[0], p[1] + 0.5, p[2], { size: 11, color: 'teal', anchor: 'middle', font: 'mono', parent: S.tree });
            });
            ctx.reveal(S.tree, { dur: 500 });
            return Promise.all([
              ctx.animate(row1.b, { width: [0, row1.b._w] }, 700, 'out', 200),
              ctx.wait(600).then(function () {
                return Promise.all(S.treeE.slice(0, 2).map(function (e) { return ctx.packet(e, { color: 'teal', dur: 500, r: 4 }); }));
              }).then(function () {
                return Promise.all(S.treeE.slice(2).map(function (e) { return ctx.packet(e, { color: 'teal', dur: 500, r: 4 }); }));
              })
            ]);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: streaming load, the fastest bar */
            var row2 = S.ttrRow(['P2P + stream', 18, 'teal'], 2);
            return ctx.animate(row2.b, { width: [0, row2.b._w] }, 700, 'out', 100).then(function () {
              return Promise.all([ctx.pulse(row2.b, { color: 'teal', dur: 600 }), ctx.packet(S.wl, { color: 'teal', dur: 900, label: 'stream', reverse: false })]);
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Scale & heal',
        beats: [
          {
            say: 'The control plane also keeps the fleet healthy and right sized. Health agents watch DCGM telemetry and driver XID errors on every node, and run bandwidth tests before a node joins.',
            card: { tag: 'NUMBERS', title: 'Failure is the steady state', stat: { v: '≈ 3 h', l: 'between interruptions in a 16,384-GPU H100 run (Llama 3: 419 unexpected failures in 54 days)' } },
            deep: '<ul><li><b>Health</b>: DCGM field watches (ECC, thermals, NVLink CRC/replay counters), driver XIDs (79 = fell off the bus, 48 = double-bit ECC, 94/95 = contained/uncontained ECC), periodic NCCL all-reduce bandwidth tests and burn-in on new nodes.</li>' +
              '<li>At 10<sup>4</sup> GPUs something fails every few hours: Llama 3 reports 419 unexpected interruptions in 54 days on 16,384 GPUs (one per ~3 h), and MegaScale describes the same regime of frequent faults at 12,288 GPUs.</li></ul>'
          },
          {
            say: 'When a GPU falls off the bus, the node is cordoned and drained, and its work is retried elsewhere from the last checkpoint. LLM replicas simply drain, while long jobs resume.',
            card: { tag: 'HOW IT WORKS', title: 'Cordon, drain, retry', body: 'XID 79 marks the node unschedulable, replicas re-route through the router, and gang jobs restart from their last checkpoint on healthy nodes.' },
            deep: '<ul><li><b>Remediation</b>: cordon → drain → reboot / GPU reset → re-burn-in → uncordon, or RMA.</li>' +
              '<li>Long jobs resume from checkpoints; LLM replicas just drain, because the router stops sending them new requests and in-flight streams finish or retry.</li>' +
              '<li>A gang job loses all eight ranks when one dies, which is why video workers checkpoint latents every few steps (see <i>Scheduler</i>).</li></ul>'
          },
          {
            say: 'The autoscaler watches queue depth and the backlog of GPU seconds, not CPU load, and pulls nodes from a warm pool before the queue explodes.',
            card: { tag: 'PITFALL', title: 'CPU load is the wrong signal', body: 'GPU work is bursty and queue driven. Scale on backlog and KV-cache utilisation, and hide the multi-minute node provisioning delay with warm pools.' },
            deep: '<p><b>Autoscaling signal</b>: not CPU. Use queue depth, KV-cache utilisation and GPU-second backlog:</p>' +
              '<div class="eq">nodes<sub>+</sub> = ⌈ backlog<sub>GPU·s</sub> / (T<sub>drain</sub> · 8) ⌉ − idle<sub>nodes</sub></div>' +
              '<p>e.g. 2 queued shots × 8 × 95 GPU·s = 1,520 GPU·s; drain target 190 s → 1 node. KEDA or custom controllers act on these metrics; warm pools hide the multi-minute node provisioning time.</p>'
          },
          {
            say: 'Observability ties it together: every request and every GPU second is traced and attributed to a tenant, so latency and cost each have an owner.',
            card: { tag: 'HOW IT WORKS', title: 'One trace, one GPU-second ledger', body: 'DCGM exporter feeds Prometheus, OpenTelemetry spans follow each request, and per-tenant accounting turns GPU seconds into money.' },
            deep: '<ul><li><b>Observability</b>: DCGM exporter → Prometheus (SM active, tensor-pipe active, HBM used, NVLink/IB throughput); OpenTelemetry spans per request; per-tenant GPU·s accounting; SLO burn-rate alerts on TTFT/TPOT.</li>' +
              '<li>Multi-window burn-rate alerts (for example 14.4× over 1 h and over 5 min for a 30-day SLO) page on fast budget burn without paging on noise.</li></ul>' +
              '<details><summary>Go deeper</summary><p>Classic GPU "utilisation" (<code>DCGM_FI_DEV_GPU_UTIL</code>) only says a kernel was resident during the sample window, so a GPU that reads 100% can sit at 20% MFU. Prefer the profiling fields <code>DCGM_FI_PROF_SM_ACTIVE</code>, <code>PIPE_TENSOR_ACTIVE</code> and <code>DRAM_ACTIVE</code>, or compute MFU from model FLOPs. Burn rate is the error rate divided by (1 − SLO): for a 99.9% 30-day SLO, a 14.4× burn spends 2% of the whole budget in one hour.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.ctl2 = ctx.group();
          S.hlN = ctx.node({ x: 1382, y: 580, w: 360, h: 54, title: 'Health & Remediation', sub: 'DCGM · XID · NCCL tests · drain', icon: 'shield', color: 'red', titleSize: 15, parent: S.ctl2 });
          S.asN = ctx.node({ x: 1382, y: 660, w: 360, h: 54, title: 'Autoscaler', sub: 'queue depth · GPU-s backlog · KV util', icon: 'chart', color: 'red', titleSize: 15, parent: S.ctl2 });
          S.obN = ctx.node({ x: 1382, y: 740, w: 360, h: 54, title: 'Observability', sub: 'DCGM exporter · OTel · SLO burn', icon: 'eye', color: 'red', titleSize: 15, parent: S.ctl2 });
          [S.asN, S.obN].forEach(function (n) { n.setAttribute('opacity', 0); });
          ctx.fade([S.tree, S.ttr], 0.3, 600);   /* the weight-distribution charts recede while attention moves to health */
          /* beat 0: health agents on every node */
          return ctx.reveal(S.hlN, { from: 'right' }).then(function () {
            return Promise.all([ctx.pulse(S.hlN, { color: 'red', dur: 600 }), ctx.pulse(S.cl[0], { color: 'red', dur: 800 }), ctx.pulse(S.cl[2], { color: 'red', dur: 800 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: a GPU falls off the bus */
            var fc = S.h100chips[5].box;
            S.fail = ctx.group({ parent: S.hw });
            ctx.rect(fc.x, fc.y, fc.w, fc.h, { rx: 4, fill: '#2a0a12', stroke: 'red', sw: 2, parent: S.fail, glow: true });
            ctx.text(fc.cx, fc.cy - 8, 'XID 79', { size: 12, color: 'red', anchor: 'middle', font: 'mono', weight: 700, parent: S.fail });
            ctx.text(fc.cx, fc.cy + 9, 'off bus', { size: 11, color: 'red', anchor: 'middle', font: 'mono', parent: S.fail });
            S.cordon = tag(ctx, 407.5, 719, 'node cordoned · draining · replicas re-route', 'red', S.hw, 331);
            ctx.fade(S.nvsTxt, 0, 300);
            ctx.fade(S.h100chips[5], 0, 200);
            ctx.reveal(S.fail, { dur: 300 });
            ctx.reveal(S.cordon, { delay: 700 });
            return ctx.wait(600).then(function () { return ctx.pulse(S.h100, { color: 'red', dur: 700 }); }).then(function () {
              return ctx.pulse(S.hlN, { color: 'red', dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the autoscaler adds a warm node */
            S.warm = tag(ctx, 447, 368, '+1 warm node', 'lime', S.reg);
            ctx.reveal(S.asN, { from: 'right' });
            ctx.reveal(S.warm, { from: 'scale', delay: 700 });
            return ctx.wait(500).then(function () {
              return Promise.all([ctx.pulse(S.asN, { color: 'lime', dur: 600 }), ctx.pulse(S.cl[0], { color: 'lime', dur: 800 })]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: observability, and the metric the autoscaler reacts to */
            S.spark = ctx.group({ parent: S.ctl2 });
            ctx.text(1215, 790, 'queue depth', { size: 11, color: 'lime', font: 'mono', parent: S.spark });
            ctx.text(1545, 790, 'nodes', { size: 11, color: 'red', font: 'mono', anchor: 'end', parent: S.spark });
            var q = ctx.plot(1215, 802, 330, 62, function (x) { return 0.15 + 0.75 * Math.exp(-Math.pow((x - 0.38) / 0.16, 2)); }, { color: 'lime', sw: 2, parent: S.spark });
            var n = ctx.plot(1215, 802, 330, 62, [[0, 0.25], [0.3, 0.25], [0.3, 0.45], [0.42, 0.45], [0.42, 0.65], [0.75, 0.65], [0.75, 0.45], [1, 0.45]], { color: 'red', sw: 2, axes: false, parent: S.spark });
            ctx.reveal(S.spark, { dur: 300 });
            ctx.reveal(S.obN, { from: 'right' });
            return Promise.all([
              ctx.reveal([q.curve, n.curve], { from: 'draw', dur: 1400, delay: 500, stagger: 300 })
            ]).then(function () { return ctx.pulse(S.obN, { color: 'red', dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Follow the trailer',
        beats: [
          {
            say: 'Now follow our trailer through the whole stack. Each LLM call hits the router, lands on a replica that already holds the agent\'s prompt prefix, and gets its first token within a few hundred milliseconds.',
            card: { tag: 'NUMBERS', title: 'A language call, end to end', stat: { v: '≈ 0.3 s', l: 'time to first token on a prefix-cache hit, then about 60 tokens per second' } },
            deep: '<p>End-to-end path of one call of each kind (typical, warm system):</p>' +
              '<table><tr><th>Hop</th><th>LLM call</th></tr>' +
              '<tr><td>Global</td><td>router pick &lt; 1 ms</td></tr>' +
              '<tr><td>Cluster</td><td>replica already running</td></tr>' +
              '<tr><td>Engine</td><td>TTFT ~0.2–0.5 s (prefix hit)</td></tr>' +
              '<tr><td>Output</td><td>~50–100 tok/s streamed</td></tr>' +
              '<tr><td>GPU cost</td><td>~0.5–3 GPU·s</td></tr></table>' +
              '<p>TTFT decomposes into router and network (~20 ms), queue (~50 ms), prefill of the uncached suffix (~2k tokens at 10<sup>4</sup> tok/s ≈ 0.2 s) and the first decode step, which is how a warm call lands near 0.3 s.</p>'
          },
          {
            say: 'Each video shot waits briefly in the queue, is gang scheduled onto eight GPUs inside one NVLink domain, and renders in about a minute and a half.',
            card: { tag: 'NUMBERS', title: 'A video shot, end to end', stat: { v: '≈ 5 s', l: 'typical queue wait on a warm cluster, before about 95 s of denoising on eight GPUs' } },
            deep: '<table><tr><th>Hop</th><th>Video shot</th></tr>' +
              '<tr><td>Global</td><td>queue wait 0–30 s</td></tr>' +
              '<tr><td>Cluster</td><td>gang admit + pod start ~2–5 s (warm)</td></tr>' +
              '<tr><td>Engine</td><td>50 steps × CFG ≈ 95 s</td></tr>' +
              '<tr><td>Output</td><td>VAE decode ~5 s, upload clip</td></tr>' +
              '<tr><td>GPU cost</td><td>~760 GPU·s</td></tr></table>' +
              '<p>The ~95 s of denoising is 100 forward passes (50 steps × 2 CFG branches) at about 0.95 s each on eight Blackwell GPUs. Queueing, pod start and VAE decode add roughly fifteen more seconds of wall clock that hold no denoising, so a warm shot completes in about 110 s end to end.</p>'
          },
          {
            say: 'Add it up and the whole trailer costs about one GPU minute of language work and seventy six GPU minutes of video. The two paths share hardware, but almost nothing else.',
            card: { tag: 'WHY IT MATTERS', title: 'Optimise the video path first', body: 'Language calls cost about one GPU-minute per trailer, video about seventy six. Distillation, sequence parallelism and caching pay off there before router tuning does.' },
            deep: '<p>The ratio explains where the engineering effort in the following chambers goes: <b>step distillation</b> (50 to 4–8 steps), <b>sequence parallelism</b> across the gang, <b>step caching</b> and <b>VAE tiling</b> for video, against <b>prefix caching</b>, <b>continuous batching</b> and <b>prefill/decode disaggregation</b> for the LLM fleet, which runs around the clock.</p>' +
              '<div class="eq">per trailer: LLM ≈ 1 GPU-min &nbsp;·&nbsp; video ≈ 6 × 8 × 95 s ≈ 76 GPU-min</div>'
          },
          {
            say: 'Every glowing box opens a deeper chamber: the scheduler, the load balancer, both serving engines, the GPU itself, and distributed parallelism.',
            card: { tag: 'TRY IT', title: 'Open any glowing box', body: 'Dashed rings mark six chambers: Load Balancing, Scheduler, LLM Serving, Video Serving, GPU and Parallelism. Click one to zoom in.' },
            deep: '<p>Where to dig next:</p><ul>' +
              '<li><b>Scheduler</b>: gangs, fair share, preemption, cold starts.</li>' +
              '<li><b>Load balancing</b>: power-of-two, prefix-aware routing, queueing.</li>' +
              '<li><b>LLM / video serving</b>: batching, KV cache, sequence parallel DiT.</li>' +
              '<li><b>GPU</b> and <b>parallelism</b>: SMs, HBM, roofline; DP/TP/PP/EP/SP.</li></ul>' +
              '<p>Each chamber keeps the same trailer as its running example, one level closer to the metal.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.trace = ctx.group();
          /* draw the traces under the nodes (just above the band backdrop) so they never cover titles;
             the packets and hop tags ride on top in S.tagG */
          ctx.layer.insertBefore(S.trace, S.bandsG.nextSibling);
          var qx = 1040 + 2 * 21 + 8.5;
          S.tA = ctx.path('M518,205 L420,288 L370,402 L296,536 L280,677', { stroke: 'amber', sw: 3, parent: S.trace, glow: true });
          S.tB = ctx.path('M' + S.shotC[2].x + ',' + S.shotC[2].y + ' L' + qx + ',288 L970,402 L1037,536 L1035,719', { stroke: 'lime', sw: 3, parent: S.trace, glow: true });
          S.tagG = ctx.group();
          ctx.focus([S.trace, S.tagG, S.bandsG], 0.45);
          var hs = [S.router, S.sched, S.llmBox, S.vidBox, S.h100, S.b200];
          /* beat 0: the LLM call */
          return Promise.all([
            ctx.reveal(S.tA, { from: 'draw', dur: 1400 }),
            ctx.wait(800).then(function () { return ctx.reveal(tag(ctx, 639, 288, 'prefix pick', 'amber', S.tagG), { from: 'scale' }); }),
            ctx.wait(1300).then(function () { return ctx.reveal(tag(ctx, 430, 604, 'TTFT ~0.3 s · ~60 tok/s', 'amber', S.tagG), { from: 'scale' }); })
          ]).then(function () {
            return ctx.packet(S.tA, { color: 'amber', dur: 1600, label: 'chat()', parent: S.tagG });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the video shot */
            return Promise.all([
              ctx.reveal(S.tB, { from: 'draw', dur: 1600 }),
              ctx.wait(700).then(function () { return ctx.reveal(tag(ctx, 1101, 322, 'queued ~5 s', 'lime', S.tagG), { from: 'scale' }); }),
              ctx.wait(1400).then(function () { return ctx.reveal(tag(ctx, 1030, 604, 'gang · 8 GPU · 1 NVLink domain', 'lime', S.tagG), { from: 'scale' }); })
            ]).then(function () {
              return ctx.packet(S.tB, { color: 'lime', dur: 2400, r: 7, label: 'shot 3', parent: S.tagG });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the bill */
            ctx.hud('LLM ≈ 1 GPU-min · video ≈ 76 GPU-min');
            return Promise.all([ctx.pulse(S.h100, { color: 'amber', dur: 700 }), ctx.pulse(S.b200, { color: 'lime', dur: 700 })]).then(function () {
              return Promise.all([ctx.pulse(S.h100, { color: 'amber', dur: 700 }), ctx.pulse(S.b200, { color: 'lime', dur: 700 })]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: every glowing box opens a chamber */
            ctx.hud('');
            ctx.focus(null);
            ctx.fade(S.trace, 0.8, 600);
            return hs.reduce(function (p, n) {
              return p.then(function () { return ctx.pulse(n, { dur: 450 }); });
            }, Promise.resolve());
          });
        }
      }
    ]
  });
})();
