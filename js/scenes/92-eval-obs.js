/* L2 — Evals & Observability. Video metrics (FVD, CLIPScore, VBench), human preference / Elo, VLM-as-judge
 * calibration, agent trajectory evals, an OpenTelemetry trace waterfall of one trailer job, SLOs / error budgets,
 * cost per finished minute and release regression gates. */
(function () {
  var RAIL = ['framing', 'FVD · CLIP', 'VBench', 'Elo', 'VLM judge', 'agent evals', 'trace', 'SLOs', 'cost · gates'];

  function keepSpaces(g) {
    function keep(t) { t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.style.whiteSpace = 'pre'; }
    g.lineEls.forEach(keep);
    var add = g.addLine;
    g.addLine = function (s, inst) { var p = add(s, inst); keep(g.lineEls[g.lineEls.length - 1]); return p; };
    return g;
  }
  function code(ctx, parent, o) { o.parent = parent; return keepSpaces(ctx.code(o)); }

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
      'Chiang et al., <i>Chatbot Arena: An Open Platform for Evaluating LLMs by Human Preference</i>, ICML 2024; Zheng et al., <i>Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena</i>, NeurIPS 2023',
      'Yao et al., <i>τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains</i> (pass^k), 2024',
      'OpenTelemetry, <i>Semantic Conventions for Generative AI</i> (gen_ai.* spans and metrics), 2024–2025; W3C, <i>Trace Context</i> Recommendation, 2021',
      'Beyer et al., <i>The Site Reliability Workbook</i>, ch. 5 “Alerting on SLOs” (multiwindow burn-rate alerts), O\'Reilly 2018',
      'Deng et al., <i>Improving the Sensitivity of Online Controlled Experiments by Utilizing Pre-Experiment Data</i> (CUPED), WSDM 2013'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Measure everything',
        say: 'Two questions hang over every trailer the system makes. Is it good? And is the system working? Evaluation answers the first with a pyramid of evidence: cheap automatic metrics at the base, model judges in the middle, and expensive human preference at the top, which calibrates everything below it. Observability answers the second with traces, metrics and logs, plus a fourth signal that engineers forget until the invoice arrives: cost per finished minute of video.',
        deep: '<p>Two measurement planes, different consumers:</p>' +
          '<table><tr><th></th><th>Evaluation</th><th>Observability</th></tr>' +
          '<tr><td>Question</td><td>is the output good?</td><td>is the system healthy, fast, affordable?</td></tr>' +
          '<tr><td>Unit</td><td>clip, trailer, trajectory</td><td>span, time series, log event</td></tr>' +
          '<tr><td>Cadence</td><td>per checkpoint / release; online per job</td><td>continuous, per request</td></tr>' +
          '<tr><td>Failure</td><td>regression in quality or safety</td><td>latency, errors, cost drift</td></tr></table>' +
          '<p><b>Evidence pyramid</b>: automatic metrics (FVD, CLIPScore, VBench) scale to millions of samples but are proxies; VLM judges scale to thousands and read rubrics but inherit biases; human pairwise preference is the ground truth that calibrates both, at dollars per judgement.</p>' +
          '<div class="note">Goodhart\'s law applies with full force: any single metric optimised directly (e.g. subject consistency) gets gamed — static videos maximise it. Keep a <b>portfolio</b> of metrics with known trade-offs, and anchor them to humans.</div>',
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
          ctx.reveal(job, { from: 'scale' });
          ctx.reveal(strip, { from: 'up', delay: 200 });
          ctx.text(60, 410, 'EVALUATION — is it good?', { size: 17, font: 'display', weight: 700, color: 'teal', parent: g });
          ctx.text(1560, 410, 'OBSERVABILITY — is it working?', { size: 17, font: 'display', weight: 700, color: 'cyan', anchor: 'end', parent: g });
          /* pyramid */
          var ax = 250, ay = 460, by = 800, hw = 210;
          function hwAt(y) { return hw * (y - ay) / (by - ay); }
          var BANDS = [[ay, 570, 'amber', 'human pairwise · Elo', '$$$ per label · ground truth'], [570, 690, 'magenta', 'VLM judge · rubric', 'scalable · must be calibrated'], [690, by, 'teal', 'FVD · CLIPScore · VBench', 'cheap · proxy validity']];
          var pyr = BANDS.map(function (b) {
            var bg = ctx.group({ parent: g });
            ctx.poly([[ax - hwAt(b[0]), b[0]], [ax + hwAt(b[0]), b[0]], [ax + hwAt(b[1]), b[1]], [ax - hwAt(b[1]), b[1]]], { fill: ctx.alpha(b[2], 0.2), stroke: b[2], sw: 1.4, parent: bg });
            var ym = (b[0] + b[1]) / 2 + 12;
            ctx.line(ax + hwAt(ym) + 8, ym, 488, ym, { color: ctx.alpha(b[2], 0.6), dash: '3 3', parent: bg });
            ctx.text(496, ym - 10, b[3], { size: 14, font: 'display', weight: 600, color: 'white', parent: bg });
            ctx.text(496, ym + 10, b[4], { size: 12, font: 'mono', color: b[2], parent: bg });
            return bg;
          });
          ctx.reveal(pyr.slice().reverse(), { from: 'up', stagger: 180, delay: 400 });
          /* triad */
          var TR = [['Traces', 'where did the time go', 'clock', 'cyan', 1100, 510], ['Metrics', 'is the fleet healthy', 'chart', 'amber', 1420, 510],
            ['Logs', 'what exactly happened', 'doc', 'violet', 1100, 700], ['Cost', '$ per finished minute', 'bolt', 'lime', 1420, 700]];
          var tri = TR.map(function (t) { return ctx.node({ x: t[4], y: t[5], w: 280, h: 64, title: t[0], sub: t[1], icon: t[2], color: t[3], titleSize: 16, subSize: 12, parent: g }); });
          var otel = ctx.label(1260, 605, 'OpenTelemetry · one trace_id', { color: 'cyan', size: 12, parent: g });
          ctx.reveal(tri, { from: 'right', stagger: 120, delay: 400 });
          ctx.reveal(otel, { delay: 900 });
          var l1 = ctx.link(job, { x: ax, y: ay - 6 }, { color: 'teal', from: 'l', parent: g });
          var l2 = ctx.link(job, { x: 1260, y: 450 }, { color: 'cyan', from: 'r', parent: g });
          ctx.reveal([l1, l2], { from: 'draw', delay: 600, stagger: 150 });
          ctx.hud('quality signals + operational signals, per job');
          return ctx.wait(1300).then(function () {
            return Promise.all([ctx.packet(l1, { color: 'teal', dur: 900, label: 'clips' }), ctx.packet(l2, { color: 'cyan', dur: 900, label: 'spans' })]);
          }).then(function () {
            return Promise.all(tri.map(function (n, i) { return ctx.pulse(n, { color: TR[i][3], dur: 600 }); }));
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'FVD & CLIPScore',
        say: 'The classic automatic metrics. Fréchet Video Distance embeds real and generated clips with a video classifier, fits a Gaussian to each cloud of features, and measures the distance between the two Gaussians. Watch the generated cloud slide toward the real one as the model improves. CLIPScore instead asks whether each frame matches the prompt, using the cosine similarity between image and text embeddings. Both are useful, and both are blind in important ways.',
        deep: '<p><b>FVD</b>: features φ from an I3D network (Kinetics-400) on 16-frame clips; fit N(μ<sub>r</sub>, Σ<sub>r</sub>) to real and N(μ<sub>g</sub>, Σ<sub>g</sub>) to generated:</p>' +
          '<div class="eq">FVD = ‖μ<sub>r</sub> − μ<sub>g</sub>‖² + Tr(Σ<sub>r</sub> + Σ<sub>g</sub> − 2(Σ<sub>r</sub>Σ<sub>g</sub>)<sup>½</sup>)</div>' +
          '<ul><li>Needs thousands of samples (Σ is 400×400); biased upward at small N — always compare at equal N.</li>' +
          '<li><b>Content bias</b> (Ge et al., CVPR 2024): I3D features are dominated by per-frame appearance, so FVD barely penalises broken motion; features from self-supervised video models (e.g. VideoMAE) reduce this.</li>' +
          '<li>Distribution-level: says nothing about <i>this</i> trailer.</li></ul>' +
          '<p><b>CLIPScore</b> (Hessel et al.; CLIP ViT-B/32, 512-d joint space): per frame, CLIP-S = w·max(cos(E<sub>I</sub>(frame), E<sub>T</sub>(prompt)), 0) with w = 2.5, averaged over frames. Video papers often swap in ViT-L/14 or ViCLIP — scores are only comparable within one backbone.</p>' +
          '<ul><li>Reference-free and per-sample, but CLIP is bag-of-concepts: weak on counting, spatial relations, negation, and <i>temporal order</i> ("crash-lands then walks" vs reverse).</li>' +
          '<li>Saturates: modern generators all score within a narrow band.</li></ul>' +
          '<div class="note">Use these as cheap regression tripwires on large sets; decide with VBench-style dimensions, judges and humans.</div>',
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
          var rd = real.map(function (p) { var q = xf(p, MR); return ctx.circle(q[0], q[1], 3.5, { fill: ctx.alpha('cyan', 0.8), parent: L }); });
          var gd = gen.map(function (p) { var q = xf(p, G0); return ctx.circle(q[0], q[1], 3.5, { fill: ctx.alpha('lime', 0.85), parent: L }); });
          function ell(m, col) { return ctx.el('ellipse', { cx: m.x, cy: m.y, rx: 2 * m.sx, ry: 2 * m.sy, transform: 'rotate(' + (m.r * 180 / Math.PI) + ' ' + m.x + ' ' + m.y + ')', fill: 'none', stroke: col, 'stroke-width': 1.6, 'stroke-dasharray': '5 4' }, L); }
          ell(MR, C.cyan);
          var ge = ell(G0, C.lime);
          var mr = ctx.circle(MR.x, MR.y, 6, { fill: 'cyan', glow: true, parent: L });
          var mg = ctx.circle(G0.x, G0.y, 6, { fill: 'lime', glow: true, parent: L });
          var dl = ctx.line(MR.x, MR.y, G0.x, G0.y, { color: 'white', sw: 1.4, dash: '3 3', parent: L });
          ctx.text(90, 250, '● real clips (N(μ_r, Σ_r))', { size: 13, font: 'mono', color: 'cyan', parent: L });
          ctx.text(90, 274, '● generated (N(μ_g, Σ_g))', { size: 13, font: 'mono', color: 'lime', parent: L });
          ctx.text(610, 262, 'FVD', { size: 14, font: 'mono', color: 'dim', parent: L });
          var fv = ctx.text(660, 262, '412', { size: 26, font: 'mono', weight: 700, color: 'white', parent: L });
          ctx.text(410, 690, 'FVD = ‖μr − μg‖² + Tr(Σr + Σg − 2(ΣrΣg)^½)', { size: 16, font: 'mono', color: 'white', anchor: 'middle', parent: L });
          ctx.para(66, 736, ['needs ≳ 2k clips per side · biased at small N', 'content-biased: appearance ≫ motion (I3D features)'], { size: 12, font: 'mono', color: 'amber', lh: 22, parent: L });
          ctx.reveal(L, { from: 'left' });
          /* CLIPScore */
          var R = ctx.group({ parent: g });
          panel(ctx, R, 820, 190, 740, 640, 'violet', 'CLIPScore · does each frame match the prompt?');
          var fr = ctx.node({ x: 940, y: 280, w: 170, h: 50, title: 'frame t', sub: 'shot 3', icon: 'image', color: 'lime', titleSize: 14, subSize: 11, parent: R });
          var pr = ctx.node({ x: 940, y: 370, w: 170, h: 50, title: 'prompt', sub: 'fox astronaut…', icon: 'doc', color: 'cyan', titleSize: 14, subSize: 11, parent: R });
          var ie = ctx.node({ x: 1160, y: 280, w: 170, h: 50, title: 'CLIP image', sub: 'E_I · 512-d', color: 'violet', titleSize: 14, subSize: 11, parent: R });
          var te = ctx.node({ x: 1160, y: 370, w: 170, h: 50, title: 'CLIP text', sub: 'E_T · 512-d', color: 'violet', titleSize: 14, subSize: 11, parent: R });
          var cs = ctx.node({ x: 1400, y: 325, w: 180, h: 60, title: 'cos(E_I, E_T)', sub: '× 2.5, clip at 0', color: 'amber', titleSize: 14, subSize: 11, parent: R });
          [ctx.link(fr, ie, { color: 'violet', parent: R }), ctx.link(pr, te, { color: 'violet', parent: R }), ctx.link(ie, cs, { color: 'amber', parent: R }), ctx.link(te, cs, { color: 'amber', parent: R })];
          var COS = [0.31, 0.30, 0.27, 0.32, 0.30, 0.29];
          ctx.text(860, 452, 'mean cosine per shot', { size: 12, font: 'mono', color: 'dim', parent: R });
          var bars = ctx.bars(880, 470, 560, 170, COS.map(function () { return 0; }), { color: 'violet', labels: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], gap: 30, labelSize: 12, parent: R });
          var mean = COS.reduce(function (a, b) { return a + b; }, 0) / 6;
          var cst = ctx.text(880, 690, '', { size: 16, font: 'mono', weight: 700, color: 'white', parent: R });
          ctx.para(846, 736, ['bag-of-concepts: weak on counting, relations,', 'negation and temporal order · saturates'], { size: 12, font: 'mono', color: 'amber', lh: 22, parent: R });
          ctx.reveal(R, { from: 'right', delay: 150 });
          ctx.hud('FVD 412 → 186 as the model improves');
          return ctx.wait(700).then(function () {
            return ctx.tween(2600, function (t) {
              var m = { x: ctx.lerp(G0.x, G1.x, t), y: ctx.lerp(G0.y, G1.y, t), sx: ctx.lerp(G0.sx, G1.sx, t), sy: ctx.lerp(G0.sy, G1.sy, t), r: ctx.lerp(G0.r, G1.r, t) };
              gen.forEach(function (p, i) { var q = xf(p, m); gd[i].setAttribute('cx', q[0]); gd[i].setAttribute('cy', q[1]); });
              ge.setAttribute('cx', m.x); ge.setAttribute('cy', m.y); ge.setAttribute('rx', 2 * m.sx); ge.setAttribute('ry', 2 * m.sy);
              ge.setAttribute('transform', 'rotate(' + (m.r * 180 / Math.PI) + ' ' + m.x + ' ' + m.y + ')');
              mg.setAttribute('cx', m.x); mg.setAttribute('cy', m.y);
              dl.setAttribute('x2', m.x); dl.setAttribute('y2', m.y);
              fv.textContent = String(Math.round(412 - 226 * t));
            }, 'inOut');
          }).then(function () {
            return bars.update(COS.map(function (v) { return v / 0.4; }), 800);
          }).then(function () {
            return ctx.typeText(cst, 'CLIPScore = 2.5 × ' + mean.toFixed(3) + ' = ' + (2.5 * mean * 100).toFixed(1) + ' (×100)', 900);
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'VBench dimensions',
        say: 'VBench breaks video quality into sixteen dimensions, each measured by a specialised model. Subject consistency compares DINO features of the fox across frames. Motion smoothness asks whether a frame interpolation model could have predicted the middle frames. Dynamic degree measures optical flow, aesthetic quality uses a learned aesthetic predictor, and imaging quality a no reference quality model. Notice the trade-off: our new model moves much more, and pays slightly in consistency and smoothness. A static video would ace consistency.',
        deep: '<p>VBench (Huang et al., CVPR 2024): 16 dimensions in two groups — <i>video quality</i> and <i>video–condition consistency</i> — each with a dedicated evaluator and prompt suite:</p>' +
          '<table><tr><th>Dimension</th><th>Measured by</th></tr>' +
          '<tr><td>Subject consistency</td><td>DINO feature cosine, frame vs first/previous frame</td></tr>' +
          '<tr><td>Background consistency</td><td>CLIP image features across frames</td></tr>' +
          '<tr><td>Temporal flickering</td><td>mean abs. pixel difference on static scenes</td></tr>' +
          '<tr><td>Motion smoothness</td><td>AMT frame-interpolation prior: reconstruct dropped frames</td></tr>' +
          '<tr><td>Dynamic degree</td><td>RAFT optical flow magnitude → fraction of "dynamic" videos</td></tr>' +
          '<tr><td>Aesthetic quality</td><td>LAION aesthetic predictor on CLIP features</td></tr>' +
          '<tr><td>Imaging quality</td><td>MUSIQ (no-reference IQA)</td></tr>' +
          '<tr><td>Overall consistency</td><td>ViCLIP video–text similarity</td></tr></table>' +
          '<p>Plus object class, multiple objects, human action, colour, spatial relationship, scene, appearance and temporal style. <b>VBench-2.0</b> (2025) adds <i>intrinsic faithfulness</i>: physics, commonsense, controllability, human fidelity — using VLM/LLM-based checks.</p>' +
          '<div class="note"><b>Anti-correlated dimensions</b>: dynamic degree trades against subject/background consistency and smoothness. Report the vector, never one average, and set per-dimension non-inferiority margins in release gates.</div>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 2);
          var g = bench(ctx);
          var D = ['subject cons.', 'background cons.', 'motion smooth.', 'dynamic degree', 'aesthetic', 'imaging', 'flicker (inv.)', 'overall cons.'];
          var A = [0.86, 0.84, 0.90, 0.40, 0.62, 0.70, 0.88, 0.60], B = [0.80, 0.82, 0.85, 0.82, 0.71, 0.75, 0.83, 0.68];
          var cx = 400, cy = 520, R = 220, n = D.length;
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
          ctx.reveal(web, { from: 'scale', s0: 0.9 });
          var pa = ctx.poly(D.map(function (d, i) { return pt(i, A[i]); }), { fill: ctx.alpha('cyan', 0.18), stroke: 'cyan', sw: 2, parent: g });
          var pb = ctx.poly(D.map(function (d, i) { return pt(i, A[i]); }), { fill: ctx.alpha('lime', 0.18), stroke: 'lime', sw: 2, parent: g });
          pb.setAttribute('opacity', 0);
          ctx.reveal(pa, { from: 'scale', s0: 0.3, delay: 300 });
          ctx.text(90, 820, '— v1 (cyan)   — v2 (lime)   radar axes rescaled per dimension for display', { size: 12, font: 'mono', color: 'dim', parent: g });
          /* raw table */
          var T = ctx.group({ parent: g });
          panel(ctx, T, 800, 190, 760, 600, 'teal', 'RAW SCORES (VBench-style, illustrative)');
          var ROWS = [['subject consistency', 'DINO cos', 0.962, 0.951], ['background consistency', 'CLIP cos', 0.968, 0.964], ['motion smoothness', 'AMT interp.', 0.989, 0.984],
            ['dynamic degree', 'RAFT flow', 0.41, 0.72], ['aesthetic quality', 'LAION pred.', 0.58, 0.62], ['imaging quality', 'MUSIQ', 0.66, 0.69], ['temporal flickering', 'pixel diff', 0.975, 0.968], ['overall consistency', 'ViCLIP', 0.262, 0.279]];
          ctx.text(830, 244, 'dimension', { size: 12, font: 'mono', color: 'dim', parent: T });
          ctx.text(1130, 244, 'evaluator', { size: 12, font: 'mono', color: 'dim', parent: T });
          ctx.text(1370, 244, 'v1', { size: 12, font: 'mono', color: 'cyan', anchor: 'end', parent: T });
          ctx.text(1460, 244, 'v2', { size: 12, font: 'mono', color: 'lime', anchor: 'end', parent: T });
          ctx.text(1540, 244, 'Δ', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: T });
          var rows = ROWS.map(function (r, i) {
            var rg = ctx.group({ parent: T });
            var y = 280 + i * 52;
            if (i === 3) ctx.rect(816, y - 20, 728, 40, { rx: 6, fill: ctx.alpha('amber', 0.1), stroke: ctx.alpha('amber', 0.5), sw: 1, parent: rg });
            ctx.text(830, y, r[0], { size: 13, font: 'mono', color: 'white', parent: rg });
            ctx.text(1130, y, r[1], { size: 12, font: 'mono', color: 'teal', parent: rg });
            ctx.text(1370, y, r[2].toFixed(3), { size: 13, font: 'mono', color: 'cyan', anchor: 'end', parent: rg });
            ctx.text(1460, y, r[3].toFixed(3), { size: 13, font: 'mono', color: 'lime', anchor: 'end', parent: rg });
            var d = r[3] - r[2];
            ctx.text(1540, y, (d >= 0 ? '+' : '') + d.toFixed(3), { size: 13, font: 'mono', color: d >= 0 ? 'lime' : 'red', anchor: 'end', parent: rg });
            return rg;
          });
          ctx.reveal(T, { from: 'right', delay: 200 });
          ctx.reveal(rows, { from: 'left', stagger: 90, delay: 400 });
          ctx.text(830, 740, '8 of 16 dims shown · dynamic ↑ trades against consistency ↓', { size: 12, font: 'mono', color: 'amber', parent: T });
          ctx.hud('v2: dynamic degree +0.31 · subject consistency −0.011');
          return ctx.wait(1300).then(function () {
            pb.setAttribute('opacity', 1);
            return ctx.tween(1600, function (t) {
              pb.setAttribute('points', D.map(function (d, i) { var p = pt(i, ctx.lerp(A[i], B[i], t)); return p[0] + ',' + p[1]; }).join(' '));
            }, 'inOut');
          }).then(function () {
            return ctx.pulse(rows[3], { color: 'amber', dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Human preference & Elo',
        say: 'The ground truth is people. Raters see two clips for the same prompt, side by side in random order, and pick the better one. Thousands of these pairwise votes are turned into ratings with the Elo or Bradley Terry model, where the rating gap predicts the win probability. Watch four models start level and separate as votes accumulate. The confidence intervals matter: two models forty points apart are clearly different, but two that overlap are statistically tied.',
        deep: '<p><b>Bradley–Terry</b>: each model i has strength β<sub>i</sub>; in Elo units R = 400·β/ln 10:</p>' +
          '<div class="eq">P(i ≻ j) = 1 / (1 + 10<sup>(R<sub>j</sub> − R<sub>i</sub>)/400</sup>)</div>' +
          '<p><b>Online Elo</b> updates after each vote with S ∈ {0, ½, 1}:</p>' +
          '<div class="eq">R<sub>i</sub> ← R<sub>i</sub> + K·(S − P(i ≻ j))</div>' +
          '<p>Online Elo depends on vote order; arenas (Chatbot Arena, video arenas) instead fit BT by <b>maximum likelihood</b> over all votes and report <b>bootstrap CIs</b>. With ~n comparisons near 50/50, the rating SE ≈ (400/ln 10)/√(n/4) — about ±15 Elo (95%) at n ≈ 2,000 per model.</p>' +
          '<ul><li><b>Protocol</b>: same prompt, randomised left/right, blind to model, ties allowed, attention checks; stratify prompts (motion, faces, text, physics).</li>' +
          '<li><b>Multi-axis</b>: ask separately for prompt adherence, visual quality, motion — one "overall" vote hides trade-offs.</li>' +
          '<li><b>Style confounds</b>: longer/brighter clips win; control with covariates in the BT model.</li></ul>' +
          '<div class="note">A 100-point gap ≈ 64% win rate; 40 points ≈ 56%.</div>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 3);
          var g = bench(ctx);
          /* voting UI */
          var V = ctx.group({ parent: g });
          panel(ctx, V, 40, 190, 700, 330, 'amber', 'PAIRWISE VOTE · same prompt, random order, blind');
          var cardA = ctx.rect(70, 236, 300, 200, { rx: 8, fill: ctx.alpha('lime', 0.08), stroke: ctx.alpha('lime', 0.5), parent: V });
          var cardB = ctx.rect(410, 236, 300, 200, { rx: 8, fill: ctx.alpha('cyan', 0.08), stroke: ctx.alpha('cyan', 0.5), parent: V });
          ctx.icon('film', 220, 326, 60, 'lime', { parent: V });
          ctx.icon('film', 560, 326, 60, 'cyan', { parent: V });
          ctx.text(220, 410, 'clip A', { size: 14, font: 'mono', color: 'lime', anchor: 'middle', parent: V });
          ctx.text(560, 410, 'clip B', { size: 14, font: 'mono', color: 'cyan', anchor: 'middle', parent: V });
          var vA = ctx.label(220, 476, 'A is better', { color: 'lime', size: 12, w: 130, parent: V });
          ctx.label(390, 476, 'tie', { color: 'dim', size: 12, w: 70, parent: V });
          ctx.label(560, 476, 'B is better', { color: 'cyan', size: 12, w: 130, parent: V });
          var votes = ctx.text(700, 212, 'votes 0', { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: V });
          ctx.reveal(V, { from: 'left' });
          /* simulate */
          var NAMES = ['ours v2', 'ours v1', 'baseline A', 'baseline B'], TRUE = [1130, 1065, 1000, 955], COLS = ['lime', 'cyan', 'violet', 'orange'];
          /* simulate votes from true strengths; refit Bradley-Terry by MLE (MM updates) every 100 votes */
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
          var P = ctx.group({ parent: g });
          panel(ctx, P, 780, 190, 780, 400, 'amber', 'RATINGS vs VOTES (Bradley–Terry MLE, refit every 100)');
          var curves = hist.map(function (h, m) {
            var pl = ctx.plot(850, 240, 660, 300, h, { xDomain: [0, NV], yDomain: [880, 1200], color: COLS[m], sw: 2, axes: m === 0, xLabel: m === 0 ? 'votes' : null, parent: P });
            pl.curve.setAttribute('opacity', 0);
            return pl;
          });
          [900, 1000, 1100, 1200].forEach(function (r) { var q = curves[0].toPx(0, r); ctx.text(q.x - 8, q.y, String(r), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: P }); });
          ctx.reveal(P, { from: 'right', delay: 150 });
          /* leaderboard */
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
          /* equations */
          var EQ = ctx.group({ parent: g });
          panel(ctx, EQ, 40, 540, 700, 290, 'amber', 'BRADLEY–TERRY / ELO');
          ctx.text(66, 600, 'P(i ≻ j) = 1 / (1 + 10^((Rj − Ri)/400))', { size: 16, font: 'mono', color: 'white', parent: EQ });
          ctx.text(66, 640, 'Ri ← Ri + K · (S − P(i ≻ j))', { size: 16, font: 'mono', color: 'white', parent: EQ });
          ctx.para(66, 690, ['100 Elo ≈ 64% win rate · 40 Elo ≈ 56%', 'final board: BT maximum likelihood + bootstrap CI', 'randomise sides · ask per axis · control for style'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: EQ });
          ctx.reveal(EQ, { from: 'up', delay: 300 });
          ctx.hud('4,000 votes · rating SE ≈ ±15 Elo');
          return ctx.wait(600).then(function () {
            ctx.pulse(cardA, { color: 'lime', dur: 500 });
            ctx.pulse(vA, { color: 'lime', dur: 500 });
            var ps = curves.map(function (c) { c.curve.setAttribute('opacity', 1); return ctx.reveal(c.curve, { from: 'draw', dur: 2600, ease: 'linear' }); });
            ps.push(ctx.counter(votes, 0, NV, 2600, function (x) { return 'votes ' + Math.round(x).toLocaleString('en-US'); }));
            return Promise.all(ps);
          }).then(function () {
            return ctx.reveal(LB, { from: 'up' }).then(function () { return ctx.reveal(lbRows, { from: 'left', stagger: 120 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'VLM-as-judge',
        say: 'Humans do not scale to every render, so the critic agent is a vision language model acting as judge. It receives sampled frames, the prompt, the style sketches and a rubric with anchored descriptions for each score, and returns structured scores with a rationale. A judge is only trustworthy once calibrated: on a held out set rated by humans, we measure rank correlation, check that swapping the clip order does not flip the verdict, and watch for drift whenever the judge model changes.',
        deep: '<p><b>Judge input</b>: 8–16 frames sampled across the shot (plus a motion summary, since many VLMs see few frames), the shot prompt, reference sketches, and a <b>rubric</b> with anchors for each level (1 = "visor geometry changes between frames", 5 = "identity stable in every frame").</p>' +
          '<p><b>Output</b>: JSON via constrained decoding — per-dimension integer scores, rationale and a localised defect (timestamp range) that the director can act on.</p>' +
          '<p><b>Calibration</b> against a human-labelled set (hundreds of clips, ≥3 raters each):</p>' +
          '<div class="eq">ρ<sub>s</sub> = Pearson(rank(judge), rank(human)); &nbsp; κ<sub>w</sub> for ordinal agreement</div>' +
          '<ul><li><b>Position bias</b>: in pairwise mode, judge both orders; count only order-consistent verdicts.</li>' +
          '<li><b>Self-preference</b>: a judge from the same family as the generator/prompt-writer inflates scores — use a different model family.</li>' +
          '<li><b>Scale compression</b>: judges avoid extremes — calibrate thresholds on the human set (e.g. isotonic mapping).</li>' +
          '<li><b>Drift</b>: re-run the calibration suite on every judge-model or rubric change; treat the judge as a versioned model with its own regression gate.</li></ul>' +
          '<div class="note">Judges are strongest at <i>detecting specific defects</i> with a clear rubric and weakest at holistic aesthetics — keep humans for the latter.</div>',
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
          RUB.forEach(function (r, k) {
            var y = 320 + k * 50;
            ctx.text(64, y, r[0], { size: 13, font: 'mono', color: 'white', parent: IN });
            ctx.text(64, y + 19, r[1], { size: 12, font: 'mono', color: 'magenta', parent: IN });
          });
          ctx.reveal(IN, { from: 'left' });
          var js = code(ctx, g, { x: 570, y: 190, w: 380, title: 'judge → critic.shot3.json', lang: 'json', size: 12, typing: true, lines: [
            '{"adherence": 4,',
            ' "identity": 2,',
            ' "physics": 3,',
            ' "artefacts": 2,',
            ' "style": 4,',
            ' "defect": {"t": [3.1, 3.6],',
            '   "what": "visor flicker"},',
            ' "verdict": "redo"}'
          ] });
          ctx.reveal(js, { from: 'up', delay: 200 });
          var act = ctx.group({ parent: g });
          ctx.line(760, 392, 760, 440, { color: 'magenta', arrow: true, parent: act });
          ctx.label(760, 462, 'director: redo shot 3 (retries ≤ 2)', { color: 'magenta', size: 12, parent: act });
          ctx.para(580, 510, ['judge ≠ writer model family', 'JSON via constrained decoding', 'defect localised in time → fixable'], { size: 12, font: 'mono', color: 'dim', lh: 20, parent: act });
          ctx.reveal(act, { from: 'up', delay: 900 });
          /* calibration scatter */
          var rn = ctx.rng(77), hu = [], ju = [];
          for (var k = 0; k < 60; k++) {
            var h = 1 + 4 * rn();
            var j = h + 0.55 * gauss(rn) + 0.15 * (3 - h);
            j = Math.max(1, Math.min(5, Math.round(j * 2) / 2));
            hu.push(h); ju.push(j);
          }
          var rho = pearson(ranks(hu), ranks(ju));
          var SC = ctx.group({ parent: g });
          panel(ctx, SC, 980, 190, 580, 400, 'teal', 'CALIBRATION vs HUMANS (held-out)');
          var pl = ctx.plot(1050, 240, 460, 290, [[1, 1], [5, 5]], { xDomain: [1, 5], yDomain: [1, 5], color: ctx.alpha('white', 0.3), sw: 1.2, xLabel: 'human mean score', yLabel: 'judge score', parent: SC });
          var dots = hu.map(function (h, k) { var q = pl.toPx(h, ju[k]); return ctx.circle(q.x, q.y, 4, { fill: ctx.alpha('teal', 0.8), parent: SC }); });
          dots.forEach(function (d) { d.setAttribute('opacity', 0); });
          var rt = ctx.text(1080, 262, '', { size: 15, font: 'mono', weight: 700, color: 'white', parent: SC });
          ctx.reveal(SC, { from: 'right', delay: 200 });
          /* biases */
          var BI = ctx.group({ parent: g });
          panel(ctx, BI, 40, 620, 1520, 210, 'magenta', 'KNOWN BIASES → MITIGATIONS');
          var BL = [['position bias', 'judge both orders, keep order-consistent verdicts', '91% consistent'], ['self-preference', 'judge from a different model family than the writer', 'Δ +0.4 → +0.05'],
            ['scale compression', 'isotonic map judge → human scale; thresholds set on humans', 'uses 1–5 fully'], ['drift', 'versioned judge + calibration suite in CI', 'ρ ≥ 0.7 gate']];
          var br = BL.map(function (b, k) {
            var rg = ctx.group({ parent: BI });
            var y = 670 + k * 38;
            ctx.text(66, y, b[0], { size: 13, font: 'mono', color: 'white', weight: 600, parent: rg });
            ctx.text(290, y, b[1], { size: 13, font: 'mono', color: 'text', parent: rg });
            ctx.text(1530, y, b[2], { size: 13, font: 'mono', color: 'lime', anchor: 'end', parent: rg });
            return rg;
          });
          ctx.reveal(BI, { from: 'up', delay: 400 });
          ctx.reveal(br, { from: 'left', stagger: 100, delay: 600 });
          ctx.hud('judge vs human: Spearman ρ = ' + rho.toFixed(2) + ' (n = 60)');
          return js.typeAll().then(function () {
            ctx.pulse(fm[5], { color: 'red', dur: 700 });
            return Promise.all(dots.map(function (d, k) { return ctx.reveal(d, { from: 'scale', dur: 250, delay: k * 20 }); }));
          }).then(function () {
            return ctx.typeText(rt, 'Spearman ρ = ' + rho.toFixed(2) + '  (n = 60)', 700);
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Agent evals',
        say: 'Judging the film is not enough; we also judge how the agents made it. Task success checks hard constraints: thirty seconds, six shots, the creator\'s own voice, sketch style. Trajectory grading walks through every step: was the right tool called, were the arguments valid, were there wasted calls? And reliability matters more than luck. An agent that succeeds eighty percent of the time passes at least one of three tries almost always, but succeeds on all three only half the time.',
        deep: '<p><b>Outcome</b> (end state): programmatic checks where possible — duration 30 ± 1 s, 6 shots, narration speaker embedding = creator, style similarity to sketches ≥ τ, policy violations = 0 — plus judge scores for the rest.</p>' +
          '<p><b>Trajectory</b> (process): each step graded for tool choice, argument validity, redundancy and recovery; useful to localise failures and to reward efficient plans.</p>' +
          '<div class="eq">pass@k = 1 − (1 − p)<sup>k</sup> &nbsp;&nbsp; pass<sup>k</sup> = p<sup>k</sup></div>' +
          '<p>With per-trial success p = 0.8: pass@3 = 0.992 (research-demo metric: "can it ever do it?") but pass<sup>3</sup> = 0.512 (production metric from τ-bench: "does it do it <i>every</i> time?"). Users experience pass<sup>k</sup>.</p>' +
          '<ul><li><b>Cost and latency are eval metrics</b>: report success vs $/task and p95 wall-clock as a Pareto frontier; a config that is 2% better at 3× the cost is rarely the right choice.</li>' +
          '<li><b>Environment</b>: sandboxed tools with deterministic fakes (render_shot returns cached clips) make agent evals cheap and reproducible; a small fraction runs end-to-end on real GPUs.</li>' +
          '<li><b>Variance</b>: run each task ≥5 seeds; agent success rates have wide CIs at typical suite sizes (100–500 tasks).</li></ul>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 5);
          var g = bench(ctx);
          var TJ = [['plan', 'ok'], ['search_refs', 'ok'], ['search_refs', 'warn', 'redundant'], ['storyboard', 'ok'], ['render_shot ×6', 'ok'], ['critic', 'ok'],
            ['render_shot 3 dur=12', 'err', 'arg > max'], ['render_shot 3 dur=6', 'ok'], ['tts(voice=memo)', 'ok'], ['edit + encode', 'ok'], ['publish → confirm', 'ok']];
          var TC = { ok: 'lime', warn: 'amber', err: 'red' };
          ctx.text(60, 206, 'TRAJECTORY · graded step by step', { size: 13, font: 'display', weight: 700, color: 'teal', spacing: 1.2, parent: g });
          var chips = TJ.map(function (t, i) {
            var row = i < 6 ? 0 : 1, col = i < 6 ? i : i - 6;
            var x = 60 + col * 250, y = 244 + row * 62;
            var cg = ctx.group({ parent: g });
            ctx.rect(x, y - 18, 234, 36, { rx: 18, fill: ctx.alpha(TC[t[1]], 0.1), stroke: ctx.alpha(TC[t[1]], 0.7), sw: 1.2, parent: cg });
            ctx.icon(t[1] === 'ok' ? 'check' : 'warn', x + 20, y, 16, TC[t[1]], { parent: cg });
            ctx.text(x + 36, y, (i + 1) + ' ' + t[0], { size: 12, font: 'mono', color: 'white', parent: cg });
            if (t[2]) ctx.text(x + 117, y + 30, t[2], { size: 11, font: 'mono', color: TC[t[1]], anchor: 'middle', parent: cg });
            return cg;
          });
          ctx.text(1540, 306, 'trajectory score 0.86', { size: 14, font: 'mono', weight: 700, color: 'lime', anchor: 'end', parent: g });
          /* outcome checks */
          var OC = ctx.group({ parent: g });
          panel(ctx, OC, 40, 390, 500, 440, 'teal', 'OUTCOME CHECKS (task success)');
          var CK = [['duration 30.2 s ∈ 30 ± 1', 'program'], ['6 shots in EDL', 'program'], ['narration speaker = creator', 'ECAPA cos 0.83'], ['style sim to sketches ≥ 0.7', 'SigLIP 0.78'], ['policy violations = 0', 'audit log'], ['critic min score ≥ 3.5', 'VLM judge']];
          var cks = CK.map(function (c, k) {
            var rg = ctx.group({ parent: OC });
            var y = 446 + k * 46;
            ctx.icon('check', 70, y, 18, 'lime', { parent: rg });
            ctx.text(92, y, c[0], { size: 13, font: 'mono', color: 'white', parent: rg });
            ctx.text(516, y, c[1], { size: 12, font: 'mono', color: 'teal', anchor: 'end', parent: rg });
            return rg;
          });
          ctx.text(66, 740, 'SUCCESS', { size: 22, font: 'display', weight: 700, color: 'lime', parent: OC });
          ctx.text(66, 780, 'all constraints hold · 151 s · $4.61', { size: 13, font: 'mono', color: 'text', parent: OC });
          /* pass@k vs pass^k */
          var PK = ctx.group({ parent: g });
          panel(ctx, PK, 570, 390, 470, 440, 'amber', 'pass@k vs pass^k  (p = 0.8)');
          var ks = [1, 2, 3, 4, 5];
          var at = ks.map(function (k) { return 1 - Math.pow(0.2, k); }), pw = ks.map(function (k) { return Math.pow(0.8, k); });
          var vals = []; var cols = []; var labs = [];
          ks.forEach(function (k, i) { vals.push(0, 0); cols.push(C.cyan, C.amber); labs.push('k=' + k, ''); });
          var bars = ctx.bars(610, 450, 400, 250, vals, { color: cols, labels: labs, gap: 6, labelSize: 12, parent: PK });
          ctx.rect(610, 750, 12, 12, { rx: 2, fill: ctx.alpha('cyan', 0.75), parent: PK });
          ctx.text(630, 756, 'pass@k: any of k tries', { size: 12, font: 'mono', color: 'text', parent: PK });
          ctx.rect(610, 780, 12, 12, { rx: 2, fill: ctx.alpha('amber', 0.75), parent: PK });
          ctx.text(630, 786, 'pass^k: all k tries (what users feel)', { size: 12, font: 'mono', color: 'text', parent: PK });
          /* Pareto */
          var PA = ctx.group({ parent: g });
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
          ctx.reveal(chips, { from: 'left', stagger: 80 });
          ctx.reveal([OC, PK, PA], { from: 'up', stagger: 150, delay: 300 });
          ctx.reveal(cks, { from: 'left', stagger: 90, delay: 600 });
          ctx.hud('pass@3 = 0.992 · pass^3 = 0.512');
          return ctx.wait(1200).then(function () {
            var nv = [];
            ks.forEach(function (k, i) { nv.push(at[i], pw[i]); });
            return bars.update(nv, 1000);
          }).then(function () {
            return ctx.pulse(chips[6], { color: 'red', dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Trace waterfall',
        say: 'Here is the actual trace of our trailer job, one tree of spans under a single trace identifier. The director\'s planning call, the reference encoders, the storyboard, then six shots waiting in the queue and sampling in parallel on eight GPUs each. The critic flags shot three and a retry span appears. Narration overlaps the render, and edit, encode and signing close the job at about one hundred fifty one seconds. Click any span to inspect its attributes, including token counts and cache hits.',
        deep: '<p>Spans follow the OpenTelemetry <b>GenAI semantic conventions</b> where they exist: <code>invoke_agent {name}</code>, <code>chat {model}</code>, <code>execute_tool {tool}</code> with <code>gen_ai.request.model</code>, <code>gen_ai.usage.input_tokens</code>, <code>gen_ai.usage.output_tokens</code>. Everything else is a custom namespace: cache-read tokens, TTFT, GPU type/count, GPU-seconds, queue wait, retry attempt and reason, cost.</p>' +
          '<ul><li><b>Critical path</b> = the chain of spans that determines end-to-end latency: plan → storyboard → DiT (incl. queue) → critic → retry → edit/encode/sign. Reference encoding and narration run in parallel with slack — optimising them saves nothing.</li>' +
          '<li><b>Retry visibility</b>: the retry is a sibling span with <code>retry.attempt = 2</code> and a link to the critic span that caused it — so "why did this job take 151 s?" is answerable in one click.</li>' +
          '<li><b>Async boundaries</b>: GPU jobs run in another service minutes later; the trace context travels in the job message, and span links join fan-out/fan-in.</li>' +
          '<li><b>Sampling</b>: keep 100% of traces for errors, retries and SLO breaches (tail-based sampling in the collector), a few % of the rest.</li></ul>' +
          '<div class="note">Prompt and completion bodies (<code>gen_ai.input.messages</code> / <code>gen_ai.output.messages</code>) are <b>opt-in</b> in the GenAI conventions and off by default — enable them only with redaction, or ship them to a separate access-controlled store and keep a reference on the span, because they contain user data.</div>',
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
            [2, 'gpu asr memo', 0.8, 2.1, 'orange', ['app.gpu: 1×L40S', 'app.model: whisper-class', 'audio_s: 24', 'duration: 1.3 s']],
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
          var tl = ctx.group({ parent: g });
          [0, 30, 60, 90, 120, 150].forEach(function (s) {
            ctx.line(x0 + s * sc, y0 - 16, x0 + s * sc, y0 + (NR - 1) * dy + 16, { color: ctx.alpha('white', 0.06), parent: tl });
            ctx.text(x0 + s * sc, y0 + (NR - 1) * dy + 32, s + ' s', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: tl });
          });
          ctx.reveal(tl, {});
          var sel = ctx.rect(40, 0, 1110, 30, { rx: 6, fill: ctx.alpha('white', 0.05), stroke: ctx.alpha('white', 0.25), sw: 1, parent: g });
          /* attribute panel */
          var AP = ctx.group({ parent: g });
          panel(ctx, AP, 1170, 186, 390, 500, 'cyan', 'SPAN ATTRIBUTES');
          var apT = ctx.text(1190, 240, '', { size: 14, font: 'mono', weight: 700, color: 'white', parent: AP });
          var apL = [];
          for (var k = 0; k < 8; k++) apL.push(ctx.text(1190, 280 + k * 30, '', { size: 12, font: 'mono', color: 'text', parent: AP }));
          ctx.text(1190, 660, 'click any span', { size: 12, font: 'mono', color: 'dim', parent: AP });
          ctx.reveal(AP, { from: 'right', delay: 200 });
          function show(i) {
            var s = SP[i];
            sel.setAttribute('y', y0 + i * dy - 15);
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
          var cur = ctx.line(x0, y0 - 18, x0, y0 + (NR - 1) * dy + 16, { color: 'white', sw: 1.4, opacity: 0.7, parent: g });
          var ct = ctx.text(x0, y0 - 26, '0 s', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: g });
          var foot = ctx.group({ parent: g });
          ctx.rect(52, 730, 26, 12, { rx: 3, stroke: 'pink', sw: 2, parent: foot });
          ctx.text(88, 736, 'critical path: DiT + retry = 125 of 151 s (83%)', { size: 13, font: 'mono', color: 'pink', parent: foot });
          ctx.text(700, 736, 'tail-sampled: kept because it contains a retry', { size: 13, font: 'mono', color: 'dim', parent: foot });
          ctx.text(52, 768, 'trace_id 4bf92f3577b34da6a3ce929d0e0e4736 · 15 of 212 spans shown (5 sibling shot spans collapsed)', { size: 12, font: 'mono', color: 'dim', parent: foot });
          foot.setAttribute('opacity', 0);
          ctx.hud('trace 4bf92f35… · 151 s · 212 spans');
          show(2);
          return ctx.wait(500).then(function () {
            return ctx.tween(4200, function (t) {
              var tc = t * 151;
              cur.setAttribute('x1', x0 + tc * sc); cur.setAttribute('x2', x0 + tc * sc);
              ct.setAttribute('x', x0 + tc * sc); ct.textContent = Math.round(tc) + ' s';
              SP.forEach(function (s, i) {
                var f = ctx.clamp((tc - s[2]) / Math.max(0.1, s[3] - s[2]), 0, 1);
                rows[i].bar.setAttribute('width', rows[i].bar.w * f);
                if (tc >= s[2]) rows[i].name.setAttribute('opacity', 1);
              });
            }, 'linear');
          }).then(function () {
            cur.setAttribute('opacity', 0); ct.setAttribute('opacity', 0);
            CRIT.forEach(function (i) { rows[i].bar.setAttribute('stroke', C.pink); rows[i].bar.setAttribute('stroke-width', 2.6); });
            ctx.reveal(foot, {});
            show(12);
            return ctx.pulse(rows[12].bar, { color: 'red', dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'Metrics & SLOs',
        say: 'Traces explain one job; metrics watch the fleet. Latency is a distribution, not a number: time to first token has a median near two hundred milliseconds but a long tail past one and a half seconds, and users remember the tail. GPU utilization looks like ninety percent while model FLOPs utilization is closer to forty. Queue wait on the video pool and structured logs keyed by the trace identifier complete the picture. Service level objectives turn this into policy: ninety nine percent of trailers finish within ten minutes, and the one percent error budget decides when we stop shipping features and fix reliability.',
        deep: '<p><b>Percentiles, not means</b>: TTFT here is log-normal with median 210 ms and σ = 0.9 → p99 = 210·e<sup>2.326·0.9</sup> ≈ 1.7 s. Tail sources: long prefills, queueing behind big batches, KV-cache eviction, cold replicas.</p>' +
          '<p><b>Utilisation</b>: nvidia-smi "GPU util" is the fraction of time <i>any</i> kernel runs; it says nothing about how busy the SMs are. Track:</p>' +
          '<div class="eq">MFU = achieved model FLOP/s ÷ peak (≈ 989 TFLOP/s dense BF16, H100 SXM)</div>' +
          '<p>plus SM occupancy, HBM bandwidth and NVLink utilisation (DCGM exporters). DiT sampling is compute-bound (MFU 35–55%); LLM decode is bandwidth-bound (low MFU is expected — watch tokens/s/GPU instead).</p>' +
          '<p><b>Queue wait</b> (histogram per pool and priority) is the autoscaler\'s leading signal. <b>Logs</b> are structured JSON carrying <code>trace_id</code>/<code>span_id</code>, so a log line jumps to its span.</p>' +
          '<p><b>SLO &amp; error budget</b>: SLO = 99% of jobs complete &lt; 10 min over 28 days → budget = 1% of jobs. A job is "bad" if it fails, exceeds 10 min, or is abandoned after a system error.</p>' +
          '<div class="eq">burn rate b = (bad / total) ÷ (1 − SLO)</div>' +
          '<ul><li><b>Page</b> if b &gt; 14.4 over both 1 h and 5 min (≈2% of the budget in an hour); <b>ticket</b> if b &gt; 6 over 6 h and 30 min (SRE Workbook multiwindow, multi-burn-rate alerts).</li>' +
          '<li>Budget exhausted → feature freeze for this service; reliability work takes priority.</li></ul>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          rail(ctx, 7);
          var g = bench(ctx);
          /* A: TTFT histogram */
          var A = ctx.group({ parent: g });
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
          ctx.reveal(A, { from: 'left' });
          /* B: GPU utilisation */
          var B = ctx.group({ parent: g });
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
          ctx.reveal(B, { from: 'up', delay: 150 });
          /* C: error budget */
          var Cc = ctx.group({ parent: g });
          panel(ctx, Cc, 1080, 190, 480, 360, 'teal', 'ERROR BUDGET · 28-day window');
          var pts = [];
          for (var d = 0; d <= 28; d += 0.5) { var r = 100 - 0.6 * 100 / 28 * d - (d >= 17 ? 30 : 0); pts.push([d, Math.max(0, r)]); }
          var eb = ctx.plot(1130, 240, 400, 240, pts, { xDomain: [0, 28], yDomain: [0, 100], color: 'teal', sw: 2, xLabel: 'day', yLabel: 'budget left %', parent: Cc });
          var ideal = ctx.plot(1130, 240, 400, 240, [[0, 100], [28, 0]], { xDomain: [0, 28], yDomain: [0, 100], color: ctx.alpha('white', 0.3), sw: 1.2, axes: false, parent: Cc });
          ideal.curve.setAttribute('stroke-dasharray', '5 5');
          eb.curve.setAttribute('opacity', 0);
          var inc = eb.toPx(17, 60);
          var incL = ctx.label(inc.x - 10, inc.y - 70, 'incident: b = 20× → page', { color: 'red', size: 11, parent: Cc });
          incL.setAttribute('opacity', 0);
          ctx.text(1110, 520, 'ends at 10% left · dashed = exactly-on-SLO burn', { size: 12, font: 'mono', color: 'dim', parent: Cc });
          ctx.reveal(Cc, { from: 'right', delay: 300 });
          /* bottom: policy */
          var P = ctx.group({ parent: g });
          panel(ctx, P, 40, 580, 1520, 250, 'teal', 'SLO POLICY');
          ctx.text(66, 632, 'SLO: 99% of trailer jobs complete < 10 min (28 d)  →  error budget = 1% ≈ 2,800 of 280k jobs', { size: 14, font: 'mono', color: 'white', parent: P });
          ctx.text(66, 672, 'burn rate  b = (bad / total) ÷ (1 − SLO)', { size: 16, font: 'mono', color: 'teal', parent: P });
          ctx.text(66, 712, 'page:   b > 14.4 over 1 h AND 5 min   (≈ 2% of budget per hour)', { size: 14, font: 'mono', color: 'red', parent: P });
          ctx.text(66, 744, 'ticket: b > 6 over 6 h AND 30 min', { size: 14, font: 'mono', color: 'amber', parent: P });
          ctx.text(66, 784, 'budget exhausted → feature freeze; reliability work first', { size: 14, font: 'mono', color: 'lime', parent: P });
          ctx.line(930, 596, 930, 814, { color: ctx.alpha('teal', 0.3), parent: P });
          ctx.text(950, 604, 'QUEUES · LOGS', { size: 13, font: 'display', weight: 700, color: 'cyan', spacing: 1.2, parent: P });
          var QW = [['video pool queue wait', 'p50 1.8 s', 'p95 18 s', 'lime'], ['LLM queue (in TTFT)', 'p50 20 ms', 'p99 0.9 s', 'amber']];
          QW.forEach(function (q, k) {
            var y = 638 + k * 26;
            ctx.text(950, y, q[0], { size: 12, font: 'mono', color: 'text', parent: P });
            ctx.text(1400, y, q[1], { size: 12, font: 'mono', color: q[3], anchor: 'end', parent: P });
            ctx.text(1536, y, q[2], { size: 12, font: 'mono', color: q[3], anchor: 'end', parent: P });
          });
          code(ctx, P, { x: 950, y: 690, w: 590, title: 'log · structured, joined by trace_id', lang: 'json', size: 11, color: 'cyan', lines: [
            '{"lvl":"WARN","svc":"orchestrator","msg":"critic redo",',
            ' "trace_id":"4bf92f35…","span_id":"a3ce929d…","shot":3}'
          ] });
          ctx.reveal(P, { from: 'up', delay: 400 });
          ctx.hud('TTFT p50 ' + Math.round(p50) + ' ms · p99 ' + (p99 / 1000).toFixed(1) + ' s · fleet MFU 41%');
          return ctx.wait(600).then(function () {
            var mx = Math.max.apply(null, hv);
            return Promise.all([hb.update(hv.map(function (v) { return v / mx; }), 900)].concat(gb.map(function (b, k) { return ctx.tween(700, function (t) { b.setAttribute('width', b.w * t); }, 'out', k * 100); })));
          }).then(function () {
            eb.curve.setAttribute('opacity', 1);
            return ctx.reveal(eb.curve, { from: 'draw', dur: 1500, ease: 'linear' });
          }).then(function () {
            ctx.reveal(incL, { from: 'up' });
            return ctx.pulse(incL, { color: 'red', dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 9 */
      {
        title: 'Cost & release gates',
        say: 'Finally, money and change. Cost is accounted per span and rolled up per job: diffusion sampling dominates, then language model tokens. Divide by accepted minutes, not generated ones, because abandoned and rejected renders still burn GPUs. And every change, a new video model, a new prompt, a new judge, must pass the same gate: the offline suite, non-inferiority checks on every metric, a small canary, then an A B test with guardrails. Only then does it reach every creator.',
        deep: '<p><b>Unit economics</b>: cost per <i>delivered</i> minute = total spend / accepted minutes. Illustrative: $4.61 per 30 s job → $9.22/min generated; with 12% of jobs abandoned or rejected, $10.48/min delivered. Levers: few-step distillation (40 → 8 steps cuts DiT cost ~5×), prefix caching (LLM input cost −40–70%), early abort, draft-then-upscale.</p>' +
          '<p><b>Regression gate</b> (per metric m, candidate vs control): pass if the lower CI bound of Δ<sub>m</sub> clears a non-inferiority margin −δ<sub>m</sub>; improvements need not be significant, <i>regressions</i> must be ruled out (for lower-is-better metrics such as latency and $/min, the upper bound must stay below +δ<sub>m</sub>).</p>' +
          '<div class="eq">ship ⇔ ∀m: CI<sub>95</sub>(Δ<sub>m</sub>).lower &gt; −δ<sub>m</sub> &nbsp;∧&nbsp; safety ASR ≤ bound</div>' +
          '<ul><li><b>Canary</b> (1% of traffic, hours): catches crashes, latency and cost blow-ups the offline suite cannot see.</li>' +
          '<li><b>A/B</b> (50/50, days): primary metric (e.g. export/completion rate) with <b>CUPED</b> variance reduction using pre-period behaviour, plus guardrails (p99 latency, $/min, safety escalations). Watch for sample-ratio mismatch.</li>' +
          '<li>Multiple metrics ⇒ multiple comparisons: pre-register the primary metric; treat the rest as guardrails.</li></ul>' +
          '<div class="note">The same gate applies to prompts, policies and judges — they are all models of the system.</div>',
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
          var segs = CO.map(function (c, k) {
            var r = ctx.rect(sx + acc / tot * sw, 250, 0, 34, { rx: 2, fill: ctx.alpha(c[2], 0.65), stroke: c[2], sw: 1, parent: L });
            r.w = c[1] / tot * sw; acc += c[1];
            ctx.rect(sx, 316 + k * 32, 12, 12, { rx: 2, fill: ctx.alpha(c[2], 0.8), parent: L });
            ctx.text(sx + 22, 322 + k * 32, c[0], { size: 13, font: 'mono', color: 'text', parent: L });
            ctx.text(sx + sw, 322 + k * 32, '$' + c[1].toFixed(2) + '  ' + Math.round(c[1] / tot * 100) + '%', { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: L });
            return r;
          });
          ctx.line(sx, 454, sx + sw, 454, { color: 'faint', parent: L });
          var RW = [['per 30 s job', '$' + tot.toFixed(2)], ['per generated minute', '$' + (tot * 2).toFixed(2)], ['12% abandoned / rejected', '÷ 0.88'], ['per DELIVERED minute', '$' + (tot * 2 / 0.88).toFixed(2)]];
          var rw = RW.map(function (r, k) {
            var rg = ctx.group({ parent: L });
            var y = 486 + k * 36;
            ctx.text(sx, y, r[0], { size: 14, font: 'mono', color: k === 3 ? 'white' : 'text', weight: k === 3 ? 700 : 400, parent: rg });
            ctx.text(sx + sw, y, r[1], { size: k === 3 ? 20 : 14, font: 'mono', weight: 700, color: k === 3 ? 'lime' : 'white', anchor: 'end', parent: rg });
            return rg;
          });
          ctx.text(sx, 660, 'LEVERS', { size: 13, font: 'display', weight: 700, color: 'lime', spacing: 1, parent: L });
          ctx.para(sx, 692, ['distil 40 → 8 steps      DiT cost ≈ ÷5', 'prefix caching           LLM input −40–70%', 'early abort + drafts     fewer wasted renders'], { size: 13, font: 'mono', color: 'text', lh: 28, parent: L });
          ctx.reveal(L, { from: 'left' });
          /* release gate */
          var R = ctx.group({ parent: g });
          panel(ctx, R, 630, 190, 930, 640, 'teal', 'RELEASE GATE · candidate video model v2.1');
          var ST = ['offline suite', 'regression gate', 'canary 1%', 'A/B 50/50', 'rollout'];
          var stn = ST.map(function (s, k) { return ctx.label(720 + k * 186, 250, s, { color: 'teal', size: 12, w: 150, parent: R }); });
          var stl = [];
          for (var k = 0; k < 4; k++) stl.push(ctx.line(797 + k * 186, 250, 829 + k * 186, 250, { color: 'dim', arrow: true, parent: R }));
          var HX = [660, 1000, 1160, 1330, 1540];
          ['metric', 'Δ vs v2', '95% CI', 'margin δ', ''].forEach(function (h, i) { ctx.text(HX[i], 300, h, { size: 12, font: 'mono', color: 'dim', anchor: i ? 'end' : 'start', parent: R }); });
          var GT = [['VBench subject consistency', '−0.4%', '[−0.9, +0.1]', '−1.0%'], ['VBench dynamic degree', '+6.1%', '[+4.2, +8.0]', '−2.0%'], ['human Elo (pairwise)', '+18', '[+6, +30]', '−10'],
            ['agent task success', '+1.2 pt', '[−0.8, +3.2]', '−2 pt'], ['p99 job latency', '+3%', '[+1, +5]', '+10%'], ['$ per delivered min', '−14%', '[−16, −12]', '+5%'], ['exfiltration ASR (red team)', '0.5%', '[0.2, 0.9]', '≤ 1%']];
          var WORSE = [true, false, false, false, true, false, false];
          var gt = GT.map(function (r, k) {
            var rg = ctx.group({ parent: R });
            var y = 336 + k * 38;
            ctx.text(HX[0], y, r[0], { size: 13, font: 'mono', color: 'white', parent: rg });
            for (var c = 1; c < 4; c++) ctx.text(HX[c], y, r[c], { size: 13, font: 'mono', color: c === 1 ? (WORSE[k] ? 'amber' : 'lime') : 'text', anchor: 'end', parent: rg });
            ctx.icon('check', HX[4] - 8, y, 16, 'lime', { parent: rg });
            return rg;
          });
          var ab = ctx.group({ parent: R });
          ctx.rect(656, 624, 880, 180, { rx: 8, fill: ctx.alpha('cyan', 0.05), stroke: ctx.alpha('cyan', 0.4), sw: 1, parent: ab });
          ctx.text(676, 652, 'A/B (7 days, 50/50, CUPED)', { size: 13, font: 'display', weight: 700, color: 'cyan', spacing: 1, parent: ab });
          ctx.text(676, 688, 'primary: export rate  +2.3%  (95% CI +0.8 … +3.8, p = 0.004)', { size: 13, font: 'mono', color: 'lime', parent: ab });
          ctx.text(676, 718, 'CUPED: variance −38% using pre-period export rate', { size: 13, font: 'mono', color: 'text', parent: ab });
          ctx.text(676, 748, 'guardrails: p99 latency ✓  $/min ✓  safety escalations ✓  SRM ✓', { size: 13, font: 'mono', color: 'text', parent: ab });
          ctx.text(676, 780, 'verdict: SHIP v2.1', { size: 15, font: 'mono', weight: 700, color: 'lime', parent: ab });
          ctx.reveal(R, { from: 'right', delay: 150 });
          gt.forEach(function (r) { r.setAttribute('opacity', 0); });
          ab.setAttribute('opacity', 0);
          var tok = ctx.circle(720, 250, 8, { fill: 'lime', glow: true, parent: R });
          ctx.hud('$' + (tot * 2 / 0.88).toFixed(2) + ' per delivered minute · v2.1 passes every gate');
          return ctx.wait(600).then(function () {
            return Promise.all(segs.map(function (r, k) { return ctx.tween(500, function (t) { r.setAttribute('width', r.w * t); }, 'out', k * 120); }));
          }).then(function () {
            ctx.reveal(rw, { from: 'left', stagger: 120 });
            var ch = Promise.resolve();
            ST.forEach(function (s, k) {
              ch = ch.then(function () {
                return ctx.tween(350, function (t) { tok.setAttribute('cx', 720 + (k + t - 1 < 0 ? 0 : (k - 1 + t) * 186)); }, 'inOut').then(function () {
                  if (k === 1) return ctx.reveal(gt, { from: 'left', stagger: 90 });
                  if (k === 3) return ctx.reveal(ab, { from: 'up' });
                  return ctx.pulse(stn[k], { color: 'teal', dur: 400 });
                });
              });
            });
            return ch;
          }).then(function () {
            tok.setAttribute('opacity', 0);
            stn[4].firstChild.setAttribute('fill', ctx.alpha('lime', 0.3));
            stn[4].firstChild.setAttribute('stroke', C.lime);
            return ctx.pulse(stn[4], { color: 'lime', times: 2, dur: 500 });
          });
        }
      }
    ]
  });
})();
