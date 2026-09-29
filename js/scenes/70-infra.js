/* L1 — AI Infrastructure & GPU Cluster. Follows the trailer's ~40 LLM calls and 6 video jobs down the stack:
 * workload -> global router / scheduler -> regional Kubernetes clusters -> inference servers -> GPUs & fabrics,
 * then the control plane that keeps it fed (registry, weight distribution, autoscaling, health, observability). */
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
      'Kwon et al., <i>Efficient Memory Management for Large Language Model Serving with PagedAttention</i> (vLLM), SOSP 2023',
      'Zheng et al., <i>SGLang: Efficient Execution of Structured Language Model Programs</i>, NeurIPS 2024',
      'NVIDIA, <i>GB200 NVL72 / Blackwell Architecture Technical Brief</i>, 2024; <i>DGX H100 / HGX H100 System Architecture</i>, 2023',
      'Jiang et al., <i>MegaScale: Scaling Large Language Model Training to More Than 10,000 GPUs</i>, NSDI 2024; Llama Team, <i>The Llama 3 Herd of Models</i> (training reliability), arXiv 2407.21783, 2024',
      'Verma et al., <i>Large-scale cluster management at Google with Borg</i>, EuroSys 2015',
      'Kubernetes SIG Scheduling, <i>Kueue</i> and <i>Dynamic Resource Allocation (DRA)</i> documentation, 2025',
      'Wan Team, <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025',
      'Jacobs et al., <i>DeepSpeed Ulysses: System Optimizations for Extreme Long Sequence Transformer Models</i>, 2023'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'The stack',
        say: 'Every model call from the overview lands here, on the AI infrastructure. Think of it as five layers: a workload layer where requests arrive, a global layer that routes and schedules, regional Kubernetes clusters, inference servers, and finally the GPUs and their fabrics. Our trailer creates two very different kinds of work: about forty short LLM calls, and six heavy video jobs that each need eight GPUs for over a minute. That asymmetry shapes every layer below.',
        deep: '<p>The fleet serves two workload classes with opposite physics:</p>' +
          '<table><tr><th></th><th>LLM calls</th><th>Video jobs</th></tr>' +
          '<tr><td>Count / trailer</td><td>~40 (6 agents)</td><td>6 shots</td></tr>' +
          '<tr><td>Unit of work</td><td>prefill + decode tokens</td><td>40 steps × ~75k latent tokens</td></tr>' +
          '<tr><td>SLO</td><td>TTFT ≲ 1 s, TPOT ≲ 50 ms</td><td>completion in minutes</td></tr>' +
          '<tr><td>Bound by</td><td>HBM bandwidth (decode)</td><td>tensor-core FLOPs</td></tr>' +
          '<tr><td>Placement</td><td>shared replica, 1 of 128 batch slots</td><td>exclusive 8-GPU gang</td></tr></table>' +
          '<div class="eq">GPU·s<sub>video</sub> ≈ 6 × 8 × 95 s ≈ 4.6×10<sup>3</sup> ≫ GPU·s<sub>LLM</sub> ≈ 10<sup>1</sup>–10<sup>2</sup></div>' +
          '<p>Each layer answers exactly one placement question: <b>which region</b> (global), <b>which node</b> (cluster scheduler), <b>which replica and batch slot</b> (router + engine), <b>which SM</b> (kernel launch). Decisions get faster and more local as you go down: seconds → ms → µs.</p>',
        run: function (ctx) {
          var S = ctx.state;
          S.bandsG = ctx.group();
          BANDS.forEach(function (b, i) {
            var g = ctx.group({ parent: S.bandsG });
            ctx.rect(60, b.t, 1115, b.b - b.t, { rx: 8, fill: ctx.alpha('red', 0.025), stroke: ctx.alpha('red', 0.14), sw: 1, parent: g });
            ctx.line(66, b.t + 10, 66, b.b - 10, { color: ctx.alpha('red', 0.7), sw: 2, parent: g });
            var mid = (b.t + b.b) / 2;
            ctx.text(80, mid - 9, b.n, { size: 13, color: 'red', font: 'mono', weight: 700, parent: g });
            ctx.text(80, mid + 9, b.name, { size: 11, color: 'dim', font: 'mono', parent: g });
            ctx.reveal(g, { from: 'left', delay: i * 110 });
          });
          S.ghost = [];
          for (var i = 1; i < 5; i++) {
            var b = BANDS[i];
            var gg = ctx.group();
            ctx.rect(222, b.t + 10, 946, b.b - b.t - 20, { rx: 8, stroke: ctx.alpha('red', 0.35), sw: 1, dash: '5 6', parent: gg });
            ctx.text(695, (b.t + b.b) / 2, GHOST[i], { size: 13, color: 'dim', anchor: 'middle', font: 'mono', parent: gg });
            S.ghost[i] = gg;
            ctx.reveal(gg, { delay: 450 + i * 120 });
          }
          /* workload band */
          S.work = ctx.group();
          S.orch = ctx.node({ x: 305, y: 195, w: 160, h: 46, title: 'Orchestrator', sub: 'agent crew', icon: 'agent', color: 'magenta', titleSize: 13, subSize: 11, parent: S.work });
          var r = ctx.rng(70);
          S.llmGrid = ctx.matrix(410, 186, 2, 20, { cell: 8, gap: 3, cmap: 'amber', values: function () { return 0.45 + 0.5 * r(); }, parent: S.work });
          ctx.text(410, 168, '~40 LLM calls · latency-bound', { size: 11, color: 'amber', font: 'mono', parent: S.work });
          S.shots = ctx.group({ parent: S.work });
          S.shotC = [];
          for (var k = 0; k < 6; k++) {
            var x = 670 + k * 78;
            ctx.rect(x, 182, 66, 30, { rx: 5, fill: ctx.alpha('lime', 0.14), stroke: 'lime', sw: 1.2, parent: S.shots });
            ctx.text(x + 33, 197, 'shot ' + (k + 1), { size: 11, color: 'lime', anchor: 'middle', font: 'mono', parent: S.shots });
            S.shotC.push({ x: x + 33, y: 197 });
          }
          ctx.text(670, 168, '6 video jobs · 8 GPUs × ~95 s each · throughput-bound', { size: 11, color: 'lime', font: 'mono', parent: S.work });
          ctx.reveal(S.work, { from: 'down', delay: 200 });
          /* ledger */
          S.ledger = ctx.code({ x: 1200, y: 156, w: 365, title: 'trailer.ledger  (one request)', lang: 'text', size: 12, color: 'red', typing: true, maxLines: 9, lines: [
            'LLM calls        ~40 across 6 agents',
            '· prompt tokens  ~2e5 (~80% cached)',
            '· output tokens  ~2e4',
            '· GPU cost       ~1 GPU-min',
            'video jobs       6 shots × 5 s',
            '· per job        8 GPUs × ~95 s',
            '· GPU cost       ~76 GPU-min',
            'bound by         HBM BW  vs  FLOPs',
            'SLO              TTFT ms vs minutes'
          ].map(function (s) { return s.replace(/ /g, ' '); }) });
          ctx.reveal(S.ledger, { from: 'right', delay: 300 });
          /* descent guides */
          S.drops = ctx.group();
          S.dropA = ctx.path('M518,209 C518,270 300,250 300,330 L300,850', { stroke: ctx.alpha('amber', 0.35), sw: 1.2, dash: '3 6', parent: S.drops });
          S.dropB = ctx.path('M1003,213 C1003,270 1100,250 1100,330 L1100,850', { stroke: ctx.alpha('lime', 0.35), sw: 1.2, dash: '3 6', parent: S.drops });
          ctx.reveal(S.drops, { delay: 900 });
          return Promise.all([
            ctx.wait(500).then(function () { return S.ledger.typeAll(); }),
            ctx.wait(1300).then(function () {
              return Promise.all([
                ctx.packet(S.dropA, { color: 'amber', dur: 1800, r: 4 }),
                ctx.wait(250).then(function () { return ctx.packet(S.dropA, { color: 'amber', dur: 1600, r: 4 }); }),
                ctx.packet(S.dropB, { color: 'lime', dur: 2400, r: 7, label: '8 GPU' })
              ]);
            })
          ]);
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Router & scheduler',
        say: 'At the global layer the two kinds of traffic split. LLM calls are small and latency critical, so they pass through an inference router that picks a replica in well under a millisecond, ideally one that already caches the agent\'s system prompt. Video jobs are large and patient, so they enter a scheduler queue, where priority, fair share and quotas decide when each shot gets its block of GPUs. Push routing for one, a job queue for the other.',
        deep: '<table><tr><th></th><th>Inference router</th><th>Global scheduler</th></tr>' +
          '<tr><td>Unit</td><td>request (ms–s)</td><td>job / pod group (min–h)</td></tr>' +
          '<tr><td>Decision budget</td><td>&lt; 1 ms, in the data path</td><td>ms–s, off the data path</td></tr>' +
          '<tr><td>State</td><td>replica queue depth, KV-cache contents</td><td>quotas, priorities, free GPUs, topology</td></tr>' +
          '<tr><td>Examples</td><td>Envoy + Gateway API Inference Extension, llm-d, SGLang router, Dynamo</td><td>Kueue, Volcano, Slurm, Ray, Borg-style</td></tr></table>' +
          '<p>A video shot is submitted as a batch object, not an HTTP call. Kueue wraps the labelled Job in a <code>Workload</code> and admits it only when quota for the whole pod set is free:</p>' +
          '<pre>kind: Workload          # created by Kueue\nqueueName: video-batch\npriorityClassName: interactive-video\npodSets:\n- count: 1\n  resources: {nvidia.com/gpu: 8}\n  topologyRequest:     # node = NVLink domain\n    required: kubernetes.io/hostname</pre>' +
          '<div class="note">Rule of thumb: <b>route</b> what is short and stateless-ish; <b>schedule</b> what is long and needs exclusive, co-located resources.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.ghost[1], 400);
          ctx.fade(S.drops, 0, 400);
          S.glob = ctx.group();
          S.router = ctx.node({ x: 420, y: 288, w: 300, h: 58, title: 'Inference Router', sub: 'L7 · KV/prefix-aware · SLO', icon: 'net', color: 'blue', parent: S.glob });
          S.sched = ctx.node({ x: 858, y: 288, w: 330, h: 58, title: 'Global Scheduler', sub: 'priority · fair share · gangs', icon: 'queue', color: 'red', parent: S.glob });
          ctx.reveal(S.router, { from: 'up' });
          ctx.reveal(S.sched, { from: 'up', delay: 150 });
          S.qG = ctx.group({ parent: S.glob });
          ctx.text(1101, 258, 'job queue', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: S.qG });
          for (var i = 0; i < 6; i++) ctx.rect(1040 + i * 21, 272, 17, 32, { rx: 3, stroke: ctx.alpha('lime', 0.45), sw: 1, dash: '3 3', parent: S.qG });
          ctx.reveal(S.qG, { delay: 250 });
          S.lk1 = ctx.link(S.llmGrid, S.router, { color: 'amber', from: 'b', to: 't', parent: S.glob });
          ctx.reveal(S.lk1, { from: 'draw', delay: 350 });
          ctx.hotspot(S.router, 'load-balancing');
          ctx.hotspot(S.sched, 'scheduler');
          S.qItems = [];
          for (var k = 0; k < 6; k++) {
            var g = ctx.group({ parent: S.glob });
            ctx.rect(-8, -13, 16, 26, { rx: 3, fill: ctx.alpha('lime', 0.55), stroke: 'lime', sw: 1, parent: g });
            ctx.place(g, S.shotC[k].x, S.shotC[k].y);
            ctx.transform(g, { x: 1040 + k * 21 + 8.5, y: 288 }, 800, 'inOut', 500 + k * 160);
            S.qItems.push(g);
          }
          ctx.fade(S.shots, 0.35, 600);
          return ctx.wait(700).then(function () {
            return Promise.all([
              ctx.packet(S.lk1, { color: 'amber', dur: 700, label: 'chat()' }),
              ctx.wait(300).then(function () { return ctx.packet(S.lk1, { color: 'amber', dur: 700 }); }),
              ctx.wait(600).then(function () { return ctx.packet(S.lk1, { color: 'amber', dur: 700 }); }),
              ctx.wait(1400)
            ]);
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Regional clusters',
        say: 'Next, the global layer picks a region. Each region runs Kubernetes clusters with node pools of different accelerators: H100 and H200 servers, newer B200 nodes, and GB200 NVL72 racks where seventy two GPUs share one NVLink domain. The choice weighs free capacity, network latency to the user, data residency, price, and whether the model weights are already warm there. LLM calls stay close to the user. Video jobs can travel to wherever GPUs sit idle, because a few extra milliseconds mean nothing to a ninety second render.',
        deep: '<p>Per-cluster software stack: NVIDIA <b>GPU Operator</b> (driver, container toolkit, device plugin, DCGM exporter), GPUs exposed via the device plugin or <b>DRA</b> (Dynamic Resource Allocation, GA in Kubernetes 1.34), node labels for GPU type, NVLink domain and IB rail. Multi-cluster dispatch: Kueue <i>MultiKueue</i>, Karmada, or a bespoke global scheduler.</p>' +
          '<p>Region choice is constrained optimisation:</p>' +
          '<div class="eq">r* = argmax<sub>r ∈ feasible</sub> w<sub>1</sub>·free<sub>GPU</sub>(r) − w<sub>2</sub>·RTT(r) − w<sub>3</sub>·$/GPU·h(r) + w<sub>4</sub>·𝟙[weights warm]</div>' +
          '<p>Hard constraints first (residency, model availability, quota), soft scores second. For interactive LLM traffic w<sub>2</sub> dominates (cross-continent RTT ≈ 80–150 ms is a large slice of a 1 s TTFT budget); for video jobs RTT is noise next to ~95 s of compute, so capacity and price dominate — "follow the idle GPUs".</p>' +
          '<div class="note">Heterogeneous pools are normal: L40S-class cards for VAE decode, encoders and safety classifiers; H100/H200 for LLM decode; B200 / GB200 for DiT FLOPs.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.ghost[2], 400);
          S.reg = ctx.group();
          S.cl = [];
          S.utilBars = [];
          CLUSTERS.forEach(function (c, i) {
            var n = ctx.node({ x: c.x, y: 402, w: 270, h: 104, color: 'red', parent: S.reg });
            var x0 = c.x - 135;
            ctx.icon('server', x0 + 24, 368, 18, 'red', { parent: n });
            ctx.text(x0 + 40, 368, c.name, { size: 13, weight: 600, color: 'white', font: 'display', parent: n });
            c.pools.forEach(function (p, j) {
              var y = 391 + j * 20;
              ctx.rect(x0 + 16, y - 4, 8, 8, { rx: 2, fill: p[1], parent: n });
              ctx.text(x0 + 32, y, p[0], { size: 11, font: 'mono', color: 'text', parent: n });
              ctx.rect(x0 + 192, y - 4, 64, 8, { rx: 3, fill: ctx.alpha('white', 0.07), parent: n });
              S.utilBars.push(ctx.rect(x0 + 192, y - 4, 40, 8, { rx: 3, fill: ctx.alpha(p[1], 0.85), parent: n }));
            });
            S.cl.push(n);
            ctx.reveal(n, { from: 'up', delay: i * 160 });
          });
          S.utilLoop = ctx.loop(function (t) {
            S.utilBars.forEach(function (b, k) {
              b.setAttribute('width', (64 * (0.62 + 0.3 * Math.sin(t * 0.7 + k * 1.3))).toFixed(1));
            });
          });
          S.rl = [
            ctx.link(S.router, S.cl[0], { color: 'blue', from: 'b', to: 't', parent: S.reg }),
            ctx.link(S.router, S.cl[1], { color: 'blue', from: 'b', to: 't', parent: S.reg }),
            ctx.link(S.sched, S.cl[1], { color: 'red', from: 'b', to: 't', parent: S.reg }),
            ctx.link(S.sched, S.cl[2], { color: 'red', from: 'b', to: 't', parent: S.reg })
          ];
          ctx.reveal(S.rl, { from: 'draw', delay: 500, stagger: 120 });
          return ctx.wait(1100).then(function () {
            return Promise.all([
              ctx.packet(S.rl[0], { color: 'amber', dur: 600 }),
              ctx.packet(S.rl[1], { color: 'amber', dur: 800 }),
              ctx.wait(400).then(function () { return ctx.packet(S.rl[3], { color: 'lime', dur: 900, r: 6 }); }),
              ctx.wait(700).then(function () { return ctx.packet(S.rl[2], { color: 'lime', dur: 900, r: 6 }); })
            ]);
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Inference servers',
        say: 'Inside a cluster, pods run inference servers. For language models these are engines like vLLM, SGLang or TensorRT LLM. They keep a continuous batch of many requests on the GPU, store attention keys and values in a paged KV cache, and stream tokens back. Video models run in custom diffusion transformer servers. One job owns a whole eight GPU gang, loops over forty denoising steps on a latent of about seventy five thousand tokens, then decodes it to pixels with the VAE.',
        deep: '<p><b>LLM engines</b>: iteration-level (continuous) batching admits new requests every decode step; <b>PagedAttention</b> stores KV in fixed-size blocks (16 tokens) so memory fragmentation stays &lt; 4%; radix-tree <b>prefix caching</b> reuses shared system prompts. KV footprint per token (GQA):</p>' +
          '<div class="eq">KV/token = 2 · n<sub>layers</sub> · n<sub>kv</sub> · d<sub>head</sub> · bytes = 2·80·8·128·2 B ≈ 320 KB (70B-class, BF16)</div>' +
          '<p><b>Video DiT server</b> (e.g. Wan-2.1-14B, 720p, 81 frames): VAE latent 16×21×90×160, patchified 1×2×2 → N = 21·45·80 ≈ 75.6k tokens. FLOPs per denoising step:</p>' +
          '<div class="eq">F ≈ 2·N·P + 4·L·N²·d ≈ 2.1 + 4.7 ≈ 6.8 PFLOP  (×2 with CFG)</div>' +
          '<p>40 steps × 2 × 6.8 PF ≈ 5.4×10<sup>17</sup> FLOP. At ~40% MFU on 8×B200 (~2.25 PF dense BF16 each) that is ≈ 75 s; on 8×H100 ≈ 170 s — hence gangs, sequence parallelism, step distillation and caching (see <i>Video Model Serving</i>).</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.ghost[3], 400);
          S.serv = ctx.group();
          /* LLM engines */
          S.kv = []; S.slots = [];
          ENGINES.forEach(function (e, i) {
            var x0 = 232 + i * 138, g = ctx.group({ parent: S.serv });
            ctx.rect(x0, 486, 128, 100, { rx: 8, fill: 'url(#fx-panel-grad)', stroke: 'amber', sw: 1.3, parent: g });
            ctx.text(x0 + 10, 502, e[0], { size: 14, weight: 600, color: 'white', font: 'display', parent: g });
            ctx.text(x0 + 10, 520, e[1], { size: 11, color: 'amber', font: 'mono', parent: g });
            ctx.text(x0 + 10, 540, 'KV', { size: 11, color: 'dim', font: 'mono', parent: g });
            ctx.rect(x0 + 32, 536, 86, 8, { rx: 3, fill: ctx.alpha('white', 0.07), parent: g });
            S.kv.push(ctx.rect(x0 + 32, 536, 60, 8, { rx: 3, fill: ctx.alpha('amber', 0.85), parent: g }));
            var row = [];
            for (var s = 0; s < 8; s++) row.push(ctx.rect(x0 + 10 + s * 13, 556, 10, 16, { rx: 2, fill: ctx.alpha('amber', 0.3), parent: g }));
            S.slots.push(row);
            ctx.reveal(g, { from: 'up', delay: i * 120 });
          });
          S.llmBox = ctx.node({ x: 434, y: 536, w: 424, h: 118, kind: 'ghost', color: 'amber', parent: S.serv });
          ctx.reveal(S.llmBox, { delay: 400 });
          /* DiT workers */
          S.prog = []; S.stepTxt = []; S.lat = [];
          var rn = ctx.rng(74);
          S.noise = [];
          for (var q = 0; q < 42; q++) S.noise.push(rn());
          [2, 3].forEach(function (shot, i) {
            var x0 = 668 + i * 250, g = ctx.group({ parent: S.serv });
            ctx.rect(x0, 486, 238, 100, { rx: 8, fill: 'url(#fx-panel-grad)', stroke: 'lime', sw: 1.3, parent: g });
            ctx.text(x0 + 10, 502, 'DiT worker · shot ' + shot, { size: 13, weight: 600, color: 'white', font: 'display', parent: g });
            ctx.text(x0 + 10, 520, '8×B200 · SP8 · CFG-batch', { size: 11, color: 'lime', font: 'mono', parent: g });
            ctx.rect(x0 + 10, 534, 150, 8, { rx: 3, fill: ctx.alpha('white', 0.07), parent: g });
            S.prog.push(ctx.rect(x0 + 10, 534, 60, 8, { rx: 3, fill: ctx.alpha('lime', 0.85), parent: g }));
            S.stepTxt.push(ctx.text(x0 + 168, 538, 'step 17/40', { size: 11, color: 'text', font: 'mono', parent: g }));
            S.lat.push(ctx.matrix(x0 + 10, 552, 3, 14, { cell: 7, gap: 2, cmap: 'lime', values: function () { return 0.3; }, parent: g }));
            ctx.text(x0 + 144, 558, '75.6k tokens', { size: 11, color: 'dim', font: 'mono', parent: g });
            ctx.text(x0 + 144, 574, '21×45×80', { size: 11, color: 'dim', font: 'mono', parent: g });
            ctx.reveal(g, { from: 'up', delay: 200 + i * 140 });
          });
          S.vidBox = ctx.node({ x: 912, y: 536, w: 500, h: 118, kind: 'ghost', color: 'lime', parent: S.serv });
          ctx.reveal(S.vidBox, { delay: 500 });
          ctx.hotspot(S.llmBox, 'llm-serving', { hint: 'LLM SERVING ⤢' });
          ctx.hotspot(S.vidBox, 'video-serving', { hint: 'VIDEO SERVING ⤢' });
          S.sl = [
            ctx.link(S.cl[0], S.llmBox, { color: 'amber', from: 'b', to: 't', parent: S.serv }),
            ctx.link(S.cl[2], S.vidBox, { color: 'lime', from: 'b', to: 't', parent: S.serv })
          ];
          ctx.reveal(S.sl, { from: 'draw', delay: 600, stagger: 150 });
          var lastTick = -1, lastStep = [-1, -1];
          S.servLoop = ctx.loop(function (t) {
            var tick = Math.floor(t * 5);
            if (tick !== lastTick) {
              lastTick = tick;
              S.slots.forEach(function (row, i) {
                row.forEach(function (el, s) {
                  var on = ((tick * 7 + s * 13 + i * 5) % 11) > 2;
                  el.setAttribute('fill', on ? ctx.alpha('amber', 0.55 + 0.4 * (((s + tick + i) % 3) / 2)) : ctx.alpha('amber', 0.12));
                });
                S.kv[i].setAttribute('width', (86 * (0.6 + 0.3 * Math.abs(Math.sin(tick * 0.09 + i)))).toFixed(1));
              });
            }
            [0, 1].forEach(function (i) {
              var st = Math.floor((t * 2.2 + i * 17) % 40) + 1;
              if (st === lastStep[i]) return;
              lastStep[i] = st;
              var k = st / 40;
              S.prog[i].setAttribute('width', (150 * k).toFixed(1));
              S.stepTxt[i].textContent = 'step ' + st + '/40';
              S.lat[i].set(function (r, c) {
                var clean = 0.5 + 0.45 * Math.sin(c * 0.55 + r * 0.9 + i);
                return (1 - k) * S.noise[r * 14 + c] + k * clean;
              });
            });
          });
          return ctx.wait(900).then(function () {
            return Promise.all([
              ctx.packet(S.sl[0], { color: 'amber', dur: 600 }),
              ctx.packet(S.sl[1], { color: 'lime', dur: 700, r: 6 }),
              ctx.wait(1800)
            ]);
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'GPUs & fabrics',
        say: 'Zoom into the metal. An HGX H100 server has eight GPUs with eighty gigabytes of HBM each, fully connected through NVSwitch at nine hundred gigabytes per second per GPU. A GB200 NVL72 rack stretches that NVLink domain to seventy two GPUs. Between servers, traffic crosses InfiniBand or RoCE Ethernet at four hundred to eight hundred gigabits per second per GPU, and GPUDirect RDMA moves tensors from the network card straight into HBM. That is still more than ten times slower than NVLink, which is why placement matters.',
        deep: '<table><tr><th>Link</th><th>Bandwidth (per GPU)</th><th>Scope</th></tr>' +
          '<tr><td>HBM3 (H100) / HBM3e (B200)</td><td>3.35 / 8 TB/s</td><td>on package</td></tr>' +
          '<tr><td>NVLink 4 / NVLink 5</td><td>900 GB/s / 1.8 TB/s (bidir.)</td><td>8 GPUs / 72 GPUs (NVL72)</td></tr>' +
          '<tr><td>PCIe Gen5 x16</td><td>~64 GB/s per direction</td><td>host, NIC, NVMe</td></tr>' +
          '<tr><td>IB NDR / XDR, Spectrum-X</td><td>400 / 800 Gb/s = 50 / 100 GB/s</td><td>whole cluster</td></tr></table>' +
          '<p><b>Rail-optimised</b> fabric: GPU k of every node attaches to leaf switch k, so same-rank collectives stay one hop. <b>GPUDirect RDMA</b> lets the NIC DMA directly into HBM (no host bounce buffer); <b>GPUDirect Storage</b> does the same for NVMe.</p>' +
          '<p>Ring all-reduce time for S bytes over p GPUs at link bandwidth B:</p>' +
          '<div class="eq">T ≈ 2·(p−1)/p · S / B</div>' +
          '<p>A video gang doing Ulysses all-to-all moves ≈ 0.3 GB per GPU per layer; at 450 GB/s (NVLink4, one direction) that is ≈ 0.75 ms per layer (≈ 2.4 s per shot over 40 layers × 80 forwards); if every byte had to cross 50 GB/s IB it would be ≈ 7 ms per layer → ≈ 22 s of pure communication per shot, a quarter of the compute time. Hence: keep a shot inside one NVLink domain. The separate <b>storage / front-end network</b> carries weights, checkpoints and media so it never competes with collective traffic.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.ghost[4], 400);
          ctx.fade(S.drops, 0, 10);
          S.hw = ctx.group();
          /* HGX H100 */
          S.h100 = ctx.node({ x: 410, y: 713, w: 370, h: 182, color: 'amber', parent: S.hw });
          ctx.text(239, 640, 'HGX H100 · LLM pool', { size: 13, weight: 600, color: 'white', font: 'display', parent: S.h100 });
          ctx.text(581, 640, '8 × 80 GB HBM3', { size: 11, color: 'dim', font: 'mono', anchor: 'end', parent: S.h100 });
          S.h100chips = [];
          for (var i = 0; i < 8; i++) {
            var cx = 243 + (i % 4) * 85, cy = i < 4 ? 656 : 740;
            S.h100chips.push(chip(ctx, cx, cy, 74, 42, 'H100', '3.35 TB/s', 'amber', S.h100));
            ctx.line(cx + 37, i < 4 ? 698 : 740, cx + 37, i < 4 ? 708 : 730, { color: ctx.alpha('amber', 0.6), sw: 1.2, parent: S.h100 });
          }
          ctx.rect(243, 708, 329, 22, { rx: 4, fill: ctx.alpha('red', 0.12), stroke: ctx.alpha('red', 0.7), sw: 1, parent: S.h100 });
          ctx.text(407, 719.5, 'NVSwitch · NVLink4 900 GB/s per GPU', { size: 11, color: 'red', anchor: 'middle', font: 'mono', parent: S.h100 });
          /* GB200 NVL72 rack */
          S.rack = ctx.node({ x: 750, y: 713, w: 270, h: 182, color: 'red', parent: S.hw });
          ctx.text(629, 640, 'GB200 NVL72 rack', { size: 13, weight: 600, color: 'white', font: 'display', parent: S.rack });
          for (var tr = 0; tr < 27; tr++) {
            var isSw = tr >= 10 && tr < 19;
            ctx.rect(629, 654 + tr * 5.2, 120, 4, { rx: 1, fill: isSw ? ctx.alpha('cyan', 0.55) : ctx.alpha('red', 0.5), parent: S.rack });
          }
          ctx.para(760, 662, ['72 Blackwell GPUs', '36 Grace CPUs', '~13.5 TB HBM3e', 'NVLink5 1.8 TB/s', '130 TB/s domain', '~120 kW, liquid'], { size: 11, color: 'text', font: 'mono', lh: 18, parent: S.rack });
          ctx.text(760, 776, 'cyan = NVSwitch', { size: 11, color: 'cyan', font: 'mono', parent: S.rack });
          /* HGX B200 video gang */
          S.b200 = ctx.node({ x: 1035, y: 713, w: 260, h: 182, color: 'lime', parent: S.hw });
          ctx.text(919, 640, 'HGX B200 · shot 3', { size: 13, weight: 600, color: 'white', font: 'display', parent: S.b200 });
          ctx.text(1151, 640, 'SP = 8', { size: 11, color: 'lime', font: 'mono', anchor: 'end', parent: S.b200 });
          S.b200chips = [];
          for (var j = 0; j < 8; j++) {
            var bx = 919 + (j % 4) * 60, by = j < 4 ? 656 : 740;
            S.b200chips.push(chip(ctx, bx, by, 52, 42, 'B200', 'SP' + j, 'lime', S.b200));
            ctx.line(bx + 26, j < 4 ? 698 : 740, bx + 26, j < 4 ? 708 : 730, { color: ctx.alpha('lime', 0.6), sw: 1.2, parent: S.b200 });
          }
          ctx.rect(919, 708, 232, 22, { rx: 4, fill: ctx.alpha('red', 0.12), stroke: ctx.alpha('red', 0.7), sw: 1, parent: S.b200 });
          ctx.text(1035, 719.5, 'NVLink5 · 1.8 TB/s per GPU', { size: 11, color: 'red', anchor: 'middle', font: 'mono', parent: S.b200 });
          ctx.reveal([S.h100, S.rack, S.b200], { from: 'up', stagger: 180 });
          /* fabrics */
          S.fab = ctx.group({ parent: S.hw });
          ctx.line(240, 826, 1150, 826, { color: ctx.alpha('cyan', 0.8), sw: 2.2, parent: S.fab });
          [410, 690, 1035].forEach(function (x) { ctx.line(x, 804, x, 826, { color: ctx.alpha('cyan', 0.8), sw: 1.6, parent: S.fab }); });
          ctx.text(695, 843, 'InfiniBand NDR/XDR or Spectrum-X RoCE · 400–800 Gb/s per GPU · rail-optimized · GPUDirect RDMA', { size: 11, color: 'cyan', anchor: 'middle', font: 'mono', parent: S.fab });
          ctx.line(240, 866, 1150, 866, { color: ctx.alpha('teal', 0.6), sw: 1.4, dash: '6 5', parent: S.fab });
          tag(ctx, 695, 866, 'storage / front-end net · 2×200 GbE → parallel FS + object store', 'teal', S.fab);
          ctx.reveal(S.fab, { from: 'fade', delay: 600 });
          ctx.hotspot(S.h100, 'gpu', { hint: 'INSIDE THE GPU ⤢' });
          ctx.hotspot(S.b200, 'parallelism', { hint: 'PARALLELISM ⤢' });
          /* traffic: fast NVLink vs slower IB */
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
          ctx.focus([S.bandsG, S.hw], 0);
          return ctx.wait(500).then(function () { return ctx.camera(695, 745, 1.6, 1400); }).then(function () { return ctx.wait(1500); });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Weights & registry',
        say: 'Before a GPU can serve, it needs weights, and weights are huge. A frontier mixture of experts model in FP8 is around seven hundred gigabytes. Our video model plus its text encoder is about forty. The model registry stores signed, versioned checkpoints. Weight distribution moves them: node local NVMe caches avoid downloading twice, peer to peer broadcast lets new nodes copy from their neighbours instead of hammering object storage, and streaming loaders push tensors into GPU memory while the rest are still arriving.',
        deep: '<p>Sizes: DeepSeek-V3-class 671B MoE in FP8 ≈ 700 GB; 70B dense FP8 ≈ 70 GB; Wan-14B DiT BF16 ≈ 28 GB + umT5-XXL encoder ≈ 11 GB + VAE ≈ 0.5 GB.</p>' +
          '<p>Time to make N fresh nodes serve-ready with an S-byte checkpoint:</p>' +
          '<div class="eq">T<sub>origin</sub> ≈ N·S / B<sub>origin</sub><br>T<sub>doubling</sub> ≈ ⌈log<sub>2</sub>N⌉ · S / B<sub>NIC</sub>   (whole-file binomial tree)<br>T<sub>pipelined</sub> ≈ (S + h·c) / B<sub>NIC</sub>   (chunked chain/tree, depth h)</div>' +
          '<p>(c = chunk size, e.g. 64 MB.) With N = 16, S = 700 GB, B<sub>origin</sub> = 50 GB/s aggregate, B<sub>NIC</sub> = 50 GB/s (400 Gb/s): origin ≈ 224 s, whole-file doubling ≈ 56 s, chunked pipeline ≈ 14 s + load, local NVMe hit (~25 GB/s RAID) ≈ 28 s. Chunking is what makes P2P fast: every node forwards chunk k while receiving chunk k+1 (the Dragonfly / Kraken / BitTorrent idea). Numbers in the chart are illustrative.</p>' +
          '<ul><li><b>Streaming load</b> (Run:ai Model Streamer, fastsafetensors): overlap object-store reads, host staging and H2D copies; each TP rank reads only its shard.</li>' +
          '<li><b>Integrity</b>: per-shard SHA-256 + signed manifests (Sigstore-style model signing); the registry pins <code>model@sha</code>, never "latest".</li>' +
          '<li><b>GPUDirect Storage</b> can DMA NVMe → HBM, skipping the CPU bounce.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.camera(null, null, null, 1000);
          ctx.focus(null);
          ctx.remove(S.ledger, 400);
          S.ctl = ctx.group();
          var hd = ctx.group({ parent: S.ctl });
          ctx.text(1210, 100, 'CONTROL PLANE', { size: 15, color: 'red', font: 'display', weight: 700, parent: hd });
          ctx.text(1210, 120, 'registry · weights · scaling · health', { size: 11, color: 'dim', font: 'mono', parent: hd });
          ctx.reveal(hd, { from: 'right' });
          S.regN = ctx.node({ x: 1382, y: 168, w: 360, h: 54, title: 'Model Registry', sub: 'versioned · signed · safetensors', icon: 'db', color: 'teal', titleSize: 15, parent: S.ctl });
          S.wdN = ctx.node({ x: 1382, y: 248, w: 360, h: 54, title: 'Weight Distribution', sub: 'NVMe cache · P2P broadcast · stream', icon: 'layers', color: 'teal', titleSize: 15, parent: S.ctl });
          ctx.reveal([S.regN, S.wdN], { from: 'right', stagger: 160, delay: 200 });
          S.cl1 = ctx.link(S.regN, S.wdN, { color: 'teal', from: 'b', to: 't', parent: S.ctl });
          ctx.reveal(S.cl1, { from: 'draw', delay: 500 });
          /* broadcast tree */
          S.tree = ctx.group({ parent: S.ctl });
          ctx.text(1210, 306, 'P2P broadcast', { size: 11, color: 'dim', font: 'mono', parent: S.tree });
          ctx.text(1210, 321, 'chunked, pipelined', { size: 11, color: 'dim', font: 'mono', parent: S.tree });
          var pts = [[1382, 312, 'origin'], [1302, 354, 'n1'], [1462, 354, 'n2'], [1262, 396, 'n3'], [1342, 396, 'n4'], [1422, 396, 'n5'], [1502, 396, 'n6']];
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
          ctx.reveal(S.tree, { delay: 600 });
          /* time-to-ready bars */
          S.ttr = ctx.group({ parent: S.ctl });
          ctx.text(1210, 436, 'time to ready · 16 nodes × 700 GB (illustrative)', { size: 11, color: 'text', font: 'mono', parent: S.ttr });
          var rows = [['origin pull', 224, 'red'], ['NVMe cache', 30, 'amber'], ['P2P + stream', 18, 'teal']];
          S.ttrBars = rows.map(function (r0, i) {
            var y = 458 + i * 26;
            ctx.text(1210, y + 8, r0[0], { size: 11, color: 'dim', font: 'mono', parent: S.ttr });
            var b = ctx.rect(1312, y, Math.max(3, r0[1] / 224 * 190), 16, { rx: 3, fill: ctx.alpha(r0[2], 0.6), stroke: r0[2], sw: 1, parent: S.ttr });
            ctx.text(1312 + Math.max(3, r0[1] / 224 * 190) + 6, y + 8.5, r0[1] + ' s', { size: 11, color: r0[2], font: 'mono', parent: S.ttr });
            return b;
          });
          ctx.reveal(S.ttr, { delay: 800 });
          S.ttrBars.forEach(function (b, i) {
            var w = parseFloat(b.getAttribute('width'));
            ctx.animate(b, { width: [0, w] }, 800, 'out', 900 + i * 200);
          });
          S.wl = ctx.link(S.wdN, S.cl[2], { color: 'teal', from: 'l', to: 'r', bend: { x: 1188, y: 400 }, dash: '5 5', parent: S.ctl });
          ctx.reveal(S.wl, { from: 'draw', delay: 700 });
          return ctx.wait(1200).then(function () {
            return Promise.all([
              ctx.packet(S.cl1, { color: 'teal', dur: 500 }).then(function () { return ctx.packet(S.wl, { color: 'teal', dur: 1000, label: 'weights' }); }),
              Promise.all(S.treeE.slice(0, 2).map(function (e) { return ctx.packet(e, { color: 'teal', dur: 500, r: 4 }); })).then(function () {
                return Promise.all(S.treeE.slice(2).map(function (e) { return ctx.packet(e, { color: 'teal', dur: 500, r: 4 }); }));
              })
            ]);
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Scale & heal',
        say: 'The control plane also keeps the fleet healthy and right sized. Health agents watch DCGM telemetry and driver XID errors. When a GPU falls off the bus, the node is cordoned and drained, and its work is retried elsewhere from the last checkpoint. The autoscaler watches queue depth and the backlog of GPU seconds, not CPU load, and pulls nodes from a warm pool before the queue explodes. Observability ties it together: every request and every GPU second is traced and attributed.',
        deep: '<ul><li><b>Health</b>: DCGM field watches (ECC, thermals, NVLink CRC/replay counters), driver XIDs (79 = fell off the bus, 48 = double-bit ECC, 94/95 = contained/uncontained ECC), periodic NCCL all-reduce bandwidth tests and burn-in on new nodes. At 10<sup>4</sup> GPUs something fails every few hours (MegaScale, Llama 3 reports ~1 interruption per ~3 h at 16k GPUs).</li>' +
          '<li><b>Remediation</b>: cordon → drain → reboot / GPU reset → re-burn-in → uncordon, or RMA. Long jobs resume from checkpoints; LLM replicas just drain.</li>' +
          '<li><b>Autoscaling signal</b>: not CPU. Use queue depth, KV-cache utilisation and GPU-second backlog:</li></ul>' +
          '<div class="eq">nodes<sub>+</sub> = ⌈ backlog<sub>GPU·s</sub> / (T<sub>drain</sub> · 8) ⌉ − idle<sub>nodes</sub></div>' +
          '<p>e.g. 2 queued shots × 8 × 95 GPU·s = 1,520 GPU·s; drain target 190 s → 1 node. KEDA / custom controllers act on these metrics; warm pools hide the 2–10 min bare-metal provisioning time.</p>' +
          '<ul><li><b>Observability</b>: DCGM exporter → Prometheus (SM active, tensor-pipe active, HBM used, NVLink/IB throughput); OpenTelemetry spans per request; per-tenant GPU·s accounting; SLO burn-rate alerts on TTFT/TPOT.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          S.ctl2 = ctx.group();
          S.asN = ctx.node({ x: 1382, y: 580, w: 360, h: 54, title: 'Autoscaler', sub: 'queue depth · GPU-s backlog · KV util', icon: 'chart', color: 'red', titleSize: 15, parent: S.ctl2 });
          S.hlN = ctx.node({ x: 1382, y: 660, w: 360, h: 54, title: 'Health & Remediation', sub: 'DCGM · XID · NCCL tests · drain', icon: 'shield', color: 'red', titleSize: 15, parent: S.ctl2 });
          S.obN = ctx.node({ x: 1382, y: 740, w: 360, h: 54, title: 'Observability', sub: 'DCGM exporter · OTel · SLO burn', icon: 'eye', color: 'red', titleSize: 15, parent: S.ctl2 });
          ctx.reveal([S.asN, S.hlN, S.obN], { from: 'right', stagger: 150 });
          /* sparkline: queue depth vs nodes */
          S.spark = ctx.group({ parent: S.ctl2 });
          ctx.text(1215, 790, 'queue depth', { size: 11, color: 'lime', font: 'mono', parent: S.spark });
          ctx.text(1545, 790, 'nodes', { size: 11, color: 'red', font: 'mono', anchor: 'end', parent: S.spark });
          var q = ctx.plot(1215, 802, 330, 62, function (x) { return 0.15 + 0.75 * Math.exp(-Math.pow((x - 0.38) / 0.16, 2)); }, { color: 'lime', sw: 2, parent: S.spark });
          var n = ctx.plot(1215, 802, 330, 62, [[0, 0.25], [0.3, 0.25], [0.3, 0.45], [0.42, 0.45], [0.42, 0.65], [0.75, 0.65], [0.75, 0.45], [1, 0.45]], { color: 'red', sw: 2, axes: false, parent: S.spark });
          ctx.reveal(S.spark, { delay: 400 });
          ctx.reveal([q.curve, n.curve], { from: 'draw', dur: 1400, delay: 500, stagger: 300 });
          /* failure + remediation in the H100 node */
          var fc = S.h100chips[5].box;
          S.fail = ctx.group({ parent: S.hw });
          ctx.rect(fc.x, fc.y, fc.w, fc.h, { rx: 4, fill: '#2a0a12', stroke: 'red', sw: 2, parent: S.fail, glow: true });
          ctx.text(fc.cx, fc.cy - 8, 'XID 79', { size: 12, color: 'red', anchor: 'middle', font: 'mono', weight: 700, parent: S.fail });
          ctx.text(fc.cx, fc.cy + 9, 'off bus', { size: 11, color: 'red', anchor: 'middle', font: 'mono', parent: S.fail });
          ctx.reveal(S.fail, { delay: 600, dur: 300 });
          S.cordon = tag(ctx, 407.5, 719, 'node cordoned · draining · replicas re-route', 'red', S.hw, 331);
          ctx.reveal(S.cordon, { delay: 1300 });
          S.warm = tag(ctx, 437, 368, '+1 node · warm pool', 'lime', S.reg);
          ctx.reveal(S.warm, { from: 'scale', delay: 2000 });
          return ctx.wait(700).then(function () {
            return ctx.pulse(S.h100, { color: 'red', dur: 700 });
          }).then(function () {
            return ctx.pulse(S.hlN, { color: 'red', dur: 600 });
          }).then(function () {
            return Promise.all([ctx.pulse(S.asN, { color: 'lime', dur: 600 }), ctx.pulse(S.cl[0], { color: 'lime', dur: 800 })]);
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Follow the trailer',
        say: 'Now follow our trailer through the whole stack. Each LLM call hits the router, lands on a replica that already holds the agent\'s prompt prefix, and gets its first token within a few hundred milliseconds. Each video shot waits briefly in the queue, is gang scheduled onto eight GPUs inside one NVLink domain, and renders in about a minute and a half. Every glowing box opens a deeper chamber: the scheduler, the load balancer, both serving engines, the GPU itself, and distributed parallelism.',
        deep: '<p>End-to-end path of one call of each kind (typical, warm system):</p>' +
          '<table><tr><th>Hop</th><th>LLM call</th><th>Video shot</th></tr>' +
          '<tr><td>Global</td><td>router pick &lt; 1 ms</td><td>queue wait 0–30 s</td></tr>' +
          '<tr><td>Cluster</td><td>replica already running</td><td>gang admit + pod start ~2–5 s (warm)</td></tr>' +
          '<tr><td>Engine</td><td>TTFT ~0.2–0.5 s (prefix hit)</td><td>40 steps × CFG ≈ 75–95 s</td></tr>' +
          '<tr><td>Output</td><td>~50–100 tok/s streamed</td><td>VAE decode ~5 s, upload clip</td></tr>' +
          '<tr><td>GPU cost</td><td>~0.5–3 GPU·s</td><td>~760 GPU·s</td></tr></table>' +
          '<p>Where to dig next:</p><ul>' +
          '<li><b>Scheduler</b>: gangs, fair share, preemption, cold starts.</li>' +
          '<li><b>Load balancing</b>: power-of-two, prefix-aware routing, queueing.</li>' +
          '<li><b>LLM / video serving</b>: batching, KV cache, sequence parallel DiT.</li>' +
          '<li><b>GPU</b> and <b>parallelism</b>: SMs, HBM, roofline; DP/TP/PP/EP/SP.</li></ul>',
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
          ctx.reveal(S.tA, { from: 'draw', dur: 1400 });
          ctx.reveal(S.tB, { from: 'draw', dur: 1600, delay: 300 });
          S.tags = [
            tag(ctx, 632, 288, 'prefix-aware pick', 'amber', S.tagG),
            tag(ctx, 430, 612, 'TTFT ~0.3 s · ~60 tok/s', 'amber', S.tagG),
            tag(ctx, 1101, 322, 'queued ~5 s', 'lime', S.tagG),
            tag(ctx, 1040, 612, 'gang · 8 GPU · 1 NVLink domain', 'lime', S.tagG)
          ];
          ctx.reveal(S.tags, { from: 'scale', delay: 900, stagger: 250 });
          ctx.hud('per trailer: LLM ≈ 1 GPU-min · video ≈ 76 GPU-min');
          var hs = [S.router, S.sched, S.llmBox, S.vidBox, S.h100, S.b200];
          return ctx.wait(1200).then(function () {
            return Promise.all([
              ctx.packet(S.tA, { color: 'amber', dur: 1600, label: 'chat()', parent: S.tagG }),
              ctx.packet(S.tB, { color: 'lime', dur: 2400, r: 7, label: 'shot 3', parent: S.tagG })
            ]);
          }).then(function () {
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
