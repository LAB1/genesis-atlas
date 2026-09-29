/* L2 — Diffusion & Flow Matching. Forward noising, prediction targets, rectified-flow ODEs, solvers, CFG and few-step distillation.
 * Beat format: every step is a sequence of beats; each has narration, a callout card, a deep-dive chunk and a gated animation segment.
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
  /* the light theme inverts the whole stage with a CSS filter; photographs must not turn into negatives, so pre-apply the same filter
     to picture pixels (invert + hue-rotate 180 is its own inverse). Reads the theme attribute only; skipped where canvas filters are missing. */
  function isLight() { var r = document.documentElement; return !!r && r.getAttribute('data-theme') === 'light'; }
  function drawBuf(c2, buf, x, y, s, col) {
    c2.imageSmoothingEnabled = false;
    if (isLight() && 'filter' in c2) {
      c2.save(); c2.filter = 'invert(1) hue-rotate(180deg)'; c2.drawImage(buf.c, x, y, s, s); c2.restore();
    } else c2.drawImage(buf.c, x, y, s, s);
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
  /* frame + faint grid of a particle panel; returns the frame group */
  function panelFrame(ctx, parent, P, title, col) {
    var f = ctx.group({ parent: parent });
    ctx.rect(P.x, P.y, P.s, P.s, { rx: 8, fill: 'rgba(6,12,24,0.85)', stroke: ctx.alpha(col || 'lime', 0.55), sw: 1.2, parent: f });
    for (var k = -2; k <= 2; k++) {
      var a = toPx(P, k, 0);
      ctx.line(a[0], P.y + 4, a[0], P.y + P.s - 4, { color: 'rgba(255,255,255,0.04)', sw: 1, parent: f });
      var b = toPx(P, 0, k);
      ctx.line(P.x + 4, b[1], P.x + P.s - 4, b[1], { color: 'rgba(255,255,255,0.04)', sw: 1, parent: f });
    }
    if (title) ctx.text(P.x + 12, P.y - 14, title, { size: 13, font: 'mono', weight: 600, color: col || 'lime', parent: f });
    return f;
  }
  /* fade a scalar S[key] (or S[key][i]) from a to b over ms and redraw */
  function ramp(ctx, S, ms, fn, ease, delay) {
    return ctx.tween(ms, function (p) { fn(p); S.dirty = true; }, ease, delay);
  }

  Atlas.register({
    id: 'diffusion',
    refs: [
      'Sohl-Dickstein et al., <i>Deep Unsupervised Learning using Nonequilibrium Thermodynamics</i>, ICML 2015; Ho, Jain &amp; Abbeel, <i>Denoising Diffusion Probabilistic Models</i>, NeurIPS 2020; Song et al., <i>Score-Based Generative Modeling through SDEs</i>, ICLR 2021',
      'Lipman et al., <i>Flow Matching for Generative Modeling</i>, ICLR 2023',
      'Liu, Gong &amp; Liu, <i>Flow Straight and Fast: Learning to Generate and Transfer Data with Rectified Flow</i>, ICLR 2023',
      'Karras et al., <i>Elucidating the Design Space of Diffusion-Based Generative Models (EDM)</i>, NeurIPS 2022; Hoogeboom, Heek &amp; Salimans, <i>simple diffusion: End-to-end diffusion for high resolution images</i>, ICML 2023',
      'Ho &amp; Salimans, <i>Classifier-Free Diffusion Guidance</i>, NeurIPS 2021 Workshop on Deep Generative Models; Salimans &amp; Ho, <i>Progressive Distillation for Fast Sampling of Diffusion Models</i>, ICLR 2022; Kynkäänniemi et al., <i>Applying Guidance in a Limited Interval Improves Sample and Distribution Quality in Diffusion Models</i>, NeurIPS 2024; Sadat et al., <i>Eliminating Oversaturation and Artifacts of High Guidance Scales in Diffusion Models (APG)</i>, ICLR 2025',
      'Esser et al., <i>Scaling Rectified Flow Transformers for High-Resolution Image Synthesis (SD3)</i>, ICML 2024',
      'Song et al., <i>Consistency Models</i>, ICML 2023; Lu &amp; Song, <i>Simplifying, Stabilizing and Scaling Continuous-Time Consistency Models (sCM)</i>, ICLR 2025',
      'Yin et al., <i>One-step Diffusion with Distribution Matching Distillation</i> (DMD), CVPR 2024',
      'Yin et al., <i>Improved Distribution Matching Distillation for Fast Image Synthesis</i> (DMD2), NeurIPS 2024',
      'Yin et al., <i>From Slow Bidirectional to Fast Autoregressive Video Diffusion Models</i> (CausVid), CVPR 2025',
      'Huang et al., <i>Self Forcing: Bridging the Train-Test Gap in Autoregressive Video Diffusion</i>, NeurIPS 2025',
      'Lin et al., <i>Diffusion Adversarial Post-Training for One-Step Video Generation</i> (Seaweed-APT), ICML 2025',
      'Sauer et al., <i>Adversarial Diffusion Distillation</i>, ECCV 2024'
    ],
    setup: function (ctx) {
      var S = ctx.state;
      S.c2 = ctx.canvas().ctx2d;
      S.layers = [];
      S.dirty = true;
      ctx.loop(function () {
        var lt = isLight();
        if (lt !== S.lightSeen) { S.lightSeen = lt; S.dirty = true; }   /* redraw pictures when the theme is toggled */
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
        beats: [
          {
            say: 'Diffusion models learn to create by learning to undo destruction. Take a clean latent of our fox on the ice moon: that is the data. Next to it, a sample of pure Gaussian noise.',
            card: { tag: 'KEY IDEA', title: 'Learn to undo destruction', body: 'Destroying structure is easy and free. The network only has to learn the reverse, one small denoising problem at a time.' },
            deep: '<p>Diffusion models turn density estimation into a sequence of easy denoising problems. Start from data x<sub>0</sub> ~ p<sub>data</sub>; a fixed process gradually destroys its structure until only Gaussian noise remains. Sohl-Dickstein et al. (2015) proposed the idea and DDPM (Ho et al., 2020) made it work.</p>' +
              '<div class="note">In the video model x<sub>0</sub> is the 16 × 31 × 90 × 160 VAE latent (7.1 M values), not pixels. The 64 × 64 image here is a stand-in; the math is identical.</div>' +
              '<p>Destroying information costs nothing and has a closed form. Creating it is the hard part, and it is delegated to a single learned network.</p>'
          },
          {
            say: 'Blend the two with a weight called time. At time zero it is pure signal; at time one it is pure noise. This forward process has no parameters and can jump to any noise level in one shot.',
            card: { tag: 'HOW IT WORKS', title: 'Any noise level in one shot', body: 'Because <code>x_t = α_t x₀ + σ_t ε</code> is closed form, training picks a random t and jumps straight there. No simulation.' },
            deep: '<p>The forward (noising) process is fixed and closed-form, so training can sample any t directly:</p>' +
              '<div class="eq">x<sub>t</sub> = α<sub>t</sub> x<sub>0</sub> + σ<sub>t</sub> ε,   ε ~ N(0, I),   t ∈ [0, 1]</div>' +
              '<p>Equivalently q(x<sub>t</sub> | x<sub>0</sub>) = N(α<sub>t</sub> x<sub>0</sub>, σ<sub>t</sub>² I). There are no learned parameters and no sequential simulation: a training step draws (x<sub>0</sub>, t, ε), builds x<sub>t</sub> in one line, and asks the network about it.</p>'
          },
          {
            say: 'The model only learns the reverse direction. The generation loop inside the video model is just this reverse walk, from noise back to data, repeated fifty times.',
            card: { tag: 'NUMBERS', title: 'The reverse walk', stat: { v: '50', u: 'steps', l: 'of learned denoising take the video model from t = 1 (noise) to t = 0 (the clip latent)' } },
            deep: '<p>The reverse direction is what the network learns. Song et al. (2021) showed that the noising process is an SDE whose reverse-time SDE needs the <b>score</b> ∇log p<sub>t</sub>(x). Every such SDE also has a deterministic <i>probability-flow ODE</i> with the same marginals:</p>' +
              '<div class="eq">dx/dt = f(x, t) − ½ g(t)² ∇<sub>x</sub> log p<sub>t</sub>(x)</div>' +
              '<p>Flow matching learns this ODE’s velocity field directly. Sampling integrates it from t = 1 to 0, which is the ~50-step loop inside the video model.</p>'
          },
          {
            say: 'Different model families choose different schedules for how signal and noise trade off. Rectified flow uses straight lines, the cosine schedule a quarter circle, and both sweep the log signal to noise ratio from plus infinity to minus infinity.',
            card: { tag: 'HOW IT WORKS', title: 'Same endpoints, different paths', body: 'VP-cosine and rectified flow both sweep log-SNR from +∞ to −∞; they differ in how time maps to it. SD3, Wan and HunyuanVideo use the straight line.', more: '<p>For x<sub>t</sub> = αx<sub>0</sub> + σε, SNR(t) = α²/σ². Rectified flow gives SNR = ((1 − t)/t)², so λ = 2 ln((1 − t)/t), antisymmetric about t = ½ where λ = 0. The cosine schedule gives SNR = cot²(πt/2) and λ = −2 ln tan(πt/2). Any monotone schedule is a reparameterisation of the same path in λ, which is why samplers and loss weights are usually compared in log-SNR.</p>' },
            deep: '<table><tr><th>Schedule</th><th>α<sub>t</sub>, σ<sub>t</sub></th><th>Used by</th></tr>' +
              '<tr><td>VP (α² + σ² = 1)</td><td>cos(πt/2), sin(πt/2) for the cosine schedule</td><td>DDPM, iDDPM (cosine), SD 1.x/2.x</td></tr>' +
              '<tr><td>VE / EDM</td><td>1, σ(t) ∈ [0.002, 80]</td><td>EDM, score SDEs</td></tr>' +
              '<tr><td>Rectified flow</td><td>1 − t, t</td><td>SD3, Flux, Wan, HunyuanVideo, Movie Gen</td></tr></table>' +
              '<p>What matters is the signal-to-noise ratio SNR(t) = α²/σ², or λ = log SNR. For rectified flow λ = 2 ln((1 − t)/t), which is 0 at t = ½; for the cosine schedule λ = −2 ln tan(πt/2). Schedules differ mainly in how they spend training samples and sampler steps along λ.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, I = S.img;
          var g = newStage(ctx, S);
          ctx.hud('');
          var ts = [0, 0.25, 0.5, 0.75, 1];
          S.thumbs = ts.map(function () { return newBuf(); });
          S.tcur = [0, 0, 0, 0, 1];
          S.va1 = [0, 0, 0, 0, 0];
          var arr = new Float32Array(N * N * 3);
          function paintThumb(i) { lin(1 - S.tcur[i], I.X0, S.tcur[i], I.E, arr); paintArr(S.thumbs[i], arr); }
          ts.forEach(function (t, i) { paintThumb(i); });
          addLayer(S, function (c2) {
            S.thumbs.forEach(function (b, i) {
              if (S.va1[i] < 0.005) return;
              c2.save(); c2.globalAlpha = c2.globalAlpha * S.va1[i];
              drawBuf(c2, b, 90 + i * 180, 225, 150, i === 0 ? 'rgba(141,255,90,0.8)' : 'rgba(123,140,171,0.6)');
              c2.restore();
            });
          });
          /* beat 1: the clean latent and a noise sample, with empty slots between them */
          S.hdr = ctx.text(90, 196, 'FORWARD PROCESS  x_t = (1 − t)·x₀ + t·ε  (rectified flow)', { size: 14, font: 'mono', weight: 600, color: 'lime', parent: g });
          S.ph1 = [1, 2, 3].map(function (i) {
            return ctx.rect(90 + i * 180, 225, 150, 150, { rx: 8, fill: 'rgba(6,12,24,0.6)', stroke: 'faint', sw: 1.2, dash: '4 5', parent: g });
          });
          S.labs1 = ts.map(function (t, i) {
            return ctx.text(165 + i * 180, 392, i === 0 ? 'x₀ · t = 0 · data' : (i === 4 ? 'ε · t = 1 · noise' : 't = ' + t), { size: 13, font: 'mono', color: i === 0 ? 'lime' : (i === 4 ? 'white' : 'text'), anchor: 'middle', parent: g });
          });
          [1, 2, 3].forEach(function (i) { S.labs1[i].setAttribute('opacity', 0); });
          return Promise.all([
            ctx.reveal([S.hdr].concat(S.ph1), { stagger: 80 }),
            ctx.reveal([S.labs1[0], S.labs1[4]], { delay: 300 }),
            ramp(ctx, S, 800, function (p) { S.va1[0] = p; S.va1[4] = p; }, 'out', 200)
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: blend at intermediate times, the forward arrow and the general form */
            var fwd = ctx.path('M95,420 L955,420', { stroke: 'pink', sw: 2, arrow: true, parent: g });
            var fwdT = ctx.text(525, 438, 'forward q(x_t | x₀): fixed, closed form, any t in one shot', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: g });
            var eq = ctx.group({ parent: g });
            ctx.rect(1030, 190, 510, 300, { rx: 12, fill: 'rgba(6,12,24,0.9)', stroke: ctx.alpha('lime', 0.5), parent: eq });
            ctx.text(1054, 222, 'GENERAL FORM', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: eq });
            ctx.text(1054, 258, 'x_t = α_t · x₀ + σ_t · ε', { size: 22, font: 'mono', weight: 700, color: 'white', parent: eq });
            ctx.para(1054, 300, [
              'ε ~ N(0, I), same shape as x₀',
              'VP cosine:  α = cos(πt/2), σ = sin(πt/2)',
              'rectified flow:  α = 1 − t, σ = t',
              'SNR(t) = α² / σ²,  λ = log SNR',
              'x₀ here: 64×64×3 · in Wan: 16×31×90×160'
            ], { size: 13, font: 'mono', color: 'text', lh: 34, parent: eq });
            ctx.hud('x_t = (1 − t)·x₀ + t·ε');
            return Promise.all([
              ctx.fadeOut(S.ph1, 300, true),
              ctx.reveal([S.labs1[1], S.labs1[2], S.labs1[3]], { delay: 300, stagger: 250 }),
              ramp(ctx, S, 2600, function (p) {
                [1, 2, 3].forEach(function (i) {
                  S.va1[i] = ctx.clamp(p * 4 - (i - 1) * 0.6, 0, 1);
                  S.tcur[i] = ts[i] * ctx.clamp(p * 1.5 - 0.2, 0, 1);
                  paintThumb(i);
                });
              }, 'inOut'),
              ctx.reveal(fwd, { from: 'draw', delay: 400, dur: 1200 }),
              ctx.reveal(fwdT, { delay: 900 }),
              ctx.reveal(eq, { from: 'right', delay: 200 })
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the reverse walk is what is learned */
            var rev = ctx.path('M955,466 L95,466', { stroke: 'lime', sw: 2, arrow: true, parent: g });
            var revT = ctx.text(525, 486, 'reverse: learned v_θ, integrated from t = 1 to 0 in ~50 steps (one tick = one network call)', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: g });
            var ticks = [];
            for (var q = 0; q <= 50; q++) {
              var tq = 955 - q * 17.2, major = q % 10 === 0;
              ticks.push(ctx.line(tq, major ? 456 : 460, tq, major ? 476 : 472, { color: ctx.alpha('lime', major ? 0.9 : 0.5), sw: major ? 1.8 : 1, parent: g }));
            }
            return Promise.all([ctx.reveal(rev, { from: 'draw', dur: 1200 }), ctx.reveal(revT, { delay: 600 }), ctx.reveal(ticks, { from: 'fade', delay: 200, stagger: 18, dur: 250 })]).then(function () {
              return ctx.packet(rev, { color: 'lime', dur: 1600, label: 'v_θ', r: 6 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: schedules and log-SNR */
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
            var b2 = ctx.plot(820, 545, 440, 230, function (t) { return 2 * Math.log(1 / Math.tan(Math.PI * t / 2)); }, { xDomain: [0.02, 0.98], yDomain: [-8, 8], color: 'cyan', axes: false, parent: pl });
            ctx.line(820, 660, 1260, 660, { color: 'faint', sw: 1, dash: '3 4', parent: pl });
            ctx.text(1266, 660, 'SNR = 1', { size: 11, font: 'mono', color: 'dim', parent: pl });
            ctx.para(1330, 570, ['both go from', 'pure signal (λ → +∞)', 'to pure noise (λ → −∞);', 'they differ in how', 'time maps to λ'], { size: 12, font: 'mono', color: 'text', lh: 22, parent: pl });
            return Promise.all([ctx.reveal(pl, { delay: 100 })].concat([a1, a2, a3, a4, b1, b2].map(function (p, i) {
              return ctx.reveal(p.curve, { from: 'draw', delay: 300 + i * 150, dur: 900 });
            })));
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'What to predict',
        beats: [
          {
            say: 'What exactly should the network predict? Picture three points: the clean sample, the noise sample, and the noisy point somewhere between them. In high dimensions the data and the noise are almost perpendicular.',
            card: { tag: 'NUMBERS', title: 'Data and noise are orthogonal', stat: { v: '3.7 × 10⁻⁴', l: 'typical cosine between a data vector and Gaussian noise in 7.1 M dimensions (about 1/√d)' } },
            deep: '<p>Take one training pair. In d = 7.1 M dimensions a Gaussian ε has norm ≈ √d and is almost exactly orthogonal to any fixed x<sub>0</sub>: the cosine is ~ 1/√d ≈ 3.7×10⁻⁴. So the right-angle picture is literal.</p>' +
              '<p>For unit-variance data (‖x<sub>0</sub>‖ ≈ ‖ε‖) the variance-preserving path α = cos, σ = sin is a quarter circle, and the rectified-flow path is its chord. Midway along the chord the state has norm √½ ≈ 0.71: the straight path cuts through the inside of the sphere that the VP path stays on.</p>'
          },
          {
            say: 'Classic diffusion predicts the noise. Others predict the clean sample. Each is a different arrow from the same noisy point back toward one of the two ends.',
            card: { tag: 'HOW IT WORKS', title: 'Predict the noise or the sample', body: 'ε-prediction (DDPM, SD 1.x) and x₀-prediction are two views of the same posterior mean <code>E[x₀ | x_t]</code>.' },
            deep: '<div class="eq">ε-pred: ‖ε<sub>θ</sub>(x<sub>t</sub>, t) − ε‖²<br>x₀-pred: ‖x̂<sub>θ</sub>(x<sub>t</sub>, t) − x<sub>0</sub>‖²</div>' +
              '<p>From x<sub>t</sub> = αx<sub>0</sub> + σε, knowing one of ε, x<sub>0</sub> gives the other. But the two losses weigh noise levels differently. ε-prediction amplifies its errors at high noise (x̂<sub>0</sub> = (x<sub>t</sub> − σε̂)/α divides by α → 0), while x₀-prediction puts almost no weight on fine detail near t → 0.</p>'
          },
          {
            say: 'A third choice, called v prediction, blends the two. Flow matching predicts the velocity: noise minus data, the direction of the straight line joining them, which is the same vector everywhere along the path.',
            card: { tag: 'TRY IT', title: 'Click the chord: v never changes', body: '<code>v = ε − x₀</code> is the same vector at every t. Click anywhere on the green chord to move x_t and watch the arrows follow.' },
            deep: '<div class="eq">v-pred (VP): v = α<sub>t</sub> ε − σ<sub>t</sub> x<sub>0</sub><br>flow: v = dx<sub>t</sub>/dt = ε − x<sub>0</sub></div>' +
              '<p>v-prediction was introduced for progressive distillation (Salimans &amp; Ho, 2022) and used in Imagen Video. Flow matching sets α = 1 − t, σ = t, so the velocity is constant along each straight path: the network regresses one fixed vector ε − x<sub>0</sub> whatever the value of t. Wan, HunyuanVideo, Movie Gen and SD3 all use it.</p>'
          },
          {
            say: 'These targets are interchangeable with simple algebra. What really changes is how the loss is weighted across noise levels, and therefore where the network spends its capacity.',
            card: { tag: 'WHY IT MATTERS', title: 'Same optimum, different weight', body: 'The ε-loss equals the v-loss times <code>(1 − t)²</code>. The weighting decides which noise levels the network works hardest on.', more: '<p>For rectified flow ε = x<sub>t</sub> + (1 − t)v and x<sub>0</sub> = x<sub>t</sub> − t·v, so an error δ in the velocity becomes (1 − t)δ in ε and −tδ in x<sub>0</sub>. Hence ‖ε − ε̂‖² = (1 − t)²‖v − v̂‖² and ‖x<sub>0</sub> − x̂<sub>0</sub>‖² = t²‖v − v̂‖²: one network error, weighted differently in each parameterisation.</p>' },
            deep: '<p>For rectified flow the conversions are exact and linear:</p>' +
              '<div class="eq">x̂<sub>0</sub> = x<sub>t</sub> − t·v̂<br>ε̂ = x<sub>t</sub> + (1 − t)·v̂</div>' +
              '<p>All targets are re-parameterisations of the posterior mean E[x<sub>0</sub> | x<sub>t</sub>], so each loss is another times a weight: ‖v − v̂‖² = ‖ε − ε̂‖² / (1 − t)².</p>' +
              '<p>The weight is therefore a design knob, and it is chosen together with the timestep sampler: EDM, SD3 and Wan each pair a target with their own t distribution and loss weighting.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = newStage(ctx, S);
          ctx.hud('flow target: v = ε − x₀');
          var O = { x: 150, y: 250 }, X = { x: 150, y: 790 }, Ep = { x: 700, y: 250 };
          /* beat 1: geometry of one training sample */
          var geo = ctx.group({ parent: g });
          ctx.text(90, 196, 'GEOMETRY OF ONE TRAINING SAMPLE  (high-dim: ε ⟂ x₀)', { size: 14, font: 'mono', weight: 600, color: 'lime', parent: geo });
          ctx.line(O.x, O.y, X.x, X.y, { color: 'faint', sw: 1, dash: '3 5', parent: geo });
          ctx.line(O.x, O.y, Ep.x, Ep.y, { color: 'faint', sw: 1, dash: '3 5', parent: geo });
          ctx.circle(O.x, O.y, 4, { fill: 'dim', parent: geo });
          ctx.text(O.x - 12, O.y - 6, '0', { size: 13, font: 'mono', color: 'dim', anchor: 'end', parent: geo });
          var d = '';
          for (var i = 0; i <= 40; i++) {
            var th = Math.PI / 2 * i / 40;
            var px = O.x + Math.cos(th) * (X.x - O.x) + Math.sin(th) * (Ep.x - O.x), py = O.y + Math.cos(th) * (X.y - O.y) + Math.sin(th) * (Ep.y - O.y);
            d += (i ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1);
          }
          S.vpPath = ctx.path(d, { stroke: 'cyan', sw: 1.6, dash: '6 5', parent: geo });
          S.rfPath = ctx.path('M' + X.x + ',' + X.y + ' L' + Ep.x + ',' + Ep.y, { stroke: 'lime', sw: 2, parent: geo });
          ctx.circle(X.x, X.y, 8, { fill: 'lime', parent: geo, glow: true });
          ctx.text(X.x - 14, X.y + 30, 'x₀  (data: the fox latent)', { size: 14, font: 'mono', color: 'lime', parent: geo });
          ctx.circle(Ep.x, Ep.y, 8, { fill: 'white', parent: geo, glow: true });
          ctx.text(Ep.x - 10, Ep.y - 24, 'ε  (noise)', { size: 14, font: 'mono', color: 'white', anchor: 'middle', parent: geo });
          ctx.line(440, 742, 476, 742, { color: 'lime', sw: 2, parent: geo });
          ctx.text(486, 742, 'flow path: straight chord', { size: 12, font: 'mono', color: 'lime', parent: geo });
          ctx.line(440, 768, 476, 768, { color: 'cyan', sw: 1.6, dash: '6 5', parent: geo });
          ctx.text(486, 768, 'VP path: quarter arc', { size: 12, font: 'mono', color: 'cyan', parent: geo });
          /* moving z_t with arrows (created now, revealed over the next beats) */
          S.zg = ctx.group({ parent: g });
          S.aX = ctx.line(0, 0, 0, 0, { color: 'cyan', sw: 2, arrow: true, parent: S.zg });
          S.aE = ctx.line(0, 0, 0, 0, { color: 'dim', sw: 2, arrow: true, parent: S.zg });
          S.aV = ctx.line(0, 0, 0, 0, { color: 'amber', sw: 3, arrow: true, parent: S.zg, glow: true });
          S.zDot = ctx.circle(0, 0, 7, { fill: 'amber', parent: S.zg, glow: true });
          S.zLab = ctx.text(0, 0, '', { size: 14, font: 'mono', weight: 600, color: 'amber', anchor: 'end', parent: S.zg });
          S.lX = ctx.text(0, 0, 'x₀-pred', { size: 12, font: 'mono', color: 'cyan', parent: S.zg });
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
          /* beat 1 shows only the noisy point; the x0 / eps arrows come in beat 2 and the velocity arrow in beat 3 */
          [S.zg, S.aX, S.aE, S.lX, S.lE, S.aV, S.lV].forEach(function (e) { e.setAttribute('opacity', 0); });
          /* right: parameterisation table, one row per beat */
          var rows = [
            ['ε-prediction', 'DDPM · SD 1.x', 'ε_θ(x_t, t) ≈ ε', 'dim'],
            ['x₀-prediction', 'EDM denoiser D_θ', 'D_θ(x_t, t) ≈ x₀', 'cyan'],
            ['v-prediction', 'VP · Imagen Video', 'v = α_t·ε − σ_t·x₀', 'violet'],
            ['flow velocity', 'SD3 · Wan · Hunyuan', 'v = ε − x₀', 'amber']
          ];
          function tableRow(r, i) {
            var y = 200 + i * 104, tg = ctx.group({ parent: g });
            ctx.rect(860, y, 680, 90, { rx: 10, fill: 'rgba(6,12,24,0.9)', stroke: ctx.alpha(r[3], 0.6), parent: tg });
            ctx.text(882, y + 28, r[0], { size: 17, font: 'display', weight: 700, color: r[3] === 'dim' ? 'white' : r[3], parent: tg });
            ctx.text(1520, y + 28, r[1], { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: tg });
            ctx.text(882, y + 62, r[2], { size: 16, font: 'mono', color: 'text', parent: tg });
            return tg;
          }
          S.rowsT = rows.map(tableRow);
          S.rowsT.forEach(function (r) { r.setAttribute('opacity', 0); });
          return ctx.reveal(geo, {}).then(function () {
            return Promise.all([
              ctx.reveal([S.rfPath, S.vpPath], { from: 'draw', stagger: 300 }),
              ctx.reveal(S.zg, { delay: 700 }).then(function () { return ctx.pulse(S.zDot, { color: 'amber', dur: 300 }); })
            ]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: ε- and x0-prediction arrows from the noisy point */
            return Promise.all([
              ctx.reveal([S.aX, S.aE, S.lX, S.lE], { delay: 100, stagger: 120 }),
              ctx.reveal([S.rowsT[0], S.rowsT[1]], { from: 'right', delay: 200, stagger: 250 })
            ]).then(function () {
              return ctx.pulse(S.zDot, { color: 'cyan', dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: velocity, and a clickable chord: x_t moves, v stays put */
            var hit = ctx.line(X.x, X.y, Ep.x, Ep.y, { color: 'rgba(255,255,255,0.01)', sw: 28, parent: g });
            hit.style.cursor = 'pointer';
            hit.addEventListener('click', function (ev) {
              if (ctx.dead) return;
              var svg = hit.ownerSVGElement, pt = svg.createSVGPoint(), m = hit.getScreenCTM();
              if (!m) return;
              pt.x = ev.clientX; pt.y = ev.clientY;
              var p = pt.matrixTransform(m.inverse());
              var ux = Ep.x - X.x, uy = Ep.y - X.y;
              setT(ctx.clamp(((p.x - X.x) * ux + (p.y - X.y) * uy) / (ux * ux + uy * uy), 0.08, 0.95));
            });
            return Promise.all([
              ctx.reveal([S.aV, S.lV], { from: 'fade', dur: 500 }),
              ctx.reveal([S.rowsT[2], S.rowsT[3]], { from: 'right', delay: 200, stagger: 250 })
            ]).then(function () { return ctx.pulse(S.aV, { color: 'amber', dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: conversions and loss weights; z_t slides along the path */
            var tb = ctx.group({ parent: g });
            ctx.text(860, 640, 'conversions (rectified flow):', { size: 13, font: 'mono', color: 'dim', parent: tb });
            ctx.text(860, 670, 'x₀ ≈ x_t − t·v_θ', { size: 17, font: 'mono', weight: 600, color: 'white', parent: tb });
            ctx.text(1140, 670, 'ε ≈ x_t + (1 − t)·v_θ', { size: 17, font: 'mono', weight: 600, color: 'white', parent: tb });
            ctx.text(860, 716, 'same optimum E[x₀ | x_t], different loss weight:', { size: 13, font: 'mono', color: 'dim', parent: tb });
            ctx.text(860, 748, '‖v − v_θ‖² = ‖ε − ε_θ‖² / (1 − t)²', { size: 17, font: 'mono', weight: 600, color: 'amber', parent: tb });
            return Promise.all([
              ctx.reveal(tb, { from: 'right' }),
              ctx.wait(500).then(function () {
                return ctx.tween(3600, function (p) {
                  setT(ctx.clamp(0.55 + 0.38 * Math.sin(2 * Math.PI * p), 0.1, 0.95));
                }, 'linear');
              })
            ]).then(function () { setT(0.55); });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Flow in 2D',
        beats: [
          {
            say: 'Now watch flow matching in two dimensions. Every dot starts as a sample from a standard Gaussian, and the faint white dots are the data: two moons.',
            card: { tag: 'KEY IDEA', title: 'A noise cloud in, data out', body: '500 particles start as <code>N(0, I)</code>. Flow matching moves all of them at once onto the data distribution.' },
            deep: '<p>The generative model is a <b>probability-flow ODE</b> that transports the Gaussian onto the data, one deterministic trajectory per sample:</p>' +
              '<div class="eq">dz/dt = v<sub>θ</sub>(z, t),   z(1) ~ N(0, I),   z(0) ~ p<sub>data</sub></div>' +
              '<p>Here d = 2, so everything can be drawn. The dataset is two moons (M = 160 points); dots are coloured by the moon they end on, so the Gaussian is carved into two basins of attraction.</p>'
          },
          {
            say: 'The velocity field, which a real model learns and which here we compute exactly from the data, tells each dot where to move at each moment. The amber arrows show the direction of travel.',
            card: { tag: 'HOW IT WORKS', title: 'The field is an average', body: 'Each arrow is the average travel direction, <code>x₀ − ε</code>, over every training pair whose noisy version passes through that point. The network regresses its negative, <code>ε − x₀</code>.' },
            deep: '<div class="eq">v*(z, t) = E[ε − x<sub>0</sub> | x<sub>t</sub> = z] = ( z − E[x<sub>0</sub> | x<sub>t</sub> = z] ) / t</div>' +
              '<p>This marginal velocity is what any well-trained v<sub>θ</sub> converges to. In this toy (M = 160 points) the posterior mean is an exact softmax over the dataset:</p>' +
              '<div class="eq">E[x<sub>0</sub> | z] = Σ<sub>i</sub> w<sub>i</sub> x<sub>i</sub>,   w<sub>i</sub> ∝ exp( −‖z − (1 − t)x<sub>i</sub>‖² / 2t² )</div>' +
              '<div class="note">This exact field memorises the 160 points; a neural v<sub>θ</sub> is smoother and generalises.</div>'
          },
          {
            say: 'As time runs from one to zero, the cloud splits and streams into the two moons, each dot following its own path through the field.',
            card: { tag: 'NUMBERS', title: 'Simulation-free training', stat: { v: '0', u: 'ODE solves', l: 'needed during training: sample (x₀, ε, t), regress one velocity target, repeat' } },
            deep: '<div class="eq">L<sub>CFM</sub>(θ) = E<sub>t, x₀, ε</sub> ‖ v<sub>θ</sub>((1 − t)x<sub>0</sub> + tε, t) − (ε − x<sub>0</sub>) ‖²</div>' +
              '<p>Lipman et al. prove that the per-sample (conditional) loss has the same gradients as regressing the intractable marginal field, which is why training is simulation-free. Sampling is the only place an ODE is solved:</p>' +
              '<pre>z = randn(500, 2)\nfor k in range(40):          # t: 1 → 0\n    t, tn = 1 - k/40, 1 - (k+1)/40\n    z = z + (tn - t) * v(z, t)</pre>'
          },
          {
            say: 'Each training pair follows a straight line, but the average field bends, because trajectories of an ordinary differential equation can never cross. Compare the dashed chords with the curved paths.',
            card: { tag: 'WHY IT MATTERS', title: 'Curvature makes few steps hard', body: 'Pairs are straight, the averaged field is not. Curved paths need many small Euler steps, which is why four-step samplers blur.', more: '<p>Two ODE trajectories through the same point (z, t) would have to coincide, by uniqueness of solutions (Picard–Lindelöf) for a Lipschitz field. So paths cannot cross, and where many straight pair-lines intersect the flow must bend around the crossing.</p>' },
            deep: '<p>Each (x₀, ε) pair moves on a straight line, but many pairs pass through the same point z at time t with different velocities. The regression target is their average, and two trajectories of the averaged field can never cross, so the marginal paths must bend around each other.</p>' +
              '<p>Curvature is the enemy of few-step sampling: an Euler step assumes a straight line. Rectified flow’s <i>reflow</i> procedure (Liu et al.) retrains on the model’s own couplings to straighten the paths, which is the first distillation trick of the last step.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = newStage(ctx, S);
          ctx.hud('500 particles · exact marginal field');
          var P = { x: 80, y: 196, s: 650 };
          S.P3 = P;
          S.tr3 = simulate(S.fieldAll, S.init, 40, false);
          var fin = S.tr3[40];
          S.col3 = [];
          for (var i = 0; i < 500; i++) S.col3.push(nearest(S.data, fin[2 * i], fin[2 * i + 1])[1] ? 0 : 1);
          S.p3 = 0; S.f3 = 0; S.em3 = 0;
          S.q3 = {};
          var cur = new Float32Array(1000);
          var emph = [4, 14, 27, 33, 48, 61, 72, 85];
          var L3 = addLayer(S, function (c2) {
            c2.save(); clipPanel(c2, P);
            drawData(c2, P, S.data, 0.35);
            var st = posAt(S.tr3, S.p3, cur);
            var t = Math.max(0.02, 1 - S.p3);
            if (S.f3 > 0.005) {
              var key = Math.round(t * 40);
              if (!S.q3[key]) {
                var arr = [], tq = Math.max(0.03, key / 40);
                for (var a = -3; a <= 3; a += 0.5) for (var b = -3; b <= 3; b += 0.5) { var v = S.fieldAll(a, b, tq); arr.push([a, b, v[0], v[1]]); }
                S.q3[key] = arr;
              }
              c2.strokeStyle = 'rgba(255,191,58,' + (0.45 * S.f3).toFixed(3) + ')'; c2.lineWidth = 1.2; c2.beginPath();
              S.q3[key].forEach(function (q) {
                var m = Math.sqrt(q[2] * q[2] + q[3] * q[3]) || 1, p0 = toPx(P, q[0], q[1]);
                var dx = -q[2] / m * 12, dy = q[3] / m * 12;
                c2.moveTo(p0[0], p0[1]); c2.lineTo(p0[0] + dx, p0[1] + dy);
                c2.lineTo(p0[0] + dx * 0.6 - dy * 0.25, p0[1] + dy * 0.6 + dx * 0.25);
              });
              c2.stroke();
            }
            drawTrails(c2, P, S.tr3, st, cur, 90, 'rgba(232,241,255,0.16)');
            if (S.em3 > 0.005) {
              c2.save(); c2.globalAlpha = c2.globalAlpha * S.em3;
              c2.lineWidth = 1.4; c2.strokeStyle = 'rgba(255,255,255,0.85)'; c2.setLineDash([5, 5]); c2.beginPath();
              emph.forEach(function (k) {
                var a0 = toPx(P, S.tr3[0][2 * k], S.tr3[0][2 * k + 1]), b0 = toPx(P, S.tr3[40][2 * k], S.tr3[40][2 * k + 1]);
                c2.moveTo(a0[0], a0[1]); c2.lineTo(b0[0], b0[1]);
              });
              c2.stroke(); c2.setLineDash([]);
              c2.lineWidth = 2.4;
              emph.forEach(function (k) {
                c2.strokeStyle = S.col3[k] ? '#22e4ff' : '#8dff5a'; c2.beginPath();
                for (var s2 = 0; s2 <= 40; s2++) {
                  var q2 = toPx(P, S.tr3[s2][2 * k], S.tr3[s2][2 * k + 1]);
                  if (s2) c2.lineTo(q2[0], q2[1]); else c2.moveTo(q2[0], q2[1]);
                }
                c2.stroke();
              });
              c2.restore();
            }
            drawDots(c2, P, cur, S.col3, ['#8dff5a', '#22e4ff'], 2.6);
            c2.restore();
          });
          L3.a = 0;
          /* beat 1: panel, cloud, data, and the ODE */
          var fr = panelFrame(ctx, g, P, 'N(0, I)  →  two moons · 500 particles · 40 Euler steps', 'lime');
          var R = ctx.group({ parent: g });
          ctx.text(790, 210, 'PROBABILITY FLOW ODE', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: R });
          ctx.text(790, 246, 'dz/dt = v_θ(z, t),   t: 1 → 0', { size: 20, font: 'mono', weight: 700, color: 'white', parent: R });
          S.t3 = ctx.text(790, 530, 't = 1.000', { size: 30, font: 'mono', weight: 700, color: 'lime', parent: R });
          ctx.circle(796, 618, 5, { fill: 'lime', parent: R });
          ctx.text(810, 618, 'ends on the upper moon', { size: 13, font: 'mono', color: 'lime', parent: R });
          ctx.circle(1066, 618, 5, { fill: 'cyan', parent: R });
          ctx.text(1080, 618, 'ends on the lower moon', { size: 13, font: 'mono', color: 'cyan', parent: R });
          return Promise.all([
            ctx.reveal(fr, {}),
            ctx.reveal(R, { from: 'right', delay: 200 }),
            ramp(ctx, S, 900, function (p) { L3.a = p; }, 'out', 200)
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the exact marginal velocity field */
            var M = ctx.group({ parent: g });
            ctx.text(790, 296, 'MARGINAL VELOCITY (what v_θ converges to)', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: M });
            ctx.text(790, 330, 'v*(z, t) = ( z − E[x₀ | x_t = z] ) / t', { size: 18, font: 'mono', color: 'amber', parent: M });
            ctx.text(790, 566, 'amber arrows: direction of travel (−v*) at the current t', { size: 13, font: 'mono', color: 'amber', parent: M });
            return Promise.all([
              ctx.reveal(M, { from: 'right' }),
              ramp(ctx, S, 1000, function (p) { S.f3 = p; }, 'out')
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the flow */
            var T3 = ctx.group({ parent: g });
            ctx.text(790, 380, 'TRAINING (conditional flow matching)', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: T3 });
            ctx.para(790, 412, [
              'sample x₀ ~ data, ε ~ N(0, I), t ~ p(t)',
              'regress v_θ((1−t)x₀ + tε, t) onto ε − x₀',
              'no simulation, no ODE solve during training'
            ], { size: 14, font: 'mono', color: 'text', lh: 26, parent: T3 });
            ctx.text(790, 592, 'white trails: 90 particle trajectories', { size: 13, font: 'mono', color: 'dim', parent: T3 });
            return Promise.all([
              ctx.reveal(T3, { from: 'right' }),
              ctx.wait(400).then(function () {
                return ctx.tween(5200, function (p) {
                  S.p3 = p; S.dirty = true;
                  S.t3.textContent = 't = ' + (1 - p).toFixed(3);
                }, 'inOut');
              })
            ]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: straight pair lines versus the curved average field */
            var box = ctx.group({ parent: g });
            ctx.rect(790, 660, 740, 150, { rx: 10, fill: ctx.alpha('lime', 0.06), stroke: ctx.alpha('lime', 0.4), parent: box });
            ctx.para(812, 692, [
              'Each (x₀, ε) pair moves on a straight line (dashed), but many pairs',
              'pass through the same z. The field averages them, and ODE',
              'trajectories cannot cross, so marginal paths (solid) curve.',
              'Curvature is exactly what makes few-step sampling hard.'
            ], { size: 14, font: 'mono', color: 'text', lh: 26, parent: box });
            return Promise.all([
              ctx.reveal(box, { from: 'up' }),
              ramp(ctx, S, 900, function (p) { S.em3 = p; }, 'out', 200)
            ]);
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Solving the ODE',
        beats: [
          {
            say: 'Sampling means solving this ordinary differential equation numerically, and the number of steps matters. With only four Euler steps, the dots follow straight chords instead of curves, and land on averages in the empty space between the moons.',
            card: { tag: 'PITFALL', title: 'Few Euler steps cut corners', body: 'Four steps follow straight chords. Curved trajectories are cut short and samples land between the modes, shown in red.' },
            deep: '<p><b>Euler</b> (1 network evaluation, NFE, per step), local error O(h²), global O(h):</p>' +
              '<div class="eq">z<sub>i+1</sub> = z<sub>i</sub> + h · v<sub>θ</sub>(z<sub>i</sub>, t<sub>i</sub>),   h = t<sub>i+1</sub> − t<sub>i</sub> &lt; 0</div>' +
              '<p>With N steps the trajectory error shrinks linearly in 1/N. With N = 4 the sampler crosses a quarter of the path per step and cannot follow curvature: the dots move along straight chords and stop where the last chord ends.</p>'
          },
          {
            say: 'Heun\'s second order method corrects for the curvature by evaluating the field twice per step. It costs seven evaluations for four steps, and the dots land much closer to the moons.',
            card: { tag: 'TRADE-OFF', title: 'Second order costs evaluations', body: 'Heun uses 7 network calls for 4 steps but its global error is O(h²) instead of O(h): better accuracy per step, not always per call.' },
            deep: '<p><b>Heun</b> (2 NFE per step, last step Euler as in EDM), global O(h²):</p>' +
              '<div class="eq">z̃ = z<sub>i</sub> + h·v(z<sub>i</sub>, t<sub>i</sub>)<br>z<sub>i+1</sub> = z<sub>i</sub> + (h/2)·( v(z<sub>i</sub>, t<sub>i</sub>) + v(z̃, t<sub>i+1</sub>) )</div>' +
              '<p>The trapezoidal rule averages the slope at both ends of the step. Four steps cost 3·2 + 1 = 7 NFE, because the final step to t = 0 is plain Euler: the velocity formula divides by t, so the second evaluation at t = 0 is undefined (EDM’s Algorithm 2 likewise applies the second-order correction only when the next noise level is nonzero).</p>' +
              '<details><summary>Go deeper</summary><p>Taylor: z(t + h) = z + h·z′ + ½h²·z″ + O(h³). Euler keeps only the first term, so its local error is ½h²·z″ (global O(h)). Heun’s trapezoid estimates z″ ≈ (v(z̃, t + h) − v(z, t)) / h and so also matches the second-order term, leaving O(h³) locally and O(h²) globally. Both errors are proportional to the path curvature z″: on a perfectly straight path Euler is already exact, which is the whole motivation for reflow.</p></details>'
          },
          {
            say: 'Thirty two Euler steps track the field closely, at eight times the cost of the four step run. The dots now hug the moons.',
            card: { tag: 'NUMBERS', title: 'Eight times the calls', stat: { v: '32', u: 'NFE', l: 'Euler steps track the curved paths closely, at 8× the cost of the 4-step run' } },
            deep: '<ul><li>Multistep solvers (DPM-Solver++, UniPC) reuse past velocities for 2nd–3rd order at 1 NFE per step; production video uses 30–50 steps of Euler or UniPC with a shifted schedule.</li>' +
              '<li>Exponential integrators exploit the semi-linear structure of the diffusion ODE, and both DPM-Solver++ and UniPC have direct flow-matching variants.</li>' +
              '<li>ODE versus SDE sampling: re-injecting fresh noise at each step (ancestral or SDE samplers) keeps the same marginals and can correct earlier errors, but it needs many more steps; deterministic ODE samplers are the default for few-step video generation, and they make a seed reproducible.</li>' +
              '<li>Stiffness: the exact marginal velocity divides by t, so it is singular at t = 0. The last step is therefore Euler, and many samplers stop at a small t<sub>min</sub>.</li></ul>'
          },
          {
            say: 'Measured on this toy, the error falls with steps and with solver order. In a video model, too few steps look like blurry, melting motion, because the last step lands on an average of possible outcomes.',
            card: { tag: 'WHY IT MATTERS', title: 'Blur is an average of modes', body: 'The final step lands on <code>E[x₀ | x_t]</code>, a mean over plausible outcomes. In video that is smeared limbs and morphing objects.' },
            deep: '<p>Why few steps blur: the final Euler step from t lands exactly on E[x<sub>0</sub> | x<sub>t</sub>], a <i>conditional mean</i>. When the posterior is still multi-modal (the fox turns left <i>or</i> right), the mean is a ghostly average. In video this shows up as smeared limbs and morphing objects.</p>' +
              '<p>The bars are computed live from this toy: the mean distance of the 500 samples to the nearest data point. Red dots landed more than 0.25 away from any data point.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = newStage(ctx, S);
          ctx.hud('same field, different solvers');
          var cfg = [
            { n: 4, heun: false, name: 'Euler · 4 steps', nfe: 4, col: 'red' },
            { n: 4, heun: true, name: 'Heun · 4 steps', nfe: 7, col: 'amber' },
            { n: 32, heun: false, name: 'Euler · 32 steps', nfe: 32, col: 'lime' }
          ];
          S.P4 = [];
          cfg.forEach(function (c, i) {
            var P = { x: 80 + i * 505, y: 206, s: 430 };
            S.P4.push(P);
            c.traj = simulate(S.fieldAll, S.init, c.n, c.heun);
            var fin = c.traj[c.n], err = 0;
            c.cols = [];
            for (var p = 0; p < 500; p++) { var nn = nearest(S.data, fin[2 * p], fin[2 * p + 1]); err += nn[0] / 500; c.cols.push(nn[0] > 0.25 ? 2 : (nn[1] ? 0 : 1)); }
            c.err = err;
          });
          S.cfg4 = cfg;
          S.tr4 = cfg[2].traj;
          S.pp4 = [0, 0, 0]; S.sh4 = [0, 0, 0];
          var cur = new Float32Array(1000);
          addLayer(S, function (c2) {
            cfg.forEach(function (c, i) {
              if (S.sh4[i] < 0.005) return;
              var P = S.P4[i];
              c2.save(); c2.globalAlpha = c2.globalAlpha * S.sh4[i]; clipPanel(c2, P);
              drawData(c2, P, S.data, 0.4);
              var st = posAt(c.traj, S.pp4[i], cur);
              drawTrails(c2, P, c.traj, st, cur, 60, 'rgba(232,241,255,0.2)');
              drawDots(c2, P, cur, c.cols, ['#8dff5a', '#22e4ff', '#ff4d6d'], 2.2);
              c2.restore();
            });
          });
          function showPanel(i, delay) {
            var f = panelFrame(ctx, g, S.P4[i], cfg[i].name + '  (NFE ' + cfg[i].nfe + ')', cfg[i].col);
            return Promise.all([
              ctx.reveal(f, { delay: delay || 0 }),
              ramp(ctx, S, 500, function (p) { S.sh4[i] = p; }, 'out', delay || 0)
            ]).then(function () {
              return ramp(ctx, S, 2600, function (p) { S.pp4[i] = p; }, 'inOut', 300);
            });
          }
          /* beat 1: Euler with four steps */
          return showPanel(0).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: Heun with four steps */
            return showPanel(1);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: Euler with thirty-two steps */
            return showPanel(2);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: measured error and the meaning for video */
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
              'Heun: z* = z + h·v(z,t);  z ← z + h/2·(v(z,t) + v(z*,t′))',
              'video models: 30–50 steps (Euler / UniPC) or a distilled student'
            ], { size: 13, font: 'mono', color: 'text', lh: 28, parent: B });
            var grow = S.eBars.map(function (b, i) {
              var w = parseFloat(b.getAttribute('width'));
              b.setAttribute('width', 0);
              return ctx.animate(b, { width: [0, w] }, 700, 'out', 300 + i * 200);
            });
            return Promise.all([ctx.reveal(B, { delay: 100 })].concat(grow));
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Coarse to fine',
        beats: [
          {
            say: 'The same process in pixels. On the left is the state the sampler holds. On the right is the model\'s current guess of the final image, available for free as the state minus t times the velocity.',
            card: { tag: 'KEY IDEA', title: 'A free preview at every step', body: '<code>x̂₀ = z_t − t·v</code> is the model’s current guess of the clean image. Decoded at low resolution it drives live previews.' },
            deep: '<p>With a perfect network, z<sub>t</sub> − t·v<sub>θ</sub> recovers the posterior mean:</p>' +
              '<div class="eq">x̂<sub>0</sub>(z<sub>t</sub>) = z<sub>t</sub> − t·v<sub>θ</sub>(z<sub>t</sub>, t) = E[x<sub>0</sub> | z<sub>t</sub>]</div>' +
              '<p>It follows from z<sub>t</sub> = (1 − t)x<sub>0</sub> + tε and v = ε − x<sub>0</sub>. The left image is the actual Euler state z<sub>i+1</sub> = z<sub>i</sub> + h·(z<sub>i</sub> − x̂<sub>0</sub>)/t<sub>i</sub>; the right one is the guess. Here x̂<sub>0</sub> is modelled as a low-pass posterior mean, not a network output.</p>'
          },
          {
            say: 'At high noise the best guess is a blurry average, so layout and colour are decided first: the glowing moon, the horizon, a warm shape where the fox will stand.',
            card: { tag: 'KEY IDEA', title: 'Layout comes first', body: 'At high noise the posterior is wide and its mean is blurry. The moon, horizon and a warm blob for the fox lock in before any detail.' },
            deep: '<p>At high noise the posterior over x<sub>0</sub> is wide, so its mean is blurry: a low-pass version of the image shrunk toward the data mean. The blur radius shrinks as t falls. Composition, meaning where the moon and the fox are, is therefore committed first, while texture is still undetermined.</p>' +
              '<ul><li><b>Previews</b>: decoding x̂<sub>0</sub> at a few steps gives the creator a live, progressively sharpening preview at almost no cost.</li>' +
              '<li>The spectrum on the right shows why: as the noise floor falls, ever finer spatial frequencies rise above it.</li></ul>'
          },
          {
            say: 'Fine detail, like the helmet rim and the eyes, only appears in the last steps. Each snapshot below shows the guess at a later stage.',
            card: { tag: 'HOW IT WORKS', title: 'Detail arrives last', body: 'Helmet rim, fur and eyes only become determinable once the noise falls below their spectral power: in the final steps.' },
            deep: '<p>Detail arrives last: helmet rim, fur, eyes. In video, temporal detail follows the same order: camera path and large motion are committed first, fine motion late.</p>' +
              '<ul><li><b>Caching</b>: consecutive steps change mostly high-frequency content late in sampling, so step-caching methods (e.g. TeaCache, FasterCache) reuse block outputs between nearby steps.</li>' +
              '<li><b>Guidance interval</b>: CFG matters most in the middle band of noise levels (Kynkäänniemi et al., 2024).</li></ul>'
          },
          {
            say: 'Why does layout come first? Natural images have most of their power at low frequencies, while noise is flat. A frequency becomes recoverable only once its power rises above the noise floor.',
            card: { tag: 'WHY IT MATTERS', title: 'Frequencies come back in order', body: 'Image power falls like 1/f² while noise is flat, so the cutoff slides from low to high frequency. Previews and step caching exploit this.', more: '<p>Setting α²S(f_c) = σ² with S(f) = S₀/f² gives f_c = (α/σ)·√S₀: the cutoff scales linearly with the amplitude SNR. Halving the noise level opens one more octave of detail.</p>' },
            deep: '<p>Natural images have a power spectrum S(f) ∝ 1/f<sup>≈2</sup>; Gaussian noise is white. For x<sub>t</sub> = αx<sub>0</sub> + σε the optimal linear denoiser is a Wiener filter:</p>' +
              '<div class="eq">Ĥ(f) = α·S(f) / ( α²·S(f) + σ² )</div>' +
              '<p>A frequency is recoverable only while α²S(f) ≳ σ², so as t falls the cut-off slides to higher frequencies. Reverse sampling therefore generates low frequencies (layout, colour, camera path) first and high frequencies (texture, fur, helmet rim) last, sometimes called <i>spectral autoregression</i> (Dieleman, 2024 blog post).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, I = S.img;
          var g = newStage(ctx, S);
          ctx.hud('x̂₀ preview is free at every step');
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
          var L5 = addLayer(S, function (c2) {
            drawBuf(c2, S.bZ, 90, 216, 300, 'rgba(123,140,171,0.7)');
            drawBuf(c2, S.bX, 440, 216, 300, 'rgba(141,255,90,0.8)');
            S.snaps.forEach(function (b, j) { if (b) drawBuf(c2, b, 90 + j * 110, 610, 96, 'rgba(141,255,90,0.5)'); });
          });
          L5.a = 0;
          var PL = { x: 850, y: 410, w: 600, h: 200 };
          function setStep(i) {
            var t = tOf(Math.min(i, n));
            paintArr(S.bZ, S.states5[i]); paintArr(S.bX, S.xh5[i]);
            snapIdx.forEach(function (si, j) { if (i >= si && !S.snaps[j]) { S.snaps[j] = newBuf(); paintArr(S.snaps[j], S.xh5[si]); S.snapLabs[j].setAttribute('opacity', 1); } });
            S.r5.textContent = 'step ' + i + ' / ' + n + ' · t = ' + t.toFixed(3);
            if (S.cut) {
              /* noise floor in log power: log10(sigma^2/alpha^2) mapped on [-5,1] */
              var a = Math.max(1e-3, 1 - t), sg = Math.max(1e-3, t);
              var lvl = ctx.clamp(Math.log(sg * sg / (a * a)) / Math.LN10, -5, 1);
              var y = PL.y + PL.h * (1 - (lvl + 5) / 6);
              S.noiseLine.setAttribute('y1', y); S.noiseLine.setAttribute('y2', y);
              S.nlab.setAttribute('y', y - 12);
              var fc = ctx.clamp((1 - lvl) / 2, 0, 2.2), x = PL.x + PL.w * fc / 2.2;
              S.cut.setAttribute('x1', x); S.cut.setAttribute('x2', x);
              var nearR = x > PL.x + PL.w - 140;
              S.cutL.setAttribute('x', nearR ? x - 8 : x + 8); S.cutL.setAttribute('y', PL.y + 46);
              S.cutL.setAttribute('text-anchor', nearR ? 'end' : 'start');
              S.cutL.textContent = nearR ? 'all recoverable' : '← recoverable';
            }
            S.dirty = true;
          }
          function sweep(a, b, dur) {
            return ctx.tween(dur, function (p) {
              var i = Math.min(n, Math.floor(a + (b - a) * p + 1e-6));
              if (i !== S.i5 || p >= 1) { S.i5 = i; setStep(i); }
            }, 'linear');
          }
          /* beat 1: the state and the free guess, with the algebra that makes the guess free */
          var lb1 = ctx.text(90, 198, 'z_t · sampler state', { size: 13, font: 'mono', weight: 600, color: 'dim', parent: g });
          var lb2 = ctx.text(440, 198, 'guess: x₀ ≈ z_t − t·v', { size: 13, font: 'mono', weight: 600, color: 'lime', parent: g });
          S.r5 = ctx.text(90, 548, 'step 0 / 30 · t = 1.000', { size: 18, font: 'mono', weight: 700, color: 'lime', parent: g });
          var lb3 = ctx.text(90, 586, 'guess snapshots', { size: 12, font: 'mono', color: 'dim', parent: g });
          var snapLabs = S.snapLabs = snapIdx.map(function (si, j) { var tl = ctx.text(138 + j * 110, 724, 't=' + tOf(si).toFixed(2), { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g }); tl.setAttribute('opacity', 0); return tl; });
          var D = ctx.group({ parent: g });
          ctx.text(820, 210, 'PREVIEW FOR FREE', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: D });
          ctx.text(820, 246, 'z_t = (1 − t)·x₀ + t·ε', { size: 17, font: 'mono', color: 'white', parent: D });
          ctx.text(820, 276, 'v = ε − x₀   ⇒   x₀ = z_t − t·v', { size: 17, font: 'mono', weight: 700, color: 'lime', parent: D });
          ctx.text(820, 306, 'exact for the true velocity; approximate for a real network', { size: 13, font: 'mono', color: 'dim', parent: D });
          setStep(0);
          return Promise.all([
            ctx.reveal([lb1, lb2, S.r5, lb3], { stagger: 60 }),
            ctx.reveal(D, { from: 'right', delay: 300 }),
            ramp(ctx, S, 900, function (p) { L5.a = p; }, 'out', 100)
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the spectrum and the first half of the run */
            var R = ctx.group({ parent: g });
            ctx.text(820, 350, 'WHY LAYOUT COMES FIRST', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: R });
            ctx.text(820, 378, 'image power S(f) ∝ 1/f²   ·   noise power σ² (flat)', { size: 13, font: 'mono', color: 'text', parent: R });
            ctx.plot(PL.x, PL.y, PL.w, PL.h, function (lf) { return 1 - 2 * lf; }, { xDomain: [0, 2.2], yDomain: [-5, 1], color: 'violet', sw: 2.2, xLabel: 'log₁₀ f  →  fine detail', yLabel: 'log power', parent: R });
            [0.5, 0.25, 0.1].forEach(function (tg) {
              var lv = Math.log(tg * tg / ((1 - tg) * (1 - tg))) / Math.LN10, yy = PL.y + PL.h * (1 - (lv + 5) / 6);
              ctx.line(PL.x, yy, PL.x + PL.w, yy, { color: ctx.alpha('red', 0.25), sw: 1, dash: '2 5', parent: R });
              ctx.text(PL.x - 8, yy, 't=' + tg, { size: 11, font: 'mono', color: ctx.alpha('red', 0.85), anchor: 'end', parent: R });
            });
            S.noiseLine = ctx.line(PL.x, PL.y + PL.h * 0.5, PL.x + PL.w, PL.y + PL.h * 0.5, { color: 'red', sw: 2, dash: '6 4', parent: R });
            S.cut = ctx.line(PL.x, PL.y, PL.x, PL.y + PL.h, { color: 'lime', sw: 1.5, parent: R });
            S.cutL = ctx.text(PL.x + 8, PL.y + 46, '', { size: 12, font: 'mono', color: 'lime', parent: R });
            ctx.text(PL.x + 200, PL.y + 24, 'image spectrum S(f)', { size: 12, font: 'mono', color: 'violet', parent: R });
            S.nlab = ctx.text(PL.x + PL.w - 4, PL.y + PL.h * 0.5 - 12, 'noise floor σ²', { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: R });
            setStep(0);
            return Promise.all([
              ctx.reveal(R, { from: 'right' }),
              ctx.wait(700).then(function () { return sweep(0, 15, 2600); })
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the second half, details appear */
            return sweep(15, 30, 2600);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the Wiener-filter explanation */
            var W = ctx.group({ parent: g });
            ctx.text(820, 660, 'Ĥ(f) = α·S(f) / (α²·S(f) + σ²)', { size: 18, font: 'mono', weight: 700, color: 'white', parent: W });
            ctx.para(820, 696, [
              'frequencies above the noise floor survive; as t → 0',
              'the floor drops and finer detail becomes determinable.',
              'Video: composition and motion first, texture last: the',
              'basis for previews, step caching and guidance intervals.'
            ], { size: 14, font: 'mono', color: 'text', lh: 26, parent: W });
            return ctx.reveal(W, { from: 'up' }).then(function () { return ctx.pulse(S.cut, { color: 'lime', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Where to spend steps',
        beats: [
          {
            say: 'Where should training and sampling spend their effort? Stable Diffusion three found that drawing training times from a logit normal distribution, which concentrates on the middle of the path, beats uniform sampling.',
            card: { tag: 'KEY IDEA', title: 'Sample t where learning happens', body: 'Logit-normal(0, 1) concentrates training times mid-path. In SD3’s large sweep it ranked best on average against uniform.', more: '<p>Drawing u ~ N(0, 1) and setting t = sigmoid(u) gives the density π(t) = φ(logit t) / (t(1 − t)), bell-shaped in logit space and vanishing at both ends. For m = 0 and s = 1 it peaks at t = ½ with π(½) = 4φ(0) ≈ 1.6, against 1 for a uniform draw.</p>' },
            deep: '<p><b>Logit-normal training times</b> (in SD3’s large sweep of diffusion and flow formulations, rectified flow with lognorm(0, 1) ranked best on average):</p>' +
              '<div class="eq">t = sigmoid(u),   u ~ N(m, s²)<br>π(t) = 1 / (s√(2π)) · 1 / (t(1 − t)) · exp( −(logit t − m)² / 2s² )</div>' +
              '<p>With m = 0 and s = 1 the density peaks near t = ½ and vanishes at both ends, where t(1 − t) → 0.</p>'
          },
          {
            say: 'The endpoints are easy: near time zero the task is almost the identity, and near time one the best prediction is just the data mean. The middle, where the posterior is genuinely multi modal, carries the learning signal.',
            card: { tag: 'WHY IT MATTERS', title: 'Endpoints teach little', body: 't ≈ 0: nearly the identity. t ≈ 1: predict the data mean. The multi-modal middle carries almost all of the learning signal.' },
            deep: '<p>Endpoints are easy: at t ≈ 0 the input is almost the target, so the network only has to copy; at t ≈ 1 the input carries almost no information about x<sub>0</sub>, so the best prediction is the data mean, whatever the noise. Both give small, nearly constant losses.</p>' +
              '<p>The middle band, where signal and noise are comparable, is where the posterior is genuinely multi-modal and the network must actually decide. Spending training samples there gives the largest gradient signal per step.</p>'
          },
          {
            say: 'At sampling time the schedule is shifted toward high noise. The shift is about three for one megapixel images, and about five to seven for seven twenty p video.',
            card: { tag: 'NUMBERS', title: 'Shift for 720p video', stat: { v: '5 – 7', l: 'timestep shift used for 720p video (Wan 2.1: 5, HunyuanVideo: 7); SD3 uses 3 at 1024²' } },
            deep: '<p><b>Resolution-dependent shift.</b> SD3 maps timesteps with a shift s, so that a uniform grid u becomes</p>' +
              '<div class="eq">t′ = s·t / ( 1 + (s − 1)·t )</div>' +
              '<table><tr><th>Model</th><th>Resolution</th><th>shift</th></tr>' +
              '<tr><td>SD3</td><td>1024²</td><td>3.0</td></tr>' +
              '<tr><td>Wan 2.1 T2V-14B</td><td>1280×720</td><td>5.0</td></tr>' +
              '<tr><td>HunyuanVideo</td><td>1280×720</td><td>≈ 7</td></tr></table>' +
              '<details><summary>Go deeper</summary><p><b>What a shift does to the SNR.</b> With t′ = s·t / (1 + (s − 1)·t), σ′ = t′ and α′ = 1 − t′ = (1 − t) / (1 + (s − 1)·t), so SNR′ = ((1 − t) / (s·t))² = SNR / s². A shift of s divides the signal-to-noise ratio by s² at every grid point, that is, it moves log-SNR by −2 ln s (s = 5: −3.2 nats). It is the same resolution-dependent schedule shift proposed for pixel-space image diffusion (Hoogeboom et al., simple diffusion, 2023), where doubling the side length calls for four times less SNR at the same t.</p></details>'
          },
          {
            say: 'The reason is redundancy: at high resolution neighbouring pixels are so alike that moderate noise barely hides the image. Our clip has one hundred eleven thousand tokens, against four thousand for a one megapixel image.',
            card: { tag: 'NUMBERS', title: 'Bigger sequences, bigger shift', stat: { v: '27×', l: 'more tokens than an SD3 1024² image: 111,600 versus 4,096 after 2×2 patches' } },
            deep: '<p>Averaging n correlated pixels reduces effective noise by ~√n, so the same σ destroys less information at high resolution. To destroy the same amount, time must be pushed toward 1. SD3 parametrises this with α = √(m/n) between token counts m and n:</p>' +
              '<div class="eq">t<sub>m</sub> = α·t<sub>n</sub> / ( 1 + (α − 1)·t<sub>n</sub> )</div>' +
              '<div class="note">Video models also shift with duration: more frames means more redundant tokens and more shift. Many implementations compute the shift from the token count directly (Flux-style “dynamic shifting”).</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = newStage(ctx, S);
          ctx.hud('train on the middle · sample with a shift');
          /* beat 1: logit-normal versus uniform */
          var L = ctx.group({ parent: g });
          ctx.text(100, 200, 'TRAINING: which t to sample?', { size: 14, font: 'mono', weight: 600, color: 'lime', parent: L });
          var rng = ctx.rng(5), bins = 24, cnt = [], NS = 6000;
          for (var b = 0; b < bins; b++) cnt.push(0);
          for (var i = 0; i < NS; i++) { var t = 1 / (1 + Math.exp(-gauss(rng))); cnt[Math.min(bins - 1, Math.floor(t * bins))]++; }
          var dens = cnt.map(function (c) { return c / NS * bins / 1.8; });
          S.hist = ctx.bars(110, 240, 600, 300, dens.map(function () { return 0; }), { color: 'lime', gap: 3, parent: L });
          var ln = ctx.plot(110, 240, 600, 300, function (t) {
            if (t <= 0.001 || t >= 0.999) return 0;
            var l = Math.log(t / (1 - t));
            return Math.exp(-l * l / 2) / Math.sqrt(2 * Math.PI) / (t * (1 - t));
          }, { xDomain: [0, 1], yDomain: [0, 1.8], color: 'amber', sw: 2.5, axes: false, samples: 200, parent: L });
          ctx.plot(110, 240, 600, 300, function () { return 1; }, { xDomain: [0, 1], yDomain: [0, 1.8], color: 'dim', sw: 1.5, axes: false, parent: L }).curve.setAttribute('stroke-dasharray', '6 5');
          ctx.text(110, 560, '0', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
          ctx.text(410, 560, 't', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
          ctx.text(710, 560, '1', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
          ctx.text(592, 250, 'logit-normal(0, 1)', { size: 13, font: 'mono', color: 'amber', parent: L });
          ctx.text(118, 356, 'uniform U(0, 1)', { size: 13, font: 'mono', color: 'dim', parent: L });
          return Promise.all([
            ctx.reveal(L, {}),
            ctx.reveal(ln.curve, { from: 'draw', delay: 300, dur: 1200 }),
            S.hist.update(dens, 1800)
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: what the endpoints and the middle look like */
            var A = ctx.group({ parent: g });
            ctx.rect(110, 240, 100, 300, { rx: 0, fill: ctx.alpha('dim', 0.1), parent: A });
            ctx.rect(610, 240, 100, 300, { rx: 0, fill: ctx.alpha('dim', 0.1), parent: A });
            ctx.rect(250, 240, 320, 300, { rx: 0, fill: ctx.alpha('lime', 0.07), stroke: ctx.alpha('lime', 0.5), sw: 1, dash: '4 5', parent: A });
            ctx.para(160, 580, ['t ≈ 0', 'almost the', 'identity'], { size: 12, font: 'mono', color: 'dim', lh: 18, anchor: 'middle', parent: A });
            ctx.para(660, 580, ['t ≈ 1', 'predict the', 'data mean'], { size: 12, font: 'mono', color: 'dim', lh: 18, anchor: 'middle', parent: A });
            ctx.para(410, 590, ['multi-modal posterior:', 'the network must decide', '→ most gradient signal'], { size: 13, font: 'mono', color: 'lime', lh: 20, anchor: 'middle', parent: A });
            return Promise.all([ctx.reveal(A, {}), ctx.wait(600)]).then(function () { return ctx.pulse(A, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: shifted schedules */
            var Rr = ctx.group({ parent: g });
            ctx.text(880, 200, 'SAMPLING: shifted schedule t′ = s·t / (1 + (s − 1)·t)', { size: 14, font: 'mono', weight: 600, color: 'lime', parent: Rr });
            var sh = [[1, 'dim', 's = 1 · 256² image'], [3, 'cyan', 's = 3 · SD3 1024²'], [5, 'lime', 's = 5 · Wan 720p'], [7, 'amber', 's = 7 · HunyuanVideo 720p']];
            var plots = sh.map(function (s, i) {
              var p = ctx.plot(900, 240, 380, 300, function (t) { return s[0] * t / (1 + (s[0] - 1) * t); }, { color: s[1], sw: 2.2, axes: i === 0, xLabel: i === 0 ? 't (uniform grid)' : null, yLabel: i === 0 ? 't′' : null, parent: Rr });
              var tx = ctx.text(1300, 270 + i * 34, s[2], { size: 13, font: 'mono', color: s[1], parent: Rr });
              tx.setAttribute('opacity', 0);
              return { p: p, tx: tx };
            });
            return Promise.all([ctx.reveal(Rr, {})].concat(plots.map(function (o, i) {
              return Promise.all([ctx.reveal(o.p.curve, { from: 'draw', delay: 300 + i * 350, dur: 900 }), ctx.reveal(o.tx, { delay: 300 + i * 350 })]);
            })));
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the resolution argument and where 50 steps land */
            S.ticks6 = ctx.group({ parent: g });
            ctx.text(1300, 430, '50 steps at s = 5:', { size: 12, font: 'mono', color: 'dim', parent: S.ticks6 });
            for (var k = 0; k <= 50; k++) {
              var u = k / 50, tp = 5 * u / (1 + 4 * u);
              ctx.line(1300 + tp * 230, 450, 1300 + tp * 230, 470, { color: ctx.alpha('lime', 0.8), sw: 1, parent: S.ticks6 });
            }
            ctx.text(1300, 488, 't = 0', { size: 11, font: 'mono', color: 'dim', parent: S.ticks6 });
            ctx.text(1530, 488, '1', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.ticks6 });
            ctx.text(1300, 512, 'dense near high noise', { size: 12, font: 'mono', color: 'lime', parent: S.ticks6 });
            var bt = ctx.group({ parent: g });
            ctx.rect(100, 652, 1440, 196, { rx: 12, fill: 'rgba(6,12,24,0.9)', stroke: ctx.alpha('lime', 0.4), parent: bt });
            ctx.text(128, 678, 'WHY SHIFT WITH RESOLUTION', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: bt });
            ctx.para(128, 712, [
              'Averaging n neighbouring pixels (all ≈ the same colour) cuts the noise std by √n while the signal stays:',
              'a 4× larger image at the same σ still reveals its low frequencies. To destroy the same information,',
              'push t toward 1:  t_m = α·t_n / (1 + (α − 1)·t_n),  α = √(m / n)  (m, n = token counts).',
              'Our 720p clip has 111,600 tokens vs 4,096 for a 1024² SD3 image (after 2×2 patches): long videos need big shifts.'
            ], { size: 14, font: 'mono', color: 'text', lh: 30, parent: bt });
            return Promise.all([ctx.reveal(S.ticks6, { delay: 200 }), ctx.reveal(bt, { from: 'up', delay: 300 })]);
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Classifier-free guidance',
        beats: [
          {
            say: 'Classifier free guidance trades diversity for prompt adherence. Here the condition asks for the upper moon only, so the unconditional field alone would fill both moons.',
            card: { tag: 'HOW IT WORKS', title: 'Extrapolate from the unconditional', body: '<code>v = v∅ + w·(v_c − v∅)</code>: two network calls per step. With w = 1 this is plain conditional sampling.', more: '<p>Since s<sub>c</sub> − s<sub>∅</sub> = ∇log p(c | x) by Bayes, the guided score is s<sub>∅</sub> + w·∇log p(c | x) = ∇log[ p(x) · p(c | x)<sup>w</sup> ]. At w = 1 that is exactly p(x | c); at w &gt; 1 the classifier term is amplified beyond the true conditional.</p>' },
            deep: '<div class="eq">v<sub>w</sub>(z, t) = v<sub>θ</sub>(z, t, ∅) + w · ( v<sub>θ</sub>(z, t, c) − v<sub>θ</sub>(z, t, ∅) )</div>' +
              '<p>In score form this is ∇log p(x) + w·∇log p(c | x): approximately sampling from p(x)·p(c|x)<sup>w</sup>, a sharpened conditional (only approximately, because guided fields at different t are not marginals of one distribution). This is the convention of video codebases such as Wan, where w = 1 means no extrapolation; Ho &amp; Salimans wrote (1 + w)·ε<sub>c</sub> − w·ε<sub>∅</sub>, so their w is one less.</p>' +
              '<p>The toy uses exact fields: v<sub>c</sub> from the upper-moon points plus ~15% mislabelled lower-moon points (like noisy captions), v<sub>∅</sub> from all points.</p>'
          },
          {
            say: 'With guidance one, samples follow the true conditional distribution, including a few stragglers that landed on the wrong moon, like a mis captioned training example.',
            card: { tag: 'KEY IDEA', title: 'Faithful, with stragglers', body: 'At w = 1 the samples follow the conditional distribution, mislabelled 15% included: diversity is kept, prompt adherence is imperfect.' },
            deep: '<ul><li><b>Training</b>: drop the condition for a small fraction of samples (Ho &amp; Salimans found 10–20% about equally good) so one network learns both fields.</li>' +
              '<li><b>Cost</b>: 2 NFE per step (batched cond/uncond, or split across GPUs = CFG parallelism).</li>' +
              '<li><b>w = 1</b> is the true conditional: no extrapolation, one NFE suffices. Real captions are imperfect, so a fraction of samples never quite match the prompt.</li></ul>' +
              '<p>The on-target percentage shown on the stage is computed live from the toy.</p>'
          },
          {
            say: 'With guidance six, the sampler extrapolates away from the unconditional prediction. Nearly every dot is pushed onto the upper moon, and they pile up toward one end of it.',
            card: { tag: 'TRY IT', title: 'Pick your own guidance scale', body: 'Click <b>w = 1, 2, 4, 6 or 10</b> under the right panel to rerun it. On-target climbs to 100% while the spread of the samples keeps shrinking: adherence bought with diversity.' },
            deep: '<p>Raising w multiplies the condition’s log-likelihood ratio, sharpening p(x | c). Samples are pulled toward the mode of the conditional and, in high dimensions, beyond it: toward the extremes of the manifold, which is where oversaturation and off-manifold artifacts come from.</p>' +
              '<p>The chips rerun the 500-particle simulation live with the exact fields. <b>Spread</b> is the root-mean-square distance of the 500 samples from their centroid, a crude diversity measure: it falls steadily as w grows, and samples pile up at one end of the moon instead of covering it.</p>' +
              '<ul><li><b>Video practice</b>: Wan 2.1 w = 5 (its default guide scale); some image-conditioned models use separate text and image scales; the negative prompt replaces ∅ (“blurry, static, distorted…”).</li></ul>'
          },
          {
            say: 'In video, high guidance means crisp prompt following, but also oversaturated colour, less variety, and sometimes frozen motion. Fixes limit the guidance to a middle band of noise levels, or bake it into the model.',
            card: { tag: 'PITFALL', title: 'Oversaturation and frozen motion', body: 'High w burns colour and can freeze motion. Fixes: a guidance interval, APG, CFG-rescale, CFG-Zero*, or guidance distillation.' },
            deep: '<ul><li><b>Failure modes</b>: oversaturation, low diversity, off-manifold artifacts at high w. Fixes: CFG-rescale, APG (down-weight the parallel component), guidance only in a middle t-interval (Kynkäänniemi et al. 2024), CFG-Zero*.</li>' +
              '<li><b>Guidance distillation</b> bakes w into a student that needs 1 NFE per step.</li></ul>' +
              '<details><summary>Go deeper</summary><p><b>APG.</b> Write the guidance direction Δ = v<sub>c</sub> − v<sub>∅</sub> and split it into a part parallel to the conditional prediction and a part orthogonal to it. The parallel part mostly inflates the norm of the result and drives oversaturation; the orthogonal part carries the quality gain. Adaptive projected guidance (Sadat et al., 2024) keeps the orthogonal part at full strength, damps the parallel part and adds momentum, so large w stops burning colour. <b>CFG-rescale</b> instead renormalises the guided prediction to the standard deviation of the conditional one. <b>Guidance interval</b> (Kynkäänniemi et al., 2024) switches guidance off at very high noise, where it mainly reduces diversity, and at very low noise, where it is wasted compute.</p></details>' +
              '<div class="note">The image pair on the right is illustrative (contrast and saturation push), not a model output.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, I = S.img;
          var g = newStage(ctx, S);
          ctx.hud('CFG: 2× compute per step');
          var fu = S.fieldAll, fc = S.fieldUp;
          function guided(w) { return function (a, b, t) { var u = fu(a, b, t), c = fc(a, b, t); return [u[0] + w * (c[0] - u[0]), u[1] + w * (c[1] - u[1])]; }; }
          var cfgs = [{ w: 1, col: 'cyan' }, { w: 6, col: 'amber' }];
          /* simulate one guidance scale: trajectories, on-target colouring, on-target fraction and rms spread around the centroid */
          function evalCfg(c) {
            c.traj = simulate(guided(c.w), S.init, 24, false);
            var fin = c.traj[24], on = 0, mx = 0, my = 0, p;
            c.cols = [];
            for (p = 0; p < 500; p++) {
              var nn = nearest(S.data, fin[2 * p], fin[2 * p + 1]), ok = nn[1] === 1 && nn[0] < 0.25;
              if (ok) on++;
              c.cols.push(ok ? 0 : 1);
              mx += fin[2 * p] / 500; my += fin[2 * p + 1] / 500;
            }
            var vr = 0;
            for (p = 0; p < 500; p++) { var ddx = fin[2 * p] - mx, ddy = fin[2 * p + 1] - my; vr += (ddx * ddx + ddy * ddy) / 500; }
            c.frac = on / 500; c.spread = Math.sqrt(vr);
          }
          S.P7 = [];
          cfgs.forEach(function (c, i) {
            S.P7.push({ x: 80 + i * 480, y: 206, s: 440 });
            evalCfg(c);
          });
          S.cfg7 = cfgs;
          S.pt7 = [];
          S.pp7 = [0, 0]; S.sh7 = [0, 0];
          S.bW1 = newBuf(); S.bW6 = newBuf(); S.im7 = 0;
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
              if (S.sh7[i] < 0.005) return;
              var P = S.P7[i];
              c2.save(); c2.globalAlpha = c2.globalAlpha * S.sh7[i]; clipPanel(c2, P);
              drawData(c2, P, S.data, 0.18, 0);
              drawData(c2, P, S.data, 0.6, 1);
              var st = posAt(c.traj, S.pp7[i], cur);
              drawTrails(c2, P, c.traj, st, cur, 50, 'rgba(232,241,255,0.16)');
              drawDots(c2, P, cur, c.cols, ['#8dff5a', '#ff7eb6'], 2.3);
              c2.restore();
            });
            if (S.im7 > 0.005) {
              c2.save(); c2.globalAlpha = c2.globalAlpha * S.im7;
              drawBuf(c2, S.bW1, 1070, 470, 180, 'rgba(34,228,255,0.8)');
              drawBuf(c2, S.bW6, 1310, 470, 180, 'rgba(255,191,58,0.8)');
              c2.restore();
            }
          });
          function panelTitle(w) { return 'w = ' + w + (w <= 1 ? '  (no extrapolation)' : (w <= 4 ? '  (moderate guidance)' : '  (strong guidance)')); }
          function showPanel(i) {
            var f = panelFrame(ctx, g, S.P7[i], panelTitle(cfgs[i].w), cfgs[i].col);
            S.pt7[i] = f.lastChild;   /* the title text, updated when the viewer picks another w */
            return Promise.all([ctx.reveal(f, {}), ramp(ctx, S, 500, function (p) { S.sh7[i] = p; }, 'out')]);
          }
          function readout(i) { return 'w = ' + cfgs[i].w + ': ' + Math.round(cfgs[i].frac * 100) + '% on target · spread ' + cfgs[i].spread.toFixed(2); }
          /* beat 1: the setup: two empty panels with the data, and the guided-velocity formula */
          var R = ctx.group({ parent: g });
          ctx.text(1060, 210, 'GUIDED VELOCITY', { size: 12, font: 'mono', weight: 600, color: 'dim', spacing: 2, parent: R });
          ctx.text(1060, 246, 'v = v∅ + w·(v_c − v∅)', { size: 24, font: 'mono', weight: 700, color: 'white', parent: R });
          ctx.para(1060, 290, [
            'c = "upper moon" (think: "fox")',
            '∅ = empty / negative prompt',
            '2 network evaluations per step'
          ], { size: 14, font: 'mono', color: 'text', lh: 26, parent: R });
          var B1 = ctx.text(80, 700, 'green: sample on the conditioned (upper) moon   ·   pink: straggler elsewhere', { size: 14, font: 'mono', color: 'text', parent: g });
          S.frac7 = ctx.text(1060, 390, '', { size: 14, font: 'mono', color: 'lime', parent: R });
          S.frac7b = ctx.text(1060, 416, '', { size: 14, font: 'mono', color: 'amber', parent: R });
          return Promise.all([showPanel(0), showPanel(1), ctx.reveal(R, { from: 'right', delay: 200 }), ctx.reveal(B1, { delay: 400 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 2: w = 1 */
            return ramp(ctx, S, 3200, function (p) { S.pp7[0] = p; }, 'inOut').then(function () {
              S.frac7.textContent = readout(0);
              return ctx.reveal(S.frac7, {});
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: w = 6, then w chips let the viewer rerun the right panel with another scale */
            var B2 = ctx.text(80, 732, 'larger w sharpens p(x)·p(c|x)^w: better adherence, but samples clump and diversity collapses', { size: 14, font: 'mono', color: 'text', parent: g });
            var wv = [1, 2, 4, 6, 10], xw = 568, wc = ctx.group({ parent: g });
            S.wchips = wv.map(function (w) {
              var chp = ctx.label(xw, 668, 'w=' + w, { color: 'amber', size: 12, anchor: 'start', parent: wc });
              xw += chp.w + 8;
              chp.style.cursor = 'pointer';
              chp.rectEl.setAttribute('fill', ctx.alpha('amber', w === 6 ? 0.5 : 0.1));
              chp.addEventListener('click', function () { rerun(w); });
              return chp;
            });
            ctx.text(xw + 6, 668, '◂ click to rerun', { size: 12, font: 'mono', color: 'dim', parent: wc });
            function rerun(w) {
              if (S.busy7 || ctx.dead) return;
              S.busy7 = true;
              cfgs[1].w = w;
              evalCfg(cfgs[1]);
              S.pp7[1] = 0; S.dirty = true;
              S.pt7[1].textContent = panelTitle(w);
              S.frac7b.textContent = 'w = ' + w + ': …';
              S.wchips.forEach(function (chp, k) { chp.rectEl.setAttribute('fill', ctx.alpha('amber', wv[k] === w ? 0.5 : 0.1)); });
              return ramp(ctx, S, 2400, function (p) { S.pp7[1] = p; }, 'inOut').then(function () {
                S.frac7b.textContent = readout(1);
                S.busy7 = false;
              });
            }
            S.busy7 = true;   /* chips ignore clicks until the first run has finished */
            return Promise.all([ctx.reveal(B2, { delay: 300 }), ctx.reveal([wc], { from: 'up', delay: 400 }), ramp(ctx, S, 3200, function (p) { S.pp7[1] = p; }, 'inOut')]).then(function () {
              S.frac7b.textContent = readout(1);
              S.busy7 = false;
              return ctx.reveal(S.frac7b, {});
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: what it looks like in video, and the fixes */
            var Rb = ctx.group({ parent: g });
            ctx.text(1160, 668, 'w ≈ 1', { size: 13, font: 'mono', color: 'cyan', anchor: 'middle', parent: Rb });
            ctx.text(1400, 668, 'high w (illustrative)', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', parent: Rb });
            var B3 = ctx.text(80, 764, 'fixes: guidance interval (mid-t only), CFG-rescale / APG, CFG-Zero*, or distill the guidance into the student', { size: 14, font: 'mono', color: 'text', parent: g });
            return Promise.all([
              ctx.reveal(Rb, { delay: 300 }),
              ctx.reveal(B3, { delay: 500 }),
              ramp(ctx, S, 900, function (p) { S.im7 = p; }, 'out')
            ]);
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Few-step distillation',
        beats: [
          {
            say: 'Fifty steps with guidance means one hundred network evaluations per clip, about an hour on a single H one hundred GPU. The teacher\'s paths are curved, which is why it needs so many steps.',
            card: { tag: 'NUMBERS', title: 'The teacher\'s bill', stat: { v: '100', u: 'NFE', l: '50 solver steps × 2 (guidance), each a full DiT forward: about 54 H100-minutes per clip' }, more: '<p>32.6 s per NFE = 1.29 × 10¹⁶ FLOPs / (0.4 × 989 × 10¹² FLOP/s). 100 NFE ≈ 3,260 s ≈ 54 minutes; a 4-step student without guidance ≈ 130 s. On 8 GPUs with ideal sequence parallelism divide by 8, before communication losses.</p>' },
            deep: '<div class="eq">cost ≈ NFE × 1.29×10¹⁶ FLOPs,   NFE = 50 steps × 2 (CFG) = 100</div>' +
              '<p>Every NFE is a full 14B forward over 111,600 tokens. At 40% MFU on one H100 that is ~32 s, so 100 NFE ≈ 54 minutes on one GPU, or roughly 7 minutes with ideal 8-way sequence parallelism.</p>' +
              '<p>The curved teacher paths from step 3 are the reason: an Euler step assumes a straight line, so accuracy needs small steps. Distillation attacks either the number of steps or the curvature.</p>'
          },
          {
            say: 'Reflow retrains on the model\'s own noise and output pairs, so the paths become nearly straight and one or two Euler steps suffice.',
            card: { tag: 'HOW IT WORKS', title: 'Reflow straightens paths', body: 'Retrain on (ε, teacher output) pairs: couplings become straight lines, so a 1–2 step Euler solve is nearly exact.' },
            deep: '<table><tr><th>Family</th><th>Objective (sketch)</th><th>Steps</th></tr>' +
              '<tr><td>Reflow (Rectified Flow, InstaFlow)</td><td>retrain on couplings (ε, Φ<sub>teacher</sub>(ε)) → straight paths</td><td>1–2</td></tr></table>' +
              '<p>After one round of reflow, the new velocity field is trained on pairs that no longer cross in the ideal case, so its ODE trajectories are straighter and one Euler step is more accurate. Real reflow straightens paths only approximately, and each round costs a fresh teacher sampling pass.</p>'
          },
          {
            say: 'Consistency models take a different route: they learn to jump from any point on a trajectory straight to its end, whatever the time.',
            card: { tag: 'HOW IT WORKS', title: 'Jump to the end of the path', body: 'A consistency function maps every point of one ODE trajectory to the same endpoint: <code>f(x_t, t) = f(x_t′, t′)</code>.' },
            deep: '<table><tr><th>Family</th><th>Objective (sketch)</th><th>Steps</th></tr>' +
              '<tr><td>Consistency (CM, LCM, sCM)</td><td>f<sub>θ</sub>(x<sub>t</sub>, t) = f<sub>θ⁻</sub>(x<sub>t′</sub>, t′) along one ODE path, f(x, 0) = x</td><td>1–4</td></tr></table>' +
              '<p>Song et al. train f either by distilling a pre-trained diffusion model (consistency distillation) or from scratch. sCM (Lu &amp; Song, 2025) makes the continuous-time version stable enough to scale, and LCM applies it in latent space with guidance folded in.</p>'
          },
          {
            say: 'Distribution matching and adversarial training teach a student to match the teacher\'s outputs directly. Open video families now ship step distilled models that run in roughly four to twelve steps, and a four step student saves a factor of twenty five in network evaluations, at some cost in diversity.',
            card: { tag: 'STATE OF THE ART', title: 'Four-step students ship', body: 'DMD2, CausVid and Self Forcing students run 4 steps; Seaweed-APT makes 2 s of 720p video in one step. The cost is some diversity loss.' },
            deep: '<table><tr><th>Family</th><th>Objective (sketch)</th><th>Steps</th></tr>' +
              '<tr><td>DMD / DMD2</td><td>min KL(p<sub>student</sub> ‖ p<sub>teacher</sub>) via score difference</td><td>1–4</td></tr>' +
              '<tr><td>Adversarial (ADD, LADD, APT)</td><td>GAN loss, teacher-initialised discriminator</td><td>1–4</td></tr></table>' +
              '<div class="eq">∇<sub>θ</sub>KL ≈ E<sub>z,t</sub>[ ( s<sub>fake</sub>(x<sub>t</sub>, t) − s<sub>real</sub>(x<sub>t</sub>, t) ) · ∂G<sub>θ</sub>(z)/∂θ ]</div>' +
              '<p>s<sub>real</sub> is the frozen teacher score, s<sub>fake</sub> a critic trained online on student samples. <b>Video</b>: CausVid distils a bidirectional DiT into a 4-step causal student; Seaweed-APT makes 2 s of 720p video in one step. <b>Budget</b>: 100 → 4 NFE is 25×; guidance distillation alone halves it. Teams keep the teacher for hero shots.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = newStage(ctx, S);
          ctx.hud('100 NFE → 4 NFE: 25× cheaper');
          var P = { x: 80, y: 206, s: 500 };
          var T = S.tr4, n = T.length - 1, fin = T[n], mid = Math.floor(n / 2);
          S.p8a = 0; S.p8b = 0; S.j8 = 0;
          var cur = new Float32Array(1000), one = new Float32Array(1000);
          var cols = [];
          for (var i = 0; i < 500; i++) cols.push(nearest(S.data, fin[2 * i], fin[2 * i + 1])[1] ? 0 : 1);
          var L8 = addLayer(S, function (c2) {
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
            /* consistency jumps: from t = 0.5 on the teacher path straight to the end */
            if (S.j8 > 0.005) {
              c2.save(); c2.globalAlpha = c2.globalAlpha * S.j8;
              c2.strokeStyle = 'rgba(34,228,255,0.9)'; c2.lineWidth = 1.4; c2.setLineDash([4, 4]); c2.beginPath();
              for (var i3 = 0; i3 < 36; i3++) {
                var s0 = toPx(P, T[mid][2 * i3], T[mid][2 * i3 + 1]), s1 = toPx(P, fin[2 * i3], fin[2 * i3 + 1]);
                c2.moveTo(s0[0], s0[1]); c2.lineTo(s1[0], s1[1]);
              }
              c2.stroke(); c2.setLineDash([]);
              c2.fillStyle = '#22e4ff'; c2.beginPath();
              for (var i4 = 0; i4 < 36; i4++) {
                var s2 = toPx(P, T[mid][2 * i4], T[mid][2 * i4 + 1]);
                c2.moveTo(s2[0] + 3.4, s2[1]); c2.arc(s2[0], s2[1], 3.4, 0, 6.2832);
              }
              c2.fill();
              c2.restore();
            }
            c2.restore();
          });
          L8.a = 0;
          var fr = panelFrame(ctx, g, P, 'few-step sampling of the two-moons toy', 'lime');
          S.l8 = ctx.text(80, 740, 'teacher: 32 Euler steps along curved paths', { size: 14, font: 'mono', weight: 600, color: 'amber', parent: g });
          /* NFE ladder, one row per beat */
          var nb = ctx.group({ parent: g });
          ctx.text(640, 530, 'NETWORK EVALUATIONS PER CLIP  ·  wall-clock on 1 H100 (720p, 5 s, 14B)', { size: 12, font: 'mono', weight: 600, color: 'dim', parent: nb });
          var rows = [['teacher: 50 steps + CFG', 100, 'amber', '100 NFE · ~54 min'], ['reflow: 2 steps', 2, 'lime', '2 NFE · ~1 min'], ['consistency / DMD2: 4 steps', 4, 'violet', '4 NFE · ~2 min'], ['adversarial (APT): 1 step', 1, 'pink', '1 NFE · ~30 s']];
          function nfeRow(i) {
            var r = rows[i], y = 556 + i * 44, rg = ctx.group({ parent: nb });
            ctx.text(870, y + 14, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: rg });
            var w = Math.max(3, 420 * r[1] / 100);
            var b = ctx.rect(884, y, w, 28, { rx: 4, fill: ctx.alpha(r[2], 0.45), stroke: r[2], sw: 1, parent: rg });
            var tx = ctx.text(884 + w + 10, y + 14, r[3], { size: 13, font: 'mono', color: r[2], parent: rg });
            b.setAttribute('width', 0); tx.setAttribute('opacity', 0);
            return Promise.all([ctx.reveal(rg, {}), ctx.animate(b, { width: [0, w] }, 700, 'out', 300), ctx.reveal(tx, { delay: 700 })]);
          }
          function methodCard(i) {
            var cards = [
              ['Reflow / Rectified Flow', 'train on (ε, Φ_teacher(ε)) couplings', 'paths straighten → 1–2 steps', 'lime'],
              ['Consistency models', 'f_θ(x_t, t) = f_θ⁻(x_t′, t′) on one path', 'LCM, sCM → 1–4 steps', 'cyan'],
              ['DMD / DMD2', '∇KL ≈ (s_fake − s_real)·∂G/∂θ', 'CausVid: 4-step causal video', 'violet'],
              ['Adversarial (ADD / APT)', 'GAN loss, teacher-initialised D', 'Seaweed-APT: 1-step 720p', 'pink']
            ];
            var c = cards[i], cg = ctx.group({ parent: g });
            var x = 640 + (i % 2) * 455, y = 196 + Math.floor(i / 2) * 150;
            ctx.rect(x, y, 440, 134, { rx: 10, fill: 'rgba(6,12,24,0.9)', stroke: ctx.alpha(c[3], 0.7), sw: 1.3, parent: cg });
            ctx.text(x + 18, y + 30, c[0], { size: 17, font: 'display', weight: 700, color: c[3], parent: cg });
            ctx.text(x + 18, y + 70, c[1], { size: 13, font: 'mono', color: 'text', parent: cg });
            ctx.text(x + 18, y + 102, c[2], { size: 13, font: 'mono', color: 'dim', parent: cg });
            return ctx.reveal(cg, { from: 'up', delay: 200 });
          }
          /* beat 1: the teacher */
          var t8 = ctx.text(640, 760, 'every NFE is a full 14B forward over 111,600 tokens (≈1.3×10¹⁶ FLOPs)', { size: 13, font: 'mono', color: 'lime', parent: g });
          return Promise.all([
            ctx.reveal(fr, {}),
            ctx.reveal([S.l8, nb, t8], { stagger: 150 }),
            ramp(ctx, S, 500, function (p) { L8.a = p; }, 'out'),
            nfeRow(0),
            ramp(ctx, S, 2600, function (p) { S.p8a = p; }, 'inOut', 500)
          ]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: reflow */
            S.l8.textContent = 'student: straight couplings, 1 step';
            S.l8.setAttribute('fill', ctx.C.lime);
            return Promise.all([methodCard(0), nfeRow(1), ramp(ctx, S, 2600, function (p) { S.p8b = p; }, 'inOut', 300)]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: consistency */
            S.l8.textContent = 'consistency: jump from t = 0.5 straight to the endpoint';
            S.l8.setAttribute('fill', ctx.C.cyan);
            return Promise.all([methodCard(1), nfeRow(2), ramp(ctx, S, 1200, function (p) { S.j8 = p; }, 'out', 300)]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: DMD and adversarial students, the trade-off */
            var t9 = ctx.text(640, 790, 'trade-off: some diversity loss; teacher kept for hero shots, student for drafts', { size: 13, font: 'mono', color: 'dim', parent: g });
            return Promise.all([methodCard(2), methodCard(3), nfeRow(3), ctx.reveal(t9, { from: 'up', delay: 600 })]);
          });
        }
      }
    ]
  });
})();
