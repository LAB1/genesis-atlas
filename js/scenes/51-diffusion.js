/* L2 — Diffusion & Flow Matching. Forward noising, prediction targets, rectified-flow ODEs, solvers, CFG and few-step distillation.
 * Canvas note: 2D particle systems and 64x64 images are drawn on ctx.canvas() through one dirty-flag redraw loop;
 * small 64x64 offscreen canvases (never attached to the DOM) hold the procedural images. */
(function () {
  var N = 64;          /* procedural image resolution */
  var DOM = 2.8;       /* particle panel half-width in data units */

  /* ---------- procedural image: fox astronaut on a glowing ice moon (u,v in [0,1]) ---------- */
  function hash(i, j) { var s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return s - Math.floor(s); }
  function fieldRGB(u, v) {
    var r = 6 + 10 * (1 - v), g = 12 + 18 * (1 - v), b = 30 + 36 * (1 - v);
    if (v < 0.68 && hash(Math.floor(u * 64), Math.floor(v * 64)) < 0.025) { r = 200; g = 220; b = 255; }
    var dx = u - 0.74, dy = v - 0.25, dm = Math.sqrt(dx * dx + dy * dy);
    if (dm < 0.16) { var k = 1 - 0.3 * dm / 0.16; r = 200 * k + 40; g = 238 * k + 12; b = 255; if (hash(Math.floor(u * 40), Math.floor(v * 40)) < 0.15) { r -= 40; g -= 30; } }
    else { var h = Math.exp(-(dm - 0.16) * 9); r += 50 * h; g += 160 * h; b += 210 * h; }
    var hor = 0.78 + 0.03 * Math.sin(u * 8);
    if (v > hor) { var s = Math.exp(-(v - hor) * 9); r = 40 + 90 * s; g = 115 + 120 * s; b = 165 + 85 * s; if (hash(Math.floor(u * 32), Math.floor(v * 32)) < 0.2) { g += 25; b += 20; } }
    var fx = u - 0.32, fy = v - 0.52, fd = Math.sqrt(fx * fx + fy * fy);
    if (Math.abs(fx) < 0.11 && fy > 0.13 && fy < 0.34) { r = 205; g = 215; b = 235; }
    if (fx > 0.09 && fx < 0.3 && fy > 0.2 && fy < 0.28 - (fx - 0.09) * 0.3) { r = 255; g = 140; b = 60; }
    if (fd < 0.155) {
      if (fd > 0.12) { r = 235; g = 245; b = 255; }
      else {
        r = 255; g = 132; b = 55;
        var mx = u - 0.335, my = v - 0.575;
        if (mx * mx + my * my < 0.0022) { r = 250; g = 240; b = 230; }
        if ((Math.abs(u - 0.29) < 0.016 || Math.abs(u - 0.37) < 0.016) && Math.abs(v - 0.5) < 0.016) { r = 20; g = 20; b = 30; }
      }
    }
    return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
  }
  function gauss(r) { var u = Math.max(1e-7, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  function boxBlur(src, rad) {
    var tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    var i, j, c, k, acc, x, y;
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) for (c = 0; c < 3; c++) {
      acc = 0;
      for (k = -rad; k <= rad; k++) { x = Math.min(N - 1, Math.max(0, j + k)); acc += src[(i * N + x) * 3 + c]; }
      tmp[(i * N + j) * 3 + c] = acc / (2 * rad + 1);
    }
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) for (c = 0; c < 3; c++) {
      acc = 0;
      for (k = -rad; k <= rad; k++) { y = Math.min(N - 1, Math.max(0, i + k)); acc += tmp[(y * N + j) * 3 + c]; }
      out[(i * N + j) * 3 + c] = acc / (2 * rad + 1);
    }
    return out;
  }

  function newBuf() {
    var c = document.createElement('canvas');
    c.width = N; c.height = N;
    var g = c.getContext('2d');
    return { c: c, g: g, id: g.createImageData(N, N) };
  }
  function paintArr(buf, arr) {
    var d = buf.id.data;
    for (var p = 0, q = 0; p < N * N; p++, q += 3) {
      d[p * 4] = (arr[q] + 1) * 127.5; d[p * 4 + 1] = (arr[q + 1] + 1) * 127.5; d[p * 4 + 2] = (arr[q + 2] + 1) * 127.5; d[p * 4 + 3] = 255;
    }
    buf.g.putImageData(buf.id, 0, 0);
  }
  function lin(a, A, b, B, out) { for (var k = 0; k < A.length; k++) out[k] = a * A[k] + b * B[k]; return out; }
  function drawBuf(c2, buf, x, y, s, col) {
    c2.imageSmoothingEnabled = false;
    c2.drawImage(buf.c, x, y, s, s);
    if (col) { c2.strokeStyle = col; c2.lineWidth = 1.5; c2.strokeRect(x - 0.5, y - 0.5, s + 1, s + 1); }
  }
  /* ideal-ish posterior mean E[x0 | x_t]: low-pass (Wiener-like) + shrink to the mean at high noise */
  function xhatImg(S, t, out) {
    var I = S.img, r = Math.min(10, Math.round(10 * Math.pow(t, 1.3)));
    var B = I.BL[r], m = I.mean, sh = Math.pow(t, 3);
    for (var k = 0; k < B.length; k++) out[k] = B[k] * (1 - sh) + m[k % 3] * sh;
    return out;
  }

  /* ---------- 2D toy: two moons + exact marginal rectified-flow velocity ---------- */
  function moons(rng, M) {
    var pts = [];
    for (var i = 0; i < M; i++) {
      var up = i < M / 2, th = Math.PI * rng();
      var x = up ? Math.cos(th) : 1 - Math.cos(th), y = up ? Math.sin(th) : 0.5 - Math.sin(th);
      pts.push([(x - 0.5) * 1.35 + 0.05 * gauss(rng), (y - 0.25) * 1.35 + 0.05 * gauss(rng), up ? 1 : 0]);
    }
    return pts;
  }
  function makeField(data) {
    var M = data.length, lw = new Float64Array(M);
    return function (z0, z1, t) {
      var a = 1 - t, inv = 1 / (2 * t * t), mx = -1e300, i;
      for (i = 0; i < M; i++) { var dx = z0 - a * data[i][0], dy = z1 - a * data[i][1]; lw[i] = -(dx * dx + dy * dy) * inv; if (lw[i] > mx) mx = lw[i]; }
      var sw = 0, hx = 0, hy = 0;
      for (i = 0; i < M; i++) { var w = Math.exp(lw[i] - mx); sw += w; hx += w * data[i][0]; hy += w * data[i][1]; }
      hx /= sw; hy /= sw;
      return [(z0 - hx) / t, (z1 - hy) / t];
    };
  }
  /* integrate from t=1 to 0. field(z0,z1,t) -> [vx,vy]. returns array of Float32Array snapshots */
  function simulate(field, init, n, heun) {
    var z = Float64Array.from(init), P = init.length / 2, traj = [Float32Array.from(init)];
    for (var k = 0; k < n; k++) {
      var t = 1 - k / n, tn = 1 - (k + 1) / n, h = tn - t;
      for (var p = 0; p < P; p++) {
        var v = field(z[2 * p], z[2 * p + 1], t);
        if (heun && tn > 1e-9) {
          var v2 = field(z[2 * p] + h * v[0], z[2 * p + 1] + h * v[1], tn);
          v = [(v[0] + v2[0]) / 2, (v[1] + v2[1]) / 2];
        }
        z[2 * p] += h * v[0]; z[2 * p + 1] += h * v[1];
      }
      traj.push(Float32Array.from(z));
    }
    return traj;
  }
  function nearest(data, x, y) {
    var best = 1e9, lab = 0;
    for (var i = 0; i < data.length; i++) { var dx = x - data[i][0], dy = y - data[i][1], d = dx * dx + dy * dy; if (d < best) { best = d; lab = data[i][2]; } }
    return [Math.sqrt(best), lab];
  }
  function toPx(P, u, v) { return [P.x + (u + DOM) / (2 * DOM) * P.s, P.y + (DOM - v) / (2 * DOM) * P.s]; }
  function posAt(traj, p, out) {
    var n = traj.length - 1, f = Math.min(n, Math.max(0, p * n)), k = Math.min(n - 1, Math.floor(f)), fr = f - k;
    var A = traj[k], B = traj[k + 1];
    for (var i = 0; i < A.length; i++) out[i] = A[i] + (B[i] - A[i]) * fr;
    return { k: k, fr: fr };
  }
  function drawData(c2, P, data, alpha, only) {
    c2.fillStyle = 'rgba(232,241,255,' + alpha + ')';
    c2.beginPath();
    data.forEach(function (d) {
      if (only !== undefined && d[2] !== only) return;
      var q = toPx(P, d[0], d[1]); c2.moveTo(q[0] + 1.6, q[1]); c2.arc(q[0], q[1], 1.6, 0, 6.2832);
    });
    c2.fill();
  }
  function drawDots(c2, P, pos, cols, palette, r) {
    palette.forEach(function (col, ci) {
      c2.fillStyle = col; c2.beginPath();
      for (var i = 0; i < pos.length / 2; i++) {
        if (cols[i] !== ci) continue;
        var q = toPx(P, pos[2 * i], pos[2 * i + 1]); c2.moveTo(q[0] + r, q[1]); c2.arc(q[0], q[1], r, 0, 6.2832);
      }
      c2.fill();
    });
  }
  function drawTrails(c2, P, traj, st, cur, count, col) {
    c2.strokeStyle = col; c2.lineWidth = 1;
    c2.beginPath();
    for (var i = 0; i < count; i++) {
      var q = toPx(P, traj[0][2 * i], traj[0][2 * i + 1]); c2.moveTo(q[0], q[1]);
      for (var k = 1; k <= st.k; k++) { q = toPx(P, traj[k][2 * i], traj[k][2 * i + 1]); c2.lineTo(q[0], q[1]); }
      q = toPx(P, cur[2 * i], cur[2 * i + 1]); c2.lineTo(q[0], q[1]);
    }
    c2.stroke();
  }
  function clipPanel(c2, P) { c2.beginPath(); c2.rect(P.x, P.y, P.s, P.s); c2.clip(); }

  /* ---------- layers & stage management ---------- */
  function addLayer(S, draw) { var L = { a: 1, draw: draw }; S.layers.push(L); S.dirty = true; return L; }
  function fadeLayers(ctx, S, ms) {
    var old = S.layers.slice();
    if (!old.length) return Promise.resolve();
    return ctx.tween(ms || 400, function (t) {
      old.forEach(function (L) { L.a = 1 - t; }); S.dirty = true;
    }).then(function () { S.layers = S.layers.filter(function (L) { return old.indexOf(L) < 0; }); S.dirty = true; });
  }
  function newStage(ctx, S) {
    if (S.g) ctx.remove(S.g, 350);
    fadeLayers(ctx, S, 350);
    S.g = ctx.group();
    return S.g;
  }
  function panelFrame(ctx, parent, P, title, col) {
    ctx.rect(P.x, P.y, P.s, P.s, { rx: 8, fill: 'rgba(6,12,24,0.85)', stroke: ctx.alpha(col || 'lime', 0.55), sw: 1.2, parent: parent });
    for (var k = -2; k <= 2; k++) {
      var a = toPx(P, k, 0);
      ctx.line(a[0], P.y + 4, a[0], P.y + P.s - 4, { color: 'rgba(255,255,255,0.04)', sw: 1, parent: parent });
      var b = toPx(P, 0, k);
      ctx.line(P.x + 4, b[1], P.x + P.s - 4, b[1], { color: 'rgba(255,255,255,0.04)', sw: 1, parent: parent });
    }
    if (title) ctx.text(P.x + 12, P.y - 14, title, { size: 13, font: 'mono', weight: 600, color: col || 'lime', parent: parent });
  }

  Atlas.register({
    id: 'diffusion',
    refs: [
      'Ho, Jain &amp; Abbeel, <i>Denoising Diffusion Probabilistic Models</i>, NeurIPS 2020; Song et al., <i>Score-Based Generative Modeling through SDEs</i>, ICLR 2021',
      'Lipman et al., <i>Flow Matching for Generative Modeling</i>, ICLR 2023; Liu, Gong &amp; Liu, <i>Flow Straight and Fast: Rectified Flow</i>, ICLR 2023',
      'Karras et al., <i>Elucidating the Design Space of Diffusion-Based Generative Models (EDM)</i>, NeurIPS 2022',
      'Ho &amp; Salimans, <i>Classifier-Free Diffusion Guidance</i>, 2022; Salimans &amp; Ho, <i>Progressive Distillation</i> (v-prediction), ICLR 2022',
      'Esser et al., <i>Scaling Rectified Flow Transformers for High-Resolution Image Synthesis (SD3)</i>, ICML 2024',
      'Song et al., <i>Consistency Models</i>, ICML 2023; Lu &amp; Song, <i>Simplifying, Stabilizing and Scaling Continuous-Time Consistency Models (sCM)</i>, ICLR 2025',
      'Yin et al., <i>DMD</i>, CVPR 2024 and <i>Improved DMD (DMD2)</i>, NeurIPS 2024; Yin et al., <i>CausVid</i>, CVPR 2025',
      'Sauer et al., <i>Adversarial Diffusion Distillation</i>, 2023; Lin et al., <i>Diffusion Adversarial Post-Training for One-Step Video Generation (APT)</i>, 2025'
    ],
    setup: function (ctx) {
      var S = ctx.state;
      S.c2 = ctx.canvas().ctx2d;
      S.layers = [];
      S.dirty = true;
      ctx.loop(function () {
        if (!S.dirty) return;
        S.dirty = false;
        var c2 = S.c2;
        c2.clearRect(0, 0, 1600, 900);
        S.layers.forEach(function (L) {
          if (L.a < 0.005) return;
          c2.save(); c2.globalAlpha = L.a; L.draw(c2); c2.restore();
        });
      });
      /* procedural image + fixed noise, in normalised [-1, 1] space */
      var rng = ctx.rng(2024);
      var X0 = new Float32Array(N * N * 3), E = new Float32Array(N * N * 3), mean = [0, 0, 0];
      for (var i = 0; i < N; i++) for (var j = 0; j < N; j++) {
        var c = fieldRGB((j + 0.5) / N, (i + 0.5) / N), k = (i * N + j) * 3;
        for (var ch = 0; ch < 3; ch++) { X0[k + ch] = c[ch] / 127.5 - 1; mean[ch] += X0[k + ch] / (N * N); }
      }
      for (var q = 0; q < E.length; q++) E[q] = gauss(rng);
      var BL = [X0];
      for (var r = 1; r <= 10; r++) BL.push(boxBlur(X0, r));
      S.img = { X0: X0, E: E, BL: BL, mean: mean, tmp: new Float32Array(N * N * 3) };
      /* 2D toy data */
      var r2 = ctx.rng(99);
      S.data = moons(r2, 160);
      S.fieldAll = makeField(S.data);
      /* conditional data = upper moon + ~15% "mis-captioned" lower-moon points (real captions are noisy) */
      S.fieldUp = makeField(S.data.filter(function (d, i) { return d[2] === 1 || i % 6 === 0; }));
      var init = new Float64Array(2 * 500);
      for (var p = 0; p < init.length; p++) init[p] = gauss(r2);
      S.init = init;
    },
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Destroy to create',
        say: 'Diffusion models learn to create by learning to undo destruction. Take a clean latent of our fox on the ice moon and blend it with Gaussian noise. At time zero it is pure signal; at time one it is pure noise. This forward process has no parameters and can jump to any noise level in one shot. The model only learns the reverse direction, and the generation loop inside the video model is just this reverse walk, repeated fifty times.',
        deep: '<p>The forward (noising) process is fixed and closed-form, so training can sample any t directly:</p>' +
          '<div class="eq">x<sub>t</sub> = α<sub>t</sub> x<sub>0</sub> + σ<sub>t</sub> ε,   ε ~ N(0, I),   t ∈ [0, 1]</div>' +
          '<table><tr><th>Schedule</th><th>α<sub>t</sub></th><th>σ<sub>t</sub></th><th>Used by</th></tr>' +
          '<tr><td>VP (α² + σ² = 1), e.g. cosine</td><td>cos(πt/2)</td><td>sin(πt/2)</td><td>DDPM (linear β), iDDPM (cosine), SD 1.x/2.x (scaled-linear β), early video LDMs</td></tr>' +
          '<tr><td>VE / EDM</td><td>1</td><td>σ(t) ∈ [0.002, 80]</td><td>EDM, score SDEs</td></tr>' +
          '<tr><td>Rectified flow</td><td>1 − t</td><td>t</td><td>SD3, Flux, Wan, HunyuanVideo, Movie Gen</td></tr></table>' +
          '<p>What matters is the signal-to-noise ratio SNR(t) = α²/σ², or λ = log SNR. Schedules differ mainly in how they spend training samples and sampler steps along λ.</p>' +
          '<div class="note">In the video model x<sub>0</sub> is the 16 × 31 × 90 × 160 VAE latent (7.1 M values), not pixels. The 64 × 64 image here is a stand-in; the math is identical.</div>',
        run: function (ctx) {
          var S = ctx.state, I = S.img;
          var g = newStage(ctx, S);
          ctx.text(90, 196, 'FORWARD PROCESS  x_t = (1 − t)·x₀ + t·ε  (rectified flow)', { size: 14, font: 'mono', weight: 600, color: 'lime', parent: g });
          var ts = [0, 0.25, 0.5, 0.75, 1];
          S.thumbs = ts.map(function () { return newBuf(); });
          S.tcur = [0, 0, 0, 0, 0];
          var arr = new Float32Array(N * N * 3);
          function paintThumb(i) { lin(1 - S.tcur[i], I.X0, S.tcur[i], I.E, arr); paintArr(S.thumbs[i], arr); }
          ts.forEach(function (t, i) {
            paintThumb(i);
            ctx.text(165 + i * 180, 392, 't = ' + t, { size: 13, font: 'mono', color: i === 0 ? 'lime' : (i === 4 ? 'dim' : 'text'), anchor: 'middle', parent: g });
          });
          addLayer(S, function (c2) {
            S.thumbs.forEach(function (b, i) { drawBuf(c2, b, 90 + i * 180, 225, 150, i === 0 ? 'rgba(141,255,90,0.8)' : 'rgba(123,140,171,0.6)'); });
          });
          var fwd = ctx.line(95, 420, 955, 420, { color: 'pink', sw: 2, arrow: true, parent: g });
          ctx.text(525, 438, 'forward q(x_t | x₀): fixed, closed form, any t in one shot', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: g });
          var rev = ctx.line(955, 466, 95, 466, { color: 'lime', sw: 2, arrow: true, parent: g });
          ctx.text(525, 484, 'reverse: learned v_θ, integrated from t = 1 to 0 in ~50 steps', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: g });
          ctx.reveal([fwd, rev], { from: 'draw', delay: 400, stagger: 1600 });
          /* equation card */
          var eq = ctx.group({ parent: g });
          ctx.rect(1030, 190, 510, 300, { rx: 12, fill: 'rgba(6,12,24,0.9)', stroke: ctx.alpha('lime', 0.5), parent: eq });
          ctx.text(1054, 222, 'GENERAL FORM', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: eq });
          ctx.text(1054, 258, 'x_t = α_t · x₀ + σ_t · ε', { size: 22, font: 'mono', weight: 700, color: 'white', parent: eq });
          ctx.para(1054, 300, [
            'ε ~ N(0, I)   same shape as x₀',
            'VP cosine:  α = cos(πt/2), σ = sin(πt/2)',
            'rectified flow:  α = 1 − t, σ = t',
            'SNR(t) = α² / σ²   λ = log SNR',
            'x₀ here: 64×64×3 · in Wan: 16×31×90×160'
          ], { size: 13, font: 'mono', color: 'text', lh: 34, parent: eq });
          ctx.reveal(eq, { from: 'right', delay: 200 });
          /* schedule plots */
          var pl = ctx.group({ parent: g });
          ctx.text(110, 520, 'α_t (signal) and σ_t (noise)', { size: 12, font: 'mono', color: 'dim', parent: pl });
          var a1 = ctx.plot(110, 545, 500, 230, function (t) { return 1 - t; }, { color: 'lime', xLabel: 't', parent: pl });
          var a2 = ctx.plot(110, 545, 500, 230, function (t) { return t; }, { color: 'lime', axes: false, parent: pl });
          var a3 = ctx.plot(110, 545, 500, 230, function (t) { return Math.cos(Math.PI * t / 2); }, { color: 'cyan', axes: false, parent: pl });
          var a4 = ctx.plot(110, 545, 500, 230, function (t) { return Math.sin(Math.PI * t / 2); }, { color: 'cyan', axes: false, parent: pl });
          a2.curve.setAttribute('stroke-dasharray', '6 5'); a4.curve.setAttribute('stroke-dasharray', '6 5');
          ctx.text(630, 560, 'RF α', { size: 12, font: 'mono', color: 'lime', parent: pl });
          ctx.text(630, 584, 'RF σ (dashed)', { size: 12, font: 'mono', color: 'lime', parent: pl });
          ctx.text(630, 616, 'VP α', { size: 12, font: 'mono', color: 'cyan', parent: pl });
          ctx.text(630, 640, 'VP σ (dashed)', { size: 12, font: 'mono', color: 'cyan', parent: pl });
          ctx.text(820, 520, 'log-SNR λ(t) = 2·ln(α/σ)', { size: 12, font: 'mono', color: 'dim', parent: pl });
          var b1 = ctx.plot(820, 545, 440, 230, function (t) { return 2 * Math.log((1 - t) / t); }, { xDomain: [0.02, 0.98], yDomain: [-8, 8], color: 'lime', xLabel: 't', parent: pl });
          ctx.plot(820, 545, 440, 230, function (t) { return 2 * Math.log(1 / Math.tan(Math.PI * t / 2)); }, { xDomain: [0.02, 0.98], yDomain: [-8, 8], color: 'cyan', axes: false, parent: pl });
          ctx.line(820, 660, 1260, 660, { color: 'faint', sw: 1, dash: '3 4', parent: pl });
          ctx.text(1266, 660, 'SNR = 1', { size: 11, font: 'mono', color: 'dim', parent: pl });
          ctx.para(1330, 570, ['both go from', 'pure signal (λ → +∞)', 'to pure noise (λ → −∞);', 'they differ in how', 'time maps to λ'], { size: 12, font: 'mono', color: 'text', lh: 22, parent: pl });
          ctx.reveal(pl, { delay: 600 });
          [a1, a2, a3, a4, b1].forEach(function (p, i) { ctx.reveal(p.curve, { from: 'draw', delay: 700 + i * 150, dur: 900 }); });
          ctx.hud('x_t = (1 − t)·x₀ + t·ε');
          return ctx.wait(300).then(function () {
            return ctx.tween(2600, function (p) {
              ts.forEach(function (t, i) { S.tcur[i] = t * ctx.clamp(p * 1.6 - i * 0.15, 0, 1); paintThumb(i); });
              S.dirty = true;
            }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'What to predict',
        say: 'What exactly should the network predict? Picture the clean sample, the noise sample, and the noisy point between them. Classic diffusion predicts the noise. Others predict the clean sample, or a blend called v. Flow matching predicts the velocity: noise minus data, the direction of the straight line joining them. These targets are interchangeable with simple algebra. What really changes is how the loss is weighted across noise levels.',
        deep: '<div class="eq">ε-pred: ‖ε<sub>θ</sub>(x<sub>t</sub>, t) − ε‖²<br>x₀-pred: ‖x̂<sub>θ</sub>(x<sub>t</sub>, t) − x<sub>0</sub>‖²</div>' +
          '<div class="eq">v-pred (VP): v = α<sub>t</sub> ε − σ<sub>t</sub> x<sub>0</sub><br>flow: v = dx<sub>t</sub>/dt = ε − x<sub>0</sub></div>' +
          '<p>For rectified flow the conversions are exact and linear:</p>' +
          '<div class="eq">x̂<sub>0</sub> = x<sub>t</sub> − t·v̂<br>ε̂ = x<sub>t</sub> + (1 − t)·v̂</div>' +
          '<p>All targets are re-parameterisations of the posterior mean E[x<sub>0</sub> | x<sub>t</sub>], so each loss is another times a weight: ‖v − v̂‖² = ‖ε − ε̂‖² / (1 − t)².</p>' +
          '<ul><li>ε-pred is ill-conditioned near t → 1 (x̂<sub>0</sub> divides by α → 0); x₀-pred near t → 0. v / flow balance both ends.</li>' +
          '<li>In high dimension (d = 7.1 M latent values) ‖ε‖ ≈ √d and ε is almost orthogonal to x₀ (cosine ~ 1/√d ≈ 4×10⁻⁴) — the right-angle picture is literal, and for unit-variance data (‖x₀‖ ≈ ‖ε‖) the VP path is a quarter circle while the flow path is its chord.</li>' +
          '<li>Wan, HunyuanVideo, Movie Gen and SD3 all regress the flow velocity.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = newStage(ctx, S);
          var O = { x: 150, y: 250 }, X = { x: 150, y: 790 }, Ep = { x: 700, y: 250 };
          var geo = ctx.group({ parent: g });
          ctx.text(90, 196, 'GEOMETRY OF ONE TRAINING SAMPLE  (high-dim: ε ⟂ x₀)', { size: 14, font: 'mono', weight: 600, color: 'lime', parent: geo });
          ctx.line(O.x, O.y, X.x, X.y, { color: 'faint', sw: 1, dash: '3 5', parent: geo });
          ctx.line(O.x, O.y, Ep.x, Ep.y, { color: 'faint', sw: 1, dash: '3 5', parent: geo });
          ctx.circle(O.x, O.y, 4, { fill: 'dim', parent: geo });
          ctx.text(O.x - 12, O.y - 6, '0', { size: 13, font: 'mono', color: 'dim', anchor: 'end', parent: geo });
          /* VP quarter-ellipse path */
          var d = '';
          for (var i = 0; i <= 40; i++) {
            var th = Math.PI / 2 * i / 40;
            var px = O.x + Math.cos(th) * (X.x - O.x) + Math.sin(th) * (Ep.x - O.x), py = O.y + Math.cos(th) * (X.y - O.y) + Math.sin(th) * (Ep.y - O.y);
            d += (i ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1);
          }
          S.vpPath = ctx.path(d, { stroke: 'cyan', sw: 1.6, dash: '6 5', parent: geo });
          S.rfPath = ctx.line(X.x, X.y, Ep.x, Ep.y, { color: 'lime', sw: 2, parent: geo });
          ctx.circle(X.x, X.y, 8, { fill: 'lime', parent: geo, glow: true });
          ctx.text(X.x - 14, X.y + 30, 'x₀  (data: the fox latent)', { size: 14, font: 'mono', color: 'lime', parent: geo });
          ctx.circle(Ep.x, Ep.y, 8, { fill: 'white', parent: geo, glow: true });
          ctx.text(Ep.x - 10, Ep.y - 24, 'ε  (noise)', { size: 14, font: 'mono', color: 'white', anchor: 'middle', parent: geo });
          ctx.line(440, 742, 476, 742, { color: 'lime', sw: 2, parent: geo });
          ctx.text(486, 742, 'flow path: straight chord', { size: 12, font: 'mono', color: 'lime', parent: geo });
          ctx.line(440, 768, 476, 768, { color: 'cyan', sw: 1.6, dash: '6 5', parent: geo });
          ctx.text(486, 768, 'VP path: quarter arc', { size: 12, font: 'mono', color: 'cyan', parent: geo });
          ctx.reveal(geo, {});
          ctx.reveal([S.rfPath, S.vpPath], { from: 'draw', delay: 300, stagger: 300 });
          /* moving z_t with arrows */
          S.zg = ctx.group({ parent: g });
          S.aX = ctx.line(0, 0, 0, 0, { color: 'cyan', sw: 2, arrow: true, parent: S.zg });
          S.aE = ctx.line(0, 0, 0, 0, { color: 'dim', sw: 2, arrow: true, parent: S.zg });
          S.aV = ctx.line(0, 0, 0, 0, { color: 'amber', sw: 3, arrow: true, parent: S.zg, glow: true });
          S.zDot = ctx.circle(0, 0, 7, { fill: 'amber', parent: S.zg, glow: true });
          S.zLab = ctx.text(0, 0, '', { size: 14, font: 'mono', weight: 600, color: 'amber', anchor: 'end', parent: S.zg });
          S.lX = ctx.text(0, 0, 'x̂₀-pred', { size: 12, font: 'mono', color: 'cyan', parent: S.zg });
          S.lE = ctx.text(0, 0, 'ε-pred', { size: 12, font: 'mono', color: 'dim', parent: S.zg });
          S.lV = ctx.text(0, 0, 'v = ε − x₀', { size: 13, font: 'mono', weight: 600, color: 'amber', parent: S.zg });
          function setT(t) {
            var zx = X.x + (Ep.x - X.x) * t, zy = X.y + (Ep.y - X.y) * t;
            S.zDot.setAttribute('cx', zx); S.zDot.setAttribute('cy', zy);
            S.zLab.setAttribute('x', zx - 16); S.zLab.setAttribute('y', zy - 14); S.zLab.textContent = 'x_t  t=' + t.toFixed(2);
            [[S.aX, X, 0.82], [S.aE, Ep, 0.82]].forEach(function (a) {
              a[0].setAttribute('x1', zx); a[0].setAttribute('y1', zy);
              a[0].setAttribute('x2', zx + (a[1].x - zx) * a[2]); a[0].setAttribute('y2', zy + (a[1].y - zy) * a[2]);
            });
            var ux = (Ep.x - X.x), uy = (Ep.y - X.y), L = Math.sqrt(ux * ux + uy * uy);
            S.aV.setAttribute('x1', zx + 16); S.aV.setAttribute('y1', zy + 16);
            S.aV.setAttribute('x2', zx + 16 + ux / L * 150); S.aV.setAttribute('y2', zy + 16 + uy / L * 150);
            S.lV.setAttribute('x', zx + 16 + ux / L * 150 + 14); S.lV.setAttribute('y', zy + 30 + uy / L * 150);
            S.lX.setAttribute('x', zx + 10 + (X.x - zx) * 0.4); S.lX.setAttribute('y', zy + (X.y - zy) * 0.4 + 4);
            S.lE.setAttribute('x', zx + (Ep.x - zx) * 0.45 - 20); S.lE.setAttribute('y', zy + (Ep.y - zy) * 0.45 - 40);
          }
          setT(0.55);
          ctx.reveal(S.zg, { delay: 700 });
          /* right: parameterisation table */
          var tb = ctx.group({ parent: g });
          var rows = [
            ['ε-prediction', 'DDPM · SD 1.x', 'ε_θ(x_t, t) ≈ ε', 'dim'],
            ['x₀-prediction', 'early / cascades', 'x̂_θ(x_t, t) ≈ x₀', 'cyan'],
            ['v-prediction', 'VP · Imagen Video', 'v = α_t·ε − σ_t·x₀', 'violet'],
            ['flow velocity', 'SD3 · Wan · Hunyuan', 'v = ε − x₀', 'amber']
          ];
          rows.forEach(function (r, i) {
            var y = 200 + i * 104;
            ctx.rect(860, y, 680, 90, { rx: 10, fill: 'rgba(6,12,24,0.9)', stroke: ctx.alpha(r[3], 0.6), parent: tb });
            ctx.text(882, y + 28, r[0], { size: 17, font: 'display', weight: 700, color: r[3] === 'dim' ? 'white' : r[3], parent: tb });
            ctx.text(1520, y + 28, r[1], { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: tb });
            ctx.text(882, y + 62, r[2], { size: 16, font: 'mono', color: 'text', parent: tb });
          });
          ctx.text(860, 640, 'conversions (rectified flow):', { size: 13, font: 'mono', color: 'dim', parent: tb });
          ctx.text(860, 672, 'x̂₀ = x_t − t·v_θ      ε_θ = x_t + (1 − t)·v_θ', { size: 17, font: 'mono', weight: 600, color: 'white', parent: tb });
          ctx.text(860, 716, 'same optimum E[x₀ | x_t], different loss weight:', { size: 13, font: 'mono', color: 'dim', parent: tb });
          ctx.text(860, 748, '‖v − v_θ‖² = ‖ε − ε_θ‖² / (1 − t)²', { size: 17, font: 'mono', weight: 600, color: 'amber', parent: tb });
          ctx.reveal(tb, { from: 'right', delay: 400 });
          ctx.hud('flow target: v = ε − x₀');
          return ctx.wait(1300).then(function () {
            return ctx.tween(3600, function (p) {
              setT(ctx.clamp(0.55 + 0.38 * Math.sin(2 * Math.PI * p), 0.1, 0.95));
            }, 'linear');
          }).then(function () { setT(0.55); });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Flow in 2D',
        say: 'Now watch flow matching in two dimensions. Every dot starts as a sample from a standard Gaussian. The velocity field, which a real model learns and which here we compute exactly from the data, tells each dot where to move at each moment. As time runs from one to zero, the cloud splits and streams into the two moons. Each training pair follows a straight line, but the average field bends, because trajectories of an ordinary differential equation can never cross.',
        deep: '<div class="eq">L<sub>CFM</sub>(θ) = E<sub>t, x₀, ε</sub> ‖ v<sub>θ</sub>((1 − t)x<sub>0</sub> + tε, t) − (ε − x<sub>0</sub>) ‖²</div>' +
          '<p>The minimiser is the <b>marginal velocity</b>:</p>' +
          '<div class="eq">v*(z, t) = E[ε − x<sub>0</sub> | x<sub>t</sub> = z] = ( z − E[x<sub>0</sub> | x<sub>t</sub> = z] ) / t</div>' +
          '<p>Lipman et al. prove the per-sample (conditional) loss has the same gradients as regressing the intractable marginal field, which is why training is simulation-free.</p>' +
          '<p>In this toy (M = 160 points) the posterior mean is an exact softmax over the dataset:</p>' +
          '<div class="eq">E[x<sub>0</sub> | z] = Σ<sub>i</sub> w<sub>i</sub> x<sub>i</sub>,   w<sub>i</sub> ∝ exp( −‖z − (1 − t)x<sub>i</sub>‖² / 2t² )</div>' +
          '<pre>z = randn(500, 2)\nfor k in range(40):          # t: 1 → 0\n    t, tn = 1 - k/40, 1 - (k+1)/40\n    z = z + (tn - t) * v(z, t)</pre>' +
          '<div class="note">This exact field memorises the 160 points; a neural v<sub>θ</sub> is smoother and generalises. Dots are coloured by the moon they end on — the Gaussian is partitioned into two basins.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var g = newStage(ctx, S);
          var P = { x: 80, y: 196, s: 650 };
          S.P3 = P;
          panelFrame(ctx, g, P, 'N(0, I)  →  two moons · 500 particles · 40 Euler steps', 'lime');
          S.tr3 = simulate(S.fieldAll, S.init, 40, false);
          var fin = S.tr3[40];
          S.col3 = [];
          for (var i = 0; i < 500; i++) S.col3.push(nearest(S.data, fin[2 * i], fin[2 * i + 1])[1] ? 0 : 1);
          S.p3 = 0;
          S.q3 = {};
          var cur = new Float32Array(1000);
          addLayer(S, function (c2) {
            c2.save(); clipPanel(c2, P);
            drawData(c2, P, S.data, 0.35);
            var st = posAt(S.tr3, S.p3, cur);
            var t = Math.max(0.02, 1 - S.p3);
            var key = Math.round(t * 40);
            if (!S.q3[key]) {
              var arr = [], tq = Math.max(0.03, key / 40);
              for (var a = -3; a <= 3; a += 0.5) for (var b = -3; b <= 3; b += 0.5) { var v = S.fieldAll(a, b, tq); arr.push([a, b, v[0], v[1]]); }
              S.q3[key] = arr;
            }
            c2.strokeStyle = 'rgba(255,191,58,0.45)'; c2.lineWidth = 1.2; c2.beginPath();
            S.q3[key].forEach(function (q) {
              var m = Math.sqrt(q[2] * q[2] + q[3] * q[3]) || 1, p0 = toPx(P, q[0], q[1]);
              var dx = -q[2] / m * 12, dy = q[3] / m * 12;
              c2.moveTo(p0[0], p0[1]); c2.lineTo(p0[0] + dx, p0[1] + dy);
              c2.lineTo(p0[0] + dx * 0.6 - dy * 0.25, p0[1] + dy * 0.6 + dx * 0.25);
            });
            c2.stroke();
            drawTrails(c2, P, S.tr3, st, cur, 90, 'rgba(232,241,255,0.16)');
            drawDots(c2, P, cur, S.col3, ['#8dff5a', '#22e4ff'], 2.6);
            c2.restore();
          });
          /* right column */
          var R = ctx.group({ parent: g });
          ctx.text(790, 210, 'PROBABILITY FLOW ODE', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: R });
          ctx.text(790, 246, 'dz/dt = v_θ(z, t),   t: 1 → 0', { size: 20, font: 'mono', weight: 700, color: 'white', parent: R });
          ctx.text(790, 296, 'MARGINAL VELOCITY (what v_θ converges to)', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: R });
          ctx.text(790, 330, 'v*(z, t) = ( z − E[x₀ | x_t = z] ) / t', { size: 18, font: 'mono', color: 'amber', parent: R });
          ctx.text(790, 380, 'TRAINING (conditional flow matching)', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: R });
          ctx.para(790, 412, [
            'sample x₀ ~ data, ε ~ N(0, I), t ~ p(t)',
            'regress v_θ((1−t)x₀ + tε, t) onto ε − x₀',
            'no simulation, no ODE solve during training'
          ], { size: 14, font: 'mono', color: 'text', lh: 26, parent: R });
          S.t3 = ctx.text(790, 530, 't = 1.000', { size: 30, font: 'mono', weight: 700, color: 'lime', parent: R });
          ctx.text(790, 566, 'amber arrows: velocity field at the current t', { size: 13, font: 'mono', color: 'amber', parent: R });
          ctx.text(790, 592, 'white trails: 90 particle trajectories', { size: 13, font: 'mono', color: 'dim', parent: R });
          ctx.circle(796, 618, 5, { fill: 'lime', parent: R });
          ctx.text(810, 618, 'ends on the upper moon', { size: 13, font: 'mono', color: 'lime', parent: R });
          ctx.circle(1066, 618, 5, { fill: 'cyan', parent: R });
          ctx.text(1080, 618, 'ends on the lower moon', { size: 13, font: 'mono', color: 'cyan', parent: R });
          ctx.rect(790, 660, 740, 150, { rx: 10, fill: ctx.alpha('lime', 0.06), stroke: ctx.alpha('lime', 0.4), parent: R });
          ctx.para(812, 692, [
            'Each (x₀, ε) pair moves on a straight line, but many pairs',
            'pass through the same z. The field averages them, and ODE',
            'trajectories cannot cross, so marginal paths curve.',
            'Curvature is exactly what makes few-step sampling hard.'
          ], { size: 14, font: 'mono', color: 'text', lh: 26, parent: R });
          ctx.reveal(R, { from: 'right' });
          ctx.hud('500 particles · exact marginal field · 40 steps');
          return ctx.wait(600).then(function () {
            return ctx.tween(5200, function (p) {
              S.p3 = p; S.dirty = true;
              S.t3.textContent = 't = ' + (1 - p).toFixed(3);
            }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Solving the ODE',
        say: 'Sampling means solving this ordinary differential equation numerically, and the number of steps matters. With only four Euler steps, the dots follow straight chords instead of curves, and land on averages in the empty space between the moons. In a video model, that is what blurry, melting motion looks like in latent space. Heun\'s second order method corrects for curvature at the cost of extra evaluations, and thirty two steps track the field closely.',
        deep: '<p><b>Euler</b> (1 network evaluation, NFE, per step), local error O(h²), global O(h):</p>' +
          '<div class="eq">z<sub>i+1</sub> = z<sub>i</sub> + h · v<sub>θ</sub>(z<sub>i</sub>, t<sub>i</sub>),   h = t<sub>i+1</sub> − t<sub>i</sub> &lt; 0</div>' +
          '<p><b>Heun</b> (2 NFE per step, last step Euler as in EDM), global O(h²):</p>' +
          '<div class="eq">z̃ = z<sub>i</sub> + h·v(z<sub>i</sub>, t<sub>i</sub>)<br>z<sub>i+1</sub> =z<sub>i</sub> + (h/2)·( v(z<sub>i</sub>, t<sub>i</sub>) + v(z̃, t<sub>i+1</sub>) )</div>' +
          '<p>Why few steps blur: the final Euler step from t lands exactly on E[x<sub>0</sub> | x<sub>t</sub>] — a <i>conditional mean</i>. When the posterior is still multi-modal (fox turns left <i>or</i> right), the mean is a ghostly average. In video this shows up as smeared limbs and morphing objects.</p>' +
          '<ul><li>Multistep solvers (DPM-Solver++, UniPC) reuse past velocities for 2nd–3rd order at 1 NFE/step; production video uses 30–50 steps of Euler/UniPC with a shifted schedule.</li>' +
          '<li>The bottom numbers are computed live from this toy: mean distance of the 500 samples to the nearest data point.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = newStage(ctx, S);
          var cfg = [
            { n: 4, heun: false, name: 'Euler · 4 steps', nfe: 4, col: 'red' },
            { n: 4, heun: true, name: 'Heun · 4 steps', nfe: 7, col: 'amber' },
            { n: 32, heun: false, name: 'Euler · 32 steps', nfe: 32, col: 'lime' }
          ];
          S.P4 = [];
          cfg.forEach(function (c, i) {
            var P = { x: 80 + i * 505, y: 206, s: 430 };
            S.P4.push(P);
            panelFrame(ctx, g, P, c.name + '  (NFE ' + c.nfe + ')', c.col);
            c.traj = simulate(S.fieldAll, S.init, c.n, c.heun);
            var fin = c.traj[c.n], err = 0;
            c.cols = [];
            for (var p = 0; p < 500; p++) { var nn = nearest(S.data, fin[2 * p], fin[2 * p + 1]); err += nn[0] / 500; c.cols.push(nn[0] > 0.25 ? 2 : (nn[1] ? 0 : 1)); }
            c.err = err;
          });
          S.cfg4 = cfg;
          S.tr4 = cfg[2].traj;
          S.p4 = 0;
          var cur = new Float32Array(1000);
          addLayer(S, function (c2) {
            cfg.forEach(function (c, i) {
              var P = S.P4[i];
              c2.save(); clipPanel(c2, P);
              drawData(c2, P, S.data, 0.4);
              var st = posAt(c.traj, S.p4, cur);
              drawTrails(c2, P, c.traj, st, cur, 60, 'rgba(232,241,255,0.2)');
              drawDots(c2, P, cur, c.cols, ['#8dff5a', '#22e4ff', '#ff4d6d'], 2.2);
              c2.restore();
            });
          });
          /* bottom: measured error + explanation */
          var B = ctx.group({ parent: g });
          ctx.text(80, 690, 'MEASURED ON THIS TOY · mean distance of samples to the data manifold', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 1, parent: B });
          var maxE = Math.max(cfg[0].err, cfg[1].err, cfg[2].err);
          S.eBars = cfg.map(function (c, i) {
            var y = 712 + i * 44;
            ctx.text(290, y + 14, c.name, { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: B });
            var b = ctx.rect(304, y, 420 * c.err / maxE, 28, { rx: 4, fill: ctx.alpha(c.col, 0.45), stroke: c.col, sw: 1, parent: B });
            ctx.text(304 + 420 * c.err / maxE + 10, y + 14, c.err.toFixed(3), { size: 13, font: 'mono', color: c.col, parent: B });
            return b;
          });
          ctx.circle(880, 712, 5, { fill: 'red', parent: B });
          ctx.text(894, 712, 'red: landed off the moons (> 0.25 from any data point)', { size: 13, font: 'mono', color: 'red', parent: B });
          ctx.para(870, 750, [
            'last Euler step lands on E[x₀ | x_t]: an average of modes',
            'Heun: z̃ = z + h·v(z,t);  z ← z + h/2·(v(z,t) + v(z̃,t′))',
            'video models: 30–50 steps (Euler / UniPC) or a distilled student'
          ], { size: 13, font: 'mono', color: 'text', lh: 28, parent: B });
          ctx.reveal(B, { delay: 300 });
          S.eBars.forEach(function (b, i) {
            var w = parseFloat(b.getAttribute('width'));
            b.setAttribute('width', 0);
            ctx.animate(b, { width: [0, w] }, 700, 'out', 4200 + i * 200);
          });
          ctx.hud('same field, different solvers');
          return ctx.wait(500).then(function () {
            return ctx.tween(4200, function (p) { S.p4 = p; S.dirty = true; }, 'inOut');
          }).then(function () { return ctx.wait(800); });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Coarse to fine',
        say: 'The same process in pixels. On the left is the state the sampler holds. On the right is the model\'s current guess of the final image, available for free as the state minus t times the velocity. At high noise the best guess is a blurry average, so layout and colour are decided first: the glowing moon, the horizon, a warm shape where the fox will stand. Fine detail, like the helmet rim and the eyes, only appears in the last steps.',
        deep: '<p><b>Why coarse-to-fine?</b> Natural images have a power spectrum S(f) ∝ 1/f<sup>≈2</sup>; Gaussian noise is white. For x<sub>t</sub> = αx<sub>0</sub> + σε the optimal linear denoiser is a Wiener filter:</p>' +
          '<div class="eq">Ĥ(f) = α·S(f) / ( α²·S(f) + σ² )</div>' +
          '<p>A frequency is recoverable only while α²S(f) ≳ σ², so as t grows the cut-off slides to lower frequencies. Reverse sampling therefore generates low frequencies (layout, colour, camera path) first and high frequencies (texture, fur, helmet rim) last — sometimes called <i>spectral autoregression</i>.</p>' +
          '<p>Here x̂<sub>0</sub> is modelled as that low-pass posterior mean; the left image is the actual Euler state z<sub>i+1</sub> = z<sub>i</sub> + h·(z<sub>i</sub> − x̂<sub>0</sub>)/t<sub>i</sub>.</p>' +
          '<ul><li><b>Previews</b>: decoding x̂<sub>0</sub> at a few steps gives the creator a live, progressively sharpening preview at almost no cost.</li>' +
          '<li><b>Caching</b>: consecutive steps change mostly high-frequency content late in sampling, so step-caching methods (e.g. TeaCache, FasterCache) reuse block outputs between nearby steps.</li>' +
          '<li><b>Guidance interval</b>: CFG matters most in the middle band of noise levels.</li></ul>',
        run: function (ctx) {
          var S = ctx.state, I = S.img;
          var g = newStage(ctx, S);
          var n = 30, shift = 3;
          function tOf(i) { var u = 1 - i / n; return shift * u / (1 + (shift - 1) * u); }
          /* precompute sampler states */
          var z = Float32Array.from(I.E), xh = new Float32Array(z.length);
          S.states5 = [Float32Array.from(z)]; S.xh5 = [];
          for (var i = 0; i < n; i++) {
            var t = tOf(i), tn = tOf(i + 1);
            xhatImg(S, t, xh);
            S.xh5.push(Float32Array.from(xh));
            for (var k = 0; k < z.length; k++) z[k] = z[k] + (tn - t) * (z[k] - xh[k]) / t;
            S.states5.push(Float32Array.from(z));
          }
          S.xh5.push(Float32Array.from(I.X0));
          S.bZ = newBuf(); S.bX = newBuf();
          paintArr(S.bZ, S.states5[0]); paintArr(S.bX, S.xh5[0]);
          var snapIdx = [0, 6, 12, 18, 24, 30];
          S.snaps = snapIdx.map(function () { return null; });
          S.i5 = 0;
          addLayer(S, function (c2) {
            drawBuf(c2, S.bZ, 90, 216, 300, 'rgba(123,140,171,0.7)');
            drawBuf(c2, S.bX, 440, 216, 300, 'rgba(141,255,90,0.8)');
            S.snaps.forEach(function (b, j) { if (b) drawBuf(c2, b, 90 + j * 110, 610, 96, 'rgba(141,255,90,0.5)'); });
          });
          ctx.text(90, 198, 'z_t · sampler state', { size: 13, font: 'mono', weight: 600, color: 'dim', parent: g });
          ctx.text(440, 198, 'x̂₀ = z_t − t·v  · model guess', { size: 13, font: 'mono', weight: 600, color: 'lime', parent: g });
          S.r5 = ctx.text(90, 548, 'step 0 / 30 · t = 1.000', { size: 18, font: 'mono', weight: 700, color: 'lime', parent: g });
          ctx.text(90, 586, 'x̂₀ snapshots', { size: 12, font: 'mono', color: 'dim', parent: g });
          snapIdx.forEach(function (si, j) { ctx.text(138 + j * 110, 724, 't=' + tOf(si).toFixed(2), { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g }); });
          /* right: explanation + spectrum plot */
          var R = ctx.group({ parent: g });
          ctx.text(820, 210, 'WHY LAYOUT COMES FIRST', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: R });
          ctx.text(820, 246, 'Ĥ(f) = α·S(f) / (α²·S(f) + σ²)', { size: 20, font: 'mono', weight: 700, color: 'white', parent: R });
          ctx.text(820, 280, 'image power S(f) ∝ 1/f²   ·   noise power σ² (flat)', { size: 13, font: 'mono', color: 'text', parent: R });
          var PL = { x: 850, y: 320, w: 600, h: 230 };
          ctx.plot(PL.x, PL.y, PL.w, PL.h, function (lf) { return 1 - 2 * lf; }, { xDomain: [0, 2.2], yDomain: [-5, 1], color: 'violet', sw: 2.2, xLabel: 'log₁₀ f  →  fine detail', yLabel: 'log power', parent: R });
          [0.5, 0.25, 0.1].forEach(function (tg) {
            var lv = Math.log(tg * tg / ((1 - tg) * (1 - tg))) / Math.LN10, yy = PL.y + PL.h * (1 - (lv + 5) / 6);
            ctx.line(PL.x, yy, PL.x + PL.w, yy, { color: ctx.alpha('red', 0.25), sw: 1, dash: '2 5', parent: R });
            ctx.text(PL.x + 8, yy - 8, 't=' + tg, { size: 11, font: 'mono', color: ctx.alpha('red', 0.7), parent: R });
          });
          S.noiseLine = ctx.line(PL.x, PL.y + PL.h * 0.5, PL.x + PL.w, PL.y + PL.h * 0.5, { color: 'red', sw: 2, dash: '6 4', parent: R });
          S.cut = ctx.line(PL.x, PL.y, PL.x, PL.y + PL.h, { color: 'lime', sw: 1.5, parent: R });
          S.cutL = ctx.text(PL.x + 8, PL.y + 14, '', { size: 12, font: 'mono', color: 'lime', parent: R });
          ctx.text(PL.x + 200, PL.y + 24, 'image spectrum S(f)', { size: 12, font: 'mono', color: 'violet', parent: R });
          S.nlab = ctx.text(PL.x + PL.w - 4, PL.y + PL.h * 0.5 - 12, 'noise floor σ²', { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: R });
          ctx.para(820, 606, [
            'frequencies above the noise floor survive; as t → 0',
            'the floor drops and finer detail becomes determinable.',
            'Video: first ~30% of steps fix composition and motion,',
            'the rest add texture — the basis for previews, step',
            'caching and guidance intervals.'
          ], { size: 14, font: 'mono', color: 'text', lh: 26, parent: R });
          ctx.reveal(R, { from: 'right' });
          ctx.hud('x̂₀ preview is free at every step');
          function setStep(i) {
            var t = tOf(Math.min(i, n));
            paintArr(S.bZ, S.states5[i]);
            paintArr(S.bX, S.xh5[i]);
            snapIdx.forEach(function (si, j) { if (i >= si && !S.snaps[j]) { S.snaps[j] = newBuf(); paintArr(S.snaps[j], S.xh5[si]); } });
            S.r5.textContent = 'step ' + i + ' / ' + n + ' · t = ' + t.toFixed(3);
            /* noise floor in log power: log10(sigma^2/alpha^2) mapped on [-5,1] */
            var a = Math.max(1e-3, 1 - t), sg = Math.max(1e-3, t);
            var lvl = ctx.clamp(Math.log(sg * sg / (a * a)) / Math.LN10, -5, 1);
            var y = PL.y + PL.h * (1 - (lvl + 5) / 6);
            S.noiseLine.setAttribute('y1', y); S.noiseLine.setAttribute('y2', y);
            S.nlab.setAttribute('y', y - 12);
            var fc = ctx.clamp((1 - lvl) / 2, 0, 2.2), x = PL.x + PL.w * fc / 2.2;
            S.cut.setAttribute('x1', x); S.cut.setAttribute('x2', x);
            var nearR = x > PL.x + PL.w - 140;
            S.cutL.setAttribute('x', nearR ? x - 8 : x + 8);
            S.cutL.setAttribute('text-anchor', nearR ? 'end' : 'start');
            S.cutL.textContent = nearR ? 'all recoverable' : '← recoverable';
            S.dirty = true;
          }
          setStep(0);
          return ctx.wait(700).then(function () {
            return ctx.tween(5200, function (p) {
              var i = Math.min(n, Math.floor(p * n + 1e-6));
              if (i !== S.i5 || p >= 1) { S.i5 = i; setStep(i); }
            }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Where to spend steps',
        say: 'Where should training and sampling spend their effort? Stable Diffusion three found that drawing training times from a logit normal distribution, which concentrates on the middle of the path, beats uniform sampling. And at high resolution, neighbouring pixels are so redundant that moderate noise barely hides the image. So the schedule is shifted toward high noise, with a shift of about three for one megapixel images and about five to seven for seven twenty p video.',
        deep: '<p><b>Logit-normal training times</b> (in SD3’s large sweep of diffusion and flow formulations, rectified flow with lognorm(0, 1) ranked best on average):</p>' +
          '<div class="eq">t = sigmoid(u),  u ~ N(m, s²)<br>π(t) =1 / (s√(2π)) · 1 / (t(1 − t)) · exp( −(logit t − m)² / 2s² )</div>' +
          '<p>Endpoints are easy (t ≈ 0: nearly identity; t ≈ 1: predict the data mean); the middle, where the posterior is genuinely multi-modal, carries the learning signal.</p>' +
          '<p><b>Resolution-dependent shift.</b> Averaging n correlated pixels reduces effective noise by ~√n, so the same σ destroys less at high resolution. SD3 maps timesteps between token counts m and n with α = √(m/n):</p>' +
          '<div class="eq">t<sub>m</sub> = α·t<sub>n</sub> / ( 1 + (α − 1)·t<sub>n</sub> )</div>' +
          '<table><tr><th>Model</th><th>Resolution</th><th>shift</th></tr>' +
          '<tr><td>SD3</td><td>1024²</td><td>3.0</td></tr>' +
          '<tr><td>Wan 2.1 T2V-14B</td><td>1280×720</td><td>5.0</td></tr>' +
          '<tr><td>HunyuanVideo</td><td>1280×720</td><td>≈ 7</td></tr></table>' +
          '<div class="note">Video models also shift with duration: more frames = more redundant tokens = more shift. Many implementations compute the shift from the token count directly (e.g. Flux-style “dynamic shifting”).</div>',
        run: function (ctx) {
          var S = ctx.state;
          var g = newStage(ctx, S);
          /* left: logit-normal histogram */
          ctx.text(100, 200, 'TRAINING: which t to sample?', { size: 14, font: 'mono', weight: 600, color: 'lime', parent: g });
          var rng = ctx.rng(5), bins = 24, cnt = [], NS = 6000;
          for (var b = 0; b < bins; b++) cnt.push(0);
          for (var i = 0; i < NS; i++) { var t = 1 / (1 + Math.exp(-gauss(rng))); cnt[Math.min(bins - 1, Math.floor(t * bins))]++; }
          var dens = cnt.map(function (c) { return c / NS * bins / 1.8; });
          S.hist = ctx.bars(110, 240, 600, 300, dens.map(function () { return 0; }), { color: 'lime', gap: 3, parent: g });
          var ln = ctx.plot(110, 240, 600, 300, function (t) {
            if (t <= 0.001 || t >= 0.999) return 0;
            var l = Math.log(t / (1 - t));
            return Math.exp(-l * l / 2) / Math.sqrt(2 * Math.PI) / (t * (1 - t));
          }, { xDomain: [0, 1], yDomain: [0, 1.8], color: 'amber', sw: 2.5, axes: false, samples: 200, parent: g });
          ctx.plot(110, 240, 600, 300, function () { return 1; }, { xDomain: [0, 1], yDomain: [0, 1.8], color: 'dim', sw: 1.5, axes: false, parent: g }).curve.setAttribute('stroke-dasharray', '6 5');
          ctx.text(110, 560, '0', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          ctx.text(410, 560, 't', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          ctx.text(710, 560, '1', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          ctx.text(560, 250, 'logit-normal(0, 1)', { size: 13, font: 'mono', color: 'amber', parent: g });
          ctx.text(118, 356, 'uniform U(0, 1)', { size: 13, font: 'mono', color: 'dim', parent: g });
          ctx.reveal(ln.curve, { from: 'draw', delay: 300, dur: 1200 });
          /* right: shift curves */
          ctx.text(880, 200, 'SAMPLING: shifted schedule t′ = s·t / (1 + (s − 1)·t)', { size: 14, font: 'mono', weight: 600, color: 'lime', parent: g });
          var sh = [[1, 'dim', 's = 1 · 256² image'], [3, 'cyan', 's = 3 · SD3 1024²'], [5, 'lime', 's = 5 · Wan 720p'], [7, 'amber', 's = 7 · HunyuanVideo 720p']];
          sh.forEach(function (s, i) {
            var p = ctx.plot(900, 240, 380, 300, function (t) { return s[0] * t / (1 + (s[0] - 1) * t); }, { color: s[1], sw: 2.2, axes: i === 0, xLabel: i === 0 ? 't (uniform grid)' : null, yLabel: i === 0 ? 't′' : null, parent: g });
            ctx.reveal(p.curve, { from: 'draw', delay: 500 + i * 250, dur: 900 });
            ctx.text(1300, 270 + i * 34, s[2], { size: 13, font: 'mono', color: s[1], parent: g });
          });
          S.ticks6 = ctx.group({ parent: g });
          ctx.text(1300, 430, '50 steps at s = 5:', { size: 12, font: 'mono', color: 'dim', parent: g });
          for (var k = 0; k <= 50; k++) {
            var u = k / 50, tp = 5 * u / (1 + 4 * u);
            ctx.line(1300 + tp * 230, 450, 1300 + tp * 230, 470, { color: ctx.alpha('lime', 0.8), sw: 1, parent: S.ticks6 });
          }
          ctx.text(1300, 488, 't = 0', { size: 11, font: 'mono', color: 'dim', parent: g });
          ctx.text(1530, 488, '1', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
          ctx.text(1300, 512, 'dense near high noise', { size: 12, font: 'mono', color: 'lime', parent: g });
          ctx.reveal(S.ticks6, { delay: 1500 });
          /* bottom: resolution argument */
          var bt = ctx.group({ parent: g });
          ctx.rect(100, 610, 1440, 230, { rx: 12, fill: 'rgba(6,12,24,0.9)', stroke: ctx.alpha('lime', 0.4), parent: bt });
          ctx.text(128, 642, 'WHY SHIFT WITH RESOLUTION', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: bt });
          ctx.para(128, 676, [
            'Averaging n neighbouring pixels (all ≈ the same colour) cuts the noise std by √n while the signal stays:',
            'a 4× larger image at the same σ still reveals its low frequencies. To destroy the same information,',
            'push t toward 1:  t_m = α·t_n / (1 + (α − 1)·t_n),  α = √(m / n)  (m, n = token counts).',
            'Our 720p clip has 111,600 tokens vs 4,096 for a 1024² SD3 image (after 2×2 patches): long videos need big shifts.'
          ], { size: 14, font: 'mono', color: 'text', lh: 34, parent: bt });
          ctx.reveal(bt, { from: 'up', delay: 600 });
          ctx.hud('train on the middle · sample with a shift');
          return ctx.wait(300).then(function () { return S.hist.update(dens, 1800); });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Classifier-free guidance',
        say: 'Classifier free guidance trades diversity for prompt adherence. Here the condition asks for the upper moon only. With guidance one, samples follow the true conditional distribution, including a few stragglers. With guidance six, the sampler extrapolates away from the unconditional prediction: every dot is pushed hard onto the upper moon, clumping toward its extremes. In video, high guidance means crisp prompt following, but also oversaturated colour, less variety, and sometimes frozen motion.',
        deep: '<div class="eq">v<sub>w</sub>(z, t) = v<sub>θ</sub>(z, t, ∅) + w · ( v<sub>θ</sub>(z, t, c) − v<sub>θ</sub>(z, t, ∅) )</div>' +
          '<p>In score form this is ∇log p(x) + w·∇log p(c | x): approximately sampling from p(x)·p(c|x)<sup>w</sup>, a sharpened conditional (only approximately, because guided fields at different t are not marginals of one distribution).</p>' +
          '<ul><li><b>Training</b>: drop the condition ~10% of the time so one network learns both fields.</li>' +
          '<li><b>Cost</b>: 2 NFE per step (batched cond/uncond, or split across GPUs = CFG parallelism).</li>' +
          '<li><b>Video practice</b>: Wan 2.1 w = 5; I2V often uses separate text and image scales; the negative prompt replaces ∅ (“blurry, static, distorted…”).</li>' +
          '<li><b>Failure modes</b>: oversaturation, low diversity, off-manifold artifacts at high w. Fixes: CFG-rescale, APG (drop the parallel component), guidance only in a middle t-interval (Kynkäänniemi et al. 2024), CFG-Zero*.</li>' +
          '<li><b>Guidance distillation</b> bakes w into a student that needs 1 NFE per step.</li></ul>' +
          '<div class="note">The toy uses exact fields: v<sub>c</sub> from the upper-moon points plus ~15% mislabelled lower-moon points (like noisy captions), v<sub>∅</sub> from all points. The on-target percentages are computed live. The image pair on the right is illustrative (contrast/saturation push), not a model output.</div>',
        run: function (ctx) {
          var S = ctx.state, I = S.img;
          var g = newStage(ctx, S);
          var fu = S.fieldAll, fc = S.fieldUp;
          function guided(w) { return function (a, b, t) { var u = fu(a, b, t), c = fc(a, b, t); return [u[0] + w * (c[0] - u[0]), u[1] + w * (c[1] - u[1])]; }; }
          var cfgs = [{ w: 1, col: 'cyan' }, { w: 6, col: 'amber' }];
          S.P7 = [];
          cfgs.forEach(function (c, i) {
            var P = { x: 80 + i * 480, y: 206, s: 440 };
            S.P7.push(P);
            panelFrame(ctx, g, P, 'w = ' + c.w + (c.w === 1 ? '  (no extrapolation)' : '  (strong guidance)'), c.col);
            c.traj = simulate(guided(c.w), S.init, 24, false);
            var fin = c.traj[24];
            c.cols = []; var on = 0;
            for (var p = 0; p < 500; p++) { var nn = nearest(S.data, fin[2 * p], fin[2 * p + 1]); var ok = nn[1] === 1 && nn[0] < 0.25; if (ok) on++; c.cols.push(ok ? 0 : 1); }
            c.frac = on / 500;
          });
          S.cfg7 = cfgs;
          S.p7 = 0;
          S.bW1 = newBuf(); S.bW6 = newBuf();
          paintArr(S.bW1, I.X0);
          var sat = new Float32Array(I.X0.length);
          for (var k = 0; k < sat.length; k += 3) {
            var l = (I.X0[k] + I.X0[k + 1] + I.X0[k + 2]) / 3;
            for (var ch = 0; ch < 3; ch++) sat[k + ch] = ctx.clamp(0.15 + 1.9 * (l + 1.6 * (I.X0[k + ch] - l)), -1, 1);
          }
          paintArr(S.bW6, sat);
          var cur = new Float32Array(1000);
          addLayer(S, function (c2) {
            cfgs.forEach(function (c, i) {
              var P = S.P7[i];
              c2.save(); clipPanel(c2, P);
              drawData(c2, P, S.data, 0.18, 0);
              drawData(c2, P, S.data, 0.6, 1);
              var st = posAt(c.traj, S.p7, cur);
              drawTrails(c2, P, c.traj, st, cur, 50, 'rgba(232,241,255,0.16)');
              drawDots(c2, P, cur, c.cols, ['#8dff5a', '#ff7eb6'], 2.3);
              c2.restore();
            });
            drawBuf(c2, S.bW1, 1070, 470, 180, 'rgba(34,228,255,0.8)');
            drawBuf(c2, S.bW6, 1310, 470, 180, 'rgba(255,191,58,0.8)');
          });
          /* right: equation */
          var R = ctx.group({ parent: g });
          ctx.text(1060, 210, 'GUIDED VELOCITY', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: R });
          ctx.text(1060, 246, 'v = v∅ + w·(v_c − v∅)', { size: 24, font: 'mono', weight: 700, color: 'white', parent: R });
          ctx.para(1060, 290, [
            'c = "upper moon" (think: "fox")',
            '∅ = empty / negative prompt',
            '2 network evaluations per step'
          ], { size: 14, font: 'mono', color: 'text', lh: 26, parent: R });
          S.frac7 = ctx.text(1060, 390, '', { size: 14, font: 'mono', color: 'lime', parent: R });
          S.frac7b = ctx.text(1060, 416, '', { size: 14, font: 'mono', color: 'amber', parent: R });
          ctx.text(1160, 668, 'w ≈ 1', { size: 13, font: 'mono', color: 'cyan', anchor: 'middle', parent: R });
          ctx.text(1400, 668, 'high w (illustrative)', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', parent: R });
          ctx.reveal(R, { from: 'right' });
          var B = ctx.group({ parent: g });
          ctx.para(80, 700, [
            'green: sample on the conditioned (upper) moon   ·   pink: straggler elsewhere',
            'w = 6 sharpens p(x)·p(c|x)^w: near-perfect adherence, but samples clump and diversity collapses',
            'fixes: guidance interval (mid-t only), CFG-rescale / APG, CFG-Zero*, or distill the guidance into the student'
          ], { size: 14, font: 'mono', color: 'text', lh: 32, parent: B });
          ctx.reveal(B, { delay: 500 });
          ctx.hud('CFG: 2× compute per step');
          return ctx.wait(500).then(function () {
            return ctx.tween(4200, function (p) { S.p7 = p; S.dirty = true; }, 'inOut');
          }).then(function () {
            S.frac7.textContent = 'w = 1: ' + Math.round(cfgs[0].frac * 100) + '% of samples on target';
            S.frac7b.textContent = 'w = 6: ' + Math.round(cfgs[1].frac * 100) + '% on target, far less spread';
            return ctx.reveal([S.frac7, S.frac7b], { stagger: 200 });
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Few-step distillation',
        say: 'Fifty steps with guidance means one hundred network evaluations per clip, about an H100 hour. Distillation compresses that. Reflow retrains on its own noise and output pairs, so paths become nearly straight and one or two Euler steps suffice. Consistency models learn to jump from any point on a trajectory straight to its end. Distribution matching and adversarial training teach a four step student to match the teacher\'s outputs. Production video models now ship four to eight step students.',
        deep: '<table><tr><th>Family</th><th>Objective (sketch)</th><th>Steps</th></tr>' +
          '<tr><td>Reflow (Rectified Flow, InstaFlow)</td><td>retrain on couplings (ε, Φ<sub>teacher</sub>(ε)) → straight paths</td><td>1–2</td></tr>' +
          '<tr><td>Consistency (CM, LCM, sCM)</td><td>f<sub>θ</sub>(x<sub>t</sub>, t) = f<sub>θ⁻</sub>(x<sub>t′</sub>, t′) along one ODE path, f(x, 0) = x</td><td>1–4</td></tr>' +
          '<tr><td>DMD / DMD2</td><td>min KL(p<sub>student</sub> ‖ p<sub>teacher</sub>) via score difference</td><td>1–4</td></tr>' +
          '<tr><td>Adversarial (ADD, LADD, APT)</td><td>GAN loss, discriminator built from the teacher</td><td>1–4</td></tr></table>' +
          '<div class="eq">∇<sub>θ</sub>KL ≈ E<sub>z,t</sub>[ ( s<sub>fake</sub>(x<sub>t</sub>, t) − s<sub>real</sub>(x<sub>t</sub>, t) ) · ∂G<sub>θ</sub>(z)/∂θ ]</div>' +
          '<p>s<sub>real</sub> = frozen teacher score, s<sub>fake</sub> = a critic diffusion model trained online on student samples.</p>' +
          '<ul><li><b>Video</b>: CausVid distils a bidirectional video DiT into a 4-step causal student with DMD; Seaweed-APT generates 2 s of 1280×720 24 fps video in one step; open 4-step Wan students (DMD / self-forcing) are common in 2025.</li>' +
          '<li><b>Budget</b>: 100 NFE → 4 NFE = 25× → the ~54 H100-min clip drops to ~2 min; 1 NFE ≈ 30 s.</li>' +
          '<li><b>Cost</b>: some diversity loss and occasional artifacts; teams often keep the teacher for “hero” shots and the student for drafts and previews.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = newStage(ctx, S);
          var P = { x: 80, y: 206, s: 500 };
          panelFrame(ctx, g, P, 'reflow: curved teacher paths → straight couplings', 'lime');
          var T = S.tr4, n = T.length - 1, fin = T[n];
          S.p8a = 0; S.p8b = 0;
          var cur = new Float32Array(1000), one = new Float32Array(1000);
          var cols = [];
          for (var i = 0; i < 500; i++) cols.push(nearest(S.data, fin[2 * i], fin[2 * i + 1])[1] ? 0 : 1);
          addLayer(S, function (c2) {
            c2.save(); clipPanel(c2, P);
            drawData(c2, P, S.data, 0.35);
            /* teacher curves */
            var st = posAt(T, S.p8a, cur);
            c2.save();
            c2.globalAlpha = c2.globalAlpha * (1 - 0.6 * S.p8b);
            drawTrails(c2, P, T, st, cur, 120, 'rgba(255,191,58,0.35)');
            c2.restore();
            /* straight couplings + 1-step particles */
            if (S.p8b > 0) {
              c2.strokeStyle = 'rgba(141,255,90,0.35)'; c2.lineWidth = 1; c2.beginPath();
              for (var i2 = 0; i2 < 120; i2++) {
                var a = toPx(P, T[0][2 * i2], T[0][2 * i2 + 1]), e = Math.min(1, S.p8b * 1.4);
                var b = toPx(P, T[0][2 * i2] + (fin[2 * i2] - T[0][2 * i2]) * e, T[0][2 * i2 + 1] + (fin[2 * i2 + 1] - T[0][2 * i2 + 1]) * e);
                c2.moveTo(a[0], a[1]); c2.lineTo(b[0], b[1]);
              }
              c2.stroke();
              var q = ctx.clamp((S.p8b - 0.5) * 2, 0, 1);
              for (var k = 0; k < 1000; k++) one[k] = T[0][k] + (fin[k] - T[0][k]) * q;
              drawDots(c2, P, one, cols, ['#8dff5a', '#22e4ff'], 2.3);
            } else {
              drawDots(c2, P, cur, cols, ['#8dff5a', '#22e4ff'], 2.3);
            }
            c2.restore();
          });
          S.l8 = ctx.text(80, 740, 'teacher: 32 Euler steps along curved paths', { size: 14, font: 'mono', weight: 600, color: 'amber', parent: g });
          ctx.para(80, 776, [
            'reflow trains v_θ on straight lines between each noise',
            'and its teacher output → one Euler step lands exactly',
            '(ideal case; real reflow straightens paths approximately)'
          ], { size: 13, font: 'mono', color: 'text', lh: 24, parent: g });
          /* method cards */
          var cards = [
            ['Reflow / Rectified Flow', 'train on (ε, Φ_teacher(ε)) couplings', 'paths straighten → 1–2 steps', 'lime'],
            ['Consistency models', 'f_θ(x_t, t) = f_θ⁻(x_t′, t′) on one path', 'LCM, sCM → 1–4 steps', 'cyan'],
            ['DMD / DMD2', '∇KL ≈ (s_fake − s_real)·∂G/∂θ', 'CausVid: 4-step causal video', 'violet'],
            ['Adversarial (ADD / APT)', 'GAN loss, teacher-initialised D', 'Seaweed-APT: 1-step 720p', 'pink']
          ];
          S.cards8 = cards.map(function (c, i) {
            var cg = ctx.group({ parent: g });
            var x = 640 + (i % 2) * 455, y = 196 + Math.floor(i / 2) * 150;
            ctx.rect(x, y, 440, 134, { rx: 10, fill: 'rgba(6,12,24,0.9)', stroke: ctx.alpha(c[3], 0.7), sw: 1.3, parent: cg });
            ctx.text(x + 18, y + 30, c[0], { size: 17, font: 'display', weight: 700, color: c[3], parent: cg });
            ctx.text(x + 18, y + 70, c[1], { size: 13, font: 'mono', color: 'text', parent: cg });
            ctx.text(x + 18, y + 102, c[2], { size: 13, font: 'mono', color: 'dim', parent: cg });
            return cg;
          });
          ctx.reveal(S.cards8, { from: 'up', stagger: 150, delay: 300 });
          /* NFE bars */
          var nb = ctx.group({ parent: g });
          ctx.text(640, 530, 'NETWORK EVALUATIONS PER CLIP  ·  wall-clock on 1 H100 (720p, 5 s, 14B)', { size: 12, font: 'mono', weight: 600, color: 'dim', parent: nb });
          var rows = [['teacher 50 steps + CFG', 100, 'amber', '100 NFE · ~54 min'], ['guidance-distilled', 50, 'orange', '50 NFE · ~27 min'], ['4-step student (DMD2)', 4, 'violet', '4 NFE · ~2 min'], ['1-step (APT / reflow)', 1, 'pink', '1 NFE · ~30 s']];
          S.nfe = rows.map(function (r, i) {
            var y = 556 + i * 44;
            ctx.text(870, y + 14, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: nb });
            var b = ctx.rect(884, y, Math.max(3, 420 * r[1] / 100), 28, { rx: 4, fill: ctx.alpha(r[2], 0.45), stroke: r[2], sw: 1, parent: nb });
            ctx.text(884 + Math.max(3, 420 * r[1] / 100) + 10, y + 14, r[3], { size: 13, font: 'mono', color: r[2], parent: nb });
            return b;
          });
          ctx.text(640, 760, 'every NFE is a full 14B forward over 111,600 tokens (≈1.3×10¹⁶ FLOPs)', { size: 13, font: 'mono', color: 'lime', parent: nb });
          ctx.text(640, 790, 'trade-off: some diversity loss; teacher kept for hero shots, student for drafts', { size: 13, font: 'mono', color: 'dim', parent: nb });
          ctx.reveal(nb, { delay: 600 });
          S.nfe.forEach(function (b, i) {
            var w = parseFloat(b.getAttribute('width'));
            b.setAttribute('width', 0);
            ctx.animate(b, { width: [0, w] }, 700, 'out', 900 + i * 200);
          });
          ctx.hud('100 NFE → 4 NFE: 25× cheaper');
          return ctx.wait(400).then(function () {
            return ctx.tween(2600, function (p) { S.p8a = p; S.dirty = true; }, 'inOut');
          }).then(function () {
            S.l8.textContent = 'student: straight couplings, 1 step';
            S.l8.setAttribute('fill', ctx.C.lime);
            return ctx.tween(2600, function (p) { S.p8b = p; S.dirty = true; }, 'inOut');
          });
        }
      }
    ]
  });
})();
