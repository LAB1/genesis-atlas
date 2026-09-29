/* L2 — Vector Memory & Retrieval. A retrieval pipeline "map" stays on top; each step drills into one stage, beat by beat:
 * shared image-text embeddings, a real HNSW graph (built and searched live on 40 nodes), recall/latency
 * trade-offs (interactive efSearch), IVF-PQ compression with ADC lookups, hybrid BM25 + dense with RRF and
 * cross-encoder reranking, the agent-memory taxonomy, and the per-shot character-consistency loop. */
(function () {
  var STG = [['Camera agent', 'needs shot 4 refs', 'agent', 'magenta'], ['Embedders', 'SigLIP 2 · text', 'eye', 'violet'],
    ['ANN index', 'HNSW · IVF-PQ', 'search', 'teal'], ['Hybrid fusion', 'BM25 + dense · RRF', 'layers', 'teal'],
    ['Reranker', 'cross-encoder', 'chart', 'amber'], ['Context', 'working memory', 'brain', 'amber']];
  var PX = [140, 390, 640, 890, 1140, 1390], PY = 288;

  function head(ctx, g, x, y, s, col) {
    return ctx.text(x, y, s, { size: 14, font: 'display', weight: 700, color: col || 'teal', spacing: 1, parent: g });
  }
  function panel(ctx, g, x, y, w, h, col) {
    return ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(6,12,24,0.72)', stroke: ctx.alpha(col || 'teal', 0.35), sw: 1.2, parent: g });
  }
  function code(ctx, o) {
    var c = ctx.code(o);
    c.lineEls.forEach(function (t) { t.style.whiteSpace = 'pre'; });
    return c;
  }
  /* start a segment invisible: elements (or arrays of them) that a later beat reveals */
  function hide() {
    Array.prototype.slice.call(arguments).forEach(function (a) {
      [].concat(a).forEach(function (e) { if (e) e.setAttribute('opacity', 0); });
    });
  }
  function view(ctx, S, keep) {
    if (S.cur) ctx.remove(S.cur, 350);
    var g = ctx.group();
    S.cur = g;
    if (keep === null) ctx.focus(null);
    else ctx.focus([g, S.pg].concat(keep.map(function (i) { return S.stg[i]; })), 0.3);
    return g;
  }
  /* tiny fox-astronaut glyph for thumbnails */
  function fox(ctx, g, cx, cy, s, col, outline) {
    var P = [[-22, -8], [-15, -30], [-6, -14], [6, -14], [15, -30], [22, -8], [13, 12], [0, 21], [-13, 12]];
    ctx.poly(P.map(function (p) { return [cx + p[0] * s, cy + p[1] * s]; }), { fill: outline ? null : ctx.alpha(col, 0.55), stroke: col, sw: 1.4, parent: g });
    ctx.poly([[-10, 6], [0, 21], [10, 6], [0, 10]].map(function (p) { return [cx + p[0] * s, cy + p[1] * s]; }), { fill: outline ? null : 'rgba(255,255,255,0.8)', stroke: outline ? col : null, sw: 1, parent: g });
    ctx.circle(cx - 7 * s, cy - 2 * s, 2 * s, { fill: '#05080f', parent: g });
    ctx.circle(cx + 7 * s, cy - 2 * s, 2 * s, { fill: '#05080f', parent: g });
    ctx.circle(cx, cy - 4 * s, 33 * s, { stroke: ctx.alpha('cyan', 0.7), sw: 1.2, dash: outline ? '3 3' : null, parent: g });
  }

  /* deterministic 40-node HNSW-like graph in a unit square */
  function buildGraph(ctx) {
    var r = ctx.rng(11), N = 40, mL = 1 / Math.log(4);
    var nodes = [];
    for (var i = 0; i < N; i++) {
      var lv = Math.min(2, Math.floor(-Math.log(1 - r()) * mL));
      nodes.push({ u: 0.04 + r() * 0.92, v: 0.06 + r() * 0.88, lv: lv });
    }
    if (!nodes.some(function (n) { return n.lv === 2; })) nodes[0].lv = 2;
    var nbr = [[], [], []];
    [0, 1, 2].forEach(function (L) {
      var ids = [];
      nodes.forEach(function (n, i) { if (n.lv >= L) ids.push(i); });
      var k = L === 0 ? 3 : 2;
      nbr[L] = nodes.map(function () { return []; });
      ids.forEach(function (i) {
        var s = ids.filter(function (j) { return j !== i; }).sort(function (a, b) { return dist(nodes[i], nodes[a]) - dist(nodes[i], nodes[b]); }).slice(0, k);
        s.forEach(function (j) {
          if (nbr[L][i].indexOf(j) < 0) nbr[L][i].push(j);
          if (nbr[L][j].indexOf(i) < 0) nbr[L][j].push(i);
        });
      });
    });
    return { nodes: nodes, nbr: nbr };
  }
  function dist(a, b) { return Math.hypot(a.u - b.u, a.v - b.v); }
  var PLY = [770, 605, 440];
  function proj(u, v, L) { return { x: 380 + u * 760 + (1 - v) * 140, y: PLY[L] + (v - 0.5) * 120 }; }

  Atlas.register({
    id: 'rag-memory',
    refs: [
      'Malkov &amp; Yashunin, <i>Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs</i>, IEEE TPAMI 2020',
      'Jégou, Douze &amp; Schmid, <i>Product Quantization for Nearest Neighbor Search</i>, IEEE TPAMI 2011; Douze et al., <i>The Faiss Library</i>, 2024',
      'Subramanya et al., <i>DiskANN: Fast Accurate Billion-point Nearest Neighbor Search on a Single Node</i>, NeurIPS 2019',
      'Cormack, Clarke &amp; Büttcher, <i>Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods</i>, SIGIR 2009; Robertson &amp; Zaragoza, <i>The Probabilistic Relevance Framework: BM25 and Beyond</i>, 2009',
      'Nogueira &amp; Cho, <i>Passage Re-ranking with BERT</i>, 2019',
      'Zhai et al., <i>Sigmoid Loss for Language Image Pre-Training (SigLIP)</i>, ICCV 2023; Tschannen et al., <i>SigLIP 2: Multilingual Vision-Language Encoders with Improved Semantic Understanding, Localization, and Dense Features</i>, 2025',
      'Park et al., <i>Generative Agents: Interactive Simulacra of Human Behavior</i>, UIST 2023',
      'Packer et al., <i>MemGPT: Towards LLMs as Operating Systems</i>, 2023',
      'Sumers et al., <i>Cognitive Architectures for Language Agents</i> (CoALA), TMLR 2024'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Memory for continuity',
        beats: [
          {
            say: 'A video model has no memory between shots. If shot four is generated from text alone, the fox will come back with a different face, a different suit, maybe a different number of ears.',
            card: { tag: 'PITFALL', title: 'Identity drifts shot by shot', body: 'A text prompt cannot pin down a face. Every shot is sampled independently, so small differences pile up until the character no longer matches.' },
            deep: '<p>A video diffusion model conditions on the prompt and, at most, the clip it is extending. Nothing carries "the fox from shot 1" into shot 4 unless we put it there, and sampling noise alone changes the ears, the markings and the suit details.</p>' +
              '<p>Every consistency technique (reference-image conditioning, subject LoRAs, identity embeddings) needs the <i>right reference at the right moment</i>. That is a retrieval problem, and it is what this chamber builds.</p>'
          },
          {
            say: 'So before every shot, the camera agent asks memory a question: a text query, a filter for this project, and a budget of eight results.',
            card: { tag: 'KEY IDEA', title: 'A retrieval call before every shot', body: 'The camera agent calls <code>memory.retrieve()</code> with a query, item kinds, a project filter and k = 8. Memory is a tool like any other.' },
            deep: '<p>Retrieval-augmented generation for a video agent is a <b>pipeline of increasingly expensive, increasingly precise filters</b>. The call carries three things beyond the query text:</p>' +
              '<ul><li><b>modalities</b>: images and text facts, embedded into one space;</li>' +
              '<li><b>filter</b>: project id and item kinds, applied <i>before</i> similarity;</li>' +
              '<li><b>k</b> and a rerank flag: how many results the context can afford.</li></ul>' +
              '<div class="note">Retrieval is filtered by tenant and project before similarity: memory isolation is a security property, not a ranking feature.</div>'
          },
          {
            say: 'The query is embedded, searched in an approximate nearest neighbour index, fused with keyword search, and reranked. Each stage sees fewer candidates and spends more compute on each one.',
            card: { tag: 'NUMBERS', title: 'A funnel from a billion to eight', stat: { v: '≈ 40', u: 'ms', l: 'p50 end to end, narrowing up to 10⁹ candidates to 8 results' } },
            deep: '<table><tr><th>Stage</th><th>Candidates</th><th>Cost / query</th></tr>' +
              '<tr><td>Embed query (text tower)</td><td>1</td><td>~5 ms GPU, batched</td></tr>' +
              '<tr><td>ANN index (HNSW / IVF-PQ)</td><td>10<sup>4</sup>–10<sup>9</sup> → 100</td><td>~1–10 ms</td></tr>' +
              '<tr><td>Hybrid fusion (BM25 + dense, RRF)</td><td>2 × 100 → 40</td><td>&lt;1 ms</td></tr>' +
              '<tr><td>Cross-encoder rerank</td><td>40 → 8</td><td>~20–80 ms GPU</td></tr></table>' +
              '<p>The chapters that follow open each row of this table.</p>'
          },
          {
            say: 'The winners land: the fox character sheet from two angles, a style sketch, the best earlier keyframe and a line from the character bible, each with its score.',
            card: { tag: 'HOW IT WORKS', title: 'Typed, scored evidence', body: 'Every hit carries a kind, an id and a score. Two sheet views, one sketch, one keyframe and one text fact are enough to pin the fox.' },
            deep: '<p>The result is used twice: as <b>context</b> for the LLM agent (images plus the character "bible" text), and as <b>conditioning</b> for the video model (reference images for identity and style). Each hit carries a payload (<code>cas://</code> URI, shot and take ids, kind), so the runtime can fetch the bytes and the agent can cite them.</p>' +
              '<p>Scores shown are post-rerank cross-encoder scores in [0, 1]; they are only comparable within one query.</p>'
          },
          {
            say: 'Those references go to two places: into the context window of the camera agent, where they cost about five thousand tokens, and into the video model as reference image conditioning.',
            card: { tag: 'WHY IT MATTERS', title: 'Retrieve, do not stuff', body: 'Hundreds of keyframes would cost hundreds of thousands of tokens and dilute attention. Retrieval keeps the working set near five thousand.' },
            deep: '<p>Why not just stuff every sketch into context? Each image costs ~10<sup>3</sup> tokens (a 1280×720 frame is about 1,200 tokens with Qwen2.5-VL-style 28×28 patch merging), a project accumulates hundreds of keyframes, and long contexts dilute attention: recall of facts in the middle of a long prompt is markedly worse (lost in the middle). Retrieval keeps the working set small and relevant.</p>' +
              '<p>The bar shows a 24k-token turn: 5k of it is memory (four images ≈ 4k plus the FX-07 bible ≈ 1k).</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, null);
          S.stg = STG.map(function (d, i) {
            return ctx.node({ x: PX[i], y: PY, w: 200, h: 64, title: d[0], sub: d[1], icon: d[2], color: d[3], titleSize: 15, subSize: 12 });
          });
          hide(S.stg);
          S.pg = ctx.group();
          S.pl = [];
          for (var i = 0; i < 5; i++) {
            var pl = ctx.link(S.stg[i], S.stg[i + 1], { straight: true, color: ctx.alpha('teal', 0.7), parent: S.pg });
            pl.setAttribute('opacity', 0);
            S.pl.push(pl);
          }
          /* beat 0: without memory the fox drifts */
          var dr = ctx.group({ parent: g });
          var DR = [['shot 1', 'orange', 0], ['shot 2 · new suit', 'amber', 0], ['shot 3 · three ears', 'orange', 1], ['shot 4 · ???', 'pink', 2]];
          var drC = DR.map(function (d, i) {
            var x = 170 + i * 310, y = 400, cg = ctx.group({ parent: dr });
            ctx.rect(x, y, 250, 190, { rx: 10, fill: 'rgba(8,16,32,0.9)', stroke: ctx.alpha(d[1], 0.6), sw: 1.2, parent: cg });
            ctx.rect(x + 12, y + 12, 226, 120, { rx: 6, fill: ctx.alpha(d[1], 0.07), parent: cg });
            fox(ctx, cg, x + 125, y + 78, 1.5, d[1], d[2] === 2);
            if (d[2] === 1) ctx.poly([[-7, -14], [0, -38], [7, -14]].map(function (p) { return [x + 125 + p[0] * 1.5, y + 78 + p[1] * 1.5]; }), { fill: ctx.alpha(d[1], 0.55), stroke: d[1], sw: 1.4, parent: cg });
            if (d[2] === 2) ctx.text(x + 125, y + 84, '?', { size: 26, font: 'display', weight: 700, color: 'pink', anchor: 'middle', parent: cg });
            ctx.text(x + 125, y + 160, d[0], { size: 14, font: 'mono', color: d[1], anchor: 'middle', parent: cg });
            hide(cg);
            return cg;
          });
          var ne = [0, 1, 2].map(function (i) {
            var t = ctx.text(170 + i * 310 + 280, 490, '≠', { size: 26, font: 'display', weight: 700, color: 'red', anchor: 'middle', parent: dr });
            t.setAttribute('opacity', 0);
            return t;
          });
          var noMem = ctx.label(800, 640, 'text-only prompts, no memory: every shot re-invents the fox', { color: 'red', size: 13, parent: dr });
          hide(noMem);
          /* beat 1: the retrieval call */
          var cpn = ctx.group({ parent: g });
          var rq = code(ctx, { x: 60, y: 400, w: 650, title: 'camera agent → memory.retrieve()', lang: 'py', size: 13, parent: cpn, typing: true, lines: [
            'refs = memory.retrieve(',
            '    query="FX-07 fox astronaut removes cracked helmet, close-up",',
            '    modalities=["image", "text"],',
            '    filter={"project": "p42", "kind": ["char_sheet", "sketch", "kf"]},',
            '    k=8, rerank=True)          # p50 ≈ 40 ms end-to-end'
          ] });
          hide(cpn);
          /* beat 3: result cards */
          var items = [['fox_sheet_front', 'char sheet', 0.94, 'amber', 'fox'], ['fox_sheet_side', 'char sheet', 0.91, 'amber', 'fox'], ['sketch_2', 'style sketch', 0.88, 'violet', 'sk'],
            ['take2_kf4', 'keyframe', 0.83, 'lime', 'kf'], ['bible: FX-07', 'text fact', 0.80, 'teal', 'doc']];
          S.cards = items.map(function (it, i) {
            var x = 770 + i * 154, y = 400, cg = ctx.group({ parent: g });
            ctx.rect(x, y, 144, 196, { rx: 8, fill: 'rgba(8,16,32,0.9)', stroke: ctx.alpha(it[3], 0.7), sw: 1.2, parent: cg });
            ctx.rect(x + 8, y + 8, 128, 96, { rx: 5, fill: ctx.alpha(it[3], 0.08), parent: cg });
            if (it[4] === 'fox') fox(ctx, cg, x + 72, y + 58, 1.05, 'orange', false);
            else if (it[4] === 'sk') fox(ctx, cg, x + 72, y + 58, 1.05, 'violet', true);
            else if (it[4] === 'kf') {
              ctx.circle(x + 112, y + 30, 14, { fill: ctx.alpha('cyan', 0.35), stroke: 'cyan', sw: 1, parent: cg });
              fox(ctx, cg, x + 60, y + 64, 0.8, 'orange', false);
            } else ctx.icon('doc', x + 72, y + 56, 40, 'teal', { parent: cg });
            ctx.text(x + 10, y + 124, it[0], { size: 12, font: 'mono', color: 'white', parent: cg });
            ctx.text(x + 10, y + 146, it[1], { size: 12, font: 'mono', color: it[3], parent: cg });
            ctx.text(x + 10, y + 176, 'score', { size: 12, font: 'mono', color: 'dim', parent: cg });
            ctx.text(x + 134, y + 176, it[2].toFixed(2), { size: 15, font: 'mono', weight: 700, color: it[3], anchor: 'end', parent: cg });
            cg.box = { x: x, y: y, w: 144, h: 196, cx: x + 72, cy: y + 98, l: x, r: x + 144, t: y, b: y + 196 };
            cg.setAttribute('opacity', 0);
            return cg;
          });
          var topL = ctx.text(770, 624, 'top-5 after rerank (of 8 returned)', { size: 12, font: 'mono', color: 'dim', parent: g });
          var withMem = ctx.para(60, 596, ['With memory: every shot is conditioned on the same', 'character sheet, sketches and approved keyframes.'], { size: 14, color: 'text', lh: 22, parent: g });
          hide(topL, withMem);
          /* beat 4: the context window of the camera agent */
          var cw = ctx.group({ parent: g });
          head(ctx, cw, 60, 680, 'CONTEXT WINDOW OF THE CAMERA AGENT (tokens)', 'amber');
          var segs = [['system prompt', 3, 'dim'], ['tool schemas', 6, 'blue'], ['retrieved: 4 images + bible', 5, 'teal'], ['shot plan', 2, 'magenta'], ['scratchpad', 8, 'amber']];
          var x0 = 60, sc = 1480 / 24;
          S.ctxSeg = null;
          segs.forEach(function (s) {
            var w = s[1] * sc;
            var r = ctx.rect(x0, 700, w - 4, 52, { rx: 5, fill: ctx.alpha(s[2], s[2] === 'teal' ? 0.35 : 0.14), stroke: ctx.alpha(s[2], 0.8), sw: s[2] === 'teal' ? 2 : 1, parent: cw });
            ctx.text(x0 + 10, 718, s[0], { size: 13, color: 'white', parent: cw });
            ctx.text(x0 + 10, 738, s[1] + 'k', { size: 12, font: 'mono', color: s[2], parent: cw });
            if (s[2] === 'teal') S.ctxSeg = r;
            x0 += w;
          });
          ctx.text(60, 790, 'The same references also go to the video model as reference-image conditioning (identity + style).', { size: 13, color: 'dim', parent: cw });
          hide(cw);

          ctx.hud('shot 4 needs the fox: no memory, no fox');
          return ctx.reveal(drC, { from: 'up', stagger: 220 }).then(function () {
            return Promise.all([ctx.reveal(ne, { stagger: 150 }), ctx.reveal(noMem, { from: 'up' })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the camera agent asks memory */
            ctx.hud('retrieve(query, kinds, project, k = 8)');
            ctx.fadeOut(dr, 400, true);
            return Promise.all([ctx.reveal(S.stg[0], { from: 'down' }), ctx.reveal(cpn, { from: 'up', delay: 200 })]).then(function () { return rq.typeAll(); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the pipeline, a funnel of candidates */
            ctx.hud('retrieve: embed → ANN → fuse → rerank → context');
            var labs = ['query', 'q ∈ ℝ¹¹⁵²', 'top-100', 'top-40', 'top-8'];
            ctx.reveal(S.stg.slice(1), { from: 'down', stagger: 110 });
            return ctx.reveal(S.pl, { from: 'draw', delay: 400, stagger: 110 }).then(function () {
              return S.pl.reduce(function (p, l, i) {
                return p.then(function () { return ctx.packet(l, { color: 'teal', dur: 450, label: labs[i] }); });
              }, Promise.resolve());
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the winners */
            return Promise.all([ctx.reveal(S.cards, { from: 'up', stagger: 120, dur: 450 }), ctx.reveal(topL, { delay: 400 }), ctx.reveal(withMem, { from: 'up', delay: 200 })]);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: into the context window, and into the video model */
            ctx.hud('memory = 5k of a 24k-token context');
            return ctx.reveal(cw, { from: 'up' }).then(function () { return ctx.pulse(S.ctxSeg, { color: 'teal', times: 2, dur: 600 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Shared embeddings',
        beats: [
          {
            say: 'Everything starts with embeddings. A SigLIP style dual encoder has an image tower and a text tower, and both project into the same space of eleven hundred fifty two numbers.',
            card: { tag: 'KEY IDEA', title: 'Two towers, one space', body: 'The image tower and the text tower are trained together, so a sentence and a picture of the same thing end up as nearby vectors.' },
            deep: '<p><b>Dual encoder</b>: image tower f (ViT, e.g. so400m/14 at 384 px → 729 patch tokens → attention-pooling head) and text tower g, each followed by a projection into a shared d-dimensional space (SigLIP 2 so400m: d = 1152; CLIP ViT-L/14: 768).</p>' +
              '<pre>image  3×384×384\n  → patch tokens 729×1152\n  → MAP head → 1152\ntext   ≤64 tokens\n  → transformer → 1152</pre>' +
              '<p>The towers never see each other at inference, so the corpus is embedded once and the index is built offline; only the query passes through a tower at request time.</p>'
          },
          {
            say: 'The towers are trained so that matching pairs point in the same direction. SigLIP uses a pairwise sigmoid loss: every image and text pair in the batch is its own yes or no question.',
            card: { tag: 'STATE OF THE ART', title: 'SigLIP: sigmoid, not softmax', body: 'No batch-wide normaliser, so the loss can be computed chunk by chunk across devices, and it works well at both small and very large batch sizes.',
              more: '<p>SigLIP 2 (2025) keeps the sigmoid objective and adds a captioning decoder loss, self-distillation and masked-patch prediction for better localisation, multilingual training data, and NaFlex variants that accept native aspect ratios instead of squashing every frame to a square.</p>' },
            deep: '<p>SigLIP trains with a pairwise <b>sigmoid</b> loss instead of CLIP\'s batch softmax:</p>' +
              '<div class="eq">L = −(1/|B|) Σ<sub>i,j</sub> log σ( y<sub>ij</sub> (τ · ẑ<sub>i</sub>·ẑ<sub>j</sub> + b) ), &nbsp; y<sub>ij</sub> = ±1</div>' +
              '<p>so every (image, text) pair is an independent binary decision with no batch-wide softmax normaliser: the loss can be computed chunk by chunk across devices without materialising the full |B|×|B| matrix. τ and b are learned (init τ = 10, b = −10) to offset the 1 : |B|−1 positive/negative imbalance.</p>'
          },
          {
            say: 'Vectors are normalised to unit length, so similarity is just a dot product: the cosine of the angle between them. The fox character sheet and the words orange fox astronaut land a small angle apart, while the ice moon backdrop points elsewhere.',
            card: { tag: 'NUMBERS', title: 'Similarity is an angle', stat: { v: '0.97', l: 'cosine of 14°, fox sheet against its caption; the ice moon sits 110° away (−0.34). A 2-D cartoon of a 1152-d sphere.' } },
            deep: '<div class="eq">ẑ = z / ‖z‖, &nbsp; s(i, t) = ẑ<sub>i</sub> · ẑ<sub>t</sub> = cos θ</div>' +
              '<p>On the unit sphere squared Euclidean distance is a monotone function of the cosine, so a nearest-neighbour index may use either:</p>' +
              '<div class="eq">‖ẑ<sub>i</sub> − ẑ<sub>t</sub>‖² = 2 − 2 cos θ</div>' +
              '<p>Cost of one comparison: 1152 multiply-adds ≈ 2.3 kFLOP. The angles in the drawing are a 2-D cartoon; in 1152 dimensions almost all random pairs are nearly orthogonal, which is what makes a small angle meaningful.</p>'
          },
          {
            say: 'Every sketch, keyframe and script beat of the project becomes one of these arrows, and retrieval is just ranking by dot product. Real cosines between an image and its matching text are small, so only the ranking is trusted.',
            card: { tag: 'PITFALL', title: 'Raw cosines look small', body: 'True image-text matches score only about 0.1 to 0.35. Never threshold at 0.8; calibrate per embedder, and rebuild the index when the model changes.' },
            deep: '<p><b>Modality gap</b>: raw image–text cosines are small (≈0.1–0.35 even for true matches); the canvas matrix is rescaled for display. Only the ranking matters, and thresholds are calibrated per embedder.</p>' +
              '<ul><li><b>Video</b>: embed ~8 keyframes per take (scene-cut aware) and store both per-frame and a mean-pooled clip vector.</li>' +
              '<li><b>Text memory</b> (script beats, critic notes) uses a dedicated text embedder (e.g. Qwen3-Embedding, gte) with Matryoshka dims: truncate 4096 → 1024 → 256 with a small recall cost.</li>' +
              '<li><b>Versioning</b>: embeddings from different models are not comparable; the index is keyed by embedder version and re-built on upgrade.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [1]);
          /* dual encoder */
          var a = ctx.group({ parent: g });
          head(ctx, a, 60, 380, 'DUAL ENCODER → ONE SPACE', 'violet');
          var th = ctx.group({ parent: a });
          ctx.rect(60, 405, 110, 84, { rx: 6, fill: ctx.alpha('orange', 0.08), stroke: 'orange', sw: 1.2, parent: th });
          fox(ctx, th, 115, 452, 0.95, 'orange', false);
          ctx.matrix(200, 407, 5, 5, { cell: 14, gap: 2, cmap: 'violet', values: function (r, c) { return 0.2 + 0.6 * ((r * 5 + c) % 7) / 7; }, parent: a });
          ctx.text(240, 504, '729 patches', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: a });
          var vit = ctx.node({ x: 390, y: 447, w: 150, h: 56, title: 'ViT so400m', sub: '+ MAP pool', color: 'violet', titleSize: 14, parent: a });
          ctx.label(115, 575, '"orange fox astronaut"', { color: 'magenta', size: 12, parent: a });
          var tt = ctx.node({ x: 390, y: 575, w: 150, h: 56, title: 'Text tower', sub: 'transformer', color: 'violet', titleSize: 14, parent: a });
          var r = ctx.rng(3);
          ctx.vector(500, 441, 12, { horizontal: true, cell: 10, gap: 2, cmap: 'diverge', parent: a, values: [Array.apply(null, Array(12)).map(function () { return r() * 2 - 1; })] });
          ctx.vector(500, 569, 12, { horizontal: true, cell: 10, gap: 2, cmap: 'diverge', parent: a, values: [Array.apply(null, Array(12)).map(function () { return r() * 2 - 1; })] });
          ctx.text(500, 470, 'ẑ_img  (1152-d)', { size: 12, font: 'mono', color: 'orange', parent: a });
          ctx.text(500, 598, 'ẑ_txt  (1152-d)', { size: 12, font: 'mono', color: 'magenta', parent: a });
          var l1 = ctx.link({ x: 282, y: 447 }, vit, { to: 'l', straight: true, color: 'violet', parent: a });
          var l2 = ctx.link({ x: 200 + 5, y: 575 }, tt, { to: 'l', straight: true, color: 'violet', parent: a });
          hide(a);
          /* similarity matrix: first the training labels, later the values */
          var m = ctx.group({ parent: g });
          var mh = head(ctx, m, 800, 380, 'TRAINING LABELS  y_ij  (+1 matching pair, −1 all others)', 'violet');
          var imgs = ['fox_sheet', 'sketch_2', 'take2_kf4', 'moon_env'], txts = ['"orange fox astronaut"', '"ink sketch, teal rim light"', '"fox kneels by pod, close-up"', '"glowing ice moon surface"'];
          var SIM = [[0.82, 0.41, 0.66, 0.12], [0.35, 0.78, 0.30, 0.38], [0.61, 0.28, 0.80, 0.22], [0.08, 0.33, 0.25, 0.85]];
          S.sm = ctx.matrix(1170, 430, 4, 4, { cell: 72, gap: 4, cmap: 'violet', values: function () { return 0.05; }, parent: m });
          txts.forEach(function (s, i) { ctx.text(1158, 466 + i * 76, s, { size: 13, font: 'mono', color: 'magenta', anchor: 'end', parent: m }); });
          imgs.forEach(function (s, j) { ctx.text(1206 + j * 76, 750, s, { size: 12, font: 'mono', color: 'orange', anchor: 'middle', parent: m }); });
          var yl = ctx.group({ parent: m });
          S.smT = [];
          for (var i2 = 0; i2 < 4; i2++) for (var j = 0; j < 4; j++) {
            var cc = S.sm.cellCenter(i2, j);
            ctx.text(cc.x, cc.y, i2 === j ? '+1' : '−1', { size: 14, font: 'mono', weight: 700, color: i2 === j ? 'lime' : 'dim', anchor: 'middle', parent: yl });
            var t = ctx.text(cc.x, cc.y, SIM[i2][j].toFixed(2), { size: 14, font: 'mono', weight: 600, color: SIM[i2][j] > 0.6 ? '#05080f' : 'text', anchor: 'middle', parent: m });
            t.setAttribute('opacity', 0);
            S.smT.push(t);
          }
          var mfoot = ctx.text(800, 790, 'SigLIP: σ(τ·ẑ_i·ẑ_t + b) per pair → the diagonal is pushed up, off-diagonals down', { size: 13, font: 'mono', color: 'dim', parent: m });
          hide(m);
          /* unit circle */
          var u = ctx.group({ parent: g });
          var CX = 400, CY = 760, R = 90;
          ctx.circle(CX, CY, R, { stroke: ctx.alpha('white', 0.25), sw: 1.2, dash: '4 4', parent: u });
          ctx.line(CX - R - 20, CY, CX + R + 20, CY, { color: 'faint', parent: u });
          ctx.line(CX, CY - R - 12, CX, CY + R + 12, { color: 'faint', parent: u });
          var V = [['fox_sheet (img)', 'orange', 38, 16], ['"orange fox astronaut"', 'magenta', 52, -12], ['ice_moon_env (img)', 'cyan', 148, 0]];
          S.arrows = V.map(function (v) {
            var ag = ctx.group({ parent: u });
            ctx.line(0, 0, R, 0, { color: v[1], sw: 2.4, arrow: true, parent: ag });
            ctx.place(ag, CX, CY, 1, -5);
            return ag;
          });
          V.forEach(function (v) {
            var t = -v[2] * Math.PI / 180;
            var lx = CX + (R + 14) * Math.cos(t), ly = CY + (R + 14) * Math.sin(t);
            ctx.text(lx, ly - 4 + v[3], v[0], { size: 12, font: 'mono', color: v[1], anchor: v[2] > 90 ? 'end' : 'start', parent: u });
          });
          ctx.path('M' + (CX + 40 * Math.cos(-38 * Math.PI / 180)) + ',' + (CY + 40 * Math.sin(-38 * Math.PI / 180)) + ' A40,40 0 0 0 ' + (CX + 40 * Math.cos(-52 * Math.PI / 180)) + ',' + (CY + 40 * Math.sin(-52 * Math.PI / 180)), { stroke: 'white', sw: 1.5, parent: u });
          ctx.text(60, 790, 'cos 14° = 0.97', { size: 13, font: 'mono', color: 'lime', parent: u });
          ctx.text(60, 814, 'cos 110° = −0.34', { size: 13, font: 'mono', color: 'red', parent: u });
          ctx.text(60, 660, '2-D cartoon of a 1152-d sphere', { size: 12, font: 'mono', color: 'dim', parent: u });
          ctx.text(60, 766, 'angles not to scale:', { size: 12, font: 'mono', color: 'dim', parent: u });
          hide(u);
          var ang = [38, 52, 148];

          /* beat 0: two towers into one space */
          ctx.hud('d = 1152 · ViT so400m/14 → 729 patches');
          return ctx.reveal(a, { from: 'up' }).then(function () { return ctx.wait(300); }).then(function () {
            return Promise.all([ctx.packet(l1, { color: 'orange', dur: 500 }), ctx.packet(l2, { color: 'magenta', dur: 500 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the pairwise sigmoid objective */
            ctx.hud('σ(τ·cos + b) per pair · τ and b learned');
            return ctx.reveal(m, { from: 'up' }).then(function () {
              return Promise.all([0, 1, 2, 3].map(function (k) { return ctx.wait(k * 150).then(function () { return ctx.pulse(S.sm.cells[k][k], { color: 'lime', dur: 600 }); }); }));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: unit vectors, cosine as an angle */
            ctx.hud('unit vectors ⇒ cosine similarity = dot product');
            return ctx.reveal(u, { from: 'fade' }).then(function () {
              return Promise.all(S.arrows.map(function (ag, k) { return ctx.transform(ag, { r: -ang[k] }, 900, 'out', k * 150); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: every item becomes an arrow; the matrix relaxes to real similarities */
            ctx.hud('true matches: raw cosine ≈ 0.1–0.35');
            mh.textContent = 'SIMILARITY  ẑ_img · ẑ_txt  (illustrative, rescaled to 0–1)';
            mfoot.textContent = 'rank by dot product · raw image-text cosines are small (modality gap)';
            ctx.fadeOut(yl, 300, true);
            return ctx.tween(1100, function (e) {
              S.sm.set(function (a2, b2) { return 0.05 + (SIM[a2][b2] - 0.05) * e; });
            }).then(function () { return ctx.reveal(S.smT, { stagger: 30, dur: 250 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'HNSW: the graph',
        beats: [
          {
            say: 'Comparing the query against every vector is fine for a few thousand items, but a platform library holds billions. Scanning a billion vectors of eleven hundred dimensions costs over two teraflops per query.',
            card: { tag: 'NUMBERS', title: 'Exact search does not scale', stat: { v: '2.3', u: 'TFLOP', l: 'to scan 10⁹ vectors of 1152 dimensions for one query, and 2.3 TB of memory traffic in fp16' } },
            deep: '<p>One dot product over d = 1152 costs about 2.3 kFLOP; a full scan of N = 10<sup>9</sup> vectors is 2.3 TFLOP and, in fp16, reads N·d·2 B = 2.3 TB. Even at 3 TB/s of HBM bandwidth that is ~0.8 s per query and a whole GPU tied up per query stream.</p>' +
              '<p>Approximate nearest neighbour (ANN) indexes trade a little recall for orders of magnitude less work. When the index fits in memory, graph indexes such as HNSW hold the best recall-versus-latency frontier.</p>'
          },
          {
            say: 'HNSW builds a navigable small world graph. Every vector is a node on the bottom layer, linked to a handful of its nearest neighbours, so from any node you can walk toward any region.',
            card: { tag: 'HOW IT WORKS', title: 'A graph of near neighbours', body: 'Each node links only to close neighbours (2M links at layer 0 in production). Walking those links works, but crossing the whole map takes many hops.' },
            deep: '<p>Insertion = search for the new point (with beam width <code>efConstruction</code>, typically 100–400), then connect it to up to <b>M</b> neighbours per layer (2M at layer 0), chosen by a diversity heuristic: keep candidate c only if it is closer to the new node than to any already-selected neighbour. This keeps long-range links and makes the graph navigable.</p>' +
              '<table><tr><th>Param</th><th>Typical</th><th>Effect</th></tr>' +
              '<tr><td>M</td><td>16–64</td><td>recall ↑, memory ↑ (≈ 2M·4 B per node at L0)</td></tr>' +
              '<tr><td>efConstruction</td><td>100–400</td><td>graph quality ↑, build time ↑</td></tr>' +
              '<tr><td>efSearch</td><td>32–512</td><td>recall ↑, latency ↑ (query-time knob)</td></tr></table>'
          },
          {
            say: 'To allow long jumps, nodes are promoted at random. With M equal to four, as drawn here, a quarter of them reach the next layer and a sixteenth the one above, exactly like a skip list.',
            card: { tag: 'KEY IDEA', title: 'A skip list for geometry', body: 'A node reaches layer L with probability M to the minus L. Upper layers are a coarse map; the bottom layer holds every vector.' },
            deep: '<p>Each inserted element draws a level from an exponential distribution:</p>' +
              '<div class="eq">ℓ = ⌊ −ln(U) · m<sub>L</sub> ⌋, &nbsp; U ~ Unif(0,1), &nbsp; m<sub>L</sub> = 1/ln M &nbsp;⇒&nbsp; P(ℓ ≥ l) = M<sup>−l</sup></div>' +
              '<p>so the number of layers grows as O(log<sub>M</sub> N). This is the skip-list idea moved from a 1-D sorted list to a proximity graph: the sparse layers let a search cross the space in a few long strides before the dense layer refines it.</p>'
          },
          {
            say: 'So the upper layers are sparse highways with long links, and the bottom layer is dense with short local links. Each node keeps only a handful of neighbours, so memory grows linearly with the number of vectors.',
            card: { tag: 'NUMBERS', title: 'Layers grow with log N', stat: { v: '7–8', u: 'layers', l: 'for 10⁹ vectors at M = 16, since layers ≈ ln N / ln M' } },
            deep: '<p>Drawn here: 40 nodes, M = 4 level statistics, and 2–3 links per node for legibility. Search cost is roughly O(log N) hops × M distance evaluations; each evaluation is a 1152-d dot product (~2.3 kFLOP).</p>' +
              '<p>Graph memory for M = 16: 2M·4 B = 128 B per vector at layer 0, plus ~1/(M−1) ≈ 7% more for the upper layers, against 2304 B for the fp16 vector itself.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [2]);
          var H = buildGraph(ctx);
          S.H = H;
          var planes = ctx.group({ parent: g });
          var edges = [ctx.group({ parent: g }), ctx.group({ parent: g }), ctx.group({ parent: g })];
          var verts = ctx.group({ parent: g });
          var dots = ctx.group({ parent: g });
          S.hEdges = edges; S.hDots = dots;
          var names = ['L0 · all 40', 'L1 · ' + H.nodes.filter(function (n) { return n.lv >= 1; }).length + ' nodes', 'L2 · ' + H.nodes.filter(function (n) { return n.lv >= 2; }).length + ' nodes'];
          S.planeG = [0, 1, 2].map(function (L) {
            var pg = ctx.group({ parent: planes });
            var c = [[-0.04, -0.06], [1.04, -0.06], [1.04, 1.06], [-0.04, 1.06]].map(function (p) { var q = proj(p[0], p[1], L); return [q.x, q.y]; });
            ctx.poly(c, { fill: ctx.alpha('teal', 0.04 + L * 0.02), stroke: ctx.alpha('teal', 0.35), sw: 1.2, parent: pg });
            ctx.text(330, PLY[L], names[L], { size: 13, font: 'mono', color: L === 0 ? 'teal' : 'white', anchor: 'end', weight: 600, parent: pg });
            return pg;
          });
          hide(S.planeG[1], S.planeG[2], verts);
          S.dot = [[], [], []];
          H.nodes.forEach(function (n, i) {
            for (var L = 0; L <= n.lv; L++) {
              var p = proj(n.u, n.v, L);
              S.dot[L][i] = ctx.circle(p.x, p.y, L === 0 ? 5 : 6.5, { fill: ctx.alpha(L === 0 ? 'teal' : (L === 1 ? 'cyan' : 'white'), 0.85), stroke: '#05080f', sw: 1, parent: dots });
              if (L > 0) {
                S.dot[L][i].setAttribute('opacity', 0);
                var q = proj(n.u, n.v, L - 1);
                ctx.line(p.x, p.y, q.x, q.y, { color: ctx.alpha('white', 0.18), sw: 1, dash: '2 4', parent: verts });
              }
            }
          });
          [0, 1, 2].forEach(function (L) {
            H.nbr[L].forEach(function (list, i) {
              list.forEach(function (j) {
                if (j < i) return;
                var a = proj(H.nodes[i].u, H.nodes[i].v, L), b = proj(H.nodes[j].u, H.nodes[j].v, L);
                ctx.line(a.x, a.y, b.x, b.y, { color: ctx.alpha(L === 0 ? 'teal' : 'cyan', L === 0 ? 0.35 : 0.55), sw: L === 0 ? 1 : 1.6, parent: edges[L] });
              });
            });
            hide(edges[L]);
          });
          hide(S.planeG[0], dots);
          /* side panel */
          var side = ctx.group({ parent: g });
          S.side = side;
          head(ctx, side, 1340, 400, 'SKIP-LIST LEVELS');
          ctx.para(1340, 430, ['m_L = 1 / ln M', 'M = 4 here', '', 'P(ℓ ≥ 1) = 1/4', 'P(ℓ ≥ 2) = 1/16', '', 'upper layers:', ' long "highway" links', 'layer 0:', ' short local links,', ' every vector'], { size: 13, font: 'mono', color: 'text', lh: 21, parent: side });
          hide(side);
          var up = S.dot[1].concat(S.dot[2]).filter(function (d) { return d; });

          /* beat 0: every vector sits on the bottom layer */
          ctx.hud('2.3 TFLOP per query if scanned exactly');
          return Promise.all([ctx.reveal(S.planeG[0], { from: 'up' }), ctx.reveal(dots, { delay: 250, dur: 800 })]).then(function () {
            return ctx.beat(1);
          }).then(function () {
            /* beat 1: local links form a small-world graph */
            return ctx.reveal(edges[0], { dur: 900 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: random promotion builds the upper layers, like a skip list */
            ctx.hud('P(level ≥ l) = M^−l · layers ≈ log_M N');
            ctx.reveal(side, { from: 'right', delay: 300 });
            return ctx.reveal(S.planeG[1], { from: 'up', dur: 500 }).then(function () {
              return Promise.all([ctx.reveal(S.planeG[2], { from: 'up', dur: 500 }), ctx.reveal(verts, { dur: 600 })]);
            }).then(function () { return ctx.reveal(up, { dur: 600 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: highways above, local roads below */
            return ctx.reveal(edges[1], { dur: 700 }).then(function () { return ctx.reveal(edges[2], { dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Greedy descent',
        beats: [
          {
            say: 'Now search. The query enters at the single entry point on the top layer, far from the answer, with only a few long links to choose from.',
            card: { tag: 'KEY IDEA', title: 'Enter at the top', body: 'Search starts from one fixed node on the sparsest layer, where every hop covers a large distance.' },
            deep: '<pre>def search(q, k, ef):\n  ep = entry_point\n  for L in range(top, 0, -1):\n    ep = greedy(q, ep, L)\n  ...</pre>' +
              '<p>The entry point is the node that reached the highest level during construction. Every layer\'s walk starts from the previous layer\'s result, so the descent never restarts from scratch.</p>'
          },
          {
            say: 'It hops greedily to whichever neighbour is closer to the query, until no neighbour improves. That node becomes the entry for the layer below, where the same walk continues with shorter links.',
            card: { tag: 'HOW IT WORKS', title: 'Greedy hops, then drop a layer', body: 'Each layer is a finer zoom. The walk stops when no neighbour is closer, then descends with that node as the new entry.',
              more: '<p>Greedy routing is provably efficient only when the graph is <i>navigable</i>. Kleinberg (2000) showed that on a lattice with long-range links drawn with probability proportional to distance<sup>−d</sup>, greedy routing finds a target in O(log² N) hops. HNSW\'s exponential layer assignment is a practical way of getting a similar scale-free mix of short and long links.</p>' },
            deep: '<p>Greedy routing is beam search with a beam of one: move to the closest neighbour of the current node until none is closer than the node itself, then take that local minimum down one layer. Because the upper layers are skip-list sparse, the expected number of hops per layer is small and the whole descent is O(log N).</p>' +
              '<p>A greedy walk can end in a local minimum on any single layer, which is harmless: the next layer starts there and has more links to escape with. Only layer 0 needs a wider beam.</p>'
          },
          {
            say: 'On the bottom layer the search widens into a beam. A candidate list of size ef search is expanded best first, and any neighbour closer than the worst of the current best is pulled in.',
            card: { tag: 'HOW IT WORKS', title: 'Beam search at layer zero', body: 'Keep the ef best nodes found so far in W. Expand the closest unexplored one; stop when even the best candidate is worse than the worst in W.' },
            deep: '<pre>  C = minheap([ep])  # candidates\n  W = maxheap([ep])  # best ef\n  seen = {ep}\n  while C:\n    c = C.pop_min()\n    if d(q,c) &gt; d(q,W.max()):\n      break\n    for e in nbrs(c, layer=0):\n      if e in seen: continue\n      seen.add(e)\n      if len(W) &lt; ef or \\\n         d(q,e) &lt; d(q,W.max()):\n        C.push(e); W.push(e)\n        if len(W) &gt; ef:\n          W.pop_max()\n  return W.smallest(k)</pre>' +
              '<p>W is a max-heap of the best ef nodes seen; C is a min-heap of candidates still to expand. The loop ends when the nearest unexpanded candidate is already worse than the worst kept result.</p>'
          },
          {
            say: 'The closest few nodes are returned. Two greedy hops and ten distance evaluations replace a scan over all forty vectors here, and the saving grows with the size of the index.',
            card: { tag: 'NUMBERS', title: 'Work per query', stat: { v: '10³–10⁴', l: 'distance evaluations per query at 10⁹ vectors and ef 64 to 256, against 10⁹ for a linear scan' } },
            deep: '<p>The upper layers give an O(log N) "zoom" toward the query region; layer 0 does the precise local search. The stop rule (nearest candidate farther than the worst result) is what bounds the work to ~ef·M distance evaluations.</p>' +
              '<p>On this 40-node toy the walk evaluates 10 distances instead of 40, as the counter shows. At 10<sup>9</sup> vectors the same logic gives thousands of evaluations instead of a billion, a ~10<sup>5</sup>-fold saving that is paid for with a small recall loss.</p>'
          },
          {
            say: 'There is one catch. Filter the search to a single project, and the graph can fall apart into disconnected islands: the beam gets stuck, and recall collapses.',
            card: { tag: 'PITFALL', title: 'Selective filters break the graph', body: 'When a filter keeps few nodes, few edges survive and the walk cannot reach the true neighbours. Engines fall back to brute force or use filter-aware graphs.',
              more: '<p>Two fixes are common. <b>Pre-filtering with a fallback</b>: if the filter passes fewer than a few percent of the vectors, scan them exactly instead of walking the graph. <b>Filter-aware graphs</b> such as ACORN build a denser graph (each node keeps γ·M neighbours) so that the sub-graph induced by almost any predicate stays navigable, at the cost of a larger index.</p>' },
            deep: '<div class="note">Failure modes: filtered search (tenant = p42) can disconnect the graph when the filter is very selective; engines switch to brute force below a selectivity threshold or use filter-aware graphs (e.g. ACORN, Filtered-DiskANN).</div>' +
              '<p>Roughly, a node keeps s·2M of its layer-0 neighbours when a filter passes a fraction s of the vectors. As that number falls toward one the graph crosses its percolation threshold and fragments. For a per-project index the safest fix is structural: keep a small exact index per tenant and use ANN only for platform-wide, unfiltered libraries.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state, H = S.H, g = S.cur;
          ctx.remove(S.side, 300);
          var Q = { u: 0.66, v: 0.3 };
          var qg = ctx.group({ parent: g });
          var qp = [0, 1, 2].map(function (L) { return proj(Q.u, Q.v, L); });
          ctx.line(qp[2].x, qp[2].y, qp[0].x, qp[0].y, { color: ctx.alpha('magenta', 0.5), sw: 1.2, dash: '3 4', parent: qg });
          qp.forEach(function (p) {
            ctx.poly([[0, -11], [3, -3], [11, -3], [4, 2], [7, 10], [0, 5], [-7, 10], [-4, 2], [-11, -3], [-3, -3]].map(function (d) { return [p.x + d[0], p.y + d[1]]; }), { fill: 'magenta', parent: qg, glow: true });
          });
          ctx.text(qp[2].x + 14, qp[2].y - 10, 'q', { size: 15, font: 'mono', weight: 700, color: 'magenta', parent: qg });
          hide(qg);
          function d(i) { return dist(H.nodes[i], Q); }
          /* entry point = first top-layer node */
          var ep = -1;
          H.nodes.forEach(function (n, i) { if (ep < 0 && n.lv === 2) ep = i; });
          var path = [];                   /* [L, from, to] */
          var cur = ep;
          for (var L = 2; L >= 1; L--) {
            var moved = true;
            while (moved) {
              moved = false;
              var best = cur;
              H.nbr[L][cur].forEach(function (j) { if (d(j) < d(best)) best = j; });
              if (best !== cur) { path.push([L, cur, best]); cur = best; moved = true; }
            }
            path.push([L - 1, cur, cur, true]);
          }
          /* beam search at layer 0 */
          var EF = 5, visited = {}, C = [cur], W = [cur], exp = [];
          visited[cur] = 1;
          while (C.length) {
            C.sort(function (a, b) { return d(a) - d(b); });
            var c = C.shift();
            W.sort(function (a, b) { return d(a) - d(b); });
            if (W.length >= EF && d(c) > d(W[W.length - 1])) break;
            var ev = [];
            H.nbr[0][c].forEach(function (e) {
              if (visited[e]) return;
              visited[e] = 1; ev.push(e);
              W.sort(function (a, b) { return d(a) - d(b); });
              if (W.length < EF || d(e) < d(W[W.length - 1])) { C.push(e); W.push(e); W.sort(function (a, b) { return d(a) - d(b); }); if (W.length > EF) W.pop(); }
            });
            exp.push({ c: c, ev: ev, W: W.slice() });
          }
          S.result = W.slice(0, 3);
          /* draw path segments (hidden) */
          var pgp = ctx.group({ parent: g });
          var segs = path.map(function (p) {
            var a = proj(H.nodes[p[1]].u, H.nodes[p[1]].v, p[3] ? p[0] + 1 : p[0]), b = proj(H.nodes[p[2]].u, H.nodes[p[2]].v, p[0]);
            var l = ctx.line(a.x, a.y, b.x, b.y, { color: 'magenta', sw: p[3] ? 2 : 3, dash: p[3] ? '4 3' : null, arrow: !p[3], parent: pgp, glow: true });
            l.setAttribute('opacity', 0);
            return l;
          });
          var epP = proj(H.nodes[ep].u, H.nodes[ep].v, 2);
          var epL = ctx.label(epP.x, epP.y - 22, 'entry point', { color: 'white', size: 11, parent: pgp });
          epL.setAttribute('opacity', 0);
          /* side panel: first the hop counter, then W */
          var wp = ctx.group({ parent: g });
          panel(ctx, wp, 1330, 380, 220, 250, 'amber');
          S.wTitle = ctx.text(1345, 404, 'GREEDY WALK', { size: 13, font: 'mono', weight: 700, color: 'amber', parent: wp });
          S.hopT = ctx.text(1345, 440, 'greedy hops: 0', { size: 12, font: 'mono', color: 'dim', parent: wp });
          S.wHead = ctx.text(1345, 426, 'node     d(q, ·)', { size: 12, font: 'mono', color: 'dim', parent: wp });
          S.wRows = [0, 1, 2, 3, 4].map(function (k) { return ctx.text(1345, 452 + k * 24, '', { size: 13, font: 'mono', color: 'text', parent: wp }); });
          S.evalT = ctx.text(1345, 584, '', { size: 12, font: 'mono', color: 'dim', parent: wp });
          var nEval = 0;
          function showW(Wl, final) {
            S.wRows.forEach(function (t, k) {
              var i = Wl[k];
              t.textContent = i === undefined ? '' : ('n' + (i < 10 ? '0' : '') + i + '      ' + d(i).toFixed(3));
              t.style.whiteSpace = 'pre';
              t.setAttribute('fill', ctx.color(final && k < 3 ? 'lime' : 'text'));
            });
            S.evalT.textContent = 'distance evals: ' + nEval + ' / 40';
          }
          hide(wp, S.wHead, S.wRows, S.evalT);
          /* beat 4: a selective filter (tenant = p42) leaves a few isolated nodes */
          var ALLOW = {}, nKeep = 0;
          H.nodes.forEach(function (n, i) { if (i % 6 === 0) { ALLOW[i] = true; nKeep++; } });
          var flt = ctx.group({ parent: g });
          var surv = 0, tot = 0;
          H.nbr[0].forEach(function (list, i) {
            list.forEach(function (j) {
              if (j < i) return;
              tot++;
              if (ALLOW[i] && ALLOW[j]) {
                surv++;
                var a = proj(H.nodes[i].u, H.nodes[i].v, 0), b = proj(H.nodes[j].u, H.nodes[j].v, 0);
                ctx.line(a.x, a.y, b.x, b.y, { color: 'lime', sw: 2, parent: flt });
              }
            });
          });
          var fl1 = ctx.label(800, 358, 'filter: project = p42  keeps ' + nKeep + ' of 40 vectors', { color: 'lime', size: 12, parent: flt });
          var fl2 = ctx.para(1345, 664, ['links surviving: ' + surv + ' of ' + tot, 'the beam is stuck in', 'an island: recall collapses'], { size: 12, font: 'mono', color: 'amber', lh: 20, parent: flt });
          var fl3 = ctx.label(1440, 760, 'fallback: brute force', { color: 'red', size: 12, parent: flt });
          hide(flt);

          /* beat 0: query and entry point */
          ctx.hud('enter at the top layer · one entry point');
          return Promise.all([ctx.reveal(qg, { from: 'scale' }), ctx.reveal(epL, { delay: 300, dur: 300 })]).then(function () {
            return ctx.pulse(S.dot[2][ep], { color: 'amber', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: greedy hops through the upper layers */
            ctx.hud('greedy descent · hops ≈ O(log N)');
            var chain = Promise.all([ctx.camera(860, 520, 1.22, 900), ctx.reveal(wp, { dur: 400 })]);
            var hops = 0;
            segs.forEach(function (l, k) {
              chain = chain.then(function () {
                if (!path[k][3]) hops++;
                S.hopT.textContent = 'greedy hops: ' + hops;
                return ctx.reveal(l, { dur: 380 });
              }).then(function () {
                var p = path[k];
                S.dot[p[0]][p[2]].setAttribute('fill', ctx.color('magenta'));
                return ctx.wait(150);
              });
            });
            return chain.then(function () { return ctx.camera(null, null, null, 800); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: beam search on layer 0 */
            ctx.hud('beam at layer 0 · evals ≈ ef · M');
            S.wTitle.textContent = 'W  (efSearch = 5)';
            S.hopT.setAttribute('y', 606);
            var chain = ctx.reveal([S.wHead, S.evalT].concat(S.wRows), { dur: 300 });
            var flash = ctx.group({ parent: g });
            exp.forEach(function (x) {
              chain = chain.then(function () {
                var cp = proj(H.nodes[x.c].u, H.nodes[x.c].v, 0);
                S.dot[0][x.c].setAttribute('fill', ctx.color('amber'));
                S.dot[0][x.c].setAttribute('r', 7);
                x.ev.forEach(function (e) {
                  nEval++;
                  var ep2 = proj(H.nodes[e].u, H.nodes[e].v, 0);
                  var fl = ctx.line(cp.x, cp.y, ep2.x, ep2.y, { color: 'amber', sw: 2, parent: flash });
                  ctx.fadeOut(fl, 700, true);
                  if (S.dot[0][e].getAttribute('fill') !== ctx.color('amber')) S.dot[0][e].setAttribute('fill', ctx.alpha('amber', 0.45));
                });
                showW(x.W, false);
                return ctx.wait(520);
              });
            });
            return chain;
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the closest few come back */
            ctx.hud('10 of 40 distances evaluated, not all');
            showW(exp.length ? exp[exp.length - 1].W : W, true);
            S.result.forEach(function (i) {
              var el = S.dot[0][i];
              el.setAttribute('fill', ctx.color('lime')); el.setAttribute('r', 8);
            });
            return Promise.all(S.result.map(function (i) { return ctx.pulse(S.dot[0][i], { color: 'lime', dur: 700 }); }));
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: a selective filter disconnects the graph */
            ctx.hud('selective filter ⇒ the graph fragments');
            var dim = [];
            S.dot[0].forEach(function (el, i) { if (el && !ALLOW[i]) dim.push(el); });
            ctx.fade(dim, 0.1, 500);
            ctx.fade([S.hEdges[0], S.hEdges[1], S.hEdges[2], pgp, wp], 0.12, 500);
            return ctx.reveal(flt, { from: 'up' }).then(function () {
              return Promise.all(Object.keys(ALLOW).map(function (i) { return ctx.pulse(S.dot[0][i], { color: 'lime', dur: 500 }); }));
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Recall vs latency',
        beats: [
          {
            say: 'HNSW is approximate, and you choose how approximate at query time. Recall at ten is the fraction of the true ten nearest neighbours that the index actually returns.',
            card: { tag: 'KEY IDEA', title: 'Recall is the price of speed', body: 'Every ANN index sits on a recall-versus-latency curve. Your job is to choose a point on it, not to reach recall 1.0.' },
            deep: '<div class="eq">recall@k = |ANN<sub>k</sub>(q) ∩ NN<sub>k</sub>(q)| / k</div>' +
              '<p>Curves are illustrative, shaped like ANN-Benchmarks results for 10 M × 1152-d vectors, single thread. Latency is roughly ∝ ef · M · d (distance evaluations dominate), while recall saturates: the last percent costs as much as the first ninety.</p>'
          },
          {
            say: 'A larger ef search explores more candidates: recall climbs toward one, and latency grows roughly linearly. Click the ef buttons below the chart to move along the curve.',
            card: { tag: 'TRY IT', title: 'Click an efSearch value', body: 'Each button is one operating point. Watch recall flatten while latency keeps climbing: the last points of recall are the expensive ones.' },
            deep: '<table><tr><th>efSearch</th><th>recall@10</th><th>latency</th></tr>' +
              '<tr><td>16</td><td>0.820</td><td>0.35 ms</td></tr>' +
              '<tr><td>32</td><td>0.910</td><td>0.6 ms</td></tr>' +
              '<tr><td>64</td><td>0.960</td><td>1.1 ms</td></tr>' +
              '<tr><td>128</td><td>0.985</td><td>2.0 ms</td></tr>' +
              '<tr><td>256</td><td>0.995</td><td>3.8 ms</td></tr></table>' +
              '<p>From ef 16 to 256, latency grows 11× while missed neighbours fall from 18% to 0.5%. Each doubling of ef costs roughly twice the distance evaluations but buys a shrinking slice of recall, which is why serving systems pick ef from a latency budget rather than chasing the last percent.</p>'
          },
          {
            say: 'A larger M gives a better connected graph and higher recall at the same ef, but it costs memory and build time. The violet curve is M equal to thirty two.',
            card: { tag: 'TRADE-OFF', title: 'M buys recall with memory', body: 'Doubling M lifts recall at every ef and shifts latency up, and it doubles the graph: 1.3 GB becomes 2.6 GB at ten million vectors.' },
            deep: '<table><tr><th>Knob ↑</th><th>Recall</th><th>Lat.</th><th>RAM</th><th>Build</th></tr>' +
              '<tr><td>efSearch</td><td>↑</td><td>↑</td><td>–</td><td>–</td></tr>' +
              '<tr><td>M</td><td>↑</td><td>↑ (mild)</td><td>↑</td><td>↑</td></tr>' +
              '<tr><td>efConstruction</td><td>↑</td><td>–</td><td>–</td><td>↑</td></tr></table>' +
              '<p>efConstruction is a one-off build cost; efSearch is a per-query dial; M is fixed at build time and can only be changed by rebuilding. Doubling M doubles the graph (N·2M·4 B) and roughly doubles insertion time, so pick it for the memory you can afford and tune efSearch afterwards.</p>'
          },
          {
            say: 'Memory is where the real bill lands. Ten million vectors of eleven hundred fifty two dimensions take twenty three gigabytes in half precision, and the graph adds only one or two more.',
            card: { tag: 'NUMBERS', title: 'Vectors dominate memory', stat: { v: '23', u: 'GB', l: 'of fp16 vectors at 10⁷ × 1152-d, against 1.3 GB for the M = 16 graph' } },
            deep: '<p><b>Memory</b> for N = 10<sup>7</sup>, d = 1152, fp16:</p>' +
              '<div class="eq">vectors = N·d·2 B ≈ 23 GB; &nbsp; graph ≈ N·2M·4 B ≈ 1.3 GB (M = 16)</div>' +
              '<p>The vectors, not the graph, dominate, which is why the next step compresses them. HNSW also wants everything in RAM because each hop is a random access; for 10<sup>9</sup> vectors, <b>DiskANN</b> keeps a Vamana graph plus PQ codes in RAM and full vectors on NVMe (~1 SSD read per hop), and GPU indexes (CAGRA in cuVS, Faiss-GPU IVF) trade memory for massive batch throughput.</p>'
          },
          {
            say: 'For our trailer, missing the right character sheet is costly, so the camera agent runs at high recall and pays a millisecond or two.',
            card: { tag: 'WHY IT MATTERS', title: 'Recall follows the cost of a miss', body: 'A wrong reference can mean a re-render of about 95 seconds on eight GPUs. Two extra milliseconds at ef 128 is cheap insurance.' },
            deep: '<p>The operating point is chosen against what a miss costs downstream. Here retrieval is ~12 ms inside a turn that spends ~90 s of GPU time, so ef 128 (recall@10 ≈ 0.985, ~2 ms) is a rounding error in latency while cutting missed neighbours by half relative to ef 64.</p>' +
              '<p>Recall@10 is measured over ten neighbours; the top one or two references the agent really needs are usually found much earlier, and the cross-encoder in step 7 re-ranks whatever the index returns, so recall@10 at the index is a floor, not the final quality.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [2]);
          var EF = [16, 32, 64, 128, 256, 512];
          var C16 = { rec: [0.82, 0.91, 0.96, 0.985, 0.995, 0.998], lat: [0.35, 0.6, 1.1, 2.0, 3.8, 7.2] };
          var C32 = { rec: [0.88, 0.95, 0.98, 0.993, 0.998, 0.999], lat: [0.5, 0.85, 1.5, 2.8, 5.2, 9.8] };
          var lg = function (v) { return Math.log(v) / Math.LN10; };
          var ax = ctx.group({ parent: g });
          head(ctx, ax, 80, 380, 'RECALL@10 vs LATENCY  (illustrative, 10M × 1152-d, 1 thread)');
          var X = 130, Y = 420, W = 660, Hh = 330;
          var xd = [lg(0.25), lg(14)], yd = [0.8, 1.0];
          function mk(Cv) { return Cv.lat.map(function (l, i) { return [lg(l), Cv.rec[i]]; }); }
          var p16 = ctx.plot(X, Y, W, Hh, mk(C16), { xDomain: xd, yDomain: yd, color: 'teal', sw: 2.5, parent: g });
          var p32 = ctx.plot(X, Y, W, Hh, mk(C32), { xDomain: xd, yDomain: yd, color: 'violet', sw: 2.5, axes: false, parent: g });
          [0.5, 1, 2, 5, 10].forEach(function (v) { var p = p16.toPx(lg(v), 0.8); ctx.text(p.x, Y + Hh + 18, v + ' ms', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: ax }); });
          [0.8, 0.85, 0.9, 0.95, 1.0].forEach(function (v) {
            var p = p16.toPx(xd[0], v);
            ctx.text(X - 10, p.y, v.toFixed(2), { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: ax });
            ctx.line(X, p.y, X + W, p.y, { color: ctx.alpha('white', 0.05), parent: ax });
          });
          var lab16 = ctx.label(X + W - 120, Y + Hh - 60, 'M = 16', { color: 'teal', size: 12, anchor: 'start', parent: g });
          var lab32 = ctx.label(X + W - 120, Y + Hh - 30, 'M = 32', { color: 'violet', size: 12, anchor: 'start', parent: g });
          S.pts16 = C16.lat.map(function (l, i) { var p = p16.toPx(lg(l), C16.rec[i]); return ctx.circle(p.x, p.y, 4, { fill: 'teal', parent: g }); });
          var pts32 = C32.lat.map(function (l, i) { var p = p16.toPx(lg(l), C32.rec[i]); return ctx.circle(p.x, p.y, 4, { fill: 'violet', parent: g }); });
          hide(ax, p16, p32, lab16, lab32, S.pts16, pts32);
          S.mk = ctx.group({ parent: g });
          ctx.circle(0, 0, 11, { stroke: 'amber', sw: 2.5, parent: S.mk, glow: true });
          /* readout */
          var ro = ctx.group({ parent: g });
          panel(ctx, ro, 880, 400, 660, 200, 'amber');
          ctx.text(900, 428, 'OPERATING POINT (M = 16)', { size: 13, font: 'display', weight: 700, color: 'amber', spacing: 1, parent: ro });
          S.roEf = ctx.text(900, 470, '', { size: 22, font: 'mono', weight: 700, color: 'white', parent: ro });
          S.roRec = ctx.text(900, 510, '', { size: 16, font: 'mono', color: 'teal', parent: ro });
          S.roLat = ctx.text(900, 540, '', { size: 16, font: 'mono', color: 'amber', parent: ro });
          S.roMiss = ctx.text(900, 572, '', { size: 13, font: 'mono', color: 'dim', parent: ro });
          hide(ro);
          /* memory */
          var mem = ctx.group({ parent: g });
          head(ctx, mem, 880, 650, 'MEMORY · N = 10⁷, d = 1152, fp16');
          var mx = 900, mw = 500 / 26;
          [['M = 16', 1.3, 'teal', 700], ['M = 32', 2.6, 'violet', 770]].forEach(function (r) {
            ctx.text(mx, r[3] - 20, r[0], { size: 12, font: 'mono', color: r[2], parent: mem });
            ctx.rect(mx, r[3] - 8, 23 * mw, 26, { rx: 4, fill: ctx.alpha('white', 0.1), stroke: ctx.alpha('white', 0.3), sw: 1, parent: mem });
            ctx.text(mx + 10, r[3] + 5, 'vectors 23 GB', { size: 12, font: 'mono', color: 'white', parent: mem });
            ctx.rect(mx + 23 * mw, r[3] - 8, r[1] * mw, 26, { rx: 4, fill: ctx.alpha(r[2], 0.5), stroke: r[2], sw: 1, parent: mem });
            ctx.text(mx + (23 + r[1]) * mw + 8, r[3] + 5, 'graph ' + r[1] + ' GB', { size: 12, font: 'mono', color: r[2], parent: mem });
          });
          ctx.text(900, 820, 'vectors dominate → compress them (next step)', { size: 13, color: 'dim', parent: mem });
          hide(mem);
          /* interactive ef chips */
          var ch = ctx.group({ parent: g });
          S.efChips = [];
          function setEf(i, dur) {
            S.efI = i;
            var p = p16.toPx(lg(C16.lat[i]), C16.rec[i]);
            S.efChips.forEach(function (c, k) { c.setAttribute('opacity', k === i ? 1 : 0.45); });
            S.roEf.textContent = 'efSearch = ' + EF[i];
            S.roRec.textContent = 'recall@10 ≈ ' + C16.rec[i].toFixed(3);
            S.roLat.textContent = 'latency   ≈ ' + C16.lat[i] + ' ms / query';
            S.roLat.style.whiteSpace = 'pre';
            S.roMiss.textContent = 'true top-10 neighbours missed ≈ ' + ((1 - C16.rec[i]) * 100).toFixed(1) + '%';
            return ctx.transform(S.mk, { x: p.x, y: p.y }, dur === undefined ? 500 : dur, 'inOut');
          }
          ctx.text(X, 812, 'click efSearch:', { size: 12, font: 'mono', color: 'dim', parent: ch });
          EF.forEach(function (e, i) {
            var c = ctx.label(X + 150 + i * 82, 812, String(e), { color: 'amber', size: 13, w: 66, parent: ch });
            c.style.cursor = 'pointer';
            c.addEventListener('click', function () { setEf(i, 400); });
            S.efChips.push(c);
          });
          var p0 = p16.toPx(lg(C16.lat[0]), C16.rec[0]);
          ctx.place(S.mk, p0.x, p0.y);
          setEf(0, 0);
          hide(ch, S.mk);

          /* beat 0: the recall / latency curve */
          ctx.hud('recall@10 = share of the true top-10 found');
          return Promise.all([ctx.reveal(ax), ctx.reveal(p16, { from: 'fade' }), ctx.reveal(lab16, { delay: 300 })]).then(function () {
            return Promise.all([ctx.reveal(p16.curve, { from: 'draw', dur: 1000 }), ctx.reveal(S.pts16, { delay: 500, stagger: 150, dur: 300 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: sweep efSearch */
            ctx.hud('ef 16 → 256: recall 0.82 → 0.995, latency ×11');
            return Promise.all([ctx.reveal(ro, { from: 'up' }), ctx.reveal(ch, { from: 'up', delay: 200 }), ctx.reveal(S.mk, { from: 'scale', delay: 300 })]).then(function () {
              return ctx.wait(400);
            }).then(function () { return setEf(1, 550); }).then(function () { return ctx.wait(250); })
              .then(function () { return setEf(2, 550); }).then(function () { return ctx.wait(250); })
              .then(function () { return setEf(3, 550); }).then(function () { return ctx.wait(250); })
              .then(function () { return setEf(4, 550); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: a larger M shifts the whole curve up */
            ctx.hud('M 16 → 32: recall ↑ · graph memory ×2');
            return Promise.all([ctx.reveal(p32, { from: 'fade' }), ctx.reveal(lab32, { delay: 300 })]).then(function () {
              return Promise.all([ctx.reveal(p32.curve, { from: 'draw', dur: 1000 }), ctx.reveal(pts32, { delay: 500, stagger: 150, dur: 300 })]);
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: memory is dominated by the vectors */
            ctx.hud('10⁷ × 1152-d fp16 = 23 GB · graph 1.3 GB');
            return ctx.reveal(mem, { from: 'up' });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: settle at ef 128 */
            ctx.hud('operating point: ef 128 · recall 0.985 · 2 ms');
            return setEf(3, 800).then(function () {
              var pp = p16.toPx(lg(C16.lat[3]), C16.rec[3]);
              return ctx.pulse({ box: { x: pp.x - 11, y: pp.y - 11, w: 22, h: 22 } }, { color: 'amber', times: 2, dur: 600, parent: g });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'IVF-PQ compression',
        beats: [
          {
            say: 'At a billion vectors, raw embeddings need over two terabytes, and every query would have to read all of them. Two ideas fix that: skip most of the data, and shrink what remains.',
            card: { tag: 'KEY IDEA', title: 'Skip most data, shrink the rest', body: 'An inverted file decides which cells to scan. Product quantisation compresses every vector to a few dozen bytes and turns distances into table lookups.' },
            deep: '<p>The two levers compose: IVF cuts the <i>number of vectors touched</i>, PQ cuts the <i>bytes per vector touched</i>, and asymmetric distance computation cuts the <i>arithmetic per byte</i>.</p>' +
              '<table><tr><th>10<sup>9</sup> vectors</th><th>Bytes/vec</th><th>Total</th></tr><tr><td>fp16 raw</td><td>2304</td><td>2.3 TB</td></tr><tr><td>PQ48 + 8 B id</td><td>56</td><td>56 GB</td></tr></table>' +
              '<p>Coarse centroids are tiny: 2<sup>18</sup> × 1152 × 4 B ≈ 1.2 GB, negligible against the codes.</p>'
          },
          {
            say: 'First, an inverted file. Cluster the vectors around coarse centroids, and at query time scan only the few cells nearest the query. Here three of nine cells are probed.',
            card: { tag: 'TRADE-OFF', title: 'n_probe trades recall for speed', body: 'Probing more cells finds more true neighbours but scans more codes. The neighbours you miss sit just across a cell boundary.' },
            deep: '<p><b>IVF</b>: k-means with n<sub>list</sub> coarse centroids (rule of thumb 4–16·√N, so 2<sup>18</sup> for 10<sup>9</sup>); each vector is stored in the list of its nearest centroid. A query scans only the n<sub>probe</sub> closest lists: with n<sub>list</sub> = 2<sup>18</sup> and n<sub>probe</sub> = 64, a 10<sup>9</sup>-vector index scans ≈ 2.4·10<sup>5</sup> codes per query, 0.024% of the data.</p>'
          },
          {
            say: 'Second, product quantisation. Split each eleven hundred fifty two dimensional vector into forty eight sub-vectors of twenty four numbers, and learn two hundred fifty six centroids for each sub-space with k means.',
            card: { tag: 'HOW IT WORKS', title: 'Split, then learn 256 centroids each', body: 'Every 24-d sub-space gets its own codebook of 256 centroids. Eight bits are enough to name the nearest one.' },
            deep: '<p><b>PQ</b>: x = [x<sub>1</sub> … x<sub>m</sub>], x<sub>j</sub> ∈ ℝ<sup>d/m</sup>; codebook C<sub>j</sub> has 256 centroids (8 bits):</p>' +
              '<div class="eq">code<sub>j</sub>(x) = argmin<sub>c</sub> ‖x<sub>j</sub> − C<sub>j</sub>[c]‖², &nbsp; m = 48, d/m = 24</div>' +
              '<p>All codebooks together are a tensor of shape [48, 256, 24], 294,912 floats or 1.2 MB: trivially small, and shared by every vector in the index.</p>'
          },
          {
            say: 'Store just the byte index of the nearest centroid in each sub-space: forty eight bytes instead of two thousand three hundred. A billion vectors then fit in about fifty six gigabytes, on one server.',
            card: { tag: 'NUMBERS', title: 'Compression', stat: { v: '48×', l: 'smaller: 2304 B per vector becomes 48 B of codes, 56 B with its id, so 10⁹ vectors take 56 GB' } },
            deep: '<p>Compression ratio 2304 / 48 = 48×, at the price of quantisation error. PQ is lossy, so production systems <b>refine</b>: re-score the top few hundred candidates with exact vectors fetched from SSD, restoring most of the recall.</p>' +
              '<p>Refinements worth knowing: OPQ learns a rotation so sub-spaces carry equal variance; 4-bit codes with SIMD fast-scan make scans several times faster; scalar and binary quantisers such as RaBitQ (1 bit per dimension with an error bound) target the extreme end of the memory-recall curve.</p>'
          },
          {
            say: 'At query time, precompute a small table of squared distances from each query piece to every centroid. The distance to any stored vector is then forty eight table lookups and additions, with no high dimensional arithmetic.',
            card: { tag: 'HOW IT WORKS', title: 'Distances by table lookup', body: 'The query stays exact; only the database is quantised. One 48 × 256 table of 48 KB serves every code scanned for this query.',
              more: '<p>ADC is asymmetric because the query is not quantised. The symmetric variant (quantise both sides, look up centroid-to-centroid distances) is faster to set up but noisier, so it is rarely used for ranking.</p>' },
            deep: '<p><b>Asymmetric distance (ADC)</b>: the query stays exact:</p>' +
              '<div class="eq">T[j][c] = ‖q<sub>j</sub> − C<sub>j</sub>[c]‖², &nbsp; d̃(q,x) = Σ<sub>j=1</sub><sup>m</sup> T[j][code<sub>j</sub>(x)]</div>' +
              '<p>The table is 48 × 256 floats = 48 KB (fits in L1/L2 or GPU shared memory); per code: 48 lookups + adds instead of a 1152-d dot product. In IVF-PQ the residual x − centroid is quantised, which improves accuracy. Fast-scan variants use 4-bit codes and SIMD shuffles for in-register lookups.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [2]);
          /* IVF */
          var iv = ctx.group({ parent: g });
          var ivH = head(ctx, iv, 60, 380, 'IVF · 9 coarse cells, every vector in one of them');
          panel(ctx, iv, 60, 395, 560, 420);
          var r = ctx.rng(21);
          var cents = [];
          for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) cents.push({ x: 150 + b * 190 + (r() - 0.5) * 60, y: 470 + a * 125 + (r() - 0.5) * 40 });
          var q = { x: 380, y: 610 };
          var order = cents.map(function (c, i) { return i; }).sort(function (i, j) { return Math.hypot(cents[i].x - q.x, cents[i].y - q.y) - Math.hypot(cents[j].x - q.x, cents[j].y - q.y); });
          var probe = order.slice(0, 3);
          var PT = [], halos = [];
          cents.forEach(function (c, i) {
            var on = probe.indexOf(i) >= 0;
            var halo = ctx.circle(c.x, c.y, 58, { fill: ctx.alpha('teal', 0.05), stroke: ctx.alpha('teal', 0.2), sw: 1, dash: '3 4', parent: iv });
            halos.push(halo);
            for (var k = 0; k < 7; k++) {
              var an = r() * Math.PI * 2, rd = 10 + r() * 42;
              PT.push([ctx.circle(c.x + Math.cos(an) * rd, c.y + Math.sin(an) * rd * 0.8, 3.5, { fill: ctx.alpha('teal', 0.7), parent: iv }), on, i]);
            }
            ctx.rect(c.x - 6, c.y - 6, 12, 12, { rx: 2, fill: 'white', parent: iv });
          });
          var qs = ctx.poly([[0, -11], [3, -3], [11, -3], [4, 2], [7, 10], [0, 5], [-7, 10], [-4, 2], [-11, -3], [-3, -3]].map(function (d) { return [q.x + d[0], q.y + d[1]]; }), { fill: 'magenta', parent: iv, glow: true });
          qs.setAttribute('opacity', 0);
          ctx.text(80, 800, '■ coarse centroid   ● PQ-coded vector', { size: 12, font: 'mono', color: 'dim', parent: iv });
          hide(iv);
          /* big number of the problem, shown in beat 0 only */
          var big = ctx.group({ parent: g });
          ctx.text(940, 540, '2.3 TB', { size: 56, font: 'display', weight: 700, color: 'red', anchor: 'middle', parent: big });
          ctx.text(1270, 540, '2.3 TFLOP', { size: 56, font: 'display', weight: 700, color: 'amber', anchor: 'middle', parent: big });
          ctx.text(940, 592, 'raw fp16 embeddings · 10⁹ × 1152-d', { size: 15, color: 'dim', anchor: 'middle', parent: big });
          ctx.text(1270, 592, 'per query for an exact scan', { size: 15, color: 'dim', anchor: 'middle', parent: big });
          ctx.text(1100, 640, 'a full scan reads all of it, for every query', { size: 15, color: 'text', anchor: 'middle', parent: big });
          hide(big);
          /* memory bars */
          var mem = ctx.group({ parent: g });
          head(ctx, mem, 680, 775, 'MEMORY FOR 10⁹ VECTORS');
          ctx.rect(690, 790, 820, 24, { rx: 4, fill: ctx.alpha('white', 0.12), stroke: ctx.alpha('white', 0.35), sw: 1, parent: mem });
          ctx.text(700, 802, 'fp16 raw: 2.3 TB', { size: 12, font: 'mono', color: 'white', parent: mem });
          hide(mem);
          var mem2 = ctx.group({ parent: g });
          S.pqBar = ctx.rect(690, 824, 820 * 56 / 2304, 24, { rx: 3, fill: ctx.alpha('amber', 0.7), stroke: 'amber', sw: 1, parent: mem2 });
          ctx.text(720, 836, 'PQ48 + id: 56 GB (2.4%) → fits one server', { size: 12, font: 'mono', color: 'amber', parent: mem2 });
          hide(mem2);
          /* PQ: split + codebook */
          var pq = ctx.group({ parent: g });
          head(ctx, pq, 680, 380, 'PQ · 1152-d = 48 sub-vectors × 24-d  (12 shown)');
          var segW = 64, sx = 690;
          S.sub = [];
          var codes = [0x3a, 0xc1, 0x07, 0x9e, 0x52, 0xf0, 0x1b, 0x88, 0x6d, 0x24, 0xb7, 0x4f];
          for (var j = 0; j < 12; j++) {
            var sg = ctx.group({ parent: pq });
            ctx.rect(sx + j * segW, 405, segW - 4, 36, { rx: 4, fill: ctx.alpha('violet', 0.25), stroke: 'violet', sw: 1, parent: sg });
            ctx.text(sx + j * segW + (segW - 4) / 2, 423, 'x' + (j + 1), { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: sg });
            S.sub.push(sg);
          }
          ctx.text(sx, 460, 'k-means per sub-space → codebook C_j (256 centroids = 8 bits)', { size: 12, font: 'mono', color: 'dim', parent: pq });
          S.cb = ctx.matrix(700, 480, 16, 16, { cell: 9, gap: 1, cmap: 'violet', values: function (a2, b2) { return 0.15 + 0.5 * (((a2 * 7 + b2 * 3) % 11) / 11); }, parent: pq });
          ctx.text(780, 648, 'C_1 (16×16 = 256)', { size: 12, font: 'mono', color: 'violet', anchor: 'middle', parent: pq });
          S.cbSel = ctx.rect(700 + 10 * 10 - 2, 480 + 3 * 10 - 2, 13, 13, { rx: 2, stroke: 'amber', sw: 2, parent: pq });
          hide(pq);
          /* PQ: stored codes */
          var pc = ctx.group({ parent: g });
          S.codeB = codes.map(function (cv, j2) {
            var t = ctx.group({ parent: pc });
            ctx.rect(sx + j2 * segW, 680, segW - 4, 30, { rx: 4, fill: ctx.alpha('amber', 0.18), stroke: 'amber', sw: 1, parent: t });
            ctx.text(sx + j2 * segW + (segW - 4) / 2, 695, '0x' + (cv < 16 ? '0' : '') + cv.toString(16).toUpperCase(), { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: t });
            t.setAttribute('opacity', 0);
            return t;
          });
          ctx.text(sx, 728, 'stored code: 48 bytes (vs 2304 B fp16)', { size: 12, font: 'mono', color: 'amber', parent: pc });
          hide(pc);
          /* LUT */
          var lu = ctx.group({ parent: g });
          head(ctx, lu, 900, 488, 'ADC lookup table T[j][c]', 'amber');
          S.lut = ctx.matrix(900, 505, 12, 24, { cell: 11, gap: 1, cmap: 'heat', values: function (a2, b2) { return 0.1 + 0.8 * Math.abs(Math.sin(a2 * 1.7 + b2 * 0.9)); }, parent: lu });
          ctx.text(900, 660, '48 × 256 fp32 = 48 KB  (12 × 24 shown)', { size: 12, font: 'mono', color: 'dim', parent: lu });
          S.sumT = ctx.text(1200, 520, '', { size: 14, font: 'mono', color: 'amber', parent: lu });
          ctx.text(1200, 555, 'd̃(q,x) = Σ_j T[j][code_j]', { size: 14, font: 'mono', color: 'white', parent: lu });
          ctx.text(1200, 580, '48 adds, no 1152-d dot', { size: 12, font: 'mono', color: 'dim', parent: lu });
          hide(lu);

          /* beat 0: the size of the problem */
          ctx.hud('10⁹ × 1152-d fp16 = 2.3 TB · 2.3 TFLOP');
          return Promise.all([ctx.reveal(big, { from: 'up' }), ctx.reveal(mem, { from: 'up', delay: 300 })]).then(function () {
            return ctx.pulse(big, { color: 'red', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: IVF, scan only the nearest cells */
            ctx.hud('IVF: scan 3 of 9 cells · here 33% of the data');
            return ctx.reveal(iv, { from: 'up' }).then(function () { return ctx.wait(500); }).then(function () {
              ivH.textContent = 'IVF · scan only n_probe = 3 of 9 cells';
              probe.forEach(function (i) { halos[i].setAttribute('fill', ctx.alpha('magenta', 0.05)); halos[i].setAttribute('stroke', ctx.alpha('magenta', 0.6)); halos[i].setAttribute('stroke-width', 1.5); });
              return ctx.reveal(qs, { from: 'scale' });
            }).then(function () {
              return Promise.all(PT.map(function (p) { return p[1] ? Promise.resolve() : ctx.fade(p[0], 0.15, 600); }).concat([ctx.fade(halos.filter(function (h, i) { return probe.indexOf(i) < 0; }), 0.3, 600)]));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: product quantisation: split into sub-vectors, learn codebooks */
            ctx.hud('PQ: 48 sub-vectors × 256 centroids each');
            ctx.fadeOut(big, 300, true);
            return ctx.reveal(pq, { from: 'up' }).then(function () { return ctx.pulse(S.sub[0], { color: 'amber', dur: 500 }); }).then(function () {
              return ctx.pulse(S.cbSel, { color: 'amber', dur: 500 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the stored code is 48 bytes */
            ctx.hud('2304 B → 48 B per vector (48×)');
            return Promise.all([ctx.reveal(pc, { from: 'up' }), ctx.reveal(mem2, { from: 'left', delay: 300 })]).then(function () {
              return ctx.reveal(S.codeB, { stagger: 80, dur: 250 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: distances become lookups */
            ctx.hud('ADC = 48 lookups + 47 adds per code');
            var acc = 0;
            var chain = ctx.reveal(lu, { from: 'up' });
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach(function (j3) {
              chain = chain.then(function () {
                var c = (codes[j3] % 24);
                var cell = S.lut.cells[j3][c];
                cell.setAttribute('stroke', ctx.color('cyan')); cell.setAttribute('stroke-width', 2);
                cell.setAttribute('fill', ctx.color('white'));
                acc += 0.1 + 0.8 * Math.abs(Math.sin(j3 * 1.7 + c * 0.9));
                S.sumT.textContent = 'Σ (' + (j3 + 1) + '/12 shown) = ' + acc.toFixed(2);
                return ctx.wait(160);
              });
            });
            return chain;
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Hybrid + rerank',
        beats: [
          {
            say: 'Dense vectors understand meaning but blur exact identifiers. The character id FX dash zero seven, or a sketch file name, is better matched by classic BM25 keyword search, which ranks by exact term overlap.',
            card: { tag: 'KEY IDEA', title: 'Dense is fuzzy, sparse is exact', body: 'Embeddings match paraphrases but blur rare tokens like FX-07. BM25 does the opposite: exact terms, weighted by how rare they are.' },
            deep: '<p><b>BM25</b> (sparse, exact terms):</p>' +
              '<div class="eq">BM25(q,d) = Σ<sub>t∈q</sub> IDF(t) · f<sub>t,d</sub>(k<sub>1</sub>+1) / (f<sub>t,d</sub> + k<sub>1</sub>(1 − b + b·|d|/avgdl)), &nbsp; k<sub>1</sub>≈1.2, b≈0.75</div>' +
              '<p>A rare token such as <code>FX-07</code> has a large IDF, so a document containing it dominates the ranking; a dense model, which has never seen this id in training, maps it to a generic "character code" region. Term frequency saturates through k<sub>1</sub> and long documents are penalised through b.</p>'
          },
          {
            say: 'So the dense retriever and the keyword retriever run side by side, each returning its own top candidates, and they disagree about the order.',
            card: { tag: 'HOW IT WORKS', title: 'Two retrievers, two rankings', body: 'Dense finds the close-up and the visor crack by meaning; BM25 finds the FX-07 bible by its id. Some documents appear in both lists.' },
            deep: '<p>Both retrievers run in parallel and each returns ~100 candidates in production (five are shown). Their scores live on different scales: BM25 is unbounded and depends on corpus statistics, a cosine lies in [−1, 1]. They cannot simply be added, and normalising them is fragile because the distributions shift with every query.</p>' +
              '<p>Learned sparse models (SPLADE) blend the two worlds: a transformer expands the text into weighted vocabulary terms that an ordinary inverted index can serve.</p>'
          },
          {
            say: 'Reciprocal rank fusion merges the two lists using only ranks, never scores, which are not comparable across retrievers. Documents that both lists like float to the top.',
            card: { tag: 'NUMBERS', title: 'Agreement beats a lone first place', stat: { v: '0.0323', l: 'RRF score of fox_sheet_front, ranked second in both lists, against 0.0164 for a document ranked first in only one' } },
            deep: '<p><b>Reciprocal rank fusion</b>, rank-based so no score calibration is needed:</p>' +
              '<div class="eq">RRF(d) = Σ<sub>r∈{bm25, dense}</sub> 1 / (k + rank<sub>r</sub>(d)), &nbsp; k = 60</div>' +
              '<p>Here <code>fox_sheet_front</code> is #2 in both lists: 1/62 + 1/62 = 0.0323, beating items that are #1 in only one list (1/61 = 0.0164). The constant k = 60 flattens the curve so that the gap between ranks 1 and 2 matters little, while agreement across lists matters a lot; Cormack et al. found it robust across collections.</p>'
          },
          {
            say: 'Then a cross-encoder reads the query and each candidate together, which is slower but far more precise, and reorders the list.',
            card: { tag: 'TRADE-OFF', title: 'Precision costs a forward pass per pair', body: 'A cross-encoder runs full attention over query and candidate jointly. Nothing can be precomputed, so it only ever sees the top 20 to 50.',
              more: '<p>Rough numbers: a dot product costs 2 · 1152 ≈ 2.3 kFLOP. A 0.3B-parameter cross-encoder over 300 tokens costs about 2 · P · T = 2 · 3·10<sup>8</sup> · 300 ≈ 1.8·10<sup>11</sup> FLOP per pair, some 10<sup>8</sup> times more. That factor is the whole reason retrieval is a funnel: cheap scoring for millions, expensive scoring for dozens.</p>' },
            deep: '<p><b>Cross-encoder reranking</b>: a bi-encoder scores q·d with independently computed vectors; a cross-encoder runs full attention over [query; candidate] jointly (for images: a VLM-based reranker), capturing fine interactions ("cracked helmet" vs "helmet"). The price is one full transformer forward pass per (query, candidate) pair instead of one dot product against a pre-computed vector, so it only sees the top 20–50.</p>' +
              '<p>For 40 candidates of ~300 tokens a batched GPU pass takes ~20–80 ms, comparable to the whole first-stage retrieval.</p>'
          },
          {
            say: 'The top five go on to the context window and to the video model conditioning; the rest are cut. Late interaction models such as ColBERT and ColPali sit between the two extremes.',
            card: { tag: 'STATE OF THE ART', title: 'Late interaction in between', body: 'ColBERT-style multi-vector models score with token-level MaxSim: cheaper than a cross-encoder, sharper than one vector. ColPali applies it to page images.' },
            deep: '<div class="note">Alternatives: learned sparse (SPLADE) instead of BM25; late interaction (ColBERT / ColPali-style multi-vector) as a middle ground between bi- and cross-encoders.</div>' +
              '<div class="eq">s(q, d) = Σ<sub>i∈q</sub> max<sub>j∈d</sub> ⟨q<sub>i</sub>, d<sub>j</sub>⟩</div>' +
              '<p>MaxSim keeps one small vector per token (e.g. 128-d) or per image patch, so a document costs tens to hundreds of vectors of storage, but the interaction is computed from precomputed pieces with no transformer pass at query time.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [3, 4]);
          var DOC = { A: ['fox_sheet_front', 'amber'], B: ['fox_sheet_side', 'amber'], C: ['take2_kf4 close-up', 'lime'], D: ['sketch_2 visor crack', 'violet'],
            F: ['FX-07 bible (text)', 'teal'], G: ['take1_kf2 wide', 'lime'], H: ['style_guide_light', 'violet'] };
          var BM = ['F', 'A', 'B', 'H', 'D'], DN = ['C', 'A', 'D', 'B', 'G'];
          var sc = {};
          [BM, DN].forEach(function (L) { L.forEach(function (d, i) { sc[d] = (sc[d] || 0) + 1 / (60 + i + 1); }); });
          var FU = Object.keys(sc).sort(function (a, b) { return sc[b] - sc[a] || (a < b ? -1 : 1); });
          var RR = { A: 0.94, C: 0.91, D: 0.88, B: 0.83, F: 0.52, H: 0.31, G: 0.28 };
          var FIN = FU.slice().sort(function (a, b) { return RR[b] - RR[a]; });
          var qlab = ctx.label(800, 360, 'query: "FX-07 fox astronaut removes cracked helmet, close-up"', { color: 'magenta', size: 13, parent: g });
          var cols = [[80, 'BM25 (sparse)', BM, 'blue'], [430, 'Dense (ANN)', DN, 'violet']];
          var pos = {};
          function row(x, y, d, extra, col) {
            var rg = ctx.group({ parent: g });
            ctx.rect(x, y - 16, 290, 32, { rx: 6, fill: ctx.mix('#070d1a', DOC[d][1], 0.12), stroke: ctx.alpha(col || DOC[d][1], 0.6), sw: 1, parent: rg });
            ctx.text(x + 12, y, DOC[d][0], { size: 13, font: 'mono', color: DOC[d][1], parent: rg });
            if (extra !== undefined) rg.valT = ctx.text(x + 280, y, extra, { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: rg });
            return rg;
          }
          var colEls = [[], []];
          cols.forEach(function (c, ci) {
            colEls[ci].push(head(ctx, g, c[0], 410, c[1], c[3]));
            c[2].forEach(function (d, i) {
              var y = 450 + i * 44;
              colEls[ci].push(row(c[0], y, d, '#' + (i + 1), c[3]));
              pos[c[0] + d] = { x: c[0] + 290, y: y };
            });
          });
          var n1 = ctx.text(80, 700, 'BM25 wins on exact ids ("FX-07"); dense wins on meaning ("close-up", "cracked visor").', { size: 13, color: 'dim', parent: g });
          hide(qlab, colEls[0], colEls[1], n1);
          /* fused */
          var fh = head(ctx, g, 800, 410, 'RRF fused  (×10⁻³)', 'teal');
          var fusedRows = FU.map(function (d, i) {
            var rg = row(800, 450 + i * 44, d, (sc[d] * 1000).toFixed(1), 'teal');
            rg.setAttribute('opacity', 0);
            return rg;
          });
          var lines = ctx.group({ parent: g });
          g.insertBefore(lines, g.firstChild);
          FU.forEach(function (d, i) {
            [80, 430].forEach(function (x) {
              var p = pos[x + d];
              if (!p) return;
              var l = ctx.path('M' + p.x + ',' + p.y + ' C' + (p.x + 80) + ',' + p.y + ' ' + 720 + ',' + (450 + i * 44) + ' 800,' + (450 + i * 44), { stroke: ctx.alpha(x === 80 ? 'blue' : 'violet', 0.5), sw: 1.2, parent: lines });
              l.setAttribute('opacity', 0);
            });
          });
          var n2 = ctx.text(80, 724, 'RRF rewards agreement: #2 + #2 beats a single #1.', { size: 13, color: 'dim', parent: g });
          hide(fh, n2);
          /* rerank */
          var rh = head(ctx, g, 1180, 410, 'cross-encoder rerank', 'amber');
          var rrRows = FU.map(function (d, i) {
            var rg = row(1180, 450 + i * 44, d, RR[d].toFixed(2), 'amber');
            ctx.place(rg, 0, 0);
            rg.setAttribute('opacity', 0);
            return rg;
          });
          var topT = ctx.text(1180, 780, 'top-5 → context + video conditioning', { size: 12, font: 'mono', color: 'amber', parent: g });
          S.cut = ctx.line(1170, 450 + 4.5 * 44, 1480, 450 + 4.5 * 44, { color: 'amber', dash: '5 4', parent: g });
          hide(rh, topT, S.cut);

          /* beat 0: the keyword retriever */
          ctx.hud('BM25: exact terms, weighted by rarity');
          return ctx.reveal(qlab, { from: 'down' }).then(function () {
            return ctx.reveal(colEls[0], { from: 'left', stagger: 100, dur: 400 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the dense retriever disagrees */
            ctx.hud('dense: meaning · BM25: exact ids');
            return ctx.reveal(colEls[1], { from: 'left', stagger: 100, dur: 400 }).then(function () { return ctx.reveal(n1, { from: 'up' }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: reciprocal rank fusion */
            ctx.hud('RRF(d) = Σ 1/(60 + rank)');
            return ctx.reveal(Array.prototype.slice.call(lines.childNodes), { from: 'draw', stagger: 60, dur: 500 }).then(function () {
              return Promise.all([ctx.reveal(fh), ctx.reveal(fusedRows, { from: 'left', stagger: 110, dur: 350 })]);
            }).then(function () {
              ctx.reveal(n2, { from: 'up' });
              return ctx.pulse(fusedRows[0], { color: 'teal', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: cross-encoder rerank reorders the list */
            ctx.hud('cross-encoder: 40 → 8 · ~20–80 ms');
            return Promise.all([ctx.reveal(rh), ctx.reveal(rrRows, { from: 'left', stagger: 60, dur: 300 })]).then(function () {
              return Promise.all(FIN.map(function (d, k) {
                var i = FU.indexOf(d);
                return ctx.transform(rrRows[i], { y: (k - i) * 44 }, 900, 'inOut', 200);
              }));
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: cut to the top five */
            ctx.hud('keep top-5 → context + conditioning');
            FIN.forEach(function (d, k) { if (k >= 5) ctx.fade(rrRows[FU.indexOf(d)], 0.35, 300); });
            return Promise.all([ctx.reveal(S.cut, { dur: 300 }), ctx.reveal(topT, { from: 'up' })]);
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Agent memory types',
        beats: [
          {
            say: 'Retrieval is one part of a broader agent memory system. Working memory is the context window itself: small, fast, and wiped at the end of every run.',
            card: { tag: 'KEY IDEA', title: 'Working memory is the context', body: 'Everything the model can attend to right now: system prompt, tool schemas, plan, scratchpad and retrieved items. Here, 31k tokens.' },
            deep: '<p>The CoALA taxonomy (from cognitive science) maps cleanly onto an agent platform:</p>' +
              '<table><tr><th>Type</th><th>Content → store</th><th>Read path</th></tr>' +
              '<tr><td>Working</td><td>current plan, tool results, scratch → context window (KV cache)</td><td>attention</td></tr>' +
              '<tr><td>Episodic</td><td>past runs, failures, fixes → event log + run summaries (vector)</td><td>similarity + recency</td></tr>' +
              '<tr><td>Semantic</td><td>facts: character bible, style guide, prefs → docs + vector DB + KV</td><td>hybrid retrieval</td></tr>' +
              '<tr><td>Procedural</td><td>skills, prompt templates, tool recipes → skill files, tools, (fine-tuned) weights</td><td>routing / skill selection</td></tr></table>'
          },
          {
            say: 'Episodic memory records what happened in past runs, like the fact that shot three failed with helmet flicker and what fixed it.',
            card: { tag: 'HOW IT WORKS', title: 'Episodes: what happened, what worked', body: 'Run summaries in a vector store, retrieved by similarity and recency, so the agent does not repeat a mistake it has already solved.' },
            deep: '<p>Episodes are distilled from the event log: when a run ends, an LLM writes a short record of goal, actions, outcome and lesson, which is embedded and stored beside the raw events. Retrieval mixes similarity with recency (next step).</p>' +
              '<p>Example: <code>3a: flicker at cfg 7 → fixed with ref 0.8</code>. Three thousand tokens of such lessons are cheaper than re-discovering each one with a failed 95-second render.</p>'
          },
          {
            say: 'Semantic memory holds facts: the character bible, the style guide, the creator preferences. Character and style memory is semantic memory with images: the fox sheet and the sketch embeddings.',
            card: { tag: 'HOW IT WORKS', title: 'Semantic: facts and characters', body: 'Stable knowledge about this project: who the fox is, what the style is, what the creator likes. Text facts and reference images live side by side.' },
            deep: '<p><b>Character &amp; style memory</b> is semantic memory with images: the fox\'s character sheet, sketch embeddings, approved keyframes, and optionally a subject LoRA or identity embedding for the video model.</p>' +
              '<p>Facts are read through the hybrid retrieval pipeline of the previous steps, and they change rarely, so they cache well: a fact that is retrieved on every turn belongs in the stable prefix of the prompt.</p>'
          },
          {
            say: 'Procedural memory holds skills: prompt templates, tool recipes and playbooks, like the fix for flicker, lower guidance and raise reference strength.',
            card: { tag: 'HOW IT WORKS', title: 'Procedural: skills, not facts', body: 'How to do things: templates, playbooks and tool recipes. Kept as skill files loaded on demand, and sometimes baked into fine-tuned weights.' },
            deep: '<p>Procedural memory is <i>know-how</i>: skill files with a short description used for routing, prompt templates, tool schemas and, at the extreme, fine-tuned weights. Selection works by routing: the agent sees short descriptions and loads a skill body only when it is needed, which keeps the context budget free.</p>' +
              '<p>Example skill: <code>fix_flicker()</code> lowers guidance, raises reference strength and re-renders with a new seed.</p>'
          },
          {
            say: 'Each store is read only when relevant and evicted at the end of the turn. The context is the scarce resource: the agent pays for every token on every turn, and long contexts degrade recall of the middle.',
            card: { tag: 'NUMBERS', title: 'A 31k-token turn', stat: { v: '12k', u: 'tokens', l: 'of the 31k context come from memory: 2k skill, 3k episodes, 4k character references, 3k facts' },
              more: '<p>Order matters for cost. The system prompt and tool schemas (9k tokens here) are identical on every turn, so with prefix caching they are prefilled once and reused. Only the remaining 22k tokens, about 29% less than the full window, need fresh prefill. Retrieved items go <i>after</i> the stable prefix so they never invalidate the cache.</p>' },
            deep: '<p>Context budget is the scarce resource: the agent pays for every token on every turn (prefill), and very long contexts degrade recall of the middle. Prefill costs about 2·P·T FLOPs, so for a 70B-parameter model and T = 31k tokens that is ≈ 4·10<sup>15</sup> FLOP per turn unless the stable prefix is cached.</p>' +
              '<p>MemGPT-style systems treat the context as RAM and memory stores as disk, paging content in and out with explicit tool calls (<code>memory.search</code>, <code>memory.write</code>). Put stable material first so prefix caching serves it for free.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [5, 0]);
          /* working memory: the context window bar */
          var wm = ctx.group({ parent: g });
          ctx.text(452, 578, 'WORKING MEMORY', { size: 14, font: 'display', weight: 700, color: 'amber', spacing: 1, anchor: 'end', parent: wm });
          var wmP = ctx.para(452, 600, ['= context window of the', 'camera agent · 31k used'], { size: 12, font: 'mono', color: 'amber', lh: 18, anchor: 'end', parent: wm });
          var segs = [['sys', 3, 'dim'], ['tools', 6, 'blue'], ['skill', 2, 'orange'], ['episodes', 3, 'violet'], ['fox refs', 4, 'amber'], ['facts', 3, 'teal'], ['plan + scratch', 10, 'magenta']];
          var MEMSEG = { skill: 1, episodes: 1, 'fox refs': 1, facts: 1 };
          var x0 = 470, sc = 660 / 31, segEl = {};
          segs.forEach(function (s) {
            var w = s[1] * sc;
            var rect = ctx.rect(x0, 572, w - 3, 56, { rx: 4, fill: ctx.alpha(s[2], 0.3), stroke: s[2], sw: 1.2, parent: wm });
            var t1 = ctx.text(x0 + (w - 3) / 2, 590, s[0], { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: wm });
            var t2 = ctx.text(x0 + (w - 3) / 2, 610, s[1] + 'k', { size: 11, font: 'mono', color: s[2], anchor: 'middle', parent: wm });
            segEl[s[0]] = { x: x0 + w / 2, el: rect, txt: [t1, t2] };
            if (MEMSEG[s[0]]) { rect.setAttribute('opacity', 0.2); hide(t1, t2); }
            x0 += w;
          });
          hide(wm);
          /* the memory stores around it */
          var M = [
            ['Episodic', 'past runs · event log + summaries', 'violet', 250, 430, 'episodes', '"3a: flicker at cfg 7 → fixed w/ ref 0.8"'],
            ['Semantic', 'facts · character bible · prefs', 'teal', 1350, 430, 'facts', '"FX-07: orange fur, white chest, left-ear scar"'],
            ['Procedural', 'skills · playbooks · tool recipes', 'orange', 250, 780, 'skill', 'skill fix_flicker(): lower cfg, raise ref'],
            ['Character & style', 'sheet + sketch embeddings', 'amber', 1350, 780, 'fox refs', 'fox_sheet_front.png · e ∈ ℝ¹¹⁵²']
          ];
          var MS = M.map(function (m) {
            var n = ctx.node({ x: m[3], y: m[4], w: 330, h: 64, title: m[0], sub: m[1], color: m[2], titleSize: 16, subSize: 12, parent: g });
            var top = m[4] < 600;
            var ex = ctx.text(m[3], top ? m[4] + 52 : m[4] - 52, m[6], { size: 12, font: 'mono', color: m[2], anchor: 'middle', parent: g });
            var tgt = segEl[m[5]];
            var l = ctx.link(n, { x: tgt.x, y: top ? 572 : 628 }, { from: m[3] < 800 ? 'r' : 'l', to: top ? 't' : 'b', color: ctx.alpha(m[2], 0.7), parent: g });
            hide(n, ex, l);
            return { node: n, ex: ex, link: l, seg: tgt, color: m[2] };
          });
          var foot = ctx.text(800, 862, 'loaded on demand · evicted at the end of the turn · everything else lives outside the context', { size: 13, color: 'dim', anchor: 'middle', parent: g });
          hide(foot);
          function bring(i) {
            var m = MS[i];
            return Promise.all([ctx.reveal(m.node, { from: i < 2 ? 'down' : 'up' }), ctx.reveal(m.ex, { delay: 200 })]).then(function () {
              return ctx.reveal(m.link, { from: 'draw', dur: 500 });
            }).then(function () {
              return ctx.packet(m.link, { color: m.color, dur: 800 });
            }).then(function () {
              return Promise.all([ctx.fade(m.seg.el, 1, 400), ctx.reveal(m.seg.txt, { dur: 300 })]);
            }).then(function () { return ctx.pulse(m.seg.el, { color: m.color, dur: 600 }); });
          }

          /* beat 0: working memory is the context window */
          ctx.hud('working memory = the context window');
          return ctx.reveal(wm, { from: 'up' }).then(function () {
            return ctx.pulse(S.stg[5], { color: 'amber', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: episodic memory */
            ctx.hud('episodic: what happened in past runs');
            return bring(0);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: semantic memory and character / style memory */
            ctx.hud('semantic: facts, characters, style');
            return Promise.all([bring(1), ctx.wait(400).then(function () { return bring(3); })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: procedural memory */
            ctx.hud('procedural: skills and playbooks');
            return bring(2);
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the context budget */
            ctx.hud('31k tokens in context · 12k from memory');
            wmP.childNodes[1].textContent = '31k used · 12k from memory';
            return ctx.reveal(foot, { from: 'up' }).then(function () {
              return ['skill', 'episodes', 'fox refs', 'facts'].reduce(function (p, k) {
                return p.then(function () { return ctx.pulse(segEl[k].el, { color: 'amber', dur: 450 }); });
              }, Promise.resolve());
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 9 */
      {
        title: 'Consistency loop',
        beats: [
          {
            say: 'Here is memory at work across the whole trailer. For every shot, the agent retrieves the fox sheet and sketch embeddings, then renders with them as reference conditioning.',
            card: { tag: 'KEY IDEA', title: 'Retrieve, render, judge, write back', body: 'A four-step loop per shot: retrieve references, render with them, let a critic score identity, write approved keyframes back to memory.' },
            deep: '<p><b>Per-shot loop</b> (character consistency):</p>' +
              '<pre>for shot in plan.shots:\n  refs = mem.retrieve(\n      shot.prompt, k=8,\n      kind=["char","sketch","kf"])\n  take = render(shot, refs.images,\n                ref_strength=0.8)\n  s = cos(E_id(take.kf),\n          E_id(refs.char))\n  if s &gt;= tau:\n    mem.write(take.kf,\n              importance=critic)\n  else:\n    retry(shot, seed=new,\n          ref_strength=+0.1)</pre>' +
              '<p>Three of the four steps are ordinary tool calls; the interesting one is the gate <code>s &gt;= tau</code>, which turns identity from a hope into a checked invariant.</p>'
          },
          {
            say: 'The critic measures identity similarity between the new keyframes and the character sheet. Approved keyframes are written back, so later shots can match them too; failures are rejected and re-rendered.',
            card: { tag: 'NUMBERS', title: 'The identity gate', stat: { v: '0.75', l: 'illustrative cosine threshold τ between the new keyframe and the character sheet; below it, the shot is re-rendered' } },
            deep: '<p>E<sub>id</sub> can be a SigLIP/DINOv2 embedding of a character crop or a dedicated re-ID model; τ is calibrated on human judgements (illustrative τ = 0.75 below). A pure similarity threshold is easy to fool with a lookalike, so the critic also asks binary, checkable questions (is the visor teal, is the patch visible?) through a VLM.</p>' +
              '<p>On rejection the retry raises the reference strength by 0.1 and changes the seed, both recorded in the lineage graph.</p>'
          },
          {
            say: 'Without retrieval the fox drifts shot by shot. In this illustration, identity similarity falls from point eight four to point five eight over six shots, while with retrieval it stays near point eight five.',
            card: { tag: 'NUMBERS', title: 'Drift without memory', stat: { v: '0.84 → 0.58', l: 'identity similarity, shot 1 to shot 6, without memory (illustrative); with retrieval it holds near 0.85' } },
            deep: '<p>Why drift compounds: each text-only shot is an independent sample, and even conditioning on the previous shot lets small errors accumulate like a random walk. Retrieval anchors every shot to the same sheet, so errors are re-centred on the reference each time instead of adding up.</p>' +
              '<p>The chart is illustrative, but it is measured in the same way a real evaluation would be: an identity embedding of the character crop in every shot, compared with the reference sheet.</p>'
          },
          {
            say: 'Memory also needs hygiene. Score items by recency, importance and relevance, merge near duplicates, summarise old episodes, and let stale items decay.',
            card: { tag: 'HOW IT WORKS', title: 'Score, merge, summarise, forget', body: 'Retrieval score mixes recency, importance and relevance. Duplicates are merged, finished runs summarised, and stale items decay or expire.',
              more: '<p>In Generative Agents (Park et al., 2023) recency is an exponential decay of 0.995 per hour, importance is a 1–10 rating produced by the language model when the memory is written, and relevance is the embedding cosine with the query. Each term is min-max normalised to [0, 1] and the three are summed with equal weights.</p>' },
            deep: '<p><b>Retrieval score</b> (Generative Agents):</p>' +
              '<div class="eq">score = α·recency + β·importance + γ·relevance, &nbsp; recency = 0.995<sup>Δt[h]</sup></div>' +
              '<ul><li><b>Write</b> selectively: approved takes and critic lessons, not every intermediate.</li>' +
              '<li><b>Merge</b> near-duplicates (cos &gt; 0.95) to avoid crowding top-k with the same keyframe.</li>' +
              '<li><b>Summarise</b>: compress a finished run\'s events into one episodic summary; keep raw events in the log.</li>' +
              '<li><b>Forget</b>: TTLs, decay, and hard deletion through lineage when a user withdraws an upload.</li></ul>' +
              '<p>With decay 0.995 per hour the half-life is ln 0.5 / ln 0.995 ≈ 138 h ≈ 5.8 days.</p>'
          },
          {
            say: 'One last rule: memory is an injection surface. Retrieved text is data, never instructions, and every write is scoped to the tenant and tagged with its provenance.',
            card: { tag: 'PITFALL', title: 'Memory is an injection surface', body: 'A poisoned note written once can steer every later run. Treat retrieved text as untrusted data, scope writes per tenant and tag provenance.' },
            deep: '<div class="note">Security: memory is an injection surface. Retrieved text is data, never instructions; writes are tenant-scoped and provenance-tagged.</div>' +
              '<p>This is indirect prompt injection with persistence: an instruction hidden in an uploaded sketch caption, once summarised into an episode, comes back on every retrieval. Defences stack: strip and label retrieved content as data in the prompt, keep the tool-calling privileges of the agent independent of what memory says, write only after critic approval, and record who wrote each item so a bad write can be found and revoked through lineage.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, null);
          /* loop */
          var lh = head(ctx, g, 60, 380, 'PER-SHOT CONSISTENCY LOOP');
          var LN = [['retrieve refs', 'fox sheet + sketches', 'teal', 210, 470, 'search'], ['render shot i', 'ref-image conditioning', 'lime', 590, 470, 'film'],
            ['critic', 'identity sim s = cos', 'pink', 590, 700, 'eye'], ['write back', 'approved keyframes', 'amber', 210, 700, 'db']];
          var LNn = LN.map(function (d) { return ctx.node({ x: d[3], y: d[4], w: 250, h: 64, title: d[0], sub: d[1], icon: d[5], color: d[2], titleSize: 15, subSize: 12, parent: g }); });
          var ll = [];
          for (var i = 0; i < 4; i++) ll.push(ctx.link(LNn[i], LNn[(i + 1) % 4], { color: ctx.alpha(LN[i][2], 0.8), parent: g }));
          var rej = ctx.link(LNn[2], LNn[1], { from: 'r', to: 'r', bend: { x: 800, y: 585 }, color: ctx.alpha('red', 0.8), dash: '5 4', parent: g, label: 's < τ: re-render', labelDx: 44, labelDy: 0 });
          rej.labelEl.querySelector('text').setAttribute('fill', ctx.color('white'));
          var forT = ctx.text(400, 585, 'for shot in 1..6', { size: 14, font: 'mono', color: 'white', anchor: 'middle', parent: g });
          var tail = ctx.text(60, 800, 'every approved shot makes the next retrieval better', { size: 13, color: 'dim', parent: g });
          hide(lh, LNn, ll, rej, rej.labelEl, forT, tail);
          /* chart */
          var chg = ctx.group({ parent: g });
          head(ctx, chg, 900, 380, 'IDENTITY SIMILARITY PER SHOT (illustrative)');
          var WM = [0.85, 0.84, 0.86, 0.83, 0.85, 0.84], NM = [0.84, 0.77, 0.70, 0.66, 0.61, 0.58];
          var cx0 = 940, cy0 = 410, ch = 180, bw = 34;
          var yv = function (v) { return cy0 + ch - (v - 0.4) / 0.6 * ch; };
          ctx.line(cx0, cy0 + ch, cx0 + 560, cy0 + ch, { color: 'faint', parent: chg });
          [0.4, 0.6, 0.8, 1.0].forEach(function (v) { ctx.text(cx0 - 8, yv(v), v.toFixed(1), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: chg }); });
          var bars = [];
          WM.forEach(function (v, k) {
            var x = cx0 + 20 + k * 90;
            var b1 = ctx.rect(x, yv(NM[k]), bw, cy0 + ch - yv(NM[k]), { rx: 3, fill: ctx.alpha('red', 0.45), stroke: 'red', sw: 1, parent: chg });
            var b2 = ctx.rect(x + bw + 4, yv(v), bw, cy0 + ch - yv(v), { rx: 3, fill: ctx.alpha('teal', 0.55), stroke: 'teal', sw: 1, parent: chg });
            ctx.text(x + bw + 2, cy0 + ch + 16, 'shot ' + (k + 1), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: chg });
            bars.push([b1, NM[k]], [b2, v]);
          });
          ctx.line(cx0, yv(0.75), cx0 + 560, yv(0.75), { color: 'amber', dash: '6 4', sw: 1.5, parent: chg });
          ctx.label(1230, 420, 'τ = 0.75', { color: 'amber', size: 11, anchor: 'start', parent: chg });
          ctx.label(1330, 420, 'no memory', { color: 'red', size: 11, anchor: 'start', parent: chg });
          ctx.label(1430, 420, 'retrieval', { color: 'teal', size: 11, anchor: 'start', parent: chg });
          bars.forEach(function (b) {
            var h = parseFloat(b[0].getAttribute('height')), y = parseFloat(b[0].getAttribute('y'));
            b[0].setAttribute('height', 0); b[0].setAttribute('y', y + h);
            b[0]._h = h; b[0]._y = y;
          });
          hide(chg);
          /* lifecycle */
          var lc = ctx.group({ parent: g });
          head(ctx, lc, 900, 648, 'MEMORY LIFECYCLE');
          ctx.para(900, 676, ['score = α·recency + β·importance', '        + γ·relevance', 'recency = 0.995^Δt[h]', 'merge dupes: cos > 0.95', 'summarise runs → episodes', 'forget: TTL + lineage delete'], { size: 13, font: 'code', color: 'text', lh: 22, parent: lc });
          var dp = ctx.plot(1250, 670, 270, 130, function (h) { return Math.pow(0.995, h); }, { xDomain: [0, 720], yDomain: [0, 1], color: 'teal', parent: lc });
          ctx.text(1250, 818, '0', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: lc });
          ctx.text(1520, 818, '30 days', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: lc });
          ctx.text(1256, 662, 'recency', { size: 11, font: 'mono', color: 'dim', parent: lc });
          var p1d = dp.toPx(139, 0.5);
          ctx.circle(p1d.x, p1d.y, 4, { fill: 'amber', parent: lc });
          ctx.text(p1d.x + 8, p1d.y - 10, 'half-life ≈ 5.8 d', { size: 11, font: 'mono', color: 'amber', parent: lc });
          hide(lc);
          /* injection hygiene */
          var sec = ctx.group({ parent: g });
          ctx.label(60, 845, 'retrieved text = data, never instructions', { color: 'pink', size: 12, anchor: 'start', parent: sec });
          ctx.label(450, 845, 'writes: tenant-scoped · provenance-tagged', { color: 'pink', size: 12, anchor: 'start', parent: sec });
          hide(sec);

          /* beat 0: retrieve, then render */
          ctx.hud('per shot: retrieve → render → judge → write');
          return ctx.reveal(lh).then(function () {
            return Promise.all([ctx.reveal(LNn[0], { from: 'left' }), ctx.reveal(LNn[1], { from: 'right', delay: 200 }), ctx.reveal(forT, { delay: 400 })]);
          }).then(function () {
            return ctx.reveal(ll[0], { from: 'draw', dur: 500 });
          }).then(function () { return ctx.packet(ll[0], { color: 'teal', dur: 500 }); }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the critic gates, approved keyframes flow back */
            ctx.hud('identity gate: s ≥ τ = 0.75 or re-render');
            return Promise.all([ctx.reveal(LNn[2], { from: 'up' }), ctx.reveal(LNn[3], { from: 'up', delay: 200 })]).then(function () {
              return Promise.all([ctx.reveal(ll[1], { from: 'draw', dur: 500 }), ctx.reveal(ll[2], { from: 'draw', dur: 500, delay: 200 }), ctx.reveal(ll[3], { from: 'draw', dur: 500, delay: 400 })]);
            }).then(function () {
              return Promise.all([ctx.reveal(rej, { from: 'draw', dur: 600 }), ctx.reveal(rej.labelEl, { delay: 300 }), ctx.reveal(tail, { from: 'up', delay: 300 })]);
            }).then(function () { return ctx.packet(rej, { color: 'red', dur: 700 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: with retrieval the fox stays put, without it the fox drifts */
            ctx.hud('identity sim: 0.85 with memory · 0.58 without');
            var chain = ctx.reveal(chg, { from: 'up', dur: 500 }).then(function () { return ctx.wait(300); });
            for (var s = 0; s < 6; s++) {
              (function (k) {
                chain = chain.then(function () {
                  var p = ll.map(function (l, i2) { return ctx.packet(l, { color: LN[i2][2], dur: 220 }); });
                  var b1 = bars[2 * k][0], b2 = bars[2 * k + 1][0];
                  ctx.animate(b1, { height: [0, b1._h], y: [b1._y + b1._h, b1._y] }, 400, 'out');
                  ctx.animate(b2, { height: [0, b2._h], y: [b2._y + b2._h, b2._y] }, 400, 'out');
                  return Promise.all(p.concat([ctx.wait(420)]));
                });
              })(s);
            }
            return chain;
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: memory hygiene */
            ctx.hud('recency · importance · relevance · decay');
            return Promise.all([ctx.reveal(lc, { from: 'up' })]).then(function () { return ctx.reveal(dp.curve, { from: 'draw', dur: 900 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: injection hygiene on the write path */
            ctx.hud('memory = untrusted input: data, not commands');
            return ctx.reveal(sec, { from: 'up' }).then(function () { return ctx.pulse(LNn[3], { color: 'pink', times: 2, dur: 600 }); });
          });
        }
      }
    ]
  });
})();
