/* L2 — Audio & Speech Encoding. The creator's voice memo: waveform -> log-mel -> Whisper frames -> tokens; codecs, RVQ, semantic tokens, speaker embedding.
 * Beat format: each step = beats (narration, callout card, deep-dive chunk, gated animation segment). */
(function () {
  var WX = 90, WW = 1440, WY = 240;          /* top waveform band */
  var DUR = 42, SEG0 = 12;                   /* memo length (s), analysed 3 s segment start */

  /* ---------- deterministic synthetic speech ---------- */
  function syllables(ctx) {
    var r = ctx.rng(42), out = [], t = 0.35;
    while (t < DUR - 0.4) {
      var L = 1.8 + r() * 2.4, end = Math.min(DUR - 0.3, t + L);
      while (t < end) { out.push({ t: t, a: 0.45 + 0.55 * r(), fric: r() < 0.18, v: r() }); t += 0.19 + r() * 0.13; }
      t += 0.35 + r() * 0.5;
    }
    return out;
  }
  function envAt(syl, t) {
    var e = 0, near = null, best = 9;
    for (var i = 0; i < syl.length; i++) {
      var d = t - syl[i].t;
      if (d > 0.3) continue;
      if (d < -0.3) break;
      e += syl[i].a * Math.exp(-(d / 0.075) * (d / 0.075));
      if (Math.abs(d) < best) { best = Math.abs(d); near = syl[i]; }
    }
    return { e: e, s: near };
  }
  function f0At(t) { return 118 + 22 * Math.sin(2 * Math.PI * 0.27 * t) + 8 * Math.sin(2 * Math.PI * 1.7 * t); }
  function melOf(f) { return 2595 * Math.log(1 + f / 700) / Math.LN10; }
  function hzOfMel(m) { return 700 * (Math.pow(10, m / 2595) - 1); }

  /* power at frequency f (Hz) for a frame with envelope E = {e, s} and pitch f0; n = noise sample in [0,1) */
  function power(E, f0, f, n) {
    var s = E.s, P = 1e-5 * (0.5 + n);
    if (!s || E.e < 0.01) return P;
    if (s.fric) return P + E.e * (f > 4000 ? 0.012 : 0.0004) * (0.3 + 0.7 * n);
    var comb = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * f / f0), 6);
    var F1 = 450 + 350 * s.v, F2 = 1100 + 1200 * ((s.v * 7.3) % 1), F3 = 2600;
    var form = Math.exp(-Math.pow((f - F1) / 190, 2)) + 0.7 * Math.exp(-Math.pow((f - F2) / 260, 2)) + 0.3 * Math.exp(-Math.pow((f - F3) / 320, 2)) + 0.03;
    return P + E.e * (0.03 + comb) * form / (1 + Math.pow(f / 900, 1.6));
  }

  /* ---------- tiny BMP encoder: heatmaps as one <image> element instead of thousands of rects ---------- */
  var STOPS = [[0, [6, 8, 24]], [0.3, [58, 26, 112]], [0.55, [150, 95, 230]], [0.78, [255, 128, 70]], [1, [255, 228, 150]]];
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
  /* spectrogram of the 3 s analysis segment. Linear: 600 x 200 (200 rows = 40 Hz bins, like n_fft 400);
   * mel: 384 x 128 (128 mel bins). Each row integrates power over its frequency band (sub-sampled), which is
   * exactly what a filterbank does and avoids aliasing the harmonic comb. Both have aspect 3:1. */
  function spectro(ctx, syl, mel) {
    var r = ctx.rng(mel ? 9 : 8), mMax = melOf(8000);
    var W = mel ? 384 : 600, H = mel ? 128 : 200, SUB = mel ? 6 : 3;
    var cols = [];
    for (var x = 0; x < W; x++) { var t = SEG0 + x / W * 3; cols.push({ E: envAt(syl, t), f0: f0At(t) }); }
    function fAt(q) { return mel ? hzOfMel(q * mMax) : q * 8000; }
    return bmp(W, H, function (x, y) {
      var q0 = (H - 1 - y) / H, q1 = (H - y) / H, c = cols[x], P = 0;
      for (var k = 0; k < SUB; k++) P += power(c.E, c.f0, Math.max(20, fAt(q0 + (q1 - q0) * (k + 0.5) / SUB)), r());
      var dB = 10 * Math.log(P / SUB) / Math.LN10;
      return cm((dB + 50) / 46);
    });
  }
  /* image that can be revealed left-to-right by animating its width (xMinYMin slice keeps scale fixed) */
  function img(ctx, parent, uri, x, y, w, h) {
    var e = ctx.el('image', { href: uri, x: x, y: y, width: w, height: h, preserveAspectRatio: 'xMinYMin slice' }, parent);
    e.fullW = w;
    return e;
  }
  function wipe(ctx, e, ms, delay) {
    e.setAttribute('width', 0.01);
    return ctx.tween(ms, function (t) { e.setAttribute('width', Math.max(0.01, e.fullW * t).toFixed(1)); }, 'linear', delay);
  }
  function title(ctx, parent, x, y, s, col) {
    return ctx.text(x, y, s, { size: 18, font: 'display', weight: 700, color: col || 'white', parent: parent });
  }
  function note(ctx, parent, x, y, s, col, anchor) {
    return ctx.text(x, y, s, { size: 12, font: 'mono', color: col || 'dim', anchor: anchor || 'start', parent: parent });
  }
  function hide(list) { list.forEach(function (e) { e.setAttribute('opacity', 0); }); }
  function sweep(ctx, list, opts) {
    return list.reduce(function (p, n) { return p.then(function () { return ctx.pulse(n, opts); }); }, Promise.resolve());
  }

  Atlas.register({
    id: 'audio-encoder',
    refs: [
      'Radford et al., <i>Robust Speech Recognition via Large-Scale Weak Supervision (Whisper)</i>, ICML 2023',
      'Zeghidour et al., <i>SoundStream: An End-to-End Neural Audio Codec</i>, IEEE/ACM TASLP 2022',
      'Défossez et al., <i>High Fidelity Neural Audio Compression (EnCodec)</i>, TMLR 2023; Kumar et al., <i>High-Fidelity Audio Compression with Improved RVQGAN (DAC)</i>, NeurIPS 2023',
      'Hsu et al., <i>HuBERT: Self-Supervised Speech Representation Learning by Masked Prediction of Hidden Units</i>, TASLP 2021',
      'Borsos et al., <i>AudioLM: a Language Modeling Approach to Audio Generation</i>, TASLP 2023',
      'Défossez et al., <i>Moshi: a speech-text foundation model for real-time dialogue</i> (Mimi codec), 2024',
      'Desplanques et al., <i>ECAPA-TDNN: Emphasized Channel Attention, Propagation and Aggregation in TDNN Based Speaker Verification</i>, Interspeech 2020',
      'Du et al., <i>CosyVoice 2: Scalable Streaming Speech Synthesis with Large Language Models</i>, 2024',
      'Chu et al., <i>Qwen2-Audio Technical Report</i>, 2024'
    ],
    setup: function (ctx) {
      var S = ctx.state;
      S.syl = syllables(ctx);
    },
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'The voice memo',
        beats: [
          {
            say: 'Now the voice memo: forty two seconds of the creator speaking into a phone, compressed as AAC at forty eight kilohertz in stereo.',
            card: { tag: 'NUMBERS', title: 'The memo as delivered', stat: { v: '4.0 M', u: 'samples', l: '42 s × 48,000 Hz × 2 channels, compressed by AAC on the phone' } },
            deep: '<p>The waveform above is what the microphone recorded: sound pressure over time, one number per sample. Phones usually store it as AAC-LC in an <code>.m4a</code> container.</p>' +
              '<div class="eq">42 s × 48,000 Hz × 2 channels = 4,032,000 samples</div>' +
              '<p>AAC streams typically carry roughly 1,000 to 2,100 samples of priming delay (Apple declares 2,112), and phone containers can start at a non-zero timestamp, so the container timestamps and edit list, not a raw sample count, are the truth about where each moment falls. The 4.0 M figure is therefore the decoded length, a few thousand samples off the nominal one.</p>'
          },
          {
            say: 'The first job is unglamorous but essential. Decode it, and average the two channels to mono.',
            card: { tag: 'HOW IT WORKS', title: 'Decode, then downmix', body: 'AAC becomes raw float samples in [−1, 1], and left plus right is averaged to one channel. Speech encoders are mono.' },
            deep: '<ul><li><b>Decode</b>: AAC-LC → PCM float32 in [−1, 1] (ffmpeg / libfdk).</li>' +
              '<li><b>Downmix</b>: <code>x = (L + R)/2</code>; check for phase-inverted channels (cancellation) first.</li></ul>' +
              '<p>A phase-inverted pair (a recording bug on some conferencing apps) sums to near silence: measure the correlation of L and R before averaging and fall back to a single channel if it is strongly negative.</p>'
          },
          {
            say: 'Then low pass filter below eight kilohertz so nothing aliases, and keep every third sample.',
            card: { tag: 'PITFALL', title: 'No low-pass, no clean audio', body: 'Dropping samples without filtering folds energy above 8 kHz, such as sibilants, back into the speech band as aliasing.', more: '<p>Sampling theorem: a signal sampled at 16 kHz can only represent frequencies up to 8 kHz (the Nyquist limit). Anything above folds down: a 10 kHz hiss becomes a 6 kHz tone. Hence a Kaiser-windowed sinc low-pass with cutoff ≈ 0.9 × 8 kHz = 7.2 kHz before decimating by 3.</p>' },
            deep: '<ul><li><b>Resample 48k → 16k</b>: polyphase FIR (Kaiser-windowed sinc) with cutoff ≈ 0.9 × 8 kHz, decimate by 3. Without the low-pass, energy above 8 kHz (sibilants) folds back as aliasing.</li></ul>' +
              '<p>The inset shows 4 ms of the memo: the thin stems are the 192 samples of the 48 kHz signal, the amber dots are the 64 samples that survive at 16 kHz. Because the low-pass removed everything above 8 kHz first, the dots still trace the same waveform.</p>'
          },
          {
            say: 'The result is six hundred and seventy two thousand floating point samples at sixteen kilohertz, the standard input rate for speech models.',
            card: { tag: 'NUMBERS', title: 'Ready for the encoder', stat: { v: '672,000', u: 'samples', l: '42 s × 16 kHz mono float32, about 2.7 MB, down from 4.0 M samples' } },
            deep: '<div class="eq">42 s × 16,000 = 672,000 samples (2.7 MB float32) vs 4,032,000 at 48 kHz stereo</div>' +
              '<ul><li><b>Normalise</b>: loudness to ≈ −23 LUFS (EBU R128) or peak-normalise; trim silence with a VAD (e.g. Silero).</li></ul>' +
              '<p>Why 16 kHz? Speech intelligibility lives below ~8 kHz (Nyquist of 16 kHz), and nearly all ASR/speech encoders (Whisper, HuBERT, w2v-BERT, ECAPA) are trained at 16 kHz. Music and high-fidelity codecs use 24, 44.1 or 48 kHz.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.top = ctx.group();
          var r = ctx.rng(3), d = '';
          for (var i = 0; i <= 720; i++) {
            var t = i / 720 * DUR, a = Math.min(1, envAt(S.syl, t).e) * (0.55 + 0.45 * r()) * 44 + 0.8;
            var x = (WX + WW * i / 720).toFixed(1);
            d += 'M' + x + ',' + (WY - a).toFixed(1) + 'V' + (WY + a).toFixed(1);
          }
          ctx.rect(WX - 10, WY - 56, WW + 20, 112, { rx: 10, fill: 'rgba(255,138,61,0.04)', stroke: ctx.alpha('orange', 0.35), sw: 1, parent: S.top });
          S.wave = ctx.path(d, { stroke: 'orange', sw: 1.3, parent: S.top });
          for (var s = 0; s <= 42; s += 6) {
            var tx = WX + WW * s / DUR;
            ctx.line(tx, WY + 50, tx, WY + 58, { color: 'faint', parent: S.top });
            note(ctx, S.top, tx, WY + 70, s + ' s', 'dim', 'middle');
          }
          note(ctx, S.top, WX + WW, WY - 68, 'memo.m4a · 42 s · "Twelve hours after impact, the ice began to sing…"', 'orange', 'end');
          var P = S.p1 = ctx.group();
          var chips = ['AAC decode', 'downmix L+R', 'low-pass 7.2 kHz', 'keep every 3rd', '16 kHz mono f32'];
          var cx = [180, 400, 620, 840, 1060];
          var nodes = [], ls = [];
          function chip(i) {
            nodes[i] = ctx.node({ x: cx[i], y: 390, w: 180, h: 44, title: chips[i], color: i === 4 ? 'amber' : 'orange', titleSize: 13, glow: false, parent: P });
            if (i) ls[i - 1] = ctx.link(nodes[i - 1], nodes[i], { color: 'orange', straight: true, parent: P });
          }

          /* beat 0: the waveform as delivered */
          ctx.reveal(S.top, { dur: 400 });
          return ctx.reveal(S.wave, { from: 'draw', dur: 1400 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: decode, downmix */
            chip(0); chip(1);
            ctx.reveal([nodes[0], nodes[1]], { from: 'left', stagger: 200 });
            ctx.reveal(ls[0], { from: 'draw', delay: 400 });
            return ctx.wait(800).then(function () { return ctx.packet(ls[0], { color: 'orange', dur: 500 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: low-pass and decimate, seen on 4 ms of signal */
            chip(2); chip(3);
            ctx.reveal([nodes[2], nodes[3]], { from: 'left', stagger: 200 });
            ctx.reveal([ls[1], ls[2]], { from: 'draw', stagger: 200, delay: 400 });
            var ix = 120, iy = 470, iw = 900, ih = 300, mid = iy + ih / 2;
            var inset = ctx.group({ parent: P });
            ctx.rect(ix, iy, iw, ih, { rx: 10, fill: 'rgba(8,12,26,0.85)', stroke: ctx.alpha('orange', 0.35), parent: inset });
            note(ctx, inset, ix + 16, iy + 22, '4 ms of the memo (t = 12.40 s)', 'text');
            var sig = function (tt) { var f0 = f0At(12.4), v = 0; for (var h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * h * f0 * 2.2 * tt + h) / h; return v * 0.62; };
            var cd = '';
            for (var j = 0; j <= 200; j++) { var tt = j / 200 * 0.004; cd += (j ? 'L' : 'M') + (ix + 30 + (iw - 60) * j / 200).toFixed(1) + ',' + (mid - sig(tt) * 100).toFixed(1); }
            ctx.path(cd, { stroke: ctx.alpha('white', 0.35), sw: 1.2, parent: inset });
            var st = '', dots = [];
            for (var q = 0; q < 192; q++) { var t2 = q / 192 * 0.004, xx = ix + 30 + (iw - 60) * q / 192; st += 'M' + xx.toFixed(1) + ',' + mid + 'V' + (mid - sig(t2) * 100).toFixed(1); }
            var stems = ctx.path(st, { stroke: ctx.alpha('orange', 0.45), sw: 1, parent: inset });
            for (var q2 = 0; q2 < 192; q2 += 3) { var t3 = q2 / 192 * 0.004; dots.push(ctx.circle(ix + 30 + (iw - 60) * q2 / 192, mid - sig(t3) * 100, 3.4, { fill: 'amber', parent: inset })); }
            ctx.line(ix + 20, mid, ix + iw - 20, mid, { color: 'faint', sw: 1, parent: inset });
            note(ctx, inset, ix + 16, iy + ih - 18, 'thin stems: 192 samples @ 48 kHz     dots: 64 kept @ 16 kHz (after low-pass)', 'dim');
            var para = ctx.para(1060, 500, ['Nyquist(16 kHz) = 8 kHz', 'speech intelligibility', 'lives below ~8 kHz', '', 'without the low-pass,', 'sibilant energy above', '8 kHz aliases back', 'into the speech band'], { size: 13, font: 'mono', color: 'text', lh: 22, parent: P });
            hide(dots); hide([stems, para]);
            ctx.reveal(inset, { dur: 400, delay: 500 });
            ctx.reveal(stems, { from: 'fade', delay: 1000 });
            ctx.reveal(dots, { from: 'scale', stagger: 30, delay: 1400 });
            ctx.reveal(para, { from: 'left', delay: 1800 });
            return ctx.wait(1400).then(function () {
              return [1, 2].reduce(function (p, k) { return p.then(function () { return ctx.packet(ls[k], { color: 'orange', dur: 350 }); }); }, Promise.resolve());
            }).then(function () { return ctx.wait(1500); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: 672,000 samples at 16 kHz */
            chip(4);
            var n1 = note(ctx, P, 1170, 385, '672,000 samples', 'amber');
            var n2 = note(ctx, P, 1170, 403, '= 2.7 MB float32', 'dim');
            ctx.reveal(nodes[4], { from: 'left' });
            ctx.reveal(ls[3], { from: 'draw', delay: 300 });
            ctx.reveal([n1, n2], { from: 'left', delay: 700, stagger: 150 });
            ctx.hud('42 s × 16 kHz = 672,000 samples');
            return ctx.wait(700).then(function () { return ctx.packet(ls[3], { color: 'orange', dur: 500 }); }).then(function () {
              return ctx.pulse(nodes[4], { color: 'amber', dur: 700 });
            });
          });
        }
      },

      /* ------------------------------------------------------------------ 2 */
      {
        title: 'STFT framing',
        beats: [
          {
            say: 'Speech changes every few milliseconds, so we analyse it in short overlapping windows. A twenty five millisecond Hann window, four hundred samples long, slides forward ten milliseconds at a time.',
            card: { tag: 'NUMBERS', title: 'A sliding Hann window', stat: { v: '400', u: 'samples', l: '25 ms Hann window at 16 kHz, advancing 160 samples (10 ms) per hop' } },
            deep: '<div class="eq">X[m, k] = Σ<sub>n=0</sub><sup>N−1</sup> x[n + mH] · w[n] · e<sup>−j2πkn/N</sup>, &nbsp; N = 400, H = 160</div>' +
              '<div class="eq">w[n] = 0.5 − 0.5 cos(2πn/N) &nbsp;(periodic Hann)</div>' +
              '<p>The Hann taper fades each slice to zero at its edges so the abrupt cut does not smear energy across all frequencies (spectral leakage). Adjacent windows overlap by 60%.</p>'
          },
          {
            say: 'Each windowed slice goes through a fast Fourier transform, giving the energy in two hundred and one frequency bins.',
            card: { tag: 'NUMBERS', title: 'Bins per frame', stat: { v: '201', u: 'bins', l: 'N/2 + 1 frequencies from 0 to 8 kHz, spaced 16000/400 = 40 Hz apart' }, more: '<p>Cost: a naive length-400 DFT is 400² = 160 k multiply-adds; the FFT brings it to O(N log N) ≈ 3.5 k. Whisper computes 3000 such transforms per 30 s window, about 10 M operations, negligible next to the encoder\'s 1.9 TFLOP.</p>' },
            deep: '<ul><li>Bins: N/2 + 1 = <b>201</b>, spacing 16000/400 = 40 Hz.</li>' +
              '<li>Power spectrum <code>|X|²</code>; phase is discarded (fine for recognition, not for resynthesis).</li></ul>' +
              '<p>Time–frequency trade-off: bins are 40 Hz apart and a Hann main lobe is ≈ 80 Hz wide at −6 dB (160 Hz null to null). A 25 ms window therefore only <i>marginally</i> separates the ~120 Hz harmonics of this voice (3 bins apart): the stripes are crisp in the low harmonics and blur higher up. In exchange the window stays shorter than a phoneme (~50–100 ms). Longer windows sharpen pitch but smear transients like plosives.</p>' +
              '<details><summary>Go deeper</summary><p>Why Hann? It is a raised cosine, so both the window and its first derivative go to zero at the edges, giving side lobes that fall 18 dB per octave. A periodic Hann satisfies the constant-overlap-add (COLA) condition at hops of N/2 or N/4, which is what lets a vocoder invert an STFT. Whisper\'s hop of N/2.5 is not COLA, which is harmless because a recogniser never resynthesises: the phase is thrown away at the |X|² step.</p></details>'
          },
          {
            say: 'One hundred windows per second, stacked side by side, form a spectrogram: time runs left to right, frequency bottom to top.',
            card: { tag: 'NUMBERS', title: 'Frames per second', stat: { v: '100', u: 'frames/s', l: '30 s of audio = 3000 frames × 201 bins; Whisper pads or trims every window to 30 s' } },
            deep: '<ul><li>Frames: 16000/160 = <b>100 per second</b>; 30 s → 3000 frames (Whisper pads/trims every window to 30 s).</li></ul>' +
              '<p>The 3 s segment highlighted on the full waveform becomes 300 frames × 201 bins here. Each pixel column is one 10 ms hop, each row a 40 Hz band, brightness the log energy.</p>' +
              '<div class="note">Everything here is a fixed, differentiable linear operation: GPU implementations (torch.stft) process an hour of audio in well under a second.</div>'
          },
          {
            say: 'Notice the horizontal harmonic stripes of the voice: they are the pitch of the speaker made visible.',
            card: { tag: 'KEY IDEA', title: 'Pitch shows up as stripes', body: 'A voiced sound repeats about 120 times a second, so its energy sits on evenly spaced harmonics. The stripes are 120 Hz apart.' },
            deep: '<p>Voiced speech is a periodic pulse train (the vocal folds) shaped by the vocal tract. In frequency, a train of period T<sub>0</sub> = 1/f<sub>0</sub> becomes a comb of harmonics at multiples of f<sub>0</sub>; here f<sub>0</sub> ≈ 118 Hz, so stripes sit every ~120 Hz, i.e. every 3 bins.</p>' +
              '<p>The broad bright bands that move with each vowel are <b>formants</b>: vocal-tract resonances that identify the vowel. Pitch and formants are separated on the mel scale of the next step.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.p1, 400);
          var sx0 = WX + WW * SEG0 / DUR, sx1 = WX + WW * (SEG0 + 3) / DUR;
          S.segHl = ctx.rect(sx0, WY - 50, sx1 - sx0, 100, { rx: 4, fill: ctx.alpha('amber', 0.1), stroke: 'amber', sw: 1.5, parent: S.top });
          S.segLab = note(ctx, S.top, (sx0 + sx1) / 2, WY - 60, '3 s analysed below', 'amber', 'middle');
          hide([S.segHl, S.segLab]);
          var P = S.p2 = ctx.group();
          title(ctx, P, 90, 372, '100 ms of waveform · Hann window 25 ms · hop 10 ms');
          var ix = 90, iy = 400, iw = 640, ih = 260, mid = iy + ih / 2;
          ctx.rect(ix, iy, iw, ih, { rx: 10, fill: 'rgba(8,12,26,0.85)', stroke: ctx.alpha('orange', 0.3), parent: P });
          var sig = function (tt) { var f0 = f0At(12.5), v = 0; for (var h = 1; h <= 9; h++) v += Math.sin(2 * Math.PI * h * f0 * tt + h * 1.3) * Math.exp(-Math.pow((h * f0 - 600) / 700, 2)); return v; };
          var smax = 0;
          for (var jj = 0; jj <= 400; jj++) smax = Math.max(smax, Math.abs(sig(jj / 400 * 0.1)));
          var d = '';
          for (var j = 0; j <= 400; j++) { var tt = j / 400 * 0.1; d += (j ? 'L' : 'M') + (ix + 20 + (iw - 40) * j / 400).toFixed(1) + ',' + (mid - sig(tt) / smax * 95).toFixed(1); }
          ctx.path(d, { stroke: 'orange', sw: 1.3, parent: P });
          var pw = (iw - 40) * 0.25;   /* 25 ms of 100 ms */
          var win = ctx.group({ parent: P });
          var wd = '';
          for (var k = 0; k <= 60; k++) { var u = k / 60; wd += (k ? 'L' : 'M') + (u * pw).toFixed(1) + ',' + (-(0.5 - 0.5 * Math.cos(2 * Math.PI * u)) * 110).toFixed(1); }
          ctx.rect(0, -120, pw, 240, { rx: 4, fill: ctx.alpha('amber', 0.08), stroke: ctx.alpha('amber', 0.7), sw: 1.2, dash: '4 4', parent: win });
          ctx.path(wd, { stroke: 'amber', sw: 2, parent: win });
          ctx.text(pw / 2, 108, '400 samples', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: win });
          ctx.place(win, ix + 20, mid);
          var n1 = note(ctx, P, ix + 16, iy + ih + 22, 'window 400 samples = 25 ms · hop 160 samples = 10 ms', 'dim');
          var n2 = note(ctx, P, ix + 16, iy + ih + 42, 'n_fft 400 → 201 bins (40 Hz apart) · 100 frames / s', 'dim');
          hide([win, n2]);
          /* right: spectrogram frame, image, axes */
          var gx = 800, gy = 400, gw = 720, gh = 240;
          var frame = ctx.group({ parent: P });
          ctx.rect(gx - 2, gy - 2, gw + 4, gh + 4, { rx: 4, stroke: ctx.alpha('orange', 0.35), sw: 1, parent: frame });
          note(ctx, frame, gx - 8, gy + 6, '8 kHz', 'dim', 'end');
          note(ctx, frame, gx - 8, gy + gh - 4, '0', 'dim', 'end');
          note(ctx, frame, gx, gy + gh + 20, '12 s', 'dim');
          note(ctx, frame, gx + gw, gy + gh + 20, '15 s', 'dim', 'end');
          hide([frame]);
          S.lin = img(ctx, P, spectro(ctx, S.syl, false), gx, gy, gw, gh);
          S.lin.setAttribute('width', 0.01);
          var scap = note(ctx, P, gx + gw / 2, gy + gh + 20, '|STFT|² · 300 frames × 201 bins (linear Hz)', 'text', 'middle');
          var cursor = ctx.rect(gx, gy - 6, 3, gh + 12, { rx: 1, fill: 'amber', parent: P });
          var link = ctx.path('M' + (ix + iw) + ',' + mid + ' C' + (ix + iw + 40) + ',' + mid + ' ' + (gx - 40) + ',' + (gy + gh / 2) + ' ' + (gx - 4) + ',' + (gy + gh / 2), { stroke: 'amber', sw: 1.4, arrow: true, dash: '4 4', parent: P });
          var fftT = ctx.text(ix + iw + 14, mid - 14, 'FFT', { size: 12, font: 'mono', color: 'amber', parent: P });
          var binT = ctx.text(ix + iw + 14, mid + 22, '201 bins', { size: 11, font: 'mono', color: 'dim', parent: P });
          hide([scap, cursor, link, fftT, binT]);
          var hn = ctx.group({ parent: P });
          ctx.text(gx + gw - 8, gy + gh + 50, 'harmonic stripes: pitch ≈ 118 Hz → one every ~120 Hz', { size: 12, font: 'mono', color: 'amber', anchor: 'end', parent: hn });
          hide([hn]);

          /* beat 0: a 25 ms Hann window hops along the waveform */
          ctx.reveal([S.segHl, S.segLab], { dur: 400, stagger: 100 });
          ctx.reveal(P, { dur: 400 });
          return ctx.wait(500).then(function () {
            ctx.reveal(win, { dur: 300 });
            return ctx.tween(2200, function (t) {
              var hops = Math.min(7, Math.floor(t * 8));
              ctx.place(win, ix + 20 + hops * (iw - 40) * 0.1, mid);
            }, 'linear', 300);
          }).then(function () {
            ctx.place(win, ix + 20 + 2 * (iw - 40) * 0.1, mid);
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the FFT of one slice: 201 bins */
            ctx.reveal(n2, { from: 'up' });
            ctx.reveal(frame, { dur: 400 });
            ctx.reveal([link, fftT, binT], { from: 'left', stagger: 150 });
            return ctx.wait(700).then(function () { return ctx.packet(link, { color: 'amber', dur: 700 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: 100 windows per second stacked into a spectrogram */
            ctx.reveal([scap, cursor], { dur: 300 });
            return ctx.tween(3200, function (t) {
              var hops = Math.floor(t * 30) % 8;
              ctx.place(win, ix + 20 + hops * (iw - 40) * 0.1, mid);
              S.lin.setAttribute('width', Math.max(0.01, gw * t).toFixed(1));
              cursor.setAttribute('x', (gx + gw * t - 1).toFixed(1));
            }, 'linear').then(function () {
              ctx.place(win, ix + 20 + 2 * (iw - 40) * 0.1, mid);
              S.lin.setAttribute('width', gw);
              return ctx.wait(300);
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: harmonic stripes */
            S.harmHl = ctx.highlight(S.lin, { color: 'amber', pad: 0 });
            S.harmHl.setAttribute('x', gx + 213); S.harmHl.setAttribute('y', gy + gh * 0.6); S.harmHl.setAttribute('width', 250); S.harmHl.setAttribute('height', gh * 0.4);
            return ctx.reveal(hn, { from: 'up' }).then(function () { return ctx.pulse(S.harmHl, { color: 'amber', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Log-mel spectrogram',
        beats: [
          {
            say: 'Human hearing resolves low frequencies finely and high frequencies coarsely, so the linear bins are pooled by a bank of triangular mel filters, narrow at the bottom and wide at the top.',
            card: { tag: 'HOW IT WORKS', title: 'Triangular mel filters', body: 'Each filter averages a band of the 201 linear bins. Narrow and dense below 1 kHz, wide and sparse above, like the cochlea.' },
            deep: '<div class="eq">mel(f) = 2595 · log<sub>10</sub>(1 + f/700) &nbsp;(HTK form)</div>' +
              '<p><span class="muted">Whisper builds its bank with librosa defaults: the Slaney mel scale (linear below 1 kHz, logarithmic above) and area-normalised triangles; the shape of the warp is nearly identical.</span></p>' +
              '<ul><li>Mel spacing: filters are ~equally spaced below 1 kHz and logarithmically above, matching cochlear resolution.</li></ul>'
          },
          {
            say: 'Whisper large version three uses one hundred and twenty eight of them, so each frame shrinks from two hundred and one bins to one hundred twenty eight mel bands.',
            card: { tag: 'NUMBERS', title: 'A 128-band mel bank', stat: { v: '128', u: 'bands', l: 'per frame, from 201 linear bins (Whisper v1/v2 used 80); M ∈ ℝ¹²⁸ˣ²⁰¹' } },
            deep: '<div class="eq">S<sub>mel</sub> = M · |X|², &nbsp; M ∈ ℝ<sup>128×201</sup> (triangular, Slaney-normalised)</div>' +
              '<ul><li>The pitch harmonics blur together at high mel bins; formants (vowel identity) survive: exactly what recognition needs.</li></ul>' +
              '<p>On the right the same 3 s segment, now with 128 rows: the low rows resolve the pitch harmonics, the upper rows blend them.</p>'
          },
          {
            say: 'A logarithm then compresses the huge dynamic range, much as loudness perception does, and the result is clamped to eighty decibels.',
            card: { tag: 'HOW IT WORKS', title: 'Log, clamp, scale', body: 'Take log10, keep only the top 80 dB below the loudest bin, then rescale to roughly [−1, 1]. Quiet detail stays visible.' },
            deep: '<div class="eq">L = log<sub>10</sub>(max(S<sub>mel</sub>, 10<sup>−10</sup>)); &nbsp; L = max(L, max(L) − 8); &nbsp; L = (L + 4)/4</div>' +
              '<p>That is Whisper\'s exact normalisation: clamp to an 80 dB dynamic range, then scale to roughly [−1, 1]. Speech spans well over 60 dB between a whispered consonant and a shouted vowel; on a linear scale the quiet parts would be invisible.</p>' +
              '<p>Training-time augmentation: SpecAugment masks random time and frequency bands.</p>'
          },
          {
            say: 'Thirty seconds of audio become a one hundred twenty eight by three thousand image, and from here on, audio is processed much like a picture.',
            card: { tag: 'NUMBERS', title: 'Audio as an image', stat: { v: '[128, 3000]', l: 'log-mel per 30 s window (v3): 128 mel bands × 100 frames per second' } },
            deep: '<p>Output per window: <code>[128, 3000]</code> (v3) or <code>[80, 3000]</code> (v1/v2). The encoder that follows treats this as a one-dimensional sequence of 3000 frames with 128 channels.</p>' +
              '<div class="note">Alternative front-ends learn the filterbank from the raw waveform (wav2vec 2.0 / HuBERT use a 7-layer strided CNN giving 50 Hz frames), but log-mel remains the default for encoders consumed by LLMs.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var old = S.p2;
          ctx.remove(S.harmHl, 300);
          ctx.fadeOut(Array.prototype.slice.call(old.childNodes).filter(function (n) { return n !== S.lin; }), 400, true);
          var P = S.p3 = ctx.group();
          var fx = 90, fy = 400, fw = 640, fh = 240;
          var mMax = melOf(8000), tris = [];
          var fbk = ctx.group({ parent: P });
          title(ctx, fbk, 90, 372, 'Mel filterbank (every 8th of 128 filters shown)');
          ctx.rect(fx, fy, fw, fh, { rx: 10, fill: 'rgba(8,12,26,0.85)', stroke: ctx.alpha('orange', 0.3), parent: fbk });
          for (var b = 0; b < 130; b += 8) {
            var f2 = hzOfMel(mMax * (b + 1) / 129);
            var sc = 8, fl = hzOfMel(mMax * Math.max(0, b - sc) / 129), fr = hzOfMel(mMax * Math.min(129, b + sc) / 129);
            var X = function (f) { return (fx + 20 + (fw - 40) * f / 8000).toFixed(1); };
            var hgt = fh - 60;
            tris.push(ctx.path('M' + X(fl) + ',' + (fy + fh - 30) + ' L' + X(f2) + ',' + (fy + fh - 30 - hgt * (0.55 + 0.45 * (1 - b / 130))) + ' L' + X(fr) + ',' + (fy + fh - 30), { stroke: ctx.cmap('heat', 0.35 + 0.6 * b / 130), sw: 1.6, parent: fbk }));
          }
          [0, 1000, 2000, 4000, 8000].forEach(function (f) { note(ctx, fbk, fx + 20 + (fw - 40) * f / 8000, fy + fh - 12, f >= 1000 ? (f / 1000) + 'k' : '0', 'dim', 'middle'); });
          note(ctx, fbk, fx + fw - 16, fy + 22, 'Hz (linear axis)', 'dim', 'end');
          var f1 = ctx.text(fx, fy + fh + 24, 'mel(f) = 2595·log₁₀(1 + f/700)', { size: 13, font: 'mono', color: 'text', parent: fbk });
          hide([fbk]);
          /* right: mel spectrogram replaces linear */
          var gx = 800, gy = 400, gw = 720, gh = 240;
          var mframe = ctx.group({ parent: P });
          ctx.rect(gx - 2, gy - 2, gw + 4, gh + 4, { rx: 4, stroke: ctx.alpha('orange', 0.35), sw: 1, parent: mframe });
          note(ctx, mframe, gx - 8, gy + 6, 'bin 127', 'dim', 'end');
          note(ctx, mframe, gx - 8, gy + gh - 4, '0', 'dim', 'end');
          note(ctx, mframe, gx + gw / 2, gy + gh + 20, 'log-mel · 128 bands × 100 frames/s', 'text', 'middle');
          note(ctx, mframe, gx, gy + gh + 42, 'low bins spread out (fine pitch detail), high bins compressed', 'dim');
          hide([mframe]);
          S.mel = img(ctx, P, spectro(ctx, S.syl, true), gx, gy, gw, gh);
          S.mel.setAttribute('width', 0.01);
          var mm = ctx.text(fx, fy + fh + 48, 'M ∈ ℝ¹²⁸ˣ²⁰¹ · 128 rows, each a triangle over |X|²', { size: 13, font: 'mono', color: 'amber', parent: P });
          hide([mm]);
          var logT = ctx.group({ parent: P });
          ctx.text(fx, fy + fh + 76, 'L = log₁₀(max(M|X|², 1e−10)) → clamp to 80 dB → (L + 4)/4', { size: 13, font: 'mono', color: 'text', parent: logT });
          var cbar = ctx.group({ parent: logT });
          for (var cq = 0; cq < 24; cq++) ctx.rect(gx + gw + 12, gy + cq * (gh / 24), 12, gh / 24 + 0.5, { rx: 0, fill: 'rgb(' + cm(1 - cq / 23).join(',') + ')', parent: cbar });
          note(ctx, cbar, gx + gw + 18, gy - 12, 'loud', 'dim', 'middle');
          note(ctx, cbar, gx + gw + 18, gy + gh + 12, '−80 dB', 'dim', 'middle');
          hide([logT]);
          var cap3 = ctx.text(gx + gw / 2, gy + gh + 66, '[128, 3000] per 30 s window: an image', { size: 14, font: 'mono', color: 'amber', anchor: 'middle', parent: P });
          hide([cap3]);

          /* beat 0: triangular mel filters */
          ctx.hud('mel filterbank M ∈ ℝ¹²⁸ˣ²⁰¹');
          ctx.reveal(P, { dur: 300 });
          ctx.reveal(fbk, { dur: 400 });
          return ctx.reveal(tris, { from: 'draw', stagger: 80, dur: 500, delay: 300 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: 128 filters pool 201 bins; mel spectrogram is computed */
            ctx.reveal(mm, { from: 'up' });
            ctx.reveal(mframe, { dur: 300 });
            return wipe(ctx, S.mel, 2600, 300).then(function () {
              ctx.remove(S.lin, 300);
              if (old.parentNode) ctx.remove(old, 300);
              return ctx.wait(500);
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: log compression, clamp, scale */
            return ctx.reveal(logT, { from: 'up' }).then(function () { return ctx.pulse(cbar, { color: 'orange', dur: 700 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the result is an image */
            return ctx.reveal(cap3, { from: 'up' }).then(function () { return ctx.pulse(S.mel, { color: 'amber', dur: 800 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Whisper encoder',
        beats: [
          {
            say: 'The Whisper encoder first applies two one dimensional convolutions over time. The first keeps the frame rate and lifts the one hundred twenty eight mel bands to twelve eighty channels.',
            card: { tag: 'HOW IT WORKS', title: 'A conv stem lifts the width', body: 'Conv1d with kernel 3 and stride 1 maps 128 mel channels to 1280 features per frame, still at 100 frames per second.' },
            deep: '<pre>x = gelu(conv1(mel))  # k3 s1: [1280,3000]\nx = gelu(conv2(x))    # k3 s2: [1280,1500]\nx = x.T + sin_pos     # [1500, 1280]\nfor blk in blocks:    # 32 pre-LN blocks\n    x = blk(x)        # 20 heads, bidir.\nx = ln_post(x)        # 50 Hz features</pre>' +
              '<p>The first convolution has 128·1280·3 ≈ 0.5 M parameters; it acts like a learned local feature extractor over 30 ms of context (three 10 ms frames) before any attention.</p>'
          },
          {
            say: 'The second has stride two, halving the frame rate to fifty per second, so each output frame covers twenty milliseconds.',
            card: { tag: 'NUMBERS', title: 'Twenty milliseconds per frame', stat: { v: '50 Hz', l: 'after the stride-2 convolution: 1500 frames per 30 s window, 1280 wide' } },
            deep: '<p>Stride 2 halves the sequence from 3000 to 1500 frames, which cuts self-attention cost by 4× (it is quadratic in length) at little accuracy cost, because 20 ms is still finer than a phoneme (50–100 ms).</p>' +
              '<p>Compare with the raw front-ends: wav2vec 2.0 and HuBERT use a strided conv stack (total stride 320 samples = 20 ms) and get the same 50 Hz rate.</p>'
          },
          {
            say: 'Sinusoidal positions are added, and thirty two transformer blocks with bidirectional attention turn the frames into contextual features.',
            card: { tag: 'NUMBERS', title: 'The Whisper-v3 encoder', stat: { v: '≈ 0.63 B', u: 'params', l: '32 layers, width 1280, 20 heads, MLP 5120; about 1.9 TFLOP per 30 s window' }, more: '<p>Positions: Whisper adds fixed sinusoids to the 1500 frames (the decoder learns its own). Because the encoder always sees exactly 1500 positions, no length extrapolation is needed, which is also why the window is fixed at 30 s.</p>' },
            deep: '<table><tr><th>Whisper-large-v3 encoder</th><th></th></tr>' +
              '<tr><td>layers / width / heads / MLP</td><td>32 / 1280 / 20 / 5120</td></tr>' +
              '<tr><td>params</td><td>≈ 0.63 B</td></tr>' +
              '<tr><td>FLOPs per 30 s window</td><td>2·0.63 B·1500 ≈ 1.9 T + attn 4·32·1500²·1280 ≈ 0.37 T</td></tr></table>' +
              '<p>Positions are fixed sinusoids added once at the input; attention is bidirectional, since the whole 30 s clip is available offline.</p>'
          },
          {
            say: 'Because Whisper large version three was trained on millions of hours of weakly labelled and pseudo labelled audio, these features already encode phonemes, words, language, and a good deal about the speaker.',
            card: { tag: 'WHY IT MATTERS', title: 'Features for free', body: 'One million hours of weakly labelled and four million of pseudo-labelled audio make the frames robust to noise and accents. Audio LLMs start from them.' },
            deep: '<table><tr><th>Whisper-large-v3 encoder</th><th></th></tr>' +
              '<tr><td>training data (v3)</td><td>1 M h weakly labelled + 4 M h pseudo-labelled</td></tr></table>' +
              '<p>Audio-LLMs (Qwen2-Audio, Kimi-Audio, many others) initialise their audio encoder from Whisper for exactly this reason: robust, multilingual, noise-tolerant features for free. Phonemes, language id and speaker traits are linearly decodable from these frames.</p>'
          },
          {
            say: 'The catch is the fixed thirty second window: our forty two second memo becomes two windows, with the padding trimmed afterwards.',
            card: { tag: 'PITFALL', title: 'The 30 s window', body: 'Every clip is padded or chunked to 30 s. The 42 s memo takes two windows, and the padded second one wastes about 60% of its frames.' },
            deep: '<div class="note">Limitation: the fixed 30 s window forces padding and chunking (our 42 s memo = 2 windows). Streaming encoders use causal or chunked attention instead (e.g. Moshi\'s Mimi, streaming Conformers).</div>' +
              '<p>Window 1 holds 30 s = 1500 frames. Window 2 holds 12 s = 600 real frames plus 900 padding frames that are computed and then discarded. Total kept: 2100 frames.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.p3, 400);
          ctx.remove(S.mel, 400);
          var P = S.p4 = ctx.group();
          title(ctx, P, 90, 372, 'Conv stem (stride 2) → 32 transformer blocks → 50 Hz frames');
          var r = ctx.rng(12);
          function cols(x0, n, w, gap, y, h, col, vals) {
            var arr = [];
            for (var i = 0; i < n; i++) arr.push(ctx.rect(x0 + i * (w + gap), y, w, h, { rx: 1.5, fill: ctx.cmap(col, vals ? vals[i] : 0.25 + 0.7 * r()), parent: P }));
            return arr;
          }
          var v24 = [], v12 = [];
          for (var i = 0; i < 24; i++) v24.push(0.2 + 0.75 * Math.abs(Math.sin(i * 0.9)));
          for (var j = 0; j < 12; j++) v12.push((v24[2 * j] + v24[2 * j + 1]) / 2);
          var A = cols(90, 24, 8, 2, 420, 110, 'violet', v24);
          var nA = [note(ctx, P, 90, 548, 'log-mel · 100 fps', 'orange'), note(ctx, P, 90, 566, '[128 × 3000]', 'dim')];
          var c1 = ctx.node({ x: 380, y: 475, w: 110, h: 60, title: 'Conv1d', sub: 'k3 · s1 · GELU', color: 'orange', titleSize: 13, subSize: 10, glow: false, parent: P });
          var B = cols(460, 24, 8, 2, 420, 110, 'amber', v24);
          var nB = note(ctx, P, 460, 548, '[1280 × 3000]', 'dim');
          var l0 = ctx.link({ x: 332, y: 475 }, c1, { color: 'orange', straight: true, parent: P, to: 'l' });
          var l1 = ctx.link(c1, { x: 456, y: 475 }, { color: 'orange', straight: true, parent: P, from: 'r' });
          var b0 = A.concat(nA, [c1, l0, l1], B, [nB]);
          hide(b0);

          /* beat 0: mel frames in, conv1 lifts 128 -> 1280 channels */
          ctx.reveal(P, { dur: 400 });
          ctx.reveal(A.concat(nA), { from: 'left', stagger: 15 });
          ctx.reveal([c1], { from: 'scale', delay: 500 });
          ctx.reveal([l0, l1], { from: 'draw', stagger: 200, delay: 600 });
          return ctx.reveal(B.concat([nB]), { from: 'left', stagger: 15, delay: 900 }).then(function () {
            return ctx.pulse(c1, { color: 'orange', dur: 700 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: conv2 with stride 2 halves the frame rate */
            var c2 = ctx.node({ x: 760, y: 475, w: 110, h: 60, title: 'Conv1d', sub: 'k3 · s2 · GELU', color: 'orange', titleSize: 13, subSize: 10, glow: false, parent: P });
            var C = cols(840, 12, 18, 2, 420, 110, 'amber', v12);
            var nC = note(ctx, P, 840, 548, '[1280 × 1500] · 50 fps', 'amber');
            var l2 = ctx.link({ x: 702, y: 475 }, c2, { color: 'orange', straight: true, parent: P, to: 'l' });
            var l3 = ctx.link(c2, { x: 836, y: 475 }, { color: 'orange', straight: true, parent: P, from: 'r' });
            S.kern = ctx.rect(458, 414, 32, 122, { rx: 3, stroke: 'white', sw: 2, parent: P });
            hide(C); hide([c2, nC, l2, l3, S.kern]);
            ctx.hud('100 fps → 50 fps · 20 ms per frame');
            ctx.reveal([c2], { from: 'scale' });
            ctx.reveal([l2, l3], { from: 'draw', stagger: 150, delay: 200 });
            ctx.reveal([S.kern, nC], { delay: 400 });
            return ctx.wait(700).then(function () {
              return ctx.tween(2400, function (t) {
                var step = Math.min(11, Math.floor(t * 12));
                S.kern.setAttribute('x', (458 + step * 20).toFixed(1));
                for (var q = 0; q <= step; q++) C[q].setAttribute('opacity', 1);
              }, 'linear');
            }).then(function () {
              C.forEach(function (e) { e.setAttribute('opacity', 1); });
              ctx.fade(S.kern, 0, 300);
              return ctx.pulse(c2, { color: 'orange', dur: 600 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: sinusoidal positions and 32 transformer blocks */
            var stack = ctx.group({ parent: P });
            for (var k = 5; k >= 0; k--) ctx.rect(1110 + k * 6, 410 + k * 6, 150, 110, { rx: 10, fill: 'rgba(12,16,34,0.95)', stroke: ctx.alpha('orange', k ? 0.25 : 0.9), sw: k ? 1 : 1.5, parent: stack });
            ctx.text(1185, 450, 'Transformer', { size: 14, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: stack });
            ctx.text(1185, 472, '× 32 · d 1280', { size: 12, font: 'mono', color: 'orange', anchor: 'middle', parent: stack });
            ctx.text(1185, 492, '+ sinusoid pos', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: stack });
            var D = cols(1300, 12, 14, 3, 420, 110, 'orange');
            var nD = [note(ctx, P, 1300, 548, '[1500 × 1280]', 'orange'), note(ctx, P, 1300, 566, '1 frame = 20 ms', 'dim')];
            var l4 = ctx.link({ x: 1082, y: 475 }, { x: 1106, y: 475 }, { color: 'orange', straight: true, parent: P });
            var l5 = ctx.link({ x: 1268, y: 475 }, { x: 1296, y: 475 }, { color: 'orange', straight: true, parent: P });
            hide(D.concat(nD)); hide([stack, l4, l5]);
            ctx.hud('');
            ctx.reveal(stack, { from: 'scale' });
            ctx.reveal(l4, { from: 'draw', delay: 300 });
            return ctx.wait(700).then(function () {
              return ctx.packet(l4, { color: 'orange', dur: 500 });
            }).then(function () {
              ctx.reveal(nD, {});
              return ctx.reveal(D, { from: 'up', stagger: 60 });
            }).then(function () {
              ctx.reveal(l5, { from: 'draw', dur: 300 });
              return ctx.packet(l5, { color: 'orange', dur: 400 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: what the frames already encode */
            var p1 = ctx.para(90, 620, ['phonemes, words, language id and speaker traits are linearly decodable from these frames', 'FLOPs per 30 s window ≈ 1.9 T (linear) + 0.37 T (attention) · params ≈ 0.63 B'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: P });
            var tags = [
              ctx.label(1338, 396, 'phonemes', { color: 'amber', size: 11, bg: '#0d1a33', parent: P }),
              ctx.label(1422, 396, 'language', { color: 'amber', size: 11, bg: '#0d1a33', parent: P }),
              ctx.label(1500, 396, 'speaker', { color: 'amber', size: 11, bg: '#0d1a33', parent: P })
            ];
            hide([p1]); hide(tags);
            ctx.reveal(tags, { from: 'down', stagger: 150 });
            return ctx.reveal(p1, { from: 'up' }).then(function () { return sweep(ctx, [c1], { color: 'orange', dur: 500 }); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: 42 s = two 30 s windows */
            var W = ctx.group({ parent: P });
            var wx = 90, wy = 712, u = 500 / 30;
            ctx.rect(wx, wy, 30 * u, 26, { rx: 4, fill: ctx.alpha('orange', 0.4), stroke: 'orange', sw: 1.2, parent: W });
            ctx.text(wx + 15 * u, wy + 13, 'window 1 · 0–30 s · 1500 frames', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: W });
            ctx.rect(wx + 30 * u + 6, wy, 12 * u, 26, { rx: 4, fill: ctx.alpha('amber', 0.4), stroke: 'amber', sw: 1.2, parent: W });
            ctx.rect(wx + 42 * u + 6, wy, 18 * u, 26, { rx: 4, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('white', 0.25), sw: 1, dash: '4 3', parent: W });
            ctx.text(wx + 36 * u + 6, wy + 13, '12 s', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: W });
            ctx.text(wx + 51 * u + 6, wy + 13, 'zero padding', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: W });
            ctx.text(wx, wy + 48, 'memo 42 s → 2 windows → 2100 real frames (padding trimmed)', { size: 13, font: 'mono', color: 'amber', parent: W });
            hide([W]);
            S.win4 = W;
            return ctx.reveal(W, { from: 'up' }).then(function () { return ctx.pulse(W, { color: 'amber', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Pooling to LLM rate',
        beats: [
          {
            say: 'Fifty frames per second is still dense for a language model: our forty two second memo would cost twenty one hundred tokens.',
            card: { tag: 'NUMBERS', title: 'Raw Whisper frames', stat: { v: '2,100', u: 'frames', l: '42 s × 50 Hz: every 20 ms would become a token in the LLM context' } },
            deep: '<p>An LLM pays for every token twice: once in prefill compute and again in KV cache for the rest of the conversation. At 50 Hz a one-hour recording is 180,000 tokens, more than most context windows.</p>' +
              '<table><tr><th>method</th><th>rate</th><th>memo (42 s)</th></tr>' +
              '<tr><td>raw Whisper frames</td><td>50 Hz</td><td>2100</td></tr></table>'
          },
          {
            say: 'Audio language models pool adjacent frames, for example averaging pairs down to twenty five per second, as Qwen two Audio does, or using a learned adaptor down to twelve and a half per second, as Kimi Audio does.',
            card: { tag: 'HOW IT WORKS', title: 'Pool neighbouring frames', body: 'Pool pairs of frames (Qwen2-Audio, 25 Hz) or use an adaptor down to 12.5 Hz (Kimi-Audio; stacking four frames is one way). Two or four times fewer tokens.' },
            deep: '<table><tr><th>method</th><th>rate</th><th>memo (42 s)</th></tr>' +
              '<tr><td>stride-2 pooling (Qwen2-Audio)</td><td>25 Hz</td><td>1050</td></tr>' +
              '<tr><td>adaptor to 12.5 Hz (Kimi-Audio; e.g. stack ×4 + MLP)</td><td>12.5 Hz</td><td>525</td></tr>' +
              '<tr><td>window Q-Former (SALMONN)</td><td>1 query / 17 frames (~3 Hz)</td><td>~124 (88 per 30 s)</td></tr></table>' +
              '<p>Pooling before the MLP is cheaper than after: the MLP then runs on 25 rather than 50 vectors per second, and averaging adjacent frames is a mild low-pass in time that loses little, because neighbouring 20 ms frames are strongly correlated.</p>'
          },
          {
            say: 'The pooled frames are then projected into the language model\'s embedding space with a small MLP, just like the visual tokens.',
            card: { tag: 'KEY IDEA', title: 'Project to LLM width', body: 'A small MLP maps each pooled 1280-wide frame to the 3584-wide embedding the LLM expects. Audio tokens now sit beside words.' },
            deep: '<div class="eq">e.g. stacking four frames: h<sub>j</sub> = MLP([x<sub>4j</sub>; x<sub>4j+1</sub>; x<sub>4j+2</sub>; x<sub>4j+3</sub>]) ∈ ℝ<sup>d<sub>LLM</sub></sup>, &nbsp; [x] ∈ ℝ<sup>4·1280</sup></div>' +
              '<p>As with images, training is staged: first only the projector (and often the encoder) learns from speech–text pairs, then the LLM is unfrozen for audio instruction data.</p>'
          },
          {
            say: 'Our forty two second memo becomes about one thousand and fifty tokens, roughly seven and a half times more than its transcript, because they also carry tone, pace and emotion.',
            card: { tag: 'NUMBERS', title: 'Memo in LLM tokens', stat: { v: '1,050', u: 'tokens', l: 'at 25 Hz, about 7.5× a ~140-token transcript, because tone, pace and emotion are kept' } },
            deep: '<table><tr><th>method</th><th>rate</th><th>memo (42 s)</th></tr>' +
              '<tr><td>transcript only (ASR)</td><td>~3.3 tok/s</td><td>~140</td></tr></table>' +
              '<p>Why not just transcribe? The narrator\'s pacing, emphasis and emotion are exactly what the TTS agent must reproduce; a transcript drops all of it. The LLM can answer "where does the narrator pause for effect?" only from audio tokens.</p>' +
              '<div class="note">Timing alignment: 25 Hz → 40 ms per token. With M-RoPE-style temporal ids, audio tokens can be aligned to video time for lip-sync and cut timing.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.win4, 300);
          ctx.fade(S.p4, 0.3, 500);
          var P = S.p5 = ctx.group();
          var r = ctx.rng(5), f50 = [];
          var x0 = 90, y0 = 730;

          /* beat 0: the dense 50 Hz frame sequence */
          title(ctx, P, 90, 706, 'Downsample to the LLM token rate', 'white');
          for (var i = 0; i < 16; i++) f50.push(ctx.rect(x0 + i * 22, y0, 18, 80, { rx: 2, fill: ctx.cmap('orange', 0.3 + 0.6 * r()), parent: P }));
          var n50 = note(ctx, P, x0, y0 + 98, '50 Hz · 16 frames = 320 ms', 'orange');
          hide([P]);
          ctx.hud('memo → 2,100 frames @ 50 Hz');
          ctx.reveal(P, { dur: 300 });
          return ctx.reveal(f50, { from: 'left', stagger: 40, delay: 300 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: average pool by two */
            var ar = ctx.link({ x: 450, y: 770 }, { x: 510, y: 770 }, { color: 'orange', straight: true, label: 'avg-pool ×2', labelDx: 30, labelDy: -56, parent: P });
            var f25 = [];
            for (var j = 0; j < 8; j++) f25.push(ctx.rect(520 + j * 34, y0, 30, 80, { rx: 3, fill: ctx.cmap('amber', 0.35 + 0.55 * r()), parent: P }));
            var n25 = note(ctx, P, 520, y0 + 98, '25 Hz · 8 tokens', 'amber');
            hide(f25); hide([ar, n25]); ar.labelEl.setAttribute('opacity', 0);
            ctx.hud('memo → 1,050 tokens @ 25 Hz');
            ctx.reveal(ar, { from: 'draw' });
            ctx.reveal(ar.labelEl, { delay: 300 });
            return ctx.wait(500).then(function () {
              return ctx.tween(1600, function (t) {
                f50.forEach(function (e, i2) {
                  var j2 = i2 >> 1, tx = 520 + j2 * 34 + (i2 % 2) * 12;
                  e.setAttribute('x', ctx.lerp(x0 + i2 * 22, tx, t).toFixed(1));
                  e.setAttribute('opacity', (1 - 0.8 * t).toFixed(3));
                });
              }, 'inOut');
            }).then(function () {
              ctx.reveal(n25, { from: 'up' });
              return ctx.reveal(f25, { from: 'scale', stagger: 60 });
            }).then(function () {
              f50.forEach(function (e, i2) { e.setAttribute('x', x0 + i2 * 22); e.setAttribute('opacity', 1); });
              return ctx.wait(300);
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: MLP into the LLM embedding space */
            var ar2 = ctx.link({ x: 800, y: 770 }, { x: 860, y: 770 }, { color: 'amber', straight: true, label: 'MLP → 3584', labelDy: -56, parent: P });
            var tok = [];
            for (var k = 0; k < 8; k++) tok.push(ctx.rect(870 + k * 24, y0 + 20, 20, 40, { rx: 4, fill: ctx.alpha('amber', 0.8), stroke: 'amber', sw: 1, parent: P }));
            var nT = note(ctx, P, 870, y0 + 98, 'LLM audio tokens', 'amber');
            hide(tok); hide([nT]);
            ctx.reveal(ar2, { from: 'draw' });
            return ctx.wait(400).then(function () { return ctx.packet(ar2, { color: 'amber', dur: 500 }); }).then(function () {
              ctx.reveal(nT, { from: 'up' });
              return ctx.reveal(tok, { from: 'up', stagger: 70 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the memo in numbers, and words aligned to tokens */
            var words = [['the', 0], ['ice', 0.15], ['began', 0.34], ['to', 0.64], ['sing', 0.76]];
            var wt = words.map(function (w) { return note(ctx, P, 870 + w[1] * 190, y0 + 8, w[0], 'text'); });
            var para = ctx.para(1100, 736, ['42 s memo:', '  2100 frames @ 50 Hz', '  1050 tokens @ 25 Hz', '   525 tokens @ 12.5 Hz', '  ~140 transcript tokens'], { size: 13, font: 'code', pre: true, color: 'text', lh: 21, parent: P });
            hide(wt); hide([para]);
            ctx.reveal(wt, { from: 'down', stagger: 100 });
            return ctx.reveal(para, { from: 'left', delay: 300 }).then(function () { return ctx.pulse(para, { color: 'amber', dur: 700 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Codecs & RVQ',
        beats: [
          {
            say: 'Understanding needs continuous features, but generating speech needs something a language model can sample: discrete tokens.',
            card: { tag: 'KEY IDEA', title: 'Generation needs integers', body: 'An LLM outputs a probability over a finite vocabulary. To speak, audio must become a stream of integers it can sample.' },
            deep: '<p>Understanding can afford continuous vectors: the LLM only reads them. Generation cannot: a language model predicts a <b>categorical distribution</b> over a vocabulary, so the waveform must first be turned into discrete symbols, and the symbols back into a waveform.</p>' +
              '<p>That is the job of a <b>neural audio codec</b>: an autoencoder whose bottleneck is a stack of vector quantizers.</p>'
          },
          {
            say: 'Neural audio codecs such as SoundStream, EnCodec and DAC compress the waveform with a strided convolutional encoder to about seventy five latent vectors per second.',
            card: { tag: 'NUMBERS', title: 'Latent frame rate', stat: { v: '75 Hz', l: 'EnCodec 24 kHz: strides 2·4·5·8 = 320 samples per latent, each latent 128-dimensional' } },
            deep: '<ul><li><b>EnCodec (24 kHz)</b>: SEANet conv encoder, strides 2·4·5·8 = 320 → 75 Hz, 128-d latents, codebooks of 1024.</li>' +
              '<li><b>DAC (44.1 kHz)</b>: strides 2·4·8·8 = 512 → 86 Hz frames, 9 codebooks of 1024, with snake activations. <b>SoundStream</b> (2021) is the ancestor of both, and introduced the residual quantizer bottleneck.</li></ul>' +
              '<p>24,000 samples/s ÷ 320 = 75 latent frames per second. Each frame summarises 13.3 ms of audio in 128 numbers; the decoder mirrors the encoder with transposed convolutions.</p>'
          },
          {
            say: 'Each latent vector is then quantized with residual vector quantization. The first codebook picks the nearest centroid.',
            card: { tag: 'HOW IT WORKS', title: 'Stage 1: nearest centroid', body: 'The encoder output z is replaced by the closest of 1024 learned vectors in codebook 1. Only the index, ten bits, is kept.', more: '<p>Codebook update: in EnCodec the entries are exponential moving averages of the latents assigned to them, and dead entries (rarely chosen) are re-initialised from random batch latents, which keeps utilisation of the 1024 codes high.</p>' },
            deep: '<pre>r, q = z, 0        # r: residual, q: reconstruction\nfor i in range(N_q):\n    k[i] = argmin_j ||r - C_i[j]||\n    q += C_i[k[i]]\n    r -= C_i[k[i]] # residual shrinks\nreturn k           # N_q ints / frame</pre>' +
              '<p>Stage 1 gets the coarse shape: after it, most of the latent is explained but a substantial residual r = z − C₁[k₁] remains.</p>'
          },
          {
            say: 'The leftover error is quantized by a second codebook, then a third, each stage refining the one before.',
            card: { tag: 'KEY IDEA', title: 'Each stage refines the last', body: 'The residual after stage 1 is quantized by codebook 2, then 3, then 4. The error shrinks geometrically, like adding bits to a number.', more: '<p>Training: codebooks updated by EMA k-means, commitment loss β‖z − sg(q)‖², straight-through gradients; <i>quantizer dropout</i> (SoundStream) samples N_q at random per training example so one model serves many bitrates, and EnCodec trains over a list of target bandwidths. DAC improves codebook utilisation with low-dimensional factorised, L2-normalised code lookup.</p>' },
            deep: '<ul><li><b>Training</b>: codebooks updated by EMA k-means, commitment loss β‖z − sg(q)‖², straight-through gradients; <i>quantizer dropout</i> (SoundStream) samples N_q at random per training example so one model serves many bitrates.</li></ul>' +
              '<div class="eq">E‖z − q<sub>N</sub>‖² decreases roughly geometrically in N — coarse-to-fine, like a bit-plane code</div>' +
              '<p>Why residual, not one big codebook? N<sub>q</sub> stages of K = 1024 entries address K<sup>N<sub>q</sub></sup> = 2<sup>10·N<sub>q</sub></sup> distinct reconstructions (2<sup>80</sup> for N<sub>q</sub> = 8) while storing only N<sub>q</sub>·K = 8,192 vectors and searching N<sub>q</sub>·K distances per frame. A flat codebook of that capacity is impossible to store, train or search.</p>'
          },
          {
            say: 'What comes out is a small grid of integers per frame, which the decoder turns back into a waveform.',
            card: { tag: 'HOW IT WORKS', title: 'Integers in, waveform out', body: 'Per frame: N_q indices of ten bits each. The convolutional decoder inverts the whole chain, trained with adversarial and mel losses.' },
            deep: '<ul><li><b>Losses</b>: multi-scale mel L1 + adversarial (multi-scale STFT / multi-period discriminators) + feature matching.</li>' +
              '<li><b>DAC</b> improves codebook utilisation with low-dimensional factorised, L2-normalised code lookup.</li></ul>' +
              '<p>The token grid <code>[N_q × 75/s]</code> is exactly what a speech language model reads and writes: sample codes, decode with the frozen decoder, listen.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.p4, 400);
          ctx.remove(S.p5, 400);
          ctx.fade([S.segHl, S.segLab], 0, 300);
          var P = S.p6 = ctx.group();
          title(ctx, P, 90, 372, 'Neural audio codec (EnCodec-style, 24 kHz)');
          var ns = [
            ctx.node({ x: 250, y: 440, w: 320, h: 46, title: 'waveform 24 kHz', color: 'orange', titleSize: 13, glow: false, parent: P }),
            ctx.node({ x: 250, y: 525, w: 320, h: 54, title: 'Conv encoder', sub: 'strides 2·4·5·8 = 320 → 75 Hz, 128-d', color: 'orange', titleSize: 13, subSize: 11, glow: false, parent: P }),
            ctx.node({ x: 250, y: 615, w: 320, h: 54, title: 'Residual VQ', sub: 'N_q codebooks × 1024 entries', color: 'amber', titleSize: 13, subSize: 11, glow: false, parent: P }),
            ctx.node({ x: 250, y: 700, w: 320, h: 42, title: 'tokens [N_q × 75/s]', color: 'amber', titleSize: 13, glow: false, parent: P }),
            ctx.node({ x: 250, y: 785, w: 320, h: 54, title: 'Conv decoder', sub: 'transposed convs → waveform', color: 'orange', titleSize: 13, subSize: 11, glow: false, parent: P })
          ];
          var ls = [];
          for (var i = 0; i < 4; i++) ls.push(ctx.link(ns[i], ns[i + 1], { color: 'orange', straight: true, parent: P }));
          var speechLM = [note(ctx, P, 430, 700, 'what a speech LM', 'amber'), note(ctx, P, 430, 716, 'reads and writes', 'amber')];
          /* the question in beat 0 */
          var gapL = ctx.path('M250,463 L250,679', { stroke: ctx.alpha('white', 0.4), sw: 1.6, dash: '4 6', arrow: true, parent: P });
          var gapT = ctx.label(250, 570, 'continuous → discrete ?', { color: 'amber', size: 12, bg: '#101a30', parent: P });
          /* RVQ plane */
          var ox = 900, oy = 610, pw = 560, ph = 420;
          var plane = ctx.group({ parent: P });
          ctx.rect(ox - pw / 2 + 40, oy - ph / 2, pw, ph, { rx: 12, fill: 'rgba(8,12,26,0.85)', stroke: ctx.alpha('amber', 0.35), parent: plane });
          note(ctx, plane, ox - pw / 2 + 56, oy - ph / 2 + 22, 'latent space (2-D slice) · residual quantisation', 'text');
          var cx0 = ox - 170, cy0 = oy + 160;
          var z = { x: cx0 + 380, y: cy0 - 250 };
          /* codebook s: entries scattered around the current reconstruction at scale[s]; the chosen entry
             closes ~70% of the remaining error, so residual norms fall geometrically (55 → 20 → 7 → 2.5 px) */
          var rr = ctx.rng(77), scales = [380, 140, 50, 18], stages = [], cur = { x: cx0, y: cy0 };
          var colors = ['amber', 'orange', 'pink', 'violet'], sgn = [1, -1, 1, -1];
          for (var s = 0; s < 4; s++) {
            var ex = z.x - cur.x, ey = z.y - cur.y, el = Math.hypot(ex, ey);
            var pick = { x: cur.x + ex * 0.7 - sgn[s] * ey / el * el * 0.12, y: cur.y + ey * 0.7 + sgn[s] * ex / el * el * 0.12 };
            var pts = [pick];
            for (var k = 0; k < (s === 0 ? 14 : 10); k++) {
              var a = rr() * Math.PI * 2, rad = scales[s] * (0.35 + rr() * 0.65);
              var p0 = { x: cur.x + rad * Math.cos(a), y: cur.y + rad * Math.sin(a) };
              var inBox = p0.x > ox - pw / 2 + 50 && p0.x < ox + pw / 2 + 30 && p0.y > oy - ph / 2 + 36 && p0.y < oy + ph / 2 - 8;
              if (inBox && Math.hypot(p0.x - z.x, p0.y - z.y) > Math.hypot(pick.x - z.x, pick.y - z.y) * 1.25) pts.push(p0);
            }
            rr(); /* keeps the random stream (and so the geometry) unchanged */
            stages.push({ pts: pts, pick: pick, from: cur, idx: [835, 127, 365, 590][s], err: 0 });
            cur = pick;
          }
          stages.forEach(function (st) { st.err = Math.hypot(st.pick.x - z.x, st.pick.y - z.y); });
          var pnote = note(ctx, plane, ox + pw / 2 + 24, oy + ph / 2 - 16, 'dots: codebook entries · solid: chosen code · dashed: residual', 'dim', 'end');
          var zArrow = ctx.path('M' + cx0 + ',' + cy0 + ' L' + z.x + ',' + z.y, { stroke: 'white', sw: 2.2, arrow: true, parent: plane });
          var zDot = ctx.circle(cx0, cy0, 3, { fill: 'dim', parent: plane });
          var zLab = ctx.text(z.x + 10, z.y - 10, 'z', { size: 16, font: 'mono', weight: 700, color: 'white', parent: plane });
          var stG = stages.map(function (st, s2) {
            var g = ctx.group({ parent: plane });
            st.pts.forEach(function (p) { ctx.circle(p.x, p.y, [4, 3, 2.2, 1.5][s2], { fill: ctx.alpha(colors[s2], 0.6), parent: g }); });
            ctx.circle(st.pick.x, st.pick.y, [7, 5, 3.4, 2.2][s2], { stroke: colors[s2], sw: [2, 1.6, 1.2, 0.9][s2], parent: g });
            ctx.line(st.from.x, st.from.y, st.pick.x, st.pick.y, { color: colors[s2], sw: [2.4, 1.8, 1.2, 0.8][s2], arrow: s2 < 2, parent: g });
            ctx.line(st.pick.x, st.pick.y, z.x, z.y, { color: ctx.alpha(colors[s2], 0.8), sw: [1.2, 1, 0.7, 0.5][s2], dash: s2 < 2 ? '3 3' : '1.5 1.5', parent: g });
            return g;
          });
          /* residual bars + indices */
          var bx = ox - pw / 2 + 60, by = oy - ph / 2 + 62;
          var barsT = note(ctx, plane, bx, by - 12, '‖residual‖ after stage', 'dim');
          var bars = stages.map(function (st, s3) {
            var bg = ctx.group({ parent: plane });
            ctx.text(bx, by + 12 + s3 * 24, 'q' + (s3 + 1), { size: 12, font: 'mono', color: colors[s3], parent: bg });
            var b = ctx.rect(bx + 28, by + 4 + s3 * 24, Math.max(3, st.err * 0.6), 14, { rx: 3, fill: ctx.alpha(colors[s3], 0.7), parent: bg });
            ctx.text(bx + 36 + Math.max(3, st.err * 0.6), by + 12 + s3 * 24, 'k=' + st.idx, { size: 11, font: 'mono', color: colors[s3], parent: bg });
            return { g: bg, b: b };
          });
          hide(ns.concat(ls, speechLM, [plane, gapL, gapT]));
          hide(stG); hide(bars.map(function (b) { return b.g; })); hide([zArrow, barsT]);
          /* the integers that leave the quantizer for one frame (beat 4) */
          var frameG = ctx.group({ parent: P });
          ctx.text(1300, 462, 'one 13.3 ms frame → 4 integers', { size: 12, font: 'mono', color: 'text', parent: frameG });
          stages.forEach(function (st, s4) {
            ctx.rect(1300, 484 + s4 * 40, 230, 32, { rx: 7, fill: ctx.alpha(colors[s4], 0.14), stroke: colors[s4], sw: 1.2, parent: frameG });
            ctx.text(1316, 500 + s4 * 40, 'q' + (s4 + 1) + '  →  ' + st.idx, { size: 14, font: 'code', pre: true, color: colors[s4], parent: frameG });
            ctx.text(1514, 500 + s4 * 40, '10 bit', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: frameG });
          });
          ctx.text(1300, 664, '4 × 10 bit = 40 bit per frame', { size: 12, font: 'mono', color: 'amber', parent: frameG });
          ctx.text(1300, 686, '× 75 frames/s = 3 kbps', { size: 12, font: 'mono', color: 'amber', parent: frameG });
          hide([frameG]);

          /* beat 0: from continuous audio to a few integers per frame */
          ctx.reveal(P, { dur: 300 });
          ctx.reveal([ns[0], ns[3]], { from: 'left', stagger: 200 });
          ctx.reveal(speechLM, { delay: 700, stagger: 100 });
          ctx.reveal(gapL, { from: 'draw', delay: 500 });
          ctx.reveal(gapT, { delay: 1100 });
          return ctx.wait(1500).then(function () { return ctx.pulse(gapT, { color: 'amber', dur: 700 }); }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: strided convolutional encoder to 75 latents per second */
            ctx.remove(gapL, 300); ctx.remove(gapT, 300);
            ctx.reveal(ns[1], { from: 'left' });
            ctx.reveal(ls[0], { from: 'draw', delay: 300 });
            return ctx.wait(700).then(function () { return ctx.packet(ls[0], { color: 'orange', dur: 500 }); }).then(function () {
              return ctx.pulse(ns[1], { color: 'orange', dur: 700 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: residual VQ, stage 1 picks the nearest centroid */
            ctx.reveal(ns[2], { from: 'left' });
            ctx.reveal([ls[1], ls[2]], { from: 'draw', stagger: 200, delay: 300 });
            ctx.reveal(plane, { dur: 400, delay: 400 });
            ctx.reveal(zArrow, { from: 'draw', delay: 900 });
            ctx.hud('75 Hz × N_q codes · each stage refines the last');
            return ctx.wait(1500).then(function () {
              ctx.reveal(bars[0].g, { from: 'left', dur: 400 });
              return ctx.reveal(stG[0], { from: 'fade', dur: 600 });
            }).then(function () { return ctx.reveal(barsT, {}); }).then(function () { return ctx.wait(400); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: stages 2..4 refine the residual */
            return [1, 2, 3].reduce(function (p, i2) {
              return p.then(function () {
                ctx.reveal(bars[i2].g, { from: 'left', dur: 400 });
                return ctx.reveal(stG[i2], { from: 'fade', dur: 600 });
              }).then(function () { return ctx.wait(350); });
            }, Promise.resolve()).then(function () {
              return ctx.camera(z.x - 25, z.y + 20, 2.8, 1000).then(function () { return ctx.wait(1300); }).then(function () { return ctx.camera(null, null, null, 900); });
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: tokens to waveform through the decoder */
            ctx.reveal(frameG, { from: 'left', dur: 600 });
            ctx.reveal(ns[4], { from: 'left' });
            ctx.reveal(ls[3], { from: 'draw', delay: 300 });
            return ctx.wait(700).then(function () { return ctx.packet(ls[3], { color: 'amber', dur: 500 }); }).then(function () {
              return sweep(ctx, [ns[3], ns[4]], { color: 'amber', dur: 600 });
            });
          });
        }
      },

      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Bitrate arithmetic',
        beats: [
          {
            say: 'The bitrate is simple arithmetic: frames per second, times the number of codebooks, times the bits per code.',
            card: { tag: 'KEY IDEA', title: 'Bitrate is a product', body: 'frames per second × codebooks × log2 of the codebook size. Every factor is a design lever, and each row here is one codebook.' },
            deep: '<div class="eq">bitrate = f<sub>frame</sub> × N<sub>q</sub> × log<sub>2</sub>K</div>' +
              '<p>The grid shows one 0.48 s snippet of codec tokens: 8 rows (codebooks) by 36 columns (frames of 13.3 ms). Every cell is one integer in [0, 1023].</p>' +
              '<p>Rows are ordered coarse to fine: row q1 carries most of the signal, later rows carry progressively smaller residual corrections. That ordering is what makes the bitrate scalable by simply dropping the last rows.</p>'
          },
          {
            say: 'EnCodec at seventy five frames per second, with eight codebooks of one thousand and twenty four entries, gives six kilobits per second.',
            card: { tag: 'NUMBERS', title: 'EnCodec at 8 codebooks', stat: { v: '6.0 kbps', l: '75 Hz × 8 codebooks × 10 bits; 1.5 kbps at 2 codebooks up to 24 kbps at 32' } },
            deep: '<p>Watch the sweep: with only the first codebook, the reconstruction is intelligible but rough; each added codebook adds detail at a cost of 0.75 kbps (75 × 10 bits). The memo would take <b>25,200</b> tokens at 8 codebooks.</p>' +
              '<div class="eq">75 × 8 × 10 bit = 6,000 bit/s → 42 s = 31.5 kB</div>' +
              '<p>Bars: an illustrative reconstruction-quality curve versus N<sub>q</sub>; real measurements show similarly diminishing returns.</p>'
          },
          {
            say: 'Moshi\'s Mimi codec runs at only twelve and a half frames per second with eight codebooks of two thousand and forty eight entries: just one point one kilobits.',
            card: { tag: 'NUMBERS', title: 'Mimi: 12.5 Hz', stat: { v: '1.1 kbps', l: '12.5 Hz × 8 codebooks × 11 bits; a minute of speech is only 750 frames' } },
            deep: '<table><tr><th>codec</th><th>f</th><th>N<sub>q</sub> × K</th><th>bitrate</th><th>memo tokens</th></tr>' +
              '<tr><td>EnCodec 24 kHz</td><td>75 Hz</td><td>8 × 1024</td><td>6.0 kbps</td><td>25,200</td></tr>' +
              '<tr><td>DAC 44.1 kHz</td><td>86 Hz</td><td>9 × 1024</td><td>7.75 kbps</td><td>≈ 32,500</td></tr>' +
              '<tr><td>Mimi (Moshi)</td><td>12.5 Hz</td><td>8 × 2048</td><td>1.1 kbps</td><td>4,200</td></tr></table>' +
              '<p><span class="muted">The DAC paper rounds its 9-codebook setting to 8 kbps; the exact product is 7.75 kbps.</span></p>' +
              '<p>Modelling N<sub>q</sub> parallel streams with an LM: <b>flatten</b> (N<sub>q</sub>·T tokens, expensive), <b>delay pattern</b> (MusicGen: codebook i shifted by i steps, one step predicts all), <b>AR + NAR</b> (VALL-E: autoregress codebook 1, fill 2..8 in parallel), <b>RQ/depth transformer</b> (Moshi: a big temporal transformer per frame, a small depth transformer across the 8 codebooks).</p>' +
              '<div class="note">Low frame rate is the big lever for LLM-style generation: Mimi\'s 12.5 Hz makes a minute of speech 750 frames, cheaper than the text of many prompts.</div>'
          },
          {
            say: 'Now try it yourself: click the codebook buttons to trade bitrate against fidelity, and watch the token count for our memo change.',
            card: { tag: 'TRY IT', title: 'Trade bitrate for fidelity', body: 'Click N_q = 1, 2, 4 or 8. The grid dims, the bitrate and memo size update, and the quality bars show the price of each codebook removed.' },
            deep: '<p>Each codebook removed saves 75 × 10 = 750 bit/s and 3,150 tokens for the 42 s memo, but throws away the finest layer of detail: breath, room tone, timbre nuance. For narration in the creator\'s own voice, 6 kbps is a common operating point; for a chat assistant, Mimi\'s 1.1 kbps trades some fidelity for latency.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.p6, 400);
          var P = S.p7 = ctx.group();
          title(ctx, P, 90, 372, 'Codec tokens: N_q rows × time (EnCodec, 75 frames/s)');
          var r = ctx.rng(21), T = 36, grid = ctx.matrix(90, 400, 8, T, { cell: 16, gap: 3, values: function () { return ctx.cmap('heat', 0.15 + 0.85 * r()); }, parent: P });
          var rl = [];
          for (var q = 0; q < 8; q++) rl.push(note(ctx, P, 80, 408 + q * 19, 'q' + (q + 1), 'dim', 'end'));
          var gn = note(ctx, P, 90, 568, '← 0.48 s →   each column = one 13.3 ms frame', 'dim');
          S.brText = ctx.text(90, 614, 'bitrate = frames/s × N_q × log₂K', { size: 22, font: 'mono', weight: 700, color: 'amber', parent: P });
          S.brSub = ctx.text(90, 644, '', { size: 13, font: 'mono', color: 'text', parent: P });
          S.qual = ctx.bars(840, 420, 300, 150, [0, 0, 0, 0], { color: ['#5b3a1f', '#9c5a26', '#d9772e', '#ff8a3d'], labels: ['1', '2', '4', '8'], gap: 16, parent: P });
          var qn = note(ctx, P, 840, 404, 'reconstruction quality (illustrative) vs N_q', 'dim');
          var chips = [1, 2, 4, 8].map(function (n, i) {
            var g = ctx.group({ parent: P });
            var rc = ctx.rect(1200 + (i % 2) * 150, 420 + Math.floor(i / 2) * 60, 136, 44, { rx: 22, fill: ctx.alpha('amber', 0.1), stroke: 'amber', sw: 1.4, parent: g });
            ctx.text(1268 + (i % 2) * 150, 442 + Math.floor(i / 2) * 60, 'N_q = ' + n, { size: 15, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
            g.style.cursor = 'pointer';
            g.addEventListener('click', function () { S.setNq(n); });
            return { g: g, rc: rc, n: n };
          });
          var cn = note(ctx, P, 1200, 404, 'click to change N_q', 'amber');
          S.setNq = function (n) {
            for (var q2 = 0; q2 < 8; q2++) for (var c = 0; c < T; c++) grid.cells[q2][c].setAttribute('opacity', q2 < n ? 1 : 0.12);
            chips.forEach(function (ch) { ch.rc.setAttribute('fill', ch.n === n ? ctx.alpha('amber', 0.45) : ctx.alpha('amber', 0.08)); });
            var kbps = 75 * n * 10 / 1000;
            S.brText.textContent = '75 × ' + n + ' × log₂1024 = ' + kbps.toFixed(2) + ' kbps';
            S.brSub.textContent = 'memo (42 s) = ' + (75 * 42 * n).toLocaleString('en-US') + ' tokens · ' + (kbps * 42 / 8).toFixed(1) + ' kB';
            var qv = [1, 2, 4, 8].map(function (m) { return m <= n ? 0.25 + 0.75 * (1 - Math.exp(-m / 2.6)) : 0.04; });
            return S.qual.update(qv, 350);
          };
          var cd = ctx.code({ x: 90, y: 676, w: 1440, title: 'bitrate = frames/s × N_q × log2(K)', lang: 'text', size: 13, color: 'amber', typing: true, maxLines: 3, lines: [
            'EnCodec 24 kHz   75 Hz × 8 × 10 bit = 6.0 kbps    memo: 25,200 tokens   (1.5 / 3 / 6 / 12 / 24 kbps with 2…32 codebooks)',
            'DAC 44.1 kHz     86 Hz × 9 × 10 bit = 7.75 kbps   memo: ≈ 32,500 tokens (universal audio, factorised codes)',
            'Mimi (Moshi)   12.5 Hz × 8 × 11 bit = 1.1 kbps    memo:  4,200 tokens   (streaming, 1st codebook = semantic)'
          ], parent: P });
          hide(chips.map(function (c) { return c.g; })); hide([cn, qn, cd, S.qual, S.brSub]);
          hide([P]);

          /* beat 0: a grid of integers, one row per codebook */
          ctx.reveal(P, { dur: 400 });
          return ctx.wait(600).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: sweep N_q on EnCodec: bitrate and quality */
            ctx.reveal([S.qual, qn, S.brSub], { from: 'up', stagger: 100 });
            return S.setNq(1).then(function () { return ctx.wait(900); }).then(function () { return S.setNq(2); })
              .then(function () { return ctx.wait(700); }).then(function () { return S.setNq(4); })
              .then(function () { return ctx.wait(700); }).then(function () { return S.setNq(8); })
              .then(function () { return ctx.wait(700); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: EnCodec vs DAC vs Mimi */
            ctx.reveal(cd, { from: 'up' });
            return cd.typeAll().then(function () { return ctx.pulse(cd, { color: 'amber', dur: 700 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: hand the codebook buttons to the viewer */
            ctx.reveal(chips.map(function (c) { return c.g; }).concat([cn]), { from: 'up', stagger: 100 });
            return ctx.wait(700).then(function () { return ctx.pulse(chips[3].g, { color: 'amber', times: 2, dur: 600 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Semantic vs acoustic',
        beats: [
          {
            say: 'There are two kinds of discrete audio tokens. Semantic tokens come from self supervised speech models such as HuBERT or w two v BERT: take intermediate features, cluster them with k-means, and each token roughly marks a phonetic unit, whoever is speaking.',
            card: { tag: 'HOW IT WORKS', title: 'Semantic tokens: what was said', body: 'K-means cluster ids of HuBERT features at 50 Hz. Roughly one id per phone, nearly the same for any speaker.' },
            deep: '<p><b>Semantic tokens</b>: HuBERT is trained to predict k-means cluster ids of masked frames (iteratively re-clustered). Discretise mid-depth features at 50 Hz (here HuBERT layer 9 with K = 500, a setting in the range HuBERT and SpeechTokenizer use); deduplicate repeats for LM training. CosyVoice 2\'s supervised tokenizer instead inserts FSQ into the encoder of the SenseVoice-Large ASR model at 25 Hz: more text-aligned.</p>' +
              '<p>Low entropy: the same phone gives the same id regardless of who says it, so a language model can predict them like text.</p>'
          },
          {
            say: 'Acoustic tokens from codecs capture everything needed to rebuild the waveform: timbre, breath, room, microphone.',
            card: { tag: 'HOW IT WORKS', title: 'Acoustic tokens: how it sounded', body: 'RVQ ids from a codec. High entropy, because timbre, breath, room and microphone all have to be reconstructed.' },
            deep: '<p><b>Acoustic tokens</b>: RVQ codec ids; high entropy, needed for fidelity.</p>' +
              '<table><tr><th></th><th>semantic</th><th>acoustic</th></tr>' +
              '<tr><td>phonetic content</td><td>✓</td><td>✓ (entangled)</td></tr>' +
              '<tr><td>speaker timbre</td><td>mostly removed</td><td>✓</td></tr>' +
              '<tr><td>prosody</td><td>partial</td><td>✓</td></tr>' +
              '<tr><td>room / mic / noise</td><td>✗</td><td>✓</td></tr>' +
              '<tr><td>easy to model with an LM</td><td>✓ (low entropy)</td><td>harder</td></tr></table>'
          },
          {
            say: 'Modern speech generators predict semantic tokens first, which is cheap and text like, and add acoustic detail second, once the content is fixed.',
            card: { tag: 'STATE OF THE ART', title: 'Semantic first, acoustic second', body: 'AudioLM: semantic, then coarse acoustic, then fine acoustic. CosyVoice 2: an LLM predicts semantic tokens, a flow-matching decoder adds the rest.' },
            deep: '<p><b>Hierarchies</b>: AudioLM (semantic → coarse acoustic → fine acoustic). CosyVoice 2 = LLM → semantic tokens → chunk-aware flow-matching decoder to mel → vocoder. Seed-TTS has an autoregressive main model and a fully diffusion-based variant (Seed-TTS_DiT).</p>' +
              '<p>Splitting the job this way lets the language model spend its capacity on <i>content and prosody</i> (low entropy, long range) and hands timbre and acoustic detail to a decoder conditioned on the speaker embedding of the last step.</p>'
          },
          {
            say: 'And codecs like Mimi distill semantics into their first codebook, so one stream carries both.',
            card: { tag: 'STATE OF THE ART', title: 'Split RVQ: Mimi codebook 1', body: 'SpeechTokenizer and Mimi train codebook 1 to match a WavLM or HuBERT teacher. Codebook 1 is semantic, the rest acoustic.' },
            deep: '<p><b>Hierarchies</b>: SpeechTokenizer distils a HuBERT teacher into the first RVQ codebook, and Mimi distils WavLM into its own first quantizer, so one stream carries both. A speech-text model like Moshi can then read codebook 1 as a semantic stream and the remaining seven as acoustic refinement, at 12.5 Hz.</p>' +
              '<p>Mimi in numbers: 24 kHz input, a causal SEANet encoder plus a Transformer bottleneck, 1,920× downsampling to 12.5 Hz (80 ms per frame), 8 codebooks of 2,048 entries, 1.1 kbps. Its "split RVQ" quantizes semantic and acoustic parts in parallel and sums them, instead of making the acoustic stages a residual of the semantic one, which is what keeps codebook 1 clean for the language model.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.p7, 400);
          var P = S.p8 = ctx.group();
          title(ctx, P, 90, 372, '"the ice began to sing" · two tokenisations of the same 0.86 s (43 frames @ 50 Hz)');
          var ph = [['DH', 2], ['AH', 2], ['AY', 5], ['S', 4], ['B', 2], ['IH', 3], ['G', 2], ['AE', 4], ['N', 3], ['T', 2], ['UW', 3], ['S', 4], ['IH', 3], ['NG', 4]];
          var ids = { DH: 71, AH: 12, AY: 305, S: 88, B: 240, IH: 17, G: 199, AE: 402, N: 33, T: 150, UW: 276, NG: 461 };
          var x = 300, cw = 22, y1 = 460;
          var hub = ctx.node({ x: 190, y: 480, w: 180, h: 62, title: 'HuBERT L9', sub: 'k-means K=500', color: 'violet', titleSize: 13, subSize: 11, glow: false, parent: P });
          var cod = ctx.node({ x: 190, y: 660, w: 180, h: 62, title: 'Codec (RVQ)', sub: '4 of 8 codebooks', color: 'orange', titleSize: 13, subSize: 11, glow: false, parent: P });
          var semCells = [], phLab = [];
          ph.forEach(function (p) {
            var w = p[1] * cw;
            phLab.push(ctx.text(x + w / 2, y1 - 26, p[0], { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: P }));
            for (var k = 0; k < p[1]; k++) {
              var id = ids[p[0]] + (k === p[1] - 1 && p[1] > 3 ? 1 : 0);
              var c = ctx.rect(x + k * cw, y1, cw - 2, 40, { rx: 3, fill: ctx.alpha('violet', 0.25 + (id % 7) / 10), stroke: ctx.alpha('violet', 0.6), sw: 0.8, parent: P });
              semCells.push(c);
            }
            phLab.push(ctx.line(x - 1, y1 - 16, x - 1, y1 + 46, { color: ctx.alpha('white', 0.15), sw: 1, parent: P }));
            x += w;
          });
          var sn = note(ctx, P, 300, y1 + 64, 'semantic ids @ 50 Hz: ≈ one cluster per phone; same ids for any speaker → dedup → "71 12 305 88 240 …"', 'violet');
          var r = ctx.rng(8), acu = ctx.matrix(300, 610, 4, 43, { cell: 20, gap: 2, values: function () { return ctx.cmap('heat', 0.2 + 0.8 * r()); }, parent: P });
          var an = note(ctx, P, 300, 718, 'acoustic ids (RVQ codec @ 50 Hz, 4 × 43): high entropy — timbre, breath, room, mic', 'orange');
          var tts = ctx.para(300, 780, ['TTS stack (CosyVoice 2 style):', 'LLM → semantic tokens → flow-matching → mel → vocoder'], { size: 13, font: 'mono', color: 'text', lh: 21, parent: P });
          var mim = ctx.para(1100, 780, ['SpeechTokenizer (HuBERT teacher) and', 'Mimi (WavLM teacher): codebook 1 is', 'distilled → semantic; rest → acoustic'], { size: 13, font: 'mono', color: 'amber', lh: 21, parent: P });
          var cb1 = ctx.rect(296, 606, 43 * 22 + 4, 28, { rx: 5, stroke: 'amber', sw: 2, dash: '6 4', parent: P });
          var cb1t = ctx.text(1256, 596, 'codebook 1 ← semantic teacher', { size: 12, font: 'mono', color: 'amber', anchor: 'end', parent: P });
          hide([hub, cod, sn, acu, an, tts, mim, cb1, cb1t]); hide(semCells); hide(phLab);
          hide([P]);

          /* beat 0: semantic tokens from HuBERT */
          ctx.reveal(P, { dur: 300 });
          ctx.reveal([hub], { from: 'left' });
          ctx.reveal(phLab, { stagger: 30, delay: 300 });
          return ctx.reveal(semCells, { from: 'scale', stagger: 25, delay: 500 }).then(function () {
            ctx.reveal(sn, { from: 'up' });
            return ctx.wait(500);
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: acoustic tokens from the codec */
            ctx.reveal([cod], { from: 'left' });
            ctx.reveal(acu, { from: 'left', dur: 900, delay: 300 });
            return ctx.wait(1200).then(function () { return ctx.reveal(an, { from: 'up' }); }).then(function () { return ctx.wait(400); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: semantic first, acoustic second */
            var st1 = ctx.label(1420, 482, 'step 1 · LLM → semantic ids', { color: 'violet', size: 11, bg: '#0d1a33', parent: P });
            var st2 = ctx.label(1420, 656, 'step 2 · decoder → acoustics', { color: 'orange', size: 11, bg: '#0d1a33', parent: P });
            var stAr = ctx.path('M1420,498 V640', { stroke: 'amber', sw: 1.6, dash: '4 4', arrow: true, parent: P });
            hide([st1, st2, stAr]);
            ctx.reveal(st1, { from: 'left' });
            ctx.reveal(stAr, { from: 'draw', delay: 300 });
            ctx.reveal(st2, { from: 'left', delay: 700 });
            return ctx.reveal(tts, { from: 'up' }).then(function () { return sweep(ctx, [hub, cod], { color: 'amber', dur: 600 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: Mimi distils semantics into codebook 1 */
            ctx.reveal(mim, { from: 'up' });
            return ctx.reveal([cb1, cb1t], { from: 'fade', delay: 300 }).then(function () { return ctx.pulse(cb1, { color: 'amber', times: 2, dur: 600 }); });
          });
        }
      },

      /* ------------------------------------------------------------------ 9 */
      {
        title: 'Speaker embedding',
        beats: [
          {
            say: 'Finally, the voice identity. A speaker verification network such as ECAPA TDNN reads eighty dimensional spectral frames through dilated convolutions with squeeze and excitation.',
            card: { tag: 'HOW IT WORKS', title: 'ECAPA-TDNN front end', body: 'Eighty-dimensional spectral frames (MFCCs in the paper) go through dilated Res2 convolutions with squeeze-and-excitation, at any clip length.' },
            deep: '<p><b>ECAPA-TDNN</b>: 80-d MFCC / fbank → Conv1D(k5) → 3 SE-Res2Blocks (dilations 2, 3, 4; C = 1024) → multi-layer feature aggregation → attentive statistics pooling → FC → <b>192-d</b>.</p>' +
              '<p>Dilations 2, 3, 4 widen the temporal receptive field without more parameters; the Res2 split processes channel groups hierarchically for multi-scale features; squeeze-and-excitation re-weights channels using global clip statistics.</p>'
          },
          {
            say: 'Attentive statistics pooling collapses any length of speech into one weighted mean and standard deviation, and a linear layer produces a one hundred ninety two dimensional embedding.',
            card: { tag: 'NUMBERS', title: 'One vector per voice', stat: { v: '192', u: 'dims', l: 'ECAPA-TDNN embedding for any length of speech, trained with AAM-softmax on 5,994 speakers' }, more: '<p>AAM-softmax adds an additive angular margin m to the target-class angle: logit = s·cos(θ<sub>y</sub> + m), with s = 30 and m = 0.2. It forces embeddings of one speaker into a tight angular cone, exactly the geometry that cosine scoring relies on later.</p>' },
            deep: '<div class="eq">α<sub>t</sub> = softmax<sub>t</sub>(vᵀ tanh(W h<sub>t</sub> + b)), &nbsp; μ = Σ α<sub>t</sub> h<sub>t</sub>, &nbsp; σ = √(Σ α<sub>t</sub> h<sub>t</sub>⊙h<sub>t</sub> − μ⊙μ)</div>' +
              '<p>Trained with AAM-softmax (m = 0.2, s = 30) on VoxCeleb2 (5,994 speakers); 0.87% EER on VoxCeleb1-O for the C = 1024 model. Attention weights let the pooling focus on frames rich in speaker information, and ignore silence.</p>'
          },
          {
            say: 'Clips of the same person land close together in cosine distance, while other speakers stay far away.',
            card: { tag: 'NUMBERS', title: 'Same voice, high cosine', stat: { v: '0.81', l: 'mean cosine between three segments of the memo; other speakers score 0.25 or less' } },
            deep: '<div class="eq">score(a, b) = cos(e<sub>a</sub>, e<sub>b</sub>) = e<sub>a</sub>·e<sub>b</sub> / (‖e<sub>a</sub>‖‖e<sub>b</sub>‖)</div>' +
              '<p>Split the memo into three 14 s segments. In this worked example (illustrative values, typical of a clean phone recording) their pairwise cosines are 0.83, 0.79 and 0.81, a tight cluster, while embeddings of other speakers stay at cosine ≤ 0.25. That margin lets the system verify "same speaker" with a single threshold; on VoxCeleb-style benchmarks such a threshold is tuned for a target equal-error rate of about 1%.</p>'
          },
          {
            say: 'After a consent check, this embedding and a clean reference clip condition the voice that will narrate the trailer.',
            card: { tag: 'PITFALL', title: 'A voice is biometric data', body: 'Cloning is only enabled for the account owner\'s verified voice, and every generated line is watermarked.' },
            deep: '<ul><li><b>Cloning</b>: zero-shot TTS conditions on the embedding (CosyVoice uses an x-vector) and/or on the reference audio in-context (F5-TTS, Seed-TTS).</li>' +
              '<li><b>Evaluation</b>: the critic scores the synthesised narration with speaker similarity (cosine of WavLM-large-based speaker-verification embeddings, "SIM-o"); F5-TTS reports 0.66 on LibriSpeech-PC (Voicebox 0.64, E2 TTS 0.69, real speech 0.69).</li>' +
              '<li><b>Safety</b>: cloning only the account owner\'s verified voice, plus audio watermarking (e.g. AudioSeal) on every generated line.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.p8, 400);
          var P = S.p9 = ctx.group();
          title(ctx, P, 90, 372, 'ECAPA-TDNN speaker embedding');
          var blocks = [['80-d MFCC / fbank frames', 'T × 80 · any length', 'orange'], ['Conv1D + 3 SE-Res2Blocks', 'dilation 2, 3, 4 · C 1024', 'orange'], ['multi-layer aggregation', 'concat block outputs', 'orange'], ['attentive stats pooling', 'weighted μ, σ over time', 'amber'], ['FC → 192-d embedding', 'AAM-softmax in training', 'amber']];
          var ns = blocks.map(function (b, i) { return ctx.node({ x: 290, y: 430 + i * 88, w: 390, h: 58, title: b[0], sub: b[1], color: b[2], titleSize: 14, subSize: 11, glow: false, parent: P }); });
          var ls = [];
          for (var i = 0; i < 4; i++) ls.push(ctx.link(ns[i], ns[i + 1], { color: 'orange', straight: true, parent: P }));
          /* embedding scatter */
          var sx = 540 + 280, sy = 400, sw = 420, sh = 400;
          var sc = ctx.group({ parent: P });
          ctx.rect(sx, sy, sw, sh, { rx: 12, fill: 'rgba(8,12,26,0.85)', stroke: ctx.alpha('orange', 0.3), parent: sc });
          note(ctx, sc, sx + 14, sy + 22, 'embedding space (2-D, illustrative)', 'text');
          var r = ctx.rng(64), others = [[sx + 90, sy + 110, 'blue'], [sx + 320, sy + 120, 'cyan'], [sx + 100, sy + 300, 'lime'], [sx + 250, sy + 330, 'violet']];
          var dots = [];
          others.forEach(function (o) {
            for (var k = 0; k < 7; k++) dots.push(ctx.circle(o[0] + (r() - 0.5) * 60, o[1] + (r() - 0.5) * 50, 4, { fill: ctx.alpha(o[2], 0.6), parent: sc }));
          });
          var me = { x: sx + 300, y: sy + 230 }, mem = [];
          for (var m = 0; m < 3; m++) mem.push(ctx.circle(me.x + (r() - 0.5) * 30, me.y + (r() - 0.5) * 26, 6, { fill: 'amber', stroke: 'white', sw: 1, parent: sc, glow: true }));
          var sn = [note(ctx, sc, me.x - 20, me.y - 30, 'memo 0–14 s, 14–28 s, 28–42 s', 'amber', 'end'), note(ctx, sc, me.x - 20, me.y - 14, 'pairwise cos = 0.83, 0.79, 0.81', 'amber', 'end'), note(ctx, sc, sx + 14, sy + sh - 16, 'other speakers: cos to memo ≤ 0.25', 'dim')];
          /* voice profile */
          var prof = ctx.code({ x: 1270, y: 400, w: 270, title: 'voice_profile.json', lang: 'json', size: 12, color: 'amber', typing: true, maxLines: 9, parent: P });
          var pl = [
            '{ "speaker_emb": "ecapa192",',
            '  "dim": 192,',
            '  "self_sim": 0.81,',
            '  "f0_median_hz": 118,',
            '  "f0_range_hz": [92, 171],',
            '  "rate_wpm": 142,',
            '  "ref_clip": "12.0-19.5 s",',
            '  "snr_db": 31,',
            '  "consent": "verified" }'
          ].map(function (s) { return s.replace(/ {2,}/g, function (m2) { return new Array(m2.length + 1).join(' '); }); });
          hide(ns.concat(ls)); hide([sc, prof]); hide(dots); hide(mem); hide(sn);
          hide([P]);

          /* beat 0: filterbank frames through dilated SE-Res2 blocks */
          ctx.reveal(P, { dur: 300 });
          ctx.reveal(ns.slice(0, 3), { from: 'left', stagger: 200 });
          ctx.reveal(ls.slice(0, 2), { from: 'draw', stagger: 200, delay: 400 });
          return ctx.wait(1200).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: pooling and the 192-d embedding */
            ctx.reveal(ns.slice(3), { from: 'left', stagger: 200 });
            ctx.reveal(ls.slice(2), { from: 'draw', stagger: 200, delay: 400 });
            ctx.hud('memo → 192-d speaker embedding');
            return ctx.wait(1000).then(function () {
              return ls.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'amber', dur: 300 }); }); }, Promise.resolve());
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: same-speaker clips cluster in embedding space */
            ctx.reveal(sc, { dur: 400 });
            ctx.reveal(sn, { delay: 900 });
            return ctx.reveal(dots, { from: 'scale', stagger: 20, delay: 300 }).then(function () {
              return ctx.reveal(mem, { from: 'scale', stagger: 200, delay: 100 });
            }).then(function () { return ctx.pulse(mem[0], { color: 'amber', times: 2, dur: 500 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the voice profile that conditions the narration */
            ctx.reveal(prof, { from: 'left' });
            return pl.reduce(function (p, l) { return p.then(function () { return prof.addLine(l); }); }, Promise.resolve()).then(function () {
              return ctx.pulse(prof, { color: 'amber', dur: 700 });
            });
          });
        }
      }
    ]
  });
})();
