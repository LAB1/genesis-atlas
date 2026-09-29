/* L2 — Diffusion Transformer (DiT). One forward pass of the video denoiser: spacetime patches, full 3D
 * self-attention vs factorized attention, 3D RoPE, adaLN-Zero timestep modulation, text conditioning
 * (cross-attention vs MM-DiT) and the n^2 cost wall with sparse attention. */
(function () {
  var ROAD = ['latent', 'patchify', 'attention', 'factorize', '3D RoPE', 'adaLN', 'text', 'n² wall', 'scale'];
  /* attention demo geometry: 5 latent frames x 6 x 8 tokens */
  var K = 5, RR = 6, CC = 8, CELL = 26, GAP = 3;
  var FX0 = 105, FSTEP = 290, FY = 296;
  var FW = CC * (CELL + GAP) - GAP, FH = RR * (CELL + GAP) - GAP;
  var TLAB = [0, 5, 10, 15, 20];

  /* SVG collapses runs of spaces: keep code alignment with non-breaking spaces */
  function nb(s) { return s.replace(/ {2,}/g, function (m) { return new Array(m.length + 1).join(' '); }); }

  function buildRoad(ctx, S) {
    S.roadG = ctx.group();
    S.pills = ROAD.map(function (s, i) {
      var x = 842 + i * 80;
      var r = ctx.rect(x, 88, 74, 24, { rx: 12, fill: 'rgba(255,255,255,0.03)', stroke: ctx.C.line, sw: 1, parent: S.roadG });
      var t = ctx.text(x + 37, 100.5, s, { size: 11, font: 'mono', anchor: 'middle', color: 'dim', parent: S.roadG });
      return { r: r, t: t };
    });
    ctx.reveal(S.roadG, { from: 'down', dur: 400 });
  }
  function road(ctx, S, i) {
    S.pills.forEach(function (p, k) {
      var on = k === i, seen = k < i;
      p.r.setAttribute('stroke', on ? ctx.C.lime : (seen ? ctx.alpha('lime', 0.45) : ctx.C.line));
      p.r.setAttribute('fill', on ? ctx.alpha('lime', 0.25) : 'rgba(255,255,255,0.03)');
      p.t.setAttribute('fill', on ? ctx.C.white : (seen ? ctx.C.lime : ctx.C.dim));
    });
  }
  /* retire the previous step's main group and open a fresh one */
  function swap(ctx, S, idx) {
    road(ctx, S, idx);
    var old = S.cur;
    S.cur = ctx.group();
    if (old) ctx.fadeOut(old, 450, true);
    return S.cur;
  }

  /* synthetic latent content: a bright "fox" blob crash-landing across frames k, ice at the bottom */
  function latentVal(k, r, c, rows, cols) {
    var u = (c + 0.5) / cols, v = (r + 0.5) / rows;
    var cu = 0.22 + 0.13 * k, cv = 0.25 + 0.1 * k;
    var d2 = (u - cu) * (u - cu) + (v - cv) * (v - cv) * 1.4;
    var val = 0.1 + 0.88 * Math.exp(-d2 / 0.02);
    if (v > 0.8) val = Math.max(val, 0.36 + 0.12 * Math.sin(u * 9 + k));
    return Math.min(1, val);
  }

  /* a stack of 5 latent frames (back to front) drawn as matrices */
  function drawStack(ctx, parent, x, y, kind, seed) {
    var g = ctx.group({ parent: parent });
    var rnd = ctx.rng(seed), mats = [], noise = [], clean = [];
    for (var j = 0; j < 5; j++) {
      var o = 4 - j, fx = x + o * 20, fy = y - o * 18;
      ctx.rect(fx - 8, fy - 8, 264, 180, { rx: 6, fill: '#08101f', stroke: ctx.alpha(kind === 'out' ? 'cyan' : 'lime', 0.5), sw: 1.2, parent: g });
      var nz = [], cl = [], vals = [];
      for (var r = 0; r < 6; r++) {
        nz.push([]); cl.push([]); vals.push([]);
        for (var c = 0; c < 9; c++) {
          var n0 = rnd(), c0 = latentVal(j, r, c, 6, 9);
          nz[r].push(n0); cl[r].push(c0);
          vals[r].push(kind === 'out' ? ctx.clamp((n0 - 0.5) * 1.5 - (c0 - 0.3) * 0.9, -1, 1) : n0);
        }
      }
      noise.push(nz); clean.push(cl);
      mats.push(ctx.matrix(fx, fy, 6, 9, { cell: 24, gap: 4, cmap: kind === 'out' ? 'diverge' : 'lime', values: vals, parent: g }));
    }
    return { g: g, mats: mats, noise: noise, clean: clean };
  }

  /* ---------- attention demo ---------- */
  function foxPos(k) { return { r: 1 + 0.75 * k, c: 1 + 1.45 * k }; }
  function cls(k, r, c) {
    var fp = foxPos(k);
    if (Math.hypot(r - fp.r, (c - fp.c) * 0.9) < 1.25) return 'fox';
    if (r >= 5) return 'ice';
    return 'sky';
  }
  function logit(q, k, r, c) {
    var a = cls(q.k, q.r, q.c), b = cls(k, r, c);
    var aff = a === b ? (a === 'fox' ? 4.2 : 2.2) : 0;
    return aff - 0.28 * Math.hypot(r - q.r, c - q.c) - 0.18 * Math.abs(k - q.k);
  }
  function allowed(mode, q, k, r, c) {
    if (mode === 'spatial') return k === q.k;
    if (mode === 'temporal') return r === q.r && c === q.c;
    return true;
  }
  function cellXY(k, r, c) { return { x: FX0 + k * FSTEP + c * (CELL + GAP) + CELL / 2, y: FY + r * (CELL + GAP) + CELL / 2 }; }

  function attnUpdate(ctx, S) {
    var q = S.q, mode = S.mode || 'full';
    var P = [], mx = -1e9, k, r, c, i;
    for (k = 0; k < K; k++) for (r = 0; r < RR; r++) for (c = 0; c < CC; c++) {
      var l = allowed(mode, q, k, r, c) ? logit(q, k, r, c) : null;
      P.push(l);
      if (l !== null && l > mx) mx = l;
    }
    var Z = 0;
    P = P.map(function (l) { if (l === null) return -1; var e = Math.exp(l - mx); Z += e; return e; });
    var pmax = 0;
    P = P.map(function (e) { if (e < 0) return -1; var p = e / Z; if (p > pmax) pmax = p; return p; });
    var mass = [0, 0, 0, 0, 0], best = [];
    for (k = 0; k < K; k++) best.push({ p: -1, r: 0, c: 0 });
    S.fills = [];
    i = 0;
    for (k = 0; k < K; k++) for (r = 0; r < RR; r++) for (c = 0; c < CC; c++) {
      var p = P[i];
      var fill = p < 0 ? '#060a12' : ctx.cmap('heat', Math.pow(p / pmax, 0.4));
      S.fills.push(fill);
      S.acells[k].cells[r][c].setAttribute('fill', fill);
      S.strip[i].setAttribute('fill', fill);
      if (p >= 0) {
        mass[k] += p;
        if (!(k === q.k && r === q.r && c === q.c) && p > best[k].p) best[k] = { p: p, r: r, c: c };
      }
      i++;
    }
    for (k = 0; k < K; k++) S.flab[k].textContent = 't = ' + TLAB[k] + '  ·  ' + Math.round(mass[k] * 100) + '%';
    var qp = cellXY(q.k, q.r, q.c);
    S.qRing.setAttribute('x', qp.x - CELL / 2 - 3); S.qRing.setAttribute('y', qp.y - CELL / 2 - 3);
    while (S.rays.firstChild) S.rays.removeChild(S.rays.firstChild);
    S.rayEls = [];
    for (k = 0; k < K; k++) {
      if (best[k].p < 0 || (k === q.k && mode !== 'spatial')) continue;
      if (mode === 'spatial' && k !== q.k) continue;
      var tp = cellXY(k, best[k].r, best[k].c);
      var lift = 60 + 22 * Math.abs(k - q.k);
      var d = 'M' + qp.x + ',' + (qp.y - 6) + ' Q' + ((qp.x + tp.x) / 2) + ',' + (Math.min(qp.y, tp.y) - lift) + ' ' + tp.x + ',' + (tp.y - 6);
      var op = Math.max(0.35, Math.min(1, Math.sqrt(mass[k] * 2.5)));
      S.rayEls.push(ctx.path(d, { stroke: 'amber', sw: 1.6, arrow: true, opacity: op, parent: S.rays }));
    }
    if (S.modeChips) S.modeChips.forEach(function (m) {
      var on = m.mode === mode;
      m.r.setAttribute('fill', on ? ctx.alpha('lime', 0.3) : 'rgba(255,255,255,0.03)');
      m.r.setAttribute('stroke', on ? ctx.C.lime : ctx.C.line);
      m.t.setAttribute('fill', on ? ctx.C.white : ctx.C.dim);
    });
    if (S.warn) S.warn.setAttribute('opacity', mode === 'temporal' ? 1 : 0);
  }

  /* ---------- RoPE helpers ---------- */
  function ropeMeanCos(delta, dA, theta) {
    var n = dA / 2, s = 0;
    for (var i = 0; i < n; i++) s += Math.cos(delta * Math.pow(theta || 10000, -2 * i / dA));
    return s / n;
  }

  function gauss(mu, sd) { return function (x) { return Math.exp(-0.5 * Math.pow((x - mu) / sd, 2)) / (sd * Math.sqrt(2 * Math.PI)); }; }

  /* ---------- sparse masks (tile level): 20 tiles = 4 temporal x 5 spatial ---------- */
  function maskOn(mode, a, b) {
    var ta = Math.floor(a / 5), ha = a % 5, tb = Math.floor(b / 5), hb = b % 5;
    var dt = Math.abs(ta - tb), dh = Math.abs(ha - hb);
    if (mode === 'sta') return dt <= 1 && dh <= 1;
    if (mode === 'radial') return dh <= Math.floor(2 / Math.pow(2, dt));
    return true;
  }
  function maskUpdate(ctx, S) {
    var mode = S.mask || 'dense', on = 0;
    S.mm.set(function (r, c) {
      var v = maskOn(mode, r, c);
      if (v) on++;
      var diag = Math.floor(r / 5) === Math.floor(c / 5);
      return v ? (diag ? ctx.alpha('lime', 0.95) : ctx.alpha('lime', 0.6)) : '#0a1120';
    });
    var dens = on / 400;
    S.densT.textContent = Math.round(dens * 100) + '%';
    S.densS.textContent = '≈ ' + (1 / dens).toFixed(1) + '× fewer attention FLOPs';
    S.maskChips.forEach(function (m) {
      var sel = m.mode === mode;
      m.r.setAttribute('fill', sel ? ctx.alpha('lime', 0.3) : 'rgba(255,255,255,0.03)');
      m.r.setAttribute('stroke', sel ? ctx.C.lime : ctx.C.line);
      m.t.setAttribute('fill', sel ? ctx.C.white : ctx.C.dim);
    });
  }

  function chip(ctx, parent, x, y, w, str, onClick) {
    var g = ctx.group({ parent: parent });
    var r = ctx.rect(x - w / 2, y - 13, w, 26, { rx: 13, fill: 'rgba(255,255,255,0.03)', stroke: ctx.C.line, sw: 1.2, parent: g });
    var t = ctx.text(x, y + 0.5, str, { size: 11.5, font: 'mono', anchor: 'middle', color: 'dim', weight: 600, parent: g });
    g.style.cursor = 'pointer';
    g.addEventListener('click', onClick);
    return { g: g, r: r, t: t };
  }

  Atlas.register({
    id: 'dit',
    refs: [
      'Peebles &amp; Xie, <i>Scalable Diffusion Models with Transformers (DiT, adaLN-Zero)</i>, ICCV 2023',
      'Esser et al., <i>Scaling Rectified Flow Transformers for High-Resolution Image Synthesis</i> (SD3, MM-DiT), ICML 2024',
      'Wan Team (Alibaba), <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025',
      'Kong et al., <i>HunyuanVideo: A Systematic Framework for Large Video Generative Models</i>, arXiv 2412.03603, 2024',
      'Yang et al., <i>CogVideoX: Text-to-Video Diffusion Models with an Expert Transformer</i>, ICLR 2025',
      'Su et al., <i>RoFormer: Enhanced Transformer with Rotary Position Embedding</i>, Neurocomputing 2024; Zhao et al., <i>RIFLEx</i>, ICML 2025',
      'Bertasius et al., <i>Is Space-Time Attention All You Need for Video Understanding? (TimeSformer)</i>, ICML 2021',
      'Zhang et al., <i>Fast Video Generation with Sliding Tile Attention</i>, ICML 2025; Li et al., <i>Radial Attention: O(n log n) Sparse Attention with Energy Decay for Long Video Generation</i>, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'The denoiser',
        say: 'Zoom into the heart of the video model. At every sampling step, a diffusion transformer receives a noisy video latent, the current noise level, and the encoded prompt, and it predicts a velocity: the direction that carries noise toward a clean video. For one five second shot of our fox astronaut, the sampler takes fifty steps, and the network runs twice per step because of classifier free guidance. That is one hundred passes through a fourteen billion parameter transformer. This chamber is about what happens inside one pass.',
        deep: '<p>The DiT is the learned vector field of a flow-matching / diffusion sampler. With the rectified-flow convention used by SD3, Wan and HunyuanVideo:</p>' +
          '<div class="eq">z<sub>σ</sub> = (1−σ)·x + σ·ε,&nbsp;&nbsp; v = ε − x,&nbsp;&nbsp; L = E‖v<sub>θ</sub>(z<sub>σ</sub>, σ, c) − v‖²</div>' +
          '<p>Sampling integrates the ODE from σ = 1 (pure noise) to σ = 0 with an Euler or higher-order solver:</p>' +
          '<div class="eq">z<sub>σ′</sub> = z<sub>σ</sub> + (σ′ − σ) · v̂,&nbsp;&nbsp; v̂ = v<sub>u</sub> + w·(v<sub>c</sub> − v<sub>u</sub>)</div>' +
          '<p>The second line is classifier-free guidance (w ≈ 5 for Wan): a conditional and an unconditional (negative-prompt) pass per step, hence <b>2 × 50 = 100 network evaluations</b> (NFE) per shot.</p>' +
          '<table><tr><th>Tensor</th><th>Shape (5 s, 720p, Wan 2.1)</th></tr>' +
          '<tr><td>latent z<sub>σ</sub></td><td>16 × 21 × 90 × 160 (C×T×H×W)</td></tr>' +
          '<tr><td>text c</td><td>512 × 4096 (umT5 encoder)</td></tr>' +
          '<tr><td>output v̂</td><td>same shape as z<sub>σ</sub></td></tr></table>' +
          '<p class="muted">Noise schedules, samplers and distillation live in the Diffusion &amp; Flow Matching chamber; the VAE that produced z lives in the Spatiotemporal VAE chamber.</p>',
        run: function (ctx) {
          var S = ctx.state;
          buildRoad(ctx, S);
          var g = swap(ctx, S, 0);
          S.gIn = ctx.group({ parent: g });
          S.inS = drawStack(ctx, S.gIn, 80, 400, 'in', 11);
          ctx.text(244, 272, 'noisy video latent (C × T × H × W)', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gIn });
          ctx.text(244, 294, 'zσ ∈ ℝ^(16 × 21 × 90 × 160)', { size: 14, font: 'mono', color: 'lime', anchor: 'middle', weight: 600, parent: S.gIn });
          S.gOut = ctx.group({ parent: g });
          S.outS = drawStack(ctx, S.gOut, 1150, 400, 'out', 23);
          ctx.text(1314, 272, 'predicted velocity ≈ ε − x̂ · same shape', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gOut });
          ctx.text(1314, 294, 'v̂ = vθ(zσ, σ, c)', { size: 14, font: 'mono', color: 'cyan', anchor: 'middle', weight: 600, parent: S.gOut });

          S.gDit = ctx.group({ parent: g });
          S.dit = ctx.node({ x: 800, y: 460, w: 330, h: 320, color: 'lime', parent: S.gDit });
          ctx.text(812, 284, 'DiT · vθ(zσ, σ, c)', { size: 15, font: 'display', weight: 700, color: 'lime', parent: S.gDit });
          ctx.node({ x: 800, y: 336, w: 280, h: 38, title: 'Patchify 1×2×2 · Linear 64→5120', titleSize: 12.5, color: 'lime', kind: 'chip', glow: false, parent: S.gDit });
          for (var i = 0; i < 5; i++) {
            ctx.rect(665, 374 + i * 19, 270, 13, { rx: 3, fill: ctx.alpha('lime', 0.1 + 0.05 * i), stroke: ctx.alpha('lime', 0.6), sw: 1, parent: S.gDit });
          }
          ctx.text(800, 489, '× 40 DiT blocks · d = 5120 · 40 heads', { size: 12.5, font: 'mono', color: 'lime', anchor: 'middle', parent: S.gDit });
          ctx.text(800, 511, 'adaLN(σ) · 3D RoPE · cross-attn(c)', { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gDit });
          ctx.node({ x: 800, y: 574, w: 280, h: 38, title: 'Linear 5120→64 · Unpatchify', titleSize: 12.5, color: 'lime', kind: 'chip', glow: false, parent: S.gDit });

          S.txt = ctx.node({ x: 800, y: 200, w: 300, h: 50, title: 'umT5 text encoder', sub: '"fox astronaut…" → 512 × 4096', icon: 'doc', color: 'amber', titleSize: 14, subSize: 11, parent: S.gDit });
          S.tn = ctx.node({ x: 800, y: 700, w: 300, h: 50, title: 'noise level σ', sub: 'sinusoid → MLP → adaLN', icon: 'clock', color: 'cyan', titleSize: 14, subSize: 11, parent: S.gDit });

          S.gLinks = ctx.group({ parent: g });
          S.lT = ctx.link(S.txt, S.dit, { from: 'b', to: 't', color: 'amber', parent: S.gLinks });
          S.lS = ctx.link(S.tn, S.dit, { from: 't', to: 'b', color: 'cyan', parent: S.gLinks });
          S.lIn = ctx.link({ x: 424, y: 460 }, S.dit, { to: 'l', color: 'lime', straight: true, parent: S.gLinks });
          S.lOut = ctx.link(S.dit, { x: 1136, y: 460 }, { from: 'r', color: 'cyan', straight: true, parent: S.gLinks });
          S.loopP = ctx.path('M1280,584 Q780,940 200,584', { stroke: ctx.alpha('lime', 0.75), sw: 1.6, dash: '6 6', arrow: true, parent: S.gLinks });
          ctx.text(780, 786, nb('Euler step  z ← z + (σ′ − σ)·v̂   · 50 steps'), { size: 13, font: 'mono', color: 'lime', anchor: 'middle', parent: S.gLinks });
          ctx.text(780, 816, '50 steps × 2 (CFG: cond + uncond) = 100 DiT forward passes per shot', { size: 12.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gLinks });
          S.cnt = ctx.text(780, 848, 'sampling step 1 / 50  ·  σ = 1.00', { size: 13.5, font: 'mono', color: 'white', anchor: 'middle', weight: 600, parent: S.gLinks });

          ctx.reveal(S.gIn, { from: 'left' });
          ctx.reveal(S.gDit, { from: 'scale', s0: 0.9, delay: 250 });
          ctx.reveal(S.gOut, { from: 'right', delay: 500 });
          ctx.reveal(S.gLinks, { delay: 700 });
          return ctx.wait(1100).then(function () {
            return Promise.all([
              ctx.packet(S.lT, { color: 'amber', dur: 700, label: 'c' }),
              ctx.packet(S.lS, { color: 'cyan', dur: 700, label: 'σ' }),
              ctx.packet(S.lIn, { color: 'lime', dur: 700, label: 'zσ' })
            ]);
          }).then(function () {
            return ctx.packet(S.lOut, { color: 'cyan', dur: 600, label: 'v̂' });
          }).then(function () {
            ctx.packet(S.loopP, { color: 'lime', dur: 1200 });
            return ctx.tween(2600, function (t) {
              var st = Math.round(1 + 49 * t);
              S.cnt.textContent = 'sampling step ' + st + ' / 50  ·  σ = ' + (1 - t).toFixed(2);
              var s = Math.pow(t, 1.3);
              for (var j = 0; j < 5; j++) for (var r = 0; r < 6; r++) for (var c = 0; c < 9; c++) {
                S.inS.mats[j].cells[r][c].setAttribute('fill', ctx.cmap('lime', S.inS.noise[j][r][c] * (1 - s) + S.inS.clean[j][r][c] * s));
              }
            }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Spacetime patches',
        say: 'A transformer consumes a sequence, so the latent video must become tokens. The VAE has already compressed eighty one frames of seven twenty p video by four in time and eight in each spatial direction, leaving twenty one latent frames of ninety by one hundred sixty cells, each with sixteen channels. The patch embedder groups every two by two block of cells within a frame into one token, and a linear layer lifts its sixty four numbers to the model width of five thousand one hundred twenty. The result is a single sequence of seventy five thousand six hundred tokens.',
        deep: '<p>Patchify is a strided 3D convolution: <code>Conv3d(16, 5120, kernel=(1,2,2), stride=(1,2,2))</code>, i.e. one shared linear map ℝ<sup>64</sup> → ℝ<sup>5120</sup> applied to non-overlapping 1×2×2 cubes.</p>' +
          '<div class="eq">n = T′·(H′/p<sub>h</sub>)·(W′/p<sub>w</sub>) = 21 · 45 · 80 = 75,600</div>' +
          '<p>The causal VAE keeps frame 0 on its own, so T′ = 1 + (81 − 1)/4 = 21. Pixel positions per token: nominally 4·8·8·(2·2) = 1024; exactly 81·720·1280 / 75,600 ≈ 987 because of the lone first frame. Each token then carries 64 latent values, lifted to d = 5120.</p>' +
          '<table><tr><th>Resolution (81 f)</th><th>tokens n</th><th>attn ∝ n²</th></tr>' +
          '<tr><td>480×832</td><td>21·30·52 = 32,760</td><td>0.19×</td></tr>' +
          '<tr><td>720×1280</td><td>21·45·80 = 75,600</td><td>1×</td></tr>' +
          '<tr><td>1088×1920</td><td>21·68·120 = 171,360</td><td>5.1×</td></tr></table>' +
          '<p><b>Design trade-off:</b> the VAE/patch split. A larger patch (2×2×2 or 1×4×4) cuts n 2–4× and attention 4–16×, but every token must then reconstruct more detail through the final linear layer; high-compression VAEs (e.g. 16×16 spatial in Wan 2.2-5B, LTX-Video 32×32×8) move that burden into the autoencoder instead.</p>' +
          '<p class="muted">No additive position embedding: position enters inside attention through 3D RoPE.</p>' +
          '<div class="note"><b>Two frame rates in this atlas.</b> This chamber (and Attention, FlashAttention, GPU, Parallelism) uses Wan 2.1’s native setting, 5 s at 16 fps = 81 frames → 75,600 tokens, because published Wan numbers are quoted for it; the 16 fps output is frame-interpolated to 24 fps in post. The Video Generation, VAE, Diffusion and Video Serving chambers render the same 5 s shot natively at 24 fps: 121 frames → T′ = 31 → 31·45·80 = 111,600 tokens, 1.48× the tokens and ≈ 2.2× the attention FLOPs.</div>',
        run: function (ctx) {
          var S = ctx.state;
          return ctx.camera(208, 482, 2.4, 800).then(function () {
            var old = S.cur;
            road(ctx, S, 1);
            S.cur = ctx.group();
            return ctx.fadeOut(old, 300, true);
          }).then(function () {
            return ctx.camera(800, 450, 1, 1);
          }).then(function () {
            var g = S.cur;
            ctx.text(70, 190, 'SPACETIME PATCHES · latent → token sequence', { size: 19, font: 'display', weight: 700, color: 'white', parent: g });
            S.pgrid = ctx.matrix(70, 240, 8, 12, { cell: 34, gap: 4, cmap: 'lime', values: function (r, c) { return latentVal(2, r, c, 8, 12); }, parent: g });
            var d = '';
            for (var i = 0; i <= 6; i++) d += 'M' + (68 + i * 76) + ',238V542';
            for (var j = 0; j <= 4; j++) d += 'M68,' + (238 + j * 76) + 'H524';
            ctx.path(d, { stroke: ctx.alpha('white', 0.35), sw: 1, dash: '3 3', parent: g });
            ctx.text(70, 562, 'one latent frame · 90 × 160 × 16  (shown 8 × 12 × 1)', { size: 12, font: 'mono', color: 'dim', parent: g });
            ctx.text(70, 582, 'dashed = 1×2×2 patch → one token', { size: 12, font: 'mono', color: 'lime', parent: g });
            S.phl = ctx.rect(68, 238, 76, 76, { rx: 4, stroke: 'white', sw: 2.4, glow: true, parent: g });

            /* middle: patch vector -> linear -> token */
            ctx.text(580, 256, 'patch = z[t, 2i:2i+2, 2j:2j+2, :]', { size: 13, font: 'mono', color: 'text', parent: g });
            S.v64 = ctx.vector(580, 276, 16, { horizontal: true, cell: 18, gap: 2, cmap: 'lime', values: [0.2, 0.4, 0.3, 0.8, 0.6, 0.1, 0.5, 0.7, 0.2, 0.9, 0.3, 0.4, 0.6, 0.2, 0.5, 0.8], parent: g });
            ctx.text(580, 312, '∈ ℝ⁶⁴  (16 ch × 2 × 2)', { size: 12, font: 'mono', color: 'dim', parent: g });
            ctx.line(740, 324, 740, 364, { color: 'lime', sw: 1.6, arrow: true, parent: g });
            ctx.text(752, 344, 'W_in · Linear 64 → 5120', { size: 12, font: 'mono', color: 'lime', parent: g });
            S.v5k = ctx.vector(580, 374, 24, { horizontal: true, cell: 11, gap: 2, cmap: 'cyan', values: function (r, c) { return 0.25 + 0.6 * Math.abs(Math.sin(c * 1.7)); }, parent: g });
            ctx.text(580, 404, 'token ∈ ℝ⁵¹²⁰  (model width d)', { size: 12, font: 'mono', color: 'dim', parent: g });
            ctx.text(580, 440, 'position: added later, inside', { size: 12, font: 'mono', color: 'dim', parent: g });
            ctx.text(580, 458, 'attention, by 3D RoPE', { size: 12, font: 'mono', color: 'dim', parent: g });

            /* code panel with the arithmetic */
            S.code2 = ctx.code({ parent: g, x: 1030, y: 170, w: 530, title: 'token count · Wan 2.1 · 5 s @ 16 fps, 720p', lang: 'text', typing: true, maxLines: 8, color: 'lime', lines: [
              nb('video    81 × 720 × 1280 × 3'),
              nb('VAE ↓    t/4 · h/8 · w/8 · 16 ch'),
              nb('latent   21 × 90 × 160 × 16'),
              nb('         (21 = 1 + 80/4, frame 0 alone)'),
              nb('patch    1 × 2 × 2'),
              nb('tokens   21 × 45 × 80'),
              nb('n        75,600 per forward pass'),
              nb('token    16·1·2·2 = 64 → d = 5120')
            ] });
            S.bigN = ctx.text(1295, 452, '0', { size: 46, font: 'display', weight: 700, color: 'lime', anchor: 'middle', parent: g });
            ctx.text(1295, 492, 'tokens in one sequence (one 5 s shot)', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            ctx.text(1295, 516, 'n² ≈ 5.7 × 10⁹ query–key pairs per head', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', parent: g });

            /* resolution table */
            var tg = ctx.group({ parent: g });
            ctx.rect(1030, 560, 530, 150, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('lime', 0.35), sw: 1, parent: tg });
            ctx.text(1050, 584, nb('resolution      tokens n      attention ∝ n²'), { size: 12, font: 'mono', color: 'dim', parent: tg });
            [['480×832', '32,760', '0.19×', 'text'], ['720×1280', '75,600', '1×', 'lime'], ['1088×1920', '171,360', '5.1×', 'amber']].forEach(function (row, k) {
              var y = 616 + k * 30;
              ctx.text(1050, y, row[0], { size: 13, font: 'mono', color: row[3], parent: tg });
              ctx.text(1250, y, row[1], { size: 13, font: 'mono', color: row[3], anchor: 'end', parent: tg });
              ctx.text(1420, y, row[2], { size: 13, font: 'mono', color: row[3], anchor: 'end', parent: tg });
            });

            /* sequence strip */
            ctx.text(70, 636, 'sequence order: (t, h, w) raster  ·  x ∈ ℝ^[B, n, d] = [1, 75,600, 5120]', { size: 12.5, font: 'mono', color: 'text', parent: g });
            S.seq = [];
            var segX = [70, 282, 494, 790], segT = ['t = 0 · 3,600', 't = 1 · 3,600', 't = 2 · 3,600', 't = 20 · 3,600'];
            segX.forEach(function (sx, s) {
              for (var q = 0; q < 12; q++) {
                S.seq.push(ctx.rect(sx + q * 16, 656, 14, 24, { rx: 2, fill: ctx.cmap('lime', 0.9 - s * 0.15), parent: g }));
              }
              ctx.text(sx + 95, 698, segT[s], { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            });
            ctx.text(742, 668, '… × 17 …', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            ctx.text(70, 742, 'same recipe everywhere: Wan 2.x, HunyuanVideo, CogVideoX (4×8×8 VAE + 2×2 patch); Sora report: "spacetime patches"', { size: 12, font: 'mono', color: 'dim', parent: g });
            ctx.text(70, 766, 'the VAE sets T′·H′·W′, the patch sets tokens per latent cell: together they fix n, and n² fixes the bill', { size: 12, font: 'mono', color: 'dim', parent: g });

            ctx.reveal(g, { dur: 400 });
            S.seq.forEach(function (e) { e.setAttribute('opacity', 0.12); });
            var sweep = ctx.tween(2600, function (t) {
              var p = Math.min(23, Math.floor(t * 24));
              var pr = Math.floor(p / 6), pc = p % 6;
              S.phl.setAttribute('x', 68 + pc * 76); S.phl.setAttribute('y', 238 + pr * 76);
              S.v64.set(function (r, c) { return latentVal(2, pr * 2 + (c >> 3), pc * 2 + ((c >> 2) & 1), 8, 12) * (0.6 + 0.4 * Math.abs(Math.sin(c * 1.3))); });
              var lit = Math.round(t * S.seq.length);
              S.seq.forEach(function (e, i2) { e.setAttribute('opacity', i2 < lit ? 1 : 0.12); });
            }, 'linear', 400);
            return Promise.all([sweep, S.code2.typeAll()]).then(function () {
              return ctx.counter(S.bigN, 0, 75600, 1200);
            }).then(function () { ctx.hud('n = 21 × 45 × 80 = 75,600 tokens'); });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Full 3D attention',
        say: 'Now the core operation. Every token attends to every other token, across space and across time. Watch the query token sitting on the fox in the middle frame. Its strongest keys are the fox tokens in every other frame, even though the fox has moved to different positions as it falls. Full spatiotemporal attention follows an object along a diagonal path through spacetime in a single hop. The price is a score matrix with seventy five thousand six hundred squared entries, per head and per layer. Click any token to move the query.',
        deep: '<p>Every block runs multi-head self-attention over the <i>whole</i> flattened video:</p>' +
          '<div class="eq">Attn(X) = softmax(Q Kᵀ / √d<sub>h</sub>) V,&nbsp;&nbsp; Q = XW<sub>q</sub>, K = XW<sub>k</sub>, V = XW<sub>v</sub>, X ∈ ℝ<sup>n×d</sup></div>' +
          '<p>With n = 75,600, H = 40 heads, d<sub>h</sub> = 128: each head scores 5.7·10<sup>9</sup> pairs per layer; ×40 heads ×40 layers ≈ 9.1·10<sup>12</sup> softmax entries per forward pass. They are never stored: FlashAttention-style kernels stream K/V tiles through on-chip SRAM with an online softmax, so memory is O(n·d) while compute stays O(n²·d).</p>' +
          '<p>Why pay for it? The heatmap shows an <b>illustrative</b> head: the query on the fox (t = 10) puts most of its mass on fox tokens at t = 0…20, which sit at <i>different</i> (h, w) because the fox falls diagonally. One hop links them. Learned heads specialise: some are local-spatial, some temporal-tracking, some global (lighting, style) — a structure that sparse-attention methods later exploit.</p>' +
          '<p>Wan also uses <b>QK-RMSNorm</b>: RMSNorm on the q and k projections (Wan normalises over the full 5120-wide projection before splitting heads; HunyuanVideo and SD3 normalise per head). It keeps logits bounded at this sequence length; without it, attention-logit growth destabilises large-scale bf16 training (Dehghani et al., ViT-22B).</p>' +
          '<p class="muted">Interactive: click any token to make it the query.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 2);
          ctx.hud('');
          S.t3 = ctx.text(FX0, 190, 'FULL 3D SELF-ATTENTION · every token sees all 75,600', { size: 19, font: 'display', weight: 700, color: 'white', parent: g });
          ctx.text(FX0, 214, 'illustrative head · 5 of 21 latent frames · 6 × 8 of 45 × 80 tokens each · orange outline = fox tokens', { size: 12, font: 'mono', color: 'dim', parent: g });
          S.q = { k: 2, r: 2, c: 4 };
          S.mode = 'full';
          S.fr = ctx.group({ parent: g });
          S.acells = []; S.flab = [];
          for (var k = 0; k < K; k++) {
            var fx = FX0 + k * FSTEP;
            ctx.rect(fx - 7, FY - 7, FW + 14, FH + 14, { rx: 6, fill: '#070d1a', stroke: ctx.alpha('lime', 0.45), sw: 1.2, parent: S.fr });
            var m = ctx.matrix(fx, FY, RR, CC, { cell: CELL, gap: GAP, cmap: 'heat', values: function () { return 0.05; }, parent: S.fr });
            S.acells.push(m);
            S.flab.push(ctx.text(fx + FW / 2, FY + FH + 24, 't = ' + TLAB[k], { size: 12.5, font: 'mono', color: 'text', anchor: 'middle', parent: S.fr }));
            (function (kk) {
              for (var r = 0; r < RR; r++) for (var c = 0; c < CC; c++) {
                (function (rr, cc) {
                  var cell = m.cells[rr][cc];
                  if (cls(kk, rr, cc) === 'fox') { cell.setAttribute('stroke', ctx.C.orange); cell.setAttribute('stroke-width', 1.6); }
                  cell.style.cursor = 'pointer';
                  cell.addEventListener('click', function () { S.q = { k: kk, r: rr, c: cc }; attnUpdate(ctx, S); });
                })(r, c);
              }
            })(k);
          }
          S.qRing = ctx.rect(0, 0, CELL + 6, CELL + 6, { rx: 4, stroke: 'white', sw: 2.4, glow: true, parent: S.fr });
          S.rays = ctx.group({ parent: g });
          /* flattened row strip */
          S.stripG = ctx.group({ parent: g });
          ctx.text(FX0, 532, 'the query’s row of softmax(QKᵀ/√dₕ), flattened in (t, h, w) order — one row of an n × n matrix', { size: 12, font: 'mono', color: 'dim', parent: S.stripG });
          S.strip = [];
          var sw = (FSTEP * 4 + FW) / 240;
          for (var i = 0; i < 240; i++) S.strip.push(ctx.rect(FX0 + i * sw, 546, sw + 0.3, 28, { rx: 0, fill: '#060a12', parent: S.stripG }));
          for (k = 0; k < K; k++) {
            ctx.line(FX0 + k * 48 * sw, 542, FX0 + k * 48 * sw, 578, { color: ctx.alpha('white', 0.5), sw: 1, parent: S.stripG });
            ctx.text(FX0 + (k * 48 + 24) * sw, 592, 'frame t = ' + TLAB[k], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.stripG });
          }
          attnUpdate(ctx, S);
          /* bottom explanation */
          S.b3 = ctx.group({ parent: g });
          ctx.text(FX0, 648, 'Attention(Q, K, V) = softmax(QKᵀ / √dₕ) · V', { size: 18, font: 'mono', color: 'white', parent: S.b3 });
          ctx.text(FX0, 684, 'Q, K, V ∈ ℝ^(n × dₕ),  n = 75,600,  dₕ = 128,  40 heads × 40 layers', { size: 13.5, font: 'mono', color: 'text', parent: S.b3 });
          ctx.text(FX0, 714, 'scores per head per layer: n² ≈ 5.7 × 10⁹ — never materialised: FlashAttention streams K/V tiles through SRAM', { size: 13.5, font: 'mono', color: 'dim', parent: S.b3 });
          ctx.text(FX0, 744, 'one hop links the fox at t = 0 … 20 although its (h, w) changes every frame: motion = a diagonal path in spacetime', { size: 13.5, font: 'mono', color: 'amber', parent: S.b3 });
          ctx.text(FX0, 774, 'QK-RMSNorm on q and k keeps logits bounded at n = 75,600 (Wan); heads specialise into local, tracking and global patterns', { size: 13.5, font: 'mono', color: 'dim', parent: S.b3 });
          ctx.label(1340, 648, 'CLICK A TOKEN → MOVE THE QUERY', { color: 'cyan', size: 12, parent: S.b3 });

          /* animate: spacetime wave from the query outward */
          var fills = S.fills.slice();
          var dist = [];
          var q = S.q;
          for (k = 0; k < K; k++) for (var r2 = 0; r2 < RR; r2++) for (var c2 = 0; c2 < CC; c2++) dist.push(Math.hypot(r2 - q.r, c2 - q.c, (k - q.k) * 3));
          var dmax = Math.max.apply(null, dist);
          ctx.reveal([S.fr, S.stripG, S.b3], { from: 'up', stagger: 250 });
          S.rays.setAttribute('opacity', 0);
          return ctx.tween(2200, function (t) {
            var R = t * (dmax + 0.5), idx = 0;
            for (var kk = 0; kk < K; kk++) for (var rr = 0; rr < RR; rr++) for (var cc = 0; cc < CC; cc++) {
              var f = dist[idx] <= R ? fills[idx] : '#060a12';
              S.acells[kk].cells[rr][cc].setAttribute('fill', f);
              S.strip[idx].setAttribute('fill', f);
              idx++;
            }
          }, 'linear', 500).then(function () {
            S.rays.setAttribute('opacity', 1);
            return ctx.reveal(S.rayEls, { from: 'draw', dur: 700, stagger: 120 });
          }).then(function () { return ctx.pulse(S.qRing, { color: 'white', times: 2, dur: 700 }); });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Factorized vs full',
        say: 'Earlier video models could not afford that, so they factorized attention. First attend within the frame, then attend across time at the same spatial location. Here that is about twenty one times cheaper. But look at what temporal attention sees: the same location in other frames, where the fox no longer is. Motion must be relayed through two hops and many layers, which hurts large movements and identity. That is why today’s leading open models, such as Wan, HunyuanVideo and CogVideoX, use full three dimensional attention.',
        deep: '<p>Factorized (divided) space-time attention, as in TimeSformer, VDM, Make-A-Video, AnimateDiff and SVD, replaces one n×n attention with two block-diagonal ones:</p>' +
          '<div class="eq">full: 4·n²·d &nbsp;&nbsp; vs &nbsp;&nbsp; spatial + temporal: 4·n·(n<sub>s</sub> + T′)·d</div>' +
          '<p>with n<sub>s</sub> = 45·80 = 3,600 tokens per frame and T′ = 21: ratio n/(n<sub>s</sub>+T′) = 75,600/3,621 ≈ <b>20.9×</b> fewer attention FLOPs (117 → 5.6 TFLOP per layer at d = 5120).</p>' +
          '<p><b>What is lost:</b> the attention graph is no longer complete. Token (t, h, w) reaches (t′, h′, w′) only via (t, h′, w′) → (t′, h′, w′): two layers, and the intermediate token must already carry the right content. Large or fast motion, occlusion and identity preservation degrade; image-pretrained spatial layers plus bolted-on temporal layers also bias toward "moving stills".</p>' +
          '<p>CogVideoX explicitly ablated this and reported that 3D full attention beats separated spatial/temporal attention; HunyuanVideo, Wan, Mochi and Sora-class systems all use full attention. The escape from the O(n²) bill is not factorization but <i>learned-structure-aware sparsity</i> (see the n² wall step) plus sequence parallelism.</p>' +
          '<p class="muted">Interactive: toggle FULL 3D / SPATIAL / TEMPORAL, and click tokens.</p>',
        run: function (ctx) {
          var S = ctx.state, g = S.cur;
          road(ctx, S, 3);
          ctx.fadeOut(S.b3, 400, true);
          S.t3.textContent = 'FACTORIZED vs FULL · which keys can the query reach?';
          S.b4 = ctx.group({ parent: g });
          ctx.text(FX0, 648, 'COST PER LAYER  (720p shot, n = 75,600, d = 5120)', { size: 15, font: 'display', weight: 700, color: 'white', parent: S.b4 });
          S.modeChips = [];
          [['full', 'FULL 3D', 1270], ['spatial', 'SPATIAL', 1380], ['temporal', 'TEMPORAL', 1490]].forEach(function (m) {
            var ch = chip(ctx, S.b4, m[2], 648, 100, m[1], function () { S.mode = m[0]; attnUpdate(ctx, S); });
            ch.mode = m[0];
            S.modeChips.push(ch);
          });
          var rows = [['full 3D   4·n²·d', 117.05, '117 TFLOP', 'lime'], ['spatial   4·n·nₛ·d', 5.57, '5.6 TFLOP', 'cyan'], ['temporal  4·n·T·d', 0.033, '0.03 TFLOP', 'violet']];
          S.cbars = [];
          rows.forEach(function (rw, i) {
            var y = 690 + i * 36;
            ctx.text(FX0, y, nb(rw[0]), { size: 13, font: 'mono', color: rw[3], parent: S.b4 });
            ctx.rect(420, y - 11, 800, 22, { rx: 4, fill: 'rgba(255,255,255,0.03)', parent: S.b4 });
            var w = Math.max(3, rw[1] / 117.05 * 800);
            var b = ctx.rect(420, y - 11, w, 22, { rx: 4, fill: ctx.alpha(rw[3], 0.55), stroke: rw[3], sw: 1, parent: S.b4 });
            b.setAttribute('data-w', w);
            S.cbars.push(b);
            ctx.text(420 + w + 10, y, rw[2], { size: 12.5, font: 'mono', color: rw[3], parent: S.b4 });
          });
          ctx.text(FX0, 814, 'factorized total ≈ 5.6 TFLOP → 20.9× cheaper, but a moving object needs ≥ 2 hops (space, then time)', { size: 13, font: 'mono', color: 'text', parent: S.b4 });
          ctx.text(FX0, 842, 'factorized: TimeSformer, VDM, Make-A-Video, AnimateDiff, SVD  ·  full 3D: CogVideoX, HunyuanVideo, Wan 2.x, Mochi 1, Sora-class', { size: 12, font: 'mono', color: 'dim', parent: S.b4 });
          /* warning marker at the fox's true position in the last frame */
          S.warn = ctx.group({ parent: g });
          var fp = cellXY(4, 4, 7);
          ctx.circle(fp.x - 14, fp.y - 4, 40, { stroke: 'red', sw: 2, dash: '4 3', parent: S.warn });
          ctx.label(FX0 + 4 * FSTEP + FW / 2, FY - 22, 'fox moved here: temporal attn at fixed (h, w) misses it', { color: 'red', size: 10.5, parent: S.warn });
          S.warn.setAttribute('opacity', 0);
          S.cbars.forEach(function (b) { b.setAttribute('width', 0); });
          ctx.reveal(S.b4, { from: 'up' });
          S.cbars.forEach(function (b, i) { ctx.animate(b, { width: [0, parseFloat(b.getAttribute('data-w'))] }, 800, 'out', 300 + i * 200); });
          S.q = { k: 2, r: 2, c: 4 };
          S.mode = 'full';
          attnUpdate(ctx, S);
          return ctx.wait(1400).then(function () {
            S.mode = 'spatial'; attnUpdate(ctx, S);
            return ctx.pulse(S.acells[2], { color: 'cyan', dur: 700 });
          }).then(function () { return ctx.wait(1200); }).then(function () {
            S.mode = 'temporal'; attnUpdate(ctx, S);
            return ctx.pulse(S.warn, { color: 'red', times: 2, dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: '3D RoPE',
        say: 'How does a token know where it is? Not by adding a position vector, but by rotating its queries and keys. Three dimensional rotary embedding splits each head’s one hundred twenty eight dimensions into three bands, for time, height and width. Each pair of dimensions rotates by an angle proportional to the token’s coordinate along its axis, at its own frequency. When a query meets a key, the rotations cancel into a function of only their relative offset in time, height and width.',
        deep: '<p>Split the head dimension into axis bands d<sub>head</sub> = d<sub>T</sub> + d<sub>H</sub> + d<sub>W</sub>. Within band a ∈ {T, H, W}, pair i rotates by angle p<sub>a</sub>·ω<sub>a,i</sub>:</p>' +
          '<div class="eq">ω<sub>a,i</sub> = θ<sup>−2i/d<sub>a</sub></sup>&nbsp; (Wan θ = 10⁴, HunyuanVideo θ = 256);&nbsp;&nbsp; q̃ = (R<sub>t</sub>(t) ⊕ R<sub>h</sub>(h) ⊕ R<sub>w</sub>(w)) q</div>' +
          '<div class="eq">⟨R(p)q, R(p′)k⟩ = ⟨q, R(p′−p)k⟩ = f(Δt, Δh, Δw)</div>' +
          '<p>Rotations are orthogonal, so norms are preserved and the score depends only on relative offsets: translation-equivariant in space <i>and</i> time, no learned table, any length. Implementation: complex multiply of (q<sub>2i</sub> + j·q<sub>2i+1</sub>) by e<sup>j·p·ω</sup>, fused into the attention prologue.</p>' +
          '<table><tr><th>Model</th><th>d<sub>head</sub></th><th>T / H / W dims</th><th>θ</th></tr>' +
          '<tr><td>Wan 2.1 / 2.2</td><td>128</td><td>44 / 42 / 42</td><td>10⁴</td></tr>' +
          '<tr><td>HunyuanVideo</td><td>128</td><td>16 / 56 / 56</td><td>256</td></tr></table>' +
          '<p>HunyuanVideo spends few dims on time but uses a small base (θ = 256: ω = 1, ½, ¼ … 1/128), so its 8 temporal frequencies still span periods of 6 to ~800 frames. The plot: mean<sub>i</sub> cos(Δ·ω<sub>i</sub>), the positional factor for q = k with equal energy per pair, falls with |Δ| — a soft locality prior.</p>' +
          '<p><b>Extrapolation:</b> generating longer or larger than trained pushes angles out of distribution. Fixes: NTK/YaRN-style base rescaling, position interpolation, and <b>RIFLEx</b>, which lowers the "intrinsic" frequency whose period matches the training length to stop videos from looping.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 4);
          ctx.hud('');
          ctx.text(193, 190, '3D RoPE · one head, dₕ = 128 = 44 (t) + 42 (h) + 42 (w)', { size: 19, font: 'display', weight: 700, color: 'white', parent: g });
          var bands = [['time t · 44 dims (22 pairs)', 0, 22, 'amber'], ['height h · 42 dims (21 pairs)', 22, 21, 'cyan'], ['width w · 42 dims (21 pairs)', 43, 21, 'magenta']];
          S.pairG = ctx.group({ parent: g });
          bands.forEach(function (b) {
            for (var i = 0; i < b[2]; i++) {
              ctx.rect(193 + (b[1] + i) * 19, 246, 17, 22, { rx: 3, fill: ctx.alpha(b[3], 0.95 - 0.7 * i / b[2]), parent: S.pairG });
            }
            var cx = 193 + (b[1] + b[2] / 2) * 19 - 1;
            ctx.text(cx, 232, b[0], { size: 12.5, font: 'mono', color: b[3], anchor: 'middle', parent: S.pairG });
          });
          ctx.text(193, 290, 'each cell = one 2-D pair rotated by pₐ·ωᵢ · ωᵢ = 10000^(−2i/dₐ) · bright = fast, dim = slow', { size: 12, font: 'mono', color: 'dim', parent: S.pairG });

          /* phasors */
          S.ph = [];
          S.phG = ctx.group({ parent: g });
          var specs = [['t', 0, 44, 300, 'amber'], ['t', 4, 44, 440, 'amber'], ['h', 0, 42, 700, 'cyan'], ['h', 4, 42, 840, 'cyan'], ['w', 0, 42, 1100, 'magenta'], ['w', 4, 42, 1240, 'magenta']];
          [['time pairs · angle = t·ω', 370, 'amber'], ['height pairs · angle = h·ω', 770, 'cyan'], ['width pairs · angle = w·ω', 1170, 'magenta']].forEach(function (l) {
            ctx.text(l[1], 356, l[0], { size: 12.5, font: 'mono', color: l[2], anchor: 'middle', parent: S.phG });
          });
          specs.forEach(function (s) {
            var cx = s[3], cy = 430, om = Math.pow(10000, -2 * s[1] / s[2]);
            ctx.circle(cx, cy, 46, { stroke: ctx.alpha(s[4], 0.5), sw: 1.4, fill: ctx.alpha(s[4], 0.05), parent: S.phG });
            ctx.line(cx - 50, cy, cx + 50, cy, { color: ctx.alpha('white', 0.12), sw: 1, parent: S.phG });
            ctx.line(cx, cy - 50, cx, cy + 50, { color: ctx.alpha('white', 0.12), sw: 1, parent: S.phG });
            var arm = ctx.line(cx, cy, cx + 44, cy, { color: s[4], sw: 2.4, parent: S.phG });
            var tip = ctx.circle(cx + 44, cy, 4.5, { fill: s[4], glow: true, parent: S.phG });
            ctx.text(cx, 494, 'i = ' + s[1] + ' · ω = ' + (om === 1 ? '1' : om.toFixed(2)), { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.phG });
            S.ph.push({ axis: s[0], om: om, cx: cx, cy: cy, arm: arm, tip: tip });
          });
          /* position readout */
          S.posG = ctx.group({ parent: g });
          ctx.rect(1320, 366, 230, 130, { rx: 10, fill: 'rgba(6,12,24,0.85)', stroke: ctx.alpha('lime', 0.4), sw: 1, parent: S.posG });
          ctx.text(1340, 388, 'TOKEN POSITION (t, h, w)', { size: 11.5, font: 'mono', color: 'dim', parent: S.posG });
          S.posT = [['amber', 't'], ['cyan', 'h'], ['magenta', 'w']].map(function (a, i) {
            return ctx.text(1340, 418 + i * 26, a[1] + ' = 0.0', { size: 15, font: 'mono', color: a[0], weight: 600, parent: S.posG });
          });
          /* plot of positional decay */
          S.plotG = ctx.group({ parent: g });
          ctx.text(193, 548, 'positional factor for q = k:  meanᵢ cos(Δ·ωᵢ)  vs temporal offset Δ', { size: 12.5, font: 'mono', color: 'text', parent: S.plotG });
          var pl = ctx.plot(213, 572, 500, 230, function (x) { return ropeMeanCos(x, 44); }, { xDomain: [0, 40], yDomain: [-0.3, 1], color: 'amber', xLabel: 'Δ (latent frames)', yLabel: '', samples: 160, parent: S.plotG });
          var pl2 = ctx.plot(213, 572, 500, 230, function (x) { return ropeMeanCos(x, 16, 256); }, { xDomain: [0, 40], yDomain: [-0.3, 1], color: 'orange', axes: false, samples: 160, parent: S.plotG });
          pl2.curve.setAttribute('stroke-dasharray', '6 5');
          var z0 = pl.toPx(0, 0), z1 = pl.toPx(40, 0);
          ctx.line(z0.x, z0.y, z1.x, z1.y, { color: ctx.alpha('white', 0.15), sw: 1, dash: '2 4', parent: S.plotG });
          ctx.text(205, pl.toPx(0, 1).y, '1', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.plotG });
          ctx.text(205, z0.y, '0', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.plotG });
          ctx.text(232, 770, '— Wan t-band (44 dims, θ = 10⁴)', { size: 12, font: 'mono', color: 'amber', parent: S.plotG });
          ctx.text(232, 790, '- - HunyuanVideo t-band (16 dims, θ = 256)', { size: 12, font: 'mono', color: 'orange', parent: S.plotG });
          S.ropeCurves = [pl.curve, pl2.curve];
          /* equations */
          S.eqG = ctx.group({ parent: g });
          var eqs = [
            ['q̃ = R(t, h, w)·q,   R = Rₜ(t) ⊕ Rₕ(h) ⊕ R_w(w)', 15.5, 'white', 572],
            ['Rₐ(p): a 2×2 rotation by p·ωᵢ on every pair of band a', 13, 'dim', 600],
            ['⟨R(p)q, R(p′)k⟩ = ⟨q, R(p′ − p)k⟩', 15.5, 'white', 642],
            ['⇒ the score depends only on (Δt, Δh, Δw): no table, any length', 13, 'lime', 670],
            ['Wan 44/42/42, θ = 10⁴  ·  HunyuanVideo 16/56/56, θ = 256', 13, 'text', 712],
            ['longer / larger than training → angles go out of distribution:', 13, 'dim', 752],
            ['NTK / YaRN base scaling, position interpolation, RIFLEx', 13, 'dim', 774],
            ['(lower the intrinsic frequency so long videos stop looping)', 13, 'dim', 796],
            ['text tokens: unrotated (HunyuanVideo) or id (0,0,0) (FLUX)', 12.5, 'amber', 836]
          ];
          eqs.forEach(function (e) { ctx.text(800, e[3], nb(e[0]), { size: e[1], font: 'mono', color: e[2], parent: S.eqG }); });

          function setPhasors(T) {
            var pos = { t: 10 + 10 * Math.sin(0.35 * T), h: 22 + 22 * Math.sin(0.5 * T + 1), w: 40 + 39 * Math.sin(0.27 * T + 2) };
            S.ph.forEach(function (p) {
              var a = pos[p.axis] * p.om;
              var x = p.cx + 44 * Math.cos(a), y = p.cy - 44 * Math.sin(a);
              p.arm.setAttribute('x2', x.toFixed(1)); p.arm.setAttribute('y2', y.toFixed(1));
              p.tip.setAttribute('cx', x.toFixed(1)); p.tip.setAttribute('cy', y.toFixed(1));
            });
            S.posT[0].textContent = 't = ' + pos.t.toFixed(1) + '  (0…20)';
            S.posT[1].textContent = 'h = ' + pos.h.toFixed(1) + '  (0…44)';
            S.posT[2].textContent = 'w = ' + pos.w.toFixed(1) + '  (0…79)';
          }
          setPhasors(0);
          S.ropeLoop = ctx.loop(function (t) { setPhasors(t); });
          ctx.reveal(S.pairG, { from: 'down' });
          ctx.reveal([S.phG, S.posG], { from: 'up', delay: 500, stagger: 200 });
          ctx.reveal(S.plotG, { from: 'up', delay: 1100 });
          ctx.reveal(S.ropeCurves, { from: 'draw', delay: 1300, dur: 1200, stagger: 300 });
          ctx.reveal(S.eqG, { from: 'left', delay: 1500 });
          return ctx.wait(3200);
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'adaLN-Zero',
        say: 'The network must behave differently at high noise and at low noise. Adaptive layer norm zero injects the noise level everywhere. The timestep is embedded with sinusoids and passed through a small MLP, which produces six vectors per block: a shift, a scale and a gate for the attention branch, and the same three for the feed forward branch. They modulate the normalized activations channel by channel. The gates start at zero, so every block begins as an identity map, which lets very deep diffusion transformers train stably.',
        deep: '<p>adaLN-Zero (Peebles &amp; Xie) regresses per-channel modulation from the conditioning vector c = MLP(emb(σ)) (+ pooled text in some models):</p>' +
          '<div class="eq">[β₁, γ₁, α₁, β₂, γ₂, α₂] = W<sub>mod</sub>·SiLU(c) + B<sub>l</sub> &nbsp;∈ ℝ<sup>6×d</sup></div>' +
          '<div class="eq">h = x + α₁ ⊙ SelfAttn(LN(x) ⊙ (1+γ₁) + β₁)<br>h′ = h + CrossAttn(LN(h), c<sub>text</sub>)<br>y = h′ + α₂ ⊙ FFN(LN(h′) ⊙ (1+γ₂) + β₂)</div>' +
          '<p><b>Zero:</b> W<sub>mod</sub> is initialised to 0, so α = 0 and every residual branch is switched off at init: the 40-block stack starts as the identity and gradients flow cleanly. In the DiT paper this beat cross-attention and in-context conditioning for the timestep by a wide FID margin.</p>' +
          '<p><b>Parameter cost:</b> a per-block d → 6d linear is 6d² — for DiT-XL/2 (d = 1152, 28 blocks) ≈ 223M of 675M parameters. Wan shares <i>one</i> modulation projection across all 40 blocks and lets each block learn only a bias B<sub>l</sub> ∈ ℝ<sup>6×d</sup> (the "adaLN-single" design introduced by PixArt-α), saving 40 × 6d² ≈ 6.3B parameters at d = 5120 (6d² = 157M per block).</p>' +
          '<p>Modulation is per sample, broadcast over all n tokens: O(d) work per block, versus O(n·d²) for the layers it steers. Note that in Wan the cross-attention branch is <i>not</i> modulated.</p>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.ropeLoop) { S.ropeLoop.stop(); S.ropeLoop = null; }
          var g = swap(ctx, S, 5);
          ctx.text(110, 168, 'adaLN-ZERO · the noise level steers every block', { size: 19, font: 'display', weight: 700, color: 'white', parent: g });
          /* left: timestep path */
          S.lg = ctx.group({ parent: g });
          S.sigR = ctx.rect(190, 196, 140, 30, { rx: 15, fill: ctx.alpha('cyan', 0.15), stroke: 'cyan', sw: 1.2, parent: S.lg });
          S.sigT = ctx.text(260, 211.5, 'σ = 1.00', { size: 14, font: 'mono', color: 'cyan', weight: 700, anchor: 'middle', parent: S.lg });
          var n1 = ctx.node({ x: 250, y: 272, w: 280, h: 48, title: 'Sinusoidal embedding', sub: '1000·σ → 256 freqs', color: 'cyan', titleSize: 13.5, subSize: 11, glow: false, parent: S.lg });
          var n2 = ctx.node({ x: 250, y: 342, w: 280, h: 48, title: 'Time MLP (shared)', sub: 'Linear·SiLU·Linear → c ∈ ℝ⁵¹²⁰', color: 'cyan', titleSize: 13.5, subSize: 11, glow: false, parent: S.lg });
          var n3 = ctx.node({ x: 250, y: 412, w: 280, h: 48, title: 'Modulation head', sub: 'W·SiLU(c) + Bₗ → 6 × 5120', color: 'cyan', titleSize: 13.5, subSize: 11, glow: false, parent: S.lg });
          ctx.line(250, 226, 250, 246, { color: 'cyan', arrow: true, parent: S.lg });
          ctx.line(250, 296, 250, 316, { color: 'cyan', arrow: true, parent: S.lg });
          ctx.line(250, 366, 250, 386, { color: 'cyan', arrow: true, parent: S.lg });
          [['Wan: one MLP shared by all 40 blocks;', 'text'], ['each block adds only a learned bias Bₗ', 'text'], ['', 'dim'], ['DiT-XL/2: a d → 6d Linear per block', 'dim'], ['= 6d² × 28 ≈ 223M of 675M params', 'dim'], ['', 'dim'], ['init W_mod = 0  ⇒  α = γ = β = 0', 'magenta'], ['⇒  every block = identity at step 0', 'magenta']].forEach(function (l, i) {
            if (l[0]) ctx.text(110, 488 + i * 22, l[0], { size: 12.5, font: 'mono', color: l[1], parent: S.lg });
          });
          /* center: block chain */
          S.cg = ctx.group({ parent: g });
          var chain = [
            ['xₗ · n × 5120', 'white', 205],
            ['LayerNorm (no affine)', 'dim', 258],
            ['x̂ ⊙ (1 + γ₁) + β₁', 'cyan', 311],
            ['Self-Attention · 3D RoPE', 'lime', 368],
            ['⊕  x + α₁ ⊙ attn', 'magenta', 426],
            ['LN → Cross-Attn(text) ⊕', 'amber', 484],
            ['LN → x̂ ⊙ (1 + γ₂) + β₂', 'cyan', 542],
            ['FFN · GELU · 13,824', 'lime', 600],
            ['⊕  h + α₂ ⊙ ffn', 'magenta', 658],
            ['xₗ₊₁', 'white', 716]
          ];
          S.chain = chain.map(function (c, i) {
            return ctx.node({ x: 800, y: c[2], w: 300, h: 38, title: c[0], color: c[1], titleSize: 13, kind: (i === 0 || i === 9) ? 'pill' : 'box', glow: false, parent: S.cg });
          });
          S.chainLinks = [];
          for (var i = 0; i < chain.length - 1; i++) {
            S.chainLinks.push(ctx.line(800, chain[i][2] + 19, 800, chain[i + 1][2] - 19, { color: ctx.alpha('white', 0.4), sw: 1.4, arrow: true, parent: S.cg }));
          }
          ctx.path('M650,205 H622 V426 H646', { stroke: ctx.alpha('white', 0.45), sw: 1.4, dash: '4 4', arrow: true, parent: S.cg });
          ctx.path('M650,426 H622 V658 H646', { stroke: ctx.alpha('white', 0.45), sw: 1.4, dash: '4 4', arrow: true, parent: S.cg });
          ctx.text(614, 372, 'residual', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.cg });
          /* modulation bus */
          S.bus = ctx.group({ parent: g });
          ctx.path('M390,412 H425 V311 M425,412 V658', { stroke: ctx.alpha('cyan', 0.7), sw: 1.6, parent: S.bus });
          var chipSpec = [['γ₁ β₁', 311, 'cyan', 0], ['α₁', 426, 'magenta', 1], ['γ₂ β₂', 542, 'cyan', 2], ['α₂', 658, 'magenta', 3]];
          S.mchips = chipSpec.map(function (c) {
            ctx.line(425, c[1], 440, c[1], { color: ctx.alpha('cyan', 0.7), sw: 1.6, parent: S.bus });
            ctx.rect(438, c[1] - 14, 168, 28, { rx: 14, fill: ctx.alpha(c[2], 0.14), stroke: c[2], sw: 1.2, parent: S.bus });
            var t = ctx.text(522, c[1] + 0.5, c[0], { size: 11.5, font: 'mono', color: c[2], anchor: 'middle', weight: 600, parent: S.bus });
            ctx.line(606, c[1], 646, c[1], { color: c[2], sw: 1.6, arrow: true, parent: S.bus });
            return { t: t, lab: c[0], k: c[3] };
          });
          /* right: distributions and gates */
          S.rg = ctx.group({ parent: g });
          ctx.text(1010, 196, 'one channel’s activations across tokens', { size: 12.5, font: 'mono', color: 'text', parent: S.rg });
          var dp = ctx.plot(1030, 220, 500, 190, gauss(0, 1), { xDomain: [-4, 4], yDomain: [0, 0.85], color: ctx.alpha('white', 0.45), axes: true, samples: 80, parent: S.rg });
          dp.curve.setAttribute('stroke-dasharray', '5 5');
          S.dp = dp;
          S.modCurve = ctx.path('M0,0', { stroke: 'cyan', sw: 2.4, fill: ctx.alpha('cyan', 0.08), parent: S.rg, glow: true });
          ctx.text(1040, 432, '- - LN(x): zero mean, unit var', { size: 12, font: 'mono', color: 'dim', parent: S.rg });
          ctx.text(1300, 432, '— x̂·(1+γ) + β', { size: 12, font: 'mono', color: 'cyan', parent: S.rg });
          ctx.text(1010, 480, 'gates α (scale each branch before the residual add)', { size: 12.5, font: 'mono', color: 'text', parent: S.rg });
          S.gates = [0, 1].map(function (i) {
            var y = 514 + i * 36;
            ctx.text(1010, y, 'α' + (i ? '₂' : '₁'), { size: 14, font: 'mono', color: 'magenta', weight: 700, parent: S.rg });
            ctx.rect(1050, y - 10, 440, 20, { rx: 4, fill: 'rgba(255,255,255,0.03)', parent: S.rg });
            ctx.line(1270, y - 14, 1270, y + 14, { color: ctx.alpha('white', 0.4), sw: 1, parent: S.rg });
            var b = ctx.rect(1270, y - 8, 0, 16, { rx: 3, fill: ctx.alpha('magenta', 0.6), stroke: 'magenta', sw: 1, parent: S.rg });
            var v = ctx.text(1500, y, '0.00', { size: 12, font: 'mono', color: 'magenta', parent: S.rg });
            return { b: b, v: v };
          });
          [['h  = x + α₁ ⊙ SelfAttn(LN(x) ⊙ (1+γ₁) + β₁)', 'white'], ['h′ = h + CrossAttn(LN(h), c_text)', 'amber'], ['y  = h′ + α₂ ⊙ FFN(LN(h′) ⊙ (1+γ₂) + β₂)', 'white']].forEach(function (e, i) {
            ctx.text(1010, 630 + i * 30, nb(e[0]), { size: 13.5, font: 'mono', color: e[1], parent: S.rg });
          });
          ctx.text(1010, 736, 'modulation is per sample, broadcast over all n tokens:', { size: 12, font: 'mono', color: 'dim', parent: S.rg });
          ctx.text(1010, 756, 'O(d) per block vs O(n·d²) for the layers it steers', { size: 12, font: 'mono', color: 'dim', parent: S.rg });

          function params(s) {
            return { g1: -0.35 + 0.9 * s, b1: 0.6 - 1.1 * s, a1: 0.25 + 0.6 * (1 - s), g2: 0.2 - 0.5 * s, b2: -0.2 + 0.4 * s, a2: 0.6 - 0.35 * s };
          }
          function fmt(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2); }
          function setSigma(s, gateScale) {
            var p = params(s);
            S.sigT.textContent = 'σ = ' + s.toFixed(2);
            S.mchips[0].t.textContent = 'γ₁' + fmt(p.g1) + ' β₁' + fmt(p.b1);
            S.mchips[1].t.textContent = 'α₁ ' + fmt(p.a1 * gateScale);
            S.mchips[2].t.textContent = 'γ₂' + fmt(p.g2) + ' β₂' + fmt(p.b2);
            S.mchips[3].t.textContent = 'α₂ ' + fmt(p.a2 * gateScale);
            var sd = 1 + p.g1, f = gauss(p.b1, sd), d = '';
            for (var i = 0; i <= 80; i++) {
              var x = -4 + 8 * i / 80, pt = S.dp.toPx(x, Math.min(0.85, f(x)));
              d += (i ? 'L' : 'M') + pt.x.toFixed(1) + ',' + pt.y.toFixed(1);
            }
            var b0 = S.dp.toPx(-4, 0), b1 = S.dp.toPx(4, 0);
            d += 'L' + b1.x + ',' + b1.y + 'L' + b0.x + ',' + b0.y + 'Z';
            S.modCurve.setAttribute('d', d);
            [p.a1, p.a2].forEach(function (a, i) {
              var v = a * gateScale, w = Math.abs(v) * 220;
              S.gates[i].b.setAttribute('x', v >= 0 ? 1270 : 1270 - w);
              S.gates[i].b.setAttribute('width', w);
              S.gates[i].v.textContent = fmt(v);
            });
          }
          setSigma(1, 0);
          ctx.reveal(S.lg, { from: 'left' });
          ctx.reveal(S.cg, { from: 'up', delay: 250 });
          ctx.reveal(S.bus, { from: 'fade', delay: 600 });
          ctx.reveal(S.rg, { from: 'right', delay: 800 });
          return ctx.wait(1300).then(function () {
            /* phase 1: "Zero" init -> trained gates open */
            return ctx.tween(1000, function (t) { setSigma(1, t); }, 'out');
          }).then(function () {
            /* phase 2: sweep the noise level during sampling */
            return ctx.tween(3000, function (t) { setSigma(1 - 0.9 * t, 1); }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Text conditioning',
        say: 'The prompt enters in one of two ways. Wan keeps the video stream separate and adds a cross attention layer, where video tokens query the text encoder’s outputs. Stable Diffusion three, FLUX and HunyuanVideo instead use MM-DiT. Text and video tokens are concatenated into one sequence. Each modality keeps its own projection and feed forward weights, but they share one joint attention, so text can also read the video. HunyuanVideo runs twenty such dual stream blocks, then forty single stream blocks with fully shared weights.',
        deep: '<p><b>Cross-attention</b> (Wan, PixArt, original SD): Q from video, K/V from the frozen text encoder output (umT5, 512 tokens):</p>' +
          '<div class="eq">h ← h + softmax(Q<sub>v</sub>K<sub>c</sub>ᵀ/√d<sub>h</sub>) V<sub>c</sub>,&nbsp; cost 4·n·m·d + 4·n·d² (m = 512)</div>' +
          '<p>The text representation is fixed across all 40 layers; only the video reads it. Wan 2.1 I2V adds a second, decoupled cross-attention over CLIP image tokens of the first frame.</p>' +
          '<p><b>MM-DiT</b> (SD3, FLUX, HunyuanVideo): concatenate [c; x], project each with its own W<sub>qkv</sub>, run one attention over n + m tokens, then separate FFNs and separate adaLN modulation:</p>' +
          '<div class="eq">[Q;K;V] = [c W<sup>txt</sup><sub>qkv</sub> ; x W<sup>vid</sup><sub>qkv</sub>],&nbsp; A = softmax(QKᵀ/√d<sub>h</sub>)</div>' +
          '<p>The text stream is <i>updated</i> by the video (T·V quadrant); in SD3\'s architecture comparison MM-DiT beat cross-attention DiT, UViT and plain in-context DiT on validation loss, CLIP score and FID. Cost overhead is tiny: (n+m)²/n² − 1 ≈ 0.7% for m = 256.</p>' +
          '<p><b>Dual → single stream:</b> HunyuanVideo (d = 3072, 24 heads) uses 20 dual-stream blocks, then 40 single-stream blocks that share one weight set on the concatenated sequence (parallel attention + MLP, FLUX-style: 19 + 38 blocks in FLUX.1). Its text encoder is a decoder-only MLLM (plus CLIP-L pooled text in the modulation) with a bidirectional token refiner.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 6);
          ctx.hud('');
          /* ---- left panel: cross attention ---- */
          S.L = ctx.group({ parent: g });
          ctx.rect(60, 160, 710, 450, { rx: 12, fill: 'rgba(6,12,24,0.7)', stroke: ctx.alpha('amber', 0.4), sw: 1.2, parent: S.L });
          ctx.text(82, 186, 'CROSS-ATTENTION · Wan 2.1 / 2.2', { size: 16, font: 'display', weight: 700, color: 'white', parent: S.L });
          var words = ['fox', 'astro', 'naut', 'crash', 'lands', 'ice', 'moon', 'glows'];
          var MX = 330, MY = 262, cs = 22, cg = 3;
          words.forEach(function (w, c) {
            var x = MX + c * (cs + cg);
            ctx.rect(x, MY - 30, cs, cs, { rx: 3, fill: ctx.alpha('amber', 0.7), parent: S.L });
            var t = ctx.text(x + cs / 2, MY - 36, w, { size: 11, font: 'mono', color: 'amber', anchor: 'start', parent: S.L });
            t.setAttribute('transform', 'rotate(-90 ' + (x + cs / 2) + ' ' + (MY - 36) + ')');
          });
          var reg = function (r) { return r < 3 ? 'sky' : (r < 8 ? 'fox' : 'ice'); };
          for (var r = 0; r < 12; r++) ctx.rect(MX - 32, MY + r * (cs + cg), cs, cs, { rx: 3, fill: ctx.alpha('lime', 0.3 + 0.5 * (reg(r) === 'fox')), parent: S.L });
          [['sky', 1], ['fox', 5], ['ice', 9.5]].forEach(function (l) { ctx.text(MX - 40, MY + l[1] * (cs + cg) + cs / 2, l[0], { size: 11.5, font: 'mono', color: 'lime', anchor: 'end', parent: S.L }); });
          ctx.text(MX - 60, MY - 14, 'video Q', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: S.L });
          ctx.text(MX + 8 * (cs + cg) + 8, MY - 20, 'text K, V', { size: 11, font: 'mono', color: 'amber', parent: S.L });
          var aff = { fox: [0.95, 0.7, 0.7, 0.55, 0.4, 0.1, 0.1, 0.15], ice: [0.1, 0.05, 0.05, 0.3, 0.35, 0.95, 0.6, 0.7], sky: [0.05, 0.05, 0.05, 0.1, 0.1, 0.3, 0.8, 0.75] };
          var rr = ctx.rng(5);
          S.xm = ctx.matrix(MX, MY, 12, 8, { cell: cs, gap: cg, cmap: 'amber', values: function (r2, c2) { return 0.03; }, parent: S.L });
          S.xmTarget = [];
          for (r = 0; r < 12; r++) { S.xmTarget.push([]); for (var c = 0; c < 8; c++) S.xmTarget[r].push(Math.min(1, aff[reg(r)][c] * (0.8 + 0.35 * rr()))); }
          var tx = 548;
          [['Q ← video (n = 75,600)', 'lime'], ['K, V ← umT5 text (m ≤ 512)', 'amber'], ['scores: n × m per head', 'text'], ['text is read-only: the same', 'dim'], ['c feeds all 40 blocks', 'dim'], ['I2V: + 2nd cross-attn on', 'dim'], ['CLIP image tokens', 'dim']].forEach(function (l, i) {
            ctx.text(tx, 290 + i * 26, l[0], { size: 11.5, font: 'mono', color: l[1], parent: S.L });
          });
          ctx.text(82, 588, 'h ← h + softmax(Q_v K_cᵀ / √dₕ) V_c', { size: 13.5, font: 'mono', color: 'white', parent: S.L });

          /* ---- right panel: MM-DiT ---- */
          S.R = ctx.group({ parent: g });
          ctx.rect(830, 160, 710, 450, { rx: 12, fill: 'rgba(6,12,24,0.7)', stroke: ctx.alpha('lime', 0.4), sw: 1.2, parent: S.R });
          ctx.text(852, 186, 'MM-DiT JOINT ATTENTION · SD3 · FLUX · HunyuanVideo', { size: 16, font: 'display', weight: 700, color: 'white', parent: S.R });
          var JX = 1090, JY = 262, js = 22, jg = 2;
          var tokCol = function (i) { return i < 4 ? 'amber' : 'lime'; };
          for (var i = 0; i < 12; i++) {
            ctx.rect(JX + i * (js + jg), JY - 30, js, js, { rx: 3, fill: ctx.alpha(tokCol(i), 0.7), parent: S.R });
            ctx.rect(JX - 30, JY + i * (js + jg), js, js, { rx: 3, fill: ctx.alpha(tokCol(i), 0.7), parent: S.R });
          }
          ctx.text(JX + 2 * (js + jg), JY - 42, 'text', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: S.R });
          ctx.text(JX + 8 * (js + jg), JY - 42, 'video', { size: 11, font: 'mono', color: 'lime', anchor: 'middle', parent: S.R });
          var r2g = ctx.rng(9);
          S.jm = ctx.matrix(JX, JY, 12, 12, { cell: js, gap: jg, cmap: 'heat', values: function () { return 0.03; }, parent: S.R });
          S.jmTarget = [];
          for (r = 0; r < 12; r++) {
            S.jmTarget.push([]);
            for (c = 0; c < 12; c++) {
              var tr = r < 4, tc = c < 4, v;
              if (tr && tc) v = 0.35 + 0.5 * (r === c);
              else if (!tr && tc) v = 0.25 + 0.6 * r2g();
              else if (tr && !tc) v = 0.15 + 0.45 * r2g();
              else v = Math.max(0.08, 0.9 - 0.18 * Math.abs(r - c)) * (0.7 + 0.3 * r2g());
              S.jmTarget[r].push(Math.min(1, v));
            }
          }
          var qs = js + jg;
          S.quads = [
            ctx.rect(JX - 2, JY - 2, 4 * qs, 4 * qs, { rx: 3, stroke: 'amber', sw: 1.6, dash: '4 3', parent: S.R }),
            ctx.rect(JX + 4 * qs - 1, JY - 2, 8 * qs, 4 * qs, { rx: 3, stroke: 'violet', sw: 1.6, dash: '4 3', parent: S.R }),
            ctx.rect(JX - 2, JY + 4 * qs - 1, 4 * qs, 8 * qs, { rx: 3, stroke: 'violet', sw: 1.6, dash: '4 3', parent: S.R }),
            ctx.rect(JX + 4 * qs - 1, JY + 4 * qs - 1, 8 * qs, 8 * qs, { rx: 3, stroke: 'lime', sw: 1.6, dash: '4 3', parent: S.R })
          ];
          S.wT = ctx.node({ x: 945, y: 300, w: 150, h: 40, title: 'Wᵗˣᵗ qkv · FFN', color: 'amber', titleSize: 12.5, glow: false, parent: S.R });
          S.wV = ctx.node({ x: 945, y: 440, w: 150, h: 40, title: 'Wᵛⁱᵈ qkv · FFN', color: 'lime', titleSize: 12.5, glow: false, parent: S.R });
          ctx.link(S.wT, { x: JX - 32, y: JY + 2 * qs }, { color: 'amber', from: 'r', parent: S.R });
          ctx.link(S.wV, { x: JX - 32, y: JY + 8 * qs }, { color: 'lime', from: 'r', parent: S.R });
          ctx.text(945, 516, 'separate weights,', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.R });
          ctx.text(945, 536, 'one shared softmax', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.R });
          [['T·T  text ↔ text', 'amber'], ['T·V  text reads video', 'violet'], ['V·T  video reads text', 'violet'], ['V·V  3D spacetime', 'lime'], ['', 'dim'], ['then separate FFN', 'dim'], ['+ adaLN per modality', 'dim']].forEach(function (l, k) {
            if (l[0]) ctx.text(1384, 282 + k * 28, nb(l[0]), { size: 11.5, font: 'mono', color: l[1], parent: S.R });
          });
          ctx.text(852, 588, 'A = softmax([Q_c; Q_v][K_c; K_v]ᵀ / √dₕ) over n + m tokens', { size: 13.5, font: 'mono', color: 'white', parent: S.R });

          /* ---- bottom: HunyuanVideo schedule ---- */
          S.B = ctx.group({ parent: g });
          ctx.text(82, 664, 'HunyuanVideo 13B · d = 3072 · 24 heads × 128', { size: 15, font: 'display', weight: 700, color: 'white', parent: S.B });
          ctx.text(82, 688, '20 dual-stream blocks (MM-DiT, separate weights)  →  40 single-stream blocks (one weight set on the concatenated sequence)', { size: 12.5, font: 'mono', color: 'dim', parent: S.B });
          S.slabs = [];
          for (i = 0; i < 20; i++) {
            S.slabs.push(ctx.rect(82 + i * 22, 712, 16, 28, { rx: 3, fill: ctx.alpha('amber', 0.5), stroke: 'amber', sw: 0.8, parent: S.B }));
            S.slabs.push(ctx.rect(82 + i * 22, 748, 16, 28, { rx: 3, fill: ctx.alpha('lime', 0.5), stroke: 'lime', sw: 0.8, parent: S.B }));
          }
          ctx.line(530, 744, 575, 744, { color: 'white', sw: 1.6, arrow: true, parent: S.B });
          var mixc = ctx.mix('amber', 'lime', 0.5);
          for (i = 0; i < 40; i++) S.slabs.push(ctx.rect(592 + i * 22, 728, 16, 32, { rx: 3, fill: ctx.alpha('#c6df4a', 0.45), stroke: mixc, sw: 0.8, parent: S.B }));
          ctx.text(302, 796, 'dual-stream × 20', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: S.B });
          ctx.text(1037, 796, 'single-stream × 40 (parallel attention + MLP, shared weights)', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: S.B });
          ctx.text(82, 836, 'joint cost: m ≈ 256 text tokens next to n = 75,600 → (n+m)²/n² − 1 ≈ 0.7% more attention · FLUX.1 uses 19 dual + 38 single', { size: 12.5, font: 'mono', color: 'dim', parent: S.B });

          ctx.reveal(S.L, { from: 'left' });
          ctx.reveal(S.R, { from: 'right', delay: 300 });
          ctx.reveal(S.B, { from: 'up', delay: 700 });
          ctx.reveal(S.slabs, { from: 'fade', delay: 900, stagger: 18, dur: 250 });
          return ctx.wait(700).then(function () {
            return ctx.tween(1400, function (t) {
              S.xm.set(function (r3, c3) { var k = Math.min(1, Math.max(0, t * 14 - r3)); return 0.03 + (S.xmTarget[r3][c3] - 0.03) * k; });
            }, 'linear');
          }).then(function () {
            return ctx.tween(1400, function (t) {
              S.jm.set(function (r3, c3) { var k = Math.min(1, Math.max(0, t * 14 - r3)); return 0.03 + (S.jmTarget[r3][c3] - 0.03) * k; });
            }, 'linear');
          }).then(function () {
            return Promise.all(S.quads.map(function (q, k) { return ctx.pulse(q, { color: ['amber', 'violet', 'violet', 'lime'][k], dur: 600 }); }));
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'The n² wall',
        say: 'Here is the bill. Per layer, attention costs about four times n squared times d floating point operations, while all the linear layers grow only linearly in n. At Wan’s width, attention overtakes the linear layers at about twenty nine thousand tokens. At seventy five thousand six hundred tokens, it is about one hundred seventeen teraflops per layer, over seventy percent of the compute. Sparse patterns attack exactly this. Sliding tile attention keeps local three dimensional windows, and radial attention shrinks the window as the distance in time grows.',
        deep: '<p>Forward FLOPs per block (multiply-add = 2 FLOPs), Wan 14B, d = 5120, d<sub>ff</sub> = 13,824:</p>' +
          '<table><tr><th>term</th><th>formula</th><th>n = 75,600</th></tr>' +
          '<tr><td>self-attn scores + AV</td><td>4n²d</td><td>117.1 T</td></tr>' +
          '<tr><td>FFN</td><td>4n·d·d<sub>ff</sub></td><td>21.4 T</td></tr>' +
          '<tr><td>QKVO projections</td><td>8n·d²</td><td>15.9 T</td></tr>' +
          '<tr><td>cross-attn (q, o, scores)</td><td>4nd² + 4nmd</td><td>8.7 T</td></tr></table>' +
          '<div class="eq">4n²d = (12d² + 4d·d<sub>ff</sub>)·n &nbsp;⇒&nbsp; n* = 3d + d<sub>ff</sub> ≈ 29,200</div>' +
          '<p>Above n*, attention dominates and grows quadratically: 1080p (n = 171k) costs 5.1× the 720p attention. FlashAttention-3 reaches roughly 600–750 TFLOP/s BF16 on H100 at d<sub>h</sub> = 128, so dense attention alone is ~0.2 s per layer per GPU.</p>' +
          '<p><b>Sparsity that respects the hardware:</b> <i>Sliding Tile Attention</i> tiles the (t, h, w) grid into cubes (e.g. 6×8×8 = 384 tokens) and lets each query tile attend a 3D window of key tiles — every computed block is fully dense, so no FLOPs are wasted on masked entries. On HunyuanVideo it cut end-to-end latency from 945 s (FA3) to 685 s training-free and to 268 s after fine-tuning. <i>Radial attention</i> uses a static mask whose spatial window halves as temporal distance doubles (energy decay), giving O(n log n). <i>Sparse VideoGen</i> classifies heads online as spatial or temporal. Orthogonal levers: SageAttention (INT8/FP8 QKᵀ), step caching (TeaCache), and sequence parallelism.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 7);
          /* ---- left: cost curves ---- */
          S.pg = ctx.group({ parent: g });
          ctx.text(130, 190, 'COST PER LAYER vs SEQUENCE LENGTH  (Wan 14B, d = 5120)', { size: 16, font: 'display', weight: 700, color: 'white', parent: S.pg });
          var PX = 150, PY = 240, PW = 600, PH = 420;
          var pa = ctx.plot(PX, PY, PW, PH, function (x) { return x * x * 0.02048; }, { xDomain: [0, 120], yDomain: [0, 300], color: 'lime', sw: 2.6, xLabel: '', yLabel: 'TFLOP / layer', parent: S.pg });
          var plin = ctx.plot(PX, PY, PW, PH, function (x) { return 0.5977 * x; }, { xDomain: [0, 120], yDomain: [0, 300], color: 'cyan', sw: 2.2, axes: false, parent: S.pg });
          [0, 30, 60, 90, 120].forEach(function (v) { ctx.text(pa.toPx(v, 0).x, PY + PH + 18, v ? v + 'k' : '0', { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.pg }); });
          [100, 200, 300].forEach(function (v) {
            var p = pa.toPx(0, v);
            ctx.text(PX - 8, p.y, String(v), { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: S.pg });
            ctx.line(PX, p.y, PX + PW, p.y, { color: ctx.alpha('white', 0.06), sw: 1, parent: S.pg });
          });
          ctx.text(PX + PW, PY + PH + 38, 'tokens n', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: S.pg });
          ctx.text(PX + 20, PY + 22, 'attention  4·n²·d', { size: 12.5, font: 'mono', color: 'lime', parent: S.pg });
          ctx.text(PX + 20, PY + 44, 'all linears  (12d² + 4d·d_ff)·n', { size: 12.5, font: 'mono', color: 'cyan', parent: S.pg });
          S.curves8 = [pa.curve, plin.curve];
          S.mk = ctx.group({ parent: S.pg });
          var cx8 = pa.toPx(29.18, 17.44);
          ctx.circle(cx8.x, cx8.y, 5, { fill: 'amber', glow: true, parent: S.mk });
          ctx.line(cx8.x, cx8.y - 6, cx8.x - 30, cx8.y - 80, { color: ctx.alpha('amber', 0.7), sw: 1, parent: S.mk });
          ctx.text(cx8.x - 34, cx8.y - 92, 'n* = 3d + d_ff ≈ 29k', { size: 12.5, font: 'mono', color: 'amber', anchor: 'middle', parent: S.mk });
          var v1 = pa.toPx(75.6, 0), v2 = pa.toPx(75.6, 117.05), v3 = pa.toPx(75.6, 45.19);
          ctx.line(v1.x, PY, v1.x, PY + PH, { color: ctx.alpha('white', 0.45), sw: 1.2, dash: '5 5', parent: S.mk });
          ctx.text(v1.x, PY - 10, 'our shot: n = 75.6k', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.mk });
          ctx.circle(v2.x, v2.y, 5, { fill: 'lime', glow: true, parent: S.mk });
          ctx.circle(v3.x, v3.y, 5, { fill: 'cyan', glow: true, parent: S.mk });
          ctx.text(v2.x + 12, v2.y - 2, '117 TFLOP', { size: 12.5, font: 'mono', color: 'lime', weight: 600, parent: S.mk });
          ctx.text(v3.x + 12, v3.y + 22, '45 TFLOP', { size: 12.5, font: 'mono', color: 'cyan', weight: 600, parent: S.mk });
          /* stacked breakdown */
          S.bk = ctx.group({ parent: g });
          ctx.text(130, 730, 'one block at n = 75,600:  ≈ 163 TFLOP forward', { size: 14, font: 'display', weight: 700, color: 'white', parent: S.bk });
          var parts = [['self-attn 72%', 117.05, 'lime'], ['FFN 13%', 21.4, 'cyan'], ['QKVO 10%', 15.85, 'blue'], ['cross 5%', 8.72, 'amber']];
          var tot = 163.02, x0 = 130;
          S.bkBars = [];
          parts.forEach(function (p, i) {
            var w = p[1] / tot * 620;
            var b = ctx.rect(x0, 750, w - 2, 28, { rx: 3, fill: ctx.alpha(p[2], 0.55), stroke: p[2], sw: 1, parent: S.bk });
            b.setAttribute('data-w', w - 2);
            S.bkBars.push(b);
            ctx.text(i < 1 ? x0 + 10 : x0 + w / 2, i < 1 ? 764 : 796 + (i % 2) * 18, p[0], { size: 11.5, font: 'mono', color: i < 1 ? 'bg' : p[2], anchor: i < 1 ? 'start' : 'middle', weight: 600, parent: S.bk });
            x0 += w;
          });
          ctx.text(130, 852, '1080p: n = 171k → attention 5.1× of 720p; that is why 1080p is often a super-resolution pass', { size: 12, font: 'mono', color: 'dim', parent: S.bk });

          /* ---- right: sparse masks ---- */
          S.sg = ctx.group({ parent: g });
          ctx.text(880, 190, 'SPARSE SPATIOTEMPORAL ATTENTION', { size: 16, font: 'display', weight: 700, color: 'white', parent: S.sg });
          ctx.text(880, 214, 'tile-level mask: 20 query tiles × 20 key tiles, ordered (t, h)', { size: 12, font: 'mono', color: 'dim', parent: S.sg });
          S.mm = ctx.matrix(900, 244, 20, 20, { cell: 17, gap: 2, values: function () { return '#0a1120'; }, parent: S.sg });
          for (var k = 1; k < 4; k++) {
            ctx.line(900 + k * 95 - 1, 242, 900 + k * 95 - 1, 624, { color: ctx.alpha('white', 0.35), sw: 1, parent: S.sg });
            ctx.line(898, 244 + k * 95 - 1, 1280, 244 + k * 95 - 1, { color: ctx.alpha('white', 0.35), sw: 1, parent: S.sg });
          }
          ctx.text(1089, 640, 'key tiles  (4 temporal blocks × 5 spatial tiles)', { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.sg });
          S.maskChips = [];
          [['dense', 'DENSE', 282], ['sta', 'SLIDING TILE', 322], ['radial', 'RADIAL', 362]].forEach(function (m) {
            var ch = chip(ctx, S.sg, 1420, m[2], 180, m[1], function () { S.mask = m[0]; maskUpdate(ctx, S); });
            ch.mode = m[0];
            S.maskChips.push(ch);
          });
          ctx.text(1330, 424, 'computed tiles', { size: 12, font: 'mono', color: 'dim', parent: S.sg });
          S.densT = ctx.text(1330, 462, '100%', { size: 34, font: 'display', weight: 700, color: 'lime', parent: S.sg });
          S.densS = ctx.text(1330, 500, '', { size: 12, font: 'mono', color: 'lime', parent: S.sg });
          ctx.text(1330, 540, 'bright = same temporal block', { size: 11.5, font: 'mono', color: 'dim', parent: S.sg });
          ctx.text(1330, 566, 'toy size: at n = 75.6k there', { size: 11.5, font: 'mono', color: 'dim', parent: S.sg });
          ctx.text(1330, 584, 'are ~200 tiles and density', { size: 11.5, font: 'mono', color: 'dim', parent: S.sg });
          ctx.text(1330, 602, 'is roughly 10–45%', { size: 11.5, font: 'mono', color: 'dim', parent: S.sg });
          [['STA: a 3D window over tiles (e.g. 6×8×8 = 384 tokens) →', 'text'], ['every computed tile is dense: no masked-FLOP waste', 'text'],
            ['Radial: spatial window halves as |Δt| doubles → O(n log n)', 'text'], ['Sparse VideoGen: per-head spatial vs temporal, chosen online', 'dim'],
            ['orthogonal: SageAttention (INT8 QKᵀ), TeaCache step caching,', 'dim'], ['Ulysses / Ring sequence parallelism across 8 GPUs', 'dim']].forEach(function (l, i) {
            ctx.text(880, 690 + i * 26, l[0], { size: 12.5, font: 'mono', color: l[1], parent: S.sg });
          });
          S.mask = 'dense';
          maskUpdate(ctx, S);

          ctx.reveal(S.pg, { from: 'left' });
          ctx.reveal(S.curves8, { from: 'draw', dur: 1400, delay: 300, stagger: 200 });
          ctx.reveal(S.mk, { delay: 1600 });
          ctx.reveal(S.bk, { from: 'up', delay: 1200 });
          S.bkBars.forEach(function (b, i) { var w = parseFloat(b.getAttribute('data-w')); b.setAttribute('width', 0); ctx.animate(b, { width: [0, w] }, 600, 'out', 1400 + i * 200); });
          ctx.reveal(S.sg, { from: 'right', delay: 600 });
          return ctx.wait(2400).then(function () {
            S.mask = 'sta'; maskUpdate(ctx, S);
            return ctx.pulse(S.mm, { color: 'lime', dur: 700 });
          }).then(function () { return ctx.wait(1400); }).then(function () {
            S.mask = 'radial'; maskUpdate(ctx, S);
            ctx.hud('attention ≈ 72% of DiT FLOPs at n = 75.6k');
            return ctx.pulse(S.mm, { color: 'lime', dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------------ 9 */
      {
        title: 'At scale',
        say: 'Putting it together for our trailer. Wan’s large model has forty blocks of width five thousand one hundred twenty, and forty heads of one hundred twenty eight dimensions, roughly fourteen billion parameters. One forward pass over a five second, seven twenty p shot costs about six and a half petaflops. Fifty steps with guidance make about six hundred fifty petaflops, around twenty four H100 minutes per shot. That is why serving splits each shot across eight GPUs, and why distillation to a handful of steps matters so much.',
        deep: '<p><b>Parameter check</b> (Wan 2.1 14B, per block): self-attn 4d² = 105M, cross-attn 4d² = 105M, FFN 2·d·d<sub>ff</sub> = 142M → ≈ 351M × 40 blocks ≈ <b>14.0B</b>. Weights in BF16: 28 GB, so one 80 GB GPU holds the model but activations for n = 75.6k push toward FSDP/sequence parallelism.</p>' +
          '<div class="eq">C<sub>shot</sub> ≈ 163 TFLOP × 40 × 2<sub>CFG</sub> × 50 ≈ 6.5·10<sup>17</sup> FLOP</div>' +
          '<p>At 989 TFLOP/s dense BF16 (H100 SXM) and ~45% MFU: 6.5·10<sup>17</sup> / 4.45·10<sup>14</sup> ≈ 1,460 s ≈ <b>24 GPU-minutes</b> per shot; six shots ≈ 2.4 GPU-hours, before VAE decode and re-renders. (At the 24 fps / 111,600-token spec of the Video Serving chamber the naive figure is ≈ 54 GPU-minutes; its speedup ladder brings the whole trailer to ≈ 1.2 GPU-hours, the overview’s ≈ 76 GPU-min.)</p>' +
          '<p><b>Levers, multiplicative:</b></p><ul>' +
          '<li>Sequence parallel (DeepSpeed-Ulysses all-to-all over heads, or Ring attention) ×8 GPUs → ~3 min wall-clock.</li>' +
          '<li>Sparse attention: ≈ 1.4–3.5× end-to-end at 720p (STA, training-free vs fine-tuned), more at longer n.</li>' +
          '<li>Step distillation (consistency / DMD / rectified-flow students): 50 → 4–8 steps; CFG distillation removes the ×2.</li>' +
          '<li>FP8 GEMMs and quantized attention; step caching reuses block outputs across adjacent σ.</li></ul>' +
          '<p><b>Wan 2.2 A14B</b> keeps this block but splits the denoising trajectory between two 14B experts (high-noise for early σ, low-noise for late σ): 27B parameters, 14B active per step, so the per-shot FLOPs above are unchanged.</p>' +
          '<p class="muted">Related chambers: Diffusion &amp; Flow Matching, Spatiotemporal VAE, Video Model Serving, FlashAttention, Distributed Parallelism.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 8);
          ctx.hud('');
          /* spec table */
          S.tb = ctx.group({ parent: g });
          ctx.text(80, 190, 'THE REAL MODELS', { size: 18, font: 'display', weight: 700, color: 'white', parent: S.tb });
          ctx.rect(70, 206, 720, 322, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('lime', 0.35), sw: 1, parent: S.tb });
          var cols = [390, 540, 700];
          ['Wan 2.1 1.3B', 'Wan 2.1 14B', 'HunyuanVideo 13B'].forEach(function (h, i) { ctx.text(cols[i], 226, h, { size: 13, font: 'mono', weight: 700, color: i === 1 ? 'lime' : 'white', anchor: 'middle', parent: S.tb }); });
          var rows = [
            ['blocks', '30', '40', '20 dual + 40 single'],
            ['width d', '1536', '5120', '3072'],
            ['heads × dₕ', '12 × 128', '40 × 128', '24 × 128'],
            ['FFN width', '8960', '13,824', '12,288'],
            ['text path', 'cross-attn', 'cross-attn', 'MM-DiT joint'],
            ['text encoder', 'umT5', 'umT5', 'MLLM + CLIP-L'],
            ['RoPE t/h/w · θ', '44/42/42 · 1e4', '44/42/42 · 1e4', '16/56/56 · 256'],
            ['VAE · patch', '4×8×8 · 1×2×2', '4×8×8 · 1×2×2', '4×8×8 · 1×2×2']
          ];
          S.trows = rows.map(function (rw, i) {
            var rg = ctx.group({ parent: S.tb });
            var y = 262 + i * 34;
            ctx.line(84, y - 17, 776, y - 17, { color: ctx.alpha('white', 0.07), sw: 1, parent: rg });
            ctx.text(90, y, rw[0], { size: 12.5, font: 'mono', color: 'dim', parent: rg });
            for (var c = 1; c < 4; c++) ctx.text(cols[c - 1], y, rw[c], { size: 12.5, font: 'mono', color: c === 2 ? 'lime' : 'text', anchor: 'middle', parent: rg });
            return rg;
          });
          /* budget */
          S.bg = ctx.group({ parent: g });
          ctx.text(880, 190, 'BUDGET · one 5 s 720p shot on Wan 14B', { size: 18, font: 'display', weight: 700, color: 'white', parent: S.bg });
          ctx.rect(870, 206, 680, 322, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('amber', 0.35), sw: 1, parent: S.bg });
          var bud = [['1 block · n = 75,600', '163 TFLOP', 1.63e14], ['× 40 blocks', '6.5 PFLOP', 6.52e15], ['× 2 (CFG)', '13 PFLOP', 1.30e16], ['× 50 steps', '650 PFLOP', 6.52e17],
            ['÷ H100 @ 45% MFU (445 TFLOP/s)', '≈ 24 GPU-min', 0], ['× 6 shots in the trailer', '≈ 2.4 GPU-h', 0]];
          S.bbars = [];
          S.brow = bud.map(function (b, i) {
            var rg = ctx.group({ parent: S.bg });
            var y = 240 + i * 46;
            ctx.text(890, y, b[0], { size: 13, font: 'mono', color: 'text', parent: rg });
            if (b[2]) {
              var w = (Math.log(b[2]) / Math.LN10 - 13.5) / 4.5 * 200;
              ctx.rect(1170, y - 9, 200, 18, { rx: 4, fill: 'rgba(255,255,255,0.03)', parent: rg });
              var bar = ctx.rect(1170, y - 9, w, 18, { rx: 4, fill: ctx.alpha('lime', 0.55), stroke: 'lime', sw: 1, parent: rg });
              bar.setAttribute('data-w', w);
              S.bbars.push(bar);
            }
            ctx.text(1535, y, b[1], { size: 13.5, font: 'mono', weight: 700, color: b[2] ? 'lime' : 'amber', anchor: 'end', parent: rg });
            return rg;
          });
          ctx.text(1170, 516, 'log scale, 10^13.5 → 10^18', { size: 11, font: 'mono', color: 'dim', parent: S.bg });
          /* recap chain */
          S.rc = ctx.group({ parent: g });
          var ch = [
            ctx.node({ x: 160, y: 640, w: 170, h: 54, title: 'zσ latent', sub: '16×21×90×160', color: 'lime', titleSize: 13.5, subSize: 10.5, parent: S.rc }),
            ctx.node({ x: 390, y: 640, w: 200, h: 54, title: 'patchify', sub: '75,600 × 5120', color: 'lime', titleSize: 13.5, subSize: 10.5, parent: S.rc }),
            ctx.node({ x: 790, y: 640, w: 440, h: 64, title: '[ 3D RoPE · full attn · text · adaLN ] × 40', sub: 'self-attention alone = 72% of FLOPs at n = 75.6k', color: 'lime', titleSize: 14, subSize: 11, glow: 'strong', parent: S.rc }),
            ctx.node({ x: 1180, y: 640, w: 180, h: 54, title: 'unpatchify', sub: 'Linear 5120→64', color: 'lime', titleSize: 13.5, subSize: 10.5, parent: S.rc }),
            ctx.node({ x: 1420, y: 640, w: 170, h: 54, title: 'v̂', sub: 'to the sampler', color: 'cyan', titleSize: 15, subSize: 10.5, parent: S.rc })
          ];
          S.rcl = [];
          for (var i = 0; i < 4; i++) S.rcl.push(ctx.link(ch[i], ch[i + 1], { color: 'lime', parent: S.rc }));
          /* levers */
          S.lv = ctx.group({ parent: g });
          ctx.text(80, 740, 'LEVERS', { size: 14, font: 'display', weight: 700, color: 'amber', parent: S.lv });
          var levers = [['seq. parallel ×8 (Ulysses / Ring)', 300, 740], ['sparse attention 1.4–3.5×', 620, 740], ['step distillation 50 → 4–8', 900, 740], ['CFG distillation ×2', 1165, 740], ['FP8 GEMM + INT8 attention', 1395, 740],
            ['step caching (TeaCache)', 300, 784], ['VAE tiling', 525, 784], ['lower-res draft → SR pass', 740, 784]];
          S.lvChips = levers.map(function (l) { return ctx.label(l[1], l[2], l[0], { color: 'amber', size: 11.5, parent: S.lv }); });
          ctx.text(80, 830, 'Wan 2.2 A14B: same block, two 14B experts (high-noise σ early, low-noise σ late) → 27B total, 14B active, same FLOPs per step', { size: 12.5, font: 'mono', color: 'text', parent: S.lv });
          ctx.text(80, 860, 'deeper chambers: Diffusion & Flow Matching · Spatiotemporal VAE · Video Model Serving · FlashAttention · Distributed Parallelism', { size: 12.5, font: 'mono', color: 'dim', parent: S.lv });

          ctx.reveal(S.tb, { from: 'left' });
          ctx.reveal(S.trows, { from: 'left', delay: 200, stagger: 90 });
          ctx.reveal(S.bg, { from: 'right', delay: 300 });
          ctx.reveal(S.brow, { from: 'right', delay: 500, stagger: 250 });
          S.bbars.forEach(function (b, k) { var w = parseFloat(b.getAttribute('data-w')); b.setAttribute('width', 0); ctx.animate(b, { width: [0, w] }, 600, 'out', 600 + k * 250); });
          ctx.reveal(S.rc, { from: 'up', delay: 1600 });
          ctx.reveal(S.lv, { from: 'up', delay: 2200 });
          ctx.reveal(S.lvChips, { from: 'scale', delay: 2300, stagger: 90 });
          ctx.hud('≈ 24 H100-min per shot at 50 steps + CFG');
          return ctx.wait(2400).then(function () {
            return S.rcl.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'lime', dur: 450 }); }); }, Promise.resolve());
          });
        }
      }
    ]
  });
})();
