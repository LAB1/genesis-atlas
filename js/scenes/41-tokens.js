/* L2 — Tokenization & Embeddings. Bytes, pre-tokenization, BPE training and encoding, special tokens and
 * chat templates, embedding lookup, geometry of the residual stream, multimodal tokens. */
(function () {
  var LINE = ['A', ' fox', ' astronaut', ' crash', '-', 'lands', ' on', ' a', ' glowing', ' ice', ' moon', '.', ' \u51b0', '\u6708'];
  var PRE = ['A', ' fox', ' astronaut', ' crash', '-lands', ' on', ' a', ' glowing', ' ice', ' moon', '.', ' \u51b0\u6708'];
  var FULL = 'A 30-second cinematic trailer: a fox astronaut crash-lands on a glowing ice moon. Match the style of my sketches. Use my voice memo as narration.';
  var BW = 24, BX = 124;   /* byte cell width, first byte x */

  function boxOf(x, y, w, h) { return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, l: x, r: x + w, t: y, b: y + h }; }
  function keepWS(root) {
    Array.prototype.forEach.call(root.querySelectorAll('text'), function (t) {
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.style.whiteSpace = 'pre';
    });
  }
  function utf8(ch) {
    var c = ch.charCodeAt(0);
    if (c < 0x80) return [c];
    if (c < 0x800) return [0xc0 | (c >> 6), 0x80 | (c & 63)];
    return [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
  }
  function hex(b) { return (b < 16 ? '0' : '') + b.toString(16).toUpperCase(); }
  function nbytes(s) { var n = 0; for (var i = 0; i < s.length; i++) n += utf8(s.charAt(i)).length; return n; }
  function vis(s) { return s.replace(/ /g, '\u00b7'); }
  /* the mono font turns "<|" and "|>" into arrow ligatures; putting the pipe in a different font face (bold)
   * splits the shaping run, so special tokens render literally in the deep panel */
  function nolig(html) { return html.replace(/&lt;\|/g, '&lt;<b>|</b>').replace(/\|&gt;/g, '<b>|</b>&gt;'); }

  function card(ctx, parent, x, y, w, h, color, title) {
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 10, fill: 'rgba(8,14,28,0.92)', stroke: ctx.alpha(color, 0.55), parent: g });
    if (title) ctx.text(x + 16, y + 20, title, { size: 13, font: 'mono', weight: 700, color: color, parent: g, spacing: 1 });
    g.box = boxOf(x, y, w, h);
    return g;
  }

  /* symbol box for BPE views; returns g with .w */
  function sym(ctx, parent, x, y, s, color, hot) {
    var w = 18 + s.length * 10.5;
    var g = ctx.group({ parent: parent });
    ctx.rect(x, y - 17, w, 34, { rx: 6, fill: ctx.alpha(color, hot ? 0.35 : 0.1), stroke: ctx.alpha(color, hot ? 1 : 0.6), sw: hot ? 1.8 : 1, parent: g, glow: hot ? true : undefined });
    ctx.text(x + w / 2, y + 0.5, s, { size: 17, font: 'mono', anchor: 'middle', color: 'white', parent: g });
    g.w = w;
    return g;
  }

  /* toy BPE state */
  function countPairs(corpus) {
    var m = {}, order = [];
    corpus.forEach(function (wd) {
      for (var i = 0; i < wd.s.length - 1; i++) {
        var k = wd.s[i] + ' ' + wd.s[i + 1];
        if (!(k in m)) { m[k] = 0; order.push(k); }
        m[k] += wd.n;
      }
    });
    var list = order.map(function (k) { return [k, m[k]]; });
    var best = list[0];
    list.forEach(function (p) { if (p[1] > best[1]) best = p; });
    var sorted = list.slice().sort(function (a, b) { return b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]); });
    return { best: best, top: sorted.slice(0, 6) };
  }
  function applyMerge(corpus, pair) {
    var ab = pair.split(' ');
    corpus.forEach(function (wd) {
      var out = [];
      for (var i = 0; i < wd.s.length; i++) {
        if (i < wd.s.length - 1 && wd.s[i] === ab[0] && wd.s[i + 1] === ab[1]) { out.push(ab[0] + ab[1]); i++; } else out.push(wd.s[i]);
      }
      wd.s = out;
    });
  }

  Atlas.register({
    id: 'tokenization',
    refs: [
      'Sennrich, Haddow &amp; Birch, <i>Neural Machine Translation of Rare Words with Subword Units</i> (BPE), ACL 2016',
      'Radford et al., <i>Language Models are Unsupervised Multitask Learners</i> (GPT-2 byte-level BPE), 2019',
      'Kudo &amp; Richardson, <i>SentencePiece</i>, EMNLP 2018; OpenAI <i>tiktoken</i> (cl100k_base, o200k_base)',
      'Llama Team, Meta AI, <i>The Llama 3 Herd of Models</i>, 2024 (128K vocabulary, chat template, special tokens)',
      'Mikolov et al., <i>Linguistic Regularities in Continuous Space Word Representations</i>, NAACL 2013; Park et al., <i>The Linear Representation Hypothesis</i>, ICML 2024',
      'Elhage et al., <i>Toy Models of Superposition</i>, Transformer Circuits 2022',
      'Press &amp; Wolf, <i>Using the Output Embedding to Improve Language Models</i> (weight tying), EACL 2017',
      'Rumbelow &amp; Watkins, <i>SolidGoldMagikarp</i> (glitch tokens), 2023; Land &amp; Bartolo, <i>Fishing for Magikarp</i>, EMNLP 2024'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Text is bytes',
        say: 'Before a model can read the fox astronaut prompt, the text must become a sequence of integers. Underneath, text is just UTF-8 bytes: one byte per English letter, three bytes for each of the two Chinese characters at the end. Feeding raw bytes would make sequences long, and attention cost grows with the square of length. Whole words would need an unbounded vocabulary. Byte level BPE sits in between: frequent chunks become single tokens, and anything unseen still falls back to bytes.',
        deep: '<p>The tokenizer is a <b>lossless, invertible</b> map between byte strings and id sequences. Three design points:</p>' +
          '<table><tr><th>Unit</th><th>|V|</th><th>T for our prompt</th><th>Problem</th></tr>' +
          '<tr><td>bytes</td><td>256</td><td>145</td><td>T² attention, weak units</td></tr>' +
          '<tr><td>words</td><td>&gt;10<sup>6</sup></td><td>25</td><td>OOV, huge softmax</td></tr>' +
          '<tr><td>byte-level BPE</td><td>32k–256k</td><td>≈ 34</td><td>tokenization artifacts</td></tr></table>' +
          '<p>With a 128k vocabulary, English prose compresses to ≈ 4 bytes (≈ 0.75 words) per token. CJK characters are 3 UTF-8 bytes each; a vocabulary with enough CJK merges maps most common characters to one token.</p>' +
          '<div class="eq">cost(attention) ∝ T², &nbsp; (145 / 34)² ≈ 18× more attention FLOPs for raw bytes</div>' +
          '<p class="muted">Token boundaries shown for the Llama-3-style tokenizer are illustrative.</p>',
        run: function (ctx) {
          var S = ctx.state;
          S.top = ctx.group();
          ctx.text(BX - 10, 200, 'text', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.top });
          ctx.text(BX - 10, 250, 'UTF-8', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.top });
          ctx.text(BX - 10, 302, 'BPE', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.top });
          var txt = LINE.join('');
          var x = BX, chars = [], bytes = [];
          for (var i = 0; i < txt.length; i++) {
            var ch = txt.charAt(i), bs = utf8(ch), w = bs.length * BW;
            var cg = ctx.group({ parent: S.top });
            ctx.rect(x + 1, 182, w - 2, 36, { rx: 4, fill: ctx.alpha(bs.length > 1 ? 'violet' : 'cyan', 0.1), stroke: ctx.alpha(bs.length > 1 ? 'violet' : 'cyan', 0.45), sw: 1, parent: cg });
            ctx.text(x + w / 2, 200.5, ch === ' ' ? '\u00b7' : ch, { size: 17, font: 'mono', anchor: 'middle', color: ch === ' ' ? 'dim' : 'white', parent: cg });
            chars.push(cg);
            bs.forEach(function (b, k) {
              var bg = ctx.group({ parent: S.top });
              ctx.rect(x + k * BW + 1, 236, BW - 2, 28, { rx: 3, fill: ctx.alpha(bs.length > 1 ? 'violet' : 'teal', 0.12), parent: bg });
              ctx.text(x + k * BW + BW / 2, 250.5, hex(b), { size: 12, font: 'mono', anchor: 'middle', color: bs.length > 1 ? 'violet' : 'teal', parent: bg });
              bytes.push(bg);
            });
            x += w;
          }
          S.toks = [];
          x = BX;
          LINE.forEach(function (t, i) {
            var w = nbytes(t) * BW, col = i % 2 ? 'amber' : 'orange';
            var tg = ctx.group({ parent: S.top });
            ctx.rect(x + 1, 284, w - 2, 36, { rx: 6, fill: ctx.alpha(col, 0.2), stroke: col, sw: 1.2, parent: tg });
            ctx.text(x + w / 2, 302.5, vis(t), { size: 14, font: 'mono', anchor: 'middle', color: 'white', parent: tg });
            S.toks.push(tg);
            x += w;
          });
          S.lineEnd = x;
          var st = ctx.group({ parent: S.top });
          S.cN = ctx.text(BX, 350, '', { size: 14, font: 'mono', color: 'cyan', parent: st });
          S.bN = ctx.text(BX + 170, 350, '', { size: 14, font: 'mono', color: 'teal', parent: st });
          S.tN = ctx.text(BX + 340, 350, '', { size: 14, font: 'mono', color: 'amber', weight: 700, parent: st });

          /* why subwords: three strategies over the full trailer prompt */
          S.why = ctx.group();
          var words = FULL.split(' ').length, nb = FULL.length, nt = 34;
          var opts = [
            ['BYTES / CHARACTERS', 'teal', nb, '|V| = 256 \u00b7 never out-of-vocab', 'units carry little meaning'],
            ['WHOLE WORDS', 'cyan', words, '|V| > 1,000,000 \u00b7 "crash-lands" OOV', 'huge embedding + softmax'],
            ['BYTE-LEVEL BPE', 'amber', nt, '|V| = 128,256 (Llama 3)', 'frequent chunks + byte fallback']
          ];
          S.whyBars = [];
          opts.forEach(function (o, i) {
            var cx = 60 + i * 500;
            var c = card(ctx, S.why, cx, 396, 480, 290, o[1], o[0]);
            ctx.text(cx + 16, 446, o[3], { size: 13, font: 'mono', color: 'text', parent: c });
            ctx.text(cx + 16, 470, o[4], { size: 13, font: 'mono', color: 'dim', parent: c });
            ctx.text(cx + 16, 522, 'T', { size: 13, font: 'mono', color: 'dim', parent: c });
            ctx.text(cx + 16, 598, 'T\u00b2', { size: 13, font: 'mono', color: 'dim', parent: c });
            var b1 = ctx.rect(cx + 44, 510, 0, 24, { rx: 3, fill: ctx.alpha(o[1], 0.55), stroke: o[1], sw: 1, parent: c });
            var b2 = ctx.rect(cx + 44, 586, 0, 24, { rx: 3, fill: ctx.alpha(o[1], 0.3), stroke: o[1], sw: 1, parent: c });
            ctx.text(cx + 44, 550, (i === 2 ? '\u2248 ' : '') + o[2] + ' tokens for the full prompt', { size: 12, font: 'mono', color: o[1], parent: c });
            ctx.text(cx + 44, 626, 'attention cost ' + (i === 2 ? '1\u00d7' : ((o[2] / nt) * (o[2] / nt)).toFixed(1) + '\u00d7'), { size: 11, font: 'mono', color: o[1], parent: c });
            S.whyBars.push([b1, 410 * o[2] / nb, b2, 410 * Math.min(1, (o[2] / nb) * (o[2] / nb))]);
          });
          ctx.text(60, 722, 'full prompt: "' + FULL.slice(0, 84) + '\u2026"', { size: 13, font: 'mono', color: 'dim', parent: S.why });
          ctx.text(60, 748, nb + ' bytes \u00b7 ' + words + ' words \u00b7 \u2248 ' + nt + ' BPE tokens (\u2248 1.3 tokens / word)', { size: 12, font: 'mono', color: 'amber', parent: S.why });

          ctx.reveal(chars, { from: 'down', stagger: 18, dur: 300 });
          bytes.forEach(function (b) { b.setAttribute('opacity', 0); });
          S.toks.forEach(function (b) { b.setAttribute('opacity', 0); });
          ctx.reveal(S.why, { from: 'up', delay: 400 });
          return ctx.counter(S.cN, 0, txt.length, 900, function (v) { return Math.round(v) + ' chars'; }).then(function () {
            ctx.reveal(bytes, { from: 'down', stagger: 14, dur: 250 });
            return ctx.counter(S.bN, 0, nbytes(txt), 900, function (v) { return Math.round(v) + ' bytes'; });
          }).then(function () {
            ctx.reveal(S.toks, { from: 'down', stagger: 70, dur: 300 });
            return ctx.counter(S.tN, 0, LINE.length, 1000, function (v) { return Math.round(v) + ' tokens'; });
          }).then(function () {
            return Promise.all(S.whyBars.map(function (b, i) {
              return Promise.all([ctx.animate(b[0], { width: [0, b[1]] }, 700, 'out', i * 150), ctx.animate(b[2], { width: [0, b[3]] }, 700, 'out', 300 + i * 150)]);
            }));
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Pre-tokenization',
        say: 'Before any merging, a regular expression chops the text into pre-tokens. Words keep their leading space, so space fox and fox are different tokens. Punctuation is separated, and digits are split into groups of at most three, so nineteen twenty becomes one nine two, then zero. Merges are never allowed to cross these boundaries, which keeps tokens linguistically sane and makes the vocabulary far more efficient.',
        deep: '<p>Llama 3 uses the tiktoken <code>cl100k</code>-style split pattern (shown on the left, one alternative per line). Key effects:</p>' +
          '<ul><li><b>Leading space attaches to the word</b>: <code>" fox"</code> and <code>"fox"</code> are different ids; the model sees word starts explicitly.</li>' +
          '<li><b>Digits in groups of ≤ 3</b> (<code>\\p{N}{1,3}</code>): <code>1920</code> → <code>192</code>,<code>0</code>. More regular number handling than arbitrary merged digit strings; some models go further and split every digit.</li>' +
          '<li>One optional non-letter prefix: <code>-lands</code> is a single pre-token; BPE may still split it.</li>' +
          '<li><b>Byte fallback</b>: after pre-tokenization, every chunk is a byte string over a 256-symbol base alphabet, so encoding never fails (<code>冰</code> = <code>E5 86 B0</code>).</li></ul>' +
          '<div class="note">SentencePiece (Llama 2, Gemma) instead treats the input as a raw stream with <code>▁</code> marking spaces and no regex; tiktoken-style byte BPE (GPT-4, Llama 3) splits first, then merges.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.why, 400, true);
          /* pre-token boundaries on the byte rows */
          S.bounds = ctx.group();
          var x = BX;
          PRE.forEach(function (p, i) {
            x += nbytes(p) * BW;
            if (i < PRE.length - 1) ctx.rect(x - 1.5, 174, 3, 154, { rx: 1, fill: 'magenta', parent: S.bounds, glow: true });
          });
          ctx.text(1540, 350, 'magenta = pre-token cut', { size: 12, font: 'mono', color: 'magenta', anchor: 'end', parent: S.bounds });
          ctx.reveal(S.bounds, { delay: 300 });

          S.pre = ctx.group();
          var pat = [["(?i:'s|'t|'re|'ve|'m|'ll|'d)", 'contractions'], ['|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+', 'word + 1 prefix char'], ['|\\p{N}{1,3}', 'digits, groups <= 3'],
            ['| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*', 'punctuation runs'], ['|\\s*[\\r\\n]+', 'newlines'], ['|\\s+(?!\\S)', 'trailing spaces'], ['|\\s+', 'other whitespace']];
          var code = ctx.code({ x: 60, y: 388, w: 660, title: 'split pattern (cl100k / Llama 3)', lang: 'text', size: 12, color: 'magenta', parent: S.pre, lines: pat.map(function (p) {
            var s = p[0];
            while (s.length < 32) s += ' ';
            return s + '# ' + p[1];
          }) });
          keepWS(code);
          var c2 = card(ctx, S.pre, 760, 388, 780, 176, 'cyan', "PRE-TOKENIZE('30-second trailer at 1920x1080')");
          var ex = ['30', '-second', ' trailer', ' at', ' ', '192', '0', 'x', '108', '0'];
          var ex2 = [];
          var xx = 780;
          ex.forEach(function (p) {
            var col = /^[0-9]+$/.test(p) ? 'amber' : (p === ' ' ? 'dim' : 'cyan');
            var w = Math.max(26, p.length * 8.1 + 14);
            var g = ctx.group({ parent: c2 });
            ctx.rect(xx, 440, w, 30, { rx: 6, fill: ctx.alpha(col, 0.15), stroke: col, sw: 1.2, parent: g });
            ctx.text(xx + w / 2, 455.5, vis(p), { size: 13, font: 'mono', anchor: 'middle', color: 'white', parent: g });
            ex2.push(g);
            xx += w + 8;
          });
          ctx.text(780, 504, 'amber = \\p{N}{1,3} digit groups   cyan = words with prefix', { size: 12, font: 'mono', color: 'dim', parent: c2 });
          ctx.text(780, 528, 'note: the space before 1920 is its own pre-token', { size: 12, font: 'mono', color: 'dim', parent: c2 });
          var c3 = card(ctx, S.pre, 60, 598, 1480, 272, 'violet', 'BYTE FALLBACK \u00b7 nothing is ever out-of-vocabulary');
          ctx.para(80, 648, ['base alphabet = 256 byte tokens  \u2192  any UTF-8 string encodes', 'merges learned on top: "\u00b7fox" is 1 token, a typo like "\u00b7foxx" becomes "\u00b7fox" + "x"', '\u51b0 = E5 86 B0: one token if the merge exists, else 3 byte tokens', 'decode must buffer: a token can end mid-character (stream carefully)', 'leading space is part of the token: "\u00b7fox" \u2260 "fox" \u2260 "\u00b7Fox"'], { size: 14, font: 'mono', color: 'text', lh: 38, parent: c3 });
          ctx.reveal(S.pre, { from: 'up', delay: 200 });
          ex2.forEach(function (e) { e.setAttribute('opacity', 0); });
          return ctx.wait(900).then(function () {
            return ctx.reveal(ex2, { from: 'down', stagger: 110, dur: 300 });
          }).then(function () {
            return ctx.pulse(S.toks[4], { color: 'magenta', dur: 600 });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Training BPE',
        say: 'How is the vocabulary learned? Byte pair encoding is a greedy compression algorithm. Start with single symbols, count every adjacent pair across the corpus weighted by word frequency, merge the most frequent pair into a new symbol, and repeat. Here e and s merge first, then e s and t form est, then l and o, then low, then n e and new. A production tokenizer runs this for over a hundred thousand merges on a large sample of the training corpus.',
        deep: '<pre>vocab  = 256 byte symbols\nmerges = []\nwhile len(vocab) &lt; V:\n  counts = Σ_w freq(w)·pairs(w)\n  a, b = argmax(counts)\n  merges.append((a, b))  # rank\n  replace a,b → ab everywhere\n  vocab.add(ab)</pre>' +
          '<p>Toy corpus (Sennrich et al.): <code>low×5, lower×2, newest×6, widest×3</code>. First merges: <code>e s</code> (9), <code>es t</code> (9), <code>l o</code> (7), <code>lo w</code> (7), <code>n e</code> (6), <code>ne w</code> (6).</p>' +
          '<ul><li>Real training: pre-tokenized text, pair counts over unique pre-tokens × frequency, incremental count updates with a priority queue: O(N log N) instead of recounting.</li>' +
          '<li>Vocabulary size is a hyper-parameter: 32k (Llama 2) → 128,256 (Llama 3) → 200k (o200k) → 262k (Gemma 3). Bigger V shortens sequences but costs V·d embedding parameters and a bigger softmax.</li>' +
          '<li>Alternatives: <b>Unigram LM</b> (SentencePiece), tokenizer-free byte models (e.g. Byte Latent Transformer with entropy-based patches).</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut([S.top, S.bounds], 400, true);
          ctx.fadeOut(S.pre, 400, true);
          S.bpe = ctx.group();
          S.corpus = [{ n: 5, s: ['l', 'o', 'w'] }, { n: 2, s: ['l', 'o', 'w', 'e', 'r'] }, { n: 6, s: ['n', 'e', 'w', 'e', 's', 't'] }, { n: 3, s: ['w', 'i', 'd', 'e', 's', 't'] }];
          var c1 = card(ctx, S.bpe, 60, 180, 700, 320, 'amber', 'TOY CORPUS  word \u00d7 frequency');
          var c2 = card(ctx, S.bpe, 800, 180, 740, 320, 'magenta', 'ADJACENT PAIR COUNTS (weighted)');
          var c3 = card(ctx, S.bpe, 60, 530, 700, 340, 'lime', 'MERGE RULES  (rank = order learned)');
          var c4 = card(ctx, S.bpe, 800, 530, 740, 340, 'cyan', 'ALGORITHM');
          S.rowG = ctx.group({ parent: c1 });
          S.rowY = [240, 305, 370, 435];
          S.corpus.forEach(function (wd, i) { ctx.text(90, S.rowY[i], '\u00d7' + wd.n, { size: 15, font: 'mono', weight: 700, color: 'amber', parent: c1 }); });
          S.pairG = ctx.group({ parent: c2 });
          S.mergeList = ctx.group({ parent: c3 });
          S.vocabTxt = ctx.text(80, 846, 'vocab = 256 bytes + 0 merges', { size: 13, font: 'mono', color: 'lime', parent: c3 });
          var code = ctx.code({ x: 820, y: 570, w: 700, lang: 'py', size: 14, color: 'cyan', parent: c4, title: 'bpe_train.py', lines: [
            'vocab = set(range(256))            # byte symbols',
            'while len(vocab) < V:              # e.g. 128,000',
            '    counts = pair_counts(corpus)   # weighted',
            '    a, b = argmax(counts)',
            '    merges.append((a, b))          # rank = index',
            '    corpus = replace(corpus, a, b, a + b)',
            '    vocab.add(a + b)'
          ] });
          keepWS(code);
          S.nMerges = 0;
          function drawRows(hotPair, newSym) {
            while (S.rowG.firstChild) S.rowG.removeChild(S.rowG.firstChild);
            S.corpus.forEach(function (wd, i) {
              var x = 150;
              for (var k = 0; k < wd.s.length; k++) {
                var isHotPair = hotPair && k < wd.s.length - 1 && (wd.s[k] + ' ' + wd.s[k + 1]) === hotPair;
                if (isHotPair) {
                  var a = sym(ctx, S.rowG, x, S.rowY[i], wd.s[k], 'magenta', true); x += a.w + 5;
                  var b = sym(ctx, S.rowG, x, S.rowY[i], wd.s[k + 1], 'magenta', true); x += b.w + 8;
                  k++;
                } else {
                  var g = sym(ctx, S.rowG, x, S.rowY[i], wd.s[k], newSym === wd.s[k] ? 'lime' : 'amber', newSym === wd.s[k]);
                  x += g.w + 8;
                }
              }
            });
          }
          function drawPairs(top) {
            while (S.pairG.firstChild) S.pairG.removeChild(S.pairG.firstChild);
            top.forEach(function (p, i) {
              var y = 232 + i * 42;
              ctx.text(930, y, p[0], { size: 14, font: 'mono', anchor: 'end', color: i === 0 ? 'white' : 'text', parent: S.pairG });
              ctx.rect(945, y - 11, 520 * p[1] / 9, 22, { rx: 3, fill: ctx.alpha('magenta', i === 0 ? 0.6 : 0.25), stroke: 'magenta', sw: 1, parent: S.pairG });
              ctx.text(952 + 520 * p[1] / 9, y, String(p[1]), { size: 12, font: 'mono', color: 'magenta', parent: S.pairG });
            });
          }
          drawRows(null, null);
          drawPairs(countPairs(S.corpus).top);
          ctx.reveal(S.bpe, { from: 'up' });
          function oneMerge() {
            var cp = countPairs(S.corpus), best = cp.best;
            drawPairs(cp.top);
            drawRows(best[0], null);
            return ctx.wait(650).then(function () {
              applyMerge(S.corpus, best[0]);
              var ns = best[0].replace(' ', '');
              drawRows(null, ns);
              S.nMerges++;
              var y = 580 + (S.nMerges - 1) * 40;
              var row = ctx.group({ parent: S.mergeList });
              ctx.text(84, y, S.nMerges + '.', { size: 14, font: 'mono', color: 'dim', parent: row });
              ctx.text(120, y, best[0] + '  \u2192  ' + ns, { size: 15, font: 'mono', color: 'white', parent: row });
              ctx.text(380, y, 'count ' + best[1], { size: 12, font: 'mono', color: 'lime', parent: row });
              ctx.reveal(row, { from: 'left', dur: 300 });
              S.vocabTxt.textContent = 'vocab = 256 bytes + ' + S.nMerges + ' merges';
              return ctx.wait(450);
            });
          }
          var chain = ctx.wait(700);
          for (var m = 0; m < 6; m++) chain = chain.then(oneMerge);
          return chain.then(function () { drawPairs(countPairs(S.corpus).top); });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Encoding',
        say: 'Encoding new text replays the learned merges in rank order. Take a word the toy corpus never contained: lowest. Split it into symbols, apply rule one, e s, then rule two, es t, then l o, then lo w. It ends as two tokens, low and est, both learned pieces. The real tokenizer does exactly this on our prompt line: twelve tokens for nine words. Each token then maps to an integer id, the only thing the model ever sees.',
        deep: '<p>Encoding a pre-token: repeatedly find the adjacent pair with the <b>lowest merge rank</b> and merge it, until no pair is in the merge table.</p>' +
          '<pre>def encode_chunk(sym):\n  while len(sym) &gt; 1:\n    r, i = min((rank.get(p, ∞), i)\n               for i, p in pairs(sym))\n    if r == ∞: break\n    sym[i:i+2] = [sym[i] + sym[i+1]]\n  return [ids[s] for s in sym]</pre>' +
          '<p>Production encoders (tiktoken in Rust, HF tokenizers) cache pre-token results; throughput is tens of MB/s per core, negligible next to the model.</p>' +
          '<ul><li><b>Rates</b>: ≈ 1.3 tokens per English word at 128k; Meta reports Llama 3\'s tokenizer yields up to 15% fewer tokens than Llama 2\'s.</li>' +
          '<li><b>Artifacts</b>: tokens that were frequent in tokenizer training but rare in model training stay undertrained ("glitch tokens"); letter counting and spelling are hard because the model sees ids, not characters.</li></ul>' +
          '<p class="muted">ids for <code>A</code>, <code>-</code>, <code> on</code>, <code> a</code>, <code>.</code> match cl100k/Llama 3; the others are illustrative.</p>',
        run: function (ctx) {
          var S = ctx.state;
          /* keep the merge table; replace the rest */
          var kids = Array.prototype.slice.call(S.bpe.childNodes);
          ctx.fadeOut([kids[0], kids[1], kids[3]], 400, true);
          S.enc = ctx.group();
          var c1 = card(ctx, S.enc, 60, 180, 700, 330, 'lime', 'ENCODE UNSEEN WORD "lowest" \u00b7 rank order');
          var steps = [[['l', 'o', 'w', 'e', 's', 't'], ''], [['l', 'o', 'w', 'es', 't'], 'rule 1: e s'], [['l', 'o', 'w', 'est'], 'rule 2: es t'], [['lo', 'w', 'est'], 'rule 3: l o'], [['low', 'est'], 'rule 4: lo w']];
          S.ladder = steps.map(function (st, i) {
            var g = ctx.group({ parent: c1 }), x = 90, y = 244 + i * 54;
            st[0].forEach(function (s) { var b = sym(ctx, g, x, y, s, i === 4 ? 'lime' : 'amber', i === 4); x += b.w + 8; });
            if (st[1]) ctx.text(480, y, st[1], { size: 13, font: 'mono', color: 'lime', parent: g });
            if (i === 4) ctx.text(600, y, '\u2192 2 tokens', { size: 13, font: 'mono', weight: 700, color: 'white', parent: g });
            return g;
          });
          var code = ctx.code({ x: 800, y: 180, w: 740, lang: 'py', size: 13, color: 'amber', parent: S.enc, title: 'python   (ids partly illustrative, see panel)', typing: true, lines: [
            '>>> ids = tok.encode("A fox astronaut crash-lands on a glowing ice moon.")',
            '>>> len(ids)          # 9 words -> 12 tokens (1.33 per word)',
            '12',
            '>>> ids',
            '[32, 39935, 47733, 10121, 12, 7520, 389, 264, 49592, 10054, 18266, 13]',
            '>>> [tok.decode([i]) for i in ids[:4]]',
            "['A', ' fox', ' astronaut', ' crash']"
          ] });
          keepWS(code);
          var c3 = card(ctx, S.enc, 800, 400, 740, 470, 'orange', 'VOCABULARY SIZE IS A TRADE-OFF');
          ctx.para(820, 462, ['bigger V  \u2192  shorter T  \u2192  fewer FLOPs per text,', '             more text fits in the context', 'bigger V  \u2192  V\u00b7d embedding + unembedding params,', '             bigger softmax, rarer tokens', '             under-trained ("glitch tokens")', 'ids, not letters: spelling and counting', 'the r\'s in "strawberry" is genuinely hard'], { size: 15, font: 'mono', color: 'text', lh: 44, parent: c3 });
          keepWS(c3);
          S.ladder.forEach(function (g) { g.setAttribute('opacity', 0); });
          ctx.reveal(S.enc, { from: 'up' });
          var chain = ctx.wait(500);
          S.ladder.forEach(function (g, i) {
            chain = chain.then(function () { return ctx.reveal(g, { from: 'down', dur: 380 }).then(function () { return ctx.wait(220); }); });
          });
          return chain.then(function () { return code.typeAll(); });
        }
      },
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Special tokens',
        say: 'Some tokens are not text at all. Special tokens mark structure: begin of text, the start and end of each role header, end of turn, and a tag that announces a tool call. The chat template wraps every message of our director agent in these markers, and the model learned during fine tuning what each one means. They are reserved ids that user or tool text can never produce, so a pasted document cannot forge a role switch. That is one line of defence against prompt injection, not a complete one.',
        deep: nolig('<p>A <b>chat template</b> is a deterministic serialisation of a list of messages into one token stream. Llama 3 format:</p>' +
          '<pre>&lt;|begin_of_text|&gt;\n&lt;|start_header_id|&gt;system\n&lt;|end_header_id|&gt;\\n\\n\n{system}&lt;|eot_id|&gt;\n&lt;|start_header_id|&gt;user\n&lt;|end_header_id|&gt;\\n\\n\n{prompt}&lt;|eot_id|&gt;\n&lt;|start_header_id|&gt;assistant\n&lt;|end_header_id|&gt;\\n\\n</pre>' +
          '<p class="muted">(line breaks added for display; the real stream has none between special tokens)</p>' +
          '<ul><li>Generation stops when the model emits <code>&lt;|eot_id|&gt;</code> (128009) — a <i>learned</i> stop signal.</li>' +
          '<li>Tool calls: Llama 3.1 emits a JSON function call (or <code>&lt;|python_tag|&gt;</code> … <code>&lt;|eom_id|&gt;</code> for built-in tools); results return in an <code>ipython</code> role. Other families use <code>&lt;tool_call&gt;</code> tags or structured content blocks.</li>' +
          '<li><b>Security</b>: user and tool text is encoded with special tokens <i>disallowed</i>, so a document containing the literal string <code>&lt;|eot_id|&gt;</code> becomes ordinary text tokens, not a role switch.</li>' +
          '<li>Template mismatches (a missing newline, wrong role header) measurably degrade instruction following.</li></ul>'),
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut([S.bpe, S.enc], 400, true);
          S.sp = ctx.group();
          var c1 = card(ctx, S.sp, 60, 180, 960, 300, 'magenta', 'CHAT TEMPLATE \u00b7 director agent turn (Llama 3 format)');
          var lines = [
            '<|begin_of_text|><|start_header_id|>system<|end_header_id|>\u23ce\u23ce',
            'You are the Director agent. Tools: render_shot, search_assets.<|eot_id|>',
            '<|start_header_id|>user<|end_header_id|>\u23ce\u23ce',
            '30-second trailer: fox astronaut, glowing ice moon.<|eot_id|>',
            '<|start_header_id|>assistant<|end_header_id|>\u23ce\u23ce',
            '{"name": "search_assets", "parameters": {"query": "fox sketch"}}<|eot_id|>'
          ];
          S.tplLines = lines.map(function (ln, i) {
            var t = ctx.text(80, 230 + i * 38, '', { size: 13, font: 'mono', color: 'text', parent: c1 });
            t.style.fontVariantLigatures = 'none';
            ln.split(/(<\|[a-z_]+\|>)/).forEach(function (part) {
              if (!part) return;
              var sp = ctx.el('tspan', /^<\|/.test(part) ? { fill: ctx.C.magenta, 'font-weight': 700 } : {}, t);
              sp.textContent = part;
            });
            return t;
          });
          var c2 = card(ctx, S.sp, 1060, 180, 480, 300, 'magenta', 'RESERVED IDS (Llama 3)');
          var ids = [['<|begin_of_text|>', 128000], ['<|end_of_text|>', 128001], ['<|start_header_id|>', 128006], ['<|end_header_id|>', 128007], ['<|eom_id|>', 128008], ['<|eot_id|>', 128009], ['<|python_tag|>', 128010]];
          ids.forEach(function (r, i) {
            var y = 226 + i * 34;
            ctx.text(1080, y, r[0], { size: 13, font: 'mono', color: 'magenta', parent: c2 }).style.fontVariantLigatures = 'none';
            ctx.text(1520, y, String(r[1]), { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: c2 });
          });
          var c3 = card(ctx, S.sp, 60, 510, 1480, 360, 'amber', 'VOCABULARY SIZES (n_vocab)');
          var vs = [['Llama 2 (SentencePiece)', 32000], ['GPT-2 (byte BPE)', 50257], ['GPT-4 cl100k_base', 100277], ['Llama 3 / 3.1', 128256], ['DeepSeek-V3', 129280], ['Qwen2.5', 151665], ['GPT-4o o200k_base', 200019], ['Gemma 3', 262144, '≈ 262k']];
          S.vBars = vs.map(function (v, i) {
            var y = 556 + i * 38;
            ctx.text(420, y, v[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: c3 });
            var b = ctx.rect(436, y - 12, 0, 24, { rx: 3, fill: ctx.alpha(v[0].indexOf('Llama 3') === 0 ? 'amber' : 'orange', v[0].indexOf('Llama 3') === 0 ? 0.7 : 0.35), stroke: 'amber', sw: 1, parent: c3 });
            ctx.text(436 + 960 * v[1] / 262144 + 8, y, v[2] || v[1].toLocaleString('en-US'), { size: 12, font: 'mono', color: 'amber', parent: c3 });
            return [b, 960 * v[1] / 262144];
          });
          ctx.reveal(S.sp, { from: 'up' });
          S.tplLines.forEach(function (t) { t.setAttribute('opacity', 0); });
          var chain = ctx.wait(400);
          S.tplLines.forEach(function (t) { chain = chain.then(function () { return ctx.reveal(t, { from: 'left', dur: 300 }); }); });
          return chain.then(function () {
            return Promise.all(S.vBars.map(function (b, i) { return ctx.animate(b[0], { width: [0, b[1]] }, 600, 'out', i * 90); }));
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Embedding lookup',
        say: 'Now ids become vectors. Formally, the id is a one hot vector of length one hundred twenty eight thousand, multiplied by the embedding matrix. The product simply selects one row. So the implementation is a gather: copy sixteen kilobytes for each token. That table holds over a billion parameters for a seventy billion model. Small models often tie it to the output layer, reusing the same matrix transposed to turn the final vector back into logits.',
        deep: '<div class="eq">e = onehot(id)ᵀ E = E[id, :] &nbsp;&nbsp; E ∈ ℝ<sup>V×d</sup></div>' +
          '<table><tr><th>Model</th><th>V × d</th><th>params</th><th>share</th></tr>' +
          '<tr><td>Llama 3 70B (untied)</td><td>128,256 × 8,192</td><td>2 × 1.05 B</td><td>3%</td></tr>' +
          '<tr><td>Llama 3 8B (untied)</td><td>128,256 × 4,096</td><td>2 × 0.53 B</td><td>13%</td></tr>' +
          '<tr><td>Llama 3.2 1B (tied)</td><td>128,256 × 2,048</td><td>0.26 B</td><td>21%</td></tr></table>' +
          '<ul><li><b>Cost</b>: a gather moves d × 2 bytes = 16 KiB per token (BF16, d = 8,192); no FLOPs.</li>' +
          '<li><b>Gradient</b>: ∂L/∂E is non-zero only on rows present in the batch → sparse updates; with tensor parallelism E is sharded along V (vocab-parallel embedding + all-reduce).</li>' +
          '<li><b>Tying</b> W<sub>U</sub> = Eᵀ (Press &amp; Wolf 2017) saves V·d params — decisive at 1B scale, negligible at 70B, and it forces input and output geometry to agree.</li>' +
          '<li>Some models scale embeddings by √d (Gemma) to match residual-stream magnitudes.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.sp, 400, true);
          S.emb = ctx.group();
          ctx.text(60, 186, 'EMBEDDING LOOKUP   onehot(id)\u1d40 \u00b7 E  =  E[id]', { size: 16, font: 'display', weight: 700, color: 'amber', parent: S.emb });
          /* one-hot as a column aligned with E rows */
          var R = 18, cell = 18, gap = 3, oy = 230;
          var hotRow = 11;
          ctx.text(130, 218, 'onehot', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.emb });
          var oh = ctx.matrix(121, oy, R, 1, { cell: cell, gap: gap, cmap: 'cyan', values: function (r) { return r === hotRow ? 1 : 0.04; }, stroke: ctx.alpha('cyan', 0.35), parent: S.emb });
          ctx.text(130, oy + R * (cell + gap) + 16, 'V entries', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.emb });
          ctx.text(165, oy + hotRow * (cell + gap) + cell / 2, '\u00b7fox  id 39935', { size: 12, font: 'mono', color: 'cyan', parent: S.emb });
          var r = ctx.rng(4);
          S.E = ctx.matrix(300, oy, R, 16, { cell: cell, gap: gap, cmap: 'diverge', values: function () { return (r() * 2 - 1) * 0.75; }, parent: S.emb });
          ctx.text(300 + S.E.w / 2, 218, 'E   V = 128,256 rows \u00d7 d = 8,192', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: S.emb });
          ctx.text(300 + S.E.w / 2, oy + R * (cell + gap) + 16, 'rows shown: 18 of 128,256 \u00b7 cols: 16 of 8,192', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.emb });
          S.sel = ctx.rect(296, oy + hotRow * (cell + gap) - 4, S.E.w + 8, cell + 8, { rx: 5, stroke: 'white', sw: 2, glow: true, parent: S.emb });
          S.outV = ctx.matrix(300, 690, 1, 16, { cell: cell, gap: gap, cmap: 'gray', values: function () { return 0.06; }, parent: S.emb });
          ctx.text(290, 699, 'e =', { size: 14, font: 'mono', color: 'white', anchor: 'end', parent: S.emb });
          ctx.text(300 + S.E.w / 2, 734, 'e \u2208 \u211d^8192 \u2192 first residual-stream vector for "\u00b7fox"', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: S.emb });
          ctx.text(300, 780, 'dense matmul would cost 2\u00b7V\u00b7d = 2.1 GFLOP per token', { size: 12, font: 'mono', color: 'dim', parent: S.emb });
          ctx.text(300, 802, 'gather costs 0 FLOPs, 16 KiB of HBM reads', { size: 12, font: 'mono', color: 'lime', parent: S.emb });

          /* tied vs untied */
          var c = card(ctx, S.emb, 820, 200, 720, 330, 'violet', 'TIED vs UNTIED OUTPUT');
          function mini(x, y, lab, col, t) {
            var g = ctx.group({ parent: c });
            ctx.rect(x, y, 70, 120, { rx: 4, fill: ctx.alpha(col, 0.18), stroke: col, sw: 1.2, parent: g });
            ctx.text(x + 35, y + 60, lab, { size: 14, font: 'mono', color: 'white', anchor: 'middle', parent: g });
            ctx.text(x + 35, y + 138, t, { size: 11, font: 'mono', color: col, anchor: 'middle', parent: g });
            return g;
          }
          ctx.text(850, 250, 'tied (Llama 3.2 1B, Gemma)', { size: 12, font: 'mono', color: 'violet', parent: c });
          mini(860, 280, 'E', 'amber', 'input');
          ctx.path('M940,340 C980,300 1000,300 1030,340', { stroke: 'violet', sw: 1.5, dash: '4 4', arrow: true, parent: c });
          mini(1040, 280, 'E\u1d40', 'amber', 'output (shared)');
          ctx.text(1180, 250, 'untied (Llama 3 8B/70B)', { size: 12, font: 'mono', color: 'violet', parent: c });
          mini(1190, 280, 'E', 'amber', 'input');
          mini(1300, 280, 'W_U', 'orange', 'output (own)');
          ctx.text(840, 476, 'tying saves V\u00b7d params: 21% of a 1B model,', { size: 12, font: 'mono', color: 'text', parent: c });
          ctx.text(840, 498, '1.5% of a 70B model \u2192 big models untie', { size: 12, font: 'mono', color: 'text', parent: c });
          var c2 = card(ctx, S.emb, 820, 560, 720, 310, 'amber', 'SIZE OF THE TABLE');
          S.sizeTxt = ctx.text(840, 626, '', { size: 26, font: 'mono', weight: 700, color: 'amber', parent: c2 });
          ctx.para(840, 676, ['= 128,256 \u00d7 8,192 parameters', '= 2.1 GB in BF16 (another 2.1 GB for W_U)', 'sharded along V under tensor parallelism', 'grad is row-sparse: only seen ids update'], { size: 13, font: 'mono', color: 'text', lh: 30, parent: c2 });
          ctx.reveal(S.emb, { from: 'up' });
          S.sel.setAttribute('opacity', 0);
          var rowVals = S.E.cells[hotRow].map(function (el) { return el.getAttribute('fill'); });
          return ctx.wait(700).then(function () {
            ctx.pulse(oh.cells[hotRow][0], { color: 'cyan', dur: 600 });
            return ctx.reveal(S.sel, { dur: 400 });
          }).then(function () {
            var fly = ctx.group({ parent: S.emb });
            rowVals.forEach(function (f, k) { ctx.rect(300 + k * (cell + gap), oy + hotRow * (cell + gap), cell, cell, { rx: 3, fill: f, parent: fly }); });
            return ctx.transform(fly, { y: 690 - (oy + hotRow * (cell + gap)) }, 800, 'inOut').then(function () {
              if (fly.parentNode) fly.parentNode.removeChild(fly);
              S.outV.cells[0].forEach(function (el, k) { el.setAttribute('fill', rowVals[k]); });
            });
          }).then(function () {
            return ctx.counter(S.sizeTxt, 0, 1050673152, 1200);
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Geometry of meaning',
        say: 'Training arranges these vectors so that geometry carries meaning. Related tokens point in similar directions, measured by cosine similarity: fox sits near wolf, moon near planet, ice near snow. Directions encode features. The classic example is king minus man plus woman landing near queen. In large models this becomes the linear representation hypothesis: concepts like cold, or space travel, or the fox character correspond to directions in the residual stream that later layers read out.',
        deep: '<div class="eq">cos(u, v) = u·v / (‖u‖ ‖v‖)</div>' +
          '<p>The 2-D map is an illustrative projection; real embeddings live in 4k–16k dimensions where random vectors are nearly orthogonal (cos ≈ 0 ± 1/√d).</p>' +
          '<ul><li><b>Analogies</b>: <code>v(king) − v(man) + v(woman) ≈ v(queen)</code> holds approximately in word2vec-style spaces (nearest neighbour excluding the inputs).</li>' +
          '<li><b>Linear representation hypothesis</b>: high-level concepts are directions; linear probes recover them, and adding a direction (activation steering) changes behaviour predictably.</li>' +
          '<li><b>Anisotropy</b>: raw LLM embeddings share a common mean direction and a few massive outlier dimensions, so raw cosine is inflated; centring or whitening helps retrieval.</li>' +
          '<li>Input embeddings are only layer 0: meaning is refined along the residual stream; contextual vectors for "moon" after "ice" differ from "moon" after "honey".</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.emb, 400, true);
          S.geo = ctx.group();
          var P = { x: 60, y: 180, w: 900, h: 690 };
          ctx.rect(P.x, P.y, P.w, P.h, { rx: 12, fill: 'rgba(8,14,28,0.9)', stroke: ctx.alpha('amber', 0.4), parent: S.geo });
          ctx.text(P.x + 16, P.y + 22, 'EMBEDDING SPACE  (2-D projection, illustrative)', { size: 13, font: 'mono', weight: 700, color: 'amber', parent: S.geo, spacing: 1 });
          var O = { x: 420, y: 540 };
          ctx.line(P.x + 20, O.y, P.x + P.w - 20, O.y, { color: ctx.alpha('white', 0.08), parent: S.geo });
          ctx.line(O.x, P.y + 40, O.x, P.y + P.h - 20, { color: ctx.alpha('white', 0.08), parent: S.geo });
          var pts = {
            fox: [-230, -150, 'orange'], wolf: [-290, -60, 'orange'], cat: [-160, -60, 'orange'],
            moon: [200, -250, 'cyan'], planet: [250, -210, 'cyan'], astronaut: [150, -290, 'cyan'], rocket: [270, -280, 'cyan'],
            ice: [-60, 170, 'teal'], snow: [-20, 210, 'teal'], frost: [-110, 200, 'teal']
          };
          S.pt = {};
          var dots = Object.keys(pts).map(function (k) {
            var p = pts[k], g = ctx.group({ parent: S.geo });
            ctx.circle(O.x + p[0], O.y + p[1], 6, { fill: p[2], parent: g, glow: true });
            ctx.text(O.x + p[0] + 10, O.y + p[1] - 10, k, { size: 13, font: 'mono', color: p[2], parent: g });
            S.pt[k] = { x: O.x + p[0], y: O.y + p[1] };
            return g;
          });
          /* cosine arcs from fox */
          S.vecs = ctx.group({ parent: S.geo });
          var vf = ctx.line(O.x, O.y, S.pt.fox.x, S.pt.fox.y, { color: 'orange', sw: 2, arrow: true, parent: S.vecs });
          var vw = ctx.line(O.x, O.y, S.pt.wolf.x, S.pt.wolf.y, { color: ctx.alpha('orange', 0.6), sw: 1.5, arrow: true, parent: S.vecs });
          var vm = ctx.line(O.x, O.y, S.pt.moon.x, S.pt.moon.y, { color: ctx.alpha('cyan', 0.6), sw: 1.5, arrow: true, parent: S.vecs });
          function cosv(a, b) { var ax = a.x - O.x, ay = a.y - O.y, bx = b.x - O.x, by = b.y - O.y; return (ax * bx + ay * by) / Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by)); }
          ctx.label(S.pt.wolf.x + 30, S.pt.wolf.y + 46, 'cos(fox, wolf) = ' + cosv(S.pt.fox, S.pt.wolf).toFixed(2), { color: 'orange', size: 11, parent: S.vecs });
          ctx.label(610, 470, 'cos(fox, moon) = ' + cosv(S.pt.fox, S.pt.moon).toFixed(2), { color: 'cyan', size: 11, parent: S.vecs });

          /* analogy parallelogram in its own corner */
          S.ana = ctx.group({ parent: S.geo });
          var A = { man: { x: 640, y: 700 }, king: { x: 700, y: 610 }, woman: { x: 800, y: 740 } };
          A.queen = { x: A.king.x + (A.woman.x - A.man.x) + 6, y: A.king.y + (A.woman.y - A.man.y) - 5 };
          Object.keys(A).forEach(function (k) {
            ctx.circle(A[k].x, A[k].y, 5, { fill: 'violet', parent: S.ana, glow: true });
            ctx.text(A[k].x + 9, A[k].y + (k === 'woman' ? 16 : -10), k, { size: 13, font: 'mono', color: 'violet', parent: S.ana });
          });
          ctx.line(A.man.x, A.man.y, A.king.x, A.king.y, { color: ctx.alpha('violet', 0.35), sw: 1, dash: '2 4', parent: S.ana });
          ctx.line(A.woman.x, A.woman.y, A.queen.x, A.queen.y, { color: ctx.alpha('violet', 0.35), sw: 1, dash: '2 4', parent: S.ana });
          S.a1 = ctx.line(A.man.x, A.man.y, A.woman.x, A.woman.y, { color: 'violet', sw: 1.8, arrow: true, parent: S.ana });
          S.a2 = ctx.line(A.king.x, A.king.y, A.queen.x - 3, A.queen.y + 2, { color: 'pink', sw: 1.8, arrow: true, dash: '5 4', parent: S.ana });
          ctx.text(600, 800, 'king \u2212 man + woman \u2248 queen', { size: 13, font: 'mono', weight: 700, color: 'pink', parent: S.ana });
          ctx.text(600, 822, 'same "gender" offset, reused', { size: 11, font: 'mono', color: 'dim', parent: S.ana });

          var c = card(ctx, S.geo, 1000, 180, 540, 690, 'amber', 'DIRECTIONS = FEATURES');
          ctx.para(1020, 232, ['cos(u,v) = u\u00b7v / (|u| |v|)', '', 'similar usage \u2192 similar direction', 'clusters: animals \u00b7 space \u00b7 cold', '', 'linear representation hypothesis:', ' concept c \u2194 direction r_c', ' probe:  sign(r_c \u00b7 h)', ' steer:  h \u2190 h + \u03b1 r_c', '', 'in d = 8,192 dims, random vectors', 'have |cos| \u2248 1/\u221ad \u2248 0.011', '\u2192 room for many near-orthogonal', '  directions (see superposition)'], { size: 14, font: 'mono', color: 'text', lh: 30, parent: c });
          keepWS(c);
          ctx.reveal(S.geo, { from: 'fade' });
          dots.forEach(function (d) { d.setAttribute('opacity', 0); });
          [S.vecs, S.ana].forEach(function (g) { g.setAttribute('opacity', 0); });
          return ctx.reveal(dots, { from: 'scale', stagger: 80 }).then(function () {
            ctx.reveal(S.vecs, {});
            ctx.reveal([vf, vw, vm], { from: 'draw', stagger: 200 });
            return ctx.wait(1200);
          }).then(function () {
            S.ana.setAttribute('opacity', 1);
            ctx.reveal(S.ana, {});
            return ctx.reveal([S.a1, S.a2], { from: 'draw', stagger: 500, dur: 700 });
          }).then(function () {
            return ctx.camera(720, 700, 1.7, 900).then(function () { return ctx.wait(1300); }).then(function () { return ctx.camera(null, null, null, 800); });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'One sequence, all modes',
        say: 'Two last ideas. First, superposition: a model must represent far more features than it has dimensions, so it packs them as almost orthogonal directions, like five features squeezed into two dimensions, tolerating a little interference because each feature is rarely active. Second, the sequence is not only text. The director sees the prompt, then hundreds of tokens for each style sketch, projected from a vision encoder, then the voice memo as audio tokens. After embedding, they are all just rows of the same matrix.',
        deep: nolig('<p><b>Superposition</b> (Elhage et al. 2022): with sparse features, a layer of width d can store n ≫ d features as nearly orthogonal directions; readout via ReLU/thresholding suppresses interference. In the toy model, 5 features in 2-D form a pentagon. This is why individual neurons are <i>polysemantic</i> — see the Neuron chamber and sparse autoencoders.</p>' +
          '<p><b>Multimodal tokens</b> share the sequence:</p>' +
          '<ul><li><b>Images</b>: ViT patches (14 px) → 2×2 merge → MLP projector into ℝ<sup>d</sup>. A 448×448 sketch → 32×32 patches → <b>256 tokens</b> (Qwen2-VL-style).</li>' +
          '<li><b>Audio</b>: Whisper-style encoder at 50 frames/s, pooled 2× → <b>25 tokens/s</b>; a 42 s memo ≈ 1,050 tokens.</li>' +
          '<li>Placeholders such as <code>&lt;|image_pad|&gt;</code> reserve positions; the embedding gather is replaced by encoder outputs at those positions (multimodal RoPE assigns 2-D/temporal positions).</li></ul>' +
          '<div class="eq">X = [E[text ids] ; P<sub>img</sub>(ViT(sketch)) ; P<sub>aud</sub>(Enc(memo)) ; …] ∈ ℝ<sup>T×d</sup></div>'),
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.geo, 400, true);
          S.mm = ctx.group();
          ctx.text(60, 186, 'THE DIRECTOR\'S INPUT SEQUENCE   one matrix X \u2208 \u211d^(T\u00d7d)', { size: 16, font: 'display', weight: 700, color: 'violet', parent: S.mm });
          var segs = [['system + tools', 1200, 'amber'], ['prompt', 34, 'cyan'], ['sketch 1', 256, 'violet'], ['sketch 2', 256, 'violet'], ['sketch 3', 256, 'violet'], ['voice memo 42 s', 1050, 'orange'], ['text', 60, 'cyan']];
          var tot = segs.reduce(function (a, s) { return a + s[1]; }, 0);
          var x = 60, W = 1480;
          S.segEls = segs.map(function (s, i) {
            var w = Math.max(10, W * s[1] / tot);
            var g = ctx.group({ parent: S.mm });
            ctx.rect(x, 214, w - 3, 44, { rx: 5, fill: ctx.alpha(s[2], 0.28), stroke: s[2], sw: 1.2, parent: g });
            var small = w < 90;
            ctx.text(small ? x + w / 2 : x + 10, small ? 276 + (i % 2) * 18 : 236, s[0] + (small ? '' : '  ' + s[1]), { size: 12, font: 'mono', color: small ? s[2] : 'white', anchor: small ? 'middle' : 'start', parent: g });
            x += w;
            return g;
          });
          ctx.text(1540, 316, 'T \u2248 ' + tot.toLocaleString('en-US') + ' positions', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: S.mm });

          /* modality paths into d-dim rows */
          var c = card(ctx, S.mm, 60, 340, 900, 530, 'violet', 'EVERY MODALITY BECOMES ROWS OF X');
          var rows = [['"\u00b7fox"', 'gather E[id]', 'amber', 'lookup'], ['sketch 1', 'ViT 14px + 2\u00d72 merge', 'violet', 'MLP projector'], ['memo 0.04 s', 'Whisper-style enc.', 'orange', 'MLP projector']];
          S.mRows = rows.map(function (rw, i) {
            var y = 420 + i * 140, g = ctx.group({ parent: c });
            ctx.label(150, y, rw[0], { color: rw[2], size: 13, w: 150, parent: g });
            var n1 = ctx.node({ x: 380, y: y, w: 200, h: 52, title: rw[1], color: rw[2], titleSize: 12, parent: g, glow: false });
            var n2 = ctx.node({ x: 580, y: y, w: 130, h: 44, title: rw[3], color: rw[2], titleSize: 12, parent: g, glow: false });
            ctx.line(226, y, 278, y, { color: rw[2], arrow: true, parent: g });
            ctx.line(481, y, 513, y, { color: rw[2], arrow: true, parent: g });
            ctx.line(646, y, 690, y, { color: rw[2], arrow: true, parent: g });
            var rr = ctx.rng(30 + i);
            ctx.matrix(700, y - 9, 1, 12, { cell: 16, gap: 3, cmap: 'diverge', values: function () { return rr() * 2 - 1; }, parent: g });
            ctx.text(700, y + 26, '\u2208 \u211d^8192', { size: 11, font: 'mono', color: 'dim', parent: g });
            if (i === 1) ctx.text(150, y + 34, '\u00d7 256 tokens', { size: 11, font: 'mono', color: 'violet', anchor: 'middle', parent: g });
            if (i === 2) ctx.text(150, y + 34, '\u00d7 1050 (25 / s)', { size: 11, font: 'mono', color: 'orange', anchor: 'middle', parent: g });
            return g;
          });
          ctx.text(80, 850, 'after this point the transformer cannot tell where a row came from, except through learned content and positions', { size: 11, font: 'mono', color: 'dim', parent: c });

          /* superposition pentagon */
          var c2 = card(ctx, S.mm, 1000, 340, 540, 530, 'pink', 'SUPERPOSITION  5 features in 2-D');
          var C0 = { x: 1270, y: 600 }, Rr = 150;
          S.feat = [];
          var names = ['fox', 'ice', 'space', 'glow', 'crash'];
          for (var k = 0; k < 5; k++) {
            var a = -Math.PI / 2 + k * 2 * Math.PI / 5;
            var tip = { x: C0.x + Rr * Math.cos(a), y: C0.y + Rr * Math.sin(a) };
            var l = ctx.line(C0.x, C0.y, tip.x, tip.y, { color: 'pink', sw: 2.2, arrow: true, parent: c2 });
            ctx.text(C0.x + (Rr + 24) * Math.cos(a), C0.y + (Rr + 22) * Math.sin(a), names[k], { size: 13, font: 'mono', color: 'pink', anchor: 'middle', parent: c2 });
            S.feat.push(l);
          }
          ctx.circle(C0.x, C0.y, Rr, { stroke: ctx.alpha('pink', 0.2), dash: '3 5', parent: c2 });
          ctx.text(1020, 800, 'angle 72\u00b0: cos = 0.31 interference', { size: 12, font: 'mono', color: 'text', parent: c2 });
          ctx.text(1020, 822, 'fine if features are sparse (rarely co-active)', { size: 12, font: 'mono', color: 'dim', parent: c2 });
          ctx.text(1020, 844, '\u2192 polysemantic neurons, SAEs untangle them', { size: 12, font: 'mono', color: 'dim', parent: c2 });
          ctx.reveal(S.mm, { from: 'up' });
          S.segEls.forEach(function (g) { g.setAttribute('opacity', 0); });
          S.mRows.forEach(function (g) { g.setAttribute('opacity', 0); });
          S.feat.forEach(function (l) { l.setAttribute('opacity', 0); });
          return ctx.reveal(S.segEls, { from: 'left', stagger: 160, dur: 350 }).then(function () {
            return ctx.reveal(S.mRows, { from: 'up', stagger: 300 });
          }).then(function () {
            return ctx.reveal(S.feat, { from: 'draw', stagger: 180, dur: 500 });
          });
        }
      }
    ]
  });
})();
