/* L2 — GPU Cluster Scheduling. Queues, fair share, Tetris-style placement, gangs, topology, preemption,
 * autoscaling / cold starts and GPU sharing, animated on a 6-node (48-GPU) slice of the fleet. */
(function () {
  var GX = 700, P = 45, CELL = 40;
  function rowY(r) { return 175 + r * 50 + (r >= 3 ? 14 : 0); }
  function cellX(c) { return GX + c * P; }
  function nb(s) { return s.replace(/ /g, ' '); }

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
    var w = 11 * g + 20;
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

  /* bottom / right panel swapping */
  function swap(ctx, S, key, g) {
    if (S[key]) ctx.remove(S[key], 350);
    S[key] = g;
    ctx.reveal(g, { from: 'up', dur: 500, delay: 200 });
    return g;
  }
  function panelTitle(ctx, g, x, y, str, col) {
    ctx.text(x, y, str, { size: 13, color: col || 'red', font: 'display', weight: 700, spacing: 1, parent: g });
  }

  Atlas.register({
    id: 'scheduler',
    refs: [
      'Ghodsi et al., <i>Dominant Resource Fairness: Fair Allocation of Multiple Resource Types</i>, NSDI 2011',
      'Verma et al., <i>Large-scale cluster management at Google with Borg</i>, EuroSys 2015',
      'Jeon et al., <i>Analysis of Large-Scale Multi-Tenant GPU Clusters for DNN Training Workloads</i> (Philly), USENIX ATC 2019',
      'Weng et al., <i>MLaaS in the Wild: Workload Analysis and Scheduling in Large-Scale Heterogeneous GPU Clusters</i>, NSDI 2022',
      'Kubernetes SIG Scheduling, <i>Kueue</i> (ClusterQueue, cohorts, Topology-Aware Scheduling) and <i>Volcano</i> PodGroup docs, 2025',
      'NVIDIA, <i>Multi-Instance GPU User Guide</i> and <i>Multi-Process Service</i> documentation (H100 / Blackwell), 2024–2025',
      'Daly, <i>A higher order estimate of the optimum checkpoint interval for restart dumps</i>, FGCS 2006',
      'Fu et al., <i>ServerlessLLM: Low-Latency Serverless Inference for Large Language Models</i>, OSDI 2024'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Three job classes',
        say: 'The scheduler decides which job gets which GPUs, and when. Three classes of work compete for the same fleet. Interactive LLM replicas must answer in under a second. Video shots are gangs of eight GPUs that run for minutes. Training and fine tuning jobs run for hours, but can be interrupted. Here is a slice of the cluster: six nodes of eight GPUs each, in two racks. A fine tuning job has already backfilled the idle nodes of rack B.',
        deep: '<p>Each class maps to a Kubernetes <code>PriorityClass</code> and a Kueue <code>ClusterQueue</code>; the scheduler must satisfy very different objectives at once:</p>' +
          '<table><tr><th>Class</th><th>Objective</th><th>Unit</th></tr>' +
          '<tr><td>Interactive LLM</td><td>tail latency (TTFT/TPOT p99)</td><td>long-lived replica, 1–8 GPUs</td></tr>' +
          '<tr><td>Video generation</td><td>makespan / throughput</td><td>job, gang of 8 (or 16–72 on NVL72)</td></tr>' +
          '<tr><td>Train / fine-tune</td><td>goodput, cost</td><td>elastic job, 8–1000s GPUs, checkpointable</td></tr></table>' +
          '<p>Time scales span eight decades, from sub-ms routing to day-long training, so scheduling is <b>hierarchical</b>: quota admission (Kueue) → pod placement (kube-scheduler / Volcano plugins) → per-GPU batching inside the engine.</p>' +
          '<div class="note"><b>Backfill</b>: preemptible training soaks up idle GPUs so utilisation stays high, on the understanding that it will be evicted when latency-critical work arrives. Multi-tenant trace studies (Microsoft Philly, Alibaba PAI) show large amounts of allocated-but-idle and queued-while-free GPU time; interactive pools must be provisioned for peak, so backfill is the cheapest way to recover the troughs.</div>',
        run: function (ctx) {
          var S = ctx.state;
          /* lanes */
          S.lanesG = ctx.group();
          LANES.forEach(function (L, i) {
            var g = ctx.group({ parent: S.lanesG });
            ctx.rect(60, L.y - 34, 540, 68, { rx: 10, fill: ctx.alpha(L.col, 0.05), stroke: ctx.alpha(L.col, 0.45), sw: 1.2, parent: g });
            ctx.text(74, L.y - 9, L.title, { size: 14, weight: 600, color: L.col, font: 'display', parent: g });
            ctx.text(74, L.y + 11, L.sub, { size: 11, color: 'dim', font: 'mono', parent: g });
            ctx.reveal(g, { from: 'left', delay: i * 120 });
          });
          ctx.line(604, 300, 642, 300, { color: 'dim', sw: 1.4, arrow: true, parent: S.lanesG });
          S.lChips = {};
          var xr = 596;
          var lg = ctx.group({ parent: S.lanesG });
          LLM_JOBS.forEach(function (j) { var c = chip(ctx, lg, xr, 215, j.g, 'amber', j.label); S.lChips[j.id] = c; xr -= c.w + 4; });
          ctx.reveal(lg, { from: 'left', delay: 400 });
          renderVideoLane(ctx, S, [1, 2, 3], 3);
          S.tChip = chip(ctx, S.lanesG, 596, 385, 16, 'blue', 'ft-16 · full FT · 16 GPU');
          /* GPU grid */
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
          ctx.reveal(S.gridG, { delay: 200 });
          S.piecesG = ctx.group();
          /* class table */
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
          ctx.reveal(S.tableG, { from: 'right', delay: 300 });
          var cq = ctx.code({ x: 1140, y: 330, w: 420, title: 'kueue · ClusterQueue', lang: 'text', size: 12, color: 'red', lines: [
            'kind: ClusterQueue   # one per class', 'name: video-batch', 'cohort: studio-gpus  # borrow idle quota', 'resourceGroups:',
            '- nvidia.com/gpu: nominal 64, borrow ≤ 32', 'preemption:', '  withinClusterQueue: LowerPriority'].map(nb) });
          swap(ctx, S, 'rightG', cq);
          /* bottom: time scales */
          var b = ctx.group();
          panelTitle(ctx, b, 80, 612, 'ONE SCHEDULER, EIGHT DECADES OF TIME');
          function xOf(s) { return 160 + (Math.log(s) / Math.LN10 + 3) * 162.5; }
          ctx.line(160, 740, 1460, 740, { color: 'faint', sw: 1.5, parent: b });
          [[0.001, '1 ms'], [0.01, '10 ms'], [0.1, '100 ms'], [1, '1 s'], [10, '10 s'], [60, '1 min'], [600, '10 min'], [3600, '1 h'], [86400, '1 day']].forEach(function (t) {
            var x = xOf(t[0]);
            ctx.line(x, 734, x, 746, { color: 'faint', sw: 1.2, parent: b });
            ctx.text(x, 758, t[1], { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
          });
          [[0.02, 0.05, 'TPOT 20–50 ms', 'amber', 0], [0.2, 1, 'TTFT 0.2–1 s', 'amber', 0], [60, 180, 'one shot 60–180 s', 'lime', 0],
            [3600, 86400, 'fine-tune: hours–days', 'blue', 0], [0.01, 0.1, 'scheduling cycle', 'red', 1], [10, 30, 'preempt grace ~30 s', 'red', 1],
            [60, 300, 'cold start 1–5 min', 'red', 1]].forEach(function (m) {
            var x0 = xOf(m[0]), x1 = xOf(m[1]), y = m[4] ? 790 : 700;
            ctx.rect(x0, y - 7, Math.max(6, x1 - x0), 14, { rx: 4, fill: ctx.alpha(m[3], 0.45), stroke: m[3], sw: 1, parent: b });
            ctx.text((x0 + x1) / 2, m[4] ? y + 22 : y - 20, m[2], { size: 11, color: m[3], anchor: 'middle', font: 'mono', parent: b });
          });
          swap(ctx, S, 'botG', b);
          /* training job backfills rack B */
          return ctx.wait(900).then(function () {
            ctx.fadeOut(S.tChip, 400, true);
            S.pTrain = piece(ctx, S.piecesG, 4, 0, 8, 2, 'blue', 'ft-16 · FSDP · 16 GPU');
            return ctx.reveal(S.pTrain, { from: 'down', dist: 40, dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Fair share (DRF)',
        say: 'Before placing anything, the scheduler decides who deserves resources. With several tenants and several resource types, fairness is tricky. Dominant resource fairness looks at each tenant\'s largest share of any resource, its dominant share, and always serves the tenant whose dominant share is smallest. Watch it fill: the video studio is GPU heavy, the LLM tenant is CPU heavy, and allocation alternates until the next task no longer fits.',
        deep: '<p>For tenant i with usage u<sub>i,r</sub> of resource r and capacity C<sub>r</sub>:</p>' +
          '<div class="eq">s<sub>i</sub> = max<sub>r</sub> u<sub>i,r</sub> / C<sub>r</sub><br>next task → argmin<sub>i</sub> s<sub>i</sub> (weighted: s<sub>i</sub>/w<sub>i</sub>)</div>' +
          '<p>Example: cluster ⟨48 GPU, 672 vCPU⟩; studio-A tasks ⟨8, 64⟩ (dominant: GPU, 1/6 per task), tenant-B tasks ⟨1, 48⟩ (dominant: CPU, 1/14 per task). Progressive filling gives A = 4 tasks (s = 0.67), B = 8 tasks (s = 0.57); then CPU (640/672) blocks both.</p>' +
          '<p>DRF is <b>strategy-proof</b> (lying about demand never helps), <b>envy-free</b>, <b>Pareto-efficient</b> and satisfies <b>sharing incentive</b> (no tenant does worse than a static 1/n partition).</p>' +
          '<p>In Kubernetes: Kueue <code>ClusterQueue</code> nominal quotas per flavor (H100, B200…), <b>cohorts</b> that lend idle quota, <code>borrowingLimit</code>/<code>lendingLimit</code>, and fair-sharing weights; preemption reclaims borrowed quota when the lender needs it back.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var b = ctx.group();
          panelTitle(ctx, b, 80, 612, 'DOMINANT RESOURCE FAIRNESS · progressive filling');
          ctx.text(80, 642, nb('cluster  ⟨48 GPU, 672 vCPU⟩'), { size: 12, color: 'text', font: 'mono', parent: b });
          ctx.text(80, 666, nb('studio-A (video)   task ⟨8 GPU, 64 vCPU⟩'), { size: 12, color: 'lime', font: 'mono', parent: b });
          ctx.text(80, 688, nb('tenant-B (LLM+ETL) task ⟨1 GPU, 48 vCPU⟩'), { size: 12, color: 'amber', font: 'mono', parent: b });
          ctx.text(80, 724, 's_i = max_r u_ir / C_r', { size: 13, color: 'white', font: 'mono', parent: b });
          ctx.text(80, 746, 'serve argmin_i s_i', { size: 13, color: 'white', font: 'mono', parent: b });
          S.drfCount = ctx.text(80, 790, 'A tasks 0 · B tasks 0', { size: 12, color: 'dim', font: 'mono', parent: b });
          var X0 = 560, WB = 520;
          var rows = [['A · GPU', 'lime', 48], ['A · vCPU', 'lime', 672], ['B · GPU', 'amber', 48], ['B · vCPU', 'amber', 672]];
          S.drfBars = rows.map(function (r0, i) {
            var y = 642 + i * 30 + (i >= 2 ? 14 : 0);
            ctx.text(X0 - 10, y + 9, r0[0], { size: 11, color: r0[1], anchor: 'end', font: 'mono', parent: b });
            ctx.rect(X0, y, WB, 18, { rx: 3, fill: ctx.alpha('white', 0.05), parent: b });
            var bar = ctx.rect(X0, y, 0, 18, { rx: 3, fill: ctx.alpha(r0[1], 0.55), stroke: r0[1], sw: 1, parent: b });
            var val = ctx.text(X0 + WB + 8, y + 9, '0%', { size: 11, color: r0[1], font: 'mono', parent: b });
            return { bar: bar, val: val, cap: r0[2], y: y };
          });
          ctx.text(X0, 790, 'bold outline = dominant resource', { size: 11, color: 'dim', font: 'mono', parent: b });
          S.drfBars[0].bar.setAttribute('stroke-width', 2.6);
          S.drfBars[3].bar.setAttribute('stroke-width', 2.6);
          /* allocation ticker */
          var seq = ['A', 'B', 'B', 'B', 'A', 'B', 'B', 'A', 'B', 'B', 'A', 'B'];
          ctx.text(1160, 642, 'allocation order', { size: 11, color: 'dim', font: 'mono', parent: b });
          var tick = seq.map(function (s, i) {
            return ctx.label(1178 + (i % 6) * 60, 672 + Math.floor(i / 6) * 34, s + (seq.slice(0, i + 1).filter(function (q) { return q === s; }).length), { color: s === 'A' ? 'lime' : 'amber', size: 11, w: 50, parent: b });
          });
          S.drfEnd = ctx.text(1160, 750, nb('s_A = 0.67   s_B = 0.57'), { size: 12, color: 'white', font: 'mono', parent: b });
          S.drfEnd2 = ctx.text(1160, 772, 'next task fits neither (CPU 640/672)', { size: 11, color: 'red', font: 'mono', parent: b });
          swap(ctx, S, 'botG', b);
          var a = 0, bb = 0, prev = [0, 0, 0, 0];
          var T0 = 700, DT = 380;
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
          ctx.reveal([S.drfEnd, S.drfEnd2], { delay: T0 + seq.length * DT + 200 });
          return ctx.wait(T0 + seq.length * DT + 700);
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Tetris placement',
        say: 'Now placement. LLM replicas need one, two or four GPUs each. A default scheduler spreads them across nodes, which is great for resilience but terrible for gangs. Watch the pieces land. Sixteen GPUs are free, yet no single node has eight free, so the next video shot cannot start. This is fragmentation, the same problem as Tetris: total free space is plenty, but it has the wrong shape.',
        deep: '<p>Node scoring in kube-scheduler (NodeResourcesFit):</p>' +
          '<div class="eq">LeastAllocated: score = Σ<sub>r</sub> w<sub>r</sub> · free<sub>r</sub>/cap<sub>r</sub>   (spread)<br>MostAllocated: score = Σ<sub>r</sub> w<sub>r</sub> · used<sub>r</sub>/cap<sub>r</sub>   (pack)</div>' +
          '<p>Spreading minimises blast radius; packing (best-fit bin-packing) keeps whole nodes free for gangs. A simple fragmentation metric for gang size k:</p>' +
          '<div class="eq">F<sub>k</sub> = 1 − (Σ<sub>n</sub> k·⌊free<sub>n</sub>/k⌋) / Σ<sub>n</sub> free<sub>n</sub></div>' +
          '<p>Here the pods arrived in order TP4, TP4, TP2, TP2, then four 1-GPU models; LeastAllocated sends each to the emptiest node, giving free = 4, 4, 4, 4, 0, 0 → Σ = 16 but ⌊·/8⌋ = 0 everywhere → F<sub>8</sub> = 100%: every free GPU is useless to an 8-GPU gang. MostAllocated, same arrival order, would have packed all 16 replica GPUs onto nodes 0–1, leaving nodes 2 and 3 whole. Bin-packing is NP-hard in general; production schedulers use greedy best-fit with pool separation (LLM pool vs gang pool) and periodic defragmentation.</p>' +
          '<div class="note">Heterogeneity makes it worse: packing must respect GPU type, NVLink domain and NUMA/NIC affinity simultaneously (multi-dimensional bin-packing).</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.pLLM = {};
          LLM_JOBS.forEach(function (j, i) {
            var pos = SPREAD[j.id];
            var p = piece(ctx, S.piecesG, pos[0], pos[1], j.g, 1, 'amber', j.label);
            S.pLLM[j.id] = p;
            ctx.after(200 + i * 260, function () { ctx.fadeOut(S.lChips[j.id], 250, true); });
            ctx.reveal(p, { from: 'down', dist: 40, dur: 450, delay: 250 + i * 260 });
          });
          /* right: fragmentation meter */
          var rg = ctx.group();
          panelTitle(ctx, rg, 1150, 345, 'FRAGMENTATION');
          var m = [['free GPUs', '16', 'text'], ['largest block on one node', '4', 'amber'], ['8-GPU gang fits?', 'NO', 'red'], ['F₈ (useless free GPUs)', '100%', 'red']];
          m.forEach(function (q, i) {
            ctx.text(1150, 380 + i * 34, q[0], { size: 12, color: 'dim', font: 'mono', parent: rg });
            ctx.text(1555, 380 + i * 34, q[1], { size: 18, color: q[2], font: 'mono', weight: 700, anchor: 'end', parent: rg });
          });
          swap(ctx, S, 'rightG', rg);
          /* bottom: free-per-node histogram */
          var b = ctx.group();
          panelTitle(ctx, b, 80, 612, 'FREE GPUs PER NODE after spread placement');
          var free = [4, 4, 4, 4, 0, 0];
          S.freeBars = free.map(function (f, i) {
            var x = 160 + i * 110;
            ctx.rect(x, 650, 64, 200, { rx: 4, fill: ctx.alpha('white', 0.03), parent: b });
            var bar = ctx.rect(x, 850 - f * 25, 64, f * 25, { rx: 4, fill: ctx.alpha('red', 0.45), stroke: 'red', sw: 1, parent: b });
            ctx.text(x + 32, 862, 'node-' + i, { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
            ctx.text(x + 32, 838 - f * 25, String(f), { size: 13, color: 'white', anchor: 'middle', font: 'mono', parent: b });
            return bar;
          });
          ctx.line(140, 650, 800, 650, { color: 'lime', sw: 1.6, dash: '6 5', parent: b });
          ctx.text(800, 638, 'gang needs 8 on ONE node (NVLink domain)', { size: 11, color: 'lime', anchor: 'end', font: 'mono', parent: b });
          ctx.para(900, 660, ['LeastAllocated (default) spreads:', '  good for failure isolation,', '  fatal for gangs.', '', 'MostAllocated / best-fit packs:', '  small jobs fill partial nodes,', '  whole nodes stay free for gangs.'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: b });
          swap(ctx, S, 'botG', b);
          ctx.hud('16 GPUs free · 0 nodes with 8 free');
          return ctx.wait(250 + 8 * 260 + 600).then(function () {
            return Promise.all([2, 3].map(function (r) { return ctx.pulse(S.cells[r][7], { color: 'red', dur: 700 }); }));
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Gang scheduling',
        say: 'Suppose we scheduled video pods one at a time anyway. Three shots each grab part of what they need: six GPUs, five, and five. None can start, and none will let go. That is a deadlock, a cycle in the wait for graph. Gang scheduling fixes it with all or nothing admission: a job gets its eight GPUs atomically or holds none. Combined with repacking the small LLM replicas, two whole nodes open up, and shots one and two start immediately.',
        deep: '<p>Distributed jobs (NCCL collectives, Ulysses all-to-all) cannot make progress until <b>every</b> rank is up, so partial allocation is pure waste and can deadlock (hold-and-wait + no preemption + circular wait).</p>' +
          '<ul><li><b>Volcano</b>: <code>PodGroup.minMember = 8</code>; the gang plugin only binds when all 8 pods fit.</li>' +
          '<li><b>Kueue</b>: quota is reserved for the whole <code>Workload</code> at admission; <code>waitForPodsReady</code> evicts and requeues it if all pods are not running within a timeout (breaks physical-placement deadlocks).</li>' +
          '<li><b>Coscheduling</b> plugin (scheduler-plugins) and Slurm allocate the same way.</li></ul>' +
          '<p><b>Defragmentation</b>: the descheduler drains stateless LLM replicas (they re-register with the router in seconds) and best-fit packs them, turning scattered free GPUs into whole free nodes:</p>' +
          '<pre>free per node before: 4 4 4 4 0 0  → no gang fits\nafter repack:         0 0 8 8 0 0  → 2 gangs fit</pre>' +
          '<div class="note">Cost of the repack: a few seconds of lost capacity on 6 small replicas (TP2 ×2, four 1-GPU models) vs. two 95 s shots starting now instead of waiting for natural churn.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          /* naive per-pod placement -> partial gangs */
          S.partial = ctx.group();
          var parts = [[1, [[0, 4], [0, 5], [0, 6], [0, 7], [1, 4], [1, 5]]], [2, [[2, 4], [2, 5], [2, 6], [2, 7], [1, 6]]], [3, [[3, 4], [3, 5], [3, 6], [3, 7], [1, 7]]]];
          var k = 0;
          parts.forEach(function (pp) {
            pp[1].forEach(function (rc) {
              var g = ctx.group({ parent: S.partial });
              ctx.rect(cellX(rc[1]) + 2, rowY(rc[0]) + 2, CELL - 4, CELL - 4, { rx: 4, fill: ctx.alpha('lime', 0.12), stroke: 'lime', sw: 1.2, dash: '3 3', parent: g });
              ctx.text(cellX(rc[1]) + CELL / 2, rowY(rc[0]) + CELL / 2 + 0.5, 's' + pp[0], { size: 12, color: 'lime', anchor: 'middle', font: 'mono', weight: 600, parent: g });
              ctx.reveal(g, { from: 'scale', dur: 250, delay: 200 + k * 90 });
              k++;
            });
          });
          /* right: PodGroup */
          var pg = ctx.code({ x: 1140, y: 330, w: 420, title: 'volcano · PodGroup (gang)', lang: 'text', size: 12, color: 'lime', lines: [
            'kind: PodGroup', 'name: shot-3', 'spec:', '  minMember: 8        # all-or-nothing', '  queue: video-batch', '  minResources: {nvidia.com/gpu: 8}',
            '# + topology: 1 NVLink domain'].map(nb) });
          swap(ctx, S, 'rightG', pg);
          /* bottom: wait-for graph */
          var b = ctx.group();
          panelTitle(ctx, b, 80, 612, 'WAIT-FOR GRAPH without gang scheduling');
          var nodes = [[260, 680, 'shot1', 'holds 6/8'], [460, 810, 'shot2', 'holds 5/8'], [160, 810, 'shot3', 'holds 5/8']];
          nodes.forEach(function (n) {
            ctx.rect(n[0] - 55, n[1] - 22, 110, 44, { rx: 8, fill: ctx.alpha('lime', 0.1), stroke: 'lime', sw: 1.3, parent: b });
            ctx.text(n[0], n[1] - 7, n[2], { size: 13, color: 'white', anchor: 'middle', font: 'mono', weight: 600, parent: b });
            ctx.text(n[0], n[1] + 10, n[3], { size: 11, color: 'lime', anchor: 'middle', font: 'mono', parent: b });
          });
          S.wf = [
            ctx.path('M315,690 Q430,700 450,786', { stroke: 'red', sw: 1.8, arrow: true, parent: b }),
            ctx.path('M405,818 L217,818', { stroke: 'red', sw: 1.8, arrow: true, parent: b }),
            ctx.path('M150,786 Q150,700 203,686', { stroke: 'red', sw: 1.8, arrow: true, parent: b })
          ];
          ctx.text(310, 762, 'waits for', { size: 11, color: 'red', anchor: 'middle', font: 'mono', parent: b });
          ctx.text(600, 700, 'cycle ⇒ DEADLOCK', { size: 14, color: 'red', font: 'mono', weight: 700, parent: b });
          ctx.para(760, 650, ['Fix = gang admission:', '1. reserve 8 GPUs atomically, else hold 0', '2. roll back partial pods (s1 s2 s3)', '3. descheduler repacks stateless LLM replicas', '4. admit shot1 → node-2, shot2 → node-3', '5. shot3 waits in queue holding nothing'], { size: 12, color: 'text', font: 'mono', lh: 24, parent: b });
          swap(ctx, S, 'botG', b);
          var dl = ctx.label(880, 497, 'DEADLOCK · 16 GPUs held, 0 running', { color: 'red', size: 12, parent: S.partial });
          ctx.reveal(dl, { from: 'scale', delay: 200 + k * 90 + 200 });
          ctx.reveal(S.wf, { from: 'draw', delay: 1300, stagger: 250 });
          return ctx.wait(200 + k * 90 + 1700).then(function () {
            return ctx.fadeOut(S.partial, 500, true);
          }).then(function () {
            /* node-2 residents -> node-0 g4..g7, node-3 residents -> node-1 g4..g7 (4 columns = 180 px) */
            var mv = [['c', 180, -100], ['e', 180, -100], ['g', 180, -100], ['d', 180, -114], ['f', 180, -114], ['h', 180, -114]];
            return Promise.all(mv.map(function (m, i) { return ctx.transform(S.pLLM[m[0]], { x: m[1], y: m[2] }, 800, 'inOut', i * 120); }));
          }).then(function () {
            renderVideoLane(ctx, S, [3, 4, 5], 1);
            S.pShot1 = piece(ctx, S.piecesG, 2, 0, 8, 1, 'lime', 'shot1 · gang of 8 · SP8');
            S.pShot2 = piece(ctx, S.piecesG, 3, 0, 8, 1, 'lime', 'shot2 · gang of 8 · SP8');
            return Promise.all([ctx.reveal(S.pShot1, { from: 'down', dist: 40, dur: 600 }), ctx.reveal(S.pShot2, { from: 'down', dist: 40, dur: 600, delay: 200 })]);
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Topology-aware',
        say: 'Where a gang lands matters as much as whether it lands. Each video shot uses sequence parallelism, so its eight GPUs exchange activations with all to all collectives at every layer. Inside one server, NVLink moves four hundred fifty gigabytes per second per GPU in each direction. Split the gang four plus four across racks, and four of every seven peers are remote, so most of that traffic crosses InfiniBand at fifty, through a spine switch. Topology aware placement keeps gangs inside one NVLink domain, and keeps multi node jobs under one leaf switch.',
        deep: '<p>DeepSpeed-Ulysses all-to-all volume per layer, per GPU, for the Wan-14B shot (N ≈ 75.6k tokens, d = 5120, p = 8, BF16; q, k, v in and o out):</p>' +
          '<div class="eq">V ≈ 4 · (N/p) · d · 2 B · (p−1)/p ≈ 4 · 9450 · 5120 · 2 · 7/8 ≈ 339 MB</div>' +
          '<table><tr><th>Placement</th><th>per forward (40 layers)</th><th>per shot (80 fwd)</th></tr>' +
          '<tr><td>8 GPUs, one NVLink4 domain (450 GB/s/dir)</td><td>≈ 30 ms</td><td>≈ 2.4 s</td></tr>' +
          '<tr><td>4 + 4 across racks (4/7 of bytes ≈ 194 MB over 50 GB/s IB)</td><td>≈ 155 ms</td><td>≈ 12 s</td></tr></table>' +
          '<p>Topology-aware schedulers encode levels as node labels (NVLink domain / rack / leaf / spine block) and prefer the lowest common level: Kueue <b>Topology-Aware Scheduling</b> (<code>podset-required-topology</code>), Slurm <code>topology/tree</code> and <code>block</code> plugins, Volcano network-topology-aware scheduling. On <b>GB200 NVL72</b> the NVLink domain is a whole rack (72 GPUs), so gangs of 16–64 GPUs can also stay on NVLink.</p>' +
          '<div class="note">Rail-optimised fabrics connect GPU k of every node to leaf k; the scheduler therefore also tries to align ranks to rails so that same-rank traffic stays one hop.</div>',
        run: function (ctx) {
          var S = ctx.state;
          /* NVLink domain bracket around node-2 */
          S.topoG = ctx.group();
          S.nvl = [2, 3].map(function (r) {
            return ctx.rect(GX - 5, rowY(r) - 4, 8 * P + 5, CELL + 8, { rx: 8, stroke: 'lime', sw: 2, dash: '7 4', parent: S.topoG, glow: true });
          });
          /* hypothetical bad split: dashed arc between n2 and n3 (different racks) */
          S.badArc = ctx.path('M' + (cellX(8) - 2) + ',' + (rowY(2) + 20) + ' C1122,' + (rowY(2) + 20) + ' 1122,' + (rowY(3) + 20) + ' ' + (cellX(8) - 2) + ',' + (rowY(3) + 20), { stroke: 'red', sw: 1.8, dash: '4 4', arrow: true, parent: S.topoG });
          ctx.label(880, rowY(5) + 58, 'each gang = 1 NVLink domain ✓ · red arc = 4+4 what-if', { color: 'lime', size: 11, parent: S.topoG });
          ctx.reveal(S.topoG, { delay: 200 });
          /* right: fat-tree */
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
          ctx.text(1355, 556, 'what-if n2+n3: 3 switches · n3+n4: 1 switch', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: rg });
          swap(ctx, S, 'rightG', rg);
          /* bottom: bandwidth + comm time */
          var b = ctx.group();
          panelTitle(ctx, b, 80, 612, 'PER-GPU BANDWIDTH (one direction) → ULYSSES ALL-TO-ALL TIME');
          var bw = [['NVLink5 (B200)', 900, 'lime'], ['NVLink4 (H100)', 450, 'lime'], ['PCIe Gen5 x16', 64, 'blue'], ['IB NDR 400G', 50, 'cyan']];
          var bwBars = bw.map(function (q, i) {
            var y = 640 + i * 34;
            ctx.text(250, y + 10, q[0], { size: 12, color: 'text', anchor: 'end', font: 'mono', parent: b });
            var bar = ctx.rect(262, y, q[1] / 900 * 440, 20, { rx: 3, fill: ctx.alpha(q[2], 0.5), stroke: q[2], sw: 1, parent: b });
            ctx.text(262 + q[1] / 900 * 440 + 8, y + 10.5, q[1] + ' GB/s', { size: 11, color: q[2], font: 'mono', parent: b });
            return bar;
          });
          ctx.text(900, 640, 'all-to-all per forward pass (40 layers, 339 MB/layer/GPU)', { size: 11, color: 'dim', font: 'mono', parent: b });
          var tm = [['1 NVLink domain', 30, 'lime'], ['4 + 4 across racks', 155, 'red']];
          var tmBars = tm.map(function (q, i) {
            var y = 666 + i * 40;
            ctx.text(1060, y + 11, q[0], { size: 12, color: q[2], anchor: 'end', font: 'mono', parent: b });
            var bar = ctx.rect(1072, y, q[1] / 155 * 380, 22, { rx: 3, fill: ctx.alpha(q[2], 0.5), stroke: q[2], sw: 1, parent: b });
            ctx.text(1072 + q[1] / 155 * 380 - 8, y + 11.5, q[1] + ' ms', { size: 12, color: 'white', anchor: 'end', font: 'mono', weight: 600, parent: b });
            return bar;
          });
          ctx.text(900, 772, '× 80 forwards per shot (40 steps × CFG 2):', { size: 11, color: 'dim', font: 'mono', parent: b });
          ctx.text(900, 796, '2.4 s vs 12 s of pure communication', { size: 13, color: 'white', font: 'mono', weight: 600, parent: b });
          swap(ctx, S, 'botG', b);
          bwBars.concat(tmBars).forEach(function (bar, i) {
            var w = parseFloat(bar.getAttribute('width'));
            ctx.animate(bar, { width: [0, w] }, 700, 'out', 500 + i * 120);
          });
          return ctx.wait(700).then(function () {
            return ctx.reveal(S.hopPath, { from: 'draw', dur: 1200 });
          }).then(function () { return ctx.pulse(S.nvl[0], { color: 'lime', dur: 800 }); });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Preemption',
        say: 'Now the creator is watching previews, so shots three and four are promoted to interactive priority, and no node is free. The scheduler picks the cheapest victim: the fine tuning job, which is preemptible. It gets a termination signal, writes an asynchronous checkpoint to local NVMe within its grace period, and releases sixteen GPUs. The two shots start seconds later, and the training job goes back into the queue, to resume from its checkpoint when capacity returns.',
        deep: '<p>Victim selection: lowest priority first, then least work lost since last checkpoint, then fewest pods (minimise disruption; respect PodDisruptionBudgets). Kueue: <code>preemption.withinClusterQueue / reclaimWithinCohort</code>; kube-scheduler: <code>PostFilter</code> preemption.</p>' +
          '<p>Checkpoint size for a full fine-tune with Adam (mixed precision). Training holds 16 B/param in HBM (2 BF16 weights + 2 grads + 4 FP32 master + 8 Adam m,v), but gradients are recomputed and need not be saved:</p>' +
          '<div class="eq">bytes<sub>ckpt</sub> ≈ P · (4 master + 8 Adam m,v) = 12 P → 14B params ≈ 168 GB</div>' +
          '<p>Sharded over 16 GPUs (FSDP / DCP sharded state dict) that is 10.5 GB per GPU, 84 GB per node; to local NVMe RAID at ~25 GB/s ≈ 3.4 s, then uploaded to object storage in the background. LoRA-only checkpoints are megabytes.</p>' +
          '<p>How often to checkpoint? With checkpoint cost C and mean time between interruptions M (failures + preemptions), Young/Daly:</p>' +
          '<div class="eq">τ* ≈ √(2 · C · M)<br>e.g. C = 5 s, M = 1 h → τ* ≈ 190 s</div>' +
          '<p>Expected lost work per preemption ≈ τ*/2 + restart cost; the scheduler can use it as the preemption "price" when choosing victims.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.topoG, 400, true);
          /* bottom: timeline */
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
            if (s[3].length * 6.6 + 10 < w) ctx.text(x0 + s[1] * sc + w / 2, y + 12.5, s[3], { size: 11, color: 'white', anchor: 'middle', font: 'mono', parent: g });
            else ctx.text(x0 + s[1] * sc + w / 2, y - 9, s[3], { size: 11, color: s[4], anchor: 'middle', font: 'mono', parent: g });
            return g;
          });
          ctx.text(x0, 800, 'ckpt = async sharded checkpoint → local NVMe (≈3.4 s), well inside a 30 s grace period', { size: 11, color: 'dim', font: 'mono', parent: b });
          swap(ctx, S, 'botG', b);
          ctx.reveal(S.pSegs, { from: 'left', delay: 400, stagger: 220 });
          /* right: checkpoint math */
          var rg = ctx.group();
          panelTitle(ctx, rg, 1150, 345, 'CHECKPOINT MATH');
          ctx.para(1150, 378, ['ckpt: master + Adam = 12 B/param', '14B params  → 168 GB', 'FSDP over 16 → 10.5 GB/GPU', 'node NVMe ~25 GB/s → ~3.4 s', '', 'Young/Daly interval', 'τ* ≈ √(2·C·M) ≈ 190 s', '(C = 5 s, M = 1 h)'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: rg });
          swap(ctx, S, 'rightG', rg);
          /* grid: evict training, place shot3 + shot4 */
          var urgent = ctx.label(330, 258, '▲ promoted: interactive-video', { color: 'magenta', size: 11, parent: S.lanesG });
          ctx.reveal(urgent, { from: 'scale', delay: 200 });
          return ctx.wait(700).then(function () {
            return ctx.pulse(S.pTrain, { color: 'red', dur: 500, times: 2 });
          }).then(function () {
            S.ckpt = ctx.path('M880,470 C880,560 440,600 420,700', { stroke: ctx.alpha('teal', 0.6), sw: 1.5, dash: '4 4', arrow: true, parent: S.piecesG });
            return Promise.all([ctx.reveal(S.ckpt, { from: 'draw', dur: 600 }), ctx.packet(S.ckpt, { color: 'teal', dur: 900, label: 'ckpt 168 GB' })]);
          }).then(function () {
            ctx.fadeOut(S.ckpt, 400, true);
            return ctx.fadeOut(S.pTrain, 500, true);
          }).then(function () {
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
        say: 'Shots five and six, plus the training job, are still waiting. The autoscaler converts that backlog into GPU seconds and asks for one more node. But a cold node is slow: provisioning, pulling a large container image, downloading forty gigabytes of weights, compiling kernels and capturing CUDA graphs can take five minutes. Warm pools, node local weight caches and streaming loaders cut that to about twenty seconds, which is the difference between an autoscaler that helps and one that arrives too late.',
        deep: '<p>Scale on work, not on CPU:</p>' +
          '<div class="eq">Δnodes = ⌈ Σ<sub>queued</sub> GPUs·t̂ / (8 · T<sub>drain</sub>) ⌉ − idle   =   ⌈ 2·8·95 / (8·190) ⌉ − 0 = 1</div>' +
          '<p>Cold-start anatomy (illustrative, 14B DiT + 11B text encoder):</p>' +
          '<table><tr><th>Phase</th><th>Cold</th><th>Mitigation</th></tr>' +
          '<tr><td>Provision node</td><td>2–10 min</td><td>warm pool / standby nodes</td></tr>' +
          '<tr><td>Container image (10–20 GB)</td><td>~1 min</td><td>pre-pulled images, lazy pull (SOCI, stargz)</td></tr>' +
          '<tr><td>Weights (~40 GB)</td><td>~40 s at 1 GB/s</td><td>node-local NVMe cache, P2P, streaming loaders</td></tr>' +
          '<tr><td>Init: NCCL, torch.compile, CUDA graphs</td><td>30–60 s</td><td>cached compile artifacts, CUDA checkpoint/restore</td></tr></table>' +
          '<p>ServerlessLLM-style loaders exploit the storage hierarchy (NVMe → DRAM → HBM) with chunked, pipelined loading; <code>cuda-checkpoint</code> / CRIU-style snapshots restore an already-initialised process. Scale-down needs hysteresis (e.g. 10 min idle) so a 5-minute cold start is not paid twice.</p>',
        run: function (ctx) {
          var S = ctx.state;
          /* right: backlog */
          var rg = ctx.group();
          panelTitle(ctx, rg, 1150, 345, 'AUTOSCALER');
          ctx.para(1150, 378, ['queued: shot5, shot6, ft-16', 'video backlog', '  2 × 8 GPU × 95 s = 1,520 GPU·s', 'drain target 190 s', '  → 1,520 / (8 × 190) = 1 node', 'ft-16 waits for spare capacity'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: rg });
          S.scaleLbl = ctx.label(1300, 530, 'scale-up: +1 node (rack B)', { color: 'red', size: 12, parent: rg });
          swap(ctx, S, 'rightG', rg);
          /* new node row */
          S.newRow = ctx.group({ parent: S.gridG });
          var y6 = rowY(6) - 0 + 0;
          ctx.text(690, y6 + 20, 'node-6', { size: 11, color: 'red', anchor: 'end', font: 'mono', parent: S.newRow });
          S.newCells = [];
          for (var c = 0; c < 8; c++) S.newCells.push(ctx.rect(cellX(c), y6, CELL, CELL, { rx: 5, fill: '#0c1428', stroke: 'red', sw: 1, dash: '3 3', parent: S.newRow }));
          ctx.path('M1062,' + rowY(3) + ' h8 V' + (y6 + CELL) + ' h-8', { stroke: ctx.alpha('red', 0.6), sw: 1.4, parent: S.newRow });
          ctx.reveal(S.newRow, { from: 'down', delay: 300 });
          /* bottom: cold vs warm */
          var b = ctx.group();
          panelTitle(ctx, b, 80, 612, 'COLD vs WARM START of one video worker (illustrative)');
          var x0 = 250, sc = 2.7;
          var rows = [['cold', 650, [[180, 'provision node', 'red'], [60, 'image 15 GB', 'blue'], [40, 'weights 40 GB', 'teal'], [45, 'compile + graphs', 'amber']]],
            ['warm', 730, [[0, '', 'red'], [0, '', 'blue'], [6, 'NVMe', 'teal'], [14, 'restore', 'amber']]]];
          S.csSegs = [];
          rows.forEach(function (row) {
            ctx.text(x0 - 14, row[1] + 14, row[0], { size: 13, color: 'white', anchor: 'end', font: 'mono', weight: 600, parent: b });
            var x = x0, tot = 0;
            row[2].forEach(function (s) {
              if (s[0] <= 0) return;
              var w = s[0] * sc;
              var seg = ctx.rect(x, row[1], w, 28, { rx: 3, fill: ctx.alpha(s[2], 0.45), stroke: s[2], sw: 1, parent: b });
              if (w > 90) ctx.text(x + w / 2, row[1] + 14.5, s[1], { size: 11, color: 'white', anchor: 'middle', font: 'mono', parent: b });
              S.csSegs.push(seg);
              x += w; tot += s[0];
            });
            ctx.text(x + 10, row[1] + 14.5, '≈ ' + tot + ' s', { size: 13, color: row[0] === 'cold' ? 'red' : 'lime', font: 'mono', weight: 700, parent: b });
          });
          ctx.text(x0, 790, 'warm = standby node + pre-pulled image + NVMe weight cache + streamed load + restored CUDA state', { size: 11, color: 'dim', font: 'mono', parent: b });
          ctx.text(x0, 812, 'legend:', { size: 11, color: 'dim', font: 'mono', parent: b });
          [['provision', 'red'], ['image', 'blue'], ['weights', 'teal'], ['init', 'amber']].forEach(function (l, i) {
            ctx.rect(x0 + 60 + i * 110, 806, 12, 12, { rx: 2, fill: ctx.alpha(l[1], 0.6), stroke: l[1], sw: 1, parent: b });
            ctx.text(x0 + 78 + i * 110, 812, l[0], { size: 11, color: l[1], font: 'mono', parent: b });
          });
          swap(ctx, S, 'botG', b);
          S.csSegs.forEach(function (seg, i) {
            var w = parseFloat(seg.getAttribute('width'));
            ctx.animate(seg, { width: [0, w] }, 500, 'out', 500 + i * 250);
          });
          ctx.hud('backlog 1,520 GPU·s → +1 node');
          return ctx.wait(1900).then(function () {
            return ctx.tween(900, function (t) {
              S.newCells.forEach(function (cl, i) {
                var on = t * 8 > i;
                cl.setAttribute('stroke-dasharray', on ? 'none' : '3 3');
                cl.setAttribute('stroke', on ? ctx.alpha('red', 0.28) : ctx.color('red'));
              });
            }, 'linear');
          }).then(function () {
            renderVideoLane(ctx, S, [6], 0);
            S.pShot5 = piece(ctx, S.piecesG, 6, 0, 8, 1, 'lime', 'shot5 · 8 (warm start ~20 s)');
            return ctx.reveal(S.pShot5, { from: 'down', dist: 40, dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'GPU sharing',
        say: 'Finally, not every model deserves a whole GPU. The embedding model, the safety classifier, the reranker and the speech recognizer each use a sliver of an H100. Multi instance GPU carves one H100 into up to seven hardware isolated slices, each with its own compute, cache and ten gigabytes of memory. Packing the four small models into one partitioned GPU frees three whole GPUs for bigger work. That is the scheduler\'s job in one sentence: the right shape, in the right place, at the right time.',
        deep: '<table><tr><th></th><th>MIG</th><th>MPS</th><th>Time-slicing</th></tr>' +
          '<tr><td>Sharing</td><td>spatial, hardware partitions</td><td>spatial, concurrent kernels</td><td>temporal, context switch</td></tr>' +
          '<tr><td>Memory isolation</td><td>yes (own HBM slice, L2, copy engines)</td><td>limits only, no fault isolation</td><td>none</td></tr>' +
          '<tr><td>QoS</td><td>deterministic</td><td>active-thread % caps</td><td>noisy neighbours</td></tr>' +
          '<tr><td>Granularity (H100 80 GB)</td><td>up to 7 × 1g.10gb (16 of 132 SMs each)</td><td>up to 48 clients</td><td>any</td></tr></table>' +
          '<p>Kubernetes exposes MIG slices as distinct resources (<code>nvidia.com/mig-1g.10gb</code>) via the GPU Operator; DRA allows dynamic partitioning per claim. Good MIG tenants: embedding / reranker / safety / ASR / VAE-encode models with small batches and ≤ 10 GB footprints. Bad tenants: anything bandwidth-bound that needs the full 3.35 TB/s.</p>' +
          '<div class="note">Here: 4 small models × 1 GPU → 1 GPU with 4 MIG slices (3 spare slices) ⇒ 3 GPUs returned to the pool, enough for another TP2 replica plus headroom.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          /* grid: merge small models into node-0 g4 as MIG slices */
          var host = liveBox(S.pLLM.e);   /* emb was repacked to node-0 g6 in step 4 */
          S.migCell = ctx.group({ parent: S.piecesG, opacity: 0 });
          ctx.rect(host.x, host.y, host.w, host.h, { rx: 5, fill: '#1a1206', stroke: 'amber', sw: 1.5, parent: S.migCell });
          for (var k = 0; k < 7; k++) {
            ctx.rect(host.x + 2.5 + k * 5, host.y + 4, 4, host.h - 8, { rx: 1, fill: k < 4 ? ctx.color('amber') : ctx.alpha('amber', 0.2), parent: S.migCell });
          }
          /* bottom: MIG diagram */
          var b = ctx.group();
          panelTitle(ctx, b, 80, 612, 'ONE H100 80 GB · MIG 7 × 1g.10gb');
          var names = [['embed', 'amber'], ['safety-clf', 'pink'], ['rerank', 'amber'], ['ASR', 'orange'], ['free', 'faint'], ['free', 'faint'], ['free', 'faint']];
          ctx.rect(80, 628, 1000, 236, { rx: 10, fill: ctx.alpha('red', 0.04), stroke: 'red', sw: 1.4, parent: b });
          S.slices = names.map(function (n, i) {
            var x = 96 + i * 139, g = ctx.group({ parent: b });
            ctx.rect(x, 644, 129, 204, { rx: 6, fill: ctx.alpha(n[1], 0.08), stroke: n[1], sw: 1.2, parent: g });
            ctx.text(x + 64.5, 662, 'slice ' + i, { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: g });
            for (var q = 0; q < 16; q++) ctx.rect(x + 16 + (q % 4) * 25, 676 + Math.floor(q / 4) * 18, 20, 13, { rx: 2, fill: n[0] === 'free' ? ctx.alpha('white', 0.06) : ctx.alpha(n[1], 0.55), parent: g });
            ctx.text(x + 64.5, 757, '16 of 132 SMs', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: g });
            ctx.rect(x + 14, 772, 101, 16, { rx: 3, fill: n[0] === 'free' ? ctx.alpha('white', 0.05) : ctx.alpha('teal', 0.35), stroke: ctx.alpha('teal', 0.7), sw: 1, parent: g });
            ctx.text(x + 64.5, 780.5, '10 GB HBM', { size: 11, color: 'teal', anchor: 'middle', font: 'mono', parent: g });
            ctx.text(x + 64.5, 818, n[0], { size: 13, color: n[0] === 'free' ? 'dim' : n[1], anchor: 'middle', font: 'mono', weight: 600, parent: g });
            return g;
          });
          ctx.para(1110, 650, ['MIG  hard partitions,', '     own L2 + memory ctrl', 'MPS  concurrent kernels,', '     no fault isolation', 'TS   time-slicing,', '     no memory isolation', '', 'freed: 3 whole GPUs'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 23, parent: b });
          swap(ctx, S, 'botG', b);
          ctx.reveal(S.slices, { from: 'up', delay: 400, stagger: 110 });
          /* right panel: recap */
          var rg = ctx.group();
          panelTitle(ctx, rg, 1150, 345, 'SCHEDULER, IN ONE LINE');
          ctx.para(1150, 380, ['right shape   gangs, MIG slices', 'right place   NVLink domain, rack', 'right time    priority, DRF, preempt', 'right speed   warm pools, caches'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 26, parent: rg });
          swap(ctx, S, 'rightG', rg);
          var movers = ['f', 'g', 'h'];
          return ctx.wait(600).then(function () {
            return Promise.all(movers.map(function (id, i) {
              var p = S.pLLM[id], bx = p.box;
              return ctx.transform(p, { x: host.cx - bx.cx, y: host.cy - bx.cy, s: 1 }, 800, 'inOut', i * 150).then(function () { return ctx.fadeOut(p, 300, true); });
            }));
          }).then(function () {
            ctx.reveal(S.migCell, { dur: 400 });
            ctx.fadeOut(S.pLLM.e, 300, true);
            var freed = ctx.group({ parent: S.piecesG });
            [[1, 6], [0, 7], [1, 7]].forEach(function (rc) {   /* where safe, rrk, asr sat after the repack */
              ctx.rect(cellX(rc[1]) + 2, rowY(rc[0]) + 2, CELL - 4, CELL - 4, { rx: 4, stroke: 'teal', sw: 1.6, dash: '3 3', parent: freed, glow: true });
              ctx.text(cellX(rc[1]) + CELL / 2, rowY(rc[0]) + CELL / 2 + 0.5, 'free', { size: 11, color: 'teal', anchor: 'middle', font: 'mono', parent: freed });
            });
            ctx.reveal(freed, { from: 'scale', delay: 200 });
            return ctx.wait(900);
          });
        }
      }
    ]
  });
})();
