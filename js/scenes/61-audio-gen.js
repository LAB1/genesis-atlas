/* L2 — Speech, Music & Lip-Sync. Generative audio for the trailer: text front-end, codec tokens, codec-LM
 * (AR + NAR) and flow-matching TTS, vocoders and streaming, zero-shot cloning with consent, music by
 * token LM vs latent diffusion, video-to-audio foley, and audio-driven lip-sync.
 * Beat format: each step = beats (narration, callout card, deep-dive chunk, gated animation segment). */
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
      S.navChips = NAV.map(function (n, i) { return ctx.label(1000 + i * 142, 112, n, { color: 'dim', size: 12, w: 130, parent: S.nav }); });
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
        beats: [
          {
            say: 'This chamber is the sound department. Four generative jobs run on the audio GPU pool while the video shots are still rendering. The first is text to speech, which speaks the script in the creator\'s cloned voice.',
            card: { tag: 'KEY IDEA', title: 'Four jobs, one output contract', body: 'Each job returns time-stamped audio stems, or one patched shot, by URI. The editor agent places them on the timeline.' },
            deep: '<p>Four different generative problems, one output contract: time-stamped audio stems (or one patched video shot) referenced by URI. They run on a dedicated audio GPU pool while the shots render.</p>' +
              '<p><b>TTS</b> is conditioned on text plus a 3–10 s speaker prompt. Model families in 2025: codec LMs (VALL-E, CosyVoice 2) and flow matching (F5-TTS, E2). Output: 24 kHz speech, resampled to the 48 kHz project rate.</p>'
          },
          {
            say: 'A music model writes a thirty second score to a cue sheet, with the tempo, the key and the moment of the crash written down in advance.',
            card: { tag: 'NUMBERS', title: 'A score to measure', stat: { v: '30 s', u: 'stereo score', l: '44.1 kHz, 96 BPM, D minor, with the build peaking at 15.0 s' } },
            deep: '<p><b>Music</b> is conditioned on a text cue, a tempo and a duration. Families: codec LMs (MusicGen: EnCodec tokens with a delay pattern) and latent diffusion (Stable Audio: a DiT over a VAE latent with timing conditioning).</p>' +
              '<p>Output is a set of 44.1 kHz stereo stems (strings, synth, percussion) kept separate until the final mix, so the editor can re-time or mute any of them without regenerating.</p>'
          },
          {
            say: 'A video to audio model watches each shot and invents synchronized sound effects: the alarm, the whoosh, the impact.',
            card: { tag: 'HOW IT WORKS', title: 'Effects from pixels', body: 'The model reads the frames and a short text, then generates foley whose onsets follow the on-screen motion.' },
            deep: '<p><b>Foley</b> is conditioned on video frames plus text. Video-to-audio flow matching (MMAudio) generates effects synchronised to the picture; joint audio-video generators (Veo 3) can instead emit sound together with the frames.</p>' +
              '<p>Output: one stem per event (five for the trailer), each with its onset aligned to a frame so the editor can nudge any single effect.</p>'
          },
          {
            say: 'And a lip sync model repaints the fox\'s mouth for the one line it speaks on screen, leaving every other pixel of that shot alone.',
            card: { tag: 'HOW IT WORKS', title: 'Only one mouth changes', body: 'Audio-conditioned inpainting regenerates the masked lower face in shot S2. The output is a patched shot, not a stem.' },
            deep: '<p><b>Lip-sync</b> is conditioned on the face video plus the speech: audio-conditioned latent inpainting (LatentSync) repaints only the mouth region of shot S2 so the lips match the syllables of the fox\'s line.</p>' +
              '<p>Because it edits pixels, this is the one job whose output is a video patch rather than an audio stem, and it must run after the narration and the shot exist.</p>'
          },
          {
            say: 'All four return stems that the editor agent places on the timeline. None of this sits on the critical path, because each job needs only seconds of GPU.',
            card: { tag: 'WHY IT MATTERS', title: 'Hidden behind the shot renders', body: 'Seconds of audio GPU hide behind roughly 95 seconds of diffusion per shot. Only URIs cross to the editor.' },
            deep: '<table><tr><th>Job</th><th>Condition</th><th>Model family (2025)</th></tr>' +
              '<tr><td>TTS</td><td>text + 3–10 s speaker prompt</td><td>codec LM (VALL-E, CosyVoice 2), flow matching (F5-TTS, E2)</td></tr>' +
              '<tr><td>Music</td><td>text cue, tempo, duration</td><td>codec LM (MusicGen), latent diffusion (Stable Audio)</td></tr>' +
              '<tr><td>Foley</td><td>video frames + text</td><td>video-to-audio flow matching (MMAudio); joint A/V generators (Veo 3)</td></tr>' +
              '<tr><td>Lip-sync</td><td>face video + speech</td><td>audio-conditioned latent inpainting (LatentSync)</td></tr></table>' +
              '<p>The shared pattern: compress audio into a low-rate representation (codec tokens, mel frames or VAE latents), generate there, then decode back to a 24–48 kHz waveform.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          var lanes = [
            { ins: [['script lines', 'amber'], ['memo · 6 s prompt', 'orange']], t: 'Zero-shot TTS', s: 'codec LM · flow matching', ic: 'mic', out: 'narration · 48 kHz mono' },
            { ins: [['cue sheet · 96 BPM', 'amber']], t: 'Music generator', s: 'token LM · latent DiT', ic: 'music', out: 'score · 30 s · stereo' },
            { ins: [['shot frames S1–S6', 'lime'], ['text: "alarm, impact"', 'amber']], t: 'Video-to-audio', s: 'MMAudio-class · flow', ic: 'film', out: 'foley · 5 events' },
            { ins: [['S2 frames (face)', 'lime'], ['D1 audio', 'orange']], t: 'Lip-sync', s: 'latent inpainting', ic: 'eye', out: 'S2 patched · mouth only' }
          ];
          S.lanes = []; S.laneNodes = [];
          function lane(i) {
            var L = lanes[i], y = 240 + i * 150;
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
            S.lanes.push(g); S.laneNodes.push(n);
            return ctx.reveal(g, { from: 'left', dur: 700 }).then(function () { return ctx.pulse(n, { color: 'orange', times: 1, dur: 600 }); });
          }
          /* beat 0: text to speech */
          ctx.hud('4 jobs · stems by URI · off the critical path');
          return lane(0).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            return lane(1);
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            return lane(2);
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            return lane(3);
          }).then(function () { return ctx.beat(4); }).then(function () {
            if (ctx.dead) return;
            var bus = ctx.line(1545, 200, 1545, 770, { color: ctx.alpha('orange', 0.5), sw: 2, parent: G });
            var bt = ctx.text(1532, 800, 'stems → editor agent (EDL)', { size: 12, font: 'mono', color: 'orange', anchor: 'end', parent: G });
            var bn = ctx.text(80, 842, 'all four run on the audio GPU pool in parallel with shot rendering: seconds of GPU each, off the critical path', { size: 13, font: 'mono', color: 'dim', parent: G });
            return Promise.all([ctx.reveal(bus, { from: 'draw', dur: 900 }), ctx.reveal([bt, bn], { delay: 400, stagger: 200 })]);
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Text & audio tokens',
        beats: [
          {
            say: 'Zoom into speech. Both sides must become tokens. The text is normalized, so numbers and abbreviations are spelled out, and optionally converted to phonemes.',
            card: { tag: 'HOW IT WORKS', title: 'Normalize, then phonemes or characters', body: 'Two front-ends exist in 2025: phonemes (VALL-E, Voicebox) and raw characters or BPE (F5-TTS, CosyVoice), where pronunciation is learned.' },
            deep: '<p><b>Text front-end</b>: normalisation (numbers, units, abbreviations), then either G2P phonemes (VALL-E, Voicebox) or raw characters/BPE (F5-TTS, E2, CosyVoice), letting the model learn pronunciation.</p>' +
              '<p>Phonemes make pronunciation explicit and data-efficient but need a G2P dictionary and fail on names. Characters or BPE remove that dependency and scale with data, at the price of relying on attention to discover pronunciation, especially for heteronyms such as "read".</p>'
          },
          {
            say: 'The audio side needs a neural codec. An encoder squeezes twenty four kilohertz audio into seventy five frames per second.',
            card: { tag: 'NUMBERS', title: 'A frame every 13 ms', stat: { v: '75', u: 'frames per second', l: '24 kHz audio through a conv encoder with total stride 320, so 9,600 samples become 30 frames' } },
            deep: '<p><b>Codec</b> (EnCodec 24 kHz, as in VALL-E): a strided convolutional encoder with total stride 320 = 2·4·5·8 maps a waveform of T samples to T/320 frames of a continuous latent, so 24,000 samples per second become 75 frames per second.</p>' +
              '<p>The 0.4 s slice drawn here is 9,600 samples and 30 frames. The decoder mirrors the encoder with transposed convolutions.</p>'
          },
          {
            say: 'Residual vector quantization describes each frame with eight codebook indices. The first codebook captures most of the signal; each later one encodes what the previous ones missed.',
            card: { tag: 'HOW IT WORKS', title: 'Each codebook fixes the last one\'s error', body: 'Eight quantizers in series: the residual shrinks at every stage, so early rows carry content and later rows carry acoustic detail.', more: '<p>Training uses quantizer dropout: the decoder is sometimes given only the first k codebooks. As a result any prefix q<sub>1..k</sub> decodes to valid audio, and one codec serves many bitrates: 1 codebook is 0.75 kbps, 2 are 1.5 kbps, 8 are 6 kbps at 75 frames per second.</p>' },
            deep: '<div class="eq">r<sub>0</sub> = z,   q<sub>k</sub> = argmin<sub>c∈C<sub>k</sub></sub> ‖r<sub>k−1</sub> − c‖,   r<sub>k</sub> = r<sub>k−1</sub> − q<sub>k</sub>,   ẑ = Σ<sub>k</sub> q<sub>k</sub></div>' +
              '<p>Coarse-to-fine: q<sub>1</sub> carries content and much of speaker identity; q<sub>2..8</sub> add acoustic detail. Training uses quantizer dropout so any prefix of codebooks decodes. Each of the 8 codebooks has 1024 entries, which is 10 bits per index.</p>'
          },
          {
            say: 'Three point eight seconds of narration becomes about two thousand three hundred tokens. That length is what the language model on the next page has to generate.',
            card: { tag: 'NUMBERS', title: 'One line of narration', stat: { v: '2,280', u: 'tokens', l: 'N1 = 3.8 s × 75 frames × 8 codebooks, a 6 kbps stream' } },
            deep: '<table><tr><th>Codec</th><th>Rate</th><th>Tokens/s</th></tr>' +
              '<tr><td>EnCodec 24k (8 q)</td><td>75 Hz</td><td>600</td></tr>' +
              '<tr><td>DAC 44k (9 q)</td><td>86 Hz</td><td>774</td></tr>' +
              '<tr><td>Mimi (Moshi, 8 q)</td><td>12.5 Hz</td><td>100</td></tr>' +
              '<tr><td>CosyVoice 2 semantic (1 q)</td><td>25 Hz</td><td>25</td></tr></table>' +
              '<p>Narration line N1: 3.8 s × 75 = 285 frames × 8 = 2,280 tokens. Lower frame rates shorten LM sequences, which is why 2025 systems moved to 12.5–25 Hz tokens.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          var X = {};
          /* beat 0: text front-end */
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
          var n1 = note(ctx, G, wx + 14, 270, 'normalised', 'dim');
          var n2 = note(ctx, G, wx + 14, 316, 'G2P phonemes', 'dim');
          var alt = ctx.para(1000, 190, nb(['two front-ends in 2025:', '· phonemes (VALL-E, Voicebox)', '· raw chars / BPE (F5-TTS, E2,', '  CosyVoice): pronunciation is learned']), { size: 13, font: 'code', color: 'text', lh: 21, parent: G });
          ctx.hud('text → normalised → phonemes or characters');
          return Promise.all([ctx.reveal(sent, { from: 'up' }), ctx.reveal(wc, { from: 'down', stagger: 60, delay: 300 }), ctx.reveal(pc, { from: 'down', stagger: 60, delay: 700 }), ctx.reveal([n1, n2], { delay: 1000, stagger: 100 }), ctx.reveal(alt, { delay: 1100 })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: the neural codec encoder */
            panelBox(ctx, G, 60, 370, 1500, 480, 'orange');
            var h1 = head(ctx, G, 80, 395, 'NEURAL CODEC · EnCodec 24 kHz · stride 320 → 75 frames/s · RVQ 8 × 1024');
            X.wv = ctx.path(waveD(ctx, 150, 560, 450, 26, 12, function (u) { return envAt(S.sylT, u * 0.4 + 0.2).e * 0.9 + 0.08; }), { stroke: 'orange', sw: 1.2, parent: G });
            var wn = note(ctx, G, 150, 492, '0.4 s of N1 · 9,600 samples', 'dim');
            var enc = ctx.node({ x: 430, y: 530, w: 300, h: 40, title: 'conv encoder · 4 strided blocks (2·4·5·8)', color: 'violet', kind: 'chip', titleSize: 12, glow: false, parent: G });
            var l1 = ctx.line(430, 480, 430, 508, { color: 'violet', arrow: true, parent: G });
            ctx.hud('24 kHz → 75 frames/s · stride 320');
            return Promise.all([ctx.reveal(h1, { delay: 100 }), ctx.reveal(X.wv, { from: 'draw', delay: 200, dur: 900 }), ctx.reveal(wn, { delay: 600 }), ctx.reveal([l1, enc], { delay: 900, stagger: 150 })]).then(function () { return ctx.pulse(enc, { color: 'violet', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: residual vector quantisation, one codebook row at a time */
            var r = ctx.rng(4);
            var vals = []; for (var q = 0; q < 8; q++) { vals.push([]); for (var c = 0; c < 30; c++) vals[q].push(r()); }
            var grid = ctx.matrix(150, 580, 8, 30, { cell: 20, gap: 3, values: function () { return '#0d1424'; }, rowLabels: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'], parent: G });
            var gn = note(ctx, G, 150, 780, '30 frames (0.4 s) × 8 codebook indices (0…1023) = 240 tokens', 'text');
            var l2 = ctx.line(430, 551, 430, 574, { color: 'violet', arrow: true, parent: G });
            var norms = [1, 0.56, 0.38, 0.28, 0.21, 0.17, 0.14, 0.12];
            var rn = note(ctx, G, 890, 572, '‖r_k‖ after stage k', 'dim');
            var nb2 = ctx.bars(890, 590, 240, 160, norms.map(function () { return 0.01; }), { color: 'orange', gap: 8, labels: ['1', '2', '3', '4', '5', '6', '7', '8'], parent: G });
            ctx.hud('8 codebooks × 1024 entries = 6 kbps');
            return Promise.all([ctx.reveal([l2, gn, rn], { stagger: 100 }), ctx.reveal(grid, { delay: 100 })]).then(function () {
              return ctx.tween(2400, function (t) {
                var rows = t * 8;
                for (var q = 0; q < 8; q++) for (var c = 0; c < 30; c++) {
                  var on = rows > q + c / 30;
                  grid.cells[q][c].setAttribute('fill', on ? ctx.mix('#2a1406', q ? ctx.C.orange : ctx.C.amber, (0.35 + 0.65 * vals[q][c]) * (1 - q * 0.07)) : '#0d1424');
                }
              }, 'linear');
            }).then(function () { return nb2.update(norms, 700); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: the token budget */
            var mp = ctx.para(1180, 440, nb(['N1 = 3.8 s', '× 75 frames/s   = 285 frames', '× 8 codebooks   = 2,280 tokens', '', 'bitrate: 75 × 8 × 10 bit = 6 kbps', '', 'Mimi 12.5 Hz × 8   = 100 tok/s', 'CosyVoice 2 25 Hz × 1 = 25 tok/s']), { size: 14, font: 'code', color: 'text', lh: 26, parent: G });
            ctx.hud('3.8 s → 285 frames × 8 q = 2,280 tokens');
            return ctx.reveal(mp, { from: 'left', dur: 700 }).then(function () { return ctx.pulse(mp, { color: 'orange', times: 1, dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Codec language model',
        beats: [
          {
            say: 'Now a codec language model, VALL-E style. The creator\'s prompt, its transcript, and the target text form a prefix, and the model continues that sequence.',
            card: { tag: 'KEY IDEA', title: 'Text is a prefix, not a timeline', body: 'Phonemes and the prompt\'s codec tokens are concatenated. Nothing aligns text to time; the model learns rhythm from data.' },
            deep: '<p>VALL-E factorises the codec token matrix C ∈ {0..1023}<sup>T×8</sup> given phonemes x and the prompt\'s tokens C̃:</p>' +
              '<div class="eq">p(C | x, C̃) = Π<sub>t</sub> p(c<sub>t,1</sub> | c<sub>&lt;t,1</sub>, x, C̃<sub>:,1</sub>) · Π<sub>j=2</sub><sup>8</sup> p(c<sub>:,j</sub> | C<sub>:,&lt;j</sub>, x, C̃)</div>' +
              '<p>The prefix is [prompt transcript ‖ target phonemes ‖ prompt codes], and generation continues after it. The prompt supplies timbre and recording conditions in context, which is why no fine-tuning is needed.</p>'
          },
          {
            say: 'An autoregressive transformer then predicts the first codebook one frame at a time, which fixes content, rhythm and timbre.',
            card: { tag: 'HOW IT WORKS', title: 'AR over the first codebook', body: 'A causal decoder emits q1, one frame per step, sampled with top-p. It is the expressive stage, and the one that can fail.' },
            deep: '<ul><li><b>AR stage</b>: decoder-only transformer, causal, sampled (top-p / repetition-aware sampling in VALL-E 2) → prosodic diversity, but also failure modes: skipped or repeated words, run-on silence.</li>' +
              '<li><b>Guards</b>: maximum length from text length, a CTC/ASR re-check of the output, and re-sampling on failure.</li></ul>' +
              '<p>Cost: 285 sequential decode steps for line N1, roughly 1.5–3 s of wall-clock at 5–10 ms per step for a few-hundred-million-parameter model with a KV cache. The prefix, about two thirds of the sequence, is prefilled once and cached.</p>'
          },
          {
            say: 'The remaining seven codebooks are filled by a non autoregressive model, one whole codebook per pass, conditioned on everything coarser.',
            card: { tag: 'HOW IT WORKS', title: 'Seven parallel passes', body: 'A bidirectional transformer with a codebook-id embedding predicts all frames of codebook j at once, given codebooks below j.' },
            deep: '<ul><li><b>NAR stage</b>: bidirectional transformer with a learned codebook-id embedding; greedy per codebook; 7 passes regardless of T.</li></ul>' +
              '<p>Each pass sees the acoustic prompt and the sum of the embeddings of all coarser codebooks, so q<sub>j</sub> adds fine acoustic detail (breath, room, spectral fine structure) on top of what q<sub>1</sub> decided. Being non-autoregressive, each pass costs one full-sequence forward, so the total is 7 forwards, not 7 × 285.</p>'
          },
          {
            say: 'So two hundred eighty five sequential steps and seven parallel passes replace two thousand two hundred eighty sequential steps.',
            card: { tag: 'NUMBERS', title: 'Sequential work saved', stat: { v: '285 + 7', u: 'vs 2,280', l: 'sequential AR steps plus NAR passes, instead of a flat decode over every token' } },
            deep: '<p>Flattening all 8 codebooks into one AR sequence would need T × 8 = 2,280 sequential steps. The AR + NAR split cuts that by nearly 8× without the quality loss of predicting all codebooks in parallel, because q<sub>1</sub> carries most of the information.</p>' +
              '<p>The trade-off is two models to train and serve, and NAR passes that cannot condition on the future of their own codebook.</p>'
          },
          {
            say: 'Production systems today keep the autoregressive idea but change the tokens: a language model predicts one semantic codebook at twenty five hertz, a flow matching decoder renders the mel spectrogram, and a vocoder makes the waveform.',
            card: { tag: 'STATE OF THE ART', title: 'CosyVoice 2 style pipeline', body: 'One codebook at 25 Hz means 3× shorter sequences, better robustness and streaming, with flow matching restoring the acoustic detail.' },
            deep: '<div class="note">2025 production variant (CosyVoice 2, Seed-TTS, MiniMax-Speech): a text-speech LM, often initialised from a general LLM, predicts <b>single-codebook semantic tokens</b> at 25 Hz; a <b>flow-matching</b> decoder then renders mel conditioned on the speaker, and a vocoder makes the waveform. Same AR idea, far shorter sequences, better robustness.</div>' +
              '<p>The speaker enters as prompt tokens plus a global embedding, and the whole chain can run chunk by chunk for streaming, which the vocoder page returns to.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          var X0 = 440, Y0 = 340, P = 21, NC = 36, NP = 12;
          var r = ctx.rng(9);
          var vals = []; for (var q = 0; q < 8; q++) { vals.push([]); for (var c = 0; c < NC; c++) vals[q].push(r()); }
          var cur, step, pass;
          /* beat 0: prefix = prompt transcript + target phonemes + prompt codes */
          var h0 = head(ctx, G, 80, 185, 'CODEC LANGUAGE MODEL · AR over q1, NAR over q2…q8');
          var br1 = ctx.rect(X0, 276, NP * P - 3, 34, { rx: 5, fill: ctx.alpha('violet', 0.12), stroke: 'violet', sw: 1, parent: G });
          var t1 = note(ctx, G, X0 + (NP * P) / 2, 293, 'prompt transcript', 'violet', 'middle');
          var br2 = ctx.rect(X0 + NP * P, 276, (NC - NP) * P - 3, 34, { rx: 5, fill: ctx.alpha('amber', 0.1), stroke: 'amber', sw: 1, parent: G });
          var t2 = note(ctx, G, X0 + NP * P + ((NC - NP) * P) / 2, 293, 'target phonemes: twɛlv aʊɚz æftɚ ɪmpækt ðə aɪs …', 'amber', 'middle');
          var t3 = note(ctx, G, X0, 250, 'prefix = [phonemes x ; prompt codes C_p] → generate C · text is a prefix, not time-aligned', 'dim');
          var grid = ctx.matrix(X0, Y0, 8, NC, { cell: 18, gap: 3, values: function (q, c) { return c < NP ? ctx.mix('#150c2c', ctx.C.violet, 0.35 + 0.5 * vals[q][c]) : '#0d1424'; }, rowLabels: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'], parent: G });
          var g1 = note(ctx, G, X0 + (NP * P) / 2, Y0 + 186, 'memo prompt C_p · 6 s = 450 frames', 'violet', 'middle');
          var g2 = note(ctx, G, X0 + NP * P + ((NC - NP) * P) / 2, Y0 + 186, 'generated N1 · 285 frames →  (columns schematic)', 'orange', 'middle');
          ctx.hud('prefix: transcript + phonemes + prompt codes');
          return Promise.all([ctx.reveal(h0, { delay: 100 }), ctx.reveal([br1, br2, t1, t2, t3], { delay: 200, stagger: 100 }), ctx.reveal(grid, { delay: 500 }), ctx.reveal([g1, g2], { delay: 900, stagger: 150 })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: autoregressive decoding of q1 */
            var ar = ctx.node({ x: 230, y: Y0 + 9, w: 300, h: 50, title: 'AR decoder · causal', sub: 'q1: one frame per step', color: 'amber', titleSize: 14, subSize: 11, parent: G });
            var la = ctx.link(ar, { x: X0 - 30, y: Y0 + 9 }, { color: 'amber', straight: true, parent: G });
            cur = ctx.rect(X0 + NP * P - 3, Y0 - 3, 24, 24, { rx: 4, stroke: 'white', sw: 2, glow: true, parent: G });
            step = note(ctx, G, X0 + NC * P + 14, Y0 + 9, 'AR step 0 / 285', 'amber', 'start', 13);
            var samp = ctx.para(1380, 270, ['AR sampling:', 'top-k / top-p, T ≈ 1', 'VALL-E 2: repetition-', 'aware sampling', '', 'guards:', 'max len ∝ text len', 'ASR re-check → resample'], { size: 12, font: 'mono', color: 'text', lh: 20, parent: G });
            ctx.hud('AR: 285 steps for q1');
            return Promise.all([ctx.reveal(ar, { from: 'left' }), ctx.reveal(la, { from: 'draw', delay: 300 }), ctx.reveal([cur, step], { delay: 400 }), ctx.reveal(samp, { delay: 600 })]).then(function () {
              return ctx.tween(2600, function (t) {
                var n = Math.floor(t * (NC - NP) + 0.0001);
                for (var c = NP; c < NC; c++) grid.cells[0][c].setAttribute('fill', c - NP < n ? ctx.mix('#2a1406', ctx.C.amber, 0.4 + 0.6 * vals[0][c]) : '#0d1424');
                cur.setAttribute('x', X0 + Math.min(NC - 1, NP + n) * P - 3);
                step.textContent = 'AR step ' + Math.round(t * 285) + ' / 285';
              }, 'linear');
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: non-autoregressive passes over q2..q8 */
            var nar = ctx.node({ x: 230, y: Y0 + 105, w: 300, h: 110, title: 'NAR decoder', sub: 'bidirectional · codebook id j', color: 'orange', titleSize: 14, subSize: 11, parent: G });
            var ln = ctx.link(nar, { x: X0 - 30, y: Y0 + 105 }, { color: 'orange', straight: true, parent: G });
            pass = note(ctx, G, X0 + NC * P + 14, Y0 + 105, 'NAR pass 0 / 7', 'orange', 'start', 13);
            ctx.hud('NAR: 7 passes for q2…q8');
            cur.setAttribute('y', Y0 + P - 3); cur.setAttribute('x', X0 + NP * P - 3); cur.setAttribute('width', (NC - NP) * P + 3);
            return Promise.all([ctx.reveal(nar, { from: 'left' }), ctx.reveal(ln, { from: 'draw', delay: 300 }), ctx.reveal(pass, { delay: 400 })]).then(function () {
              return ctx.tween(2100, function (t) {
                var rows = Math.floor(t * 7 + 0.0001);
                for (var q = 1; q < 8; q++) for (var c = NP; c < NC; c++) grid.cells[q][c].setAttribute('fill', q <= rows ? ctx.mix('#2a1406', ctx.C.orange, (0.35 + 0.65 * vals[q][c]) * (1 - q * 0.06)) : '#0d1424');
                var rr = Math.min(7, rows + 1);
                cur.setAttribute('y', Y0 + rr * P - 3);
                pass.textContent = 'NAR pass ' + rows + ' / 7';
              }, 'linear');
            }).then(function () { cur.setAttribute('opacity', 0); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: the cost comparison */
            var pb = panelBox(ctx, G, 60, 600, 700, 250, 'amber');
            var hh = head(ctx, G, 80, 625, 'SEQUENTIAL WORK FOR N1 (T = 285)', 'amber');
            var cb = ctx.bars(100, 660, 400, 140, [0.01, 0.01, 0.01], { color: ['amber', 'orange', 'dim'], gap: 40, labels: ['AR q1: 285', 'NAR: 7', 'flat AR: 2,280'], parent: G });
            var ns = [note(ctx, G, 530, 690, 'AR fixes content, rhythm,', 'text'), note(ctx, G, 530, 712, 'timbre (q1 ≈ most info)', 'text'), note(ctx, G, 530, 750, 'NAR adds detail in 7', 'text'), note(ctx, G, 530, 772, 'full-sequence passes', 'text')];
            ctx.hud('285 AR steps + 7 NAR passes vs 2,280 flat');
            return Promise.all([ctx.reveal([pb, hh].concat(ns), { stagger: 60 }), ctx.reveal(cb, { delay: 200 }), ctx.wait(300).then(function () { return cb.update([285 / 2280, 7 / 2280 * 8, 1], 1200); })]);
          }).then(function () { return ctx.beat(4); }).then(function () {
            if (ctx.dead) return;
            /* beat 4: the 2025 variant */
            var pb2 = panelBox(ctx, G, 800, 600, 760, 250, 'orange');
            var h2 = head(ctx, G, 820, 625, '2025 VARIANT · CosyVoice 2 / Seed-TTS');
            var chain = [['text', 870, 100], ['LLM → semantic 25 Hz', 1045, 168], ['flow match → mel', 1235, 168], ['vocoder', 1400, 110]];
            var cn = chain.map(function (s, k) { return ctx.node({ x: s[1], y: 700, w: s[2], h: 44, title: s[0], color: k === 1 ? 'amber' : 'orange', kind: 'chip', titleSize: 12, glow: false, parent: G }); });
            var cl = []; for (var k = 0; k < 3; k++) cl.push(ctx.link(cn[k], cn[k + 1], { color: 'dim', straight: true, parent: G }));
            var ns2 = [note(ctx, G, 820, 770, 'speaker enters as prompt tokens + embedding; 3× shorter', 'dim'), note(ctx, G, 820, 792, 'sequences than 75 Hz codec tokens (1 codebook, 25 Hz),', 'dim'), note(ctx, G, 820, 814, 'streamable chunk by chunk', 'dim')];
            ctx.hud('1 codebook · 25 Hz · streamable');
            return Promise.all([ctx.reveal([pb2, h2], { stagger: 60 }), ctx.reveal(cn, { from: 'up', stagger: 100, delay: 300 }), ctx.reveal(cl, { from: 'draw', stagger: 100, delay: 600 }), ctx.reveal(ns2, { delay: 900, stagger: 120 })]).then(function () { return ctx.pulse(cn[1], { color: 'amber', times: 2, dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Flow-matching TTS',
        beats: [
          {
            say: 'The alternative is fully non autoregressive. F5 TTS and E2 treat speech synthesis as infilling a mel spectrogram: the prompt\'s mel frames are kept, and the target region starts as pure Gaussian noise.',
            card: { tag: 'KEY IDEA', title: 'Speech as spectrogram infilling', body: 'The memo\'s mel frames stay as context. The 3.8 s target is a blank of noise, and the model fills it in a few parallel steps.' },
            deep: '<p><b>Conditional flow matching</b> (Voicebox, E2, F5-TTS): learn a velocity field that transports noise x<sub>0</sub> ~ N(0, I) to data x<sub>1</sub> (log-mel frames) along the optimal-transport path.</p>' +
              '<ul><li><b>Infilling</b>: training masks 70–100 % of frames; the unmasked frames are the in-context prompt. At inference the prompt mel is given and the target span is masked.</li></ul>' +
              '<p>Mel at 24 kHz with hop 256 is 93.75 frames per second, so 6.0 s of prompt plus 3.8 s of target is 919 frames of 100 or 80 mel bins.</p>'
          },
          {
            say: 'The text characters are simply padded with filler tokens to the full length, with no alignment at all. The transformer has to discover which character belongs where.',
            card: { tag: 'TRADE-OFF', title: 'No aligner, but a fixed length', body: 'Attention learns the alignment. The price: total duration must be chosen up front, from the character ratio or a small predictor.' },
            deep: '<ul><li><b>Text</b>: the characters of [prompt transcript ‖ target text] are padded with filler tokens to the mel length; nothing aligns chars to frames, the attention learns it. Here about 90 + 50 characters sit in 919 frames.</li>' +
              '<li><b>Duration</b>: total length = prompt length × (chars<sub>total</sub> / chars<sub>prompt</sub>), or a small duration predictor.</li></ul>' +
              '<p>Trade-off against codec LMs: fully parallel and robust (no skipped or repeated words), but not natively streaming, and the duration cannot adapt mid-sentence.</p>'
          },
          {
            say: 'A transformer predicts a velocity field, and an ordinary differential equation carries the noise to speech along nearly straight paths, in about thirty two function evaluations.',
            card: { tag: 'NUMBERS', title: 'Straight paths, few steps', stat: { v: '32', u: 'NFE', l: 'Euler steps of the flow ODE; F5-TTS reports RTF 0.15 and 2.4 percent WER' } },
            deep: '<div class="eq">x<sub>t</sub> = (1 − t)·x<sub>0</sub> + t·x<sub>1</sub>,    L = E ‖ v<sub>θ</sub>(x<sub>t</sub>, t, x<sub>ctx</sub>, y) − (x<sub>1</sub> − x<sub>0</sub>) ‖²  over masked frames</div>' +
              '<p>The optimal-transport path is a straight line, so a coarse Euler solver is accurate; curved diffusion paths need many more steps. <b>CFG</b>: v = v(c) + w·(v(c) − v(∅)), w ≈ 2.</p>' +
              '<p>F5-TTS (≈336 M params, DiT + ConvNeXt text encoder) reports RTF ≈ 0.15 at 32 NFE, WER ≈ 2.4 % on LibriSpeech-PC.</p>'
          },
          {
            say: 'Sway sampling spends more of those steps at small times, where coarse structure forms. Watch the target region condense into harmonics and formants as the counter climbs.',
            card: { tag: 'STATE OF THE ART', title: 'Sway sampling', body: 'Warping the time grid so half of the 32 steps land below t = 0.29 gives more accuracy where coarse spectral structure appears.', more: '<p>With s = −1 the warp is t′ = 1 − cos(πt/2). The step at k/32 lands at t′(k/32); half the steps (k ≤ 16) fall below t′(0.5) = 1 − cos(π/4) ≈ 0.29. Early time is where the model decides pitch contour and formant layout, so extra steps there help more than near t = 1, where only fine detail changes.</p>' },
            deep: '<ul><li><b>Sampling</b>: Euler/midpoint ODE with 16–32 NFE; F5-TTS uses <i>sway sampling</i> t′ = t + s(cos(πt/2) − 1 + t), s = −1, which spends more steps at small t where structure forms.</li></ul>' +
              '<p>Trade-off vs codec LMs: no streaming out of the box (a chunked variant exists), but robust, parallel, and often the best word error rate at a given quality. Both families end in the same place: a mel spectrogram or codec latent that a vocoder turns into sound.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          var MW = 300, MH = 80, NPC = 184;          /* 300 columns; first 184 = 6.0 s prompt, rest = 3.8 s target */
          var MX = 100, MY = 310, MWp = 1000, MHp = 240;
          var tgtX = MX + MWp * NPC / MW;
          var noiseEl, nfe, dots = [];
          /* beat 0: the mel: a kept prompt, a noise target */
          var h0 = head(ctx, G, 80, 185, 'FLOW MATCHING · infill the target mel (F5-TTS / E2 / Voicebox)');
          var rN = ctx.rng(77);
          var mel = bmp(MW, MH, function (x, y) {
            var b = MH - 1 - y, t, E;
            if (x < NPC) { t = x / NPC * 6.0; E = envAt(S.sylP, t); } else { t = (x - NPC) / (MW - NPC) * 3.8; E = envAt(S.sylT, t); }
            return cm(melVal(E, t, b, rN()));
          });
          var noise = bmp(MW - NPC, MH, function () { var u = rN() + rN() + rN() - 1.5; return cm(0.45 + 0.28 * u); });
          var mg = ctx.group({ parent: G });
          image(ctx, mg, mel, MX, MY, MWp, MHp);
          noiseEl = image(ctx, mg, noise, tgtX, MY, MX + MWp - tgtX, MHp);
          ctx.rect(MX, MY, MWp, MHp, { rx: 2, stroke: ctx.alpha('orange', 0.5), sw: 1, parent: mg });
          ctx.line(tgtX, MY - 6, tgtX, MY + MHp + 6, { color: 'white', sw: 1.5, dash: '4 3', parent: mg });
          var mn = [note(ctx, G, MX + 6, MY + MHp + 18, 'prompt mel (kept, unmasked) · 6.0 s · memo 12–18 s', 'violet'), note(ctx, G, tgtX + 6, MY + MHp + 18, 'target 3.8 s: x₀ ~ N(0, I) → x₁', 'orange'),
            note(ctx, G, MX - 8, MY + 10, '8k', 'dim', 'end', 11), note(ctx, G, MX - 8, MY + MHp - 8, '0', 'dim', 'end', 11)];
          nfe = ctx.text(MX + MWp, 292, 'NFE 0 / 32 · t = 0.00', { size: 14, font: 'mono', color: 'white', anchor: 'end', parent: G });
          ctx.hud('919 mel frames · 6.0 s prompt + 3.8 s target');
          return Promise.all([ctx.reveal(h0, { delay: 100 }), ctx.reveal(mg, { from: 'left', delay: 200, dur: 800 }), ctx.reveal(mn.concat([nfe]), { delay: 800, stagger: 100 })]).then(function () { return ctx.pulse(noiseEl, { color: 'orange', times: 2, dur: 600 }); }).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: the text row: characters padded with filler to the mel length */
            var tx0 = 100, twid = 1000, fr1 = 90 / 919, fr2 = 50 / 919;
            var tg = ctx.group({ parent: G });
            ctx.rect(tx0, 232, twid * fr1, 30, { rx: 5, fill: ctx.alpha('violet', 0.16), stroke: 'violet', sw: 1, parent: tg });
            note(ctx, tg, tx0 + twid * fr1 / 2, 247, 'prompt', 'violet', 'middle', 11);
            ctx.rect(tx0 + twid * fr1, 232, twid * fr2, 30, { rx: 5, fill: ctx.alpha('amber', 0.16), stroke: 'amber', sw: 1, parent: tg });
            note(ctx, tg, tx0 + twid * (fr1 + fr2 / 2), 247, 'N1', 'amber', 'middle', 11);
            ctx.rect(tx0 + twid * (fr1 + fr2), 232, twid * (1 - fr1 - fr2), 30, { rx: 5, fill: 'rgba(123,140,171,0.08)', stroke: ctx.alpha('dim', 0.6), sw: 1, dash: '4 3', parent: tg });
            note(ctx, tg, tx0 + twid * (fr1 + fr2) + 12, 247, '⟨F⟩ ⟨F⟩ ⟨F⟩ …  filler up to 919 mel frames · chars not aligned to the audio', 'dim');
            var tn = note(ctx, G, tx0, 280, 'text = prompt transcript ‖ target text ‖ filler — no aligner, no duration model', 'text');
            ctx.hud('chars ‖ filler: no aligner needed');
            return Promise.all([ctx.reveal(tg, { from: 'left', dur: 800 }), ctx.reveal(tn, { delay: 500 })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: probability paths, and the ODE */
            var pb = panelBox(ctx, G, 1140, 170, 420, 390, 'orange');
            var hp = head(ctx, G, 1160, 195, 'PROBABILITY PATHS');
            var pl = ctx.plot(1180, 230, 360, 250, function () { return -9; }, { xDomain: [0, 1], yDomain: [0, 1], color: 'none', axes: false, parent: G });
            var rr = ctx.rng(12), As = [], Bs = [], pg = ctx.group({ parent: G });
            for (var i = 0; i < 7; i++) { As.push({ x: 0.05 + 0.2 * rr(), y: 0.1 + 0.8 * rr() }); Bs.push({ x: 0.78 + 0.18 * rr(), y: 0.25 + 0.5 * rr() }); }
            /* OT coupling in 1-D: pair sorted with sorted, so straight paths do not cross */
            As.sort(function (p, q) { return p.y - q.y; }); Bs.sort(function (p, q) { return p.y - q.y; });
            for (i = 0; i < 7; i++) {
              var a = As[i], b = Bs[i];
              var A = pl.toPx(a.x, a.y), B = pl.toPx(b.x, b.y);
              ctx.path('M' + A.x + ',' + A.y + ' Q' + (A.x + B.x) / 2 + ',' + (A.y + (i % 2 ? -90 : 90)) + ' ' + B.x + ',' + B.y, { stroke: ctx.alpha('dim', 0.6), sw: 1.2, dash: '3 4', parent: pg });
              ctx.line(A.x, A.y, B.x, B.y, { color: ctx.alpha('orange', 0.9), sw: 1.6, parent: pg });
              ctx.circle(A.x, A.y, 4, { fill: 'dim', parent: pg });
              ctx.circle(B.x, B.y, 4, { fill: 'orange', parent: pg });
              dots.push({ A: A, B: B, el: ctx.circle(A.x, A.y, 5, { fill: 'white', parent: pg, glow: true }) });
            }
            var pn = [note(ctx, G, 1180, 500, 'x₀ noise', 'dim'), note(ctx, G, 1540, 500, 'x₁ speech', 'orange', 'end'), note(ctx, G, 1160, 528, 'solid: OT straight path (few NFE)', 'orange'), note(ctx, G, 1160, 548, 'dashed: curved diffusion path', 'dim')];
            /* bottom: the ODE */
            var bb = panelBox(ctx, G, 60, 600, 1500, 250, 'orange');
            var hb = head(ctx, G, 80, 625, 'THE ODE · one velocity field, 32 Euler steps');
            var eqs = ctx.para(100, 750, nb(['train:  x_t = (1−t)·x₀ + t·x₁ ,   target velocity  u = x₁ − x₀', 'sample: x ← x + Δt · [ v(c) + w·(v(c) − v(∅)) ] ,   w ≈ 2', 'F5-TTS ≈ 336 M params · RTF ≈ 0.15 @ 32 NFE · WER ≈ 2.4 %']), { size: 14, font: 'code', color: 'text', lh: 28, parent: G });
            ctx.hud('32 NFE · RTF ≈ 0.15 · no aligner');
            return Promise.all([ctx.reveal([pb, hp], { stagger: 60 }), ctx.reveal(pg, { delay: 300, dur: 800 }), ctx.reveal(pn, { delay: 800, stagger: 100 }), ctx.reveal([bb, hb], { delay: 200, stagger: 60 }), ctx.reveal(eqs, { delay: 700 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: sway schedule and the denoising run */
            var sch = ctx.group({ parent: G });
            ctx.line(100, 690, 1100, 690, { color: 'faint', parent: sch });
            for (var k = 0; k <= 32; k++) {
              var t0 = k / 32, ts = t0 + (-1) * (Math.cos(Math.PI * t0 / 2) - 1 + t0);
              ctx.line(100 + ts * 1000, 678, 100 + ts * 1000, 702, { color: 'orange', sw: 1.5, parent: sch });
            }
            note(ctx, sch, 100, 662, 'sway schedule: 32 steps, denser near t = 0 where structure forms', 'orange');
            note(ctx, sch, 100, 718, 't = 0', 'dim', 'middle');
            note(ctx, sch, 1100, 718, 't = 1', 'dim', 'middle');
            var sway = ctx.para(1170, 650, nb(['sway: t′ = t + s·(cos(πt/2) − 1 + t)', 's = −1  ⇒  t′ = 1 − cos(πt/2)', 'half of the 32 steps land below t′ ≈ 0.29', 'where coarse spectral structure forms']), { size: 13, font: 'mono', color: 'amber', lh: 26, parent: G });
            ctx.hud('sway: half the steps below t ≈ 0.29');
            return Promise.all([ctx.reveal(sch, { delay: 100 }), ctx.reveal(sway, { delay: 400 })]).then(function () {
              return ctx.tween(3600, function (t) {
                var n = Math.round(t * 32), t0 = n / 32, ts = t0 - (Math.cos(Math.PI * t0 / 2) - 1 + t0);
                noiseEl.setAttribute('opacity', (1 - ts).toFixed(3));
                nfe.textContent = 'NFE ' + n + ' / 32 · t = ' + ts.toFixed(2);
                dots.forEach(function (d) { d.el.setAttribute('cx', d.A.x + (d.B.x - d.A.x) * ts); d.el.setAttribute('cy', d.A.y + (d.B.y - d.A.y) * ts); });
              }, 'linear');
            });
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Vocoder & streaming',
        beats: [
          {
            say: 'Mel frames and codec tokens are not sound yet. A vocoder turns them into a waveform. One mel frame holds eighty values and covers about ten milliseconds.',
            card: { tag: 'NUMBERS', title: 'Frames to samples', stat: { v: '256', u: 'samples per frame', l: 'one mel frame, 10.7 ms at 24 kHz with hop 256, must become 256 waveform samples' } },
            deep: '<p>A mel spectrogram has one column per hop of 256 samples: 24,000 / 256 = 93.75 frames per second, 80 mel bins each. That is only 80 × 93.75 = 7,500 numbers per second against 24,000 samples, roughly a 3× reduction, and it discards phase entirely.</p>' +
              '<p>The vocoder\'s job is to invent a plausible phase and fine structure consistent with the magnitudes, and to do it fast: it runs on every frame of every utterance.</p>'
          },
          {
            say: 'HiFi-GAN upsamples each frame with transposed convolutions, eight, eight, two and two, so one frame becomes two hundred fifty six samples, and adversarial discriminators judge periodic structure.',
            card: { tag: 'HOW IT WORKS', title: 'Upsample by 8, 8, 2, 2', body: 'Four transposed convolutions multiply the rate by 256. Multi-period discriminators reshape the waveform into 2-D grids to catch periodic artifacts.', more: '<p>Tensor shapes for HiFi-GAN V1 on T mel frames: [80, T] → conv → [512, T] → ×8 → [256, 8T] → ×8 → [128, 64T] → ×2 → [64, 128T] → ×2 → [32, 256T] → conv + tanh → [1, 256T]. Halving the channel width at each stage keeps the cost per stage roughly constant while the time axis grows.</p>' },
            deep: '<p><b>HiFi-GAN</b> generator: mel (80 × T) → conv → [ConvTranspose ×8 → MRF] → [×8 → MRF] → [×2] → [×2] → tanh. 8·8·2·2 = 256 = hop size (22.05/24 kHz). Multi-receptive-field (MRF) residual blocks mix dilations 1/3/5.</p>' +
              '<div class="eq">L<sub>G</sub> = Σ<sub>D</sub> (D(G(s)) − 1)² + 2·L<sub>FM</sub> + 45·‖mel(x) − mel(G(s))‖<sub>1</sub></div>' +
              '<p>Discriminators: <b>MPD</b> reshapes the waveform to 2-D with periods p ∈ {2, 3, 5, 7, 11} to catch periodic artifacts; <b>MSD</b> (or multi-resolution STFT) judges at several scales. BigVGAN adds anti-aliased Snake activations for out-of-domain robustness.</p>'
          },
          {
            say: 'Vocos instead predicts a short time Fourier spectrum, magnitude and phase, and applies one inverse FFT, which is much faster.',
            card: { tag: 'TRADE-OFF', title: 'Predict the spectrum, not the samples', body: 'Vocos stays at frame rate and inverts with an iSTFT. No upsampling layers, so roughly an order of magnitude faster than HiFi-GAN at similar quality.' },
            deep: '<p><b>Vocos</b>: a ConvNeXt backbone stays at the frame rate and predicts |X| and φ per STFT bin; x = iSTFT(|X|·e<sup>iφ</sup>). No upsampling layers, so it runs roughly an order of magnitude faster than HiFi-GAN at similar quality.</p>' +
              '<p>Codec decoders (EnCodec, DAC, Mimi) play the same role for token models. The cost of the Fourier route is phase: the network must predict it, wrapped into (−π, π], which is why the loss adds phase-aware terms.</p>'
          },
          {
            say: 'For interactive previews the whole chain streams in chunks, and the first audio can play after about a hundred and fifty milliseconds.',
            card: { tag: 'NUMBERS', title: 'Time to first sound', stat: { v: '≈ 150', u: 'ms', l: 'first packet in a chunk-aware causal flow-matching plus vocoder chain (CosyVoice 2 class)' } },
            deep: '<p><b>Streaming</b>: chunk-aware causal flow matching + causal vocoder (CosyVoice 2 reports ≈150 ms first-packet latency). Budget: text chunk → ~15 LM tokens → FM on a 0.5–1 s chunk (few NFE) → vocoder; later chunks pipeline, so steady-state RTF ≪ 1.</p>' +
              '<p>For the trailer, offline quality mode is used; streaming serves the live preview in the editor UI, where a creator wants to hear a line before committing GPU time to the full render.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          var col;
          /* beat 0: a mel slice, one column highlighted */
          var h0 = head(ctx, G, 80, 185, 'VOCODER · frames → samples');
          var rN = ctx.rng(5);
          var mel = bmp(40, 80, function (x, y) { var t = 1.0 + x / 40 * 0.8; return cm(melVal(envAt(S.sylT, t), t, 79 - y, rN())); });
          var mg = ctx.group({ parent: G });
          image(ctx, mg, mel, 80, 220, 200, 240);
          ctx.rect(80, 220, 200, 240, { rx: 2, stroke: ctx.alpha('orange', 0.5), sw: 1, parent: mg });
          col = ctx.rect(176, 216, 8, 248, { rx: 2, stroke: 'white', sw: 2, glow: true, parent: mg });
          var mn = [note(ctx, G, 180, 482, '1 mel frame = 80 values', 'text', 'middle'), note(ctx, G, 180, 502, '10.7 ms @ 24 kHz, hop 256', 'dim', 'middle')];
          ctx.hud('1 mel frame = 256 samples');
          return Promise.all([ctx.reveal(h0, { delay: 100 }), ctx.reveal(mg, { from: 'left', delay: 200 }), ctx.reveal(mn, { delay: 700, stagger: 100 })]).then(function () {
            return ctx.tween(1400, function (t) { col.setAttribute('x', 84 + t * 188); }, 'inOut');
          }).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: the HiFi-GAN upsampling stack, the output waveform, the MPD discriminators */
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
            var wf = ctx.path(waveD(ctx, 900, 640, 330, 70, 21, function (u) { return 0.2 + 0.8 * Math.abs(Math.sin(u * 5.5)) * Math.exp(-u * 0.6); }), { stroke: 'orange', sw: 1.2, parent: G });
            var wn = note(ctx, G, 900, 425, '256 samples per frame · 24,000 samples/s', 'text');
            var lk2 = ctx.line(870, 330, 894, 330, { color: 'orange', arrow: true, parent: G });
            var pb = panelBox(ctx, G, 900, 450, 660, 150, 'orange');
            var hd = head(ctx, G, 920, 474, 'TRAINING SIGNAL · MPD reshapes 1-D → 2-D (period p)');
            var mpd = ctx.group({ parent: G });
            [2, 3, 5, 7, 11].forEach(function (p, k) {
              var x0 = 930 + k * 124;
              for (var rr = 0; rr < 5; rr++) for (var cc = 0; cc < p && cc < 7; cc++) ctx.rect(x0 + cc * 13, 492 + rr * 13, 11, 11, { rx: 2, fill: ctx.alpha('orange', 0.15 + 0.12 * ((rr * p + cc) % 3)), parent: mpd });
              note(ctx, mpd, x0, 574, 'p = ' + p, 'orange', 'start', 12);
            });
            ctx.hud('8 · 8 · 2 · 2 = 256 samples per frame');
            return Promise.all([ctx.reveal(blocks, { from: 'left', stagger: 180 }), ctx.reveal(lk, { from: 'draw', delay: 100 }), ctx.reveal([lk2, wf, wn], { delay: 1000, stagger: 150 }), ctx.reveal([pb, hd, mpd], { delay: 1200, stagger: 150 })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: Vocos */
            var pv = panelBox(ctx, G, 60, 530, 800, 110, 'violet');
            var hv = head(ctx, G, 80, 554, 'VOCOS · stay at frame rate, predict the spectrum', 'violet');
            var vc = ['mel', 'ConvNeXt ×8', '|X|, φ', 'iSTFT', 'wave'];
            var vn = vc.map(function (s, k) { return ctx.node({ x: 130 + k * 160, y: 598, w: 118, h: 36, title: s, color: 'violet', kind: 'chip', titleSize: 12, glow: false, parent: G }); });
            var vl = []; for (var k = 0; k < 4; k++) vl.push(ctx.link(vn[k], vn[k + 1], { color: 'violet', straight: true, parent: G }));
            ctx.hud('Vocos: 1 iSTFT instead of 4 upsamplers');
            return Promise.all([ctx.reveal([pv, hv], { stagger: 60 }), ctx.reveal(vn, { from: 'up', stagger: 100, delay: 300 }), ctx.reveal(vl, { from: 'draw', stagger: 100, delay: 600 })]).then(function () {
              return Promise.all(vl.map(function (l, i) { return ctx.wait(i * 150).then(function () { return ctx.packet(l, { color: 'violet', dur: 400, r: 4 }); }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: streaming pipeline */
            var ps = panelBox(ctx, G, 60, 660, 1500, 190, 'cyan');
            var hs = head(ctx, G, 80, 684, 'STREAMING TTS · chunked, pipelined (live preview mode)', 'cyan');
            var rows = [['text chunk', 'amber', [[0, 20], [320, 340], [640, 660]]], ['LM tokens', 'amber', [[20, 70], [340, 390], [660, 710]]], ['flow match', 'orange', [[70, 120], [390, 440], [710, 760]]], ['vocoder', 'violet', [[120, 150], [440, 470], [760, 790]]], ['playback', 'cyan', [[150, 650], [650, 1150]]]];
            var gx = 260, gs = 1.05;
            var gb = [], lab = [];
            rows.forEach(function (r, i) {
              var y = 718 + i * 25;
              lab.push(note(ctx, G, gx - 12, y + 10, r[0], 'text', 'end', 12));
              r[2].forEach(function (seg) { gb.push(ctx.rect(gx + seg[0] * gs, y, (seg[1] - seg[0]) * gs - 2, 20, { rx: 3, fill: ctx.alpha(r[1], 0.35), stroke: r[1], sw: 1, parent: G })); });
            });
            var fp = ctx.line(gx + 150 * gs, 712, gx + 150 * gs, 842, { color: 'white', dash: '4 3', parent: G });
            var ft = note(ctx, G, gx + 150 * gs + 8, 706, 'first audio ≈ 150 ms', 'white', 'start', 12);
            var ax = [0, 500, 1000].map(function (ms) { return note(ctx, G, gx + ms * gs, 706, ms + ' ms', 'dim', 'middle', 11); });
            ctx.hud('first audio ≈ 150 ms · RTF ≪ 1');
            return Promise.all([ctx.reveal([ps, hs].concat(lab, ax), { stagger: 30 }), ctx.reveal(gb, { from: 'left', stagger: 40, delay: 300 }), ctx.reveal([fp, ft], { delay: 1300, stagger: 100 })]).then(function () { return ctx.pulse(fp, { color: 'white', times: 2, dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Cloning, prosody, consent',
        beats: [
          {
            say: 'Zero shot cloning means no fine tuning. A voice activity detector and a quality scorer choose the cleanest six seconds of the memo.',
            card: { tag: 'KEY IDEA', title: 'No training run per voice', body: 'The voice is supplied at inference, as a prompt. The only choice is which six seconds: clean, single-speaker, no reverb.' },
            deep: '<ul><li><b>Prompt choice</b>: 3–10 s; score segments by VAD coverage, SNR / DNSMOS, clipping, reverb (C50), single-speaker check. Longer prompts raise similarity but also copy the phone\'s room tone and codec artifacts.</li></ul>' +
              '<p>Here seven 6 s segments of the memo are scored; the 12–18 s window wins with SNR 31 dB and a single speaker. Its transcript comes from ASR, since in-context models condition on text as well as audio.</p>'
          },
          {
            say: 'The model either continues that prompt in context, or conditions on a speaker embedding. Many systems do both.',
            card: { tag: 'TRADE-OFF', title: 'Prefix versus embedding', body: 'In-context prompts transfer timbre and recording conditions. A global embedding transfers identity only, and is cheaper to store and reuse.' },
            deep: '<ul><li><b>Conditioning</b>: in-context continuation (prompt codes/mel as prefix, VALL-E, F5) transfers timbre <i>and</i> recording conditions; a global embedding (x-vector/ECAPA, 192–256 d) transfers identity only. Many systems use both.</li></ul>' +
              '<p>The embedding is the compact, storable handle for a consented voice: 192 floats instead of seconds of audio, which also makes scoping and revocation simpler.</p>'
          },
          {
            say: 'We check the result in a speaker verification space: the new lines land inside the creator\'s cluster and far from every other speaker.',
            card: { tag: 'NUMBERS', title: 'Inside her cluster', stat: { v: '0.68', u: 'vs 0.21', l: 'cosine of N1 to the creator\'s prompt, versus the nearest other speaker' }, more: '<p>Cosine similarity of L2-normalised speaker embeddings lies in [−1, 1]. Different people typically score well below 0.3, while the same person across sessions scores around 0.6 to 0.8, so 0.68 against 0.21 is a wide margin. A generated line whose best match is another speaker, or whose score falls below the acceptance threshold, is re-sampled.</p>' },
            deep: '<ul><li><b>Verification</b>: SIM = cos(e(ŷ), e(prompt)) with a WavLM-TDNN verifier; 2025 zero-shot systems reach ≈0.6–0.75 (ground-truth re-recordings ≈0.7–0.8).</li></ul>' +
              '<p>The check is automatic: if a generated line drifts outside the creator\'s cluster (low cosine or a nearer neighbour), the line is re-sampled. The three narration lines N1, N2, N3 all sit inside the dashed threshold circle.</p>'
          },
          {
            say: 'Prosody is steered separately, here lower, slower and breathier for a hushed trailer read, without changing whose voice it is.',
            card: { tag: 'HOW IT WORKS', title: 'Who versus how', body: 'The embedding pins timbre. Instructions or a prosody prompt reshape pitch, rate and energy without leaving the speaker\'s cluster.' },
            deep: '<ul><li><b>Prosody</b>: instruction text ("hushed, awe"), emotion tags, or a reference-prosody prompt; explicit knobs for rate and F0 range. Here F0 mean −15 %, rate 0.9×.</li></ul>' +
              '<p>The plot shows the F0 contour of N1: the neutral read averages 150 Hz, the hushed read 127.5 Hz. Identity (who) and prosody (how) are separable controls, which is what makes a single cloned voice usable for narration, dialogue and whispers.</p>'
          },
          {
            say: 'And because a cloned voice is a powerful thing, consent verification and watermarking are part of the pipeline, not an afterthought.',
            card: { tag: 'PITFALL', title: 'Cloning without consent is a bug', body: 'Verify the speaker is the account holder, block public figures, watermark every sample, and record a signed synthetic-voice assertion.' },
            deep: '<div class="note"><b>Safeguards</b>: clone only a voice the account can prove is its own (speaker-verify the memo against an enrolled consent phrase), refuse public-figure voices (voice-ID blocklist), watermark every sample (AudioSeal: localized, robust to re-encoding, sample-level detection), and record a C2PA "synthetic voice" assertion in the final manifest.</div>' +
              '<p>Watermarks are checked at the delivery gate as well, so a stripped watermark is itself a signal. The clone is scoped to this project and discarded with it.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 0);
          var win, r1, r2;
          /* beat 0: pick the prompt out of the memo */
          var h0 = head(ctx, G, 80, 185, 'PROMPT SELECTION · memo.m4a 42 s · score = SNR + DNSMOS per 6 s');
          var segs = []; var r = ctx.rng(3);
          for (var i = 0; i < 7; i++) segs.push(0.3 + 0.5 * r());
          segs[2] = 0.95;
          var mw = ctx.path(waveD(ctx, 80, 700, 245, 26, 11, function (u) { return 0.2 + 0.8 * Math.abs(Math.sin(u * 31)) * (Math.sin(u * 7) > -0.6 ? 1 : 0.15); }), { stroke: ctx.alpha('orange', 0.6), sw: 1.2, parent: G });
          var sb = ctx.bars(80, 290, 700, 50, segs, { color: segs.map(function (v, k) { return k === 2 ? 'lime' : 'dim'; }), gap: 6, labels: ['0–6', '6–12', '12–18', '18–24', '24–30', '30–36', '36–42'], parent: G });
          win = ctx.rect(80 + 2 * 100.9, 212, 95, 66, { rx: 4, stroke: 'lime', sw: 2, fill: ctx.alpha('lime', 0.08), glow: true, parent: G });
          var wn = note(ctx, G, 80, 375, 'chosen: 12–18 s · SNR 31 dB · single speaker', 'lime');
          ctx.hud('prompt = 12–18 s · SNR 31 dB');
          return Promise.all([ctx.reveal([h0, mw], { stagger: 100 }), ctx.reveal(sb, { from: 'up', delay: 300 }), ctx.reveal(win, { from: 'scale', delay: 800 }), ctx.reveal(wn, { delay: 1100 })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: two conditioning routes */
            r1 = ctx.node({ x: 250, y: 440, w: 340, h: 50, title: 'in-context prefix', sub: 'prompt codes/mel + transcript', color: 'orange', titleSize: 14, subSize: 11, parent: G });
            r2 = ctx.node({ x: 620, y: 440, w: 320, h: 50, title: 'speaker embedding', sub: 'ECAPA · 192-d, L2-normalised', color: 'violet', titleSize: 14, subSize: 11, parent: G });
            ctx.hud('prefix (timbre + room) or embedding (identity)');
            return ctx.reveal([r1, r2], { from: 'up', stagger: 150 }).then(function () { return ctx.pulse(r1, { color: 'orange', times: 1, dur: 600 }); }).then(function () { return ctx.pulse(r2, { color: 'violet', times: 1, dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: the speaker-verification space */
            var pb = panelBox(ctx, G, 860, 170, 700, 330, 'violet');
            var hh = head(ctx, G, 880, 195, 'SPEAKER-VERIFICATION SPACE (2-D projection)', 'violet');
            var rr = ctx.rng(15), pts = [];
            var clusters = [[1060, 330, 'dim'], [1240, 250, 'dim'], [1420, 380, 'dim'], [1300, 420, 'dim']];
            clusters.forEach(function (c) { for (var k = 0; k < 9; k++) pts.push(ctx.circle(c[0] + (rr() - 0.5) * 70, c[1] + (rr() - 0.5) * 60, 3, { fill: ctx.alpha('dim', 0.6), parent: G })); });
            var me = [];
            for (var k = 0; k < 12; k++) me.push(ctx.circle(1160 + (rr() - 0.5) * 80, 360 + (rr() - 0.5) * 70, 3.5, { fill: 'orange', parent: G }));
            var thr = ctx.circle(1160, 360, 70, { stroke: 'orange', sw: 1.2, dash: '4 4', parent: G });
            var cn = note(ctx, G, 1160, 443, 'creator (memo utterances)', 'orange', 'middle');
            var stars = [[1150, 345, 'N1'], [1178, 372, 'N2'], [1138, 382, 'N3']].map(function (s) {
              var g = ctx.group({ parent: G });
              ctx.poly([[s[0], s[1] - 8], [s[0] + 3, s[1] - 2], [s[0] + 9, s[1] - 2], [s[0] + 4, s[1] + 2], [s[0] + 6, s[1] + 9], [s[0], s[1] + 5], [s[0] - 6, s[1] + 9], [s[0] - 4, s[1] + 2], [s[0] - 9, s[1] - 2], [s[0] - 3, s[1] - 2]], { fill: 'white', parent: g, glow: true });
              note(ctx, g, s[0] + 12, s[1] - 6, s[2], 'white', 'start', 11);
              return g;
            });
            var cs = note(ctx, G, 880, 480, 'cos(N1, prompt) = 0.68 · nearest other speaker 0.21', 'text');
            ctx.hud('SIM 0.68 vs 0.21 for the nearest other speaker');
            return Promise.all([ctx.reveal([pb, hh], { stagger: 60 }), ctx.reveal(pts.concat(me), { stagger: 8, delay: 300 }), ctx.reveal([thr, cn], { from: 'scale', delay: 800 }), ctx.reveal(stars, { from: 'scale', stagger: 200, delay: 1200 }), ctx.reveal(cs, { delay: 1500 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: prosody, the F0 contour */
            var pb = panelBox(ctx, G, 60, 520, 760, 190, 'amber');
            var hh = head(ctx, G, 80, 544, 'PROSODY CONTROL · F0 contour of N1 (Hz)', 'amber');
            var f0n = function (x) { return 150 + 30 * Math.sin(x * 2.2) + 15 * Math.sin(x * 5.1); };
            var f0h = function (x) { return 127.5 + 14 * Math.sin(x * 2.0) + 6 * Math.sin(x * 4.6); };   /* mean 150 → 127.5 Hz = −15 % */
            var pA = ctx.plot(120, 565, 520, 120, f0n, { xDomain: [0, 4], yDomain: [90, 200], color: 'dim', sw: 1.6, parent: G });
            var pB = ctx.plot(120, 565, 520, 120, f0h, { xDomain: [0, 4], yDomain: [90, 200], color: 'amber', sw: 2.2, axes: false, parent: G, glow: true });
            var pn = [note(ctx, G, 660, 590, 'neutral read', 'dim'), note(ctx, G, 660, 640, '"hushed, awe"', 'amber'), note(ctx, G, 660, 662, 'F0 −15 % · rate 0.9×', 'amber')];
            var pi = [note(ctx, G, 80, 742, 'Identity (who) and prosody (how) are separable controls:', 'text', 'start', 13), note(ctx, G, 80, 766, 'the embedding pins timbre, instructions or a prosody prompt', 'text', 'start', 13), note(ctx, G, 80, 790, 'reshape pitch, rate and energy without leaving the cluster.', 'text', 'start', 13)];
            ctx.hud('F0 −15 % · rate 0.9× · same speaker');
            return Promise.all([ctx.reveal([pb, hh, pA, pn[0]], { stagger: 60 }), ctx.reveal(pB.curve, { from: 'draw', delay: 500, dur: 1000 }), ctx.reveal([pn[1], pn[2]], { delay: 1200, stagger: 100 }), ctx.reveal(pi, { delay: 1400, stagger: 150 })]);
          }).then(function () { return ctx.beat(4); }).then(function () {
            if (ctx.dead) return;
            /* beat 4: consent and provenance safeguards */
            var pb = panelBox(ctx, G, 860, 520, 700, 330, 'pink');
            var hh = head(ctx, G, 880, 544, 'SAFEGUARDS · before and after synthesis', 'pink');
            var cs = ['memo speaker = enrolled account voice', 'spoken consent phrase + liveness', 'not on public-figure voice blocklist', 'AudioSeal watermark on every sample', 'C2PA: "synthetic voice" assertion', 'clone scoped to this project only'];
            S.cons = cs.map(function (c, k) { return ctx.label(1210, 584 + k * 42, c, { color: 'dim', size: 13, w: 620, parent: G }); });
            ctx.hud('consent ✓ · watermark ✓ · SIM 0.68');
            return Promise.all([ctx.reveal([pb, hh], { stagger: 60 }), ctx.reveal(S.cons, { from: 'left', stagger: 90, delay: 300 })]).then(function () { return turnGreen(ctx, S.cons, 180); });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Music: tokens vs latents',
        beats: [
          {
            say: 'Music has two leading recipes. MusicGen models codec tokens with one transformer, but four codebooks per frame would make the sequence four times longer.',
            card: { tag: 'KEY IDEA', title: 'Two recipes for a score', body: 'Tokens with an autoregressive transformer (MusicGen), or a continuous latent with a diffusion transformer (Stable Audio).' },
            deep: '<p><b>MusicGen</b>: EnCodec 32 kHz, 4 codebooks × 2048 at 50 Hz; one decoder-only transformer (300 M – 3.3 B) with T5 text conditioning (cross-attention) and optional chroma melody conditioning.</p>' +
              '<p>Thirty seconds at 50 Hz is 1,500 frames. With four codebooks per frame, decoding every token in sequence would take 6,000 steps, and the attention cost of such a sequence grows with its square.</p>'
          },
          {
            say: 'The delay pattern shifts codebook k by k steps, so every decoding step emits one token for each codebook, and thirty seconds takes about fifteen hundred steps instead of six thousand.',
            card: { tag: 'NUMBERS', title: 'Delay pattern', stat: { v: '1,503', u: 'steps', l: 'for 30 s at 50 Hz, versus 6,000 for flattened decoding, at near-flatten quality' } },
            deep: '<table><tr><th>Interleaving</th><th>Steps for 30 s</th><th>Note</th></tr>' +
              '<tr><td>flatten</td><td>4 × 1500 = 6000</td><td>exact AR, slow</td></tr>' +
              '<tr><td>parallel</td><td>1500</td><td>ignores intra-frame deps</td></tr>' +
              '<tr><td>delay</td><td>1500 + 3</td><td>codebook k of frame f is emitted at step f + k, after codebooks &lt; k of f, so it can condition on them; near flatten quality</td></tr></table>'
          },
          {
            say: 'Stable Audio instead runs a diffusion transformer on a continuous VAE latent, conditioned on text and on timing, so the length and the build to the impact at fifteen seconds can be specified directly.',
            card: { tag: 'STATE OF THE ART', title: 'Timing-conditioned latent DiT', body: 'Seconds-start and seconds-total enter as tokens, so a 30 s cue is generated to length rather than trimmed.' },
            deep: '<p><b>Stable Audio</b> (Open / 2.x): a VAE compresses 44.1 kHz stereo to a 64-channel latent at ≈21.5 Hz (≈2048× in time); a DiT denoises it with T5 text cross-attention and <i>timing conditioning</i> (seconds_start, seconds_total) as extra tokens, so a 30 s cue is generated to length inside a fixed window (47 s for Open, up to ~3 min for 2.x).</p>' +
              '<p>The denoiser works on a tensor of 64 channels × about 645 latent frames for 30 s, far shorter than 1,500 × 4 tokens, at the cost of 50–100 denoising steps.</p>'
          },
          {
            say: 'The finished score is checked against the cue. A beat tracker measures the tempo, and a small time stretch lands the downbeats on the edit grid.',
            card: { tag: 'PITFALL', title: 'Text rarely fixes the tempo', body: 'The model obeys 96 BPM only loosely. A beat tracker measures 95.4, and a 0.6 percent time stretch snaps the downbeats to the grid.' },
            deep: '<div class="eq">96 BPM ⇒ 0.625 s/beat; 30 s = 48 beats = 12 bars; HIT at bar 7 downbeat = 15.0 s</div>' +
              '<p>Tempo is only loosely obeyed from text; the pipeline verifies with a beat tracker (for example madmom) and, if the estimate is 95.4 BPM, time-stretches by 0.6 % with a phase vocoder so the downbeats land on the edit grid, where every cut sits on a multiple of 15 frames.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 1);
          var X0 = 150, Y0 = 280, P = 38, NCOL = 14;
          var cells = [], cur, cmp;
          var rr = ctx.rng(8);
          var nz = [], cl = [];
          for (var i = 0; i < 8; i++) { nz.push([]); cl.push([]); for (var j = 0; j < 24; j++) { nz[i].push(rr()); cl[i].push(0.5 + 0.45 * Math.sin(j * 0.55 + i * 0.8) * (j < 12 ? 0.4 + j / 20 : (j < 14 ? 1 : 0.6))); } }
          var st, lat;
          /* beat 0: the MusicGen token grid (4 codebooks × frames) */
          var pb = panelBox(ctx, G, 60, 170, 740, 460, 'amber');
          var hh = head(ctx, G, 80, 195, 'MusicGen · codec LM · DELAY PATTERN', 'amber');
          var gg = ctx.group({ parent: G });
          for (var k = 0; k < 4; k++) {
            cells.push([]);
            note(ctx, gg, X0 - 12, Y0 + k * P + 16, 'k' + (k + 1), 'dim', 'end', 12);
            for (var s = 0; s < NCOL; s++) {
              var pad = s < k;
              var rc = ctx.rect(X0 + s * P, Y0 + k * P, P - 4, P - 4, { rx: 4, fill: pad ? 'rgba(255,255,255,0.03)' : '#0d1424', stroke: pad ? 'none' : ctx.alpha('amber', 0.25), sw: 1, parent: gg });
              var tt = note(ctx, gg, X0 + s * P + (P - 4) / 2, Y0 + k * P + (P - 4) / 2, pad ? '·' : 'f' + (s - k), 'dim', 'middle', 11);
              cells[k].push({ r: rc, t: tt, pad: pad });
            }
          }
          var gn = note(ctx, G, X0, Y0 - 22, 'decode step s →   (column = one transformer step, 4 tokens)', 'text');
          ctx.hud('4 codebooks per frame · 50 Hz · 1,500 frames');
          return Promise.all([ctx.reveal([pb, hh], { stagger: 60 }), ctx.reveal(gg, { from: 'up', delay: 300 }), ctx.reveal(gn, { delay: 700 })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: the delay pattern decodes, and the step counts are compared */
            cur = ctx.rect(X0 - 3, Y0 - 5, P + 2, 4 * P + 6, { rx: 5, stroke: 'white', sw: 2, glow: true, parent: G });
            cmp = ctx.bars(150, 480, 420, 90, [0.01, 0.01, 0.01], { color: ['dim', 'dim', 'amber'], gap: 30, labels: ['flatten 6000', 'parallel 1500', 'delay 1503'], parent: G });
            var cn = [note(ctx, G, 600, 510, 'steps for 30 s', 'dim'), note(ctx, G, 600, 532, '(50 Hz frames)', 'dim')];
            ctx.hud('delay pattern: 1503 steps vs 6000');
            return Promise.all([ctx.reveal([cur, cn[0], cn[1], cmp], { stagger: 80 }), ctx.wait(300).then(function () { return cmp.update([1, 0.25, 0.2505], 900); }), ctx.wait(400).then(function () {
              return ctx.tween(3200, function (t) {
                var sN = Math.floor(t * NCOL + 0.0001);
                for (var k = 0; k < 4; k++) for (var s = 0; s < NCOL; s++) {
                  var c = cells[k][s];
                  if (c.pad) continue;
                  var on = s < sN;
                  c.r.setAttribute('fill', on ? ctx.mix('#2a1a06', ctx.C.amber, 0.35 + 0.15 * k) : '#0d1424');
                  c.t.setAttribute('fill', on ? ctx.C.white : ctx.C.dim);
                }
                cur.setAttribute('x', X0 + Math.min(NCOL - 1, sN) * P - 3);
              }, 'linear');
            })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: Stable Audio, latent diffusion with timing conditioning */
            var pb2 = panelBox(ctx, G, 840, 170, 720, 460, 'orange');
            var h2 = head(ctx, G, 860, 195, 'Stable Audio · LATENT DiT + TIMING CONDITIONING');
            var conds = [['text: "hybrid orchestral, D minor, 96 BPM, hit @15 s"', 'amber'], ['seconds_start = 0', 'cyan'], ['seconds_total = 30', 'cyan']];
            var cc = conds.map(function (c, k) { return ctx.label(1200, 232 + k * 30, c[0], { color: c[1], size: 12, w: k ? 220 : 560, parent: G }); });
            lat = ctx.matrix(900, 340, 8, 24, { cell: 22, gap: 3, cmap: 'heat', values: nz, parent: G });
            var ln = [note(ctx, G, 900, 552, 'latent 64 ch × 21.5 Hz (8 ch shown) · 44.1 kHz stereo ≈ 2048× shorter', 'text')];
            st = note(ctx, G, 900, 578, 'DiT denoising step 0 / 100', 'orange');
            var dn = note(ctx, G, 900, 604, 'VAE decoder → 30.0 s waveform, exact length', 'dim');
            ctx.hud('latent 64 ch × 21.5 Hz · exact 30.0 s');
            return Promise.all([ctx.reveal([pb2, h2], { stagger: 60 }), ctx.reveal(cc, { from: 'right', stagger: 120, delay: 200 }), ctx.reveal([lat], { delay: 600 }), ctx.reveal(ln.concat([st, dn]), { delay: 900, stagger: 100 })]).then(function () {
              return ctx.tween(3200, function (t) {
                lat.set(function (i, j) { return nz[i][j] * (1 - t) + cl[i][j] * t; });
                st.textContent = 'DiT denoising step ' + Math.round(t * 100) + ' / 100';
              }, 'inOut');
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: the score form, verified by a beat tracker */
            var pb3 = panelBox(ctx, G, 60, 650, 1500, 200, 'orange');
            var h3 = head(ctx, G, 80, 674, 'SCORE FORM · 96 BPM · 12 bars · verified by a beat tracker');
            var fx = 100, fw = 1400;
            var env = ctx.path(waveD(ctx, fx, fw, 750, 40, 33, function (u) { var t = u * 30; return t < 15 ? 0.15 + 0.6 * t / 15 : (t < 16.2 ? 1 : 0.55 - 0.3 * (t - 16.2) / 13.8); }), { stroke: ctx.alpha('orange', 0.8), sw: 1.2, parent: G });
            var bars = ctx.group({ parent: G });
            for (var b = 0; b <= 12; b++) {
              ctx.line(fx + b * fw / 12, 700, fx + b * fw / 12, 800, { color: b === 6 ? 'amber' : 'rgba(255,255,255,0.12)', sw: b === 6 ? 2 : 1, parent: bars });
              if (b < 12) note(ctx, bars, fx + (b + 0.5) * fw / 12, 818, 'bar ' + (b + 1), b === 6 ? 'amber' : 'dim', 'middle', 11);
            }
            var hit = note(ctx, G, fx + 6 * fw / 12 + 8, 712, 'HIT 15.0 s', 'amber', 'start', 12);
            var mt = note(ctx, G, 1500, 838, 'measured 95.4 BPM → stretch 0.6 %', 'text', 'end', 12);
            ctx.hud('measured 95.4 BPM → stretch 0.6 %');
            return Promise.all([ctx.reveal([pb3, h3], { stagger: 60 }), ctx.reveal(env, { from: 'draw', dur: 1200, delay: 300 }), ctx.reveal(bars, { delay: 500 }), ctx.reveal([hit, mt], { delay: 1300, stagger: 200 })]);
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Foley from video',
        beats: [
          {
            say: 'Sound effects must follow the picture. Shot four ends in an impact on frame three hundred sixty, and the effect has to land on that exact frame.',
            card: { tag: 'NUMBERS', title: 'One frame is 41.7 ms', stat: { v: '41.7', u: 'ms per frame', l: 'one 24 fps frame. Audio lead is noticed from about 45 ms, lag from about 125 ms (ITU-R BT.1359)' } },
            deep: '<p>A 24 fps frame is 41.7 ms. Humans notice audio-leading offsets from ≈45 ms and audio-lagging offsets from ≈125 ms (ITU-R BT.1359), so an impact must be within about one frame.</p>' +
              '<p>The strip shows twelve consecutive frames of shot S4 around the impact. The motion energy (green) spikes exactly at the hit frame, 360 = 15.000 s on the timeline; that is the moment the sound must arrive.</p>'
          },
          {
            say: 'A video to audio model like MMAudio watches the shot. Semantic features at eight frames per second say what is happening, and synchronization features at twenty four frames per second say exactly when.',
            card: { tag: 'HOW IT WORKS', title: 'What, when, and a text hint', body: 'CLIP visual tokens give semantics, Synchformer features give fine timing, CLIP text adds "impact, ice". A noisy audio latent is denoised.' },
            deep: '<p><b>MMAudio</b> (CVPR 2025): multimodal joint training on audio-visual and audio-text data; ~157 M–1 B params; generates 8 s of 44.1 kHz audio in ≈1.2 s.</p>' +
              '<ul><li><b>Conditions</b>: CLIP visual tokens at 8 fps (semantics), Synchformer features at 24 fps (fine timing), CLIP text tokens.</li></ul>' +
              '<p>The generative target is a noisy latent of a mel-VAE, so the model works on a compact time-frequency representation rather than raw samples.</p>'
          },
          {
            say: 'These tokens attend jointly with text and audio latents inside one transformer, trained with flow matching on audio, video and text data together.',
            card: { tag: 'STATE OF THE ART', title: 'One joint-attention transformer', body: 'Video, text and audio tokens share attention on a common time axis via aligned rotary positions, then audio-only blocks predict the velocity.' },
            deep: '<ul><li><b>Backbone</b>: MM-DiT joint-attention blocks over [video ‖ text ‖ audio-latent] tokens, then audio-only blocks; <b>aligned RoPE</b> gives video and audio tokens positions on the same time axis; sync features are added frame-aligned to audio tokens.</li>' +
              '<li><b>Generation</b>: conditional flow matching on a mel-VAE latent, then a vocoder (BigVGAN).</li></ul>' +
              '<div class="eq">DeSync = | Δ̂<sub>Synchformer</sub>(video, audio) |   (seconds, lower is better)</div>'
          },
          {
            say: 'The impact in shot four lands on frame three hundred sixty, and the generated transient lands within a frame of it. Newer generators like Veo three skip this step by generating audio and video together.',
            card: { tag: 'NUMBERS', title: 'Onset within a frame', stat: { v: '12 ms', u: 'offset', l: 'generated impact onset versus the hit frame, well inside one 41.7 ms frame' } },
            deep: '<p>Evaluation: FD (PaSST/PANNs/VGGish), IS, IB-score (ImageBind audio-visual similarity), DeSync. A 24 fps frame is 41.7 ms; the measured 12 ms onset offset is below it.</p>' +
              '<div class="note">Joint audio-video generation (Veo 3, and open models in 2025–26) emits both modalities from one denoiser: native sync and dialogue, but no independent control over the stems; the editor still needs separate music and voice tracks.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 2);
          var FX = 90, FW = 86, N = 12;
          var tl = function (u) { return FX + u * (N * (FW + 4) - 4); };
          var hitU = (5.5) / N;
          var ins = [['CLIP visual · 8 fps', 'what', 'violet', 560], ['Synchformer · 24 fps', 'when', 'lime', 640], ['CLIP text', '"impact, ice"', 'amber', 720], ['noisy audio latent x_t', 'mel-VAE', 'orange', 800]];
          var inN, mm, ao, vo, ls;
          /* beat 0: frames of shot S4 and its motion energy; the sync budget */
          var h0 = head(ctx, G, 80, 185, 'SHOT S4 · impact · frames 315–420 (timeline)');
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
          var fn = note(ctx, G, FX + 5 * (FW + 4) + FW / 2 + 8, 272, 'frame 360 = 15.000 s', 'amber', 'start', 12);
          var me = ctx.plot(FX, 290, N * (FW + 4) - 4, 60, function (u) { return 0.1 + 0.9 * Math.exp(-Math.pow((u - hitU) / 0.03, 2)) + 0.15 * Math.exp(-Math.pow((u - hitU + 0.2) / 0.1, 2)); }, { xDomain: [0, 1], yDomain: [0, 1.1], color: 'lime', sw: 2, axes: false, samples: 200, parent: G });
          var mn = note(ctx, G, FX - 8, 320, 'motion', 'lime', 'end', 11);
          var pb = panelBox(ctx, G, 1230, 170, 330, 290, 'orange');
          var hb = head(ctx, G, 1250, 195, 'SYNC BUDGET');
          var bp = ctx.para(1250, 228, nb(['1 frame @ 24 fps = 41.7 ms', 'audio lead noticed ≈ 45 ms', 'audio lag noticed  ≈ 125 ms', '', 'MMAudio: 8 s clip', 'in ≈ 1.2 s (H100)', '', 'metric: DeSync (s)']), { size: 13, font: 'code', color: 'text', lh: 26, parent: G });
          ctx.hud('impact at frame 360 = 15.000 s');
          return Promise.all([ctx.reveal(h0, { delay: 100 }), ctx.reveal(fr, { from: 'down', stagger: 50 }), ctx.reveal([fn, mn], { delay: 700, stagger: 100 }), ctx.reveal(me.curve, { from: 'draw', delay: 600, dur: 900 }), ctx.reveal([pb, hb, bp], { delay: 900, stagger: 100 })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: the four conditioning inputs */
            var pa = panelBox(ctx, G, 60, 480, 1500, 370, 'violet');
            var ha = head(ctx, G, 80, 505, 'MMAudio-STYLE ARCHITECTURE · joint attention over video, text and audio tokens', 'violet');
            inN = ins.map(function (c) { return ctx.node({ x: 250, y: c[3], w: 320, h: 56, title: c[0], sub: c[1], color: c[2], titleSize: 14, subSize: 11, parent: G }); });
            ctx.hud('8 fps semantics · 24 fps timing');
            return Promise.all([ctx.reveal([pa, ha], { stagger: 60 }), ctx.reveal(inN, { from: 'left', stagger: 120, delay: 300 })]).then(function () { return ctx.pulse(inN[1], { color: 'lime', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: MM-DiT joint attention, audio-only blocks, decoder */
            mm = ctx.node({ x: 720, y: 640, w: 330, h: 150, title: 'MM-DiT blocks', sub: 'joint attention · aligned RoPE', icon: 'layers', color: 'violet', titleSize: 17, subSize: 12, parent: G });
            ao = ctx.node({ x: 1080, y: 640, w: 230, h: 60, title: 'audio-only blocks', sub: 'predict velocity v', color: 'orange', titleSize: 14, subSize: 11, parent: G });
            vo = ctx.node({ x: 1380, y: 640, w: 250, h: 60, title: 'ODE → VAE → BigVGAN', sub: '44.1 kHz foley', color: 'orange', titleSize: 13, subSize: 11, parent: G });
            ls = inN.map(function (n, k) { return ctx.link(n, mm, { color: ins[k][2], parent: G }); });
            ls.push(ctx.link(mm, ao, { color: 'orange', parent: G }));
            ls.push(ctx.link(ao, vo, { color: 'orange', parent: G }));
            var sn = [note(ctx, G, 720, 745, 'sync features are also added frame-aligned', 'lime', 'middle', 12), note(ctx, G, 720, 765, 'to the audio tokens (24 fps ↔ audio frames)', 'lime', 'middle', 12)];
            ctx.hud('one transformer · flow matching · 44.1 kHz');
            return Promise.all([ctx.reveal(mm, { from: 'scale' }), ctx.reveal([ao, vo], { from: 'left', stagger: 150, delay: 300 }), ctx.reveal(ls, { from: 'draw', stagger: 80, delay: 200 }), ctx.reveal(sn, { delay: 900, stagger: 100 })]).then(function () {
              return Promise.all(ls.slice(0, 4).map(function (l, k) { return ctx.packet(l, { color: ins[k][2], dur: 700 }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: the generated transient lines up with the hit; output stage; Veo 3 note */
            var au = ctx.path(waveD(ctx, FX, N * (FW + 4) - 4, 400, 34, 17, function (u) { return u < hitU - 0.004 ? 0.05 + 0.1 * u : 0.05 + Math.exp(-(u - hitU + 0.004) / 0.08); }), { stroke: 'orange', sw: 1.2, parent: G });
            var an = note(ctx, G, FX - 8, 400, 'audio', 'orange', 'end', 11);
            var sync = ctx.line(tl(hitU), 200, tl(hitU), 440, { color: 'amber', sw: 1.5, dash: '4 3', parent: G });
            var sn = note(ctx, G, tl(hitU) + 8, 446, 'onset offset 12 ms (< 1 frame)', 'amber', 'start', 12);
            var vn = [note(ctx, G, 1230, 720, 'Veo 3-class: audio + video from one', 'dim', 'start', 12), note(ctx, G, 1230, 740, 'denoiser → native sync, fused stems', 'dim', 'start', 12)];
            ctx.hud('impact at frame 360 · onset within 12 ms');
            return Promise.all([ctx.reveal([au, an], { from: 'left', dur: 900 }), ctx.reveal([sync, sn], { delay: 900, stagger: 150 }), ctx.reveal(vn, { delay: 1300, stagger: 100 })]).then(function () {
              return ctx.packet(ls[4], { color: 'orange', dur: 500 });
            }).then(function () { return ctx.packet(ls[5], { color: 'orange', dur: 500 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Lip-sync inpainting',
        beats: [
          {
            say: 'Finally, lip sync, one level deeper. LatentSync works in the latent space of an image autoencoder, sixteen frames at a time, and repaints only a masked mouth region in each.',
            card: { tag: 'KEY IDEA', title: 'Video inpainting in latent space', body: 'A 16-frame window of the shot goes through a VAE. The lower face is masked and regenerated by a U-Net with temporal layers.' },
            deep: '<p><b>Input per frame</b> (SD-1.5 VAE, 256² or 512² face crop → 32²/64² × 4 latents). Eight of the sixteen frames of the window are drawn here.</p>' +
              '<p>Working in the VAE latent space shrinks the problem 64× in area (8× per side), which is what makes a diffusion model on face video affordable; temporal layers make it a video model so neighbouring frames share their mouth shapes and the result does not jitter.</p>'
          },
          {
            say: 'For every frame, the network sees the noisy latent, the mask, the masked frame and a reference frame of the fox, stacked as thirteen channels.',
            card: { tag: 'NUMBERS', title: 'Thirteen input channels', stat: { v: '13', u: 'channels', l: '4 noisy latent + 1 mask + 4 masked frame + 4 reference frame, per frame of a 16-frame window' }, more: '<p>Tensor shape per window for a 256² face crop: z<sub>in</sub> is 16 × 13 × 32 × 32 (frames × channels × height × width). For 512² crops it is 16 × 13 × 64 × 64. The U-Net output is the predicted noise ε with shape 16 × 4 × 32 × 32, which is decoded back to 16 × 3 × 256 × 256 pixels.</p>' },
            deep: '<div class="eq">z<sub>in</sub> = [ z<sub>t</sub> (4) ‖ mask (1) ‖ E(x ⊙ (1 − m)) (4) ‖ E(x<sub>ref</sub>) (4) ] = 13 channels</div>' +
              '<p>The reference frame is unmasked and shows the closed mouth, teeth and fur. It anchors identity so the regenerated mouth belongs to this fox and not to a generic face; without it, identity drifts across a long clip.</p>'
          },
          {
            say: 'Whisper audio features for a short window around each frame enter through cross attention, so each mouth shape is driven by the sound at that moment.',
            card: { tag: 'HOW IT WORKS', title: 'Audio through cross attention', body: 'Whisper encoder features at 50 Hz: each video frame attends to plus or minus two audio frames, so lips follow the phonemes.' },
            deep: '<p><b>Audio</b>: Whisper encoder features at 50 Hz; each video frame attends to a window of ±2 frames of audio embeddings through cross-attention in the U-Net (temporal layers make it a 16-frame video model).</p>' +
              '<p>Whisper was trained for recognition, so its intermediate features encode phonetic content robustly across speakers and noise. That is why they work better as a lip-sync condition than low-level features such as mel spectrograms.</p>'
          },
          {
            say: 'Training adds a SyncNet loss on decoded pixels and a temporal consistency loss, so the mouth both matches the sound and does not flicker.',
            card: { tag: 'HOW IT WORKS', title: 'Four training signals', body: 'Denoising MSE, a SyncNet audio-mouth agreement loss, LPIPS for detail, and TREPA to align temporal representations against flicker.' },
            deep: '<p><b>Losses</b>:</p><div class="eq">L = L<sub>simple</sub> + λ<sub>1</sub>·L<sub>SyncNet</sub>(decoded) + λ<sub>2</sub>·L<sub>LPIPS</sub> + λ<sub>3</sub>·L<sub>TREPA</sub></div>' +
              '<p>SyncNet: contrastively trained audio and 5-frame mouth encoders; as in Wav2Lip, P<sub>sync</sub> = cos(a, v) (post-ReLU embeddings, so ∈ [0, 1]) and L<sub>sync</sub> = −log P<sub>sync</sub>, a binary cross-entropy toward "in sync". TREPA aligns temporal representations of generated and real clips (from a video self-supervised encoder) to suppress flicker.</p>'
          },
          {
            say: 'The result is pasted back with a feathered mask, and every other pixel of the shot stays untouched. The chamber then hands four stems and the patched shot to the editor agent.',
            card: { tag: 'PITFALL', title: 'Teeth, tongues, stylised faces', body: 'Failure modes: hallucinated teeth, identity drift, jitter at the mask border. Reference frame, SAM 2 masks and feathering mitigate them.' },
            deep: '<p>Lineage: Wav2Lip (GAN + frozen expert) → diffusion-based (DiffTalk, LatentSync, MuseTalk-style one-step inpainting for real time). Inference: DDIM with 20 steps, decode, keep only the masked mouth region, feathered paste.</p>' +
              '<div class="note">Failure modes: teeth/tongue hallucination, identity drift on stylised faces, jitter at mask borders; mitigations are the reference frame, SAM-2 masks for non-human faces, feathered Poisson-style blending and the SyncNet + ΔY flicker QC gates in the parent chamber.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var G = stage(ctx);
          nav(ctx, 3);
          var fr = [], aw = [];
          /* beat 0: the 16-frame window, mouths masked */
          var h0 = head(ctx, G, 80, 185, '16-FRAME WINDOW · shot S2 · masked lower face');
          for (var i = 0; i < 8; i++) {
            var g = ctx.group({ parent: G });
            var x = 90 + i * 118;
            ctx.rect(x, 205, 104, 104, { rx: 5, fill: '#3a1020', stroke: ctx.alpha('white', 0.25), sw: 1, parent: g });
            ctx.poly([[x + 22, 232], [x + 30, 212], [x + 42, 228], [x + 62, 228], [x + 74, 212], [x + 82, 232], [x + 74, 282], [x + 52, 298], [x + 30, 282]], { fill: '#ff8a3d', parent: g });
            ctx.circle(x + 40, 246, 4, { fill: '#10131c', parent: g });
            ctx.circle(x + 64, 246, 4, { fill: '#10131c', parent: g });
            ctx.rect(x + 18, 262, 68, 40, { rx: 4, stroke: 'magenta', sw: 1.4, dash: '4 3', fill: ctx.alpha('magenta', 0.1), parent: g });
            ctx.el('ellipse', { cx: x + 52, cy: 282, rx: 10, ry: 2 + 8 * Math.abs(Math.sin(i * 0.9 + 0.4)), fill: '#1a0508', stroke: '#ffb070', 'stroke-width': 1 }, g);
            note(ctx, g, x + 52, 322, 'f' + (i + 1), 'dim', 'middle', 11);
            fr.push(g);
          }
          var fn = note(ctx, G, 1050, 257, '… f16', 'dim', 'start', 13);
          ctx.hud('16 frames · masked lower face');
          return Promise.all([ctx.reveal(h0, { delay: 100 }), ctx.reveal(fr, { from: 'down', stagger: 60 }), ctx.reveal(fn, { delay: 700 })]).then(function () { return ctx.beat(1); }).then(function () {
            if (ctx.dead) return;
            /* beat 1: reference frame, channel stack, U-Net */
            var ref = ctx.group({ parent: G });
            var rx0 = 1200;
            ctx.rect(rx0, 205, 104, 104, { rx: 5, fill: '#3a1020', stroke: 'violet', sw: 2, parent: ref, glow: true });
            ctx.poly([[rx0 + 22, 232], [rx0 + 30, 212], [rx0 + 42, 228], [rx0 + 62, 228], [rx0 + 74, 212], [rx0 + 82, 232], [rx0 + 74, 282], [rx0 + 52, 298], [rx0 + 30, 282]], { fill: '#ff8a3d', parent: ref });
            ctx.circle(rx0 + 40, 246, 4, { fill: '#10131c', parent: ref });
            ctx.circle(rx0 + 64, 246, 4, { fill: '#10131c', parent: ref });
            ctx.el('ellipse', { cx: rx0 + 52, cy: 282, rx: 10, ry: 1.5, fill: '#1a0508', stroke: '#ffb070', 'stroke-width': 1 }, ref);
            ctx.para(rx0 + 118, 222, ['x_ref: unmasked', 'reference frame', '(mouth closed)', 'anchors identity,', 'teeth and fur'], { size: 12, font: 'mono', color: 'violet', lh: 19, parent: ref });
            var pb = panelBox(ctx, G, 60, 400, 760, 450, 'orange');
            var hh = head(ctx, G, 80, 425, 'U-NET INPUT · 13 latent channels per frame');
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
            var un1 = note(ctx, G, 440, 800, 'predicts ε for the face latent · DDIM 20 steps', 'dim', 'middle', 12);
            var un2 = note(ctx, G, 440, 824, 'decode → keep only the masked mouth region, feathered paste', 'dim', 'middle', 12);
            ctx.hud('13 ch = 4 + 1 + 4 + 4 per frame');
            return Promise.all([ctx.reveal(ref, { from: 'left' }), ctx.reveal([pb, hh], { stagger: 60 }), ctx.reveal(chG, { from: 'left', stagger: 150, delay: 300 }), ctx.reveal([lu, un], { delay: 900, stagger: 150 }), ctx.reveal([un1, un2], { delay: 1300, stagger: 100 })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            if (ctx.dead) return;
            /* beat 2: Whisper audio windows */
            for (var j = 0; j < 8; j++) {
              var xa = 90 + j * 118;
              var amp = 0.5 + 0.5 * Math.abs(Math.sin(j + 1));
              aw.push(ctx.vector(xa + 22, 344, 5, { horizontal: true, cell: 11, gap: 2, cmap: 'violet', values: function (r0, c0) { return [0.3, 0.6, 1, 0.6, 0.3][c0] * amp; }, parent: G }));
            }
            var an = note(ctx, G, 90, 374, 'Whisper features, 50 Hz: each frame attends to ±2 audio frames', 'violet');
            ctx.hud('Whisper 50 Hz · ±2 frames per video frame');
            return Promise.all([ctx.reveal(aw, { from: 'up', stagger: 60 }), ctx.reveal(an, { delay: 600 })]).then(function () { return ctx.pulse(aw[0], { color: 'violet', times: 1, dur: 500 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            if (ctx.dead) return;
            /* beat 3: training signals */
            var pl = panelBox(ctx, G, 860, 400, 700, 450, 'lime');
            var hl = head(ctx, G, 880, 425, 'TRAINING SIGNALS', 'lime');
            var loss = [['L_simple', 'denoising MSE', 1], ['L_SyncNet', 'audio–mouth agreement', 0.55], ['L_LPIPS', 'perceptual detail', 0.35], ['L_TREPA', 'temporal consistency', 0.45]];
            var lb = loss.map(function (l, k) {
              var g = ctx.group({ parent: G });
              note(ctx, g, 880, 468 + k * 44, l[0], 'lime', 'start', 14);
              note(ctx, g, 1030, 468 + k * 44, l[1], 'text', 'start', 13);
              ctx.rect(1280, 459 + k * 44, 240 * l[2], 18, { rx: 3, fill: ctx.alpha('lime', 0.3), stroke: 'lime', sw: 1, parent: g });
              return g;
            });
            ctx.hud('SyncNet + TREPA keep lips synced, no flicker');
            return Promise.all([ctx.reveal([pl, hl], { stagger: 60 }), ctx.reveal(lb, { from: 'right', stagger: 120, delay: 300 })]);
          }).then(function () { return ctx.beat(4); }).then(function () {
            if (ctx.dead) return;
            /* beat 4: the outcome: sync peak at zero, output to the editor */
            var sn = note(ctx, G, 880, 650, 'SyncNet confidence vs audio–video offset', 'text', 'start', 13);
            var sp = ctx.plot(900, 670, 600, 120, function (x) { return 1.6 + 8.2 * Math.exp(-Math.pow(x / 1.3, 2)); }, { xDomain: [-15, 15], yDomain: [0, 11], color: 'lime', sw: 2, samples: 120, parent: G, glow: true });
            var ax = [note(ctx, G, 900, 808, '−15', 'dim', 'middle', 11), note(ctx, G, 1200, 808, '0', 'dim', 'middle', 11), note(ctx, G, 1500, 808, '+15 frames', 'dim', 'end', 11), note(ctx, G, 1220, 690, 'peak at 0 · LSE-C 8.0', 'lime', 'start', 12)];
            var out = note(ctx, G, 880, 836, 'chamber output: 4 stems + patched S2 → editor agent', 'orange', 'start', 13);
            ctx.hud('13 ch · 16 frames · SyncNet + TREPA');
            return Promise.all([ctx.reveal(sn, { delay: 100 }), ctx.reveal(sp.curve, { from: 'draw', delay: 200, dur: 1100 }), ctx.reveal(ax, { delay: 900, stagger: 100 }), ctx.reveal(out, { delay: 1400 })]);
          });
        }
      }
    ]
  });
})();
