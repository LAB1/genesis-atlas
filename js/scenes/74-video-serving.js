/* L2 — Video Model Serving. Why one 5 s 720p shot costs ~an H100-hour, and the systems stack that
 * brings it to seconds: sequence parallelism (Ulysses, Ring, USP), CFG parallelism, PipeFusion,
 * step caching, few-step students, cheaper attention, stage pools, tiled VAE, and the speedup ladder. */
(function () {
  var HG = ['cyan', 'blue', 'violet', 'magenta', 'pink', 'orange', 'amber', 'lime'];

  function heading(ctx, G, x, y, title, sub, col) {
    ctx.text(x, y, title, { size: 19, font: 'display', weight: 700, color: 'white', parent: G });
    if (sub) ctx.text(x, y + 25, sub, { size: 12.5, font: 'mono', color: col || 'dim', parent: G });
  }
  function clearPanel(ctx, S) {
    if (S.panel) ctx.remove(S.panel, 380);
    S.panel = ctx.group();
    return S.panel;
  }
  /* shot pipeline strip in the free top band */
  function buildStrip(ctx, S) {
    if (S.strip) return;
    var G = S.strip = ctx.group();
    ctx.text(846, 108, 'SHOT', { size: 11, font: 'mono', color: 'dim', parent: G });
    var items = [['TEXT ENC', 'amber', 930], ['DiT × 100 fwd', 'lime', 1062], ['VAE', 'lime', 1180], ['NVENC', 'orange', 1262]];
    S.stripChips = items.map(function (it) { return ctx.label(it[2], 108, it[0], { color: it[1], size: 11, parent: G }); });
    ctx.line(970, 108, 1000, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G });
    ctx.line(1122, 108, 1156, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G });
    ctx.line(1204, 108, 1232, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G });
    ctx.reveal(G, { from: 'down' });
  }
  function setStrip(S, on) {
    S.stripChips.forEach(function (c, i) { c.setAttribute('opacity', on.indexOf(i) >= 0 ? 1 : 0.28); });
  }
  function gpuChip(ctx, parent, cx, cy, label, col, w, h) {
    var g = ctx.group({ parent: parent });
    w = w || 96; h = h || 34;
    ctx.rect(cx - w / 2, cy - h / 2, w, h, { rx: 5, fill: ctx.alpha(col, 0.12), stroke: col, sw: 1.2, parent: g });
    ctx.icon('gpu', cx - w / 2 + 16, cy, 18, col, { parent: g });
    ctx.text(cx - w / 2 + 30, cy, label, { size: 12, font: 'mono', weight: 600, color: 'white', parent: g });
    g.box = { x: cx - w / 2, y: cy - h / 2, w: w, h: h, cx: cx, cy: cy, l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
    g.color = ctx.color(col);
    return g;
  }

  Atlas.register({
    id: 'video-serving',
    refs: [
      'Jacobs et al., <i>DeepSpeed Ulysses: System Optimizations for Enabling Training of Extreme Long Sequence Transformer Models</i>, 2023',
      'Liu, Zaharia &amp; Abbeel, <i>Ring Attention with Blockwise Transformers for Near-Infinite Context</i>, ICLR 2024',
      'Fang &amp; Zhao, <i>USP: A Unified Sequence Parallelism Approach for Long Context Generative AI</i>, 2024; Fang et al., <i>xDiT</i>, 2024; Wang et al., <i>PipeFusion: Patch-level Pipeline Parallelism for DiT Inference</i>, 2024',
      'Liu et al., <i>Timestep Embedding Tells: It\'s Time to Cache for Video Diffusion Model</i> (TeaCache), CVPR 2025; Lv et al., <i>FasterCache</i>, ICLR 2025',
      'Zhang et al., <i>SageAttention: Accurate 8-bit Attention for Plug-and-Play Inference Acceleration</i>, ICLR 2025; <i>SageAttention2</i>, ICML 2025',
      'Zhang et al., <i>Fast Video Generation with Sliding Tile Attention</i>, ICML 2025; Xi et al., <i>Sparse VideoGen</i>, ICML 2025',
      'Yin et al., <i>Improved Distribution Matching Distillation (DMD2)</i>, NeurIPS 2024; Yin et al., <i>CausVid</i>, CVPR 2025; Huang et al., <i>Self Forcing</i>, 2025',
      'Wan Team (Alibaba), <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'One shot, one bill',
        say: 'The camera agent calls render shot for shot three of the fox trailer: five seconds of seven twenty p video. Serving it is nothing like serving text. The text encoder runs once, in milliseconds. Then a fourteen billion parameter diffusion transformer runs one hundred forward passes, fifty steps times two for guidance, each over one hundred and eleven thousand tokens. That is about one point three quintillion operations, close to an hour on a single H100. Nearly all of it is the denoiser.',
        deep: '<p>Worked budget for a Wan-14B-class DiT (d = 5120, 40 blocks, 40 heads × 128, FFN 13,824) at N = 31 · 45 · 80 = 111,600 tokens:</p>' +
          '<table><tr><th>term</th><th>FLOPs</th></tr>' +
          '<tr><td>self-attention 4N²d · 40</td><td>1.02×10¹⁶ (79 %)</td></tr>' +
          '<tr><td>linear layers 2·P·N</td><td>2.67×10¹⁵ (21 %)</td></tr>' +
          '<tr><td><b>one forward</b></td><td><b>1.29×10¹⁶</b></td></tr>' +
          '<tr><td>× 2 CFG × 50 steps</td><td><b>1.29×10¹⁸</b></td></tr></table>' +
          '<div class="eq">t ≈ 1.29×10¹⁸ / (989×10¹² · 0.40) ≈ 3,260 s ≈ 54 H100-minutes</div>' +
          '<p>Contrast with LLM decode: this workload is <b>compute-bound</b> (attention over 10<sup>5</sup> tokens has arithmetic intensity in the thousands), <b>long-running</b> (minutes, not ms), and has a single request per GPU group — so the levers are parallelism inside one job, fewer / cheaper forward passes, and pipelining the stages around it.</p>' +
          '<p><span class="muted">The text encoder (umT5-XXL encoder, ~5.7B) costs ~6 TFLOP per prompt. VAE decode is only ~10<sup>15</sup> FLOP but runs low-MFU causal 3-D convolutions: order of 40 s on one GPU (≈ 1 % of the GPU-seconds, an estimate; it is also the <i>memory</i> peak). NVENC is fixed-function hardware. Six shots for the 30 s trailer ≈ 5.4 GPU-hours before any re-renders. (Chambers that quote Wan’s native 16 fps / 81-frame setting use 75,600 tokens and ≈ 24 GPU-min per shot for the same naive recipe.)</span></p>',
        run: function (ctx) {
          var S = ctx.state;
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'ONE SHOT, ONE BILL', 'render_shot(): 5 s · 24 fps · 1280×720 → 121 frames → 31 × 45 × 80 = 111,600 tokens', 'red');
          S.req = ctx.node({ x: 140, y: 340, w: 180, h: 64, title: 'render_shot()', sub: 'Camera agent', icon: 'tool', color: 'magenta', titleSize: 14, subSize: 11, parent: G });
          S.te = ctx.node({ x: 390, y: 340, w: 190, h: 64, title: 'Text encoder', sub: 'umT5-XXL · 512 tok', icon: 'doc', color: 'amber', titleSize: 14, subSize: 11, parent: G });
          S.dit = ctx.node({ x: 720, y: 340, w: 300, h: 84, title: 'DiT denoiser', sub: '14B · 40 blocks · d = 5120', icon: 'film', color: 'lime', titleSize: 17, subSize: 12, parent: G });
          S.vae = ctx.node({ x: 1070, y: 340, w: 190, h: 64, title: 'VAE decode', sub: '31 → 121 frames', icon: 'layers', color: 'lime', titleSize: 14, subSize: 11, parent: G });
          S.enc = ctx.node({ x: 1350, y: 340, w: 190, h: 64, title: 'NVENC', sub: 'H.264 / HEVC', icon: 'film', color: 'orange', titleSize: 14, subSize: 11, parent: G });
          var nodes = [S.req, S.te, S.dit, S.vae, S.enc];
          var links = [[S.req, S.te, 'magenta'], [S.te, S.dit, 'amber'], [S.dit, S.vae, 'lime'], [S.vae, S.enc, 'lime']].map(function (p) { return ctx.link(p[0], p[1], { from: 'r', to: 'l', color: p[2], parent: G }); });
          var loop = ctx.path('M820,298 C820,246 620,246 620,298', { stroke: 'lime', sw: 1.8, arrow: true, parent: G });
          var loopL = ctx.text(720, 234, '× 50 steps × 2 (CFG) = 100 forward passes', { size: 12.5, font: 'mono', color: 'lime', anchor: 'middle', parent: G });
          /* GPU-seconds split */
          var SB = ctx.group({ parent: G });
          ctx.text(60, 420, 'WHERE THE GPU-SECONDS GO · 1 GPU, no tricks', { size: 12, font: 'mono', color: 'dim', parent: SB });
          var bx0 = 60, BW = 1480;
          var segs = [[0.0005, 'amber'], [0.982, 'lime'], [0.0125, 'violet'], [0.0005, 'orange']];
          segs.forEach(function (s) {
            var w = Math.max(4, BW * s[0]);
            ctx.rect(bx0, 436, w - 2, 26, { rx: 3, fill: ctx.alpha(s[1], 0.45), stroke: s[1], sw: 1, parent: SB });
            bx0 += w;
          });
          ctx.text(760, 449, 'DiT denoising ≈ 99 % of the GPU-seconds', { size: 12.5, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: SB });
          ctx.text(60, 480, 'text encode + NVENC < 0.1 %', { size: 11.5, font: 'mono', color: 'dim', parent: SB });
          ctx.text(1540, 480, 'VAE decode ≈ 1 % (≈ 40 s on 1 GPU)', { size: 11.5, font: 'mono', color: 'violet', anchor: 'end', parent: SB });
          /* FLOP ladder */
          var LD = ctx.group({ parent: G });
          ctx.text(60, 526, 'THE FLOP BILL (log scale)', { size: 12, font: 'mono', color: 'dim', parent: LD });
          var rows = [['1 DiT block · n = 111,600', 3.23e14, '3.2×10¹⁴'], ['× 40 blocks = 1 forward', 1.29e16, '1.29×10¹⁶'], ['× 2 (CFG: cond + uncond)', 2.58e16, '2.6×10¹⁶'], ['× 50 denoising steps', 1.29e18, '1.29×10¹⁸ FLOP']];
          S.lbars = [];
          rows.forEach(function (r, i) {
            var y = 548 + i * 46;
            ctx.text(60, y + 13, r[0], { size: 13, font: 'mono', color: 'text', parent: LD });
            var w = (Math.log10(r[1]) - 13.5) / 5 * 540;
            var b = ctx.rect(330, y, w, 26, { rx: 4, fill: ctx.alpha(i === 3 ? 'red' : 'lime', 0.45), stroke: i === 3 ? 'red' : 'lime', sw: 1, parent: LD });
            var t = ctx.text(330 + w + 10, y + 13, r[2], { size: 13, font: 'mono', weight: 700, color: i === 3 ? 'red' : 'lime', parent: LD });
            S.lbars.push([b, w, t]);
          });
          ctx.text(60, 760, 'inside one forward:', { size: 12, font: 'mono', color: 'dim', parent: LD });
          ctx.rect(330, 748, 540 * 0.79, 24, { rx: 3, fill: ctx.alpha('lime', 0.4), stroke: 'lime', sw: 1, parent: LD });
          ctx.rect(330 + 540 * 0.79, 748, 540 * 0.21, 24, { rx: 3, fill: ctx.alpha('amber', 0.4), stroke: 'amber', sw: 1, parent: LD });
          ctx.text(330 + 540 * 0.395, 760, 'self-attention 4n²d · 79 %', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: LD });
          ctx.text(330 + 540 * 0.895, 760, 'linear 21 %', { size: 11.5, font: 'mono', color: 'white', anchor: 'middle', parent: LD });
          ctx.text(60, 806, 'n² is the villain: double the frames or the resolution and attention cost quadruples', { size: 12, font: 'mono', color: 'dim', parent: LD });
          /* right: the clock */
          var RC = ctx.group({ parent: G });
          ctx.text(1010, 540, '÷ (989 TFLOP/s BF16 × 40 % MFU)', { size: 12.5, font: 'mono', color: 'dim', parent: RC });
          ctx.icon('clock', 1030, 598, 40, 'red', { parent: RC });
          S.clock = ctx.text(1066, 598, '0 s', { size: 42, font: 'display', weight: 700, color: 'red', parent: RC });
          ctx.text(1010, 648, '≈ 54 H100-minutes per 5-second shot', { size: 14, font: 'mono', color: 'white', parent: RC });
          ctx.text(1010, 676, '× 6 shots in the trailer ≈ 5.4 GPU-hours', { size: 13, font: 'mono', color: 'text', parent: RC });
          ctx.text(1010, 716, 'serving target: previews in seconds,', { size: 13, font: 'mono', color: 'cyan', parent: RC });
          ctx.text(1010, 738, 'finals well under a minute per shot', { size: 13, font: 'mono', color: 'cyan', parent: RC });
          ctx.reveal(nodes, { from: 'scale', stagger: 120 });
          ctx.reveal(links, { from: 'draw', delay: 500, stagger: 100 });
          ctx.reveal(loop, { from: 'draw', delay: 800 });
          ctx.reveal([loopL, SB], { delay: 1000, stagger: 200 });
          ctx.reveal(LD, { from: 'up', delay: 1200 });
          ctx.reveal(RC, { from: 'right', delay: 1400 });
          S.lbars.forEach(function (b) { b[0].setAttribute('width', 0); b[2].setAttribute('opacity', 0); });
          ctx.hud('1.29×10¹⁸ FLOP ≈ 54 H100-min per shot');
          return ctx.wait(1500).then(function () {
            return ctx.packet(links[0], { color: 'magenta', dur: 450 }).then(function () { return ctx.packet(links[1], { color: 'amber', dur: 450, label: 'c' }); })
              .then(function () { return ctx.packet(loop, { color: 'lime', dur: 700 }); });
          }).then(function () {
            return S.lbars.reduce(function (p, b, i) {
              return p.then(function () {
                return ctx.animate(b[0], { width: [0, b[1]] }, 450, 'out').then(function () { ctx.reveal(b[2], { dur: 250 }); });
              });
            }, Promise.resolve());
          }).then(function () {
            return ctx.counter(S.clock, 0, 3260, 1200, function (v) { return Math.round(v).toLocaleString('en-US') + ' s'; });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Ulysses: all-to-all',
        say: 'The first lever is to split one shot across eight GPUs. With DeepSpeed Ulysses, each GPU owns one eighth of the token sequence, about fourteen thousand tokens, and computes their queries, keys and values for all forty heads. Attention needs every token, so an all to all exchange transposes the split. Afterwards each GPU holds all hundred and eleven thousand tokens, but only five heads, and runs ordinary full attention on them. A second all to all restores the sequence split for the MLP.',
        deep: '<p>Ulysses shards activations along the sequence for everything token-local (projections, MLP, norms) and along <b>heads</b> for attention:</p>' +
          '<div class="eq">[N/P, H, d<sub>h</sub>]  —all-to-all→  [N, H/P, d<sub>h</sub>]  —attention→  —all-to-all→  [N/P, H, d<sub>h</sub>]</div>' +
          '<p>Per layer per GPU it moves Q, K, V and O: 4 · N·d/P · 2 B = 4 × 143 MB ≈ 571 MB (7/8 of it off-GPU). On NVLink 4 (~350 GB/s achieved all-to-all) that is ≈ 1.5 ms, against ≈ 100 ms of compute per layer per GPU (3.2×10¹⁴ / 8 at ~400 TFLOP/s): &lt; 2 % overhead.</p>' +
          '<ul><li><b>Constraint</b>: P must divide the head count (40 heads → P ∈ {2, 4, 5, 8, 10, 20, 40}); GQA models are limited by KV heads.</li>' +
          '<li><b>Comm per GPU ∝ N·d/P</b>, so it stays cheap as P grows — but all-to-all needs a fast all-to-all fabric (NVLink/NVSwitch), it degrades across nodes.</li>' +
          '<li>Every GPU still holds the full 28 GB of BF16 weights (or 14 GB in FP8): SP splits activations and FLOPs, not parameters.</li></ul>' +
          '<p>Wan 2.x, HunyuanVideo and xDiT ship Ulysses-style SP for multi-GPU inference; on 8 H100s the practical scaling is ~6.5–7.5×.</p>',
        run: function (ctx) {
          var S = ctx.state;
          buildStrip(ctx, S); setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'SEQUENCE PARALLELISM — DEEPSPEED-ULYSSES', '8 GPUs · each owns 1/8 of the tokens · all-to-all swaps the sequence split for a head split', 'red');
          var XG = function (g) { return 250 + g * 150; };
          /* token bar */
          var TB = ctx.group({ parent: G });
          for (var s = 0; s < 8; s++) {
            ctx.rect(XG(s) - 74, 250, 146, 22, { rx: 3, fill: ctx.alpha('teal', 0.12 + 0.04 * (s % 2)), stroke: ctx.alpha('teal', 0.7), sw: 1, parent: TB });
            ctx.text(XG(s), 261, 's' + s + ' · 13,950 tok', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: TB });
          }
          ctx.text(165, 261, '111,600', { size: 11.5, font: 'mono', color: 'teal', anchor: 'end', parent: TB });
          var chips = [];
          for (var g = 0; g < 8; g++) chips.push(gpuChip(ctx, G, XG(g), 308, 'GPU ' + g, 'red', 104, 32));
          /* row labels */
          S.rowL = [];
          for (var h = 0; h < 8; h++) S.rowL.push(ctx.text(186, 362 + h * 28, 'heads ' + (h * 5) + '–' + (h * 5 + 4), { size: 11, font: 'mono', color: HG[h], anchor: 'end', parent: G }));
          S.cells = [];
          var CG = ctx.group({ parent: G });
          for (var gg = 0; gg < 8; gg++) {
            for (var hh = 0; hh < 8; hh++) {
              var c = ctx.group({ parent: CG });
              ctx.rect(-50, -12, 100, 24, { rx: 4, fill: ctx.alpha(HG[hh], 0.4), stroke: HG[hh], sw: 1, parent: c });
              ctx.text(0, 0, 's' + gg + ' · h' + (hh * 5) + '–' + (hh * 5 + 4), { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: c });
              ctx.place(c, XG(gg), 362 + hh * 28);
              S.cells.push({ el: c, s: gg, h: hh });
            }
          }
          S.phase = ctx.text(800, 612, 'layout A · sequence-sharded: GPU g holds Q, K, V for tokens s_g, all 40 heads   [N/8, 40, 128]', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: G });
          var frames = ctx.group({ parent: G });
          for (var f = 0; f < 8; f++) ctx.rect(XG(f) - 56, 344, 112, 234, { rx: 8, stroke: ctx.alpha('lime', 0.8), sw: 1.6, dash: '5 4', parent: frames });
          frames.setAttribute('opacity', 0);
          var BT = ctx.group({ parent: G });
          ctx.para(60, 668, [
            'per layer, per GPU:  all-to-all(Q, K, V) + all-to-all(O)  =  4 × N·d/P × 2 B  =  4 × 143 MB ≈ 571 MB',
            'NVLink 4 all-to-all ≈ 350 GB/s → ≈ 1.5 ms      vs      ≈ 100 ms of attention + MLP compute per layer per GPU  →  < 2 %',
            'constraint: P divides the head count (40 heads: P = 8 → 5 heads per GPU)  ·  weights are replicated, activations are split'
          ], { size: 13, font: 'mono', color: 'text', parent: BT, lh: 30 });
          ctx.reveal(TB, { from: 'down' });
          ctx.reveal(chips, { from: 'up', delay: 200, stagger: 60 });
          ctx.reveal([CG].concat(S.rowL), { delay: 600, stagger: 30 });
          ctx.reveal([S.phase, BT], { from: 'up', delay: 900, stagger: 200 });
          ctx.hud('all-to-all ≈ 1.5 ms vs ≈ 100 ms compute per layer');
          return ctx.wait(2000).then(function () {
            S.phase.textContent = 'all-to-all: cell (s_g, heads h) travels from GPU g to GPU h';
            return Promise.all(S.cells.map(function (c) {
              return ctx.transform(c.el, { x: XG(c.h), y: 362 + c.s * 28 }, 1400, 'inOut', (c.s + c.h) * 25);
            }));
          }).then(function () {
            S.rowL.forEach(function (t, i) { t.textContent = 'tokens s' + i; t.setAttribute('fill', ctx.C.teal); });
            S.phase.textContent = 'layout B · head-sharded: GPU h holds all 111,600 tokens for 5 heads → plain full attention   [N, 5, 128]';
            ctx.reveal(frames, { dur: 400 });
            return Promise.all(chips.map(function (c, i) { return ctx.pulse(c, { color: HG[i], dur: 700 }); }));
          }).then(function () {
            return ctx.wait(400);
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Ring attention & USP',
        say: 'Ulysses needs a fast all to all and stops at the head count. Ring attention takes the other route. Every GPU keeps its own queries, and the key value blocks travel around a ring, one hop at a time. At each hop a GPU computes one block of the attention matrix and folds it into a running softmax, exactly like FlashAttention does across tiles. Watch the diagonals fill. Because each hop\'s compute outlasts the transfer, communication hides completely. Unified sequence parallelism combines both.',
        deep: '<p>GPU i holds Q<sub>i</sub>, K<sub>i</sub>, V<sub>i</sub> (N/P tokens). For r = 0 … P−1 it computes the block with KV<sub>(i−r) mod P</sub> while sending its current KV block to GPU i+1:</p>' +
          '<div class="eq">m′ = max(m, rowmax S),  ℓ′ = e<sup>m−m′</sup>ℓ + Σ e<sup>S−m′</sup>,  O′ = e<sup>m−m′</sup>O + e<sup>S−m′</sup>V</div>' +
          '<p>Per hop, per layer, per GPU: KV block = 2 × 13,950 × 5120 × 2 B = 286 MB → ≈ 5.7 ms on a 400 Gb/s NIC, ≈ 0.8 ms on NVLink; compute 4·(N/P)²·d ≈ 4.0 TFLOP ≈ 10 ms. Transfer is hidden if it stays below compute, which holds even across nodes.</p>' +
          '<ul><li>No head-count limit; P2P only (send/recv), no all-to-all.</li>' +
          '<li>Smaller per-hop blocks at large P make it compute-inefficient and harder to overlap; bidirectional attention (no causal mask) keeps load balanced — unlike causal LLM training, which needs zig-zag / striped sharding.</li></ul>' +
          '<p><b>USP</b> (Fang &amp; Zhao 2024, used by xDiT): a 2-D process mesh P = u × r — Ulysses degree u inside the NVLink domain, Ring degree r across nodes or slower links. Ulysses supplies bandwidth efficiency, Ring removes the head limit.</p>',
        run: function (ctx) {
          var S = ctx.state;
          setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'RING ATTENTION & USP', 'queries stay put · KV blocks circulate · an online softmax merges partial results', 'red');
          var CX = 400, CY = 470, R = 180;
          function ang(g) { return -Math.PI / 2 + g * Math.PI / 4; }
          var chips = [];
          for (var g = 0; g < 8; g++) chips.push(gpuChip(ctx, G, CX + R * Math.cos(ang(g)), CY + R * Math.sin(ang(g)), 'GPU ' + g, HG[g], 96, 32));
          S.arcs = [];
          for (var a = 0; a < 8; a++) {
            var a1 = ang(a) + 0.2, a2 = ang(a + 1) - 0.2, RR = R - 38;
            var p = ctx.path('M' + (CX + RR * Math.cos(a1)).toFixed(1) + ',' + (CY + RR * Math.sin(a1)).toFixed(1) + ' A' + RR + ',' + RR + ' 0 0 1 ' + (CX + RR * Math.cos(a2)).toFixed(1) + ',' + (CY + RR * Math.sin(a2)).toFixed(1), { stroke: ctx.alpha('red', 0.6), sw: 1.6, arrow: true, parent: G });
            p.len = p.getTotalLength();
            S.arcs.push(p);
          }
          ctx.text(CX, CY - 12, 'KV ring', { size: 15, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: G });
          S.hopT = ctx.text(CX, CY + 14, 'hop 0 / 7', { size: 13, font: 'mono', color: 'red', anchor: 'middle', parent: G });
          /* block matrix */
          var rl = [], cl = [];
          for (var i = 0; i < 8; i++) { rl.push('Q' + i); cl.push('KV' + i); }
          S.M = ctx.matrix(830, 296, 8, 8, { cell: 42, gap: 4, cmap: 'lime', values: function () { return 0.05; }, rowLabels: rl, colLabels: cl, parent: G });
          ctx.text(830, 680, 'block (i, j) = softmax-merge(Qᵢ · KVⱼ),', { size: 12, font: 'mono', color: 'dim', parent: G });
          ctx.text(830, 700, 'computed on GPU i at hop (i − j) mod 8', { size: 12, font: 'mono', color: 'dim', parent: G });
          function light(r) {
            for (var q = 0; q < 8; q++) {
              var j = ((q - r) % 8 + 8) % 8;
              S.M.cells[q][j].setAttribute('fill', ctx.mix('#0b1a0a', ctx.C[HG[q]], 0.8 - 0.07 * r));
              S.M.cells[q][j].setAttribute('stroke', ctx.C[HG[q]]);
            }
          }
          var RP = ctx.group({ parent: G });
          ctx.text(1250, 300, 'PER HOP · PER LAYER · PER GPU', { size: 12, font: 'mono', color: 'dim', parent: RP });
          ctx.para(1250, 330, [
            'KV block = 2 × 13,950 × 5120',
            '         × 2 B = 286 MB',
            'send: ≈ 5.7 ms @ 400 Gb/s IB',
            '      ≈ 0.8 ms @ NVLink',
            'compute: 4·(N/8)²·d',
            '       ≈ 4.0 TFLOP ≈ 10 ms',
            '→ transfer hidden under compute',
            '→ no head-count limit',
            '→ P2P only, works across nodes'
          ], { size: 12, font: 'mono', color: 'text', parent: RP, lh: 22 });
          /* USP mesh */
          var UM = ctx.group({ parent: G });
          ctx.text(60, 732, 'USP · P = u × r', { size: 14, font: 'display', weight: 700, color: 'white', parent: UM });
          ctx.text(60, 754, 'u = Ulysses (all-to-all over heads)', { size: 11.5, font: 'mono', color: 'dim', parent: UM });
          ctx.text(60, 772, 'r = Ring (P2P KV passing)', { size: 11.5, font: 'mono', color: 'dim', parent: UM });
          [0, 1].forEach(function (n) {
            var x0 = 380 + n * 430;
            ctx.rect(x0, 722, 380, 108, { rx: 10, fill: ctx.alpha('red', 0.04), stroke: ctx.alpha('red', 0.5), dash: '5 4', sw: 1, parent: UM });
            ctx.text(x0 + 12, 740, 'node ' + n + ' · NVLink domain · Ulysses u = 4', { size: 11.5, font: 'mono', color: 'red', parent: UM });
            var pts = [];
            for (var k = 0; k < 4; k++) { var px = x0 + 50 + k * 94; pts.push(px); ctx.rect(px - 30, 770, 60, 28, { rx: 4, fill: ctx.alpha(HG[n * 4 + k], 0.2), stroke: HG[n * 4 + k], sw: 1, parent: UM }); ctx.text(px, 784, 'G' + (n * 4 + k), { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: UM }); }
            for (var u = 0; u < 4; u++) for (var v = u + 1; v < 4; v++) ctx.path('M' + pts[u] + ',770 Q' + ((pts[u] + pts[v]) / 2) + ',' + (752 - 6 * (v - u)) + ' ' + pts[v] + ',770', { stroke: ctx.alpha('red', 0.35), sw: 1, parent: UM });
          });
          ctx.path('M760,812 Q785,850 810,812', { stroke: 'amber', sw: 1.8, arrow: true, parent: UM });
          ctx.path('M810,800 Q785,770 760,800', { stroke: 'amber', sw: 1.8, arrow: true, parent: UM });
          ctx.text(1230, 776, 'ring r = 2 across nodes', { size: 12, font: 'mono', color: 'amber', parent: UM });
          ctx.text(1230, 796, '(slow link carries only KV)', { size: 11.5, font: 'mono', color: 'dim', parent: UM });
          ctx.reveal(chips, { from: 'scale', stagger: 60 });
          ctx.reveal(S.arcs, { from: 'draw', delay: 400, stagger: 40 });
          ctx.reveal([S.M, RP], { from: 'right', delay: 500, stagger: 200 });
          ctx.reveal(UM, { from: 'up', delay: 900 });
          ctx.hud('per hop: 286 MB KV vs ≈ 10 ms compute');
          light(0);
          var chain = ctx.wait(1500);
          [1, 2, 3, 4, 5, 6, 7].forEach(function (r) {
            chain = chain.then(function () {
              return Promise.all(S.arcs.map(function (p, k) { return ctx.packet(p, { color: HG[((k - r + 1) % 8 + 8) % 8], dur: 420, r: 4 }); })).then(function () {
                light(r);
                S.hopT.textContent = 'hop ' + r + ' / 7';
              });
            });
          });
          return chain;
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'CFG & PipeFusion',
        say: 'Two more axes of parallelism come almost for free. Classifier free guidance runs the model twice per step, with and without the prompt. Those passes are independent, so put the conditional branch on four GPUs and the unconditional one on the other four, and exchange only the fourteen megabyte velocity at the end of each step. PipeFusion goes further on slow interconnects: it cuts the model into layer stages and streams image patches through them, reusing slightly stale activations from the previous step.',
        deep: '<div class="eq">v = v<sub>θ</sub>(z<sub>t</sub>, t, ∅) + w · ( v<sub>θ</sub>(z<sub>t</sub>, t, c) − v<sub>θ</sub>(z<sub>t</sub>, t, ∅) ),   w ≈ 5</div>' +
          '<p><b>CFG parallelism</b>: degree 2, near-perfect scaling; per step each group exchanges one latent v ∈ ℝ<sup>16×31×90×160</sup> (14.3 MB in BF16). A typical 8-GPU xDiT layout is <code>cfg=2 × ulysses=4</code>; with two 4-GPU nodes, put the CFG split <i>across</i> the nodes (it only crosses the slow link once per step) and keep Ulysses inside each NVLink domain.</p>' +
          '<p><b>PipeFusion</b> (xDiT): split the 40 blocks into P stages (10 each, ~7 GB of BF16 weights per GPU instead of 28 GB) and the token sequence into M patches. Patch p of step s flows stage by stage; its attention uses fresh K/V for patches already computed in this step and <b>stale K/V from step s−1</b> for the rest — valid because inputs of adjacent diffusion steps are highly similar (a first warm-up step runs synchronously).</p>' +
          '<ul><li>Comm: point-to-point activations of one patch (N/M · d), far below SP\'s all-to-all → suits PCIe / Ethernet boxes.</li>' +
          '<li>Pipeline bubbles only at the first step; memory for weights drops by P.</li>' +
          '<li>Trade: staleness is an approximation; quality is usually indistinguishable at 50 steps, riskier for 4-step students.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'CFG PARALLEL · PIPEFUSION', 'independent guidance branches on separate GPU groups · patches pipelined through layer stages', 'red');
          /* CFG */
          var L = ctx.group({ parent: G });
          S.zt = ctx.node({ x: 110, y: 450, w: 110, h: 56, title: 'z_t, t', sub: '14.3 MB', color: 'lime', titleSize: 14, subSize: 11, parent: L });
          function grp(y, title, col, off) {
            var n = ctx.node({ x: 410, y: y, w: 400, h: 140, kind: 'ghost', color: col, parent: L });
            ctx.text(222, y - 50, title, { size: 12.5, font: 'mono', color: col, parent: L });
            for (var k = 0; k < 4; k++) gpuChip(ctx, L, 262 + k * 98, y + 6, 'G' + (off + k), col, 84, 34);
            ctx.text(410, y + 50, 'Ulysses-4 inside the group', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
            return n;
          }
          S.gc = grp(345, 'cond · DiT(z_t, t, c)', 'lime', 0);
          S.gu = grp(555, 'uncond · DiT(z_t, t, ∅)', 'dim', 4);
          S.cmb = ctx.node({ x: 700, y: 450, w: 120, h: 64, title: 'combine', sub: 'w ≈ 5', color: 'amber', titleSize: 14, subSize: 11, parent: L });
          var l1 = ctx.link(S.zt, S.gc, { from: 'r', to: 'l', color: 'lime', parent: L });
          var l2 = ctx.link(S.zt, S.gu, { from: 'r', to: 'l', color: 'dim', parent: L });
          var l3 = ctx.link(S.gc, S.cmb, { from: 'r', to: 't', color: 'lime', label: 'v_c', parent: L });
          var l4 = ctx.link(S.gu, S.cmb, { from: 'r', to: 'b', color: 'dim', label: 'v_∅', parent: L });
          ctx.text(60, 680, 'v = v_∅ + w · (v_c − v_∅)', { size: 14, font: 'mono', weight: 700, color: 'amber', parent: L });
          ctx.text(60, 704, 'exchange per step: one 16×31×90×160 latent = 14.3 MB', { size: 12, font: 'mono', color: 'dim', parent: L });
          ctx.text(60, 724, 'scaling ≈ 2.0× for the price of a tiny all-gather', { size: 12, font: 'mono', color: 'dim', parent: L });
          /* PipeFusion */
          var P = ctx.group({ parent: G });
          ctx.text(840, 250, 'PIPEFUSION · 4 stages × 4 patches, two diffusion steps', { size: 13, font: 'display', weight: 700, color: 'white', parent: P });
          var X0 = 930, SL = 54, Y0 = 280, RH = 56;
          for (var d = 0; d < 4; d++) {
            ctx.text(X0 - 10, Y0 + d * RH + 22, 'stage ' + d, { size: 11.5, font: 'mono', color: 'text', anchor: 'end', parent: P });
            ctx.text(X0 - 10, Y0 + d * RH + 38, 'L' + d * 10 + '–' + (d * 10 + 9), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: P });
            ctx.rect(X0, Y0 + d * RH, 11 * SL, RH - 8, { rx: 4, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('faint', 0.8), sw: 1, parent: P });
          }
          var PC = ['cyan', 'violet', 'amber', 'pink'];
          S.tiles = [];
          for (var st = 0; st < 2; st++) for (var pp = 0; pp < 4; pp++) for (var dd = 0; dd < 4; dd++) {
            var slot = st * 4 + pp + dd;
            var tg = ctx.group({ parent: P });
            ctx.rect(X0 + slot * SL + 3, Y0 + dd * RH + 3, SL - 6, RH - 14, { rx: 4, fill: ctx.alpha(PC[pp], st ? 0.55 : 0.3), stroke: PC[pp], sw: 1, parent: tg });
            ctx.text(X0 + slot * SL + SL / 2, Y0 + dd * RH + 24, 'p' + pp, { size: 11.5, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: tg });
            tg.setAttribute('opacity', 0);
            S.tiles.push({ el: tg, slot: slot });
          }
          for (var tt = 0; tt <= 10; tt += 2) ctx.text(X0 + tt * SL + SL / 2, Y0 + 4 * RH + 6, 't' + tt, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          ctx.text(X0 + 2 * SL, Y0 - 8 + 0, 'step s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          ctx.text(X0 + 7 * SL, Y0 - 8, 'step s + 1 (no bubble)', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: P });
          ctx.para(840, 540, [
            'each GPU holds 10 of 40 blocks: ~7 GB weights, not 28 GB',
            'patch p attends to fresh KV (patches < p, this step)',
            '  + stale KV (patches ≥ p, from step s − 1)',
            'comm: P2P activations of one patch, no all-to-all',
            '→ good on PCIe / Ethernet; pairs with CFG-parallel'
          ], { size: 12.5, font: 'mono', color: 'text', parent: P, lh: 24 });
          /* layouts */
          var LY = ctx.group({ parent: G });
          ctx.text(60, 780, '8-GPU LAYOUTS', { size: 12, font: 'mono', color: 'dim', parent: LY });
          [['cfg 2 × ulysses 4', 'one NVLink node', 'lime'], ['cfg 2 (across nodes) × ulysses 4', 'two 4-GPU nodes: only 14 MB / step crosses', 'amber'], ['cfg 2 × pipefusion 4', 'PCIe / L40S boxes', 'violet']].forEach(function (l, i) {
            var x = 60 + i * 500;
            ctx.label(x, 816, l[0], { color: l[2], size: 12.5, anchor: 'start', parent: LY });
            ctx.text(x + 12, 846, l[1], { size: 11.5, font: 'mono', color: 'dim', parent: LY });
          });
          ctx.reveal([S.zt, S.gc, S.gu, S.cmb], { from: 'scale', stagger: 120 });
          ctx.reveal(L, { delay: 0 });
          ctx.reveal([l1, l2, l3, l4], { from: 'draw', delay: 500, stagger: 100 });
          ctx.reveal(P, { from: 'right', delay: 600 });
          ctx.reveal(LY, { from: 'up', delay: 900 });
          ctx.hud('CFG-parallel ≈ 2× · PipeFusion: weights ÷ 4');
          return ctx.wait(1300).then(function () {
            return Promise.all([ctx.packet(l1, { color: 'lime', dur: 600 }), ctx.packet(l2, { color: 'dim', dur: 600 })]);
          }).then(function () {
            return Promise.all([ctx.pulse(S.gc, { color: 'lime', dur: 600 }), ctx.pulse(S.gu, { color: 'white', dur: 600 })]);
          }).then(function () {
            return Promise.all([ctx.packet(l3, { color: 'lime', dur: 500 }), ctx.packet(l4, { color: 'dim', dur: 500 })]);
          }).then(function () {
            return ctx.tween(3000, function (t) {
              var k = t * 11;
              S.tiles.forEach(function (ti) { if (ti.slot < k) ti.el.setAttribute('opacity', 1); });
            }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Step caching',
        say: 'Adjacent denoising steps are remarkably similar, especially in the middle of the trajectory. Step caching exploits this. TeaCache watches a cheap signal, how much the timestep-modulated input changed since the last computed step. It accumulates that change, and while the total stays under a threshold it skips all forty blocks and reuses the cached residual from the last full pass. Early steps, which set the layout, and late steps, which add detail, are computed. Roughly every other forward disappears.',
        deep: '<p><b>TeaCache</b> (CVPR 2025): the model output difference between steps correlates with the relative L1 change of the <i>timestep-embedding-modulated</i> input of the first block, which is nearly free to compute:</p>' +
          '<div class="eq">Δ<sub>t</sub> = ‖F<sub>t</sub> − F<sub>t+1</sub>‖<sub>1</sub> / ‖F<sub>t+1</sub>‖<sub>1</sub>,   acc += poly(Δ<sub>t</sub>)</div>' +
          '<pre>if acc &lt; δ:                 # skip 40 blocks\n    out = x + cached_res\nelse:                       # full forward\n    out = DiT(x)\n    cached_res = out − x; acc = 0</pre>' +
          '<p>poly is a small polynomial fitted offline per model to map input change to output change. Reported: ≈ 1.6× (slow) to ≈ 2.1–2.3× (fast) thresholds on HunyuanVideo / Open-Sora-class 50-step samplers at small VBench cost, and up to 4.4× on 150-step Open-Sora-Plan, where redundancy is larger; larger δ trades quality for speed.</p>' +
          '<ul><li><b>FasterCache</b> (ICLR 2025): reuses attention outputs across adjacent steps with a correction term, and <b>CFG-Cache</b>: cond and uncond outputs differ mostly in a stable, frequency-structured way, so the uncond pass is skipped on most steps.</li>' +
          '<li>Related: Δ-DiT, PAB (pyramid attention broadcast), FORA / block-level residual caching.</li></ul>' +
          '<p><span class="muted">Caching composes with sequence parallelism (skip decisions are global) but stacks poorly with 4-step students: there is little redundancy left.</span></p>',
        run: function (ctx) {
          var S = ctx.state;
          setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'STEP CACHING — SKIP FORWARDS THAT CHANGE LITTLE', 'TeaCache: the timestep-modulated input predicts how much the output will move', 'red');
          var N = 50, X0 = 130, SW = 17.4, BW = 12;
          function rel(i) { return 0.018 + 0.30 * Math.exp(-i / 2.5) + 0.10 * Math.exp((i - 49) / 3); }
          var DELTA = 0.055;
          /* simulate */
          var acc = 0, sim = [];
          for (var i = 0; i < N; i++) {
            var comp;
            if (i === 0) { comp = true; acc = 0; }
            else { acc += rel(i); if (acc >= DELTA) { comp = true; } else comp = false; }
            sim.push({ r: rel(i), acc: comp ? acc : acc, comp: comp });
            if (comp) acc = 0;
          }
          var nComp = sim.filter(function (s) { return s.comp; }).length;
          /* chart 1: relative change */
          var C1 = ctx.group({ parent: G });
          var Y1 = 250, H1 = 200, Y1b = Y1 + H1;
          ctx.text(X0, Y1 - 14, 'Δ_t · relative L1 change of the modulated input (clipped at 0.12)', { size: 12, font: 'mono', color: 'dim', parent: C1 });
          ctx.line(X0 - 4, Y1b, X0 + N * SW, Y1b, { color: 'faint', parent: C1 });
          var bars1 = [];
          for (var b = 0; b < N; b++) {
            var hh = Math.min(0.12, sim[b].r) / 0.12 * H1;
            bars1.push(ctx.rect(X0 + b * SW, Y1b - hh, BW, hh, { rx: 2, fill: ctx.alpha('violet', 0.5), stroke: 'violet', sw: 0.8, parent: C1 }));
          }
          ctx.text(X0, Y1b + 16, 'step 0 (pure noise)', { size: 11, font: 'mono', color: 'dim', parent: C1 });
          ctx.text(X0 + N * SW, Y1b + 16, 'step 49 (clean)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: C1 });
          /* chart 2: accumulator */
          var C2 = ctx.group({ parent: G });
          var Y2 = 510, H2 = 110, Y2b = Y2 + H2;
          ctx.text(X0, Y2 - 14, 'accumulated Δ since the last full forward', { size: 12, font: 'mono', color: 'dim', parent: C2 });
          ctx.line(X0 - 4, Y2b, X0 + N * SW, Y2b, { color: 'faint', parent: C2 });
          var dy = Y2b - DELTA / 0.12 * H2;
          ctx.line(X0 - 4, dy, X0 + N * SW, dy, { color: 'red', sw: 1.2, dash: '6 4', parent: C2 });
          ctx.text(X0 + N * SW + 8, dy, 'δ', { size: 14, font: 'mono', weight: 700, color: 'red', parent: C2 });
          var bars2 = [];
          for (var c = 0; c < N; c++) {
            var h2 = Math.min(0.12, sim[c].acc) / 0.12 * H2;
            bars2.push(ctx.rect(X0 + c * SW, Y2b - h2, BW, h2, { rx: 2, fill: ctx.alpha(sim[c].comp ? 'red' : 'amber', 0.5), stroke: sim[c].comp ? 'red' : 'amber', sw: 0.8, parent: C2 }));
          }
          /* row 3: decisions */
          var C3 = ctx.group({ parent: G });
          ctx.text(X0, 660, 'decision', { size: 12, font: 'mono', color: 'dim', parent: C3 });
          var cells = [];
          for (var k = 0; k < N; k++) {
            cells.push(ctx.rect(X0 + k * SW, 676, BW, 22, { rx: 3, fill: sim[k].comp ? ctx.alpha('lime', 0.75) : 'none', stroke: sim[k].comp ? 'lime' : ctx.alpha('lime', 0.5), sw: 1, dash: sim[k].comp ? null : '2 2', parent: C3 }));
          }
          ctx.rect(X0, 716, 14, 12, { rx: 2, fill: ctx.alpha('lime', 0.75), stroke: 'lime', sw: 1, parent: C3 });
          ctx.text(X0 + 20, 722, 'full forward (40 blocks)', { size: 11.5, font: 'mono', color: 'text', parent: C3 });
          ctx.rect(X0 + 230, 716, 14, 12, { rx: 2, fill: 'none', stroke: ctx.alpha('lime', 0.5), dash: '2 2', sw: 1, parent: C3 });
          ctx.text(X0 + 250, 722, 'skip: out = x + cached residual', { size: 11.5, font: 'mono', color: 'text', parent: C3 });
          S.cursor = ctx.rect(X0 - 3, Y1 - 4, BW + 6, 698 - Y1 + 8, { rx: 4, stroke: 'white', sw: 1.2, parent: G, glow: true });
          /* right */
          var R = ctx.group({ parent: G });
          ctx.text(1060, 262, 'FULL FORWARDS', { size: 12, font: 'mono', color: 'dim', parent: R });
          S.cnt = ctx.text(1060, 304, '0 / 50', { size: 36, font: 'display', weight: 700, color: 'lime', parent: R });
          S.spd = ctx.text(1060, 346, '', { size: 15, font: 'mono', color: 'white', parent: R });
          var code = ctx.code({ parent: R, x: 1060, y: 380, w: 480, title: 'TeaCache · per step', lang: 'py', size: 12, color: 'lime', lines: [
            'F = modulate(x, t_emb)          # 1st block input',
            'acc += poly(l1(F, F_prev) / l1(F_prev))',
            'if acc < delta:                  # cheap path',
            '    out = x + cached_residual',
            'else:                            # full path',
            '    out = dit(x); cached_residual = out - x',
            '    acc = 0'
          ] });
          ctx.para(1060, 610, [
            'early steps set layout, late steps add',
            'detail: both change fast → computed',
            'the middle is smooth → mostly skipped',
            'FasterCache + CFG-Cache: also skip',
            'most unconditional passes'
          ], { size: 12.5, font: 'mono', color: 'text', parent: R, lh: 22 });
          [bars1, bars2, cells].forEach(function (arr) { arr.forEach(function (e) { e.setAttribute('opacity', 0.08); }); });
          ctx.reveal([C1, C2, C3], { from: 'up', stagger: 150 });
          ctx.reveal([R, code], { from: 'right', delay: 300 });
          ctx.hud('TeaCache: ' + nComp + ' of 50 forwards → ≈ ' + (50 / nComp).toFixed(1) + '× faster');
          function upto(n) {
            var cmp = 0;
            for (var q = 0; q < N; q++) {
              var on = q < n;
              bars1[q].setAttribute('opacity', on ? 1 : 0.08);
              bars2[q].setAttribute('opacity', on ? 1 : 0.08);
              cells[q].setAttribute('opacity', on ? 1 : 0.08);
              if (on && sim[q].comp) cmp++;
            }
            S.cnt.textContent = cmp + ' / ' + n;
            S.spd.textContent = n ? ('speedup ≈ ' + (n / Math.max(1, cmp)).toFixed(2) + '×') : '';
            S.cursor.setAttribute('x', X0 + Math.min(N - 1, n) * SW - 3);
            if (n >= N) S.cursor.setAttribute('opacity', 0);
          }
          upto(0);
          return ctx.wait(1000).then(function () {
            return ctx.tween(5200, function (t) { upto(Math.round(t * N)); }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Few-step students',
        say: 'Caching trims redundancy; distillation removes it. The teacher integrates a curved probability flow path in fifty guided steps, one hundred forward passes. A distilled student learns to jump. Methods like DMD2 match the teacher\'s output distribution with an adversarial term, and consistency models learn to map any point on the path straight to the end. The student samples in four steps, with guidance baked in, so one hundred passes become four. The price is some diversity and motion richness.',
        deep: '<table><tr><th>method</th><th>idea</th><th>steps</th></tr>' +
          '<tr><td>DMD2</td><td>minimise reverse KL to the teacher via the difference of two score networks (real vs fake) + GAN loss</td><td>4, CFG-free</td></tr>' +
          '<tr><td>consistency (sCM, rCM)</td><td>f(x<sub>t</sub>, t) = x<sub>0</sub> for every t on one PF-ODE path; rCM adds score regularisation, distilled Wan 2.1 14B</td><td>1–4</td></tr>' +
          '<tr><td>adversarial post-training (Seaweed-APT)</td><td>GAN fine-tune against real videos</td><td>1</td></tr>' +
          '<tr><td>CausVid / Self Forcing</td><td>causal (frame-autoregressive) students with KV cache, trained on their own rollouts</td><td>few, streaming</td></tr></table>' +
          '<div class="eq">NFE: 50 steps × 2 (CFG) = 100  →  4 (guidance distilled)  ⇒  25× fewer forwards</div>' +
          '<p>Multi-step consistency sampling alternates <i>jump to x̂<sub>0</sub></i> and <i>re-noise to a lower t</i>, which is what the amber path shows. <b>Guidance distillation</b> feeds w as an input embedding so one pass replaces the cond/uncond pair.</p>' +
          '<p><b>Trade-offs</b>: mode-seeking objectives reduce diversity; fast motion and fine texture can suffer; 1-step models are brittle. Production systems often serve the student for drafts and previews and the teacher (with caching) for hero shots.</p>',
        run: function (ctx) {
          var S = ctx.state;
          setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'FEW-STEP STUDENTS — 100 FORWARDS BECOME 4', 'distil the 50-step, CFG-guided teacher into a 4-step, guidance-free student', 'red');
          var P = ctx.group({ parent: G });
          ctx.rect(70, 240, 700, 480, { rx: 12, fill: 'rgba(255,255,255,0.015)', stroke: 'line', sw: 1, parent: P });
          ctx.text(90, 262, 'latent space (schematic)', { size: 11.5, font: 'mono', color: 'dim', parent: P });
          /* data manifold */
          ctx.path('M110,650 C300,600 480,690 740,560', { stroke: ctx.alpha('lime', 0.25), sw: 26, parent: P });
          ctx.text(700, 610, 'data manifold', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: P });
          ctx.circle(170, 300, 9, { fill: 'white', parent: P, glow: true });
          ctx.text(186, 300, 'z ~ N(0, I)', { size: 12.5, font: 'mono', color: 'white', parent: P });
          /* teacher curve: quadratic bezier from (170,300) ctrl (250,560) to (560,622) */
          function tq(t) { var a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; return { x: a * 170 + b * 240 + c * 560, y: a * 300 + b * 590 + c * 622 }; }
          var d = 'M170,300 Q240,590 560,622';
          var teacher = ctx.path(d, { stroke: ctx.alpha('lime', 0.8), sw: 1.6, parent: P });
          var dots = [];
          for (var i = 1; i <= 50; i++) { var pt = tq(i / 50); dots.push(ctx.circle(pt.x, pt.y, 2.6, { fill: 'lime', parent: P })); }
          var tl = ctx.text(96, 694, 'teacher (green dots): 50 Euler steps × 2 (CFG) along the curved PF-ODE path', { size: 12, font: 'mono', color: 'lime', parent: P });
          /* student: jump / renoise */
          var J = [[170, 300, 470, 640], [470, 640, 380, 430], [380, 430, 530, 628], [530, 628, 470, 520], [470, 520, 552, 624], [552, 624, 530, 570], [530, 570, 560, 622]];
          var sp = [];
          J.forEach(function (j, k) {
            var jump = k % 2 === 0;
            sp.push(ctx.line(j[0], j[1], j[2], j[3], { color: jump ? 'amber' : ctx.alpha('amber', 0.6), sw: jump ? 2.4 : 1.4, dash: jump ? null : '4 4', arrow: true, parent: P }));
          });
          var slab = ctx.text(470, 380, 'student: 4 jumps to x̂₀ + re-noise', { size: 12, font: 'mono', color: 'amber', parent: P });
          ctx.circle(560, 622, 7, { fill: 'lime', stroke: 'white', sw: 1.5, parent: P });
          /* NFE bars */
          var NB = ctx.group({ parent: G });
          ctx.text(70, 762, 'NFEs per shot', { size: 12, font: 'mono', color: 'dim', parent: NB });
          var tb = ctx.rect(230, 752, 520, 22, { rx: 3, fill: ctx.alpha('lime', 0.4), stroke: 'lime', sw: 1, parent: NB });
          ctx.text(740, 763, 'teacher 100', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: NB });
          var sb = ctx.rect(230, 786, 520 * 4 / 100, 22, { rx: 3, fill: ctx.alpha('amber', 0.6), stroke: 'amber', sw: 1, parent: NB });
          ctx.text(262, 797, 'student 4  →  25× fewer forward passes', { size: 12, font: 'mono', weight: 700, color: 'amber', parent: NB });
          /* methods */
          var M = ctx.group({ parent: G });
          ctx.text(820, 262, 'HOW STUDENTS ARE MADE', { size: 13, font: 'display', weight: 700, color: 'white', parent: M });
          var rows = [
            ['DMD2', 'distribution matching (2 score nets) + GAN', '4 · no CFG'],
            ['sCM / rCM', 'consistency along the PF-ODE; rCM: Wan 14B', '1–4'],
            ['Seaweed-APT', 'adversarial post-training on real video', '1'],
            ['CausVid · Self Forcing', 'causal few-step student, KV-cached rollout', 'streaming'],
            ['guidance distill', 'w becomes an input: 1 pass, not 2', '÷ 2']
          ];
          var rowEls = rows.map(function (r, k) {
            var y = 300 + k * 62;
            var g = ctx.group({ parent: M });
            ctx.rect(820, y - 22, 720, 52, { rx: 8, fill: 'rgba(255,255,255,0.025)', stroke: 'line', sw: 1, parent: g });
            ctx.text(836, y - 3, r[0], { size: 13, font: 'mono', weight: 700, color: 'amber', parent: g });
            ctx.text(836, y + 16, r[1], { size: 12, font: 'mono', color: 'text', parent: g });
            ctx.text(1524, y + 6, r[2], { size: 13, font: 'mono', weight: 700, color: 'lime', anchor: 'end', parent: g });
            return g;
          });
          ctx.para(820, 640, [
            'price: mode-seeking → less diversity; fast motion and fine',
            'texture can stiffen; 1-step models are brittle',
            'practice: student for drafts & previews, teacher (+ caching)',
            'for hero shots the critic agent flags'
          ], { size: 12.5, font: 'mono', color: 'dim', parent: M, lh: 22 });
          dots.forEach(function (e) { e.setAttribute('opacity', 0); });
          sp.forEach(function (e) { e.setAttribute('opacity', 0); });
          [slab, tl].forEach(function (e) { e.setAttribute('opacity', 0); });
          ctx.reveal(P, { from: 'left' });
          ctx.reveal(teacher, { from: 'draw', dur: 900, delay: 300 });
          ctx.reveal(rowEls, { from: 'right', delay: 600, stagger: 160 });
          ctx.reveal(NB, { from: 'up', delay: 900 });
          ctx.hud('100 NFE → 4 NFE (25×)');
          tb.setAttribute('width', 0); sb.setAttribute('width', 0);
          return ctx.wait(1000).then(function () {
            ctx.reveal(tl, { dur: 300 });
            ctx.animate(tb, { width: [0, 520] }, 1800, 'linear');
            return ctx.reveal(dots, { stagger: 36, dur: 120 });
          }).then(function () {
            ctx.reveal(slab, { dur: 300 });
            ctx.animate(sb, { width: [0, 520 * 4 / 100] }, 500, 'out');
            return ctx.reveal(sp, { from: 'draw', stagger: 280, dur: 260 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Cheaper attention',
        say: 'Since attention is almost eighty percent of the work, make it cheaper. SageAttention quantizes it: queries and keys go to eight bit integers after smoothing out the key\'s shared bias, and the probability times value product runs in FP8, for two to three times faster kernels. Sparse attention skips work instead: in video most heads look locally in space and time. Sliding tile attention keeps only nearby tiles. Click any query tile to see the three dimensional neighbourhood it attends to.',
        deep: '<p><b>SageAttention</b>: per-block INT8 quantisation of Q and K; <b>smooth K</b> first (K ← K − mean<sub>tokens</sub>(K)), which removes the channel-wise outliers shared by all tokens and does not change softmax (it shifts every logit in a row by the same constant). P̃V in FP16 (v1) or FP8 with FP32 accumulation (v2); reported ≈ 2.1× (v1) and ≈ 3× (v2) over FlashAttention-2 at negligible end-to-end metric loss; SageAttention3 targets FP4 on Blackwell.</p>' +
          '<div class="eq">end-to-end speedup = 1 / ( (1 − a) + a / s ),   a = 0.79:   s = 2 → 1.65×,  s = 3 → 2.11×</div>' +
          '<p>The remaining 21 % (linear layers) can take FP8 GEMMs with per-block scales (≈ 1.5–1.8× on those layers, and weights drop to 14 GB), so the Amdahl ceiling moves as well.</p>' +
          '<p><b>Sparse attention</b>: tokens are ordered in 3-D tiles (t, h, w); a query tile attends only to tiles within a window. At tile granularity every kept block is dense, so kernels stay at tensor-core efficiency (unlike token-level masks).</p>' +
          '<ul><li><b>Sliding Tile Attention</b>: HunyuanVideo 720p 945 s → 685 s training-free, 268 s after fine-tuning (reported).</li>' +
          '<li><b>Sparse VideoGen</b>: profiles heads online as spatial or temporal and applies matching masks, ≈ 2.3× end-to-end.</li>' +
          '<li>Risks: long-range consistency (the fox\'s helmet across the shot) lives in the few global heads — keep them dense.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'CHEAPER ATTENTION — IT IS 79 % OF THE FLOPs', 'quantise it (SageAttention) or skip most of it (sliding-tile sparsity)', 'red');
          /* Sage dataflow */
          var A = ctx.group({ parent: G });
          ctx.text(60, 250, 'SAGEATTENTION DATAFLOW (one tile)', { size: 13, font: 'display', weight: 700, color: 'white', parent: A });
          function mat(x, y, w, h, lab, prec, col) {
            var g = ctx.group({ parent: A });
            ctx.rect(x, y, w, h, { rx: 4, fill: ctx.alpha(col, 0.2), stroke: col, sw: 1.2, parent: g });
            ctx.text(x + w / 2, y + h / 2, lab, { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: g });
            ctx.label(x + w / 2, y + h + 16, prec, { color: col, size: 11, parent: g });
            return g;
          }
          var ms = [
            mat(60, 290, 70, 90, 'Q', 'INT8', 'amber'),
            mat(160, 290, 70, 90, 'K−K̄', 'INT8', 'amber'),
            mat(290, 290, 90, 90, 'S=QKᵀ', 'INT32→FP32', 'violet'),
            mat(420, 290, 90, 90, 'P̃', 'FP8', 'cyan'),
            mat(530, 290, 70, 90, 'V', 'FP8', 'cyan'),
            mat(640, 290, 90, 90, 'O', 'FP32 acc', 'lime')
          ];
          ctx.text(145, 335, '·', { size: 22, color: 'white', anchor: 'middle', parent: A });
          ctx.line(236, 335, 284, 335, { color: 'dim', arrow: true, parent: A });
          ctx.line(386, 335, 414, 335, { color: 'dim', arrow: true, parent: A });
          ctx.text(520, 335, '·', { size: 22, color: 'white', anchor: 'middle', parent: A });
          ctx.line(606, 335, 634, 335, { color: 'dim', arrow: true, parent: A });
          ctx.text(400, 282, 'online softmax', { size: 11, font: 'mono', color: 'violet', anchor: 'middle', parent: A });
          ctx.text(60, 440, 'smooth K: subtract the token-mean → outliers vanish,', { size: 12, font: 'mono', color: 'text', parent: A });
          ctx.text(60, 460, 'softmax unchanged (constant shift per row)', { size: 12, font: 'mono', color: 'text', parent: A });
          /* Amdahl plot */
          var am = function (s) { return 1 / (0.21 + 0.79 / s); };
          var PL = ctx.plot(110, 520, 600, 230, am, { xDomain: [1, 5], yDomain: [1, 3.6], color: 'lime', sw: 2.4, yLabel: 'end-to-end speedup', parent: A });
          ctx.text(710, 788, 'attention kernel speedup s', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: A });
          [1, 2, 3, 4, 5].forEach(function (v) { ctx.text(PL.toPx(v, 1).x, 766, v + '×', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: A }); });
          [[2, 'Sage v1-ish'], [3, 'Sage v2-ish']].forEach(function (p) {
            var q = PL.toPx(p[0], am(p[0]));
            ctx.circle(q.x, q.y, 5, { fill: 'amber', parent: A, glow: true });
            ctx.text(q.x + 8, q.y + 16, am(p[0]).toFixed(2) + '×', { size: 12, font: 'mono', weight: 700, color: 'amber', parent: A });
          });
          ctx.text(700, 540, 'ceiling 1/(1 − 0.79) = 4.8×', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: A });
          /* sparse tile mask */
          var B = ctx.group({ parent: G });
          ctx.text(820, 250, 'SLIDING TILE ATTENTION · 24 tiles = 4 (t) × 3 (h) × 2 (w)', { size: 13, font: 'display', weight: 700, color: 'white', parent: B });
          var T = [];
          for (var t = 0; t < 4; t++) for (var h = 0; h < 3; h++) for (var w = 0; w < 2; w++) T.push([t, h, w]);
          var NT = T.length;
          function near(a, b) { return Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1; }
          var MX = 860, MY = 290, CS = 16;
          var dense = 0;
          for (var q1 = 0; q1 < NT; q1++) for (var k1 = 0; k1 < NT; k1++) if (near(T[q1], T[k1])) dense++;
          S.mask = ctx.matrix(MX, MY, NT, NT, { cell: CS - 2, gap: 2, values: function (r, c) { return near(T[r], T[c]) ? ctx.alpha('red', 0.45) : 'rgba(255,255,255,0.03)'; }, parent: B });
          ctx.text(MX + NT * CS / 2, MY + NT * CS + 18, 'key tiles →', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          var ql = ctx.text(MX - 10, MY + NT * CS / 2, 'query tiles', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          ql.setAttribute('transform', 'rotate(-90,' + (MX - 10) + ',' + (MY + NT * CS / 2) + ')');
          ctx.text(820, 716, 'kept: ' + dense + ' / ' + NT * NT + ' tile blocks = ' + Math.round(100 * dense / (NT * NT)) + ' % · window |Δt| ≤ 1, |Δh| ≤ 1, any w', { size: 12, font: 'mono', color: 'text', parent: B });
          /* 3-D neighbourhood view */
          var NV = ctx.group({ parent: B });
          ctx.text(1270, 290, 'query tile (white) + kept', { size: 11.5, font: 'mono', color: 'dim', parent: NV });
          ctx.text(1270, 306, 'h rows × w cols per t slab', { size: 11, font: 'mono', color: 'dim', parent: NV });
          var vt = [];
          for (var tt = 0; tt < 4; tt++) {
            ctx.text(1270, 346 + tt * 94, 't = ' + tt, { size: 11.5, font: 'mono', color: 'dim', parent: NV });
            for (var hh = 0; hh < 3; hh++) for (var ww = 0; ww < 2; ww++) {
              vt.push(ctx.rect(1330 + ww * 58, 322 + tt * 94 + hh * 25, 54, 22, { rx: 3, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('faint', 1), sw: 1, parent: NV }));
            }
          }
          S.rowHi = ctx.rect(MX - 2, MY - 1, NT * CS + 2, CS, { rx: 3, stroke: 'white', sw: 1.4, parent: B, glow: true });
          function selectQ(q) {
            S.rowHi.setAttribute('y', MY + q * CS - 1);
            for (var z = 0; z < NT; z++) {
              var isQ = z === q, nb = near(T[q], T[z]);
              vt[z].setAttribute('fill', isQ ? ctx.alpha('white', 0.8) : (nb ? ctx.alpha('red', 0.5) : 'rgba(255,255,255,0.03)'));
              vt[z].setAttribute('stroke', isQ ? ctx.C.white : (nb ? ctx.C.red : ctx.C.faint));
            }
          }
          for (var rr = 0; rr < NT; rr++) {
            (function (rr) {
              for (var cc = 0; cc < NT; cc++) {
                var cel = S.mask.cells[rr][cc];
                cel.style.cursor = 'pointer';
                cel.addEventListener('click', function () { selectQ(rr); });
              }
            })(rr);
          }
          ctx.para(820, 752, [
            'STA on HunyuanVideo 720p: 945 s → 685 s training-free, 268 s fine-tuned',
            'Sparse VideoGen: spatial vs temporal heads, ≈ 2.3× end-to-end',
            'keep global heads dense: identity of the fox across the shot lives there'
          ], { size: 12, font: 'mono', color: 'dim', parent: B, lh: 22 });
          selectQ(7);
          ctx.reveal(ms, { from: 'up', stagger: 120 });
          ctx.reveal(A, {});
          ctx.reveal(PL.curve, { from: 'draw', dur: 1000, delay: 600 });
          ctx.reveal(B, { from: 'right', delay: 400 });
          ctx.hud('attention 2× faster → 1.65× end-to-end (Amdahl)');
          var seq = [9, 0, 16, 23, 7];
          return seq.reduce(function (p, q) {
            return p.then(function () { selectQ(q); return ctx.wait(800); });
          }, ctx.wait(1400));
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Pools, pipelines, VAE',
        say: 'Now zoom out from one forward pass to the whole shot list. Stages have different appetites, so they run on different pools. A small pool encodes prompts, eight GPU gangs run the denoiser, a VAE pool decodes, and hardware encoders package the clips. While a gang denoises shot three, the VAE pool is decoding shot one. The VAE itself is split into overlapping tiles across GPUs, and decodes time causally in chunks. And drafts come first: a quick low resolution preview for the critic, before any expensive final render.',
        deep: '<p><b>Stage pools</b>: the DiT gang (8 GPUs, gang-scheduled, NVLink) is the scarce resource; the text encoder and VAE run on cheaper or shared GPUs so the gang never idles. Only latents move between pools (14.3 MB per shot at 720p), never pixels.</p>' +
          '<p><b>Tiled VAE decode</b>: split each latent frame spatially into overlapping tiles (e.g. 2×3 with 1/8 overlap), decode tiles on different GPUs (xDiT patch-parallel VAE / DistVAE) and feather-blend the overlaps to avoid seams. Estimate: ≈ 40 s on one GPU → ≈ 6 s on the 8-GPU pool (overlap recompute and halo exchange cost ~15 %):</p>' +
          '<div class="eq">x(p) = Σ<sub>k</sub> w<sub>k</sub>(p)·x<sub>k</sub>(p) / Σ<sub>k</sub> w<sub>k</sub>(p),   w<sub>k</sub> linear ramp over the overlap</div>' +
          '<p><b>Temporal causality</b>: Wan-style causal 3-D VAEs decode one latent frame at a time — latent 0 → 1 pixel frame, every later latent → 4 pixel frames — carrying a small cache of the last causal-conv inputs, so peak memory is bounded by one chunk rather than 121 frames (one full-resolution 96-channel activation of the whole clip would be ~21 GB in BF16).</p>' +
          '<p><b>Draft → refine</b>: a 480p, 4-step preview (48,360 tokens; attention ≈ 0.19× of 720p) lets the critic reject bad shots in seconds; approved drafts are refined at 720p, either with a full pass or SDEdit-style by re-noising the upsampled draft latent to t ≈ 0.6 and denoising only the remaining steps.</p>',
        run: function (ctx) {
          var S = ctx.state;
          setStrip(S, [0, 1, 2, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'STAGE POOLS, PIPELINING & TILED VAE', 'keep the scarce 8-GPU DiT gangs busy 100 % of the time', 'red');
          /* Gantt */
          var GT = ctx.group({ parent: G });
          var X0 = 240, SC = 14.4, Y0 = 262, RH = 50, TMAX = 50;
          var lanes = [['text enc · 1 GPU', 'amber'], ['DiT gang A · 8 GPU', 'lime'], ['DiT gang B · 8 GPU', 'lime'], ['VAE pool · 8 GPU', 'violet'], ['NVENC / mux', 'orange']];
          lanes.forEach(function (l, i) {
            ctx.text(X0 - 12, Y0 + i * RH + 18, l[0], { size: 12, font: 'mono', color: l[1], anchor: 'end', parent: GT });
            ctx.rect(X0, Y0 + i * RH, TMAX * SC, RH - 12, { rx: 4, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('faint', 0.7), sw: 1, parent: GT });
          });
          for (var s = 0; s <= TMAX; s += 10) ctx.text(X0 + s * SC, Y0 + 5 * RH + 4, s + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: GT });
          var SHC = ['cyan', 'violet', 'amber', 'pink', 'teal', 'orange'];
          var blocks = [];
          function blk(lane, t0, t1, shot, lab) {
            var r = ctx.group({ parent: GT });
            ctx.rect(X0 + t0 * SC + 1, Y0 + lane * RH + 3, Math.max(4, (t1 - t0) * SC - 2), RH - 18, { rx: 3, fill: ctx.alpha(SHC[shot], 0.45), stroke: SHC[shot], sw: 1, parent: r });
            if (lab && (t1 - t0) * SC > 34) ctx.text(X0 + (t0 + t1) / 2 * SC, Y0 + lane * RH + 18, lab, { size: 11, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: r });
            r.t0 = t0;
            blocks.push(r);
          }
          for (var k = 0; k < 6; k++) {
            var gang = k % 2, slot = Math.floor(k / 2);
            var te0 = slot * 12 + gang * 6;
            blk(0, te0, te0 + 0.3, k, '');
            var d0 = te0 + 0.3, d1 = d0 + 12;
            blk(1 + gang, d0, d1, k, 'shot ' + (k + 1));
            var v0 = d1, v1 = v0 + 5.8;
            blk(3, v0, v1, k, 'shot ' + (k + 1));
            blk(4, v1, v1 + 0.8, k, '');
          }
          ctx.text(X0, Y0 + 5 * RH + 30, 'illustrative fast path: ≈ 12 s DiT (4-step student, FP8 attn) + ≈ 6 s tiled VAE per shot;', { size: 11.5, font: 'mono', color: 'dim', parent: GT });
          ctx.text(X0, Y0 + 5 * RH + 48, 'two gangs finish a shot every 6 s, so an 8-GPU VAE pool at 6 s / shot keeps pace', { size: 11.5, font: 'mono', color: 'dim', parent: GT });
          /* VAE tiling */
          var VT = ctx.group({ parent: G });
          ctx.text(1060, 262, 'TILED + CAUSAL VAE DECODE', { size: 13, font: 'display', weight: 700, color: 'white', parent: VT });
          var FX = 1080, FY = 284, FW = 420, FH = 236;
          ctx.rect(FX, FY, FW, FH, { rx: 4, fill: '#081026', stroke: ctx.alpha('violet', 0.7), sw: 1.2, parent: VT });
          ctx.circle(FX + FW * 0.76, FY + FH * 0.3, 30, { fill: '#d2f3ff', opacity: 0.9, parent: VT });
          ctx.rect(FX + 1, FY + FH * 0.76, FW - 2, FH * 0.24 - 1, { rx: 0, fill: ctx.alpha('cyan', 0.3), parent: VT });
          ctx.circle(FX + FW * 0.3, FY + FH * 0.62, 26, { fill: '#ff8a3d', stroke: '#e8f1ff', sw: 2, parent: VT });
          var tiles = [];
          var tw = FW / 3, th = FH / 2, ov = 14;
          for (var ty = 0; ty < 2; ty++) for (var tx = 0; tx < 3; tx++) {
            var gi = ty * 3 + tx;
            var x = FX + tx * tw - (tx ? ov : 0), y = FY + ty * th - (ty ? ov : 0);
            var w = tw + (tx ? ov : 0) + (tx < 2 ? ov : 0), h = th + (ty ? ov : 0) + (ty < 1 ? ov : 0);
            var tg = ctx.group({ parent: VT });
            ctx.rect(x, y, Math.min(w, FX + FW - x), Math.min(h, FY + FH - y), { rx: 3, fill: ctx.alpha(HG[gi], 0.1), stroke: HG[gi], sw: 1.4, dash: '6 3', parent: tg });
            ctx.label(x + 36, y + 16, 'GPU ' + gi, { color: HG[gi], size: 11, parent: tg });
            tiles.push(tg);
          }
          ctx.text(FX, FY + FH + 20, '2 × 3 tiles, overlap feather-blended · xDiT patch-parallel VAE', { size: 11.5, font: 'mono', color: 'text', parent: VT });
          /* causal chunks */
          ctx.text(FX, FY + FH + 52, 'time: 1 frame, then 4 frames per latent frame + causal cache', { size: 11.5, font: 'mono', color: 'dim', parent: VT });
          var chunks = [];
          for (var c = 0; c < 9; c++) {
            var cw = c === 0 ? 14 : 40;
            var cx0 = FX + (c === 0 ? 0 : 20 + (c - 1) * 46);
            chunks.push(ctx.rect(cx0, FY + FH + 66, cw, 18, { rx: 3, fill: ctx.alpha('violet', 0.5), stroke: 'violet', sw: 1, parent: VT }));
          }
          /* draft → refine */
          var DR = ctx.group({ parent: G });
          ctx.text(60, 604, 'DRAFT → REFINE', { size: 13, font: 'display', weight: 700, color: 'white', parent: DR });
          var n1 = ctx.node({ x: 170, y: 680, w: 210, h: 64, title: 'draft 480p', sub: '4 steps · ≈ 5–7 s', color: 'cyan', titleSize: 14, subSize: 11, parent: DR });
          var n2 = ctx.node({ x: 450, y: 680, w: 210, h: 64, title: 'critic / creator', sub: 'approve or re-prompt', icon: 'eye', color: 'magenta', titleSize: 14, subSize: 11, parent: DR });
          var n3 = ctx.node({ x: 760, y: 680, w: 250, h: 64, title: 'refine 720p', sub: 're-noise to t≈0.6, denoise', color: 'lime', titleSize: 14, subSize: 11, parent: DR });
          var d1l = ctx.link(n1, n2, { from: 'r', to: 'l', color: 'cyan', parent: DR });
          var d2l = ctx.link(n2, n3, { from: 'r', to: 'l', color: 'lime', label: 'approved', parent: DR });
          var d3l = ctx.link(n2, n1, { from: 'b', to: 'b', color: 'magenta', bend: { x: 310, y: 790 }, dash: '4 4', label: 'rejected: new seed', labelDy: 26, parent: DR });
          ctx.text(60, 838, 'the critic kills bad shots at draft cost, not final cost', { size: 12, font: 'mono', color: 'dim', parent: DR });
          blocks.forEach(function (b) { b.setAttribute('opacity', 0); });
          ctx.reveal(GT, { from: 'up' });
          ctx.reveal(VT, { from: 'right', delay: 300 });
          ctx.reveal(DR, { from: 'up', delay: 600 });
          ctx.reveal([d1l, d2l, d3l], { from: 'draw', delay: 900, stagger: 150 });
          ctx.hud('DiT gangs stay busy; VAE and encode overlap');
          return ctx.wait(1000).then(function () {
            return ctx.tween(3600, function (t) {
              var now = t * TMAX;
              blocks.forEach(function (b) { if (b.t0 <= now) b.setAttribute('opacity', 1); });
            }, 'linear');
          }).then(function () {
            return Promise.all(tiles.map(function (tg, i) { return ctx.pulse(tg, { color: HG[i], dur: 600 }); }));
          }).then(function () {
            return ctx.packet(d1l, { color: 'cyan', dur: 500 }).then(function () { return ctx.packet(d2l, { color: 'lime', dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'The speedup ladder',
        say: 'Here is the whole ladder for one five second shot. On a single GPU with fifty guided steps, about fifty four minutes. Eight GPUs with guidance and sequence parallelism: under eight minutes. Step caching nearly halves that, and quantized attention takes it to around two and a half minutes. Switch to a four step distilled student and the denoiser needs about twelve seconds, twenty with decoding. A low resolution draft appears in a few seconds. That is how an agent can afford to iterate on a film.',
        deep: '<p>Modelled from the FLOP budget (H100, 40 % MFU); each rung uses a published technique, gains are typical rather than guaranteed:</p>' +
          '<table><tr><th>rung</th><th>per shot</th><th>×</th></tr>' +
          '<tr><td>1 GPU, 50 steps, CFG, BF16</td><td>3,260 s</td><td>—</td></tr>' +
          '<tr><td>8 GPUs: CFG 2 × Ulysses 4 (≈ 88 % eff.)</td><td>463 s</td><td>7.0</td></tr>' +
          '<tr><td>+ TeaCache (≈ 1.8×)</td><td>257 s</td><td>1.8</td></tr>' +
          '<tr><td>+ FP8/INT8 attention (s = 2 → Amdahl 1.65×)</td><td>156 s</td><td>1.65</td></tr>' +
          '<tr><td>4-step CFG-free student, Ulysses 8, FP8 attn, + ≈ 6 s tiled VAE</td><td>≈ 20 s</td><td>≈ 7.8</td></tr>' +
          '<tr><td>480p draft, 4 steps</td><td>≈ 5–7 s</td><td></td></tr></table>' +
          '<p>Student arithmetic: 3,260 s × 4/100 = 130 s on one GPU → ÷ (8 × 0.85) ≈ 19 s → ÷ 1.65 ≈ 12 s of DiT, + ≈ 6 s VAE + ≈ 1 s encode/mux.</p>' +
          '<p>Not everything multiplies: caching and students overlap (both exploit step redundancy); sparse attention and SP interact (sparsity makes per-GPU compute smaller, so communication share grows). Measure end to end.</p>' +
          '<div class="note">For the 30 s trailer (6 shots): two DiT gangs plus the VAE pool finish the fast-path cut in ≈ 50 s (Gantt of the previous step); the critic sends two hero shots back to the teacher path (≈ 2.6 min each on its own gang). GPU budget: 18 drafts ≈ 0.24 GPU-h, 6 finals ≈ 0.24, 2 hero re-renders ≈ 0.69 — ≈ 1.2 GPU-h versus 5.4 naive — the same ≈ 76 GPU-min the overview books as 6 shots × 8 GPUs × ~95 s.</div>',
        run: function (ctx) {
          var S = ctx.state;
          setStrip(S, [0, 1, 2, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'THE SPEEDUP LADDER — ONE 5 s 720p SHOT', 'modelled wall-clock from the FLOP budget (H100, 40 % MFU) · each rung is a published technique', 'red');
          var LX = 520, DEC = 160;
          function lx(sec) { return LX + Math.log10(sec) * DEC; }
          var AX = ctx.group({ parent: G });
          [[1, '1 s'], [10, '10 s'], [60, '1 min'], [600, '10 min'], [3600, '1 h']].forEach(function (t) {
            ctx.line(lx(t[0]), 250, lx(t[0]), 668, { color: ctx.alpha('faint', 0.6), sw: 1, dash: '2 5', parent: AX });
            ctx.text(lx(t[0]), 686, t[1], { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: AX });
          });
          ctx.text(lx(3600), 706, 'log scale', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: AX });
          var rungs = [
            ['1× H100 · 50 steps · CFG · BF16', 3260, '54 min', 'red', ''],
            ['8× H100 · CFG 2 × Ulysses 4', 463, '7.7 min', 'orange', '÷ 7.0'],
            ['+ TeaCache step caching', 257, '4.3 min', 'amber', '÷ 1.8'],
            ['+ FP8/INT8 attention (Sage)', 156, '2.6 min', 'amber', '÷ 1.65'],
            ['4-step student · 8 GPUs · + VAE', 20, '≈ 20 s', 'lime', '÷ 7.8'],
            ['480p draft preview · 4 steps', 6, '≈ 6 s', 'cyan', 'preview']
          ];
          S.rb = [];
          rungs.forEach(function (r, i) {
            var y = 262 + i * 68;
            ctx.text(60, y + 16, r[0], { size: 13.5, font: 'mono', color: 'text', parent: G });
            var w = lx(r[1]) - LX;
            var b = ctx.rect(LX, y, w, 32, { rx: 5, fill: ctx.alpha(r[3], 0.45), stroke: r[3], sw: 1.2, parent: G, glow: i === 4 });
            var t = ctx.text(LX + w + 12, y + 16, r[2], { size: 15, font: 'mono', weight: 700, color: r[3], parent: G });
            var m = r[4] ? ctx.label(LX - 44, y + 16, r[4], { color: r[3], size: 11, parent: G }) : null;
            S.rb.push({ b: b, w: w, t: t, m: m });
          });
          var R = ctx.group({ parent: G });
          ctx.rect(1170, 250, 370, 420, { rx: 12, fill: ctx.alpha('lime', 0.04), stroke: ctx.alpha('lime', 0.5), sw: 1.2, parent: R });
          ctx.text(1190, 278, 'THE TRAILER · 6 SHOTS · 30 s', { size: 13, font: 'display', weight: 700, color: 'lime', parent: R });
          ctx.para(1190, 310, [
            'fast path: 2 DiT gangs + VAE pool',
            '  → whole cut in ≈ 50 s',
            'critic re-renders 2 hero shots',
            '  on the teacher path (≈ 2.6 min',
            '  each, on a third gang)'
          ], { size: 13, font: 'mono', color: 'text', parent: R, lh: 23 });
          ctx.text(1190, 440, 'GPU-HOURS FOR THE TRAILER', { size: 12, font: 'mono', color: 'dim', parent: R });
          var GH = 330 / 5.4;
          ctx.text(1190, 466, 'naive', { size: 11.5, font: 'mono', color: 'dim', parent: R });
          var ghN = ctx.rect(1190, 476, 5.4 * GH, 22, { rx: 4, fill: ctx.alpha('red', 0.45), stroke: 'red', sw: 1, parent: R });
          ctx.text(1190 + 5.4 * GH - 8, 487, '5.4 GPU-h', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: R });
          ctx.text(1190, 520, 'served', { size: 11.5, font: 'mono', color: 'dim', parent: R });
          var parts = [[0.24, 'cyan', 'drafts'], [0.24, 'lime', 'finals'], [0.69, 'amber', 'hero']];
          var gx = 1190, ghS = [];
          parts.forEach(function (p) {
            ghS.push(ctx.rect(gx, 530, p[0] * GH - 1, 22, { rx: 3, fill: ctx.alpha(p[1], 0.55), stroke: p[1], sw: 1, parent: R }));
            gx += p[0] * GH;
          });
          ctx.text(gx + 10, 541, '≈ 1.2 GPU-h', { size: 12, font: 'mono', weight: 700, color: 'lime', parent: R });
          parts.forEach(function (p, i) {
            var lx0 = 1190 + i * 112;
            ctx.rect(lx0, 572, 12, 12, { rx: 2, fill: ctx.alpha(p[1], 0.55), stroke: p[1], sw: 1, parent: R });
            ctx.text(lx0 + 18, 578, p[2] + ' ' + p[0].toFixed(2), { size: 11, font: 'mono', color: 'text', parent: R });
          });
          ctx.text(1190, 612, '18 drafts (3 per shot) · 6 fast finals', { size: 11, font: 'mono', color: 'dim', parent: R });
          ctx.text(1190, 632, '2 hero shots × 156 s × 8 GPUs', { size: 11, font: 'mono', color: 'dim', parent: R });
          ctx.text(60, 750, 'not everything multiplies: caching and students both mine step redundancy; sparsity shrinks per-GPU compute so SP comm grows', { size: 12.5, font: 'mono', color: 'dim', parent: G });
          ctx.text(60, 776, 'the orchestration plane chooses the rung per call: drafts for exploration, students for most finals, teacher for hero shots', { size: 12.5, font: 'mono', color: 'dim', parent: G });
          S.rb.forEach(function (r) { r.b.setAttribute('width', 0); r.t.setAttribute('opacity', 0); if (r.m) r.m.setAttribute('opacity', 0); });
          ctx.reveal(AX, {});
          ctx.reveal(R, { from: 'right', delay: 400 });
          ctx.hud('54 min → ≈ 20 s per shot (≈ 160×)');
          return S.rb.reduce(function (p, r) {
            return p.then(function () {
              if (r.m) ctx.reveal(r.m, { from: 'scale', dur: 300 });
              return ctx.animate(r.b, { width: [0, r.w] }, 700, 'out').then(function () { return ctx.reveal(r.t, { dur: 250 }); });
            });
          }, ctx.wait(600)).then(function () {
            ctx.pulse(ghN, { color: 'red', dur: 500 });
            return Promise.all(ghS.map(function (e) { return ctx.pulse(e, { color: 'lime', dur: 600 }); }));
          });
        }
      }
    ]
  });
})();
