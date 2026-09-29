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
      'Nichols &amp; Jacobson, <i>Controlling Queue Delay</i>, ACM Queue 2012; Nichols et al., <i>RFC 8289: CoDel AQM</i>, 2018',
      'Beyer et al. (eds.), <i>Site Reliability Engineering</i>, O\'Reilly 2016, ch. 21 “Handling Overload” and ch. 22 “Addressing Cascading Failures”',
      'ATM Forum, <i>Traffic Management Specification 4.0</i> (GCRA), 1996; Brooker, <i>Exponential Backoff and Jitter</i>, AWS Architecture Blog, 2015',
      'Envoy Proxy documentation: <i>HTTP filter chain, JWT authentication, ext_authz, global and local rate limiting, circuit breaking, retry budgets</i>, 2025',
      'Kwiatkowski et al., <i>Post-quantum hybrid ECDHE-MLKEM key agreement for TLS 1.3</i> (X25519MLKEM768), IETF draft-ietf-tls-ecdhe-mlkem, 2025',
      'SPIFFE project, <i>Secure Production Identity Framework for Everyone</i> specification (SVIDs, workload API), CNCF 2024'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'The front door',
        say: 'Before a request can touch a GPU, it walks through a series of doors, and each one asks a different question. Which point of presence is closest? Is this traffic an attack? Which gateway host takes the connection? Who is the caller, and are they allowed to do this? And finally: may this job enter right now, given the tenant\'s budget and the cluster\'s load? The design principle is simple. Reject as early and as cheaply as possible, because admitted work is expensive.',
        deep: '<p>The edge is a <b>cascade of filters with increasing cost per decision and decreasing traffic volume</b>. Each layer only sees what the previous one passed:</p>' +
          '<table><tr><th>Layer</th><th>Decides</th><th>Cost / decision</th></tr>' +
          '<tr><td>Anycast + GeoDNS</td><td>which PoP / region</td><td>0 (routing)</td></tr>' +
          '<tr><td>Scrub / WAF</td><td>attack vs user</td><td>ns–µs (XDP/eBPF, SYN cookies)</td></tr>' +
          '<tr><td>L4 LB</td><td>which gateway host</td><td>~100 ns per packet (hash + table)</td></tr>' +
          '<tr><td>L7 gateway</td><td>identity, route, schema</td><td>~10–100 µs CPU (TLS, JWT verify)</td></tr>' +
          '<tr><td>Admission</td><td>may it run <i>now</i></td><td>~0.1–1 ms (Redis, estimator)</td></tr></table>' +
          '<p>Asymmetry drives the design: a rejected request costs microseconds; an admitted trailer costs ~5,400 GPU-seconds. So the gateway front-loads every cheap check and makes admission <i>cost-aware</i>, not merely request-count-aware.</p>' +
          '<div class="note">Failure responses are part of the contract: <code>401/403</code> (identity), <code>413/400</code> (shape), <code>429</code> (your limit, with <code>Retry-After</code>), <code>503</code> (our overload). Clients react differently to each.</div>',
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
          S.pn = P.map(function (p, i) {
            var x = 120 + i * 214;
            var n = ctx.node({ x: x, y: 440, w: 190, h: 66, title: p[0], sub: p[1], icon: p[2], color: p[3], titleSize: 15, subSize: 11, parent: S.pipe });
            n.q = ctx.text(x, 330, p[4], { size: 16, font: 'display', weight: 600, color: 'white', anchor: 'middle', parent: S.pipe });
            n.l = ctx.label(x, 372, p[5], { color: p[3] === 'white' ? 'dim' : p[3], size: 11, parent: S.pipe });
            return n;
          });
          ctx.reveal(S.pn, { from: 'left', stagger: 120 });
          ctx.reveal(S.pn.map(function (n) { return n.q; }), { from: 'down', stagger: 120, delay: 300 });
          ctx.reveal(S.pn.map(function (n) { return n.l; }), { from: 'fade', stagger: 120, delay: 500 });
          /* traffic volume arriving at each gate (log scale, illustrative attack) */
          var vol = [[1.2e6, '1.2M'], [1.2e6, '1.2M'], [1.2e6, '1.2M'], [4.1e4, '41k'], [4.1e4, '41k'], [3.6e4, '36k'], [3.1e4, '31k']];
          var vb = ctx.group({ parent: S.pipe });
          ctx.text(20, 196, 'req/s arriving (log scale, during an attack)', { size: 12, font: 'mono', color: 'dim', parent: vb });
          var vbars = vol.map(function (v, i) {
            var x = 120 + i * 214, h = (Math.log10(v[0]) - 3) / 4 * 80;
            var r = ctx.rect(x - 22, 292 - h, 44, h, { rx: 3, fill: ctx.alpha(i < 3 ? 'red' : 'blue', 0.45), stroke: i < 3 ? 'red' : 'blue', sw: 1, parent: vb });
            ctx.text(x, 292 - h - 12, v[1], { size: 12, font: 'mono', color: i < 3 ? 'red' : 'blue', anchor: 'middle', weight: 600, parent: vb });
            return r;
          });
          ctx.line(20, 293, 1515, 293, { color: 'faint', parent: vb });
          ctx.reveal(vb, { from: 'fade', delay: 700 });
          ctx.reveal(vbars, { from: 'up', stagger: 100, delay: 800, dist: 12 });
          S.pl = [];
          for (var i = 0; i < 6; i++) S.pl.push(ctx.link(S.pn[i], S.pn[i + 1], { color: 'blue', straight: true, parent: S.pipe }));
          ctx.reveal(S.pl, { from: 'draw', stagger: 110, delay: 400 });
          var bin = ctx.group({ parent: S.pipe });
          ctx.rect(440, 640, 870, 50, { rx: 10, fill: 'rgba(255,77,109,0.07)', stroke: ctx.alpha('red', 0.6), dash: '6 5', parent: bin });
          ctx.text(875, 665, 'rejected early & cheaply:  dropped · 401 / 403 · 429 + Retry-After', { size: 14, font: 'mono', color: 'red', anchor: 'middle', parent: bin });
          S.rj = [[2, 'drop'], [4, '401/403'], [5, '429']].map(function (r) {
            var x = 120 + r[0] * 214;
            var l = ctx.path('M' + x + ',473 L' + x + ',638', { color: ctx.alpha('red', 0.7), sw: 1.5, dash: '4 4', arrow: true, parent: bin });
            ctx.label(x + 36, 560, r[1], { color: 'red', size: 11, parent: bin });
            return l;
          });
          ctx.reveal(bin, { from: 'up', delay: 900 });
          var pr = ctx.text(800, 750, 'A rejected request costs microseconds at the edge. An admitted trailer costs ~5,400 GPU-seconds.', { size: 17, font: 'display', weight: 600, color: 'text', anchor: 'middle', parent: S.pipe });
          ctx.reveal(pr, { from: 'up', delay: 1300 });
          ctx.hud('5 gates between a keystroke and a GPU');
          function hop(k, col, label) {
            return S.pl.slice(0, k).reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: col, dur: 380, label: label }); }); }, Promise.resolve());
          }
          return ctx.wait(1400).then(function () {
            return Promise.all([
              hop(6, 'lime', 'POST /v1/jobs'),
              ctx.wait(300).then(function () { return hop(2, 'red', 'SYN flood'); }).then(function () { return ctx.packet(S.rj[0], { color: 'red', dur: 450 }); }),
              ctx.wait(600).then(function () { return hop(4, 'amber', 'expired JWT'); }).then(function () { return ctx.packet(S.rj[1], { color: 'red', dur: 450 }); }),
              ctx.wait(900).then(function () { return hop(5, 'orange', 'over quota'); }).then(function () { return ctx.packet(S.rj[2], { color: 'red', dur: 450 }); })
            ]);
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Anycast, GeoDNS & scrubbing',
        say: 'Every edge location announces the same IP prefix over BGP. That is anycast: the internet\'s own routing delivers each user to a nearby point of presence, and GeoDNS can steer a tenant to a home region on top. When the Frankfurt site withdraws its route for maintenance, its users quietly shift to London. Anycast is also the first DDoS defense. A flood is split across dozens of sites, then scrubbed with SYN cookies, fingerprints and firewall rules, so only clean traffic moves inward.',
        deep: '<p><b>Anycast</b>: every PoP advertises <code>203.0.113.0/24</code>; BGP picks the “best” path (shortest AS path, local preference) — usually but not always the geographically nearest. Failover is a route withdrawal: convergence in seconds, no DNS TTL to wait out. Risk: route flaps can move a TCP flow mid-connection (QUIC connection IDs help).</p>' +
          '<p><b>GeoDNS</b>: answers depend on the resolver or, with <b>EDNS Client Subnet</b>, the user\'s /24. TTL 30–60 s bounds failover time. Typical combo: GeoDNS → region (data residency), anycast → PoP.</p>' +
          '<p><b>Volumetric math</b>: an attack of A b/s from bots spread by BGP over N PoPs lands roughly</p>' +
          '<div class="eq">A<sub>PoP</sub> ≈ A · w<sub>i</sub>, &nbsp; Σ w<sub>i</sub> = 1 &nbsp;⇒&nbsp; needs C<sub>PoP</sub> ≥ max<sub>i</sub> A·w<sub>i</sub></div>' +
          '<p>Record floods in 2025 passed 20 Tb/s (Cloudflare mitigated a 22.2 Tb/s UDP flood in September 2025). Only a network with hundreds of Tb/s of aggregate edge capacity absorbs that, and only if anycast spreads it.</p>' +
          '<ul><li><b>L3/4</b>: XDP/eBPF drop rules, SYN cookies (no state until the 3rd packet), UDP amplification filters, per-source PPS limits.</li>' +
          '<li><b>TLS/L7</b>: JA4 client fingerprints, bot scores, WAF rule sets (OWASP CRS), path/method allow-lists for the API.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.pipe, 450);
          rail(ctx, 0);
          var B = newBench(ctx);
          heading(ctx, B, 60, 176, 'ANYCAST · one prefix 203.0.113.0/24 announced from every PoP');
          var map = ctx.group({ parent: B });
          ctx.rect(50, 190, 820, 480, { rx: 12, fill: 'rgba(8,16,32,0.6)', stroke: ctx.alpha('blue', 0.35), sw: 1, parent: map });
          for (var lo = -150; lo <= 150; lo += 30) { var a = proj(lo, 80), b = proj(lo, -60); ctx.line(a.x, 192, b.x, 668, { color: ctx.alpha('blue', 0.1), sw: 1, parent: map }); }
          for (var la = 60; la >= -40; la -= 20) { var c = proj(-180, la); ctx.line(52, c.y, 868, c.y, { color: ctx.alpha('blue', 0.1), sw: 1, parent: map }); }
          LAND.forEach(function (poly) { ctx.poly(poly.map(function (p) { var q = proj(p[0], p[1]); return [q.x, q.y]; }), { fill: ctx.alpha('blue', 0.1), stroke: ctx.alpha('blue', 0.35), parent: map }); });
          var pops = POPS.map(function (p) {
            var q = proj(p[1], p[2]);
            var g = ctx.group({ parent: map });
            ctx.circle(q.x, q.y, 9, { fill: ctx.alpha('cyan', 0.2), stroke: 'cyan', sw: 1.5, parent: g, glow: true });
            var lo2 = p[0] === 'LHR' ? [-12, -14, 'end'] : (p[0] === 'FRA' ? [12, -14, 'start'] : [0, -17, 'middle']);
            ctx.text(q.x + lo2[0], q.y + lo2[1], p[0], { size: 12, font: 'mono', color: 'cyan', anchor: lo2[2], weight: 600, parent: g });
            return { g: g, x: q.x, y: q.y, name: p[0], ring: g.firstChild };
          });
          var r = ctx.rng(42), clients = [];
          var centers = [[-100, 40, 6], [-75, 40, 5], [-47, -18, 4], [0, 51, 4], [12, 48, 6], [28, -20, 2], [77, 22, 5], [105, 8, 4], [135, 36, 4], [148, -30, 2]];
          centers.forEach(function (cc) {
            for (var k = 0; k < cc[2]; k++) clients.push(proj(cc[0] + (r() - 0.5) * 26, cc[1] + (r() - 0.5) * 16));
          });
          function nearest(p, skip) {
            var best = null, bd = 1e9;
            pops.forEach(function (q) { if (q.name === skip) return; var d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } });
            return best;
          }
          var cl = clients.map(function (p) {
            var n = nearest(p);
            var ln = ctx.line(p.x, p.y, n.x, n.y, { color: ctx.alpha('cyan', 0.6), sw: 1.2, parent: map });
            var dot = ctx.circle(p.x, p.y, 2.6, { fill: 'white', parent: map });
            return { p: p, n: n, ln: ln, dot: dot };
          });
          ctx.reveal(map, { from: 'fade' });
          ctx.reveal(cl.map(function (c) { return c.ln; }), { from: 'draw', stagger: 18, delay: 300, dur: 400 });
          var fra = pops[4];
          var wd = ctx.label(fra.x + 72, fra.y + 44, 'FRA: BGP withdraw', { color: 'red', textColor: 'white', bgAlpha: 0.55, size: 11, parent: map, opacity: 0 });

          /* DDoS particles */
          var bots = [];
          var rb = ctx.rng(9);
          for (var d = 0; d < 34; d++) {
            var src = proj(-170 + rb() * 340, -50 + rb() * 120);
            var tgt = nearest(src, 'FRA');
            bots.push({ s: src, t: tgt, ph: rb(), el: ctx.circle(src.x, src.y, 2.4, { fill: 'red', parent: map, opacity: 0 }) });
          }
          var ddosCap = ctx.text(460, 652, '', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: map });

          /* right: GeoDNS + scrub funnel */
          var dns = code(ctx, B, { x: 910, y: 190, w: 650, title: 'GeoDNS · steer to the tenant\'s home region', lang: 'text', size: 12, color: 'blue', lines: [
            '$ dig api.genesis.example +subnet=198.51.100.0/24',
            'api.genesis.example.   60 IN CNAME  eu.api.genesis.example.',
            'eu.api.genesis.example. 60 IN A      203.0.113.7   ; anycast',
            '; ECS lets DNS see the user\'s /24, not the resolver',
            '; TTL 60 s bounds DNS failover; anycast fails over in seconds'
          ] });
          var fn = ctx.group({ parent: B });
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
          ctx.reveal(dns, { from: 'right', delay: 300 });
          ctx.reveal(fbars, { from: 'down', stagger: 150, delay: 700 });
          var eq = ctx.para(60, 712, ['Attack split by BGP across N PoPs:  A_PoP ≈ A · w_i  (Σ w_i = 1)', 'SYN cookies: no per-connection state until the handshake completes', 'Anycast failover = route withdrawal (seconds), not DNS TTL expiry + resolver caching'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: B });
          ctx.reveal(eq, { from: 'up', delay: 900 });
          ctx.hud('same IP everywhere · nearest PoP by BGP');

          var t0 = null;
          S.ddos = ctx.loop(function (t) {
            if (t0 === null) t0 = t;
            var tt = (t - t0) * Math.min(ctx.speed, 4);
            var on = tt > 3.5;
            bots.forEach(function (b) {
              if (!on) { b.el.setAttribute('opacity', 0); return; }
              var f = ((tt * 0.45) + b.ph) % 1;
              b.el.setAttribute('cx', b.s.x + (b.t.x - b.s.x) * f);
              b.el.setAttribute('cy', b.s.y + (b.t.y - b.s.y) * f);
              b.el.setAttribute('opacity', (0.9 * Math.sin(f * Math.PI)).toFixed(2));
            });
            ddosCap.textContent = on ? 'flood lands on 9 PoPs — each absorbs a slice, scrubs locally' : '';
            pops.forEach(function (p) { if (p.name !== 'FRA') p.ring.setAttribute('stroke-width', on ? 1.5 + Math.abs(Math.sin(tt * 3 + p.x)) * 2 : 1.5); });
          });
          return ctx.wait(1600).then(function () {
            fra.ring.setAttribute('stroke', ctx.color('red'));
            ctx.reveal(wd, { from: 'scale', dur: 350 });
            var moved = cl.filter(function (c) { return c.n === fra; });
            return Promise.all(moved.map(function (c) {
              var n2 = nearest(c.p, 'FRA');
              c.n = n2;
              return ctx.animate(c.ln, { x2: [fra.x, n2.x], y2: [fra.y, n2.y] }, 700, 'inOut').then(function () { c.ln.setAttribute('stroke', ctx.alpha('amber', 0.6)); });
            }));
          }).then(function () { return ctx.wait(1800); });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'L4: ECMP + Maglev',
        say: 'Inside the site, routers spread packets across a fleet of layer-four load balancers using equal-cost multipath hashing. Each balancer hashes the connection\'s five-tuple into a Maglev lookup table to choose a gateway host. Because every balancer builds the identical table from the same backend list, any of them can take any packet. And when a gateway host dies, the table is rebuilt with minimal disruption: the dead host\'s slots move, plus the odd extra slot, while connection tracking keeps live flows pinned where they are.',
        deep: '<p><b>ECMP</b>: routers hash the 5-tuple onto k next-hops (the L4 balancers). Adding or removing a balancer rehashes some flows — harmless, because every balancer computes the <i>same</i> backend choice.</p>' +
          '<p><b>Maglev table</b> (M prime, e.g. 65,537; here 13). Each backend i has a permutation of table slots:</p>' +
          '<div class="eq">offset<sub>i</sub> = h<sub>1</sub>(name<sub>i</sub>) mod M, &nbsp; skip<sub>i</sub> = h<sub>2</sub>(name<sub>i</sub>) mod (M−1) + 1<br>perm<sub>i</sub>[j] = (offset<sub>i</sub> + j·skip<sub>i</sub>) mod M</div>' +
          '<pre>while filled &lt; M:\n  for backend i (round-robin):\n    take next slot in perm[i] not yet taken\n    entry[slot] = i</pre>' +
          '<p>Properties: near-perfect balance (each backend owns ⌊M/N⌋ or ⌈M/N⌉ slots) and <b>near-minimal disruption</b> when the set changes. Minimal is not zero: a removed backend frees its slots, and because the fill order shifts, a few other slots can change too (here 1 of 13). The paper trades a little extra disruption for perfect balance. Lookup is <code>entry[hash(5-tuple) mod M]</code>: O(1) and cache-resident. The paper reports line-rate 10 Gb/s of small packets per machine with a kernel-bypass datapath; modern XDP/DPDK balancers (Katran, Unimog) sustain millions of packets per second per core.</p>' +
          '<p>A <b>connection-tracking</b> table pins established flows to their backend, so even the few remapped slots do not break live TCP/QUIC connections. Return traffic typically bypasses the balancer (<b>direct server return</b>), since responses (video segments!) are much larger than requests.</p>',
        run: function (ctx) {
          var S = ctx.state;
          stopLoops(ctx);
          rail(ctx, 1);
          var B = newBench(ctx);
          heading(ctx, B, 60, 176, 'L4 LOAD BALANCING · ECMP across balancers, Maglev hashing to gateway hosts');
          var router = ctx.node({ x: 120, y: 420, w: 150, h: 60, title: 'Edge router', sub: 'ECMP ×4', icon: 'net', color: 'blue', titleSize: 14, parent: B });
          var lbs = [0, 1, 2, 3].map(function (i) { return ctx.node({ x: 340, y: 285 + i * 90, w: 170, h: 52, title: 'l4lb-' + 'abcd'[i], sub: 'same table', icon: 'layers', color: 'blue', titleSize: 13, subSize: 11, parent: B }); });
          var ecmp = lbs.map(function (n) { return ctx.link(router, n, { color: ctx.alpha('blue', 0.7), parent: B }); });
          ctx.reveal([router].concat(lbs), { from: 'left', stagger: 90 });
          ctx.reveal(ecmp, { from: 'draw', stagger: 80, delay: 300 });
          var M = 13, params = [[3, 4], [0, 2], [7, 5], [10, 3], [5, 8]];
          var t1 = maglev([0, 1, 2, 3, 4], params, M);
          var t2 = maglev([0, 1, 2, 4], params, M);
          var tx = 530, cw = 54;
          ctx.text(tx, 262, 'Maglev lookup table  (M = 13 here · 65,537 in production)', { size: 13, font: 'mono', color: 'text', parent: B });
          var cells = [], ctext = [];
          for (var j = 0; j < M; j++) {
            ctx.text(tx + j * cw + 24, 286, String(j), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
            cells.push(ctx.rect(tx + j * cw, 298, 48, 44, { rx: 5, fill: 'rgba(255,255,255,0.03)', stroke: 'faint', sw: 1, parent: B }));
            ctext.push(ctx.text(tx + j * cw + 24, 320, '', { size: 12, font: 'mono', color: 'white', anchor: 'middle', weight: 600, parent: B }));
          }
          lbs.forEach(function (n) { ctx.line(n.box.r, n.box.cy, tx - 6, 320, { color: ctx.alpha('blue', 0.25), sw: 1, dash: '3 4', parent: B }); });
          var permT = params.map(function (p, i) {
            var row = []; for (var k = 0; k < 7; k++) row.push((p[0] + k * p[1]) % M);
            return ctx.text(tx, 382 + i * 26, 'gw-' + i + '  offset ' + p[0] + ', skip ' + p[1] + '  → perm: ' + row.join(' ') + ' …', { size: 12, font: 'mono', color: GW[i], parent: B });
          });
          ctx.reveal(permT, { from: 'left', stagger: 90, delay: 300 });
          var be = GW.map(function (c, i) { return ctx.node({ x: 1450, y: 250 + i * 92, w: 200, h: 56, title: 'gw-' + i, sub: 'L7 gateway pod', icon: 'server', color: c, titleSize: 14, parent: B }); });
          ctx.reveal(be, { from: 'right', stagger: 80, delay: 200 });
          var tup = ctx.label(tx, 552, '(198.51.100.23:51514 → 203.0.113.7:443, TCP)', { color: 'cyan', size: 12, anchor: 'start', parent: B, opacity: 0 });
          var hsh = ctx.text(tx, 586, 'hash(5-tuple) mod 13 = 7  →  entry[7]', { size: 13, font: 'mono', color: 'white', parent: B, opacity: 0 });
          var sel = ctx.rect(tx + 7 * cw - 4, 294, 56, 52, { rx: 7, stroke: 'white', sw: 2, parent: B, opacity: 0, glow: true });
          var owner = t1[7];
          var toBe = ctx.link({ x: tx + 7 * cw + 24, y: 342 }, be[owner], { color: GW[owner], to: 'l', parent: B, sw: 2.2 });
          toBe.setAttribute('opacity', 0);
          /* failure section */
          var fsec = ctx.group({ parent: B, opacity: 0 });
          ctx.text(tx, 640, 'gw-3 fails → rebuild with 4 backends:', { size: 13, font: 'mono', color: 'violet', parent: fsec });
          var cells2 = [], changed = 0;
          for (var q = 0; q < M; q++) {
            var ch = t2[q] !== t1[q];
            if (ch) changed++;
            cells2.push(ctx.rect(tx + q * cw, 658, 48, 40, { rx: 5, fill: ctx.alpha(GW[t2[q]], 0.55), stroke: ch ? 'white' : 'faint', sw: ch ? 2 : 1, parent: fsec }));
            ctx.text(tx + q * cw + 24, 678, String(t2[q]), { size: 12, font: 'mono', color: 'white', anchor: 'middle', weight: 600, parent: fsec });
          }
          var gw3 = t1.filter(function (v) { return v === 3; }).length;
          ctx.text(tx, 724, changed + ' of 13 slots changed · gw-3 owned ' + gw3 + ' · ' + (changed - gw3) + ' other slot(s) moved', { size: 13, font: 'mono', color: 'text', parent: fsec });
          ctx.text(tx, 752, 'conntrack pins live flows: even moved slots keep existing connections', { size: 12, font: 'mono', color: 'dim', parent: fsec });
          var cnt = [0, 0, 0, 0, 0]; t1.forEach(function (v) { cnt[v]++; });
          var bal = ctx.text(tx, 516, 'slots per backend: ' + cnt.join(' / ') + '  (⌊13/5⌋ = 2 or ⌈13/5⌉ = 3)', { size: 12, font: 'mono', color: 'dim', parent: B, opacity: 0 });
          ctx.hud('lookup = entry[hash mod M] · O(1) · minimal disruption');
          return ctx.wait(700).then(function () {
            /* fill table in population order */
            var order = [], next = [0, 0, 0, 0, 0], taken = {}, n = 0;
            var perm = params.map(function (p) { var rr = []; for (var k = 0; k < M; k++) rr.push((p[0] + k * p[1]) % M); return rr; });
            while (n < M) { for (var b = 0; b < 5 && n < M; b++) { var c = perm[b][next[b]]; while (taken[c]) { next[b]++; c = perm[b][next[b]]; } taken[c] = 1; next[b]++; n++; order.push([c, b]); } }
            return order.reduce(function (p, o) {
              return p.then(function () {
                cells[o[0]].setAttribute('fill', ctx.alpha(GW[o[1]], 0.55));
                cells[o[0]].setAttribute('stroke', GW[o[1]] ? ctx.color(GW[o[1]]) : 'none');
                ctext[o[0]].textContent = String(o[1]);
                return ctx.wait(130);
              });
            }, Promise.resolve());
          }).then(function () {
            ctx.reveal(bal, { dur: 300 });
            ctx.reveal(tup, { from: 'left', dur: 300 });
            return ctx.packet(ecmp[2], { color: 'cyan', dur: 500 });
          }).then(function () {
            ctx.reveal(hsh, { from: 'left', dur: 300 });
            ctx.reveal(sel, { dur: 300 });
            toBe.setAttribute('opacity', 1);
            return ctx.reveal(toBe, { from: 'draw', dur: 500 });
          }).then(function () {
            return ctx.packet(toBe, { color: GW[owner], dur: 600 });
          }).then(function () {
            be[3].setAttribute('opacity', 0.3);
            be[3].titleEl.textContent = 'gw-3 ✕';
            return ctx.reveal(fsec, { from: 'up', dur: 500 });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'L7 filter chain',
        say: 'The chosen gateway host runs a layer-seven proxy, like Envoy, as a chain of filters. TLS one point three terminates here, with a hybrid post-quantum key exchange. The HTTP codec decodes streams. The JWT filter verifies the token\'s signature against cached public keys. An authorization filter checks scopes and the tenant. The request body is validated against its schema and size limits. Only then does the router pick an upstream. Each filter can short-circuit with a precise error, and each one enriches the request for the next.',
        deep: '<p>An L7 proxy is a pipeline of <b>filters</b> over a decoded request; each may continue, mutate, or short-circuit with a response.</p>' +
          '<ul><li><b>TLS 1.3</b> termination: 1-RTT handshake, key share <code>X25519MLKEM768</code> (hybrid classical + ML-KEM, default in major browsers and CDNs since 2024–25), session tickets for resumption, certificates via ACME with short lifetimes.</li>' +
          '<li><b>JWT authn</b>: <code>kid</code> → cached JWKS key; ES256 verify ≈ tens of µs; check <code>iss, aud, exp, nbf</code>; unknown <code>kid</code> triggers a rate-limited JWKS refresh (key rotation without outages).</li>' +
          '<li><b>ext_authz</b>: policy engine (OPA / Cedar) decides <code>allow(sub, tenant, action, resource)</code>. The tenant comes from the verified token, never from the request body.</li>' +
          '<li><b>Validation</b>: max body 1 MB (media goes to object storage, not here), JSON-Schema / protobuf validation, reject unknown fields → <code>400</code>/<code>413</code>/<code>415</code>.</li>' +
          '<li><b>Router</b>: route by path + method + headers; per-route timeout, retry policy, and upstream cluster (gRPC over HTTP/2 with mTLS).</li></ul>' +
          '<p>The proxy injects <code>x-request-id</code> and W3C <code>traceparent</code> so every downstream span joins one trace.</p>',
        run: function (ctx) {
          var S = ctx.state;
          stopLoops(ctx);
          rail(ctx, 2);
          var B = newBench(ctx);
          heading(ctx, B, 60, 176, 'L7 GATEWAY (Envoy-style) · a chain of filters over each request');
          var F = [
            ['TLS 1.3', 'X25519MLKEM768', 'lock', 'pink'],
            ['HTTP codec', 'h2 · h3 streams', 'code', 'blue'],
            ['JWT authn', 'ES256 · JWKS cache', 'shield', 'pink'],
            ['ext_authz', 'scope · tenant', 'check', 'pink'],
            ['Validate', 'schema · 1 MB max', 'doc', 'blue'],
            ['Rate limit', 'local + global', 'clock', 'cyan'],
            ['Router', '→ jobs-api (gRPC)', 'net', 'blue']
          ];
          var fl = F.map(function (f, i) { return ctx.node({ x: 130 + i * 208, y: 280, w: 184, h: 78, title: f[0], sub: f[1], icon: f[3] ? f[2] : null, color: f[3], titleSize: 15, subSize: 11, parent: B }); });
          ctx.reveal(fl, { from: 'left', stagger: 100 });
          var links = [];
          for (var i = 0; i < 6; i++) links.push(ctx.link(fl[i], fl[i + 1], { color: 'blue', straight: true, parent: B }));
          ctx.reveal(links, { from: 'draw', stagger: 80, delay: 300 });
          var req = code(ctx, B, { x: 60, y: 400, w: 700, title: 'request as the upstream will see it', lang: 'text', size: 12, color: 'cyan', typing: true, maxLines: 8, lines: [] });
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
          var rej = ctx.group({ parent: B });
          heading(ctx, rej, 800, 412, 'SHORT-CIRCUITS · each filter can answer on its own', 'red', { size: 13 });
          var R = [['TLS', 'no SNI / TLS < 1.2 / bad cert', 'handshake alert'], ['JWT', 'expired, bad sig, wrong aud', '401 + WWW-Authenticate'], ['authz', 'scope jobs:write missing', '403'], ['validate', 'body 12 MB · unknown field', '413 · 400'], ['rate limit', 'tenant over 10 rps', '429 + Retry-After']];
          R.forEach(function (r, k) {
            var y = 448 + k * 40;
            ctx.rect(800, y - 15, 760, 30, { rx: 6, fill: 'rgba(255,77,109,0.05)', stroke: ctx.alpha('red', 0.3), sw: 1, parent: rej });
            ctx.text(814, y, r[0], { size: 12, font: 'mono', color: 'pink', weight: 600, parent: rej });
            ctx.text(920, y, r[1], { size: 12, font: 'mono', color: 'text', parent: rej });
            ctx.text(1546, y, r[2], { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: rej });
          });
          ctx.reveal(rej, { from: 'right', delay: 500 });
          var notes = ctx.para(60, 700, ['JWKS cache: kid → public key; unknown kid ⇒ one rate-limited refresh (key rotation, no outage)', 'tenant is taken from the verified token, never from the JSON body', 'media never transits this proxy: bodies > 1 MB are rejected, uploads go to object storage'], { size: 13, font: 'mono', color: 'dim', lh: 24, parent: B });
          ctx.reveal(notes, { from: 'up', delay: 700 });
          /* routed to the right of the request panel (x ≤ 760) so it never crosses it */
          var bad = ctx.path('M' + fl[2].box.cx + ',' + fl[2].box.b + ' Q 785,335 797,486', { color: ctx.alpha('red', 0.7), sw: 1.5, dash: '4 4', arrow: true, parent: B });
          bad.setAttribute('opacity', 0);
          ctx.hud('7 filters · ~50–150 µs CPU per request');
          return ctx.wait(700).then(function () {
            return adds.reduce(function (p, a, k) {
              return p.then(function () {
                ctx.pulse(fl[a[0]], { color: fl[a[0]].color, dur: 420 });
                var hop = a[0] > 0 && (k === 0 || adds[k - 1][0] !== a[0]) ? ctx.packet(links[a[0] - 1], { color: 'lime', dur: 260, r: 4 }) : Promise.resolve();
                return hop.then(function () { return req.addLine(a[1]); });
              });
            }, Promise.resolve());
          }).then(function () {
            bad.setAttribute('opacity', 1);
            return ctx.packet(links[0], { color: 'amber', dur: 300, label: 'expired JWT' });
          }).then(function () {
            return ctx.packet(links[1], { color: 'amber', dur: 300 });
          }).then(function () {
            ctx.reveal(bad, { from: 'draw', dur: 400 });
            return ctx.packet(bad, { color: 'red', dur: 500, label: '401' });
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Token bucket under a flood',
        say: 'Here is rate limiting in motion. Each tenant owns a token bucket: it refills at a steady rate, ten tokens per second, and holds at most twenty. Every request must take a token to pass. Normal traffic sails through. When a burst of forty requests per second arrives, the bucket absorbs the first twenty, then drains, and the excess is shed immediately with 429 and a Retry-After header, instead of queueing up and timing out deeper in the system.',
        deep: '<p><b>Token bucket</b> (rate r, burst b): tokens refill continuously and a request of cost c passes iff enough tokens exist.</p>' +
          '<div class="eq">tokens ← min(b, tokens + r·Δt); &nbsp; allow ⇔ tokens ≥ c, then tokens −= c</div>' +
          '<p>Over any window of length T, admitted cost ≤ b + r·T. Here r = 10/s, b = 20: starting from a full bucket, a 1.6 s burst at 40/s (64 requests) admits ≈ 20 + 16 = 36 and sheds ≈ 28. Between bursts the 6/s background refills the bucket at only 10 − 6 = 4 tokens/s, so a burst arriving 3 s later finds ~12 tokens and sheds more.</p>' +
          '<table><tr><th>Algorithm</th><th>State/key</th><th>Behavior</th></tr>' +
          '<tr><td>Token bucket</td><td>tokens, t<sub>last</sub></td><td>bursts ≤ b, mean ≤ r</td></tr>' +
          '<tr><td>Leaky bucket (queue)</td><td>FIFO</td><td>smooth output at r; adds delay</td></tr>' +
          '<tr><td>GCRA</td><td>one timestamp (TAT)</td><td>≡ token bucket, O(1) atomic</td></tr>' +
          '<tr><td>Sliding-window counter</td><td>2 counters</td><td>approximate, cheap</td></tr></table>' +
          '<div class="eq">GCRA: T = 1/r, τ = (b−1)·T; &nbsp; allow ⇔ TAT − now ≤ τ; &nbsp; TAT ← max(TAT, now) + T</div>' +
          '<div class="eq">sliding window: est = c<sub>prev</sub>·(1 − f) + c<sub>cur</sub>, &nbsp; f = elapsed fraction of current window</div>' +
          '<p>Cost-weighted tokens let one limiter cover cheap GETs (c = 1) and expensive job creation (c ∝ estimated GPU-seconds).</p>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          stopLoops(ctx);
          rail(ctx, 3);
          var B = newBench(ctx);
          heading(ctx, B, 60, 176, 'TOKEN BUCKET · r = 10 tokens/s · b = 20 · cost = 1 per request');
          ctx.text(60, 300, 'clients', { size: 13, font: 'display', weight: 700, color: 'white', parent: B });
          ctx.text(60, 320, 'bursty: 6 → 40 req/s', { size: 12, font: 'mono', color: 'dim', parent: B });
          /* bucket */
          var bk = ctx.group({ parent: B });
          ctx.path('M560,200 L560,322 Q560,336 574,336 L706,336 Q720,336 720,322 L720,200', { color: 'cyan', sw: 2.4, parent: bk, glow: true });
          ctx.text(740, 214, 'bucket', { size: 13, font: 'display', weight: 700, color: 'cyan', parent: bk });
          ctx.text(740, 234, 'b = 20', { size: 12, font: 'mono', color: 'dim', parent: bk });
          ctx.text(640, 176, 'refill r = 10/s', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: bk });
          var toks = [];
          for (var k = 0; k < 20; k++) toks.push(ctx.circle(582 + (k % 5) * 29, 322 - Math.floor(k / 5) * 28, 10, { fill: 'amber', stroke: ctx.alpha('amber', 0.8), sw: 1, parent: bk }));
          var drop = ctx.circle(640, 188, 5, { fill: 'amber', parent: bk, opacity: 0 });
          ctx.line(640, 338, 640, 372, { color: ctx.alpha('cyan', 0.6), sw: 2, dash: '3 3', parent: bk });
          /* gate */
          ctx.rect(628, 376, 24, 180, { rx: 6, fill: ctx.alpha('cyan', 0.1), stroke: 'cyan', sw: 1.6, parent: bk });
          ctx.text(640, 572, 'gate: take 1 token', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: bk });
          /* outcomes */
          var up = ctx.node({ x: 1060, y: 466, w: 190, h: 60, title: 'L7 router', sub: 'admitted →', icon: 'net', color: 'lime', titleSize: 14, parent: B });
          var bin = ctx.group({ parent: B });
          ctx.rect(470, 740, 360, 60, { rx: 10, fill: 'rgba(255,77,109,0.08)', stroke: ctx.alpha('red', 0.7), sw: 1.4, parent: bin });
          ctx.text(650, 762, '429 Too Many Requests', { size: 14, font: 'mono', color: 'red', anchor: 'middle', weight: 600, parent: bin });
          ctx.text(650, 783, 'Retry-After: 1 · shed in ~50 µs', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: bin });
          var cnt = ctx.group({ parent: B });
          var cA = ctx.text(880, 250, 'admitted  0', { size: 16, font: 'mono', color: 'lime', weight: 600, parent: cnt });
          var cR = ctx.text(880, 280, 'shed      0', { size: 16, font: 'mono', color: 'red', weight: 600, parent: cnt });
          var cT = ctx.text(880, 310, 'tokens 20.0', { size: 16, font: 'mono', color: 'amber', weight: 600, parent: cnt });
          var cL = ctx.text(880, 340, 'offered 6 req/s', { size: 14, font: 'mono', color: 'dim', parent: cnt });
          /* sparkline of tokens */
          var sp = ctx.group({ parent: B });
          ctx.rect(880, 600, 260, 90, { rx: 6, fill: 'rgba(255,255,255,0.02)', stroke: 'faint', sw: 1, parent: sp });
          ctx.text(880, 590, 'tokens over last 8 s', { size: 11, font: 'mono', color: 'dim', parent: sp });
          var spark = ctx.path('M880,690', { color: 'amber', sw: 1.6, parent: sp });
          ctx.reveal([bk, up, bin, cnt, sp], { from: 'fade', stagger: 120 });
          /* algorithm cards */
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
          ctx.reveal(cg, { from: 'right', stagger: 120, delay: 300 });
          ctx.hud('r = 10/s · b = 20 · burst 40/s → excess shed with 429');

          /* simulation */
          var rng = ctx.rng(77);
          var pool = [];
          for (var p = 0; p < 48; p++) pool.push({ on: false, el: ctx.circle(0, 0, 5, { fill: 'cyan', parent: B, opacity: 0 }) });
          var sim = { tok: 20, acc: 0, t: 0, adm: 0, rej: 0, hist: [], last: null, dropT: 0 };
          S.flood = ctx.loop(function (t) {
            if (sim.last === null) sim.last = t;
            var dt = Math.min(0.08, (t - sim.last) * Math.min(ctx.speed, 3));
            sim.last = t;
            sim.t += dt;
            var burst = (sim.t % 4.6) > 2.4 && (sim.t % 4.6) < 4.0;
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
                if (d.y > 770) { d.on = false; d.el.setAttribute('opacity', 0); }
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
          return ctx.wait(6000);
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Distributed limits & GPU quotas',
        say: 'One bucket on one host is easy. Our gateway runs on dozens of hosts in many sites, so limits become distributed. The hybrid design keeps a fast local bucket on each host and reconciles with a global counter in Redis every hundred milliseconds, using an atomic Lua script. Request counts are the wrong currency for video, though. Before admitting the trailer, the gateway estimates its cost in GPU-seconds, checks the tenant\'s balance, and places a hold. When the job finishes, the actual usage is settled and the rest released.',
        deep: '<p><b>Local vs global</b>: a purely local limiter on N hosts admits up to N·r (each sees 1/N of traffic, unevenly). A purely global one costs a round trip per request (~0.3–1 ms) and makes Redis a hot spot. The <b>hybrid</b>: each host spends from a local lease and syncs deltas every Δ; worst-case overshoot ≈ N·r<sub>local</sub>·Δ.</p>' +
          '<p>GCRA in Redis is one key per tenant and one atomic script (no read-modify-write race):</p>' +
          '<pre>tat = max(GET k or now, now)\nnew = tat + c*T\nif new - now &gt; b*T: return RETRY(new-now-b*T)\nSET k new PX b*T\nreturn OK</pre>' +
          '<p><b>Cost-based admission</b>. Estimated GPU-seconds for the trailer:</p>' +
          '<div class="eq">Ĝ = Σ<sub>shots</sub> n<sub>gpu</sub> · t<sub>shot</sub> + G<sub>LLM</sub> + G<sub>enc</sub> + G<sub>post</sub> ≈ 6·8·95 + 760 + 100 ≈ 5.4·10<sup>3</sup> GPU-s</div>' +
          '<p>The estimate comes from a regression on (resolution, duration, steps, model) fitted to past jobs, plus a safety margin (×1.1). Admission places a <b>hold</b> (like a card authorization); completion <b>settles</b> the actual metered GPU-seconds; failure releases it. Concurrency caps (e.g. ≤ 2 running video jobs per tenant) and weighted fair share keep one studio from monopolizing the video pool.</p>',
        run: function (ctx) {
          var S = ctx.state;
          stopLoops(ctx);
          rail(ctx, 4);
          var B = newBench(ctx);
          heading(ctx, B, 60, 176, 'HYBRID LIMITER · local fast path + global reconcile');
          var gws = [0, 1, 2].map(function (i) { return ctx.node({ x: 150, y: 250 + i * 95, w: 190, h: 60, title: 'gateway-' + i, sub: 'local lease', icon: 'server', color: 'blue', titleSize: 14, parent: B }); });
          var lb = gws.map(function (g, i) {
            var bg = ctx.rect(262, g.box.cy - 20, 22, 40, { rx: 3, fill: 'rgba(255,255,255,0.03)', stroke: 'faint', sw: 1, parent: B });
            var f = ctx.rect(262, g.box.cy + 20 - 40 * [0.7, 0.4, 0.85][i], 22, 40 * [0.7, 0.4, 0.85][i], { rx: 3, fill: ctx.alpha('amber', 0.7), parent: B });
            return f;
          });
          var redis = ctx.node({ x: 590, y: 345, w: 220, h: 120, kind: 'cyl', title: 'Redis Cluster', sub: 'GCRA key per tenant', color: 'red', titleSize: 15, subSize: 11, parent: B });
          var sync = gws.map(function (g) { return ctx.link(g, redis, { color: ctx.alpha('amber', 0.8), from: 'r', to: 'l', parent: B, dash: '4 4' }); });
          ctx.reveal(gws.concat([redis]), { from: 'left', stagger: 100 });
          ctx.reveal(sync, { from: 'draw', stagger: 100, delay: 300 });
          var lua = code(ctx, B, { x: 60, y: 520, w: 700, title: 'gcra.lua · EVALSHA (atomic, one round trip)', lang: 'py', size: 12, color: 'red', lines: [
            'local now, T, c = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])',
            'local cap = tonumber(ARGV[4])          -- b * T  (burst window)',
            'local tat = math.max(tonumber(redis.call("GET", KEYS[1])) or now, now)',
            'local new = tat + c * T',
            'if new - now > cap then return {0, new - now - cap} end  -- retry-after',
            'redis.call("SET", KEYS[1], new, "PX", math.ceil(cap))',
            'return {1, 0}                         -- allowed'
          ] });
          ctx.reveal(lua, { from: 'up', delay: 400 });
          ctx.text(60, 760, 'overshoot bound ≈ N · r_local · Δ_sync   (N = 3, Δ = 100 ms)', { size: 13, font: 'mono', color: 'dim', parent: B });

          /* quotas */
          var q = ctx.group({ parent: B });
          heading(ctx, q, 830, 176, 'QUOTA IN GPU-SECONDS · estimate before admit', 'cyan');
          var rows = [['plan + agents (LLM)', 40], ['encode 3 sketches + memo', 20], ['6 shots × 8 GPUs × 95 s', 4560], ['1 critic re-render (budgeted)', 760], ['audio · edit · encode', 40]];
          var ebars = rows.map(function (r, i) {
            var y = 214 + i * 36;
            ctx.text(830, y + 9, r[0], { size: 12, font: 'mono', color: 'text', parent: q });
            ctx.rect(1100, y, 330, 18, { rx: 3, fill: 'rgba(255,255,255,0.03)', parent: q });
            var b = ctx.rect(1100, y, Math.max(2, r[1] / 4560 * 330), 18, { rx: 3, fill: ctx.alpha(i === 2 || i === 3 ? 'lime' : 'amber', 0.6), parent: q });
            ctx.text(1560, y + 9, r[1].toLocaleString('en-US'), { size: 12, font: 'mono', color: 'white', anchor: 'end', parent: q });
            return b;
          });
          ctx.line(830, 398, 1560, 398, { color: 'line', parent: q });
          ctx.text(830, 416, 'estimate Ĝ × 1.1 safety margin', { size: 13, font: 'mono', color: 'cyan', parent: q });
          var tot = ctx.text(1560, 416, '0 GPU-s', { size: 15, font: 'mono', color: 'cyan', anchor: 'end', weight: 700, parent: q });
          /* ledger */
          ctx.text(830, 462, 'tenant studio-42 · monthly balance 20,000 GPU-s', { size: 13, font: 'mono', color: 'text', parent: q });
          var L0 = 830, LW = 730, sc = LW / 20000;
          ctx.rect(L0, 478, LW, 30, { rx: 6, fill: 'rgba(255,255,255,0.03)', stroke: 'faint', sw: 1, parent: q });
          ctx.rect(L0, 478, 8200 * sc, 30, { rx: 6, fill: ctx.alpha('dim', 0.45), parent: q });
          ctx.text(L0 + 8200 * sc / 2, 493, 'used 8,200', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: q });
          var hold = ctx.rect(L0 + 8200 * sc, 478, 0, 30, { rx: 0, fill: ctx.alpha('amber', 0.55), stroke: 'amber', sw: 1, parent: q });
          var holdT = ctx.text(L0 + (8200 + 2980) * sc, 493, '', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: q });
          var avail = ctx.text(L0 + LW - 8, 526, 'available 11,800', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: q });
          var steps = code(ctx, q, { x: 830, y: 552, w: 730, title: 'admission(job)', lang: 'py', size: 12, color: 'cyan', lines: [
            'est = estimate(job) * 1.1                  # 5,960 GPU-s',
            'if tenant.available < est: return 429 quota_exceeded',
            'if tenant.running_video_jobs >= 2: enqueue(fair_share)',
            'hold(tenant, est)          # like a card authorization',
            'on finish: settle(actual=5,120); release(est - actual)'
          ] });
          ctx.reveal(q, { from: 'right', delay: 300 });
          ctx.reveal(ebars, { from: 'left', stagger: 90, delay: 600 });
          ctx.hud('currency = GPU-seconds, not requests');
          var syncP = ctx.wait(800).then(function () {
            return Promise.all(sync.map(function (s, i) { return ctx.wait(i * 150).then(function () { return ctx.packet(s, { color: 'amber', dur: 600, label: 'Δ=' + [37, 12, 51][i] }); }); }));
          }).then(function () {
            return ctx.tween(500, function (e) { lb.forEach(function (f, i) { var v = [0.7, 0.4, 0.85][i] + (0.55 - [0.7, 0.4, 0.85][i]) * e; f.setAttribute('height', 40 * v); f.setAttribute('y', gws[i].box.cy + 20 - 40 * v); }); });
          });
          var qP = ctx.wait(1200).then(function () {
            return ctx.counter(tot, 0, 5960, 1000, function (v) { return Math.round(v).toLocaleString('en-US') + ' GPU-s'; });
          }).then(function () {
            holdT.textContent = 'hold 5,960';
            return ctx.tween(900, function (e) { hold.setAttribute('width', 5960 * sc * e); holdT.setAttribute('x', L0 + (8200 + 5960 * e / 2) * sc); avail.textContent = 'available ' + Math.round(11800 - 5960 * e).toLocaleString('en-US'); }, 'out');
          }).then(function () { return ctx.wait(900); }).then(function () {
            holdT.textContent = 'settled 5,120';
            return ctx.tween(700, function (e) { hold.setAttribute('width', (5960 - 840 * e) * sc); holdT.setAttribute('x', L0 + (8200 + (5960 - 840 * e) / 2) * sc); avail.textContent = 'available ' + Math.round(5840 + 840 * e).toLocaleString('en-US') + ' (840 released)'; });
          });
          return Promise.all([syncP, qP]);
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Admission & load shedding',
        say: 'Rate limits protect against one noisy tenant. Load shedding protects the whole system when everyone arrives at once. Requests wait in priority queues: interactive paid work first, then standard, then free batch jobs. The shedder watches queueing delay, not queue length. When a request has already waited longer than its class can tolerate, it is rejected right away. That keeps goodput flat at capacity instead of collapsing, because the server never burns effort on requests whose clients have already given up.',
        deep: '<p><b>Why shed</b>: past saturation, queues grow without bound; latency exceeds client timeouts; servers do work nobody waits for → <b>goodput collapse</b>. Rejecting early keeps useful throughput near capacity μ.</p>' +
          '<p><b>Signal = sojourn time</b>, not queue length (length is meaningless when service times vary 1000× between a status GET and a trailer submit). CoDel logic per class:</p>' +
          '<pre>if min_sojourn(INTERVAL) &gt; TARGET:\n    drop head; count += 1\n    next = now + INTERVAL/√count\nelse: count = 0</pre>' +
          '<p>(RFC 8289 defaults for packets: TARGET 5 ms, INTERVAL 100 ms; for API admission use e.g. 50 ms / 500 ms, per priority.) Serve newest-first (adaptive LIFO) under overload: the oldest requests are the likeliest to be abandoned.</p>' +
          '<p><b>Adaptive concurrency</b> (Little: L = λ·W): estimate the concurrency limit from latency gradients,</p>' +
          '<div class="eq">limit ← limit · RTT<sub>noload</sub> / RTT<sub>sample</sub> + √limit</div>' +
          '<p>Responses: <code>429</code> for “you” (tenant limit), <code>503</code> for “us” (overload), both with <code>Retry-After</code>; draft <code>RateLimit</code> / <code>RateLimit-Policy</code> headers expose remaining quota so well-behaved clients self-throttle.</p>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          stopLoops(ctx);
          rail(ctx, 5);
          var B = newBench(ctx);
          heading(ctx, B, 60, 176, 'PRIORITY QUEUES + DELAY-BASED SHEDDING · capacity μ = 12 req/s');
          var cls = [['P0 interactive · paid', 'cyan', 5, 9.9], ['P1 standard', 'blue', 9, 1.5], ['P2 batch · free', 'violet', 8, 1.0]];
          var laneY = [270, 370, 470];
          var srv = ctx.node({ x: 720, y: 370, w: 150, h: 90, title: 'Scheduler', sub: 'μ = 12/s', icon: 'gpu', color: 'red', titleSize: 14, parent: B });
          var soj = [];
          cls.forEach(function (c, i) {
            ctx.label(60, laneY[i] - 34, c[0], { color: c[1], size: 12, anchor: 'start', parent: B });
            ctx.rect(250, laneY[i] - 16, 390, 32, { rx: 8, fill: ctx.alpha(c[1], 0.05), stroke: ctx.alpha(c[1], 0.4), sw: 1, parent: B });
            ctx.line(642, laneY[i], 643, laneY[i], { color: c[1], parent: B });
            ctx.link({ x: 642, y: laneY[i] }, srv, { color: ctx.alpha(c[1], 0.6), to: 'l', parent: B });
            ctx.text(60, laneY[i] + 2, 'target ' + (c[3] > 5 ? 'none (never shed)' : c[3] + ' s'), { size: 12, font: 'mono', color: 'dim', parent: B });
            soj.push(ctx.text(60, laneY[i] + 22, '', { size: 12, font: 'mono', color: c[1], parent: B }));
          });
          var shedBin = ctx.group({ parent: B });
          ctx.rect(250, 540, 390, 40, { rx: 8, fill: 'rgba(255,77,109,0.08)', stroke: ctx.alpha('red', 0.6), sw: 1.2, parent: shedBin });
          var shedT = ctx.text(445, 560, 'shed: 503 + Retry-After', { size: 13, font: 'mono', color: 'red', anchor: 'middle', parent: shedBin });
          var srvT = ctx.text(720, 440, 'served 0', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: B });
          ctx.reveal(srv, { from: 'scale' });

          /* goodput plot */
          var gp = ctx.group({ parent: B });
          heading(ctx, gp, 880, 176, 'GOODPUT vs OFFERED LOAD', 'lime', { size: 14 });
          var p1 = ctx.plot(900, 210, 640, 300, function (x) { return x < 1 ? x : Math.max(0.02, 1 - 1.35 * (x - 1) * (x - 1) - 0.35 * (x - 1)); }, { xDomain: [0, 2], yDomain: [0, 1.1], color: 'red', sw: 2.4, yLabel: 'goodput / capacity', parent: gp });
          ctx.text(1540, 548, 'offered load / capacity', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: gp });
          var p2 = ctx.plot(900, 210, 640, 300, function (x) { return x < 1 ? x : 0.96; }, { xDomain: [0, 2], yDomain: [0, 1.1], color: 'lime', sw: 2.4, axes: false, parent: gp });
          var cap = p1.toPx(1, 1);
          ctx.line(cap.x, 210, cap.x, 510, { color: 'faint', dash: '3 4', parent: gp });
          ctx.text(cap.x + 6, 222, 'μ', { size: 13, font: 'mono', color: 'dim', parent: gp });
          ctx.text(920, 236, '— with delay-based shedding', { size: 12, font: 'mono', color: 'lime', parent: gp });
          ctx.text(920, 258, '— no shedding: goodput collapse', { size: 12, font: 'mono', color: 'red', parent: gp });
          ['0', '0.5', '1', '1.5', '2'].forEach(function (s, i) { ctx.text(900 + i * 160, 526, s, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: gp }); });
          ctx.reveal(gp, { from: 'right' });
          p1.curve.setAttribute('opacity', 0); p2.curve.setAttribute('opacity', 0);

          var resp = code(ctx, B, { x: 60, y: 620, w: 700, title: 'overload response', lang: 'text', size: 12, color: 'red', lines: [
            'HTTP/2 503 Service Unavailable',
            'retry-after: 7',
            'ratelimit-policy: "video";q=2;w=3600',
            'ratelimit: "video";r=0;t=7',
            '{"error": "overloaded", "class": "P2", "queued_ms": 612}'
          ] });
          var codel = ctx.para(830, 640, ['CoDel per class: drop head if min sojourn > TARGET for INTERVAL', 'next drop at INTERVAL / √count  → gentle, then firm', 'adaptive LIFO under overload: serve newest first', 'concurrency limit ← limit · RTT_noload / RTT_sample + √limit'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: B });
          ctx.reveal([resp, codel], { from: 'up', stagger: 150, delay: 400 });
          ctx.hud('shed by waiting time, not queue length');

          var rng = ctx.rng(5);
          var pool = [];
          for (var p = 0; p < 54; p++) pool.push({ on: false, el: ctx.rect(0, 0, 14, 14, { rx: 3, fill: 'cyan', parent: B, opacity: 0 }) });
          var Q = [[], [], []], sim = { t: 0, last: null, acc: [0, 0, 0], served: 0, shed: 0, svc: 0, fall: [] };
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
            [1, 2].forEach(function (i) {
              while (Q[i].length && sim.t - Q[i][0].born > cls[i][3]) {
                var d = Q[i].shift(); d.el.setAttribute('fill', C.red); d.fy = laneY[i]; d.fx = 620 - 0; d.vy = 0; sim.fall.push(d); sim.shed++;
              }
            });
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
            shedT.textContent = 'shed ' + sim.shed + ' · 503 + Retry-After';
          });
          return ctx.wait(900).then(function () {
            p1.curve.setAttribute('opacity', 1); p2.curve.setAttribute('opacity', 1);
            return Promise.all([ctx.reveal(p1.curve, { from: 'draw', dur: 1600 }), ctx.reveal(p2.curve, { from: 'draw', dur: 1600, delay: 500 })]);
          }).then(function () { return ctx.wait(3000); });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Retries, breakers & hedging',
        say: 'Failures deeper in the system must not echo back as storms. Retries use exponential backoff with full jitter, so thousands of clients do not retry in lockstep. A retry budget caps retries at about ten percent of traffic, because three layers each retrying three times would multiply load twenty-seven fold. Circuit breakers stop calling a failing dependency and probe it gently before trusting it again. And for idempotent reads, hedged requests send a backup copy after the ninety-fifth percentile latency, cutting the tail.',
        deep: '<p><b>Backoff with full jitter</b> (Brooker, AWS):</p>' +
          '<div class="eq">sleep<sub>n</sub> = U(0, min(cap, base · 2<sup>n</sup>))</div>' +
          '<p>Jitter de-correlates clients; without it, synchronized retries arrive as waves exactly when the dependency is weakest.</p>' +
          '<p><b>Retry amplification</b>: with k layers each doing r attempts, worst-case load multiplies by r<sup>k</sup> (3 layers × 3 attempts = 27×). Fix: retry at one layer only, and enforce a <b>retry budget</b> (e.g. retries ≤ 10 % of requests per client/cluster; Envoy <code>retry_budget</code>, gRPC retry throttling).</p>' +
          '<p><b>Circuit breaker</b>: CLOSED → OPEN when the error rate over a sliding window exceeds a threshold (e.g. 50 % of ≥ 20 calls); OPEN fails fast for a cool-down (e.g. 30 s); HALF-OPEN lets a few probes through; success → CLOSED. Envoy also caps concurrent requests / pending requests per upstream cluster, and outlier detection ejects bad hosts.</p>' +
          '<p><b>Hedged requests</b> (Dean &amp; Barroso): send a second copy if no reply after the p95 latency, which caps the extra load at about 5 %; cancel the loser when one replies. In their BigTable benchmark (1,000 keys spread over 100 servers), hedging after 10 ms cut the 99.9th-percentile latency from 1,800 ms to 74 ms for only 2 % more requests. Only for idempotent, cancellable operations (status reads, cache fetches); never <code>POST /v1/jobs</code> without its idempotency key.</p>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          stopLoops(ctx);
          rail(ctx, 6);
          var B = newBench(ctx);
          /* circuit breaker */
          var cb = ctx.group({ parent: B });
          heading(ctx, cb, 60, 176, 'CIRCUIT BREAKER', 'amber', { size: 14 });
          var st = {
            closed: ctx.node({ x: 130, y: 290, w: 140, h: 54, title: 'CLOSED', sub: 'calls flow', color: 'lime', kind: 'pill', titleSize: 14, parent: cb }),
            open: ctx.node({ x: 450, y: 290, w: 140, h: 54, title: 'OPEN', sub: 'fail fast', color: 'red', kind: 'pill', titleSize: 14, parent: cb }),
            half: ctx.node({ x: 290, y: 470, w: 160, h: 54, title: 'HALF-OPEN', sub: 'few probes', color: 'amber', kind: 'pill', titleSize: 14, parent: cb })
          };
          ctx.link(st.closed, st.open, { color: 'red', from: 'r', to: 'l', parent: cb, straight: true, label: 'errors > 50 % of 20', labelDy: -18 });
          ctx.link(st.open, st.half, { color: 'amber', from: 'b', to: 'r', parent: cb, label: 'after 30 s', labelDx: 44, labelDy: 6 });
          ctx.link(st.half, st.closed, { color: 'lime', from: 'l', to: 'b', parent: cb, label: 'probes ok', labelDx: -44, labelDy: 6 });
          ctx.link(st.half, st.open, { color: 'red', from: 't', to: 'b', parent: cb, dash: '4 4', curve: 0.2, label: 'probe fails', labelDx: -64, labelDy: 0 });
          var tok = ctx.circle(st.closed.box.cx, st.closed.box.cy - 40, 7, { fill: 'white', parent: cb, glow: true });
          ctx.reveal(cb, { from: 'left' });

          /* backoff + jitter */
          var bj = ctx.group({ parent: B });
          heading(ctx, bj, 600, 176, 'BACKOFF WITH FULL JITTER', 'cyan', { size: 14 });
          ctx.text(600, 204, 'sleep_n = U(0, min(cap, base·2^n)) · base 100 ms · cap 3.2 s', { size: 12, font: 'mono', color: 'dim', parent: bj });
          var rj = ctx.rng(12);
          var X0 = 620, XW = 440, T = 7;
          function tx(s) { return X0 + s / T * XW; }
          ctx.line(X0, 330, X0 + XW, 330, { color: 'faint', parent: bj });
          ctx.line(X0, 470, X0 + XW, 470, { color: 'faint', parent: bj });
          [0, 1, 2, 3, 4, 5, 6, 7].forEach(function (s) { ctx.text(tx(s), 486, s + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: bj }); });
          ctx.text(X0, 238, 'no jitter: 30 clients retry in lockstep', { size: 12, font: 'mono', color: 'red', parent: bj });
          ctx.text(X0, 368, 'full jitter: the same retries, spread out', { size: 12, font: 'mono', color: 'lime', parent: bj });
          var dotsA = [], dotsB = [];
          for (var c = 0; c < 30; c++) {
            var ta = 0, tb = 0;
            for (var n = 0; n < 4; n++) {
              var capn = Math.min(3.2, 0.1 * Math.pow(2, n + 1));
              ta += capn; tb += rj() * capn + 0.05;
              if (ta < T) dotsA.push(ctx.circle(tx(ta), 322 - (c % 10) * 7, 2.6, { fill: 'red', parent: bj, opacity: 0 }));
              if (tb < T) dotsB.push(ctx.circle(tx(tb), 462 - (c % 10) * 7, 2.6, { fill: 'lime', parent: bj, opacity: 0 }));
            }
          }

          /* hedging */
          var hg = ctx.group({ parent: B });
          heading(ctx, hg, 1110, 176, 'HEDGED REQUESTS (idempotent reads)', 'violet', { size: 14 });
          /* lognormal(μ = ln 40 ms, σ = 0.55) body + a slow-replica tail bump, on a log10 latency axis */
          var ph = ctx.plot(1120, 220, 430, 220, function (u) { var z = (u * Math.LN10 - Math.log(40)) / 0.55; return Math.exp(-z * z / 2) + 0.09 * Math.exp(-Math.pow((u - 2.6) / 0.07, 2) / 2); }, { xDomain: [1, 3], yDomain: [0, 1.15], color: 'violet', sw: 2, yLabel: 'density', samples: 160, parent: hg });
          [[1, '10'], [1.477, '30'], [2, '100'], [2.477, '300'], [3, '1000 ms']].forEach(function (tk) { ctx.text(ph.toPx(tk[0], 0).x, 456, tk[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: hg }); });
          var p95 = ph.toPx(Math.log10(99), 0);
          ctx.line(p95.x, 220, p95.x, 440, { color: 'amber', dash: '4 3', parent: hg });
          ctx.text(p95.x + 6, 232, 'p95 ≈ 100 ms: send backup', { size: 12, font: 'mono', color: 'amber', parent: hg });
          var tail = ctx.text(ph.toPx(2.6, 0).x, 400, 'slow tail', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: hg });
          var cut = ctx.rect(p95.x + 40, 250, 1550 - p95.x - 40, 188, { rx: 4, fill: 'rgba(5,8,15,0.8)', parent: hg, opacity: 0 });
          var hres = ctx.text(1335, 484, 'BigTable: p99.9 1,800 → 74 ms, +2 % requests (hedge @ 10 ms)', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: hg, opacity: 0 });
          ctx.reveal([bj, hg], { from: 'up', stagger: 150 });

          /* retry amplification */
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
          ctx.reveal([am, fix], { from: 'up', stagger: 200, delay: 400 });
          ctx.hud('backoff + jitter · budgets · breakers · hedges');

          var order = ['closed', 'open', 'half', 'closed'];
          var tk = 0, t0 = null;
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
          return ctx.wait(600).then(function () {
            return Promise.all([ctx.reveal(dotsA, { from: 'scale', stagger: 6, dur: 250 }), ctx.reveal(dotsB, { from: 'scale', stagger: 6, dur: 250, delay: 300 })]);
          }).then(function () {
            ctx.reveal(cut, { dur: 500 });
            tail.setAttribute('fill', C.dim);
            return ctx.reveal(hres, { from: 'up', dur: 400 });
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Regions & service mesh',
        say: 'Finally, the admitted request crosses into the service mesh. We run active-active in several regions. Each region has its own gateways, job services, orchestrators and GPU pools, and every tenant has a home region for data residency, with failover to a peer. Inside, services speak gRPC with protocol buffers over mutual TLS: every workload carries a short-lived cryptographic identity, and authorization is by identity, not by IP address. The job has passed every door. Next stop: the orchestration plane.',
        deep: '<p><b>Active-active</b>: every region serves traffic; GeoDNS + anycast steer users; each tenant has a <b>home region</b> (data residency, GDPR) where its job records live. Job metadata replicates asynchronously (RPO ≈ seconds) or via a multi-region consensus store when strict. Object storage uses cross-region replication for media. GPU pools are regional and scheduled locally; model weights (tens to hundreds of GB) are pre-staged in every region, while a shot\'s checkpointed latent is only ~10–100 MB, so a peer region can resume a render instead of restarting it.</p>' +
          '<p><b>Failover</b>: health-checked withdrawal at the edge; the peer region rebuilds in-flight workflows from the replicated durable event history (see the durable-execution chamber). Capacity planning must keep N+1 headroom, or failover itself becomes the overload.</p>' +
          '<p><b>Internal RPC</b>: gRPC over HTTP/2 with protobuf — schema-first, ~3–10× smaller and faster to parse than JSON, native deadlines (propagated as <code>grpc-timeout</code>), cancellation and server streaming (<code>Watch</code> job events).</p>' +
          '<p><b>mTLS mesh</b>: each workload gets a SPIFFE ID (<code>spiffe://genesis/ns/prod/sa/jobs-api</code>) in a short-lived X.509 SVID (SPIRE default 1 h, Istio 24 h), rotated automatically by the mesh; sidecars or ambient ztunnels enforce policy such as “only <code>gateway</code> may call <code>jobs.Create</code>”. Zero trust: the network location of a caller proves nothing.</p>',
        run: function (ctx) {
          var S = ctx.state;
          stopLoops(ctx);
          rail(ctx, 7);
          var B = newBench(ctx);
          heading(ctx, B, 60, 176, 'ACTIVE-ACTIVE REGIONS · gRPC + protobuf over an mTLS mesh');
          var edge = ctx.node({ x: 800, y: 222, w: 330, h: 54, title: 'Anycast edge + GeoDNS', sub: 'tenant → home region', icon: 'globe', color: 'blue', titleSize: 14, parent: B });
          var regs = [['us-east', 60], ['eu-west', 840]].map(function (r, ri) {
            var g = ctx.group({ parent: B });
            var x0 = r[1];
            ctx.rect(x0, 290, 700, 330, { rx: 16, fill: 'rgba(77,141,255,0.04)', stroke: ctx.alpha('blue', 0.55), sw: 1.4, dash: '6 5', parent: g });
            ctx.text(x0 + 20, 602, 'REGION ' + r[0] + (ri === 1 ? '  ·  home of studio-42' : ''), { size: 13, font: 'display', weight: 700, color: ri === 1 ? 'cyan' : 'blue', parent: g });
            var n1 = ctx.node({ x: x0 + 120, y: 390, w: 180, h: 54, title: 'L7 gateway', icon: 'shield', color: 'blue', titleSize: 13, parent: g });
            var n2 = ctx.node({ x: x0 + 350, y: 390, w: 180, h: 54, title: 'jobs-api', icon: 'server', color: 'blue', titleSize: 13, parent: g });
            var n3 = ctx.node({ x: x0 + 580, y: 390, w: 180, h: 54, title: 'orchestrator', icon: 'gear', color: 'magenta', titleSize: 13, parent: g });
            var n4 = ctx.node({ x: x0 + 350, y: 540, w: 260, h: 60, title: 'GPU pools', sub: 'LLM · video · encoders', icon: 'gpu', color: 'red', titleSize: 13, parent: g });
            var l1 = ctx.link(n1, n2, { color: 'lime', parent: g, straight: true });
            var l2 = ctx.link(n2, n3, { color: 'lime', parent: g, straight: true });
            var l3 = ctx.link(n3, n4, { color: 'lime', parent: g, from: 'b', to: 'r' });
            [[x0 + 235, 378], [x0 + 465, 378]].forEach(function (p) { ctx.icon('lock', p[0], p[1] - 4, 14, 'lime', { parent: g }); });
            ctx.text(x0 + 235, 422, 'mTLS', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: g });
            ctx.text(x0 + 465, 422, 'gRPC', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: g });
            return { g: g, n1: n1, n2: n2, n3: n3, n4: n4, links: [l1, l2, l3] };
          });
          ctx.reveal(edge, { from: 'down' });
          ctx.reveal(regs.map(function (r) { return r.g; }), { from: 'up', stagger: 200, delay: 200 });
          var e1 = ctx.link(edge, regs[0].n1, { color: 'blue', from: 'b', to: 't', parent: B, dash: '4 4', straight: true, label: 'failover', labelDx: 70, labelDy: -34 });
          var e2 = ctx.link(edge, regs[1].n1, { color: 'cyan', from: 'b', to: 't', parent: B, sw: 2.2, straight: true });
          var rep = ctx.path('M760,560 L840,560', { color: 'teal', sw: 2, dash: '5 4', parent: B });
          ctx.path('M840,575 L760,575', { color: 'teal', sw: 2, dash: '5 4', parent: B });
          ctx.text(800, 600, 'async', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: B });
          ctx.text(800, 540, 'replicate', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: B });
          ctx.reveal([e1, e2], { from: 'draw', stagger: 150, delay: 600 });
          var proto = code(ctx, B, { x: 60, y: 650, w: 700, title: 'jobs.proto', lang: 'js', size: 12, color: 'magenta', lines: [
            'service Jobs {',
            '  rpc Create(CreateJobRequest) returns (Job);   // idempotency_key',
            '  rpc Watch(WatchRequest) returns (stream JobEvent);',
            '}',
            'message CreateJobRequest { string idempotency_key = 1; Spec spec = 2; }'
          ] });
          var spf = ctx.para(840, 676, ['identity: spiffe://genesis/ns/prod/sa/jobs-api', 'X.509 SVID · ~1 h lifetime · auto-rotated', 'policy: only sa/gateway may call jobs.Create', 'deadline propagates: grpc-timeout 800m'], { size: 13, font: 'mono', color: 'text', lh: 25, parent: B });
          ctx.reveal([proto, spf], { from: 'up', stagger: 150, delay: 500 });
          var fin = ctx.text(800, 812, 'Microseconds of checks guard thousands of GPU-seconds. Next door: the orchestration plane.', { size: 16, font: 'display', weight: 600, color: 'text', anchor: 'middle', parent: B });
          ctx.reveal(fin, { from: 'up', delay: 1400 });
          ctx.hud('admitted → orchestration plane');
          return ctx.wait(1200).then(function () {
            return ctx.packet(e2, { color: 'cyan', dur: 700, label: 'job' });
          }).then(function () {
            var L = regs[1].links;
            return ctx.packet(L[0], { color: 'lime', dur: 450 }).then(function () { return ctx.packet(L[1], { color: 'lime', dur: 450 }); }).then(function () { return ctx.packet(L[2], { color: 'lime', dur: 600, label: 'render' }); });
          }).then(function () {
            ctx.packet(rep, { color: 'teal', dur: 700, reverse: true });
            return ctx.pulse(regs[1].n3, { color: 'magenta', times: 2, dur: 700 });
          });
        }
      }
    ]
  });
})();
