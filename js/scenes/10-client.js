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

  /* HOL-blocking mini simulation: returns update(t) */
  function holPanel(ctx, g, x0, quic) {
    var cols = ['cyan', 'teal', 'amber'];
    var laneY = [672, 700, 728];
    var pipeA = x0 + 40, pipeB = x0 + 290, bufX = x0 + 300, appX = x0 + 392;
    var N = 12, L = 4, transit = 0.6, reSend = 1.8;
    if (quic) laneY.forEach(function (y, i) { ctx.rect(pipeA, y - 9, pipeB - pipeA, 18, { rx: 9, fill: ctx.alpha(cols[i], 0.06), stroke: ctx.alpha(cols[i], 0.45), sw: 1, parent: g }); });
    else ctx.rect(pipeA, 687, pipeB - pipeA, 26, { rx: 13, fill: 'rgba(77,141,255,0.06)', stroke: ctx.alpha('blue', 0.5), sw: 1, parent: g });
    ctx.rect(bufX - 4, 658, 86, 84, { rx: 6, fill: 'rgba(255,255,255,0.02)', stroke: 'faint', sw: 1, dash: '3 3', parent: g });
    ctx.text(bufX + 39, 752, 'recv buffer', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    ['events', 'upload', 'api'].forEach(function (s, i) {
      ctx.line(appX - 4, laneY[i] + 8, appX + 44, laneY[i] + 8, { color: ctx.alpha(cols[i], 0.4), sw: 1, parent: g });
      ctx.text(appX + 52, laneY[i], s, { size: 12, font: 'mono', color: cols[i], parent: g });
    });
    ctx.text(appX + 20, 752, 'app', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    var P = [];
    for (var i = 0; i < N; i++) {
      var s = i % 3, send = i * 0.14;
      var arr = i === L ? reSend + transit : send + transit;
      P.push({ i: i, s: s, send: send, arr: arr, el: ctx.rect(0, 0, 9, 12, { rx: 2, fill: cols[s], parent: g, opacity: 0 }) });
    }
    /* in-order delivery: TCP across everything, QUIC per stream */
    P.forEach(function (p, k) {
      var d = p.arr;
      for (var j = 0; j < k; j++) if (!quic || P[j].s === p.s) d = Math.max(d, P[j].del);
      p.del = d;
    });
    var X = ctx.text((pipeA + pipeB) / 2 + 12, 700, '✕', { size: 17, weight: 700, color: 'red', anchor: 'middle', parent: g, opacity: 0 });
    return function (t) {
      var held = [], delivered = [[], [], []];
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
      X.setAttribute('opacity', t > P[L].send + transit * 0.5 ? 1 : 0);
    };
  }

  /* ABR simulation on a bandwidth trace (Mb/s). kind: 'tput' | 'bola' */
  var LADDER = [0.6, 1.2, 3.0, 6.0];
  function bwAt(t) { return t < 16 ? 7.5 : (t < 34 ? 1.6 : 5.0); }
  function simulate(kind) {
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
        var b = bwAt(tt), edge = tt < 16 ? 16 : (tt < 34 ? 34 : 1e9), cap = b * (edge - tt);
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
      'Sakimura et al., <i>RFC 7636: Proof Key for Code Exchange (PKCE)</i>, 2015; Lodderstedt et al., <i>RFC 9700: OAuth 2.0 Security Best Current Practice</i>, 2025',
      'Fett et al., <i>RFC 9449: OAuth 2.0 Demonstrating Proof of Possession (DPoP)</i>, IETF 2023',
      'WHATWG, <i>HTML Living Standard, §9.2 Server-sent events</i>; IETF, <i>The Idempotency-Key HTTP Header Field</i> (draft-ietf-httpapi-idempotency-key-header)',
      'Amazon Web Services, <i>Amazon S3 User Guide: multipart upload limits and additional checksums</i>, 2025; tus.io, <i>tus resumable upload protocol 1.0</i>; IETF draft-ietf-httpbis-resumable-upload',
      'Spiteri, Urgaonkar &amp; Sitaraman, <i>BOLA: Near-Optimal Bitrate Adaptation for Online Videos</i>, IEEE INFOCOM 2016',
      'Huang et al., <i>A Buffer-Based Approach to Rate Adaptation: Evidence from a Large Video Streaming Service</i>, ACM SIGCOMM 2014'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Client anatomy',
        say: 'Zoom into the creator\'s device. The app is far more than a text box. It has a composer, a media picker, a background worker that preprocesses files, an upload manager, an auth session, an event stream client, and a state store that ties them together. Three very different kinds of traffic leave this device: small authenticated commands, large resumable media uploads that go straight to object storage, and a long-lived stream of events flowing back.',
        deep: '<p>The client is a small distributed-systems node in its own right. It owns three independent network paths with different traffic shapes and failure semantics:</p>' +
          '<table><tr><th>Path</th><th>Payload</th><th>Protocol</th><th>Failure handling</th></tr>' +
          '<tr><td>Control</td><td>KB of JSON</td><td>HTTPS h2/h3, OIDC bearer</td><td>idempotency keys, 202 + job_id</td></tr>' +
          '<tr><td>Upload</td><td>MB–GB media</td><td>pre-signed PUTs to object store</td><td>per-part retry, resumable</td></tr>' +
          '<tr><td>Feedback</td><td>~10<sup>2</sup>–10<sup>3</sup> events/job</td><td>SSE over h2/h3</td><td>Last-Event-ID replay</td></tr></table>' +
          '<p>The <b>state store</b> is a normalized, event-sourced cache (<code>jobs</code>, <code>uploads</code>, <code>events</code>) persisted to IndexedDB, so a closed tab or killed mobile app resumes uploads and streams. UI state is a <i>projection</i> of server events; optimistic updates are reconciled by event id.</p>' +
          '<div class="note">Design rule: bulk bytes never transit the API tier. The API issues capabilities (pre-signed URLs, job ids); storage and the event bus move the data.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.dev = ctx.group();
          ctx.rect(40, 165, 360, 675, { rx: 24, fill: 'rgba(7,14,28,0.88)', stroke: 'cyan', sw: 1.6, glow: true, parent: S.dev });
          ctx.text(64, 196, 'CLIENT APP', { size: 14, font: 'display', weight: 700, color: 'cyan', spacing: 2, parent: S.dev });
          ctx.text(376, 196, 'web · iOS · Android', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.dev });
          ctx.reveal(S.dev, { from: 'left' });
          S.mods = {};
          var list = MODS.map(function (m, i) {
            var n = ctx.node({ x: 220, y: 250 + i * 86, w: 316, h: 62, title: m[1], sub: m[2], icon: m[3], color: m[0] === 'store' ? 'teal' : 'cyan', titleSize: 15, subSize: 12, glow: false });
            S.mods[m[0]] = n;
            return n;
          });
          ctx.reveal(list, { from: 'left', stagger: 100, delay: 200 });

          S.ov = ctx.group();
          var T = [['API Gateway', 'HTTPS · JSON · OIDC', 'shield', 'blue', 250],
            ['Object Storage', 'S3 API · pre-signed', 'db', 'teal', 508],
            ['Event Stream', 'SSE · typed events', 'net', 'cyan', 680]];
          S.tg = T.map(function (t) { return ctx.node({ x: 1430, y: t[4], w: 250, h: 70, title: t[0], sub: t[1], icon: t[2], color: t[3], parent: S.ov }); });
          ctx.reveal(S.tg, { from: 'right', stagger: 150, delay: 700 });
          var l1 = ctx.link(S.mods.comp, S.tg[0], { color: 'blue', from: 'r', to: 'l', parent: S.ov });
          var l2 = ctx.link(S.mods.upl, S.tg[1], { color: 'teal', from: 'r', to: 'l', parent: S.ov, sw: 3 });
          var l3 = ctx.link(S.tg[2], S.mods.evt, { color: 'cyan', from: 'l', to: 'r', parent: S.ov, dash: '5 5' });
          S.lanes = [l1, l2, l3];
          ctx.reveal(S.lanes, { from: 'draw', delay: 900, stagger: 200 });
          var D = [['CONTROL PATH · KB of JSON', 'authenticated · idempotent · 202 + job_id', 'blue', 250],
            ['UPLOAD PATH · MB to GB of media', 'direct to storage · resumable · content-addressed', 'teal', 508],
            ['FEEDBACK PATH · server push', 'typed events · resumable · progressive previews', 'cyan', 680]];
          var txt = [];
          D.forEach(function (d) {
            txt.push(ctx.text(840, d[3] - 44, d[0], { size: 14, font: 'display', weight: 700, color: d[2], anchor: 'middle', parent: S.ov }));
            txt.push(ctx.text(840, d[3] - 25, d[1], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.ov }));
          });
          ctx.reveal(txt, { from: 'up', delay: 1200, stagger: 80 });
          /* platform primitives strip */
          var prim = ctx.group({ parent: S.ov });
          ctx.text(470, 780, 'PLATFORM PRIMITIVES', { size: 12, font: 'display', weight: 700, color: 'dim', spacing: 1.5, parent: prim });
          var px = 470;
          [['Web Worker / WASM', 'cyan'], ['IndexedDB', 'teal'], ['WebCodecs', 'orange'], ['fetch + Streams', 'blue'], ['EventSource', 'cyan'], ['Service Worker sync', 'violet'], ['MSE player', 'orange']].forEach(function (p) {
            var l = ctx.label(px, 812, p[0], { color: p[1], size: 12, anchor: 'start', parent: prim });
            px += l.w + 12;
          });
          ctx.reveal(prim, { from: 'up', delay: 1500 });
          S.ovStreams = [];
          return ctx.wait(1700).then(function () {
            S.ovStreams.push(ctx.stream(l1, { color: 'blue', count: 2, period: 2600 }));
            S.ovStreams.push(ctx.stream(l2, { color: 'teal', count: 6, period: 1800, r: 4.5 }));
            S.ovStreams.push(ctx.stream(l3, { color: 'cyan', count: 4, period: 2200 }));
            return Promise.all([
              ctx.packet(l1, { color: 'blue', dur: 1100, label: 'POST /v1/jobs' }),
              ctx.packet(l2, { color: 'teal', dur: 1400, label: 'part 1 / 5' }),
              ctx.packet(l3, { color: 'cyan', dur: 1200, label: 'shot.progress' })
            ]);
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'On-device preprocessing',
        say: 'Before a single byte leaves the device, a background worker prepares the media. It streams each file through SHA-256 to get a content address, so anything the server already has costs nothing to upload. The voice memo was sent yesterday, so it is skipped. The worker strips GPS coordinates from the photo metadata, makes a thumbnail and a perceptual hash, and transcodes the memo into a tiny Opus proxy, so speech recognition can start while the original is still uploading.',
        deep: '<p><b>Content addressing.</b> The object key is the digest: <code>sha256:9f2c…b71d</code>. A <code>HEAD /v1/blobs/{digest}</code> turns re-uploads into no-ops across sessions and devices. Collision probability for <i>n</i> blobs is bounded by the birthday bound:</p>' +
          '<div class="eq">P<sub>collide</sub> ≤ n² / 2<sup>257</sup> &nbsp;(n = 10<sup>12</sup> ⇒ ≈ 10<sup>−53</sup>)</div>' +
          '<p>WebCrypto <code>digest()</code> is one-shot (whole buffer in memory), so large files are hashed incrementally with a WASM SHA-256 inside a Web Worker, reading 1 MiB <code>Blob.slice()</code>s — constant memory, UI thread untouched. The same pass can compute per-part checksums for the multipart upload.</p>' +
          '<ul><li><b>EXIF/GPS strip</b>: rewrite metadata segments only; never re-encode pixels (no generation loss). Keep <code>Orientation</code> (dropping it silently rotates the image) and the ICC profile; drop GPS, serials, maker notes.</li>' +
          '<li><b>Thumbnail + pHash</b>: 256² WebP for instant UI; 64-bit DCT pHash for near-duplicate detection (Hamming distance ≤ 6–10).</li>' +
          '<li><b>Proxy transcode</b> (WebCodecs): AAC 256 kb/s → Opus 24 kb/s mono, ~10× smaller; ASR and speaker embedding start on the proxy, the original follows for voice cloning quality.</li></ul>' +
          '<div class="note">Trust boundary: the client digest is a <i>hint</i>. Storage recomputes the checksum and the server never trusts client-side stripping for policy decisions.</div>',
        run: function (ctx) {
          var S = ctx.state;
          (S.ovStreams || []).forEach(function (h) { h.stop(); });
          ctx.remove(S.ov, 450);
          focusMod(ctx, 'pre');
          var B = newBench(ctx);
          ctx.line(386, 422, 456, 422, { color: 'cyan', dash: '3 4', parent: B });
          heading(ctx, B, 470, 186, '① CONTENT ADDRESS · streaming SHA-256 in a Web Worker');
          ctx.text(1558, 186, 'state H0…H7 (8 × 32 bit)', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: B });
          var chunks = [];
          for (var i = 0; i < 24; i++) chunks.push(ctx.rect(470 + i * 31, 206, 28, 30, { rx: 3, fill: 'rgba(34,228,255,0.06)', stroke: ctx.alpha('cyan', 0.35), sw: 1, parent: B }));
          ctx.text(470, 254, 'sketch_03.png · 23.4 MiB · 1 MiB slices · 64-byte blocks × 64 rounds each', { size: 12, font: 'mono', color: 'dim', parent: B });
          var IV = ['6a09e667', 'bb67ae85', '3c6ef372', 'a54ff53a', '510e527f', '9b05688c', '1f83d9ab', '5be0cd19'];
          var FIN = ['9f2c4e1a', 'd07b3c55', 'e8a1f0b2', '4c9d7e13', 'a6b82f04', '17ce5d9a', 'f3086b2e', 'c463b71d'];
          var r = ctx.rng(11), mid = [];
          for (var k = 0; k < 25; k++) { var row = []; for (var j = 0; j < 8; j++) row.push(('0000000' + Math.floor(r() * 4294967296).toString(16)).slice(-8)); mid.push(row); }
          var wcells = [], wtext = [];
          for (var w = 0; w < 8; w++) {
            var cx = 1250 + (w % 4) * 78, cy = 204 + Math.floor(w / 4) * 25;
            wcells.push(ctx.rect(cx, cy, 74, 21, { rx: 3, fill: 'rgba(155,123,255,0.08)', stroke: ctx.alpha('violet', 0.5), sw: 1, parent: B }));
            wtext.push(ctx.text(cx + 37, cy + 11, IV[w], { size: 11, font: 'mono', color: 'violet', anchor: 'middle', parent: B }));
          }
          var dig = ctx.text(470, 290, '', { size: 13, font: 'mono', color: 'white', parent: B });
          var d1 = ctx.label(470, 326, 'HEAD /v1/blobs/sha256:9f2c…b71d → 404 → upload', { color: 'amber', size: 12, anchor: 'start', parent: B });
          var d2 = ctx.label(470 + d1.w + 18, 326, 'memo.m4a sha256:41aa…09e2 → 200 → skip (dedup)', { color: 'lime', size: 12, anchor: 'start', parent: B });
          d1.setAttribute('opacity', 0); d2.setAttribute('opacity', 0);

          /* ② EXIF */
          heading(ctx, B, 470, 378, '② EXIF / GPS STRIP', 'pink', { size: 13 });
          var ex = code(ctx, B, { x: 470, y: 395, w: 350, title: 'sketch_03.png · metadata', lang: 'text', size: 12, color: 'pink', lines: [
            'Make  Apple · Model  iPad Pro',
            'DateTimeOriginal  2026:09:27 22:14',
            'GPSLatitude    37.7749 N',
            'GPSLongitude  122.4194 W',
            'Orientation 6 (rotate 90° CW) → kept',
            'ICC  Display P3 → kept'
          ] });
          var strike = [ctx.line(484, 478, 700, 478, { color: 'red', sw: 2, parent: B }), ctx.line(484, 497, 700, 497, { color: 'red', sw: 2, parent: B })];
          strike.forEach(function (s) { s.setAttribute('opacity', 0); });
          var stripped = ctx.label(768, 487, 'stripped', { color: 'red', size: 11, parent: B, opacity: 0 });
          ctx.text(470, 574, 'rewrite container only · never re-encode pixels', { size: 12, font: 'mono', color: 'dim', parent: B });

          /* ③ thumbnail */
          heading(ctx, B, 850, 378, '③ THUMBNAIL + PERCEPTUAL HASH', 'violet', { size: 13 });
          var big = ctx.matrix(860, 400, 12, 12, { cell: 11, gap: 1, values: function (rr, cc) { return rgb(moonImg(0.3 + (cc + 0.5) / 12 * 1.05, (rr + 0.5) / 12)); } });
          var small = ctx.matrix(1058, 420, 4, 4, { cell: 24, gap: 2, values: function () { return '#0a1428'; } });
          ctx.line(1012, 471, 1048, 471, { color: 'violet', arrow: true, parent: B });
          var scan = ctx.rect(860, 400, 35, 35, { rx: 2, stroke: 'white', sw: 1.5, parent: B, opacity: 0 });
          ctx.text(850, 566, 'thumb 256² WebP · blurhash', { size: 12, font: 'mono', color: 'dim', parent: B });
          ctx.text(850, 585, 'pHash 64-bit · dup if Hamming ≤ 8', { size: 12, font: 'mono', color: 'dim', parent: B });
          B.appendChild(big); B.appendChild(small);
          var avg = [];
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

          /* ④ proxy */
          heading(ctx, B, 1210, 378, '④ PROXY TRANSCODE (WebCodecs)', 'orange', { size: 13 });
          ctx.text(1212, 402, 'memo.m4a · AAC 256 kb/s · 48 kHz · 3.7 MB', { size: 12, font: 'mono', color: 'text', parent: B });
          var rw = ctx.rng(5), d = 'M1212,436', d2s = 'M1212,516';
          for (var x = 1216; x <= 1556; x += 4) {
            var env = 0.35 + 0.65 * Math.abs(Math.sin((x - 1212) / 38));
            d += ' L' + x + ',' + (436 + (rw() - 0.5) * 44 * env).toFixed(1);
            if ((x - 1216) % 16 === 0) d2s += ' L' + x + ',' + (516 + Math.sin((x - 1212) / 38 * 3) * 12 * env).toFixed(1);
          }
          var wav1 = ctx.path(d, { color: 'orange', sw: 1.2, parent: B });
          var wav2 = ctx.path(d2s, { color: 'amber', sw: 1.6, parent: B });
          ctx.text(1212, 484, 'proxy.opus · 24 kb/s mono · 0.35 MB', { size: 12, font: 'mono', color: 'amber', parent: B });
          ctx.rect(1212, 546, 340, 10, { rx: 3, fill: ctx.alpha('orange', 0.5), parent: B });
          var pbar = ctx.rect(1212, 560, 32, 10, { rx: 3, fill: 'amber', parent: B });
          ctx.text(1212, 588, 'ASR + voice embedding start on the proxy', { size: 12, font: 'mono', color: 'dim', parent: B });

          /* state store + why */
          var js = code(ctx, B, { x: 470, y: 625, w: 600, title: 'state store · persisted to IndexedDB', lang: 'json', size: 12, color: 'teal', lines: [
            '{"uploads": {',
            '  "sha256:9f2c…b71d": {"name": "sketch_03.png", "state": "queued",',
            '      "bytes": 24536678, "thumb": "blob:…", "exif": "stripped"},',
            '  "sha256:41aa…09e2": {"name": "memo.m4a", "state": "deduped",',
            '      "proxy": "ready", "blob": "blb_7Hq2…"}}}'
          ] });
          var why = ctx.para(1100, 648, ['Why on the device?', '• privacy: GPS never leaves the phone', '• dedup: known blobs cost zero bytes', '• head start: proxies feed ASR / vision early', '• trust: server re-hashes; client hash is a hint'], { size: 14, lh: 26, color: 'text', parent: B, font: 'sans' });
          ctx.hud('4 files · 1 deduped · 0 bytes of GPS leave the device');

          ctx.reveal([big, small, ex, js, why], { from: 'fade', stagger: 120, delay: 200 });
          ctx.reveal(wav1, { from: 'draw', dur: 900, delay: 400 });
          ctx.reveal(wav2, { from: 'draw', dur: 900, delay: 1300 });
          ctx.animate(pbar, { width: [0, 32] }, 600, 'out', 1500);
          var hashP = ctx.tween(2200, function (e, raw) {
            var n = Math.floor(raw * 24);
            chunks.forEach(function (c, ci) { c.setAttribute('fill', ci < n || raw >= 1 ? ctx.alpha('cyan', 0.55) : 'rgba(34,228,255,0.06)'); });
            var words = raw >= 1 ? FIN : mid[Math.min(24, n)];
            wtext.forEach(function (tx, wi) { tx.textContent = words[wi]; });
          }, 'linear', 300).then(function () {
            return ctx.typeText(dig, 'content key = sha256:9f2c4e1ad07b3c55e8a1f0b24c9d7e13a6b82f0417ce5d9af3086b2ec463b71d', 900);
          }).then(function () {
            return ctx.reveal([d1, d2], { from: 'left', stagger: 300 });
          });
          var thumbP = ctx.tween(2000, function (e, raw) {
            var n = Math.min(16, Math.floor(raw * 17));
            for (var q = 0; q < 16; q++) small.cells[Math.floor(q / 4)][q % 4].setAttribute('fill', q < n ? avg[Math.floor(q / 4)][q % 4] : '#0a1428');
            if (n < 16) { scan.setAttribute('x', 860 + (n % 4) * 36); scan.setAttribute('y', 400 + Math.floor(n / 4) * 36); scan.setAttribute('opacity', 1); }
            else scan.setAttribute('opacity', 0);
          }, 'linear', 600);
          var exP = ctx.wait(1400).then(function () {
            strike.forEach(function (s) { s.setAttribute('opacity', 1); });
            ctx.reveal(strike, { from: 'draw', dur: 400 });
            ctx.fade([ex.lineEls[2], ex.lineEls[3]], 0.35, 400);
            return ctx.reveal(stripped, { from: 'scale', dur: 400 });
          });
          return Promise.all([hashP, thumbP, exP]);
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Resumable multipart upload',
        say: 'The upload manager never sends a big file in one piece. It asks the API to start a multipart upload and receives short-lived pre-signed URLs, one per part, so the bytes flow straight to object storage and never touch our API servers. Five mebibyte parts travel over three parallel connections. When part three hits a connection reset, only that part is retried after a short back-off. Each part returns an ETag and a checksum, and a final complete call stitches them into one object.',
        deep: '<p><b>S3-style multipart</b>: parts are 5 MiB – 5 GiB (the last may be smaller), at most 10,000 parts, uploaded in any order and in parallel; <code>CompleteMultipartUpload</code> lists <code>(PartNumber, ETag)</code> in ascending order and the store assembles them atomically.</p>' +
          '<div class="eq">T ≈ max( S / B<sub>uplink</sub> ,  ⌈N/k⌉ · (RTT + P / b<sub>conn</sub>) )</div>' +
          '<p>Parallelism (<i>k</i> lanes) only helps while a single stream is window- or loss-limited (b<sub>conn</sub> ≈ cwnd/RTT); once the uplink saturates, more lanes add contention. Expected re-sent bytes per failure ≈ P, so smaller parts waste less on flaky mobile links but cost more requests; adaptive part sizing (8–64 MiB on good links) is common.</p>' +
          '<ul><li><b>Pre-signed URL</b>: SigV4 HMAC over the canonical request, scoped to bucket/key/uploadId/partNumber, <code>X-Amz-Expires=900</code>. A leaked URL grants one PUT for 15 min, nothing else.</li>' +
          '<li><b>Integrity</b>: per-part <code>x-amz-checksum-sha256</code> (or CRC32C / CRC64NVME) is verified server-side before the part is accepted.</li>' +
          '<li><b>Resume</b>: <code>uploadId</code> + completed parts live in IndexedDB; after a crash, <code>ListParts</code> reconciles and only missing parts are sent.</li>' +
          '<li><b>tus / IETF resumable uploads</b>: a single URL; <code>HEAD</code> returns <code>Upload-Offset</code>, <code>PATCH</code> appends from it — simpler for a single stream; parallelism needs tus <i>Concatenation</i> (partial uploads stitched server-side).</li>' +
          '<li><b>Hygiene</b>: lifecycle rule <code>AbortIncompleteMultipartUpload</code> after 1–7 days, or orphaned parts are billed forever.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, 'upl');
          var B = newBench(ctx);
          ctx.line(386, 508, 456, 508, { color: 'cyan', dash: '3 4', parent: B });
          heading(ctx, B, 470, 186, 'RESUMABLE MULTIPART UPLOAD · sketch_03.png · 23.4 MiB');
          var calls = [['① POST /v1/uploads → uploadId + 5 signed URLs', 'blue'], ['② PUT parts · 3 in flight · retry per part', 'teal'], ['③ POST …/complete (PartNumber, ETag)', 'blue']];
          var cx = 470, chips = [];
          calls.forEach(function (c) { var l = ctx.label(cx, 224, c[0], { color: c[1], size: 12, anchor: 'start', parent: B }); cx += l.w + 16; chips.push(l); });
          ctx.reveal(chips, { from: 'left', stagger: 150 });
          var sizes = ['5 MiB', '5 MiB', '5 MiB', '5 MiB', '3.4 MiB'];
          var ET = ['7d0c…a1', '3be9…04', 'b54f…e1', 'e2a7…9c', '0f61…d3'];
          var blocks = [], stat = [];
          sizes.forEach(function (s, i) {
            var y = 262 + i * 48;
            blocks.push(ctx.rect(480, y, 130, 36, { rx: 5, fill: 'rgba(43,245,196,0.06)', stroke: ctx.alpha('teal', 0.6), sw: 1.2, parent: B }));
            ctx.text(545, y + 18, 'part ' + (i + 1) + ' · ' + s, { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: B });
            stat.push(ctx.text(622, y + 18, 'pending', { size: 12, font: 'mono', color: 'dim', parent: B }));
          });
          S.stor = ctx.node({ x: 1445, y: 378, w: 220, h: 130, kind: 'cyl', title: 'Object Store', sub: 'uploadId VXBsb2Fk…', color: 'teal', parent: B, titleSize: 15 });
          var slots = [];
          for (var q = 0; q < 5; q++) slots.push(ctx.rect(1377 + q * 28, 412, 24, 14, { rx: 2, fill: 'none', stroke: ctx.alpha('teal', 0.6), sw: 1, parent: B }));
          var lanes = [300, 378, 456].map(function (y, i) {
            var p = ctx.path('M818,' + y + ' C1040,' + y + ' 1120,' + (360 + i * 18) + ' 1333,' + (360 + i * 18), { color: ctx.alpha('teal', 0.7), sw: 1.6, dash: '5 5', parent: B });
            ctx.text(820, y - 14, ['lane A · connection 1', 'lane B · connection 2', 'lane C · connection 3'][i], { size: 11, font: 'mono', color: 'dim', parent: B });
            return p;
          });
          ctx.reveal(lanes, { from: 'draw', stagger: 120, delay: 300 });
          var tus = ctx.para(1250, 474, ['tus / IETF resumable upload:', 'HEAD → Upload-Offset: 15728640', 'PATCH  Upload-Offset: 15728640', '  → 204  Upload-Offset: 20971520'], { size: 12, font: 'mono', color: 'dim', lh: 18, parent: B });
          var sig = code(ctx, B, { x: 470, y: 585, w: 540, title: 'part 3 · pre-signed URL (SigV4, 15 min)', lang: 'text', size: 12, color: 'blue', lines: [
            'PUT https://media.s3.us-east-1.amazonaws.com/',
            '    u/9f2c…b71d?partNumber=3&uploadId=VXBs…',
            '    &X-Amz-Algorithm=AWS4-HMAC-SHA256',
            '    &X-Amz-Expires=900&X-Amz-Signature=5d1e…',
            'x-amz-checksum-sha256: q3Z8f1Lw0mBvK…=',
            '← 200 OK   ETag: "b54f…e1"'
          ] });
          var comp = code(ctx, B, { x: 1040, y: 585, w: 520, title: 'POST …/complete  (ascending PartNumber)', lang: 'json', size: 12, color: 'teal', typing: true, maxLines: 7, lines: [
            '{"Parts": ['
          ].concat(ET.map(function (e, i) { return '  {"PartNumber": ' + (i + 1) + ', "ETag": "' + e + '"}' + (i < 4 ? ',' : ''); })).concat([']}']) });
          var done = ctx.label(1300, 806, '✓ sealed · server re-hash = sha256:9f2c…b71d', { color: 'lime', size: 12, parent: B, opacity: 0 });
          var stats = ctx.text(470, 806, '5 parts · 3 lanes · 1 retry · 5 MiB re-sent, not 23.4', { size: 12, font: 'mono', color: 'dim', parent: B, opacity: 0 });
          ctx.reveal([sig, comp, tus], { from: 'up', stagger: 150, delay: 200 });
          ctx.hud('23.4 MiB → 5 parts · 3 in flight · per-part retry');

          function setSt(i, s, col) { stat[i].textContent = s; stat[i].setAttribute('fill', ctx.color(col)); }
          var marks = [];
          function part(i, lane, fail) {
            setSt(i, 'in flight', 'cyan');
            blocks[i].setAttribute('fill', ctx.alpha('cyan', 0.25));
            var p;
            if (fail) {
              p = ride(ctx, lanes[lane], { color: 'teal', label: 'part ' + (i + 1), until: 0.45, dur: 700 }).then(function (pt) {
                if (pt) marks.push(ctx.text(pt.x, pt.y, '✕', { size: 22, color: 'red', anchor: 'middle', weight: 700, parent: B }));
                setSt(i, 'RST · backoff', 'red');
                blocks[i].setAttribute('fill', ctx.alpha('red', 0.25));
                return ctx.wait(500);
              }).then(function () {
                setSt(i, 'retry 1', 'amber');
                blocks[i].setAttribute('fill', ctx.alpha('amber', 0.25));
                return ride(ctx, lanes[lane], { color: 'amber', label: 'part 3 · retry', dur: 1300 });
              });
            } else p = ride(ctx, lanes[lane], { color: 'teal', label: 'part ' + (i + 1), dur: 1300 });
            return p.then(function () {
              setSt(i, 'ETag ' + ET[i] + (fail ? ' ✓ (retry 1)' : ' ✓'), 'lime');
              blocks[i].setAttribute('fill', ctx.alpha('lime', 0.18));
              blocks[i].setAttribute('stroke', ctx.alpha('lime', 0.7));
              slots[i].setAttribute('fill', ctx.alpha('teal', 0.8));
            });
          }
          return ctx.wait(800).then(function () {
            return Promise.all([
              part(0, 0).then(function () { return part(3, 0); }),
              ctx.wait(150).then(function () { return part(1, 1); }).then(function () { return part(4, 1); }),
              ctx.wait(300).then(function () { return part(2, 2, true); })
            ]);
          }).then(function () {
            marks.forEach(function (m) { ctx.remove(m, 300); });
            return comp.typeAll();
          }).then(function () {
            return ctx.reveal([done, stats], { from: 'up', stagger: 150 });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'OIDC, PKCE & tokens',
        say: 'Every request must prove who is asking. The app is a public client, so it cannot keep a secret. Instead it uses OAuth with PKCE. It invents a random verifier, sends only its hash when the user signs in with a passkey, and later proves it knows the verifier when it trades the authorization code for tokens. It gets back a short-lived signed JWT access token and a rotating refresh token. The gateway verifies that signature locally, without calling the identity server.',
        deep: '<p><b>Authorization Code + PKCE</b> (RFC 7636; required for public clients and recommended for confidential ones by RFC 9700, required for all in the OAuth 2.1 draft). The implicit flow is deprecated:</p>' +
          '<div class="eq">code_challenge = BASE64URL( SHA-256( code_verifier ) ), &nbsp; |verifier| ∈ [43, 128]</div>' +
          '<p>An attacker who intercepts the code (hijacked custom URL scheme, leaked referrer) cannot redeem it without the verifier, which never left the device.</p>' +
          '<p><b>Access token</b>: a JWS (ES256 / EdDSA) with <code>iss, sub, aud, exp, scope, tenant</code>. The gateway validates it <i>statelessly</i>: fetch JWKS once, cache by <code>kid</code>, check signature, <code>exp</code>/<code>nbf</code> with ≤ 60 s skew, <code>aud</code> and scopes — ~50 µs of CPU, zero network hops.</p>' +
          '<p>Statelessness has a price: a JWT cannot be recalled before <code>exp</code>. Hence short lifetimes (5–15 min) plus <b>refresh-token rotation with reuse detection</b>: every refresh returns a new RT; presenting an already-used RT revokes the whole token family.</p>' +
          '<ul><li><b>DPoP</b> (RFC 9449): each request carries a proof JWT signed by a device key; <code>cnf.jkt</code> binds the token to that key, so a stolen bearer token is useless.</li>' +
          '<li>Storage: tokens in memory / OS keychain, never <code>localStorage</code>; browser apps often use a BFF with HttpOnly cookies.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, 'auth');
          var B = newBench(ctx);
          ctx.line(386, 594, 456, 594, { color: 'cyan', dash: '3 4', parent: B });
          var X = [580, 860, 1130];
          var hd = [
            ctx.node({ x: X[0], y: 200, w: 190, h: 44, title: 'Client (public)', icon: 'phone', color: 'cyan', titleSize: 13, parent: B }),
            ctx.node({ x: X[1], y: 200, w: 190, h: 44, title: 'IdP / Auth server', icon: 'lock', color: 'pink', titleSize: 13, parent: B }),
            ctx.node({ x: X[2], y: 200, w: 190, h: 44, title: 'API Gateway', icon: 'shield', color: 'blue', titleSize: 13, parent: B })
          ];
          var lifes = X.map(function (x) { return ctx.line(x, 224, x, 612, { color: 'faint', dash: '4 5', parent: B }); });
          ctx.reveal(hd, { from: 'down', stagger: 100 });
          ctx.reveal(lifes, { from: 'draw', delay: 300 });
          var n0 = ctx.group({ parent: B });
          ctx.rect(466, 233, 664, 26, { rx: 13, fill: 'rgba(6,12,24,0.96)', stroke: ctx.alpha('cyan', 0.6), sw: 1, parent: n0 });
          ctx.text(480, 246.5, 'code_verifier = b64url(32 random B) · code_challenge = b64url(SHA-256(verifier))', { size: 12, font: 'mono', color: 'cyan', parent: n0 });
          function note(x, y, s, col) { var l = ctx.label(x, y, s, { color: col, size: 12, parent: B, bgAlpha: 0.2 }); l.setAttribute('opacity', 0); return { note: l }; }
          var M = [
            { note: n0 },
            msg(ctx, B, X[0], X[1], 294, 'GET /authorize?code_challenge=E9Me…', 'cyan'),
            note(X[1], 332, 'passkey (WebAuthn) sign-in', 'pink'),
            msg(ctx, B, X[1], X[0], 372, '302 → app://cb?code=SplxlO…', 'pink'),
            msg(ctx, B, X[0], X[1], 414, 'POST /token (code, code_verifier)', 'cyan'),
            note(X[1], 452, 'SHA-256(verifier) == challenge ?', 'pink'),
            msg(ctx, B, X[1], X[0], 494, 'access JWT (10 min) + refresh RT1', 'lime'),
            msg(ctx, B, X[0], X[2], 548, 'GET /v1/jobs · Authorization: DPoP eyJhbGci…', 'blue', { lx: 790 }),
            note(X[2], 588, 'verify ES256 (cached JWKS) · exp · aud · scope', 'blue')
          ];
          M[3].col = 'pink'; M[6].col = 'lime'; M[7].col = 'blue';
          M.forEach(function (m) {
            if (m.note) m.note.setAttribute('opacity', 0);
            else { m.ln.setAttribute('opacity', 0); m.tx.setAttribute('opacity', 0); }
          });
          var jwt = code(ctx, B, { x: 1290, y: 180, w: 272, title: 'access_token (JWT)', lang: 'json', size: 12, color: 'amber', lines: [
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
            '// sig = ECDSA-P256(SHA-256(h.p))'
          ] });
          ctx.reveal(jwt, { from: 'right', delay: 400 });

          /* token lifetime timeline */
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
          var rep = ctx.group({ parent: tl });
          ctx.line(rx, 676, rx, 790, { color: 'red', sw: 2, dash: '4 3', parent: rep });
          ctx.text(rx - 8, 676, '44 min: replay of used RT5 → family revoked', { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: rep });
          ctx.rect(rx, 764, x0 + 48 * pm - rx - 1, 16, { rx: 0, fill: 'rgba(255,77,109,0.35)', parent: rep });
          ctx.text(rx + 8, 742, 'AT6 stays valid until exp → keep it short', { size: 11, font: 'mono', color: 'amber', parent: rep });
          ctx.reveal(tl, { from: 'up', delay: 500 });
          ctx.reveal(bars, { from: 'left', stagger: 70, delay: 700 });
          rep.setAttribute('opacity', 0);
          ctx.hud('PKCE S256 · AT 10 min · RT rotation · DPoP');
          return ctx.wait(700).then(function () { return playMsgs(ctx, M); }).then(function () {
            return ctx.reveal(rep, { from: 'fade', dur: 500 });
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Async jobs & idempotency',
        say: 'Rendering a trailer takes minutes, so the API never holds the request open. It answers at once with 202 Accepted and a job id, and the real work happens asynchronously. But networks lie. Here the response is lost on its way back, so the client times out and retries. Because the retry carries the same idempotency key, the server returns the stored response instead of launching a second, very expensive GPU job. Exactly one job enters the queue.',
        deep: '<p><b>Async request-reply</b>: <code>POST /v1/jobs</code> → <code>202 Accepted</code> + <code>Location</code> + an events URL; status is observed via SSE (or polling with <code>Retry-After</code>). Nothing long-running ever sits on a load-balancer timeout.</p>' +
          '<p><b>Idempotency-Key</b> (IETF httpapi draft; Stripe-style): the server stores <code>key → (fingerprint(body), state, response)</code> for ~24 h.</p>' +
          '<pre>on POST(key, body):\n  row = get_or_insert(key)   # atomic\n  if row.existed:\n    if row.fp != hash(body): 422\n    if row.state == IN_FLIGHT: 409\n    return row.response      # replay\n  BEGIN\n    insert job; insert outbox event\n    row.response = 202{job_id}\n  COMMIT</pre>' +
          '<p>Writing the job, the key row and an <b>outbox</b> event in one transaction makes “accepted” and “enqueued” atomic; the relay publishes the outbox at-least-once and consumers dedupe by <code>job_id</code> ⇒ effectively-once.</p>' +
          '<div class="note">Why it matters here: a duplicated trailer is not a duplicated row — it is ~5,400 GPU-seconds of H100 time.</div>',
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, 'comp');
          var B = newBench(ctx);
          ctx.line(386, 250, 456, 250, { color: 'cyan', dash: '3 4', parent: B });
          var X = [580, 850, 1110, 1400];
          var hd = [
            ctx.node({ x: X[0], y: 196, w: 170, h: 44, title: 'Client', icon: 'phone', color: 'cyan', titleSize: 13, parent: B }),
            ctx.node({ x: X[1], y: 196, w: 170, h: 44, title: 'Jobs API', icon: 'server', color: 'blue', titleSize: 13, parent: B }),
            ctx.node({ x: X[2], y: 196, w: 200, h: 44, title: 'Idempotency store', icon: 'db', color: 'teal', titleSize: 13, parent: B }),
            ctx.node({ x: X[3], y: 196, w: 170, h: 44, title: 'Job queue', icon: 'queue', color: 'magenta', titleSize: 13, parent: B })
          ];
          var lifes = X.map(function (x) { return ctx.line(x, 220, x, 612, { color: 'faint', dash: '4 5', parent: B }); });
          ctx.reveal(hd, { from: 'down', stagger: 90 });
          ctx.reveal(lifes, { from: 'draw', delay: 300 });
          function note(x, y, s, col) { var l = ctx.label(x, y, s, { color: col, size: 12, parent: B, bgAlpha: 0.2 }); return { note: l }; }
          var lost = msg(ctx, B, X[1], 700, 414, '202 · job_01JB7Q', 'red', { dash: '5 4', lx: 775 });
          lost.col = 'red';
          var M = [
            msg(ctx, B, X[0], X[1], 258, 'POST /v1/jobs · key 5f1e…c2', 'cyan'),
            msg(ctx, B, X[1], X[2], 296, 'INSERT key (in_flight, fp)', 'teal'),
            msg(ctx, B, X[1], X[3], 334, 'enqueue job_01JB7Q (outbox)', 'magenta', { lx: 1125 }),
            msg(ctx, B, X[1], X[2], 372, 'store response 202', 'teal'),
            lost,
            note(X[0] + 30, 456, 'no reply in 10 s → retry, SAME key', 'amber'),
            msg(ctx, B, X[0], X[1], 496, 'POST /v1/jobs · key 5f1e…c2', 'amber'),
            msg(ctx, B, X[1], X[2], 532, 'hit: completed → cached 202', 'teal'),
            msg(ctx, B, X[1], X[0], 570, '202 · job_01JB7Q (same job)', 'lime')
          ];
          M[1].col = 'teal'; M[2].col = 'magenta'; M[3].col = 'teal'; M[6].col = 'amber'; M[7].col = 'teal'; M[8].col = 'lime';
          M.forEach(function (m) {
            if (m.note) m.note.setAttribute('opacity', 0);
            else { m.ln.setAttribute('opacity', 0); m.tx.setAttribute('opacity', 0); }
          });
          var lostX = ctx.text(700, 414, '✕', { size: 20, weight: 700, color: 'red', anchor: 'middle', parent: B, opacity: 0 });
          var qbox = ctx.group({ parent: B, opacity: 0 });
          ctx.rect(X[3] - 50, 380, 100, 26, { rx: 4, fill: ctx.alpha('magenta', 0.3), stroke: 'magenta', sw: 1.2, parent: qbox });
          ctx.text(X[3], 393, 'job_01JB7Q', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: qbox });
          var once = ctx.label(X[3], 600, 'exactly one job enqueued', { color: 'lime', size: 12, parent: B, opacity: 0 });

          var resp = code(ctx, B, { x: 470, y: 640, w: 560, title: 'response (original and replay are byte-identical)', lang: 'json', size: 12, color: 'blue', lines: [
            'HTTP/2 202 Accepted',
            'location: /v1/jobs/job_01JB7Q',
            '{"job_id": "job_01JB7Q",',
            ' "status": "queued",',
            ' "events": "/v1/jobs/job_01JB7Q/events",',
            ' "estimate": {"gpu_seconds": 5400, "eta_s": 150}}'
          ] });
          var sm = ctx.group({ parent: B });
          heading(ctx, sm, 1070, 652, 'JOB STATE MACHINE (server-authoritative)', 'magenta', { size: 13 });
          var st = [['queued', 1115, 700], ['planning', 1235, 700], ['rendering', 1370, 700], ['post', 1500, 700], ['succeeded', 1480, 780], ['failed', 1300, 780], ['canceled', 1115, 780]];
          var chip = {};
          st.forEach(function (s) { chip[s[0]] = ctx.label(s[1], s[2], s[0], { color: s[0] === 'failed' ? 'red' : (s[0] === 'succeeded' ? 'lime' : (s[0] === 'canceled' ? 'dim' : 'magenta')), size: 12, parent: sm }); chip[s[0]].p = { x: s[1], y: s[2] }; });
          function ar(a, b, dash) { var A = chip[a], Bc = chip[b]; var ax = A.p.x, ay = A.p.y, bx = Bc.p.x, by = Bc.p.y; var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); var sa = ay === by ? A.w / 2 + 3 : 14, sb = ay === by ? Bc.w / 2 + 6 : 16; ctx.line(ax + dx / L * sa, ay + dy / L * sa, bx - dx / L * sb, by - dy / L * sb, { color: ctx.alpha('magenta', 0.6), sw: 1.2, arrow: true, dash: dash, parent: sm }); }
          ar('queued', 'planning'); ar('planning', 'rendering'); ar('rendering', 'post'); ar('post', 'succeeded'); ar('rendering', 'failed', '3 3'); ar('queued', 'canceled', '3 3');
          ctx.text(1070, 830, 'client UI = projection of server events, never guessed', { size: 12, font: 'mono', color: 'dim', parent: sm });
          ctx.reveal([resp, sm], { from: 'up', stagger: 200, delay: 400 });
          ctx.hud('retry-safe POST: 2 requests → 1 job → 0 wasted GPU-seconds');
          return ctx.wait(600).then(function () {
            return playMsgs(ctx, M.slice(0, 3));
          }).then(function () {
            ctx.reveal(qbox, { from: 'scale', dur: 400 });
            return playMsgs(ctx, M.slice(3, 5));
          }).then(function () {
            ctx.reveal(lostX, { from: 'scale', dur: 300 });
            return playMsgs(ctx, M.slice(5));
          }).then(function () {
            ctx.reveal(once, { from: 'scale', dur: 400 });
            return ctx.pulse(chip.queued, { color: 'magenta', times: 2, dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'TCP+TLS vs QUIC',
        say: 'Now the wire itself. Over TCP with TLS one point three, the client needs one round trip for the TCP handshake and another for TLS before it can even send a request. QUIC merges transport and crypto into a single round trip, and on a resumed session it can send the request in the very first flight, called zero RTT, which is only safe for idempotent requests. QUIC also removes head-of-line blocking: a lost packet stalls only its own stream, and the connection survives a switch from Wi-Fi to cellular.',
        deep: '<table><tr><th></th><th>TCP + TLS 1.3</th><th>QUIC (1-RTT)</th><th>QUIC 0-RTT</th></tr>' +
          '<tr><td>request leaves at</td><td>2 RTT</td><td>1 RTT</td><td>0 RTT</td></tr>' +
          '<tr><td>first response byte</td><td>3 RTT</td><td>2 RTT</td><td>1 RTT</td></tr>' +
          '<tr><td>@ RTT = 80 ms (LTE)</td><td>240 ms</td><td>160 ms</td><td>80 ms</td></tr></table>' +
          '<p>TLS 1.3 early data over TCP (or TCP Fast Open) can shave a round trip too, but middlebox support is poor; QUIC (RFC 9000/9001) integrates TLS 1.3 into its own handshake.</p>' +
          '<p><b>0-RTT is replayable</b>: an attacker can resend the first flight. Servers accept only safe methods in early data (or reply <code>425 Too Early</code>); our <code>POST /v1/jobs</code> goes after the handshake, or is protected by its idempotency key.</p>' +
          '<p><b>Head-of-line blocking</b>: HTTP/2 multiplexes streams over one TCP byte stream, so a single loss blocks delivery of <i>all</i> streams until retransmission (~1 RTT). QUIC delivers in order per stream only. With per-packet loss rate p and n packets in flight ahead of stream s:</p>' +
          '<div class="eq">P(s stalls)<sub>h2</sub> = 1 − (1−p)<sup>n<sub>conn</sub></sup> &nbsp; vs &nbsp; P(s stalls)<sub>h3</sub> = 1 − (1−p)<sup>n<sub>s</sub></sup></div>' +
          '<p>The event stream (a few small packets) no longer pays for losses inside the 5 MiB upload sharing the connection.</p>' +
          '<p><b>Connection migration</b>: QUIC identifies connections by connection IDs, not the 4-tuple, so a Wi-Fi → 5G handover keeps the upload and the event stream alive (after path validation). Costs: user-space stack, more CPU per byte than kernel TCP, UDP blocked or throttled on a few percent of networks ⇒ always race a TCP fallback (Alt-Svc / HTTPS RR + happy eyeballs).</p>',
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
          var anims = [];
          cfg.forEach(function (L, li) {
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
            ctx.reveal(g, { from: 'fade', delay: li * 120 });
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
          });
          /* HOL blocking */
          var hg = ctx.group({ parent: B });
          heading(ctx, hg, 470, 630, 'HTTP/2 over TCP · one ordered byte stream', 'blue', { size: 13 });
          heading(ctx, hg, 1030, 630, 'HTTP/3 over QUIC · per-stream ordering', 'lime', { size: 13 });
          ctx.line(1005, 640, 1005, 850, { color: 'faint', dash: '3 5', parent: hg });
          var u1 = holPanel(ctx, hg, 470, false), u2 = holPanel(ctx, hg, 1030, true);
          u1(0); u2(0);
          var cap1 = ctx.text(470, 790, 'one loss on "upload" stalls all 3 streams ~1 RTT', { size: 12, font: 'mono', color: 'amber', parent: hg });
          var cap2 = ctx.text(1030, 790, 'loss stalls only its own stream', { size: 12, font: 'mono', color: 'lime', parent: hg });
          var mig1 = ctx.text(470, 826, 'Wi-Fi → 5G: new 4-tuple = new TCP conn + handshake', { size: 12, font: 'mono', color: 'dim', parent: hg });
          var mig2 = ctx.text(1030, 826, 'Wi-Fi → 5G: connection ID survives (migration)', { size: 12, font: 'mono', color: 'dim', parent: hg });
          ctx.reveal(hg, { from: 'up', delay: 300 });
          [cap1, cap2, mig1, mig2].forEach(function (e) { e.setAttribute('opacity', 0); });
          ctx.hud('first byte @ 80 ms RTT: 240 · 160 · 80 ms');
          var hol = ctx.wait(3000).then(function () {
            var t0 = null;
            S.holLoop = ctx.loop(function (t) {
              if (t0 === null) t0 = t;
              var ph = ((t - t0) * 0.85 * ctx.speed) % 5.2;
              var tt = Math.min(3.4, ph);
              u1(tt); u2(tt);
            });
            /* drill in: zoom onto the two head-of-line panels while the replay runs */
            ctx.camera(1012, 715, 1.42, 900);
            return ctx.wait(4200);
          }).then(function () { return ctx.reveal([cap1, cap2, mig1, mig2], { stagger: 200 }); })
            .then(function () { return ctx.wait(1400); })
            .then(function () { return ctx.camera(null, null, 1, 900); });
          anims.push(hol);
          return Promise.all(anims);
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Event streaming',
        say: 'For progress we need server push. Server-Sent Events win here: one way, plain HTTP that passes through proxies and CDNs, multiplexed over HTTP two or three, with resumption built in. Every event carries an id. When the connection drops, the browser reconnects on its own and sends the last id it saw, and the server replays whatever was missed from a per-job event log. Heartbeats stop middleboxes from killing idle connections, and a bounded queue with coalescing protects the server from slow clients.',
        deep: '<p><b>Choosing the channel</b>: job progress is one-way, low-rate (≤ ~20 events/s), and must survive disconnects → SSE. WebSocket earns its complexity for bidirectional low-latency traffic (co-editing a storyboard); WebRTC for real-time media (talking to the director agent by voice); WebTransport (HTTP/3) adds unreliable datagrams and many streams.</p>' +
          '<p><b>Typed event schema</b> (versioned, JSON Schema / protobuf): <code>job.accepted · plan.delta · shot.progress · preview.ready · shot.done · job.failed</code>. Events are appended to a per-job log (Redis Streams / Kafka, retained for hours), and the SSE <code>id</code> is the log offset. Over HTTP/1.1 browsers cap a site at 6 connections, so SSE needs h2/h3 multiplexing (default 100+ concurrent streams).</p>' +
          '<pre>on reconnect(Last-Event-ID = n):\n  replay log[n+1 .. head]   # gap-free\n  then tail live</pre>' +
          '<p><b>Heartbeats</b>: a comment line <code>: ping</code> every 15 s keeps NAT / LB idle timers (often 60–350 s) from reaping the connection and detects dead peers.</p>' +
          '<p><b>Backpressure</b>: TCP/QUIC flow control eventually pushes back into the server write buffer. Bound the per-connection queue (e.g. 256 events / 1 MB); coalesce <i>latest-wins</i> per key (<code>shot.progress</code> for shot 3) and never drop terminal events; if still full, close — the client resumes by id.</p>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.holLoop) { S.holLoop.stop(); S.holLoop = null; }
          ctx.camera(null, null, 1, 500);
          focusMod(ctx, 'evt');
          var B = newBench(ctx);
          ctx.line(386, 680, 456, 680, { color: 'cyan', dash: '3 4', parent: B });
          var grid = ctx.group({ parent: B });
          var colsX = [705, 895, 1085, 1275, 1465];
          var head = ['SSE', 'WebSocket', 'WebRTC DC', 'long-poll', 'WebTransport'];
          var rows = ['direction', 'transport', 'resume', 'infra fit', 'best for'];
          var cells = [
            ['server → client', 'full duplex', 'duplex · UDP · p2p/SFU', 'emulated push', 'duplex + datagrams'],
            ['HTTP/1.1 · h2 · h3', 'RFC 6455 · h2: RFC 8441','ICE · DTLS · SCTP', 'plain HTTP', 'HTTP/3 (QUIC)'],
            ['Last-Event-ID built in', 'DIY: seq + ack', 'DIY', 'cursor param', 'DIY'],
            ['proxy + CDN friendly', 'sticky LB, idle timeouts', 'STUN/TURN, heavy', 'works everywhere', 'newer, uneven support'],
            ['job + agent events ✓', 'live co-editing', 'voice with director', 'fallback', 'future live preview']
          ];
          ctx.rect(612, 176, 186, 196, { rx: 8, fill: 'rgba(34,228,255,0.08)', stroke: ctx.alpha('cyan', 0.7), sw: 1.4, parent: grid, glow: true });
          head.forEach(function (h, i) { ctx.text(colsX[i], 194, h, { size: 14, font: 'display', weight: 700, color: i === 0 ? 'cyan' : 'white', anchor: 'middle', parent: grid }); });
          rows.forEach(function (r, ri) {
            var y = 228 + ri * 32;
            ctx.line(470, y - 16, 1560, y - 16, { color: 'line', sw: 1, parent: grid });
            ctx.text(470, y, r, { size: 12, font: 'mono', color: 'dim', parent: grid });
            cells[ri].forEach(function (c, ci) { ctx.text(colsX[ci], y, c, { size: 12, font: 'mono', color: ci === 0 ? 'cyan' : 'text', anchor: 'middle', parent: grid }); });
          });
          ctx.reveal(grid, { from: 'down' });

          var srv = ctx.node({ x: 1450, y: 443, w: 210, h: 92, kind: 'cyl', title: 'Event Log', sub: 'per job · Redis Streams', color: 'magenta', parent: B, titleSize: 14, subSize: 11 });
          var cli = ctx.node({ x: 575, y: 440, w: 210, h: 60, title: 'EventSource', sub: 'lastEventId = 1042', icon: 'net', color: 'cyan', parent: B, titleSize: 14, subSize: 12 });
          var lane = ctx.path('M1345,428 L680,428', { color: 'cyan', sw: 1.8, arrow: true, parent: B });
          var back = ctx.path('M680,458 L1345,458', { color: ctx.alpha('amber', 0.7), sw: 1.4, dash: '4 5', arrow: true, parent: B });
          ctx.reveal([srv, cli], { from: 'scale', stagger: 150, delay: 300 });
          ctx.reveal(lane, { from: 'draw', delay: 500 });
          back.setAttribute('opacity', 0);
          var cut = ctx.text(1012, 428, '✕', { size: 24, weight: 700, color: 'red', anchor: 'middle', parent: B, opacity: 0 });
          var cutL = ctx.text(1012, 400, 'LB idle timeout / Wi-Fi drop', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: B, opacity: 0 });
          var reL = ctx.text(1012, 480, 'GET …/events · Last-Event-ID: 1042', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: B, opacity: 0 });

          var wire = code(ctx, B, { x: 470, y: 530, w: 520, title: 'wire: text/event-stream', lang: 'text', size: 12, color: 'cyan', lines: [
            'HTTP/2 200   content-type: text/event-stream',
            'retry: 2000',
            'id: 1042',
            'event: shot.progress',
            'data: {"shot":3,"step":18,"of":32,"eta_s":41}',
            '',
            ': ping   (heartbeat every 15 s)'
          ] });
          ctx.reveal(wire, { from: 'up', delay: 600 });

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
          ctx.reveal(bp, { from: 'up', delay: 800 });
          var seq = [];
          var rq = ctx.rng(3);
          for (var i = 0; i < 16; i++) seq.push(i === 6 ? 'violet' : (i === 11 ? 'lime' : (i === 15 ? 'violet' : ctx.alpha('cyan', 0.35 + 0.4 * rq()))));
          var coal = [ctx.alpha('cyan', 0.75), 'violet', 'lime', 'violet'];
          ctx.hud('resume gap-free with Last-Event-ID · heartbeat 15 s');

          function evts(ids, dur) {
            return ids.reduce(function (p, id, k) {
              return p.then(function () { ctx.packet(lane, { color: 'cyan', dur: dur, r: 4.5, label: 'id ' + id }); cli.subEl.textContent = 'lastEventId = ' + id; return ctx.wait(dur * 0.35); });
            }, Promise.resolve()).then(function () { return ctx.wait(dur * 0.7); });
          }
          var fillP = ctx.tween(3600, function (e, raw) {
            var n = Math.floor(raw * 16.99);
            for (var c = 0; c < 16; c++) q1.cells[0][c].setAttribute('fill', c < n ? seq[c] : 'rgba(255,255,255,0.04)');
            var m = Math.min(4, Math.floor(raw * 4.99));
            for (var c2 = 0; c2 < 16; c2++) q2.cells[0][c2].setAttribute('fill', c2 < m ? coal[c2] : 'rgba(255,255,255,0.04)');
          }, 'linear', 1200).then(function () { return ctx.reveal([full, ok2], { stagger: 200 }); });
          cli.subEl.textContent = 'lastEventId = 1040';
          var flow = ctx.wait(1100).then(function () { return evts([1041, 1042], 900); }).then(function () {
            ctx.reveal([cut, cutL], { from: 'scale', dur: 300 });
            ctx.fade(lane, 0.3, 300);
            return ctx.wait(700);
          }).then(function () {
            back.setAttribute('opacity', 1);
            ctx.reveal(reL, { dur: 300 });
            ctx.reveal(back, { from: 'draw', dur: 500 });
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
          return Promise.all([fillP, flow]);
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Streaming deltas & previews',
        say: 'Waiting in silence feels broken, so everything streams. The planner\'s tokens arrive as deltas. The client keeps a buffer of partial JSON, repairs it by closing the open string and brackets, parses it, and renders storyboard cards while the model is still writing. Rendering streams too. A distilled few-step model produces a rough low-resolution draft within seconds, then a sharper preview, and finally the full quality shot replaces it in place. The creator can cancel or redirect long before the expensive final render finishes.',
        deep: '<p><b>Partial JSON</b>: structured LLM output streams as text deltas. Rather than waiting for the closing brace, the client runs an incremental parser that tracks a stack of open containers and repairs the prefix:</p>' +
          '<pre>repair(prefix):\n  s = open { [ " stack   # one pass\n  return prefix + closers(reverse(s))\n\nevery 50 ms:\n  tree = JSON.parse(repair(buf))\n  render(diff(prev, tree))</pre>' +
          '<p>Constrained decoding on the server guarantees the <i>final</i> text is schema-valid, so every streamed prefix is a prefix of a valid document and repair only has to close open strings and containers (dropping a dangling key or half-written number such as <code>4.</code>). UI fields render once their key is complete. Alternative: JSON-Patch style ops (<code>{"op":"add","path":"/shots/1/prompt"}</code>).</p>' +
          '<p><b>Progressive previews</b> (illustrative timings for one 5 s shot):</p>' +
          '<table><tr><th>tier</th><th>model</th><th>res</th><th>ready</th></tr>' +
          '<tr><td>draft</td><td>4-step distilled student</td><td>240p</td><td>~9 s</td></tr>' +
          '<tr><td>preview</td><td>12 steps, step caching</td><td>480p</td><td>~35 s</td></tr>' +
          '<tr><td>final</td><td>full model + VAE decode + SR</td><td>1080p</td><td>~95 s</td></tr></table>' +
          '<p>Each tier arrives as a <code>preview.ready</code> event with a URL; the player swaps sources at the same timestamp. Early human feedback prunes the most expensive work — the best GPU-second is the one never spent.</p>',
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, 'store');
          var B = newBench(ctx);
          ctx.line(386, 766, 456, 766, { color: 'teal', dash: '3 4', parent: B });
          var buf = code(ctx, B, { x: 470, y: 176, w: 570, title: 'plan.delta → accumulated buffer (partial JSON)', lang: 'json', size: 12, color: 'amber', typing: true, maxLines: 6, lines: [
            '{"shots": [',
            '  {"id": 1, "dur": 4.0, "camera": "slow push-in, 24mm",',
            '   "prompt": "fox astronaut, cracked visor, falling',
            '     through aurora toward a glowing ice moon"},',
            '  {"id": 2, "dur": 5.0, "camera": "handheld, low angle",',
            '   "prompt": "impact: ice shards burst, blue rim'
          ] });
          ctx.reveal(buf, { from: 'left' });
          var rep = ctx.text(470, 356, 'repair: prefix + \'"}]}\' (close string, object, array, root) → JSON.parse → diff → render',{ size: 12, font: 'mono', color: 'amber', parent: B, opacity: 0 });
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
          var c1 = card(1070, 1, '4.0 s', 'slow push-in, 24mm', 'fox astronaut, cracked visor,', 'falling toward a glowing ice moon');
          var c2 = card(1322, 2, '5.0 s', 'handheld, low angle', 'impact: ice shards burst,', 'blue rim…');

          /* progressive preview */
          var pv = ctx.group({ parent: B });
          heading(ctx, pv, 470, 410, 'PROGRESSIVE PREVIEWS · shot 2 "impact"', 'lime', { size: 14 });
          var RR = 12, CC = 20;
          var img = [];
          for (var r = 0; r < RR; r++) { img.push([]); for (var c = 0; c < CC; c++) img[r].push(moonImg((c + 0.5) / RR, (r + 0.5) / RR)); }
          var rn = ctx.rng(21), noise = [];
          for (var q = 0; q < 60; q++) noise.push((rn() - 0.5) * 60);
          function tier(bs) {
            return function (r, c) {
              var br = Math.floor(r / bs) * bs, bc = Math.floor(c / bs) * bs, acc = [0, 0, 0];
              for (var i = 0; i < bs; i++) for (var j = 0; j < bs; j++) { var p = img[Math.min(RR - 1, br + i)][Math.min(CC - 1, bc + j)]; acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2]; }
              var nz = bs === 4 ? noise[(br * 7 + bc * 3) % 60] : (bs === 2 ? noise[(br * 5 + bc) % 60] * 0.4 : 0);
              return rgb([acc[0] / (bs * bs) + nz, acc[1] / (bs * bs) + nz, acc[2] / (bs * bs) + nz]);
            };
          }
          var frame = ctx.matrix(480, 432, RR, CC, { cell: 18, gap: 1, values: function () { return '#08101f'; } });
          pv.appendChild(frame);
          ctx.rect(474, 426, 391, 239, { rx: 6, stroke: ctx.alpha('lime', 0.6), sw: 1.4, parent: pv });
          var tierT = ctx.text(480, 690, 'waiting for first pixels…', { size: 13, font: 'mono', color: 'dim', parent: pv });
          var T = [['draft', '240p · 4-step distilled student', 9, 'amber'], ['preview', '480p · 12 steps + step caching', 35, 'cyan'], ['final', '1080p · full model + VAE + SR', 95, 'lime']];
          var tl = ctx.group({ parent: pv });
          var tx0 = 930, tw = 620;
          ctx.line(tx0, 640, tx0 + tw, 640, { color: 'faint', parent: tl });
          [0, 20, 40, 60, 80, 100].forEach(function (s) { ctx.text(tx0 + s / 100 * tw, 656, s + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: tl }); });
          var tbar = [];
          T.forEach(function (t, i) {
            var y = 460 + i * 56;
            ctx.text(tx0, y, t[0].toUpperCase(), { size: 13, font: 'display', weight: 700, color: t[3], parent: tl });
            ctx.text(tx0 + 80, y, t[1], { size: 12, font: 'mono', color: 'text', parent: tl });
            ctx.rect(tx0, y + 14, tw, 10, { rx: 3, fill: 'rgba(255,255,255,0.04)', parent: tl });
            tbar.push(ctx.rect(tx0, y + 14, 0, 10, { rx: 3, fill: ctx.alpha(t[3], 0.7), parent: tl }));
            ctx.line(tx0 + t[2] / 100 * tw, 630, tx0 + t[2] / 100 * tw, 640, { color: t[3], sw: 2, parent: tl });
          });
          var ev = ctx.label(930, 700, 'event: preview.ready {shot:2, tier:"draft", url:"…/s2_240p.mp4"}', { color: 'violet', size: 12, anchor: 'start', parent: pv, opacity: 0 });
          ctx.text(930, 740, 'creator can cancel / redirect after the draft → most of the shot\'s GPU time is never spent', { size: 12, font: 'mono', color: 'dim', parent: pv });
          ctx.reveal(pv, { from: 'up', delay: 300 });
          ctx.hud('first pixels at ~9 s instead of ~95 s');

          var planP = buf.addLine('{"shots": [').then(function () { return buf.addLine('  {"id": 1, "dur": 4.0, "camera": "slow push-in, 24mm",'); }).then(function () {
            ctx.reveal(c1, { from: 'scale', dur: 400 });
            return buf.addLine('   "prompt": "fox astronaut, cracked visor, falling');
          }).then(function () {
            ctx.reveal(c1.t1, { dur: 300 });
            return buf.addLine('     through aurora toward a glowing ice moon"},');
          }).then(function () {
            ctx.reveal(c1.t2, { dur: 300 });
            c1.st.lastChild.textContent = 'complete ✓';
            c1.st.firstChild.setAttribute('stroke', ctx.alpha('lime', 0.7));
            c1.st.lastChild.setAttribute('fill', ctx.color('lime'));
            return buf.addLine('  {"id": 2, "dur": 5.0, "camera": "handheld, low angle",');
          }).then(function () {
            ctx.reveal(c2, { from: 'scale', dur: 400 });
            return buf.addLine('   "prompt": "impact: ice shards burst, blue rim');
          }).then(function () {
            ctx.reveal([c2.t1, c2.t2], { dur: 300, stagger: 150 });
            return ctx.reveal(rep, { from: 'left', dur: 400 });
          });
          var prevP = ctx.wait(900).then(function () {
            return ctx.tween(1200, function (e) { tbar[0].setAttribute('width', e * 9 / 100 * tw); });
          }).then(function () {
            frame.set(tier(4)); tierT.textContent = 'DRAFT · 240p · +9 s · noisy, blocky, but composable'; tierT.setAttribute('fill', ctx.color('amber'));
            ctx.reveal(ev, { from: 'left', dur: 300 });
            return ctx.tween(1500, function (e) { tbar[1].setAttribute('width', e * 35 / 100 * tw); });
          }).then(function () {
            frame.set(tier(2)); tierT.textContent = 'PREVIEW · 480p · +35 s'; tierT.setAttribute('fill', ctx.color('cyan'));
            return ctx.tween(1800, function (e) { tbar[2].setAttribute('width', e * 95 / 100 * tw); });
          }).then(function () {
            frame.set(tier(1)); tierT.textContent = 'FINAL · 1080p · +95 s · swapped in place'; tierT.setAttribute('fill', ctx.color('lime'));
            return ctx.pulse(frame, { color: 'lime', dur: 700 });
          });
          return Promise.all([planP, prevP]);
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Playback & ABR',
        say: 'Finally, playback. The finished trailer is packaged as short CMAF segments in a bitrate ladder, described by an HLS or DASH manifest. The player fetches segments and appends them to a Media Source Extensions buffer. Before each segment, an adaptive bitrate algorithm picks a rung. Throughput rules estimate bandwidth from recent downloads; buffer rules like BOLA choose from buffer occupancy alone. When the train enters a tunnel, the buffer absorbs the drop. That completes the client: upload, control, feedback, and playback.',
        deep: '<p><b>Pipeline</b>: manifest (<code>.m3u8</code> / <code>.mpd</code>) → fetch 2 s CMAF fMP4 segments → <code>SourceBuffer.appendBuffer()</code> → hardware decode. Low-latency variants use chunked transfer of partial segments (LL-HLS parts, ~200–500 ms).</p>' +
          '<p><b>Throughput rule</b>: pick the highest rung with R<sub>m</sub> ≤ α·Ĉ, where Ĉ is the harmonic mean of the last k segment throughputs (robust to outliers), α ≈ 0.8–0.9. Reacts fast but oscillates on noisy links.</p>' +
          '<p><b>BOLA</b> (Lyapunov drift-plus-penalty): with buffer Q (in segments), utilities v<sub>m</sub> = ln(S<sub>m</sub>/S<sub>1</sub>),</p>' +
          '<div class="eq">m* = argmax<sub>m</sub> [ V·(v<sub>m</sub> + γp) − Q ] / S<sub>m</sub> &nbsp; (download nothing if all ≤ 0)</div>' +
          '<p>This yields buffer thresholds per rung; BOLA is provably within O(1/V) of the optimal utility with no bandwidth prediction. Here V = (Q<sub>max</sub>−1)/(v<sub>M</sub>+γp), γp = 5, Q<sub>max</sub> = 10 segments, which puts the rung switch points at 10.6, 12.5 and 14.6 s of buffer (dashed lines). dash.js <i>DYNAMIC</i> switches between the two: throughput rule at startup and after seeks, BOLA once the buffer is healthy; hls.js and Shaka use EWMA throughput estimators.</p>' +
          '<p>Metrics: startup delay, rebuffer ratio, average bitrate, switch rate — QoE ≈ Σ q(R<sub>k</sub>) − λ·rebuffer − μ·Σ|q(R<sub>k+1</sub>) − q(R<sub>k</sub>)| (MPC-style objective).</p>',
        run: function (ctx) {
          var S = ctx.state;
          focusMod(ctx, null);
          var B = newBench(ctx);
          heading(ctx, B, 470, 186, 'PLAYBACK · HLS / DASH via Media Source Extensions · ABR', 'orange');
          var tp = simulate('tput'), bo = simulate('bola');
          var g1 = ctx.group({ parent: B });
          var bwPts = [[0, 7.5], [16, 7.5], [16, 1.6], [34, 1.6], [34, 5.0], [60, 5.0]];
          var pBw = ctx.plot(520, 222, 600, 190, bwPts, { xDomain: [0, 60], yDomain: [0, 8], color: ctx.alpha('white', 0.45), sw: 1.4, yLabel: 'Mb/s', xLabel: 'time (s)', parent: g1 });
          pBw.curve.setAttribute('stroke-dasharray', '5 4');
          var pT = ctx.plot(520, 222, 600, 190, tp.rate, { xDomain: [0, 60], yDomain: [0, 8], color: 'orange', sw: 2.2, axes: false, parent: g1 });
          var pB = ctx.plot(520, 222, 600, 190, bo.rate, { xDomain: [0, 60], yDomain: [0, 8], color: 'violet', sw: 2.2, axes: false, parent: g1 });
          ctx.text(1116, 234, 'link capacity', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g1 });
          ctx.text(975, 398, 'tunnel 16–34 s: 1.6 Mb/s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g1 });
          [0, 2, 4, 6, 8].forEach(function (v) { ctx.text(512, 222 + 190 - v / 8 * 190, String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g1 }); });
          var g2 = ctx.group({ parent: B });
          var pBb = ctx.plot(520, 480, 600, 150, bo.buf, { xDomain: [0, 60], yDomain: [0, 22], color: 'violet', sw: 1.8, yLabel: 'buffer (s)', xLabel: 'time (s)', parent: g2 });
          var pTb = ctx.plot(520, 480, 600, 150, tp.buf, { xDomain: [0, 60], yDomain: [0, 22], color: 'orange', sw: 1.8, axes: false, parent: g2 });
          [0, 10, 20].forEach(function (v) { ctx.text(512, 480 + 150 - v / 22 * 150, String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g2 }); });
          [10.6, 12.5, 14.6].forEach(function (v) { ctx.line(520, 480 + 150 - v / 22 * 150, 1120, 480 + 150 - v / 22 * 150, { color: ctx.alpha('violet', 0.25), sw: 1, dash: '2 4', parent: g2 }); });
          ctx.text(1120, 470, 'BOLA rung thresholds', { size: 11, font: 'mono', color: 'violet', anchor: 'end', parent: g2 });
          [0, 10, 20, 30, 40, 50].forEach(function (s) {
            ctx.text(520 + s / 60 * 600, 424, String(s), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g1 });
            ctx.text(520 + s / 60 * 600, 642, String(s), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g2 });
          });
          var leg = ctx.group({ parent: B });
          ctx.line(520, 676, 548, 676, { color: 'orange', sw: 2.4, parent: leg });
          ctx.text(556, 676, 'throughput rule (0.85 × harmonic mean of last 3)', { size: 12, font: 'mono', color: 'orange', parent: leg });
          ctx.line(520, 700, 548, 700, { color: 'violet', sw: 2.4, parent: leg });
          ctx.text(556, 700, 'BOLA (buffer-based, γp = 5, Qmax = 10 segs)', { size: 12, font: 'mono', color: 'violet', parent: leg });
          function avg(rate) { var s = 0, T = 0; for (var i = 0; i + 1 < rate.length; i += 2) { var d = rate[i + 1][0] - rate[i][0]; s += rate[i][1] * d; T += d; } return T ? s / T : 0; }
          var stats = ctx.text(520, 730, 'rebuffer: throughput ' + tp.stall.toFixed(1) + ' s · BOLA ' + bo.stall.toFixed(1) + ' s   |   mean bitrate ' + avg(tp.rate).toFixed(1) + ' vs ' + avg(bo.rate).toFixed(1) + ' Mb/s', { size: 12, font: 'mono', color: 'text', parent: B, opacity: 0 });

          /* ladder */
          var lad = ctx.group({ parent: B });
          heading(ctx, lad, 1180, 222, 'LADDER (CMAF, 2 s segments)', 'orange', { size: 13 });
          [['1080p', 6.0], ['720p', 3.0], ['480p', 1.2], ['360p', 0.6]].forEach(function (l, i) {
            var y = 252 + i * 34;
            ctx.text(1180, y + 9, l[0], { size: 12, font: 'mono', color: 'text', parent: lad });
            ctx.rect(1238, y, l[1] / 6 * 250, 18, { rx: 3, fill: ctx.alpha('orange', 0.25 + i * 0), stroke: 'orange', sw: 1, parent: lad });
            ctx.text(1238 + l[1] / 6 * 250 + 8, y + 9, l[1].toFixed(1) + ' Mb/s', { size: 12, font: 'mono', color: 'orange', parent: lad });
          });
          /* MSE pipeline */
          var mse = ctx.group({ parent: B });
          var n1 = ctx.node({ x: 1370, y: 440, w: 300, h: 44, title: 'fetch seg_17.m4s (CDN)', icon: 'globe', color: 'orange', titleSize: 13, parent: mse });
          var n2 = ctx.node({ x: 1370, y: 510, w: 300, h: 44, title: 'SourceBuffer.appendBuffer', icon: 'layers', color: 'orange', titleSize: 13, parent: mse });
          var n3 = ctx.node({ x: 1370, y: 580, w: 300, h: 44, title: '<video> · HW decode (AV1/HEVC)', icon: 'film', color: 'orange', titleSize: 13, parent: mse });
          ctx.link(n1, n2, { color: 'orange', parent: mse }); ctx.link(n2, n3, { color: 'orange', parent: mse });
          ctx.text(1370, 626, 'ABR decides before every fetch', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: mse });

          /* recap */
          var rc = ctx.group({ parent: B });
          var chips = [['UPLOAD · pre-signed · multipart · dedup', 'teal'], ['CONTROL · OIDC+PKCE · 202 · idempotent', 'blue'], ['FEEDBACK · SSE · Last-Event-ID', 'cyan'], ['PLAYBACK · CMAF · ABR', 'orange']];
          var x = 470;
          chips.forEach(function (c) { var l = ctx.label(x, 800, c[0], { color: c[1], size: 12, anchor: 'start', parent: rc }); x += l.w + 14; });
          ctx.reveal([g1, g2, lad, mse, leg], { from: 'up', stagger: 120 });
          [pT.curve, pB.curve, pBb.curve, pTb.curve].forEach(function (c) { c.setAttribute('opacity', 0); });
          ctx.hud('ABR: one ladder rung per 2 s segment');
          return ctx.wait(700).then(function () {
            [pT.curve, pB.curve, pBb.curve, pTb.curve].forEach(function (c) { c.setAttribute('opacity', 1); });
            return Promise.all([
              ctx.reveal(pT.curve, { from: 'draw', dur: 2600, ease: 'linear' }),
              ctx.reveal(pB.curve, { from: 'draw', dur: 2600, ease: 'linear' }),
              ctx.reveal(pTb.curve, { from: 'draw', dur: 2600, ease: 'linear' }),
              ctx.reveal(pBb.curve, { from: 'draw', dur: 2600, ease: 'linear' })
            ]);
          }).then(function () {
            ctx.reveal(stats, { from: 'left' });
            return ctx.reveal(rc, { from: 'up', dur: 600 });
          });
        }
      }
    ]
  });
})();
