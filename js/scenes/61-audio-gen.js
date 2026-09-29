/* L2 — Speech, Music & Lip-Sync. Generative audio for the trailer: text front-end, codec tokens, codec-LM
 * (AR + NAR) and flow-matching TTS, vocoders and streaming, zero-shot cloning with consent, music by
 * token LM vs latent diffusion, video-to-audio foley, and audio-driven lip-sync. */
(function () {
  /* ---------- tiny BMP encoder: one <image> instead of thousands of rects ---------- */
  var STOPS = [[0, [5, 7, 18]], [0.35, [64, 18, 84]], [0.6, [196, 58, 70]], [0.8, [255, 138, 61]], [1, [255, 232, 170]]];
  function cm(v) {
    v = v < 0 ? 0 : (v > 1 ? 1 : v);
    for (var i = 1; i < STOPS.length; i++) if (v <= STOPS[i][0]) {
      var a = STOPS[i - 1], b = STOPS[i], k = (v - a[0]) / (b[0] - a[0]);
      return [0, 1, 2].map(function (j) { return Math.round(a[1][j] + (b[1][j] - a[1][j]) * k); });
    }
    return STOPS[STOPS.length - 1][1];
  }
  function bmp(w, h, px) {
    var row = (w * 3 + 3) & ~3, size = 54 + row * h, b = new Uint8Array(size);
    function u32(o, v) { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; b[o + 3] = (v >>> 24) & 255; }
    b[0] = 66; b[1] = 77; u32(2, size); u32(10, 54); u32(14, 40); u32(18, w); u32(22, h); b[26] = 1; b[28] = 24; u32(34, row * h);
    for (var y = 0; y < h; y++) {
      var o = 54 + (h - 1 - y) * row;
      for (var x = 0; x < w; x++) { var c = px(x, y); b[o + x * 3] = c[2]; b[o + x * 3 + 1] = c[1]; b[o + x * 3 + 2] = c[0]; }
    }
    var s = '';
    for (var i = 0; i < size; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(size, i + 8192)));
    return 'data:image/bmp;base64,' + btoa(s);
  }
  function image(ctx, parent, uri, x, y, w, h) {
    return ctx.el('image', { href: uri, x: x, y: y, width: w, height: h, preserveAspectRatio: 'none', style: 'image-rendering:pixelated' }, parent);
  }

  /* ---------- deterministic synthetic speech (for mel images and waveforms) ---------- */
  function syllables(ctx, seed, dur) {
    var r = ctx.rng(seed), out = [], t = 0.15;
    while (t < dur - 0.2) {
      var L = 0.8 + r() * 1.6, end = Math.min(dur - 0.15, t + L);
      while (t < end) { out.push({ t: t, a: 0.5 + 0.5 * r(), v: r() }); t += 0.17 + r() * 0.12; }
      t += 0.25 + r() * 0.35;
    }
    return out;
  }
  function envAt(syl, t) {
    var e = 0, near = null, best = 9;
    for (var i = 0; i < syl.length; i++) {
      var d = t - syl[i].t;
      if (d > 0.3 || d < -0.3) continue;
      e += syl[i].a * Math.exp(-(d / 0.07) * (d / 0.07));
      if (Math.abs(d) < best) { best = Math.abs(d); near = syl[i]; }
    }
    return { e: Math.min(1.2, e), s: near };
  }
  function hzOfMel(m) { return 700 * (Math.pow(10, m / 2595) - 1); }
  var MELMAX = 2595 * Math.log(1 + 8000 / 700) / Math.LN10;
  /* log-mel value in [0,1] for 80 bins; b = 0 is the lowest band */
  function melVal(E, t, b, n) {
    var f = hzOfMel((b + 0.5) / 80 * MELMAX), floor = 0.08 + 0.05 * n;
    if (!E.s || E.e < 0.02) return floor;
    var f0 = 115 + 25 * Math.sin(t * 1.9) + 10 * E.s.v;
    var comb = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * f / f0), 6) * (f < 3500 ? 1 : 0.25) + 0.08;
    var F1 = 450 + 380 * E.s.v, F2 = 1150 + 1100 * ((E.s.v * 7.3) % 1);
    var form = Math.exp(-Math.pow((f - F1) / 220, 2)) + 0.7 * Math.exp(-Math.pow((f - F2) / 320, 2)) + 0.3 * Math.exp(-Math.pow((f - 2800) / 450, 2)) + 0.04;
    var P = E.e * comb * form / (1 + f / 1500);
    var dB = Math.log(1e-4 + P) / Math.LN10;          /* -4 .. ~0 */
    return Math.max(floor, (dB + 4) / 4.2);
  }
  function waveD(ctx, x0, w, cy, amp, seed, env) {
    var r = ctx.rng(seed), d = '';
    for (var x = 0; x <= w; x += 3) {
      var a = Math.max(0.6, amp * env(x / w) * (0.35 + 0.65 * r()));
      d += 'M' + (x0 + x).toFixed(1) + ',' + (cy - a).toFixed(1) + 'V' + (cy + a).toFixed(1);
    }
    return d;
  }
  function nb(lines) { return lines.map(function (s) { return s.replace(/^ +| {2,}/g, function (m) { return new Array(m.length + 1).join(' '); }); }); }
  function head(ctx, parent, x, y, s, col) { return ctx.text(x, y, s, { size: 13, font: 'mono', weight: 600, color: col || 'orange', parent: parent, spacing: 1 }); }
  function note(ctx, parent, x, y, s, col, anchor, size) { return ctx.text(x, y, s, { size: size || 12, font: 'mono', color: col || 'dim', anchor: anchor || 'start', parent: parent }); }
  function panelBox(ctx, parent, x, y, w, h, col) { return ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(7,12,24,0.88)', stroke: ctx.alpha(col || 'orange', 0.4), sw: 1.1, parent: parent }); }

  /* navigator chips (top right, below the HUD band) */
  var NAV = ['TTS', 'MUSIC', 'FOLEY', 'LIP-SYNC'];
  function nav(ctx, k) {
    var S = ctx.state;
    if (!S.nav) {
      S.nav = ctx.group();
      S.navChips = NAV.map(function (n, i) { return ctx.label(900 + i * 162, 112, n, { color: 'dim', size: 12, w: 148, parent: S.nav }); });
      ctx.reveal(S.nav, { dur: 400 });
    }
    S.navChips.forEach(function (c, i) {
      var on = i === k;
      c.childNodes[0].setAttribute('fill', on ? ctx.alpha('orange', 0.22) : 'rgba(123,140,171,0.08)');
      c.childNodes[0].setAttribute('stroke', on ? ctx.C.orange : ctx.alpha('dim', 0.5));
      c.childNodes[1].setAttribute('fill', on ? ctx.C.orange : ctx.C.dim);
    });
  }
  /* replace the step's main group with a fresh one */
  function stage(ctx) {
    var S = ctx.state;
    if (S.main) ctx.remove(S.main, 350);
    S.main = ctx.group();
    return S.main;
  }
  function turnGreen(ctx, chips, gap) {
    return chips.reduce(function (p, c) {
      return p.then(function () {
        c.childNodes[0].setAttribute('stroke', ctx.C.lime);
        c.childNodes[0].setAttribute('fill', ctx.alpha('lime', 0.14));
        c.childNodes[1].setAttribute('fill', ctx.C.lime);
        return ctx.wait(gap || 160);
      });
    }, Promise.resolve());
  }

  Atlas.register({
    id: 'tts-audio',
    refs: [
      'Wang et al., <i>Neural Codec Language Models are Zero-Shot Text to Speech Synthesizers (VALL-E)</i>, 2023; Chen et al., <i>VALL-E 2</i>, 2024',
      'Le et al., <i>Voicebox: Text-Guided Multilingual Universal Speech Generation at Scale</i>, NeurIPS 2023; Chen et al., <i>F5-TTS: A Fairytaler that Fakes Fluent and Faithful Speech with Flow Matching</i>, 2024',
      'Du et al., <i>CosyVoice 2: Scalable Streaming Speech Synthesis with Large Language Models</i>, 2024',
      'Kong et al., <i>HiFi-GAN</i>, NeurIPS 2020; Siuzdak, <i>Vocos: Closing the Gap Between Time-Domain and Fourier-Based Neural Vocoders</i>, ICLR 2024',
      'Copet et al., <i>Simple and Controllable Music Generation (MusicGen)</i>, NeurIPS 2023; Evans et al., <i>Fast Timing-Conditioned Latent Audio Diffusion</i>, ICML 2024',
      'Cheng et al., <i>MMAudio: Taming Multimodal Joint Training for High-Quality Video-to-Audio Synthesis</i>, CVPR 2025',
      'Li et al., <i>LatentSync</i>, 2024; Prajwal et al., <i>A Lip Sync Expert Is All You Need (Wav2Lip)</i>, ACM MM 2020; Chung &amp; Zisserman, <i>Out of Time (SyncNet)</i>, ACCV-W 2016',
      'San Roman et al., <i>Proactive Detection of Voice Cloning with Localized Watermarking (AudioSeal)</i>, ICML 2024'
    ],
    setup: function (ctx) {
      var S = ctx.state;
      S.sylP = syllables(ctx, 31, 6.0);   /* memo speaker prompt, 6 s (memo 12-18 s) */
      S.sylT = syllables(ctx, 57, 3.8);   /* generated N1, 3.8 s (timeline 0.4-4.2 s) */
    },
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Four audio jobs',
        say: 'This chamber is the sound department. Four generative jobs run on the audio GPU pool while the video shots are still rendering. Text to speech speaks the script in the creator\'s cloned voice. A music model writes a thirty second score to a cue sheet. A video to audio model watches each shot and invents synchronized sound effects. And a lip sync model repaints the fox\'s mouth for the one line it speaks on screen. All four return stems that the editor agent places on the timeline.',
        deep: '<p>Four different generative problems, one output contract: time-stamped audio stems (or one patched video shot) referenced by URI.</p>' +
          '<table><tr><th>Job</th><th>Condition</th><th>Model family (2025)</th></tr>' +
          '<tr><td>TTS</td><td>text + 3–10 s speaker prompt</td><td>codec LM (VALL-E, CosyVoice 2), flow matching (F5-TTS, E2)</td></tr>' +
          '<tr><td>Music</td><td>text cue, tempo, duration</td><td>codec LM (MusicGen), latent diffusion (Stable Audio)</td></tr>' +
          '<tr><td>Foley</td><td>video frames + text</td><td>video-to-audio flow matching (MMAudio); joint A/V generators (Veo 3)</td></tr>' +
          '<tr><td>Lip-sync</td><td>face video + speech</td><td>audio-conditioned latent inpainting (LatentSync)</td></tr></table>' +
          '<p>All four are small next to the video DiT: seconds of GPU per stem, so they sit <b>off the critical path</b>, overlapping shot rendering. The shared design pattern: compress audio into a low-rate representation (codec tokens, mel frames or VAE latents), generate there, then decode back to a 24–48 kHz waveform.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          var lanes = [
            { ins: [['script lines', 'amber'], ['memo · 6 s prompt', 'orange']], t: 'Zero-shot TTS', s: 'codec LM · flow matching', ic: 'mic', out: 'narration · 48 kHz mono' },
            { ins: [['cue sheet · 96 BPM', 'amber']], t: 'Music generator', s: 'token LM · latent DiT', ic: 'music', out: 'score · 30 s · stereo' },
            { ins: [['shot frames S1–S6', 'lime'], ['text: "alarm, impact"', 'amber']], t: 'Video-to-audio', s: 'MMAudio-class · flow', ic: 'film', out: 'foley · 5 events' },
            { ins: [['S2 frames (face)', 'lime'], ['D1 audio', 'orange']], t: 'Lip-sync', s: 'latent inpainting', ic: 'eye', out: 'S2 patched · mouth only' }
          ];
          S.lanes = [];
          lanes.forEach(function (L, i) {
            var y = 240 + i * 150;
            var g = ctx.group({ parent: G });
            var chips = L.ins.map(function (c, k) { return ctx.label(210, y + (L.ins.length === 1 ? 0 : (k ? 20 : -20)), c[0], { color: c[1], size: 12, w: 230, parent: g }); });
            var n = ctx.node({ x: 640, y: y, w: 320, h: 72, title: L.t, sub: L.s, icon: L.ic, color: 'orange', titleSize: 17, subSize: 12, parent: g });
            chips.forEach(function (c, k) { ctx.line(328, y + (L.ins.length === 1 ? 0 : (k ? 20 : -20)), 476, y, { color: ctx.alpha('orange', 0.6), arrow: true, parent: g }); });
            ctx.line(804, y, 900, y, { color: 'orange', arrow: true, parent: g });
            /* outputs */
            var o = ctx.group({ parent: g });
            if (i === 0) ctx.path(waveD(ctx, 910, 400, y, 22, 5, function (u) { return (u < 0.3 || (u > 0.38 && u < 0.66) || u > 0.72) ? 0.3 + 0.7 * Math.abs(Math.sin(u * 40)) : 0.03; }), { stroke: 'orange', sw: 1.3, parent: o });
            if (i === 1) {
              ctx.path(waveD(ctx, 910, 400, y - 13, 10, 8, function (u) { return u < 0.5 ? 0.3 + 0.7 * u * 2 : (u < 0.55 ? 1 : 0.5); }), { stroke: 'orange', sw: 1.1, parent: o });
              ctx.path(waveD(ctx, 910, 400, y + 13, 10, 9, function (u) { return u < 0.5 ? 0.3 + 0.7 * u * 2 : (u < 0.55 ? 1 : 0.5); }), { stroke: ctx.alpha('orange', 0.7), sw: 1.1, parent: o });
            }
            if (i === 2) [[0.0, 0.16], [0.18, 0.3], [0.37, 0.43], [0.46, 0.62], [0.66, 1]].forEach(function (e, k) {
              ctx.rect(910 + e[0] * 400, y - 14, (e[1] - e[0]) * 400 - 3, 28, { rx: 4, fill: ctx.alpha(k === 2 ? 'amber' : 'orange', 0.25), stroke: k === 2 ? 'amber' : 'orange', sw: 1, parent: o });
            });
            if (i === 3) for (var m = 0; m < 8; m++) {
              var mx = 930 + m * 50;
              ctx.rect(mx - 20, y - 22, 40, 44, { rx: 4, fill: '#3a1020', stroke: ctx.alpha('orange', 0.6), sw: 1, parent: o });
              ctx.el('ellipse', { cx: mx, cy: y + 8, rx: 8, ry: 1.5 + 6 * Math.abs(Math.sin(m * 1.3)), fill: '#1a0508', stroke: '#ffb070', 'stroke-width': 1 }, o);
            }
            note(ctx, g, 1330, y, L.out, 'text');
            ctx.line(1506, y, 1541, y, { color: ctx.alpha('orange', 0.6), arrow: true, parent: g });
            ctx.reveal(g, { from: 'left', delay: i * 350, dur: 600 });
            S.lanes.push(g);
          });
          var bus = ctx.line(1545, 200, 1545, 770, { color: ctx.alpha('orange', 0.5), sw: 2, parent: G });
          ctx.text(1532, 800, 'stems → editor agent (EDL)', { size: 12, font: 'mono', color: 'orange', anchor: 'end', parent: G });
          ctx.text(80, 842, 'all four run on the audio GPU pool in parallel with shot rendering: seconds of GPU each, off the critical path', { size: 13, font: 'mono', color: 'dim', parent: G });
          ctx.reveal(bus, { from: 'draw', delay: 1400 });
          ctx.hud('4 jobs · stems by URI · off the critical path');
          return ctx.wait(2200);
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Text & audio tokens',
        say: 'Zoom into speech. Both sides must become tokens. The text is normalized, so numbers and abbreviations are spelled out, and optionally converted to phonemes. The audio side needs a neural codec. An encoder squeezes twenty four kilohertz audio into seventy five frames per second, and residual vector quantization describes each frame with eight codebook indices. The first codebook captures most of the signal; each later one encodes what the previous ones missed. Three point eight seconds of narration becomes about two thousand three hundred tokens.',
        deep: '<p><b>Text front-end</b>: normalisation (numbers, units, abbreviations), then either G2P phonemes (VALL-E, Voicebox) or raw characters/BPE (F5-TTS, E2, CosyVoice), letting the model learn pronunciation.</p>' +
          '<p><b>Codec</b> (EnCodec 24 kHz, as in VALL-E): strided conv encoder with total stride 320 → 75 frames/s; RVQ with 8 codebooks × 1024 entries (10 bits) → 75 × 80 bits = 6 kbps.</p>' +
          '<div class="eq">r<sub>0</sub> = z,   q<sub>k</sub> = argmin<sub>c∈C<sub>k</sub></sub> ‖r<sub>k−1</sub> − c‖,   r<sub>k</sub> = r<sub>k−1</sub> − q<sub>k</sub>,   ẑ = Σ<sub>k</sub> q<sub>k</sub></div>' +
          '<p>Coarse-to-fine: q<sub>1</sub> carries content and much of speaker identity; q<sub>2..8</sub> add acoustic detail. Training uses quantizer dropout so any prefix of codebooks decodes.</p>' +
          '<table><tr><th>Codec</th><th>Rate</th><th>Tokens/s</th></tr>' +
          '<tr><td>EnCodec 24k (8 q)</td><td>75 Hz</td><td>600</td></tr>' +
          '<tr><td>DAC 44k (9 q)</td><td>86 Hz</td><td>774</td></tr>' +
          '<tr><td>Mimi (Moshi, 8 q)</td><td>12.5 Hz</td><td>100</td></tr>' +
          '<tr><td>CosyVoice 2 semantic (1 q)</td><td>25 Hz</td><td>25</td></tr></table>' +
          '<p>Narration line N1: 3.8 s × 75 = 285 frames × 8 = 2,280 tokens. Lower frame rates shorten LM sequences, which is why 2025 systems moved to 12.5–25 Hz tokens.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          head(ctx, G, 80, 185, 'TEXT FRONT-END');
          var sent = ctx.text(80, 222, '"Twelve hours after impact, the ice began to sing."', { size: 22, font: 'display', weight: 600, color: 'white', parent: G });
          var words = ['twelve', 'hours', 'after', 'impact', 'the', 'ice', 'began', 'to', 'sing'];
          var ipa = ['twɛlv', 'aʊɚz', 'æftɚ', 'ɪmpækt', 'ðə', 'aɪs', 'bɪɡæn', 'tə', 'sɪŋ'];
          var wx = 80, wc = [], pc = [];
          words.forEach(function (w, i) {
            var ww = Math.max(52, ipa[i].length * 10 + 26);
            wc.push(ctx.label(wx + ww / 2, 270, w, { color: 'amber', size: 12, w: ww - 6, parent: G }));
            pc.push(ctx.label(wx + ww / 2, 316, ipa[i], { color: 'orange', size: 13, w: ww - 6, font: 'mono', parent: G }));
            wx += ww;
          });
          note(ctx, G, wx + 14, 270, 'normalised', 'dim');
          note(ctx, G, wx + 14, 316, 'G2P phonemes', 'dim');
          var alt = ctx.para(1000, 190, nb(['two front-ends in 2025:', '· phonemes (VALL-E, Voicebox)', '· raw chars / BPE (F5-TTS, E2,', '  CosyVoice): pronunciation is learned']), { size: 13, font: 'mono', color: 'text', lh: 21, parent: G });
          ctx.reveal(sent, { from: 'up' });
          ctx.reveal(wc, { from: 'down', stagger: 60, delay: 300 });
          ctx.reveal(pc, { from: 'down', stagger: 60, delay: 700 });
          ctx.reveal(alt, { delay: 900 });
          /* codec */
          panelBox(ctx, G, 60, 370, 1500, 480, 'orange');
          head(ctx, G, 80, 395, 'NEURAL CODEC · EnCodec 24 kHz · stride 320 → 75 frames/s · RVQ 8 × 1024');
          var wv = ctx.path(waveD(ctx, 150, 560, 450, 26, 12, function (u) { return envAt(S.sylT, u * 0.4 + 0.2).e * 0.9 + 0.08; }), { stroke: 'orange', sw: 1.2, parent: G });
          note(ctx, G, 150, 492, '0.4 s of N1 · 9,600 samples', 'dim');
          var enc = ctx.node({ x: 430, y: 530, w: 300, h: 40, title: 'conv encoder · 4 strided blocks (2·4·5·8)', color: 'violet', kind: 'chip', titleSize: 12, glow: false, parent: G });
          var l1 = ctx.line(430, 480, 430, 508, { color: 'violet', arrow: true, parent: G });
          /* RVQ grid 8 x 30 */
          var r = ctx.rng(4);
          var vals = []; for (var q = 0; q < 8; q++) { vals.push([]); for (var c = 0; c < 30; c++) vals[q].push(r()); }
          var grid = ctx.matrix(150, 580, 8, 30, { cell: 20, gap: 3, values: function () { return '#0d1424'; }, rowLabels: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'], parent: G });
          note(ctx, G, 150, 780, '30 frames (0.4 s) × 8 codebook indices (0…1023) = 240 tokens', 'text');
          var l2 = ctx.line(430, 551, 430, 574, { color: 'violet', arrow: true, parent: G });
          /* residual norms */
          var norms = [1, 0.56, 0.38, 0.28, 0.21, 0.17, 0.14, 0.12];
          note(ctx, G, 890, 572, '‖r_k‖ after stage k', 'dim');
          var nb2 = ctx.bars(890, 590, 240, 160, norms.map(function () { return 0.01; }), { color: 'orange', gap: 8, labels: ['1', '2', '3', '4', '5', '6', '7', '8'], parent: G });
          /* math panel */
          var mp = ctx.para(1180, 440, nb(['N1 = 3.8 s', '× 75 frames/s   = 285 frames', '× 8 codebooks   = 2,280 tokens', '', 'bitrate: 75 × 8 × 10 bit = 6 kbps', '', 'Mimi 12.5 Hz × 8   = 100 tok/s', 'CosyVoice 2 25 Hz × 1 = 25 tok/s']), { size: 14, font: 'mono', color: 'text', lh: 26, parent: G });
          ctx.reveal([wv], { from: 'draw', delay: 900, dur: 900 });
          ctx.reveal([l1, enc, l2], { delay: 1300, stagger: 150 });
          ctx.reveal(mp, { delay: 1500 });
          ctx.hud('3.8 s → 285 frames × 8 q = 2,280 tokens');
          /* fill grid row by row: each residual stage quantises what the previous missed */
          return ctx.wait(1700).then(function () {
            return ctx.tween(2400, function (t) {
              var rows = t * 8;
              for (var q = 0; q < 8; q++) for (var c = 0; c < 30; c++) {
                var on = rows > q + c / 30;
                grid.cells[q][c].setAttribute('fill', on ? ctx.mix('#2a1406', q ? ctx.C.orange : ctx.C.amber, (0.35 + 0.65 * vals[q][c]) * (1 - q * 0.07)) : '#0d1424');
              }
            }, 'linear');
          }).then(function () { return nb2.update(norms, 700); });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Codec language model',
        say: 'Now a codec language model, VALL-E style. The creator\'s prompt, its transcript, and the target text form a prefix. An autoregressive transformer then predicts the first codebook one frame at a time, which fixes content, rhythm and timbre. The remaining seven codebooks are filled by a non autoregressive model, one whole codebook per pass, conditioned on everything coarser. So two hundred eighty five sequential steps and seven parallel passes replace two thousand two hundred eighty sequential steps.',
        deep: '<p>VALL-E factorises the codec token matrix C ∈ {0..1023}<sup>T×8</sup> given phonemes x and the prompt\'s tokens C̃:</p>' +
          '<div class="eq">p(C | x, C̃) = Π<sub>t</sub> p(c<sub>t,1</sub> | c<sub>&lt;t,1</sub>, x, C̃<sub>:,1</sub>) · Π<sub>j=2</sub><sup>8</sup> p(c<sub>:,j</sub> | C<sub>:,&lt;j</sub>, x, C̃)</div>' +
          '<ul><li><b>AR stage</b>: decoder-only transformer, causal, sampled (top-p / repetition-aware sampling in VALL-E 2) → prosodic diversity, but also failure modes: skipped or repeated words, run-on silence. Guards: max-length from text length, CTC/ASR re-check, re-sample.</li>' +
          '<li><b>NAR stage</b>: bidirectional transformer with a learned codebook-id embedding; greedy per codebook; 7 passes regardless of T.</li></ul>' +
          '<p>Cost: 285 sequential decode steps (≈1.5–3 s wall-clock at 5–10 ms per step for a few-hundred-M-parameter model with KV cache) + 7 full-sequence passes. The prefix (450 prompt frames of C̃ plus ~140 phonemes) is about two thirds of the sequence, so it is prefilled once and cached.</p>' +
          '<div class="note">2025 production variant (CosyVoice 2, Seed-TTS, MiniMax-Speech): a text-speech LM, often initialised from a general LLM, predicts <b>single-codebook semantic tokens</b> at 25 Hz; a <b>flow-matching</b> decoder then renders mel conditioned on the speaker, and a vocoder makes the waveform. Same AR idea, far shorter sequences, better robustness.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          head(ctx, G, 80, 185, 'CODEC LANGUAGE MODEL · AR over q1, NAR over q2…q8');
          var X0 = 440, Y0 = 340, P = 21, NC = 36, NP = 12;
          /* text condition brackets */
          var br1 = ctx.rect(X0, 276, NP * P - 3, 34, { rx: 5, fill: ctx.alpha('violet', 0.12), stroke: 'violet', sw: 1, parent: G });
          note(ctx, G, X0 + (NP * P) / 2, 293, 'prompt transcript', 'violet', 'middle');
          var br2 = ctx.rect(X0 + NP * P, 276, (NC - NP) * P - 3, 34, { rx: 5, fill: ctx.alpha('amber', 0.1), stroke: 'amber', sw: 1, parent: G });
          note(ctx, G, X0 + NP * P + ((NC - NP) * P) / 2, 293, 'target phonemes: twɛlv aʊɚz æftɚ ɪmpækt ðə aɪs …', 'amber', 'middle');
          note(ctx, G, X0, 250, 'prefix = [phonemes x ; prompt codes C̃] → generate C · text is a prefix, not time-aligned', 'dim');
          var r = ctx.rng(9);
          var vals = []; for (var q = 0; q < 8; q++) { vals.push([]); for (var c = 0; c < NC; c++) vals[q].push(r()); }
          var grid = ctx.matrix(X0, Y0, 8, NC, { cell: 18, gap: 3, values: function (q, c) { return c < NP ? ctx.mix('#150c2c', ctx.C.violet, 0.35 + 0.5 * vals[q][c]) : '#0d1424'; }, rowLabels: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'], parent: G });
          note(ctx, G, X0 + (NP * P) / 2, Y0 + 186, 'memo prompt C̃ · 6 s = 450 frames', 'violet', 'middle');
          note(ctx, G, X0 + NP * P + ((NC - NP) * P) / 2, Y0 + 186, 'generated N1 · 285 frames →  (columns schematic)', 'orange', 'middle');
          var ar = ctx.node({ x: 230, y: Y0 + 9, w: 300, h: 50, title: 'AR decoder · causal', sub: 'q1: one frame per step', color: 'amber', titleSize: 14, subSize: 11, parent: G });
          var nar = ctx.node({ x: 230, y: Y0 + 105, w: 300, h: 110, title: 'NAR decoder', sub: 'bidirectional · codebook id j', color: 'orange', titleSize: 14, subSize: 11, parent: G });
          var la = ctx.link(ar, { x: X0 - 30, y: Y0 + 9 }, { color: 'amber', straight: true, parent: G });
          var ln = ctx.link(nar, { x: X0 - 30, y: Y0 + 105 }, { color: 'orange', straight: true, parent: G });
          var cur = ctx.rect(X0 + NP * P - 3, Y0 - 3, 24, 24, { rx: 4, stroke: 'white', sw: 2, glow: true, parent: G });
          var step = note(ctx, G, X0 + NC * P + 14, Y0 + 9, 'AR step 0 / 285', 'amber', 'start', 13);
          var pass = note(ctx, G, X0 + NC * P + 14, Y0 + 105, 'NAR pass 0 / 7', 'orange', 'start', 13);
          var samp = ctx.para(1380, 270, ['AR sampling:', 'top-k / top-p, T ≈ 1', 'VALL-E 2: repetition-', 'aware sampling', '', 'guards:', 'max len ∝ text len', 'ASR re-check → resample'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: G });
          ctx.reveal(samp, { delay: 600 });
          ctx.reveal([br1, br2], { delay: 100 });
          ctx.reveal([ar, nar], { from: 'left', stagger: 150, delay: 200 });
          ctx.reveal([la, ln], { from: 'draw', delay: 500 });
          /* bottom: cost + modern pipeline */
          panelBox(ctx, G, 60, 600, 700, 250, 'amber');
          head(ctx, G, 80, 625, 'SEQUENTIAL WORK FOR N1 (T = 285)', 'amber');
          var cb = ctx.bars(100, 660, 400, 140, [285 / 2280, 7 / 2280 * 8, 1], { color: ['amber', 'orange', 'dim'], gap: 40, labels: ['AR q1: 285', 'NAR: 7', 'flat AR: 2,280'], parent: G });
          note(ctx, G, 530, 690, 'AR fixes content, rhythm,', 'text');
          note(ctx, G, 530, 712, 'timbre (q1 ≈ most info)', 'text');
          note(ctx, G, 530, 750, 'NAR adds detail in 7', 'text');
          note(ctx, G, 530, 772, 'full-sequence passes', 'text');
          panelBox(ctx, G, 800, 600, 760, 250, 'orange');
          head(ctx, G, 820, 625, '2025 VARIANT · CosyVoice 2 / Seed-TTS');
          var chain = [['text', 870, 100], ['LLM → semantic 25 Hz', 1045, 168], ['flow match → mel', 1235, 168], ['vocoder', 1400, 110]];
          var cn = chain.map(function (s, k) { return ctx.node({ x: s[1], y: 700, w: s[2], h: 44, title: s[0], color: k === 1 ? 'amber' : 'orange', kind: 'chip', titleSize: 12, glow: false, parent: G }); });
          var cl = []; for (var k = 0; k < 3; k++) cl.push(ctx.link(cn[k], cn[k + 1], { color: 'dim', straight: true, parent: G }));
          note(ctx, G, 820, 770, 'speaker enters as prompt tokens + embedding; 3× shorter', 'dim');
          note(ctx, G, 820, 792, 'sequences than 75 Hz codec tokens (1 codebook, 25 Hz),', 'dim');
          note(ctx, G, 820, 814, 'streamable chunk by chunk', 'dim');
          ctx.reveal(cn, { from: 'up', stagger: 100, delay: 700 });
          ctx.reveal(cl, { from: 'draw', stagger: 100, delay: 1000 });
          ctx.hud('285 AR steps + 7 NAR passes vs 2,280 flat');
          /* AR fill of q1, then NAR passes */
          return ctx.wait(900).then(function () {
            return ctx.tween(2600, function (t) {
              var n = Math.floor(t * (NC - NP) + 0.0001);
              for (var c = NP; c < NC; c++) grid.cells[0][c].setAttribute('fill', c - NP < n ? ctx.mix('#2a1406', ctx.C.amber, 0.4 + 0.6 * vals[0][c]) : '#0d1424');
              cur.setAttribute('x', X0 + Math.min(NC - 1, NP + n) * P - 3);
              step.textContent = 'AR step ' + Math.round(t * 285) + ' / 285';
            }, 'linear');
          }).then(function () {
            cur.setAttribute('y', Y0 + P - 3); cur.setAttribute('x', X0 + NP * P - 3); cur.setAttribute('width', (NC - NP) * P + 3);
            return ctx.tween(2100, function (t) {
              var rows = Math.floor(t * 7 + 0.0001);
              for (var q = 1; q < 8; q++) for (var c = NP; c < NC; c++) grid.cells[q][c].setAttribute('fill', q <= rows ? ctx.mix('#2a1406', ctx.C.orange, (0.35 + 0.65 * vals[q][c]) * (1 - q * 0.06)) : '#0d1424');
              var rr = Math.min(7, rows + 1);
              cur.setAttribute('y', Y0 + rr * P - 3);
              pass.textContent = 'NAR pass ' + rows + ' / 7';
            }, 'linear');
          }).then(function () { cur.setAttribute('opacity', 0); });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Flow-matching TTS',
        say: 'The alternative is fully non autoregressive. F5 TTS and E2 treat speech synthesis as infilling a mel spectrogram. The prompt\'s mel frames are kept; the target region starts as pure Gaussian noise; the text characters are simply padded with filler tokens to the full length, with no alignment at all. A transformer predicts a velocity field, and an ordinary differential equation carries the noise to speech along nearly straight paths in about thirty two function evaluations. Watch the target region condense into harmonics and formants.',
        deep: '<p><b>Conditional flow matching</b> (Voicebox, E2, F5-TTS): learn a velocity field that transports noise x<sub>0</sub> ~ N(0, I) to data x<sub>1</sub> (log-mel frames) along the optimal-transport path.</p>' +
          '<div class="eq">x<sub>t</sub> = (1 − t)·x<sub>0</sub> + t·x<sub>1</sub>,    L = E ‖ v<sub>θ</sub>(x<sub>t</sub>, t, x<sub>ctx</sub>, y) − (x<sub>1</sub> − x<sub>0</sub>) ‖²  over masked frames</div>' +
          '<ul><li><b>Infilling</b>: training masks 70–100 % of frames; the unmasked frames are the in-context prompt. At inference the prompt mel is given and the target span is masked.</li>' +
          '<li><b>Text</b>: the characters of [prompt transcript ‖ target text] are padded with filler tokens to the mel length; nothing aligns chars to frames, the attention learns it. Mel at 24 kHz with hop 256 = 93.75 frames/s, so 6.0 s prompt + 3.8 s target = 919 frames for ≈140 chars. Total length = prompt length × (chars<sub>total</sub> / chars<sub>prompt</sub>) or a small duration predictor.</li>' +
          '<li><b>Sampling</b>: Euler/midpoint ODE with 16–32 NFE; F5-TTS uses <i>sway sampling</i> t′ = t + s(cos(πt/2) − 1 + t), s = −1, which spends more steps at small t where structure forms.</li>' +
          '<li><b>CFG</b>: v = v(c) + w·(v(c) − v(∅)), w ≈ 2.</li></ul>' +
          '<p>F5-TTS (≈336 M params, DiT + ConvNeXt text encoder) reports RTF ≈ 0.15 at 32 NFE, WER ≈ 2.4 % on LibriSpeech-PC. Trade-off vs codec LMs: parallel and robust (no skipped words), but not natively streaming and total duration must be chosen up front.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          head(ctx, G, 80, 185, 'FLOW MATCHING · infill the target mel (F5-TTS / E2 / Voicebox)');
          /* text row */
          /* E2/F5: chars = [prompt transcript ‖ target text], then filler up to the mel length.
             ~90 + 50 chars vs 919 mel frames (9.8 s × 93.75 fps): the text is NOT aligned to the audio. */
          var tx0 = 100, twid = 1000, fr1 = 90 / 919, fr2 = 50 / 919;
          ctx.rect(tx0, 232, twid * fr1, 30, { rx: 5, fill: ctx.alpha('violet', 0.16), stroke: 'violet', sw: 1, parent: G });
          note(ctx, G, tx0 + twid * fr1 / 2, 247, 'prompt', 'violet', 'middle', 11);
          ctx.rect(tx0 + twid * fr1, 232, twid * fr2, 30, { rx: 5, fill: ctx.alpha('amber', 0.16), stroke: 'amber', sw: 1, parent: G });
          note(ctx, G, tx0 + twid * (fr1 + fr2 / 2), 247, 'N1', 'amber', 'middle', 11);
          ctx.rect(tx0 + twid * (fr1 + fr2), 232, twid * (1 - fr1 - fr2), 30, { rx: 5, fill: 'rgba(123,140,171,0.08)', stroke: ctx.alpha('dim', 0.6), sw: 1, dash: '4 3', parent: G });
          note(ctx, G, tx0 + twid * (fr1 + fr2) + 12, 247, '⟨F⟩ ⟨F⟩ ⟨F⟩ …  filler up to 919 mel frames · chars not aligned to the audio', 'dim');
          note(ctx, G, tx0, 280, 'text = prompt transcript ‖ target text ‖ filler — no aligner, no duration model', 'text');
          /* mel images */
          var MW = 300, MH = 80, NPC = 184;          /* 300 columns; first 184 = 6.0 s prompt, rest = 3.8 s target */
          var rN = ctx.rng(77);
          var mel = bmp(MW, MH, function (x, y) {
            var b = MH - 1 - y, t, E;
            if (x < NPC) { t = x / NPC * 6.0; E = envAt(S.sylP, t); } else { t = (x - NPC) / (MW - NPC) * 3.8; E = envAt(S.sylT, t); }
            return cm(melVal(E, t, b, rN()));
          });
          var noise = bmp(MW - NPC, MH, function () { var u = rN() + rN() + rN() - 1.5; return cm(0.45 + 0.28 * u); });
          var MX = 100, MY = 310, MWp = 1000, MHp = 240;
          var melEl = image(ctx, G, mel, MX, MY, MWp, MHp);
          var tgtX = MX + MWp * NPC / MW;
          var noiseEl = image(ctx, G, noise, tgtX, MY, MX + MWp - tgtX, MHp);
          ctx.rect(MX, MY, MWp, MHp, { rx: 2, stroke: ctx.alpha('orange', 0.5), sw: 1, parent: G });
          ctx.line(tgtX, MY - 6, tgtX, MY + MHp + 6, { color: 'white', sw: 1.5, dash: '4 3', parent: G });
          note(ctx, G, MX + 6, MY + MHp + 18, 'prompt mel (kept, unmasked) · 6.0 s · memo 12–18 s', 'violet');
          note(ctx, G, tgtX + 6, MY + MHp + 18, 'target 3.8 s: x₀ ~ N(0, I) → x₁', 'orange');
          note(ctx, G, MX - 8, MY + 10, '8k', 'dim', 'end', 11);
          note(ctx, G, MX - 8, MY + MHp - 8, '0', 'dim', 'end', 11);
          var nfe = ctx.text(MX + MWp, 292, 'NFE 0 / 32 · t = 0.00', { size: 14, font: 'mono', color: 'white', anchor: 'end', parent: G });
          /* right: straight vs curved paths */
          panelBox(ctx, G, 1140, 170, 420, 390, 'orange');
          head(ctx, G, 1160, 195, 'PROBABILITY PATHS');
          var pl = ctx.plot(1180, 230, 360, 250, function () { return -9; }, { xDomain: [0, 1], yDomain: [0, 1], color: 'none', axes: false, parent: G });
          var rr = ctx.rng(12), dots = [], As = [], Bs = [];
          for (var i = 0; i < 7; i++) { As.push({ x: 0.05 + 0.2 * rr(), y: 0.1 + 0.8 * rr() }); Bs.push({ x: 0.78 + 0.18 * rr(), y: 0.25 + 0.5 * rr() }); }
          /* OT coupling in 1-D: pair sorted with sorted, so straight paths do not cross */
          As.sort(function (p, q) { return p.y - q.y; }); Bs.sort(function (p, q) { return p.y - q.y; });
          for (i = 0; i < 7; i++) {
            var a = As[i], b = Bs[i];
            var A = pl.toPx(a.x, a.y), B = pl.toPx(b.x, b.y);
            ctx.path('M' + A.x + ',' + A.y + ' Q' + (A.x + B.x) / 2 + ',' + (A.y + (i % 2 ? -90 : 90)) + ' ' + B.x + ',' + B.y, { stroke: ctx.alpha('dim', 0.6), sw: 1.2, dash: '3 4', parent: G });
            ctx.line(A.x, A.y, B.x, B.y, { color: ctx.alpha('orange', 0.9), sw: 1.6, parent: G });
            ctx.circle(A.x, A.y, 4, { fill: 'dim', parent: G });
            ctx.circle(B.x, B.y, 4, { fill: 'orange', parent: G });
            dots.push({ A: A, B: B, el: ctx.circle(A.x, A.y, 5, { fill: 'white', parent: G, glow: true }) });
          }
          note(ctx, G, 1180, 500, 'x₀ noise', 'dim');
          note(ctx, G, 1540, 500, 'x₁ speech', 'orange', 'end');
          note(ctx, G, 1160, 528, 'solid: OT straight path (few NFE)', 'orange');
          note(ctx, G, 1160, 548, 'dashed: curved diffusion path', 'dim');
          /* bottom: schedule and equations */
          panelBox(ctx, G, 60, 600, 1500, 250, 'orange');
          head(ctx, G, 80, 625, 'SWAY SAMPLING · 32 steps, denser near t = 0 where structure forms');
          var sch = ctx.group({ parent: G });
          ctx.line(100, 680, 1100, 680, { color: 'faint', parent: sch });
          for (var k = 0; k <= 32; k++) {
            var t0 = k / 32, ts = t0 + (-1) * (Math.cos(Math.PI * t0 / 2) - 1 + t0);
            ctx.line(100 + ts * 1000, 668, 100 + ts * 1000, 692, { color: 'orange', sw: 1.5, parent: sch });
          }
          note(ctx, G, 100, 708, 't = 0', 'dim', 'middle');
          note(ctx, G, 1100, 708, 't = 1', 'dim', 'middle');
          var eqs = ctx.para(100, 750, nb(['train:  x_t = (1−t)·x₀ + t·x₁ ,   target velocity  u = x₁ − x₀', 'sample: x ← x + Δt · [ v(c) + w·(v(c) − v(∅)) ] ,   w ≈ 2', 'F5-TTS ≈ 336 M params · RTF ≈ 0.15 @ 32 NFE · WER ≈ 2.4 %']), { size: 14, font: 'mono', color: 'text', lh: 28, parent: G });
          var sway = ctx.para(1170, 650, nb(['sway: t′ = t + s·(cos(πt/2) − 1 + t)', 's = −1  ⇒  t′ = 1 − cos(πt/2)', 'half of the 32 steps land below t′ ≈ 0.29', 'where coarse spectral structure forms']), { size: 13, font: 'mono', color: 'amber', lh: 26, parent: G });
          ctx.reveal(sch, { delay: 300 });
          ctx.reveal(eqs, { delay: 500 });
          ctx.reveal(sway, { delay: 700 });
          ctx.hud('32 NFE · RTF ≈ 0.15 · no aligner');
          return ctx.wait(700).then(function () {
            return ctx.tween(3600, function (t) {
              var n = Math.round(t * 32), t0 = n / 32, ts = t0 - (Math.cos(Math.PI * t0 / 2) - 1 + t0);
              noiseEl.setAttribute('opacity', (1 - ts).toFixed(3));
              nfe.textContent = 'NFE ' + n + ' / 32 · t = ' + ts.toFixed(2);
              dots.forEach(function (d) { d.el.setAttribute('cx', d.A.x + (d.B.x - d.A.x) * ts); d.el.setAttribute('cy', d.A.y + (d.B.y - d.A.y) * ts); });
            }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Vocoder & streaming',
        say: 'Mel frames and codec tokens are not sound yet. A vocoder turns them into a waveform. HiFi-GAN upsamples each frame with transposed convolutions, eight, eight, two and two, so one frame becomes two hundred fifty six samples, and adversarial discriminators judge periodic structure. Vocos instead predicts a short time Fourier spectrum, magnitude and phase, and applies one inverse FFT, which is much faster. For interactive previews the whole chain streams in chunks, and the first audio can play after about a hundred and fifty milliseconds.',
        deep: '<p><b>HiFi-GAN</b> generator: mel (80 × T) → conv → [ConvTranspose ×8 → MRF] → [×8 → MRF] → [×2] → [×2] → tanh. 8·8·2·2 = 256 = hop size (22.05/24 kHz). Multi-receptive-field (MRF) residual blocks mix dilations 1/3/5.</p>' +
          '<div class="eq">L<sub>G</sub> = Σ<sub>D</sub> (D(G(s)) − 1)² + 2·L<sub>FM</sub> + 45·‖mel(x) − mel(G(s))‖<sub>1</sub></div>' +
          '<p>Discriminators: <b>MPD</b> reshapes the waveform to 2-D with periods p ∈ {2, 3, 5, 7, 11} to catch periodic artifacts; <b>MSD</b> (or multi-resolution STFT) judges at several scales. BigVGAN adds anti-aliased Snake activations for out-of-domain robustness.</p>' +
          '<p><b>Vocos</b>: a ConvNeXt backbone stays at the frame rate and predicts |X| and φ per STFT bin; x = iSTFT(|X|·e<sup>iφ</sup>). No upsampling layers, so it runs roughly an order of magnitude faster than HiFi-GAN at similar quality. Codec decoders (EnCodec, DAC, Mimi) play the same role for token models.</p>' +
          '<p><b>Streaming</b>: chunk-aware causal flow matching + causal vocoder (CosyVoice 2 reports ≈150 ms first-packet latency). Budget: text chunk → ~15 LM tokens → FM on a 0.5–1 s chunk (few NFE) → vocoder; later chunks pipeline, so steady-state RTF ≪ 1. For the trailer, offline quality mode is used; streaming serves the live preview.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          head(ctx, G, 80, 185, 'VOCODER · frames → samples');
          /* mel slice + selected column */
          var rN = ctx.rng(5);
          var mel = bmp(40, 80, function (x, y) { var t = 1.0 + x / 40 * 0.8; return cm(melVal(envAt(S.sylT, t), t, 79 - y, rN())); });
          image(ctx, G, mel, 80, 220, 200, 240);
          ctx.rect(80, 220, 200, 240, { rx: 2, stroke: ctx.alpha('orange', 0.5), sw: 1, parent: G });
          var col = ctx.rect(176, 216, 8, 248, { rx: 2, stroke: 'white', sw: 2, glow: true, parent: G });
          note(ctx, G, 180, 482, '1 mel frame = 80 values', 'text', 'middle');
          note(ctx, G, 180, 502, '10.7 ms @ 24 kHz, hop 256', 'dim', 'middle');
          /* upsampling stack */
          var ups = [['conv_pre · 512 ch', 1], ['ConvT ×8 + MRF · 256 ch', 8], ['ConvT ×8 + MRF · 128 ch', 64], ['ConvT ×2 + MRF · 64 ch', 128], ['ConvT ×2 + MRF · 32 ch', 256]];
          var blocks = ups.map(function (u, k) {
            var g = ctx.group({ parent: G });
            var y = 222 + k * 50, w = 200 + Math.log(u[1]) / Math.log(256) * 240;
            ctx.rect(330, y, w, 34, { rx: 5, fill: ctx.alpha('orange', 0.1 + k * 0.05), stroke: 'orange', sw: 1.1, parent: g });
            note(ctx, g, 340, y + 17, u[0], 'white', 'start', 12);
            note(ctx, g, 330 + w + 12, y + 17, u[1] + (u[1] === 1 ? ' sample' : ' samples'), 'orange', 'start', 12);
            /* sample ticks */
            var n = Math.min(64, u[1]);
            for (var i = 0; i < n; i++) ctx.line(330 + (i + 0.5) / n * w, y + 30, 330 + (i + 0.5) / n * w, y + 34, { color: 'orange', sw: 1, parent: g });
            return g;
          });
          var lk = ctx.line(284, 340, 324, 340, { color: 'orange', arrow: true, parent: G });
          /* output waveform */
          var wf = ctx.path(waveD(ctx, 900, 640, 330, 70, 21, function (u) { return 0.2 + 0.8 * Math.abs(Math.sin(u * 5.5)) * Math.exp(-u * 0.6); }), { stroke: 'orange', sw: 1.2, parent: G });
          note(ctx, G, 900, 425, '256 samples per frame · 24,000 samples/s', 'text');
          var lk2 = ctx.line(870, 330, 894, 330, { color: 'orange', arrow: true, parent: G });
          ctx.reveal(blocks, { from: 'left', stagger: 180, delay: 300 });
          ctx.reveal(lk, { from: 'draw', delay: 200 });
          ctx.reveal([lk2, wf], { delay: 1300, stagger: 150 });
          /* discriminators + Vocos */
          panelBox(ctx, G, 900, 450, 660, 150, 'orange');
          head(ctx, G, 920, 474, 'TRAINING SIGNAL · MPD reshapes 1-D → 2-D (period p)');
          [2, 3, 5, 7, 11].forEach(function (p, k) {
            var x0 = 930 + k * 124;
            for (var rr = 0; rr < 5; rr++) for (var cc = 0; cc < p && cc < 7; cc++) ctx.rect(x0 + cc * 13, 492 + rr * 13, 11, 11, { rx: 2, fill: ctx.alpha('orange', 0.15 + 0.12 * ((rr * p + cc) % 3)), parent: G });
            note(ctx, G, x0, 574, 'p = ' + p, 'orange', 'start', 12);
          });
          panelBox(ctx, G, 60, 530, 800, 110, 'violet');
          head(ctx, G, 80, 554, 'VOCOS · stay at frame rate, predict the spectrum', 'violet');
          var vc = ['mel', 'ConvNeXt ×8', '|X|, φ', 'iSTFT', 'wave'];
          var vn = vc.map(function (s, k) { return ctx.node({ x: 130 + k * 160, y: 598, w: 118, h: 36, title: s, color: 'violet', kind: 'chip', titleSize: 12, glow: false, parent: G }); });
          for (var k = 0; k < 4; k++) ctx.link(vn[k], vn[k + 1], { color: 'violet', straight: true, parent: G });
          /* streaming gantt */
          panelBox(ctx, G, 60, 660, 1500, 190, 'cyan');
          head(ctx, G, 80, 684, 'STREAMING TTS · chunked, pipelined (live preview mode)', 'cyan');
          var rows = [['text chunk', 'amber', [[0, 20], [320, 340], [640, 660]]], ['LM tokens', 'amber', [[20, 70], [340, 390], [660, 710]]], ['flow match', 'orange', [[70, 120], [390, 440], [710, 760]]], ['vocoder', 'violet', [[120, 150], [440, 470], [760, 790]]], ['playback', 'cyan', [[150, 650], [650, 1150]]]];
          var gx = 260, gs = 1.05;
          var gb = [];
          rows.forEach(function (r, i) {
            var y = 718 + i * 25;
            note(ctx, G, gx - 12, y + 10, r[0], 'text', 'end', 12);
            r[2].forEach(function (seg) { gb.push(ctx.rect(gx + seg[0] * gs, y, (seg[1] - seg[0]) * gs - 2, 20, { rx: 3, fill: ctx.alpha(r[1], 0.35), stroke: r[1], sw: 1, parent: G })); });
          });
          var fp = ctx.line(gx + 150 * gs, 712, gx + 150 * gs, 842, { color: 'white', dash: '4 3', parent: G });
          note(ctx, G, gx + 150 * gs + 8, 706, 'first audio ≈ 150 ms', 'white', 'start', 12);
          [0, 500, 1000].forEach(function (ms) { note(ctx, G, gx + ms * gs, 706, ms + ' ms', 'dim', 'middle', 11); });
          ctx.reveal(gb, { from: 'left', stagger: 40, delay: 800 });
          ctx.reveal(fp, { delay: 1600 });
          ctx.hud('8 · 8 · 2 · 2 = 256 samples per frame');
          return ctx.wait(700).then(function () {
            return ctx.tween(2400, function (t) { col.setAttribute('x', 84 + t * 188); }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Cloning, prosody, consent',
        say: 'Zero shot cloning means no fine tuning. A voice activity detector and a quality scorer choose the cleanest six seconds of the memo. The model either continues that prompt in context, or conditions on a speaker embedding. We check the result in a speaker verification space: the new lines land inside the creator\'s cluster. Prosody is steered separately, here lower, slower and breathier for a hushed trailer read. And because a cloned voice is a powerful thing, consent verification and watermarking are part of the pipeline, not an afterthought.',
        deep: '<ul><li><b>Prompt choice</b>: 3–10 s; score segments by VAD coverage, SNR / DNSMOS, clipping, reverb (C50), single-speaker check. Longer prompts raise similarity but also copy the phone\'s room tone and codec artifacts.</li>' +
          '<li><b>Conditioning</b>: in-context continuation (prompt codes/mel as prefix, VALL-E, F5) transfers timbre <i>and</i> recording conditions; a global embedding (x-vector/ECAPA, 192–256 d) transfers identity only. Many systems use both.</li>' +
          '<li><b>Verification</b>: SIM = cos(e(ŷ), e(prompt)) with a WavLM-TDNN verifier; 2025 zero-shot systems reach ≈0.6–0.75 (ground-truth re-recordings ≈0.7–0.8).</li>' +
          '<li><b>Prosody</b>: instruction text ("hushed, awe"), emotion tags, or a reference-prosody prompt; explicit knobs for rate and F0 range. Here F0 mean −15 %, rate 0.9×.</li></ul>' +
          '<div class="note"><b>Safeguards</b>: clone only a voice the account can prove is its own (speaker-verify the memo against an enrolled consent phrase), refuse public-figure voices (voice-ID blocklist), watermark every sample (AudioSeal: localized, robust to re-encoding, sample-level detection), and record a C2PA "synthetic voice" assertion in the final manifest.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          head(ctx, G, 80, 185, 'PROMPT SELECTION · memo.m4a 42 s · score = SNR + DNSMOS per 6 s');
          /* memo with segment scores */
          var segs = []; var r = ctx.rng(3);
          for (var i = 0; i < 7; i++) segs.push(0.3 + 0.5 * r());
          segs[2] = 0.95;
          ctx.path(waveD(ctx, 80, 700, 245, 26, 11, function (u) { return 0.2 + 0.8 * Math.abs(Math.sin(u * 31)) * (Math.sin(u * 7) > -0.6 ? 1 : 0.15); }), { stroke: ctx.alpha('orange', 0.6), sw: 1.2, parent: G });
          var sb = ctx.bars(80, 290, 700, 50, segs, { color: segs.map(function (v, k) { return k === 2 ? 'lime' : 'dim'; }), gap: 6, labels: ['0–6', '6–12', '12–18', '18–24', '24–30', '30–36', '36–42'], parent: G });
          var win = ctx.rect(80 + 2 * 100.9, 212, 95, 66, { rx: 4, stroke: 'lime', sw: 2, fill: ctx.alpha('lime', 0.08), glow: true, parent: G });
          note(ctx, G, 80, 375, 'chosen: 12–18 s · SNR 31 dB · single speaker', 'lime');
          ctx.reveal(win, { from: 'scale', delay: 600 });
          /* two routes */
          var r1 = ctx.node({ x: 250, y: 440, w: 340, h: 50, title: 'in-context prefix', sub: 'prompt codes/mel + transcript', color: 'orange', titleSize: 14, subSize: 11, parent: G });
          var r2 = ctx.node({ x: 620, y: 440, w: 320, h: 50, title: 'speaker embedding', sub: 'ECAPA · 192-d, L2-normalised', color: 'violet', titleSize: 14, subSize: 11, parent: G });
          ctx.reveal([r1, r2], { from: 'up', stagger: 150, delay: 800 });
          /* embedding space */
          panelBox(ctx, G, 860, 170, 700, 330, 'violet');
          head(ctx, G, 880, 195, 'SPEAKER-VERIFICATION SPACE (2-D projection)', 'violet');
          var rr = ctx.rng(15), pts = [];
          var clusters = [[1060, 330, 'dim'], [1240, 250, 'dim'], [1420, 380, 'dim'], [1300, 420, 'dim']];
          clusters.forEach(function (c) { for (var k = 0; k < 9; k++) pts.push(ctx.circle(c[0] + (rr() - 0.5) * 70, c[1] + (rr() - 0.5) * 60, 3, { fill: ctx.alpha('dim', 0.6), parent: G })); });
          var me = [];
          for (var k = 0; k < 12; k++) me.push(ctx.circle(1160 + (rr() - 0.5) * 80, 360 + (rr() - 0.5) * 70, 3.5, { fill: 'orange', parent: G }));
          var thr = ctx.circle(1160, 360, 70, { stroke: 'orange', sw: 1.2, dash: '4 4', parent: G });
          note(ctx, G, 1160, 443, 'creator (memo utterances)', 'orange', 'middle');
          var stars = [[1150, 345, 'N1'], [1178, 372, 'N2'], [1138, 382, 'N3']].map(function (s) {
            var g = ctx.group({ parent: G });
            ctx.poly([[s[0], s[1] - 8], [s[0] + 3, s[1] - 2], [s[0] + 9, s[1] - 2], [s[0] + 4, s[1] + 2], [s[0] + 6, s[1] + 9], [s[0], s[1] + 5], [s[0] - 6, s[1] + 9], [s[0] - 4, s[1] + 2], [s[0] - 9, s[1] - 2], [s[0] - 3, s[1] - 2]], { fill: 'white', parent: g, glow: true });
            note(ctx, g, s[0] + 12, s[1] - 6, s[2], 'white', 'start', 11);
            return g;
          });
          note(ctx, G, 880, 480, 'cos(N1, prompt) = 0.68 · nearest other speaker 0.21', 'text');
          ctx.reveal(pts.concat(me), { stagger: 8, delay: 400 });
          ctx.reveal(thr, { from: 'scale', delay: 900 });
          ctx.reveal(stars, { from: 'scale', stagger: 200, delay: 1300 });
          /* prosody */
          panelBox(ctx, G, 60, 520, 760, 190, 'amber');
          head(ctx, G, 80, 544, 'PROSODY CONTROL · F0 contour of N1 (Hz)', 'amber');
          var f0n = function (x) { return 150 + 30 * Math.sin(x * 2.2) + 15 * Math.sin(x * 5.1); };
          var f0h = function (x) { return 127.5 + 14 * Math.sin(x * 2.0) + 6 * Math.sin(x * 4.6); };   /* mean 150 → 127.5 Hz = −15 % */
          var pA = ctx.plot(120, 565, 520, 120, f0n, { xDomain: [0, 4], yDomain: [90, 200], color: 'dim', sw: 1.6, parent: G });
          var pB = ctx.plot(120, 565, 520, 120, f0h, { xDomain: [0, 4], yDomain: [90, 200], color: 'amber', sw: 2.2, axes: false, parent: G, glow: true });
          note(ctx, G, 660, 590, 'neutral read', 'dim');
          note(ctx, G, 660, 640, '"hushed, awe"', 'amber');
          note(ctx, G, 660, 662, 'F0 −15 % · rate 0.9×', 'amber');
          ctx.reveal(pB.curve, { from: 'draw', delay: 1200, dur: 1000 });
          /* consent */
          panelBox(ctx, G, 860, 520, 700, 330, 'pink');
          head(ctx, G, 880, 544, 'SAFEGUARDS · before and after synthesis', 'pink');
          var cs = ['memo speaker = enrolled account voice', 'spoken consent phrase + liveness', 'not on public-figure voice blocklist', 'AudioSeal watermark on every sample', 'C2PA: "synthetic voice" assertion', 'clone scoped to this project only'];
          S.cons = cs.map(function (c, k) { return ctx.label(1210, 584 + k * 42, c, { color: 'dim', size: 13, w: 620, parent: G }); });
          ctx.reveal(S.cons, { from: 'left', stagger: 90, delay: 600 });
          note(ctx, G, 80, 742, 'Identity (who) and prosody (how) are separable controls:', 'text', 'start', 13);
          note(ctx, G, 80, 766, 'the embedding pins timbre, instructions or a prosody prompt', 'text', 'start', 13);
          note(ctx, G, 80, 790, 'reshape pitch, rate and energy without leaving the cluster.', 'text', 'start', 13);
          ctx.hud('SIM 0.68 · consent ✓ · watermark ✓');
          return ctx.wait(1900).then(function () { return turnGreen(ctx, S.cons, 180); });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Music: tokens vs latents',
        say: 'Music has two leading recipes. MusicGen models codec tokens with one transformer, but four codebooks per frame would make the sequence four times longer. The delay pattern shifts codebook k by k steps, so every decoding step emits one token for each codebook, and thirty seconds takes about fifteen hundred steps instead of six thousand. Stable Audio instead runs a diffusion transformer on a continuous VAE latent, conditioned on text and on timing, so the length and the build to the impact at fifteen seconds can be specified directly.',
        deep: '<p><b>MusicGen</b>: EnCodec 32 kHz, 4 codebooks × 2048 at 50 Hz; one decoder-only transformer (300 M – 3.3 B) with T5 text conditioning (cross-attention) and optional chroma melody conditioning.</p>' +
          '<table><tr><th>Interleaving</th><th>Steps for 30 s</th><th>Note</th></tr>' +
          '<tr><td>flatten</td><td>4 × 1500 = 6000</td><td>exact AR, slow</td></tr>' +
          '<tr><td>parallel</td><td>1500</td><td>ignores intra-frame deps</td></tr>' +
          '<tr><td>delay</td><td>1500 + 3</td><td>codebook k of frame f is emitted at step f + k, after codebooks &lt; k of f, so it can condition on them; near flatten quality</td></tr></table>' +
          '<p><b>Stable Audio</b> (Open / 2.x): a VAE compresses 44.1 kHz stereo to a 64-channel latent at ≈21.5 Hz (≈2048× in time); a DiT denoises it with T5 text cross-attention and <i>timing conditioning</i> (seconds_start, seconds_total) as extra tokens, so a 30 s cue is generated to length inside a fixed window (47 s for Open, up to ~3 min for 2.x).</p>' +
          '<div class="eq">96 BPM ⇒ 0.625 s/beat; 30 s = 48 beats = 12 bars; HIT at bar 7 downbeat = 15.0 s</div>' +
          '<p>Tempo is only loosely obeyed from text; the pipeline verifies with a beat tracker (e.g. madmom) and, if the estimate is 95.4 BPM, time-stretches by 0.6 % with a phase vocoder so the downbeats land on the edit grid.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 1);
          /* MusicGen delay pattern */
          panelBox(ctx, G, 60, 170, 740, 460, 'amber');
          head(ctx, G, 80, 195, 'MusicGen · codec LM · DELAY PATTERN', 'amber');
          var X0 = 150, Y0 = 280, P = 38, NCOL = 14;
          var cells = [];
          for (var k = 0; k < 4; k++) {
            cells.push([]);
            note(ctx, G, X0 - 12, Y0 + k * P + 16, 'k' + (k + 1), 'dim', 'end', 12);
            for (var s = 0; s < NCOL; s++) {
              var pad = s < k;
              var rc = ctx.rect(X0 + s * P, Y0 + k * P, P - 4, P - 4, { rx: 4, fill: pad ? 'rgba(255,255,255,0.03)' : '#0d1424', stroke: pad ? 'none' : ctx.alpha('amber', 0.25), sw: 1, parent: G });
              var tt = note(ctx, G, X0 + s * P + (P - 4) / 2, Y0 + k * P + (P - 4) / 2, pad ? '·' : 'f' + (s - k), 'dim', 'middle', 11);
              cells[k].push({ r: rc, t: tt, pad: pad });
            }
          }
          note(ctx, G, X0, Y0 - 22, 'decode step s →   (column = one transformer step, 4 tokens)', 'text');
          var cur = ctx.rect(X0 - 3, Y0 - 5, P + 2, 4 * P + 6, { rx: 5, stroke: 'white', sw: 2, glow: true, parent: G });
          var cmp = ctx.bars(150, 480, 420, 90, [1, 0.25, 0.2505], { color: ['dim', 'dim', 'amber'], gap: 30, labels: ['flatten 6000', 'parallel 1500', 'delay 1503'], parent: G });
          note(ctx, G, 600, 510, 'steps for 30 s', 'dim');
          note(ctx, G, 600, 532, '(50 Hz frames)', 'dim');
          /* Stable Audio latent diffusion */
          panelBox(ctx, G, 840, 170, 720, 460, 'orange');
          head(ctx, G, 860, 195, 'Stable Audio · LATENT DiT + TIMING CONDITIONING');
          var conds = [['text: "hybrid orchestral, D minor, 96 BPM, hit @15 s"', 'amber'], ['seconds_start = 0', 'cyan'], ['seconds_total = 30', 'cyan']];
          var cc = conds.map(function (c, k) { return ctx.label(1200, 232 + k * 30, c[0], { color: c[1], size: 12, w: k ? 220 : 560, parent: G }); });
          var rr = ctx.rng(8);
          var nz = [], cl = [];
          for (var i = 0; i < 8; i++) { nz.push([]); cl.push([]); for (var j = 0; j < 24; j++) { nz[i].push(rr()); cl[i].push(0.5 + 0.45 * Math.sin(j * 0.55 + i * 0.8) * (j < 12 ? 0.4 + j / 20 : (j < 14 ? 1 : 0.6))); } }
          var lat = ctx.matrix(900, 340, 8, 24, { cell: 22, gap: 3, cmap: 'heat', values: nz, parent: G });
          note(ctx, G, 900, 552, 'latent 64 ch × 21.5 Hz (8 ch shown) · 44.1 kHz stereo ≈ 2048× shorter', 'text');
          var st = note(ctx, G, 900, 578, 'DiT denoising step 0 / 100', 'orange');
          note(ctx, G, 900, 604, 'VAE decoder → 30.0 s waveform, exact length', 'dim');
          ctx.reveal(cc, { from: 'right', stagger: 120, delay: 200 });
          /* bottom: song form */
          panelBox(ctx, G, 60, 650, 1500, 200, 'orange');
          head(ctx, G, 80, 674, 'SCORE FORM · 96 BPM · 12 bars · verified by a beat tracker');
          var fx = 100, fw = 1400;
          var env = ctx.path(waveD(ctx, fx, fw, 750, 40, 33, function (u) { var t = u * 30; return t < 15 ? 0.15 + 0.6 * t / 15 : (t < 16.2 ? 1 : 0.55 - 0.3 * (t - 16.2) / 13.8); }), { stroke: ctx.alpha('orange', 0.8), sw: 1.2, parent: G });
          for (var b = 0; b <= 12; b++) {
            ctx.line(fx + b * fw / 12, 700, fx + b * fw / 12, 800, { color: b === 6 ? 'amber' : 'rgba(255,255,255,0.12)', sw: b === 6 ? 2 : 1, parent: G });
            if (b < 12) note(ctx, G, fx + (b + 0.5) * fw / 12, 818, 'bar ' + (b + 1), b === 6 ? 'amber' : 'dim', 'middle', 11);
          }
          note(ctx, G, fx + 6 * fw / 12 + 8, 712, 'HIT 15.0 s', 'amber', 'start', 12);
          note(ctx, G, 1500, 838, 'measured 95.4 BPM → stretch 0.6 %', 'text', 'end', 12);
          ctx.reveal(env, { from: 'draw', dur: 1200, delay: 400 });
          ctx.hud('delay pattern: 1503 steps vs 6000');
          return ctx.wait(500).then(function () {
            return Promise.all([
              ctx.tween(3200, function (t) {
                var sN = Math.floor(t * NCOL + 0.0001);
                for (var k = 0; k < 4; k++) for (var s = 0; s < NCOL; s++) {
                  var c = cells[k][s];
                  if (c.pad) continue;
                  var on = s < sN;
                  c.r.setAttribute('fill', on ? ctx.mix('#2a1a06', ctx.C.amber, 0.35 + 0.15 * k) : '#0d1424');
                  c.t.setAttribute('fill', on ? ctx.C.white : ctx.C.dim);
                }
                cur.setAttribute('x', X0 + Math.min(NCOL - 1, sN) * P - 3);
              }, 'linear'),
              ctx.tween(3200, function (t) {
                lat.set(function (i, j) { return nz[i][j] * (1 - t) + cl[i][j] * t; });
                st.textContent = 'DiT denoising step ' + Math.round(t * 100) + ' / 100';
              }, 'inOut')
            ]);
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Foley from video',
        say: 'Sound effects must follow the picture. A video to audio model like MMAudio watches the shot: semantic features at eight frames per second say what is happening, and synchronization features at twenty four frames per second say exactly when. These tokens attend jointly with text and audio latents inside one transformer, trained with flow matching on audio, video and text data together. The impact in shot four lands on frame three hundred sixty, and the generated transient lands within a frame of it. Newer generators like Veo 3 skip this step by generating audio and video together.',
        deep: '<p><b>MMAudio</b> (CVPR 2025): multimodal joint training on audio-visual and audio-text data; ~157 M–1 B params; generates 8 s of 44.1 kHz audio in ≈1.2 s.</p>' +
          '<ul><li><b>Conditions</b>: CLIP visual tokens at 8 fps (semantics), Synchformer features at 24 fps (fine timing), CLIP text tokens.</li>' +
          '<li><b>Backbone</b>: MM-DiT joint-attention blocks over [video ‖ text ‖ audio-latent] tokens, then audio-only blocks; <b>aligned RoPE</b> gives video and audio tokens positions on the same time axis; sync features are added frame-aligned to audio tokens.</li>' +
          '<li><b>Generation</b>: conditional flow matching on a mel-VAE latent, then a vocoder (BigVGAN).</li></ul>' +
          '<div class="eq">DeSync = | Δ̂<sub>Synchformer</sub>(video, audio) |   (seconds, lower is better)</div>' +
          '<p>Evaluation: FD (PaSST/PANNs/VGGish), IS, IB-score (ImageBind audio-visual similarity), DeSync. A 24 fps frame is 41.7 ms; humans notice audio-leading offsets from ≈45 ms, audio-lagging from ≈125 ms (ITU-R BT.1359), so the impact must be within about one frame.</p>' +
          '<div class="note">Joint audio-video generation (Veo 3, and open models in 2025–26) emits both modalities from one denoiser: native sync and dialogue, but no independent control over the stems; the editor still needs separate music and voice tracks.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 2);
          head(ctx, G, 80, 185, 'SHOT S4 · impact · frames 315–420 (timeline)');
          /* frame strip */
          var FX = 90, FW = 86, N = 12;
          var fr = [];
          for (var i = 0; i < N; i++) {
            var g = ctx.group({ parent: G });
            var x = FX + i * (FW + 4), hit = i === 5;
            ctx.rect(x, 205, FW, 52, { rx: 3, fill: '#16364a', stroke: hit ? 'amber' : ctx.alpha('white', 0.25), sw: hit ? 2 : 1, parent: g });
            ctx.rect(x, 241, FW, 16, { rx: 0, fill: ctx.alpha('cyan', 0.25), parent: g });
            var py = 212 + Math.min(1, i / 5) * 26;
            if (i <= 5) ctx.circle(x + FW / 2, py, 5, { fill: 'orange', parent: g, glow: i === 5 });
            if (i >= 5) ctx.circle(x + FW / 2, 238, 6 + (i - 5) * 3.5, { stroke: ctx.alpha('white', Math.max(0.1, 1 - (i - 5) * 0.14)), sw: 2, parent: g });
            fr.push(g);
          }
          note(ctx, G, FX + 5 * (FW + 4) + FW / 2 + 8, 272, 'frame 360 = 15.000 s', 'amber', 'start', 12);
          /* motion energy + audio envelope aligned */
          var tl = function (u) { return FX + u * (N * (FW + 4) - 4); };
          var hitU = (5.5) / N;
          var me = ctx.plot(FX, 290, N * (FW + 4) - 4, 60, function (u) { return 0.1 + 0.9 * Math.exp(-Math.pow((u - hitU) / 0.03, 2)) + 0.15 * Math.exp(-Math.pow((u - hitU + 0.2) / 0.1, 2)); }, { xDomain: [0, 1], yDomain: [0, 1.1], color: 'lime', sw: 2, axes: false, samples: 200, parent: G });
          note(ctx, G, FX - 8, 320, 'motion', 'lime', 'end', 11);
          var au = ctx.path(waveD(ctx, FX, N * (FW + 4) - 4, 400, 34, 17, function (u) { return u < hitU - 0.004 ? 0.05 + 0.1 * u : 0.05 + Math.exp(-(u - hitU + 0.004) / 0.08); }), { stroke: 'orange', sw: 1.2, parent: G });
          note(ctx, G, FX - 8, 400, 'audio', 'orange', 'end', 11);
          var sync = ctx.line(tl(hitU), 200, tl(hitU), 440, { color: 'amber', sw: 1.5, dash: '4 3', parent: G });
          note(ctx, G, tl(hitU) + 8, 446, 'onset offset 12 ms (< 1 frame)', 'amber', 'start', 12);
          ctx.reveal(fr, { from: 'down', stagger: 50 });
          ctx.reveal(me.curve, { from: 'draw', delay: 600, dur: 900 });
          ctx.reveal(au, { from: 'draw', delay: 1100, dur: 900 });
          ctx.reveal(sync, { delay: 1800 });
          /* right: metrics */
          panelBox(ctx, G, 1230, 170, 330, 290, 'orange');
          head(ctx, G, 1250, 195, 'SYNC BUDGET');
          ctx.para(1250, 228, nb(['1 frame @ 24 fps = 41.7 ms', 'audio lead noticed ≈ 45 ms', 'audio lag noticed  ≈ 125 ms', '', 'MMAudio: 8 s clip', 'in ≈ 1.2 s (H100)', '', 'metric: DeSync (s)']), { size: 13, font: 'mono', color: 'text', lh: 26, parent: G });
          /* architecture */
          panelBox(ctx, G, 60, 480, 1500, 370, 'violet');
          head(ctx, G, 80, 505, 'MMAudio-STYLE ARCHITECTURE · joint attention over video, text and audio tokens', 'violet');
          var ins = [['CLIP visual · 8 fps', 'what', 'violet', 560], ['Synchformer · 24 fps', 'when', 'lime', 640], ['CLIP text', '"impact, ice"', 'amber', 720], ['noisy audio latent x_t', 'mel-VAE', 'orange', 800]];
          var inN = ins.map(function (c) { return ctx.node({ x: 250, y: c[3], w: 320, h: 56, title: c[0], sub: c[1], color: c[2], titleSize: 14, subSize: 11, parent: G }); });
          var mm = ctx.node({ x: 720, y: 640, w: 330, h: 150, title: 'MM-DiT blocks', sub: 'joint attention · aligned RoPE', icon: 'layers', color: 'violet', titleSize: 17, subSize: 12, parent: G });
          var ao = ctx.node({ x: 1080, y: 640, w: 230, h: 60, title: 'audio-only blocks', sub: 'predict velocity v', color: 'orange', titleSize: 14, subSize: 11, parent: G });
          var vo = ctx.node({ x: 1380, y: 640, w: 250, h: 60, title: 'ODE → VAE → BigVGAN', sub: '44.1 kHz foley', color: 'orange', titleSize: 13, subSize: 11, parent: G });
          var ls = inN.map(function (n, k) { return ctx.link(n, mm, { color: ins[k][2], parent: G }); });
          ls.push(ctx.link(mm, ao, { color: 'orange', parent: G }));
          ls.push(ctx.link(ao, vo, { color: 'orange', parent: G }));
          note(ctx, G, 720, 745, 'sync features are also added frame-aligned', 'lime', 'middle', 12);
          note(ctx, G, 720, 765, 'to the audio tokens (24 fps ↔ audio frames)', 'lime', 'middle', 12);
          note(ctx, G, 1230, 720, 'Veo 3-class: audio + video from one', 'dim', 'start', 12);
          note(ctx, G, 1230, 740, 'denoiser → native sync, fused stems', 'dim', 'start', 12);
          ctx.reveal(inN, { from: 'left', stagger: 120, delay: 400 });
          ctx.reveal(mm, { from: 'scale', delay: 800 });
          ctx.reveal([ao, vo], { from: 'left', stagger: 150, delay: 1100 });
          ctx.reveal(ls, { from: 'draw', stagger: 80, delay: 900 });
          ctx.hud('impact at frame 360 · onset within 12 ms');
          return ctx.wait(2000).then(function () {
            return Promise.all(ls.slice(0, 4).map(function (l, k) { return ctx.packet(l, { color: ins[k][2], dur: 700 }); }));
          }).then(function () { return ctx.packet(ls[4], { color: 'orange', dur: 500 }); }).then(function () { return ctx.packet(ls[5], { color: 'orange', dur: 500 }); });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Lip-sync inpainting',
        say: 'Finally, lip sync, one level deeper. LatentSync works in the latent space of an image autoencoder, sixteen frames at a time. For every frame, the network sees the noisy latent, the mask, the masked frame and a reference frame of the fox, stacked as thirteen channels. Whisper audio features for a short window around that frame enter through cross attention. Training adds a SyncNet loss on decoded pixels and a temporal consistency loss so the mouth does not flicker. The result is pasted back with a feathered mask, and every other pixel of the shot stays untouched.',
        deep: '<p><b>Input per frame</b> (SD-1.5 VAE, 256² or 512² face crop → 32²/64² × 4 latents):</p>' +
          '<div class="eq">z<sub>in</sub> = [ z<sub>t</sub> (4) ‖ mask (1) ‖ E(x ⊙ (1 − m)) (4) ‖ E(x<sub>ref</sub>) (4) ] = 13 channels</div>' +
          '<p><b>Audio</b>: Whisper encoder features at 50 Hz; each video frame attends to a window of ±2 frames of audio embeddings through cross-attention in the U-Net (temporal layers make it a 16-frame video model).</p>' +
          '<p><b>Losses</b>:</p><div class="eq">L = L<sub>simple</sub> + λ<sub>1</sub>·L<sub>SyncNet</sub>(decoded) + λ<sub>2</sub>·L<sub>LPIPS</sub> + λ<sub>3</sub>·L<sub>TREPA</sub></div>' +
          '<p>SyncNet: contrastively trained audio and 5-frame mouth encoders; as in Wav2Lip, P<sub>sync</sub> = cos(a, v) (post-ReLU embeddings, so ∈ [0, 1]) and L<sub>sync</sub> = −log P<sub>sync</sub>, a binary cross-entropy toward "in sync". TREPA aligns temporal representations of generated and real clips (from a video self-supervised encoder) to suppress flicker. Lineage: Wav2Lip (GAN + frozen expert) → diffusion-based (DiffTalk, LatentSync, MuseTalk-style one-step inpainting for real time).</p>' +
          '<div class="note">Failure modes: teeth/tongue hallucination, identity drift on stylised faces, jitter at mask borders; mitigations are the reference frame, SAM-2 masks for non-human faces, feathered Poisson-style blending and the SyncNet + ΔY flicker QC gates in the parent chamber.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 3);
          head(ctx, G, 80, 185, '16-FRAME WINDOW · shot S2 · masked lower face');
          var fr = [];
          for (var i = 0; i < 8; i++) {
            var g = ctx.group({ parent: G });
            var x = 90 + i * 118;
            ctx.rect(x, 205, 104, 104, { rx: 5, fill: '#3a1020', stroke: ctx.alpha('white', 0.25), sw: 1, parent: g });
            ctx.poly([[x + 22, 232], [x + 30, 212], [x + 42, 228], [x + 62, 228], [x + 74, 212], [x + 82, 232], [x + 74, 282], [x + 52, 298], [x + 30, 282]], { fill: '#ff8a3d', parent: g });
            ctx.circle(x + 40, 246, 4, { fill: '#10131c', parent: g });
            ctx.circle(x + 64, 246, 4, { fill: '#10131c', parent: g });
            ctx.rect(x + 18, 262, 68, 40, { rx: 4, stroke: 'magenta', sw: 1.4, dash: '4 3', fill: ctx.alpha('magenta', 0.1), parent: g });
            var mo = ctx.el('ellipse', { cx: x + 52, cy: 282, rx: 10, ry: 2 + 8 * Math.abs(Math.sin(i * 0.9 + 0.4)), fill: '#1a0508', stroke: '#ffb070', 'stroke-width': 1 }, g);
            note(ctx, g, x + 52, 322, 'f' + (i + 1), 'dim', 'middle', 11);
            fr.push(g);
          }
          note(ctx, G, 1050, 257, '… f16', 'dim', 'start', 13);
          /* reference frame (identity anchor) */
          var ref = ctx.group({ parent: G });
          var rx0 = 1200;
          ctx.rect(rx0, 205, 104, 104, { rx: 5, fill: '#3a1020', stroke: 'violet', sw: 2, parent: ref, glow: true });
          ctx.poly([[rx0 + 22, 232], [rx0 + 30, 212], [rx0 + 42, 228], [rx0 + 62, 228], [rx0 + 74, 212], [rx0 + 82, 232], [rx0 + 74, 282], [rx0 + 52, 298], [rx0 + 30, 282]], { fill: '#ff8a3d', parent: ref });
          ctx.circle(rx0 + 40, 246, 4, { fill: '#10131c', parent: ref });
          ctx.circle(rx0 + 64, 246, 4, { fill: '#10131c', parent: ref });
          ctx.el('ellipse', { cx: rx0 + 52, cy: 282, rx: 10, ry: 1.5, fill: '#1a0508', stroke: '#ffb070', 'stroke-width': 1 }, ref);
          ctx.para(rx0 + 118, 222, ['x_ref: unmasked', 'reference frame', '(mouth closed)', 'anchors identity,', 'teeth and fur'], { size: 12, font: 'mono', color: 'violet', lh: 19, parent: ref });
          ctx.reveal(ref, { from: 'left', delay: 600 });
          /* audio windows */
          var aw = [];
          for (var j = 0; j < 8; j++) {
            var xa = 90 + j * 118;
            var amp = 0.5 + 0.5 * Math.abs(Math.sin(j + 1));
            aw.push(ctx.vector(xa + 22, 344, 5, { horizontal: true, cell: 11, gap: 2, cmap: 'violet', values: function (r0, c0) { return [0.3, 0.6, 1, 0.6, 0.3][c0] * amp; }, parent: G }));
          }
          note(ctx, G, 90, 374, 'Whisper features, 50 Hz: each frame attends to ±2 audio frames', 'violet');
          ctx.reveal(fr, { from: 'down', stagger: 60 });
          ctx.reveal(aw, { from: 'up', stagger: 60, delay: 500 });
          /* channel stack */
          panelBox(ctx, G, 60, 400, 760, 450, 'orange');
          head(ctx, G, 80, 425, 'U-NET INPUT · 13 latent channels per frame');
          var ch = [['noisy latent z_t', 4, 'orange'], ['mask m', 1, 'magenta'], ['masked frame E(x ⊙ (1−m))', 4, 'cyan'], ['reference frame E(x_ref)', 4, 'violet']];
          var yy = 450, chG = [];
          ch.forEach(function (c) {
            var g = ctx.group({ parent: G });
            for (var q = 0; q < c[1]; q++) ctx.rect(100 + q * 8, yy + q * 5, 150, 22, { rx: 3, fill: ctx.alpha(c[2], 0.18), stroke: c[2], sw: 1, parent: g });
            note(ctx, g, 300, yy + 12 + (c[1] - 1) * 2.5, c[0] + ' · ' + c[1], c[2], 'start', 13);
            yy += 30 + c[1] * 5 + 8;
            chG.push(g);
          });
          var un = ctx.node({ x: 440, y: 740, w: 620, h: 60, title: 'U-Net + temporal layers', sub: 'cross-attn ← Whisper audio · 16 frames', icon: 'layers', color: 'orange', titleSize: 15, subSize: 12, parent: G });
          var lu = ctx.line(440, 690, 440, 706, { color: 'orange', arrow: true, parent: G });
          note(ctx, G, 440, 800, 'predicts ε for the face latent · DDIM 20 steps', 'dim', 'middle', 12);
          note(ctx, G, 440, 824, 'decode → keep only the masked mouth region, feathered paste', 'dim', 'middle', 12);
          ctx.reveal(chG, { from: 'left', stagger: 150, delay: 800 });
          ctx.reveal([lu, un], { delay: 1400, stagger: 150 });
          /* losses + sync */
          panelBox(ctx, G, 860, 400, 700, 450, 'lime');
          head(ctx, G, 880, 425, 'TRAINING SIGNALS', 'lime');
          var loss = [['L_simple', 'denoising MSE', 1], ['L_SyncNet', 'audio–mouth agreement', 0.55], ['L_LPIPS', 'perceptual detail', 0.35], ['L_TREPA', 'temporal consistency', 0.45]];
          var lb = loss.map(function (l, k) {
            var g = ctx.group({ parent: G });
            note(ctx, g, 880, 468 + k * 44, l[0], 'lime', 'start', 14);
            note(ctx, g, 1030, 468 + k * 44, l[1], 'text', 'start', 13);
            ctx.rect(1280, 459 + k * 44, 240 * l[2], 18, { rx: 3, fill: ctx.alpha('lime', 0.3), stroke: 'lime', sw: 1, parent: g });
            return g;
          });
          note(ctx, G, 880, 650, 'SyncNet confidence vs audio–video offset', 'text', 'start', 13);
          var sp = ctx.plot(900, 670, 600, 120, function (x) { return 1.6 + 8.2 * Math.exp(-Math.pow(x / 1.3, 2)); }, { xDomain: [-15, 15], yDomain: [0, 11], color: 'lime', sw: 2, samples: 120, parent: G, glow: true });
          note(ctx, G, 900, 808, '−15', 'dim', 'middle', 11);
          note(ctx, G, 1200, 808, '0', 'dim', 'middle', 11);
          note(ctx, G, 1500, 808, '+15 frames', 'dim', 'end', 11);
          note(ctx, G, 1220, 690, 'peak at 0 · LSE-C 8.0', 'lime', 'start', 12);
          note(ctx, G, 880, 836, 'chamber output: 4 stems + patched S2 → editor agent', 'orange', 'start', 13);
          ctx.reveal(lb, { from: 'right', stagger: 120, delay: 900 });
          ctx.reveal(sp.curve, { from: 'draw', delay: 1500, dur: 1000 });
          ctx.hud('13 ch · 16 frames · SyncNet + TREPA');
          return ctx.wait(2600);
        }
      }
    ]
  });
})();
