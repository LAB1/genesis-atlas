/* L1 — Data, Memory & Storage. The six stores that hold every durable fact of a video job, shown as a
 * "tab bar" along the top; each step focuses one store and animates its mechanism underneath, beat by beat
 * (content addressing + erasure coding, optimistic concurrency + outbox, partitioned log, token bucket + fencing,
 * embeddings, provenance graph for shot 3), then the data flywheel and a latency waterfall of one agent turn. */
(function () {
  var STORES = [
    { t: 'Object Store', s: 'S3 · GCS · CAS', i: 'cloud', chip: 'GB blobs · ~100 ms' },
    { t: 'Metadata DB', s: 'Postgres · Spanner', i: 'db', chip: 'rows · ACID · ~ms' },
    { t: 'Event Log', s: 'Kafka · Redpanda', i: 'queue', chip: 'append-only · ordered' },
    { t: 'Cache', s: 'Redis · Valkey', i: 'bolt', chip: 'sub-ms · TTL' },
    { t: 'Vector DB', s: 'HNSW · IVF-PQ', i: 'search', chip: 'ANN · top-k' },
    { t: 'Lineage', s: 'W3C PROV graph', i: 'net', chip: 'audit · replay' }
  ];
  var SX = [150, 410, 670, 930, 1190, 1450], SY = 215;

  /* Text colours. The light theme inverts luminance, and several palette hues (magenta, red, blue, violet, orange,
   * pink, dim) fall below 4.5:1 contrast there. Text is lifted toward white (it also reads brighter in the dark
   * theme); borders, fills and links keep the palette colour. */
  var LIFT = { magenta: 0.5, blue: 0.4, violet: 0.35, red: 0.4, orange: 0.3, pink: 0.3 };
  function lift(ctx, col) {
    if (col === 'dim') return '#9fadc9';
    return LIFT[col] ? ctx.mix(col, '#ffffff', LIFT[col]) : col;
  }
  function txt(ctx, x, y, s, o) {
    o = o || {};
    o.color = lift(ctx, o.color);
    return ctx.text(x, y, s, o);
  }
  function para(ctx, x, y, lines, o) {
    o = o || {};
    o.color = lift(ctx, o.color);
    return ctx.para(x, y, lines, o);
  }
  function lbl(ctx, x, y, str, o) {
    o = o || {};
    if (o.textColor === undefined) { var t = lift(ctx, o.color); if (t !== o.color) o.textColor = t; }
    return ctx.label(x, y, str, o);
  }
  function head(ctx, g, x, y, s, col) {
    return txt(ctx, x, y, s, { size: 14, font: 'display', weight: 700, color: col || 'teal', spacing: 1, parent: g });
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
  /* start a segment invisible: elements (or arrays of them) that a later beat reveals */
  function hide() {
    Array.prototype.slice.call(arguments).forEach(function (a) {
      [].concat(a).forEach(function (e) { if (e) e.setAttribute('opacity', 0); });
    });
  }

  /* start a new detail view: fade out previous, focus the selected store(s) */
  function view(ctx, S, keep) {
    /* loops started by the previous step (live token bucket, flywheel stream) stop with it */
    (S.loops || []).forEach(function (l) { l.stop(); });
    S.loops = [];
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
      'Kreps, Narkhede &amp; Rao, <i>Kafka: a Distributed Messaging System for Log Processing</i>, NetDB 2011',
      'Apache Kafka, <i>KIP-98: Exactly Once Delivery and Transactional Messaging</i>, <i>KIP-405: Kafka Tiered Storage</i> and <i>KIP-848: The Next Generation of the Consumer Rebalance Protocol</i>, 2017–2025',
      'Huang et al., <i>Erasure Coding in Windows Azure Storage</i>, USENIX ATC 2012',
      'Moreau &amp; Missier (eds.), <i>PROV-DM: The PROV Data Model</i>, W3C Recommendation 2013',
      'Kleppmann, <i>How to do distributed locking</i>, 2016',
      'Kleppmann, <i>Designing Data-Intensive Applications</i>, O\'Reilly 2017',
      'Wallace et al., <i>Diffusion Model Alignment Using Direct Preference Optimization</i>, CVPR 2024; Liu et al., <i>Improving Video Generation with Human Feedback</i> (VideoReward, Flow-DPO), 2025',
      'Liang et al., <i>Mind the Gap: Understanding the Modality Gap in Multi-modal Contrastive Representation Learning</i>, NeurIPS 2022'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Where state lives',
        beats: [
          {
            say: 'The agents and GPU workers you have met are deliberately stateless. Any process can crash and be replaced, because nothing durable lives inside it.',
            card: { tag: 'KEY IDEA', title: 'Stateless compute, durable state', body: 'Orchestrator, agents and GPU workers hold nothing that cannot be rebuilt. Every durable fact lives in the data plane instead.' },
            deep: '<p>The control plane (orchestrator, agents, GPU workers) is <b>stateless by design</b>: any process can be killed and replaced, because every durable fact lives in a store chosen for its access pattern. Recovery is mechanical: start a new process, reload the job row, replay the event log from the last checkpoint.</p>' +
              '<p>This matters most for the GPU tier. A render worker on preemptible capacity can vanish mid-shot, so the shot must be resumable from committed facts, never from process memory.</p>' +
              '<div class="note">A crashed process should cost seconds of rework, never a lost fact.</div>'
          },
          {
            say: 'No single database can do it all, so the data plane is six stores, each chosen for one access pattern. Object storage holds bytes, a metadata database holds transactional facts, an event log holds history, a cache holds disposable state, a vector database holds meaning, and a lineage graph holds provenance.',
            card: { tag: 'KEY IDEA', title: 'One store per access pattern', body: 'Blobs, rows, streams, hot keys, vectors and graphs each want a different data structure, consistency level and price per gigabyte.',
              more: '<p>The price of this <i>polyglot persistence</i> is operational: six systems to run, back up, secure and keep consistent with each other. The outbox pattern and the event log (steps three and four) are what stop them drifting apart.</p>' },
            deep: '<p>Each store is picked for an access profile, not for fashion:</p>' +
              '<table><tr><th>Store</th><th>Holds</th><th>Access profile</th></tr>' +
              '<tr><td>Object store</td><td>sketches, memo, latents, takes, masters, weights</td><td>MB–GB blobs, ~100 ms first byte (S3 Standard), GB/s aggregate</td></tr>' +
              '<tr><td>Metadata DB</td><td>users, jobs, shots, takes</td><td>KB rows, ACID, ~1–5 ms</td></tr>' +
              '<tr><td>Event log</td><td>agent + workflow events</td><td>append, total order per key</td></tr>' +
              '<tr><td>Cache</td><td>sessions, rate limits, leases</td><td>sub-ms, TTL, loss is tolerable</td></tr>' +
              '<tr><td>Vector DB</td><td>embeddings of media + text</td><td>ANN top-k, ~1–20 ms</td></tr>' +
              '<tr><td>Lineage</td><td>provenance DAG</td><td>append, graph traversal</td></tr></table>'
          },
          {
            say: 'Each kind of state has exactly one home. Bytes travel by reference, facts are written by value inside transactions, changes are recorded as immutable events, and meaning is stored as vectors.',
            card: { tag: 'HOW IT WORKS', title: 'Pass references, not pixels', body: 'A 12 MB take becomes a URI of a few dozen tokens in an agent context. The bytes stay in object storage, addressed by hash.' },
            deep: '<ul><li><b>Bytes by reference</b>: LLM contexts hold <code>cas://sha256/…</code> URIs and captions, never media. A 5 s take shown to a VLM as ~10 sampled frames would cost roughly 10<sup>4</sup> tokens; its URI costs about 40.</li>' +
              '<li><b>Facts by value, in transactions</b>: job and shot state are rows, changed with compare-and-set.</li>' +
              '<li><b>Changes as immutable events</b>: every decision is appended to the log, so any past state can be replayed.</li>' +
              '<li><b>Meaning as vectors</b>: similarity search over embeddings finds the fox, the style and the cast.</li></ul>'
          },
          {
            say: 'Now look at what one job actually stores. A trailer leaves a little over half a gigabyte behind, and ninety eight percent of it is video: latents, takes and the master. The metadata, lineage and embeddings that make it reproducible fit in under a megabyte.',
            card: { tag: 'NUMBERS', title: 'Per-job footprint', stat: { v: '≈ 0.56', u: 'GB', l: 'per 30 s trailer, ~98% of it video; metadata, lineage and embeddings fit in under 1 MB' } },
            deep: '<p>The bars are on a log scale because the ratio is ~10<sup>3</sup>: the master and ladder (~230 MB) outweigh the whole lineage graph (~0.2 MB) a thousand-fold. Consequence: <b>storage cost, egress and durability engineering are about bytes</b>; consistency, latency and correctness engineering are about the small facts.</p>' +
              '<details><summary>Go deeper</summary><p>Latent size for the atlas 5 s clip at 24 fps (121 frames; Wan-style causal VAE, compression 4×8×8, 16 channels): T′ = 1 + (121−1)/4 = 31, H′ = 720/8 = 90, W′ = 1280/8 = 160.</p>' +
              '<div class="eq">31 · 90 · 160 · 16 = 7.14 M values ≈ 14.3 MB in bf16 per take</div>' +
              '<p>Twelve takes (six shots, two attempts each) give ≈ 171 MB of transient latents, deleted after a week.</p></details>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, null);
          S.st = []; S.chips = [];
          STORES.forEach(function (d, i) {
            S.st.push(ctx.node({ x: SX[i], y: SY, w: 200, h: 84, kind: 'cyl', title: d.t, sub: d.s, icon: d.i, color: 'teal', titleSize: 15, subSize: 12 }));
            S.chips.push(lbl(ctx, SX[i], 285, d.chip, { color: i === 4 ? 'teal' : 'dim', size: 12 }));
          });
          hide(S.st, S.chips);
          S.cp = ctx.node({ x: 800, y: 480, w: 420, h: 84, title: 'Control plane', sub: 'orchestrator · agents · GPU workers', icon: 'gear', color: 'magenta', titleSize: 18, parent: g });
          S.cpNote = lbl(ctx, 800, 552, 'stateless · crash it, restart it, reload from the stores', { color: 'magenta', size: 12, parent: g });
          hide(S.cp, S.cpNote);
          /* three short-lived processes: each one crashes and is replaced without losing anything */
          var procs = ['orchestrator', 'agent', 'GPU worker'].map(function (t, i) {
            var p = lbl(ctx, 600 + i * 200, 392, t, { color: 'magenta', size: 12, parent: g });
            p.setAttribute('opacity', 0);
            return p;
          });
          var names = ['sketch.png', 'shot row', 'event', 'session', 'embedding', 'edge'];
          S.cl = SX.map(function (x, i) {
            var l = ctx.link({ x: 800 + (i - 2.5) * 56, y: 438 }, { x: x, y: 302 }, { from: 't', to: 'b', straight: true, color: ctx.alpha('teal', 0.7), sw: 1.4, parent: g });
            l.setAttribute('opacity', 0);
            return l;
          });

          /* per-job footprint, log scale */
          var fp = ctx.group({ parent: g });
          panel(ctx, fp, 50, 600, 720, 272);
          head(ctx, fp, 70, 626, 'PER-JOB FOOTPRINT · 30 s trailer · log scale');
          var rows = [['input media (3 sketches + memo)', 7, 'violet'], ['latents (12 takes, transient)', 171, 'lime'], ['clip takes (12 × 5 s)', 150, 'lime'],
            ['master + ABR ladder', 230, 'orange'], ['event log', 3, 'magenta'], ['embeddings (~150 × 1152-d)', 0.35, 'teal'], ['metadata + lineage', 0.2, 'teal']];
          function px(v) { return 330 + (Math.log(v) / Math.LN10 + 1) / 4 * 360; }
          S.fpBars = [];
          rows.forEach(function (r, i) {
            var y = 656 + i * 27;
            txt(ctx, 70, y, r[0], { size: 12, font: 'mono', color: 'text', parent: fp });
            ctx.rect(330, y - 9, 360, 18, { rx: 3, fill: 'rgba(255,255,255,0.03)', parent: fp });
            var b = ctx.rect(330, y - 9, px(r[1]) - 330, 18, { rx: 3, fill: ctx.alpha(r[2], 0.55), stroke: r[2], sw: 1, parent: fp });
            b._w = px(r[1]) - 330;
            b.setAttribute('width', 0);
            S.fpBars.push(b);
            txt(ctx, px(r[1]) + 8, y, r[1] + ' MB', { size: 12, font: 'mono', color: lift(ctx, r[2]), parent: fp });
          });
          [0.1, 1, 10, 100, 1000].forEach(function (v) {
            txt(ctx, px(v), 856, v < 1 ? '0.1' : String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: fp });
          });
          txt(ctx, 748, 856, 'MB', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: fp });
          hide(fp);

          /* rules */
          var rl = ctx.group({ parent: g });
          panel(ctx, rl, 830, 600, 720, 272);
          head(ctx, rl, 850, 626, 'WHERE EACH KIND OF STATE GOES');
          [['BYTES', 'cyan', 'by reference: agents pass cas:// URIs, never pixels'],
            ['FACTS', 'blue', 'by value, in transactions: job and shot state'],
            ['CHANGES', 'magenta', 'as immutable events: every decision, replayable'],
            ['MEANING', 'teal', 'as vectors: similarity search for style and cast']].forEach(function (r, i) {
            var y = 672 + i * 50;
            lbl(ctx, 850, y, r[0], { color: r[1], size: 12, anchor: 'start', w: 104, parent: rl });
            txt(ctx, 972, y, r[2], { size: 14, color: 'text', parent: rl });
          });
          hide(rl);

          /* beat 0: a stateless control plane */
          ctx.hud('stateless compute · durable state');
          return Promise.all([ctx.reveal(S.cp, { from: 'up' }), ctx.reveal(S.cpNote, { from: 'up', delay: 350 })]).then(function () {
            return ctx.reveal(procs, { from: 'down', stagger: 120, dur: 350 });
          }).then(function () {
            /* each process is killed (red) and replaced (green); the control plane keeps going */
            return procs.reduce(function (p, pr, i) {
              return p.then(function () {
                pr.rectEl.setAttribute('stroke', ctx.color('red')); pr.textEl.setAttribute('fill', ctx.color('red'));
                pr.setText('✕ ' + ['orchestrator', 'agent', 'GPU worker'][i]);
                return ctx.wait(350);
              }).then(function () {
                pr.rectEl.setAttribute('stroke', ctx.color('lime')); pr.textEl.setAttribute('fill', ctx.color('lime'));
                pr.setText('↻ ' + ['orchestrator', 'agent', 'GPU worker'][i]);
                return ctx.wait(150);
              });
            }, Promise.resolve());
          }).then(function () {
            return Promise.all([ctx.pulse(S.cp, { color: 'magenta', times: 2, dur: 700 }), ctx.fadeOut(procs, 900, true)]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: six stores */
            ctx.hud('six stores · one access pattern each');
            ctx.hotspot(S.st[4], 'rag-memory', { hint: 'ZOOM ⤢' });
            return Promise.all([ctx.reveal(S.st, { from: 'down', stagger: 110 }), ctx.reveal(S.chips, { delay: 500, stagger: 110 })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: one home per kind of state */
            ctx.hud('bytes · facts · changes · meaning');
            ctx.reveal(rl, { from: 'up', delay: 500 });
            return Promise.all(S.cl.map(function (l, i) {
              return ctx.reveal(l, { from: 'draw', delay: i * 120 }).then(function () { return ctx.packet(l, { color: 'teal', dur: 900, label: names[i] }); });
            }));
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the footprint of one job */
            ctx.hud('per job ≈ 0.56 GB · ~98% of it video bytes');
            return ctx.reveal(fp, { from: 'up' }).then(function () {
              return Promise.all(S.fpBars.map(function (b, i) { return ctx.animate(b, { width: [0, b._w] }, 700, 'out', i * 110); }));
            }).then(function () { return ctx.pulse(S.fpBars[3], { color: 'orange', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Object storage',
        beats: [
          {
            say: 'Object storage holds the heavy bytes. Every file is named by the SHA two fifty six hash of its content, so identical uploads collapse into one object and a reference can never point at changed bytes.',
            card: { tag: 'KEY IDEA', title: 'The name is the hash', body: 'Key equals SHA-256 of the bytes. Deduplication is free, references cannot dangle, and every cache on the path needs no invalidation protocol.' },
            deep: '<p><b>Content addressing</b>: key = SHA-256(bytes). Identical uploads collapse to one object (dedup with refcounts), references can never dangle onto changed bytes, and every cache on the path (CDN, GPU-node NVMe, encoded-latent cache) can be keyed by digest with no invalidation protocol: a given key can only ever mean one thing.</p>' +
              '<details><summary>Go deeper</summary><p>Accidental collision odds follow the birthday bound: with n objects and a 256-bit digest,</p><div class="eq">P(collision) ≈ n² / 2<sup>257</sup> ≈ 10<sup>24</sup> / 2.3·10<sup>77</sup> ≈ 4·10<sup>−54</sup> &nbsp; (n = 10<sup>12</sup>)</div><p>so dedup by digest is safe in practice; the real hazards are hash-then-upload races and users uploading secret data whose existence can be probed by digest.</p></details>'
          },
          {
            say: 'The blob is then cut into six data shards, and Reed Solomon coding adds three parity shards. The nine shards are spread across three availability zones, so any six of them are enough to rebuild the object.',
            card: { tag: 'HOW IT WORKS', title: 'Six data shards, three parity', body: 'RS(6,3): each availability zone holds two data shards and one parity shard. Any six of the nine reconstruct the clip.' },
            deep: '<p><b>Erasure coding</b>: split into k data shards, add m parity shards (Reed–Solomon over GF(2<sup>8</sup>)); any k of the k+m shards reconstruct the object. Encoding is a matrix product with a k+m by k generator matrix G, decoding inverts the k by k submatrix of the surviving rows:</p>' +
              '<div class="eq">shards = G · data, &nbsp; data = G<sub>S</sub><sup>−1</sup> · shards<sub>S</sub>, &nbsp; |S| = k = 6</div>' +
              '<p>A 12.4 MB take becomes 6 data + 3 parity shards of ~2.07 MB each. Libraries such as Intel ISA-L run the Galois-field arithmetic with SIMD instructions, so encoding is cheap next to moving the bytes.</p>'
          },
          {
            say: 'Lose an entire zone and the clip still decodes, because six of nine shards survive. The price is one and a half times the raw size, where triple replication costs three times.',
            card: { tag: 'NUMBERS', title: 'Survive a zone at half the cost', stat: { v: '1.5×', l: 'storage overhead of RS(6,3), versus 3× for triple replication, with a whole availability zone lost' },
              more: '<p><b>Pitfall.</b> After an AZ loss only six of nine shards remain: exactly k. Zero redundancy is left until repair rebuilds the missing shards, so any further disk failure loses data. Repair speed, or a wider code, is part of the durability budget.</p>' },
            deep: '<div class="eq">overhead = (k+m)/k = 9/6 = 1.5× &nbsp;vs&nbsp; 3× for triple replication</div>' +
              '<p>With 3 shards per AZ, losing a whole AZ still leaves 6 of 9. The cost of MDS codes is <b>repair traffic</b>: rebuilding one lost shard reads k = 6 shards, 6× the shard size. Real systems use local reconstruction codes (Azure LRC 12+2+2, overhead 16/12 = 1.33×) so most single-shard repairs read only a local group.</p>' +
              '<p>S3 is designed for 99.999999999% (eleven nines) durability of objects over a given year, storing each object across at least three availability zones.</p>'
          },
          {
            say: 'Now break it yourself. Click any shard to fail it, and click again to revive it. Three failures are always survivable, and a fourth leaves the object unrecoverable until repair has rebuilt a shard.',
            card: { tag: 'TRY IT', title: 'Kill shards, watch the status', body: 'Any three of the nine may fail. Kill a fourth and the status turns red: fewer than <b>k = 6</b> shards remain, so decoding is impossible.' },
            deep: '<div class="eq">P<sub>loss</sub> = Σ<sub>i=m+1</sub><sup>k+m</sup> C(k+m, i) p<sup>i</sup> (1−p)<sup>k+m−i</sup> ≈ C(9,4) · p<sup>4</sup> = 126 p<sup>4</sup></div>' +
              '<p>Here p is the chance that a given shard is lost before it is repaired. With a 2% annual disk failure rate and 24 h to detect and rebuild, p ≈ 5.5·10<sup>−5</sup>, so one repair window loses an object with probability ≈ 1.1·10<sup>−15</sup>, and 365 windows a year give about 4·10<sup>−13</sup>: twelve nines on paper.</p>' +
              '<p>Real risk is dominated by <i>correlated</i> failures (a bad firmware batch, a rack, a zone), which is why shards are spread across zones and repair is prioritised by how many shards an object has left.</p>'
          },
          {
            say: 'Uploads are write once. A pre-signed request carries the checksum and a conditional header, so a retry is idempotent and a corrupted body is rejected.',
            card: { tag: 'HOW IT WORKS', title: 'Idempotent, verified upload', body: '<code>x-amz-checksum-sha256</code> makes the server verify the bytes; <code>If-None-Match: *</code> turns a duplicate PUT into a harmless 412.' },
            deep: '<p><b>Write-once</b>: a pre-signed PUT with <code>x-amz-checksum-sha256</code> and <code>If-None-Match: *</code> (S3 conditional writes, 2024) makes uploads idempotent and tamper-evident. A client that retries after a lost response gets 412 for a key that already exists, and treats it as success because the key <i>is</i> the digest.</p>' +
              '<p>Large files use multipart upload (up to 10,000 parts, 5 MiB minimum part size except the last). Each part carries its own checksum and can be retried alone, which is what makes resumable, parallel uploads from flaky mobile links safe.</p>'
          },
          {
            say: 'Finally, lifecycle rules walk old data from hot to cold tiers. Latents are deleted after a week, rejected takes after a month, approved takes move to infrequent access, and masters go to deep archive after ninety days.',
            card: { tag: 'NUMBERS', title: 'Cold storage price', stat: { v: '23×', l: 'cheaper per GB-month from Standard ($0.023) to Deep Archive (about $0.001)' } },
            deep: '<p><b>Lifecycle</b> (AWS us-east-1 list prices per GB-month): Standard ≈ $0.023, Standard-IA ≈ $0.0125, Glacier Deep Archive ≈ $0.001. Transient latents are deleted, not archived. The catch of cold tiers is retrieval: Deep Archive restores take 12 to 48 hours and bill a 180-day minimum storage duration, so tiering a clip you will re-render next week is a loss.</p>' +
              '<span class="muted">Weights live here too: a 14B-parameter DiT in bf16 is ~28 GB, which is why GPU nodes keep a local NVMe weight cache to avoid cold-start pulls. Weights are pinned, never tiered.</span>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [0]);
          /* 1 content addressing */
          var a = ctx.group({ parent: g });
          head(ctx, a, 60, 345, '1 · CONTENT ADDRESSING');
          var file = ctx.node({ x: 170, y: 400, w: 220, h: 58, title: 'shot3_take2.mp4', sub: '12.4 MB · H.264 copy', icon: 'film', color: 'lime', titleSize: 14, subSize: 12, parent: a });
          var hash = ctx.node({ x: 390, y: 400, w: 120, h: 58, title: 'SHA-256', kind: 'chip', color: 'teal', titleSize: 14, parent: a });
          var l1 = ctx.link(file, hash, { color: 'teal', straight: true, parent: a });
          var l2 = ctx.link(hash, { x: 470, y: 400 }, { color: 'teal', straight: true, parent: a });
          S.key = txt(ctx, 480, 400, '', { size: 14, font: 'mono', color: 'teal', parent: a });
          txt(ctx, 60, 452, 're-upload sketch_2.png → same digest → HEAD 200 → skip PUT', { size: 12, font: 'mono', color: 'dim', parent: a });
          hide(a);
          /* 2 erasure coding */
          var b = ctx.group({ parent: g });
          head(ctx, b, 60, 500, '2 · ERASURE CODING · RS(6,3) across 3 AZs');
          var names = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'p1', 'p2', 'p3'];
          var az = [0, 0, 1, 1, 2, 2, 0, 1, 2], slot = [0, 1, 0, 1, 0, 1, 2, 2, 2];
          var slotG = ctx.group({ parent: b });
          names.forEach(function (n, i) { ctx.rect(60 + i * 54, 530, 50, 28, { rx: 4, stroke: ctx.alpha(i < 6 ? 'teal' : 'amber', 0.3), sw: 1, dash: '3 3', parent: slotG }); });
          txt(ctx, 60, 574, '12.4 MB → 6 data + 3 parity shards × 2.07 MB', { size: 12, font: 'mono', color: 'dim', parent: b });
          ['AZ-a', 'AZ-b', 'AZ-c'].forEach(function (n, i) {
            var x = 60 + i * 238;
            ctx.rect(x, 590, 226, 104, { rx: 8, fill: 'rgba(43,245,196,0.04)', stroke: ctx.alpha('teal', 0.4), dash: '4 4', parent: b });
            txt(ctx, x + 12, 606, n, { size: 12, font: 'mono', color: 'dim', parent: b });
            for (var j = 0; j < 3; j++) ctx.rect(x + 14 + j * 70, 620, 62, 60, { rx: 6, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('white', 0.18), sw: 1, parent: b });
          });
          S.shards = names.map(function (n, i) {
            var sg = ctx.group({ parent: b });
            var col = i < 6 ? 'teal' : 'amber';
            ctx.rect(0, 0, 50, 28, { rx: 4, fill: ctx.alpha(col, 0.35), stroke: col, sw: 1.2, parent: sg });
            txt(ctx, 25, 14.5, n, { size: 13, font: 'mono', color: col, anchor: 'middle', weight: 600, parent: sg });
            ctx.place(sg, 60 + i * 54, 530);
            return sg;
          });
          S.fail = ctx.group({ parent: b });
          ctx.rect(298, 590, 226, 104, { rx: 8, fill: ctx.alpha('red', 0.16), stroke: 'red', sw: 1.5, parent: S.fail });
          txt(ctx, 411, 606, '✕ AZ-b lost', { size: 12, font: 'mono', color: 'red', anchor: 'middle', weight: 700, parent: S.fail });
          /* live status: which shards are alive, can the object still be decoded? (also driven by clicks in the TRY IT beat) */
          S.dead = {};
          S.failT = txt(ctx, 60, 722, '', { size: 12, font: 'mono', color: 'lime', parent: b });
          S.ovhT = txt(ctx, 60, 744, 'storage overhead (k+m)/k = 1.5×  vs  3× for triple replication', { size: 12, font: 'mono', color: 'dim', parent: b });
          function paintStatus(withFail) {
            var n = 0;
            for (var q = 0; q < 9; q++) if (!S.dead[q]) n++;
            var ok = n >= 6;
            S.failT.textContent = ok ? n + ' of 9 shards alive → Reed–Solomon decode ✓  (any 6 suffice)' : n + ' of 9 shards alive → fewer than k = 6: UNRECOVERABLE ✗';
            S.failT.setAttribute('fill', ctx.color(ok ? 'lime' : 'red'));
            if (withFail) S.fail.setAttribute('opacity', S.dead[2] && S.dead[3] && S.dead[7] ? 1 : 0);
          }
          function setShard(i, dead, ms) {
            S.dead[i] = dead;
            return ctx.fade(S.shards[i], dead ? 0.25 : 1, ms === undefined ? 300 : ms);
          }
          /* synthetic box: the shard groups are moved with transforms, so pulses need their true position */
          function shardBox(i) {
            var x = 60 + az[i] * 238 + 14 + slot[i] * 70 + 6;
            return { box: { x: x, y: 636, w: 50, h: 28, cx: x + 25, cy: 650, l: x, r: x + 50, t: 636, b: 664 } };
          }
          var tryG = ctx.group({ parent: b });
          lbl(ctx, 60, 784, '▸ click a shard to fail or revive it', { color: 'lime', size: 12, anchor: 'start', parent: tryG });
          var rst = lbl(ctx, 410, 784, 'reset', { color: 'cyan', size: 12, anchor: 'start', parent: tryG });
          rst.style.cursor = 'pointer';
          hide(b, S.fail, S.failT, S.ovhT, tryG);
          /* 3 write-once upload */
          var c = ctx.group({ parent: g });
          head(ctx, c, 830, 345, '3 · WRITE-ONCE UPLOAD (pre-signed URL)');
          var up = code(ctx, { x: 830, y: 362, w: 710, title: 'client → object store', lang: 'sh', size: 13, parent: c, typing: true, lines: [
            'PUT /cas/sha256/9f3a…c1e0?X-Amz-Signature=…',
            'x-amz-checksum-sha256: n6oP…Qk=   # server verifies',
            'If-None-Match: *                   # 412 if key exists',
            'Content-Type: video/mp4',
            '200 OK  (immutable: never overwritten, only deleted)'
          ] });
          hide(c);
          /* 4 lifecycle */
          var d = ctx.group({ parent: g });
          head(ctx, d, 830, 548, '4 · LIFECYCLE TIERS  (not to scale)');
          [[830, 180, 'HOT · Standard', '$0.023 / GB-mo', 'lime'], [1014, 180, 'WARM · IA', '$0.0125 / GB-mo', 'amber'], [1198, 342, 'COLD · Deep Archive', '≈ $0.001 / GB-mo', 'blue']].forEach(function (t) {
            ctx.rect(t[0], 572, t[1], 58, { rx: 6, fill: ctx.alpha(t[4], 0.12), stroke: ctx.alpha(t[4], 0.6), sw: 1.2, parent: d });
            txt(ctx, t[0] + 10, 590, t[2], { size: 13, font: 'display', weight: 700, color: lift(ctx, t[4]), parent: d });
            txt(ctx, t[0] + 10, 613, t[3], { size: 12, font: 'mono', color: 'text', parent: d });
          });
          ctx.line(830, 652, 1540, 652, { color: 'faint', parent: d });
          [[830, '0 d'], [1014, '30 d'], [1198, '90 d'], [1540, '365 d+']].forEach(function (t, i) {
            ctx.line(t[0], 647, t[0], 657, { color: 'dim', parent: d });
            txt(ctx, t[0], 670, t[1], { size: 11, font: 'mono', color: 'dim', anchor: i === 3 ? 'end' : (i === 0 ? 'start' : 'middle'), parent: d });
          });
          S.mark = ctx.group({ parent: d });
          ctx.circle(0, 0, 7, { fill: 'lime', parent: S.mark, glow: true });
          txt(ctx, 0, -16, 'take 3b', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: S.mark });
          ctx.place(S.mark, 840, 652);
          [[830, 706, 'latents → delete @ 7 d', 'red'], [1190, 706, 'rejected takes → delete @ 30 d', 'red'],
            [830, 744, 'approved takes → IA @ 30 d', 'amber'], [1190, 744, 'masters → archive @ 90 d', 'blue'],
            [830, 782, 'inputs → user retention policy', 'dim'], [1190, 782, 'weights → pinned, never tiered', 'dim']].forEach(function (r) {
            lbl(ctx, r[0], r[1], r[2], { color: r[3], size: 12, anchor: 'start', parent: d });
          });
          hide(d);

          /* beat 0: name the blob by its content */
          ctx.hud('key = SHA-256(bytes) · same bytes, same object');
          return ctx.reveal(a, { from: 'up' }).then(function () { return ctx.wait(300); }).then(function () {
            return ctx.packet(l1, { color: 'lime', dur: 600 });
          }).then(function () {
            return ctx.packet(l2, { color: 'teal', dur: 300 });
          }).then(function () {
            return ctx.typeText(S.key, 'cas://sha256/9f3a…c1e0', 700);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: six data shards, three parity, three zones */
            ctx.hud('RS(6,3): 9 shards, any 6 rebuild the object');
            return ctx.reveal(b, { from: 'up' }).then(function () {
              return Promise.all(S.shards.map(function (sg, i) {
                return ctx.transform(sg, { x: 60 + az[i] * 238 + 14 + slot[i] * 70 + 6, y: 636 }, 700, 'inOut', i * 70);
              }));
            }).then(function () { return ctx.fade(slotG, 0.1, 400); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: lose a whole availability zone */
            ctx.hud('RS(6,3): 1.5× storage · survives one AZ loss');
            return Promise.all([ctx.fade(S.fail, 1, 400), setShard(2, true, 400), setShard(3, true, 400), setShard(7, true, 400)]).then(function () {
              paintStatus(false);
              return Promise.all([ctx.fade(S.failT, 1, 400), ctx.fade(S.ovhT, 1, 400)]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: TRY IT, fail shards by hand */
            ctx.hud('click a shard · any 3 of 9 may fail');
            S.shards.forEach(function (sg, i) {
              sg.style.cursor = 'pointer';
              sg.addEventListener('click', function () {
                if (ctx.dead) return;
                setShard(i, !S.dead[i], 250);
                paintStatus(true);
              });
            });
            rst.addEventListener('click', function () {
              if (ctx.dead) return;
              for (var q = 0; q < 9; q++) { S.dead[q] = false; ctx.fade(S.shards[q], 1, 250); }
              paintStatus(true);
            });
            return ctx.reveal(tryG, { from: 'up' }).then(function () { return ctx.wait(500); }).then(function () {
              /* demo: a fourth failure, then repair */
              setShard(0, true, 300); paintStatus(true);
              return ctx.pulse(shardBox(0), { color: 'red', dur: 700, parent: b });
            }).then(function () { return ctx.wait(700); }).then(function () {
              setShard(0, false, 300); paintStatus(true);
              return ctx.pulse(shardBox(0), { color: 'lime', dur: 600, parent: b });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: write-once upload */
            ctx.hud('write-once · conditional PUT · checksum');
            return ctx.reveal(c, { from: 'up' }).then(function () { return up.typeAll(); });
          }).then(function () { return ctx.beat(5); }).then(function () {
            /* beat 5: lifecycle tiers */
            ctx.hud('Standard $0.023 → Deep Archive $0.001 / GB-mo');
            return ctx.reveal(d, { from: 'up' }).then(function () { return ctx.transform(S.mark, { x: 1400 }, 1600, 'inOut'); });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Metadata & state',
        beats: [
          {
            say: 'Small, mutable, transactional facts live in a relational database: users, jobs, shots, and every take of every shot. Big blobs stay out; a row holds only the content address.',
            card: { tag: 'KEY IDEA', title: 'Rows for small mutable facts', body: 'Who asked, what the plan is, which shot is in which state. Postgres in one region, Spanner or CockroachDB when jobs span regions.' },
            deep: '<p>Small, mutable, <b>transactional</b> facts: who asked, what the plan is, which shot is in which state. The schema is a chain of one-to-many relations, <code>users → jobs → shots → takes</code>, so every question the orchestrator asks ("which takes of shot 3 exist, and which did the critic approve?") is an indexed join, not a scan.</p>' +
              '<span class="muted">Keep large blobs out of rows (store <code>cas://</code> URIs) and keep plans as <code>jsonb</code> so the planner can evolve its schema without migrations.</span>'
          },
          {
            say: 'Shot three moves through a state machine: planned, queued, rendering, rendered, review, approved. If the critic rejects a take, the shot goes back to queued and the loop runs again.',
            card: { tag: 'HOW IT WORKS', title: 'A shot is a state machine', body: 'Only legal transitions are allowed. A rejection is not a dead end: it is an edge back to <b>queued</b>, with a new take row.' },
            deep: '<p>The legal transitions are a small relation, enforced by a transition table or a <code>CHECK</code> on <code>(old, new)</code>:</p>' +
              '<table><tr><th>Transition</th><th>Triggered by</th></tr>' +
              '<tr><td>planned → queued</td><td>orchestrator schedules the shot</td></tr>' +
              '<tr><td>queued → rendering</td><td>GPU worker claims it (CAS)</td></tr>' +
              '<tr><td>rendering → rendered</td><td>worker commits the take</td></tr>' +
              '<tr><td>rendered → review</td><td>critic picks it up</td></tr>' +
              '<tr><td>review → approved | rejected</td><td>critic verdict</td></tr>' +
              '<tr><td>rejected → queued</td><td>retry with a new seed</td></tr></table>' +
              '<p>The workflow engine keeps the same machine in its event history; the row is its queryable projection.</p>'
          },
          {
            say: 'Each transition is a compare and set on a version number. A worker claims a shot with an update that only matches if the state is still queued and the version is still seven, so two workers can never both claim the same render.',
            card: { tag: 'PITFALL', title: 'Duplicate renders are the costly bug', body: 'A render is roughly 100 to 1,000 GPU-seconds. Without compare-and-set, one retry storm can bill the same shot twice.',
              more: '<p>The mirror-image failure is a worker that claims a shot and then dies: the row stays in <code>rendering</code> forever. Real systems add a <b>lease</b>: the claim stamps a heartbeat, the worker refreshes it, and a reaper re-queues rows whose heartbeat is older than the lease, bumping <code>version</code> so the zombie\'s late commit is rejected.</p>' },
            deep: '<p><b>Optimistic concurrency</b>: each shot row carries a <code>version</code>; workers claim work with a compare-and-set <code>UPDATE … WHERE state = \'queued\' AND version = 7</code>. Zero rows updated ⇒ someone else won ⇒ do not render twice (a render is ~10<sup>2</sup>–10<sup>3</sup> GPU-seconds, so duplicate work is the expensive failure).</p>' +
              '<p>Why exactly one worker wins: in Postgres READ COMMITTED the second <code>UPDATE</code> blocks on the row lock, then re-evaluates its <code>WHERE</code> against the new row version and matches nothing. For queue-style claims, <code>SELECT … FOR UPDATE SKIP LOCKED</code> gives the same guarantee without waiting.</p>'
          },
          {
            say: 'The state change and its event row commit in one transaction. That is the outbox pattern: the database and the event log can never disagree, because the log is fed from the same commit.',
            card: { tag: 'HOW IT WORKS', title: 'Outbox: one commit, two facts', body: 'Insert the event into an outbox table in the same transaction; a relay tails the write-ahead log and publishes it. No dual-write bug.' },
            deep: '<p><b>Transactional outbox</b>: the state change and the event row commit atomically; a CDC relay (logical decoding, Debezium) tails the write-ahead log and publishes to the event log. This removes the dual-write bug.</p>' +
              '<details><summary>Go deeper</summary><p>Without an outbox there are two failure orders. <i>Commit, then publish</i>: a crash in between loses the event, so the log says the shot is still queued. <i>Publish, then commit</i>: a rollback leaves a phantom event for a state that never existed. The outbox turns two writes into one atomic write plus an at-least-once relay, so consumers must dedupe on <code>event_id</code> (next step).</p></details>'
          },
          {
            say: 'The commit itself is acknowledged only once a majority of replicas in different zones have it. Within one region that costs a few milliseconds at most, and a leader failure never loses an acknowledged write.',
            card: { tag: 'NUMBERS', title: 'Majority commit', stat: { v: '2 of 3', l: 'replica acknowledgements before COMMIT returns; cross-zone round trip assumed at 0.5 to 2 ms' } },
            deep: '<p><b>Replication</b>: a write commits when a majority of replicas ack (Raft/Paxos, or a Postgres synchronous standby quorum). With 2f+1 replicas the group survives f failures; here f = 1 of 3. Spanner also waits out clock uncertainty so commit timestamps respect real time:</p>' +
              '<div class="eq">s = TT.now().latest;  commit-wait until TT.after(s)  ⇒  expected wait ≥ 2ε̄</div>' +
              '<p>ε was 1–7 ms in the 2012 paper (a sawtooth from a 30 s poll interval and 200 μs/s drift, plus ~1 ms of communication delay; ε̄ ≈ 4 ms most of the time), and the wait typically overlaps the Paxos round. AWS describes links between availability zones as single-digit milliseconds, so the 0.5–2 ms round trip drawn here is a planning assumption.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [1]);
          /* schema */
          var a = ctx.group({ parent: g });
          var sh = head(ctx, a, 60, 318, 'SCHEMA (simplified)', 'blue');
          function card(x, y, name, cols) {
            var gc = ctx.group({ parent: a });
            ctx.rect(x, y, 310, 118, { rx: 8, fill: 'rgba(8,16,32,0.9)', stroke: ctx.alpha('blue', 0.6), sw: 1.2, parent: gc });
            ctx.rect(x, y, 310, 26, { rx: 8, fill: ctx.alpha('blue', 0.16), parent: gc });
            txt(ctx, x + 12, y + 13.5, name, { size: 14, font: 'mono', weight: 700, color: lift(ctx, 'blue'), parent: gc });
            cols.forEach(function (s, k) { txt(ctx, x + 12, y + 44 + k * 19, s, { size: 12, font: 'mono', color: 'text', parent: gc }); });
            hide(gc);
            return { g: gc, box: { x: x, y: y, w: 310, h: 118, cx: x + 155, cy: y + 59, l: x, r: x + 310, t: y, b: y + 118 } };
          }
          var cu = card(60, 336, 'users', ['id uuid PK · region', 'plan · quota_gpu_s', 'consent_train bool', 'created_at']);
          var cj = card(410, 336, 'jobs', ['id PK · user_id FK', 'status enum', 'budget_gpu_s · spent', 'plan_dag jsonb']);
          var cs = card(410, 474, 'shots', ['id PK · job_id FK · idx', 'state enum', 'version int  (CAS)', 'spec jsonb (prompt, cam)']);
          var ct = card(60, 474, 'takes', ['id PK · shot_id FK', 'blob_uri cas://…', 'seed · model_ver · cfg', 'critic_score real']);
          var relL = [], relT = [];
          [[cu, cj, 'r', 'l', 390, 380, 'middle'], [cj, cs, 'b', 't', 575, 464, 'start'], [cs, ct, 'l', 'r', 390, 518, 'middle']].forEach(function (e) {
            relL.push(ctx.link(e[0], e[1], { from: e[2], to: e[3], color: ctx.alpha('blue', 0.8), straight: true, parent: a }));
            relT.push(txt(ctx, e[4], e[5], '1:N', { size: 11, font: 'mono', color: lift(ctx, 'blue'), anchor: e[6], parent: a }));
          });
          hide(sh, relL, relT);
          /* replication */
          var r = ctx.group({ parent: g });
          head(ctx, r, 60, 628, 'REPLICATED COMMIT', 'blue');
          var ld = ctx.node({ x: 150, y: 730, w: 160, h: 56, title: 'Leader', sub: 'AZ-a', icon: 'db', color: 'blue', titleSize: 14, parent: r });
          var f1 = ctx.node({ x: 400, y: 680, w: 160, h: 50, title: 'Follower', sub: 'AZ-b', color: 'blue', titleSize: 14, parent: r });
          var f2 = ctx.node({ x: 400, y: 790, w: 160, h: 50, title: 'Follower', sub: 'AZ-c', color: 'blue', titleSize: 14, parent: r });
          var r1 = ctx.link(ld, f1, { color: 'blue', parent: r }), r2 = ctx.link(ld, f2, { color: 'blue', parent: r });
          para(ctx, 510, 690, ['commit = majority (2/3) ack', 'in-region RTT ≈ 0.5–2 ms', 'Spanner: + TrueTime wait', 'Postgres: sync standby'], { size: 12, font: 'mono', color: 'dim', lh: 22, parent: r });
          hide(r);
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
          txt(ctx, 1250, 492, 'critic rejects → re-queue', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: m });
          S.tok = ctx.group({ parent: m });
          ctx.circle(0, 0, 8, { fill: 'magenta', parent: S.tok, glow: true });
          ctx.place(S.tok, pos[0].x, pos[0].y - 26);
          hide(m);
          /* SQL, typed in two halves */
          var q = ctx.group({ parent: g });
          var SQL = ['BEGIN;',
            "UPDATE shots SET state='rendering', version=version+1",
            "  WHERE id=3 AND state='queued' AND version=7;  -- 1 row: ours",
            'INSERT INTO outbox(topic, key, payload)',
            "  VALUES ('job-events', 'job42', '{\"shot\":3,\"to\":\"rendering\"}');",
            'COMMIT;  -- state + event in ONE atomic write'];
          S.sql = code(ctx, { x: 800, y: 520, w: 740, title: 'worker claims shot 3 (optimistic concurrency + outbox)', lang: 'text', size: 13, parent: q, typing: true, lines: SQL });
          var lose = txt(ctx, 800, 740, '0 rows updated → another worker won → re-read, never render twice', { size: 12, font: 'mono', color: 'amber', parent: q });
          var relay = lbl(ctx, 800, 780, 'outbox row → CDC relay → event log (next)', { color: 'magenta', size: 12, anchor: 'start', parent: q });
          hide(q, lose, relay);

          /* beat 0: the schema */
          ctx.hud('users → jobs → shots → takes · all ACID');
          return Promise.all([ctx.reveal(sh), ctx.reveal([cu.g, cj.g, cs.g, ct.g], { from: 'up', stagger: 130 })]).then(function () {
            return Promise.all([ctx.reveal(relL, { from: 'draw', stagger: 100 }), ctx.reveal(relT, { delay: 200, stagger: 100 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: shot 3 walks the state machine, including one rejection */
            ctx.hud('shot 3 state machine · reject → re-queue');
            var chain = ctx.reveal(m, { from: 'up' });
            [1, 2, 3, 4, 'rej', 1, 2, 3, 4, 5].forEach(function (k) {
              chain = chain.then(function () { return ctx.transform(S.tok, { x: pos[k].x, y: pos[k].y - 26 }, 380, 'inOut'); });
            });
            return chain;
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: compare-and-set claim */
            ctx.hud('claim = compare-and-set on version');
            ctx.reveal(q, { from: 'up' });
            return SQL.slice(0, 3).reduce(function (p, s) { return p.then(function () { return S.sql.addLine(s); }); }, Promise.resolve()).then(function () {
              return ctx.reveal(lose, { from: 'left' });
            }).then(function () { return ctx.pulse(S.sql, { color: 'amber', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: outbox insert and commit */
            ctx.hud('state + event = one atomic commit');
            return SQL.slice(3).reduce(function (p, s) { return p.then(function () { return S.sql.addLine(s); }); }, Promise.resolve()).then(function () {
              return ctx.reveal(relay, { from: 'left' });
            }).then(function () { return ctx.pulse(S.sql, { color: 'magenta', dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: replicated commit */
            ctx.hud('commit = 2 of 3 acks · RTT ≈ 0.5–2 ms');
            return ctx.reveal(r, { from: 'up' }).then(function () {
              return Promise.all([ctx.packet(r1, { color: 'blue', dur: 600, label: 'append' }), ctx.packet(r2, { color: 'blue', dur: 600 })]);
            }).then(function () {
              return Promise.all([ctx.packet(r1, { color: 'lime', dur: 500, reverse: true, label: 'ack' }), ctx.packet(r2, { color: 'lime', dur: 700, reverse: true })]);
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'The event log',
        beats: [
          {
            say: 'The event log is the memory of what happened. It is a topic split into partitions, and each partition is an append only sequence: events are added at the end and never edited.',
            card: { tag: 'KEY IDEA', title: 'History as an append-only log', body: 'The database holds the current state; the log holds how it got there. Nothing is edited in place, so any past state can be rebuilt.' },
            deep: '<p>An append-only, partitioned, replicated log. Each partition is a sequence of records addressed by a monotonically increasing <b>offset</b>: producers only append, consumers only read forward from an offset they choose.</p>' +
              '<p>It is fast because it is sequential: appends go to the tail of a segment file, reads are served from the page cache or by zero-copy <code>sendfile</code>, so caught-up consumers cause almost no disk reads. Busy topics run tens to hundreds of partitions, each replicated 3× with <code>min.insync.replicas=2</code>, so a broker can die without losing an acknowledged event.</p>'
          },
          {
            say: 'Every event for job forty two is keyed by its job id, so it always lands in the same partition and keeps a total order: plan, tool call, render, critic verdict, re-render.',
            card: { tag: 'HOW IT WORKS', title: 'Key by job id for per-job order', body: 'Order is guaranteed only within a partition, so the key decides what stays ordered. Thousands of jobs still spread across partitions in parallel.' },
            deep: '<div class="eq">partition = murmur2(key) mod P, &nbsp; key = job_id</div>' +
              '<p>Order is guaranteed only <i>within</i> a partition, so keying by <code>job_id</code> gives each job a total order of events while thousands of jobs scale out across partitions.</p>' +
              '<p><b>Pitfalls</b>: a hot key (one giant job) pins one partition and cannot be split; and raising P later remaps keys, so a running job can see new events land in a different partition and lose its ordering. Size P for peak load, not for today.</p>'
          },
          {
            say: 'Three independent consumer groups read the same log at their own pace: the orchestrator for replay, a fan out that streams progress to the creator, and a lakehouse sink that feeds analytics.',
            card: { tag: 'HOW IT WORKS', title: 'One log, three readers', body: 'Each group keeps its own committed offset, so a slow reader never blocks a fast one, and readers can be added without touching producers.' },
            deep: '<p><b>Consumer groups</b> keep their own committed offsets in an internal compacted topic. Within a group each partition is read by exactly one consumer, so parallelism is capped by P; across groups every event reaches every group.</p>' +
              '<ul><li><b>A</b> orchestrator: rebuilds job state after a restart by replaying from its checkpoint.</li>' +
              '<li><b>B</b> SSE fan-out: turns events into progress messages for the creator\'s browser.</li>' +
              '<li><b>C</b> lakehouse sink: writes Iceberg tables for analytics and training data.</li></ul>' +
              '<p>Rebalances are the operational cost: the classic protocol relies on a group-wide synchronization barrier, so one member joining or leaving disturbs every consumer, whereas the next-generation protocol (KIP-848, generally available in Kafka 4.0) lets the broker drive assignments and each client reconcile incrementally, so unaffected consumers keep reading.</p>'
          },
          {
            say: 'As events keep arriving, the readers advance. The lakehouse sink lags behind: the gap between the end of the log and its committed offset is the consumer lag, the first number to alert on.',
            card: { tag: 'NUMBERS', title: 'Consumer lag', stat: { v: '6', u: 'events', l: 'lag of group C: log end offset 14 minus committed offset 8' } },
            deep: '<div class="eq">lag = log-end offset − committed offset</div>' +
              '<p>Here group C has lag 14 − 8 = 6. Offset lag is only a proxy; what users feel is <b>time lag</b>, the age of the oldest unprocessed event, because a lag of 6 is nothing at 10<sup>4</sup> events/s and an eternity at one event a minute. By Little\'s law the backlog is arrival rate × delay: a 6 s delay at 2,000 events/s is 12,000 queued events.</p>' +
              '<p>Alert on lag that is <i>growing</i> (consumer slower than producer), not on its absolute value.</p>'
          },
          {
            say: 'Delivery is at least once by default, so consumers must be idempotent and dedupe on the event id. Old segments tier off to object storage, and a brand new group started at offset zero can rebuild any view: dashboards, search indexes, training sets.',
            card: { tag: 'PITFALL', title: 'At-least-once means duplicates', body: 'A crash between processing and the offset commit replays events. Make every consumer idempotent: dedupe on event_id, or use transactions.',
              more: '<p>The cheapest idempotent consumer writes its result and the <code>event_id</code> in one database transaction with <code>INSERT … ON CONFLICT (event_id) DO NOTHING</code>, and commits the Kafka offset only afterwards. A replay then hits the conflict and does nothing, so the effect happens exactly once even though delivery happened twice.</p>' },
            deep: '<ul><li><b>Delivery</b>: at-least-once by default ⇒ consumers must be idempotent (dedupe on <code>event_id</code>). Kafka EOS (idempotent producer + transactions, KIP-98) gives exactly-once for read-process-write inside Kafka; side effects outside it still need idempotency.</li>' +
              '<li><b>Retention</b>: days on broker disks; tiered storage (KIP-405) moves old segments to object storage, so replaying months of agent traces is cheap.</li>' +
              '<li><b>Replay</b>: a new consumer group starting at offset 0 can rebuild any derived view: dashboards, search indexes, training datasets.</li></ul>' +
              '<div class="note">DB = current state; log = history. The outbox makes both come from the same transaction, so they never disagree.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [2]);
          var hd = head(ctx, g, 330, 340, 'topic job-events · partition = murmur2(job_id) mod P   (P = 3 here, many more in production)', 'magenta');
          var prod = ctx.node({ x: 150, y: 540, w: 190, h: 70, title: 'Outbox relay', sub: 'CDC · Debezium', icon: 'queue', color: 'magenta', titleSize: 15, parent: g });
          var PY = [440, 540, 640], X0 = 350, CW = 38;
          var fill = [6, 7, 5];
          var r = ctx.rng(41);
          var dimC = ['blue', 'violet', 'orange', 'cyan'];
          var parts = ctx.group({ parent: g });
          PY.forEach(function (y, p) {
            txt(ctx, 325, y, 'p' + p, { size: 14, font: 'mono', color: p === 1 ? lift(ctx, 'magenta') : 'dim', anchor: 'middle', weight: 700, parent: parts });
            ctx.link(prod, { x: 306, y: y }, { from: 'r', color: ctx.alpha('magenta', 0.5), sw: 1.2, parent: parts });
            for (var k = 0; k < 20; k++) {
              var filled = k < fill[p];
              var col = dimC[Math.floor(r() * 4)];
              if (p === 1 && k >= 3 && filled) col = 'magenta';
              ctx.rect(X0 + k * CW, y - 20, CW - 4, 40, { rx: 4, fill: filled ? ctx.alpha(col, 0.3) : 'rgba(255,255,255,0.02)', stroke: filled ? ctx.alpha(col, 0.7) : ctx.alpha('white', 0.08), sw: 1, parent: parts });
            }
          });
          txt(ctx, X0 + 20 * CW - 4, 688, 'offset →', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: parts });
          hide(hd, prod, parts);
          /* new events for jobs 42 (p1), 17 (p0) and 88 (p2), revealed one by one in beat 1 */
          var EV = [[42, 'plan'], [17], [42, 'tool'], [42, 'rend'], [88], [42, 'done'], [17], [42, 'crit'], [88], [42, 'redo'], [42, 'ok'], [17]];
          var head2 = fill.slice();
          var cells = EV.map(function (e) {
            var p = e[0] === 42 ? 1 : (e[0] === 17 ? 0 : 2);
            var col = e[0] === 42 ? 'magenta' : (e[0] === 17 ? 'blue' : 'violet');
            var k = head2[p]++;
            var cell = ctx.group({ parent: parts });
            ctx.rect(X0 + k * CW, PY[p] - 20, CW - 4, 40, { rx: 4, fill: ctx.alpha(col, e[0] === 42 ? 0.55 : 0.4), stroke: col, sw: 1.3, parent: cell });
            if (e[1]) txt(ctx, X0 + k * CW + (CW - 4) / 2, PY[p], e[1], { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: cell });
            cell.setAttribute('opacity', 0);
            return cell;
          });
          /* one event (JSON) */
          var bt = ctx.group({ parent: g });
          var ev = code(ctx, { x: 60, y: 715, w: 700, title: 'one event (value), key = "job42"', lang: 'json', size: 13, parent: bt, typing: true, lines: [
            '{"event_id":"01J9ZK…","type":"tool_call.completed",',
            ' "job":"job42","shot":3,"tool":"render_shot","take":"3b",',
            ' "blob":"cas://sha256/9f3a…","gpu_s":742,',
            ' "ts":"2026-09-28T10:14:03Z"}'
          ] });
          hide(bt);
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
          hide(cg);
          /* committed-offset markers on p1 */
          S.marks = cons.map(function (c, i) {
            var mg = ctx.group({ parent: g });
            ctx.poly([[0, 0], [-7, 11], [7, 11]], { fill: c[2], parent: mg });
            txt(ctx, 0, 21, 'ABC'.charAt(i), { size: 12, font: 'mono', color: lift(ctx, c[2]), anchor: 'middle', weight: 700, parent: mg });
            ctx.place(mg, X0 - 2 + [5, 4, 2][i] * CW, 564);
            mg.setAttribute('opacity', 0);
            return mg;
          });
          /* which job hashes to which partition (legend for the coloured events) */
          var jobs = ctx.group({ parent: g });
          [['job 17 → p0', 'blue', 350], ['job 42 → p1', 'magenta', 490], ['job 88 → p2', 'violet', 630]].forEach(function (j) {
            lbl(ctx, j[2], 394, j[0], { color: j[1], size: 12, anchor: 'start', parent: jobs });
          });
          hide(jobs);
          /* the lag of group C on p1: a band from its committed offset (8) to the log end (14) */
          S.lagG = ctx.group({ parent: g });
          ctx.rect(X0 + 8 * CW - 3, PY[1] - 25, 6 * CW + 2, 50, { rx: 6, fill: ctx.alpha('teal', 0.14), stroke: 'teal', sw: 1.5, dash: '5 4', parent: S.lagG });
          S.lagT = lbl(ctx, X0 + 8 * CW + 3 * CW - 2, PY[1] - 44, 'lag(C) = 14 − 8 = 6 events', { color: 'teal', size: 12, bg: '#08151c', parent: S.lagG });
          hide(S.lagG);
          var gu = para(ctx, 820, 738, ['order: total per partition → key by job_id', 'delivery: at-least-once → dedupe on event_id', 'EOS: idempotent producer + transactions', 'retention: days on brokers, tiered to object store', 'replay: new group from offset 0 rebuilds any view'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: g });
          hide(gu);

          /* beat 0: partitions, append-only */
          ctx.hud('append-only · offsets never change');
          return Promise.all([ctx.reveal(hd), ctx.reveal(prod, { from: 'left' }), ctx.reveal(parts, { delay: 200 })]).then(function () {
            return ctx.pulse(prod, { color: 'magenta', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: keyed appends, one job stays in one partition */
            ctx.hud('murmur2(job_id) mod P · order per job');
            var chain = ctx.wait(300);
            ctx.reveal(jobs, { from: 'down', dist: 10 });
            cells.forEach(function (cell) { chain = chain.then(function () { return ctx.reveal(cell, { from: 'left', dur: 260, dist: 16 }); }); });
            ctx.reveal(bt, { from: 'up' });
            return Promise.all([ev.typeAll(), chain]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: three consumer groups with their own offsets */
            ctx.hud('one log · three independent offsets');
            return Promise.all([ctx.reveal(cg, { from: 'right' }), ctx.reveal(S.marks, { from: 'down', delay: 300, stagger: 150 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: readers advance, group C lags */
            ctx.hud('lag = log end − committed offset');
            var fin = [14, 13, 8];
            return Promise.all(S.marks.map(function (mg, i) {
              return ctx.transform(mg, { x: X0 - 2 + fin[i] * CW }, 900, 'inOut', i * 150);
            })).then(function () {
              return ctx.reveal(S.lagG, { dur: 350 });
            }).then(function () { return ctx.pulse(S.cons[2], { color: 'teal', dur: 600 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: delivery, retention, replay */
            ctx.hud('at-least-once → dedupe on event_id');
            return ctx.reveal(gu, { from: 'up' }).then(function () {
              return S.cons.reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, { dur: 450 }); }); }, Promise.resolve());
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Caches & limits',
        beats: [
          {
            say: 'The cache tier holds state that is fast but disposable: sessions, rate limit buckets, idempotency keys and leases. Losing Redis costs latency, never correctness.',
            card: { tag: 'KEY IDEA', title: 'Fast, disposable, reconstructible', body: 'Everything in Redis can be rebuilt from Postgres or the event log. If the cache dies, requests get slower; nothing is lost.' },
            deep: '<p>Redis/Valkey holds <b>ephemeral, reconstructible</b> state: sessions, rate-limit buckets, idempotency keys, leases, and cache-aside copies of hot rows. Every key has a TTL and a rule to rebuild it. (Valkey is the BSD-licensed fork of Redis 7.2.4, maintained under the Linux Foundation since 2024.)</p>' +
              '<p>Commands execute on a single main thread per shard, so each command and each Lua script is atomic without locks. The next beats lean on exactly that property.</p>' +
              '<span class="muted">Idempotency keys are the borderline case: Redis absorbs retries cheaply, and a unique constraint in Postgres is the backstop if a key is ever lost.</span>'
          },
          {
            say: 'A token bucket per user decides whether a render request is admitted. A burst drains the bucket, and once it is empty the seventh and eighth requests get a four twenty nine, too many requests.',
            card: { tag: 'HOW IT WORKS', title: 'Token bucket: burst, then refuse', body: 'Capacity B = 6 tokens, refill r = 0.5 per second. Every request costs one token; an empty bucket answers HTTP 429 with a Retry-After header.' },
            deep: '<div class="eq">tokens ← min(B, tokens + r·(now − ts)); &nbsp;admit ⇔ tokens ≥ 1</div>' +
              '<p>Run as one Lua script (atomic on one shard) or as GCRA, which needs a single timestamp per key. With B = 6 and r = 0.5/s, a burst of 8 requests in 1.4 s admits 6 and rejects 2 with <code>429 Retry-After</code>; the header says when the next token exists, (1 − tokens)/r = 0.8 s after the seventh request.</p>'
          },
          {
            say: 'The bucket refills at half a token per second, so patience is rewarded: at three and a half seconds, and again at six, requests pass. In production the bucket is charged in GPU seconds, because a final render can cost on the order of a hundred times a draft.',
            card: { tag: 'TRADE-OFF', title: 'Charge GPU-seconds, not requests', body: 'One 1080p shot can cost on the order of 100× a draft preview. Counting requests either starves creators or lets a few jobs eat the cluster.' },
            deep: '<p>Limits are on <i>GPU-seconds</i>, not just requests, because a 1080p shot can cost on the order of 100× a draft (more pixels, more denoising steps). The bucket is charged an <b>estimate</b> up front (resolution × frames × steps ÷ throughput) and reconciled with the metered cost when the render ends.</p>' +
              '<p>Buckets stack: requests per minute (abuse), concurrent renders (fairness), GPU-seconds per day (cost). Refill is lazy: nothing ticks, the next request computes what accrued since <code>ts</code>. In the trace, requests 9 and 10 pass because 2.1 s and 2.5 s of refill (1.05 and 1.25 tokens) had accrued.</p>'
          },
          {
            say: 'Now drive the bucket yourself. Press send request to spend a token. It refills live at half a token per second, and when it is empty the answer is a four twenty nine with the time to wait.',
            card: { tag: 'TRY IT', title: 'Spend tokens by hand', body: 'Click <b>send request</b> repeatedly: the bucket drains one token per click and refills at r = 0.5 per second. Empty means HTTP 429 and a <code>Retry-After</code>.' },
            deep: '<p>The same bucket as a single number (GCRA, the generic cell rate algorithm) keeps only a <i>theoretical arrival time</i> <code>tat</code>:</p>' +
              '<div class="eq">admit ⇔ now ≥ tat − τ, &nbsp; tat ← max(now, tat) + T, &nbsp; T = 1/r, &nbsp; τ = (B−1)·T</div>' +
              '<p>One integer per key, one atomic Lua call, and no background refill. Take <code>now</code> from the server clock (<code>TIME</code> inside the script), never from clients, and shard keys by user so one hot tenant cannot saturate a shard. Sliding-window logs are exact but cost O(requests) memory per key; the bucket costs O(1).</p>'
          },
          {
            say: 'Hot rows are read cache aside. The service asks Redis first; on a miss it reads Postgres and back-fills Redis with a short time to live, and the next reads are hits.',
            card: { tag: 'HOW IT WORKS', title: 'Cache-aside: miss, fill, hit', body: 'The application owns the cache logic. Writes delete the key after commit, and a 60 second TTL bounds how stale any copy can get.' },
            deep: '<pre>def read(key):\n  v = redis.get(key)\n  if v: return v      # hit\n  v = db.select(key)  # miss\n  redis.set(key, v,\n            ex=60 + jitter)\n  return v\n\ndef write(key, v):\n  db.update(key, v)   # commit\n  redis.delete(key)   # invalidate</pre>' +
              '<p>Delete after commit; never update the cache in place, or two racing writers can leave the older value cached. Add TTL <i>jitter</i> and single-flight so a hot key that expires does not send every worker to the database at once (cache stampede).</p>'
          },
          {
            say: 'At a ninety five percent hit ratio the average read drops below half a millisecond, and the database sees twenty times fewer reads.',
            card: { tag: 'NUMBERS', title: 'Expected read latency', stat: { v: '0.45', u: 'ms', l: 'at a 95% hit ratio (hit 0.3 ms, database 3 ms); the database sees 20× fewer reads' } },
            deep: '<div class="eq">E[L] = h·t<sub>hit</sub> + (1−h)(t<sub>hit</sub> + t<sub>db</sub>)</div>' +
              '<p>= t<sub>hit</sub> + (1−h)·t<sub>db</sub>: with t<sub>hit</sub> = 0.3 ms, t<sub>db</sub> = 3 ms, h = 0.95 ⇒ 0.45 ms, and the database sees (1−h) = 5% of the reads, 20× fewer.</p>' +
              '<p>The mean hides the tail: while more than 1% of reads miss, the p99 is a database read (≥ 3.3 ms). Invalidate on write and keep TTLs short to bound staleness.</p>'
          },
          {
            say: 'One more use is leases. A lock with a time to live is not enough, because a paused holder can wake up after the lease expired. The storage write must check a fencing token that only ever increases.',
            card: { tag: 'PITFALL', title: 'A lease alone is not a lock', body: 'A GC pause or preemption can outlive the TTL. The old holder wakes, still believes it owns shot 3, and writes anyway. Fence the write.',
              more: '<p>Redlock (locks over several independent Redis nodes) is contested because its safety depends on bounded clock drift and process pauses. Use it only where a rare double-lock is harmless (efficiency). Where correctness matters, use a consensus-backed lock (etcd, ZooKeeper) and always fence at the resource.</p>' },
            deep: '<p><b>Leases</b>: <code>SET lock:shot:3 &lt;id&gt; NX PX 30000</code> is not enough alone: a paused holder (GC, preemption) can outlive its lease. Pair it with a monotonically increasing <b>fencing token</b> that the storage write checks: the resource keeps the highest token seen and rejects anything lower. Redis has no built-in token: take it from an <code>INCR</code> counter in the same Lua script as the <code>SET NX</code>, and remember that an asynchronous failover can lose the counter.</p>' +
              '<table><tr><th>t</th><th>Event</th><th>Storage max token</th></tr>' +
              '<tr><td>0 s</td><td>A acquires, token 1186</td><td>–</td></tr>' +
              '<tr><td>30 s</td><td>lease expires; B acquires, token 1187</td><td>–</td></tr>' +
              '<tr><td>31 s</td><td>B writes with 1187</td><td>1187</td></tr>' +
              '<tr><td>40 s</td><td>A wakes, writes with 1186</td><td>rejected</td></tr></table>' +
              '<span class="muted">LLM prefix/KV caches and encoded-latent caches live on the GPU tier (HBM, host RAM, NVMe), not in Redis.</span>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [3]);
          /* keyspace */
          var ksg = ctx.group({ parent: g });
          var ks = code(ctx, { x: 60, y: 690, w: 1480, title: 'redis keyspace (per region, per tenant prefix)', lang: 'text', size: 13, parent: ksg, typing: true, lines: [
            'session:{sid}          HASH    TTL 24h     auth claims, active job, UI cursor',
            'rl:{user}:render       HASH    TTL 60s     token bucket {tokens, ts} · also rl:{user}:gpu_s',
            'idem:{request_key}     STRING  TTL 24h     dedupe retried POST /jobs → same job_id',
            'lock:shot:3            STRING  PX 30000    lease holder + fencing token 1187',
            'cache:shot:3           STRING  TTL 60s     cache-aside copy of the SQL row (deleted on write)'
          ] });
          hide(ksg);
          /* token bucket */
          var tb = ctx.group({ parent: g });
          head(ctx, tb, 60, 340, 'RATE LIMIT · token bucket / user', 'teal');
          ctx.rect(100, 380, 150, 230, { rx: 10, fill: 'rgba(255,255,255,0.02)', stroke: 'teal', sw: 1.6, parent: tb });
          var B = 6, R = 0.5;
          S.lvl = ctx.rect(104, 384, 142, 222, { rx: 7, fill: ctx.alpha('teal', 0.35), parent: tb });
          S.lvlT = txt(ctx, 175, 495, '6.0', { size: 22, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: tb });
          txt(ctx, 175, 522, 'tokens', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: tb });
          txt(ctx, 60, 638, 'B = 6 · r = 0.5 req/s', { size: 13, font: 'mono', color: 'text', parent: tb });
          txt(ctx, 60, 660, 'atomic Lua script (EVALSHA)', { size: 12, font: 'mono', color: 'dim', parent: tb });
          function setLvl(v) {
            if (!isFinite(v)) v = 0;
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
          var rqT = res.map(function (e, i) {
            var y = 390 + i * 23;
            var t1 = txt(ctx, 290, y, 'r' + (i + 1) + '  t=' + e.t.toFixed(1) + 's', { size: 12, font: 'mono', color: 'text', parent: tb });
            var t2 = txt(ctx, 440, y, e.ok ? '✓' : '429', { size: 12, font: 'mono', weight: 700, color: e.ok ? 'lime' : 'red', anchor: 'end', parent: tb });
            hide(t1, t2);
            return [t1, t2];
          });
          var gpuL = lbl(ctx, 290, 628, 'cost in GPU-s, not requests', { color: 'amber', size: 11, anchor: 'start', parent: tb });
          /* TRY IT: a live bucket (refills in real time, one token per click) */
          var live = { on: false, tok: 0, t0: -9, now: 0 };
          var reqBtn = lbl(ctx, 300, 664, '▶ send request', { color: 'lime', size: 12, anchor: 'start', bg: '#0a1a12', parent: tb });
          reqBtn.style.cursor = 'pointer';
          var toastT = txt(ctx, 452, 664, '', { size: 12, font: 'mono', weight: 700, color: 'lime', anchor: 'start', parent: tb });
          hide(reqBtn, gpuL, toastT, tb);
          function spend() {
            if (!isFinite(live.tok)) live.tok = 0;
            if (live.tok >= 1) { live.tok -= 1; toastT.textContent = '✓ admitted'; toastT.setAttribute('fill', ctx.color('lime')); }
            else { toastT.textContent = '429 · Retry-After ' + ((1 - live.tok) / R).toFixed(1) + ' s'; toastT.setAttribute('fill', ctx.color('red')); }
            live.t0 = live.now;
            setLvl(live.tok);
          }
          reqBtn.addEventListener('click', function () { if (!ctx.dead && live.on) spend(); });
          function runReq(i) {
            var e = res[i], prev = i === 0 ? B : res[i - 1].post;
            return ctx.tween(i >= 8 ? 420 : 160, function (k) { setLvl(prev + (e.pre - prev) * k); }).then(function () {
              ctx.reveal(rqT[i], { dur: 200, stagger: 0 });
              return ctx.tween(140, function (k) { setLvl(e.pre + (e.post - e.pre) * k); });
            });
          }
          /* cache-aside */
          var ca = ctx.group({ parent: g });
          head(ctx, ca, 520, 340, 'CACHE-ASIDE READ', 'teal');
          var api = ctx.node({ x: 600, y: 480, w: 150, h: 58, title: 'API', sub: 'job service', icon: 'server', color: 'blue', titleSize: 14, parent: ca });
          var rd = ctx.node({ x: 900, y: 410, w: 190, h: 58, title: 'Redis', sub: 'p50 ≈ 0.3 ms', icon: 'bolt', color: 'teal', titleSize: 14, parent: ca });
          var pg = ctx.node({ x: 900, y: 560, w: 190, h: 58, title: 'Postgres', sub: 'p50 ≈ 3 ms', icon: 'db', color: 'blue', titleSize: 14, parent: ca });
          var lr = ctx.link(api, rd, { from: 'r', to: 'l', color: 'teal', parent: ca });
          var lp = ctx.link(api, pg, { from: 'r', to: 'l', color: 'blue', parent: ca });
          S.hitT = txt(ctx, 580, 640, 'hits 0 · misses 0', { size: 13, font: 'mono', color: 'text', parent: ca });
          hide(ca);
          var hits = 0, miss = 0;
          function upd() { S.hitT.textContent = 'hits ' + hits + ' · misses ' + miss + (hits + miss ? '  (h = ' + (hits / (hits + miss)).toFixed(2) + ')' : ''); }
          /* effective latency plot */
          var pl = ctx.group({ parent: g });
          head(ctx, pl, 1110, 340, 'EFFECTIVE READ LATENCY', 'teal');
          var P = ctx.plot(1140, 380, 380, 220, function (h) { return 0.3 + (1 - h) * 3; }, { xDomain: [0.5, 1], yDomain: [0, 2], color: 'teal', yLabel: 'ms', parent: pl });
          txt(ctx, 1330, 616, 'hit ratio h', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pl });
          txt(ctx, 1140, 616, '0.5', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pl });
          txt(ctx, 1520, 616, '1.0', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pl });
          txt(ctx, 1132, 382, '2', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: pl });
          txt(ctx, 1132, 600, '0', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: pl });
          var pm = P.toPx(0.95, 0.45);
          S.pmark = ctx.group({ parent: pl });
          ctx.circle(pm.x, pm.y, 6, { fill: 'lime', parent: S.pmark, glow: true });
          ctx.line(pm.x, pm.y, pm.x, 600, { color: ctx.alpha('lime', 0.5), dash: '3 4', parent: S.pmark });
          txt(ctx, pm.x - 14, pm.y + 26, '0.45 ms @ h = 0.95', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: S.pmark });
          txt(ctx, 1110, 648, 'E[L] = h·t_hit + (1−h)·(t_hit + t_db)', { size: 13, font: 'mono', color: 'text', parent: pl });
          hide(pl, S.pmark);
          /* lease + fencing token: a small sequence diagram, shown in the last beat */
          var fz = ctx.group({ parent: g });
          var f0 = ctx.group({ parent: fz }), f1 = ctx.group({ parent: fz }), f2 = ctx.group({ parent: fz }), f3 = ctx.group({ parent: fz }), f4 = ctx.group({ parent: fz });
          head(ctx, f0, 60, 340, 'LEASE + FENCING TOKEN · a TTL alone is not a lock', 'amber');
          ctx.node({ x: 130, y: 410, w: 150, h: 44, title: 'Worker A', color: 'blue', titleSize: 13, glow: false, parent: f0 });
          ctx.node({ x: 130, y: 490, w: 150, h: 44, title: 'Worker B', color: 'magenta', titleSize: 13, glow: false, parent: f0 });
          ctx.node({ x: 130, y: 590, w: 150, h: 44, title: 'Storage', kind: 'cyl', color: 'teal', titleSize: 13, glow: false, parent: f0 });
          [410, 490, 590].forEach(function (y) { ctx.line(215, y, 1520, y, { color: 'faint', dash: '2 5', parent: f0 }); });
          txt(ctx, 430, 625, 'storage keeps the highest token seen (1187) and rejects any write with a lower one', { size: 12, font: 'mono', color: 'teal', parent: f0 });
          lbl(ctx, 430, 410, 'SET NX PX 30000 → token 1186', { color: 'lime', size: 12, bg: '#0a1a12', parent: f1 });
          ctx.rect(600, 398, 520, 24, { rx: 12, fill: '#0b1220', parent: f1 });
          ctx.rect(600, 398, 520, 24, { rx: 12, fill: ctx.alpha('red', 0.16), stroke: 'red', sw: 1.2, dash: '4 4', parent: f1 });
          txt(ctx, 860, 410, 'GC pause · preempted for 40 s', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: f1 });
          lbl(ctx, 760, 490, 'lease expired → SET NX → token 1187', { color: 'lime', size: 12, bg: '#0a1a12', parent: f2 });
          var w1 = ctx.link({ x: 1000, y: 490 }, { x: 1000, y: 572 }, { color: 'lime', sw: 2, straight: true, parent: f3 });
          lbl(ctx, 986, 530, 'write(token 1187) ✓', { color: 'lime', size: 12, anchor: 'end', bg: '#0a1a12', parent: f3 });
          txt(ctx, 1300, 378, 'A wakes up, still thinks it owns the lock', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: f4 });
          var w2 = ctx.link({ x: 1300, y: 410 }, { x: 1300, y: 572 }, { color: 'red', sw: 2, straight: true, parent: f4 });
          lbl(ctx, 1315, 530, 'rejected: 1186 < 1187', { color: 'red', size: 12, anchor: 'start', parent: f4 });
          hide(f0, f1, f2, f3, f4);

          /* beat 0: what lives in the cache tier */
          ctx.hud('Redis: ephemeral · TTL on every key');
          return ctx.reveal(ksg, { from: 'up' }).then(function () {
            return Promise.all([ks.typeAll(), ctx.pulse(S.st[3], { color: 'teal', times: 2, dur: 600 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: a burst drains the token bucket */
            ctx.hud('token bucket B = 6 · r = 0.5 per second');
            var p = ctx.reveal(tb, { from: 'up' }).then(function () { return ctx.wait(300); });
            for (var i = 0; i < 8; i++) (function (k) { p = p.then(function () { return runReq(k); }); })(i);
            return p;
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: refill; charge GPU-seconds */
            ctx.hud('admit by GPU-seconds, not by request count');
            var p = ctx.reveal(gpuL, { from: 'left' });
            for (var i = 8; i < 10; i++) (function (k) { p = p.then(function () { return runReq(k); }); })(i);
            return p;
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: TRY IT, a live bucket you can drain */
            ctx.hud('live bucket · refills 0.5 tokens per second');
            live.on = true;
            live.tok = res[res.length - 1].post;
            S.loops.push(ctx.loop(function (t, dt) {
              live.now = t;
              if (!live.on) return;
              var d = dt > 0 && dt < 1 ? dt : 0;          /* a bad or huge frame delta must never poison the bucket */
              live.tok = ctx.clamp((isFinite(live.tok) ? live.tok : 0) + R * d, 0, B);
              setLvl(live.tok);
              toastT.setAttribute('opacity', ctx.clamp(1 - (t - live.t0) / 1.8, 0, 1).toFixed(3));
            }));
            return ctx.reveal(reqBtn, { from: 'left' }).then(function () { return ctx.pulse(reqBtn, { color: 'lime', times: 2, dur: 600 }); }).then(function () {
              /* demo: spend the last token, then hit the empty bucket */
              spend();
              return ctx.wait(700);
            }).then(function () { spend(); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: cache-aside read, one miss then hits */
            ctx.hud('cache-aside: miss → DB → back-fill Redis');
            var cache = ctx.reveal(ca, { from: 'up' }).then(function () {
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
            return cache;
          }).then(function () { return ctx.beat(5); }).then(function () {
            /* beat 5: effective latency vs hit ratio */
            ctx.hud('h = 0.95 ⇒ E[read] = 0.45 ms · DB load ÷ 20');
            return Promise.all([ctx.reveal(pl, { from: 'up' }), ctx.reveal(P.curve, { from: 'draw', delay: 300, dur: 900 })]).then(function () {
              return ctx.reveal(S.pmark, { dur: 400 });
            });
          }).then(function () { return ctx.beat(6); }).then(function () {
            /* beat 6: leases need fencing tokens */
            ctx.hud('lease + fencing token: stale writes rejected');
            live.on = false;
            ctx.fade([tb, ca, pl], 0, 500);
            var hb = ctx.bbox(ks.lineEls[3]);
            var hi = ctx.rect(hb.x - 6, hb.y + 1.5, hb.w + 12, hb.h - 3, { rx: 3, fill: ctx.alpha('amber', 0.16), stroke: ctx.alpha('amber', 0.7), sw: 1, parent: g });
            hi.setAttribute('opacity', 0);
            ctx.reveal(hi, { dur: 300 });
            return ctx.reveal(f0, { from: 'up' }).then(function () { return ctx.reveal(f1, { from: 'left' }); })
              .then(function () { return ctx.reveal(f2, { from: 'left' }); })
              .then(function () { return ctx.reveal(f3, { from: 'up' }); })
              .then(function () { return ctx.packet(w1, { color: 'lime', dur: 500 }); })
              .then(function () { return ctx.reveal(f4, { from: 'up' }); })
              .then(function () { return ctx.packet(w2, { color: 'red', dur: 600 }); })
              .then(function () { return ctx.pulse(f4, { color: 'red', dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Vector memory',
        beats: [
          {
            say: 'Pixels cannot be searched with SQL. So every sketch, every keyframe of every take, and every script beat is passed through an encoder and stored as one vector in a shared image and text space.',
            card: { tag: 'KEY IDEA', title: 'Embed everything into one space', body: 'The image tower and the text tower share a space, so a sentence can retrieve a picture. The vector database stores id, vector and metadata.' },
            deep: '<p>Every sketch, reference, keyframe (e.g. 8 per take) and script beat is embedded into a shared image–text space: SigLIP 2 so400m/14 gives 1152-d vectors, CLIP ViT-L/14 768-d. The write path is an <code>upsert(id, vector, payload)</code>.</p>' +
              '<ul><li>The payload stores the <code>cas://</code> URI and shot/take ids; the vector DB never holds pixels.</li>' +
              '<li>Index freshness is eventual: a new keyframe becomes searchable once its upsert is indexed (ms to s).</li></ul>'
          },
          {
            say: 'In that space, distance means resemblance. The fox character sheets huddle together, the ice moon frames form their own cluster, and the style sketches sit apart.',
            card: { tag: 'HOW IT WORKS', title: 'Distance means resemblance', body: 'Vectors have unit length, so similarity is a dot product: the cosine of the angle. Nearby points look, or read, alike.' },
            deep: '<p>Vectors are L2-normalised, so cosine similarity is a dot product, and Euclidean distance carries the same ranking:</p>' +
              '<div class="eq">sim(q, x) = q·x / (‖q‖‖x‖) = q·x &nbsp; (‖q‖ = ‖x‖ = 1), &nbsp; ‖q − x‖² = 2 − 2 q·x</div>' +
              '<p>The map is a 2-D projection (UMAP or t-SNE style) of a 1152-d space, so it keeps neighbourhoods but distorts global distances: read clusters, not coordinates.</p>'
          },
          {
            say: 'When the camera agent prepares shot four, fox removes a cracked helmet, that sentence is embedded with the same model, and the vector database returns the nearest neighbours: the fox character sheet and the closest earlier takes.',
            card: { tag: 'NUMBERS', title: 'True matches score low', stat: { v: '< 0.4', l: 'typical raw cosine of a good CLIP-style match: the modality gap. Only the ranking is meaningful.' },
              more: '<p>The <i>modality gap</i> (Liang et al., NeurIPS 2022) is a geometric fact of contrastive models: image embeddings and text embeddings occupy two separate narrow cones on the sphere, and training preserves the offset between them. Matching pairs are closest <i>relative to</i> non-matching ones, not close in absolute terms. For scale, CLIP ViT-B/32 image–caption cosines span roughly 0 to 0.4, which is why the CLIPScore metric rescales them by 2.5.</p>' },
            deep: '<p>The query text goes through the text tower of the same model, and the database returns the top-k by inner product. Text-to-image cosines are small (CLIP ViT-B/32 image–caption scores span roughly 0 to 0.4, which is why CLIPScore rescales them by 2.5), a symptom of the "modality gap", so thresholds are calibrated per embedder and only the ranking is trusted.</p>' +
              '<ul><li>Pre-filter by <code>tenant_id</code>/<code>project_id</code>: isolation first, and it shrinks the search.</li>' +
              '<li>The query embed (~5 ms) and the ANN lookup (~1–10 ms) are the first-stage cost; with hybrid fusion and reranking the whole retrieval is budgeted at about 40 ms at p50, the figure the last step uses.</li></ul>'
          },
          {
            say: 'Those references are what keep the fox looking like the same fox. Per project the memory is thousands of vectors, but a platform wide library reaches a billion, over two terabytes raw. Click the memory map to zoom in and see how indexes make that searchable.',
            card: { tag: 'TRY IT', title: 'Zoom into the memory map', body: 'The dashed ring marks the vector memory. Click it to open HNSW, product quantisation, hybrid search and agent memory.' },
            deep: '<p>Per-project memory is small (10<sup>2</sup>–10<sup>4</sup> vectors ⇒ exact search is fine), but a platform-wide asset and style library reaches 10<sup>9</sup> vectors: at 1152-d fp16 that is ~2.3 TB raw, so ANN indexes (HNSW, IVF-PQ, DiskANN) and quantisation become mandatory.</p>' +
              '<div class="eq">10<sup>9</sup> × 1152 × 2 B ≈ 2.3 TB</div>' +
              '<div class="note">Zoom into <b>Vector Memory &amp; Retrieval</b> for HNSW, product quantisation, hybrid search, reranking and the agent memory taxonomy.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [4]);
          /* image side */
          var a = ctx.group({ parent: g });
          head(ctx, a, 60, 340, 'EMBED EVERYTHING INTO ONE SPACE');
          var ins = [['sketch_1', 'image', 'violet'], ['sketch_2', 'image', 'violet'], ['sketch_3', 'image', 'violet'], ['take3b kf×8', 'film', 'lime']];
          var enc = ctx.node({ x: 420, y: 470, w: 210, h: 64, title: 'Image tower', sub: 'SigLIP 2 · so400m', icon: 'eye', color: 'violet', titleSize: 14, parent: a });
          var inL = ins.map(function (d, i) {
            var y = 380 + i * 60;
            ctx.rect(60, y - 22, 170, 44, { rx: 6, fill: '#0d1a33', stroke: d[2], sw: 1.2, parent: a });
            ctx.icon(d[1], 84, y, 20, d[2], { parent: a });
            txt(ctx, 102, y, d[0], { size: 13, font: 'mono', color: 'text', parent: a });
            return ctx.link({ x: 230, y: y }, enc, { to: 'l', color: ctx.alpha('violet', 0.7), sw: 1.3, parent: a });
          });
          var r = ctx.rng(5);
          ctx.vector(545, 464, 12, { horizontal: true, cell: 10, gap: 2, cmap: 'diverge', parent: a, values: [Array.apply(null, Array(12)).map(function () { return r() * 2 - 1; })] });
          txt(ctx, 545, 500, '1152-d · ‖v‖=1', { size: 12, font: 'mono', color: 'dim', parent: a });
          txt(ctx, 545, 520, 'upsert(id, v, meta)', { size: 12, font: 'mono', color: 'teal', parent: a });
          var w1 = ctx.link({ x: 690, y: 469 }, { x: 772, y: 520 }, { color: 'teal', parent: a });
          hide(a);
          /* text side */
          var a2 = ctx.group({ parent: g });
          var tenc = ctx.node({ x: 420, y: 680, w: 210, h: 64, title: 'Text tower', sub: 'same space', icon: 'doc', color: 'violet', titleSize: 14, parent: a2 });
          lbl(ctx, 60, 680, '"fox removes cracked helmet"', { color: 'magenta', size: 12, anchor: 'start', w: 250, parent: a2 });
          var tq = ctx.link({ x: 310, y: 680 }, tenc, { to: 'l', color: ctx.alpha('magenta', 0.8), straight: true, parent: a2 });
          ctx.vector(545, 674, 12, { horizontal: true, cell: 10, gap: 2, cmap: 'diverge', parent: a2, values: [Array.apply(null, Array(12)).map(function () { return r() * 2 - 1; })] });
          txt(ctx, 545, 710, 'query vector q', { size: 12, font: 'mono', color: lift(ctx, 'magenta'), parent: a2 });
          var w2 = ctx.link({ x: 690, y: 679 }, { x: 772, y: 640 }, { color: 'magenta', parent: a2 });
          hide(a2);
          /* scatter map */
          var m = ctx.group({ parent: g });
          m.box = { x: 772, y: 330, w: 768, h: 530, cx: 1156, cy: 595, l: 772, r: 1540, t: 330, b: 860 };
          panel(ctx, m, 772, 330, 768, 530);
          txt(ctx, 792, 354, 'PROJECT MEMORY · 2-D projection of embeddings (illustrative)', { size: 13, font: 'display', weight: 700, color: 'teal', spacing: 1, parent: m });
          lbl(ctx, 1526, 354, 'click to zoom in ⤢', { color: 'teal', size: 11, anchor: 'end', parent: m });
          var CL = [['fox character', 'amber', 1000, 490, 13, 'fox_sheet_'], ['ice moon', 'cyan', 1330, 460, 11, 'moon_env_'], ['style sketches', 'violet', 1240, 720, 9, 'sketch_'], ['takes shot 1–3', 'lime', 960, 720, 12, 'take_kf_']];
          var pts = [], clabs = [];
          CL.forEach(function (c, ci) {
            for (var k = 0; k < c[4]; k++) {
              var ang = r() * Math.PI * 2, rad = 12 + r() * 48;
              var p = { x: c[2] + Math.cos(ang) * rad, y: c[3] + Math.sin(ang) * rad * 0.8, c: ci, name: c[5] + (k + 1) };
              p.el = ctx.circle(p.x, p.y, 5, { fill: ctx.alpha(c[1], 0.8), stroke: c[1], sw: 1, parent: m });
              p.el.setAttribute('opacity', 0);
              pts.push(p);
            }
            clabs.push(lbl(ctx, 800 + ci * 180, 836, c[0], { color: c[1], size: 12, anchor: 'start', parent: m }));
          });
          hide(clabs);
          /* beat 0 lands the embedded media (style sketches, take keyframes); beat 1 the rest of the project (fox sheets, ice moon) */
          function clusterEls(sel) { return pts.filter(function (p) { return sel(p.c); }).map(function (p) { return p.el; }); }
          var q = { x: 1045, y: 600 };
          pts.forEach(function (p) { p.d = Math.hypot(p.x - q.x, p.y - q.y); });
          var nn = pts.slice().sort(function (u, v) { return u.d - v.d; }).slice(0, 5);
          S.nnL = nn.map(function (p) { return ctx.line(q.x, q.y, p.x, p.y, { color: 'magenta', sw: 1.4, dash: '4 3', parent: m }); });
          S.q = ctx.poly([[0, -12], [3.5, -4], [12, -4], [5, 2], [8, 11], [0, 5], [-8, 11], [-5, 2], [-12, -4], [-3.5, -4]].map(function (p) { return [q.x + p[0], q.y + p[1]]; }), { fill: 'magenta', parent: m, glow: true });
          var qlab = txt(ctx, q.x + 16, q.y + 2, 'q: shot 4', { size: 12, font: 'mono', color: lift(ctx, 'magenta'), parent: m });
          var res = ctx.group({ parent: m });
          txt(ctx, 1340, 560, 'top-5 · raw cosine', { size: 12, font: 'mono', color: 'dim', parent: res });
          nn.forEach(function (p, i) {
            txt(ctx, 1340, 585 + i * 22, p.name, { size: 12, font: 'mono', color: CL[p.c][1], parent: res });
            txt(ctx, 1525, 585 + i * 22, (0.34 - p.d / 1500).toFixed(3), { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: res });
          });
          hide(m, S.nnL, S.q, qlab, res);
          /* scale badges */
          var sc1 = lbl(ctx, 60, 790, 'per project: 10²–10⁴ vectors · exact search is fine', { color: 'teal', size: 12, anchor: 'start', parent: g });
          var sc2 = lbl(ctx, 60, 830, 'platform library: 10⁹ vectors ≈ 2.3 TB raw · needs ANN + PQ', { color: 'amber', size: 12, anchor: 'start', parent: g });
          hide(sc1, sc2);

          /* beat 0: embed the project's media, upsert into the vector store */
          ctx.hud('one shared space for images and text');
          return ctx.reveal(a, { from: 'up' }).then(function () {
            return Promise.all(inL.map(function (l, i) { return ctx.wait(i * 120).then(function () { return ctx.packet(l, { color: 'violet', dur: 500 }); }); }));
          }).then(function () {
            return ctx.packet(w1, { color: 'teal', dur: 500, label: 'upsert' });
          }).then(function () {
            ctx.hotspot(m, 'rag-memory', { hint: 'VECTOR MEMORY ⤢' });
            return ctx.reveal(m, { from: 'scale', s0: 0.95 });
          }).then(function () {
            return ctx.reveal(clusterEls(function (c) { return c >= 2; }), { from: 'fade', stagger: 70, dur: 300 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the rest of the project lands, and clusters form by meaning */
            ctx.hud('near in the space = alike in meaning');
            return ctx.reveal(clusterEls(function (c) { return c < 2; }), { from: 'fade', stagger: 60, dur: 300 }).then(function () {
              return ctx.reveal(clabs, { stagger: 120, dur: 350 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the query lands in the same space */
            ctx.hud('unit vectors ⇒ cosine = dot product');
            return ctx.reveal(a2, { from: 'up' }).then(function () {
              return ctx.packet(tq, { color: 'magenta', dur: 400 });
            }).then(function () {
              return ctx.packet(w2, { color: 'magenta', dur: 500, label: 'search' });
            }).then(function () {
              ctx.pulse(S.q, { color: 'magenta' });
              return Promise.all([ctx.reveal(S.q, { from: 'scale' }), ctx.reveal(qlab)]);
            }).then(function () {
              return ctx.reveal(S.nnL, { stagger: 120, dur: 300 });
            }).then(function () { return ctx.reveal(res, { dur: 400 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: scale, and the invitation to zoom */
            ctx.hud('10⁹ × 1152-d fp16 ≈ 2.3 TB raw → ANN + PQ');
            return ctx.reveal([sc1, sc2], { from: 'left', stagger: 200 }).then(function () {
              return ctx.pulse(m, { color: 'teal', times: 2, dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Lineage of shot 3',
        beats: [
          {
            say: 'Why does shot three look the way it does? The lineage graph answers that. On the left are the inputs: the prompt, the character sheet, a sketch, the storyboard frame and the exact model weights, each named by its hash.',
            card: { tag: 'KEY IDEA', title: 'Provenance is a graph', body: 'Nodes are versioned things named by content hash; edges say how one thing came from another. It is a DAG, so it can be walked in both directions.' },
            deep: '<p>Lineage is a DAG in the W3C PROV model: <b>entities</b> (prompt, sketches, weights, takes), <b>activities</b> (render runs) and <b>agents</b> (cinematographer agent, creator). Every entity is immutable and named by its content hash, so a node identifies bytes, not "whatever is at that path today".</p>' +
              '<p>OpenLineage models data pipelines in a similar shape (runs, jobs, datasets), which is what lets one graph span agent runs and batch jobs.</p>'
          },
          {
            say: 'Two render activities consumed those inputs, each with its own parameters, and the cinematographer agent ran both. Seed, guidance scale, step count and reference strength are recorded, because together they decide the pixels.',
            card: { tag: 'HOW IT WORKS', title: 'A render records its recipe', body: 'An activity is a run that used specific inputs and parameters, executed by a named agent. Anything that changes the output belongs on the record.' },
            deep: '<p>Edges: <code>used</code> (activity→entity) and <code>wasAssociatedWith</code> (activity→agent). To be a reproducible recipe the record must cover everything that can change the output:</p>' +
              '<ul><li>inputs and model weights, by digest</li><li>sampler, steps, CFG scale, seed, resolution, frame count</li><li>code revision and library versions</li><li>hardware class and kernel flags (see the determinism caveat below)</li></ul>' +
              '<p>PROV points edges from effect to cause; the canvas draws them in dataflow direction.</p>'
          },
          {
            say: 'Render eight thousand eight hundred twelve produced take three A, which the critic rejected for visor flicker. That verdict informed a second render with a new seed and stronger reference conditioning, which produced take three B, and take three B went into the final cut.',
            card: { tag: 'HOW IT WORKS', title: 'A rejection becomes an edge', body: 'The retry parameters <code>wasDerivedFrom</code> the critique of take 3a, so the graph explains why render 8840 used a new seed and a stronger reference.' },
            deep: '<p>The retry params of render #8840 <code>wasDerivedFrom</code> take 3a\'s critique, so #8840 is, in effect, <code>wasInformedBy</code> #8812. Take 3b <code>wasGeneratedBy</code> #8840, and the final cut <code>wasDerivedFrom</code> take 3b. The critic score (0.41, then 0.87) is an attribute on the take entity.</p>' +
              '<p>Because failed attempts stay in the graph, later analysis can ask which prompts, seeds or reference strengths tend to produce rejects: raw material for the flywheel in the next step.</p>'
          },
          {
            say: 'Each render also writes a canonical manifest, and the hash of that manifest is a memo key. If the same key appears again, the stored clip is reused for zero GPU seconds.',
            card: { tag: 'NUMBERS', title: 'Reuse a clip for free', stat: { v: '0', u: 'GPU-s', l: 'to serve a render whose manifest hash is already in the store' },
              more: '<p>Reuse is exact only for the same manifest. Change one input byte, the seed or the model digest and the key changes, so stale reuse is impossible by construction; the price is that near-identical requests get no partial credit.</p>' },
            deep: '<p>Each render writes a <b>canonical manifest</b> (sorted keys, normalised numbers); its hash is a memo key:</p>' +
              '<div class="eq">key = SHA-256(canon(inputs, model_digest, sampler, steps, cfg, seed, resolution, code_rev))</div>' +
              '<p>Same key ⇒ reuse the stored clip, zero GPU-seconds.</p>' +
              '<details><summary>Go deeper</summary><p>Bit-exact replay needs deterministic kernels: atomics in reductions, batch-size-dependent GEMM tiling and different GPU SKUs change floating-point summation order. So also store the <i>output</i> digest, and treat replay as "perceptually equal" unless determinism flags are pinned.</p></details>'
          },
          {
            say: 'Say a frame in the final cut looks wrong. Walk the edges backwards from the cut to its take, the render, the seed and the exact weights, and even to the earlier critique that shaped the retry.',
            card: { tag: 'HOW IT WORKS', title: 'Debugging is a backward walk', body: 'From a bad frame, follow the edges to the render parameters, the weights and the inputs. One job\'s graph is tiny, so this is a handful of lookups.' },
            deep: '<ul><li><b>Debug</b>: "why does this frame look wrong?" traverses backward from the take: <code>wasGeneratedBy</code> to the render, <code>used</code> to inputs and weights, parameters to seed and CFG. An adjacency table with <code>WITH RECURSIVE</code> in Postgres answers it in milliseconds, because one job\'s graph has tens of nodes.</li>' +
              '<li><b>Cross-job questions</b> ("which seeds correlate with flicker?") need the warehouse, fed by the lakehouse sink of the event log.</li>' +
              '<li><b>Credentials</b>: the same graph populates the C2PA manifest (ingredients, actions) on the final cut.</li></ul>' +
              '<div class="note">Provenance recorded at write time is cheap; reconstructed after the fact, it is guesswork.</div>'
          },
          {
            say: 'Walk the same graph forwards from a user upload and you find every derived artifact: renders, takes, the final cut, embeddings and cached latents. That set is exactly what an erasure request has to delete.',
            card: { tag: 'WHY IT MATTERS', title: 'Erasure is a forward walk', body: 'A deletion request must reach every derived copy, not only the upload. Without the graph you are guessing what one sketch touched.' },
            deep: '<p><b>Erasure</b> (GDPR Art. 17): traverse forward from the upload entity to all descendants and delete or re-derive each one: cached latents, takes, embeddings (delete by id in the vector store), training pairs (consent withdrawn), and any final cut that embeds the material.</p>' +
              '<p>The event log is immutable, so use <b>crypto-shredding</b>: encrypt each user\'s payloads with a per-user key and delete the key, which leaves the log intact and the data unreadable. Backups age the rest out by retention.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [5]);
          var hd = head(ctx, g, 60, 330, 'PROVENANCE GRAPH · shot 3  (W3C PROV: entity · activity · agent)');
          var G = ctx.group({ parent: g });
          function ent(x, y, t, col, w) { return ctx.node({ x: x, y: y, w: w || 190, h: 40, kind: 'pill', title: t, color: col || 'teal', titleSize: 13, glow: false, parent: G }); }
          var ins = [ent(160, 380, 'prompt v3 · 41c…'), ent(160, 440, 'fox_sheet.png · a09…'), ent(160, 500, 'sketch_2.png · d2e…'), ent(160, 560, 'board_f3.png · 7b3…'), ent(160, 620, 'wan-14b · 7c1e…', 'lime')];
          var pa = ctx.node({ x: 800, y: 350, w: 230, h: 34, kind: 'chip', title: 'seed 1234 · cfg 5 · no ref', color: 'dim', titleSize: 12, parent: G });
          var pb = ctx.node({ x: 800, y: 664, w: 230, h: 34, kind: 'chip', title: 'seed 77 · cfg 5 · ref 0.8', color: 'amber', titleSize: 12, parent: G });
          var ra = ctx.node({ x: 800, y: 405, w: 170, h: 50, title: 'render #8812', color: 'lime', titleSize: 14, parent: G });
          var rb = ctx.node({ x: 800, y: 600, w: 170, h: 50, title: 'render #8840', color: 'lime', titleSize: 14, parent: G });
          var ag = ctx.node({ x: 800, y: 502, w: 200, h: 42, kind: 'hex', title: 'cinematographer agent', color: 'magenta', titleSize: 12, glow: false, parent: G });
          var ta = ent(1100, 405, 'take 3a', 'red', 150);
          var tb = ent(1100, 600, 'take 3b', 'lime', 150);
          var fc = ctx.node({ x: 1410, y: 502, w: 190, h: 56, title: 'final cut v1', sub: 'C2PA manifest', icon: 'film', color: 'orange', titleSize: 14, parent: G });
          var cr = lbl(ctx, 1160, 366, 'critic 0.41 · visor flicker', { color: 'red', size: 11, bg: '#1a0a12', parent: G });
          var ok = lbl(ctx, 1160, 648, 'critic 0.87 · approved', { color: 'lime', size: 11, bg: '#0a1a12', parent: G });
          var spine = [ctx.line(262, 380, 262, 620, { color: ctx.alpha('teal', 0.6), sw: 2, parent: G })];
          ins.forEach(function (n) { spine.push(ctx.line(n.box.r, n.box.cy, 262, n.box.cy, { color: ctx.alpha('teal', 0.6), sw: 1.3, parent: G })); });
          var E2 = [], E3 = [];
          function e(list, a, b, o) {
            var l = ctx.link(a, b, Object.assign({ color: ctx.alpha('teal', 0.6), sw: 1.3, parent: G }, o || {}));
            list.push(l);
            hide(l);
            if (l.labelEl) {
              l.labelEl.querySelector('text').setAttribute('fill', ctx.color('white'));
              l.labelEl.querySelector('rect').setAttribute('fill', '#0f3a36');   /* opaque pill: a crossing edge passes behind it, never through the text */
              hide(l.labelEl);
            }
            return l;
          }
          var u1 = e(E2, { x: 262, y: 405 }, ra, { to: 'l', straight: true, label: 'used' });
          var u2 = e(E2, { x: 262, y: 600 }, rb, { to: 'l', straight: true, label: 'used' });
          var p1 = e(E2, pa, ra, { from: 'b', to: 't', straight: true }), p2 = e(E2, pb, rb, { from: 't', to: 'b', straight: true });
          e(E2, ag, ra, { from: 't', to: 'b', dash: '3 4', color: ctx.alpha('magenta', 0.7), arrow: false });
          e(E2, ag, rb, { from: 'b', to: 't', dash: '3 4', color: ctx.alpha('magenta', 0.7), arrow: false });
          var g1 = e(E3, ra, ta, { straight: true, label: 'wasGeneratedBy', labelDy: -14 }), g2 = e(E3, rb, tb, { straight: true, label: 'wasGeneratedBy', labelDy: -14 });
          var inf = e(E3, ta, pb, { from: 'b', to: 'r', bend: { x: 1010, y: 640 }, color: ctx.alpha('red', 0.7), dash: '5 4', label: 'wasDerivedFrom', labelDx: -58, labelDy: -40 });
          var d1 = e(E3, tb, fc, { from: 'r', to: 'l', label: 'wasDerivedFrom', labelDx: 40, labelDy: 32 });
          hide(hd, ins, spine, pa, pb, ra, rb, ag, ta, tb, fc, cr, ok);
          function drawEdges(list) {
            return Promise.all(list.map(function (l, i) {
              var ps = [ctx.reveal(l, { from: 'draw', delay: i * 90, dur: 500 })];
              if (l.labelEl) ps.push(ctx.reveal(l.labelEl, { delay: 300 + i * 90 }));
              return Promise.all(ps);
            }));
          }
          /* manifest + uses */
          var bt = ctx.group({ parent: g });
          var mf = code(ctx, { x: 60, y: 712, w: 840, title: 'manifest(take 3b) — canonical JSON', lang: 'json', size: 13, parent: bt, typing: true, lines: [
            '{"inputs":["cas://…41c","cas://…a09","cas://…d2e","cas://…7b3"],',
            ' "model":"wan-14b@sha256:7c1e…","sampler":"unipc","steps":50,',
            ' "cfg":5.0,"seed":77,"ref_strength":0.8,"res":[1280,720,121]}',
            ' manifest_hash = "e5b0…"   output_digest = "9f3a…"'
          ] });
          hide(bt);
          var uses = ['debug: walk edges backward from the final cut', 'reuse: manifest_hash hit → blob, 0 GPU-s', 'replay: same manifest ≈ same take*', 'erase: walk forward from a user upload', '* bit-exact only with deterministic kernels'].map(function (s, i) {
            var t = txt(ctx, 940, 736 + i * 27.4, s, { size: 13, font: 'mono', color: 'text', parent: g });
            t.setAttribute('opacity', 0);
            return t;
          });
          /* persistent traces of the two walks: backward (debug, amber) and forward (erase, pink) */
          function trace(l, col, sw, dash) {
            var o = ctx.path(l.getAttribute('d'), { stroke: col, sw: sw, dash: dash, parent: G });
            o.setAttribute('opacity', 0);
            return o;
          }
          var ovB = [d1, g2, p2, u2, inf].map(function (l) { return trace(l, 'amber', 3.4); });
          var ovF = [u1, u2, g1, g2, d1].map(function (l) { return trace(l, 'pink', 3, '7 4'); });
          /* keep the edge labels above the traces */
          E2.concat(E3).forEach(function (l) { if (l.labelEl && l.labelEl.parentNode) l.labelEl.parentNode.appendChild(l.labelEl); });

          /* beat 0: the inputs, all named by hash */
          ctx.hud('PROV: entity · activity · agent');
          return Promise.all([ctx.reveal(hd), ctx.reveal(ins, { from: 'left', stagger: 110 }), ctx.reveal(spine, { from: 'draw', delay: 500, stagger: 60 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: two render activities, their parameters, and the agent that ran them */
            ctx.hud('render = inputs + parameters + agent');
            return Promise.all([ctx.reveal([ra, rb], { from: 'scale', stagger: 150 }), ctx.reveal([pa, pb], { from: 'up', delay: 200, stagger: 150 }), ctx.reveal(ag, { from: 'scale', delay: 400 })]).then(function () {
              return drawEdges(E2);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: outputs, the critic's verdict and the retry */
            ctx.hud('critic 0.41 → retry → 0.87 · approved');
            return Promise.all([ctx.reveal([ta, tb], { from: 'right', stagger: 150 }), ctx.reveal([cr, ok], { delay: 300, stagger: 200 }), ctx.reveal(fc, { from: 'scale', delay: 600 })]).then(function () {
              return drawEdges(E3);
            }).then(function () { return ctx.pulse(ta, { color: 'red', dur: 700 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: manifest hash = memo key */
            ctx.hud('memo key = SHA-256(manifest) · hit ⇒ 0 GPU-s');
            return ctx.reveal(bt, { from: 'up' }).then(function () { return mf.typeAll(); }).then(function () {
              return ctx.reveal([uses[1], uses[2], uses[4]], { from: 'left', stagger: 150 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: debug, walk backwards from the final cut */
            ctx.hud('debug: walk the edges backwards');
            ctx.reveal(uses[0], { from: 'left' });
            return ctx.camera(800, 500, 1.12, 800).then(function () {
              return Promise.all([ctx.packet(d1, { color: 'amber', dur: 500, reverse: true, label: 'why?' }), ctx.reveal(ovB[0], { opacity: 0.9, dur: 400 })]);
            }).then(function () {
              return Promise.all([ctx.packet(g2, { color: 'amber', dur: 400, reverse: true }), ctx.reveal(ovB[1], { opacity: 0.9, dur: 400 }), ctx.pulse(tb, { color: 'amber' })]);
            }).then(function () {
              return Promise.all([ctx.packet(p2, { color: 'amber', dur: 400, reverse: true }), ctx.packet(u2, { color: 'amber', dur: 500, reverse: true }), ctx.packet(inf, { color: 'red', dur: 700, reverse: true }),
                ctx.reveal([ovB[2], ovB[3], ovB[4]], { opacity: 0.9, dur: 400, stagger: 100 })]);
            }).then(function () {
              return Promise.all(ins.map(function (n) { return ctx.pulse(n, { color: 'amber', dur: 600 }); }).concat([ctx.pulse(ta, { color: 'red', dur: 600 })]));
            }).then(function () {
              return ctx.camera(null, null, null, 700);
            });
          }).then(function () { return ctx.beat(5); }).then(function () {
            /* beat 5: erase, walk forwards from a user upload */
            ctx.hud('erase: walk the edges forwards');
            ctx.fade(ovB, 0.3, 400);
            ctx.reveal(uses[3], { from: 'left' });
            return ctx.camera(800, 500, 1.12, 800).then(function () {
              return ctx.pulse(ins[2], { color: 'pink', times: 2, dur: 600 });
            }).then(function () {
              return Promise.all(ovF.map(function (o, i) { return ctx.reveal(o, { from: 'draw', dur: 500, delay: i * 140 }); }));
            }).then(function () {
              return Promise.all([ra, rb, ta, tb, fc].map(function (n) { return ctx.pulse(n, { color: 'pink', dur: 600 }); }));
            }).then(function () {
              return ctx.camera(null, null, null, 700);
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'The data flywheel',
        beats: [
          {
            say: 'Finally, the data plane closes a loop. Every time the creator picks take three B over take three A, trims a shot, or hits regenerate, that is a label, and this one session already produced twenty of them.',
            card: { tag: 'NUMBERS', title: 'Labels from one session', stat: { v: '20', l: 'signals: 6 pairwise picks, 3 regenerates, 9 edits, 1 rating and 1 export' } },
            deep: '<p>Every interaction is a label. Choosing take 3b over 3a is a <b>pairwise preference</b> (the most informative signal); regenerate clicks are noisy negatives; trims and re-orders supervise the editor agent; explicit ratings are rare.</p>' +
              '<p>Preference learning usually assumes a Bradley–Terry model: the chance that the winner is preferred depends only on a reward gap.</p>' +
              '<div class="eq">P(w ≻ l) = σ( r(w) − r(l) )</div>'
          },
          {
            say: 'Those events flow through the event log and are joined into preference pairs: a winner, a loser, and the shared prompt, references and settings that produced them.',
            card: { tag: 'HOW IT WORKS', title: 'Events become preference pairs', body: 'Join by shot: take 3b beat take 3a under the same prompt, references and shot spec. Same conditioning, different outcome, a clean comparison.' },
            deep: '<p>Pairs are built by joining the event log on <code>shot_id</code>: two takes of the same shot spec, with the creator\'s choice as the label. Holding the conditioning fixed is what makes a pair informative; comparing takes of different prompts mostly measures the prompt.</p>' +
              '<p>Guard against position bias (was the winner simply shown first?) by logging display order, and keep each take\'s watch time: a pick made without playing both takes is a weak label.</p>'
          },
          {
            say: 'Pairs then pass consent, privacy and safety filters. Only creators who opted in are used, faces and personal data are filtered out, and only confident pairs survive.',
            card: { tag: 'NUMBERS', title: 'What survives curation', stat: { v: '12%', l: 'of raw signals become confident, consented, safe training pairs (illustrative funnel)' } },
            deep: '<p>The funnel is a chain of independent gates, each with its own failure mode:</p>' +
              '<ul><li><b>Consent</b>: <code>users.consent_train = true</code>, checked at extraction and again at training time so a withdrawal takes effect.</li>' +
              '<li><b>Privacy</b>: PII and face filters; dedupe near-identical takes.</li>' +
              '<li><b>Safety</b>: classifiers on prompts and outputs; drop anything the trust layer flagged.</li>' +
              '<li><b>Confidence</b>: keep pairs with a consistent preference (both takes watched, no immediate reversal).</li></ul>'
          },
          {
            say: 'Post training, for example diffusion DPO, nudges the video model toward the winners: denoise the chosen take better than a frozen reference does, and the rejected take worse.',
            card: { tag: 'STATE OF THE ART', title: 'Diffusion-DPO on video', body: 'The pairwise loss updates the generator directly against a frozen reference. Video work adds a learned reward model that labels pairs at scale.',
              more: '<p>Liu et al. (2025) train <b>VideoReward</b>, a multi-dimensional reward model (visual quality, motion quality, text alignment) on a large human-preference set, and compare three ways to use it on flow-matching video models: <b>Flow-DPO</b> (pairwise), <b>Flow-RWR</b> (reward-weighted regression) and <b>Flow-NRG</b> (reward guidance at inference).</p>' },
            deep: '<p><b>Diffusion-DPO</b> fine-tunes the generator on pairs (x<sup>w</sup>, x<sup>l</sup>) against a frozen reference:</p>' +
              '<div class="eq">L = −E log σ(−βT·ω(λ<sub>t</sub>)·[(‖ε<sup>w</sup>−ε<sub>θ</sub>(x<sup>w</sup><sub>t</sub>,t)‖² − ‖ε<sup>w</sup>−ε<sub>ref</sub>(x<sup>w</sup><sub>t</sub>,t)‖²) − (‖ε<sup>l</sup>−ε<sub>θ</sub>(x<sup>l</sup><sub>t</sub>,t)‖² − ‖ε<sup>l</sup>−ε<sub>ref</sub>(x<sup>l</sup><sub>t</sub>,t)‖²)])</div>' +
              '<p>Lower the winner\'s denoising error, relative to the reference, more than the loser\'s. Flow-matching models use velocity errors (Flow-DPO).</p>' +
              '<details><summary>Go deeper</summary><p>RLHF\'s KL-regularised optimum is π* ∝ π<sub>ref</sub>·exp(r/β), so r = β log(π*/π<sub>ref</sub>) + const. Substituting into Bradley–Terry cancels the partition function. Diffusion likelihoods are intractable, so Wallace et al. bound them with the ELBO, giving the error differences above.</p></details>'
          },
          {
            say: 'A new version must clear an evaluation gate and a canary rollout before it serves everyone. Then better takes attract better choices, and the loop turns again.',
            card: { tag: 'PITFALL', title: 'Flywheels amplify their own bias', body: 'Reward hacking and popularity bias compound with every turn. Held-out human preference and VBench-style evals gate each release.' },
            deep: '<p>Loop hygiene: per-user consent flag, PII/face filtering, dedupe, held-out human-preference evals and VBench-style metrics as release gates, then canary 5% → 100% with automatic rollback on regression.</p>' +
              '<p>A flywheel also amplifies its own errors: the model shows what it can already make, users pick among those options, and the next model narrows further (popularity bias, mode collapse). Reward hacking shows up as takes that please the reward model without pleasing people, so keep a frozen, human-labelled eval set outside the loop.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [2, 0]);
          var CX = 800, CY = 600, R = 225;
          var ring = ctx.group({ parent: g });
          var circ = ctx.path('M' + CX + ',' + (CY - R) + ' A' + R + ',' + R + ' 0 0 1 ' + CX + ',' + (CY + R) + ' A' + R + ',' + R + ' 0 0 1 ' + CX + ',' + (CY - R), { stroke: ctx.alpha('teal', 0.45), sw: 2, dash: '6 6', parent: ring });
          [-60, 0, 60, 120, 180, 240].forEach(function (a) {
            var t = a * Math.PI / 180, x = CX + R * Math.cos(t), y = CY + R * Math.sin(t);
            var dx = -Math.sin(t), dy = Math.cos(t);
            ctx.poly([[x + dx * 9, y + dy * 9], [x - dx * 6 + dy * 7, y - dy * 6 - dx * 7], [x - dx * 6 - dy * 7, y - dy * 6 + dx * 7]], { fill: 'teal', parent: ring });
          });
          txt(ctx, CX, CY - 12, 'DATA', { size: 22, font: 'display', weight: 700, color: 'teal', anchor: 'middle', spacing: 3, parent: ring });
          txt(ctx, CX, CY + 16, 'FLYWHEEL', { size: 22, font: 'display', weight: 700, color: 'teal', anchor: 'middle', spacing: 3, parent: ring });
          circ.len = circ.getTotalLength();
          hide(ring);
          var ST = [['Creators', 'edit · rate · redo', 'cyan', 'user'], ['Event log', 'implicit + explicit', 'magenta', 'queue'], ['Pref. pairs', 'take 3b ≻ take 3a', 'amber', 'chart'],
            ['Curation', 'consent · PII · safety', 'pink', 'shield'], ['Post-train', 'Diffusion-DPO · RM', 'lime', 'bolt'], ['Eval + registry', 'canary 5% → 100%', 'red', 'check']];
          var nodes = ctx.group({ parent: g });
          S.fw = ST.map(function (s, i) {
            var t = (-90 + i * 60) * Math.PI / 180;
            return ctx.node({ x: CX + R * Math.cos(t), y: CY + R * Math.sin(t), w: 196, h: 54, title: s[0], sub: s[1], color: s[2], titleSize: 14, subSize: 12, parent: nodes });
          });
          hide(S.fw);
          /* signals */
          var L = ctx.group({ parent: g });
          head(ctx, L, 60, 345, 'SIGNALS FROM THIS SESSION');
          [['pick take 3b over 3a', 'pairwise · strongest', '×6', 'amber'], ['regenerate a shot', 'negative · noisy', '×3', 'red'], ['trim / re-order', 'edit supervision', '×9', 'orange'],
            ['thumbs rating', 'pointwise · sparse', '×1', 'cyan'], ['export + share', 'weak positive', '×1', 'lime']].forEach(function (r, i) {
            var y = 385 + i * 60;
            ctx.rect(60, y - 22, 330, 50, { rx: 8, fill: ctx.alpha(r[3], 0.07), stroke: ctx.alpha(r[3], 0.45), sw: 1, parent: L });
            txt(ctx, 74, y - 5, r[0], { size: 14, color: 'white', weight: 600, parent: L });
            txt(ctx, 74, y + 15, r[1], { size: 12, font: 'mono', color: r[3], parent: L });
            txt(ctx, 376, y + 4, r[2], { size: 16, font: 'mono', weight: 700, color: r[3], anchor: 'end', parent: L });
          });
          lbl(ctx, 60, 700, 'only if users.consent_train = true', { color: 'pink', size: 12, anchor: 'start', parent: L });
          hide(L);
          /* funnel */
          var F = ctx.group({ parent: g });
          head(ctx, F, 1170, 345, 'CURATION FUNNEL (illustrative)');
          var fr = [['raw signals', 1, 'teal'], ['consented', 0.55, 'teal'], ['passes PII + safety', 0.45, 'pink'], ['confident pairs', 0.12, 'amber']];
          S.fb = fr.map(function (f, i) {
            var y = 385 + i * 62;
            txt(ctx, 1170, y, f[0], { size: 13, color: 'text', parent: F });
            txt(ctx, 1540, y, Math.round(f[1] * 100) + '%', { size: 13, font: 'mono', color: f[2], anchor: 'end', parent: F });
            var b = ctx.rect(1170, y + 12, 370 * f[1], 16, { rx: 3, fill: ctx.alpha(f[2], 0.5), stroke: f[2], sw: 1, parent: F });
            b.setAttribute('width', 0);
            return [b, 370 * f[1]];
          });
          hide(F);
          var dpo = para(ctx, 1170, 650, ['Diffusion-DPO: denoise the winner', '(take 3b) better and the loser', '(take 3a) worse, relative to a', 'frozen reference model.'], { size: 13, font: 'mono', color: 'dim', lh: 22, parent: g });
          hide(dpo);

          /* beat 0: implicit and explicit labels from the creator */
          ctx.hud('every edit is a label · 20 this session');
          return Promise.all([ctx.reveal(ring, { from: 'scale', s0: 0.8 }), ctx.reveal(circ, { from: 'draw', dur: 1200 }), ctx.reveal(L, { from: 'left', delay: 400 })]).then(function () {
            return ctx.reveal(S.fw[0], { from: 'scale' });
          }).then(function () { return ctx.pulse(S.fw[0], { dur: 600 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: log, then preference pairs */
            ctx.hud('signals → pairs · same prompt, two takes');
            return ctx.reveal(S.fw[1], { from: 'scale' }).then(function () { return ctx.reveal(S.fw[2], { from: 'scale' }); }).then(function () {
              return ctx.pulse(S.fw[2], { dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: curation filters */
            ctx.hud('curate: consent · PII · safety · confidence');
            return Promise.all([ctx.reveal(S.fw[3], { from: 'scale' }), ctx.reveal(F, { from: 'right', delay: 200 })]).then(function () {
              return Promise.all(S.fb.map(function (b, i) { return ctx.animate(b[0], { width: [0, b[1]] }, 600, 'out', i * 200); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: post-training on the winners */
            ctx.hud('Diffusion-DPO: winner ↑ · loser ↓ vs frozen ref');
            return Promise.all([ctx.reveal(S.fw[4], { from: 'scale' }), ctx.reveal(dpo, { from: 'up', delay: 200 })]).then(function () {
              return ctx.pulse(S.fw[4], { dur: 600 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: gate, canary, and the loop turns */
            ctx.hud('eval gate → canary 5% → 100% → next turn');
            return ctx.reveal(S.fw[5], { from: 'scale' }).then(function () {
              S.flow = ctx.stream(circ, { color: 'teal', count: 6, period: 5200, parent: ring });
              S.loops.push(S.flow);
              return S.fw.reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, { dur: 450 }); }); }, Promise.resolve());
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 9 */
      {
        title: 'One turn, every store',
        beats: [
          {
            say: 'Put it together for one agent turn: starting shot four. A session and rate limit check in Redis takes under a millisecond, and claiming the shot in Postgres takes about three.',
            card: { tag: 'NUMBERS', title: 'Admit and claim', stat: { v: '3.6', u: 'ms', l: 'to authenticate, rate-limit and claim shot 4: Redis 0.6 ms plus Postgres 3 ms' } },
            deep: '<p>Illustrative in-region budget for one agent turn around a render. The first two steps are strictly sequential, because the claim must not happen for a request the limiter refused:</p>' +
              '<table><tr><th>Store</th><th>Operation</th><th>~ms</th></tr>' +
              '<tr><td>Redis</td><td>session + token bucket (one Lua call)</td><td>0.6</td></tr>' +
              '<tr><td>Postgres</td><td>CAS claim + outbox insert, one transaction</td><td>3</td></tr></table>'
          },
          {
            say: 'Retrieving the fox references from vector memory, reranking included, takes about forty milliseconds, and fetching the character sheet from object storage about forty more. The event log append runs in parallel.',
            card: { tag: 'HOW IT WORKS', title: 'Overlap what does not depend', body: 'The log append and the reference fetch are independent, so they overlap: the critical path is the fetch, not the sum of the two.' },
            deep: '<table><tr><th>Store</th><th>Operation</th><th>~ms</th></tr>' +
              '<tr><td>Vector DB</td><td>embed + hybrid top-k + rerank (next chamber)</td><td>40</td></tr>' +
              '<tr><td>Object store</td><td>GET 2 references (first byte + transfer)</td><td>40</td></tr>' +
              '<tr><td>Event log</td><td>append <code>shot.rendering</code> (acks=all)</td><td>5</td></tr></table>' +
              '<p>Critical path so far: 0.6 + 3 + 40 + 40 ≈ 84 ms; the 5 ms log append hides behind the object fetch. Skipping the reranker for a low-stakes shot brings retrieval to about 12 ms, and the GET could start earlier by prefetching the character sheet during retrieval, at the cost of fetching bytes that ranking might discard. Object timings assume a low-latency tier or a warm cache; plain S3 Standard is about 100 to 200 ms to first byte.</p>'
          },
          {
            say: 'Then the GPU works for about a minute and a half. On this scale bar the render is off the chart by three orders of magnitude.',
            card: { tag: 'NUMBERS', title: 'The render dwarfs the data plane', stat: { v: '≈ 95', u: 's', l: 'to render a 5 s shot on 8 GPUs, about 760 GPU-seconds, after an 84 ms data-plane critical path' } },
            deep: '<table><tr><th>Store</th><th>Operation</th><th>~ms</th></tr>' +
              '<tr><td>GPU</td><td>render 5 s shot (8 GPUs, sequence-parallel ⇒ ~760 GPU-s)</td><td>~9.5·10<sup>4</sup></td></tr></table>' +
              '<p>The axis is broken: 95,000 ms against 84 ms is a ratio of about 1,100, more than three orders of magnitude. Any millisecond shaved from the data plane is invisible to the user; one percent shaved from the GPU is worth about a second.</p>'
          },
          {
            say: 'When it finishes, the new take is written to object storage in about thirty milliseconds, and its event and lineage edges land in five more. The data plane never blocks the next step.',
            card: { tag: 'WHY IT MATTERS', title: 'Data plane is 0.1% of the turn', body: 'About 120 ms of storage work surrounds 95 seconds of GPU. Correctness and durability are bought almost for free here.' },
            deep: '<table><tr><th>Store</th><th>Operation</th><th>~ms</th></tr>' +
              '<tr><td>Object store</td><td>PUT 12 MB take</td><td>30</td></tr>' +
              '<tr><td>Lineage + log</td><td>edges + <code>shot.rendered</code></td><td>5</td></tr></table>' +
              '<p>Before the GPU 84 ms, after it 35 ms: about 119 ms of data-plane work around 95 s of compute, roughly 0.12%. That headroom is what lets the design spend it on write-once uploads, a transactional outbox and lineage edges. Even at S3 Standard latencies of 100 to 200 ms per object operation, the total stays under half a percent of the turn.</p>'
          },
          {
            say: 'Four rules fall out of this: pass bytes by reference, commit state and event in one transaction, let caches be fast but never correct, and stamp every artifact with a manifest hash. Next, zoom into vector memory to see how the fox is found in tens of milliseconds.',
            card: { tag: 'TRY IT', title: 'Open Vector Memory next', body: 'The dashed ring on the Vector DB store is a zoom target. Click it to see HNSW, product quantisation and hybrid search.' },
            deep: '<p>Design rules this chamber argues for:</p><ol>' +
              '<li>Pass bytes by reference; LLM contexts hold URIs and captions, never media.</li>' +
              '<li>One transaction for state + event (outbox); everything else is a consumer of the log.</li>' +
              '<li>Caches may make things fast, never correct.</li>' +
              '<li>Every artifact carries a manifest hash: reproducibility, memoisation and deletion come for free.</li></ol>' +
              '<div class="note">Next: zoom into <b>Vector Memory &amp; Retrieval</b> to see how "what does the fox look like?" is answered in tens of milliseconds.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.flow) { S.flow.stop(); S.flow = null; }
          var g = view(ctx, S, null);
          var wf = ctx.group({ parent: g });
          panel(ctx, wf, 50, 330, 1500, 530, 'teal');
          head(ctx, wf, 76, 358, 'ONE AGENT TURN · start shot 4 · touches every store');
          var XA = 590, SA = 6.1;     /* 0..90 ms → 590..1139 */
          var XB = 1230, SB = 7;      /* +0..40 ms after render → 1230..1510 */
          var rows = [['Redis · session + rate limit', 0, 0.6, 3, 'A'], ['Postgres · claim shot 4 (CAS + outbox)', 0.6, 3, 1, 'A'],
            ['Vector DB · hybrid top-k + rerank', 3.6, 40, 4, 'A'], ['Object store · GET fox_sheet, sketch_2', 43.6, 40, 0, 'A'],
            ['Event log · append shot.rendering', 43.6, 5, 2, 'A'], ['GPU · render shot 4 (~95 s, off-scale)', 0, 0, -1, 'G'],
            ['Object store · PUT take 4a (write-once)', 0, 30, 0, 'B'], ['Lineage + log · edges, shot.rendered', 30, 5, 5, 'B']];
          var bars = rows.map(function (r, i) {
            var y = 400 + i * 50;
            var rg = ctx.group({ parent: wf });
            txt(ctx, 76, y, r[0], { size: 14, color: 'text', parent: rg });
            ctx.rect(XA, y - 12, 1510 - XA, 24, { rx: 4, fill: 'rgba(255,255,255,0.025)', parent: rg });
            var x, w, col = 'teal';
            if (r[4] === 'A') { x = XA + r[1] * SA; w = Math.max(4, r[2] * SA); }
            else if (r[4] === 'B') { x = XB + r[1] * SB; w = Math.max(4, r[2] * SB); }
            else { x = 1080; w = 190; col = 'red'; }
            var b = ctx.rect(x, y - 12, w, 24, { rx: 4, fill: ctx.alpha(col, 0.5), stroke: col, sw: 1.2, parent: rg });
            var lab = r[4] === 'G' ? '≈ 95 000 ms' : r[2] + ' ms';
            var tx = r[4] === 'G' ? txt(ctx, x + w / 2, y + 1, lab, { size: 12, font: 'mono', color: 'white', anchor: 'middle', weight: 700, parent: rg })
              : txt(ctx, x + w + 8, y + 1, lab, { size: 12, font: 'mono', color: col, parent: rg });
            b.setAttribute('width', 0);
            tx.setAttribute('opacity', 0);
            hide(rg);
            return { g: rg, bar: b, w: w, tx: tx, store: r[3] };
          });
          /* axes */
          var ay = 786;
          var axA = ctx.group({ parent: wf });
          ctx.line(XA, ay, 1150, ay, { color: 'faint', parent: axA });
          [0, 20, 40, 60, 80].forEach(function (v) { txt(ctx, XA + v * SA, ay + 16, v + '', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: axA }); });
          txt(ctx, 1150, ay + 16, 'ms', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: axA });
          var axBrk = ctx.group({ parent: wf });
          ctx.path('M1172,' + (ay + 10) + ' l10,-20 M1186,' + (ay + 10) + ' l10,-20', { stroke: 'red', sw: 2, parent: axBrk });
          var axB = ctx.group({ parent: wf });
          ctx.line(1220, ay, 1510, ay, { color: 'faint', parent: axB });
          [[0, '+95 s'], [20, '+20'], [40, '+40 ms']].forEach(function (t) { txt(ctx, XB + t[0] * SB, ay + 16, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: axB }); });
          var foot = txt(ctx, 800, 838, 'Everything except the GPU is milliseconds: the data plane must never be the reason a render waits.', { size: 14, color: 'teal', anchor: 'middle', parent: wf });
          hide(axA, axBrk, axB, foot);
          /* the four design rules */
          var rules = ctx.group({ parent: g });
          [['1', 'PASS BYTES BY REFERENCE', 'agents carry cas:// URIs and captions, never pixels', 'cyan'],
            ['2', 'ONE TRANSACTION FOR STATE + EVENT', 'the outbox keeps the database and the log from disagreeing', 'blue'],
            ['3', 'CACHES ARE FAST, NEVER CORRECT', 'every cached value is rebuildable; TTLs bound the staleness', 'teal'],
            ['4', 'A MANIFEST HASH ON EVERY ARTIFACT', 'reproducibility, memoisation and deletion come for free', 'lime']].forEach(function (u, i) {
            var x = 76 + (i % 2) * 740, y = 400 + Math.floor(i / 2) * 200;
            ctx.rect(x, y, 700, 160, { rx: 12, fill: ctx.mix('#070d1a', u[3], 0.09), stroke: ctx.alpha(u[3], 0.55), sw: 1.3, parent: rules });
            txt(ctx, x + 40, y + 60, u[0], { size: 44, font: 'display', weight: 700, color: lift(ctx, u[3]), anchor: 'middle', parent: rules });
            txt(ctx, x + 84, y + 56, u[1], { size: 17, font: 'display', weight: 700, color: 'white', parent: rules });
            txt(ctx, x + 84, y + 100, u[2], { size: 14, color: 'text', parent: rules });
          });
          hide(rules);
          function showRows(idx) {
            return idx.reduce(function (p, i) {
              return p.then(function () {
                var b = bars[i];
                ctx.reveal(b.g, { dur: 200 });
                if (b.store >= 0) ctx.pulse(S.st[b.store], { color: 'teal', dur: 500 });
                return ctx.animate(b.bar, { width: [0, b.w] }, 380, 'out').then(function () { return ctx.fade(b.tx, 1, 200); });
              });
            }, Promise.resolve());
          }

          /* beat 0: admission and claim */
          ctx.hud('Redis 0.6 ms + Postgres 3 ms = 3.6 ms');
          return ctx.reveal(wf, { from: 'up', dur: 500 }).then(function () { return ctx.reveal(axA); }).then(function () {
            return showRows([0, 1]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: retrieval, fetch, and the parallel log append */
            ctx.hud('critical path to GPU start ≈ 84 ms');
            return showRows([2, 3, 4]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the GPU render, off the scale */
            ctx.hud('GPU ≈ 95 s per shot (8 GPUs, ~760 GPU-s)');
            return ctx.reveal(axBrk).then(function () { return showRows([5]); }).then(function () {
              return ctx.pulse(bars[5].bar, { color: 'red', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: writing the result back */
            ctx.hud('data plane ≈ 0.12 s · GPU ≈ 95 s per shot');
            return ctx.reveal(axB).then(function () { return showRows([6, 7]); }).then(function () { return ctx.reveal(foot, { from: 'up' }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: four design rules, then on to vector memory */
            ctx.hud('');
            return ctx.fade(wf, 0, 500).then(function () { return ctx.reveal(rules, { from: 'up' }); }).then(function () {
              return ctx.pulse(S.st[4], { color: 'teal', times: 2, dur: 700 });
            });
          });
        }
      }
    ]
  });
})();
