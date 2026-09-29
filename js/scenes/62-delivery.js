/* L2 — Compositing, Encoding & Streaming. EDL -> ffmpeg filter graph, loudness, frame interpolation,
 * super-resolution, the inside of a video encoder (GOP, motion, DCT, quantisation, rate control),
 * codec generations, per-title ABR ladder, CMAF/HLS/DASH packaging with C2PA, CDN and the ABR player. */
(function () {
  function nb(lines) { return lines.map(function (s) { return s.replace(/^ +| {2,}/g, function (m) { return new Array(m.length + 1).join(' '); }); }); }
  function head(ctx, parent, x, y, s, col) { return ctx.text(x, y, s, { size: 13, font: 'mono', weight: 600, color: col || 'orange', parent: parent, spacing: 1 }); }
  function note(ctx, parent, x, y, s, col, anchor, size) { return ctx.text(x, y, s, { size: size || 12, font: 'mono', color: col || 'dim', anchor: anchor || 'start', parent: parent }); }
  function box(ctx, parent, x, y, w, h, col) { return ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(7,12,24,0.88)', stroke: ctx.alpha(col || 'orange', 0.4), sw: 1.1, parent: parent }); }

  var NAV = ['COMPOSE', 'LOUDNESS', 'ENHANCE', 'ENCODE', 'PACKAGE', 'DELIVER'];
  function nav(ctx, k) {
    var S = ctx.state;
    if (!S.nav) {
      S.nav = ctx.group();
      S.navChips = NAV.map(function (n, i) { return ctx.label(902 + i * 120, 112, n, { color: 'dim', size: 11, w: 112, parent: S.nav }); });
      ctx.reveal(S.nav, { dur: 400 });
    }
    S.navChips.forEach(function (c, i) {
      var on = i === k;
      c.childNodes[0].setAttribute('fill', on ? ctx.alpha('orange', 0.22) : 'rgba(123,140,171,0.08)');
      c.childNodes[0].setAttribute('stroke', on ? ctx.C.orange : ctx.alpha('dim', 0.5));
      c.childNodes[1].setAttribute('fill', on ? ctx.C.orange : ctx.C.dim);
    });
  }
  function stage(ctx) {
    var S = ctx.state;
    if (S.main) ctx.remove(S.main, 350);
    S.main = ctx.group();
    return S.main;
  }

  /* ---------- 8x8 DCT machinery (orthonormal DCT-II) ---------- */
  function dct8(b) {
    var out = [];
    for (var u = 0; u < 8; u++) {
      out.push([]);
      for (var v = 0; v < 8; v++) {
        var s = 0;
        for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) s += b[y][x] * Math.cos((2 * y + 1) * u * Math.PI / 16) * Math.cos((2 * x + 1) * v * Math.PI / 16);
        out[u].push(0.25 * (u ? 1 : Math.SQRT1_2) * (v ? 1 : Math.SQRT1_2) * s);
      }
    }
    return out;
  }
  function idct8(c) {
    var out = [];
    for (var y = 0; y < 8; y++) {
      out.push([]);
      for (var x = 0; x < 8; x++) {
        var s = 0;
        for (var u = 0; u < 8; u++) for (var v = 0; v < 8; v++) s += (u ? 1 : Math.SQRT1_2) * (v ? 1 : Math.SQRT1_2) * c[u][v] * Math.cos((2 * y + 1) * u * Math.PI / 16) * Math.cos((2 * x + 1) * v * Math.PI / 16);
        out[y].push(0.25 * s);
      }
    }
    return out;
  }
  function zigzag() {
    var order = [];
    for (var s = 0; s < 15; s++) {
      var cells = [];
      for (var y = 0; y < 8; y++) { var x = s - y; if (x >= 0 && x < 8) cells.push([y, x]); }
      if (s % 2 === 0) cells.reverse();
      order = order.concat(cells);
    }
    return order;
  }
  function qstep(qp) { return Math.pow(2, (qp - 4) / 6); }

  Atlas.register({
    id: 'render-delivery',
    refs: [
      'FFmpeg Project, <i>FFmpeg Filters Documentation</i> (filtergraph, xfade, lut3d, loudnorm), ffmpeg 7.x, 2024–2025',
      'ITU-R BS.1770-4, <i>Algorithms to measure audio programme loudness and true-peak audio level</i>, 2015; EBU R 128, 2020',
      'Huang et al., <i>RIFE: Real-Time Intermediate Flow Estimation for Video Frame Interpolation</i>, ECCV 2022; Reda et al., <i>FILM</i>, ECCV 2022',
      'Wang et al., <i>Real-ESRGAN: Training Real-World Blind Super-Resolution with Pure Synthetic Data</i>, ICCVW 2021; Wang et al., <i>SeedVR2</i>, 2025',
      'Sullivan et al., <i>Overview of the High Efficiency Video Coding (HEVC) Standard</i>, IEEE TCSVT 2012; Han et al., <i>A Technical Overview of AV1</i>, Proc. IEEE 2021',
      'Aaron et al. (Netflix), <i>Per-Title Encode Optimization</i>, 2015; Li et al., <i>Toward a Practical Perceptual Video Quality Metric (VMAF)</i>, 2016',
      'ISO/IEC 23000-19 <i>CMAF</i>; RFC 8216 <i>HTTP Live Streaming</i>; ISO/IEC 23009-1 <i>MPEG-DASH</i>',
      'Spiteri et al., <i>BOLA: Near-Optimal Bitrate Adaptation for Online Videos</i>, IEEE/ACM ToN 2020; C2PA, <i>Technical Specification 2.x</i>, 2024–2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'EDL to filter graph',
        say: 'This chamber turns the edit decision list into bytes on a viewer\'s screen. First, compilation. A small pure function maps the JSON edit to an ffmpeg filter graph: decoders feed trim and timestamp nodes, a cross fade, a three dimensional look up table and the title overlay, while the audio stems flow through ducking, mixing and loudness normalization. Below is the frame accurate detail of one dissolve: each clip lends six frames of handle, the blend weight ramps over twelve frames, and the total length stays exactly seven hundred twenty frames.',
        deep: '<p>An ffmpeg <b>filter graph</b> is a DAG of filters connected by labelled pads; frames are pulled through it by the sinks. The compiler is deterministic and versioned, so <code>render_key = sha256(EDL ‖ input hashes ‖ ffmpeg build ‖ flags)</code>.</p>' +
          '<pre>[2:v]trim=start_frame=20:end_frame=116,\n     setpts=PTS-STARTPTS[s3];\n[3:v]trim=start_frame=2:end_frame=113,\n     setpts=PTS-STARTPTS[s4];\n[s3][s4]xfade=transition=fade:\n     duration=0.5:offset=3.5[s34];</pre>' +
          '<div class="eq">out(n) = (1 − α(n))·S3 + α(n)·S4,   α(n) = (n − 309) / 12,  n ∈ [309, 321)</div>' +
          '<ul><li><b>Time is rational</b>: frame indices at 24/1, PTS in a 1/24000 or 1/90000 timebase; floating-point seconds drift and cause off-by-one frames at cuts.</li>' +
          '<li><b>Colour</b>: work in linear or log space at 16-bit float for blends and the 33³ LUT (tetrahedral interpolation), then convert to BT.709 10-bit 4:2:0 once.</li>' +
          '<li><b>GPU path</b>: NVDEC → CUDA kernels (scale_cuda, overlay_cuda, custom LUT) → NVENC keeps frames in VRAM; PCIe copies of 1080p RGB frames (≈12 MB in 16-bit) are what usually bottleneck CPU/GPU hybrids.</li>' +
          '<li><b>Captions</b> are not burned in: the EDL\'s cues (from forced-alignment timestamps) become a WebVTT sidecar or IMSC/WebVTT track in CMAF, so they stay searchable, restylable and translatable; only social cuts burn them in with the <code>subtitles</code> filter.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          var code = ctx.code({ x: 60, y: 170, w: 450, title: 'edl.json (excerpt)', lang: 'json', size: 12, color: 'magenta', parent: G, lines: nb([
            '{"fps": "24/1", "dur_f": 720, "video": [ …',
            ' {"uri": "S3.mov", "in": 20, "out": 110,',
            '  "xfade": {"type": "dissolve", "f": 12}},',
            ' {"uri": "S4.mov", "in": 8, "out": 113}, … ],',
            ' "lut": "show_v2.cube", "loudness_lufs": -14}']) });
          var comp = ctx.node({ x: 285, y: 356, w: 400, h: 50, title: 'edl2fg compiler', sub: 'pure function · versioned · hashed', icon: 'code', color: 'magenta', titleSize: 15, subSize: 11, parent: G });
          var lc = ctx.line(285, 312, 285, 328, { color: 'magenta', arrow: true, parent: G });
          ctx.reveal(code, { from: 'left' });
          ctx.reveal([lc, comp], { delay: 300, stagger: 150 });
          /* filter graph */
          head(ctx, G, 560, 190, 'VIDEO GRAPH', 'lime');
          head(ctx, G, 560, 340, 'AUDIO GRAPH', 'orange');
          var XS = [630, 800, 970, 1140, 1310, 1480];
          var vt = ['6× NVDEC', 'trim·setpts', 'xfade 12 f', 'lut3d 33³', 'overlay title', '[v] 10-bit'];
          var at = ['A1 A2 A3', 'sidechain', 'amix', 'loudnorm', 'aresample', '[a] 48 kHz'];
          var vn = vt.map(function (s, k) { return ctx.node({ x: XS[k], y: 245, w: 140, h: 40, title: s, color: 'lime', kind: 'chip', titleSize: 12.5, glow: false, parent: G }); });
          var an = at.map(function (s, k) { return ctx.node({ x: XS[k], y: 395, w: 140, h: 40, title: s, color: 'orange', kind: 'chip', titleSize: 12.5, glow: false, parent: G }); });
          var mux = ctx.node({ x: 1480, y: 320, w: 140, h: 34, title: 'mux master', color: 'white', kind: 'box', titleSize: 12, glow: false, parent: G });
          var vl = [], al = [];
          for (var k = 0; k < 5; k++) { vl.push(ctx.link(vn[k], vn[k + 1], { color: 'lime', straight: true, parent: G })); al.push(ctx.link(an[k], an[k + 1], { color: 'orange', straight: true, parent: G })); }
          var m1 = ctx.link(vn[5], mux, { color: 'lime', from: 'b', to: 't', straight: true, parent: G });
          var m2 = ctx.link(an[5], mux, { color: 'orange', from: 't', to: 'b', straight: true, parent: G });
          var cg = ctx.link(comp, vn[0], { color: 'magenta', dash: '4 4', parent: G });
          var cg2 = ctx.link(comp, an[0], { color: 'magenta', dash: '4 4', parent: G });
          note(ctx, G, 560, 452, 'pull model: the sink requests frames; each filter pulls from its inputs', 'dim');
          ctx.reveal(vn.concat(an), { from: 'up', stagger: 50, delay: 500 });
          ctx.reveal(vl.concat(al, [m1, m2, cg, cg2]), { from: 'draw', stagger: 40, delay: 900 });
          ctx.reveal(mux, { from: 'scale', delay: 1200 });
          /* frame-accurate dissolve */
          box(ctx, G, 60, 490, 1500, 360, 'lime');
          head(ctx, G, 80, 514, 'FRAME-ACCURATE TRIM + DISSOLVE · timeline frames 200 → 440 (1 frame = 4 px)', 'lime');
          function fx(n) { return 300 + (n - 200) * 4; }
          var rows = ctx.group({ parent: G });
          note(ctx, rows, 90, 580, 'S3 source', 'text');
          ctx.rect(fx(205), 568, fx(326) - fx(205), 24, { rx: 3, fill: 'rgba(255,255,255,0.05)', stroke: 'faint', sw: 1, parent: rows });
          ctx.rect(fx(225), 568, fx(315) - fx(225), 24, { rx: 3, fill: ctx.alpha('lime', 0.3), stroke: 'lime', sw: 1, parent: rows });
          ctx.rect(fx(315), 568, fx(321) - fx(315), 24, { rx: 2, fill: ctx.alpha('amber', 0.45), stroke: 'amber', sw: 1, parent: rows });
          note(ctx, rows, fx(225) + 6, 580, 'in 20 … out 110', 'white', 'start', 11);
          note(ctx, rows, fx(326) + 8, 580, '+6 f handle (src 110–116)', 'amber', 'start', 11);
          note(ctx, rows, 90, 640, 'S4 source', 'text');
          ctx.rect(fx(307), 628, fx(428) - fx(307), 24, { rx: 3, fill: 'rgba(255,255,255,0.05)', stroke: 'faint', sw: 1, parent: rows });
          ctx.rect(fx(315), 628, fx(420) - fx(315), 24, { rx: 3, fill: ctx.alpha('cyan', 0.25), stroke: 'cyan', sw: 1, parent: rows });
          ctx.rect(fx(309), 628, fx(315) - fx(309), 24, { rx: 2, fill: ctx.alpha('amber', 0.45), stroke: 'amber', sw: 1, parent: rows });
          note(ctx, rows, fx(321) + 6, 640, 'in 8 … out 113', 'white', 'start', 11);
          note(ctx, rows, fx(309) - 8, 664, 'handle src 2–8', 'amber', 'end', 11);
          note(ctx, rows, 90, 710, 'output', 'text');
          ctx.rect(fx(225), 698, fx(309) - fx(225), 24, { rx: 3, fill: ctx.alpha('lime', 0.3), stroke: 'lime', sw: 1, parent: rows });
          ctx.rect(fx(321), 698, fx(420) - fx(321), 24, { rx: 3, fill: ctx.alpha('cyan', 0.25), stroke: 'cyan', sw: 1, parent: rows });
          for (var q = 0; q < 12; q++) ctx.rect(fx(309 + q), 698, 4, 24, { rx: 0, fill: ctx.mix(ctx.C.lime, ctx.C.cyan, (q + 0.5) / 12), opacity: 0.6, parent: rows });
          note(ctx, rows, 90, 770, 'α(n)', 'text');
          ctx.line(fx(225), 782, fx(309), 782, { color: 'lime', sw: 2, parent: rows });
          ctx.line(fx(309), 782, fx(321), 756, { color: 'amber', sw: 2, parent: rows });
          ctx.line(fx(321), 756, fx(420), 756, { color: 'cyan', sw: 2, parent: rows });
          note(ctx, rows, fx(321) + 8, 744, 'α = (n − 309) / 12', 'amber', 'start', 12);
          [[225, 'middle'], [309, 'end'], [321, 'start'], [420, 'middle']].forEach(function (p) {
            ctx.line(fx(p[0]), 560, fx(p[0]), 800, { color: 'rgba(255,255,255,0.12)', dash: '3 4', parent: rows });
            note(ctx, rows, fx(p[0]) + (p[1] === 'end' ? -4 : (p[1] === 'start' ? 4 : 0)), 818, String(p[0]), 'dim', p[1], 11);
          });
          note(ctx, rows, fx(315), 836, 'cut 315', 'amber', 'middle', 11);
          ctx.para(1300, 580, ['S3: 90 f used', 'S4: 105 f used', 'dissolve: 12 f', 'from handles', '', 'total unchanged:', '720 frames'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: rows });
          ctx.reveal(rows, { from: 'up', delay: 1300 });
          ctx.hud('render key = sha256(EDL ‖ inputs ‖ build)');
          return ctx.wait(1900).then(function () {
            return Promise.all(vl.map(function (l, i) { return ctx.wait(i * 180).then(function () { return ctx.packet(l, { color: 'lime', dur: 350, r: 4 }); }); })
              .concat(al.map(function (l, i) { return ctx.wait(i * 180).then(function () { return ctx.packet(l, { color: 'orange', dur: 350, r: 4 }); }); })));
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Loudness & true peak',
        say: 'Loudness is measured the way ears hear it, not by peak level. The signal is first K weighted: a high pass removes rumble and a shelf boosts everything above about one and a half kilohertz. Mean square energy is computed in four hundred millisecond blocks, and quiet blocks are gated away, first below minus seventy, then ten units below the average. Our mix measures minus eighteen point seven, so a clean gain of four point seven decibels lands it at minus fourteen. A true peak limiter then catches peaks that only appear between samples.',
        deep: '<p><b>ITU-R BS.1770-4</b> integrated loudness:</p>' +
          '<ol><li>K-weighting: 2nd-order high-shelf (+4 dB, ≈1.5 kHz) then 2nd-order high-pass (RLB, ≈38 Hz).</li>' +
          '<li>Blocks of 400 ms with 75 % overlap: z<sub>j</sub> = mean square of channel j.</li>' +
          '<li>Block loudness l = −0.691 + 10·log<sub>10</sub>(Σ<sub>j</sub> G<sub>j</sub>·z<sub>j</sub>), G = 1.0 for L/R/C, 1.41 for surrounds.</li>' +
          '<li>Absolute gate −70 LUFS, relative gate = (mean of surviving blocks) − 10 LU; average the survivors in the energy domain.</li></ol>' +
          '<div class="eq">L<sub>I</sub> = −0.691 + 10·log<sub>10</sub>( (1/|J<sub>g</sub>|) Σ<sub>j∈J<sub>g</sub></sub> Σ<sub>c</sub> G<sub>c</sub>·z<sub>c,j</sub> )</div>' +
          '<p><b>True peak</b>: upsample ×4 (48 → 192 kHz) and take the max |x|; sample peaks under-read the reconstructed waveform by 3 dB for a tone at f<sub>s</sub>/4 sampled at 45° (the demo below), and by more for pathological signals near Nyquist; 4× oversampling itself can still under-read by ≈0.7 dB. Lossy encoders (AAC, Opus) add overshoot, hence the −1 dBTP ceiling (−2 dBTP for ATSC).</p>' +
          '<table><tr><th>Target</th><th>Integrated</th><th>Max TP</th></tr>' +
          '<tr><td>Streaming platforms</td><td>−14 LUFS (Apple −16)</td><td>−1 dBTP</td></tr>' +
          '<tr><td>EBU R128 broadcast</td><td>−23 LUFS ±0.5</td><td>−1 dBTP</td></tr>' +
          '<tr><td>ATSC A/85</td><td>−24 LKFS ±2</td><td>−2 dBTP</td></tr></table>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 1);
          /* K-weighting curve */
          box(ctx, G, 60, 170, 700, 320, 'orange');
          head(ctx, G, 80, 194, 'K-WEIGHTING FILTER · gain (dB) vs frequency');
          function kdb(lf) {
            var f = Math.pow(10, lf);
            var hp = 10 * Math.log(Math.pow(f / 38, 4) / (1 + Math.pow(f / 38, 4))) / Math.LN10;
            var sh = 4 / (1 + Math.pow(1500 / f, 2));
            return hp + sh;
          }
          var kp = ctx.plot(120, 225, 600, 220, kdb, { xDomain: [Math.log(20) / Math.LN10, Math.log(20000) / Math.LN10], yDomain: [-12, 6], color: 'orange', sw: 2.2, samples: 200, parent: G, glow: true });
          [20, 100, 1000, 10000].forEach(function (f) { var p = kp.toPx(Math.log(f) / Math.LN10, -12); note(ctx, G, p.x, 460, f >= 1000 ? f / 1000 + 'k' : String(f), 'dim', 'middle', 11); });
          [-12, -6, 0, 4].forEach(function (d) { var p = kp.toPx(Math.log(20) / Math.LN10, d); note(ctx, G, 112, p.y, String(d), 'dim', 'end', 11); });
          var z = kp.toPx(Math.log(20) / Math.LN10, 0);
          ctx.line(120, z.y, 720, z.y, { color: 'faint', dash: '3 4', parent: G });
          note(ctx, G, 560, 305, 'shelf +4 dB above ~1.5 kHz', 'orange', 'middle', 12);
          note(ctx, G, 240, 420, 'high-pass ~38 Hz', 'orange', 'start', 12);
          ctx.reveal(kp.curve, { from: 'draw', dur: 1000 });
          /* gated blocks */
          box(ctx, G, 800, 170, 760, 320, 'orange');
          head(ctx, G, 820, 194, '400 ms BLOCKS (every 4th hop) · gating');
          var r = ctx.rng(9), bl = [];
          for (var i = 0; i < 75; i++) {
            var t = i * 0.4, v = -24 + 6 * t / 15 + 2 * r();
            if ((t > 0.4 && t < 4.2) || (t > 5.6 && t < 8.2) || (t > 17.8 && t < 21.8) || (t > 23 && t < 27)) v = Math.max(v, -20 + 1.5 * r());
            v += 9 * Math.exp(-Math.pow((t - 15.6) / 1.1, 2));
            if (t > 27.5) v = -40 - 20 * r();
            if (t > 29.2) v = -75;
            bl.push(v);
          }
          /* BS.1770 gating on the synthetic blocks, then calibrate the mix to measure −18.7 LUFS */
          function gated(arr) {
            function emean(xs) { var s = 0; xs.forEach(function (x) { s += Math.pow(10, x / 10); }); return 10 * Math.log(s / xs.length) / Math.LN10; }
            var a = arr.filter(function (x) { return x > -70; }), rel = emean(a) - 10;
            return { I: emean(a.filter(function (x) { return x > rel; })), rel: rel };
          }
          var off = -18.7 - gated(bl).I;
          bl = bl.map(function (v) { return v > -70 ? v + off : v; });
          var gt = gated(bl);
          function yv(v) { return 440 - (Math.max(-80, v) + 80) / 80 * 210; }
          var bars = bl.map(function (v, k) { return ctx.rect(830 + k * 9.6, yv(v), 7.4, 440 - yv(v), { rx: 1, fill: ctx.alpha(v > gt.rel ? 'orange' : 'dim', 0.55), parent: G }); });
          var absY = yv(-70), relY = yv(gt.rel);
          var gA = ctx.line(830, absY, 1550, absY, { color: 'red', dash: '5 4', parent: G });
          note(ctx, G, 1548, 470, 'red: absolute gate −70', 'red', 'end', 11);
          var gR = ctx.line(830, relY, 1550, relY, { color: 'amber', dash: '5 4', parent: G });
          var gRl = note(ctx, G, 1548, 194, 'amber: relative gate ' + gt.rel.toFixed(1).replace('-', '−') + ' (mean − 10 LU)', 'amber', 'end', 11);
          [0, -20, -40, -60, -80].forEach(function (d) { note(ctx, G, 822, yv(d), String(d), 'dim', 'end', 11); });
          var res = ctx.text(830, 470, 'integrated: −18.7 LUFS', { size: 14, font: 'mono', weight: 600, color: 'white', parent: G });
          ctx.reveal(bars, { from: 'up', stagger: 12, delay: 300, dur: 300 });
          ctx.reveal([gA, gR], { from: 'draw', delay: 1400, stagger: 200 });
          /* true peak */
          box(ctx, G, 60, 510, 1500, 340, 'red');
          head(ctx, G, 80, 534, 'TRUE PEAK · samples vs the reconstructed waveform (×4 oversampling)', 'red');
          var tp = ctx.plot(120, 570, 820, 240, function (x) { return 1.12 * Math.sin(2 * Math.PI * x / 4 + Math.PI / 4); }, { xDomain: [0, 12], yDomain: [-1.3, 1.3], color: 'cyan', sw: 1.8, samples: 300, parent: G });
          var p0 = tp.toPx(0, 1), pz = tp.toPx(0, 0), pc = tp.toPx(0, Math.pow(10, -1 / 20));
          ctx.line(120, p0.y, 940, p0.y, { color: 'red', dash: '5 4', parent: G });
          note(ctx, G, 944, p0.y, '0 dBFS', 'red', 'start', 11);
          ctx.line(120, pc.y + 0.5, 940, pc.y + 0.5, { color: 'lime', dash: '2 4', parent: G });
          note(ctx, G, 944, pc.y + 12, '−1 dBTP ceiling', 'lime', 'start', 11);
          ctx.line(120, pz.y, 940, pz.y, { color: 'faint', parent: G });
          var dots = [];
          for (var s = 0; s <= 12; s++) {
            var yvv = 1.12 * Math.sin(2 * Math.PI * s / 4 + Math.PI / 4), pp = tp.toPx(s, yvv);
            dots.push(ctx.line(pp.x, pz.y, pp.x, pp.y, { color: ctx.alpha('white', 0.4), sw: 1, parent: G }));
            dots.push(ctx.circle(pp.x, pp.y, 4.5, { fill: 'white', parent: G }));
          }
          note(ctx, G, 130, 830, 'tone at fs/4: samples peak at −2.0 dBFS, the band-limited waveform at +1.0 dBTP', 'text');
          ctx.reveal(tp.curve, { from: 'draw', delay: 700, dur: 1000 });
          ctx.reveal(dots, { stagger: 20, delay: 400 });
          var tbl = ctx.para(1080, 580, nb(['targets', 'streaming   −14 LUFS · −1 dBTP', 'Apple Music −16 LUFS', 'EBU R128    −23 LUFS · −1 dBTP', 'ATSC A/85   −24 LKFS · −2 dBTP', '', 'our master', 'I −14.0 · TP −1.0 · LRA 7.9']), { size: 13, font: 'mono', color: 'text', lh: 26, parent: G });
          ctx.reveal(tbl, { delay: 900 });
          ctx.hud('−18.7 LUFS + 4.7 dB → −14.0 LUFS');
          return ctx.wait(2200).then(function () {
            return Promise.all([ctx.counter(res, -18.7, -14.0, 900, function (v) { return 'integrated: ' + v.toFixed(1).replace('-', '−') + ' LUFS  (gain +4.7 dB)'; }),
              ctx.tween(900, function (tt) {
                bars.forEach(function (b, k) { var v = bl[k] + (bl[k] > -70 ? 4.7 * tt : 0); b.setAttribute('y', yv(v)); b.setAttribute('height', 440 - yv(v)); });
                var ry = yv(gt.rel + 4.7 * tt); gR.setAttribute('y1', ry); gR.setAttribute('y2', ry);
                gRl.textContent = 'amber: relative gate ' + (gt.rel + 4.7 * tt).toFixed(1).replace('-', '−') + ' (mean − 10 LU)';
              })]);
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Frame interpolation',
        say: 'Some video models generate sixteen frames per second, and some deliverables want forty eight or sixty. Frame interpolation invents the missing frames. RIFE estimates two flows directly from the intermediate time, one pointing back to the previous frame and one forward to the next, warps both frames along them, and blends the results with a learned mask that handles occlusions. Watch the fox slide as t moves from zero to one. One rule is absolute: never interpolate across a cut, or you get a ghostly morph between shots.',
        deep: '<p><b>RIFE</b> (ECCV 2022): IFNet regresses intermediate flows F<sub>t→0</sub>, F<sub>t→1</sub> and a fusion mask M directly, coarse-to-fine with 3 IFBlocks at 1/4, 1/2, 1 resolution; a privileged teacher (with access to I<sub>t</sub>) distils into it during training.</p>' +
          '<div class="eq">Î<sub>t</sub> = M ⊙ W(I<sub>0</sub>, F<sub>t→0</sub>) + (1 − M) ⊙ W(I<sub>1</sub>, F<sub>t→1</sub>)  (+ residual refinement)</div>' +
          '<p>W is backward warping by bilinear sampling. Arbitrary t is supported by conditioning on t; 2× is applied recursively for 4×.</p>' +
          '<ul><li>Speed: tens of 1080p frames per second on one modern GPU; FILM (bi-directional, multi-scale feature pyramid with shared weights) handles large motion better at higher cost.</li>' +
          '<li>Failure modes: thin structures, fast rotation, text/UI overlays, and <b>cuts</b>. Scene-change detection (histogram / SSIM drop, or the EDL itself) splits the stream into shots first.</li>' +
          '<li>Cadence: 16 → 24 fps is a 3:2 ratio, so two of every three output frames are synthesised at t = 1/3 and 2/3; 24 → 48 is plain 2×.</li></ul>' +
          '<div class="note">Generation-time alternative: many video DiTs are trained at 16–24 fps; interpolating after generation costs seconds, orders of magnitude less than generating twice as many latent frames (attention cost grows quadratically with frame count).</div>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 2);
          head(ctx, G, 80, 185, 'RIFE · flows from the intermediate time t');
          function frame(x, lab, col) {
            var g = ctx.group({ parent: G });
            ctx.rect(x, 205, 260, 160, { rx: 6, fill: '#0c3440', stroke: col, sw: 1.5, parent: g });
            ctx.rect(x, 315, 260, 50, { rx: 0, fill: ctx.alpha('cyan', 0.18), parent: g });
            var rr = ctx.rng(4);
            for (var i = 0; i < 6; i++) ctx.circle(x + 15 + rr() * 230, 215 + rr() * 60, 1.4, { fill: 'white', opacity: 0.6, parent: g });
            note(ctx, g, x + 130, 382, lab, col, 'middle', 13);
            return g;
          }
          var f0 = frame(80, 'I0 (t = 0)', 'dim'), f1 = frame(1220, 'I1 (t = 1)', 'dim'), ft = frame(650, 'Ît', 'lime');
          ctx.circle(80 + 70, 300, 13, { fill: 'orange', parent: f0 }); ctx.circle(80 + 70, 300, 19, { stroke: 'cyan', sw: 1.5, parent: f0 });
          ctx.circle(1220 + 190, 300, 13, { fill: 'orange', parent: f1 }); ctx.circle(1220 + 190, 300, 19, { stroke: 'cyan', sw: 1.5, parent: f1 });
          var foxT = ctx.group({ parent: ft });
          ctx.circle(0, 0, 13, { fill: 'orange', parent: foxT }); ctx.circle(0, 0, 19, { stroke: 'cyan', sw: 1.5, parent: foxT });
          var tl = ctx.text(650 + 250, 222, 't = 0.50', { size: 13, font: 'mono', color: 'lime', anchor: 'end', parent: ft });
          /* flow fields */
          function field(x0, dir, lab) {
            var g = ctx.group({ parent: G });
            ctx.rect(x0, 205, 260, 160, { rx: 6, fill: 'rgba(8,14,28,0.9)', stroke: ctx.alpha('lime', 0.5), sw: 1, dash: '4 4', parent: g });
            g.arrows = [];
            for (var r = 0; r < 4; r++) for (var c = 0; c < 6; c++) {
              var cx = x0 + 25 + c * 42, cy = 228 + r * 38;
              var onFox = r >= 1 && r <= 2 && c >= 1 && c <= 4;
              if (onFox) g.arrows.push({ el: ctx.line(cx, cy, cx + dir * 14, cy, { color: 'lime', arrow: true, sw: 1.6, parent: g }), cx: cx, cy: cy });
              else ctx.circle(cx, cy, 1.6, { fill: 'dim', parent: g });
            }
            note(ctx, g, x0 + 130, 382, lab, 'lime', 'middle', 13);
            return g;
          }
          var fa = field(365, -1, 'F t→0 (back)'), fb = field(935, 1, 'F t→1 (forward)');
          ctx.reveal([f0, f1], { stagger: 100 });
          ctx.reveal([fa, fb], { from: 'scale', delay: 500, stagger: 150 });
          ctx.reveal(ft, { from: 'scale', delay: 900 });
          /* fusion equation */
          var eq = ctx.text(800, 430, 'Ît = M ⊙ W(I0, F t→0) + (1 − M) ⊙ W(I1, F t→1)', { size: 20, font: 'mono', color: 'white', anchor: 'middle', parent: G });
          note(ctx, G, 800, 462, 'W = backward bilinear warp · M = learned occlusion mask', 'dim', 'middle', 12);
          ctx.reveal(eq, { from: 'up', delay: 1100 });
          /* IFNet pyramid */
          box(ctx, G, 60, 500, 740, 350, 'lime');
          head(ctx, G, 80, 524, 'IFNet · coarse-to-fine', 'lime');
          var sc = [['IFBlock 1/4', 120], ['IFBlock 1/2', 180], ['IFBlock 1', 240]];
          var ifb = sc.map(function (s, k) {
            var g = ctx.group({ parent: G });
            var x = 110 + k * 230, h = s[1] * 0.9;
            ctx.rect(x, 700 - h / 2, 170, h, { rx: 6, fill: ctx.alpha('lime', 0.08 + k * 0.05), stroke: 'lime', sw: 1.2, parent: g });
            note(ctx, g, x + 85, 700, s[0], 'white', 'middle', 13);
            note(ctx, g, x + 85, 720, k ? '+ ΔF, ΔM' : 'F, M', 'lime', 'middle', 12);
            if (k < 2) ctx.line(x + 172, 700, x + 226, 700, { color: 'lime', arrow: true, parent: g });
            return g;
          });
          ctx.reveal(ifb, { from: 'left', stagger: 150, delay: 1300 });
          /* cut rule + cadence */
          box(ctx, G, 840, 500, 720, 350, 'red');
          head(ctx, G, 860, 524, 'NEVER ACROSS A CUT · scene-change score', 'red');
          var cp = ctx.plot(880, 560, 640, 150, function (n) { return 0.08 + 0.05 * Math.sin(n * 1.7) + 0.85 * Math.exp(-Math.pow(n - 315, 2) / 1.2); }, { xDomain: [295, 335], yDomain: [0, 1], color: 'red', sw: 2, samples: 200, parent: G });
          var pcut = cp.toPx(315, 0.93);
          note(ctx, G, pcut.x + 10, pcut.y + 4, 'cut 315 → split here', 'red', 'start', 12);
          note(ctx, G, 880, 728, 'frame 295', 'dim', 'start', 11);
          note(ctx, G, 1520, 728, '335', 'dim', 'end', 11);
          var cad = ctx.group({ parent: G });
          note(ctx, cad, 880, 770, '16 fps', 'dim', 'start', 12);
          note(ctx, cad, 880, 808, '24 fps', 'lime', 'start', 12);
          for (var i = 0; i <= 8; i++) ctx.line(960 + i * 60, 760, 960 + i * 60, 780, { color: 'dim', sw: 2, parent: cad });
          for (var j = 0; j <= 12; j++) ctx.line(960 + j * 40, 798, 960 + j * 40, 818, { color: j % 3 === 0 ? 'dim' : 'lime', sw: 2, parent: cad });
          note(ctx, cad, 960, 836, 'green = synthesised at t = 1/3, 2/3', 'lime', 'start', 11);
          ctx.reveal(cp.curve, { from: 'draw', delay: 1500 });
          ctx.reveal(cad, { delay: 1700 });
          ctx.hud('16 → 24 fps: 2 of every 3 frames synthesised');
          function setT(t) {
            ctx.place(foxT, 650 + 70 + 120 * t, 300);
            tl.textContent = 't = ' + t.toFixed(2);
            fa.arrows.forEach(function (a) { a.el.setAttribute('x2', a.cx - 6 - 24 * t); });
            fb.arrows.forEach(function (a) { a.el.setAttribute('x2', a.cx + 6 + 24 * (1 - t)); });
          }
          setT(0.5);
          return ctx.wait(1200).then(function () {
            return ctx.tween(1600, function (e) { setT(0.5 - 0.5 * e); }, 'inOut');
          }).then(function () {
            return ctx.tween(2000, function (e) { setT(e); }, 'inOut');
          }).then(function () {
            return ctx.tween(1000, function (e) { setT(1 - 0.5 * e); }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Super-resolution',
        say: 'Next, resolution. The shots were rendered at seven twenty p because every extra pixel costs quadratic attention in the video model. A super resolution network restores the detail at ten eighty p or four K. Bicubic upsampling only interpolates, so edges blur. A learned model like Real ESRGAN has seen millions of degraded and clean pairs and hallucinates plausible texture: here the sharp crack in the ice. Frames are processed in overlapping tiles to bound memory, and diffusion based upscalers add temporal attention so the invented detail does not shimmer from frame to frame.',
        deep: '<p><b>Real-ESRGAN</b>: RRDBNet generator (23 residual-in-residual dense blocks, ~16.7 M params), U-Net discriminator with spectral norm; trained on synthetic pairs from a <i>high-order degradation</i> model (blur → resize → noise → JPEG, applied twice, plus sinc ringing).</p>' +
          '<div class="eq">L = L<sub>1</sub> + λ<sub>p</sub>·L<sub>percep</sub>(VGG) + λ<sub>g</sub>·L<sub>GAN</sub></div>' +
          '<ul><li><b>Why not render at 1080p?</b> Latent tokens scale with pixels: 1080p has 2.25× the tokens of 720p and full attention costs ~5× more. SR is far cheaper per pixel.</li>' +
          '<li><b>Tiling</b>: 512² input tiles with ≥ 32 px overlap, feathered blend; VRAM stays flat regardless of output size.</li>' +
          '<li><b>Scale factors</b>: models ship as ×2/×4, so 1280×720 → ×2 = 2560×1440 → Lanczos down to 1920×1080 (×1.5 overall), or ×3 overall for a 3840×2160 master.</li>' +
          '<li><b>Video SR</b>: per-frame GAN SR flickers (independent hallucinations). Recurrent / flow-guided VSR (BasicVSR++) and diffusion VSR (Upscale-A-Video, STAR, SeedVR2 one-step) use temporal attention or propagation for consistency.</li>' +
          '<li><b>Guardrails</b>: SR must not change identity; faces/fur are checked with an embedding distance against the pre-SR frame, and the critic compares VMAF/LPIPS against a bicubic baseline.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 2);
          box(ctx, G, 60, 170, 820, 390, 'lime');
          head(ctx, G, 80, 194, '×2 · LOW-RES PATCH → BICUBIC vs LEARNED SR', 'lime');
          /* high-res truth: ice with a sharp diagonal crack */
          function hr(r, c) {
            var d = Math.abs(c - r * 0.8 - 3.5);
            var crack = d < 0.8 ? -0.55 : 0;
            var tex = 0.06 * Math.sin(r * 2.1 + c * 1.3) + 0.04 * Math.cos(c * 3.7);
            return Math.max(0, Math.min(1, 0.62 + crack + tex + (c > r * 0.8 + 3.5 ? 0.12 : 0)));
          }
          function lr(r, c) { return (hr(2 * r, 2 * c) + hr(2 * r + 1, 2 * c) + hr(2 * r, 2 * c + 1) + hr(2 * r + 1, 2 * c + 1)) / 4; }
          function bic(r, c) {
            var y = (r - 0.5) / 2, x = (c - 0.5) / 2;
            var y0 = Math.max(0, Math.min(7, Math.floor(y))), x0 = Math.max(0, Math.min(7, Math.floor(x)));
            var y1 = Math.min(7, y0 + 1), x1 = Math.min(7, x0 + 1), fy = Math.max(0, Math.min(1, y - y0)), fx = Math.max(0, Math.min(1, x - x0));
            return (lr(y0, x0) * (1 - fx) + lr(y0, x1) * fx) * (1 - fy) + (lr(y1, x0) * (1 - fx) + lr(y1, x1) * fx) * fy;
          }
          var mL = ctx.matrix(95, 250, 8, 8, { cell: 26, gap: 2, cmap: 'gray', values: lr, parent: G });
          var mB = ctx.matrix(360, 250, 16, 16, { cell: 12, gap: 2, cmap: 'gray', values: bic, parent: G });
          var mS = ctx.matrix(630, 250, 16, 16, { cell: 12, gap: 2, cmap: 'gray', values: function () { return 0.05; }, parent: G });
          note(ctx, G, 206, 490, '8×8 input (720p)', 'text', 'middle', 12);
          note(ctx, G, 471, 490, 'bicubic ×2: blurred crack', 'dim', 'middle', 12);
          note(ctx, G, 741, 490, 'Real-ESRGAN ×2: sharp', 'lime', 'middle', 12);
          ctx.line(322, 360, 350, 360, { color: 'dim', arrow: true, parent: G });
          ctx.line(590, 360, 620, 360, { color: 'lime', arrow: true, parent: G });
          note(ctx, G, 95, 522, 'LR = 2×2 average of the true HR patch; SR restores plausible high frequencies', 'dim', 'start', 12);
          ctx.reveal([mL, mB], { from: 'scale', stagger: 200 });
          /* tiling */
          box(ctx, G, 920, 170, 640, 390, 'cyan');
          head(ctx, G, 940, 194, 'TILED INFERENCE · 1280×720 input · 512² tiles', 'cyan');
          var TX = 980, TY = 218, K = 520 / 1280;
          ctx.rect(TX, TY, 1280 * K, 720 * K, { rx: 3, fill: '#0c3440', stroke: 'cyan', sw: 1.2, parent: G });
          var tiles = [], xs = [0, 480, 768], ys = [0, 208];
          ys.forEach(function (y) { xs.forEach(function (x) { tiles.push(ctx.rect(TX + x * K, TY + y * K, 512 * K, 512 * K, { rx: 2, stroke: ctx.alpha('cyan', 0.6), sw: 1, dash: '4 3', fill: 'rgba(34,228,255,0.03)', parent: G })); }); });
          var act = ctx.rect(TX, TY, 512 * K, 512 * K, { rx: 2, stroke: 'white', sw: 2.2, fill: ctx.alpha('white', 0.06), glow: true, parent: G });
          note(ctx, G, 940, TY + 720 * K + 20, '6 tiles × (512² → 1024²) · overlaps feather-blended', 'text', 'start', 12);
          note(ctx, G, 940, TY + 720 * K + 40, 'VRAM independent of frame size · batch tiles', 'dim', 'start', 12);
          ctx.reveal(tiles, { stagger: 80, delay: 500 });
          /* bottom: families */
          box(ctx, G, 60, 580, 1500, 270, 'orange');
          head(ctx, G, 80, 604, 'MODEL FAMILIES · cost vs temporal stability');
          var fam = [['Diffusion VSR (STAR, Upscale-A-Video)', 'temporal attention · best texture · slow', 0.9, 0.88, 'violet'], ['One-step diffusion (SeedVR2-class)', 'distilled · near-GAN speed', 0.4, 0.8, 'lime'], ['BasicVSR++ (recurrent)', 'flow-guided propagation · stable', 0.3, 0.66, 'cyan'], ['Real-ESRGAN (GAN)', 'per-frame · fast · may flicker', 0.2, 0.35, 'orange']];
          var px0 = 120, py0 = 630, pw = 520, ph = 190;
          ctx.line(px0, py0 + ph, px0 + pw, py0 + ph, { color: 'faint', parent: G });
          ctx.line(px0, py0, px0, py0 + ph, { color: 'faint', parent: G });
          note(ctx, G, px0 + pw, py0 + ph + 16, 'GPU cost per frame →', 'dim', 'end', 11);
          note(ctx, G, px0 + 6, py0 + 6, 'temporal stability ↑', 'dim', 'start', 11);
          var fd = fam.map(function (f, k) {
            var g = ctx.group({ parent: G });
            var x = px0 + f[2] * pw, y = py0 + ph - f[3] * ph;
            ctx.circle(x, y, 8, { fill: ctx.alpha(f[4], 0.6), stroke: f[4], parent: g, glow: true });
            note(ctx, g, 700, 644 + k * 50, f[0], f[4], 'start', 14);
            note(ctx, g, 700, 664 + k * 50, f[1], 'dim', 'start', 12);
            ctx.line(x + 10, y, 690, 644 + k * 50, { color: ctx.alpha(f[4], 0.35), sw: 1, dash: '2 4', parent: g });
            return g;
          });
          ctx.reveal(fd, { from: 'fade', stagger: 150, delay: 900 });
          ctx.hud('SR ≪ cost of generating at 1080p');
          return ctx.wait(900).then(function () {
            return Promise.all([
              ctx.tween(1800, function (t) { mS.set(function (r, c) { var k = Math.min(1, Math.max(0, t * 1.6 - (r + c) / 40)); return bic(r, c) * (1 - k) + hr(r, c) * k; }); }, 'linear'),
              tiles.reduce(function (p, tt, k) {
                return p.then(function () {
                  var x = xs[k % 3], y = ys[Math.floor(k / 3)];
                  act.setAttribute('x', TX + x * K); act.setAttribute('y', TY + y * K);
                  return ctx.wait(380);
                });
              }, Promise.resolve())
            ]);
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'GOP & motion',
        say: 'Now inside the encoder. Most frames are predicted, not stored. An I frame is coded on its own. P frames predict from earlier frames, and B frames from both directions, so they are cheapest. Our group of pictures is closed and ninety six frames long, four seconds, so every streaming segment can start with a clean key frame. Prediction starts with motion estimation: for each block, the encoder searches a window in a reference frame for the best match, and sends only a motion vector plus the residual difference.',
        deep: '<p><b>Frame types</b>: I (intra only), P (forward references), B (bi-predicted, often non-reference in a hierarchy). A mini-GOP of 8 with hierarchical B frames is the x265/SVT-AV1 default shape: the B at position 4 (level L1) references frames 0 and 8; positions 2 and 6 (L2) reference their neighbours at 0/4 and 4/8; odd positions (L3) are non-reference leaves, coded with the highest QP.</p>' +
          '<p><b>Closed GOP</b> of 96 frames = 4 s: no reference crosses the IDR, so each CMAF segment is independently decodable, which is required for ABR switching and CDN caching.</p>' +
          '<p><b>Motion estimation</b> per block (H.264 macroblock 16×16 with partitions; HEVC CTU up to 64×64 split by quadtree; AV1 superblock 128×128):</p>' +
          '<div class="eq">mv* = argmin<sub>mv ∈ W</sub>  SAD(mv) + λ·R(mv − mv<sub>pred</sub>),   SAD = Σ |C(x) − R(x + mv)|</div>' +
          '<p>Searches are hierarchical (diamond / hexagon / UMH), refined to quarter-pel (H.264/HEVC) or 1/8-pel (AV1) with interpolation filters. Mode decision compares every candidate by RD cost J = D + λR, with λ tied to the quantiser (λ ≈ 0.85·2<sup>(QP−12)/3</sup> in H.264/HEVC reference encoders).</p>' +
          '<div class="note">Budget check for 1080p24 HEVC at 4.5 Mb/s: a 4 s GOP must average 18 Mbit, ≈190 kbit per frame. A plausible split is 1 I ≈ 1.1 Mbit + 11 P ≈ 0.4 Mbit + 84 B ≈ 0.15 Mbit (leaf B frames smallest) ≈ 18 Mbit. The quiet ice shots cost a fraction of the impact shot.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 3);
          box(ctx, G, 60, 170, 1500, 250, 'orange');
          head(ctx, G, 80, 194, 'CLOSED GOP · 96 frames (4 s) · mini-GOP 8, hierarchical B · first 17 frames shown');
          var types = ['I', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'P', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'P'];
          var lvl = [0, 3, 2, 3, 1, 3, 2, 3, 0, 3, 2, 3, 1, 3, 2, 3, 0];
          var fr = [];
          types.forEach(function (t, i) {
            var g = ctx.group({ parent: G });
            /* heights roughly ∝ bits: I 1.1 Mbit, P 0.4, B·L1/L2/L3 ≈ 0.25/0.17/0.12 */
            var x = 110 + i * 82, h = t === 'I' ? 110 : (t === 'P' ? 44 : [0, 30, 22, 16][lvl[i]]);
            var col = t === 'I' ? 'red' : (t === 'P' ? 'amber' : 'cyan');
            ctx.rect(x, 405 - h, 60, h, { rx: 4, fill: ctx.alpha(col, 0.3), stroke: col, sw: 1.2, parent: g });
            note(ctx, g, x + 30, 405 - h - 11, t === 'B' ? 'B·L' + lvl[i] : t + i, col, 'middle', 12);
            fr.push(g);
          });
          var arcs = [];
          function arc(a, b, col) {
            var xa = 140 + a * 82, xb = 140 + b * 82;
            arcs.push(ctx.path('M' + xa + ',270 Q' + (xa + xb) / 2 + ',' + (262 - Math.abs(b - a) * 6) + ' ' + xb + ',270', { stroke: ctx.alpha(col, 0.75), sw: 1.3, arrow: true, parent: G }));
          }
          arc(0, 8, 'amber'); arc(8, 16, 'amber'); arc(0, 4, 'cyan'); arc(8, 4, 'cyan'); arc(4, 2, 'cyan'); arc(4, 6, 'cyan');
          note(ctx, G, 1540, 222, 'bar height ≈ ∝ bits per frame · arcs = references', 'dim', 'end', 11);
          ctx.reveal(fr, { from: 'up', stagger: 50 });
          ctx.reveal(arcs, { from: 'draw', stagger: 120, delay: 900 });
          /* motion search */
          box(ctx, G, 60, 440, 860, 410, 'orange');
          head(ctx, G, 80, 464, 'BLOCK-MATCHING MOTION SEARCH · 16×16 block · ±8 px window shown');
          function frameG(x0, fox, lab) {
            var g = ctx.group({ parent: G });
            ctx.rect(x0, 490, 384, 256, { rx: 4, fill: '#0c3440', stroke: 'dim', sw: 1, parent: g });
            for (var i = 1; i < 6; i++) ctx.line(x0 + i * 64, 490, x0 + i * 64, 746, { color: 'rgba(255,255,255,0.07)', parent: g });
            for (var j = 1; j < 4; j++) ctx.line(x0, 490 + j * 64, x0 + 384, 490 + j * 64, { color: 'rgba(255,255,255,0.07)', parent: g });
            ctx.rect(x0, 682, 384, 64, { rx: 0, fill: ctx.alpha('cyan', 0.15), parent: g });
            ctx.circle(x0 + fox, 618, 18, { fill: 'orange', parent: g });
            ctx.circle(x0 + fox, 618, 26, { stroke: 'cyan', sw: 1.5, parent: g });
            note(ctx, g, x0 + 192, 766, lab, 'text', 'middle', 12);
            return g;
          }
          var ref = frameG(90, 150, 'reference frame (n − 1)'), cur = frameG(506, 182, 'current frame n');
          var blkC = ctx.rect(506 + 150, 586, 64, 64, { rx: 2, stroke: 'white', sw: 2, glow: true, parent: G });
          var win = ctx.rect(90 + 118 - 32, 586 - 32, 128, 128, { rx: 3, stroke: 'amber', sw: 1.5, dash: '5 4', parent: G });
          var cand = ctx.rect(90 + 118 - 32, 586 - 32, 64, 64, { rx: 2, stroke: 'amber', sw: 2, fill: ctx.alpha('amber', 0.12), parent: G });
          var mv = ctx.line(506 + 182, 618, 506 + 150, 618, { color: 'lime', sw: 2.5, arrow: true, parent: G, opacity: 0 });
          var sad = ctx.text(90, 800, 'SAD = —', { size: 14, font: 'mono', color: 'amber', parent: G });
          var mvT = ctx.text(506, 800, 'mv = ?', { size: 14, font: 'mono', color: 'lime', parent: G });
          note(ctx, G, 90, 826, 'search: 8-point diamond → quarter-pel refinement', 'dim', 'start', 12);
          ctx.reveal([ref, cur], { stagger: 150, delay: 400 });
          ctx.reveal([blkC, win, cand], { delay: 800, stagger: 120 });
          /* residual */
          box(ctx, G, 960, 440, 600, 410, 'orange');
          head(ctx, G, 980, 464, 'PREDICT → RESIDUAL');
          var r = ctx.rng(21);
          var cB = [], pB = [];
          for (var y = 0; y < 8; y++) { cB.push([]); pB.push([]); for (var x = 0; x < 8; x++) { var base = 0.45 + 0.35 * Math.exp(-((x - 3.5) * (x - 3.5) + (y - 3.5) * (y - 3.5)) / 8); cB[y].push(base + 0.05 * r()); pB[y].push(base + 0.05 * r() - 0.02); } }
          var m1 = ctx.matrix(990, 510, 8, 8, { cell: 18, gap: 2, cmap: 'gray', values: cB, parent: G });
          var m2 = ctx.matrix(1180, 510, 8, 8, { cell: 18, gap: 2, cmap: 'gray', values: pB, parent: G });
          var m3 = ctx.matrix(1370, 510, 8, 8, { cell: 18, gap: 2, cmap: 'diverge', values: function (yy, xx) { return (cB[yy][xx] - pB[yy][xx]) * 8; }, parent: G });
          note(ctx, G, 1068, 684, 'current C', 'text', 'middle', 12);
          note(ctx, G, 1258, 684, 'prediction R(x+mv)', 'text', 'middle', 12);
          note(ctx, G, 1448, 684, 'residual (×8)', 'orange', 'middle', 12);
          note(ctx, G, 1158, 590, '−', 'white', 'middle', 22);
          note(ctx, G, 1348, 590, '=', 'white', 'middle', 22);
          ctx.para(980, 724, ['residual energy ≈ 3 % of the block', '→ DCT + quantisation (next step)', 'bits = mv (≈ 6 bit) + residual coeffs', 'J = D + λR picks mode + partition'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: G });
          ctx.reveal([m1, m2, m3], { from: 'scale', stagger: 150, delay: 1000 });
          ctx.hud('GOP 96 f = 4 s · I ≫ P ≫ B in bits');
          /* animate the search: raster over the window, converge on best match (dx = −32 px in scene = −8 px real) */
          var pos = [[-32, -32], [0, -32], [32, -32], [-32, 0], [32, 0], [-32, 32], [0, 32], [32, 32], [0, 0], [-16, 0], [8, 0], [0, 0]];
          /* the centre (the true match) must have the lowest SAD; half-step probes around it are worse */
          var sads = [4210, 3980, 4420, 2210, 3650, 3890, 3310, 4050, 540, 2890, 1370, 540];
          return ctx.wait(1300).then(function () {
            return pos.reduce(function (p, q, k) {
              return p.then(function () {
                cand.setAttribute('x', 90 + 118 + q[0]);
                cand.setAttribute('y', 586 + q[1]);
                sad.textContent = 'SAD = ' + sads[k];
                return ctx.wait(170);
              });
            }, Promise.resolve());
          }).then(function () {
            cand.setAttribute('x', 90 + 118); cand.setAttribute('y', 586);
            sad.textContent = 'SAD = 312 (best, after ¼-pel)';
            mvT.textContent = 'mv = (−8, 0) px · coded as Δ from predictor';
            return ctx.fade(mv, 1, 400);
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Transform & quantize',
        say: 'The residual, or an intra block, is transformed. A discrete cosine transform rewrites the eight by eight pixels as eight by eight frequencies. For natural images, energy piles into the top left corner, the low frequencies. Quantization is where information is actually thrown away: each coefficient is divided by a step size and rounded, and most high frequency coefficients become zero. The step doubles every six QP. Click the QP chips to see the trade off between zeros, bits and reconstruction quality. A zigzag scan and arithmetic coding finish the job.',
        deep: '<div class="eq">X(u,v) = ¼·c<sub>u</sub>c<sub>v</sub> Σ<sub>y,x</sub> s<sub>y,x</sub>·cos((2y+1)uπ/16)·cos((2x+1)vπ/16),  c<sub>0</sub> = 1/√2</div>' +
          '<div class="eq">q(u,v) = sign(X)·⌊ |X| / Q<sub>step</sub> + f ⌋,   Q<sub>step</sub> = 2<sup>(QP − 4)/6</sup></div>' +
          '<p>f is the dead-zone rounding offset (≈1/3 intra, 1/6 inter in H.264 reference); rate-distortion-optimised quantisation (RDOQ / trellis) goes further and zeroes coefficients whose bits cost more than their distortion saving.</p>' +
          '<ul><li><b>Transforms</b>: H.264 4×4/8×8 integer DCT; HEVC 4–32 integer DCT (+ DST-VII for 4×4 intra luma); AV1 4×4 to 64×64 with DCT, ADST, flipped ADST and identity per direction (16 combinations); VVC adds MTS and LFNST.</li>' +
          '<li><b>Entropy coding</b>: zigzag / diagonal scan groups trailing zeros; CABAC (H.264/HEVC) or multi-symbol adaptive arithmetic coding (AV1) codes significance maps, levels and signs at ≈ information-theoretic cost.</li>' +
          '<li><b>In-loop filters</b> then clean the reconstruction before it is used as a reference: deblocking, SAO (HEVC), CDEF + loop restoration (AV1).</li></ul>' +
          '<p>QP +6 ≈ half the bitrate. In the demo block (real DCT and quantiser, computed live), raising QP from 22 to 38 zeroes most remaining coefficients and costs several dB of PSNR; click the chips to read the exact numbers.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 3);
          /* pixel block: ice edge + texture */
          var r = ctx.rng(33), px = [];
          for (var y = 0; y < 8; y++) { px.push([]); for (var x = 0; x < 8; x++) px[y].push(128 + 55 * Math.tanh((x - 0.6 * y - 2.2) / 1.1) + 12 * Math.cos(x * 0.9 + y * 0.4) + 6 * (r() - 0.5)); }
          var cen = px.map(function (row) { return row.map(function (v) { return v - 128; }); });
          var X = dct8(cen), maxA = 0;
          X.forEach(function (row) { row.forEach(function (v) { maxA = Math.max(maxA, Math.abs(v)); }); });
          var ZZ = zigzag();
          head(ctx, G, 80, 185, '8×8 BLOCK → DCT → QUANTISE → ZIGZAG → ENTROPY CODE');
          var CELL = 34, GAP = 3;
          var mP = ctx.matrix(80, 230, 8, 8, { cell: CELL, gap: GAP, cmap: 'gray', values: function (yy, xx) { return px[yy][xx] / 255; }, parent: G });
          var mX = ctx.matrix(430, 230, 8, 8, { cell: CELL, gap: GAP, cmap: 'diverge', values: function (u, v) { var c = X[u][v]; return (c < 0 ? -1 : 1) * Math.sqrt(Math.abs(c) / maxA); }, parent: G });
          var mQ = ctx.matrix(780, 230, 8, 8, { cell: CELL, gap: GAP, cmap: 'diverge', stroke: ctx.alpha('dim', 0.35), values: function () { return 0; }, parent: G });
          var qTxt = [];
          for (var u = 0; u < 8; u++) { qTxt.push([]); for (var v = 0; v < 8; v++) { var cc = mQ.cellCenter(u, v); qTxt[u].push(note(ctx, G, cc.x, cc.y + 0.5, '0', 'faint', 'middle', 11)); } }
          note(ctx, G, 228, 540, 'pixels (luma)', 'text', 'middle', 13);
          note(ctx, G, 578, 540, 'DCT coefficients', 'text', 'middle', 13);
          note(ctx, G, 928, 540, 'quantised levels', 'orange', 'middle', 13);
          note(ctx, G, 430, 212, 'DC', 'orange', 'start', 11);
          note(ctx, G, 726, 546, 'high freq', 'blue', 'end', 11);
          ctx.line(386, 378, 422, 378, { color: 'dim', arrow: true, parent: G });
          ctx.line(736, 378, 772, 378, { color: 'dim', arrow: true, parent: G });
          /* zigzag path over quantised matrix */
          var zz = 'M' + ZZ.map(function (p) { var c = mQ.cellCenter(p[0], p[1]); return c.x + ',' + c.y; }).join(' L');
          var zpath = ctx.path(zz, { stroke: ctx.alpha('white', 0.35), sw: 1.2, parent: G });
          ctx.reveal([mP, mX], { from: 'scale', stagger: 200 });
          ctx.reveal(mQ, { delay: 500 });
          ctx.reveal(zpath, { from: 'draw', delay: 900, dur: 1200 });
          /* right: QP chips + stats */
          box(ctx, G, 1130, 220, 430, 320, 'orange');
          head(ctx, G, 1150, 244, 'QUANTISER · click a QP');
          var qps = [22, 30, 38];
          S.qpChips = qps.map(function (q, k) {
            var c = ctx.label(1200 + k * 120, 282, 'QP ' + q, { color: 'dim', size: 14, w: 104, parent: G });
            c.style.cursor = 'pointer';
            return c;
          });
          var st1 = note(ctx, G, 1150, 330, '', 'text', 'start', 14);
          var st2 = note(ctx, G, 1150, 360, '', 'text', 'start', 14);
          var st3 = note(ctx, G, 1150, 390, '', 'text', 'start', 14);
          var st4 = note(ctx, G, 1150, 420, '', 'lime', 'start', 14);
          note(ctx, G, 1150, 460, 'Qstep = 2^((QP − 4) / 6)', 'dim', 'start', 13);
          note(ctx, G, 1150, 486, 'QP + 6 ⇒ step × 2 ⇒ ≈ ½ the bits', 'dim', 'start', 13);
          /* bottom: zigzag sequence + reconstruction */
          box(ctx, G, 60, 580, 1500, 270, 'orange');
          head(ctx, G, 80, 604, 'ZIGZAG SEQUENCE → CABAC / multi-symbol arithmetic coder');
          var seq = [];
          for (var i = 0; i < 24; i++) seq.push(ctx.label(110 + i * 56, 646, '0', { color: 'dim', size: 12, w: 50, parent: G }));
          note(ctx, G, 1460, 646, '… EOB', 'dim', 'start', 12);
          var mR = ctx.matrix(120, 690, 8, 8, { cell: 16, gap: 2, cmap: 'gray', values: function () { return 0.5; }, parent: G });
          var mE = ctx.matrix(330, 690, 8, 8, { cell: 16, gap: 2, cmap: 'diverge', values: function () { return 0; }, parent: G });
          note(ctx, G, 191, 842, 'reconstruction', 'text', 'middle', 11);
          note(ctx, G, 401, 842, 'error (×4)', 'text', 'middle', 11);
          ctx.para(560, 710, ['decoder: level × Qstep → inverse DCT → + prediction', 'in-loop: deblocking + SAO (HEVC) / CDEF + LR (AV1)', 'transform sizes: H.264 4–8 · HEVC 4–32 · AV1 4–64', 'AV1 picks DCT / ADST / flipADST / identity per axis'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: G });
          function apply(qp) {
            S.qp = qp;
            var step = qstep(qp), Q = [], nz = 0, bits = 0, maxq = 1;
            for (var u = 0; u < 8; u++) { Q.push([]); for (var v = 0; v < 8; v++) { var c = X[u][v], lv = (c < 0 ? -1 : 1) * Math.floor(Math.abs(c) / step + 1 / 6); Q[u].push(lv); if (lv) { nz++; bits += 2 + 2 * Math.floor(Math.log(Math.abs(lv)) / Math.LN2 + 1); } maxq = Math.max(maxq, Math.abs(lv)); } }
            bits += 4 + nz * 1.5;
            mQ.set(function (u, v) { var q = Q[u][v]; return q ? (q < 0 ? -1 : 1) * (0.25 + 0.75 * Math.sqrt(Math.abs(q) / maxq)) : 0; });
            for (u = 0; u < 8; u++) for (v = 0; v < 8; v++) { qTxt[u][v].textContent = String(Q[u][v]).replace('-', '−'); qTxt[u][v].setAttribute('fill', Q[u][v] ? ctx.C.white : ctx.C.faint); }
            var deq = Q.map(function (row) { return row.map(function (l) { return l * step; }); });
            var rec = idct8(deq), mse = 0;
            for (var yy = 0; yy < 8; yy++) for (var xx = 0; xx < 8; xx++) { var d = rec[yy][xx] - cen[yy][xx]; mse += d * d; }
            mse /= 64;
            mR.set(function (yy, xx) { return Math.max(0, Math.min(1, (rec[yy][xx] + 128) / 255)); });
            mE.set(function (yy, xx) { return (rec[yy][xx] - cen[yy][xx]) * 4 / 64; });
            ZZ.slice(0, 24).forEach(function (p, k) { var l = Q[p[0]][p[1]]; seq[k].childNodes[1].textContent = String(l).replace('-', '−'); seq[k].childNodes[1].setAttribute('fill', l ? ctx.C.orange : ctx.C.faint); seq[k].childNodes[0].setAttribute('stroke', l ? ctx.C.orange : ctx.alpha('dim', 0.5)); });
            st1.textContent = nb(['Qstep      = '])[0] + step.toFixed(1);
            st2.textContent = nb(['non-zero   = '])[0] + nz + ' / 64';
            st3.textContent = 'bits (est) ≈ ' + Math.round(bits);
            st4.textContent = nb(['PSNR       = '])[0] + (10 * Math.log(255 * 255 / Math.max(1e-6, mse)) / Math.LN10).toFixed(1) + ' dB';
            S.qpChips.forEach(function (c, k) {
              var on = qps[k] === qp;
              c.childNodes[0].setAttribute('fill', on ? ctx.alpha('orange', 0.25) : 'rgba(123,140,171,0.08)');
              c.childNodes[0].setAttribute('stroke', on ? ctx.C.orange : ctx.alpha('dim', 0.5));
              c.childNodes[1].setAttribute('fill', on ? ctx.C.orange : ctx.C.dim);
            });
          }
          S.qpChips.forEach(function (c, k) { c.addEventListener('click', function () { apply(qps[k]); }); });
          apply(22);
          ctx.hud('QP +6 ⇒ Qstep ×2 ⇒ ≈ ½ bits');
          return ctx.wait(2000).then(function () { apply(30); return ctx.wait(1500); }).then(function () { apply(38); return ctx.wait(1500); }).then(function () { apply(30); });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Rate control & codecs',
        say: 'How many bits does each frame get? That is rate control. Constant rate factor holds quality steady and lets size float. Capped variable bitrate, with a buffer model, is the choice for streaming: quiet ice shots are cheap, and the crash at fifteen seconds borrows bits. Two pass encoding measures complexity first and then allocates. Codec generations shift the whole rate quality curve: HEVC needs roughly forty percent fewer bits than the older AVC standard for the same VMAF, and AV1 another twenty to thirty percent. Hardware encoders like NVENC do all of this at hundreds of frames per second.',
        deep: '<table><tr><th>Mode</th><th>Controls</th><th>Use</th></tr>' +
          '<tr><td>CQP</td><td>fixed QP per frame type</td><td>research, never delivery</td></tr>' +
          '<tr><td>CRF / CQ</td><td>perceptual constant quality (x264/x265 CRF 18–28, NVENC CQ)</td><td>mezzanine, archive</td></tr>' +
          '<tr><td>CBR</td><td>constant bits, strict VBV</td><td>live, low latency</td></tr>' +
          '<tr><td>capped VBR</td><td>target + maxrate + bufsize (VBV/HRD)</td><td>VOD ABR ladders</td></tr>' +
          '<tr><td>2-pass</td><td>pass 1 logs per-frame complexity</td><td>best allocation at a size</td></tr></table>' +
          '<p>The VBV (leaky bucket) guarantees a decoder with buffer B draining at maxrate never under-runs: Σ bits over any window ≤ maxrate·t + B.</p>' +
          '<p><b>BD-rate</b> (Bjøntegaard delta): average bitrate difference between two RD curves at equal quality, integrated over the overlapping quality range in log-rate. Reported gains: HEVC vs H.264 ≈ −35…−50 % (objective PSNR BD-rate at the low end, subjective tests at the high end), AV1 vs HEVC ≈ −20…−30 % (content and encoder dependent); VVC ≈ −40 % vs HEVC in JVET common test conditions, but with limited device decode support in 2026.</p>' +
          '<div class="note"><b>NVENC</b> (Ada, Blackwell): dedicated ASIC blocks, H.264 / HEVC / AV1, presets P1–P7, lookahead, temporal AQ and B-frames as references; multiple 1080p streams at hundreds of fps per GPU without touching the CUDA cores. Slow software encoders (x265 veryslow, SVT-AV1 preset 2–4) still win ≈10–20 % BD-rate, worth it for a video watched a million times.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 3);
          box(ctx, G, 60, 170, 760, 440, 'orange');
          head(ctx, G, 80, 194, 'RATE–QUALITY · 1080p24 · VMAF vs bitrate (log)');
          function vm(R, s) { return 100 - 23.7 * Math.pow(R / s, -0.8); }
          var lx = [Math.log(0.5) / Math.LN10, Math.log(12) / Math.LN10];
          var codecs = [['H.264', 1, 'dim'], ['HEVC', 0.6, 'cyan'], ['AV1', 0.45, 'lime']];
          var plots = codecs.map(function (c, k) {
            return ctx.plot(130, 230, 640, 320, function (l) { return vm(Math.pow(10, l), c[1]); }, { xDomain: lx, yDomain: [50, 100], color: c[2], sw: 2.4, samples: 120, axes: k === 0, parent: G, glow: k === 2 });
          });
          var pl = plots[0];
          [0.5, 1, 2, 4, 8].forEach(function (R) { var p = pl.toPx(Math.log(R) / Math.LN10, 50); note(ctx, G, p.x, 568, R + ' Mb/s', 'dim', 'middle', 11); });
          [60, 70, 80, 90, 100].forEach(function (v) { var p = pl.toPx(lx[0], v); note(ctx, G, 122, p.y, String(v), 'dim', 'end', 11); });
          /* BD arrows at VMAF 93 */
          function rAt(v, s) { return s * Math.pow(23.7 / (100 - v), 1 / 0.8); }
          var y93 = pl.toPx(lx[0], 93).y;
          var a1 = pl.toPx(Math.log(rAt(93, 1)) / Math.LN10, 93), a2 = pl.toPx(Math.log(rAt(93, 0.6)) / Math.LN10, 93), a3 = pl.toPx(Math.log(rAt(93, 0.45)) / Math.LN10, 93);
          var bd = [ctx.line(a1.x, y93, a2.x + 4, y93, { color: 'cyan', sw: 2, arrow: true, parent: G }), ctx.line(a2.x, y93 + 16, a3.x + 4, y93 + 16, { color: 'lime', sw: 2, arrow: true, parent: G })];
          var leg = nb(['H.264   baseline', 'HEVC    −40 % bits', 'AV1     −25 % vs HEVC']);
          codecs.forEach(function (c, k) { note(ctx, G, 580, 470 + k * 22, leg[k], c[2], 'start', 13); });
          note(ctx, G, 580, 540, 'arrows: equal VMAF 93', 'dim', 'start', 11);
          note(ctx, G, 150, 250, 'VMAF 93 ≈ "excellent" on a TV', 'dim', 'start', 11);
          plots.forEach(function (p, k) { ctx.reveal(p.curve, { from: 'draw', delay: 200 + k * 300, dur: 900 }); });
          ctx.reveal(bd, { from: 'draw', delay: 1300, stagger: 200 });
          /* bit allocation over time */
          box(ctx, G, 860, 170, 700, 440, 'orange');
          head(ctx, G, 880, 194, 'BIT ALLOCATION · capped VBR vs CBR (kbit per second)');
          var cx = [];
          for (var s = 0; s < 30; s++) {
            var c = 0.35 + 0.1 * Math.sin(s * 0.7);
            if (s >= 9 && s < 13) c = 0.75;
            if (s >= 13 && s < 18) c = 1.0 - 0.1 * Math.abs(s - 15);
            if (s >= 27) c = 0.15;
            cx.push(Math.min(1, c));
          }
          var vb = ctx.bars(900, 240, 620, 280, cx.map(function () { return 0.01; }), { color: cx.map(function (c) { return c > 0.7 ? 'amber' : 'orange'; }), gap: 3, parent: G });
          var cbrY = 240 + 280 - 0.5 * 280, capY = 240 + 280 - 0.95 * 280;
          var cbr = ctx.line(900, cbrY, 1520, cbrY, { color: 'cyan', dash: '6 4', parent: G });
          var cap = ctx.line(900, capY, 1520, capY, { color: 'red', dash: '3 4', parent: G });
          note(ctx, G, 1516, cbrY - 10, 'CBR 4.5 Mb/s', 'cyan', 'end', 11);
          note(ctx, G, 1516, capY - 10, 'maxrate 8.5 Mb/s (VBV)', 'red', 'end', 11);
          [0, 5, 10, 15, 20, 25].forEach(function (t) { note(ctx, G, 900 + t * (620 / 30) + 8, 540, t + 's', 'dim', 'middle', 11); });
          note(ctx, G, 900 + 15 * (620 / 30), 226, 'impact', 'amber', 'middle', 11);
          note(ctx, G, 880, 574, 'average 4.5 Mb/s · 2-pass: pass 1 measures complexity, pass 2 allocates', 'text', 'start', 12);
          ctx.reveal([cbr, cap], { from: 'draw', delay: 500 });
          /* bottom: modes + NVENC */
          box(ctx, G, 60, 630, 1500, 220, 'orange');
          head(ctx, G, 80, 654, 'RATE-CONTROL MODES · and who encodes');
          var modes = [['CRF / CQ', 'constant quality, size floats', 'violet'], ['CBR', 'constant bits, live / low latency', 'cyan'], ['capped VBR', 'target + maxrate + bufsize', 'orange'], ['2-pass', 'measure, then allocate', 'amber']];
          var mc = modes.map(function (m, k) {
            var g = ctx.group({ parent: G });
            ctx.label(180 + k * 250, 700, m[0], { color: m[2], size: 14, w: 200, parent: g });
            note(ctx, g, 180 + k * 250, 732, m[1], 'dim', 'middle', 11);
            return g;
          });
          var nv = ctx.node({ x: 1320, y: 710, w: 400, h: 64, title: 'NVENC ASIC', sub: 'H.264 · HEVC · AV1 · P1–P7 · lookahead', icon: 'chip', color: 'red', titleSize: 16, subSize: 11, parent: G });
          note(ctx, G, 80, 790, 'delivery here: 2-pass capped VBR, HEVC Main10 + AV1 10-bit, H.264 High fallback for old devices', 'text', 'start', 13);
          note(ctx, G, 80, 816, '4 rungs × 3 codecs = 12 encodes of 720 frames, fanned out over the job\'s 8 GPUs\' NVENC engines ≈ 3 s', 'dim', 'start', 12);
          ctx.reveal(mc, { from: 'up', stagger: 100, delay: 800 });
          ctx.reveal(nv, { from: 'right', delay: 1100 });
          ctx.hud('HEVC ≈ −40 % vs H.264 · AV1 ≈ −25 % vs HEVC');
          return ctx.wait(900).then(function () { return vb.update(cx.map(function (c) { return Math.min(0.95, c); }), 1400); });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Ladder & packaging',
        say: 'One encode is not enough, because viewers have different screens and networks. Per title encoding encodes several resolutions across many bitrates, draws their quality curves, and keeps only the upper convex hull: at low bitrates a smaller resolution looks better than a starved ten eighty p. The chosen rungs are then cut into four second CMAF segments, fragmented MP4 with a shared init segment. The same segments are described twice, by an HLS playlist for Apple devices and a DASH manifest for everything else. The C2PA provenance manifest travels in the init segment.',
        deep: '<p><b>Per-title / per-shot encoding</b> (Netflix 2015 → dynamic optimizer): for each resolution r, encode at many CRFs, compute (bitrate, VMAF), take the upper convex hull over all r, then pick rungs ~1.5–2× apart in bitrate along it. A dark, slow trailer might need 3.2 Mb/s for VMAF 95 at 1080p; a grainy action trailer 7 Mb/s.</p>' +
          '<p><b>CMAF</b> (ISO/IEC 23000-19): <code>init.mp4</code> = ftyp + moov (codec config, no samples); each segment = styp + moof + mdat with one closed GOP. Segments of 2–6 s trade startup and switch latency against compression (longer GOP) and request overhead. Low-latency CMAF splits segments into ~0.5 s chunks sent with HTTP chunked transfer.</p>' +
          '<ul><li><b>HLS</b> (RFC 8216): master playlist lists variants with BANDWIDTH, RESOLUTION, CODECS; media playlists list segments with EXTINF and EXT-X-MAP for the init segment.</li>' +
          '<li><b>DASH</b> (ISO/IEC 23009-1): MPD → Period → AdaptationSet → Representation, with SegmentTemplate addressing.</li>' +
          '<li><b>C2PA</b>: the manifest (claims: generator, AI-generated assertion, edit actions, signatures) is stored in a <code>uuid</code> box in the init segment; fragments are bound by a BMFF Merkle-tree hash so each segment can be verified independently.</li>' +
          '<li><b>DRM</b> (if needed): CENC cbcs encryption lets one set of CMAF segments serve FairPlay, Widevine and PlayReady.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 4);
          box(ctx, G, 60, 170, 760, 400, 'orange');
          head(ctx, G, 80, 194, 'PER-TITLE CONVEX HULL · VMAF vs bitrate (log)');
          var res = [['360p', 0.18, 74, 'violet'], ['540p', 0.42, 86, 'cyan'], ['720p', 0.75, 93, 'lime'], ['1080p', 1.25, 98, 'orange']];
          var lx = [Math.log(0.2) / Math.LN10, Math.log(10) / Math.LN10];
          function q(R, r) { return r[2] - (r[2] - 20) * Math.exp(-R / r[1] * 0.9); }
          var hullPts = [];
          var ps = res.map(function (r, k) { return ctx.plot(130, 230, 640, 290, function (l) { return q(Math.pow(10, l), r); }, { xDomain: lx, yDomain: [30, 100], color: ctx.alpha(r[3], 0.8), sw: 1.6, samples: 100, axes: k === 0, parent: G }); });
          for (var i = 0; i <= 100; i++) {
            var l = lx[0] + (lx[1] - lx[0]) * i / 100, R = Math.pow(10, l), best = -1;
            res.forEach(function (r) { best = Math.max(best, q(R, r)); });
            hullPts.push([l, best]);
          }
          var hull = ctx.plot(130, 230, 640, 290, hullPts, { xDomain: lx, yDomain: [30, 100], color: 'white', sw: 3, axes: false, parent: G, glow: true });
          [0.25, 0.5, 1, 2, 4, 8].forEach(function (R) { var p = ps[0].toPx(Math.log(R) / Math.LN10, 30); note(ctx, G, p.x, 536, R + '', 'dim', 'middle', 11); });
          note(ctx, G, 770, 554, 'Mb/s', 'dim', 'end', 11);
          res.forEach(function (r, k) { note(ctx, G, 150 + k * 90, 250, r[0], r[3], 'start', 12); });
          var rungs = [[0.6, 0], [1.4, 1], [2.5, 2], [4.5, 3]].map(function (p) {
            var pt = ps[0].toPx(Math.log(p[0]) / Math.LN10, q(p[0], res[p[1]]));
            return ctx.circle(pt.x, pt.y, 7, { fill: res[p[1]][3], stroke: 'white', sw: 1.5, parent: G, glow: true });
          });
          note(ctx, G, 470, 470, 'white = upper hull · dots = chosen rungs', 'text', 'start', 12);
          ps.forEach(function (p, k) { ctx.reveal(p.curve, { from: 'draw', delay: k * 150, dur: 700 }); });
          ctx.reveal(hull.curve, { from: 'draw', delay: 900, dur: 900 });
          ctx.reveal(rungs, { from: 'scale', stagger: 120, delay: 1600 });
          /* CMAF structure */
          box(ctx, G, 860, 170, 700, 400, 'cyan');
          head(ctx, G, 880, 194, 'CMAF · one set of segments, two manifests', 'cyan');
          var init = ctx.group({ parent: G });
          ctx.rect(890, 220, 150, 110, { rx: 6, fill: ctx.alpha('cyan', 0.1), stroke: 'cyan', sw: 1.3, parent: init });
          note(ctx, init, 965, 238, 'init.mp4', 'cyan', 'middle', 12);
          ['ftyp', 'moov', 'uuid: C2PA'].forEach(function (b, k) { ctx.label(965, 266 + k * 24, b, { color: k === 2 ? 'pink' : 'cyan', size: 11, w: 120, parent: init }); });
          var segs = [];
          for (var s = 0; s < 8; s++) {
            var g = ctx.group({ parent: G });
            var x = 1060 + s * 60;
            ctx.rect(x, 220, 54, 110, { rx: 5, fill: ctx.alpha('orange', 0.08), stroke: 'orange', sw: 1.1, parent: g });
            note(ctx, g, x + 27, 238, 's' + (s + 1), 'orange', 'middle', 12);
            ['styp', 'moof', 'mdat'].forEach(function (b, k) { ctx.rect(x + 5, 252 + k * 24, 44, 18, { rx: 3, fill: ctx.alpha(k === 2 ? 'lime' : 'orange', 0.22), parent: g }); note(ctx, g, x + 27, 261 + k * 24, b, 'white', 'middle', 11); });
            segs.push(g);
          }
          note(ctx, G, 890, 350, '4 s = 96 frames = 1 closed GOP · IDR at every boundary · 8 segments (last 2 s)', 'text', 'start', 12);
          note(ctx, G, 890, 372, 'Merkle-tree hash binds each fragment to the C2PA manifest', 'pink', 'start', 12);
          var lad = ctx.para(890, 406, nb(['v1080  HEVC Main10  4.5 Mb/s  1920×1080', 'v720   HEVC Main10  2.5 Mb/s  1280×720', 'v540   HEVC Main10  1.4 Mb/s   960×540', 'v360   HEVC Main10  0.6 Mb/s   640×360', '(+ AV1 set and H.264 fallback set)']), { size: 12.5, font: 'mono', color: 'text', lh: 24, parent: G });
          ctx.reveal(init, { from: 'left', delay: 400 });
          ctx.reveal(segs, { from: 'left', stagger: 70, delay: 600 });
          ctx.reveal(lad, { delay: 1200 });
          /* manifests */
          var hls = ctx.code({ x: 60, y: 590, w: 740, title: 'master.m3u8 (HLS)', lang: 'text', size: 12, color: 'orange', parent: G, lines: nb([
            '#EXTM3U',
            '#EXT-X-VERSION:7',
            '#EXT-X-INDEPENDENT-SEGMENTS',
            '#EXT-X-STREAM-INF:BANDWIDTH=5200000,AVERAGE-BANDWIDTH=4500000,',
            '  RESOLUTION=1920x1080,CODECS="hvc1.2.4.L123.B0,mp4a.40.2"',
            'v1080/index.m3u8',
            '#EXT-X-STREAM-INF:BANDWIDTH=2900000,RESOLUTION=1280x720,…',
            'v720/index.m3u8']) });
          var mpd = ctx.code({ x: 820, y: 590, w: 740, title: 'manifest.mpd (DASH)', lang: 'text', size: 12, color: 'cyan', parent: G, lines: nb([
            '<MPD type="static" mediaPresentationDuration="PT30S">',
            ' <Period><AdaptationSet mimeType="video/mp4"',
            '   segmentAlignment="true" startWithSAP="1">',
            '  <SegmentTemplate timescale="24000" duration="96000"',
            '    initialization="v$RepresentationID$/init.mp4"',
            '    media="v$RepresentationID$/s$Number$.m4s"/>',
            '  <Representation id="1080" bandwidth="4500000"',
            '    codecs="hvc1.2.4.L123.B0" width="1920" height="1080"/>']) });
          ctx.reveal([hls, mpd], { from: 'up', stagger: 200, delay: 1400 });
          ctx.hud('4 rungs · 4 s CMAF · HLS + DASH · C2PA');
          return ctx.wait(3000);
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'CDN & adaptive player',
        say: 'Finally, delivery. Segments are immutable and named by content, so caches never need purging. Requests from viewers hit an edge server near them; a miss goes to a regional tier and then to an origin shield, which collapses concurrent misses so the object store sees roughly one request per segment. URLs are signed with an expiry, and the cache key strips the token so every viewer shares the cached copy. In the player, an adaptive bitrate algorithm watches throughput and buffer: when the network dips, it steps down a rung instead of stalling, then climbs back. The fox lands, in every living room.',
        deep: '<ul><li><b>Hierarchy</b>: origin (object store / packager) → origin shield (one per region, request collapsing) → mid-tier caches → edge POPs (anycast / DNS-steered). Edge hit ratios for VOD segments are typically &gt;90–95 %; the shield turns N concurrent misses into one origin fetch.</li>' +
          '<li><b>Cache key</b>: scheme + host + path (e.g. <code>/j7f3a/v720/s4.m4s</code>); auth query parameters excluded. Immutable, content-addressed names allow <code>Cache-Control: max-age=31536000, immutable</code>; only the manifest has a short TTL (or none, for VOD).</li>' +
          '<li><b>Signed URLs / tokens</b>: <code>sig = HMAC-SHA256(k, path_prefix ‖ exp ‖ ip?)</code>, verified at the edge without calling the origin; prefix-scoped so one token covers all segments.</li></ul>' +
          '<p><b>ABR</b>: throughput-based (harmonic mean of the last k segment downloads × safety 0.8), buffer-based (BBA), or <b>BOLA</b>, which picks rung m maximising (V·(υ<sub>m</sub> + γp) − Q(t)) / S<sub>m</sub> with utility υ<sub>m</sub> = ln(S<sub>m</sub>/S<sub>1</sub>) and buffer level Q(t). dash.js and hls.js ship hybrids; startup usually at a middle rung, then switch up once 2–3 segments are buffered.</p>' +
          '<div class="note">End to end: the 30 s trailer at 4.5 Mb/s is ≈17 MB; with a 95 % edge hit ratio the origin serves ≈5 % of the bytes. The whole post-production chamber added ≈14 s after the last shot rendered.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 5);
          box(ctx, G, 60, 170, 1500, 350, 'blue');
          head(ctx, G, 80, 194, 'CDN HIERARCHY · immutable segments · signed URLs', 'blue');
          var org = ctx.node({ x: 170, y: 340, w: 170, h: 56, title: 'Origin', sub: 'object store', icon: 'db', color: 'orange', titleSize: 15, subSize: 11, parent: G });
          var sh = ctx.node({ x: 420, y: 340, w: 170, h: 56, title: 'Shield', sub: 'collapse misses', icon: 'shield', color: 'blue', titleSize: 15, subSize: 11, parent: G });
          var mids = [0, 1].map(function (k) { return ctx.node({ x: 680, y: 270 + k * 140, w: 160, h: 48, title: 'Mid-tier ' + (k ? 'EU' : 'US'), color: 'blue', kind: 'box', titleSize: 13, parent: G }); });
          var edges = [0, 1, 2, 3].map(function (k) { return ctx.node({ x: 930, y: 232 + k * 72, w: 140, h: 42, title: 'Edge POP ' + (k + 1), color: 'cyan', kind: 'pill', titleSize: 12, glow: false, parent: G }); });
          var users = [];
          for (var u = 0; u < 8; u++) users.push(ctx.icon(u % 3 === 0 ? 'globe' : 'phone', 1110 + (u % 2) * 44, 222 + Math.floor(u / 2) * 72 + (u % 2) * 18, 22, 'cyan', { parent: G }));
          var L = [ctx.link(org, sh, { color: 'orange', straight: true, parent: G })];
          mids.forEach(function (m) { L.push(ctx.link(sh, m, { color: 'blue', parent: G })); });
          edges.forEach(function (e, k) { L.push(ctx.link(mids[k < 2 ? 0 : 1], e, { color: 'cyan', parent: G })); });
          var ue = edges.map(function (e, k) { return ctx.link(e, { x: 1098, y: 232 + k * 72 }, { color: 'cyan', straight: true, arrow: false, parent: G }); });
          ctx.reveal([org, sh].concat(mids, edges), { from: 'scale', stagger: 70 });
          ctx.reveal(L.concat(ue), { from: 'draw', stagger: 40, delay: 500 });
          ctx.reveal(users, { stagger: 40, delay: 800 });
          var info = ctx.para(1210, 230, ['cache key:', '/j7f3a/v720/s4.m4s', '(token stripped)', '', 'signed URL:', '?exp=1790000000', '&sig=HMAC(k, path‖exp)', '', 'edge hit ≈ 95 %', 'origin ≈ 1 req / segment'], { size: 12.5, font: 'mono', color: 'text', lh: 26, parent: G });
          ctx.reveal(info, { delay: 1000 });
          /* ABR */
          box(ctx, G, 60, 540, 1000, 310, 'cyan');
          head(ctx, G, 80, 564, 'ADAPTIVE BITRATE (Mb/s) · cyan: throughput · orange: rung = 0.8 × estimate', 'cyan');
          function bw(t) { return t < 8 ? 9 : (t < 12 ? 9 - 7 * (t - 8) / 4 : (t < 18 ? 2.0 + 0.4 * Math.sin(t * 2) : Math.min(9, 2 + (t - 18) * 1.2))); }
          var bwp = ctx.plot(120, 590, 900, 210, bw, { xDomain: [0, 30], yDomain: [0, 10], color: 'cyan', sw: 2, samples: 150, parent: G });
          var rung = function (t) {
            var seg = Math.floor(t / 4), ts = seg * 4;
            if (ts < 4) return 2.5;
            var est = 0.8 * bw(ts - 1);
            var opts = [0.6, 1.4, 2.5, 4.5];
            var pick = 0.6;
            opts.forEach(function (o) { if (o <= est) pick = o; });
            return pick;
          };
          var steps = [];
          for (var t = 0; t <= 30; t += 0.25) steps.push([t, rung(t)]);
          var rp = ctx.plot(120, 590, 900, 210, steps, { xDomain: [0, 30], yDomain: [0, 10], color: 'orange', sw: 3, axes: false, parent: G, glow: true });
          [0, 5, 10, 15, 20, 25, 30].forEach(function (tt) { var p = bwp.toPx(tt, 0); note(ctx, G, p.x, 814, tt + 's', 'dim', 'middle', 11); });
          [0, 5, 10].forEach(function (v) { var p = bwp.toPx(0, v); note(ctx, G, 112, p.y, String(v), 'dim', 'end', 11); });
          note(ctx, G, 120, 836, 'dip at 8–18 s → steps down to 2.5, then 0.6 Mb/s, no stall; climbs back as throughput and buffer recover', 'text', 'start', 12);
          ctx.reveal(bwp.curve, { from: 'draw', dur: 1400, delay: 1200 });
          ctx.reveal(rp.curve, { from: 'draw', dur: 1800, delay: 1600 });
          /* buffer */
          box(ctx, G, 1100, 540, 460, 310, 'cyan');
          head(ctx, G, 1120, 564, 'PLAYER BUFFER (s)', 'cyan');
          var buf = ctx.plot(1140, 590, 390, 170, function (tt) { return tt < 3 ? tt * 3 : (tt < 9 ? 9 + (tt - 3) * 0.5 : (tt < 13 ? 12 - (tt - 9) * 1.2 : (tt < 20 ? 7.2 + (tt - 13) * 0.3 : Math.min(18, 9.3 + (tt - 20) * 0.9)))); }, { xDomain: [0, 30], yDomain: [0, 20], color: 'lime', sw: 2, samples: 120, parent: G });
          var bt = buf.toPx(0, 2);
          ctx.line(1140, bt.y, 1530, bt.y, { color: 'red', dash: '4 4', parent: G });
          note(ctx, G, 1528, bt.y - 10, 'stall risk < 2 s', 'red', 'end', 11);
          ctx.para(1120, 790, ['BOLA / hybrid (dash.js, hls.js)', 'startup at 720p, up after 2 segs'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: G });
          ctx.reveal(buf.curve, { from: 'draw', dur: 1600, delay: 1600 });
          ctx.hud('edge hit ≈ 95 % · no stall through the dip');
          return ctx.wait(1500).then(function () {
            return Promise.all(ue.map(function (l, k) { return ctx.wait(k * 150).then(function () { return ctx.packet(l, { color: 'cyan', dur: 450, reverse: true, label: k === 0 ? 'GET s4' : undefined }); }); }));
          }).then(function () {
            return ctx.packet(L[L.length - 1], { color: 'blue', dur: 450, reverse: true, label: 'miss' });
          }).then(function () {
            return ctx.packet(L[2], { color: 'blue', dur: 450, reverse: true });
          }).then(function () {
            return ctx.packet(L[0], { color: 'blue', dur: 450, reverse: true });
          }).then(function () {
            return ctx.packet(L[0], { color: 'orange', dur: 450, label: 's4.m4s' });
          }).then(function () {
            return ctx.packet(L[2], { color: 'orange', dur: 450 });
          }).then(function () {
            return ctx.packet(L[L.length - 1], { color: 'orange', dur: 450, label: 'cached' });
          }).then(function () { return ctx.wait(800); });
        }
      }
    ]
  });
})();
