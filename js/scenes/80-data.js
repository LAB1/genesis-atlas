/* L1 — Data, Memory & Storage. The six stores that hold every durable fact of a video job, shown as a
 * "tab bar" along the top; each step focuses one store and animates its mechanism underneath
 * (content addressing + erasure coding, optimistic concurrency + outbox, partitioned log, token bucket,
 * embeddings, provenance graph for shot 3), then the data flywheel and a latency waterfall. */
(function () {
  var STORES = [
    { t: 'Object Store', s: 'S3 · GCS · CAS', i: 'cloud', chip: 'GB blobs · 10s of ms' },
    { t: 'Metadata DB', s: 'Postgres · Spanner', i: 'db', chip: 'rows · ACID · ~ms' },
    { t: 'Event Log', s: 'Kafka · Redpanda', i: 'queue', chip: 'append-only · ordered' },
    { t: 'Cache', s: 'Redis · Valkey', i: 'bolt', chip: 'sub-ms · TTL' },
    { t: 'Vector DB', s: 'HNSW · IVF-PQ', i: 'search', chip: 'ANN · top-k' },
    { t: 'Lineage', s: 'W3C PROV graph', i: 'net', chip: 'audit · replay' }
  ];
  var SX = [150, 410, 670, 930, 1190, 1450], SY = 215;

  function head(ctx, g, x, y, s, col) {
    return ctx.text(x, y, s, { size: 14, font: 'display', weight: 700, color: col || 'teal', spacing: 1, parent: g });
  }
  /* code panel that keeps column alignment (SVG collapses runs of spaces by default) */
  function code(ctx, o) {
    var c = ctx.code(o);
    c.lineEls.forEach(function (t) { t.style.whiteSpace = 'pre'; });
    return c;
  }
  function panel(ctx, g, x, y, w, h, col) {
    return ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(6,12,24,0.72)', stroke: ctx.alpha(col || 'teal', 0.35), sw: 1.2, parent: g });
  }

  /* start a new detail view: fade out previous, focus the selected store(s) */
  function view(ctx, S, keep) {
    if (S.cur) ctx.remove(S.cur, 350);
    var g = ctx.group();
    S.cur = g;
    var k = [g];
    if (keep === null) ctx.focus(null);
    else {
      keep.forEach(function (i) { k.push(S.st[i]); k.push(S.chips[i]); });
      ctx.focus(k, 0.28);
    }
    return g;
  }

  Atlas.register({
    id: 'data',
    refs: [
      'Corbett et al., <i>Spanner: Google\'s Globally-Distributed Database</i>, OSDI 2012',
      'Kreps, Narkhede &amp; Rao, <i>Kafka: a Distributed Messaging System for Log Processing</i>, NetDB 2011; Apache Kafka KIP-98 (EOS) and KIP-405 (tiered storage)',
      'Huang et al., <i>Erasure Coding in Windows Azure Storage</i>, USENIX ATC 2012',
      'Moreau &amp; Missier (eds.), <i>PROV-DM: The PROV Data Model</i>, W3C Recommendation 2013',
      'Kleppmann, <i>Designing Data-Intensive Applications</i>, O\'Reilly 2017 (logs, outbox, fencing tokens)',
      'Wallace et al., <i>Diffusion Model Alignment Using Direct Preference Optimization</i>, CVPR 2024',
      'Liu et al., <i>Improving Video Generation with Human Feedback</i> (VideoReward, Flow-DPO), 2025',
      'Tschannen et al., <i>SigLIP 2: Multilingual Vision-Language Encoders</i>, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Where state lives',
        say: 'The agents and GPU workers you have met are deliberately stateless. Everything durable lands in the data plane, and no single database can do it all. Media bytes go to object storage. Small transactional facts go to a metadata database. Every decision is appended to an event log. Ephemeral state sits in a cache, meaning lives in a vector database, and a lineage graph remembers how every clip was made. Notice the skew: almost all bytes are video.',
        deep: '<p>The control plane (orchestrator, agents, GPU workers) is <b>stateless by design</b>: any process can crash and be replaced, because every durable fact lives in one of six stores, each chosen for an access pattern.</p>' +
          '<table><tr><th>Store</th><th>Holds</th><th>Access profile</th></tr>' +
          '<tr><td>Object store</td><td>sketches, memo, latents, takes, masters, weights</td><td>MB–GB blobs, ~10–100 ms first byte, GB/s aggregate</td></tr>' +
          '<tr><td>Metadata DB</td><td>users, jobs, shots, takes</td><td>KB rows, ACID, ~1–5 ms</td></tr>' +
          '<tr><td>Event log</td><td>agent + workflow events</td><td>append, total order per key</td></tr>' +
          '<tr><td>Cache</td><td>sessions, rate limits, leases</td><td>sub-ms, TTL, loss is tolerable</td></tr>' +
          '<tr><td>Vector DB</td><td>embeddings of media + text</td><td>ANN top-k, ~1–20 ms</td></tr>' +
          '<tr><td>Lineage</td><td>provenance DAG</td><td>append, graph traversal</td></tr></table>' +
          '<p>Latent sanity check (Wan-style causal VAE, 4×8×8 compression, 16 channels): 81 frames at 1280×720 → 21×90×160×16 ≈ 4.8 M values ≈ 9.7 MB in bf16 per take.</p>' +
          '<div class="note">Bytes are skewed: ~98% of the ~0.5 GB per trailer is video (latents, takes, master); the facts that make it reproducible fit in under 1 MB.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.st = []; S.chips = [];
          STORES.forEach(function (d, i) {
            S.st.push(ctx.node({ x: SX[i], y: SY, w: 200, h: 84, kind: 'cyl', title: d.t, sub: d.s, icon: d.i, color: 'teal', titleSize: 15, subSize: 12 }));
            S.chips.push(ctx.label(SX[i], 285, d.chip, { color: i === 4 ? 'teal' : 'dim', size: 12 }));
          });
          ctx.reveal(S.st, { from: 'down', stagger: 110 });
          ctx.reveal(S.chips, { delay: 500, stagger: 110 });
          ctx.hotspot(S.st[4], 'rag-memory', { hint: 'ZOOM ⤢' });

          var g = view(ctx, S, null);
          S.cp = ctx.node({ x: 800, y: 480, w: 420, h: 84, title: 'Control plane', sub: 'orchestrator · agents · GPU workers', icon: 'gear', color: 'magenta', titleSize: 18, parent: g });
          ctx.reveal(S.cp, { from: 'up', delay: 300 });
          var names = ['sketch.png', 'shot row', 'event', 'session', 'embedding', 'edge'];
          S.cl = SX.map(function (x, i) {
            var l = ctx.link({ x: 800 + (i - 2.5) * 56, y: 438 }, { x: x, y: 302 }, { from: 't', to: 'b', color: ctx.alpha('teal', 0.7), sw: 1.4, parent: g });
            ctx.reveal(l, { from: 'draw', delay: 600 + i * 90 });
            return l;
          });

          /* per-job footprint, log scale */
          var fp = ctx.group({ parent: g });
          panel(ctx, fp, 50, 600, 720, 272);
          head(ctx, fp, 70, 626, 'PER-JOB FOOTPRINT · 30 s trailer · log scale');
          var rows = [['input media (3 sketches + memo)', 7, 'violet'], ['latents (12 takes, transient)', 116, 'lime'], ['clip takes (12 × 5 s)', 150, 'lime'],
            ['master + ABR ladder', 230, 'orange'], ['event log', 3, 'magenta'], ['embeddings (~150 × 1152-d)', 0.35, 'teal'], ['metadata + lineage', 0.2, 'teal']];
          function px(v) { return 330 + (Math.log(v) / Math.LN10 + 1) / 4 * 360; }
          S.fpBars = [];
          rows.forEach(function (r, i) {
            var y = 656 + i * 27;
            ctx.text(70, y, r[0], { size: 12, font: 'mono', color: 'text', parent: fp });
            ctx.rect(330, y - 9, 360, 18, { rx: 3, fill: 'rgba(255,255,255,0.03)', parent: fp });
            var b = ctx.rect(330, y - 9, px(r[1]) - 330, 18, { rx: 3, fill: ctx.alpha(r[2], 0.55), stroke: r[2], sw: 1, parent: fp });
            S.fpBars.push(b);
            ctx.text(px(r[1]) + 8, y, r[1] >= 1 ? r[1] + ' MB' : r[1] + ' MB', { size: 12, font: 'mono', color: r[2], parent: fp });
          });
          [0.1, 1, 10, 100, 1000].forEach(function (v) {
            ctx.text(px(v), 856, v < 1 ? '0.1' : String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: fp });
          });
          ctx.text(748, 856, 'MB', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: fp });
          ctx.reveal(fp, { from: 'up', delay: 900 });
          S.fpBars.forEach(function (b, i) {
            var w = parseFloat(b.getAttribute('width'));
            b.setAttribute('width', 0);
            ctx.animate(b, { width: [0, w] }, 700, 'out', 1100 + i * 110);
          });

          /* rules */
          var rl = ctx.group({ parent: g });
          panel(ctx, rl, 830, 600, 720, 272);
          head(ctx, rl, 850, 626, 'WHERE EACH KIND OF STATE GOES');
          [['BYTES', 'cyan', 'by reference: agents pass cas:// URIs, never pixels'],
            ['FACTS', 'blue', 'by value, in transactions: job and shot state'],
            ['CHANGES', 'magenta', 'as immutable events: every decision, replayable'],
            ['MEANING', 'teal', 'as vectors: similarity search for style and cast']].forEach(function (r, i) {
            var y = 672 + i * 50;
            ctx.label(850, y, r[0], { color: r[1], size: 12, anchor: 'start', w: 104, parent: rl });
            ctx.text(972, y, r[2], { size: 14, color: 'text', parent: rl });
          });
          ctx.reveal(rl, { from: 'up', delay: 1200 });
          ctx.hud('per job ≈ 0.5 GB · ~98% of it video bytes');
          return ctx.wait(1300).then(function () {
            return Promise.all(S.cl.map(function (l, i) {
              return ctx.wait(i * 150).then(function () { return ctx.packet(l, { color: 'teal', dur: 900, label: names[i] }); });
            }));
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Object storage',
        say: 'Object storage holds the heavy bytes. Every file is named by the SHA two fifty six hash of its content, so identical uploads collapse to one object and a reference can never point at changed bytes. The blob is split into six data shards plus three parity shards spread across three availability zones: lose an entire zone and the clip still decodes. Uploads are write-once, and lifecycle rules walk old takes from hot to cold tiers, or delete them.',
        deep: '<p><b>Content addressing</b>: key = SHA-256(bytes). Identical uploads collapse to one object (dedup with refcounts), references can never dangle onto changed bytes, and every cache on the path (CDN, GPU-node NVMe, encoded-latent cache) can be keyed by digest with no invalidation protocol.</p>' +
          '<p><b>Erasure coding</b>: split into k data shards, add m parity shards (Reed–Solomon over GF(2<sup>8</sup>)); any k of the k+m shards reconstruct the object.</p>' +
          '<div class="eq">overhead = (k+m)/k = 9/6 = 1.5× &nbsp;vs&nbsp; 3× for triple replication</div>' +
          '<p>With 3 shards per AZ, losing a whole AZ still leaves 6 of 9. Real systems use wider or local codes (Azure LRC 12+2+2) to cut repair traffic; S3 advertises a design durability of 99.999999999%.</p>' +
          '<p><b>Write-once</b>: pre-signed PUT with <code>x-amz-checksum-sha256</code> and <code>If-None-Match: *</code> (S3 conditional writes, 2024) makes uploads idempotent and tamper-evident.</p>' +
          '<p><b>Lifecycle</b> (AWS us-east-1 list prices per GB-month): Standard ≈ $0.023, Standard-IA ≈ $0.0125, Glacier Deep Archive ≈ $0.001. Transient latents are deleted, not archived.</p>' +
          '<span class="muted">Weights live here too: a 14B-parameter DiT in bf16 is ~28 GB, which is why GPU nodes keep a local NVMe weight cache to avoid cold-start pulls.</span>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [0]);
          ctx.hud('RS(6,3): 1.5× overhead · survives loss of one AZ');
          /* 1 content addressing */
          var a = ctx.group({ parent: g });
          head(ctx, a, 60, 345, '1 · CONTENT ADDRESSING');
          var file = ctx.node({ x: 170, y: 400, w: 220, h: 58, title: 'shot3_take2.mp4', sub: '12.4 MB · mezzanine', icon: 'film', color: 'lime', titleSize: 14, subSize: 12, parent: a });
          var hash = ctx.node({ x: 390, y: 400, w: 120, h: 58, title: 'SHA-256', kind: 'chip', color: 'teal', titleSize: 14, parent: a });
          var l1 = ctx.link(file, hash, { color: 'teal', straight: true, parent: a });
          var l2 = ctx.link(hash, { x: 470, y: 400 }, { color: 'teal', straight: true, parent: a });
          S.key = ctx.text(480, 400, '', { size: 14, font: 'mono', color: 'teal', parent: a });
          ctx.text(60, 452, 're-upload sketch_2.png → same digest → HEAD 200 → skip PUT', { size: 12, font: 'mono', color: 'dim', parent: a });
          ctx.reveal(a, { from: 'up' });
          /* 2 erasure coding */
          var b = ctx.group({ parent: g });
          head(ctx, b, 60, 500, '2 · ERASURE CODING · RS(6,3) across 3 AZs');
          var names = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'p1', 'p2', 'p3'];
          var az = [0, 0, 1, 1, 2, 2, 0, 1, 2], slot = [0, 1, 0, 1, 0, 1, 2, 2, 2];
          names.forEach(function (n, i) { ctx.rect(60 + i * 54, 530, 50, 28, { rx: 4, stroke: ctx.alpha(i < 6 ? 'teal' : 'amber', 0.3), sw: 1, dash: '3 3', parent: b }); });
          ctx.text(60, 574, '12.4 MB → 6 data + 3 parity shards × 2.07 MB', { size: 12, font: 'mono', color: 'dim', parent: b });
          ['AZ-a', 'AZ-b', 'AZ-c'].forEach(function (n, i) {
            var x = 60 + i * 238;
            ctx.rect(x, 590, 226, 104, { rx: 8, fill: 'rgba(43,245,196,0.04)', stroke: ctx.alpha('teal', 0.4), dash: '4 4', parent: b });
            ctx.text(x + 12, 606, n, { size: 12, font: 'mono', color: 'dim', parent: b });
            for (var j = 0; j < 3; j++) ctx.rect(x + 14 + j * 70, 620, 62, 60, { rx: 6, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('white', 0.18), sw: 1, parent: b });
          });
          S.shards = names.map(function (n, i) {
            var sg = ctx.group({ parent: b });
            var col = i < 6 ? 'teal' : 'amber';
            ctx.rect(0, 0, 50, 28, { rx: 4, fill: ctx.alpha(col, 0.35), stroke: col, sw: 1.2, parent: sg });
            ctx.text(25, 14.5, n, { size: 13, font: 'mono', color: col, anchor: 'middle', weight: 600, parent: sg });
            ctx.place(sg, 60 + i * 54, 530);
            return sg;
          });
          S.fail = ctx.group({ parent: b });
          ctx.rect(298, 590, 226, 104, { rx: 8, fill: ctx.alpha('red', 0.16), stroke: 'red', sw: 1.5, parent: S.fail });
          ctx.text(411, 606, '✕ AZ-b lost', { size: 12, font: 'mono', color: 'red', anchor: 'middle', weight: 700, parent: S.fail });
          S.failT = ctx.text(60, 722, '6 of 9 shards survive → Reed–Solomon decode ✓   overhead 1.5× (vs 3× replication)', { size: 12, font: 'mono', color: 'lime', parent: b });
          S.fail.setAttribute('opacity', 0); S.failT.setAttribute('opacity', 0);
          ctx.reveal(b, { from: 'up', delay: 200 });
          /* 3 write-once upload */
          var c = ctx.group({ parent: g });
          head(ctx, c, 830, 345, '3 · WRITE-ONCE UPLOAD (pre-signed URL)');
          code(ctx, { x: 830, y: 362, w: 710, title: 'client → object store', lang: 'sh', size: 13, parent: c, lines: [
            'PUT /cas/sha256/9f3a…c1e0?X-Amz-Signature=…',
            'x-amz-checksum-sha256: n6oP…Qk=   # server verifies',
            'If-None-Match: *                   # 412 if key exists',
            'Content-Type: video/mp4',
            '200 OK  (immutable: never overwritten, only deleted)'
          ] });
          ctx.reveal(c, { from: 'up', delay: 300 });
          /* 4 lifecycle */
          var d = ctx.group({ parent: g });
          head(ctx, d, 830, 548, '4 · LIFECYCLE TIERS  (not to scale)');
          [[830, 180, 'HOT · Standard', '$0.023 / GB-mo', 'lime'], [1014, 180, 'WARM · IA', '$0.0125 / GB-mo', 'amber'], [1198, 342, 'COLD · Deep Archive', '≈ $0.001 / GB-mo', 'blue']].forEach(function (t) {
            ctx.rect(t[0], 572, t[1], 58, { rx: 6, fill: ctx.alpha(t[4], 0.12), stroke: ctx.alpha(t[4], 0.6), sw: 1.2, parent: d });
            ctx.text(t[0] + 10, 590, t[2], { size: 13, font: 'display', weight: 700, color: t[4], parent: d });
            ctx.text(t[0] + 10, 613, t[3], { size: 12, font: 'mono', color: 'text', parent: d });
          });
          ctx.line(830, 652, 1540, 652, { color: 'faint', parent: d });
          [[830, '0 d'], [1014, '30 d'], [1198, '90 d'], [1540, '365 d+']].forEach(function (t, i) {
            ctx.line(t[0], 647, t[0], 657, { color: 'dim', parent: d });
            ctx.text(t[0], 670, t[1], { size: 11, font: 'mono', color: 'dim', anchor: i === 3 ? 'end' : (i === 0 ? 'start' : 'middle'), parent: d });
          });
          S.mark = ctx.group({ parent: d });
          ctx.circle(0, 0, 7, { fill: 'lime', parent: S.mark, glow: true });
          ctx.text(0, -16, 'take 3b', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: S.mark });
          ctx.place(S.mark, 840, 652);
          [[830, 706, 'latents → delete @ 7 d', 'red'], [1190, 706, 'rejected takes → delete @ 30 d', 'red'],
            [830, 744, 'approved takes → IA @ 30 d', 'amber'], [1190, 744, 'masters → archive @ 90 d', 'blue'],
            [830, 782, 'inputs → user retention policy', 'dim'], [1190, 782, 'weights → pinned, never tiered', 'dim']].forEach(function (r) {
            ctx.label(r[0], r[1], r[2], { color: r[3], size: 12, anchor: 'start', parent: d });
          });
          ctx.reveal(d, { from: 'up', delay: 400 });
          /* animation */
          return ctx.wait(500).then(function () {
            return Promise.all([ctx.packet(l1, { color: 'lime', dur: 600 }), ctx.wait(300)]);
          }).then(function () {
            return ctx.packet(l2, { color: 'teal', dur: 300 });
          }).then(function () {
            return ctx.typeText(S.key, 'cas://sha256/9f3a…c1e0', 700);
          }).then(function () {
            return Promise.all(S.shards.map(function (sg, i) {
              return ctx.transform(sg, { x: 60 + az[i] * 238 + 14 + slot[i] * 70 + 6, y: 636 }, 700, 'inOut', i * 70);
            }));
          }).then(function () {
            return Promise.all([ctx.fade(S.fail, 1, 400), ctx.fade(S.shards[2], 0.25, 400), ctx.fade(S.shards[3], 0.25, 400), ctx.fade(S.shards[7], 0.25, 400)]);
          }).then(function () {
            ctx.fade(S.failT, 1, 400);
            return ctx.transform(S.mark, { x: 1400 }, 1600, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Metadata & state',
        say: 'Small mutable facts live in a relational database: users, jobs, shots, and every take of every shot. Shot three moves through a state machine, and each transition is a compare and set on a version number, so two workers can never both claim the same render. The state change and its event row commit in one transaction, the outbox pattern, and the commit itself is only acknowledged once a majority of replicas in different zones have it.',
        deep: '<p>Small, mutable, <b>transactional</b> facts: who asked, what the plan is, which shot is in which state. Postgres (or Aurora/AlloyDB) in one region; Spanner or CockroachDB when jobs span regions.</p>' +
          '<p><b>Optimistic concurrency</b>: each shot row carries a <code>version</code>; workers claim work with a compare-and-set <code>UPDATE … WHERE state = \'queued\' AND version = 7</code>. Zero rows updated ⇒ someone else won ⇒ do not render twice (a render is ~10<sup>2</sup>–10<sup>3</sup> GPU-seconds, so duplicate work is the expensive failure).</p>' +
          '<p><b>Transactional outbox</b>: the state change and the event row commit atomically; a CDC relay tails the write-ahead log and publishes to the event log. This removes the dual-write bug (DB committed, publish lost, or vice versa).</p>' +
          '<p><b>Replication</b>: a write commits when a majority of replicas ack (Raft/Paxos, or Postgres synchronous standby). Spanner also waits out clock uncertainty so commit timestamps respect real time:</p>' +
          '<div class="eq">s = TT.now().latest;  commit-wait until TT.after(s)  ⇒  wait ≈ 2ε</div>' +
          '<p>ε was 1–7 ms in the 2012 paper (sawtooth between time-master polls); modern deployments report sub-millisecond ε, and the wait overlaps the Paxos round anyway.</p>' +
          '<span class="muted">Keep large blobs out of rows (store <code>cas://</code> URIs) and keep plans as <code>jsonb</code> so the planner can evolve its schema without migrations.</span>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [1]);
          ctx.hud('claim = compare-and-set on version · commit = 2 of 3 acks');
          /* schema */
          var a = ctx.group({ parent: g });
          head(ctx, a, 60, 318, 'SCHEMA (simplified)', 'blue');
          function card(x, y, name, cols) {
            ctx.rect(x, y, 310, 118, { rx: 8, fill: 'rgba(8,16,32,0.9)', stroke: ctx.alpha('blue', 0.6), sw: 1.2, parent: a });
            ctx.rect(x, y, 310, 26, { rx: 8, fill: ctx.alpha('blue', 0.16), parent: a });
            ctx.text(x + 12, y + 13.5, name, { size: 14, font: 'mono', weight: 700, color: 'blue', parent: a });
            cols.forEach(function (s, k) { ctx.text(x + 12, y + 44 + k * 19, s, { size: 12, font: 'mono', color: 'text', parent: a }); });
            return { box: { x: x, y: y, w: 310, h: 118, cx: x + 155, cy: y + 59, l: x, r: x + 310, t: y, b: y + 118 } };
          }
          var cu = card(60, 336, 'users', ['id uuid PK · region', 'plan · quota_gpu_s', 'consent_train bool', 'created_at']);
          var cj = card(410, 336, 'jobs', ['id PK · user_id FK', 'status enum', 'budget_gpu_s · spent', 'plan_dag jsonb']);
          var cs = card(410, 474, 'shots', ['id PK · job_id FK · idx', 'state enum', 'version int  (CAS)', 'spec jsonb (prompt, cam)']);
          var ct = card(60, 474, 'takes', ['id PK · shot_id FK', 'blob_uri cas://…', 'seed · model_ver · cfg', 'critic_score real']);
          [[cu, cj, 'r', 'l', 390, 380, 'middle'], [cj, cs, 'b', 't', 575, 464, 'start'], [cs, ct, 'l', 'r', 390, 518, 'middle']].forEach(function (e) {
            ctx.link(e[0], e[1], { from: e[2], to: e[3], color: ctx.alpha('blue', 0.8), straight: true, parent: a });
            ctx.text(e[4], e[5], '1:N', { size: 11, font: 'mono', color: 'blue', anchor: e[6], parent: a });
          });
          ctx.reveal(a, { from: 'up' });
          /* replication */
          var r = ctx.group({ parent: g });
          head(ctx, r, 60, 628, 'REPLICATED COMMIT', 'blue');
          var ld = ctx.node({ x: 150, y: 730, w: 160, h: 56, title: 'Leader', sub: 'AZ-a', icon: 'db', color: 'blue', titleSize: 14, parent: r });
          var f1 = ctx.node({ x: 400, y: 680, w: 160, h: 50, title: 'Follower', sub: 'AZ-b', color: 'blue', titleSize: 14, parent: r });
          var f2 = ctx.node({ x: 400, y: 790, w: 160, h: 50, title: 'Follower', sub: 'AZ-c', color: 'blue', titleSize: 14, parent: r });
          var r1 = ctx.link(ld, f1, { color: 'blue', parent: r }), r2 = ctx.link(ld, f2, { color: 'blue', parent: r });
          ctx.para(510, 690, ['commit = majority (2/3) ack', 'in-region RTT ≈ 0.5–2 ms', 'Spanner: + TrueTime wait', 'Postgres: sync standby'], { size: 12, font: 'mono', color: 'dim', lh: 22, parent: r });
          ctx.reveal(r, { from: 'up', delay: 200 });
          /* state machine */
          var m = ctx.group({ parent: g });
          head(ctx, m, 820, 318, 'SHOT STATE MACHINE · shot 3', 'blue');
          var ST = ['planned', 'queued', 'rendering', 'rendered', 'review', 'approved'];
          var pos = ST.map(function (s, i) { return { x: 870 + i * 125, y: 375 }; });
          pos.rej = { x: 1307, y: 452 };
          var pills = ST.map(function (s, i) {
            return ctx.node({ x: pos[i].x, y: pos[i].y, w: 112, h: 34, kind: 'pill', title: s, color: i === 5 ? 'lime' : 'blue', titleSize: 13, glow: false, parent: m });
          });
          var rej = ctx.node({ x: pos.rej.x, y: pos.rej.y, w: 112, h: 34, kind: 'pill', title: 'rejected', color: 'red', titleSize: 13, glow: false, parent: m });
          for (var i = 0; i < 5; i++) ctx.link(pills[i], pills[i + 1], { color: ctx.alpha('blue', 0.7), straight: true, sw: 1.3, parent: m });
          ctx.link(pills[4], rej, { from: 'b', to: 'r', color: ctx.alpha('red', 0.8), sw: 1.3, parent: m });
          ctx.link(rej, pills[1], { from: 'l', to: 'b', color: ctx.alpha('red', 0.8), sw: 1.3, parent: m });
          ctx.text(1250, 492, 'critic rejects → re-queue', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: m });
          S.tok = ctx.group({ parent: m });
          ctx.circle(0, 0, 8, { fill: 'magenta', parent: S.tok, glow: true });
          ctx.place(S.tok, pos[0].x, pos[0].y - 26);
          ctx.reveal(m, { from: 'up', delay: 300 });
          /* SQL */
          var q = ctx.group({ parent: g });
          code(ctx, { x: 800, y: 520, w: 740, title: 'worker claims shot 3 (optimistic concurrency + outbox)', lang: 'text', size: 13, parent: q, lines: [
            'BEGIN;',
            "UPDATE shots SET state='rendering', version=version+1",
            "  WHERE id=3 AND state='queued' AND version=7;  -- 1 row: ours",
            'INSERT INTO outbox(topic, key, payload)',
            "  VALUES ('job-events', 'job42', '{\"shot\":3,\"to\":\"rendering\"}');",
            'COMMIT;  -- state + event in ONE atomic write'
          ] });
          ctx.text(800, 740, '0 rows updated → another worker won → re-read, never render twice', { size: 12, font: 'mono', color: 'amber', parent: q });
          ctx.label(800, 780, 'outbox row → CDC relay → event log (next)', { color: 'magenta', size: 12, anchor: 'start', parent: q });
          ctx.reveal(q, { from: 'up', delay: 400 });
          /* animate token through states */
          var seq = [1, 2, 3, 4, 'rej', 1, 2, 3, 4, 5];
          var chain = ctx.wait(700);
          seq.forEach(function (k) {
            chain = chain.then(function () {
              var p = pos[k];
              return ctx.transform(S.tok, { x: p.x, y: p.y - 26 }, 380, 'inOut');
            });
          });
          var rep = ctx.wait(900).then(function () {
            return Promise.all([ctx.packet(r1, { color: 'blue', dur: 600, label: 'append' }), ctx.packet(r2, { color: 'blue', dur: 600 })]);
          }).then(function () {
            return Promise.all([ctx.packet(r1, { color: 'lime', dur: 500, reverse: true, label: 'ack' }), ctx.packet(r2, { color: 'lime', dur: 700, reverse: true })]);
          });
          return Promise.all([chain, rep]);
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'The event log',
        say: 'The event log is the memory of what happened. It is split into partitions, and every event for job forty two is keyed by its job id, so it always lands in the same partition and keeps a total order: plan, tool call, render, critic verdict, re-render. Three independent consumer groups read the same log at their own pace: the orchestrator for replay, a fan-out that streams progress to the creator, and a lakehouse sink that lags behind and feeds analytics.',
        deep: '<p>An append-only, partitioned, replicated log:</p>' +
          '<div class="eq">partition = murmur2(key) mod P, &nbsp; key = job_id</div>' +
          '<p>Order is guaranteed only <i>within</i> a partition, so keying by <code>job_id</code> gives each job a total order of events while thousands of jobs scale out across partitions (production topics run 64–512 partitions, each replicated 3× with <code>min.insync.replicas=2</code>).</p>' +
          '<ul><li><b>Consumer groups</b> keep their own committed offsets. Lag = log-end offset − committed offset; it is the key health metric (here the lakehouse sink lags by 6).</li>' +
          '<li><b>Delivery</b>: at-least-once by default ⇒ consumers must be idempotent (dedupe on <code>event_id</code>). Kafka EOS (idempotent producer + transactions, KIP-98) gives exactly-once for read-process-write inside Kafka.</li>' +
          '<li><b>Retention</b>: days on broker disks; tiered storage (KIP-405) moves old segments to object storage, so replaying months of agent traces is cheap.</li>' +
          '<li><b>Replay</b>: a new consumer group starting at offset 0 can rebuild any derived view: dashboards, search indexes, training datasets.</li></ul>' +
          '<div class="note">DB = current state; log = history. The outbox makes both come from the same transaction, so they never disagree.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [2]);
          ctx.hud('partition = murmur2(job_id) mod P · per-job total order');
          head(ctx, g, 330, 340, 'topic job-events · partition = murmur2(job_id) mod P   (P = 3 here, 64+ in production)', 'magenta');
          var prod = ctx.node({ x: 150, y: 540, w: 190, h: 70, title: 'Outbox relay', sub: 'CDC · Debezium', icon: 'queue', color: 'magenta', titleSize: 15, parent: g });
          ctx.reveal(prod, { from: 'left' });
          var PY = [440, 540, 640], X0 = 350, CW = 38;
          var fill = [6, 7, 5];
          var r = ctx.rng(41);
          var dimC = ['blue', 'violet', 'orange', 'cyan'];
          S.cells = [[], [], []];
          var parts = ctx.group({ parent: g });
          PY.forEach(function (y, p) {
            ctx.text(325, y, 'p' + p, { size: 14, font: 'mono', color: p === 1 ? 'magenta' : 'dim', anchor: 'middle', weight: 700, parent: parts });
            ctx.link(prod, { x: 306, y: y }, { from: 'r', color: ctx.alpha('magenta', 0.5), sw: 1.2, parent: parts });
            for (var k = 0; k < 20; k++) {
              var filled = k < fill[p];
              var col = dimC[Math.floor(r() * 4)];
              if (p === 1 && k >= 3 && filled) col = 'magenta';
              ctx.rect(X0 + k * CW, y - 20, CW - 4, 40, { rx: 4, fill: filled ? ctx.alpha(col, 0.3) : 'rgba(255,255,255,0.02)', stroke: filled ? ctx.alpha(col, 0.7) : ctx.alpha('white', 0.08), sw: 1, parent: parts });
            }
          });
          ctx.text(X0 + 20 * CW - 4, 688, 'offset →', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: parts });
          ctx.reveal(parts, { from: 'fade', delay: 200 });
          /* consumers */
          var cons = [['Orchestrator', 'group A · replay', 'magenta'], ['SSE fan-out', 'group B · progress', 'cyan'], ['Lakehouse sink', 'group C · Iceberg', 'teal']];
          var cg = ctx.group({ parent: g });
          ctx.line(1135, 425, 1135, 655, { color: ctx.alpha('white', 0.3), sw: 2, parent: cg });
          PY.forEach(function (y) { ctx.line(1112, y, 1135, y, { color: ctx.alpha('white', 0.3), sw: 2, parent: cg }); });
          S.cons = cons.map(function (c, i) {
            var n = ctx.node({ x: 1330, y: PY[i], w: 250, h: 62, title: c[0], sub: c[1], color: c[2], titleSize: 15, parent: cg });
            ctx.line(1135, PY[i], 1203, PY[i], { color: c[2], arrow: true, parent: cg });
            return n;
          });
          ctx.reveal(cg, { from: 'right', delay: 300 });
          /* offset markers on p1 */
          S.marks = cons.map(function (c, i) {
            var mg = ctx.group({ parent: g });
            ctx.poly([[0, 0], [-7, 11], [7, 11]], { fill: c[2], parent: mg });
            ctx.text(0, 21, 'ABC'.charAt(i), { size: 12, font: 'mono', color: c[2], anchor: 'middle', weight: 700, parent: mg });
            ctx.place(mg, X0 - 2 + [5, 5, 3][i] * CW, 564);
            return mg;
          });
          S.lagT = ctx.text(1500, 700, '', { size: 12, font: 'mono', color: 'teal', anchor: 'end', parent: g });
          /* event JSON + guarantees */
          var bt = ctx.group({ parent: g });
          code(ctx, { x: 60, y: 715, w: 700, title: 'one event (value), key = "job42"', lang: 'json', size: 13, parent: bt, lines: [
            '{"event_id":"01J9ZK…","type":"tool_call.completed",',
            ' "job":"job42","shot":3,"tool":"render_shot","take":"3b",',
            ' "blob":"cas://sha256/9f3a…","gpu_s":742,',
            ' "ts":"2026-09-28T10:14:03Z"}'
          ] });
          ctx.para(820, 738, ['order: total per partition → key by job_id', 'delivery: at-least-once → dedupe on event_id', 'EOS: idempotent producer + transactions', 'retention: days on brokers, tiered to object store', 'replay: new group from offset 0 rebuilds any view'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: bt });
          ctx.reveal(bt, { from: 'up', delay: 500 });
          /* appends */
          var EV = [[42, 'plan'], [17], [42, 'tool'], [42, 'rend'], [88], [42, 'done'], [17], [42, 'crit'], [88], [42, 'redo'], [42, 'ok'], [17]];
          var head2 = fill.slice();
          var chain = ctx.wait(800);
          EV.forEach(function (e, i) {
            var p = e[0] === 42 ? 1 : (e[0] === 17 ? 0 : 2);
            var col = e[0] === 42 ? 'magenta' : (e[0] === 17 ? 'blue' : 'violet');
            var k = head2[p]++;
            var cell = ctx.group({ parent: parts });
            ctx.rect(X0 + k * CW, PY[p] - 20, CW - 4, 40, { rx: 4, fill: ctx.alpha(col, e[0] === 42 ? 0.55 : 0.4), stroke: col, sw: 1.3, parent: cell });
            if (e[1]) ctx.text(X0 + k * CW + (CW - 4) / 2, PY[p], e[1], { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: cell });
            cell.setAttribute('opacity', 0);
            chain = chain.then(function () {
              return ctx.reveal(cell, { from: 'left', dur: 260, dist: 16 });
            });
          });
          return chain.then(function () {
            var fin = [14, 13, 8];
            return Promise.all(S.marks.map(function (mg, i) {
              return ctx.transform(mg, { x: X0 - 2 + fin[i] * CW }, 900, 'inOut', i * 150);
            }));
          }).then(function () {
            S.lagT.textContent = 'lag(C) = 14 − 8 = 6 events';
            return ctx.reveal(S.lagT, { dur: 300 });
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Caches & limits',
        say: 'The cache tier holds state that is fast but disposable. A token bucket per user decides whether a render request is admitted: a burst drains the bucket, and it refills at a steady rate, so the seventh and eighth requests get a four twenty nine. Hot rows are read cache-aside: a miss goes to the database and back-fills Redis with a short time to live. At a ninety five percent hit ratio the average read drops below half a millisecond. Losing Redis costs latency, never correctness.',
        deep: '<p>Redis/Valkey holds <b>ephemeral, reconstructible</b> state: sessions, rate-limit buckets, idempotency keys, leases, and cache-aside copies of hot rows.</p>' +
          '<div class="eq">tokens ← min(B, tokens + r·(now − ts)); &nbsp;admit ⇔ tokens ≥ 1</div>' +
          '<p>Run as one Lua script (atomic on one shard) or as GCRA; with B = 6 and r = 0.5/s, a burst of 8 requests in 1.4 s admits 6 and rejects 2 with <code>429 Retry-After</code>. Limits are on <i>GPU-seconds</i>, not just requests, because a 1080p shot costs ~100× a draft.</p>' +
          '<div class="eq">E[L] = h·t<sub>hit</sub> + (1−h)(t<sub>hit</sub> + t<sub>db</sub>)</div>' +
          '<p>= t<sub>hit</sub> + (1−h)·t<sub>db</sub>: with t<sub>hit</sub> = 0.3 ms, t<sub>db</sub> = 3 ms, h = 0.95 ⇒ 0.45 ms, and the database sees 20× fewer reads. Invalidate on write (delete key after commit) and keep TTLs short to bound staleness.</p>' +
          '<p><b>Leases</b>: <code>SET lock:shot:3 &lt;id&gt; NX PX 30000</code> is not enough alone: a paused holder (GC, preemption) can outlive its lease. Pair it with a monotonically increasing <b>fencing token</b> that the storage write checks.</p>' +
          '<span class="muted">LLM prefix/KV caches and encoded-latent caches live on the GPU tier (HBM, host RAM, NVMe), not in Redis.</span>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [3]);
          ctx.hud('h = 0.95 ⇒ E[read] = 0.45 ms · DB load ÷ 20');
          /* token bucket */
          var tb = ctx.group({ parent: g });
          head(ctx, tb, 60, 340, 'RATE LIMIT · token bucket / user', 'teal');
          ctx.rect(100, 380, 150, 230, { rx: 10, fill: 'rgba(255,255,255,0.02)', stroke: 'teal', sw: 1.6, parent: tb });
          var B = 6, R = 0.5;
          S.lvl = ctx.rect(104, 384, 142, 222, { rx: 7, fill: ctx.alpha('teal', 0.35), parent: tb });
          S.lvlT = ctx.text(175, 495, '6.0', { size: 22, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: tb });
          ctx.text(175, 522, 'tokens', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: tb });
          ctx.text(60, 638, 'B = 6 · r = 0.5 req/s', { size: 13, font: 'mono', color: 'text', parent: tb });
          ctx.text(60, 660, 'atomic Lua script (EVALSHA)', { size: 12, font: 'mono', color: 'dim', parent: tb });
          function setLvl(v) {
            var h = 222 * v / B;
            S.lvl.setAttribute('y', 384 + 222 - h); S.lvl.setAttribute('height', Math.max(0, h));
            S.lvlT.textContent = v.toFixed(1);
          }
          var T = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 3.5, 6.0];
          var tok = B, last = 0, res = [];
          T.forEach(function (t) {
            var before = Math.min(B, tok + (t - last) * R); last = t;
            var ok = before >= 1;
            tok = ok ? before - 1 : before;
            res.push({ t: t, pre: before, post: tok, ok: ok });
          });
          ctx.reveal(tb, { from: 'up' });
          /* cache-aside */
          var ca = ctx.group({ parent: g });
          head(ctx, ca, 520, 340, 'CACHE-ASIDE READ', 'teal');
          var api = ctx.node({ x: 600, y: 480, w: 150, h: 58, title: 'API', sub: 'job service', icon: 'server', color: 'blue', titleSize: 14, parent: ca });
          var rd = ctx.node({ x: 900, y: 410, w: 190, h: 58, title: 'Redis', sub: 'p50 ≈ 0.3 ms', icon: 'bolt', color: 'teal', titleSize: 14, parent: ca });
          var pg = ctx.node({ x: 900, y: 560, w: 190, h: 58, title: 'Postgres', sub: 'p50 ≈ 3 ms', icon: 'db', color: 'blue', titleSize: 14, parent: ca });
          var lr = ctx.link(api, rd, { from: 'r', to: 'l', color: 'teal', parent: ca });
          var lp = ctx.link(api, pg, { from: 'r', to: 'l', color: 'blue', parent: ca });
          S.hitT = ctx.text(520, 640, 'hits 0 · misses 0', { size: 13, font: 'mono', color: 'text', parent: ca });
          ctx.reveal(ca, { from: 'up', delay: 150 });
          /* plot */
          var pl = ctx.group({ parent: g });
          head(ctx, pl, 1110, 340, 'EFFECTIVE READ LATENCY', 'teal');
          var P = ctx.plot(1140, 380, 380, 220, function (h) { return 0.3 + (1 - h) * 3; }, { xDomain: [0.5, 1], yDomain: [0, 2], color: 'teal', yLabel: 'ms', parent: pl });
          ctx.text(1330, 616, 'hit ratio h', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pl });
          ctx.text(1140, 616, '0.5', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pl });
          ctx.text(1520, 616, '1.0', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pl });
          ctx.text(1132, 382, '2', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: pl });
          ctx.text(1132, 600, '0', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: pl });
          var pm = P.toPx(0.95, 0.45);
          S.pmark = ctx.group({ parent: pl });
          ctx.circle(pm.x, pm.y, 6, { fill: 'lime', parent: S.pmark, glow: true });
          ctx.line(pm.x, pm.y, pm.x, 600, { color: ctx.alpha('lime', 0.5), dash: '3 4', parent: S.pmark });
          ctx.text(pm.x - 14, pm.y + 26, '0.45 ms @ h = 0.95', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: S.pmark });
          ctx.text(1110, 648, 'E[L] = h·t_hit + (1−h)·(t_hit + t_db)', { size: 13, font: 'mono', color: 'text', parent: pl });
          ctx.reveal(pl, { from: 'up', delay: 300 });
          ctx.reveal(P.curve, { from: 'draw', delay: 500, dur: 900 });
          S.pmark.setAttribute('opacity', 0);
          /* keyspace */
          var ks = ctx.group({ parent: g });
          code(ctx, { x: 60, y: 690, w: 1480, title: 'redis keyspace (per region, per tenant prefix)', lang: 'text', size: 13, parent: ks, lines: [
            'session:{sid}          HASH    TTL 24h     auth claims, active job, UI cursor',
            'rl:{user}:render       HASH    TTL 60s     token bucket {tokens, ts} · also rl:{user}:gpu_s',
            'idem:{request_key}     STRING  TTL 24h     dedupe retried POST /jobs → same job_id',
            'lock:shot:3            STRING  PX 30000    lease holder + fencing token 1187',
            'cache:shot:3           STRING  TTL 60s     cache-aside copy of the SQL row (deleted on write)'
          ] });
          ctx.reveal(ks, { from: 'up', delay: 450 });
          /* animations */
          var rq = ctx.group({ parent: tb });
          var bucket = ctx.wait(600);
          res.forEach(function (e, i) {
            var y = 390 + i * 23;
            var t1 = ctx.text(290, y, 'r' + (i + 1) + '  t=' + e.t.toFixed(1) + 's', { size: 12, font: 'mono', color: 'text', parent: rq });
            var t2 = ctx.text(440, y, e.ok ? '✓' : '429', { size: 12, font: 'mono', weight: 700, color: e.ok ? 'lime' : 'red', anchor: 'end', parent: rq });
            t1.setAttribute('opacity', 0); t2.setAttribute('opacity', 0);
            bucket = bucket.then(function () {
              var prev = i === 0 ? B : res[i - 1].post;
              return ctx.tween(i >= 8 ? 420 : 160, function (k) { setLvl(prev + (e.pre - prev) * k); }).then(function () {
                ctx.reveal([t1, t2], { dur: 200, stagger: 0 });
                return ctx.tween(140, function (k) { setLvl(e.pre + (e.post - e.pre) * k); });
              });
            });
          });
          var hits = 0, miss = 0;
          function upd() { S.hitT.textContent = 'hits ' + hits + ' · misses ' + miss + (hits + miss ? '  (h = ' + (hits / (hits + miss)).toFixed(2) + ')' : ''); }
          var cache = ctx.wait(900).then(function () {
            return ctx.packet(lr, { color: 'teal', dur: 450, label: 'GET cache:shot:3' });
          }).then(function () { return ctx.packet(lr, { color: 'red', dur: 350, reverse: true, label: 'nil' }); })
            .then(function () { miss++; upd(); return ctx.packet(lp, { color: 'blue', dur: 450, label: 'SELECT' }); })
            .then(function () { return ctx.packet(lp, { color: 'blue', dur: 450, reverse: true, label: 'row' }); })
            .then(function () { return ctx.packet(lr, { color: 'teal', dur: 450, label: 'SET EX 60' }); });
          [0, 1, 2].forEach(function () {
            cache = cache.then(function () { return ctx.packet(lr, { color: 'teal', dur: 300 }); })
              .then(function () { return ctx.packet(lr, { color: 'lime', dur: 300, reverse: true, label: 'hit' }); })
              .then(function () { hits++; upd(); });
          });
          if (ctx.instant) { hits = 3; miss = 1; upd(); setLvl(res[res.length - 1].post); }
          return Promise.all([bucket, cache.then(function () { hits = 3; miss = 1; upd(); return ctx.reveal(S.pmark, { dur: 400 }); })]);
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Vector memory',
        say: 'Pixels cannot be searched with SQL, so every sketch, every keyframe of every take, and every script beat is embedded into one shared image and text space. When the camera agent prepares shot four, fox removes a cracked helmet, the text is embedded with the same model and the vector database returns the nearest neighbours: the fox character sheet and the closest earlier takes. Those references are what keep the fox looking like the same fox. Click the memory map to zoom in.',
        deep: '<p>Every sketch, reference, keyframe (e.g. 8 per take) and script beat is embedded into a shared image–text space: SigLIP 2 so400m/14 gives 1152-d vectors, CLIP ViT-L/14 768-d. Vectors are L2-normalised, so cosine similarity is a dot product:</p>' +
          '<div class="eq">sim(q, x) = q·x / (‖q‖‖x‖) = q·x &nbsp; (‖q‖ = ‖x‖ = 1)</div>' +
          '<p>Per-project memory is small (10<sup>2</sup>–10<sup>4</sup> vectors ⇒ exact search is fine), but a platform-wide asset and style library reaches 10<sup>9</sup> vectors: at 1152-d fp16 that is ~2.3 TB raw, so ANN indexes (HNSW, IVF-PQ, DiskANN) and quantisation become mandatory.</p>' +
          '<ul><li>Pre-filter by <code>tenant_id</code>/<code>project_id</code>: isolation first, and it shrinks the search.</li>' +
          '<li>Payload stores the <code>cas://</code> URI and shot/take ids; the vector DB never holds pixels.</li>' +
          '<li>Index freshness is eventual: a new keyframe becomes searchable once its upsert is indexed (ms to s).</li>' +
          '<li>Text-to-image cosines are small (≈0.1–0.35, the "modality gap"); only their ranking is meaningful, so thresholds are calibrated per embedder.</li></ul>' +
          '<div class="note">Zoom into <b>Vector Memory &amp; Retrieval</b> for HNSW, product quantisation, hybrid search, reranking and the agent memory taxonomy.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [4]);
          ctx.hud('10⁹ × 1152-d fp16 ≈ 2.3 TB raw → ANN + quantisation');
          var a = ctx.group({ parent: g });
          head(ctx, a, 60, 340, 'EMBED EVERYTHING INTO ONE SPACE');
          var ins = [['sketch_1', 'image', 'violet'], ['sketch_2', 'image', 'violet'], ['sketch_3', 'image', 'violet'], ['take3b kf×8', 'film', 'lime']];
          var enc = ctx.node({ x: 420, y: 470, w: 210, h: 64, title: 'Image tower', sub: 'SigLIP 2 · so400m', icon: 'eye', color: 'violet', titleSize: 14, parent: a });
          var tenc = ctx.node({ x: 420, y: 680, w: 210, h: 64, title: 'Text tower', sub: 'same space', icon: 'doc', color: 'violet', titleSize: 14, parent: a });
          var inL = ins.map(function (d, i) {
            var y = 380 + i * 60;
            ctx.rect(60, y - 22, 170, 44, { rx: 6, fill: '#0d1a33', stroke: d[2], sw: 1.2, parent: a });
            ctx.icon(d[1], 84, y, 20, d[2], { parent: a });
            ctx.text(102, y, d[0], { size: 13, font: 'mono', color: 'text', parent: a });
            return ctx.link({ x: 230, y: y }, enc, { to: 'l', color: ctx.alpha('violet', 0.7), sw: 1.3, parent: a });
          });
          ctx.label(60, 680, '"fox removes cracked helmet"', { color: 'magenta', size: 12, anchor: 'start', w: 250, parent: a });
          var tq = ctx.link({ x: 310, y: 680 }, tenc, { to: 'l', color: ctx.alpha('magenta', 0.8), straight: true, parent: a });
          var r = ctx.rng(5);
          ctx.vector(545, 464, 12, { horizontal: true, cell: 10, gap: 2, cmap: 'diverge', parent: a, values: [Array.apply(null, Array(12)).map(function () { return r() * 2 - 1; })] });
          ctx.vector(545, 674, 12, { horizontal: true, cell: 10, gap: 2, cmap: 'diverge', parent: a, values: [Array.apply(null, Array(12)).map(function () { return r() * 2 - 1; })] });
          ctx.text(545, 500, '1152-d · ‖v‖=1', { size: 12, font: 'mono', color: 'dim', parent: a });
          ctx.text(545, 520, 'upsert(id, v, meta)', { size: 12, font: 'mono', color: 'teal', parent: a });
          ctx.text(545, 710, 'query vector q', { size: 12, font: 'mono', color: 'magenta', parent: a });
          var w1 = ctx.link({ x: 690, y: 469 }, { x: 772, y: 520 }, { color: 'teal', parent: a });
          var w2 = ctx.link({ x: 690, y: 679 }, { x: 772, y: 640 }, { color: 'magenta', parent: a });
          ctx.reveal(a, { from: 'up' });
          /* scatter map */
          var m = ctx.group({ parent: g });
          m.box = { x: 772, y: 330, w: 768, h: 530, cx: 1156, cy: 595, l: 772, r: 1540, t: 330, b: 860 };
          panel(ctx, m, 772, 330, 768, 530);
          ctx.text(792, 354, 'PROJECT MEMORY · 2-D projection of embeddings (illustrative)', { size: 13, font: 'display', weight: 700, color: 'teal', spacing: 1, parent: m });
          ctx.label(1526, 354, 'click to zoom in ⤢', { color: 'teal', size: 11, anchor: 'end', parent: m });
          var CL = [['fox character', 'amber', 1000, 490, 13, 'fox_sheet_'], ['ice moon', 'cyan', 1330, 460, 11, 'moon_env_'], ['style sketches', 'violet', 1240, 720, 9, 'sketch_'], ['takes shot 1–3', 'lime', 960, 720, 12, 'take_kf_']];
          var pts = [];
          CL.forEach(function (c, ci) {
            for (var k = 0; k < c[4]; k++) {
              var ang = r() * Math.PI * 2, rad = 12 + r() * 48;
              var p = { x: c[2] + Math.cos(ang) * rad, y: c[3] + Math.sin(ang) * rad * 0.8, c: ci, name: c[5] + (k + 1) };
              p.el = ctx.circle(p.x, p.y, 5, { fill: ctx.alpha(c[1], 0.8), stroke: c[1], sw: 1, parent: m });
              pts.push(p);
            }
            ctx.label(800 + ci * 180, 836, c[0], { color: c[1], size: 12, anchor: 'start', parent: m });
          });
          var q = { x: 1045, y: 600 };
          pts.forEach(function (p) { p.d = Math.hypot(p.x - q.x, p.y - q.y); });
          var nn = pts.slice().sort(function (u, v) { return u.d - v.d; }).slice(0, 5);
          S.nnL = nn.map(function (p) { return ctx.line(q.x, q.y, p.x, p.y, { color: 'magenta', sw: 1.4, dash: '4 3', parent: m }); });
          S.q = ctx.poly([[0, -12], [3.5, -4], [12, -4], [5, 2], [8, 11], [0, 5], [-8, 11], [-5, 2], [-12, -4], [-3.5, -4]].map(function (p) { return [q.x + p[0], q.y + p[1]]; }), { fill: 'magenta', parent: m, glow: true });
          ctx.text(q.x + 16, q.y + 2, 'q: shot 4', { size: 12, font: 'mono', color: 'magenta', parent: m });
          var res = ctx.group({ parent: m });
          ctx.text(1340, 560, 'top-5 · raw cosine', { size: 12, font: 'mono', color: 'dim', parent: res });
          nn.forEach(function (p, i) {
            ctx.text(1340, 585 + i * 22, p.name, { size: 12, font: 'mono', color: CL[p.c][1], parent: res });
            ctx.text(1525, 585 + i * 22, (0.34 - p.d / 1500).toFixed(3), { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: res });
          });
          ctx.reveal(m, { from: 'scale', s0: 0.95, delay: 300 });
          S.nnL.forEach(function (l) { l.setAttribute('opacity', 0); });
          res.setAttribute('opacity', 0);
          ctx.hotspot(m, 'rag-memory', { hint: 'VECTOR MEMORY ⤢' });
          return ctx.wait(700).then(function () {
            return Promise.all(inL.map(function (l, i) { return ctx.wait(i * 120).then(function () { return ctx.packet(l, { color: 'violet', dur: 500 }); }); }));
          }).then(function () {
            return ctx.packet(w1, { color: 'teal', dur: 500, label: 'upsert' });
          }).then(function () {
            return ctx.packet(tq, { color: 'magenta', dur: 400 });
          }).then(function () {
            return ctx.packet(w2, { color: 'magenta', dur: 500, label: 'search' });
          }).then(function () {
            ctx.pulse(S.q, { color: 'magenta' });
            return ctx.reveal(S.nnL, { stagger: 120, dur: 300 });
          }).then(function () { return ctx.reveal(res, { dur: 400 }); });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Lineage of shot 3',
        say: 'Why does shot three look the way it does? The lineage graph answers that. It records which prompt, character sheet, sketch, model weights and parameters a render used, which agent ran it, and what it produced. Take three A was rejected by the critic for helmet flicker, which informed a second render with a new seed and stronger reference guidance, producing take three B. Walk the edges backwards to debug; hash the manifest to reproduce or reuse a clip for free.',
        deep: '<p>Lineage is a DAG in the W3C PROV model: <b>entities</b> (prompt, sketches, weights, takes), <b>activities</b> (render runs) and <b>agents</b> (cinematographer agent, creator). Edges: <code>used</code> (activity→entity), <code>wasGeneratedBy</code> (entity→activity), <code>wasAssociatedWith</code> (activity→agent), <code>wasDerivedFrom</code> (entity→entity), <code>wasInformedBy</code> (activity→activity). PROV points edges from effect to cause; the canvas draws them in dataflow direction. The retry params of render #8840 <code>wasDerivedFrom</code> take 3a\'s critique, which implies #8840 <code>wasInformedBy</code> #8812. OpenLineage emits the same shape for data pipelines.</p>' +
          '<p>Each render writes a <b>canonical manifest</b>; its hash is a memo key:</p>' +
          '<div class="eq">key = SHA-256(canon(inputs, model_digest, sampler, steps, cfg, seed, resolution, code_rev))</div>' +
          '<p>Same key ⇒ reuse the stored clip, zero GPU-seconds. Caveat: bit-exact replay needs deterministic kernels; atomics in reductions, batch-size-dependent GEMM tiling and different GPU SKUs change floating-point summation order. So also store the <i>output</i> digest and treat replay as "perceptually equal" unless determinism flags are pinned.</p>' +
          '<ul><li><b>Debug</b>: “why does 3a flicker?” = traverse backward from the take.</li>' +
          '<li><b>Erasure</b>: a deletion request traverses forward from the user\'s upload to every derived artifact, including embeddings and cached latents.</li>' +
          '<li><b>Credentials</b>: the same graph populates the C2PA manifest (ingredients, actions) on the final cut.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [5]);
          ctx.hud('memo key = SHA-256(manifest) · hit ⇒ 0 GPU-s');
          head(ctx, g, 60, 330, 'PROVENANCE GRAPH · shot 3  (W3C PROV: entity · activity · agent)');
          var G = ctx.group({ parent: g });
          function ent(x, y, t, col, w) { return ctx.node({ x: x, y: y, w: w || 190, h: 40, kind: 'pill', title: t, color: col || 'teal', titleSize: 13, glow: false, parent: G }); }
          var ins = [ent(160, 380, 'prompt v3 · 41c…'), ent(160, 440, 'fox_sheet.png · a09…'), ent(160, 500, 'sketch_2.png · d2e…'), ent(160, 560, 'board_f3.png · 7b3…'), ent(160, 620, 'wan2.2-a14b · 7c1e…', 'lime')];
          var pa = ctx.node({ x: 800, y: 350, w: 230, h: 34, kind: 'chip', title: 'seed 1234 · cfg 5 · 40 steps', color: 'dim', titleSize: 12, parent: G });
          var pb = ctx.node({ x: 800, y: 664, w: 230, h: 34, kind: 'chip', title: 'seed 77 · ref-strength 0.8', color: 'amber', titleSize: 12, parent: G });
          var ra = ctx.node({ x: 800, y: 405, w: 170, h: 50, title: 'render #8812', color: 'lime', titleSize: 14, parent: G });
          var rb = ctx.node({ x: 800, y: 600, w: 170, h: 50, title: 'render #8840', color: 'lime', titleSize: 14, parent: G });
          var ag = ctx.node({ x: 800, y: 502, w: 200, h: 42, kind: 'hex', title: 'cinematographer agent', color: 'magenta', titleSize: 12, glow: false, parent: G });
          var ta = ent(1100, 405, 'take 3a', 'red', 150);
          var tb = ent(1100, 600, 'take 3b', 'lime', 150);
          var fc = ctx.node({ x: 1410, y: 502, w: 190, h: 56, title: 'final cut v1', sub: 'C2PA manifest', icon: 'film', color: 'orange', titleSize: 14, parent: G });
          var cr = ctx.label(1100, 372,'critic 0.41 · helmet flicker', { color: 'red', size: 11, parent: G });
          var ok = ctx.label(1100, 647, 'critic 0.87 · approved', { color: 'lime', size: 11, parent: G });
          var E = [];
          function e(a, b, o) { var l = ctx.link(a, b, Object.assign({ color: ctx.alpha('teal', 0.6), sw: 1.3, parent: G }, o || {})); E.push(l); return l; }
          ctx.line(262, 380, 262, 620, { color: ctx.alpha('teal', 0.6), sw: 2, parent: G });
          ins.forEach(function (n) { ctx.line(n.box.r, n.box.cy, 262, n.box.cy, { color: ctx.alpha('teal', 0.6), sw: 1.3, parent: G }); });
          var u1 = e({ x: 262, y: 405 }, ra, { to: 'l', straight: true, label: 'used' });
          var u2 = e({ x: 262, y: 600 }, rb, { to: 'l', straight: true, label: 'used' });
          var p1 = e(pa, ra, { from: 'b', to: 't', straight: true }), p2 = e(pb, rb, { from: 't', to: 'b', straight: true });
          var g1 = e(ra, ta, { straight: true, label: 'wasGeneratedBy', labelDy: -14 }), g2 = e(rb, tb, { straight: true, label: 'wasGeneratedBy', labelDy: -14 });
          e(ag, ra, { from: 't', to: 'b', dash: '3 4', color: ctx.alpha('magenta', 0.7), arrow: false });
          e(ag, rb, { from: 'b', to: 't', dash: '3 4', color: ctx.alpha('magenta', 0.7), arrow: false });
          var inf = e(ta, pb, { from: 'b', to: 'r', bend: { x: 1010, y: 640 }, color: ctx.alpha('red', 0.7), dash: '5 4', label: 'wasDerivedFrom', labelDx: -58, labelDy: -40 });
          var d1 = e(tb, fc, { from: 'r', to: 'l', label: 'wasDerivedFrom', labelDx: 10, labelDy: 18 });
          E.forEach(function (l) { if (l.labelEl) l.labelEl.querySelector('text').setAttribute('fill', ctx.color('white')); });
          ctx.reveal(G, { from: 'fade', delay: 100, dur: 500 });
          E.forEach(function (l, i) { ctx.reveal(l, { from: 'draw', delay: 300 + i * 70, dur: 500 }); });
          /* manifest + uses */
          var bt = ctx.group({ parent: g });
          code(ctx, { x: 60, y: 712, w: 840, title: 'manifest(take 3b) — canonical JSON', lang: 'json', size: 13, parent: bt, lines: [
            '{"inputs":["cas://…41c","cas://…a09","cas://…d2e","cas://…7b3"],',
            ' "model":"wan2.2-a14b@sha256:7c1e…","sampler":"unipc","steps":40,',
            ' "cfg":5.0,"seed":77,"ref_strength":0.8,"res":[1280,720,81]}',
            ' manifest_hash = "e5b0…"   output_digest = "9f3a…"'
          ] });
          ctx.para(940, 736, ['debug: walk edges backward from take 3a', 'reuse: manifest_hash hit → blob, 0 GPU-s', 'replay: same manifest ≈ same take*', 'erase: walk forward from a user upload', '* bit-exact only with deterministic kernels'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: bt });
          ctx.reveal(bt, { from: 'up', delay: 700 });
          /* backward trace from final cut */
          return ctx.wait(1500).then(function () {
            return ctx.camera(800, 500, 1.12, 800);
          }).then(function () {
            return ctx.packet(d1, { color: 'amber', dur: 500, reverse: true, label: 'why?' });
          }).then(function () {
            return Promise.all([ctx.packet(g2, { color: 'amber', dur: 400, reverse: true }), ctx.pulse(tb, { color: 'amber' })]);
          }).then(function () {
            return Promise.all([ctx.packet(p2, { color: 'amber', dur: 400, reverse: true }), ctx.packet(u2, { color: 'amber', dur: 500, reverse: true }), ctx.packet(inf, { color: 'red', dur: 700, reverse: true })]);
          }).then(function () {
            return Promise.all(ins.map(function (n) { return ctx.pulse(n, { color: 'amber', dur: 600 }); }).concat([ctx.pulse(ta, { color: 'red', dur: 600 })]));
          }).then(function () {
            return ctx.camera(null, null, null, 700);
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'The data flywheel',
        say: 'Finally, the data plane closes a loop. Every time the creator picks take three B over take three A, trims a shot, or hits regenerate, that is a label. The events flow through the log, become preference pairs, and pass consent, privacy and safety filters. Post-training, for example diffusion DPO, nudges the video model toward the winners. A new version must clear an evaluation gate and a canary rollout before it serves everyone, and the loop turns again.',
        deep: '<p>Every interaction is a label. Choosing take 3b over 3a is a <b>pairwise preference</b> (the most informative signal); regenerate clicks are noisy negatives; trims and re-orders supervise the editor agent; explicit ratings are rare.</p>' +
          '<p><b>Diffusion-DPO</b> fine-tunes the generator directly on pairs (x<sup>w</sup>, x<sup>l</sup>) against a frozen reference model:</p>' +
          '<div class="eq">L = −E log σ(−βT·ω(λ<sub>t</sub>)·[(‖ε<sup>w</sup>−ε<sub>θ</sub>(x<sup>w</sup><sub>t</sub>,t)‖² − ‖ε<sup>w</sup>−ε<sub>ref</sub>(x<sup>w</sup><sub>t</sub>,t)‖²) − (‖ε<sup>l</sup>−ε<sub>θ</sub>(x<sup>l</sup><sub>t</sub>,t)‖² − ‖ε<sup>l</sup>−ε<sub>ref</sub>(x<sup>l</sup><sub>t</sub>,t)‖²)])</div>' +
          '<p>i.e. lower the denoising error on the winner, relative to the frozen reference, more than on the loser (t ~ U[0,T], independent noise ε<sup>w</sup>, ε<sup>l</sup>).</p>' +
          '<p>Flow-matching models use the same form with velocity errors (Flow-DPO). Alternatives: train a video reward model (VideoReward-style, multi-dimensional: visual quality, motion, text alignment) and use it for reward-weighted fine-tuning, best-of-N at inference, or inside the critic agent. Agent trajectories with outcomes feed RL for the planner LLM.</p>' +
          '<div class="note">Loop hygiene: per-user consent flag, PII/face filtering, dedupe, held-out human-preference evals and VBench-style metrics as release gates, then canary 5% → 100%. A flywheel can also amplify reward hacking and popularity bias.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [2, 0]);
          ctx.hud('signals → pairs → curate → train → gate');
          var CX = 800, CY = 600, R = 225;
          var ring = ctx.group({ parent: g });
          var circ = ctx.path('M' + CX + ',' + (CY - R) + ' A' + R + ',' + R + ' 0 0 1 ' + CX + ',' + (CY + R) + ' A' + R + ',' + R + ' 0 0 1 ' + CX + ',' + (CY - R), { stroke: ctx.alpha('teal', 0.45), sw: 2, dash: '6 6', parent: ring });
          [-60, 0, 60, 120, 180, 240].forEach(function (a) {
            var t = a * Math.PI / 180, x = CX + R * Math.cos(t), y = CY + R * Math.sin(t);
            var dx = -Math.sin(t), dy = Math.cos(t);
            ctx.poly([[x + dx * 9, y + dy * 9], [x - dx * 6 + dy * 7, y - dy * 6 - dx * 7], [x - dx * 6 - dy * 7, y - dy * 6 + dx * 7]], { fill: 'teal', parent: ring });
          });
          ctx.text(CX, CY - 12, 'DATA', { size: 22, font: 'display', weight: 700, color: 'teal', anchor: 'middle', spacing: 3, parent: ring });
          ctx.text(CX, CY + 16, 'FLYWHEEL', { size: 22, font: 'display', weight: 700, color: 'teal', anchor: 'middle', spacing: 3, parent: ring });
          ctx.reveal(ring, { from: 'scale', s0: 0.8 });
          ctx.reveal(circ, { from: 'draw', dur: 1200 });
          var ST = [['Creators', 'edit · rate · redo', 'cyan', 'user'], ['Event log', 'implicit + explicit', 'magenta', 'queue'], ['Pref. pairs', 'take 3b ≻ take 3a', 'amber', 'chart'],
            ['Curation', 'consent · PII · safety', 'pink', 'shield'], ['Post-train', 'Diffusion-DPO · RM', 'lime', 'bolt'], ['Eval + registry', 'canary 5% → 100%', 'red', 'check']];
          var nodes = ctx.group({ parent: g });
          S.fw = ST.map(function (s, i) {
            var t = (-90 + i * 60) * Math.PI / 180;
            return ctx.node({ x: CX + R * Math.cos(t), y: CY + R * Math.sin(t), w: 196, h: 54, title: s[0], sub: s[1], color: s[2], titleSize: 14, subSize: 12, parent: nodes });
          });
          ctx.reveal(S.fw, { from: 'scale', stagger: 180, delay: 300 });
          /* signals */
          var L = ctx.group({ parent: g });
          head(ctx, L, 60, 345, 'SIGNALS FROM THIS SESSION');
          [['pick take 3b over 3a', 'pairwise · strongest', '×6', 'amber'], ['regenerate a shot', 'negative · noisy', '×3', 'red'], ['trim / re-order', 'edit supervision', '×9', 'orange'],
            ['thumbs rating', 'pointwise · sparse', '×1', 'cyan'], ['export + share', 'weak positive', '×1', 'lime']].forEach(function (r, i) {
            var y = 385 + i * 60;
            ctx.rect(60, y - 22, 330, 50, { rx: 8, fill: ctx.alpha(r[3], 0.07), stroke: ctx.alpha(r[3], 0.45), sw: 1, parent: L });
            ctx.text(74, y - 5, r[0], { size: 14, color: 'white', weight: 600, parent: L });
            ctx.text(74, y + 15, r[1], { size: 12, font: 'mono', color: r[3], parent: L });
            ctx.text(376, y + 4, r[2], { size: 16, font: 'mono', weight: 700, color: r[3], anchor: 'end', parent: L });
          });
          ctx.label(60, 700, 'only if users.consent_train = true', { color: 'pink', size: 12, anchor: 'start', parent: L });
          ctx.reveal(L, { from: 'left', delay: 500 });
          /* funnel */
          var F = ctx.group({ parent: g });
          head(ctx, F, 1170, 345, 'CURATION FUNNEL (illustrative)');
          var fr = [['raw signals', 1, 'teal'], ['consented', 0.55, 'teal'], ['passes PII + safety', 0.45, 'pink'], ['confident pairs', 0.12, 'amber']];
          S.fb = fr.map(function (f, i) {
            var y = 385 + i * 62;
            ctx.text(1170, y, f[0], { size: 13, color: 'text', parent: F });
            ctx.text(1540, y, Math.round(f[1] * 100) + '%', { size: 13, font: 'mono', color: f[2], anchor: 'end', parent: F });
            var b = ctx.rect(1170, y + 12, 370 * f[1], 16, { rx: 3, fill: ctx.alpha(f[2], 0.5), stroke: f[2], sw: 1, parent: F });
            return [b, 370 * f[1]];
          });
          ctx.para(1170, 650, ['Diffusion-DPO: denoise the winner', '(take 3b) better and the loser', '(take 3a) worse, relative to a', 'frozen reference model.'], { size: 13, font: 'mono', color: 'dim', lh: 22, parent: F });
          ctx.reveal(F, { from: 'right', delay: 600 });
          S.fb.forEach(function (b, i) { b[0].setAttribute('width', 0); ctx.animate(b[0], { width: [0, b[1]] }, 600, 'out', 900 + i * 200); });
          S.flow = ctx.stream(circ, { color: 'teal', count: 6, period: 5200, parent: ring });
          return ctx.wait(1800).then(function () {
            return S.fw.reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, { dur: 450 }); }); }, Promise.resolve());
          });
        }
      },
      /* ------------------------------------------------------------------ 9 */
      {
        title: 'One turn, every store',
        say: 'Put it together for one agent turn: starting shot four. A session and rate limit check in Redis takes under a millisecond. Claiming the shot in Postgres takes three. Retrieving the fox references from vector memory takes about twelve, and fetching the character sheet from object storage about forty. Then the GPU works for a minute and a half, and the new take, its event and its lineage are written in milliseconds. The data plane must never be the reason a render waits.',
        deep: '<p>Illustrative in-region budget for one agent turn around a render:</p>' +
          '<table><tr><th>Store</th><th>Operation</th><th>~ms</th></tr>' +
          '<tr><td>Redis</td><td>session + token bucket</td><td>0.6</td></tr>' +
          '<tr><td>Postgres</td><td>CAS claim + outbox insert</td><td>3</td></tr>' +
          '<tr><td>Vector DB</td><td>filtered top-k (HNSW)</td><td>12</td></tr>' +
          '<tr><td>Object store</td><td>GET 2 references (first byte + transfer)</td><td>40</td></tr>' +
          '<tr><td>Event log</td><td>append (acks=all)</td><td>5</td></tr>' +
          '<tr><td>GPU</td><td>render 5 s shot (8 GPUs, sequence-parallel ⇒ ~720 GPU-s)</td><td>~9·10<sup>4</sup></td></tr>' +
          '<tr><td>Object store</td><td>PUT 12 MB take</td><td>30</td></tr>' +
          '<tr><td>Lineage + log</td><td>edges + <code>shot.rendered</code></td><td>5</td></tr></table>' +
          '<p>Design rules this chamber argues for:</p><ol>' +
          '<li>Pass bytes by reference; LLM contexts hold URIs and captions, never media.</li>' +
          '<li>One transaction for state + event (outbox); everything else is a consumer of the log.</li>' +
          '<li>Caches may make things fast, never correct.</li>' +
          '<li>Every artifact carries a manifest hash: reproducibility, memoisation and deletion come for free.</li></ol>' +
          '<div class="note">Next: zoom into <b>Vector Memory &amp; Retrieval</b> to see how "what does the fox look like?" is answered in milliseconds.</div>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.flow) { S.flow.stop(); S.flow = null; }
          var g = view(ctx, S, null);
          ctx.hud('data plane ≈ 0.1 s · GPU ≈ 90 s per shot');
          panel(ctx, g, 50, 330, 1500, 530, 'teal');
          head(ctx, g, 76, 358, 'ONE AGENT TURN · start shot 4 · touches every store');
          var XA = 590, SA = 9.5;     /* 0..58 ms → 590..1141 */
          var XB = 1230, SB = 7;      /* +0..40 ms after render → 1230..1510 */
          var rows = [['Redis · session + rate limit', 0, 0.6, 3, 'A'], ['Postgres · claim shot 4 (CAS + outbox)', 0.6, 3, 1, 'A'],
            ['Vector DB · top-k fox + style refs', 3.6, 12, 4, 'A'], ['Object store · GET fox_sheet, sketch_2', 15.6, 40, 0, 'A'],
            ['Event log · append shot.rendering', 15.6, 5, 2, 'A'], ['GPU · render shot 4 (~90 s, off-scale)', 0, 0, -1, 'G'],
            ['Object store · PUT take 4a (write-once)', 0, 30, 0, 'B'], ['Lineage + log · edges, shot.rendered', 30, 5, 5, 'B']];
          var bars = [];
          rows.forEach(function (r, i) {
            var y = 400 + i * 50;
            ctx.text(76, y, r[0], { size: 14, color: 'text', parent: g });
            ctx.rect(XA, y - 12, 1510 - XA, 24, { rx: 4, fill: 'rgba(255,255,255,0.025)', parent: g });
            var x, w, col = 'teal';
            if (r[4] === 'A') { x = XA + r[1] * SA; w = Math.max(4, r[2] * SA); }
            else if (r[4] === 'B') { x = XB + r[1] * SB; w = Math.max(4, r[2] * SB); }
            else { x = 1080; w = 190; col = 'red'; }
            var b = ctx.rect(x, y - 12, w, 24, { rx: 4, fill: ctx.alpha(col, 0.5), stroke: col, sw: 1.2, parent: g });
            var lab = r[4] === 'G' ? '≈ 90 000 ms' : (r[2] < 1 ? r[2] + ' ms' : r[2] + ' ms');
            var tx = r[4] === 'G' ? ctx.text(x + w / 2, y + 1, lab, { size: 12, font: 'mono', color: 'white', anchor: 'middle', weight: 700, parent: g })
              : ctx.text(x + w + 8, y + 1, lab, { size: 12, font: 'mono', color: col, parent: g });
            bars.push([b, w, tx, r[3]]);
          });
          /* axes */
          var ay = 800;
          ctx.line(XA, ay, 1150, ay, { color: 'faint', parent: g });
          ctx.line(1220, ay, 1510, ay, { color: 'faint', parent: g });
          [0, 10, 20, 30, 40, 50].forEach(function (v) { ctx.text(XA + v * SA, ay + 16, v + '', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g }); });
          ctx.text(1150, ay + 16, 'ms', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
          [[0, '+90 s'], [20, '+20'], [40, '+40 ms']].forEach(function (t) { ctx.text(XB + t[0] * SB, ay + 16, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g }); });
          ctx.path('M1172,' + (ay + 10) + ' l10,-20 M1186,' + (ay + 10) + ' l10,-20', { stroke: 'red', sw: 2, parent: g });
          ctx.text(800, 838, 'Everything except the GPU is milliseconds: the data plane must never be the reason a render waits.', { size: 14, color: 'teal', anchor: 'middle', parent: g });
          ctx.reveal(g, { from: 'up', dur: 500 });
          var chain = ctx.wait(500);
          bars.forEach(function (b) {
            b[0].setAttribute('width', 0);
            b[2].setAttribute('opacity', 0);
            chain = chain.then(function () {
              if (b[3] >= 0) ctx.pulse(S.st[b[3]], { color: 'teal', dur: 500 });
              return ctx.animate(b[0], { width: [0, b[1]] }, 380, 'out').then(function () { return ctx.fade(b[2], 1, 200); });
            });
          });
          return chain.then(function () {
            return ctx.pulse(S.st[4], { color: 'teal', times: 2, dur: 700 });
          });
        }
      }
    ]
  });
})();
