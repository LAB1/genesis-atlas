/* L1 — Safety, Evaluation & Observability. Trust and operations layered across the whole pipeline:
 * checkpoints (ingress, policy, generation-time, egress, provenance), the audit log, evaluation loops
 * and telemetry, lighting up hop by hop for the fox-astronaut trailer request.
 * Beat format: every step is split into beats (say + card + deep + a gated animation segment). */
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
  function hide(list) { [].concat(list).forEach(function (e) { if (e) e.setAttribute('opacity', 0); }); }

  function bench(ctx, title, col) {
    var S = ctx.state;
    (S.benchLoops || []).forEach(function (h) { h.stop(); });
    S.benchLoops = [];
    if (S.bench) ctx.remove(S.bench, 350);
    S.bench = ctx.group();
    if (title) ctx.reveal(ctx.text(40, 482, title, { size: 14, font: 'display', weight: 700, color: col || 'pink', spacing: 1.2, parent: S.bench }), { from: 'left', dur: 400 });
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

  /* the pipeline map that stays on screen for the whole chamber; everything starts hidden and is revealed beat by beat */
  function buildMap(ctx) {
    var S = ctx.state;
    S.map = ctx.group();
    S.mapLbl = ctx.text(40, 225, 'PIPELINE', { size: 12, font: 'mono', color: 'dim', spacing: 1.5, parent: S.map });
    S.stages = STAGES.map(function (s, i) {
      return ctx.node({ x: SX[i], y: 225, w: 196, h: 58, title: s[0], sub: s[1], icon: s[2], color: s[3], titleSize: 14, subSize: 11, parent: S.map });
    });
    S.links = [];
    for (var i = 0; i < 5; i++) S.links.push(ctx.link(S.stages[i], S.stages[i + 1], { color: ctx.alpha('white', 0.35), straight: true, sw: 1.4, parent: S.map }));
    S.cpG = ctx.group({ parent: S.map });
    S.cps = CPN.map(function (n, i) { return n ? mkCP(ctx, i, S.cpG) : null; });
    /* rails */
    S.auditRail = ctx.path('M205,366 L1578,366', { stroke: ctx.alpha('pink', 0.22), dash: '3 6', sw: 1.2, parent: S.map });
    S.auditT = ctx.text(40, 366, 'audit log', { size: 12, font: 'mono', color: 'dim', parent: S.map });
    S.obsRail = ctx.path('M205,412 L1578,412', { stroke: ctx.alpha('teal', 0.22), dash: '3 6', sw: 1.2, parent: S.map });
    S.sep = ctx.line(30, 452, 1570, 452, { color: 'line', sw: 1, parent: S.map });
    /* lane headers = zoom targets */
    S.guard = ctx.node({ x: 108, y: 306, w: 176, h: 50, title: 'Guardrails', sub: 'policy · C2PA', icon: 'shield', color: 'pink', titleSize: 14, subSize: 11, parent: S.map });
    S.evo = ctx.node({ x: 108, y: 412, w: 176, h: 50, title: 'Evals · Obs', sub: 'quality · traces', icon: 'chart', color: 'teal', titleSize: 14, subSize: 11, parent: S.map });
    hide([S.mapLbl, S.guard, S.evo, S.auditRail, S.auditT, S.obsRail, S.sep]);
    hide(S.stages); hide(S.links);
    hide(S.cps.filter(Boolean).map(function (c) { return c.g; }));
  }

  function panelRect(ctx, g, x, y, w, h, col) {
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
  /* a stylised "unsafe" sample for the abort demo: a hard red blob on a dark ground */
  function hazardScene(r, c) {
    var d = Math.sqrt((c - 8) * (c - 8) + (r - 6) * (r - 6));
    if (d < 2.4) return '#ff4d6d';
    if (d < 4.2) return ((r + c) % 2) ? '#a3213f' : '#7a1830';
    return ((r * 5 + c * 3) % 7 === 0) ? '#3a1226' : '#1a0d1c';
  }
  function hex2(v) { var s = Math.round(v).toString(16); return s.length < 2 ? '0' + s : s; }

  Atlas.register({
    id: 'trust',
    refs: [
      'Reason, <i>Human Error</i> (the “Swiss cheese” model of layered defences), Cambridge University Press 1990',
      'Inan et al., <i>Llama Guard: LLM-based Input-Output Safeguard for Human-AI Conversations</i>, 2023; Zeng et al., <i>ShieldGemma</i>, 2024',
      'Greshake et al., <i>Not what you\'ve signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection</i>, AISec 2023',
      'Cutler et al., <i>Cedar: A New Language for Expressive, Fast, Safe, and Analyzable Authorization</i>, OOPSLA 2024',
      'C2PA, <i>Content Credentials: C2PA Technical Specification</i> v2.1, 2024; Gowal et al., <i>SynthID-Image: Image watermarking at internet scale</i>, 2025',
      'Huang et al., <i>VBench: Comprehensive Benchmark Suite for Video Generative Models</i>, CVPR 2024; Zheng et al., <i>VBench-2.0</i>, 2025',
      'Sigelman et al., <i>Dapper, a Large-Scale Distributed Systems Tracing Infrastructure</i>, Google TR 2010; OpenTelemetry specification &amp; GenAI semantic conventions, 2024–2025',
      'Beyer et al., <i>Site Reliability Engineering</i> (SLOs, error budgets), O\'Reilly 2016; Kohavi, Tang &amp; Xu, <i>Trustworthy Online Controlled Experiments</i>, CUP 2020'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Defense in depth',
        beats: [
          {
            say: 'Trust is not a box in the pipeline. It is a layer wrapped around every hop, from the client all the way to delivery.',
            card: { tag: 'KEY IDEA', title: 'A layer, not a stage', body: 'Safety, provenance and measurement wrap every hop of the request path instead of sitting behind one gate at the end.' },
            deep: '<p>A single moderation service bolted onto the end of the pipeline fails three ways: it sees only the final output, so it cannot stop a harmful <b>tool call</b> or a leaked memo; it is one point of failure; and by the time it fires, the GPU minutes are already spent.</p>' +
              '<p>So trust is a <b>cross-cutting plane</b>. Each hop gets the cheapest check that can see what that hop can see, and every check reports to the same audit log and the same trace.</p>'
          },
          {
            say: 'As the trailer request travels from the client to delivery, it crosses five checkpoints: ingress moderation, agent policy, generation-time controls, egress classification, and provenance.',
            card: { tag: 'NUMBERS', title: 'Five checkpoints on the path', stat: { v: '5', u: 'checkpoints', l: 'each with a different signal, cost and moment in the job' } },
            deep: '<p>Each checkpoint reads a different <b>signal</b>, costs a different amount and sees the job at a different moment:</p>' +
              '<table><tr><th>Checkpoint</th><th>Signal</th><th>Sees</th></tr>' +
              '<tr><td>Ingress</td><td>hashes, classifiers</td><td>raw uploads</td></tr>' +
              '<tr><td>Policy</td><td>deterministic code</td><td>every tool call</td></tr>' +
              '<tr><td>Generation</td><td>x̂<sub>0</sub> previews</td><td>partial video</td></tr>' +
              '<tr><td>Egress</td><td>frame, audio, OCR models</td><td>finished cut</td></tr>' +
              '<tr><td>Provenance</td><td>cryptography</td><td>final bytes</td></tr></table>' +
              '<p>The diversity is the point: a hash cannot be prompt-injected, and a policy engine that never reads natural language cannot be talked out of a rule.</p>'
          },
          {
            say: 'Underneath runs an append-only audit log, and alongside runs a second plane that measures quality, latency and cost. Each lane header opens its own chamber.',
            card: { tag: 'TRY IT', title: 'Open a lane', body: 'Click <b>Guardrails</b> or <b>Evals · Obs</b> to zoom in. Every checkpoint decision is also an audit event and a trace span.' },
            deep: '<p>Every checkpoint emits two records. A <b>decision event</b> goes to the audit log: append-only, hash-chained, replayable. A <b>span</b> goes to the trace: latency, model versions, verdict.</p>' +
              '<p>The audit log answers <i>what did the system decide, under which policy version?</i> The trace answers <i>how long did it take and what did it cost?</i> The evaluation plane consumes both to compute false-positive rates, overhead and drift.</p>'
          },
          {
            say: 'No single layer is perfect. Each has holes, and a threat gets through only when the holes line up, the Swiss cheese model. So the design goal is layers whose failures are uncorrelated.',
            card: { tag: 'KEY IDEA', title: 'Holes must not line up', body: 'Layers built on the same model or data share blind spots. Diversify the signals: hashes, classifiers, policy code, judges, cryptography, humans.' },
            deep: '<p>The threat model for the trailer job has six families, listed on the left:</p>' +
              '<ul><li><b>harmful content</b> in prompts or outputs;</li><li><b>likeness and IP</b> misuse: real faces, cloned voices;</li><li><b>indirect prompt injection</b> hidden in an uploaded sketch;</li><li><b>exfiltration</b> of the private voice memo;</li><li><b>abuse and cost</b> attacks such as GPU farming;</li><li><b>silent regression</b> after a model upgrade.</li></ul>' +
              '<div class="note">Reason\'s Swiss cheese model (1990): every defence has holes; accidents happen when the holes in successive layers line up.</div>'
          },
          {
            say: 'Five layers that each catch ninety percent of attacks would miss only one in a hundred thousand, if their errors were independent. They are not: an attack that fools one language model filter often fools all of them.',
            card: { tag: 'NUMBERS', title: 'The independence trap', stat: { v: '10⁻⁵', l: 'miss rate for five independent 90 percent layers; correlated layers do far worse' },
              more: '<p>Suppose a fraction c of adversarial inputs is <i>common-mode</i>: it evades every LLM-based layer at once. Then P(miss) ≥ c however many such layers you add. With c = 1% the floor is 10<sup>−2</sup>, a thousand times the independent estimate.</p>' },
            deep: '<div class="eq">P(miss) = ∏<sub>i</sub> (1 − r<sub>i</sub>)</div>' +
              '<p>With r<sub>i</sub> = 0.9 for five layers, P(miss) = 10<sup>−5</sup> only if errors are independent. Same training data and same blind spots make them correlated (ρ &gt; 0), and the true rate sits far above the product.</p>' +
              '<ul><li><b>Diversify signals</b>: perceptual hashes, learned classifiers and policy engines that never read natural language.</li>' +
              '<li><b>Check actions, not just text</b>: a side-effecting tool call is gated by argument policy even if every classifier said benign.</li>' +
              '<li><b>Measure the plane itself</b>: each checkpoint emits an audit event and a span, so false-positive rates and overhead are observable.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          buildMap(ctx);
          var cpG = S.cps.filter(Boolean).map(function (c) { return c.g; });
          var g, dots, missLbl;
          ctx.hud('trust is a layer, not a stage');
          /* beat 0: the pipeline the request travels through */
          return Promise.all([ctx.reveal(S.mapLbl, {}), ctx.reveal(S.stages, { from: 'left', stagger: 110 }), ctx.reveal(S.links, { from: 'draw', delay: 400, stagger: 110 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: five checkpoints, lit as the request crosses them */
            ctx.hud('5 checkpoints · 1 audit log · 1 trace per job');
            return ctx.reveal(cpG, { from: 'down', stagger: 100 }).then(function () {
              var chain = Promise.resolve();
              S.links.forEach(function (l, i) {
                chain = chain.then(function () {
                  if (S.cps[i + 1]) ctx.after(250, function () { ctx.pulse(S.cps[i + 1].ring, { color: 'pink', dur: 600 }); });
                  return ctx.packet(l, { color: 'cyan', dur: 480, label: i === 0 ? 'trailer job' : null });
                });
              });
              return chain;
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the audit log and the measurement plane, both zoom targets */
            ctx.hotspot(S.guard, 'safety', { hint: 'SAFETY ⤢' });
            ctx.hotspot(S.evo, 'eval-obs', { hint: 'EVALS ⤢' });
            return Promise.all([
              ctx.reveal([S.guard, S.evo], { from: 'left', stagger: 150 }),
              ctx.reveal([S.auditRail, S.obsRail], { from: 'draw', delay: 300 }),
              ctx.reveal([S.auditT, S.sep], { delay: 500 })
            ]).then(function () {
              return Promise.all([ctx.pulse(S.guard, { color: 'pink', dur: 700 }), ctx.pulse(S.evo, { color: 'teal', dur: 700 })]);
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: threats, and the Swiss-cheese slices they must pass */
            g = bench(ctx, 'DEFENCE IN DEPTH · layered, diverse, independent', 'pink');
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
            var XS = [600, 720, 840, 960, 1080], LN = ['ingress', 'policy', 'gen-time', 'egress', 'provenance'];
            var slices = ctx.group({ parent: g });
            XS.forEach(function (x, j) {
              ctx.poly([[x - 14, 548], [x + 14, 530], [x + 14, 812], [x - 14, 830]], { fill: ctx.alpha('pink', 0.1), stroke: ctx.alpha('pink', 0.55), sw: 1.2, parent: slices });
              ctx.text(x, 852, LN[j], { size: 12, font: 'mono', color: 'pink', anchor: 'middle', parent: slices });
            });
            var r = ctx.rng(42);
            var stops = [0, 1, 0, 2, 1, 3, 0, 2, 4, 1, 0, 3, 5, 2, 1, 0];
            var cols = ['pink', 'violet', 'magenta', 'amber', 'red', 'teal'];
            dots = stops.map(function (s, i) {
              var y = 560 + (i / (stops.length - 1)) * 240 + (r() - 0.5) * 8;
              for (var j = 0; j < s && j < 5; j++) ctx.el('ellipse', { cx: XS[j], cy: y, rx: 5, ry: 6.5, fill: C.bg, stroke: ctx.alpha('pink', 0.5), 'stroke-width': 1 }, slices);
              var d = ctx.circle(510, y, 5, { fill: cols[i % 6], glow: true, parent: g });
              d.stopX = s < 5 ? XS[s] - 20 : 1150; d.pass = s === 5; d.yy = y;
              return d;
            });
            /* decoy holes that do not line up */
            for (var k = 0; k < 8; k++) ctx.el('ellipse', { cx: XS[k % 5], cy: 570 + r() * 230, rx: 5, ry: 7, fill: C.bg, stroke: ctx.alpha('pink', 0.35), 'stroke-width': 1 }, slices);
            return Promise.all([ctx.reveal(list, { from: 'left' }), ctx.reveal(slices, { from: 'scale', s0: 0.92 }), ctx.reveal(dots, { stagger: 30, delay: 200 })]).then(function () {
              return ctx.wait(400);
            }).then(function () {
              return Promise.all(dots.map(function (d, i) {
                return ctx.animate(d, { cx: [510, d.stopX] }, 900 + (d.stopX - 510) * 1.6, 'inOut', i * 70).then(function () {
                  if (d.pass) {
                    missLbl = ctx.label(d.stopX - 60, d.yy - 20, 'correlated miss', { color: 'amber', size: 11, parent: g });
                    ctx.pulse(d, { color: 'amber', dur: 700 });
                  } else {
                    d.setAttribute('r', 4);
                    d.setAttribute('opacity', 0.8);
                    ctx.line(d.stopX + 4, d.yy - 6, d.stopX + 4, d.yy + 6, { color: 'red', sw: 2, parent: g });
                  }
                });
              }));
            });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: the arithmetic of independence, and why it fails */
            var eq = ctx.group({ parent: g });
            panelRect(ctx, eq, 1190, 500, 370, 356, 'pink');
            ctx.text(1375, 530, 'P(miss) = Π (1 − r_i)', { size: 20, font: 'mono', color: 'white', anchor: 'middle', parent: eq });
            ctx.para(1210, 572, ['independent, r_i = 0.9, 5 layers', '→ P(miss) = 10⁻⁵'], { size: 13, font: 'mono', color: 'text', lh: 20, parent: eq });
            var eq2 = ctx.group({ parent: g, opacity: 0 });
            ctx.para(1210, 636, ['correlated layers (same model,', 'same blind spot): ρ > 0', '→ P(miss) ≫ Π (1 − r_i)'], { size: 13, font: 'mono', color: 'amber', lh: 20, parent: eq2 });
            ctx.para(1210, 718, ['fix: diverse signals', 'hash · classifier · policy code', 'VLM judge · crypto · human'], { size: 13, font: 'mono', color: 'lime', lh: 20, parent: eq2 });
            ctx.text(1210, 812, 'check actions, not only text', { size: 13, font: 'mono', color: 'pink', parent: eq2 });
            ctx.hud('independent layers: 10⁻⁵ · correlated: far worse');
            return ctx.reveal(eq, { from: 'right' }).then(function () {
              return ctx.pulse(missLbl, { color: 'amber', times: 2, dur: 600 });
            }).then(function () {
              return ctx.reveal(eq2, { from: 'up', dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Ingress moderation',
        beats: [
          {
            say: 'The first checkpoint fires the moment the uploads land. The prompt goes to a small text classifier, the three sketches to an image classifier plus a perceptual hash lookup against known bad content, and the voice memo is transcribed and then classified.',
            card: { tag: 'HOW IT WORKS', title: 'Three modalities in parallel', body: 'Text, image and audio branches run concurrently, so the slowest branch, speech recognition on the memo, sets the latency.' },
            deep: '<p><b>Text</b>: a small encoder classifier (~100M parameters, ~5 ms) or an LLM safeguard such as Llama Guard or ShieldGemma for nuanced policy (50–200 ms).</p>' +
              '<p><b>Images</b>: a ViT or SigLIP-backbone multi-head classifier (10–20 ms per image on a GPU) plus <b>perceptual hashes</b> (PDQ, PhotoDNA) matched against industry hash lists: near-exact recall on <i>known</i> abuse material, no generalisation to new material.</p>' +
              '<p><b>Audio</b>: ASR with a Whisper-class model, then a text classifier and an audio-event model. OCR text lifted from the sketches is kept for prompt-injection screening later in the job.</p>'
          },
          {
            say: 'Each branch produces a calibrated score for every policy category: sexual content, minors, violence, hate, self harm, weapons and real people. Each category has its own threshold, and minors is set far lower than violence.',
            card: { tag: 'NUMBERS', title: 'One threshold does not fit all', stat: { v: '0.2 vs 0.7', l: 'block threshold for minors versus violence: a miss costs far more than a false block' },
              more: '<p>With calibrated scores, blocking minimises expected cost when s &gt; C<sub>FP</sub> / (C<sub>FP</sub> + C<sub>FN</sub>). A miss treated as 4× worse than a false block gives τ = 0.2; a false block on legitimate cinematic action treated as 2.3× worse than a miss gives τ = 0.7.</p>' },
            deep: '<p>Ingress is a <b>multi-label, multi-modal</b> classification: for each category c and modality m a calibrated score s<sub>c,m</sub> ∈ [0, 1], and a per-category decision:</p>' +
              '<div class="eq">block ⇔ ∃c : max<sub>m</sub> s<sub>c,m</sub> &gt; τ<sub>c</sub></div>' +
              '<p>Thresholds are <b>asymmetric</b>. For minors a miss is catastrophic, so τ is set for very high recall and accepts more false blocks. For violence τ is looser, because cinematic action is legitimate and over-blocking art is a product failure too. Calibration (temperature scaling on held-out labels) keeps τ meaningful across model versions.</p>'
          },
          {
            say: 'Our crash landing nudges the violence score to about a third, well under its threshold of seventy percent. Nothing else fires, and no perceptual hash matches.',
            card: { tag: 'NUMBERS', title: 'A crash is not gore', stat: { v: '0.31', l: 'violence score of the crash-landing prompt, against a threshold of 0.70' } },
            deep: '<p>Where the 0.31 comes from: the text branch reads <i>crash-lands</i> and <i>ice moon</i> as action (0.18); the image branch sees a sketch of a fox in a suit tumbling through snow (0.31, the maximum); the audio branch transcribes <i>I crashed on the ice</i> (0.05).</p>' +
              '<p>The decision uses the <b>maximum over modalities</b>: evidence in any channel counts, so a benign prompt cannot launder an unsafe image. Scores in a middle band (say 0.4–0.7) would not block; they raise the sampling rate of downstream checkpoints.</p>'
          },
          {
            say: 'The job is admitted in about one hundred forty milliseconds. One span of text found by OCR is quarantined for injection screening later, and the memo is routed to the likeness check before any voice cloning.',
            card: { tag: 'NUMBERS', title: 'Admitted in a blink', stat: { v: '142', u: 'ms', l: 'to score all three modalities in parallel and admit the job' } },
            deep: '<p>The decision is logged as JSON with model versions, thresholds and hash results, so policy changes can be <b>replayed</b>: would today\'s policy have admitted last month\'s job?</p>' +
              '<p>Latency budget: distilled Whisper-class ASR on the 42 s memo dominates (~110 ms batched on a GPU, hundreds of times faster than real time); classifiers add 10–20 ms; fan-in, policy and logging ~15 ms. High-severity categories <i>fail closed</i> when a model is unavailable; low-severity ones fail open with a flag for asynchronous review.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'CHECKPOINT 1 · INGRESS MODERATION', 'pink');
          lightCP(ctx, 1);
          var MC = ['cyan', 'violet', 'orange'];
          var ins = [
            ctx.node({ x: 160, y: 540, w: 220, h: 54, title: 'prompt.txt', sub: '212 chars', icon: 'doc', color: 'cyan', titleSize: 14, subSize: 11, parent: g }),
            ctx.node({ x: 160, y: 630, w: 220, h: 54, title: 'sketch_1..3', sub: '3 × 1024² png', icon: 'image', color: 'violet', titleSize: 14, subSize: 11, parent: g }),
            ctx.node({ x: 160, y: 720, w: 220, h: 54, title: 'memo.m4a', sub: '42 s · 48 kHz', icon: 'wave', color: 'orange', titleSize: 14, subSize: 11, parent: g })
          ];
          var clf = [
            ctx.node({ x: 460, y: 540, w: 250, h: 54, title: 'Text classifier', sub: 'encoder · ~5 ms', icon: 'search', color: 'pink', titleSize: 14, subSize: 11, parent: g }),
            ctx.node({ x: 460, y: 630, w: 250, h: 54, title: 'Image clf + PDQ', sub: 'ViT · hash · ~15 ms/img', icon: 'eye', color: 'pink', titleSize: 14, subSize: 11, parent: g }),
            ctx.node({ x: 460, y: 720, w: 250, h: 54, title: 'ASR → text clf', sub: 'Whisper-class · ~0.1 s', icon: 'mic', color: 'pink', titleSize: 14, subSize: 11, parent: g })
          ];
          var lk = ins.map(function (n, i) { return ctx.link(n, clf[i], { color: MC[i], straight: true, parent: g }); });
          var note = ctx.para(60, 800, ['three branches run in parallel; OCR text from the', 'sketches is kept for injection screening downstream'], { size: 12, font: 'mono', color: 'dim', lh: 18, parent: g });
          /* beat 1 material: score bars with a threshold per category */
          var CAT = ['sexual', 'minors', 'violence', 'hate', 'self-harm', 'weapons', 'real person'];
          var TAU = [0.5, 0.2, 0.7, 0.6, 0.5, 0.7, 0.6];
          var SC = [[0.02, 0.03, 0.01], [0.01, 0.02, 0.0], [0.18, 0.31, 0.05], [0.01, 0.01, 0.01], [0.01, 0.0, 0.01], [0.03, 0.06, 0.01], [0.0, 0.04, 0.12]];
          var bx = 790, bw = 330;
          var pg = ctx.group({ parent: g, opacity: 0 });
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
          /* beat 2 material: the crash-landing row */
          var vy = 540 + 2 * 44;
          var hl = ctx.rect(bx - 8, vy - 21, bw + 64, 42, { rx: 6, stroke: 'amber', sw: 1.6, dash: '5 4', parent: g, opacity: 0 });
          var crash = ctx.text(bx + 0.31 * bw + 8, vy - 4, '← crash 0.31', { size: 12, font: 'mono', color: 'amber', parent: g, opacity: 0 });
          /* beat 3 material: the decision record */
          var jg = ctx.group({ parent: g, opacity: 0 });
          var js = ctx.code({ x: 1200, y: 500, w: 360, title: 'ingress.decision', lang: 'json', size: 12, typing: true, parent: jg, lines: [
            '{"decision": "allow",',
            ' "max": {"violence": 0.31},',
            ' "hash_match": false,',
            ' "ocr_spans_quarantined": 1,',
            ' "route": "likeness_check(memo)",',
            ' "latency_ms": 142}'
          ] });
          ctx.reveal(ins, { from: 'left', stagger: 100 });
          ctx.reveal(clf, { from: 'left', delay: 200, stagger: 100 });
          ctx.reveal(lk, { from: 'draw', delay: 350, stagger: 100 });
          ctx.reveal(note, { delay: 500 });
          /* beat 0: three branches scan the uploads */
          return ctx.wait(700).then(function () {
            return Promise.all(lk.map(function (l, i) { return ctx.packet(l, { color: MC[i], dur: 600 }); }));
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: a calibrated score per category, a threshold per category */
            return ctx.reveal(pg, { from: 'right' }).then(function () {
              return Promise.all(bars.map(function (b, i) {
                return ctx.tween(700, function (t) { b.setAttribute('width', Math.max(0, b.v * bw * t)); }, 'out', i * 25);
              }));
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: where the crash lands */
            ctx.hud('violence 0.31 < τ 0.70 · admitted');
            return Promise.all([ctx.reveal(hl, { from: 'scale', dur: 400 }), ctx.reveal(crash, { from: 'left', dur: 400 })]).then(function () {
              return ctx.pulse(hl, { color: 'amber', times: 2, dur: 600 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the decision record */
            ctx.hud('ingress · 7 categories × 3 modalities · 142 ms');
            return ctx.reveal(jg, { from: 'right' }).then(function () { return js.typeAll(); });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Agent policy & tools',
        beats: [
          {
            say: 'The second checkpoint guards actions rather than words. Every tool call an agent emits is intercepted by a deterministic policy engine before it executes.',
            card: { tag: 'KEY IDEA', title: 'Guard the action, not the words', body: 'A model that never says anything harmful can still call a harmful tool. The policy engine sees the call, not the chat.' },
            deep: '<p>An LLM\'s output is <b>untrusted input</b> to the system that executes it. So tool calls pass through a policy decision point written as code (Cedar, OPA/Rego or a typed rule engine) and evaluated per call:</p>' +
              '<div class="eq">allow(call) = call.tool ∈ A[agent] ∧ ∀k: φ<sub>k</sub>(call.args, job) ∧ cost(call) ≤ budget</div>' +
              '<p>The runtime, not the model, executes the call, so the engine sits on the only path to the side effect. Cedar is default-deny, lets <i>forbid</i> override <i>permit</i>, evaluates in microseconds and is amenable to automated analysis of what a policy set can allow.</p>'
          },
          {
            say: 'It asks four questions. Is this tool on the calling agent\'s allowlist? Are the arguments within bounds? Are the reference images assets the user actually owns? Is there budget left? The camera agent\'s render call passes all four.',
            card: { tag: 'HOW IT WORKS', title: 'Four questions, all deterministic', body: 'Allowlist, argument bounds, data provenance and budget: plain code, microseconds, no language model in the loop.' },
            deep: '<ul><li><b>Argument policy</b>: bounds (<code>duration_s ≤ 10</code>), type and range checks.</li>' +
              '<li><b>Data provenance</b>: <code>refs ⊆ job.assets</code>. The model cannot smuggle a URL it read inside an image into a fetch, because only assets registered to this job pass.</li>' +
              '<li><b>Budgets</b>: GPU-seconds and token caps per job, enforced at the call site, bound a runaway loop. Here the estimate is 760 GPU-seconds against a budget of 1,840.</li></ul>' +
              '<p>Because evaluation is deterministic it is <i>testable</i>: policies ship with unit tests and are versioned alongside the agents.</p>'
          },
          {
            say: 'Those permissions live in a matrix of agents by tools. Almost every cell is empty on purpose, because an agent that never needed a tool should never be able to call it.',
            card: { tag: 'TRADE-OFF', title: 'Least privilege costs flexibility', body: 'Narrow scopes cap the blast radius of a hijacked agent, but every new tool needs an explicit grant and a review.' },
            deep: '<p>The matrix P[agent][tool] takes values <i>allow</i>, <i>confirm</i> or <i>deny</i>, with deny as the default. Sub-agents get narrow scopes, and no agent has open-web egress by default.</p>' +
              '<p><b>Side-effect tiers</b> decide the cell: read-only tools are allowed; internal writes are allowed and audited; external, irreversible effects (publish, email, spend) require human confirmation.</p>' +
              '<p>Property tests keep the matrix honest, for example <i>no path exists from an untrusted-input agent to an external sink without a confirm</i>.</p>'
          },
          {
            say: 'Now the second call. The storyboard agent tries to fetch an arbitrary URL. It is not on that agent\'s list, so the engine denies it before a single byte leaves.',
            card: { tag: 'PITFALL', title: 'The deny that stops exfiltration', body: 'This is the call a hijacked storyboard agent would emit after reading a hidden instruction in a sketch. Deny by default turns it into a logged non-event.' },
            deep: '<p>This denial is the last line of defence against the attack in the Guardrails chamber: an <code>http_fetch</code> whose URL carries the memo transcript.</p>' +
              '<p>Denials are also <b>signals</b>. A deny on a tool an agent has never been granted suggests its context was poisoned; the trace links the deny to the span that ingested the untrusted sketch. Deny rate per agent and tool is a metric, and a sudden rise means probing or a bad prompt release.</p>'
          },
          {
            say: 'The third call is publish from the editor. Publishing has external, irreversible effects, so the engine holds it until a human confirms.',
            card: { tag: 'KEY IDEA', title: 'Irreversible means a human decides', body: 'Confirmation shows which inputs influenced the request, and is reserved for publish, pay and email so people are not trained to click through.' },
            deep: '<p><b>Confirmation fatigue</b> is a real failure mode: a person who approves two hundred prompts a day rubber-stamps them. Keep the confirm set small, tier effects, and show provenance (<i>this publish was influenced by: prompt, sketches, memo</i>).</p>' +
              '<p>Bind each approval to a <b>hash of the exact arguments</b> and make it single-use with an expiry, so the call cannot be swapped between check and use (a time-of-check to time-of-use attack).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'CHECKPOINT 2 · AGENT POLICY & TOOL PERMISSIONS', 'pink');
          lightCP(ctx, 2);
          var js = ctx.code({ x: 40, y: 500, w: 450, title: 'tool_use · agent:camera', lang: 'json', size: 13, typing: true, parent: g, lines: [
            '{"tool": "render_shot",',
            ' "caller": "agent:camera",',
            ' "args": {"shot": 3,',
            '   "duration_s": 6,',
            '   "refs": ["asset://sketch_2"],',
            '   "est_gpu_s": 760}}'
          ] });
          S.pe = ctx.node({ x: 790, y: 540, w: 300, h: 58, title: 'Policy engine', sub: 'Cedar / OPA · deterministic', icon: 'lock', color: 'pink', titleSize: 15, subSize: 11, parent: g });
          var l1 = ctx.link({ x: 490, y: 560 }, S.pe, { color: 'pink', to: 'l', parent: g });
          /* beat 1 material: the four rules */
          var RULES = ['tool ∈ allow[agent:camera]', 'duration_s ≤ 10', 'refs ⊆ job.assets (cleared)', 'est_gpu_s ≤ budget (1,840 s)'];
          var rules = RULES.map(function (s, i) {
            var rg = ctx.group({ parent: g, opacity: 0 });
            var y = 612 + i * 34;
            rg.ic = ctx.icon('check', 662, y, 16, 'faint', { parent: rg });
            ctx.text(680, y, s, { size: 13, font: 'mono', color: 'text', parent: rg });
            return rg;
          });
          /* beat 2 material: the permission matrix */
          var AG = ['director', 'writer', 'storyboard', 'camera', 'editor', 'critic'];
          var TL = ['search_refs', 'render_shot', 'tts', 'edit_tl', 'publish', 'http_fetch'];
          var P = ['A...C.', 'A.....', 'A.....', 'AA....', '..AAC.', 'A.....'];
          var mx = 1220, my = 600;
          var mg = ctx.group({ parent: g, opacity: 0 });
          var M = ctx.matrix(mx, my, 6, 6, { cell: 30, gap: 4, parent: mg, values: function (r, c) {
            var k = P[r].charAt(c);
            return k === 'A' ? ctx.alpha('lime', 0.55) : (k === 'C' ? ctx.alpha('amber', 0.55) : 'rgba(255,255,255,0.05)');
          } });
          AG.forEach(function (a, r) { ctx.text(mx - 10, M.cellCenter(r, 0).y, a, { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: mg }); });
          TL.forEach(function (t, c) { ctx.text(M.cellCenter(0, c).x, my - 8, t, { size: 11, font: 'mono', color: 'dim', rotate: -90, parent: mg }); });
          [['allow', 'lime'], ['confirm', 'amber'], ['deny', 'faint']].forEach(function (l, i) {
            ctx.rect(mx + i * 80, 826, 14, 14, { rx: 3, fill: l[1] === 'faint' ? 'rgba(255,255,255,0.08)' : ctx.alpha(l[1], 0.6), parent: mg });
            ctx.text(mx + i * 80 + 20, 833, l[0], { size: 12, font: 'mono', color: 'dim', parent: mg });
          });
          ctx.text(mx, 494, 'agents × tools', { size: 12, font: 'mono', color: 'pink', parent: mg });
          var l2 = ctx.link(S.pe, { x: mx - 120, y: 700 }, { color: ctx.alpha('pink', 0.5), from: 'r', dash: '4 5', parent: g, opacity: 0 });
          var CALLS = [[3, 1, 'lime', 'ALLOW', 'camera.render_shot'], [2, 5, 'red', 'DENY', 'storyboard.http_fetch'], [4, 4, 'amber', 'CONFIRM', 'editor.publish']];
          var WHY = ['all 4 rules pass', 'not in allowlist', 'external side effect → human'];
          function callRow(i) {
            var c = CALLS[i], y = 770 + i * 30;
            var row = ctx.group({ parent: g });
            ctx.label(100, y, c[3], { color: c[2], size: 12, w: 96, parent: row });
            ctx.text(160, y, c[4], { size: 13, font: 'mono', color: 'white', parent: row });
            ctx.text(390, y, WHY[i], { size: 12, font: 'mono', color: c[2], parent: row });
            ctx.reveal(row, { from: 'left', dur: 400 });
            return ctx.pulse(S.pe, { color: c[2], dur: 600 });
          }
          function cellMark(i) {
            var c = CALLS[i], p = M.cellCenter(c[0], c[1]);
            var hl = ctx.rect(p.x - 17, p.y - 17, 34, 34, { rx: 6, stroke: c[2], sw: 2.4, glow: true, parent: mg });
            return ctx.reveal(hl, { from: 'scale', dur: 300 });
          }
          ctx.reveal(js, { from: 'left' });
          ctx.reveal(S.pe, { from: 'scale', delay: 200 });
          ctx.reveal(l1, { from: 'draw', delay: 300 });
          ctx.hud('policy check per tool call · µs · deterministic');
          /* beat 0: a tool call is intercepted */
          return js.typeAll().then(function () {
            return ctx.packet(l1, { color: 'pink', dur: 600, label: 'intercept' });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: four rules, then the verdict for the camera agent's call */
            return ctx.reveal(rules, { from: 'up', stagger: 90 }).then(function () {
              var ch = Promise.resolve();
              rules.forEach(function (rg) {
                ch = ch.then(function () {
                  rg.ic.firstChild.setAttribute('stroke', C.lime);
                  return ctx.wait(220);
                });
              });
              return ch;
            }).then(function () { return callRow(0); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the permission matrix */
            return Promise.all([ctx.reveal(mg, { from: 'right' }), ctx.reveal(l2, { from: 'draw', delay: 300 })]).then(function () {
              return cellMark(0);
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: a denied call */
            return cellMark(1).then(function () { return callRow(1); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: a call that needs a human */
            return cellMark(2).then(function () { return callRow(2); });
          });
        }
      },
      /* ------------------------------------------------------------ 4: generation-time */
      {
        title: 'Generation-time controls',
        beats: [
          {
            say: 'The third checkpoint lives inside the generator. Before sampling, the shot prompt is screened and rewritten with negative concepts, and only ingress-cleared reference images may condition the model. The weights themselves were safety tuned.',
            card: { tag: 'HOW IT WORKS', title: 'Three depths of control', body: 'Weights are hardest to bypass, conditioning is cheapest to change, and guidance steers each sample away from unwanted concepts.' },
            deep: '<ul><li><b>Weights</b>: safety fine-tuning and <b>concept erasure</b> (ESD, UCE) remove capabilities before deployment. Hardest to bypass, hardest to update.</li>' +
              '<li><b>Conditioning</b>: prompt screening and rewriting, and a <b>reference gate</b>: only ingress-cleared, consented images and voices may condition the model.</li>' +
              '<li><b>Guidance</b>: a negative prompt replaces the null branch of classifier-free guidance, pushing samples away from the concept:</li></ul>' +
              '<div class="eq">ṽ = v(x<sub>t</sub>, c<sub>neg</sub>) + w · ( v(x<sub>t</sub>, c) − v(x<sub>t</sub>, c<sub>neg</sub>) )</div>' +
              '<p>No extra compute: the negative branch takes the place of the unconditional one.</p>'
          },
          {
            say: 'Then, during sampling, every four steps we peek at the model\'s current estimate of the clean video. With rectified flow that estimate is nearly free: take the current sample and subtract the predicted velocity times the time remaining.',
            card: { tag: 'NUMBERS', title: 'A free look at the answer', stat: { v: '10', u: 'previews', l: 'one every 4 of 40 denoising steps, about 1 percent of sampling time' } },
            deep: '<p>With rectified flow, x<sub>t</sub> = (1−t)·x<sub>0</sub> + t·ε and the network predicts the velocity v = ε − x<sub>0</sub>. Rearranging gives a clean-sample estimate at every step, with no extra network call:</p>' +
              '<div class="eq">x̂<sub>0</sub> = x<sub>t</sub> − t · v̂<sub>θ</sub>(x<sub>t</sub>, t, c)</div>' +
              '<p>Latent shape for an 81-frame 720p shot: x<sub>t</sub> ∈ ℝ<sup>16×21×90×160</sup> (VAE stride 4×8×8). A tiny decoder (TAESD-style, a few ms per frame) turns a few frames of x̂<sub>0</sub> into pixels, or a classifier reads the latent directly.</p>'
          },
          {
            say: 'A safe shot like ours converges quietly. The preview sharpens from noise into the crash site while the unsafe probability stays far below the threshold at every check.',
            card: { tag: 'WHY IT MATTERS', title: 'Safe shots pay almost nothing', body: 'Ten cheap previews cost about one percent of sampling time. The check only really costs money when it saves a shot.' },
            deep: '<p>Overhead on an accepted shot: 10 previews × (decode 3 frames ≈ 10 ms + classifier ≈ 20 ms) ≈ 0.3 s against ~95 s of sampling, well under 1%.</p>' +
              '<p>Early x̂<sub>0</sub> is not a picture of the final video. It is the <b>conditional mean</b> E[x<sub>0</sub> | x<sub>t</sub>]: a blur that averages every plausible video consistent with the noisy sample. Classifiers must be trained on x̂<sub>0</sub> <i>at each step index</i>, with labels taken from the final decoded video.</p>'
          },
          {
            say: 'An unsafe sample looks different. Its probability climbs across the first checks, crosses the threshold at step twelve of forty, and the sample is aborted on the spot.',
            card: { tag: 'PITFALL', title: 'Blurry previews can mislead', body: 'Early estimates are averages, so one fixed threshold either misses real problems or aborts good shots. Calibrate the threshold per step index.' },
            deep: '<p>By Tweedie\'s formula the denoiser output is the posterior mean, so early previews are low-frequency averages. A hazard that is only a high-frequency detail (a logo, a face) may not be visible at step 12; content-defined by layout and colour usually is.</p>' +
              '<details><summary>Go deeper</summary><p>Choose a per-step threshold τ<sub>k</sub> such that precision on eventually-unsafe outputs reaches a target (for example 95%) at step k. Early steps then abort only when confident; late steps are permissive. An abort emits a <code>gen.abort</code> event with the preview hash as evidence, and the job either refuses or resamples with a new seed.</p></details>'
          },
          {
            say: 'Aborting at step twelve costs two hundred twenty eight GPU seconds instead of seven hundred sixty, saving seventy percent of that shot. The ten previews on accepted shots add about one percent, so the check pays for itself in GPU time only if more than roughly one in seventy samples is rejected.',
            card: { tag: 'NUMBERS', title: 'What an early abort saves', stat: { v: '70%', l: 'of a shot\'s GPU time when aborted at step 12 of 40: 228 of 760 GPU-seconds' },
              more: '<p>Break-even: the check costs about 1% on every sample and saves 70% on each rejected one, so it is GPU-neutral when ρ<sub>reject</sub> × 0.70 = 0.01, that is ρ<sub>reject</sub> ≈ 1.4%. Below that rate it is a safety feature bought for about 1% of GPU cost.</p>' },
            deep: '<div class="eq">saved GPU = ρ<sub>reject</sub> · (1 − k/N)</div>' +
              '<p>A rejected shot at k = 12 of N = 40 costs 228 of 760 GPU-seconds (8 × H100 × 95 s). Overhead on accepted shots is about 1%, so the net effect is <b>negative</b> unless rejects are common. For a consumer product with mostly benign traffic, the real payoff is bounded exposure: unsafe pixels are never fully rendered, stored or delivered.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'CHECKPOINT 3 · GENERATION-TIME CONTROLS', 'pink');
          lightCP(ctx, 3);
          var cd = ctx.code({ x: 40, y: 500, w: 460, title: 'shot 3 · conditioning', lang: 'text', size: 12, parent: g, lines: [
            'prompt: "fox astronaut, cracked visor,',
            '         skids across glowing ice"',
            '+ neg:  "gore, real-person face, logo"',
            '+ refs: sketch_2 (ingress-cleared)',
            '+ cfg 5.0 · steps 40 · seed 7715'
          ] });
          var cards = [['Safety-tuned weights', 'refusal SFT · concept erasure'], ['Reference gate', 'consented, cleared refs only'], ['Guidance', 'negative prompt under CFG']].map(function (c, i) {
            return ctx.node({ x: 270, y: 690 + i * 62, w: 460, h: 50, title: c[0], sub: c[1], icon: ['layers', 'lock', 'gear'][i], color: 'pink', titleSize: 14, subSize: 11, parent: g });
          });
          /* beat 1 material: timeline, preview, gauge */
          var g1 = ctx.group({ parent: g, opacity: 0 });
          var tx0 = 580, tx1 = 1100, ty = 520;
          ctx.line(tx0, ty, tx1, ty, { color: 'faint', sw: 2, parent: g1 });
          for (var k = 0; k <= 40; k++) {
            var xx = tx0 + (tx1 - tx0) * k / 40;
            ctx.line(xx, ty - (k % 4 === 0 ? 7 : 3), xx, ty + (k % 4 === 0 ? 7 : 3), { color: k % 4 === 0 ? 'pink' : 'faint', sw: 1, parent: g1 });
          }
          ctx.text(tx0, ty + 20, 't = 1 (noise)', { size: 11, font: 'mono', color: 'dim', parent: g1 });
          ctx.text(tx1, ty + 20, 't = 0', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g1 });
          var cur = ctx.circle(tx0, ty, 7, { fill: 'lime', glow: true, parent: g1 });
          var rn = ctx.rng(11), noise = [];
          for (var r = 0; r < 12; r++) { noise.push([]); for (var c = 0; c < 16; c++) { var v = rn(); noise[r].push('#' + hex2(20 + v * 150) + hex2(25 + v * 150) + hex2(40 + v * 160)); } }
          var PV = ctx.matrix(600, 560, 12, 16, { cell: 17, gap: 2, parent: g1, values: function (r, c) { return noise[r][c]; } });
          ctx.text(600, 804, 'x₀ estimate (tiny decoder, 1 frame)', { size: 12, font: 'mono', color: 'dim', parent: g1 });
          var gx = 960, gy0 = 560, gh = 226;
          ctx.rect(gx, gy0, 22, gh, { rx: 4, fill: 'rgba(255,255,255,0.04)', stroke: 'faint', sw: 1, parent: g1 });
          var gFill = ctx.rect(gx + 2, gy0 + gh - 2, 18, 2, { rx: 3, fill: ctx.alpha('lime', 0.8), parent: g1 });
          var tauY = gy0 + gh * (1 - 0.5);
          ctx.line(gx - 6, tauY, gx + 28, tauY, { color: 'pink', sw: 2, parent: g1 });
          ctx.text(gx + 34, tauY, 'τ = 0.5', { size: 12, font: 'mono', color: 'pink', parent: g1 });
          ctx.text(gx - 6, 804, 'p(unsafe)', { size: 12, font: 'mono', color: 'dim', parent: g1 });
          var stepT = ctx.text(1000, 590, 'step 0/40', { size: 14, font: 'mono', color: 'lime', parent: g1 });
          var scT = ctx.text(1000, 614, 'p = —', { size: 13, font: 'mono', color: 'text', parent: g1 });
          ctx.text(840, 845, 'x₀ estimate = x_t − t · v_θ(x_t, t, c)', { size: 16, font: 'mono', color: 'amber', anchor: 'middle', parent: g1 });
          /* beat 3 material: the abort marker */
          var g3 = ctx.group({ parent: g, opacity: 0 });
          var ax = tx0 + (tx1 - tx0) * 12 / 40;
          ctx.line(ax, ty - 16, ax, ty + 12, { color: 'red', sw: 2, dash: '3 3', parent: g3 });
          ctx.text(ax + 8, ty - 22, 'unsafe sample aborts @12/40', { size: 11, font: 'mono', color: 'red', parent: g3 });
          /* beat 4 material: early-abort economics */
          var ea = ctx.group({ parent: g, opacity: 0 });
          panelRect(ctx, ea, 1180, 540, 380, 300, 'red');
          ctx.text(1200, 568, 'EARLY ABORT ECONOMICS', { size: 13, font: 'display', weight: 700, color: 'red', spacing: 1, parent: ea });
          ctx.text(1200, 604, 'rejected shot, 8 × H100', { size: 12, font: 'mono', color: 'dim', parent: ea });
          ctx.rect(1200, 624, 300, 20, { rx: 3, fill: ctx.alpha('red', 0.35), stroke: 'red', sw: 1, parent: ea });
          ctx.text(1508, 634, '760 s', { size: 12, font: 'mono', color: 'text', parent: ea });
          var b2 = ctx.rect(1200, 654, 0, 20, { rx: 3, fill: ctx.alpha('lime', 0.45), stroke: 'lime', sw: 1, parent: ea });
          ctx.text(1298, 664, '228 s  (abort @12)', { size: 12, font: 'mono', color: 'text', parent: ea });
          ctx.para(1200, 708, ['saved = ρ · (1 − k/N)', 'preview cost ≈ 1% of sampling', 'τ calibrated per step index:', 'early x₀ estimate is a blurry mean'], { size: 13, font: 'mono', color: 'text', lh: 26, parent: ea });
          var SAFE = [0.07, 0.06, 0.06, 0.05, 0.04, 0.04, 0.03, 0.03, 0.02, 0.02];
          var UNSAFE = [0.09, 0.24, 0.74];
          /* one frame of the sampling loop: step index kk of a safe or an unsafe sample */
          function frame(kk, unsafe) {
            cur.setAttribute('cx', tx0 + (tx1 - tx0) * kk / 40);
            stepT.textContent = 'step ' + kk + '/40';
            var q = Math.floor(kk / 4);
            if (kk < 4) return;
            var s = (unsafe ? UNSAFE : SAFE)[q - 1];
            var w = Math.pow(kk / 40, 0.8);
            PV.set(function (r, c) { return ctx.mix(noise[r][c], unsafe ? hazardScene(r, c) : foxScene(r, c), w); });
            var hh = Math.max(2, gh * s);
            gFill.setAttribute('height', hh);
            gFill.setAttribute('y', gy0 + gh - hh);
            gFill.setAttribute('fill', s > 0.5 ? ctx.alpha('red', 0.85) : ctx.alpha('lime', 0.8));
            scT.textContent = 'p = ' + s.toFixed(2) + (s > 0.5 ? '  (> τ)' : '  (< τ)');
            scT.setAttribute('fill', s > 0.5 ? C.red : C.text);
          }
          function reset() {
            cur.setAttribute('cx', tx0); cur.setAttribute('fill', C.lime);
            stepT.textContent = 'step 0/40'; stepT.setAttribute('fill', C.lime);
            scT.textContent = 'p = —'; scT.setAttribute('fill', C.text);
            gFill.setAttribute('height', 2); gFill.setAttribute('y', gy0 + gh - 2); gFill.setAttribute('fill', ctx.alpha('lime', 0.8));
            PV.set(function (r, c) { return noise[r][c]; });
          }
          function sample(kmax, ms, unsafe) {
            var last = -1;
            return ctx.tween(ms, function (t) {
              var kk = Math.round(t * kmax);
              frame(kk, unsafe);
              var q = Math.floor(kk / 4);
              if (q !== last && kk >= 4) { last = q; ctx.pulse(PV, { color: unsafe ? 'red' : 'pink', dur: 400 }); }
            }, 'linear');
          }
          ctx.hud('3 depths: weights · conditioning · sampling');
          /* beat 0: conditioning and the controls that act before sampling */
          return Promise.all([ctx.reveal(cd, { from: 'left' }), ctx.reveal(cards, { from: 'left', delay: 200, stagger: 120 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the sampling timeline and the free x0 estimate */
            ctx.hud('a preview every 4 steps · x0 estimate is free');
            return ctx.reveal(g1, { from: 'up' }).then(function () { return ctx.pulse(PV, { color: 'amber', dur: 600 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: a safe sample converges */
            reset();
            return sample(40, 3200, false).then(function () { ctx.hud('safe shot: p stays under τ at all 10 checks'); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: an unsafe sample is aborted at step 12 */
            reset();
            ctx.hud('unsafe sample: aborted at step 12 of 40');
            return sample(12, 1800, true).then(function () {
              cur.setAttribute('fill', C.red); stepT.setAttribute('fill', C.red);
              return ctx.reveal(g3, { from: 'down' });
            }).then(function () { return ctx.pulse(gFill, { color: 'red', times: 2, dur: 500 }); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: what the abort saves */
            ctx.hud('abort @12: 228 of 760 GPU-s · saves 70%');
            return Promise.all([ctx.reveal(ea, { from: 'right' }), ctx.animate(b2, { width: [0, 90] }, 900, 'out', 300)]);
          });
        }
      },
      /* ------------------------------------------------------------ 5 egress */
      {
        title: 'Egress classification',
        beats: [
          {
            say: 'Before the finished cut leaves the building, the fourth checkpoint watches it. Thirty seconds at twenty four frames per second is seven hundred twenty frames, far too many to judge one by one.',
            card: { tag: 'NUMBERS', title: 'Too many frames to judge', stat: { v: '720', u: 'frames', l: '30 s at 24 fps; scoring every one at ~10 ms would burn about 7 s of GPU per trailer' } },
            deep: '<p>Video is highly redundant: adjacent frames are near-duplicates. Scoring all 720 frames with a ViT classifier at ~10 ms each costs 7.2 s of GPU per trailer, most of it spent re-reading the same content.</p>' +
              '<p>Harm shows up in two ways: in a single <b>frame</b> (a sign, a face, a weapon) or only in <b>motion</b> (an act of violence, a self-harm gesture). The egress checkpoint samples frames for the first and scores short windows for the second.</p>'
          },
          {
            say: 'So we sample one frame per second plus the first frame of every shot, thirty six in all, and score each one. Shot boundaries are added because a shot can be shorter than the sampling period.',
            card: { tag: 'NUMBERS', title: 'Sample five percent of frames', stat: { v: '36', u: 'frames', l: '30 uniform samples plus 6 shot keyframes: about 0.4 s of GPU instead of 7 s' } },
            deep: '<p>Frame sampling trades recall for cost: 36 of 720 frames (5%) at ~10 ms is ≈ 0.4 s. Uniform sampling at 1 Hz catches a harmful flash of duration d with probability d (a 0.5 s flash is missed half the time), which is why keyframes at shot boundaries and adaptive densification around high-scoring frames matter.</p>' +
              '<p>The plot shows the per-frame score s<sub>t</sub>, the maximum over categories. The bump near 11.6 s is the crash impact in shot 3.</p>'
          },
          {
            say: 'On-screen text is read with OCR, the narration is transcribed, and a temporal model looks at short windows for harm that only shows in motion.',
            card: { tag: 'HOW IT WORKS', title: 'Three detectors beyond stills', body: 'OCR catches slurs and brand marks that generators hallucinate as text; ASR plus a text classifier checks the narration; a video transformer scores 16-frame windows.' },
            deep: '<ul><li><b>Temporal classifier</b>: a video transformer on 16-frame windows, for motion-defined harm (violence, self-harm acts) that is invisible in single frames.</li>' +
              '<li><b>OCR</b> on sampled frames: generated text can contain slurs, phone numbers or brand marks.</li>' +
              '<li><b>Audio track</b>: ASR of the synthesised narration, plus music fingerprinting for copyright.</li>' +
              '<li><b>Likeness</b>: face embeddings of generated faces against a public-figure gallery. The fox passes trivially.</li></ul>'
          },
          {
            say: 'Per frame scores then have to become one clip decision. The top three mean is well under the threshold, so the clip passes, while a naive noisy OR of the same scores would raise a false alarm.',
            card: { tag: 'PITFALL', title: 'Noisy-OR punishes long clips', body: 'It assumes independent frames and grows with length: 36 benign frames at 0.05 already give 0.84. Use max or top-k mean with temporal smoothing.',
              more: '<p>Noisy-OR is 1 − ∏(1 − s<sub>t</sub>). For 36 frames at s = 0.05: 1 − 0.95<sup>36</sup> = 0.84. Its false-alarm rate therefore grows with clip length, so any threshold tuned on 5 s clips is wrong for 30 s ones.</p>' },
            deep: '<p>Aggregating per-frame scores s<sub>t</sub> into a clip score matters more than it looks:</p>' +
              '<div class="eq">noisy-OR: 1 − ∏<sub>t</sub>(1 − s<sub>t</sub>) &nbsp; vs &nbsp; top-k mean: (1/k) · Σ<sub>top-k</sub> s<sub>t</sub></div>' +
              '<p>Top-k mean with k = 3 requires the peak to persist over several samples, so a single noisy frame cannot block a clip. Add temporal smoothing and calibrate the threshold per clip length.</p>'
          },
          {
            say: 'Egress is the last automatic gate before signing. Scores between a review threshold and the block threshold do not hard block; they route the clip to a human reviewer.',
            card: { tag: 'TRADE-OFF', title: 'Two thresholds, three outcomes', body: 'Pass below the review threshold, human review inside the band, block only above the hard threshold. Size the band by reviewer capacity.' },
            deep: '<p>With τ<sub>review</sub> &lt; τ<sub>block</sub>, the middle band trades reviewer time for fewer false blocks. Capacity check: 100,000 trailers a day with 0.5% in the band is 500 reviews; at 90 s each that is 12.5 reviewer-hours per day.</p>' +
              '<p>Reviewer labels flow back as training data (active learning) and as threshold-calibration data. Borderline is also where policy ambiguity lives, so disagreement between reviewers is itself a signal to fix the written policy.</p>'
          }
        ],
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
          /* sample times & scores */
          var rn = ctx.rng(5), pts = [];
          for (var u = 0; u < 30; u++) pts.push([u + 0.5, 'u']);
          bounds.slice(0, 6).forEach(function (b) { pts.push([b + 0.05, 'k']); });
          pts.sort(function (a, b) { return a[0] - b[0]; });
          pts.forEach(function (p) { var t = p[0]; p[2] = 0.035 + 0.03 * rn() + 0.34 * Math.exp(-(t - 11.6) * (t - 11.6) / (2 * 1.1 * 1.1)); });
          var g1 = ctx.group({ parent: g, opacity: 0 });
          var ticks = pts.map(function (p) {
            var x = x0 + p[0] * cw;
            return ctx.line(x, fy + 48, x, fy + 60, { color: p[1] === 'k' ? 'amber' : 'cyan', sw: 2, parent: g1 });
          });
          var py = 600, ph = 130, pw = 30 * cw;
          var plot = ctx.plot(x0, py, pw, ph, pts.map(function (p) { return [p[0], p[2]]; }), { xDomain: [0, 30], yDomain: [0, 1], color: 'pink', sw: 1.6, yLabel: 'unsafe score s_t (max over categories)', xLabel: 'seconds', parent: g1 });
          var dots = pts.map(function (p) { var q = plot.toPx(p[0], p[2]); return ctx.circle(q.x, q.y, 3.5, { fill: p[1] === 'k' ? 'amber' : 'cyan', parent: g1 }); });
          var ty = plot.toPx(0, 0.7).y;
          ctx.line(x0, ty, x0 + pw, ty, { color: 'red', dash: '6 5', sw: 1.4, parent: g1 });
          ctx.text(x0 + pw - 4, ty - 10, 'block τ = 0.7', { size: 12, font: 'mono', color: 'red', anchor: 'end', parent: g1 });
          /* aggregates computed from the actual samples */
          var sc = pts.map(function (p) { return p[2]; }).sort(function (a, b) { return b - a; });
          var top3 = (sc[0] + sc[1] + sc[2]) / 3, nor = 1 - pts.reduce(function (a, p) { return a * (1 - p[2]); }, 1);
          S.egressTop3 = top3;
          ticks.forEach(function (t) { t.setAttribute('opacity', 0); });
          dots.forEach(function (d) { d.setAttribute('opacity', 0); });
          plot.curve.setAttribute('opacity', 0);
          var scan = ctx.line(x0, fy - 8, x0, py + ph, { color: 'white', sw: 1.4, opacity: 0, parent: g });
          /* beat 2 material: three more detectors */
          var LANES = [['OCR on frames', 'no text found', 'violet'], ['ASR → text clf', 'narration clean', 'orange'], ['temporal clf ×16f', 'max 0.29 @ shot 3', 'magenta']];
          var lanes = LANES.map(function (l, i) {
            var lg = ctx.group({ parent: g, opacity: 0 });
            var y = 782 + i * 30;
            ctx.text(x0, y, l[0], { size: 12, font: 'mono', color: l[2], parent: lg });
            lg.bar = ctx.rect(250, y - 7, 0, 14, { rx: 3, fill: ctx.alpha(l[2], 0.3), stroke: ctx.alpha(l[2], 0.7), sw: 1, parent: lg });
            ctx.text(870, y, l[1], { size: 12, font: 'mono', color: 'dim', parent: lg });
            return lg;
          });
          /* beat 3 material: aggregation */
          var agg = ctx.group({ parent: g, opacity: 0 });
          panelRect(ctx, agg, 1080, 758, 480, 104, 'pink');
          ctx.text(1100, 782, 'top-3 mean = ' + top3.toFixed(2) + '  < τ   → PASS', { size: 14, font: 'mono', color: 'lime', parent: agg });
          ctx.text(1100, 810, 'noisy-OR 1−Π(1−s_t) = ' + nor.toFixed(2) + '  → false alarm', { size: 13, font: 'mono', color: 'amber', parent: agg });
          ctx.text(1100, 838, '36 of 720 frames scored ≈ 0.4 s GPU', { size: 12, font: 'mono', color: 'dim', parent: agg });
          /* beat 4 material: the human review band */
          var ty5 = plot.toPx(0, 0.5).y;
          var band = ctx.group({ parent: g, opacity: 0 });
          ctx.rect(x0, ty, pw, ty5 - ty, { rx: 0, fill: ctx.alpha('amber', 0.1), parent: band });
          ctx.line(x0, ty5, x0 + pw, ty5, { color: 'amber', dash: '6 5', sw: 1.4, parent: band });
          ctx.text(x0 + 10, (ty + ty5) / 2, 'human review band', { size: 12, font: 'mono', color: 'amber', parent: band });
          ctx.text(x0 + pw - 4, ty5 + 12, 'review τ = 0.5', { size: 12, font: 'mono', color: 'amber', anchor: 'end', parent: band });
          ctx.hud('30 s · 24 fps · 720 frames to judge');
          /* beat 0: the cut, six shots, 720 frames */
          return ctx.reveal(strip, { from: 'left' }).then(function () {
            return ctx.pulse(strip, { color: 'cyan', dur: 700 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: sample 36 frames and score them */
            ctx.hud('egress · 36 of 720 frames sampled');
            var L = plot.curve.getTotalLength();
            plot.curve.setAttribute('stroke-dasharray', L + ' ' + L);
            plot.curve.setAttribute('stroke-dashoffset', L);
            plot.curve.setAttribute('opacity', 1);
            scan.setAttribute('opacity', 0.6);
            ctx.reveal(g1, { dur: 300 });
            return ctx.tween(2600, function (t) {
              var xs = x0 + t * pw;
              scan.setAttribute('x1', xs); scan.setAttribute('x2', xs);
              plot.curve.setAttribute('stroke-dashoffset', L * (1 - t));
              pts.forEach(function (p, i) {
                if (x0 + p[0] * cw <= xs + 0.5) { ticks[i].setAttribute('opacity', 1); dots[i].setAttribute('opacity', 1); }
              });
            }, 'linear').then(function () {
              scan.setAttribute('opacity', 0);
              plot.curve.removeAttribute('stroke-dasharray'); plot.curve.removeAttribute('stroke-dashoffset');
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: OCR, ASR and the temporal model */
            return ctx.reveal(lanes, { stagger: 100 }).then(function () {
              return Promise.all(lanes.map(function (l, i) { return ctx.tween(1400, function (t) { l.bar.setAttribute('width', 600 * t); }, 'inOut', i * 150); }));
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: from 36 scores to one clip decision */
            ctx.hud('clip = top-3 mean · noisy-OR would fail it');
            return ctx.reveal(agg, { from: 'up' }).then(function () { return ctx.pulse(agg.firstChild, { color: 'lime', dur: 700 }); });
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: the middle band goes to a human */
            return ctx.reveal(band, { dur: 700 }).then(function () { return ctx.pulse(band, { color: 'amber', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 6 provenance */
      {
        title: 'Provenance & audit',
        beats: [
          {
            say: 'The fifth checkpoint makes the output accountable. An invisible watermark is woven into every frame, carrying a forty eight bit payload.',
            card: { tag: 'HOW IT WORKS', title: 'A residual the eye cannot see', body: 'A learned encoder adds a tiny residual to each frame, around 42 dB PSNR, that a matching decoder reads back as a 48 bit payload.' },
            deep: '<p>Encoder E and decoder D are trained jointly with a differentiable attack layer A (JPEG and H.264 proxies, crops, resizes, colour jitter):</p>' +
              '<div class="eq">min<sub>E,D</sub> 𝔼<sub>x,m,A</sub> [ BCE(D(A(E(x,m))), m) + λ · LPIPS(E(x,m), x) ]</div>' +
              '<p>The BCE term forces the payload m to survive; the LPIPS term keeps the residual invisible. For video the mark is embedded in every frame and detection pools evidence across frames.</p>'
          },
          {
            say: 'The payload survives re-encoding, cropping and resizing. After compression, a ten percent crop and a resize, forty four of forty eight bits still match, and the odds of that happening by chance are below one in a billion.',
            card: { tag: 'NUMBERS', title: 'A detection, not a guess', stat: { v: '7.6×10⁻¹⁰', l: 'chance that 44 of 48 payload bits match by luck' },
              more: '<p>p = Σ<sub>k≥44</sub> C(48,k) / 2<sup>48</sup> = (194,580 + 17,296 + 1,128 + 48 + 1) / 2.8·10<sup>14</sup> = 213,053 / 2.8·10<sup>14</sup> ≈ 7.6·10<sup>−10</sup>.</p>' },
            deep: '<p>Detection is a hypothesis test. Under H<sub>0</sub> (no watermark) the number of matching bits is Bin(48, ½). The tail probability of 44 or more matches is 7.6·10<sup>−10</sup>, so a threshold of 44 keeps false positives negligible even across billions of scanned files.</p>' +
              '<p>Watermarks are robust but <b>not adversarially secure</b>: regeneration or diffusion-purification attacks, and dedicated removal networks, can erase pixel watermarks. That is why a second mechanism is added next.</p>'
          },
          {
            say: 'A C2PA manifest is attached to the file, declaring that the video was created by a generative model from three ingredient sketches, hashed to the exact bytes and signed with a certificate chain.',
            card: { tag: 'HOW IT WORKS', title: 'A signed statement about the file', body: 'Actions, ingredients and a hard binding to the file bytes, wrapped in a claim and signed with COSE. Anyone can verify it against a trust list.' },
            deep: '<p>The manifest is a JUMBF box store carried in an MP4 <code>uuid</code> box. <b>Assertions</b> say what happened: <code>c2pa.actions.v2</code> with <code>digitalSourceType = trainedAlgorithmicMedia</code>, one <code>c2pa.ingredient</code> per sketch, and <code>c2pa.hash.bmff.v3</code> binding the file boxes.</p>' +
              '<p>The <b>claim</b> lists hashed URIs of the assertions and the generator. The <b>signature</b> is COSE_Sign1 (ES256) with an <code>x5chain</code> to a CA on the C2PA trust list and an RFC 3161 timestamp, so it still verifies after the certificate expires.</p>'
          },
          {
            say: 'And every checkpoint decision has been appended to a hash-chained audit log, so no record can be silently edited.',
            card: { tag: 'KEY IDEA', title: 'Tamper-evident by chaining', body: 'Each entry hashes its predecessor, so editing any past record changes every later hash. Publishing the head hash makes the log tamper-evident.' },
            deep: '<div class="eq">h<sub>i</sub> = SHA-256( h<sub>i−1</sub> ‖ e<sub>i</sub> )</div>' +
              '<p>Periodically signing or publishing the head hash to WORM storage means an editor must rewrite everything after the change <i>and</i> the published head. Certificate Transparency uses the same idea with Merkle trees for efficient inclusion proofs.</p>' +
              '<p>Events carry policy and model versions, enabling <b>replay</b>: would today\'s policy have blocked last month\'s job? Store references, not raw content, so personal data can be deleted without breaking the chain.</p>'
          },
          {
            say: 'The two halves protect each other. Metadata is stripped by most re-uploads, so the watermark identifier lets a verifier fetch the manifest from a repository. And where a watermark is erased, an intact signed manifest still proves origin.',
            card: { tag: 'STATE OF THE ART', title: 'Durable Content Credentials', body: 'A soft-binding assertion ties a watermark or fingerprint to the manifest, so credentials survive re-uploads that strip metadata.' },
            deep: '<table><tr><th></th><th>Watermark</th><th>C2PA manifest</th></tr>' +
              '<tr><td>Lives in</td><td>pixels, audio samples</td><td>file metadata</td></tr>' +
              '<tr><td>Survives</td><td>re-encode, crop, resize</td><td>lossless handling only</td></tr>' +
              '<tr><td>Says</td><td>this came from model X</td><td>who, what, how, signed</td></tr>' +
              '<tr><td>Verify with</td><td>provider\'s keyed detector</td><td>anyone, via X.509 chain</td></tr></table>' +
              '<p>The manifest carries a <b>soft binding</b> with the watermark id, so a stripped copy can recover its manifest. Neither proves a video is <i>true</i>, only where it came from: absence of credentials does not prove a video is authentic.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'CHECKPOINT 5 · PROVENANCE & AUDIT', 'pink');
          lightCP(ctx, 5);
          /* watermark: frame + delta = marked frame */
          var rn = ctx.rng(3);
          var wm = ctx.group({ parent: g });
          var fr = function (r, c) { return foxScene(r + 2, c + 5); };
          var dl = [];
          for (var r = 0; r < 8; r++) { dl.push([]); for (var c = 0; c < 8; c++) dl[r].push((rn() - 0.5) * 0.7); }
          ctx.matrix(50, 510, 8, 8, { cell: 14, gap: 2, values: fr, parent: wm });
          ctx.text(186, 572, '+', { size: 20, color: 'text', anchor: 'middle', parent: wm });
          ctx.matrix(206, 510, 8, 8, { cell: 14, gap: 2, cmap: 'diverge', values: function (r, c) { return dl[r][c]; }, parent: wm });
          ctx.text(342, 572, '=', { size: 20, color: 'text', anchor: 'middle', parent: wm });
          ctx.matrix(362, 510, 8, 8, { cell: 14, gap: 2, values: fr, parent: wm });
          ctx.text(50, 648, 'frame', { size: 12, font: 'mono', color: 'dim', parent: wm });
          ctx.text(206, 648, 'δ (×40 shown)', { size: 12, font: 'mono', color: 'dim', parent: wm });
          ctx.text(362, 648, 'PSNR ≈ 42 dB', { size: 12, font: 'mono', color: 'dim', parent: wm });
          var bits = '101100111000101101001110011010011100101011010010'.split('').map(Number);
          ctx.text(50, 682, 'payload 48 b', { size: 12, font: 'mono', color: 'pink', parent: wm });
          var P1 = ctx.matrix(160, 674, 1, 48, { cell: 6, gap: 1, values: function (r, c) { return bits[c] ? ctx.alpha('pink', 0.85) : 'rgba(255,255,255,0.06)'; }, parent: wm });
          /* beat 1 material: the attacked copy and the recovered payload */
          var wm2 = ctx.group({ parent: g, opacity: 0 });
          ctx.text(50, 716, 'after H.264', { size: 12, font: 'mono', color: 'lime', parent: wm2 });
          var P2 = ctx.matrix(160, 708, 1, 48, { cell: 6, gap: 1, values: function () { return 'rgba(255,255,255,0.03)'; }, parent: wm2 });
          ctx.text(50, 750, 'CRF 28 + 10% crop + 0.75× resize', { size: 12, font: 'mono', color: 'dim', parent: wm2 });
          var recT = ctx.text(50, 776, '', { size: 13, font: 'mono', color: 'lime', parent: wm2 });
          /* beat 2 material: the C2PA manifest and its certificate chain */
          var mang = ctx.group({ parent: g, opacity: 0 });
          var man = ctx.code({ x: 540, y: 500, w: 520, title: 'trailer.mp4 · C2PA manifest (JUMBF)', lang: 'text', size: 12, typing: true, parent: mang, lines: [
            'manifest urn:c2pa:7f3a…',
            ' claim  generator: genesis-atlas/2.3',
            '        hashed refs → assertions',
            ' assertions',
            '  c2pa.actions.v2   c2pa.created',
            '    digitalSourceType: trainedAlgorithmicMedia',
            '  c2pa.ingredient ×3  sketch_1..3.png',
            '  c2pa.hash.bmff.v3   (binds MP4 bytes)',
            '  c2pa.soft-binding   wm:9c41…',
            ' signature  COSE_Sign1 · ES256',
            '        x5chain + RFC 3161 timestamp'
          ] });
          var chain = ctx.group({ parent: g, opacity: 0 });
          [['signer cert', 'pink'], ['intermediate', 'violet'], ['trust-list CA', 'lime']].forEach(function (c, i) {
            ctx.label(625 + i * 175, 790, c[0], { color: c[1], size: 12, parent: chain });
            if (i < 2) ctx.line(625 + i * 175 + 64, 790, 625 + (i + 1) * 175 - 64, 790, { color: 'dim', arrow: true, parent: chain });
          });
          ctx.text(800, 826, 'verifiable by anyone · stripped by lossy re-upload', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: chain });
          /* beat 3 material: the hash-chained audit log */
          var EV = [['ingress.allow', 1], ['policy.allow render_shot', 2], ['gen.preview ok ×10', 3], ['egress.pass ' + (S.egressTop3 || 0.31).toFixed(2), 4], ['c2pa.signed', 5]];
          var hr = ctx.rng(99);
          function hx() { var s = ''; for (var i = 0; i < 8; i++) s += '0123456789abcdef'.charAt(Math.floor(hr() * 16)); return s; }
          var blocks = EV.map(function (e, i) {
            var bg = ctx.group({ parent: g, opacity: 0 });
            var y = 504 + i * 72;
            panelRect(ctx, bg, 1110, y, 450, 54, 'pink');
            ctx.text(1126, y + 18, 'e' + (i + 1) + '  ' + e[0], { size: 13, font: 'mono', color: 'white', parent: bg });
            ctx.text(1126, y + 38, 'h' + (i + 1) + ' = H(h' + i + ' ‖ e' + (i + 1) + ') = ' + hx() + '…', { size: 12, font: 'mono', color: 'pink', parent: bg });
            if (i < 4) ctx.line(1335, y + 56, 1335, y + 70, { color: 'pink', arrow: true, parent: bg });
            return bg;
          });
          var ticks = EV.map(function (e) { return ctx.rect(SX[e[1]] - 7, 359, 14, 14, { rx: 3, fill: ctx.alpha('pink', 0.5), stroke: 'pink', sw: 1, opacity: 0, parent: S.map }); });
          /* beat 4 material: soft binding between watermark and manifest */
          var lineY = 500 + 46 + 8 * 12 * 1.55;
          var sb = ctx.rect(548, lineY - 10, 500, 20, { rx: 4, stroke: 'amber', sw: 1.6, dash: '5 4', parent: g, opacity: 0 });
          var sbl = ctx.label(800, 476, 'watermark id = soft binding to the manifest', { color: 'amber', size: 11, parent: g, opacity: 0 });
          var sba = ctx.link({ x: 500, y: 677 }, { x: 544, y: lineY }, { color: 'amber', straight: true, parent: g, opacity: 0 });
          ctx.hud('watermark: 48 bits · PSNR ≈ 42 dB');
          /* beat 0: the invisible watermark */
          return ctx.reveal(wm, { from: 'left' }).then(function () {
            return ctx.pulse(P1, { color: 'pink', dur: 700 });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: survives the attack chain */
            ctx.hud('44 / 48 bits after attack · p ≈ 7.6e-10');
            return ctx.reveal(wm2, { from: 'up' }).then(function () {
              P2.set(function (r, c) { return (c === 5 || c === 17 || c === 30 || c === 41) ? ctx.alpha('red', 0.85) : (bits[c] ? ctx.alpha('lime', 0.8) : 'rgba(255,255,255,0.06)'); });
              recT.textContent = '44/48 bits · p ≈ 7.6 × 10⁻¹⁰ → watermarked';
              return ctx.pulse(P2, { color: 'lime', dur: 700 });
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the manifest is typed out and signed */
            ctx.hud('C2PA · COSE_Sign1 · x5chain');
            return ctx.reveal(mang, { from: 'up' }).then(function () { return man.typeAll(); }).then(function () {
              return ctx.reveal(chain, { from: 'up' });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: five decisions chained into the audit log */
            ctx.hud('audit: h_i = SHA-256(h_i-1 ‖ e_i)');
            S.auditRail.setAttribute('stroke', ctx.alpha('pink', 0.6));
            S.auditT.setAttribute('fill', C.pink);
            var ch = Promise.resolve();
            blocks.forEach(function (b, i) {
              ch = ch.then(function () {
                ctx.reveal(b, { from: 'up', dur: 350 });
                ctx.reveal(ticks[i], { dur: 300 });
                return ctx.pulse(S.cps[EV[i][1]].ring, { color: 'pink', dur: 400 });
              });
            });
            return ch;
          }).then(function () {
            return ctx.beat(4);
          }).then(function () {
            /* beat 4: the two halves point at each other */
            ctx.hud('soft binding: watermark id → manifest');
            return Promise.all([ctx.reveal(sb, { from: 'scale', dur: 500 }), ctx.reveal(sbl, { from: 'down' }), ctx.reveal(sba, { from: 'draw', dur: 500 }), ctx.pulse(P1, { color: 'amber', times: 2, dur: 600 })]);
          });
        }
      },
      /* ------------------------------------------------------------ 7 evaluation */
      {
        title: 'Evaluation loops',
        beats: [
          {
            say: 'Safety asks whether an output is allowed. Evaluation asks whether it is good. Three loops run at three speeds, and each one closes a different feedback cycle.',
            card: { tag: 'KEY IDEA', title: 'Three loops, three clocks', body: 'A critic per shot in seconds, online experiments per release in days, offline benchmark suites per model checkpoint in hours.' },
            deep: '<p>Evaluation spans three time scales, each with a different signal and a different decision:</p>' +
              '<table><tr><th>Loop</th><th>Signal</th><th>Decision</th></tr>' +
              '<tr><td>Critic (seconds)</td><td>VLM judge with a rubric</td><td>accept or re-render this shot</td></tr>' +
              '<tr><td>Online A/B (days)</td><td>completion, edit and export rate, watch-time, $/job</td><td>ship or roll back a release</td></tr>' +
              '<tr><td>Offline (hours)</td><td>VBench, FVD, CLIPScore, Elo, task success</td><td>promote a model checkpoint</td></tr></table>'
          },
          {
            say: 'The innermost loop is the critic agent, which watches each rendered shot within seconds. Here shot three has a flickering visor and scores two out of five on identity.',
            card: { tag: 'NUMBERS', title: 'The critic flags shot three', stat: { v: '2 / 5', l: 'identity score for shot 3: visor flicker between 3.1 and 3.6 seconds' } },
            deep: '<p>The critic is a VLM judge prompted with sampled frames, the shot prompt, the reference sketches and a <b>rubric</b>: prompt adherence, identity consistency, physics, artefacts, style match. It returns JSON with a score per dimension, a localised defect (a time range) and a verdict.</p>' +
              '<div class="eq">re-render if min<sub>d</sub> score<sub>d</sub> &lt; θ<sub>d</sub> &nbsp;and&nbsp; retries &lt; R<sub>max</sub></div>' +
              '<p>Taking the <b>minimum</b> over dimensions means one failed dimension is enough; averaging would hide a flicker behind good composition.</p>'
          },
          {
            say: 'So the critic sends it back. The redo edge returns shot three to the generator, and the retry lifts the identity score to four. A retry cap bounds the cost of a picky critic.',
            card: { tag: 'NUMBERS', title: 'One redo, bounded cost', stat: { v: '+30 s', u: '≈ 4 GPU-min', l: 'for one re-render of shot 3 on 8 GPUs; retries are capped at two' } },
            deep: '<p>The defect is localised in time (3.1–3.6 s), so the retry regenerates only the affected window with the same seed and a tighter identity reference: about 30 s on 8 GPUs (240 GPU-seconds) instead of a full 95 s shot.</p>' +
              '<p>The retry cap and the GPU budget bound the cost of a picky critic. Redo rate is itself a metric: a jump after a model upgrade means the generator regressed or the judge drifted, and only the calibration set can tell which.</p>'
          },
          {
            say: 'The middle loop is online A B testing of every release over days, and the outer loop is the offline benchmark suite that gates each new model checkpoint. Their signals differ, but the discipline is the same: nothing ships unmeasured.',
            card: { tag: 'HOW IT WORKS', title: 'Offline gates, online confirms', body: 'Offline suites are fast, cheap and repeatable but only proxies. Online experiments are slow and noisy but measure what users actually do.' },
            deep: '<p><b>Offline</b> (hours): VBench dimensions, FVD, CLIPScore, human pairwise preference (Elo) and agent task success decide whether a checkpoint may leave the lab.</p>' +
              '<p><b>Online</b> (days): completion rate, re-generation and edit rate, export rate, watch-time, thumbs and cost per job decide whether a release ships or rolls back.</p>' +
              '<p>The critic\'s scores are only useful if <b>calibrated against humans</b>: rank correlation on a held-out set (Spearman ρ, Cohen\'s κ) is itself a tracked metric, and judges have known biases (position, length, self-preference).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'EVALUATION · three loops, three time scales', 'teal');
          S.evo.setAttribute('filter', 'url(#fx-glow)');
          /* critic back-edge on the obs row (hidden until beat 2) */
          var be = ctx.path('M' + SX[3] + ',426 Q' + (SX[2] + SX[3]) / 2 + ',448 ' + SX[2] + ',426', { stroke: 'magenta', sw: 1.8, arrow: true, parent: S.map, opacity: 0 });
          var beL = ctx.label((SX[2] + SX[3]) / 2, 390, 'critic → redo shot 3', { color: 'magenta', size: 11, parent: S.map, opacity: 0 });
          /* concentric loops */
          var cx = 250, cy = 690;
          var RINGS = [[55, 'magenta', 1.6, 'critic agent', 'per shot · seconds'], [105, 'cyan', 0.8, 'online A/B', 'per release · days'], [155, 'teal', 0.4, 'offline suite', 'per checkpoint · hours']];
          var lg = ctx.group({ parent: g });
          var rings = [];
          var orb = RINGS.map(function (R, i) {
            rings.push(ctx.circle(cx, cy, R[0], { stroke: ctx.alpha(R[1], 0.6), sw: 1.6, dash: '4 5', parent: lg }));
            var d = ctx.circle(cx + R[0], cy, 6, { fill: R[1], glow: true, parent: lg });
            ctx.circle(440, 580 + i * 70, 6, { fill: R[1], parent: lg });
            ctx.text(456, 572 + i * 70, R[3], { size: 14, font: 'display', weight: 600, color: 'white', parent: lg });
            ctx.text(456, 592 + i * 70, R[4], { size: 12, font: 'mono', color: R[1], parent: lg });
            return d;
          });
          ctx.text(cx, cy, 'shot 3', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: lg });
          /* beat 1 material: the critic's scores */
          var g1 = ctx.group({ parent: g, opacity: 0 });
          var vals = [4.0, 4.0, 2.0, 4.0, 5.0, 4.0].map(function (s) { return (s - 1) / 4; });
          var cols = vals.map(function (v) { return v < 0.625 ? C.red : C.lime; });
          var bx = 720, by = 530, bw2 = 480, bh = 220;
          var bars = ctx.bars(bx, by, bw2, bh, vals.map(function () { return 0; }), { color: cols, labels: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], gap: 18, labelSize: 12, parent: g1 });
          var thY = by + bh * (1 - 0.625);
          ctx.line(bx - 6, thY, bx + bw2 + 6, thY, { color: 'amber', dash: '6 4', sw: 1.4, parent: g1 });
          ctx.text(bx + bw2 + 10, thY, 'θ = 3.5', { size: 12, font: 'mono', color: 'amber', parent: g1 });
          ctx.text(bx, by - 18, 'critic score per shot (1–5, min over rubric dims)', { size: 12, font: 'mono', color: 'dim', parent: g1 });
          var js = ctx.code({ x: 1295, y: 500, w: 265, title: 'critic · shot 3', lang: 'json', size: 12, typing: true, parent: g1, lines: [
            '{"adherence": 4,',
            ' "identity": 2,',
            ' "physics": 3,',
            ' "artefact": "visor',
            '    flicker 3.1-3.6 s",',
            ' "verdict": "redo"}'
          ] });
          /* beat 3 material: the slower loops' signals */
          var g3 = ctx.group({ parent: g, opacity: 0 });
          ctx.para(720, 800, ['offline: VBench dims · FVD · CLIPScore · Elo', 'online:  completion · re-edit rate · watch-time · $/job'], { size: 13, font: 'mono', color: 'text', lh: 24, parent: g3 });
          S.benchLoops.push(ctx.loop(function (t) {
            RINGS.forEach(function (R, i) {
              var a = t * R[2] + i * 2.1;
              orb[i].setAttribute('cx', cx + R[0] * Math.cos(a)); orb[i].setAttribute('cy', cy + R[0] * Math.sin(a));
            });
          }));
          ctx.hud('3 loops: seconds · days · hours');
          /* beat 0: three concentric feedback loops */
          return Promise.all([ctx.reveal(lg, { from: 'scale', s0: 0.85 }), ctx.pulse(S.evo, { color: 'teal', dur: 700 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the critic scores every shot */
            ctx.hud('critic: shot 3 identity 2 / 5 → redo');
            return ctx.reveal(g1, { from: 'right' }).then(function () {
              return Promise.all([bars.update(vals, 900), js.typeAll()]);
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the redo edge and the retry */
            ctx.hud('critic: 1 re-render · +30 s · +4 GPU-min');
            ctx.reveal(beL, { delay: 200 });
            return ctx.reveal(be, { from: 'draw', dur: 500 }).then(function () {
              return ctx.packet(be, { color: 'magenta', dur: 700, label: 'redo' });
            }).then(function () {
              vals[2] = (4.0 - 1) / 4;
              bars.bars[2].setAttribute('fill', ctx.alpha('lime', 0.75));
              bars.bars[2].setAttribute('stroke', C.lime);
              return bars.update(vals, 800);
            }).then(function () {
              var b = bars.bars[2], bxm = parseFloat(b.getAttribute('x')) + parseFloat(b.getAttribute('width')) / 2;
              ctx.reveal(ctx.label(bxm, by + bh * 0.2 - 18, 'redo: 2 → 4', { color: 'lime', size: 11, parent: g1 }), { from: 'up', dur: 300 });
              return ctx.pulse(b, { color: 'lime', dur: 600 });
            });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: the slower loops */
            ctx.hud('offline gates · online confirms');
            return Promise.all([ctx.reveal(g3, { from: 'up' }), ctx.pulse(rings[2], { color: 'teal', dur: 700 }), ctx.wait(350).then(function () { return ctx.pulse(rings[1], { color: 'cyan', dur: 700 }); })]);
          });
        }
      },
      /* ------------------------------------------------------------ 8 observability */
      {
        title: 'Observability & cost',
        beats: [
          {
            say: 'Finally, observability. One trace identifier is minted at the gateway and propagated in a traceparent header through every agent turn, model call and GPU job, so the whole trailer becomes one tree of spans.',
            card: { tag: 'HOW IT WORKS', title: 'One id follows the job', body: 'The traceparent header carries a 128 bit trace id and a 64 bit parent span id. Queues carry it as a message attribute, so GPU jobs join the same tree.' },
            deep: '<p><b>Traces</b> (Dapper, then OpenTelemetry): a trace is a tree of spans sharing a 128-bit <code>trace_id</code>. Context crosses process boundaries in the W3C header <code>traceparent: 00-&lt;trace-id&gt;-&lt;parent-span-id&gt;-&lt;flags&gt;</code>, and through queues as message attributes, so a GPU job that starts minutes later still joins the right trace.</p>' +
              '<p>GenAI spans (<code>invoke_agent</code>, <code>chat</code>, <code>execute_tool</code>) carry <code>gen_ai.request.model</code> and token counts; cache-read tokens, GPU-seconds and queue wait are custom attributes. Span links join fan-out and fan-in, such as six shot spans feeding one edit span.</p>'
          },
          {
            say: 'Drawn as a waterfall, the tree shows where the one hundred fifty one seconds went. Diffusion and the retry sit on the critical path, while narration and reference encoding run in the shadows.',
            card: { tag: 'NUMBERS', title: 'Where 151 seconds went', stat: { v: '83%', l: 'of wall clock is DiT sampling plus the retry: 125 of 151 s, 212 spans in one trace' } },
            deep: '<p>The <b>critical path</b> is the chain of spans that determines end-to-end latency: plan, storyboard, DiT (including queue wait), critic, retry, edit and sign. Reference encoding and narration run in parallel with slack, so optimising them saves nothing.</p>' +
              '<p><b>Sampling</b>: keep 1–10% of traces by head sampling, and keep <i>every</i> trace that errored, retried or breached an SLO by tail sampling in the collector. This trace is kept because it contains a retry.</p>'
          },
          {
            say: 'Metrics watch the fleet: time to first token, queue wait on the video pool, and utilization. GPU utilization looks like ninety percent while model FLOPs utilization is closer to forty.',
            card: { tag: 'PITFALL', title: 'Busy is not efficient', body: 'The GPU utilization counter only says a kernel was running. Model FLOPs utilization, achieved over peak, is the number that reveals waste.' },
            deep: '<div class="eq">MFU = achieved model FLOP/s ÷ peak (≈ 989 TFLOP/s dense BF16, H100 SXM)</div>' +
              '<p>DiT sampling is compute-bound, so MFU of 35–55% is normal; here it is 43%. LLM decode is bandwidth-bound and low MFU is expected, so watch tokens per second per GPU instead. Track SM occupancy, HBM bandwidth and NVLink utilisation through DCGM exporters.</p>' +
              '<p>The p99 TTFT spike in the chart is a prefill burst from 40 parallel agent turns arriving together.</p>'
          },
          {
            say: 'And every span carries its cost. This trailer consumed about eighty GPU minutes and a few hundred thousand tokens, roughly nine dollars per finished minute of video.',
            card: { tag: 'NUMBERS', title: 'Nine dollars a minute', stat: { v: '≈ $9', u: '/ min', l: 'of finished video: $4.61 per 30 s trailer, 69 percent of it diffusion sampling' },
              more: '<p>4,800 GPU-seconds (6 × 8 × 95 s of sampling plus 8 × 30 s of retry) is 80 GPU-minutes; at $2.5 per H100-hour that is $3.33. Add LLM tokens ($1.10 at cached and uncached prices) and audio, safety and CDN ($0.17) to reach $4.61, then double it for a full minute.</p>' },
            deep: '<table><tr><th>Item</th><th>Basis</th><th>$</th></tr>' +
              '<tr><td>DiT shots</td><td>6 × 8 GPU × 95 s</td><td>3.17</td></tr>' +
              '<tr><td>Re-render</td><td>8 GPU × 30 s</td><td>0.17</td></tr>' +
              '<tr><td>LLM tokens</td><td>0.45M in (70% cached), 40k out</td><td>1.10</td></tr>' +
              '<tr><td>Audio, safety, CDN</td><td>TTS, encoders, encode</td><td>0.17</td></tr>' +
              '<tr><td><b>Total</b></td><td>per 30 s trailer</td><td><b>4.61</b></td></tr></table>' +
              '<p>That is ≈ $9.2 per finished minute. Cost is an attribute on every span (<code>app.cost_usd</code>, <code>app.gpu_seconds</code>), so it rolls up per job, per agent and per customer. Illustrative pricing: H100 ≈ $2.5 per GPU-hour.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, C = ctx.C;
          var g = bench(ctx, 'OBSERVABILITY · traces · metrics · logs · cost', 'teal');
          S.obsRail.setAttribute('stroke', ctx.alpha('teal', 0.55));
          var spans = SX.map(function (x, i) {
            return ctx.rect(x - 70, 406, 140, 12, { rx: 3, fill: ctx.alpha('teal', 0.35 + 0.08 * i), stroke: 'teal', sw: 1, opacity: 0, parent: S.map });
          });
          var tp = ctx.code({ x: 40, y: 500, w: 620, title: 'W3C trace context', lang: 'text', size: 12, parent: g, lines: [
            'traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            '             ver  trace-id (128 b)                 parent (64 b)    flags'
          ] });
          /* beat 1 material: mini waterfall */
          var W = [['job.trailer', 0, 151, 'pink'], ['director.plan', 0, 12, 'amber'], ['refs.encode', 8, 12, 'violet'], ['render_shot ×6', 12, 107, 'lime'],
            ['critic.review', 100, 107, 'magenta'], ['shot3.retry', 107, 137, 'red'], ['tts.narration', 20, 40, 'orange'], ['edit·encode·sign', 137, 151, 'cyan']];
          var wx = 210, ww = 440, sc = ww / 151;
          var wf = ctx.group({ parent: g, opacity: 0 });
          var wb = W.map(function (w, i) {
            var y = 604 + i * 30;
            ctx.text(wx - 10, y, w[0], { size: 12, font: 'mono', color: 'text', anchor: 'end', parent: wf });
            var b = ctx.rect(wx + w[1] * sc, y - 9, 0, 18, { rx: 3, fill: ctx.alpha(w[3], 0.45), stroke: w[3], sw: 1, parent: wf });
            b.w = (w[2] - w[1]) * sc;
            return b;
          });
          [0, 50, 100, 150].forEach(function (s) { ctx.text(wx + s * sc, 850, s + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: wf }); });
          /* beat 2 material: fleet metrics */
          var mg = ctx.group({ parent: g, opacity: 0 });
          var MX = 720;
          var rn = ctx.rng(8);
          function series(n, base, amp, spike) { var a = []; for (var i = 0; i < n; i++) a.push([i, base + amp * rn() + (spike && i > 30 && i < 36 ? spike : 0)]); return a; }
          ctx.text(MX, 506, 'LLM TTFT (ms)  p50 · p99', { size: 12, font: 'mono', color: 'amber', parent: mg });
          ctx.plot(MX, 520, 360, 60, series(48, 180, 40), { xDomain: [0, 47], yDomain: [0, 1400], color: 'amber', sw: 1.4, parent: mg });
          ctx.plot(MX, 520, 360, 60, series(48, 700, 180, 380), { xDomain: [0, 47], yDomain: [0, 1400], color: ctx.alpha('amber', 0.55), sw: 1.4, axes: false, parent: mg });
          ctx.text(MX, 612, 'video queue wait p95 (s)', { size: 12, font: 'mono', color: 'lime', parent: mg });
          ctx.plot(MX, 626, 360, 60, series(48, 8, 6, 22), { xDomain: [0, 47], yDomain: [0, 40], color: 'lime', sw: 1.4, parent: mg });
          ctx.text(MX, 718, 'GPU util · MFU (video pool)', { size: 12, font: 'mono', color: 'red', parent: mg });
          ctx.plot(MX, 732, 360, 60, series(48, 0.88, 0.08), { xDomain: [0, 47], yDomain: [0, 1], color: 'red', sw: 1.4, parent: mg });
          ctx.plot(MX, 732, 360, 60, series(48, 0.4, 0.06), { xDomain: [0, 47], yDomain: [0, 1], color: 'violet', sw: 1.4, axes: false, parent: mg });
          ctx.text(MX + 366, 740, 'util 0.9', { size: 11, font: 'mono', color: 'red', parent: mg });
          ctx.text(MX + 366, 772, 'MFU 0.43', { size: 11, font: 'mono', color: 'violet', parent: mg });
          ctx.text(MX, 822, 'p99 spike = prefill burst from 40 parallel agent turns', { size: 11, font: 'mono', color: 'dim', parent: mg });
          /* beat 3 material: cost per job */
          var cg = ctx.group({ parent: g, opacity: 0 });
          panelRect(ctx, cg, 1180, 496, 380, 366, 'teal');
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
          ctx.reveal(tp, { from: 'left' });
          ctx.hud('trace 4bf92f35… · 1 tree · 212 spans');
          /* beat 0: one trace id along the whole path */
          return ctx.wait(500).then(function () {
            ctx.reveal(spans, { stagger: 120 });
            return ctx.packet(S.obsRail, { color: 'teal', dur: 1200, label: 'traceparent' });
          }).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the tree as a waterfall */
            return ctx.reveal(wf, { from: 'up' }).then(function () {
              return Promise.all(wb.map(function (b, i) { return ctx.tween(600, function (t) { b.setAttribute('width', b.w * t); }, 'out', i * 120); }));
            });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: fleet metrics */
            ctx.hud('TTFT p99 · queue wait · util vs MFU');
            return ctx.reveal(mg, { from: 'right' });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: cost rolled up from the spans */
            ctx.hud('$' + (tot * 2).toFixed(2) + ' per finished minute');
            return ctx.reveal(cg, { from: 'right' }).then(function () {
              return Promise.all(segs.map(function (r, i) { return ctx.tween(500, function (t) { r.setAttribute('width', r.w * t); }, 'out', i * 120); })
                .concat([ctx.counter(totT, 0, tot, 1000, function (v) { return '$' + v.toFixed(2); }), ctx.counter(perMin, 0, tot * 2, 1000, function (v) { return '$' + v.toFixed(2); })]));
            });
          });
        }
      },
      /* ------------------------------------------------------------ 9 summary */
      {
        title: 'The trust budget',
        beats: [
          {
            say: 'Put together, the trust plane is cheap relative to what it protects. Five checkpoints add about three seconds to a critical path of two and a half minutes.',
            card: { tag: 'NUMBERS', title: 'Cheap next to the render', stat: { v: '≈ 3 s', l: 'of trust work on a 151 s critical path: about 2 percent of wall clock' } },
            deep: '<p>The engineering target is <b>trust overhead ≪ generation cost</b>, with every checkpoint measurable:</p>' +
              '<table><tr><th>Checkpoint</th><th>Adds latency</th><th>Main failure mode</th></tr>' +
              '<tr><td>Ingress</td><td>~0.15 s</td><td>over-blocking art (false positives)</td></tr>' +
              '<tr><td>Policy · tools</td><td>~µs–ms per call</td><td>policies too coarse or stale</td></tr>' +
              '<tr><td>Gen-time</td><td>~1 s</td><td>false aborts on blurry x̂<sub>0</sub></td></tr>' +
              '<tr><td>Egress</td><td>~1–2 s</td><td>sparse sampling misses brief frames</td></tr>' +
              '<tr><td>Provenance</td><td>~1 s</td><td>metadata stripped on re-upload</td></tr></table>'
          },
          {
            say: 'They add a few percent of GPU cost, mostly from generation-time previews and egress scoring. Evaluation and tracing run asynchronously, off the critical path.',
            card: { tag: 'NUMBERS', title: 'A few percent of GPU', stat: { v: '≈ 3%', l: 'of GPU cost: previews ~1%, egress under 0.5%, evals and traces ~1%' },
              more: '<p>Ingress under 0.1%, provenance under 0.2%, egress under 0.5%, gen-time previews ~1%, evals and traces ~1%: about 3% in total. The policy engine is CPU-only and effectively free.</p>' },
            deep: '<p>Cost shares by checkpoint, relative to total GPU spend: ingress &lt;0.1%, policy ~0, generation-time ~1% (previews on every sample), egress &lt;0.5% (36 frames, a temporal window, ASR), provenance &lt;0.2%, evals and traces ~1%.</p>' +
              '<p>Evaluation and tracing are <b>asynchronous</b>: they add no latency to the user, only cost. Trace sampling (head 1–10%, tail for errors and retries) and judge-on-a-sample keep that cost bounded.</p>'
          },
          {
            say: 'What makes it work in practice is discipline. Policies and models are versioned so every decision can be replayed, thresholds are recalibrated as base rates drift, uncertain cases go to human review queues, and red team suites run on every release.',
            card: { tag: 'KEY IDEA', title: 'Discipline beats cleverness', body: 'Four habits keep the plane honest: versioned policies, recalibrated thresholds, human review of the uncertain band, red-team regression on every release.' },
            deep: '<ul><li><b>Versioned policies and models</b>: every decision event carries both, so any past job can be replayed under today\'s policy.</li>' +
              '<li><b>Calibrated thresholds</b>, revisited as base rates shift: precision is a property of the deployment, not the model.</li>' +
              '<li><b>Human review queues</b> for the uncertain band, whose labels feed back as training data.</li>' +
              '<li><b>Red-team suites</b> as regression tests: every successful attack becomes a permanent test.</li></ul>'
          },
          {
            say: 'To go deeper, open Guardrails and Provenance for classifier cascades, prompt injection defenses and content credentials, or Evals and Observability for video metrics, judges, trace waterfalls and error budgets.',
            card: { tag: 'TRY IT', title: 'Zoom into either chamber', body: 'Click a lane header on the map above: <b>Guardrails</b> for cascades, injection and C2PA, <b>Evals · Obs</b> for FVD, VBench, Elo, traces and SLOs.' },
            deep: '<div class="note">Zoom in: <b>Guardrails &amp; Provenance</b> (cascades, base rates, injection defence, CaMeL, likeness, SynthID, C2PA, red teaming) and <b>Evals &amp; Observability</b> (FVD, VBench, Elo, VLM judges, agent evals, OTel waterfall, SLOs, cost and release gates).</div>' +
              '<p>Every arrow on this map is a decision the system makes about your request, and every decision leaves an audit event and a span.</p>'
          }
        ],
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
          /* critical path with trust slices */
          var cp = ctx.group({ parent: g });
          var cx0 = 60, cwid = 1270, k = cwid / 151;
          ctx.rect(cx0, 818, cwid, 22, { rx: 4, fill: ctx.alpha('lime', 0.12), stroke: ctx.alpha('lime', 0.4), sw: 1, parent: cp });
          /* ingress 0.15 s · 10 previews × 0.1 s during sampling · egress 1.2 s · provenance 0.9 s  ≈ 3.3 s */
          var slices = [[0.3, 0.15], [138.5, 1.2], [149.5, 0.9]];
          for (var q = 1; q <= 10; q++) slices.push([12 + q * 9.5 - 0.1, 0.1]);
          var sl = slices.map(function (s) { return ctx.rect(cx0 + s[0] * k, 816, Math.max(3, s[1] * k), 26, { rx: 1, fill: 'pink', parent: cp }); });
          ctx.text(cx0, 860, 'critical path 151 s  ·  pink = trust work on the path ≈ 3 s', { size: 12, font: 'mono', color: 'dim', parent: cp });
          /* beat 2 material: four habits, over the dimmed table */
          var hab = ctx.group({ parent: g, opacity: 0 });
          var HB = [['versioned policies + models', 'every decision replayable', 'lime', 'layers'], ['calibrated thresholds', 'recheck as base rates drift', 'amber', 'chart'],
            ['human review queues', 'the uncertain band, labels fed back', 'violet', 'user'], ['red-team regression', 'every attack becomes a test', 'red', 'bolt']];
          var hn = HB.map(function (h, i) {
            return ctx.node({ x: 260 + (i % 2) * 520, y: 590 + Math.floor(i / 2) * 110, w: 480, h: 76, title: h[0], sub: h[1], icon: h[3], color: h[2], titleSize: 16, subSize: 12, parent: hab });
          });
          /* beat 3 material: zoom-in card */
          var zg = ctx.group({ parent: g, opacity: 0 });
          panelRect(ctx, zg, 1360, 500, 200, 330, 'pink');
          ctx.text(1460, 530, 'ZOOM IN', { size: 13, font: 'display', weight: 700, color: 'pink', anchor: 'middle', spacing: 1.5, parent: zg });
          ctx.para(1380, 572, ['Guardrails ⤢', 'cascades · injection', 'likeness · C2PA'], { size: 13, font: 'mono', color: 'pink', lh: 22, parent: zg });
          ctx.para(1380, 690, ['Evals · Obs ⤢', 'FVD · VBench · Elo', 'OTel · SLOs · $'], { size: 13, font: 'mono', color: 'teal', lh: 22, parent: zg });
          ctx.text(1460, 810, 'click the lane headers', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: zg });
          for (var i = 1; i <= 5; i++) lightCP(ctx, i);
          ctx.hud('trust ≈ 3 s of 151 s · ≈ 2% of wall-clock');
          var hl = ctx.rect(510, 500, 340, 290, { rx: 10, stroke: 'amber', sw: 1.6, dash: '6 5', parent: g, opacity: 0 });
          /* beat 0: the six rows and the trust slices on the critical path */
          return Promise.all([ctx.reveal(rows, { from: 'left', stagger: 120 }), ctx.reveal(cp, { delay: 700 }), ctx.reveal(sl, { from: 'scale', delay: 900, stagger: 60 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: the cost columns */
            ctx.hud('trust ≈ 3% of GPU cost · evals async');
            return ctx.reveal(hl, { from: 'scale', dur: 500 }).then(function () { return ctx.pulse(hl, { color: 'amber', times: 2, dur: 600 }); });
          }).then(function () {
            return ctx.beat(2);
          }).then(function () {
            /* beat 2: the habits that keep it working */
            ctx.hud('');
            ctx.fade(tb, 0.1, 500);
            ctx.fade(hl, 0, 500);
            return ctx.reveal(hab, { from: 'up' }).then(function () { return Promise.all(hn.map(function (n) { return ctx.pulse(n, { color: n.color, dur: 500 }); })); });
          }).then(function () {
            return ctx.beat(3);
          }).then(function () {
            /* beat 3: hand the stage back to the two lane headers */
            ctx.fade(hab, 0, 500);
            ctx.fade(tb, 0.55, 500);
            return ctx.reveal(zg, { from: 'right' }).then(function () {
              return Promise.all([ctx.pulse(S.guard, { color: 'pink', times: 2, dur: 800 }), ctx.pulse(S.evo, { color: 'teal', times: 2, dur: 800 })]);
            });
          });
        }
      }
    ]
  });
})();
