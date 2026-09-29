/* L2 — Inference Load Balancing. The same 24 agent requests (colored by system-prompt prefix, width = cost)
 * are routed to 6 LLM replicas under different policies: round-robin, power-of-two-choices, consistent hashing
 * with bounded loads and prefix/KV-aware routing; then SLO admission, P/D disaggregation and pull queues for video. */
(function () {
  var ROLES = [['director', 'magenta'], ['writer', 'amber'], ['storyboard', 'violet'], ['camera', 'lime'], ['editor', 'orange'], ['critic', 'pink']];
  /* [prefix/role, cost units] in arrival order: heavy-tailed costs, skewed prefix popularity */
  var REQS = [[0, 2], [1, 1], [5, 1], [0, 6], [3, 1], [0, 1], [4, 2], [1, 9], [5, 1], [0, 2], [2, 1], [0, 1],
    [5, 2], [3, 7], [0, 1], [1, 2], [5, 1], [0, 1], [2, 1], [0, 1], [4, 5], [5, 1], [1, 2], [3, 1]];
  var NR = 6, UNIT = 16, CAP = 2, QX = 890;
  var TOTAL = REQS.reduce(function (a, q) { return a + q[1]; }, 0);
  var R_ANG = [20, 75, 140, 200, 260, 320];      /* replica positions on the hash ring (deg) */
  var P_ANG = [35, 90, 150, 170, 280, 330];      /* prefix hash positions */
  function repY(i) { return 196 + i * 60; }
  function nb(s) { return s.replace(/ /g, ' '); }

  function simulate(rng, policy, T) {
    var loads = [0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0], caches = [[], [], [], [], [], []], assign = [], hits = 0;
    REQS.forEach(function (q, i) {
      var p = q[0], cost = q[1], r = 0, cand = null, walk = 0, start = 0, k;
      if (policy === 'rr') r = i % NR;
      else if (policy === 'p2c') {
        var a = Math.floor(rng() * NR), b = Math.floor(rng() * (NR - 1));
        if (b >= a) b++;
        r = loads[a] <= loads[b] ? a : b; cand = [a, b];
      } else if (policy === 'chbl') {
        start = 0;
        for (k = 0; k < NR; k++) if (R_ANG[k] >= P_ANG[p]) { start = k; break; }
        if (P_ANG[p] > R_ANG[NR - 1]) start = 0;
        var capN = Math.ceil(1.25 * (i + 1) / NR);
        r = start;
        while (counts[r] >= capN) { r = (r + 1) % NR; walk++; }
      } else {
        var minL = Math.min.apply(null, loads), best = -1;
        for (k = 0; k < NR; k++) if (caches[k].indexOf(p) >= 0 && (best < 0 || loads[k] < loads[best])) best = k;
        if (best >= 0 && loads[best] <= minL + T) r = best;
        else { r = 0; for (k = 1; k < NR; k++) if (loads[k] < loads[r]) r = k; }
      }
      var ci = caches[r].indexOf(p), hit = ci >= 0;
      if (hit) { hits++; caches[r].splice(ci, 1); caches[r].push(p); }
      else { caches[r].push(p); if (caches[r].length > CAP) caches[r].shift(); }
      loads[r] += cost; counts[r]++;
      assign.push({ r: r, p: p, cost: cost, hit: hit, cand: cand, walk: walk, start: start });
    });
    var mx = Math.max.apply(null, loads);
    return { assign: assign, loads: loads, caches: caches, hits: hits, ratio: mx / (TOTAL / NR), maxR: loads.indexOf(mx) };
  }

  /* draw queues for a simulation; animate arrivals unless fast */
  function showQueues(ctx, S, sim, fast) {
    if (S.qG) ctx.remove(S.qG, 250);
    var g = ctx.group();
    S.qG = g;
    var fill = [0, 0, 0, 0, 0, 0], DT = 150;
    sim.assign.forEach(function (a, i) {
      var y = repY(a.r), x = QX + fill[a.r] * UNIT, w = a.cost * UNIT - 2;
      fill[a.r] += a.cost;
      var it = ctx.group({ parent: g });
      var col = ROLES[a.p][1];
      ctx.rect(x + 1, y - 11, w, 22, { rx: 3, fill: ctx.alpha(col, 0.55), stroke: col, sw: 1, parent: it });
      ctx.rect(x + 1, y + 13, w, 3, { rx: 1, fill: a.hit ? ctx.color('lime') : ctx.color('red'), parent: it });
      if (!fast) {
        ctx.reveal(it, { from: 'left', dur: 250, dist: 10, delay: 450 + i * DT });
        ctx.after(i * DT, function () {
          ctx.packet(S.inLink, { color: col, dur: 220, r: 4 }).then(function () {
            return ctx.packet(S.rl[a.r], { color: col, dur: 260, r: 4 });
          });
        });
      }
    });
    S.sumT.forEach(function (t, r) { t.textContent = 'Σ' + sim.loads[r]; });
    S.tags.forEach(function (tg, r) {
      tg.forEach(function (el, k) {
        var p = sim.caches[r][k];
        el.setAttribute('fill', p === undefined ? ctx.alpha('white', 0.06) : ctx.color(ROLES[p][1]));
      });
    });
    return fast ? Promise.resolve() : ctx.wait(450 + sim.assign.length * DT + 300);
  }

  function setMetrics(ctx, S, name, sim) {
    S.mPolicy.textContent = name;
    S.mRatio.textContent = sim.ratio.toFixed(2) + '×';
    S.mRatio.setAttribute('fill', ctx.color(sim.ratio > 1.5 ? 'red' : (sim.ratio > 1.25 ? 'amber' : 'lime')));
    S.mHit.textContent = Math.round(100 * sim.hits / REQS.length) + '%';
    S.mSaved.textContent = (sim.hits * 6) + 'k tok';
  }

  function swapBottom(ctx, S, g) {
    if (S.botG) ctx.remove(S.botG, 350);
    S.botG = g;
    ctx.reveal(g, { from: 'up', dur: 500, delay: 200 });
  }
  function title(ctx, g, x, y, s, col) {
    ctx.text(x, y, s, { size: 13, color: col || 'red', font: 'display', weight: 700, spacing: 1, parent: g });
  }

  Atlas.register({
    id: 'load-balancing',
    refs: [
      'Mitzenmacher, <i>The Power of Two Choices in Randomized Load Balancing</i>, IEEE TPDS 2001; Azar, Broder, Karlin &amp; Upfal, <i>Balanced Allocations</i>, SIAM J. Comput. 1999',
      'Karger et al., <i>Consistent Hashing and Random Trees</i>, STOC 1997',
      'Mirrokni, Thorup &amp; Zadimoghaddam, <i>Consistent Hashing with Bounded Loads</i>, SODA 2018',
      'Zheng et al., <i>SGLang: Efficient Execution of Structured Language Model Programs</i> (RadixAttention, cache-aware router), NeurIPS 2024',
      'Zhong et al., <i>DistServe: Disaggregating Prefill and Decoding for Goodput-optimized LLM Serving</i>, OSDI 2024',
      'Qin et al., <i>Mooncake: A KVCache-centric Disaggregated Architecture for LLM Serving</i>, FAST 2025',
      'NVIDIA <i>Dynamo</i> KV-aware router (2025); <i>llm-d</i> and Kubernetes <i>Gateway API Inference Extension</i> (2025)',
      'Harchol-Balter, <i>Performance Modeling and Design of Computer Systems: Queueing Theory in Action</i>, CUP 2013'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Why routing matters',
        say: 'Every agent call becomes a request that some replica must serve, and the router sits right in the data path with well under a millisecond to choose. The catch is that LLM requests are wildly unequal. A critic call might carry thirty thousand tokens of frames and notes, while a writer call generates two thousand tokens, one at a time. Costs are heavy tailed, and the output length is unknown when the request arrives. Routing that ignores this falls apart.',
        deep: '<p>Per-request cost has two very different parts:</p>' +
          '<div class="eq">T<sub>req</sub> ≈ T<sub>queue</sub> + L<sub>in</sub>/R<sub>prefill</sub> + L<sub>out</sub> · TPOT(batch)</div>' +
          '<p>Prefill is compute-bound (10<sup>4</sup> tok/s per TP4 replica for a 70B model), decode is HBM-bound (30–100 tok/s per stream). L<sub>out</sub> is unknown at routing time; L<sub>in</sub> is known but its cost depends on how much of it is already in some replica\'s KV cache.</p>' +
          '<p>Fleet-wide agent traffic is heavy-tailed: the plotted log-normal (median ≈ 2k tokens, σ ≈ 1.1) has p99 ≈ 26k, i.e. p99/p50 = e<sup>2.33σ</sup> ≈ 13. Our trailer alone spans ~6k (writer, 4k in + 2k out) to ~30k tokens (critic with frame captions).</p>' +
          '<p>The router is the place to fix this because it sees every request, but it must decide in &lt; 1 ms with slightly stale load information from replicas (engines export queue depth, running batch, KV-cache utilisation via metrics endpoints or a KV event bus).</p>' +
          '<div class="note">Width of each colored block below = estimated cost units; color = which agent\'s system prompt (prefix) it carries.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.main = ctx.group();
          S.agents = ctx.node({ x: 150, y: 360, w: 170, h: 70, title: 'Agents', sub: '6 agent roles', icon: 'agent', color: 'magenta', parent: S.main });
          S.router = ctx.node({ x: 480, y: 360, w: 190, h: 90, title: 'Router', sub: 'policy: —', icon: 'net', color: 'red', parent: S.main });
          S.inLink = ctx.link(S.agents, S.router, { color: 'magenta', straight: true, parent: S.main });
          S.legend = ctx.group({ parent: S.main });
          ROLES.forEach(function (r, i) {
            var x = 72 + (i % 2) * 88, y = 430 + Math.floor(i / 2) * 22;
            ctx.rect(x, y - 6, 12, 12, { rx: 2, fill: ctx.alpha(r[1], 0.7), stroke: r[1], sw: 1, parent: S.legend });
            ctx.text(x + 18, y, r[0], { size: 11, color: r[1], font: 'mono', parent: S.legend });
          });
          ctx.text(72, 502, 'color = system-prompt prefix', { size: 11, color: 'dim', font: 'mono', parent: S.legend });
          ctx.text(72, 520, 'width = cost · bar = hit/miss', { size: 11, color: 'dim', font: 'mono', parent: S.legend });
          S.reps = []; S.rl = []; S.sumT = []; S.tags = [];
          for (var i = 0; i < NR; i++) {
            var y = repY(i), g = ctx.group({ parent: S.main });
            g.body = ctx.rect(700, y - 23, 170, 46, { rx: 8, fill: 'url(#fx-panel-grad)', stroke: 'amber', sw: 1.3, parent: g });
            ctx.text(712, y - 8, 'replica ' + i, { size: 13, weight: 600, color: 'white', font: 'display', parent: g });
            ctx.text(712, y + 10, 'vLLM · TP4', { size: 11, color: 'dim', font: 'mono', parent: g });
            S.tags.push([0, 1].map(function (k) { return ctx.rect(826 + k * 18, y - 7, 14, 14, { rx: 3, fill: ctx.alpha('white', 0.06), stroke: ctx.alpha('white', 0.25), sw: 1, parent: g }); }));
            g.box = { x: 700, y: y - 23, w: 170, h: 46, cx: 785, cy: y, l: 700, r: 870, t: y - 23, b: y + 23 };
            ctx.rect(QX, y - 13, 360, 26, { rx: 4, fill: ctx.alpha('white', 0.03), stroke: ctx.alpha('white', 0.08), sw: 1, parent: g });
            S.sumT.push(ctx.text(1258, y, 'Σ0', { size: 12, color: 'text', font: 'mono', parent: g }));
            S.reps.push(g);
            S.rl.push(ctx.link(S.router, { x: 700, y: y }, { color: ctx.alpha('red', 0.55), sw: 1.3, arrow: false, parent: S.main }));
          }
          ctx.text(826, 162, 'KV cache', { size: 11, color: 'dim', font: 'mono', parent: S.main });
          ctx.text(QX, 162, 'outstanding work (queue)', { size: 11, color: 'dim', font: 'mono', parent: S.main });
          ctx.reveal(S.main, { dur: 700 });
          /* metrics panel */
          S.met = ctx.group();
          ctx.rect(1300, 168, 262, 262, { rx: 10, fill: 'rgba(6,12,24,0.9)', stroke: ctx.alpha('red', 0.5), sw: 1.2, parent: S.met });
          title(ctx, S.met, 1316, 190, 'ROUTER METRICS');
          S.mPolicy = ctx.text(1316, 222, '—', { size: 16, color: 'red', font: 'mono', weight: 700, parent: S.met });
          [['max / mean load', 262], ['prefix hit rate', 302], ['prefill saved', 342]].forEach(function (m) { ctx.text(1316, m[1], m[0], { size: 12, color: 'dim', font: 'mono', parent: S.met }); });
          S.mRatio = ctx.text(1548, 262, '—', { size: 20, color: 'white', font: 'mono', weight: 700, anchor: 'end', parent: S.met });
          S.mHit = ctx.text(1548, 302, '—', { size: 20, color: 'white', font: 'mono', weight: 700, anchor: 'end', parent: S.met });
          S.mSaved = ctx.text(1548, 342, '—', { size: 20, color: 'white', font: 'mono', weight: 700, anchor: 'end', parent: S.met });
          ctx.text(1316, 380, 'lime bar = prefix hit', { size: 11, color: 'lime', font: 'mono', parent: S.met });
          ctx.text(1316, 400, 'red bar  = miss, full prefill', { size: 11, color: 'red', font: 'mono', parent: S.met });
          ctx.reveal(S.met, { from: 'right', delay: 300 });
          /* bottom: heavy tail */
          var b = ctx.group();
          title(ctx, b, 80, 590, 'REQUEST COST IS HEAVY-TAILED');
          var mu = Math.log(2000), sg = 1.1, mode = Math.exp(mu - sg * sg);
          function pdf(x) { return x <= 0 ? 0 : Math.exp(-Math.pow(Math.log(x) - mu, 2) / (2 * sg * sg)) / x; }
          var pm = pdf(mode);
          var pl = ctx.plot(110, 625, 560, 200, function (x) { return pdf(x) / pm; }, { xDomain: [0, 30000], yDomain: [0, 1.1], color: 'amber', sw: 2.2, samples: 240, xLabel: 'tokens per request (in + out)', yLabel: 'density', parent: b });
          [[2000, 'p50 ≈ 2k'], [25800, 'p99 ≈ 26k']].forEach(function (q) {
            var p = pl.toPx(q[0], 0);
            ctx.line(p.x, 625, p.x, 825, { color: ctx.alpha('white', 0.35), dash: '4 4', parent: b });
            ctx.text(p.x + 6, 645, q[1], { size: 11, color: 'white', font: 'mono', parent: b });
          });
          ctx.text(400, 760, 'p99 / p50 ≈ 13×', { size: 13, color: 'amber', font: 'mono', weight: 600, anchor: 'middle', parent: b });
          ctx.text(760, 612, 'three trailer calls · seconds on a 70B TP4 replica (illustrative)', { size: 11, color: 'dim', font: 'mono', parent: b });
          var ex = [['director · plan()', 0.8, 30, '12k in / 1.5k out'], ['critic · judge(frames)', 2, 6, '30k in / 0.3k out'], ['writer · script()', 0.3, 40, '4k in / 2k out']];
          S.exBars = [];
          ex.forEach(function (e, i) {
            var y = 640 + i * 56;
            ctx.text(760, y, e[0], { size: 12, color: 'white', font: 'mono', parent: b });
            ctx.text(1540, y, e[3], { size: 11, color: 'dim', font: 'mono', anchor: 'end', parent: b });
            var pf = ctx.rect(760, y + 12, Math.max(4, e[1] * 18), 20, { rx: 3, fill: ctx.alpha('blue', 0.6), stroke: 'blue', sw: 1, parent: b });
            var dc = ctx.rect(760 + Math.max(4, e[1] * 18), y + 12, e[2] * 18, 20, { rx: 3, fill: ctx.alpha('amber', 0.5), stroke: 'amber', sw: 1, parent: b });
            ctx.text(760 + Math.max(4, e[1] * 18) + e[2] * 18 + 8, y + 22.5, (e[1] + e[2]).toFixed(1) + ' s', { size: 11, color: 'text', font: 'mono', parent: b });
            S.exBars.push(pf, dc);
          });
          ctx.rect(760, 812, 12, 12, { rx: 2, fill: ctx.alpha('blue', 0.6), parent: b });
          ctx.text(778, 818, 'prefill (compute-bound)', { size: 11, color: 'blue', font: 'mono', parent: b });
          ctx.rect(960, 812, 12, 12, { rx: 2, fill: ctx.alpha('amber', 0.6), parent: b });
          ctx.text(978, 818, 'decode (HBM-bound, length unknown upfront)', { size: 11, color: 'amber', font: 'mono', parent: b });
          swapBottom(ctx, S, b);
          ctx.reveal(pl.curve, { from: 'draw', dur: 1400, delay: 600 });
          S.exBars.forEach(function (bar, i) {
            var w = parseFloat(bar.getAttribute('width'));
            ctx.animate(bar, { width: [0, w] }, 600, 'out', 900 + i * 150);
          });
          return ctx.wait(600).then(function () {
            return Promise.all([0, 1, 2, 3].map(function (k) {
              return ctx.wait(k * 250).then(function () { return ctx.packet(S.inLink, { color: ROLES[k][1], dur: 600, r: 3 + k }); });
            }));
          }).then(function () { return ctx.wait(800); });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Round-robin fails',
        say: 'Round robin gives every replica the same number of requests, not the same amount of work. Watch the queues fill. Replica one happens to receive both a nine unit call and a seven unit call, and ends up with about twice the average load while others sit nearly idle. Everything queued behind the big calls waits, which is head of line blocking. Layer four balancers are even worse, because HTTP two multiplexes all of an agent\'s calls over one long lived connection, pinning them to one replica.',
        deep: '<p>Round-robin (and random) balance <b>counts</b>. With per-request work X of mean μ and variance σ², a replica receiving m requests has load with standard deviation σ√m, so the relative imbalance ~ (σ/μ)/√m does not vanish at the small m typical of LLM replicas (tens of concurrent requests, not thousands).</p>' +
          '<p><b>Head-of-line blocking</b>: engines admit requests FCFS into the running batch; KV-cache memory is the admission limit, so a 30k-token prompt can hold back many short ones until blocks free up.</p>' +
          '<p><b>L4 vs L7</b>: an L4 balancer (IPVS, cloud NLB) hashes the TCP 5-tuple once per connection. gRPC/HTTP-2 clients keep a few long-lived connections and multiplex thousands of requests over them → whole agents pinned to one pod. LLM routing must be L7 and request-aware (Envoy/Gateway API with an inference extension).</p>' +
          '<div class="note">Metric shown: max/mean outstanding work across replicas; it bounds how much capacity you must over-provision to hold the SLO on the hottest replica.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.router.subEl.textContent = 'round-robin';
          var sim = simulate(ctx.rng(1), 'rr');
          /* bottom: L4 pinning diagram */
          var b = ctx.group();
          title(ctx, b, 80, 590, 'L4 BALANCING PINS CONNECTIONS, NOT REQUESTS');
          var ag = [['director', 'magenta', 650], ['critic', 'pink', 760]];
          ctx.rect(330, 660, 130, 90, { rx: 10, fill: 'url(#fx-panel-grad)', stroke: 'blue', sw: 1.3, parent: b });
          ctx.text(395, 695, 'L4 LB', { size: 14, color: 'white', anchor: 'middle', font: 'display', weight: 600, parent: b });
          ctx.text(395, 715, 'hash(5-tuple)', { size: 11, color: 'blue', anchor: 'middle', font: 'mono', parent: b });
          S.l4 = [];
          ag.forEach(function (a, i) {
            ctx.rect(90, a[2] - 18, 130, 36, { rx: 18, fill: ctx.alpha(a[1], 0.15), stroke: a[1], sw: 1.2, parent: b });
            ctx.text(155, a[2] + 0.5, a[0], { size: 12, color: a[1], anchor: 'middle', font: 'mono', parent: b });
            var p1 = ctx.path('M220,' + a[2] + ' L330,' + (695 + i * 20), { stroke: a[1], sw: 3, parent: b });
            var p2 = ctx.path('M460,' + (695 + i * 20) + ' L600,' + (a[2]), { stroke: a[1], sw: 3, parent: b });
            ctx.rect(600, a[2] - 18, 110, 36, { rx: 8, fill: 'url(#fx-panel-grad)', stroke: 'amber', sw: 1.2, parent: b });
            ctx.text(655, a[2] + 0.5, 'replica ' + (i ? 4 : 1), { size: 12, color: 'white', anchor: 'middle', font: 'mono', parent: b });
            S.l4.push(p1, p2);
          });
          ctx.text(400, 820, 'one HTTP/2 connection per agent → every call lands on the same pod', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
          ctx.para(800, 650, ['Round-robin equalises COUNTS, not WORK:', '  every replica gets 4 requests,', '  but work ranges from 4 to 18 units.', '', 'Fixes, in order of sophistication:', '  least-outstanding-requests (needs fresh state)', '  power-of-two-choices (robust to staleness)', '  cache-aware + SLO-aware routing (L7)'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: b });
          swapBottom(ctx, S, b);
          S.l4s = S.l4.map(function (p, i) { return ctx.stream(p, { color: i < 2 ? 'magenta' : 'pink', count: 3, period: 1400, r: 3 }); });
          return showQueues(ctx, S, sim, false).then(function () {
            setMetrics(ctx, S, 'round-robin', sim);
            return ctx.pulse(S.reps[sim.maxR], { color: 'red', dur: 700, times: 2 });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Two random choices',
        say: 'A better idea is to send each request to the replica with the least outstanding work. But that needs fresh global state, and when several routers act on the same stale view, they all pick the same idle replica and stampede it. The power of two choices is the elegant fix: sample two replicas at random and pick the less loaded one. That tiny change stops the overload from growing with total load. The gap above average stays near log log n, essentially a constant.',
        deep: '<p>Balls-into-bins with n bins and m balls (Azar et al.; Berenbrink et al. 2000 for m ≫ n):</p>' +
          '<div class="eq">one choice: max − avg = Θ(√((m/n) · ln n))<br>d choices: max − avg = ln ln n / ln d + O(1)   (independent of m)</div>' +
          '<p>At m = n this is the famous drop from ln n / ln ln n to ln ln n / ln 2: an exponential improvement from one extra random probe; a third probe helps only by a constant factor.</p>' +
          '<pre>def pick(replicas):\n    a, b = random.sample(replicas, 2)\n    return a if load(a) &lt;= load(b) else b</pre>' +
          '<p><b>Why not always join-the-shortest-queue?</b> With k routers and load reports delayed by Δ, JSQ sends everything in Δ to the same "idle" replica (herd behaviour), creating oscillation. Random sampling decorrelates routers (Mitzenmacher, "How useful is old information?"). Envoy\'s <code>LEAST_REQUEST</code> balancer is P2C over active-request counts when host weights are equal (<code>choice_count</code> defaults to 2).</p>' +
          '<div class="note">Load here = outstanding cost units. Real routers use queued prefill tokens + running decode sequences, or KV-cache utilisation.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.router.subEl.textContent = 'P2C';
          if (S.l4s) S.l4s.forEach(function (h) { h.stop(); });
          var sim = simulate(ctx.rng(7), 'p2c');
          /* bottom: gap vs m/n */
          var b = ctx.group();
          title(ctx, b, 80, 590, 'MAX LOAD − AVERAGE vs BALLS PER BIN (n = 64 replicas)');
          var ln64 = Math.log(64);
          var pl1 = ctx.plot(130, 625, 560, 200, function (x) { return Math.sqrt(2 * Math.pow(10, x) * ln64); }, { xDomain: [0, 3], yDomain: [0, 100], color: 'red', sw: 2.2, yLabel: 'overload (requests)', parent: b });
          var pl2 = ctx.plot(130, 625, 560, 200, function () { return Math.log(ln64) / Math.LN2; }, { xDomain: [0, 3], yDomain: [0, 100], color: 'lime', sw: 2.6, axes: false, parent: b });
          ctx.text(560, 660, 'one random choice', { size: 12, color: 'red', font: 'mono', anchor: 'end', parent: b });
          ctx.text(560, 678, '≈ √(2·(m/n)·ln n)', { size: 11, color: 'red', font: 'mono', anchor: 'end', parent: b });
          ctx.text(690, 800, 'two choices ≈ ln ln n / ln 2 ≈ 2', { size: 12, color: 'lime', font: 'mono', anchor: 'end', parent: b });
          [0, 1, 2, 3].forEach(function (k) { var p = pl1.toPx(k, 0); ctx.text(p.x, 842, String(Math.pow(10, k)), { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b }); });
          ctx.text(410, 864, 'balls per bin  m / n  (log scale)', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
          ctx.para(800, 650, ['pick(replicas):', '  a, b = sample(replicas, 2)', '  return a if load(a) <= load(b) else b', '', 'one extra probe → exponential gain', 'robust to stale load reports', 'O(1) per decision, no global lock'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: b });
          swapBottom(ctx, S, b);
          ctx.reveal([pl1.curve, pl2.curve], { from: 'draw', dur: 1200, delay: 500, stagger: 300 });
          /* show the two probes for the first requests */
          S.probeG = ctx.group();
          sim.assign.slice(0, 8).forEach(function (a, i) {
            ctx.after(i * 150, function () {
              var ls = a.cand.map(function (c) {
                return ctx.line(575, 360, 700, repY(c), { color: c === a.r ? 'lime' : ctx.alpha('white', 0.45), sw: c === a.r ? 2 : 1.2, dash: '4 4', parent: S.probeG });
              });
              ctx.after(260, function () { ls.forEach(function (l) { ctx.remove(l, 150); }); });
            });
          });
          return showQueues(ctx, S, sim, false).then(function () {
            setMetrics(ctx, S, 'two choices', sim);
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Consistent hashing',
        say: 'Balance is only half the story, because LLM replicas are stateful: each keeps a cache of recently seen prompt prefixes. Consistent hashing maps each prefix to a point on a ring and sends it to the next replica clockwise, so the same agent keeps hitting the same warm cache, and adding a replica moves only a small fraction of keys. Plain hashing would overload whoever owns the hot director prompt. Bounded loads caps every replica at one plus epsilon times the average, and overflow walks on to the next replica.',
        deep: '<p><b>Consistent hashing</b> (Karger et al.): replicas and keys hash onto a ring; a key belongs to the first replica clockwise. Adding or removing one of n replicas remaps only ~K/n keys (vs almost all with <code>hash mod n</code>). Virtual nodes (e.g. 100–200 per replica) smooth ownership; Maglev hashing gives near-perfect balance with O(1) lookups.</p>' +
          '<p><b>Bounded loads</b> (Mirrokni, Thorup, Zadimoghaddam): every replica has capacity</p>' +
          '<div class="eq">c = ⌈(1 + ε) · m / n⌉</div>' +
          '<p>and a key whose owner is full walks clockwise to the next replica with room. Max load ≤ (1+ε)·avg by construction while most keys keep their home; with ε = 0.25 here. Deployed in Google Cloud Pub/Sub, Vimeo\'s video delivery and HAProxy (<code>hash-balance-factor</code>).</p>' +
          '<p>For LLMs the key is the prompt prefix (or session id), so affinity ≈ cache hits. Its weakness: it balances request <i>counts</i> and knows nothing about which blocks are actually still cached — the next step fixes that.</p>',
        run: function (ctx) {
          var S = ctx.state;
          S.router.subEl.textContent = 'CH+bounded';
          var sim = simulate(ctx.rng(3), 'chbl');
          var b = ctx.group();
          title(ctx, b, 80, 590, 'HASH RING · ε = 0.25 · capacity ⌈1.25·i/6⌉ requests');
          var cx = 330, cy = 740, R = 110;
          function pt(a, rr) { var t = a * Math.PI / 180; return { x: cx + (rr || R) * Math.sin(t), y: cy - (rr || R) * Math.cos(t) }; }
          ctx.circle(cx, cy, R, { stroke: ctx.alpha('white', 0.3), sw: 2, parent: b });
          R_ANG.forEach(function (a, i) {
            var p = pt(a), q = pt(a, R + 28);
            ctx.circle(p.x, p.y, 9, { fill: '#1a2238', stroke: 'amber', sw: 2, parent: b });
            ctx.text(q.x, q.y, 'r' + i, { size: 12, color: 'amber', anchor: 'middle', font: 'mono', weight: 600, parent: b });
          });
          P_ANG.forEach(function (a, i) {
            var p = pt(a, R - 22);
            ctx.circle(p.x, p.y, 6, { fill: ROLES[i][1], parent: b });
          });
          ctx.text(cx, cy - 6, 'clockwise', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
          ctx.text(cx, cy + 10, '→ owner', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
          /* first overflow walk */
          var ov = null;
          sim.assign.forEach(function (a) { if (!ov && a.walk > 0) ov = a; });
          S.walkDot = ctx.circle(0, 0, 7, { fill: ov ? ROLES[ov.p][1] : 'magenta', stroke: 'white', sw: 1.5, parent: b, glow: true });
          S.walkDot.setAttribute('opacity', 0);
          ctx.para(560, 640, ['plain ring (no bound):', '  director (hot) → r1', '  r4 owns no prefix at all', '', 'bounded loads:', '  owner full → walk clockwise', '  max load ≤ (1+ε)·avg', '  +1 replica moves ~1/n of keys'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: b });
          ctx.para(1000, 640, ['used for:', '  session / prefix affinity', '  Envoy ring_hash, Maglev', '  HAProxy hash-balance-factor', '', 'blind spot:', '  balances COUNTS, not cost,', '  and cannot see cache evictions'].map(nb), { size: 12, color: 'dim', font: 'mono', lh: 22, parent: b });
          swapBottom(ctx, S, b);
          return showQueues(ctx, S, sim, false).then(function () {
            setMetrics(ctx, S, 'CH + bounded', sim);
            if (!ov) return null;
            var a0 = P_ANG[ov.p], a1 = R_ANG[ov.r] < a0 ? R_ANG[ov.r] + 360 : R_ANG[ov.r];
            S.walkDot.setAttribute('opacity', 1);
            return ctx.tween(1600, function (t) {
              var p = pt(a0 + (a1 - a0) * t);
              S.walkDot.setAttribute('cx', p.x); S.walkDot.setAttribute('cy', p.y);
            }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Prefix-aware routing',
        say: 'Modern LLM routers look inside the KV cache itself. The SGLang router, llm-d and NVIDIA Dynamo track which prefixes each replica holds, in a radix tree, and send a request to the replica with the longest match, unless that replica is too far above the least loaded one. A hit skips most of prefill: the director\'s nine thousand token system prompt and tool schemas are already computed. Click the threshold chips on the right to trade cache hits against load balance yourself.',
        deep: '<p><b>RadixAttention</b> (SGLang) keeps KV blocks in a radix tree keyed by token ids with LRU eviction; a request reuses the longest cached prefix and only prefills the suffix. The router keeps an <i>approximate</i> tree per worker (or consumes KV-cache events, as Dynamo does).</p>' +
          '<p>Decision rule used here (SGLang-router style, threshold T in cost units):</p>' +
          '<pre>h = longest-prefix replica (tie: least load)\nif h and load[h] &lt;= min(load) + T:\n    route h            # hit\nelse:\n    route argmin(load) # miss, cache there</pre>' +
          '<p>Scoring variants: llm-d\'s scheduler sums weighted scorers (prefix-cache, KV-utilisation, queue depth); Dynamo computes cost = w·(blocks to prefill) + (decode load). The trade-off is explicit: T = 0 degenerates to least-loaded (low hit rate), T = ∞ to pure affinity (hot prefixes overload one replica). On the 24 requests shown (2-prefix LRU per replica):</p>' +
          '<table><tr><th>T</th><th>hit rate</th><th>max/mean</th></tr><tr><td>0</td><td>29%</td><td>1.25×</td></tr><tr><td>6</td><td>67%</td><td>1.25×</td></tr><tr><td>∞</td><td>75%</td><td>1.70×</td></tr></table>' +
          '<div class="eq">saved prefill ≈ hits × L<sub>prefix</sub><br>TTFT<sub>hit</sub> ≈ (L − L<sub>prefix</sub>)/R<sub>prefill</sub></div>' +
          '<p>With ~6k shared tokens per agent prompt, a 67% hit rate removes most prefill FLOPs and cuts TTFT for the common case from ~0.6 s to ~0.1 s.</p>',
        run: function (ctx) {
          var S = ctx.state;
          S.router.subEl.textContent = 'prefix-aware';
          S.T = 6;
          var sim = simulate(ctx.rng(5), 'prefix', S.T);
          /* toggles */
          S.tog = ctx.group();
          ctx.text(1300, 462, 'imbalance threshold T (click):', { size: 11, color: 'dim', font: 'mono', parent: S.tog });
          S.togChips = [[0, 'T = 0'], [6, 'T = 6'], [Infinity, 'T = ∞']].map(function (tv, i) {
            var c = ctx.label(1340 + i * 88, 492, tv[1], { color: 'cyan', size: 12, w: 76, parent: S.tog });
            c.style.cursor = 'pointer';
            c.addEventListener('click', function () {
              if (ctx.dead) return;
              S.T = tv[0];
              S.togChips.forEach(function (o, k) { o.setAttribute('opacity', k === i ? 1 : 0.45); });
              var s2 = simulate(ctx.rng(5), 'prefix', S.T);
              showQueues(ctx, S, s2, true);
              setMetrics(ctx, S, 'prefix · ' + tv[1], s2);
            });
            return c;
          });
          S.togChips.forEach(function (o, k) { o.setAttribute('opacity', k === 1 ? 1 : 0.45); });
          ctx.reveal(S.tog, { delay: 400 });
          /* bottom: radix tree */
          var b = ctx.group();
          title(ctx, b, 80, 590, 'RADIX TREE OF CACHED PREFIXES · replica 0');
          var nodes = [[120, 700, 'root', 'dim'], [300, 650, 'sys: director · 6k', 'magenta'], [300, 760, 'sys: critic · 5k', 'pink'],
            [520, 650, 'tools: 14 schemas · 3k', 'magenta'], [740, 620, 'turn 1..2 · 2k', 'magenta'], [740, 690, 'turn 3 · new', 'lime'], [520, 760, 'frames 1-6 · 20k', 'pink']];
          var edges = [[0, 1], [0, 2], [1, 3], [3, 4], [3, 5], [2, 6]];
          edges.forEach(function (e) {
            var a = nodes[e[0]], c = nodes[e[1]];
            ctx.path('M' + (a[0] + 80) + ',' + a[1] + ' C' + (a[0] + 110) + ',' + a[1] + ' ' + (c[0] - 110) + ',' + c[1] + ' ' + (c[0] - 80) + ',' + c[1], { stroke: ctx.alpha(c[3], 0.6), sw: 1.4, parent: b });
          });
          S.match = ctx.path('M200,700 C210,700 210,650 220,650 L380,650 L440,650 L600,650 C630,650 630,690 660,690', { stroke: 'lime', sw: 3.5, parent: b, glow: true });
          nodes.forEach(function (n, i) {
            var hit = i === 1 || i === 3;
            ctx.rect(n[0] - 80, n[1] - 15, 160, 30, { rx: 6, fill: '#0c1428', stroke: hit ? 'lime' : n[3], sw: hit ? 2.2 : 1.2, parent: b });
            ctx.rect(n[0] - 80, n[1] - 15, 160, 30, { rx: 6, fill: ctx.alpha(n[3], 0.12), parent: b });
            ctx.text(n[0], n[1] + 0.5, n[2], { size: 11, color: n[3], anchor: 'middle', font: 'mono', parent: b });
          });
          ctx.text(120, 820, 'new director request: 9k-token prefix matched → prefill only ~0.5k new tokens', { size: 12, color: 'lime', font: 'mono', parent: b });
          ctx.para(900, 632, ['router state per replica:', '  approx. radix tree of routed prompts', '  or exact KV-block events (Dynamo)', '', 'score = prefix match − load penalty', 'systems: SGLang router, llm-d,', '  NVIDIA Dynamo, AIBrix, Envoy AI GW'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: b });
          swapBottom(ctx, S, b);
          ctx.reveal(S.match, { from: 'draw', dur: 1200, delay: 900 });
          return showQueues(ctx, S, sim, false).then(function () {
            setMetrics(ctx, S, 'prefix · T = 6', sim);
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'SLOs & queueing',
        say: 'Even perfect routing cannot beat queueing theory. Latency grows like one over one minus utilization, so at ninety percent load a request spends about ten times its service time in the system, and heavy tailed service makes it much worse. So the router enforces service level objectives. It predicts time to first token from each replica\'s queued prefill work, and when no replica can meet the target, it sheds or defers the request instead of letting everyone miss. Here a retry from the critic gets a polite four twenty nine.',
        deep: '<p>M/G/1 (Pollaczek–Khinchine), mean response time in units of mean service time S:</p>' +
          '<div class="eq">W / S = 1 + ρ · (1 + C<sub>s</sub><sup>2</sup>) / (2 (1 − ρ))</div>' +
          '<p>C<sub>s</sub><sup>2</sup> = 1 reduces to M/M/1: W/S = 1/(1−ρ). For a latency budget of 8·S the admissible utilisation is ρ ≤ 0.875 with C<sub>s</sub><sup>2</sup> = 1 but only ρ ≤ 0.74 with C<sub>s</sub><sup>2</sup> = 4 — heavy tails cost ~14 points of utilisation. Kingman generalises to G/G/1: W<sub>q</sub> ≈ (ρ/(1−ρ))·((C<sub>a</sub><sup>2</sup>+C<sub>s</sub><sup>2</sup>)/2)·S.</p>' +
          '<p><b>SLO-aware admission</b> (per request, at the router):</p>' +
          '<pre>ttft[r] = (queued_pf[r] + L_in - hit[r]) / R_pf\nif min(ttft) &gt; SLO_ttft:\n    429 + Retry-After, or spill to other pool\ndecode: cap batch so TPOT(batch) &lt;= SLO_tpot</pre>' +
          '<p>Metric that matters is <b>goodput</b>: requests/s that meet both TTFT and TPOT SLOs (DistServe). Priorities help: interactive creator-facing calls pre-empt batch critic retries.</p>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.tog) { ctx.fade(S.tog, 0.35, 400); S.tog.style.pointerEvents = 'none'; }
          /* admission gate on router */
          S.gate = ctx.group({ parent: S.main });
          ctx.rect(578, 330, 12, 60, { rx: 3, fill: ctx.alpha('pink', 0.3), stroke: 'pink', sw: 1.5, parent: S.gate });
          ctx.label(600, 300, 'SLO gate', { color: 'pink', size: 11, parent: S.gate });
          ctx.reveal(S.gate, { from: 'scale', delay: 200 });
          /* bottom: latency vs utilisation */
          var b = ctx.group();
          title(ctx, b, 80, 590, 'RESPONSE TIME vs UTILISATION (M/G/1)');
          function w(rho, cs2) { return Math.min(30, 1 + rho * (1 + cs2) / (2 * (1 - rho))); }
          var o = { xDomain: [0, 0.97], yDomain: [0, 30], sw: 2.2, parent: b };
          var p1 = ctx.plot(130, 625, 560, 200, function (r) { return w(r, 1); }, Object.assign({ color: 'cyan', yLabel: 'W / S' }, o));
          var p2 = ctx.plot(130, 625, 560, 200, function (r) { return w(r, 4); }, Object.assign({ color: 'red', axes: false }, o));
          var slo = p1.toPx(0, 8), q1 = p1.toPx(0.875, 8), q2 = p1.toPx(0.737, 8);
          ctx.line(130, slo.y, 690, slo.y, { color: 'pink', dash: '5 5', sw: 1.4, parent: b });
          ctx.text(136, slo.y - 10, 'SLO: W ≤ 8·S', { size: 11, color: 'pink', font: 'mono', parent: b });
          ctx.circle(q1.x, q1.y, 5, { fill: 'cyan', parent: b });
          ctx.circle(q2.x, q2.y, 5, { fill: 'red', parent: b });
          ctx.text(q2.x - 8, q2.y + 22, 'ρ ≤ 0.74', { size: 11, color: 'red', anchor: 'end', font: 'mono', parent: b });
          ctx.text(q1.x + 6, q1.y + 22, 'ρ ≤ 0.87', { size: 11, color: 'cyan', font: 'mono', parent: b });
          ctx.text(330, 660, 'C²=1 (M/M/1) cyan · C²=4 (heavy tail) red', { size: 11, color: 'dim', font: 'mono', parent: b });
          [0, 0.5, 0.9].forEach(function (r) { var p = p1.toPx(r, 0); ctx.text(p.x, 842, String(r), { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b }); });
          ctx.text(410, 864, 'utilisation ρ = λ / μ', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
          ctx.para(800, 640, ['admission at the router:', '  ttft_hat = queued_prefill / R_prefill', '           + uncached_prompt / R_prefill', '  if min_r ttft_hat > SLO → 429 / spill', '', 'optimise GOODPUT, not throughput:', '  req/s meeting TTFT and TPOT SLOs'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: b });
          swapBottom(ctx, S, b);
          ctx.reveal([p1.curve, p2.curve], { from: 'draw', dur: 1200, delay: 500, stagger: 250 });
          S.rej = ctx.label(470, 470, '429 · Retry-After: 2 s', { color: 'pink', size: 12, parent: S.main });
          ctx.reveal(S.rej, { from: 'scale', delay: 2200 });
          return ctx.wait(1400).then(function () {
            return ctx.packet(S.inLink, { color: 'pink', dur: 600, r: 6, label: 'critic retry' });
          }).then(function () {
            return ctx.pulse(S.gate, { color: 'pink', dur: 500 });
          }).then(function () {
            return ctx.packet(S.inLink, { color: 'red', dur: 700, r: 6, reverse: true, label: '429' });
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Prefill / decode split',
        say: 'Large deployments split each request in two. Prefill is compute bound, decode is memory bandwidth bound, and mixing them on one GPU makes decoding stutter whenever a big prompt arrives. With disaggregation, the router picks a prefill worker by queued compute, then a decode worker by free KV cache memory, and the KV cache moves between them over RDMA. For an eight thousand token prompt on a seventy billion parameter model, that is about two point seven gigabytes, roughly fifty milliseconds over a four hundred gigabit link.',
        deep: '<p><b>Why split</b>: a 30k-token prefill occupies the GPU for ~2 s; co-located decodes in the same batch see their TPOT spike (interference). Disaggregation lets each pool pick its own parallelism, batch size and even GPU type (compute-rich for prefill, HBM-rich for decode).</p>' +
          '<div class="eq">KV bytes = L · 2 · n<sub>layers</sub> · n<sub>kv</sub> · d<sub>head</sub> · b = 8192 · 2·80·8·128·2 B ≈ 2.7 GB<br>t<sub>xfer</sub> ≈ 2.7 GB / 50 GB/s ≈ 54 ms   (pipelined layer-by-layer, mostly hidden)</div>' +
          '<p>Routing is now two decisions: prefill worker (min queued prefill tokens, prefix hits) and decode worker (max free KV blocks, current TPOT). <b>Conditional disaggregation</b> (Dynamo, vLLM) prefills short prompts or high-hit requests locally on the decode worker, because the transfer would cost more than it saves.</p>' +
          '<p>Systems: DistServe, Splitwise, Mooncake (KV-centric, with a distributed KV store over RDMA), NVIDIA Dynamo with NIXL transfers, llm-d P/D, SGLang PD.</p>',
        run: function (ctx) {
          var S = ctx.state;
          S.pd = ctx.group();
          ctx.rect(40, 160, 1240, 405, { rx: 14, fill: 'rgba(5,9,18,0.96)', stroke: 'cyan', sw: 1.2, parent: S.pd, glow: true });
          title(ctx, S.pd, 64, 186, 'DISAGGREGATED PREFILL / DECODE', 'cyan');
          var rt = ctx.node({ x: 160, y: 370, w: 170, h: 70, title: 'Router', sub: 'two decisions', icon: 'net', color: 'red', parent: S.pd });
          var pf = [0, 1].map(function (i) { return ctx.node({ x: 470, y: 290 + i * 160, w: 230, h: 64, title: 'prefill ' + i, sub: 'H100 TP4 · compute-bound', icon: 'bolt', color: 'blue', parent: S.pd }); });
          var dc = [0, 1, 2].map(function (i) { return ctx.node({ x: 900, y: 250 + i * 120, w: 250, h: 64, title: 'decode ' + i, sub: 'H200 TP8 · HBM-bound', icon: 'layers', color: 'amber', parent: S.pd }); });
          var cl = ctx.node({ x: 1190, y: 370, w: 120, h: 60, title: 'Agent', sub: 'SSE', icon: 'agent', color: 'magenta', titleSize: 14, parent: S.pd });
          var l1 = pf.map(function (p) { return ctx.link(rt, p, { color: 'blue', parent: S.pd }); });
          S.kv = ctx.link(pf[0], dc[1], { color: 'teal', sw: 3, parent: S.pd });
          ctx.label(676, 240, 'KV 2.7 GB · RDMA 54 ms', { color: 'teal', size: 11, parent: S.pd });
          ctx.link(pf[1], dc[2], { color: ctx.alpha('teal', 0.4), sw: 1.4, parent: S.pd });
          var out = ctx.link(dc[1], cl, { color: 'amber', parent: S.pd });
          ctx.text(470, 385, 'pick: min queued prefill tokens', { size: 11, color: 'blue', anchor: 'middle', font: 'mono', parent: S.pd });
          ctx.text(900, 546, 'pick: max free KV blocks · TPOT', { size: 11, color: 'amber', anchor: 'middle', font: 'mono', parent: S.pd });
          ctx.focus([S.pd, S.met], 0.12);
          ctx.reveal(S.pd, { from: 'scale', s0: 0.94 });
          /* bottom */
          var b = ctx.group();
          title(ctx, b, 80, 600, 'WHY SPLIT · WHAT IT COSTS', 'cyan');
          ctx.para(80, 636, ['prefill: FLOP-bound, bursty, long (0.1–2 s)', 'decode : HBM-bound, steady, 20–50 ms/token', 'mixing both → TPOT spikes when prompts arrive', '', 'P/D: tune TP, batch, GPU type per phase'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: b });
          ctx.para(760, 636, ['cost: KV transfer over RDMA (NIXL, Mooncake)', '  8k tokens × 320 KB/token ≈ 2.7 GB', '  ≈ 54 ms at 50 GB/s, overlapped per layer', 'skip it when prompt is short or cache-hit', '  (conditional disaggregation)'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: b });
          swapBottom(ctx, S, b);
          return ctx.wait(700).then(function () {
            return ctx.packet(l1[0], { color: 'blue', dur: 600, label: '8k-tok prompt' });
          }).then(function () {
            return ctx.packet(S.kv, { color: 'teal', dur: 1000, r: 7, label: 'KV' });
          }).then(function () {
            S.outStream = ctx.stream(out, { color: 'amber', count: 5, period: 900, r: 3 });
            return ctx.wait(1500);
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Video: pull, not push',
        say: 'Video jobs flip the logic. A shot takes minutes on a whole eight GPU gang, so pushing it to a busy worker would strand it in a local queue. Instead, jobs wait in a durable broker, and workers pull the next job only when they are truly free. Each pull takes a lease that the worker keeps alive with heartbeats. If a worker dies, the lease expires and the shot is redelivered, and idempotent job keys make sure the trailer never pays for the same shot twice.',
        deep: '<table><tr><th></th><th>LLM request (push)</th><th>Video job (pull)</th></tr>' +
          '<tr><td>Duration</td><td>0.1–60 s</td><td>60–300 s</td></tr>' +
          '<tr><td>Worker concurrency</td><td>~100 in one batch</td><td>1 per 8-GPU gang</td></tr>' +
          '<tr><td>Who decides</td><td>router, per request</td><td>idle worker asks for work</td></tr>' +
          '<tr><td>Failure handling</td><td>client retry</td><td>lease timeout → redelivery</td></tr></table>' +
          '<p>Pull = <b>work-conserving</b> by construction: a job never waits in a busy worker\'s local queue while another gang idles (the "join-idle-queue" idea). Broker options: Redis Streams / SQS / Pub/Sub with visibility timeouts, or the workflow engine\'s task queue (Temporal task queues are pull-based).</p>' +
          '<pre>loop:\n  job = broker.lease("video", ttl=30)\n  heartbeat every 10 s (extend lease)\n  out = render(job)   # ckpt latents\n  store.put(job.idem_key, out)\n  broker.ack(job)</pre>' +
          '<p>Priority = multiple queues (interactive previews before batch), and "fetch" can be topology-aware (a GB200 gang pulls only jobs that need ≥16 GPUs).</p>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.outStream) S.outStream.stop();
          ctx.remove(S.pd, 400);
          S.vq = ctx.group();
          ctx.rect(40, 160, 1240, 405, { rx: 14, fill: 'rgba(5,9,18,0.96)', stroke: 'lime', sw: 1.2, parent: S.vq, glow: true });
          title(ctx, S.vq, 64, 186, 'VIDEO JOBS: DURABLE QUEUE + PULLING GANG WORKERS', 'lime');
          var br = ctx.node({ x: 300, y: 370, w: 280, h: 300, kind: 'ghost', color: 'lime', parent: S.vq });
          ctx.text(300, 240, 'broker · queue "video"', { size: 13, color: 'lime', anchor: 'middle', font: 'mono', weight: 600, parent: S.vq });
          /* the trailer's last two shots, the critic's re-render of shot 3, and another tenant's NVL72 job */
          S.jobs = [['shot5', '8 GPU · 40 steps', 'hi'], ['shot6', '8 GPU · 40 steps', 'hi'], ['shot3 redo', '8 GPU · critic', 'hi'], ['tenant-B', '16 GPU · NVL72', 'lo']].map(function (jb, i) {
            var g = ctx.group({ parent: S.vq });
            ctx.rect(190, 270 + i * 64, 220, 48, { rx: 8, fill: ctx.alpha('lime', 0.14), stroke: 'lime', sw: 1.2, parent: g });
            ctx.text(206, 288 + i * 64, jb[0] + ' · ' + jb[1], { size: 12, color: 'white', font: 'mono', parent: g });
            ctx.text(206, 306 + i * 64, 'key sha:' + ((i + 5) * 7919 % 9973).toString(16) + ' · prio ' + jb[2], { size: 11, color: 'dim', font: 'mono', parent: g });
            return g;
          });
          var st = [['gang A · 8×B200', 'busy · step 31/40', 'lime'], ['gang B · 8×B200', 'idle → lease()', 'cyan'], ['gang C · 8×H100', 'busy · step 9/40', 'lime']];
          S.wk = st.map(function (w, i) {
            return ctx.node({ x: 930, y: 250 + i * 120, w: 280, h: 70, title: w[0], sub: w[1], icon: 'gpu', color: w[2], parent: S.vq });
          });
          S.pull = ctx.link(S.wk[1], br, { color: 'cyan', dash: '5 5', label: 'pull: lease(ttl = 30 s)', labelDx: 70, labelDy: -18, parent: S.vq });
          S.hb = [0, 2].map(function (i) { return ctx.link(S.wk[i], br, { color: ctx.alpha('lime', 0.5), sw: 1.2, dash: '2 6', arrow: false, parent: S.vq }); });
          ctx.text(600, 548, 'heartbeat every 10 s extends the lease', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: S.vq });
          ctx.focus([S.vq, S.met], 0.12);
          ctx.reveal(S.vq, { from: 'scale', s0: 0.94, delay: 200 });
          S.hbs = S.hb.map(function (l) { return ctx.stream(l, { color: 'lime', count: 2, period: 2200, r: 2.5, reverse: true }); });
          /* bottom */
          var b = ctx.group();
          title(ctx, b, 80, 600, 'PUSH vs PULL', 'lime');
          ctx.para(80, 636, ['push (LLM): router picks replica per request', '  fine when work is short and batched', 'pull (video): idle gang asks the broker', '  work-conserving, no stranded jobs,', '  natural backpressure'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: b });
          ctx.para(760, 636, ['exactly-once effect = at-least-once delivery', '  + idempotency key on the output', 'lease expiry → redelivery after crash', 'checkpoint latents every N steps', '  → a retried shot resumes mid-denoise'].map(nb), { size: 12, color: 'text', font: 'mono', lh: 22, parent: b });
          swapBottom(ctx, S, b);
          return ctx.wait(900).then(function () {
            return ctx.packet(S.pull, { color: 'cyan', dur: 700, label: 'lease()' });
          }).then(function () {
            var j = S.jobs[0];
            var bx = S.wk[1].box;
            ctx.fade(S.pull, 0.45, 400);
            return ctx.transform(j, { x: bx.l - 422, y: bx.cy - 294 }, 900, 'inOut');
          }).then(function () {
            ctx.fadeOut(S.jobs[0], 400, true);
            S.wk[1].subEl.textContent = 'busy · shot5 · step 1/40';
            return ctx.pulse(S.wk[1], { color: 'lime', dur: 600 });
          }).then(function () {
            S.deadLbl = ctx.label(955, 548, 'gang C: node lost → lease expires → shot redelivered', { color: 'red', size: 11, parent: S.vq });
            ctx.reveal(S.deadLbl, { from: 'scale' });
            S.wk[2].body.setAttribute('stroke', ctx.color('red'));
            S.hbs[1].stop();
            return ctx.wait(1200);
          });
        }
      }
    ]
  });
})();
