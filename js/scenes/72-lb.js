/* L2 — Inference Load Balancing. The same 24 agent requests (colored by system-prompt prefix, width = cost)
 * are routed to 6 LLM replicas under different policies: round-robin, power-of-two-choices, consistent hashing
 * with bounded loads and prefix/KV-aware routing; then SLO admission, P/D disaggregation and pull queues for video.
 * Every step is split into beats (one idea each): narration, callout card, deep-dive chunk and animation segment. */
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

  /* policies: rr, p2c, ch (plain consistent hashing), chbl (bounded loads), prefix (T = imbalance threshold) */
  function simulate(rng, policy, T) {
    var loads = [0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0], caches = [[], [], [], [], [], []], assign = [], hits = 0;
    REQS.forEach(function (q, i) {
      var p = q[0], cost = q[1], r = 0, cand = null, walk = 0, start = 0, k;
      if (policy === 'rr') r = i % NR;
      else if (policy === 'p2c') {
        var a = Math.floor(rng() * NR), b = Math.floor(rng() * (NR - 1));
        if (b >= a) b++;
        r = loads[a] <= loads[b] ? a : b; cand = [a, b];
      } else if (policy === 'chbl' || policy === 'ch') {
        start = 0;
        for (k = 0; k < NR; k++) if (R_ANG[k] >= P_ANG[p]) { start = k; break; }
        if (P_ANG[p] > R_ANG[NR - 1]) start = 0;
        var capN = Math.ceil(1.25 * (i + 1) / NR);
        r = start;
        if (policy === 'chbl') while (counts[r] >= capN) { r = (r + 1) % NR; walk++; }
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
      assign.push({ r: r, p: p, cost: cost, hit: hit, cand: cand, walk: walk, start: start, cacheAfter: caches[r].slice() });
    });
    var mx = Math.max.apply(null, loads);
    return { assign: assign, loads: loads, counts: counts, caches: caches, hits: hits, ratio: mx / (TOTAL / NR), maxR: loads.indexOf(mx) };
  }

  /* build the queue blocks for a simulation, hidden; playQueues reveals them in arrival order */
  function buildQueues(ctx, S, sim, visible) {
    if (S.qG) ctx.remove(S.qG, 250);
    var g = ctx.group();
    S.qG = g;
    S.qItems = [];
    var fill = [0, 0, 0, 0, 0, 0];
    sim.assign.forEach(function (a) {
      var y = repY(a.r), x = QX + fill[a.r] * UNIT, w = a.cost * UNIT - 2;
      fill[a.r] += a.cost;
      var it = ctx.group({ parent: g });
      var col = ROLES[a.p][1];
      ctx.rect(x + 1, y - 11, w, 22, { rx: 3, fill: ctx.alpha(col, 0.55), stroke: col, sw: 1, parent: it });
      ctx.rect(x + 1, y + 13, w, 3, { rx: 1, fill: a.hit ? ctx.color('lime') : ctx.color('red'), parent: it });
      if (!visible) it.setAttribute('opacity', 0);
      S.qItems.push(it);
    });
    if (visible) applyState(ctx, S, sim, REQS.length);
    return g;
  }

  /* sums and KV-tag colours after the first n arrivals */
  function applyState(ctx, S, sim, n) {
    var acc = [0, 0, 0, 0, 0, 0], last = [null, null, null, null, null, null];
    for (var i = 0; i < n; i++) { var a = sim.assign[i]; acc[a.r] += a.cost; last[a.r] = a.cacheAfter; }
    S.sumT.forEach(function (t, r) { t.textContent = 'Σ' + acc[r]; });
    S.tags.forEach(function (tg, r) {
      tg.forEach(function (el, k) {
        var p = last[r] ? last[r][k] : undefined;
        el.setAttribute('fill', p === undefined ? ctx.alpha('white', 0.06) : ctx.color(ROLES[p][1]));
      });
    });
  }

  /* reveal arrivals from..to-1, one per dt ms, with a packet through the router; Σ sums and KV tags follow */
  function playQueues(ctx, S, sim, from, to, dt) {
    var DT = dt || 150, ps = [];
    var acc = [0, 0, 0, 0, 0, 0];
    for (var j = 0; j < from; j++) acc[sim.assign[j].r] += sim.assign[j].cost;
    for (var i = from; i < to; i++) {
      (function (i) {
        var a = sim.assign[i], col = ROLES[a.p][1], k = i - from;
        acc[a.r] += a.cost;
        var snap = acc[a.r];
        ps.push(ctx.reveal(S.qItems[i], { from: 'left', dur: 250, dist: 10, delay: 450 + k * DT }));
        ctx.after(k * DT, function () {
          ctx.packet(S.inLink, { color: col, dur: 220, r: 4 }).then(function () { return ctx.packet(S.rl[a.r], { color: col, dur: 260, r: 4 }); });
        });
        ctx.after(450 + k * DT, function () {
          S.sumT[a.r].textContent = 'Σ' + snap;
          S.tags[a.r].forEach(function (el, m) {
            var p = a.cacheAfter[m];
            el.setAttribute('fill', p === undefined ? ctx.alpha('white', 0.06) : ctx.color(ROLES[p][1]));
          });
        });
      })(i);
    }
    return Promise.all(ps);
  }

  /* clear the queues, sums, KV tags and metrics before a new policy */
  function resetQueues(ctx, S) {
    if (S.qG) { ctx.remove(S.qG, 250); S.qG = null; }
    S.sumT.forEach(function (t) { t.textContent = 'Σ0'; });
    S.tags.forEach(function (tg) { tg.forEach(function (el) { el.setAttribute('fill', ctx.alpha('white', 0.06)); }); });
    ['mPolicy', 'mRatio', 'mCnt', 'mHit', 'mSaved'].forEach(function (k) { S[k].textContent = '—'; });
    S.mRatio.setAttribute('fill', ctx.color('white'));
    S.mCnt.setAttribute('fill', ctx.color('white'));
  }

  function setMetrics(ctx, S, name, sim) {
    var mc = Math.max.apply(null, sim.counts);
    S.mPolicy.textContent = name;
    S.mRatio.textContent = sim.ratio.toFixed(2) + '×';
    S.mRatio.setAttribute('fill', ctx.color(sim.ratio > 1.5 ? 'red' : (sim.ratio > 1.25 ? 'amber' : 'lime')));
    S.mCnt.textContent = String(mc);
    S.mCnt.setAttribute('fill', ctx.color(mc > 6 ? 'red' : (mc > 5 ? 'amber' : 'lime')));
    S.mHit.textContent = Math.round(100 * sim.hits / REQS.length) + '%';
    S.mSaved.textContent = (sim.hits * 6) + 'k tok';
  }

  function swapBottom(ctx, S, g) {
    if (S.botG) ctx.remove(S.botG, 350);
    S.botG = g;
    ctx.reveal(g, { from: 'up', dur: 500, delay: 200 });
  }
  function title(ctx, g, x, y, s, col) {
    return ctx.text(x, y, s, { size: 13, color: col || 'red', font: 'display', weight: 700, spacing: 1, parent: g });
  }
  /* column-aligned / indented text needs a true monospace */
  function lines(ctx, parent, x, y, arr, o) {
    return ctx.para(x, y, arr, Object.assign({ size: 12, color: 'text', font: 'code', pre: true, lh: 22, parent: parent }, o || {}));
  }

  Atlas.register({
    id: 'load-balancing',
    refs: [
      'Mitzenmacher, <i>The Power of Two Choices in Randomized Load Balancing</i>, IEEE TPDS 2001; Azar, Broder, Karlin &amp; Upfal, <i>Balanced Allocations</i>, SIAM J. Comput. 1999',
      'Karger et al., <i>Consistent Hashing and Random Trees</i>, STOC 1997',
      'Mirrokni, Thorup &amp; Zadimoghaddam, <i>Consistent Hashing with Bounded Loads</i>, SODA 2018',
      'Zheng et al., <i>SGLang: Efficient Execution of Structured Language Model Programs</i> (RadixAttention), NeurIPS 2024',
      'Zhong et al., <i>DistServe: Disaggregating Prefill and Decoding for Goodput-optimized LLM Serving</i>, OSDI 2024; Patel et al., <i>Splitwise</i>, ISCA 2024',
      'Qin et al., <i>Mooncake: A KVCache-centric Disaggregated Architecture for LLM Serving</i>, FAST 2025',
      'NVIDIA <i>Dynamo</i> KV-aware router (2025); <i>llm-d</i> and Kubernetes <i>Gateway API Inference Extension</i> (2025)',
      'Harchol-Balter, <i>Performance Modeling and Design of Computer Systems: Queueing Theory in Action</i>, CUP 2013'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Why routing matters',
        beats: [
          {
            say: 'Every agent call becomes a request that some replica must serve, and the router sits right in the data path with well under a millisecond to choose.',
            card: { tag: 'NUMBERS', title: 'Decide in the data path', stat: { v: '< 1 ms', l: 'routing budget: the decision is made on every request, with slightly stale load information' } },
            deep: '<p>The router is the place to fix imbalance because it sees every request, but it must decide in &lt; 1 ms and with slightly stale information: engines export queue depth, running batch and KV-cache utilisation through metrics endpoints or a KV event bus, typically 10–100 ms behind reality.</p>' +
              '<p>Six replicas of a 70B model on TP4 (vLLM) serve the trailer\'s agents here. The same logic scales to hundreds of replicas.</p>'
          },
          {
            say: 'The catch is that LLM requests are wildly unequal. Across the fleet the cost of a request is heavy tailed: the slowest one percent cost about thirteen times the median.',
            card: {
              tag: 'NUMBERS', title: 'A heavy tail', stat: { v: '≈ 13×', l: 'p99 over p50 request cost for a log-normal with median 2k tokens and σ = 1.1' },
              more: '<p>The 99th percentile of a standard normal is z = 2.326, so p99/p50 = e<sup>2.326 × 1.1</sup> ≈ 12.9. The top 10% of requests carry 1 − Φ(1.28 − 1.1) ≈ 43% of all tokens, so a handful of requests dominate the work.</p>'
            },
            deep: '<p>Fleet-wide agent traffic is heavy-tailed: the plotted log-normal (median ≈ 2k tokens, σ ≈ 1.1) has p99 ≈ 26k tokens.</p>' +
              '<div class="eq">p99 / p50 = e<sup>2.33·σ</sup> ≈ e<sup>2.56</sup> ≈ 13</div>' +
              '<p>With such a tail, a small share of requests carries much of the work, so any policy that counts requests instead of cost will be dominated by them.</p>'
          },
          {
            say: 'A critic call might carry thirty thousand tokens of frames and notes, while a writer call generates two thousand tokens, one at a time. And the length of the answer is unknown when the request arrives.',
            card: { tag: 'PITFALL', title: 'The answer length is unknowable', body: 'The router sees the prompt but not the reply. A short prompt can trigger a 2,000-token generation, so every cost estimate is partly a guess.' },
            deep: '<p>Per-request cost has two very different parts:</p>' +
              '<div class="eq">T<sub>req</sub> ≈ T<sub>queue</sub> + L<sub>in</sub>/R<sub>prefill</sub> + L<sub>out</sub> · TPOT(batch)</div>' +
              '<p>Prefill is compute-bound (10<sup>4</sup> tok/s per TP4 replica for a 70B model), decode is HBM-bound (30–100 tok/s per stream). L<sub>out</sub> is unknown at routing time; L<sub>in</sub> is known but its cost depends on how much of it is already in some replica\'s KV cache. Our trailer alone spans ~6k (writer, 4k in + 2k out) to ~30k tokens (critic with frame captions). The bars are seconds on such a replica (illustrative).</p>'
          },
          {
            say: 'Routing that ignores this falls apart. From here on each request is drawn with a width for its cost and a color for the system prompt it carries, and the router is judged on balance and on cache hits.',
            card: { tag: 'KEY IDEA', title: 'Two scores: balance and cache hits', body: 'Balance is max load over mean load. Cache hits count how often a request lands where its prompt prefix is already computed. The two pull in opposite directions.' },
            deep: '<div class="note">Width of each colored block = estimated cost units; color = which agent\'s system prompt (prefix) it carries.</div>' +
              '<p><b>max / mean load</b>: the busiest replica\'s outstanding work over the fleet average, a proxy for how much you must over-provision to hold the SLO on the hottest replica. <b>prefix hit rate</b>: share of requests routed to a replica that already caches their prefix (a 2-prefix LRU per replica here). <b>prefill saved</b> assumes ~6k shared tokens per agent prompt.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.main = ctx.group();
          S.agents = ctx.node({ x: 150, y: 360, w: 170, h: 70, title: 'Agents', sub: '6 agent roles', icon: 'agent', color: 'magenta', parent: S.main });
          S.router = ctx.node({ x: 480, y: 360, w: 190, h: 90, title: 'Router', sub: 'policy: —', icon: 'net', color: 'red', parent: S.main });
          S.inLink = ctx.link(S.agents, S.router, { color: 'magenta', straight: true, parent: S.main });
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
          S.kvHdr = ctx.text(826, 162, 'KV cache', { size: 11, color: 'dim', font: 'mono', parent: S.main });
          S.qHdr = ctx.text(QX + 16, 162, 'outstanding work (queue)', { size: 11, color: 'dim', font: 'mono', parent: S.main });
          /* beat 0: agents, router, replicas */
          return Promise.all([
            ctx.reveal([S.agents, S.router], { from: 'left', stagger: 150 }),
            ctx.reveal(S.inLink, { from: 'draw', delay: 300 }),
            ctx.reveal(S.reps, { from: 'right', delay: 500, stagger: 90 }),
            ctx.reveal(S.rl, { from: 'draw', delay: 700, stagger: 80 }),
            ctx.reveal([S.kvHdr, S.qHdr], { delay: 900 })
          ]).then(function () {
            return Promise.all([0, 1, 2, 3].map(function (k) {
              return ctx.wait(k * 250).then(function () { return ctx.packet(S.inLink, { color: ROLES[k][1], dur: 600, r: 3 + k }); });
            }));
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the request cost is heavy-tailed */
            var b = ctx.group();
            title(ctx, b, 80, 590, 'REQUEST COST IS HEAVY-TAILED');
            var mu = Math.log(2000), sg = 1.1, mode = Math.exp(mu - sg * sg);
            function pdf(x) { return x <= 0 ? 0 : Math.exp(-Math.pow(Math.log(x) - mu, 2) / (2 * sg * sg)) / x; }
            var pm = pdf(mode);
            var pl = ctx.plot(110, 625, 560, 200, function (x) { return pdf(x) / pm; }, { xDomain: [0, 30000], yDomain: [0, 1.1], color: 'amber', sw: 2.2, samples: 240, xLabel: 'tokens per request (in + out)', yLabel: 'density', parent: b });
            var marks = [];
            [[2000, 'p50 ≈ 2k'], [25800, 'p99 ≈ 26k']].forEach(function (q) {
              var p = pl.toPx(q[0], 0);
              var mg = ctx.group({ parent: b });
              ctx.line(p.x, 625, p.x, 825, { color: ctx.alpha('white', 0.35), dash: '4 4', parent: mg });
              ctx.text(p.x + 6, 645, q[1], { size: 11, color: 'white', font: 'mono', parent: mg });
              marks.push(mg);
            });
            var ratio = ctx.text(400, 760, 'p99 / p50 ≈ 13×', { size: 13, color: 'amber', font: 'mono', weight: 600, anchor: 'middle', parent: b });
            ratio.setAttribute('opacity', 0);
            swapBottom(ctx, S, b);
            S.tailB = b;
            return ctx.reveal(pl.curve, { from: 'draw', dur: 1400, delay: 500 }).then(function () {
              return Promise.all([ctx.reveal(marks, { from: 'down', dist: 10, stagger: 250 }), ctx.reveal(ratio, { from: 'up', dist: 10, delay: 400 })]);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: three real calls, prefill versus decode */
            var b = S.tailB;
            var g = ctx.group({ parent: b });
            ctx.text(760, 612, 'three trailer calls · seconds on a 70B TP4 replica (illustrative)', { size: 11, color: 'dim', font: 'mono', parent: g });
            var ex = [['director · plan()', 0.8, 30, '12k in / 1.5k out'], ['critic · judge(frames)', 2, 6, '30k in / 0.3k out'], ['writer · script()', 0.3, 40, '4k in / 2k out']];
            S.exBars = [];
            ex.forEach(function (e, i) {
              var y = 640 + i * 56;
              ctx.text(760, y, e[0], { size: 12, color: 'white', font: 'mono', parent: g });
              ctx.text(1540, y, e[3], { size: 11, color: 'dim', font: 'mono', anchor: 'end', parent: g });
              var pf = ctx.rect(760, y + 12, Math.max(4, e[1] * 18), 20, { rx: 3, fill: ctx.alpha('blue', 0.6), stroke: 'blue', sw: 1, parent: g });
              var dc = ctx.rect(760 + Math.max(4, e[1] * 18), y + 12, e[2] * 18, 20, { rx: 3, fill: ctx.alpha('amber', 0.5), stroke: 'amber', sw: 1, parent: g });
              var tt = ctx.text(760 + Math.max(4, e[1] * 18) + e[2] * 18 + 8, y + 22.5, (e[1] + e[2]).toFixed(1) + ' s', { size: 11, color: 'text', font: 'mono', parent: g });
              pf._w = parseFloat(pf.getAttribute('width')); dc._w = parseFloat(dc.getAttribute('width'));
              pf.setAttribute('width', 0); dc.setAttribute('width', 0); tt.setAttribute('opacity', 0);
              S.exBars.push(pf, dc, tt);
            });
            ctx.rect(760, 812, 12, 12, { rx: 2, fill: ctx.alpha('blue', 0.6), parent: g });
            ctx.text(778, 818, 'prefill (compute-bound)', { size: 11, color: 'blue', font: 'mono', parent: g });
            ctx.rect(960, 812, 12, 12, { rx: 2, fill: ctx.alpha('amber', 0.6), parent: g });
            ctx.text(978, 818, 'decode (HBM-bound, length unknown upfront)', { size: 11, color: 'amber', font: 'mono', parent: g });
            ctx.reveal(g, { dur: 300 });
            var ps = [];
            for (var k = 0; k < 3; k++) {
              (function (k) {
                var pf = S.exBars[k * 3], dc = S.exBars[k * 3 + 1], tt = S.exBars[k * 3 + 2];
                ps.push(ctx.animate(pf, { width: [0, pf._w] }, 400, 'out', 300 + k * 300).then(function () {
                  return ctx.animate(dc, { width: [0, dc._w] }, 700, 'out');
                }).then(function () { return ctx.reveal(tt, { dur: 300 }); }));
              })(k);
            }
            return Promise.all(ps);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: how requests are drawn, and the metrics that judge the router */
            S.legend = ctx.group({ parent: S.main });
            ROLES.forEach(function (r, i) {
              var x = 72 + (i % 2) * 88, y = 430 + Math.floor(i / 2) * 22;
              ctx.rect(x, y - 6, 12, 12, { rx: 2, fill: ctx.alpha(r[1], 0.7), stroke: r[1], sw: 1, parent: S.legend });
              ctx.text(x + 18, y, r[0], { size: 11, color: r[1], font: 'mono', parent: S.legend });
            });
            ctx.text(72, 502, 'color = system-prompt prefix', { size: 11, color: 'dim', font: 'mono', parent: S.legend });
            ctx.text(72, 520, 'width = cost · bar = hit/miss', { size: 11, color: 'dim', font: 'mono', parent: S.legend });
            S.met = ctx.group();
            ctx.rect(1300, 168, 262, 262, { rx: 10, fill: 'rgba(6,12,24,0.9)', stroke: ctx.alpha('red', 0.5), sw: 1.2, parent: S.met });
            title(ctx, S.met, 1316, 190, 'ROUTER METRICS');
            S.mPolicy = ctx.text(1316, 220, '—', { size: 16, color: 'red', font: 'mono', weight: 700, parent: S.met });
            [['max / mean cost', 254], ['max requests (mean 4)', 288], ['prefix hit rate', 322], ['prefill saved', 356]].forEach(function (m) { ctx.text(1316, m[1], m[0], { size: 12, color: 'dim', font: 'mono', parent: S.met }); });
            S.mRatio = ctx.text(1548, 254, '—', { size: 20, color: 'white', font: 'mono', weight: 700, anchor: 'end', parent: S.met });
            S.mCnt = ctx.text(1548, 288, '—', { size: 20, color: 'white', font: 'mono', weight: 700, anchor: 'end', parent: S.met });
            S.mHit = ctx.text(1548, 322, '—', { size: 20, color: 'white', font: 'mono', weight: 700, anchor: 'end', parent: S.met });
            S.mSaved = ctx.text(1548, 356, '—', { size: 20, color: 'white', font: 'mono', weight: 700, anchor: 'end', parent: S.met });
            ctx.text(1316, 394, 'lime bar = prefix hit', { size: 11, color: 'lime', font: 'mono', parent: S.met });
            ctx.text(1316, 412, 'red bar = miss, full prefill', { size: 11, color: 'red', font: 'mono', parent: S.met });
            return Promise.all([ctx.reveal(S.legend, { from: 'left' }), ctx.reveal(S.met, { from: 'right', delay: 300 })]).then(function () {
              return ctx.pulse(S.met, { color: 'red', dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Round-robin fails',
        beats: [
          {
            say: 'Round robin gives every replica the same number of requests, not the same amount of work. Watch the first twelve arrive.',
            card: { tag: 'KEY IDEA', title: 'Round-robin counts, it does not weigh', body: 'Every replica receives every sixth request. That equalises how many requests each gets, not how much work they carry.' },
            deep: '<p>Round-robin (and random) balance <b>counts</b>. With per-request work X of mean μ and variance σ², a replica receiving m requests has load with standard deviation σ√m, so the relative imbalance ~ (σ/μ)/√m does not vanish at the small m typical of LLM replicas (tens of concurrent requests, not thousands).</p>' +
              '<p>With a heavy-tailed X, σ/μ is well above 1, so even at m = 4 per replica the busiest replica routinely carries double the mean.</p>'
          },
          {
            say: 'Replica one happens to receive both a nine unit call and a seven unit call, and ends up with about twice the average load while others sit nearly idle.',
            card: {
              tag: 'NUMBERS', title: 'Twice the average on one replica', stat: { v: '2.04×', l: 'max over mean outstanding work: replica 1 holds 18 units, replica 5 only 4' },
              more: '<p>Loads 7, 18, 8, 11, 5 and 4 sum to 53, so the mean is 8.83 and max/mean = 18 / 8.83 = 2.04. The imbalance comes from just two heavy calls (9 and 7 units) landing on the same replica; with heavy-tailed costs, position in the arrival order decides who gets them.</p>'
            },
            deep: '<table><tr><th>Replica</th><th>0</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr>' +
              '<tr><td>requests</td><td>4</td><td>4</td><td>4</td><td>4</td><td>4</td><td>4</td></tr>' +
              '<tr><td>work</td><td>7</td><td>18</td><td>8</td><td>11</td><td>5</td><td>4</td></tr></table>' +
              '<div class="note">Metric shown: max/mean outstanding work across replicas (mean = 53/6 ≈ 8.8). It bounds how much capacity you must over-provision to hold the SLO on the hottest replica.</div>'
          },
          {
            say: 'Everything queued behind the big calls waits, which is head of line blocking: the last small request in replica one\'s queue waits behind seventeen units of work.',
            card: { tag: 'PITFALL', title: 'Head-of-line blocking', body: 'Engines admit requests first come, first served, so short calls stuck behind a nine unit call inherit its latency.' },
            deep: '<p><b>Head-of-line blocking</b>: engines admit requests FCFS into the running batch; KV-cache memory is the admission limit, so a 30k-token prompt can hold back many short ones until blocks free up.</p>' +
              '<p>The victims are exactly the small, interactive calls whose latency matters most, so mean load balance is not enough: the router must keep big calls from piling up in front of small ones.</p>'
          },
          {
            say: 'Layer four balancers are even worse, because HTTP two multiplexes all of an agent\'s calls over one long lived connection, pinning them to one replica.',
            card: { tag: 'PITFALL', title: 'L4 pins connections, not requests', body: 'One HTTP/2 connection per agent means every call from that agent lands on the same pod, however uneven the load.' },
            deep: '<p><b>L4 vs L7</b>: an L4 balancer (IPVS, cloud NLB) hashes the TCP 5-tuple once per connection. gRPC/HTTP-2 clients keep a few long-lived connections and multiplex thousands of requests over them, so whole agents get pinned to one pod. LLM routing must be L7 and request-aware (Envoy/Gateway API with an inference extension).</p>' +
              '<p>Fixes, in order of sophistication: least-outstanding-requests (needs fresh state), power-of-two-choices (robust to staleness), cache-aware and SLO-aware routing (L7).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.router.subEl.textContent = 'round-robin';
          var sim = simulate(ctx.rng(1), 'rr');
          buildQueues(ctx, S, sim);
          /* bottom: two mini charts, requests versus work per replica */
          var b = ctx.group();
          var BASE = 830, X1 = 100, X2 = 420, PITCH = 40, BW = 26;
          title(ctx, b, 80, 590, 'ROUND-ROBIN: EQUAL COUNTS, UNEQUAL WORK');
          ctx.text(X1, 622, 'requests per replica', { size: 11, color: 'cyan', font: 'mono', parent: b });
          ctx.text(X2, 622, 'outstanding work per replica (cost units)', { size: 11, color: 'red', font: 'mono', parent: b });
          ctx.line(X1 - 8, BASE, X1 + 6 * PITCH, BASE, { color: 'faint', parent: b });
          ctx.line(X2 - 8, BASE, X2 + 6 * PITCH, BASE, { color: 'faint', parent: b });
          S.cntBars = []; S.workBars = [];
          for (var i = 0; i < NR; i++) {
            ctx.text(X1 + i * PITCH + BW / 2, BASE + 16, 'r' + i, { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
            ctx.text(X2 + i * PITCH + BW / 2, BASE + 16, 'r' + i, { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
            S.cntBars.push(ctx.rect(X1 + i * PITCH, BASE, BW, 0, { rx: 3, fill: ctx.alpha('cyan', 0.5), stroke: 'cyan', sw: 1, parent: b }));
            S.workBars.push(ctx.rect(X2 + i * PITCH, BASE, BW, 0, { rx: 3, fill: ctx.alpha('red', 0.5), stroke: 'red', sw: 1, parent: b }));
          }
          function grow(bar, h0, h1, delay) { return ctx.animate(bar, { y: [BASE - h0, BASE - h1], height: [h0, h1] }, 600, 'out', delay); }
          swapBottom(ctx, S, b);
          /* beat 0: the first twelve arrivals */
          return Promise.all([
            playQueues(ctx, S, sim, 0, 12),
            Promise.all(S.cntBars.map(function (bar, i) { return grow(bar, 0, 60, 500 + i * 250); }))
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the rest, and the imbalance */
            var work = sim.loads;
            var lbls = [];
            var ps = [playQueues(ctx, S, sim, 12, 24)];
            S.cntBars.forEach(function (bar, i) { ps.push(grow(bar, 60, 120, 500 + i * 200)); });
            S.workBars.forEach(function (bar, i) { ps.push(grow(bar, 0, work[i] * 8, 500 + i * 200)); });
            for (var i = 0; i < NR; i++) {
              var t1 = ctx.text(X1 + i * PITCH + BW / 2, BASE - 128, '4', { size: 12, color: 'cyan', anchor: 'middle', font: 'mono', weight: 600, parent: b });
              var t2 = ctx.text(X2 + i * PITCH + BW / 2, BASE - work[i] * 8 - 10, String(work[i]), { size: 12, color: 'red', anchor: 'middle', font: 'mono', weight: 600, parent: b });
              t1.setAttribute('opacity', 0); t2.setAttribute('opacity', 0);
              lbls.push(t1, t2);
            }
            var mean = ctx.line(X2 - 8, BASE - 53 / 6 * 8, X2 + 6 * PITCH, BASE - 53 / 6 * 8, { color: 'white', dash: '5 4', sw: 1.2, parent: b });
            var meanT = ctx.text(X2 + 6 * PITCH + 4, BASE - 53 / 6 * 8, 'mean 8.8', { size: 11, color: 'white', font: 'mono', parent: b });
            mean.setAttribute('opacity', 0); meanT.setAttribute('opacity', 0);
            return Promise.all(ps).then(function () {
              setMetrics(ctx, S, 'round-robin', sim);
              return Promise.all([ctx.reveal(lbls, { dur: 300, stagger: 30 }), ctx.reveal([mean, meanT], { delay: 200 }), ctx.pulse(S.reps[sim.maxR], { color: 'red', dur: 700, times: 2 })]);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: head-of-line blocking behind the big calls */
            var big = [];
            sim.assign.forEach(function (a, i) { if (a.r === sim.maxR && a.cost >= 7) big.push(S.qItems[i]); });
            var y = repY(sim.maxR);
            S.hol = ctx.label(1180, y + 33, 'last call waits behind 17 units', { color: 'red', size: 11, anchor: 'end', parent: S.qG });
            return Promise.all([ctx.reveal(S.hol, { from: 'up', dist: 10 }), ctx.pulse(big[0], { color: 'red', dur: 600, times: 2 }), ctx.pulse(big[1], { color: 'red', dur: 600, times: 2 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: L4 balancers pin connections */
            var L = ctx.group({ parent: b });
            var OX = 780;
            title(ctx, L, 870, 610, 'L4 BALANCING PINS CONNECTIONS, NOT REQUESTS');
            var ag = [['director', 'magenta', 660], ['critic', 'pink', 770]];
            ctx.rect(OX + 330, 670, 130, 90, { rx: 10, fill: 'url(#fx-panel-grad)', stroke: 'blue', sw: 1.3, parent: L });
            ctx.text(OX + 395, 705, 'L4 LB', { size: 14, color: 'white', anchor: 'middle', font: 'display', weight: 600, parent: L });
            ctx.text(OX + 395, 725, 'hash(5-tuple)', { size: 11, color: 'blue', anchor: 'middle', font: 'mono', parent: L });
            S.l4 = [];
            ag.forEach(function (a, i) {
              ctx.rect(OX + 90, a[2] - 18, 130, 36, { rx: 18, fill: ctx.alpha(a[1], 0.15), stroke: a[1], sw: 1.2, parent: L });
              ctx.text(OX + 155, a[2] + 0.5, a[0], { size: 12, color: a[1], anchor: 'middle', font: 'mono', parent: L });
              var p1 = ctx.path('M' + (OX + 220) + ',' + a[2] + ' L' + (OX + 330) + ',' + (705 + i * 20), { stroke: a[1], sw: 3, parent: L });
              var p2 = ctx.path('M' + (OX + 460) + ',' + (705 + i * 20) + ' L' + (OX + 600) + ',' + a[2], { stroke: a[1], sw: 3, parent: L });
              ctx.rect(OX + 600, a[2] - 18, 110, 36, { rx: 8, fill: 'url(#fx-panel-grad)', stroke: 'amber', sw: 1.2, parent: L });
              ctx.text(OX + 655, a[2] + 0.5, 'replica ' + (i ? 4 : 1), { size: 12, color: 'white', anchor: 'middle', font: 'mono', parent: L });
              S.l4.push(p1, p2);
            });
            ctx.text(OX + 400, 826, 'one HTTP/2 connection per agent → every call lands on the same pod', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: L });
            S.l4s = S.l4.map(function (p, i) { return ctx.stream(p, { color: i < 2 ? 'magenta' : 'pink', count: 3, period: 1400, r: 3 }); });
            return ctx.reveal(L, { from: 'up', dist: 14, dur: 600 }).then(function () { return ctx.wait(900); });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Two random choices',
        beats: [
          {
            say: 'A better idea is to send each request to the replica with the least outstanding work. But that needs fresh global state, and when several routers act on the same stale view, they all pick the same idle replica and stampede it.',
            card: { tag: 'PITFALL', title: 'Stale state causes herding', body: 'Join-the-shortest-queue is ideal with fresh information. With delayed reports, every router sees the same idle replica and sends its next request there.' },
            deep: '<p><b>Why not always join-the-shortest-queue?</b> With k routers and load reports delayed by Δ, JSQ sends everything in Δ to the same "idle" replica (herd behaviour), creating oscillation: the idle replica becomes the hottest, the next report flips the herd to another one, and so on.</p>' +
              '<p>Fresh global state would fix it, but sharing state on every request between routers costs a lock or a round trip per request, which the sub-millisecond budget cannot afford.</p>'
          },
          {
            say: 'The power of two choices is the elegant fix: sample two replicas at random and pick the less loaded one.',
            card: { tag: 'HOW IT WORKS', title: 'Probe two, pick the lighter', body: 'Two random probes per request, no global lock, and robust to stale reports because the choice is randomised.' },
            deep: '<pre>def pick(replicas):\n    a, b = sample(replicas, 2)\n    return min((a, b), key=load)</pre>' +
              '<p>Random sampling decorrelates routers (Mitzenmacher, "How useful is old information?"): two routers rarely probe the same pair, so they rarely herd. Envoy\'s <code>LEAST_REQUEST</code> balancer is P2C over active-request counts when host weights are equal (<code>choice_count</code> defaults to 2).</p>'
          },
          {
            say: 'That tiny change stops the overload from growing with total load. The gap above average stays near log log n, essentially a constant.',
            card: {
              tag: 'NUMBERS', title: 'A gap that does not grow', stat: { v: '≈ 2', u: 'requests', l: 'gap above the mean with two choices for 64 replicas, however many requests arrive; one choice reaches ~29 at 100 balls per bin' },
              more: '<p>For n = 64: one choice gives √(2 · 100 · ln 64) ≈ 29 at m/n = 100 and ≈ 91 at m/n = 1000, while two choices give ln ln 64 / ln 2 ≈ 2.1 at every m. The classical result is tight up to constants, and real routers track it as long as their probes see roughly current load.</p>'
            },
            deep: '<p>Balls-into-bins with n bins and m balls (Azar et al.; Berenbrink et al. 2000 for m ≫ n):</p>' +
              '<div class="eq">one choice: max − avg = Θ(√((m/n) · ln n))<br>d choices: max − avg = ln ln n / ln d + O(1) &nbsp;(independent of m)</div>' +
              '<p>At m = n this is the famous drop from ln n / ln ln n to ln ln n / ln 2: an exponential improvement from one extra random probe; a third probe helps only by a constant factor.</p>'
          },
          {
            say: 'Run all twenty four requests through it and the queues stay close to level, with the busiest replica only a quarter above the average.',
            card: { tag: 'NUMBERS', title: 'From 2.04× to 1.25×', stat: { v: '1.25×', l: 'max over mean load with two random choices, down from 2.04× for round robin; prefix hits stay at 25%' } },
            deep: '<div class="note">Load here = outstanding cost units. Real routers use queued prefill tokens + running decode sequences, or KV-cache utilisation.</div>' +
              '<p>P2C balances load but is blind to what is cached: a request lands on whichever of two random replicas is lighter, so prefix hits are luck (25% here). The next steps add that missing information.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.l4s) S.l4s.forEach(function (h) { h.stop(); });
          resetQueues(ctx, S);
          S.router.subEl.textContent = 'least-loaded';
          var b = ctx.group();
          S.p2cTitle = title(ctx, b, 80, 590, 'LEAST-LOADED ON STALE STATE HERDS');
          S.herdP = lines(ctx, b, 80, 634, ['t0    routers A, B, C all see', '      replica 5 as the least loaded.', 't0+Δ  all three send their next', '      request there: 3 arrive at once,', '      and the "idle" replica is now', '      the hottest.'], { lh: 22 });
          swapBottom(ctx, S, b);
          var sim = simulate(ctx.rng(7), 'p2c');
          S.herd = ctx.label(1070, repY(5) + 36, 'stale view: A, B, C all pick replica 5', { color: 'red', size: 11 });
          /* beat 0: the herd */
          return Promise.all([
            ctx.reveal(S.herd, { from: 'up', dist: 10, delay: 300 }),
            Promise.all([['magenta', 0], ['amber', 200], ['violet', 400]].map(function (q) {
              return ctx.wait(q[1] + 300).then(function () { return ctx.packet(S.rl[5], { color: q[0], dur: 700, r: 5 }); });
            }))
          ]).then(function () { return ctx.pulse(S.reps[5], { color: 'red', dur: 700, times: 2 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: sample two, pick the lighter; the first eight requests show their probes */
            ctx.fadeOut(S.herd, 300, true);
            S.p2cTitle.textContent = 'POWER OF TWO CHOICES';
            S.router.subEl.textContent = 'P2C';
            lines(ctx, b, 800, 650, ['pick(replicas):', '  a, b = sample(replicas, 2)', '  return a if load(a) <= load(b) else b', '', 'one extra probe → exponential gain', 'robust to stale load reports', 'O(1) per decision, no global lock'], { lh: 22 });
            buildQueues(ctx, S, sim);
            S.probeG = ctx.group();
            sim.assign.slice(0, 8).forEach(function (a, i) {
              ctx.after(i * 150, function () {
                var ls = a.cand.map(function (c) {
                  return ctx.line(575, 360, 700, repY(c), { color: c === a.r ? 'lime' : ctx.alpha('white', 0.45), sw: c === a.r ? 2 : 1.2, dash: '4 4', parent: S.probeG });
                });
                ctx.after(260, function () { ls.forEach(function (l) { ctx.remove(l, 150); }); });
              });
            });
            return playQueues(ctx, S, sim, 0, 8);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the gap does not grow with load */
            ctx.fadeOut(S.herdP, 300, true);
            var g = ctx.group({ parent: b });
            ctx.text(130, 612, 'overload = max load − average, vs balls per bin (n = 64 replicas)', { size: 11, color: 'dim', font: 'mono', parent: g });
            var ln64 = Math.log(64);
            var pl1 = ctx.plot(130, 625, 560, 200, function (x) { return Math.sqrt(2 * Math.pow(10, x) * ln64); }, { xDomain: [0, 3], yDomain: [0, 100], color: 'red', sw: 2.2, parent: g });
            var pl2 = ctx.plot(130, 625, 560, 200, function () { return Math.log(ln64) / Math.LN2; }, { xDomain: [0, 3], yDomain: [0, 100], color: 'lime', sw: 2.6, axes: false, parent: g });
            ctx.text(560, 660, 'one random choice', { size: 12, color: 'red', font: 'mono', anchor: 'end', parent: g });
            ctx.text(560, 678, '≈ √(2·(m/n)·ln n)', { size: 11, color: 'red', font: 'mono', anchor: 'end', parent: g });
            ctx.text(690, 800, 'two choices ≈ ln ln n / ln 2 ≈ 2', { size: 12, color: 'lime', font: 'mono', anchor: 'end', parent: g });
            [0, 1, 2, 3].forEach(function (k) { var p = pl1.toPx(k, 0); ctx.text(p.x, 842, String(Math.pow(10, k)), { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: g }); });
            ctx.text(410, 864, 'balls per bin  m / n  (log scale)', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: g });
            ctx.reveal(g, { dur: 300 });
            return ctx.reveal([pl1.curve, pl2.curve], { from: 'draw', dur: 1200, delay: 400, stagger: 300 });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: all 24 requests, with the metrics */
            return playQueues(ctx, S, sim, 8, 24).then(function () {
              setMetrics(ctx, S, 'two choices', sim);
              return ctx.pulse(S.met, { color: 'lime', dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Consistent hashing',
        beats: [
          {
            say: 'Balance is only half the story, because LLM replicas are stateful: each keeps a cache of recently seen prompt prefixes.',
            card: { tag: 'KEY IDEA', title: 'Replicas remember prefixes', body: 'Each replica caches the KV blocks of the prompts it served. A request sent to the wrong replica pays full prefill again.' },
            deep: '<p>A 6k-token agent prompt costs ~0.6 s of prefill on a TP4 replica (10<sup>4</sup> tok/s). A prefix hit removes almost all of it, cutting TTFT for the common case from ~0.6 s to ~0.1 s.</p>' +
              '<p>So the router wants <b>affinity</b>: the same prefix should keep going to the same replica. The question is how to get affinity without a central table, and without hot-spotting the replica that owns a popular prefix.</p>'
          },
          {
            say: 'Consistent hashing maps each prefix to a point on a ring and sends it to the next replica clockwise, so the same agent keeps hitting the same warm cache, and adding a replica moves only a small fraction of keys.',
            card: { tag: 'HOW IT WORKS', title: 'Next replica clockwise', body: 'Replicas and prefixes hash onto one ring. A prefix belongs to the first replica clockwise from it, so its requests keep meeting the same cache.' },
            deep: '<p><b>Consistent hashing</b> (Karger et al.): replicas and keys hash onto a ring; a key belongs to the first replica clockwise. Adding or removing one of n replicas remaps only ~K/n keys (vs almost all with <code>hash mod n</code>). Virtual nodes (e.g. 100–200 per replica) smooth ownership; Maglev hashing gives near-perfect balance with O(1) lookups.</p>' +
              '<p>For LLMs the key is the prompt prefix (or session id), so affinity ≈ cache hits.</p>'
          },
          {
            say: 'Plain hashing would overload whoever owns the hot director prompt, while a replica that owns no prefix at all sits idle.',
            card: { tag: 'NUMBERS', title: 'Hot owner, idle neighbor', stat: { v: '8 vs 0', l: 'requests reaching replica 1 (owner of the director prefix) and replica 4 (owns none) under plain hashing; the mean is 4' } },
            deep: '<p>On these 24 requests plain ring hashing gives loads of 6, 15, 14, 11, 0 and 7 cost units, a max/mean of 1.70×, with a 75% prefix hit rate: affinity is excellent, balance is not. The director prefix is the most popular (8 of 24 requests), and its owner, replica 1, takes all of them, while replica 4 owns no prefix at all.</p>'
          },
          {
            say: 'Bounded loads caps every replica at one plus epsilon times the average, and overflow walks on to the next replica clockwise.',
            card: {
              tag: 'TRADE-OFF', title: 'Bounded loads trade hits for balance', body: 'Max requests per replica falls from 8 to 5, but prefix hits fall from 75% to 50%. Counts are balanced, cost is not: max over mean stays at 1.70×.',
              more: '<p>With capacity c = ⌈(1 + ε)·m/n⌉ no replica can exceed c by construction, so the maximum count is at most (1 + ε) times the average, rounded up. Mirrokni et al. also show that the expected number of clockwise steps a key needs to find room is O(1/ε²), so lookups stay cheap for constant ε.</p>'
            },
            deep: '<p><b>Bounded loads</b> (Mirrokni, Thorup, Zadimoghaddam): every replica has capacity</p>' +
              '<div class="eq">c = ⌈(1 + ε) · m / n⌉</div>' +
              '<p>and a key whose owner is full walks clockwise to the next replica with room. Max load ≤ (1+ε)·avg by construction while most keys keep their home; with ε = 0.25 here, and "load" meaning the request count. Deployed in Google Cloud Pub/Sub, Vimeo\'s video delivery and HAProxy (<code>hash-balance-factor</code>).</p>' +
              '<p>Its weakness: it balances request <i>counts</i> and knows nothing about which blocks are actually still cached or how costly each request is. The next step fixes that.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          resetQueues(ctx, S);
          S.router.subEl.textContent = 'hash ring';
          var simPlain = simulate(null, 'ch');
          var simB = simulate(null, 'chbl');
          var b = ctx.group();
          S.ringTitle = title(ctx, b, 80, 590, 'CONSISTENT HASHING · the ring');
          var cx = 330, cy = 740, R = 110;
          function pt(a, rr) { var t = a * Math.PI / 180; return { x: cx + (rr || R) * Math.sin(t), y: cy - (rr || R) * Math.cos(t) }; }
          var ring = ctx.circle(cx, cy, R, { stroke: ctx.alpha('white', 0.3), sw: 2, parent: b });
          var rpts = R_ANG.map(function (a, i) {
            var p = pt(a), q = pt(a, R + 28);
            var g = ctx.group({ parent: b });
            ctx.circle(p.x, p.y, 9, { fill: '#1a2238', stroke: 'amber', sw: 2, parent: g });
            ctx.text(q.x, q.y, 'r' + i, { size: 12, color: 'amber', anchor: 'middle', font: 'mono', weight: 600, parent: g });
            return g;
          });
          var cw = ctx.text(cx, cy - 6, 'clockwise', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
          var ow = ctx.text(cx, cy + 10, '→ owner', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
          swapBottom(ctx, S, b);
          /* beat 0: replicas on a ring; each one holds a cache */
          return Promise.all([ctx.reveal(ring, { from: 'draw', dur: 900 }), ctx.reveal(rpts, { from: 'scale', delay: 400, stagger: 100 }), ctx.reveal([cw, ow], { delay: 900 }),
            ctx.pulse(S.kvHdr, { color: 'lime', dur: 600, times: 2 })]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: prefixes hash onto the same ring; each goes to the next replica clockwise; run the plain ring */
            S.ringTitle.textContent = 'CONSISTENT HASHING · plain ring';
            var dots = P_ANG.map(function (a, i) {
              var p = pt(a, R - 22);
              return ctx.circle(p.x, p.y, 6, { fill: ROLES[i][1], parent: b });
            });
            var arcs = P_ANG.map(function (a0, i) {
              var own = 0;
              for (var k = 0; k < NR; k++) if (R_ANG[k] >= a0) { own = k; break; }
              if (a0 > R_ANG[NR - 1]) own = 0;
              var a1 = R_ANG[own] < a0 ? R_ANG[own] + 360 : R_ANG[own];
              var p0 = pt(a0, R - 22), p1 = pt(a1, R - 22), pe = pt(a1, R - 9);
              var large = (a1 - a0) > 180 ? 1 : 0;
              return ctx.path('M' + p0.x.toFixed(1) + ',' + p0.y.toFixed(1) + ' A' + (R - 22) + ',' + (R - 22) + ' 0 ' + large + ' 1 ' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1) + ' L' + pe.x.toFixed(1) + ',' + pe.y.toFixed(1), { stroke: ctx.alpha(ROLES[i][1], 0.8), sw: 1.6, arrow: true, parent: b });
            });
            buildQueues(ctx, S, simPlain);
            return Promise.all([ctx.reveal(dots, { from: 'scale', stagger: 100 }), ctx.reveal(arcs, { from: 'draw', dur: 900, delay: 400, stagger: 120 })]).then(function () {
              return playQueues(ctx, S, simPlain, 0, 24, 110);
            }).then(function () { setMetrics(ctx, S, 'plain ring', simPlain); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the hot owner and the idle replica */
            lines(ctx, b, 560, 640, ['plain ring (no bound):', '  director (hot) → r1', '  r4 owns no prefix at all'], { lh: 22 });
            var hot = ctx.label(1010, repY(1) + 33, 'hot: director prefix → 8 requests', { color: 'red', size: 11, parent: S.qG });
            var idle = ctx.label(1010, repY(4) + 33, 'idle: owns no prefix', { color: 'dim', size: 11, parent: S.qG });
            return Promise.all([ctx.reveal([hot, idle], { from: 'up', dist: 10, stagger: 300 }), ctx.pulse(S.reps[1], { color: 'red', dur: 700, times: 2 }), ctx.pulse(S.reps[4], { color: 'dim', dur: 700 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: bounded loads, overflow walks clockwise */
            S.ringTitle.textContent = 'HASH RING · ε = 0.25 · capacity ⌈1.25·i/6⌉ requests';
            S.router.subEl.textContent = 'CH+bounded';
            resetQueues(ctx, S);
            buildQueues(ctx, S, simB);
            lines(ctx, b, 560, 640 + 4 * 25.08, ['bounded loads:', '  owner full → walk clockwise', '  max load ≤ (1+ε)·avg', '  +1 replica moves ~1/n of keys'], { lh: 22 });
            lines(ctx, b, 1040, 640, ['used for:', '  session / prefix affinity', '  Envoy ring_hash, Maglev', '  HAProxy hash-balance-factor', '', 'blind spot:', '  balances COUNTS, not cost,', '  and cannot see cache evictions'], { lh: 22, color: 'dim' });
            var ov = null;
            simB.assign.forEach(function (a) { if (!ov && a.walk > 0) ov = a; });
            S.walkDot = ctx.circle(0, 0, 7, { fill: ov ? ROLES[ov.p][1] : 'magenta', stroke: 'white', sw: 1.5, parent: b, glow: true });
            S.walkDot.setAttribute('opacity', 0);
            return playQueues(ctx, S, simB, 0, 24, 110).then(function () {
              setMetrics(ctx, S, 'CH + bounded', simB);
              if (!ov) return null;
              var a0 = P_ANG[ov.p], a1 = R_ANG[ov.r] < a0 ? R_ANG[ov.r] + 360 : R_ANG[ov.r];
              S.walkDot.setAttribute('opacity', 1);
              return ctx.tween(1600, function (t) {
                var p = pt(a0 + (a1 - a0) * t);
                S.walkDot.setAttribute('cx', p.x); S.walkDot.setAttribute('cy', p.y);
              }, 'inOut');
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Prefix-aware routing',
        beats: [
          {
            say: 'Modern LLM routers look inside the KV cache itself. The SGLang router, llm-d and NVIDIA Dynamo track which prefixes each replica holds, in a radix tree.',
            card: { tag: 'STATE OF THE ART', title: 'Routers now see the KV cache', body: 'The SGLang router, llm-d and NVIDIA Dynamo keep an approximate radix tree of each replica\'s cached prefixes, or consume its exact KV-block events.' },
            deep: '<p><b>RadixAttention</b> (SGLang) keeps KV blocks in a radix tree keyed by token ids with LRU eviction; a request reuses the longest cached prefix and only prefills the suffix. The router keeps an <i>approximate</i> tree per worker (or consumes KV-cache events, as Dynamo does).</p>'
          },
          {
            say: 'A request goes to the replica with the longest match, unless that replica is too far above the least loaded one.',
            card: { tag: 'HOW IT WORKS', title: 'Longest match, unless overloaded', body: 'Score = prefix match minus load penalty. The threshold T sets how much extra load a router accepts to keep a cache hit.' },
            deep: '<p>Decision rule used here (SGLang-router style, threshold T in cost units):</p>' +
              '<pre>h = longest-prefix replica\nif h and load[h] &lt;= min(load) + T:\n    route h          # hit\nelse:\n    route argmin(load)  # miss</pre>' +
              '<p>Scoring variants: llm-d\'s scheduler sums weighted scorers (prefix-cache, KV-utilisation, queue depth); Dynamo computes cost = w·(blocks to prefill) + (decode load).</p>'
          },
          {
            say: 'A hit skips most of prefill: the director\'s nine thousand token system prompt and tool schemas are already computed.',
            card: { tag: 'NUMBERS', title: 'Prefill skipped', stat: { v: '9k → 0.5k', u: 'tokens', l: 'prefill work for a director request whose prefix is already cached on the chosen replica' } },
            deep: '<div class="eq">saved prefill ≈ hits × L<sub>prefix</sub><br>TTFT<sub>hit</sub> ≈ (L − L<sub>prefix</sub>)/R<sub>prefill</sub></div>' +
              '<p>With ~6k shared tokens per agent prompt (the director\'s is the largest, 9k), a 67% hit rate removes most prefill FLOPs and cuts TTFT for the common case from ~0.6 s to ~0.1 s.</p>'
          },
          {
            say: 'Click the threshold chips on the right to trade cache hits against load balance yourself: zero means pure balance, infinity means pure affinity.',
            card: { tag: 'TRY IT', title: 'Slide the imbalance threshold', body: 'T = 0 is pure least-loaded, T = ∞ is pure affinity. Watch hit rate and max over mean move in opposite directions.' },
            deep: '<p>The trade-off is explicit: T = 0 degenerates to least-loaded (low hit rate), T = ∞ to pure affinity (hot prefixes overload one replica). On the 24 requests shown (2-prefix LRU per replica):</p>' +
              '<table><tr><th>T</th><th>hit rate</th><th>max/mean</th></tr><tr><td>0</td><td>29%</td><td>1.25×</td></tr><tr><td>6</td><td>67%</td><td>1.25×</td></tr><tr><td>∞</td><td>75%</td><td>1.70×</td></tr></table>' +
              '<p>T = 6 is the sweet spot here: most of the hits, none of the imbalance.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          resetQueues(ctx, S);
          S.router.subEl.textContent = 'prefix-aware';
          S.T = 6;
          var sim = simulate(ctx.rng(5), 'prefix', S.T);
          var b = ctx.group();
          title(ctx, b, 80, 590, 'RADIX TREE OF CACHED PREFIXES · replica 0');
          var nodes = [[120, 700, 'root', 'dim'], [300, 650, 'sys: director · 6k', 'magenta'], [300, 760, 'sys: critic · 5k', 'pink'],
            [520, 650, 'tools: 14 schemas · 3k', 'magenta'], [740, 620, 'turn 1..2 · 2k', 'magenta'], [740, 690, 'turn 3 · new', 'lime'], [520, 760, 'frames 1-6 · 20k', 'pink']];
          var edges = [[0, 1], [0, 2], [1, 3], [3, 4], [3, 5], [2, 6]];
          edges.forEach(function (e) {
            var a = nodes[e[0]], c = nodes[e[1]];
            ctx.path('M' + (a[0] + 80) + ',' + a[1] + ' C' + (a[0] + 110) + ',' + a[1] + ' ' + (c[0] - 110) + ',' + c[1] + ' ' + (c[0] - 80) + ',' + c[1], { stroke: ctx.alpha(c[3], 0.6), sw: 1.4, parent: b });
          });
          /* drawn under the nodes so it never strikes through their labels; revealed in beat 1 */
          S.match = ctx.path('M200,700 C210,700 210,650 220,650 L380,650 L440,650 L600,650 C630,650 630,690 660,690', { stroke: 'lime', sw: 3.5, parent: b, glow: true });
          S.match.setAttribute('opacity', 0);
          S.treeR = nodes.map(function (n) {
            var g = ctx.group({ parent: b });
            var r0 = ctx.rect(n[0] - 80, n[1] - 15, 160, 30, { rx: 6, fill: '#0c1428', stroke: n[3], sw: 1.2, parent: g });
            ctx.rect(n[0] - 80, n[1] - 15, 160, 30, { rx: 6, fill: ctx.alpha(n[3], 0.12), parent: g });
            ctx.text(n[0], n[1] + 0.5, n[2], { size: 11, color: n[3], anchor: 'middle', font: 'mono', parent: g });
            return r0;
          });
          swapBottom(ctx, S, b);
          /* beat 0: the radix tree of one replica */
          return ctx.wait(1200).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the longest match wins, unless the replica is overloaded */
            [1, 3].forEach(function (i) { S.treeR[i].setAttribute('stroke', ctx.color('lime')); S.treeR[i].setAttribute('stroke-width', 2.2); });
            lines(ctx, b, 900, 632, ['router state per replica:', '  approx. radix tree of routed prompts', '  or exact KV-block events (Dynamo)', '', 'score = prefix match − load penalty', 'systems: SGLang router, llm-d,', '  NVIDIA Dynamo, AIBrix, Envoy AI GW'], { lh: 22 });
            return ctx.reveal(S.match, { from: 'draw', dur: 1200, delay: 200 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: a hit skips prefill; all 24 requests flow with T = 6 */
            var note = ctx.text(120, 820, 'new director request: 9k-token prefix matched → prefill only ~0.5k new tokens', { size: 12, color: 'lime', font: 'mono', parent: b });
            ctx.reveal(note, { from: 'up', dist: 10 });
            buildQueues(ctx, S, sim);
            return playQueues(ctx, S, sim, 0, 24, 110).then(function () { setMetrics(ctx, S, 'prefix · T = 6', sim); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the threshold is yours to change */
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
                buildQueues(ctx, S, s2, true);
                setMetrics(ctx, S, 'prefix · ' + tv[1], s2);
              });
              return c;
            });
            S.togChips.forEach(function (o, k) { o.setAttribute('opacity', k === 1 ? 1 : 0.45); });
            return ctx.reveal(S.tog, { from: 'left', dur: 500 }).then(function () { return ctx.pulse(S.togChips[1], { color: 'cyan', dur: 700, times: 2 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'SLOs & queueing',
        beats: [
          {
            say: 'Even perfect routing cannot beat queueing theory. Latency grows like one over one minus utilization, so at ninety percent load a request spends about ten times its service time in the system.',
            card: { tag: 'NUMBERS', title: 'Ten times at ninety percent', stat: { v: '10×', l: 'time in system over service time at 90% utilisation, for exponential service (M/M/1)' } },
            deep: '<p>M/G/1 (Pollaczek–Khinchine), mean response time in units of mean service time S:</p>' +
              '<div class="eq">W / S = 1 + ρ · (1 + C<sub>s</sub><sup>2</sup>) / (2 (1 − ρ))</div>' +
              '<p>C<sub>s</sub><sup>2</sup> = 1 reduces to M/M/1: W/S = 1/(1−ρ), which is 10 at ρ = 0.9 and 20 at ρ = 0.95. The curve is gentle until about 70% load and then vertical.</p>'
          },
          {
            say: 'Heavy tailed service makes it much worse. For the same latency budget, the admissible utilization drops by about fourteen points.',
            card: {
              tag: 'NUMBERS', title: 'Heavy tails cost 14 points', stat: { v: '0.87 → 0.74', l: 'maximum utilisation that keeps W ≤ 8·S, for exponential versus heavy-tailed service (C² = 4)' },
              more: '<p>Set W/S = 8 and solve. For C² = 1: 1/(1 − ρ) = 8 gives ρ = 0.875. For C² = 4: 1 + 5ρ / (2(1 − ρ)) = 8 gives 5ρ = 14(1 − ρ), so ρ = 14/19 = 0.737. The 13.8-point gap is the utilisation you give up to keep the same latency budget.</p>'
            },
            deep: '<p>For a latency budget of 8·S the admissible utilisation is ρ ≤ 0.875 with C<sub>s</sub><sup>2</sup> = 1 but only ρ ≤ 0.74 with C<sub>s</sub><sup>2</sup> = 4: heavy tails cost ~14 points of utilisation. Kingman generalises to G/G/1:</p>' +
              '<div class="eq">W<sub>q</sub> ≈ (ρ/(1−ρ)) · ((C<sub>a</sub><sup>2</sup>+C<sub>s</sub><sup>2</sup>)/2) · S</div>'
          },
          {
            say: 'So the router enforces service level objectives. It predicts time to first token from each replica\'s queued prefill work.',
            card: { tag: 'HOW IT WORKS', title: 'Predict TTFT, then admit', body: 'Estimated TTFT = queued prefill plus this request\'s uncached prompt, divided by the replica\'s prefill rate. Compare the best replica against the SLO.' },
            deep: '<p><b>SLO-aware admission</b> (per request, at the router):</p>' +
              '<pre>ttft[r] = (queued[r] + L_in\n           - hit[r]) / R_pf\nif min(ttft) &gt; SLO_ttft:\n    429 + Retry-After, or spill\ndecode: cap batch so\n    TPOT(batch) &lt;= SLO_tpot</pre>' +
              '<p>The estimate needs each replica\'s queued prefill tokens and its prefill rate; replicas publish both, and the router adds the request\'s own uncached tokens (prompt length minus the prefix-cache hit). The decode side is protected separately, by capping the batch so per-token latency stays under its SLO.</p>'
          },
          {
            say: 'When no replica can meet the target, it sheds or defers the request instead of letting everyone miss. Here a retry from the critic gets a polite four twenty nine.',
            card: { tag: 'TRADE-OFF', title: 'Shed early, protect the SLO', body: 'A fast 429 with Retry-After costs one caller a moment. Admitting everything makes every caller miss the target together.' },
            deep: '<p>The metric that matters is <b>goodput</b>: requests per second that meet both TTFT and TPOT SLOs (DistServe). Optimising raw throughput would admit everything and let latency blow up; optimising goodput sheds the marginal request to save the rest.</p>' +
              '<p>Priorities help: interactive creator-facing calls pre-empt batch critic retries.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.tog) { ctx.fade(S.tog, 0.35, 400); S.tog.style.pointerEvents = 'none'; }
          var b = ctx.group();
          title(ctx, b, 80, 590, 'RESPONSE TIME vs UTILISATION (M/G/1)');
          function w(rho, cs2) { return Math.min(30, 1 + rho * (1 + cs2) / (2 * (1 - rho))); }
          var o = { xDomain: [0, 0.97], yDomain: [0, 30], sw: 2.2, parent: b };
          var p1 = ctx.plot(130, 625, 560, 200, function (r) { return w(r, 1); }, Object.assign({ color: 'cyan', yLabel: 'W / S' }, o));
          [0, 0.5, 0.9].forEach(function (r) { var p = p1.toPx(r, 0); ctx.text(p.x, 842, String(r), { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b }); });
          ctx.text(410, 864, 'utilisation ρ = λ / μ', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: b });
          var q10 = p1.toPx(0.9, 10);
          var m10 = ctx.group({ parent: b });
          ctx.circle(q10.x, q10.y, 5, { fill: 'cyan', parent: m10 });
          ctx.text(q10.x + 12, q10.y + 8, '10× at ρ = 0.9', { size: 11, color: 'cyan', font: 'mono', parent: m10 });
          m10.setAttribute('opacity', 0);
          swapBottom(ctx, S, b);
          /* beat 0: the M/M/1 curve */
          return ctx.reveal(p1.curve, { from: 'draw', dur: 1400, delay: 500 }).then(function () { return ctx.reveal(m10, { from: 'scale' }); }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: heavy-tailed service, the same SLO budget */
            var p2 = ctx.plot(130, 625, 560, 200, function (r) { return w(r, 4); }, Object.assign({ color: 'red', axes: false }, o));
            var slo = p1.toPx(0, 8), q1 = p1.toPx(0.875, 8), q2 = p1.toPx(0.737, 8);
            var g = ctx.group({ parent: b });
            ctx.line(130, slo.y, 690, slo.y, { color: 'pink', dash: '5 5', sw: 1.4, parent: g });
            ctx.text(136, slo.y - 10, 'SLO: W ≤ 8·S', { size: 11, color: 'pink', font: 'mono', parent: g });
            ctx.circle(q1.x, q1.y, 5, { fill: 'cyan', parent: g });
            ctx.circle(q2.x, q2.y, 5, { fill: 'red', parent: g });
            ctx.text(q2.x - 8, q2.y + 22, 'ρ ≤ 0.74', { size: 11, color: 'red', anchor: 'end', font: 'mono', parent: g });
            ctx.text(q1.x + 6, q1.y + 22, 'ρ ≤ 0.87', { size: 11, color: 'cyan', font: 'mono', parent: g });
            ctx.text(330, 660, 'C²=1 (M/M/1) cyan · C²=4 (heavy tail) red', { size: 11, color: 'dim', font: 'mono', parent: g });
            ctx.reveal(g, { dur: 400, delay: 800 });
            return ctx.reveal(p2.curve, { from: 'draw', dur: 1200, delay: 200 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the SLO gate and the admission estimate */
            S.gate = ctx.group({ parent: S.main });
            ctx.rect(578, 330, 12, 60, { rx: 3, fill: ctx.alpha('pink', 0.3), stroke: 'pink', sw: 1.5, parent: S.gate });
            ctx.label(600, 300, 'SLO gate', { color: 'pink', size: 11, parent: S.gate });
            lines(ctx, b, 800, 640, ['admission at the router:', '  ttft_hat = queued_prefill / R_prefill', '           + uncached_prompt / R_prefill', '  if min_r ttft_hat > SLO → 429 / spill', '', 'optimise GOODPUT, not throughput:', '  req/s meeting TTFT and TPOT SLOs'], { lh: 22 });
            return ctx.reveal(S.gate, { from: 'scale', dur: 500 }).then(function () { return ctx.pulse(S.gate, { color: 'pink', dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: shed a request instead of missing every SLO */
            S.rej = ctx.label(470, 470, '429 · Retry-After: 2 s', { color: 'pink', size: 12, parent: S.main });
            ctx.reveal(S.rej, { from: 'scale', delay: 1500 });
            return ctx.packet(S.inLink, { color: 'pink', dur: 600, r: 6, label: 'critic retry' }).then(function () {
              return ctx.pulse(S.gate, { color: 'pink', dur: 500 });
            }).then(function () {
              return ctx.packet(S.inLink, { color: 'red', dur: 700, r: 6, reverse: true, label: '429' });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Prefill / decode split',
        beats: [
          {
            say: 'Large deployments split each request in two. Prefill is compute bound, decode is memory bandwidth bound, and mixing them on one GPU makes decoding stutter whenever a big prompt arrives.',
            card: { tag: 'KEY IDEA', title: 'Two phases, two bottlenecks', body: 'Prefill wants FLOPs and runs in bursts. Decode wants HBM bandwidth and runs steadily. Separate pools let each pick its own parallelism and GPU type.' },
            deep: '<p><b>Why split</b>: a 30k-token prefill occupies the GPU for ~2 s; co-located decodes in the same batch see their TPOT spike (interference). Disaggregation lets each pool pick its own parallelism, batch size and even GPU type (compute-rich for prefill, HBM-rich for decode).</p>'
          },
          {
            say: 'With disaggregation the router makes two decisions. It picks a prefill worker by queued compute, then a decode worker by free KV cache memory.',
            card: { tag: 'HOW IT WORKS', title: 'Two routing decisions', body: 'Prefill worker: fewest queued prefill tokens, best prefix hits. Decode worker: most free KV blocks and the lowest current per-token latency.' },
            deep: '<p>Routing is now two decisions: prefill worker (min queued prefill tokens, prefix hits) and decode worker (max free KV blocks, current TPOT). Each pool can also autoscale on its own signal: prefill on queue depth, decode on KV-cache utilisation.</p>' +
              '<p>The two choices are made together but scored separately: prefill cost is compute time, so queued tokens divided by prefill rate is the right proxy, while decode cost is memory, so free KV blocks decide whether the stream can even be admitted without eviction.</p>'
          },
          {
            say: 'The KV cache then moves between them over RDMA. For an eight thousand token prompt on a seventy billion parameter model, that is about two point seven gigabytes, roughly fifty milliseconds over a four hundred gigabit link.',
            card: {
              tag: 'NUMBERS', title: 'The KV transfer bill', stat: { v: '2.7 GB', l: 'KV cache of an 8k-token prompt (70B, GQA, BF16): about 54 ms at 50 GB/s, overlapped layer by layer' },
              more: '<p>A Llama-70B-class model has 80 layers and 8 KV heads of dimension 128 in BF16 (2 bytes): 2 (K and V) × 80 × 8 × 128 × 2 B = 327,680 B ≈ 320 KB per token. For 8,192 tokens that is 2.68 GB, and a 400 Gb/s link moves 50 GB/s, so an unpipelined copy would take ≈ 54 ms.</p>'
            },
            deep: '<div class="eq">KV bytes = L · 2 · n<sub>layers</sub> · n<sub>kv</sub> · d<sub>head</sub> · b = 8192 · 2·80·8·128·2 B ≈ 2.7 GB<br>t<sub>xfer</sub> ≈ 2.7 GB / 50 GB/s ≈ 54 ms &nbsp;(pipelined layer-by-layer, mostly hidden)</div>' +
              '<p>Because layer l\'s KV can leave as soon as layer l has been computed, the transfer overlaps with the rest of prefill and adds little to TTFT when the link is fast enough. The decode worker can even start allocating blocks while prefill is still running, so only the last layer\'s KV sits on the critical path.</p>'
          },
          {
            say: 'The decode worker then streams tokens to the agent. Short prompts and cache hits skip the split entirely, because the transfer would cost more than it saves.',
            card: { tag: 'TRADE-OFF', title: 'Skip the split when it costs more', body: 'Conditional disaggregation prefills short prompts and cache hits locally on the decode worker. The transfer only pays for long, cold prompts.' },
            deep: '<p><b>Conditional disaggregation</b> (Dynamo, vLLM) prefills short prompts or high-hit requests locally on the decode worker, because the transfer would cost more than it saves.</p>' +
              '<p>Systems: DistServe, Splitwise, Mooncake (KV-centric, with a distributed KV store over RDMA), NVIDIA Dynamo with NIXL transfers, llm-d P/D, SGLang PD.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.pd = ctx.group();
          ctx.rect(40, 160, 1240, 405, { rx: 14, fill: 'rgba(5,9,18,0.96)', stroke: 'cyan', sw: 1.2, parent: S.pd, glow: true });
          title(ctx, S.pd, 64, 186, 'DISAGGREGATED PREFILL / DECODE', 'cyan');
          S.pf = [0, 1].map(function (i) { return ctx.node({ x: 470, y: 290 + i * 160, w: 250, h: 64, title: 'prefill ' + i, sub: 'H100 TP4 · compute-bound', icon: 'bolt', color: 'blue', parent: S.pd }); });
          S.dc = [0, 1, 2].map(function (i) { return ctx.node({ x: 900, y: 250 + i * 120, w: 250, h: 64, title: 'decode ' + i, sub: 'H200 TP8 · HBM-bound', icon: 'layers', color: 'amber', parent: S.pd }); });
          ctx.focus([S.pd, S.met], 0.12);
          var b = ctx.group();
          title(ctx, b, 80, 600, 'WHY SPLIT · WHAT IT COSTS', 'cyan');
          lines(ctx, b, 80, 636, ['prefill: FLOP-bound, bursty, long (0.1–2 s)', 'decode : HBM-bound, steady, 20–50 ms/token', 'mixing both → TPOT spikes when prompts arrive', '', 'P/D: tune TP, batch, GPU type per phase'], { lh: 22 });
          swapBottom(ctx, S, b);
          /* beat 0: two pools */
          ctx.reveal(S.pd, { from: 'scale', s0: 0.94 });
          return Promise.all([ctx.reveal(S.pf, { from: 'left', delay: 400, stagger: 150 }), ctx.reveal(S.dc, { from: 'right', delay: 500, stagger: 150 })]).then(function () {
            return Promise.all([ctx.pulse(S.pf[0], { color: 'blue', dur: 600 }), ctx.pulse(S.dc[0], { color: 'amber', dur: 600 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the router picks a prefill worker, then a decode worker */
            S.rt = ctx.node({ x: 160, y: 370, w: 170, h: 70, title: 'Router', sub: 'two decisions', icon: 'net', color: 'red', parent: S.pd });
            S.l1 = S.pf.map(function (p) { return ctx.link(S.rt, p, { color: 'blue', parent: S.pd }); });
            S.pickP = ctx.text(470, 385, 'pick: min queued prefill tokens', { size: 11, color: 'blue', anchor: 'middle', font: 'mono', parent: S.pd });
            S.pickD = ctx.text(900, 546, 'pick: max free KV blocks · TPOT', { size: 11, color: 'amber', anchor: 'middle', font: 'mono', parent: S.pd });
            ctx.reveal([S.pickP, S.pickD], { delay: 700, stagger: 300 });
            return Promise.all([ctx.reveal(S.rt, { from: 'left' }), ctx.reveal(S.l1, { from: 'draw', delay: 300, stagger: 150 })]).then(function () {
              return ctx.packet(S.l1[0], { color: 'blue', dur: 600, label: '8k-tok prompt' });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the KV cache crosses over RDMA */
            S.kv = ctx.link(S.pf[0], S.dc[1], { color: 'teal', sw: 3, parent: S.pd });
            S.kvLbl = ctx.label(676, 240, 'KV 2.7 GB · RDMA 54 ms', { color: 'teal', size: 11, parent: S.pd });
            S.kv2 = ctx.link(S.pf[1], S.dc[2], { color: ctx.alpha('teal', 0.4), sw: 1.4, parent: S.pd });
            lines(ctx, b, 760, 636, ['cost: KV transfer over RDMA (NIXL, Mooncake)', '  8k tokens × 320 KB/token ≈ 2.7 GB', '  ≈ 54 ms at 50 GB/s, overlapped per layer'], { lh: 22 });
            ctx.reveal(S.kvLbl, { from: 'scale', delay: 400 });
            return Promise.all([ctx.reveal([S.kv, S.kv2], { from: 'draw', dur: 800, stagger: 200 })]).then(function () {
              return ctx.packet(S.kv, { color: 'teal', dur: 1000, r: 7, label: 'KV' });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: tokens stream to the agent; short prompts skip the transfer */
            S.cl = ctx.node({ x: 1190, y: 370, w: 120, h: 60, title: 'Agent', sub: 'SSE', icon: 'agent', color: 'magenta', titleSize: 14, parent: S.pd });
            S.out = ctx.link(S.dc[1], S.cl, { color: 'amber', parent: S.pd });
            lines(ctx, b, 760, 636 + 4 * 25.08, ['skip it when prompt is short or cache-hit', '  (conditional disaggregation)'], { lh: 22 });
            return Promise.all([ctx.reveal(S.cl, { from: 'right' }), ctx.reveal(S.out, { from: 'draw', delay: 300 })]).then(function () {
              S.outStream = ctx.stream(S.out, { color: 'amber', count: 5, period: 900, r: 3 });
              return ctx.wait(1300);
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Video: pull, not push',
        beats: [
          {
            say: 'Video jobs flip the logic. A shot takes minutes on a whole eight GPU gang, so pushing it to a busy worker would strand it in a local queue.',
            card: { tag: 'PITFALL', title: 'Pushed work gets stranded', body: 'A router that pushes a 90 second job to a busy gang parks it behind that gang\'s current shot, while another gang sits idle.' },
            deep: '<table><tr><th></th><th>LLM request (push)</th><th>Video job (pull)</th></tr>' +
              '<tr><td>Duration</td><td>0.1–60 s</td><td>60–300 s</td></tr>' +
              '<tr><td>Worker concurrency</td><td>~100 in one batch</td><td>1 per 8-GPU gang</td></tr>' +
              '<tr><td>Who decides</td><td>router, per request</td><td>idle worker asks for work</td></tr>' +
              '<tr><td>Failure handling</td><td>client retry</td><td>lease timeout → redelivery</td></tr></table>' +
              '<p>In push mode the router must guess which gang will be free soonest. A wrong guess strands a ~90 s job behind another ~90 s job, and with uniformly distributed remaining time the expected extra wait is about half a shot.</p>'
          },
          {
            say: 'Instead, jobs wait in a durable broker, and workers pull the next job only when they are truly free. Pull is work conserving: no job waits while a gang idles.',
            card: { tag: 'HOW IT WORKS', title: 'Idle workers ask for work', body: 'An idle gang leases the next job from a durable queue. Backpressure is natural: busy workers simply do not ask.' },
            deep: '<p>Pull = <b>work-conserving</b> by construction: a job never waits in a busy worker\'s local queue while another gang idles (the "join-idle-queue" idea). Broker options: Redis Streams / SQS / Pub/Sub with visibility timeouts, or the workflow engine\'s task queue (Temporal task queues are pull-based).</p>' +
              '<p>Priority = multiple queues (interactive previews before batch), and "fetch" can be topology-aware: a GB200 gang pulls only jobs that need ≥ 16 GPUs.</p>'
          },
          {
            say: 'Each pull takes a lease that the worker keeps alive with heartbeats. If a worker dies, the lease expires and the shot is redelivered.',
            card: { tag: 'KEY IDEA', title: 'Leases turn crashes into retries', body: 'The broker never trusts a worker. No heartbeat for 30 seconds and the job goes back into the queue for another gang.' },
            deep: '<pre>loop:\n  job = broker.lease("video", ttl=30)\n  heartbeat every 10 s (extend lease)\n  out = render(job)   # ckpt latents\n  store.put(job.idem_key, out)\n  broker.ack(job)</pre>' +
              '<p>The lease TTL is a trade-off: short means fast failover but false expiry on a slow heartbeat, long means a dead worker holds a job hostage.</p>'
          },
          {
            say: 'Idempotent job keys make sure the trailer never pays for the same shot twice, and checkpointed latents let a retried shot resume mid denoise instead of starting over.',
            card: { tag: 'HOW IT WORKS', title: 'At-least-once plus idempotency', body: 'Delivery is at least once. A key on the output makes duplicate work harmless, which gives an exactly-once effect.' },
            deep: '<p><b>Exactly-once effect = at-least-once delivery + an idempotency key on the output.</b> The output store rejects a second write for the same <code>job.idem_key</code>, so a redelivered shot that finishes twice is billed and stored once.</p>' +
              '<p>Checkpointing latents every N steps means a retry resumes mid-denoise: it loses at most N of the 40 steps instead of the whole ~95 s.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.outStream) S.outStream.stop();
          ctx.remove(S.pd, 400);
          S.vq = ctx.group();
          ctx.rect(40, 160, 1240, 405, { rx: 14, fill: 'rgba(5,9,18,0.96)', stroke: 'lime', sw: 1.2, parent: S.vq, glow: true });
          S.vqT = title(ctx, S.vq, 64, 186, 'VIDEO JOBS: GANG WORKERS', 'lime');
          var st = [['gang A · 8×B200', 'busy · step 31/40', 'lime'], ['gang B · 8×B200', 'idle', 'cyan'], ['gang C · 8×H100', 'busy · step 9/40', 'lime']];
          S.wk = st.map(function (w, i) {
            return ctx.node({ x: 930, y: 250 + i * 120, w: 280, h: 70, title: w[0], sub: w[1], icon: 'gpu', color: w[2], parent: S.vq });
          });
          S.pushSrc = ctx.node({ x: 250, y: 300, w: 190, h: 54, title: 'Router', sub: 'push per request', icon: 'net', color: 'red', parent: S.vq });
          var pushLine = ctx.line(345, 300, 790, 250, { color: 'red', dash: '5 5', sw: 1.6, parent: S.vq });
          S.push = ctx.label(560, 262, 'shot5 pushed: waits behind step 31/40', { color: 'red', size: 11, parent: S.vq });
          ctx.focus([S.vq, S.met], 0.12);
          var b = ctx.group();
          title(ctx, b, 80, 600, 'PUSH vs PULL', 'lime');
          lines(ctx, b, 80, 636, ['push (LLM): router picks replica per request', '  fine when work is short and batched', 'pull (video): idle gang asks the broker', '  work-conserving, no stranded jobs,', '  natural backpressure'], { lh: 22 });
          swapBottom(ctx, S, b);
          /* beat 0: pushing a long job to a busy gang strands it */
          ctx.reveal(S.vq, { from: 'scale', s0: 0.94 });
          return Promise.all([ctx.reveal(S.wk, { from: 'right', delay: 400, stagger: 150 }), ctx.reveal(S.pushSrc, { from: 'left', delay: 600 }),
            ctx.reveal(pushLine, { from: 'draw', delay: 1000, dur: 700 }), ctx.reveal(S.push, { from: 'scale', delay: 1400 })]).then(function () {
            return Promise.all([ctx.pulse(S.wk[0], { color: 'red', dur: 700 }), ctx.pulse(S.wk[1], { color: 'cyan', dur: 700 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: a durable broker; an idle gang pulls the next job */
            ctx.fadeOut([S.push, pushLine, S.pushSrc], 400, true);
            S.vqT.textContent = 'VIDEO JOBS: DURABLE QUEUE + PULLING GANG WORKERS';
            S.wk[1].subEl.textContent = 'idle → lease()';
            S.wk[1].body.setAttribute('stroke', ctx.color('cyan'));
            S.br = ctx.node({ x: 300, y: 370, w: 280, h: 300, kind: 'ghost', color: 'lime', parent: S.vq });
            S.brT = ctx.text(300, 240, 'broker · queue "video"', { size: 13, color: 'lime', anchor: 'middle', font: 'mono', weight: 600, parent: S.vq });
            /* the trailer's last two shots, the critic's re-render of shot 3, and another tenant's NVL72 job */
            S.jobs = [['shot5', '8 GPU · 40 steps', 'hi'], ['shot6', '8 GPU · 40 steps', 'hi'], ['shot3 redo', '8 GPU · critic', 'hi'], ['tenant-B', '16 GPU · NVL72', 'lo']].map(function (jb, i) {
              var g = ctx.group({ parent: S.vq });
              ctx.rect(190, 270 + i * 64, 220, 48, { rx: 8, fill: ctx.alpha('lime', 0.14), stroke: 'lime', sw: 1.2, parent: g });
              ctx.text(206, 288 + i * 64, jb[0] + ' · ' + jb[1], { size: 12, color: 'white', font: 'mono', parent: g });
              ctx.text(206, 306 + i * 64, 'key sha:' + ((i + 5) * 7919 % 9973).toString(16) + ' · prio ' + jb[2], { size: 11, color: 'dim', font: 'mono', parent: g });
              return g;
            });
            S.pull = ctx.link(S.wk[1], S.br, { color: 'cyan', dash: '5 5', label: 'pull: lease(ttl = 30 s)', labelDx: 70, labelDy: -18, parent: S.vq });
            return Promise.all([ctx.reveal([S.br, S.brT], { from: 'left' }), ctx.reveal(S.jobs, { from: 'left', delay: 300, stagger: 120 }), ctx.reveal(S.pull, { from: 'draw', delay: 700 }), ctx.reveal(S.pull.labelEl, { delay: 1100 })]).then(function () {
              return ctx.packet(S.pull, { color: 'cyan', dur: 700, label: 'lease()' });
            }).then(function () {
              var j = S.jobs[0];
              var bx = S.wk[1].box;
              ctx.fade(S.pull, 0.45, 400);
              return ctx.transform(j, { x: bx.l - 422, y: bx.cy - 294 }, 900, 'inOut');
            }).then(function () {
              ctx.fadeOut(S.jobs[0], 400, true);
              S.wk[1].subEl.textContent = 'busy · shot5 · step 1/40';
              S.wk[1].body.setAttribute('stroke', ctx.color('lime'));
              return ctx.pulse(S.wk[1], { color: 'lime', dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: heartbeats keep leases alive; a dead gang loses its lease */
            S.hb = [0, 2].map(function (i) { return ctx.link(S.wk[i], S.br, { color: ctx.alpha('lime', 0.5), sw: 1.2, dash: '2 6', arrow: false, parent: S.vq }); });
            S.hbTxt = ctx.text(600, 548, 'heartbeat every 10 s extends the lease', { size: 11, color: 'dim', anchor: 'middle', font: 'mono', parent: S.vq });
            ctx.reveal(S.hbTxt, { delay: 300 });
            return ctx.reveal(S.hb, { from: 'draw', dur: 700, stagger: 150 }).then(function () {
              S.hbs = S.hb.map(function (l) { return ctx.stream(l, { color: 'lime', count: 2, period: 2200, r: 2.5, reverse: true }); });
              return ctx.wait(1200);
            }).then(function () {
              S.deadLbl = ctx.label(955, 548, 'gang C: node lost → lease expires', { color: 'red', size: 11, parent: S.vq });
              ctx.reveal(S.deadLbl, { from: 'scale' });
              S.wk[2].body.setAttribute('stroke', ctx.color('red'));
              S.wk[2].subEl.textContent = 'no heartbeat · lease expired';
              S.hbs[1].stop();
              return ctx.pulse(S.wk[2], { color: 'red', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the shot is redelivered, with an idempotency key; retries resume from checkpoints */
            lines(ctx, b, 760, 636, ['exactly-once effect = at-least-once delivery', '  + idempotency key on the output', 'lease expiry → redelivery after crash', 'checkpoint latents every N steps', '  → a retried shot resumes mid-denoise'], { lh: 22 });
            S.redo = ctx.group({ parent: S.vq });
            ctx.rect(190, 270, 220, 48, { rx: 8, fill: ctx.alpha('red', 0.14), stroke: 'red', sw: 1.4, parent: S.redo });
            ctx.text(206, 288, 'shot4 · redelivery #2', { size: 12, color: 'white', font: 'mono', parent: S.redo });
            ctx.text(206, 306, 'key sha:f0d · resume @ step 8', { size: 11, color: 'red', font: 'mono', parent: S.redo });
            S.deadLbl.setText('gang C: lease expired → shot redelivered');
            return ctx.reveal(S.redo, { from: 'right', dist: 60, dur: 700, delay: 300 }).then(function () {
              return Promise.all([ctx.pulse(S.redo, { color: 'red', dur: 700 }), ctx.packet(S.hb[1], { color: 'red', dur: 900, label: 'redeliver', reverse: false })]);
            });
          });
        }
      }
    ]
  });
})();
