/* L1 — Audio, Editing & Delivery. Six rendered clips become one streamed film: voice, score, foley,
 * lip-sync, an editor agent's EDL, deterministic assembly, enhancement, encoding and the CDN. The
 * multi-track timeline in the lower half is the shared data structure every step writes into.
 * Beat format: each step = beats (narration, callout card, deep-dive chunk, gated animation segment). */
(function () {
  /* ---------- geometry ---------- */
  var TX = 160, PX = 29;                       /* timeline: 30 s -> x 160..1030 */
  var RY = 458;                                /* ruler baseline */
  var TR = { V1: { y: 470, h: 48 }, CAP: { y: 524, h: 22 }, A1: { y: 552, h: 40 }, A2: { y: 598, h: 40 }, A3: { y: 644, h: 34 } };
  var IX = 1075, IW = 470, IY = 430, IH = 440; /* inspector (right) */
  var BX = 60, BY = 706, BW = 985, BH = 162;   /* bottom strip */
  var PIPE_X = [150, 400, 650, 900, 1150, 1400], PIPE_Y = 360;
  function tx(t) { return TX + t * PX; }

  var SHOTS = [
    { n: 'approach', bg: '#0a1f44', acc: '#22e4ff' },
    { n: 'cockpit', bg: '#3a1020', acc: '#ff4d6d' },
    { n: 're-entry', bg: '#40180a', acc: '#ff8a3d' },
    { n: 'impact', bg: '#16364a', acc: '#e8f1ff' },
    { n: 'emerge', bg: '#0c3440', acc: '#ff8a3d' },
    { n: 'ice glow', bg: '#08403a', acc: '#2bf5c4' }
  ];
  var GRADE = '#123041';                      /* hero look the shots are matched toward */
  /* cut points in frames @ 24 fps; every cut is on the 96 BPM beat grid (1 beat = 15 frames) */
  var CUTS = [0, 105, 225, 315, 420, 540, 660, 720];
  var VOICE = [
    { t0: 0.4, t1: 4.2, id: 'N1 · creator', cap: '"Twelve hours…"' },
    { t0: 5.6, t1: 8.2, id: 'D1 · fox', cap: '"Mayday…"', dlg: true },
    { t0: 17.8, t1: 21.8, id: 'N2 · creator', cap: '"No signal. No…"' },
    { t0: 23.0, t1: 27.0, id: 'N3 · creator', cap: '"Some worlds…"' }
  ];
  var SFX = [[4.4, 9.3, 'alarm'], [9.4, 13.1, 'whoosh'], [15.0, 16.6, 'impact'], [17.5, 22.0, 'crackle'], [22.5, 30, 'hum']];

  /* ---------- helpers ---------- */
  function waveD(ctx, x0, w, cy, amp, seed, env) {
    var r = ctx.rng(seed), d = '';
    for (var x = 0; x <= w; x += 3) {
      var a = Math.max(0.6, amp * env(x / w) * (0.35 + 0.65 * r()));
      d += 'M' + (x0 + x).toFixed(1) + ',' + (cy - a).toFixed(1) + 'V' + (cy + a).toFixed(1);
    }
    return d;
  }
  /* SVG collapses whitespace: keep code indentation/alignment with no-break spaces */
  function nb(lines) { return lines.map(function (s) { return s.replace(/^ +| {2,}/g, function (m) { return new Array(m.length + 1).join(' '); }); }); }
  function speechEnv(u) { return 0.25 + 0.75 * Math.abs(Math.sin(u * 17.3)) * (u > 0.04 && u < 0.96 ? 1 : 0.3); }
  /* recolour a ctx.label chip (rect = child 0, text = child 1) */
  function tint(ctx, c, col) {
    c.childNodes[0].setAttribute('stroke', ctx.C[col]);
    c.childNodes[0].setAttribute('fill', ctx.alpha(col, 0.14));
    c.childNodes[1].setAttribute('fill', ctx.C[col]);
  }
  function tintAll(ctx, chips, col, gap) {
    return chips.reduce(function (p, c) { return p.then(function () { tint(ctx, c, col); return ctx.wait(gap || 120); }); }, Promise.resolve());
  }
  /* type the first `slow` lines of a code panel, then append the rest quickly */
  function typeLines(ctx, code, lines, slow) {
    return lines.reduce(function (p, s, k) {
      return p.then(function () { return code.addLine(s, k >= slow).then(function () { return ctx.wait(k >= slow ? 70 : 0); }); });
    }, Promise.resolve());
  }

  function thumb(ctx, g, x, y, w, h, k) {
    var s = SHOTS[k];
    var bg = ctx.rect(x, y, w, h, { rx: 5, fill: s.bg, stroke: ctx.alpha(s.acc, 0.7), sw: 1.2, parent: g });
    var r = ctx.rng(20 + k);
    for (var i = 0; i < 4; i++) ctx.circle(x + 8 + r() * (w - 16), y + 6 + r() * h * 0.4, 1.1, { fill: 'white', opacity: 0.6, parent: g });
    if (k === 0) {
      ctx.circle(x + w * 0.78, y + h * 0.78, h * 0.42, { fill: ctx.alpha('#9fe9ff', 0.35), stroke: 'cyan', sw: 1, parent: g, glow: true });
      ctx.circle(x + w * 0.3, y + h * 0.36, 3, { fill: 'orange', parent: g, glow: true });
    } else if (k === 1) {
      ctx.rect(x, y, w, 7, { rx: 0, fill: ctx.alpha('red', 0.55), parent: g });
      ctx.poly([[x + w * 0.4, y + h * 0.36], [x + w * 0.45, y + h * 0.16], [x + w * 0.5, y + h * 0.33], [x + w * 0.56, y + h * 0.16], [x + w * 0.61, y + h * 0.36], [x + w * 0.5, y + h * 0.7]], { fill: 'orange', parent: g });
      ctx.circle(x + w * 0.5, y + h * 0.42, h * 0.3, { stroke: ctx.alpha('cyan', 0.7), sw: 1, parent: g });
    } else if (k === 2) {
      ctx.path('M' + (x + w * 0.15) + ',' + (y + h * 0.15) + ' L' + (x + w * 0.7) + ',' + (y + h * 0.6), { stroke: 'orange', sw: 6, parent: g, glow: 'strong' });
      ctx.circle(x + w * 0.72, y + h * 0.62, 4, { fill: '#fff4d6', parent: g, glow: true });
    } else if (k === 3) {
      ctx.rect(x, y + h * 0.66, w, h * 0.34, { rx: 0, fill: ctx.alpha('cyan', 0.25), parent: g });
      ctx.circle(x + w * 0.52, y + h * 0.64, h * 0.22, { fill: ctx.alpha('white', 0.8), parent: g, glow: 'strong' });
    } else if (k === 4) {
      ctx.rect(x, y + h * 0.62, w, h * 0.38, { rx: 0, fill: ctx.alpha('cyan', 0.3), parent: g });
      ctx.circle(x + w * 0.42, y + h * 0.52, 5, { fill: 'orange', parent: g });
      ctx.circle(x + w * 0.42, y + h * 0.52, 8, { stroke: 'cyan', sw: 1, parent: g });
    } else {
      ctx.el('ellipse', { cx: x + w * 0.5, cy: y + h * 0.78, rx: w * 0.45, ry: h * 0.2, fill: ctx.alpha('teal', 0.45) }, g).setAttribute('filter', 'url(#fx-glow)');
      ctx.circle(x + w * 0.3, y + h * 0.58, 3.5, { fill: 'orange', parent: g });
    }
    return bg;
  }

  function clip(ctx, parent, t0, t1, tr, col, label, o) {
    o = o || {};
    var T = TR[tr], x0 = tx(t0), w = (t1 - t0) * PX;
    var g = ctx.group({ parent: parent });
    g.bg = ctx.rect(x0 + 0.5, T.y + 2, w - 1, T.h - 4, { rx: 4, fill: o.fill || ctx.alpha(col, 0.18), stroke: col, sw: 1.2, dash: o.dash, parent: g });
    if (o.wave) ctx.path(waveD(ctx, x0 + 4, w - 8, T.y + T.h * 0.66, T.h * 0.22, o.seed || 3, o.env || speechEnv), { stroke: ctx.alpha(col, 0.85), sw: 1.1, parent: g });
    if (label) ctx.text(x0 + 5, T.y + (o.wave ? 12 : (o.top ? 13 : T.h / 2)), label, { size: 11, font: 'mono', color: o.textColor || col, parent: g });
    g.box = { x: x0, y: T.y, w: w, h: T.h, cx: x0 + w / 2, cy: T.y + T.h / 2, l: x0, r: x0 + w, t: T.y, b: T.y + T.h };
    return g;
  }

  function panel(ctx, title, col) {
    var S = ctx.state;
    if (S.insp) ctx.remove(S.insp, 300);
    var g = S.insp = ctx.group();
    ctx.rect(IX, IY, IW, IH, { rx: 10, fill: 'rgba(7,12,24,0.92)', stroke: ctx.alpha(col, 0.55), sw: 1.2, parent: g });
    ctx.rect(IX, IY, IW, 30, { rx: 10, fill: ctx.alpha(col, 0.13), parent: g });
    ctx.text(IX + 14, IY + 15, title, { size: 13, font: 'mono', weight: 600, color: col, parent: g });
    ctx.reveal(g, { from: 'right', dur: 500 });
    return g;
  }
  function strip(ctx, title, col) {
    var S = ctx.state;
    if (S.bot) ctx.remove(S.bot, 300);
    var g = S.bot = ctx.group();
    ctx.rect(BX, BY, BW, BH, { rx: 10, fill: 'rgba(7,12,24,0.88)', stroke: ctx.alpha(col, 0.45), sw: 1.1, parent: g });
    ctx.text(BX + 14, BY + 17, title, { size: 12, font: 'mono', weight: 600, color: col, parent: g });
    ctx.reveal(g, { from: 'up', dur: 500, delay: 150 });
    return g;
  }
  /* move the stage highlight over pipeline node i (or span i..j) */
  function stage(ctx, i, j) {
    var S = ctx.state;
    j = j === undefined ? i : j;
    var x = PIPE_X[i] - 108, w = PIPE_X[j] - PIPE_X[i] + 216;
    if (!S.hl) {
      S.hl = ctx.rect(x, PIPE_Y - 40, w, 80, { rx: 14, stroke: 'white', sw: 2, dash: '7 5', glow: true, parent: S.pipe });
      ctx.reveal(S.hl, { dur: 300 });
      return ctx.wait(300);
    }
    var x0 = parseFloat(S.hl.getAttribute('x')), w0 = parseFloat(S.hl.getAttribute('width'));
    return ctx.animate(S.hl, { x: [x0, x], width: [w0, w] }, 600, 'inOut');
  }

  /* fox head for the lip-sync close-up; returns {g, mouth} */
  function foxHead(ctx, parent, cx, cy, s) {
    var g = ctx.group({ parent: parent });
    ctx.circle(cx, cy, 96 * s, { fill: 'rgba(34,228,255,0.05)', stroke: 'cyan', sw: 2, parent: g, glow: true });
    ctx.poly([[cx - 58 * s, cy - 30 * s], [cx - 44 * s, cy - 88 * s], [cx - 14 * s, cy - 44 * s]], { fill: '#e8742f', stroke: '#ffb070', sw: 1, parent: g });
    ctx.poly([[cx + 58 * s, cy - 30 * s], [cx + 44 * s, cy - 88 * s], [cx + 14 * s, cy - 44 * s]], { fill: '#e8742f', stroke: '#ffb070', sw: 1, parent: g });
    ctx.poly([[cx - 64 * s, cy - 26 * s], [cx, cy - 52 * s], [cx + 64 * s, cy - 26 * s], [cx + 40 * s, cy + 40 * s], [cx, cy + 70 * s], [cx - 40 * s, cy + 40 * s]], { fill: '#ff8a3d', stroke: '#ffb070', sw: 1.2, parent: g });
    ctx.poly([[cx - 30 * s, cy + 14 * s], [cx + 30 * s, cy + 14 * s], [cx + 16 * s, cy + 58 * s], [cx, cy + 68 * s], [cx - 16 * s, cy + 58 * s]], { fill: '#ffe2c8', parent: g });
    ctx.circle(cx - 26 * s, cy - 8 * s, 6 * s, { fill: '#10131c', parent: g });
    ctx.circle(cx + 26 * s, cy - 8 * s, 6 * s, { fill: '#10131c', parent: g });
    ctx.circle(cx - 24 * s, cy - 10 * s, 2 * s, { fill: 'white', parent: g });
    ctx.circle(cx + 28 * s, cy - 10 * s, 2 * s, { fill: 'white', parent: g });
    ctx.circle(cx, cy + 20 * s, 6 * s, { fill: '#1a1210', parent: g });
    var mouth = ctx.el('ellipse', { cx: cx, cy: cy + 42 * s, rx: 13 * s, ry: 3 * s, fill: '#3a0c12', stroke: '#1a0508', 'stroke-width': 1 }, g);
    return { g: g, mouth: mouth };
  }

  /* the EDL as the editor agent first emits it: cut 3 at frame 322 (S3 out = 117), seven frames too long */
  var EDL = nb([
    '{"edl": "1.2", "fps": "24/1", "dur_f": 720,',
    ' "video": [',
    '  {"uri": "s3://j7f3a/S1.mov", "in": 12, "out": 117},',
    '  {"uri": "s3://j7f3a/S2.mov", "in": 0, "out": 120},',
    '  {"uri": "s3://j7f3a/S3.mov", "in": 20, "out": 117,',
    '   "xfade": {"type": "dissolve", "f": 12}},',
    '  {"uri": "s3://j7f3a/S4.mov", "in": 8, "out": 113},',
    '  {"uri": "s3://j7f3a/S5.mov", "in": 0, "out": 120},',
    '  {"uri": "s3://j7f3a/S6.mov", "in": 1, "out": 121,',
    '   "fade_out_f": 12},',
    '  {"gen": "title", "text": "ICEFALL", "f": 60}],',
    ' "audio": [',
    '  {"trk": "A1", "uri": "tts/N1.wav", "at_f": 10},',
    '  {"trk": "A2", "uri": "score.wav", "duck_db": -10},',
    '  {"trk": "A3", "uri": "sfx/impact.wav", "at_f": 360}],',
    ' "captions": "cap.vtt", "lut": "show_v2.cube",',
    ' "loudness_lufs": -14}']);

  Atlas.register({
    id: 'postprod',
    refs: [
      'Le et al., <i>Voicebox: Text-Guided Multilingual Universal Speech Generation at Scale</i>, NeurIPS 2023; Chen et al., <i>F5-TTS: A Fairytaler that Fakes Fluent and Faithful Speech with Flow Matching</i>, 2024',
      'Copet et al., <i>Simple and Controllable Music Generation (MusicGen)</i>, NeurIPS 2023; Evans et al., <i>Fast Timing-Conditioned Latent Audio Diffusion</i>, ICML 2024',
      'Cheng et al., <i>MMAudio: Taming Multimodal Joint Training for High-Quality Video-to-Audio Synthesis</i>, CVPR 2025',
      'Li et al., <i>LatentSync</i>, 2024; Prajwal et al., <i>A Lip Sync Expert Is All You Need (Wav2Lip)</i>, ACM MM 2020; Chung &amp; Zisserman, <i>Out of Time (SyncNet)</i>, ACCV-W 2016',
      'FFmpeg Project, <i>FFmpeg Filters Documentation</i> (filtergraph, xfade, lut3d, loudnorm), ffmpeg 7.x, 2024–2025',
      'ITU-R BS.1770-4, <i>Algorithms to measure audio programme loudness and true-peak audio level</i>, 2015; EBU R 128, 2020',
      'Huang et al., <i>RIFE: Real-Time Intermediate Flow Estimation for Video Frame Interpolation</i>, ECCV 2022; Reda et al., <i>FILM</i>, ECCV 2022',
      'ISO/IEC 23000-19 <i>CMAF</i>; RFC 8216 <i>HTTP Live Streaming</i>; ISO/IEC 23009-1 <i>MPEG-DASH</i>'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Clips to a film',
        beats: [
          {
            say: 'The shots are rendered. Six clips of five seconds each sit in object storage as high quality mezzanine files, one for every shot of the trailer.',
            card: { tag: 'NUMBERS', title: 'Six clips, no generation loss', stat: { v: '6 × 121', u: 'frames', l: '1280×720 at 24 fps, 10-bit ProRes 422 HQ, roughly 80 Mb/s per clip' }, more: '<p>Storage arithmetic: 80 Mb/s × 5 s / 8 = 50 MB per clip, so about 300 MB for the six shots. ProRes is intra-frame only (every frame decodes on its own), which makes it fast to edit and seek but roughly 18 times larger than the final 1080p delivery encode.</p>' },
            deep: '<p>Each shot leaves the video model as <b>121 frames</b>: five seconds at 24 fps plus one, because a causal video VAE encodes 1 + 4n frames (n = 30). The frames are decoded once and stored as a <b>mezzanine</b> file, ProRes 422 HQ (about 80 Mb/s at 720p24, roughly 50 MB per clip) or lossless FFV1, so no generation loss accumulates before the single final encode.</p>' +
              '<p>Shots are addressed by URI, for example <code>s3://jobs/7f3a/shots/S3.mov</code>. The LLM never sees pixels.</p>'
          },
          {
            say: 'But six clips are not a film. Post-production turns them into one, through a pipeline of six stages that runs from audio generation to the content delivery network.',
            card: { tag: 'KEY IDEA', title: 'A hand-off to deterministic media', body: 'Agents decide <b>what</b> the cut is. Compositors and encoders produce the bytes. Everything after the editor is a pure function of its inputs.' },
            deep: '<p>Post-production is where the <b>LLM control plane hands off to deterministic media engineering</b>. Agents decide <i>what</i> the cut is; compositors and encoders produce bit-exact output from that decision, so a re-run is reproducible and cacheable.</p>' +
              '<table><tr><th>Stage</th><th>Engine</th><th>Artifact</th></tr>' +
              '<tr><td>Audio gen</td><td>TTS, music, V2A, lip-sync models</td><td>WAV stems, patched shot</td></tr>' +
              '<tr><td>Editor agent</td><td>LLM + tools</td><td>EDL JSON</td></tr>' +
              '<tr><td>Compositor</td><td>ffmpeg / CUDA</td><td>master.mov</td></tr>' +
              '<tr><td>Enhance</td><td>RIFE, SR, color</td><td>graded 1080p/4K master</td></tr>' +
              '<tr><td>Encode + CDN</td><td>NVENC, packager</td><td>CMAF ladder, manifests</td></tr></table>'
          },
          {
            say: 'Audio generation creates the narration, the music and the sound effects from the script and the voice memo. An editor agent watches the clips and writes an edit decision list.',
            card: { tag: 'HOW IT WORKS', title: 'Two producers, one contract', body: 'Audio models return stems by URI. The editor agent returns a JSON edit decision list. Both hand over <b>data</b>, never pixels.' },
            deep: '<p><b>Audio generation</b> runs on the audio GPU pool while the shots are still rendering, so it sits off the critical path. It returns 48 kHz WAV stems (narration, score, foley) and one lip-synced patch of shot 2.</p>' +
              '<p>The <b>editor agent</b> starts when the last shot lands. It sees low-resolution proxies, script timings and the beat grid, and returns an EDL. Only URIs and frame ranges pass through the LLM context; pixels never do.</p>'
          },
          {
            say: 'From the compositor on, the machinery is deterministic. It composites the timeline, enhances the frames, encodes an adaptive bitrate ladder, and packages the result for a content delivery network.',
            card: { tag: 'WHY IT MATTERS', title: 'Same inputs, same bytes', body: 'No model makes a decision after the editor. A render key hashes the edit and its inputs, so a re-run is exact and cacheable.' },
            deep: '<p>Every stage after the editor is a pure function of its inputs:</p>' +
              '<div class="eq">render_key = sha256( EDL ‖ input hashes ‖ ffmpeg build ‖ flags )</div>' +
              '<p>A cache hit skips the render; a miss recomputes only the touched segments. Change one shot and only that shot and the final encode re-run. The enhancement models (RIFE, super-resolution) are neural but frozen, so on pinned weights, software and hardware they count as deterministic stages too.</p>'
          },
          {
            say: 'The shared data structure through all of it is the timeline below: one video track, one caption track and three audio tracks, measured in whole frames.',
            card: { tag: 'NUMBERS', title: 'The whole film as integers', stat: { v: '720', u: 'frames', l: '30 s at 24 fps on five tracks, in rational time: frame counts, never floating seconds' } },
            deep: '<div class="note">Timeline model (OpenTimelineIO-style): <code>Timeline → Stack → Track[V1, CAP, A1–A3] → Clip{media_ref, source_range}</code>, with <b>rational time</b> in frames at 24/1. Only URIs and ranges pass through LLM context; pixels never do.</div>' +
              '<p>Rational time matters because 1/24 s has no exact binary floating-point form, so accumulated seconds drift and produce off-by-one frames at cuts. A clip is just <code>{uri, source_range}</code>, for example <code>S3.mov [20, 110)</code>; transitions and effects are further objects on the track.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* beat 0: six mezzanine clips in object storage */
          S.top = ctx.group();
          S.cards = [];
          for (var i = 0; i < 6; i++) {
            var cg = ctx.group({ parent: S.top });
            var x = 330 + i * 142;
            thumb(ctx, cg, x, 180, 130, 76, i);
            ctx.rect(x + 1, 240, 128, 15, { rx: 0, fill: 'rgba(3,6,12,0.75)', parent: cg });
            ctx.text(x + 6, 248, 'S' + (i + 1) + ' · ' + SHOTS[i].n, { size: 11, font: 'mono', color: 'white', parent: cg });
            ctx.line(x + 65, 258, x + 65, 290, { color: ctx.alpha('lime', 0.7), sw: 1.2, parent: cg });
            S.cards.push(cg);
          }
          S.bus = ctx.line(395, 290, 1105, 290, { color: ctx.alpha('lime', 0.7), sw: 1.2, parent: S.top });
          S.stats = ctx.para(1195, 190, ['6 shots × 121 frames', '1280×720 · 24 fps · 10-bit', 'mezzanine ProRes 422 HQ', 's3://jobs/7f3a/shots/'], { size: 12, font: 'mono', color: 'dim', lh: 19, parent: S.top });
          ctx.hud('6 clips · 5 s each · in object storage');
          return Promise.all([ctx.reveal(S.cards, { from: 'down', stagger: 90 }), ctx.reveal(S.stats, { delay: 700 }), ctx.reveal(S.bus, { from: 'draw', delay: 800 })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: the six-stage pipeline and its contract */
            S.pipe = ctx.group();
            var defs = [['Audio Gen', 'voice · music · sfx', 'music'], ['Editor Agent', 'LLM → EDL JSON', 'agent'], ['Compositor', 'ffmpeg filtergraph', 'layers'],
              ['Enhance', 'color · RIFE · SR', 'spark'], ['Encode', 'NVENC · ABR ladder', 'chip'], ['Package + CDN', 'CMAF · HLS / DASH', 'globe']];
            /* faint fill so the whole ghost area (not just its dashed stroke) is clickable */
            S.ghost = ctx.node({ x: 1025, y: PIPE_Y + 4, w: 990, h: 112, kind: 'ghost', color: 'orange', fill: 'rgba(255,138,61,0.025)', parent: S.pipe });
            ctx.text(1025, PIPE_Y + 49, 'deterministic media path · render-delivery', { size: 11, font: 'mono', color: ctx.alpha('orange', 0.8), anchor: 'middle', parent: S.ghost });
            S.pn = defs.map(function (d, k) {
              return ctx.node({ x: PIPE_X[k], y: PIPE_Y, w: 200, h: 64, title: d[0], sub: d[1], icon: d[2], color: k === 1 ? 'magenta' : 'orange', titleSize: 15, subSize: 11, parent: S.pipe });
            });
            S.pl = [];
            for (var k = 0; k < 5; k++) S.pl.push(ctx.link(S.pn[k], S.pn[k + 1], { color: k === 0 ? 'magenta' : 'orange', straight: true, parent: S.pipe }));
            ctx.hotspot(S.pn[0], 'tts-audio');
            ctx.hotspot(S.ghost, 'render-delivery', { hint: 'RENDER & DELIVERY ⤢' });
            /* the four deterministic stages sit on top of the ghost: let clicks fall through to it */
            S.pn.slice(2).forEach(function (n) { n.style.pointerEvents = 'none'; });
            /* the stage contract */
            S.insp = ctx.group();
            var con = ctx.code({ x: IX, y: IY, w: IW, title: 'postprod contract · job 7f3a', lang: 'py', size: 12, color: 'orange', parent: S.insp, lines: nb([
              '# inputs: by URI, never inline in LLM context',
              'shots    = ["S1.mov", ..., "S6.mov"]  # 6 x 121 f',
              'script   = "script.md"     # 3 lines + 1 dialog',
              'memo     = "memo.m4a"      # 42 s, consent ok',
              'look     = "look.json"     # from 3 sketches',
              '# outputs',
              'master   = "master.mov"    # 1080p24 ProRes',
              'ladder   = "cmaf/"         # 4 rungs, HLS+DASH',
              'captions = "cap.vtt"       # WebVTT',
              'c2pa     = "manifest.c2pa" # signed',
              'budget_s = 20              # after last shot']) });
            ctx.hud('6 stages · audio → edit → encode → CDN');
            return Promise.all([ctx.reveal(S.ghost, { delay: 500 }), ctx.reveal(S.pn, { from: 'up', stagger: 110 }), ctx.reveal(S.pl, { from: 'draw', stagger: 110, delay: 500 }), ctx.reveal(con, { from: 'right', delay: 700 })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: audio generation and the editor agent take their inputs */
            var inA = ctx.label(150, 198, 'script.md · writer', { color: 'amber', size: 11, parent: S.top });
            var inB = ctx.label(150, 234, 'memo.m4a · 42 s', { color: 'orange', size: 11, parent: S.top });
            S.inLine = ctx.line(150, 250, 150, 322, { color: 'orange', arrow: true, parent: S.top });
            S.busDown = ctx.line(400, 290, 400, 322, { color: 'lime', arrow: true, parent: S.top });
            return Promise.all([ctx.reveal([inA, inB], { from: 'left', stagger: 120 }), ctx.reveal([S.inLine, S.busDown], { from: 'draw', delay: 400, stagger: 150 }), stage(ctx, 0, 1)]).then(function () {
              return Promise.all([ctx.packet(S.inLine, { color: 'orange', dur: 700 }), ctx.packet(S.busDown, { color: 'lime', dur: 700 })]);
            }).then(function () {
              return ctx.packet(S.pl[0], { color: 'magenta', dur: 500 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: the deterministic path lights up */
            return stage(ctx, 2, 5).then(function () {
              ctx.pulse(S.ghost, { color: 'orange', times: 2, dur: 600 });
              return Promise.all(S.pl.slice(1).map(function (l, k) { return ctx.wait(k * 250).then(function () { return ctx.packet(l, { color: 'orange', dur: 450 }); }); }));
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            if (ctx.dead) return;
            /* beat 4: the shared timeline and its data model */
            S.tl = ctx.group();
            ctx.rect(50, 432, 995, 258, { rx: 10, fill: 'rgba(6,11,22,0.85)', stroke: ctx.alpha('orange', 0.35), sw: 1, parent: S.tl });
            ctx.line(TX, RY, tx(30), RY, { color: 'faint', parent: S.tl });
            for (var s = 0; s <= 30; s++) {
              ctx.line(tx(s), RY - (s % 5 ? 3 : 7), tx(s), RY, { color: s % 5 ? 'faint' : 'dim', sw: 1, parent: S.tl });
              if (s % 5 === 0) ctx.text(tx(s), RY - 14, s + 's', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.tl });
            }
            ctx.text(64, RY - 12, 'TIMELINE', { size: 11, font: 'mono', color: 'orange', weight: 600, parent: S.tl });
            [['V1', 'video', 'lime'], ['CAP', 'captions', 'cyan'], ['A1', 'voice', 'orange'], ['A2', 'music', 'orange'], ['A3', 'sfx', 'orange']].forEach(function (t) {
              var T = TR[t[0]];
              ctx.rect(TX, T.y + 1, 870, T.h - 2, { rx: 4, fill: 'rgba(255,255,255,0.025)', parent: S.tl });
              ctx.text(64, T.y + T.h / 2 - (T.h > 30 ? 6 : 0), t[0], { size: 12, font: 'mono', weight: 600, color: t[2], parent: S.tl });
              if (T.h > 30) ctx.text(64, T.y + T.h / 2 + 9, t[1], { size: 11, font: 'mono', color: 'dim', parent: S.tl });
            });
            S.grid = ctx.group({ parent: S.tl });
            S.clips = ctx.group({ parent: S.tl });
            var B = strip(ctx, 'TIMELINE DATA MODEL · rational time (frames @ 24/1)', 'orange');
            var chain = [['Timeline', 'dur 720 f'], ['Stack', '5 tracks'], ['Track', 'V1 · A1 …'], ['Clip', 'media_ref + range'], ['Transition', 'dissolve 12 f']];
            var cn = chain.map(function (c, k) { return ctx.node({ x: 160 + k * 196, y: BY + 72, w: 170, h: 52, title: c[0], sub: c[1], color: k === 3 ? 'lime' : 'orange', kind: 'chip', titleSize: 14, subSize: 11, glow: false, parent: B }); });
            for (var q = 0; q < 4; q++) ctx.link(cn[q], cn[q + 1], { color: 'dim', straight: true, parent: B });
            ctx.text(BX + 14, BY + 138, 'Clip = { uri: "s3://…/S3.mov", source_range: [20, 110) }  — the LLM edits ranges, never pixels', { size: 12, font: 'mono', color: 'dim', parent: B });
            ctx.hud('6 shots · 30 s · 720 frames @ 24 fps');
            return ctx.reveal(S.tl, { from: 'up' }).then(function () { return ctx.pulse(S.pn[1], { color: 'magenta', times: 1, dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Narration voice',
        beats: [
          {
            say: 'First, the voice. From the forty two second memo, a voice activity detector and a quality scorer pick the cleanest six seconds, here from twelve to eighteen seconds, as the speaker prompt.',
            card: { tag: 'NUMBERS', title: 'Six seconds is enough', stat: { v: '6 s', u: 'speaker prompt', l: 'cleanest slice of the 42 s memo: single speaker, SNR 31 dB, picked by VAD and DNSMOS' } },
            deep: '<p><b>Prompt selection</b>: voice activity detection plus an SNR and DNSMOS quality scorer pick the cleanest 3–10 s of the memo, here 12–18 s. Its transcript comes from ASR, because in-context models need the words of the prompt as well as its sound.</p>' +
              '<p>Longer prompts raise speaker similarity but also copy the phone\'s room tone and codec artifacts, so a clean short slice usually beats a long noisy one.</p>'
          },
          {
            say: 'The writer agent\'s script, plus a style instruction, goes into a zero shot text to speech model. A codec language model or a flow matching model continues the prompt, so the new speech keeps the creator\'s timbre while the prosody is steered to sound hushed and cinematic.',
            card: { tag: 'HOW IT WORKS', title: 'Continue the prompt, change the words', body: 'The model treats the memo slice as the start of an utterance and continues it with new text, in a hushed, slow style.' },
            deep: '<ul><li><b>Synthesis</b>: text is normalised ("30-second" → "thirty second"), then a zero-shot model continues the speaker prompt: a codec LM (VALL-E / CosyVoice 2 lineage: semantic tokens + flow-matching decoder) or a fully non-autoregressive flow-matching model (F5-TTS, E2).</li>' +
              '<li><b>Style</b>: instruction or reference-prosody conditioning, here "hushed, awe, slow".</li></ul>' +
              '<p>Both families are opened up one level down, in the Speech, Music and Lip-Sync chamber.</p>'
          },
          {
            say: 'Out come three narration lines in the creator\'s voice, generated at about one twelfth of real time on a single GPU. Consent is verified first, and every sample is watermarked.',
            card: { tag: 'NUMBERS', title: 'Does it sound like her?', stat: { v: '0.68', u: 'speaker similarity', l: 'WavLM cosine, output versus prompt; word error rate 1.9 percent on re-transcription' } },
            deep: '<div class="eq">SIM = cos( e<sub>WavLM</sub>(ŷ), e<sub>WavLM</sub>(prompt) )</div>' +
              '<p>Typical 2025 zero-shot quality on LibriSpeech-PC style tests: WER ≈ 2–3 %, speaker SIM ≈ 0.6–0.7; synthesis runs well below real time on one GPU (RTF ≈ 0.05–0.15). Output is 24 kHz, resampled to the 48 kHz project rate.</p>' +
              '<div class="note">Consent gate: the memo speaker must verify as the account holder before a clone is allowed, and every synthetic line is watermarked (for example AudioSeal).</div>'
          },
          {
            say: 'Each line also comes back with word level timestamps from forced alignment. Those timestamps later drive the captions, and they tell the editor exactly where the voice breathes.',
            card: { tag: 'KEY IDEA', title: 'Timestamps are the real by-product', body: 'Word times become captions. The gaps between words become natural cut points: cut on a breath, never through a word.' },
            deep: '<p><b>Alignment</b>: CTC forced alignment (for example the wav2vec2 / MMS aligner) returns per-word start and end times. Its frame stride is 20 ms, about half a video frame (41.7 ms at 24 fps), so word boundaries are frame-accurate for cutting.</p>' +
              '<p>The times feed three consumers: the WebVTT captions, the editor agent\'s <code>get_alignment</code> tool, and the pause detector that offers the 0.4 s gap after "impact," as a cut candidate.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.top, 0.3, 500);
          stage(ctx, 0);
          var G = panel(ctx, 'NARRATION · zero-shot voice clone', 'orange');
          var mw = IW - 28, mx = IX + 14;
          var wx = mx + mw * 12 / 42, ww = mw * 6 / 42;
          var oy = IY + 268;
          S.voice = [];
          /* beat 0: pick the speaker prompt out of the memo */
          var memoT = ctx.text(IX + 14, IY + 48, 'memo.m4a · 42 s · 48 kHz', { size: 12, font: 'mono', color: 'dim', parent: G });
          var memoW = ctx.path(waveD(ctx, mx, mw, IY + 82, 17, 11, function (u) { return 0.2 + 0.8 * Math.abs(Math.sin(u * 31)) * (Math.sin(u * 7) > -0.6 ? 1 : 0.15); }), { stroke: ctx.alpha('orange', 0.55), sw: 1.2, parent: G });
          var win = ctx.rect(wx, IY + 60, ww, 44, { rx: 4, fill: ctx.alpha('orange', 0.18), stroke: 'orange', sw: 2, parent: G, glow: true });
          var winT = ctx.text(wx + ww / 2, IY + 116, 'speaker prompt · 6 s', { size: 11, font: 'mono', color: 'orange', anchor: 'middle', parent: G });
          ctx.hud('voice clone from 6 s of the memo');
          return Promise.all([ctx.reveal([memoT, memoW], { from: 'left', stagger: 100 }), ctx.reveal(win, { from: 'scale', delay: 500 }), ctx.reveal(winT, { delay: 800 })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: script + style go into the zero-shot TTS model */
            var sc = ctx.label(IX + 334, IY + 138, 'script + style: "hushed, awe"', { color: 'amber', size: 11, w: 262, parent: G });
            var tts = ctx.node({ x: IX + IW / 2, y: IY + 192, w: 360, h: 56, title: 'Zero-shot TTS', sub: 'codec LM · flow matching · vocoder', icon: 'mic', color: 'orange', titleSize: 15, subSize: 11, parent: G });
            var l1 = ctx.line(wx + ww / 2, IY + 126, wx + ww / 2, IY + 163, { color: 'orange', arrow: true, parent: G });
            var l2 = ctx.line(IX + 334, IY + 152, IX + 334, IY + 163, { color: 'amber', arrow: true, parent: G });
            S.l1 = l1;
            return Promise.all([ctx.reveal([sc, tts], { from: 'up', stagger: 150 }), ctx.reveal([l1, l2], { from: 'draw', delay: 400, stagger: 120 })]).then(function () {
              return ctx.pulse(tts, { color: 'orange', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: three narration lines come out, and land on A1 */
            var segs = [[0, 0.3, 'N1 3.8 s'], [0.36, 0.66, 'N2 4.0 s'], [0.7, 1, 'N3 4.0 s']];
            var outs = segs.map(function (sg, k) {
              var g = ctx.group({ parent: G });
              var x0 = mx + mw * sg[0], w = mw * (sg[1] - sg[0]);
              ctx.path(waveD(ctx, x0, w, oy, 16, 40 + k, speechEnv), { stroke: 'orange', sw: 1.2, parent: g });
              ctx.text(x0 + w / 2, oy + 30, sg[2], { size: 11, font: 'mono', color: 'orange', anchor: 'middle', parent: g });
              return g;
            });
            var l3 = ctx.line(IX + IW / 2, IY + 222, IX + IW / 2, oy - 22, { color: 'orange', arrow: true, parent: G });
            var met = ctx.para(IX + 14, IY + 340, nb(['speaker SIM (WavLM cos)   0.68', 'WER (ASR re-transcribe)   1.9 %', 'RTF 0.08 · 24 kHz → 48 kHz', 'consent ✓ · watermark ✓']), { size: 12, font: 'code', color: 'text', lh: 20, parent: G });
            [0, 2, 3].forEach(function (k, n) {
              var v = VOICE[k];
              var c = clip(ctx, S.clips, v.t0, v.t1, 'A1', ctx.C.orange, v.id, { wave: true, seed: 60 + k });
              S.voice.push(c);
              ctx.reveal(c, { from: 'right', delay: 900 + n * 250, dist: 60 });
            });
            ctx.hud('3 lines · RTF 0.08 · SIM 0.68');
            return Promise.all([ctx.reveal(l3, { from: 'draw' }), ctx.reveal(outs, { from: 'left', delay: 300, stagger: 200 }), ctx.reveal(met, { delay: 900 })]).then(function () {
              return ctx.packet(l3, { color: 'orange', dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: forced alignment of N1 */
            var B = strip(ctx, 'FORCED ALIGNMENT · N1 word timestamps → captions + cut points', 'orange');
            var words = [['Twelve', 0.40, 0.78], ['hours', 0.80, 1.18], ['after', 1.25, 1.55], ['impact,', 1.60, 2.15], ['the', 2.55, 2.70], ['ice', 2.72, 3.05], ['began', 3.10, 3.46], ['to', 3.48, 3.60], ['sing.', 3.62, 4.20]];
            function wx2(t) { return BX + 40 + (t - 0.4) / 3.8 * 900; }
            var wv = ctx.path(waveD(ctx, wx2(0.4), 900, BY + 110, 20, 77, function (u) {
              var t = 0.4 + u * 3.8, e = 0.08;
              words.forEach(function (w) { if (t >= w[1] && t <= w[2]) e = 0.4 + 0.6 * Math.sin(Math.PI * (t - w[1]) / (w[2] - w[1])); });
              return e;
            }), { stroke: ctx.alpha('orange', 0.7), sw: 1.2, parent: B });
            var chips = words.map(function (w) {
              var g = ctx.group({ parent: B });
              var x0 = wx2(w[1]), ww2 = wx2(w[2]) - x0;
              ctx.rect(x0, BY + 44, ww2, 28, { rx: 4, fill: ctx.alpha('cyan', 0.12), stroke: ctx.alpha('cyan', 0.7), sw: 1, parent: g });
              ctx.text(x0 + ww2 / 2, BY + 58, w[0], { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: g });
              ctx.line(x0, BY + 76, x0, BY + 138, { color: ctx.alpha('cyan', 0.25), sw: 1, dash: '2 3', parent: g });
              return g;
            });
            var pause = ctx.text(wx2(2.35), BY + 58, 'pause 0.4 s', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: B });
            for (var t = 0.5; t <= 4.2; t += 0.5) ctx.text(wx2(t), BY + 148, t.toFixed(1) + 's', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
            ctx.hud('word times → captions + cut points');
            return Promise.all([ctx.reveal(wv, { from: 'fade', delay: 300 }), ctx.reveal(chips, { from: 'down', stagger: 110, delay: 500 }), ctx.reveal(pause, { delay: 1500 })]).then(function () { return ctx.pulse(S.voice[0], { color: 'orange', times: 1, dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Score & sound design',
        beats: [
          {
            say: 'Next, the music. The music model receives a cue sheet: ninety six beats per minute, a minor key, and a build that peaks exactly at the crash, fifteen seconds in.',
            card: { tag: 'KEY IDEA', title: 'A cue sheet, not a mood', body: 'Tempo, key, length and the hit point are structured constraints. The score is written to the picture, not the other way round.' },
            deep: '<p><b>Score</b>: a latent-diffusion audio model (Stable Audio class: DiT over a VAE latent at ≈21.5 Hz, 44.1 kHz stereo, with <i>timing conditioning</i> seconds_start / seconds_total) or a codec LM (MusicGen: EnCodec 32 kHz, 4 codebooks at 50 Hz, delay-pattern decoding).</p>' +
              '<p>The cue sheet pins tempo and the hit point. Stems (strings, synth, percussion) stay separate until the final mix so the editor can re-time any of them without regenerating audio.</p>'
          },
          {
            say: 'At that tempo one beat lasts exactly fifteen frames, so every cut can land on a beat and the film breathes with the score.',
            card: { tag: 'NUMBERS', title: 'One beat, fifteen frames', stat: { v: '15 f', u: 'per beat', l: '60 / 96 = 0.625 s = 15 frames at 24 fps, so a bar is 60 frames and the crash falls on beat 24' }, more: '<p>Frames per beat = 24 × 60 / BPM = 1440 / BPM. That is a whole number only for tempos that divide 1440: 72, 80, 90, 96, 120 and 144 give 20, 18, 16, 15, 12 and 10 frames. At 100 BPM a beat is 14.4 frames, so cuts would drift off the grid. That is why the cue sheet asks for 96.</p>' },
            deep: '<div class="eq">beat = 60 / 96 = 0.625 s = 15 frames @ 24 fps  ·  bar = 60 f  ·  HIT = beat 24 = 15.0 s</div>' +
              '<p>The 30 s cue is 48 beats, 12 bars. Every cut in the edit is a multiple of 15 frames: 105, 225, 315, 420, 540 and 660. Tempo is only loosely obeyed from text, so the pipeline verifies with a beat tracker (for example madmom) and, if it measures 95.4 BPM, time-stretches by 0.6 % with a phase vocoder so the downbeats land on the edit grid.</p>'
          },
          {
            say: 'Sound effects come from a video to audio model that watches each shot and places the alarm, the whoosh and the impact on the right frame.',
            card: { tag: 'STATE OF THE ART', title: 'Foley that watches the picture', body: 'Video-to-audio models such as MMAudio generate effects from frames and text, synchronised to within about one frame.' },
            deep: '<p><b>Foley</b>: video-to-audio (MMAudio: flow matching, joint audio–video–text training, Synchformer features at 24 fps for frame-level sync) generates per-shot effects that follow on-screen motion. Veo 3-class models can instead emit audio jointly with the video.</p>' +
              '<p>For the trailer, five events are generated: alarm (S2), whoosh (S3), impact at frame 360 (S4), crackle (S5) and a low hum for the ice (S6). Each lands on its own track A3 clip, so any one can be nudged.</p>'
          },
          {
            say: 'Under every spoken line, the music ducks by about ten decibels, so the narration stays intelligible. The gain dips and recovers around each line, keyed by the voice track.',
            card: { tag: 'NUMBERS', title: 'Ducking depth', stat: { v: '−10 dB', u: 'under speech', l: 'sidechain: the voice keys the music gain, 80 ms attack, 400 ms release' } },
            deep: '<p><b>Ducking</b> is a sidechain compressor: A1 (voice) drives gain reduction on A2 (music).</p>' +
              '<div class="eq">g(t) = −10 dB · s(t),  s: attack 80 ms, release 400 ms</div>' +
              '<p>The gain plot below is what the mixer will apply. Because ducking is automation on a separate stem, moving a line by two frames only moves its dip; nothing is regenerated. The full-power score at the 15.0 s hit sits in a gap between lines on purpose.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          stage(ctx, 0);
          if (S.bot) ctx.remove(S.bot, 300);
          var G = panel(ctx, 'SCORE + SFX · cue sheet → models', 'orange');
          /* beat 0: the cue sheet, and the score clip on A2 */
          var cue = ctx.code({ x: IX + 12, y: IY + 42, w: IW - 24, title: 'cue.json', lang: 'json', size: 12, color: 'orange', parent: G, lines: [
            '{"bpm": 96, "key": "D minor", "len_s": 30,',
            ' "arc": "sparse > build > HIT@15.0 > resolve",',
            ' "stems": ["strings", "synth", "perc"],',
            ' "model": "latent DiT audio, 44.1 kHz"}'] });
          S.music = clip(ctx, S.clips, 0, 30, 'A2', ctx.C.orange, 'A2 · score 96 BPM', { wave: true, seed: 91, env: function (u) {
            var t = u * 30; return t < 15 ? 0.25 + 0.6 * t / 15 : (t < 16.5 ? 1 : 0.5 - 0.25 * (t - 16.5) / 13.5);
          } });
          ctx.hud('96 BPM · D minor · hit at 15.0 s');
          return Promise.all([ctx.reveal(cue, { from: 'up', delay: 200 }), ctx.reveal(S.music, { from: 'left', delay: 600 })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: the beat grid */
            var eq = ctx.text(IX + 14, IY + 186, '60 / 96 = 0.625 s per beat = 15 frames', { size: 12, font: 'mono', color: 'white', parent: G });
            for (var b = 0; b <= 48; b++) {
              var down = b % 4 === 0;
              ctx.line(tx(b * 0.625), 466, tx(b * 0.625), 680, { color: down ? ctx.alpha('orange', 0.28) : 'rgba(255,255,255,0.06)', sw: 1, parent: S.grid });
            }
            var B = strip(ctx, 'BEAT GRID · 96 BPM · every cut is a multiple of 15 frames', 'orange');
            var px0 = BX + 40, pw = 900;
            function fx(f) { return px0 + f / 720 * pw; }
            ctx.line(px0, BY + 92, px0 + pw, BY + 92, { color: 'faint', parent: B });
            for (var f = 0; f <= 720; f += 15) {
              ctx.line(fx(f), BY + 92 - (f % 60 ? 5 : 11), fx(f), BY + 92, { color: f % 60 ? 'dim' : 'orange', sw: f % 60 ? 1 : 1.5, parent: B });
              if (f % 120 === 0) ctx.text(fx(f), BY + 120, 'f ' + f, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
            }
            var cuts = [105, 225, 315, 420, 540, 660].map(function (f) {
              var g = ctx.group({ parent: B });
              ctx.poly([[fx(f) - 6, BY + 56], [fx(f) + 6, BY + 56], [fx(f), BY + 70]], { fill: 'amber', parent: g });
              ctx.text(fx(f), BY + 44, String(f), { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
              return g;
            });
            ctx.text(BX + 14, BY + 146, 'cuts at 105 · 225 · 315 · 420 · 540 · 660 f  =  beats 7 · 15 · 21 · 28 · 36 · 44   |   HIT = frame 360 = beat 24', { size: 12, font: 'mono', color: 'text', parent: B });
            ctx.hud('1 beat = 0.625 s = 15 frames');
            return Promise.all([ctx.reveal(eq, { delay: 200 }), ctx.reveal(S.grid, { delay: 300, dur: 900 }), ctx.reveal(cuts, { from: 'down', stagger: 130, delay: 900 })]).then(function () { return ctx.wait(300); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: foley from the picture */
            ctx.text(IX + 14, IY + 214, 'video-to-audio (MMAudio-class): frames → foley', { size: 12, font: 'mono', color: 'dim', parent: G });
            var rows = SFX.map(function (e, k) {
              var g = ctx.group({ parent: G });
              var y = IY + 246 + k * 36;
              var shotK = [1, 2, 3, 4, 5][k];
              thumb(ctx, g, IX + 16, y - 13, 44, 26, shotK);
              ctx.line(IX + 66, y, IX + 100, y, { color: 'orange', arrow: true, parent: g });
              ctx.label(IX + 108, y, e[2], { color: 'orange', size: 11, anchor: 'start', w: 84, parent: g });
              ctx.text(IX + 206, y, e[0].toFixed(1) + ' – ' + e[1].toFixed(1) + ' s', { size: 12, font: 'mono', color: 'text', parent: g });
              ctx.text(IX + IW - 16, y, k === 2 ? 'onset @ frame 360' : 'S' + (shotK + 1), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
              return g;
            });
            S.sfx = SFX.map(function (e, k) {
              var c = clip(ctx, S.clips, e[0], e[1], 'A3', k === 2 ? ctx.C.amber : ctx.C.orange, e[2], {});
              ctx.reveal(c, { from: 'down', delay: 500 + k * 200 });
              return c;
            });
            ctx.hud('5 foley events · onset within 1 frame');
            return Promise.all([ctx.reveal(rows, { from: 'left', stagger: 140 })]).then(function () { return ctx.pulse(S.sfx[2], { color: 'amber', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: ducking, drawn over A2 and as gain automation */
            function gainDb(t) {
              var g = 0;
              VOICE.forEach(function (v) {
                var k = 0;
                if (t >= v.t0 && t <= v.t1) k = Math.min(1, (t - v.t0) / 0.08);
                else if (t > v.t1 && t < v.t1 + 0.4) k = 1 - (t - v.t1) / 0.4;
                g = Math.min(g, -10 * k);
              });
              return g;
            }
            var d = '', T = TR.A2;
            for (var i = 0; i <= 300; i++) {
              var t = i / 10, y = T.y + 21 + (-gainDb(t)) / 10 * 14;
              d += (i ? 'L' : 'M') + tx(t).toFixed(1) + ',' + y.toFixed(1);
            }
            S.duck = ctx.path(d, { stroke: 'white', sw: 1.4, parent: S.clips, opacity: 0.85 });
            var B = strip(ctx, 'SIDECHAIN DUCKING · A1 voice → gain on A2 music (dB)', 'orange');
            var px0 = BX + 70, pw = 900, py0 = BY + 34, ph = 108;
            VOICE.forEach(function (v) {
              ctx.rect(px0 + v.t0 / 30 * pw, py0, (v.t1 - v.t0) / 30 * pw, ph, { rx: 2, fill: ctx.alpha('orange', 0.1), parent: B });
            });
            var pl = ctx.plot(px0, py0, pw, ph, gainDb, { xDomain: [0, 30], yDomain: [-12, 1], color: 'orange', sw: 2, samples: 600, parent: B, glow: true });
            [0, -5, -10].forEach(function (db) { ctx.text(px0 - 8, pl.toPx(0, db).y, db + ' dB', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B }); });
            ctx.text(px0 + pw, py0 + ph + 12, 'time (s)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B });
            ctx.text(px0 + 15.0 / 30 * pw - 8, py0 + 58, 'HIT 15.0 s · full score', { size: 11, font: 'mono', color: 'amber', anchor: 'end', parent: B });
            ctx.line(px0 + 15.0 / 30 * pw, py0, px0 + 15.0 / 30 * pw, py0 + ph, { color: 'amber', dash: '3 4', parent: B });
            ctx.hud('music ducks 10 dB under every line');
            return Promise.all([ctx.reveal(S.duck, { from: 'draw', dur: 1400, delay: 300 }), ctx.reveal(pl.curve, { from: 'draw', dur: 1400, delay: 700 })]).then(function () { return ctx.pulse(S.voice[0], { color: 'orange', times: 1, dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Lip-sync',
        beats: [
          {
            say: 'In shot two the fox speaks on screen: mayday, hull breach. The video model animated a mouth, but not these exact syllables.',
            card: { tag: 'PITFALL', title: 'Plausible lips, wrong syllables', body: 'A video model animates a talking mouth, not these phonemes. Three frames of audio lag, 125 ms, is right at the edge of what viewers notice.' },
            deep: '<p>The video generator saw a text prompt, not the waveform of D1, the fox\'s line "Mayday. Hull breach." (2.6 s). It produces plausible mouth motion, but the visemes (mouth shapes) do not line up with the phonemes in the audio.</p>' +
              '<p>Humans tolerate audio leading by about 45 ms and lagging by about 125 ms (ITU-R BT.1359), which is 1 to 3 frames at 24 fps. Unrepaired generator lips are typically worse than that.</p>'
          },
          {
            say: 'A lip sync model repairs that locally. It masks the lower half of the face in every frame and regenerates only that region.',
            card: { tag: 'KEY IDEA', title: 'Repaint the mouth, keep the rest', body: 'Only the masked lower face is regenerated and pasted back with a feathered edge. Ears, fur, background and every other frame stay untouched.' },
            deep: '<p>The mask comes from a face track. Stylised faces break landmark detectors, so for the fox the mask comes from the generator\'s own segmentation track (for example SAM 2 propagated through the shot).</p>' +
              '<p>The face crop is encoded by an image VAE (8× spatial downsampling), the lower half is masked, and the diffusion model repaints only those latents. Because the rest of the frame is copied through, colour and grain of the shot are preserved exactly.</p>'
          },
          {
            say: 'The regeneration is a latent diffusion model conditioned on Whisper audio features and on a reference frame of the fox, so the identity stays fixed while the lips follow the speech.',
            card: { tag: 'HOW IT WORKS', title: 'Audio drives, a reference anchors', body: 'Whisper features enter through cross attention; an unmasked reference frame keeps teeth, fur and face shape. Sixteen frames are denoised together.' },
            deep: '<p><b>LatentSync</b> (2024): Stable-Diffusion-style U-Net in VAE latent space; inputs per 16-frame window are masked target latents ‖ reference-frame latents ‖ noise. Whisper encoder features of the aligned audio enter through cross-attention.</p>' +
              '<p>It is trained with a SyncNet loss in pixel space plus TREPA (temporal representation alignment) against flicker. Lineage: <b>Wav2Lip</b> (2020) used a frozen SyncNet expert as a discriminator; diffusion replaced the GAN for sharper, more stable mouths.</p>'
          },
          {
            say: 'A SyncNet style expert then measures the offset between sound and lips. Before the fix, its confidence is weak and peaks three frames late. After it, a sharp peak sits at zero.',
            card: { tag: 'NUMBERS', title: 'From three frames late to zero', stat: { v: '+3 → 0', u: 'frames', l: 'audio-video offset; LSE-C rises from 2.1 to 8.0. The gate is one frame and LSE-C at least 6' }, more: '<p>SyncNet embeds a 0.2 s audio window and a 5-frame mouth crop and compares them at every offset from −15 to +15 frames. LSE-D is the smallest distance, LSE-C the gap between the median and the minimum: a sharp, deep valley means the audio and the lips agree at exactly one offset.</p>' },
            deep: '<p><b>SyncNet metric</b>: distances are computed for offsets δ ∈ [−15, 15] frames.</p>' +
              '<div class="eq">LSE-D = min<sub>δ</sub> d(δ)   LSE-C = median<sub>δ</sub> d(δ) − min<sub>δ</sub> d(δ)</div>' +
              '<p>Low LSE-D and high LSE-C (≈7–8 for real talking-head footage) mean tight sync; argmin δ is the AV offset, which must be 0 ±1 frame. Joint audio-video generators (Veo 3 class) avoid the patch, but any later line change still needs lip-sync.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          stage(ctx, 0);
          if (S.bot) ctx.remove(S.bot, 300);
          var G = panel(ctx, 'LIP-SYNC · shot S2 · audio-conditioned inpainting', 'orange');
          var fx = IX + 130, fy = IY + 170;
          /* audio bars for D1 */
          var r = ctx.rng(5), env = [];
          for (var i = 0; i < 26; i++) env.push(0.15 + 0.85 * Math.abs(Math.sin(i * 0.9)) * (0.5 + 0.5 * r()));
          /* beat 0: the fox speaks D1; its mouth follows the audio envelope but not the words */
          var fox = foxHead(ctx, G, fx, fy, 0.95);
          var d1T = ctx.text(IX + 14, IY + 300, 'D1 audio · "Mayday. Hull breach." · 2.6 s', { size: 12, font: 'mono', color: 'orange', parent: G });
          var bars = ctx.bars(IX + 14, IY + 312, IW - 28, 60, env, { color: 'orange', gap: 4, parent: G });
          var head = ctx.line(IX + 14, IY + 308, IX + 14, IY + 376, { color: 'white', sw: 2, parent: G, glow: true });
          S.lip = ctx.loop(function (t) {
            var u = (t % 2.6) / 2.6, idx = Math.min(25, Math.floor(u * 26));
            fox.mouth.setAttribute('ry', (2 + 13 * env[idx]).toFixed(2));
            var x = IX + 14 + u * (IW - 28);
            head.setAttribute('x1', x); head.setAttribute('x2', x);
          });
          var v = VOICE[1];
          S.d1 = clip(ctx, S.clips, v.t0, v.t1, 'A1', ctx.C.orange, v.id, { wave: true, seed: 71, dash: '4 3' });
          ctx.hud('shot S2 · line D1 · 2.6 s');
          return Promise.all([ctx.reveal([d1T, bars], { delay: 200, stagger: 150 }), ctx.reveal(S.d1, { from: 'right', delay: 600, dist: 60 }), ctx.wait(1400)]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: mask the lower face */
            var mask = ctx.rect(fx - 70, fy + 6, 140, 70, { rx: 6, stroke: 'magenta', sw: 1.6, dash: '5 4', fill: ctx.alpha('magenta', 0.08), parent: G });
            var maskT = ctx.text(fx, fy + 108, 'mask: lower face', { size: 11, font: 'mono', color: 'magenta', anchor: 'middle', parent: G });
            S.chain = ['face track + mask (SAM 2)', 'VAE encode · 8× down', 'denoise ⟵ Whisper audio', 'VAE decode · feather paste'].map(function (s, k) {
              return ctx.node({ x: IX + 356, y: IY + 72 + k * 58, w: 206, h: 40, title: s, color: k === 2 ? 'violet' : 'orange', kind: 'chip', titleSize: 11.5, glow: false, parent: G });
            });
            S.cl = [];
            for (var k = 0; k < 3; k++) S.cl.push(ctx.link(S.chain[k], S.chain[k + 1], { color: 'dim', straight: true, parent: G }));
            ctx.hud('mask the lower face · keep every other pixel');
            return Promise.all([ctx.reveal(mask, { from: 'scale' }), ctx.reveal(maskT, { delay: 300 }), ctx.reveal(S.chain.slice(0, 2), { from: 'right', stagger: 150, delay: 300 }), ctx.reveal(S.cl[0], { from: 'draw', delay: 700 })]).then(function () {
              return ctx.pulse(mask, { color: 'magenta', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: the denoiser is conditioned on audio and a reference frame */
            var n1 = ctx.text(IX + 14, IY + 400, '16-frame windows · ref frame keeps identity', { size: 11, font: 'mono', color: 'dim', parent: G });
            var n2 = ctx.text(IX + 14, IY + 420, 'only the masked latents are regenerated', { size: 11, font: 'mono', color: 'dim', parent: G });
            return Promise.all([ctx.reveal(S.chain.slice(2), { from: 'right', stagger: 150 }), ctx.reveal(S.cl.slice(1), { from: 'draw', delay: 400, stagger: 150 }), ctx.reveal([n1, n2], { delay: 800, stagger: 150 })]).then(function () {
              return ctx.pulse(S.chain[2], { color: 'violet', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: SyncNet measures the offset before and after */
            var B = strip(ctx, 'SYNCNET OFFSET SEARCH · confidence vs audio-video offset (frames)', 'orange');
            var px0 = BX + 70, pw = 560, py0 = BY + 34, ph = 108;
            var before = ctx.plot(px0, py0, pw, ph, function (x) { return 2 + 2.2 * Math.exp(-Math.pow((x - 3) / 4.5, 2)) + 0.35 * Math.sin(x * 1.7); }, { xDomain: [-15, 15], yDomain: [0, 11], color: 'dim', sw: 1.6, samples: 120, parent: B });
            var after = ctx.plot(px0, py0, pw, ph, function (x) { return 1.6 + 8.2 * Math.exp(-Math.pow(x / 1.3, 2)) + 0.25 * Math.sin(x * 2.1); }, { xDomain: [-15, 15], yDomain: [0, 11], color: 'lime', sw: 2.2, samples: 160, axes: false, parent: B, glow: true });
            var z = before.toPx(0, 0);
            ctx.line(z.x, py0, z.x, py0 + ph, { color: 'faint', dash: '3 4', parent: B });
            [-15, -10, -5, 0, 5, 10, 15].forEach(function (o) { ctx.text(before.toPx(o, 0).x, py0 + ph + 12, (o > 0 ? '+' : '') + o, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B }); });
            var p3 = before.toPx(3, 4.2);
            var t1 = ctx.text(p3.x + 10, p3.y - 6, 'before: +3 f', { size: 11, font: 'mono', color: 'dim', parent: B });
            var p0 = after.toPx(0, 9.8);
            var t2 = ctx.text(p0.x + 12, p0.y + 4, 'after: 0 f', { size: 11, font: 'mono', color: 'lime', parent: B });
            var stats = ctx.para(BX + 680, BY + 52, nb(['before  LSE-C 2.1  LSE-D 10.4', 'after   LSE-C 8.0  LSE-D 6.6', 'gate: |offset| ≤ 1 frame', '      LSE-C ≥ 6']), { size: 12, font: 'code', color: 'text', lh: 22, parent: B });
            ctx.hud('offset +3 f → 0 f (1 f = 41.7 ms)');
            return Promise.all([ctx.reveal(before.curve, { from: 'draw', delay: 400, dur: 900 }), ctx.reveal(t1, { delay: 1000 })]).then(function () {
              return Promise.all([ctx.reveal(after.curve, { from: 'draw', dur: 1200 }), ctx.reveal([t2, stats], { delay: 900, stagger: 300 })]);
            });
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Edit decision list',
        beats: [
          {
            say: 'Now the editor agent. It watches low resolution proxies of every shot, and it reads the script timings, the word timestamps and the beat grid through tool calls.',
            card: { tag: 'HOW IT WORKS', title: 'The editor sees proxies, not pixels', body: 'Two-frames-per-second keyframes go through the vision encoder; alignment and beat data arrive as structured tool results.' },
            deep: '<p>The editor is an LLM agent with tools: <code>get_proxy(shot, fps=2)</code> (captioned keyframes via the vision encoder), <code>get_alignment(line)</code>, <code>get_beats()</code> and finally <code>submit_edl(edl)</code>.</p>' +
              '<p>A 480×270 proxy at 2 fps costs a few hundred tokens per shot after captioning, so all six shots fit in context with room to reason. Full-resolution mezzanine files are never opened by the model.</p>'
          },
          {
            say: 'It writes an edit decision list: structured JSON with clip URIs, in and out points in frames, transitions, audio tracks and captions. The first draft lands on the timeline exactly as the agent wrote it.',
            card: { tag: 'KEY IDEA', title: 'The edit is data', body: 'URIs and frame ranges, no pixels. That makes the edit inspectable, diffable, cheap to revise and exactly reproducible.' },
            deep: '<p>The output is <b>data</b>, validated before any GPU is scheduled. Each video entry is <code>{uri, in, out}</code> in source frames, plus optional <code>xfade</code> or <code>fade_out_f</code>; audio entries carry a track, a URI and a start frame.</p>' +
              '<div class="note">Why an EDL instead of letting a model "render the edit"? It is inspectable, diffable, cheap to revise (re-render only touched segments), and exactly reproducible. It interoperates with NLEs via OpenTimelineIO / CMX 3600 / FCPXML adapters for a human editor to take over.</div>'
          },
          {
            say: 'The list is emitted as a tool call and validated against a schema before any GPU is scheduled. The first draft fails three checks: it runs seven frames long, the dissolve has too little handle, and the third cut is off the beat grid.',
            card: { tag: 'WHY IT MATTERS', title: 'Fail in milliseconds, not GPU-minutes', body: 'A rule check costs nothing. Discovering the same mistake after a render costs minutes of GPU time and a wasted encode.' },
            deep: '<pre>validate(edl):\n  0 ≤ in &lt; out ≤ src_frames        # 121\n  Σ(out − in) == dur_f               # 720\n  xfade f ≤ 2·min(handle_a, handle_b)\n  cut % 15 == 0   (beat grid, soft)\n  uris resolvable, captions ≤ 42 chars\non error → typed errors → agent repairs (≤ 3)</pre>' +
              '<p>The draft has S3 out = 117, so S3 lasts 97 frames, the total is 727, only 4 spare source frames follow the out point (the dissolve needs 6), and the cut lands at frame 322, seven frames off beat 21.</p>'
          },
          {
            say: 'The typed errors go back to the agent as a tool result. It trims the third clip by seven frames, the cut snaps to the beat at frame three hundred fifteen, and every check turns green.',
            card: { tag: 'NUMBERS', title: 'Snap to the beat', stat: { v: '−7 f', u: 'on cut 3', l: '322 → 315 = beat 21. Length is exactly 720 frames and the dissolve keeps its 6-frame handles' } },
            deep: '<p>Durations: 105 + 120 + 90 + 105 + 120 + 120 + 60 = 720 frames. The S3→S4 dissolve is centred on cut 315 and consumes 6-frame handles on each side (S3 has 11 spare frames after its out point of 110, S4 has 8 before its in point of 8), so the total length is unchanged.</p>' +
              '<p>A single repair turn was enough. The loop is bounded at three turns; if the agent cannot produce a valid EDL by then, the job escalates to a fallback template edit and flags a human review.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.lip) S.lip.stop();
          stage(ctx, 1);
          if (S.bot) ctx.remove(S.bot, 300);
          var off = (322 - 315) / 24 * PX;
          /* beat 0: what the agent observes */
          var G = panel(ctx, 'EDITOR AGENT · what it observes', 'magenta');
          var proxies = [0, 1, 2, 3, 4, 5].map(function (k) {
            var g = ctx.group({ parent: G });
            thumb(ctx, g, IX + 14 + k * 74, IY + 44, 64, 38, k);
            return g;
          });
          var pt = ctx.text(IX + 14, IY + 98, 'proxies · 2 fps · captioned by the vision encoder', { size: 11, font: 'mono', color: 'dim', parent: G });
          var tools = [['get_proxy(S1…S6, fps=2)', 'keyframes + captions'], ['get_alignment(N1…N3)', 'per-word times'], ['get_beats()', '96 BPM · 15 f grid']];
          var rows = tools.map(function (t, k) {
            var g = ctx.group({ parent: G });
            ctx.label(IX + 14, IY + 142 + k * 50, t[0], { color: 'magenta', size: 11, anchor: 'start', w: 250, parent: g });
            ctx.line(IX + 270, IY + 142 + k * 50, IX + 296, IY + 142 + k * 50, { color: 'magenta', arrow: true, parent: g });
            ctx.text(IX + 304, IY + 142 + k * 50, t[1], { size: 12, font: 'mono', color: 'text', parent: g });
            return g;
          });
          var nt = ctx.text(IX + 14, IY + 320, 'the model never receives pixels: only captions, timings and URIs', { size: 11, font: 'mono', color: 'dim', parent: G });
          ctx.hud('editor agent · 3 tools · proxies at 2 fps');
          return Promise.all([ctx.reveal(proxies, { from: 'down', stagger: 80, delay: 200 }), ctx.reveal(pt, { delay: 600 }), ctx.reveal(rows, { from: 'left', stagger: 200, delay: 800 }), ctx.reveal(nt, { delay: 1600 })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: the EDL is written; the first draft appears on the timeline */
            ctx.remove(S.insp, 300);
            var G2 = S.insp = ctx.group();
            S.edl = ctx.code({ x: IX, y: IY, w: IW, title: 'edl.json · tool_use: submit_edl', lang: 'json', size: 12, color: 'magenta', typing: true, maxLines: 18, parent: G2, lines: [] });
            ctx.reveal(S.edl, { from: 'right', dur: 400 });
            S.v1 = [];
            var labels = ['S1 approach', 'S2 cockpit', 'S3 re-entry', 'S4 impact', 'S5 emerge', 'S6 ice glow', 'TITLE'];
            for (var i = 0; i < 7; i++) {
              (function (i) {
                var t0 = CUTS[i] / 24, t1 = CUTS[i + 1] / 24;
                var fill = i < 6 ? SHOTS[i].bg : '#05070c';
                var c = clip(ctx, S.clips, t0, t1, 'V1', i < 6 ? SHOTS[i].acc : ctx.C.white, labels[i], { fill: fill, textColor: 'white', top: true });
                c.dur = ctx.text(tx(t0) + 5, TR.V1.y + 35, i < 6 ? CUTS[i + 1] - CUTS[i] + ' f' : '60 f', { size: 11, font: 'mono', color: ctx.alpha('white', 0.65), parent: c });
                S.v1.push(c);
                /* draft: cut 3 proposed at frame 322, so S3 is 7 frames longer and everything after it is shifted */
                if (i === 2) { c.bg.setAttribute('width', parseFloat(c.bg.getAttribute('width')) + off); c.dur.textContent = '97 f'; }
                if (i >= 3) ctx.place(c, off, 0);
                ctx.reveal(c, { from: 'down', delay: 500 + i * 260, dur: 400 });
              })(i);
            }
            S.caps = VOICE.map(function (v, k) {
              var c = clip(ctx, S.clips, v.t0, v.t1, 'CAP', ctx.C.cyan, v.cap, {});
              ctx.reveal(c, { from: 'fade', delay: 2400 + k * 150 });
              return c;
            });
            ctx.hud('draft EDL · 7 clips · 3 audio tracks');
            return Promise.all([typeLines(ctx, S.edl, EDL, 4), ctx.wait(2900)]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: validation catches the draft's mistakes */
            var B = strip(ctx, 'EDL VALIDATOR · runs before any render is scheduled', 'magenta');
            var checks = ['JSON schema', '0 ≤ in < out ≤ 121', 'Σ dur = 720 f', 'xfade handles ≥ 6 f', 'cuts on beat grid', 'captions ≤ 42 chars', 'URIs resolve (HEAD)', 'audio inside dur_f'];
            S.chk = checks.map(function (c, k) {
              var col = k % 4, row = Math.floor(k / 4);
              return ctx.label(BX + 128 + col * 244, BY + 58 + row * 40, c, { color: 'dim', size: 12, w: 226, parent: B });
            });
            S.errT = ctx.text(BX + 14, BY + 140, 'on failure: typed error list → back to the editor agent as a tool_result (≤ 3 repair turns)', { size: 12, font: 'mono', color: 'dim', parent: B });
            ctx.hud('draft = 727 f · target = 720 f');
            var verdict = { 2: 'red', 3: 'red', 4: 'amber' };
            return ctx.wait(500).then(function () {
              return S.chk.reduce(function (p, c, k) {
                return p.then(function () { tint(ctx, c, verdict[k] || 'lime'); return ctx.wait(140); });
              }, Promise.resolve());
            }).then(function () {
              S.errT.textContent = 'errors: Σ dur = 727 ≠ 720 · S3 handle 4 < 6 f · cut 3 at 322 f is 7 f off the beat grid';
              S.errT.setAttribute('fill', ctx.C.red);
              return ctx.pulse(S.chk[2], { color: 'red', times: 2, dur: 500 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: the agent repairs the draft; cut 3 snaps to the beat */
            var s3 = S.v1[2];
            var w3 = parseFloat(s3.bg.getAttribute('width')) - off;
            var xc = tx(315 / 24);
            S.xf = ctx.poly([[xc - 8.7, TR.V1.y + 46], [xc, TR.V1.y + 30], [xc + 8.7, TR.V1.y + 46]], { fill: ctx.alpha('white', 0.35), stroke: 'white', parent: S.clips });
            S.snap = ctx.label(xc - 19, 440, 'snap −7 f', { color: 'amber', size: 11 });   /* sits between the 10 s and 15 s ruler labels */
            var line = S.edl.lineEls[4];
            Array.prototype.slice.call(line.childNodes).forEach(function (n) {
              if (n.textContent === '117') { n.textContent = '110'; n.setAttribute('fill', ctx.C.amber); }
            });
            S.errT.textContent = 'repair, turn 1 of 3: S3 out 117 → 110 · Σ = 720 f · cut 3 at 315 f = beat 21';
            S.errT.setAttribute('fill', ctx.C.lime);
            ctx.hud('Σ 105+120+90+105+120+120+60 = 720 f');
            var moves = [ctx.animate(s3.bg, { width: [w3 + off, w3] }, 600, 'back')];
            S.v1.slice(3).forEach(function (c) { moves.push(ctx.transform(c, { x: 0 }, 600, 'back')); });
            return Promise.all(moves).then(function () {
              s3.dur.textContent = '90 f';
              return Promise.all([ctx.reveal([S.xf, S.snap], { stagger: 150 }), tintAll(ctx, [S.chk[2], S.chk[3], S.chk[4]], 'lime', 140)]);
            }).then(function () { return ctx.pulse(S.v1[3], { color: 'amber', times: 1, dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Deterministic assembly',
        beats: [
          {
            say: 'The edit decision list is compiled, not interpreted by a model. A small compiler turns it into an ffmpeg filter graph, a directed graph of filters through which frames are pulled.',
            card: { tag: 'KEY IDEA', title: 'Compiled, not improvised', body: 'A versioned, deterministic compiler maps the EDL to an ffmpeg filter graph. No model touches a pixel at this point.' },
            deep: '<p>An ffmpeg <b>filter graph</b> is a DAG of filters connected by labelled pads; frames are pulled through it by the sinks. The compiler is a pure function of the EDL and is versioned along with the ffmpeg build.</p>' +
              '<pre>[0:v]trim=start_frame=12:end_frame=117,\n     setpts=PTS-STARTPTS[v0];  …</pre>' +
              '<p>Each source is trimmed to its <code>[in, out)</code> range and its timestamps are reset so the clips can be concatenated on the timeline.</p>'
          },
          {
            say: 'On the video side it trims and retimes each clip, cross fades the dissolve, applies the show look up table, and overlays the title.',
            card: { tag: 'HOW IT WORKS', title: 'Four video operations', body: 'Trim, dissolve, colour look-up table, title overlay. The dissolve blends 12 frames borrowed from clip handles, so the film keeps its length.' },
            deep: '<pre>[v2][v3]xfade=transition=fade:\n     duration=0.5:offset=3.5[v23];\n[vcat]lut3d=show_v2.cube[vg];\n[vg][t]overlay=enable=\'gte(n,660)\'[v];</pre>' +
              '<p>The dissolve input S3 is trimmed with its 6-frame handle, [20, 116); S4 starts 6 frames early at source frame 2; offset = 309 − 225 = 84 f = 3.5 s. The look-up table is a 33³ cube applied with tetrahedral interpolation.</p>'
          },
          {
            say: 'On the audio side, the three stems are mixed, with the voice driving a side chain compressor on the music, so the ducking you saw earlier becomes an exact filter.',
            card: { tag: 'HOW IT WORKS', title: 'The ducker is a filter', body: 'The voice is split: one copy is mixed, one copy keys the compressor that lowers the music. Same graph, same result, every render.' },
            deep: '<pre>[1:a]asplit[a1][key];\n[2:a][key]sidechaincompress=ratio=6:\n     attack=80:release=400[duck];\n[a1][duck][3:a]amix=inputs=3:normalize=0,</pre>' +
              '<p><code>sidechaincompress</code> compresses its <i>first</i> input (the music) keyed by the <i>second</i> (the voice), which is why the voice stem is split: one copy goes to the mix, one drives the ducker. The ratio, attack and release are the numbers the mixer plotted earlier, so the graph reproduces that ducking curve exactly.</p>'
          },
          {
            say: 'Loudness is normalized to minus fourteen LUFS integrated, with true peaks held under minus one decibel. Our mix measures minus eighteen point seven, so the graph adds four point seven decibels and a peak limiter.',
            card: { tag: 'NUMBERS', title: 'Loudness target', stat: { v: '−14 LUFS', u: 'integrated', l: 'measured −18.7, so +4.7 dB of gain; a true-peak limiter holds peaks under −1 dBTP' }, more: '<p>The measured true peak was −3.2 dBTP. A static +4.7 dB gain alone would push the impact transient to +1.5 dBTP, so a look-ahead limiter takes about 2.5 dB off those few peaks. Doing this in two passes (measure, then apply) keeps the mix linear everywhere else.</p>' },
            deep: '<p><b>Loudness</b> (ITU-R BS.1770-4 / EBU R128): K-weighting (high-shelf + high-pass), mean square over 400 ms blocks (75 % overlap), absolute gate −70 LUFS, relative gate −10 LU:</p>' +
              '<div class="eq">L<sub>K</sub> = −0.691 + 10·log<sub>10</sub> Σ<sub>c</sub> G<sub>c</sub>·z<sub>c</sub></div>' +
              '<p>Targets: −14 LUFS (streaming platforms), −23 LUFS (EBU broadcast), −24 LKFS (ATSC A/85). The measurement pass gives I = −18.7 LUFS and TP = −3.2 dBTP, then the render applies the gain and limiter. The render-delivery chamber walks through the measurement.</p>'
          },
          {
            say: 'Because the graph is a pure function of its inputs, the render is keyed by a hash, cached, and replayed exactly. Watch the playhead sweep all seven hundred twenty frames into one master file.',
            card: { tag: 'STATE OF THE ART', title: 'Frames never leave the GPU', body: 'NVDEC decodes, CUDA kernels composite, NVENC encodes: seven hundred twenty frames of 1080p composite in about three seconds.' },
            deep: '<div class="note">Render key = sha256(EDL ‖ input hashes ‖ ffmpeg build ‖ flags). With <code>-fflags +bitexact</code> and pinned versions the master is byte-identical on replay. The GPU path (NVDEC → CUDA compositor → NVENC) keeps frames in VRAM: 720 frames of 1080p composite in ≈3 s.</div>' +
              '<p>A cache hit reuses the previous master and skips the render entirely; a partial hit reuses per-segment intermediates. The output <code>master.mov</code> is ProRes 4444 at 24 fps, ready for enhancement.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          stage(ctx, 2);
          if (S.snap) ctx.fade(S.snap, 0, 300);
          if (S.bot) ctx.remove(S.bot, 300);
          var vc = ['decode 6 × S*.mov', 'trim + setpts', 'xfade dissolve 12 f', 'lut3d show_v2', 'overlay title + fade'];
          var ac = ['A1 · A2 · A3 stems', 'sidechaincompress', 'amix 3 → stereo', 'loudnorm −14 / −1', 'aresample 48 kHz'];
          var vn = [], an = [], ls = [];
          var G = panel(ctx, 'EDL → FFMPEG FILTER GRAPH', 'orange');
          function mk(arr, list, x, color, k) {
            arr[k] = ctx.node({ x: x, y: IY + 62 + k * 46, w: 206, h: 32, title: list[k], color: color, kind: 'chip', titleSize: 11.5, glow: false, parent: G });
            return arr[k];
          }
          /* the two graph listings sit in the bottom strip and grow line by line */
          S.bot = ctx.group();
          var cv = ctx.code({ x: BX, y: 700, w: 490, title: 'video graph · compiled from the EDL', lang: 'sh', size: 11, color: 'lime', typing: true, maxLines: 6, parent: S.bot, lines: [] });
          var ca = ctx.code({ x: BX + 500, y: 700, w: 485, title: 'audio graph · compiled from the EDL', lang: 'sh', size: 11, color: 'orange', typing: true, maxLines: 6, parent: S.bot, lines: [] });
          var VL = nb(['[0:v]trim=start_frame=12:end_frame=117,', '     setpts=PTS-STARTPTS[v0];  …', '[v2][v3]xfade=transition=fade:', '     duration=0.5:offset=3.5[v23];', '[vcat]lut3d=show_v2.cube[vg];', '[vg][t]overlay=enable=\'gte(n,660)\'[v];']);
          var AL = nb(['[1:a]asplit[a1][key];', '[2:a][key]sidechaincompress=ratio=6:', '     attack=80:release=400[duck];', '[a1][duck][3:a]amix=inputs=3:normalize=0,', '     loudnorm=I=-14:TP=-1:LRA=11[a]']);
          /* beat 0: the compiler and the graph's sources and sink */
          mk(vn, vc, IX + 121, 'lime', 0); mk(an, ac, IX + 349, 'orange', 0);
          var mux = ctx.node({ x: IX + IW / 2, y: IY + 300, w: 330, h: 40, title: 'mux → master.mov (ProRes 4444)', color: 'white', kind: 'box', titleSize: 13, glow: false, parent: G });
          ctx.hud('EDL → filtergraph · pure function');
          return Promise.all([ctx.reveal(S.bot, { from: 'up', delay: 100 }), ctx.reveal([vn[0], an[0]], { from: 'up', stagger: 100, delay: 200 }), ctx.reveal(mux, { from: 'scale', delay: 500 }), ctx.wait(300).then(function () { return typeLines(ctx, cv, VL.slice(0, 2), 2); })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: the video chain */
            for (var k = 1; k < 5; k++) mk(vn, vc, IX + 121, 'lime', k);
            for (k = 0; k < 4; k++) ls.push(ctx.link(vn[k], vn[k + 1], { color: 'lime', straight: true, parent: G }));
            S.lm1 = ctx.link(vn[4], mux, { color: 'lime', from: 'b', to: 't', parent: G });
            ctx.hud('trim · dissolve · LUT · title');
            return Promise.all([ctx.reveal(vn.slice(1), { from: 'up', stagger: 90 }), ctx.reveal(ls.concat([S.lm1]), { from: 'draw', stagger: 70, delay: 300 }), typeLines(ctx, cv, VL.slice(2), 0)]).then(function () {
              return ctx.pulse(vn[2], { color: 'lime', times: 1, dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: the audio chain */
            var als = [];
            for (var k = 1; k < 5; k++) mk(an, ac, IX + 349, 'orange', k);
            for (k = 0; k < 4; k++) als.push(ctx.link(an[k], an[k + 1], { color: 'orange', straight: true, parent: G }));
            S.lm2 = ctx.link(an[4], mux, { color: 'orange', from: 'b', to: 't', parent: G });
            ctx.hud('voice keys the music ducker');
            return Promise.all([ctx.reveal(an.slice(1), { from: 'up', stagger: 90 }), ctx.reveal(als.concat([S.lm2]), { from: 'draw', stagger: 70, delay: 300 }), typeLines(ctx, ca, AL, 1)]).then(function () {
              return ctx.pulse(an[1], { color: 'orange', times: 1, dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: loudness normalisation */
            var B = strip(ctx, 'LOUDNESS · short-term LUFS (3 s window) · EBU R128 / BS.1770', 'orange');
            var px0 = BX + 70, pw = 620, py0 = BY + 32, ph2 = 110;
            function st(t) {
              var v = -24 + 6 * t / 15;
              VOICE.forEach(function (vv) { if (t > vv.t0 && t < vv.t1 + 1) v = Math.max(v, -20.5); });
              v += 9 * Math.exp(-Math.pow((t - 15.6) / 1.1, 2));
              if (t > 17) v = Math.max(-24, v - (t - 17) * 0.25);
              return v + 0.8 * Math.sin(t * 2.3);
            }
            var axis = ctx.plot(px0, py0, pw, ph2, function () { return -100; }, { xDomain: [0, 30], yDomain: [-30, 0], color: 'none', parent: B });
            var tgtY = axis.toPx(0, -14).y;
            ctx.line(px0, tgtY, px0 + pw, tgtY, { color: 'lime', dash: '6 4', parent: B });
            ctx.text(px0 + pw + 6, tgtY, '−14', { size: 11, font: 'mono', color: 'lime', parent: B });
            [-10, -20, -30].forEach(function (v) { ctx.text(px0 - 8, axis.toPx(0, v).y, String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B }); });
            var cg = ctx.group({ parent: B });
            var curve = ctx.plot(px0, py0, pw, ph2, st, { xDomain: [0, 30], yDomain: [-30, 0], color: 'orange', sw: 2, axes: false, samples: 200, parent: cg });
            ctx.place(cg, 0, 0);
            var iv = ctx.text(BX + 770, BY + 56, 'I  = −18.7 LUFS', { size: 14, font: 'mono', color: 'white', weight: 600, parent: B });
            var tp = ctx.text(BX + 770, BY + 84, 'TP = −3.2 dBTP', { size: 14, font: 'mono', color: 'text', parent: B });
            ctx.text(BX + 770, BY + 112, 'gain +4.7 dB + TP limiter', { size: 12, font: 'mono', color: 'dim', parent: B });
            ctx.text(BX + 770, BY + 136, 'LRA 7.9 LU', { size: 12, font: 'mono', color: 'dim', parent: B });
            ctx.hud('−18.7 LUFS + 4.7 dB → −14.0 LUFS');
            return ctx.reveal(curve.curve, { from: 'draw', dur: 1200, delay: 400 }).then(function () { return ctx.wait(500); }).then(function () {
              var d = 4.7 / 30 * ph2;
              return Promise.all([ctx.transform(cg, { y: -d }, 900, 'inOut'), ctx.counter(iv, -18.7, -14.0, 900, function (v) { return 'I  = ' + v.toFixed(1).replace('-', '−') + ' LUFS'; }),
                ctx.counter(tp, -3.2, -1.0, 900, function (v) { return 'TP = ' + v.toFixed(1).replace('-', '−') + ' dBTP'; })]);
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            if (ctx.dead) return;
            /* beat 4: the render key, and the playhead sweeps the master */
            var key = ctx.para(IX + 14, IY + 352, ['key = sha256(EDL ‖ inputs ‖ ffmpeg 7.1 ‖ flags)', 'cache hit → reuse master, skip render', 'GPU path: NVDEC → CUDA → NVENC (VRAM)'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: G });
            var ph = ctx.group({ parent: S.clips });
            var bar = ctx.rect(TX, RY - 4, 0.01, 4, { rx: 1, fill: 'lime', parent: ph });
            var line = ctx.line(TX, RY + 2, TX, 680, { color: 'white', sw: 2, parent: ph, glow: true });
            var ft = ctx.text(TX + 6, 684, 'f 0', { size: 11, font: 'mono', color: 'white', parent: ph });
            S.ph = ph;
            ctx.hud('render key = sha256(EDL ‖ inputs ‖ build)');
            return Promise.all([ctx.reveal(key, { delay: 200 }), ctx.tween(3200, function (t) {
              var x = tx(30 * t);
              bar.setAttribute('width', Math.max(0.01, x - TX).toFixed(1));
              line.setAttribute('x1', x); line.setAttribute('x2', x);
              ft.setAttribute('x', Math.min(x + 6, tx(30) - 48)); ft.textContent = 'f ' + Math.round(720 * t);
            }, 'linear', 300)]).then(function () {
              ctx.hud('master: 720 f · I −14.0 LUFS · TP −1.0 dBTP');
              return ctx.pulse(mux, { color: 'white', times: 2, dur: 600 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Color, frames, pixels',
        beats: [
          {
            say: 'Before encoding, the frames get polished. Six shots from separate diffusion runs drift in color, so each one is matched to a hero grade by transferring its color statistics, and then one look up table is applied to all of them.',
            card: { tag: 'HOW IT WORKS', title: 'Match first, then grade', body: 'Per-shot statistics transfer pulls six diffusion runs toward one hero look. A single shared LUT then applies the show grade.' },
            deep: '<p><b>Shot matching</b> (Reinhard-style transfer in a decorrelated space, per channel):</p>' +
              '<div class="eq">x′ = (x − μ<sub>s</sub>) · σ<sub>t</sub>/σ<sub>s</sub> + μ<sub>t</sub></div>' +
              '<p>then a shared 33³ 3D LUT (the "show look"). Statistics are computed on keyframes and smoothed across the shot to avoid pumping. The target is the hero shot S5, and inter-shot ΔE<sub>00</sub> must end below 3.</p>'
          },
          {
            say: 'For a forty eight frames per second deliverable, a flow based interpolator like RIFE synthesizes the in between frames, and it never interpolates across a cut.',
            card: { tag: 'HOW IT WORKS', title: 'Invent the in-between frames', body: 'RIFE estimates flow from the middle time and blends two warped frames. The cut list keeps it from morphing across shots.' },
            deep: '<p><b>Interpolation</b> (RIFE): IFNet directly regresses intermediate flows and a fusion mask:</p>' +
              '<div class="eq">Î<sub>t</sub> = M ⊙ W(I<sub>0</sub>, F<sub>t→0</sub>) + (1 − M) ⊙ W(I<sub>1</sub>, F<sub>t→1</sub>)</div>' +
              '<p>Used for 24→48/60 fps deliverables, or 16→24 fps when a model generates at 16 fps (Wan 2.1); FILM handles large motion better. Never interpolate across a cut: split on EDL boundaries first.</p>'
          },
          {
            say: 'A super resolution model lifts the seven twenty p renders to ten eighty p or four K, restoring plausible detail that bicubic upsampling cannot.',
            card: { tag: 'NUMBERS', title: 'Pixels lifted after generation', stat: { v: '×1.5', u: 'to 1080p', l: 'or ×3 for a 4K master, in 512² tiles with 32 px overlap so VRAM stays flat' } },
            deep: '<p><b>Super-resolution</b>: Real-ESRGAN (RRDB, ~16.7 M params, trained with a high-order degradation model) for ×2/×4, or one-step diffusion VSR (for example SeedVR2-style) with temporal attention for fewer artifacts; tiles of 512² with 32 px overlap bound VRAM.</p>' +
              '<p>Rendering at 1080p would cost 2.25× the latent tokens and roughly 5× the attention FLOPs of 720p; upscaling afterwards is far cheaper per pixel.</p>'
          },
          {
            say: 'Finally an automated QC pass checks for flicker, frozen frames, clipping and sync drift, and sends typed issues back to the critic agent instead of to the viewer.',
            card: { tag: 'HOW IT WORKS', title: 'Critic gates before encode', body: 'Eight automated checks run on the graded master. A failure returns a typed issue for a targeted fix, such as re-grading one shot.' },
            deep: '<p><b>QC</b>: black/freeze detection, temporal flicker ΔY, inter-shot ΔE<sub>00</sub>, true-peak, AV offset, caption safe-area, safety re-scan, and a check that no interpolated frame straddles a cut.</p>' +
              '<div class="note">Order in practice: matching, interpolation and SR run <i>per shot</i> on the EDL source ranges plus handles (cuts are known, so nothing blends across them). The step-6 graph is then re-executed on the enhanced segments at delivery resolution. The deterministic render key makes that second pass a cheap, cacheable recompute.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          stage(ctx, 3);
          if (S.ph) ctx.fade(S.ph, 0.35, 400);
          if (S.bot) ctx.remove(S.bot, 300);
          var G = panel(ctx, 'ENHANCE · grade · interpolate · upscale', 'orange');
          /* beat 0: colour match */
          var t1 = ctx.text(IX + 14, IY + 50, 'shot color match', { size: 12, font: 'mono', color: 'white', parent: G });
          var t2 = ctx.text(IX + 14, IY + 82, 'target: hero S5', { size: 11, font: 'mono', color: 'dim', parent: G });
          var sw = [], sw2 = [];
          for (var i = 0; i < 6; i++) {
            sw.push(ctx.rect(IX + 190 + i * 44, IY + 38, 36, 24, { rx: 3, fill: SHOTS[i].bg, stroke: ctx.alpha(SHOTS[i].acc, 0.6), sw: 1, parent: G }));
            sw2.push(ctx.rect(IX + 190 + i * 44, IY + 70, 36, 24, { rx: 3, fill: SHOTS[i].bg, stroke: 'dim', sw: 1, parent: G }));
          }
          var tin = ctx.text(IX + 180, IY + 50, 'in', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          var tout = ctx.text(IX + 180, IY + 82, 'out', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          ctx.hud('6 shots → 1 hero grade → 1 LUT');
          return Promise.all([ctx.reveal([t1, t2, tin, tout], { stagger: 80, delay: 200 }), ctx.reveal(sw.concat(sw2), { stagger: 40, delay: 300 })]).then(function () {
            return ctx.tween(1400, function (t) {
              for (var i = 0; i < 6; i++) {
                var c = ctx.mix(SHOTS[i].bg, GRADE, 0.6 * t);
                sw2[i].setAttribute('fill', c);
                S.v1[i].bg.setAttribute('fill', c);
              }
            }, 'inOut');
          }).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: frame interpolation */
            var by = IY + 120;
            var rt = ctx.text(IX + 14, by + 10, 'RIFE · flow-based interpolation', { size: 12, font: 'mono', color: 'white', parent: G });
            function frame(x, dotX, col, lab) {
              var g = ctx.group({ parent: G });
              ctx.rect(x, by + 28, 110, 62, { rx: 4, fill: '#0c3440', stroke: col, sw: 1.3, parent: g });
              ctx.circle(x + dotX, by + 60, 7, { fill: 'orange', parent: g });
              ctx.text(x + 55, by + 102, lab, { size: 11, font: 'mono', color: col, anchor: 'middle', parent: g });
              return g;
            }
            var f0 = frame(IX + 20, 25, 'dim', 'I0'), f1 = frame(IX + 340, 85, 'dim', 'I1');
            var ft = frame(IX + 180, 55, 'lime', 'Ît (t = 0.5)');
            var fa = ctx.line(IX + 178, by + 66, IX + 134, by + 66, { color: 'lime', arrow: true, parent: G });
            var fb = ctx.line(IX + 292, by + 66, IX + 336, by + 66, { color: 'lime', arrow: true, parent: G });
            var la = ctx.text(IX + 156, by + 52, 'F t→0', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: G });
            var lb = ctx.text(IX + 314, by + 52, 'F t→1', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: G });
            var ticks = ctx.group({ parent: G });
            for (var k = 0; k <= 12; k++) {
              var xk = IX + 20 + k * 24;
              ctx.line(xk, by + 122, xk, by + 136, { color: k % 2 ? 'lime' : 'dim', sw: k % 2 ? 2 : 1.5, parent: ticks });
            }
            ctx.text(IX + IW - 14, by + 129, '24 → 48 fps (×2)', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: ticks });
            ctx.hud('24 → 48 fps · never across a cut');
            return Promise.all([ctx.reveal(rt, { delay: 100 }), ctx.reveal([f0, f1], { delay: 300, stagger: 100 }), ctx.reveal(ft, { from: 'scale', delay: 800 }), ctx.reveal([fa, fb], { from: 'draw', delay: 1000 }), ctx.reveal([la, lb], { delay: 1200 }), ctx.reveal(ticks, { delay: 1300 })]).then(function () {
              return ctx.pulse(ft, { color: 'lime', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: super-resolution */
            var sy = IY + 290;
            var st = ctx.text(IX + 14, sy, 'super-resolution · tiles 512² + 32 px overlap', { size: 12, font: 'mono', color: 'white', parent: G });
            var r4 = ctx.rect(IX + 20, sy + 18, 192, 108, { rx: 3, stroke: 'lime', sw: 1.3, fill: ctx.alpha('lime', 0.05), parent: G });
            var r2 = ctx.rect(IX + 20, sy + 18, 96, 54, { rx: 3, stroke: 'cyan', sw: 1.3, fill: ctx.alpha('cyan', 0.06), parent: G });
            var r1 = ctx.rect(IX + 20, sy + 18, 64, 36, { rx: 3, stroke: 'orange', sw: 1.5, fill: ctx.alpha('orange', 0.12), parent: G });
            var srT = ctx.para(IX + 232, sy + 34, nb(['1280×720   render', '1920×1080  deliver (×1.5)', '3840×2160  4K master (×3)', 'Real-ESRGAN ×2/×4 or', 'one-step diffusion VSR']), { size: 12, font: 'code', color: 'text', lh: 20, parent: G });
            ctx.hud('720p → 1080p · 4K master ×3');
            return Promise.all([ctx.reveal(st, { delay: 100 }), ctx.reveal([r1, r2, r4], { from: 'scale', delay: 300, stagger: 250 }), ctx.reveal(srT, { delay: 900 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: automated QC gates */
            var B = strip(ctx, 'AUTOMATED QC · critic gates before encode', 'orange');
            var qc = ['black / freeze frames', 'temporal flicker ΔY', 'inter-shot ΔE00 < 3', 'true peak ≤ −1 dBTP', 'AV offset ≤ 1 frame', 'caption safe area', 'safety re-scan', 'no cut interpolated'];
            S.qc = qc.map(function (c, k) {
              var col = k % 4, row = Math.floor(k / 4);
              return ctx.label(BX + 128 + col * 244, BY + 58 + row * 40, c, { color: 'dim', size: 12, w: 226, parent: B });
            });
            ctx.text(BX + 14, BY + 140, 'failure → typed issue to the critic agent → targeted fix (re-grade, re-sync, re-render one shot)', { size: 12, font: 'mono', color: 'dim', parent: B });
            ctx.hud('8 QC gates · all green → encode');
            return ctx.wait(600).then(function () { return tintAll(ctx, S.qc, 'lime', 140); });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Encode & deliver',
        beats: [
          {
            say: 'Last, the master is encoded into an adaptive bitrate ladder, from ten eighty p at around four and a half megabits per second down to three sixty p under one megabit, on hardware encoders.',
            card: { tag: 'NUMBERS', title: 'The trailer in a browser', stat: { v: '≈ 17 MB', l: 'the 30 s trailer on the 1080p HEVC rung at 4.5 Mb/s; 360p is under 3 MB' }, more: '<p>File size = bitrate × duration / 8: 4.5 Mb/s × 30 s / 8 = 16.9 MB, and 0.6 Mb/s gives 2.25 MB. The four HEVC rungs together (4.5 + 2.5 + 1.4 + 0.6 = 9 Mb/s) total about 34 MB, and each additional codec set roughly adds the same again.</p>' },
            deep: '<table><tr><th>Rung</th><th>HEVC</th><th>AV1</th><th>H.264</th></tr>' +
              '<tr><td>1080p</td><td>4.5 Mb/s</td><td>3.2</td><td>7.0</td></tr>' +
              '<tr><td>720p</td><td>2.5</td><td>1.8</td><td>4.0</td></tr>' +
              '<tr><td>540p</td><td>1.4</td><td>1.0</td><td>2.2</td></tr>' +
              '<tr><td>360p</td><td>0.6</td><td>0.45</td><td>1.0</td></tr></table>' +
              '<p>Each codec generation saves roughly 30–50 % bitrate at equal quality (H.264 → HEVC ≈ 35–50 %, HEVC → AV1 ≈ 20–30 %; this table sits at the conservative end of both ranges); rungs are chosen per title from the convex hull of rate–quality curves (VMAF).</p>'
          },
          {
            say: 'Each rendition is cut into four second CMAF segments, described by HLS and DASH manifests, and signed with C2PA content credentials that travel with the file.',
            card: { tag: 'HOW IT WORKS', title: 'One set of segments, two manifests', body: 'CMAF fragmented MP4 serves both HLS and DASH, so every rung is stored once. The C2PA manifest is bound to it by hash.' },
            deep: '<ul><li><b>Encode</b>: NVENC (Ada/Blackwell have AV1): several hundred 1080p fps per chip; GOP = 96 frames (4 s) closed, so every segment starts with an IDR.</li>' +
              '<li><b>Package</b>: CMAF fMP4 (init + moof/mdat), one set of segments referenced by both HLS <code>.m3u8</code> and DASH <code>.mpd</code>.</li>' +
              '<li><b>Provenance</b>: C2PA manifest (signed claim: generator, edits, AI assertions) bound by hash to the asset.</li></ul>'
          },
          {
            say: 'Everything is pushed to a content delivery network, and the player picks a rung from its buffer and bandwidth, so the film plays without stalling on a bad connection.',
            card: { tag: 'KEY IDEA', title: 'Immutable segments, no purges', body: 'Segment names carry a content hash, so edge caches never need invalidation. Only the short-lived manifest changes.' },
            deep: '<ul><li><b>CDN</b>: origin → shield → edge, signed URLs with expiry, immutable segment names (content hash) so caches never need purging.</li>' +
              '<li><b>Player</b>: an adaptive-bitrate controller (throughput, buffer or hybrid such as BOLA) chooses the next segment\'s rung, starting mid-ladder and switching up once a few segments are buffered.</li></ul>' +
              '<p>The Render, Encoding and Delivery chamber opens all of this: filter graphs, codecs, ladders, caches and the ABR math.</p>'
          },
          {
            say: 'After the last shot renders, this whole chain adds only about fourteen seconds. Zoom into either chamber to see the audio models, or the codec and delivery machinery, in depth.',
            card: { tag: 'TRY IT', title: 'Open the two child chambers', body: 'Click the glowing Audio Gen stage, the dashed Render and Delivery frame, or the zoom chips below.' },
            deep: '<div class="note">Critical path after the last shot: EDL ≈3 s · assembly ≈3 s · enhance ≈5 s (8 GPUs) · encode + package ≈3 s ≈ <b>14 s</b>. Audio ran in parallel with shot rendering, so it is off the critical path.</div>' +
              '<p>Children: <i>Speech, Music &amp; Lip-Sync</i> (codec LMs, flow-matching TTS, vocoders, MusicGen versus Stable Audio, MMAudio, LatentSync) and <i>Compositing, Encoding &amp; Streaming</i> (filter graphs, loudness, RIFE, super-resolution, GOP and motion, DCT and quantisation, rate control, ABR, CDN).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          stage(ctx, 4);
          if (S.bot) ctx.remove(S.bot, 300);
          var G = panel(ctx, 'ENCODE · PACKAGE · DELIVER', 'orange');
          var rungs = [['1080p', 4.5], ['720p', 2.5], ['540p', 1.4], ['360p', 0.6]];
          /* beat 0: the ABR ladder */
          var lt = ctx.text(IX + 14, IY + 50, 'ABR ladder (HEVC, per-title)', { size: 12, font: 'mono', color: 'white', parent: G });
          var bars = rungs.map(function (r, k) {
            var g = ctx.group({ parent: G });
            var y = IY + 70 + k * 30;
            ctx.text(IX + 14, y + 10, r[0], { size: 12, font: 'mono', color: 'text', parent: g });
            var b = ctx.rect(IX + 70, y, r[1] / 4.5 * 250, 20, { rx: 3, fill: ctx.alpha('orange', 0.3 + 0.15 * (3 - k)), stroke: 'orange', sw: 1, parent: g });
            ctx.text(IX + 78 + r[1] / 4.5 * 250, y + 10, r[1] + ' Mb/s', { size: 11, font: 'mono', color: 'orange', parent: g });
            g.b = b;
            return g;
          });
          ctx.hud('1080p HEVC 4.5 Mb/s ≈ 17 MB for 30 s');
          return Promise.all([ctx.reveal(lt, { delay: 100 }), ctx.reveal(bars, { from: 'left', stagger: 150, delay: 300 })]).then(function () { return ctx.pulse(S.pn[4], { color: 'orange', times: 2, dur: 600 }); }).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: CMAF segments, manifests, C2PA */
            var sy = IY + 206;
            var st = ctx.text(IX + 14, sy, 'CMAF fMP4 · 4 s segments · GOP 96 f (closed)', { size: 12, font: 'mono', color: 'white', parent: G });
            var segs = [];
            segs.push(ctx.label(IX + 44, sy + 30, 'init', { color: 'cyan', size: 11, w: 52, parent: G }));
            for (var i = 0; i < 8; i++) segs.push(ctx.label(IX + 102 + i * 44, sy + 30, 's' + (i + 1), { color: 'orange', size: 11, w: 40, parent: G }));
            var man = ctx.para(IX + 14, sy + 64, ['master.m3u8 · manifest.mpd', 'C2PA manifest · signed · hash-bound'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: G });
            ctx.hud('4 s segments · HLS + DASH · C2PA');
            return Promise.all([ctx.reveal(st, { delay: 100 }), stage(ctx, 5), ctx.reveal(segs, { from: 'fade', stagger: 60, delay: 300 }), ctx.reveal(man, { delay: 900 })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: the CDN and the players */
            var cy = IY + 362;
            var org = ctx.node({ x: IX + 60, y: cy, w: 96, h: 36, title: 'origin', color: 'orange', kind: 'chip', titleSize: 12, glow: false, parent: G });
            var sh = ctx.node({ x: IX + 180, y: cy, w: 96, h: 36, title: 'shield', color: 'orange', kind: 'chip', titleSize: 12, glow: false, parent: G });
            var edges = [0, 1, 2].map(function (k) { return ctx.node({ x: IX + 310, y: cy - 50 + k * 50, w: 84, h: 30, title: 'edge', color: 'blue', kind: 'pill', titleSize: 12, glow: false, parent: G }); });
            var players = [0, 1, 2].map(function (k) { return ctx.icon(k === 1 ? 'globe' : 'phone', IX + 420, cy - 50 + k * 50, 24, 'cyan', { parent: G }); });
            var cl = [ctx.link(org, sh, { color: 'orange', straight: true, parent: G })];
            edges.forEach(function (e) { cl.push(ctx.link(sh, e, { color: 'orange', parent: G })); });
            S.el2 = edges.map(function (e, k) { return ctx.link(e, { x: IX + 406, y: cy - 50 + k * 50 }, { color: 'cyan', straight: true, parent: G }); });
            ctx.hud('edge hit ≈ 95 % · origin ≈ 1 req / segment');
            return Promise.all([ctx.reveal([org, sh].concat(edges), { from: 'scale', stagger: 100 }), ctx.reveal(cl.concat(S.el2), { from: 'draw', stagger: 60, delay: 300 }), ctx.reveal(players, { delay: 600, stagger: 100 })]).then(function () {
              return Promise.all(S.el2.map(function (l, k) { return ctx.wait(k * 200).then(function () { return ctx.packet(l, { color: 'cyan', dur: 500 }); }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: the critical path after the last shot, and the two zoom targets */
            var B = strip(ctx, 'CRITICAL PATH AFTER THE LAST SHOT ≈ 14 s', 'orange');
            var parts = [['EDL', 3, 'magenta'], ['assemble', 3, 'orange'], ['enhance ×8 GPU', 5, 'lime'], ['encode+pkg', 3, 'cyan']];
            var x = BX + 30, gb = [];
            parts.forEach(function (p) {
              var w = p[1] * 40;
              var g = ctx.group({ parent: B });
              ctx.rect(x, BY + 40, w - 4, 30, { rx: 4, fill: ctx.alpha(p[2], 0.3), stroke: p[2], sw: 1, parent: g });
              ctx.text(x + (w - 4) / 2, BY + 55, p[0], { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: g });
              ctx.text(x + (w - 4) / 2, BY + 84, p[1] + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
              gb.push(g); x += w;
            });
            ctx.text(BX + 30, BY + 116, 'audio ran in parallel with shot rendering, so it is off the critical path', { size: 12, font: 'mono', color: 'dim', parent: B });
            var z1 = ctx.label(BX + 790, BY + 56, 'ZOOM ▸ Speech, Music & Lip-Sync', { color: 'orange', size: 12, w: 330, parent: B });
            var z2 = ctx.label(BX + 790, BY + 100, 'ZOOM ▸ Compositing, Encoding & CDN', { color: 'orange', size: 12, w: 330, parent: B });
            ctx.hotspot(z1, 'tts-audio', { hint: '⤢' });
            ctx.hotspot(z2, 'render-delivery', { hint: '⤢' });
            ctx.hud('after the last shot ≈ 14 s');
            return Promise.all([ctx.reveal(gb, { from: 'left', stagger: 150, delay: 400 }), ctx.reveal([z1, z2], { from: 'right', stagger: 150, delay: 1000 })]).then(function () {
              return Promise.all([ctx.pulse(S.pn[0], { color: 'orange', times: 2, dur: 700 }), ctx.pulse(S.ghost, { color: 'orange', times: 2, dur: 700 })]);
            });
          });
        }
      }
    ]
  });
})();
