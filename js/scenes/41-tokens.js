/* L2 — Tokenization & Embeddings. Bytes, pre-tokenization, BPE training and encoding, special tokens and
 * chat templates, embedding lookup, geometry of the residual stream, multimodal tokens.
 * Every step is a sequence of beats (see docs/SCENE_API.md). */
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
  /* the deep panel keeps special tokens literal: putting the pipe in a different face (bold) splits the
   * shaping run, so "<|" and "|>" never turn into arrow ligatures */
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
  /* the six merges learned from the toy corpus, in rank order; encoding replays them on any word */
  var TOY_MERGES = ['e s', 'es t', 'l o', 'lo w', 'n e', 'ne w'];
  function encodeSteps(word) {
    var sy = word.split(''), steps = [{ s: sy.slice(), rule: '' }];
    TOY_MERGES.forEach(function (m, r) {
      var ab = m.split(' '), out = [], hit = false;
      for (var i = 0; i < sy.length; i++) {
        if (i < sy.length - 1 && sy[i] === ab[0] && sy[i + 1] === ab[1]) { out.push(ab[0] + ab[1]); i++; hit = true; } else out.push(sy[i]);
      }
      if (hit) { sy = out; steps.push({ s: sy.slice(), rule: 'rule ' + (r + 1) + ': ' + m }); }
    });
    return steps;
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
      'Kudo &amp; Richardson, <i>SentencePiece: A simple and language independent subword tokenizer and detokenizer for Neural Text Processing</i>, EMNLP 2018; OpenAI <i>tiktoken</i> (cl100k_base, o200k_base); Singh &amp; Strouse, <i>Tokenization counts: the impact of tokenization on arithmetic in frontier LLMs</i>, 2024; Pagnoni et al., <i>Byte Latent Transformer: Patches Scale Better Than Tokens</i>, 2024',
      'Llama Team, Meta AI, <i>The Llama 3 Herd of Models</i>, 2024',
      'Mikolov et al., <i>Linguistic Regularities in Continuous Space Word Representations</i>, NAACL 2013; Park et al., <i>The Linear Representation Hypothesis and the Geometry of Large Language Models</i>, ICML 2024',
      'Elhage et al., <i>Toy Models of Superposition</i>, Transformer Circuits 2022',
      'Press &amp; Wolf, <i>Using the Output Embedding to Improve Language Models</i> (weight tying), EACL 2017',
      'Rumbelow &amp; Watkins, <i>SolidGoldMagikarp (plus, prompt generation)</i> (glitch tokens), LessWrong 2023; Land &amp; Bartolo, <i>Fishing for Magikarp: Automatically Detecting Under-trained Tokens in Large Language Models</i>, EMNLP 2024'
    ],
    steps: [
      /* ------------------------------------------------------------ 1 */
      {
        title: 'Text is bytes',
        beats: [
          {
            say: 'Before a model can read the fox astronaut prompt, the text must become a sequence of integers. Start from what we see: a line of characters, including two Chinese characters at the end.',
            card: { tag: 'KEY IDEA', title: 'Text must become integers', body: 'A model only computes on numbers. Everything downstream depends on how the text is cut into pieces.' },
            deep: '<p>The tokenizer is a <b>lossless, invertible</b> map between byte strings and id sequences, so it starts from what a file really contains: Unicode text stored as bytes.</p>' +
              '<p>A <i>character</i> here is a Unicode code point (U+0041 for A, U+51B0 for 冰). What a reader sees as one glyph, a <i>grapheme</i>, can be several code points (accents, emoji sequences). Tokenizers ignore graphemes and work on bytes.</p>' +
              '<p class="muted">The shaded line is illustrative: 53 characters, of which two are CJK.</p>'
          },
          {
            say: 'Underneath, characters are just UTF eight bytes: one byte per English letter, three bytes for each of the two Chinese characters. The line grows from fifty three characters to fifty seven bytes.',
            card: { tag: 'NUMBERS', title: 'Bytes per character', stat: { v: '3', u: 'bytes', l: 'per CJK character in UTF-8, versus 1 byte for each English letter' }, more: '<p>UTF-8 layout: <code>0xxxxxxx</code> (1 byte), <code>110xxxxx 10xxxxxx</code> (2), <code>1110xxxx 10xxxxxx 10xxxxxx</code> (3), and four bytes for emoji. 冰 = U+51B0 = 0101 0001 1011 0000, which packs into E5 86 B0.</p>' },
            deep: '<p>UTF-8 encodes code points in 1 to 4 bytes: ASCII takes 1, most Latin, Greek and Cyrillic take 2, most CJK take 3, emoji take 4. The byte alphabet has only 256 symbols, so a byte-level vocabulary can never hit an out-of-vocabulary error.</p>' +
              '<div class="eq">冰 = U+51B0 → E5 86 B0, &nbsp; 月 = U+6708 → E6 9C 88</div>' +
              '<p>Non-English text therefore pays a byte tax before any merge: a Chinese character is 3 raw symbols where an English letter is 1.</p>'
          },
          {
            say: 'Byte level byte pair encoding then merges frequent byte sequences into tokens. The same line collapses to just fourteen tokens, and each token becomes one integer id.',
            card: { tag: 'NUMBERS', title: 'Bytes become tokens', stat: { v: '14', u: 'tokens', l: 'from 57 bytes on this line: about 4 bytes per token' } },
            deep: '<p>Byte-level BPE merges frequent byte sequences into single tokens. On this line, 57 bytes collapse into 14 tokens. Each Chinese character stays one token here: a vocabulary with enough CJK merges maps most common characters to a single token, while rarer ones fall back to their three raw bytes.</p>' +
              '<p class="muted">Token boundaries shown for the Llama-3-style tokenizer are illustrative.</p>'
          },
          {
            say: 'Why not stop at bytes? Sequences would be over four times longer, and attention cost grows with the square of length, about nineteen times more for our prompt. Whole words fail differently: the vocabulary explodes, and crash-lands would still be out of vocabulary.',
            card: { tag: 'TRADE-OFF', title: 'Bytes long, words huge', body: 'Bytes never fail but make T over 4× longer and attention 19× dearer. Words are short but need a million-entry, brittle table.' },
            deep: '<table><tr><th>Unit</th><th>|V|</th><th>T for our prompt</th><th>Problem</th></tr>' +
              '<tr><td>bytes</td><td>256</td><td>145</td><td>T² attention, weak units</td></tr>' +
              '<tr><td>words</td><td>&gt;10<sup>6</sup></td><td>25</td><td>OOV, huge softmax</td></tr>' +
              '<tr><td>byte-level BPE</td><td>32k–256k</td><td>≈ 33</td><td>tokenization artifacts</td></tr></table>' +
              '<div class="eq">cost(attention) ∝ T², &nbsp; (145 / 33)² ≈ 19× more attention FLOPs for raw bytes</div>' +
              '<p>Raw bytes also make each embedding a weak semantic unit, pushing related information further apart in the sequence.</p>'
          },
          {
            say: 'Byte level BPE sits in between. Frequent chunks become single tokens, and anything unseen still falls back to bytes. Our prompt takes about thirty three tokens, at a vocabulary of one hundred twenty eight thousand entries.',
            card: { tag: 'KEY IDEA', title: 'The middle path', body: 'Learned merges keep sequences short; the byte fallback guarantees nothing is ever out of vocabulary.' },
            deep: '<p>With a 128k vocabulary, English prose compresses to ≈ 4 bytes (≈ 0.75 words) per token, or ≈ 1.3 tokens per word; Meta reports 3.94 characters per token for Llama 3 against 3.17 for Llama 2. Our 145-byte prompt gives 33 tokens with the cl100k_base vocabulary that Llama 3 extends, so expect a similar count. CJK characters are 3 UTF-8 bytes each; a vocabulary with enough CJK merges maps most common characters to one token.</p>' +
              '<p>Design space: the vocabulary size V trades sequence length T against embedding size V·d and softmax cost. Alternatives: SentencePiece Unigram LM, and tokenizer-free byte models such as the Byte Latent Transformer with entropy-based patches.</p>' +
              '<details><summary>Go deeper</summary><p>Because V changes T, per-token loss and perplexity are not comparable across tokenizers. Compare models in bits per byte:</p>' +
              '<div class="eq">BPB = T · L<sub>nats/token</sub> / (N<sub>bytes</sub> · ln 2)</div>' +
              '<p>At 4 bytes per token, 2.0 nats per token is 2.0 / (4 · ln 2) = 0.72 bits per byte. The same 0.72 bits per byte is 2.5 nats per token for a tokenizer that packs 5 bytes into each token, so per-token numbers only compare within one tokenizer.</p></details>' +
              '<p class="muted">Token boundaries shown for the Llama-3-style tokenizer are illustrative.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          S.top = ctx.group();
          var lblT = ctx.text(BX - 10, 200, 'text', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.top, opacity: 0 });
          var lblB = ctx.text(BX - 10, 250, 'UTF-8', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.top, opacity: 0 });
          var lblK = ctx.text(BX - 10, 302, 'BPE', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.top, opacity: 0 });
          var txt = LINE.join('');
          var x = BX, chars = [], bytes = [];
          for (var i = 0; i < txt.length; i++) {
            var ch = txt.charAt(i), bs = utf8(ch), w = bs.length * BW;
            var cg = ctx.group({ parent: S.top, opacity: 0 });
            ctx.rect(x + 1, 182, w - 2, 36, { rx: 4, fill: ctx.alpha(bs.length > 1 ? 'violet' : 'cyan', 0.1), stroke: ctx.alpha(bs.length > 1 ? 'violet' : 'cyan', 0.45), sw: 1, parent: cg });
            ctx.text(x + w / 2, 200.5, ch === ' ' ? '\u00b7' : ch, { size: 17, font: 'mono', anchor: 'middle', color: ch === ' ' ? 'dim' : 'white', parent: cg });
            chars.push(cg);
            bs.forEach(function (b, k) {
              var bg = ctx.group({ parent: S.top, opacity: 0 });
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
            var tg = ctx.group({ parent: S.top, opacity: 0 });
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
          /* beat 0: characters */
          ctx.reveal(lblT, {});
          ctx.reveal(chars, { from: 'down', stagger: 18, dur: 300 });
          return ctx.counter(S.cN, 0, txt.length, 900, function (v) { return Math.round(v) + ' chars'; }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: UTF-8 bytes */
            ctx.reveal(lblB, {});
            ctx.reveal(bytes, { from: 'down', stagger: 14, dur: 250 });
            return ctx.counter(S.bN, 0, nbytes(txt), 900, function (v) { return Math.round(v) + ' bytes'; });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: BPE tokens */
            ctx.reveal(lblK, {});
            ctx.reveal(S.toks, { from: 'down', stagger: 70, dur: 300 });
            return ctx.counter(S.tN, 0, LINE.length, 1000, function (v) { return Math.round(v) + ' tokens'; });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: why not raw bytes, why not whole words */
            S.why = ctx.group();
            var words = FULL.split(' ').length, nb = FULL.length, nt = 33;
            var opts = [
              ['BYTES / CHARACTERS', 'teal', nb, '|V| = 256 \u00b7 never out-of-vocab', 'units carry little meaning'],
              ['WHOLE WORDS', 'cyan', words, '|V| > 1,000,000 \u00b7 "crash-lands" OOV', 'huge embedding + softmax'],
              ['BYTE-LEVEL BPE', 'amber', nt, '|V| = 128,256 (Llama 3)', 'frequent chunks + byte fallback']
            ];
            S.whyBars = [];
            S.wc = [];
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
              S.wc.push(c);
            });
            S.foot = ctx.group({ parent: S.why, opacity: 0 });
            ctx.text(60, 722, 'full prompt: "' + FULL.slice(0, 84) + '\u2026"', { size: 13, font: 'mono', color: 'dim', parent: S.foot });
            ctx.text(60, 748, nb + ' bytes \u00b7 ' + words + ' words \u00b7 \u2248 ' + nt + ' BPE tokens (\u2248 1.3 tokens / word)', { size: 12, font: 'mono', color: 'amber', parent: S.foot });
            S.wc[2].setAttribute('opacity', 0);
            S.growBars = function (i) {
              var b = S.whyBars[i];
              return Promise.all([ctx.animate(b[0], { width: [0, b[1]] }, 700, 'out', 0), ctx.animate(b[2], { width: [0, b[3]] }, 700, 'out', 300)]);
            };
            ctx.reveal([S.wc[0], S.wc[1]], { from: 'up', stagger: 250 });
            return ctx.wait(300).then(function () { return Promise.all([S.growBars(0), S.growBars(1)]); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: byte-level BPE, the middle path */
            ctx.reveal([S.wc[2], S.foot], { from: 'up', stagger: 200 });
            return ctx.wait(300).then(function () { return S.growBars(2); }).then(function () { return ctx.pulse(S.wc[2], { color: 'amber', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 2 */
      {
        title: 'Pre-tokenization',
        beats: [
          {
            say: 'Before any merging, a regular expression chops the text into pre-tokens. The magenta cuts show where, and merges are never allowed to cross them.',
            card: { tag: 'KEY IDEA', title: 'Split, then merge', body: 'A regular expression cuts the text into pre-tokens. BPE merges happen only inside a pre-token.' },
            deep: '<p>Llama 3 uses the tiktoken <code>cl100k</code>-style split pattern (shown on the left, one alternative per line). It runs <i>before</i> BPE, so a merge such as <code>"e" + " "</code> can never appear: no token straddles a word boundary.</p>' +
              '<div class="note">SentencePiece (Llama 2, Gemma) instead treats the input as a raw stream with <code>▁</code> marking spaces and no regex; tiktoken-style byte BPE (GPT-4, Llama 3) splits first, then merges.</div>'
          },
          {
            say: 'Words keep their leading space, so space fox and fox are different tokens. Punctuation is separated from words, and a hyphen can stay attached to the word that follows.',
            card: { tag: 'HOW IT WORKS', title: 'Spaces stick to words', body: '" fox" and "fox" are different ids, so the model sees word starts explicitly.' },
            deep: '<ul><li><b>Leading space attaches to the word</b>: <code>" fox"</code> and <code>"fox"</code> are different ids; the model sees word starts explicitly. Capitalisation changes the id too: <code>" Fox"</code> is a third token.</li>' +
              '<li>One optional non-letter prefix: <code>-lands</code> is a single pre-token; BPE may still split it.</li>' +
              '<li>Contractions such as <code>\'s</code> and <code>\'ll</code> are split off as their own pre-tokens.</li></ul>'
          },
          {
            say: 'Digits are split into groups of at most three, so nineteen twenty becomes one nine two, then zero. Numbers get a regular structure instead of arbitrary merged digit strings.',
            card: { tag: 'NUMBERS', title: 'Digit groups', stat: { v: '≤ 3', u: 'digits', l: 'per pre-token: 1920 becomes 192 and 0' } },
            deep: '<ul><li><b>Digits in groups of ≤ 3</b> (<code>\\p{N}{1,3}</code>): <code>1920</code> → <code>192</code>,<code>0</code>. More regular number handling than arbitrary merged digit strings; some models go further and split every digit (Llama 1/2, Gemma, Qwen).</li>' +
              '<li>Grouping direction matters for arithmetic: left-to-right chunking misaligns place values, and right-to-left grouping measurably helps frontier models on addition (Singh &amp; Strouse 2024).</li></ul>'
          },
          {
            say: 'After pre-tokenization every chunk is a byte string, so nothing is ever out of vocabulary. Even a Chinese character with no learned merge falls back to its three raw bytes.',
            card: { tag: 'PITFALL', title: 'Mid-character tokens', body: 'A token may end inside a UTF-8 character, so streaming decoders must buffer bytes before printing.' },
            deep: '<ul><li><b>Byte fallback</b>: after pre-tokenization, every chunk is a byte string over a 256-symbol base alphabet, so encoding never fails (<code>冰</code> = <code>E5 86 B0</code>).</li>' +
              '<li>A typo like <code>" foxx"</code> becomes <code>" fox"</code> + <code>"x"</code>; a rare emoji becomes up to four byte tokens.</li>' +
              '<li>Decoding must <b>buffer</b>: a token can end mid-character, so a streaming detokeniser waits until the bytes form valid UTF-8.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.why, 400, true);
          /* beat 0: pre-token boundaries on the byte rows, and the split pattern */
          S.bounds = ctx.group();
          var x = BX;
          PRE.forEach(function (p, i) {
            x += nbytes(p) * BW;
            if (i < PRE.length - 1) ctx.rect(x - 1.5, 174, 3, 154, { rx: 1, fill: 'magenta', parent: S.bounds, glow: true });
          });
          ctx.label(1420, 352, 'magenta = pre-token cut', { size: 12, color: 'magenta', parent: S.bounds });
          S.pre = ctx.group();
          var pat = [["(?i:'s|'t|'re|'ve|'m|'ll|'d)", 'contractions'], ['|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+', 'word + 1 prefix char'], ['|\\p{N}{1,3}', 'digits, groups <= 3'],
            ['| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*', 'punctuation runs'], ['|\\s*[\\r\\n]+', 'newlines'], ['|\\s+(?!\\S)', 'trailing spaces'], ['|\\s+', 'other whitespace']];
          var code = ctx.code({ x: 60, y: 388, w: 660, title: 'split pattern (cl100k / Llama 3)', lang: 'text', size: 12, color: 'magenta', parent: S.pre, lines: pat.map(function (p) {
            var s = p[0];
            while (s.length < 32) s += ' ';
            return s + '# ' + p[1];
          }) });
          keepWS(code);
          /* example card and byte-fallback card wait for later beats */
          var c2 = card(ctx, S.pre, 760, 388, 780, 176, 'cyan', "PRE-TOKENIZE('30-second trailer at 1920x1080')");
          c2.setAttribute('opacity', 0);
          var ex = ['30', '-second', ' trailer', ' at', ' ', '192', '0', 'x', '108', '0'];
          var ex2 = [];
          var xx = 780;
          ex.forEach(function (p) {
            var col = /^[0-9]+$/.test(p) ? 'amber' : (p === ' ' ? 'dim' : 'cyan');
            var w = Math.max(26, p.length * 8.1 + 14);
            var g = ctx.group({ parent: c2, opacity: 0 });
            ctx.rect(xx, 440, w, 30, { rx: 6, fill: ctx.alpha(col, 0.15), stroke: col, sw: 1.2, parent: g });
            ctx.text(xx + w / 2, 455.5, vis(p), { size: 13, font: 'mono', anchor: 'middle', color: 'white', parent: g });
            ex2.push(g);
            xx += w + 8;
          });
          ctx.text(780, 504, 'amber = \\p{N}{1,3} digit groups   cyan = words with prefix', { size: 12, font: 'mono', color: 'dim', parent: c2 });
          ctx.text(780, 528, 'note: the space before 1920 is its own pre-token', { size: 12, font: 'mono', color: 'dim', parent: c2 });
          var c3 = card(ctx, S.pre, 60, 598, 1480, 272, 'violet', 'BYTE FALLBACK \u00b7 nothing is ever out-of-vocabulary');
          c3.setAttribute('opacity', 0);
          ctx.para(80, 648, ['base alphabet = 256 byte tokens  \u2192  any UTF-8 string encodes', 'merges learned on top: "\u00b7fox" is 1 token, a typo like "\u00b7foxx" becomes "\u00b7fox" + "x"', '\u51b0 = E5 86 B0: one token if the merge exists, else 3 byte tokens', 'decode must buffer: a token can end mid-character (stream carefully)', 'leading space is part of the token: "\u00b7fox" \u2260 "fox" \u2260 "\u00b7Fox"'], { size: 14, font: 'mono', color: 'text', lh: 38, parent: c3 });
          /* highlight frames on the pattern lines (fixed geometry: independent of font loading) */
          function lineBox(i, color) {
            var y = 388 + 46 + i * 18.6;
            return ctx.rect(68, y - 9.5, 644, 19, { rx: 4, stroke: color, sw: 1.6, dash: '5 4', parent: S.pre, opacity: 0 });
          }
          ctx.reveal(S.bounds, { delay: 200 });
          return ctx.reveal(code, { from: 'up', dur: 500 }).then(function () {
            return ctx.wait(300);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the leading space belongs to the word */
            var h1 = ctx.highlight(S.toks[1], { color: 'amber', pad: 4, parent: S.top });
            ctx.reveal(lineBox(1, 'magenta'), { dur: 300 });
            S.spaceLbl = ctx.label(196, 164, 'space + fox = one token', { color: 'amber', size: 11, parent: S.top, opacity: 0 });
            return Promise.all([ctx.reveal(S.spaceLbl, { from: 'down', dur: 400 }), ctx.pulse(S.toks[1], { color: 'amber', dur: 700 })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: digits in groups of at most three */
            ctx.reveal(c2, { from: 'up', dur: 500 });
            ctx.reveal(lineBox(2, 'amber'), { dur: 300 });
            return ctx.wait(500).then(function () { return ctx.reveal(ex2, { from: 'down', stagger: 110, dur: 300 }); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: byte fallback */
            ctx.reveal(c3, { from: 'up', dur: 500 });
            return ctx.wait(500).then(function () {
              ctx.pulse(S.toks[12], { color: 'violet', dur: 600 });
              return ctx.pulse(S.toks[13], { color: 'violet', dur: 600 });
            });
          });
        }
      },
      /* ------------------------------------------------------------ 3 */
      {
        title: 'Training BPE',
        beats: [
          {
            say: 'How is the vocabulary learned? Byte pair encoding is a greedy compression algorithm. Take a toy corpus, split it into single symbols, and count every adjacent pair, weighted by how often each word occurs.',
            card: { tag: 'KEY IDEA', title: 'Greedy compression', body: 'Repeatedly replace the most frequent adjacent pair with a new symbol. Frequent chunks earn short codes.' },
            deep: '<p>Toy corpus (a common variant of the example in Sennrich et al., whose Figure 1 uses low, lowest, newer, wider): <code>low×5, lower×2, newest×6, widest×3</code>. Every word starts as a sequence of single symbols (the original paper’s end-of-word marker is omitted here); pair counts are weighted by word frequency.</p>' +
              '<p>Initial top pairs: <code>e s</code> (6 in newest + 3 in widest = 9), <code>s t</code> (9), <code>l o</code> (7), <code>o w</code> (7), <code>w e</code> (8). Ties are broken by first occurrence, so <code>e s</code> wins.</p>'
          },
          {
            say: 'Merge the most frequent pair into a new symbol, and repeat. Here e and s occur together nine times, in newest and widest, so they become the first merge rule.',
            card: { tag: 'NUMBERS', title: 'The top pair wins', more: '<p>Recounting all pairs each round costs O(N) over the corpus, so V merges cost O(V·N). Real implementations keep an index from each pair to the words that contain it and a max-heap of counts, and update only the affected words after each merge, so a merge no longer touches the whole corpus.</p>', stat: { v: '9', u: 'times', l: 'e s occurs 6 times in newest and 3 in widest: the top pair' } },
            deep: '<pre>vocab  = 256 byte symbols\nmerges = []\nwhile len(vocab) &lt; V:\n  counts = Σ_w freq(w)·pairs(w)\n  a, b = argmax(counts)\n  merges.append((a, b))  # rank\n  replace a,b → ab everywhere\n  vocab.add(ab)</pre>' +
              '<p>The rank of a merge is its position in this list; it is what encoding will use later to decide which merge to apply first.</p>'
          },
          {
            say: 'Repeat. Now es and t always occur together, so they merge into est. Then l and o merge, and lo and w merge, so the whole word low becomes a single symbol.',
            card: { tag: 'HOW IT WORKS', title: 'Merges build on merges', body: 'Later rules reuse earlier ones: e s, then es t, then est. Rank order is the order learned.' },
            deep: '<p>Merges 2–4: <code>es t</code> (9), <code>l o</code> (7), <code>lo w</code> (7). After merge 1 the pair <code>es t</code> has count 9 (6 + 3), so <b>est</b> becomes a symbol; <code>low</code> becomes a single symbol after rules 3 and 4.</p>' +
              '<ul><li>Real training: pre-tokenized text, pair counts over unique pre-tokens × frequency, incremental count updates with a priority queue instead of recounting the whole corpus each round.</li></ul>'
          },
          {
            say: 'Next n and e merge, then ne and w give new. Each rule is stored with its rank, and that ordered list of merges is the tokenizer.',
            card: { tag: 'KEY IDEA', title: 'The ranks are the model', body: 'Encoding replays the rules in rank order. Six merges here; Llama 3 has over a hundred thousand.' },
            deep: '<p>Merges 5–6: <code>n e</code> (6), <code>ne w</code> (6). The final list is <code>e s, es t, l o, lo w, n e, ne w</code>: six rules, six new symbols on top of the byte alphabet.</p>' +
              '<p>Two things ship with the tokenizer: the ordered merge list (the ranks) and the vocabulary file mapping each symbol to an integer id. Change either, and every trained model that used the old tokenizer breaks.</p>'
          },
          {
            say: 'A production tokenizer runs this loop for over a hundred thousand merges on a large sample of the training corpus, until the vocabulary reaches its target size.',
            card: { tag: 'NUMBERS', title: 'Production scale', more: '<p>Vocabulary arithmetic for Llama 3: 128,000 base tokens (256 raw bytes plus 127,744 learned merges, built on the 100k tiktoken vocabulary with 28k multilingual additions) and 256 reserved special tokens make 128,256. Trainers keep pair-count indexes and priority queues so that a large sample stays tractable; SentencePiece and HF tokenizers use the same idea.</p>', stat: { v: '128k', u: 'tokens', l: 'Llama 3: 256 bytes + 127,744 merges, plus 256 special tokens' } },
            deep: '<ul><li>Vocabulary size is a hyper-parameter: 32k (Llama 2) → 128,256 (Llama 3) → 200k (o200k) → 262k (Gemma 3). Bigger V shortens sequences but costs V·d embedding parameters and a bigger softmax.</li>' +
              '<li>The training sample matters: a tokenizer trained on mostly English gives non-English users longer sequences (and higher API bills), and tokens that were frequent in tokenizer training but rare in model training become undertrained "glitch" tokens.</li>' +
              '<li>Alternatives: <b>Unigram LM</b> (SentencePiece), tokenizer-free byte models (e.g. Byte Latent Transformer with entropy-based patches).</li></ul>'
          }
        ],
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
          S.bc = [c1, c2, c3, c4];
          c3.setAttribute('opacity', 0);
          c4.setAttribute('opacity', 0);
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
          S.scaleTxt = ctx.para(822, 812, ['toy corpus : 6 merges,       V = 256 + 6 = 262', 'Llama 3    : 127,744 merges, V = 128,000 + 256 special'], { size: 13, font: 'code', color: 'amber', lh: 28, parent: c4, opacity: 0 });
          keepWS(S.scaleTxt);
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
          /* beat 0: the corpus and its pair counts */
          return ctx.reveal([c1, c2], { from: 'up', stagger: 150 }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the algorithm, and the first merge */
            ctx.reveal([c3, c4], { from: 'up', stagger: 150 });
            return ctx.wait(500).then(oneMerge);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: est, lo, low */
            return oneMerge().then(oneMerge).then(oneMerge);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: ne, new */
            return oneMerge().then(oneMerge).then(function () { drawPairs(countPairs(S.corpus).top); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: production scale */
            ctx.reveal(S.scaleTxt, { from: 'up', dur: 500 });
            ctx.pulse(code.lineEls[1], { color: 'cyan', times: 2, dur: 500 });
            return ctx.counter(S.vocabTxt, 6, 127744, 1600, function (v) { return 'production vocab = 256 bytes + ' + Math.round(v).toLocaleString('en-US') + ' merges'; });
          });
        }
      },
      /* ------------------------------------------------------------ 4 */
      {
        title: 'Encoding',
        beats: [
          {
            say: 'Encoding new text replays the learned merges in rank order. Take a word the toy corpus never contained: lowest.',
            card: { tag: 'KEY IDEA', title: 'Replay the merges', body: 'Encoding applies the learned rules in rank order to any new word, even one never seen in training.' },
            deep: '<p>Encoding a pre-token: repeatedly find the adjacent pair with the <b>lowest merge rank</b> and merge it, until no pair is in the merge table.</p>' +
              '<pre>def encode_chunk(sym):\n  while len(sym) &gt; 1:\n    r, i = min((rank.get(p, ∞), i)\n               for i, p in pairs(sym))\n    if r == ∞: break\n    sym[i:i+2] = [sym[i] + sym[i+1]]\n  return [ids[s] for s in sym]</pre>'
          },
          {
            say: 'Split it into symbols, then apply rule one, e s, then rule two, es t, then l o, then lo w. It ends as two tokens, low and est, both learned pieces.',
            card: { tag: 'NUMBERS', title: 'Six symbols, two tokens', more: '<p>Rank order matters: BPE is deterministic only if merges are applied in the order they were learned. Here two independent chains (e s, then es t; and l o, then lo w) never touch each other, so their relative order is immaterial, but within a chain, and in general, the order changes the result. A mismatched merge list between training and inference silently changes token ids.</p>', stat: { v: '4', u: 'merges', l: 'collapse l-o-w-e-s-t into low + est' } },
            deep: '<p>Each round scans the current pairs for the rule with the smallest rank: for <code>l o w e s t</code> that is <code>e s</code> (rank 1), then <code>es t</code> (rank 2), <code>l o</code> (rank 3), and <code>lo w</code> (rank 4). No further pair is in the table, so encoding stops with <code>low</code> + <code>est</code>.</p>' +
              '<p>Word never seen in training, yet fully covered: this is why BPE handles morphology (<i>-est</i>) and new words gracefully. Byte fallback guarantees termination for anything.</p>'
          },
          {
            say: 'Now try it yourself. Click a word chip to encode it with the same six merges. Slowest reuses low and est, newer builds new and then stops because e r was never learned, and widest keeps w, i and d apart.',
            card: { tag: 'TRY IT', title: 'Encode your own word', body: 'Click lowest, newer, slowest or widest. The same six rules apply: familiar pieces merge, unfamiliar letters stay apart.' },
            deep: '<p>Encoding depends only on the word and the merge table, and it is local: shared pieces recur across words (<code>low</code> in lowest and slowest, <code>est</code> in lowest, slowest and widest). That reuse gives the model sub-word units it has seen many times.</p>' +
              '<ul><li><code>newer</code> ends as <code>new</code> · <code>e</code> · <code>r</code>: the pair <code>e r</code> occurred only twice in the toy corpus, so it never earned one of the six merges.</li>' +
              '<li><code>widest</code> keeps <code>w</code> · <code>i</code> · <code>d</code> apart: those pairs occurred three times each, below every learned rule.</li></ul>' +
              '<p class="muted">Production tokenizers run the same procedure with over 100,000 merges, so a frequent word is one token and a rare word a handful of pieces.</p>'
          },
          {
            say: 'The real tokenizer does exactly this on our prompt line: twelve tokens for nine words. Each token then maps to an integer id, the only thing the model ever sees.',
            card: { tag: 'NUMBERS', title: 'Tokens per word', stat: { v: '1.33', l: 'tokens per word on this line: 12 tokens for 9 words at a 128k vocabulary' } },
            deep: '<p>Production encoders (tiktoken in Rust, HF tokenizers) cache pre-token results; throughput is on the order of 10 MB/s per core, negligible next to the model.</p>' +
              '<ul><li><b>Rates</b>: ≈ 1.3 tokens per English word at 128k; Meta reports Llama 3\'s tokenizer yields up to 15% fewer tokens than Llama 2\'s.</li>' +
              '<li>The ids are the only thing the model ever sees: the same words with a different tokenizer give an entirely different id sequence.</li></ul>' +
              '<p class="muted">the ids are the cl100k_base ids of these twelve tokens (checked against the tiktoken vocabulary); Llama 3 builds on the same 100k tiktoken tokens, so common English tokens like these should carry the same ids.</p>'
          },
          {
            say: 'Vocabulary size is a trade-off: a bigger table shortens sequences, but costs embedding parameters and leaves rare tokens undertrained. And because the model sees ids, not letters, counting the r letters in strawberry is genuinely hard.',
            card: { tag: 'PITFALL', title: 'The model sees ids', body: 'Spelling, counting letters and character puzzles are hard because a token is an id, not a string of letters.' },
            deep: '<ul><li><b>Artifacts</b>: tokens that were frequent in tokenizer training but rare in model training stay undertrained ("glitch tokens", e.g. SolidGoldMagikarp); letter counting and spelling are hard because the model sees ids, not characters.</li>' +
              '<li>Bigger V → shorter T → fewer FLOPs per text and more text per context, but V·d embedding and unembedding parameters, a bigger softmax and rarer tokens.</li>' +
              '<li>Tokenization also fixes cost: users are billed per token, so a language with worse compression pays more for the same content.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          /* keep the merge table; replace the rest */
          ctx.fadeOut([S.bc[0], S.bc[1], S.bc[3]], 400, true);
          S.vocabTxt.textContent = 'toy vocab = 256 bytes + 6 merges';
          S.enc = ctx.group();
          var c1 = card(ctx, S.enc, 60, 180, 700, 330, 'lime', '');
          S.encTitle = ctx.text(76, 200, '', { size: 13, font: 'mono', weight: 700, color: 'lime', parent: c1, spacing: 1 });
          S.ladderG = ctx.group({ parent: c1 });
          S.encRun = 0;
          /* draw the rank-order ladder for one word; mode 'all' shows every row, 'hidden' only the first, 'anim' plays them in turn */
          S.encWord = function (word, mode) {
            var run = ++S.encRun;
            while (S.ladderG.firstChild) S.ladderG.removeChild(S.ladderG.firstChild);
            S.encTitle.textContent = 'ENCODE "' + word + '" \u00b7 rank order';
            var st = encodeSteps(word), rows = [];
            st.forEach(function (stp, i) {
              var last = i > 0 && i === st.length - 1, g = ctx.group({ parent: S.ladderG, opacity: (i && mode !== 'all') ? 0 : 1 }), x = 90, y = 240 + i * 46;
              stp.s.forEach(function (s) { var b = sym(ctx, g, x, y, s, last ? 'lime' : 'amber', last); x += b.w + 8; });
              if (stp.rule) ctx.text(480, y, stp.rule, { size: 13, font: 'mono', color: 'lime', parent: g });
              if (last) ctx.text(610, y, '\u2192 ' + stp.s.length + ' tokens', { size: 13, font: 'mono', weight: 700, color: 'white', parent: g });
              rows.push(g);
            });
            S.ladder = rows;
            if (mode !== 'anim') return Promise.resolve();
            var chain = ctx.wait(150);
            rows.forEach(function (g, i) {
              if (i === 0) return;
              chain = chain.then(function () { if (run !== S.encRun) return null; return ctx.reveal(g, { from: 'down', dur: 380 }).then(function () { return ctx.wait(220); }); });
            });
            return chain;
          };
          S.encWord('lowest', 'hidden');
          /* word chips (beat 2): the same six merges encode any word */
          var WORDS = ['lowest', 'newer', 'slowest', 'widest'];
          S.chipG = ctx.group({ parent: c1, opacity: 0 });
          ctx.text(76, 474, 'try:', { size: 13, font: 'mono', color: 'dim', parent: S.chipG });
          S.chips = WORDS.map(function (w) {
            var c = ctx.label(176 + WORDS.indexOf(w) * 112, 474, w, { color: 'lime', size: 13, w: 98, parent: S.chipG });
            c.style.cursor = 'pointer';
            c.addEventListener('click', function (ev) { ev.stopPropagation(); S.pickWord(w); });
            return c;
          });
          /* summary of all four words, side by side (beat 2 only) */
          S.cmp = card(ctx, S.enc, 800, 180, 740, 250, 'lime', 'SAME SIX MERGES, ANY WORD');
          S.cmp.setAttribute('opacity', 0);
          S.cmpHi = WORDS.map(function (w, i) {
            var st = encodeSteps(w), fin = st[st.length - 1].s, y = 252 + i * 46;
            var hi = ctx.rect(812, y - 21, 716, 42, { rx: 8, fill: ctx.alpha('lime', 0), parent: S.cmp });
            ctx.text(830, y, w, { size: 15, font: 'code', weight: 700, color: 'white', parent: S.cmp });
            ctx.text(950, y, '→', { size: 15, font: 'mono', color: 'dim', parent: S.cmp });
            var x = 980;
            fin.forEach(function (s) { var b = sym(ctx, S.cmp, x, y, s, 'lime', false); x += b.w + 8; });
            ctx.text(1512, y, fin.length + ' tokens', { size: 13, font: 'mono', color: 'dim', anchor: 'end', parent: S.cmp });
            return hi;
          });
          S.pickWord = function (w) {
            if (!S.chipsReady) return Promise.resolve();
            S.chips.forEach(function (c, i) { c.firstChild.setAttribute('fill', ctx.alpha('lime', WORDS[i] === w ? 0.45 : 0.12)); });
            S.cmpHi.forEach(function (h, i) { h.setAttribute('fill', ctx.alpha('lime', WORDS[i] === w ? 0.16 : 0)); });
            return S.encWord(w, 'anim');
          };
          var code = ctx.code({ x: 800, y: 180, w: 740, lang: 'py', size: 13, color: 'amber', parent: S.enc, title: 'python   (cl100k_base ids, see panel)', typing: true, lines: [
            '>>> ids = tok.encode("A fox astronaut crash-lands on a glowing ice moon.")',
            '>>> len(ids)          # 9 words -> 12 tokens (1.33 per word)',
            '12',
            '>>> ids',
            '[32, 39935, 47733, 10121, 12, 8329, 389, 264, 49592, 10054, 18266, 13]',
            '>>> [tok.decode([i]) for i in ids[:4]]',
            "['A', ' fox', ' astronaut', ' crash']"
          ] });
          code.setAttribute('opacity', 0);
          keepWS(code);
          var c3 = card(ctx, S.enc, 800, 400, 740, 470, 'orange', 'VOCABULARY SIZE IS A TRADE-OFF');
          ctx.para(820, 462, ['bigger V  \u2192  shorter T  \u2192  fewer FLOPs per text,', '             more text fits in the context', 'bigger V  \u2192  V\u00b7d embedding + unembedding params,', '             bigger softmax, rarer tokens', '             under-trained ("glitch tokens")', 'ids, not letters: spelling and counting', 'the r\'s in "strawberry" is genuinely hard'], { size: 15, font: 'code', color: 'text', lh: 44, parent: c3 });
          keepWS(c3);
          c3.setAttribute('opacity', 0);
          /* beat 0: the unseen word */
          return ctx.reveal(S.enc, { from: 'up' }).then(function () {
            return ctx.pulse(S.ladder[0], { color: 'amber', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the merges, in rank order (replay the ladder that was drawn hidden) */
            var chain = ctx.wait(200);
            S.ladder.forEach(function (g, i) {
              if (i === 0) return;
              chain = chain.then(function () { return ctx.reveal(g, { from: 'down', dur: 380 }).then(function () { return ctx.wait(220); }); });
            });
            return chain;
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: try other words: the chips appear and one example plays */
            ctx.reveal([S.chipG, S.cmp], { from: 'up', dur: 400 });
            S.chipsReady = true;
            return ctx.wait(500).then(function () { return S.pickWord('slowest'); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the real tokenizer on the prompt line */
            ctx.fadeOut(S.cmp, 300, true);
            ctx.reveal(code, { from: 'up', dur: 400 });
            return ctx.wait(300).then(function () { return code.typeAll(); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: vocabulary size is a trade-off */
            return ctx.reveal(c3, { from: 'up', dur: 500 }).then(function () { return ctx.pulse(c3, { color: 'orange', dur: 700 }); });
          });
        }
      }
      ,
      /* ------------------------------------------------------------ 5 */
      {
        title: 'Special tokens',
        beats: [
          {
            say: 'Some tokens are not text at all. Special tokens mark structure: begin of text, the start and end of each role header, end of turn, and a tag that announces a tool call.',
            card: { tag: 'KEY IDEA', title: 'Tokens that are not text', body: 'A block of reserved ids marks roles and turns. No string of ordinary text ever maps to them.' },
            deep: nolig('<p>Llama 3 reserves 256 special ids at the top of the vocabulary (128000–128255). The ones that matter for an agent:</p>' +
              '<ul><li><code>&lt;|begin_of_text|&gt;</code> (128000) starts every sequence.</li>' +
              '<li><code>&lt;|start_header_id|&gt;</code> … <code>&lt;|end_header_id|&gt;</code> wrap the role name (system, user, assistant, ipython).</li>' +
              '<li><code>&lt;|eot_id|&gt;</code> ends a turn; <code>&lt;|eom_id|&gt;</code> ends a message that expects a tool result.</li>' +
              '<li><code>&lt;|python_tag|&gt;</code> announces a built-in tool call.</li></ul>')
          },
          {
            say: 'The chat template wraps every message of our director agent in these markers: a system message with the tools, the user request, and the assistant reply, here a tool call.',
            card: { tag: 'HOW IT WORKS', title: 'One token stream', body: 'A deterministic template turns a list of messages into a single token stream. Fine-tuning taught the model this exact format.' },
            deep: nolig('<p>A <b>chat template</b> is a deterministic serialisation of a list of messages into one token stream. Llama 3 format:</p>' +
              '<pre>&lt;|begin_of_text|&gt;\n&lt;|start_header_id|&gt;system\n&lt;|end_header_id|&gt;\\n\\n\n{system}&lt;|eot_id|&gt;\n&lt;|start_header_id|&gt;user\n&lt;|end_header_id|&gt;\\n\\n\n{prompt}&lt;|eot_id|&gt;\n&lt;|start_header_id|&gt;assistant\n&lt;|end_header_id|&gt;\\n\\n</pre>' +
              '<p class="muted">(line breaks added for display; the real stream has none between special tokens)</p>' +
              '<p>Every serving stack must reproduce this exact serialisation: the tokenizer configuration ships the template, so fine-tuning data, inference and evaluation all format conversations identically.</p>')
          },
          {
            say: 'The model learned during fine tuning what each marker means. Emitting the end of turn token is a learned stop signal, and that is how generation ends.',
            card: { tag: 'NUMBERS', title: 'The stop signal', stat: { v: '128009', l: 'the id of the end-of-turn token: when the model samples it, generation stops' } },
            deep: nolig('<ul><li>Generation stops when the model emits <code>&lt;|eot_id|&gt;</code> (128009): a <i>learned</i> stop signal, not a length rule.</li>' +
              '<li>Tool calls: Llama 3.1 emits a JSON function call (or <code>&lt;|python_tag|&gt;</code> … <code>&lt;|eom_id|&gt;</code> for built-in tools); results return in an <code>ipython</code> role. Other families use <code>&lt;tool_call&gt;</code> tags or structured content blocks.</li>' +
              '<li>Template mismatches (a missing newline, a wrong role header) can degrade instruction following, which is why serving stacks apply the template shipped in the tokenizer config instead of hand-writing prompts, and why fine-tuning data must use the identical format.</li></ul>')
          },
          {
            say: 'These ids are reserved, and a careful serving stack encodes user and tool text so that it can never produce them. Then a pasted document cannot forge a role switch. That is one line of defence against prompt injection, not a complete one.',
            card: { tag: 'PITFALL', title: 'Blocking role forgery', body: 'Encode user text with special tokens disallowed and a literal end-of-turn string is just text. Some libraries parse them by default. Semantic injection still works.' },
            deep: nolig('<ul><li><b>Security</b>: user and tool text should be encoded with special tokens <i>disallowed</i>, so a document containing the literal string <code>&lt;|eot_id|&gt;</code> becomes ordinary text tokens, not a role switch.</li>' +
              '<li><b>Configuration matters</b>: tiktoken raises an error on special-token strings unless they are explicitly allowed, and Meta’s reference code encodes them as plain text, but Hugging Face tokenizers turn them into the real special ids by default (unless <code>split_special_tokens</code> is set): a known chat-template injection vector.</li>' +
              '<li>That closes the <i>syntactic</i> hole only. A page that says "ignore previous instructions" is still fluent text the model may follow: privilege separation, provenance tags and output filtering are needed on top.</li></ul>')
          },
          {
            say: 'Vocabularies keep growing, from thirty two thousand entries in Llama two to over two hundred sixty thousand in Gemma three. Bigger tables buy shorter sequences at the cost of more embedding parameters.',
            card: { tag: 'NUMBERS', title: 'Vocabularies grow', stat: { v: '262k', u: 'tokens', l: 'Gemma 3 vocabulary, versus 32k in Llama 2: an 8× larger table' } },
            deep: '<p>n_vocab across families: 32,000 (Llama 2, SentencePiece), 50,257 (GPT-2), 100,277 (cl100k), 128,256 (Llama 3), 129,280 (DeepSeek-V3), 151,665 (Qwen2.5), 200,019 (o200k), 262,144 (Gemma 3).</p>' +
              '<p>The trend is driven by multilingual and code efficiency. The cost: at d = 8,192, every extra 100k tokens adds 0.82 B parameters to the embedding and, if untied, another 0.82 B to the unembedding, plus a wider softmax at every decode step.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut([S.bpe, S.enc], 400, true);
          S.sp = ctx.group();
          /* reserved ids on the left */
          var c2 = card(ctx, S.sp, 60, 180, 480, 300, 'magenta', 'RESERVED IDS (Llama 3)');
          var ids = [['<|begin_of_text|>', 128000], ['<|end_of_text|>', 128001], ['<|start_header_id|>', 128006], ['<|end_header_id|>', 128007], ['<|eom_id|>', 128008], ['<|eot_id|>', 128009], ['<|python_tag|>', 128010]];
          S.idRows = ids.map(function (r, i) {
            var y = 226 + i * 34, rg = ctx.group({ parent: c2 });
            ctx.text(80, y, r[0], { size: 13, font: 'code', color: 'magenta', parent: rg }).style.fontVariantLigatures = 'none';
            ctx.text(520, y, String(r[1]), { size: 13, font: 'mono', color: 'white', anchor: 'end', parent: rg });
            return rg;
          });
          /* chat template on the right (beat 1) */
          var c1 = card(ctx, S.sp, 580, 180, 960, 300, 'magenta', 'CHAT TEMPLATE · director agent turn (Llama 3 format)');
          c1.setAttribute('opacity', 0);
          var lines = [
            '<|begin_of_text|><|start_header_id|>system<|end_header_id|>⏎⏎',
            'You are the Director agent. Tools: render_shot, search_assets.<|eot_id|>',
            '<|start_header_id|>user<|end_header_id|>⏎⏎',
            '30-second trailer: fox astronaut, glowing ice moon.<|eot_id|>',
            '<|start_header_id|>assistant<|end_header_id|>⏎⏎',
            '{"name": "search_assets", "parameters": {"query": "fox sketch"}}<|eot_id|>'
          ];
          S.tplLines = lines.map(function (ln, i) {
            var t = ctx.text(600, 230 + i * 38, '', { size: 13, font: 'code', color: 'text', parent: c1, opacity: 0 });
            t.style.fontVariantLigatures = 'none';
            ln.split(/(<\|[a-z_]+\|>)/).forEach(function (part) {
              if (!part) return;
              var sp = ctx.el('tspan', /^<\|/.test(part) ? { fill: ctx.C.magenta, 'font-weight': 700 } : {}, t);
              sp.textContent = part;
            });
            return t;
          });
          S.stopLbl = ctx.label(1520, 456, 'sampled: generation stops', { color: 'lime', size: 12, anchor: 'end', parent: c1, opacity: 0 });
          /* vocabulary sizes (beat 4) */
          var c3 = card(ctx, S.sp, 60, 510, 1480, 360, 'amber', 'VOCABULARY SIZES (n_vocab)');
          c3.setAttribute('opacity', 0);
          var vs = [['Llama 2 (SentencePiece)', 32000], ['GPT-2 (byte BPE)', 50257], ['GPT-4 cl100k_base', 100277], ['Llama 3 / 3.1', 128256], ['DeepSeek-V3', 129280], ['Qwen2.5', 151665], ['GPT-4o o200k_base', 200019], ['Gemma 3', 262144, '≈ 262k']];
          S.vBars = vs.map(function (v, i) {
            var y = 556 + i * 38;
            ctx.text(420, y, v[0], { size: 13, font: 'mono', color: 'text', anchor: 'end', parent: c3 });
            var b = ctx.rect(436, y - 12, 0, 24, { rx: 3, fill: ctx.alpha(v[0].indexOf('Llama 3') === 0 ? 'amber' : 'orange', v[0].indexOf('Llama 3') === 0 ? 0.7 : 0.35), stroke: 'amber', sw: 1, parent: c3 });
            ctx.text(436 + 960 * v[1] / 262144 + 8, y, v[2] || v[1].toLocaleString('en-US'), { size: 12, font: 'mono', color: 'amber', parent: c3 });
            return [b, 960 * v[1] / 262144];
          });
          /* the same turn as token ids (beats 1 to 3): special tokens are single reserved ids inside an ordinary stream */
          S.stripG = ctx.group({ parent: S.sp, opacity: 0 });
          card(ctx, S.stripG, 60, 510, 1480, 360, 'cyan', 'THE SAME TURN AS TOKEN IDS   special tokens are single reserved ids');
          function tchip(parent, x, y, s, col) {
            var g = ctx.group({ parent: parent }), w = Math.max(32, s.length * 8.6 + 18);
            ctx.rect(x, y - 15, w, 30, { rx: 6, fill: ctx.alpha(col, 0.16), stroke: col, sw: 1.2, parent: g });
            var t = ctx.text(x + w / 2, y + 0.5, s, { size: 12, font: 'code', anchor: 'middle', color: 'white', parent: g });
            t.style.fontVariantLigatures = 'none';
            g.w = w;
            return g;
          }
          var seq = [['128000', 'begin', 1], ['128006', 'header', 1], ['system', '', 0], ['128007', '/header', 1], ['⏎⏎', '', 0], ['You', '', 0], [' are', '', 0], [' the', '', 0], [' Director', '', 0], [' agent', '', 0], ['.', '', 0], [' Tools', '', 0], [':', '', 0], [' render', '', 0], ['_shot', '', 0], [',', '', 0], [' search', '', 0], ['_assets', '', 0], ['.', '', 0], ['128009', 'end of turn', 1]];
          var sx = 90, sy = 590;
          seq.forEach(function (q) {
            var chipG = tchip(S.stripG, sx, sy, q[0].replace(/^ /, '·'), q[2] ? 'magenta' : 'cyan');
            if (q[1]) ctx.text(sx + chipG.w / 2, sy + 30, q[1], { size: 11, font: 'mono', color: 'magenta', anchor: 'middle', parent: S.stripG });
            sx += chipG.w + 7;
          });
          ctx.text(90, 668, 'magenta = reserved special id (128000 and up), never produced by ordinary text   ·   cyan = ordinary text token   ·   text splits are illustrative, special ids are real', { size: 11, font: 'mono', color: 'dim', parent: S.stripG });
          /* what happens to a forged special token inside user text (beat 3) */
          S.forgeG = ctx.group({ parent: S.stripG, opacity: 0 });
          ctx.icon('shield', 100, 700, 22, 'pink', { parent: S.forgeG });
          var ft = ctx.text(122, 726, 'user text containing the literal string  <|eot_id|>  becomes ordinary tokens:', { size: 13, font: 'code', color: 'text', parent: S.forgeG });
          ft.style.fontVariantLigatures = 'none';
          var fx = 90;
          ['<|', 'e', 'ot', '_id', '|>'].forEach(function (s) {
            var cg = tchip(S.forgeG, fx, 780, s, 'cyan');
            fx += cg.w + 7;
          });
          ctx.text(fx + 14, 780, '5 ordinary text tokens, ids below 128,000: no role switch, the turn cannot be closed early', { size: 13, font: 'mono', color: 'lime', parent: S.forgeG });
          ctx.text(90, 836, 'that closes the syntactic hole only: a page saying "ignore previous instructions" is still fluent text', { size: 11, font: 'mono', color: 'dim', parent: S.forgeG });
          /* beat 0: the reserved ids */
          return ctx.reveal(S.sp, { from: 'up' }).then(function () {
            return ctx.reveal(S.idRows, { from: 'left', stagger: 90, dur: 300 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the chat template, and the same turn as ids below it */
            ctx.reveal(c1, { from: 'up', dur: 400 });
            ctx.reveal(S.stripG, { from: 'up', dur: 500, delay: 600 });
            var chain = ctx.wait(400);
            S.tplLines.forEach(function (t) { chain = chain.then(function () { return ctx.reveal(t, { from: 'left', dur: 300 }); }); });
            return chain;
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: end of turn is a learned stop signal */
            var h = ctx.highlight(S.idRows[5], { color: 'lime', pad: 6, parent: S.sp });
            ctx.reveal(S.stopLbl, { from: 'up', dur: 400 });
            return ctx.pulse(S.idRows[5], { color: 'lime', times: 2, dur: 600 }).then(function () {
              return ctx.pulse(S.tplLines[5], { color: 'lime', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: reserved ids cannot be forged by user text */
            return ctx.reveal(S.forgeG, { from: 'up', dur: 500 }).then(function () { return ctx.pulse(S.forgeG, { color: 'pink', dur: 700 }); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: vocabulary sizes (the id strip makes way) */
            ctx.fadeOut(S.stripG, 350, true);
            ctx.reveal(c3, { from: 'up', dur: 500, delay: 200 });
            return ctx.wait(400).then(function () {
              return Promise.all(S.vBars.map(function (b, i) { return ctx.animate(b[0], { width: [0, b[1]] }, 600, 'out', i * 90); }));
            });
          });
        }
      },
      /* ------------------------------------------------------------ 6 */
      {
        title: 'Embedding lookup',
        beats: [
          {
            say: 'Now ids become vectors. Formally, the id is a one hot vector of length one hundred twenty eight thousand, multiplied by the embedding matrix.',
            card: { tag: 'KEY IDEA', title: 'A one-hot times a table', body: 'One hot vector of length V times the matrix E: a single 1 selects a single row of E.' },
            deep: '<div class="eq">e = onehot(id)ᵀ E = E[id, :] &nbsp;&nbsp; E ∈ ℝ<sup>V×d</sup></div>' +
              '<p>Only 18 of the 128,256 rows and 16 of the 8,192 columns fit on the stage; the highlighted row is token <code>·fox</code> (id 39935 in cl100k_base). The matrix is learned: at initialisation its rows are near-random, and training moves them so that useful neighbours form.</p>'
          },
          {
            say: 'The product simply selects one row. So the implementation is a gather: copy sixteen kilobytes for each token, with no multiplication at all.',
            card: { tag: 'NUMBERS', title: 'A gather is free', more: '<p>16 KiB per token is d × 2 B = 8,192 × 2 B. A batch of 4,096 tokens gathers 64 MiB, a rounding error next to the ≈ 141 GB of weights read by the transformer stack. The output projection, a real GEMM, is where the vocabulary costs FLOPs.</p>', stat: { v: '16', u: 'KiB', l: 'copied per token from HBM: 8,192 numbers in BF16, and zero FLOPs' } },
            deep: '<ul><li><b>Cost</b>: a gather moves d × 2 bytes = 16 KiB per token (BF16, d = 8,192); no FLOPs. A dense one-hot matmul would cost 2·V·d = 2.1 GFLOP per token.</li>' +
              '<li><b>Gradient</b>: ∂L/∂E is non-zero only on rows present in the batch → sparse updates; with tensor parallelism E is sharded along V (vocab-parallel embedding + all-reduce).</li></ul>'
          },
          {
            say: 'That table holds over a billion parameters, about two gigabytes, for a seventy billion parameter model. The output layer needs another table of the same size.',
            card: { tag: 'NUMBERS', title: 'Size of the table', stat: { v: '1.05', u: 'B params', l: '128,256 × 8,192 = 2.1 GB in BF16, and 2.1 GB more for W_U' } },
            deep: '<table><tr><th>Model</th><th>V × d</th><th>params</th><th>share</th></tr>' +
              '<tr><td>Llama 3 70B (untied)</td><td>128,256 × 8,192</td><td>2 × 1.05 B</td><td>3%</td></tr>' +
              '<tr><td>Llama 3 8B (untied)</td><td>128,256 × 4,096</td><td>2 × 0.53 B</td><td>13%</td></tr>' +
              '<tr><td>Llama 3.2 1B (tied)</td><td>128,256 × 2,048</td><td>0.26 B</td><td>21%</td></tr></table>' +
              '<p>The share grows as models shrink, which is why small models care about vocabulary size and tying.</p>'
          },
          {
            say: 'Small models often tie it to the output layer, reusing the same matrix transposed to turn the final vector back into logits. Large models usually keep the two tables separate.',
            card: { tag: 'TRADE-OFF', title: 'Tie the table or not', body: 'Tying saves V·d parameters and forces input and output geometry to agree. It matters at 1B scale, not at 70B.' },
            deep: '<ul><li><b>Tying</b> W<sub>U</sub> = Eᵀ (Press &amp; Wolf 2017) saves V·d params: 21% of a 1B model but 1.5% of a 70B one, so big models untie. Tying forces input and output geometry to agree.</li>' +
              '<li>Some models scale embeddings by √d (Gemma) to match residual-stream magnitudes.</li>' +
              '<li>Many small open models tie (Llama 3.2 1B/3B, Gemma); Llama 3 8B and 70B do not.</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.sp, 400, true);
          S.emb = ctx.group();
          ctx.text(60, 186, 'EMBEDDING LOOKUP   onehot(id)ᵀ · E  =  E[id]', { size: 16, font: 'display', weight: 700, color: 'amber', parent: S.emb });
          /* one-hot as a column aligned with E rows */
          var R = 18, cell = 18, gap = 3, oy = 230;
          var hotRow = 11;
          ctx.text(130, 218, 'onehot', { size: 12, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.emb });
          var oh = ctx.matrix(121, oy, R, 1, { cell: cell, gap: gap, cmap: 'cyan', values: function (r) { return r === hotRow ? 1 : 0.04; }, stroke: ctx.alpha('cyan', 0.35), parent: S.emb });
          ctx.text(130, oy + R * (cell + gap) + 16, 'V entries', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.emb });
          ctx.text(165, oy + hotRow * (cell + gap) + cell / 2, '·fox  id 39935', { size: 12, font: 'mono', color: 'cyan', parent: S.emb });
          var r = ctx.rng(4);
          S.E = ctx.matrix(300, oy, R, 16, { cell: cell, gap: gap, cmap: 'diverge', values: function () { return (r() * 2 - 1) * 0.75; }, parent: S.emb });
          ctx.text(300 + S.E.w / 2, 218, 'E   V = 128,256 rows × d = 8,192', { size: 12, font: 'mono', color: 'amber', anchor: 'middle', parent: S.emb });
          ctx.text(300 + S.E.w / 2, oy + R * (cell + gap) + 16, 'rows shown: 18 of 128,256 · cols: 16 of 8,192', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.emb });
          S.sel = ctx.rect(296, oy + hotRow * (cell + gap) - 4, S.E.w + 8, cell + 8, { rx: 5, stroke: 'white', sw: 2, glow: true, parent: S.emb, opacity: 0 });
          var gOut = ctx.group({ parent: S.emb, opacity: 0 });
          S.outV = ctx.matrix(300, 690, 1, 16, { cell: cell, gap: gap, cmap: 'gray', values: function () { return 0.06; }, parent: gOut });
          ctx.text(290, 699, 'e =', { size: 14, font: 'mono', color: 'white', anchor: 'end', parent: gOut });
          ctx.text(300 + S.E.w / 2, 734, 'e ∈ ℝ^8192 → first residual-stream vector for "·fox"', { size: 12, font: 'mono', color: 'text', anchor: 'middle', parent: gOut });
          ctx.text(300, 780, 'dense matmul would cost 2·V·d = 2.1 GFLOP per token', { size: 12, font: 'mono', color: 'dim', parent: gOut });
          ctx.text(300, 802, 'gather costs 0 FLOPs, 16 KiB of HBM reads', { size: 12, font: 'mono', color: 'lime', parent: gOut });

          /* tied vs untied (beat 3) */
          var c = card(ctx, S.emb, 820, 200, 720, 330, 'violet', 'TIED vs UNTIED OUTPUT');
          c.setAttribute('opacity', 0);
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
          mini(1040, 280, 'Eᵀ', 'amber', 'output (shared)');
          ctx.text(1180, 250, 'untied (Llama 3 8B/70B)', { size: 12, font: 'mono', color: 'violet', parent: c });
          mini(1190, 280, 'E', 'amber', 'input');
          mini(1300, 280, 'W_U', 'orange', 'output (own)');
          ctx.text(840, 476, 'tying saves V·d params: 21% of a 1B model,', { size: 12, font: 'mono', color: 'text', parent: c });
          ctx.text(840, 498, '1.5% of a 70B model → big models untie', { size: 12, font: 'mono', color: 'text', parent: c });
          /* size of the table (beat 2) */
          var c2 = card(ctx, S.emb, 820, 560, 720, 310, 'amber', 'SIZE OF THE TABLE');
          c2.setAttribute('opacity', 0);
          S.sizeTxt = ctx.text(840, 626, '', { size: 26, font: 'mono', weight: 700, color: 'amber', parent: c2 });
          ctx.para(840, 676, ['= 128,256 × 8,192 parameters', '= 2.1 GB in BF16 (another 2.1 GB for W_U)', 'sharded along V under tensor parallelism', 'grad is row-sparse: only seen ids update'], { size: 13, font: 'mono', color: 'text', lh: 30, parent: c2 });
          var rowVals = S.E.cells[hotRow].map(function (el) { return el.getAttribute('fill'); });
          /* beat 0: the one-hot vector and the table */
          return ctx.reveal(S.emb, { from: 'up' }).then(function () {
            return ctx.pulse(oh.cells[hotRow][0], { color: 'cyan', dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the hot row is gathered */
            ctx.reveal(gOut, { dur: 300 });
            return ctx.reveal(S.sel, { dur: 400 }).then(function () {
              var fly = ctx.group({ parent: S.emb });
              rowVals.forEach(function (f, k) { ctx.rect(300 + k * (cell + gap), oy + hotRow * (cell + gap), cell, cell, { rx: 3, fill: f, parent: fly }); });
              return ctx.transform(fly, { y: 690 - (oy + hotRow * (cell + gap)) }, 800, 'inOut').then(function () {
                if (fly.parentNode) fly.parentNode.removeChild(fly);
                S.outV.cells[0].forEach(function (el, k) { el.setAttribute('fill', rowVals[k]); });
              });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: how big the table is */
            ctx.reveal(c2, { from: 'up', dur: 500 });
            return ctx.wait(400).then(function () { return ctx.counter(S.sizeTxt, 0, 1050673152, 1200); });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: tied and untied output layers */
            ctx.reveal(c, { from: 'up', dur: 500 });
            return ctx.wait(500).then(function () { return ctx.pulse(c, { color: 'violet', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 7 */
      {
        title: 'Geometry of meaning',
        beats: [
          {
            say: 'Training arranges the embedding vectors so that geometry carries meaning. Here is a two dimensional map: animals cluster in one corner, space words in another, and cold things in a third.',
            card: { tag: 'KEY IDEA', title: 'Usage becomes location', body: 'Tokens used in similar contexts get similar vectors, so meaning shows up as clusters in the space.' },
            deep: '<p>The 2-D map is an illustrative projection (think PCA or UMAP of a few token embeddings); real embeddings live in 4k–16k dimensions.</p>' +
              '<p>Clusters emerge because the training loss rewards vectors that predict the same neighbours: <code>fox</code>, <code>wolf</code> and <code>cat</code> appear in interchangeable contexts, so gradient descent moves them together (the distributional hypothesis).</p>'
          },
          {
            say: 'Similarity is measured by the angle between vectors, the cosine. Fox sits close to wolf, with a cosine near one, and nearly orthogonal to moon.',
            card: { tag: 'HOW IT WORKS', title: 'Similarity is an angle', body: 'Cosine ignores length and compares direction: 1 means the same direction, 0 unrelated.' },
            deep: '<div class="eq">cos(u, v) = u·v / (‖u‖ ‖v‖)</div>' +
              '<ul><li><b>Anisotropy</b>: raw LLM embeddings share a common mean direction and a few massive outlier dimensions, so raw cosine is inflated; centring or whitening helps retrieval.</li>' +
              '<li>Input embeddings are only layer 0: meaning is refined along the residual stream; contextual vectors for "moon" after "ice" differ from "moon" after "honey".</li></ul>'
          },
          {
            say: 'Now click any dot to see its cosine similarity to every other word. Neighbours in the same cluster score close to one, while words from other clusters score far lower, even negative.',
            card: { tag: 'TRY IT', title: 'Click a word', body: 'The readout lists the two closest words and the least similar one. Try ice, then rocket: close friends inside a cluster, strangers outside it.' },
            deep: '<p>Every dot is a token, and the readout is cos(u, v) against the other nine on this 2-D map. In a real model you would run the same ranking over all 128,256 rows of E; nearest-neighbour lookups like this are how embedding models, retrieval indexes and interpretability tools find related items.</p>' +
              '<div class="eq">nearest(q) = arg max<sub>i</sub> E<sub>i</sub>·q / (‖E<sub>i</sub>‖ ‖q‖)</div>' +
              '<p class="muted">Cosines here come from the illustrative 2-D positions. In a real embedding matrix unrelated words are rarely negative: anisotropy pushes typical cosines above zero, so compare with the average, not with zero.</p>'
          },
          {
            say: 'Directions encode features. The classic example is king minus man plus woman landing near queen: the same gender offset is reused in different places.',
            card: { tag: 'HOW IT WORKS', title: 'Offsets are reusable', more: '<p>Why a parallelogram: if v(woman) − v(man) ≈ v(queen) − v(king) ≈ g, a shared "gender" direction, then the four points span a parallelogram and v(queen) ≈ v(king) + g. The analogy test returns the vector nearest to that point by cosine, excluding the three query words.</p>', body: 'The vector from man to woman is roughly the vector from king to queen: one direction, many uses.' },
            deep: '<p><b>Analogies</b>: <code>v(king) − v(man) + v(woman) ≈ v(queen)</code> holds approximately in word2vec-style spaces (nearest neighbour excluding the inputs; Mikolov et al. 2013).</p>' +
              '<p>In contextual LLM spaces it is messier, but the same idea of a consistent <i>offset</i> per relation shows up as steerable directions for tense, sentiment, language and topic.</p>'
          },
          {
            say: 'In large models this becomes the linear representation hypothesis: concepts such as cold, or space travel, or the fox character are directions in the residual stream that later layers read out. In eight thousand dimensions there is room for a huge number of nearly orthogonal directions.',
            card: { tag: 'NUMBERS', title: 'Random means orthogonal', stat: { v: '0.011', l: 'typical |cos| of two random directions in 8,192 dimensions: 1/√d' } },
            deep: '<p>The 2-D map hides the key fact: in d = 8,192 dimensions random vectors are nearly orthogonal (cos ≈ 0 ± 1/√d ≈ 0.011), so there is room for far more than d nearly independent feature directions.</p>' +
              '<ul><li><b>Linear representation hypothesis</b>: high-level concepts are directions; linear probes recover them, and adding a direction (activation steering) changes behaviour predictably (Park et al. 2024).</li>' +
              '<li>Probe: <code>sign(r<sub>c</sub>·h)</code>. Steer: <code>h ← h + α r<sub>c</sub></code>. The next step shows how sparse features pack into fewer dimensions.</li></ul>' +
              '<details><summary>Go deeper</summary><p>For unit vectors drawn uniformly on the sphere S<sup>d−1</sup>, P(|cos| ≥ ε) ≤ 2e<sup>−dε²/2</sup>. A union bound over the N²/2 pairs shows that about e<sup>dε²/4</sup> vectors can coexist with every pairwise |cos| ≤ ε. At d = 8,192 and ε = 0.1 that is e<sup>20.5</sup> ≈ 8·10<sup>8</sup> directions, far more than the 128k tokens, or the many more features, a model may want to store.</p></details>'
          }
        ],
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
            var p = pts[k], g = ctx.group({ parent: S.geo, opacity: 0 });
            ctx.circle(O.x + p[0], O.y + p[1], 6, { fill: p[2], parent: g, glow: true });
            ctx.circle(O.x + p[0], O.y + p[1], 17, { fill: 'rgba(255,255,255,0.001)', parent: g });
            ctx.text(O.x + p[0] + 10, O.y + p[1] - 10, k, { size: 13, font: 'mono', color: p[2], parent: g });
            S.pt[k] = { x: O.x + p[0], y: O.y + p[1] };
            g.style.cursor = 'pointer';
            g.addEventListener('click', function (ev) { ev.stopPropagation(); S.selWord(k); });
            return g;
          });
          /* cosine arcs from fox (beat 1) */
          S.vecs = ctx.group({ parent: S.geo, opacity: 0 });
          var vf = ctx.path('M' + O.x + ',' + O.y + ' L' + S.pt.fox.x + ',' + S.pt.fox.y, { stroke: 'orange', sw: 2, arrow: true, parent: S.vecs });
          var vw = ctx.path('M' + O.x + ',' + O.y + ' L' + S.pt.wolf.x + ',' + S.pt.wolf.y, { stroke: ctx.alpha('orange', 0.6), sw: 1.5, arrow: true, parent: S.vecs });
          var vm = ctx.path('M' + O.x + ',' + O.y + ' L' + S.pt.moon.x + ',' + S.pt.moon.y, { stroke: ctx.alpha('cyan', 0.6), sw: 1.5, arrow: true, parent: S.vecs });
          function cosv(a, b) { var ax = a.x - O.x, ay = a.y - O.y, bx = b.x - O.x, by = b.y - O.y; return (ax * bx + ay * by) / Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by)); }
          ctx.label(S.pt.wolf.x + 30, S.pt.wolf.y + 46, 'cos(fox, wolf) = ' + cosv(S.pt.fox, S.pt.wolf).toFixed(2), { color: 'orange', size: 11, parent: S.vecs });
          ctx.label(610, 470, 'cos(fox, moon) = ' + cosv(S.pt.fox, S.pt.moon).toFixed(2), { color: 'cyan', size: 11, parent: S.vecs });

          /* analogy parallelogram in its own corner (beat 2) */
          S.ana = ctx.group({ parent: S.geo, opacity: 0 });
          var A = { man: { x: 640, y: 700 }, king: { x: 700, y: 610 }, woman: { x: 800, y: 740 } };
          A.queen = { x: A.king.x + (A.woman.x - A.man.x) + 6, y: A.king.y + (A.woman.y - A.man.y) - 5 };
          Object.keys(A).forEach(function (k) {
            ctx.circle(A[k].x, A[k].y, 5, { fill: 'violet', parent: S.ana, glow: true });
            ctx.text(A[k].x + 9, A[k].y + (k === 'woman' ? 16 : -10), k, { size: 13, font: 'mono', color: 'violet', parent: S.ana });
          });
          ctx.line(A.man.x, A.man.y, A.king.x, A.king.y, { color: ctx.alpha('violet', 0.35), sw: 1, dash: '2 4', parent: S.ana });
          ctx.line(A.woman.x, A.woman.y, A.queen.x, A.queen.y, { color: ctx.alpha('violet', 0.35), sw: 1, dash: '2 4', parent: S.ana });
          S.a1 = ctx.path('M' + A.man.x + ',' + A.man.y + ' L' + A.woman.x + ',' + A.woman.y, { stroke: 'violet', sw: 1.8, arrow: true, parent: S.ana });
          S.a2 = ctx.path('M' + A.king.x + ',' + A.king.y + ' L' + (A.queen.x - 3) + ',' + (A.queen.y + 2), { stroke: 'pink', sw: 1.8, arrow: true, dash: '5 4', parent: S.ana });
          ctx.text(600, 800, 'king − man + woman ≈ queen', { size: 13, font: 'mono', weight: 700, color: 'pink', parent: S.ana });
          ctx.text(600, 822, 'same "gender" offset, reused', { size: 11, font: 'mono', color: 'dim', parent: S.ana });

          var ca = card(ctx, S.geo, 1000, 180, 540, 214, 'amber', 'SIMILARITY = ANGLE');
          ca.setAttribute('opacity', 0);
          ctx.para(1020, 232, ['cos(u,v) = u·v / (|u| |v|)', 'similar usage → similar direction', 'clusters: animals · space · cold'], { size: 14, font: 'code', color: 'text', lh: 30, parent: ca });
          keepWS(ca);
          /* click-to-select readout (beat 2): ring, vector and a ranked cosine list */
          S.selRing = ctx.circle(0, 0, 10, { stroke: 'white', sw: 2, parent: S.geo, glow: true, opacity: 0 });
          S.selVec = ctx.path('M' + O.x + ',' + O.y + ' L' + O.x + ',' + O.y, { stroke: 'white', sw: 1.6, dash: '4 4', arrow: true, parent: S.geo, opacity: 0 });
          S.selT1 = ctx.text(1020, 340, 'click a dot on the map', { size: 13, font: 'code', color: 'white', parent: ca, opacity: 0 });
          S.selT2 = ctx.text(1020, 366, '', { size: 12, font: 'code', color: 'dim', parent: ca, opacity: 0 });
          S.selWord = function (k) {
            if (!S.selReady) return;
            var others = Object.keys(pts).filter(function (q) { return q !== k; }).map(function (q) { return [q, cosv(S.pt[k], S.pt[q])]; });
            others.sort(function (a, b) { return b[1] - a[1]; });
            /* the selected word and its two nearest neighbours stay bright, everything else dims */
            var keep = [k, others[0][0], others[1][0]];
            Object.keys(pts).forEach(function (q, i) { dots[i].setAttribute('opacity', keep.indexOf(q) >= 0 ? 1 : 0.35); });
            S.selRing.setAttribute('cx', S.pt[k].x); S.selRing.setAttribute('cy', S.pt[k].y); S.selRing.setAttribute('opacity', 1);
            S.selVec.setAttribute('d', 'M' + O.x + ',' + O.y + ' L' + S.pt[k].x + ',' + S.pt[k].y); S.selVec.setAttribute('opacity', 1);
            function f(o) { return o[0] + ' ' + (o[1] < -0.005 ? '−' : '') + Math.abs(o[1]).toFixed(2); }
            S.selT1.textContent = 'cos(' + k + ', ·):  ' + others.slice(0, 2).map(f).join('  ') + '  …';
            S.selT2.textContent = 'least similar:  ' + f(others[others.length - 1]);
          };
          var cb = card(ctx, S.geo, 1000, 414, 540, 456, 'amber', 'DIRECTIONS = FEATURES');
          cb.setAttribute('opacity', 0);
          ctx.para(1020, 464, ['linear representation hypothesis:', ' concept c ↔ direction r_c', ' probe:  sign(r_c · h)', ' steer:  h ← h + α r_c', '', 'in d = 8,192 dims, random vectors', 'have |cos| ≈ 1/√d ≈ 0.011', '→ room for many near-orthogonal', '  directions (see superposition)'], { size: 14, font: 'code', color: 'text', lh: 30, parent: cb });
          keepWS(cb);
          /* beat 0: the map and its clusters */
          return ctx.reveal(S.geo, { from: 'fade' }).then(function () {
            return ctx.reveal(dots, { from: 'scale', stagger: 80 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: cosine similarity */
            ctx.reveal(S.vecs, {});
            ctx.reveal(ca, { from: 'up', dur: 500 });
            return ctx.reveal([vf, vw, vm], { from: 'draw', stagger: 200 });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: click any word: ranked cosines. Two example clicks, ending on ice */
            ctx.reveal([S.selT1, S.selT2], { dur: 300 });
            S.selReady = true;
            S.selWord('rocket');
            return ctx.wait(1100).then(function () {
              S.selWord('ice');
              return ctx.pulse(S.selRing, { color: 'white', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: the king, queen analogy (the selection dims are cleared first) */
            ctx.fade(dots, 1, 300);
            ctx.fade([S.selRing, S.selVec], 0, 300);
            S.ana.setAttribute('opacity', 1);
            ctx.reveal(S.ana, {});
            return ctx.reveal([S.a1, S.a2], { from: 'draw', stagger: 500, dur: 700 }).then(function () {
              return ctx.camera(720, 700, 1.7, 900);
            }).then(function () { return ctx.wait(1000); }).then(function () { return ctx.camera(null, null, null, 800); });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: directions are features */
            ctx.reveal(cb, { from: 'up', dur: 500 });
            return ctx.wait(500).then(function () { return ctx.pulse(cb, { color: 'amber', dur: 700 }); });
          });
        }
      },
      /* ------------------------------------------------------------ 8 */
      {
        title: 'One sequence, all modes',
        beats: [
          {
            say: 'Now the sequence itself. It is not only text. The director sees the system prompt and tools, then the request, then hundreds of tokens for each style sketch, then the voice memo as audio tokens.',
            card: { tag: 'KEY IDEA', title: 'One sequence, many modes', body: 'Text, sketches and audio share a single sequence: about three thousand positions for this request.' },
            deep: '<div class="eq">X = [E[text ids] ; P<sub>img</sub>(ViT(sketch)) ; P<sub>aud</sub>(Enc(memo)) ; …] ∈ ℝ<sup>T×d</sup></div>' +
              '<p>The bar is drawn to scale: system prompt and tool schemas ≈ 1,200 tokens, the request 33, three sketches 3 × 256, the 42 s memo ≈ 1,050, and the running text ≈ 60, for T ≈ 3,111 positions. Real agent contexts are several times longer once history accumulates.</p>'
          },
          {
            say: 'Each modality has its own encoder and a small projector into the same width as the text embeddings. After that point, the transformer cannot tell where a row came from, except through learned content and positions.',
            card: { tag: 'HOW IT WORKS', title: 'Encoders plus projectors', body: 'Text is a gather. Images go through a ViT, audio through a speech encoder, and each through an MLP projector into ℝ^d.' },
            deep: nolig('<ul><li><b>Images</b>: ViT patches (14 px) → 2×2 merge → MLP projector into ℝ<sup>d</sup>. A 448×448 sketch → 32×32 patches → 256 tokens after the merge (Qwen2-VL-style).</li>' +
              '<li><b>Audio</b>: Whisper-style encoder at 50 frames/s, pooled 2× → 25 tokens/s.</li>' +
              '<li>Placeholders such as <code>&lt;|image_pad|&gt;</code> reserve positions; the embedding gather is replaced by encoder outputs at those positions (multimodal RoPE assigns 2-D and temporal positions).</li></ul>')
          },
          {
            say: 'The cost adds up quickly. A sketch becomes two hundred fifty six tokens and the forty two second memo about one thousand fifty, so more than half of all positions in this request are not text.',
            card: { tag: 'NUMBERS', title: 'Pixels and sound cost', stat: { v: '58%', u: 'not text', l: '1,818 of 3,111 positions come from sketches and the voice memo' } },
            deep: '<ul><li><b>Images</b>: a 448×448 sketch → 32×32 patches → <b>256 tokens</b> after 2×2 merging; higher resolutions or native-resolution packing cost proportionally more.</li>' +
              '<li><b>Audio</b>: 25 tokens/s, so the 42 s memo ≈ <b>1,050 tokens</b>.</li></ul>' +
              '<p>Attention over these positions scales with T², so token compression (pooling, Q-Former-style resamplers, pruning of redundant frames) is a first-class design lever in multimodal models.</p>'
          },
          {
            say: 'One more idea: superposition. A model must represent far more features than it has dimensions, so it packs them as almost orthogonal directions, like five features squeezed into two dimensions, and tolerates a little interference because each feature is rarely active.',
            card: { tag: 'KEY IDEA', title: 'More features than dims', more: '<p>Pentagon: five unit vectors 72° apart have pairwise cosine cos 72° = 0.309 (cos 144° = −0.809 for non-neighbours). Sparse features rarely co-fire, so a ReLU readout can suppress the interference; dense features would be wrecked by it.</p>', body: 'Sparse features can share dimensions as nearly orthogonal directions. The price is interference, and polysemantic neurons.' },
            deep: '<p><b>Superposition</b> (Elhage et al. 2022): with sparse features, a layer of width d can store n ≫ d features as nearly orthogonal directions; readout via ReLU/thresholding suppresses interference. In the toy model, 5 features in 2-D form a pentagon.</p>' +
              '<p>This is why individual neurons are <i>polysemantic</i>: see the Neuron chamber and sparse autoencoders, which recover the features.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          ctx.fadeOut(S.geo, 400, true);
          S.mm = ctx.group();
          ctx.text(60, 186, 'THE DIRECTOR\'S INPUT SEQUENCE   one matrix X ∈ ℝ^(T×d)', { size: 16, font: 'display', weight: 700, color: 'violet', parent: S.mm });
          var segs = [['system + tools', 1200, 'amber'], ['prompt', 33, 'cyan'], ['sketch 1', 256, 'violet'], ['sketch 2', 256, 'violet'], ['sketch 3', 256, 'violet'], ['voice memo 42 s', 1050, 'orange'], ['text', 60, 'cyan']];
          var tot = segs.reduce(function (a, s) { return a + s[1]; }, 0);
          var x = 60, W = 1480;
          S.segEls = segs.map(function (s, i) {
            var w = Math.max(10, W * s[1] / tot);
            var g = ctx.group({ parent: S.mm, opacity: 0 });
            ctx.rect(x, 214, w - 3, 44, { rx: 5, fill: ctx.alpha(s[2], 0.28), stroke: s[2], sw: 1.2, parent: g });
            var small = w < 90;
            ctx.text(small ? x + w / 2 : x + 10, small ? 276 + (i % 2) * 18 : 236, s[0] + (small ? '' : '  ' + s[1]), { size: 12, font: 'mono', color: small ? s[2] : 'white', anchor: small ? 'middle' : 'start', parent: g });
            x += w;
            return g;
          });
          var tTxt = ctx.text(1540, 312, 'T ≈ ' + tot.toLocaleString('en-US') + ' positions', { size: 13, font: 'mono', weight: 700, color: 'white', anchor: 'end', parent: S.mm, opacity: 0 });
          var nonText = ctx.label(60, 310, 'non-text: 1,818 of ' + tot.toLocaleString('en-US') + ' positions (58%)', { color: 'violet', size: 12, anchor: 'start', parent: S.mm, opacity: 0 });

          /* modality paths into d-dim rows (beat 1) */
          var c = card(ctx, S.mm, 60, 340, 900, 530, 'violet', 'EVERY MODALITY BECOMES ROWS OF X');
          c.setAttribute('opacity', 0);
          var rows = [['"·fox"', 'gather E[id]', 'amber', 'lookup'], ['sketch 1', 'ViT 14px + 2×2 merge', 'violet', 'MLP projector'], ['memo 0.04 s', 'Whisper-style enc.', 'orange', 'MLP projector']];
          S.mRows = rows.map(function (rw, i) {
            var y = 420 + i * 140, g = ctx.group({ parent: c, opacity: 0 });
            ctx.label(150, y, rw[0], { color: rw[2], size: 13, w: 150, parent: g });
            var n1 = ctx.node({ x: 380, y: y, w: 200, h: 52, title: rw[1], color: rw[2], titleSize: 12, parent: g, glow: false });
            var n2 = ctx.node({ x: 580, y: y, w: 130, h: 44, title: rw[3], color: rw[2], titleSize: 12, parent: g, glow: false });
            ctx.line(226, y, 278, y, { color: rw[2], arrow: true, parent: g });
            ctx.line(481, y, 513, y, { color: rw[2], arrow: true, parent: g });
            ctx.line(646, y, 690, y, { color: rw[2], arrow: true, parent: g });
            var rr = ctx.rng(30 + i);
            ctx.matrix(700, y - 9, 1, 12, { cell: 16, gap: 3, cmap: 'diverge', values: function () { return rr() * 2 - 1; }, parent: g });
            ctx.text(700, y + 26, '∈ ℝ^8192', { size: 11, font: 'mono', color: 'dim', parent: g });
            if (i === 1) ctx.text(150, y + 34, '× 256 tokens', { size: 11, font: 'mono', color: 'violet', anchor: 'middle', parent: g });
            if (i === 2) ctx.text(150, y + 34, '× 1050 (25 / s)', { size: 11, font: 'mono', color: 'orange', anchor: 'middle', parent: g });
            return g;
          });
          ctx.text(80, 850, 'after this point the transformer cannot tell where a row came from, except through learned content and positions', { size: 11, font: 'mono', color: 'dim', parent: c });

          /* superposition pentagon (beat 3) */
          var c2 = card(ctx, S.mm, 1000, 340, 540, 530, 'pink', 'SUPERPOSITION  5 features in 2-D');
          c2.setAttribute('opacity', 0);
          var C0 = { x: 1270, y: 600 }, Rr = 150;
          S.feat = [];
          var names = ['fox', 'ice', 'space', 'glow', 'crash'];
          for (var k = 0; k < 5; k++) {
            var a = -Math.PI / 2 + k * 2 * Math.PI / 5;
            var tip = { x: C0.x + Rr * Math.cos(a), y: C0.y + Rr * Math.sin(a) };
            var l = ctx.path('M' + C0.x + ',' + C0.y + ' L' + tip.x.toFixed(1) + ',' + tip.y.toFixed(1), { stroke: 'pink', sw: 2.2, arrow: true, parent: c2 });
            ctx.text(C0.x + (Rr + 24) * Math.cos(a), C0.y + (Rr + 22) * Math.sin(a), names[k], { size: 13, font: 'mono', color: 'pink', anchor: 'middle', parent: c2 });
            S.feat.push(l);
          }
          ctx.circle(C0.x, C0.y, Rr, { stroke: ctx.alpha('pink', 0.2), dash: '3 5', parent: c2 });
          ctx.text(1020, 800, 'angle 72°: cos = 0.31 interference', { size: 12, font: 'mono', color: 'text', parent: c2 });
          ctx.text(1020, 822, 'fine if features are sparse (rarely co-active)', { size: 12, font: 'mono', color: 'dim', parent: c2 });
          ctx.text(1020, 844, '→ polysemantic neurons, SAEs untangle them', { size: 12, font: 'mono', color: 'dim', parent: c2 });
          S.feat.forEach(function (l) { l.setAttribute('opacity', 0); });
          /* beat 0: the sequence, segment by segment */
          return ctx.reveal(S.mm, { from: 'up' }).then(function () {
            return ctx.reveal(S.segEls, { from: 'left', stagger: 160, dur: 350 });
          }).then(function () {
            return ctx.reveal(tTxt, {});
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: each modality becomes rows of X */
            ctx.reveal(c, { from: 'up', dur: 500 });
            return ctx.wait(400).then(function () { return ctx.reveal(S.mRows, { from: 'up', stagger: 300 }); });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: how many positions are not text */
            ctx.reveal(nonText, { from: 'down', dur: 400 });
            return Promise.all([S.segEls[2], S.segEls[3], S.segEls[4], S.segEls[5]].map(function (g, i) {
              return ctx.wait(i * 150).then(function () { return ctx.pulse(g, { color: 'violet', dur: 600 }); });
            }));
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: superposition */
            ctx.reveal(c2, { from: 'up', dur: 500 });
            return ctx.wait(500).then(function () { return ctx.reveal(S.feat, { from: 'draw', stagger: 180, dur: 500 }); });
          });
        }
      }
    ]
  });
})();
