/* L1 — Client & Real-time Transport. What happens on the creator's device and on the wire:
 * preprocessing, resumable uploads, auth, async jobs, QUIC vs TCP, event streaming, progressive previews, ABR playback. */
(function () {
  var MODS = [
    ['comp', 'Composer', 'prompt · refs · @mentions', 'doc'],
    ['pick', 'Media Picker', '3 sketches · memo.m4a', 'image'],
    ['pre', 'Preprocess Worker', 'hash · thumb · EXIF · proxy', 'gear'],
    ['upl', 'Upload Manager', 'multipart · resume · retry', 'layers'],
    ['auth', 'Auth Session', 'OIDC + PKCE · JWT', 'lock'],
    ['evt', 'Event Stream Client', 'SSE · resume · backpressure', 'net'],
    ['store', 'State Store', 'jobs · uploads · events', 'db']
  ];

  /* ---------- helpers (private) ---------- */
  function newBench(ctx) {
    var S = ctx.state;
    if (S.bench) ctx.remove(S.bench, 350);
    S.bench = ctx.group();
    return S.bench;
  }

  function focusMod(ctx, key) {
    var S = ctx.state;
    Object.keys(S.mods).forEach(function (k) { ctx.fade(S.mods[k], (!key || k === key) ? 1 : 0.38, 450); });
    if (S.modHi) { ctx.remove(S.modHi, 200); S.modHi = null; }
    if (key) S.modHi = ctx.highlight(S.mods[key], { color: 'cyan', pad: 6, dash: '6 4' });
  }

  /* code panel inside a parent group, preserving leading whitespace (SVG collapses it by default) */
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
    return ctx.text(x, y, str, { size: o.size || 15, font: 'display', weight: 700, color: col || 'cyan', anchor: o.anchor, parent: g, spacing: 0.5 });
  }

  /* dot riding along a path (optionally only part of it); resolves with the end point */
  function ride(ctx, path, o) {
    o = o || {};
    if (ctx.instant) return Promise.resolve(null);
    var len = path.getTotalLength();
    var until = o.until === undefined ? 1 : o.until;
    var col = ctx.color(o.color || 'cyan');
    var g = ctx.group({ parent: o.parent || path.parentNode });
    ctx.circle(0, 0, 11, { fill: ctx.alpha(col, 0.18), parent: g });
    ctx.circle(0, 0, 5.5, { fill: col, parent: g, glow: true });
    if (o.label) ctx.text(0, -17, o.label, { size: 12, font: 'mono', color: col, anchor: 'middle', parent: g });
    var p0 = path.getPointAtLength(0);
    g.setAttribute('transform', 'translate(' + p0.x + ',' + p0.y + ')');
    return ctx.tween(o.dur || 1000, function (t) {
      var p = path.getPointAtLength(len * until * t);
      g.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
    }, o.ease || 'inOut').then(function () {
      var p = path.getPointAtLength(len * until);
      if (g.parentNode) g.parentNode.removeChild(g);
      return { x: p.x, y: p.y };
    });
  }

  /* horizontal sequence-diagram message */
  function msg(ctx, g, x1, x2, y, label, col, o) {
    o = o || {};
    var ln = ctx.path('M' + x1 + ',' + y + ' L' + x2 + ',' + y, { color: col, sw: 1.6, arrow: true, dash: o.dash, parent: g });
    var tx = ctx.text((o.lx === undefined ? (x1 + x2) / 2 : o.lx), y - 11, label, { size: 12, font: 'mono', color: col, anchor: 'middle', parent: g });
    return { ln: ln, tx: tx };
  }

  function playMsgs(ctx, list, per) {
    return list.reduce(function (p, m) {
      return p.then(function () {
        if (m.note) return ctx.reveal(m.note, { from: 'scale', dur: 350 });
        ctx.reveal(m.tx, { dur: 300 });
        return ctx.reveal(m.ln, { from: 'draw', dur: per || 380 }).then(function () {
          return ctx.packet(m.ln, { color: m.col || 'cyan', dur: 360, r: 4 });
        });
      });
    }, Promise.resolve());
  }

  /* procedural "ice moon crash" image, px in [0, 1.67], py in [0, 1] → [r,g,b] */
  function moonImg(px, py) {
    var c = [6 + 22 * py, 10 + 30 * py, 32 + 55 * py];
    var d = Math.hypot(px - 1.22, py - 0.3);
    if (d < 0.2) {
      var s = 1 - d / 0.2;
      c = [90 + 110 * s, 170 + 75 * s, 215 + 40 * s];
    } else {
      var k = Math.exp(-(d - 0.2) * 9) * 0.65;
      c = [c[0] + 40 * k, c[1] + 130 * k, c[2] + 170 * k];
    }
    if (py > 0.76 + 0.04 * Math.sin(px * 9)) c = [45 + 70 * (1 - py), 110 + 60 * (1 - py), 150 + 50 * (1 - py)];
    /* crash trail */
    var ax = 0.12, ay = 0.04, bx = 0.74, by = 0.6;
    var vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
    var dt = Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
    if (dt < 0.05) { var w = (1 - dt / 0.05) * (0.3 + 0.7 * t); c = [c[0] + (255 - c[0]) * w, c[1] + (150 - c[1]) * w, c[2] + (70 - c[2]) * w]; }
    /* fox + helmet */
    if (Math.pow((px - 0.8) / 0.1, 2) + Math.pow((py - 0.76) / 0.15, 2) < 1) c = [255, 138, 61];
    if (Math.hypot(px - 0.8, py - 0.56) < 0.085) c = [215, 235, 255];
    return c.map(function (v) { return Math.max(0, Math.min(255, v)); });
  }
  function rgb(a) { return 'rgb(' + Math.round(a[0]) + ',' + Math.round(a[1]) + ',' + Math.round(a[2]) + ')'; }

  /* HOL-blocking mini simulation. hs.L is the index of the lost packet (its stream is L % 3), shared by both panels.
   * Returns {update(t), plan(), hits(fn)}: hits() lays clickable lane strips over the panel. */
  var HOL_NAMES = ['events', 'upload', 'api'];
  function holPanel(ctx, g, x0, quic, hs) {
    var cols = ['cyan', 'teal', 'amber'];
    var laneY = [672, 700, 728];
    var pipeA = x0 + 40, pipeB = x0 + 290, bufX = x0 + 300, appX = x0 + 392;
    var N = 12, transit = 0.6, reSend = 1.8;
    var labs = [];
    if (quic) laneY.forEach(function (y, i) { ctx.rect(pipeA, y - 9, pipeB - pipeA, 18, { rx: 9, fill: ctx.alpha(cols[i], 0.06), stroke: ctx.alpha(cols[i], 0.45), sw: 1, parent: g }); });
    else ctx.rect(pipeA, 687, pipeB - pipeA, 26, { rx: 13, fill: 'rgba(77,141,255,0.06)', stroke: ctx.alpha('blue', 0.5), sw: 1, parent: g });
    ctx.rect(bufX - 4, 658, 86, 84, { rx: 6, fill: 'rgba(255,255,255,0.02)', stroke: 'faint', sw: 1, dash: '3 3', parent: g });
    ctx.text(bufX + 39, 752, 'recv buffer', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    HOL_NAMES.forEach(function (s, i) {
      ctx.line(appX - 4, laneY[i] + 8, appX + 44, laneY[i] + 8, { color: ctx.alpha(cols[i], 0.4), sw: 1, parent: g });
      labs.push(ctx.text(appX + 52, laneY[i], s, { size: 12, font: 'mono', color: cols[i], parent: g }));
    });
    ctx.text(appX + 20, 752, 'app', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    var P = [];
    for (var i = 0; i < N; i++) {
      P.push({ i: i, s: i % 3, send: i * 0.14, el: ctx.rect(0, 0, 9, 12, { rx: 2, fill: cols[i % 3], parent: g, opacity: 0 }) });
    }
    /* arrival and in-order delivery times: TCP orders across everything, QUIC per stream */
    function plan() {
      P.forEach(function (p) { p.arr = p.i === hs.L ? reSend + transit : p.send + transit; });
      P.forEach(function (p, k) {
        var d = p.arr;
        for (var j = 0; j < k; j++) if (!quic || P[j].s === p.s) d = Math.max(d, P[j].del);
        p.del = d;
      });
    }
    plan();
    var X = ctx.text((pipeA + pipeB) / 2 + 12, 700, '✕', { size: 17, weight: 700, color: 'red', anchor: 'middle', parent: g, opacity: 0 });
    function update(t) {
      var held = [], delivered = [[], [], []], L = hs.L;
      P.forEach(function (p) {
        var y = quic ? laneY[p.s] : 700, x, op = 1, stroke = null;
        if (t < p.send) { op = 0; x = pipeA; }
        else if (p.i === L && t < reSend) {
          var f = Math.min(1, (t - p.send) / transit);
          x = pipeA + (pipeB - pipeA) * f;
          op = f < 0.5 ? 1 : 0;
        } else if (t < p.arr) {
          var st = p.i === L ? reSend : p.send;
          x = pipeA + (pipeB - pipeA) * (t - st) / transit;
          if (p.i === L) stroke = ctx.color('red');
        } else if (t < p.del) { held.push(p); return; }
        else { delivered[p.s].push(p); return; }
        p.el.setAttribute('x', x - 4.5); p.el.setAttribute('y', y - 6);
        p.el.setAttribute('opacity', op);
        p.el.setAttribute('stroke', stroke || 'none');
      });
      held.forEach(function (p, k) {
        p.el.setAttribute('x', bufX + (k % 7) * 11); p.el.setAttribute('y', (quic ? laneY[p.s] : 700) - 6);
        p.el.setAttribute('opacity', 0.45); p.el.setAttribute('stroke', 'none');
      });
      delivered.forEach(function (arr, s) {
        arr.forEach(function (p, k) {
          p.el.setAttribute('x', appX + k * 11); p.el.setAttribute('y', laneY[s] - 6);
          p.el.setAttribute('opacity', 1); p.el.setAttribute('stroke', 'none');
        });
      });
      X.setAttribute('y', quic ? laneY[L % 3] : 700);
      X.setAttribute('opacity', t > P[L].send + transit * 0.5 ? 1 : 0);
      labs.forEach(function (lb, s) { lb.setAttribute('fill', ctx.color(s === L % 3 ? 'white' : cols[s])); lb.setAttribute('font-weight', s === L % 3 ? 700 : 400); });
    }
    /* transparent, clickable strips over the three lanes (drawn last so they sit on top) */
    function hits(fn) {
      laneY.forEach(function (y, i) {
        var r = ctx.rect(pipeA - 8, y - 13, appX + 96 - pipeA, 26, { rx: 6, fill: 'rgba(0,0,0,0.001)', parent: g });
        r.style.cursor = 'pointer';
        r.addEventListener('click', function () { fn(i); });
      });
    }
    return { update: update, plan: plan, hits: hits };
  }

  /* ABR simulation on a bandwidth trace (Mb/s). kind: 'tput' | 'bola' */
  var LADDER = [0.6, 1.2, 3.0, 6.0];
  function bwAt(t, tun) { return t < 16 ? 7.5 : (t < 34 ? tun : 5.0); }
  function simulate(kind, tun) {
    var seg = 2, Bmax = 20, t = 0, B = 0, stall = 0, hist = [];
    var rate = [], buf = [[0, 0]];
    var v = LADDER.map(function (r) { return Math.log(r / LADDER[0]); });
    var gp = 5, V = (Bmax / seg - 1) / (v[3] + gp);
    var guard = 0;
    while (t < 60 && guard++ < 200) {
      var q = 0;
      if (kind === 'tput') {
        var est = hist.length ? hist.length / hist.reduce(function (a, x) { return a + 1 / x; }, 0) : 1.0;
        for (var m = 0; m < 4; m++) if (LADDER[m] <= 0.85 * est) q = m;
      } else {
        var Q = B / seg, bs = -1e9;
        for (var m2 = 0; m2 < 4; m2++) {
          var sc = (V * (v[m2] + gp) - Q) / (LADDER[m2] * seg);
          if (sc > bs) { bs = sc; q = m2; }
        }
        if (bs <= 0) { var idle = Math.min(1, B - (V * gp) * seg * 0.999); t += Math.max(0.25, idle); B = Math.max(0, B - Math.max(0.25, idle)); buf.push([t, B]); continue; }
      }
      if (B > Bmax - seg) { var w = B - (Bmax - seg); t += w; B -= w; buf.push([t, B]); }
      var rem = LADDER[q] * seg, dl = 0, tt = t;
      while (rem > 1e-9) {
        var b = bwAt(tt, tun), edge = tt < 16 ? 16 : (tt < 34 ? 34 : 1e9), cap = b * (edge - tt);
        if (cap >= rem) { dl += rem / b; tt += rem / b; rem = 0; } else { rem -= cap; dl += edge - tt; tt = edge; }
      }
      rate.push([t, LADDER[q]]); rate.push([t + dl, LADDER[q]]);
      if (t > 0 && dl > B) stall += dl - B;
      B = Math.max(0, B - dl);
      t += dl; buf.push([t, B]);
      B += seg; buf.push([t, B]);
      hist.push(LADDER[q] * seg / dl); if (hist.length > 3) hist.shift();
    }
    buf = buf.filter(function (p) { return p[0] <= 60; });
    rate = rate.filter(function (p) { return p[0] <= 60; });
    return { rate: rate, buf: buf, stall: stall };
  }

  Atlas.register({
    id: 'client',
    refs: [
      'Iyengar &amp; Thomson, <i>RFC 9000: QUIC, a UDP-Based Multiplexed and Secure Transport</i>, IETF 2021; Bishop, <i>RFC 9114: HTTP/3</i>, 2022',
      'Rescorla, <i>RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3</i>, IETF 2018',
      'Sakimura et al., <i>RFC 7636: Proof Key for Code Exchange (PKCE)</i>, 2015; Lodderstedt et al., <i>RFC 9700: Best Current Practice for OAuth 2.0 Security</i>, IETF 2025',
      'Fett et al., <i>RFC 9449: OAuth 2.0 Demonstrating Proof of Possession (DPoP)</i>, IETF 2023',
      'WHATWG, <i>HTML Living Standard, §9.2 Server-sent events</i>; IETF, <i>The Idempotency-Key HTTP Header Field</i> (draft-ietf-httpapi-idempotency-key-header)',
      'Amazon Web Services, <i>Amazon S3 User Guide: multipart upload limits and additional checksums</i>, 2025; tus.io, <i>tus resumable upload protocol 1.0</i>; IETF, <i>Resumable Uploads for HTTP</i> (draft-ietf-httpbis-resumable-upload)',
      'Spiteri, Urgaonkar &amp; Sitaraman, <i>BOLA: Near-Optimal Bitrate Adaptation for Online Videos</i>, IEEE INFOCOM 2016',
      'Huang et al., <i>A Buffer-Based Approach to Rate Adaptation: Evidence from a Large Video Streaming Service</i>, ACM SIGCOMM 2014'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Client anatomy',
        beats: [
          {
            say: 'Zoom into the creator\'s device. The app is far more than a text box: on the surface it is a composer for the prompt and a media picker for the three sketches and the voice memo.',
            card: { tag: 'KEY IDEA', title: 'More than a text box', body: 'The client is a small <b>distributed-systems node</b>: it owns state, background work, retries and three independent network paths.' },
            deep: '<p>The visible surface is deliberately thin. The <b>composer</b> does not emit a flat string: it emits a structured document of text spans and typed references (<code>@sketch_03</code>, <code>@memo</code>) that the job request carries as content digests. The <b>media picker</b> reads from the file system, the camera roll or an in-browser recorder.</p>' +
              '<p>Everything that makes the product feel reliable happens in modules the user never sees. The next beat opens them up.</p>'
          },
          {
            say: 'Underneath sit the modules that make it reliable. A background worker preprocesses files, an upload manager moves the bytes, an auth session holds identity, an event stream client listens for progress, and a state store ties them together.',
            card: {
              tag: 'HOW IT WORKS', title: 'The state store is the spine',
              body: 'An event-sourced cache persisted to IndexedDB. The screen is a <i>projection</i> of server events, so a killed tab resumes exactly where it stopped.',
              more: '<p>The reducer is pure: <code>state′ = reduce(state, event)</code>. An optimistic UI change carries a client-generated correlation id; when the authoritative event with that id arrives it replaces the guess, and a rejection rolls it back.</p><p>With several tabs open, a Web Lock elects one leader to hold the event stream and fans events out over a BroadcastChannel, so N tabs never open N streams.</p>'
            },
            deep: '<p>The <b>state store</b> is a normalized, event-sourced cache with three tables: <code>jobs</code>, <code>uploads</code> and <code>events</code>. It is persisted to IndexedDB, so a closed tab or a killed mobile app resumes uploads and streams instead of restarting them.</p>' +
              '<p>Design rule: UI state is derived, never authored. The screen renders <code>project(events)</code>; whatever the user does is an <i>intent</i> sent to the server, and the answer comes back as an event.</p>' +
              '<div class="note">Optimistic updates are reconciled by event id, never by timing.</div>'
          },
          {
            say: 'Two kinds of traffic leave this device. Small authenticated commands go to the API gateway. Large resumable media uploads go straight to object storage, bypassing the API tier entirely.',
            card: { tag: 'NUMBERS', title: 'Bytes and commands never mix', stat: { v: '≈ 12,000×', l: 'more bytes in one 23.4 MiB sketch than in the 2.1 KB job request that references it' } },
            deep: '<p>The client owns independent network paths with different traffic shapes and failure semantics:</p>' +
              '<table><tr><th>Path</th><th>Carries</th><th>Recovery</th></tr>' +
              '<tr><td>Control</td><td>KB of JSON over HTTPS (h2 or h3) with an OIDC bearer token</td><td>idempotency keys, <code>202</code> + job id</td></tr>' +
              '<tr><td>Upload</td><td>MB to GB of media, pre-signed PUTs straight to object storage</td><td>per-part retry, resumable</td></tr></table>' +
              '<div class="note">Design rule: bulk bytes never transit the API tier. The API issues capabilities (pre-signed URLs, job ids); storage moves the data.</div>'
          },
          {
            say: 'A third path flows the other way: a long-lived stream of typed events carries progress, previews and errors back to the screen, and it can resume after any disconnect.',
            card: { tag: 'HOW IT WORKS', title: 'Push, not poll', body: 'One idle HTTP stream replaces thousands of polls. Typed events such as <code>shot.progress</code> arrive the moment they happen.' },
            deep: '<p>The third row of the path table:</p>' +
              '<table><tr><th>Path</th><th>Carries</th><th>Recovery</th></tr>' +
              '<tr><td>Feedback</td><td>~10<sup>2</sup>–10<sup>3</sup> small typed events per job, pushed over SSE (h2 or h3)</td><td><code>Last-Event-ID</code> replay</td></tr></table>' +
              '<p>The events are tiny but must never be lost: a missed <code>shot.done</code> leaves the UI stuck forever. That is why the stream is resumable by id instead of best effort.</p>'
          },
          {
            say: 'None of this needs native code. Workers and WebAssembly do the hashing, IndexedDB persists state, WebCodecs transcodes audio, fetch streams move bytes, EventSource listens, service workers sync, and Media Source Extensions play the film.',
            card: { tag: 'STATE OF THE ART', title: 'The browser is the runtime', body: 'Every module maps to a web platform API. WebAssembly and WebCodecs made serious client-side media work practical.' },
            deep: '<ul><li><b>Web Worker + WASM</b>: SHA-256 and EXIF rewriting off the UI thread.</li>' +
              '<li><b>IndexedDB</b>: durable state; call <code>navigator.storage.persist()</code> so the browser does not evict it under pressure.</li>' +
              '<li><b>WebCodecs</b>: direct access to the browser\'s own video and audio codecs (hardware-accelerated for video where the platform allows) without shipping a codec in WASM.</li>' +
              '<li><b>fetch + Streams</b>: streamed response bodies everywhere; streamed request bodies in Chromium over h2 or h3.</li>' +
              '<li><b>Service Worker sync</b>: Chromium only. iOS Safari lacks Background Sync, so uploads pause when the app is backgrounded and resume on foreground.</li>' +
              '<li><b>MSE</b>: the player pipeline of the last step.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.dev = ctx.group();
          ctx.rect(40, 165, 360, 675, { rx: 24, fill: 'rgba(7,14,28,0.88)', stroke: 'cyan', sw: 1.6, glow: true, parent: S.dev });
          ctx.text(64, 196, 'CLIENT APP', { size: 14, font: 'display', weight: 700, color: 'cyan', spacing: 2, parent: S.dev });
          ctx.text(376, 196, 'web · iOS · Android', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.dev });
          S.mods = {};
          S.ovStreams = [];
          S.tg = [];
          S.lanes = [];
          function mod(i) {
            var m = MODS[i];
            var n = ctx.node({ x: 220, y: 250 + i * 86, w: 316, h: 62, title: m[1], sub: m[2], icon: m[3], color: m[0] === 'store' ? 'teal' : 'cyan', titleSize: 15, subSize: 12, glow: false });
            S.mods[m[0]] = n;
            return n;
          }
          S.ov = ctx.group();
          var D = [['CONTROL PATH · KB of JSON', 'authenticated · idempotent · 202 + job_id', 'blue', 250],
            ['UPLOAD PATH · MB to GB of media', 'direct to storage · resumable · content-addressed', 'teal', 508],
            ['FEEDBACK PATH · server push', 'typed events · resumable · progressive previews', 'cyan', 680]];
          function pathText(i) {
            var d = D[i];
            return [ctx.text(840, d[3] - 44, d[0], { size: 14, font: 'display', weight: 700, color: d[2], anchor: 'middle', parent: S.ov }),
              ctx.text(840, d[3] - 25, d[1], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.ov })];
          }
          /* beat 0: the surface the user sees */
          function b0() {
            var front = [mod(0), mod(1)];
            return Promise.all([ctx.reveal(S.dev, { from: 'left' }), ctx.reveal(front, { from: 'left', stagger: 120, delay: 200 })]).then(function () {
              return ctx.pulse(S.mods.comp, { color: 'cyan', dur: 600 });
            });
          }
          /* beat 1: the modules underneath */
          function b1() {
            var rest = [2, 3, 4, 5, 6].map(mod);
            return ctx.reveal(rest, { from: 'left', stagger: 110 }).then(function () {
              return ctx.pulse(S.mods.store, { color: 'teal', times: 2, dur: 600 });
            });
          }
          /* beat 2: control + upload paths leave the device */
          function b2() {
            S.tg[0] = ctx.node({ x: 1430, y: 250, w: 250, h: 70, title: 'API Gateway', sub: 'HTTPS · JSON · OIDC', icon: 'shield', color: 'blue', parent: S.ov });
            S.tg[1] = ctx.node({ x: 1430, y: 508, w: 250, h: 70, title: 'Object Storage', sub: 'S3 API · pre-signed', icon: 'db', color: 'teal', parent: S.ov });
            var l1 = ctx.link(S.mods.comp, S.tg[0], { color: 'blue', from: 'r', to: 'l', parent: S.ov });
            var l2 = ctx.link(S.mods.upl, S.tg[1], { color: 'teal', from: 'r', to: 'l', parent: S.ov, sw: 3 });
            S.lanes.push(l1, l2);
            var txt = pathText(0).concat(pathText(1));
            return Promise.all([
              ctx.reveal(S.tg, { from: 'right', stagger: 150 }),
              ctx.reveal([l1, l2], { from: 'draw', delay: 400, stagger: 200 }),
              ctx.reveal(txt, { from: 'up', delay: 700, stagger: 80 })
            ]).then(function () {
              S.ovStreams.push(ctx.stream(l1, { color: 'blue', count: 2, period: 2600 }));
              S.ovStreams.push(ctx.stream(l2, { color: 'teal', count: 6, period: 1800, r: 4.5 }));
              return Promise.all([
                ctx.packet(l1, { color: 'blue', dur: 1100, label: 'POST /v1/jobs' }),
                ctx.packet(l2, { color: 'teal', dur: 1400, label: 'part 1 / 5' })
              ]);
            });
          }
          /* beat 3: the feedback path returns */
          function b3() {
            S.tg[2] = ctx.node({ x: 1430, y: 680, w: 250, h: 70, title: 'Event Stream', sub: 'SSE · typed events', icon: 'net', color: 'cyan', parent: S.ov });
            var l3 = ctx.link(S.tg[2], S.mods.evt, { color: 'cyan', from: 'l', to: 'r', parent: S.ov, dash: '5 5' });
            S.lanes.push(l3);
            return Promise.all([
              ctx.reveal(S.tg[2], { from: 'right' }),
              ctx.reveal(l3, { from: 'draw', delay: 300 }),
              ctx.reveal(pathText(2), { from: 'up', delay: 600, stagger: 80 })
            ]).then(function () {
              S.ovStreams.push(ctx.stream(l3, { color: 'cyan', count: 4, period: 2200 }));
              return ctx.packet(l3, { color: 'cyan', dur: 1200, label: 'shot.progress' });
            });
          }
          /* beat 4: the platform primitives */
          function b4() {
            var prim = ctx.group({ parent: S.ov });
            ctx.text(470, 780, 'PLATFORM PRIMITIVES', { size: 12, font: 'display', weight: 700, color: 'dim', spacing: 1.5, parent: prim });
            var px = 470;
            [['Web Worker / WASM', 'cyan'], ['IndexedDB', 'teal'], ['WebCodecs', 'orange'], ['fetch + Streams', 'blue'], ['EventSource', 'cyan'], ['Service Worker sync', 'violet'], ['MSE player', 'orange']].forEach(function (p) {
              var l = ctx.label(px, 812, p[0], { color: p[1], size: 12, anchor: 'start', parent: prim });
              px += l.w + 12;
            });
            return ctx.reveal(prim, { from: 'up', dur: 700 }).then(function () { return ctx.pulse(prim, { color: 'cyan', dur: 700 }); });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'On-device preprocessing',
        beats: [
          {
            say: 'Before a single byte leaves the device, a background worker prepares the media. It streams each file through SHA two fifty six, one mebibyte slice at a time, to compute a content address.',
            card: { tag: 'NUMBERS', title: 'Constant memory hashing', stat: { v: '1 MiB', u: 'slices', l: 'stream through a WASM SHA-256 in a Web Worker: memory stays flat and the UI thread untouched' } },
            deep: '<p><b>Content addressing.</b> The object key is the digest: <code>sha256:9f2c…b71d</code>. WebCrypto <code>digest()</code> is one-shot (the whole buffer in memory), so large files are hashed incrementally with a WASM SHA-256 inside a Web Worker, reading the file 1&nbsp;MiB at a time with <code>Blob.slice()</code>.</p>' +
              '<p>Each 64-byte block is expanded into a 64-word message schedule and mixed through 64 rounds into the eight 32-bit state words H<sub>0</sub>…H<sub>7</sub> shown on the right. The same pass can emit per-part checksums for the multipart upload.</p>' +
              '<details><summary>Go deeper</summary><div class="eq">P<sub>collide</sub> ≤ n² / 2<sup>257</sup> &nbsp;(n = 10<sup>12</sup> ⇒ ≈ 4·10<sup>−54</sup>)</div><p>The birthday bound for a 256-bit digest. Accidental collisions are irrelevant; only deliberate attacks on SHA-256 matter, and none is known.</p></details>'
          },
          {
            say: 'The digest is the object\'s address, so a cheap HEAD request can ask whether the server already holds it. The sketch is new and gets uploaded, while the voice memo was sent yesterday and costs zero bytes.',
            card: { tag: 'KEY IDEA', title: 'Same bytes, same key', body: 'Content addressing turns re-uploads into no-ops across sessions and devices: a known blob costs <b>zero bytes</b>.' },
            deep: '<p>A <code>HEAD /v1/blobs/{digest}</code> answers <code>404</code> (upload it) or <code>200</code> (the server already holds these bytes; the client simply references them). The job request then carries digests, not files.</p>' +
              '<details><summary>Go deeper</summary><p>Cross-tenant deduplication is a side channel: an attacker who can ask “do you have digest X?” learns whether someone else uploaded that file (Harnik, Pinkas and Shulman-Peleg, 2010). Scope the digest namespace per tenant, or demand proof of possession (a hash over server-chosen random byte ranges) before answering <code>200</code>.</p></details>' +
              '<div class="note">Trust boundary: the client digest is a <i>hint</i>. Storage recomputes the checksum before the object is sealed.</div>'
          },
          {
            say: 'Next it strips the location and device serials from the photo metadata. Only the container is rewritten, never the pixels, so there is no generation loss and the GPS coordinates never leave the phone.',
            card: {
              tag: 'PITFALL', title: 'Keep Orientation, drop GPS', body: 'Dropping the EXIF <code>Orientation</code> tag silently rotates the image. Keep it and the ICC profile; remove GPS, serials and maker notes.',
              more: '<p>Orientation is a value from 1 to 8 encoding a rotation and optional mirror. Ignore it and portrait photos show up sideways. If a pipeline must bake the rotation in, apply it once with a lossless JPEG transform such as <code>jpegtran</code> where the dimensions allow, not by decoding and re-encoding.</p>'
            },
            deep: '<ul><li><b>EXIF/GPS strip</b>: rewrite metadata segments only; never re-encode pixels. Keep <code>Orientation</code> and the ICC profile; drop GPS, serial numbers and maker notes.</li>' +
              '<li>Also drop the <b>embedded EXIF thumbnail</b>: after a crop it can still contain the uncropped original.</li></ul>' +
              '<p>In a JPEG this is a byte-level edit of the APP1 (Exif) and APP13 (IPTC) segments; in PNG, of the <code>eXIf</code> and text chunks. Stripping is a privacy courtesy performed early; the server strips again.</p>'
          },
          {
            say: 'It renders a small thumbnail so the interface feels instant, and a sixty-four bit perceptual hash, so near-duplicate sketches can be spotted even after resizing or recompression.',
            card: { tag: 'NUMBERS', title: 'A fingerprint for looks', stat: { v: '64 bit', u: 'pHash', l: 'DCT-based perceptual hash: two images are near-duplicates when the Hamming distance is 8 or less' } },
            deep: '<p><b>Thumbnail</b>: a 256² WebP for an instant grid, plus a BlurHash placeholder of about 30 bytes.</p>' +
              '<p><b>Perceptual hash</b> (pHash): grayscale, resize to 32×32, 2-D DCT, keep the 8×8 lowest frequencies, threshold each coefficient against the median: 64 bits. Near-duplicates have a small Hamming distance (roughly 6–10 of 64), robust to resizing and recompression, unlike a cryptographic digest where one flipped bit changes everything.</p>' +
              '<span class="muted">The stage draws the idea with block averages; real pHash uses the DCT.</span>'
          },
          {
            say: 'For the voice memo it transcodes the audio into a tiny Opus proxy with WebCodecs, so speech recognition and the speaker embedding can start while the original is still uploading.',
            card: { tag: 'NUMBERS', title: 'A ten times smaller proxy', stat: { v: '≈ 10×', u: 'smaller', l: 'AAC 256 kb/s to Opus 24 kb/s mono: the 42 second memo shrinks from 1.3 MB to 0.13 MB' } },
            deep: '<p><b>Proxy transcode</b> (WebCodecs <code>AudioEncoder</code>): AAC 256 kb/s becomes Opus 24 kb/s mono. Speech recognition needs only 16 kHz mono anyway, so nothing the ASR model hears is lost.</p>' +
              '<p>ASR and the speaker embedding start on the proxy; the original follows for voice-cloning quality. Upload and understanding overlap instead of running in sequence.</p>' +
              '<details><summary>Go deeper</summary><p>Where WebCodecs audio encoding is unavailable, libopus compiled to WASM produces the same bitstream. At 24 kb/s a 20 ms frame is 60 bytes, so 42 s of speech is about 126 KB before container overhead.</p></details>'
          },
          {
            say: 'Every result lands in the state store and is persisted, so a killed tab resumes the queue. The server still re-hashes everything on arrival, because the client is never trusted.',
            card: { tag: 'TRADE-OFF', title: 'Optimization, not security', body: 'The client digest is a <b>hint</b>. Storage recomputes checksums, and no policy decision relies on client-side stripping.' },
            deep: '<p>Every result lands in the <b>state store</b>: <code>uploads[digest]</code> holds name, state, byte count, thumbnail, EXIF status and proxy status, persisted to IndexedDB.</p>' +
              '<p>Why work on the device at all? <b>Privacy</b>: GPS never leaves the phone. <b>Dedup</b>: known blobs cost zero bytes. <b>Head start</b>: proxies feed ASR and vision before the upload finishes.</p>' +
              '<div class="note">A hostile client can lie about any of it, so the server re-hashes, re-strips and re-validates. Client work saves time; it never grants trust.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          (S.ovStreams || []).forEach(function (h) { h.stop(); });
          ctx.remove(S.ov, 450);
          focusMod(ctx, 'pre');
          var B = newBench(ctx);
          ctx.line(386, 422, 456, 422, { color: 'cyan', dash: '3 4', parent: B });
          var IV = ['6a09e667', 'bb67ae85', '3c6ef372', 'a54ff53a', '510e527f', '9b05688c', '1f83d9ab', '5be0cd19'];
          var FIN = ['9f2c4e1a', 'd07b3c55', 'e8a1f0b2', '4c9d7e13', 'a6b82f04', '17ce5d9a', 'f3086b2e', 'c463b71d'];
          var dig, d1, d2, ex, strike, stripped, big, small, scan, avg, pbar;

          /* beat 0: streaming SHA-256 */
          function b0() {
            ctx.hud('SHA-256 · WASM · 1 MiB slices · flat memory');
            var g = ctx.group({ parent: B });
            heading(ctx, g, 470, 186, '① CONTENT ADDRESS · streaming SHA-256 in a Web Worker');
            ctx.text(1558, 186, 'state H0…H7 (8 × 32 bit)', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: g });
            var chunks = [];
            for (var i = 0; i < 24; i++) chunks.push(ctx.rect(470 + i * 31, 206, 28, 30, { rx: 3, fill: 'rgba(34,228,255,0.06)', stroke: ctx.alpha('cyan', 0.35), sw: 1, parent: g }));
            ctx.text(470, 254, 'sketch_03.png · 23.4 MiB · 1 MiB slices · 64-byte blocks × 64 rounds each', { size: 12, font: 'mono', color: 'dim', parent: g });
            var r = ctx.rng(11), mid = [];
            for (var k = 0; k < 25; k++) { var row = []; for (var j = 0; j < 8; j++) row.push(('0000000' + Math.floor(r() * 4294967296).toString(16)).slice(-8)); mid.push(row); }
            var wtext = [];
            for (var w = 0; w < 8; w++) {
              var cx = 1250 + (w % 4) * 78, cy = 204 + Math.floor(w / 4) * 25;
              ctx.rect(cx, cy, 74, 21, { rx: 3, fill: 'rgba(155,123,255,0.08)', stroke: ctx.alpha('violet', 0.5), sw: 1, parent: g });
              wtext.push(ctx.text(cx + 37, cy + 11, IV[w], { size: 11, font: 'code', color: 'violet', anchor: 'middle', parent: g }));
            }
            dig = ctx.text(470, 290, '', { size: 13, font: 'code', color: 'white', parent: g });
            ctx.reveal(g, { from: 'fade', dur: 400 });
            return ctx.tween(2200, function (e, raw) {
              var n = Math.floor(raw * 24);
              chunks.forEach(function (c, ci) { c.setAttribute('fill', ci < n || raw >= 1 ? ctx.alpha('cyan', 0.55) : 'rgba(34,228,255,0.06)'); });
              var words = raw >= 1 ? FIN : mid[Math.min(24, n)];
              wtext.forEach(function (tx, wi) { tx.textContent = words[wi]; });
            }, 'linear', 300).then(function () {
              return ctx.typeText(dig, 'content key = sha256:9f2c4e1ad07b3c55e8a1f0b24c9d7e13a6b82f0417ce5d9af3086b2ec463b71d', 900);
            });
          }
          /* beat 1: dedup by HEAD */
          function b1() {
            d1 = ctx.label(470, 326, 'HEAD /v1/blobs/sha256:9f2c…b71d → 404 → upload', { color: 'amber', size: 12, anchor: 'start', parent: B });
            d2 = ctx.label(470 + d1.w + 18, 326, 'memo.m4a sha256:41aa…09e2 → 200 → skip (dedup)', { color: 'lime', size: 12, anchor: 'start', parent: B });
            d1.setAttribute('opacity', 0); d2.setAttribute('opacity', 0);
            return ctx.reveal(d1, { from: 'left' }).then(function () { return ctx.reveal(d2, { from: 'left' }); }).then(function () {
              return ctx.pulse(d2, { color: 'lime', dur: 700 });
            });
          }
          /* beat 2: EXIF / GPS strip */
          function b2() {
            var g = ctx.group({ parent: B });
            heading(ctx, g, 470, 378, '② EXIF / GPS STRIP', 'pink', { size: 13 });
            ex = code(ctx, g, { x: 470, y: 395, w: 350, title: 'sketch_03.png · metadata', lang: 'text', size: 12, color: 'pink', lines: [
              'Make  Apple · Model  iPad Pro',
              'DateTimeOriginal  2026:09:27 22:14',
              'GPSLatitude    37.7749 N',
              'GPSLongitude  122.4194 W',
              'BodySerialNumber  F9FX2LQ7KJ',
              'Orientation 6 (rotate 90° CW) → kept',
              'ICC  Display P3 → kept'
            ] });
            strike = [ctx.path('M484,478 L700,478', { color: 'red', sw: 2, parent: g }), ctx.path('M484,497 L700,497', { color: 'red', sw: 2, parent: g }), ctx.path('M484,515 L740,515', { color: 'red', sw: 2, parent: g })];
            strike.forEach(function (s) { s.setAttribute('opacity', 0); });
            stripped = ctx.label(768, 496, 'stripped', { color: 'red', size: 11, parent: g, opacity: 0 });
            ctx.text(470, 592, 'rewrite container only · never re-encode pixels', { size: 12, font: 'mono', color: 'dim', parent: g });
            ctx.hud('GPS bytes leaving the device: 0');
            return ctx.reveal(g, { from: 'fade', dur: 500 }).then(function () { return ctx.wait(500); }).then(function () {
              strike.forEach(function (s) { s.setAttribute('opacity', 1); });
              ctx.reveal(strike, { from: 'draw', dur: 400 });
              ctx.fade([ex.lineEls[2], ex.lineEls[3], ex.lineEls[4]], 0.35, 400);
              return ctx.reveal(stripped, { from: 'scale', dur: 400 });
            });
          }
          /* beat 3: thumbnail + perceptual hash */
          function b3() {
            var g = ctx.group({ parent: B });
            heading(ctx, g, 850, 378, '③ THUMBNAIL + PERCEPTUAL HASH', 'violet', { size: 13 });
            big = ctx.matrix(860, 400, 12, 12, { cell: 11, gap: 1, values: function (rr, cc) { return rgb(moonImg(0.3 + (cc + 0.5) / 12 * 1.05, (rr + 0.5) / 12)); } });
            small = ctx.matrix(1058, 420, 4, 4, { cell: 24, gap: 2, values: function () { return '#0a1428'; } });
            ctx.line(1012, 471, 1048, 471, { color: 'violet', arrow: true, parent: g });
            scan = ctx.rect(860, 400, 35, 35, { rx: 2, stroke: 'white', sw: 1.5, parent: g, opacity: 0 });
            ctx.text(850, 566, 'thumb 256² WebP · blurhash', { size: 12, font: 'mono', color: 'dim', parent: g });
            ctx.text(850, 585, 'pHash 64-bit · dup if Hamming ≤ 8', { size: 12, font: 'mono', color: 'dim', parent: g });
            g.appendChild(big); g.appendChild(small);
            avg = [];
            for (var br = 0; br < 4; br++) {
              avg.push([]);
              for (var bc = 0; bc < 4; bc++) {
                var acc = [0, 0, 0];
                for (var a1 = 0; a1 < 3; a1++) for (var a2 = 0; a2 < 3; a2++) {
                  var px = moonImg(0.3 + (bc * 3 + a2 + 0.5) / 12 * 1.05, (br * 3 + a1 + 0.5) / 12);
                  acc[0] += px[0] / 9; acc[1] += px[1] / 9; acc[2] += px[2] / 9;
                }
                avg[br].push(rgb(acc));
              }
            }
            ctx.reveal(g, { from: 'fade', dur: 500 });
            return ctx.tween(2000, function (e, raw) {
              var n = Math.min(16, Math.floor(raw * 17));
              for (var q = 0; q < 16; q++) small.cells[Math.floor(q / 4)][q % 4].setAttribute('fill', q < n ? avg[Math.floor(q / 4)][q % 4] : '#0a1428');
              if (n < 16) { scan.setAttribute('x', 860 + (n % 4) * 36); scan.setAttribute('y', 400 + Math.floor(n / 4) * 36); scan.setAttribute('opacity', 1); }
              else scan.setAttribute('opacity', 0);
            }, 'linear', 400);
          }
          /* beat 4: Opus proxy for the memo */
          function b4() {
            var g = ctx.group({ parent: B });
            var hd = heading(ctx, g, 1210, 378, '④ PROXY TRANSCODE (WebCodecs)', 'orange', { size: 13 });
            var cap1 = ctx.text(1212, 402, 'memo.m4a · AAC 256 kb/s · 48 kHz · 1.3 MB', { size: 12, font: 'mono', color: 'text', parent: g });
            var rw = ctx.rng(5), d = 'M1212,436', d2s = 'M1212,516';
            for (var x = 1216; x <= 1556; x += 4) {
              var env = 0.35 + 0.65 * Math.abs(Math.sin((x - 1212) / 38));
              d += ' L' + x + ',' + (436 + (rw() - 0.5) * 44 * env).toFixed(1);
              if ((x - 1216) % 16 === 0) d2s += ' L' + x + ',' + (516 + Math.sin((x - 1212) / 38 * 3) * 12 * env).toFixed(1);
            }
            var wav1 = ctx.path(d, { color: 'orange', sw: 1.2, parent: g });
            var wav2 = ctx.path(d2s, { color: 'amber', sw: 1.6, parent: g, opacity: 0 });
            var cap2 = ctx.text(1212, 484, 'proxy.opus · 24 kb/s mono · 0.13 MB', { size: 12, font: 'mono', color: 'amber', parent: g, opacity: 0 });
            var lab1 = ctx.text(1212, 536, 'proxy.opus → uploaded', { size: 11, font: 'mono', color: 'lime', parent: g, opacity: 0 });
            var trk = ctx.rect(1212, 546, 340, 10, { rx: 3, fill: ctx.alpha('orange', 0.5), parent: g, opacity: 0 });
            var trk2 = ctx.rect(1212, 560, 340, 10, { rx: 3, fill: 'rgba(255,255,255,0.05)', parent: g, opacity: 0 });
            pbar = ctx.rect(1212, 560, 0, 10, { rx: 3, fill: 'amber', parent: g });
            var lab2 = ctx.text(1212, 586, 'memo.m4a original → uploading', { size: 11, font: 'mono', color: 'dim', parent: g, opacity: 0 });
            var cap3 = ctx.text(1212, 610, 'ASR + voice embedding start on the proxy', { size: 12, font: 'mono', color: 'text', parent: g, opacity: 0 });
            ctx.reveal([hd, cap1], { from: 'fade', dur: 400 });
            return ctx.reveal(wav1, { from: 'draw', dur: 900, delay: 200 }).then(function () {
              ctx.reveal(cap2, { from: 'left', dur: 400 });
              return ctx.reveal(wav2, { from: 'draw', dur: 900 });
            }).then(function () {
              return Promise.all([ctx.reveal([lab1, trk, trk2, lab2], { from: 'fade', dur: 400, stagger: 100 }), ctx.animate(pbar, { width: [0, 34] }, 700, 'out', 300)]);
            }).then(function () {
              return ctx.reveal(cap3, { from: 'left', dur: 400 });
            });
          }
          /* beat 5: state store + why */
          function b5() {
            focusMod(ctx, 'store');
            var js = code(ctx, B, { x: 470, y: 625, w: 600, title: 'state store · persisted to IndexedDB', lang: 'json', size: 12, color: 'teal', lines: [
              '{"uploads": {',
              '  "sha256:9f2c…b71d": {"name": "sketch_03.png", "state": "queued",',
              '      "bytes": 24536678, "thumb": "blob:…", "exif": "stripped"},',
              '  "sha256:41aa…09e2": {"name": "memo.m4a", "state": "deduped",',
              '      "proxy": "ready", "blob": "blb_7Hq2…"}}}'
            ] });
            var why = ctx.para(1100, 648, ['Why on the device?', '• privacy: GPS never leaves the phone', '• dedup: known blobs cost zero bytes', '• head start: proxies feed ASR / vision early', '• trust: server re-hashes; client hash is a hint'], { size: 14, lh: 26, color: 'text', parent: B, font: 'sans' });
            ctx.hud('4 files · 1 deduped · proxies ready');
            return ctx.reveal([js, why], { from: 'up', stagger: 200, dur: 600 });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4)
            .then(function () { return ctx.beat(5); }).then(b5);
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Resumable multipart upload',
        beats: [
          {
            say: 'The upload manager never sends a big file in one piece. It asks the API to start a multipart upload and receives short-lived pre-signed URLs, one per part, so the bytes flow straight to object storage and never touch our API servers.',
            card: {
              tag: 'HOW IT WORKS', title: 'A URL is a capability',
              body: 'SigV4 scopes each URL to one bucket, key, upload id and part number. If it leaks, it grants a single PUT for fifteen minutes.',
              more: '<p>SigV4 derives the signing key by chained HMAC-SHA256: <code>kDate = HMAC("AWS4"+secret, date)</code>, then region, service, and the literal <code>aws4_request</code>. The signature is <code>HMAC(kSigning, stringToSign)</code>, so the account secret itself never appears in a URL.</p>'
            },
            deep: '<p><b>S3-style multipart</b>: parts are 5&nbsp;MiB–5&nbsp;GiB (the last may be smaller), at most 10,000 parts, uploaded in any order and in parallel. <code>CompleteMultipartUpload</code> lists <code>(PartNumber, ETag)</code> in ascending order and the store assembles them atomically.</p>' +
              '<ul><li><b>Pre-signed URL</b>: SigV4 HMAC over the canonical request, scoped to bucket, key, <code>uploadId</code> and <code>partNumber</code>, with <code>X-Amz-Expires=900</code>. A leaked URL grants one PUT for 15 min, nothing else.</li></ul>' +
              '<p>The API tier only mints URLs. It never sees a media byte.</p>'
          },
          {
            say: 'The file is cut into five mebibyte parts, and the parts travel over three parallel connections. Each lane is an independent HTTP request straight to the object store.',
            card: { tag: 'NUMBERS', title: 'Parts are the unit of work', stat: { v: '5 MiB', u: 'per part', l: 'the S3 minimum: up to 10,000 parts of 5 MiB to 5 GiB each, so objects reach 5 TiB' } },
            deep: '<div class="eq">T ≈ max( S/B<sub>up</sub>, ⌈N/k⌉·(RTT+P/b) )</div>' +
              '<p>Here S is the object size, B<sub>up</sub> the uplink, P the part size, N = ⌈S/P⌉ the part count, k the lanes and b the throughput of one connection. With S = 23.4 MiB, P = 5 MiB, N = 5 and k = 3 there are ⌈5/3⌉ = 2 rounds. Parallelism only helps while a single stream is window- or loss-limited (b ≈ cwnd/RTT). Once the uplink saturates, more lanes add contention instead of speed.</p>' +
              '<details><summary>Go deeper</summary><p>The useful lane count is roughly k* ≈ B<sub>up</sub> / b. On a 20 Mb/s uplink where one TCP stream reaches 8 Mb/s, k* ≈ 2.5, so three lanes just saturate it. Adaptive clients add a lane only while aggregate throughput still rises.</p></details>'
          },
          {
            say: 'When part three hits a connection reset, only that part is retried, after a short back-off. The other lanes keep going, and nothing that already arrived is sent again. Click any part to reset it yourself.',
            card: { tag: 'TRY IT', title: 'Click a part to reset it', body: 'Only that part is re-sent, about 5 MiB and never the whole 23.4 MiB file. Reset several: each retries alone while the other lanes keep going.' },
            deep: '<p>Expected re-sent bytes per failure ≈ P. Smaller parts waste less on flaky mobile links but cost more requests, because each PUT pays a round trip and a signature. Adaptive sizing is common: 5 MiB on cellular, 8–64 MiB on good links.</p>' +
              '<p>Retries use exponential backoff with full jitter and a per-part attempt limit; a part that keeps failing fails the upload instead of looping forever.</p>' +
              '<p><b>Resume</b>: <code>uploadId</code> and the completed parts live in IndexedDB. After a crash, <code>ListParts</code> reconciles the two and only the missing parts are sent.</p>' +
              '<details><summary>Go deeper</summary><p>Optimal part size. Give each attempt an overhead c (a round trip plus signing), let one connection carry b bytes per second, and let failures strike at a hazard λ per byte. A P-byte part then succeeds with probability e<sup>−λP</sup> and is tried e<sup>λP</sup> times on average:</p>' +
              '<div class="eq">T(P) = S · e<sup>λP</sup> · (c/P + 1/b) &nbsp; ⇒ &nbsp; P* ≈ √(c·b / λ)</div>' +
              '<p>With c = 100 ms, b = 1 MB/s and one failure per 100 MB (λ = 0.01 per MB), P* ≈ 3.2 MB. On flaky links the optimum falls below the 5 MiB floor of S3 multipart, so mobile clients sit at the minimum, while tus-style single-stream uploads can shrink chunks freely.</p></details>'
          },
          {
            say: 'Each part returns an ETag, and the client can send a checksum along with it. When all five are in, one complete call lists them in order and the store stitches them into a single object.',
            card: { tag: 'KEY IDEA', title: 'Whole object or nothing', body: 'Parts are invisible until <code>CompleteMultipartUpload</code>. The object then appears atomically, and a verifier re-hashes it against the content address.' },
            deep: '<p><b>Integrity</b>: each part carries <code>x-amz-checksum-sha256</code> (or CRC32C / CRC64NVME), verified server-side before the part is accepted. For multipart objects S3 reports a <i>composite</i> checksum by default, a checksum of the part checksums (the CRC family can also report a full-object value), so a verifier job streams the object once and recomputes the whole-file SHA-256 to confirm the content address.</p>' +
              '<p><b>Hygiene</b>: a lifecycle rule <code>AbortIncompleteMultipartUpload</code> after one to seven days, or orphaned parts are stored and billed forever.</p>'
          },
          {
            say: 'The IETF resumable upload draft and the tus protocol take a simpler route: one URL, ask the server for its offset, then continue from there. It suits a single stream, but parallelism needs extra machinery.',
            card: { tag: 'STATE OF THE ART', title: 'Resumability becomes HTTP', body: 'The IETF resumable-upload draft standardizes what tus proved: <code>HEAD</code> returns the offset, <code>PATCH</code> appends from it.' },
            deep: '<p><b>tus / IETF resumable upload</b>: a single URL. <code>HEAD</code> returns <code>Upload-Offset</code>; <code>PATCH</code> appends from that offset and answers with the new one. The offset is the only state.</p>' +
              '<table><tr><th></th><th>S3 multipart</th><th>tus / IETF draft</th></tr>' +
              '<tr><td>Parallel parts</td><td>native</td><td>needs the Concatenation extension</td></tr>' +
              '<tr><td>Resume state</td><td>uploadId + part list</td><td>a single offset</td></tr>' +
              '<tr><td>Auth</td><td>per-part signed URL</td><td>bearer on one URL</td></tr></table>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, 'upl');
          var B = newBench(ctx);
          ctx.line(386, 508, 456, 508, { color: 'cyan', dash: '3 4', parent: B });
          var sizes = ['5 MiB', '5 MiB', '5 MiB', '5 MiB', '3.4 MiB'];
          var ET = ['7d0c…a1', '3be9…04', 'b54f…e1', 'e2a7…9c', '0f61…d3'];
          var blocks = [], stat = [], slots = [], lanes = [], marks = [], cx = 470;
          var comp, statsEl = null, tries = [0, 0, 0, 0, 0];
          function setSt(i, s, col) { stat[i].textContent = s; stat[i].setAttribute('fill', ctx.color(col)); }
          function launch(i) { setSt(i, 'in flight', 'cyan'); blocks[i].setAttribute('fill', ctx.alpha('cyan', 0.25)); }
          function land(i, n) {
            setSt(i, 'ETag ' + ET[i] + (n ? ' ✓ (retry ' + n + ')' : ' ✓'), 'lime');
            blocks[i].setAttribute('fill', ctx.alpha('lime', 0.18));
            blocks[i].setAttribute('stroke', ctx.alpha('lime', 0.7));
            slots[i].setAttribute('fill', ctx.alpha('teal', 0.8));
          }
          /* summary line under the upload: retries so far and the bytes they re-sent */
          function statsStr() {
            var n = 0, mb = 0, sz = [5, 5, 5, 5, 3.4];
            tries.forEach(function (t, i) { n += t; mb += t * sz[i]; });
            return '5 parts · 3 lanes · ' + n + ' ' + (n === 1 ? 'retry' : 'retries') + ' · ' + (Math.round(mb * 10) / 10) + ' MiB re-sent, not 23.4';
          }
          function chip(str, col) {
            var l = ctx.label(cx, 224, str, { color: col, size: 12, anchor: 'start', parent: B });
            cx += l.w + 16;
            return l;
          }
          /* beat 0: start the upload, receive signed URLs */
          function b0() {
            heading(ctx, B, 470, 186, 'RESUMABLE MULTIPART UPLOAD · sketch_03.png · 23.4 MiB');
            var c1 = chip('① POST /v1/uploads → 5 signed URLs', 'blue');
            var pg = ctx.group({ parent: B });
            sizes.forEach(function (s, i) {
              var y = 262 + i * 48;
              blocks.push(ctx.rect(480, y, 130, 36, { rx: 5, fill: 'rgba(43,245,196,0.06)', stroke: ctx.alpha('teal', 0.6), sw: 1.2, parent: pg }));
              ctx.text(545, y + 18, 'part ' + (i + 1) + ' · ' + s, { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: pg });
              stat.push(ctx.text(622, y + 18, 'pending', { size: 12, font: 'mono', color: 'dim', parent: pg }));
            });
            S.stor = ctx.node({ x: 1445, y: 378, w: 220, h: 130, kind: 'cyl', title: 'Object Store', sub: 'uploadId VXBsb2Fk…', color: 'teal', parent: B, titleSize: 15 });
            for (var q = 0; q < 5; q++) slots.push(ctx.rect(1377 + q * 28, 412, 24, 14, { rx: 2, fill: 'none', stroke: ctx.alpha('teal', 0.6), sw: 1, parent: B }));
            var sig = code(ctx, B, { x: 470, y: 600, w: 540, title: 'part 3 · pre-signed URL (SigV4, 15 min)', lang: 'text', size: 12, color: 'blue', lines: [
              'PUT https://media.s3.us-east-1.amazonaws.com/',
              '    u/9f2c…b71d?partNumber=3&uploadId=VXBs…',
              '    &X-Amz-Algorithm=AWS4-HMAC-SHA256',
              '    &X-Amz-Expires=900&X-Amz-Signature=5d1e…',
              'x-amz-checksum-sha256: q3Z8f1Lw0mBvK…=',
              '← 200 OK   ETag: "b54f…e1"'
            ] });
            ctx.hud('23.4 MiB → 5 parts · 3 lanes · per-part retry');
            return Promise.all([
              ctx.reveal(c1, { from: 'left' }),
              ctx.reveal(pg, { from: 'left', delay: 150 }),
              ctx.reveal([S.stor], { from: 'right', delay: 300 }),
              ctx.reveal(slots, { from: 'fade', delay: 500, stagger: 50 }),
              ctx.reveal(sig, { from: 'up', delay: 700 })
            ]).then(function () { return ctx.pulse(sig, { color: 'blue', dur: 700 }); });
          }
          /* beat 1: three lanes in parallel */
          function b1() {
            var c2 = chip('② PUT × 3 in flight · retry per part', 'teal');
            var lg = ctx.group({ parent: B });
            lanes = [300, 378, 456].map(function (y, i) {
              var p = ctx.path('M818,' + y + ' C1040,' + y + ' 1120,' + (360 + i * 18) + ' 1333,' + (360 + i * 18), { color: ctx.alpha('teal', 0.7), sw: 1.6, dash: '5 5', parent: lg });
              ctx.text(820, y - 14, ['lane A · connection 1', 'lane B · connection 2', 'lane C · connection 3'][i], { size: 11, font: 'mono', color: 'dim', parent: lg });
              return p;
            });
            ctx.reveal(lg, { from: 'fade', dur: 400 });
            return Promise.all([ctx.reveal(c2, { from: 'left' }), ctx.reveal(lanes, { from: 'draw', stagger: 120, delay: 200 })]).then(function () {
              launch(0); launch(1); launch(2);
              return Promise.all([
                ride(ctx, lanes[0], { color: 'teal', label: 'part 1', dur: 1300 }).then(function () { land(0); }),
                ctx.wait(150).then(function () { return ride(ctx, lanes[1], { color: 'teal', label: 'part 2', dur: 1300 }); }).then(function () { land(1); }),
                ctx.wait(300).then(function () { return ride(ctx, lanes[2], { color: 'teal', label: 'part 3', until: 0.45, dur: 700 }); })
              ]);
            });
          }
          /* beat 2: part 3 fails and is retried alone, parts 4 and 5 continue */
          function b2() {
            var pt = lanes[2].getPointAtLength(lanes[2].getTotalLength() * 0.45);
            marks.push(ctx.text(pt.x, pt.y, '✕', { size: 22, color: 'red', anchor: 'middle', weight: 700, parent: B }));
            setSt(2, 'RST · backoff', 'red');
            blocks[2].setAttribute('fill', ctx.alpha('red', 0.25));
            return ctx.wait(500).then(function () {
              tries[2] = 1;
              setSt(2, 'retry 1', 'amber');
              blocks[2].setAttribute('fill', ctx.alpha('amber', 0.25));
              return Promise.all([
                ride(ctx, lanes[2], { color: 'amber', label: 'part 3 · retry', dur: 1300 }).then(function () { land(2, 1); }),
                Promise.resolve().then(function () { launch(3); return ride(ctx, lanes[0], { color: 'teal', label: 'part 4', dur: 1300 }); }).then(function () { land(3); }),
                ctx.wait(200).then(function () { launch(4); return ride(ctx, lanes[1], { color: 'teal', label: 'part 5', dur: 1300 }); }).then(function () { land(4); })
              ]);
            }).then(function () {
              return Promise.all(marks.map(function (m) { return ctx.remove(m, 300); }));
            }).then(function () {
              /* every part row is now clickable: reset it and watch only that part being re-sent */
              var busy = {};
              blocks.forEach(function (bl, i) {
                var hit = ctx.rect(476, 258 + i * 48, 332, 44, { rx: 6, fill: 'rgba(0,0,0,0.001)', parent: B });
                hit.style.cursor = 'pointer';
                hit.addEventListener('click', function () {
                  if (busy[i]) return;
                  busy[i] = true;
                  var ln = lanes[i % 3], q = ln.getPointAtLength(ln.getTotalLength() * 0.45);
                  var x = ctx.text(q.x, q.y, '✕', { size: 22, color: 'red', anchor: 'middle', weight: 700, parent: B });
                  setSt(i, 'RST · backoff', 'red');
                  bl.setAttribute('fill', ctx.alpha('red', 0.25)); bl.setAttribute('stroke', ctx.alpha('red', 0.7));
                  slots[i].setAttribute('fill', 'none');
                  ctx.wait(500).then(function () {
                    tries[i]++;
                    setSt(i, 'retry ' + tries[i], 'amber');
                    bl.setAttribute('fill', ctx.alpha('amber', 0.25));
                    return ride(ctx, ln, { color: 'amber', label: 'part ' + (i + 1) + ' · retry', dur: 1100 });
                  }).then(function () {
                    land(i, tries[i]);
                    if (statsEl) statsEl.textContent = statsStr();
                    return ctx.remove(x, 300);
                  }).then(function () { busy[i] = false; });
                });
              });
            });
          }
          /* beat 3: complete */
          function b3() {
            var c3 = chip('③ POST …/complete', 'blue');
            comp = code(ctx, B, { x: 1040, y: 600, w: 520, title: 'POST …/complete  (ascending PartNumber)', lang: 'json', size: 12, color: 'teal', typing: true, maxLines: 7, lines: [
              '{"Parts": ['
            ].concat(ET.map(function (e, i) { return '  {"PartNumber": ' + (i + 1) + ', "ETag": "' + e + '"}' + (i < 4 ? ',' : ''); })).concat([']}']) });
            var done = ctx.label(1300, 806, '✓ sealed · verifier re-hash = sha256:9f2c…b71d', { color: 'lime', size: 12, parent: B, opacity: 0 });
            var stats = ctx.text(470, 806, statsStr(), { size: 12, font: 'mono', color: 'dim', parent: B, opacity: 0 });
            statsEl = stats;
            return ctx.reveal(c3, { from: 'left' }).then(function () { return comp.typeAll(); }).then(function () {
              return ctx.reveal([done, stats], { from: 'up', stagger: 150 });
            });
          }
          /* beat 4: the tus alternative */
          function b4() {
            var tus = ctx.para(1250, 490, ['tus / IETF resumable upload:', 'HEAD → Upload-Offset: 15728640', 'PATCH  Upload-Offset: 15728640', '  → 204  Upload-Offset: 20971520'], { size: 12, font: 'code', color: 'text', lh: 18, parent: B });
            return ctx.reveal(tus, { from: 'up' }).then(function () {
              var hl = ctx.highlight(tus, { color: 'violet', pad: 8, parent: B });
              return ctx.pulse(hl, { color: 'violet', dur: 700 });
            });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'OIDC, PKCE & tokens',
        beats: [
          {
            say: 'Every request must prove who is asking. The app is a public client, so it cannot keep a secret: anything shipped inside a mobile or browser app can be extracted. Instead it uses OAuth with PKCE.',
            card: { tag: 'KEY IDEA', title: 'Public clients cannot keep secrets', body: 'PKCE replaces a static client secret with a fresh one-time secret invented for every single login.' },
            deep: '<p><b>Authorization Code + PKCE</b> (RFC 7636). RFC 9700 (January 2025) makes it the baseline for public clients and recommends it for confidential ones too; the OAuth 2.1 draft folds it in and drops the implicit flow.</p>' +
              '<p>Why a public client has no secret: a static <code>client_secret</code> in a JavaScript bundle or app binary is extractable in minutes, so it authenticates nobody. PKCE proves instead that the party redeeming the code is the party that started the login.</p>'
          },
          {
            say: 'It invents a random verifier and sends only its hash when the user signs in with a passkey. The authorization server answers with a short-lived code.',
            card: {
              tag: 'HOW IT WORKS', title: 'Send the hash, keep the verifier', body: 'The challenge is the base64url SHA-256 of the verifier. The verifier itself stays on the device until the token request.',
              more: '<p>Always use <code>S256</code>. The <code>plain</code> method sends the verifier as the challenge, which protects nothing against an observer of the authorization request. 32 random bytes give a 43-character verifier with 256 bits of entropy.</p>'
            },
            deep: '<div class="eq">code_challenge = BASE64URL( SHA-256( code_verifier ) ), &nbsp; |verifier| ∈ [43, 128]</div>' +
              '<p>An attacker who intercepts the authorization code (a hijacked custom URL scheme, a leaked referrer) cannot redeem it without the verifier, which never left the device. Preimage resistance of SHA-256 means seeing the challenge does not reveal the verifier.</p>' +
              '<p>The user authenticates with a <b>passkey</b> (WebAuthn): a device-bound key pair, phishing-resistant because the browser scopes the signature to the site origin.</p>'
          },
          {
            say: 'Later the app trades the code for tokens and proves it knows the verifier. The server hashes it and compares. It gets back a short-lived signed JWT access token and a rotating refresh token.',
            card: { tag: 'NUMBERS', title: 'Short-lived by design', stat: { v: '10 min', u: 'access token', l: 'short lifetime bounds a leak: a signed JWT cannot be recalled before it expires' } },
            deep: '<p><b>Access token</b>: a JWS (ES256 or EdDSA) with the claims <code>iss, sub, aud, exp, scope, tenant</code>. The <code>scope</code> string (<code>jobs:write media:put</code>) is the capability the gateway later enforces. The refresh token is opaque and stored server-side, so it can be revoked individually.</p>' +
              '<p>Before issuing anything the server checks, in constant time, that <code>BASE64URL(SHA-256(verifier))</code> equals the challenge stored with the code. A code is single-use and lives about a minute.</p>'
          },
          {
            say: 'Every API call now carries the token, and the gateway verifies the signature locally against cached public keys, without ever calling the identity server.',
            card: { tag: 'STATE OF THE ART', title: 'Bind the token to a key', body: 'DPoP makes each request carry a proof signed by a device key, so a stolen bearer token is useless without that key.' },
            deep: '<p>The gateway validates the JWT <i>statelessly</i>: fetch the JWKS once, cache by <code>kid</code>, then check the signature, <code>exp</code> and <code>nbf</code> with at most 60 s of clock skew, <code>aud</code> and the scopes. That is roughly 50 µs of CPU and zero network hops.</p>' +
              '<ul><li><b>DPoP</b> (RFC 9449): the proof JWT covers the HTTP method, URL and a nonce; <code>cnf.jkt</code> in the access token pins it to the device key thumbprint.</li>' +
              '<li>Unknown <code>kid</code>: one rate-limited JWKS refresh, so key rotation needs no outage.</li></ul>'
          },
          {
            say: 'Because a JWT cannot be recalled, access tokens live for minutes, and refresh tokens rotate on every use. If an old refresh token is ever replayed, the server revokes the whole token family.',
            card: { tag: 'TRADE-OFF', title: 'Stateless means unrecallable', body: 'Short access tokens plus refresh rotation with reuse detection: a stolen token dies quickly, and a replayed one burns the family.' },
            deep: '<p>Statelessness has a price: a JWT cannot be recalled before <code>exp</code>. Hence short lifetimes (5–15 min) plus <b>refresh-token rotation with reuse detection</b>: every refresh returns a new refresh token; presenting an already-used one means it was copied, so the server revokes the whole family.</p>' +
              '<p>Storage: tokens live in memory or the OS keychain, never <code>localStorage</code>; browser apps often use a backend-for-frontend with HttpOnly cookies. The trade-off in the chart: the replayed token dies at once, but the access token minted before it stays valid until its own expiry.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, 'auth');
          var B = newBench(ctx);
          ctx.line(386, 594, 456, 594, { color: 'cyan', dash: '3 4', parent: B });
          var X = [580, 860, 1130];
          var hd, n0;
          function note(x, y, s, col) { var l = ctx.label(x, y, s, { color: col, size: 12, parent: B, bgAlpha: 0.2 }); l.setAttribute('opacity', 0); return { note: l }; }
          function mm(x1, x2, y, label, col, o) {
            var r = msg(ctx, B, x1, x2, y, label, col, o);
            r.col = col; r.ln.setAttribute('opacity', 0); r.tx.setAttribute('opacity', 0);
            return r;
          }
          /* beat 0: the three parties */
          function b0() {
            ctx.hud('public client · no secret · OAuth 2.0 + PKCE');
            hd = [
              ctx.node({ x: X[0], y: 200, w: 190, h: 44, title: 'Client (public)', icon: 'phone', color: 'cyan', titleSize: 13, parent: B }),
              ctx.node({ x: X[1], y: 200, w: 190, h: 44, title: 'IdP / Auth server', icon: 'lock', color: 'pink', titleSize: 13, parent: B }),
              ctx.node({ x: X[2], y: 200, w: 190, h: 44, title: 'API Gateway', icon: 'shield', color: 'blue', titleSize: 13, parent: B })
            ];
            var lifes = X.map(function (x) { return ctx.line(x, 224, x, 612, { color: 'faint', dash: '4 5', parent: B }); });
            return Promise.all([ctx.reveal(hd, { from: 'down', stagger: 100 }), ctx.reveal(lifes, { from: 'draw', delay: 300 })]).then(function () {
              return ctx.pulse(hd[0], { color: 'cyan', times: 2, dur: 600 });
            });
          }
          /* beat 1: verifier, challenge, authorization code */
          function b1() {
            n0 = ctx.group({ parent: B, opacity: 0 });
            ctx.rect(466, 233, 664, 26, { rx: 13, fill: 'rgba(6,12,24,0.96)', stroke: ctx.alpha('cyan', 0.6), sw: 1, parent: n0 });
            ctx.text(480, 246.5, 'code_verifier = b64url(32 random B) · code_challenge = b64url(SHA-256(verifier))', { size: 12, font: 'mono', color: 'cyan', parent: n0 });
            ctx.hud('PKCE S256 · AT 10 min · RT rotation · DPoP');
            return playMsgs(ctx, [
              { note: n0 },
              mm(X[0], X[1], 294, 'GET /authorize?code_challenge=E9Me…', 'cyan'),
              note(X[1], 332, 'passkey (WebAuthn) sign-in', 'pink'),
              mm(X[1], X[0], 372, '302 → app://cb?code=SplxlO…', 'pink')
            ]);
          }
          /* beat 2: code for tokens */
          function b2() {
            var jwt = code(ctx, B, { x: 1250, y: 180, w: 320, title: 'access_token (JWT)', lang: 'json', size: 12, color: 'amber', lines: [
              '// header',
              '{"alg":"ES256","kid":"k-2026-09"}',
              '// payload',
              '{"iss":"https://id.genesis",',
              ' "sub":"usr_8f1c",',
              ' "aud":"api.genesis",',
              ' "scope":"jobs:write media:put",',
              ' "tenant":"studio-42",',
              ' "exp":1790554200,',
              ' "cnf":{"jkt":"0ZcO…"}}',
              '// sig = ES256(SHA-256(h.p))'
            ] });
            var list = [
              mm(X[0], X[1], 414, 'POST /token (code, code_verifier)', 'cyan'),
              note(X[1], 452, 'SHA-256(verifier) == challenge ?', 'pink'),
              mm(X[1], X[0], 494, 'access JWT (10 min) + refresh RT1', 'lime')
            ];
            return Promise.all([ctx.reveal(jwt, { from: 'right', delay: 1400 }), playMsgs(ctx, list)]);
          }
          /* beat 3: the gateway verifies locally */
          function b3() {
            return playMsgs(ctx, [
              mm(X[0], X[2], 548, 'GET /v1/jobs · DPoP eyJhbGci…', 'blue', { lx: 720 }),
              note(X[2], 588, 'verify ES256 (cached JWKS) · exp · aud · scope', 'blue')
            ]);
          }
          /* beat 4: lifetimes and rotation */
          function b4() {
            var tl = ctx.group({ parent: B });
            heading(ctx, tl, 470, 652, 'TOKEN LIFETIMES · access 10 min, refreshed at 80 % · refresh tokens rotate (RFC 9700)', 'cyan', { size: 13 });
            var x0 = 580, pm = 16;
            ctx.line(x0, 806, x0 + 60 * pm, 806, { color: 'faint', parent: tl });
            for (var m = 0; m <= 60; m += 10) {
              ctx.line(x0 + m * pm, 802, x0 + m * pm, 810, { color: 'faint', parent: tl });
              ctx.text(x0 + m * pm, 822, m + ' min', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: tl });
            }
            ctx.text(470, 704, 'access JWT', { size: 12, font: 'mono', color: 'text', parent: tl });
            ctx.text(470, 772, 'refresh', { size: 12, font: 'mono', color: 'text', parent: tl });
            var bars = [];
            for (var k = 0; k < 6; k++) {
              var bx = x0 + k * 8 * pm, row = k % 2;
              var endMin = Math.min(k * 8 + 10, 60);
              var bw = (endMin - k * 8) * pm;
              var br = ctx.rect(bx, 688 + row * 22, bw, 16, { rx: 3, fill: ctx.alpha('cyan', 0.3), stroke: 'cyan', sw: 1, parent: tl });
              ctx.text(bx + 8, 696 + row * 22, 'AT' + (k + 1), { size: 11, font: 'mono', color: 'white', parent: tl });
              var rt = ctx.rect(x0 + k * 8 * pm + 1, 764, 8 * pm - 2, 16, { rx: 3, fill: ctx.alpha('lime', 0.22), stroke: ctx.alpha('lime', 0.8), sw: 1, parent: tl });
              ctx.text(x0 + k * 8 * pm + 8, 772, 'RT' + (k + 1), { size: 11, font: 'mono', color: 'lime', parent: tl });
              bars.push(br, rt);
            }
            var rx = x0 + 44 * pm;
            var rep = ctx.group({ parent: tl, opacity: 0 });
            ctx.line(rx, 676, rx, 790, { color: 'red', sw: 2, dash: '4 3', parent: rep });
            ctx.text(rx - 8, 676, '44 min: replay of used RT5 → family revoked', { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: rep });
            ctx.rect(rx, 764, x0 + 48 * pm - rx - 1, 16, { rx: 0, fill: 'rgba(255,77,109,0.35)', parent: rep });
            ctx.text(rx + 8, 742, 'AT6 stays valid until exp → keep it short', { size: 11, font: 'mono', color: 'amber', parent: rep });
            return Promise.all([ctx.reveal(tl, { from: 'up' }), ctx.reveal(bars, { from: 'left', stagger: 70, delay: 300 })]).then(function () {
              return ctx.reveal(rep, { from: 'fade', dur: 500 });
            });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Async jobs & idempotency',
        beats: [
          {
            say: 'Rendering a trailer takes minutes, so the API never holds the request open. It records the idempotency key, enqueues the job, and prepares an immediate answer: two oh two Accepted, with a job id.',
            card: { tag: 'KEY IDEA', title: 'Accept now, finish later', body: 'The API acknowledges in milliseconds and the work continues asynchronously. Nothing long-running sits on a load-balancer timeout.' },
            deep: '<p><b>Async request-reply</b>: <code>POST /v1/jobs</code> returns <code>202 Accepted</code> with a <code>Location</code> header and an events URL. Status is observed over SSE, or by polling with <code>Retry-After</code>. Load balancers typically cut idle requests at 60 s; a trailer takes about 150 s.</p>' +
              '<p>The response also carries an estimate (<code>gpu_seconds</code>, <code>eta_s</code>), so the interface can show a cost and a countdown before the first frame renders.</p>'
          },
          {
            say: 'But networks lie. Here the response is lost on its way back, so the client times out. It cannot know whether the job exists, so it does the only safe thing and tries again.',
            card: { tag: 'PITFALL', title: 'Lost replies look like lost requests', body: 'The client cannot tell whether the server never saw the request or saw it and answered into the void. A blind retry can create a duplicate.' },
            deep: '<p>A timeout is ambiguous: the request may have died before the server saw it, or after the job was created. With plain at-least-once retries, the second case creates a duplicate.</p>' +
              '<p>Two standard fixes: make the operation idempotent by construction (<code>PUT /jobs/{client_id}</code>), or attach an <b>Idempotency-Key</b> header. Here the key is a client-generated UUID persisted with the draft <i>before</i> the first send, so a retry after a crash reuses it.</p>'
          },
          {
            say: 'Because the retry carries the same idempotency key, the server returns the stored response instead of launching a second, very expensive GPU job. Exactly one job enters the queue.',
            card: { tag: 'NUMBERS', title: 'The duplicate that never ran', stat: { v: '≈ 5,400', u: 'GPU-s', l: 'a second trailer would have cost this: 6 shots × 8 GPUs × 95 s, plus planning and one re-render. The key turns a retry into a lookup' } },
            deep: '<p><b>Idempotency-Key</b> (IETF httpapi draft; Stripe-style): the server stores <code>key → (fingerprint(body), state, response)</code> for about 24 h.</p>' +
              '<pre>on POST(key, body):\n  row = get_or_insert(key)   # atomic\n  if row.existed:\n    if row.fp != hash(body): 422\n    if row.state == IN_FLIGHT: 409\n    return row.response      # replay\n  BEGIN\n    insert job; insert outbox event\n    row.response = 202{job_id}\n  COMMIT</pre>' +
              '<p>The job, the key row and an <b>outbox</b> event are written in one transaction, so “accepted” and “enqueued” are atomic. The relay publishes the outbox at least once and consumers dedupe by <code>job_id</code>, which gives effectively-once.</p>'
          },
          {
            say: 'The client never guesses what happens next. The job moves through a server-owned state machine, and the interface is only ever a projection of the events that machine emits.',
            card: { tag: 'HOW IT WORKS', title: 'The server owns the state machine', body: 'Queued, planning, rendering, post, then succeeded, failed or canceled. Every transition is an event the UI renders.' },
            deep: '<p>Job states: <code>queued → planning → rendering → post → succeeded</code>, with <code>failed</code> and <code>canceled</code> as exits. Transitions are server-authoritative and each emits an event; the client renders the latest event per job and never infers state.</p>' +
              '<p>Cancel is a request, not a fact: the UI shows “canceling” until the server confirms, because a shot already running on eight GPUs may need seconds to stop.</p>' +
              '<div class="note">Why it matters here: a duplicated trailer is not a duplicated row. It is thousands of GPU-seconds.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, 'comp');
          var B = newBench(ctx);
          ctx.line(386, 250, 456, 250, { color: 'cyan', dash: '3 4', parent: B });
          var X = [580, 850, 1110, 1400];
          var M, lostX, qbox, once, chipS = {}, lost;
          function note(x, y, s, col) { var l = ctx.label(x, y, s, { color: col, size: 12, parent: B, bgAlpha: 0.2 }); l.setAttribute('opacity', 0); return { note: l }; }
          function mm(x1, x2, y, label, col, o) {
            var r = msg(ctx, B, x1, x2, y, label, col, o);
            r.col = col; r.ln.setAttribute('opacity', 0); r.tx.setAttribute('opacity', 0);
            return r;
          }
          /* beat 0: accept, record the key, enqueue */
          function b0() {
            var hd = [
              ctx.node({ x: X[0], y: 196, w: 170, h: 44, title: 'Client', icon: 'phone', color: 'cyan', titleSize: 13, parent: B }),
              ctx.node({ x: X[1], y: 196, w: 170, h: 44, title: 'Jobs API', icon: 'server', color: 'blue', titleSize: 13, parent: B }),
              ctx.node({ x: X[2], y: 196, w: 200, h: 44, title: 'Idempotency store', icon: 'db', color: 'teal', titleSize: 13, parent: B }),
              ctx.node({ x: X[3], y: 196, w: 170, h: 44, title: 'Job queue', icon: 'queue', color: 'magenta', titleSize: 13, parent: B })
            ];
            var lifes = X.map(function (x) { return ctx.line(x, 220, x, 612, { color: 'faint', dash: '4 5', parent: B }); });
            qbox = ctx.group({ parent: B, opacity: 0 });
            ctx.rect(X[3] - 50, 380, 100, 26, { rx: 4, fill: ctx.alpha('magenta', 0.3), stroke: 'magenta', sw: 1.2, parent: qbox });
            ctx.text(X[3], 393, 'job_01JB7Q', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: qbox });
            var resp = code(ctx, B, { x: 470, y: 640, w: 560, title: 'response (original and replay are byte-identical)', lang: 'json', size: 12, color: 'blue', lines: [
              'HTTP/2 202 Accepted',
              'location: /v1/jobs/job_01JB7Q',
              '{"job_id": "job_01JB7Q",',
              ' "status": "queued",',
              ' "events": "/v1/jobs/job_01JB7Q/events",',
              ' "estimate": {"gpu_seconds": 5420, "eta_s": 150}}'
            ] });
            M = [
              mm(X[0], X[1], 258, 'POST /v1/jobs · key 5f1e…c2', 'cyan'),
              mm(X[1], X[2], 296, 'INSERT key (in_flight, fp)', 'teal'),
              mm(X[1], X[3], 334, 'enqueue job_01JB7Q (outbox)', 'magenta', { lx: 1255 }),
              mm(X[1], X[2], 372, 'store response 202', 'teal')
            ];
            ctx.hud('retry-safe: 2 requests, 1 job');
            return Promise.all([ctx.reveal(hd, { from: 'down', stagger: 90 }), ctx.reveal(lifes, { from: 'draw', delay: 300 })]).then(function () {
              return playMsgs(ctx, M.slice(0, 3));
            }).then(function () {
              ctx.reveal(qbox, { from: 'scale', dur: 400 });
              return playMsgs(ctx, M.slice(3));
            }).then(function () { return ctx.reveal(resp, { from: 'up', dur: 600 }); });
          }
          /* beat 1: the reply is lost, the client retries */
          function b1() {
            lost = mm(X[1], 700, 414, '202 · job_01JB7Q', 'red', { dash: '5 4', lx: 775 });
            lostX = ctx.text(700, 414, '✕', { size: 20, weight: 700, color: 'red', anchor: 'middle', parent: B, opacity: 0 });
            var nt = note(X[0] + 30, 456, 'no reply in 10 s → retry, SAME key', 'amber');
            return playMsgs(ctx, [lost]).then(function () {
              return ctx.reveal(lostX, { from: 'scale', dur: 300 });
            }).then(function () { return playMsgs(ctx, [nt]); });
          }
          /* beat 2: the replay returns the stored answer */
          function b2() {
            once = ctx.label(X[3], 600, 'exactly one job enqueued', { color: 'lime', size: 12, parent: B, opacity: 0 });
            return playMsgs(ctx, [
              mm(X[0], X[1], 496, 'POST /v1/jobs · key 5f1e…c2', 'amber'),
              mm(X[1], X[2], 532, 'hit: completed → cached 202', 'teal'),
              mm(X[1], X[0], 570, '202 · job_01JB7Q (same job)', 'lime')
            ]).then(function () { return ctx.reveal(once, { from: 'scale', dur: 400 }); }).then(function () {
              return ctx.pulse(qbox, { color: 'magenta', times: 2, dur: 700 });
            });
          }
          /* beat 3: the server-owned state machine */
          function b3() {
            var sm = ctx.group({ parent: B, opacity: 0 });
            heading(ctx, sm, 1070, 652, 'JOB STATE MACHINE (server-authoritative)', 'magenta', { size: 13 });
            var st = [['queued', 1115, 700], ['planning', 1235, 700], ['rendering', 1370, 700], ['post', 1500, 700], ['succeeded', 1480, 780], ['failed', 1300, 780], ['canceled', 1115, 780]];
            st.forEach(function (s) { chipS[s[0]] = ctx.label(s[1], s[2], s[0], { color: s[0] === 'failed' ? 'red' : (s[0] === 'succeeded' ? 'lime' : (s[0] === 'canceled' ? 'dim' : 'magenta')), size: 12, parent: sm }); chipS[s[0]].p = { x: s[1], y: s[2] }; });
            function ar(a, b, dash) { var A = chipS[a], Bc = chipS[b]; var ax = A.p.x, ay = A.p.y, bx = Bc.p.x, by = Bc.p.y; var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); var sa = ay === by ? A.w / 2 + 3 : 14, sb = ay === by ? Bc.w / 2 + 6 : 16; ctx.line(ax + dx / L * sa, ay + dy / L * sa, bx - dx / L * sb, by - dy / L * sb, { color: ctx.alpha('magenta', 0.6), sw: 1.2, arrow: true, dash: dash, parent: sm }); }
            ar('queued', 'planning'); ar('planning', 'rendering'); ar('rendering', 'post'); ar('post', 'succeeded'); ar('rendering', 'failed', '3 3'); ar('queued', 'canceled', '3 3');
            ctx.text(1070, 830, 'client UI = projection of server events, never guessed', { size: 12, font: 'mono', color: 'dim', parent: sm });
            return ctx.reveal(sm, { from: 'up', dur: 600 }).then(function () {
              return ctx.pulse(chipS.queued, { color: 'magenta', times: 2, dur: 700 });
            });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3);
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'TCP+TLS vs QUIC',
        beats: [
          {
            say: 'Now the wire itself. Over TCP with TLS one point three, the client needs one round trip for the TCP handshake and another for TLS before it can send a request. The first byte comes back after three round trips.',
            card: { tag: 'NUMBERS', title: 'Three round trips to first byte', stat: { v: '240 ms', u: 'to first byte', l: 'TCP plus TLS 1.3 on an LTE link with an 80 ms round trip time' } },
            deep: '<table><tr><th></th><th>TCP + TLS 1.3</th><th>QUIC (1-RTT)</th><th>QUIC 0-RTT</th></tr>' +
              '<tr><td>request leaves at</td><td>2 RTT</td><td>1 RTT</td><td>0 RTT</td></tr>' +
              '<tr><td>first response byte</td><td>3 RTT</td><td>2 RTT</td><td>1 RTT</td></tr>' +
              '<tr><td>@ RTT = 80 ms (LTE)</td><td>240 ms</td><td>160 ms</td><td>80 ms</td></tr></table>' +
              '<p>The two handshakes stack because TCP and TLS are separate layers: TLS cannot start until TCP has delivered a byte stream. TLS 1.3 early data over TCP (or TCP Fast Open) can shave a round trip, but middlebox support is poor.</p>'
          },
          {
            say: 'QUIC merges transport and cryptography into a single handshake, so the request leaves after one round trip and the first byte returns after two.',
            card: { tag: 'NUMBERS', title: 'One round trip saved', stat: { v: '160 ms', u: 'to first byte', l: 'QUIC one-RTT handshake at the same 80 ms round trip: a full RTT faster than TCP plus TLS' } },
            deep: '<p>QUIC (RFC 9000, 9001) integrates TLS 1.3 into its own handshake. The Initial packet carries the ClientHello, the reply carries ServerHello and Finished, and the request rides with the client Finished: transport parameters and keys are negotiated together.</p>' +
              '<details><summary>Go deeper</summary><p>Anti-amplification: a client Initial datagram is padded to at least 1200 bytes, and until the client address is validated the server may send at most three times the bytes it received. Packet numbers and most headers are encrypted, so middleboxes cannot ossify the wire format the way they did TCP.</p></details>'
          },
          {
            say: 'On a resumed session it can send the request in the very first flight, called zero RTT. That is only safe for idempotent requests, because an attacker can replay that first flight.',
            card: { tag: 'PITFALL', title: 'Zero RTT is replayable', body: 'Servers accept only safe methods in early data or answer <code>425 Too Early</code>. Job creation waits for the handshake or leans on its idempotency key.' },
            deep: '<p><b>0-RTT is replayable</b>: early data is encrypted under a key from a previous session, and nothing binds it to this connection, so an on-path attacker can resend the first flight and the server cannot tell. Servers accept only safe methods in early data, or reply <code>425 Too Early</code> (RFC 8470) so the client retries after the handshake.</p>' +
              '<p>Our <code>POST /v1/jobs</code> therefore goes after the handshake, or is protected by its idempotency key. Session tickets should be single-use with a short window to bound the replay surface.</p>'
          },
          {
            say: 'QUIC also removes head-of-line blocking. Over TCP, one lost packet stalls every stream because they all share one ordered byte stream, while in QUIC only the stream that lost it waits. Click a lane to choose which stream loses a packet.',
            card: {
              tag: 'TRY IT', title: 'Click a lane to lose its packet', body: 'Over TCP every lane stalls, whichever packet you drop. Over QUIC only the lane you hit waits, so the tiny event stream no longer pays for the upload.',
              more: '<p>Worked example: p = 1 %, with 50 packets in flight on the connection and 2 of them on the event stream. HTTP/2: 1 − 0.99<sup>50</sup> = 39.5 % chance the event stream stalls. HTTP/3: 1 − 0.99<sup>2</sup> = 2.0 %. Each stall lasts roughly one RTT (fast retransmit), or a full retransmission timeout if the tail of a burst is lost.</p>'
            },
            deep: '<p><b>Head-of-line blocking</b>: HTTP/2 multiplexes streams over one TCP byte stream, so a single loss blocks delivery of <i>all</i> streams until retransmission (about 1 RTT). QUIC delivers in order per stream only. With per-packet loss rate p and n packets in flight ahead of stream s:</p>' +
              '<div class="eq">P(s stalls)<sub>h2</sub> = 1 − (1−p)<sup>n<sub>conn</sub></sup> &nbsp; vs &nbsp; P(s stalls)<sub>h3</sub> = 1 − (1−p)<sup>n<sub>s</sub></sup></div>' +
              '<p>The event stream is a few packets in a connection dominated by a large upload, so n<sub>s</sub> ≪ n<sub>conn</sub>: HTTP/3 makes its stall probability nearly independent of the upload.</p>'
          },
          {
            say: 'And the connection survives a switch from Wi-Fi to cellular, because QUIC names connections by ID, not by network address. The price is a user space stack and networks that block UDP, so clients always race a TCP fallback.',
            card: { tag: 'TRADE-OFF', title: 'Migration has a price', body: 'User-space QUIC costs more CPU per byte than kernel TCP, and some networks throttle UDP. Always race a TCP fallback.' },
            deep: '<p><b>Connection migration</b>: QUIC identifies a connection by connection IDs, not the 4-tuple, so a Wi-Fi to 5G handover keeps the upload and the event stream alive after path validation. TCP would tear both down and pay a fresh handshake.</p>' +
              '<p><b>Costs</b>: a user-space stack with more CPU per byte than kernel TCP (UDP segmentation offloads narrow the gap), and UDP blocked or throttled on a few percent of networks. Hence clients discover HTTP/3 via <code>Alt-Svc</code> or the HTTPS DNS record and race a TCP connection with happy eyeballs.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, null);
          var B = newBench(ctx);
          var C = [600, 1010, 1420], RTT = 95, y0 = 252;
          var cfg = [
            { t: 'TCP + TLS 1.3 · HTTP/2', m: [[0, 'c', 'SYN', 'dim'], [0.5, 's', 'SYN-ACK', 'dim'], [1, 'c', 'ACK + ClientHello', 'blue'], [1.5, 's', 'ServerHello … Finished', 'blue'], [2, 'c', 'Finished + GET', 'cyan'], [2.5, 's', 'response', 'lime']], res: 'first byte @ 3 RTT ≈ 240 ms', col: 'amber' },
            { t: 'QUIC 1-RTT · HTTP/3', m: [[0, 'c', 'Initial: ClientHello', 'blue'], [0.5, 's', 'ServerHello … Finished', 'blue'], [1, 'c', 'Finished + GET', 'cyan'], [1.5, 's', 'response', 'lime']], res: 'first byte @ 2 RTT ≈ 160 ms', col: 'lime' },
            { t: 'QUIC 0-RTT (resumed)', m: [[0, 'c', 'ClientHello + 0-RTT GET', 'cyan'], [0.5, 's', 'ServerHello + response', 'lime']], res: '1 RTT ≈ 80 ms · replayable!', col: 'pink' }
          ];
          var hg, u1, u2, cap1, cap2, hs = { L: 4 };
          ctx.hud('first byte @ 80 ms RTT: TCP+TLS vs QUIC');
          function column(li) {
            var L = cfg[li], anims = [];
            var xc = C[li] - 105, xs = C[li] + 105;
            var g = ctx.group({ parent: B });
            heading(ctx, g, C[li], 186, L.t, 'cyan', { size: 14, anchor: 'middle' });
            ctx.text(xc, 216, 'client', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            ctx.text(xs, 216, 'edge', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            ctx.line(xc, 228, xc, 548, { color: 'line', sw: 2, parent: g });
            ctx.line(xs, 228, xs, 548, { color: 'line', sw: 2, parent: g });
            for (var k = 0; k <= 3; k++) {
              ctx.line(xc - 6, y0 + k * RTT, xc, y0 + k * RTT, { color: 'faint', parent: g });
              ctx.text(xc - 10, y0 + k * RTT, k === 0 ? '0' : k + ' RTT', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
            }
            ctx.reveal(g, { from: 'fade', dur: 400 });
            L.m.forEach(function (m) {
              var ya = y0 + m[0] * RTT, yb = y0 + (m[0] + 0.5) * RTT;
              var x1 = m[1] === 'c' ? xc : xs, x2 = m[1] === 'c' ? xs : xc;
              var p = ctx.path('M' + x1 + ',' + ya + ' L' + x2 + ',' + yb, { color: m[3], sw: 1.6, arrow: true, parent: g });
              var mx = (xc + xs) / 2, my = (ya + yb) / 2;
              var ang = Math.atan2(yb - ya, x2 - x1) * 180 / Math.PI;
              if (m[1] === 's') ang = Math.atan2(ya - yb, xs - xc) * 180 / Math.PI;
              var tx = ctx.text(mx, my - 10, m[2], { size: 11, font: 'mono', color: m[3] === 'dim' ? 'text' : m[3], anchor: 'middle', parent: g });
              tx.setAttribute('transform', 'rotate(' + ang.toFixed(2) + ' ' + mx + ' ' + my + ')');
              p.setAttribute('opacity', 0); tx.setAttribute('opacity', 0);
              var delay = 500 + m[0] * 1000;
              anims.push(ctx.wait(delay).then(function () {
                p.setAttribute('opacity', 1);
                ctx.reveal(tx, { dur: 250 });
                ctx.reveal(p, { from: 'draw', dur: 480, ease: 'linear' });
                return ctx.packet(p, { color: m[3] === 'dim' ? 'text' : m[3], dur: 480, r: 4 });
              }));
            });
            var endT = L.m[L.m.length - 1][0] + 0.5;
            var res = ctx.label(C[li], 574, L.res, { color: L.col, size: 12, parent: g });
            res.setAttribute('opacity', 0);
            anims.push(ctx.wait(500 + endT * 1000).then(function () { return ctx.reveal(res, { from: 'scale', dur: 350 }); }));
            return Promise.all(anims);
          }
          /* beat 3: head-of-line blocking */
          function b3() {
            hg = ctx.group({ parent: B });
            heading(ctx, hg, 470, 630, 'HTTP/2 over TCP · one ordered byte stream', 'blue', { size: 13 });
            heading(ctx, hg, 1030, 630, 'HTTP/3 over QUIC · per-stream ordering', 'lime', { size: 13 });
            ctx.line(1005, 640, 1005, 850, { color: 'faint', dash: '3 5', parent: hg });
            u1 = holPanel(ctx, hg, 470, false, hs); u2 = holPanel(ctx, hg, 1030, true, hs);
            u1.update(0); u2.update(0);
            cap1 = ctx.text(470, 790, 'one loss on "upload" stalls all 3 streams ~1 RTT', { size: 12, font: 'mono', color: 'amber', parent: hg, opacity: 0 });
            cap2 = ctx.text(1030, 790, 'the loss on "upload" stalls only upload', { size: 12, font: 'mono', color: 'lime', parent: hg, opacity: 0 });
            var hint = ctx.label(800, 862, '▶ click a lane to lose one of its packets', { color: 'amber', size: 12, parent: hg, opacity: 0 });
            ctx.reveal(hg, { from: 'up', dur: 500 });
            var t0 = null;
            S.holLoop = ctx.loop(function (t) {
              if (t0 === null || S.holReset) { t0 = t; S.holReset = false; }
              var ph = ((t - t0) * 0.85 * ctx.speed) % 5.2;
              var tt = Math.min(3.4, ph);
              u1.update(tt); u2.update(tt);
            });
            function lose(i) {
              hs.L = 3 + i; u1.plan(); u2.plan(); S.holReset = true;
              cap1.textContent = 'one loss on "' + HOL_NAMES[i] + '" stalls all 3 streams ~1 RTT';
              cap2.textContent = 'the loss on "' + HOL_NAMES[i] + '" stalls only ' + HOL_NAMES[i];
            }
            u1.hits(lose); u2.hits(lose);
            /* drill in: zoom onto the two head-of-line panels while the replay runs */
            return ctx.wait(300).then(function () { return ctx.camera(1012, 715, 1.42, 700); })
              .then(function () { return ctx.wait(3000); })
              .then(function () { return ctx.reveal([cap1, cap2], { stagger: 250 }); })
              .then(function () { return ctx.wait(600); })
              .then(function () { return ctx.camera(null, null, 1, 700); })
              .then(function () { return ctx.reveal(hint, { from: 'up' }); });
          }
          /* beat 4: connection migration */
          function b4() {
            var mig1 = ctx.text(470, 826, 'Wi-Fi → 5G: new 4-tuple = new TCP conn + handshake', { size: 12, font: 'mono', color: 'dim', parent: hg, opacity: 0 });
            var mig2 = ctx.text(1030, 826, 'Wi-Fi → 5G: connection ID survives (migration)', { size: 12, font: 'mono', color: 'lime', parent: hg, opacity: 0 });
            return ctx.reveal(mig1, { from: 'left' }).then(function () { return ctx.reveal(mig2, { from: 'left' }); }).then(function () {
              return ctx.pulse(mig2, { color: 'lime', dur: 700 });
            });
          }
          return column(0).then(function () { return ctx.beat(1); })
            .then(function () { return column(1); }).then(function () { return ctx.beat(2); })
            .then(function () { ctx.hud('first byte @ 80 ms RTT: 240 · 160 · 80 ms'); return column(2); }).then(function () { return ctx.beat(3); })
            .then(b3).then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Event streaming',
        beats: [
          {
            say: 'For progress we need server push, and Server-Sent Events win here: one way, plain HTTP that passes through proxies and CDNs, multiplexed over HTTP two or three, with resumption built in.',
            card: { tag: 'TRADE-OFF', title: 'Pick the weakest channel that works', body: 'Progress is one-way and low-rate. SSE is plain HTTP; WebSocket, WebRTC and WebTransport buy duplex or UDP at real operational cost.' },
            deep: '<p><b>Choosing the channel</b>: job progress is one-way, low-rate (about 20 events per second at most) and must survive disconnects, so SSE. WebSocket earns its complexity for bidirectional low-latency traffic such as co-editing a storyboard; WebRTC for real-time media, for example talking to the director agent by voice; WebTransport (HTTP/3) adds unreliable datagrams and many streams.</p>' +
              '<p>SSE is also the transport LLM APIs use for token deltas, and MCP\'s Streamable HTTP transport can stream responses the same way, so proxies, CDNs and tooling already understand it.</p>'
          },
          {
            say: 'Every event carries a type and an id. The server appends typed events to a per-job log, and the id is simply the position in that log.',
            card: { tag: 'HOW IT WORKS', title: 'The id is a log offset', body: 'Events are appended to Redis Streams or Kafka. The SSE <code>id</code> is the entry offset, so a position in the stream is a position in history.' },
            deep: '<p><b>Typed event schema</b> (versioned, JSON Schema or protobuf): <code>job.accepted · plan.delta · shot.progress · preview.ready · shot.done · job.failed</code>. Events are appended to a per-job log (Redis Streams or Kafka, retained for hours) and the SSE <code>id</code> is the log offset.</p>' +
              '<p>Over HTTP/1.1 browsers cap a site at 6 connections, so SSE really needs h2 or h3 multiplexing (100+ concurrent streams by default) or a second tab starves the first.</p>'
          },
          {
            say: 'When the connection drops, the browser reconnects on its own and sends the last id it saw. The server replays whatever was missed from the log, then tails live events, so the client never sees a gap.',
            card: {
              tag: 'HOW IT WORKS', title: 'Gap-free resume', body: '<code>Last-Event-ID</code> plus a per-job log turns an unreliable connection into an in-order, at-least-once stream.',
              more: '<p>Native <code>EventSource</code> cannot set an <code>Authorization</code> header. Browser clients either use a cookie or read the stream with <code>fetch</code> and a small SSE parser, and then must implement reconnect and <code>Last-Event-ID</code> themselves.</p>'
            },
            deep: '<pre>on reconnect(Last-Event-ID = n):\n  replay log[n+1 .. head]   # gap-free\n  then tail live</pre>' +
              '<p>The server-sent <code>retry: 2000</code> field sets the reconnect delay; adding jitter on the server side avoids a thundering herd after a load-balancer restart drops every stream at once.</p>' +
              '<p>Replay is at least once: an event delivered just before the drop may arrive again. Handlers are idempotent by event id, exactly like the job creation call.</p>'
          },
          {
            say: 'Heartbeats stop middleboxes from killing idle connections. A comment line every fifteen seconds keeps address translators and load balancers from reaping the stream, and it exposes dead peers.',
            card: { tag: 'NUMBERS', title: 'Ping well inside the timeout', stat: { v: '15 s', u: 'heartbeat', l: 'comment line, far below the 60 to 350 second idle timeouts of NATs and load balancers' } },
            deep: '<p><b>Heartbeats</b>: a comment line <code>: ping</code> every 15 s keeps NAT and load-balancer idle timers (often 60–350 s) from reaping the connection. If a write fails, the peer is gone and the server frees the subscription immediately instead of holding it for hours.</p>' +
              '<p>On the client, the absence of any bytes for two heartbeat periods is treated as a dead link: close and reconnect with the last id rather than waiting for TCP to notice.</p>'
          },
          {
            say: 'And a bounded queue with coalescing protects the server from slow clients. Only the latest progress per shot is kept, terminal events are never dropped, and a client that still cannot keep up is disconnected and resumes by id.',
            card: { tag: 'PITFALL', title: 'One slow phone can sink a server', body: 'An unbounded per-connection queue lets a stalled client eat memory. Bound it, coalesce latest-wins, keep terminal events, then close.' },
            deep: '<p><b>Backpressure</b>: TCP or QUIC flow control eventually pushes back into the server write buffer. Bound the per-connection queue (for example 256 events or 1 MB); coalesce <i>latest-wins</i> per key (<code>shot.progress</code> for shot 3) and never drop terminal events. If it is still full, close the connection: the client resumes by id.</p>' +
              '<div class="note">Shed the connection, not the process. Resume by id makes that a cheap decision.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.holLoop) { S.holLoop.stop(); S.holLoop = null; }
          focusMod(ctx, 'evt');
          var B = newBench(ctx);
          ctx.line(386, 680, 456, 680, { color: 'cyan', dash: '3 4', parent: B });
          var srv, cli, lane, back, wire, cut, cutL, reL;
          function evts(ids, dur) {
            return ids.reduce(function (p, id) {
              return p.then(function () { ctx.packet(lane, { color: 'cyan', dur: dur, r: 4.5, label: 'id ' + id }); cli.subEl.textContent = 'lastEventId = ' + id; return ctx.wait(dur * 0.35); });
            }, Promise.resolve()).then(function () { return ctx.wait(dur * 0.7); });
          }
          /* beat 0: the channel choice */
          function b0() {
            var grid = ctx.group({ parent: B });
            var colsX = [705, 895, 1085, 1275, 1465];
            var head = ['SSE', 'WebSocket', 'WebRTC DC', 'long-poll', 'WebTransport'];
            var rows = ['direction', 'transport', 'resume', 'infra fit', 'best for'];
            var cells = [
              ['server → client', 'full duplex', 'duplex · UDP · p2p/SFU', 'emulated push', 'duplex + datagrams'],
              ['HTTP/1.1 · h2 · h3', 'RFC 6455 · h2: RFC 8441', 'ICE · DTLS · SCTP', 'plain HTTP', 'HTTP/3 (QUIC)'],
              ['Last-Event-ID built in', 'DIY: seq + ack', 'DIY', 'cursor param', 'DIY'],
              ['proxy + CDN friendly', 'sticky LB, idle timeouts', 'STUN/TURN, heavy', 'works everywhere', 'newer, uneven support'],
              ['job + agent events ✓', 'live co-editing', 'voice with director', 'fallback', 'future live preview']
            ];
            var hl = ctx.rect(612, 176, 186, 196, { rx: 8, fill: 'rgba(34,228,255,0.08)', stroke: ctx.alpha('cyan', 0.7), sw: 1.4, parent: grid, glow: true });
            hl.setAttribute('opacity', 0);
            head.forEach(function (h, i) { ctx.text(colsX[i], 194, h, { size: 14, font: 'display', weight: 700, color: i === 0 ? 'cyan' : 'white', anchor: 'middle', parent: grid }); });
            rows.forEach(function (r, ri) {
              var y = 228 + ri * 32;
              ctx.line(470, y - 16, 1560, y - 16, { color: 'line', sw: 1, parent: grid });
              ctx.text(470, y, r, { size: 12, font: 'mono', color: 'dim', parent: grid });
              cells[ri].forEach(function (c, ci) { ctx.text(colsX[ci], y, c, { size: 12, font: 'mono', color: ci === 0 ? 'cyan' : 'text', anchor: 'middle', parent: grid }); });
            });
            ctx.hud('one-way, low-rate, must resume → SSE');
            return ctx.reveal(grid, { from: 'down' }).then(function () { return ctx.reveal(hl, { from: 'fade', dur: 500 }); });
          }
          /* beat 1: typed events flow from the log */
          function b1() {
            srv = ctx.node({ x: 1450, y: 443, w: 210, h: 92, kind: 'cyl', title: 'Event Log', sub: 'per job · Redis Streams', color: 'magenta', parent: B, titleSize: 14, subSize: 11 });
            cli = ctx.node({ x: 575, y: 440, w: 210, h: 60, title: 'EventSource', sub: 'lastEventId = 1040', icon: 'net', color: 'cyan', parent: B, titleSize: 14, subSize: 12 });
            lane = ctx.path('M1345,428 L680,428', { color: 'cyan', sw: 1.8, arrow: true, parent: B });
            wire = code(ctx, B, { x: 470, y: 530, w: 520, title: 'wire: text/event-stream', lang: 'text', size: 12, color: 'cyan', lines: [
              'HTTP/2 200   content-type: text/event-stream',
              'retry: 2000',
              'id: 1042',
              'event: shot.progress',
              'data: {"shot":3,"step":18,"of":32,"eta_s":41}',
              '',
              ': ping   (heartbeat every 15 s)'
            ] });
            ctx.hud('Last-Event-ID: gap-free resume');
            return Promise.all([ctx.reveal([srv, cli], { from: 'scale', stagger: 150 }), ctx.reveal(lane, { from: 'draw', delay: 400 }), ctx.reveal(wire, { from: 'up', delay: 600 })]).then(function () {
              return ctx.wait(300);
            }).then(function () { return evts([1041, 1042], 900); });
          }
          /* beat 2: drop, reconnect with Last-Event-ID, replay */
          function b2() {
            cut = ctx.text(1012, 428, '✕', { size: 24, weight: 700, color: 'red', anchor: 'middle', parent: B, opacity: 0 });
            cutL = ctx.text(1012, 400, 'LB idle timeout / Wi-Fi drop', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: B, opacity: 0 });
            reL = ctx.text(1012, 480, 'GET …/events · Last-Event-ID: 1042', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: B, opacity: 0 });
            back = ctx.path('M680,458 L1345,458', { color: ctx.alpha('amber', 0.7), sw: 1.4, dash: '4 5', arrow: true, parent: B, opacity: 0 });
            ctx.reveal([cut, cutL], { from: 'scale', dur: 300 });
            ctx.fade(lane, 0.3, 300);
            return ctx.wait(700).then(function () {
              ctx.reveal(reL, { dur: 300 });
              return ctx.reveal(back, { from: 'draw', dur: 500 });
            }).then(function () {
              return ctx.packet(back, { color: 'amber', dur: 700, r: 4.5 });
            }).then(function () {
              ctx.fadeOut([cut, cutL], 300);
              ctx.fade(lane, 1, 300);
              return evts([1043, 1044, 1045, 1046, 1047], 700);
            }).then(function () {
              cli.subEl.textContent = 'lastEventId = 1047';
              cut.setAttribute('opacity', 0); cutL.setAttribute('opacity', 0);
              lane.setAttribute('opacity', 1);
            });
          }
          /* beat 3: heartbeats */
          function b3() {
            var frame = ctx.highlight(wire.lineEls[6], { color: 'amber', pad: 4, dash: '4 3', parent: B });
            var chip = ctx.label(1012, 400, 'heartbeat · ": ping" every 15 s', { color: 'amber', size: 12, opacity: 0, parent: B });
            return ctx.reveal(chip, { from: 'down' }).then(function () {
              return ctx.packet(lane, { color: 'amber', dur: 900, r: 3.5, label: ': ping' });
            }).then(function () { return ctx.pulse(frame, { color: 'amber', dur: 600 }); });
          }
          /* beat 4: backpressure */
          function b4() {
            var bp = ctx.group({ parent: B });
            heading(ctx, bp, 1030, 540, 'BACKPRESSURE · bounded per-connection queue', 'cyan', { size: 13 });
            ctx.text(1030, 570, 'slow client, no coalescing', { size: 12, font: 'mono', color: 'dim', parent: bp });
            var q1 = ctx.matrix(1030, 584, 1, 16, { cell: 24, gap: 4, values: function () { return 'rgba(255,255,255,0.04)'; }, stroke: ctx.alpha('cyan', 0.3), parent: bp });
            var full = ctx.text(1030, 628, 'queue full → close; client resumes by id', { size: 12, font: 'mono', color: 'red', parent: bp, opacity: 0 });
            ctx.text(1030, 662, 'latest-wins per shot, terminal events kept', { size: 12, font: 'mono', color: 'dim', parent: bp });
            var q2 = ctx.matrix(1030, 676, 1, 16, { cell: 24, gap: 4, values: function () { return 'rgba(255,255,255,0.04)'; }, stroke: ctx.alpha('cyan', 0.3), parent: bp });
            var ok2 = ctx.text(1030, 720, '4 / 16 slots · nothing important lost', { size: 12, font: 'mono', color: 'lime', parent: bp, opacity: 0 });
            [['shot.progress', ctx.alpha('cyan', 0.6), 1030], ['preview.ready', 'violet', 1190], ['shot.done', 'lime', 1350]].forEach(function (lg) {
              ctx.rect(lg[2], 752, 12, 12, { rx: 2, fill: lg[1], parent: bp });
              ctx.text(lg[2] + 18, 758, lg[0], { size: 12, font: 'mono', color: 'dim', parent: bp });
            });
            ctx.text(1030, 800, 'server write buffer > 1 MB ⇒ shed the connection, not the process', { size: 12, font: 'mono', color: 'dim', parent: bp });
            var seq = [];
            var rq = ctx.rng(3);
            for (var i = 0; i < 16; i++) seq.push(i === 6 ? 'violet' : (i === 11 ? 'lime' : (i === 15 ? 'violet' : ctx.alpha('cyan', 0.35 + 0.4 * rq()))));
            var coal = [ctx.alpha('cyan', 0.75), 'violet', 'lime', 'violet'];
            ctx.reveal(bp, { from: 'up', dur: 500 });
            return ctx.tween(3600, function (e, raw) {
              var n = Math.floor(raw * 16.99);
              for (var c = 0; c < 16; c++) q1.cells[0][c].setAttribute('fill', c < n ? seq[c] : 'rgba(255,255,255,0.04)');
              var m = Math.min(4, Math.floor(raw * 4.99));
              for (var c2 = 0; c2 < 16; c2++) q2.cells[0][c2].setAttribute('fill', c2 < m ? coal[c2] : 'rgba(255,255,255,0.04)');
            }, 'linear', 500).then(function () { return ctx.reveal([full, ok2], { stagger: 200 }); });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Streaming deltas & previews',
        beats: [
          {
            say: 'Waiting in silence feels broken, so everything streams. The planner\'s tokens arrive as deltas, and the client appends them to a buffer of partial JSON.',
            card: { tag: 'STATE OF THE ART', title: 'Everything streams', body: 'LLM APIs already deliver tokens as stream deltas. The client turns that text into structured state it can render before the answer ends.' },
            deep: '<p><b>Partial JSON</b>: structured LLM output streams as text deltas (<code>plan.delta</code> events). Waiting for the closing brace would freeze the interface for the whole generation, which for a six-shot plan is several seconds of silence.</p>' +
              '<p>Instead the client appends every delta to a buffer and treats the buffer as a <i>prefix of a valid document</i>, which the next beat turns into a renderable tree.</p>'
          },
          {
            say: 'It repairs the prefix by closing the open string and brackets, parses it, and renders storyboard cards while the model is still writing.',
            card: {
              tag: 'HOW IT WORKS', title: 'Repair, parse, diff, render', body: 'Every 50 ms: close whatever is open, <code>JSON.parse</code>, diff against the last tree, and touch only the changed cards.',
              more: '<p>Repair is cheap because constrained decoding makes every prefix a prefix of a valid document: the only defects are open strings, open containers and a dangling key or number. The repair stack tracks <code>{ [ "</code> and backslash escapes in one pass, and keeping its state between deltas makes the whole stream linear in the total length instead of quadratic.</p>'
            },
            deep: '<pre>repair(prefix):\n  s = open { [ " stack   # one pass\n  return prefix + closers(reverse(s))\n\nevery 50 ms:\n  tree = JSON.parse(repair(buf))\n  render(diff(prev, tree))</pre>' +
              '<p>Constrained decoding on the server guarantees the <i>final</i> text is schema-valid, so every streamed prefix is a prefix of a valid document and repair only has to close open strings and containers, dropping a dangling key or half-written number such as <code>4.</code>. UI fields render once their key is complete. Alternative: JSON-Patch style operations (<code>{"op":"add","path":"/shots/1/prompt"}</code>).</p>'
          },
          {
            say: 'Rendering streams too. A distilled few-step model produces a rough low-resolution draft within seconds, long before the full model has finished.',
            card: { tag: 'NUMBERS', title: 'First pixels early', stat: { v: '≈ 9 s', u: 'to first pixels', l: 'a 240p draft from a four-step distilled student, versus about 95 s for the final shot' } },
            deep: '<p><b>Progressive previews</b> (illustrative timings for one 5 s shot):</p>' +
              '<table><tr><th>tier</th><th>model</th><th>res</th><th>ready</th></tr>' +
              '<tr><td>draft</td><td>4-step distilled student</td><td>240p</td><td>~9 s</td></tr></table>' +
              '<p>A step-distilled student (consistency or distribution-matching distillation) trades some fidelity for a 10 to 25 times cut in denoising steps. Seeded with the same initial noise and the same text conditioning as the teacher, its draft tends to share the final shot\'s composition.</p>'
          },
          {
            say: 'Then a sharper preview arrives, and finally the full quality shot replaces it in place, at the same timestamp, without the player restarting.',
            card: { tag: 'HOW IT WORKS', title: 'Three tiers, one timeline', body: 'Each tier arrives as a <code>preview.ready</code> event with a URL. The player swaps sources at the same timestamp.' },
            deep: '<table><tr><th>tier</th><th>model</th><th>res</th><th>ready</th></tr>' +
              '<tr><td>draft</td><td>4-step distilled student</td><td>240p</td><td>~9 s</td></tr>' +
              '<tr><td>preview</td><td>12 steps, step caching</td><td>480p</td><td>~35 s</td></tr>' +
              '<tr><td>final</td><td>full model + VAE decode + SR</td><td>1080p</td><td>~95 s</td></tr></table>' +
              '<p>Each tier arrives as a <code>preview.ready</code> event carrying a URL; the player swaps sources at the same playhead position, so the creator watches the shot sharpen instead of waiting for a spinner.</p>'
          },
          {
            say: 'Best of all, the creator can cancel or redirect after the draft, long before the expensive final render finishes, and the saved GPU time is never spent.',
            card: { tag: 'NUMBERS', title: 'The GPU-seconds never spent', stat: { v: '≈ 690', u: 'GPU-s', l: 'GPU-seconds saved per shot when a bad draft is rejected at 9 s instead of after all 95 s on eight GPUs' } },
            deep: '<p>Early human feedback prunes the most expensive work. Rejecting a bad draft at 9 s saves the remaining 86 s of an eight-GPU render: 86 × 8 ≈ 690 GPU-seconds, more than ten times the cost of the draft itself.</p>' +
              '<div class="note">The best GPU-second is the one never spent.</div>' +
              '<p>The same events feed the critic agent: a draft is cheap enough to score automatically, so the system can discard weak shots before paying for full resolution.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, 'store');
          var B = newBench(ctx);
          ctx.line(386, 766, 456, 766, { color: 'teal', dash: '3 4', parent: B });
          var buf, rep, c1, c2, frame, tierT, tbar = [], ev, tier, tw = 620, tx0 = 930, T = [['draft', '240p · 4-step distilled student', 9, 'amber'], ['preview', '480p · 12 steps + step caching', 35, 'cyan'], ['final', '1080p · full model + VAE + SR', 95, 'lime']];
          function card(x, n, dur, cam, p1, p2) {
            var g = ctx.group({ parent: B, opacity: 0 });
            ctx.rect(x, 176, 236, 164, { rx: 10, fill: 'rgba(8,16,32,0.9)', stroke: ctx.alpha('magenta', 0.7), sw: 1.4, parent: g });
            ctx.text(x + 14, 198, 'SHOT ' + n, { size: 14, font: 'display', weight: 700, color: 'magenta', parent: g });
            ctx.text(x + 222, 198, dur, { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: g });
            ctx.text(x + 14, 226, cam, { size: 12, font: 'mono', color: 'cyan', parent: g });
            var t1 = ctx.text(x + 14, 256, p1, { size: 12, color: 'text', parent: g, opacity: 0 });
            var t2 = ctx.text(x + 14, 276, p2, { size: 12, color: 'text', parent: g, opacity: 0 });
            var st = ctx.label(x + 14, 316, 'streaming…', { color: 'amber', size: 11, anchor: 'start', parent: g });
            g.t1 = t1; g.t2 = t2; g.st = st;
            return g;
          }
          /* beat 0: deltas fill the buffer */
          function b0() {
            buf = code(ctx, B, { x: 470, y: 176, w: 570, title: 'plan.delta → accumulated buffer (partial JSON)', lang: 'json', size: 12, color: 'amber', typing: true, maxLines: 6, lines: [] });
            ctx.hud('planner tokens arrive as deltas');
            return ctx.reveal(buf, { from: 'left' }).then(function () { return buf.addLine('{"shots": ['); })
              .then(function () { return buf.addLine('  {"id": 1, "dur": 4.0, "camera": "slow push-in, 24mm",'); })
              .then(function () { return buf.addLine('   "prompt": "fox astronaut, cracked visor, falling'); })
              .then(function () { return buf.addLine('     through aurora toward a glowing ice moon"},'); });
          }
          /* beat 1: repair, parse, render cards */
          function b1() {
            rep = ctx.text(470, 356, 'repair: prefix + \'"}]}\' (close string, object, array, root) → JSON.parse → diff → render', { size: 12, font: 'mono', color: 'amber', parent: B, opacity: 0 });
            c1 = card(1070, 1, '4.0 s', 'slow push-in, 24mm', 'fox astronaut, cracked visor,', 'falling toward a glowing moon');
            c2 = card(1322, 2, '5.0 s', 'handheld, low angle', 'impact: ice shards burst,', 'blue rim…');
            return ctx.reveal(rep, { from: 'left', dur: 400 }).then(function () {
              ctx.reveal(c1, { from: 'scale', dur: 400 });
              return ctx.wait(300);
            }).then(function () {
              ctx.reveal([c1.t1, c1.t2], { dur: 300, stagger: 150 });
              c1.st.lastChild.textContent = 'complete ✓';
              c1.st.firstChild.setAttribute('stroke', ctx.alpha('lime', 0.7));
              c1.st.lastChild.setAttribute('fill', ctx.color('lime'));
              return buf.addLine('  {"id": 2, "dur": 5.0, "camera": "handheld, low angle",');
            }).then(function () {
              ctx.reveal(c2, { from: 'scale', dur: 400 });
              return buf.addLine('   "prompt": "impact: ice shards burst, blue rim');
            }).then(function () {
              return ctx.reveal([c2.t1, c2.t2], { dur: 300, stagger: 150 });
            });
          }
          /* beat 2: the draft tier */
          function b2() {
            var pv = ctx.group({ parent: B });
            S.pv = pv;
            heading(ctx, pv, 470, 410, 'PROGRESSIVE PREVIEWS · shot 2 "impact"', 'lime', { size: 14 });
            var RR = 12, CC = 20;
            var img = [];
            for (var r = 0; r < RR; r++) { img.push([]); for (var c = 0; c < CC; c++) img[r].push(moonImg((c + 0.5) / RR, (r + 0.5) / RR)); }
            var rn = ctx.rng(21), noise = [];
            for (var q = 0; q < 60; q++) noise.push((rn() - 0.5) * 60);
            tier = function (bs) {
              return function (r2, c2x) {
                var br = Math.floor(r2 / bs) * bs, bc = Math.floor(c2x / bs) * bs, acc = [0, 0, 0];
                for (var i = 0; i < bs; i++) for (var j = 0; j < bs; j++) { var p = img[Math.min(RR - 1, br + i)][Math.min(CC - 1, bc + j)]; acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2]; }
                var nz = bs === 4 ? noise[(br * 7 + bc * 3) % 60] : (bs === 2 ? noise[(br * 5 + bc) % 60] * 0.4 : 0);
                return rgb([acc[0] / (bs * bs) + nz, acc[1] / (bs * bs) + nz, acc[2] / (bs * bs) + nz]);
              };
            };
            frame = ctx.matrix(480, 432, RR, CC, { cell: 18, gap: 1, values: function () { return '#08101f'; } });
            pv.appendChild(frame);
            ctx.rect(474, 426, 391, 239, { rx: 6, stroke: ctx.alpha('lime', 0.6), sw: 1.4, parent: pv });
            tierT = ctx.text(480, 690, 'waiting for first pixels…', { size: 13, font: 'mono', color: 'dim', parent: pv });
            var tl = ctx.group({ parent: pv });
            ctx.line(tx0, 640, tx0 + tw, 640, { color: 'faint', parent: tl });
            [0, 20, 40, 60, 80, 100].forEach(function (s) { ctx.text(tx0 + s / 100 * tw, 656, s + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: tl }); });
            T.forEach(function (t, i) {
              var y = 460 + i * 56;
              ctx.text(tx0, y, t[0].toUpperCase(), { size: 13, font: 'display', weight: 700, color: t[3], parent: tl });
              ctx.text(tx0 + 80, y, t[1], { size: 12, font: 'mono', color: 'text', parent: tl });
              ctx.rect(tx0, y + 14, tw, 10, { rx: 3, fill: 'rgba(255,255,255,0.04)', parent: tl });
              tbar.push(ctx.rect(tx0, y + 14, 0, 10, { rx: 3, fill: ctx.alpha(t[3], 0.7), parent: tl }));
              ctx.line(tx0 + t[2] / 100 * tw, 630, tx0 + t[2] / 100 * tw, 640, { color: t[3], sw: 2, parent: tl });
            });
            ev = ctx.label(930, 700, 'event: preview.ready {shot:2, tier:"draft", url:"…/s2_240p.mp4"}', { color: 'violet', size: 12, anchor: 'start', parent: pv, opacity: 0 });
            ctx.hud('first pixels at ~9 s instead of ~95 s');
            ctx.reveal(pv, { from: 'up', dur: 500 });
            return ctx.wait(500).then(function () {
              return ctx.tween(1200, function (e) { tbar[0].setAttribute('width', e * 9 / 100 * tw); });
            }).then(function () {
              frame.set(tier(4)); tierT.textContent = 'DRAFT · 240p · +9 s · noisy, blocky, but composable'; tierT.setAttribute('fill', ctx.color('amber'));
              return ctx.reveal(ev, { from: 'left', dur: 300 });
            });
          }
          /* beat 3: preview then final, swapped in place */
          function b3() {
            return ctx.tween(1500, function (e) { tbar[1].setAttribute('width', e * 35 / 100 * tw); }).then(function () {
              frame.set(tier(2)); tierT.textContent = 'PREVIEW · 480p · +35 s'; tierT.setAttribute('fill', ctx.color('cyan'));
              return ctx.tween(1800, function (e) { tbar[2].setAttribute('width', e * 95 / 100 * tw); });
            }).then(function () {
              frame.set(tier(1)); tierT.textContent = 'FINAL · 1080p · +95 s · swapped in place'; tierT.setAttribute('fill', ctx.color('lime'));
              return ctx.pulse(frame, { color: 'lime', dur: 700 });
            });
          }
          /* beat 4: cancel after the draft */
          function b4() {
            var g = ctx.group({ parent: S.pv, opacity: 0 });
            var skip = ctx.rect(tx0 + 9 / 100 * tw, 460 + 2 * 56 + 11, (95 - 9) / 100 * tw, 16, { rx: 4, fill: ctx.alpha('red', 0.1), stroke: ctx.alpha('red', 0.9), sw: 1.4, dash: '5 3', parent: g });
            ctx.text(tx0 + 9 / 100 * tw + (95 - 9) / 200 * tw, 460 + 2 * 56 + 46, 'never spent if cancelled after the draft', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: g });
            var cancel = ctx.label(1500, 460, '✕ cancel / redirect', { color: 'red', size: 12, parent: g });
            var foot = ctx.text(930, 740, 'creator can cancel / redirect after the draft → most of the shot\'s GPU time is never spent', { size: 12, font: 'mono', color: 'dim', parent: g });
            return ctx.reveal(g, { from: 'fade', dur: 500 }).then(function () { return ctx.pulse(cancel, { color: 'red', times: 2, dur: 600 }); });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4);
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Playback & ABR',
        beats: [
          {
            say: 'Finally, playback. The finished trailer is packaged as short CMAF segments in a bitrate ladder, described by an HLS or DASH manifest.',
            card: { tag: 'NUMBERS', title: 'A ladder of two second segments', stat: { v: '2 s', u: 'segments', l: 'four rungs from 0.6 to 6 Mb/s: every ABR decision picks one rung for the next segment' } },
            deep: '<p><b>Packaging</b>: the same CMAF (fragmented MP4) segments serve both HLS (<code>.m3u8</code>) and DASH (<code>.mpd</code>), so one set of files on the CDN covers Safari, Chrome and smart TVs. A master playlist lists the rungs; each rung has its own media playlist of 2 s segments.</p>' +
              '<p>The ladder is often chosen per title: a mostly static animation reaches good quality at lower bitrates than a fast-moving action shot, so rungs are fitted to the content\'s rate-distortion curve. Production ladders usually carry five to eight rungs; four are drawn here so the simulation stays readable.</p>'
          },
          {
            say: 'The player fetches segments from the CDN and appends them to a Media Source Extensions buffer, which the hardware decoder drains.',
            card: { tag: 'HOW IT WORKS', title: 'A buffer between two speeds', body: 'Fetch, <code>appendBuffer</code>, decode. The buffer is the shock absorber between a noisy network and steady playback.' },
            deep: '<p><b>Pipeline</b>: manifest (<code>.m3u8</code> or <code>.mpd</code>) → fetch a 2 s CMAF fMP4 segment → <code>SourceBuffer.appendBuffer()</code> → hardware decode. Low-latency variants use chunked transfer of partial segments (LL-HLS parts, about 200–500 ms).</p>' +
              '<p>Everything the ABR logic can control is one decision per segment: which rung to request next. Everything else, including how many seconds are buffered, is a consequence.</p>'
          },
          {
            say: 'Before each fetch, an adaptive bitrate algorithm must pick a rung. Throughput rules estimate bandwidth from recent downloads. Buffer rules like BOLA choose from buffer occupancy alone.',
            card: {
              tag: 'TRADE-OFF', title: 'Predict the network or watch the buffer', body: 'Throughput rules react fast but oscillate on noisy links. Buffer rules need no prediction but start cautiously.',
              more: '<p>BOLA comes from Lyapunov drift-plus-penalty optimization: it maximizes time-average utility subject to a stable buffer. Each decision minimizes buffer drift plus V times the utility penalty, which reduces to the argmax rule. V trades quality against buffer size, and the log utility makes bitrates proportionally fair.</p>'
            },
            deep: '<p><b>Throughput rule</b>: pick the highest rung with R<sub>m</sub> ≤ α·Ĉ, where Ĉ is the harmonic mean of the last k segment throughputs (robust to outliers) and α ≈ 0.8–0.9. It reacts fast but oscillates on noisy links.</p>' +
              '<p><b>BOLA</b> (Lyapunov drift-plus-penalty): with buffer Q in segments and utilities v<sub>m</sub> = ln(S<sub>m</sub>/S<sub>1</sub>),</p>' +
              '<div class="eq">m* = argmax<sub>m</sub> [ V·(v<sub>m</sub> + γp) − Q ] / S<sub>m</sub> &nbsp; (download nothing if all ≤ 0)</div>' +
              '<p>The buffer-based idea goes back to Huang et al. (SIGCOMM 2014), who mapped buffer level directly to a rung.</p>' +
              '<p>Learned policies such as Pensieve (SIGCOMM 2017) looked strong in simulation, but the Puffer randomized trial (Yan et al., NSDI 2020) found that Fugu, model-predictive control driven by a learned transfer-time predictor, beat both buffer-based rules and Pensieve on real viewers\' stalls and picture quality.</p>'
          },
          {
            say: 'When the train enters a tunnel at sixteen seconds, the throughput rule notices only after a slow download, then steps down twice. The buffer shrinks to under two seconds, but nothing stalls.',
            card: { tag: 'NUMBERS', title: 'A near miss', stat: { v: '1.7 s', u: 'minimum buffer', l: 'throughput rule inside the tunnel in this simulation: no stall, but almost' } },
            deep: '<p>The throughput rule keeps requesting 6 Mb/s until a slow download exposes the drop at 16 s. It then falls to 3.0 and 1.2 Mb/s, and the buffer drains from about 5 s to a low of 1.7 s before recovering. A slightly longer tunnel would rebuffer.</p>' +
              '<p>Its weakness is the estimator: every measurement is one segment old, and the harmonic mean over three segments needs several slow downloads to move.</p>' +
              '<div class="note">Simulation: 2 s segments, ladder 0.6 / 1.2 / 3.0 / 6.0 Mb/s, link 7.5 then 1.6 (16 to 34 s) then 5.0 Mb/s.</div>'
          },
          {
            say: 'BOLA ignores bandwidth entirely. It keeps the top rung while the buffer is deep, steps down only as the buffer drains toward its thresholds, and holds a much larger safety margin, at the cost of more switching.',
            card: { tag: 'NUMBERS', title: 'Quality and margin, more switches', stat: { v: '+40%', u: 'mean bitrate', l: 'BOLA 4.8 versus 3.4 Mb/s for the throughput rule here, with a 7.5 s minimum buffer, but 15 rung switches instead of 4' } },
            deep: '<p>This yields buffer thresholds per rung; BOLA is provably within O(1/V) of the optimal utility with no bandwidth prediction. Here V = (Q<sub>max</sub>−1)/(v<sub>M</sub>+γp), γp = 5, Q<sub>max</sub> = 10 segments, which puts the rung switch points at 10.6, 12.5 and 14.6 s of buffer (dashed lines).</p>' +
              '<p>dash.js <i>DYNAMIC</i> switches between the two: throughput rule at startup and after seeks, BOLA once the buffer is healthy. hls.js and Shaka use EWMA throughput estimators.</p>' +
              '<details><summary>Go deeper</summary><p>A common QoE objective (MPC-style): Σ q(R<sub>k</sub>) − λ·rebuffer − μ·Σ|q(R<sub>k+1</sub>) − q(R<sub>k</sub>)|. Its switch penalty is why production players add hysteresis or a minimum dwell time on top of raw BOLA.</p></details>'
          },
          {
            say: 'Now change the tunnel. Click the bandwidth chart to make the tunnel deeper or shallower, and watch which rule stalls first.',
            card: { tag: 'TRY IT', title: 'Click the chart to change the tunnel', body: 'It cycles through 1.6, 0.8, 0.4 and 3.0 Mb/s. At 0.8 the throughput rule stalls for about four seconds; BOLA never does.' },
            deep: '<p>A tunnel below the lowest rung (0.4 Mb/s against 0.6) makes every player stall eventually; what differs is how long the buffer postpones it. In this simulation the throughput rule rebuffers for 3.8 s at 0.8 Mb/s and 11.8 s at 0.4 Mb/s, while BOLA never stalls, because it has already stepped down by the time the buffer runs low.</p>' +
              '<p>The price is visible in the last line under the charts: BOLA switches rungs several times more often. Real players trade the two with hysteresis and dwell-time limits.</p>'
          },
          {
            say: 'That completes the client: upload, control, feedback and playback. Every path was designed so that a flaky network costs the creator time, never work.',
            card: { tag: 'WHY IT MATTERS', title: 'Four paths, no lost work', body: 'Resumable uploads, idempotent commands, replayable events and buffered playback: each turns a failure into a delay.' },
            deep: '<p>Recap of the four independent network paths and their recovery mechanism: <b>upload</b> (multipart parts, content addressing, <code>ListParts</code>), <b>control</b> (idempotency keys, 202 and a job id), <b>feedback</b> (SSE with <code>Last-Event-ID</code> replay) and <b>playback</b> (CMAF segments and a buffer-driven ABR).</p>' +
              '<p>The next chamber follows the request across the wire, through the edge, gateway and admission control, before any GPU is touched.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, null);
          var B = newBench(ctx);
          heading(ctx, B, 470, 186, 'PLAYBACK · HLS / DASH via Media Source Extensions · ABR', 'orange');
          var tun = 1.6, tp = simulate('tput', tun), bo = simulate('bola', tun);
          function avg(rate) { var s = 0, T = 0; for (var i = 0; i + 1 < rate.length; i += 2) { var d = rate[i + 1][0] - rate[i][0]; s += rate[i][1] * d; T += d; } return T ? s / T : 0; }
          function minBuf(sim) { var m = 99; sim.buf.forEach(function (p) { if (p[0] > 16 && p[1] < m) m = p[1]; }); return m; }
          function switches(sim) { var n = 0; for (var i = 2; i < sim.rate.length; i += 2) if (sim.rate[i][1] !== sim.rate[i - 2][1]) n++; return n; }
          function statsText() {
            return 'rebuffer: throughput ' + tp.stall.toFixed(1) + ' s · BOLA ' + bo.stall.toFixed(1) + ' s   |   mean bitrate ' + avg(tp.rate).toFixed(1) + ' vs ' + avg(bo.rate).toFixed(1) + ' Mb/s   |   min buffer ' + minBuf(tp).toFixed(1) + ' vs ' + minBuf(bo).toFixed(1) + ' s   |   switches ' + switches(tp) + ' vs ' + switches(bo);
          }
          /* same mapping as ctx.plot: polyline path for points in a plot box */
          function planPath(pts, x, y, w, h, ymax) {
            return pts.map(function (p, i) {
              return (i ? 'L' : 'M') + (x + p[0] / 60 * w).toFixed(1) + ',' + (y + h - p[1] / ymax * h).toFixed(1);
            }).join(' ');
          }
          var man, lad, mse, g1, g2, leg, pBw, pT, pB, pBb, pTb, statsT, tunT, rc;
          /* re-run both simulations for a new tunnel bandwidth and redraw the curves in place */
          function setTunnel(v, animate) {
            tun = v;
            tp = simulate('tput', tun); bo = simulate('bola', tun);
            pBw.curve.setAttribute('d', planPath([[0, 7.5], [16, 7.5], [16, tun], [34, tun], [34, 5.0], [60, 5.0]], 520, 222, 600, 190, 8));
            pT.curve.setAttribute('d', planPath(tp.rate, 520, 222, 600, 190, 8));
            pB.curve.setAttribute('d', planPath(bo.rate, 520, 222, 600, 190, 8));
            pTb.curve.setAttribute('d', planPath(tp.buf, 520, 480, 600, 150, 22));
            pBb.curve.setAttribute('d', planPath(bo.buf, 520, 480, 600, 150, 22));
            tunT.textContent = 'tunnel 16–34 s: ' + tun.toFixed(1) + ' Mb/s';
            statsT.textContent = statsText();
            if (!animate) return Promise.resolve();
            return Promise.all([pBw, pT, pB, pTb, pBb].map(function (p) { return ctx.reveal(p.curve, { from: 'draw', dur: 1200, ease: 'linear' }); })).then(function () {
              pBw.curve.setAttribute('stroke-dasharray', '5 4');        /* the capacity trace stays dashed even after overlapping redraws */
            });
          }
          /* beat 0: ladder + manifest */
          function b0() {
            ctx.hud('CMAF · 2 s segments · 4-rung ladder');
            lad = ctx.group({ parent: B });
            heading(ctx, lad, 1180, 222, 'LADDER (CMAF, 2 s segments)', 'orange', { size: 13 });
            [['1080p', 6.0], ['720p', 3.0], ['480p', 1.2], ['360p', 0.6]].forEach(function (l, i) {
              var y = 252 + i * 34;
              ctx.text(1180, y + 9, l[0], { size: 12, font: 'mono', color: 'text', parent: lad });
              ctx.rect(1238, y, l[1] / 6 * 250, 18, { rx: 3, fill: ctx.alpha('orange', 0.25), stroke: 'orange', sw: 1, parent: lad });
              ctx.text(1238 + l[1] / 6 * 250 + 8, y + 9, l[1].toFixed(1) + ' Mb/s', { size: 12, font: 'mono', color: 'orange', parent: lad });
            });
            man = code(ctx, B, { x: 470, y: 222, w: 620, title: 'master.m3u8 (HLS)', lang: 'text', size: 12, color: 'orange', lines: [
              '#EXTM3U   #EXT-X-VERSION:7',
              '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
              '1080p/index.m3u8',
              '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720',
              '720p/index.m3u8',
              '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480',
              '480p/index.m3u8',
              '#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360',
              '360p/index.m3u8'
            ] });
            return Promise.all([ctx.reveal(lad, { from: 'up' }), ctx.reveal(man, { from: 'left', delay: 200 })]);
          }
          /* beat 1: MSE pipeline */
          function b1() {
            mse = ctx.group({ parent: B });
            var n1 = ctx.node({ x: 1370, y: 440, w: 300, h: 44, title: 'fetch seg_17.m4s (CDN)', icon: 'globe', color: 'orange', titleSize: 13, parent: mse });
            var n2 = ctx.node({ x: 1370, y: 510, w: 300, h: 44, title: 'SourceBuffer.appendBuffer', icon: 'layers', color: 'orange', titleSize: 13, parent: mse });
            var n3 = ctx.node({ x: 1370, y: 580, w: 300, h: 44, title: '<video> · HW decode (AV1/HEVC)', icon: 'film', color: 'orange', titleSize: 13, parent: mse });
            var k1 = ctx.link(n1, n2, { color: 'orange', parent: mse }), k2 = ctx.link(n2, n3, { color: 'orange', parent: mse });
            ctx.text(1370, 626, 'ABR decides before every fetch', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: mse });
            return ctx.reveal(mse, { from: 'right' }).then(function () {
              return ctx.packet(k1, { color: 'orange', dur: 500, label: 'seg_17' });
            }).then(function () { return ctx.packet(k2, { color: 'orange', dur: 500 }); }).then(function () {
              return ctx.pulse(n3, { color: 'orange', dur: 600 });
            });
          }
          /* beat 2: the decision problem; capacity trace */
          function b2() {
            ctx.remove(man, 400);
            g1 = ctx.group({ parent: B });
            ctx.rect(520, 222, 600, 190, { fill: 'rgba(0,0,0,0.001)', parent: g1 });
            pBw = ctx.plot(520, 222, 600, 190, [[0, 7.5], [16, 7.5], [16, tun], [34, tun], [34, 5.0], [60, 5.0]], { xDomain: [0, 60], yDomain: [0, 8], color: ctx.alpha('white', 0.45), sw: 1.4, yLabel: 'Mb/s', xLabel: 'time (s)', parent: g1 });
            pBw.curve.setAttribute('stroke-dasharray', '5 4');
            pBw.curve.setAttribute('opacity', 0);
            ctx.text(1116, 234, 'link capacity', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g1 });
            tunT = ctx.text(770, 448, 'tunnel 16–34 s: ' + tun.toFixed(1) + ' Mb/s', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: g1 });
            [0, 2, 4, 6, 8].forEach(function (v) { ctx.text(512, 222 + 190 - v / 8 * 190, String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g1 }); });
            [0, 10, 20, 30, 40, 50].forEach(function (s) { ctx.text(520 + s / 60 * 600, 424, String(s), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g1 }); });
            leg = ctx.group({ parent: B });
            ctx.line(520, 676, 548, 676, { color: 'orange', sw: 2.4, parent: leg });
            ctx.text(556, 676, 'throughput rule (0.85 × harmonic mean of last 3)', { size: 12, font: 'mono', color: 'orange', parent: leg });
            ctx.line(520, 700, 548, 700, { color: 'violet', sw: 2.4, parent: leg });
            ctx.text(556, 700, 'BOLA (buffer-based, γp = 5, Qmax = 10 segs)', { size: 12, font: 'mono', color: 'violet', parent: leg });
            ctx.hud('ABR: one ladder rung per 2 s segment');
            return Promise.all([ctx.reveal(g1, { from: 'up' }), ctx.reveal(leg, { from: 'up', delay: 200 })]).then(function () {
              return ctx.reveal(pBw.curve, { from: 'draw', dur: 1400, ease: 'linear' });
            });
          }
          /* beat 3: throughput rule through the tunnel */
          function b3() {
            g2 = ctx.group({ parent: B });
            pTb = ctx.plot(520, 480, 600, 150, tp.buf, { xDomain: [0, 60], yDomain: [0, 22], color: 'orange', sw: 1.8, yLabel: 'buffer (s)', xLabel: 'time (s)', parent: g2 });
            [0, 10, 20].forEach(function (v) { ctx.text(512, 480 + 150 - v / 22 * 150, String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g2 }); });
            [0, 10, 20, 30, 40, 50].forEach(function (s) { ctx.text(520 + s / 60 * 600, 642, String(s), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g2 }); });
            pT = ctx.plot(520, 222, 600, 190, tp.rate, { xDomain: [0, 60], yDomain: [0, 8], color: 'orange', sw: 2.2, axes: false, parent: g1 });
            ctx.reveal(g2, { from: 'fade', dur: 300 });
            return Promise.all([
              ctx.reveal(pT.curve, { from: 'draw', dur: 2600, ease: 'linear' }),
              ctx.reveal(pTb.curve, { from: 'draw', dur: 2600, ease: 'linear' })
            ]);
          }
          /* beat 4: BOLA */
          function b4() {
            pB = ctx.plot(520, 222, 600, 190, bo.rate, { xDomain: [0, 60], yDomain: [0, 8], color: 'violet', sw: 2.2, axes: false, parent: g1 });
            pBb = ctx.plot(520, 480, 600, 150, bo.buf, { xDomain: [0, 60], yDomain: [0, 22], color: 'violet', sw: 1.8, axes: false, parent: g2 });
            var th = [10.6, 12.5, 14.6].map(function (v) { return ctx.line(520, 480 + 150 - v / 22 * 150, 1120, 480 + 150 - v / 22 * 150, { color: ctx.alpha('violet', 0.25), sw: 1, dash: '2 4', parent: g2 }); });
            var thT = ctx.text(1120, 470, 'BOLA rung thresholds', { size: 11, font: 'mono', color: 'violet', anchor: 'end', parent: g2 });
            statsT = ctx.text(520, 730, statsText(), { size: 12, font: 'mono', color: 'text', parent: B, opacity: 0 });
            return Promise.all([
              ctx.reveal(pB.curve, { from: 'draw', dur: 2600, ease: 'linear' }),
              ctx.reveal(pBb.curve, { from: 'draw', dur: 2600, ease: 'linear' }),
              ctx.reveal(th.concat([thT]), { from: 'fade', dur: 500, stagger: 100 })
            ]).then(function () { return ctx.reveal(statsT, { from: 'left' }); });
          }
          /* beat 5: click the chart to change the tunnel (interactive) */
          function b5() {
            var TUN = [1.6, 0.8, 0.4, 3.0];
            var idx = 0;
            var hint = ctx.label(1345, 690, '▶ click the chart to change the tunnel', { color: 'amber', size: 12, parent: B, opacity: 0 });
            g1.style.cursor = 'pointer';
            g1.addEventListener('click', function () {
              idx = (idx + 1) % TUN.length;
              setTunnel(TUN[idx], true);
            });
            return ctx.reveal(hint, { from: 'up' }).then(function () { return ctx.pulse(g1, { color: 'amber', times: 2, dur: 700 }); }).then(function () {
              /* one demonstration click: a shallower tunnel makes the throughput rule stall */
              idx = 1;
              return setTunnel(TUN[idx], true);
            });
          }
          /* beat 6: recap */
          function b6() {
            rc = ctx.group({ parent: B });
            var chips = [['UPLOAD · multipart · dedup', 'teal'], ['CONTROL · PKCE · idempotent', 'blue'], ['FEEDBACK · SSE · resume', 'cyan'], ['PLAYBACK · CMAF · ABR', 'orange']];
            var x = 470;
            chips.forEach(function (c) { var l = ctx.label(x, 800, c[0], { color: c[1], size: 12, anchor: 'start', parent: rc }); x += l.w + 14; });
            return ctx.reveal(rc, { from: 'up', dur: 600 }).then(function () { return ctx.pulse(rc, { color: 'cyan', dur: 700 }); });
          }
          return b0().then(function () { return ctx.beat(1); }).then(b1)
            .then(function () { return ctx.beat(2); }).then(b2)
            .then(function () { return ctx.beat(3); }).then(b3)
            .then(function () { return ctx.beat(4); }).then(b4)
            .then(function () { return ctx.beat(5); }).then(b5)
            .then(function () { return ctx.beat(6); }).then(b6);
        }
      }
    ]
  });
})();
