/* L2 — How an LLM Learns to Be an Agent. The training pipeline: pretraining (next-token CE, 6ND, Chinchilla,
 * data), mid-training (annealing, long context), SFT with loss masking on tool trajectories, preference
 * optimisation (RLHF/PPO, DPO), RL with verifiable rewards (GRPO, emergent long CoT), agentic multi-turn RL,
 * and distillation into small fast models. */
(function () {
  var STAGES = [
    ['Pretrain', 'next-token CE', '10–40 T tokens', 'web · code · books', 'amber'],
    ['Mid-train', 'anneal · long ctx', '~0.1–1 T tokens', 'code · math · 128k', 'orange'],
    ['SFT', 'imitation', '10⁵–10⁶ dialogs', 'tool-use traces', 'cyan'],
    ['Preference', 'RLHF · DPO', '10⁵–10⁶ pairs', 'chosen vs rejected', 'violet'],
    ['RLVR', 'GRPO · PPO', 'math · code', 'verifiable reward', 'lime'],
    ['Agentic RL', 'multi-turn', 'tools · sandboxes', 'task success', 'magenta'],
    ['Distill', 'teacher → student', 'teacher traces', 'small fast models', 'teal']
  ];

  function boxOf(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }

  function keepWS(root) {
    Array.prototype.forEach.call(root.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
  }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    if (title) ctx.text(x + 16, y + 22, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = boxOf(x, y, w, h);
    return g;
  }

  function textCard(ctx, parent, x, y, w, h, color, title, lines, o) {
    o = o || {};
    var g = card(ctx, parent, x, y, w, h, color, title);
    ctx.para(x + 18, y + (o.top || 56), lines, { size: o.size || 14, font: 'mono', color: 'text', lh: o.lh || 30, parent: g });
    keepWS(g);
    return g;
  }

  function page(ctx, S) {
    (S.loops || []).forEach(function (l) { l.stop(); });
    S.loops = [];
    if (S.page) ctx.remove(S.page, 450);
    S.page = ctx.group();
    return S.page;
  }

  Atlas.register({
    id: 'training',
    refs: [
      'Hoffmann et al., <i>Training Compute-Optimal Large Language Models</i> (Chinchilla), NeurIPS 2022; Besiroglu et al., <i>Chinchilla Scaling: A Replication Attempt</i>, 2024',
      'Llama Team, Meta AI, <i>The Llama 3 Herd of Models</i>, 2024; Penedo et al., <i>The FineWeb Datasets</i>, NeurIPS 2024',
      'Ouyang et al., <i>Training Language Models to Follow Instructions with Human Feedback</i> (InstructGPT), NeurIPS 2022',
      'Rafailov et al., <i>Direct Preference Optimization: Your Language Model is Secretly a Reward Model</i>, NeurIPS 2023',
      'Shao et al., <i>DeepSeekMath</i> (GRPO), 2024; DeepSeek-AI, <i>DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning</i>, 2025',
      'Yu et al., <i>DAPO: An Open-Source LLM Reinforcement Learning System at Scale</i>, 2025; Liu et al., <i>Understanding R1-Zero-Like Training</i> (Dr. GRPO), 2025',
      'Kimi Team, <i>Kimi K2: Open Agentic Intelligence</i>, 2025; Baker et al. (OpenAI), <i>Monitoring Reasoning Models for Misbehavior</i>, 2025',
      'Agarwal et al., <i>On-Policy Distillation of Language Models: Learning from Self-Generated Mistakes</i> (GKD), ICLR 2024'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'The pipeline',
        say: 'The director agent planning our fox astronaut trailer was not programmed to plan. It was trained, in stages. Pretraining on tens of trillions of tokens teaches language and world knowledge. Mid training sharpens code, math and long context. Supervised fine tuning teaches the chat format and tool calls. Preference optimization shapes style and safety. Reinforcement learning with verifiable rewards teaches reasoning, agentic reinforcement learning teaches multi step tool use, and distillation packs it all into smaller, faster models.',
        deep: '<table><tr><th>Stage</th><th>Signal</th><th>What it adds for our crew</th></tr>' +
          '<tr><td>Pretraining</td><td>next-token CE on 10–40 T tokens</td><td>language, world and visual-concept knowledge</td></tr>' +
          '<tr><td>Mid-training</td><td>CE, annealed LR, curated mix</td><td>code, math, 128k context for long agent transcripts</td></tr>' +
          '<tr><td>SFT</td><td>masked CE on demonstrations</td><td>chat format, instruction following, valid tool JSON</td></tr>' +
          '<tr><td>Preference</td><td>RM + PPO, or DPO</td><td>helpfulness, style, refusals</td></tr>' +
          '<tr><td>RLVR</td><td>verifier rewards, GRPO</td><td>long chain-of-thought reasoning</td></tr>' +
          '<tr><td>Agentic RL</td><td>multi-turn task success</td><td>plan → call tools → recover from errors</td></tr>' +
          '<tr><td>Distillation</td><td>teacher traces / logits</td><td>cheap critic and router models</td></tr></table>' +
          '<p>Pretraining still dominates FLOPs in most published recipes, but 2025 frontier labs report RL compute growing to a substantial fraction. Stages are often iterated (Llama 3 ran six rounds of SFT + rejection sampling + DPO). The compute bar shown is illustrative.</p>',
        run: function (ctx) {
          var S = ctx.state;
          S.loops = [];
          var g = S.page = ctx.group();
          ctx.text(60, 176, 'FROM RANDOM WEIGHTS TO A TOOL-USING AGENT', { size: 12, font: 'mono', color: 'dim', spacing: 1, parent: g });
          /* phase braces */
          ctx.path('M55,222 V212 H462 V222', { stroke: ctx.alpha('amber', 0.6), sw: 1.4, parent: g });
          ctx.text(258, 202, 'pre-training (self-supervised)', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
          ctx.path('M488,222 V212 H1547 V222', { stroke: ctx.alpha('magenta', 0.6), sw: 1.4, parent: g });
          ctx.text(1017, 202, 'post-training (supervised + reinforcement)', { size: 12, font: 'mono', color: 'magenta', anchor: 'middle', parent: g });
          S.track = ctx.path('M60,250 H1540', { stroke: ctx.alpha('white', 0.12), sw: 1.2, dash: '3 6', parent: g });
          S.nodes = STAGES.map(function (s, i) {
            var x = 150 + i * 217;
            var n = ctx.node({ x: x, y: 306, w: 190, h: 70, title: s[0], sub: s[1], color: s[4], titleSize: 17, subSize: 12, parent: g });
            ctx.text(x, 364, s[2], { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: g });
            ctx.text(x, 384, s[3], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            return n;
          });
          for (var i = 0; i < 6; i++) ctx.link(S.nodes[i], S.nodes[i + 1], { color: ctx.alpha('white', 0.4), sw: 1.3, parent: g });
          ctx.reveal(S.nodes, { from: 'up', stagger: 110 });

          /* compute share bar (illustrative) */
          var cb = ctx.group({ parent: g });
          ctx.text(60, 430, 'SHARE OF TRAINING COMPUTE (illustrative 2025 recipe)', { size: 12, font: 'mono', color: 'dim', spacing: 1, parent: cb });
          var share = [0.72, 0.07, 0.01, 0.02, 0.09, 0.07, 0.02], x0 = 60;
          S.shareBars = share.map(function (f, k) {
            var w = f * 1480;
            var r = ctx.rect(x0, 446, Math.max(2, w - 2), 30, { rx: 3, fill: ctx.alpha(STAGES[k][4], 0.5), stroke: STAGES[k][4], sw: 1, parent: cb });
            if (w > 90) ctx.text(x0 + w / 2, 461, STAGES[k][0], { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: cb });
            x0 += w;
            return r;
          });
          ctx.text(1540, 494, 'RL share rising fast: long rollouts are expensive', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: cb });
          ctx.reveal(cb, { delay: 900 });

          var B = textCard(ctx, g, 60, 520, 1480, 340, 'amber', 'WHAT EACH STAGE GIVES OUR FILM CREW', [
            'pretrain + mid-train  →  knows what a "low-angle dolly shot" is; holds a 12k-token plan in context',
            'SFT                   →  follows the director\'s instructions; emits valid render_shot(...) JSON',
            'preference            →  helpful, concise, safe; declines disallowed content',
            'RLVR                  →  reasons step by step: 6 shots × 5 s = 30 s, checks continuity',
            'agentic RL            →  calls tools, reads results, retries a failed render, knows when to stop',
            'distillation          →  a small, fast critic model that scores every rendered shot'
          ], { lh: 42, top: 64 });
          ctx.reveal(B, { from: 'up', delay: 1200 });

          S.theta = ctx.group({ parent: g });
          ctx.circle(0, 0, 13, { fill: ctx.alpha('white', 0.15), stroke: 'white', sw: 1.5, parent: S.theta, glow: true });
          ctx.text(0, 1, 'θ', { size: 15, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: S.theta });
          ctx.place(S.theta, 1500, 250);
          if (ctx.instant) return Promise.resolve();
          ctx.place(S.theta, 60, 250);
          var lastK = -1;
          return ctx.wait(1300).then(function () {
            return ctx.tween(4200, function (t) {
              var x = 60 + t * 1440;
              ctx.place(S.theta, x, 250);
              var k = Math.round((x - 150) / 217);
              if (k >= 0 && k < 7 && Math.abs(x - (150 + k * 217)) < 12 && k !== lastK) { lastK = k; ctx.pulse(S.nodes[k], { color: STAGES[k][4], dur: 500 }); }
            }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Pretraining',
        say: 'Pretraining has one objective, applied trillions of times: predict the next token. Feed the model a sentence, shift it by one position, and at every position take the negative log probability it assigned to the true next token. Rare continuations like fox after the are expensive; easy ones like on after lands are cheap. Averaged over tens of trillions of tokens this simple loss forces the model to learn grammar, facts and even physics of the world. The cost is roughly six times parameters times tokens.',
        deep: '<div class="eq">L(θ) = −(1/T) Σ<sub>t</sub> log p<sub>θ</sub>(x<sub>t+1</sub> | x<sub>≤t</sub>), &nbsp; perplexity = e<sup>L</sup></div>' +
          '<div class="eq">C ≈ 6·N·D &nbsp; (2ND forward + 4ND backward)</div>' +
          '<table><tr><th>Model</th><th>N</th><th>D</th><th>Compute</th></tr>' +
          '<tr><td>Llama 3 405B</td><td>405 B dense</td><td>15.6 T</td><td>≈ 3.8×10<sup>25</sup> FLOPs; 30.8 M H100-hours</td></tr>' +
          '<tr><td>DeepSeek-V3</td><td>37 B active / 671 B</td><td>14.8 T</td><td>2.79 M H800-hours (full training)</td></tr>' +
          '<tr><td>Qwen3</td><td>up to 235 B-A22B</td><td>36 T</td><td>—</td></tr></table>' +
          '<p>Teacher forcing makes all T predictions parallel in one pass (causal mask). Training runs in BF16 (or FP8 GEMMs, as in DeepSeek-V3) with FP32 master weights and AdamW, sharded over thousands of GPUs with data, tensor, pipeline, expert and context parallelism; Llama 3 reports 38–43% MFU. Loss spikes are handled with z-loss, QK-norm, gradient clipping and restarts from checkpoints.</p>' +
          '<p class="muted">Per-token probabilities shown are illustrative.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var toks = ['The', 'fox', 'astronaut', 'crash', '-', 'lands', 'on', 'a', 'glowing', 'ice', 'moon'];
          var P = [0.04, 0.21, 0.08, 0.35, 0.62, 0.71, 0.55, 0.12, 0.30, 0.58];
          var L = card(ctx, g, 60, 176, 900, 390, 'amber', 'TEACHER FORCING · every position predicts the next token');
          function chipAt(x, y, s, col) {
            var c = ctx.group({ parent: L });
            ctx.rect(x - 36, y - 12, 72, 24, { rx: 5, fill: ctx.alpha(col, 0.14), stroke: ctx.alpha(col, 0.7), sw: 1, parent: c });
            ctx.text(x, y + 0.5, s, { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: c });
            return c;
          }
          ctx.text(102, 236, 'in', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          ctx.text(102, 300, 'next', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          S.inC = []; S.tgC = []; S.lb = []; S.lt = [];
          for (var i = 0; i < 10; i++) {
            var x = 146 + i * 80;
            S.inC.push(chipAt(x, 236, toks[i], 'cyan'));
            S.tgC.push(chipAt(x, 300, toks[i + 1], 'amber'));
            ctx.line(x, 250, x, 286, { color: ctx.alpha('white', 0.25), sw: 1, arrow: true, parent: L });
            ctx.text(x, 326, 'p=' + P[i].toFixed(2), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
            var loss = -Math.log(P[i]);
            S.lb.push({ r: ctx.rect(x - 22, 520, 44, 0, { rx: 3, fill: ctx.alpha('red', 0.5), stroke: 'red', sw: 1, parent: L }), h: loss * 44 });
            S.lt.push(ctx.text(x, 520 - loss * 44 - 10, loss.toFixed(2), { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: L }));
          }
          ctx.line(96, 520, 940, 520, { color: ctx.alpha('white', 0.3), parent: L });
          ctx.text(96, 544, '−log p(target) per position', { size: 12, font: 'mono', color: 'red', parent: L });
          var mean = P.reduce(function (a, p) { return a - Math.log(p); }, 0) / 10;
          S.meanT = ctx.text(940, 544, 'mean loss = ' + mean.toFixed(2) + '  ·  perplexity ' + Math.exp(mean).toFixed(1), { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: L });
          S.cursor = ctx.rect(106, 220, 80, 116, { rx: 6, stroke: 'white', sw: 1.6, parent: L, glow: true });
          S.cursor.setAttribute('opacity', 0);
          ctx.reveal(L, { from: 'left' });

          var R = card(ctx, g, 990, 176, 550, 390, 'amber', 'LOSS vs TOKENS SEEN (log)');
          S.curve = ctx.plot(1050, 230, 450, 270, function (x) { return 1.82 + 2085.43 / Math.pow(10, 0.3658 * x); }, { xDomain: [9, 13.2], yDomain: [1.8, 3.0], color: 'amber', sw: 2.5, parent: R });
          [[9, '1B'], [10, '10B'], [11, '100B'], [12, '1T'], [13, '10T']].forEach(function (t) { var p = S.curve.toPx(t[0], 1.8); ctx.text(p.x, 516, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: R }); });
          [2.0, 2.4, 2.8].forEach(function (v) { var p = S.curve.toPx(9, v); ctx.text(1040, p.y, v.toFixed(1), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: R }); });
          ctx.text(1500, 548, 'L(D) = E + B / D^β   (β ≈ 0.37)', { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: R });
          S.curve.curve.setAttribute('opacity', 0);
          ctx.reveal(R, { from: 'right', delay: 200 });

          var B = textCard(ctx, g, 60, 590, 1480, 270, 'orange', 'COMPUTE', [
            'C ≈ 6 · N · D     (2ND forward + 4ND backward, dense transformer)',
            'Llama 3 405B:  6 × 405e9 × 15.6e12 ≈ 3.8 × 10²⁵ FLOPs  →  30.8 M H100-hours reported, ~40% MFU',
            'DeepSeek-V3:   37 B active × 14.8 T tokens, FP8 GEMMs  →  2.79 M H800-hours for the whole run',
            'same objective at every one of those ~10¹³ positions: −log p_θ(x_{t+1} | x_≤t)'
          ], { lh: 44, top: 64 });
          ctx.reveal(B, { from: 'up', delay: 400 });

          function bars(t) { S.lb.forEach(function (b) { var h = b.h * t; b.r.setAttribute('y', 520 - h); b.r.setAttribute('height', h); }); S.lt.forEach(function (x) { x.setAttribute('opacity', t >= 1 ? 1 : 0); }); }
          if (ctx.instant) { bars(1); S.curve.curve.setAttribute('opacity', 1); return Promise.resolve(); }
          bars(0);
          S.meanT.setAttribute('opacity', 0);
          return ctx.wait(800).then(function () {
            S.cursor.setAttribute('opacity', 1);
            return ctx.tween(3000, function (t) {
              var k = Math.min(9, Math.floor(t * 10));
              S.cursor.setAttribute('x', 106 + k * 80);
              S.lb.forEach(function (b, j) { var h = j < k ? b.h : (j === k ? b.h * (t * 10 - k) : 0); b.r.setAttribute('y', 520 - h); b.r.setAttribute('height', h); });
              S.lt.forEach(function (x, j) { x.setAttribute('opacity', j < k ? 1 : 0); });
            }, 'linear');
          }).then(function () {
            bars(1); S.cursor.setAttribute('opacity', 0);
            ctx.reveal(S.meanT, {});
            S.curve.curve.setAttribute('opacity', 1);
            return ctx.reveal(S.curve.curve, { from: 'draw', dur: 1400 });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Scaling & data',
        say: 'How big, and how long? The Chinchilla study fit loss as a function of parameters and tokens and found that, for a fixed compute budget, the optimum is roughly twenty tokens per parameter. Modern models deliberately overtrain far past that point, because a smaller model trained longer is much cheaper to serve to millions of agent calls. The data matters as much as the size: web crawls are extracted, filtered by quality classifiers, deduplicated with MinHash, decontaminated, and mixed with code and math.',
        deep: '<div class="eq">L(N, D) = E + A/N<sup>α</sup> + B/D<sup>β</sup>, &nbsp; C = 6ND</div>' +
          '<p>Fit (Besiroglu et al. replication of Chinchilla): E = 1.82, A = 482, B = 2085, α = 0.348, β = 0.366. Minimising at fixed C gives N<sub>opt</sub> ∝ C<sup>0.51</sup>, D<sub>opt</sub> ∝ C<sup>0.49</sup>, i.e. ~20 tokens/param; at Chinchilla’s 5.76×10<sup>23</sup> FLOPs the fit gives N ≈ 72 B, D ≈ 1.3 T (Chinchilla itself: 70 B on 1.4 T).</p>' +
          '<p><b>Overtraining</b> is inference-optimal: Llama 3 8B saw 15 T tokens (~1,900 tokens/param); DeepSeek-V3 ~400 tokens per <i>active</i> param. Loss keeps improving log-linearly well past the Chinchilla point.</p>' +
          '<ul><li><b>Filtering</b>: heuristic rules + model-based classifiers (e.g. FineWeb-Edu’s educational-value classifier) over 96 Common Crawl snapshots → 15 T tokens.</li>' +
          '<li><b>Dedup</b>: exact/URL, MinHash-LSH near-duplicates (5-gram shingles), suffix-array substring removal: less memorisation, better generalisation.</li>' +
          '<li><b>Decontamination</b> against benchmarks, PII and safety filtering.</li>' +
          '<li><b>Mixture</b> (Llama 3 final): ~50% general knowledge, 25% math and reasoning, 17% code, 8% multilingual; weights tuned with small proxy models.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var C = 5.76e23;
          function lossAt(lgN) { var N = Math.pow(10, lgN), D = C / (6 * N); return 1.82 + 482.01 / Math.pow(N, 0.3478) + 2085.43 / Math.pow(D, 0.3658); }
          var L = card(ctx, g, 60, 176, 720, 390, 'amber', 'ISO-FLOP CURVE · C = 5.76e23 (Chinchilla budget)');
          S.iso = ctx.plot(130, 226, 610, 270, lossAt, { xDomain: [9.5, 12], yDomain: [1.96, 2.09], color: 'amber', sw: 2.5, parent: L, samples: 100 });
          [[10, '10B'], [10.5, '32B'], [11, '100B'], [11.5, '316B'], [12, '1T']].forEach(function (t) { var p = S.iso.toPx(t[0], 1.96); ctx.text(p.x, 512, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: L }); });
          [1.98, 2.02, 2.06].forEach(function (v) { var p = S.iso.toPx(9.5, v); ctx.text(122, p.y, v.toFixed(2), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L }); });
          ctx.text(740, 534, 'parameters N (log) · D = C / 6N', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          var best = 9.5, bl = 9;
          for (var q = 9.5; q <= 12; q += 0.01) { var v = lossAt(q); if (v < bl) { bl = v; best = q; } }
          var bp = S.iso.toPx(best, bl);
          S.opt = ctx.group({ parent: L });
          ctx.circle(bp.x, bp.y, 7, { fill: 'white', parent: S.opt, glow: true });
          ctx.text(bp.x, bp.y + 26, 'optimum N ≈ ' + Math.round(Math.pow(10, best) / 1e9) + ' B, D ≈ ' + (C / 6 / Math.pow(10, best) / 1e12).toFixed(1) + ' T  (~' + Math.round(C / 6 / Math.pow(10, 2 * best)) + ' tok/param)', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.opt });
          ctx.text(200, 250, 'too small: under-fit', { size: 11, font: 'mono', color: 'dim', parent: L });
          ctx.text(730, 250, 'too big: under-trained', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          S.iso.curve.setAttribute('opacity', 0);
          S.opt.setAttribute('opacity', 0);
          ctx.reveal(L, { from: 'left' });

          var R = card(ctx, g, 810, 176, 730, 390, 'orange', 'TOKENS PER PARAMETER (log): overtraining');
          var rows = [['Chinchilla 70B', 20], ['Llama 2 70B', 29], ['Llama 3 70B', 214], ['DeepSeek-V3 (active)', 400], ['Llama 3 8B', 1875]];
          function lx(v) { return 1030 + Math.log10(v) / 4 * 480; }
          S.tp = rows.map(function (r, i) {
            var y = 226 + i * 60;
            ctx.text(1016, y + 13, r[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: R });
            var b = ctx.rect(1030, y, 0, 26, { rx: 4, fill: ctx.alpha(i === 0 ? 'white' : 'orange', 0.45), stroke: i === 0 ? 'white' : 'orange', sw: 1, parent: R });
            var t = ctx.text(1036, y + 13, String(r[1]), { size: 12, font: 'mono', color: 'white', parent: R });
            return { b: b, t: t, w: lx(r[1]) - 1030 };
          });
          var cx = lx(20);
          ctx.line(cx, 216, cx, 520, { color: ctx.alpha('white', 0.5), dash: '4 4', parent: R });
          ctx.text(cx + 6, 536, 'compute-optimal ≈ 20', { size: 11, font: 'mono', color: 'white', parent: R });
          ctx.text(1520, 552, 'smaller + longer = cheaper to serve', { size: 12, font: 'mono', color: 'orange', anchor: 'end', parent: R });
          ctx.reveal(R, { from: 'right', delay: 200 });

          var B = card(ctx, g, 60, 590, 1480, 270, 'teal', 'DATA PIPELINE (web → training mix)');
          var steps = [['Common Crawl', '96 snapshots', 250], ['extract + lang-ID', 'HTML → text', 220], ['quality filter', 'rules + classifier', 190], ['dedup', 'MinHash-LSH', 160], ['PII · safety', 'decontaminate', 140], ['mixture', '50/25/17/8 %', 170]];
          var xx = 80;
          S.dn = steps.map(function (s, i) {
            var n = ctx.node({ x: xx + s[2] / 2, y: 690, w: s[2], h: 80 - i * 6, title: s[0], sub: s[1], color: 'teal', titleSize: 14, subSize: 11, parent: B });
            xx += s[2] + 44;
            return n;
          });
          S.dl = [];
          for (var k = 0; k < 5; k++) S.dl.push(ctx.link(S.dn[k], S.dn[k + 1], { color: ctx.alpha('teal', 0.7), sw: 1.4, parent: B }));
          ctx.text(800, 790, 'FineWeb: 15 T tokens survive from 96 crawls · Llama 3 mix: 50% general · 25% math/reasoning · 17% code · 8% multilingual', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: B });
          ctx.text(800, 820, 'dedup reduces memorisation; decontamination keeps benchmark scores honest; mix weights tuned on small proxy models', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          ctx.reveal(B, { from: 'up', delay: 400 });

          function grow(t) { S.tp.forEach(function (e) { e.b.setAttribute('width', e.w * t); e.t.setAttribute('x', 1036 + e.w * t); }); }
          if (ctx.instant) { S.iso.curve.setAttribute('opacity', 1); S.opt.setAttribute('opacity', 1); grow(1); return Promise.resolve(); }
          grow(0);
          return ctx.wait(700).then(function () {
            S.iso.curve.setAttribute('opacity', 1);
            return ctx.reveal(S.iso.curve, { from: 'draw', dur: 1300 });
          }).then(function () {
            return ctx.reveal(S.opt, { from: 'scale' });
          }).then(function () {
            return ctx.tween(1200, grow, 'out');
          }).then(function () {
            var ch = Promise.resolve();
            S.dl.forEach(function (l) { ch = ch.then(function () { return ctx.packet(l, { color: 'teal', dur: 350, r: 4 }); }); });
            return ch;
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Mid-training',
        say: 'Between raw pretraining and fine tuning sits mid training. As the learning rate decays, the data mix shifts toward the best material: curated code, math, reasoning traces and textbook quality text. This annealing phase buys a surprising amount of benchmark quality. The context window is also stretched in stages, from eight thousand to one hundred twenty eight thousand tokens, by rescaling rotary position frequencies and training on long documents. Our director agent needs that to keep the whole storyboard, script and tool history in view.',
        deep: '<ul><li><b>LR schedule</b>: cosine, or <b>warmup–stable–decay</b> (WSD): a long constant-LR phase lets you branch cheap decay runs from any checkpoint; most of the quality gain from high-quality data shows up during the decay.</li>' +
          '<li><b>Annealing mix</b>: Llama 3 linearly annealed the LR to 0 over the final 40 M tokens while upsampling very high quality sources; annealing small amounts of curated code/math measurably lifts GSM8K-style scores and is also used to <i>evaluate</i> candidate datasets.</li>' +
          '<li><b>Long context</b>: Llama 3 extended 8k → 128k in six stages using ~800 B tokens, RoPE base θ = 500,000; alternatives rescale frequencies (NTK-aware, YaRN). Success criteria: short-context scores recover and needle-in-a-haystack retrieval passes.</li>' +
          '<li><b>Multimodal</b>: for VLMs, interleaved image-text and video-text data plus the vision projector are introduced here (see the Multimodal chamber).</li>' +
          '<li><b>Synthetic reasoning data</b>: long chain-of-thought traces, often distilled from a reasoning model, prime the base model for later RL.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var L = card(ctx, g, 60, 176, 760, 390, 'orange', 'LEARNING RATE · warmup – stable – decay');
          var pts = [[0, 0], [0.03, 1], [0.8, 1], [1, 0.02]];
          S.lr = ctx.plot(120, 230, 660, 250, pts, { xDomain: [0, 1], yDomain: [0, 1.1], color: 'orange', sw: 2.5, parent: L });
          var a = S.lr.toPx(0.8, 0), b = S.lr.toPx(1, 1.1);
          S.anneal = ctx.rect(a.x, b.y, b.x - a.x, a.y - b.y, { rx: 0, fill: ctx.alpha('lime', 0.1), stroke: ctx.alpha('lime', 0.5), sw: 1, dash: '4 4', parent: L });
          ctx.text((a.x + b.x) / 2, b.y + 18, 'anneal', { size: 12, font: 'mono', weight: 700, color: 'lime', anchor: 'middle', parent: L });
          ctx.para(a.x - 12, 330, ['data mix switches to', 'curated code · math ·', 'reasoning · long docs'], { size: 12, font: 'mono', color: 'lime', anchor: 'end', lh: 18, parent: L });
          ctx.text(126, 500, 'warmup', { size: 11, font: 'mono', color: 'dim', parent: L });
          ctx.text(400, 500, 'stable (bulk of pretraining tokens)', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
          ctx.text(780, 520, 'tokens →', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          ctx.text(112, 222, 'lr', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          S.lr.curve.setAttribute('opacity', 0);
          S.anneal.setAttribute('opacity', 0);
          ctx.reveal(L, { from: 'left' });

          var R = card(ctx, g, 850, 176, 690, 390, 'violet', 'CONTEXT EXTENSION · Llama 3 recipe');
          var lens = [8, 16, 32, 64, 96, 128];
          S.ctxBars = lens.map(function (k, i) {
            var y = 226 + i * 46;
            ctx.text(930, y + 13, 'stage ' + (i + 1), { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: R });
            var bar = ctx.rect(944, y, 0, 26, { rx: 4, fill: ctx.alpha('violet', 0.45), stroke: 'violet', sw: 1, parent: R });
            var t = ctx.text(952, y + 13, k + 'k', { size: 12, font: 'mono', color: 'white', parent: R });
            return { b: bar, t: t, w: k / 128 * 520 };
          });
          ctx.text(870, 516, '~800 B tokens total · RoPE base θ = 500,000 · stage sizes illustrative', { size: 13, font: 'mono', color: 'violet', parent: R });
          ctx.text(870, 542, 'gate: short-context evals recover + needle retrieval passes', { size: 12, font: 'mono', color: 'dim', parent: R });
          ctx.reveal(R, { from: 'right', delay: 200 });

          var B = textCard(ctx, g, 60, 590, 1480, 270, 'orange', 'WHAT GOES INTO MID-TRAINING', [
            'curated code, math and textbook-quality text, upsampled while the learning rate decays',
            'synthetic long chain-of-thought traces that prime the model for later reasoning RL',
            'long documents (books, repos, transcripts) at 32k–128k to teach long-range retrieval',
            'for multimodal models: interleaved image-text and video-text, projector alignment'
          ], { lh: 44, top: 64 });
          ctx.reveal(B, { from: 'up', delay: 400 });

          function grow(t) { S.ctxBars.forEach(function (e) { e.b.setAttribute('width', e.w * t); e.t.setAttribute('x', 952 + e.w * t); }); }
          if (ctx.instant) { S.lr.curve.setAttribute('opacity', 1); S.anneal.setAttribute('opacity', 1); grow(1); return Promise.resolve(); }
          grow(0);
          return ctx.wait(600).then(function () {
            S.lr.curve.setAttribute('opacity', 1);
            return ctx.reveal(S.lr.curve, { from: 'draw', dur: 1400 });
          }).then(function () {
            ctx.reveal(S.anneal, { dur: 500 });
            return ctx.pulse(S.anneal, { color: 'lime', dur: 700 });
          }).then(function () {
            var ch = Promise.resolve();
            S.ctxBars.forEach(function (e) {
              ch = ch.then(function () { return ctx.tween(350, function (t) { e.b.setAttribute('width', e.w * t); e.t.setAttribute('x', 952 + e.w * t); }, 'out'); });
            });
            return ch;
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'SFT & masking',
        say: 'Supervised fine tuning turns a document completer into an assistant. Each training example is a full conversation rendered into a chat template: a system prompt, the user\'s request, the assistant\'s reply, a tool call, the tool\'s result, and the final answer. The model is trained with the same next token loss, but only on the tokens the assistant produced. System, user and tool result tokens are masked out: the model learns to act, not to imitate the environment. Tool use trajectories teach it to emit exact JSON arguments.',
        deep: '<div class="eq">L<sub>SFT</sub> = − Σ<sub>t</sub> m<sub>t</sub> log p<sub>θ</sub>(x<sub>t</sub> | x<sub>&lt;t</sub>) / Σ<sub>t</sub> m<sub>t</sub>, &nbsp; m<sub>t</sub> = 1 iff token t was written by the assistant</div>' +
          '<ul><li><b>Chat template</b>: role headers and special tokens (e.g. &lt;|start_header_id|&gt;assistant) make roles unambiguous; tool calls use a reserved format that the serving stack parses back into JSON.</li>' +
          '<li><b>Why mask</b>: training on tool outputs would teach the model to <i>hallucinate</i> tool results; training on user turns wastes capacity on imitating users.</li>' +
          '<li><b>Data</b>: human demonstrations, synthetic data from stronger models filtered by rejection sampling, and <b>executed</b> tool trajectories (the call really ran in a sandbox, the result is real).</li>' +
          '<li><b>Scale</b>: ~10<sup>5</sup>–10<sup>6</sup> examples, 1–3 epochs, LR ~10<sup>−5</sup>, sequence packing with per-document attention masks. Quality and diversity matter far more than volume.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var rows = [
            ['system', 'You are the director agent. Tools: render_shot, critic.', 'dim', 0],
            ['user', 'Make a 30 s trailer: fox astronaut crash-lands on an ice moon.', 'cyan', 0],
            ['assistant', 'Plan: 6 shots × 5 s. Rendering shot 1 first.', 'amber', 1],
            ['tool_call', '{"name":"render_shot","args":{"id":1,"seconds":5}}', 'magenta', 1],
            ['tool_result', '{"ok":true,"clip":"s3://jobs/42/shot1.mp4"}', 'teal', 0],
            ['assistant', 'Shot 1 is ready. Next: the crash on the ice.', 'amber', 1]
          ];
          var L = card(ctx, g, 60, 176, 1000, 390, 'cyan', 'ONE TRAINING EXAMPLE, RENDERED WITH THE CHAT TEMPLATE');
          ctx.text(944, 206, 'loss', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: L });
          S.rows = rows.map(function (r, i) {
            var y = 244 + i * 50, rg = ctx.group({ parent: L });
            ctx.label(140, y, r[0], { color: r[2], size: 12, w: 110, parent: rg });
            ctx.rect(206, y - 17, 690, 34, { rx: 6, fill: ctx.alpha(r[2], r[3] ? 0.14 : 0.05), stroke: ctx.alpha(r[2], 0.5), sw: 1, parent: rg });
            ctx.text(220, y + 0.5, r[1], { size: 13, font: 'mono', color: r[3] ? 'white' : 'dim', parent: rg });
            rg.mark = ctx.group({ parent: rg });
            if (r[3]) ctx.icon('check', 944, y, 20, 'lime', { parent: rg.mark });
            else ctx.text(944, y + 1, 'masked', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: rg.mark });
            rg.under = ctx.rect(206, y + 19, 690, 3, { rx: 1, fill: r[3] ? 'lime' : 'none', parent: rg });
            rg.mark.setAttribute('opacity', 0);
            rg.under.setAttribute('opacity', 0);
            return rg;
          });
          ctx.text(560, 552, 'gradient flows only through the underlined (assistant-written) tokens', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: L });
          ctx.reveal(S.rows, { from: 'left', stagger: 120 });
          ctx.reveal(L, { dur: 300 });

          var R = textCard(ctx, g, 1090, 176, 450, 390, 'amber', 'MASKED OBJECTIVE', [
            'L = − Σ_t m_t · log p(x_t | x_<t)',
            '        / Σ_t m_t',
            '',
            'm_t = 1  assistant text',
            'm_t = 1  tool-call JSON',
            'm_t = 0  system, user,',
            '         tool results',
            '',
            'learn to ACT, not to',
            'imitate the environment'
          ], { size: 14, lh: 30, top: 58 });
          ctx.reveal(R, { from: 'right', delay: 200 });

          var B = textCard(ctx, g, 60, 590, 1480, 270, 'cyan', 'WHERE SFT DATA COMES FROM', [
            'human demonstrations for hard, taste-driven tasks (e.g. shot descriptions a cinematographer would write)',
            'synthetic answers from stronger models, filtered by rejection sampling and reward models',
            'executed tool trajectories: calls really ran in sandboxes, so results and error messages are real',
            '~10⁵–10⁶ examples · 1–3 epochs · LR ~1e-5 · packed sequences with per-document attention masks'
          ], { lh: 44, top: 64 });
          ctx.reveal(B, { from: 'up', delay: 400 });

          function end() { S.rows.forEach(function (r) { r.mark.setAttribute('opacity', 1); r.under.setAttribute('opacity', 1); }); }
          if (ctx.instant) { end(); return Promise.resolve(); }
          var ch = ctx.wait(1300);
          S.rows.forEach(function (r) {
            ch = ch.then(function () {
              ctx.reveal(r.mark, { from: 'scale', dur: 350 });
              return ctx.reveal(r.under, { dur: 350 });
            });
          });
          return ch.then(end);
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Preferences',
        say: 'Demonstrations teach what to do, preferences teach what is better. Labelers, human or AI, compare two responses to the same prompt. Classic RLHF trains a reward model on these pairs and then optimizes the policy with PPO against it, with a KL penalty that keeps it close to the reference model. Direct preference optimization skips the reward model: a simple loss raises the log probability ratio of the chosen answer relative to the rejected one. Watch the implicit reward margin grow as DPO trains.',
        deep: '<div class="eq">RM (Bradley–Terry): L = −log σ( r<sub>φ</sub>(x, y<sub>w</sub>) − r<sub>φ</sub>(x, y<sub>l</sub>) )</div>' +
          '<div class="eq">RLHF: max<sub>π</sub> E[ r<sub>φ</sub>(x, y) ] − β · KL( π(·|x) ‖ π<sub>ref</sub>(·|x) )</div>' +
          '<div class="eq">DPO: L = −log σ( β log π(y<sub>w</sub>|x)/π<sub>ref</sub>(y<sub>w</sub>|x) − β log π(y<sub>l</sub>|x)/π<sub>ref</sub>(y<sub>l</sub>|x) )</div>' +
          '<p>DPO follows from the closed-form optimum of the KL-regularised objective, π*(y|x) ∝ π<sub>ref</sub>(y|x)·e<sup>r(x,y)/β</sup>, so r̂(x,y) = β log π/π<sub>ref</sub> is an <i>implicit reward</i>.</p>' +
          '<table><tr><th></th><th>PPO-RLHF</th><th>DPO</th></tr>' +
          '<tr><td>models in memory</td><td>policy, reference, reward, value</td><td>policy, reference</td></tr>' +
          '<tr><td>data</td><td>on-policy samples</td><td>offline pairs</td></tr>' +
          '<tr><td>failure modes</td><td>reward hacking, instability</td><td>over-optimisation, drifts off-distribution</td></tr></table>' +
          '<p>Variants: IPO, KTO, SimPO, online/iterative DPO; <b>RLAIF</b> and constitutional methods replace human labels with model judgements under a written policy.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var A = card(ctx, g, 60, 176, 480, 400, 'violet', 'A PREFERENCE PAIR');
          ctx.para(80, 222, ['x: "Describe shot 3 for the', '    video model."'], { size: 13, font: 'mono', color: 'white', lh: 20, parent: A });
          S.yw = card(ctx, A, 80, 272, 440, 120, 'lime', 'y_w  chosen');
          ctx.para(96, 318, ['Low-angle close-up; frost blooms', 'across the visor reflecting a blue', 'aurora. 35 mm, slow push-in, 5 s.'], { size: 12, font: 'mono', color: 'text', lh: 19, parent: S.yw });
          S.yl = card(ctx, A, 80, 408, 440, 110, 'red', 'y_l  rejected');
          ctx.para(96, 454, ['A fox on ice. It looks cool.', 'Make it epic.'], { size: 12, font: 'mono', color: 'text', lh: 19, parent: S.yl });
          ctx.text(300, 552, 'labeler (human or AI judge) prefers y_w', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: A });
          keepWS(A);
          ctx.reveal(A, { from: 'left' });

          var R = card(ctx, g, 560, 176, 480, 400, 'amber', 'RLHF: REWARD MODEL + PPO');
          var n1 = ctx.node({ x: 800, y: 250, w: 380, h: 56, title: 'reward model r_φ', sub: 'Bradley–Terry on pairs', color: 'amber', titleSize: 15, subSize: 11, parent: R });
          var n2 = ctx.node({ x: 800, y: 366, w: 380, h: 56, title: 'PPO on policy π_θ', sub: 'max E[r] − β·KL(π ‖ π_ref)', color: 'amber', titleSize: 15, subSize: 11, parent: R });
          S.rl = ctx.link(n1, n2, { color: 'amber', parent: R, label: 'reward', labelDx: 44, labelDy: 0 });
          ctx.para(590, 440, ['4 models in memory:', 'policy · reference · reward · value', 'on-policy sampling every step', 'risk: policy exploits RM blind spots'], { size: 12, font: 'mono', color: 'text', lh: 24, parent: R });
          ctx.reveal(R, { from: 'up', delay: 200 });

          var D = card(ctx, g, 1060, 176, 480, 400, 'lime', 'DPO: IMPLICIT REWARD MARGIN');
          ctx.para(1078, 222, ['implicit reward r(y) = β·log π_θ(y|x)/π_ref(y|x)', 'L = −log σ( r(y_w) − r(y_l) )'], { size: 13, font: 'mono', color: 'white', lh: 24, parent: D });
          var Z = 400;
          ctx.line(1090, Z, 1520, Z, { color: ctx.alpha('white', 0.3), parent: D });
          S.bw = ctx.rect(1140, Z, 90, 0, { rx: 4, fill: ctx.alpha('lime', 0.5), stroke: 'lime', sw: 1, parent: D });
          S.bl = ctx.rect(1260, Z, 90, 0, { rx: 4, fill: ctx.alpha('red', 0.5), stroke: 'red', sw: 1, parent: D });
          ctx.text(1185, 516, 'r(y_w)', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: D });
          ctx.text(1305, 516, 'r(y_l)', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: D });
          S.sig = ctx.text(1450, 330, '', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: D });
          S.sig2 = ctx.text(1450, 354, '', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: D });
          S.stepT = ctx.text(1450, 470, '', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: D });
          ctx.reveal(D, { from: 'right', delay: 300 });

          var B = textCard(ctx, g, 60, 600, 1480, 260, 'violet', 'TRADE-OFFS', [
            'PPO-RLHF: on-policy and flexible, but 4 models, fragile hyper-parameters, and reward hacking of r_φ',
            'DPO: offline, 2 models, one supervised-style loss; can over-optimise and drift off-distribution',
            'iterative / online DPO, RLAIF and constitutional rules close much of the gap at far lower cost',
            'Llama 3 post-training: 6 rounds of SFT + rejection sampling + DPO, reward model used for filtering'
          ], { lh: 42, top: 62 });
          ctx.reveal(B, { from: 'up', delay: 400 });

          function setM(t) {
            var w = 0.2 + 1.6 * t, l = -0.1 - 1.3 * t;
            S.bw.setAttribute('y', Z - w * 60); S.bw.setAttribute('height', w * 60);
            S.bl.setAttribute('y', Z); S.bl.setAttribute('height', -l * 60);
            var m = w - l;
            S.sig.textContent = 'margin ' + m.toFixed(2);
            S.sig2.textContent = 'σ = ' + (1 / (1 + Math.exp(-m))).toFixed(2) + ' · loss ' + Math.log(1 + Math.exp(-m)).toFixed(2);
            S.stepT.textContent = 'training step ' + Math.round(t * 400);
          }
          if (ctx.instant) { setM(1); return Promise.resolve(); }
          setM(0);
          return ctx.wait(1000).then(function () {
            return ctx.packet(S.rl, { color: 'amber', dur: 700 });
          }).then(function () {
            return ctx.tween(2600, setM, 'inOut');
          }).then(function () {
            ctx.pulse(S.yw, { color: 'lime', dur: 600 });
            return ctx.pulse(S.bw, { color: 'lime', dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'GRPO & reasoning',
        say: 'For tasks with checkable answers, we can skip human labels entirely. Group relative policy optimization samples a group of answers to the same prompt, here eight. A verifier scores each one: did the JSON parse, do the six shot durations sum to exactly thirty seconds? Each answer\'s advantage is its reward minus the group mean, divided by the group standard deviation, so no value network is needed. Trained this way at scale, DeepSeek R1 Zero learned on its own to think longer, re-check its work, and backtrack.',
        deep: '<div class="eq">A<sub>i</sub> = (r<sub>i</sub> − mean(r<sub>1..G</sub>)) / std(r<sub>1..G</sub>)</div>' +
          '<div class="eq">J(θ) = E[ (1/G) Σ<sub>i</sub> (1/|o<sub>i</sub>|) Σ<sub>t</sub> min( ρ<sub>i,t</sub>A<sub>i</sub>, clip(ρ<sub>i,t</sub>, 1−ε, 1+ε)A<sub>i</sub> ) ] − β·KL(π<sub>θ</sub> ‖ π<sub>ref</sub>)</div>' +
          '<p>ρ<sub>i,t</sub> = π<sub>θ</sub>(o<sub>i,t</sub>|q, o<sub>i,&lt;t</sub>) / π<sub>old</sub>(·). The group mean replaces PPO’s learned value baseline, so no policy-sized critic has to be trained or held in memory (with a rule-based verifier, only policy and reference remain). Here 3 of 8 pass: mean 0.375, std 0.484, so A = +1.29 for passes and −0.77 for failures, broadcast to every token of the response.</p>' +
          '<ul><li><b>Rewards</b> (R1): rule-based accuracy (math answer match, code unit tests) + format reward; no neural reward model to hack.</li>' +
          '<li><b>Emergence</b>: DeepSeek-R1-Zero’s responses grew from hundreds to thousands of tokens and AIME 2024 pass@1 rose from 15.6% to 71.0% (86.7% with majority voting), with spontaneous reflection (“wait, let me re-check”).</li>' +
          '<li><b>2025 refinements</b>: DAPO (clip-higher ε<sub>high</sub> = 0.28, dynamic sampling that drops all-pass/all-fail groups whose A ≡ 0, token-level loss); Dr. GRPO removes length and std normalisation biases.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var R = [1, 0, 0, 1, 0, 0, 1, 0];
          var mean = 0.375, sd = Math.sqrt(0.375 * 0.625);
          var lens = [620, 410, 880, 540, 300, 760, 700, 350];
          var why = ['sums to 30 s', 'sums to 28 s', 'invalid JSON', 'sums to 30 s', '7 shots', 'sums to 32 s', 'sums to 30 s', 'invalid JSON'];
          var P = card(ctx, g, 60, 176, 760, 76, 'lime', 'PROMPT q (verifiable)');
          ctx.text(78, 228, '"Split the 30 s trailer into 6 shots (≥ 3 s each) matching the beats; output JSON."', { size: 12, font: 'mono', color: 'white', parent: P });
          ctx.reveal(P, { from: 'left' });

          var G = card(ctx, g, 60, 266, 760, 360, 'lime', 'GROUP OF G = 8 SAMPLES  ·  reward  ·  advantage');
          S.samples = R.map(function (r, i) {
            var y = 312 + i * 36, rg = ctx.group({ parent: G });
            ctx.text(96, y, 'o' + (i + 1), { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: rg });
            rg.bar = ctx.rect(106, y - 11, 0, 22, { rx: 3, fill: ctx.alpha('white', 0.12), stroke: ctx.alpha('white', 0.35), sw: 1, parent: rg });
            rg.w = lens[i] / 900 * 250;
            rg.lenT = ctx.text(110, y, lens[i] + ' tok', { size: 11, font: 'mono', color: 'dim', parent: rg });
            rg.ver = ctx.group({ parent: rg });
            ctx.icon(r ? 'check' : 'warn', 440, y, 18, r ? 'lime' : 'red', { parent: rg.ver });
            ctx.text(456, y, 'r=' + r + '  ' + why[i], { size: 11, font: 'mono', color: r ? 'lime' : 'red', parent: rg.ver });
            var A = (r - mean) / sd;
            rg.A = A;
            rg.adv = ctx.rect(700, y - 9, 0, 18, { rx: 3, fill: ctx.alpha(A > 0 ? 'lime' : 'red', 0.6), parent: rg });
            rg.advT = ctx.text(A > 0 ? 774 : 626, y, (A > 0 ? '+' : '') + A.toFixed(2), { size: 11, font: 'mono', color: 'white', anchor: A > 0 ? 'start' : 'end', parent: rg });
            rg.ver.setAttribute('opacity', 0); rg.advT.setAttribute('opacity', 0);
            return rg;
          });
          ctx.line(700, 296, 700, 604, { color: ctx.alpha('white', 0.3), parent: G });
          S.stats = ctx.text(440, 610, '', { size: 12, font: 'mono', weight: 700, color: 'white', parent: G });
          ctx.reveal(G, { from: 'left', delay: 150 });

          var O = textCard(ctx, g, 850, 176, 690, 300, 'amber', 'GRPO OBJECTIVE (no value network)', [
            'A_i = ( r_i − mean(r) ) / std(r)',
            'ρ_i,t = π_θ(o_i,t | …) / π_old(o_i,t | …)',
            'J = mean_i  mean_t  min( ρ·A_i , clip(ρ, 1±ε)·A_i )',
            '    − β · KL( π_θ ‖ π_ref )',
            'reward: verifier, not a learned model'
          ], { size: 14, lh: 42, top: 62 });
          keepWS(O);
          ctx.reveal(O, { from: 'right', delay: 200 });

          var E = card(ctx, g, 850, 496, 690, 364, 'magenta', 'EMERGENCE (DeepSeek-R1-Zero, schematic)');
          var acc = ctx.plot(910, 546, 580, 240, function (x) { return 15.6 + (71.0 - 15.6) * (1 - Math.exp(-x / 2600)) / (1 - Math.exp(-8000 / 2600)); }, { xDomain: [0, 8000], yDomain: [0, 100], color: 'lime', sw: 2.5, parent: E });
          var len = ctx.plot(910, 546, 580, 240, function (x) { return 5 + 85 * Math.pow(x / 8000, 1.3); }, { xDomain: [0, 8000], yDomain: [0, 100], color: 'magenta', sw: 2, axes: false, parent: E });
          ctx.text(916, 540, 'AIME 2024 pass@1: 15.6% → 71.0%', { size: 12, font: 'mono', color: 'lime', parent: E });
          ctx.text(1486, 552, 'avg response length ↑', { size: 12, font: 'mono', color: 'magenta', anchor: 'end', parent: E });
          ctx.text(1490, 804, 'RL steps →', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: E });
          ctx.text(870, 836, '"wait, let me re-check": reflection and backtracking appear without being taught', { size: 12, font: 'mono', color: 'text', parent: E });
          S.curves = [acc.curve, len.curve];
          S.curves.forEach(function (c) { c.setAttribute('opacity', 0); });
          ctx.reveal(E, { from: 'up', delay: 300 });

          var N = textCard(ctx, g, 60, 646, 760, 214, 'lime', '2025 REFINEMENTS', [
            'DAPO: clip-higher (ε_high 0.28), drop all-pass /',
            '      all-fail groups (A ≡ 0), token-level loss',
            'Dr. GRPO: remove length & std normalisation bias',
            'KL often reduced or dropped for pure reasoning RL'
          ], { size: 13, lh: 34, top: 56 });
          ctx.reveal(N, { from: 'up', delay: 400 });

          function end() {
            S.samples.forEach(function (rg) {
              rg.bar.setAttribute('width', rg.w); rg.lenT.setAttribute('x', 112 + rg.w);
              rg.ver.setAttribute('opacity', 1); rg.advT.setAttribute('opacity', 1);
              var w = Math.abs(rg.A) * 56;
              rg.adv.setAttribute('x', rg.A > 0 ? 700 : 700 - w); rg.adv.setAttribute('width', w);
            });
            S.stats.textContent = 'mean 0.375 · std 0.484';
            S.curves.forEach(function (c) { c.setAttribute('opacity', 1); });
          }
          if (ctx.instant) { end(); return Promise.resolve(); }
          return ctx.wait(900).then(function () {
            return ctx.tween(1500, function (t) {
              S.samples.forEach(function (rg, i) {
                var f = ctx.clamp(t * 1.5 - i * 0.07, 0, 1);
                rg.bar.setAttribute('width', rg.w * f); rg.lenT.setAttribute('x', 112 + rg.w * f);
              });
            }, 'out');
          }).then(function () {
            return ctx.reveal(S.samples.map(function (s) { return s.ver; }), { from: 'left', stagger: 120 });
          }).then(function () {
            S.stats.textContent = 'mean 0.375 · std 0.484';
            return ctx.tween(900, function (t) {
              S.samples.forEach(function (rg) {
                var w = Math.abs(rg.A) * 56 * t;
                rg.adv.setAttribute('x', rg.A > 0 ? 700 : 700 - w); rg.adv.setAttribute('width', w);
              });
            }, 'out');
          }).then(function () {
            S.samples.forEach(function (rg) { rg.advT.setAttribute('opacity', 1); });
            S.curves.forEach(function (c) { c.setAttribute('opacity', 1); });
            return Promise.all(S.curves.map(function (c) { return ctx.reveal(c, { from: 'draw', dur: 1500 }); }));
          }).then(end);
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Agentic RL',
        say: 'Agentic reinforcement learning scales this to whole tasks. The model acts in a real environment for many turns: it reads the brief, calls the render tool, inspects the result, asks the critic, re-renders a failed shot, and finally hands in an edit list. Only at the end does a reward arrive: tests pass, the critic approves, the task succeeded. That single number must be credited back across every turn, while tool outputs stay masked. And because the reward is a program, the model will find loopholes unless the environment is built carefully.',
        deep: '<ul><li><b>Environments</b>: sandboxed containers with real tools (code execution, browsers, file systems, domain APIs like our render farm), thousands in parallel. Episodes are long and heavy-tailed, so rollouts run <b>asynchronously</b> and trainers must correct for slightly stale policies (importance weights, truncated ratios).</li>' +
          '<li><b>Rewards</b>: unit tests (SWE-style tasks), task-completion checkers, rubric-based LLM judges, human-style preference models for open-ended outputs. Kimi K2 combined large-scale synthesised tool-use environments with verifiable and self-critique rewards.</li>' +
          '<li><b>Credit assignment</b>: simplest is a trajectory-level advantage (GRPO over G rollouts of the same task) applied to every policy token; refinements add turn-level or process rewards, and always mask environment tokens.</li>' +
          '<li><b>Reward hacking</b>: policies have learned to edit or special-case unit tests, exit early with success codes, or flatter LLM judges. Mitigations: read-only tests and held-out checks, sandbox permissions, judge ensembles, KL regularisation, and monitoring chain-of-thought (while avoiding optimisation pressure that teaches the model to hide intent).</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var T = card(ctx, g, 60, 176, 1480, 186, 'magenta', 'ONE EPISODE · policy tokens (trained) vs environment tokens (masked)');
          var turns = [['brief + sketches', 'teal', 0, 130], ['think', 'amber', 1, 80], ['render_shot(1..6)', 'magenta', 1, 150], ['6 clips', 'teal', 0, 90], ['critic(shot 3)', 'magenta', 1, 130], ['"off-model"', 'teal', 0, 110], ['think', 'amber', 1, 70], ['render_shot(3)', 'magenta', 1, 130], ['clip ok', 'teal', 0, 80], ['submit EDL', 'amber', 1, 120]];
          var x = 84;
          S.turns = turns.map(function (t) {
            var r = ctx.rect(x, 226, t[3], 46, { rx: 6, fill: ctx.alpha(t[1], t[2] ? 0.35 : 0.1), stroke: t[1], sw: 1, dash: t[2] ? null : '4 3', parent: T });
            ctx.text(x + t[3] / 2, 249, t[0], { size: 11, font: 'mono', color: t[2] ? 'white' : 'dim', anchor: 'middle', parent: T });
            var o = { r: r, x: x, w: t[3], pol: t[2] };
            x += t[3] + 8;
            return o;
          });
          S.reward = ctx.node({ x: x + 60, y: 249, w: 104, h: 46, title: 'R = 1', sub: 'task passed', color: 'lime', titleSize: 15, subSize: 10, parent: T });
          S.credit = ctx.path('M' + (x + 60) + ',274 C' + (x + 60) + ',330 ' + 700 + ',330 110,280', { stroke: ctx.alpha('lime', 0.5), sw: 1.4, dash: '4 4', arrow: true, parent: T });
          ctx.text(700, 340, 'advantage A = (R − mean over G rollouts) / std  →  every policy token of every turn', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: T });
          S.cur = ctx.rect(80, 220, 6, 58, { rx: 2, fill: 'white', parent: T, glow: true });
          S.cur.setAttribute('opacity', 0);
          ctx.reveal(T, { from: 'up' });

          var Env = card(ctx, g, 60, 386, 560, 230, 'teal', 'THE ENVIRONMENT LOOP');
          S.pol = ctx.node({ x: 170, y: 490, w: 170, h: 60, title: 'policy π_θ', sub: 'the agent', icon: 'brain', color: 'amber', titleSize: 14, subSize: 11, parent: Env });
          S.env = ctx.node({ x: 497, y: 490, w: 190, h: 60, title: 'sandbox', sub: 'tools · files · APIs', icon: 'tool', color: 'teal', titleSize: 14, subSize: 11, parent: Env });
          S.a1 = ctx.link(S.pol, S.env, { color: 'magenta', from: 'r', to: 'l', bend: { x: 328, y: 420 }, label: 'action', labelDy: -6, parent: Env });
          S.a2 = ctx.link(S.env, S.pol, { color: 'teal', from: 'l', to: 'r', bend: { x: 328, y: 560 }, label: 'observation', labelDy: 8, parent: Env });
          ctx.text(340, 596, 'thousands of parallel containers · async rollouts', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: Env });
          ctx.reveal(Env, { from: 'left', delay: 200 });

          var C = textCard(ctx, g, 650, 386, 890, 230, 'lime', 'CREDIT ASSIGNMENT ACROSS TURNS', [
            'trajectory-level: GRPO over G rollouts of the same task, A broadcast to policy tokens',
            'mask environment tokens (tool results, observations) out of the loss',
            'turn-level / process rewards: partial credit, e.g. critic score per shot',
            'stale policies from async rollouts → importance ratios, truncation'
          ], { size: 13, lh: 36, top: 60 });
          ctx.reveal(C, { from: 'right', delay: 250 });

          var H = textCard(ctx, g, 60, 640, 740, 220, 'red', 'REWARD HACKING', [
            'edit or special-case the unit tests',
            'exit early with a success code',
            'flatter or confuse the LLM judge',
            'fix: read-only held-out checks, judge ensembles,',
            '     permissions, KL, CoT monitoring'
          ], { size: 13, lh: 30, top: 56 });
          var I = textCard(ctx, g, 820, 640, 720, 220, 'cyan', 'IN OUR VIDEO SYSTEM', [
            'env = render farm + critic + ffmpeg sandbox',
            'reward = critic approval · continuity checks ·',
            '         30 s duration · human preference model',
            'hack to avoid: critic that only checks length',
            'cost: every rollout renders video → cheap proxies'
          ], { size: 13, lh: 30, top: 56 });
          ctx.reveal([H, I], { from: 'up', delay: 350, stagger: 150 });

          if (ctx.instant) return Promise.resolve();
          S.cur.setAttribute('opacity', 1);
          return ctx.wait(800).then(function () {
            ctx.packet(S.a1, { color: 'magenta', dur: 800 });
            return ctx.tween(3000, function (t) {
              var xx = 80 + t * (x - 80);
              S.cur.setAttribute('x', xx);
              S.turns.forEach(function (o) { if (o.x < xx) o.r.setAttribute('stroke-width', 2.2); });
            }, 'linear');
          }).then(function () {
            ctx.packet(S.a2, { color: 'teal', dur: 800 });
            S.cur.setAttribute('opacity', 0);
            return ctx.pulse(S.reward, { color: 'lime', dur: 700 });
          }).then(function () {
            return ctx.packet(S.credit, { color: 'lime', dur: 1200, r: 5, label: 'A' });
          }).then(function () {
            S.turns.forEach(function (o) { if (o.pol) ctx.pulse(o.r, { color: 'lime', dur: 600 }); });
            return ctx.wait(600);
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Distill & ship',
        say: 'The last step makes it affordable. A large teacher, trained with all of the above, generates hundreds of thousands of high quality reasoning and tool use traces, and a smaller student is fine tuned on them. DeepSeek distilled R1 into models from one and a half to seventy billion parameters this way. On policy distillation goes further: the student generates, and the teacher grades every token. In our film crew, the director may be a frontier model, while the critic scoring every shot is a small, fast, distilled one.',
        deep: '<div class="eq">off-policy (sequence-level): L = −Σ<sub>t</sub> log p<sub>S</sub>(y<sub>t</sub> | y<sub>&lt;t</sub>, x), &nbsp; y ~ teacher</div>' +
          '<div class="eq">logit KD: L = τ² · KL( p<sub>T</sub><sup>(τ)</sup> ‖ p<sub>S</sub><sup>(τ)</sup> )</div>' +
          '<div class="eq">on-policy: L = E<sub>y~S</sub> Σ<sub>t</sub> KL( p<sub>S</sub>(·|y<sub>&lt;t</sub>) ‖ p<sub>T</sub>(·|y<sub>&lt;t</sub>) )</div>' +
          '<ul><li><b>DeepSeek-R1 distills</b>: ~800k curated samples (600k reasoning + 200k general) fine-tuned into Qwen2.5 and Llama 3 bases from 1.5 B to 70 B; distillation beat running RL directly on the small models.</li>' +
          '<li><b>On-policy distillation</b> (GKD and successors) trains on the student’s own samples with a per-token reverse-KL signal from the teacher: dense reward like SFT, on-distribution like RL, far cheaper than RL from scratch.</li>' +
          '<li><b>Strong-to-weak</b> distillation produces whole model families (e.g. Qwen3’s small models).</li>' +
          '<li>Serving choice for our system: route easy calls to distilled models, hard planning to the frontier model (a cascade), then quantise the students for the critic’s high call volume.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var L = card(ctx, g, 60, 176, 780, 390, 'teal', 'TEACHER → STUDENT');
          S.teacher = ctx.node({ x: 200, y: 300, w: 220, h: 110, title: 'Teacher', sub: 'frontier RL-trained', icon: 'brain', color: 'amber', titleSize: 18, subSize: 12, parent: L });
          S.student = ctx.node({ x: 690, y: 300, w: 150, h: 70, title: 'Student', sub: '1.5–70 B', icon: 'brain', color: 'teal', titleSize: 15, subSize: 11, parent: L });
          S.tr = ctx.link(S.teacher, S.student, { color: 'amber', label: '~800k traces (off-policy SFT)', labelDy: -18, parent: L });
          S.onp1 = ctx.path('M690,340 C690,470 200,470 200,360', { stroke: ctx.alpha('teal', 0.8), sw: 1.6, arrow: true, parent: L });
          S.onp2 = ctx.path('M230,360 C240,440 640,440 660,340', { stroke: ctx.alpha('amber', 0.8), sw: 1.6, dash: '4 4', arrow: true, parent: L });
          ctx.text(445, 488, 'on-policy: student samples  →  teacher grades every token', { size: 12, font: 'mono', color: 'teal', anchor: 'middle', parent: L });
          ctx.text(445, 540, 'dense per-token signal like SFT, on-distribution like RL', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
          ctx.reveal(L, { from: 'left' });

          var R = textCard(ctx, g, 870, 176, 670, 390, 'amber', 'THREE WAYS TO DISTILL', [
            'sequence-level SFT on teacher outputs',
            '  L = −Σ_t log p_S(y_t | y_<t),  y ~ T',
            'logit distillation (temperature τ)',
            '  L = τ² · KL( p_T^τ ‖ p_S^τ )',
            'on-policy (reverse KL, mode-seeking)',
            '  L = E_{y~S} Σ_t KL( p_S ‖ p_T )',
            '',
            'R1 → Qwen2.5 / Llama 3, 1.5–70 B:',
            'distilling beat RL on the small models'
          ], { size: 14, lh: 34, top: 58 });
          ctx.reveal(R, { from: 'right', delay: 200 });

          var B = card(ctx, g, 60, 590, 1480, 270, 'magenta', 'RECAP: WHICH STAGE BUILT WHICH SKILL OF THE CREW');
          var roles = ['knowledge', 'long context', 'tool JSON', 'taste & safety', 'reasoning', 'multi-step tools', 'cheap critic'];
          S.recap = STAGES.map(function (s, i) {
            var xx = 150 + i * 212;
            var n = ctx.node({ x: xx, y: 668, w: 180, h: 50, title: s[0], color: s[4], kind: 'pill', titleSize: 14, glow: false, parent: B });
            ctx.text(xx, 716, roles[i], { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: B });
            return n;
          });
          for (var i = 0; i < 6; i++) ctx.link(S.recap[i], S.recap[i + 1], { color: ctx.alpha('white', 0.35), sw: 1.2, parent: B });
          ctx.text(800, 774, 'director agent = frontier model through all seven stages · critic agent = distilled student', { size: 14, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: B });
          ctx.text(800, 808, 'the same next-token machine, shaped by different signals: data, demonstrations, preferences, verifiers, environments', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: B });
          ctx.reveal(B, { from: 'up', delay: 400 });
          ctx.reveal(S.recap, { from: 'up', delay: 600, stagger: 90 });

          if (ctx.instant) return Promise.resolve();
          return ctx.wait(900).then(function () {
            return Promise.all([ctx.packet(S.tr, { color: 'amber', dur: 900, label: 'traces' }), ctx.wait(300).then(function () { return ctx.packet(S.tr, { color: 'amber', dur: 900 }); })]);
          }).then(function () {
            return ctx.packet(S.onp1, { color: 'teal', dur: 900, label: 'sample' });
          }).then(function () {
            return ctx.packet(S.onp2, { color: 'amber', dur: 900, label: 'per-token KL' });
          }).then(function () {
            return ctx.pulse(S.student, { color: 'teal', dur: 700 });
          });
        }
      }
    ]
  });
})();
