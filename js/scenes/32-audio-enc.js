/* L2 — Audio & Speech Encoding. The creator's voice memo: waveform -> log-mel -> Whisper frames -> tokens; codecs, RVQ, semantic tokens, speaker embedding. */
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
  function nb(s) { return s.replace(/ {2,}/g, function (m) { return new Array(m.length + 1).join(' '); }); }
  function title(ctx, parent, x, y, s, col) {
    return ctx.text(x, y, s, { size: 18, font: 'display', weight: 700, color: col || 'white', parent: parent });
  }
  function note(ctx, parent, x, y, s, col, anchor) {
    return ctx.text(x, y, s, { size: 12, font: 'mono', color: col || 'dim', anchor: anchor || 'start', parent: parent });
  }

  Atlas.register({
    id: 'audio-encoder',
    refs: [
      'Radford et al., <i>Robust Speech Recognition via Large-Scale Weak Supervision (Whisper)</i>, ICML 2023',
      'Zeghidour et al., <i>SoundStream: An End-to-End Neural Audio Codec</i>, IEEE/ACM TASLP 2022',
      'Défossez et al., <i>High Fidelity Neural Audio Compression (EnCodec)</i>, TMLR 2023; Kumar et al., <i>Improved RVQGAN (DAC)</i>, NeurIPS 2023',
      'Hsu et al., <i>HuBERT: Self-Supervised Speech Representation Learning by Masked Prediction of Hidden Units</i>, TASLP 2021',
      'Borsos et al., <i>AudioLM: a Language Modeling Approach to Audio Generation</i>, TASLP 2023',
      'Défossez et al., <i>Moshi: a speech-text foundation model for real-time dialogue</i> (Mimi codec), 2024',
      'Desplanques et al., <i>ECAPA-TDNN: Emphasized Channel Attention, Propagation and Aggregation in TDNN Based Speaker Verification</i>, Interspeech 2020',
      'Chu et al., <i>Qwen2-Audio Technical Report</i>, 2024; Du et al., <i>CosyVoice 2</i>, 2024'
    ],
    setup: function (ctx) {
      var S = ctx.state;
      S.syl = syllables(ctx);
    },
    steps: [
      {
        title: 'The voice memo',
        say: 'Now the voice memo: forty two seconds of the creator speaking into a phone, compressed as AAC at forty eight kilohertz in stereo. The first job is unglamorous but essential. Decode it, average the two channels to mono, low pass filter below eight kilohertz so nothing aliases, then keep every third sample. The result is six hundred and seventy two thousand floating point samples at sixteen kilohertz, the standard input rate for speech models.',
        deep: '<ul><li><b>Decode</b>: AAC-LC → PCM float32 in [−1, 1] (ffmpeg / libfdk). Phones often record variable-rate AAC; timestamps, not sample counts, are the truth.</li>' +
          '<li><b>Downmix</b>: <code>x = (L + R)/2</code>; check for phase-inverted channels (cancellation) first.</li>' +
          '<li><b>Resample 48k → 16k</b>: polyphase FIR (Kaiser-windowed sinc) with cutoff ≈ 0.9 × 8 kHz, decimate by 3. Without the low-pass, energy above 8 kHz (sibilants) folds back as aliasing.</li>' +
          '<li><b>Normalise</b>: loudness to ≈ −23 LUFS (EBU R128) or peak-normalise; trim silence with a VAD (e.g. Silero).</li></ul>' +
          '<div class="eq">42 s × 16,000 = 672,000 samples (2.7 MB float32) vs 4,032,000 at 48 kHz stereo</div>' +
          '<p>Why 16 kHz? Speech intelligibility lives below ~8 kHz (Nyquist of 16 kHz), and nearly all ASR/speech encoders (Whisper, HuBERT, w2v-BERT, ECAPA) are trained at 16 kHz. Music and high-fidelity codecs use 24, 44.1 or 48 kHz.</p>',
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
          ctx.reveal(S.top, { dur: 400 });
          ctx.reveal(S.wave, { from: 'draw', dur: 1400 });
          /* lower: conversion pipeline + 4 ms sample inset */
          var P = S.p1 = ctx.group();
          var chips = ['AAC decode', 'downmix L+R', 'low-pass 7.2 kHz', 'keep every 3rd', '16 kHz mono f32'];
          var cx = [180, 400, 620, 840, 1060];
          var nodes = chips.map(function (c, i) { return ctx.node({ x: cx[i], y: 390, w: 180, h: 44, title: c, color: i === 4 ? 'amber' : 'orange', titleSize: 13, glow: false, parent: P }); });
          var ls = [];
          for (var k = 0; k < 4; k++) ls.push(ctx.link(nodes[k], nodes[k + 1], { color: 'orange', straight: true, parent: P }));
          note(ctx, P, 1170, 385, '672,000 samples', 'amber');
          note(ctx, P, 1170, 403, '= 2.7 MB float32', 'dim');
          /* inset: 4 ms of signal, 48 kHz stems vs 16 kHz samples */
          var ix = 120, iy = 470, iw = 900, ih = 300, mid = iy + ih / 2;
          ctx.rect(ix, iy, iw, ih, { rx: 10, fill: 'rgba(8,12,26,0.85)', stroke: ctx.alpha('orange', 0.35), parent: P });
          note(ctx, P, ix + 16, iy + 22, '4 ms of the memo (t = 12.40 s)', 'text');
          function sig(tt) { var f0 = f0At(12.4), v = 0; for (var h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * h * f0 * 2.2 * tt + h) / h; return v * 0.62; }
          var cd = '';
          for (var j = 0; j <= 200; j++) { var tt = j / 200 * 0.004; cd += (j ? 'L' : 'M') + (ix + 30 + (iw - 60) * j / 200).toFixed(1) + ',' + (mid - sig(tt) * 100).toFixed(1); }
          ctx.path(cd, { stroke: ctx.alpha('white', 0.35), sw: 1.2, parent: P });
          var st = '', dots = [];
          for (var q = 0; q < 192; q++) { var t2 = q / 192 * 0.004, xx = ix + 30 + (iw - 60) * q / 192; st += 'M' + xx.toFixed(1) + ',' + mid + 'V' + (mid - sig(t2) * 100).toFixed(1); }
          var stems = ctx.path(st, { stroke: ctx.alpha('orange', 0.45), sw: 1, parent: P });
          for (var q2 = 0; q2 < 192; q2 += 3) { var t3 = q2 / 192 * 0.004; dots.push(ctx.circle(ix + 30 + (iw - 60) * q2 / 192, mid - sig(t3) * 100, 3.4, { fill: 'amber', parent: P })); }
          ctx.line(ix + 20, mid, ix + iw - 20, mid, { color: 'faint', sw: 1, parent: P });
          note(ctx, P, ix + 16, iy + ih - 18, nb('thin stems: 192 samples @ 48 kHz     dots: 64 kept @ 16 kHz (after low-pass)'), 'dim');
          ctx.para(1060, 500, ['Nyquist(16 kHz) = 8 kHz', 'speech intelligibility', 'lives below ~8 kHz', '', 'without the low-pass,', 'sibilant energy above', '8 kHz aliases back', 'into the speech band'], { size: 13, font: 'mono', color: 'text', lh: 22, parent: P });
          ctx.reveal(P, { dur: 400, delay: 600 });
          ctx.reveal(nodes, { from: 'left', stagger: 150, delay: 700 });
          ctx.reveal(ls, { from: 'draw', stagger: 150, delay: 900 });
          ctx.reveal(stems, { from: 'fade', delay: 1300 });
          ctx.reveal(dots, { from: 'scale', stagger: 30, delay: 1700 });
          ctx.hud('42 s × 16 kHz = 672,000 samples');
          return ctx.wait(1300).then(function () {
            return ls.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'orange', dur: 350 }); }); }, Promise.resolve());
          }).then(function () { return ctx.wait(800); });
        }
      },
      {
        title: 'STFT framing',
        say: 'Speech changes every few milliseconds, so we analyse it in short overlapping windows. A twenty five millisecond Hann window, four hundred samples long, slides forward ten milliseconds at a time. Each windowed slice goes through a fast Fourier transform, giving the energy in two hundred and one frequency bins. One hundred windows per second, stacked side by side, form a spectrogram: time runs left to right, frequency bottom to top. Notice the horizontal harmonic stripes of the voice.',
        deep: '<div class="eq">X[m, k] = Σ<sub>n=0</sub><sup>N−1</sup> x[n + mH] · w[n] · e<sup>−j2πkn/N</sup>, &nbsp; N = 400, H = 160</div>' +
          '<div class="eq">w[n] = 0.5 − 0.5 cos(2πn/N) &nbsp;(periodic Hann)</div>' +
          '<ul><li>Bins: N/2 + 1 = <b>201</b>, spacing 16000/400 = 40 Hz.</li>' +
          '<li>Frames: 16000/160 = <b>100 per second</b>; 30 s → 3000 frames (Whisper pads/trims every window to 30 s).</li>' +
          '<li>Power spectrum <code>|X|²</code>; phase is discarded (fine for recognition, not for resynthesis).</li></ul>' +
          '<p>Time–frequency trade-off: with 40 Hz bins (Hann main lobe ≈ 80 Hz at −6 dB), a 25 ms window just resolves the ~120 Hz harmonic spacing of this voice while staying shorter than a phoneme (~50–100 ms). Longer windows sharpen pitch but smear transients like plosives.</p>' +
          '<div class="note">Everything here is a fixed, differentiable linear operation — GPU implementations (torch.stft) process an hour of audio in well under a second.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.p1, 400);
          var sx0 = WX + WW * SEG0 / DUR, sx1 = WX + WW * (SEG0 + 3) / DUR;
          S.segHl = ctx.rect(sx0, WY - 50, sx1 - sx0, 100, { rx: 4, fill: ctx.alpha('amber', 0.1), stroke: 'amber', sw: 1.5, parent: S.top });
          S.segLab = note(ctx, S.top, (sx0 + sx1) / 2, WY - 60, '3 s analysed below', 'amber', 'middle');
          ctx.reveal(S.segHl, { dur: 400 });
          var P = S.p2 = ctx.group();
          title(ctx, P, 90, 372, '100 ms of waveform · Hann window 25 ms · hop 10 ms');
          var ix = 90, iy = 400, iw = 640, ih = 260, mid = iy + ih / 2;
          ctx.rect(ix, iy, iw, ih, { rx: 10, fill: 'rgba(8,12,26,0.85)', stroke: ctx.alpha('orange', 0.3), parent: P });
          function sig(tt) { var f0 = f0At(12.5), v = 0; for (var h = 1; h <= 9; h++) v += Math.sin(2 * Math.PI * h * f0 * tt + h * 1.3) * Math.exp(-Math.pow((h * f0 - 600) / 700, 2)); return v; }
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
          note(ctx, P, ix + 16, iy + ih + 22, 'hop 160 samples = 10 ms → 100 frames / s · n_fft 400 → 201 bins (40 Hz apart)', 'dim');
          /* right: linear spectrogram of the 3 s segment */
          var gx = 800, gy = 400, gw = 720, gh = 240;
          ctx.rect(gx - 2, gy - 2, gw + 4, gh + 4, { rx: 4, stroke: ctx.alpha('orange', 0.35), sw: 1, parent: P });
          S.lin = img(ctx, P, spectro(ctx, S.syl, false), gx, gy, gw, gh);
          note(ctx, P, gx - 8, gy + 6, '8 kHz', 'dim', 'end');
          note(ctx, P, gx - 8, gy + gh - 4, '0', 'dim', 'end');
          note(ctx, P, gx, gy + gh + 20, '12 s', 'dim');
          note(ctx, P, gx + gw, gy + gh + 20, '15 s', 'dim', 'end');
          note(ctx, P, gx + gw / 2, gy + gh + 20, '|STFT|² · 300 frames × 201 bins (linear Hz)', 'text', 'middle');
          var cursor = ctx.rect(gx, gy - 6, 3, gh + 12, { rx: 1, fill: 'amber', parent: P });
          ctx.reveal(P, { dur: 400 });
          var link = ctx.path('M' + (ix + iw) + ',' + mid + ' C' + (ix + iw + 40) + ',' + mid + ' ' + (gx - 40) + ',' + (gy + gh / 2) + ' ' + (gx - 4) + ',' + (gy + gh / 2), { stroke: 'amber', sw: 1.4, arrow: true, dash: '4 4', parent: P });
          ctx.text(ix + iw + 34, mid - 14, 'FFT', { size: 12, font: 'mono', color: 'amber', parent: P });
          S.lin.setAttribute('width', 0.01);
          return ctx.wait(500).then(function () {
            return ctx.tween(4200, function (t) {
              var hops = Math.floor(t * 30) % 8;
              ctx.place(win, ix + 20 + hops * (iw - 40) * 0.1, mid);
              S.lin.setAttribute('width', Math.max(0.01, gw * t).toFixed(1));
              cursor.setAttribute('x', (gx + gw * t - 1).toFixed(1));
            }, 'linear');
          }).then(function () {
            ctx.place(win, ix + 20 + 2 * (iw - 40) * 0.1, mid);
            return ctx.packet(link, { color: 'amber', dur: 600 });
          });
        }
      },
      {
        title: 'Log-mel spectrogram',
        say: 'Human hearing resolves low frequencies finely and high frequencies coarsely, so the linear bins are pooled by a bank of triangular mel filters, narrow at the bottom and wide at the top. Whisper large version three uses one hundred and twenty eight of them. A logarithm then compresses the huge dynamic range, much as loudness perception does. Thirty seconds of audio become a one hundred twenty eight by three thousand image, and from here on, audio is processed much like a picture.',
        deep: '<div class="eq">mel(f) = 2595 · log<sub>10</sub>(1 + f/700) &nbsp;(HTK form)</div>' +
          '<p><span class="muted">Whisper builds its bank with librosa defaults: the Slaney mel scale (linear below 1 kHz, logarithmic above) and area-normalised triangles; the shape of the warp is nearly identical.</span></p>' +
          '<div class="eq">S<sub>mel</sub> = M · |X|², &nbsp; M ∈ ℝ<sup>128×201</sup> (triangular, Slaney-normalised)</div>' +
          '<div class="eq">L = log<sub>10</sub>(max(S<sub>mel</sub>, 10<sup>−10</sup>)); &nbsp; L = max(L, max(L) − 8); &nbsp; L = (L + 4)/4</div>' +
          '<p>That last line is Whisper\'s exact normalisation: clamp to an 80 dB dynamic range, then scale to roughly [−1, 1]. Output per window: <code>[128, 3000]</code> (v3) or <code>[80, 3000]</code> (v1/v2).</p>' +
          '<ul><li>Mel spacing: filters are ~equally spaced below 1 kHz and logarithmically above, matching cochlear resolution.</li>' +
          '<li>The pitch harmonics blur together at high mel bins; formants (vowel identity) survive — exactly what recognition needs.</li>' +
          '<li>Training-time augmentation: SpecAugment masks random time and frequency bands.</li></ul>' +
          '<div class="note">Alternative front-ends learn the filterbank from raw waveform (wav2vec 2.0 / HuBERT use a 7-layer strided CNN giving 50 Hz frames), but log-mel remains the default for encoders consumed by LLMs.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var old = S.p2;
          ctx.fadeOut(old.childNodes[0] ? Array.prototype.slice.call(old.childNodes).filter(function (n) { return n !== S.lin; }) : [], 400, true);
          var P = S.p3 = ctx.group();
          title(ctx, P, 90, 372, 'Mel filterbank (every 8th of 128 filters shown)');
          var fx = 90, fy = 400, fw = 640, fh = 240;
          ctx.rect(fx, fy, fw, fh, { rx: 10, fill: 'rgba(8,12,26,0.85)', stroke: ctx.alpha('orange', 0.3), parent: P });
          var mMax = melOf(8000), tris = [];
          for (var b = 0; b < 130; b += 8) {
            var f2 = hzOfMel(mMax * (b + 1) / 129);
            var sc = 8, fl = hzOfMel(mMax * Math.max(0, b - sc) / 129), fr = hzOfMel(mMax * Math.min(129, b + sc) / 129);
            var X = function (f) { return (fx + 20 + (fw - 40) * f / 8000).toFixed(1); };
            var hgt = fh - 60;
            tris.push(ctx.path('M' + X(fl) + ',' + (fy + fh - 30) + ' L' + X(f2) + ',' + (fy + fh - 30 - hgt * (0.55 + 0.45 * (1 - b / 130))) + ' L' + X(fr) + ',' + (fy + fh - 30), { stroke: ctx.cmap('heat', 0.35 + 0.6 * b / 130), sw: 1.6, parent: P }));
          }
          [0, 1000, 2000, 4000, 8000].forEach(function (f) { note(ctx, P, fx + 20 + (fw - 40) * f / 8000, fy + fh - 12, f >= 1000 ? (f / 1000) + 'k' : '0', 'dim', 'middle'); });
          note(ctx, P, fx + fw - 16, fy + 22, 'Hz (linear axis)', 'dim', 'end');
          ctx.text(fx, fy + fh + 24, 'mel(f) = 2595·log₁₀(1 + f/700)   ·   L = log₁₀(max(M|X|², 1e−10))', { size: 13, font: 'mono', color: 'text', parent: P });
          /* right: mel spectrogram replaces linear */
          var gx = 800, gy = 400, gw = 720, gh = 240;
          ctx.rect(gx - 2, gy - 2, gw + 4, gh + 4, { rx: 4, stroke: ctx.alpha('orange', 0.35), sw: 1, parent: P });
          S.mel = img(ctx, P, spectro(ctx, S.syl, true), gx, gy, gw, gh);
          note(ctx, P, gx - 8, gy + 6, 'bin 127', 'dim', 'end');
          note(ctx, P, gx - 8, gy + gh - 4, '0', 'dim', 'end');
          note(ctx, P, gx + gw / 2, gy + gh + 20, 'log-mel · 128 bins × 100 frames/s → [128, 3000] per 30 s window', 'text', 'middle');
          note(ctx, P, gx, gy + gh + 42, 'low bins spread out (fine pitch detail), high bins compressed', 'dim');
          ctx.reveal(P, { dur: 400 });
          ctx.reveal(tris, { from: 'draw', stagger: 80, dur: 500, delay: 300 });
          ctx.hud('mel filterbank M ∈ ℝ¹²⁸ˣ²⁰¹');
          return wipe(ctx, S.mel, 2600, 600).then(function () {
            ctx.remove(S.lin, 300);
            if (old.parentNode) ctx.remove(old, 300);
            return ctx.wait(900);
          });
        }
      },
      {
        title: 'Whisper encoder',
        say: 'The Whisper encoder first applies two one dimensional convolutions over time. The second has stride two, halving the frame rate to fifty per second, so each output frame covers twenty milliseconds. Sinusoidal positions are added, and thirty two transformer blocks with bidirectional attention turn the frames into contextual features. Because Whisper was trained on millions of hours of transcribed audio, these features already encode phonemes, words, language, and a good deal about the speaker.',
        deep: '<pre>x = gelu(conv1(mel))  # k3 s1: [1280,3000]\nx = gelu(conv2(x))    # k3 s2: [1280,1500]\nx = x.T + sin_pos     # [1500, 1280]\nfor blk in blocks:    # 32 pre-LN blocks\n    x = blk(x)        # 20 heads, bidir.\nx = ln_post(x)        # 50 Hz features</pre>' +
          '<table><tr><th>Whisper-large-v3 encoder</th><th></th></tr>' +
          '<tr><td>layers / width / heads / MLP</td><td>32 / 1280 / 20 / 5120</td></tr>' +
          '<tr><td>params</td><td>≈ 0.63 B</td></tr>' +
          '<tr><td>FLOPs per 30 s window</td><td>2·0.63 B·1500 ≈ 1.9 T + attn 4·32·1500²·1280 ≈ 0.37 T</td></tr>' +
          '<tr><td>training data (v3)</td><td>1 M h weakly labelled + 4 M h pseudo-labelled</td></tr></table>' +
          '<p>Audio-LLMs (Qwen2-Audio, Kimi-Audio, many others) initialise their audio encoder from Whisper for exactly this reason: robust, multilingual, noise-tolerant features for free.</p>' +
          '<div class="note">Limitation: the fixed 30 s window forces padding and chunking (our 42 s memo = 2 windows). Streaming encoders use causal or chunked attention instead (e.g. Moshi\'s Mimi, streaming Conformers).</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.p3, 400);
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
          note(ctx, P, 90, 548, 'log-mel · 100 fps', 'orange');
          note(ctx, P, 90, 566, '[128 × 3000]', 'dim');
          var c1 = ctx.node({ x: 380, y: 475, w: 110, h: 60, title: 'Conv1d', sub: 'k3 · s1 · GELU', color: 'orange', titleSize: 13, subSize: 10, glow: false, parent: P });
          var B = cols(460, 24, 8, 2, 420, 110, 'amber', v24);
          note(ctx, P, 460, 548, '[1280 × 3000]', 'dim');
          var c2 = ctx.node({ x: 760, y: 475, w: 110, h: 60, title: 'Conv1d', sub: 'k3 · s2 · GELU', color: 'orange', titleSize: 13, subSize: 10, glow: false, parent: P });
          var C = cols(840, 12, 18, 2, 420, 110, 'amber', v12);
          note(ctx, P, 840, 548, '[1280 × 1500] · 50 fps', 'amber');
          var kern = ctx.rect(458, 414, 32, 122, { rx: 3, stroke: 'white', sw: 2, parent: P });
          /* transformer stack */
          for (var k = 5; k >= 0; k--) ctx.rect(1110 + k * 6, 410 + k * 6, 150, 110, { rx: 10, fill: 'rgba(12,16,34,0.95)', stroke: ctx.alpha('orange', k ? 0.25 : 0.9), sw: k ? 1 : 1.5, parent: P });
          ctx.text(1185, 450, 'Transformer', { size: 14, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: P });
          ctx.text(1185, 472, '× 32 · d 1280', { size: 12, font: 'mono', color: 'orange', anchor: 'middle', parent: P });
          ctx.text(1185, 492, '+ sinusoid pos', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          var D = cols(1300, 12, 14, 3, 420, 110, 'orange');
          note(ctx, P, 1300, 548, '[1500 × 1280]', 'orange');
          note(ctx, P, 1300, 566, '1 frame = 20 ms', 'dim');
          var links = [
            ctx.link({ x: 332, y: 475 }, c1, { color: 'orange', straight: true, parent: P, to: 'l' }),
            ctx.link(c1, { x: 456, y: 475 }, { color: 'orange', straight: true, parent: P, from: 'r' }),
            ctx.link({ x: 702, y: 475 }, c2, { color: 'orange', straight: true, parent: P, to: 'l' }),
            ctx.link(c2, { x: 836, y: 475 }, { color: 'orange', straight: true, parent: P, from: 'r' }),
            ctx.link({ x: 1082, y: 475 }, { x: 1106, y: 475 }, { color: 'orange', straight: true, parent: P }),
            ctx.link({ x: 1268, y: 475 }, { x: 1296, y: 475 }, { color: 'orange', straight: true, parent: P })
          ];
          ctx.para(90, 620, [
            'phonemes, words, language id and speaker traits are linearly decodable from these frames',
            'FLOPs per 30 s window ≈ 1.9 T (linear) + 0.37 T (attention) · params ≈ 0.63 B',
            'memo 42 s → 2 windows → 2100 frames (padding trimmed)'
          ], { size: 13, font: 'mono', color: 'text', lh: 24, parent: P });
          C.concat(D).forEach(function (e) { e.setAttribute('opacity', 0); });
          ctx.reveal(P, { dur: 400 });
          ctx.hud('100 fps → 50 fps · 20 ms per frame');
          return ctx.wait(600).then(function () {
            return ctx.tween(2400, function (t) {
              var step = Math.min(11, Math.floor(t * 12));
              kern.setAttribute('x', (458 + step * 20).toFixed(1));
              for (var q = 0; q <= step; q++) C[q].setAttribute('opacity', 1);
            }, 'linear');
          }).then(function () {
            C.forEach(function (e) { e.setAttribute('opacity', 1); });
            ctx.fade(kern, 0, 300);
            return ctx.packet(links[4], { color: 'orange', dur: 500 });
          }).then(function () {
            return ctx.reveal(D, { from: 'up', stagger: 60 });
          }).then(function () { return ctx.packet(links[5], { color: 'orange', dur: 400 }); });
        }
      },
      {
        title: 'Pooling to LLM rate',
        say: 'Fifty frames per second is still dense for a language model. Audio language models pool adjacent frames, for example averaging pairs down to twenty five per second, as Qwen2-Audio does, or stacking four frames into one at twelve and a half per second, and then project into the model\'s embedding space with a small MLP. Our forty two second memo becomes about one thousand and fifty tokens, roughly seven times more than its transcript, because they also carry tone, pace and emotion.',
        deep: '<table><tr><th>method</th><th>rate</th><th>memo (42 s)</th></tr>' +
          '<tr><td>raw Whisper frames</td><td>50 Hz</td><td>2100</td></tr>' +
          '<tr><td>avg-pool ×2 (Qwen2-Audio)</td><td>25 Hz</td><td>1050</td></tr>' +
          '<tr><td>stack ×4 + MLP (Kimi-Audio-style)</td><td>12.5 Hz</td><td>525</td></tr>' +
          '<tr><td>window Q-Former (SALMONN)</td><td>1 query / 17 frames (~3 Hz)</td><td>~124 (88 per 30 s)</td></tr>' +
          '<tr><td>transcript only (ASR)</td><td>~3.3 tok/s</td><td>~140</td></tr></table>' +
          '<div class="eq">stack: h<sub>j</sub> = MLP([x<sub>4j</sub>; x<sub>4j+1</sub>; x<sub>4j+2</sub>; x<sub>4j+3</sub>]) ∈ ℝ<sup>d<sub>LLM</sub></sup>, &nbsp; [x] ∈ ℝ<sup>4·1280</sup></div>' +
          '<p>Why not just transcribe? The narrator\'s pacing, emphasis and emotion are exactly what the TTS agent must reproduce; a transcript drops all of it. The LLM can answer "where does the narrator pause for effect?" only from audio tokens.</p>' +
          '<div class="note">Timing alignment: 25 Hz → 40 ms per token. With M-RoPE-style temporal ids, audio tokens can be aligned to video time for lip-sync and cut timing.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.p4, 0.3, 500);
          var P = S.p5 = ctx.group();
          title(ctx, P, 90, 706, 'Downsample to the LLM token rate', 'white');
          var r = ctx.rng(5), f50 = [];
          var x0 = 90, y0 = 730;
          for (var i = 0; i < 16; i++) f50.push(ctx.rect(x0 + i * 22, y0, 18, 80, { rx: 2, fill: ctx.cmap('orange', 0.3 + 0.6 * r()), parent: P }));
          note(ctx, P, x0, y0 + 98, '50 Hz · 16 frames = 320 ms', 'orange');
          var ar = ctx.link({ x: 450, y: 770 }, { x: 510, y: 770 }, { color: 'orange', straight: true, label: 'avg-pool ×2', labelDy: -16, parent: P });
          var f25 = [];
          for (var j = 0; j < 8; j++) f25.push(ctx.rect(520 + j * 34, y0, 30, 80, { rx: 3, fill: ctx.cmap('amber', 0.35 + 0.55 * r()), parent: P }));
          note(ctx, P, 520, y0 + 98, '25 Hz · 8 tokens', 'amber');
          var ar2 = ctx.link({ x: 800, y: 770 }, { x: 860, y: 770 }, { color: 'amber', straight: true, label: 'MLP → 3584', labelDy: -16, parent: P });
          var tok = [];
          for (var k = 0; k < 8; k++) tok.push(ctx.rect(870 + k * 24, y0 + 20, 20, 40, { rx: 4, fill: ctx.alpha('amber', 0.8), stroke: 'amber', sw: 1, parent: P }));
          note(ctx, P, 870, y0 + 98, 'LLM audio tokens', 'amber');
          /* word alignment */
          var words = [['the', 0], ['ice', 0.15], ['began', 0.34], ['to', 0.64], ['sing', 0.76]];
          words.forEach(function (w) { note(ctx, P, 870 + w[1] * 190, y0 + 8, w[0], 'text'); });
          ctx.para(1100, 736, ['42 s memo:', '  2100 frames @ 50 Hz', '  1050 tokens @ 25 Hz', '   525 tokens @ 12.5 Hz', '  ~140 transcript tokens'].map(nb), { size: 13, font: 'mono', color: 'text', lh: 21, parent: P });
          ctx.reveal(P, { dur: 300 });
          f25.concat(tok).forEach(function (e) { e.setAttribute('opacity', 0); });
          ctx.hud('memo → 1,050 audio tokens @ 25 Hz');
          return ctx.wait(500).then(function () {
            return ctx.tween(1600, function (t) {
              f50.forEach(function (e, i) {
                var j2 = i >> 1, tx = 520 + j2 * 34 + (i % 2) * 12;
                e.setAttribute('x', ctx.lerp(x0 + i * 22, tx, t).toFixed(1));
                e.setAttribute('opacity', (1 - 0.8 * t).toFixed(3));
              });
            }, 'inOut');
          }).then(function () {
            return ctx.reveal(f25, { from: 'scale', stagger: 60 });
          }).then(function () {
            f50.forEach(function (e, i) { e.setAttribute('x', x0 + i * 22); e.setAttribute('opacity', 1); });
            return ctx.packet(ar2, { color: 'amber', dur: 500 });
          }).then(function () { return ctx.reveal(tok, { from: 'up', stagger: 70 }); });
        }
      },
      {
        title: 'Codecs & RVQ',
        say: 'Understanding needs continuous features, but generating speech needs something a language model can sample: discrete tokens. Neural audio codecs such as SoundStream, EnCodec and DAC compress the waveform with a strided convolutional encoder to about seventy five latent vectors per second, then quantize each vector with residual vector quantization. The first codebook picks the nearest centroid. The leftover error is quantized by a second codebook, then a third, each stage refining the one before.',
        deep: '<pre>r = z              # 128-d latent frame\nfor i in range(N_q):\n    k[i] = argmin_j ||r - C_i[j]||\n    q += C_i[k[i]]\n    r -= C_i[k[i]] # residual shrinks\nreturn k           # N_q ints / frame</pre>' +
          '<ul><li><b>EnCodec (24 kHz)</b>: SEANet conv encoder, strides 2·4·5·8 = 320 → 75 Hz, 128-d latents, codebooks of 1024.</li>' +
          '<li><b>Training</b>: codebooks updated by EMA k-means, commitment loss β‖z − sg(q)‖², straight-through gradients; <i>quantizer dropout</i> samples N_q per batch so one model serves many bitrates.</li>' +
          '<li><b>Losses</b>: multi-scale mel L1 + adversarial (multi-scale STFT / multi-period discriminators) + feature matching.</li>' +
          '<li><b>DAC</b> improves codebook utilisation with low-dimensional factorised, L2-normalised code lookup.</li></ul>' +
          '<div class="eq">E‖z − q<sub>N</sub>‖² decreases roughly geometrically in N — coarse-to-fine, like a bit-plane code</div>',
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
          note(ctx, P, 430, 700, 'what a speech LM', 'amber');
          note(ctx, P, 430, 716, 'reads and writes', 'amber');
          /* RVQ plane */
          var ox = 900, oy = 610, pw = 560, ph = 420;
          ctx.rect(ox - pw / 2 + 40, oy - ph / 2, pw, ph, { rx: 12, fill: 'rgba(8,12,26,0.85)', stroke: ctx.alpha('amber', 0.35), parent: P });
          note(ctx, P, ox - pw / 2 + 56, oy - ph / 2 + 22, 'latent space (2-D slice) · residual quantisation', 'text');
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
            stages.push({ pts: pts, pick: pick, from: cur, idx: Math.floor(rr() * 1024), err: 0 });
            cur = pick;
          }
          stages.forEach(function (st) { st.err = Math.hypot(st.pick.x - z.x, st.pick.y - z.y); });
          note(ctx, P, ox + pw / 2 + 24, oy + ph / 2 - 16, 'dots: codebook entries · solid: chosen code · dashed: residual', 'dim', 'end');
          var zArrow = ctx.line(cx0, cy0, z.x, z.y, { color: 'white', sw: 2.2, arrow: true, parent: P });
          ctx.circle(cx0, cy0, 3, { fill: 'dim', parent: P });
          ctx.text(z.x + 10, z.y - 10, 'z', { size: 16, font: 'mono', weight: 700, color: 'white', parent: P });
          var stG = stages.map(function (st, s2) {
            var g = ctx.group({ parent: P });
            st.pts.forEach(function (p) { ctx.circle(p.x, p.y, [4, 3, 2.2, 1.5][s2], { fill: ctx.alpha(colors[s2], 0.6), parent: g }); });
            ctx.circle(st.pick.x, st.pick.y, [7, 5, 3.4, 2.2][s2], { stroke: colors[s2], sw: [2, 1.6, 1.2, 0.9][s2], parent: g });
            ctx.line(st.from.x, st.from.y, st.pick.x, st.pick.y, { color: colors[s2], sw: [2.4, 1.8, 1.2, 0.8][s2], arrow: s2 < 2, parent: g });
            ctx.line(st.pick.x, st.pick.y, z.x, z.y, { color: ctx.alpha(colors[s2], 0.8), sw: [1.2, 1, 0.7, 0.5][s2], dash: s2 < 2 ? '3 3' : '1.5 1.5', parent: g });
            return g;
          });
          /* residual bars + indices */
          var bx = ox - pw / 2 + 60, by = oy - ph / 2 + 62;
          note(ctx, P, bx, by - 12, '‖residual‖ after stage', 'dim');
          var bars = stages.map(function (st, s3) {
            ctx.text(bx, by + 12 + s3 * 24, 'q' + (s3 + 1), { size: 12, font: 'mono', color: colors[s3], parent: P });
            var b = ctx.rect(bx + 28, by + 4 + s3 * 24, Math.max(3, st.err * 0.6), 14, { rx: 3, fill: ctx.alpha(colors[s3], 0.7), parent: P });
            ctx.text(bx + 36 + Math.max(3, st.err * 0.6), by + 12 + s3 * 24, 'k=' + st.idx, { size: 11, font: 'mono', color: colors[s3], parent: P });
            return b;
          });
          ctx.reveal(P, { dur: 400 });
          ctx.reveal(ls, { from: 'draw', stagger: 150, delay: 300 });
          stG.concat(bars).forEach(function (e) { e.setAttribute('opacity', 0); });
          ctx.reveal(zArrow, { from: 'draw', delay: 700 });
          ctx.hud('75 Hz × N_q codes · each stage refines the last');
          return ctx.wait(1300).then(function () {
            return stG.reduce(function (p, g, i2) {
              return p.then(function () {
                ctx.reveal(bars[i2], { from: 'left', dur: 400 });
                return ctx.reveal(g, { from: 'fade', dur: 600 });
              }).then(function () { return ctx.wait(350); });
            }, Promise.resolve());
          }).then(function () {
            return ctx.camera(z.x - 25, z.y + 20, 2.8, 1000).then(function () { return ctx.wait(1300); }).then(function () { return ctx.camera(null, null, null, 900); });
          });
        }
      },
      {
        title: 'Bitrate arithmetic',
        say: 'The bitrate is simple arithmetic: frames per second, times the number of codebooks, times the bits per code. EnCodec at seventy five frames, with eight codebooks of one thousand and twenty four entries, gives six kilobits per second. Moshi\'s Mimi codec runs at only twelve and a half frames per second with eight codebooks of two thousand and forty eight entries: just one point one kilobits. Click the codebook buttons to trade bitrate against fidelity.',
        deep: '<div class="eq">bitrate = f<sub>frame</sub> × N<sub>q</sub> × log<sub>2</sub>K</div>' +
          '<table><tr><th>codec</th><th>f</th><th>N<sub>q</sub> × K</th><th>bitrate</th><th>memo tokens</th></tr>' +
          '<tr><td>EnCodec 24 kHz</td><td>75 Hz</td><td>8 × 1024</td><td>6.0 kbps</td><td>25,200</td></tr>' +
          '<tr><td>DAC 44.1 kHz</td><td>86 Hz</td><td>9 × 1024</td><td>7.75 kbps</td><td>32,550</td></tr>' +
          '<tr><td>Mimi (Moshi)</td><td>12.5 Hz</td><td>8 × 2048</td><td>1.1 kbps</td><td>4,200</td></tr></table>' +
          '<p>Modelling N<sub>q</sub> parallel streams with an LM: <b>flatten</b> (N<sub>q</sub>·T tokens, expensive), <b>delay pattern</b> (MusicGen: codebook i shifted by i steps, one step predicts all), <b>AR + NAR</b> (VALL-E: autoregress codebook 1, fill 2..8 in parallel), <b>RQ/depth transformer</b> (Moshi: a big temporal transformer per frame, a small depth transformer across the 8 codebooks).</p>' +
          '<div class="note">Low frame rate is the big lever for LLM-style generation: Mimi\'s 12.5 Hz makes a minute of speech 750 frames — cheaper than the text of many prompts.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.p6, 400);
          var P = S.p7 = ctx.group();
          title(ctx, P, 90, 372, 'Codec tokens: N_q rows × time (EnCodec, 75 frames/s)');
          var r = ctx.rng(21), T = 36, grid = ctx.matrix(90, 400, 8, T, { cell: 16, gap: 3, values: function () { return ctx.cmap('heat', 0.15 + 0.85 * r()); }, parent: P });
          for (var q = 0; q < 8; q++) note(ctx, P, 80, 408 + q * 19, 'q' + (q + 1), 'dim', 'end');
          note(ctx, P, 90, 568, '← 0.48 s →   each column = one 13.3 ms frame', 'dim');
          S.brText = ctx.text(90, 614, '', { size: 22, font: 'mono', weight: 700, color: 'amber', parent: P });
          S.brSub = ctx.text(90, 644, '', { size: 13, font: 'mono', color: 'text', parent: P });
          S.qual = ctx.bars(840, 420, 300, 150, [0, 0, 0, 0], { color: ['#5b3a1f', '#9c5a26', '#d9772e', '#ff8a3d'], labels: ['1', '2', '4', '8'], gap: 16, parent: P });
          note(ctx, P, 840, 404, 'reconstruction quality (illustrative) vs N_q', 'dim');
          var chips = [1, 2, 4, 8].map(function (n, i) {
            var g = ctx.group({ parent: P });
            var rc = ctx.rect(1200 + (i % 2) * 150, 420 + Math.floor(i / 2) * 60, 136, 44, { rx: 22, fill: ctx.alpha('amber', 0.1), stroke: 'amber', sw: 1.4, parent: g });
            ctx.text(1268 + (i % 2) * 150, 442 + Math.floor(i / 2) * 60, 'N_q = ' + n, { size: 15, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
            g.style.cursor = 'pointer';
            g.addEventListener('click', function () { S.setNq(n); });
            return { g: g, rc: rc, n: n };
          });
          note(ctx, P, 1200, 404, 'click to change N_q', 'amber');
          S.setNq = function (n) {
            for (var q2 = 0; q2 < 8; q2++) for (var c = 0; c < T; c++) grid.cells[q2][c].setAttribute('opacity', q2 < n ? 1 : 0.12);
            chips.forEach(function (ch) { ch.rc.setAttribute('fill', ch.n === n ? ctx.alpha('amber', 0.45) : ctx.alpha('amber', 0.08)); });
            var kbps = 75 * n * 10 / 1000;
            S.brText.textContent = '75 × ' + n + ' × log₂1024 = ' + kbps.toFixed(2) + ' kbps';
            S.brSub.textContent = 'memo (42 s) = ' + (75 * 42 * n).toLocaleString('en-US') + ' tokens · ' + (kbps * 42 / 8).toFixed(1) + ' kB';
            var qv = [1, 2, 4, 8].map(function (m) { return m <= n ? 0.25 + 0.75 * (1 - Math.exp(-m / 2.6)) : 0.04; });
            return S.qual.update(qv, 350);
          };
          ctx.code({ x: 90, y: 676, w: 1440, title: 'bitrate = frames/s × N_q × log2(K)', lang: 'text', size: 13, color: 'amber', lines: [
            'EnCodec 24 kHz   75 Hz × 8 × 10 bit = 6.0 kbps    memo: 25,200 tokens   (1.5 / 3 / 6 / 12 / 24 kbps with 2…32 codebooks)',
            'DAC 44.1 kHz     86 Hz × 9 × 10 bit = 7.75 kbps   memo: 32,550 tokens   (music-grade, factorised codes)',
            'Mimi (Moshi)   12.5 Hz × 8 × 11 bit = 1.1 kbps    memo:  4,200 tokens   (streaming, 1st codebook = semantic)'
          ].map(nb), parent: P });
          ctx.reveal(P, { dur: 400 });
          S.setNq(1);
          return ctx.wait(900).then(function () { return S.setNq(2); })
            .then(function () { return ctx.wait(700); }).then(function () { return S.setNq(4); })
            .then(function () { return ctx.wait(700); }).then(function () { return S.setNq(8); })
            .then(function () { return ctx.wait(800); });
        }
      },
      {
        title: 'Semantic vs acoustic',
        say: 'There are two kinds of discrete audio tokens. Semantic tokens come from self supervised speech models such as HuBERT or w2v-BERT: take intermediate features, cluster them with k-means, and each token roughly marks a phonetic unit, whoever is speaking. Acoustic tokens from codecs capture everything needed to rebuild the waveform: timbre, room, microphone. Modern speech generators predict semantic tokens first and acoustic detail second, and codecs like Mimi distill semantics into their first codebook.',
        deep: '<p><b>Semantic tokens</b>: HuBERT is trained to predict k-means cluster ids of masked frames (iteratively re-clustered). Discretise layer-L features (e.g. HuBERT-base layer 9, K = 500) at 50 Hz; deduplicate repeats for LM training. CosyVoice 2\'s supervised tokenizer instead applies FSQ inside an ASR-trained encoder at 25 Hz — more text-aligned.</p>' +
          '<p><b>Acoustic tokens</b>: RVQ codec ids; high entropy, needed for fidelity.</p>' +
          '<table><tr><th></th><th>semantic</th><th>acoustic</th></tr>' +
          '<tr><td>phonetic content</td><td>✓</td><td>✓ (entangled)</td></tr>' +
          '<tr><td>speaker timbre</td><td>mostly removed</td><td>✓</td></tr>' +
          '<tr><td>prosody</td><td>partial</td><td>✓</td></tr>' +
          '<tr><td>room / mic / noise</td><td>✗</td><td>✓</td></tr>' +
          '<tr><td>easy to model with an LM</td><td>✓ (low entropy)</td><td>harder</td></tr></table>' +
          '<p><b>Hierarchies</b>: AudioLM (semantic → coarse acoustic → fine acoustic); SpeechTokenizer and Mimi distil a WavLM/HuBERT teacher into codebook 1 ("split RVQ"), so one stream carries both. Modern TTS (CosyVoice 2, Seed-TTS) = LLM → semantic tokens → flow-matching decoder to mel → vocoder.</p>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.p7, 400);
          var P = S.p8 = ctx.group();
          title(ctx, P, 90, 372, '"the ice began to sing" · two tokenisations of the same 0.86 s (43 frames @ 50 Hz)');
          var ph = [['DH', 2], ['AH', 2], ['AY', 5], ['S', 4], ['B', 2], ['IH', 3], ['G', 2], ['AE', 4], ['N', 3], ['T', 2], ['UW', 3], ['S', 4], ['IH', 3], ['NG', 4]];
          var ids = { DH: 71, AH: 12, AY: 305, S: 88, B: 240, IH: 17, G: 199, AE: 402, N: 33, T: 150, UW: 276, NG: 461 };
          var x = 300, cw = 22, y1 = 460;
          ctx.node({ x: 190, y: 480, w: 180, h: 62, title: 'HuBERT L9', sub: 'k-means K=500', color: 'violet', titleSize: 13, subSize: 11, glow: false, parent: P });
          ctx.node({ x: 190, y: 660, w: 180, h: 62, title: 'Codec (RVQ)', sub: '4 of 8 codebooks', color: 'orange', titleSize: 13, subSize: 11, glow: false, parent: P });
          var semCells = [], phLab = [];
          ph.forEach(function (p) {
            var w = p[1] * cw;
            phLab.push(ctx.text(x + w / 2, y1 - 26, p[0], { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: P }));
            for (var k = 0; k < p[1]; k++) {
              var id = ids[p[0]] + (k === p[1] - 1 && p[1] > 3 ? 1 : 0);
              var c = ctx.rect(x + k * cw, y1, cw - 2, 40, { rx: 3, fill: ctx.alpha('violet', 0.25 + (id % 7) / 10), stroke: ctx.alpha('violet', 0.6), sw: 0.8, parent: P });
              semCells.push(c);
            }
            ctx.line(x - 1, y1 - 16, x - 1, y1 + 46, { color: ctx.alpha('white', 0.15), sw: 1, parent: P });
            x += w;
          });
          note(ctx, P, 300, y1 + 64, 'semantic ids @ 50 Hz: ≈ one cluster per phone; same ids for any speaker → dedup → "71 12 305 88 240 …"', 'violet');
          var r = ctx.rng(8), acu = ctx.matrix(300, 610, 4, 43, { cell: 20, gap: 2, values: function () { return ctx.cmap('heat', 0.2 + 0.8 * r()); }, parent: P });
          note(ctx, P, 300, 718, 'acoustic ids (RVQ codec @ 50 Hz, 4 × 43): high entropy — timbre, breath, room, mic', 'orange');
          ctx.para(1100, 780, ['SpeechTokenizer (HuBERT teacher) and', 'Mimi (WavLM teacher): codebook 1 is', 'distilled → semantic; rest → acoustic'], { size: 13, font: 'mono', color: 'amber', lh: 21, parent: P });
          ctx.para(300, 780, ['TTS stack (CosyVoice 2 / Seed-TTS style):', 'LLM → semantic tokens → flow-matching → mel → vocoder'], { size: 13, font: 'mono', color: 'text', lh: 21, parent: P });
          ctx.reveal(P, { dur: 400 });
          semCells.forEach(function (c) { c.setAttribute('opacity', 0); });
          acu.setAttribute('opacity', 0);
          return ctx.wait(500).then(function () {
            return ctx.reveal(semCells, { from: 'scale', stagger: 25 });
          }).then(function () { return ctx.reveal(acu, { from: 'left', dur: 900 }); })
            .then(function () { return ctx.wait(800); });
        }
      },
      {
        title: 'Speaker embedding',
        say: 'Finally, the voice identity. A speaker verification network such as ECAPA TDNN reads filterbank frames through dilated convolutions with squeeze and excitation. Attentive statistics pooling collapses any length of speech into one weighted mean and standard deviation, and a linear layer produces a one hundred ninety two dimensional embedding. Clips of the same person land close together in cosine distance. After a consent check, this embedding and a clean reference clip condition the voice that will narrate the trailer.',
        deep: '<p><b>ECAPA-TDNN</b>: 80-d fbank → Conv1D(k5) → 3 SE-Res2Blocks (dilations 2, 3, 4; C = 1024) → multi-layer feature aggregation → attentive statistics pooling → FC → <b>192-d</b>. Trained with AAM-softmax (m = 0.2, s = 30) on VoxCeleb2 (5,994 speakers); ≈ 0.9% EER on VoxCeleb1-O.</p>' +
          '<div class="eq">α<sub>t</sub> = softmax<sub>t</sub>(vᵀ tanh(W h<sub>t</sub> + b)), &nbsp; μ = Σ α<sub>t</sub> h<sub>t</sub>, &nbsp; σ = √(Σ α<sub>t</sub> h<sub>t</sub>⊙h<sub>t</sub> − μ⊙μ)</div>' +
          '<div class="eq">score(a, b) = cos(e<sub>a</sub>, e<sub>b</sub>) = e<sub>a</sub>·e<sub>b</sub> / (‖e<sub>a</sub>‖‖e<sub>b</sub>‖)</div>' +
          '<ul><li><b>Cloning</b>: zero-shot TTS conditions on the embedding (CosyVoice uses an x-vector) and/or on the reference audio in-context (F5-TTS, Seed-TTS).</li>' +
          '<li><b>Evaluation</b>: the critic scores the synthesised narration with speaker similarity (cosine of WavLM-TDNN embeddings, "SIM-o"); typical good zero-shot systems reach 0.6–0.75.</li>' +
          '<li><b>Safety</b>: cloning only the account owner\'s verified voice, plus audio watermarking (e.g. AudioSeal) on every generated line.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.p8, 400);
          var P = S.p9 = ctx.group();
          title(ctx, P, 90, 372, 'ECAPA-TDNN speaker embedding');
          var blocks = [['80-d fbank frames', 'T × 80 · any length', 'orange'], ['Conv1D + 3 SE-Res2Blocks', 'dilation 2, 3, 4 · C 1024', 'orange'], ['multi-layer aggregation', 'concat block outputs', 'orange'], ['attentive stats pooling', 'weighted μ, σ over time', 'amber'], ['FC → 192-d embedding', 'AAM-softmax in training', 'amber']];
          var ns = blocks.map(function (b, i) { return ctx.node({ x: 290, y: 430 + i * 88, w: 390, h: 58, title: b[0], sub: b[1], color: b[2], titleSize: 14, subSize: 11, glow: false, parent: P }); });
          var ls = [];
          for (var i = 0; i < 4; i++) ls.push(ctx.link(ns[i], ns[i + 1], { color: 'orange', straight: true, parent: P }));
          /* embedding scatter */
          var sx = 540 + 280, sy = 400, sw = 420, sh = 400;
          ctx.rect(sx, sy, sw, sh, { rx: 12, fill: 'rgba(8,12,26,0.85)', stroke: ctx.alpha('orange', 0.3), parent: P });
          note(ctx, P, sx + 14, sy + 22, 'embedding space (2-D projection)', 'text');
          var r = ctx.rng(64), others = [[sx + 90, sy + 110, 'blue'], [sx + 320, sy + 120, 'cyan'], [sx + 100, sy + 300, 'lime'], [sx + 250, sy + 330, 'violet']];
          var dots = [];
          others.forEach(function (o) {
            for (var k = 0; k < 7; k++) dots.push(ctx.circle(o[0] + (r() - 0.5) * 60, o[1] + (r() - 0.5) * 50, 4, { fill: ctx.alpha(o[2], 0.6), parent: P }));
          });
          var me = { x: sx + 300, y: sy + 230 }, mem = [];
          for (var m = 0; m < 3; m++) mem.push(ctx.circle(me.x + (r() - 0.5) * 30, me.y + (r() - 0.5) * 26, 6, { fill: 'amber', stroke: 'white', sw: 1, parent: P, glow: true }));
          note(ctx, P, me.x - 20, me.y - 30, 'memo 0–14 s, 14–28 s, 28–42 s', 'amber', 'end');
          note(ctx, P, me.x - 20, me.y - 14, 'pairwise cos = 0.83, 0.79, 0.81', 'amber', 'end');
          note(ctx, P, sx + 14, sy + sh - 16, 'other speakers: cos to memo ≤ 0.25', 'dim');
          /* voice profile */
          var prof = ctx.code({ x: 1270, y: 400, w: 270, title: 'voice_profile.json', lang: 'json', size: 12, color: 'amber', lines: [
            '{ "speaker_emb": "ecapa192",',
            '  "dim": 192,',
            '  "self_sim": 0.81,',
            '  "f0_median_hz": 118,',
            '  "f0_range_hz": [92, 171],',
            '  "rate_wpm": 142,',
            '  "ref_clip": "12.0-19.5 s",',
            '  "snr_db": 31,',
            '  "consent": "verified" }'
          ].map(nb), parent: P });
          ctx.reveal(P, { dur: 400 });
          ctx.reveal(ls, { from: 'draw', stagger: 150, delay: 300 });
          dots.forEach(function (d) { d.setAttribute('opacity', 0); });
          mem.forEach(function (d) { d.setAttribute('opacity', 0); });
          ctx.hud('memo → 192-d speaker embedding');
          return ctx.wait(600).then(function () {
            return ls.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'amber', dur: 300 }); }); }, Promise.resolve());
          }).then(function () {
            ctx.reveal(dots, { from: 'scale', stagger: 20 });
            return ctx.reveal(mem, { from: 'scale', stagger: 200, delay: 300 });
          }).then(function () { return ctx.pulse(prof, { color: 'amber', dur: 700 }); });
        }
      }
    ]
  });
})();
