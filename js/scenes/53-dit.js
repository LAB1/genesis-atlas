/* L2 — Diffusion Transformer (DiT). One forward pass of the video denoiser, told beat by beat: the sampling loop,
 * spacetime patches, full 3D self-attention vs factorized attention, 3D RoPE, adaLN-Zero timestep modulation,
 * text conditioning (cross-attention vs MM-DiT) and the n^2 cost wall with sparse attention. */
(function () {
  var ROAD = ['latent', 'patchify', 'attention', 'factorize', '3D RoPE', 'adaLN', 'text', 'n² wall', 'scale'];
  /* attention demo geometry: 5 latent frames x 6 x 8 tokens */
  var K = 5, RR = 6, CC = 8, CELL = 26, GAP = 3;
  var FX0 = 105, FSTEP = 290, FY = 296;
  var FW = CC * (CELL + GAP) - GAP, FH = RR * (CELL + GAP) - GAP;
  var TLAB = [0, 5, 10, 15, 20];

  /* make elements invisible until the beat that introduces them reveals them */
  function hide(list) { (Array.isArray(list) ? list : [list]).forEach(function (e) { if (Array.isArray(e)) hide(e); else if (e) e.setAttribute('opacity', 0); }); }
  /* type several lines into a ctx.code panel, one after the other */
  function typeLines(code, list) {
    return list.reduce(function (p, s) { return p.then(function () { return code.addLine(s); }); }, Promise.resolve());
  }

  function buildRoad(ctx, S) {
    S.roadG = ctx.group();
    S.pills = ROAD.map(function (s, i) {
      var x = 866 + i * 78;
      var r = ctx.rect(x, 88, 72, 24, { rx: 12, fill: 'rgba(255,255,255,0.03)', stroke: ctx.C.line, sw: 1, parent: S.roadG });
      var t = ctx.text(x + 36, 100.5, s, { size: 11, font: 'mono', anchor: 'middle', color: 'dim', parent: S.roadG });
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
  var CAP = {
    full: 'FULL 3D · keys = all 75,600 tokens of the clip',
    spatial: 'SPATIAL · keys = the 3,600 tokens of the query’s own frame',
    temporal: 'TEMPORAL · keys = the same (h, w) in all 21 frames'
  };

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
      if (S.live) {
        S.acells[k].cells[r][c].setAttribute('fill', fill);
        S.strip[i].setAttribute('fill', fill);
      }
      if (p >= 0) {
        mass[k] += p;
        if (!(k === q.k && r === q.r && c === q.c) && p > best[k].p) best[k] = { p: p, r: r, c: c };
      }
      i++;
    }
    for (k = 0; k < K; k++) S.flab[k].textContent = 't = ' + TLAB[k] + (S.showMass ? '  ·  ' + Math.round(mass[k] * 100) + '%' : '');
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
    if (S.capT) S.capT.textContent = CAP[mode];
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
      'Peebles &amp; Xie, <i>Scalable Diffusion Models with Transformers (DiT)</i>, ICCV 2023',
      'Esser et al., <i>Scaling Rectified Flow Transformers for High-Resolution Image Synthesis (SD3)</i>, ICML 2024',
      'Wan Team (Alibaba), <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025',
      'Kong et al., <i>HunyuanVideo: A Systematic Framework for Large Video Generative Models</i>, arXiv 2412.03603, 2024',
      'Yang et al., <i>CogVideoX: Text-to-Video Diffusion Models with an Expert Transformer</i>, ICLR 2025',
      'Su et al., <i>RoFormer: Enhanced Transformer with Rotary Position Embedding</i>, 2021; Peng et al., <i>YaRN: Efficient Context Window Extension of LLMs</i>, ICLR 2024',
      'Zhao et al., <i>RIFLEx: A Free Lunch for Length Extrapolation in Video Diffusion Transformers</i>, ICML 2025',
      'Bertasius et al., <i>Is Space-Time Attention All You Need for Video Understanding? (TimeSformer)</i>, ICML 2021',
      'Zhang et al., <i>Fast Video Generation with Sliding Tile Attention</i>, ICML 2025; Xi et al., <i>Sparse VideoGen</i>, ICML 2025',
      'Li et al., <i>Radial Attention: O(n log n) Sparse Attention with Energy Decay for Long Video Generation</i>, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'The denoiser',
        beats: [
          {
            say: 'Zoom into the heart of the video model: the diffusion transformer, or DiT. At every sampling step it receives a noisy video latent, and its job is to say how that latent should change.',
            card: { tag: 'KEY IDEA', title: 'A learned vector field', body: 'Given a noisy latent, the DiT points toward a cleaner one. Sampling is nothing more than following those arrows, step after step.' },
            deep: '<p>The DiT is the learned <b>vector field</b> of a flow-matching sampler. Take a clean latent <i>x</i>, draw Gaussian noise ε, and interpolate. With the rectified-flow convention used by SD3, Wan and HunyuanVideo:</p>' +
              '<div class="eq">z<sub>σ</sub> = (1−σ)·x + σ·ε,&nbsp;&nbsp; v = ε − x,&nbsp;&nbsp; L = E‖v<sub>θ</sub>(z<sub>σ</sub>, σ, c) − v‖²</div>' +
              '<p>Training draws σ (SD3 uses a logit-normal density that favours mid noise levels), builds z<sub>σ</sub> and regresses the velocity. Everything after this point is a way of making v<sub>θ</sub> accurate and affordable.</p>'
          },
          {
            say: 'Two more inputs steer it. The noise level tells the network how much of what it sees is still signal, and the encoded prompt, from a multilingual T five text encoder, says what the fox astronaut scene should contain.',
            card: { tag: 'HOW IT WORKS', title: 'Two side inputs, two routes', body: 'The prompt enters through attention as 512 tokens. The noise level enters as a modulation vector inside every block.' },
            deep: '<p>Three tensors cross the boundary of the network (Wan 2.1, 5 s, 720p):</p>' +
              '<table><tr><th>Tensor</th><th>Shape</th></tr>' +
              '<tr><td>latent z<sub>σ</sub></td><td>16 × 21 × 90 × 160 (C×T×H×W)</td></tr>' +
              '<tr><td>text c</td><td>512 × 4096 (umT5-XXL, frozen)</td></tr>' +
              '<tr><td>noise level</td><td>scalar σ, fed as t = 1000σ</td></tr></table>' +
              '<p>The text is projected to the model width by a small MLP and read by cross-attention; σ goes through a sinusoidal embedding and a time MLP and re-enters every block as adaptive-LayerNorm modulation (steps 6 and 7).</p>'
          },
          {
            say: 'Out comes a velocity: for every one of the roughly five million latent numbers, a direction that carries noise toward a clean video. It has exactly the same shape as the input.',
            card: { tag: 'NUMBERS', title: 'Same shape in and out', stat: { v: '4.8 M', u: 'numbers per tensor', l: 'a 16 × 21 × 90 × 160 latent goes in; an identically shaped velocity comes out' } },
            deep: '<p>Each of the ≈ 4.8 M latent numbers gets its own velocity. Because v = ε − x, a prediction converts into a clean-video estimate:</p>' +
              '<div class="eq">x̂ = z<sub>σ</sub> − σ·v̂,&nbsp;&nbsp; ε̂ = z<sub>σ</sub> + (1−σ)·v̂</div>' +
              '<p>Early (σ ≈ 1) x̂ is a blurry average of every video that fits the prompt; late (σ ≈ 0) it is nearly the sample. The same network must therefore behave very differently at different σ: the job of the noise-level modulation in step 6.</p>' +
              '<details><summary>Go deeper</summary><p>Check: z − σ(ε − x) = x. Predicting v keeps the target well scaled at both ends of the schedule (ε is unidentifiable at σ → 0, x at σ → 1).</p></details>'
          },
          {
            say: 'For our fox shot the sampler takes fifty Euler steps, and each step needs two network evaluations because of classifier free guidance, one with the prompt and one without. That is one hundred passes through a fourteen billion parameter transformer. This chamber opens the box and follows a single pass.',
            card: { tag: 'NUMBERS', title: 'The loop around the box', stat: { v: '100', u: 'forward passes', l: 'per 5 s shot: 50 sampler steps × 2 for classifier-free guidance' }, more: '<p>Each pass costs about 6.5 PFLOP at 720p, so one shot is roughly 650 PFLOP. Step 9 derives this from the block shapes and shows why the serving chambers fight for every factor.</p>' },
            deep: '<p>Sampling integrates the ODE dz/dσ = v from σ = 1 (pure noise) to σ = 0 with an Euler or higher-order solver:</p>' +
              '<div class="eq">z<sub>σ′</sub> = z<sub>σ</sub> + (σ′ − σ) · v̂,&nbsp;&nbsp; v̂ = v<sub>u</sub> + w·(v<sub>c</sub> − v<sub>u</sub>)</div>' +
              '<p>The second equation is classifier-free guidance (w ≈ 5 for Wan): one conditional and one unconditional pass per step, hence <b>2 × 50 = 100 network evaluations</b> per shot. The σ grid is shifted toward high noise, σ′ = sσ / (1 + (s−1)σ), so more steps go where the scene layout is decided.</p>' +
              '<p class="muted">Schedules, samplers and distillation: Diffusion &amp; Flow Matching chamber. The VAE behind z: Spatiotemporal VAE chamber.</p>'
          }
        ],
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
          S.rows = [];
          for (var i = 0; i < 5; i++) {
            S.rows.push(ctx.rect(665, 374 + i * 19, 270, 13, { rx: 3, fill: ctx.alpha('lime', 0.1 + 0.05 * i), stroke: ctx.alpha('lime', 0.6), sw: 1, parent: S.gDit }));
          }
          ctx.text(800, 489, '× 40 DiT blocks · d = 5120 · 40 heads', { size: 12.5, font: 'mono', color: 'lime', anchor: 'middle', parent: S.gDit });
          ctx.text(800, 511, 'adaLN(σ) · 3D RoPE · cross-attn(c)', { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gDit });
          ctx.node({ x: 800, y: 574, w: 280, h: 38, title: 'Linear 5120→64 · Unpatchify', titleSize: 12.5, color: 'lime', kind: 'chip', glow: false, parent: S.gDit });

          S.gCond = ctx.group({ parent: g });
          S.txt = ctx.node({ x: 800, y: 200, w: 300, h: 50, title: 'umT5 text encoder', sub: '"fox astronaut…" → 512 × 4096', icon: 'doc', color: 'amber', titleSize: 14, subSize: 11, parent: S.gCond });
          S.tn = ctx.node({ x: 800, y: 700, w: 300, h: 50, title: 'noise level σ', sub: 'sinusoid → MLP → adaLN', icon: 'clock', color: 'cyan', titleSize: 14, subSize: 11, parent: S.gCond });

          S.lT = ctx.link(S.txt, S.dit, { from: 'b', to: 't', color: 'amber', parent: g });
          S.lS = ctx.link(S.tn, S.dit, { from: 't', to: 'b', color: 'cyan', parent: g });
          S.lIn = ctx.link({ x: 424, y: 460 }, S.dit, { to: 'l', color: 'lime', straight: true, parent: g });
          S.lOut = ctx.link(S.dit, { x: 1136, y: 460 }, { from: 'r', color: 'cyan', straight: true, parent: g });
          S.loopP = ctx.path('M1280,584 Q780,940 200,584', { stroke: ctx.alpha('lime', 0.75), sw: 1.6, dash: '6 6', arrow: true, parent: g });
          S.gLoop = ctx.group({ parent: g });
          ctx.text(780, 786, 'Euler step  z ← z + (σ′ − σ)·v̂   · 50 steps', { size: 13, font: 'mono', color: 'lime', anchor: 'middle', parent: S.gLoop });
          ctx.text(780, 816, '50 steps × 2 (CFG: cond + uncond) = 100 DiT forward passes per shot', { size: 12.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gLoop });
          S.cnt = ctx.text(780, 848, 'sampling step 1 / 50  ·  σ = 1.00', { size: 13.5, font: 'mono', color: 'white', anchor: 'middle', weight: 600, parent: S.gLoop });
          hide([S.gIn, S.gOut, S.gDit, S.gCond, S.gLoop, S.lT, S.lS, S.lIn, S.lOut, S.loopP]);

          /* beat 0: the noisy latent goes into the DiT */
          return Promise.all([
            ctx.reveal(S.gIn, { from: 'left' }),
            ctx.reveal(S.gDit, { from: 'scale', s0: 0.9, delay: 250 }),
            ctx.reveal(S.lIn, { from: 'draw', delay: 700 })
          ]).then(function () {
            return ctx.packet(S.lIn, { color: 'lime', dur: 700, label: 'zσ' });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the prompt and the noise level */
            return Promise.all([ctx.reveal(S.gCond, { from: 'fade' }), ctx.reveal([S.lT, S.lS], { from: 'draw', delay: 300, stagger: 150 })]).then(function () {
              return Promise.all([
                ctx.packet(S.lT, { color: 'amber', dur: 700, label: 'c' }),
                ctx.packet(S.lS, { color: 'cyan', dur: 700, label: 'σ' })
              ]);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the velocity comes out */
            return Promise.all([ctx.reveal(S.gOut, { from: 'right' }), ctx.reveal(S.lOut, { from: 'draw', delay: 200 })]).then(function () {
              return ctx.packet(S.lOut, { color: 'cyan', dur: 600, label: 'v̂' });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: 50 Euler steps, 2 passes each */
            return Promise.all([ctx.reveal(S.gLoop, { from: 'fade' }), ctx.reveal(S.loopP, { from: 'draw', dur: 900 })]).then(function () {
              ctx.packet(S.loopP, { color: 'lime', dur: 1200 });
              return ctx.tween(2600, function (t) {
                var st = Math.round(1 + 49 * t);
                S.cnt.textContent = 'sampling step ' + st + ' / 50  ·  σ = ' + (1 - t).toFixed(2);
                var s = Math.pow(t, 1.3);
                for (var j = 0; j < 5; j++) for (var r = 0; r < 6; r++) for (var c = 0; c < 9; c++) {
                  S.inS.mats[j].cells[r][c].setAttribute('fill', ctx.cmap('lime', S.inS.noise[j][r][c] * (1 - s) + S.inS.clean[j][r][c] * s));
                }
              }, 'inOut');
            }).then(function () {
              return ctx.pulse(S.dit, { color: 'lime', times: 2, dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Spacetime patches',
        beats: [
          {
            say: 'A transformer consumes a sequence, so the latent video must become tokens. The VAE has already compressed eighty one frames of seven twenty p video by four in time and eight in each spatial direction. What is left is twenty one latent frames, each ninety by one hundred sixty cells with sixteen channels.',
            card: { tag: 'NUMBERS', title: 'What the VAE leaves behind', stat: { v: '46×', u: 'fewer numbers', l: '223.9 M pixel values become a 4.8 M value latent: 256× fewer positions, 16 channels each' } },
            deep: '<p>The causal VAE keeps frame 0 on its own and compresses the following frames 4:1 in time, so T′ = 1 + (81 − 1)/4 = 21. Spatially it is 8× per axis, and the latent has 16 channels:</p>' +
              '<div class="eq">81 × 720 × 1280 × 3 = 223.9 M values &nbsp;→&nbsp; 16 × 21 × 90 × 160 = 4.84 M values</div>' +
              '<p>That is a 46× reduction in numbers and 256× in positions. The DiT never sees a pixel: it works entirely on this latent, which is why the VAE decides what the generator can afford.</p>' +
              '<p class="muted">The autoencoder itself lives in the Spatiotemporal VAE chamber.</p>'
          },
          {
            say: 'The patch embedder then groups every two by two block of cells within a frame into one token. Time is not grouped, so each token lives inside a single latent frame.',
            card: { tag: 'HOW IT WORKS', title: 'A patch is a 1×2×2 cube', body: 'Non-overlapping cubes: one latent frame, a 2 × 2 block of cells, 16 channels. That is 64 numbers per token.', more: '<p>Token count for the 720p shot under other patch sizes: 1×2×2 gives 75,600; 2×2×2 (frame pairs merged) gives 37,800; 1×4×4 gives 18,900. Attention scales with n², so those cost 4× and 16× less, at the price of coarser tokens that must carry more detail.</p>' },
            deep: '<p>Patchify is a strided 3D convolution: <code>Conv3d(16, 5120, kernel=(1,2,2), stride=(1,2,2))</code>, one shared linear map applied to non-overlapping 1×2×2 cubes.</p>' +
              '<div class="eq">n = T′·(H′/p<sub>h</sub>)·(W′/p<sub>w</sub>) = 21 · 45 · 80 = 75,600</div>' +
              '<p><b>Design trade-off:</b> a larger patch (2×2×2 or 1×4×4) cuts n by 2–4× and attention by 4–16×, but every token must then reconstruct more detail through the final linear layer. High-compression VAEs (Wan 2.2 TI2V-5B with a 16×16×4 VAE, LTX-Video with 32×32×8) move that burden into the autoencoder instead.</p>'
          },
          {
            say: 'A linear layer then lifts those sixty four numbers to the model width of five thousand one hundred twenty. No position is added here; where a token sits is injected later, inside attention.',
            card: { tag: 'KEY IDEA', title: 'Tokens start without a position', body: 'There is no additive position table. Time, height and width enter as rotations of queries and keys, inside every attention layer.' },
            deep: '<p>The embedder is a single linear map ℝ<sup>64</sup> → ℝ<sup>5120</sup>: 64·5120 + 5120 ≈ 333 k parameters, shared by every token. Its mirror image, Linear 5120 → 64 followed by unpatchify, closes the network.</p>' +
              '<p><b>No additive position embedding.</b> An absolute table cannot extrapolate to another resolution or length. Position instead enters through 3D RoPE (step 5), so the same weights serve 480p and 720p and clips of different length.</p>' +
              '<details><summary>Go deeper</summary><p>The map is shared and the width is 80× the input size, so most of a token’s 5120 numbers are a learned re-encoding of 64 latent values, not extra information. Width buys capacity for the layers that follow.</p></details>'
          },
          {
            say: 'Line the tokens up in raster order, frame by frame, and the result is a single sequence of seventy five thousand six hundred tokens for one five second shot.',
            card: { tag: 'NUMBERS', title: 'One shot, one sequence', stat: { v: '75,600', u: 'tokens', l: '21 × 45 × 80, each a 5120-wide vector: n² ≈ 5.7 × 10⁹ query–key pairs per head' } },
            deep: '<p>Tokens are laid out in (t, h, w) raster order: <code>x ∈ ℝ^[B, n, d] = [1, 75,600, 5120]</code>. One activation tensor is 75,600 × 5120 × 2 B ≈ 774 MB in bf16, and each attention head scores n² ≈ 5.7·10<sup>9</sup> query–key pairs.</p>' +
              '<div class="note"><b>Two frame rates in this atlas.</b> This chamber uses Wan 2.1’s native 5 s at 16 fps (81 frames, 75,600 tokens), interpolated to 24 fps in post. The Video Generation, VAE, Diffusion and Serving chambers render 5 s natively at 24 fps: 121 frames, 111,600 tokens, 1.48× the tokens and ≈ 2.2× the attention FLOPs.</div>'
          },
          {
            say: 'Resolution decides everything downstream. At four eighty p there are about thirty three thousand tokens. At ten eighty p there are one hundred seventy one thousand, and attention costs five times more than at seven twenty p.',
            card: { tag: 'TRADE-OFF', title: 'Resolution is quadratic in cost', body: 'Double both spatial sides: four times the tokens, sixteen times the attention. That is why 1080p is often a separate super-resolution pass.' },
            deep: '<table><tr><th>Resolution (81 f)</th><th>tokens n</th><th>attn ∝ n²</th></tr>' +
              '<tr><td>480×832</td><td>21·30·52 = 32,760</td><td>0.19×</td></tr>' +
              '<tr><td>720×1280</td><td>21·45·80 = 75,600</td><td>1×</td></tr>' +
              '<tr><td>1088×1920</td><td>21·68·120 = 171,360</td><td>5.1×</td></tr></table>' +
              '<p>Same recipe everywhere: Wan 2.x, HunyuanVideo and CogVideoX use a 4×8×8 VAE with 2×2 patches; the Sora report calls the result <i>spacetime patches</i>. The VAE fixes T′·H′·W′, the patch fixes tokens per latent cell; together they fix n, and n² fixes the bill.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          function patchAt(p) {
            var pr = Math.floor(p / 6), pc = p % 6;
            S.phl.setAttribute('x', 68 + pc * 76); S.phl.setAttribute('y', 238 + pr * 76);
            S.v64.set(function (r, c) { return latentVal(2, pr * 2 + (c >> 3), pc * 2 + ((c >> 2) & 1), 8, 12) * (0.6 + 0.4 * Math.abs(Math.sin(c * 1.3))); });
          }
          /* beat 0 starts with a close-up of the latent stack, then a fresh stage */
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
            /* one latent frame */
            S.gFrame = ctx.group({ parent: g });
            S.pgrid = ctx.matrix(70, 240, 8, 12, { cell: 34, gap: 4, cmap: 'lime', values: function (r, c) { return latentVal(2, r, c, 8, 12); }, parent: S.gFrame });
            ctx.text(70, 562, 'one latent frame · 90 × 160 × 16  (shown 8 × 12 × 1)', { size: 12, font: 'mono', color: 'dim', parent: S.gFrame });
            /* patches: dashed grid, moving highlight, patch vector */
            S.gPatch = ctx.group({ parent: g });
            var d = '';
            for (var i = 0; i <= 6; i++) d += 'M' + (68 + i * 76) + ',238V542';
            for (var j = 0; j <= 4; j++) d += 'M68,' + (238 + j * 76) + 'H524';
            ctx.path(d, { stroke: ctx.alpha('white', 0.6), sw: 1.4, dash: '4 3', parent: S.gPatch });
            ctx.text(70, 582, 'dashed = 1×2×2 patch → one token', { size: 12, font: 'mono', color: 'lime', parent: S.gPatch });
            S.phl = ctx.rect(68, 238, 76, 76, { rx: 4, stroke: 'white', sw: 2.4, glow: true, parent: S.gPatch });
            ctx.text(580, 256, 'patch = z[t, 2i:2i+2, 2j:2j+2, :]', { size: 13, font: 'mono', color: 'text', parent: S.gPatch });
            S.v64 = ctx.vector(580, 276, 16, { horizontal: true, cell: 18, gap: 2, cmap: 'lime', values: [0.2, 0.4, 0.3, 0.8, 0.6, 0.1, 0.5, 0.7, 0.2, 0.9, 0.3, 0.4, 0.6, 0.2, 0.5, 0.8], parent: S.gPatch });
            ctx.text(580, 312, '∈ ℝ⁶⁴  (16 ch × 2 × 2)', { size: 12, font: 'mono', color: 'dim', parent: S.gPatch });
            /* the linear lift */
            S.gLin = ctx.group({ parent: g });
            ctx.line(740, 324, 740, 364, { color: 'lime', sw: 1.6, arrow: true, parent: S.gLin });
            ctx.text(752, 344, 'W_in · Linear 64 → 5120', { size: 12, font: 'mono', color: 'lime', parent: S.gLin });
            S.v5k = ctx.vector(580, 374, 24, { horizontal: true, cell: 11, gap: 2, cmap: 'cyan', values: function (r, c) { return 0.25 + 0.6 * Math.abs(Math.sin(c * 1.7)); }, parent: S.gLin });
            ctx.text(580, 404, 'token ∈ ℝ⁵¹²⁰  (model width d)', { size: 12, font: 'mono', color: 'dim', parent: S.gLin });
            ctx.text(580, 440, 'position: added later, inside', { size: 12, font: 'mono', color: 'dim', parent: S.gLin });
            ctx.text(580, 458, 'attention, by 3D RoPE', { size: 12, font: 'mono', color: 'dim', parent: S.gLin });
            /* the arithmetic, typed line by line across the beats */
            S.code2 = ctx.code({ parent: g, x: 1030, y: 170, w: 530, title: 'token count · Wan 2.1 · 5 s @ 16 fps, 720p', lang: 'text', typing: true, maxLines: 8, color: 'lime', lines: [] });
            /* sequence strip and big number */
            S.gSeq = ctx.group({ parent: g });
            ctx.text(70, 636, 'sequence order: (t, h, w) raster  ·  x ∈ ℝ^[B, n, d] = [1, 75,600, 5120]', { size: 12.5, font: 'mono', color: 'text', parent: S.gSeq });
            S.seq = [];
            var segX = [70, 282, 494, 790], segT = ['t = 0 · 3,600', 't = 1 · 3,600', 't = 2 · 3,600', 't = 20 · 3,600'];
            segX.forEach(function (sx, s) {
              for (var q = 0; q < 12; q++) {
                S.seq.push(ctx.rect(sx + q * 16, 656, 14, 24, { rx: 2, fill: ctx.cmap('lime', 0.9 - s * 0.15), opacity: 0.12, parent: S.gSeq }));
              }
              ctx.text(sx + 95, 698, segT[s], { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gSeq });
            });
            ctx.text(742, 668, '… × 17 …', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gSeq });
            S.gBig = ctx.group({ parent: g });
            S.bigN = ctx.text(1295, 452, '0', { size: 46, font: 'display', weight: 700, color: 'lime', anchor: 'middle', parent: S.gBig });
            ctx.text(1295, 492, 'tokens in one sequence (one 5 s shot)', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gBig });
            ctx.text(1295, 516, 'n² ≈ 5.7 × 10⁹ query–key pairs per head', { size: 13, font: 'mono', color: 'amber', anchor: 'middle', parent: S.gBig });
            /* resolution table and closing remarks */
            S.gRes = ctx.group({ parent: g });
            ctx.rect(1030, 560, 530, 150, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('lime', 0.35), sw: 1, parent: S.gRes });
            ctx.text(1050, 584, 'resolution', { size: 12, font: 'mono', color: 'dim', parent: S.gRes });
            ctx.text(1250, 584, 'tokens n', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.gRes });
            ctx.text(1420, 584, 'attention ∝ n²', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.gRes });
            [['480×832', '32,760', '0.19×', 'text'], ['720×1280', '75,600', '1×', 'lime'], ['1088×1920', '171,360', '5.1×', 'amber']].forEach(function (row, k) {
              var y = 616 + k * 30;
              ctx.text(1050, y, row[0], { size: 13, font: 'mono', color: row[3], parent: S.gRes });
              ctx.text(1250, y, row[1], { size: 13, font: 'mono', color: row[3], anchor: 'end', parent: S.gRes });
              ctx.text(1420, y, row[2], { size: 13, font: 'mono', color: row[3], anchor: 'end', parent: S.gRes });
            });
            S.gNote = ctx.group({ parent: g });
            ctx.text(70, 742, 'same recipe everywhere: Wan 2.x, HunyuanVideo, CogVideoX (4×8×8 VAE + 2×2 patch); Sora report: "spacetime patches"', { size: 12, font: 'mono', color: 'dim', parent: S.gNote });
            ctx.text(70, 766, 'the VAE sets T′·H′·W′, the patch sets tokens per latent cell: together they fix n, and n² fixes the bill', { size: 12, font: 'mono', color: 'dim', parent: S.gNote });
            hide([S.gPatch, S.gLin, S.gSeq, S.gBig, S.gRes, S.gNote, S.gFrame]);
            patchAt(0);

            /* beat 0: latent frames and the VAE arithmetic */
            return Promise.all([
              ctx.reveal(S.gFrame, { from: 'left', dur: 500 }),
              typeLines(S.code2, ['video    81 × 720 × 1280 × 3', 'VAE ↓    t/4 · h/8 · w/8 · 16 ch', 'latent   21 × 90 × 160 × 16', '         (21 = 1 + 80/4, frame 0 alone)'])
            ]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: 1x2x2 patches sweep across the frame */
            return Promise.all([
              ctx.reveal(S.gPatch, { dur: 400 }),
              typeLines(S.code2, ['patch    1 × 2 × 2', 'tokens   21 × 45 × 80']),
              ctx.tween(2600, function (t) { patchAt(Math.min(23, Math.floor(t * 24))); }, 'linear', 400)
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the linear lift to model width */
            return Promise.all([ctx.reveal(S.gLin, { from: 'up', dur: 500 }), typeLines(S.code2, ['token    16·1·2·2 = 64 → d = 5120'])]).then(function () {
              return Promise.all([ctx.pulse(S.v64, { color: 'lime', dur: 600 }), ctx.pulse(S.v5k, { color: 'cyan', dur: 600 })]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: raster order, one long sequence */
            return Promise.all([ctx.reveal(S.gSeq, { dur: 300 }), ctx.reveal(S.gBig, { dur: 300 })]).then(function () {
              return Promise.all([
                ctx.tween(2600, function (t) {
                  patchAt(Math.min(23, Math.floor(t * 24)));
                  var lit = Math.round(t * S.seq.length);
                  S.seq.forEach(function (e, i2) { e.setAttribute('opacity', i2 < lit ? 1 : 0.12); });
                }, 'linear'),
                ctx.counter(S.bigN, 0, 75600, 2400),
                typeLines(S.code2, ['n        75,600 per forward pass'])
              ]);
            }).then(function () { ctx.hud('n = 21 × 45 × 80 = 75,600 tokens'); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: resolution scales the token count */
            return Promise.all([ctx.reveal(S.gRes, { from: 'up' }), ctx.reveal(S.gNote, { from: 'up', delay: 300 })]).then(function () {
              return ctx.pulse(S.gRes, { color: 'amber', dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Full 3D attention',
        beats: [
          {
            say: 'Now the core operation. Every token attends to every other token, across space and across time. Here are five of the twenty one latent frames, drawn as small grids, with the fox tokens outlined in orange.',
            card: { tag: 'KEY IDEA', title: 'One sequence, no walls', body: 'Space and time are flattened into one list. Nothing in the architecture separates a token’s neighbours in space from its neighbours in time.' },
            deep: '<p>Every block runs multi-head self-attention over the <i>whole</i> flattened video, with no separation between spatial and temporal neighbours:</p>' +
              '<div class="eq">Attn(X) = softmax(Q Kᵀ / √d<sub>h</sub>) V,&nbsp;&nbsp; Q = XW<sub>q</sub>, K = XW<sub>k</sub>, V = XW<sub>v</sub>, X ∈ ℝ<sup>n×d</sup></div>' +
              '<p>Shapes for Wan 14B: X ∈ ℝ<sup>75,600×5120</sup>, split into H = 40 heads of d<sub>h</sub> = 128, so Q, K, V ∈ ℝ<sup>40×75,600×128</sup>. The figure shows an <b>illustrative</b> head over 5 of the 21 latent frames and 6 × 8 of the 45 × 80 tokens in each.</p>'
          },
          {
            say: 'Watch the query token sitting on the fox in the middle frame. It scores every one of the seventy five thousand six hundred tokens with a dot product, and a softmax turns those scores into weights.',
            card: { tag: 'HOW IT WORKS', title: 'One query, one softmax row', body: 'The heatmap is one row of an n × n matrix, flattened in (t, h, w) order. Its weights sum to one over all tokens.' },
            deep: '<p>The colours are one query’s softmax weights over all keys; the strip below flattens them in (t, h, w) order. That is one row of an n × n matrix that sums to 1. The logit for key j is q·k<sub>j</sub>/√d<sub>h</sub>: a content term (fox queries match fox keys) plus, through RoPE, a soft relative-position term.</p>' +
              '<p>Learned heads specialise: some are local in space, some track objects through time, some are global (lighting, style). The sparse-attention methods of step 8 exploit exactly this structure.</p>'
          },
          {
            say: 'Its strongest keys are the fox tokens in every other frame, even though the fox has moved as it falls. Full spatiotemporal attention follows an object along a diagonal path through spacetime in a single hop.',
            card: { tag: 'KEY IDEA', title: 'Motion is a diagonal in spacetime', body: 'One attention hop links the fox at t = 0 and t = 20, although its position changes every frame.' },
            deep: '<p>The query on the fox at t = 10 puts most of its mass on fox tokens at t = 0…20, which sit at <i>different</i> (h, w) because the fox falls diagonally through the frame. One hop connects them: motion becomes a diagonal path through spacetime, and identity is kept by direct lookup rather than relayed frame by frame.</p>' +
              '<p>The percentages under each frame show how the row’s probability mass divides across time. The pattern is hand-built to illustrate the mechanism; it is not a captured head.</p>'
          },
          {
            say: 'The price is a score matrix with seventy five thousand six hundred squared entries, per head and per layer. It is never stored: FlashAttention streams tiles through on-chip memory, so memory stays linear even though compute stays quadratic.',
            card: { tag: 'NUMBERS', title: 'The price of seeing everything', stat: { v: '5.7 × 10⁹', u: 'scores', l: 'per head per layer at n = 75,600; times 40 heads and 40 layers in one forward pass' }, more: '<p>Total ≈ 9.1 × 10¹² softmax entries per pass, 100 passes per shot. Materialised in bf16 that would be 18 TB per pass; streaming tiles through SRAM avoids it entirely.</p>' },
            deep: '<p>With n = 75,600, H = 40 heads and d<sub>h</sub> = 128, each head scores 5.7·10<sup>9</sup> pairs per layer; × 40 heads × 40 layers ≈ 9.1·10<sup>12</sup> softmax entries per forward pass. FlashAttention-style kernels stream K/V tiles through on-chip SRAM with an online softmax, so memory is O(n·d) while compute stays O(n²·d).</p>' +
              '<p>Wan also applies <b>QK-RMSNorm</b> to q and k (over the full 5120-wide projection; HunyuanVideo and SD3 normalise per head). It keeps logits bounded at this length; without it, attention-logit growth destabilises large-scale bf16 training (Dehghani et al., ViT-22B).</p>'
          },
          {
            say: 'Click any token to move the query, and the row of the matrix and the arrows follow it. Put the query on the ice, and the attention moves to the ice in every frame.',
            card: { tag: 'TRY IT', title: 'Click any token', body: 'Move the query onto the fox, the ice or the sky. The heatmap, the strip and the arrows all recompute from the same softmax.' },
            deep: '<p>Every cell in the five grids is clickable. The heatmap is the softmax row of the chosen query; the amber arrows point at its strongest key in each other frame; the percentages under each frame are the row’s mass per frame.</p>' +
              '<p>Things to try: a query on the ice puts its mass on ice tokens across all frames (the background is static, so its hop is short); a query in the sky is diffuse. Fox queries produce the diagonal hop. That is the pattern full attention pays n² to obtain and factorized attention cannot represent in a single layer.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 2);
          ctx.hud('');
          S.t3 = ctx.text(FX0, 190, 'FULL 3D SELF-ATTENTION · every token sees all 75,600', { size: 19, font: 'display', weight: 700, color: 'white', parent: g });
          ctx.text(FX0, 214, 'illustrative head · 5 of 21 latent frames · 6 × 8 of 45 × 80 tokens each · orange outline = fox tokens', { size: 12, font: 'mono', color: 'dim', parent: g });
          S.q = { k: 2, r: 2, c: 4 };
          S.mode = 'full'; S.showMass = false; S.live = false;
          S.fr = ctx.group({ parent: g });
          S.acells = []; S.flab = [];
          for (var k = 0; k < K; k++) {
            var fx = FX0 + k * FSTEP;
            ctx.rect(fx - 7, FY - 7, FW + 14, FH + 14, { rx: 6, fill: '#070d1a', stroke: ctx.alpha('lime', 0.45), sw: 1.2, parent: S.fr });
            var m = ctx.matrix(fx, FY, RR, CC, { cell: CELL, gap: GAP, cmap: 'heat', values: function () { return '#060a12'; }, parent: S.fr });
            S.acells.push(m);
            S.flab.push(ctx.text(fx + FW / 2, FY + FH + 24, 't = ' + TLAB[k], { size: 12.5, font: 'mono', color: 'text', anchor: 'middle', parent: S.fr }));
            (function (kk) {
              for (var r = 0; r < RR; r++) for (var c = 0; c < CC; c++) {
                (function (rr, cc) {
                  var cell = m.cells[rr][cc];
                  if (cls(kk, rr, cc) === 'fox') { cell.setAttribute('stroke', ctx.C.orange); cell.setAttribute('stroke-width', 1.6); }
                  cell.style.cursor = 'pointer';
                  cell.addEventListener('click', function () { if (!S.live) return; S.q = { k: kk, r: rr, c: cc }; attnUpdate(ctx, S); });
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
          /* bottom explanation, one line per idea */
          S.b3 = ctx.group({ parent: g });
          var bl = [
            ctx.text(FX0, 648, 'Attention(Q, K, V) = softmax(QKᵀ / √dₕ) · V', { size: 18, font: 'mono', color: 'white', parent: S.b3 }),
            ctx.text(FX0, 684, 'Q, K, V ∈ ℝ^(n × dₕ),  n = 75,600,  dₕ = 128,  40 heads × 40 layers', { size: 13.5, font: 'mono', color: 'text', parent: S.b3 }),
            ctx.text(FX0, 714, 'one hop links the fox at t = 0 … 20 although its (h, w) changes every frame: motion = a diagonal path in spacetime', { size: 13.5, font: 'mono', color: 'amber', parent: S.b3 }),
            ctx.text(FX0, 744, 'scores per head per layer: n² ≈ 5.7 × 10⁹ — never materialised: FlashAttention streams K/V tiles through SRAM', { size: 13.5, font: 'mono', color: 'dim', parent: S.b3 }),
            ctx.text(FX0, 774, 'QK-RMSNorm on q and k keeps logits bounded at n = 75,600 (Wan); heads specialise into local, tracking and global patterns', { size: 13.5, font: 'mono', color: 'dim', parent: S.b3 }),
            ctx.label(1340, 648, 'CLICK A TOKEN → MOVE THE QUERY', { color: 'cyan', size: 12, parent: S.b3 })
          ];
          hide([S.fr, S.qRing, S.rays, S.stripG, bl]);

          /* beat 0: five latent frames, dark, fox outlined */
          return Promise.all([ctx.reveal(S.fr, { from: 'up' }), ctx.reveal([bl[0], bl[1]], { from: 'up', delay: 400, stagger: 150 })]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the query and its softmax row light up from the query outward */
            var fills = S.fills.slice();
            var dist = [];
            var q = S.q;
            for (var k2 = 0; k2 < K; k2++) for (var r2 = 0; r2 < RR; r2++) for (var c2 = 0; c2 < CC; c2++) dist.push(Math.hypot(r2 - q.r, c2 - q.c, (k2 - q.k) * 3));
            var dmax = Math.max.apply(null, dist);
            return Promise.all([ctx.reveal(S.qRing, { dur: 300 }), ctx.reveal(S.stripG, { from: 'up', delay: 200 })]).then(function () {
              return ctx.pulse(S.qRing, { color: 'white', times: 2, dur: 600 });
            }).then(function () {
              return ctx.tween(2200, function (t) {
                var R = t * (dmax + 0.5), idx = 0;
                for (var kk = 0; kk < K; kk++) for (var rr = 0; rr < RR; rr++) for (var cc = 0; cc < CC; cc++) {
                  var f = dist[idx] <= R ? fills[idx] : '#060a12';
                  S.acells[kk].cells[rr][cc].setAttribute('fill', f);
                  S.strip[idx].setAttribute('fill', f);
                  idx++;
                }
              }, 'linear');
            }).then(function () {
              S.live = true; S.showMass = true;
              attnUpdate(ctx, S);
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: arrows to the fox in every other frame */
            S.rays.setAttribute('opacity', 1);
            return Promise.all([ctx.reveal(S.rayEls, { from: 'draw', dur: 700, stagger: 120 }), ctx.reveal(bl[2], { from: 'up', delay: 500 })]).then(function () {
              return ctx.pulse(S.qRing, { color: 'amber', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the n^2 bill */
            return Promise.all([ctx.reveal([bl[3], bl[4]], { from: 'up', stagger: 200 })]).then(function () {
              return ctx.pulse(bl[3], { color: 'amber', dur: 700 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: hand the query to the viewer */
            return ctx.reveal(bl[5], { from: 'left' }).then(function () {
              return Promise.all([ctx.pulse(S.acells[0], { color: 'cyan', dur: 700 }), ctx.pulse(S.acells[4], { color: 'cyan', dur: 700 })]);
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Factorized vs full',
        beats: [
          {
            say: 'Earlier video models could not afford that, so they factorized attention into two cheaper steps. First, each token attends only within its own frame.',
            card: { tag: 'HOW IT WORKS', title: 'Step one: spatial attention', body: 'Keys are limited to the 3,600 tokens of the query’s own frame. Every frame is understood in isolation.' },
            deep: '<p>Factorized (divided) space-time attention, as in TimeSformer, VDM, Make-A-Video, AnimateDiff and SVD, replaces one n×n attention with two block-diagonal ones. <b>Spatial</b> attention runs inside each frame: T′ independent problems of n<sub>s</sub> = 45·80 = 3,600 tokens.</p>' +
              '<div class="eq">spatial: 4·n·n<sub>s</sub>·d FLOPs per layer</div>' +
              '<p>These layers are usually initialised from an image model, a big reason the recipe was popular: the spatial weights already know what a fox looks like.</p>'
          },
          {
            say: 'Second, each token attends across time, but only at the same spatial position in the other frames. Look at what that sees: the place where the fox was, not where the fox is now.',
            card: { tag: 'PITFALL', title: 'Temporal attention misses motion', body: 'A fixed (h, w) column through time sees empty sky where the fox used to be. The moving fox is invisible to it.' },
            deep: '<p><b>Temporal</b> attention runs along the time axis at a fixed (h, w): n<sub>s</sub> independent sequences of T′ = 21 tokens.</p>' +
              '<div class="eq">temporal: 4·n·T′·d FLOPs per layer</div>' +
              '<p><b>What is lost:</b> the attention graph is no longer complete. Token (t, h, w) reaches (t′, h′, w′) only via (t, h′, w′) → (t′, h′, w′): two layers, and the intermediate token must already carry the right content. Large or fast motion, occlusion and identity preservation degrade; image-pretrained spatial layers plus bolted-on temporal layers also bias toward “moving stills”.</p>'
          },
          {
            say: 'The saving is large. Here the factorized pair is about twenty one times cheaper than full attention, because each token scores a few thousand keys instead of seventy five thousand.',
            card: { tag: 'NUMBERS', title: 'What factorizing buys', stat: { v: '20.9×', u: 'cheaper', l: 'attention FLOPs per layer at n = 75,600: 117 TFLOP full vs 5.6 TFLOP spatial + temporal' }, more: '<p>With k keys per query the cost is 4·n·k·d. Full: k = 75,600 gives 117 TFLOP. Spatial: k = 3,600 gives 5.57 TFLOP. Temporal: k = 21 gives 0.033 TFLOP. So 117 / 5.6 ≈ 20.9×.</p>' },
            deep: '<div class="eq">full: 4·n²·d &nbsp;&nbsp; vs &nbsp;&nbsp; spatial + temporal: 4·n·(n<sub>s</sub> + T′)·d</div>' +
              '<p>With n<sub>s</sub> = 3,600 tokens per frame and T′ = 21, the ratio n/(n<sub>s</sub>+T′) = 75,600/3,621 ≈ <b>20.9×</b> fewer attention FLOPs (117 → 5.6 TFLOP per layer at d = 5120). The temporal part is almost free (0.03 TFLOP); the spatial part carries the cost.</p>' +
              '<p class="muted">Counting: 4·n·k·d for k keys per query, i.e. 2 FLOPs per multiply-add for QKᵀ and again for AV.</p>'
          },
          {
            say: 'But motion must now be relayed through two hops and many layers, which hurts large movements and identity. That is why today\'s leading open models, Wan, HunyuanVideo and CogVideoX, all use full three dimensional attention.',
            card: { tag: 'STATE OF THE ART', title: 'Full 3D attention won', body: 'CogVideoX ablated it directly and found full attention better. Wan, HunyuanVideo and Mochi followed. The escape from n² is sparsity, not factorization.' },
            deep: '<p>CogVideoX explicitly ablated this and reported that 3D full attention beats separated spatial/temporal attention; HunyuanVideo, Wan, Mochi and Sora-class systems all use full attention. Factorized designs persist mainly in models initialised from image networks (AnimateDiff, SVD).</p>' +
              '<p>The escape from the O(n²) bill is therefore not factorization but <i>learned-structure-aware sparsity</i> (step 8) plus sequence parallelism across GPUs.</p>'
          },
          {
            say: 'Now try it yourself. Switch between the three modes and click tokens to move the query, and watch which keys each mode can reach.',
            card: { tag: 'TRY IT', title: 'Switch modes, move the query', body: 'FULL, SPATIAL and TEMPORAL change which keys the query may reach. Click any token to move it and compare the heatmaps.' },
            deep: '<p>Things to check: in FULL mode the strip carries weight in every frame; in SPATIAL mode only the query’s own frame carries weight (3,600 of 75,600 keys); in TEMPORAL mode only one token per frame does (21 keys), and for a fox query these are the wrong tokens once the fox has moved.</p>' +
              '<p>Put the query on the ice: temporal attention works well there, because the background is static. That is why factorized models look fine on nearly static scenes and fail on fast motion.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, g = S.cur;
          road(ctx, S, 3);
          ctx.fadeOut(S.b3, 400, true);
          S.t3.textContent = 'FACTORIZED vs FULL · which keys can the query reach?';
          S.q = { k: 2, r: 2, c: 4 };
          S.mode = 'full';
          S.capT = ctx.text(FX0, 620, '', { size: 13, font: 'mono', color: 'white', parent: g });
          S.chG = ctx.group({ parent: g });
          S.modeChips = [];
          [['full', 'FULL 3D', 1270], ['spatial', 'SPATIAL', 1380], ['temporal', 'TEMPORAL', 1490]].forEach(function (m) {
            var ch = chip(ctx, S.chG, m[2], 660, 100, m[1], function () { S.mode = m[0]; attnUpdate(ctx, S); });
            ch.mode = m[0];
            S.modeChips.push(ch);
          });
          /* cost bars */
          S.costG = ctx.group({ parent: g });
          ctx.text(FX0, 660, 'COST PER LAYER  (720p shot, n = 75,600, d = 5120)', { size: 15, font: 'display', weight: 700, color: 'white', parent: S.costG });
          var rows = [['full 3D   4·n²·d', 117.05, '117 TFLOP', 'lime'], ['spatial   4·n·nₛ·d', 5.57, '5.6 TFLOP', 'cyan'], ['temporal  4·n·T·d', 0.033, '0.03 TFLOP', 'violet']];
          S.cbars = [];
          rows.forEach(function (rw, i) {
            var y = 702 + i * 36;
            ctx.text(FX0, y, rw[0], { size: 13, font: 'code', pre: true, color: rw[3], parent: S.costG });
            ctx.rect(420, y - 11, 800, 22, { rx: 4, fill: 'rgba(255,255,255,0.03)', parent: S.costG });
            var w = Math.max(3, rw[1] / 117.05 * 800);
            var b = ctx.rect(420, y - 11, w, 22, { rx: 4, fill: ctx.alpha(rw[3], 0.55), stroke: rw[3], sw: 1, parent: S.costG });
            b.setAttribute('data-w', w);
            b.setAttribute('width', 0);
            S.cbars.push(b);
            ctx.text(420 + w + 10, y, rw[2], { size: 12.5, font: 'mono', color: rw[3], parent: S.costG });
          });
          ctx.text(FX0, 824, 'factorized total ≈ 5.6 TFLOP → 20.9× cheaper, but a moving object needs ≥ 2 hops (space, then time)', { size: 13, font: 'mono', color: 'text', parent: S.costG });
          S.noteG = ctx.group({ parent: g });
          ctx.text(FX0, 850, 'factorized: TimeSformer, VDM, Make-A-Video, AnimateDiff, SVD  ·  full 3D: CogVideoX, HunyuanVideo, Wan 2.x, Mochi 1, Sora-class', { size: 12, font: 'mono', color: 'dim', parent: S.noteG });
          /* warning marker at the fox's true position in the last frame */
          S.warn = ctx.group({ parent: g });
          var fp = cellXY(4, 4, 7);
          ctx.circle(fp.x - 14, fp.y - 4, 40, { stroke: 'red', sw: 2, dash: '4 3', parent: S.warn });
          ctx.label(FX0 + 4 * FSTEP + FW / 2, FY - 22, 'fox moved here: temporal attn at fixed (h, w) misses it', { color: 'red', size: 10.5, parent: S.warn });
          hide([S.capT, S.chG, S.costG, S.noteG]);
          attnUpdate(ctx, S);

          /* beat 0: spatial attention only */
          S.mode = 'spatial'; attnUpdate(ctx, S);
          return Promise.all([ctx.reveal(S.capT, { dur: 300 }), ctx.reveal(S.chG, { from: 'left' })]).then(function () {
            return ctx.pulse(S.acells[2], { color: 'cyan', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: temporal attention only: it looks where the fox was */
            S.mode = 'temporal'; attnUpdate(ctx, S);
            return ctx.pulse(S.warn, { color: 'red', times: 2, dur: 700 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the cost comparison */
            return Promise.all([ctx.reveal(S.costG, { from: 'up', dur: 400 })].concat(S.cbars.map(function (b, i) {
              return ctx.animate(b, { width: [0, parseFloat(b.getAttribute('data-w'))] }, 800, 'out', 300 + i * 250);
            })));
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: full attention is back, and it is what leading models use */
            S.mode = 'full'; attnUpdate(ctx, S);
            return Promise.all([ctx.reveal(S.noteG, { from: 'up' }), ctx.pulse(S.modeChips[0].g, { color: 'lime', dur: 700 })]);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the viewer's turn */
            return S.modeChips.reduce(function (p, c) { return p.then(function () { return ctx.pulse(c.g, { color: 'lime', dur: 450 }); }); }, Promise.resolve());
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: '3D RoPE',
        beats: [
          {
            say: 'How does a token know where it is? Not by adding a position vector, but by rotating its queries and keys. Three dimensional rotary embedding splits each head\'s one hundred twenty eight dimensions into three bands, for time, height and width.',
            card: { tag: 'KEY IDEA', title: 'Position by rotation', body: 'No position vector is added. Queries and keys are rotated instead, band by band: time, height, width.' },
            deep: '<p>Split the head dimension into axis bands d<sub>head</sub> = d<sub>T</sub> + d<sub>H</sub> + d<sub>W</sub>. Each band holds d<sub>a</sub>/2 two-dimensional pairs. For Wan 2.x: 128 = 44 + 42 + 42, i.e. 22 + 21 + 21 pairs; for HunyuanVideo 128 = 16 + 56 + 56.</p>' +
              '<div class="eq">q̃ = (R<sub>t</sub>(t) ⊕ R<sub>h</sub>(h) ⊕ R<sub>w</sub>(w)) q</div>' +
              '<p>An absolute table is added once at the input and must be learned per length and resolution; a rotation is applied to q and k in <i>every</i> layer and needs no table. This extends RoFormer’s 1-D rotation to three axes; FLUX applies the same idea in 2-D.</p>'
          },
          {
            say: 'Each pair of dimensions is a little clock hand. It rotates by an angle proportional to the token\'s coordinate along its axis, and every pair ticks at its own frequency, from fast to slow.',
            card: { tag: 'HOW IT WORKS', title: 'Clock hands at many speeds', body: 'Each 2-D pair turns by position times its own frequency. Fast pairs resolve neighbours; slow pairs stay unambiguous across the whole clip.' },
            deep: '<p>Within band a ∈ {T, H, W}, pair i rotates by angle p<sub>a</sub>·ω<sub>a,i</sub>:</p>' +
              '<div class="eq">ω<sub>a,i</sub> = θ<sup>−2i/d<sub>a</sub></sup>&nbsp; (Wan θ = 10⁴, HunyuanVideo θ = 256)</div>' +
              '<p>Pair 0 has ω = 1 (a full turn per 2π ≈ 6.3 positions); the last pair is nearly frozen. Fast pairs resolve small offsets, slow pairs stay unambiguous over the whole clip. Implementation: a complex multiply of (q<sub>2i</sub> + j·q<sub>2i+1</sub>) by e<sup>j·p·ω</sup>, fused into the attention prologue. In the animation the token wanders through (t, h, w) and every hand turns at its own rate.</p>' +
              '<details><summary>Go deeper</summary><pre>def rope_3d(q, t, h, w):        # q: [n, H, 128]\n    q_t, q_h, q_w = q.split([44, 42, 42], -1)\n    rot = lambda x, p, f: cplx_mul(x, exp(1j * p[:, None] * f))\n    return cat([rot(q_t, t, f_t), rot(q_h, h, f_h), rot(q_w, w, f_w)], -1)</pre></details>'
          },
          {
            say: 'When a query meets a key, the rotations cancel into a function of only their relative offset in time, height and width. There is no position table and no fixed maximum length.',
            card: { tag: 'WHY IT MATTERS', title: 'Relative by construction', body: 'The score depends only on the offset (Δt, Δh, Δw). No table to learn, so any clip length has a meaning.' },
            deep: '<div class="eq">⟨R(p)q, R(p′)k⟩ = ⟨q, R(p′−p)k⟩ = f(Δt, Δh, Δw)</div>' +
              '<p>Rotations are orthogonal, so norms are preserved, and R(p)ᵀR(p′) = R(p′−p): the score depends only on relative offsets. Attention is translation-equivariant in space <i>and</i> time, needs no learned table, and defines a position for any length. Text tokens are left unrotated (HunyuanVideo) or given id (0, 0, 0) (FLUX).</p>' +
              '<details><summary>Go deeper</summary><p>For one pair, with q and k as complex numbers: Re[(q·e<sup>jpω</sup>)* (k·e<sup>jp′ω</sup>)] = Re[q*k·e<sup>j(p′−p)ω</sup>]. The absolute angle cancels and only Δ·ω remains. Across a band the score is Σ<sub>i</sub> |q<sub>i</sub>||k<sub>i</sub>| cos(Δ·ω<sub>i</sub> + φ<sub>i</sub>).</p></details>'
          },
          {
            say: 'Averaging over the pairs gives a positional factor that falls as the offset grows, a soft locality prior. Wan gives forty four dimensions to time with a base of ten thousand, while HunyuanVideo gives only sixteen with a base of two hundred fifty six.',
            card: { tag: 'NUMBERS', title: 'How each model splits the head', stat: { v: '44 / 42 / 42', u: 'dims for t / h / w', l: 'Wan 2.x splits its 128-dim head this way; HunyuanVideo uses 16 / 56 / 56 with base 256' }, more: '<p>Wan’s slowest temporal pair has ω = 10⁴<sup>−42/44</sup> ≈ 1.5·10⁻⁴, a period of about 41,000 frames: effectively a constant. HunyuanVideo’s slowest has a period of about 800 frames. Both are far beyond any clip, so the slow pairs act as coarse absolute anchors while the fast pairs measure offsets.</p>' },
            deep: '<table><tr><th>Model</th><th>d<sub>head</sub></th><th>T / H / W dims</th><th>θ</th></tr>' +
              '<tr><td>Wan 2.1 / 2.2</td><td>128</td><td>44 / 42 / 42</td><td>10⁴</td></tr>' +
              '<tr><td>HunyuanVideo</td><td>128</td><td>16 / 56 / 56</td><td>256</td></tr></table>' +
              '<p>The plot shows mean<sub>i</sub> cos(Δ·ω<sub>i</sub>), the positional factor for q = k with equal energy per pair: it falls with |Δ|, a soft locality prior. HunyuanVideo spends few dimensions on time but uses a small base (θ = 256), so its 8 temporal frequencies still span periods from 6 to about 800 frames.</p>'
          },
          {
            say: 'Generate longer or larger than the model was trained on, and the angles leave the range it has seen. Fixes include base rescaling and position interpolation, and RIFLEx, which lowers one frequency so that long videos stop looping.',
            card: { tag: 'PITFALL', title: 'Longer than trained: loops or breaks', body: 'Angles beyond the training range are out of distribution. RIFLEx lowers one intrinsic frequency so extended clips stop repeating.' },
            deep: '<p><b>Extrapolation:</b> generating longer or larger than trained pushes angles into a range the model never saw, and quality collapses. Fixes borrowed from LLMs: NTK / YaRN-style base rescaling and position interpolation.</p>' +
              '<p>Video adds a second failure: <b>repetition</b>. <b>RIFLEx</b> identifies the “intrinsic” temporal frequency whose period matches the training length, and lowers it so that the clip does not loop. Spatial RoPE has the same issue at higher resolutions, which is why models are trained on several aspect ratios and sizes.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.ropeLoop) { S.ropeLoop.stop(); S.ropeLoop = null; }
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
          /* equations: A = the relative-position identity, B = the two configurations, C = extrapolation */
          function eqBlock(list) {
            var eg = ctx.group({ parent: g });
            list.forEach(function (e) { ctx.text(770, e[3], e[0], { size: e[1], font: 'mono', color: e[2], parent: eg }); });
            return eg;
          }
          S.eqA = eqBlock([
            ['q̃ = R(t, h, w)·q,   R = Rₜ(t) ⊕ Rₕ(h) ⊕ R_w(w)', 15.5, 'white', 572],
            ['Rₐ(p): a 2×2 rotation by p·ωᵢ on every pair of band a', 13, 'dim', 600],
            ['⟨R(p)q, R(p′)k⟩ = ⟨q, R(p′ − p)k⟩', 15.5, 'white', 642],
            ['⇒ the score depends only on (Δt, Δh, Δw): no table, any length', 13, 'lime', 670]
          ]);
          S.eqB = eqBlock([
            ['Wan 44/42/42, θ = 10⁴  ·  HunyuanVideo 16/56/56, θ = 256', 13, 'text', 712],
            ['text tokens: unrotated (HunyuanVideo) or id (0,0,0) (FLUX)', 12.5, 'amber', 836]
          ]);
          S.eqC = eqBlock([
            ['longer / larger than training → angles go out of distribution:', 13, 'dim', 752],
            ['NTK / YaRN base scaling, position interpolation, RIFLEx', 13, 'dim', 774],
            ['(lower the intrinsic frequency so long videos stop looping)', 13, 'dim', 796]
          ]);

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
          hide([S.pairG, S.phG, S.posG, S.plotG, S.eqA, S.eqB, S.eqC]);

          /* beat 0: the head is split into three bands */
          return ctx.reveal(S.pairG, { from: 'down' }).then(function () {
            return ctx.pulse(S.pairG, { color: 'lime', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: every pair is a clock hand turning at its own rate */
            S.ropeLoop = ctx.loop(function (t) { setPhasors(t); });
            return ctx.reveal([S.phG, S.posG], { from: 'up', stagger: 200 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: rotations cancel to a relative offset */
            return ctx.reveal(S.eqA, { from: 'left' }).then(function () {
              return ctx.pulse(S.eqA, { color: 'lime', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: positional decay and the two model configurations */
            return Promise.all([
              ctx.reveal(S.plotG, { from: 'up' }),
              ctx.reveal(S.ropeCurves, { from: 'draw', delay: 300, dur: 1200, stagger: 300 }),
              ctx.reveal(S.eqB, { from: 'left', delay: 600 })
            ]);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: extrapolation beyond the trained range */
            return ctx.reveal(S.eqC, { from: 'left' }).then(function () {
              return ctx.pulse(S.eqC, { color: 'amber', dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'adaLN-Zero',
        beats: [
          {
            say: 'The network must behave differently at high noise and at low noise, so the noise level has to reach every block. The timestep is embedded with sinusoids of many frequencies and passed through a small MLP.',
            card: { tag: 'KEY IDEA', title: 'The noise level steers every block', body: 'The scalar σ is embedded with sinusoids, then a small MLP turns it into one conditioning vector c of width 5120.' },
            deep: '<p>adaLN-Zero (Peebles &amp; Xie) regresses per-channel modulation from a conditioning vector built from the noise level:</p>' +
              '<div class="eq">c = MLP(emb(σ)),&nbsp;&nbsp; emb(σ) = [cos(1000σ·f<sub>k</sub>), sin(1000σ·f<sub>k</sub>)]<sub>k=1…128</sub> ∈ ℝ<sup>256</sup></div>' +
              '<p>The sinusoidal features give the MLP a multi-scale view of one scalar; without them a network struggles to react to small changes in σ. In Wan the time MLP (Linear · SiLU · Linear) is shared by all 40 blocks and outputs c ∈ ℝ<sup>5120</sup>. SD3, FLUX and HunyuanVideo additionally add pooled CLIP text to c.</p>'
          },
          {
            say: 'A modulation head turns that vector into six numbers per channel for each block: a shift, a scale and a gate for the attention branch, and the same three for the feed forward branch.',
            card: { tag: 'NUMBERS', title: 'Six vectors per block', stat: { v: '6 × 5120', u: 'per block', l: 'shift, scale and gate for attention and again for the feed-forward branch, broadcast over all 75,600 tokens' } },
            deep: '<div class="eq">[β₁, γ₁, α₁, β₂, γ₂, α₂] = W<sub>mod</sub>·SiLU(c) + B<sub>l</sub> &nbsp;∈ ℝ<sup>6×d</sup></div>' +
              '<p>Each block has two residual branches, self-attention and FFN. Each gets a <b>shift β</b> and a <b>scale γ</b> applied to its LayerNorm output, plus a <b>gate α</b> applied before the residual add. In Wan an unmodulated cross-attention branch sits between them. The vectors are per sample and broadcast over all n tokens, so the same instruction reaches every patch.</p>'
          },
          {
            say: 'Shift and scale modulate the normalized activations channel by channel. Watch one channel on the right: as the noise level sweeps from one toward zero, the same weights reshape its distribution.',
            card: { tag: 'HOW IT WORKS', title: 'One block, many behaviours', body: 'Shift and scale re-centre and stretch every channel as a function of σ, so identical weights act differently at high and low noise.' },
            deep: '<p>LayerNorm without learned affine parameters yields roughly zero-mean, unit-variance channels (dashed curve). Shift and scale then move and stretch that distribution as a function of σ:</p>' +
              '<div class="eq">x̂ ⊙ (1 + γ(σ)) + β(σ)</div>' +
              '<p>At high noise the block sees mostly noise and must attend to coarse layout; at low noise it refines texture. The same weights can realise both because γ and β retune every channel. In the DiT paper this modulation beat cross-attention and in-context conditioning of the timestep by a wide FID margin.</p>'
          },
          {
            say: 'The gates scale each branch before it joins the residual stream. In adaLN Zero they start at zero, so every block begins as an identity map, which lets very deep diffusion transformers train stably.',
            card: { tag: 'KEY IDEA', title: 'Gates start closed', body: 'In adaLN-Zero each gate α starts at 0: every block is the identity at initialisation, so a 40-block stack trains stably.', more: '<p>With α = 0 the residual branch contributes nothing, so gradients reach the first layer through the identity path undiminished. The gates then open only as far as the loss rewards it, which is why very deep DiTs train without warm-up tricks.</p>' },
            deep: '<div class="eq">h = x + α₁ ⊙ SelfAttn(LN(x) ⊙ (1+γ₁) + β₁)<br>h′ = h + CrossAttn(LN(h), c<sub>text</sub>)<br>y = h′ + α₂ ⊙ FFN(LN(h′) ⊙ (1+γ₂) + β₂)</div>' +
              '<p><b>Zero:</b> in the DiT recipe W<sub>mod</sub> is initialised to 0, so α = 0 and every residual branch is switched off: the 40-block stack starts as the identity and gradients flow cleanly to the earliest layers. Training gradually opens the gates. Note that in Wan the cross-attention branch is <i>not</i> modulated.</p>'
          },
          {
            say: 'Per block, that head is a linear map from the model width to six times the width. Wan shares one modulation projection across all forty blocks and learns only a bias per block, saving billions of parameters.',
            card: { tag: 'NUMBERS', title: 'Share one modulation head', stat: { v: '6.3 B', u: 'parameters saved', l: 'one shared projection instead of a 6d² linear in each of 40 blocks (d = 5120)' } },
            deep: '<p><b>Parameter cost:</b> a per-block d → 6d linear is 6d² parameters. For DiT-XL/2 (d = 1152, 28 blocks) that is ≈ 223 M of 675 M parameters. At Wan’s d = 5120 the same design would cost 6d² = 157 M per block, 6.3 B over 40 blocks.</p>' +
              '<p>Wan shares <i>one</i> modulation projection across all blocks and lets each block learn only a bias B<sub>l</sub> ∈ ℝ<sup>6×d</sup> (the “adaLN-single” design introduced by PixArt-α). Compute is negligible either way: O(d) per block for the modulation, versus O(n·d²) for the layers it steers.</p>'
          }
        ],
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
          ctx.line(250, 226, 250, 246, { color: 'cyan', arrow: true, parent: S.lg });
          ctx.line(250, 296, 250, 316, { color: 'cyan', arrow: true, parent: S.lg });
          S.lgHead = ctx.group({ parent: g });
          ctx.node({ x: 250, y: 412, w: 280, h: 48, title: 'Modulation head', sub: 'W·SiLU(c) + Bₗ → 6 × 5120', color: 'cyan', titleSize: 13.5, subSize: 11, glow: false, parent: S.lgHead });
          ctx.line(250, 366, 250, 386, { color: 'cyan', arrow: true, parent: S.lgHead });
          /* left notes, revealed in the beats that own them */
          function noteBlock(lines) {
            var ng = ctx.group({ parent: g });
            lines.forEach(function (l) { ctx.text(110, 488 + l[2] * 22, l[0], { size: 12.5, font: 'mono', color: l[1], parent: ng }); });
            return ng;
          }
          S.lgP = noteBlock([['Wan: one MLP shared by all 40 blocks;', 'text', 0], ['each block adds only a learned bias Bₗ', 'text', 1], ['DiT-XL/2: a d → 6d Linear per block', 'dim', 3], ['= 6d² × 28 ≈ 223M of 675M params', 'dim', 4]]);
          S.lgZ = noteBlock([['init W_mod = 0  ⇒  α = γ = β = 0', 'magenta', 6], ['⇒  every block = identity at step 0', 'magenta', 7]]);
          /* mini comparison of modulation parameters */
          S.lgB = ctx.group({ parent: g });
          [['per-block heads: 40 × 6d²', 692, 240, '6.29 B', 'red'], ['shared head + biases (Wan)', 738, 240 * 0.157 / 6.29, '0.16 B', 'lime']].forEach(function (b) {
            ctx.text(110, b[1] - 16, b[0], { size: 12, font: 'mono', color: 'text', parent: S.lgB });
            ctx.rect(110, b[1] - 4, 240, 14, { rx: 4, fill: 'rgba(255,255,255,0.03)', parent: S.lgB });
            ctx.rect(110, b[1] - 4, Math.max(4, b[2]), 14, { rx: 4, fill: ctx.alpha(b[4], 0.55), stroke: b[4], sw: 1, parent: S.lgB });
            ctx.text(360, b[1] + 3, b[3], { size: 12.5, font: 'mono', color: b[4], weight: 700, parent: S.lgB });
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
          for (var i = 0; i < chain.length - 1; i++) {
            ctx.line(800, chain[i][2] + 19, 800, chain[i + 1][2] - 19, { color: ctx.alpha('white', 0.4), sw: 1.4, arrow: true, parent: S.cg });
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
          /* right: distribution of one channel */
          S.rgD = ctx.group({ parent: g });
          ctx.text(1010, 196, 'one channel’s activations across tokens', { size: 12.5, font: 'mono', color: 'text', parent: S.rgD });
          var dp = ctx.plot(1030, 220, 500, 190, gauss(0, 1), { xDomain: [-4, 4], yDomain: [0, 0.85], color: ctx.alpha('white', 0.45), axes: true, samples: 80, parent: S.rgD });
          dp.curve.setAttribute('stroke-dasharray', '5 5');
          S.dp = dp;
          S.modCurve = ctx.path('M0,0', { stroke: 'cyan', sw: 2.4, fill: ctx.alpha('cyan', 0.08), parent: S.rgD, glow: true });
          ctx.text(1040, 432, '- - LN(x): zero mean, unit var', { size: 12, font: 'mono', color: 'dim', parent: S.rgD });
          ctx.text(1300, 432, '— x̂·(1+γ) + β', { size: 12, font: 'mono', color: 'cyan', parent: S.rgD });
          /* right: gates and the residual equations */
          S.rgG = ctx.group({ parent: g });
          ctx.text(1010, 480, 'gates α (scale each branch before the residual add)', { size: 12.5, font: 'mono', color: 'text', parent: S.rgG });
          S.gates = [0, 1].map(function (i) {
            var y = 514 + i * 36;
            ctx.text(1010, y, 'α' + (i ? '₂' : '₁'), { size: 14, font: 'mono', color: 'magenta', weight: 700, parent: S.rgG });
            ctx.rect(1050, y - 10, 440, 20, { rx: 4, fill: 'rgba(255,255,255,0.03)', parent: S.rgG });
            ctx.line(1270, y - 14, 1270, y + 14, { color: ctx.alpha('white', 0.4), sw: 1, parent: S.rgG });
            var b = ctx.rect(1270, y - 8, 0, 16, { rx: 3, fill: ctx.alpha('magenta', 0.6), stroke: 'magenta', sw: 1, parent: S.rgG });
            var v = ctx.text(1500, y, '0.00', { size: 12, font: 'mono', color: 'magenta', parent: S.rgG });
            return { b: b, v: v };
          });
          S.gateNote = ctx.text(1010, 598, 'step 0: gates closed ⇒ identity', { size: 12.5, font: 'mono', color: 'lime', weight: 600, parent: S.rgG });
          [['h  = x + α₁ ⊙ SelfAttn(LN(x) ⊙ (1+γ₁) + β₁)', 'white'], ['h′ = h + CrossAttn(LN(h), c_text)', 'amber'], ['y  = h′ + α₂ ⊙ FFN(LN(h′) ⊙ (1+γ₂) + β₂)', 'white']].forEach(function (e, i) {
            ctx.text(1010, 640 + i * 30, e[0], { size: 13.5, font: 'code', pre: true, color: e[1], parent: S.rgG });
          });
          S.rgC = ctx.group({ parent: g });
          ctx.text(1010, 760, 'modulation is per sample, broadcast over all n tokens:', { size: 12, font: 'mono', color: 'dim', parent: S.rgC });
          ctx.text(1010, 780, 'O(d) per block vs O(n·d²) for the layers it steers', { size: 12, font: 'mono', color: 'dim', parent: S.rgC });

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
            for (var i = 0; i < 81; i++) {
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
          S.sig = 1;
          setSigma(1, 1);
          hide([S.lg, S.lgHead, S.lgP, S.lgZ, S.lgB, S.cg, S.bus, S.rgD, S.rgG, S.rgC]);
          /* the σ pill and the first two nodes belong to beat 0; only the head + notes wait */
          S.lg.setAttribute('opacity', 0);

          /* beat 0: sigma, sinusoidal embedding, time MLP */
          return ctx.reveal(S.lg, { from: 'left' }).then(function () {
            return ctx.tween(1500, function (t) { setSigma(1 - 0.6 * Math.sin(t * Math.PI), 1); }, 'inOut');
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the modulation head and where its six vectors enter the block */
            return Promise.all([ctx.reveal(S.lgHead, { from: 'up' }), ctx.reveal(S.cg, { from: 'up', delay: 250 }), ctx.reveal(S.bus, { from: 'fade', delay: 600 })]).then(function () {
              return ctx.pulse(S.bus, { color: 'cyan', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: shift and scale reshape the activations while sigma sweeps down */
            return ctx.reveal(S.rgD, { from: 'right' }).then(function () {
              return ctx.tween(3000, function (t) { S.sig = 1 - 0.9 * t; setSigma(S.sig, 1); }, 'inOut');
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: replay the start of training: gates closed, then opening */
            setSigma(S.sig, 0);
            return Promise.all([ctx.reveal(S.rgG, { from: 'right' }), ctx.reveal(S.lgZ, { from: 'left', delay: 200 })]).then(function () {
              return ctx.tween(1600, function (t) { setSigma(S.sig, t); if (t > 0.05) S.gateNote.textContent = t < 1 ? 'training opens the gates …' : 'trained: each branch is scaled by its gate'; }, 'out', 500);
            }).then(function () {
              return Promise.all([ctx.pulse(S.chain[4], { color: 'magenta', dur: 600 }), ctx.pulse(S.chain[8], { color: 'magenta', dur: 600 })]);
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: parameter cost of the modulation heads */
            return Promise.all([ctx.reveal(S.lgP, { from: 'left' }), ctx.reveal(S.lgB, { from: 'up', delay: 300 }), ctx.reveal(S.rgC, { from: 'up', delay: 300 })]).then(function () {
              return ctx.pulse(S.lgHead, { color: 'cyan', dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Text conditioning',
        beats: [
          {
            say: 'The prompt has to get into the network too, and there are two designs. Wan keeps the video stream separate and adds a cross attention layer, where video tokens query the text encoder\'s outputs.',
            card: { tag: 'HOW IT WORKS', title: 'Cross-attention: video asks, text answers', body: 'Queries come from the 75,600 video tokens; keys and values from the 512 frozen text tokens. Wan uses this in all 40 blocks.', more: '<p>Cost per layer: 4·n·m·d = 4 × 75,600 × 512 × 5120 ≈ 0.8 TFLOP for the scores and weighted sum, about 0.5% of the 163 TFLOP block. Cross-attention is cheap because m = 512 is tiny compared with n.</p>' },
            deep: '<p><b>Cross-attention</b> (Wan, PixArt, original Stable Diffusion): Q from the video stream, K and V from the frozen text-encoder output (umT5, 512 tokens):</p>' +
              '<div class="eq">h ← h + softmax(Q<sub>v</sub>K<sub>c</sub>ᵀ/√d<sub>h</sub>) V<sub>c</sub>,&nbsp; cost 4·n·m·d + 4·n·d² (m = 512)</div>' +
              '<p>The text representation is fixed across all 40 layers; only the video reads it. The score matrix is n × m per head, tiny next to n × n.</p>'
          },
          {
            say: 'Each video token asks which words matter to it. Fox tokens attend to the words fox and astronaut, ice tokens to ice and moon, and the text itself never changes: it is read only.',
            card: { tag: 'KEY IDEA', title: 'Words steer the regions they name', body: 'Each video token spreads its attention over the prompt words. The text is read-only: the same c feeds all 40 blocks.' },
            deep: '<p>The fill pattern is a hand-built illustration: <i>fox</i> rows put their weight on fox and astronaut, <i>ice</i> rows on ice and moon, sky rows on moon and glow. Real maps are blurrier but show the same grounding, which is what lets a prompt word steer the region it names.</p>' +
              '<p>Wan 2.1 I2V adds a second, decoupled cross-attention over CLIP image tokens (ViT-H/14, 257 tokens) of the first frame, with its own K/V projections. Because the text is never updated, the model cannot re-read the prompt in light of the video; that limitation motivates MM-DiT.</p>'
          },
          {
            say: 'Stable Diffusion three, FLUX and HunyuanVideo take another route, called MM-DiT. Text and video tokens are concatenated into one sequence. Each modality keeps its own projection and feed forward weights, but they share a single joint attention.',
            card: { tag: 'STATE OF THE ART', title: 'MM-DiT: one sequence, two weight sets', body: 'SD3, FLUX and HunyuanVideo concatenate text and video, keep separate projections and FFNs, and share one softmax.' },
            deep: '<p><b>MM-DiT</b> (SD3, FLUX, HunyuanVideo): concatenate text and video tokens [c; x], project each with <i>its own</i> W<sub>qkv</sub>, run one attention over n + m tokens, then apply separate FFNs and separate adaLN modulation to the two streams:</p>' +
              '<div class="eq">[Q;K;V] = [c W<sup>txt</sup><sub>qkv</sub> ; x W<sup>vid</sup><sub>qkv</sub>],&nbsp; A = softmax(QKᵀ/√d<sub>h</sub>)</div>' +
              '<p>The two modalities have very different statistics, so separate weights are affordable and important; only the softmax is shared.</p>'
          },
          {
            say: 'Because attention is joint, the matrix has four quadrants. Text reads text, video reads video, and, unlike cross attention, text can also read the video, so the prompt representation adapts as the video takes shape.',
            card: { tag: 'KEY IDEA', title: 'Text can read the video too', body: 'A joint matrix has four quadrants. The text-reads-video quadrant lets the prompt representation adapt to what has been generated so far.' },
            deep: '<p>The joint matrix has four quadrants: T·T, V·V and the two cross terms. In cross-attention only V·T exists; here the text stream is <i>updated</i> by the video (the T·V quadrant), so the prompt representation adapts layer by layer as the video forms.</p>' +
              '<p>In SD3’s architecture comparison MM-DiT beat cross-attention DiT, UViT and plain in-context DiT on validation loss, CLIP score and FID. Text also gets its own adaLN modulation, so the two streams are normalised and gated independently.</p>'
          },
          {
            say: 'HunyuanVideo runs twenty such dual stream blocks, then forty single stream blocks with fully shared weights. The joint attention costs almost nothing extra, under one percent, because the text is tiny next to the video.',
            card: { tag: 'NUMBERS', title: 'Joint attention is nearly free', stat: { v: '0.7%', u: 'extra attention', l: '(n + m)² / n² − 1 for m = 256 text tokens beside n = 75,600 video tokens' } },
            deep: '<p><b>Dual → single stream:</b> HunyuanVideo (d = 3072, 24 heads) uses 20 dual-stream blocks, then 40 single-stream blocks that share one weight set on the concatenated sequence (parallel attention + MLP, FLUX-style; FLUX.1 uses 19 + 38 blocks). Its text encoder is a decoder-only MLLM with a bidirectional token refiner, plus CLIP-L pooled text in the modulation.</p>' +
              '<p>The joint attention adds (n+m)²/n² − 1 ≈ 0.7% for m = 256 text tokens against n = 75,600 video tokens: text is nearly free in FLOPs, but the text stream still needs its own weights, which adds parameters.</p>'
          }
        ],
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
          ctx.text(82, 588, 'h ← h + softmax(Q_v K_cᵀ / √dₕ) V_c', { size: 13.5, font: 'mono', color: 'white', parent: S.L });
          S.Ln = ctx.group({ parent: g });
          var tx = 548;
          [['Q ← video (n = 75,600)', 'lime'], ['K, V ← umT5 text (m ≤ 512)', 'amber'], ['scores: n × m per head', 'text'], ['text is read-only: the same', 'dim'], ['c feeds all 40 blocks', 'dim'], ['I2V: + 2nd cross-attn on', 'dim'], ['CLIP image tokens', 'dim']].forEach(function (l, i) {
            ctx.text(tx, 290 + i * 26, l[0], { size: 11.5, font: 'mono', color: l[1], parent: S.Ln });
          });

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
          S.wG = ctx.group({ parent: g });
          S.wT = ctx.node({ x: 945, y: 300, w: 150, h: 40, title: 'Wᵗˣᵗ qkv · FFN', color: 'amber', titleSize: 12.5, glow: false, parent: S.wG });
          S.wV = ctx.node({ x: 945, y: 440, w: 150, h: 40, title: 'Wᵛⁱᵈ qkv · FFN', color: 'lime', titleSize: 12.5, glow: false, parent: S.wG });
          ctx.link(S.wT, { x: JX - 32, y: JY + 2 * qs }, { color: 'amber', from: 'r', parent: S.wG });
          ctx.link(S.wV, { x: JX - 32, y: JY + 8 * qs }, { color: 'lime', from: 'r', parent: S.wG });
          ctx.text(945, 516, 'separate weights,', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.wG });
          ctx.text(945, 536, 'one shared softmax', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.wG });
          S.qG = ctx.group({ parent: g });
          S.quads = [
            ctx.rect(JX - 2, JY - 2, 4 * qs, 4 * qs, { rx: 3, stroke: 'amber', sw: 1.6, dash: '4 3', parent: S.qG }),
            ctx.rect(JX + 4 * qs - 1, JY - 2, 8 * qs, 4 * qs, { rx: 3, stroke: 'violet', sw: 1.6, dash: '4 3', parent: S.qG }),
            ctx.rect(JX - 2, JY + 4 * qs - 1, 4 * qs, 8 * qs, { rx: 3, stroke: 'violet', sw: 1.6, dash: '4 3', parent: S.qG }),
            ctx.rect(JX + 4 * qs - 1, JY + 4 * qs - 1, 8 * qs, 8 * qs, { rx: 3, stroke: 'lime', sw: 1.6, dash: '4 3', parent: S.qG })
          ];
          [['T·T  text ↔ text', 'amber'], ['T·V  text reads video', 'violet'], ['V·T  video reads text', 'violet'], ['V·V  3D spacetime', 'lime'], ['', 'dim'], ['then separate FFN', 'dim'], ['+ adaLN per modality', 'dim']].forEach(function (l, k) {
            if (l[0]) ctx.text(1384, 282 + k * 28, l[0], { size: 11.5, font: 'mono', color: l[1], parent: S.qG });
          });
          ctx.text(852, 588, 'A = softmax([Q_c; Q_v][K_c; K_v]ᵀ / √dₕ) over n + m tokens', { size: 13.5, font: 'mono', color: 'white', parent: S.qG });

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
          hide([S.L, S.Ln, S.R, S.wG, S.qG, S.B]);

          /* beat 0: the cross-attention design */
          return ctx.reveal(S.L, { from: 'left' }).then(function () {
            return ctx.pulse(S.xm, { color: 'amber', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: which words each video token reads */
            ctx.reveal(S.Ln, { from: 'left', delay: 300 });
            return ctx.tween(1400, function (t) {
              S.xm.set(function (r3, c3) { var k = Math.min(1, Math.max(0, t * 14 - r3)); return 0.03 + (S.xmTarget[r3][c3] - 0.03) * k; });
            }, 'linear');
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: MM-DiT, separate weights and a joint sequence */
            return Promise.all([ctx.reveal(S.R, { from: 'right' }), ctx.reveal(S.wG, { from: 'left', delay: 300 })]).then(function () {
              return Promise.all([ctx.pulse(S.wT, { color: 'amber', dur: 600 }), ctx.pulse(S.wV, { color: 'lime', dur: 600 })]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the four attention quadrants */
            ctx.reveal(S.qG, { dur: 500 });
            return ctx.tween(1400, function (t) {
              S.jm.set(function (r3, c3) { var k = Math.min(1, Math.max(0, t * 14 - r3)); return 0.03 + (S.jmTarget[r3][c3] - 0.03) * k; });
            }, 'linear').then(function () {
              return Promise.all(S.quads.map(function (q, k) { return ctx.pulse(q, { color: ['amber', 'violet', 'violet', 'lime'][k], dur: 600 }); }));
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the HunyuanVideo block schedule */
            return Promise.all([ctx.reveal(S.B, { from: 'up' }), ctx.reveal(S.slabs, { from: 'fade', delay: 300, stagger: 18, dur: 250 })]);
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'The n² wall',
        beats: [
          {
            say: 'Now the bill. Per layer, attention costs about four times n squared times d floating point operations, while all the linear layers together grow only linearly in n.',
            card: { tag: 'KEY IDEA', title: 'Quadratic beats linear', body: 'Double the token count: the linear layers cost twice as much, attention four times. Somewhere the curves must cross.' },
            deep: '<p>Forward FLOPs per block (multiply-add = 2 FLOPs), Wan 14B, d = 5120, d<sub>ff</sub> = 13,824. Self-attention scores and the weighted sum cost 4n²d; every linear layer (QKVO projections, FFN, cross-attention projections) is linear in n:</p>' +
              '<div class="eq">linear: (12d² + 4d·d<sub>ff</sub>)·n ≈ 0.6 GFLOP per token,&nbsp;&nbsp; attention: 4·n²·d</div>' +
              '<p>Doubling n doubles the linear cost and quadruples attention. The plot shows both per layer, in TFLOP, against the token count in thousands.</p>'
          },
          {
            say: 'At Wan\'s width the two curves cross at about twenty nine thousand tokens. At our seventy five thousand six hundred, attention costs one hundred seventeen teraflops per layer, against forty five for everything else.',
            card: { tag: 'NUMBERS', title: 'The crossover', stat: { v: '≈ 29 k', u: 'tokens', l: 'n* = 3d + d_ff: beyond this, attention costs more than all linear layers combined' }, more: '<p>Setting 4n²d = (12d² + 4d·d<sub>ff</sub>)·n and dividing by 4nd gives n = 3d + d<sub>ff</sub> = 15,360 + 13,824 = 29,184. Wider models cross later; longer sequences always cross eventually.</p>' },
            deep: '<div class="eq">4n²d = (12d² + 4d·d<sub>ff</sub>)·n &nbsp;⇒&nbsp; n* = 3d + d<sub>ff</sub> ≈ 29,200</div>' +
              '<p>Above n*, attention dominates and grows quadratically. At our n = 75,600 attention is 117 TFLOP against 45 TFLOP for the linear layers. FlashAttention-3 reaches roughly 600–750 TFLOP/s in BF16 on an H100 at d<sub>h</sub> = 128, so dense attention alone is about 0.2 s per layer per GPU.</p>'
          },
          {
            say: 'One transformer block at our size costs about one hundred sixty three teraflops, and seventy two percent of it is self attention. At ten eighty p the share is even larger, which is why high resolution is often a separate super resolution pass.',
            card: { tag: 'NUMBERS', title: 'Where one block spends its FLOPs', stat: { v: '72%', u: 'self-attention', l: 'share of the ≈ 163 TFLOP one block costs at n = 75,600' } },
            deep: '<table><tr><th>term</th><th>formula</th><th>n = 75,600</th></tr>' +
              '<tr><td>self-attn scores + AV</td><td>4n²d</td><td>117.1 T</td></tr>' +
              '<tr><td>FFN</td><td>4n·d·d<sub>ff</sub></td><td>21.4 T</td></tr>' +
              '<tr><td>QKVO projections</td><td>8n·d²</td><td>15.9 T</td></tr>' +
              '<tr><td>cross-attn (q, o, scores)</td><td>4nd² + 4nmd</td><td>8.7 T</td></tr></table>' +
              '<p>Total ≈ 163 TFLOP per block, 72% of it self-attention. At 1080p (n = 171 k) attention alone costs 5.1× the 720p figure, which is why 1080p is often produced by a super-resolution pass on a 720p generation rather than natively.</p>'
          },
          {
            say: 'Sparse patterns attack exactly this. Sliding tile attention keeps local three dimensional windows built from dense tiles, so no computation is wasted on masked entries.',
            card: { tag: 'HOW IT WORKS', title: 'Sliding tile attention', body: 'Each query tile attends a 3-D window of key tiles. Every computed block is dense, so the FLOP saving becomes a real speedup: 1.4× training-free, 3.5× fine-tuned.' },
            deep: '<p><b>Sliding Tile Attention</b> tiles the (t, h, w) grid into cubes (e.g. 6×8×8 = 384 tokens) and lets each query tile attend a 3D window of key tiles. Every computed block is fully dense, so no FLOPs are wasted on masked entries and the kernel stays FlashAttention-fast. On HunyuanVideo it cut end-to-end latency from 945 s (FA3) to 685 s training-free and to 268 s after fine-tuning.</p>' +
              '<p class="muted">The matrix on the right is a toy: 20 tiles per axis, 4 temporal blocks × 5 spatial tiles.</p>'
          },
          {
            say: 'Radial attention instead shrinks the window as the distance in time grows, which gives n log n scaling. Try the buttons to compare dense, sliding tile and radial masks.',
            card: { tag: 'TRY IT', title: 'Toggle the masks', body: 'Dense, sliding tile and radial: click the chips and watch the computed-tile density and the implied FLOP saving change.' },
            deep: '<p><b>Radial attention</b> uses a static mask whose spatial window halves as temporal distance doubles (attention energy decays with distance), giving O(n log n). <b>Sparse VideoGen</b> classifies heads online as spatial or temporal and gives each its own pattern. Orthogonal levers: SageAttention (INT8/FP8 QKᵀ), step caching (TeaCache), and sequence parallelism (Ulysses / Ring) across 8 GPUs.</p>' +
              '<p class="muted">Density and the implied saving are computed from the toy mask. At the real n = 75.6k there are about 200 tiles, and density is roughly 10–45%.</p>'
          }
        ],
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
            b.setAttribute('width', 0);
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
          function lineBlock(list, y0) {
            var lg = ctx.group({ parent: g });
            list.forEach(function (l, i) { ctx.text(880, y0 + i * 26, l[0], { size: 12.5, font: 'mono', color: l[1], parent: lg }); });
            return lg;
          }
          S.sl1 = lineBlock([['STA: a 3D window over tiles (e.g. 6×8×8 = 384 tokens) →', 'text'], ['every computed tile is dense: no masked-FLOP waste', 'text']], 690);
          S.sl2 = lineBlock([['Radial: spatial window halves as |Δt| doubles → O(n log n)', 'text'], ['Sparse VideoGen: per-head spatial vs temporal, chosen online', 'dim'],
            ['orthogonal: SageAttention (INT8 QKᵀ), TeaCache step caching,', 'dim'], ['Ulysses / Ring sequence parallelism across 8 GPUs', 'dim']], 742);
          S.mask = 'dense';
          maskUpdate(ctx, S);
          hide([S.pg, S.mk, S.bk, S.sg, S.sl1, S.sl2]);

          /* beat 0: the two cost curves */
          return Promise.all([ctx.reveal(S.pg, { from: 'left' }), ctx.reveal(S.curves8, { from: 'draw', dur: 1400, delay: 300, stagger: 200 })]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the crossover and our shot */
            return ctx.reveal(S.mk, { from: 'fade', dur: 600 }).then(function () {
              return ctx.pulse(S.mk, { color: 'amber', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: what one block spends */
            ctx.hud('attention ≈ 72% of DiT FLOPs at n = 75.6k');
            return Promise.all([ctx.reveal(S.bk, { from: 'up', dur: 400 })].concat(S.bkBars.map(function (b, i) {
              return ctx.animate(b, { width: [0, parseFloat(b.getAttribute('data-w'))] }, 600, 'out', 200 + i * 200);
            })));
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: sliding tile attention */
            return Promise.all([ctx.reveal(S.sg, { from: 'right' }), ctx.reveal(S.sl1, { from: 'up', delay: 300 })]).then(function () {
              S.mask = 'sta'; maskUpdate(ctx, S);
              return ctx.pulse(S.mm, { color: 'lime', dur: 700 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: radial attention, and the viewer's turn */
            S.mask = 'radial'; maskUpdate(ctx, S);
            return Promise.all([ctx.reveal(S.sl2, { from: 'up' }), ctx.pulse(S.mm, { color: 'lime', dur: 700 })]);
          });
        }
      },
      /* ------------------------------------------------------------------ 9 */
      {
        title: 'At scale',
        beats: [
          {
            say: 'Putting it together for our trailer. Wan\'s large model has forty blocks of width five thousand one hundred twenty, with forty heads of one hundred twenty eight dimensions each. That is roughly fourteen billion parameters.',
            card: { tag: 'NUMBERS', title: 'The real models', stat: { v: '14 B', u: 'parameters', l: 'Wan 2.1: 40 blocks × ≈ 351 M (105 M self-attn + 105 M cross-attn + 142 M FFN)' } },
            deep: '<p><b>Parameter check</b> (Wan 2.1 14B, per block): self-attn 4d² = 105 M, cross-attn 4d² = 105 M, FFN 2·d·d<sub>ff</sub> = 142 M → ≈ 351 M × 40 blocks ≈ <b>14.0 B</b>. In BF16 the weights take 28 GB: one 80 GB GPU holds the model, but activations for n = 75.6 k push toward FSDP and sequence parallelism.</p>' +
              '<p>The 1.3 B sibling (d = 1536, 30 blocks) runs on an 8 GB consumer GPU; HunyuanVideo’s 13 B mixes 20 dual-stream and 40 single-stream blocks, with a 3D RoPE split of 16 / 56 / 56 and a decoder-only MLLM as text encoder.</p>'
          },
          {
            say: 'One forward pass over a five second, seven twenty p shot costs about six and a half petaflops. Fifty steps with guidance make roughly six hundred fifty petaflops.',
            card: { tag: 'NUMBERS', title: 'One shot, one budget', stat: { v: '650', u: 'PFLOP', l: 'per shot: 163 TFLOP × 40 blocks × 2 (guidance) × 50 sampler steps' } },
            deep: '<div class="eq">C<sub>shot</sub> ≈ 163 TFLOP × 40 × 2<sub>CFG</sub> × 50 ≈ 6.5·10<sup>17</sup> FLOP</div>' +
              '<p>One forward pass costs ≈ 6.5 PFLOP; guidance doubles it and fifty steps multiply it by fifty. The bars use a log scale from 10<sup>13.5</sup> to 10<sup>18</sup> FLOP, so each row looks similar in length while the number grows by orders of magnitude.</p>'
          },
          {
            say: 'On an H one hundred at a realistic forty five percent utilization, that is around twenty four GPU minutes per shot, and about two and a half GPU hours for all six shots.',
            card: { tag: 'NUMBERS', title: 'In GPU time', stat: { v: '≈ 24', u: 'GPU-minutes per shot', l: '650 PFLOP ÷ (989 TFLOP/s × 45% MFU); six shots ≈ 2.4 GPU-hours before re-renders' } },
            deep: '<p>At 989 TFLOP/s dense BF16 (H100 SXM) and ~45% MFU: 6.5·10<sup>17</sup> / 4.45·10<sup>14</sup> ≈ 1,460 s ≈ <b>24 GPU-minutes</b> per shot; six shots ≈ 2.4 GPU-hours, before VAE decode and re-renders.</p>' +
              '<p class="muted">At the 24 fps / 111,600-token spec of the Video Serving chamber the naive figure is ≈ 54 GPU-minutes; its speedup ladder brings the whole trailer to ≈ 1.2 GPU-hours, the overview’s ≈ 76 GPU-min.</p>'
          },
          {
            say: 'Here is the whole pass in one line: patchify the latent, run forty blocks that combine rotary positions, full attention, text and modulation, then unpatchify into a velocity for the sampler.',
            card: { tag: 'KEY IDEA', title: 'One pass, end to end', body: 'Everything in this chamber lives inside the middle box, evaluated 100 times per shot. Self-attention alone is 72% of its FLOPs.' },
            deep: '<p>The chain is exactly one evaluation of v<sub>θ</sub>: patchify (Conv3d 16 → 5120), 40 blocks of [adaLN-modulated full 3D self-attention with 3D RoPE → cross-attention to text → FFN], then Linear 5120 → 64 and unpatchify.</p>' +
              '<p><b>Wan 2.2 A14B</b> keeps this block but splits the denoising trajectory between two 14B experts (high-noise for early σ, low-noise for late σ): 27 B parameters, 14 B active per step, so the per-shot FLOPs above are unchanged.</p>'
          },
          {
            say: 'That is why serving splits each shot across eight GPUs, and why distillation to a handful of steps matters so much. The levers multiply: sequence parallelism, sparse attention, fewer steps, cheaper arithmetic and caching each attack a different factor of the bill.',
            card: { tag: 'WHY IT MATTERS', title: 'The levers multiply', body: 'Each lever cuts a different factor: GPUs per shot, FLOPs per step, steps per shot, guidance passes, bytes per number.' },
            deep: '<ul><li>Sequence parallel (DeepSpeed-Ulysses all-to-all over heads, or Ring attention) ×8 GPUs → ~3 min wall-clock.</li>' +
              '<li>Sparse attention: ≈ 1.4–3.5× end-to-end at 720p (STA, training-free vs fine-tuned), more at longer n.</li>' +
              '<li>Step distillation (consistency / DMD / rectified-flow students): 50 → 4–8 steps; CFG distillation removes the ×2.</li>' +
              '<li>FP8 GEMMs and quantized attention; step caching reuses block outputs across adjacent σ.</li></ul>' +
              '<p class="muted">Related chambers: Diffusion &amp; Flow Matching, Spatiotemporal VAE, Video Model Serving, FlashAttention, Distributed Parallelism.</p>'
          }
        ],
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
              bar.setAttribute('width', 0);
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
          S.lvNote = ctx.group({ parent: g });
          ctx.text(80, 830, 'Wan 2.2 A14B: same block, two 14B experts (high-noise σ early, low-noise σ late) → 27B total, 14B active, same FLOPs per step', { size: 12.5, font: 'mono', color: 'text', parent: S.lvNote });
          ctx.text(80, 860, 'deeper chambers: Diffusion & Flow Matching · Spatiotemporal VAE · Video Model Serving · FlashAttention · Distributed Parallelism', { size: 12.5, font: 'mono', color: 'dim', parent: S.lvNote });
          hide([S.tb, S.trows, S.bg, S.brow, S.rc, S.lv, S.lvChips, S.lvNote]);

          /* beat 0: the real models */
          return Promise.all([ctx.reveal(S.tb, { from: 'left' }), ctx.reveal(S.trows, { from: 'left', delay: 200, stagger: 90 })]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: FLOPs of one block, one pass, one shot */
            return Promise.all([ctx.reveal(S.bg, { from: 'right' }), ctx.reveal(S.brow.slice(0, 4), { from: 'right', delay: 300, stagger: 350 })].concat(S.bbars.map(function (b, k) {
              return ctx.animate(b, { width: [0, parseFloat(b.getAttribute('data-w'))] }, 600, 'out', 400 + k * 350);
            })));
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: converted to GPU time */
            ctx.hud('≈ 24 H100-min per shot at 50 steps + CFG');
            return ctx.reveal(S.brow.slice(4), { from: 'right', stagger: 400 }).then(function () {
              return ctx.pulse(S.brow[4], { color: 'amber', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the recap chain of one pass */
            return ctx.reveal(S.rc, { from: 'up' }).then(function () {
              return S.rcl.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'lime', dur: 450 }); }); }, Promise.resolve());
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the levers */
            return Promise.all([ctx.reveal(S.lv, { from: 'up' }), ctx.reveal(S.lvChips, { from: 'scale', delay: 200, stagger: 90 }), ctx.reveal(S.lvNote, { from: 'up', delay: 900 })]);
          });
        }
      },
    ]
  });
})();
