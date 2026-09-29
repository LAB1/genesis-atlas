/* L2 — How an LLM Learns to Be an Agent. The training pipeline: pretraining (next-token CE, 6ND, Chinchilla,
 * data), mid-training (annealing, long context), SFT with loss masking on tool trajectories, preference
 * optimisation (RLHF/PPO, DPO), RL with verifiable rewards (GRPO, emergent long CoT), agentic multi-turn RL,
 * and distillation into small fast models.
 * Every step is a sequence of beats (one idea each: narration, callout card, deep-dive chunk, animation segment). */
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

  /* set opacity 0 on elements (or arrays of elements) that a later beat will reveal */
  function hide() {
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      (Array.isArray(a) ? a : [a]).forEach(function (e) { if (e) e.setAttribute('opacity', 0); });
    }
  }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    if (title) ctx.text(x + 16, y + 22, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = boxOf(x, y, w, h);
    return g;
  }

  /* card with column-aligned code-font lines; g.lines = the individual line elements (revealed beat by beat) */
  function textCard(ctx, parent, x, y, w, h, color, title, lines, o) {
    o = o || {};
    var g = card(ctx, parent, x, y, w, h, color, title);
    var p = ctx.para(x + 18, y + (o.top || 56), lines, { size: o.size || 14, font: 'code', color: 'text', lh: o.lh || 30, parent: g });
    keepWS(g);
    g.lines = Array.prototype.slice.call(p.childNodes);
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
      'Hoffmann et al., <i>Training Compute-Optimal Large Language Models</i> (Chinchilla), NeurIPS 2022',
      'Besiroglu et al., <i>Chinchilla Scaling: A Replication Attempt</i>, 2024',
      'Llama Team, Meta AI, <i>The Llama 3 Herd of Models</i>, 2024',
      'Penedo et al., <i>The FineWeb Datasets: Decanting the Web for the Finest Text Data at Scale</i>, NeurIPS 2024 Datasets and Benchmarks',
      'Ouyang et al., <i>Training Language Models to Follow Instructions with Human Feedback</i> (InstructGPT), NeurIPS 2022',
      'Rafailov et al., <i>Direct Preference Optimization: Your Language Model is Secretly a Reward Model</i>, NeurIPS 2023',
      'Shao et al., <i>DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models</i> (GRPO), 2024',
      'DeepSeek-AI, <i>DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning</i>, 2025',
      'Yu et al., <i>DAPO: An Open-Source LLM Reinforcement Learning System at Scale</i>, 2025',
      'Liu et al., <i>Understanding R1-Zero-Like Training: A Critical Perspective</i> (Dr. GRPO), 2025',
      'Kimi Team, <i>Kimi K2: Open Agentic Intelligence</i>, 2025',
      'Baker et al. (OpenAI), <i>Monitoring Reasoning Models for Misbehavior and the Risks of Promoting Obfuscation</i>, 2025',
      'Agarwal et al., <i>On-Policy Distillation of Language Models: Learning from Self-Generated Mistakes</i> (GKD), ICLR 2024',
      'DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i>, 2024'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'The pipeline',
        beats: [
          {
            say: 'The director agent planning our fox astronaut trailer was not programmed to plan. It was trained, in stages.',
            card: { tag: 'KEY IDEA', title: 'Trained, not programmed', body: 'The crew\'s language models are shaped by a pipeline of stages, each with its own data and its own learning signal.' },
            deep: '<table><tr><th>Stage</th><th>Signal</th><th>What it adds for our crew</th></tr>' +
              '<tr><td>Pretraining</td><td>next-token CE on 10–40 T tokens</td><td>language, world and visual-concept knowledge</td></tr>' +
              '<tr><td>Mid-training</td><td>CE, annealed LR, curated mix</td><td>code, math, 128k context for long agent transcripts</td></tr>' +
              '<tr><td>SFT</td><td>masked CE on demonstrations</td><td>chat format, instruction following, valid tool JSON</td></tr>' +
              '<tr><td>Preference</td><td>RM + PPO, or DPO</td><td>helpfulness, style, refusals</td></tr>' +
              '<tr><td>RLVR</td><td>verifier rewards, GRPO</td><td>long chain-of-thought reasoning</td></tr>' +
              '<tr><td>Agentic RL</td><td>multi-turn task success</td><td>plan → call tools → recover from errors</td></tr>' +
              '<tr><td>Distillation</td><td>teacher traces / logits</td><td>cheap critic and router models</td></tr></table>'
          },
          {
            say: 'Pretraining on tens of trillions of tokens teaches language and world knowledge. Mid training sharpens code, math and long context.',
            card: { tag: 'NUMBERS', title: 'How much text', stat: { v: '36 T', u: 'tokens', l: 'in Qwen3 pretraining; Llama 3 used 15.6 T and DeepSeek-V3 14.8 T' } },
            deep: '<p><b>Pretraining</b>: self-supervised next-token cross-entropy over a web, code and book corpus, on 10–40 T tokens in current open recipes (Llama 3: 15.6 T; DeepSeek-V3: 14.8 T; Qwen3: 36 T). It builds language, world knowledge and a large repertoire of latent skills.</p>' +
              '<p><b>Mid-training</b>: the same loss, but with an annealed learning rate, a curated mix and longer documents, so that code, math and 128k context are in place before the model is ever shown a chat template.</p>'
          },
          {
            say: 'Supervised fine tuning teaches the chat format and tool calls. Preference optimization shapes style and safety.',
            card: { tag: 'HOW IT WORKS', title: 'From completer to assistant', body: 'SFT imitates demonstrations, including valid tool JSON. Preference tuning ranks answers by helpfulness, style and safety.' },
            deep: '<p><b>SFT</b> switches to <i>masked</i> cross-entropy on demonstrations rendered in a chat template, so the model answers instead of continuing text and learns to emit tool calls in an exact format. <b>Preference optimisation</b> then uses comparisons (RLHF with a reward model and PPO, or DPO directly) to shape helpfulness, tone and refusals.</p>' +
              '<p>These stages use 10<sup>5</sup>–10<sup>6</sup> examples or pairs, five orders of magnitude less data than pretraining, but they decide how the model behaves.</p>'
          },
          {
            say: 'Reinforcement learning with verifiable rewards teaches reasoning, agentic reinforcement learning teaches multi step tool use, and distillation packs it all into smaller, faster models.',
            card: { tag: 'STATE OF THE ART', title: 'RL is the new frontier', body: 'Verifiable-reward RL produced long chain-of-thought reasoning models such as DeepSeek-R1; agentic RL adds multi-turn tool use in real environments.' },
            deep: '<p><b>RLVR</b> optimises against programmatic verifiers (math answers, unit tests) with GRPO or PPO and elicits long reasoning. <b>Agentic RL</b> extends the episode to many tool-using turns with a task-level reward. <b>Distillation</b> transfers the result into small, cheap models such as our critic.</p>' +
              '<p>Stages are often iterated: Llama 3 ran six rounds of SFT + rejection sampling + DPO, and reasoning models alternate RL with rejection-sampled SFT.</p>'
          },
          {
            say: 'Pretraining still dominates the compute bill in most published recipes, though reinforcement learning\'s share is growing. Together the stages turn one next token machine into a film crew.',
            card: { tag: 'NUMBERS', title: 'Where the GPU-hours go', stat: { v: '95.6%', l: 'of DeepSeek-V3\'s 2.79 M H800-hours went to pretraining; post-training used about 0.2%' } },
            deep: '<table><tr><th>DeepSeek-V3 stage</th><th>H800 GPU-hours</th><th>Share</th></tr>' +
              '<tr><td>Pretraining (14.8 T tokens)</td><td>2,664 K</td><td>95.6%</td></tr>' +
              '<tr><td>Context extension (4k → 32k → 128k)</td><td>119 K</td><td>4.3%</td></tr>' +
              '<tr><td>Post-training (SFT + RL)</td><td>5 K</td><td>0.2%</td></tr></table>' +
              '<p>Reasoning-model recipes shift this balance: long RL rollouts are expensive, so the post-training share rises. The first bar on the stage is the reported DeepSeek-V3 split; the second is a schematic of a reasoning-model recipe, not a measurement.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.loops = [];
          var g = S.page = ctx.group();
          var head = ctx.text(60, 176, 'FROM RANDOM WEIGHTS TO A TOOL-USING AGENT', { size: 12, font: 'mono', color: 'dim', spacing: 1, parent: g });
          /* phase braces */
          var br = ctx.group({ parent: g });
          ctx.path('M55,222 V212 H462 V222', { stroke: ctx.alpha('amber', 0.6), sw: 1.4, parent: br });
          ctx.text(258, 202, 'pre-training (self-supervised)', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: br });
          ctx.path('M488,222 V212 H1547 V222', { stroke: ctx.alpha('magenta', 0.6), sw: 1.4, parent: br });
          ctx.text(1017, 202, 'post-training (supervised + reinforcement)', { size: 12, font: 'mono', color: 'magenta', anchor: 'middle', parent: br });
          S.track = ctx.path('M60,250 H1540', { stroke: ctx.alpha('white', 0.12), sw: 1.2, dash: '3 6', parent: g });
          hide(head, br, S.track);
          S.sg = STAGES.map(function (s, i) {
            var x = 150 + i * 217;
            var sg = ctx.group({ parent: g });
            sg.node = ctx.node({ x: x, y: 306, w: 190, h: 70, title: s[0], sub: s[1], color: s[4], titleSize: 17, subSize: 12, parent: sg });
            ctx.text(x, 364, s[2], { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: sg });
            ctx.text(x, 384, s[3], { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: sg });
            return sg;
          });
          S.nodes = S.sg.map(function (sg) { return sg.node; });
          S.sl = [];
          for (var i = 0; i < 6; i++) S.sl.push(ctx.link(S.nodes[i], S.nodes[i + 1], { color: ctx.alpha('white', 0.4), sw: 1.3, parent: g }));
          hide(S.sg, S.sl);

          /* compute shares: the reported DeepSeek-V3 split (row A) against a schematic reasoning-model recipe (row B) */
          var cbA = ctx.group({ parent: g }), cbB = ctx.group({ parent: g });
          ctx.text(60, 420, 'DEEPSEEK-V3 · REPORTED H800 GPU-HOURS (2.79 M)', { size: 12, font: 'mono', color: 'dim', spacing: 1, parent: cbA });
          var repShare = [[0.9555, 'Pretrain 95.6%', 0], [0.0427, '', 1], [0.0018, '', 2]], xa = 60;
          repShare.forEach(function (s) {
            var w = s[0] * 1480;
            ctx.rect(xa, 432, Math.max(3, w - 2), 22, { rx: 3, fill: ctx.alpha(STAGES[s[2]][4], 0.5), stroke: STAGES[s[2]][4], sw: 1, parent: cbA });
            if (w > 200) ctx.text(xa + w / 2, 443.5, s[1], { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: cbA });
            xa += w;
          });
          ctx.text(1540, 468, 'context extension 4.3% · post-training (SFT + RL) 0.2%', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: cbA });
          ctx.text(60, 494, 'A 2025 REASONING-MODEL RECIPE · SCHEMATIC, RL SHARE RISING', { size: 12, font: 'mono', color: 'dim', spacing: 1, parent: cbB });
          var share = [0.72, 0.07, 0.01, 0.02, 0.09, 0.07, 0.02], x0 = 60;
          S.shareBars = share.map(function (f, k) {
            var w = f * 1480;
            var r = ctx.rect(x0, 506, Math.max(2, w - 2), 22, { rx: 3, fill: ctx.alpha(STAGES[k][4], 0.5), stroke: STAGES[k][4], sw: 1, parent: cbB });
            if (w > 90) ctx.text(x0 + w / 2, 517.5, STAGES[k][0], { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: cbB });
            x0 += w;
            return r;
          });
          ctx.text(1540, 542, 'long RL rollouts are expensive: the post-training slice is growing', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: cbB });
          hide(cbA, cbB);

          var B = textCard(ctx, g, 60, 560, 1480, 300, 'amber', 'WHAT EACH STAGE GIVES OUR FILM CREW', [
            'pretrain + mid-train  →  knows what a "low-angle dolly shot" is; holds a 12k-token plan in context',
            'SFT                   →  follows the director\'s instructions; emits valid render_shot(...) JSON',
            'preference            →  helpful, concise, safe; declines disallowed content',
            'RLVR                  →  reasons step by step: 6 shots × 5 s = 30 s, checks continuity',
            'agentic RL            →  calls tools, reads results, retries a failed render, knows when to stop',
            'distillation          →  a small, fast critic model that scores every rendered shot'
          ], { lh: 36, top: 58 });
          hide(B, B.lines);

          S.theta = ctx.group({ parent: g });
          ctx.circle(0, 0, 13, { fill: ctx.alpha('white', 0.15), stroke: 'white', sw: 1.5, parent: S.theta, glow: true });
          ctx.text(0, 1, 'θ', { size: 15, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: S.theta });
          ctx.place(S.theta, 60, 250);
          hide(S.theta);
          var thX = 60;
          function moveTheta(to, dur) {
            var from = thX; thX = to;
            return ctx.tween(dur, function (t) { ctx.place(S.theta, from + (to - from) * t, 250); }, 'inOut');
          }

          /* beat 0: random weights, and the two phases */
          return Promise.all([ctx.reveal([head, br, S.track], { stagger: 200 }), ctx.reveal(S.theta, { from: 'scale', delay: 400 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: pretraining and mid-training */
            ctx.reveal(B, { from: 'up', dur: 500 });
            ctx.reveal(B.lines[0], { from: 'left', dur: 400, delay: 400 });
            return Promise.all([ctx.reveal(S.sg.slice(0, 2), { from: 'up', stagger: 200 }), ctx.reveal(S.sl[0], { from: 'draw', delay: 300 })]).then(function () {
              return moveTheta(367, 1200);
            }).then(function () {
              ctx.pulse(S.nodes[0], { color: STAGES[0][4], dur: 500 });
              return ctx.pulse(S.nodes[1], { color: STAGES[1][4], dur: 500 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: SFT and preference optimisation */
            ctx.reveal(B.lines.slice(1, 3), { from: 'left', dur: 400, stagger: 250, delay: 400 });
            return Promise.all([ctx.reveal(S.sg.slice(2, 4), { from: 'up', stagger: 200 }), ctx.reveal(S.sl.slice(1, 3), { from: 'draw', delay: 300, stagger: 200 })]).then(function () {
              return moveTheta(801, 1200);
            }).then(function () {
              ctx.pulse(S.nodes[2], { color: STAGES[2][4], dur: 500 });
              return ctx.pulse(S.nodes[3], { color: STAGES[3][4], dur: 500 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: reinforcement learning, agentic RL and distillation */
            ctx.reveal(B.lines.slice(3), { from: 'left', dur: 400, stagger: 250, delay: 400 });
            return Promise.all([ctx.reveal(S.sg.slice(4), { from: 'up', stagger: 200 }), ctx.reveal(S.sl.slice(3), { from: 'draw', delay: 300, stagger: 200 })]).then(function () {
              return moveTheta(1500, 1800);
            }).then(function () {
              ctx.pulse(S.nodes[4], { color: STAGES[4][4], dur: 450 });
              ctx.pulse(S.nodes[5], { color: STAGES[5][4], dur: 450 });
              return ctx.pulse(S.nodes[6], { color: STAGES[6][4], dur: 450 });
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: where the compute goes: the reported split first, then the schematic reasoning-era recipe */
            return ctx.reveal(cbA, { from: 'up', dur: 600 }).then(function () {
              return ctx.reveal(cbB, { from: 'up', dur: 600 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Pretraining',
        beats: [
          {
            say: 'Pretraining has one objective, applied trillions of times: predict the next token. There are no labels except the text itself.',
            card: { tag: 'KEY IDEA', title: 'One objective, everywhere', body: 'Shift the text by one position. Every token is both an input and, one step earlier, a target.' },
            deep: '<div class="eq">L(θ) = −(1/T) Σ<sub>t</sub> log p<sub>θ</sub>(x<sub>t+1</sub> | x<sub>≤t</sub>), &nbsp; perplexity = e<sup>L</sup></div>' +
              '<p>Teacher forcing makes all T predictions parallel in one pass (causal mask): the input is x<sub>1..T</sub>, the target is the same sequence shifted by one. There are no labels beyond the text itself, which is why the corpus can be the whole web.</p>'
          },
          {
            say: 'Feed the model a sentence, shift it by one position, and at every position take the negative log probability it assigned to the true next token.',
            card: { tag: 'HOW IT WORKS', title: 'Score every position', body: 'Cross-entropy against a one-hot target is just −log p of the true token. Confident and right costs little; surprised costs a lot.' },
            deep: '<p>With a one-hot target the cross-entropy at position t reduces to the surprisal −log p<sub>θ</sub>(x<sub>t+1</sub> | x<sub>≤t</sub>), measured in nats (divide by ln 2 for bits). The training loss is its average over every position in the batch, and its gradient flows through all T positions at once.</p>' +
              '<p class="muted">Per-token probabilities shown are illustrative.</p>'
          },
          {
            say: 'Rare continuations like fox after the are expensive; easy ones like on after lands are cheap.',
            card: { tag: 'NUMBERS', title: 'Surprise costs nats', stat: { v: '3.22 vs 0.34', l: 'nats for a 4% guess (fox after the) versus a 71% guess (on after lands)' } },
            deep: '<p>fox after “The”: p = 0.04 gives −ln 0.04 = <b>3.22</b> nats. on after “lands”: p = 0.71 gives −ln 0.71 = <b>0.34</b> nats. Averaged over the ten demo positions the loss is 1.36 nats, a perplexity of 3.9.</p>' +
              '<p>Perplexity e<sup>L</sup> is the effective number of equally likely choices per token. Real web text is far less predictable than this demo: in the Chinchilla-style fit on the next page the loss floor is E ≈ 1.8 nats per token (perplexity about 6), the estimated irreducible entropy of that corpus, and a model at the Chinchilla compute optimum reaches about 2.0 nats (perplexity about 7). Both values depend on the corpus and the tokenizer.</p>'
          },
          {
            say: 'Averaged over tens of trillions of tokens this simple loss forces the model to learn grammar, facts and even physics of the world.',
            card: { tag: 'KEY IDEA', title: 'Predicting forces learning', body: 'To predict the next token well the model must model syntax, facts and causal structure. Loss falls smoothly with more data.' },
            deep: '<p>The loss is a code length: minimising it is compression of the corpus, so a model that predicts well has implicitly learned the regularities that make text compressible: grammar, facts, arithmetic, code semantics, narrative physics. Empirically, loss falls as a smooth power law in data, parameters and compute (next step).</p>' +
              '<div class="eq">L(D) = E + B / D<sup>β</sup>, &nbsp; β ≈ 0.37</div>'
          },
          {
            say: 'The bill is roughly six times parameters times tokens: for Llama 3 405B that is about four times ten to the twenty fifth floating point operations.',
            card: { tag: 'NUMBERS', title: 'The compute bill', stat: { v: '3.8 × 10²⁵', u: 'FLOPs', l: 'to pretrain Llama 3 405B on 15.6 T tokens: 6 × N × D' }, more: '<p>A dense transformer with N parameters does 2N FLOPs per token in the forward pass (one multiply and one add per weight). The backward pass needs gradients with respect to activations and to weights, about twice the forward cost, so 4N. The total is 6N per token, or 6ND for D tokens. Attention’s score terms add about 12·L·d·n FLOPs per token at context n: small at 4k tokens, not at 128k, which is why 6ND is an approximation.</p>' },
            deep: '<div class="eq">C ≈ 6·N·D &nbsp; (2ND forward + 4ND backward)</div>' +
              '<table><tr><th>Model</th><th>N</th><th>D</th><th>Compute</th></tr>' +
              '<tr><td>Llama 3 405B</td><td>405 B dense</td><td>15.6 T</td><td>≈ 3.8×10<sup>25</sup> FLOPs; 30.8 M H100-hours</td></tr>' +
              '<tr><td>DeepSeek-V3</td><td>37 B active / 671 B</td><td>14.8 T</td><td>2.79 M H800-hours (full training)</td></tr>' +
              '<tr><td>Qwen3</td><td>up to 235 B-A22B</td><td>36 T</td><td>—</td></tr></table>' +
              '<p>Training runs in BF16 (or FP8 GEMMs, as in DeepSeek-V3) with FP32 master weights and AdamW, sharded over thousands of GPUs with data, tensor, pipeline, expert and context parallelism; Llama 3 reports 38–43% MFU. Loss spikes are handled in practice with tools such as z-loss, QK-norm, gradient clipping and restarts.</p>'
          }
        ],
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
          S.inC = []; S.tgC = []; S.lb = []; S.lt = []; S.pT = [];
          var lossG = ctx.group({ parent: L });
          for (var i = 0; i < 10; i++) {
            var x = 146 + i * 80;
            S.inC.push(chipAt(x, 236, toks[i], 'cyan'));
            S.tgC.push(chipAt(x, 300, toks[i + 1], 'amber'));
            ctx.line(x, 250, x, 286, { color: ctx.alpha('white', 0.25), sw: 1, arrow: true, parent: L });
            S.pT.push(ctx.text(x, 326, 'p=' + P[i].toFixed(2), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: lossG }));
            var loss = -Math.log(P[i]);
            S.lb.push({ r: ctx.rect(x - 22, 520, 44, 0, { rx: 3, fill: ctx.alpha('red', 0.5), stroke: 'red', sw: 1, parent: lossG }), h: loss * 44 });
            S.lt.push(ctx.text(x, 520 - loss * 44 - 10, loss.toFixed(2), { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: lossG }));
          }
          ctx.line(96, 520, 940, 520, { color: ctx.alpha('white', 0.3), parent: lossG });
          ctx.text(96, 544, '−log p(target) per position', { size: 12, font: 'mono', color: 'red', parent: lossG });
          var mean = P.reduce(function (a, p) { return a - Math.log(p); }, 0) / 10;
          S.meanT = ctx.text(940, 544, 'mean loss = ' + mean.toFixed(2) + '  ·  perplexity ' + Math.exp(mean).toFixed(1), { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: lossG });
          S.cursor = ctx.rect(106, 220, 80, 116, { rx: 6, stroke: 'white', sw: 1.6, parent: L, glow: true });
          S.cursor.setAttribute('opacity', 0);
          S.hl0 = ctx.rect(106, 220, 80, 116, { rx: 6, stroke: 'red', sw: 1.6, dash: '5 4', parent: L });
          S.hl5 = ctx.rect(106 + 5 * 80, 220, 80, 116, { rx: 6, stroke: 'lime', sw: 1.6, dash: '5 4', parent: L });
          hide(L, lossG, S.pT, S.lt, S.meanT, S.hl0, S.hl5);

          var R = card(ctx, g, 990, 176, 550, 390, 'amber', 'LOSS vs TOKENS SEEN (log)');
          S.curve = ctx.plot(1050, 230, 450, 270, function (x) { return 1.82 + 2085.43 / Math.pow(10, 0.3658 * x); }, { xDomain: [9, 13.2], yDomain: [1.8, 3.0], color: 'amber', sw: 2.5, parent: R });
          [[9, '1B'], [10, '10B'], [11, '100B'], [12, '1T'], [13, '10T']].forEach(function (t) { var p = S.curve.toPx(t[0], 1.8); ctx.text(p.x, 516, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: R }); });
          [2.0, 2.4, 2.8].forEach(function (v) { var p = S.curve.toPx(9, v); ctx.text(1040, p.y, v.toFixed(1), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: R }); });
          ctx.text(1500, 548, 'L(D) = E + B / D^β   (β ≈ 0.37)', { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: R });
          hide(R, S.curve.curve);

          var B = textCard(ctx, g, 60, 590, 1480, 270, 'orange', 'COMPUTE', [
            'C ≈ 6 · N · D     (2ND forward + 4ND backward, dense transformer)',
            'Llama 3 405B:  6 × 405e9 × 15.6e12 ≈ 3.8 × 10²⁵ FLOPs  →  30.8 M H100-hours reported, ~40% MFU',
            'DeepSeek-V3:   6 × 37 B active × 14.8 T ≈ 3.3 × 10²⁴ FLOPs, FP8 GEMMs  →  2.79 M H800-hours for the whole run',
            'same objective at every one of those ~10¹³ positions: −log p_θ(x_{t+1} | x_≤t)'
          ], { lh: 44, top: 64 });
          hide(B, B.lines);

          function bars(t) { S.lb.forEach(function (b) { var h = b.h * t; b.r.setAttribute('y', 520 - h); b.r.setAttribute('height', h); }); S.lt.forEach(function (x) { x.setAttribute('opacity', t >= 1 ? 1 : 0); }); }
          bars(0);

          /* beat 0: inputs and next-token targets */
          return ctx.reveal(L, { from: 'left' }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: sweep along the sentence, scoring every position */
            ctx.reveal(lossG, { dur: 300 });
            S.cursor.setAttribute('opacity', 1);
            return ctx.tween(3000, function (t) {
              var k = Math.min(9, Math.floor(t * 10));
              S.cursor.setAttribute('x', 106 + k * 80);
              S.lb.forEach(function (b, j) { var h = j < k ? b.h : (j === k ? b.h * (t * 10 - k) : 0); b.r.setAttribute('y', 520 - h); b.r.setAttribute('height', h); });
              S.lt.forEach(function (x, j) { x.setAttribute('opacity', j < k ? 1 : 0); });
              S.pT.forEach(function (x, j) { x.setAttribute('opacity', j <= k ? 1 : 0); });
            }, 'linear', 300).then(function () {
              bars(1);
              S.pT.forEach(function (x) { x.setAttribute('opacity', 1); });
              S.cursor.setAttribute('opacity', 0);
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: rare continuations are expensive, easy ones are cheap */
            ctx.reveal(S.meanT, {});
            return Promise.all([ctx.reveal(S.hl0, { dur: 400 }), ctx.reveal(S.hl5, { dur: 400, delay: 300 })]).then(function () {
              ctx.pulse(S.lb[0].r, { color: 'red', dur: 700 });
              return ctx.pulse(S.lb[5].r, { color: 'lime', dur: 700 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: with enough tokens the loss falls as a smooth power law */
            ctx.reveal(R, { from: 'right', dur: 600 });
            return ctx.reveal(S.curve.curve, { from: 'draw', dur: 1400, delay: 400 });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: the compute bill, 6 N D */
            ctx.reveal(B, { from: 'up', dur: 600 });
            return ctx.reveal(B.lines, { from: 'left', dur: 400, stagger: 220, delay: 300 });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Scaling & data',
        beats: [
          {
            say: 'How big, and how long? The Chinchilla study fit loss as a function of parameters and tokens and found that, for a fixed compute budget, the optimum is roughly twenty tokens per parameter.',
            card: { tag: 'NUMBERS', title: 'The Chinchilla ratio', stat: { v: '≈ 20', u: 'tokens / param', l: 'compute-optimal ratio: Chinchilla\'s 70 B model saw 1.4 T tokens' }, more: '<p>Minimise L(N, D) = E + A/N<sup>α</sup> + B/D<sup>β</sup> subject to 6ND = C. Setting the derivative to zero gives αA/N<sup>α</sup> = βB/D<sup>β</sup>, so N<sub>opt</sub> ∝ C<sup>β/(α+β)</sup> and D<sub>opt</sub> ∝ C<sup>α/(α+β)</sup>. With the replication fit (α ≈ 0.35, β ≈ 0.37) both exponents are close to 0.5: parameters and tokens should grow together, at about 20 tokens per parameter.</p>' },
            deep: '<div class="eq">L(N, D) = E + A/N<sup>α</sup> + B/D<sup>β</sup>, &nbsp; C = 6ND</div>' +
              '<p>Fit (Besiroglu et al. replication of Chinchilla): E = 1.82, A = 482, B = 2085, α = 0.348, β = 0.366. Minimising at fixed C gives N<sub>opt</sub> ∝ C<sup>0.51</sup>, D<sub>opt</sub> ∝ C<sup>0.49</sup>, i.e. ~20 tokens/param; at Chinchilla’s 5.76×10<sup>23</sup> FLOPs the fit gives N ≈ 72 B, D ≈ 1.3 T (Chinchilla itself: 70 B on 1.4 T).</p>'
          },
          {
            say: 'Try it yourself: click anywhere on the curve to trade parameters for tokens at the same compute. A model that is too small underfits, one that is too big is undertrained, and the minimum sits near seventy billion parameters.',
            card: { tag: 'TRY IT', title: 'Slide along the curve', body: 'Every point costs the same 5.76e23 FLOPs. Click a model size and read off its tokens, tokens per parameter and predicted loss.' },
            deep: '<p>At fixed compute C = 6ND, more parameters mean fewer tokens: D = C / 6N. The predicted loss along this iso-FLOP curve is a model term that falls with N plus a data term that rises with N, hence the U shape:</p>' +
              '<div class="eq">L(N) = E + A/N<sup>α</sup> + B·(6N/C)<sup>β</sup></div>' +
              '<table><tr><th>N</th><th>D</th><th>tok / param</th><th>loss</th></tr>' +
              '<tr><td>10 B</td><td>9.6 T</td><td>960</td><td>2.018</td></tr>' +
              '<tr><td><b>72 B</b></td><td><b>1.3 T</b></td><td><b>18</b></td><td><b>1.977</b></td></tr>' +
              '<tr><td>1 T</td><td>96 B</td><td>0.1</td><td>2.053</td></tr></table>' +
              '<p>The valley is flat: a 10 B model trained on 9.6 T tokens costs the same training compute and gives up only 0.04 nats, yet is 7 times cheaper to serve. That flatness is the argument for overtraining in the next beat.</p>' +
              '<p class="muted">Click the plot on the stage to move the marker. Values follow the replication fit E = 1.82, A = 482, B = 2085, α = 0.348, β = 0.366.</p>'
          },
          {
            say: 'Modern models deliberately overtrain far past that point, because a smaller model trained longer is much cheaper to serve to millions of agent calls.',
            card: { tag: 'NUMBERS', title: 'Overtrained on purpose', stat: { v: '1,875', l: 'tokens per parameter for Llama 3 8B (15 T tokens): about 94 times the Chinchilla optimum' } },
            deep: '<p><b>Overtraining</b> is inference-optimal: the compute-optimal model minimises <i>training</i> cost, but a model that will serve billions of tokens should be smaller and trained longer. Llama 3 8B saw 15 T tokens (~1,900 tokens/param); DeepSeek-V3 ~400 tokens per <i>active</i> param. Loss keeps improving log-linearly well past the Chinchilla point.</p>'
          },
          {
            say: 'The data matters as much as the size: web crawls are extracted, filtered by quality classifiers, and deduplicated with MinHash.',
            card: { tag: 'HOW IT WORKS', title: 'From crawl to corpus', body: 'Extraction, language ID, quality filters and near-duplicate removal shrink raw crawls to the fraction worth training on.' },
            deep: '<ul><li><b>Filtering</b>: heuristic rules plus model-based classifiers. FineWeb applies heuristic filters to 96 Common Crawl snapshots and keeps 15 T tokens; its FineWeb-Edu subset adds an educational-value classifier and keeps about 1.3 T.</li>' +
              '<li><b>Dedup</b>: MinHash-LSH near-duplicate removal (FineWeb: 5-gram shingles, 112 hashes in 14 buckets of 8, run per snapshot because global dedup hurt quality); some pipelines add URL, exact-line or suffix-array substring dedup. Less memorisation, better generalisation.</li></ul>' +
              '<p>Text extraction (boilerplate removal) and language identification come first. Near-duplicate removal matters because repeated documents are memorised and waste tokens that could teach something new.</p>'
          },
          {
            say: 'Then the text is decontaminated against benchmarks, screened for personal data and safety, and mixed with code and math in tuned proportions.',
            card: { tag: 'NUMBERS', title: 'The final mixture', stat: { v: '50·25·17·8', u: '%', l: 'Llama 3 mix: general knowledge, math and reasoning, code, multilingual' } },
            deep: '<ul><li><b>Decontamination</b> against benchmarks, PII and safety filtering.</li>' +
              '<li><b>Mixture</b> (Llama 3 final): ~50% general knowledge, 25% math and reasoning, 17% code, 8% multilingual; weights tuned with small proxy models and scaling-law extrapolation.</li></ul>' +
              '<p>Dedup reduces memorisation; decontamination keeps benchmark scores honest. Math and reasoning (25%) and code (17%) get a deliberate share in Llama 3 because they teach reasoning structure, while multilingual data is a smaller slice (8%).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var C = 5.76e23;
          function lossAt(lgN) { var N = Math.pow(10, lgN), D = C / (6 * N); return 1.82 + 482.01 / Math.pow(N, 0.3478) + 2085.43 / Math.pow(D, 0.3658); }
          var L = card(ctx, g, 60, 176, 720, 404, 'amber', 'ISO-FLOP CURVE · C = 5.76e23 (Chinchilla budget)');
          S.iso = ctx.plot(130, 226, 610, 270, lossAt, { xDomain: [9.5, 12], yDomain: [1.96, 2.09], color: 'amber', sw: 2.5, parent: L, samples: 100 });
          [[10, '10B'], [10.5, '32B'], [11, '100B'], [11.5, '316B'], [12, '1T']].forEach(function (t) { var p = S.iso.toPx(t[0], 1.96); ctx.text(p.x, 512, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: L }); });
          [1.98, 2.02, 2.06].forEach(function (v) { var p = S.iso.toPx(9.5, v); ctx.text(122, p.y, v.toFixed(2), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L }); });
          ctx.text(130, 534, 'parameters N (log) · D = C / 6N', { size: 11, font: 'mono', color: 'dim', parent: L });
          var best = 9.5, bl = 9;
          for (var q = 9.5; q <= 12; q += 0.01) { var v = lossAt(q); if (v < bl) { bl = v; best = q; } }
          var bp = S.iso.toPx(best, bl);
          S.opt = ctx.group({ parent: L });
          ctx.circle(bp.x, bp.y, 7, { fill: 'white', parent: S.opt, glow: true });
          ctx.text(435, 560, 'optimum N ≈ ' + Math.round(Math.pow(10, best) / 1e9) + ' B, D ≈ ' + (C / 6 / Math.pow(10, best) / 1e12).toFixed(1) + ' T  (~' + Math.round(C / 6 / Math.pow(10, 2 * best)) + ' tok/param)', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.opt });
          ctx.text(200, 250, 'too small: under-fit', { size: 11, font: 'mono', color: 'dim', parent: L });
          ctx.text(730, 250, 'too big: under-trained', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });

          /* TRY IT: a marker that follows the model size chosen by a click on the plot */
          function fmtBig(v) { var u = v >= 1e12 ? [1e12, 'T'] : (v >= 1e9 ? [1e9, 'B'] : [1e6, 'M']), x = v / u[0]; return (x >= 10 ? x.toFixed(0) : x.toFixed(1)) + ' ' + u[1]; }
          S.mkG = ctx.group({ parent: L });
          var mkV = ctx.line(0, 0, 0, 0, { color: ctx.alpha('amber', 0.7), dash: '3 4', parent: S.mkG });
          var mkC = ctx.circle(0, 0, 6, { fill: 'amber', stroke: 'white', sw: 1.4, parent: S.mkG, glow: true });
          S.readout = ctx.label(435, 224, '', { color: 'amber', size: 12, w: 470, parent: L });
          function pickN(lgN) {
            lgN = ctx.clamp(lgN, 9.5, 12);
            var N = Math.pow(10, lgN), D = C / (6 * N), ls = lossAt(lgN);
            var p = S.iso.toPx(lgN, ls), pb = S.iso.toPx(lgN, 1.96);
            mkV.setAttribute('x1', p.x); mkV.setAttribute('x2', p.x); mkV.setAttribute('y1', p.y); mkV.setAttribute('y2', pb.y);
            mkC.setAttribute('cx', p.x); mkC.setAttribute('cy', p.y);
            var tpp = D / N;
            S.readout.setText('N = ' + fmtBig(N) + '  ·  D = ' + fmtBig(D) + '  ·  ' + (tpp >= 10 ? Math.round(tpp) : tpp.toFixed(1)) + ' tok/param  ·  L = ' + ls.toFixed(3));
          }
          S.hit = ctx.rect(130, 226, 610, 270, { fill: 'rgba(0,0,0,0.001)', parent: L });
          S.hit.style.cursor = 'crosshair';
          S.hit.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (!S.interactive || S.sweeping) return;
            var svg = S.hit.ownerSVGElement, m = S.hit.getScreenCTM();
            if (!svg || !m) return;
            var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
            var loc = pt.matrixTransform(m.inverse());
            pickN(9.5 + (loc.x - 130) / 610 * 2.5);
          });
          pickN(best);
          hide(L, S.iso.curve, S.opt, S.mkG, S.readout);

          var R = card(ctx, g, 810, 176, 730, 404, 'orange', 'TOKENS PER PARAMETER (log): overtraining');
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
          ctx.text(cx + 6, 534, 'compute-optimal ≈ 20', { size: 11, font: 'mono', color: 'white', parent: R });
          ctx.text(1520, 562, 'smaller + longer = cheaper to serve', { size: 12, font: 'mono', color: 'orange', anchor: 'end', parent: R });
          hide(R);

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
          var note = ctx.group({ parent: B });
          ctx.text(800, 790, 'FineWeb: 15 T tokens survive from 96 crawls · Llama 3 mix: 50% general · 25% math/reasoning · 17% code · 8% multilingual', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: note });
          ctx.text(800, 820, 'dedup reduces memorisation; decontamination keeps benchmark scores honest; mix weights tuned on small proxy models', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: note });
          hide(B, S.dn.slice(3), S.dl.slice(2), note);

          function grow(t) { S.tp.forEach(function (e) { e.b.setAttribute('width', e.w * t); e.t.setAttribute('x', 1036 + e.w * t); }); }
          grow(0);

          /* beat 0: the compute-optimal point of the iso-FLOP curve */
          return ctx.reveal(L, { from: 'left' }).then(function () {
            return ctx.reveal(S.iso.curve, { from: 'draw', dur: 1300 });
          }).then(function () {
            return ctx.reveal(S.opt, { dur: 500 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the marker sweeps to a small and a big model and back to the optimum; then the plot is clickable */
            S.interactive = true; S.sweeping = true;
            ctx.reveal(S.mkG, { dur: 400 });
            ctx.reveal(S.readout, { from: 'down', dur: 400 });
            var cur = best, ch = ctx.wait(500);
            [10.0, 11.6, best].forEach(function (target) {
              ch = ch.then(function () {
                var from = cur; cur = target;
                return ctx.tween(1100, function (t) { pickN(from + (target - from) * t); }, 'inOut');
              }).then(function () { return ctx.wait(500); });
            });
            return ch.then(function () { S.sweeping = false; });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: modern models overtrain */
            ctx.reveal(R, { from: 'right', dur: 600 });
            return ctx.tween(1200, grow, 'out', 400);
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: crawl, extract, filter */
            return ctx.reveal(B, { from: 'up', dur: 600 }).then(function () {
              var ch = Promise.resolve();
              S.dl.slice(0, 2).forEach(function (l) { ch = ch.then(function () { return ctx.packet(l, { color: 'teal', dur: 350, r: 4 }); }); });
              return ch;
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: dedup, decontaminate, mix */
            ctx.reveal(S.dn.slice(3), { from: 'right', stagger: 200, dur: 500 });
            return ctx.reveal(S.dl.slice(2), { from: 'draw', stagger: 200, delay: 200 }).then(function () {
              var ch = Promise.resolve();
              S.dl.slice(2).forEach(function (l) { ch = ch.then(function () { return ctx.packet(l, { color: 'teal', dur: 350, r: 4 }); }); });
              return ch;
            }).then(function () {
              return ctx.reveal(note, { from: 'up', dur: 500 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Mid-training',
        beats: [
          {
            say: 'Between raw pretraining and fine tuning sits mid training. The learning rate warms up, stays high for most of the tokens, and then decays.',
            card: { tag: 'KEY IDEA', title: 'Warmup, stable, decay', body: 'A long constant-rate phase does the bulk of the tokens; a short decay at the end is where quality is consolidated.' },
            deep: '<ul><li><b>LR schedule</b>: cosine, or <b>warmup–stable–decay</b> (WSD): a long constant-LR phase lets you branch cheap decay runs from any checkpoint; most of the quality gain from high-quality data shows up during the decay.</li>' +
              '<li>Warmup (a few thousand steps) avoids early divergence with AdamW. DeepSeek-V3, for instance, warms up over 2,000 steps to 2.2×10<sup>−4</sup>, holds that for the first 10 T tokens, then decays by a cosine to 2.2×10<sup>−5</sup> over the next 4.3 T. Llama 3 used a plain cosine (peak 3×10<sup>−4</sup> for the 8B model).</li></ul>'
          },
          {
            say: 'During that decay the data mix shifts toward the best material: curated code, math, reasoning traces and textbook quality text. This annealing phase buys a surprising amount of benchmark quality.',
            card: { tag: 'NUMBERS', title: 'Annealing pays off', stat: { v: '+24%', l: 'GSM8K gain for Llama 3 8B from annealing on small amounts of code and math; negligible at 405 B' }, more: '<p>Why annealing helps: while the learning rate is high, SGD noise keeps the weights moving around a broad basin; decaying it lets the model settle into a sharper minimum, and the data it sees during the decay has an outsized influence on where it settles. That makes the final 1–10% of tokens the best place for the highest-quality data, and makes annealing runs a cheap test of whether a candidate dataset is worth including.</p>' },
            deep: '<ul><li><b>Annealing mix</b>: Llama 3 linearly annealed the LR to 0 over the final 40 M tokens while upsampling very high quality sources; annealing small amounts of curated code/math measurably lifts GSM8K-style scores (+24.0% for the 8B model, negligible for 405B) and is also used to <i>evaluate</i> candidate datasets cheaply.</li>' +
              '<li><b>Synthetic reasoning data</b>: long chain-of-thought traces, often distilled from a reasoning model, are mixed in at this stage to prime the base model for later reinforcement learning.</li></ul>'
          },
          {
            say: 'The context window is also stretched in stages, from eight thousand to one hundred twenty eight thousand tokens, by rescaling rotary position frequencies and training on long documents.',
            card: { tag: 'NUMBERS', title: 'Stretching the window', stat: { v: '~800 B', u: 'tokens', l: 'for Llama 3\'s six-stage extension from 8k to 128k context' } },
            deep: '<ul><li><b>Long context</b>: Llama 3 extended 8k → 128k in six stages using ~800 B tokens, RoPE base θ = 500,000; alternatives rescale frequencies (NTK-aware, YaRN). Success criteria: short-context scores recover and needle-in-a-haystack retrieval passes.</li>' +
              '<li>Long documents (books, repos, transcripts) at 32k–128k teach long-range retrieval; stage lengths shown are illustrative.</li>' +
              '<li><b>Multimodal</b>: for VLMs, interleaved image-text and video-text data plus the vision projector are introduced in this phase (see the Multimodal chamber).</li></ul>'
          },
          {
            say: 'Our director agent needs that to keep the whole storyboard, script and tool history in view.',
            card: { tag: 'WHY IT MATTERS', title: 'Agents live in long context', body: 'The director\'s brief, plan, six shot briefs and tool transcript add up to about 12k tokens, and grow with every retry. Without long-context training they fall out of view.' },
            deep: '<p>Our director\'s window for the trailer (illustrative token counts): <b>system prompt + tool schemas ≈ 2.5k</b>; the creator\'s request with three sketch captions and the memo transcript ≈ 1k; script and storyboard ≈ 3.5k; six shot briefs ≈ 3k; tool calls and results so far ≈ 2k. Total ≈ 12k, and every re-render or critic note appends more.</p>' +
              '<p>A long window is not free: one 128k sequence costs 40 GiB of KV cache on a 70B-class model (see the Attention chamber), and the <i>effective</i> context is usually shorter than the claimed one. Retrieval quality degrades well before the limit unless the model was trained on genuinely long documents, which is what this stage is for (needle-in-a-haystack and RULER-style evaluations check it).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var L = card(ctx, g, 60, 176, 760, 390, 'orange', 'LEARNING RATE · warmup – stable – decay');
          var pts = [[0, 0], [0.03, 1], [0.8, 1], [1, 0.02]];
          S.lr = ctx.plot(120, 230, 660, 250, pts, { xDomain: [0, 1], yDomain: [0, 1.1], color: 'orange', sw: 2.5, parent: L });
          var a = S.lr.toPx(0.8, 0), b = S.lr.toPx(1, 1.1);
          S.anneal = ctx.group({ parent: L });
          ctx.rect(a.x, b.y, b.x - a.x, a.y - b.y, { rx: 0, fill: ctx.alpha('lime', 0.1), stroke: ctx.alpha('lime', 0.5), sw: 1, dash: '4 4', parent: S.anneal });
          ctx.text((a.x + b.x) / 2, b.y + 18, 'anneal', { size: 12, font: 'mono', weight: 700, color: 'lime', anchor: 'middle', parent: S.anneal });
          ctx.para(a.x - 12, 330, ['data mix switches to', 'curated code · math ·', 'reasoning · long docs'], { size: 12, font: 'mono', color: 'lime', anchor: 'end', lh: 18, parent: S.anneal });
          ctx.text(126, 500, 'warmup', { size: 11, font: 'mono', color: 'dim', parent: L });
          ctx.text(400, 500, 'stable (bulk of pretraining tokens)', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: L });
          ctx.text(780, 520, 'tokens →', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          ctx.text(112, 222, 'lr', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: L });
          hide(L, S.lr.curve, S.anneal);

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
          hide(R);

          var B = textCard(ctx, g, 60, 590, 1480, 270, 'orange', 'WHAT GOES INTO MID-TRAINING', [
            'curated code, math and textbook-quality text, upsampled while the learning rate decays',
            'synthetic long chain-of-thought traces that prime the model for later reasoning RL',
            'long documents (books, repos, transcripts) at 32k–128k to teach long-range retrieval',
            'for multimodal models: interleaved image-text and video-text, projector alignment'
          ], { lh: 44, top: 64 });
          hide(B, B.lines);

          /* the director's context budget: 12k tokens of a 128k window, then the 12k magnified */
          var BUD = card(ctx, g, 60, 590, 1480, 270, 'magenta', 'OUR DIRECTOR AGENT · ONE CONTEXT WINDOW (illustrative token counts)');
          ctx.text(84, 638, 'window: 128k tokens', { size: 12, font: 'mono', color: 'dim', parent: BUD });
          ctx.rect(84, 650, 1400, 18, { rx: 4, fill: 'rgba(255,255,255,0.04)', stroke: ctx.alpha('magenta', 0.35), sw: 1, parent: BUD });
          ctx.rect(84, 650, 1400 * 12 / 128, 18, { rx: 4, fill: ctx.alpha('magenta', 0.55), stroke: 'magenta', sw: 1, parent: BUD });
          ctx.text(84 + 1400 * 12 / 128 + 12, 659.5, '12k used (9%)', { size: 12, font: 'mono', color: 'white', parent: BUD });
          ctx.text(1484, 659.5, '116k free for retries, revisions, critic notes', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: BUD });
          ctx.text(84, 702, 'the 12k, magnified', { size: 12, font: 'mono', color: 'dim', parent: BUD });
          var budSeg = [['system + tools', '2.5k', 2.5, 'amber'], ['request + memo', '1.0k', 1.0, 'cyan'], ['script + board', '3.5k', 3.5, 'violet'], ['six shot briefs', '3.0k', 3.0, 'lime'], ['calls + results', '2.0k', 2.0, 'teal']];
          var bx0 = 84;
          S.budSegs = budSeg.map(function (s) {
            var w = s[2] / 12 * 1400, gseg = ctx.group({ parent: BUD });
            ctx.rect(bx0 + 1, 714, w - 2, 34, { rx: 4, fill: ctx.alpha(s[3], 0.4), stroke: s[3], sw: 1, parent: gseg });
            ctx.text(bx0 + w / 2, 768, s[0], { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: gseg });
            ctx.text(bx0 + w / 2, 790, s[1], { size: 12, font: 'mono', weight: 700, color: s[3], anchor: 'middle', parent: gseg });
            bx0 += w;
            return gseg;
          });
          ctx.text(84, 832, 'every retry appends more: a long window keeps the whole history in view, at 40 GiB of KV cache per 128k sequence on a 70B-class model', { size: 12, font: 'mono', color: 'dim', parent: BUD });
          hide(BUD, S.budSegs);

          function grow(t) { S.ctxBars.forEach(function (e) { e.b.setAttribute('width', e.w * t); e.t.setAttribute('x', 952 + e.w * t); }); }
          grow(0);

          /* beat 0: warmup, stable, decay */
          return ctx.reveal(L, { from: 'left' }).then(function () {
            return ctx.reveal(S.lr.curve, { from: 'draw', dur: 1400 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: annealing on the best data (the first two lines of what goes into this stage) */
            ctx.reveal(B, { from: 'up', dur: 500 });
            ctx.reveal(B.lines.slice(0, 2), { from: 'left', dur: 400, stagger: 250, delay: 400 });
            ctx.reveal(S.anneal, { dur: 500 });
            return ctx.pulse(S.anneal, { color: 'lime', dur: 700, times: 2 });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: context stretched in stages (long documents and multimodal data join the list) */
            ctx.reveal(B.lines.slice(2), { from: 'left', dur: 400, stagger: 250, delay: 600 });
            ctx.reveal(R, { from: 'right', dur: 600 });
            return ctx.wait(500).then(function () {
              var ch = Promise.resolve();
              S.ctxBars.forEach(function (e) {
                ch = ch.then(function () { return ctx.tween(350, function (t) { e.b.setAttribute('width', e.w * t); e.t.setAttribute('x', 952 + e.w * t); }, 'out'); });
              });
              return ch;
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: what the long window is for: the director's own context budget replaces the checklist */
            ctx.fade(B, 0, 450);
            return ctx.reveal(BUD, { from: 'up', dur: 600, delay: 200 }).then(function () {
              return ctx.reveal(S.budSegs, { from: 'left', stagger: 160, dur: 400 });
            });
          });
        }
      }
            ,
      /* ------------------------------------------------------------ 5 */
      {
        title: 'SFT & masking',
        beats: [
          {
            say: 'Supervised fine tuning turns a document completer into an assistant. Each training example is a full conversation rendered into a chat template: a system prompt, the user\'s request, the assistant\'s reply, a tool call, the tool\'s result, and the final answer.',
            card: { tag: 'KEY IDEA', title: 'A chat as one sequence', body: 'Roles, tool calls and tool results are flattened by a chat template into one token stream, the same format the model sees at serving time.' },
            deep: '<p><b>Chat template</b>: role headers and special tokens (e.g. <code>&lt;&#8202;|start_header_id|&#8202;&gt;assistant</code>) make roles unambiguous; tool calls use a reserved format that the serving stack parses back into JSON. Training on exactly the serving format removes train/serve skew.</p>' +
              '<p>Each example here is six segments: system, user, assistant plan, a <code>render_shot</code> call, its result, and the next assistant turn.</p>'
          },
          {
            say: 'The model is trained with the same next token loss, but only on the tokens the assistant produced.',
            card: { tag: 'HOW IT WORKS', title: 'Same loss, masked', body: 'm_t is 1 only for assistant text and tool-call JSON. Everything else is context, never a target.' },
            deep: '<div class="eq">L<sub>SFT</sub> = − Σ<sub>t</sub> m<sub>t</sub> log p<sub>θ</sub>(x<sub>t</sub> | x<sub>&lt;t</sub>) / Σ<sub>t</sub> m<sub>t</sub>, &nbsp; m<sub>t</sub> = 1 iff token t was written by the assistant</div>' +
              '<p>The forward pass still reads every token, since system, user and tool text are all context; the mask only removes them from the loss, so no gradient is spent on predicting them. The normaliser Σ m<sub>t</sub> keeps the loss scale independent of how much of the example is assistant text.</p>'
          },
          {
            say: 'System, user and tool result tokens are masked out: the model learns to act, not to imitate the environment.',
            card: { tag: 'PITFALL', title: 'Never train on tool results', body: 'Unmasked tool outputs teach the model to hallucinate observations, and user turns waste capacity on imitating users.' },
            deep: '<ul><li><b>Why mask</b>: training on tool outputs would teach the model to <i>hallucinate</i> tool results instead of waiting for them; training on user turns wastes capacity on imitating users.</li>' +
              '<li>In the example, the system prompt, the user request and the tool result are context only (dimmed rows); the plan, the tool-call JSON and the follow-up are the targets (underlined).</li></ul>'
          },
          {
            say: 'Tool use trajectories, executed for real in sandboxes, teach it to emit exact JSON arguments and to read real error messages.',
            card: { tag: 'HOW IT WORKS', title: 'Executed trajectories', body: 'About 10⁵–10⁶ examples for 1–3 epochs. Real tool runs give real results and errors, so quality beats volume.' },
            deep: '<ul><li><b>Data</b>: human demonstrations, synthetic data from stronger models filtered by rejection sampling, and <b>executed</b> tool trajectories (the call really ran in a sandbox, the result is real).</li>' +
              '<li><b>Scale</b>: ~10<sup>5</sup>–10<sup>6</sup> examples, 1–3 epochs, LR ~10<sup>−5</sup>, sequence packing with per-document attention masks. Quality and diversity matter far more than volume.</li></ul>'
          }
        ],
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
          var lossHead = ctx.text(944, 206, 'loss', { size: 12, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: L });
          S.rows = rows.map(function (r, i) {
            var y = 244 + i * 50, rg = ctx.group({ parent: L });
            ctx.label(140, y, r[0], { color: r[2], size: 12, w: 110, parent: rg });
            ctx.rect(206, y - 17, 690, 34, { rx: 6, fill: ctx.alpha(r[2], r[3] ? 0.14 : 0.05), stroke: ctx.alpha(r[2], 0.5), sw: 1, parent: rg });
            ctx.text(220, y + 0.5, r[1], { size: 13, font: 'code', color: r[3] ? 'white' : 'dim', parent: rg });
            rg.mark = ctx.group({ parent: rg });
            if (r[3]) ctx.icon('check', 944, y, 20, 'lime', { parent: rg.mark });
            else ctx.text(944, y + 1, 'masked', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: rg.mark });
            rg.under = ctx.rect(206, y + 19, 690, 3, { rx: 1, fill: r[3] ? 'lime' : 'none', parent: rg });
            rg.mark.setAttribute('opacity', 0);
            rg.under.setAttribute('opacity', 0);
            rg.pol = r[3];
            return rg;
          });
          var gradT = ctx.text(560, 552, 'gradient flows only through the underlined (assistant-written) tokens', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: L });
          hide(L, S.rows, lossHead, gradT);

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
          hide(R);

          var B = textCard(ctx, g, 60, 590, 1480, 270, 'cyan', 'WHERE SFT DATA COMES FROM', [
            'human demonstrations for hard, taste-driven tasks (e.g. shot descriptions a cinematographer would write)',
            'synthetic answers from stronger models, filtered by rejection sampling and reward models',
            'executed tool trajectories: calls really ran in sandboxes, so results and error messages are real',
            '~10⁵–10⁶ examples · 1–3 epochs · LR ~1e-5 · packed sequences with per-document attention masks'
          ], { lh: 44, top: 64 });
          hide(B, B.lines);

          /* beat 0: the conversation, row by row */
          ctx.reveal(L, { from: 'left', dur: 400 });
          return ctx.reveal(S.rows, { from: 'left', stagger: 220, delay: 300 }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the masked objective, a mark on every row */
            ctx.reveal(R, { from: 'right', dur: 600 });
            ctx.reveal(lossHead, {});
            return ctx.reveal(S.rows.map(function (r) { return r.mark; }), { from: 'scale', stagger: 200, dur: 350, delay: 300 });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: only assistant tokens carry gradient; context rows are masked */
            ctx.reveal(gradT, { from: 'up', dur: 500 });
            ctx.reveal(S.rows.map(function (r) { return r.under; }), { stagger: 150, dur: 350 });
            var ch = Promise.resolve();
            S.rows.forEach(function (r, i) { if (!r.pol) ch = ch.then(function () { return ctx.pulse(r, { color: 'red', dur: 500 }); }); });
            return ch;
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the trajectories are executed for real */
            ctx.reveal(B, { from: 'up', dur: 600 });
            ctx.reveal(B.lines, { from: 'left', dur: 400, stagger: 250, delay: 300 });
            return ctx.pulse(S.rows[3], { color: 'magenta', dur: 700, times: 2 });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Preferences',
        beats: [
          {
            say: 'Demonstrations teach what to do, preferences teach what is better. Labelers, human or AI, compare two responses to the same prompt.',
            card: { tag: 'KEY IDEA', title: 'Rankings, not demos', body: 'A pair of a chosen and a rejected answer to one prompt carries a comparative signal that a single demonstration cannot express.' },
            deep: '<p>Preference data are triples (x, y<sub>w</sub>, y<sub>l</sub>): a prompt with a preferred (“winner”) and a dispreferred (“loser”) answer. Labels come from human raters, from AI judges following a written policy (RLAIF, constitutional methods) or from rejection sampling with a reward model.</p>' +
              '<p>Comparisons are easier and more consistent for raters than absolute scores, and they capture things demonstrations cannot: which of two plausible shot descriptions a cinematographer would prefer.</p>'
          },
          {
            say: 'Classic RLHF trains a reward model on these pairs and then optimizes the policy with PPO against it, with a KL penalty that keeps it close to the reference model.',
            card: { tag: 'TRADE-OFF', title: 'Four models in memory', body: 'Policy, reference, reward and value model, plus on-policy sampling every step. Powerful, but fragile and open to reward hacking.' },
            deep: '<div class="eq">RM (Bradley–Terry): L = −log σ( r<sub>φ</sub>(x, y<sub>w</sub>) − r<sub>φ</sub>(x, y<sub>l</sub>) )</div>' +
              '<div class="eq">RLHF: max<sub>π</sub> E[ r<sub>φ</sub>(x, y) ] − β · KL( π(·|x) ‖ π<sub>ref</sub>(·|x) )</div>' +
              '<p>The KL term keeps the policy close to the SFT reference so it cannot drift into text that exploits blind spots of the reward model (InstructGPT recipe).</p>'
          },
          {
            say: 'Direct preference optimization skips the reward model: a simple loss raises the log probability ratio of the chosen answer relative to the rejected one.',
            card: { tag: 'KEY IDEA', title: 'The policy is the reward', body: 'DPO derives an implicit reward from the log-ratio against a reference model and trains on pairs with one supervised-style loss.', more: '<p>Start from max<sub>π</sub> E[r] − β·KL(π‖π<sub>ref</sub>). Its optimum is π*(y|x) = π<sub>ref</sub>(y|x)·e<sup>r(x,y)/β</sup> / Z(x). Solving for the reward gives r(x,y) = β log π*(y|x)/π<sub>ref</sub>(y|x) + β log Z(x). In the Bradley–Terry difference r(y<sub>w</sub>) − r(y<sub>l</sub>) the intractable log Z(x) cancels, leaving a loss that depends only on policy and reference log-probabilities.</p>' },
            deep: '<div class="eq">DPO: L = −log σ( β log π(y<sub>w</sub>|x)/π<sub>ref</sub>(y<sub>w</sub>|x) − β log π(y<sub>l</sub>|x)/π<sub>ref</sub>(y<sub>l</sub>|x) )</div>' +
              '<p>DPO follows from the closed-form optimum of the KL-regularised objective, π*(y|x) ∝ π<sub>ref</sub>(y|x)·e<sup>r(x,y)/β</sup>, so r̂(x,y) = β log π/π<sub>ref</sub> is an <i>implicit reward</i>. Plugging it into the Bradley–Terry loss removes the reward model and the RL loop.</p>'
          },
          {
            say: 'Watch the implicit reward margin grow as DPO trains: the chosen answer\'s reward rises and the rejected one\'s falls.',
            card: { tag: 'HOW IT WORKS', title: 'Margin up, loss down', body: 'Loss is −log σ(margin). As the gap between chosen and rejected grows, σ approaches 1 and the loss shrinks toward zero.' },
            deep: '<p>The animation shows the margin m = r̂(y<sub>w</sub>) − r̂(y<sub>l</sub>) growing from 0.3 to 3.2 over 400 illustrative steps. The loss log(1 + e<sup>−m</sup>) falls from 0.55 to 0.04, and the gradient shrinks with it, since ∂L/∂m = −σ(−m).</p>' +
              '<p class="muted">Numbers in the animation are illustrative. In practice watch the reward margin and the chosen-reward together: if both fall, the model is drifting off-distribution.</p>'
          },
          {
            say: 'The trade-off: reinforcement learning is on policy and flexible, direct optimization is cheap and offline but can drift. Iterative and AI feedback variants close much of the gap.',
            card: { tag: 'TRADE-OFF', title: 'On-policy or offline', body: 'PPO: flexible, four models, fragile. DPO: two models, one loss, can over-optimise. Llama 3 ran six rounds of SFT plus DPO.' },
            deep: '<table><tr><th></th><th>PPO-RLHF</th><th>DPO</th></tr>' +
              '<tr><td>models in memory</td><td>policy, reference, reward, value</td><td>policy, reference</td></tr>' +
              '<tr><td>data</td><td>on-policy samples</td><td>offline pairs</td></tr>' +
              '<tr><td>failure modes</td><td>reward hacking, instability</td><td>over-optimisation, drifts off-distribution</td></tr></table>' +
              '<p>Variants: IPO, KTO, SimPO, online/iterative DPO; <b>RLAIF</b> and constitutional methods replace human labels with model judgements under a written policy.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var A = card(ctx, g, 60, 176, 480, 400, 'violet', 'A PREFERENCE PAIR');
          ctx.para(80, 222, ['x: "Describe shot 3 for the', '    video model."'], { size: 13, font: 'code', color: 'white', lh: 20, parent: A });
          S.yw = card(ctx, A, 80, 272, 440, 120, 'lime', 'y_w  chosen');
          ctx.para(96, 318, ['Low-angle close-up; frost blooms', 'across the visor reflecting a blue', 'aurora. 35 mm, slow push-in, 5 s.'], { size: 12, font: 'code', color: 'text', lh: 19, parent: S.yw });
          S.yl = card(ctx, A, 80, 408, 440, 110, 'red', 'y_l  rejected');
          ctx.para(96, 454, ['A fox on ice. It looks cool.', 'Make it epic.'], { size: 12, font: 'code', color: 'text', lh: 19, parent: S.yl });
          ctx.text(300, 552, 'labeler (human or AI judge) prefers y_w', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: A });
          keepWS(A);
          hide(A);

          var R = card(ctx, g, 560, 176, 480, 400, 'amber', 'RLHF: REWARD MODEL + PPO');
          var n1 = ctx.node({ x: 800, y: 250, w: 380, h: 56, title: 'reward model r_φ', sub: 'Bradley–Terry on pairs', color: 'amber', titleSize: 15, subSize: 11, parent: R });
          var n2 = ctx.node({ x: 800, y: 366, w: 380, h: 56, title: 'PPO on policy π_θ', sub: 'max E[r] − β·KL(π ‖ π_ref)', color: 'amber', titleSize: 15, subSize: 11, parent: R });
          S.rl = ctx.link(n1, n2, { color: 'amber', parent: R, label: 'reward', labelDx: 44, labelDy: 0 });
          ctx.para(590, 440, ['4 models in memory:', 'policy · reference · reward · value', 'on-policy sampling every step', 'risk: policy exploits RM blind spots'], { size: 12, font: 'mono', color: 'text', lh: 24, parent: R });
          hide(R);

          var D = card(ctx, g, 1060, 176, 480, 400, 'lime', 'DPO: IMPLICIT REWARD MARGIN');
          ctx.para(1078, 222, ['implicit reward r(y) = β·log π_θ(y|x)/π_ref(y|x)', 'L = −log σ( r(y_w) − r(y_l) )'], { size: 13, font: 'mono', color: 'white', lh: 24, parent: D });
          var Z = 400;
          var mg = ctx.group({ parent: D });
          ctx.line(1090, Z, 1520, Z, { color: ctx.alpha('white', 0.3), parent: mg });
          S.bw = ctx.rect(1140, Z, 90, 0, { rx: 4, fill: ctx.alpha('lime', 0.5), stroke: 'lime', sw: 1, parent: mg });
          S.bl = ctx.rect(1260, Z, 90, 0, { rx: 4, fill: ctx.alpha('red', 0.5), stroke: 'red', sw: 1, parent: mg });
          ctx.text(1185, 516, 'r(y_w)', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: mg });
          ctx.text(1305, 516, 'r(y_l)', { size: 12, font: 'mono', color: 'red', anchor: 'middle', parent: mg });
          S.sig = ctx.text(1450, 330, '', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: mg });
          S.sig2 = ctx.text(1450, 354, '', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: mg });
          S.stepT = ctx.text(1450, 470, '', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: mg });
          hide(D, mg);

          var B = textCard(ctx, g, 60, 600, 1480, 260, 'violet', 'TRADE-OFFS', [
            'PPO-RLHF: on-policy and flexible, but 4 models, fragile hyper-parameters, and reward hacking of r_φ',
            'DPO: offline, 2 models, one supervised-style loss; can over-optimise and drift off-distribution',
            'iterative / online DPO, RLAIF and constitutional rules close much of the gap at far lower cost',
            'Llama 3 post-training: 6 rounds of SFT + rejection sampling + DPO, reward model used for filtering'
          ], { lh: 42, top: 62 });
          hide(B, B.lines);

          function setM(t) {
            var w = 0.2 + 1.6 * t, l = -0.1 - 1.3 * t;
            S.bw.setAttribute('y', Z - w * 60); S.bw.setAttribute('height', w * 60);
            S.bl.setAttribute('y', Z); S.bl.setAttribute('height', -l * 60);
            var m = w - l;
            S.sig.textContent = 'margin ' + m.toFixed(2);
            S.sig2.textContent = 'σ = ' + (1 / (1 + Math.exp(-m))).toFixed(2) + ' · loss ' + Math.log(1 + Math.exp(-m)).toFixed(2);
            S.stepT.textContent = 'training step ' + Math.round(t * 400);
          }
          setM(0);

          /* beat 0: a chosen and a rejected answer to one prompt */
          return ctx.reveal(A, { from: 'left' }).then(function () {
            return ctx.pulse(S.yw, { color: 'lime', dur: 600 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: RLHF, a reward model and PPO */
            return ctx.reveal(R, { from: 'up', dur: 600 }).then(function () {
              return ctx.packet(S.rl, { color: 'amber', dur: 700 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: DPO, an implicit reward */
            return ctx.reveal(D, { from: 'right', dur: 600 });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the reward margin grows during training */
            ctx.reveal(mg, { dur: 400 });
            return ctx.tween(2600, setM, 'inOut', 300).then(function () {
              ctx.pulse(S.bw, { color: 'lime', dur: 600 });
              return ctx.pulse(S.bl, { color: 'red', dur: 600 });
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: trade-offs between the two families */
            ctx.reveal(B, { from: 'up', dur: 600 });
            return ctx.reveal(B.lines, { from: 'left', dur: 400, stagger: 250, delay: 300 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'GRPO & reasoning',
        beats: [
          {
            say: 'For tasks with checkable answers, we can skip human labels entirely. Group relative policy optimization samples a group of answers to the same prompt, here eight.',
            card: { tag: 'KEY IDEA', title: 'Sample a group, not a pair', body: 'For one prompt, GRPO samples G answers from the current policy and compares their scores with each other.' },
            deep: '<p><b>GRPO</b> (DeepSeekMath, used for DeepSeek-R1) drops PPO’s learned value network. For each prompt q it samples a group of G outputs o<sub>1..G</sub> from the current policy π<sub>old</sub>, scores each one and uses the group itself as the baseline.</p>' +
              '<p>The prompt here is verifiable: “Split the 30 s trailer into 6 shots (≥ 3 s each) matching the beats; output JSON.” The bar lengths are the sampled response lengths in tokens.</p>'
          },
          {
            say: 'A verifier scores each one: did the JSON parse, do the six shot durations sum to exactly thirty seconds?',
            card: { tag: 'HOW IT WORKS', title: 'Rewards from a program', body: 'Rule-based checks replace a learned reward model: answer match, unit tests, format. Nothing to hack but the rules themselves.' },
            deep: '<ul><li><b>Rewards</b> (R1): rule-based accuracy (math answer match, code unit tests) + format reward; no neural reward model to hack.</li>' +
              '<li>Here 3 of 8 samples pass: o1, o4 and o7 sum to 30 s; the others fail because of a wrong sum (28 s, 32 s), a wrong shot count or invalid JSON.</li></ul>' +
              '<p>Verifiable rewards need no human labels and scale to millions of prompts, at the price of restricting training to tasks with checkers.</p>'
          },
          {
            say: 'Each answer\'s advantage is its reward minus the group mean, divided by the group standard deviation, so no value network is needed.',
            card: { tag: 'NUMBERS', title: 'Advantages from the group', stat: { v: '+1.29 / −0.77', l: 'advantages when 3 of 8 answers pass: mean 0.375, std 0.484' }, more: '<p>Why divide by the standard deviation: it makes the update size independent of the reward scale and equalises the pull of easy and hard prompts. Why it can hurt: for near-all-pass or near-all-fail groups the std is tiny and inflates the few informative samples. Dr. GRPO removes it, and DAPO drops groups whose rewards are all equal, since A = 0 there. With pass rate p = 3/8, std = √(p(1−p)) = 0.484.</p>' },
            deep: '<div class="eq">A<sub>i</sub> = (r<sub>i</sub> − mean(r<sub>1..G</sub>)) / std(r<sub>1..G</sub>)</div>' +
              '<div class="eq">J(θ) = E[ (1/G) Σ<sub>i</sub> (1/|o<sub>i</sub>|) Σ<sub>t</sub> min( ρ<sub>i,t</sub>A<sub>i</sub>, clip(ρ<sub>i,t</sub>, 1−ε, 1+ε)A<sub>i</sub> ) ] − β·KL(π<sub>θ</sub> ‖ π<sub>ref</sub>)</div>' +
              '<p>ρ<sub>i,t</sub> = π<sub>θ</sub>(o<sub>i,t</sub>|q, o<sub>i,&lt;t</sub>) / π<sub>old</sub>(·). The group mean replaces PPO’s value baseline. Here mean 0.375 and std 0.484 give A = +1.29 for passes and −0.77 for failures, broadcast to every token of the response.</p>'
          },
          {
            say: 'Try it: click any sample to flip its reward and watch every advantage change. Make all eight pass, or all eight fail, and the advantages collapse to zero: that prompt teaches nothing.',
            card: { tag: 'TRY IT', title: 'Flip a reward', body: 'Click a sample to toggle pass or fail. Advantages are recomputed from the group. When all eight agree, the standard deviation is zero and the prompt gives no gradient.' },
            deep: '<p>With k passes out of a group of G, the mean is k/G and the standard deviation is √(k/G · (1 − k/G)), so</p>' +
              '<div class="eq">A<sub>pass</sub> = √((G − k) / k), &nbsp; A<sub>fail</sub> = −√(k / (G − k))</div>' +
              '<p>The rare outcome gets the large advantage: one pass in eight earns +2.65 while each of the seven failures gets −0.38; seven passes in eight make the lone failure −2.65. The advantages always sum to zero, so the update pushes probability from the group\'s losers to its winners. At k = 0 or k = G the standard deviation is zero and every advantage is exactly 0.</p>' +
              '<p>Such all-pass or all-fail groups still cost a full set of rollouts and contribute no gradient, which is why DAPO’s <i>dynamic sampling</i> filters them out and keeps sampling until the batch holds informative groups.</p>' +
              '<p class="muted">Click a row on the stage to flip that sample’s reward; the log line under the group shows the new statistics.</p>'
          },
          {
            say: 'Trained this way at scale, DeepSeek R1 Zero learned on its own to think longer, re-check its work, and backtrack.',
            card: { tag: 'NUMBERS', title: 'Reasoning emerges', stat: { v: '15.6 → 71.0%', l: 'AIME 2024 pass@1 of DeepSeek-R1-Zero during RL, as first reported in January 2025 (77.9% in the revised Nature paper)' } },
            deep: '<ul><li><b>Emergence</b>: DeepSeek-R1-Zero’s responses grew steadily longer during RL and AIME 2024 pass@1 rose from 15.6% to 71.0% in the January 2025 report (77.9% in the revised Nature version; 86.7% with majority voting), with spontaneous reflection (“wait, let me re-check”).</li>' +
              '<li><b>2025 refinements</b>: DAPO (clip-higher ε<sub>high</sub> = 0.28, dynamic sampling that drops all-pass/all-fail groups whose A ≡ 0, token-level loss); Dr. GRPO removes length and std normalisation biases.</li></ul>' +
              '<p class="muted">Curves on the stage are schematic.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var R0 = [1, 0, 0, 1, 0, 0, 1, 0], R = R0.slice();      /* verifier rewards; R is what the TRY IT beat lets the viewer flip */
          var lens = [620, 410, 880, 540, 300, 760, 700, 350];
          var why = ['sums to 30 s', 'sums to 28 s', 'invalid JSON', 'sums to 30 s', '7 shots', 'sums to 32 s', 'sums to 30 s', 'invalid JSON'];
          var P = card(ctx, g, 60, 176, 760, 76, 'lime', 'PROMPT q (verifiable)');
          ctx.text(78, 228, '"Split the 30 s trailer into 6 shots (≥ 3 s each) matching the beats; output JSON."', { size: 12, font: 'mono', color: 'white', parent: P });
          hide(P);

          var G = card(ctx, g, 60, 266, 760, 360, 'lime', 'GROUP OF G = 8 SAMPLES  ·  reward  ·  advantage');
          S.samples = R0.map(function (r, i) {
            var y = 312 + i * 36, rg = ctx.group({ parent: G });
            ctx.rect(84, y - 16, 726, 32, { rx: 6, fill: 'rgba(0,0,0,0.001)', parent: rg });          /* click target for the whole row */
            ctx.text(96, y, 'o' + (i + 1), { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: rg });
            rg.bar = ctx.rect(106, y - 11, 0, 22, { rx: 3, fill: ctx.alpha('white', 0.12), stroke: ctx.alpha('white', 0.35), sw: 1, parent: rg });
            rg.w = lens[i] / 900 * 250;
            rg.lenT = ctx.text(110, y, lens[i] + ' tok', { size: 11, font: 'mono', color: 'dim', parent: rg });
            rg.ver = ctx.group({ parent: rg });
            rg.y = y;
            rg.icon = ctx.icon(r ? 'check' : 'warn', 440, y, 18, r ? 'lime' : 'red', { parent: rg.ver });
            rg.verT = ctx.text(456, y, 'r=' + r + '  ' + why[i], { size: 11, font: 'mono', color: r ? 'lime' : 'red', parent: rg.ver });
            rg.adv = ctx.rect(700, y - 9, 0, 18, { rx: 3, fill: ctx.alpha('lime', 0.6), parent: rg });
            rg.advT = ctx.text(706, y, '', { size: 11, font: 'mono', color: 'white', parent: rg });
            rg.ver.setAttribute('opacity', 0); rg.advT.setAttribute('opacity', 0);
            rg.style.cursor = 'pointer';
            rg.addEventListener('click', function (ev) {
              ev.stopPropagation();
              if (!S.interactive || S.busy) return;
              R[i] = 1 - R[i]; paintRow(i); regrade(1);
              ctx.pulse(rg.icon, { color: R[i] ? 'lime' : 'red', dur: 500 });
            });
            return rg;
          });
          var zero = ctx.line(700, 296, 700, 604, { color: ctx.alpha('white', 0.3), parent: G });
          S.stats = ctx.text(440, 610, '', { size: 12, font: 'mono', weight: 700, color: 'white', parent: G });
          S.hint = ctx.text(84, 610, 'click a sample to flip its reward', { size: 11, font: 'mono', color: 'lime', parent: G });
          hide(G, zero, S.hint);

          /* verifier mark and text of one sample for its current reward (flipped rewards are labelled what-if) */
          function paintRow(i) {
            var rg = S.samples[i], r = R[i];
            if (rg.icon.parentNode) rg.icon.parentNode.removeChild(rg.icon);
            rg.icon = ctx.icon(r ? 'check' : 'warn', 440, rg.y, 18, r ? 'lime' : 'red', { parent: rg.ver });
            rg.verT.textContent = 'r=' + r + '  ' + (r === R0[i] ? why[i] : 'what-if (flipped)');
            rg.verT.setAttribute('fill', r ? ctx.C.lime : ctx.C.red);
          }
          /* group-relative advantages for the current rewards; t in [0, 1] scales the bars while they animate in */
          function regrade(t) {
            var k = R.reduce(function (a, b) { return a + b; }, 0), m = k / 8, sd = Math.sqrt(m * (1 - m));
            S.stats.textContent = sd > 0 ? k + ' of 8 pass · mean ' + m.toFixed(3) + ' · std ' + sd.toFixed(3) : k + ' of 8 pass · std = 0: every advantage is 0';
            S.stats.setAttribute('fill', sd > 0 ? ctx.C.white : ctx.C.red);
            S.samples.forEach(function (rg, i) {
              var A = sd > 0 ? (R[i] - m) / sd : 0, full = Math.abs(A) * 40, w = full * t;
              rg.A = A;
              rg.adv.setAttribute('fill', ctx.alpha(A >= 0 ? 'lime' : 'red', 0.6));
              rg.adv.setAttribute('x', A >= 0 ? 700 : 700 - w); rg.adv.setAttribute('width', w);
              rg.advT.textContent = (A > 0 ? '+' : (A < 0 ? '−' : '')) + Math.abs(A).toFixed(2);
              rg.advT.setAttribute('x', A > 0 ? 700 + full + 8 : 706);
            });
          }

          var O = textCard(ctx, g, 850, 176, 690, 300, 'amber', 'GRPO OBJECTIVE (no value network)', [
            'A_i = ( r_i − mean(r) ) / std(r)',
            'ρ_i,t = π_θ(o_i,t | …) / π_old(o_i,t | …)',
            'J = mean_i  mean_t  min( ρ·A_i , clip(ρ, 1±ε)·A_i )',
            '    − β · KL( π_θ ‖ π_ref )',
            'reward: verifier, not a learned model'
          ], { size: 14, lh: 42, top: 62 });
          hide(O);

          var E = card(ctx, g, 850, 496, 690, 364, 'magenta', 'EMERGENCE (DeepSeek-R1-Zero, schematic)');
          var acc = ctx.plot(910, 546, 580, 240, function (x) { return 15.6 + (71.0 - 15.6) * (1 - Math.exp(-x / 2600)) / (1 - Math.exp(-8000 / 2600)); }, { xDomain: [0, 8000], yDomain: [0, 100], color: 'lime', sw: 2.5, parent: E });
          var len = ctx.plot(910, 546, 580, 240, function (x) { return 5 + 85 * Math.pow(x / 8000, 1.3); }, { xDomain: [0, 8000], yDomain: [0, 100], color: 'magenta', sw: 2, axes: false, parent: E });
          ctx.text(916, 540, 'AIME 2024 pass@1: 15.6% → 71.0%', { size: 12, font: 'mono', color: 'lime', parent: E });
          ctx.text(1486, 552, 'avg response length ↑', { size: 12, font: 'mono', color: 'magenta', anchor: 'end', parent: E });
          ctx.text(1490, 804, 'RL steps →', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: E });
          ctx.text(870, 836, '"wait, let me re-check": reflection and backtracking appear without being taught', { size: 12, font: 'mono', color: 'text', parent: E });
          S.curves = [acc.curve, len.curve];
          hide(E, S.curves);

          var N = textCard(ctx, g, 60, 646, 760, 214, 'lime', '2025 REFINEMENTS', [
            'DAPO: clip-higher (ε_high 0.28), drop all-pass /',
            '      all-fail groups (A ≡ 0), token-level loss',
            'Dr. GRPO: remove length & std normalisation bias',
            'KL often reduced or dropped for pure reasoning RL'
          ], { size: 13, lh: 34, top: 56 });
          hide(N);

          /* beat 0: a verifiable prompt and eight sampled answers */
          ctx.reveal(P, { from: 'left' });
          return ctx.reveal(G, { from: 'left', delay: 150 }).then(function () {
            return ctx.tween(1500, function (t) {
              S.samples.forEach(function (rg, i) {
                var f = ctx.clamp(t * 1.5 - i * 0.07, 0, 1);
                rg.bar.setAttribute('width', rg.w * f); rg.lenT.setAttribute('x', 112 + rg.w * f);
              });
            }, 'out');
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: a verifier scores every answer */
            return ctx.reveal(S.samples.map(function (s) { return s.ver; }), { from: 'left', stagger: 120 });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: advantage = reward relative to the group, no value network */
            ctx.reveal(zero, { dur: 300 });
            ctx.reveal(O, { from: 'right', dur: 600 });
            return ctx.tween(900, regrade, 'out', 200).then(function () {
              S.samples.forEach(function (rg) { rg.advT.setAttribute('opacity', 1); });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: TRY IT. The stage flips rewards by itself until all eight pass (std 0, advantages 0), then restores; then rows are clickable */
            S.busy = true;
            ctx.reveal(S.hint, { dur: 400 });
            var ch = ctx.wait(600);
            [1, 2, 4, 5, 7].forEach(function (i) {
              ch = ch.then(function () { R[i] = 1; paintRow(i); regrade(1); return ctx.wait(450); });
            });
            ch = ch.then(function () { ctx.pulse(S.stats, { color: 'red', dur: 700 }); return ctx.wait(1300); });
            return ch.then(function () {
              R = R0.slice();
              S.samples.forEach(function (rg, i) { paintRow(i); });
              regrade(1);
              S.busy = false; S.interactive = true;
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: at scale, reasoning emerges */
            ctx.reveal(N, { from: 'up', dur: 600, delay: 300 });
            return ctx.reveal(E, { from: 'up', dur: 600 }).then(function () {
              return Promise.all(S.curves.map(function (c) { return ctx.reveal(c, { from: 'draw', dur: 1500 }); }));
            });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Agentic RL',
        beats: [
          {
            say: 'Agentic reinforcement learning scales this to whole tasks. The model acts in a real environment for many turns: it reads the brief, calls the render tool, inspects the result, asks the critic, re-renders a failed shot, and finally hands in an edit list.',
            card: { tag: 'KEY IDEA', title: 'The unit is the episode', body: 'One trajectory of many turns: policy tokens (solid) alternate with environment tokens (dashed) that are context only.' },
            deep: '<ul><li><b>Environments</b>: sandboxed containers with real tools (code execution, browsers, file systems, domain APIs like our render farm), thousands in parallel. Episodes are long and heavy-tailed, so rollouts run <b>asynchronously</b> and trainers must correct for slightly stale policies (importance weights, truncated ratios).</li></ul>'
          },
          {
            say: 'Only at the end does a reward arrive: tests pass, the critic approves, the task succeeded.',
            card: { tag: 'HOW IT WORKS', title: 'One number at the end', body: 'Dozens of decisions, one scalar. A per-shot critic score can add partial credit along the way.' },
            deep: '<ul><li><b>Rewards</b>: unit tests (SWE-style tasks), task-completion checkers, rubric-based LLM judges, human-style preference models for open-ended outputs. Kimi K2 combined large-scale synthesised tool-use environments with verifiable and self-critique rewards.</li></ul>' +
              '<p>For our video system a per-shot critic score is a natural partial reward, but it must be checked against held-out human ratings, or the policy learns to satisfy the critic rather than the viewer.</p>'
          },
          {
            say: 'That single number must be credited back across every turn, while tool outputs stay masked.',
            card: { tag: 'HOW IT WORKS', title: 'Credit assignment', body: 'Simplest: one trajectory-level advantage applied to every policy token. Environment tokens stay masked.' },
            deep: '<ul><li><b>Credit assignment</b>: simplest is a trajectory-level advantage (GRPO over G rollouts of the same task) applied to every policy token; refinements add turn-level or process rewards, and always mask environment tokens.</li></ul>' +
              '<div class="eq">A = (R − mean<sub>G</sub> R) / std<sub>G</sub> R, &nbsp; applied to every policy token of every turn</div>'
          },
          {
            say: 'And because the reward is a program, the model will find loopholes unless the environment is built carefully.',
            card: { tag: 'PITFALL', title: 'Reward hacking is real', body: 'Policies edit unit tests, exit early with success codes, or flatter LLM judges. Read-only checks and monitoring are part of the design.' },
            deep: '<ul><li><b>Reward hacking</b>: policies have learned to edit or special-case unit tests, exit early with success codes, or flatter LLM judges. Mitigations: read-only tests and held-out checks, sandbox permissions, judge ensembles, KL regularisation, and monitoring chain-of-thought (while avoiding optimisation pressure that teaches the model to hide intent).</li></ul>'
          }
        ],
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
          var rewardG = ctx.group({ parent: T });
          S.reward = ctx.node({ x: x + 60, y: 249, w: 104, h: 46, title: 'R = 1', sub: 'task passed', color: 'lime', titleSize: 15, subSize: 10, parent: rewardG });
          var creditG = ctx.group({ parent: T });
          S.credit = ctx.path('M' + (x + 60) + ',274 C' + (x + 60) + ',330 ' + 700 + ',330 110,280', { stroke: ctx.alpha('lime', 0.5), sw: 1.4, dash: '4 4', arrow: true, parent: creditG });
          ctx.text(700, 340, 'advantage A = (R − mean over G rollouts) / std  →  every policy token of every turn', { size: 12, font: 'mono', color: 'lime', anchor: 'middle', parent: creditG });
          S.cur = ctx.rect(80, 220, 6, 58, { rx: 2, fill: 'white', parent: T, glow: true });
          S.cur.setAttribute('opacity', 0);
          hide(T, rewardG, creditG);

          var Env = card(ctx, g, 60, 386, 560, 230, 'teal', 'THE ENVIRONMENT LOOP');
          S.pol = ctx.node({ x: 170, y: 490, w: 170, h: 60, title: 'policy π_θ', sub: 'the agent', icon: 'brain', color: 'amber', titleSize: 14, subSize: 11, parent: Env });
          S.env = ctx.node({ x: 497, y: 490, w: 190, h: 60, title: 'sandbox', sub: 'tools · files · APIs', icon: 'tool', color: 'teal', titleSize: 14, subSize: 11, parent: Env });
          S.a1 = ctx.link(S.pol, S.env, { color: 'magenta', from: 't', to: 't', bend: { x: 334, y: 410 }, label: 'action', labelDy: -4, parent: Env });
          S.a2 = ctx.link(S.env, S.pol, { color: 'teal', from: 'b', to: 'b', bend: { x: 334, y: 572 }, label: 'observation', labelDy: 4, parent: Env });
          ctx.text(340, 596, 'thousands of parallel containers · async rollouts', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: Env });
          hide(Env);

          var C = textCard(ctx, g, 650, 386, 890, 230, 'lime', 'CREDIT ASSIGNMENT ACROSS TURNS', [
            'trajectory-level: GRPO over G rollouts of the same task, A broadcast to policy tokens',
            'mask environment tokens (tool results, observations) out of the loss',
            'turn-level / process rewards: partial credit, e.g. critic score per shot',
            'stale policies from async rollouts → importance ratios, truncation'
          ], { size: 13, lh: 36, top: 60 });
          hide(C);

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
          hide(H, I);

          /* beat 0: a long episode of policy and environment turns */
          ctx.reveal(T, { from: 'up' });
          return ctx.reveal(Env, { from: 'left', delay: 200 }).then(function () {
            S.cur.setAttribute('opacity', 1);
            ctx.packet(S.a1, { color: 'magenta', dur: 800 });
            return ctx.tween(3000, function (t) {
              var xx = 80 + t * (x - 80);
              S.cur.setAttribute('x', xx);
              S.turns.forEach(function (o) { if (o.x < xx) o.r.setAttribute('stroke-width', 2.2); });
            }, 'linear', 300);
          }).then(function () {
            S.cur.setAttribute('opacity', 0);
            return ctx.packet(S.a2, { color: 'teal', dur: 800 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the reward arrives only at the end */
            return ctx.reveal(rewardG, { from: 'scale', dur: 500 }).then(function () {
              return ctx.pulse(S.reward, { color: 'lime', dur: 700, times: 2 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: credit flows back to every policy token */
            ctx.reveal(C, { from: 'right', dur: 600 });
            ctx.reveal(creditG, { dur: 300 });
            return ctx.packet(S.credit, { color: 'lime', dur: 1200, r: 5, label: 'A' }).then(function () {
              S.turns.forEach(function (o) { if (o.pol) ctx.pulse(o.r, { color: 'lime', dur: 600 }); });
              return ctx.wait(600);
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: reward hacking and how our system avoids it */
            return ctx.reveal([H, I], { from: 'up', stagger: 200, dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Distill & ship',
        beats: [
          {
            say: 'The last step makes it affordable. A large teacher, trained with all of the above, generates hundreds of thousands of high quality reasoning and tool use traces, and a smaller student is fine tuned on them.',
            card: { tag: 'KEY IDEA', title: 'Traces in, weights out', body: 'Expensive RL happens once on the teacher. The student learns the resulting behaviour by ordinary supervised training on its outputs.' },
            deep: '<div class="eq">off-policy (sequence-level): L = −Σ<sub>t</sub> log p<sub>S</sub>(y<sub>t</sub> | y<sub>&lt;t</sub>, x), &nbsp; y ~ teacher</div>' +
              '<p>Sequence-level distillation is plain SFT on teacher-generated, filtered outputs. It needs only sampled text, not logits, so it works even when the teacher is a closed API or a different tokenizer.</p>'
          },
          {
            say: 'DeepSeek distilled R1 into models from one and a half to seventy billion parameters this way, and found that distilling beat running reinforcement learning directly on the small models.',
            card: { tag: 'NUMBERS', title: 'Distilling R1', stat: { v: '800 k', l: 'curated samples (600k reasoning, 200k general) used to fine-tune Qwen2.5 and Llama 3 from 1.5 B to 70 B' } },
            deep: '<ul><li><b>DeepSeek-R1 distills</b>: ~800k curated samples (600k reasoning + 200k general) fine-tuned into Qwen2.5 and Llama 3 bases from 1.5 B to 70 B; distillation beat running RL directly on the small models.</li></ul>' +
              '<div class="eq">logit KD: L = τ² · KL( p<sub>T</sub><sup>(τ)</sup> ‖ p<sub>S</sub><sup>(τ)</sup> )</div>' +
              '<p>When teacher logits are available, matching the full distribution at temperature τ transmits “dark knowledge” about near-miss tokens and is more sample-efficient than hard labels.</p>'
          },
          {
            say: 'On policy distillation goes further: the student generates its own answers, and the teacher grades every token, giving a dense signal on the student\'s own distribution.',
            card: { tag: 'STATE OF THE ART', title: 'On-policy distillation', body: 'Dense per-token feedback like SFT, on-distribution like RL, and far cheaper than RL from scratch.', more: '<p>Forward KL(p<sub>T</sub>‖p<sub>S</sub>) is mass-covering: the student must put probability wherever the teacher does, and a small student often spreads mass over implausible text. Reverse KL(p<sub>S</sub>‖p<sub>T</sub>) is mode-seeking: the student is penalised only where <i>it</i> puts mass the teacher would not, so it concentrates on the teacher’s best behaviours. Evaluated on the student’s own samples, it also removes the train/inference distribution mismatch of SFT.</p>' },
            deep: '<div class="eq">on-policy: L = E<sub>y~S</sub> Σ<sub>t</sub> KL( p<sub>S</sub>(·|y<sub>&lt;t</sub>) ‖ p<sub>T</sub>(·|y<sub>&lt;t</sub>) )</div>' +
              '<p><b>On-policy distillation</b> (GKD and its successors) trains on the student’s own samples with a per-token divergence from the teacher, often reverse KL: dense reward like SFT, on-distribution like RL, far cheaper than RL from scratch. Reverse KL is mode-seeking, so the student commits to the teacher’s best behaviours rather than averaging.</p>'
          },
          {
            say: 'In our film crew, the director may be a frontier model, while the critic scoring every shot is a small, fast, distilled one.',
            card: { tag: 'WHY IT MATTERS', title: 'Big director, tiny critic', body: 'Route hard planning to the big model and the high-volume shot scoring to a distilled student, then quantise it.' },
            deep: '<ul><li><b>Strong-to-weak</b> distillation produces whole model families (e.g. Qwen3’s small models).</li>' +
              '<li>Serving choice for our system: route easy calls to distilled models, hard planning to the frontier model (a cascade), then quantise the students for the critic’s high call volume.</li></ul>' +
              '<p>The same next-token machine, shaped by different signals: data, demonstrations, preferences, verifiers, environments.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = page(ctx, S);
          var L = card(ctx, g, 60, 176, 780, 390, 'teal', 'TEACHER → STUDENT');
          S.teacher = ctx.node({ x: 200, y: 300, w: 220, h: 110, title: 'Teacher', sub: 'frontier RL-trained', icon: 'brain', color: 'amber', titleSize: 18, subSize: 12, parent: L });
          S.student = ctx.node({ x: 690, y: 300, w: 150, h: 70, title: 'Student', sub: '1.5–70 B', icon: 'brain', color: 'teal', titleSize: 15, subSize: 11, parent: L });
          S.tr = ctx.link(S.teacher, S.student, { color: 'amber', label: '~800k traces (off-policy SFT)', labelDy: -18, parent: L });
          var onG = ctx.group({ parent: L });
          S.onp1 = ctx.path('M690,340 C690,470 200,470 200,360', { stroke: ctx.alpha('teal', 0.8), sw: 1.6, arrow: true, parent: onG });
          S.onp2 = ctx.path('M230,360 C240,440 640,440 660,340', { stroke: ctx.alpha('amber', 0.8), sw: 1.6, dash: '4 4', arrow: true, parent: onG });
          ctx.text(445, 488, 'on-policy: student samples  →  teacher grades every token', { size: 12, font: 'mono', color: 'teal', anchor: 'middle', parent: onG });
          ctx.text(445, 540, 'dense per-token signal like SFT, on-distribution like RL', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: onG });
          hide(L, S.tr.labelEl, onG);

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
          hide(R, R.lines);

          var B = card(ctx, g, 60, 590, 1480, 270, 'magenta', 'RECAP: WHICH STAGE BUILT WHICH SKILL OF THE CREW');
          var roles = ['knowledge', 'long context', 'tool JSON', 'taste & safety', 'reasoning', 'multi-step tools', 'cheap critic'];
          S.recap = STAGES.map(function (s, i) {
            var xx = 176 + i * 208;
            var rg = ctx.group({ parent: B });
            rg.node = ctx.node({ x: xx, y: 668, w: 170, h: 50, title: s[0], color: s[4], kind: 'pill', titleSize: 14, glow: false, parent: rg });
            ctx.text(xx, 716, roles[i], { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: rg });
            return rg;
          });
          var rl = [];
          for (var i = 0; i < 6; i++) rl.push(ctx.link(S.recap[i].node, S.recap[i + 1].node, { color: ctx.alpha('white', 0.35), sw: 1.2, parent: B }));
          var recapT = ctx.group({ parent: B });
          ctx.text(800, 774, 'director agent = frontier model through all seven stages · critic agent = distilled student', { size: 14, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: recapT });
          ctx.text(800, 808, 'the same next-token machine, shaped by different signals: data, demonstrations, preferences, verifiers, environments', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: recapT });
          hide(B, S.recap, rl, recapT);

          /* beat 0: teacher traces train the student (off-policy) */
          return ctx.reveal(L, { from: 'left' }).then(function () {
            ctx.reveal(S.tr.labelEl, { dur: 400 });
            return Promise.all([ctx.packet(S.tr, { color: 'amber', dur: 900, label: 'traces' }), ctx.wait(300).then(function () { return ctx.packet(S.tr, { color: 'amber', dur: 900 }); })]);
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the R1 distills and the three ways to distill */
            ctx.reveal(R, { from: 'right', dur: 600 });
            ctx.reveal(R.lines, { from: 'left', dur: 400, stagger: 200, delay: 400 });
            return ctx.pulse(S.student, { color: 'teal', dur: 700 });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: on-policy distillation, the student samples and the teacher grades */
            ctx.reveal(onG, { dur: 400 });
            return ctx.packet(S.onp1, { color: 'teal', dur: 900, label: 'sample' }).then(function () {
              return ctx.packet(S.onp2, { color: 'amber', dur: 900, label: 'per-token KL' });
            }).then(function () {
              return ctx.pulse(S.student, { color: 'teal', dur: 700 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: recap, which stage built which skill */
            return ctx.reveal(B, { from: 'up', dur: 600 }).then(function () {
              ctx.reveal(rl, { from: 'draw', stagger: 100, dur: 300 });
              return ctx.reveal(S.recap, { from: 'up', stagger: 90, dur: 400 });
            }).then(function () {
              return ctx.reveal(recapT, { from: 'up', dur: 500 });
            });
          });
        }
      }
      

    ]
  });
})();
