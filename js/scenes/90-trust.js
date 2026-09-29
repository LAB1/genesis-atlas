/* L1 — Safety, Evaluation & Observability. Trust and operations layered across the whole pipeline:
 * checkpoints (ingress, policy, generation-time, egress, provenance), the audit log, evaluation loops
 * and telemetry, lighting up hop by hop for the fox-astronaut trailer request. */
(function () {
  var SX = [300, 536, 772, 1008, 1244, 1480];
  var STAGES = [
    ['Client', 'text · 3 img · audio', 'phone', 'cyan'],
    ['Gateway', 'auth · quota · scan', 'shield', 'blue'],
    ['Agents', 'plan · tool calls', 'agent', 'magenta'],
    ['Generation', 'LLM · DiT · TTS', 'film', 'lime'],
    ['Post · Encode', 'edit · mux · ABR', 'music', 'orange'],
    ['Delivery', 'sign · CDN · play', 'globe', 'cyan']
  ];
  var CPN = [null, 'ingress moderation', 'policy · tools', 'gen-time controls', 'egress classify', 'provenance'];

  /* ---------- helpers ---------- */
  function keepSpaces(g) {
    function keep(t) { t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.style.whiteSpace = 'pre'; }
    g.lineEls.forEach(keep);
    var add = g.addLine;
    g.addLine = function (s, inst) { var p = add(s, inst); keep(g.lineEls[g.lineEls.length - 1]); return p; };
    return g;
  }
  function code(ctx, parent, o) { o.parent = parent; return keepSpaces(ctx.code(o)); }

  function bench(ctx, title, col) {
    var S = ctx.state;
    (S.benchLoops || []).forEach(function (h) { h.stop(); });
    S.benchLoops = [];
    if (S.bench) ctx.remove(S.bench, 350);
    S.bench = ctx.group();
    if (title) ctx.text(40, 482, title, { size: 14, font: 'display', weight: 700, color: col || 'pink', spacing: 1.2, parent: S.bench });
    return S.bench;
  }

  function mkCP(ctx, i, parent) {
    var x = SX[i], y = 296, name = CPN[i];
    var g = ctx.group({ parent: parent });
    ctx.line(x, 257, x, 280, { color: ctx.alpha('pink', 0.3), dash: '2 3', sw: 1.2, parent: g });
    var ring = ctx.circle(x, y, 15, { fill: ctx.alpha('pink', 0.04), stroke: ctx.alpha('pink', 0.3), sw: 1.4, parent: g });
    var ic = ctx.icon('shield', x, y, 16, ctx.alpha('pink', 0.4), { parent: g });
    var w = name.length * 7.3 + 20;
    var chip = ctx.rect(x - w / 2, 319, w, 22, { rx: 11, fill: ctx.alpha('pink', 0.03), stroke: ctx.alpha('pink', 0.25), sw: 1, parent: g });
    var t = ctx.text(x, 330.5, name, { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
    return { g: g, ring: ring, ic: ic, chip: chip, t: t, on: false };
  }

  function lightCP(ctx, i) {
    var cp = ctx.state.cps[i], C = ctx.C;
    if (!cp) return Promise.resolve();
    if (!cp.on) {
      cp.on = true;
      cp.ring.setAttribute('fill', ctx.alpha('pink', 0.22));
      cp.ring.setAttribute('stroke', C.pink);
      cp.ring.setAttribute('filter', 'url(#fx-glow)');
      cp.ic.firstChild.setAttribute('stroke', C.white);
      cp.chip.setAttribute('fill', ctx.alpha('pink', 0.16));
      cp.chip.setAttribute('stroke', ctx.alpha('pink', 0.85));
      cp.t.setAttribute('fill', C.pink);
    }
    return ctx.pulse(cp.ring, { color: 'pink', dur: 700 });
  }

  function buildMap(ctx) {
    var S = ctx.state;
    S.map = ctx.group();
    ctx.text(40, 225, 'PIPELINE', { size: 12, font: 'mono', color: 'dim', spacing: 1.5, parent: S.map });
    S.stages = STAGES.map(function (s, i) {
      return ctx.node({ x: SX[i], y: 225, w: 196, h: 58, title: s[0], sub: s[1], icon: s[2], color: s[3], titleSize: 14, subSize: 11, parent: S.map });
    });
    S.links = [];
    for (var i = 0; i < 5; i++) S.links.push(ctx.link(S.stages[i], S.stages[i + 1], { color: ctx.alpha('white', 0.35), straight: true, sw: 1.4, parent: S.map }));
    S.cpG = ctx.group({ parent: S.map });
    S.cps = CPN.map(function (n, i) { return n ? mkCP(ctx, i, S.cpG) : null; });
    /* rails */
    S.auditRail = ctx.line(205, 366, 1578, 366, { color: ctx.alpha('pink', 0.22), dash: '3 6', sw: 1.2, parent: S.map });
    S.auditT = ctx.text(40, 366, 'audit log', { size: 12, font: 'mono', color: 'dim', parent: S.map });
    S.obsRail = ctx.line(205, 412, 1578, 412, { color: ctx.alpha('teal', 0.22), dash: '3 6', sw: 1.2, parent: S.map });
    S.sep = ctx.line(30, 452, 1570, 452, { color: 'line', sw: 1, parent: S.map });
    /* lane headers = zoom targets */
    S.guard = ctx.node({ x: 108, y: 306, w: 176, h: 50, title: 'Guardrails', sub: 'policy · C2PA', icon: 'shield', color: 'pink', titleSize: 14, subSize: 11, parent: S.map });
    S.evo = ctx.node({ x: 108, y: 412, w: 176, h: 50, title: 'Evals · Obs', sub: 'quality · traces', icon: 'chart', color: 'teal', titleSize: 14, subSize: 11, parent: S.map });
    ctx.hotspot(S.guard, 'safety', { hint: 'SAFETY ⤢' });
    ctx.hotspot(S.evo, 'eval-obs', { hint: 'EVALS ⤢' });
    ctx.reveal(S.stages, { from: 'left', stagger: 110 });
    ctx.reveal(S.links, { from: 'draw', delay: 400, stagger: 110 });
    ctx.reveal(S.cps.filter(Boolean).map(function (c) { return c.g; }), { from: 'down', delay: 700, stagger: 100 });
    ctx.reveal([S.guard, S.evo], { from: 'left', delay: 900, stagger: 150 });
    ctx.reveal([S.auditRail, S.obsRail], { from: 'draw', delay: 1000 });
  }

  function card(ctx, g, x, y, w, h, col) {
    return ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.9)', stroke: ctx.alpha(col, 0.5), sw: 1.2, parent: g });
  }

  /* procedural keyframe: fox astronaut on a glowing ice moon (12 x 16) */
  function foxScene(r, c) {
    var dm = Math.sqrt((c - 12.5) * (c - 12.5) + (r - 3) * (r - 3));
    if (dm < 1.2) return '#f2fdff';
    if (dm < 2.7) return '#8fe6ff';
    if (r >= 9) return ((r * 7 + c * 3) % 5 === 0) ? '#d8f8ff' : '#2f9cc0';
    if ((r === 7 && c >= 4 && c <= 6) || (r === 8 && (c === 4 || c === 6)) || (r === 6 && c === 6) || (r === 5 && c === 6)) return '#ff8a3d';
    if (r === 6 && c === 7) return '#e8f1ff';
    if (r === 7 && c === 3) return '#ffb070';
    if ((r === 1 && c === 0) || (r === 2 && c === 1) || (r === 3 && c === 2) || (r === 4 && c === 3)) return '#b88a2a';
    return ((r * 13 + c * 7) % 17 === 0) ? '#6a82ad' : '#15244a';
  }
  function hex2(v) { var s = Math.round(v).toString(16); return s.length < 2 ? '0' + s : s; }

  Atlas.register({
    id: 'trust',
    refs: [
      'Reason, <i>Human Error</i> (the “Swiss cheese” model of layered defences), Cambridge University Press 1990',
      'Inan et al., <i>Llama Guard: LLM-based Input-Output Safeguard for Human-AI Conversations</i>, arXiv 2023',
      'Greshake et al., <i>Not what you\'ve signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection</i>, AISec 2023',
      'C2PA, <i>Content Credentials: C2PA Technical Specification</i> v2.1, 2024; Google DeepMind, <i>SynthID</i> (image/video watermarking), 2023–2025',
      'Huang et al., <i>VBench: Comprehensive Benchmark Suite for Video Generative Models</i>, CVPR 2024',
      'Sigelman et al., <i>Dapper, a Large-Scale Distributed Systems Tracing Infrastructure</i>, Google TR 2010; OpenTelemetry specification &amp; GenAI semantic conventions, 2024–2025',
      'Beyer et al., <i>Site Reliability Engineering</i> (SLOs, error budgets), O\'Reilly 2016; Kohavi, Tang &amp; Xu, <i>Trustworthy Online Controlled Experiments</i>, CUP 2020'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Defense in depth',
        say: 'Trust is not a box in the pipeline. It is a layer wrapped around every hop. As the trailer request travels from the client to delivery, it crosses five checkpoints: ingress moderation, agent policy, generation-time controls, egress classification, and provenance. Underneath runs an append-only audit log, and alongside runs a second plane that measures quality, latency and cost. No single layer is perfect, so the design goal is layers whose failures are uncorrelated.',
        deep: '<p>The trust plane is a <b>defence-in-depth</b> stack: each checkpoint has a different signal (hashes, classifiers, deterministic policy code, VLM judges, cryptography, humans), a different cost, and sees the job at a different moment.</p>' +
          '<div class="eq">P(miss) = ∏<sub>i</sub> (1 − r<sub>i</sub>) &nbsp;&nbsp; (independent layers)</div>' +
          '<p>Five layers with recall r<sub>i</sub> = 0.9 would miss only 10<sup>−5</sup> of harmful jobs — <i>if</i> their errors were independent. They are not: an adversarial prompt that fools one LLM-based filter often fools every LLM-based filter (same training data, same blind spots). Correlation ρ &gt; 0 pushes the true miss rate far above the product.</p>' +
          '<ul><li><b>Diversify signals</b>: perceptual hashes + learned classifiers + policy engines that do not read natural language at all.</li>' +
          '<li><b>Check actions, not just text</b>: a tool call with side effects is gated by argument policy even if every classifier said "benign".</li>' +
          '<li><b>Measure the plane itself</b>: every checkpoint emits a decision event (audit) and a span (trace), so false-positive rates and latency overhead are observable.</li></ul>' +
          '<div class="note">Threat model for the trailer job: harmful content, likeness/IP misuse, indirect prompt injection via the uploaded sketches, data exfiltration of the voice memo, GPU abuse, and silent quality regressions after a model upgrade.</div>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          ctx.camera(800, 300, 1.3, 10);
          buildMap(ctx);
          ctx.hud('5 checkpoints · 1 audit log · 1 trace per job');
          return ctx.wait(1300).then(function () {
            var chain = Promise.resolve();
            S.links.forEach(function (l, i) {
              chain = chain.then(function () {
                if (S.cps[i + 1]) ctx.after(250, function () { ctx.pulse(S.cps[i + 1].ring, { color: 'pink', dur: 600 }); });
                return ctx.packet(l, { color: 'cyan', dur: 480, label: i === 0 ? 'trailer job' : null });
              });
            });
            return chain;
          }).then(function () {
            return ctx.camera(null, null, null, 1000);
          }).then(function () {
            var g = bench(ctx, 'DEFENCE IN DEPTH · layered, diverse, independent', 'pink');
            var TH = [['harmful content', 'gore · sexual · minors', 'pink'], ['likeness · IP', 'real faces · cloned voices', 'violet'],
              ['prompt injection', 'text hidden in a sketch', 'magenta'], ['exfiltration', 'memo sent to a URL', 'amber'],
              ['abuse · cost', 'GPU farming · spam', 'red'], ['silent regression', 'v2 model worse at motion', 'teal']];
            var list = ctx.group({ parent: g });
            TH.forEach(function (t, i) {
              var y = 525 + i * 54;
              ctx.circle(56, y, 6, { fill: t[2], glow: true, parent: list });
              ctx.text(72, y - 8, t[0], { size: 14, font: 'display', weight: 600, color: 'white', parent: list });
              ctx.text(72, y + 11, t[1], { size: 12, font: 'mono', color: 'dim', parent: list });
            });
            ctx.reveal(list, { from: 'left' });
            var XS = [600, 720, 840, 960, 1080], LN = ['ingress', 'policy', 'gen-time', 'egress', 'provenance'];
            var slices = ctx.group({ parent: g });
            XS.forEach(function (x, j) {
              ctx.poly([[x - 14, 548], [x + 14, 530], [x + 14, 812], [x - 14, 830]], { fill: ctx.alpha('pink', 0.1), stroke: ctx.alpha('pink', 0.55), sw: 1.2, parent: slices });
              ctx.text(x, 852, LN[j], { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: slices });
            });
            var r = ctx.rng(42);
            var stops = [0, 1, 0, 2, 1, 3, 0, 2, 4, 1, 0, 3, 5, 2, 1, 0];
            var cols = ['pink', 'violet', 'magenta', 'amber', 'red', 'teal'];
            var dots = stops.map(function (s, i) {
              var y = 560 + (i / (stops.length - 1)) * 240 + (r() - 0.5) * 8;
              for (var j = 0; j < s && j < 5; j++) ctx.el('ellipse', { cx: XS[j], cy: y, rx: 5, ry: 6.5, fill: C.bg, stroke: ctx.alpha('pink', 0.5), 'stroke-width': 1 }, slices);
              var d = ctx.circle(510, y, 5, { fill: cols[i % 6], glow: true, parent: g });
              d.stopX = s < 5 ? XS[s] - 20 : 1150; d.pass = s === 5; d.yy = y;
              return d;
            });
            /* decoy holes that do not line up */
            for (var k = 0; k < 8; k++) ctx.el('ellipse', { cx: XS[k % 5], cy: 570 + r() * 230, rx: 5, ry: 7, fill: C.bg, stroke: ctx.alpha('pink', 0.35), 'stroke-width': 1 }, slices);
            ctx.reveal(slices, { from: 'scale', s0: 0.92 });
            ctx.reveal(dots, { stagger: 30 });
            var eq = ctx.group({ parent: g });
            card(ctx, eq, 1190, 500, 370, 356, 'pink');
            ctx.text(1375, 530, 'P(miss) = Π (1 − rᵢ)', { size: 20, font: 'mono', color: 'white', anchor: 'middle', parent: eq });
            ctx.para(1210, 572, ['independent, rᵢ = 0.9, 5 layers', '→ P(miss) = 10⁻⁵'], { size: 13, font: 'mono', color: 'text', lh: 20, parent: eq });
            ctx.para(1210, 636, ['correlated layers (same model,', 'same blind spot): ρ > 0', '→ P(miss) ≫ Π (1 − rᵢ)'], { size: 13, font: 'mono', color: 'amber', lh: 20, parent: eq });
            ctx.para(1210, 718, ['fix: diverse signals', 'hash · classifier · policy code', 'VLM judge · crypto · human'], { size: 13, font: 'mono', color: 'lime', lh: 20, parent: eq });
            ctx.text(1210, 812, 'check actions, not only text', { size: 13, font: 'mono', color: 'pink', parent: eq });
            ctx.reveal(eq, { from: 'right', delay: 300 });
            return ctx.wait(500).then(function () {
              return Promise.all(dots.map(function (d, i) {
                return ctx.animate(d, { cx: [510, d.stopX] }, 900 + (d.stopX - 510) * 1.6, 'inOut', i * 70).then(function () {
                  if (d.pass) {
                    ctx.label(d.stopX - 60, d.yy - 20, 'correlated miss', { color: 'amber', size: 11, parent: g });
                    ctx.pulse(d, { color: 'amber', dur: 700 });
                  } else {
                    d.setAttribute('r', 4);
                    d.setAttribute('opacity', 0.8);
                    ctx.line(d.stopX + 4, d.yy - 6, d.stopX + 4, d.yy + 6, { color: 'red', sw: 2, parent: g });
                  }
                });
              }));
            });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Ingress moderation',
        say: 'The first checkpoint fires the moment the uploads land. The prompt goes to a small text classifier, the three sketches to an image classifier and a perceptual hash lookup against known bad content, and the voice memo is transcribed and classified. Each produces a score per policy category, compared with a per category threshold. Our crash landing nudges the violence score to about a third, well under its threshold, so the job is admitted in roughly one hundred forty milliseconds.',
        deep: '<p>Ingress is a <b>multi-label, multi-modal</b> classification: for every category c and modality m a calibrated score s<sub>c,m</sub> ∈ [0,1]; the decision is per category:</p>' +
          '<div class="eq">block ⇔ ∃c : max<sub>m</sub> s<sub>c,m</sub> &gt; τ<sub>c</sub></div>' +
          '<ul><li><b>Text</b>: small encoder classifier (~100M params, ~5 ms) or an LLM safeguard such as Llama Guard / ShieldGemma for nuanced policy (~50–200 ms).</li>' +
          '<li><b>Images</b>: ViT/SigLIP-backbone multi-head classifier (~10–20 ms per image on GPU) plus <b>perceptual hashes</b> (PDQ, PhotoDNA) matched against industry hash lists — exact-ish recall on <i>known</i> abuse material, zero generalisation.</li>' +
          '<li><b>Audio</b>: ASR (Whisper-class) → text classifier, plus an audio-event model; a human voice routes to the <b>likeness/consent</b> check before any voice cloning.</li></ul>' +
          '<p>Thresholds are <b>per category</b> and asymmetric: τ for minors is set for very high recall (cost of a miss is unbounded); τ for violence is looser because cinematic action is legitimate. OCR text inside images is also extracted here — it feeds prompt-injection screening later.</p>' +
          '<div class="note">Latency: the three branches run in parallel; the critical path is ASR on the 42 s memo (~0.1–0.3 s on a GPU). Decisions are logged with model versions so policy changes can be replayed.</div>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'CHECKPOINT 1 · INGRESS MODERATION', 'pink');
          lightCP(ctx, 1);
          var ins = [
            ctx.node({ x: 160, y: 540, w: 220, h: 54, title: 'prompt.txt', sub: '212 chars', icon: 'doc', color: 'cyan', titleSize: 14, subSize: 11, parent: g }),
            ctx.node({ x: 160, y: 630, w: 220, h: 54, title: 'sketch_1..3', sub: '3 × 1024² png', icon: 'image', color: 'violet', titleSize: 14, subSize: 11, parent: g }),
            ctx.node({ x: 160, y: 720, w: 220, h: 54, title: 'memo.m4a', sub: '42 s · 48 kHz', icon: 'wave', color: 'orange', titleSize: 14, subSize: 11, parent: g })
          ];
          var clf = [
            ctx.node({ x: 460, y: 540, w: 250, h: 54, title: 'Text classifier', sub: 'encoder · ~5 ms', icon: 'search', color: 'pink', titleSize: 14, subSize: 11, parent: g }),
            ctx.node({ x: 460, y: 630, w: 250, h: 54, title: 'Image clf + PDQ', sub: 'ViT · hash · ~15 ms/img', icon: 'eye', color: 'pink', titleSize: 14, subSize: 11, parent: g }),
            ctx.node({ x: 460, y: 720, w: 250, h: 54, title: 'ASR → text clf', sub: 'Whisper-class · ~0.3 s', icon: 'mic', color: 'pink', titleSize: 14, subSize: 11, parent: g })
          ];
          var lk = ins.map(function (n, i) { return ctx.link(n, clf[i], { color: ['cyan', 'violet', 'orange'][i], straight: true, parent: g }); });
          ctx.para(60, 800, ['three branches run in parallel; OCR text from the', 'sketches is kept for injection screening downstream'], { size: 12, font: 'mono', color: 'dim', lh: 18, parent: g });
          ctx.reveal(ins, { from: 'left', stagger: 100 });
          ctx.reveal(clf, { from: 'left', delay: 200, stagger: 100 });
          ctx.reveal(lk, { from: 'draw', delay: 350, stagger: 100 });
          /* score bars */
          var CAT = ['sexual', 'minors', 'violence', 'hate', 'self-harm', 'weapons', 'real person'];
          var TAU = [0.5, 0.2, 0.7, 0.6, 0.5, 0.7, 0.6];
          var SC = [[0.02, 0.03, 0.01], [0.01, 0.02, 0.0], [0.18, 0.31, 0.05], [0.01, 0.01, 0.01], [0.01, 0.0, 0.01], [0.03, 0.06, 0.01], [0.0, 0.04, 0.12]];
          var MC = ['cyan', 'violet', 'orange'];
          var bx = 790, bw = 330;
          var pg = ctx.group({ parent: g });
          ctx.text(bx, 506, 'score per category  (text · image · audio)', { size: 12, font: 'mono', color: 'dim', parent: pg });
          ctx.text(bx + bw + 30, 506, 'τ_c', { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: pg });
          var bars = [];
          CAT.forEach(function (c, i) {
            var y = 540 + i * 44;
            ctx.text(bx - 12, y, c, { size: 13, font: 'mono', color: i === 2 ? 'white' : 'text', anchor: 'end', parent: pg });
            ctx.rect(bx, y - 16, bw, 32, { rx: 4, fill: 'rgba(255,255,255,0.025)', parent: pg });
            SC[i].forEach(function (v, m) {
              var b = ctx.rect(bx, y - 13 + m * 9, 0, 7, { rx: 2, fill: ctx.alpha(MC[m], 0.8), parent: pg });
              b.v = v; bars.push(b);
            });
            var tx = bx + TAU[i] * bw;
            ctx.line(tx, y - 18, tx, y + 18, { color: 'pink', sw: 1.6, parent: pg });
            ctx.text(bx + bw + 30, y, TAU[i].toFixed(1), { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: pg });
          });
          [0, 0.5, 1].forEach(function (v) { ctx.text(bx + v * bw, 850, String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: pg }); });
          ctx.reveal(pg, { delay: 300 });
          var js = code(ctx, g, { x: 1200, y: 500, w: 360, title: 'ingress.decision', lang: 'json', size: 12, typing: true, lines: [
            '{"decision": "allow",',
            ' "max": {"violence": 0.31},',
            ' "hash_match": false,',
            ' "ocr_spans_quarantined": 1,',
            ' "route": "likeness_check(memo)",',
            ' "latency_ms": 142}'
          ] });
          ctx.reveal(js, { from: 'right', delay: 400 });
          ctx.hud('ingress · 7 categories × 3 modalities · 142 ms');
          return ctx.wait(700).then(function () {
            return Promise.all(lk.map(function (l, i) { return ctx.packet(l, { color: MC[i], dur: 600 }); }));
          }).then(function () {
            return Promise.all(bars.map(function (b, i) {
              return ctx.tween(700, function (t) { b.setAttribute('width', Math.max(0, b.v * bw * t)); }, 'out', i * 25);
            }));
          }).then(function () {
            ctx.reveal(ctx.text(bx + 0.31 * bw + 8, 540 + 2 * 44 - 4, '← crash 0.31', { size: 12, font: 'mono', color: 'amber', parent: pg }), { dur: 300 });
            return js.typeAll();
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Agent policy & tools',
        say: 'The second checkpoint guards actions rather than words. Every tool call an agent emits is intercepted by a deterministic policy engine before it executes. Is this tool on the calling agent\'s allowlist? Are the arguments within bounds? Are the reference images assets the user actually owns? Is there budget left? Watch three calls. The camera agent may render a shot. The storyboard agent may not fetch an arbitrary URL. And the editor may publish only after a human confirms.',
        deep: '<p>An LLM\'s output is untrusted input to the system that executes it. So tool calls pass through a <b>policy decision point</b> written as code (Cedar, OPA/Rego, or a typed rule engine), evaluated per call:</p>' +
          '<div class="eq">allow(call) = call.tool ∈ A[agent] ∧ ∀k: φ<sub>k</sub>(call.args, job) ∧ cost(call) ≤ budget</div>' +
          '<ul><li><b>Least privilege</b>: a permission matrix of agents × tools. Sub-agents get narrow scopes; no agent has open-web egress by default.</li>' +
          '<li><b>Argument policy</b>: bounds (<code>duration_s ≤ 10</code>), type/range checks, and <b>data-provenance</b> checks (<code>refs ⊆ job.assets</code>) — the model cannot smuggle a URL it read inside an image into a fetch.</li>' +
          '<li><b>Side-effect tiers</b>: read-only → allow; internal writes → allow + audit; external, irreversible effects (publish, email, spend) → <b>human confirmation</b>.</li>' +
          '<li><b>Budgets</b>: GPU-seconds and token caps per job enforced at the call site, bounding runaway loops.</li></ul>' +
          '<p>Evaluation is microseconds and fully deterministic, so it is also <i>testable</i>: policies ship with unit tests and are versioned alongside the agents. The deeper defences against prompt injection (spotlighting, dual-LLM, CaMeL capabilities) live in the Guardrails chamber.</p>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'CHECKPOINT 2 · AGENT POLICY & TOOL PERMISSIONS', 'pink');
          lightCP(ctx, 2);
          var js = code(ctx, g, { x: 40, y: 500, w: 450, title: 'tool_use · agent:camera', lang: 'json', size: 13, typing: true, lines: [
            '{"tool": "render_shot",',
            ' "caller": "agent:camera",',
            ' "args": {"shot": 3,',
            '   "duration_s": 6,',
            '   "refs": ["asset://sketch_2"],',
            '   "est_gpu_s": 760}}'
          ] });
          ctx.reveal(js, { from: 'left' });
          S.pe = ctx.node({ x: 790, y: 540, w: 300, h: 58, title: 'Policy engine', sub: 'Cedar / OPA · deterministic', icon: 'lock', color: 'pink', titleSize: 15, subSize: 11, parent: g });
          ctx.reveal(S.pe, { from: 'scale', delay: 200 });
          var l1 = ctx.link({ x: 490, y: 560 }, S.pe, { color: 'pink', to: 'l', parent: g });
          ctx.reveal(l1, { from: 'draw', delay: 300 });
          var RULES = ['tool ∈ allow[agent:camera]', 'duration_s ≤ 10', 'refs ⊆ job.assets (cleared)', 'est_gpu_s ≤ budget (1,840 s)'];
          var rules = RULES.map(function (s, i) {
            var rg = ctx.group({ parent: g });
            var y = 612 + i * 34;
            rg.ic = ctx.icon('check', 662, y, 16, 'faint', { parent: rg });
            ctx.text(680, y, s, { size: 13, font: 'mono', color: 'text', parent: rg });
            return rg;
          });
          ctx.reveal(rules, { from: 'up', delay: 400, stagger: 90 });
          /* permission matrix */
          var AG = ['director', 'writer', 'storyboard', 'camera', 'editor', 'critic'];
          var TL = ['search_refs', 'render_shot', 'tts', 'edit_tl', 'publish', 'http_fetch'];
          var P = ['A...C.', 'A.....', 'A.....', 'AA....', '..AAC.', 'A.....'];
          var mx = 1210, my = 575;
          var mg = ctx.group({ parent: g });
          var M = ctx.matrix(mx, my, 6, 6, { cell: 32, gap: 5, parent: mg, values: function (r, c) {
            var k = P[r].charAt(c);
            return k === 'A' ? ctx.alpha('lime', 0.55) : (k === 'C' ? ctx.alpha('amber', 0.55) : 'rgba(255,255,255,0.05)');
          } });
          AG.forEach(function (a, r) { ctx.text(mx - 10, M.cellCenter(r, 0).y, a, { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: mg }); });
          TL.forEach(function (t, c) {
            var p = M.cellCenter(0, c);
            var te = ctx.text(p.x - 4, my - 10, t, { size: 11, font: 'mono', color: 'dim', parent: mg });
            te.setAttribute('transform', 'rotate(-40 ' + (p.x - 4) + ' ' + (my - 10) + ')');
          });
          [['allow', 'lime'], ['confirm', 'amber'], ['deny', 'faint']].forEach(function (l, i) {
            ctx.rect(mx + i * 80, 814, 14, 14, { rx: 3, fill: l[1] === 'faint' ? 'rgba(255,255,255,0.08)' : ctx.alpha(l[1], 0.6), parent: mg });
            ctx.text(mx + i * 80 + 20, 821, l[0], { size: 12, font: 'mono', color: 'dim', parent: mg });
          });
          ctx.text(mx - 120, my - 70, 'agents × tools', { size: 12, font: 'mono', color: 'pink', parent: mg });
          ctx.reveal(mg, { from: 'right', delay: 300 });
          var l2 = ctx.link(S.pe, { x: mx - 100, y: 700 }, { color: ctx.alpha('pink', 0.5), from: 'r', dash: '4 5', parent: g });
          ctx.reveal(l2, { from: 'draw', delay: 600 });
          var CALLS = [[3, 1, 'lime', 'ALLOW', 'camera.render_shot'], [2, 5, 'red', 'DENY', 'storyboard.http_fetch'], [4, 4, 'amber', 'CONFIRM', 'editor.publish']];
          var WHY = ['all 4 rules pass', 'not in allowlist', 'external side effect → human'];
          ctx.hud('policy decision per tool call · µs · deterministic');
          return js.typeAll().then(function () {
            return ctx.packet(l1, { color: 'pink', dur: 600, label: 'intercept' });
          }).then(function () {
            var ch = Promise.resolve();
            rules.forEach(function (rg, i) {
              ch = ch.then(function () {
                rg.ic.firstChild.setAttribute('stroke', C.lime);
                return ctx.wait(220);
              });
            });
            return ch;
          }).then(function () {
            var ch = Promise.resolve();
            CALLS.forEach(function (c, i) {
              ch = ch.then(function () {
                var p = M.cellCenter(c[0], c[1]);
                var hl = ctx.rect(p.x - 19, p.y - 19, 38, 38, { rx: 6, stroke: c[2], sw: 2.4, glow: true, parent: mg });
                ctx.reveal(hl, { from: 'scale', dur: 300 });
                var y = 770 + i * 30;
                var row = ctx.group({ parent: g });
                ctx.label(100, y, c[3], { color: c[2], size: 12, w: 96, parent: row });
                ctx.text(160, y, c[4], { size: 13, font: 'mono', color: 'white', parent: row });
                ctx.text(390, y, WHY[i], { size: 12, font: 'mono', color: c[2], parent: row });
                ctx.reveal(row, { from: 'left', dur: 400 });
                return ctx.pulse(S.pe, { color: c[2], dur: 600 });
              });
            });
            return ch;
          });
        }
      },
      /* ------------------------------------------------------------ 3b: generation-time */
      {
        title: 'Generation-time controls',
        say: 'The third checkpoint lives inside the generator. The shot prompt is screened and rewritten with negative concepts, and only cleared reference images may condition the model. Then, during sampling, every four steps we peek at the model\'s current estimate of the clean video, decode it with a tiny decoder, and classify it. A safe shot like ours converges quietly. An unsafe sample can be aborted at step twelve of forty, saving seventy percent of its GPU time.',
        deep: '<p>Controls at three depths:</p>' +
          '<ul><li><b>Weights</b>: safety fine-tuning and <b>concept erasure</b> (ESD, UCE) remove capabilities before deployment; hardest to bypass, hardest to update.</li>' +
          '<li><b>Conditioning</b>: prompt screening + rewriting, negative prompts under classifier-free guidance, and a <b>reference gate</b> — only ingress-cleared, consented images/voices may condition the model (identity checks run here).</li>' +
          '<li><b>Sampling loop</b>: with rectified flow, x<sub>t</sub> = (1−t)x<sub>0</sub> + tε and the network predicts v = ε − x<sub>0</sub>, so a clean-sample estimate is free at every step:</li></ul>' +
          '<div class="eq">x̂<sub>0</sub> = x<sub>t</sub> − t · v̂<sub>θ</sub>(x<sub>t</sub>, t, c)</div>' +
          '<p>Decode x̂<sub>0</sub> for a few frames with a <b>tiny distilled decoder</b> (TAESD-style, ~1 ms/frame) or classify directly in latent space; abort if p(unsafe) &gt; τ. Expected saving for rejected samples:</p>' +
          '<div class="eq">saved GPU = ρ<sub>reject</sub> · (1 − k/N)</div>' +
          '<p>At k = 12 of N = 40 a rejected shot costs 228 of 760 GPU-seconds (8 × H100 × 95 s). Overhead on accepted shots: 10 previews (every 4 steps) × tens of ms ≈ 1% of sampling time. Early x̂<sub>0</sub> estimates are blurry conditional means (the MMSE estimate averages over all plausible videos), so thresholds must be calibrated per step index to avoid false aborts.</p>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'CHECKPOINT 3 · GENERATION-TIME CONTROLS', 'pink');
          lightCP(ctx, 3);
          var cd = code(ctx, g, { x: 40, y: 500, w: 460, title: 'shot 3 · conditioning', lang: 'text', size: 12, lines: [
            'prompt: "fox astronaut, cracked visor,',
            '         skids across glowing ice"',
            '+ neg:  "gore, real-person face, logo"',
            '+ refs: sketch_2 (ingress-cleared)',
            '+ cfg 5.0 · steps 40 · seed 7715'
          ] });
          ctx.reveal(cd, { from: 'left' });
          var cards = [['Safety-tuned weights', 'refusal SFT · concept erasure'], ['Reference gate', 'consented, cleared refs only'], ['Guidance', 'negative prompt under CFG']].map(function (c, i) {
            return ctx.node({ x: 270, y: 690 + i * 62, w: 460, h: 50, title: c[0], sub: c[1], icon: ['layers', 'lock', 'gear'][i], color: 'pink', titleSize: 14, subSize: 11, parent: g });
          });
          ctx.reveal(cards, { from: 'left', delay: 200, stagger: 100 });
          /* timeline */
          var tx0 = 580, tx1 = 1100, ty = 520;
          var tl = ctx.group({ parent: g });
          ctx.line(tx0, ty, tx1, ty, { color: 'faint', sw: 2, parent: tl });
          for (var k = 0; k <= 40; k++) {
            var xx = tx0 + (tx1 - tx0) * k / 40;
            ctx.line(xx, ty - (k % 4 === 0 ? 7 : 3), xx, ty + (k % 4 === 0 ? 7 : 3), { color: k % 4 === 0 ? 'pink' : 'faint', sw: 1, parent: tl });
          }
          ctx.text(tx0, ty + 20, 't = 1 (noise)', { size: 11, font: 'mono', color: 'dim', parent: tl });
          ctx.text(tx1, ty + 20, 't = 0', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: tl });
          var ax = tx0 + (tx1 - tx0) * 12 / 40;
          ctx.line(ax, ty - 16, ax, ty + 12, { color: 'red', sw: 2, dash: '3 3', parent: tl });
          ctx.text(ax + 8, ty - 22, 'unsafe sample aborts @12/40', { size: 11, font: 'mono', color: 'red', parent: tl });
          ctx.reveal(tl, { delay: 200 });
          var cur = ctx.circle(tx0, ty, 7, { fill: 'lime', glow: true, parent: g });
          /* preview */
          var rn = ctx.rng(11), noise = [];
          for (var r = 0; r < 12; r++) { noise.push([]); for (var c = 0; c < 16; c++) { var v = rn(); noise[r].push('#' + hex2(20 + v * 150) + hex2(25 + v * 150) + hex2(40 + v * 160)); } }
          var PV = ctx.matrix(600, 560, 12, 16, { cell: 17, gap: 2, parent: g, values: function (r, c) { return noise[r][c]; } });
          ctx.text(600, 804, 'x̂₀ preview (tiny decoder, 1 frame)', { size: 12, font: 'mono', color: 'dim', parent: g });
          ctx.reveal(PV, { delay: 300 });
          var gx = 960, gy0 = 560, gh = 226;
          ctx.rect(gx, gy0, 22, gh, { rx: 4, fill: 'rgba(255,255,255,0.04)', stroke: 'faint', sw: 1, parent: g });
          var gFill = ctx.rect(gx + 2, gy0 + gh - 2, 18, 0, { rx: 3, fill: ctx.alpha('lime', 0.8), parent: g });
          var tauY = gy0 + gh * (1 - 0.5);
          ctx.line(gx - 6, tauY, gx + 28, tauY, { color: 'pink', sw: 2, parent: g });
          ctx.text(gx + 34, tauY, 'τ = 0.5', { size: 12, font: 'mono', color: 'pink', parent: g });
          ctx.text(gx - 6, 804, 'p(unsafe)', { size: 12, font: 'mono', color: 'dim', parent: g });
          var stepT = ctx.text(1000, 590, 'step 0/40', { size: 14, font: 'mono', color: 'lime', parent: g });
          var scT = ctx.text(1000, 614, 'p = —', { size: 13, font: 'mono', color: 'text', parent: g });
          ctx.text(840, 845, 'x̂₀ = x_t − t · v̂θ(x_t, t, c)', { size: 16, font: 'mono', color: 'amber', anchor: 'middle', parent: g });
          /* early-abort economics */
          var ea = ctx.group({ parent: g });
          card(ctx, ea, 1180, 540, 380, 300, 'red');
          ctx.text(1200, 568, 'EARLY ABORT ECONOMICS', { size: 13, font: 'display', weight: 700, color: 'red', spacing: 1, parent: ea });
          ctx.text(1200, 604, 'rejected shot, 8 × H100', { size: 12, font: 'mono', color: 'dim', parent: ea });
          var b1 = ctx.rect(1200, 624, 300, 20, { rx: 3, fill: ctx.alpha('red', 0.35), stroke: 'red', sw: 1, parent: ea });
          ctx.text(1508, 634, '760 s', { size: 12, font: 'mono', color: 'text', parent: ea });
          var b2 = ctx.rect(1200, 654, 90, 20, { rx: 3, fill: ctx.alpha('lime', 0.45), stroke: 'lime', sw: 1, parent: ea });
          ctx.text(1298, 664, '228 s  (abort @12)', { size: 12, font: 'mono', color: 'text', parent: ea });
          ctx.para(1200, 708, ['saved = ρ · (1 − k/N)', 'preview cost ≈ 1% of sampling', 'τ calibrated per step index:', 'early x̂₀ is a blurry mean'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: ea });
          ctx.reveal(ea, { from: 'right', delay: 400 });
          var SCORES = [0.07, 0.06, 0.06, 0.05, 0.04, 0.04, 0.03, 0.03, 0.02, 0.02];
          ctx.hud('preview every 4 steps · abort saves up to 70% GPU');
          return ctx.wait(700).then(function () {
            var last = -1;
            return ctx.tween(3200, function (t) {
              var kk = Math.round(t * 40);
              cur.setAttribute('cx', tx0 + (tx1 - tx0) * t);
              stepT.textContent = 'step ' + kk + '/40';
              var q = Math.floor(kk / 4);
              if (q !== last && kk >= 4) {
                last = q;
                var w = Math.pow(kk / 40, 0.8);
                PV.set(function (r, c) { return ctx.mix(noise[r][c], foxScene(r, c), w); });
                var s = SCORES[q - 1];
                gFill.setAttribute('height', gh * s - 2 > 0 ? gh * s : 2);
                gFill.setAttribute('y', gy0 + gh - Math.max(2, gh * s));
                scT.textContent = 'p = ' + s.toFixed(2) + '  (< τ)';
                ctx.pulse(PV, { color: 'pink', dur: 400 });
              }
            }, 'linear');
          });
        }
      },
      /* ------------------------------------------------------------ 4 egress */
      {
        title: 'Egress classification',
        say: 'Before the finished cut leaves the building, the fourth checkpoint watches it. Thirty seconds at twenty four frames per second is seven hundred twenty frames, far too many to judge one by one. So we sample one frame per second plus the first frame of every shot, thirty six in all, and score each. On-screen text is read with OCR, the narration is transcribed, and a temporal model looks at short windows for harm that only shows in motion.',
        deep: '<p>Frame sampling trades recall for cost: 36 of 720 frames (5%) at ~10 ms each ≈ 0.4 s instead of 7 s. Shot-boundary keyframes are added because a shot can be shorter than the sampling period.</p>' +
          '<p><b>Aggregation</b> of per-frame scores s<sub>t</sub> into a clip score matters more than it looks:</p>' +
          '<div class="eq">noisy-OR: 1 − ∏<sub>t</sub>(1 − s<sub>t</sub>) &nbsp;&nbsp;vs&nbsp;&nbsp; top-k mean: (1/k)·Σ<sub>top-k</sub> s<sub>t</sub></div>' +
          '<p>Noisy-OR assumes independent frames and grows with clip length — 36 frames at s ≈ 0.05 already exceed 0.8, a false alarm on every long, benign video. Production systems use <b>max / top-k mean with temporal smoothing</b>, calibrated per clip length.</p>' +
          '<ul><li><b>Temporal classifier</b> (video transformer on 16-frame windows) for motion-defined harms (violence, self-harm acts) invisible in single frames.</li>' +
          '<li><b>OCR</b> on sampled frames: generated text can contain slurs, phone numbers or brand marks.</li>' +
          '<li><b>Audio track</b>: ASR of synthesised narration + music fingerprinting (copyright).</li>' +
          '<li><b>Likeness</b>: face embeddings of generated faces vs a public-figure gallery (the fox passes trivially).</li></ul>' +
          '<div class="note">Egress is the last automatic gate before provenance signing; borderline scores route to human review instead of a hard block.</div>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'CHECKPOINT 4 · EGRESS VIDEO CLASSIFICATION', 'pink');
          lightCP(ctx, 4);
          var x0 = 80, cw = 46, fy = 518;
          var SHOT = [4, 6, 5, 5, 6, 4], bounds = [0], acc = 0;
          SHOT.forEach(function (d) { acc += d; bounds.push(acc); });
          var strip = ctx.group({ parent: g });
          for (var s = 0; s < 30; s++) {
            var sh = 0; while (s >= bounds[sh + 1]) sh++;
            ctx.rect(x0 + s * cw, fy, cw - 3, 40, { rx: 3, fill: ctx.alpha(sh % 2 ? 'cyan' : 'lime', 0.1 + 0.05 * (s % 2)), stroke: ctx.alpha(sh % 2 ? 'cyan' : 'lime', 0.35), sw: 1, parent: strip });
          }
          SHOT.forEach(function (d, i) {
            ctx.text(x0 + (bounds[i] + d / 2) * cw, fy + 20, 'shot ' + (i + 1), { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: strip });
            if (i) ctx.line(x0 + bounds[i] * cw - 1.5, fy - 6, x0 + bounds[i] * cw - 1.5, fy + 46, { color: 'amber', sw: 1.4, parent: strip });
          });
          ctx.text(1560, fy + 20, '720 frames', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: strip });
          ctx.reveal(strip, { from: 'left' });
          /* sample times & scores */
          var rn = ctx.rng(5), pts = [];
          for (var u = 0; u < 30; u++) pts.push([u + 0.5, 'u']);
          bounds.slice(0, 6).forEach(function (b) { pts.push([b + 0.05, 'k']); });
          pts.sort(function (a, b) { return a[0] - b[0]; });
          pts.forEach(function (p) { var t = p[0]; p[2] = 0.035 + 0.03 * rn() + 0.34 * Math.exp(-(t - 11.6) * (t - 11.6) / (2 * 1.1 * 1.1)); });
          var ticks = pts.map(function (p) {
            var x = x0 + p[0] * cw;
            return ctx.line(x, fy + 48, x, fy + 60, { color: p[1] === 'k' ? 'amber' : 'cyan', sw: 2, parent: g });
          });
          var py = 600, ph = 130, pw = 30 * cw;
          var plot = ctx.plot(x0, py, pw, ph, pts.map(function (p) { return [p[0], p[2]]; }), { xDomain: [0, 30], yDomain: [0, 1], color: 'pink', sw: 1.6, yLabel: 'unsafe score s_t (max over categories)', xLabel: 'seconds', parent: g });
          var dots = pts.map(function (p) { var q = plot.toPx(p[0], p[2]); return ctx.circle(q.x, q.y, 3.5, { fill: p[1] === 'k' ? 'amber' : 'cyan', parent: g }); });
          var ty = plot.toPx(0, 0.7).y;
          var thr = ctx.line(x0, ty, x0 + pw, ty, { color: 'red', dash: '6 5', sw: 1.4, parent: g });
          var thrT = ctx.text(x0 + pw - 4, ty - 10, 'τ = 0.7', { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: g });
          ctx.reveal(plot, { delay: 200 });
          ctx.reveal([thr, thrT], { delay: 300 });
          /* aggregates computed from the actual samples */
          var sc = pts.map(function (p) { return p[2]; }).sort(function (a, b) { return b - a; });
          var top3 = (sc[0] + sc[1] + sc[2]) / 3, nor = 1 - pts.reduce(function (a, p) { return a * (1 - p[2]); }, 1);
          S.egressTop3 = top3;
          /* side lanes */
          var LANES = [['OCR on frames', 'no text found', 'violet'], ['ASR → text clf', 'narration clean', 'orange'], ['temporal clf ×16f', 'max 0.29 @ shot 3', 'magenta']];
          var lanes = LANES.map(function (l, i) {
            var lg = ctx.group({ parent: g });
            var y = 782 + i * 30;
            ctx.text(x0, y, l[0], { size: 12, font: 'mono', color: l[2], parent: lg });
            var bar = ctx.rect(250, y - 7, 0, 14, { rx: 3, fill: ctx.alpha(l[2], 0.3), stroke: ctx.alpha(l[2], 0.7), sw: 1, parent: lg });
            ctx.text(870, y, l[1], { size: 12, font: 'mono', color: 'dim', parent: lg });
            lg.bar = bar;
            return lg;
          });
          ctx.reveal(lanes, { delay: 400, stagger: 100 });
          var agg = ctx.group({ parent: g });
          card(ctx, agg, 1080, 758, 480, 104, 'pink');
          ctx.text(1100, 782, 'top-3 mean = ' + top3.toFixed(2) + '  < τ   → PASS', { size: 14, font: 'mono', color: 'lime', parent: agg });
          ctx.text(1100, 810, 'noisy-OR 1−Π(1−s_t) = ' + nor.toFixed(2) + '  → false alarm', { size: 13, font: 'mono', color: 'amber', parent: agg });
          ctx.text(1100, 838, '36 of 720 frames scored ≈ 0.4 s GPU', { size: 12, font: 'mono', color: 'dim', parent: agg });
          ticks.forEach(function (t) { t.setAttribute('opacity', 0); });
          dots.forEach(function (d) { d.setAttribute('opacity', 0); });
          ctx.hud('egress · 36 / 720 frames sampled · clip = top-3 mean');
          var scan = ctx.line(x0, fy - 8, x0, py + ph, { color: 'white', sw: 1.4, opacity: 0.6, parent: g });
          return ctx.wait(600).then(function () {
            return ctx.tween(2600, function (t) {
              var xs = x0 + t * pw;
              scan.setAttribute('x1', xs); scan.setAttribute('x2', xs);
              pts.forEach(function (p, i) {
                if (x0 + p[0] * cw <= xs + 0.5) { ticks[i].setAttribute('opacity', 1); dots[i].setAttribute('opacity', 1); }
              });
              lanes.forEach(function (l) { l.bar.setAttribute('width', 600 * t); });
            }, 'linear');
          }).then(function () {
            scan.setAttribute('opacity', 0);
            ctx.reveal(agg, { from: 'up' });
            return ctx.pulse(agg.firstChild, { color: 'lime', dur: 700 });
          });
        }
      },
      /* ------------------------------------------------------------ 5 provenance */
      {
        title: 'Provenance & audit',
        say: 'The fifth checkpoint makes the output accountable. An invisible watermark is woven into every frame, carrying a short payload that survives re-encoding, cropping and resizing. A C2PA manifest is attached to the file, declaring that the video was created by a generative model from three ingredient sketches, hashed to the exact bytes and signed with a certificate chain. And every checkpoint decision has been appended to a hash-chained audit log, so no record can be silently edited.',
        deep: '<p><b>Two complementary provenance mechanisms</b>:</p>' +
          '<table><tr><th></th><th>Watermark (SynthID-style)</th><th>C2PA manifest</th></tr>' +
          '<tr><td>Lives in</td><td>the pixels / audio samples</td><td>file metadata (JUMBF box)</td></tr>' +
          '<tr><td>Survives</td><td>re-encode, crop, resize, screenshots (mostly)</td><td>only lossless handling; stripped by re-upload</td></tr>' +
          '<tr><td>Says</td><td>“this came from model X” (k-bit payload)</td><td>who/what/how, ingredients, edits — signed</td></tr>' +
          '<tr><td>Verify with</td><td>provider\'s detector (keyed)</td><td>anyone, via X.509 chain + trust list</td></tr></table>' +
          '<p>A learned encoder adds a residual δ with PSNR ≳ 40 dB; the decoder recovers the bits and a binomial test on the bit matches yields a p-value — 44 or more of 48 bits by chance: p = Σ<sub>k≥44</sub> C(48,k)/2<sup>48</sup> = 213,053/2<sup>48</sup> ≈ 7.6·10<sup>−10</sup> — pooled over frames for video. The two mechanisms are linked: the manifest carries a <b>soft-binding</b> assertion with the watermark id, so a stripped copy can recover its manifest from a repository (“durable Content Credentials”).</p>' +
          '<p><b>Audit log</b>: each decision event e<sub>i</sub> is chained,</p>' +
          '<div class="eq">h<sub>i</sub> = SHA-256(h<sub>i−1</sub> ‖ e<sub>i</sub>)</div>' +
          '<p>so tampering with any record changes every later hash. Periodically publishing (or signing) the head hash to WORM storage makes the log tamper-evident — the same idea as Certificate Transparency\'s Merkle trees. Events carry policy and model versions, enabling <i>replay</i>: "would today\'s policy have blocked last month\'s job?"</p>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'CHECKPOINT 5 · PROVENANCE & AUDIT', 'pink');
          lightCP(ctx, 5);
          /* watermark */
          var rn = ctx.rng(3);
          var wm = ctx.group({ parent: g });
          var fr = function (r, c) { return foxScene(r + 2, c + 5); };
          var dl = [];
          for (var r = 0; r < 8; r++) { dl.push([]); for (var c = 0; c < 8; c++) dl[r].push((rn() - 0.5) * 0.7); }
          var A = ctx.matrix(50, 510, 8, 8, { cell: 14, gap: 2, values: fr, parent: wm });
          ctx.text(186, 572, '+', { size: 20, color: 'text', anchor: 'middle', parent: wm });
          var B = ctx.matrix(206, 510, 8, 8, { cell: 14, gap: 2, cmap: 'diverge', values: function (r, c) { return dl[r][c]; }, parent: wm });
          ctx.text(342, 572, '=', { size: 20, color: 'text', anchor: 'middle', parent: wm });
          var Cm = ctx.matrix(362, 510, 8, 8, { cell: 14, gap: 2, values: fr, parent: wm });
          ctx.text(50, 648, 'frame', { size: 12, font: 'mono', color: 'dim', parent: wm });
          ctx.text(206, 648, 'δ (×40 shown)', { size: 12, font: 'mono', color: 'dim', parent: wm });
          ctx.text(362, 648, 'PSNR ≈ 42 dB', { size: 12, font: 'mono', color: 'dim', parent: wm });
          var bits = '101100111000101101001110011010011100101011010010'.split('').map(Number);
          ctx.text(50, 682, 'payload 48 b', { size: 12, font: 'mono', color: 'pink', parent: wm });
          var P1 = ctx.matrix(160, 674, 1, 48, { cell: 6, gap: 1, values: function (r, c) { return bits[c] ? ctx.alpha('pink', 0.85) : 'rgba(255,255,255,0.06)'; }, parent: wm });
          ctx.text(50, 716, 'after H.264', { size: 12, font: 'mono', color: 'lime', parent: wm });
          var P2 = ctx.matrix(160, 708, 1, 48, { cell: 6, gap: 1, values: function () { return 'rgba(255,255,255,0.03)'; }, parent: wm });
          var rec = ctx.text(50, 750, 'CRF 28 + 10% crop + 0.75× resize', { size: 12, font: 'mono', color: 'dim', parent: wm });
          var recT = ctx.text(50, 776, '', { size: 13, font: 'mono', color: 'lime', parent: wm });
          ctx.reveal(wm, { from: 'left' });
          /* C2PA manifest */
          var man = code(ctx, g, { x: 540, y: 500, w: 520, title: 'trailer.mp4 · C2PA manifest (JUMBF)', lang: 'text', size: 12, typing: true, lines: [
            'manifest urn:c2pa:7f3a…',
            ' claim  generator: genesis-atlas/2.3',
            '        hashed refs → assertions',
            ' assertions',
            '  c2pa.actions.v2   c2pa.created',
            '    digitalSourceType: trainedAlgorithmicMedia',
            '  c2pa.ingredient ×3  sketch_1..3.png',
            '  c2pa.hash.bmff.v3   (binds MP4 bytes)',
            ' signature  COSE_Sign1 · ES256',
            '        x5chain + RFC 3161 timestamp'
          ] });
          ctx.reveal(man, { from: 'up', delay: 200 });
          var chain = ctx.group({ parent: g });
          [['signer cert', 'pink'], ['intermediate', 'violet'], ['trust-list CA', 'lime']].forEach(function (c, i) {
            ctx.label(625 + i * 175, 790, c[0], { color: c[1], size: 12, parent: chain });
            if (i < 2) ctx.line(625 + i * 175 + 64, 790, 625 + (i + 1) * 175 - 64, 790, { color: 'dim', arrow: true, parent: chain });
          });
          ctx.text(800, 826, 'verifiable by anyone · stripped by lossy re-upload', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: chain });
          ctx.reveal(chain, { delay: 500 });
          /* audit hash chain */
          var EV = [['ingress.allow', 1], ['policy.allow render_shot', 2], ['gen.preview ok ×10', 3], ['egress.pass ' + (S.egressTop3 || 0.31).toFixed(2), 4], ['c2pa.signed', 5]];
          var hr = ctx.rng(99);
          function hx() { var s = ''; for (var i = 0; i < 8; i++) s += '0123456789abcdef'.charAt(Math.floor(hr() * 16)); return s; }
          var blocks = EV.map(function (e, i) {
            var bg = ctx.group({ parent: g });
            var y = 504 + i * 72;
            card(ctx, bg, 1110, y, 450, 54, 'pink');
            ctx.text(1126, y + 18, 'e' + (i + 1) + '  ' + e[0], { size: 13, font: 'mono', color: 'white', parent: bg });
            ctx.text(1126, y + 38, 'h' + (i + 1) + ' = H(h' + i + ' ‖ e' + (i + 1) + ') = ' + hx() + '…', { size: 12, font: 'mono', color: 'pink', parent: bg });
            if (i < 4) ctx.line(1335, y + 56, 1335, y + 70, { color: 'pink', arrow: true, parent: bg });
            bg.setAttribute('opacity', 0);
            return bg;
          });
          var ticks = EV.map(function (e) { return ctx.rect(SX[e[1]] - 7, 359, 14, 14, { rx: 3, fill: ctx.alpha('pink', 0.5), stroke: 'pink', sw: 1, opacity: 0, parent: S.map }); });
          S.auditRail.setAttribute('stroke', ctx.alpha('pink', 0.6));
          S.auditT.setAttribute('fill', C.pink);
          ctx.hud('provenance · watermark + C2PA · hash-chained audit');
          return man.typeAll().then(function () {
            ctx.focus([S.bench], 0.3);
            return ctx.camera(800, 640, 1.3, 900);
          }).then(function () {
            return ctx.wait(1200);
          }).then(function () {
            return Promise.all([ctx.camera(null, null, null, 900), ctx.focus(null)]);
          }).then(function () {
            P2.set(function (r, c) { return (c === 5 || c === 17 || c === 30 || c === 41) ? ctx.alpha('red', 0.85) : (bits[c] ? ctx.alpha('lime', 0.8) : 'rgba(255,255,255,0.06)'); });
            ctx.pulse(P2, { color: 'lime', dur: 600 });
            recT.textContent = '44/48 bits · p ≈ 7.6 × 10⁻¹⁰ → watermarked';
            var ch = Promise.resolve();
            blocks.forEach(function (b, i) {
              ch = ch.then(function () {
                ctx.reveal(b, { from: 'up', dur: 350 });
                ctx.reveal(ticks[i], { dur: 300 });
                return ctx.pulse(S.cps[EV[i][1]].ring, { color: 'pink', dur: 400 });
              });
            });
            return ch;
          });
        }
      },
      /* ------------------------------------------------------------ 6 evaluation */
      {
        title: 'Evaluation loops',
        say: 'Safety asks whether an output is allowed. Evaluation asks whether it is good. Three loops run at three speeds. The innermost is the critic agent, which watches each rendered shot within seconds and sends failures back. Here, shot three has a flickering visor, scores two out of five on identity, and is re-rendered. The middle loop is online A B testing of every release over days. The outer loop is the offline benchmark suite that gates each new model checkpoint.',
        deep: '<p>Evaluation spans three time scales, each with a different signal and decision:</p>' +
          '<table><tr><th>Loop</th><th>Signal</th><th>Decision</th></tr>' +
          '<tr><td>Critic (seconds)</td><td>VLM-as-judge with a rubric: prompt adherence, identity consistency, physics, artefacts, style match</td><td>accept / re-render this shot</td></tr>' +
          '<tr><td>Online A/B (days)</td><td>completion rate, re-generation and edit rate, export rate, watch-time, thumbs, cost/job</td><td>ship / roll back a release</td></tr>' +
          '<tr><td>Offline (hours)</td><td>VBench dimensions, FVD, CLIPScore, human pairwise preference (Elo), agent task success</td><td>promote a model checkpoint</td></tr></table>' +
          '<p>The critic\'s scores are only useful if <b>calibrated against humans</b>: rank correlation with human ratings on a held-out set (Spearman ρ, Cohen\'s κ) is itself a tracked metric. Judges have known biases — position, length, self-preference — mitigated by order swapping and rubric-anchored scales.</p>' +
          '<div class="eq">re-render if min<sub>d</sub> score<sub>d</sub> &lt; θ<sub>d</sub> &nbsp;and&nbsp; retries &lt; R<sub>max</sub></div>' +
          '<p>The retry cap and the GPU budget bound the cost of a picky critic: here one re-render of shot 3 adds ~30 s and ~4 GPU-minutes.</p>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'EVALUATION · three loops, three time scales', 'teal');
          S.evo.setAttribute('filter', 'url(#fx-glow)');
          ctx.pulse(S.evo, { color: 'teal', dur: 700 });
          /* critic back-edge on the obs row */
          var be = ctx.path('M' + SX[3] + ',426 Q' + (SX[2] + SX[3]) / 2 + ',448 ' + SX[2] + ',426', { stroke: 'magenta', sw: 1.8, arrow: true, parent: S.map });
          var beL = ctx.label((SX[2] + SX[3]) / 2, 390,'critic → redo shot 3', { color: 'magenta', size: 11, parent: S.map });
          ctx.reveal(be, { from: 'draw', delay: 200 });
          ctx.reveal(beL, { delay: 400 });
          /* concentric loops */
          var cx = 250, cy = 690;
          var RINGS = [[55, 'magenta', 1.6, 'critic agent', 'per shot · seconds'], [105, 'cyan', 0.8, 'online A/B', 'per release · days'], [155, 'teal', 0.4, 'offline suite', 'per checkpoint · hours']];
          var lg = ctx.group({ parent: g });
          var orb = RINGS.map(function (R, i) {
            ctx.circle(cx, cy, R[0], { stroke: ctx.alpha(R[1], 0.6), sw: 1.6, dash: '4 5', parent: lg });
            var d = ctx.circle(cx + R[0], cy, 6, { fill: R[1], glow: true, parent: lg });
            ctx.circle(440, 580 + i * 70, 6, { fill: R[1], parent: lg });
            ctx.text(456, 572 + i * 70, R[3], { size: 14, font: 'display', weight: 600, color: 'white', parent: lg });
            ctx.text(456, 592 + i * 70, R[4], { size: 12, font: 'mono', color: R[1], parent: lg });
            return d;
          });
          ctx.text(cx, cy, 'shot 3', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: lg });
          ctx.reveal(lg, { from: 'scale', s0: 0.85 });
          S.benchLoops.push(ctx.loop(function (t) {
            RINGS.forEach(function (R, i) {
              var a = t * R[2] + i * 2.1;
              orb[i].setAttribute('cx', cx + R[0] * Math.cos(a)); orb[i].setAttribute('cy', cy + R[0] * Math.sin(a));
            });
          }));
          /* critic scores */
          var vals = [4.0, 4.0, 2.0, 4.0, 5.0, 4.0].map(function (s) { return (s - 1) / 4; });
          var cols = vals.map(function (v) { return v < 0.625 ? C.red : C.lime; });
          var bx = 720, by = 530, bw2 = 480, bh = 220;
          var bars = ctx.bars(bx, by, bw2, bh, vals.map(function () { return 0; }), { color: cols, labels: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], gap: 18, labelSize: 12, parent: g });
          var thY = by + bh * (1 - 0.625);
          ctx.line(bx - 6, thY, bx + bw2 + 6, thY, { color: 'amber', dash: '6 4', sw: 1.4, parent: g });
          ctx.text(bx + bw2 + 10, thY, 'θ = 3.5', { size: 12, font: 'mono', color: 'amber', parent: g });
          ctx.text(bx, by - 18, 'critic score per shot (1–5, min over rubric dims)', { size: 12, font: 'mono', color: 'dim', parent: g });
          var js = code(ctx, g, { x: 1295, y: 500, w: 265, title: 'critic · shot 3', lang: 'json', size: 12, typing: true, lines: [
            '{"adherence": 4,',
            ' "identity": 2,',
            ' "physics": 3,',
            ' "artefact": "visor',
            '    flicker 3.1-3.6 s",',
            ' "verdict": "redo"}'
          ] });
          ctx.reveal(js, { from: 'right', delay: 300 });
          ctx.para(720, 800, ['offline: VBench dims · FVD · CLIPScore · Elo', 'online:  completion · re-edit rate · watch-time · $/job'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: g });
          ctx.hud('critic: 1 re-render · +30 s · +4 GPU-min');
          return ctx.wait(400).then(function () {
            return bars.update(vals, 900);
          }).then(function () {
            return js.typeAll();
          }).then(function () {
            return ctx.packet(be, { color: 'magenta', dur: 700, label: 'redo' });
          }).then(function () {
            vals[2] = (4.0 - 1) / 4;
            bars.bars[2].setAttribute('fill', ctx.alpha('lime', 0.75));
            bars.bars[2].setAttribute('stroke', C.lime);
            return bars.update(vals, 800);
          }).then(function () {
            var b = bars.bars[2], bxm = parseFloat(b.getAttribute('x')) + parseFloat(b.getAttribute('width')) / 2;
            ctx.reveal(ctx.label(bxm, by + bh * 0.2 - 18, 'redo: 2 → 4', { color: 'lime', size: 11, parent: g }), { from: 'up', dur: 300 });
            return ctx.pulse(b, { color: 'lime', dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 7 observability */
      {
        title: 'Observability & cost',
        say: 'Finally, observability. One trace identifier is minted at the gateway and propagated in a traceparent header through every agent turn, model call and GPU job, so the whole trailer becomes one tree of spans. Metrics watch the fleet: time to first token, queue wait, GPU utilization and model FLOPs utilization. And every span carries its cost. This trailer consumed about eighty GPU minutes and a few hundred thousand tokens, roughly nine dollars per finished minute of video.',
        deep: '<p><b>Traces</b> (Dapper → OpenTelemetry): a trace is a tree of spans sharing a 128-bit <code>trace_id</code>; context crosses process boundaries in the W3C header <code>traceparent: 00-&lt;trace-id&gt;-&lt;parent-span-id&gt;-&lt;flags&gt;</code>, and through queues as message attributes, so a GPU job hours later still joins the right trace.</p>' +
          '<ul><li><b>GenAI spans</b>: <code>invoke_agent</code>, <code>chat</code>, <code>execute_tool</code> with <code>gen_ai.request.model</code>, <code>gen_ai.usage.input_tokens</code>/<code>output_tokens</code>; add cache-read tokens, GPU-seconds, queue wait as custom attributes.</li>' +
          '<li><b>Metrics</b>: TTFT p50/p99, inter-token latency, queue wait, GPU util (fraction of time a kernel runs — misleading) vs <b>MFU</b> (achieved / peak FLOPs; DiT inference often 35–55%).</li>' +
          '<li><b>Logs</b>: structured, carrying <code>trace_id</code>; prompts/outputs sampled and redacted.</li></ul>' +
          '<p><b>Cost accounting</b> per job, illustrative (H100 ≈ $2.5/GPU-h):</p>' +
          '<pre>DiT shots   6×8 GPU×95 s   $3.17\nre-render   8 GPU×30 s     $0.17\nLLM tokens  ~0.45M in (70% cached), 40k out  $1.10\nTTS/audio · encoders · safety · encode/CDN  $0.17\ntotal ≈ $4.6 / 30 s  →  ≈ $9 per finished minute</pre>' +
          '<div class="note">Head-based sampling keeps 1–10% of traces; tail-based sampling keeps every trace that errored, retried or breached an SLO — exactly the ones you need.</div>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'OBSERVABILITY · traces · metrics · logs · cost', 'teal');
          S.obsRail.setAttribute('stroke', ctx.alpha('teal', 0.55));
          var spans = SX.map(function (x, i) {
            return ctx.rect(x - 70, 406, 140, 12, { rx: 3, fill: ctx.alpha('teal', 0.35 + 0.08 * i), stroke: 'teal', sw: 1, opacity: 0, parent: S.map });
          });
          var tp = code(ctx, g, { x: 40, y: 500, w: 620, title: 'W3C trace context', lang: 'text', size: 12, lines: [
            'traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            '             ver  trace-id (128 b)                 parent (64 b)    flags'
          ] });
          ctx.reveal(tp, { from: 'left' });
          /* mini waterfall */
          var W = [['job.trailer', 0, 151, 'pink'], ['director.plan', 0, 12, 'amber'], ['refs.encode', 8, 12, 'violet'], ['render_shot ×6', 12, 107, 'lime'],
            ['critic.review', 100, 107, 'magenta'], ['shot3.retry', 107, 137, 'red'], ['tts.narration', 20, 40, 'orange'], ['edit·encode·sign', 137, 151, 'cyan']];
          var wx = 210, ww = 440, sc = ww / 151;
          var wf = ctx.group({ parent: g });
          var wb = W.map(function (w, i) {
            var y = 604 + i * 30;
            ctx.text(wx - 10, y, w[0], { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: wf });
            var b = ctx.rect(wx + w[1] * sc, y - 9, 0, 18, { rx: 3, fill: ctx.alpha(w[3], 0.45), stroke: w[3], sw: 1, parent: wf });
            b.w = (w[2] - w[1]) * sc;
            return b;
          });
          [0, 50, 100, 150].forEach(function (s) { ctx.text(wx + s * sc, 850, s + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: wf }); });
          ctx.reveal(wf, { delay: 200 });
          /* metrics */
          var mg = ctx.group({ parent: g });
          var MX = 720;
          var rn = ctx.rng(8);
          function series(n, base, amp, spike) { var a = []; for (var i = 0; i < n; i++) a.push([i, base + amp * rn() + (spike && i > 30 && i < 36 ? spike : 0)]); return a; }
          ctx.text(MX, 506, 'LLM TTFT (ms)  p50 · p99', { size: 12, font: 'mono', color: 'amber', parent: mg });
          var p1 = ctx.plot(MX, 520, 360, 60, series(48, 180, 40), { xDomain: [0, 47], yDomain: [0, 1400], color: 'amber', sw: 1.4, parent: mg });
          var p1b = ctx.plot(MX, 520, 360, 60, series(48, 700, 180, 380), { xDomain: [0, 47], yDomain: [0, 1400], color: ctx.alpha('amber', 0.55), sw: 1.4, axes: false, parent: mg });
          ctx.text(MX, 612, 'video queue wait p95 (s)', { size: 12, font: 'mono', color: 'lime', parent: mg });
          var p2 = ctx.plot(MX, 626, 360, 60, series(48, 8, 6, 22), { xDomain: [0, 47], yDomain: [0, 40], color: 'lime', sw: 1.4, parent: mg });
          ctx.text(MX, 718, 'GPU util · MFU (video pool)', { size: 12, font: 'mono', color: 'red', parent: mg });
          var p3 = ctx.plot(MX, 732, 360, 60, series(48, 0.88, 0.08), { xDomain: [0, 47], yDomain: [0, 1], color: 'red', sw: 1.4, parent: mg });
          var p3b = ctx.plot(MX, 732, 360, 60, series(48, 0.4, 0.06), { xDomain: [0, 47], yDomain: [0, 1], color: 'violet', sw: 1.4, axes: false, parent: mg });
          ctx.text(MX + 366, 740, 'util 0.9', { size: 11, font: 'mono', color: 'red', parent: mg });
          ctx.text(MX + 366, 772, 'MFU 0.43', { size: 11, font: 'mono', color: 'violet', parent: mg });
          ctx.text(MX, 822, 'p99 spike = prefill burst from 40 parallel agent turns', { size: 11, font: 'mono', color: 'dim', parent: mg });
          ctx.reveal(mg, { delay: 300 });
          /* cost */
          var cg = ctx.group({ parent: g });
          card(ctx, cg, 1180, 496, 380, 366, 'teal');
          ctx.text(1200, 522, 'COST PER JOB', { size: 13, font: 'display', weight: 700, color: 'teal', spacing: 1, parent: cg });
          var COST = [['DiT shots', 3.17, 'lime'], ['LLM tokens', 1.10, 'amber'], ['re-render', 0.17, 'red'], ['audio · safety · CDN', 0.17, 'orange']];
          var tot = COST.reduce(function (a, c) { return a + c[1]; }, 0);
          var sx = 1200, swd = 340, acc = 0;
          var segs = COST.map(function (c, i) {
            var r = ctx.rect(sx + acc / tot * swd, 548, 0, 26, { rx: 2, fill: ctx.alpha(c[2], 0.6), stroke: c[2], sw: 1, parent: cg });
            r.x0 = sx + acc / tot * swd; r.w = c[1] / tot * swd; acc += c[1];
            ctx.rect(sx, 598 + i * 28, 12, 12, { rx: 2, fill: ctx.alpha(c[2], 0.7), parent: cg });
            ctx.text(sx + 20, 604 + i * 28, c[0], { size: 12, font: 'mono', color: 'text', parent: cg });
            ctx.text(sx + swd, 604 + i * 28, '$' + c[1].toFixed(2), { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: cg });
            return r;
          });
          ctx.line(sx, 718, sx + swd, 718, { color: 'faint', parent: cg });
          ctx.text(sx, 742, 'total / 30 s trailer', { size: 13, font: 'mono', color: 'dim', parent: cg });
          var totT = ctx.text(sx + swd, 742, '$0.00', { size: 16, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: cg });
          ctx.text(sx, 782, '$ / finished video minute', { size: 13, font: 'mono', color: 'dim', parent: cg });
          var perMin = ctx.text(sx + swd, 782, '$0.00', { size: 20, font: 'mono', weight: 700, color: 'teal', anchor: 'end', parent: cg });
          ctx.text(sx, 822, '80 GPU-min · 0.49M tokens', { size: 12, font: 'mono', color: 'dim', parent: cg });
          ctx.text(sx, 844, 'H100 ≈ $2.5/GPU-h (illustrative)', { size: 11, font: 'mono', color: 'dim', parent: cg });
          ctx.reveal(cg, { from: 'right', delay: 300 });
          ctx.hud('trace 4bf92f35… · 1 tree · 212 spans');
          return ctx.wait(500).then(function () {
            ctx.reveal(spans, { stagger: 120 });
            return ctx.packet(S.obsRail, { color: 'teal', dur: 1200, label: 'traceparent' });
          }).then(function () {
            return Promise.all(wb.map(function (b, i) { return ctx.tween(600, function (t) { b.setAttribute('width', b.w * t); }, 'out', i * 120); }));
          }).then(function () {
            return Promise.all(segs.map(function (r, i) { return ctx.tween(500, function (t) { r.setAttribute('width', r.w * t); }, 'out', i * 120); })
              .concat([ctx.counter(totT, 0, tot, 1000, function (v) { return '$' + v.toFixed(2); }), ctx.counter(perMin, 0, tot * 2, 1000, function (v) { return '$' + v.toFixed(2); })]));
          });
        }
      },
      /* ------------------------------------------------------------ 8 summary */
      {
        title: 'The trust budget',
        say: 'Put together, the trust plane is cheap relative to what it protects. Five checkpoints add about three seconds to a critical path of two and a half minutes, and a few percent of GPU cost, mostly from previews and egress scoring. Evaluation and tracing run asynchronously. To go deeper, open Guardrails and Provenance for classifier cascades, prompt injection defenses and content credentials, or Evals and Observability for video metrics, judges, trace waterfalls and error budgets.',
        deep: '<p>The engineering target: <b>trust overhead ≪ generation cost</b>, with every checkpoint measurable.</p>' +
          '<table><tr><th>Checkpoint</th><th>Adds latency</th><th>Cost share</th><th>Main failure mode</th></tr>' +
          '<tr><td>Ingress</td><td>~0.15 s</td><td>&lt;0.1%</td><td>over-blocking art (false positives)</td></tr>' +
          '<tr><td>Policy · tools</td><td>~µs–ms / call</td><td>~0</td><td>policies too coarse or stale</td></tr>' +
          '<tr><td>Gen-time</td><td>~1 s (+1% sampling)</td><td>~1%</td><td>false aborts on blurry early x̂<sub>0</sub></td></tr>' +
          '<tr><td>Egress</td><td>~1–2 s</td><td>&lt;0.5%</td><td>sparse sampling misses brief frames</td></tr>' +
          '<tr><td>Provenance</td><td>~1 s</td><td>&lt;0.2%</td><td>metadata stripped on re-upload</td></tr>' +
          '<tr><td>Evals + traces</td><td>async</td><td>~1%</td><td>judge drift, trace sampling gaps</td></tr></table>' +
          '<p>What makes it work in practice: <b>versioned policies and models</b> (every decision replayable), <b>calibrated thresholds</b> revisited as base rates shift, <b>human review queues</b> for the uncertain band, and <b>red-team suites</b> that run as regression tests on every release.</p>' +
          '<div class="note">Zoom in: <b>Guardrails &amp; Provenance</b> (cascades, injection defence, likeness, SynthID, C2PA) and <b>Evals &amp; Observability</b> (FVD, VBench, Elo, VLM judges, OTel waterfall, SLOs, cost).</div>',
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'THE TRUST BUDGET · ≈ 3 s on a ≈ 150 s critical path', 'pink');
          var ROWS = [['ingress moderation', 'gateway', '~0.15 s', '<0.1%', 'harmful uploads, known-bad hashes'],
            ['policy · tools', 'agents', '~1 ms / call', '~0', 'unauthorised side effects'],
            ['gen-time controls', 'DiT loop', '~1 s (+1%)', '~1%', 'unsafe renders, early abort'],
            ['egress classify', 'post', '~1–2 s', '<0.5%', 'unsafe frames, audio, on-screen text'],
            ['provenance', 'encode · sign', '~1 s', '<0.2%', 'untraceable synthetic media'],
            ['evals · traces', 'everywhere', 'async', '~1%', 'regressions, latency, cost drift']];
          var HX = [60, 330, 520, 700, 850];
          var tb = ctx.group({ parent: g });
          ['checkpoint', 'where', 'adds', 'cost', 'catches'].forEach(function (h, i) { ctx.text(HX[i], 516, h, { size: 12, font: 'mono', color: 'dim', spacing: 1, parent: tb }); });
          ctx.line(50, 532, 1330, 532, { color: 'line', parent: tb });
          var rows = ROWS.map(function (r, i) {
            var rg = ctx.group({ parent: tb });
            var y = 560 + i * 44;
            ctx.circle(HX[0] - 2, y, 5, { fill: i < 5 ? 'pink' : 'teal', parent: rg });
            r.forEach(function (c, j) { ctx.text(HX[j] + (j ? 0 : 12), y, c, { size: j ? 13 : 14, font: j ? 'mono' : 'display', weight: j ? 400 : 600, color: j === 0 ? 'white' : (j === 2 || j === 3 ? 'lime' : 'text'), parent: rg }); });
            return rg;
          });
          ctx.reveal(rows, { from: 'left', stagger: 120 });
          /* critical path with trust slices */
          var cp = ctx.group({ parent: g });
          var cx0 = 60, cwid = 1270, k = cwid / 151;
          ctx.rect(cx0, 818, cwid, 22, { rx: 4, fill: ctx.alpha('lime', 0.12), stroke: ctx.alpha('lime', 0.4), sw: 1, parent: cp });
          /* ingress 0.15 s · 10 previews × 0.1 s during sampling · egress 1.2 s · provenance 0.9 s  ≈ 3.3 s */
          var slices = [[0.3, 0.15], [138.5, 1.2], [149.5, 0.9]];
          for (var q = 1; q <= 10; q++) slices.push([12 + q * 9.5 - 0.1, 0.1]);
          var sl = slices.map(function (s) { return ctx.rect(cx0 + s[0] * k, 816, Math.max(3, s[1] * k), 26, { rx: 1, fill: 'pink', parent: cp }); });
          ctx.text(cx0, 860, 'critical path 151 s  ·  pink = trust work on the path ≈ 3 s', { size: 12, font: 'mono', color: 'dim', parent: cp });
          ctx.reveal(cp, { delay: 700 });
          ctx.reveal(sl, { from: 'scale', delay: 900, stagger: 60 });
          var zg = ctx.group({ parent: g });
          card(ctx, zg, 1360, 500, 200, 330, 'pink');
          ctx.text(1460, 530, 'ZOOM IN', { size: 13, font: 'display', weight: 700, color: 'pink', anchor: 'middle', spacing: 1.5, parent: zg });
          ctx.para(1380, 572, ['Guardrails ⤢', 'cascades · injection', 'likeness · C2PA'], { size: 13, font: 'mono', color: 'pink', lh: 22, parent: zg });
          ctx.para(1380, 690, ['Evals · Obs ⤢', 'FVD · VBench · Elo', 'OTel · SLOs · $'], { size: 13, font: 'mono', color: 'teal', lh: 22, parent: zg });
          ctx.text(1460, 810, 'click the lane headers', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: zg });
          ctx.reveal(zg, { from: 'right', delay: 400 });
          for (var i = 1; i <= 5; i++) lightCP(ctx, i);
          ctx.hud('trust overhead ≈ 2% of wall-clock · ≈ 3% of GPU');
          return ctx.wait(1200).then(function () {
            return Promise.all([ctx.pulse(S.guard, { color: 'pink', times: 2, dur: 800 }), ctx.pulse(S.evo, { color: 'teal', times: 2, dur: 800 })]);
          });
        }
      }
    ]
  });
})();
