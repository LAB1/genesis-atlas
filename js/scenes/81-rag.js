/* L2 — Vector Memory & Retrieval. A retrieval pipeline "map" stays on top; each step drills into one stage:
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
      'Zhai et al., <i>Sigmoid Loss for Language Image Pre-Training</i> (SigLIP), ICCV 2023; Tschannen et al., <i>SigLIP 2</i>, 2025',
      'Park et al., <i>Generative Agents: Interactive Simulacra of Human Behavior</i>, UIST 2023; Packer et al., <i>MemGPT</i>, 2023',
      'Sumers et al., <i>Cognitive Architectures for Language Agents</i> (CoALA), TMLR 2024'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Memory for continuity',
        say: 'A video model has no memory between shots. If shot four is generated from text alone, the fox will come back with a different face, a different suit, maybe a different number of ears. So before every shot the camera agent asks memory a question. The query is embedded, searched in an approximate nearest neighbour index, fused with keyword search, reranked, and the winners, the fox character sheet, a style sketch and the best earlier keyframe, land in the context window and in the video model conditioning.',
        deep: '<p>Retrieval-augmented generation for a video agent is a <b>pipeline of increasingly expensive, increasingly precise filters</b>:</p>' +
          '<table><tr><th>Stage</th><th>Candidates</th><th>Cost / query</th></tr>' +
          '<tr><td>Embed query (text tower)</td><td>1</td><td>~5 ms GPU, batched</td></tr>' +
          '<tr><td>ANN index (HNSW / IVF-PQ)</td><td>10<sup>4</sup>–10<sup>9</sup> → 100</td><td>~1–10 ms</td></tr>' +
          '<tr><td>Hybrid fusion (BM25 + dense, RRF)</td><td>2 × 100 → 40</td><td>&lt;1 ms</td></tr>' +
          '<tr><td>Cross-encoder rerank</td><td>40 → 8</td><td>~20–80 ms GPU</td></tr></table>' +
          '<p>The result is used twice: as <b>context</b> for the LLM agent (images + the character "bible" text), and as <b>conditioning</b> for the video model (reference images for identity and style).</p>' +
          '<div class="note">Retrieval is filtered by tenant and project <i>before</i> similarity: memory isolation is a security property, not a ranking feature.</div>' +
          '<p>Why not just stuff every sketch into context? Each image costs ~10<sup>2</sup>–10<sup>3</sup> tokens (depending on resolution and the VLM\'s patching), a project accumulates hundreds of keyframes, and long contexts dilute attention (lost-in-the-middle). Retrieval keeps the working set small and relevant.</p>',
        run: function (ctx) {
          var S = ctx.state;
          S.stg = STG.map(function (d, i) {
            return ctx.node({ x: PX[i], y: PY, w: 200, h: 64, title: d[0], sub: d[1], icon: d[2], color: d[3], titleSize: 15, subSize: 12 });
          });
          S.pg = ctx.group();
          S.pl = [];
          for (var i = 0; i < 5; i++) S.pl.push(ctx.link(S.stg[i], S.stg[i + 1], { straight: true, color: ctx.alpha('teal', 0.7), parent: S.pg }));
          ctx.reveal(S.stg, { from: 'down', stagger: 110 });
          ctx.reveal(S.pl, { from: 'draw', delay: 500, stagger: 110 });
          var g = view(ctx, S, null);
          code(ctx, { x: 60, y: 400, w: 650, title: 'camera agent → memory.retrieve()', lang: 'py', size: 13, parent: g, lines: [
            'refs = memory.retrieve(',
            '    query="FX-07 fox astronaut removes cracked helmet, close-up",',
            '    modalities=["image", "text"],',
            '    filter={"project": "p42", "kind": ["char_sheet", "sketch", "kf"]},',
            '    k=8, rerank=True)          # p50 ≈ 40 ms end-to-end'
          ] });
          ctx.para(60, 596, ['Without memory: every shot re-invents the fox.', 'With memory: every shot is conditioned on the same', 'character sheet, sketches and approved keyframes.'], { size: 14, color: 'text', lh: 22, parent: g });
          /* result cards */
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
          ctx.text(770, 624, 'top-5 after rerank (of 8 returned)', { size: 12, font: 'mono', color: 'dim', parent: g });
          /* context window bar */
          head(ctx, g, 60, 680, 'CONTEXT WINDOW OF THE CAMERA AGENT (tokens)', 'amber');
          var segs = [['system prompt', 3, 'dim'], ['tool schemas', 6, 'blue'], ['retrieved: 2 images + FX-07 bible', 5, 'teal'], ['shot plan', 2, 'magenta'], ['scratchpad', 8, 'amber']];
          var x0 = 60, sc = 1480 / 24;
          S.ctxSeg = null;
          segs.forEach(function (s) {
            var w = s[1] * sc;
            var r = ctx.rect(x0, 700, w - 4, 52, { rx: 5, fill: ctx.alpha(s[2], s[2] === 'teal' ? 0.35 : 0.14), stroke: ctx.alpha(s[2], 0.8), sw: s[2] === 'teal' ? 2 : 1, parent: g });
            ctx.text(x0 + 10, 718, s[0], { size: 13, color: 'white', parent: g });
            ctx.text(x0 + 10, 738, s[1] + 'k', { size: 12, font: 'mono', color: s[2], parent: g });
            if (s[2] === 'teal') S.ctxSeg = r;
            x0 += w;
          });
          ctx.text(60, 790, 'The same references also go to the video model as reference-image conditioning (identity + style).', { size: 13, color: 'dim', parent: g });
          ctx.reveal(g, { from: 'up', delay: 700 });
          ctx.hud('retrieve: embed → ANN → fuse → rerank → context');
          var labs = ['query', 'q ∈ ℝ¹¹⁵²', 'top-100', 'top-40', 'top-8'];
          return ctx.wait(1300).then(function () {
            return S.pl.reduce(function (p, l, i) {
              return p.then(function () { return ctx.packet(l, { color: 'teal', dur: 450, label: labs[i] }); });
            }, Promise.resolve());
          }).then(function () {
            return ctx.reveal(S.cards, { from: 'up', stagger: 120, dur: 450 });
          }).then(function () {
            return ctx.pulse(S.ctxSeg, { color: 'teal', times: 2, dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Shared embeddings',
        say: 'Everything starts with embeddings. A SigLIP style dual encoder maps images and text into the same space, trained so that matching pairs point in the same direction. Vectors are normalised to unit length, so similarity is just a dot product: the cosine of the angle between them. The fox character sheet and the words orange fox astronaut land a small angle apart, while the ice moon backdrop points elsewhere. Every sketch, keyframe and script beat of the project becomes one of these arrows.',
        deep: '<p><b>Dual encoder</b>: image tower f (ViT, e.g. so400m/14 at 384 px → 729 patch tokens → attention-pooling head) and text tower g, each followed by a projection into a shared d-dimensional space (SigLIP 2 so400m: d = 1152; CLIP ViT-L/14: 768).</p>' +
          '<div class="eq">ẑ = z / ‖z‖, &nbsp; s(i, t) = ẑ<sub>i</sub> · ẑ<sub>t</sub> = cos θ</div>' +
          '<p>SigLIP trains with a pairwise <b>sigmoid</b> loss instead of CLIP\'s batch softmax:</p>' +
          '<div class="eq">L = −(1/|B|) Σ<sub>i,j</sub> log σ( y<sub>ij</sub> (τ · ẑ<sub>i</sub>·ẑ<sub>j</sub> + b) ), &nbsp; y<sub>ij</sub> = ±1</div>' +
          '<p>so every (image, text) pair is an independent binary decision with no batch-wide softmax normaliser: the loss can be computed chunk by chunk across devices without materialising the full |B|×|B| matrix. τ and b are learned (init τ = 10, b = −10) to offset the 1 : |B|−1 positive/negative imbalance.</p>' +
          '<p><b>Modality gap</b>: raw image–text cosines are small (≈0.1–0.35 even for true matches); the canvas matrix is rescaled for display. Only the ranking matters, and thresholds are calibrated per embedder.</p>' +
          '<ul><li><b>Video</b>: embed ~8 keyframes per take (scene-cut aware) and store both per-frame and a mean-pooled clip vector.</li>' +
          '<li><b>Text memory</b> (script beats, critic notes) uses a dedicated text embedder (e.g. Qwen3-Embedding, gte) with Matryoshka dims: truncate 4096 → 1024 → 256 with a small recall cost.</li>' +
          '<li><b>Versioning</b>: embeddings from different models are not comparable; the index is keyed by embedder version and re-built on upgrade.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [1]);
          ctx.hud('unit vectors ⇒ cosine similarity = dot product');
          /* dual encoder */
          var a = ctx.group({ parent: g });
          head(ctx, a, 60, 380, 'DUAL ENCODER → ONE SPACE', 'violet');
          var th = ctx.group({ parent: a });
          ctx.rect(60, 405, 110, 84, { rx: 6, fill: ctx.alpha('orange', 0.08), stroke: 'orange', sw: 1.2, parent: th });
          fox(ctx, th, 115, 452, 0.95, 'orange', false);
          var patches = ctx.matrix(200, 407, 5, 5, { cell: 14, gap: 2, cmap: 'violet', values: function (r, c) { return 0.2 + 0.6 * ((r * 5 + c) % 7) / 7; }, parent: a });
          ctx.text(240, 504, '729 patches', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: a });
          var vit = ctx.node({ x: 390, y: 447, w: 150, h: 56, title: 'ViT so400m', sub: '+ MAP pool', color: 'violet', titleSize: 14, parent: a });
          var tx = ctx.label(115, 575, '"orange fox astronaut"', { color: 'magenta', size: 12, parent: a });
          var tt = ctx.node({ x: 390, y: 575, w: 150, h: 56, title: 'Text tower', sub: 'transformer', color: 'violet', titleSize: 14, parent: a });
          var r = ctx.rng(3);
          var vi = ctx.vector(500, 441, 12, { horizontal: true, cell: 10, gap: 2, cmap: 'diverge', parent: a, values: [Array.apply(null, Array(12)).map(function () { return r() * 2 - 1; })] });
          var vt = ctx.vector(500, 569, 12, { horizontal: true, cell: 10, gap: 2, cmap: 'diverge', parent: a, values: [Array.apply(null, Array(12)).map(function () { return r() * 2 - 1; })] });
          ctx.text(500, 470, 'ẑ_img  (1152-d)', { size: 12, font: 'mono', color: 'orange', parent: a });
          ctx.text(500, 598, 'ẑ_txt  (1152-d)', { size: 12, font: 'mono', color: 'magenta', parent: a });
          var l1 = ctx.link({ x: 282, y: 447 }, vit, { to: 'l', straight: true, color: 'violet', parent: a });
          var l2 = ctx.link({ x: 200 + 5, y: 575 }, tt, { to: 'l', straight: true, color: 'violet', parent: a });
          ctx.reveal(a, { from: 'up' });
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
          ctx.reveal(u, { from: 'fade', delay: 300 });
          /* similarity matrix */
          var m = ctx.group({ parent: g });
          head(ctx, m, 800, 380, 'SIMILARITY  ẑ_img · ẑ_txt  (illustrative, rescaled to 0–1)', 'violet');
          var imgs = ['fox_sheet', 'sketch_2', 'take2_kf4', 'moon_env'], txts = ['"orange fox astronaut"', '"ink sketch, teal rim light"', '"fox kneels by pod, close-up"', '"glowing ice moon surface"'];
          var SIM = [[0.82, 0.41, 0.66, 0.12], [0.35, 0.78, 0.30, 0.38], [0.61, 0.28, 0.80, 0.22], [0.08, 0.33, 0.25, 0.85]];
          S.sm = ctx.matrix(1170, 430, 4, 4, { cell: 72, gap: 4, cmap: 'violet', values: function () { return 0.05; }, parent: m });
          txts.forEach(function (s, i) { ctx.text(1158, 466 + i * 76, s, { size: 13, font: 'mono', color: 'magenta', anchor: 'end', parent: m }); });
          imgs.forEach(function (s, j) { ctx.text(1206 + j * 76, 750, s, { size: 12, font: 'mono', color: 'orange', anchor: 'middle', parent: m }); });
          S.smT = [];
          for (var i2 = 0; i2 < 4; i2++) for (var j = 0; j < 4; j++) {
            var cc = S.sm.cellCenter(i2, j);
            var t = ctx.text(cc.x, cc.y, SIM[i2][j].toFixed(2), { size: 14, font: 'mono', weight: 600, color: SIM[i2][j] > 0.6 ? '#05080f' : 'text', anchor: 'middle', parent: m });
            t.setAttribute('opacity', 0);
            S.smT.push(t);
          }
          ctx.text(800, 790, 'SigLIP: σ(τ·ẑ_i·ẑ_t + b) per pair → the diagonal is pushed up, off-diagonals down', { size: 13, font: 'mono', color: 'dim', parent: m });
          ctx.reveal(m, { from: 'up', delay: 200 });
          var ang = [38, 52, 148];
          return ctx.wait(500).then(function () {
            return Promise.all([ctx.packet(l1, { color: 'orange', dur: 500 }), ctx.packet(l2, { color: 'magenta', dur: 500 })]);
          }).then(function () {
            return Promise.all(S.arrows.map(function (ag, k) { return ctx.transform(ag, { r: -ang[k] }, 900, 'out', k * 150); }));
          }).then(function () {
            return ctx.tween(1100, function (e) {
              S.sm.set(function (a2, b2) { return 0.05 + (SIM[a2][b2] - 0.05) * e; });
            });
          }).then(function () { return ctx.reveal(S.smT, { stagger: 30, dur: 250 }); });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'HNSW: the graph',
        say: 'Comparing the query against every vector is fine for a few thousand items, but a platform library holds billions. HNSW builds a navigable small world graph in layers. Every vector lives in the bottom layer. With M equal to four, as drawn here, a random quarter of them are promoted to the next layer, a sixteenth to the one above, like a skip list. Upper layers are sparse highways with long links; the bottom layer is dense with short local links. Each node keeps only a handful of neighbours.',
        deep: '<p>Each inserted element draws a level from an exponential distribution:</p>' +
          '<div class="eq">ℓ = ⌊ −ln(U) · m<sub>L</sub> ⌋, &nbsp; U ~ Unif(0,1), &nbsp; m<sub>L</sub> = 1/ln M &nbsp;⇒&nbsp; P(ℓ ≥ l) = M<sup>−l</sup></div>' +
          '<p>so the number of layers grows as O(log<sub>M</sub> N). Insertion = search for the new point (with beam width <code>efConstruction</code>, typically 100–400), then connect it to up to <b>M</b> neighbours per layer (2M at layer 0), chosen by a diversity heuristic: keep candidate c only if it is closer to the new node than to any already-selected neighbour. This keeps long-range links and makes the graph navigable.</p>' +
          '<table><tr><th>Param</th><th>Typical</th><th>Effect</th></tr>' +
          '<tr><td>M</td><td>16–64</td><td>recall ↑, memory ↑ (≈ 2M·4 B per node at L0)</td></tr>' +
          '<tr><td>efConstruction</td><td>100–400</td><td>graph quality ↑, build time ↑</td></tr>' +
          '<tr><td>efSearch</td><td>32–512</td><td>recall ↑, latency ↑ (query-time knob)</td></tr></table>' +
          '<p>Drawn here: 40 nodes, M = 4 level statistics, and 2–3 links per node for legibility. Search cost is roughly O(log N) hops × M distance evaluations; each evaluation is a 1152-d dot product (~2.3 kFLOP).</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [2]);
          ctx.hud('P(level ≥ l) = M^−l · layers ≈ log_M N');
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
          S.dot = [[], [], []];
          H.nodes.forEach(function (n, i) {
            for (var L = 0; L <= n.lv; L++) {
              var p = proj(n.u, n.v, L);
              S.dot[L][i] = ctx.circle(p.x, p.y, L === 0 ? 5 : 6.5, { fill: ctx.alpha(L === 0 ? 'teal' : (L === 1 ? 'cyan' : 'white'), 0.85), stroke: '#05080f', sw: 1, parent: dots });
              if (L > 0) {
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
          });
          /* side panel */
          var side = ctx.group({ parent: g });
          S.side = side;
          head(ctx, side, 1340, 400, 'SKIP-LIST LEVELS');
          ctx.para(1340, 430, ['m_L = 1 / ln M', 'M = 4 here', '', 'P(ℓ ≥ 1) = 1/4', 'P(ℓ ≥ 2) = 1/16', '', 'upper layers:', ' long "highway" links', 'layer 0:', ' short local links,', ' every vector'], { size: 13, font: 'mono', color: 'text', lh: 21, parent: side });
          ctx.reveal(side, { from: 'right', delay: 300 });
          /* reveal bottom-up */
          [0, 1, 2].forEach(function (L) {
            ctx.reveal(S.planeG[L], { from: 'up', delay: L * 500, dur: 500 });
          });
          ctx.reveal(verts, { delay: 1500 });
          ctx.reveal(dots, { delay: 200, dur: 800 });
          return Promise.all(edges.map(function (e, L) { return ctx.reveal(e, { delay: 700 + L * 500, dur: 700 }); }));
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Greedy descent',
        say: 'Now search. The query enters at the single entry point on the top layer and hops greedily to whichever neighbour is closer to the query, until no neighbour improves. That node becomes the entry for the layer below, where the same greedy walk continues with shorter links. On the bottom layer the search widens into a beam: a candidate list of size ef search is expanded best first, and the closest few are returned. A handful of hops replaces a scan over everything.',
        deep: '<pre>def search(q, k, ef):\n  ep = entry_point\n  for L in range(top, 0, -1):  # beam 1\n    ep = greedy(q, ep, L)\n  C = minheap([ep])   # candidates\n  W = maxheap([ep])   # best ef so far\n  seen = {ep}\n  while C:\n    c = C.pop_min()\n    if d(q,c) &gt; d(q,W.max()): break\n    for e in nbrs(c, layer=0):\n      if e in seen: continue\n      seen.add(e)\n      if len(W)&lt;ef or d(q,e)&lt;d(q,W.max()):\n        C.push(e); W.push(e)\n        if len(W) &gt; ef: W.pop_max()\n  return W.smallest(k)</pre>' +
          '<p>The upper layers give an O(log N) "zoom" toward the query region; layer 0 does the precise local search. The stop rule (nearest candidate farther than the worst result) is what bounds the work to ~ef·M distance evaluations.</p>' +
          '<div class="note">Failure modes: filtered search (tenant = p42) can disconnect the graph when the filter is very selective; engines switch to brute force below a selectivity threshold or use filter-aware graphs (e.g. ACORN, Filtered-DiskANN).</div>',
        run: function (ctx) {
          var S = ctx.state, H = S.H, g = S.cur;
          ctx.hud('hops ≈ O(log N) · evaluations ≈ ef · M');
          ctx.remove(S.side, 300);
          var Q = { u: 0.66, v: 0.3 };
          var qg = ctx.group({ parent: g });
          var qp = [0, 1, 2].map(function (L) { return proj(Q.u, Q.v, L); });
          ctx.line(qp[2].x, qp[2].y, qp[0].x, qp[0].y, { color: ctx.alpha('magenta', 0.5), sw: 1.2, dash: '3 4', parent: qg });
          qp.forEach(function (p) {
            ctx.poly([[0, -11], [3, -3], [11, -3], [4, 2], [7, 10], [0, 5], [-7, 10], [-4, 2], [-11, -3], [-3, -3]].map(function (d) { return [p.x + d[0], p.y + d[1]]; }), { fill: 'magenta', parent: qg, glow: true });
          });
          ctx.text(qp[2].x + 14, qp[2].y - 10, 'q', { size: 15, font: 'mono', weight: 700, color: 'magenta', parent: qg });
          ctx.reveal(qg, { from: 'scale' });
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
          /* W panel */
          var wp = ctx.group({ parent: g });
          panel(ctx, wp, 1330, 380, 220, 250, 'amber');
          ctx.text(1345, 404, 'W  (efSearch = 5)', { size: 13, font: 'mono', weight: 700, color: 'amber', parent: wp });
          ctx.text(1345, 426, 'node     d(q, ·)', { size: 12, font: 'mono', color: 'dim', parent: wp });
          S.wRows = [0, 1, 2, 3, 4].map(function (k) { return ctx.text(1345, 452 + k * 24, '', { size: 13, font: 'mono', color: 'text', parent: wp }); });
          S.evalT = ctx.text(1345, 584, '', { size: 12, font: 'mono', color: 'dim', parent: wp });
          S.hopT = ctx.text(1345, 606, '', { size: 12, font: 'mono', color: 'dim', parent: wp });
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
          wp.setAttribute('opacity', 0);
          var chain = ctx.wait(500).then(function () {
            return Promise.all([ctx.camera(860, 520, 1.22, 900), ctx.reveal(epL, { dur: 300 })]);
          });
          var hops = 0;
          segs.forEach(function (l, k) {
            chain = chain.then(function () {
              if (!path[k][3]) hops++;
              S.hopT.textContent = 'greedy hops: ' + hops;
              return ctx.reveal(l, { dur: 380 });
            }).then(function () {
              var p = path[k];
              var el = S.dot[p[0]][p[2]];
              el.setAttribute('fill', ctx.color('magenta'));
              return ctx.wait(150);
            });
          });
          chain = chain.then(function () {
            return Promise.all([ctx.camera(null, null, null, 800), ctx.reveal(wp, { dur: 400 })]);
          });
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
          return chain.then(function () {
            showW(exp.length ? exp[exp.length - 1].W : W, true);
            S.result.forEach(function (i) {
              var el = S.dot[0][i];
              el.setAttribute('fill', ctx.color('lime')); el.setAttribute('r', 8);
            });
            return Promise.all(S.result.map(function (i) { return ctx.pulse(S.dot[0][i], { color: 'lime', dur: 700 }); }));
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Recall vs latency',
        say: 'HNSW is approximate, and you choose how approximate at query time. A larger ef search explores more candidates: recall climbs toward one, and latency grows roughly linearly. A larger M gives a better connected graph and higher recall at the same ef, but costs memory and build time. Try the ef buttons below the chart. For our trailer, missing the right character sheet is costly, so the camera agent runs at high recall and pays a millisecond or two.',
        deep: '<div class="eq">recall@k = |ANN<sub>k</sub>(q) ∩ NN<sub>k</sub>(q)| / k</div>' +
          '<p>Curves below are illustrative, shaped like ANN-Benchmarks results for 10 M × 1152-d vectors, single thread. Latency is roughly ∝ ef · M · d (distance evaluations dominate); recall saturates.</p>' +
          '<p><b>Memory</b> for N = 10<sup>7</sup>, d = 1152, fp16:</p>' +
          '<div class="eq">vectors = N·d·2 B ≈ 23 GB; &nbsp; graph ≈ N·2M·4 B ≈ 1.3 GB (M = 16)</div>' +
          '<p>The vectors, not the graph, dominate, which is why the next step compresses them. HNSW also wants everything in RAM because each hop is a random access; for 10<sup>9</sup> vectors, <b>DiskANN</b> keeps a Vamana graph plus PQ codes in RAM and full vectors on NVMe (~1 SSD read per hop), and GPU indexes (CAGRA in cuVS, Faiss-GPU IVF) trade memory for massive batch throughput.</p>' +
          '<table><tr><th>Knob ↑</th><th>Recall</th><th>Latency</th><th>Memory</th><th>Build</th></tr>' +
          '<tr><td>efSearch</td><td>↑</td><td>↑</td><td>–</td><td>–</td></tr>' +
          '<tr><td>M</td><td>↑</td><td>↑ (mild)</td><td>↑</td><td>↑</td></tr>' +
          '<tr><td>efConstruction</td><td>↑</td><td>–</td><td>–</td><td>↑</td></tr></table>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [2]);
          var EF = [16, 32, 64, 128, 256, 512];
          var C16 = { rec: [0.82, 0.91, 0.96, 0.985, 0.995, 0.998], lat: [0.35, 0.6, 1.1, 2.0, 3.8, 7.2] };
          var C32 = { rec: [0.88, 0.95, 0.98, 0.993, 0.998, 0.999], lat: [0.5, 0.85, 1.5, 2.8, 5.2, 9.8] };
          var lg = function (v) { return Math.log(v) / Math.LN10; };
          head(ctx, g, 80, 380, 'RECALL@10 vs LATENCY  (illustrative, 10M × 1152-d, 1 thread)');
          var X = 130, Y = 420, W = 660, Hh = 330;
          var xd = [lg(0.25), lg(14)], yd = [0.8, 1.0];
          function mk(Cv) { return Cv.lat.map(function (l, i) { return [lg(l), Cv.rec[i]]; }); }
          var p16 = ctx.plot(X, Y, W, Hh, mk(C16), { xDomain: xd, yDomain: yd, color: 'teal', sw: 2.5, parent: g });
          var p32 = ctx.plot(X, Y, W, Hh, mk(C32), { xDomain: xd, yDomain: yd, color: 'violet', sw: 2.5, axes: false, parent: g });
          [0.5, 1, 2, 5, 10].forEach(function (v) { var p = p16.toPx(lg(v), 0.8); ctx.text(p.x, Y + Hh + 18, v + ' ms', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: g }); });
          [0.8, 0.85, 0.9, 0.95, 1.0].forEach(function (v) {
            var p = p16.toPx(xd[0], v);
            ctx.text(X - 10, p.y, v.toFixed(2), { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: g });
            ctx.line(X, p.y, X + W, p.y, { color: ctx.alpha('white', 0.05), parent: g });
          });
          ctx.label(X + W - 120, Y + Hh - 60, 'M = 16', { color: 'teal', size: 12, anchor: 'start' , parent: g });
          ctx.label(X + W - 120, Y + Hh - 30, 'M = 32', { color: 'violet', size: 12, anchor: 'start', parent: g });
          S.pts16 = C16.lat.map(function (l, i) { var p = p16.toPx(lg(l), C16.rec[i]); return ctx.circle(p.x, p.y, 4, { fill: 'teal', parent: g }); });
          C32.lat.forEach(function (l, i) { var p = p16.toPx(lg(l), C32.rec[i]); ctx.circle(p.x, p.y, 4, { fill: 'violet', parent: g }); });
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
          /* interactive ef chips */
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
          ctx.text(X, 812, 'click efSearch:', { size: 12, font: 'mono', color: 'dim', parent: g });
          EF.forEach(function (e, i) {
            var c = ctx.label(X + 150 + i * 82, 812, String(e), { color: 'amber', size: 13, w: 66, parent: g });
            c.style.cursor = 'pointer';
            c.addEventListener('click', function () { setEf(i, 400); });
            S.efChips.push(c);
          });
          var p0 = p16.toPx(lg(C16.lat[0]), C16.rec[0]);
          ctx.place(S.mk, p0.x, p0.y);
          setEf(0, 0);
          ctx.reveal(g, { from: 'up', dur: 500 });
          ctx.hud('ef 16 → 256: recall 0.82 → 0.995, latency ×11');
          return ctx.wait(700).then(function () { return setEf(2, 700); })
            .then(function () { return ctx.wait(500); })
            .then(function () { return setEf(4, 700); })
            .then(function () { return ctx.wait(400); })
            .then(function () { return setEf(3, 600); });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'IVF-PQ compression',
        say: 'At a billion vectors, raw embeddings need over two terabytes. Product quantisation shrinks them. Split each vector into forty eight sub-vectors, learn two hundred fifty six centroids per sub-space, and store just the byte index of the nearest centroid: forty eight bytes instead of two thousand three hundred. At query time, precompute a small table of distances from each query piece to every centroid, and a distance becomes forty eight table lookups and adds. An inverted file on top means only a few clusters are scanned at all.',
        deep: '<p><b>IVF</b>: k-means with n<sub>list</sub> coarse centroids; each vector is stored in the list of its nearest centroid. A query scans only the n<sub>probe</sub> closest lists: with n<sub>list</sub> = 2<sup>18</sup> and n<sub>probe</sub> = 64, a 10<sup>9</sup>-vector index scans ≈ 2.4·10<sup>5</sup> codes per query.</p>' +
          '<p><b>PQ</b>: x = [x<sub>1</sub> … x<sub>m</sub>], x<sub>j</sub> ∈ ℝ<sup>d/m</sup>; codebook C<sub>j</sub> has 256 centroids (8 bits):</p>' +
          '<div class="eq">code<sub>j</sub>(x) = argmin<sub>c</sub> ‖x<sub>j</sub> − C<sub>j</sub>[c]‖², &nbsp; m = 48, d/m = 24</div>' +
          '<p><b>Asymmetric distance (ADC)</b>: the query stays exact:</p>' +
          '<div class="eq">T[j][c] = ‖q<sub>j</sub> − C<sub>j</sub>[c]‖², &nbsp; d̃(q,x) = Σ<sub>j=1</sub><sup>m</sup> T[j][code<sub>j</sub>(x)]</div>' +
          '<p>The table is 48 × 256 floats = 48 KB (fits in L1/L2 or GPU shared memory); per code: 48 lookups + adds instead of a 1152-d dot product. In IVF-PQ the residual x − centroid is quantised, which improves accuracy. Fast-scan variants use 4-bit codes and SIMD shuffles for in-register lookups.</p>' +
          '<table><tr><th>10<sup>9</sup> vectors</th><th>Bytes/vec</th><th>Total</th></tr><tr><td>fp16 raw</td><td>2304</td><td>2.3 TB</td></tr><tr><td>PQ48 + 8 B id</td><td>56</td><td>56 GB</td></tr></table>' +
          '<p>PQ is lossy, so production systems <b>refine</b>: re-score the top few hundred with exact vectors fetched from SSD, restoring most of the recall.</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [2]);
          ctx.hud('2304 B → 48 B per vector (48×) · ADC = 48 lookups');
          /* IVF */
          var iv = ctx.group({ parent: g });
          head(ctx, iv, 60, 380, 'IVF · scan only n_probe = 3 of 9 cells');
          panel(ctx, iv, 60, 395, 560, 420);
          var r = ctx.rng(21);
          var cents = [];
          for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) cents.push({ x: 150 + b * 190 + (r() - 0.5) * 60, y: 470 + a * 125 + (r() - 0.5) * 40 });
          var q = { x: 380, y: 610 };
          var order = cents.map(function (c, i) { return i; }).sort(function (i, j) { return Math.hypot(cents[i].x - q.x, cents[i].y - q.y) - Math.hypot(cents[j].x - q.x, cents[j].y - q.y); });
          var probe = order.slice(0, 3);
          var PT = [];
          cents.forEach(function (c, i) {
            var on = probe.indexOf(i) >= 0;
            var halo = ctx.circle(c.x, c.y, 58, { fill: ctx.alpha(on ? 'magenta' : 'teal', 0.05), stroke: ctx.alpha(on ? 'magenta' : 'teal', on ? 0.6 : 0.2), sw: on ? 1.5 : 1, dash: '3 4', parent: iv });
            for (var k = 0; k < 7; k++) {
              var an = r() * Math.PI * 2, rd = 10 + r() * 42;
              PT.push([ctx.circle(c.x + Math.cos(an) * rd, c.y + Math.sin(an) * rd * 0.8, 3.5, { fill: ctx.alpha('teal', 0.7), parent: iv }), on, halo]);
            }
            ctx.rect(c.x - 6, c.y - 6, 12, 12, { rx: 2, fill: 'white', parent: iv });
          });
          ctx.poly([[0, -11], [3, -3], [11, -3], [4, 2], [7, 10], [0, 5], [-7, 10], [-4, 2], [-11, -3], [-3, -3]].map(function (d) { return [q.x + d[0], q.y + d[1]]; }), { fill: 'magenta', parent: iv, glow: true });
          ctx.text(80, 800, '■ coarse centroid   ● PQ-coded vector', { size: 12, font: 'mono', color: 'dim', parent: iv });
          ctx.reveal(iv, { from: 'up' });
          /* PQ */
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
          S.codeB = codes.map(function (cv, j2) {
            var t = ctx.group({ parent: pq });
            ctx.rect(sx + j2 * segW, 680, segW - 4, 30, { rx: 4, fill: ctx.alpha('amber', 0.18), stroke: 'amber', sw: 1, parent: t });
            ctx.text(sx + j2 * segW + (segW - 4) / 2, 695, '0x' + (cv < 16 ? '0' : '') + cv.toString(16).toUpperCase(), { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: t });
            t.setAttribute('opacity', 0);
            return t;
          });
          ctx.text(sx, 728, 'stored code: 48 bytes (vs 2304 B fp16)', { size: 12, font: 'mono', color: 'amber', parent: pq });
          /* LUT */
          head(ctx, pq, 900, 488, 'ADC lookup table T[j][c]', 'amber');
          S.lut = ctx.matrix(900, 505, 12, 24, { cell: 11, gap: 1, cmap: 'heat', values: function (a2, b2) { return 0.1 + 0.8 * Math.abs(Math.sin(a2 * 1.7 + b2 * 0.9)); }, parent: pq });
          ctx.text(900, 660, '48 × 256 fp32 = 48 KB  (12 × 24 shown)', { size: 12, font: 'mono', color: 'dim', parent: pq });
          S.sumT = ctx.text(1200, 520, '', { size: 14, font: 'mono', color: 'amber', parent: pq });
          ctx.text(1200, 555, 'd̃(q,x) = Σ_j T[j][code_j]', { size: 14, font: 'mono', color: 'white', parent: pq });
          ctx.text(1200, 580, '48 adds, no 1152-d dot', { size: 12, font: 'mono', color: 'dim', parent: pq });
          /* memory bars */
          head(ctx, pq, 680, 775, 'MEMORY FOR 10⁹ VECTORS');
          ctx.rect(690, 790, 820, 24, { rx: 4, fill: ctx.alpha('white', 0.12), stroke: ctx.alpha('white', 0.35), sw: 1, parent: pq });
          ctx.text(700, 802, 'fp16 raw: 2.3 TB', { size: 12, font: 'mono', color: 'white', parent: pq });
          S.pqBar = ctx.rect(690, 824, 820 * 56 / 2304, 24, { rx: 3, fill: ctx.alpha('amber', 0.7), stroke: 'amber', sw: 1, parent: pq });
          ctx.text(720, 836, 'PQ48 + id: 56 GB (2.4%) → fits one server', { size: 12, font: 'mono', color: 'amber', parent: pq });
          ctx.reveal(pq, { from: 'up', delay: 200 });
          /* animations */
          var lutSel = [];
          var chain = ctx.wait(600).then(function () {
            return Promise.all(PT.map(function (p) { return p[1] ? Promise.resolve() : ctx.fade(p[0], 0.15, 600); }));
          }).then(function () {
            return ctx.pulse(S.sub[0], { color: 'amber', dur: 500 });
          }).then(function () {
            return ctx.pulse(S.cbSel, { color: 'amber', dur: 500 });
          }).then(function () {
            return ctx.reveal(S.codeB, { stagger: 80, dur: 250 });
          });
          var acc = 0;
          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach(function (j3) {
            chain = chain.then(function () {
              var c = (codes[j3] % 24);
              var cell = S.lut.cells[j3][c];
              cell.setAttribute('stroke', ctx.color('cyan')); cell.setAttribute('stroke-width', 2);
              cell.setAttribute('fill', ctx.color('white'));
              lutSel.push(cell);
              acc += 0.1 + 0.8 * Math.abs(Math.sin(j3 * 1.7 + c * 0.9));
              S.sumT.textContent = 'Σ (' + (j3 + 1) + '/12 shown) = ' + acc.toFixed(2);
              return ctx.wait(160);
            });
          });
          return chain;
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Hybrid + rerank',
        say: 'Dense vectors understand meaning but blur exact identifiers. The character id FX dash zero seven, or a sketch file name, is better matched by classic BM25 keyword search. So we run both and fuse the ranked lists with reciprocal rank fusion, which only needs ranks, not comparable scores. Documents that both retrievers like float to the top. Then a cross-encoder reads the query and each candidate together, which is slower but far more precise, and reorders the final few.',
        deep: '<p><b>BM25</b> (sparse, exact terms):</p>' +
          '<div class="eq">BM25(q,d) = Σ<sub>t∈q</sub> IDF(t) · f<sub>t,d</sub>(k<sub>1</sub>+1) / (f<sub>t,d</sub> + k<sub>1</sub>(1 − b + b·|d|/avgdl)), &nbsp; k<sub>1</sub>≈1.2, b≈0.75</div>' +
          '<p><b>Reciprocal rank fusion</b>, rank-based so no score calibration is needed:</p>' +
          '<div class="eq">RRF(d) = Σ<sub>r∈{bm25, dense}</sub> 1 / (k + rank<sub>r</sub>(d)), &nbsp; k = 60</div>' +
          '<p>Here <code>fox_sheet_front</code> is #2 in both lists: 1/62 + 1/62 = 0.0323, beating items that are #1 in only one list (1/61 = 0.0164).</p>' +
          '<p><b>Cross-encoder reranking</b>: a bi-encoder scores q·d with independently computed vectors; a cross-encoder runs full attention over [query; candidate] jointly (for images: a VLM-based reranker), capturing fine interactions ("cracked helmet" vs "helmet"). The price is one full transformer forward pass per (query, candidate) pair instead of one dot product against a pre-computed vector, so it only sees the top 20–50.</p>' +
          '<div class="note">Alternatives: learned sparse (SPLADE) instead of BM25; late interaction (ColBERT / ColPali-style multi-vector) as a middle ground between bi- and cross-encoders.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [3, 4]);
          ctx.hud('RRF(d) = Σ 1/(60 + rank) · rerank top-40 → 8');
          var DOC = { A: ['fox_sheet_front', 'amber'], B: ['fox_sheet_side', 'amber'], C: ['take2_kf4 close-up', 'lime'], D: ['sketch_2 visor crack', 'violet'],
            F: ['FX-07 bible (text)', 'teal'], G: ['take1_kf2 wide', 'lime'], H: ['style_guide_light', 'violet'] };
          var BM = ['F', 'A', 'B', 'H', 'D'], DN = ['C', 'A', 'D', 'B', 'G'];
          var sc = {};
          [BM, DN].forEach(function (L) { L.forEach(function (d, i) { sc[d] = (sc[d] || 0) + 1 / (60 + i + 1); }); });
          var FU = Object.keys(sc).sort(function (a, b) { return sc[b] - sc[a] || (a < b ? -1 : 1); });
          var RR = { A: 0.94, C: 0.91, D: 0.88, B: 0.83, F: 0.52, H: 0.31, G: 0.28 };
          var FIN = FU.slice().sort(function (a, b) { return RR[b] - RR[a]; });
          ctx.label(800, 360, 'query: "FX-07 fox astronaut removes cracked helmet, close-up"', { color: 'magenta', size: 13, parent: g });
          var cols = [[80, 'BM25 (sparse)', BM, 'blue'], [430, 'Dense (ANN)', DN, 'violet']];
          var pos = {};
          function row(x, y, d, extra, col) {
            var rg = ctx.group({ parent: g });
            ctx.rect(x, y - 16, 290, 32, { rx: 6, fill: ctx.mix('#070d1a', DOC[d][1], 0.12), stroke: ctx.alpha(col || DOC[d][1], 0.6), sw: 1, parent: rg });
            ctx.text(x + 12, y, DOC[d][0], { size: 13, font: 'mono', color: DOC[d][1], parent: rg });
            if (extra !== undefined) rg.valT = ctx.text(x + 280, y, extra, { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: rg });
            return rg;
          }
          cols.forEach(function (c) {
            head(ctx, g, c[0], 410, c[1], c[3]);
            c[2].forEach(function (d, i) {
              var y = 450 + i * 44;
              row(c[0], y, d, '#' + (i + 1), c[3]);
              pos[c[0] + d] = { x: c[0] + 290, y: y };
            });
          });
          ctx.reveal(g, { from: 'up', dur: 500 });
          /* fused */
          head(ctx, g, 800, 410, 'RRF fused  (×10⁻³)', 'teal');
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
          /* rerank */
          head(ctx, g, 1180, 410, 'cross-encoder rerank', 'amber');
          var rrRows = FU.map(function (d, i) {
            var rg = row(1180, 450 + i * 44, d, RR[d].toFixed(2), 'amber');
            ctx.place(rg, 0, 0);
            rg.setAttribute('opacity', 0);
            return rg;
          });
          ctx.text(1180, 780, 'top-5 → context + video conditioning', { size: 12, font: 'mono', color: 'amber', parent: g });
          S.cut = ctx.line(1170, 450 + 4.5 * 44, 1480, 450 + 4.5 * 44, { color: 'amber', dash: '5 4', parent: g });
          S.cut.setAttribute('opacity', 0);
          ctx.text(80, 700, 'BM25 wins on exact ids ("FX-07"); dense wins on meaning ("close-up", "cracked visor").', { size: 13, color: 'dim', parent: g });
          ctx.text(80, 724, 'RRF rewards agreement: #2 + #2 beats a single #1.', { size: 13, color: 'dim', parent: g });
          return ctx.wait(700).then(function () {
            return ctx.reveal(Array.prototype.slice.call(lines.childNodes), { from: 'draw', stagger: 60, dur: 500 });
          }).then(function () {
            return ctx.reveal(fusedRows, { from: 'left', stagger: 110, dur: 350 });
          }).then(function () {
            return ctx.reveal(rrRows, { from: 'left', stagger: 60, dur: 300 });
          }).then(function () {
            return Promise.all(FIN.map(function (d, k) {
              var i = FU.indexOf(d);
              return ctx.transform(rrRows[i], { y: (k - i) * 44 }, 900, 'inOut', 200);
            }));
          }).then(function () {
            FIN.forEach(function (d, k) { if (k >= 5) ctx.fade(rrRows[FU.indexOf(d)], 0.35, 300); });
            return ctx.reveal(S.cut, { dur: 300 });
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Agent memory types',
        say: 'Retrieval is one part of a broader agent memory system. Working memory is the context window itself: small, fast, and wiped every run. Episodic memory records what happened in past runs, like the fact that shot three failed with helmet flicker and what fixed it. Semantic memory holds facts: the character bible, the style guide, the creator preferences. Procedural memory holds skills: prompt templates, tool recipes and playbooks. Each is stored differently and loaded into the context only when relevant.',
        deep: '<p>The CoALA taxonomy (from cognitive science) maps cleanly onto an agent platform:</p>' +
          '<table><tr><th>Type</th><th>Content</th><th>Store</th><th>Read path</th></tr>' +
          '<tr><td>Working</td><td>current plan, tool results, scratch</td><td>context window (KV cache)</td><td>attention</td></tr>' +
          '<tr><td>Episodic</td><td>past runs, failures, fixes</td><td>event log + run summaries (vector)</td><td>similarity + recency</td></tr>' +
          '<tr><td>Semantic</td><td>facts: character bible, style guide, prefs</td><td>docs + vector DB + KV</td><td>hybrid retrieval</td></tr>' +
          '<tr><td>Procedural</td><td>skills, prompt templates, tool recipes</td><td>skill files, tools, (fine-tuned) weights</td><td>routing / skill selection</td></tr></table>' +
          '<p><b>Character &amp; style memory</b> is semantic memory with images: the fox\'s character sheet, sketch embeddings, approved keyframes, and optionally a subject LoRA or identity embedding for the video model.</p>' +
          '<p>Context budget is the scarce resource: the agent pays for every token on every turn (prefill), and very long contexts degrade recall of the middle. MemGPT-style systems treat the context as RAM and memory stores as disk, paging content in and out with explicit tool calls (<code>memory.search</code>, <code>memory.write</code>).</p>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, [5, 0]);
          ctx.hud('working · episodic · semantic · procedural (CoALA)');
          /* context bar */
          ctx.text(452, 578, 'WORKING MEMORY', { size: 14, font: 'display', weight: 700, color: 'amber', spacing: 1, anchor: 'end', parent: g });
          ctx.para(452, 600, ['= context window of the', 'camera agent · 31k used'], { size: 12, font: 'mono', color: 'amber', lh: 18, anchor: 'end', parent: g });
          var segs = [['sys', 3, 'dim'], ['tools', 6, 'blue'], ['skill', 2, 'orange'], ['episodes', 3, 'violet'], ['fox refs', 4, 'amber'], ['facts', 3, 'teal'], ['plan + scratch', 10, 'magenta']];
          var x0 = 470, sc = 660 / 31, segEl = {};
          segs.forEach(function (s) {
            var w = s[1] * sc;
            segEl[s[0]] = { x: x0 + w / 2, el: ctx.rect(x0, 572, w - 3, 56, { rx: 4, fill: ctx.alpha(s[2], 0.3), stroke: s[2], sw: 1.2, parent: g }) };
            ctx.text(x0 + (w - 3) / 2, 590, s[0], { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: g });
            ctx.text(x0 + (w - 3) / 2, 610, s[1] + 'k', { size: 11, font: 'mono', color: s[2], anchor: 'middle', parent: g });
            x0 += w;
          });
          var M = [
            ['Episodic', 'past runs · event log + summaries', 'violet', 250, 430, 'episodes', '"3a: flicker at cfg 7 → fixed w/ ref 0.8"'],
            ['Semantic', 'facts · character bible · prefs', 'teal', 1350, 430, 'facts', '"FX-07: orange fur, white chest, left-ear scar"'],
            ['Procedural', 'skills · playbooks · tool recipes', 'orange', 250, 780, 'skill', 'skill fix_flicker(): lower cfg, raise ref'],
            ['Character & style', 'sheet + sketch embeddings', 'amber', 1350, 780, 'fox refs', 'fox_sheet_front.png · e ∈ ℝ¹¹⁵²']
          ];
          var ls = [];
          M.forEach(function (m, i) {
            var n = ctx.node({ x: m[3], y: m[4], w: 330, h: 64, title: m[0], sub: m[1], color: m[2], titleSize: 16, subSize: 12, parent: g });
            var top = m[4] < 600;
            ctx.text(m[3], top ? m[4] + 52 : m[4] - 52, m[6], { size: 12, font: 'mono', color: m[2], anchor: 'middle', parent: g });
            var tgt = segEl[m[5]];
            var l = ctx.link(n, { x: tgt.x, y: top ? 572 : 628 }, { from: m[3] < 800 ? 'r' : 'l', to: top ? 't' : 'b', color: ctx.alpha(m[2], 0.7), parent: g });
            ls.push([l, m[2]]);
          });
          ctx.text(800, 862, 'loaded on demand · evicted at the end of the turn · everything else lives outside the context', { size: 13, color: 'dim', anchor: 'middle', parent: g });
          ctx.reveal(g, { from: 'fade', dur: 500 });
          return ctx.wait(700).then(function () {
            return Promise.all(ls.map(function (l, i) { return ctx.wait(i * 250).then(function () { return ctx.packet(l[0], { color: l[1], dur: 800 }); }); }));
          }).then(function () {
            return ctx.pulse(segEl['fox refs'].el, { color: 'amber', times: 2, dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------------ 9 */
      {
        title: 'Consistency loop',
        say: 'Here is memory at work across the whole trailer. For every shot, the agent retrieves the fox sheet and sketch embeddings, renders, and the critic measures identity similarity between the new keyframes and the character sheet. Approved keyframes are written back, so later shots can match them too; failures are rejected and re-rendered. Without retrieval the fox drifts shot by shot. Memory also needs hygiene: score items by recency, importance and relevance, merge duplicates, summarise old episodes, and let stale items decay.',
        deep: '<p><b>Per-shot loop</b> (character consistency):</p>' +
          '<pre>for shot in plan.shots:\n  refs = mem.retrieve(shot.prompt, k=8,\n           kind=["char", "sketch", "kf"])\n  take = render(shot, refs.images,\n                ref_strength=0.8)\n  s = cos(E_id(take.kf), E_id(refs.char))\n  if s &gt;= tau:\n    mem.write(take.kf, importance=critic)\n  else:\n    retry(shot, seed=new, ref_strength+0.1)</pre>' +
          '<p>E<sub>id</sub> can be a SigLIP/DINOv2 embedding of a character crop or a dedicated re-ID model; τ is calibrated on human judgements (illustrative τ = 0.75 below).</p>' +
          '<p><b>Retrieval score</b> (Generative Agents):</p>' +
          '<div class="eq">score = α·recency + β·importance + γ·relevance, &nbsp; recency = 0.995<sup>Δt[h]</sup></div>' +
          '<ul><li><b>Write</b> selectively: approved takes and critic lessons, not every intermediate.</li>' +
          '<li><b>Merge</b> near-duplicates (cos &gt; 0.95) to avoid crowding top-k with the same keyframe.</li>' +
          '<li><b>Summarise</b>: compress a finished run\'s events into one episodic summary; keep raw events in the log.</li>' +
          '<li><b>Forget</b>: TTLs, decay, and hard deletion through lineage when a user withdraws an upload.</li></ul>' +
          '<div class="note">Security: memory is an injection surface. Retrieved text is data, never instructions; writes are tenant-scoped and provenance-tagged.</div>',
        run: function (ctx) {
          var S = ctx.state;
          var g = view(ctx, S, null);
          ctx.hud('identity sim (illustr.): 0.85 with memory · 0.58 drift');
          /* loop */
          head(ctx, g, 60, 380, 'PER-SHOT CONSISTENCY LOOP');
          var LN = [['retrieve refs', 'fox sheet + sketches', 'teal', 210, 470, 'search'], ['render shot i', 'ref-image conditioning', 'lime', 590, 470, 'film'],
            ['critic', 'identity sim s = cos', 'pink', 590, 700, 'eye'], ['write back', 'approved keyframes', 'amber', 210, 700, 'db']];
          var LNn = LN.map(function (d) { return ctx.node({ x: d[3], y: d[4], w: 250, h: 64, title: d[0], sub: d[1], icon: d[5], color: d[2], titleSize: 15, subSize: 12, parent: g }); });
          var ll = [];
          for (var i = 0; i < 4; i++) ll.push(ctx.link(LNn[i], LNn[(i + 1) % 4], { color: ctx.alpha(LN[i][2], 0.8), parent: g }));
          var rej = ctx.link(LNn[2], LNn[1], { from: 'r', to: 'r', bend: { x: 800, y: 585 }, color: ctx.alpha('red', 0.8), dash: '5 4', parent: g, label: 's < τ: re-render', labelDx: 44, labelDy: 0 });
          rej.labelEl.querySelector('text').setAttribute('fill', ctx.color('white'));
          ctx.text(400, 585, 'for shot in 1..6', { size: 14, font: 'mono', color: 'white', anchor: 'middle', parent: g });
          ctx.text(60, 800, 'every approved shot makes the next retrieval better', { size: 13, color: 'dim', parent: g });
          /* chart */
          head(ctx, g, 900, 380, 'IDENTITY SIMILARITY PER SHOT (illustrative)');
          var WM = [0.85, 0.84, 0.86, 0.83, 0.85, 0.84], NM = [0.84, 0.77, 0.70, 0.66, 0.61, 0.58];
          var cx0 = 940, cy0 = 410, ch = 180, bw = 34;
          var yv = function (v) { return cy0 + ch - (v - 0.4) / 0.6 * ch; };
          ctx.line(cx0, cy0 + ch, cx0 + 560, cy0 + ch, { color: 'faint', parent: g });
          [0.4, 0.6, 0.8, 1.0].forEach(function (v) { ctx.text(cx0 - 8, yv(v), v.toFixed(1), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g }); });
          var bars = [];
          WM.forEach(function (v, k) {
            var x = cx0 + 20 + k * 90;
            var b1 = ctx.rect(x, yv(NM[k]), bw, cy0 + ch - yv(NM[k]), { rx: 3, fill: ctx.alpha('red', 0.45), stroke: 'red', sw: 1, parent: g });
            var b2 = ctx.rect(x + bw + 4, yv(v), bw, cy0 + ch - yv(v), { rx: 3, fill: ctx.alpha('teal', 0.55), stroke: 'teal', sw: 1, parent: g });
            ctx.text(x + bw + 2, cy0 + ch + 16, 'shot ' + (k + 1), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            bars.push([b1, NM[k]], [b2, v]);
          });
          ctx.line(cx0, yv(0.75), cx0 + 560, yv(0.75), { color: 'amber', dash: '6 4', sw: 1.5, parent: g });
          ctx.label(1230, 420, 'τ = 0.75', { color: 'amber', size: 11, anchor: 'start', parent: g });
          ctx.label(1330, 420, 'no memory', { color: 'red', size: 11, anchor: 'start', parent: g });
          ctx.label(1430, 420, 'retrieval',{ color: 'teal', size: 11, anchor: 'start', parent: g });
          /* lifecycle */
          head(ctx, g, 900, 648, 'MEMORY LIFECYCLE');
          ctx.para(900, 676, ['score = α·recency + β·importance', '        + γ·relevance', 'recency = 0.995^Δt[h]', 'merge dupes: cos > 0.95', 'summarise runs → episodes', 'forget: TTL + lineage delete'], { size: 13, font: 'mono', color: 'text', lh: 22, parent: g });
          var dp = ctx.plot(1250, 670, 270, 130, function (h) { return Math.pow(0.995, h); }, { xDomain: [0, 720], yDomain: [0, 1], color: 'teal', parent: g });
          ctx.text(1250, 818, '0', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          ctx.text(1520, 818, '30 days', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: g });
          ctx.text(1256, 662, 'recency', { size: 11, font: 'mono', color: 'dim', parent: g });
          var p1d = dp.toPx(139, 0.5);
          ctx.circle(p1d.x, p1d.y, 4, { fill: 'amber', parent: g });
          ctx.text(p1d.x + 8, p1d.y - 10, 'half-life ≈ 5.8 d', { size: 11, font: 'mono', color: 'amber', parent: g });
          ctx.reveal(g, { from: 'up', dur: 500 });
          bars.forEach(function (b) {
            var h = parseFloat(b[0].getAttribute('height')), y = parseFloat(b[0].getAttribute('y'));
            b[0].setAttribute('height', 0); b[0].setAttribute('y', y + h);
            b[0]._h = h; b[0]._y = y;
          });
          var chain = ctx.wait(600);
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
          return chain.then(function () {
            return ctx.packet(rej, { color: 'red', dur: 700 });
          });
        }
      }
    ]
  });
})();
