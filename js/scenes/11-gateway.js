/* L1 — Edge, Gateway & Admission Control. From anycast to an admitted job: scrubbing, L4/L7 balancing,
 * rate limiting, GPU-second quotas, load shedding, resilience patterns and the internal mesh. */
(function () {
  var RAIL = ['Anycast · scrub', 'L4 · Maglev', 'L7 filters', 'Token bucket', 'Quotas', 'Shedding', 'Resilience', 'Regions · mesh'];
  var GW = ['cyan', 'lime', 'amber', 'violet', 'pink'];

  /* ---------- helpers ---------- */
  function newBench(ctx) {
    var S = ctx.state;
    if (S.bench) ctx.remove(S.bench, 350);
    S.bench = ctx.group();
    return S.bench;
  }

  function code(ctx, parent, o) {
    o.parent = parent;
    var g = ctx.code(o);
    function keep(t) { t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.style.whiteSpace = 'pre'; }
    g.lineEls.forEach(keep);
    var add = g.addLine;
    g.addLine = function (s, inst) { var p = add(s, inst); keep(g.lineEls[g.lineEls.length - 1]); return p; };
    return g;
  }

  function heading(ctx, g, x, y, str, col, o) {
    o = o || {};
    return ctx.text(x, y, str, { size: o.size || 15, font: 'display', weight: 700, color: col || 'blue', anchor: o.anchor, parent: g, spacing: 0.5 });
  }

  /* request-path rail at the bottom: progressive-disclosure "you are here" */
  function rail(ctx, idx) {
    var S = ctx.state, C = ctx.C;
    if (!S.rail) {
      S.rail = ctx.group();
      var ws = RAIL.map(function (s) { return s.length * 7.2 + 26; });
      var total = ws.reduce(function (a, b) { return a + b + 22; }, -22);
      var x = 800 - total / 2;
      ctx.text(x - 14, 862, 'REQUEST PATH', { size: 11, font: 'display', weight: 700, color: 'dim', anchor: 'end', spacing: 1.5, parent: S.rail });
      S.railItems = RAIL.map(function (s, i) {
        var r = ctx.rect(x, 849, ws[i], 26, { rx: 13, fill: ctx.alpha('blue', 0.06), stroke: ctx.alpha('blue', 0.45), sw: 1, parent: S.rail });
        var t = ctx.text(x + ws[i] / 2, 862.5, s, { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.rail });
        if (i < RAIL.length - 1) ctx.line(x + ws[i] + 4, 862, x + ws[i] + 18, 862, { color: 'faint', arrow: true, parent: S.rail });
        x += ws[i] + 22;
        return { r: r, t: t };
      });
      ctx.reveal(S.rail, { from: 'up' });
    }
    S.railItems.forEach(function (it, i) {
      var on = i === idx, past = i < idx;
      it.r.setAttribute('fill', on ? ctx.alpha('cyan', 0.28) : ctx.alpha('blue', past ? 0.14 : 0.05));
      it.r.setAttribute('stroke', on ? C.cyan : ctx.alpha('blue', 0.45));
      it.t.setAttribute('fill', on ? C.white : (past ? C.text : C.dim));
    });
  }

  function stopLoops(ctx) {
    var S = ctx.state;
    ['flood', 'prio', 'ddos', 'cb'].forEach(function (k) { if (S[k]) { S[k].stop(); S[k] = null; } });
  }

  /* Maglev table population (Eisenbud et al., NSDI'16) */
  function maglev(ids, params, M) {
    var N = ids.length, next = [], entry = [], n = 0, perm = [];
    for (var i = 0; i < N; i++) {
      next.push(0);
      var p = params[ids[i]], row = [];
      for (var j = 0; j < M; j++) row.push((p[0] + j * p[1]) % M);
      perm.push(row);
    }
    for (var k = 0; k < M; k++) entry.push(-1);
    for (;;) {
      for (var b = 0; b < N; b++) {
        var c = perm[b][next[b]];
        while (entry[c] >= 0) { next[b]++; c = perm[b][next[b]]; }
        entry[c] = ids[b]; next[b]++; n++;
        if (n === M) return entry;
      }
    }
  }

  /* world map projection */
  function proj(lon, lat) { return { x: 50 + (lon + 180) / 360 * 820, y: 196 + (80 - lat) / 140 * 468 }; }
  var LAND = [
    [[-165, 65], [-140, 70], [-95, 72], [-65, 60], [-55, 50], [-80, 25], [-97, 18], [-105, 22], [-125, 40], [-130, 55], [-165, 60]],
    [[-80, 10], [-60, 10], [-35, -7], [-40, -22], [-58, -38], [-70, -52], [-75, -40], [-70, -18], [-81, -5]],
    [[-10, 36], [-10, 44], [-5, 48], [-5, 58], [10, 63], [25, 70], [40, 68], [45, 55], [30, 45], [25, 36], [10, 38]],
    [[-17, 15], [-5, 35], [10, 37], [32, 31], [43, 12], [51, 11], [40, -15], [32, -30], [20, -35], [12, -17], [8, 4], [-8, 5]],
    [[45, 55], [40, 68], [70, 73], [110, 75], [140, 70], [170, 66], [160, 58], [140, 50], [122, 40], [120, 23], [108, 10], [100, 2], [97, 17], [80, 8], [72, 20], [57, 25], [48, 30], [35, 35], [30, 45]],
    [[114, -22], [122, -18], [130, -12], [137, -12], [145, -15], [153, -26], [150, -37], [140, -38], [130, -32], [115, -35]]
  ];
  var POPS = [['SJC', -121.9, 37.3], ['IAD', -77.4, 38.9], ['GRU', -46.5, -23.4], ['LHR', -0.5, 51.5], ['FRA', 8.7, 50.1], ['JNB', 28, -26], ['BOM', 72.9, 19.1], ['SIN', 103.8, 1.35], ['NRT', 140.4, 35.7], ['SYD', 151.2, -33.9]];

  Atlas.register({
    id: 'gateway',
    refs: [
      'Eisenbud et al., <i>Maglev: A Fast and Reliable Software Network Load Balancer</i>, USENIX NSDI 2016',
      'Dean &amp; Barroso, <i>The Tail at Scale</i>, Communications of the ACM 56(2), 2013',
      'Nichols &amp; Jacobson, <i>Controlling Queue Delay</i>, ACM Queue 2012; Nichols et al., <i>RFC 8289: Controlled Delay Active Queue Management</i>, IETF 2018',
      'Beyer et al. (eds.), <i>Site Reliability Engineering</i>, O\'Reilly 2016, ch. 21 “Handling Overload” and ch. 22 “Addressing Cascading Failures”',
      'ATM Forum, <i>Traffic Management Specification 4.0</i> (GCRA), 1996',
      'Brooker, <i>Exponential Backoff and Jitter</i>, AWS Architecture Blog, 2015',
      'Envoy Proxy documentation: <i>HTTP filter chain, JWT authentication, ext_authz, global and local rate limiting, circuit breaking, retry budgets</i>, 2025; SPIFFE project, <i>Secure Production Identity Framework for Everyone</i> specification (SVIDs, workload API), CNCF 2024',
      'Kwiatkowski et al., <i>Post-quantum hybrid ECDHE-MLKEM key agreement for TLS 1.3</i> (X25519MLKEM768), IETF draft-ietf-tls-ecdhe-mlkem, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'The front door',
        beats: [
          {
            say: 'Before a request can touch a GPU, it walks through a series of doors. Each one is cheaper than the one after it, and each one only sees what the previous door let through.',
            card: { tag: 'KEY IDEA', title: 'Five gates before any GPU', body: 'Anycast edge, scrubber, L4 balancer, L7 gateway and admission control: a cascade of filters, cheapest first.' },
            deep: '<p>The edge is a <b>cascade of filters with increasing cost per decision and decreasing traffic volume</b>. Each layer only sees what the previous one passed, so the expensive checks run on a small, already-cleaned fraction of the traffic.</p>' +
              '<p>The running example, <code>POST /v1/jobs</code> for the fox-astronaut trailer, passes all five gates in a few milliseconds of wall-clock time, most of it network round trips rather than computation.</p>'
          },
          {
            say: 'Which point of presence is closest, is this traffic an attack, and which gateway host takes the connection? The first three doors answer these in nanoseconds to microseconds.',
            card: { tag: 'HOW IT WORKS', title: 'Each door asks one question', body: 'Routing picks a PoP, scrubbing separates attack from user, and the L4 balancer picks a host. None of them needs to parse a request.' },
            deep: '<table><tr><th>Layer</th><th>Decides</th><th>Cost / decision</th></tr>' +
              '<tr><td>Anycast + GeoDNS</td><td>which PoP / region</td><td>0 (routing)</td></tr>' +
              '<tr><td>Scrub / WAF</td><td>attack vs user</td><td>ns–µs (XDP/eBPF, SYN cookies)</td></tr>' +
              '<tr><td>L4 LB</td><td>which gateway host</td><td>~100 ns per packet (hash + table)</td></tr></table>' +
              '<p>None of these layers parses HTTP. They work on packet headers, which is why they keep up with line rate even under attack.</p>'
          },
          {
            say: 'Who is the caller, and are they allowed to do this? And finally: may this job enter right now, given the tenant\'s budget and the cluster\'s load?',
            card: { tag: 'NUMBERS', title: 'The last door is still cheap', stat: { v: '< 1 ms', u: 'admission', l: 'to weigh tenant budget and cluster load: cheap next to a single GPU-second' } },
            deep: '<table><tr><th>Layer</th><th>Decides</th><th>Cost / decision</th></tr>' +
              '<tr><td>L7 gateway</td><td>identity, route, schema</td><td>~10–100 µs CPU (TLS, JWT verify)</td></tr>' +
              '<tr><td>Admission</td><td>may it run <i>now</i></td><td>~0.1–1 ms (Redis, estimator)</td></tr></table>' +
              '<p>Only here does the system parse HTTP, verify a signature and read shared state. That is why these doors sit behind the cheap ones.</p>'
          },
          {
            say: 'The design principle is simple: reject as early and as cheaply as possible. In an attack, the funnel narrows from over a million requests per second at the edge to a few tens of thousands at the job service.',
            card: { tag: 'NUMBERS', title: 'The funnel narrows fast', stat: { v: '97%', u: 'shed early', l: 'illustrative attack: 1.2M req/s arrive at the edge, 31k req/s are left when the job service sees anything' } },
            deep: '<p>Failure responses are part of the contract, and each layer answers in its own dialect: dropped packets at the scrubber, <code>401/403</code> (identity), <code>413/400</code> (shape), <code>429</code> (your limit, with <code>Retry-After</code>) and <code>503</code> (our overload).</p>' +
              '<p>Clients must react differently to each: re-authenticate, fix the request, back off, or retry somewhere else. Volumes on the chart are log scale and illustrative: the scrubber alone removes about 97 % of the arriving packets.</p>'
          },
          {
            say: 'Admitted work is expensive. A rejected request costs microseconds, while an admitted trailer costs about five thousand four hundred GPU seconds.',
            card: { tag: 'WHY IT MATTERS', title: 'Billions to one', body: 'A dropped packet costs microseconds of CPU. An admitted trailer costs thousands of GPU-seconds, a ratio in the billions. Every cheap check protects the expensive resource.' },
            deep: '<p>Asymmetry drives the design: a rejected request costs microseconds; an admitted trailer costs about 5,400 GPU-seconds (6 shots × 8 GPUs × 95 s, plus planning, encoding and one budgeted re-render). So the gateway front-loads every cheap check and makes admission <i>cost-aware</i>, not merely request-count-aware.</p>' +
              '<div class="note">The scarce resource is the accelerator, not the request.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var P = [
            ['Creators', 'mobile · web · API', 'user', 'white', 'many devices', '—'],
            ['Anycast Edge', 'GeoDNS · BGP · PoP', 'globe', 'blue', 'which PoP?', 'RTT ~5–30 ms'],
            ['Scrub + WAF', 'DDoS · bots · rules', 'shield', 'pink', 'attack or user?', 'inline · ns–µs'],
            ['L4 LB', 'ECMP · Maglev', 'net', 'blue', 'which host?', '~100 ns/pkt'],
            ['L7 Gateway', 'TLS · JWT · routes', 'server', 'blue', 'who? allowed?', '~10–100 µs'],
            ['Admission', 'rate · quota · shed', 'queue', 'cyan', 'may it run now?', '< 1 ms'],
            ['Job Services', 'gRPC · mTLS', 'layers', 'magenta', 'do the work', '→ orchestrator']
          ];
          S.pipe = ctx.group();
          S.pn = [];
          S.pl = [];
          S.rj = [];
          var X0 = 170, DX = 210;      /* node centres: X0 + i * DX, so the row is centred on the stage with ~80 px margins */
          function hop(k, col, label) {
            return S.pl.slice(0, k).reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: col, dur: 380, label: label }); }); }, Promise.resolve());
          }
          function ask(i) {
            var p = P[i], n = S.pn[i], x = n.box.cx;
            n.q = ctx.text(x, 330, p[4], { size: 16, font: 'display', weight: 600, color: 'white', anchor: 'middle', parent: S.pipe });
            if (i === 0) return [n.q];
            n.l = ctx.label(x, 372, p[5], { color: p[3], size: 11, parent: S.pipe });
            return [n.q, n.l];
          }
          function questions(idx) {
            return idx.reduce(function (pr, i) {
              return pr.then(function () {
                var els = ask(i);
                ctx.reveal(els[0], { from: 'down', dur: 400 });
                if (els[1]) ctx.reveal(els[1], { from: 'fade', dur: 400, delay: 150 });
                return ctx.pulse(S.pn[i], { color: S.pn[i].color, dur: 450 });
              });
            }, Promise.resolve());
          }
          /* beat 0: the doors and one honest request */
          function b0() {
            P.forEach(function (p, i) {
              S.pn.push(ctx.node({ x: X0 + i * DX, y: 440, w: 184, h: 66, title: p[0], sub: p[1], icon: p[2], color: p[3], titleSize: 15, subSize: 11, parent: S.pipe }));
            });
            for (var i = 0; i < 6; i++) S.pl.push(ctx.link(S.pn[i], S.pn[i + 1], { color: 'blue', straight: true, parent: S.pipe }));
            ctx.hud('5 gates between a keystroke and a GPU');
            return Promise.all([ctx.reveal(S.pn, { from: 'left', stagger: 120 }), ctx.reveal(S.pl, { from: 'draw', stagger: 110, delay: 400 })]).then(function () {
              return hop(6, 'lime', 'POST /v1/jobs');
            });
          }
          /* beat 1: the cheap doors */
          function b1() {
            var q0 = ask(0);
            ctx.reveal(q0, { from: 'down', dur: 400 });
            return questions([1, 2, 3]);
          }
          /* beat 2: identity and admission */
          function b2() { return questions([4, 5, 6]); }
          /* beat 3: the funnel narrows during an attack */
          function b3() {
            var vol = [[1.2e6, '1.2M'], [1.2e6, '1.2M'], [1.2e6, '1.2M'], [4.1e4, '41k'], [4.1e4, '41k'], [3.6e4, '36k'], [3.1e4, '31k']];
            var vb = ctx.group({ parent: S.pipe });
            ctx.text(X0 - 92, 196, 'req/s arriving (log scale, during an attack)', { size: 12, font: 'mono', color: 'dim', parent: vb });
            var vbars = vol.map(function (v, i) {
              var x = X0 + i * DX, h = (Math.log10(v[0]) - 3) / 4 * 80;
              var r = ctx.rect(x - 22, 292 - h, 44, h, { rx: 3, fill: ctx.alpha(i < 3 ? 'red' : 'blue', 0.45), stroke: i < 3 ? 'red' : 'blue', sw: 1, parent: vb });
              ctx.text(x, 292 - h - 12, v[1], { size: 12, font: 'mono', color: i < 3 ? 'red' : 'blue', anchor: 'middle', weight: 600, parent: vb });
              return r;
            });
            ctx.line(X0 - 92, 293, X0 + 6 * DX + 92, 293, { color: 'faint', parent: vb });
            var bin = ctx.group({ parent: S.pipe });
            ctx.rect(X0 + 2 * DX - 90, 640, 3 * DX + 180, 50, { rx: 10, fill: 'rgba(255,77,109,0.07)', stroke: ctx.alpha('red', 0.6), dash: '6 5', parent: bin });
            ctx.text(X0 + 3.5 * DX, 665, 'rejected early & cheaply:  dropped · 401 / 403 · 429 + Retry-After', { size: 14, font: 'mono', color: 'red', anchor: 'middle', parent: bin });
            [[2, 'drop'], [4, '401/403'], [5, '429']].forEach(function (r) {
              var x = X0 + r[0] * DX;
              S.rj.push(ctx.path('M' + x + ',473 L' + x + ',638', { color: ctx.alpha('red', 0.7), sw: 1.5, dash: '4 4', arrow: true, parent: bin }));
              ctx.label(x + 36, 560, r[1], { color: 'red', size: 11, parent: bin });
            });
            return Promise.all([ctx.reveal(vb, { from: 'fade' }), ctx.reveal(vbars, { from: 'up', stagger: 100, delay: 300, dist: 12 }), ctx.reveal(bin, { from: 'up', delay: 600 })]).then(function () {
              return Promise.all([
                hop(6, 'lime', 'POST /v1/jobs'),
                ctx.wait(300).then(function () { return hop(2, 'red', 'SYN flood'); }).then(function () { return ctx.packet(S.rj[0], { color: 'red', dur: 450 }); }),
                ctx.wait(600).then(function () { return hop(4, 'amber', 'expired JWT'); }).then(function () { return ctx.packet(S.rj[1], { color: 'red', dur: 450 }); }),
                ctx.wait(900).then(function () { return hop(5, 'orange', 'over quota'); }).then(function () { return ctx.packet(S.rj[2], { color: 'red', dur: 450 }); })
              ]);
            });
          }
          /* beat 4: the cost asymmetry */
          function b4() {
            var pr = ctx.text(800, 750, 'A rejected request costs microseconds at the edge. An admitted trailer costs ~5,400 GPU-seconds.', { size: 17, font: 'display', weight: 600, color: 'text', anchor: 'middle', parent: S.pipe });
            return ctx.reveal(pr, { from: 'up' }).then(function () {
              return Promise.all([ctx.pulse(S.pn[2], { color: 'red', times: 2, dur: 500 }), ctx.pulse(S.pn[6], { color: 'magenta', times: 2, dur: 500 })]);
            });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Anycast, GeoDNS & scrubbing',
        beats: [
          {
            say: 'Every edge location announces the same IP prefix over BGP. That is anycast: the internet\'s own routing delivers each user to a nearby point of presence.',
            card: { tag: 'KEY IDEA', title: 'One address, many places', body: 'Every point of presence advertises the same prefix. BGP path selection, not DNS, decides which one you reach.' },
            deep: '<p><b>Anycast</b>: every PoP advertises <code>203.0.113.0/24</code>; BGP picks the “best” path (shortest AS path, local preference), usually but not always the geographically nearest. Risk: route flaps can move a TCP flow mid-connection, which QUIC connection IDs help survive.</p>' +
              '<p>Nearest by BGP is not nearest by latency, because path selection ignores RTT. Operators steer with communities and AS-path prepending, and verify with client-side RTT probes.</p>'
          },
          {
            say: 'GeoDNS can steer a tenant to a home region on top. With the client subnet extension, the answer depends on where the user really is, not where their resolver sits.',
            card: { tag: 'HOW IT WORKS', title: 'GeoDNS picks the region', body: 'DNS answers steer each tenant to its home region for data residency. Inside a region, anycast picks the nearest site.' },
            deep: '<p><b>GeoDNS</b>: answers depend on the resolver or, with <b>EDNS Client Subnet</b>, the user\'s /24. A TTL of 30–60 s bounds failover time. The typical combination: GeoDNS chooses the <i>region</i> (data residency), anycast chooses the <i>PoP</i>.</p>' +
              '<p>ECS trades privacy for accuracy, since the client\'s network prefix is now revealed to the authoritative server, so many public resolvers truncate or omit it.</p>'
          },
          {
            say: 'When the Frankfurt site withdraws its route for maintenance, its users quietly shift to London. There is no DNS record to expire, only a routing update. Click any site to withdraw it yourself.',
            card: { tag: 'TRY IT', title: 'Click a site to withdraw it', body: 'Its users re-route in seconds, because failover is a BGP route withdrawal. DNS failover would wait out a 30 to 60 second TTL plus every resolver cache.' },
            deep: '<p>Failover is a route withdrawal: BGP convergence takes seconds, and there is no DNS TTL to wait out. The traffic that was going to Frankfurt lands on the next-best PoP by AS path, here London. The number beside each site is how many of the 42 sample users it serves. Click any other site to take it out as well, and click it again to bring it back.</p>' +
              '<p>The catch is capacity. Peers must absorb the shifted load, so each site is provisioned with N+1 headroom, or the failover itself becomes the overload: withdraw two neighbours and watch the survivor collect both crowds.</p>'
          },
          {
            say: 'Anycast is also the first DDoS defense. A flood aimed at one address is split by BGP across dozens of sites, so no single site takes the whole attack.',
            card: {
              tag: 'NUMBERS', title: 'Absorb it everywhere', stat: { v: '22.2 Tb/s', l: 'a UDP flood Cloudflare reported mitigating in September 2025: only a globally spread edge can soak that up' },
              more: '<p>Big floods are usually <i>reflection</i> attacks: a small spoofed request makes an open service send a large reply to the victim. Typical bandwidth amplification is about 28–54× for DNS, up to 556× for NTP, and over 50,000× for memcached, which produced the 1.35 Tb/s attack on GitHub in 2018. Edges drop the well-known reflector source ports by default.</p>'
            },
            deep: '<p><b>Volumetric math</b>: an attack of A b/s from bots spread by BGP over N PoPs lands roughly</p>' +
              '<div class="eq">A<sub>PoP</sub> ≈ A · w<sub>i</sub>, &nbsp; Σ w<sub>i</sub> = 1 &nbsp;⇒&nbsp; needs C<sub>PoP</sub> ≥ max<sub>i</sub> A·w<sub>i</sub></div>' +
              '<p>Volumetric floods passed 20 Tb/s in 2025. Only a network with hundreds of Tb/s of aggregate edge capacity absorbs that, and only if anycast spreads it.</p>'
          },
          {
            say: 'Each site then scrubs locally, with SYN cookies, client fingerprints and firewall rules, so only clean traffic moves inward.',
            card: { tag: 'NUMBERS', title: 'Scrub at every layer', stat: { v: '99.8%', u: 'dropped', l: 'illustrative funnel: 1.2 Tb/s of ingress leaves as 2.9 Gb/s of clean traffic after L3/4, TLS and L7 scrubbing' } },
            deep: '<ul><li><b>L3/4</b>: XDP/eBPF drop rules, SYN cookies (no state until the third packet returns), UDP amplification filters, per-source PPS limits.</li>' +
              '<li><b>TLS/L7</b>: JA4 client fingerprints, bot scores, WAF rule sets (OWASP CRS), path and method allow-lists for the API.</li></ul>' +
              '<p>A SYN cookie encodes the connection parameters into the initial sequence number as a keyed hash, so a flood of spoofed SYNs consumes no memory; only a valid returning ACK creates state.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.pipe, 450);
          rail(ctx, 0);
          var B = newBench(ctx);
          var pops, cl, fra, map, ddosCap;
          S.out = {};                               /* PoPs whose route is currently withdrawn */
          S.counts = false;                         /* PoP labels show user counts only from the failover beat on */
          /* nearest PoP by BGP that still announces the prefix */
          function nearest(p) {
            var best = null, bd = 1e9;
            pops.forEach(function (q) { if (S.out[q.name]) return; var d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } });
            return best;
          }
          function liveCount() { return pops.length - Object.keys(S.out).length; }
          /* once failover is in play, each PoP label also shows how many of the sample users it serves */
          function refreshCounts() {
            if (!S.counts) return;
            pops.forEach(function (p) {
              var n = cl.filter(function (c) { return c.n === p; }).length;
              p.txt.textContent = p.name + ' · ' + n;
            });
          }
          /* re-attach every client to its nearest live PoP (animated), amber = not on its home PoP */
          function steer() {
            var anims = [];
            cl.forEach(function (c) {
              var n2 = nearest(c.p);
              if (n2 !== c.n) {
                var fx = parseFloat(c.ln.getAttribute('x2')), fy = parseFloat(c.ln.getAttribute('y2'));
                c.n = n2;
                anims.push(ctx.animate(c.ln, { x2: [fx, n2.x], y2: [fy, n2.y] }, 700, 'inOut'));
              }
              var away = c.n !== c.home;
              c.ln.setAttribute('stroke', ctx.alpha(away ? 'amber' : 'cyan', away ? 0.9 : 0.6));
              c.ln.setAttribute('stroke-width', away ? 1.8 : 1.2);
            });
            refreshCounts();
            return Promise.all(anims);
          }
          function setOut(pop, on) {
            if (on) S.out[pop.name] = true; else delete S.out[pop.name];
            pop.ring.setAttribute('stroke', ctx.color(on ? 'red' : 'cyan'));
            pop.ring.setAttribute('stroke-width', 1.5);
            pop.tag.setAttribute('opacity', on ? 1 : 0);
            return steer();
          }
          /* beat 0: one prefix, every PoP; users land on the nearest */
          function b0() {
            heading(ctx, B, 60, 176, 'ANYCAST · one prefix 203.0.113.0/24 announced from every PoP');
            map = ctx.group({ parent: B });
            ctx.rect(50, 190, 820, 480, { rx: 12, fill: 'rgba(8,16,32,0.6)', stroke: ctx.alpha('blue', 0.35), sw: 1, parent: map });
            for (var lo = -150; lo <= 150; lo += 30) { var a = proj(lo, 80), b = proj(lo, -60); ctx.line(a.x, 192, b.x, 668, { color: ctx.alpha('blue', 0.1), sw: 1, parent: map }); }
            for (var la = 60; la >= -40; la -= 20) { var c = proj(-180, la); ctx.line(52, c.y, 868, c.y, { color: ctx.alpha('blue', 0.1), sw: 1, parent: map }); }
            LAND.forEach(function (poly) { ctx.poly(poly.map(function (p) { var q = proj(p[0], p[1]); return [q.x, q.y]; }), { fill: ctx.alpha('blue', 0.1), stroke: ctx.alpha('blue', 0.35), parent: map }); });
            pops = POPS.map(function (p) {
              var q = proj(p[1], p[2]);
              var g = ctx.group({ parent: map });
              ctx.circle(q.x, q.y, 9, { fill: ctx.alpha('cyan', 0.2), stroke: 'cyan', sw: 1.5, parent: g, glow: true });
              var lo2 = p[0] === 'LHR' ? [-12, -14, 'end'] : (p[0] === 'FRA' ? [12, -14, 'start'] : [0, -17, 'middle']);
              var lt = ctx.text(q.x + lo2[0], q.y + lo2[1], p[0], { size: 12, font: 'mono', color: 'cyan', anchor: lo2[2], weight: 600, parent: g });
              ctx.circle(q.x, q.y, 12, { fill: 'rgba(0,0,0,0.001)', parent: g });      /* comfortable click target */
              return { g: g, x: q.x, y: q.y, name: p[0], ring: g.firstChild, txt: lt };
            });
            var r = ctx.rng(42), clients = [];
            var centers = [[-100, 40, 6], [-75, 40, 5], [-47, -18, 4], [0, 51, 4], [12, 48, 6], [28, -20, 2], [77, 22, 5], [105, 8, 4], [135, 36, 4], [148, -30, 2]];
            centers.forEach(function (cc) {
              for (var k = 0; k < cc[2]; k++) clients.push(proj(cc[0] + (r() - 0.5) * 26, cc[1] + (r() - 0.5) * 16));
            });
            cl = clients.map(function (p) {
              var n = nearest(p);
              var ln = ctx.line(p.x, p.y, n.x, n.y, { color: ctx.alpha('cyan', 0.6), sw: 1.2, parent: map });
              var dot = ctx.circle(p.x, p.y, 2.6, { fill: 'white', parent: map });
              return { p: p, n: n, home: n, ln: ln, dot: dot };
            });
            fra = pops[4];
            ctx.hud('same IP everywhere · nearest PoP by BGP');
            ctx.reveal(map, { from: 'fade' });
            return ctx.reveal(cl.map(function (c) { return c.ln; }), { from: 'draw', stagger: 18, delay: 300, dur: 400 });
          }
          /* beat 1: GeoDNS */
          function b1() {
            var dns = code(ctx, B, { x: 910, y: 190, w: 650, title: 'GeoDNS · steer to the tenant\'s home region', lang: 'text', size: 12, color: 'blue', lines: [
              '$ dig api.genesis.example +subnet=198.51.100.0/24',
              'api.genesis.example.   60 IN CNAME  eu.api.genesis.example.',
              'eu.api.genesis.example. 60 IN A      203.0.113.7   ; anycast',
              '; ECS lets DNS see the user\'s /24, not the resolver',
              '; TTL 60 s bounds DNS failover; anycast fails over in seconds'
            ] });
            return ctx.reveal(dns, { from: 'right' }).then(function () { return ctx.pulse(dns, { color: 'blue', dur: 700 }); });
          }
          /* beat 2: Frankfurt withdraws, users shift to London; afterwards every PoP is clickable */
          function b2() {
            /* one hidden "BGP withdraw" tag per PoP, placed clear of the neighbours */
            pops.forEach(function (p) {
              var dx = p.name === 'FRA' ? 72 : (p.name === 'LHR' ? -78 : (p.x > 700 ? -62 : 0)), dy = (p.name === 'FRA' || p.name === 'LHR') ? 44 : 28;
              p.tag = ctx.label(p.x + dx, p.y + dy, p.name + ': BGP withdraw', { color: 'red', textColor: 'white', bgAlpha: 0.55, size: 11, parent: map, opacity: 0 });
            });
            var line3 = ctx.text(60, 712, 'Anycast failover = route withdrawal (seconds), not DNS TTL expiry + resolver caching', { size: 13, font: 'mono', color: 'text', parent: B, opacity: 0 });
            pops.forEach(function (p) {
              p.g.style.cursor = 'pointer';
              p.g.addEventListener('click', function () {
                var down = !S.out[p.name];
                if (down && Object.keys(S.out).length >= 5) return;       /* keep at least five sites announcing */
                setOut(p, down).then(function () { ctx.pulse(p.g, { color: down ? 'red' : 'cyan', dur: 500 }); });
              });
            });
            S.counts = true;
            var moved = setOut(fra, true);
            ctx.reveal(fra.tag, { from: 'scale', dur: 350 });
            ctx.reveal(line3, { from: 'up' });
            return moved;
          }
          /* beat 3: the flood is split across the PoPs */
          function b3() {
            var bots = [];
            var rb = ctx.rng(9);
            for (var d = 0; d < 34; d++) {
              var src = proj(-170 + rb() * 340, -50 + rb() * 120);
              bots.push({ s: src, ph: rb(), el: ctx.circle(src.x, src.y, 2.4, { fill: 'red', parent: map, opacity: 0 }) });
            }
            ddosCap = ctx.text(460, 652, '', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: map });
            var line2 = ctx.text(60, 736, 'Attack split by BGP across N PoPs:  A_PoP ≈ A · w_i  (Σ w_i = 1)', { size: 13, font: 'mono', color: 'text', parent: B, opacity: 0 });
            ctx.reveal(line2, { from: 'up' });
            var t0 = null;
            S.ddos = ctx.loop(function (t) {
              if (t0 === null) t0 = t;
              var tt = (t - t0) * Math.min(ctx.speed, 4);
              var on = tt > 0.4;
              bots.forEach(function (b) {
                if (!on) { b.el.setAttribute('opacity', 0); return; }
                var tg = nearest(b.s), f = ((tt * 0.45) + b.ph) % 1;
                b.el.setAttribute('cx', b.s.x + (tg.x - b.s.x) * f);
                b.el.setAttribute('cy', b.s.y + (tg.y - b.s.y) * f);
                b.el.setAttribute('opacity', (0.9 * Math.sin(f * Math.PI)).toFixed(2));
              });
              ddosCap.textContent = on ? 'flood lands on ' + liveCount() + ' PoPs — each absorbs a slice, scrubs locally' : '';
              pops.forEach(function (p) { if (!S.out[p.name]) p.ring.setAttribute('stroke-width', on ? 1.5 + Math.abs(Math.sin(tt * 3 + p.x)) * 2 : 1.5); });
            });
            return ctx.wait(2600);
          }
          /* beat 4: local scrubbing funnel */
          function b4() {
            var fn = ctx.group({ parent: B, opacity: 0 });
            heading(ctx, fn, 910, 368, 'SCRUBBING FUNNEL (illustrative attack)', 'pink', { size: 13 });
            var stages = [['ingress: botnet + users', '1.2 Tb/s', 1.2e12, 'red'], ['after L3/4: XDP · SYN cookies · UDP', '38 Gb/s', 3.8e10, 'pink'], ['after TLS: JA4 · handshake rate', '4.1 Gb/s', 4.1e9, 'pink'], ['after L7: bot score · WAF · allow-list', '2.9 Gb/s', 2.9e9, 'lime']];
            ctx.text(910, 392, 'volume (log scale)', { size: 11, font: 'mono', color: 'dim', parent: fn });
            var fbars = stages.map(function (st, i) {
              var y = 406 + i * 50, w = 30 + (Math.log10(st[2]) - 9) / 3.1 * 240;
              var g = ctx.group({ parent: fn });
              ctx.rect(910, y, w, 30, { rx: 5, fill: ctx.alpha(st[3], 0.2), stroke: ctx.alpha(st[3], 0.8), sw: 1.2, parent: g });
              ctx.text(918, y + 15, st[1], { size: 12, font: 'mono', color: 'white', weight: 600, parent: g });
              ctx.text(1200, y + 15, st[0], { size: 12, font: 'mono', color: 'text', parent: g });
              return g;
            });
            ctx.text(1200, 622, 'clean traffic → L4 load balancers', { size: 12, font: 'mono', color: 'lime', parent: fn });
            var line1 = ctx.text(60, 760, 'SYN cookies: no per-connection state until the handshake completes', { size: 13, font: 'mono', color: 'text', parent: B, opacity: 0 });
            ctx.reveal(line1, { from: 'up', delay: 600 });
            ctx.reveal(fn, { from: 'fade', dur: 300 });
            return ctx.reveal(fbars, { from: 'down', stagger: 200 });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'L4: ECMP + Maglev',
        beats: [
          {
            say: 'Inside the site, routers spread packets across a fleet of layer-four load balancers using equal-cost multipath hashing. Behind them stand the gateway hosts that will do the real work.',
            card: { tag: 'HOW IT WORKS', title: 'ECMP: hash, do not coordinate', body: 'Routers hash each flow\'s five-tuple onto the balancers. Adding or removing one reshuffles some flows, which is harmless here.' },
            deep: '<p><b>ECMP</b>: routers hash the 5-tuple (source and destination address and port, protocol) onto k equal-cost next hops, which are the L4 balancers. Adding or removing a balancer rehashes some flows, which is harmless because every balancer computes the <i>same</i> backend choice.</p>' +
              '<p>Modern software L4 tiers such as Katran (Meta, XDP/eBPF) and Cloudflare\'s Unimog run on commodity servers and sustain millions of packets per second per core.</p>'
          },
          {
            say: 'Each balancer builds the same Maglev lookup table from the same backend list. Every backend takes turns claiming its next preferred free slot, until all thirteen slots are owned.',
            card: {
              tag: 'NUMBERS', title: 'A prime-sized lookup table', stat: { v: '65,537', u: 'slots', l: 'typical production table size (a prime); the demo uses 13. Each host owns floor or ceiling of M over N slots' },
              more: '<p>Why the counts differ by at most one: in every round each backend claims exactly one free slot, so after r rounds all backends own r slots. Because every permutation eventually visits every slot (M is prime), a backend can always find a free one until the table is full.</p>'
            },
            deep: '<p><b>Maglev table</b> (M prime, e.g. 65,537; here 13). Each backend i has a permutation of table slots:</p>' +
              '<div class="eq">offset<sub>i</sub> = h<sub>1</sub>(name<sub>i</sub>) mod M, &nbsp; skip<sub>i</sub> = h<sub>2</sub>(name<sub>i</sub>) mod (M−1) + 1<br>perm<sub>i</sub>[j] = (offset<sub>i</sub> + j·skip<sub>i</sub>) mod M</div>' +
              '<pre>while filled &lt; M:\n  for i in backends:\n    s = next free slot in perm[i]\n    entry[s] = i</pre>' +
              '<p>Because M is prime, every permutation visits every slot exactly once. Round-robin claiming gives near-perfect balance: each backend owns ⌊M/N⌋ or ⌈M/N⌉ slots.</p>'
          },
          {
            say: 'To route a packet, hash its five-tuple, take the remainder modulo the table size, and read the entry. Because every balancer holds the identical table, any of them can take any packet.',
            card: { tag: 'KEY IDEA', title: 'Same table, same answer', body: 'No shared state between balancers: an identical table plus a deterministic hash means every balancer picks the same gateway.' },
            deep: '<p>Lookup is <code>entry[hash(5-tuple) mod M]</code>: O(1) and cache-resident (65,537 entries of one to four bytes is at most 256 KB). Nothing is looked up on the network, so the lookup adds no latency and no coordination.</p>' +
              '<p>The Maglev paper reports line-rate 10 Gb/s of small packets per machine with a kernel-bypass datapath. Return traffic typically bypasses the balancer altogether, as the last beat shows.</p>'
          },
          {
            say: 'When a gateway host dies, the table is rebuilt with minimal disruption: the dead host\'s slots move, plus the odd extra slot. Click any gateway to kill it and watch the table change.',
            card: { tag: 'TRY IT', title: 'Click a gateway to kill it', body: 'Here gw-3 died and 3 of 13 slots changed: 2 were its own, 1 was collateral. Minimal is not zero.' },
            deep: '<p>Properties of the table: near-perfect balance and <b>near-minimal disruption</b> when the set changes. Minimal is not zero: a removed backend frees its slots, and because the fill order shifts, a few other slots can change too (here 1 of 13). The paper trades a little extra disruption for perfect balance.</p>' +
              '<details><summary>Go deeper</summary><p>The paper compares tables of 65,537 and 655,373 entries. A larger M lowers both the imbalance and the extra churn, since each is on the order of N/M of the table, at the price of a bigger table and slower generation. Consistent hashing (Karger) disrupts less but balances worse, which matters more for a load balancer than for a cache.</p></details>'
          },
          {
            say: 'A connection tracking table pins established flows to their backend, so even the few remapped slots do not break live connections. Replies skip the balancer entirely, using direct server return.',
            card: { tag: 'HOW IT WORKS', title: 'Pin the flow, skip the return', body: 'Conntrack keeps existing connections on their host even if the table moves. Direct server return sends the large replies around the balancer.' },
            deep: '<p>A <b>connection-tracking</b> table pins established flows to their backend, so even the few remapped slots do not break live TCP or QUIC connections. New flows use the new table; existing ones keep their pinned host. Flows pinned to the dead host are lost and the client reconnects.</p>' +
              '<p><b>Direct server return</b>: responses (video segments!) are much larger than requests, so the gateway replies straight to the client and only the small request direction crosses the balancer.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          stopLoops(ctx);
          rail(ctx, 1);
          var B = newBench(ctx);
          var M = 13, params = [[3, 4], [0, 2], [7, 5], [10, 3], [5, 8]];
          var t1 = maglev([0, 1, 2, 3, 4], params, M);
          var tx = 530, cw = 54;
          var router, lbs, ecmp, be, cells = [], ctext = [], owner = t1[7];
          var sel, toBe, tup, hsh;
          /* beat 0: routers, balancers, gateway hosts */
          function b0() {
            heading(ctx, B, 60, 176, 'L4 LOAD BALANCING · ECMP across balancers, Maglev hashing to gateway hosts');
            router = ctx.node({ x: 120, y: 420, w: 150, h: 60, title: 'Edge router', sub: 'ECMP ×4', icon: 'net', color: 'blue', titleSize: 14, parent: B });
            lbs = [0, 1, 2, 3].map(function (i) { return ctx.node({ x: 340, y: 285 + i * 90, w: 170, h: 52, title: 'l4lb-' + 'abcd'[i], sub: 'same table', icon: 'layers', color: 'blue', titleSize: 13, subSize: 11, parent: B }); });
            ecmp = lbs.map(function (n) { return ctx.link(router, n, { color: ctx.alpha('blue', 0.7), parent: B }); });
            be = GW.map(function (c, i) { return ctx.node({ x: 1450, y: 250 + i * 92, w: 200, h: 56, title: 'gw-' + i, sub: 'L7 gateway pod', icon: 'server', color: c, titleSize: 14, parent: B }); });
            ctx.hud('lookup = entry[hash mod M] · O(1)');
            return Promise.all([
              ctx.reveal([router].concat(lbs), { from: 'left', stagger: 90 }),
              ctx.reveal(ecmp, { from: 'draw', stagger: 80, delay: 300 }),
              ctx.reveal(be, { from: 'right', stagger: 80, delay: 200 })
            ]).then(function () { return ctx.packet(ecmp[1], { color: 'cyan', dur: 500 }); });
          }
          /* beat 1: the table is filled in population order */
          function b1() {
            var g = ctx.group({ parent: B });
            ctx.text(tx, 262, 'Maglev lookup table  (M = 13 here · 65,537 in production)', { size: 13, font: 'mono', color: 'text', parent: g });
            for (var j = 0; j < M; j++) {
              ctx.text(tx + j * cw + 24, 286, String(j), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
              cells.push(ctx.rect(tx + j * cw, 298, 48, 44, { rx: 5, fill: 'rgba(255,255,255,0.03)', stroke: 'faint', sw: 1, parent: g }));
              ctext.push(ctx.text(tx + j * cw + 24, 320, '', { size: 12, font: 'mono', color: 'white', anchor: 'middle', weight: 600, parent: g }));
            }
            lbs.forEach(function (n) { ctx.line(n.box.r, n.box.cy, tx - 6, 320, { color: ctx.alpha('blue', 0.25), sw: 1, dash: '3 4', parent: g }); });
            var permT = params.map(function (p, i) {
              var row = []; for (var k = 0; k < 7; k++) row.push((p[0] + k * p[1]) % M);
              return ctx.text(tx, 382 + i * 26, 'gw-' + i + '  offset ' + p[0] + ', skip ' + p[1] + '  → perm: ' + row.join(' ') + ' …', { size: 12, font: 'mono', color: GW[i], parent: g });
            });
            var cnt = [0, 0, 0, 0, 0]; t1.forEach(function (v) { cnt[v]++; });
            var bal = ctx.text(tx, 516, 'slots per backend: ' + cnt.join(' / ') + '  (⌊13/5⌋ = 2 or ⌈13/5⌉ = 3)', { size: 12, font: 'mono', color: 'dim', parent: B, opacity: 0 });
            ctx.reveal(g, { from: 'fade' });
            ctx.reveal(permT, { from: 'left', stagger: 90, delay: 300 });
            var order = [], next = [0, 0, 0, 0, 0], taken = {}, n = 0;
            var perm = params.map(function (p) { var rr = []; for (var k = 0; k < M; k++) rr.push((p[0] + k * p[1]) % M); return rr; });
            while (n < M) { for (var b = 0; b < 5 && n < M; b++) { var c = perm[b][next[b]]; while (taken[c]) { next[b]++; c = perm[b][next[b]]; } taken[c] = 1; next[b]++; n++; order.push([c, b]); } }
            return ctx.wait(700).then(function () {
              return order.reduce(function (p, o) {
                return p.then(function () {
                  cells[o[0]].setAttribute('fill', ctx.alpha(GW[o[1]], 0.55));
                  cells[o[0]].setAttribute('stroke', ctx.color(GW[o[1]]));
                  ctext[o[0]].textContent = String(o[1]);
                  return ctx.wait(130);
                });
              }, Promise.resolve());
            }).then(function () { return ctx.reveal(bal, { dur: 300 }); });
          }
          /* beat 2: a packet is hashed and routed */
          function b2() {
            tup = ctx.label(tx, 552, '(198.51.100.23:51514 → 203.0.113.7:443, TCP)', { color: 'cyan', size: 12, anchor: 'start', parent: B, opacity: 0 });
            hsh = ctx.text(tx, 586, 'hash(5-tuple) mod 13 = 7  →  entry[7]', { size: 13, font: 'mono', color: 'white', parent: B, opacity: 0 });
            sel = ctx.rect(tx + 7 * cw - 4, 294, 56, 52, { rx: 7, stroke: 'white', sw: 2, parent: B, opacity: 0, glow: true });
            toBe = ctx.link({ x: tx + 7 * cw + 24, y: 342 }, be[owner], { color: GW[owner], to: 'l', parent: B, sw: 2.2 });
            toBe.setAttribute('opacity', 0);
            ctx.reveal(tup, { from: 'left', dur: 300 });
            return ctx.packet(ecmp[2], { color: 'cyan', dur: 500 }).then(function () {
              ctx.reveal(hsh, { from: 'left', dur: 300 });
              ctx.reveal(sel, { dur: 300 });
              return ctx.reveal(toBe, { from: 'draw', dur: 500 });
            }).then(function () { return ctx.packet(toBe, { color: GW[owner], dur: 600 }); });
          }
          /* beat 3: kill a gateway, rebuild the table (interactive) */
          function b3() {
            var fsec = ctx.group({ parent: B, opacity: 0 });
            var fh = ctx.text(tx, 640, '', { size: 13, font: 'mono', color: 'violet', parent: fsec });
            var cells2 = [], texts2 = [];
            for (var q = 0; q < M; q++) {
              cells2.push(ctx.rect(tx + q * cw, 658, 48, 40, { rx: 5, fill: 'rgba(255,255,255,0.03)', stroke: 'faint', sw: 1, parent: fsec }));
              texts2.push(ctx.text(tx + q * cw + 24, 678, '', { size: 12, font: 'mono', color: 'white', anchor: 'middle', weight: 600, parent: fsec }));
            }
            var sum = ctx.text(tx, 724, '', { size: 13, font: 'mono', color: 'text', parent: fsec });
            var dead = { 3: true };
            function render() {
              var alive = [], names = [];
              for (var i = 0; i < 5; i++) { if (dead[i]) names.push('gw-' + i); else alive.push(i); }
              var t2 = maglev(alive, params, M);
              var changed = 0, owned = 0;
              for (var s = 0; s < M; s++) {
                var ch = t2[s] !== t1[s];
                if (ch) changed++;
                if (dead[t1[s]]) owned++;
                cells2[s].setAttribute('fill', ctx.alpha(GW[t2[s]], 0.55));
                cells2[s].setAttribute('stroke', ch ? ctx.color('white') : ctx.color('faint'));
                cells2[s].setAttribute('stroke-width', ch ? 2 : 1);
                texts2[s].textContent = String(t2[s]);
              }
              fh.textContent = names.join(', ') + (names.length > 1 ? ' fail' : ' fails') + ' → rebuild with ' + alive.length + ' backends:';
              sum.textContent = changed + ' of 13 slots changed · dead owned ' + owned + ' · ' + (changed - owned) + ' other slot(s) moved';
              be.forEach(function (n, i) {
                n.setAttribute('opacity', dead[i] ? 0.3 : 1);
                n.titleEl.textContent = 'gw-' + i + (dead[i] ? ' ✕' : '');
              });
              toBe.setAttribute('opacity', dead[owner] ? 0.2 : 1);
            }
            render();
            be.forEach(function (n, i) {
              n.style.cursor = 'pointer';
              n.addEventListener('click', function () {
                var count = 0; for (var k = 0; k < 5; k++) if (dead[k]) count++;
                if (dead[i]) delete dead[i]; else if (count < 3) dead[i] = true;
                render();
              });
            });
            return ctx.reveal(fsec, { from: 'up', dur: 500 }).then(function () { return ctx.pulse(be[3], { color: 'red', times: 2, dur: 600 }); });
          }
          /* beat 4: conntrack and direct server return */
          function b4() {
            var g = ctx.group({ parent: B });
            heading(ctx, g, 60, 626, 'CONNTRACK · per balancer', 'cyan', { size: 13 });
            var ct = code(ctx, g, { x: 60, y: 642, w: 430, title: 'flow → backend (pinned)', lang: 'text', size: 12, color: 'cyan', lines: [
              'flow                         backend',
              '198.51.100.23:51514 → :443   gw-2 pinned',
              '203.0.113.99:40122  → :443   gw-0 pinned',
              '192.0.2.45:33001    → :443   gw-3 ✕ reset'
            ] });
            var dsr = ctx.label(275, 790, 'reply: gw-2 → client (DSR, skips l4lb)', { color: 'lime', size: 12, parent: g });
            return ctx.reveal(g, { from: 'up' }).then(function () { return ctx.pulse(dsr, { color: 'lime', times: 2, dur: 600 }); });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'L7 filter chain',
        beats: [
          {
            say: 'The chosen gateway host runs a layer-seven proxy, like Envoy, as a chain of filters. Each filter can continue, change, or answer the request itself.',
            card: { tag: 'KEY IDEA', title: 'A pipeline of filters', body: 'Seven filters see each decoded request in order. Every one can pass it on, enrich it, or short-circuit with a precise error.' },
            deep: '<p>An L7 proxy is a pipeline of <b>filters</b> over a decoded request; each may continue, mutate, or short-circuit with a response. Envoy models this as an HTTP filter chain per listener, with per-route overrides.</p>' +
              '<p>The order is a security decision: cheap checks that need no identity run first, everything that touches data or policy runs after authentication. End to end the chain costs roughly 50–150 µs of CPU per request.</p>'
          },
          {
            say: 'TLS one point three terminates here, with a hybrid post-quantum key exchange, and the HTTP codec decodes the streams. Now the request has a hostname, a method and a path.',
            card: {
              tag: 'STATE OF THE ART', title: 'Post-quantum by default', body: 'The hybrid X25519MLKEM768 key share is now the default in major browsers and CDNs, protecting today\'s traffic from harvest-now-decrypt-later.',
              more: '<p>ML-KEM-768 has a 1,184-byte encapsulation key and a 1,088-byte ciphertext. With X25519 added, the hybrid key share is 1,216 bytes from the client and 1,120 bytes from the server. The ClientHello therefore spans two packets, which once tripped middleboxes that assumed a single-packet hello.</p>'
            },
            deep: '<ul><li><b>TLS 1.3</b> termination: 1-RTT handshake, key share <code>X25519MLKEM768</code> (hybrid classical plus ML-KEM, on by default in major browsers and CDNs since 2024–25), session tickets for resumption, certificates issued via ACME with short lifetimes.</li>' +
              '<li><b>HTTP codec</b>: h2 and h3 streams are decoded and normalized into one header map, so later filters never care which protocol carried the request.</li></ul>' +
              '<p>The hybrid keeps the session safe unless <i>both</i> X25519 and ML-KEM (FIPS 203) are broken, at the cost of about 1 KB extra in each handshake flight.</p>'
          },
          {
            say: 'The JWT filter verifies the token\'s signature against cached public keys. Then an authorization filter checks scopes and the tenant, which always comes from the verified token.',
            card: { tag: 'PITFALL', title: 'Never take identity from the body', body: 'The tenant id comes from the verified token, not the JSON. A caller who chooses their own tenant can read someone else\'s jobs.' },
            deep: '<ul><li><b>JWT authn</b>: <code>kid</code> → cached JWKS key; ES256 verify takes tens of µs; check <code>iss, aud, exp, nbf</code>. An unknown <code>kid</code> triggers one rate-limited JWKS refresh, so key rotation needs no outage.</li>' +
              '<li><b>ext_authz</b>: a policy engine (OPA or Cedar) decides <code>allow(sub, tenant, action, resource)</code>. The tenant comes from the verified token, never from the request body.</li></ul>' +
              '<p>Both filters annotate the request (<code>x-jwt-sub</code>, <code>x-tenant-id</code>) with values the upstream may trust, because the proxy strips any client-supplied copies first.</p>'
          },
          {
            say: 'The request body is validated against its schema and a one megabyte limit, and the tenant\'s rate limit is checked. Only then does the router pick an upstream cluster.',
            card: { tag: 'NUMBERS', title: 'Bodies stay small', stat: { v: '1 MB', u: 'max body', l: 'media goes to object storage, never through this proxy: anything larger is rejected outright' } },
            deep: '<ul><li><b>Validation</b>: maximum body 1 MB (media goes to object storage, not here), JSON-Schema or protobuf validation, unknown fields rejected → <code>400</code>, <code>413</code>, <code>415</code>.</li>' +
              '<li><b>Rate limit</b>: a local token bucket per tenant, backed by a global limiter (next steps).</li>' +
              '<li><b>Router</b>: route by path, method and headers; per-route timeout, retry policy and upstream cluster (gRPC over HTTP/2 with mTLS).</li></ul>' +
              '<p>The proxy injects <code>x-request-id</code> and a W3C <code>traceparent</code> so every downstream span joins one trace.</p>'
          },
          {
            say: 'Each filter can short-circuit with a precise error, and each one enriches the request for the next. The error code tells the client exactly which door refused it. Click any filter to make it refuse the request.',
            card: { tag: 'TRY IT', title: 'Click a filter to make it refuse', body: 'The request stops there and the answer names the door: 401 identity, 403 permission, 413 or 400 shape, 429 your rate, 503 our overload.' },
            deep: '<table><tr><th>Filter</th><th>Rejects</th><th>Answer</th></tr>' +
              '<tr><td>TLS</td><td>no SNI, TLS &lt; 1.2, bad cert</td><td>handshake alert</td></tr>' +
              '<tr><td>HTTP codec</td><td>malformed frame, oversized headers</td><td><code>400</code>, <code>431</code></td></tr>' +
              '<tr><td>JWT</td><td>expired, bad signature, wrong aud</td><td><code>401</code> + <code>WWW-Authenticate</code></td></tr>' +
              '<tr><td>authz</td><td>scope missing</td><td><code>403</code></td></tr>' +
              '<tr><td>validate</td><td>12 MB body, unknown field</td><td><code>413</code>, <code>400</code></td></tr>' +
              '<tr><td>rate limit</td><td>tenant over 10 rps</td><td><code>429</code> + <code>Retry-After</code></td></tr>' +
              '<tr><td>router</td><td>no route, no healthy upstream</td><td><code>404</code>, <code>503</code></td></tr></table>' +
              '<p>Every rejection is logged with the request id, so a support engineer can find exactly which filter said no. The split matters to clients: <code>4xx</code> means fix or back off, <code>503</code> means retry elsewhere.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          stopLoops(ctx);
          rail(ctx, 2);
          var B = newBench(ctx);
          var F = [
            ['TLS 1.3', 'X25519MLKEM768', 'lock', 'pink'],
            ['HTTP codec', 'h2 · h3 streams', 'code', 'blue'],
            ['JWT authn', 'ES256 · JWKS cache', 'shield', 'pink'],
            ['ext_authz', 'scope · tenant', 'check', 'pink'],
            ['Validate', 'schema · 1 MB max', 'doc', 'blue'],
            ['Rate limit', 'local + global', 'clock', 'cyan'],
            ['Router', '→ jobs-api (gRPC)', 'net', 'blue']
          ];
          var adds = [
            [0, ':authority api.genesis.example  (SNI ok, TLS 1.3, ALPN h2)'],
            [1, ':method POST  :path /v1/jobs  content-type application/json'],
            [1, 'x-request-id 3f9a2c…   traceparent 00-4bf92f…-01'],
            [2, 'x-jwt-sub usr_8f1c   x-jwt-scope "jobs:write media:put"'],
            [3, 'x-tenant-id studio-42   x-plan pro   authz: allow'],
            [4, 'body 2.1 KB · schema CreateJob v3 ✓ · refs: 4 blob digests'],
            [5, 'x-ratelimit tenant 7/10 rps · burst ok'],
            [6, 'route jobs.Create → cluster jobs-api-eu (gRPC, mTLS)']
          ];
          var fl, links = [], req;
          function play(from, to) {
            var chain = Promise.resolve();
            adds.slice(from, to).forEach(function (a, i) {
              var k = from + i;
              chain = chain.then(function () {
                ctx.pulse(fl[a[0]], { color: fl[a[0]].color, dur: 420 });
                var hop = a[0] > 0 && (k === 0 || adds[k - 1][0] !== a[0]) ? ctx.packet(links[a[0] - 1], { color: 'lime', dur: 260, r: 4 }) : Promise.resolve();
                return hop.then(function () { return req.addLine(a[1]); });
              });
            });
            return chain;
          }
          function note(y, str) {
            var t = ctx.text(60, y, str, { size: 13, font: 'mono', color: 'dim', parent: B, opacity: 0 });
            return ctx.reveal(t, { from: 'up' });
          }
          /* beat 0: the chain of seven filters */
          function b0() {
            heading(ctx, B, 60, 176, 'L7 GATEWAY (Envoy-style) · a chain of filters over each request');
            fl = F.map(function (f, i) { return ctx.node({ x: 130 + i * 208, y: 280, w: 184, h: 78, title: f[0], sub: f[1], icon: f[2], color: f[3], titleSize: 15, subSize: 11, parent: B }); });
            for (var i = 0; i < 6; i++) links.push(ctx.link(fl[i], fl[i + 1], { color: 'blue', straight: true, parent: B }));
            req = code(ctx, B, { x: 60, y: 400, w: 700, title: 'request as the upstream will see it', lang: 'text', size: 12, color: 'cyan', typing: true, maxLines: 8, lines: [] });
            ctx.hud('7 filters · ~50–150 µs CPU per request');
            return Promise.all([ctx.reveal(fl, { from: 'left', stagger: 100 }), ctx.reveal(links, { from: 'draw', stagger: 80, delay: 300 }), ctx.reveal(req, { from: 'up', delay: 500 })]).then(function () {
              return links.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'lime', dur: 240, r: 4 }); }); }, Promise.resolve());
            });
          }
          /* beat 1: TLS and the HTTP codec */
          function b1() { return play(0, 3); }
          /* beat 2: identity and authorization */
          function b2() {
            note(730, 'JWKS cache: kid → public key; unknown kid ⇒ one rate-limited refresh (key rotation, no outage)');
            note(754, 'tenant is taken from the verified token, never from the JSON body');
            return play(3, 5);
          }
          /* beat 3: validation, rate limit, routing */
          function b3() {
            note(778, 'media never transits this proxy: bodies > 1 MB are rejected, uploads go to object storage');
            return play(5, 8);
          }
          /* beat 4: short-circuits. Every filter is clickable: the request stops there and the matching row answers. */
          function b4() {
            var rej = ctx.group({ parent: B });
            heading(ctx, rej, 800, 412, 'SHORT-CIRCUITS · click a filter to make it refuse', 'red', { size: 13 });
            var R = [
              ['TLS', 'no SNI · TLS < 1.2 · bad cert', 'handshake alert', 'TLS 1.0 hello'],
              ['HTTP codec', 'malformed frame · headers too big', '400 · 431', 'bad frame'],
              ['JWT', 'expired · bad signature · wrong aud', '401 + WWW-Authenticate', 'expired JWT'],
              ['authz', 'scope jobs:write missing', '403', 'no scope'],
              ['validate', 'body 12 MB · unknown field', '413 · 400', '12 MB body'],
              ['rate limit', 'tenant over 10 rps', '429 + Retry-After', 'over 10 rps'],
              ['router', 'no route · no healthy upstream', '404 · 503', 'no route']
            ];
            var rows = R.map(function (r, k) {
              var y = 448 + k * 40;
              var rc = ctx.rect(800, y - 15, 760, 30, { rx: 6, fill: 'rgba(255,77,109,0.05)', stroke: ctx.alpha('red', 0.3), sw: 1, parent: rej });
              ctx.text(814, y, r[0], { size: 12, font: 'mono', color: 'pink', weight: 600, parent: rej });
              ctx.text(930, y, r[1], { size: 12, font: 'mono', color: 'text', parent: rej });
              ctx.text(1546, y, r[2], { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: rej });
              return rc;
            });
            var verdict = ctx.label(60, 372, '', { color: 'red', size: 12, anchor: 'start', parent: B, opacity: 0 });
            var busy = false;
            function unmark() {
              fl.forEach(function (n) { n.setAttribute('opacity', 1); });
              rows.forEach(function (rc) { rc.setAttribute('fill', 'rgba(255,77,109,0.05)'); rc.setAttribute('stroke', ctx.alpha('red', 0.3)); });
            }
            function mark(i) {
              fl.forEach(function (n, k) { n.setAttribute('opacity', k > i ? 0.3 : 1); });
              rows.forEach(function (rc, k) {
                rc.setAttribute('fill', k === i ? 'rgba(255,77,109,0.24)' : 'rgba(255,77,109,0.05)');
                rc.setAttribute('stroke', k === i ? ctx.color('red') : ctx.alpha('red', 0.3));
              });
              verdict.setText('✕ refused at ' + R[i][0] + ' → ' + R[i][2]);
              verdict.setAttribute('opacity', 1);
            }
            /* a doomed request walks the chain up to filter i, is refused there, and the answer drops to its row.
             * The drop path runs in the corridor right of the request panel (x = 784) so it never crosses text. */
            function refuse(i) {
              if (busy) return Promise.resolve();
              busy = true;
              unmark();
              verdict.setAttribute('opacity', 0);
              var chain = Promise.resolve();
              for (var h = 0; h < i; h++) (function (hh) {
                chain = chain.then(function () { return ctx.packet(links[hh], { color: 'amber', dur: 260, r: 4, label: hh === 0 ? R[i][3] : undefined }); });
              })(h);
              return chain.then(function () {
                var nb = fl[i].box, yr = 448 + i * 40;
                var drop = ctx.path('M' + nb.cx + ',' + nb.b + ' V352 H784 V' + yr + ' H797', { color: ctx.alpha('red', 0.7), sw: 1.5, dash: '4 3', arrow: true, parent: B });
                ctx.pulse(fl[i], { color: 'red', dur: 420 });
                return ctx.packet(drop, { color: 'red', dur: 700, label: R[i][2].split(' ')[0] }).then(function () { return ctx.remove(drop, 200); });
              }).then(function () { mark(i); busy = false; });
            }
            fl.forEach(function (n, i) {
              n.style.cursor = 'pointer';
              n.addEventListener('click', function () { refuse(i); });
            });
            return ctx.reveal(rej, { from: 'right' }).then(function () { return refuse(2); });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Token bucket in action',
        beats: [
          {
            say: 'Here is rate limiting in motion. Each tenant owns a token bucket. It refills at a steady ten tokens per second and holds at most twenty, so it can absorb short bursts but never exceed its long-run rate.',
            card: { tag: 'NUMBERS', title: 'A rate and a depth', stat: { v: '10 / 20', u: 'r and b', l: 'refill rate r bounds long-run throughput, bucket depth b bounds the burst' } },
            deep: '<p><b>Token bucket</b> (rate r, burst b): tokens refill continuously and a request of cost c passes if enough tokens exist.</p>' +
              '<div class="eq">tokens ← min(b, tokens + r·Δt); &nbsp; allow ⇔ tokens ≥ c, then tokens −= c</div>' +
              '<p>Over any window of length T, admitted cost is at most b + r·T. That single inequality is the whole contract: two numbers per tenant, and a hard bound on both burst and average.</p>'
          },
          {
            say: 'Every request must take one token to pass. At six requests per second, normal traffic sails through and the bucket stays nearly full.',
            card: { tag: 'HOW IT WORKS', title: 'One token per request', body: 'A request that finds a token passes and removes it. Six requests per second against a refill of ten never runs the bucket dry.' },
            deep: '<p>With offered load λ = 6 req/s below the refill rate r = 10 req/s, the bucket refills faster than it drains: net +4 tokens/s until full at b = 20. The gate is invisible, a few nanoseconds of arithmetic per request.</p>' +
              '<p>State is two numbers per tenant: the token count and the time of the last refill. Refill is computed lazily on the next request, not by a timer.</p>'
          },
          {
            say: 'When a burst of forty requests per second arrives, the bucket absorbs the first twenty, then drains, and the excess is shed immediately with a four twenty nine status and a Retry-After header, instead of queueing up and timing out deeper in the system.',
            card: {
              tag: 'NUMBERS', title: 'Bounded by b plus r times T', stat: { v: '36 of 64', u: 'admitted', l: 'a 1.6 s burst at 40 req/s: the bucket passes 20 + 16, the other 28 get a 429' },
              more: '<p>Why b + r·T is a hard bound: the bucket never holds more than b tokens, and over a window of length T it gains at most r·T new ones. Admitted cost cannot exceed the tokens available, so it is at most b + r·T. The bound is tight: a burst that starts at a full bucket achieves it.</p>'
            },
            deep: '<p>Here r = 10/s, b = 20. Starting from a full bucket, a 1.6 s burst at 40/s (64 requests) admits ≈ 20 + 16 = 36 and sheds ≈ 28.</p>' +
              '<p>Between bursts the 6/s background refills the bucket at only 10 − 6 = 4 tokens/s, so a burst arriving 3 s later finds about 12 tokens and sheds more. Shedding at the gate costs about 50 µs; queueing the same request would hold a connection and a buffer until some downstream timeout fires.</p>'
          },
          {
            say: 'Now try it yourself. Click the bucket to fire a burst of forty requests per second, and watch the tokens drain, the shed counter climb, and the bucket slowly refill.',
            card: { tag: 'TRY IT', title: 'Click the bucket to fire a burst', body: 'Forty requests per second for 1.6 seconds. Fire two bursts back to back and the second one finds a half-empty bucket.' },
            deep: '<p>The <code>Retry-After</code> value is the time until the bucket holds enough tokens: ⌈(c − tokens) / r⌉ seconds. A well-behaved client waits that long, plus jitter, instead of hammering the gateway.</p>' +
              '<p>Cost-weighted tokens let one limiter cover cheap GETs (c = 1) and expensive job creation (c proportional to the estimated GPU-seconds), so a single mechanism protects both.</p>'
          },
          {
            say: 'Other algorithms trade things differently. A leaky bucket smooths its output but adds delay, and GCRA behaves like a token bucket while keeping only one timestamp per key. A sliding window counter is approximate but cheap.',
            card: { tag: 'TRADE-OFF', title: 'State, smoothness, precision', body: 'Token bucket allows bursts. Leaky bucket is smooth but delays. GCRA keeps one timestamp. Sliding window keeps two counters and approximates.' },
            deep: '<table><tr><th>Algorithm</th><th>State/key</th><th>Behavior</th></tr>' +
              '<tr><td>Token bucket</td><td>tokens, t<sub>last</sub></td><td>bursts ≤ b, mean ≤ r</td></tr>' +
              '<tr><td>Leaky bucket (queue)</td><td>FIFO</td><td>smooth output at r; adds delay</td></tr>' +
              '<tr><td>GCRA</td><td>one timestamp (TAT)</td><td>≡ token bucket, O(1) atomic</td></tr>' +
              '<tr><td>Sliding-window counter</td><td>2 counters</td><td>approximate, cheap</td></tr></table>' +
              '<div class="eq">GCRA: T = 1/r, τ = (b−1)·T; &nbsp; allow ⇔ TAT − now ≤ τ; &nbsp; TAT ← max(TAT, now) + T</div>' +
              '<div class="eq">sliding window: est = c<sub>prev</sub>·(1 − f) + c<sub>cur</sub>, &nbsp; f = elapsed fraction of current window</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          stopLoops(ctx);
          rail(ctx, 3);
          var B = newBench(ctx);
          var sim = { tok: 20, acc: 0, t: 0, adm: 0, rej: 0, hist: [], last: null, dropT: 0, force: -1, auto: false };
          var toks = [], drop, bk, up, cA, cR, cT, cL, spark, clientsS, pool = [];
          /* beat 0: the bucket */
          function b0() {
            heading(ctx, B, 60, 176, 'TOKEN BUCKET · r = 10 tokens/s · b = 20 · cost = 1 per request');
            bk = ctx.group({ parent: B });
            ctx.rect(540, 190, 200, 400, { rx: 10, fill: 'rgba(0,0,0,0.001)', parent: bk });
            ctx.path('M560,200 L560,322 Q560,336 574,336 L706,336 Q720,336 720,322 L720,200', { color: 'cyan', sw: 2.4, parent: bk, glow: true });
            ctx.text(740, 214, 'bucket', { size: 13, font: 'display', weight: 700, color: 'cyan', parent: bk });
            ctx.text(740, 234, 'b = 20', { size: 12, font: 'mono', color: 'dim', parent: bk });
            ctx.text(640, 176, 'refill r = 10/s', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: bk });
            for (var k = 0; k < 20; k++) toks.push(ctx.circle(582 + (k % 5) * 29, 322 - Math.floor(k / 5) * 28, 10, { fill: 'amber', stroke: ctx.alpha('amber', 0.8), sw: 1, parent: bk }));
            drop = ctx.circle(640, 188, 5, { fill: 'amber', parent: bk, opacity: 0 });
            ctx.line(640, 338, 640, 372, { color: ctx.alpha('cyan', 0.6), sw: 2, dash: '3 3', parent: bk });
            ctx.rect(628, 376, 24, 180, { rx: 6, fill: ctx.alpha('cyan', 0.1), stroke: 'cyan', sw: 1.6, parent: bk });
            ctx.text(662, 356, 'gate: take 1 token', { size: 12, font: 'mono', color: 'cyan', anchor: 'start', parent: bk });
            ctx.hud('r = 10/s · b = 20 · burst 40/s');
            ctx.reveal(bk, { from: 'fade', dur: 400 });
            return ctx.reveal(toks, { from: 'scale', stagger: 40, delay: 300 });
          }
          /* beat 1: steady traffic passes */
          function b1() {
            var g = ctx.group({ parent: B });
            ctx.text(60, 300, 'clients', { size: 13, font: 'display', weight: 700, color: 'white', parent: g });
            clientsS = ctx.text(60, 320, 'steady: 6 req/s', { size: 12, font: 'mono', color: 'dim', parent: g });
            up = ctx.node({ x: 1060, y: 466, w: 190, h: 60, title: 'L7 router', sub: 'admitted →', icon: 'net', color: 'lime', titleSize: 14, parent: g });
            cA = ctx.text(880, 250, 'admitted  0', { size: 16, font: 'mono', color: 'lime', weight: 600, parent: g });
            cR = ctx.text(880, 280, 'shed      0', { size: 16, font: 'mono', color: 'red', weight: 600, parent: g });
            cT = ctx.text(880, 310, 'tokens 20.0', { size: 16, font: 'mono', color: 'amber', weight: 600, parent: g });
            cL = ctx.text(880, 340, 'offered 6 req/s', { size: 14, font: 'mono', color: 'dim', parent: g });
            ctx.rect(880, 600, 260, 90, { rx: 6, fill: 'rgba(255,255,255,0.02)', stroke: 'faint', sw: 1, parent: g });
            ctx.text(880, 590, 'tokens over last 8 s', { size: 11, font: 'mono', color: 'dim', parent: g });
            spark = ctx.path('M880,690', { color: 'amber', sw: 1.6, parent: g });
            for (var p = 0; p < 48; p++) pool.push({ on: false, el: ctx.circle(0, 0, 5, { fill: 'cyan', parent: B, opacity: 0 }) });
            ctx.reveal(g, { from: 'fade', dur: 500 });
            var rng = ctx.rng(77);
            S.flood = ctx.loop(function (t) {
              if (sim.last === null) sim.last = t;
              var dt = Math.min(0.08, (t - sim.last) * Math.min(ctx.speed, 3));
              sim.last = t;
              sim.t += dt;
              var burst = sim.t < sim.force || (sim.auto && (sim.t % 4.6) > 2.4 && (sim.t % 4.6) < 4.0);
              var lam = burst ? 40 : 6;
              sim.tok = Math.min(20, sim.tok + 10 * dt);
              sim.acc += lam * dt;
              while (sim.acc >= 1) {
                sim.acc -= 1;
                for (var i = 0; i < pool.length; i++) if (!pool[i].on) {
                  var d = pool[i];
                  d.on = true; d.st = 'go'; d.x = 70 + rng() * 60; d.y = 380 + rng() * 170; d.vy = 0;
                  d.el.setAttribute('fill', C.cyan); d.el.setAttribute('opacity', 1);
                  break;
                }
              }
              pool.forEach(function (d) {
                if (!d.on) return;
                if (d.st === 'go') {
                  d.x += 430 * dt;
                  if (d.x >= 622) {
                    if (sim.tok >= 1) { sim.tok -= 1; d.st = 'ok'; sim.adm++; d.el.setAttribute('fill', C.lime); }
                    else { d.st = 'rej'; sim.rej++; d.el.setAttribute('fill', C.red); d.x = 618; }
                  }
                } else if (d.st === 'ok') {
                  d.x += 430 * dt; d.y += (466 - d.y) * Math.min(1, dt * 5);
                  if (d.x > 960) { d.on = false; d.el.setAttribute('opacity', 0); }
                } else {
                  d.vy += 1100 * dt; d.y += d.vy * dt; d.x += 20 * dt;
                  if (d.y > 734) { d.on = false; d.el.setAttribute('opacity', 0); }      /* lands in the 429 bin (top edge y = 740) without covering its text */
                }
                if (d.on) { d.el.setAttribute('cx', d.x.toFixed(1)); d.el.setAttribute('cy', d.y.toFixed(1)); }
              });
              var n = Math.floor(sim.tok + 1e-6);
              toks.forEach(function (tk, i) { tk.setAttribute('opacity', i < n ? 1 : 0.12); });
              sim.dropT += dt * 10;
              var fph = sim.dropT % 1;
              drop.setAttribute('cy', 188 + fph * (322 - Math.floor(n / 5) * 28 - 188));
              drop.setAttribute('opacity', n < 20 ? 1 - fph * 0.5 : 0);
              cA.textContent = 'admitted  ' + sim.adm;
              cR.textContent = 'shed      ' + sim.rej;
              cT.textContent = 'tokens ' + sim.tok.toFixed(1);
              cL.textContent = 'offered ' + lam + ' req/s' + (burst ? '  ◀ BURST' : '');
              cL.setAttribute('fill', burst ? C.red : C.dim);
              sim.hist.push([sim.t, sim.tok]);
              while (sim.hist.length && sim.hist[0][0] < sim.t - 8) sim.hist.shift();
              if (sim.hist.length > 1) {
                var dd = '';
                for (var h = 0; h < sim.hist.length; h += 2) {
                  var hx = 880 + (sim.hist[h][0] - (sim.t - 8)) / 8 * 260, hy = 690 - sim.hist[h][1] / 20 * 86;
                  dd += (dd ? ' L' : 'M') + hx.toFixed(1) + ',' + hy.toFixed(1);
                }
                spark.setAttribute('d', dd);
              }
            });
            return ctx.wait(2600);
          }
          /* beat 2: a burst is shed with 429 */
          function b2() {
            var bin = ctx.group({ parent: B });
            ctx.rect(470, 740, 360, 60, { rx: 10, fill: 'rgba(255,77,109,0.08)', stroke: ctx.alpha('red', 0.7), sw: 1.4, parent: bin });
            ctx.text(650, 762, '429 Too Many Requests', { size: 14, font: 'mono', color: 'red', anchor: 'middle', weight: 600, parent: bin });
            ctx.text(650, 783, 'Retry-After: 1 · shed in ~50 µs', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: bin });
            clientsS.textContent = 'bursty: 6 → 40 req/s';
            clientsS.setAttribute('fill', C.amber);
            sim.auto = true;
            sim.force = sim.t + 1.6;
            return ctx.reveal(bin, { from: 'up', dur: 500 }).then(function () { return ctx.wait(3800); });
          }
          /* beat 3: click the bucket to fire a burst */
          function b3() {
            var hint = ctx.label(330, 640, '▶ click the bucket to fire a burst', { color: 'amber', size: 12, parent: B, opacity: 0 });
            bk.style.cursor = 'pointer';
            bk.addEventListener('click', function () { sim.force = sim.t + 1.6; });
            return ctx.reveal(hint, { from: 'up' }).then(function () { return ctx.pulse(bk, { color: 'amber', times: 2, dur: 700 }); });
          }
          /* beat 4: the family of algorithms */
          function b4() {
            var cards = [
              ['TOKEN BUCKET', 'tokens += r·Δt (≤ b); pass if ≥ cost', 'bursts up to b · long-run rate r', 'cyan'],
              ['LEAKY BUCKET (queue)', 'FIFO drained at constant r', 'smooth output · adds queueing delay', 'blue'],
              ['GCRA', 'TAT = max(TAT, now) + T', 'pass if TAT − now ≤ τ · 1 timestamp/key', 'violet'],
              ['SLIDING WINDOW', 'est = prev·(1 − f) + cur', 'two counters · approximate · cheap', 'teal']
            ];
            var cg = cards.map(function (c, i) {
              var g = ctx.group({ parent: B });
              var y = 200 + i * 150;
              ctx.rect(1190, y, 370, 132, { rx: 10, fill: 'rgba(8,16,32,0.85)', stroke: ctx.alpha(c[3], i === 0 ? 0.9 : 0.45), sw: i === 0 ? 1.8 : 1.2, parent: g });
              ctx.text(1208, y + 26, c[0], { size: 14, font: 'display', weight: 700, color: c[3], parent: g });
              ctx.text(1208, y + 62, c[1], { size: 12, font: 'mono', color: 'white', parent: g });
              ctx.text(1208, y + 92, c[2], { size: 12, font: 'mono', color: 'dim', parent: g });
              return g;
            });
            return ctx.reveal(cg, { from: 'right', stagger: 200 });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Limits & GPU quotas',
        beats: [
          {
            say: 'One bucket on one host is easy. Our gateway runs on dozens of hosts in many sites, so limits become distributed, and a purely local limiter would let through as many times the limit as there are hosts.',
            card: { tag: 'TRADE-OFF', title: 'Local speed versus global truth', body: 'N hosts each enforcing r admit up to N times r. One global counter is exact, but costs a round trip per request and makes Redis a hot spot.' },
            deep: '<p><b>Local vs global</b>: a purely local limiter on N hosts admits up to N·r, because each host sees only 1/N of the traffic, and unevenly. A purely global one costs a round trip per request (about 0.3–1 ms) and makes the counter store a hot spot and a single point of failure for every request.</p>' +
              '<p>Neither extreme fits a request path budgeted in tens of microseconds, so the design sits in between.</p>'
          },
          {
            say: 'The hybrid keeps a fast local bucket on each host and reconciles with a global counter in Redis every hundred milliseconds, using an atomic Lua script that does the whole check in one round trip.',
            card: {
              tag: 'NUMBERS', title: 'Sync cheaply, overshoot boundedly', stat: { v: '100 ms', u: 'sync', l: 'hosts spend from a local lease and sync deltas; overshoot is at most N × r_local × Δ' },
              more: '<p>GCRA keeps one timestamp per tenant, the theoretical arrival time TAT. The bucket level is implicit: tokens = b − (TAT − now)/T. One key therefore holds what a token bucket stores in two numbers, and a single <code>SET … PX</code> expiry cleans up idle tenants automatically.</p>'
            },
            deep: '<p>The <b>hybrid</b>: each host spends from a local lease and syncs deltas every Δ; worst-case overshoot ≈ N·r<sub>local</sub>·Δ. With N = 3 hosts and Δ = 100 ms that is a few tokens, not a factor of N.</p>' +
              '<p>GCRA in Redis is one key per tenant and one atomic script, so there is no read-modify-write race:</p>' +
              '<pre>tat = max(GET k or now, now)\nnew = tat + c*T\nif new - now &gt; b*T: RETRY(wait)\nSET k new PX b*T\nreturn OK</pre>' +
              '<p>Here <code>wait</code> = new − now − b·T, which becomes the <code>Retry-After</code> value.</p>'
          },
          {
            say: 'Request counts are the wrong currency for video, though. Before admitting the trailer, the gateway estimates its cost in GPU seconds from the resolution, duration, step count and model.',
            card: { tag: 'NUMBERS', title: 'Price the job, not the request', stat: { v: '≈ 5,960', u: 'GPU-s', l: 'estimated cost of the trailer: 5,420 GPU-seconds of planned work times a 1.1 safety margin' } },
            deep: '<p><b>Cost-based admission</b>. Estimated GPU-seconds for the trailer:</p>' +
              '<div class="eq">Ĝ = Σ<sub>shots</sub> n<sub>gpu</sub>·t<sub>shot</sub> + G<sub>redo</sub> + G<sub>LLM</sub> + G<sub>enc</sub> + G<sub>post</sub> ≈ 4,560 + 760 + 100 ≈ 5.4·10<sup>3</sup> GPU-s</div>' +
              '<p>The estimate comes from a regression on (resolution, duration, steps, model) fitted to past jobs, plus a safety margin (×1.1). The first term is 6 shots × 8 GPUs × 95 s; 760 is one budgeted critic re-render of a shot (8 GPUs × 95 s); the 100 covers planning (40), encoders (20) and audio, edit and encode (40).</p>'
          },
          {
            say: 'It checks the tenant\'s balance and the concurrency cap, then places a hold on the estimate, much like a card authorization.',
            card: { tag: 'KEY IDEA', title: 'Hold first, settle later', body: 'Admission reserves the estimate against the tenant\'s monthly balance, like a card authorization, before any GPU moves.' },
            deep: '<p>Admission places a <b>hold</b>: the estimate is reserved against the tenant\'s balance, so two concurrent jobs cannot both spend the same GPU-seconds. Concurrency caps (for example at most 2 running video jobs per tenant) and weighted fair share keep one studio from monopolizing the video pool.</p>' +
              '<p>If the balance is too low the answer is <code>429 quota_exceeded</code> before anything is scheduled: rejecting early is cheap, rejecting after a GPU has been reserved is not.</p>'
          },
          {
            say: 'When the job finishes, the actual usage is settled and the rest of the hold is released back to the tenant.',
            card: { tag: 'NUMBERS', title: 'Pay for what ran', stat: { v: '840', u: 'GPU-s', l: 'released: the 5,960 held minus the 5,120 GPU-seconds actually metered on completion' } },
            deep: '<p>Completion <b>settles</b> the actual metered GPU-seconds and releases the remainder; failure releases the whole hold. Settlement is idempotent, keyed by <code>job_id</code>, so a retried “job finished” event cannot charge twice.</p>' +
              '<p>Holds carry a TTL slightly above the job\'s maximum runtime, so a crashed orchestrator cannot strand a tenant\'s budget forever. Billing reconciles against metered GPU telemetry, never against the estimate.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          stopLoops(ctx);
          rail(ctx, 4);
          var B = newBench(ctx);
          var gws, lb, redis, sync, q1, tot, hold, holdT, avail, sc = 730 / 20000, L0 = 830;
          var lvl = [0.7, 0.4, 0.85];
          function fmt(v) { return Math.round(v).toLocaleString('en-US') + ' GPU-s'; }
          /* beat 0: gateways with local leases and a shared counter */
          function b0() {
            ctx.hud('local lease + global reconcile every 100 ms');
            heading(ctx, B, 60, 176, 'HYBRID LIMITER · local fast path + global reconcile');
            gws = [0, 1, 2].map(function (i) { return ctx.node({ x: 150, y: 250 + i * 95, w: 190, h: 60, title: 'gateway-' + i, sub: 'local lease', icon: 'server', color: 'blue', titleSize: 14, parent: B }); });
            var bgs = [];
            lb = gws.map(function (g, i) {
              bgs.push(ctx.rect(262, g.box.cy - 20, 22, 40, { rx: 3, fill: 'rgba(255,255,255,0.03)', stroke: 'faint', sw: 1, parent: B }));
              return ctx.rect(262, g.box.cy + 20 - 40 * lvl[i], 22, 40 * lvl[i], { rx: 3, fill: ctx.alpha('amber', 0.7), parent: B });
            });
            redis = ctx.node({ x: 590, y: 345, w: 220, h: 120, kind: 'cyl', title: 'Redis Cluster', sub: 'GCRA key per tenant', color: 'red', titleSize: 15, subSize: 11, parent: B });
            sync = gws.map(function (g) { return ctx.link(g, redis, { color: ctx.alpha('amber', 0.8), from: 'r', to: 'l', parent: B, dash: '4 4' }); });
            return Promise.all([ctx.reveal(gws.concat([redis]), { from: 'left', stagger: 100 }), ctx.reveal(bgs.concat(lb), { from: 'fade', delay: 300, stagger: 60 }), ctx.reveal(sync, { from: 'draw', stagger: 100, delay: 300 })]);
          }
          /* beat 1: sync deltas, atomic Lua */
          function b1() {
            var lua = code(ctx, B, { x: 60, y: 520, w: 700, title: 'gcra.lua · EVALSHA (atomic, one round trip)', lang: 'py', size: 12, color: 'red', lines: [
              'local now, T, c = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])',
              'local cap = tonumber(ARGV[4])          -- b * T  (burst window)',
              'local tat = math.max(tonumber(redis.call("GET", KEYS[1])) or now, now)',
              'local new = tat + c * T',
              'if new - now > cap then return {0, new - now - cap} end  -- retry-after',
              'redis.call("SET", KEYS[1], new, "PX", math.ceil(cap))',
              'return {1, 0}                         -- allowed'
            ] });
            var ov = ctx.text(60, 760, 'overshoot bound ≈ N · r_local · Δ_sync   (N = 3, Δ = 100 ms)', { size: 13, font: 'mono', color: 'dim', parent: B, opacity: 0 });
            ctx.reveal(lua, { from: 'up' });
            ctx.reveal(ov, { from: 'up', delay: 400 });
            return Promise.all(sync.map(function (s, i) { return ctx.wait(i * 150).then(function () { return ctx.packet(s, { color: 'amber', dur: 600, label: 'Δ=' + [37, 12, 51][i] }); }); })).then(function () {
              return ctx.tween(500, function (e) { lb.forEach(function (f, i) { var v = lvl[i] + (0.55 - lvl[i]) * e; f.setAttribute('height', 40 * v); f.setAttribute('y', gws[i].box.cy + 20 - 40 * v); }); });
            });
          }
          /* beat 2: estimate the job's GPU-second cost */
          function b2() {
            q1 = ctx.group({ parent: B });
            heading(ctx, q1, 830, 176, 'QUOTA IN GPU-SECONDS · estimate before admit', 'cyan');
            var rows = [['plan + agents (LLM)', 40], ['encode 3 sketches + memo', 20], ['6 shots × 8 GPUs × 95 s', 4560], ['1 critic re-render (budgeted)', 760], ['audio · edit · encode', 40]];
            var ebars = rows.map(function (r, i) {
              var y = 214 + i * 36;
              ctx.text(830, y + 9, r[0], { size: 12, font: 'mono', color: 'text', parent: q1 });
              ctx.rect(1100, y, 330, 18, { rx: 3, fill: 'rgba(255,255,255,0.03)', parent: q1 });
              var b = ctx.rect(1100, y, Math.max(2, r[1] / 4560 * 330), 18, { rx: 3, fill: ctx.alpha(i === 2 || i === 3 ? 'lime' : 'amber', 0.6), parent: q1 });
              ctx.text(1560, y + 9, r[1].toLocaleString('en-US'), { size: 12, font: 'mono', color: 'white', anchor: 'end', parent: q1 });
              return b;
            });
            ctx.line(830, 398, 1560, 398, { color: 'line', parent: q1 });
            ctx.text(830, 416, 'estimate Ĝ × 1.1 safety margin', { size: 13, font: 'mono', color: 'cyan', parent: q1 });
            tot = ctx.text(1560, 416, '0 GPU-s', { size: 15, font: 'mono', color: 'cyan', anchor: 'end', weight: 700, parent: q1 });
            ctx.hud('currency = GPU-seconds, not requests');
            ctx.reveal(q1, { from: 'right' });
            ctx.reveal(ebars, { from: 'left', stagger: 90, delay: 300 });
            return ctx.wait(900).then(function () { return ctx.counter(tot, 0, 5960, 1000, fmt); });
          }
          /* beat 3: place a hold on the tenant's balance */
          function b3() {
            var q2 = ctx.group({ parent: B });
            ctx.text(830, 462, 'tenant studio-42 · monthly balance 20,000 GPU-s', { size: 13, font: 'mono', color: 'text', parent: q2 });
            ctx.rect(L0, 478, 730, 30, { rx: 6, fill: 'rgba(255,255,255,0.03)', stroke: 'faint', sw: 1, parent: q2 });
            ctx.rect(L0, 478, 8200 * sc, 30, { rx: 6, fill: ctx.alpha('dim', 0.45), parent: q2 });
            ctx.text(L0 + 8200 * sc / 2, 493, 'used 8,200', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: q2 });
            hold = ctx.rect(L0 + 8200 * sc, 478, 0, 30, { rx: 0, fill: ctx.alpha('amber', 0.55), stroke: 'amber', sw: 1, parent: q2 });
            holdT = ctx.text(L0 + (8200 + 2980) * sc, 493, '', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: q2 });
            avail = ctx.text(L0 + 730 - 8, 526, 'available 11,800', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: q2 });
            var steps = code(ctx, q2, { x: 830, y: 552, w: 730, title: 'admission(job)', lang: 'py', size: 12, color: 'cyan', lines: [
              'est = estimate(job) * 1.1                  # 5,960 GPU-s',
              'if tenant.available < est: return 429 quota_exceeded',
              'if tenant.running_video_jobs >= 2: enqueue(fair_share)',
              'hold(tenant, est)          # like a card authorization',
              'on finish: settle(actual=5,120); release(est - actual)'
            ] });
            ctx.reveal(q2, { from: 'up', dur: 500 });
            holdT.textContent = 'hold 5,960';
            return ctx.wait(500).then(function () {
              return ctx.tween(900, function (e) { hold.setAttribute('width', 5960 * sc * e); holdT.setAttribute('x', L0 + (8200 + 5960 * e / 2) * sc); avail.textContent = 'available ' + Math.round(11800 - 5960 * e).toLocaleString('en-US'); }, 'out');
            });
          }
          /* beat 4: settle and release */
          function b4() {
            holdT.textContent = 'settled 5,120';
            return ctx.tween(800, function (e) { hold.setAttribute('width', (5960 - 840 * e) * sc); holdT.setAttribute('x', L0 + (8200 + (5960 - 840 * e) / 2) * sc); avail.textContent = 'available ' + Math.round(5840 + 840 * e).toLocaleString('en-US') + ' (840 released)'; }).then(function () {
              return ctx.pulse(avail, { color: 'lime', dur: 700 });
            });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Admission & load shedding',
        beats: [
          {
            say: 'Rate limits protect against one noisy tenant. Load shedding protects the whole system when everyone arrives at once.',
            card: { tag: 'KEY IDEA', title: 'Two different protections', body: 'Rate limits enforce fairness between tenants. Load shedding keeps the service alive when total demand exceeds capacity.' },
            deep: '<p><b>Why shed</b>: past saturation, queues grow without bound, latency exceeds client timeouts, and servers do work nobody is waiting for. Throughput measured at the server stays high while <i>useful</i> throughput collapses: <b>goodput collapse</b>.</p>' +
              '<p>Rejecting early keeps useful throughput near the capacity μ. A rate limit cannot do this, because a hundred well-behaved tenants can each stay under their limit and still overload the cluster together. Google\'s SRE book makes the same split: per-client throttling versus criticality-based load shedding.</p>' +
              '<details><summary>Go deeper</summary><p>Why the cliff is so sharp: in an M/M/1 queue with arrival rate λ and service rate μ, the mean time in system is</p>' +
              '<div class="eq">W = 1 / (μ − λ) = (1/μ) / (1 − ρ), &nbsp; ρ = λ/μ</div>' +
              '<p>With μ = 12 requests per second, ρ = 0.5 gives W = 167 ms, ρ = 0.95 gives 1.67 s and ρ = 0.99 gives 8.3 s; at ρ ≥ 1 there is no steady state at all. Real service times are burstier than exponential, and the Pollaczek–Khinchine formula multiplies the queueing delay by (1 + c<sub>s</sub>²)/2, so the true cliff is steeper still.</p></details>'
          },
          {
            say: 'Requests wait in priority queues: interactive paid work first, then standard, then free batch jobs. The scheduler always serves the highest class that has something waiting.',
            card: { tag: 'HOW IT WORKS', title: 'Strict priority, class targets', body: 'P0 interactive work is never shed. P1 tolerates 1.5 s of waiting and P2 only 1 s, so the lowest classes yield first.' },
            deep: '<p>Three classes share a scheduler with capacity μ = 12 requests per second. Strict priority is simple and gives paid interactive work the lowest latency, but it can starve the lower classes indefinitely, so production systems bound the damage with per-class deadlines and a small guaranteed share (weighted fair queueing).</p>' +
              '<p>Each class has a <i>target</i> waiting time. P0 has none because it is the reason the service exists; P2 has the tightest target because a free batch job can simply try again later.</p>'
          },
          {
            say: 'The shedder watches queueing delay, not queue length. When a request has already waited longer than its class can tolerate, it is rejected right away with a five oh three and a Retry-After.',
            card: {
              tag: 'PITFALL', title: 'Queue length lies', body: 'A status GET and a trailer submit differ by a factor of a thousand in service time, so a length threshold means nothing. Waiting time does.',
              more: '<p>CoDel\'s control law: after the first drop the next one is scheduled INTERVAL/√count later, so the drop rate rises like √count until the standing queue disappears. The key idea is to tolerate <i>good</i> queues (a burst that drains within an interval) and act only on <i>bad</i> queues (delay that persists above target).</p>'
            },
            deep: '<p><b>Signal = sojourn time</b>, not queue length (length is meaningless when service times vary 1000× between a status GET and a trailer submit). CoDel logic per class:</p>' +
              '<pre>if min_sojourn(INTERVAL) &gt; TARGET:\n    drop head; count += 1\n    next = now + INTERVAL/√count\nelse: count = 0</pre>' +
              '<p>(RFC 8289 defaults for packets: TARGET 5 ms, INTERVAL 100 ms; for API admission use e.g. 50 ms / 500 ms, per priority.) Under overload, serve newest first (adaptive LIFO): the oldest requests are the likeliest to have been abandoned.</p>'
          },
          {
            say: 'That keeps goodput flat at capacity instead of collapsing, because the server never burns effort on requests whose clients have already given up.',
            card: { tag: 'WHY IT MATTERS', title: 'Goodput collapse is a cliff', body: 'Without shedding, useful throughput falls as offered load passes capacity. With delay-based shedding it stays close to capacity.' },
            deep: '<p><b>Adaptive concurrency</b> (Little: L = λ·W): estimate the concurrency limit from latency gradients,</p>' +
              '<div class="eq">limit ← limit · RTT<sub>noload</sub> / RTT<sub>sample</sub> + √limit</div>' +
              '<p>Responses: <code>429</code> for “you” (tenant limit), <code>503</code> for “us” (overload), both with <code>Retry-After</code>. The draft <code>RateLimit</code> and <code>RateLimit-Policy</code> headers expose the remaining quota so well-behaved clients throttle themselves before they are shed.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          stopLoops(ctx);
          rail(ctx, 5);
          var B = newBench(ctx);
          var cls = [['P0 interactive · paid', 'cyan', 5, 9.9], ['P1 standard', 'blue', 9, 1.5], ['P2 batch · free', 'violet', 8, 1.0]];
          var laneY = [270, 370, 470];
          var srv, soj = [], srvT, shedT, chips, p1, p2, gpLegend;
          var sim = { t: 0, last: null, acc: [0, 0, 0], served: 0, shed: 0, svc: 0, fall: [], shedOn: false };
          var Q = [[], [], []], pool = [];
          /* beat 0: two protections, and the goodput chart they defend */
          function b0() {
            var gp = ctx.group({ parent: B });
            heading(ctx, gp, 880, 176, 'GOODPUT vs OFFERED LOAD', 'lime', { size: 14 });
            p1 = ctx.plot(900, 210, 640, 300, function (x) { return x < 1 ? x : Math.max(0.02, 1 - 1.35 * (x - 1) * (x - 1) - 0.35 * (x - 1)); }, { xDomain: [0, 2], yDomain: [0, 1.1], color: 'red', sw: 2.4, yLabel: 'goodput / capacity', parent: gp });
            ctx.text(1540, 548, 'offered load / capacity', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: gp });
            p2 = ctx.plot(900, 210, 640, 300, function (x) { return x < 1 ? x : 0.96; }, { xDomain: [0, 2], yDomain: [0, 1.1], color: 'lime', sw: 2.4, axes: false, parent: gp });
            var cap = p1.toPx(1, 1);
            ctx.line(cap.x, 210, cap.x, 510, { color: 'faint', dash: '3 4', parent: gp });
            ctx.text(cap.x + 6, 222, 'μ', { size: 13, font: 'mono', color: 'dim', parent: gp });
            ['0', '0.5', '1', '1.5', '2'].forEach(function (s, i) { ctx.text(900 + i * 160, 526, s, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: gp }); });
            p1.curve.setAttribute('opacity', 0); p2.curve.setAttribute('opacity', 0);
            chips = [
              ctx.label(300, 300, 'rate limit → protects against one noisy tenant', { color: 'cyan', size: 13, parent: B }),
              ctx.label(300, 370, 'load shedding → protects the whole service', { color: 'red', size: 13, parent: B })
            ];
            heading(ctx, B, 60, 176, 'PRIORITY QUEUES + DELAY-BASED SHEDDING · capacity μ = 12 req/s');
            ctx.hud('shed by waiting time, not queue length');
            return Promise.all([ctx.reveal(gp, { from: 'right' }), ctx.reveal(chips, { from: 'left', stagger: 250, delay: 200 })]);
          }
          /* beat 1: priority queues, the scheduler and the arrival stream */
          function b1() {
            ctx.remove(chips[0], 300); ctx.remove(chips[1], 300);
            srv = ctx.node({ x: 720, y: 370, w: 150, h: 90, title: 'Scheduler', sub: 'μ = 12/s', icon: 'gpu', color: 'red', titleSize: 14, parent: B });
            var g = ctx.group({ parent: B });
            cls.forEach(function (c, i) {
              ctx.label(60, laneY[i] - 34, c[0], { color: c[1], size: 12, anchor: 'start', parent: g });
              ctx.rect(250, laneY[i] - 16, 390, 32, { rx: 8, fill: ctx.alpha(c[1], 0.05), stroke: ctx.alpha(c[1], 0.4), sw: 1, parent: g });
              ctx.line(642, laneY[i], 643, laneY[i], { color: c[1], parent: g });
              ctx.link({ x: 642, y: laneY[i] }, srv, { color: ctx.alpha(c[1], 0.6), to: 'l', parent: g });
              ctx.text(60, laneY[i] + 2, 'target ' + (c[3] > 5 ? 'none (never shed)' : c[3] + ' s'), { size: 12, font: 'mono', color: 'dim', parent: g });
              soj.push(ctx.text(60, laneY[i] + 22, '', { size: 12, font: 'mono', color: c[1], parent: g }));
            });
            srvT = ctx.text(720, 440, 'served 0', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: B });
            for (var p = 0; p < 54; p++) pool.push({ on: false, el: ctx.rect(0, 0, 14, 14, { rx: 3, fill: 'cyan', parent: B, opacity: 0 }) });
            ctx.reveal(srv, { from: 'scale' });
            ctx.reveal(g, { from: 'left', delay: 200 });
            S.prio = ctx.loop(function (t) {
              if (sim.last === null) sim.last = t;
              var dt = Math.min(0.08, (t - sim.last) * Math.min(ctx.speed, 3));
              sim.last = t; sim.t += dt;
              var surge = (sim.t % 8) > 1.2;
              cls.forEach(function (c, i) {
                sim.acc[i] += (surge ? c[2] : c[2] * 0.35) * dt;
                while (sim.acc[i] >= 1) {
                  sim.acc[i] -= 1;
                  var slot = null;
                  for (var k = 0; k < pool.length; k++) if (!pool[k].on) { slot = pool[k]; break; }
                  if (slot && Q[i].length < 16) { slot.on = true; slot.born = sim.t; slot.cls = i; slot.el.setAttribute('fill', C[c[1]]); slot.el.setAttribute('opacity', 1); Q[i].push(slot); }
                }
              });
              /* shedding by sojourn */
              if (sim.shedOn) {
                [1, 2].forEach(function (i) {
                  while (Q[i].length && sim.t - Q[i][0].born > cls[i][3]) {
                    var d = Q[i].shift(); d.el.setAttribute('fill', C.red); d.fy = laneY[i]; d.fx = 620; d.vy = 0; sim.fall.push(d); sim.shed++;
                  }
                });
              }
              /* service */
              sim.svc += 12 * dt;
              while (sim.svc >= 1) {
                sim.svc -= 1;
                var qi = Q[0].length ? 0 : (Q[1].length ? 1 : (Q[2].length ? 2 : -1));
                if (qi < 0) { sim.svc = 0; break; }
                var s = Q[qi].shift(); s.on = false; s.el.setAttribute('opacity', 0); sim.served++;
              }
              Q.forEach(function (q, i) {
                q.forEach(function (d, k) { d.el.setAttribute('x', 620 - k * 23); d.el.setAttribute('y', laneY[i] - 7); });
                var w = q.length ? (sim.t - q[0].born) : 0;
                soj[i].textContent = 'head waited ' + w.toFixed(2) + ' s · len ' + q.length;
              });
              sim.fall = sim.fall.filter(function (d) {
                d.vy += 900 * dt; d.fy += d.vy * dt;
                d.el.setAttribute('y', Math.min(d.fy, 556).toFixed(1)); d.el.setAttribute('x', d.fx);
                if (d.fy > 556) { d.on = false; d.el.setAttribute('opacity', 0); return false; }
                return true;
              });
              srvT.textContent = 'served ' + sim.served;
              if (shedT) shedT.textContent = 'shed ' + sim.shed + ' · 503 + Retry-After';
            });
            return ctx.wait(2500);
          }
          /* beat 2: delay-based shedding */
          function b2() {
            var bin = ctx.group({ parent: B });
            ctx.rect(250, 540, 390, 40, { rx: 8, fill: 'rgba(255,77,109,0.08)', stroke: ctx.alpha('red', 0.6), sw: 1.2, parent: bin });
            shedT = ctx.text(445, 560, 'shed: 503 + Retry-After', { size: 13, font: 'mono', color: 'red', anchor: 'middle', parent: bin });
            var resp = code(ctx, B, { x: 60, y: 620, w: 700, title: 'overload response', lang: 'text', size: 12, color: 'red', lines: [
              'HTTP/2 503 Service Unavailable',
              'retry-after: 7',
              'ratelimit-policy: "video";q=2;w=3600',
              'ratelimit: "video";r=0;t=7',
              '{"error": "overloaded", "class": "P2", "queued_ms": 612}'
            ] });
            var codel = ctx.para(830, 640, ['CoDel per class: drop head if min sojourn > TARGET for INTERVAL', 'next drop at INTERVAL / √count  → gentle, then firm', 'adaptive LIFO under overload: serve newest first', 'concurrency limit ← limit · RTT_noload / RTT_sample + √limit'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: B });
            sim.shedOn = true;
            return Promise.all([ctx.reveal(bin, { from: 'up' }), ctx.reveal([resp, codel], { from: 'up', stagger: 150, delay: 300 })]).then(function () { return ctx.wait(2500); });
          }
          /* beat 3: goodput stays flat */
          function b3() {
            var l1 = ctx.text(920, 236, '— with delay-based shedding', { size: 12, font: 'mono', color: 'lime', parent: B, opacity: 0 });
            var l2 = ctx.text(920, 258, '— no shedding: goodput collapse', { size: 12, font: 'mono', color: 'red', parent: B, opacity: 0 });
            p1.curve.setAttribute('opacity', 1); p2.curve.setAttribute('opacity', 1);
            ctx.reveal([l1, l2], { from: 'fade', stagger: 200 });
            return Promise.all([ctx.reveal(p1.curve, { from: 'draw', dur: 1600 }), ctx.reveal(p2.curve, { from: 'draw', dur: 1600, delay: 500 })]).then(function () { return ctx.wait(2000); });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3);
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Retries, breakers & hedging',
        beats: [
          {
            say: 'Failures deeper in the system must not echo back as storms. Retries use exponential backoff with full jitter, so thousands of clients do not retry in lockstep.',
            card: { tag: 'PITFALL', title: 'Synchronized retries are an attack', body: 'Clients that fail together retry together, arriving in waves exactly when the dependency is weakest. Jitter breaks the waves.' },
            deep: '<p><b>Backoff with full jitter</b> (Brooker, AWS):</p>' +
              '<div class="eq">sleep<sub>n</sub> = U(0, min(cap, base · 2<sup>n</sup>))</div>' +
              '<p>Jitter de-correlates clients; without it, synchronized retries arrive as waves exactly when the dependency is weakest. In Brooker\'s simulations full jitter completes the same work with far fewer calls than plain exponential backoff, because retries spread out instead of colliding again and again.</p>'
          },
          {
            say: 'A retry budget caps retries at about ten percent of traffic, because three layers each retrying three times would multiply the load twenty-seven fold.',
            card: { tag: 'NUMBERS', title: 'Retries multiply through layers', stat: { v: '27×', l: 'worst-case load when 3 layers each make 3 attempts: r to the power k' } },
            deep: '<p><b>Retry amplification</b>: with k layers each doing r attempts, worst-case load multiplies by r<sup>k</sup> (3 layers × 3 attempts = 27×). The fix: retry at one layer only, and enforce a <b>retry budget</b>, for example retries ≤ 10 % of requests per client or cluster (Envoy <code>retry_budget</code>, gRPC retry throttling).</p>' +
              '<p>Idempotency keys make every retry <i>safe</i>; budgets make retries <i>affordable</i>. Both are needed.</p>'
          },
          {
            say: 'Circuit breakers stop calling a failing dependency and probe it gently before trusting it again. They turn a slow failure into a fast one.',
            card: { tag: 'HOW IT WORKS', title: 'Closed, open, half-open', body: 'Trip on an error rate over a sliding window, fail fast for a cool-down, then let a few probes through before trusting the dependency.' },
            deep: '<p><b>Circuit breaker</b>: CLOSED → OPEN when the error rate over a sliding window exceeds a threshold (for example 50 % of at least 20 calls); OPEN fails fast for a cool-down (for example 30 s); HALF-OPEN lets a few probes through; success → CLOSED, failure → OPEN again.</p>' +
              '<p>Failing fast frees threads and connections that would otherwise pile up waiting on a dead dependency. Envoy also caps concurrent requests and pending requests per upstream cluster, and outlier detection ejects individual bad hosts.</p>' +
              '<details><summary>Go deeper</summary><p>Choosing the threshold is a hypothesis test. Over a window of n = 20 calls with true error rate p, the breaker trips when at least 10 fail, a binomial tail:</p>' +
              '<div class="eq">P(trip) = Σ<sub>k≥10</sub> C(20, k) · p<sup>k</sup> · (1−p)<sup>20−k</sup></div>' +
              '<p>At a healthy p = 1 % this is about 2·10<sup>−15</sup>, so spurious trips are negligible. At p = 30 % it is 4.8 %, at p = 50 % it is 59 %, and repeated windows push the probability toward one. Small windows react faster but trip falsely more often, which is why real implementations also demand a minimum call volume.</p></details>'
          },
          {
            say: 'And for idempotent reads, hedged requests send a backup copy after the ninety-fifth percentile latency, cutting the tail. Only the first reply counts, and the loser is cancelled.',
            card: {
              tag: 'NUMBERS', title: 'Hedging cuts the tail', stat: { v: '≈ 24×', u: 'lower p99.9', l: 'BigTable benchmark: hedging after 10 ms cut p99.9 from 1,800 to 74 ms for 2 % more requests' },
              more: '<p>Why it works: if replicas are independent, the chance that both copies are slow is the product of the tails. The original lands beyond the p99 with probability 1 %, and the backup, sent at the p95 mark, is also slow with probability of at most about 5 %: 0.01 × 0.05 = 0.05 %. Only 5 % of requests ever send a second copy. Correlated slowness (same rack, same garbage-collection pause) erodes the gain.</p>'
            },
            deep: '<p><b>Hedged requests</b> (Dean &amp; Barroso): send a second copy if no reply arrives within the p95 latency, which caps the extra load at about 5 %; cancel the loser when one replies. In their BigTable benchmark (1,000 keys spread over 100 servers), hedging after 10 ms cut the 99.9th-percentile latency from 1,800 ms to 74 ms for only 2 % more requests.</p>' +
              '<p>Use it only for idempotent, cancellable operations such as status reads and cache fetches; never for <code>POST /v1/jobs</code> without its idempotency key.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          stopLoops(ctx);
          rail(ctx, 6);
          var B = newBench(ctx);
          var dotsA = [], dotsB = [], tail, cut, hres, ph, hg;
          /* beat 0: backoff without and with full jitter (left column) */
          function b0() {
            var bj = ctx.group({ parent: B, x: -560, y: 0 });
            heading(ctx, bj, 600, 176, 'BACKOFF WITH FULL JITTER', 'cyan', { size: 14 });
            ctx.text(600, 204, 'sleep_n = U(0, min(cap, base·2^n)) · base 100 ms · cap 3.2 s', { size: 12, font: 'mono', color: 'dim', parent: bj });
            var rj = ctx.rng(12);
            var X0 = 620, XW = 440, T = 4;
            function tx(s) { return X0 + s / T * XW; }
            ctx.line(X0, 330, X0 + XW, 330, { color: 'faint', parent: bj });
            ctx.line(X0, 470, X0 + XW, 470, { color: 'faint', parent: bj });
            [0, 1, 2, 3, 4].forEach(function (s) { ctx.text(tx(s), 486, s + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: bj }); });
            ctx.text(X0, 238, 'no jitter: 30 clients retry in lockstep', { size: 12, font: 'mono', color: 'red', parent: bj });
            ctx.text(X0, 368, 'full jitter: the same retries, spread out', { size: 12, font: 'mono', color: 'lime', parent: bj });
            for (var c = 0; c < 30; c++) {
              var ta = 0, tb = 0;
              for (var n = 0; n < 4; n++) {
                var capn = Math.min(3.2, 0.1 * Math.pow(2, n + 1));
                ta += capn; tb += rj() * capn + 0.05;
                if (ta < T) dotsA.push(ctx.circle(tx(ta), 322 - (c % 10) * 7, 2.6, { fill: 'red', parent: bj, opacity: 0 }));
                if (tb < T) dotsB.push(ctx.circle(tx(tb), 462 - (c % 10) * 7, 2.6, { fill: 'lime', parent: bj, opacity: 0 }));
              }
            }
            ctx.hud('backoff + jitter · budgets · breakers · hedges');
            return ctx.reveal(bj, { from: 'up' }).then(function () {
              return Promise.all([ctx.reveal(dotsA, { from: 'scale', stagger: 6, dur: 250 }), ctx.reveal(dotsB, { from: 'scale', stagger: 6, dur: 250, delay: 300 })]);
            });
          }
          /* beat 1: retry amplification and the fix */
          function b1() {
            var am = ctx.group({ parent: B });
            heading(ctx, am, 60, 560, 'RETRY AMPLIFICATION · 3 layers × 3 attempts = 27× load', 'red', { size: 14 });
            var layers = ['gateway', 'jobs-api', 'orchestrator', 'model svc'];
            var counts = [1, 3, 9, 27];
            layers.forEach(function (l, i) {
              var x = 120 + i * 230;
              ctx.text(x, 596, l, { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: am });
              var cols = Math.min(9, counts[i]), rowsN = Math.ceil(counts[i] / 9);
              for (var k = 0; k < counts[i]; k++) ctx.rect(x - cols * 7 + (k % 9) * 14, 612 + Math.floor(k / 9) * 14, 11, 11, { rx: 2, fill: ctx.alpha(i === 3 ? 'red' : 'amber', 0.75), parent: am });
              ctx.text(x, 612 + rowsN * 14 + 16, '×' + counts[i], { size: 13, font: 'mono', color: i === 3 ? 'red' : 'amber', anchor: 'middle', weight: 700, parent: am });
              if (i < 3) ctx.line(x + 70, 640, x + 150, 640, { color: 'faint', arrow: true, parent: am });
            });
            var fix = ctx.group({ parent: B });
            ctx.rect(960, 580, 600, 150, { rx: 10, fill: 'rgba(141,255,90,0.05)', stroke: ctx.alpha('lime', 0.6), sw: 1.2, parent: fix });
            ctx.text(980, 606, 'FIX', { size: 14, font: 'display', weight: 700, color: 'lime', parent: fix });
            ctx.para(980, 636, ['retry at ONE layer (the edge client), others fail fast', 'retry budget: retries ≤ 10 % of requests', 'idempotency keys make every retry safe', 'breakers + outlier ejection stop hammering'], { size: 12, font: 'mono', color: 'text', lh: 22, parent: fix });
            return ctx.reveal([am, fix], { from: 'up', stagger: 400 });
          }
          /* beat 2: circuit breaker state machine (middle column) */
          function b2() {
            var cb = ctx.group({ parent: B, x: 540, y: 0 });
            heading(ctx, cb, 60, 176, 'CIRCUIT BREAKER', 'amber', { size: 14 });
            var st = {
              closed: ctx.node({ x: 130, y: 290, w: 140, h: 54, title: 'CLOSED', sub: 'calls flow', color: 'lime', kind: 'pill', titleSize: 14, parent: cb }),
              open: ctx.node({ x: 450, y: 290, w: 140, h: 54, title: 'OPEN', sub: 'fail fast', color: 'red', kind: 'pill', titleSize: 14, parent: cb }),
              half: ctx.node({ x: 290, y: 470, w: 160, h: 54, title: 'HALF-OPEN', sub: 'few probes', color: 'amber', kind: 'pill', titleSize: 14, parent: cb })
            };
            ctx.link(st.closed, st.open, { color: 'red', from: 'r', to: 'l', parent: cb, straight: true, label: 'error rate > 50 %', labelDy: -18 });
            ctx.link(st.open, st.half, { color: 'amber', from: 'b', to: 'r', parent: cb, label: 'after 30 s', labelDx: 44, labelDy: 6 });
            ctx.link(st.half, st.closed, { color: 'lime', from: 'l', to: 'b', parent: cb, label: 'probes ok', labelDx: -44, labelDy: 6 });
            ctx.link(st.half, st.open, { color: 'red', from: 't', to: 'b', parent: cb, dash: '4 4', curve: 0.2, label: 'probe fails', labelDx: -64, labelDy: 0 });
            var tok = ctx.circle(st.closed.box.cx, st.closed.box.cy - 40, 7, { fill: 'white', parent: cb, glow: true });
            var order = ['closed', 'open', 'half', 'closed'];
            var t0 = null;
            S.cb = ctx.loop(function (t) {
              if (t0 === null) t0 = t;
              var ph2 = ((t - t0) * Math.min(ctx.speed, 3) / 1.6) % 4;
              var i = Math.floor(ph2), f = ph2 - i;
              var a = st[order[i]].box, b = st[order[(i + 1) % 4]].box;
              var k = f < 0.7 ? 0 : (f - 0.7) / 0.3;
              tok.setAttribute('cx', a.cx + (b.cx - a.cx) * k);
              tok.setAttribute('cy', a.cy - 40 + (b.cy - a.cy) * k);
              Object.keys(st).forEach(function (key) { st[key].body.setAttribute('stroke-width', key === order[i] && k === 0 ? 3 : 1.6); });
            });
            return ctx.reveal(cb, { from: 'left' }).then(function () { return ctx.wait(1800); });
          }
          /* beat 3: hedged requests (right column) */
          function b3() {
            hg = ctx.group({ parent: B });
            heading(ctx, hg, 1110, 176, 'HEDGED REQUESTS · illustrative latency curve', 'violet', { size: 14 });
            /* lognormal(mu = ln 40 ms, sigma = 0.55) body + a slow-replica tail bump, on a log10 latency axis */
            ph = ctx.plot(1120, 220, 430, 220, function (u) { var z = (u * Math.LN10 - Math.log(40)) / 0.55; return Math.exp(-z * z / 2) + 0.09 * Math.exp(-Math.pow((u - 2.6) / 0.07, 2) / 2); }, { xDomain: [1, 3], yDomain: [0, 1.15], color: 'violet', sw: 2, yLabel: 'density', samples: 160, parent: hg });
            [[1, '10'], [1.477, '30'], [2, '100'], [2.477, '300'], [3, '1000 ms']].forEach(function (tk) { ctx.text(ph.toPx(tk[0], 0).x, 456, tk[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: hg }); });
            var p95 = ph.toPx(Math.log10(99), 0);
            ctx.line(p95.x, 220, p95.x, 440, { color: 'amber', dash: '4 3', parent: hg });
            ctx.text(p95.x + 6, 232, 'p95 ≈ 100 ms: send backup', { size: 12, font: 'mono', color: 'amber', parent: hg });
            tail = ctx.text(ph.toPx(2.6, 0).x, 400, 'slow tail', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: hg });
            cut = ctx.rect(p95.x + 40, 250, 1550 - p95.x - 40, 188, { rx: 4, fill: 'rgba(5,8,15,0.8)', parent: hg, opacity: 0 });
            hres = ctx.text(1335, 484, 'BigTable: p99.9 1,800 → 74 ms, +2 % requests (hedge @ 10 ms)', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: hg, opacity: 0 });
            return ctx.reveal(hg, { from: 'right' }).then(function () {
              ctx.reveal(cut, { dur: 500 });
              tail.setAttribute('fill', C.dim);
              return ctx.reveal(hres, { from: 'up', dur: 400 });
            });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3);
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Regions & service mesh',
        beats: [
          {
            say: 'Finally, the admitted request crosses into the service mesh. We run active-active in several regions, and each region has its own gateways, job services, orchestrators and GPU pools.',
            card: { tag: 'KEY IDEA', title: 'Every region serves traffic', body: 'Active-active means no idle standby. Each region is a complete stack, so losing one is a capacity problem, not an outage.' },
            deep: '<p><b>Active-active</b>: every region serves traffic; GeoDNS and anycast steer users. Each region runs its own gateways, job services, orchestrators and GPU pools, so a request never needs a cross-region call on its hot path.</p>' +
              '<p>GPU pools are regional and scheduled locally. Model weights (tens to hundreds of GB) are pre-staged in every region, because moving them at failover time would take longer than the outage.</p>'
          },
          {
            say: 'Every tenant has a home region for data residency, with failover to a peer. Job metadata replicates asynchronously, so a peer can pick up where a failed region stopped.',
            card: {
              tag: 'TRADE-OFF', title: 'Home region versus availability', body: 'Residency pins data to one region. Async replication gives failover with seconds of possible loss; strict consistency would cost latency on every write.',
              more: '<p>With asynchronous replication lag L, a regional failure loses up to L seconds of committed writes: RPO = L. A tenant that needs RPO 0 must commit synchronously across regions and pays at least one inter-region round trip, roughly 60–150 ms, on every write.</p>'
            },
            deep: '<p>Each tenant has a <b>home region</b> (data residency, GDPR) where its job records live. Job metadata replicates asynchronously (RPO of seconds) or through a multi-region consensus store when strict. Object storage uses cross-region replication for media.</p>' +
              '<p><b>Failover</b>: health-checked withdrawal at the edge; the peer rebuilds in-flight workflows from the replicated durable event history. A shot\'s checkpointed latent is only about 10–100 MB, so the peer can resume a render instead of restarting it. Capacity planning must keep N+1 headroom, or failover itself becomes the overload.</p>'
          },
          {
            say: 'Inside a region, services speak gRPC with protocol buffers over mutual TLS. The schema is the contract, and deadlines and cancellation are part of the protocol.',
            card: { tag: 'HOW IT WORKS', title: 'Schema-first RPC', body: 'Protobuf is 3 to 10 times smaller and faster to parse than JSON, and gRPC carries deadlines, cancellation and streaming natively.' },
            deep: '<p><b>Internal RPC</b>: gRPC over HTTP/2 with protobuf. It is schema-first, roughly 3–10× smaller and faster to parse than JSON, with native deadlines (propagated as <code>grpc-timeout</code>), cancellation, and server streaming (<code>Watch</code> for job events).</p>' +
              '<p>A deadline set at the gateway shrinks as it travels down the call tree, so a slow leaf can never keep a request alive after the caller has given up. This is the same idea as the shedding step, applied inside the mesh.</p>'
          },
          {
            say: 'Every workload carries a short-lived cryptographic identity, and authorization is by identity, not by IP address. Only the gateway may call job creation.',
            card: { tag: 'STATE OF THE ART', title: 'Zero trust with SPIFFE', body: 'Workloads get short-lived X.509 identities that the mesh rotates. Policy names identities, so network location proves nothing.' },
            deep: '<p><b>mTLS mesh</b>: each workload gets a SPIFFE ID (<code>spiffe://genesis/ns/prod/sa/jobs-api</code>) in a short-lived X.509 SVID (SPIRE default 1 h, Istio 24 h), rotated automatically by the mesh. Sidecars or ambient ztunnels enforce policy such as “only <code>gateway</code> may call <code>jobs.Create</code>”.</p>' +
              '<p>Zero trust: the network location of a caller proves nothing. A compromised pod cannot impersonate another because its private key never leaves its own workload.</p>'
          },
          {
            say: 'The job has passed every door. Microseconds of checks guarded thousands of GPU seconds. Next stop: the orchestration plane.',
            card: { tag: 'WHY IT MATTERS', title: 'Ready for the orchestrator', body: 'Authenticated, admitted, budgeted and traced: the job enters the orchestration plane with a hold on its GPU-seconds.' },
            deep: '<p>What the job carries into the orchestration plane: a verified identity and tenant, an admission <b>hold</b> of about 5,960 GPU-seconds, an idempotency key, and a W3C <code>traceparent</code> that joins every later span to the trace that started at the edge.</p>' +
              '<div class="note">Microseconds of checks guard thousands of GPU-seconds.</div>' +
              '<p>Next: the orchestration plane turns the request into a task graph and runs it on a durable workflow engine.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          stopLoops(ctx);
          rail(ctx, 7);
          var B = newBench(ctx);
          var edge, regs, e1, e2, rep;
          /* beat 0: an edge and two complete regions */
          function b0() {
            heading(ctx, B, 60, 176, 'ACTIVE-ACTIVE REGIONS · gRPC + protobuf over an mTLS mesh');
            edge = ctx.node({ x: 800, y: 222, w: 330, h: 54, title: 'Anycast edge + GeoDNS', sub: 'tenant → home region', icon: 'globe', color: 'blue', titleSize: 14, parent: B });
            regs = [['us-east', 60], ['eu-west', 840]].map(function (r, ri) {
              var g = ctx.group({ parent: B });
              var x0 = r[1];
              ctx.rect(x0, 290, 700, 330, { rx: 16, fill: 'rgba(77,141,255,0.04)', stroke: ctx.alpha('blue', 0.55), sw: 1.4, dash: '6 5', parent: g });
              var lab = ctx.text(x0 + 20, 602, 'REGION ' + r[0], { size: 13, font: 'display', weight: 700, color: 'blue', parent: g });
              var n1 = ctx.node({ x: x0 + 120, y: 390, w: 180, h: 54, title: 'L7 gateway', icon: 'shield', color: 'blue', titleSize: 13, parent: g });
              var n2 = ctx.node({ x: x0 + 350, y: 390, w: 180, h: 54, title: 'jobs-api', icon: 'server', color: 'blue', titleSize: 13, parent: g });
              var n3 = ctx.node({ x: x0 + 580, y: 390, w: 180, h: 54, title: 'orchestrator', icon: 'gear', color: 'magenta', titleSize: 13, parent: g });
              var n4 = ctx.node({ x: x0 + 350, y: 540, w: 260, h: 60, title: 'GPU pools', sub: 'LLM · video · encoders', icon: 'gpu', color: 'red', titleSize: 13, parent: g });
              ctx.link(n1, n2, { color: ctx.alpha('blue', 0.7), parent: g, straight: true });
              ctx.link(n2, n3, { color: ctx.alpha('blue', 0.7), parent: g, straight: true });
              ctx.link(n3, n4, { color: ctx.alpha('blue', 0.7), parent: g, from: 'b', to: 'r' });
              return { g: g, lab: lab, n1: n1, n2: n2, n3: n3, n4: n4, x0: x0 };
            });
            ctx.hud('admitted → orchestration plane');
            return Promise.all([ctx.reveal(edge, { from: 'down' }), ctx.reveal(regs.map(function (r) { return r.g; }), { from: 'up', stagger: 200, delay: 200 })]);
          }
          /* beat 1: home region, failover peer, async replication */
          function b1() {
            e1 = ctx.link(edge, regs[0].n1, { color: 'blue', from: 'b', to: 't', parent: B, dash: '4 4', straight: true, label: 'failover', labelDx: 70, labelDy: -34 });
            e2 = ctx.link(edge, regs[1].n1, { color: 'cyan', from: 'b', to: 't', parent: B, sw: 2.2, straight: true });
            var rg = ctx.group({ parent: B });
            rep = ctx.path('M760,560 L840,560', { color: 'teal', sw: 2, dash: '5 4', parent: rg });
            ctx.path('M840,575 L760,575', { color: 'teal', sw: 2, dash: '5 4', parent: rg });
            ctx.text(800, 600, 'async', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: rg });
            ctx.text(800, 540, 'replicate', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: rg });
            regs[1].lab.textContent = 'REGION eu-west  ·  home of studio-42';
            regs[1].lab.setAttribute('fill', ctx.color('cyan'));
            ctx.reveal(e1.labelEl, { delay: 400 });
            return Promise.all([ctx.reveal([e1, e2], { from: 'draw', stagger: 200 }), ctx.reveal(rg, { from: 'fade', delay: 500 })]).then(function () {
              return ctx.packet(e2, { color: 'cyan', dur: 700, label: 'job' });
            });
          }
          /* beat 2: gRPC + protobuf over mTLS */
          function b2() {
            var over = [];
            regs.forEach(function (r) {
              var g = r.g, x0 = r.x0;
              var o1 = ctx.link(r.n1, r.n2, { color: 'lime', parent: g, straight: true, sw: 2 });
              var o2 = ctx.link(r.n2, r.n3, { color: 'lime', parent: g, straight: true, sw: 2 });
              var o3 = ctx.link(r.n3, r.n4, { color: 'lime', parent: g, from: 'b', to: 'r', sw: 2 });
              r.links = [o1, o2, o3];
              over.push(o1, o2, o3);
              [[x0 + 235, 378], [x0 + 465, 378]].forEach(function (p) { ctx.icon('lock', p[0], p[1] - 4, 14, 'lime', { parent: g }); });
              ctx.text(x0 + 235, 422, 'mTLS', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: g });
              ctx.text(x0 + 465, 422, 'gRPC', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: g });
            });
            var proto = code(ctx, B, { x: 60, y: 650, w: 700, title: 'jobs.proto', lang: 'js', size: 12, color: 'magenta', lines: [
              'service Jobs {',
              '  rpc Create(CreateJobRequest) returns (Job);   // idempotency_key',
              '  rpc Watch(WatchRequest) returns (stream JobEvent);',
              '}',
              'message CreateJobRequest { string idempotency_key = 1; Spec spec = 2; }'
            ] });
            ctx.reveal(proto, { from: 'up', delay: 300 });
            return ctx.reveal(over, { from: 'draw', stagger: 120 });
          }
          /* beat 3: workload identity */
          function b3() {
            var spf = ctx.para(840, 676, ['identity: spiffe://genesis/ns/prod/sa/jobs-api', 'X.509 SVID · ~1 h lifetime · auto-rotated', 'policy: only sa/gateway may call jobs.Create', 'deadline propagates: grpc-timeout 800m'], { size: 13, font: 'mono', color: 'text', lh: 25, parent: B });
            return ctx.reveal(spf, { from: 'up' }).then(function () { return ctx.pulse(regs[1].n2, { color: 'lime', times: 2, dur: 600 }); });
          }
          /* beat 4: onward to orchestration */
          function b4() {
            var fin = ctx.text(800, 812, 'Microseconds of checks guard thousands of GPU-seconds. Next door: the orchestration plane.', { size: 16, font: 'display', weight: 600, color: 'text', anchor: 'middle', parent: B, opacity: 0 });
            ctx.reveal(fin, { from: 'up' });
            var L = regs[1].links;
            return ctx.packet(e2, { color: 'cyan', dur: 700, label: 'job' }).then(function () {
              return ctx.packet(L[0], { color: 'lime', dur: 450 });
            }).then(function () { return ctx.packet(L[1], { color: 'lime', dur: 450 }); }).then(function () {
              return ctx.packet(L[2], { color: 'lime', dur: 600, label: 'render' });
            }).then(function () {
              ctx.packet(rep, { color: 'teal', dur: 700, reverse: true });
              return ctx.pulse(regs[1].n3, { color: 'magenta', times: 2, dur: 700 });
            });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      }
    ]
  });
})();
