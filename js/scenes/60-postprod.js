/* L1 — Audio, Editing & Delivery. Six rendered clips become one streamed film: voice, score, foley,
 * lip-sync, an editor agent's EDL, deterministic assembly, enhancement, encoding and the CDN. The
 * multi-track timeline in the lower half is the shared data structure every step writes into. */
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
    if (label) ctx.text(x0 + 5, T.y + (o.wave ? 12 : T.h / 2), label, { size: 11, font: 'mono', color: o.textColor || col, parent: g });
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

  Atlas.register({
    id: 'postprod',
    refs: [
      'Wang et al., <i>Neural Codec Language Models are Zero-Shot Text to Speech Synthesizers (VALL-E)</i>, 2023; Chen et al., <i>F5-TTS</i>, 2024',
      'Evans et al., <i>Stable Audio Open</i>, ICASSP 2025; Copet et al., <i>Simple and Controllable Music Generation (MusicGen)</i>, NeurIPS 2023',
      'Cheng et al., <i>MMAudio: Taming Multimodal Joint Training for High-Quality Video-to-Audio Synthesis</i>, CVPR 2025',
      'Li et al., <i>LatentSync: Taming Audio-Conditioned Latent Diffusion Models for Lip Sync</i>, 2024; Prajwal et al., <i>Wav2Lip</i>, ACM MM 2020',
      'Academy Software Foundation, <i>OpenTimelineIO</i>; FFmpeg Project, <i>FFmpeg Filters Documentation</i> (filtergraph, xfade, loudnorm)',
      'ITU-R BS.1770-4, <i>Algorithms to measure audio programme loudness and true-peak audio level</i>; EBU R 128 (2020)',
      'Huang et al., <i>Real-Time Intermediate Flow Estimation for Video Frame Interpolation (RIFE)</i>, ECCV 2022; Wang et al., <i>Real-ESRGAN</i>, ICCVW 2021',
      'ISO/IEC 23000-19 <i>CMAF</i>; C2PA, <i>Content Credentials Technical Specification</i> 2.x, 2024–2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Clips to a film',
        say: 'The shots are rendered. Six clips of five seconds each sit in object storage as high quality mezzanine files. But six clips are not a film. Post-production turns them into one. Audio generation creates the narration, the music and the sound effects. An editor agent writes an edit decision list. Then deterministic machinery composites, enhances, encodes and ships the result to a content delivery network. The shared data structure through all of it is the timeline below, with video, caption and audio tracks.',
        deep: '<p>Post-production is where the <b>LLM control plane hands off to deterministic media engineering</b>. Agents decide <i>what</i> the cut is; compositors and encoders produce bit-exact output from that decision, so a re-run is reproducible and cacheable.</p>' +
          '<table><tr><th>Stage</th><th>Engine</th><th>Artifact</th></tr>' +
          '<tr><td>Audio gen</td><td>TTS, music, V2A, lip-sync models</td><td>WAV stems, patched shot</td></tr>' +
          '<tr><td>Editor agent</td><td>LLM + tools</td><td>EDL JSON</td></tr>' +
          '<tr><td>Compositor</td><td>ffmpeg / CUDA</td><td>master.mov</td></tr>' +
          '<tr><td>Enhance</td><td>RIFE, SR, color</td><td>graded 1080p/4K master</td></tr>' +
          '<tr><td>Encode + CDN</td><td>NVENC, packager</td><td>CMAF ladder, manifests</td></tr></table>' +
          '<p>Inputs: 6 shots × 121 frames, 1280×720, 24 fps, stored as ProRes 422 HQ (≈90 Mb/s at 720p24) or lossless FFV1 mezzanine so no generation loss accumulates before the final encode.</p>' +
          '<div class="note">Timeline model (OpenTimelineIO-style): <code>Timeline → Stack → Track[V1, CAP, A1–A3] → Clip{media_ref, source_range}</code>, with <b>rational time</b> in frames at 24/1, never floating seconds. Only URIs and ranges pass through LLM context; pixels never do.</div>',
        run: function (ctx) {
          var S = ctx.state;
          /* inputs + shot cards */
          S.top = ctx.group();
          var inA = ctx.label(150, 198, 'script.md · writer', { color: 'amber', size: 11, parent: S.top });
          var inB = ctx.label(150, 234, 'memo.m4a · 42 s', { color: 'orange', size: 11, parent: S.top });
          S.inLine = ctx.line(150, 250, 150, 322, { color: 'orange', arrow: true, parent: S.top });
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
          S.busDown = ctx.line(400, 290, 400, 322, { color: 'lime', arrow: true, parent: S.top });
          S.stats = ctx.para(1195, 190, ['6 shots × 121 frames', '1280×720 · 24 fps · 10-bit', 'mezzanine ProRes 422 HQ', 's3://jobs/7f3a/shots/'], { size: 12, font: 'mono', color: 'dim', lh: 19, parent: S.top });
          ctx.reveal([inA, inB], { from: 'left', stagger: 120 });
          ctx.reveal(S.cards, { from: 'down', stagger: 90, delay: 200 });
          ctx.reveal([S.stats], { delay: 700 });
          ctx.reveal([S.inLine, S.bus, S.busDown], { from: 'draw', delay: 800, stagger: 150 });

          /* pipeline */
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
          ctx.reveal(S.ghost, { delay: 900 });
          ctx.reveal(S.pn, { from: 'up', stagger: 110, delay: 300 });
          ctx.reveal(S.pl, { from: 'draw', stagger: 110, delay: 700 });
          ctx.hotspot(S.pn[0], 'tts-audio');
          ctx.hotspot(S.ghost, 'render-delivery', { hint: 'RENDER & DELIVERY ⤢' });
          /* the four deterministic stages sit on top of the ghost: let clicks fall through to it */
          S.pn.slice(2).forEach(function (n) { n.style.pointerEvents = 'none'; });

          /* empty timeline */
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
          ctx.reveal(S.tl, { from: 'up', delay: 1100 });

          /* right: the stage contract */
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
          ctx.reveal(con, { from: 'right', delay: 1300 });

          /* bottom: the data model */
          var B = strip(ctx, 'TIMELINE DATA MODEL · rational time (frames @ 24/1)', 'orange');
          var chain = [['Timeline', 'dur 720 f'], ['Stack', '5 tracks'], ['Track', 'V1 · A1 …'], ['Clip', 'media_ref + range'], ['Transition', 'dissolve 12 f']];
          var cn = chain.map(function (c, k) { return ctx.node({ x: 160 + k * 196, y: BY + 72, w: 170, h: 52, title: c[0], sub: c[1], color: k === 3 ? 'lime' : 'orange', kind: 'chip', titleSize: 14, subSize: 11, glow: false, parent: B }); });
          for (var q = 0; q < 4; q++) ctx.link(cn[q], cn[q + 1], { color: 'dim', straight: true, parent: B });
          ctx.text(BX + 14, BY + 138, 'Clip = { uri: "s3://…/S3.mov", source_range: [20, 110) }  — the LLM edits ranges, never pixels', { size: 12, font: 'mono', color: 'dim', parent: B });
          ctx.hud('6 shots · 30 s · 720 frames @ 24 fps');
          return ctx.wait(1500).then(function () {
            return Promise.all([ctx.packet(S.inLine, { color: 'orange', dur: 700 }), ctx.packet(S.busDown, { color: 'lime', dur: 700 })]);
          }).then(function () {
            return ctx.packet(S.pl[0], { color: 'magenta', dur: 500 });
          }).then(function () {
            return Promise.all(S.pl.slice(1).map(function (l, k) { return ctx.wait(k * 250).then(function () { return ctx.packet(l, { color: 'orange', dur: 450 }); }); }));
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Narration voice',
        say: 'First, the voice. The writer agent\'s script is spoken in the creator\'s own voice, cloned zero shot from a six second slice of the memo. A codec language model or a flow matching model produces speech with the same timbre, while the prosody is steered to sound hushed and cinematic. Each line comes back with word level timestamps from forced alignment. Those timestamps later drive the captions, and they tell the editor exactly where the voice breathes.',
        deep: '<ol><li><b>Prompt selection</b>: VAD + an SNR/DNSMOS scorer picks the cleanest 3–10 s of the 42 s memo (here 12–18 s). Its transcript comes from ASR.</li>' +
          '<li><b>Synthesis</b>: text is normalised ("30-second" → "thirty second"), then a zero-shot model continues the speaker prompt: a codec LM (VALL-E / CosyVoice 2 lineage: semantic tokens + flow-matching decoder) or a fully non-autoregressive flow-matching model (F5-TTS, E2).</li>' +
          '<li><b>Style</b>: instruction or reference-prosody conditioning: "hushed, awe, slow".</li>' +
          '<li><b>Alignment</b>: CTC forced alignment (e.g. wav2vec2/MMS aligner) returns per-word start/end times.</li></ol>' +
          '<div class="eq">SIM = cos( e<sub>WavLM</sub>(ŷ), e<sub>WavLM</sub>(prompt) )</div>' +
          '<p>Typical 2025 zero-shot quality on LibriSpeech-PC style tests: WER ≈ 2–3 %, speaker SIM ≈ 0.6–0.7; synthesis runs well below real time on one GPU (RTF ≈ 0.05–0.15). Output 24 kHz, resampled to the 48 kHz project rate.</p>' +
          '<div class="note">Consent gate: the memo speaker must verify as the account holder before a clone is allowed, and every synthetic line is watermarked (e.g. AudioSeal).</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.top, 0.3, 500);
          stage(ctx, 0);
          var G = panel(ctx, 'NARRATION · zero-shot voice clone', 'orange');
          ctx.text(IX + 14, IY + 48, 'memo.m4a · 42 s · 48 kHz', { size: 12, font: 'mono', color: 'dim', parent: G });
          var mw = IW - 28, mx = IX + 14;
          ctx.path(waveD(ctx, mx, mw, IY + 82, 17, 11, function (u) { return 0.2 + 0.8 * Math.abs(Math.sin(u * 31)) * (Math.sin(u * 7) > -0.6 ? 1 : 0.15); }), { stroke: ctx.alpha('orange', 0.55), sw: 1.2, parent: G });
          var wx = mx + mw * 12 / 42, ww = mw * 6 / 42;
          var win = ctx.rect(wx, IY + 60, ww, 44, { rx: 4, fill: ctx.alpha('orange', 0.18), stroke: 'orange', sw: 2, parent: G, glow: true });
          ctx.text(wx + ww / 2, IY + 116, 'speaker prompt · 6 s', { size: 11, font: 'mono', color: 'orange', anchor: 'middle', parent: G });
          var sc = ctx.label(IX + 350, IY + 128, 'script + style: "hushed, awe"', { color: 'amber', size: 11, parent: G });
          var tts = ctx.node({ x: IX + IW / 2, y: IY + 192, w: 360, h: 56, title: 'Zero-shot TTS', sub: 'codec LM · flow matching · vocoder', icon: 'mic', color: 'orange', titleSize: 15, subSize: 11, parent: G });
          var l1 = ctx.line(wx + ww / 2, IY + 125, wx + ww / 2, IY + 161, { color: 'orange', arrow: true, parent: G });
          var l2 = ctx.line(IX + 350, IY + 141, IX + 350, IY + 161, { color: 'amber', arrow: true, parent: G });
          /* output waveform segments */
          var oy = IY + 268, segs = [[0, 0.3, 'N1 3.8 s'], [0.36, 0.66, 'N2 4.0 s'], [0.7, 1, 'N3 4.0 s']];
          var outs = segs.map(function (sg, k) {
            var g = ctx.group({ parent: G });
            var x0 = mx + mw * sg[0], w = mw * (sg[1] - sg[0]);
            ctx.path(waveD(ctx, x0, w, oy, 16, 40 + k, speechEnv), { stroke: 'orange', sw: 1.2, parent: g });
            ctx.text(x0 + w / 2, oy + 30, sg[2], { size: 11, font: 'mono', color: 'orange', anchor: 'middle', parent: g });
            return g;
          });
          var l3 = ctx.line(IX + IW / 2, IY + 222, IX + IW / 2, oy - 22, { color: 'orange', arrow: true, parent: G });
          var met = ctx.para(IX + 14, IY + 340, nb(['speaker SIM (WavLM cos)   0.68', 'WER (ASR re-transcribe)   1.9 %', 'RTF 0.08 · 24 kHz → 48 kHz', 'consent ✓ · watermark ✓']), { size: 12, font: 'mono', color: 'text', lh: 20, parent: G });
          ctx.reveal([win], { from: 'scale', delay: 500 });
          ctx.reveal([sc, tts], { from: 'up', delay: 700, stagger: 150 });
          ctx.reveal([l1, l2, l3], { from: 'draw', delay: 900, stagger: 120 });
          ctx.reveal(outs, { from: 'left', delay: 1300, stagger: 200 });
          ctx.reveal(met, { delay: 1800 });
          /* A1 clips */
          S.voice = [];
          [0, 2, 3].forEach(function (k, n) {
            var v = VOICE[k];
            var c = clip(ctx, S.clips, v.t0, v.t1, 'A1', ctx.C.orange, v.id, { wave: true, seed: 60 + k });
            S.voice.push(c);
            ctx.reveal(c, { from: 'right', delay: 1700 + n * 250, dist: 60 });
          });
          /* bottom: forced alignment of N1 */
          var B = strip(ctx, 'FORCED ALIGNMENT · N1 word timestamps → captions + cut points', 'orange');
          var words = [['Twelve', 0.40, 0.78], ['hours', 0.80, 1.18], ['after', 1.25, 1.55], ['impact,', 1.60, 2.15], ['the', 2.55, 2.70], ['ice', 2.72, 3.05], ['began', 3.10, 3.46], ['to', 3.48, 3.60], ['sing.', 3.62, 4.20]];
          function wx2(t) { return BX + 40 + (t - 0.4) / 3.8 * 900; }
          ctx.path(waveD(ctx, wx2(0.4), 900, BY + 110, 20, 77, function (u) {
            var t = 0.4 + u * 3.8, e = 0.08;
            words.forEach(function (w) { if (t >= w[1] && t <= w[2]) e = 0.4 + 0.6 * Math.sin(Math.PI * (t - w[1]) / (w[2] - w[1])); });
            return e;
          }), { stroke: ctx.alpha('orange', 0.7), sw: 1.2, parent: B });
          var chips = words.map(function (w, k) {
            var g = ctx.group({ parent: B });
            var x0 = wx2(w[1]), ww2 = wx2(w[2]) - x0;
            ctx.rect(x0, BY + 44, ww2, 28, { rx: 4, fill: ctx.alpha('cyan', 0.12), stroke: ctx.alpha('cyan', 0.7), sw: 1, parent: g });
            ctx.text(x0 + ww2 / 2, BY + 58, w[0], { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: g });
            ctx.line(x0, BY + 76, x0, BY + 138, { color: ctx.alpha('cyan', 0.25), sw: 1, dash: '2 3', parent: g });
            return g;
          });
          ctx.text(wx2(2.35), BY + 58, 'pause 0.4 s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          for (var t = 0.5; t <= 4.2; t += 0.5) ctx.text(wx2(t), BY + 148, t.toFixed(1) + 's', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          ctx.reveal(chips, { from: 'down', stagger: 110, delay: 900 });
          ctx.hud('voice clone from 6 s of the memo');
          return ctx.wait(1400).then(function () { return ctx.packet(l3, { color: 'orange', dur: 600 }); }).then(function () { return ctx.wait(1400); });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Score & sound design',
        say: 'Next, the music and the sound. The music model receives a cue sheet: ninety six beats per minute, a minor key, and a build that peaks exactly at the crash, fifteen seconds in. At that tempo one beat lasts fifteen frames, so every cut can land on a beat. Sound effects come from a video to audio model that watches each shot and places the alarm, the whoosh and the impact on the right frame. Under every spoken line, the music ducks by about ten decibels.',
        deep: '<p><b>Score</b>: a latent-diffusion audio model (Stable Audio class: DiT over a VAE latent at ≈21.5 Hz, 44.1 kHz stereo, with <i>timing conditioning</i> seconds_start / seconds_total) or a codec LM (MusicGen: EnCodec 32 kHz, 4 codebooks at 50 Hz, delay-pattern decoding). The cue sheet pins tempo and the hit point.</p>' +
          '<div class="eq">beat = 60 / 96 = 0.625 s = 15 frames @ 24 fps  ·  bar = 60 f  ·  HIT = beat 24 = 15.0 s</div>' +
          '<p><b>Foley</b>: video-to-audio (MMAudio: flow matching, joint audio–video–text training, Synchformer features at 24 fps for frame-level sync) generates per-shot effects that follow on-screen motion. Veo 3-class models can instead emit audio jointly with the video.</p>' +
          '<p><b>Ducking</b> is a sidechain compressor: A1 (voice) drives gain reduction on A2 (music).</p>' +
          '<div class="eq">g(t) = −10 dB · s(t),  s: attack 80 ms, release 400 ms</div>' +
          '<p>Stems stay separate until the final mix so the editor can re-time any of them without re-generating audio.</p>',
        run: function (ctx) {
          var S = ctx.state;
          stage(ctx, 0);
          var G = panel(ctx, 'SCORE + SFX · cue sheet → models', 'orange');
          var cue = ctx.code({ x: IX + 12, y: IY + 42, w: IW - 24, title: 'cue.json', lang: 'json', size: 12, color: 'orange', parent: G, lines: [
            '{"bpm": 96, "key": "D minor", "len_s": 30,',
            ' "arc": "sparse > build > HIT@15.0 > resolve",',
            ' "stems": ["strings", "synth", "perc"],',
            ' "model": "latent DiT audio, 44.1 kHz"}'] });
          ctx.text(IX + 14, IY + 186, '60 / 96 = 0.625 s per beat = 15 frames', { size: 12, font: 'mono', color: 'white', parent: G });
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
          ctx.reveal(cue, { from: 'up', delay: 200 });
          ctx.reveal(rows, { from: 'left', stagger: 140, delay: 800 });
          /* beat grid */
          for (var b = 0; b <= 48; b++) {
            var down = b % 4 === 0;
            ctx.line(tx(b * 0.625), 466, tx(b * 0.625), 680, { color: down ? ctx.alpha('orange', 0.28) : 'rgba(255,255,255,0.06)', sw: 1, parent: S.grid });
          }
          ctx.reveal(S.grid, { delay: 300 });
          /* music + sfx clips */
          S.music = clip(ctx, S.clips, 0, 30, 'A2', ctx.C.orange, 'A2 · score 96 BPM', { wave: true, seed: 91, env: function (u) {
            var t = u * 30; return t < 15 ? 0.25 + 0.6 * t / 15 : (t < 16.5 ? 1 : 0.5 - 0.25 * (t - 16.5) / 13.5);
          } });
          ctx.reveal(S.music, { from: 'left', delay: 500 });
          S.sfx = SFX.map(function (e, k) {
            var c = clip(ctx, S.clips, e[0], e[1], 'A3', k === 2 ? ctx.C.amber : ctx.C.orange, e[2], { fillA: 0.14 });
            ctx.reveal(c, { from: 'down', delay: 900 + k * 150 });
            return c;
          });
          /* ducking curve over A2 */
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
          ctx.reveal(S.duck, { from: 'draw', dur: 1400, delay: 1500 });
          /* bottom: gain automation */
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
          ctx.reveal(pl.curve, { from: 'draw', dur: 1400, delay: 700 });
          ctx.hud('1 beat = 0.625 s = 15 frames');
          return ctx.wait(2900);
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Lip-sync',
        say: 'In shot two the fox speaks on screen: mayday, hull breach. The video model animated a mouth, but not these exact syllables. A lip sync model repairs that locally. It masks the lower half of the face in every frame and regenerates only that region, with a latent diffusion model conditioned on audio features and on a reference frame of the fox. A SyncNet style expert then measures the offset between sound and lips. Before the fix, confidence is weak and peaks three frames late. After it, a sharp peak sits at zero.',
        deep: '<p><b>LatentSync</b> (2024): Stable-Diffusion-style U-Net in VAE latent space; inputs per 16-frame window = masked target latents ‖ reference-frame latents ‖ noise; Whisper encoder features of the aligned audio enter through cross-attention. Trained with a SyncNet loss in pixel space plus TREPA (temporal representation alignment) against flicker. Lineage: <b>Wav2Lip</b> (2020) used a frozen SyncNet expert as a discriminator.</p>' +
          '<p><b>SyncNet metric</b>: a 0.2 s audio window and a 5-frame mouth crop are embedded; distances are computed for offsets δ ∈ [−15, 15] frames.</p>' +
          '<div class="eq">LSE-D = min<sub>δ</sub> d(δ)   LSE-C = median<sub>δ</sub> d(δ) − min<sub>δ</sub> d(δ)</div>' +
          '<p>Low LSE-D and high LSE-C (≈7–8 for real talking-head footage) mean tight sync; argmin δ is the AV offset, which must be 0 ±1 frame (humans notice ≈45 ms audio-lead).</p>' +
          '<div class="note">Stylised faces break landmark detectors. For the fox, the mask comes from the generator\'s own segmentation track (e.g. SAM 2 propagated through the shot). Joint audio-video generators (Veo 3 class) avoid the patch, but any later line change still needs lip-sync.</div>',
        run: function (ctx) {
          var S = ctx.state;
          stage(ctx, 0);
          var G = panel(ctx, 'LIP-SYNC · shot S2 · audio-conditioned inpainting', 'orange');
          var fx = IX + 130, fy = IY + 170;
          var fox = foxHead(ctx, G, fx, fy, 0.95);
          var mask = ctx.rect(fx - 70, fy + 6, 140, 70, { rx: 6, stroke: 'magenta', sw: 1.6, dash: '5 4', fill: ctx.alpha('magenta', 0.08), parent: G });
          ctx.text(fx, fy + 108, 'mask: lower face', { size: 11, font: 'mono', color: 'magenta', anchor: 'middle', parent: G });
          var chainL = ['face track + mask (SAM 2)', 'VAE encode · 8× down', 'denoise ⟵ Whisper audio', 'VAE decode · feather paste'];
          var chain = chainL.map(function (s, k) {
            return ctx.node({ x: IX + 356, y: IY + 72 + k * 58, w: 206, h: 40, title: s, color: k === 2 ? 'violet' : 'orange', kind: 'chip', titleSize: 11.5, glow: false, parent: G });
          });
          var cl = [];
          for (var k = 0; k < 3; k++) cl.push(ctx.link(chain[k], chain[k + 1], { color: 'dim', straight: true, parent: G }));
          /* audio bars for D1 */
          var r = ctx.rng(5), env = [];
          for (var i = 0; i < 26; i++) env.push(0.15 + 0.85 * Math.abs(Math.sin(i * 0.9)) * (0.5 + 0.5 * r()));
          ctx.text(IX + 14, IY + 300, 'D1 audio · "Mayday. Hull breach." · 2.6 s', { size: 12, font: 'mono', color: 'orange', parent: G });
          var bars = ctx.bars(IX + 14, IY + 312, IW - 28, 60, env, { color: 'orange', gap: 4, parent: G });
          var head = ctx.line(IX + 14, IY + 308, IX + 14, IY + 376, { color: 'white', sw: 2, parent: G, glow: true });
          ctx.text(IX + 14, IY + 400, '16-frame windows · ref frame keeps identity', { size: 11, font: 'mono', color: 'dim', parent: G });
          ctx.text(IX + 14, IY + 420, 'only the masked latents are regenerated', { size: 11, font: 'mono', color: 'dim', parent: G });
          ctx.reveal(mask, { from: 'scale', delay: 400 });
          ctx.reveal(chain, { from: 'right', stagger: 150, delay: 500 });
          ctx.reveal(cl, { from: 'draw', stagger: 150, delay: 900 });
          /* mouth follows the audio envelope */
          S.lip = ctx.loop(function (t) {
            var u = (t % 2.6) / 2.6, idx = Math.min(25, Math.floor(u * 26));
            fox.mouth.setAttribute('ry', (2 + 13 * env[idx]).toFixed(2));
            var x = IX + 14 + u * (IW - 28);
            head.setAttribute('x1', x); head.setAttribute('x2', x);
          });
          /* D1 on the timeline */
          var v = VOICE[1];
          S.d1 = clip(ctx, S.clips, v.t0, v.t1, 'A1', ctx.C.orange, v.id, { wave: true, seed: 71, dash: '4 3' });
          ctx.reveal(S.d1, { from: 'right', delay: 800, dist: 60 });
          /* bottom: SyncNet confidence */
          var B = strip(ctx, 'SYNCNET OFFSET SEARCH · confidence vs audio-video offset (frames)', 'orange');
          var px0 = BX + 70, pw = 560, py0 = BY + 34, ph = 108;
          var before = ctx.plot(px0, py0, pw, ph, function (x) { return 2 + 2.2 * Math.exp(-Math.pow((x - 3) / 4.5, 2)) + 0.35 * Math.sin(x * 1.7); }, { xDomain: [-15, 15], yDomain: [0, 11], color: 'dim', sw: 1.6, samples: 120, parent: B });
          var after = ctx.plot(px0, py0, pw, ph, function (x) { return 1.6 + 8.2 * Math.exp(-Math.pow(x / 1.3, 2)) + 0.25 * Math.sin(x * 2.1); }, { xDomain: [-15, 15], yDomain: [0, 11], color: 'lime', sw: 2.2, samples: 160, axes: false, parent: B, glow: true });
          var z = before.toPx(0, 0);
          ctx.line(z.x, py0, z.x, py0 + ph, { color: 'faint', dash: '3 4', parent: B });
          [-15, -10, -5, 0, 5, 10, 15].forEach(function (o) { ctx.text(before.toPx(o, 0).x, py0 + ph + 12, (o > 0 ? '+' : '') + o, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B }); });
          var p3 = before.toPx(3, 4.2);
          ctx.text(p3.x + 10, p3.y - 6, 'before: +3 f', { size: 11, font: 'mono', color: 'dim', parent: B });
          var p0 = after.toPx(0, 9.8);
          ctx.text(p0.x + 12, p0.y + 4, 'after: 0 f', { size: 11, font: 'mono', color: 'lime', parent: B });
          var stats = ctx.para(BX + 680, BY + 52, nb(['before  LSE-C 2.1  LSE-D 10.4', 'after   LSE-C 8.0  LSE-D 6.6', 'gate: |offset| ≤ 1 frame', '      LSE-C ≥ 6']), { size: 12, font: 'mono', color: 'text', lh: 22, parent: B });
          /* hidden until the camera pulls back from the close-up, then drawn in view */
          after.curve.setAttribute('opacity', 0);
          stats.setAttribute('opacity', 0);
          ctx.hud('offset +3 f → 0 f (1 f = 41.7 ms)');
          return ctx.camera(1084, 640, 1.55, 1100).then(function () { return ctx.wait(2000); }).then(function () { return ctx.camera(null, null, null, 900); }).then(function () {
            return Promise.all([ctx.reveal(after.curve, { from: 'draw', dur: 1200 }), ctx.reveal(stats, { delay: 500 })]);
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Edit decision list',
        say: 'Now the editor agent. It watches low resolution proxies of every shot, reads the script timings and the beat grid, and writes an edit decision list. That is structured JSON with clip URIs, in and out points in frames, transitions, audio tracks and captions. It is emitted as a tool call and validated against a schema, so a malformed edit can never reach the renderer. Watch the cuts snap to the beat grid. The third cut moves seven frames earlier to land on a beat.',
        deep: '<p>The editor is an LLM agent with tools: <code>get_proxy(shot, fps=2)</code> (captioned keyframes via the vision encoder), <code>get_alignment(line)</code>, <code>get_beats()</code>, <code>submit_edl(edl)</code>. Its output is <b>data</b>, validated before any GPU is scheduled.</p>' +
          '<pre>validate(edl):\n  0 ≤ in &lt; out ≤ src_frames        # 121\n  Σ(out − in) == dur_f               # 720\n  xfade f ≤ 2·min(handle_a, handle_b)\n  cut % 15 == 0   (beat grid, soft)\n  uris resolvable, captions ≤ 42 chars\non error → typed errors → agent repairs (≤ 3)</pre>' +
          '<p>Durations: 105 + 120 + 90 + 105 + 120 + 120 + 60 = 720 frames. The S3→S4 dissolve is centred on cut 315 and consumes 6-frame handles on each side (S3 has 11 spare frames after its out point, S4 has 8 before its in point), so total length is unchanged.</p>' +
          '<div class="note">Why an EDL instead of letting a model "render the edit"? It is inspectable, diffable, cheap to revise (re-render only touched segments), and exactly reproducible. It interoperates with NLEs via OpenTimelineIO / CMX 3600 / FCPXML adapters for a human editor to take over.</div>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.lip) S.lip.stop();
          stage(ctx, 1);
          if (S.insp) ctx.remove(S.insp, 300);
          var G = S.insp = ctx.group();
          var code = ctx.code({ x: IX, y: IY, w: IW, title: 'edl.json · tool_use: submit_edl', lang: 'json', size: 12, color: 'magenta', typing: true, maxLines: 18, parent: G, lines: nb([
            '{"edl": "1.2", "fps": "24/1", "dur_f": 720,',
            ' "video": [',
            '  {"uri": "s3://j7f3a/S1.mov", "in": 12, "out": 117},',
            '  {"uri": "s3://j7f3a/S2.mov", "in": 0, "out": 120},',
            '  {"uri": "s3://j7f3a/S3.mov", "in": 20, "out": 110,',
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
            ' "loudness_lufs": -14}']) });
          ctx.reveal(code, { from: 'right', dur: 400 });
          /* V1 clips */
          S.v1 = [];
          var off = (322 - 315) / 24 * PX;
          var labels = ['S1 approach', 'S2 cockpit', 'S3 re-entry', 'S4 impact', 'S5 emerge', 'S6 ice glow', 'TITLE'];
          var p = Promise.resolve();
          for (var i = 0; i < 7; i++) {
            (function (i) {
              var t0 = CUTS[i] / 24, t1 = CUTS[i + 1] / 24;
              var fill = i < 6 ? SHOTS[i].bg : '#05070c';
              var c = clip(ctx, S.clips, t0, t1, 'V1', i < 6 ? SHOTS[i].acc : ctx.C.white, labels[i], { fill: fill, textColor: 'white' });
              ctx.text(tx(t0) + 5, TR.V1.y + 33, i < 6 ? CUTS[i + 1] - CUTS[i] + ' f' : '60 f', { size: 11, font: 'mono', color: ctx.alpha('white', 0.65), parent: c });
              S.v1.push(c);
              /* the third cut is first proposed at 322 f and later snapped to the beat at 315 f */
              if (i === 2) c.bg.setAttribute('width', parseFloat(c.bg.getAttribute('width')) + off);
              if (i === 3) ctx.place(c, off, 0);
              ctx.reveal(c, { from: 'down', delay: 300 + i * 260, dur: 400 });
            })(i);
          }
          /* dissolve marker on the S3/S4 cut */
          var xc = tx(315 / 24);
          S.xf = ctx.poly([[xc - 8.7, TR.V1.y + 46], [xc, TR.V1.y + 30], [xc + 8.7, TR.V1.y + 46]], { fill: ctx.alpha('white', 0.35), stroke: 'white', parent: S.clips });
          ctx.reveal(S.xf, { delay: 1400 });
          var s3 = S.v1[2], s4 = S.v1[3];
          var w3 = parseFloat(s3.bg.getAttribute('width')) - off;
          S.snap = ctx.label(xc - 19, 440, 'snap −7 f', { color: 'amber', size: 11 });   /* sits between the 10 s and 15 s ruler labels */
          ctx.reveal(S.snap, { delay: 1500 });
          ctx.after(1700, function () {
            ctx.animate(s3.bg, { width: [w3 + off, w3] }, 500, 'back');
            ctx.transform(s4, { x: 0 }, 500, 'back');
          });
          /* captions */
          S.caps = VOICE.map(function (v, k) {
            var c = clip(ctx, S.clips, v.t0, v.t1, 'CAP', ctx.C.cyan, v.cap, { fillA: 0.12 });
            ctx.reveal(c, { from: 'fade', delay: 2200 + k * 150 });
            return c;
          });
          /* bottom: validator */
          var B = strip(ctx, 'EDL VALIDATOR · runs before any render is scheduled', 'magenta');
          var checks = ['JSON schema', '0 ≤ in < out ≤ 121', 'Σ dur = 720 f', 'xfade handles ≥ 6 f', 'cuts on beat grid', 'captions ≤ 42 chars', 'URIs resolve (HEAD)', 'A/V lengths equal'];
          S.chk = checks.map(function (c, k) {
            var col = k % 4, row = Math.floor(k / 4);
            return ctx.label(BX + 128 + col * 244, BY + 58 + row * 40, c, { color: 'dim', size: 12, w: 226, parent: B });
          });
          ctx.text(BX + 14, BY + 140, 'on failure: typed error list → back to the editor agent as a tool_result (≤ 3 repair turns)', { size: 12, font: 'mono', color: 'dim', parent: B });
          ctx.hud('Σ 105+120+90+105+120+120+60 = 720 f');
          return Promise.all([code.typeAll(), ctx.wait(2800)]).then(function () {
            return S.chk.reduce(function (pp, c, k) {
              return pp.then(function () {
                c.childNodes[0].setAttribute('stroke', ctx.C.lime);
                c.childNodes[0].setAttribute('fill', ctx.alpha('lime', 0.14));
                c.childNodes[1].setAttribute('fill', ctx.C.lime);
                return ctx.wait(120);
              });
            }, Promise.resolve());
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Deterministic assembly',
        say: 'The edit decision list is compiled, not interpreted by a model. A small compiler turns it into an ffmpeg filter graph. It trims and retimes each clip, cross fades the dissolve, applies the show look up table, overlays the title, and mixes three audio stems with side chain ducking. Loudness is normalized to minus fourteen LUFS integrated, with true peaks held under minus one decibel. Because the graph is a pure function of its inputs, the render is keyed by a hash, cached, and replayed exactly.',
        deep: '<pre>[0:v]trim=start_frame=12:end_frame=117,\n     setpts=PTS-STARTPTS[v0];  …\n[v2][v3]xfade=transition=fade:\n     duration=0.5:offset=3.5[v23];\n[vcat]lut3d=show_v2.cube[vg];\n[vg][t]overlay=enable=\'gte(n,660)\'[v];\n[1:a]asplit[a1][key];\n[2:a][key]sidechaincompress=ratio=6:\n     attack=80:release=400[duck];\n[a1][duck][3:a]amix=inputs=3:normalize=0,\n     loudnorm=I=-14:TP=-1:LRA=11[a]</pre>' +
          '<p><code>sidechaincompress</code> compresses its <i>first</i> input (the music) keyed by the <i>second</i> (the voice), so the voice is split: one copy is mixed, one drives the ducker.</p>' +
          '<p>The dissolve input S3 is trimmed with its 6-frame handle, [20, 116); S4 starts 6 frames early at source frame 2; offset = 309 − 225 = 84 f = 3.5 s.</p>' +
          '<p><b>Loudness</b> (ITU-R BS.1770-4/-5 / EBU R128): K-weighting (high-shelf + high-pass), mean square over 400 ms blocks (75 % overlap), absolute gate −70 LUFS, relative gate −10 LU:</p>' +
          '<div class="eq">L<sub>K</sub> = −0.691 + 10·log<sub>10</sub> Σ<sub>c</sub> G<sub>c</sub>·z<sub>c</sub></div>' +
          '<p>Targets: −14 LUFS (streaming platforms), −23 LUFS (EBU broadcast), −24 LKFS (ATSC A/85); true peak measured with 4× oversampling. Two passes: measure (I = −18.7 LUFS, TP = −3.2 dBTP), then apply a static gain of +4.7 dB. That alone would push the impact transient to −3.2 + 4.7 = +1.5 dBTP, so a look-ahead true-peak limiter takes 2.5 dB off those few peaks (ffmpeg <code>loudnorm</code> in <code>linear=true</code> mode would detect this and fall back to its dynamic mode).</p>' +
          '<div class="note">Render key = sha256(EDL ‖ input hashes ‖ ffmpeg build ‖ flags). With <code>-fflags +bitexact</code> and pinned versions the master is byte-identical on replay. The GPU path (NVDEC → CUDA compositor → NVENC) keeps frames in VRAM: 720 frames of 1080p composite in ≈3 s.</div>',
        run: function (ctx) {
          var S = ctx.state;
          stage(ctx, 2);
          if (S.snap) ctx.fade(S.snap, 0, 300);
          var G = panel(ctx, 'EDL → FFMPEG FILTER GRAPH', 'orange');
          var vc = ['decode 6 × S*.mov', 'trim + setpts', 'xfade dissolve 12 f', 'lut3d show_v2', 'overlay title + fade'];
          var ac = ['A1 · A2 · A3 stems', 'sidechaincompress', 'amix 3 → stereo', 'loudnorm −14 / −1', 'aresample 48 kHz'];
          function col(list, x, color) {
            return list.map(function (s, k) { return ctx.node({ x: x, y: IY + 62 + k * 46, w: 206, h: 32, title: s, color: color, kind: 'chip', titleSize: 11.5, glow: false, parent: G }); });
          }
          var vn = col(vc, IX + 121, 'lime'), an = col(ac, IX + 349, 'orange');
          var ls = [];
          for (var k = 0; k < 4; k++) {
            ls.push(ctx.link(vn[k], vn[k + 1], { color: 'lime', straight: true, parent: G }));
            ls.push(ctx.link(an[k], an[k + 1], { color: 'orange', straight: true, parent: G }));
          }
          var mux = ctx.node({ x: IX + IW / 2, y: IY + 300, w: 330, h: 40, title: 'mux → master.mov (ProRes 4444)', color: 'white', kind: 'box', titleSize: 13, glow: false, parent: G });
          var lm1 = ctx.link(vn[4], mux, { color: 'lime', from: 'b', to: 't', parent: G });
          var lm2 = ctx.link(an[4], mux, { color: 'orange', from: 'b', to: 't', parent: G });
          var key = ctx.para(IX + 14, IY + 352, ['key = sha256(EDL ‖ inputs ‖ ffmpeg 7.1 ‖ flags)', 'cache hit → reuse master, skip render', 'GPU path: NVDEC → CUDA → NVENC (VRAM)'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: G });
          ctx.reveal(vn.concat(an), { from: 'up', stagger: 60, delay: 200 });
          ctx.reveal(ls.concat([lm1, lm2]), { from: 'draw', stagger: 50, delay: 700 });
          ctx.reveal([mux, key], { delay: 1100, stagger: 200 });
          /* playhead render sweep */
          var ph = ctx.group({ parent: S.clips });
          var bar = ctx.rect(TX, RY - 4, 0.01, 4, { rx: 1, fill: 'lime', parent: ph });
          var line = ctx.line(TX, RY + 2, TX, 680, { color: 'white', sw: 2, parent: ph, glow: true });
          var ft = ctx.text(TX + 6, 684, 'f 0', { size: 11, font: 'mono', color: 'white', parent: ph });
          S.ph = ph;
          var sweep = ctx.tween(3200, function (t) {
            var x = tx(30 * t);
            bar.setAttribute('width', Math.max(0.01, x - TX).toFixed(1));
            line.setAttribute('x1', x); line.setAttribute('x2', x);
            ft.setAttribute('x', Math.min(x + 6, tx(30) - 48)); ft.textContent = 'f ' + Math.round(720 * t);
          }, 'linear', 900);
          /* bottom: loudness */
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
          ctx.reveal(curve.curve, { from: 'draw', dur: 1200, delay: 500 });
          ctx.hud('render key = sha256(EDL ‖ inputs ‖ build)');
          return ctx.wait(1900).then(function () {
            var d = 4.7 / 30 * ph2;
            return Promise.all([sweep, ctx.transform(cg, { y: -d }, 900, 'inOut'), ctx.counter(iv, -18.7, -14.0, 900, function (v) { return 'I  = ' + v.toFixed(1).replace('-', '−') + ' LUFS'; }),
              ctx.counter(tp, -3.2, -1.0, 900, function (v) { return 'TP = ' + v.toFixed(1).replace('-', '−') + ' dBTP'; })]);
          }).then(function () { ctx.hud('master: 720 f · I −14.0 LUFS · TP −1.0 dBTP'); });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Color, frames, pixels',
        say: 'Before encoding, the frames get polished. Six shots from separate diffusion runs drift in color, so each one is matched to a hero grade by transferring its color statistics, and then one look up table is applied to all of them. For a forty eight frames per second deliverable, a flow based interpolator like RIFE synthesizes the in between frames, never across a cut. A super resolution model lifts the seven twenty p renders to ten eighty p or four K. Finally an automated QC pass checks for flicker, frozen frames, clipping and sync drift.',
        deep: '<p><b>Shot matching</b> (Reinhard-style transfer in a decorrelated space, per channel):</p>' +
          '<div class="eq">x′ = (x − μ<sub>s</sub>) · σ<sub>t</sub>/σ<sub>s</sub> + μ<sub>t</sub></div>' +
          '<p>then a shared 33³ 3D LUT (the "show look"). Stats are computed on keyframes and smoothed across the shot to avoid pumping.</p>' +
          '<p><b>Interpolation</b> (RIFE): IFNet directly regresses intermediate flows and a fusion mask:</p>' +
          '<div class="eq">Î<sub>t</sub> = M ⊙ W(I<sub>0</sub>, F<sub>t→0</sub>) + (1 − M) ⊙ W(I<sub>1</sub>, F<sub>t→1</sub>)</div>' +
          '<p>Used for 24→48/60 fps deliverables, or 16→24 fps when a model generates at 16 fps (Wan 2.1); FILM handles large motion better. Never interpolate across a cut: split on EDL boundaries first.</p>' +
          '<p><b>Super-resolution</b>: Real-ESRGAN (RRDB, ~16.7 M params, trained with a high-order degradation model) for ×2/×4, or one-step diffusion VSR (e.g. SeedVR2-style) with temporal attention for fewer artifacts; tiles of 512² with 32 px overlap to bound VRAM.</p>' +
          '<p><b>QC</b>: black/freeze detection, temporal flicker ΔY, inter-shot ΔE<sub>00</sub>, true-peak, AV offset, caption safe-area, safety re-scan.</p>' +
          '<div class="note">Order in practice: matching, interpolation and SR run <i>per shot</i> on the EDL source ranges plus handles (cuts are known, so nothing blends across them). The step-6 graph is then re-executed on the enhanced segments at delivery resolution. The deterministic render key makes that second pass a cheap, cacheable recompute.</div>',
        run: function (ctx) {
          var S = ctx.state;
          stage(ctx, 3);
          if (S.ph) ctx.fade(S.ph, 0.35, 400);
          var G = panel(ctx, 'ENHANCE · grade · interpolate · upscale', 'orange');
          /* (a) color match */
          ctx.text(IX + 14, IY + 50, 'shot color match', { size: 12, font: 'mono', color: 'white', parent: G });
          ctx.text(IX + 14, IY + 82, 'target: hero S5', { size: 11, font: 'mono', color: 'dim', parent: G });
          var sw = [], sw2 = [];
          for (var i = 0; i < 6; i++) {
            sw.push(ctx.rect(IX + 190 + i * 44, IY + 38, 36, 24, { rx: 3, fill: SHOTS[i].bg, stroke: ctx.alpha(SHOTS[i].acc, 0.6), sw: 1, parent: G }));
            sw2.push(ctx.rect(IX + 190 + i * 44, IY + 70, 36, 24, { rx: 3, fill: SHOTS[i].bg, stroke: 'dim', sw: 1, parent: G }));
          }
          ctx.text(IX + 180, IY + 50, 'in', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          ctx.text(IX + 180, IY + 82, 'out', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          /* (b) interpolation */
          var by = IY + 120;
          ctx.text(IX + 14, by + 10, 'RIFE · flow-based interpolation', { size: 12, font: 'mono', color: 'white', parent: G });
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
          ctx.text(IX + 156, by + 52, 'F t→0', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: G });
          ctx.text(IX + 314, by + 52, 'F t→1', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: G });
          var ticks = ctx.group({ parent: G });
          for (var k = 0; k <= 12; k++) {
            var xk = IX + 20 + k * 24;
            ctx.line(xk, by + 122, xk, by + 136, { color: k % 2 ? 'lime' : 'dim', sw: k % 2 ? 2 : 1.5, parent: ticks });
          }
          ctx.text(IX + IW - 14, by + 129, '24 → 48 fps (×2)', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: ticks });
          /* (c) super-resolution */
          var sy = IY + 290;
          ctx.text(IX + 14, sy, 'super-resolution · tiles 512² + 32 px overlap', { size: 12, font: 'mono', color: 'white', parent: G });
          var r4 = ctx.rect(IX + 20, sy + 18, 192, 108, { rx: 3, stroke: 'lime', sw: 1.3, fill: ctx.alpha('lime', 0.05), parent: G });
          var r2 = ctx.rect(IX + 20, sy + 18, 96, 54, { rx: 3, stroke: 'cyan', sw: 1.3, fill: ctx.alpha('cyan', 0.06), parent: G });
          var r1 = ctx.rect(IX + 20, sy + 18, 64, 36, { rx: 3, stroke: 'orange', sw: 1.5, fill: ctx.alpha('orange', 0.12), parent: G });
          var srT = ctx.para(IX + 232, sy + 34, nb(['1280×720   render', '1920×1080  deliver (×1.5)', '3840×2160  4K master (×3)', 'Real-ESRGAN ×2/×4 or', 'one-step diffusion VSR']), { size: 12, font: 'mono', color: 'text', lh: 20, parent: G });
          ctx.reveal([f0, f1], { delay: 300, stagger: 100 });
          ctx.reveal(ft, { from: 'scale', delay: 800 });
          ctx.reveal([fa, fb], { from: 'draw', delay: 1000 });
          ctx.reveal(ticks, { delay: 1100 });
          ctx.reveal([r1, r2, r4], { from: 'scale', delay: 1300, stagger: 250 });
          ctx.reveal(srT, { delay: 1500 });
          /* color convergence on swatches + timeline clips */
          var target = GRADE;
          var cc = ctx.tween(1400, function (t) {
            for (var i = 0; i < 6; i++) {
              var c = ctx.mix(SHOTS[i].bg, target, 0.6 * t);
              sw2[i].setAttribute('fill', c);
              S.v1[i].bg.setAttribute('fill', c);
            }
          }, 'inOut', 500);
          /* bottom: QC gates */
          var B = strip(ctx, 'AUTOMATED QC · critic gates before encode', 'orange');
          var qc = ['black / freeze frames', 'temporal flicker ΔY', 'inter-shot ΔE00 < 3', 'true peak ≤ −1 dBTP', 'AV offset ≤ 1 frame', 'caption safe area', 'safety re-scan', 'no cut interpolated'];
          S.qc = qc.map(function (c, k) {
            var col = k % 4, row = Math.floor(k / 4);
            return ctx.label(BX + 128 + col * 244, BY + 58 + row * 40, c, { color: 'dim', size: 12, w: 226, parent: B });
          });
          ctx.text(BX + 14, BY + 140, 'failure → typed issue to the critic agent → targeted fix (re-grade, re-sync, re-render one shot)', { size: 12, font: 'mono', color: 'dim', parent: B });
          ctx.hud('720p → 1080p · 24 → 48 fps option · 1 LUT');
          return cc.then(function () {
            return S.qc.reduce(function (pp, c) {
              return pp.then(function () {
                c.childNodes[0].setAttribute('stroke', ctx.C.lime);
                c.childNodes[0].setAttribute('fill', ctx.alpha('lime', 0.14));
                c.childNodes[1].setAttribute('fill', ctx.C.lime);
                return ctx.wait(140);
              });
            }, Promise.resolve());
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Encode & deliver',
        say: 'Last, the master is encoded into an adaptive bitrate ladder, from ten eighty p at around four and a half megabits per second down to three sixty p under one megabit, on hardware encoders. Each rendition is cut into four second CMAF segments, described by HLS and DASH manifests, signed with C2PA content credentials, and pushed to the content delivery network. The player picks a rung from its buffer and bandwidth. Zoom into either chamber to see the audio models, or the codec and CDN machinery, in depth.',
        deep: '<table><tr><th>Rung</th><th>HEVC</th><th>AV1</th><th>H.264</th></tr>' +
          '<tr><td>1080p</td><td>4.5 Mb/s</td><td>3.2</td><td>7.0</td></tr>' +
          '<tr><td>720p</td><td>2.5</td><td>1.8</td><td>4.0</td></tr>' +
          '<tr><td>540p</td><td>1.4</td><td>1.0</td><td>2.2</td></tr>' +
          '<tr><td>360p</td><td>0.6</td><td>0.45</td><td>1.0</td></tr></table>' +
          '<p>Each codec generation saves roughly 30–50 % bitrate at equal quality (H.264 → HEVC ≈ 35–50 %, HEVC → AV1 ≈ 20–30 %; this table sits at the conservative end of both ranges); rungs are chosen per title from the convex hull of rate–quality curves (VMAF).</p>' +
          '<ul><li><b>Encode</b>: NVENC (Ada/Blackwell have AV1): several hundred 1080p fps per chip; GOP = 96 frames (4 s) closed, so every segment starts with an IDR.</li>' +
          '<li><b>Package</b>: CMAF fMP4 (init + moof/mdat), one set of segments referenced by both HLS <code>.m3u8</code> and DASH <code>.mpd</code>.</li>' +
          '<li><b>Provenance</b>: C2PA manifest (signed claim: generator, edits, AI assertions) bound by hash to the asset.</li>' +
          '<li><b>CDN</b>: origin → shield → edge, signed URLs with expiry, immutable segment names (content hash) so caches never need purging.</li></ul>' +
          '<div class="note">Critical path after the last shot: EDL ≈3 s · assembly ≈3 s · enhance ≈5 s (8 GPUs) · encode + package ≈3 s ≈ <b>14 s</b>.</div>',
        run: function (ctx) {
          var S = ctx.state;
          stage(ctx, 4, 5);
          var G = panel(ctx, 'ENCODE · PACKAGE · DELIVER', 'orange');
          var rungs = [['1080p', 4.5], ['720p', 2.5], ['540p', 1.4], ['360p', 0.6]];
          ctx.text(IX + 14, IY + 50, 'ABR ladder (HEVC, per-title)', { size: 12, font: 'mono', color: 'white', parent: G });
          var bars = rungs.map(function (r, k) {
            var g = ctx.group({ parent: G });
            var y = IY + 70 + k * 30;
            ctx.text(IX + 14, y + 10, r[0], { size: 12, font: 'mono', color: 'text', parent: g });
            var b = ctx.rect(IX + 70, y, r[1] / 4.5 * 250, 20, { rx: 3, fill: ctx.alpha('orange', 0.3 + 0.15 * (3 - k)), stroke: 'orange', sw: 1, parent: g });
            ctx.text(IX + 78 + r[1] / 4.5 * 250, y + 10, r[1] + ' Mb/s', { size: 11, font: 'mono', color: 'orange', parent: g });
            g.b = b;
            return g;
          });
          /* segments */
          var sy = IY + 206;
          ctx.text(IX + 14, sy, 'CMAF fMP4 · 4 s segments · GOP 96 f (closed)', { size: 12, font: 'mono', color: 'white', parent: G });
          var segs = [];
          segs.push(ctx.label(IX + 44, sy + 30, 'init', { color: 'cyan', size: 11, w: 52, parent: G }));
          for (var i = 0; i < 8; i++) segs.push(ctx.label(IX + 102 + i * 44, sy + 30, 's' + (i + 1), { color: 'orange', size: 11, w: 40, parent: G }));
          var man = ctx.para(IX + 14, sy + 64, ['master.m3u8 · manifest.mpd', 'C2PA manifest · signed · hash-bound'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: G });
          /* CDN */
          var cy = IY + 362;
          var org = ctx.node({ x: IX + 60, y: cy, w: 96, h: 36, title: 'origin', color: 'orange', kind: 'chip', titleSize: 12, glow: false, parent: G });
          var sh = ctx.node({ x: IX + 180, y: cy, w: 96, h: 36, title: 'shield', color: 'orange', kind: 'chip', titleSize: 12, glow: false, parent: G });
          var edges = [0, 1, 2].map(function (k) { return ctx.node({ x: IX + 310, y: cy - 50 + k * 50, w: 84, h: 30, title: 'edge', color: 'blue', kind: 'pill', titleSize: 12, glow: false, parent: G }); });
          var players = [0, 1, 2].map(function (k) { return ctx.icon(k === 1 ? 'globe' : 'phone', IX + 420, cy - 50 + k * 50, 24, 'cyan', { parent: G }); });
          var cl = [ctx.link(org, sh, { color: 'orange', straight: true, parent: G })];
          edges.forEach(function (e) { cl.push(ctx.link(sh, e, { color: 'orange', parent: G })); });
          var el2 = edges.map(function (e, k) { return ctx.link(e, { x: IX + 406, y: cy - 50 + k * 50 }, { color: 'cyan', straight: true, parent: G }); });
          ctx.reveal(bars, { from: 'left', stagger: 120, delay: 200 });
          ctx.reveal(segs, { from: 'fade', stagger: 60, delay: 700 });
          ctx.reveal(man, { delay: 1200 });
          ctx.reveal([org, sh].concat(edges), { from: 'scale', stagger: 100, delay: 1300 });
          ctx.reveal(cl.concat(el2), { from: 'draw', stagger: 60, delay: 1600 });
          ctx.reveal(players, { delay: 1800, stagger: 100 });
          /* bottom: summary + zoom pointers */
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
          var z1 = ctx.label(BX + 790, BY + 56, 'ZOOM ▸ Speech, Music & Lip-Sync', { color: 'orange', size: 12, w: 330 , parent: B});
          var z2 = ctx.label(BX + 790, BY + 100, 'ZOOM ▸ Compositing, Encoding & CDN', { color: 'orange', size: 12, w: 330, parent: B });
          ctx.reveal(gb, { from: 'left', stagger: 150, delay: 400 });
          ctx.reveal([z1, z2], { from: 'right', stagger: 150, delay: 1000 });
          ctx.hotspot(z1, 'tts-audio', { hint: '⤢' });
          ctx.hotspot(z2, 'render-delivery', { hint: '⤢' });
          ctx.hud('1080p HEVC 4.5 Mb/s ≈ 17 MB for 30 s');
          return ctx.wait(2100).then(function () {
            return Promise.all(el2.map(function (l, k) { return ctx.wait(k * 200).then(function () { return ctx.packet(l, { color: 'cyan', dur: 500 }); }); }));
          }).then(function () {
            return Promise.all([ctx.pulse(S.pn[0], { color: 'orange', times: 2, dur: 700 }), ctx.pulse(S.ghost, { color: 'orange', times: 2, dur: 700 })]);
          });
        }
      }
    ]
  });
})();
