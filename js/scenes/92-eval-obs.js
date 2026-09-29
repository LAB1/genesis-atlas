/* L2 — Evals & Observability. Video metrics (FVD, CLIPScore, VBench), human preference / Elo, VLM-as-judge
 * calibration, agent trajectory evals, an OpenTelemetry trace waterfall of one trailer job, SLOs / error budgets,
 * cost per finished minute and release regression gates.
 * Beat format: every step is split into beats (say + card + deep + a gated animation segment). */
(function () {
  var RAIL = ['framing', 'FVD · CLIP', 'VBench', 'Elo', 'VLM judge', 'agent evals', 'trace', 'SLOs', 'cost · gates'];

  function hide(list) { [].concat(list).forEach(function (e) { if (e) e.setAttribute('opacity', 0); }); }

  function bench(ctx) {
    var S = ctx.state;
    (S.benchLoops || []).forEach(function (h) { h.stop(); });
    S.benchLoops = [];
    if (S.bench) ctx.remove(S.bench, 350);
    S.bench = ctx.group();
    return S.bench;
  }

  function panel(ctx, g, x, y, w, h, col, title) {
    var r = ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.88)', stroke: ctx.alpha(col, 0.5), sw: 1.2, parent: g });
    if (title) ctx.text(x + 18, y + 24, title, { size: 13, font: 'display', weight: 700, color: col, spacing: 1.2, parent: g });
    return r;
  }

  function rail(ctx, idx) {
    var S = ctx.state, C = ctx.C;
    if (!S.rail) {
      S.rail = ctx.group();
      var ws = RAIL.map(function (s) { return s.length * 7.4 + 26; });
      var total = ws.reduce(function (a, b) { return a + b + 20; }, -20);
      var x = 820 - total / 2;
      ctx.text(x - 14, 868, 'MEASURE', { size: 11, font: 'display', weight: 700, color: 'dim', anchor: 'end', spacing: 1.5, parent: S.rail });
      S.railItems = RAIL.map(function (s, i) {
        var r = ctx.rect(x, 855, ws[i], 26, { rx: 13, fill: ctx.alpha('teal', 0.05), stroke: ctx.alpha('teal', 0.4), sw: 1, parent: S.rail });
        var t = ctx.text(x + ws[i] / 2, 868.5, s, { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.rail });
        if (i < RAIL.length - 1) ctx.line(x + ws[i] + 4, 868, x + ws[i] + 16, 868, { color: 'faint', arrow: true, parent: S.rail });
        x += ws[i] + 20;
        return { r: r, t: t };
      });
      ctx.reveal(S.rail, { from: 'up' });
    }
    S.railItems.forEach(function (it, i) {
      var on = i === idx, past = i < idx;
      it.r.setAttribute('fill', on ? ctx.alpha('teal', 0.3) : ctx.alpha('teal', past ? 0.12 : 0.04));
      it.r.setAttribute('stroke', on ? C.teal : ctx.alpha('teal', 0.4));
      it.t.setAttribute('fill', on ? C.white : (past ? C.text : C.dim));
    });
  }

  function gauss(r) { var u = Math.max(1e-6, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function ranks(a) {
    var idx = a.map(function (v, i) { return [v, i]; }).sort(function (x, y) { return x[0] - y[0]; });
    var r = new Array(a.length);
    for (var i = 0; i < idx.length;) {
      var j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (var k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  }
  function pearson(a, b) {
    var n = a.length, ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var sab = 0, sa = 0, sb = 0;
    for (i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) * (a[i] - ma); sb += (b[i] - mb) * (b[i] - mb); }
    return sab / Math.sqrt(sa * sb);
  }

  Atlas.register({
    id: 'eval-obs',
    refs: [
      'Unterthiner et al., <i>Towards Accurate Generative Models of Video: A New Metric &amp; Challenges</i> (FVD), arXiv 2018 / ICLR-W 2019; Ge et al., <i>On the Content Bias in Fréchet Video Distance</i>, CVPR 2024',
      'Hessel et al., <i>CLIPScore: A Reference-free Evaluation Metric for Image Captioning</i>, EMNLP 2021',
      'Huang et al., <i>VBench: Comprehensive Benchmark Suite for Video Generative Models</i>, CVPR 2024; Zheng et al., <i>VBench-2.0</i>, 2025',
      'Chiang et al., <i>Chatbot Arena: An Open Platform for Evaluating LLMs by Human Preference</i>, ICML 2024',
      'Zheng et al., <i>Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena</i>, NeurIPS 2023',
      'Yao et al., <i>τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains</i> (pass^k), 2024',
      'OpenTelemetry, <i>Semantic Conventions for Generative AI</i> (gen_ai.* spans and metrics), 2024–2025; W3C, <i>Trace Context</i> Recommendation, 2021',
      'Beyer et al., <i>The Site Reliability Workbook</i>, ch. 5 “Alerting on SLOs” (multiwindow burn-rate alerts), O\'Reilly 2018',
      'Deng et al., <i>Improving the Sensitivity of Online Controlled Experiments by Utilizing Pre-Experiment Data</i> (CUPED), WSDM 2013'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Measure everything',
        beats: [
          {
            say: 'Two questions hang over every trailer the system makes. Is it good? And is the system working?',
            card: { tag: 'KEY IDEA', title: 'Two questions, two planes', body: 'Evaluation asks whether the output is good. Observability asks whether the system that made it is healthy, fast and affordable.' },
            deep: '<p>Two measurement planes, different consumers:</p>' +
              '<table><tr><th></th><th>Evaluation</th><th>Observability</th></tr>' +
              '<tr><td>Question</td><td>is the output good?</td><td>is the system healthy, fast, affordable?</td></tr>' +
              '<tr><td>Unit</td><td>clip, trailer, trajectory</td><td>span, time series, log event</td></tr>' +
              '<tr><td>Cadence</td><td>per checkpoint or release; online per job</td><td>continuous, per request</td></tr>' +
              '<tr><td>Failure</td><td>regression in quality or safety</td><td>latency, errors, cost drift</td></tr></table>'
          },
          {
            say: 'Evaluation answers the first with a pyramid of evidence: cheap automatic metrics at the base, model judges in the middle, and expensive human preference at the top, which calibrates everything below it.',
            card: { tag: 'HOW IT WORKS', title: 'A pyramid of evidence', body: 'Volume shrinks and validity grows as you climb: millions of automatic scores, thousands of judge calls, hundreds of human votes.' },
            deep: '<p><b>Automatic metrics</b> (FVD, CLIPScore, VBench) scale to millions of samples but are proxies. <b>VLM judges</b> scale to thousands and read rubrics, but inherit biases. <b>Human pairwise preference</b> is the ground truth that calibrates both, at dollars per judgement.</p>' +
              '<div class="note">Goodhart\'s law applies with full force: any single metric optimised directly (subject consistency, say) gets gamed, and a static video maximises it. Keep a <b>portfolio</b> of metrics with known trade-offs, and anchor them to humans.</div>'
          },
          {
            say: 'Observability answers the second with traces, metrics and logs, all tied together by one trace identifier.',
            card: { tag: 'HOW IT WORKS', title: 'Three signals, one trace id', body: 'Traces show where the time went, metrics show fleet health over time, and logs show what exactly happened. A shared trace_id joins them.' },
            deep: '<p>OpenTelemetry standardises the three signals and the <b>correlation</b> between them. A <b>trace</b> is a tree of spans; <b>metrics</b> are aggregated time series (histograms for latency, gauges for utilisation); <b>logs</b> are structured events that carry <code>trace_id</code> and <code>span_id</code>.</p>' +
              '<p>Correlation is what makes them useful together: a latency alert links to exemplar traces, and a trace links to the logs emitted inside its spans.</p>'
          },
          {
            say: 'And there is a fourth signal that engineers forget until the invoice arrives: cost per finished minute of video.',
            card: { tag: 'WHY IT MATTERS', title: 'Cost is a first-class signal', body: 'A model that is ten percent better but twice as expensive may be a regression. Track dollars per delivered minute next to quality.' },
            deep: '<p>Cost needs the same plumbing as latency: every span carries <code>gpu_seconds</code> and token counts, and they roll up per job, per agent and per customer. That is what makes <b>unit economics</b> (dollars per <i>delivered</i> minute) computable, and what turns an optimisation debate into a measurement.</p>' +
              '<p>The last two steps of this chamber close the loop: cost accounting and the release gates that keep quality, latency and cost from regressing together.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          rail(ctx, 0);
          var g = bench(ctx);
          var job = ctx.node({ x: 800, y: 250, w: 340, h: 74, title: 'Trailer job 7f3a', sub: '6 shots · 30 s · 212 spans', icon: 'film', color: 'lime', titleSize: 18, subSize: 12, parent: g });
          var strip = ctx.group({ parent: g });
          for (var i = 0; i < 6; i++) {
            ctx.rect(652 + i * 50, 314, 44, 32, { rx: 4, fill: ctx.alpha(i % 2 ? 'cyan' : 'lime', 0.15), stroke: ctx.alpha(i % 2 ? 'cyan' : 'lime', 0.5), sw: 1, parent: strip });
            ctx.text(674 + i * 50, 330, 'S' + (i + 1), { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: strip });
          }
          var hE = ctx.text(60, 410, 'EVALUATION — is it good?', { size: 17, font: 'display', weight: 700, color: 'teal', parent: g });
          var hO = ctx.text(1560, 410, 'OBSERVABILITY — is it working?', { size: 17, font: 'display', weight: 700, color: 'cyan', anchor: 'end', parent: g });
          /* pyramid */
          var ax = 250, ay = 460, by = 800, hw = 210;
          function hwAt(y) { return hw * (y - ay) / (by - ay); }
          var BANDS = [[ay, 570, 'amber', 'human pairwise · Elo', '$$$ per label · ground truth'], [570, 690, 'magenta', 'VLM judge · rubric', 'scalable · must be calibrated'], [690, by, 'teal', 'FVD · CLIPScore · VBench', 'cheap · proxy validity']];
          var pyr = BANDS.map(function (b) {
            var bg = ctx.group({ parent: g, opacity: 0 });
            ctx.poly([[ax - hwAt(b[0]), b[0]], [ax + hwAt(b[0]), b[0]], [ax + hwAt(b[1]), b[1]], [ax - hwAt(b[1]), b[1]]], { fill: ctx.alpha(b[2], 0.2), stroke: b[2], sw: 1.4, parent: bg });
            var ym = (b[0] + b[1]) / 2 + 12;
            ctx.line(ax + hwAt(ym) + 8, ym, 488, ym, { color: ctx.alpha(b[2], 0.6), dash: '3 3', parent: bg });
            ctx.text(496, ym - 10, b[3], { size: 14, font: 'display', weight: 600, color: 'white', parent: bg });
            ctx.text(496, ym + 10, b[4], { size: 12, font: 'mono', color: b[2], parent: bg });
            return bg;
          });
          /* triad */
          var TR = [['Traces', 'where did the time go', 'clock', 'cyan', 1100, 510], ['Metrics', 'is the fleet healthy', 'chart', 'amber', 1420, 510],
            ['Logs', 'what exactly happened', 'doc', 'violet', 1100, 700], ['Cost', '$ per finished minute', 'bolt', 'lime', 1420, 700]];
          var tri = TR.map(function (t) { return ctx.node({ x: t[4], y: t[5], w: 280, h: 64, title: t[0], sub: t[1], icon: t[2], color: t[3], titleSize: 16, subSize: 12, parent: g, opacity: 0 }); });
          var otel = ctx.label(1260, 605, 'OpenTelemetry · one trace_id', { color: 'cyan', size: 12, parent: g, opacity: 0 });
          var l1 = ctx.link(job, { x: ax, y: ay - 6 }, { color: 'teal', from: 'l', parent: g, opacity: 0 });
          var l2 = ctx.link(job, { x: 1260, y: 450 }, { color: 'cyan', from: 'r', parent: g, opacity: 0 });
          var cnote = ctx.label(1420, 770, '× GPU-seconds + tokens per span', { color: 'lime', size: 11, parent: g, opacity: 0 });
          ctx.hud('quality signals + operational signals');
          /* beat 0: one job, two questions */
          return Promise.all([ctx.reveal(job, { from: 'scale' }), ctx.reveal(strip, { from: 'up', delay: 200 }), ctx.reveal([hE, hO], { delay: 500, stagger: 150 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the evidence pyramid, built from the base up */
            return Promise.all([ctx.reveal(pyr.slice().reverse(), { from: 'up', stagger: 180 }), ctx.reveal(l1, { from: 'draw', delay: 400 })]).then(function () {
              return ctx.packet(l1, { color: 'teal', dur: 900, label: 'clips' });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: traces, metrics, logs */
            return Promise.all([ctx.reveal(tri.slice(0, 3), { from: 'right', stagger: 120 }), ctx.reveal(otel, { delay: 500 }), ctx.reveal(l2, { from: 'draw', delay: 200 })]).then(function () {
              return ctx.packet(l2, { color: 'cyan', dur: 900, label: 'spans' });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: cost, the fourth signal */
            ctx.hud('$ per delivered minute · the fourth signal');
            return Promise.all([ctx.reveal(tri[3], { from: 'right' }), ctx.reveal(cnote, { delay: 400 })]).then(function () {
              return ctx.pulse(tri[3], { color: 'lime', times: 2, dur: 600 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'FVD & CLIPScore',
        beats: [
          {
            say: 'The classic automatic metrics. Fréchet Video Distance embeds real and generated clips with a video classifier, and fits a Gaussian to each cloud of features.',
            card: { tag: 'KEY IDEA', title: 'Compare clouds, not clips', body: 'FVD never looks at a single clip. It compares the whole distribution of generated clips with the distribution of real ones.' },
            deep: '<p><b>FVD</b>: features φ from an I3D network (Kinetics-400) on 16-frame clips, a 400-dimensional vector per clip. Fit N(μ<sub>r</sub>, Σ<sub>r</sub>) to the real clips and N(μ<sub>g</sub>, Σ<sub>g</sub>) to the generated ones.</p>' +
              '<p>The picture is a 2-D projection: each dot is one clip, each ellipse a two-standard-deviation contour of the fitted Gaussian, and the coloured centres are the means μ. A good generator puts its cloud on top of the real one.</p>'
          },
          {
            say: 'It then measures the distance between the two Gaussians. Watch the generated cloud slide toward the real one as the model improves, and the score fall.',
            card: { tag: 'NUMBERS', title: 'A falling score', stat: { v: '412 → 186', l: 'FVD as the generator improves; lower is better (illustrative)' },
              more: '<p>Computing it: stack the 400-d features of N clips into a matrix, take the sample mean and covariance for each side, and evaluate the closed form. The matrix square root (Σ<sub>r</sub>Σ<sub>g</sub>)<sup>½</sup> is the expensive part (an eigendecomposition of a 400×400 matrix) and is numerically fragile when N is close to 400, another reason to use thousands of clips.</p>' },
            deep: '<div class="eq">FVD = ‖μ<sub>r</sub> − μ<sub>g</sub>‖² + Tr(Σ<sub>r</sub> + Σ<sub>g</sub> − 2(Σ<sub>r</sub>Σ<sub>g</sub>)<sup>½</sup>)</div>' +
              '<p>This is the squared Wasserstein-2 distance between the two Gaussians. The first term measures how far the centres are; the trace term measures how different the shapes (covariances) are. As the generated cloud moves and reshapes to match the real one, both terms fall.</p>'
          },
          {
            say: 'But FVD needs thousands of clips per side and is biased at small sample sizes, and its features are dominated by appearance rather than motion.',
            card: { tag: 'PITFALL', title: 'FVD barely sees motion', body: 'I3D features are dominated by per-frame appearance, so broken motion is barely penalised. Compare models only at equal sample size.' },
            deep: '<ul><li>Needs thousands of clips per side (Σ is 400×400) and is <b>biased upward at small N</b>. Always compare at equal N.</li>' +
              '<li><b>Content bias</b> (Ge et al., CVPR 2024): I3D features encode appearance far more than dynamics, so FVD barely penalises broken motion. Features from self-supervised video models (VideoMAE-style) reduce the bias.</li>' +
              '<li>It is a distribution-level score: it says nothing about <i>this</i> trailer.</li></ul>'
          },
          {
            say: 'CLIPScore instead asks whether each frame matches the prompt, using the cosine similarity between image and text embeddings.',
            card: { tag: 'HOW IT WORKS', title: 'Cosine in a joint space', body: 'CLIP maps frames and prompts into one 512-dimensional space. The cosine between them, times two point five, is the per-frame score.' },
            deep: '<p><b>CLIPScore</b> (Hessel et al.; CLIP ViT-B/32, 512-d joint space): per frame,</p>' +
              '<div class="eq">CLIP-S = w · max( cos(E<sub>I</sub>(frame), E<sub>T</sub>(prompt)), 0 ), &nbsp; w = 2.5</div>' +
              '<p>averaged over frames. Video papers often swap in ViT-L/14 or ViCLIP, and scores are only comparable within one backbone. A typical matched frame–caption pair has cosine ≈ 0.3.</p>'
          },
          {
            say: 'It is reference free and per sample, but CLIP is a bag of concepts, weak on counting, negation and temporal order. Both metrics are useful, and both are blind in important ways.',
            card: { tag: 'NUMBERS', title: 'Six shots, one score', stat: { v: '74.6', l: 'CLIPScore × 100 for our six shots: mean cosine 0.298 × 2.5' } },
            deep: '<ul><li>Reference-free and per-sample, but CLIP is bag-of-concepts: weak on counting, spatial relations, negation and <i>temporal order</i> (crash-lands then walks, versus the reverse).</li>' +
              '<li>It saturates: modern generators all score within a narrow band, so it separates bad from good, not good from great.</li></ul>' +
              '<div class="note">Use FVD and CLIPScore as cheap regression tripwires on large sets; decide with VBench-style dimensions, judges and humans.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 1);
          var g = bench(ctx);
          var L = ctx.group({ parent: g });
          panel(ctx, L, 40, 190, 740, 640, 'teal', 'FRÉCHET VIDEO DISTANCE · I3D feature space (2-D projection)');
          var rn = ctx.rng(17);
          var real = [], gen = [];
          for (var i = 0; i < 44; i++) { real.push([gauss(rn), gauss(rn)]); gen.push([gauss(rn), gauss(rn)]); }
          function xf(p, m) { var c = Math.cos(m.r), s = Math.sin(m.r); var x = p[0] * m.sx, y = p[1] * m.sy; return [m.x + x * c - y * s, m.y + x * s + y * c]; }
          var MR = { x: 360, y: 480, sx: 100, sy: 52, r: 0.35 };
          var G0 = { x: 530, y: 400, sx: 118, sy: 40, r: -0.2 }, G1 = { x: 385, y: 468, sx: 104, sy: 50, r: 0.3 };
          real.forEach(function (p) { var q = xf(p, MR); ctx.circle(q[0], q[1], 3.5, { fill: ctx.alpha('cyan', 0.8), parent: L }); });
          var gd = gen.map(function (p) { var q = xf(p, G0); return ctx.circle(q[0], q[1], 3.5, { fill: ctx.alpha('lime', 0.85), parent: L }); });
          function ell(m, col) { return ctx.el('ellipse', { cx: m.x, cy: m.y, rx: 2 * m.sx, ry: 2 * m.sy, transform: 'rotate(' + (m.r * 180 / Math.PI) + ' ' + m.x + ' ' + m.y + ')', fill: 'none', stroke: col, 'stroke-width': 1.6, 'stroke-dasharray': '5 4' }, L); }
          ell(MR, C.cyan);
          var ge = ell(G0, C.lime);
          ctx.circle(MR.x, MR.y, 6, { fill: 'cyan', glow: true, parent: L });
          var mg = ctx.circle(G0.x, G0.y, 6, { fill: 'lime', glow: true, parent: L });
          ctx.text(90, 250, '● real clips (N(μ_r, Σ_r))', { size: 13, font: 'mono', color: 'cyan', parent: L });
          ctx.text(90, 274, '● generated (N(μ_g, Σ_g))', { size: 13, font: 'mono', color: 'lime', parent: L });
          /* beat 1 material: the distance and the formula */
          var L1 = ctx.group({ parent: L, opacity: 0 });
          var dl = ctx.line(MR.x, MR.y, G0.x, G0.y, { color: 'white', sw: 1.4, dash: '3 3', parent: L1 });
          ctx.text(610, 262, 'FVD', { size: 14, font: 'mono', color: 'dim', parent: L1 });
          var fv = ctx.text(660, 262, '412', { size: 26, font: 'mono', weight: 700, color: 'white', parent: L1 });
          ctx.text(410, 690, 'FVD = ‖μr − μg‖² + Tr(Σr + Σg − 2(ΣrΣg)^½)', { size: 16, font: 'mono', color: 'white', anchor: 'middle', parent: L1 });
          /* beat 2 material: the caveats */
          var L2 = ctx.group({ parent: L, opacity: 0 });
          ctx.para(66, 736, ['needs ≳ 2k clips per side · biased at small N', 'content-biased: appearance ≫ motion (I3D features)'], { size: 12, font: 'mono', color: 'amber', lh: 22, parent: L2 });
          /* CLIPScore */
          var R = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, R, 820, 190, 740, 640, 'violet', 'CLIPScore · does each frame match the prompt?');
          var fr = ctx.node({ x: 940, y: 280, w: 170, h: 50, title: 'frame t', sub: 'shot 3', icon: 'image', color: 'lime', titleSize: 14, subSize: 11, parent: R });
          var pr = ctx.node({ x: 940, y: 370, w: 170, h: 50, title: 'prompt', sub: 'fox astronaut…', icon: 'doc', color: 'cyan', titleSize: 14, subSize: 11, parent: R });
          var ie = ctx.node({ x: 1160, y: 280, w: 170, h: 50, title: 'CLIP image', sub: 'E_I · 512-d', color: 'violet', titleSize: 14, subSize: 11, parent: R });
          var te = ctx.node({ x: 1160, y: 370, w: 170, h: 50, title: 'CLIP text', sub: 'E_T · 512-d', color: 'violet', titleSize: 14, subSize: 11, parent: R });
          var cs = ctx.node({ x: 1400, y: 325, w: 180, h: 60, title: 'cos(E_I, E_T)', sub: '× 2.5, clip at 0', color: 'amber', titleSize: 14, subSize: 11, parent: R });
          var cl = [ctx.link(fr, ie, { color: 'violet', parent: R }), ctx.link(pr, te, { color: 'violet', parent: R }), ctx.link(ie, cs, { color: 'amber', parent: R }), ctx.link(te, cs, { color: 'amber', parent: R })];
          var COS = [0.31, 0.30, 0.27, 0.32, 0.30, 0.29];
          ctx.text(860, 452, 'mean cosine per shot', { size: 12, font: 'mono', color: 'dim', parent: R });
          var bars = ctx.bars(880, 470, 560, 170, COS.map(function () { return 0; }), { color: 'violet', labels: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], gap: 30, labelSize: 12, parent: R });
          var mean = COS.reduce(function (a, b) { return a + b; }, 0) / 6;
          var cst = ctx.text(880, 690, '', { size: 16, font: 'mono', weight: 700, color: 'white', parent: R });
          var R2 = ctx.group({ parent: R, opacity: 0 });
          ctx.para(846, 736, ['bag-of-concepts: weak on counting, relations,', 'negation and temporal order · saturates'], { size: 12, font: 'mono', color: 'amber', lh: 22, parent: R2 });
          ctx.hud('FVD: distance between two feature clouds');
          /* beat 0: two clouds of clip features */
          return ctx.reveal(L, { from: 'left' }).then(function () {
            return Promise.all([ctx.pulse(mg, { color: 'lime', dur: 700 })]);
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the distance shrinks as the generator improves */
            ctx.hud('FVD 412 → 186 as the model improves');
            return ctx.reveal(L1, { from: 'up' }).then(function () {
              return ctx.tween(2600, function (t) {
                var m = { x: ctx.lerp(G0.x, G1.x, t), y: ctx.lerp(G0.y, G1.y, t), sx: ctx.lerp(G0.sx, G1.sx, t), sy: ctx.lerp(G0.sy, G1.sy, t), r: ctx.lerp(G0.r, G1.r, t) };
                gen.forEach(function (p, i) { var q = xf(p, m); gd[i].setAttribute('cx', q[0]); gd[i].setAttribute('cy', q[1]); });
                ge.setAttribute('cx', m.x); ge.setAttribute('cy', m.y); ge.setAttribute('rx', 2 * m.sx); ge.setAttribute('ry', 2 * m.sy);
                ge.setAttribute('transform', 'rotate(' + (m.r * 180 / Math.PI) + ' ' + m.x + ' ' + m.y + ')');
                mg.setAttribute('cx', m.x); mg.setAttribute('cy', m.y);
                dl.setAttribute('x2', m.x); dl.setAttribute('y2', m.y);
                fv.textContent = String(Math.round(412 - 226 * t));
              }, 'inOut');
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: what FVD cannot see */
            return ctx.reveal(L2, { from: 'up' }).then(function () { return ctx.pulse(L2, { color: 'amber', dur: 700 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: CLIPScore, a per-frame cosine */
            ctx.hud('CLIPScore = 2.5 × cos(image, prompt)');
            return Promise.all([ctx.reveal(R, { from: 'right' })]).then(function () {
              return Promise.all([ctx.packet(cl[0], { color: 'violet', dur: 600 }), ctx.packet(cl[1], { color: 'violet', dur: 600 })]);
            }).then(function () {
              return Promise.all([ctx.packet(cl[2], { color: 'amber', dur: 600 }), ctx.packet(cl[3], { color: 'amber', dur: 600 })]);
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: per-shot scores, and where CLIP goes blind */
            return bars.update(COS.map(function (v) { return v / 0.4; }), 800).then(function () {
              return Promise.all([ctx.typeText(cst, 'CLIPScore = 2.5 × ' + mean.toFixed(3) + ' = ' + (2.5 * mean * 100).toFixed(1) + ' (×100)', 900), ctx.reveal(R2, { from: 'up', delay: 300 })]);
            });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'VBench dimensions',
        beats: [
          {
            say: 'VBench breaks video quality into sixteen dimensions, each measured by a specialised model. Eight of them are drawn here for our first model, one spoke per dimension.',
            card: { tag: 'NUMBERS', title: 'Sixteen ways to be good', stat: { v: '16', u: 'dimensions', l: 'each with its own evaluator model and prompt suite (VBench, CVPR 2024)' } },
            deep: '<p>VBench (Huang et al., CVPR 2024) splits quality into two groups: <b>video quality</b> (consistency, smoothness, dynamics, aesthetics, imaging quality) and <b>video–condition consistency</b> (does it follow the prompt: objects, actions, colour, spatial relations, scene, style).</p>' +
              '<p>Each dimension has a dedicated evaluator and a hand-built prompt suite, so scores answer narrow, checkable questions rather than one vague notion of quality.</p>'
          },
          {
            say: 'Subject consistency compares DINO features of the fox across frames, and background consistency does the same with CLIP. Motion smoothness asks whether a frame interpolation model could have predicted the middle frames.',
            card: { tag: 'HOW IT WORKS', title: 'A specialist model per dimension', body: 'Each dimension borrows the model that is best at exactly one question: DINO for identity, CLIP for scene, AMT for smoothness.' },
            deep: '<table><tr><th>Dimension</th><th>Measured by</th></tr>' +
              '<tr><td>Subject consistency</td><td>DINO feature cosine, frame vs first and previous frame</td></tr>' +
              '<tr><td>Background consistency</td><td>CLIP image features across frames</td></tr>' +
              '<tr><td>Motion smoothness</td><td>AMT frame-interpolation prior: reconstruct dropped frames</td></tr></table>' +
              '<p>Smoothness works because a physically plausible clip is <i>predictable</i>: if an interpolator can rebuild frame t from t−1 and t+1, motion was smooth.</p>'
          },
          {
            say: 'Dynamic degree measures optical flow, aesthetic quality uses a learned aesthetic predictor, and imaging quality a no reference quality model.',
            card: { tag: 'STATE OF THE ART', title: 'VBench-2.0 checks faithfulness', body: 'The 2025 successor goes beyond visual quality to physics, commonsense, controllability and human fidelity, using VLM and LLM based checks.' },
            deep: '<table><tr><th>Dimension</th><th>Measured by</th></tr>' +
              '<tr><td>Temporal flickering</td><td>mean abs. pixel difference on static scenes</td></tr>' +
              '<tr><td>Dynamic degree</td><td>RAFT optical flow magnitude, as the fraction of dynamic videos</td></tr>' +
              '<tr><td>Aesthetic quality</td><td>LAION aesthetic predictor on CLIP features</td></tr>' +
              '<tr><td>Imaging quality</td><td>MUSIQ (no-reference IQA)</td></tr>' +
              '<tr><td>Overall consistency</td><td>ViCLIP video–text similarity</td></tr></table>' +
              '<p>Plus object class, multiple objects, human action, colour, spatial relationship, scene, appearance and temporal style. <b>VBench-2.0</b> (2025) adds <i>intrinsic faithfulness</i>.</p>'
          },
          {
            say: 'Now the second model. Notice the trade-off: it moves much more, and pays slightly in consistency and smoothness.',
            card: { tag: 'TRADE-OFF', title: 'Motion costs consistency', body: 'Dynamic degree rises by 0.31 while subject consistency slips by 0.011. No single average shows this; the vector does.' },
            deep: '<p><b>Anti-correlated dimensions</b>: dynamic degree trades against subject and background consistency and against smoothness, because more motion gives every consistency metric more to disagree about.</p>' +
              '<p>Read the radar and the table together. v2 wins on dynamics, aesthetics, imaging and overall consistency, and gives back about a hundredth on three consistency dimensions. Whether that is a good trade depends on the product: trailers want motion.</p>'
          },
          {
            say: 'A frozen video would ace consistency, which is why you report the whole vector, never one average, and gate releases with a margin per dimension.',
            card: { tag: 'PITFALL', title: 'Goodhart: a still image wins', body: 'Optimise one metric and the model learns to game it. A frozen video maximises consistency and flicker scores.' },
            deep: '<p>The gray outline is a frozen video: perfect subject and background consistency, perfect smoothness, zero dynamic degree. It beats both models on four axes and is useless as a trailer.</p>' +
              '<div class="note">Report the vector, never one average, and set per-dimension <b>non-inferiority margins</b> in release gates: a candidate may not lose more than δ<sub>d</sub> on any dimension, and must win where the release is meant to help.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 2);
          var g = bench(ctx);
          var D = ['subject cons.', 'background cons.', 'motion smooth.', 'dynamic degree', 'aesthetic', 'imaging', 'flicker (inv.)', 'overall cons.'];
          var A = [0.86, 0.84, 0.90, 0.40, 0.62, 0.70, 0.88, 0.60], B = [0.80, 0.82, 0.85, 0.82, 0.71, 0.75, 0.83, 0.68];
          var ST = [0.99, 0.99, 0.99, 0.02, 0.35, 0.55, 0.99, 0.30];
          var cx = 400, cy = 496, R = 220, n = D.length;
          function pt(i, v) { var a = 2 * Math.PI * i / n; return [cx + R * v * Math.sin(a), cy - R * v * Math.cos(a)]; }
          var web = ctx.group({ parent: g });
          [0.25, 0.5, 0.75, 1].forEach(function (k) {
            ctx.poly(D.map(function (d, i) { return pt(i, k); }), { stroke: ctx.alpha('white', k === 1 ? 0.25 : 0.1), sw: 1, parent: web });
          });
          D.forEach(function (d, i) {
            var p = pt(i, 1), q = pt(i, 1.14);
            ctx.line(cx, cy, p[0], p[1], { color: ctx.alpha('white', 0.1), parent: web });
            var anc = Math.abs(q[0] - cx) < 10 ? 'middle' : (q[0] > cx ? 'start' : 'end');
            ctx.text(q[0], q[1], d, { size: 13, font: 'mono', color: i === 3 ? 'amber' : 'text', anchor: anc, parent: web });
          });
          var pa = ctx.poly(D.map(function (d, i) { return pt(i, A[i]); }), { fill: ctx.alpha('cyan', 0.18), stroke: 'cyan', sw: 2, parent: g });
          var pb = ctx.poly(D.map(function (d, i) { return pt(i, A[i]); }), { fill: ctx.alpha('lime', 0.18), stroke: 'lime', sw: 2, parent: g });
          pb.setAttribute('opacity', 0);
          var ps = ctx.poly(D.map(function (d, i) { return pt(i, ST[i]); }), { stroke: 'dim', sw: 1.6, parent: g });
          ps.setAttribute('stroke-dasharray', '6 5'); ps.setAttribute('opacity', 0);
          ctx.text(90, 800, '— v1 (cyan)   — v2 (lime)   radar axes rescaled per dimension for display', { size: 12, font: 'mono', color: 'dim', parent: g });
          var stl = ctx.text(90, 824, '- - frozen video (gray): perfect consistency, zero motion', { size: 12, font: 'mono', color: 'dim', parent: g, opacity: 0 });
          /* raw table */
          var T = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, T, 800, 190, 760, 600, 'teal', 'RAW SCORES (VBench-style, illustrative)');
          var ROWS = [['subject consistency', 'DINO cos', 0.962, 0.951], ['background consistency', 'CLIP cos', 0.968, 0.964], ['motion smoothness', 'AMT interp.', 0.989, 0.984],
            ['dynamic degree', 'RAFT flow', 0.41, 0.72], ['aesthetic quality', 'LAION pred.', 0.58, 0.62], ['imaging quality', 'MUSIQ', 0.66, 0.69], ['temporal flickering', 'pixel diff', 0.975, 0.968], ['overall consistency', 'ViCLIP', 0.262, 0.279]];
          ctx.text(830, 244, 'dimension', { size: 12, font: 'mono', color: 'dim', parent: T });
          ctx.text(1130, 244, 'evaluator', { size: 12, font: 'mono', color: 'dim', parent: T });
          ctx.text(1370, 244, 'v1', { size: 12, font: 'mono', color: 'cyan', anchor: 'end', parent: T });
          var hc = ctx.group({ parent: T, opacity: 0 });
          ctx.text(1460, 244, 'v2', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: hc });
          ctx.text(1540, 244, 'Δ', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: hc });
          var cmp = [];
          var rows = ROWS.map(function (r, i) {
            var rg = ctx.group({ parent: T, opacity: 0 });
            var y = 280 + i * 52;
            if (i === 3) ctx.rect(816, y - 20, 728, 40, { rx: 6, fill: ctx.alpha('amber', 0.1), stroke: ctx.alpha('amber', 0.5), sw: 1, parent: rg });
            ctx.text(830, y, r[0], { size: 13, font: 'mono', color: 'white', parent: rg });
            ctx.text(1130, y, r[1], { size: 12, font: 'mono', color: 'teal', parent: rg });
            ctx.text(1370, y, r[2].toFixed(3), { size: 13, font: 'mono', color: 'cyan', anchor: 'end', parent: rg });
            var cg = ctx.group({ parent: rg, opacity: 0 });
            ctx.text(1460, y, r[3].toFixed(3), { size: 13, font: 'mono', color: 'lime', anchor: 'end', parent: cg });
            var d = r[3] - r[2];
            ctx.text(1540, y, (d >= 0 ? '+' : '') + d.toFixed(3), { size: 13, font: 'mono', color: d >= 0 ? 'lime' : 'red', anchor: 'end', parent: cg });
            cmp.push(cg);
            return rg;
          });
          ctx.text(830, 740, '8 of 16 dims shown · dynamic ↑ trades against consistency ↓', { size: 12, font: 'mono', color: 'amber', parent: T });
          ctx.hud('VBench: 16 dimensions, one evaluator each');
          /* beat 0: eight of sixteen dimensions, drawn for model v1 */
          return Promise.all([ctx.reveal(web, { from: 'scale', s0: 0.9 }), ctx.reveal(pa, { from: 'scale', s0: 0.3, delay: 300 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: consistency and smoothness evaluators */
            return Promise.all([ctx.reveal(T, { from: 'right' }), ctx.reveal(rows.slice(0, 3), { from: 'left', stagger: 120, delay: 300 })]);
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: motion, aesthetics and imaging evaluators */
            return ctx.reveal(rows.slice(3), { from: 'left', stagger: 100 });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: model v2 moves more and pays in consistency */
            ctx.hud('v2: dynamic degree +0.31 · subject cons. −0.011');
            pb.setAttribute('opacity', 1);
            return Promise.all([ctx.reveal([hc].concat(cmp), { stagger: 90, dur: 400 }), ctx.tween(1600, function (t) {
              pb.setAttribute('points', D.map(function (d, i) { var p = pt(i, ctx.lerp(A[i], B[i], t)); return p[0] + ',' + p[1]; }).join(' '));
            }, 'inOut')]).then(function () {
              return ctx.pulse(rows[3], { color: 'amber', dur: 700 });
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: a frozen video would win the consistency axes */
            ctx.hud('a frozen video wins consistency, loses motion');
            return Promise.all([ctx.reveal(ps, { from: 'scale', s0: 0.8, dur: 800 }), ctx.reveal(stl, { from: 'up', delay: 300 })]).then(function () {
              return ctx.pulse(ps, { color: 'white', dur: 800 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Human preference & Elo',
        beats: [
          {
            say: 'The ground truth is people. Raters see two clips for the same prompt, side by side in random order, and pick the better one.',
            card: { tag: 'KEY IDEA', title: 'Pairwise beats absolute scores', body: 'People are unreliable at rating on a scale but reliable at choosing between two. Same prompt, random order, model names hidden.' },
            deep: '<p><b>Protocol</b>: the same prompt for both clips, randomised left and right, blind to the model, ties allowed, and attention checks to catch inattentive raters. Stratify prompts (motion, faces, text, physics) so a model cannot win on an easy slice.</p>' +
              '<p>Pairwise judgements are easier and more consistent than absolute ratings: two raters rarely agree that a clip is a 4, but often agree that A beats B.</p>'
          },
          {
            say: 'Thousands of these pairwise votes are turned into ratings with the Elo or Bradley Terry model, where the rating gap predicts the win probability.',
            card: { tag: 'NUMBERS', title: 'A gap is a win rate', stat: { v: '64%', l: 'win probability for a 100 point Elo gap; 40 points is 56 percent' } },
            deep: '<p><b>Bradley–Terry</b>: each model i has a strength β<sub>i</sub>; in Elo units R = 400·β / ln 10, so</p>' +
              '<div class="eq">P(i ≻ j) = 1 / (1 + 10<sup>(R<sub>j</sub> − R<sub>i</sub>)/400</sup>)</div>' +
              '<p><b>Online Elo</b> updates after each vote with S ∈ {0, ½, 1}:</p>' +
              '<div class="eq">R<sub>i</sub> ← R<sub>i</sub> + K · (S − P(i ≻ j))</div>'
          },
          {
            say: 'Watch four models start level and separate as votes accumulate. Each curve is a maximum likelihood refit of the ratings, repeated every hundred votes.',
            card: { tag: 'HOW IT WORKS', title: 'Refit, do not just update', body: 'Online Elo depends on vote order. Arenas fit Bradley-Terry by maximum likelihood over all votes, so the ranking cannot depend on when a vote arrived.' },
            deep: '<p>Chatbot Arena and video arenas fit BT by <b>maximum likelihood</b> over all votes. The classic minorisation–maximisation update p<sub>a</sub> ← W<sub>a</sub> / Σ<sub>b</sub> (n<sub>ab</sub> / (p<sub>a</sub> + p<sub>b</sub>)) converges to the MLE; ratings are then centred, since only differences are identified.</p>' +
              '<p>The plot refits every 100 votes from simulated wins, with true strengths of 1130, 1065, 1000 and 955. Early curves are noisy and tightly coupled; they fan out as evidence accumulates.</p>'
          },
          {
            say: 'The confidence intervals matter: two models forty points apart are clearly different, but two that overlap are statistically tied.',
            card: { tag: 'NUMBERS', title: 'How sure is the ranking', stat: { v: '± 15', u: 'Elo', l: '95 percent interval after 4,000 votes across four models (about 2,000 per model)' },
              more: '<p>For comparisons near 50/50 each vote carries Fisher information 1/4 about β, so SE(β) ≈ 2/√n and SE(R) = (400/ln 10) · 2/√n ≈ 347/√n. With n ≈ 2,000 per model, SE ≈ 7.8 and the 95% interval is about ±15 Elo. Halving the interval needs four times the votes.</p>' },
            deep: '<p>Report <b>bootstrap confidence intervals</b> on the leaderboard, not point ratings. Two models whose intervals overlap are statistically tied, and a tie is a legitimate result: it says the votes cannot yet separate them.</p>' +
              '<div class="note">A 100-point gap ≈ 64% win rate; 40 points ≈ 56%. Detecting a 40-point gap at ±15 needs a couple of thousand votes per model.</div>'
          },
          {
            say: 'Protocol matters as much as the math. Randomise the sides, ask separately about adherence, quality and motion, and control for style confounds such as brightness and clip length.',
            card: { tag: 'PITFALL', title: 'Raters love bright, long clips', body: 'Uncontrolled style confounds inflate the wrong models. Add covariates such as duration and brightness to the Bradley-Terry fit.' },
            deep: '<ul><li><b>Multi-axis</b>: ask separately for prompt adherence, visual quality and motion. One overall vote hides trade-offs, such as a model that looks better but ignores the prompt.</li>' +
              '<li><b>Style confounds</b>: longer, brighter, more saturated clips win regardless of quality. Control with covariates in the BT model, or match duration and normalise brightness.</li>' +
              '<li><b>Rater quality</b>: attention checks and gold pairs; weight or drop raters below a consistency threshold.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 3);
          var g = bench(ctx);
          /* voting UI */
          var V = ctx.group({ parent: g });
          panel(ctx, V, 40, 190, 700, 330, 'amber', 'PAIRWISE VOTE · same prompt, random order, blind');
          var cardA = ctx.rect(70, 236, 300, 200, { rx: 8, fill: ctx.alpha('lime', 0.08), stroke: ctx.alpha('lime', 0.5), parent: V });
          ctx.rect(410, 236, 300, 200, { rx: 8, fill: ctx.alpha('cyan', 0.08), stroke: ctx.alpha('cyan', 0.5), parent: V });
          ctx.icon('film', 220, 326, 60, 'lime', { parent: V });
          ctx.icon('film', 560, 326, 60, 'cyan', { parent: V });
          ctx.text(220, 410, 'clip A', { size: 14, font: 'mono', color: 'lime', anchor: 'middle', parent: V });
          ctx.text(560, 410, 'clip B', { size: 14, font: 'mono', color: 'cyan', anchor: 'middle', parent: V });
          var vA = ctx.label(220, 476, 'A is better', { color: 'lime', size: 12, w: 130, parent: V });
          ctx.label(390, 476, 'tie', { color: 'dim', size: 12, w: 70, parent: V });
          ctx.label(560, 476, 'B is better', { color: 'cyan', size: 12, w: 130, parent: V });
          var votes = ctx.text(700, 212, 'votes 0', { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: V });
          /* simulate votes from true strengths; refit Bradley-Terry by MLE (MM updates) every 100 votes */
          var NAMES = ['ours v2', 'ours v1', 'baseline A', 'baseline B'], TRUE = [1130, 1065, 1000, 955], COLS = ['lime', 'cyan', 'violet', 'orange'];
          var rn = ctx.rng(2024), Rt = [1000, 1000, 1000, 1000], hist = [[], [], [], []], NV = 4000;
          var Wn = [0, 1, 2, 3].map(function (a) { return [0, 1, 2, 3].map(function (b) { return a === b ? 0 : 0.5; }); });
          function fitBT() {
            var p = [1, 1, 1, 1];
            for (var it = 0; it < 60; it++) {
              for (var a = 0; a < 4; a++) {
                var num = 0, den = 0;
                for (var b = 0; b < 4; b++) if (b !== a) { num += Wn[a][b]; den += (Wn[a][b] + Wn[b][a]) / (p[a] + p[b]); }
                p[a] = num / den;
              }
              var gm = Math.pow(p[0] * p[1] * p[2] * p[3], 0.25);
              for (var c = 0; c < 4; c++) p[c] /= gm;
            }
            return p.map(function (q) { return 1000 + 400 * Math.log(q) / Math.LN10; });
          }
          for (var v = 0; v <= NV; v++) {
            if (v % 100 === 0) { Rt = fitBT(); for (var m = 0; m < 4; m++) hist[m].push([v, Rt[m]]); }
            if (v === NV) break;
            var i = Math.floor(rn() * 4), j = Math.floor(rn() * 3); if (j >= i) j++;
            var pt = 1 / (1 + Math.pow(10, (TRUE[j] - TRUE[i]) / 400));
            if (rn() < pt) Wn[i][j] += 1; else Wn[j][i] += 1;
          }
          /* beat 1 material: the Bradley-Terry / Elo equations */
          var EQ = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, EQ, 40, 540, 700, 290, 'amber', 'BRADLEY–TERRY / ELO');
          ctx.text(66, 600, 'P(i ≻ j) = 1 / (1 + 10^((Rj − Ri)/400))', { size: 16, font: 'mono', color: 'white', parent: EQ });
          ctx.text(66, 640, 'Ri ← Ri + K · (S − P(i ≻ j))', { size: 16, font: 'mono', color: 'white', parent: EQ });
          ctx.text(66, 690, '100 Elo ≈ 64% win rate · 40 Elo ≈ 56%', { size: 13, font: 'mono', color: 'text', parent: EQ });
          var EQ2 = ctx.group({ parent: EQ, opacity: 0 });
          ctx.para(66, 730, ['final board: BT maximum likelihood + bootstrap CI', 'randomise sides · ask per axis · control for style'], { size: 13, font: 'mono', color: 'lime', lh: 26, parent: EQ2 });
          /* beat 2 material: ratings vs votes */
          var P = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, P, 780, 190, 780, 400, 'amber', 'RATINGS vs VOTES (Bradley–Terry MLE, refit every 100)');
          var curves = hist.map(function (h, m) {
            return ctx.plot(850, 240, 660, 300, h, { xDomain: [0, NV], yDomain: [880, 1200], color: COLS[m], sw: 2, axes: m === 0, xLabel: m === 0 ? 'votes' : null, parent: P });
          });
          curves.forEach(function (c) { c.curve.setAttribute('opacity', 0); });
          [900, 1000, 1100, 1200].forEach(function (r) { var q = curves[0].toPx(0, r); ctx.text(q.x - 8, q.y, String(r), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: P }); });
          /* beat 3 material: leaderboard */
          var LB = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, LB, 780, 610, 780, 220, 'amber', 'LEADERBOARD (95% CI ≈ ±15)');
          var order = [0, 1, 2, 3].sort(function (a, b) { return Rt[b] - Rt[a]; });
          var lbRows = order.map(function (m, k) {
            var rg = ctx.group({ parent: LB });
            var y = 660 + k * 40;
            ctx.text(810, y, (k + 1) + '. ' + NAMES[m], { size: 14, font: 'mono', color: COLS[m], parent: rg });
            var x0 = 1000, sc = 1.6, xr = x0 + (Rt[m] - 900) * sc;
            ctx.line(x0, y, x0 + 300 * sc, y, { color: ctx.alpha('white', 0.06), sw: 8, parent: rg });
            ctx.line(xr - 15 * sc, y, xr + 15 * sc, y, { color: COLS[m], sw: 3, parent: rg });
            ctx.circle(xr, y, 5, { fill: COLS[m], parent: rg });
            ctx.text(1540, y, Math.round(Rt[m]) + ' ± 15', { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: rg });
            return rg;
          });
          hide(lbRows);
          ctx.hud('pairwise votes → ratings');
          /* beat 0: a blind pairwise vote */
          return ctx.reveal(V, { from: 'left' }).then(function () {
            return Promise.all([ctx.pulse(cardA, { color: 'lime', dur: 600 }), ctx.pulse(vA, { color: 'lime', dur: 600 })]);
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: votes become ratings through Bradley-Terry */
            ctx.hud('100 Elo ≈ 64% win rate');
            return ctx.reveal(EQ, { from: 'up' });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: four models separate as votes accumulate */
            ctx.hud('4,000 votes · rating SE ≈ ±15 Elo');
            return ctx.reveal(P, { from: 'right' }).then(function () {
              var ps = curves.map(function (c) { return ctx.reveal(c.curve, { from: 'draw', dur: 2600, ease: 'linear' }); });
              ps.push(ctx.counter(votes, 0, NV, 2600, function (x) { return 'votes ' + Math.round(x).toLocaleString('en-US'); }));
              return Promise.all(ps);
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: confidence intervals and ties */
            return ctx.reveal(LB, { from: 'up' }).then(function () { return ctx.reveal(lbRows, { from: 'left', stagger: 120 }); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: protocol and confounds */
            return ctx.reveal(EQ2, { from: 'up' }).then(function () { return ctx.pulse(EQ2, { color: 'lime', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'VLM-as-judge',
        beats: [
          {
            say: 'Humans do not scale to every render, so the critic agent is a vision language model acting as judge. It receives sampled frames, the prompt, the style sketches and a rubric with anchored descriptions for each score.',
            card: { tag: 'KEY IDEA', title: 'Anchored rubrics', body: 'Every score level has a concrete description, such as helmet morphs versus identity stable, so the judge measures a defect rather than a mood.' },
            deep: '<p><b>Judge input</b>: 8–16 frames sampled across the shot (plus a motion summary, since many VLMs see few frames), the shot prompt, the reference sketches, and a <b>rubric</b> with an anchor for each level: 1 = <i>visor geometry changes between frames</i>, 5 = <i>identity stable in every frame</i>.</p>' +
              '<p>Anchors matter because LLM judges compress scores toward the middle without them, and because a concrete anchor turns “is it good?” into “did this specific defect occur?”, which VLMs answer far more reliably.</p>'
          },
          {
            say: 'It returns structured scores with a rationale and a defect localised in time, so the director agent can act on it, here by redoing shot three.',
            card: { tag: 'HOW IT WORKS', title: 'A verdict the director can use', body: 'Constrained decoding guarantees valid JSON. The defect carries a time range, so the fix can target the flicker, not the whole shot.' },
            deep: '<p><b>Output</b>: JSON via constrained decoding: per-dimension integer scores, a rationale and a localised defect (a timestamp range) that the director can act on. A verdict of <code>redo</code> triggers a re-render with a retry limit of two.</p>' +
              '<p>Use a judge from a <b>different model family</b> than the prompt writer or generator: same-family judges inflate scores through self-preference.</p>'
          },
          {
            say: 'A judge is only trustworthy once calibrated. On a held out set rated by humans, we measure rank correlation between the judge and the people.',
            card: { tag: 'NUMBERS', title: 'Calibrated against humans', stat: { v: '0.84', l: 'Spearman rank correlation of judge and human scores on 60 held-out clips; the release gate is 0.7' } },
            deep: '<div class="eq">ρ<sub>s</sub> = Pearson( rank(judge), rank(human) ); &nbsp; κ<sub>w</sub> for ordinal agreement</div>' +
              '<p>Calibration uses hundreds of clips with at least three human raters each; the scatter shows 60 for legibility. Rank correlation ignores scale offsets, which is the point: the judge may be harsher or kinder than people, but must order clips the same way. Weighted κ additionally checks agreement on the ordinal scale.</p>'
          },
          {
            say: 'Then we check that swapping the clip order does not flip the verdict, that the judge is not from the writer\'s own model family, that it uses the full scale, and that it has not drifted since the last model change.',
            card: { tag: 'PITFALL', title: 'Judges have measurable biases', body: 'Position, self-preference and scale compression can all be measured and mitigated. Treat the judge as a versioned model with its own regression gate.' },
            deep: '<ul><li><b>Position bias</b>: in pairwise mode, judge both orders and count only order-consistent verdicts.</li>' +
              '<li><b>Self-preference</b>: a judge from the same family as the generator inflates scores; use a different family.</li>' +
              '<li><b>Scale compression</b>: judges avoid extremes, so calibrate thresholds on the human set (for example an isotonic map).</li>' +
              '<li><b>Drift</b>: re-run the calibration suite on every judge or rubric change.</li></ul>' +
              '<div class="note">Judges are strongest at <i>detecting specific defects</i> with a clear rubric and weakest at holistic aesthetics. Keep humans for the latter.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 4);
          var g = bench(ctx);
          var IN = ctx.group({ parent: g });
          panel(ctx, IN, 40, 190, 500, 400, 'magenta', 'JUDGE INPUT');
          var fm = [];
          for (var i = 0; i < 8; i++) fm.push(ctx.rect(64 + i * 56, 232, 48, 34, { rx: 4, fill: ctx.alpha(i === 5 ? 'red' : 'lime', 0.18), stroke: ctx.alpha(i === 5 ? 'red' : 'lime', 0.6), sw: 1, parent: IN }));
          ctx.text(64, 284, '8 frames of shot 3 · prompt · 3 sketches', { size: 12, font: 'mono', color: 'dim', parent: IN });
          var RUB = [['prompt adherence', '1 = wrong scene … 5 = every element'], ['identity consistency', '1 = helmet morphs … 5 = stable'], ['physics', '1 = floats … 5 = plausible impact'], ['temporal artefacts', '1 = flicker/warp … 5 = none'], ['style match', '1 = off-model … 5 = matches sketches']];
          var rub = RUB.map(function (r, k) {
            var y = 320 + k * 50;
            var rg = ctx.group({ parent: IN, opacity: 0 });
            ctx.text(64, y, r[0], { size: 13, font: 'mono', color: 'white', parent: rg });
            ctx.text(64, y + 19, r[1], { size: 12, font: 'mono', color: 'magenta', parent: rg });
            return rg;
          });
          /* beat 1 material: the structured verdict and the action */
          var jg = ctx.group({ parent: g, opacity: 0 });
          var js = ctx.code({ x: 570, y: 190, w: 380, title: 'judge → critic.shot3.json', lang: 'json', size: 12, typing: true, parent: jg, lines: [
            '{"adherence": 4,',
            ' "identity": 2,',
            ' "physics": 3,',
            ' "artefacts": 2,',
            ' "style": 4,',
            ' "defect": {"t": [3.1, 3.6],',
            '   "what": "visor flicker"},',
            ' "verdict": "redo"}'
          ] });
          var act = ctx.group({ parent: g, opacity: 0 });
          ctx.line(760, 392, 760, 440, { color: 'magenta', arrow: true, parent: act });
          ctx.label(760, 462, 'director: redo shot 3 (retries ≤ 2)', { color: 'magenta', size: 12, parent: act });
          ctx.para(580, 510, ['judge ≠ writer model family', 'JSON via constrained decoding', 'defect localised in time → fixable'], { size: 12, font: 'mono', color: 'dim', lh: 20, parent: act });
          /* beat 2 material: calibration scatter */
          var rn = ctx.rng(77), hu = [], ju = [];
          for (var k = 0; k < 60; k++) {
            var h = 1 + 4 * rn();
            var j = h + 0.55 * gauss(rn) + 0.15 * (3 - h);
            j = Math.max(1, Math.min(5, Math.round(j * 2) / 2));
            hu.push(h); ju.push(j);
          }
          var rho = pearson(ranks(hu), ranks(ju));
          var SC = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, SC, 980, 190, 580, 400, 'teal', 'CALIBRATION vs HUMANS (held-out)');
          var pl = ctx.plot(1050, 240, 460, 290, [[1, 1], [5, 5]], { xDomain: [1, 5], yDomain: [1, 5], color: ctx.alpha('white', 0.3), sw: 1.2, xLabel: 'human mean score', yLabel: 'judge score', parent: SC });
          var dots = hu.map(function (h, k) { var q = pl.toPx(h, ju[k]); return ctx.circle(q.x, q.y, 4, { fill: ctx.alpha('teal', 0.8), parent: SC, opacity: 0 }); });
          var rt = ctx.text(1080, 262, '', { size: 15, font: 'mono', weight: 700, color: 'white', parent: SC });
          /* beat 3 material: known biases and mitigations */
          var BI = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, BI, 40, 620, 1520, 210, 'magenta', 'KNOWN BIASES → MITIGATIONS');
          var BL = [['position bias', 'judge both orders, keep order-consistent verdicts', '91% consistent'], ['self-preference', 'judge from a different model family than the writer', 'Δ +0.4 → +0.05'],
            ['scale compression', 'isotonic map judge → human scale; thresholds set on humans', 'uses 1–5 fully'], ['drift', 'versioned judge + calibration suite in CI', 'ρ ≥ 0.7 gate']];
          var br = BL.map(function (b, k) {
            var rg = ctx.group({ parent: BI, opacity: 0 });
            var y = 670 + k * 38;
            ctx.text(66, y, b[0], { size: 13, font: 'mono', color: 'white', weight: 600, parent: rg });
            ctx.text(290, y, b[1], { size: 13, font: 'mono', color: 'text', parent: rg });
            ctx.text(1530, y, b[2], { size: 13, font: 'mono', color: 'lime', anchor: 'end', parent: rg });
            return rg;
          });
          ctx.hud('LLM judge · rubric · calibrated on humans');
          /* beat 0: the judge's input: frames, prompt, sketches, rubric */
          return ctx.reveal(IN, { from: 'left' }).then(function () {
            return ctx.reveal(rub, { from: 'left', stagger: 110 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: a structured, localised verdict */
            return ctx.reveal(jg, { from: 'up' }).then(function () {
              return js.typeAll();
            }).then(function () {
              ctx.pulse(fm[5], { color: 'red', dur: 700 });
              return ctx.reveal(act, { from: 'up' });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: calibrate against human ratings */
            ctx.hud('judge vs human: Spearman ρ = ' + rho.toFixed(2) + ' (n = 60)');
            return ctx.reveal(SC, { from: 'right' }).then(function () {
              return Promise.all(dots.map(function (d, k) { return ctx.reveal(d, { from: 'scale', dur: 250, delay: k * 20 }); }));
            }).then(function () {
              return ctx.typeText(rt, 'Spearman ρ = ' + rho.toFixed(2) + '  (n = 60)', 700);
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: biases, and how each is mitigated */
            ctx.hud('bias checks: order · family · scale · drift');
            return ctx.reveal(BI, { from: 'up' }).then(function () { return ctx.reveal(br, { from: 'left', stagger: 120 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Agent evals',
        beats: [
          {
            say: 'Judging the film is not enough; we also judge how the agents made it. Trajectory grading walks through every step: was the right tool called, were the arguments valid, were there wasted calls?',
            card: { tag: 'NUMBERS', title: 'Grading the process', stat: { v: '0.86', l: 'trajectory score: 9 clean steps, 1 redundant call at half credit, 1 invalid argument' },
              more: '<p>Score = (clean + ½·redundant) / steps = (9 + 0.5) / 11 = 0.86. The invalid <code>duration_s</code> is graded zero for that step even though the agent recovered on the next one: recovery is credited in the outcome, not in the process score.</p>' },
            deep: '<p><b>Trajectory</b> (process): each step is graded for tool choice, argument validity, redundancy and recovery. It localises failures, since a bad outcome is either a bad plan or a bad execution, and it rewards efficient plans.</p>' +
              '<p>Here the second <code>search_refs</code> is redundant (amber), and <code>render_shot 3 dur=12</code> violates the policy maximum of 10 seconds (red) before the agent retries with 6.</p>'
          },
          {
            say: 'Task success is separate. It checks hard constraints on the final result: thirty seconds, six shots, the creator\'s own voice, and sketch style, mostly with plain code.',
            card: { tag: 'HOW IT WORKS', title: 'Outcome checks are mostly code', body: 'Duration, shot count and policy violations are programmatic. Voice and style use embeddings against thresholds, and the critic covers the rest.' },
            deep: '<p><b>Outcome</b> (end state): programmatic checks wherever possible: duration 30 ± 1 s, six shots in the edit decision list, narration speaker embedding matches the creator (cosine 0.83), style similarity to the sketches at or above 0.7, zero policy violations. A judge score covers what code cannot.</p>' +
              '<p>Checks that can be code should be code: they are deterministic, free and cannot be argued with.</p>'
          },
          {
            say: 'And reliability matters more than luck. An agent that succeeds eighty percent of the time passes at least one of three tries almost always, but succeeds on all three only half the time.',
            card: { tag: 'NUMBERS', title: 'Can it, versus does it', stat: { v: '0.992 vs 0.512', l: 'pass at 3 versus pass caret 3 for a per-trial success rate of 0.8' } },
            deep: '<div class="eq">pass@k = 1 − (1 − p)<sup>k</sup> &nbsp;&nbsp; pass<sup>k</sup> = p<sup>k</sup></div>' +
              '<p>With p = 0.8: pass@3 = 0.992 (the research-demo metric: <i>can it ever do it?</i>) but pass<sup>3</sup> = 0.512 (the production metric from τ-bench: <i>does it do it every time?</i>). Users experience pass<sup>k</sup>: a creator who gets a broken trailer one time in five does not care that a retry would have worked.</p>'
          },
          {
            say: 'Cost and latency are metrics too. Success against dollars per task forms a Pareto frontier, and a configuration that is a few points better at two and a half times the cost is rarely the right choice.',
            card: { tag: 'TRADE-OFF', title: 'Success per dollar', body: 'Beyond our configuration, three more points of success cost two and a half times as much. Pick the knee of the curve, not the maximum.' },
            deep: '<ul><li><b>Cost and latency are eval metrics</b>: report success against $/task and p95 wall-clock as a Pareto frontier.</li>' +
              '<li><b>Environment</b>: sandboxed tools with deterministic fakes (<code>render_shot</code> returns cached clips) make agent evals cheap and reproducible; a small fraction runs end-to-end on real GPUs.</li>' +
              '<li><b>Variance</b>: run each task at least five times; agent success rates have wide confidence intervals at typical suite sizes of 100–500 tasks.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 5);
          var g = bench(ctx);
          var TJ = [['plan', 'ok'], ['search_refs', 'ok'], ['search_refs', 'warn', 'redundant'], ['storyboard', 'ok'], ['render_shot ×6', 'ok'], ['critic', 'ok'],
            ['render_shot 3 dur=12', 'err', 'arg > max'], ['render_shot 3 dur=6', 'ok'], ['tts(voice=memo)', 'ok'], ['edit + encode', 'ok'], ['publish → confirm', 'ok']];
          var TC = { ok: 'lime', warn: 'amber', err: 'red' };
          var th = ctx.text(60, 206, 'TRAJECTORY · graded step by step', { size: 13, font: 'display', weight: 700, color: 'teal', spacing: 1.2, parent: g });
          var chips = TJ.map(function (t, i) {
            var row = i < 6 ? 0 : 1, col = i < 6 ? i : i - 6;
            var x = 60 + col * 250, y = 244 + row * 62;
            var cg = ctx.group({ parent: g, opacity: 0 });
            ctx.rect(x, y - 18, 234, 36, { rx: 18, fill: ctx.alpha(TC[t[1]], 0.1), stroke: ctx.alpha(TC[t[1]], 0.7), sw: 1.2, parent: cg });
            ctx.icon(t[1] === 'ok' ? 'check' : 'warn', x + 20, y, 16, TC[t[1]], { parent: cg });
            ctx.text(x + 36, y, (i + 1) + ' ' + t[0], { size: 12, font: 'mono', color: 'white', parent: cg });
            if (t[2]) ctx.text(x + 117, y + 30, t[2], { size: 11, font: 'mono', color: TC[t[1]], anchor: 'middle', parent: cg });
            return cg;
          });
          var tsc = ctx.text(1540, 306, 'trajectory score 0.86', { size: 14, font: 'mono', weight: 700, color: 'lime', anchor: 'end', parent: g, opacity: 0 });
          /* beat 1 material: outcome checks */
          var OC = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, OC, 40, 390, 500, 440, 'teal', 'OUTCOME CHECKS (task success)');
          var CK = [['duration 30.2 s ∈ 30 ± 1', 'program'], ['6 shots in EDL', 'program'], ['narration speaker = creator', 'ECAPA cos 0.83'], ['style sim to sketches ≥ 0.7', 'SigLIP 0.78'], ['policy violations = 0', 'audit log'], ['critic min score ≥ 3.5', 'VLM judge']];
          var cks = CK.map(function (c, k) {
            var rg = ctx.group({ parent: OC, opacity: 0 });
            var y = 446 + k * 46;
            ctx.icon('check', 70, y, 18, 'lime', { parent: rg });
            ctx.text(92, y, c[0], { size: 13, font: 'mono', color: 'white', parent: rg });
            ctx.text(516, y, c[1], { size: 12, font: 'mono', color: 'teal', anchor: 'end', parent: rg });
            return rg;
          });
          var suc = ctx.group({ parent: OC, opacity: 0 });
          ctx.text(66, 740, 'SUCCESS', { size: 22, font: 'display', weight: 700, color: 'lime', parent: suc });
          ctx.text(66, 780, 'all constraints hold · 151 s · $4.61', { size: 13, font: 'mono', color: 'text', parent: suc });
          /* beat 2 material: pass@k vs pass^k */
          var PK = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, PK, 570, 390, 470, 440, 'amber', 'pass@k vs pass^k  (p = 0.8)');
          var ks = [1, 2, 3, 4, 5];
          var at = ks.map(function (k) { return 1 - Math.pow(0.2, k); }), pw = ks.map(function (k) { return Math.pow(0.8, k); });
          var vals = [], cols = [], labs = [];
          ks.forEach(function (k) { vals.push(0, 0); cols.push(C.cyan, C.amber); labs.push('k=' + k, ''); });
          var bars = ctx.bars(610, 450, 400, 250, vals, { color: cols, labels: labs, gap: 6, labelSize: 12, parent: PK });
          ctx.rect(610, 750, 12, 12, { rx: 2, fill: ctx.alpha('cyan', 0.75), parent: PK });
          ctx.text(630, 756, 'pass@k: any of k tries', { size: 12, font: 'mono', color: 'text', parent: PK });
          ctx.rect(610, 780, 12, 12, { rx: 2, fill: ctx.alpha('amber', 0.75), parent: PK });
          ctx.text(630, 786, 'pass^k: all k tries (what users feel)', { size: 12, font: 'mono', color: 'text', parent: PK });
          /* beat 3 material: Pareto */
          var PA = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, PA, 1070, 390, 490, 440, 'lime', 'SUCCESS vs COST (agent configs)');
          var CF = [[2.1, 0.62, 'small LLM'], [3.0, 0.74, ''], [4.6, 0.83, 'ours'], [6.8, 0.85, ''], [11.5, 0.86, 'max-reasoning'], [5.5, 0.71, ''], [8.0, 0.78, '']];
          var pp = ctx.plot(1130, 440, 390, 300, [[2.1, 0.62], [3.0, 0.74], [4.6, 0.83], [6.8, 0.85], [11.5, 0.86]], { xDomain: [0, 12], yDomain: [0.5, 0.9], color: ctx.alpha('lime', 0.6), sw: 1.6, yLabel: 'success', parent: PA });
          ctx.text(1520, 774, '$ / task', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: PA });
          CF.forEach(function (c) {
            var q = pp.toPx(c[0], c[1]);
            ctx.circle(q.x, q.y, c[2] === 'ours' ? 7 : 5, { fill: c[2] === 'ours' ? 'lime' : ctx.alpha('white', 0.6), glow: c[2] === 'ours', parent: PA });
            if (c[2]) ctx.text(q.x + (c[2] === 'max-reasoning' ? 10 : 12), q.y + (c[2] === 'max-reasoning' ? 18 : 16), c[2], { size: 12, font: 'mono', color: c[2] === 'ours' ? 'lime' : 'dim', anchor: c[2] === 'max-reasoning' ? 'end' : 'start', parent: PA });
          });
          [0, 4, 8, 12].forEach(function (v) { var q = pp.toPx(v, 0.5); ctx.text(q.x, q.y + 14, '$' + v, { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: PA }); });
          [0.6, 0.7, 0.8, 0.9].forEach(function (v) { var q = pp.toPx(0, v); ctx.text(q.x - 6, q.y, v.toFixed(1), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: PA }); });
          ctx.text(1100, 800, 'beyond "ours": +3 pts success for 2.5× the cost', { size: 12, font: 'mono', color: 'dim', parent: PA });
          ctx.hud('trajectory + outcome + reliability');
          /* beat 0: trajectory grading */
          return Promise.all([ctx.reveal(th, { from: 'left' }), ctx.reveal(chips, { from: 'left', stagger: 80, delay: 200 })]).then(function () {
            return Promise.all([ctx.reveal(tsc, { from: 'left' }), ctx.pulse(chips[2], { color: 'amber', dur: 600 }), ctx.pulse(chips[6], { color: 'red', dur: 600 })]);
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: hard constraints on the outcome */
            return ctx.reveal(OC, { from: 'up' }).then(function () {
              return ctx.reveal(cks, { from: 'left', stagger: 90 });
            }).then(function () { return ctx.reveal(suc, { from: 'up' }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: pass@k versus pass^k */
            ctx.hud('pass@3 = 0.992 · pass^3 = 0.512');
            return ctx.reveal(PK, { from: 'up' }).then(function () {
              var nv = [];
              ks.forEach(function (k, i) { nv.push(at[i], pw[i]); });
              return bars.update(nv, 1000);
            }).then(function () { return ctx.pulse(chips[6], { color: 'red', dur: 500 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: success against cost */
            ctx.hud('success vs $/task: pick the knee');
            return ctx.reveal(PA, { from: 'up' });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Trace waterfall',
        beats: [
          {
            say: 'Here is the actual trace of our trailer job: one tree of spans under a single trace identifier, with the whole job as the root span.',
            card: { tag: 'HOW IT WORKS', title: 'One tree, one trace id', body: 'The root span is the job. Every agent turn, model call and GPU job is a child or a linked span, drawn on one shared time axis.' },
            deep: '<p>Spans follow the OpenTelemetry <b>GenAI semantic conventions</b> where they exist: <code>invoke_agent {name}</code>, <code>chat {model}</code> and <code>execute_tool {tool}</code>, with <code>gen_ai.request.model</code>, <code>gen_ai.usage.input_tokens</code> and <code>gen_ai.usage.output_tokens</code>.</p>' +
              '<p>Everything else is a custom namespace: cache-read tokens, TTFT, GPU type and count, GPU-seconds, queue wait, retry attempt and reason, cost. The root span, <code>job.trailer</code>, carries the totals.</p>'
          },
          {
            say: 'The director\'s planning call starts first. The reference encoders and speech recognition run beside it, and the storyboard follows.',
            card: { tag: 'NUMBERS', title: 'A warm prefix cache', stat: { v: '79%', l: 'of the planner call\'s 12,412 input tokens were served from the prefix cache' } },
            deep: '<p>The first 12 seconds are LLM planning: <code>chat planner-llm</code> reads 12,412 input tokens (9,830 from the cache) and emits 1,106; then <code>search_refs</code> queries the vector memory; then the storyboard call reads 21,960 tokens with a lower cache hit (56%), since it includes fresh tool results.</p>' +
              '<p>Reference encoding (SigLIP on three sketches) and ASR on the memo run in parallel on separate GPUs, and finish before the storyboard needs them.</p>'
          },
          {
            say: 'Then six shots wait for a gang of eight GPUs each and sample in parallel, while narration is synthesised alongside, off the critical path.',
            card: { tag: 'NUMBERS', title: 'Six shots, forty eight GPUs', stat: { v: '4,560', u: 'GPU-s', l: 'in the shot spans: 6 shots × 8 GPUs × 95 s of diffusion sampling' },
              more: '<p>GPU-seconds are billed for the <i>reserved gang window</i>, not for busy kernels. Gang scheduling holds all eight GPUs from placement until the last rank finishes, so one slow rank costs the whole gang, and cost attribution multiplies the wall-clock span by the gang size. Shot 3\'s own sampling ran 86 s (690 GPU-s); the 95 s window used for the total also covers queue wait and decode.</p>' },
            deep: '<p>The <code>dit.sample ×6</code> span is the critical path: 8 H100 per shot, 48 in total, 40 denoising steps with classifier-free guidance 5.0 and 75,600 latent tokens per shot. Queue wait was 1.8 s on this job against a fleet p95 of 18 s: it landed on a warm gang.</p>' +
              '<p><b>Critical path</b> = the chain of spans that determines end-to-end latency. Narration ran with 97 s of slack, so optimising it would save nothing.</p>'
          },
          {
            say: 'The critic flags shot three, and a retry span appears, linked to the critic span that caused it.',
            card: { tag: 'NUMBERS', title: 'A visible retry', stat: { v: '+30 s', l: 'the retry span: shot 3 redone after the critic scored identity 2 of 5' } },
            deep: '<p><b>Retry visibility</b>: the retry is a sibling span with <code>retry.attempt = 2</code> and <code>retry.reason = critic.identity &lt; 3</code>, plus a <i>span link</i> to the critic span that caused it. So <i>why did this job take 151 s?</i> is answerable in one click.</p>' +
              '<p>It adds 240 GPU-seconds (8 GPUs × 30 s) and 30 s of wall clock. Retries are the classic hidden latency: they never appear in per-service dashboards because each service looks healthy.</p>'
          },
          {
            say: 'Edit, encode and signing close the job at about one hundred fifty one seconds. Click any span to inspect its attributes, including token counts and cache hits.',
            card: { tag: 'TRY IT', title: 'Click any span', body: 'Select a bar or a name to read its attributes. Pink outlines mark the critical path: diffusion and the retry are 83 percent of it.' },
            deep: '<ul><li><b>Async boundaries</b>: GPU jobs run in another service, minutes later. The trace context travels in the job message, and span links join fan-out and fan-in.</li>' +
              '<li><b>Sampling</b>: keep 100% of traces for errors, retries and SLO breaches (tail-based sampling in the collector) and a few percent of the rest. This trace is kept because it contains a retry.</li></ul>' +
              '<div class="note">Prompt and completion bodies (<code>gen_ai.input.messages</code>, <code>gen_ai.output.messages</code>) are <b>opt-in</b> in the GenAI conventions. Enable them only with redaction, or ship them to a separate access-controlled store and keep a reference on the span, because they contain user data.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 6);
          var g = bench(ctx);
          var SP = [
            [0, 'job.trailer', 0, 151, 'pink', ['trace_id: 4bf92f35…0e4736', 'service: orchestrator', 'duration: 151.0 s', 'spans: 212', 'status: OK', 'app.cost_usd: 4.61']],
            [1, 'invoke_agent director', 0, 12, 'magenta', ['gen_ai.operation.name: invoke_agent', 'gen_ai.agent.name: director', 'duration: 12.0 s', 'children: 3']],
            [2, 'chat planner-llm', 0.3, 4.8, 'amber', ['gen_ai.operation.name: chat', 'gen_ai.request.model: planner-xl', 'gen_ai.usage.input_tokens: 12,412', 'app.cache_read_tokens: 9,830 (79%)', 'gen_ai.usage.output_tokens: 1,106', 'app.ttft_ms: 380', 'app.cost_usd: 0.027']],
            [2, 'execute_tool search_refs', 4.9, 5.8, 'teal', ['gen_ai.operation.name: execute_tool', 'gen_ai.tool.name: search_refs', 'db.system: vector (HNSW)', 'results: 12', 'duration: 0.9 s']],
            [2, 'chat storyboard-llm', 5.9, 11.8, 'amber', ['gen_ai.request.model: planner-xl', 'gen_ai.usage.input_tokens: 21,960', 'app.cache_read_tokens: 12,400 (56%)', 'gen_ai.usage.output_tokens: 1,480', 'app.ttft_ms: 610']],
            [1, 'invoke_agent refs', 0.5, 6, 'magenta', ['gen_ai.agent.name: refs', 'starts on upload, parallel to planning', 'duration: 5.5 s']],
            [2, 'gpu encode sketches ×3', 0.8, 3.2, 'violet', ['app.gpu: 1×L40S', 'app.model: siglip-so400m', 'images: 3', 'duration: 2.4 s']],
            [2, 'gpu asr memo', 0.8, 2.1, 'orange', ['app.gpu: 1×L40S', 'app.model: whisper-large (accurate pass)', 'audio_s: 42', 'duration: 1.3 s']],
            [1, 'dit.sample ×6 · 8×H100', 12, 107, 'lime', ['app.gpu: 8×H100 per shot, 48 total', 'app.queue_wait_s: 1.8 (fleet p95 18)', 'app.steps: 40 · cfg 5.0', 'app.latent_tokens: 75,600 / shot', 'app.gpu_seconds: 4,560 (6×8×95 s)', 'app.mfu: 0.43']],
            [2, 'queue.wait video-pool', 12, 13.8, 'blue', ['app.pool: video-h100', 'app.queue_wait_s: 1.8', 'app.gang_size: 8 GPUs (1 NVLink node)', 'fleet queue wait p95: 18 s', 'app.priority: interactive']],
            [2, 'dit.sample shot 3', 13.8, 100, 'lime', ['app.shot: 3 of 6 · 6 s', 'app.steps: 40 · preview every 4', 'app.previews: 10 · p(unsafe) max 0.07', 'app.gpu_seconds: 690 (8×86 s)', 'status: OK (then critic)']],
            [1, 'chat critic-vlm (shot 3)', 100, 107, 'amber', ['gen_ai.request.model: critic-vlm', 'gen_ai.usage.input_tokens: 18,900 (8 frames)', 'gen_ai.usage.output_tokens: 240', 'app.verdict: redo (identity 2/5)']],
            [1, 'render_shot 3 · retry', 107, 137, 'red', ['app.retry.attempt: 2', 'app.retry.reason: critic.identity < 3', 'link → critic-vlm span', 'app.gpu_seconds: 240 (8×30 s)', 'status: OK']],
            [1, 'tts.narration', 20, 40, 'orange', ['app.model: flow-matching TTS', 'app.voice: creator (consent ✓)', 'audio_s: 28', 'slack: 97 s (off critical path)']],
            [1, 'edit · encode · c2pa.sign', 137, 151, 'cyan', ['app.encoder: NVENC AV1 + H.264', 'app.ladder: 6 renditions', 'c2pa.signed: true', 'duration: 14 s']]
          ];
          var CRIT = [1, 4, 8, 9, 10, 11, 12, 14];
          var NR = SP.length;
          var x0 = 360, W = 780, sc = W / 151, y0 = 206, dy = 33;
          var tl = ctx.group({ parent: g, opacity: 0 });
          [0, 30, 60, 90, 120, 150].forEach(function (s) {
            ctx.line(x0 + s * sc, y0 - 16, x0 + s * sc, y0 + (NR - 1) * dy + 16, { color: ctx.alpha('white', 0.06), parent: tl });
            ctx.text(x0 + s * sc, y0 + (NR - 1) * dy + 32, s + ' s', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: tl });
          });
          var sel = ctx.rect(40, 0, 1110, 30, { rx: 6, fill: ctx.alpha('white', 0.05), stroke: ctx.alpha('white', 0.25), sw: 1, parent: g, opacity: 0 });
          /* attribute panel */
          var AP = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, AP, 1170, 186, 390, 500, 'cyan', 'SPAN ATTRIBUTES');
          var apT = ctx.text(1190, 240, '', { size: 14, font: 'mono', weight: 700, color: 'white', parent: AP });
          var apL = [];
          for (var k = 0; k < 8; k++) apL.push(ctx.text(1190, 280 + k * 30, '', { size: 12, font: 'mono', color: 'text', parent: AP }));
          ctx.text(1190, 660, 'click any span', { size: 12, font: 'mono', color: 'dim', parent: AP });
          function show(i) {
            var s = SP[i];
            sel.setAttribute('y', y0 + i * dy - 15);
            sel.setAttribute('opacity', 1);
            apT.textContent = s[1];
            apT.setAttribute('fill', ctx.color(s[4] === 'dim' ? 'white' : s[4]));
            apL.forEach(function (t, k) { t.textContent = s[5][k] || ''; });
          }
          var rows = SP.map(function (s, i) {
            var y = y0 + i * dy;
            var name = ctx.text(52 + s[0] * 18, y, s[1], { size: 12, font: 'mono', color: s[0] === 0 ? 'white' : 'text', parent: g });
            var b = ctx.rect(x0 + s[2] * sc, y - 10, 0, 20, { rx: 3, fill: ctx.alpha(s[4], 0.5), stroke: s[4], sw: 1, parent: g });
            b.w = Math.max(3, (s[3] - s[2]) * sc);
            [name, b].forEach(function (el) { el.style.cursor = 'pointer'; el.addEventListener('click', function () { show(i); }); });
            name.setAttribute('opacity', 0);
            return { name: name, bar: b };
          });
          var cur = ctx.line(x0, y0 - 18, x0, y0 + (NR - 1) * dy + 16, { color: 'white', sw: 1.4, opacity: 0, parent: g });
          var ct = ctx.text(x0, y0 - 26, '0 s', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: g, opacity: 0 });
          var foot = ctx.group({ parent: g, opacity: 0 });
          ctx.rect(52, 730, 26, 12, { rx: 3, stroke: 'pink', sw: 2, parent: foot });
          ctx.text(88, 736, 'critical path: DiT + retry = 125 of 151 s (83%)', { size: 13, font: 'mono', color: 'pink', parent: foot });
          ctx.text(700, 736, 'tail-sampled: kept because it contains a retry', { size: 13, font: 'mono', color: 'dim', parent: foot });
          ctx.text(52, 768, 'trace_id 4bf92f3577b34da6a3ce929d0e0e4736 · 15 of 212 spans shown (5 sibling shot spans collapsed)', { size: 12, font: 'mono', color: 'dim', parent: foot });
          /* the time cursor: every span grows as the cursor passes it */
          function setT(tc) {
            cur.setAttribute('x1', x0 + tc * sc); cur.setAttribute('x2', x0 + tc * sc);
            ct.setAttribute('x', x0 + tc * sc); ct.textContent = Math.round(tc) + ' s';
            SP.forEach(function (s, i) {
              if (i === 0) return;
              var f = ctx.clamp((tc - s[2]) / Math.max(0.1, s[3] - s[2]), 0, 1);
              rows[i].bar.setAttribute('width', rows[i].bar.w * f);
              if (tc >= s[2]) rows[i].name.setAttribute('opacity', 1);
            });
          }
          function sweep(a, b, ms) { return ctx.tween(ms, function (t) { setT(a + (b - a) * t); }, 'linear'); }
          ctx.hud('trace 4bf92f35… · 212 spans');
          /* beat 0: the root span and the time axis */
          return Promise.all([ctx.reveal(tl, {}), ctx.reveal(AP, { from: 'right', delay: 200 })]).then(function () {
            show(0);
            rows[0].name.setAttribute('opacity', 1);
            return ctx.animate(rows[0].bar, { width: [0, rows[0].bar.w] }, 900, 'out');
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: planning, reference encoding and ASR */
            cur.setAttribute('opacity', 0.7); ct.setAttribute('opacity', 1);
            show(2);
            return sweep(0, 12, 1600);
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: six shots in parallel, narration alongside */
            show(8);
            return sweep(12, 100, 2600);
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the critic flags shot 3 and a retry appears */
            return sweep(100, 137, 1500).then(function () {
              show(12);
              return ctx.pulse(rows[12].bar, { color: 'red', dur: 700 });
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: edit, encode, sign; the critical path lights up */
            return sweep(137, 151, 800).then(function () {
              cur.setAttribute('opacity', 0); ct.setAttribute('opacity', 0);
              CRIT.forEach(function (i) { rows[i].bar.setAttribute('stroke', C.pink); rows[i].bar.setAttribute('stroke-width', 2.6); });
              show(2);
              return ctx.reveal(foot, {});
            });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Metrics & SLOs',
        beats: [
          {
            say: 'Traces explain one job; metrics watch the fleet. Latency is a distribution, not a number: time to first token has a median near two hundred milliseconds but a long tail past one and a half seconds, and users remember the tail.',
            card: { tag: 'NUMBERS', title: 'The tail is the experience', stat: { v: '1.7 s', l: 'p99 time to first token, against a 210 ms median: the tail is eight times the middle' },
              more: '<p>For a log-normal with median m and log-scale σ, the q-quantile is m · e<sup>zσ</sup> with z = 2.326 for q = 0.99. With m = 210 ms and σ = 0.9 that is 210 · e<sup>2.09</sup> ≈ 1,700 ms. The mean is m · e<sup>σ²/2</sup> ≈ 315 ms, 50% above the median, which is why means mislead on skewed latency.</p>' },
            deep: '<p><b>Percentiles, not means</b>. TTFT here is log-normal with median 210 ms and σ = 0.9, so p99 = 210 · e<sup>2.326·0.9</sup> ≈ 1.7 s, p95 ≈ 0.9 s and the mean is about 315 ms. A dashboard that shows the mean hides the users who wait.</p>' +
              '<p>Tail sources: long prefills, queueing behind big batches, KV-cache eviction and cold replicas. Store latency as histograms so percentiles can be recomputed and aggregated across replicas.</p>'
          },
          {
            say: 'GPU utilization looks like ninety percent while model FLOPs utilization is closer to forty. Track what the hardware achieves, not whether it looks busy.',
            card: { tag: 'PITFALL', title: 'Utilization is not efficiency', body: 'The GPU util counter only says a kernel was running. Model FLOPs utilization, achieved over peak, shows how much of the silicon does useful work.' },
            deep: '<div class="eq">MFU = achieved model FLOP/s ÷ peak (≈ 989 TFLOP/s dense BF16, H100 SXM)</div>' +
              '<p>The <code>nvidia-smi</code> figure is the fraction of time <i>any</i> kernel runs. Track SM occupancy, HBM bandwidth and NVLink utilisation as well (DCGM exporters).</p>' +
              '<p>DiT sampling is compute-bound, with MFU of 35–55%. LLM decode is bandwidth-bound, so low MFU is expected there; watch tokens per second per GPU instead.</p>'
          },
          {
            say: 'Queue wait on the video pool and structured logs keyed by the trace identifier complete the picture.',
            card: { tag: 'HOW IT WORKS', title: 'Queue wait leads the autoscaler', body: 'Wait time per pool and priority rises before latency does, so it is the autoscaler\'s early signal. Logs join traces through trace_id.' },
            deep: '<p><b>Queue wait</b> (a histogram per pool and priority) is the autoscaler\'s leading signal: p50 1.8 s and p95 18 s on the video pool, against p50 20 ms and p99 0.9 s inside the LLM path.</p>' +
              '<p><b>Logs</b> are structured JSON carrying <code>trace_id</code> and <code>span_id</code>, so a log line jumps to its span and a span jumps to its logs. Prompts and outputs are sampled and redacted.</p>'
          },
          {
            say: 'Service level objectives turn this into policy: ninety nine percent of trailers finish within ten minutes, and the one percent error budget decides when we stop shipping features and fix reliability.',
            card: { tag: 'NUMBERS', title: 'A budget you can spend', stat: { v: '2,800', u: 'jobs', l: 'error budget: 1 percent of 280,000 jobs in a 28 day window' } },
            deep: '<p><b>SLO</b> = 99% of jobs complete in under 10 minutes over 28 days, so the <b>error budget</b> is 1% of jobs. A job is <i>bad</i> if it fails, exceeds 10 minutes, or is abandoned after a system error.</p>' +
              '<p>The chart shows budget remaining. The dashed line is exactly-on-SLO burn (budget gone at day 28); the teal line burns slower, until an incident on day 17 takes 30 points. When the budget is exhausted, feature work freezes for that service and reliability work takes priority.</p>'
          },
          {
            say: 'Alerts watch how fast the budget burns. A fast burn pages someone within minutes, and a slow burn opens a ticket. Here an incident burns the budget at twenty times the sustainable rate and pages.',
            card: { tag: 'NUMBERS', title: 'Page on burn rate', stat: { v: '14.4×', l: 'burn rate that pages: 2 percent of a monthly budget gone in one hour' },
              more: '<p>Burn rate b = (bad ÷ total) ÷ (1 − SLO). At b = 14.4 for one hour a 28-day budget loses 14.4 / 672 ≈ 2.1%. A 10-hour incident at b = 20 loses 20 × 10 / 672 ≈ 30%, which is the dip on day 17. Requiring both a long and a short window (1 h and 5 min) stops pages for incidents that have already ended.</p>' },
            deep: '<div class="eq">burn rate b = (bad / total) ÷ (1 − SLO)</div>' +
              '<ul><li><b>Page</b> if b &gt; 14.4 over both 1 h and 5 min (≈ 2% of the budget in an hour).</li>' +
              '<li><b>Ticket</b> if b &gt; 6 over 6 h and 30 min.</li>' +
              '<li>Budget exhausted: feature freeze for this service.</li></ul>' +
              '<p>These are the multiwindow, multi-burn-rate alerts of the SRE Workbook: fast burns page, slow burns ticket, and the paired short window resets the alert quickly once the incident is over.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 7);
          var g = bench(ctx);
          /* A: TTFT histogram */
          var A = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, A, 40, 190, 520, 360, 'amber', 'LLM TTFT distribution (log-x)');
          var NB = 26, lo = Math.log(50), hi = Math.log(6000), mu = Math.log(210), sg = 0.9;
          var hv = [];
          for (var i = 0; i < NB; i++) { var x = lo + (hi - lo) * (i + 0.5) / NB; hv.push(Math.exp(-(x - mu) * (x - mu) / (2 * sg * sg))); }
          var hb = ctx.bars(70, 262, 460, 198, hv.map(function () { return 0; }), { color: hv.map(function (v, i) { var x = Math.exp(lo + (hi - lo) * (i + 0.5) / NB); return x > 1700 ? C.red : C.amber; }), gap: 3, parent: A });
          function xpx(ms) { return 70 + (Math.log(ms) - lo) / (hi - lo) * 460; }
          [100, 1000].forEach(function (ms) { ctx.text(xpx(ms), 478, ms >= 1000 ? (ms / 1000) + ' s' : ms + ' ms', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: A }); });
          var p50 = Math.exp(mu), p99 = Math.exp(mu + 2.326 * sg);
          [[p50, 'p50 ' + Math.round(p50) + ' ms', 'white'], [p99, 'p99 ' + (p99 / 1000).toFixed(1) + ' s', 'red']].forEach(function (m) {
            ctx.line(xpx(m[0]), 244, xpx(m[0]), 462, { color: m[2], sw: 1.6, dash: '4 3', parent: A });
            ctx.text(xpx(m[0]) + 6, 248, m[1], { size: 12, font: 'mono', color: m[2], parent: A });
          });
          ctx.text(66, 516, 'users remember the tail: 1 in 100 turns waits ≥ 8× the median', { size: 12, font: 'mono', color: 'text', parent: A });
          /* B: GPU utilisation */
          var B = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, B, 590, 190, 460, 360, 'red', 'VIDEO POOL · what "busy" means');
          var GU = [['GPU util (nvidia-smi)', 0.92, 'red'], ['SM active', 0.81, 'orange'], ['MFU', 0.41, 'violet'], ['HBM bandwidth', 0.58, 'cyan'], ['NVLink', 0.35, 'teal']];
          var gb = GU.map(function (u, k) {
            var y = 250 + k * 52;
            ctx.text(614, y - 10, u[0], { size: 12, font: 'mono', color: 'text', parent: B });
            ctx.text(1026, y - 10, Math.round(u[1] * 100) + '%', { size: 12, font: 'mono', color: u[2], anchor: 'end', parent: B });
            ctx.rect(614, y, 412, 12, { rx: 3, fill: 'rgba(255,255,255,0.05)', parent: B });
            var b = ctx.rect(614, y, 0, 12, { rx: 3, fill: ctx.alpha(u[2], 0.75), parent: B });
            b.w = u[1] * 412;
            return b;
          });
          ctx.text(614, 526, 'MFU = model FLOP/s ÷ 989 TFLOP/s (H100 BF16)', { size: 12, font: 'mono', color: 'violet', parent: B });
          /* bottom right: queues and logs */
          var Q = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, Q, 930, 580, 630, 250, 'cyan', 'QUEUES · LOGS');
          var QW = [['video pool queue wait', 'p50 1.8 s', 'p95 18 s', 'lime'], ['LLM queue (in TTFT)', 'p50 20 ms', 'p99 0.9 s', 'amber']];
          QW.forEach(function (q, k) {
            var y = 640 + k * 28;
            ctx.text(950, y, q[0], { size: 12, font: 'mono', color: 'text', parent: Q });
            ctx.text(1400, y, q[1], { size: 12, font: 'mono', color: q[3], anchor: 'end', parent: Q });
            ctx.text(1536, y, q[2], { size: 12, font: 'mono', color: q[3], anchor: 'end', parent: Q });
          });
          ctx.code({ x: 950, y: 704, w: 590, title: 'log · structured, joined by trace_id', lang: 'json', size: 11, color: 'cyan', parent: Q, lines: [
            '{"lvl":"WARN","svc":"orchestrator","msg":"critic redo",',
            ' "trace_id":"4bf92f35…","span_id":"a3ce929d…","shot":3}'
          ] });
          /* C: error budget */
          var Cc = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, Cc, 1080, 190, 480, 360, 'teal', 'ERROR BUDGET · 28-day window');
          var pts = [];
          for (var d = 0; d <= 28; d += 0.5) { var r = 100 - 0.6 * 100 / 28 * d - (d >= 17 ? 30 : 0); pts.push([d, Math.max(0, r)]); }
          var eb = ctx.plot(1130, 240, 400, 240, pts, { xDomain: [0, 28], yDomain: [0, 100], color: 'teal', sw: 2, xLabel: 'day', yLabel: 'budget left %', parent: Cc });
          var ideal = ctx.plot(1130, 240, 400, 240, [[0, 100], [28, 0]], { xDomain: [0, 28], yDomain: [0, 100], color: ctx.alpha('white', 0.3), sw: 1.2, axes: false, parent: Cc });
          ideal.curve.setAttribute('stroke-dasharray', '5 5');
          eb.curve.setAttribute('opacity', 0);
          var inc = eb.toPx(17, 60);
          var incL = ctx.label(inc.x - 10, inc.y - 70, 'incident: b = 20× → page', { color: 'red', size: 11, parent: Cc, opacity: 0 });
          ctx.text(1110, 520, 'ends at 10% left · dashed = exactly-on-SLO burn', { size: 12, font: 'mono', color: 'dim', parent: Cc });
          /* bottom left: SLO policy */
          var P = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, P, 40, 580, 870, 250, 'teal', 'SLO POLICY');
          ctx.text(66, 632, 'SLO: 99% of trailer jobs complete < 10 min (28 d)  →  error budget = 1% ≈ 2,800 of 280k jobs', { size: 14, font: 'mono', color: 'white', parent: P });
          ctx.text(66, 668, 'budget exhausted → feature freeze; reliability work first', { size: 14, font: 'mono', color: 'lime', parent: P });
          var P2 = ctx.group({ parent: g, opacity: 0 });
          ctx.text(66, 720, 'burn rate  b = (bad / total) ÷ (1 − SLO)', { size: 16, font: 'mono', color: 'teal', parent: P2 });
          ctx.text(66, 756, 'page:   b > 14.4 over 1 h AND 5 min   (≈ 2% of budget per hour)', { size: 14, font: 'mono', color: 'red', parent: P2 });
          ctx.text(66, 788, 'ticket: b > 6 over 6 h AND 30 min', { size: 14, font: 'mono', color: 'amber', parent: P2 });
          ctx.hud('TTFT p50 ' + Math.round(p50) + ' ms · p99 ' + (p99 / 1000).toFixed(1) + ' s');
          /* beat 0: latency is a distribution */
          return ctx.reveal(A, { from: 'left' }).then(function () {
            var mx = Math.max.apply(null, hv);
            return hb.update(hv.map(function (v) { return v / mx; }), 900);
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: busy versus useful */
            ctx.hud('GPU util 92% · MFU 41%');
            return ctx.reveal(B, { from: 'up' }).then(function () {
              return Promise.all(gb.map(function (b, k) { return ctx.tween(700, function (t) { b.setAttribute('width', b.w * t); }, 'out', k * 100); }));
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: queue wait and logs */
            ctx.hud('queue wait p95 18 s · logs joined by trace_id');
            return ctx.reveal(Q, { from: 'up' });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the SLO and its error budget */
            ctx.hud('SLO 99% < 10 min · budget 1%');
            return Promise.all([ctx.reveal(P, { from: 'up' }), ctx.reveal(Cc, { from: 'right' })]).then(function () {
              return ctx.reveal(eb.curve, { from: 'draw', dur: 1500, ease: 'linear' });
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: burn-rate alerts */
            ctx.hud('page at 14.4× burn · ticket at 6×');
            return Promise.all([ctx.reveal(P2, { from: 'up' }), ctx.reveal(incL, { from: 'up', delay: 300 })]).then(function () {
              return ctx.pulse(incL, { color: 'red', dur: 600 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Cost & release gates',
        beats: [
          {
            say: 'Finally, money and change. Cost is accounted per span and rolled up per job: diffusion sampling dominates, then language model tokens.',
            card: { tag: 'NUMBERS', title: 'Sampling is the bill', stat: { v: '69%', l: 'of the bill is DiT sampling: $3.17 of $4.61 per 30 s trailer' } },
            deep: '<table><tr><th>Item</th><th>Basis</th><th>$</th></tr>' +
              '<tr><td>DiT shots</td><td>6 × 8 GPU × 95 s</td><td>3.17</td></tr>' +
              '<tr><td>Re-render</td><td>8 GPU × 30 s</td><td>0.17</td></tr>' +
              '<tr><td>LLM tokens</td><td>0.45M in (70% cached), 40k out</td><td>1.10</td></tr>' +
              '<tr><td>Audio, safety, CDN</td><td>TTS, encoders, encode</td><td>0.17</td></tr>' +
              '<tr><td><b>Total</b></td><td>per 30 s trailer</td><td><b>4.61</b></td></tr></table>' +
              '<p>GPU cost assumes about $2.5 per H100-hour (illustrative). Levers: few-step distillation (40 → 8 steps cuts DiT cost by about 5×), prefix caching (LLM input cost down 40–70%), early abort, and draft-then-upscale.</p>'
          },
          {
            say: 'Divide by accepted minutes, not generated ones, because abandoned and rejected renders still burn GPUs. That takes nine dollars a minute to more than ten.',
            card: { tag: 'NUMBERS', title: 'Cost per delivered minute', stat: { v: '$10.48', l: 'per delivered minute, after 12 percent of jobs are abandoned or rejected' },
              more: '<p>$4.61 per 30 s job doubles to $9.22 per generated minute, and dividing by the accepted fraction 0.88 gives $10.48. If acceptance falls from 88% to 80% with every unit price unchanged, delivered-minute cost rises to $11.53, a 10% regression that no per-service dashboard would show.</p>' },
            deep: '<p><b>Unit economics</b>: cost per <i>delivered</i> minute = total spend / accepted minutes. $4.61 per 30 s job is $9.22 per generated minute; with 12% of jobs abandoned or rejected, the denominator shrinks to 0.88 and the cost is $10.48 per delivered minute.</p>' +
              '<p>The gap between generated and delivered minutes is the price of quality control and of user indecision. It is worth tracking as its own metric: a falling acceptance rate is a cost regression even if every unit price is flat.</p>'
          },
          {
            say: 'And every change, a new video model, a new prompt, a new judge, must pass the same gate. Only then does it reach every creator.',
            card: { tag: 'KEY IDEA', title: 'Everything is a release', body: 'Models, prompts, policies and judges are all parts of the system. They all go through offline suite, regression gate, canary and experiment.' },
            deep: '<p>The gate has five stages: the <b>offline suite</b> (VBench dimensions, FVD, Elo, agent task success), a <b>regression gate</b> on every metric, a <b>canary</b> on 1% of traffic, an <b>A/B test</b> at 50/50, and the <b>rollout</b>.</p>' +
              '<div class="note">The same gate applies to prompts, policies and judges. They are all models of the system, and a prompt tweak can regress quality as surely as a new checkpoint.</div>'
          },
          {
            say: 'First the offline suite and non-inferiority checks on every metric. Improvements need not be significant, but regressions must be ruled out.',
            card: { tag: 'HOW IT WORKS', title: 'Rule out regressions', body: 'A metric passes when the lower confidence bound of its change clears a non-inferiority margin. Latency and cost use the upper bound.' },
            deep: '<p><b>Regression gate</b> (per metric m, candidate versus control): pass if the lower bound of the CI on Δ<sub>m</sub> clears a non-inferiority margin −δ<sub>m</sub>. Improvements need not be significant; <i>regressions</i> must be ruled out. For lower-is-better metrics such as latency and $/min, the upper bound must stay below +δ<sub>m</sub>.</p>' +
              '<div class="eq">ship ⇔ ∀m: CI<sub>95</sub>(Δ<sub>m</sub>).lower &gt; −δ<sub>m</sub> &nbsp;∧&nbsp; safety ASR ≤ bound</div>'
          },
          {
            say: 'Then a one percent canary catches crashes and cost blowups, and a fifty fifty A B test measures the primary metric with variance reduction and guardrails. Only then does the release reach every creator.',
            card: { tag: 'NUMBERS', title: 'Variance reduction pays', stat: { v: '−38%', l: 'variance from CUPED using pre-period behaviour (illustrative), so tests end sooner' } },
            deep: '<ul><li><b>Canary</b> (1% of traffic, hours): catches crashes, latency and cost blow-ups that the offline suite cannot see.</li>' +
              '<li><b>A/B</b> (50/50, days): a pre-registered primary metric (export or completion rate), with <b>CUPED</b> variance reduction using pre-period behaviour, plus guardrails (p99 latency, $/min, safety escalations). Check for sample-ratio mismatch before reading results.</li>' +
              '<li>Multiple metrics mean multiple comparisons: pre-register the primary; treat the rest as guardrails.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 8);
          var g = bench(ctx);
          /* cost */
          var L = ctx.group({ parent: g });
          panel(ctx, L, 40, 190, 560, 640, 'lime', 'COST PER DELIVERED MINUTE');
          var CO = [['DiT sampling', 3.17, 'lime'], ['LLM tokens', 1.10, 'amber'], ['critic retry', 0.17, 'red'], ['audio · safety · CDN', 0.17, 'orange']];
          var tot = CO.reduce(function (a, c) { return a + c[1]; }, 0);
          var sx = 70, sw = 500, acc = 0;
          var leg = ctx.group({ parent: L, opacity: 0 });
          var segs = CO.map(function (c, k) {
            var r = ctx.rect(sx + acc / tot * sw, 250, 0, 34, { rx: 2, fill: ctx.alpha(c[2], 0.65), stroke: c[2], sw: 1, parent: L });
            r.w = c[1] / tot * sw; acc += c[1];
            ctx.rect(sx, 316 + k * 32, 12, 12, { rx: 2, fill: ctx.alpha(c[2], 0.8), parent: leg });
            ctx.text(sx + 22, 322 + k * 32, c[0], { size: 13, font: 'mono', color: 'text', parent: leg });
            ctx.text(sx + sw, 322 + k * 32, '$' + c[1].toFixed(2) + '  ' + Math.round(c[1] / tot * 100) + '%', { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: leg });
            return r;
          });
          /* beat 1 material: from job cost to delivered-minute cost */
          var L1 = ctx.group({ parent: L, opacity: 0 });
          ctx.line(sx, 454, sx + sw, 454, { color: 'faint', parent: L1 });
          var RW = [['per 30 s job', '$' + tot.toFixed(2)], ['per generated minute', '$' + (tot * 2).toFixed(2)], ['12% abandoned / rejected', '÷ 0.88'], ['per DELIVERED minute', '$' + (tot * 2 / 0.88).toFixed(2)]];
          var rw = RW.map(function (r, k) {
            var rg = ctx.group({ parent: L1, opacity: 0 });
            var y = 486 + k * 36;
            ctx.text(sx, y, r[0], { size: 14, font: 'mono', color: k === 3 ? 'white' : 'text', weight: k === 3 ? 700 : 400, parent: rg });
            ctx.text(sx + sw, y, r[1], { size: k === 3 ? 20 : 14, font: 'mono', weight: 700, color: k === 3 ? 'lime' : 'white', anchor: 'end', parent: rg });
            return rg;
          });
          ctx.text(sx, 660, 'LEVERS', { size: 13, font: 'display', weight: 700, color: 'lime', spacing: 1, parent: L1 });
          [['distil 40 → 8 steps', 'DiT cost ≈ ÷5'], ['prefix caching', 'LLM input −40–70%'], ['early abort + drafts', 'fewer wasted renders']].forEach(function (lv, k) {
            ctx.text(sx, 692 + k * 30, lv[0], { size: 13, font: 'mono', color: 'white', parent: L1 });
            ctx.text(sx + 210, 692 + k * 30, lv[1], { size: 13, font: 'mono', color: 'text', parent: L1 });
          });
          /* release gate */
          var R = ctx.group({ parent: g, opacity: 0 });
          panel(ctx, R, 630, 190, 930, 640, 'teal', 'RELEASE GATE · candidate video model v2.1');
          var ST = ['offline suite', 'regression gate', 'canary 1%', 'A/B 50/50', 'rollout'];
          var stn = ST.map(function (s, k) { return ctx.label(720 + k * 186, 250, s, { color: 'teal', size: 12, w: 150, parent: R }); });
          for (var k = 0; k < 4; k++) ctx.line(797 + k * 186, 250, 829 + k * 186, 250, { color: 'dim', arrow: true, parent: R });
          var tok = ctx.circle(720, 250, 8, { fill: 'lime', glow: true, parent: R });
          /* beat 3 material: regression table */
          var GTg = ctx.group({ parent: R, opacity: 0 });
          var HX = [660, 1000, 1160, 1330, 1540];
          ['metric', 'Δ vs v2', '95% CI', 'margin δ', ''].forEach(function (h, i) { ctx.text(HX[i], 300, h, { size: 12, font: 'mono', color: 'dim', anchor: i ? 'end' : 'start', parent: GTg }); });
          var GT = [['VBench subject consistency', '−0.4%', '[−0.9, +0.1]', '−1.0%'], ['VBench dynamic degree', '+6.1%', '[+4.2, +8.0]', '−2.0%'], ['human Elo (pairwise)', '+18', '[+6, +30]', '−10'],
            ['agent task success', '+1.2 pt', '[−0.8, +3.2]', '−2 pt'], ['p99 job latency', '+3%', '[+1, +5]', '+10%'], ['$ per delivered min', '−14%', '[−16, −12]', '+5%'], ['exfiltration ASR (red team)', '0.5%', '[0.2, 0.9]', '≤ 1%']];
          var WORSE = [true, false, false, false, true, false, false];
          var gt = GT.map(function (r, k) {
            var rg = ctx.group({ parent: R, opacity: 0 });
            var y = 336 + k * 38;
            ctx.text(HX[0], y, r[0], { size: 13, font: 'mono', color: 'white', parent: rg });
            for (var c = 1; c < 4; c++) ctx.text(HX[c], y, r[c], { size: 13, font: 'mono', color: c === 1 ? (WORSE[k] ? 'amber' : 'lime') : 'text', anchor: 'end', parent: rg });
            ctx.icon('check', HX[4] - 8, y, 16, 'lime', { parent: rg });
            return rg;
          });
          /* beat 4 material: A/B test */
          var ab = ctx.group({ parent: R, opacity: 0 });
          ctx.rect(656, 624, 880, 180, { rx: 8, fill: ctx.alpha('cyan', 0.05), stroke: ctx.alpha('cyan', 0.4), sw: 1, parent: ab });
          ctx.text(676, 652, 'A/B (7 days, 50/50, CUPED)', { size: 13, font: 'display', weight: 700, color: 'cyan', spacing: 1, parent: ab });
          ctx.text(676, 688, 'primary: export rate  +2.3%  (95% CI +0.8 … +3.8, p = 0.004)', { size: 13, font: 'mono', color: 'lime', parent: ab });
          ctx.text(676, 718, 'CUPED: variance −38% using pre-period export rate', { size: 13, font: 'mono', color: 'text', parent: ab });
          ctx.text(676, 748, 'guardrails: p99 latency ✓  $/min ✓  safety escalations ✓  SRM ✓', { size: 13, font: 'mono', color: 'text', parent: ab });
          ctx.text(676, 780, 'verdict: SHIP v2.1', { size: 15, font: 'mono', weight: 700, color: 'lime', parent: ab });
          function moveTo(k, ms) {
            var from = parseFloat(tok.getAttribute('cx'));
            return ctx.tween(ms, function (t) { tok.setAttribute('cx', from + (720 + k * 186 - from) * t); }, 'inOut');
          }
          ctx.hud('$' + (tot * 2 / 0.88).toFixed(2) + ' per delivered minute');
          /* beat 0: where the money goes */
          return Promise.all([ctx.reveal(L, { from: 'left' })]).then(function () {
            return Promise.all([ctx.reveal(leg, { delay: 100 })].concat(segs.map(function (r, k) { return ctx.tween(500, function (t) { r.setAttribute('width', r.w * t); }, 'out', k * 120); })));
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: cost per delivered minute */
            return ctx.reveal(L1, {}).then(function () { return ctx.reveal(rw, { from: 'left', stagger: 120 }); }).then(function () {
              return ctx.pulse(rw[3], { color: 'lime', dur: 700 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: every change goes through the same five gates */
            ctx.hud('every change: same gate, same evidence');
            return ctx.reveal(R, { from: 'right' }).then(function () { return ctx.pulse(stn[0], { color: 'teal', dur: 500 }); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the offline suite and regression gate */
            return moveTo(1, 500).then(function () {
              return Promise.all([ctx.reveal(GTg, { dur: 300 }), ctx.reveal(gt, { from: 'left', stagger: 90 })]);
            }).then(function () { return ctx.pulse(stn[1], { color: 'teal', dur: 500 }); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: canary, A/B test, rollout */
            return moveTo(2, 400).then(function () { return ctx.pulse(stn[2], { color: 'teal', dur: 400 }); }).then(function () {
              return moveTo(3, 400);
            }).then(function () {
              return ctx.reveal(ab, { from: 'up' });
            }).then(function () {
              return moveTo(4, 400);
            }).then(function () {
              tok.setAttribute('opacity', 0);
              stn[4].firstChild.setAttribute('fill', ctx.alpha('lime', 0.3));
              stn[4].firstChild.setAttribute('stroke', C.lime);
              return ctx.pulse(stn[4], { color: 'lime', times: 2, dur: 500 });
            });
          });
        }
      }
    ]
  });
})();
