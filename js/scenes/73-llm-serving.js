/* L2 — LLM Serving Engine. How an inference engine turns a GPU into tokens per second per dollar:
 * the engine loop, roofline, continuous batching, PagedAttention, prefix caching, chunked prefill,
 * prefill/decode disaggregation, numerics & kernels, and goodput. Leaf chamber (no children). */
(function () {
  function bx(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }

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

  /* mini engine-loop strip in the free top band: highlights the stage the step is about */
  function buildStrip(ctx, S) {
    if (S.strip) return;
    var G = S.strip = ctx.group();
    ctx.text(846, 108, 'ENGINE', { size: 11, font: 'mono', color: 'dim', parent: G });
    var items = [['SCHEDULER', 'red', 970], ['MODEL FORWARD', 'amber', 1100], ['SAMPLER', 'amber', 1222], ['KV CACHE', 'red', 1352]];
    S.stripChips = items.map(function (it) { return ctx.label(it[2], 108, it[0], { color: it[1], size: 11, parent: G }); });
    ctx.line(1014, 108, 1042, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G });
    ctx.line(1158, 108, 1184, 108, { color: 'dim', sw: 1.2, arrow: true, parent: G });
    ctx.path('M1222,122 Q1096,150 970,122', { stroke: 'dim', sw: 1.2, arrow: true, parent: G, dash: '3 4' });
    ctx.line(1156, 116, 1314, 116, { color: ctx.alpha('red', 0.5), sw: 1, dash: '2 4', parent: G });
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
      'Kwon et al., <i>Efficient Memory Management for Large Language Model Serving with PagedAttention</i> (vLLM), SOSP 2023',
      'Zheng et al., <i>SGLang: Efficient Execution of Structured Language Model Programs</i> (RadixAttention), NeurIPS 2024',
      'Agrawal et al., <i>Taming Throughput-Latency Tradeoff in LLM Inference with Sarathi-Serve</i>, OSDI 2024',
      'Zhong et al., <i>DistServe: Disaggregating Prefill and Decoding for Goodput-optimized LLM Serving</i>, OSDI 2024; Patel et al., <i>Splitwise</i>, ISCA 2024',
      'Qin et al., <i>Mooncake: A KVCache-centric Disaggregated Architecture for LLM Serving</i>, FAST 2025; NVIDIA <i>Dynamo</i> + NIXL, 2025; DeepSeek-AI, <i>DeepSeek-V3 Technical Report</i> (inference deployment), 2024',
      'Lin et al., <i>AWQ: Activation-aware Weight Quantization</i>, MLSys 2024; OCP <i>Microscaling (MX) Formats Spec v1.0</i>, 2023; NVIDIA NVFP4 (Blackwell), 2025',
      'Leviathan et al., <i>Fast Inference from Transformers via Speculative Decoding</i>, ICML 2023; Li et al., <i>EAGLE-3</i>, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'The engine loop',
        say: 'When the director agent asks the planner model for a shot list, the request lands on an LLM serving engine. The engine is a tight loop. A scheduler decides which sequences run in this iteration and where their memory lives. One forward pass processes every scheduled sequence together. A sampler turns the logits into exactly one new token per sequence, and the loop repeats every ten to forty milliseconds. Two numbers define the experience: time to first token, and time per output token.',
        deep: '<p>vLLM V1, SGLang and TensorRT-LLM all run a <b>busy loop</b> in an engine-core process; API servers tokenize and detokenize in separate processes so Python overhead never starves the GPU.</p>' +
          '<pre>while True:\n  batch  = sched.schedule()  # seqs, KV blocks\n  logits = model(batch)      # 1 GPU step\n  toks   = sample(logits)    # top-p, grammar\n  sched.update(toks)         # EOS → free KV\n  stream(toks)               # SSE → agents</pre>' +
          '<table><tr><th>metric</th><th>definition</th></tr>' +
          '<tr><td>TTFT</td><td>queueing + prefill + first sample</td></tr>' +
          '<tr><td>TPOT / ITL</td><td>mean / per-gap time between output tokens</td></tr>' +
          '<tr><td>E2E latency</td><td>TTFT + (n−1)·TPOT</td></tr>' +
          '<tr><td>throughput</td><td>output tokens/s per GPU (or per $)</td></tr>' +
          '<tr><td>goodput</td><td>requests/s that meet <i>both</i> SLOs</td></tr></table>' +
          '<p><span class="muted">Running configuration in this chamber: a 70B-class dense planner (Llama-3.1-70B shape: 80 layers, 64 query / 8 KV heads, d<sub>h</sub> = 128), FP8 weights, tensor-parallel over 4 H100 SXM GPUs.</span></p>',
        run: function (ctx) {
          var S = ctx.state;
          var G = S.g1 = ctx.group();
          heading(ctx, G, 60, 182, 'THE ENGINE LOOP', 'schedule → forward → sample: one new token per sequence per iteration', 'red');
          /* agents */
          var ag = [['Director · plan()', 290], ['Writer · draft()', 360], ['Critic · review()', 430], ['Camera · prompt()', 500]];
          var chips = ag.map(function (a) { return ctx.label(120, a[1], a[0], { color: 'magenta', size: 12, parent: G }); });
          S.api = ctx.node({ x: 330, y: 395, w: 170, h: 66, title: 'API server', sub: 'tokenize · admit', icon: 'server', color: 'blue', titleSize: 15, subSize: 11, parent: G });
          var al = ag.map(function (a) { return ctx.link({ x: 194, y: a[1] }, S.api, { to: 'l', color: ctx.alpha('magenta', 0.55), sw: 1.3, parent: G }); });
          /* waiting queue */
          S.queue = ctx.node({ x: 505, y: 395, w: 100, h: 150, kind: 'box', color: 'red', parent: G });
          ctx.text(505, 340, 'WAITING', { size: 11, font: 'mono', color: 'red', anchor: 'middle', parent: G });
          for (var q = 0; q < 5; q++) ctx.rect(470, 358 + q * 18, 70, 13, { rx: 3, fill: ctx.alpha(['magenta', 'magenta', 'cyan', 'magenta', 'violet'][q], 0.35), stroke: ctx.alpha('white', 0.25), sw: 0.8, parent: G });
          /* ring */
          S.sched = ctx.node({ x: 690, y: 300, w: 200, h: 72, title: 'Scheduler', sub: 'admit · KV · preempt', icon: 'queue', color: 'red', titleSize: 15, subSize: 11, parent: G });
          S.fwd = ctx.node({ x: 1110, y: 300, w: 230, h: 80, title: 'Model forward', sub: '70B · FP8 · TP=4 · H100', icon: 'gpu', color: 'amber', titleSize: 15, subSize: 11, parent: G });
          S.samp = ctx.node({ x: 900, y: 560, w: 200, h: 72, title: 'Sampler', sub: 'logits → 1 token / seq', icon: 'spark', color: 'amber', titleSize: 15, subSize: 11, parent: G });
          S.kv = ctx.node({ x: 1410, y: 300, w: 190, h: 90, kind: 'cyl', title: 'KV cache', sub: 'HBM · paged blocks', color: 'red', titleSize: 15, subSize: 11, parent: G });
          S.out = ctx.node({ x: 1310, y: 560, w: 220, h: 66, title: 'Detokenize · stream', sub: 'SSE → agents', icon: 'net', color: 'cyan', titleSize: 14, subSize: 11, parent: G });
          var nodes = [S.api, S.queue, S.sched, S.fwd, S.samp, S.kv, S.out];
          var lq1 = ctx.link(S.api, S.queue, { color: 'blue', parent: G });
          var lq2 = ctx.link(S.queue, S.sched, { from: 'r', to: 'l', color: 'red', parent: G });
          S.r1 = ctx.link(S.sched, S.fwd, { from: 'r', to: 'l', color: 'red', straight: true, label: 'seqs + block tables', labelDy: -16, parent: G });
          S.r2 = ctx.link(S.fwd, S.samp, { from: 'b', to: 'r', color: 'amber', label: 'logits [B, 128k]', labelDx: 40, parent: G });
          S.r3 = ctx.link(S.samp, S.sched, { from: 'l', to: 'b', color: 'amber', label: '+1 token · free on EOS', labelDx: -28, parent: G });
          S.r4 = ctx.link(S.samp, S.out, { from: 'r', to: 'l', color: 'cyan', label: 'token ids', parent: G });
          var lkv = ctx.link(S.fwd, S.kv, { from: 'r', to: 'l', color: 'red', dash: '5 5', arrow: false, label: 'read W + KV, append KV', labelDy: 60, parent: G });
          S.iterT = ctx.text(900, 410, 'iteration 1,204', { size: 22, font: 'display', weight: 700, color: 'white', anchor: 'middle', parent: G });
          ctx.text(900, 440, 'batch = 37 sequences → +37 tokens', { size: 12.5, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          /* output tokens */
          ctx.text(1200, 612, 'to Director:', { size: 11, font: 'mono', color: 'dim', parent: G });
          var TOK = ['"Shot', ' 1:', ' wide', ' crash', ' site'];
          var tx = 1200, toks = [];
          TOK.forEach(function (t) {
            var l = ctx.label(tx, 640, t, { color: 'cyan', size: 12, anchor: 'start', parent: G });
            tx += l.w + 5; toks.push(l);
          });
          toks.forEach(function (l) { l.setAttribute('opacity', 0); });
          /* single request timeline */
          var TL = ctx.group({ parent: G });
          ctx.text(60, 708, 'ONE REQUEST ON THE CLOCK', { size: 12, font: 'mono', color: 'dim', parent: TL });
          var qr = ctx.rect(160, 757, 70, 26, { rx: 4, fill: ctx.alpha('dim', 0.25), stroke: 'dim', sw: 1, parent: TL });
          ctx.text(195, 770, 'queue', { size: 11, font: 'mono', color: 'text', anchor: 'middle', parent: TL });
          var pr = ctx.rect(232, 757, 220, 26, { rx: 4, fill: ctx.alpha('amber', 0.4), stroke: 'amber', sw: 1, parent: TL });
          ctx.text(342, 770, 'prefill · 6k prompt tok', { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: TL });
          var ticks = [];
          for (var i = 0; i < 22; i++) ticks.push(ctx.rect(460 + i * 44, 759, 30, 22, { rx: 3, fill: ctx.alpha('cyan', 0.35), stroke: 'cyan', sw: 1, parent: TL }));
          var bT = bracket(ctx, TL, 160, 490, 740, 'TTFT = queue + prefill + first token', 'amber', true);
          var bP = bracket(ctx, TL, 680, 724, 797, 'TPOT / ITL', 'cyan', false);
          var bE = bracket(ctx, TL, 160, 1414, 836, 'E2E = TTFT + (n − 1) · TPOT', 'text', false);
          [qr, pr, bT, bP, bE].concat(ticks).forEach(function (e) { e.setAttribute('opacity', 0); });

          ctx.reveal(chips, { from: 'left', stagger: 90 });
          ctx.reveal(nodes, { from: 'scale', delay: 250, stagger: 110 });
          ctx.reveal([lq1, lq2, S.r1, S.r2, S.r3, S.r4, lkv].concat(al), { from: 'draw', delay: 900, stagger: 70 });
          ctx.reveal([S.r1.labelEl, S.r2.labelEl, S.r3.labelEl, S.r4.labelEl, lkv.labelEl], { delay: 1400, stagger: 80 });
          ctx.hud('70B planner · FP8 · TP=4 · one iteration ≈ 10–40 ms');
          ctx.reveal([qr, pr], { delay: 1500, stagger: 250 });
          var chain = ctx.wait(1900);
          [0, 1, 2, 3, 4].forEach(function (k) {
            chain = chain.then(function () {
              return Promise.all([
                ctx.packet(S.r1, { color: 'red', dur: 380 }).then(function () { return ctx.packet(S.r2, { color: 'amber', dur: 380 }); })
                  .then(function () { return Promise.all([ctx.packet(S.r3, { color: 'amber', dur: 380 }), ctx.packet(S.r4, { color: 'cyan', dur: 380 })]); })
              ]).then(function () {
                S.iterT.textContent = 'iteration ' + (1205 + k).toLocaleString('en-US');
                ctx.reveal(toks[k], { from: 'left', dur: 250 });
                ctx.reveal(ticks.slice(k * 4, k * 4 + 4), { dur: 200, stagger: 40 });
                if (k === 0) ctx.reveal(bT, { dur: 300 });
              });
            });
          });
          return chain.then(function () {
            ctx.reveal(ticks.slice(20), { dur: 200, stagger: 60 });
            return ctx.reveal([bP, bE], { dur: 400, stagger: 200 });
          }).then(function () {
            S.st1 = [ctx.stream(S.r1, { color: 'red', count: 2, period: 1500 }), ctx.stream(S.r2, { color: 'amber', count: 2, period: 1500 }), ctx.stream(S.r3, { color: 'amber', count: 2, period: 1500 })];
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Roofline & batching',
        say: 'Why batch at all? Look at the roofline. Each decode step must stream all seventeen and a half gigabytes of weight shards from memory, just to produce one token per sequence. With a batch of one, the tensor cores sit almost idle: decode is memory bound. Every extra sequence in the batch reuses the same weight read, so throughput climbs almost linearly while latency barely moves. But each sequence also streams its own KV cache, and memory capacity, not compute, finally caps the batch.',
        deep: '<p>Arithmetic intensity I = FLOPs / bytes moved. A kernel is memory-bound when I is below the ridge point peak/BW.</p>' +
          '<div class="eq">H100 SXM: 1,979 TFLOP/s FP8 (dense) ÷ 3.35 TB/s ≈ 590 FLOP/B</div>' +
          '<p><b>Decode GEMMs</b>: each FP8 weight byte feeds 2 FLOPs per token, so I ≈ 2B for batch B. Even B = 256 (I ≈ 512) sits just below the ridge.</p>' +
          '<p><b>Decode attention</b> reads each KV element once per step and shares it across the g = 8 query heads of its GQA group: I ≈ g, independent of B. Batching never fixes it; only smaller KV (FP8/FP4 KV, MLA, sliding windows) does.</p>' +
          '<div class="eq">t<sub>step</sub> ≈ (W/TP + B·L·kv)/BW ≈ 5.2 ms + B × 0.10 ms</div>' +
          '<p>W/TP = 17.5 GB per GPU; kv = 80 KiB/token/GPU (BF16 KV, 2 KV heads per GPU); L = 4k tokens. Throughput B/t<sub>step</sub>: 190 tok/s at B = 1, ≈5.5k at B = 64, ≈7.4k at B = 150.</p>' +
          '<p><b>Capacity wall</b>: ~50 GB of KV pool per GPU ÷ 80 KiB ≈ 610k tokens ≈ 150 concurrent 4k contexts. FP8 KV doubles that. Hence the next three mechanisms: keep every batch slot busy (continuous batching), pack KV densely (paging) and never store or compute the same KV twice (prefix caching).</p>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.st1) { S.st1.forEach(function (h) { h.stop(); }); S.st1 = null; }
          if (S.g1) { ctx.remove(S.g1, 400); S.g1 = null; }
          buildStrip(ctx, S); setStrip(S, [1]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'WHY DECODE NEEDS A BIG BATCH — ROOFLINE', 'H100 SXM · 3.35 TB/s HBM3 · 1,979 TFLOP/s FP8 dense · 70B FP8, TP = 4', 'red');
          var X0 = 140, X1 = 760, Y0 = 250, Y1 = 690;
          function rx(I) { return X0 + Math.log10(I) / 4 * (X1 - X0); }
          function ry(P) { return Y1 - Math.log10(P) / 3.5 * (Y1 - Y0); }
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
          var bfRoof = ctx.path('M' + rx(1) + ',' + ry(3.35) + ' L' + rx(295) + ',' + ry(989) + ' L' + rx(10000) + ',' + ry(989), { stroke: 'dim', sw: 1.5, dash: '6 5', parent: RL });
          var fpRoof = ctx.path('M' + rx(1) + ',' + ry(3.35) + ' L' + rx(590.7) + ',' + ry(1979) + ' L' + rx(10000) + ',' + ry(1979), { stroke: 'amber', sw: 2.6, parent: RL, glow: true });
          ctx.text(rx(590.7) + 10, ry(1979) - 12, 'FP8 peak 1,979', { size: 11.5, font: 'mono', color: 'amber', parent: RL });
          ctx.text(rx(295) - 10, ry(989) - 12, 'BF16 peak 989', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: RL });
          var sl = ctx.text(rx(3), ry(10.05) + 16, 'HBM slope 3.35 TB/s', { size: 11.5, font: 'mono', color: 'amber', anchor: 'middle', parent: RL });
          sl.setAttribute('transform', 'rotate(-39,' + rx(3) + ',' + (ry(10.05) + 16) + ')');
          ctx.line(rx(590.7), ry(1979), rx(590.7), Y1, { color: ctx.alpha('amber', 0.6), sw: 1, dash: '3 4', parent: RL });
          ctx.text(rx(590.7) + 6, Y1 - 12, 'ridge ≈ 590', { size: 11, font: 'mono', color: 'amber', parent: RL });
          /* fixed points */
          var pAtt = ctx.group({ parent: RL });
          ctx.circle(rx(8), ry(26.8), 6, { fill: 'red', parent: pAtt, glow: true });
          ctx.text(rx(8) + 12, ry(26.8) + 16, 'decode attention · I ≈ g = 8', { size: 11.5, font: 'mono', color: 'red', parent: pAtt });
          ctx.text(rx(8) + 12, ry(26.8) + 32, '(GQA; batch does not help)', { size: 11, font: 'mono', color: 'dim', parent: pAtt });
          var pPre = ctx.group({ parent: RL });
          ctx.circle(rx(4096), ry(1979), 6, { fill: 'amber', parent: pPre, glow: true });
          ctx.text(rx(4096) + 12, ry(1979) - 14, 'prefill (2k chunk)', { size: 11.5, font: 'mono', color: 'amber', parent: pPre });
          S.dot = ctx.circle(rx(2), ry(6.7), 7, { fill: 'cyan', parent: RL, glow: 'strong' });
          S.dotL = ctx.text(X1, 630, 'decode GEMMs (cyan) · B = 1', { size: 12, font: 'mono', color: 'cyan', anchor: 'end', parent: RL });
          /* right: throughput and ITL vs batch */
          var PX = 930, PW = 570;
          var P1 = ctx.plot(PX, 250, PW, 190, function (b) { return 1000 * b / (5.2 + 0.1 * b); }, { xDomain: [0, 320], yDomain: [0, 10000], color: 'lime', sw: 2.4, yLabel: 'tokens/s per 4-GPU replica', parent: G });
          var P2 = ctx.plot(PX, 520, PW, 170, function (b) { return 5.2 + 0.1 * b; }, { xDomain: [0, 320], yDomain: [0, 40], color: 'cyan', sw: 2.4, yLabel: 'ITL per step (ms)', parent: G });
          [['10k', 10000], ['5k', 5000]].forEach(function (t) { ctx.text(PX - 6, P1.toPx(0, t[1]).y, t[0], { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: G }); });
          [['40', 40], ['20', 20]].forEach(function (t) { ctx.text(PX - 6, P2.toPx(0, t[1]).y, t[0], { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: G }); });
          [0, 64, 128, 192, 256, 320].forEach(function (b) { ctx.text(P2.toPx(b, 0).x, 706, String(b), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G }); });
          ctx.text(PX + PW, 726, 'batch B (concurrent sequences)', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          var walls = ctx.group({ parent: G });
          [[150, 'KV full · BF16 KV'], [300, 'KV full · FP8 KV']].forEach(function (w) {
            var x = P1.toPx(w[0], 0).x;
            ctx.line(x, 262, x, 690, { color: 'red', sw: 1.4, dash: '5 4', parent: walls });
            ctx.label(x - 6, 468, w[1], { color: 'red', size: 11, anchor: 'end', parent: walls });
          });
          S.cur = ctx.line(PX, 250, PX, 690, { color: ctx.alpha('white', 0.5), sw: 1, dash: '2 3', parent: G });
          S.d1 = ctx.circle(PX, 440, 5, { fill: 'lime', parent: G, glow: true });
          S.d2 = ctx.circle(PX, 690, 5, { fill: 'cyan', parent: G, glow: true });
          S.readout = ctx.text(PX, 760, '', { size: 13, font: 'mono', color: 'white', parent: G });
          var cap = ctx.group({ parent: G });
          ctx.text(60, 800, 't_step ≈ (weights + B·KV) / HBM BW  =  5.2 ms  +  B × 0.10 ms      (17.5 GB weights per GPU, 4k-token contexts)', { size: 13, font: 'mono', color: 'text', parent: cap });
          ctx.text(60, 828, 'batching amortises the weight read over B tokens — but each sequence still streams its own KV: capacity, not FLOPs, caps B', { size: 12.5, font: 'mono', color: 'dim', parent: cap });
          ctx.reveal(RL, { from: 'left' });
          ctx.reveal([bfRoof, fpRoof], { from: 'draw', dur: 1000, delay: 300, stagger: 200 });
          ctx.reveal([P1, P2], { from: 'right', delay: 400, stagger: 200 });
          ctx.reveal(walls, { delay: 900 });
          ctx.reveal(cap, { from: 'up', delay: 1100 });
          ctx.hud('B = 1: 190 tok/s · B = 150: 7.4k tok/s');
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
          return ctx.wait(1300).then(function () {
            return ctx.tween(4200, function (t) { setB(1 + 127 * t); }, 'inOut');
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Continuous batching',
        say: 'Sequences finish at different times: a critic verdict is ten tokens, a script draft is two thousand. With static batching, the batch runs until its longest member ends, finished slots burn padding, and new requests wait at the door. Continuous batching, introduced by Orca, schedules at the granularity of a single iteration. The moment one sequence emits its end token, its slot is refilled on the very next step, and the new prompt is prefilled alongside everyone else\'s decode.',
        deep: '<p><b>Iteration-level scheduling</b> (Orca, OSDI 2022): the scheduler is re-invoked after every forward pass, so batch membership changes every ~10–40 ms.</p>' +
          '<p><b>Selective batching</b> makes this possible with ragged sequences: all token-parallel ops (QKV/O projections, MLP, norms) run on the flattened batch</p>' +
          '<div class="eq">X ∈ ℝ<sup>(Σ<sub>i</sub> n<sub>i</sub>) × d</sup>,   n<sub>i</sub> = prompt length (prefill) or 1 (decode)</div>' +
          '<p>while attention runs per sequence through varlen / paged kernels using cumulative sequence offsets <code>cu_seqlens</code>. No padding, no per-batch recompilation.</p>' +
          '<table><tr><th>in this toy trace</th><th>static</th><th>continuous</th></tr>' +
          '<tr><td>slot utilisation</td><td>69 %</td><td>100 %</td></tr>' +
          '<tr><td>requests finished in 22 iters</td><td>7</td><td>10</td></tr></table>' +
          '<p>Reported gains: Orca 36.9× throughput over FasterTransformer at equal latency on GPT-3 175B. The scheduler must also <b>preempt</b> when KV memory runs out (swap blocks to CPU or drop and recompute), usually victimising the most recently admitted sequence.</p>',
        run: function (ctx) {
          var S = ctx.state;
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
          for (var c = 0; c < NC; c += 3) ctx.text(XC + c * CW + 22, 712, 'it ' + c, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          ctx.text(XC, 412, 'finished slots burn padding · E, F, G, H wait for B (14 iterations)', { size: 12, font: 'mono', color: 'dim', parent: G });
          /* metrics */
          function metric(y, col) {
            var g = ctx.group({ parent: G });
            ctx.text(1300, y, 'slot utilisation', { size: 11.5, font: 'mono', color: 'dim', parent: g });
            var u = ctx.text(1300, y + 30, '0 %', { size: 26, font: 'display', weight: 700, color: col, parent: g });
            ctx.text(1300, y + 64, 'requests finished', { size: 11.5, font: 'mono', color: 'dim', parent: g });
            var d = ctx.text(1300, y + 92, '0', { size: 26, font: 'display', weight: 700, color: col, parent: g });
            return { u: u, d: d };
          }
          S.mA = metric(262, 'red');
          S.mB = metric(560, 'lime');
          S.play = ctx.line(XC, 240, XC, 700, { color: 'white', sw: 1.6, parent: G, glow: true });
          var sel = ctx.group({ parent: G });
          ctx.text(60, 770, 'selective batching:  token-wise ops on  X ∈ ℝ^((Σ nᵢ) × d)   ·   attention per sequence via varlen / paged kernels (cu_seqlens)', { size: 13, font: 'mono', color: 'text', parent: sel });
          ctx.text(60, 800, 'the new request\'s prefill (P) shares the iteration with everyone else\'s decode — no padding, no waiting for the batch', { size: 12.5, font: 'mono', color: 'dim', parent: sel });
          ctx.reveal([S.gA.g, S.gB.g], { from: 'up', stagger: 200 });
          ctx.reveal(sel, { from: 'up', delay: 600 });
          function paint(k) {
            [[S.gA, S.mA], [S.gB, S.mB]].forEach(function (pair) {
              var gr = pair[0], used = 0;
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
              pair[1].u.textContent = (k ? Math.round(100 * used / (NS * k)) : 0) + ' %';
              pair[1].d.textContent = String(done);
            });
            var x = XC + k * CW - 2;
            S.play.setAttribute('x1', x); S.play.setAttribute('x2', x);
          }
          paint(0);
          ctx.hud('static 69 % → continuous 100 % slot utilisation');
          return ctx.wait(900).then(function () {
            return ctx.tween(5200, function (t) { paint(Math.round(t * NC)); }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'PagedAttention',
        say: 'Continuous batching makes memory churn: sequences grow one token at a time and leave at random. Reserving a contiguous maximum-length slab per request wastes most of it. PagedAttention borrows the operating system\'s answer, virtual memory. The KV cache is cut into fixed blocks of sixteen tokens. Each sequence owns a block table that maps its logical blocks to physical blocks anywhere in the pool. Watch blocks being allocated as sequences grow, freed when B finishes, and immediately reused by a newcomer.',
        deep: '<p>vLLM\'s block manager treats KV memory like paged virtual memory:</p>' +
          '<ul><li><b>page</b> = KV block of 16 tokens (all layers): 16 × 80 layers × 2 KV heads × 128 × 2 (K,V) × 2 B = <b>1.25 MiB per GPU</b> for our 70B at TP = 4.</li>' +
          '<li><b>page table</b> = per-sequence <code>block_table</code> (int32), passed to the attention kernel.</li>' +
          '<li><b>allocation</b> is O(1) from a free list; freeing never compacts.</li></ul>' +
          '<div class="eq">slot(pos) = block_table[⌊pos/16⌋] · 16 + (pos mod 16)</div>' +
          '<p>Waste is bounded by one partially filled block per sequence: under 4 % measured, versus only 20.4–38.2 % of KV memory holding real tokens in contiguous-allocation systems (vLLM paper). Result: 2–4× throughput at the same latency.</p>' +
          '<p><b>Copy-on-write</b>: parallel samples and beams share prompt blocks via refcounts; a block is copied only when a writer diverges. The same indirection enables <b>swap/preemption</b> at block granularity and, next, <b>prefix sharing</b> across requests.</p>' +
          '<p><span class="muted">Cost: attention gathers K/V through an indirection; modern kernels (FlashAttention-3 / FlashInfer paged kernels) hide it almost entirely.</span></p>',
        run: function (ctx) {
          var S = ctx.state;
          setStrip(S, [0, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'PAGEDATTENTION — KV CACHE AS VIRTUAL MEMORY', 'block = 16 tokens · per-sequence block tables · O(1) alloc / free', 'red');
          /* HBM bar */
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
          ctx.path('M' + kvL + ',214 L660,280 M' + kvR + ',214 L1516,280', { stroke: ctx.alpha('red', 0.45), sw: 1, dash: '3 4', parent: HB });
          /* physical pool */
          var PX0 = 660, PY0 = 290, BW = 64, BH = 46, GAP = 8, COLS = 12, ROWS = 5, NB = COLS * ROWS;
          var rng = ctx.rng(11);
          var order = []; for (var i = 0; i < NB; i++) order.push(i);
          for (var j = NB - 1; j > 0; j--) { var k = Math.floor(rng() * (j + 1)); var tmp = order[j]; order[j] = order[k]; order[k] = tmp; }
          var PG = ctx.group({ parent: G });
          var pool = [];
          for (var b = 0; b < NB; b++) {
            var x = PX0 + (b % COLS) * (BW + GAP), y = PY0 + Math.floor(b / COLS) * (BH + GAP);
            var r = ctx.rect(x, y, BW, BH, { rx: 5, fill: '#0b1324', stroke: ctx.alpha('faint', 1), sw: 1, parent: PG });
            ctx.text(x + 5, y + 9, '#' + b, { size: 11, font: 'mono', color: 'dim', parent: PG });
            var lab = ctx.text(x + BW / 2, y + 30, '', { size: 12.5, font: 'mono', weight: 700, color: 'white', anchor: 'middle', parent: PG });
            pool.push({ r: r, lab: lab, owner: null, cx: x + BW / 2, cy: y + BH / 2 });
          }
          var SEQC = { A: 'cyan', B: 'lime', C: 'violet', D: 'orange' };
          function setBlock(i, owner, text) {
            var p = pool[i]; p.owner = owner;
            if (owner === null) { p.r.setAttribute('fill', '#0b1324'); p.r.setAttribute('stroke', ctx.C.faint); p.lab.textContent = ''; }
            else if (owner === '*') { p.r.setAttribute('fill', ctx.alpha('red', 0.12)); p.r.setAttribute('stroke', ctx.alpha('red', 0.4)); p.lab.textContent = ''; }
            else { p.r.setAttribute('fill', ctx.alpha(SEQC[owner], 0.32)); p.r.setAttribute('stroke', ctx.color(SEQC[owner])); p.lab.textContent = text; }
          }
          /* 22 blocks belong to other sequences in the batch */
          var free = order.slice(22);
          order.slice(0, 22).forEach(function (bi) { setBlock(bi, '*'); });
          /* logical rows */
          var LG = ctx.group({ parent: G });
          ctx.text(60, 262, 'LOGICAL VIEW · block tables', { size: 12, font: 'mono', color: 'dim', parent: LG });
          ctx.text(PX0, 262, 'PHYSICAL KV POOL · 60 of ~38k blocks shown', { size: 12, font: 'mono', color: 'dim', parent: LG });
          var seqs = {};
          var ROWY = { A: 318, B: 393, C: 468, D: 543 };
          var NAMES = { A: 'A · Director', B: 'B · Critic', C: 'C · Writer', D: 'D · Camera' };
          function mkSeq(id, tok, hidden) {
            var y = ROWY[id];
            var g = ctx.group({ parent: LG });
            ctx.label(60, y, NAMES[id], { color: SEQC[id], size: 12, anchor: 'start', parent: g });
            var tt = ctx.text(60, y + 26, '', { size: 11, font: 'mono', color: 'dim', parent: g });
            var sq = { id: id, tok: 0, table: [], chips: [], g: g, tt: tt, y: y };
            seqs[id] = sq;
            if (hidden) g.setAttribute('opacity', 0);
            grow(sq, tok, true);
            return sq;
          }
          function chipFor(sq, j, phys) {
            var x = 200 + j * 50, y = sq.y - 15;
            var cg = ctx.group({ parent: sq.g });
            ctx.rect(x, y, 44, 30, { rx: 4, fill: ctx.alpha(SEQC[sq.id], 0.14), stroke: SEQC[sq.id], sw: 1, parent: cg });
            ctx.text(x + 22, y + 12, '#' + phys, { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: cg });
            var fb = ctx.rect(x + 3, y + 23, 0, 4, { rx: 1, fill: SEQC[sq.id], parent: cg });
            return { g: cg, fb: fb, x: x + 22, y: y + 15 };
          }
          function refreshSeq(sq) {
            sq.tt.textContent = sq.tok + ' tok · ' + sq.table.length + ' blocks';
            sq.chips.forEach(function (c, j) {
              var n = Math.max(0, Math.min(16, sq.tok - 16 * j));
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
                var ch = chipFor(sq, j2, phys);
                sq.chips.push(ch);
                if (!silent && !ctx.instant) {
                  var ln = ctx.line(ch.x + 22, ch.y, pool[phys].cx, pool[phys].cy, { color: SEQC[sq.id], sw: 1.6, arrow: true, parent: G, glow: true });
                  ctx.after(650, (function (l) { return function () { ctx.remove(l, 300); }; })(ln));
                  ctx.pulse(pool[phys].r, { color: SEQC[sq.id], dur: 600 });
                }
              }
            }
            refreshSeq(sq);
          }
          function freeSeq(sq) {
            var freed = sq.table.slice();
            freed.forEach(function (p) { setBlock(p, null); if (!ctx.instant) ctx.pulse(pool[p].r, { color: 'white', dur: 500 }); });
            free = freed.concat(free);
            sq.tt.textContent = 'EOS → ' + freed.length + ' blocks back to the free list';
            sq.g.setAttribute('opacity', 0.35);
          }
          /* initial state: interleaved admission */
          mkSeq('A', 0); mkSeq('B', 0); mkSeq('C', 0); mkSeq('D', 0, true);
          for (var step = 0; step < 5; step++) {
            if (seqs.A.tok < 40) grow(seqs.A, Math.min(16, 40 - seqs.A.tok), true);
            if (seqs.B.tok < 70) grow(seqs.B, Math.min(16, 70 - seqs.B.tok), true);
            if (seqs.C.tok < 20) grow(seqs.C, Math.min(16, 20 - seqs.C.tok), true);
          }
          /* code + waste comparison */
          var aTab = seqs.A.table.map(function (p) { return p; }).join(', ');
          var code = ctx.code({ parent: G, x: 660, y: 632, w: 880, title: 'paged attention kernel · per sequence, per layer', lang: 'py', size: 12, color: 'red', lines: [
            'block_table["A"] = [' + aTab + ', …]      # logical → physical, int32 on GPU',
            'slot = block_table[seq][pos // 16] * 16 + pos % 16          # where token pos is written',
            'for blk in block_table[seq]:  K, V = kv_pool[layer, blk]    # [16, h_kv, d_h] gather',
            '    m, l, o = online_softmax(m, l, o, q @ K.T / sqrt(d_h), V)',
            'free(seq): for blk in table: ref[blk] -= 1; if ref[blk] == 0: free_list.push(blk)'
          ] });
          var WG = ctx.group({ parent: G });
          ctx.text(60, 640, 'KV MEMORY ACTUALLY HOLDING TOKENS', { size: 12, font: 'mono', color: 'dim', parent: WG });
          ctx.text(60, 668, 'contiguous, reserve max_len per request', { size: 12, font: 'mono', color: 'text', parent: WG });
          ctx.rect(60, 680, 520, 22, { rx: 4, fill: ctx.alpha('red', 0.1), stroke: ctx.alpha('red', 0.5), sw: 1, dash: '4 3', parent: WG });
          ctx.rect(60, 680, 520 * 0.3, 22, { rx: 4, fill: ctx.alpha('cyan', 0.5), stroke: 'cyan', sw: 1, parent: WG });
          ctx.text(60 + 520 * 0.3 + 10, 691, '20–38 % used · rest reserved or fragmented', { size: 11.5, font: 'mono', color: 'red', parent: WG });
          ctx.text(60, 728, 'paged, 16-token blocks', { size: 12, font: 'mono', color: 'text', parent: WG });
          ctx.rect(60, 740, 520, 22, { rx: 4, fill: ctx.alpha('lime', 0.1), stroke: ctx.alpha('lime', 0.5), sw: 1, parent: WG });
          ctx.rect(60, 740, 520 * 0.96, 22, { rx: 4, fill: ctx.alpha('lime', 0.5), stroke: 'lime', sw: 1, parent: WG });
          ctx.text(70, 751, '≥ 96 % used · waste ≤ 1 partial block / sequence', { size: 11.5, font: 'mono', color: 'white', parent: WG });
          ctx.text(60, 796, 'copy-on-write: parallel samples share prompt blocks (refcount > 1)', { size: 12, font: 'mono', color: 'dim', parent: WG });
          var legend = ctx.group({ parent: G });
          [['free', '#0b1324', 'faint'], ['other sequences in the batch', ctx.alpha('red', 0.12), ctx.alpha('red', 0.4)]].forEach(function (l, i) {
            var lx = PX0 + i * 110;
            ctx.rect(lx, 574, 16, 14, { rx: 3, fill: l[1], stroke: l[2], sw: 1, parent: legend });
            ctx.text(lx + 22, 581, l[0], { size: 11, font: 'mono', color: 'dim', parent: legend });
          });
          ctx.text(1516, 581, 'block = 16 tok × 80 layers × 2 KV heads × 128 × K,V × 2 B = 1.25 MiB / GPU', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: legend });

          ctx.reveal(HB, { from: 'down' });
          ctx.reveal([LG, PG, legend], { delay: 700, stagger: 150 });
          ctx.reveal([WG, code], { from: 'up', delay: 1100, stagger: 200 });
          ctx.hud('KV waste: 60–80 % (contiguous) → < 4 % (paged)');
          /* timeline of events */
          var frames = [];
          for (var f = 0; f < 26; f++) frames.push(function () { grow(seqs.A, 1); grow(seqs.B, 1); grow(seqs.C, 1); });
          frames.push(function () { freeSeq(seqs.B); });
          frames.push(function () { seqs.D.g.setAttribute('opacity', 1); grow(seqs.D, 52); });
          for (var f2 = 0; f2 < 8; f2++) frames.push(function () { grow(seqs.A, 1); grow(seqs.C, 1); grow(seqs.D, 1); });
          S.pf = 0;
          function apply(n) { while (S.pf < n && S.pf < frames.length) { frames[S.pf](); S.pf++; } }
          return ctx.camera(1090, 230, 1.8, 700).then(function () { return ctx.wait(500); })
            .then(function () { return ctx.camera(800, 450, 1, 1100); })
            .then(function () { return ctx.tween(6500, function (t) { apply(Math.round(t * frames.length)); }, 'linear'); });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Prefix caching',
        say: 'Our agents are extremely repetitive. Every call from the crew starts with the same six thousand tokens of system prompt and tool schemas, then the same project bible describing the fox, the moon and the sketches. Prefix caching keeps those KV blocks alive after a request ends. SGLang organises them as a radix tree over token sequences. When the critic asks to review shot three, the engine walks the tree, reuses nine thousand cached tokens, and prefills only the four hundred new ones.',
        deep: '<p>Two equivalent implementations:</p>' +
          '<ul><li><b>vLLM automatic prefix caching</b>: each full block is keyed by a hash chain <code>h<sub>i</sub> = H(h<sub>i−1</sub>, tokens<sub>16i…16i+15</sub>, extras)</code> (extras: LoRA id, image hashes for multimodal prompts). A hit bumps the block refcount.</li>' +
          '<li><b>SGLang RadixAttention</b>: a radix tree whose edges are token spans and whose nodes own KV blocks. Eviction is LRU over leaves with refcount 0; the scheduler orders the queue <i>longest-prefix-first</i> to maximise hits.</li></ul>' +
          '<table><tr><th>this request</th><th>tokens</th></tr>' +
          '<tr><td>system + tool schemas</td><td>6,144</td></tr><tr><td>project bible</td><td>2,080</td></tr>' +
          '<tr><td>critic thread</td><td>960</td></tr><tr><td><b>new suffix (prefilled)</b></td><td><b>412</b></td></tr></table>' +
          '<p>Prefill cost ≈ 35 µs/token here (2·17.5 GFLOP per token per GPU at ~1 PFLOP/s effective FP8), so TTFT drops from ≈ 0.34 s to ≈ 0.03 s. SGLang reports up to 6.4× throughput on agentic / few-shot workloads.</p>' +
          '<div class="note">Cache hits are per replica, so the load balancer must route by prefix (KV-aware routing), otherwise hit rates collapse as replicas scale out. Keep prompts <i>prefix-stable</i>: put volatile content (timestamps, tool results) at the end.</div>',
        run: function (ctx) {
          var S = ctx.state;
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
          ctx.para(1190, 650, ['SGLang: radix tree + cache-aware', 'scheduling (longest prefix first)', 'router: send calls to the replica', 'that already holds the prefix'], { size: 12, font: 'mono', color: 'dim', parent: R, lh: 20 });
          /* request */
          S.req = ctx.label(96, 780, 'NEW  Critic → review_shot(3) · 9,596 prompt tokens', { color: 'magenta', size: 12.5, anchor: 'start', parent: G });
          ctx.reveal(T, { from: 'left' });
          ctx.reveal(links, { from: 'draw', delay: 300, stagger: 60 });
          ctx.reveal([R, code], { from: 'right', delay: 500, stagger: 150 });
          ctx.reveal(S.req, { from: 'up', delay: 1100 });
          ctx.hud('9,184 of 9,596 prompt tokens served from cache');
          var path = [root, S.n1, S.n2, S.bC];
          var chain = ctx.wait(1700);
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
            S.lNew = ctx.node({ x: 1040, y: 690, w: 170, h: 40, kind: 'pill', title: 'shot 3 review · 412', color: 'amber', titleSize: 12, parent: T });
            var ln = ctx.link(S.bC, S.lNew, { from: 'r', to: 'l', color: 'amber', sw: 1.6, arrow: false, parent: T });
            var ml = ctx.label(1040, 726, 'MISS → prefill 412 tok', { color: 'amber', size: 11, parent: T });
            ctx.reveal(ln, { from: 'draw', dur: 400 });
            ctx.reveal([S.lNew, ml], { from: 'scale', delay: 200 });
            ctx.counter(S.sTot, 0, 9596, 600);
            ctx.counter(S.sNew, 0, 412, 600);
            ctx.counter(S.sRate, 0, 95.7, 600, function (v) { return v.toFixed(1) + ' %'; });
            return ctx.wait(700);
          }).then(function () {
            S.sTT.textContent = '0.34 → 0.03 s';
            ctx.pulse(S.sTT, { color: 'cyan', dur: 500 });
            return ctx.wait(700);
          }).then(function () {
            ctx.fade(S.lW1, 0.25, 500);
            var ev = ctx.text(1040, 462, 'evicted · LRU leaf, ref = 0', { size: 11, font: 'mono', color: 'pink', anchor: 'middle', parent: T });
            return ctx.reveal(ev, { dur: 400 });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Chunked prefill',
        say: 'Prefill and decode have opposite personalities. A twelve thousand token prompt from the writer is a huge compute-bound job; if the engine runs it alone, sixty four decoding agents freeze for almost half a second. Chunked prefill, as in Sarathi-Serve, sets a token budget per iteration. Decodes go in first, one token each, and the prompt is sliced into chunks that fill the rest. Worst-case inter-token latency drops about twelve fold, for a small increase in time to first token.',
        deep: '<p><b>Stall-free batching</b> (Sarathi-Serve): each iteration gets a token budget τ. Schedule all running decodes first (1 token each), then fill τ − #decodes with a slice of the pending prompt(s).</p>' +
          '<div class="eq">t<sub>iter</sub> ≈ max( t<sub>mem</sub>, τ · c<sub>tok</sub> ),   t<sub>mem</sub> ≈ 11.6 ms,  c<sub>tok</sub> ≈ 35 µs</div>' +
          '<table><tr><th></th><th>prefill alone</th><th>chunked, τ = 1,024</th></tr>' +
          '<tr><td>worst ITL (64 decoders)</td><td>≈ 444 ms</td><td>≈ 38 ms</td></tr>' +
          '<tr><td>new request TTFT</td><td>≈ 0.43 s</td><td>13 × 38 ms ≈ 0.49 s</td></tr></table>' +
          '<p>Choosing τ: below ~330 tokens the iteration is still memory-bound (prefill rides for free); above, each extra token costs c<sub>tok</sub>. τ is set from the TPOT SLO. Chunks attend to all earlier chunks through the paged KV cache, so results are exact.</p>' +
          '<p>Reported: 2.6× serving capacity for Mistral-7B on one A100, up to 5.6× for Falcon-180B (Sarathi-Serve, OSDI 2024). Chunked prefill is on by default in vLLM V1 and SGLang.</p>',
        run: function (ctx) {
          var S = ctx.state;
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
          ctx.text(X0 - 42, yA + H / 2, 'tok', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          for (var i = 0; i < 16; i++) ctx.text(bxAt(i) + BWd / 2, yB + H + 16, String(i), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
          ctx.text(X0 + 8 * SW, yB + H + 36, 'engine iteration', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G });
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
          ctx.text(bxAt(3) + BWd + 10, yA + 14, '12,288 prefill tokens (off scale)', { size: 11.5, font: 'mono', color: 'amber', parent: gA });
          ctx.text(bxAt(3) + BWd + 10, yA + 34, 'ITL spike ≈ 444 ms for all 64 decoders', { size: 11.5, font: 'mono', color: 'red', parent: gA });
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
          var lineB = ctx.path(itlPath(yB, itlB), { stroke: 'red', sw: 2, parent: gB, glow: true });
          var itlBL = ctx.text(bxAt(0), yB + H - 44, 'ITL ≤ 38 ms', { size: 11.5, font: 'mono', color: 'red', parent: gB });
          ctx.text(X0 + 16 * SW - 4, tokY(yB, 1024) - 10, 'τ = 1,024', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: gB });
          /* legend */
          var lg = ctx.group({ parent: G });
          [['decode tokens', 'cyan'], ['prefill tokens', 'amber'], ['ITL (right axis)', 'red']].forEach(function (l, k) {
            ctx.rect(150 + k * 190, 822, 16, 12, { rx: 2, fill: ctx.alpha(l[1], 0.6), stroke: l[1], sw: 1, parent: lg });
            ctx.text(172 + k * 190, 828, l[0], { size: 11.5, font: 'mono', color: 'dim', parent: lg });
          });
          /* right panel: the prompt, sliced */
          var R = ctx.group({ parent: G });
          ctx.text(1120, 262, 'NEW REQUEST · Writer agent', { size: 13, font: 'display', weight: 700, color: 'white', parent: R });
          ctx.text(1120, 284, '12,288-token context → 13 chunks', { size: 12, font: 'mono', color: 'amber', parent: R });
          ctx.rect(1120, 300, 400, 30, { rx: 4, fill: 'none', stroke: ctx.alpha('amber', 0.6), sw: 1, dash: '4 3', parent: R });
          ctx.para(1120, 380, [
            'tokens / iter = 64 decode + 960 prefill',
            't_iter ≈ max(t_mem, t_comp)',
            't_mem  ≈ 11.6 ms  (weights + KV)',
            't_comp ≈ 1,024 × 35 µs ≈ 36 ms',
            'ITL    ≈ 38 ms  ✓ under a 50 ms SLO'
          ], { size: 12, font: 'mono', color: 'text', parent: R, lh: 22 });
          ctx.para(1120, 520, [
            'TTFT, prefill alone   ≈ 0.43 s',
            'TTFT, chunked 13 × 38 ms ≈ 0.49 s',
            'trade: +14 % TTFT for ~12× lower',
            'worst-case ITL for everyone else'
          ], { size: 12, font: 'mono', color: 'dim', parent: R, lh: 22 });
          var chunks = [];
          for (var c = 0; c < 13; c++) {
            var w = c < 12 ? 31.25 : 25, v = c < 12 ? 960 : 768;
            var cr = ctx.rect(1120 + c * 31.25, 300, w - 1.5, 30, { rx: 2, fill: ctx.alpha('amber', 0.55), stroke: 'amber', sw: 1, parent: G });
            chunks.push({ r: cr, sx: 1120 + c * 31.25, w: w - 1.5, tx: bxAt(3 + c), ty: tokY(yB, 64 + v), th: H * v / 1200 });
          }
          ctx.reveal([gA, gB], { from: 'up', stagger: 150 });
          ctx.reveal(barsA, { from: 'up', delay: 400, stagger: 60, dist: 10 });
          ctx.reveal(lineA, { from: 'draw', dur: 1000, delay: 900 });
          ctx.reveal(R, { from: 'right', delay: 500 });
          ctx.reveal(chunks.map(function (c) { return c.r; }), { delay: 600, stagger: 30 });
          ctx.reveal(decB, { from: 'up', delay: 1400, stagger: 50, dist: 8 });
          ctx.reveal([budget, lg], { delay: 1500 });
          lineB.setAttribute('opacity', 0); itlBL.setAttribute('opacity', 0);
          ctx.hud('worst ITL 444 ms → 38 ms · TTFT +14 %');
          var chain = ctx.wait(2200);
          chain = chain.then(function () {
            return Promise.all(chunks.map(function (c, k) {
              return ctx.tween(650, function (t) {
                c.r.setAttribute('x', ctx.lerp(c.sx, c.tx, t));
                c.r.setAttribute('y', ctx.lerp(300, c.ty, t));
                c.r.setAttribute('width', ctx.lerp(c.w, BWd, t));
                c.r.setAttribute('height', ctx.lerp(30, c.th, t));
              }, 'inOut', k * 180);
            }));
          });
          return chain.then(function () {
            return Promise.all([ctx.reveal(lineB, { from: 'draw', dur: 900 }), ctx.reveal(itlBL, { delay: 600 })]);
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'P/D disaggregation',
        say: 'Chunking still makes prefill and decode share one GPU and one parallel layout. At scale, systems like DistServe, Splitwise, Mooncake and NVIDIA Dynamo split them apart. A prefill pool, tuned for compute, builds the KV cache for a new prompt. The KV blocks are then streamed, layer by layer, over NVLink or RDMA to a decode pool tuned for memory bandwidth and huge batches. Each pool scales independently, and neither phase can hurt the other\'s latency.',
        deep: '<p><b>Why split</b>: prefill wants compute and modest batch; decode wants bandwidth, KV capacity and very large batches. Colocated, they interfere (chunking bounds but does not remove it) and must share one TP/PP layout.</p>' +
          '<div class="eq">KV bytes = n<sub>prompt</sub> · L · 2 · h<sub>kv</sub> · d<sub>h</sub> · b = 8,192 · 80 · 2 · 8 · 128 · 2 B ≈ 2.68 GB</div>' +
          '<p>Per TP shard 671 MB: ≈ 13 ms over a 400 Gb/s RDMA NIC per GPU, ≈ 1.5 ms over NVLink 4 (≈ 450 GB/s per direction). Transfers are pipelined per layer group, so only the last group is exposed in TTFT.</p>' +
          '<ul><li><b>DistServe</b> (OSDI 2024): optimises goodput per GPU; 7.4× more requests or 12.6× tighter SLOs than colocated serving.</li>' +
          '<li><b>Splitwise</b> (ISCA 2024): prefill on H100, decode on cheaper / power-capped parts.</li>' +
          '<li><b>Mooncake</b> (Kimi, FAST 2025): KV-cache-centric, a distributed KV pool in CPU DRAM/SSD across the cluster.</li>' +
          '<li><b>NVIDIA Dynamo</b> + NIXL: disaggregated serving, KV-aware router, GPU-direct KV movement.</li>' +
          '<li><b>MoE planners</b> gain even more from the split: DeepSeek-V3 serves prefill on 32-GPU units (EP32) and decode on 320-GPU units (EP320), each phase with its own expert-parallel degree.</li></ul>' +
          '<p>Agent traffic (long prompts, short answers) needs a <b>high P:D ratio</b>; the xPyD mix is tuned online.</p>',
        run: function (ctx) {
          var S = ctx.state;
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
            var n = ctx.node({ x: 550, y: y, w: 380, h: 150, kind: 'box', color: 'amber', parent: PP });
            ctx.text(378, y - 52, name + ' · 4× H100 · TP = 4', { size: 12.5, font: 'mono', color: 'white', parent: PP });
            for (var i = 0; i < 4; i++) {
              ctx.rect(380 + i * 88, y - 34, 72, 48, { rx: 5, fill: ctx.alpha('amber', 0.1), stroke: ctx.alpha('amber', 0.7), sw: 1, parent: PP });
              ctx.icon('gpu', 416 + i * 88, y - 10, 26, 'amber', { parent: PP });
            }
            ctx.rect(380, y + 34, 340, 12, { rx: 3, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('amber', 0.5), sw: 1, parent: PP });
            var pb = ctx.rect(380, y + 34, 0, 12, { rx: 3, fill: ctx.alpha('amber', 0.7), parent: PP });
            ctx.text(550, y + 60, 'layers 0 … 79', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: PP });
            n.pb = pb;
            return n;
          }
          S.P0 = pInst(390, 'P0'); S.P1 = pInst(585, 'P1');
          function dInst(y, name, occ) {
            var n = ctx.node({ x: 1185, y: y, w: 660, h: 100, kind: 'box', color: 'cyan', parent: DP });
            ctx.text(872, y - 26, name + ' · 4× H100 · TP = 4', { size: 12.5, font: 'mono', color: 'white', parent: DP });
            for (var i = 0; i < 4; i++) {
              ctx.rect(872 + i * 34, y - 6, 28, 30, { rx: 4, fill: ctx.alpha('cyan', 0.1), stroke: ctx.alpha('cyan', 0.7), sw: 1, parent: DP });
            }
            ctx.text(1500, y - 26, 'KV pool occupancy', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: DP });
            ctx.rect(1030, y - 6, 470, 16, { rx: 3, fill: 'rgba(255,255,255,0.03)', stroke: ctx.alpha('cyan', 0.5), sw: 1, parent: DP });
            var kb = ctx.rect(1030, y - 6, 470 * occ, 16, { rx: 3, fill: ctx.alpha('cyan', 0.55), parent: DP });
            ctx.text(1030, y + 26, 'seqs decoding: ' + Math.round(occ * 300), { size: 11, font: 'mono', color: 'dim', parent: DP });
            n.kb = kb; n.occ = occ;
            return n;
          }
          S.D0 = dInst(345, 'D0', 0.78); S.D1 = dInst(470, 'D1', 0.62); S.D2 = dInst(595, 'D2', 0.84);
          var l1 = ctx.link(S.router, S.P0, { from: 'r', to: 'l', color: 'amber', label: '8k prompt', labelDy: -14, parent: G });
          S.xfer = ctx.link({ x: 740, y: 390 }, { x: 855, y: 470 }, { color: 'red', sw: 2.4, parent: G });
          var xl = ctx.label(800, 706, 'KV blocks · RDMA / NVLink (NIXL)', { color: 'red', size: 11, parent: G });
          ctx.line(800, 694, 797, 440, { color: ctx.alpha('red', 0.45), sw: 1, dash: '2 3', parent: G });
          S.ret = ctx.path('M1185,692 C1185,760 170,760 170,495', { stroke: 'cyan', sw: 1.6, dash: '5 5', arrow: true, parent: G });
          S.ret.len = S.ret.getTotalLength();
          var rl = ctx.text(1000, 750, 'tokens → agents (SSE)', { size: 11.5, font: 'mono', color: 'cyan', anchor: 'middle', parent: G });
          /* timeline */
          var TL = ctx.group({ parent: G });
          [['prefill', 792], ['KV xfer', 820], ['decode', 848]].forEach(function (r) { ctx.text(330, r[1], r[0], { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: TL }); });
          var tlp = [], tlx = [];
          for (var g = 0; g < 5; g++) {
            tlp.push(ctx.rect(340 + g * 82, 783, 78, 18, { rx: 3, fill: ctx.alpha('amber', 0.5), stroke: 'amber', sw: 1, parent: TL }));
            ctx.text(379 + g * 82, 792, 'L' + g * 16 + '–' + (g * 16 + 15), { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: TL });
            tlx.push(ctx.rect(418 + g * 82, 811, 26, 18, { rx: 3, fill: ctx.alpha('red', 0.55), stroke: 'red', sw: 1, parent: TL }));
          }
          var tld = [];
          for (var d = 0; d < 12; d++) tld.push(ctx.rect(772 + d * 28, 839, 20, 18, { rx: 3, fill: ctx.alpha('cyan', 0.5), stroke: 'cyan', sw: 1, parent: TL }));
          bracket(ctx, TL, 340, 792, 768, 'TTFT ≈ prefill + last KV group + 1 decode step', 'amber', true);
          ctx.para(1130, 792, ['8k prompt → 2.68 GB KV (BF16)', '671 MB / TP shard: ≈ 13 ms @ 400 Gb/s', '≈ 1.5 ms over NVLink (450 GB/s/dir)'], { size: 12, font: 'mono', color: 'text', parent: TL, lh: 22 });
          [tlp, tlx, tld].forEach(function (arr) { arr.forEach(function (e) { e.setAttribute('opacity', 0); }); });

          ctx.reveal(S.router, { from: 'left' });
          ctx.reveal([PP, DP], { from: 'up', delay: 200, stagger: 200 });
          ctx.reveal([l1, S.xfer], { from: 'draw', delay: 700, stagger: 200 });
          ctx.reveal([l1.labelEl, xl, rl, TL], { delay: 900, stagger: 100 });
          ctx.reveal(S.ret, { from: 'draw', delay: 1000, dur: 900 });
          ctx.hud('8k-prompt KV: 2.68 GB · streamed per layer group');
          return ctx.wait(1400).then(function () {
            return ctx.packet(l1, { color: 'amber', dur: 700, label: 'prompt' });
          }).then(function () {
            ctx.camera(700, 470, 1.45, 800);
            var jobs = [];
            for (var k = 0; k < 5; k++) {
              (function (k) {
                jobs.push(ctx.tween(420, function (t) { S.P0.pb.setAttribute('width', 340 * (k + t) / 5); }, 'linear', k * 440).then(function () {
                  ctx.reveal(tlp[k], { dur: 200 });
                  return ctx.packet(S.xfer, { color: 'red', dur: 480, label: 'L' + k * 16 + '–' + (k * 16 + 15) }).then(function () { ctx.reveal(tlx[k], { dur: 200 }); });
                }));
              })(k);
            }
            return Promise.all(jobs);
          }).then(function () {
            ctx.camera(800, 450, 1, 800);
            ctx.animate(S.D1.kb, { width: [470 * 0.62, 470 * 0.64] }, 500);
            ctx.reveal(tld, { dur: 200, stagger: 70 });
            S.retStream = ctx.stream(S.ret, { color: 'cyan', count: 3, period: 2200 });
            return ctx.wait(1200);
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Numerics & kernels',
        say: 'Three more levers work below the scheduler. Quantization shrinks bytes per token: FP8 weights and FP8 KV cache halve memory traffic, and Blackwell\'s NVFP4 goes to four and a half bits with tiny shared scales per block. Speculative decoding lets a cheap draft head propose several tokens that the big model verifies in one pass, losslessly. And CUDA graphs replay a whole decode step with one launch, taking about a thousand separate kernel launches off the critical path.',
        deep: '<p><b>Formats</b>: FP8 E4M3 (max 448) with per-tensor / per-channel or 128-block scales; <b>MXFP4</b> (OCP MX): E2M1 values, one E8M0 power-of-two scale per 32 → 4.25 bits; <b>NVFP4</b>: E2M1, one E4M3 scale per 16 plus an FP32 tensor scale → 4.5 bits, native on B200/B300 tensor cores. <b>AWQ</b> (W4A16): INT4 weights, group 128; scales salient input channels by s = mean|x|<sup>α</sup> before rounding, dequantised in-kernel (Marlin).</p>' +
          '<table><tr><th>70B</th><th>BF16</th><th>FP8</th><th>NVFP4</th></tr>' +
          '<tr><td>weights</td><td>140 GB</td><td>70 GB</td><td>≈ 39 GB</td></tr>' +
          '<tr><td>KV / token</td><td>320 KiB</td><td>160 KiB</td><td>≈ 90 KiB</td></tr></table>' +
          '<p><b>Speculative decoding</b>: draft proposes k tokens with probs q; target scores k+1 positions in one pass; accept token i with prob min(1, p/q), else resample from norm(max(0, p−q)). Output distribution is exactly the target\'s.</p>' +
          '<div class="eq">E[tokens / target pass] = (1 − α<sup>k+1</sup>) / (1 − α) = 3.36  (α = 0.8, k = 4)</div>' +
          '<p>At large batch the verify pass is no longer free (decode becomes compute-bound), so engines adapt k to load. EAGLE-3 reports up to 6.5× at batch 1, ~1.4× at batch 64 (SGLang).</p>' +
          '<p><b>CUDA graphs</b>: ~1,000 kernels per decode step at ~4–6 µs launch each is several ms of CPU time; graphs are captured per batch bucket and replayed with one launch.</p>',
        run: function (ctx) {
          var S = ctx.state;
          if (S.retStream) { S.retStream.stop(); S.retStream = null; }
          setStrip(S, [1, 2, 3]);
          var G = clearPanel(ctx, S);
          heading(ctx, G, 60, 182, 'BELOW THE SCHEDULER — NUMERICS & KERNELS', 'fewer bytes per token · more tokens per pass · fewer launches per step', 'red');
          ctx.line(565, 220, 565, 860, { color: 'line', sw: 1, parent: G });
          ctx.line(1085, 220, 1085, 860, { color: 'line', sw: 1, parent: G });
          /* A: formats */
          var A = ctx.group({ parent: G });
          ctx.text(60, 236, 'NUMBER FORMATS', { size: 14, font: 'display', weight: 700, color: 'white', parent: A });
          var FC = { s: 'pink', e: 'amber', m: 'cyan', i: 'violet' };
          function bits(y, name, spec, note, extra) {
            ctx.text(60, y, name, { size: 12.5, font: 'mono', weight: 700, color: 'white', parent: A });
            var x = 150;
            spec.forEach(function (sp) {
              for (var i = 0; i < sp[1]; i++) { ctx.rect(x, y - 11, 17, 22, { rx: 3, fill: ctx.alpha(FC[sp[0]], 0.45), stroke: FC[sp[0]], sw: 1, parent: A }); x += 19; }
            });
            if (extra) ctx.text(x + 8, y, extra, { size: 11.5, font: 'mono', color: 'text', parent: A });
            ctx.text(150, y + 22, note, { size: 11, font: 'mono', color: 'dim', parent: A });
          }
          bits(276, 'BF16', [['s', 1], ['e', 8], ['m', 7]], 'FP32 range · 7 mantissa bits');
          bits(332, 'FP8', [['s', 1], ['e', 4], ['m', 3]], 'E4M3 · max 448 · 2× BF16 tensor FLOP/s', '+ block scales');
          bits(388, 'NVFP4', [['s', 1], ['e', 2], ['m', 1]], 'values ±{0,.5,1,1.5,2,3,4,6} · Blackwell', '× 16 + E4M3 scale');
          bits(444, 'MXFP4', [['s', 1], ['e', 2], ['m', 1]], 'OCP MX · 4.25 bits / value', '× 32 + E8M0 scale');
          bits(500, 'AWQ', [['i', 4]], 'W4A16 · group 128 · salient channels scaled', 'INT4 weight-only');
          ctx.text(60, 556, '70B WEIGHTS', { size: 12, font: 'mono', color: 'dim', parent: A });
          var wb = [['BF16', 140, 'text'], ['FP8', 70, 'amber'], ['NVFP4', 39.4, 'lime']];
          S.wBars = wb.map(function (w, i) {
            var y = 572 + i * 30;
            ctx.text(60, y + 10, w[0], { size: 11.5, font: 'mono', color: 'dim', parent: A });
            var r = ctx.rect(130, y, 340 * w[1] / 140, 20, { rx: 3, fill: ctx.alpha(w[2], 0.45), stroke: w[2], sw: 1, parent: A });
            ctx.text(130 + 340 * w[1] / 140 + 8, y + 10, (w[1] === 39.4 ? '≈ 39' : w[1]) + ' GB', { size: 11.5, font: 'mono', color: w[2], parent: A });
            return r;
          });
          ctx.text(60, 682, 'KV CACHE PER TOKEN (all GPUs)', { size: 12, font: 'mono', color: 'dim', parent: A });
          [['BF16', 320, 'text'], ['FP8', 160, 'amber']].forEach(function (w, i) {
            var y = 698 + i * 30;
            ctx.text(60, y + 10, w[0], { size: 11.5, font: 'mono', color: 'dim', parent: A });
            ctx.rect(130, y, 340 * w[1] / 320, 20, { rx: 3, fill: ctx.alpha(w[2], 0.45), stroke: w[2], sw: 1, parent: A });
            ctx.text(130 + 340 * w[1] / 320 + 8, y + 10, w[1] + ' KiB', { size: 11.5, font: 'mono', color: w[2], parent: A });
          });
          ctx.text(60, 780, 'FP8 KV → 2× concurrent sequences', { size: 12, font: 'mono', color: 'lime', parent: A });
          ctx.text(60, 804, 'per-tensor / per-head scales · validate long context', { size: 11, font: 'mono', color: 'dim', parent: A });
          /* B: speculative decoding */
          var B = ctx.group({ parent: G });
          ctx.text(590, 236, 'SPECULATIVE DECODING', { size: 14, font: 'display', weight: 700, color: 'white', parent: B });
          ctx.text(590, 268, 'context: "…the fox astronaut"', { size: 12, font: 'mono', color: 'dim', parent: B });
          ctx.text(590, 312, 'draft', { size: 12, font: 'mono', color: 'violet', parent: B });
          var DR = [' climbs', ' out', ' of', ' the'];
          var dx = 650, drafts = [];
          DR.forEach(function (t) { var l = ctx.label(dx, 312, t, { color: 'violet', size: 12, anchor: 'start', parent: B }); drafts.push(l); dx += l.w + 8; });
          ctx.text(590, 338, 'EAGLE-3 head / MTP layer · ~1 layer, 4 cheap steps', { size: 11, font: 'mono', color: 'dim', parent: B });
          var ver = ctx.node({ x: 820, y: 390, w: 460, h: 50, title: 'target 70B · ONE forward over k + 1 = 5 positions', color: 'amber', titleSize: 13, parent: B });
          ctx.text(590, 446, 'verify', { size: 12, font: 'mono', color: 'amber', parent: B });
          var RS = [[' climbs', 'lime'], [' out', 'lime'], [' of', 'lime'], [' the', 'red'], [' its', 'amber']];
          var rx2 = 650, res = [];
          RS.forEach(function (t, i) {
            var l = ctx.label(rx2, 470, t[0], { color: t[1], size: 12, anchor: 'start', parent: B });
            if (i === 3) ctx.line(rx2 + 4, 470, rx2 + l.w - 4, 470, { color: 'red', sw: 1.6, parent: l });
            res.push(l); rx2 += l.w + 8;
          });
          ctx.text(590, 504, 'accept 3 + 1 corrected = 4 tokens from 1 target pass', { size: 11.5, font: 'mono', color: 'lime', parent: B });
          ctx.text(590, 540, 'E[tok/pass] = (1 − α^(k+1)) / (1 − α) = 3.36', { size: 12.5, font: 'mono', color: 'white', parent: B });
          ctx.text(590, 562, 'α = 0.8, k = 4 · accept w.p. min(1, p/q) → lossless', { size: 11, font: 'mono', color: 'dim', parent: B });
          var sp = ctx.plot(630, 610, 400, 140, function (b) { return 1 + 2.2 / (1 + b / 24); }, { xDomain: [1, 256], yDomain: [0.8, 3.4], color: 'violet', sw: 2.2, xLabel: 'batch size', yLabel: 'speedup', parent: B });
          var one = sp.toPx(1, 1);
          ctx.line(630, one.y, 1030, one.y, { color: 'dim', sw: 1, dash: '4 4', parent: B });
          ctx.text(622, one.y, '1×', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: B });
          ctx.text(590, 792, 'shape only: once decode is compute-bound the verify', { size: 11, font: 'mono', color: 'dim', parent: B });
          ctx.text(590, 810, 'pass costs real FLOPs → shrink k or disable under load', { size: 11, font: 'mono', color: 'dim', parent: B });
          /* C: CUDA graphs */
          var Cg = ctx.group({ parent: G });
          ctx.text(1110, 236, 'CUDA GRAPHS', { size: 14, font: 'display', weight: 700, color: 'white', parent: Cg });
          ctx.text(1110, 272, 'eager: one launch per kernel', { size: 12, font: 'mono', color: 'dim', parent: Cg });
          ctx.text(1110, 302, 'CPU', { size: 11, font: 'mono', color: 'dim', parent: Cg });
          ctx.text(1110, 332, 'GPU', { size: 11, font: 'mono', color: 'dim', parent: Cg });
          var eK = [], gK = [];
          for (var i = 0; i < 17; i++) {
            ctx.rect(1150 + i * 22, 294, 5, 16, { rx: 1, fill: 'red', parent: Cg });
            eK.push(ctx.rect(1156 + i * 22, 324, 13, 16, { rx: 2, fill: ctx.alpha('amber', 0.6), stroke: 'amber', sw: 0.8, parent: Cg }));
          }
          ctx.text(1110, 386, 'graph replay: one launch per step', { size: 12, font: 'mono', color: 'dim', parent: Cg });
          ctx.text(1110, 416, 'CPU', { size: 11, font: 'mono', color: 'dim', parent: Cg });
          ctx.text(1110, 446, 'GPU', { size: 11, font: 'mono', color: 'dim', parent: Cg });
          ctx.rect(1150, 408, 5, 16, { rx: 1, fill: 'red', parent: Cg });
          for (var j = 0; j < 17; j++) gK.push(ctx.rect(1158 + j * 14, 438, 13, 16, { rx: 2, fill: ctx.alpha('amber', 0.6), stroke: 'amber', sw: 0.8, parent: Cg }));
          bracket(ctx, Cg, 1397, 1531, 466, 'idle gaps removed', 'lime', false);
          ctx.para(1110, 520, [
            '~1,000 kernels per decode step',
            '× ~4–6 µs launch ≈ several ms CPU',
            '   on a ~12 ms GPU step',
            'capture per batch bucket:',
            '   1, 2, 4, 8, … 512 → pad up',
            'vLLM V1: piecewise + full graphs',
            'overlap: CPU schedules step t+1',
            '   while the GPU runs step t'
          ], { size: 12, font: 'mono', color: 'text', parent: Cg, lh: 22 });
          [eK, gK].forEach(function (a) { a.forEach(function (e) { e.setAttribute('opacity', 0); }); });
          res.forEach(function (e) { e.setAttribute('opacity', 0); });
          ctx.reveal(A, { from: 'up' });
          ctx.reveal(S.wBars, { from: 'left', delay: 500, stagger: 150 });
          ctx.reveal(B, { from: 'up', delay: 300 });
          ctx.reveal(Cg, { from: 'up', delay: 600 });
          ctx.hud('FP8 KV 2× batch · 3.4 tok/pass · 1 launch');
          return ctx.wait(1200).then(function () {
            return ctx.reveal(drafts, { from: 'left', stagger: 180, dur: 300 });
          }).then(function () {
            return ctx.pulse(ver, { color: 'amber', dur: 600 });
          }).then(function () {
            return ctx.reveal(res, { from: 'up', stagger: 200, dur: 300 });
          }).then(function () {
            ctx.reveal(eK, { stagger: 110, dur: 120 });
            return ctx.reveal(gK, { stagger: 40, dur: 120, delay: 300 });
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Goodput & SLOs',
        say: 'So how do we judge an engine? Not by raw throughput. Push more load and throughput keeps rising, but queues grow, time to first token explodes, and requests start missing their deadlines. Goodput counts only the requests that meet both latency targets, and it peaks well before saturation. Every mechanism in this chamber, from paging and prefix caching to chunking, disaggregation and quantization, moves that peak up and to the right. For our trailer, that is what keeps the agent crew responsive.',
        deep: '<div class="eq">goodput(λ) = λ · P( TTFT ≤ T<sub>1</sub>  ∧  TPOT ≤ T<sub>2</sub> | λ )</div>' +
          '<p>Throughput is monotone in offered load λ until saturation; goodput is not: past the knee the queue grows without bound (an M/G/1-like system with ρ → 1), TTFT tails blow up and every request misses. Capacity planning therefore targets the <b>goodput peak</b>, e.g. p90 TTFT ≤ 1 s and p90 TPOT ≤ 50 ms for interactive agents.</p>' +
          '<p>Autoscaling and admission control use these signals: queue depth, KV-pool utilisation and SLO attainment, not GPU utilisation (a memory-bound decode reads "100 % busy" at low FLOP utilisation).</p>' +
          '<div class="note">For the trailer: every agent call re-sends the same ≈ 8.2k-token system + tools + bible prefix. Prefix-aware routing to a warm replica plus radix caching means only the few hundred new tokens per call are prefilled, so a dozen agents can iterate with sub-second TTFT while the GPU cluster\'s real budget goes to video diffusion.</div>' +
          '<p><span class="muted">The plotted curves are schematic (normalised to the baseline\'s capacity); the right-hand gains are as reported by each paper on its own setup and do not multiply.</span></p>',
        run: function (ctx) {
          var S = ctx.state;
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
          ctx.text(PX + PW, PY + PH + 38, 'offered load (× baseline capacity)', { size: 11.5, font: 'mono', color: 'dim', anchor: 'end', parent: G });
          base.curve.setAttribute('stroke-dasharray', '6 5');
          var cg1 = ctx.plot(PX, PY, PW, PH, g1, Object.assign({}, o, { color: 'red', axes: false }));
          var ct2 = ctx.plot(PX, PY, PW, PH, t2, Object.assign({}, o, { color: ctx.alpha('lime', 0.55), axes: false }));
          ct2.curve.setAttribute('stroke-dasharray', '6 5');
          var cg2 = ctx.plot(PX, PY, PW, PH, g2, Object.assign({}, o, { color: 'lime', axes: false }));
          [0, 1, 2, 3].forEach(function (v) { ctx.text(base.toPx(v, 0).x, PY + PH + 16, v + '×', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: G }); });
          var lg = ctx.group({ parent: G });
          [['throughput · baseline', 'red', true], ['goodput · baseline', 'red', false], ['throughput · full stack', 'lime', true], ['goodput · full stack', 'lime', false]].forEach(function (l, i) {
            var y = 262 + i * 22;
            ctx.line(180, y, 212, y, { color: l[1], sw: 2.4, dash: l[2] ? '6 5' : null, parent: lg });
            ctx.text(220, y, l[0], { size: 11.5, font: 'mono', color: 'text', parent: lg });
          });
          /* peaks */
          function peak(fn) { var bx0 = 0, by = 0; for (var x = 0; x <= 3; x += 0.01) { var y = fn(x); if (y > by) { by = y; bx0 = x; } } return [bx0, by]; }
          var pk1 = peak(g1), pk2 = peak(g2);
          var marks = ctx.group({ parent: G });
          [[pk1, 'red', 1], [pk2, 'lime', 0]].forEach(function (p) {
            var pt = base.toPx(p[0][0], p[0][1]);
            ctx.circle(pt.x, pt.y, 6, { fill: p[1], parent: marks, glow: true });
            if (p[2]) ctx.text(pt.x + 12, pt.y + 20, 'goodput peak ' + p[0][1].toFixed(2), { size: 11.5, font: 'mono', color: p[1], parent: marks });
            else ctx.text(pt.x - 12, pt.y - 14, 'goodput peak ' + p[0][1].toFixed(2), { size: 11.5, font: 'mono', color: p[1], anchor: 'end', parent: marks });
          });
          var fail = base.toPx(1.3, 0.25);
          ctx.text(fail.x, fail.y, 'queues explode → SLOs missed', { size: 11.5, font: 'mono', color: 'red', parent: marks });
          S.gcur = ctx.line(PX, PY, PX, PY + PH, { color: ctx.alpha('white', 0.5), sw: 1, dash: '2 3', parent: G });
          S.gread = ctx.text(PX, 764, '', { size: 12.5, font: 'mono', color: 'white', parent: G });
          /* lever table */
          var TB = ctx.group({ parent: G });
          var cols = [850, 1050, 1300];
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
            if (i > 0) rg.setAttribute('opacity', 0);
          });
          var rows = Array.prototype.slice.call(TB.childNodes, 1);
          var ex = ctx.group({ parent: G });
          ctx.rect(838, 706, 702, 130, { rx: 10, fill: ctx.alpha('magenta', 0.05), stroke: ctx.alpha('magenta', 0.6), sw: 1.2, parent: ex });
          ctx.text(858, 730, 'OUR TRAILER\'S AGENT CREW', { size: 12.5, font: 'display', weight: 700, color: 'magenta', parent: ex });
          ctx.para(858, 756, [
            'every call re-sends the same ≈ 8.2k-token system + tools + bible',
            'prefix → prefix-aware routing + radix cache prefill only the new',
            'few hundred tokens: sub-second TTFT for a dozen iterating agents,',
            'leaving the cluster\'s real GPU budget to video diffusion'
          ], { size: 12, font: 'mono', color: 'text', parent: ex, lh: 20 });
          ctx.reveal(base, { from: 'fade' });
          ctx.reveal([base.curve, cg1.curve, ct2.curve, cg2.curve], { from: 'draw', dur: 1200, delay: 300, stagger: 250 });
          ctx.reveal([lg, marks], { delay: 1300, stagger: 300 });
          ctx.reveal(rows, { from: 'right', delay: 600, stagger: 180 });
          ctx.reveal(ex, { from: 'up', delay: 2200 });
          ctx.hud('size for the goodput peak');
          function setL(x) {
            var p = base.toPx(x, 0).x;
            S.gcur.setAttribute('x1', p); S.gcur.setAttribute('x2', p);
            S.gread.textContent = 'load ' + x.toFixed(2) + '× │ base: thpt ' + t1(x).toFixed(2) + ' good ' + g1(x).toFixed(2) + ' │ full: thpt ' + t2(x).toFixed(2) + ' good ' + g2(x).toFixed(2);
          }
          setL(0);
          return ctx.wait(1800).then(function () { return ctx.tween(4500, function (t) { setL(3 * t); }, 'inOut'); })
            .then(function () { return ctx.tween(900, function (t) { setL(3 - (3 - pk2[0]) * t); }, 'out'); });
        }
      }
    ]
  });
})();
