/* L2 — LLM Serving Engine. How an inference engine turns a GPU into tokens per second per dollar:
 * the engine loop, roofline, continuous batching, PagedAttention, prefix caching, chunked prefill,
 * prefill/decode disaggregation, numerics & kernels, and goodput. Leaf chamber (no children).
 * Beat format: every step is a sequence of beats; each beat has its own narration, callout card, deep-dive
 * chunk and animation segment (gated with ctx.beat(k)). */
(function () {
  function bx(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }
  function hide(list) { [].concat(list).forEach(function (e) { if (e) e.setAttribute('opacity', 0); }); }

  function heading(ctx, G, x, y, title, sub, col) {
    ctx.text(x, y, title, { size: 19, font: 'display', weight: 700, color: 'white', parent: G });
    if (sub) ctx.text(x, y + 25, sub, { size: 12.5, font: 'mono', color: col || 'dim', parent: G });
  }

  /* horizontal bracket with a label; up = label above */
  function bracket(ctx, G, x1, x2, y, label, col, up) {
    var g = ctx.group({ parent: G });
    var d = up ? 6 : -6;
    ctx.path('M' + x1 + ',' + (y + d) + ' V' + y + ' H' + x2 + ' V' + (y + d), { stroke: col, sw: 1.4, parent: g });
    ctx.text((x1 + x2) / 2, y + (up ? -11 : 13), label, { size: 11.5, font: 'mono', color: col, anchor: 'middle', parent: g });
    return g;
  }

  /* mini engine-loop strip in the free top band: highlights the stage the step is about (x > 860 keeps the title block clear) */
  function buildStrip(ctx, S) {
    if (S.strip) return;
    var G = S.strip = ctx.group();
    ctx.text(884, 108, 'ENGINE', { size: 11, font: 'mono', color: 'dim', parent: G });
    var items = [['SCHEDULER', 'red', 1000], ['MODEL FORWARD', 'amber', 1136], ['SAMPLER', 'amber', 1258], ['KV CACHE', 'red', 1384]];
    S.stripChips = items.map(function (it) { return ctx.label(it[2], 108, it[0], { color: it[1], size: 11, parent: G }); });
    ctx.line(1046, 108, 1072, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G });
    ctx.line(1198, 108, 1218, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G });
    ctx.line(1298, 108, 1342, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G, dash: '3 4' });
    ctx.path('M1258,124 Q1129,158 1000,124', { stroke: 'dim', sw: 1.2, arrow: true, parent: G, dash: '3 4' });
    ctx.reveal(G, { from: 'down' });
  }
  function setStrip(S, on) {
    S.stripChips.forEach(function (c, i) { c.setAttribute('opacity', on.indexOf(i) >= 0 ? 1 : 0.28); });
  }
  function clearPanel(ctx, S) {
    if (S.panel) ctx.remove(S.panel, 380);
    S.panel = ctx.group();
    return S.panel;
  }

  /* ---------------- step 3: batching simulations ---------------- */
  var REQS = [['A', 6], ['B', 14], ['C', 4], ['D', 9], ['E', 7], ['F', 10], ['G', 5], ['H', 8], ['I', 6], ['J', 4], ['K', 9], ['L', 5], ['M', 6], ['N', 5]];
  var PAL = ['cyan', 'amber', 'lime', 'violet', 'orange', 'teal', 'pink', 'blue', 'magenta', 'cyan', 'amber', 'lime', 'violet', 'orange'];
  var NC = 22, NS = 4;
  function emptyGrid() { var g = []; for (var s = 0; s < NS; s++) { g.push([]); for (var c = 0; c < NC; c++) g[s].push(null); } return g; }
  function schedStatic() {
    var g = emptyGrid(), ends = [], t = 0, idx = 0;
    while (t < NC && idx < REQS.length) {
      var dur = 0;
      for (var s = 0; s < NS; s++) {
        var r = idx + s; if (r >= REQS.length) continue;
        dur = Math.max(dur, REQS[r][1]);
        for (var c = 0; c < REQS[r][1]; c++) if (t + c < NC) g[s][t + c] = { r: r, first: c === 0 };
        ends.push(t + REQS[r][1]);
      }
      t += dur; idx += NS;
    }
    return { g: g, ends: ends };
  }
  function schedCont() {
    var g = emptyGrid(), ends = [], free = [0, 0, 0, 0], idx = 0;
    while (idx < REQS.length) {
      var s = 0;
      for (var k = 1; k < NS; k++) if (free[k] < free[s]) s = k;
      if (free[s] >= NC) break;
      var t = free[s], len = REQS[idx][1];
      for (var c = 0; c < len; c++) if (t + c < NC) g[s][t + c] = { r: idx, first: c === 0 };
      ends.push(t + len);
      free[s] = t + len; idx++;
    }
    return { g: g, ends: ends };
  }

  Atlas.register({
    id: 'llm-serving',
    refs: [
      'Yu et al., <i>Orca: A Distributed Serving System for Transformer-Based Generative Models</i>, OSDI 2022',
      'Kwon et al., <i>Efficient Memory Management for LLM Serving with PagedAttention</i>, SOSP 2023',
      'Zheng et al., <i>SGLang: Efficient Execution of Structured Language Model Programs</i> (RadixAttention), NeurIPS 2024',
      'Agrawal et al., <i>Taming Throughput-Latency Tradeoff in LLM Inference with Sarathi-Serve</i>, OSDI 2024',
      'Zhong et al., <i>DistServe: Disaggregating Prefill and Decoding for Goodput-optimized LLM Serving</i>, OSDI 2024; Patel et al., <i>Splitwise</i>, ISCA 2024',
      'Qin et al., <i>Mooncake: A KVCache-centric Disaggregated Architecture for LLM Serving</i>, FAST 2025; NVIDIA <i>Dynamo</i> + NIXL, 2025; DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i> (inference deployment), 2024',
      'Lin et al., <i>AWQ: Activation-aware Weight Quantization for On-Device LLM Compression and Acceleration</i>, MLSys 2024; OCP <i>Microscaling (MX) Formats Spec v1.0</i>, 2023; NVIDIA NVFP4 (Blackwell), 2025',
      'Leviathan et al., <i>Fast Inference from Transformers via Speculative Decoding</i>, ICML 2023; Li et al., <i>EAGLE-3</i>, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'The engine loop',
        beats: [
          {
            say: 'When the director agent asks the planner model for a shot list, the request lands on an LLM serving engine. Its API server tokenizes the text and puts the request in a waiting queue.',
            card: { tag: 'KEY IDEA', title: 'A request becomes a sequence', body: 'Every agent call turns into a <b>sequence</b> with a prompt, a token budget and an output stream. Four agents in flight means four sequences to interleave.' },
            deep: '<p>vLLM V1, SGLang and TensorRT-LLM split the server in two: <b>API processes</b> (HTTP, tokenizer, detokenizer, streaming) and one <b>engine-core process</b> per replica that owns the GPUs. The split means Python-side JSON parsing and tokenization can never starve the accelerator; the halves talk over ZeroMQ or shared-memory queues.</p>' +
              '<p>A request is a small record: prompt token ids, <code>SamplingParams</code> (temperature, top-p, max tokens, stop strings, grammar) and an arrival timestamp. It waits in a first-come or priority queue until the scheduler admits it.</p>'
          },
          {
            say: 'The engine itself is a tight loop. At the top of every iteration a scheduler decides which sequences run right now, and which blocks of GPU memory hold their KV cache.',
            card: { tag: 'HOW IT WORKS', title: 'The scheduler owns memory too', body: 'A sequence runs only if the <b>KV blocks</b> for its next tokens exist. Otherwise it waits, or a running sequence is preempted to make room.' },
            deep: '<p>Each iteration the scheduler solves a small packing problem under two budgets: a <b>token budget</b> (how many tokens one forward pass may process) and a <b>KV-block budget</b> (free blocks in HBM). It keeps the running sequences, allocates a new block for any sequence whose last block just filled, admits waiting requests while both budgets allow, and preempts, usually the most recently admitted sequence, when memory runs out.</p>' +
              '<p>The default policy is first-come first-served; priority and deadline-aware variants exist. SGLang\'s overlap scheduler and vLLM\'s async scheduling run this on the CPU so that planning step <i>t+1</i> overlaps with the GPU executing step <i>t</i>.</p>'
          },
          {
            say: 'One forward pass then processes every scheduled sequence together, reading the weights and the KV cache once. A sampler turns the resulting logits into exactly one new token per sequence.',
            card: { tag: 'NUMBERS', title: 'One pass, one token each', stat: { v: '+37', u: 'tokens', l: 'one iteration: 37 running sequences in, 37 new tokens out' } },
            deep: '<pre>while True:\n  batch = sched.schedule()\n  logits = model(batch)\n  toks = sample(logits)\n  sched.update(toks) # EOS: free KV\n  stream(toks)       # SSE to agents</pre>' +
              '<p>Shapes for our 70B planner at tensor-parallel 4: hidden states <code>[Σ n<sub>i</sub>, 8192]</code>; logits <code>[B, 128,256]</code> in FP32, and in decode only the last position of each sequence is projected. Each layer ends with two all-reduces over NVLink, and every GPU streams its 17.5 GB weight shard and its slice of the KV cache once per pass.</p>'
          },
          {
            say: 'Then the loop repeats. Each iteration takes roughly ten milliseconds at this batch size, and up to forty when a large prefill shares the step. Finished sequences leave, new ones join, and every stream grows by one token.',
            card: { tag: 'NUMBERS', title: 'Ten milliseconds per turn', stat: { v: '≈ 9 ms', l: 'per iteration at batch 37: 5.2 ms of weight streaming plus about 0.1 ms per sequence' },
              more: '<p>Derivation: t ≈ (W/TP + B · L · kv) / BW = 17.5 GB / 3.35 TB/s + 37 × 335 MB / 3.35 TB/s = 5.2 ms + 3.7 ms ≈ 8.9 ms, with L = 4k tokens of context per sequence. Real engines add a few hundred microseconds for kernel launches, sampling and the two all-reduces per layer, hence "roughly ten milliseconds".</p>' },
            deep: '<p>Iteration time is the metronome of the whole system. A pure-decode step at batch B costs about <code>5.2 ms + 0.1 ms × B</code> on this configuration (derived in the next step), so 37 sequences take ≈ 9 ms and one replica emits roughly 4,000 tokens per second. A step that also carries a large prefill chunk can stretch to 30–40 ms.</p>' +
              '<p>Tokens are streamed as they are produced: the detokenizer emits text deltas incrementally, handling partial UTF-8 sequences, and the API server relays them as server-sent events, so an agent can start parsing tool-call JSON before the reply has ended.</p>'
          },
          {
            say: 'Two numbers define the experience. Time to first token covers queueing plus prefill of the whole prompt. Time per output token is the gap between successive tokens, and the loop sets it.',
            card: { tag: 'TRADE-OFF', title: 'Two latencies, two bottlenecks', body: '<b>TTFT</b> is compute: queueing plus prefill. <b>TPOT</b> is memory bandwidth: the decode loop. Tuning for one usually costs the other.' },
            deep: '<table><tr><th>metric</th><th>definition</th></tr>' +
              '<tr><td>TTFT</td><td>queueing + prefill + first sample</td></tr>' +
              '<tr><td>TPOT / ITL</td><td>mean / per-gap time between output tokens</td></tr>' +
              '<tr><td>E2E latency</td><td>TTFT + (n−1)·TPOT</td></tr>' +
              '<tr><td>throughput</td><td>output tokens/s per GPU (or per $)</td></tr>' +
              '<tr><td>goodput</td><td>requests/s that meet <i>both</i> SLOs</td></tr></table>' +
              '<p><span class="muted">Running configuration in this chamber: a 70B-class dense planner (Llama-3.1-70B shape: 80 layers, 64 query / 8 KV heads, d<sub>h</sub> = 128), FP8 weights, tensor-parallel over 4 H100 SXM GPUs.</span></p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          var G = S.g1 = ctx.group();
          heading(ctx, G, 60, 182, 'THE ENGINE LOOP', 'schedule → forward → sample: one new token per sequence per iteration', 'red');          /* beat 1 objects: agents, API server, waiting queue */
          var ag = [['Director · plan()', 290], ['Writer · draft()', 360], ['Critic · review()', 430], ['Camera · prompt()', 500]];
          var chips = ag.map(function (a) { return ctx.label(120, a[1], a[0], { color: 'magenta', size: 12, parent: G }); });
          S.api = ctx.node({ x: 330, y: 395, w: 170, h: 66, title: 'API server', sub: 'tokenize · admit', icon: 'server', color: 'blue', titleSize: 15, subSize: 11, parent: G });
          var al = ag.map(function (a) { return ctx.link({ x: 194, y: a[1] }, S.api, { to: 'l', color: ctx.alpha('magenta', 0.55), sw: 1.3, parent: G }); });
          var qg = ctx.group({ parent: G });
          S.queue = ctx.node({ x: 505, y: 395, w: 100, h: 150, kind: 'box', color: 'red', parent: qg });
          ctx.text(505, 340, 'WAITING', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: qg });
          for (var q = 0; q < 5; q++) ctx.rect(470, 358 + q * 18, 70, 13, { rx: 3, fill: ctx.alpha(['magenta', 'magenta', 'cyan', 'magenta', 'violet'][q], 0.35), stroke: ctx.alpha('white', 0.25), sw: 0.8, parent: qg });
          var lq1 = ctx.link(S.api, S.queue, { color: 'blue', parent: G });
          /* beat 2 objects: scheduler and the KV cache it manages */
          S.sched = ctx.node({ x: 690, y: 300, w: 200, h: 72, title: 'Scheduler', sub: 'admit · KV · preempt', icon: 'queue', color: 'red', titleSize: 15, subSize: 11, parent: G });
          S.kv = ctx.node({ x: 1410, y: 300, w: 190, h: 90, kind: 'cyl', title: 'KV cache', sub: 'HBM · paged blocks', color: 'red', titleSize: 15, subSize: 11, parent: G });
          var lq2 = ctx.link(S.queue, S.sched, { from: 'r', to: 'l', color: 'red', parent: G });
          var lsk = ctx.link(S.sched, S.kv, { from: 't', to: 't', bend: { x: 1050, y: 200 }, color: 'red', dash: '5 5', label: 'block tables · alloc / free', labelDy: -16, parent: G });
          /* beat 3 objects: forward pass, sampler, output */
          S.fwd = ctx.node({ x: 1110, y: 300, w: 230, h: 80, title: 'Model forward', sub: '70B · FP8 · TP=4 · H100', icon: 'gpu', color: 'amber', titleSize: 15, subSize: 11, parent: G });
          S.samp = ctx.node({ x: 900, y: 560, w: 200, h: 72, title: 'Sampler', sub: 'logits → 1 token / seq', icon: 'spark', color: 'amber', titleSize: 15, subSize: 11, parent: G });
          S.out = ctx.node({ x: 1310, y: 560, w: 220, h: 66, title: 'Detokenize · stream', sub: 'SSE → agents', icon: 'net', color: 'cyan', titleSize: 14, subSize: 11, parent: G });
          S.r1 = ctx.link(S.sched, S.fwd, { from: 'r', to: 'l', color: 'red', straight: true, label: 'batch of sequences', labelDy: -16, parent: G });
          S.r2 = ctx.link(S.fwd, S.samp, { from: 'b', to: 'r', color: 'amber', label: 'logits [B, 128k]', labelDx: 40, parent: G });
          S.r3 = ctx.link(S.samp, S.sched, { from: 'l', to: 'b', color: 'amber', label: '+1 token · free on EOS', labelDx: -28, parent: G });
          S.r4 = ctx.link(S.samp, S.out, { from: 'r', to: 'l', color: 'cyan', label: 'token ids', parent: G });
          var lkv = ctx.link(S.fwd, S.kv, { from: 'r', to: 'l', color: 'red', dash: '5 5', arrow: false, label: 'read W + KV, append KV', labelDy: 60, parent: G });
          S.iterT = ctx.text(900, 410, 'iteration 1,205', { size: 22, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: G });
          S.batchT = ctx.text(900, 440, 'batch = 37 sequences → +37 tokens', { size: 12.5, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          S.toT = ctx.text(1200, 612, 'to Director:', { size: 11, font: 'mono', color: 'dim', parent: G });
          var TOK = ['"Shot', ' 1:', ' wide', ' crash', ' site'];
          var tx = 1200, toks = [];
          TOK.forEach(function (t) {
            var l = ctx.label(tx, 640, t, { color: 'cyan', size: 12, anchor: 'start', parent: G });
            tx += l.w + 5; toks.push(l);
          });
          /* beat 5 objects: one request on the clock */
          var TL = ctx.group({ parent: G });
          var tlT = ctx.text(60, 708, 'ONE REQUEST ON THE CLOCK', { size: 12, font: 'mono', color: 'dim', parent: TL });
          var qrG = ctx.group({ parent: TL });
          ctx.rect(160, 757, 70, 26, { rx: 4, fill: ctx.alpha('dim', 0.25), stroke: 'dim', sw: 1, parent: qrG });
          ctx.text(195, 770, 'queue', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: qrG });
          var prG = ctx.group({ parent: TL });
          ctx.rect(232, 757, 220, 26, { rx: 4, fill: ctx.alpha('amber', 0.4), stroke: 'amber', sw: 1, parent: prG });
          ctx.text(342, 770, 'prefill · 6k prompt tok', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: prG });
          var ticks = [];
          for (var i = 0; i < 22; i++) ticks.push(ctx.rect(460 + i * 44, 759, 30, 22, { rx: 3, fill: ctx.alpha('cyan', 0.35), stroke: 'cyan', sw: 1, parent: TL }));
          var bT = bracket(ctx, TL, 160, 490, 740, 'TTFT = queue + prefill + first token', 'amber', true);
          var bP = bracket(ctx, TL, 680, 724, 797, 'TPOT / ITL', 'cyan', false);
          var bE = bracket(ctx, TL, 160, 1414, 836, 'E2E = TTFT + (n − 1) · TPOT', 'text', false);
          hide([lq1, lq2, lsk, lsk.labelEl, S.sched, S.kv, S.fwd, S.samp, S.out, S.r1, S.r1.labelEl, S.r2, S.r2.labelEl, S.r3, S.r3.labelEl, S.r4, S.r4.labelEl, lkv, lkv.labelEl,
            S.iterT, S.batchT, S.toT, tlT, qrG, prG, bT, bP, bE]);
          hide(toks); hide(ticks); hide(al); hide(chips); hide([S.api, qg]);

          function iterate(k) {
            return ctx.packet(S.r1, { color: 'red', dur: 320 }).then(function () { return ctx.packet(S.r2, { color: 'amber', dur: 320 }); })
              .then(function () { return Promise.all([ctx.packet(S.r3, { color: 'amber', dur: 320 }), ctx.packet(S.r4, { color: 'cyan', dur: 320 })]); })
              .then(function () {
                S.iterT.textContent = 'iteration ' + (1205 + k).toLocaleString('en-US');
                ctx.reveal(toks[k], { from: 'left', dur: 250 });
              });
          }
          /* beat 1: requests arrive, tokenized, queued */
          return Promise.all([
            ctx.reveal(chips, { from: 'left', stagger: 90 }),
            ctx.reveal(S.api, { from: 'scale', delay: 300 }),
            ctx.reveal(al, { from: 'draw', delay: 500, stagger: 70 }),
            ctx.reveal(qg, { from: 'scale', delay: 800 }),
            ctx.reveal(lq1, { from: 'draw', delay: 1000 })
          ]).then(function () {
            return Promise.all(al.map(function (l, i) { return ctx.wait(i * 120).then(function () { return ctx.packet(l, { color: 'magenta', dur: 520 }); }); }));
          }).then(function () { return ctx.packet(lq1, { color: 'blue', dur: 500, label: 'req' }); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: scheduler and KV cache */
            return Promise.all([
              ctx.reveal(S.sched, { from: 'scale' }),
              ctx.reveal(lq2, { from: 'draw', delay: 250 }),
              ctx.reveal(S.kv, { from: 'scale', delay: 400 }),
              ctx.reveal(lsk, { from: 'draw', delay: 700 }),
              ctx.reveal(lsk.labelEl, { delay: 1100 })
            ]).then(function () { return ctx.packet(lq2, { color: 'red', dur: 500, label: 'admit' }); })
              .then(function () { return Promise.all([ctx.pulse(S.sched, { color: 'red', dur: 600 }), ctx.packet(lsk, { color: 'red', dur: 800 })]); })
              .then(function () { return ctx.pulse(S.kv, { color: 'red', dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: one forward pass, one sampled token per sequence */
            return Promise.all([
              ctx.reveal(S.fwd, { from: 'scale' }),
              ctx.reveal(S.r1, { from: 'draw', delay: 300 }), ctx.reveal(S.r1.labelEl, { delay: 700 }),
              ctx.reveal(lkv, { from: 'draw', delay: 500 }), ctx.reveal(lkv.labelEl, { delay: 900 })
            ]).then(function () { return ctx.packet(S.r1, { color: 'red', dur: 500 }); })
              .then(function () { return Promise.all([ctx.pulse(S.fwd, { color: 'amber', dur: 600 }), ctx.packet(lkv, { color: 'red', dur: 500 })]); })
              .then(function () {
                return Promise.all([ctx.reveal(S.samp, { from: 'scale' }), ctx.reveal([S.r2, S.r3], { from: 'draw', delay: 250, stagger: 100 }), ctx.reveal([S.r2.labelEl, S.r3.labelEl], { delay: 700, stagger: 100 })]);
              }).then(function () { return ctx.packet(S.r2, { color: 'amber', dur: 500 }); })
              .then(function () {
                return Promise.all([ctx.reveal(S.out, { from: 'scale' }), ctx.reveal(S.r4, { from: 'draw', delay: 200 }), ctx.reveal(S.r4.labelEl, { delay: 500 })]);
              }).then(function () { return Promise.all([ctx.packet(S.r3, { color: 'amber', dur: 500 }), ctx.packet(S.r4, { color: 'cyan', dur: 500 })]); })
              .then(function () {
                return Promise.all([ctx.reveal([S.iterT, S.batchT, S.toT], { stagger: 100 }), ctx.reveal(toks[0], { from: 'left', dur: 250 })]);
              });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the loop repeats, four more iterations */
            ctx.hud('iteration ≈ 9 ms · 37 seqs · +37 tokens');
            return [1, 2, 3, 4].reduce(function (p, k) { return p.then(function () { return iterate(k); }); }, Promise.resolve()).then(function () {
              S.st1 = [ctx.stream(S.r1, { color: 'red', count: 2, period: 1500 }), ctx.stream(S.r2, { color: 'amber', count: 2, period: 1500 }), ctx.stream(S.r3, { color: 'amber', count: 2, period: 1500 })];
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: the two latencies on the request timeline */
            ctx.reveal(tlT, { dur: 300 });
            return ctx.reveal(qrG, { from: 'left', dur: 300, delay: 150 }).then(function () { return ctx.reveal(prG, { from: 'left', dur: 400 }); })
              .then(function () { return ctx.reveal(bT, { dur: 400 }); })
              .then(function () { return ctx.reveal(ticks, { dur: 200, stagger: 45 }); })
              .then(function () { return ctx.reveal([bP, bE], { dur: 400, stagger: 250 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Roofline & batching',
        beats: [
          {
            say: 'Why batch at all? Look at the roofline of one H100. Below a ridge point of about five hundred ninety operations per byte, a kernel is limited by memory bandwidth, not by compute. Above it, the tensor cores are the limit.',
            card: { tag: 'NUMBERS', title: 'The FP8 ridge point', stat: { v: '≈ 590', u: 'FLOP / byte', l: 'H100 SXM: 1,979 TFLOP/s of FP8 tensor math over 3.35 TB/s of HBM3' } },
            deep: '<p>Arithmetic intensity is <b>I = FLOPs / bytes moved</b>. The roofline says attainable performance is <code>min(peak, I × BW)</code>: a slanted memory roof up to the <b>ridge point</b> peak / BW, then a flat compute roof.</p>' +
              '<div class="eq">H100 SXM: 1,979 TFLOP/s FP8 (dense) ÷ 3.35 TB/s ≈ 590 FLOP/B &nbsp;·&nbsp; BF16: 989 ÷ 3.35 ≈ 295 FLOP/B</div>' +
              '<p>A large prefill GEMM (2,048 tokens against FP8 weights) has I ≈ 2 × 2,048 ≈ 4,096, far right of the ridge: compute-bound. Decode is the opposite case, next.</p>' +
              '<p><span class="muted">Peaks here are dense; the 3,958 TFLOP/s headline figure assumes 2:4 structured sparsity that LLM serving does not use.</span></p>'
          },
          {
            say: 'Each decode step must stream the whole weight shard, seventeen and a half gigabytes per GPU, just to produce one token per sequence. At batch one that is about two operations per byte, so the tensor cores sit almost idle.',
            card: { tag: 'NUMBERS', title: 'Batch one: 5.2 ms per token', stat: { v: '≈ 190', u: 'tok/s', l: 'per replica at batch 1: 17.5 GB per GPU ÷ 3.35 TB/s = 5.2 ms per step' } },
            deep: '<p><b>Decode GEMMs</b>: every FP8 weight byte read feeds 2 FLOPs per token in the batch (one multiply, one add), so <code>I ≈ 2B</code> for batch B. At B = 1 the kernel is a GEMV at I ≈ 2, about 0.3 % of the ridge.</p>' +
              '<div class="eq">t<sub>step</sub>(B=1) ≈ (W / TP) / BW = 17.5 GB ÷ 3.35 TB/s ≈ 5.2 ms &nbsp;⇒&nbsp; ≈ 190 tokens/s</div>' +
              '<p>Tensor-core utilisation is about 2 / 590 ≈ 0.3 %. The GPU is an expensive memory-streaming device here, which is why nearly every optimisation in this chamber is about bytes.</p>' +
              '<details><summary>Go deeper</summary><p>For a GEMM <code>[B, d] × [d, n]</code> the work is 2·B·d·n FLOPs and the traffic is d·n weight bytes (FP8) plus 2·B·(d + n) activation bytes (BF16), so <code>I = 2Bdn / (dn + 2B(d + n)) ≈ 2B</code> whenever B ≪ d, n. With d = 8192 and the FFN width n = 28,672, B = 256 still gives I ≈ 470, just under the ridge: weights, not activations, dominate the bytes until the batch is in the hundreds.</p></details>'
          },
          {
            say: 'Every extra sequence in the batch reuses the same weight read, so throughput climbs almost linearly while the step time barely moves. At batch sixty four, one replica produces about five and a half thousand tokens per second.',
            card: { tag: 'NUMBERS', title: 'Batching is nearly free', stat: { v: '29×', l: 'throughput from batch 1 to 64 (190 to 5,500 tok/s) while inter-token latency only doubles' },
              more: '<p>Step time is <code>t = W/BW + B · L · kv / BW</code>. The first term is fixed, the second grows with batch and context. Throughput B / t is therefore concave and saturates near <code>BW / (L · kv)</code> ≈ 10,000 tokens/s per replica at 4k contexts, once the weights become a negligible share of the traffic.</p>' },
            deep: '<div class="eq">t<sub>step</sub> ≈ (W/TP + B · L · kv) / BW ≈ 5.2 ms + B × 0.10 ms</div>' +
              '<p>W/TP = 17.5 GB per GPU; kv = 80 KiB per token per GPU (BF16 KV, 2 KV heads per GPU); L = 4k tokens, so one sequence adds 335 MB of KV traffic ≈ 0.10 ms.</p>' +
              '<table><tr><th>B</th><th>t<sub>step</sub></th><th>tokens/s</th></tr><tr><td>1</td><td>5.3 ms</td><td>190</td></tr><tr><td>64</td><td>11.6 ms</td><td>5,500</td></tr><tr><td>150</td><td>20.2 ms</td><td>7,400</td></tr></table>' +
              '<p>Throughput rises 29× for a 2.2× longer step. That asymmetry is the whole economic case for batching.</p>'
          },
          {
            say: 'Attention is different. Each sequence streams its own KV cache, read once per step and shared only across the eight query heads of its group. So this kernel stays memory bound at any batch size.',
            card: { tag: 'PITFALL', title: 'Batching cannot fix attention', body: 'KV reads grow with batch <i>times</i> context. Only fewer bytes per token help: FP8 or FP4 KV, MLA, sliding windows.' },
            deep: '<p><b>Decode attention</b> reads each K and V element once per step and reuses it only across the g = 8 query heads that share a KV head (grouped-query attention: 64 query heads, 8 KV heads):</p>' +
              '<div class="eq">I<sub>attn</sub> ≈ g = 8 FLOP/B, independent of B</div>' +
              '<p>The red point sits near 27 TFLOP/s, under 2 % of the FP8 peak, however many sequences are batched. This is why FlashDecoding splits the KV along the sequence axis to fill the SMs, and why <b>KV-shrinking</b> techniques (FP8/FP4 KV, MLA, sliding windows, KV eviction) matter more than any GEMM trick at long context.</p>'
          },
          {
            say: 'So memory capacity, not compute, finally caps the batch. About fifty gigabytes of KV pool per GPU holds roughly one hundred fifty contexts of four thousand tokens, and an FP8 KV cache doubles that.',
            card: { tag: 'NUMBERS', title: 'The capacity wall', stat: { v: '≈ 150', u: 'sequences', l: '4k-token contexts in a 50 GB KV pool per GPU (BF16 KV); FP8 KV doubles it to about 300' } },
            deep: '<p><b>Capacity wall</b>: about 50 GB of KV pool per GPU ÷ 80 KiB per token ≈ 610k tokens ≈ 150 concurrent 4k contexts. At the wall, throughput is ≈ 7.4k tokens/s and ITL ≈ 20 ms.</p>' +
              '<p>Beyond it the scheduler must queue or preempt (swap KV to CPU, or drop and recompute). Hence the next three mechanisms: keep every batch slot busy (continuous batching), pack KV densely (paging) and never store or compute the same KV twice (prefix caching).</p>' +
              '<p><span class="muted">Real engines also reserve activation and CUDA-graph memory, so the pool is smaller than 80 GB minus weights.</span></p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          if (S.st1) { S.st1.forEach(function (h) { h.stop(); }); S.st1 = null; }
          if (S.g1) { ctx.remove(S.g1, 400); S.g1 = null; }
          buildStrip(ctx, S); setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'WHY DECODE NEEDS A BIG BATCH — ROOFLINE', 'H100 SXM · 3.35 TB/s HBM3 · 1,979 TFLOP/s FP8 dense · 70B FP8, TP = 4', 'red');
          var X0 = 140, X1 = 760, Y0 = 250, Y1 = 690;
          function rx(I) { return X0 + Math.log10(I) / 4 * (X1 - X0); }
          function ry(P) { return Y1 - Math.log10(P) / 3.5 * (Y1 - Y0); }
          /* beat 1: axes, roofs, ridge, prefill */
          var RL = ctx.group({ parent: G });
          ctx.line(X0, Y1, X1, Y1, { color: 'faint', parent: RL });
          ctx.line(X0, Y0 - 10, X0, Y1, { color: 'faint', parent: RL });
          [[1, '1'], [10, '10'], [100, '100'], [1000, '1k'], [10000, '10k']].forEach(function (t) {
            ctx.line(rx(t[0]), Y0, rx(t[0]), Y1, { color: ctx.alpha('faint', 0.5), sw: 1, dash: '2 5', parent: RL });
            ctx.text(rx(t[0]), Y1 + 16, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: RL });
          });
          [[1, '1'], [10, '10'], [100, '100'], [1000, '1000']].forEach(function (t) {
            ctx.line(X0, ry(t[0]), X1, ry(t[0]), { color: ctx.alpha('faint', 0.5), sw: 1, dash: '2 5', parent: RL });
            ctx.text(X0 - 8, ry(t[0]), t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: RL });
          });
          ctx.text(X1, Y1 + 36, 'arithmetic intensity  (FLOP / byte, log)', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: RL });
          ctx.text(X0 - 6, Y0 - 22, 'TFLOP/s per GPU (log)', { size: 11.5, font: 'mono', color: 'dim', parent: RL });
          var bfRoof = ctx.path('M' + rx(1) + ',' + ry(3.35) + ' L' + rx(295) + ',' + ry(989) + ' L' + rx(10000) + ',' + ry(989), { stroke: 'dim', sw: 1.5, dash: '6 5', parent: G });
          var fpRoof = ctx.path('M' + rx(1) + ',' + ry(3.35) + ' L' + rx(590.7) + ',' + ry(1979) + ' L' + rx(10000) + ',' + ry(1979), { stroke: 'amber', sw: 2.6, parent: G, glow: true });
          var RT = ctx.group({ parent: G });
          ctx.text(rx(590.7) + 10, ry(1979) - 12, 'FP8 peak 1,979', { size: 11.5, font: 'mono', color: 'amber', parent: RT });
          ctx.text(rx(295) - 10, ry(989) - 12, 'BF16 peak 989', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: RT });
          ctx.text(rx(3), ry(10.05) + 16, 'HBM slope 3.35 TB/s', { size: 11.5, font: 'mono', color: 'amber', anchor: 'middle', rotate: -39, parent: RT });
          ctx.line(rx(590.7), ry(1979), rx(590.7), Y1, { color: ctx.alpha('amber', 0.6), sw: 1, dash: '3 4', parent: RT });
          ctx.text(rx(590.7) + 6, Y1 - 12, 'ridge ≈ 590', { size: 11, font: 'mono', color: 'amber', parent: RT });
          var pPre = ctx.group({ parent: G });
          ctx.circle(rx(4096), ry(1979), 6, { fill: 'amber', parent: pPre, glow: true });
          ctx.text(rx(4096) + 12, ry(1979) - 14, 'prefill (2k chunk)', { size: 11.5, font: 'mono', color: 'amber', parent: pPre });
          /* beat 2: the decode GEMM point at batch one */
          var DG = ctx.group({ parent: G });
          S.dot = ctx.circle(rx(2), ry(6.7), 7, { fill: 'cyan', parent: DG, glow: 'strong' });
          S.dotL = ctx.text(X1, 630, 'decode GEMMs (cyan) · B = 1', { size: 12, font: 'mono', color: 'cyan', anchor: 'end', parent: DG });
          var cap1 = ctx.text(60, 796, 'each decode step streams the weight shard: 17.5 GB ÷ 3.35 TB/s = 5.2 ms, however many sequences share it', { size: 13, font: 'mono', color: 'text', parent: G });
          /* beat 3: throughput and ITL against batch */
          var PX = 930, PW = 570;
          var PLT = ctx.group({ parent: G });
          var P1 = ctx.plot(PX, 250, PW, 190, function (b) { return 1000 * b / (5.2 + 0.1 * b); }, { xDomain: [0, 320], yDomain: [0, 10000], color: 'lime', sw: 2.4, yLabel: 'tokens/s per 4-GPU replica', parent: PLT });
          var P2 = ctx.plot(PX, 520, PW, 170, function (b) { return 5.2 + 0.1 * b; }, { xDomain: [0, 320], yDomain: [0, 40], color: 'cyan', sw: 2.4, yLabel: 'ITL per step (ms)', parent: PLT });
          [['10k', 10000], ['5k', 5000]].forEach(function (t) { ctx.text(PX - 6, P1.toPx(0, t[1]).y, t[0], { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: PLT }); });
          [['40', 40], ['20', 20]].forEach(function (t) { ctx.text(PX - 6, P2.toPx(0, t[1]).y, t[0], { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: PLT }); });
          [0, 64, 128, 192, 256, 320].forEach(function (b) { ctx.text(P2.toPx(b, 0).x, 706, String(b), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: PLT }); });
          ctx.text(PX + PW, 726, 'batch B (concurrent sequences)', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: PLT });
          S.cur = ctx.line(PX, 250, PX, 690, { color: ctx.alpha('white', 0.5), sw: 1, dash: '2 3', parent: PLT });
          S.d1 = ctx.circle(PX, 440, 5, { fill: 'lime', parent: PLT, glow: true });
          S.d2 = ctx.circle(PX, 690, 5, { fill: 'cyan', parent: PLT, glow: true });
          S.readout = ctx.text(PX, 760, '', { size: 13, font: 'mono', color: 'white', parent: PLT });
          var cap2 = ctx.text(60, 822, 'step time ≈ 5.2 ms + B × 0.10 ms: the weight read is paid once, only the per-sequence KV term grows with the batch', { size: 13, font: 'mono', color: 'text', parent: G });
          /* beat 4: decode attention stays put */
          var pAtt = ctx.group({ parent: G });
          ctx.circle(rx(8), ry(26.8), 6, { fill: 'red', parent: pAtt, glow: true });
          ctx.text(rx(8) + 12, ry(26.8) + 16, 'decode attention · I ≈ g = 8', { size: 11.5, font: 'mono', color: 'red', parent: pAtt });
          ctx.text(rx(8) + 12, ry(26.8) + 32, '(GQA; batch does not help)', { size: 11, font: 'mono', color: 'dim', parent: pAtt });
          var kvNote = ctx.group({ parent: G });
          ctx.text(944, 548, 'slope 0.10 ms per sequence:', { size: 11.5, font: 'mono', color: 'red', parent: kvNote });
          ctx.text(944, 566, 'its own 335 MB KV read', { size: 11.5, font: 'mono', color: 'red', parent: kvNote });
          ctx.line(1010, 580, 1046, 628, { color: 'red', sw: 1.2, arrow: true, parent: kvNote });
          /* beat 5: capacity walls */
          var walls = ctx.group({ parent: G });
          [[150, 'KV full · BF16 KV'], [300, 'KV full · FP8 KV']].forEach(function (w) {
            var x = P1.toPx(w[0], 0).x;
            ctx.line(x, 262, x, 690, { color: 'red', sw: 1.4, dash: '5 4', parent: walls });
            ctx.label(x - 6, 468, w[1], { color: 'red', size: 11, anchor: 'end', parent: walls });
          });
          var cap3 = ctx.text(60, 848, 'capacity, not FLOPs, caps B: about 150 BF16-KV sequences fit; FP8 KV doubles the wall', { size: 13, font: 'mono', color: 'text', parent: G });
          function setB(b) {
            var I = 2 * b, P = Math.min(3.35 * I, 1979);
            S.dot.setAttribute('cx', rx(I)); S.dot.setAttribute('cy', ry(P));
            S.dotL.textContent = 'decode GEMMs (cyan) · B = ' + Math.round(b) + ' · I ≈ ' + Math.round(I);
            var th = 1000 * b / (5.2 + 0.1 * b), it = 5.2 + 0.1 * b;
            var p1 = P1.toPx(b, th), p2 = P2.toPx(b, it);
            S.cur.setAttribute('x1', p1.x); S.cur.setAttribute('x2', p1.x);
            S.d1.setAttribute('cx', p1.x); S.d1.setAttribute('cy', p1.y);
            S.d2.setAttribute('cx', p2.x); S.d2.setAttribute('cy', p2.y);
            S.readout.textContent = 'B = ' + Math.round(b) + '   ITL ' + it.toFixed(1) + ' ms   ' + Math.round(th).toLocaleString('en-US') + ' tok/s   ' + (b > 150 ? '(needs FP8 KV)' : '');
          }
          setB(1);
          hide([DG, cap1, PLT, cap2, pAtt, kvNote, walls, cap3]);
          /* beat 1: the roofline */
          return Promise.all([
            ctx.reveal(RL, { from: 'left' }),
            ctx.reveal([bfRoof, fpRoof], { from: 'draw', dur: 1000, delay: 300, stagger: 200 }),
            ctx.reveal(RT, { delay: 1000 }),
            ctx.reveal(pPre, { delay: 1300 })
          ]).then(function () { return ctx.pulse(pPre, { color: 'amber', dur: 700 }); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: decode at batch one */
            return Promise.all([ctx.reveal(DG, {}), ctx.reveal(cap1, { from: 'up', delay: 400 })]).then(function () {
              return ctx.pulse(S.dot, { color: 'cyan', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: batching slides the point up the memory roof */
            ctx.reveal(PLT, { from: 'right' });
            ctx.reveal(cap2, { from: 'up', delay: 500 });
            return ctx.wait(700).then(function () { return ctx.tween(3600, function (t) { setB(1 + 63 * t); }, 'inOut'); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: attention does not move */
            return Promise.all([ctx.reveal(pAtt, {}), ctx.reveal(kvNote, { from: 'left', delay: 500 })]).then(function () {
              return ctx.pulse(pAtt, { color: 'red', times: 2, dur: 700 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: the capacity wall */
            ctx.hud('B = 1: 190 tok/s · B = 150: 7.4k tok/s');
            ctx.reveal(walls, { delay: 300 });
            ctx.reveal(cap3, { from: 'up', delay: 900 });
            return ctx.tween(3200, function (t) { setB(64 + 86 * t); }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Continuous batching',
        beats: [
          {
            say: 'Sequences finish at different times: a critic verdict is ten tokens, a script draft is two thousand. With static batching, the batch runs until its longest member ends. Finished slots burn padding, and new requests wait at the door.',
            card: { tag: 'NUMBERS', title: 'Static batching wastes slots', stat: { v: '69 %', l: 'slot utilisation in this toy trace: 4 slots, 14 requests, 22 iterations' } },
            deep: '<p><b>Static (request-level) batching</b>, as in FasterTransformer or early TensorRT: collect B requests, pad to the longest, run until every sequence has finished, then start the next batch. Two costs follow: <i>padding compute</i> for finished sequences and <i>queueing delay</i> for anyone who arrives mid-batch.</p>' +
              '<p>Output lengths are heavy-tailed (a verdict of 10 tokens, a script of 2,000), so the expected waste is large. In this toy trace 4 slots and 14 requests reach only 69 % utilisation, and E, F, G and H wait 14 iterations for B.</p>'
          },
          {
            say: 'Continuous batching, introduced by Orca, schedules at the granularity of a single iteration. The moment one sequence emits its end token, its slot is refilled on the very next step.',
            card: { tag: 'KEY IDEA', title: 'Schedule per iteration', body: 'The batch is re-formed after <b>every</b> forward pass. Slots never wait for the slowest request, and newcomers start within one step.' },
            deep: '<p><b>Iteration-level scheduling</b> (Orca, OSDI 2022): the scheduler is re-invoked after every forward pass, so batch membership changes every 10–40 ms. A finished sequence is evicted at once and a waiting one takes its slot in the next iteration.</p>' +
              '<p>Same 14 requests, same four slots: utilisation reaches 100 % and ten requests complete inside the 22 iterations, against seven for static batching. The scheduler must also <b>preempt</b> when KV memory runs out, either swapping blocks to CPU or dropping them to recompute, usually victimising the most recently admitted sequence.</p>'
          },
          {
            say: 'The newcomer\'s prompt is prefilled inside the same iteration as everyone else\'s decode. Token-parallel layers see one flattened batch, and only attention runs per sequence, so there is no padding and no waiting.',
            card: { tag: 'HOW IT WORKS', title: 'Selective batching', body: 'Projections, MLP and norms run on one ragged, flattened batch. Attention runs per sequence through variable-length kernels.' },
            deep: '<p><b>Selective batching</b> makes ragged batches possible. All token-parallel ops (QKV and output projections, MLP, norms) run on the flattened batch</p>' +
              '<div class="eq">X ∈ ℝ<sup>(Σ<sub>i</sub> n<sub>i</sub>) × d</sup>,   n<sub>i</sub> = prompt length (prefill) or 1 (decode)</div>' +
              '<p>while attention runs per sequence through varlen or paged kernels using cumulative sequence offsets <code>cu_seqlens</code>. No padding, no per-batch recompilation.</p>' +
              '<details><summary>Go deeper</summary><p>With 37 running decoders plus one 412-token prefill, X has 449 rows at d = 8192. The GEMMs see M = 449 and read each weight once for everybody. The prefill sequence uses a causal varlen kernel over its 412 rows; the decoders use paged single-query kernels.</p></details>'
          },
          {
            say: 'In this toy trace that lifts slot utilisation from sixty nine to one hundred percent, and finishes ten requests instead of seven in the same twenty two iterations. Orca measured thirty seven times the throughput of FasterTransformer at equal latency.',
            card: { tag: 'NUMBERS', title: 'Orca versus static', stat: { v: '36.9×', l: 'throughput over FasterTransformer at equal latency, GPT-3 175B (Orca, OSDI 2022)' },
              more: '<p>Orca\'s gain has two sources: no padding compute for finished sequences, and no queueing behind long batches. The static baseline must pick a batch size that meets the latency target under worst-case padding, so at equal latency Orca can keep far more requests in flight. The ratio grows with output-length variance; with uniform lengths, static batching wastes almost nothing.</p>' },
            deep: '<table><tr><th>in this toy trace</th><th>static</th><th>continuous</th></tr>' +
              '<tr><td>slot utilisation</td><td>69 %</td><td>100 %</td></tr>' +
              '<tr><td>requests finished in 22 iters</td><td>7</td><td>10</td></tr></table>' +
              '<p>Reported gain: Orca 36.9× throughput over FasterTransformer at equal latency on GPT-3 175B. Every modern engine (vLLM, SGLang, TensorRT-LLM) schedules at iteration level. The catch: sequences now grow and leave at random, so KV memory <i>churns</i>, the problem PagedAttention solves next.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [0]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'CONTINUOUS (ITERATION-LEVEL) BATCHING', '4 batch slots · each column = one engine iteration · P = prefill iteration', 'red');
          var XC = 200, CW = 48, RH = 35;
          var st = schedStatic(), co = schedCont();
          function grid(y0, sim, title, col) {
            var g = ctx.group({ parent: G });
            ctx.text(XC, y0 - 22, title, { size: 14, font: 'display', weight: 600, color: col, parent: g });
            var cells = [];
            for (var s = 0; s < NS; s++) {
              ctx.text(XC - 12, y0 + s * RH + 15, 'slot ' + s, { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: g });
              cells.push([]);
              for (var c = 0; c < NC; c++) {
                var r = ctx.rect(XC + c * CW, y0 + s * RH, CW - 4, RH - 5, { rx: 4, fill: 'rgba(255,255,255,0.02)', stroke: ctx.alpha('faint', 0.8), sw: 0.8, parent: g });
                var cell = sim.g[s][c];
                var t = null;
                if (cell && cell.first) t = ctx.text(XC + c * CW + (CW - 4) / 2, y0 + s * RH + 15, REQS[cell.r][0] + '·P', { size: 11, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: g, opacity: 0 });
                cells[s].push({ r: r, t: t, v: cell });
              }
            }
            return { g: g, cells: cells, sim: sim };
          }
          S.gA = grid(262, st, 'STATIC BATCHING — batch runs until its longest member ends', 'red');
          S.gB = grid(560, co, 'CONTINUOUS BATCHING — a freed slot is refilled on the next iteration', 'lime');
          for (var c = 0; c < NC; c += 3) ctx.text(XC + c * CW + 22, 712, 'it ' + c, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gB.g });
          ctx.text(XC, 424, 'finished slots burn padding · E, F, G, H wait for B (14 iterations)', { size: 12, font: 'mono', color: 'dim', parent: S.gA.g });
          /* metrics */
          function metric(y, col) {
            var g = ctx.group({ parent: G });
            ctx.text(1300, y, 'slot utilisation', { size: 11.5, font: 'mono', color: 'dim', parent: g });
            var u = ctx.text(1300, y + 30, '0 %', { size: 26, font: 'display', weight: 700, color: col, parent: g });
            ctx.text(1300, y + 64, 'requests finished', { size: 11.5, font: 'mono', color: 'dim', parent: g });
            var d = ctx.text(1300, y + 92, '0', { size: 26, font: 'display', weight: 700, color: col, parent: g });
            return { g: g, u: u, d: d };
          }
          S.mA = metric(262, 'red');
          S.mB = metric(560, 'lime');
          /* beat 1 companion: the workload, 14 requests with very different output lengths */
          var wl = ctx.group({ parent: G });
          ctx.text(XC, 548, 'THE WORKLOAD · 14 requests, output length in iterations', { size: 12.5, font: 'mono', color: 'dim', parent: wl });
          var wStep = (NC * CW) / REQS.length;
          REQS.forEach(function (rq, i) {
            var bh = rq[1] * 10, bxw = wStep * 0.62, bxx = XC + i * wStep;
            ctx.rect(bxx, 722 - bh, bxw, bh, { rx: 3, fill: ctx.alpha(PAL[i], 0.5), stroke: PAL[i], sw: 1, parent: wl });
            ctx.text(bxx + bxw / 2, 722 - bh - 10, String(rq[1]), { size: 11.5, font: 'mono', weight: 700, color: PAL[i], anchor: 'middle', parent: wl });
            ctx.text(bxx + bxw / 2, 738, rq[0], { size: 11.5, font: 'mono', color: 'text', anchor: 'middle', parent: wl });
          });
          ctx.line(XC - 6, 722, XC + NC * CW, 722, { color: 'faint', parent: wl });
          S.playA = ctx.line(XC, 250, XC, 262 + NS * RH + 2, { color: 'white', sw: 1.6, parent: G, glow: true });
          S.playB = ctx.line(XC, 548, XC, 560 + NS * RH + 2, { color: 'white', sw: 1.6, parent: G, glow: true });
          /* beat 3: prefill rides with decode (highlight one iteration) */
          var COLK = 4;
          var colBox = ctx.rect(XC + COLK * CW - 4, 555, CW + 2, NS * RH + 8, { rx: 6, stroke: 'white', sw: 1.4, dash: '5 4', parent: G, glow: true });
          var colLab = ctx.label(XC + COLK * CW + 22, 736, 'iteration 4: E prefill + 3 decodes', { color: 'white', size: 11.5, parent: G });
          var sel = ctx.group({ parent: G });
          ctx.text(60, 774, 'selective batching:  token-wise ops on  X ∈ ℝ^((Σ nᵢ) × d)   ·   attention per sequence via varlen / paged kernels (cu_seqlens)', { size: 13, font: 'mono', color: 'text', parent: sel });
          ctx.text(60, 802, 'the new request\'s prefill (P) shares the iteration with everyone else\'s decode: no padding, no waiting for the batch', { size: 12.5, font: 'mono', color: 'dim', parent: sel });
          /* beat 4: the score */
          var dl = ctx.group({ parent: G });
          ctx.text(1300, 452, 'same 22 iterations, same 4 slots', { size: 11.5, font: 'mono', color: 'dim', parent: dl });
          ctx.text(1300, 478, 'utilisation 69 % → 100 %', { size: 14, font: 'mono', weight: 700, color: 'lime', parent: dl });
          ctx.text(1300, 502, 'finished 7 → 10  (+43 %)', { size: 14, font: 'mono', weight: 700, color: 'lime', parent: dl });
          function paint(gr, met, play, k) {
            var used = 0;
            for (var s = 0; s < NS; s++) for (var c = 0; c < NC; c++) {
              var ce = gr.cells[s][c];
              if (c < k) {
                if (ce.v) {
                  var col = PAL[ce.v.r];
                  ce.r.setAttribute('fill', ctx.alpha(col, ce.v.first ? 0.75 : 0.3));
                  ce.r.setAttribute('stroke', ctx.color(col));
                  used++;
                } else {
                  ce.r.setAttribute('fill', ctx.alpha('red', 0.08));
                  ce.r.setAttribute('stroke', ctx.alpha('red', 0.45));
                  ce.r.setAttribute('stroke-dasharray', '3 3');
                }
                if (ce.t) ce.t.setAttribute('opacity', 1);
              }
            }
            var done = gr.sim.ends.filter(function (e) { return e <= k; }).length;
            met.u.textContent = (k ? Math.round(100 * used / (NS * k)) : 0) + ' %';
            met.d.textContent = String(done);
            var x = XC + k * CW - 2;
            play.setAttribute('x1', x); play.setAttribute('x2', x);
          }
          paint(S.gA, S.mA, S.playA, 0);
          paint(S.gB, S.mB, S.playB, 0);
          hide([S.gB.g, S.mB.g, S.playB, colBox, colLab, sel, dl, wl]);
          /* beat 1: static batching */
          ctx.reveal([S.gA.g, S.mA.g, wl], { from: 'up', stagger: 150 });
          return ctx.wait(800).then(function () {
            return ctx.tween(4600, function (t) { paint(S.gA, S.mA, S.playA, Math.round(t * NC)); }, 'linear');
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: iteration-level scheduling */
            ctx.fade(wl, 0, 350);
            ctx.reveal([S.gB.g, S.mB.g, S.playB], { from: 'up', stagger: 150 });
            return ctx.wait(700).then(function () {
              return ctx.tween(5000, function (t) { paint(S.gB, S.mB, S.playB, Math.round(t * NC)); }, 'linear');
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: prefill and decode in one iteration, selective batching */
            ctx.reveal([colBox, colLab], { stagger: 150 });
            ctx.reveal(sel, { from: 'up', delay: 500 });
            var pc = [S.gB.cells[2][4].r, S.gB.cells[0][6].r, S.gB.cells[3][9].r];
            return pc.reduce(function (p, r) { return p.then(function () { return ctx.pulse(r, { color: 'white', dur: 600 }); }); }, ctx.wait(400));
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the score */
            ctx.hud('static 69 % → continuous 100 % slot utilisation');
            return ctx.reveal(dl, { from: 'up' }).then(function () {
              return Promise.all([ctx.pulse(S.mA.u, { color: 'red', dur: 600 }), ctx.pulse(S.mB.u, { color: 'lime', dur: 600 }), ctx.pulse(S.mB.d, { color: 'lime', dur: 600 })]);
            });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 4 */
      {
        title: 'PagedAttention',
        beats: [
          {
            say: 'Continuous batching makes memory churn: sequences grow one token at a time and leave at random. Reserving a contiguous slab of maximum length for every request wastes most of it, through reservation, internal fragmentation and external fragmentation.',
            card: { tag: 'NUMBERS', title: 'Most KV memory held no tokens', stat: { v: '20–38 %', l: 'of KV memory held real token states in pre-paging systems (vLLM paper)' } },
            deep: '<p>Before paging, engines gave each request one <b>contiguous slab</b> sized for the maximum output length. Three kinds of waste follow:</p>' +
              '<ul><li><b>reservation</b>: slots the request has not used yet but nobody else may touch;</li>' +
              '<li><b>internal fragmentation</b>: slab space that is never used because the output stops early;</li>' +
              '<li><b>external fragmentation</b>: gaps between slabs that no new slab fits into.</li></ul>' +
              '<p>The vLLM paper measured only 20.4–38.2 % of KV memory holding real token states in FasterTransformer and the Orca allocators. KV memory sets the batch size (previous step), so this waste directly caps throughput.</p>'
          },
          {
            say: 'PagedAttention borrows the operating system\'s answer, virtual memory. The KV cache is cut into fixed blocks of sixteen tokens, and the whole pool is just an array of such blocks that any sequence can use.',
            card: { tag: 'NUMBERS', title: 'One block is 1.25 MiB', stat: { v: '1.25', u: 'MiB / block', l: '16 tokens × 80 layers × 2 KV heads × 128 × K and V × 2 B, per GPU at TP 4' },
              more: '<p>Per token per GPU: 80 layers × 2 (K and V) × 2 KV heads × 128 dims × 2 B = 81,920 B = 80 KiB. Times 16 tokens = 1.25 MiB. Across all four GPUs (8 KV heads) a block is 5 MiB. A 50 GB pool holds about 38,000 such blocks per GPU, roughly 610,000 tokens.</p>' },
            deep: '<p>vLLM\'s block manager treats KV memory like paged virtual memory:</p>' +
              '<ul><li><b>page</b> = a KV block of 16 tokens covering all layers: 16 × 80 layers × 2 KV heads × 128 × 2 (K and V) × 2 B = <b>1.25 MiB per GPU</b> for our 70B at TP = 4;</li>' +
              '<li><b>page frame</b> = a slot in a preallocated pool (about 38k blocks in 50 GB here);</li>' +
              '<li><b>allocation</b> is O(1) from a free list; freeing never compacts.</li></ul>' +
              '<p>Block size trades internal fragmentation (small is better) against kernel efficiency and metadata (large is better). 16 is the vLLM default.</p>'
          },
          {
            say: 'Each sequence owns a block table that maps its logical blocks to physical blocks scattered anywhere in the pool. The attention kernel gathers keys and values through that indirection, one block at a time.',
            card: { tag: 'HOW IT WORKS', title: 'A page table for the KV cache', body: 'Token <code>pos</code> lives in physical block <code>table[pos // 16]</code> at offset <code>pos mod 16</code>. Neighbouring tokens need not be neighbours in memory.' },
            deep: '<div class="eq">slot(pos) = block_table[⌊pos/16⌋] · 16 + (pos mod 16)</div>' +
              '<p>The <code>block_table</code> is a per-sequence int32 array handed to the attention kernel. Inside the kernel each thread block walks the table, loads one <code>[16, h<sub>kv</sub>, d<sub>h</sub>]</code> tile of K and V from <code>kv_pool[layer, blk]</code>, and folds it into an online softmax.</p>' +
              '<p>Cost: one extra indirection per 16 tokens. FlashAttention-3 and FlashInfer paged kernels hide it almost entirely, which is why paging is on everywhere.</p>'
          },
          {
            say: 'Watch the pool. Blocks are allocated as sequences grow, one every sixteen tokens. When the critic\'s sequence ends, its blocks return to the free list at once, and a newcomer reuses them immediately, with no compaction and no copying.',
            card: { tag: 'HOW IT WORKS', title: 'Allocate and free in O(1)', body: 'Growing pops a block from the free list; finishing pushes every block back. All blocks have the same size, so fragmentation cannot happen.' },
            deep: '<p>Allocation is popping a block id from a free list; freeing decrements reference counts and pushes ids back. Because all blocks have the same size, <b>external fragmentation is impossible</b>, and the only waste is the unused tail of each sequence\'s last block.</p>' +
              '<p>When the pool is exhausted the scheduler <b>preempts</b>: it swaps a victim\'s blocks to CPU memory, or drops them and recomputes later (recompute is often cheaper than a PCIe swap for short sequences). Both work at block granularity.</p>'
          },
          {
            say: 'The result: waste is bounded by one partly filled block per sequence, under four percent. Parallel samples can even share prompt blocks, copy on write. The payoff is two to four times the throughput at the same latency.',
            card: { tag: 'NUMBERS', title: 'Paging pays for itself', stat: { v: '2–4×', l: 'vLLM throughput over Orca and FasterTransformer at equal latency (SOSP 2023)' } },
            deep: '<p>Waste is bounded by one partially filled block per sequence: under 4 % measured, versus only 20.4–38.2 % of KV memory holding real tokens in contiguous allocators. Result: 2–4× throughput at the same latency, with larger gains for long sequences and beam search.</p>' +
              '<p><b>Copy-on-write</b>: parallel samples and beam candidates share prompt blocks through reference counts; a block is copied only when a writer diverges. The same indirection later enables <b>prefix sharing</b> across unrelated requests (next step).</p>' +
              '<p><span class="muted">Cost: attention gathers K/V through the table; modern kernels hide it almost entirely.</span></p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [0, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'PAGEDATTENTION — KV AS VIRTUAL MEMORY', 'block = 16 tokens · per-sequence block tables · O(1) alloc / free', 'red');
          /* HBM bar (beat 1) */
          var HB = ctx.group({ parent: G });
          var hx = 640, sc = 900 / 80;
          var segs = [[17.5, 'amber', 'weights 17.5 GB'], [4.5, 'dim', ''], [50, 'red', 'KV block pool ≈ 50 GB ≈ 38k blocks'], [8, 'faint', 'headroom']];
          var cx0 = hx;
          segs.forEach(function (s) {
            ctx.rect(cx0, 186, s[0] * sc - 2, 26, { rx: 4, fill: ctx.alpha(s[1], 0.35), stroke: s[1], sw: 1, parent: HB });
            if (s[2]) ctx.text(cx0 + s[0] * sc / 2, 199, s[2], { size: 11.5, font: 'mono', color: 'white', anchor: 'middle', parent: HB });
            cx0 += s[0] * sc;
          });
          ctx.text(hx, 228, 'one H100 · HBM 80 GB', { size: 11, font: 'mono', color: 'dim', parent: HB });
          var kvL = hx + 22 * sc, kvR = hx + 72 * sc;
          ctx.path('M' + kvL + ',214 L660,288 M' + kvR + ',214 L1516,288', { stroke: ctx.alpha('red', 0.45), sw: 1, dash: '3 4', parent: HB });
          /* physical pool */
          var PX0 = 660, PY0 = 290, BW = 64, BH = 46, GAP = 8, COLS = 12, NB = 60;
          var rng = ctx.rng(11);
          var order = []; for (var i = 0; i < NB; i++) order.push(i);
          for (var j = NB - 1; j > 0; j--) { var k = Math.floor(rng() * (j + 1)); var tmp = order[j]; order[j] = order[k]; order[k] = tmp; }
          var starSet = {}; order.slice(0, 22).forEach(function (bi) { starSet[bi] = 1; });
          var free = order.slice(22);
          var PG = ctx.group({ parent: G });
          ctx.text(1088, 276, 'PHYSICAL KV POOL · 60 of ~38k blocks shown', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: PG });
          var pool = [];
          for (var b = 0; b < NB; b++) {
            var x = PX0 + (b % COLS) * (BW + GAP), y = PY0 + Math.floor(b / COLS) * (BH + GAP);
            var r = ctx.rect(x, y, BW, BH, { rx: 5, fill: '#0b1324', stroke: ctx.alpha('faint', 1), sw: 1, parent: PG });
            ctx.text(x + 5, y + 9, '#' + b, { size: 11, font: 'mono', color: 'dim', parent: PG });
            var lab = ctx.text(x + BW / 2, y + 30, '', { size: 12.5, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: PG });
            pool.push({ r: r, lab: lab, cx: x + BW / 2, cy: y + BH / 2 });
          }
          var SEQC = { A: 'cyan', B: 'lime', C: 'violet', D: 'orange' };
          function paintBlock(i, kind, seq, text) {
            var p = pool[i];
            p.r.removeAttribute('stroke-dasharray');
            p.lab.textContent = '';
            if (kind === 'free') { p.r.setAttribute('fill', '#0b1324'); p.r.setAttribute('stroke', ctx.C.faint); }
            else if (kind === 'gap') { p.r.setAttribute('fill', '#0b1324'); p.r.setAttribute('stroke', ctx.C.faint); p.lab.textContent = '×'; }
            else if (kind === 'other') { p.r.setAttribute('fill', ctx.alpha('red', 0.12)); p.r.setAttribute('stroke', ctx.alpha('red', 0.4)); }
            else if (kind === 'res') { p.r.setAttribute('fill', ctx.alpha(SEQC[seq], 0.07)); p.r.setAttribute('stroke', ctx.alpha(SEQC[seq], 0.55)); p.r.setAttribute('stroke-dasharray', '3 3'); }
            else { p.r.setAttribute('fill', ctx.alpha(SEQC[seq], 0.32)); p.r.setAttribute('stroke', ctx.color(SEQC[seq])); p.lab.textContent = text || seq; }
          }
          function setBlock(i, owner, text) { paintBlock(i, owner === null ? 'free' : 'used', owner, text); }
          /* beat 1 state: four contiguous slabs of 14 blocks (A 4 used, B 7, C 3, D 5) and a 4-block gap nobody fits in */
          var SLAB = [['A', 0, 14, 4], ['B', 14, 28, 7], ['C', 28, 42, 3], ['D', 42, 56, 5]];
          SLAB.forEach(function (s) { for (var q = s[1]; q < s[2]; q++) paintBlock(q, q - s[1] < s[3] ? 'used' : 'res', s[0], s[0]); });
          for (var gq = 56; gq < 60; gq++) paintBlock(gq, 'gap');
          function pagedBlock(i) { paintBlock(i, starSet[i] ? 'other' : 'free'); }
          function lgd(parent, items) {
            var g = ctx.group({ parent: parent });
            items.forEach(function (l) {
              ctx.rect(l[0], 574, 16, 14, { rx: 3, fill: l[2], stroke: l[3], sw: 1, dash: l[4], parent: g });
              ctx.text(l[0] + 22, 581, l[1], { size: 11, font: 'mono', color: 'dim', parent: g });
            });
            return g;
          }
          var legA = lgd(G, [[660, 'tokens stored', ctx.alpha('cyan', 0.32), 'cyan'], [810, 'reserved, empty', ctx.alpha('cyan', 0.07), ctx.alpha('cyan', 0.55), '3 3'], [980, 'free but unusable (×)', '#0b1324', ctx.C.faint]]);
          var legB = lgd(G, [[660, 'free', '#0b1324', ctx.C.faint], [770, 'other sequences in the batch', ctx.alpha('red', 0.12), ctx.alpha('red', 0.4)]]);
          var flT = ctx.text(1516, 581, 'free blocks: ' + free.length + ' / ' + NB, { size: 12, font: 'mono', weight: 700, color: 'lime', anchor: 'end', parent: G });
          var fmt = ctx.text(1516, 606, 'block = 16 tok × 80 layers × 2 KV heads × 128 × K,V × 2 B = 1.25 MiB / GPU', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          /* left panels: waste (beat 1), OS analogy (beat 2), logical view (beat 3) */
          var L1 = ctx.group({ parent: G });
          ctx.text(60, 262, 'THREE KINDS OF WASTE IN A CONTIGUOUS SLAB', { size: 12, font: 'mono', color: 'dim', parent: L1 });
          [['reservation', 'max_len slots are held from admission to the last token', 'red'], ['internal fragmentation', 'the answer stops early; the reserved tail is never used', 'amber'], ['external fragmentation', 'gaps between slabs are too small for the next request', 'pink']].forEach(function (rw, i) {
            var yy = 312 + i * 92;
            ctx.rect(60, yy - 26, 540, 78, { rx: 10, fill: ctx.alpha(rw[2], 0.06), stroke: ctx.alpha(rw[2], 0.5), sw: 1, parent: L1 });
            ctx.text(80, yy - 4, rw[0], { size: 14, font: 'display', weight: 700, color: rw[2], parent: L1 });
            ctx.text(80, yy + 24, rw[1], { size: 12, font: 'mono', color: 'text', parent: L1 });
          });
          var L2 = ctx.group({ parent: G });
          ctx.text(60, 262, 'THE OPERATING-SYSTEM ANALOGY', { size: 12, font: 'mono', color: 'dim', parent: L2 });
          ctx.text(80, 296, 'virtual memory', { size: 12.5, font: 'mono', weight: 700, color: 'dim', parent: L2 });
          ctx.text(340, 296, 'PagedAttention', { size: 12.5, font: 'mono', weight: 700, color: 'red', parent: L2 });
          [['4 KB page', '16-token KV block'], ['page table', 'per-sequence block table'], ['process', 'sequence'], ['physical frame', 'slot in the KV pool'], ['page fault → allocate', 'new block every 16 tokens'], ['swap to disk', 'swap to CPU, or recompute'], ['fork + copy-on-write', 'parallel samples share blocks']].forEach(function (rw, i) {
            var yy = 330 + i * 38;
            ctx.rect(60, yy - 15, 540, 32, { rx: 8, fill: 'rgba(255,255,255,0.025)', stroke: 'line', sw: 1, parent: L2 });
            ctx.text(76, yy + 1, rw[0], { size: 12.5, font: 'mono', color: 'text', parent: L2 });
            ctx.text(322, yy + 1, '→', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: L2 });
            ctx.text(340, yy + 1, rw[1], { size: 12.5, font: 'mono', weight: 600, color: 'white', parent: L2 });
          });
          var LG = ctx.group({ parent: G });
          ctx.text(60, 262, 'LOGICAL VIEW · block tables', { size: 12, font: 'mono', color: 'dim', parent: LG });
          var evT = ctx.text(60, 610, '', { size: 12.5, font: 'mono', color: 'lime', parent: LG });
          /* waste bars (beat 1: contiguous, beat 5: paged) */
          var WG = ctx.group({ parent: G });
          ctx.text(60, 640, 'KV MEMORY ACTUALLY HOLDING TOKENS', { size: 12, font: 'mono', color: 'dim', parent: WG });
          ctx.text(60, 668, 'contiguous, reserve max_len per request', { size: 12, font: 'mono', color: 'text', parent: WG });
          ctx.rect(60, 680, 520, 22, { rx: 4, fill: ctx.alpha('red', 0.1), stroke: ctx.alpha('red', 0.5), sw: 1, dash: '4 3', parent: WG });
          ctx.rect(60, 680, 520 * 0.3, 22, { rx: 4, fill: ctx.alpha('cyan', 0.5), stroke: 'cyan', sw: 1, parent: WG });
          ctx.text(60 + 520 * 0.3 + 10, 691, '20–38 % used · rest reserved or fragmented', { size: 11.5, font: 'mono', color: 'red', parent: WG });
          var WP = ctx.group({ parent: G });
          ctx.text(60, 728, 'paged, 16-token blocks', { size: 12, font: 'mono', color: 'text', parent: WP });
          ctx.rect(60, 740, 520, 22, { rx: 4, fill: ctx.alpha('lime', 0.1), stroke: ctx.alpha('lime', 0.5), sw: 1, parent: WP });
          ctx.rect(60, 740, 520 * 0.96, 22, { rx: 4, fill: ctx.alpha('lime', 0.5), stroke: 'lime', sw: 1, parent: WP });
          ctx.text(70, 751, '≥ 96 % used · waste ≤ 1 partial block / sequence', { size: 11.5, font: 'mono', color: 'white', parent: WP });
          var WC = ctx.text(60, 796, 'copy-on-write: parallel samples share prompt blocks (refcount > 1)', { size: 12, font: 'mono', color: 'dim', parent: G });
          hide([legB, flT, fmt, L2, LG, WP, WC]);
          hide([L1, WG, legA, HB, PG]);
          /* sequences (built in beat 3) */
          var seqs = {};
          var ROWY = { A: 318, B: 393, C: 468, D: 543 };
          var NAMES = { A: 'A · Director', B: 'B · Critic', C: 'C · Writer', D: 'D · Camera' };
          function updFree() { flT.textContent = 'free blocks: ' + free.length + ' / ' + NB; }
          function mkSeq(id, hidden) {
            var yy = ROWY[id];
            var g = ctx.group({ parent: LG });
            ctx.label(60, yy, NAMES[id], { color: SEQC[id], size: 12, anchor: 'start', parent: g });
            var tt = ctx.text(60, yy + 26, '', { size: 11, font: 'mono', color: 'dim', parent: g });
            var sq = { id: id, tok: 0, table: [], chips: [], cons: [], g: g, tt: tt, y: yy };
            seqs[id] = sq;
            if (hidden) g.setAttribute('opacity', 0);
            return sq;
          }
          function chipFor(sq, j, phys) {
            var cxx = 200 + j * 50, cyy = sq.y - 15;
            var cg = ctx.group({ parent: sq.g });
            ctx.rect(cxx, cyy, 44, 30, { rx: 4, fill: ctx.alpha(SEQC[sq.id], 0.14), stroke: SEQC[sq.id], sw: 1, parent: cg });
            ctx.text(cxx + 22, cyy + 12, '#' + phys, { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: cg });
            var fb = ctx.rect(cxx + 3, cyy + 23, 0, 4, { rx: 1, fill: SEQC[sq.id], parent: cg });
            var cn = ctx.line(cxx + 44, cyy + 15, pool[phys].cx, pool[phys].cy, { color: ctx.alpha(SEQC[sq.id], 0.4), sw: 1, parent: sq.g });
            sq.cons.push(cn);
            return { g: cg, fb: fb };
          }
          function refreshSeq(sq) {
            sq.tt.textContent = sq.tok + ' tok · ' + sq.table.length + ' blocks';
            sq.chips.forEach(function (c, jj) {
              var n = Math.max(0, Math.min(16, sq.tok - 16 * jj));
              c.fb.setAttribute('width', 38 * n / 16);
            });
          }
          function grow(sq, n, silent) {
            for (var t = 0; t < n; t++) {
              sq.tok++;
              if (sq.tok > 16 * sq.table.length) {
                var phys = free.shift();
                var j2 = sq.table.length;
                sq.table.push(phys);
                setBlock(phys, sq.id, sq.id + j2);
                sq.chips.push(chipFor(sq, j2, phys));
                if (!silent) ctx.pulse(pool[phys].r, { color: SEQC[sq.id], dur: 600 });
              }
            }
            refreshSeq(sq); updFree();
          }
          function freeSeq(sq) {
            var freed = sq.table.slice();
            freed.forEach(function (p) { setBlock(p, null); ctx.pulse(pool[p].r, { color: 'white', dur: 500 }); });
            free = freed.concat(free);
            sq.tt.textContent = 'EOS → ' + freed.length + ' blocks back to the free list';
            sq.cons.forEach(function (c) { c.setAttribute('opacity', 0); });
            sq.g.setAttribute('opacity', 0.35);
            updFree();
          }
          var frames = [];
          frames.push(function () { evT.textContent = 'A, B, C each append a token; a new block is popped every 16 tokens'; });
          for (var f = 0; f < 26; f++) frames.push(function () { grow(seqs.A, 1); grow(seqs.B, 1); grow(seqs.C, 1); });
          frames.push(function () { evT.textContent = 'B emits EOS: its blocks return to the free list'; freeSeq(seqs.B); });
          frames.push(function () { evT.textContent = 'D arrives and reuses those very blocks: no copy, no compaction'; seqs.D.g.setAttribute('opacity', 1); grow(seqs.D, 52); });
          for (var f2 = 0; f2 < 8; f2++) frames.push(function () { grow(seqs.A, 1); grow(seqs.C, 1); grow(seqs.D, 1); });
          S.pf = 0;
          function apply(n) { while (S.pf < n && S.pf < frames.length) { frames[S.pf](); S.pf++; } }
          /* beat 1: contiguous slabs waste memory */
          return Promise.all([
            ctx.reveal(HB, { from: 'down' }),
            ctx.reveal(PG, { delay: 400 }),
            ctx.reveal(L1, { from: 'right', delay: 700 }),
            ctx.reveal(legA, { delay: 1000 }),
            ctx.reveal(WG, { from: 'up', delay: 1200 })
          ]).then(function () { ctx.hud('KV waste: 60–80 % (contiguous)'); return ctx.pulse(pool[56].r, { color: 'pink', dur: 700 }); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: fixed-size blocks, the operating-system analogy */
            ctx.fade(L1, 0, 350); ctx.fade(legA, 0, 350);
            ctx.reveal(L2, { from: 'right', delay: 400 });
            return ctx.camera(1000, 330, 1.5, 700).then(function () {
              ctx.reveal([legB, flT, fmt], { delay: 100, stagger: 150 });
              return ctx.tween(1400, function (t) { var n = Math.round(t * NB); for (var i2 = 0; i2 < n; i2++) pagedBlock(i2); }, 'linear');
            }).then(function () { return ctx.wait(500); })
              .then(function () { return ctx.camera(800, 450, 1, 900); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: block tables map logical blocks to scattered physical blocks */
            ctx.fade(L2, 0, 350);
            var sA = mkSeq('A'), sB = mkSeq('B'), sC = mkSeq('C'); mkSeq('D', true);
            for (var st = 0; st < 5; st++) {
              if (sA.tok < 40) grow(sA, Math.min(16, 40 - sA.tok), true);
              if (sB.tok < 70) grow(sB, Math.min(16, 70 - sB.tok), true);
              if (sC.tok < 20) grow(sC, Math.min(16, 20 - sC.tok), true);
            }
            grow(seqs.D, 0, true);
            var aTab = seqs.A.table.join(', ');
            S.code = ctx.code({ parent: G, x: 660, y: 632, w: 880, title: 'paged attention kernel · per sequence, per layer', lang: 'py', size: 12, color: 'red', lines: [
              'block_table["A"] = [' + aTab + ', …]      # logical → physical, int32 on GPU',
              'slot = block_table[seq][pos // 16] * 16 + pos % 16          # where token pos is written',
              'for blk in block_table[seq]:  K, V = kv_pool[layer, blk]    # [16, h_kv, d_h] gather',
              '    m, l, o = online_softmax(m, l, o, q @ K.T / sqrt(d_h), V)',
              'free(seq): for blk in table: ref[blk] -= 1; if ref[blk] == 0: free_list.push(blk)'
            ] });
            ctx.reveal(LG, { from: 'right', delay: 400 });
            ctx.reveal(S.code, { from: 'up', delay: 800 });
            return ctx.wait(1000).then(function () {
              return seqs.A.table.reduce(function (p, phys) { return p.then(function () { return ctx.pulse(pool[phys].r, { color: 'cyan', dur: 500 }); }); }, Promise.resolve());
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: grow, free, reuse */
            return ctx.tween(7000, function (t) { apply(Math.round(t * frames.length)); }, 'linear').then(function () { return ctx.wait(500); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: the payoff */
            ctx.hud('KV waste: 60–80 % (contiguous) → < 4 % (paged)');
            return ctx.reveal(WP, { from: 'up' }).then(function () { return ctx.reveal(WC, { from: 'up' }); })
              .then(function () { return ctx.pulse(WP, { color: 'lime', dur: 700 }); });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Prefix caching',
        beats: [
          {
            say: 'Our agents are extremely repetitive. Every call from the crew starts with the same six thousand tokens of system prompt and tool schemas, then the same project bible describing the fox, the moon and the sketches.',
            card: { tag: 'NUMBERS', title: 'The shared trunk', stat: { v: '8,224', u: 'tokens', l: 'system prompt and tools (6,144) plus project bible (2,080), identical on every agent call' } },
            deep: '<p>Agentic traffic is dominated by <b>long, stable prefixes</b>: system prompt, tool schemas, project context, then a growing conversation. Only the tail of each call is new, yet a naive engine prefills all of it again.</p>' +
              '<p>That is pure waste. With a causal mask the KV of token <i>i</i> depends only on tokens ≤ <i>i</i>, so <b>identical prefixes have identical KV</b>. Compute the trunk once, keep its blocks, and every later call starts from there.</p>'
          },
          {
            say: 'Prefix caching keeps those KV blocks alive after a request ends. SGLang organises them as a radix tree over token sequences, so each agent thread is a branch that shares the same trunk.',
            card: { tag: 'HOW IT WORKS', title: 'A radix tree of KV blocks', body: 'Edges are token spans, nodes own their KV blocks. vLLM gets the same effect by hashing each 16-token block together with its predecessor.' },
            deep: '<p>Two equivalent implementations:</p>' +
              '<ul><li><b>vLLM automatic prefix caching</b>: each full block is keyed by a hash chain <code>h<sub>i</sub> = H(h<sub>i−1</sub>, tokens<sub>16i…16i+15</sub>, extras)</code> (extras: LoRA id, image hashes for multimodal prompts). A hit bumps the block\'s refcount and skips its prefill.</li>' +
              '<li><b>SGLang RadixAttention</b>: a radix tree whose edges are token spans and whose nodes own KV blocks. Eviction is LRU over leaves with refcount 0; the scheduler orders the queue <i>longest-prefix-first</i> to maximise hits.</li></ul>' +
              '<p>Both key on exact token ids, so a single differing token invalidates everything after it.</p>'
          },
          {
            say: 'When the critic asks to review shot three, the engine walks the tree from the root. The system prompt, the bible and the critic\'s own thread all hit, so nine thousand one hundred eighty four of the nine thousand five hundred ninety six prompt tokens come straight from cache.',
            card: { tag: 'NUMBERS', title: 'Walk the tree', stat: { v: '95.7 %', l: 'hit rate: 9,184 of 9,596 prompt tokens reused from cache' } },
            deep: '<table><tr><th>this request</th><th>tokens</th></tr>' +
              '<tr><td>system + tool schemas</td><td>6,144</td></tr><tr><td>project bible</td><td>2,080</td></tr>' +
              '<tr><td>critic thread</td><td>960</td></tr><tr><td><b>new suffix (prefilled)</b></td><td><b>412</b></td></tr></table>' +
              '<p>Lookup is a longest-prefix match from the root: O(prefix length / 16) hash lookups in vLLM, O(depth) node visits in SGLang. Matched blocks are pinned (refcount + 1) so eviction cannot pull them out from under the running request.</p>'
          },
          {
            say: 'Only the four hundred twelve new tokens are prefilled. Time to first token drops from about a third of a second to roughly thirty milliseconds, and the GPU time saved goes to other requests.',
            card: { tag: 'NUMBERS', title: 'Prefill the miss only', stat: { v: '≈ 11×', l: 'lower TTFT for this request: 0.34 s down to about 0.03 s' },
              more: '<p>Prefill costs about 35 µs per token per GPU here (2 × 17.5 GFLOP at roughly 1 PFLOP/s effective FP8), so 9,596 tokens take ≈ 0.34 s and 412 tokens ≈ 14 ms, plus one decode step and scheduling overhead. SGLang reports up to 6.4× throughput on agentic and few-shot workloads.</p>' },
            deep: '<div class="eq">TTFT ≈ n<sub>new</sub> · c<sub>tok</sub> + t<sub>step</sub> ≈ 412 × 35 µs + ≈ 15 ms ≈ 30 ms</div>' +
              '<p>Without the cache: 9,596 × 35 µs ≈ 0.34 s. The 412 new tokens attend over the cached 9,184 through the paged KV cache, so the result is exact, not approximate.</p>' +
              '<p>Beyond latency, every cached token is prefill compute the GPU can spend on somebody else\'s request, so throughput improves by a similar factor whenever prefill dominates.</p>'
          },
          {
            say: 'Memory is finite, so least recently used leaves with no active readers are evicted first. And since every replica has its own cache, the router must send each call to the replica that already holds its prefix.',
            card: { tag: 'PITFALL', title: 'Hit rates need stable prompts', body: 'One changed token near the top invalidates everything after it. Keep volatile text, like timestamps and tool results, at the <b>end</b> of the prompt.' },
            deep: '<p><b>Eviction</b>: LRU over leaves with refcount 0, so shared trunk nodes are the last to go. <b>Routing</b>: a cache hit exists on one replica only, so a round-robin balancer scatters a thread\'s requests and hit rates collapse as replicas scale out. KV-aware routers (the SGLang router, NVIDIA Dynamo, llm-d) hash the prefix or query a global block index, and fall back to least-loaded when the warm replica is saturated.</p>' +
              '<p><b>Prompt hygiene</b>: stable text first (system, tools, bible), append-only conversation next, volatile content last, and never reorder tool definitions between calls.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [0, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'PREFIX CACHING — A RADIX TREE OVER KV BLOCKS', 'agent prompts share long, stable prefixes: compute them once, reuse them for every call', 'red');
          var T = ctx.group({ parent: G });
          var root = ctx.group({ parent: T });
          ctx.circle(110, 470, 14, { fill: ctx.alpha('red', 0.25), stroke: 'red', parent: root });
          ctx.text(110, 500, 'root', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: root });
          root.box = bx(96, 456, 28, 28);
          function nd(x, y, w, title, sub, col) { return ctx.node({ x: x, y: y, w: w, h: 50, kind: 'pill', title: title, sub: sub, color: col || 'red', titleSize: 13, subSize: 11, glow: false, parent: T }); }
          S.n1 = nd(300, 470, 230, 'system + tool schemas', '6,144 tok · 384 blocks');
          S.n2 = nd(565, 470, 220, 'project bible', 'fox · moon · sketches · 2,080');
          S.bD = nd(815, 300, 190, 'Director thread', '1,420 tok', 'magenta');
          S.bW = nd(815, 470, 190, 'Writer thread', '2,310 tok', 'magenta');
          S.bC = nd(815, 640, 190, 'Critic thread', '960 tok', 'magenta');
          function leaf(x, y, title, col) { return ctx.node({ x: x, y: y, w: 170, h: 40, kind: 'pill', title: title, color: col || 'dim', titleSize: 12, glow: false, parent: T }); }
          S.lD = leaf(1040, 300, 'plan v2 · 210');
          S.lW1 = leaf(1040, 430, 'draft v1 · 640');
          S.lW2 = leaf(1040, 510, 'draft v2 · 380');
          S.lC = leaf(1040, 600, 'shot 2 review · 180');
          var edges = [[root, S.n1], [S.n1, S.n2], [S.n2, S.bD], [S.n2, S.bW], [S.n2, S.bC], [S.bD, S.lD], [S.bW, S.lW1], [S.bW, S.lW2], [S.bC, S.lC]];
          var links = edges.map(function (e) { return ctx.link(e[0], e[1], { from: 'r', to: 'l', color: ctx.alpha('red', 0.6), sw: 1.4, arrow: false, parent: T }); });
          var shared = ctx.label(432, 396, 'shared by every call · 8,224 tokens', { color: 'lime', size: 11.5, parent: T });
          /* the request that will walk the tree */
          S.lNew = ctx.node({ x: 1040, y: 690, w: 170, h: 40, kind: 'pill', title: 'shot 3 review · 412', color: 'amber', titleSize: 12, parent: T });
          var lnew = ctx.link(S.bC, S.lNew, { from: 'r', to: 'l', color: 'amber', sw: 1.6, arrow: false, parent: T });
          var mlab = ctx.label(1040, 726, 'MISS → prefill 412 tok', { color: 'amber', size: 11, parent: T });
          var ev = ctx.text(1040, 462, 'evicted · LRU leaf, ref = 0', { size: 11, font: 'mono', color: 'pink', anchor: 'middle', parent: T });
          /* right panel */
          var R = ctx.group({ parent: G });
          ctx.text(1190, 262, 'THIS REQUEST', { size: 13, font: 'display', weight: 700, color: 'white', parent: R });
          function stat(y, label, col) {
            ctx.text(1190, y, label, { size: 11.5, font: 'mono', color: 'dim', parent: R });
            return ctx.text(1530, y, '0', { size: 16, font: 'mono', weight: 700, color: col, anchor: 'end', parent: R });
          }
          S.sTot = stat(300, 'prompt tokens', 'white');
          S.sHit = stat(334, 'reused from cache', 'lime');
          S.sNew = stat(368, 'prefilled now', 'amber');
          S.sRate = stat(402, 'hit rate', 'lime');
          S.sTT = stat(436, 'TTFT (est.)', 'cyan');
          S.sTT.textContent = '0.34 s';
          var code = ctx.code({ parent: G, x: 1190, y: 480, w: 350, title: 'block hash chain (vLLM APC)', lang: 'py', size: 11.5, color: 'red', lines: [
            'h[0] = H(None, t[0:16])',
            'h[i] = H(h[i-1], t[16i:16i+16])',
            'if h[i] in cache: ref += 1   # hit',
            'else: alloc(); prefill()     # miss',
            'evict: LRU leaf, ref == 0'
          ] });
          var routeP = ctx.para(1190, 660, ['SGLang: radix tree + cache-aware', 'scheduling (longest prefix first)', 'router: send calls to the replica', 'that already holds the prefix'], { size: 12, font: 'mono', color: 'dim', parent: G, lh: 20 });
          S.req = ctx.label(96, 780, 'NEW  Critic → review_shot(3) · 9,596 prompt tokens', { color: 'magenta', size: 12.5, anchor: 'start', parent: G });
          hide([S.n1, S.n2, links[0], links[1], shared]);
          hide([root]);
          hide([S.bD, S.bW, S.bC, S.lD, S.lW1, S.lW2, S.lC].concat(links.slice(2)));
          hide([code, R, S.req, S.lNew, lnew, mlab, ev, routeP]);
          var path = [root, S.n1, S.n2, S.bC];
          /* beat 1: the shared trunk */
          return Promise.all([
            ctx.reveal(root, { from: 'scale' }),
            ctx.reveal(links[0], { from: 'draw', delay: 250 }),
            ctx.reveal(S.n1, { from: 'left', delay: 450 }),
            ctx.reveal(links[1], { from: 'draw', delay: 700 }),
            ctx.reveal(S.n2, { from: 'left', delay: 900 }),
            ctx.reveal(shared, { from: 'down', delay: 1300 })
          ]).then(function () { return Promise.all([ctx.pulse(S.n1, { color: 'lime', dur: 600 }), ctx.pulse(S.n2, { color: 'lime', dur: 600 })]); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: branches per agent thread, and the block hash chain */
            return Promise.all([
              ctx.reveal([S.bD, S.bW, S.bC], { from: 'left', stagger: 150 }),
              ctx.reveal(links.slice(2, 5), { from: 'draw', delay: 200, stagger: 150 }),
              ctx.reveal([S.lD, S.lW1, S.lW2, S.lC], { from: 'left', delay: 700, stagger: 120 }),
              ctx.reveal(links.slice(5), { from: 'draw', delay: 800, stagger: 120 }),
              ctx.reveal(code, { from: 'right', delay: 900 })
            ]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the critic's request walks the tree */
            ctx.hud('9,184 of 9,596 prompt tokens served from cache');
            ctx.reveal(R, { from: 'right' });
            ctx.reveal(S.req, { from: 'up', delay: 300 });
            ctx.counter(S.sTot, 0, 9596, 700);
            var chain = ctx.wait(900);
            path.forEach(function (n, i) {
              chain = chain.then(function () {
                ctx.pulse(n, { color: 'lime', dur: 500 });
                if (i > 0) {
                  ctx.highlight(n, { color: 'lime', pad: 4, parent: T, rx: 26 });
                  var hb = n.box;
                  ctx.reveal(ctx.label(hb.r - 22, hb.t - 10, 'HIT', { color: 'lime', size: 11, parent: T }), { from: 'scale', dur: 300 });
                  var cum = [0, 6144, 8224, 9184][i];
                  ctx.counter(S.sHit, [0, 0, 6144, 8224][i], cum, 350);
                }
                return ctx.wait(380);
              });
            });
            return chain.then(function () {
              ctx.counter(S.sRate, 0, 95.7, 600, function (v) { return v.toFixed(1) + ' %'; });
              return ctx.wait(700);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: only the miss is prefilled */
            ctx.reveal(lnew, { from: 'draw', dur: 400 });
            ctx.reveal([S.lNew, mlab], { from: 'scale', delay: 200 });
            ctx.counter(S.sNew, 0, 412, 600);
            return ctx.wait(1000).then(function () {
              S.sTT.textContent = '0.34 → 0.03 s';
              return ctx.pulse(S.sTT, { color: 'cyan', times: 2, dur: 500 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: eviction and cache-aware routing */
            ctx.fade(S.lW1, 0.25, 500);
            ctx.reveal(routeP, { from: 'up', delay: 400 });
            return ctx.reveal(ev, { dur: 400 }).then(function () { return ctx.pulse(S.lW1, { color: 'pink', times: 2, dur: 500 }); });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Chunked prefill',
        beats: [
          {
            say: 'Prefill and decode have opposite personalities. A twelve thousand token prompt from the writer is a huge compute bound job. If the engine runs it alone, sixty four decoding agents freeze for almost half a second.',
            card: { tag: 'NUMBERS', title: 'A half-second stall', stat: { v: '444 ms', l: 'worst inter-token latency when a 12,288-token prefill monopolises one iteration' } },
            deep: '<p>Prefill is compute-bound: 12,288 tokens × 35 µs ≈ 430 ms of tensor-core work, so the iteration that contains it lasts about 444 ms. Every decoder sharing that iteration waits for it: 64 agents see one 444 ms gap between two tokens, against a normal 11.6 ms. This is a <b>generation stall</b>: tail ITL and any streaming UI suffer even though average throughput looks fine.</p>' +
              '<p>Prefill-prioritising schedulers, like early vLLM, make it worse: every new arrival pre-empts decode for a whole iteration.</p>'
          },
          {
            say: 'Chunked prefill, as in Sarathi Serve, sets a token budget per iteration. Decodes go in first, one token each, and the prompt is sliced into chunks that fill the rest of the budget.',
            card: { tag: 'HOW IT WORKS', title: 'Decodes first, prompt fills the rest', body: 'Budget 1,024 tokens: 64 decodes plus a 960-token slice of the prompt. Thirteen iterations consume the whole 12,288-token prompt.' },
            deep: '<p><b>Stall-free batching</b> (Sarathi-Serve): each iteration gets a token budget τ. Schedule all running decodes first (1 token each), then fill τ − #decodes with a slice of the pending prompt.</p>' +
              '<div class="eq">t<sub>iter</sub> ≈ max( t<sub>mem</sub>, τ · c<sub>tok</sub> ) + t<sub>overhead</sub>,   t<sub>mem</sub> ≈ 11.6 ms,  c<sub>tok</sub> ≈ 35 µs</div>' +
              '<p>12,288 / 960 = 12.8, so 13 iterations. Chunks attend to all earlier chunks through the paged KV cache, so the result is identical to an unchunked prefill.</p>'
          },
          {
            say: 'Each chunk piggybacks on a decode iteration. Watch the slices land on top of the decode bars: every iteration now takes about thirty eight milliseconds, so the worst gap between tokens falls from four hundred forty four to thirty eight.',
            card: { tag: 'NUMBERS', title: 'Twelve times smoother', stat: { v: '≈ 12×', l: 'lower worst-case ITL for the 64 decoders: 444 ms down to 38 ms at τ = 1,024' },
              more: '<p>Prefill alone: 12,288 × 35 µs ≈ 430 ms, plus the 11.6 ms decode step in the same iteration ≈ 444 ms. Chunked at τ = 1,024: t = max(11.6, 1,024 × 0.035 = 35.8) + 2 ≈ 38 ms per iteration. 444 / 38 ≈ 11.7, hence about twelve times. The prompt now needs 13 iterations, so its own first token arrives after 13 × 38 ≈ 0.49 s.</p>' },
            deep: '<table><tr><th></th><th>prefill alone</th><th>chunked, τ = 1,024</th></tr>' +
              '<tr><td>worst ITL (64 decoders)</td><td>≈ 444 ms</td><td>≈ 38 ms</td></tr>' +
              '<tr><td>new request TTFT</td><td>≈ 0.43 s</td><td>13 × 38 ms ≈ 0.49 s</td></tr></table>' +
              '<p>Reported: 2.6× serving capacity for Mistral-7B on one A100 and up to 5.6× for Falcon-180B (Sarathi-Serve, OSDI 2024). Chunked prefill is on by default in vLLM V1 and SGLang.</p>'
          },
          {
            say: 'The price is a slightly slower first token for the newcomer, about fourteen percent here. The budget is set from the latency target: below roughly three hundred thirty tokens an iteration is still memory bound, so prefill rides along for free.',
            card: { tag: 'TRADE-OFF', title: 'The budget trades TTFT for ITL', body: 'A bigger budget finishes the prompt sooner but stretches every decoder\'s step. Pick <b>τ</b> from the TPOT objective, not from peak throughput.' },
            deep: '<p>Choosing τ: below ≈ 330 tokens (t<sub>mem</sub> / c<sub>tok</sub> = 11.6 ms / 35 µs) the iteration is still memory-bound, so prefill tokens ride along for free. Above it each extra token costs c<sub>tok</sub>. The TPOT objective fixes the ceiling: for 50 ms, τ ≤ (50 − 2) / 0.035 ≈ 1,370.</p>' +
              '<p>TTFT: 0.43 s → 0.49 s (+14 %). Knobs: <code>max_num_batched_tokens</code> in vLLM, <code>chunked_prefill_size</code> in SGLang. Budgets that are too small add launch overhead and re-read the weights more often.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [0, 1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'CHUNKED PREFILL — PIGGYBACK PROMPTS ON DECODE', '64 agents decoding · a 12,288-token Writer prompt arrives at iteration 3', 'red');
          var X0 = 150, SW = 56.25, BWd = 34;
          function bxAt(i) { return X0 + i * SW + (SW - BWd) / 2; }
          function chart(y0, h, title, col) {
            var g = ctx.group({ parent: G });
            ctx.text(X0, y0 - 18, title, { size: 13.5, font: 'display', weight: 600, color: col, parent: g });
            ctx.line(X0, y0 + h, X0 + 16 * SW, y0 + h, { color: 'faint', parent: g });
            ctx.line(X0, y0, X0, y0 + h, { color: 'faint', parent: g });
            ctx.line(X0 + 16 * SW, y0, X0 + 16 * SW, y0 + h, { color: ctx.alpha('red', 0.4), parent: g });
            ctx.text(X0 - 6, y0, '1,200', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
            ctx.text(X0 - 6, y0 + h, '0', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
            ctx.text(X0 + 16 * SW + 6, y0, '450 ms', { size: 11, font: 'mono', color: 'red', parent: g });
            ctx.text(X0 + 16 * SW + 6, y0 + h, '0', { size: 11, font: 'mono', color: 'red', parent: g });
            return g;
          }
          var yA = 266, yB = 552, H = 186;
          function tokY(y0, v) { return y0 + H - Math.min(1200, v) / 1200 * H; }
          function itlY(y0, v) { return y0 + H - v / 450 * H; }
          var gA = chart(yA, H, 'PREFILL ALONE — decodes stall while 12,288 prompt tokens run', 'red');
          var gB = chart(yB, H, 'CHUNKED — token budget τ = 1,024 per iteration (64 decode + 960 prefill)', 'lime');
          ctx.text(X0 - 42, yA + H / 2, 'tok', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: gA });
          for (var i = 0; i < 16; i++) ctx.text(bxAt(i) + BWd / 2, yB + H + 16, String(i), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: gB });
          ctx.text(X0 + 8 * SW, yB + H + 36, 'engine iteration', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: gB });
          /* chart A bars */
          var barsA = [], itlA = [];
          for (var a = 0; a < 16; a++) {
            var bg = ctx.group({ parent: gA });
            if (a === 3) {
              ctx.rect(bxAt(a), yA, BWd, H, { rx: 2, fill: ctx.alpha('amber', 0.55), stroke: 'amber', sw: 1, parent: bg });
              ctx.path('M' + bxAt(a) + ',' + (yA + 8) + ' l8,-6 l9,6 l9,-6 l8,6', { stroke: 'bg', sw: 3, parent: bg });
              itlA.push([a, 444]);
            } else {
              ctx.rect(bxAt(a), tokY(yA, 64), BWd, H * 64 / 1200, { rx: 2, fill: ctx.alpha('cyan', 0.6), stroke: 'cyan', sw: 1, parent: bg });
              itlA.push([a, 11.6]);
            }
            barsA.push(bg);
          }
          var spikeT = ctx.group({ parent: gA });
          ctx.text(bxAt(3) + BWd + 10, yA + 14, '12,288 prefill tokens (off scale)', { size: 11.5, font: 'mono', color: 'amber', parent: spikeT });
          ctx.text(bxAt(3) + BWd + 10, yA + 34, 'ITL spike ≈ 444 ms for all 64 decoders', { size: 11.5, font: 'mono', color: 'red', parent: spikeT });
          function itlPath(y0, pts) {
            return pts.map(function (p, k) { return (k ? 'L' : 'M') + (bxAt(p[0]) + BWd / 2) + ',' + itlY(y0, p[1]).toFixed(1); }).join(' ');
          }
          var lineA = ctx.path(itlPath(yA, itlA), { stroke: 'red', sw: 2, parent: gA, glow: true });
          /* chart B */
          var decB = [], itlB = [];
          for (var b = 0; b < 16; b++) {
            decB.push(ctx.rect(bxAt(b), tokY(yB, 64), BWd, H * 64 / 1200, { rx: 2, fill: ctx.alpha('cyan', 0.6), stroke: 'cyan', sw: 1, parent: gB }));
            var tok = b < 3 ? 64 : (b < 15 ? 1024 : 832);
            itlB.push([b, Math.max(11.6, tok * 0.035 + 2)]);
          }
          var budget = ctx.line(X0, tokY(yB, 1024), X0 + 16 * SW, tokY(yB, 1024), { color: 'lime', sw: 1.2, dash: '6 4', parent: gB });
          var budgetT = ctx.text(X0 + 16 * SW - 4, tokY(yB, 1024) - 10, 'τ = 1,024', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: gB });
          var lineB = ctx.path(itlPath(yB, itlB), { stroke: 'red', sw: 2, parent: gB, glow: true });
          var itlBL = ctx.text(bxAt(0), yB + H - 44, 'ITL ≤ 38 ms', { size: 11.5, font: 'mono', color: 'red', parent: gB });
          /* legend */
          var lg = ctx.group({ parent: G });
          [['decode tokens', 'cyan'], ['prefill tokens', 'amber'], ['ITL (right axis)', 'red']].forEach(function (l, k) {
            ctx.rect(150 + k * 190, 822, 16, 12, { rx: 2, fill: ctx.alpha(l[1], 0.6), stroke: l[1], sw: 1, parent: lg });
            ctx.text(172 + k * 190, 828, l[0], { size: 11.5, font: 'mono', color: 'dim', parent: lg });
          });
          /* right panel: the prompt, whole and then sliced */
          var R = ctx.group({ parent: G });
          ctx.text(1120, 262, 'NEW REQUEST · Writer agent', { size: 13, font: 'display', weight: 700, color: 'white', parent: R });
          ctx.text(1120, 284, '12,288-token context → 13 chunks', { size: 12, font: 'mono', color: 'amber', parent: R });
          ctx.rect(1120, 300, 400, 30, { rx: 4, fill: 'none', stroke: ctx.alpha('amber', 0.6), sw: 1, dash: '4 3', parent: R });
          var pbar = ctx.rect(1120, 300, 400, 30, { rx: 4, fill: ctx.alpha('amber', 0.55), stroke: 'amber', sw: 1, parent: R });
          var para1 = ctx.para(1120, 380, [
            'tokens / iter = 64 decode + 960 prefill',
            't_iter ≈ max(t_mem, t_comp) + 2 ms',
            't_mem ≈ 11.6 ms (weights + KV)',
            't_comp ≈ 1,024 × 35 µs ≈ 36 ms',
            'ITL ≈ 38 ms ✓ under a 50 ms SLO'
          ], { size: 12, font: 'mono', color: 'text', parent: G, lh: 22 });
          var para2 = ctx.para(1120, 520, [
            'TTFT, prefill alone ≈ 0.43 s',
            'TTFT, chunked 13 × 38 ms ≈ 0.49 s',
            'trade: +14 % TTFT for ~12× lower',
            'worst-case ITL for everyone else'
          ], { size: 12, font: 'mono', color: 'dim', parent: G, lh: 22 });
          var chunks = [];
          for (var c = 0; c < 13; c++) {
            var w = c < 12 ? 31.25 : 25, v = c < 12 ? 960 : 768;
            var cr = ctx.rect(1120 + c * 31.25, 300, w - 1.5, 30, { rx: 2, fill: ctx.alpha('amber', 0.55), stroke: 'amber', sw: 1, parent: G });
            chunks.push({ r: cr, sx: 1120 + c * 31.25, w: w - 1.5, tx: bxAt(3 + c), ty: tokY(yB, 64 + v), th: H * v / 1200 });
          }
          /* beat 4: iteration time against the token budget */
          var TP = ctx.group({ parent: G });
          ctx.text(1120, 632, 'ITERATION TIME vs TOKEN BUDGET τ', { size: 12, font: 'mono', color: 'dim', parent: TP });
          var tpl = ctx.plot(1130, 668, 390, 100, function (tau) { return Math.max(11.6, 0.035 * tau) + 2; }, { xDomain: [0, 2048], yDomain: [0, 80], color: 'cyan', sw: 2.2, samples: 100, yLabel: 'ms / iteration', parent: TP });
          var y50 = tpl.toPx(0, 50).y;
          ctx.line(1130, y50, 1520, y50, { color: 'red', sw: 1.2, dash: '5 4', parent: TP });
          ctx.text(1136, y50 - 11, 'SLO 50 ms', { size: 11, font: 'mono', color: 'red', parent: TP });
          var kx = tpl.toPx(331, 0).x;
          ctx.line(kx, 768, kx, tpl.toPx(331, 13.6).y, { color: ctx.alpha('cyan', 0.6), sw: 1, dash: '2 3', parent: TP });
          var pt = tpl.toPx(1024, 37.8);
          ctx.circle(pt.x, pt.y, 5, { fill: 'lime', parent: TP, glow: true });
          ctx.text(pt.x + 12, pt.y + 24, 'τ = 1,024 → 38 ms', { size: 11.5, font: 'mono', color: 'lime', parent: TP });
          [[0, '0'], [1024, '1k'], [2048, '2k']].forEach(function (t) { ctx.text(tpl.toPx(t[0], 0).x, 784, t[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: TP }); });
          ctx.text(kx, 784, 'knee ≈ 330', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: TP });
          ctx.text(1520, 804, 'token budget τ (tokens / iteration)', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: TP });
          hide([gB, lineB, itlBL, para1, para2, TP, spikeT, lineA]); hide(decB);
          hide(chunks.map(function (cc) { return cc.r; })); hide(barsA); hide([gA, R, lg]);
          /* beat 1: prefill alone stalls everyone */
          ctx.reveal([gA, R, lg], { from: 'up', stagger: 150 });
          return ctx.wait(500).then(function () {
            return ctx.reveal(barsA, { from: 'up', stagger: 60, dist: 10 });
          }).then(function () {
            return Promise.all([ctx.reveal(lineA, { from: 'draw', dur: 1000 }), ctx.reveal(spikeT, { delay: 500 })]);
          }).then(function () { return ctx.pulse(barsA[3], { color: 'red', times: 2, dur: 600 }); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the token budget and the sliced prompt */
            ctx.hud('token budget 1,024: 64 decode + 960 prefill');
            ctx.fade(pbar, 0, 350);
            ctx.reveal(chunks.map(function (cc) { return cc.r; }), { delay: 150, stagger: 40 });
            return Promise.all([ctx.reveal(gB, { from: 'up' }), ctx.reveal(para1, { from: 'right', delay: 500 })]).then(function () {
              return ctx.reveal(decB, { from: 'up', stagger: 40, dist: 8 });
            }).then(function () { return ctx.pulse(budgetT, { color: 'lime', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: chunks land on the decode bars */
            return ctx.wait(300).then(function () {
              return Promise.all(chunks.map(function (c, k) {
                return ctx.tween(650, function (t) {
                  c.r.setAttribute('x', ctx.lerp(c.sx, c.tx, t));
                  c.r.setAttribute('y', ctx.lerp(300, c.ty, t));
                  c.r.setAttribute('width', ctx.lerp(c.w, BWd, t));
                  c.r.setAttribute('height', ctx.lerp(30, c.th, t));
                }, 'inOut', k * 180);
              }));
            }).then(function () {
              return Promise.all([ctx.reveal(lineB, { from: 'draw', dur: 900 }), ctx.reveal(itlBL, { delay: 600 })]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the price and the tuning of the budget */
            ctx.hud('worst ITL 444 ms → 38 ms · TTFT +14 %');
            return Promise.all([ctx.reveal(para2, { from: 'right' }), ctx.reveal(TP, { from: 'up', delay: 400 })]).then(function () {
              return ctx.pulse(itlBL, { color: 'red', dur: 600 });
            });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 7 */
      {
        title: 'P/D disaggregation',
        beats: [
          {
            say: 'Chunking still makes prefill and decode share one GPU and one parallel layout. At scale, systems like DistServe, Splitwise, Mooncake and NVIDIA Dynamo split them apart into separate pools.',
            card: { tag: 'KEY IDEA', title: 'Two phases, two fleets', body: 'Prefill wants compute and modest batches; decode wants bandwidth, KV capacity and huge batches. Give each its own GPUs and its own tuning.' },
            deep: '<p><b>Why split</b>: prefill wants compute and a modest batch; decode wants bandwidth, KV capacity and very large batches. Colocated, they interfere (chunking bounds the interference but does not remove it) and must share one tensor / pipeline layout and one memory budget.</p>' +
              '<p>Disaggregation lets each phase choose its own parallelism, hardware and batch policy, and scale to its own objective: TTFT for the prefill pool, TPOT for the decode pool.</p>'
          },
          {
            say: 'A prefill pool, tuned for compute, takes the routed prompt. Its GPUs chew through the whole eight thousand token prompt in large, efficient chunks and build the KV cache for it.',
            card: { tag: 'HOW IT WORKS', title: 'Prefill pool: compute first', body: 'Long prompts run at high tensor-core utilisation with a latency-oriented layout. The router picks the instance with the warmest prefix and the shortest queue.' },
            deep: '<p>The <b>KV-aware router</b> picks a prefill instance by prefix hit and queue length (Dynamo\'s router, Mooncake\'s conductor), then pairs it with a decode instance that has KV headroom. Prefill instances use tensor parallelism sized for latency, small batches and no long-lived KV: blocks are freed as soon as they are shipped.</p>' +
              '<p>Compute-bound prefill saturates the tensor cores at roughly a thousand tokens per iteration, so batching more prompts together adds latency but hardly any throughput.</p>'
          },
          {
            say: 'The KV blocks are then streamed, layer group by layer group, over NVLink or RDMA to the decode pool while later layers are still computing. Only the last group is exposed in time to first token.',
            card: { tag: 'NUMBERS', title: 'A prompt is gigabytes of KV', stat: { v: '2.68 GB', l: 'KV cache of an 8,192-token prompt in BF16: about 13 ms per GPU shard over 400 Gb/s RDMA' },
              more: '<p>Per token across the four GPUs: 80 layers × 2 (K, V) × 8 KV heads × 128 × 2 B = 327,680 B = 320 KiB. Times 8,192 tokens = 2.68 GB (2.5 GiB). Each tensor-parallel shard owns 2 of the 8 KV heads and sends 671 MB. Layerwise pipelining lets the decode side receive group g while the prefill side computes group g + 1.</p>' },
            deep: '<div class="eq">KV bytes = n<sub>prompt</sub> · L · 2 · h<sub>kv</sub> · d<sub>h</sub> · b = 8,192 · 80 · 2 · 8 · 128 · 2 B ≈ 2.68 GB</div>' +
              '<p>Per TP shard 671 MB: ≈ 13 ms over a 400 Gb/s RDMA NIC per GPU, ≈ 1.5 ms over NVLink 4 (≈ 450 GB/s per direction). Transfers are pipelined per layer group, so only the last group is exposed in TTFT.</p>' +
              '<p>NIXL (Dynamo), Mooncake\'s Transfer Engine and NCCL P2P move blocks GPU-to-GPU without staging through host memory.</p>'
          },
          {
            say: 'The decode pool, tuned for memory bandwidth and very large batches, takes over the sequence and streams tokens back to the agents. A long prompt elsewhere can no longer stall these decoders.',
            card: { tag: 'WHY IT MATTERS', title: 'Decode never stalls', body: 'With no prefill in the batch, TPOT stays flat and can be tuned for bandwidth: batch around 256, FP8 KV, huge KV pools.' },
            deep: '<p>The decode pool runs the memory-bound loop at large batch (here about 256 sequences per instance) with FP8 KV cache and CUDA graphs, and never sees a prefill chunk, so TPOT is set only by weight and KV traffic. It may use a different tensor-parallel degree than prefill; the KV layout is converted on transfer.</p>' +
              '<p><b>Return path</b>: the same server-sent event stream, now originating at the decode instance. The router only keeps the request record.</p>'
          },
          {
            say: 'Each pool scales on its own signal, with its own parallel layout. DistServe reports seven point four times more requests at the same latency targets, and DeepSeek serves prefill and decode on very different expert parallel layouts.',
            card: { tag: 'STATE OF THE ART', title: 'DeepSeek-V3: EP32 and EP320', body: 'Prefill runs on 32-GPU units, decode on 320-GPU units, each with its own expert-parallel degree. The prefill to decode mix is tuned online.' },
            deep: '<ul><li><b>DistServe</b> (OSDI 2024): optimises goodput per GPU; 7.4× more requests or 12.6× tighter SLOs than colocated serving.</li>' +
              '<li><b>Splitwise</b> (ISCA 2024): prefill on H100, decode on cheaper or power-capped parts.</li>' +
              '<li><b>Mooncake</b> (Kimi, FAST 2025): KV-cache-centric, a distributed KV pool in CPU DRAM and SSD across the cluster.</li>' +
              '<li><b>NVIDIA Dynamo</b> + NIXL: disaggregated serving, KV-aware router, GPU-direct KV movement.</li>' +
              '<li><b>MoE planners</b> gain even more: DeepSeek-V3 serves prefill on 32-GPU units (EP32) and decode on 320-GPU units (EP320).</li></ul>' +
              '<p>Agent traffic (long prompts, short answers) needs a <b>high P:D ratio</b>; the xPyD mix is tuned online from queue depth and KV occupancy.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [1, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'PREFILL / DECODE DISAGGREGATION', 'two pools, two parallel layouts · KV cache moves between them', 'red');
          S.router = ctx.node({ x: 170, y: 460, w: 180, h: 70, title: 'KV-aware router', sub: 'prefix + load', icon: 'net', color: 'red', titleSize: 14, subSize: 11, parent: G });
          var PP = ctx.group({ parent: G });
          ctx.rect(330, 236, 440, 456, { rx: 14, fill: ctx.alpha('amber', 0.03), stroke: ctx.alpha('amber', 0.6), dash: '6 6', sw: 1.2, parent: PP });
          ctx.text(348, 258, 'PREFILL POOL', { size: 13, font: 'display', weight: 700, color: 'amber', parent: PP });
          ctx.text(348, 278, 'compute-bound · large chunks', { size: 11.5, font: 'mono', color: 'dim', parent: PP });
          var DP = ctx.group({ parent: G });
          ctx.rect(830, 236, 710, 456, { rx: 14, fill: ctx.alpha('cyan', 0.03), stroke: ctx.alpha('cyan', 0.6), dash: '6 6', sw: 1.2, parent: DP });
          ctx.text(848, 258, 'DECODE POOL', { size: 13, font: 'display', weight: 700, color: 'cyan', parent: DP });
          ctx.text(848, 278, 'memory-bound · batch ≈ 256 · FP8 KV', { size: 11.5, font: 'mono', color: 'dim', parent: DP });
          function pInst(y, name) {
            var ig = ctx.group({ parent: PP });
            var n = ctx.node({ x: 550, y: y, w: 380, h: 150, kind: 'box', color: 'amber', parent: ig });
            ctx.text(378, y - 52, name + ' · 4× H100 · TP = 4', { size: 12.5, font: 'mono', color: 'white', parent: ig });
            for (var i = 0; i < 4; i++) {
              ctx.rect(380 + i * 88, y - 34, 72, 48, { rx: 5, fill: ctx.alpha('amber', 0.1), stroke: ctx.alpha('amber', 0.7), sw: 1, parent: ig });
              ctx.icon('gpu', 416 + i * 88, y - 10, 26, 'amber', { parent: ig });
            }
            ctx.rect(380, y + 34, 340, 12, { rx: 3, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('amber', 0.5), sw: 1, parent: ig });
            n.pb = ctx.rect(380, y + 34, 0, 12, { rx: 3, fill: ctx.alpha('amber', 0.7), parent: ig });
            ctx.text(550, y + 60, 'layers 0 … 79', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: ig });
            n.grp = ig;
            return n;
          }
          S.P0 = pInst(390, 'P0'); S.P1 = pInst(585, 'P1');
          function dInst(y, name, occ) {
            var ig = ctx.group({ parent: DP });
            var n = ctx.node({ x: 1185, y: y, w: 660, h: 100, kind: 'box', color: 'cyan', parent: ig });
            ctx.text(872, y - 26, name + ' · 4× H100 · TP = 4', { size: 12.5, font: 'mono', color: 'white', parent: ig });
            for (var i = 0; i < 4; i++) {
              ctx.rect(872 + i * 34, y - 6, 28, 30, { rx: 4, fill: ctx.alpha('cyan', 0.1), stroke: ctx.alpha('cyan', 0.7), sw: 1, parent: ig });
            }
            ctx.text(1500, y - 26, 'KV pool occupancy', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: ig });
            ctx.rect(1030, y - 6, 470, 16, { rx: 3, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('cyan', 0.5), sw: 1, parent: ig });
            n.kb = ctx.rect(1030, y - 6, 470 * occ, 16, { rx: 3, fill: ctx.alpha('cyan', 0.55), parent: ig });
            ctx.text(1030, y + 26, 'seqs decoding: ' + Math.round(occ * 300), { size: 11, font: 'mono', color: 'dim', parent: ig });
            n.grp = ig;
            return n;
          }
          S.D0 = dInst(345, 'D0', 0.78); S.D1 = dInst(470, 'D1', 0.62); S.D2 = dInst(595, 'D2', 0.84);
          var l1 = ctx.link(S.router, S.P0, { from: 'r', to: 'l', color: 'amber', label: '8k prompt', labelDy: -14, parent: G });
          S.xfer = ctx.link({ x: 740, y: 390 }, { x: 855, y: 470 }, { color: 'red', sw: 2.4, parent: G });
          var xl = ctx.label(800, 706, 'KV blocks · RDMA / NVLink (NIXL)', { color: 'red', size: 11, parent: G });
          var xlead = ctx.line(800, 694, 797, 440, { color: ctx.alpha('red', 0.45), sw: 1, dash: '2 3', parent: G });
          S.ret = ctx.path('M1185,692 C1185,760 170,760 170,495', { stroke: 'cyan', sw: 1.6, dash: '5 5', arrow: true, parent: G });
          S.ret.len = S.ret.getTotalLength();
          var rl = ctx.text(1000, 750, 'tokens → agents (SSE)', { size: 11.5, font: 'mono', color: 'cyan', anchor: 'middle', parent: G });
          /* timeline (beats 3 and 4) */
          var TL = ctx.group({ parent: G });
          [['prefill', 792], ['KV xfer', 820]].forEach(function (r) { ctx.text(330, r[1], r[0], { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: TL }); });
          var decLab = ctx.text(330, 848, 'decode', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: TL });
          var tlp = [], tlx = [], tlpT = [];
          for (var g = 0; g < 5; g++) {
            tlp.push(ctx.rect(340 + g * 82, 783, 78, 18, { rx: 3, fill: ctx.alpha('amber', 0.5), stroke: 'amber', sw: 1, parent: TL }));
            tlpT.push(ctx.text(379 + g * 82, 792, 'L' + g * 16 + '–' + (g * 16 + 15), { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: TL }));
            tlx.push(ctx.rect(418 + g * 82, 811, 26, 18, { rx: 3, fill: ctx.alpha('red', 0.55), stroke: 'red', sw: 1, parent: TL }));
          }
          var tld = [];
          for (var d = 0; d < 12; d++) tld.push(ctx.rect(772 + d * 28, 839, 20, 18, { rx: 3, fill: ctx.alpha('cyan', 0.5), stroke: 'cyan', sw: 1, parent: TL }));
          var ttftB = bracket(ctx, G, 340, 792, 768, 'TTFT ≈ prefill + last KV group + 1 decode step', 'amber', true);
          var kvNums = ctx.para(1130, 792, ['8k prompt → 2.68 GB KV (BF16)', '671 MB / TP shard: ≈ 13 ms @ 400 Gb/s', '≈ 1.5 ms over NVLink (450 GB/s/dir)'], { size: 12, font: 'mono', color: 'text', parent: TL, lh: 22 });
          /* beat 5: scale each pool on its own signal */
          var SC = ctx.group({ parent: G });
          [[60, 470, 'PREFILL POOL scales on', 'queue depth · TTFT objective', 'amber'], [550, 470, 'DECODE POOL scales on', 'KV occupancy · TPOT objective', 'cyan'], [1040, 500, 'DeepSeek-V3 (MoE)', 'prefill EP32 · 32 GPUs  |  decode EP320 · 320 GPUs', 'lime']].forEach(function (c) {
            ctx.rect(c[0], 764, c[1], 84, { rx: 12, fill: ctx.alpha(c[4], 0.05), stroke: ctx.alpha(c[4], 0.6), sw: 1.2, parent: SC });
            ctx.text(c[0] + 18, 792, c[2], { size: 14, font: 'display', weight: 700, color: c[4], parent: SC });
            ctx.text(c[0] + 18, 822, c[3], { size: 12.5, font: 'mono', color: 'text', parent: SC });
          });
          hide([PP, DP, S.P0.grp, S.P1.grp, S.D0.grp, S.D1.grp, S.D2.grp, S.router]);
          hide([l1, l1.labelEl, S.xfer, xl, xlead, S.ret, rl, TL, ttftB, SC, decLab]);
          hide(tld); hide(tlp); hide(tlpT); hide(tlx);
          /* beat 1: two pools */
          return Promise.all([
            ctx.reveal(S.router, { from: 'left' }),
            ctx.reveal([PP, DP], { from: 'up', delay: 250, stagger: 250 })
          ]).then(function () { return Promise.all([ctx.pulse(PP, { color: 'amber', dur: 600 }), ctx.pulse(DP, { color: 'cyan', dur: 600 })]); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: the prompt arrives at the prefill pool */
            return Promise.all([
              ctx.reveal([S.P0.grp, S.P1.grp], { from: 'left', stagger: 200 }),
              ctx.reveal(l1, { from: 'draw', delay: 500 }), ctx.reveal(l1.labelEl, { delay: 900 })
            ]).then(function () { return ctx.packet(l1, { color: 'amber', dur: 800, label: 'prompt' }); })
              .then(function () { return ctx.pulse(S.P0.grp, { color: 'amber', times: 2, dur: 600 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: KV blocks stream to the decode pool while later layers compute */
            ctx.hud('8k-prompt KV: 2.68 GB · streamed per layer');
            return Promise.all([
              ctx.reveal([S.D0.grp, S.D1.grp, S.D2.grp], { from: 'right', stagger: 150 }),
              ctx.reveal(S.xfer, { from: 'draw', delay: 500 }),
              ctx.reveal([xl, xlead], { delay: 800, stagger: 100 })
            ]).then(function () { return ctx.reveal(TL, { from: 'up' }); }).then(function () {
              ctx.camera(700, 470, 1.45, 800);
              var jobs = [];
              for (var k = 0; k < 5; k++) {
                (function (k) {
                  jobs.push(ctx.tween(420, function (t) { S.P0.pb.setAttribute('width', 340 * (k + t) / 5); }, 'linear', k * 440).then(function () {
                    ctx.reveal([tlp[k], tlpT[k]], { dur: 200 });
                    return ctx.packet(S.xfer, { color: 'red', dur: 480, label: 'L' + k * 16 + '–' + (k * 16 + 15) }).then(function () { ctx.reveal(tlx[k], { dur: 200 }); });
                  }));
                })(k);
              }
              return Promise.all(jobs);
            }).then(function () { return ctx.camera(800, 450, 1, 800); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: decode pool takes over and streams tokens back */
            ctx.animate(S.D1.kb, { width: [470 * 0.62, 470 * 0.64] }, 500);
            return Promise.all([
              ctx.reveal([decLab, ttftB], { stagger: 150 }),
              ctx.reveal(S.ret, { from: 'draw', delay: 300, dur: 900 }), ctx.reveal(rl, { delay: 900 }),
              ctx.reveal(tld, { dur: 200, stagger: 70, delay: 400 })
            ]).then(function () {
              S.retStream = ctx.stream(S.ret, { color: 'cyan', count: 3, period: 2200 });
              return ctx.pulse(S.D1.grp, { color: 'cyan', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: scale each pool independently */
            ctx.fade(TL, 0, 400); ctx.fade(ttftB, 0, 400);
            return ctx.wait(300).then(function () { return ctx.reveal(SC, { from: 'up' }); }).then(function () {
              return Promise.all([ctx.pulse(PP, { color: 'amber', dur: 700 }), ctx.pulse(DP, { color: 'cyan', dur: 700 })]);
            });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Numerics & kernels',
        beats: [
          {
            say: 'Three more levers work below the scheduler. First, number formats. BF16 keeps sixteen bits, FP8 halves them, and Blackwell\'s NVFP4 stores four bit values with a shared scale per sixteen elements, about four and a half bits in total.',
            card: { tag: 'NUMBERS', title: 'Bits per value', stat: { v: '4.5', u: 'bits', l: 'NVFP4: 4-bit E2M1 values plus one 8-bit scale per 16 elements, against 16 bits for BF16' } },
            deep: '<p><b>Formats</b>: BF16 is 1-8-7 (sign, exponent, mantissa). <b>FP8 E4M3</b> (max 448) uses per-tensor, per-channel or 128-block scales, and H100 tensor cores run it at twice the BF16 rate. <b>MXFP4</b> (OCP MX): E2M1 values with one E8M0 power-of-two scale per 32 elements, 4.25 bits. <b>NVFP4</b>: E2M1 values with one E4M3 scale per 16 elements plus an FP32 tensor scale, 4.5 bits, native on B200 and B300 tensor cores.</p>' +
              '<p><b>AWQ</b> (W4A16): INT4 weights in groups of 128; salient input channels are scaled by <code>s = mean|x|<sup>α</sup></code> before rounding, and weights are dequantised inside the kernel (Marlin).</p>'
          },
          {
            say: 'Fewer bits per value means fewer bytes streamed per token. A seventy billion parameter model shrinks from one hundred forty gigabytes to about thirty nine, and an FP8 KV cache doubles how many sequences fit in the pool.',
            card: { tag: 'NUMBERS', title: 'A 70B model shrinks 3.5 times', stat: { v: '140 → 39', u: 'GB', l: 'BF16 to NVFP4 weights; an FP8 KV cache doubles the sequences that fit' } },
            deep: '<table><tr><th>70B</th><th>BF16</th><th>FP8</th><th>NVFP4</th></tr>' +
              '<tr><td>weights</td><td>140 GB</td><td>70 GB</td><td>≈ 39 GB</td></tr>' +
              '<tr><td>KV / token</td><td>320 KiB</td><td>160 KiB</td><td>≈ 90 KiB</td></tr></table>' +
              '<p>Because decode is memory-bound, bytes are speed: at TP = 4 the weight-streaming floor per step falls from 10.4 ms (BF16, 35 GB per GPU) to 5.2 ms (FP8) and about 2.9 ms (NVFP4). FP8 KV doubles concurrent sequences (earlier steps) but needs per-tensor or per-head scales and a long-context accuracy check.</p>'
          },
          {
            say: 'The second lever is speculative decoding. A cheap draft head proposes several tokens ahead, here four, at a small fraction of the cost of the big model.',
            card: { tag: 'HOW IT WORKS', title: 'Guess cheaply, check in parallel', body: 'A tiny draft proposes four tokens. Checking all four costs one target pass, about the same as generating one, because decode is memory bound.' },
            deep: '<p><b>Speculative decoding</b> attacks the serial loop: a cheap <b>draft</b> proposes k tokens, the target checks them together. Drafts can be a small separate model (Leviathan et al.), extra heads on the target (Medusa), feature-level autoregressive heads that reuse the target\'s hidden states (EAGLE-1, 2, 3), or multi-token-prediction layers (DeepSeek-V3\'s MTP module).</p>' +
              '<p>EAGLE-3 drafts from a fusion of low, middle and high target-layer features and is trained on its own outputs. The draft costs about one transformer layer per proposed token, roughly 1–2 % of a 70B forward step.</p>'
          },
          {
            say: 'The big model then verifies all of them in a single pass. Accepted tokens are kept, the first wrong one is corrected, and the output distribution is exactly the target\'s. At eighty percent acceptance, one pass yields about three point four tokens.',
            card: { tag: 'NUMBERS', title: 'Lossless, 3.4 tokens per pass', stat: { v: '3.36', u: 'tokens / pass', l: 'expected at acceptance 0.8 and four drafted tokens, with the target\'s exact output distribution' },
              more: '<p>With independent acceptance probability α per draft token, P(first i tokens accepted) = α<sup>i</sup>. The target pass always contributes one more token (the correction or a bonus), so E[tokens] = 1 + Σ<sub>i=1…k</sub> α<sup>i</sup> = (1 − α<sup>k+1</sup>) / (1 − α). For α = 0.8 and k = 4: 1 + 0.8 + 0.64 + 0.512 + 0.410 = 3.36.</p>' },
            deep: '<p>The target scores k+1 positions in <b>one</b> pass. Accept draft token i with probability min(1, p<sub>i</sub> / q<sub>i</sub>); at the first rejection, resample from norm(max(0, p − q)) and stop. The output distribution is exactly the target\'s.</p>' +
              '<div class="eq">E[tokens / target pass] = (1 − α<sup>k+1</sup>) / (1 − α) = 3.36  (α = 0.8, k = 4)</div>' +
              '<p>At large batch the verify pass is no longer free (decode becomes compute-bound), so engines adapt k to load. EAGLE-3 reports up to 6.5× at batch 1 and ≈ 1.4× at batch 64 (SGLang).</p>'
          },
          {
            say: 'The third lever is CUDA graphs. A decode step launches roughly a thousand small kernels. Capturing them once and replaying with a single launch removes the CPU gaps between kernels, and lets the CPU plan the next step while the GPU runs this one.',
            card: { tag: 'HOW IT WORKS', title: 'One launch instead of a thousand', body: 'Capture the whole decode step once per batch size, replay it with a single launch, and let the CPU schedule the next step in the meantime.' },
            deep: '<p><b>CUDA graphs</b>: a decode step launches about 1,000 kernels (80 layers × roughly a dozen), each costing 4–6 µs of CPU launch time: several ms of CPU work on a ≈ 12 ms GPU step. Graphs are captured per batch-size bucket (1, 2, 4, 8 … 512, padding up) and replayed with one launch.</p>' +
              '<p>vLLM V1 uses piecewise graphs (attention runs outside the graph) plus full graphs for pure-decode batches. CPU-side scheduling for step <i>t+1</i> overlaps with the GPU executing step <i>t</i>, so the GPU never waits for Python.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          if (S.retStream) { S.retStream.stop(); S.retStream = null; }
          setStrip(S, [1, 2, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'BELOW THE SCHEDULER — NUMERICS & KERNELS', 'fewer bytes per token · more tokens per pass · fewer launches per step', 'red');
          var divs = ctx.group({ parent: G });
          ctx.line(565, 220, 565, 860, { color: 'line', sw: 1, parent: divs });
          ctx.line(1085, 220, 1085, 860, { color: 'line', sw: 1, parent: divs });
          var heads = ctx.group({ parent: G });
          ctx.text(60, 236, 'NUMBER FORMATS', { size: 14, font: 'display', weight: 700, color: 'white', parent: heads });
          ctx.text(590, 236, 'SPECULATIVE DECODING', { size: 14, font: 'display', weight: 700, color: 'white', parent: heads });
          ctx.text(1110, 236, 'CUDA GRAPHS', { size: 14, font: 'display', weight: 700, color: 'white', parent: heads });
          /* A1: number formats */
          var FC = { s: 'pink', e: 'amber', m: 'cyan', i: 'violet' };
          function bits(y, name, spec, note, extra) {
            var g = ctx.group({ parent: G });
            ctx.text(60, y, name, { size: 12.5, font: 'mono', weight: 700, color: 'white', parent: g });
            var x = 150;
            spec.forEach(function (sp) {
              for (var i = 0; i < sp[1]; i++) { ctx.rect(x, y - 11, 17, 22, { rx: 3, fill: ctx.alpha(FC[sp[0]], 0.45), stroke: FC[sp[0]], sw: 1, parent: g }); x += 19; }
            });
            if (extra) ctx.text(x + 8, y, extra, { size: 11.5, font: 'mono', color: 'text', parent: g });
            ctx.text(150, y + 22, note, { size: 11, font: 'mono', color: 'dim', parent: g });
            return g;
          }
          var fmtRows = [
            bits(276, 'BF16', [['s', 1], ['e', 8], ['m', 7]], 'FP32 range · 7 mantissa bits'),
            bits(332, 'FP8', [['s', 1], ['e', 4], ['m', 3]], 'E4M3 · max 448 · 2× BF16 tensor FLOP/s', '+ block scales'),
            bits(388, 'NVFP4', [['s', 1], ['e', 2], ['m', 1]], 'values ±{0,.5,1,1.5,2,3,4,6} · Blackwell', '× 16 + E4M3 scale'),
            bits(444, 'MXFP4', [['s', 1], ['e', 2], ['m', 1]], 'OCP MX · 4.25 bits / value', '× 32 + E8M0 scale'),
            bits(500, 'AWQ', [['i', 4]], 'W4A16 · group 128 · salient channels scaled', 'INT4 weight-only')
          ];
          var fLeg = ctx.group({ parent: G });
          [['sign', 'pink', 60], ['exponent', 'amber', 130], ['mantissa', 'cyan', 230], ['integer', 'violet', 330]].forEach(function (l) {
            ctx.rect(l[2], 534, 14, 12, { rx: 2, fill: ctx.alpha(l[1], 0.45), stroke: l[1], sw: 1, parent: fLeg });
            ctx.text(l[2] + 20, 540, l[0], { size: 11, font: 'mono', color: 'dim', parent: fLeg });
          });
          /* A2: memory saved */
          var A2 = ctx.group({ parent: G });
          ctx.text(60, 566, '70B WEIGHTS', { size: 12, font: 'mono', color: 'dim', parent: A2 });
          var wb = [['BF16', 140, 'text'], ['FP8', 70, 'amber'], ['NVFP4', 39.4, 'lime']];
          var wBars = [], wLab = [];
          wb.forEach(function (w, i) {
            var y = 582 + i * 28;
            ctx.text(60, y + 10, w[0], { size: 11.5, font: 'mono', color: 'dim', parent: A2 });
            wBars.push(ctx.rect(130, y, 340 * w[1] / 140, 20, { rx: 3, fill: ctx.alpha(w[2], 0.45), stroke: w[2], sw: 1, parent: A2 }));
            wLab.push(ctx.text(130 + 340 * w[1] / 140 + 8, y + 10, (w[1] === 39.4 ? '≈ 39' : w[1]) + ' GB', { size: 11.5, font: 'mono', color: w[2], parent: A2 }));
          });
          ctx.text(60, 684, 'KV CACHE PER TOKEN (all GPUs)', { size: 12, font: 'mono', color: 'dim', parent: A2 });
          var kBars = [], kLab = [];
          [['BF16', 320, 'text'], ['FP8', 160, 'amber']].forEach(function (w, i) {
            var y = 700 + i * 28;
            ctx.text(60, y + 10, w[0], { size: 11.5, font: 'mono', color: 'dim', parent: A2 });
            kBars.push(ctx.rect(130, y, 340 * w[1] / 320, 20, { rx: 3, fill: ctx.alpha(w[2], 0.45), stroke: w[2], sw: 1, parent: A2 }));
            kLab.push(ctx.text(130 + 340 * w[1] / 320 + 8, y + 10, w[1] + ' KiB', { size: 11.5, font: 'mono', color: w[2], parent: A2 }));
          });
          var fp8note = ctx.group({ parent: A2 });
          ctx.text(60, 784, 'FP8 KV → 2× concurrent sequences', { size: 12, font: 'mono', color: 'lime', parent: fp8note });
          ctx.text(60, 808, 'per-tensor / per-head scales · validate long context', { size: 11, font: 'mono', color: 'dim', parent: fp8note });
          /* B1: the draft */
          var B1 = ctx.group({ parent: G });
          ctx.text(590, 268, 'context: "…the fox astronaut"', { size: 12, font: 'mono', color: 'dim', parent: B1 });
          ctx.text(590, 312, 'draft', { size: 12, font: 'mono', color: 'violet', parent: B1 });
          var DR = [' climbs', ' out', ' of', ' the'];
          var dx = 650, drafts = [];
          DR.forEach(function (t) { var l = ctx.label(dx, 312, t, { color: 'violet', size: 12, anchor: 'start', parent: B1 }); drafts.push(l); dx += l.w + 8; });
          ctx.text(590, 338, 'EAGLE-3 head / MTP layer · ~1 layer, 4 cheap steps', { size: 11, font: 'mono', color: 'dim', parent: B1 });
          /* B2: the verification */
          var B2 = ctx.group({ parent: G });
          var ver = ctx.node({ x: 820, y: 390, w: 460, h: 50, title: 'target 70B · ONE forward over k + 1 = 5 positions', color: 'amber', titleSize: 13, parent: B2 });
          ctx.text(590, 446, 'verify', { size: 12, font: 'mono', color: 'amber', parent: B2 });
          var RS = [[' climbs', 'lime'], [' out', 'lime'], [' of', 'lime'], [' the', 'red'], [' its', 'amber']];
          var rx2 = 650, res = [];
          RS.forEach(function (t, i) {
            var l = ctx.label(rx2, 470, t[0], { color: t[1], size: 12, anchor: 'start', parent: B2 });
            if (i === 3) ctx.line(rx2 + 4, 470, rx2 + l.w - 4, 470, { color: 'red', sw: 1.6, parent: l });
            res.push(l); rx2 += l.w + 8;
          });
          var B3 = ctx.group({ parent: G });
          ctx.text(590, 504, 'accept 3 + 1 corrected = 4 tokens from 1 target pass', { size: 11.5, font: 'mono', color: 'lime', parent: B3 });
          ctx.text(590, 540, 'E[tok/pass] = (1 − α^(k+1)) / (1 − α) = 3.36', { size: 12.5, font: 'mono', color: 'white', parent: B3 });
          ctx.text(590, 562, 'α = 0.8, k = 4 · accept w.p. min(1, p/q) → lossless', { size: 11, font: 'mono', color: 'dim', parent: B3 });
          var B4 = ctx.group({ parent: G });
          var sp = ctx.plot(630, 610, 400, 140, function (b) { return 1 + 2.2 / (1 + b / 24); }, { xDomain: [1, 256], yDomain: [0.8, 3.4], color: 'violet', sw: 2.2, xLabel: 'batch size', yLabel: 'speedup', parent: B4 });
          var one = sp.toPx(1, 1);
          ctx.line(630, one.y, 1030, one.y, { color: 'dim', sw: 1, dash: '4 4', parent: B4 });
          ctx.text(622, one.y, '1×', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B4 });
          ctx.text(590, 792, 'shape only: once decode is compute-bound the verify', { size: 11, font: 'mono', color: 'dim', parent: B4 });
          ctx.text(590, 810, 'pass costs real FLOPs → shrink k or disable under load', { size: 11, font: 'mono', color: 'dim', parent: B4 });
          /* C: CUDA graphs */
          var C1 = ctx.group({ parent: G });
          ctx.text(1110, 272, 'eager: one launch per kernel', { size: 12, font: 'mono', color: 'dim', parent: C1 });
          ctx.text(1110, 302, 'CPU', { size: 11, font: 'mono', color: 'dim', parent: C1 });
          ctx.text(1110, 332, 'GPU', { size: 11, font: 'mono', color: 'dim', parent: C1 });
          var eK = [], gK = [];
          for (var i = 0; i < 17; i++) {
            ctx.rect(1150 + i * 22, 294, 5, 16, { rx: 1, fill: 'red', parent: C1 });
            eK.push(ctx.rect(1156 + i * 22, 324, 13, 16, { rx: 2, fill: ctx.alpha('amber', 0.6), stroke: 'amber', sw: 0.8, parent: C1 }));
          }
          var C2 = ctx.group({ parent: G });
          ctx.text(1110, 386, 'graph replay: one launch per step', { size: 12, font: 'mono', color: 'dim', parent: C2 });
          ctx.text(1110, 416, 'CPU', { size: 11, font: 'mono', color: 'dim', parent: C2 });
          ctx.text(1110, 446, 'GPU', { size: 11, font: 'mono', color: 'dim', parent: C2 });
          ctx.rect(1150, 408, 5, 16, { rx: 1, fill: 'red', parent: C2 });
          for (var j = 0; j < 17; j++) gK.push(ctx.rect(1158 + j * 14, 438, 13, 16, { rx: 2, fill: ctx.alpha('amber', 0.6), stroke: 'amber', sw: 0.8, parent: C2 }));
          var gap = bracket(ctx, C2, 1397, 1531, 466, 'idle gaps removed', 'lime', false);
          var C3 = ctx.para(1110, 520, [
            '~1,000 kernels per decode step',
            '× ~4–6 µs launch ≈ several ms of CPU',
            'on a ~12 ms GPU step',
            'capture per batch bucket: 1, 2, 4, 8, … 512',
            'pad the batch up to the next bucket',
            'vLLM V1: piecewise + full graphs',
            'CPU schedules step t+1 while',
            'the GPU runs step t'
          ], { size: 12, font: 'mono', color: 'text', parent: G, lh: 22 });
          hide(fmtRows); hide([fLeg, A2, B1, B2, B3, B4, C1, C2, C3, divs, heads]); hide(drafts); hide(res); hide(eK); hide(gK); hide(gap);
          hide(wBars.concat(wLab, kBars, kLab)); hide(fp8note);
          var wTarget = wBars.map(function (b) { return parseFloat(b.getAttribute('width')); });
          var kTarget = kBars.map(function (b) { return parseFloat(b.getAttribute('width')); });
          wBars.forEach(function (b) { b.setAttribute('width', 0); }); kBars.forEach(function (b) { b.setAttribute('width', 0); });
          /* beat 1: number formats */
          return Promise.all([
            ctx.reveal([divs, heads], { delay: 100, stagger: 200 }),
            ctx.reveal(fmtRows, { from: 'left', delay: 500, stagger: 250 }),
            ctx.reveal(fLeg, { delay: 1800 })
          ]).then(function () { return ctx.pulse(fmtRows[2], { color: 'lime', dur: 700 }); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: fewer bytes per token */
            ctx.reveal(A2, {});
            var all = wBars.concat(kBars), tg = wTarget.concat(kTarget), lab = wLab.concat(kLab);
            return all.reduce(function (p, b, i) {
              return p.then(function () {
                ctx.reveal(b, { dur: 100 });
                return ctx.animate(b, { width: [0, tg[i]] }, 600, 'out').then(function () { ctx.reveal(lab[i], { dur: 250 }); });
              });
            }, ctx.wait(300)).then(function () { return ctx.reveal(fp8note, { from: 'up' }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the draft proposes */
            return ctx.reveal(B1, { from: 'up' }).then(function () { return ctx.reveal(drafts, { from: 'left', stagger: 180, dur: 300 }); })
              .then(function () { return ctx.pulse(drafts[0], { color: 'violet', dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: one target pass verifies them all */
            return ctx.reveal(B2, { from: 'up' }).then(function () { return ctx.pulse(ver, { color: 'amber', dur: 600 }); })
              .then(function () { return ctx.reveal(res, { from: 'up', stagger: 200, dur: 300 }); })
              .then(function () { return ctx.reveal(B3, { from: 'up' }); })
              .then(function () { return ctx.reveal(B4, { from: 'up' }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: CUDA graphs */
            ctx.hud('FP8 KV 2× batch · 3.4 tok/pass · 1 launch');
            return ctx.reveal(C1, { from: 'up' }).then(function () { return ctx.reveal(eK, { stagger: 110, dur: 120 }); })
              .then(function () { return ctx.reveal(C2, { from: 'up' }); })
              .then(function () { return ctx.reveal(gK, { stagger: 40, dur: 120 }); })
              .then(function () { return ctx.reveal(gap, { dur: 300 }); })
              .then(function () { return ctx.reveal(C3, { from: 'up' }); });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Goodput & SLOs',
        beats: [
          {
            say: 'So how do we judge an engine? Not by raw throughput. Push more offered load and throughput keeps rising until the hardware saturates, and it looks healthy the whole way.',
            card: { tag: 'KEY IDEA', title: 'Throughput hides broken promises', body: 'Tokens per second counts a reply that arrived ten seconds late exactly like one that arrived instantly.' },
            deep: '<p>Throughput is monotone in offered load λ until saturation: it rises linearly while the engine keeps up, then flattens at capacity. It says nothing about <i>when</i> tokens arrive. An agent that needs its plan within a second gets no value from a thousand tokens per second delivered after ten.</p>' +
              '<p>Service-level objectives make the requirement explicit. For interactive agents a typical pair is p90 TTFT ≤ 1 s and p90 TPOT ≤ 50 ms.</p>'
          },
          {
            say: 'But queues grow, time to first token explodes, and requests start missing their deadlines. Goodput counts only the requests that meet both latency targets, and it peaks well before saturation.',
            card: { tag: 'HOW IT WORKS', title: 'Goodput has a peak', body: 'Below the knee almost every request meets its objectives. Above it, queues grow without bound and goodput collapses while throughput still looks fine.' },
            deep: '<div class="eq">goodput(λ) = λ · P( TTFT ≤ T<sub>1</sub>  ∧  TPOT ≤ T<sub>2</sub> | λ )</div>' +
              '<p>Past the knee the queue grows without bound (an M/G/1-like system with utilisation ρ → 1): TTFT tails blow up, every request misses, and goodput collapses even as throughput stays at capacity. Capacity planning therefore targets the <b>goodput peak</b>, not the saturation point.</p>' +
              '<details><summary>Go deeper</summary><p>For an M/M/1 queue with service rate μ, the time in system is exponential with rate μ − λ, so P(T &gt; t) = e<sup>−(μ−λ)t</sup>. A p90 objective T needs (μ − λ)·T ≥ ln 10, i.e. <code>λ ≤ μ − 2.3 / T</code>. With μ = 20 req/s and T = 1 s the objective-feasible load is 17.7 req/s (88 % of capacity); with T = 200 ms it is only 8.5 req/s (43 %). Tight latency targets move the goodput peak far below saturation.</p></details>'
          },
          {
            say: 'Every mechanism in this chamber, from paging and prefix caching to chunking, disaggregation and quantization, moves that peak up and to the right. Each one fixes a different failure. Click the plot to move the load cursor yourself.',
            card: { tag: 'TRY IT', title: 'Slide the load cursor', body: 'Click anywhere on the plot to set the offered load and read throughput and goodput for both stacks. Watch goodput collapse while throughput stays high.' },
            deep: '<p>The green curves are not a different engine but the same one with this chamber\'s levers switched on: continuous batching and paging lift capacity, prefix caching and chunked prefill cut TTFT and ITL tails, disaggregation removes phase interference, and quantization and speculation shrink the per-token cost.</p>' +
              '<p><span class="muted">The plotted curves are schematic (normalised to the baseline\'s capacity).</span></p>'
          },
          {
            say: 'The reported gains come from different papers on different setups, so they do not multiply. They are ingredients, and the scheduler and router decide when each one is worth using.',
            card: { tag: 'PITFALL', title: 'Reported gains do not multiply', body: 'Each number is measured against its own baseline and workload. Combined gains are smaller and depend on traffic shape. Benchmark your own.' },
            deep: '<ul><li><b>Orca</b>: 36.9× over FasterTransformer on GPT-3 175B at equal latency.</li>' +
              '<li><b>vLLM</b>: 2–4× throughput over Orca-style allocators.</li>' +
              '<li><b>SGLang</b>: up to 6.4× on agentic and few-shot traffic.</li>' +
              '<li><b>Sarathi-Serve</b>: 2.6× (Mistral-7B) to 5.6× (Falcon-180B) capacity.</li>' +
              '<li><b>DistServe</b>: 7.4× more requests at the same objectives.</li>' +
              '<li><b>EAGLE-3</b>: up to 6.5× at batch 1, about 1.4× at batch 64.</li></ul>' +
              '<p>Autoscaling and admission control key on queue depth, KV-pool utilisation and SLO attainment, not GPU utilisation: a memory-bound decode reads "100 % busy" at low FLOP utilisation.</p>'
          },
          {
            say: 'For our trailer, that is what keeps the agent crew responsive. Every call re-sends the same eight thousand token prefix, so prefix aware routing and radix caching prefill only the new tokens, and the real GPU budget goes to video diffusion.',
            card: { tag: 'WHY IT MATTERS', title: 'Agents iterate at conversational speed', body: 'A dozen agents can loop with sub-second TTFT, leaving the cluster\'s real budget, minutes of GPU time per shot, for video.' },
            deep: '<div class="note">For the trailer: every agent call re-sends the same ≈ 8.2k-token system + tools + bible prefix. Prefix-aware routing to a warm replica plus radix caching means only the few hundred new tokens per call are prefilled, so a dozen agents can iterate with sub-second TTFT while the GPU cluster\'s real budget goes to video diffusion.</div>' +
              '<p>Interactive agents want p90 TTFT ≤ 1 s and p90 TPOT ≤ 50 ms; the LLM pool is sized for the goodput peak of that pair, and the video pool is sized separately for throughput.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          setStrip(S, [0, 1, 2, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'GOODPUT — THE METRIC THAT MATTERS', 'requests per second that meet TTFT and TPOT SLOs', 'red');
          function sig(z) { return 1 / (1 + Math.exp(-z)); }
          function smin(x, c) { return x / Math.pow(1 + Math.pow(x / c, 8), 1 / 8); }
          var t1 = function (x) { return smin(x, 1); }, g1 = function (x) { return smin(x, 1) * sig((0.85 - x) / 0.06); };
          var t2 = function (x) { return smin(x, 2.4); }, g2 = function (x) { return smin(x, 2.4) * sig((2.1 - x) / 0.1); };
          var PX = 140, PY = 250, PW = 620, PH = 430;
          var o = { xDomain: [0, 3], yDomain: [0, 2.6], sw: 2.4, samples: 160, parent: G };
          var base = ctx.plot(PX, PY, PW, PH, t1, Object.assign({}, o, { color: ctx.alpha('red', 0.55), yLabel: 'req/s (normalised)' }));
          var xl = ctx.text(PX + PW, PY + PH + 38, 'offered load (× baseline capacity)', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          base.curve.setAttribute('stroke-dasharray', '6 5');
          var cg1 = ctx.plot(PX, PY, PW, PH, g1, Object.assign({}, o, { color: 'red', axes: false }));
          var ct2 = ctx.plot(PX, PY, PW, PH, t2, Object.assign({}, o, { color: ctx.alpha('lime', 0.55), axes: false }));
          ct2.curve.setAttribute('stroke-dasharray', '6 5');
          var cg2 = ctx.plot(PX, PY, PW, PH, g2, Object.assign({}, o, { color: 'lime', axes: false }));
          var ticks = ctx.group({ parent: G });
          [0, 1, 2, 3].forEach(function (v) { ctx.text(base.toPx(v, 0).x, PY + PH + 16, v + '×', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: ticks }); });
          var lgRows = [];
          [['throughput · baseline', 'red', true], ['goodput · baseline', 'red', false], ['throughput · full stack', 'lime', true], ['goodput · full stack', 'lime', false]].forEach(function (l, i) {
            var y = 262 + i * 22;
            var g = ctx.group({ parent: G });
            ctx.line(180, y, 212, y, { color: l[1], sw: 2.4, dash: l[2] ? '6 5' : null, parent: g });
            ctx.text(220, y, l[0], { size: 11.5, font: 'mono', color: 'text', parent: g });
            lgRows.push(g);
          });
          /* peaks */
          function peak(fn) { var bx0 = 0, by = 0; for (var x = 0; x <= 3; x += 0.01) { var y = fn(x); if (y > by) { by = y; bx0 = x; } } return [bx0, by]; }
          var pk1 = peak(g1), pk2 = peak(g2);
          var m1 = ctx.group({ parent: G }), m2 = ctx.group({ parent: G });
          var pt1 = base.toPx(pk1[0], pk1[1]), pt2 = base.toPx(pk2[0], pk2[1]);
          ctx.circle(pt1.x, pt1.y, 6, { fill: 'red', parent: m1, glow: true });
          ctx.text(pt1.x - 12, pt1.y - 14, 'goodput peak ' + pk1[1].toFixed(2), { size: 11.5, font: 'mono', color: 'red', anchor: 'end', parent: m1 });
          var fail = base.toPx(1.3, 0.25);
          ctx.text(fail.x, fail.y, 'queues explode → SLOs missed', { size: 11.5, font: 'mono', color: 'red', parent: m1 });
          ctx.circle(pt2.x, pt2.y, 6, { fill: 'lime', parent: m2, glow: true });
          ctx.text(pt2.x - 12, pt2.y - 14, 'goodput peak ' + pk2[1].toFixed(2), { size: 11.5, font: 'mono', color: 'lime', anchor: 'end', parent: m2 });
          S.gcur = ctx.line(PX, PY, PX, PY + PH, { color: ctx.alpha('white', 0.5), sw: 1, dash: '2 3', parent: G });
          S.gread = ctx.text(PX, 764, '', { size: 12.5, font: 'mono', color: 'white', parent: G });
          /* right: SLO definition (beats 1-3), lever table (beat 4), the trailer (beat 5) */
          var SL = ctx.group({ parent: G });
          ctx.rect(838, 250, 702, 250, { rx: 12, fill: ctx.alpha('cyan', 0.04), stroke: ctx.alpha('cyan', 0.5), sw: 1.2, parent: SL });
          ctx.text(858, 278, 'WHAT COUNTS AS GOOD', { size: 13, font: 'display', weight: 700, color: 'cyan', parent: SL });
          ctx.text(858, 312, 'TTFT  p90 ≤ 1 s      ·      TPOT  p90 ≤ 50 ms      (interactive agents)', { size: 12.5, font: 'mono', color: 'white', parent: SL });
          ctx.text(858, 340, 'throughput counts every finished request, however late', { size: 12, font: 'mono', color: 'dim', parent: SL });
          var SLF = ctx.group({ parent: SL });
          ctx.text(858, 392, 'goodput(λ) = λ · P( TTFT ≤ T₁  ∧  TPOT ≤ T₂ | λ )', { size: 14, font: 'mono', weight: 700, color: 'lime', parent: SLF });
          ctx.text(858, 422, 'a request counts only if it meets both objectives', { size: 12, font: 'mono', color: 'text', parent: SLF });
          ctx.text(858, 450, 'past the knee queues grow without bound: every request misses', { size: 12, font: 'mono', color: 'text', parent: SLF });
          var TB = ctx.group({ parent: G });
          var cols = [850, 1050, 1300];
          var rowsEls = [];
          [['lever', 'fixes', 'reported gain']].concat([
            ['continuous batching', 'idle slots, HoL waits', 'Orca: 36.9× vs FT'],
            ['PagedAttention', 'KV fragmentation', 'vLLM: 2–4× thpt'],
            ['prefix / radix cache', 'recomputed prompts', 'SGLang: up to 6.4×'],
            ['chunked prefill', 'decode stalls', 'Sarathi: 2.6–5.6× cap.'],
            ['P/D disaggregation', 'phase interference', 'DistServe: 7.4× rate'],
            ['FP8 · FP4 · FP8 KV', 'bytes per token', '~2× weight & KV room'],
            ['speculative decoding', 'serial token loop', 'EAGLE-3: ≤ 6.5× @ B=1'],
            ['CUDA graphs', 'CPU launch overhead', 'ms per step back']
          ]).forEach(function (r, i) {
            var y = 250 + i * 50;
            var rg = ctx.group({ parent: TB });
            if (i > 0) ctx.rect(838, y - 20, 702, 40, { rx: 6, fill: 'rgba(255,255,255,0.025)', stroke: ctx.alpha('line', 1), sw: 1, parent: rg });
            r.forEach(function (c, k) {
              ctx.text(cols[k], y, c, { size: i ? 12.5 : 11.5, font: 'mono', weight: i && k === 0 ? 700 : 400, color: i ? (k === 2 ? 'lime' : (k === 0 ? 'white' : 'text')) : 'dim', parent: rg });
            });
            rowsEls.push(rg);
          });
          var ex = ctx.group({ parent: G });
          ctx.rect(838, 706, 702, 130, { rx: 10, fill: ctx.alpha('magenta', 0.05), stroke: ctx.alpha('magenta', 0.6), sw: 1.2, parent: ex });
          ctx.text(858, 730, 'OUR TRAILER\'S AGENT CREW', { size: 12.5, font: 'display', weight: 700, color: 'magenta', parent: ex });
          ctx.para(858, 756, [
            'every call re-sends the same ≈ 8.2k-token system + tools + bible',
            'prefix → prefix-aware routing + radix cache prefill only the new',
            'few hundred tokens: sub-second TTFT for a dozen iterating agents,',
            'leaving the cluster\'s real GPU budget to video diffusion'
          ], { size: 12, font: 'mono', color: 'text', parent: ex, lh: 20 });
          function setL(x) {
            var p = base.toPx(x, 0).x;
            S.gcur.setAttribute('x1', p); S.gcur.setAttribute('x2', p);
            S.gread.textContent = 'load ' + x.toFixed(2) + '× │ base: thpt ' + t1(x).toFixed(2) + ' good ' + g1(x).toFixed(2) + ' │ full: thpt ' + t2(x).toFixed(2) + ' good ' + g2(x).toFixed(2);
          }
          setL(0);
          /* interactive: click the plot to place the load cursor (enabled from beat 3) */
          var hit = ctx.rect(PX, PY, PW, PH, { rx: 0, fill: 'rgba(255,255,255,0.001)', parent: G });
          hit.style.cursor = 'crosshair';
          hit.addEventListener('click', function (ev) {
            if (!S.tryOn) return;
            var r = hit.getBoundingClientRect();
            setL(ctx.clamp((ev.clientX - r.left) / r.width * 3, 0, 3));
          });
          hide([base, xl, ticks, base.curve, cg1.curve, ct2.curve, cg2.curve, m1, m2, S.gcur, S.gread, SL, SLF, ex]); hide(lgRows); hide(rowsEls);
          /* beat 1: throughput keeps rising */
          return Promise.all([
            ctx.reveal([base, xl, ticks], { delay: 100, stagger: 100 }),
            ctx.reveal(lgRows[0], { delay: 500 }),
            ctx.reveal(SL, { from: 'right', delay: 700 })
          ]).then(function () { return ctx.reveal(base.curve, { from: 'draw', dur: 1400 }); })
            .then(function () { return ctx.pulse(lgRows[0], { color: 'red', dur: 600 }); })
            .then(function () { return ctx.beat(1); }).then(function () {
            /* beat 2: goodput collapses past the knee */
            ctx.reveal(lgRows[1], { delay: 200 });
            ctx.reveal(SLF, { from: 'up', delay: 600 });
            ctx.reveal([S.gcur, S.gread], { delay: 300 });
            return ctx.reveal(cg1.curve, { from: 'draw', dur: 1200 }).then(function () { return ctx.reveal(m1, { from: 'up' }); })
              .then(function () { return ctx.tween(4000, function (t) { setL(3 * t); }, 'inOut'); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 3: the full stack moves the peak up and right; the plot becomes clickable */
            S.tryOn = true;
            ctx.hud('size for the goodput peak');
            ctx.reveal([lgRows[2], lgRows[3]], { delay: 200, stagger: 250 });
            return Promise.all([ctx.reveal(ct2.curve, { from: 'draw', dur: 1200 }), ctx.reveal(cg2.curve, { from: 'draw', dur: 1200, delay: 300 })]).then(function () {
              ctx.reveal(m2, { from: 'up' });
              return ctx.tween(1600, function (t) { setL(3 - (3 - pk2[0]) * t); }, 'out');
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 4: the levers and their reported gains */
            ctx.fade(SL, 0, 400);
            return ctx.wait(300).then(function () { return ctx.reveal(rowsEls, { from: 'right', stagger: 170 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 5: the agent crew */
            return ctx.reveal(ex, { from: 'up' }).then(function () { return ctx.pulse(ex, { color: 'magenta', dur: 700 }); });
          });
        }
      }
    ]
  });
})();
