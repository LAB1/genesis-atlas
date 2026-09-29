/* L2 — GPU Cluster Scheduling. Queues, fair share, Tetris-style placement, gangs, topology, preemption,
 * autoscaling / cold starts and GPU sharing, animated on a 6-node (48-GPU) slice of the fleet.
 * Every step is split into beats (one idea each): narration, callout card, deep-dive chunk and animation segment. */
(function () {
  var GX = 700, P = 45, CELL = 40;
  function rowY(r) { return 175 + r * 50 + (r >= 3 ? 14 : 0); }
  function cellX(c) { return GX + c * P; }

  var LANES = [
    { y: 215, title: 'Interactive LLM', sub: 'TTFT p99 < 1 s', col: 'amber' },
    { y: 300, title: 'Batch video', sub: 'minutes · 8-GPU gangs', col: 'lime' },
    { y: 385, title: 'Train / fine-tune', sub: 'best-effort · preemptible', col: 'blue' }
  ];
  var LLM_JOBS = [
    { id: 'a', g: 4, label: 'TP4' }, { id: 'b', g: 4, label: 'TP4' }, { id: 'c', g: 2, label: 'TP2' }, { id: 'd', g: 2, label: 'TP2' },
    { id: 'e', g: 1, label: 'emb' }, { id: 'f', g: 1, label: 'safe' }, { id: 'g', g: 1, label: 'rrk' }, { id: 'h', g: 1, label: 'asr' }
  ];
  /* spread (LeastAllocated) placement, arrival order a..h, ties to the lowest node index: row, first column.
   * a,b take nodes 0,1; every later pod goes to whichever of nodes 2,3 has more free GPUs -> free = 4,4,4,4,0,0 */
  var SPREAD = { a: [0, 0], b: [1, 0], c: [2, 0], d: [3, 0], e: [2, 2], f: [3, 2], g: [2, 3], h: [3, 3] };
  /* pack (MostAllocated) placement of the same arrivals: nodes 0 and 1 fill up, nodes 2 and 3 stay whole */
  var PACK = { a: [0, 0], b: [0, 4], c: [1, 0], d: [1, 2], e: [1, 4], f: [1, 5], g: [1, 6], h: [1, 7] };
  /* on-screen box of a piece including any transform applied later */
  function liveBox(p) {
    var tf = p._tf || { x: 0, y: 0 }, b = p.box;
    return { x: b.x + tf.x, y: b.y + tf.y, w: b.w, h: b.h, cx: b.cx + tf.x, cy: b.cy + tf.y };
  }

  /* allocation rectangle on the GPU grid */
  function piece(ctx, parent, r, c0, span, rows, col, label) {
    var x = cellX(c0), y = rowY(r), w = span * P - 5, h = rows > 1 ? rowY(r + rows - 1) + CELL - y : CELL;
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 5, fill: ctx.alpha(col, 0.3), stroke: col, sw: 1.5, parent: g });
    ctx.text(x + w / 2, y + h / 2 + 0.5, label, { size: 12, color: 'white', anchor: 'middle', font: 'mono', weight: 600, parent: g });
    g.box = { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h };
    g.color = ctx.color(col);
    return g;
  }

  /* queue chip, right-aligned at xr */
  function chip(ctx, parent, xr, y, g, col, label) {
    var w = g === 1 ? 34 : 11 * g + 20;
    var grp = ctx.group({ parent: parent });
    ctx.rect(xr - w, y - 15, w, 30, { rx: 5, fill: ctx.alpha(col, 0.18), stroke: col, sw: 1.2, parent: grp });
    ctx.text(xr - w / 2, y + 0.5, label, { size: 11, color: col, anchor: 'middle', font: 'mono', weight: 600, parent: grp });
    grp.w = w;
    return grp;
  }

  function renderVideoLane(ctx, S, shots, more) {
    if (S.vLane) ctx.remove(S.vLane, 300);
    var g = ctx.group({ parent: S.lanesG });
    var xr = 596;
    shots.forEach(function (s) { var c = chip(ctx, g, xr, 300, 8, 'lime', 'shot' + s + ' · 8'); xr -= c.w + 4; });
    if (more > 0) ctx.text(xr - 4, 300, '+' + more, { size: 12, color: 'lime', anchor: 'end', font: 'mono', parent: g });
    S.vLane = g;
    ctx.reveal(g, { from: 'left', dur: 400 });
    return g;
  }

  /* pulse a piece at its on-screen place (pieces can carry a transform after a repack) */
  function pulseLive(ctx, p, o) {
    return ctx.pulse({ box: liveBox(p), parentNode: p.parentNode, color: p.color }, o);
  }

  /* bottom / right panel swapping */
  function swap(ctx, S, key, g) {
    if (S[key]) ctx.remove(S[key], 350);
    S[key] = g;
    ctx.reveal(g, { from: 'up', dur: 500, delay: 200 });
    return g;
  }
  function panelTitle(ctx, g, x, y, str, col) {
    return ctx.text(x, y, str, { size: 13, color: col || 'red', font: 'display', weight: 700, spacing: 1, parent: g });
  }
  /* column-aligned / indented text needs a true monospace */
  function lines(ctx, parent, x, y, arr, o) {
    return ctx.para(x, y, arr, Object.assign({ size: 12, color: 'text', font: 'code', pre: true, lh: 22, parent: parent }, o || {}));
  }

  Atlas.register({
    id: 'scheduler',
    refs: [
      'Ghodsi et al., <i>Dominant Resource Fairness: Fair Allocation of Multiple Resource Types</i>, NSDI 2011',
      'Mahajan et al., <i>Themis: Fair and Efficient GPU Cluster Scheduling</i>, NSDI 2020; Narayanan et al., <i>Heterogeneity-Aware Cluster Scheduling Policies for Deep Learning Workloads</i> (Gavel), OSDI 2020; Qiao et al., <i>Pollux: Co-adaptive Cluster Scheduling for Goodput-Optimized Deep Learning</i>, OSDI 2021',
      'Jeon et al., <i>Analysis of Large-Scale Multi-Tenant GPU Clusters for DNN Training Workloads</i> (Philly), USENIX ATC 2019',
      'Weng et al., <i>MLaaS in the Wild: Workload Analysis and Scheduling in Large-Scale Heterogeneous GPU Clusters</i>, NSDI 2022',
      'Kubernetes SIG Scheduling, <i>Kueue</i> documentation (ClusterQueue, cohorts, Topology-Aware Scheduling), 2025',
      'Volcano project, <i>Volcano</i> PodGroup documentation, 2025',
      'NVIDIA, <i>Multi-Instance GPU User Guide</i> and <i>Multi-Process Service</i> documentation (H100 / Blackwell), 2024–2025',
      'Daly, <i>A higher order estimate of the optimum checkpoint interval for restart dumps</i>, FGCS 2006',
      'Fu et al., <i>ServerlessLLM: Low-Latency Serverless Inference for Large Language Models</i>, OSDI 2024'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Three job classes',
        beats: [
          {
            say: 'The scheduler decides which job gets which GPUs, and when. Three classes of work compete for the same fleet, and each wants something different.',
            card: { tag: 'KEY IDEA', title: 'Three classes, one shared fleet', body: 'Interactive LLM serving, batch video and best-effort training all draw from the same GPUs. Sharing raises utilisation, but only if the scheduler understands classes.' },
            deep: '<p>Why one fleet instead of three static partitions? Interactive load is diurnal and bursty, video is queue-driven, and training is elastic. Separate pools must each be sized for their own peak, so the sum of peaks strands GPUs. A shared fleet with priorities lets each class use the others\' troughs.</p>' +
              '<p>The price is a scheduler that can say <b>who goes first</b> (priority), <b>who deserves how much</b> (fair share), <b>who can be interrupted</b> (preemption) and <b>where</b> (placement). The next steps build these one by one.</p>'
          },
          {
            say: 'Interactive LLM replicas must answer in under a second. Video shots are gangs of eight GPUs that run for minutes. Training and fine tuning jobs run for hours, but can be interrupted.',
            card: { tag: 'HOW IT WORKS', title: 'Each class, its own objective', body: 'Tail latency for LLM replicas, makespan for video gangs, goodput for training. Each class maps to a PriorityClass and its own Kueue queue.' },
            deep: '<p>Each class maps to a Kubernetes <code>PriorityClass</code> and a Kueue <code>ClusterQueue</code>; the scheduler must satisfy very different objectives at once:</p>' +
              '<table><tr><th>Class</th><th>Objective</th><th>Unit</th></tr>' +
              '<tr><td>Interactive LLM</td><td>tail latency (TTFT/TPOT p99)</td><td>long-lived replica, 1–8 GPUs</td></tr>' +
              '<tr><td>Video generation</td><td>makespan / throughput</td><td>job, gang of 8 (or 16–72 on NVL72)</td></tr>' +
              '<tr><td>Train / fine-tune</td><td>goodput, cost</td><td>elastic job, 8–1000s GPUs, checkpointable</td></tr></table>'
          },
          {
            say: 'Here is a slice of the cluster: six nodes of eight GPUs each, in two racks. Each node is one NVLink domain, and each cell is one GPU.',
            card: { tag: 'NUMBERS', title: 'A 48-GPU slice of the fleet', stat: { v: '48', u: 'GPUs', l: 'six nodes × 8 GPUs in two racks; every node is one NVLink domain' } },
            deep: '<p>The scheduler sees the fleet as a tree: <b>cluster → rack → node → GPU</b>. Every level has its own bandwidth: NVLink inside a node (450 GB/s per direction on H100), InfiniBand through a leaf switch between the nodes of a rack, and spine switches between racks (~50 GB/s per GPU, often oversubscribed).</p>' +
              '<p>The <b>node</b> is the unit that matters for gangs: eight GPUs behind one NVSwitch run sequence-parallel collectives at full speed. Racks matter for multi-node jobs and for failure domains (one power feed, one leaf switch).</p>'
          },
          {
            say: 'A fine tuning job has already backfilled the idle nodes of rack B, using sixteen GPUs that nobody else wanted a moment ago.',
            card: { tag: 'TRADE-OFF', title: 'Backfill recovers the troughs', body: 'Preemptible training keeps utilisation high, on the understanding that it is evicted the moment latency-critical work arrives.' },
            deep: '<div class="note"><b>Backfill</b>: preemptible training soaks up idle GPUs so utilisation stays high, on the understanding that it will be evicted when latency-critical work arrives. Multi-tenant trace studies (Microsoft Philly, Alibaba PAI) report low GPU utilisation and long queueing delays, in part because locality and fragmentation constraints leave GPUs idle while jobs wait; interactive pools must be provisioned for peak, so backfill is the cheapest way to recover the troughs.</div>' +
              '<p>The panel shows the class policy as a Kueue ClusterQueue: a nominal quota per class, a cohort to borrow idle quota from, and a preemption rule.</p>' +
              '<details><summary>Go deeper</summary><p>Not to be confused with classic backfilling in batch schedulers such as Slurm, where a lower-priority job may start early only if that does not delay the expected start of higher-priority jobs (EASY backfilling protects only the job at the head of the queue). Both use idle capacity, but the guarantee differs: backfilling promises <i>non-delay</i> to the jobs ahead in the queue, while borrowing in a cohort promises <i>reclaim by eviction</i> to the lender, which is why the borrower must be preemptible and should checkpoint.</p></details>'
          },
          {
            say: 'One scheduler has to work across eight orders of magnitude of time, from a millisecond routing decision to a day long training run. So scheduling is hierarchical: quota admission first, then pod placement, then batching inside each engine.',
            card: {
              tag: 'NUMBERS', title: 'Eight decades of time', stat: { v: '10⁸', l: 'ratio between the slowest and fastest scale the scheduler serves: 1 ms to 1 day' },
              more: '<p>1 day is 86,400 s and 1 ms is 10⁻³ s, a ratio of about 8.6×10⁷. No single algorithm serves both ends, which is why each layer has its own cadence and its own state.</p>'
            },
            deep: '<p>Time scales span eight decades, from sub-ms routing to day-long training, so scheduling is <b>hierarchical</b>: quota admission (Kueue) → pod placement (kube-scheduler / Volcano plugins) → per-GPU batching inside the engine.</p>' +
              '<p>Each layer runs at its own cadence: a kube-scheduler decision typically takes tens of milliseconds per pod once binding is included (an order-of-magnitude figure), Kueue admits per Workload in seconds, and an engine reschedules every decode iteration (~20 ms). Long jobs need rare decisions with a lot of context (topology, priority, checkpoint age); short requests need microsecond decisions with almost none.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* lanes */
          S.lanesG = ctx.group();
          S.laneG = LANES.map(function (L) {
            var g = ctx.group({ parent: S.lanesG });
            ctx.rect(60, L.y - 34, 540, 68, { rx: 10, fill: ctx.alpha(L.col, 0.05), stroke: ctx.alpha(L.col, 0.45), sw: 1.2, parent: g });
            ctx.text(74, L.y - 9, L.title, { size: 14, weight: 600, color: L.col, font: 'display', parent: g });
            ctx.text(74, L.y + 11, L.sub, { size: 11, color: 'dim', font: 'mono', parent: g });
            return g;
          });
          /* beat 0: three lanes */
          return ctx.reveal(S.laneG, { from: 'left', stagger: 160 }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the jobs of each class, and the class table */
            S.lChips = {};
            var xr = 596;
            S.lg = ctx.group({ parent: S.lanesG });
            LLM_JOBS.forEach(function (j) { var c = chip(ctx, S.lg, xr, 215, j.g, 'amber', j.label); S.lChips[j.id] = c; xr -= c.w + 4; });
            ctx.reveal(S.lg, { from: 'left', dur: 500 });
            renderVideoLane(ctx, S, [1, 2, 3], 3);
            S.tChip = chip(ctx, S.lanesG, 596, 385, 16, 'blue', 'ft-16 · full FT · 16 GPU');
            ctx.reveal(S.tChip, { from: 'left', dur: 500, delay: 200 });
            S.tableG = ctx.group();
            panelTitle(ctx, S.tableG, 1150, 182, 'JOB CLASSES');
            ['class', 'SLO', 'prio', 'preempt'].forEach(function (h, i) { ctx.text([1150, 1290, 1440, 1495][i], 206, h, { size: 11, color: 'dim', font: 'mono', parent: S.tableG }); });
            [['interactive LLM', 'TTFT p99 < 1 s', 'high', 'no', 'amber'], ['interactive video', 'preview < 2 min', 'high', 'no', 'lime'],
              ['batch video', 'shot < 15 min', 'mid', 'rarely', 'lime'], ['train / fine-tune', 'throughput', 'low', 'yes', 'blue']].forEach(function (row, i) {
              var y = 230 + i * 22;
              ctx.line(1150, y - 11, 1555, y - 11, { color: ctx.alpha('white', 0.06), sw: 1, parent: S.tableG });
              ctx.text(1150, y, row[0], { size: 11, color: row[4], font: 'mono', parent: S.tableG });
              ctx.text(1290, y, row[1], { size: 11, color: 'text', font: 'mono', parent: S.tableG });
              ctx.text(1440, y, row[2], { size: 11, color: 'text', font: 'mono', parent: S.tableG });
              ctx.text(1495, y, row[3], { size: 11, color: 'text', font: 'mono', parent: S.tableG });
            });
            return ctx.reveal(S.tableG, { from: 'right', delay: 300 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the 48-GPU slice */
            ctx.line(604, 300, 642, 300, { color: 'dim', sw: 1.4, arrow: true, parent: S.lanesG });
            S.gridG = ctx.group();
            for (var c = 0; c < 8; c++) ctx.text(cellX(c) + CELL / 2, 160, 'g' + c, { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: S.gridG });
            S.cells = [];
            for (var r = 0; r < 6; r++) {
              ctx.text(690, rowY(r) + 20, 'node-' + r, { size: 11, color: 'dim', anchor: 'end', font: 'mono', parent: S.gridG });
              var row = [];
              for (var k = 0; k < 8; k++) row.push(ctx.rect(cellX(k), rowY(r), CELL, CELL, { rx: 5, fill: '#0c1428', stroke: ctx.alpha('red', 0.28), sw: 1, parent: S.gridG }));
              S.cells.push(row);
            }
            [['rack A', 0, 2], ['rack B', 3, 5]].forEach(function (rk) {
              var y0 = rowY(rk[1]), y1 = rowY(rk[2]) + CELL;
              ctx.path('M1062,' + y0 + ' h8 V' + y1 + ' h-8', { stroke: ctx.alpha('red', 0.6), sw: 1.4, parent: S.gridG });
              ctx.text(1078, (y0 + y1) / 2, rk[0], { size: 11, color: 'red', font: 'mono', parent: S.gridG });
            });
            S.piecesG = ctx.group();
            var cells = [];
            S.cells.forEach(function (row) { row.forEach(function (cl) { cells.push(cl); }); });
            return Promise.all([ctx.reveal(S.gridG, { dur: 500 }), ctx.reveal(cells, { from: 'fade', dur: 300, stagger: 8, delay: 150 })]).then(function () {
              return ctx.pulse(S.cells[2][0], { color: 'red', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: training backfills rack B, class policy as a Kueue queue */
            var cq = ctx.code({ x: 1140, y: 330, w: 420, title: 'kueue · ClusterQueue (abridged)', lang: 'text', size: 12, color: 'red', lines: [
              'kind: ClusterQueue   # one per class', 'name: video-batch', 'cohort: studio-gpus  # borrow idle quota', 'resourceGroups:',
              '- nvidia.com/gpu: nominal 64, borrow ≤ 32', 'preemption:', '  withinClusterQueue: LowerPriority'] });
            swap(ctx, S, 'rightG', cq);
            ctx.fadeOut(S.tChip, 400, true);
            S.pTrain = piece(ctx, S.piecesG, 4, 0, 8, 2, 'blue', 'ft-16 · FSDP · 16 GPU');
            return ctx.wait(400).then(function () { return ctx.reveal(S.pTrain, { from: 'down', dist: 40, dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: eight decades of time */
            var b = ctx.group();
            panelTitle(ctx, b, 80, 612, 'ONE SCHEDULER, EIGHT DECADES OF TIME');
            ctx.text(80, 640, 'hierarchy:  quota admission (Kueue, seconds)  →  pod placement (kube-scheduler, 10–100 ms)  →  batching (engine, ~20 ms)', { size: 11, color: 'dim', font: 'mono', parent: b });
            function xOf(s) { return 160 + (Math.log(s) / Math.LN10 + 3) * 162.5; }
            ctx.line(160, 740, 1460, 740, { color: 'faint', sw: 1.5, parent: b });
            [[0.001, '1 ms'], [0.01, '10 ms'], [0.1, '100 ms'], [1, '1 s'], [10, '10 s'], [60, '1 min'], [600, '10 min'], [3600, '1 h'], [86400, '1 day']].forEach(function (t) {
              var x = xOf(t[0]);
              ctx.line(x, 734, x, 746, { color: 'faint', sw: 1.2, parent: b });
              ctx.text(x, 758, t[1], { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
            });
            var bars = [];
            [[0.02, 0.05, 'TPOT 20–50 ms', 'amber', 0], [0.2, 1, 'TTFT 0.2–1 s', 'amber', 0], [60, 180, 'one shot 60–180 s', 'lime', 0],
              [3600, 86400, 'fine-tune: hours–days', 'blue', 0], [0.01, 0.1, 'scheduling cycle', 'red', 1], [10, 30, 'preempt grace ~30 s', 'red', 1],
              [60, 300, 'cold start 1–5 min', 'red', 1]].forEach(function (m) {
              var x0 = xOf(m[0]), x1 = xOf(m[1]), y = m[4] ? 790 : 700;
              var g = ctx.group({ parent: b });
              ctx.rect(x0, y - 7, Math.max(6, x1 - x0), 14, { rx: 4, fill: ctx.alpha(m[3], 0.45), stroke: m[3], sw: 1, parent: g });
              ctx.text((x0 + x1) / 2, m[4] ? y + 22 : y - 20, m[2], { size: 11, color: m[3], anchor: 'middle', font: 'mono', parent: g });
              bars.push(g);
            });
            swap(ctx, S, 'botG', b);
            return ctx.reveal(bars, { from: 'up', dist: 12, dur: 400, delay: 500, stagger: 160 });
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Fair share (DRF)',
        beats: [
          {
            say: 'Before placing anything, the scheduler decides who deserves resources. With several tenants and several resource types, fairness is tricky.',
            card: { tag: 'KEY IDEA', title: 'Fair share across many resources', body: 'Splitting one resource evenly is easy. GPUs, CPUs and memory at once are not: a tenant can be tiny in one and dominant in another.' },
            deep: '<p>Set-up for the example: a cluster of <code>⟨48 GPU, 672 vCPU⟩</code> shared by two tenants with very different tasks:</p>' +
              '<ul><li><b>studio-A</b> (video): each task needs ⟨8 GPU, 64 vCPU⟩, so it is GPU heavy;</li>' +
              '<li><b>tenant-B</b> (LLM plus ETL): each task needs ⟨1 GPU, 48 vCPU⟩, so it is CPU heavy.</li></ul>' +
              '<p>Splitting every resource in the same proportion, or fairing on GPUs alone, would starve one tenant of the resource it actually needs.</p>'
          },
          {
            say: 'Dominant resource fairness looks at each tenant\'s largest share of any resource, its dominant share, and always serves the tenant whose dominant share is smallest.',
            card: {
              tag: 'HOW IT WORKS', title: 'Serve the smallest dominant share', body: 'Compute each tenant\'s share of every resource, keep the largest, and give the next task to whoever has the smallest.',
              more: '<p>DRF is <b>strategy-proof</b> (lying about demand never helps), <b>envy-free</b>, <b>Pareto-efficient</b> and satisfies <b>sharing incentive</b> (no tenant does worse than a static 1/n partition). The price is that it is not resource-monotonic: adding capacity can, oddly, leave a tenant with fewer tasks.</p>'
            },
            deep: '<p>For tenant i with usage u<sub>i,r</sub> of resource r and capacity C<sub>r</sub>:</p>' +
              '<div class="eq">s<sub>i</sub> = max<sub>r</sub> u<sub>i,r</sub> / C<sub>r</sub><br>next task → argmin<sub>i</sub> s<sub>i</sub> &nbsp;(weighted: s<sub>i</sub>/w<sub>i</sub>)</div>' +
              '<p>The bars mark each tenant\'s dominant resource with a bold outline: GPUs for studio-A (1/6 of the cluster per task) and CPUs for tenant-B (1/14 per task).</p>'
          },
          {
            say: 'Watch it fill: the video studio is GPU heavy, the LLM tenant is CPU heavy, and allocation alternates until the next task no longer fits.',
            card: { tag: 'HOW IT WORKS', title: 'Progressive filling', body: 'Repeat the rule and the order falls out: one studio task, three LLM tasks, one studio task, and so on. The ticker shows the exact sequence.' },
            deep: '<p>Per-task dominant shares: studio-A 8/48 = 1/6 (GPU); tenant-B 48/672 = 1/14 (CPU). Progressive filling always serves the smaller total, so A goes first (a tie), then B three times (3/14 = 0.21 exceeds 1/6 = 0.17), then A again, and so on:</p>' +
              '<pre>A1 B1 B2 B3 A2 B4 B5 A3 B6 B7 A4 B8</pre>' +
              '<p>After the last task s<sub>A</sub> = 4/6 = 0.67 and s<sub>B</sub> = 8/14 = 0.57. The order is the exact one the ticker shows.</p>'
          },
          {
            say: 'It stops when the CPUs run out. The studio ends with two thirds of the GPUs and the LLM tenant with over half of the CPUs, and no task can move without hurting someone.',
            card: { tag: 'NUMBERS', title: 'Final dominant shares', stat: { v: '0.67 vs 0.57', l: 'studio-A (4 tasks, GPU-dominant) versus tenant-B (8 tasks, CPU-dominant); CPU at 640 of 672 blocks both' } },
            deep: '<p>Progressive filling gives A = 4 tasks (s = 0.67) and B = 8 tasks (s = 0.57); then CPU (640 of 672 vCPU) blocks both, because any further task of either tenant needs at least 48 more.</p>' +
              '<p>GPUs used: 4 × 8 + 8 × 1 = 40 of 48 (83%). The 8 idle GPUs are the price of a CPU bottleneck: the scarce resource is not the dominant resource of either tenant alone. A cluster with more CPU per GPU, or a tenant whose tasks are lighter on CPU, would use them.</p>'
          },
          {
            say: 'In Kubernetes this becomes Kueue. Each cluster queue has a nominal quota, cohorts lend idle quota between queues, and preemption reclaims it when the lender needs it back.',
            card: { tag: 'STATE OF THE ART', title: 'Cohorts lend idle quota', body: 'Borrowing and lending limits, fair-sharing weights and reclaim by preemption turn DRF-style fairness into cluster policy.' },
            deep: '<p>In Kubernetes: Kueue <code>ClusterQueue</code> nominal quotas per flavor (H100, B200…), <b>cohorts</b> that lend idle quota, <code>borrowingLimit</code> and <code>lendingLimit</code>, and fair-sharing weights; preemption reclaims borrowed quota when the lender needs it back.</p>' +
              '<p>The dominant-share idea generalises to hierarchies of queues: a queue\'s share is its usage divided by its weight, and admission favours the queue with the lowest weighted share. It also gives the multi-tenant guarantee that a tenant\'s <i>nominal</i> quota is always available to it.</p>' +
              '<details><summary>Go deeper</summary><p>DRF equalises <i>resource shares</i>, but deep-learning users care about <i>finish time</i>. Themis (NSDI 2020) equalises finish-time fairness ρ = T<sub>shared</sub> / T<sub>alone</sub> with a partial-allocation auction. Gavel (OSDI 2020) writes many policies, fair-share and finish-time ones included, as optimisation problems over a job-by-GPU-type throughput matrix, which matters on heterogeneous fleets. Pollux (OSDI 2021) also re-tunes each job\'s batch size and GPU count to maximise cluster-wide goodput.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var X0 = 560, WB = 520;
          ctx.fade([S.lanesG, S.gridG, S.piecesG, S.tableG, S.rightG], 0.3, 500);   /* the fleet recedes while fair share is explained */
          var b = ctx.group();
          panelTitle(ctx, b, 80, 612, 'DOMINANT RESOURCE FAIRNESS · progressive filling');
          lines(ctx, b, 80, 642, ['cluster  ⟨48 GPU, 672 vCPU⟩'], { lh: 22 });
          lines(ctx, b, 80, 666, ['studio-A (video)   task ⟨8 GPU, 64 vCPU⟩'], { color: 'lime' });
          lines(ctx, b, 80, 688, ['tenant-B (LLM+ETL) task ⟨1 GPU, 48 vCPU⟩'], { color: 'amber' });
          var rows = [['A · GPU', 'lime', 48], ['A · vCPU', 'lime', 672], ['B · GPU', 'amber', 48], ['B · vCPU', 'amber', 672]];
          S.drfBars = rows.map(function (r0, i) {
            var y = 642 + i * 30 + (i >= 2 ? 14 : 0);
            ctx.text(X0 - 10, y + 9, r0[0], { size: 11, color: r0[1], anchor: 'end', font: 'mono', parent: b });
            ctx.rect(X0, y, WB, 18, { rx: 3, fill: ctx.alpha('white', 0.05), parent: b });
            var bar = ctx.rect(X0, y, 0, 18, { rx: 3, fill: ctx.alpha(r0[1], 0.55), stroke: r0[1], sw: 1, parent: b });
            var val = ctx.text(X0 + WB + 8, y + 9, '0%', { size: 11, color: r0[1], font: 'mono', parent: b });
            return { bar: bar, val: val, cap: r0[2], y: y };
          });
          /* beat 0: the cluster, the two tenants and their empty resource bars */
          swap(ctx, S, 'botG', b);
          return ctx.wait(900).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the rule, and each tenant's dominant resource */
            lines(ctx, b, 80, 724, ['s_i = max_r u_ir / C_r'], { size: 13, color: 'white' });
            lines(ctx, b, 80, 746, ['serve argmin_i s_i'], { size: 13, color: 'white' });
            ctx.text(X0, 790, 'outlined row = dominant resource', { size: 11, color: 'dim', font: 'mono', parent: b });
            var hl = [0, 3].map(function (k) {
              var d = S.drfBars[k];
              return ctx.rect(X0 - 2, d.y - 2, WB + 4, 22, { rx: 4, stroke: k === 0 ? 'lime' : 'amber', sw: 2.4, parent: b });
            });
            return ctx.reveal(hl, { dur: 500, stagger: 250 }).then(function () {
              return Promise.all([ctx.pulse(S.drfBars[0].val, { color: 'lime', dur: 500 }), ctx.pulse(S.drfBars[3].val, { color: 'amber', dur: 500 })]);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: progressive filling */
            S.drfCount = ctx.text(80, 790, 'A tasks 0 · B tasks 0', { size: 12, color: 'dim', font: 'mono', parent: b });
            var seq = ['A', 'B', 'B', 'B', 'A', 'B', 'B', 'A', 'B', 'B', 'A', 'B'];
            ctx.text(1160, 642, 'allocation order', { size: 11, color: 'dim', font: 'mono', parent: b });
            var tick = seq.map(function (s, i) {
              return ctx.label(1178 + (i % 6) * 60, 672 + Math.floor(i / 6) * 34, s + (seq.slice(0, i + 1).filter(function (q) { return q === s; }).length), { color: s === 'A' ? 'lime' : 'amber', size: 11, w: 50, parent: b, opacity: 0 });
            });
            var a = 0, bb = 0, prev = [0, 0, 0, 0];
            var T0 = 300, DT = 380;
            seq.forEach(function (s, i) {
              if (s === 'A') a++; else bb++;
              var now = [a * 8 / 48, a * 64 / 672, bb / 48, bb * 48 / 672];
              now.forEach(function (v, k) {
                if (v === prev[k]) return;
                ctx.animate(S.drfBars[k].bar, { width: [prev[k] * WB, v * WB] }, 300, 'out', T0 + i * DT);
              });
              var na = a, nbb = bb, snap = now.slice();
              ctx.after(T0 + i * DT, function () {
                snap.forEach(function (v, k) { S.drfBars[k].val.textContent = Math.round(v * 100) + '%'; });
                S.drfCount.textContent = 'A tasks ' + na + ' · B tasks ' + nbb;
              });
              ctx.reveal(tick[i], { from: 'scale', dur: 250, delay: T0 + i * DT });
              prev = now;
            });
            return ctx.wait(T0 + seq.length * DT + 500);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: where it stops */
            S.drfEnd = ctx.text(1160, 750, 's_A = 0.67   s_B = 0.57', { size: 12, color: 'white', font: 'code', pre: true, parent: b });
            S.drfEnd2 = ctx.text(1160, 772, 'next task fits neither (CPU 640/672)', { size: 11, color: 'red', font: 'mono', parent: b });
            ctx.reveal([S.drfEnd, S.drfEnd2], { from: 'up', dist: 10, stagger: 200 });
            return ctx.wait(500).then(function () {
              return Promise.all([ctx.pulse(S.drfBars[1].bar, { color: 'red', dur: 700, times: 2 }), ctx.pulse(S.drfBars[3].bar, { color: 'red', dur: 700, times: 2 })]);
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the same idea as Kueue cohorts */
            var cq = ctx.code({ x: 1140, y: 330, w: 420, title: 'kueue · cohort + fair sharing', lang: 'text', size: 12, color: 'red', lines: [
              'kind: ClusterQueue    # video-batch', 'cohort: studio-gpus', 'nvidia.com/gpu:', '  nominalQuota: 64', '  borrowingLimit: 32   # idle cohort quota',
              '  lendingLimit: 16     # lendable if idle', 'fairSharing: {weight: 2}', 'preemption: {reclaimWithinCohort: Any}'] });
            swap(ctx, S, 'rightG', cq);
            return ctx.wait(900);
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Tetris placement',
        beats: [
          {
            say: 'Now placement. LLM replicas need one, two or four GPUs each. A default scheduler spreads them across nodes, which is great for resilience but terrible for gangs.',
            card: { tag: 'KEY IDEA', title: 'Spread versus pack', body: 'Spreading minimises the blast radius of a node failure. Packing keeps whole nodes free for gangs. The default scheduler spreads.' },
            deep: '<p>Node scoring in kube-scheduler (NodeResourcesFit):</p>' +
              '<div class="eq">LeastAllocated: score = Σ<sub>r</sub> w<sub>r</sub> · free<sub>r</sub>/cap<sub>r</sub> &nbsp;(spread)<br>MostAllocated: score = Σ<sub>r</sub> w<sub>r</sub> · used<sub>r</sub>/cap<sub>r</sub> &nbsp;(pack)</div>' +
              '<p>Spreading minimises blast radius; packing (best-fit bin-packing) keeps whole nodes free for gangs. The two goals conflict, and the default profile picks resilience.</p>'
          },
          {
            say: 'Watch the pieces land. Each replica goes to whichever node has the most free GPUs, so the eight replicas fan out across four nodes.',
            card: { tag: 'HOW IT WORKS', title: 'Emptiest node wins', body: 'LeastAllocated scores each node by its free fraction and picks the highest, so every new pod lands where the most room is left.' },
            deep: '<p>Here the pods arrived in order TP4, TP4, TP2, TP2, then four 1-GPU models. The first two take nodes 0 and 1; every later pod goes to whichever of nodes 2 and 3 has more free GPUs (ties to the lowest index):</p>' +
              '<pre>a TP4 → node-0   b TP4 → node-1\nc TP2 → node-2   d TP2 → node-3\ne emb → node-2   f safe → node-3\ng rrk → node-2   h asr  → node-3</pre>' +
              '<p>Each choice is locally sensible, and together they leave 4 free GPUs on each of four nodes.</p>'
          },
          {
            say: 'Sixteen GPUs are free, yet no single node has eight free, so the next video shot cannot start.',
            card: { tag: 'NUMBERS', title: 'Free, but unusable', stat: { v: '16 vs 0', l: 'GPUs free versus nodes with eight free in one place: every gap is a fragment of four' } },
            deep: '<p>After spread placement the free GPUs per node are 4, 4, 4, 4, 0, 0. The sum is 16, but ⌊free<sub>n</sub>/8⌋ = 0 on every node, so not a single 8-GPU gang fits. The gang needs all eight GPUs on <b>one</b> NVLink domain, so the histogram\'s dashed line at 8 is the only number that matters.</p>'
          },
          {
            say: 'This is fragmentation, the same problem as Tetris: total free space is plenty, but it has the wrong shape.',
            card: {
              tag: 'PITFALL', title: 'Free capacity is not usable capacity', body: 'This cluster is 33% empty and cannot place a single gang. Track fragmentation, not only utilisation.',
              more: '<p>F<sub>8</sub> = 1 − (Σ<sub>n</sub> 8·⌊free<sub>n</sub>/8⌋) / Σ<sub>n</sub> free<sub>n</sub>. With free = (4, 4, 4, 4, 0, 0) every ⌊free<sub>n</sub>/8⌋ is 0, so the numerator is 0 and F<sub>8</sub> = 1 − 0/16 = 100%. After a repack to (0, 0, 8, 8, 0, 0) the numerator is 16 and F<sub>8</sub> = 0%: the same 16 free GPUs with the opposite outcome.</p>'
            },
            deep: '<p>A simple fragmentation metric for gang size k:</p>' +
              '<div class="eq">F<sub>k</sub> = 1 − (Σ<sub>n</sub> k·⌊free<sub>n</sub>/k⌋) / Σ<sub>n</sub> free<sub>n</sub></div>' +
              '<p>Here F<sub>8</sub> = 100%: every free GPU is useless to an 8-GPU gang. MostAllocated, with the same arrival order, would have packed all 16 replica GPUs onto nodes 0–1, leaving nodes 2 and 3 whole. Bin-packing is NP-hard in general; production schedulers use greedy best-fit with pool separation (LLM pool vs gang pool) and periodic defragmentation.</p>' +
              '<div class="note">Heterogeneity makes it worse: packing must respect GPU type, NVLink domain and NUMA/NIC affinity simultaneously (multi-dimensional bin-packing).</div>'
          },
          {
            say: 'Try it yourself. Click pack to place the same eight replicas with best fit, and watch two whole nodes stay free while the fragmentation number drops to zero. Click spread to go back.',
            card: { tag: 'TRY IT', title: 'Flip spread to pack', body: 'Click <b>pack</b>: the same eight replicas now fill nodes 0 and 1, nodes 2 and 3 stay whole, and an eight GPU gang fits. Click <b>spread</b> to undo it.' },
            deep: '<table><tr><th></th><th>spread</th><th>pack</th></tr>' +
              '<tr><td>free per node</td><td>4 4 4 4 0 0</td><td>0 0 8 8 0 0</td></tr>' +
              '<tr><td>8-GPU gangs that fit</td><td>0</td><td>2</td></tr>' +
              '<tr><td>F<sub>8</sub></td><td>100%</td><td>0%</td></tr>' +
              '<tr><td>lost if node-0 dies</td><td>1 TP4 replica</td><td>both TP4 replicas</td></tr></table>' +
              '<p>Packing is not free: it concentrates replicas of one service on one node, so a single node failure removes all of them. Production clusters therefore pack <i>across</i> services but keep <code>topologySpreadConstraints</code> or pod anti-affinity <i>within</i> a service, and confine aggressive packing to the pool that hosts many small pods.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.pLLM = {};
          ctx.fade([S.lanesG, S.gridG, S.piecesG, S.tableG, S.rightG], 1, 500);   /* undo the recess of the fair-share step */
          var b = ctx.group();
          panelTitle(ctx, b, 80, 612, 'PLACING THE LLM REPLICAS');
          lines(ctx, b, 900, 660, ['LeastAllocated (default) spreads:', '  good for failure isolation,', '  fatal for gangs.', '', 'MostAllocated / best-fit packs:', '  small jobs fill partial nodes,', '  whole nodes stay free for gangs.'], { lh: 22 });
          /* beat 0: spread versus pack */
          swap(ctx, S, 'botG', b);
          return ctx.pulse(S.lg, { color: 'amber', dur: 700 }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the pieces land, one replica at a time */
            var ps = LLM_JOBS.map(function (j, i) {
              var pos = SPREAD[j.id];
              var p = piece(ctx, S.piecesG, pos[0], pos[1], j.g, 1, 'amber', j.label);
              S.pLLM[j.id] = p;
              ctx.after(200 + i * 260, function () { ctx.fadeOut(S.lChips[j.id], 250, true); });
              return ctx.reveal(p, { from: 'down', dist: 40, dur: 450, delay: 250 + i * 260 });
            });
            return Promise.all(ps);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: sixteen GPUs free, but no node has eight */
            var free = [4, 4, 4, 4, 0, 0];
            S.hist = ctx.group({ parent: b });
            S.freeTxt = [];
            S.freeBars = free.map(function (f, i) {
              var x = 160 + i * 110;
              ctx.rect(x, 650, 64, 200, { rx: 4, fill: ctx.alpha('white', 0.03), parent: S.hist });
              var bar = ctx.rect(x, 850 - f * 25, 64, f * 25, { rx: 4, fill: ctx.alpha('red', 0.45), stroke: 'red', sw: 1, parent: S.hist });
              ctx.text(x + 32, 862, 'node-' + i, { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: S.hist });
              S.freeTxt.push(ctx.text(x + 32, 838 - f * 25, String(f), { size: 13, color: 'white', anchor: 'middle', font: 'mono', parent: S.hist }));
              return bar;
            });
            ctx.line(140, 650, 800, 650, { color: 'lime', sw: 1.6, dash: '6 5', parent: S.hist });
            ctx.text(800, 638, 'gang needs 8 on ONE node (NVLink domain)', { size: 11, color: 'lime', anchor: 'end', font: 'mono', parent: S.hist });
            ctx.text(80, 640, 'FREE GPUs PER NODE', { size: 11, color: 'dim', font: 'mono', parent: S.hist });
            ctx.reveal(S.hist, { from: 'up', dist: 14, dur: 500 });
            S.fragG = ctx.group();
            panelTitle(ctx, S.fragG, 1150, 345, 'FRAGMENTATION');
            S.fragVals = [];
            [['free GPUs', '16', 'text'], ['largest block on one node', '4', 'amber'], ['8-GPU gang fits?', 'NO', 'red']].forEach(function (q, i) {
              ctx.text(1150, 380 + i * 34, q[0], { size: 12, color: 'dim', font: 'mono', parent: S.fragG });
              S.fragVals.push(ctx.text(1555, 380 + i * 34, q[1], { size: 18, color: q[2], font: 'mono', weight: 700, anchor: 'end', parent: S.fragG }));
            });
            swap(ctx, S, 'rightG', S.fragG);
            ctx.hud('16 GPUs free · 0 nodes with 8 free');
            return ctx.wait(500).then(function () {
              return Promise.all([2, 3].map(function (r) { return ctx.pulse(S.cells[r][7], { color: 'red', dur: 700 }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: fragmentation as a number */
            ctx.text(1150, 380 + 3 * 34, 'F8 (useless free GPUs)', { size: 12, color: 'dim', font: 'mono', parent: S.fragG });
            var f8 = ctx.text(1555, 380 + 3 * 34, '100%', { size: 18, color: 'red', font: 'mono', weight: 700, anchor: 'end', parent: S.fragG });
            S.f8 = f8;
            ctx.reveal([f8], { from: 'scale' });
            return ctx.pulse(f8, { color: 'red', dur: 700, times: 2 });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4 (TRY IT): re-place the same eight replicas with spread or pack */
            var g = ctx.group();
            S.tryG = g;
            ctx.text(1150, 522, 'TRY IT · re-place the same 8 replicas', { size: 11, color: 'dim', font: 'mono', parent: g });
            S.fitG = ctx.group({ opacity: 0 });
            [2, 3].forEach(function (r) {
              ctx.rect(GX - 5, rowY(r) - 4, 8 * P + 5, CELL + 8, { rx: 8, stroke: 'lime', sw: 2, dash: '7 4', parent: S.fitG, glow: true });
            });
            S.blast = ctx.label(880, rowY(5) + 58, 'trade-off: node-0 down takes both TP4 replicas', { color: 'red', size: 11, opacity: 0 });
            S.placeMode = 'spread';
            S.setPlace = function (mode, animate) {
              var target = mode === 'pack' ? PACK : SPREAD, ps = [], pk = mode === 'pack';
              LLM_JOBS.forEach(function (j, i) {
                var from = SPREAD[j.id], to = target[j.id], p = S.pLLM[j.id];
                var dx = cellX(to[1]) - cellX(from[1]), dy = rowY(to[0]) - rowY(from[0]);
                if (animate) ps.push(ctx.transform(p, { x: dx, y: dy }, 700, 'inOut', i * 60));
                else ctx.place(p, dx, dy);
              });
              var free = pk ? [0, 0, 8, 8, 0, 0] : [4, 4, 4, 4, 0, 0];
              S.freeBars.forEach(function (bar, i) {
                var f = free[i], y1 = 850 - f * 25, h1 = f * 25;
                if (animate) ps.push(ctx.animate(bar, { y: [parseFloat(bar.getAttribute('y')), y1], height: [parseFloat(bar.getAttribute('height')), h1] }, 600, 'out'));
                else { bar.setAttribute('y', y1); bar.setAttribute('height', h1); }
                S.freeTxt[i].textContent = String(f);
                S.freeTxt[i].setAttribute('y', f >= 8 ? y1 + 18 : 838 - f * 25);
              });
              S.fragVals[1].textContent = pk ? '8' : '4';
              S.fragVals[1].setAttribute('fill', ctx.color(pk ? 'lime' : 'amber'));
              S.fragVals[2].textContent = pk ? 'YES' : 'NO';
              S.fragVals[2].setAttribute('fill', ctx.color(pk ? 'lime' : 'red'));
              S.f8.textContent = pk ? '0%' : '100%';
              S.f8.setAttribute('fill', ctx.color(pk ? 'lime' : 'red'));
              ctx.hud(pk ? '16 GPUs free · 2 nodes with 8 free' : '16 GPUs free · 0 nodes with 8 free');
              ps.push(ctx.fade(S.fitG, pk ? 1 : 0, 400));
              ps.push(ctx.fade(S.blast, pk ? 1 : 0, 400));
              S.modeChips.forEach(function (c) { c.el.setAttribute('opacity', c.k === mode ? 1 : 0.45); });
              S.placeMode = mode;
              S.placeBusy = true;
              return Promise.all(ps).then(function () { S.placeBusy = false; });
            };
            S.modeChips = [['spread', 'amber', 1212], ['pack', 'lime', 1312]].map(function (c) {
              var l = ctx.label(c[2], 554, c[0], { color: c[1], size: 12, w: 84, parent: g });
              l.style.cursor = 'pointer';
              l.addEventListener('click', function () { if (!ctx.dead && !S.placeBusy && S.placeMode !== c[0]) S.setPlace(c[0], true); });
              return { el: l, k: c[0] };
            });
            S.modeChips.forEach(function (c) { c.el.setAttribute('opacity', c.k === 'spread' ? 1 : 0.45); });
            ctx.reveal(g, { dur: 400 });
            return ctx.wait(800).then(function () { return S.setPlace('pack', true); }).then(function () { return ctx.wait(1600); }).then(function () {
              return S.setPlace('spread', true);
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Gang scheduling',
        beats: [
          {
            say: 'Suppose we scheduled video pods one at a time anyway. Three shots each grab part of what they need: six GPUs, five, and five.',
            card: { tag: 'PITFALL', title: 'Partial allocation is pure waste', body: 'A sequence-parallel job cannot start until all eight ranks exist, so GPUs held by an incomplete gang do nothing.' },
            deep: '<p>Distributed jobs (NCCL collectives, Ulysses all-to-all) cannot make progress until <b>every</b> rank is up, because the first collective blocks on the slowest member. A default per-pod scheduler binds pods independently, so three shots can each grab a piece of the 16 free GPUs and none gets all eight.</p>' +
              '<p>The cost is more than delay. With F free GPUs and gangs of size g, a gang scheduler admits ⌊F/g⌋ jobs (here ⌊16/8⌋ = 2), while independent per-pod binding can spread all F GPUs over three jobs and admit <b>none</b>: 16 GPUs allocated, 0 running.</p>'
          },
          {
            say: 'None can start, and none will let go. That is a deadlock: a cycle in the wait for graph.',
            card: { tag: 'KEY IDEA', title: 'Hold and wait forms a cycle', body: 'Each shot holds GPUs another shot needs and waits for GPUs it cannot get, with no preemption between them.' },
            deep: '<p>All four Coffman conditions hold: <b>mutual exclusion</b> (a GPU has one owner), <b>hold-and-wait</b> (pods keep what they have while waiting), <b>no preemption</b> (nobody releases voluntarily) and <b>circular wait</b> (shot 1 waits for shot 2, shot 2 for shot 3, shot 3 for shot 1).</p>' +
              '<p>The result is the worst kind of waste: 16 GPUs are allocated, 0 are running, and no alarm goes off, because every pod is "Pending" or "Running" but idle.</p>'
          },
          {
            say: 'Gang scheduling fixes it with all or nothing admission: a job gets its eight GPUs atomically, or holds none.',
            card: { tag: 'HOW IT WORKS', title: 'All or nothing, atomically', body: 'Volcano\'s PodGroup and Kueue\'s Workload reserve the whole gang at once, so a partial hold can never form.' },
            deep: '<ul><li><b>Volcano</b>: <code>PodGroup.minMember = 8</code>; the gang plugin only binds when all 8 pods fit.</li>' +
              '<li><b>Kueue</b>: quota is reserved for the whole <code>Workload</code> at admission; <code>waitForPodsReady</code> evicts and requeues it if all pods are not running within a timeout (breaks physical-placement deadlocks).</li>' +
              '<li><b>Coscheduling</b> plugin (scheduler-plugins) and Slurm allocate the same way.</li>' +
              '<li>Recent Kubernetes releases also add native gang scheduling to kube-scheduler (a PodGroup with a gang policy); it is still beta and off by default, so Kueue and Volcano remain the usual route.</li></ul>'
          },
          {
            say: 'Combined with repacking the small LLM replicas, two whole nodes open up, and shots one and two start immediately.',
            card: { tag: 'NUMBERS', title: 'Repack, then admit', stat: { v: '2', u: 'gangs', l: 'fit after repacking: free GPUs per node went from 4 4 4 4 0 0 to 0 0 8 8 0 0' } },
            deep: '<p><b>Defragmentation</b>: the descheduler evicts the small replicas one at a time, behind a PodDisruptionBudget so their siblings keep serving, and the scheduler re-places them best-fit, turning scattered free GPUs into whole free nodes:</p>' +
              '<pre>before: 4 4 4 4 0 0  → no gang fits\nafter:  0 0 8 8 0 0  → 2 gangs fit</pre>' +
              '<p>(free GPUs on nodes 0–5, before and after the repack).</p>' +
              '<div class="note">Cost of the repack: every moved replica is down for its restart time (seconds from a warm node-local weight cache, a minute or more from a cold pull) and loses its KV cache. Moving six small replicas is cheap next to two 95 s shots starting now instead of waiting for natural churn; moving a large TP8 replica would not be.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* leave the try-it toggle of the previous step: always continue from the spread layout */
          if (S.setPlace && S.placeMode !== 'spread') S.setPlace('spread', false);
          ctx.hud('');
          ctx.remove(S.tryG, 300); ctx.remove(S.fitG, 300); ctx.remove(S.blast, 300);
          /* naive per-pod placement -> partial gangs */
          S.partial = ctx.group();
          var parts = [[1, [[0, 4], [0, 5], [0, 6], [0, 7], [1, 4], [1, 5]]], [2, [[2, 4], [2, 5], [2, 6], [2, 7], [1, 6]]], [3, [[3, 4], [3, 5], [3, 6], [3, 7], [1, 7]]]];
          var k = 0, pcs = [];
          parts.forEach(function (pp) {
            pp[1].forEach(function (rc) {
              var g = ctx.group({ parent: S.partial });
              ctx.rect(cellX(rc[1]) + 2, rowY(rc[0]) + 2, CELL - 4, CELL - 4, { rx: 4, fill: ctx.alpha('lime', 0.12), stroke: 'lime', sw: 1.2, dash: '3 3', parent: g });
              ctx.text(cellX(rc[1]) + CELL / 2, rowY(rc[0]) + CELL / 2 + 0.5, 's' + pp[0], { size: 12, color: 'lime', anchor: 'middle', font: 'mono', weight: 600, parent: g });
              pcs.push(ctx.reveal(g, { from: 'scale', dur: 250, delay: 200 + k * 90 }));
              k++;
            });
          });
          S.held = ctx.label(880, 497, 'held: shot1 6/8 · shot2 5/8 · shot3 5/8', { color: 'lime', size: 12, parent: S.partial });
          pcs.push(ctx.reveal(S.held, { from: 'scale', delay: 200 + k * 90 }));
          /* beat 0: three shots grab parts of a gang */
          return Promise.all(pcs).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the wait-for graph and the deadlock */
            var b = ctx.group();
            S.wfTitle = panelTitle(ctx, b, 80, 612, 'WAIT-FOR GRAPH without gang scheduling');
            S.wfG = ctx.group({ parent: b });
            var nodes = [[260, 680, 'shot1', 'holds 6/8'], [460, 810, 'shot2', 'holds 5/8'], [160, 810, 'shot3', 'holds 5/8']];
            nodes.forEach(function (n) {
              ctx.rect(n[0] - 55, n[1] - 22, 110, 44, { rx: 8, fill: ctx.alpha('lime', 0.1), stroke: 'lime', sw: 1.3, parent: S.wfG });
              ctx.text(n[0], n[1] - 7, n[2], { size: 13, color: 'white', anchor: 'middle', font: 'mono', weight: 600, parent: S.wfG });
              ctx.text(n[0], n[1] + 10, n[3], { size: 11, color: 'lime', anchor: 'middle', font: 'mono', parent: S.wfG });
            });
            S.wf = [
              ctx.path('M315,690 Q430,700 450,786', { stroke: 'red', sw: 1.8, arrow: true, parent: S.wfG }),
              ctx.path('M405,818 L217,818', { stroke: 'red', sw: 1.8, arrow: true, parent: S.wfG }),
              ctx.path('M150,786 Q150,700 203,686', { stroke: 'red', sw: 1.8, arrow: true, parent: S.wfG })
            ];
            ctx.text(310, 762, 'waits for', { size: 11, color: 'red', anchor: 'middle', font: 'mono', parent: S.wfG });
            var cyc = ctx.text(545, 700, 'cycle ⇒ DEADLOCK', { size: 14, color: 'red', font: 'mono', weight: 700, parent: S.wfG });
            swap(ctx, S, 'botG', b);
            S.dl = ctx.label(880, 497, 'DEADLOCK · 16 GPUs held, 0 running', { color: 'red', size: 12, parent: S.partial });
            ctx.fade(S.held, 0, 300);
            ctx.reveal(S.dl, { from: 'scale', delay: 600 });
            ctx.reveal(cyc, { delay: 1300 });
            return ctx.reveal(S.wf, { from: 'draw', delay: 400, stagger: 250 }).then(function () { return ctx.pulse(S.dl, { color: 'red', dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: all-or-nothing admission rolls the partial pods back */
            var pg = ctx.code({ x: 1140, y: 330, w: 420, title: 'volcano · PodGroup (gang)', lang: 'text', size: 12, color: 'lime', lines: [
              'kind: PodGroup', 'name: shot-3', 'spec:', '  minMember: 8        # all-or-nothing', '  queue: video-batch', '  minResources: {nvidia.com/gpu: 8}',
              '# + topology: 1 NVLink domain'] });
            swap(ctx, S, 'rightG', pg);
            ctx.fade(S.wfG, 0.25, 500);
            S.wfTitle.textContent = 'WAIT-FOR GRAPH · cycle broken by gang admission';
            lines(ctx, S.botG, 800, 650, ['Fix = gang admission:', '1. reserve 8 GPUs atomically, else hold 0', '2. roll back partial pods (s1 s2 s3)', '3. descheduler repacks stateless LLM replicas', '4. admit shot1 → node-2, shot2 → node-3', '5. shot3 waits in queue holding nothing'], { lh: 24 });
            return ctx.wait(700).then(function () { return ctx.fadeOut(S.partial, 500, true); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: repack the small replicas, then the two gangs start */
            /* node-2 residents -> node-0 g4..g7, node-3 residents -> node-1 g4..g7 (4 columns = 180 px) */
            var mv = [['c', 180, -100], ['e', 180, -100], ['g', 180, -100], ['d', 180, -114], ['f', 180, -114], ['h', 180, -114]];
            return Promise.all(mv.map(function (m, i) { return ctx.transform(S.pLLM[m[0]], { x: m[1], y: m[2] }, 800, 'inOut', i * 120); })).then(function () {
              renderVideoLane(ctx, S, [3, 4, 5], 1);
              S.pShot1 = piece(ctx, S.piecesG, 2, 0, 8, 1, 'lime', 'shot1 · gang of 8 · SP8');
              S.pShot2 = piece(ctx, S.piecesG, 3, 0, 8, 1, 'lime', 'shot2 · gang of 8 · SP8');
              return Promise.all([ctx.reveal(S.pShot1, { from: 'down', dist: 40, dur: 600 }), ctx.reveal(S.pShot2, { from: 'down', dist: 40, dur: 600, delay: 200 })]);
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Topology-aware',
        beats: [
          {
            say: 'Where a gang lands matters as much as whether it lands. Each video shot uses sequence parallelism, so its eight GPUs exchange activations with all to all collectives at every layer.',
            card: { tag: 'KEY IDEA', title: 'All-to-all at every layer', body: 'Each of the 40 layers issues four all-to-all exchanges among the eight GPUs, so a gang lives or dies by its interconnect.' },
            deep: '<p>DeepSpeed-Ulysses all-to-all volume per layer, per GPU, for the Wan-14B shot (N ≈ 75.6k tokens, d = 5120, p = 8, BF16; q, k, v in and o out):</p>' +
              '<div class="eq">V ≈ 4 · (N/p) · d · 2 B · (p−1)/p ≈ 4 · 9450 · 5120 · 2 · 7/8 ≈ 339 MB</div>' +
              '<p>Every layer of every forward pass repeats it: 40 layers × 100 forwards per shot (50 steps × 2 CFG branches) is 4,000 layer-passes, each moving 339 MB per GPU, about 1.4 TB per GPU per shot. Whether that costs seconds or tens of seconds depends entirely on which wires carry it. The numbers on this page use H100 nodes (450 GB/s per direction); on B200 nodes with XDR the fast leg and the cross-rack leg both double, so the ratio stays about 9 to 1.</p>'
          },
          {
            say: 'Inside one server, NVLink moves four hundred fifty gigabytes per second per GPU in each direction. That is the speed those collectives were designed for.',
            card: { tag: 'NUMBERS', title: 'NVLink is the fast lane', stat: { v: '450 GB/s', l: 'per GPU per direction inside an H100 node; PCIe Gen5 gives 64 and InfiniBand NDR 50' } },
            deep: '<p>Per-GPU bandwidth, one direction: NVLink 5 (B200) 900 GB/s, NVLink 4 (H100) 450 GB/s, PCIe Gen5 x16 ~64 GB/s, InfiniBand NDR 400 Gb/s = 50 GB/s. An H100 node behind NVSwitch sustains 450 GB/s between <i>any</i> two GPUs simultaneously, which is what an all-to-all needs.</p>' +
              '<p>The number to compare is the one-way rate, because an all-to-all sends and receives at once. NVLink SHARP (NVLS) can reduce inside the switch and speed up all-reduce, but an all-to-all has nothing to reduce, so it runs at plain link rate.</p>'
          },
          {
            say: 'Split the gang four plus four across racks, and four of every seven peers are remote. Most of the traffic then crosses InfiniBand at fifty gigabytes per second, through a spine switch.',
            card: {
              tag: 'PITFALL', title: 'Straddling two racks', body: 'With a 4 + 4 split, four of each GPU\'s seven peers are across the fabric: three switch hops at a ninth of NVLink speed.',
              more: '<p>Each GPU has 7 peers, and in an all-to-all it sends an equal slice to each. With a 4 + 4 split, 4 of the 7 slices cross the fabric: 4/7 × 339 MB ≈ 194 MB per layer, which takes 194 MB / 50 GB/s ≈ 3.9 ms, against 339 MB / 450 GB/s ≈ 0.75 ms if every peer were on NVLink.</p>'
            },
            deep: '<p>Topology-aware schedulers encode levels as node labels (NVLink domain / rack / leaf / spine block). A two-level fat tree connects every leaf to every spine; spines never talk to each other, so two nodes under different leaves cross <b>three</b> switches (leaf, spine, leaf), while two nodes under the same leaf cross only one.</p>'
          },
          {
            say: 'Communication time per forward pass grows from about thirty milliseconds to a hundred fifty five. Over a whole shot that is three seconds against sixteen seconds of pure waiting.',
            card: { tag: 'NUMBERS', title: 'Five times the communication', stat: { v: '3 s → 16 s', l: 'pure all-to-all time per shot when the gang moves from one NVLink domain to a 4 + 4 split' } },
            deep: '<p>Pure all-to-all time, 40 layers per forward pass and 100 forward passes per shot:</p>' +
              '<table><tr><th>Placement</th><th>per fwd</th><th>per shot</th></tr>' +
              '<tr><td>8 GPUs, one NVLink4 domain (450 GB/s per direction)</td><td>≈ 30 ms</td><td>≈ 3.0 s</td></tr>' +
              '<tr><td>4 + 4 across racks (4/7 of the bytes, ≈ 194 MB, over 50 GB/s IB)</td><td>≈ 155 ms</td><td>≈ 15.5 s</td></tr></table>' +
              '<p>If none of it overlaps with compute, the extra 12.5 s is roughly 13% of a ~95 s shot, which is the throughput a badly placed gang silently gives up, and all of it is invisible in GPU utilisation counters because the GPUs are busy waiting.</p>'
          },
          {
            say: 'Topology aware placement therefore keeps every gang inside one NVLink domain, and keeps multi node jobs under a single leaf switch.',
            card: { tag: 'STATE OF THE ART', title: 'Topology labels drive placement', body: 'Kueue Topology-Aware Scheduling, Slurm topology plugins and Volcano network-topology scheduling all prefer the lowest common level: node, rack, then leaf.' },
            deep: '<p>Kueue <b>Topology-Aware Scheduling</b> (<code>podset-required-topology</code>), Slurm <code>topology/tree</code> and <code>block</code> plugins, and Volcano network-topology-aware scheduling prefer the lowest common level. On <b>GB200 NVL72</b> the NVLink domain is a whole rack (72 GPUs), so gangs of 16–64 GPUs can also stay on NVLink.</p>' +
              '<div class="note">Rail-optimised fabrics connect GPU k of every node to leaf k; the scheduler therefore also tries to align ranks to rails so that same-rank traffic stays one hop.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: each gang inside one NVLink domain, all-to-all traffic inside the node */
          S.topoG = ctx.group();
          S.nvl = [2, 3].map(function (r) {
            return ctx.rect(GX - 5, rowY(r) - 4, 8 * P + 5, CELL + 8, { rx: 8, stroke: 'lime', sw: 2, dash: '7 4', parent: S.topoG, glow: true });
          });
          S.okLbl = ctx.label(880, rowY(5) + 58, 'each gang = 1 NVLink domain ✓', { color: 'lime', size: 11, parent: S.topoG });
          S.pathA2A = [2, 3].map(function (r) {
            return ctx.path('M' + (cellX(0) + 20) + ',' + (rowY(r) + 20) + ' L' + (cellX(7) + 20) + ',' + (rowY(r) + 20), { stroke: 'lime', opacity: 0, parent: S.topoG });
          });
          return Promise.all([ctx.reveal(S.nvl, { dur: 500, stagger: 200 }), ctx.reveal(S.okLbl, { delay: 400 })]).then(function () {
            return Promise.all([
              ctx.packet(S.pathA2A[0], { color: 'lime', dur: 700, r: 4 }), ctx.packet(S.pathA2A[0], { color: 'lime', dur: 700, r: 4, reverse: true }),
              ctx.packet(S.pathA2A[1], { color: 'lime', dur: 700, r: 4 }), ctx.packet(S.pathA2A[1], { color: 'lime', dur: 700, r: 4, reverse: true })
            ]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: per-GPU bandwidth, one direction */
            var b = ctx.group();
            panelTitle(ctx, b, 80, 612, 'PER-GPU BANDWIDTH (one direction)');
            var bw = [['NVLink5 (B200)', 900, 'lime'], ['NVLink4 (H100)', 450, 'lime'], ['PCIe Gen5 x16', 64, 'blue'], ['IB NDR 400G', 50, 'cyan']];
            S.bwBars = bw.map(function (q, i) {
              var y = 640 + i * 34;
              ctx.text(250, y + 10, q[0], { size: 12, color: 'text', anchor: 'end', font: 'mono', parent: b });
              var bar = ctx.rect(262, y, q[1] / 900 * 440, 20, { rx: 3, fill: ctx.alpha(q[2], 0.5), stroke: q[2], sw: 1, parent: b });
              ctx.text(262 + q[1] / 900 * 440 + 8, y + 10.5, q[1] + ' GB/s', { size: 11, color: q[2], font: 'mono', parent: b });
              bar._w = q[1] / 900 * 440;
              return bar;
            });
            swap(ctx, S, 'botG', b);
            S.bwBars.forEach(function (bar) { bar.setAttribute('width', 0); });
            return Promise.all(S.bwBars.map(function (bar, i) { return ctx.animate(bar, { width: [0, bar._w] }, 700, 'out', 500 + i * 120); })).then(function () {
              return ctx.pulse(S.bwBars[1], { color: 'lime', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: what if the gang straddles two racks */
            S.badArc = ctx.path('M' + (cellX(8) - 2) + ',' + (rowY(2) + 20) + ' C1122,' + (rowY(2) + 20) + ' 1122,' + (rowY(3) + 20) + ' ' + (cellX(8) - 2) + ',' + (rowY(3) + 20), { stroke: 'red', sw: 1.8, dash: '4 4', arrow: true, parent: S.topoG });
            S.badLbl = ctx.label(880, rowY(5) + 88, 'red arc = 4+4 what-if', { color: 'red', size: 11, parent: S.topoG });
            var rg = ctx.group();
            panelTitle(ctx, rg, 1150, 345, 'FABRIC TOPOLOGY');
            var sp = [[1290, 382], [1420, 382]], lf = [[1225, 450, 'leaf A'], [1485, 450, 'leaf B']];
            var nodesX = [1160, 1225, 1290, 1420, 1485, 1550];
            lf.forEach(function (l) { sp.forEach(function (s) { ctx.line(l[0], l[1] - 12, s[0], s[1] + 12, { color: ctx.alpha('cyan', 0.35), sw: 1.2, parent: rg }); }); });
            nodesX.forEach(function (x, i) { var l = lf[i < 3 ? 0 : 1]; ctx.line(x, 520, l[0], l[1] + 12, { color: ctx.alpha('cyan', 0.35), sw: 1.2, parent: rg }); });
            sp.forEach(function (s) { ctx.rect(s[0] - 40, s[1] - 12, 80, 24, { rx: 5, fill: ctx.alpha('cyan', 0.12), stroke: 'cyan', sw: 1, parent: rg }); ctx.text(s[0], s[1] + 0.5, 'spine', { size: 11, color: 'cyan', anchor: 'middle', font: 'mono', parent: rg }); });
            lf.forEach(function (l) { ctx.rect(l[0] - 40, l[1] - 12, 80, 24, { rx: 5, fill: ctx.alpha('cyan', 0.12), stroke: 'cyan', sw: 1, parent: rg }); ctx.text(l[0], l[1] + 0.5, l[2], { size: 11, color: 'cyan', anchor: 'middle', font: 'mono', parent: rg }); });
            nodesX.forEach(function (x, i) { ctx.rect(x - 24, 520, 48, 22, { rx: 4, fill: ctx.alpha('red', 0.12), stroke: 'red', sw: 1, parent: rg }); ctx.text(x, 531.5, 'n' + i, { size: 11, color: 'red', anchor: 'middle', font: 'mono', parent: rg }); });
            /* n3 -> leaf B -> spine -> leaf A -> n2 (spines never talk to each other) */
            S.hopPath = ctx.path('M1420,520 L1485,462 M1485,438 L1420,394 L1225,438 M1225,462 L1290,520', { stroke: 'red', sw: 2.4, parent: rg, glow: true });
            S.hopNote = ctx.text(1355, 556, 'what-if n2+n3: 3 switches', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: rg });
            S.hopPath.setAttribute('opacity', 0);
            swap(ctx, S, 'rightG', rg);
            return Promise.all([ctx.reveal(S.badArc, { from: 'draw', dur: 800 }), ctx.reveal(S.badLbl, { delay: 500 })]).then(function () {
              return ctx.reveal(S.hopPath, { from: 'draw', dur: 1200 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: what that costs in communication time */
            var b = S.botG;
            var g = ctx.group({ parent: b });
            ctx.text(900, 640, 'all-to-all per forward pass (40 layers, 339 MB/layer/GPU)', { size: 11, color: 'dim', font: 'mono', parent: g });
            var tm = [['1 NVLink domain', 30, 'lime'], ['4 + 4 across racks', 155, 'red']];
            var tmBars = tm.map(function (q, i) {
              var y = 666 + i * 40;
              ctx.text(1060, y + 11, q[0], { size: 12, color: q[2], anchor: 'end', font: 'mono', parent: g });
              var bar = ctx.rect(1072, y, q[1] / 155 * 380, 22, { rx: 3, fill: ctx.alpha(q[2], 0.5), stroke: q[2], sw: 1, parent: g });
              ctx.text(1072 + q[1] / 155 * 380 - 8, y + 11.5, q[1] + ' ms', { size: 12, color: 'white', anchor: 'end', font: 'mono', weight: 600, parent: g });
              bar._w = q[1] / 155 * 380;
              return bar;
            });
            ctx.text(900, 772, '× 100 forwards per shot (50 steps × CFG 2):', { size: 11, color: 'dim', font: 'mono', parent: g });
            var tot = ctx.text(900, 796, '3.0 s vs 15.5 s of pure communication', { size: 13, color: 'white', font: 'mono', weight: 600, parent: g });
            tmBars.forEach(function (bar) { bar.setAttribute('width', 0); });
            tot.setAttribute('opacity', 0);
            return Promise.all(tmBars.map(function (bar, i) { return ctx.animate(bar, { width: [0, bar._w] }, 800, 'out', 300 + i * 500); })).then(function () {
              return ctx.reveal(tot, { from: 'up', dist: 10 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the rule: one NVLink domain, one leaf switch */
            S.goodPath = ctx.path('M1420,520 L1470,462 L1500,462 L1485,520', { stroke: 'lime', sw: 2.4, parent: S.rightG, glow: true });
            S.goodNote = ctx.text(1355, 576, 'n3+n4 under one leaf: 1 switch', { size: 11, color: 'lime', anchor: 'middle', font: 'mono', parent: S.rightG });
            S.goodNote.setAttribute('opacity', 0);
            return Promise.all([ctx.reveal(S.goodPath, { from: 'draw', dur: 900 }), ctx.reveal(S.goodNote, { delay: 500 })]).then(function () {
              return Promise.all([ctx.pulse(S.nvl[0], { color: 'lime', dur: 700 }), ctx.pulse(S.nvl[1], { color: 'lime', dur: 700 })]);
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Preemption',
        beats: [
          {
            say: 'Now the creator is watching previews, so shots three and four are promoted to interactive priority, and no node is free.',
            card: { tag: 'KEY IDEA', title: 'Priority beats fair share under pressure', body: 'When interactive work arrives and no node is free, something with lower priority has to give its GPUs back.' },
            deep: '<p>Promotion is a change of <code>PriorityClass</code> on the Workload: the previews are what the creator is looking at right now, so they move from batch-video to interactive-video. Higher priority does not create GPUs; it lets the scheduler take them from someone else.</p>' +
              '<p>Kueue: <code>preemption.withinClusterQueue</code> and <code>reclaimWithinCohort</code>; kube-scheduler: <code>PostFilter</code> preemption. Both evict lower-priority pods to make the gang fit.</p>'
          },
          {
            say: 'The scheduler picks the cheapest victim: the fine tuning job, which is preemptible, checkpointable and the lowest priority in the fleet.',
            card: { tag: 'HOW IT WORKS', title: 'Cheapest victim first', body: 'Lowest priority first, then the least work lost (newest admitted, or freshest checkpoint if the scheduler knows it), then fewest pods. PodDisruptionBudgets are respected.' },
            deep: '<p>Victim selection: lowest priority first, then least work lost, then fewest pods (minimise disruption; respect PodDisruptionBudgets). Kueue\'s default proxy for lost work is admission time, newest first; a checkpoint-aware scheduler can use the real number:</p>' +
              '<div class="eq">cost(v) = rank<sub>priority</sub>(v), then (t − t<sub>ckpt</sub>) · GPUs(v), then pods(v)</div>' +
              '<p>Only the fine-tuning job qualifies: both LLM pools are interactive and the other shots are the same priority as the promoted ones.</p>'
          },
          {
            say: 'It gets a termination signal, writes an asynchronous checkpoint to local NVMe within its grace period, and releases sixteen GPUs.',
            card: { tag: 'NUMBERS', title: 'A checkpoint in seconds', stat: { v: '≈ 3.4 s', l: 'to write 84 GB per node to local NVMe at an assumed 25 GB/s; the 168 GB checkpoint is sharded over 16 GPUs' } },
            deep: '<p>Checkpoint size for a full fine-tune with Adam (mixed precision). Training holds 16 B/param in HBM (2 BF16 weights + 2 grads + 4 FP32 master + 8 Adam m,v), but gradients are recomputed and need not be saved:</p>' +
              '<div class="eq">bytes<sub>ckpt</sub> ≈ P · (4 master + 8 Adam m,v) = 12 P → 14B params ≈ 168 GB</div>' +
              '<p>Sharded over 16 GPUs (FSDP / DCP sharded state dict) that is 10.5 GB per GPU, 84 GB per node; to local NVMe RAID at ~25 GB/s ≈ 3.4 s, then uploaded to object storage in the background. LoRA-only checkpoints are megabytes.</p>'
          },
          {
            say: 'The two shots start seconds later, and the training job goes back into the queue, to resume from its checkpoint when capacity returns.',
            card: {
              tag: 'TRADE-OFF', title: 'How often to checkpoint', body: 'Checkpoint too rarely and every preemption loses hours; too often and the writes eat compute. Young and Daly: interval ≈ √(2·C·M).',
              more: '<p>Expected waste per unit time ≈ C/τ (checkpoint overhead) + τ/(2M) (average work lost after an interruption). Setting the derivative to zero, −C/τ² + 1/(2M) = 0, gives τ* = √(2CM). Daly\'s higher-order estimate adds a correction when C is not small against M.</p>'
            },
            deep: '<p>How often to checkpoint? With checkpoint cost C and mean time between interruptions M (failures + preemptions), Young/Daly:</p>' +
              '<div class="eq">τ* ≈ √(2 · C · M)<br>e.g. C = 5 s, M = 1 h → τ* ≈ 190 s</div>' +
              '<p>Expected lost work per preemption ≈ τ*/2 + restart cost; the scheduler can use it as the preemption "price" when choosing victims.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.topoG, 400, true);
          /* beat 0: shots three and four are promoted */
          var urgent = ctx.label(330, 258, '▲ promoted: interactive-video', { color: 'magenta', size: 11, parent: S.lanesG });
          S.urgent = urgent;
          return Promise.all([ctx.reveal(urgent, { from: 'scale' }), ctx.pulse(S.vLane, { color: 'magenta', dur: 700, times: 2 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the cheapest victim */
            var rg = ctx.group();
            panelTitle(ctx, rg, 1150, 345, 'VICTIM SELECTION');
            lines(ctx, rg, 1150, 378, ['1. lowest priority first', '2. least work lost (newest)', '3. fewest pods', '   respect PodDisruptionBudgets', '', 'candidate: ft-16', '  priority low · preempt yes'], { lh: 22 });
            swap(ctx, S, 'rightG', rg);
            S.hlVictim = ctx.highlight(S.pTrain, { color: 'red', pad: 6 });
            return ctx.pulse(S.pTrain, { color: 'red', dur: 500, times: 2 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: SIGTERM, checkpoint, release */
            var b = ctx.group();
            panelTitle(ctx, b, 80, 612, 'PREEMPTION TIMELINE (seconds)');
            var x0 = 260, sc = 16;
            ctx.line(x0, 830, x0 + 60 * sc, 830, { color: 'faint', sw: 1.4, parent: b });
            for (var t = 0; t <= 60; t += 10) {
              ctx.line(x0 + t * sc, 826, x0 + t * sc, 834, { color: 'faint', parent: b });
              ctx.text(x0 + t * sc, 848, t + ' s', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
            }
            var lanes = [['ft-16 (victim)', 648, 'blue'], ['storage', 700, 'teal'], ['shot3 / shot4', 752, 'lime']];
            lanes.forEach(function (l) { ctx.text(x0 - 12, l[1] + 12, l[0], { size: 12, color: l[2], anchor: 'end', font: 'mono', parent: b }); });
            var segs = [[0, 0, 1, 'SIGTERM', 'red'], [0, 1, 5, 'ckpt', 'blue'], [0, 5, 8, 'exit', 'blue'],
              [1, 5, 40, 'upload shards → object store (background)', 'teal'], [2, 8, 12, 'bind', 'lime'], [2, 12, 20, 'load', 'lime'], [2, 20, 60, 'denoising …', 'lime']];
            S.pSegs = segs.map(function (s) {
              var y = lanes[s[0]][1], w = Math.max(10, (s[2] - s[1]) * sc);
              var g = ctx.group({ parent: b });
              ctx.rect(x0 + s[1] * sc, y, w, 24, { rx: 4, fill: ctx.alpha(s[4], 0.4), stroke: s[4], sw: 1, parent: g });
              if (s[3].length * 7.4 + 10 < w) ctx.text(x0 + s[1] * sc + w / 2, y + 12.5, s[3], { size: 11, color: 'white', anchor: 'middle', font: 'mono', parent: g });
              else ctx.text(x0 + s[1] * sc + w / 2, y - 9, s[3], { size: 11, color: s[4], anchor: 'middle', font: 'mono', parent: g });
              return g;
            });
            ctx.text(x0, 800, 'ckpt = async sharded checkpoint → local NVMe (≈3.4 s), well inside a 30 s grace period', { size: 11, color: 'dim', font: 'mono', parent: b });
            swap(ctx, S, 'botG', b);
            var ck = ctx.group();
            panelTitle(ctx, ck, 1150, 345, 'CHECKPOINT MATH');
            lines(ctx, ck, 1150, 378, ['ckpt: master + Adam = 12 B/param', '14B params  → 168 GB', 'FSDP over 16 → 10.5 GB/GPU', 'node NVMe ~25 GB/s → ~3.4 s'], { lh: 22 });
            S.ckG = ck;
            swap(ctx, S, 'rightG', ck);
            ctx.reveal(S.pSegs, { from: 'left', delay: 400, stagger: 220 });
            return ctx.wait(700).then(function () {
              S.ckpt = ctx.path('M880,470 C880,560 440,600 420,700', { stroke: ctx.alpha('teal', 0.6), sw: 1.5, dash: '4 4', arrow: true, parent: S.piecesG });
              return Promise.all([ctx.reveal(S.ckpt, { from: 'draw', dur: 600 }), ctx.packet(S.ckpt, { color: 'teal', dur: 900, label: 'ckpt 168 GB' })]);
            }).then(function () {
              ctx.fadeOut(S.ckpt, 400, true);
              ctx.fadeOut(S.hlVictim, 300, true);
              return ctx.fadeOut(S.pTrain, 500, true);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the two shots start, the trainer requeues */
            lines(ctx, S.ckG, 1150, 378 + 5 * 22 * 1.14, ['Young/Daly interval', 'τ* ≈ √(2·C·M) ≈ 190 s', '(C = 5 s, M = 1 h)'], { lh: 22, color: 'amber' });
            renderVideoLane(ctx, S, [5], 1);
            S.tChip = chip(ctx, S.lanesG, 596, 385, 16, 'blue', 'ft-16 · resume @ ckpt');
            ctx.reveal(S.tChip, { from: 'right' });
            S.pShot3 = piece(ctx, S.piecesG, 4, 0, 8, 1, 'lime', 'shot3 · interactive · 8');
            S.pShot4 = piece(ctx, S.piecesG, 5, 0, 8, 1, 'lime', 'shot4 · interactive · 8');
            return Promise.all([ctx.reveal(S.pShot3, { from: 'down', dist: 40, dur: 600 }), ctx.reveal(S.pShot4, { from: 'down', dist: 40, dur: 600, delay: 200 })]);
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Autoscale & cold start',
        beats: [
          {
            say: 'Shots five and six, plus the training job, are still waiting. The autoscaler converts that backlog into GPU seconds and asks for one more node.',
            card: { tag: 'NUMBERS', title: 'Backlog becomes nodes', stat: { v: '1,520', u: 'GPU·s', l: 'two queued shots × 8 GPUs × 95 s; draining it in 190 s needs one more 8-GPU node' } },
            deep: '<p>Scale on work, not on CPU:</p>' +
              '<div class="eq">Δnodes = ⌈ Σ<sub>queued</sub> GPUs·t̂ / (8 · T<sub>drain</sub>) ⌉ − idle &nbsp;=&nbsp; ⌈ 2·8·95 / (8·190) ⌉ − 0 = 1</div>' +
              '<p>t̂ is the predicted runtime of each queued job (here from the per-shot history), T<sub>drain</sub> the time in which the backlog should be cleared, and 8 the GPUs per node. The training job is best effort and does not count toward the target.</p>'
          },
          {
            say: 'But a cold node is slow: provisioning, pulling a large container image, downloading forty gigabytes of weights, compiling kernels and capturing CUDA graphs can take five minutes.',
            card: { tag: 'NUMBERS', title: 'A cold start takes minutes', stat: { v: '≈ 5', u: 'min', l: 'provision 3 min + image 1 min + weights 40 s + init 45 s for one video worker (illustrative)' } },
            deep: '<p>Cold-start anatomy (illustrative, 14B DiT + an ~11 GB umT5-XXL text encoder):</p>' +
              '<table><tr><th>Phase</th><th>Cold</th><th>Mitigation</th></tr>' +
              '<tr><td>Provision node</td><td>2–10 min</td><td>warm pool / standby nodes</td></tr>' +
              '<tr><td>Container image (10–20 GB)</td><td>~1 min</td><td>pre-pulled images, lazy pull (SOCI, stargz)</td></tr>' +
              '<tr><td>Weights (~40 GB)</td><td>~40 s at 1 GB/s</td><td>node-local NVMe cache, P2P, streaming loaders</td></tr>' +
              '<tr><td>Init: NCCL, torch.compile, CUDA graphs</td><td>30–60 s</td><td>cached compile artifacts, CUDA checkpoint/restore</td></tr></table>'
          },
          {
            say: 'Warm pools, node local weight caches, streaming loaders and restored CUDA state cut that to about twenty seconds.',
            card: {
              tag: 'NUMBERS', title: 'A warm start takes seconds', stat: { v: '≈ 20 s', l: 'standby node + pre-pulled image + NVMe weight cache + streamed load + restored CUDA state' },
              more: '<p>ServerlessLLM-style loaders exploit the storage hierarchy (NVMe → DRAM → HBM) with chunked, pipelined loading; <code>cuda-checkpoint</code> and CRIU-style snapshots restore an already-initialised process instead of paying NCCL and torch.compile again.</p>'
            },
            deep: '<p>Every cold phase has a mitigation: a <b>warm pool</b> of powered-on standby nodes removes provisioning, <b>pre-pulled images</b> remove the registry, a <b>node-local NVMe cache</b> and <b>streaming loaders</b> hide the weight copy, and <b>snapshotted CUDA state</b> skips initialisation.</p>' +
              '<p>The residual ~20 s is the NVMe read of the resident shard plus a CUDA-state restore. It is paid per node, not per job, so a warm node then serves many shots.</p>'
          },
          {
            say: 'That is the difference between an autoscaler that helps and one that arrives too late. The new node lights up, and shot five starts on it.',
            card: { tag: 'WHY IT MATTERS', title: 'Cold starts decide if scaling helps', body: 'If provisioning takes longer than the backlog takes to drain, the new node arrives after the burst is over.' },
            deep: '<p>Scale-down needs hysteresis (for example 10 minutes idle) so a 5-minute cold start is not paid twice when the next burst arrives. The trade is idle GPU-hours against cold-start latency: a warm pool of k standby nodes costs k × 8 GPUs continuously.</p>' +
              '<p>Right-sizing the pool is a queueing decision: size it for the burst size you want to absorb without waiting, not for the mean load.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.urgent, 400, true);   /* the promotion label belongs to the preemption step */
          /* beat 0: backlog -> +1 node */
          var rg = ctx.group();
          panelTitle(ctx, rg, 1150, 345, 'AUTOSCALER');
          lines(ctx, rg, 1150, 378, ['queued: shot5, shot6, ft-16', 'video backlog', '  2 × 8 GPU × 95 s = 1,520 GPU·s', 'drain target 190 s', '  → 1,520 / (8 × 190) = 1 node', 'ft-16 waits for spare capacity'], { lh: 22 });
          S.scaleLbl = ctx.label(1300, 530, 'scale-up: +1 node (rack B)', { color: 'red', size: 12, parent: rg });
          swap(ctx, S, 'rightG', rg);
          S.newRow = ctx.group({ parent: S.gridG });
          var y6 = rowY(6);
          ctx.text(690, y6 + 20, 'node-6', { size: 11, color: 'red', anchor: 'end', font: 'mono', parent: S.newRow });
          S.newCells = [];
          for (var c = 0; c < 8; c++) S.newCells.push(ctx.rect(cellX(c), y6, CELL, CELL, { rx: 5, fill: '#0c1428', stroke: 'red', sw: 1, dash: '3 3', parent: S.newRow }));
          ctx.path('M1062,' + rowY(3) + ' h8 V' + (y6 + CELL) + ' h-8', { stroke: ctx.alpha('red', 0.6), sw: 1.4, parent: S.newRow });
          ctx.hud('backlog 1,520 GPU·s → +1 node');
          return ctx.reveal(S.newRow, { from: 'down', delay: 300 }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: a cold start */
            var b = ctx.group();
            panelTitle(ctx, b, 80, 612, 'COLD vs WARM START of one video worker (illustrative)');
            var x0 = 250, sc = 2.7;
            S.csSegs = [];
            S.csRow = function (row) {
              ctx.text(x0 - 14, row[1] + 14, row[0], { size: 13, color: 'white', anchor: 'end', font: 'mono', weight: 600, parent: b });
              var x = x0, tot = 0, segs = [];
              row[2].forEach(function (s) {
                if (s[0] <= 0) return;
                var w = s[0] * sc;
                var seg = ctx.rect(x, row[1], w, 28, { rx: 3, fill: ctx.alpha(s[2], 0.45), stroke: s[2], sw: 1, parent: b });
                seg._w = w;
                if (w > 90) ctx.text(x + w / 2, row[1] + 14.5, s[1], { size: 11, color: 'white', anchor: 'middle', font: 'mono', parent: b });
                segs.push(seg);
                x += w; tot += s[0];
              });
              var tt = ctx.text(x + 10, row[1] + 14.5, '≈ ' + tot + ' s', { size: 13, color: row[0] === 'cold' ? 'red' : 'lime', font: 'mono', weight: 700, parent: b });
              tt.setAttribute('opacity', 0);
              segs.forEach(function (sg) { sg.setAttribute('width', 0); });
              return { segs: segs, total: tt };
            };
            [['provision', 'red'], ['image', 'blue'], ['weights', 'teal'], ['init', 'amber']].forEach(function (l, i) {
              ctx.rect(x0 + 60 + i * 110, 806, 12, 12, { rx: 2, fill: ctx.alpha(l[1], 0.6), stroke: l[1], sw: 1, parent: b });
              ctx.text(x0 + 78 + i * 110, 812, l[0], { size: 11, color: l[1], font: 'mono', parent: b });
            });
            ctx.text(x0, 812, 'legend:', { size: 11, color: 'dim', font: 'mono', parent: b });
            S.csBottom = b;
            var cold = S.csRow(['cold', 650, [[180, 'provision node', 'red'], [60, 'image 15 GB', 'blue'], [40, 'weights 40 GB', 'teal'], [45, 'compile + graphs', 'amber']]]);
            swap(ctx, S, 'botG', b);
            return Promise.all(cold.segs.map(function (seg, i) { return ctx.animate(seg, { width: [0, seg._w] }, 500, 'out', 500 + i * 300); })).then(function () {
              return ctx.reveal(cold.total, { from: 'left', dur: 400 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: a warm start */
            var warm = S.csRow(['warm', 730, [[0, '', 'red'], [0, '', 'blue'], [6, 'NVMe', 'teal'], [14, 'restore', 'amber']]]);
            var note = ctx.text(250, 790, 'warm = standby node + pre-pulled image + NVMe weight cache + streamed load + restored CUDA state', { size: 11, color: 'dim', font: 'mono', parent: S.csBottom });
            note.setAttribute('opacity', 0);
            return Promise.all(warm.segs.map(function (seg, i) { return ctx.animate(seg, { width: [0, seg._w] }, 500, 'out', 300 + i * 250); })).then(function () {
              ctx.reveal(note, { from: 'up', dist: 10 });
              return ctx.reveal(warm.total, { from: 'left', dur: 400 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the node comes up and shot 5 starts */
            return ctx.tween(900, function (t) {
              S.newCells.forEach(function (cl, i) {
                var on = t * 8 > i;
                cl.setAttribute('stroke-dasharray', on ? 'none' : '3 3');
                cl.setAttribute('stroke', on ? ctx.alpha('red', 0.28) : ctx.color('red'));
              });
            }, 'linear').then(function () {
              renderVideoLane(ctx, S, [6], 0);
              S.pShot5 = piece(ctx, S.piecesG, 6, 0, 8, 1, 'lime', 'shot5 · 8 (warm start ~20 s)');
              return ctx.reveal(S.pShot5, { from: 'down', dist: 40, dur: 600 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'GPU sharing',
        beats: [
          {
            say: 'Finally, not every model deserves a whole GPU. The embedding model, the safety classifier, the reranker and the speech recognizer each use a sliver of an H100.',
            card: { tag: 'KEY IDEA', title: 'Small models strand whole GPUs', body: 'Four tiny models, each under ten gigabytes and mostly idle, hold four full GPUs hostage.' },
            deep: '<p>Good MIG tenants: embedding, reranker, safety, ASR and VAE-encode models with small batches and footprints of ≤ 10 GB. Bad tenants: anything bandwidth-bound that needs the full 3.35 TB/s.</p>' +
              '<p>The four small models here are the replicas the repack moved next to each other in step four. Each occupies one whole GPU today, though its weights, KV cache and activations would fit in a seventh of one.</p>'
          },
          {
            say: 'Multi instance GPU carves one H100 into up to seven hardware isolated slices, each with its own compute, cache and ten gigabytes of memory.',
            card: { tag: 'NUMBERS', title: 'Seven hardware slices', stat: { v: '7 × 10 GB', l: 'MIG 1g.10gb slices on an 80 GB H100: one seventh of the SMs each, with private L2 and memory paths' } },
            deep: '<table><tr><th>Mode</th><th>Sharing and isolation</th><th>QoS</th></tr>' +
              '<tr><td>MIG</td><td>spatial, hardware partitions; own HBM slice, L2, copy engines</td><td>deterministic</td></tr>' +
              '<tr><td>MPS</td><td>spatial, concurrent kernels; separate address spaces and optional memory limits, but a fatal fault reaches every client</td><td>active-thread % caps</td></tr>' +
              '<tr><td>Time-slicing</td><td>temporal, context switch; no memory isolation</td><td>noisy neighbours</td></tr></table>' +
              '<p>Granularity on an H100 80 GB: MIG up to 7 × 1g.10gb (one seventh of the SMs each), MPS up to about 60 client contexts per device in NVIDIA\'s current documentation, time-slicing any number of replicas.</p>'
          },
          {
            say: 'Packing the four small models into one partitioned GPU frees three whole GPUs for bigger work.',
            card: { tag: 'NUMBERS', title: 'Three GPUs come back', stat: { v: '3', u: 'GPUs', l: 'returned to the pool: 4 models × 1 GPU become 1 GPU with 4 MIG slices and 3 spare' } },
            deep: '<p>Kubernetes exposes MIG slices as distinct resources (<code>nvidia.com/mig-1g.10gb</code>) via the GPU Operator; DRA allows dynamic partitioning per claim.</p>' +
              '<div class="note">Here: 4 small models × 1 GPU → 1 GPU with 4 MIG slices (3 spare slices) ⇒ 3 GPUs returned to the pool, enough for another TP2 replica plus headroom.</div>' +
              '<details><summary>Go deeper</summary><p>On an H100 80 GB the MIG profiles are 1g.10gb (up to 7 per GPU), 1g.20gb (4), 2g.20gb (3), 3g.40gb (2), 4g.40gb (1) and 7g.80gb (1), and placements must respect fixed slice boundaries, so a 3g.40gb cannot start on just any free slice. Repartitioning needs an idle GPU, which is why MIG suits stable pools of small tenants rather than per-request sharing. For a model above 10 GB, or one that bursts to a whole GPU, MPS or time-slicing with memory limits is the alternative.</p></details>'
          },
          {
            say: 'That is the scheduler\'s job in one sentence: the right shape, in the right place, at the right time.',
            card: { tag: 'KEY IDEA', title: 'Right shape, place, time and speed', body: 'Gangs and MIG slices for shape, NVLink domains and racks for place, priority and fair share for time, warm pools for speed.' },
            deep: '<p>The whole chamber in one page: <b>shape</b> (gangs of 8, TP slices, MIG partitions), <b>place</b> (best-fit packing, NVLink domain, rack and leaf), <b>time</b> (priority, dominant resource fairness, preemption) and <b>speed</b> (warm pools, node-local weight caches, streaming loaders).</p>' +
              '<p>Two chambers pick up where the scheduler ends: <i>Load Balancing</i> routes individual requests once replicas exist, and <i>GPU</i> zooms into what a slice or a full device actually contains.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          var host = liveBox(S.pLLM.e);   /* emb was repacked to node-0 g6 in step 4 */
          var small = ['e', 'f', 'g', 'h'].map(function (id) { return S.pLLM[id]; });
          var sm = ctx.label(880, 562, 'four small models · < 10 GB each · mostly idle', { color: 'amber', size: 11 });
          /* beat 0: four small models each hold a whole GPU */
          return Promise.all([ctx.reveal(sm, { from: 'up', dist: 10 }), pulseLive(ctx, small[0], { color: 'amber', dur: 600 }), pulseLive(ctx, small[1], { color: 'amber', dur: 600 }),
            pulseLive(ctx, small[2], { color: 'amber', dur: 600 }), pulseLive(ctx, small[3], { color: 'amber', dur: 600 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: MIG slices */
            var b = ctx.group();
            panelTitle(ctx, b, 80, 612, 'ONE H100 80 GB · MIG 7 × 1g.10gb');
            ctx.rect(80, 628, 1000, 236, { rx: 10, fill: ctx.alpha('red', 0.04), stroke: 'red', sw: 1.4, parent: b });
            S.slices = [];
            S.sliceParts = [];
            for (var i = 0; i < 7; i++) {
              var x = 96 + i * 139, g = ctx.group({ parent: b });
              var box = ctx.rect(x, 644, 129, 204, { rx: 6, fill: ctx.alpha('faint', 0.08), stroke: 'faint', sw: 1.2, parent: g });
              ctx.text(x + 64.5, 662, 'slice ' + i, { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: g });
              var sms = [];
              for (var q = 0; q < 16; q++) sms.push(ctx.rect(x + 16 + (q % 4) * 25, 676 + Math.floor(q / 4) * 18, 20, 13, { rx: 2, fill: ctx.alpha('white', 0.06), parent: g }));
              ctx.text(x + 64.5, 757, '1/7 of the SMs', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: g });
              var hbmBar = ctx.rect(x + 14, 772, 101, 16, { rx: 3, fill: ctx.alpha('white', 0.05), stroke: ctx.alpha('teal', 0.7), sw: 1, parent: g });
              ctx.text(x + 64.5, 780.5, '10 GB HBM', { size: 11, color: 'teal', anchor: 'middle', font: 'mono', parent: g });
              S.sliceParts.push({ box: box, sms: sms, hbm: hbmBar, x: x });
              S.slices.push(g);
            }
            lines(ctx, b, 1110, 650, ['MIG  hard partitions,', '     own L2 + memory ctrl', 'MPS  concurrent kernels,', '     no fault isolation', 'TS   time-slicing,', '     no memory isolation'], { lh: 23 });
            S.migB = b;
            swap(ctx, S, 'botG', b);
            return ctx.reveal(S.slices, { from: 'up', delay: 400, stagger: 110 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: four tenants fill four slices, the other GPUs are freed */
            var names = [['embed', 'amber'], ['safety-clf', 'pink'], ['rerank', 'amber'], ['ASR', 'orange']];
            var fills = [];
            names.forEach(function (n, i) {
              var sp = S.sliceParts[i], col = ctx.color(n[1]);
              sp.box.setAttribute('stroke', col);
              sp.box.setAttribute('fill', ctx.alpha(n[1], 0.08));
              sp.sms.forEach(function (el) { el.setAttribute('fill', col); el.setAttribute('fill-opacity', 0.06); fills.push(ctx.animate(el, { 'fill-opacity': [0.06, 0.55] }, 500, 'out', 200 + i * 200)); });
              sp.hbm.setAttribute('fill', ctx.alpha('teal', 0.35));
              var nm = ctx.text(sp.x + 64.5, 818, n[0], { size: 13, color: n[1], anchor: 'middle', font: 'mono', weight: 600, parent: S.migB });
              ctx.reveal(nm, { from: 'up', dist: 10, delay: 250 + i * 200 });
            });
            var fr = ctx.text(1110, 830, 'freed: 3 whole GPUs', { size: 12, color: 'teal', font: 'mono', weight: 700, parent: S.migB });
            ctx.reveal(fr, { delay: 1400 });
            S.migCell = ctx.group({ parent: S.piecesG, opacity: 0 });
            ctx.rect(host.x, host.y, host.w, host.h, { rx: 5, fill: '#1a1206', stroke: 'amber', sw: 1.5, parent: S.migCell });
            for (var k = 0; k < 7; k++) {
              ctx.rect(host.x + 2.5 + k * 5, host.y + 4, 4, host.h - 8, { rx: 1, fill: k < 4 ? ctx.color('amber') : ctx.alpha('amber', 0.2), parent: S.migCell });
            }
            var movers = ['f', 'g', 'h'];
            return ctx.wait(700).then(function () {
              return Promise.all(movers.map(function (id, i) {
                var p = S.pLLM[id], bx = p.box;
                return ctx.transform(p, { x: host.cx - bx.cx, y: host.cy - bx.cy, s: 1 }, 800, 'inOut', i * 150).then(function () { return ctx.fadeOut(p, 300, true); });
              }));
            }).then(function () {
              ctx.reveal(S.migCell, { dur: 400 });
              ctx.fadeOut(S.pLLM.e, 300, true);
              ctx.fadeOut(sm, 300, true);
              var freed = ctx.group({ parent: S.piecesG });
              [[1, 6], [0, 7], [1, 7]].forEach(function (rc) {   /* where safe, rrk, asr sat after the repack */
                ctx.rect(cellX(rc[1]) + 2, rowY(rc[0]) + 2, CELL - 4, CELL - 4, { rx: 4, stroke: 'teal', sw: 1.6, dash: '3 3', parent: freed, glow: true });
                ctx.text(cellX(rc[1]) + CELL / 2, rowY(rc[0]) + CELL / 2 + 0.5, 'free', { size: 11, color: 'teal', anchor: 'middle', font: 'mono', parent: freed });
              });
              return ctx.reveal(freed, { from: 'scale', delay: 200 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the scheduler in one line */
            var rg = ctx.group();
            panelTitle(ctx, rg, 1150, 345, 'SCHEDULER, IN ONE LINE');
            var ln = lines(ctx, rg, 1150, 380, ['right shape   gangs, MIG slices', 'right place   NVLink domain, rack', 'right time    priority, DRF, preempt', 'right speed   warm pools, caches'], { lh: 26 });
            swap(ctx, S, 'rightG', rg);
            return ctx.wait(900);
          });
        }
      }
    ]
  });
})();
