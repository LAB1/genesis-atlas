/* Atlas engine: scene registry, navigation, zoom transitions, beat-by-beat playback (Auto / Step),
 * narration sync, callout cards, progressive deep-dive rail, references page, settings, themes. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var X = window.AtlasCtx;
  var W = X.W, H = X.H, C = X.C;
  var N = window.AtlasNarrator;

  function $(s) { return document.querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function strip(html) { var d = document.createElement('div'); d.innerHTML = html || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim(); }
  function words(s) { s = String(s || '').trim(); return s ? s.split(/\s+/).length : 0; }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return null; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var DEFAULTS = { mode: 'auto', rate: 1, pause: 1, voiceMode: 'studio', voiceName: '', theme: 'dark', rails: true };

  var Engine = {
    scenes: {},          /* registered implementations */
    catalog: {},         /* id -> meta */
    order: [],
    cur: null,           /* { id, ctx, wrap, step, bt, beatIdx, idle, wait } */
    settings: Object.assign({}, DEFAULTS),
    playing: true,       /* auto mode only: false = paused */
    tour: null,          /* { list, i, name } */
    visited: {},
    speed: 1,
    refList: [],
    _stepToken: 0,
    _timer: 0,
    _raf: 0,
    _etweens: [],
    _last: 0,
    _busy: false
  };

  /* ---------------- registry ---------------- */
  Engine.register = function (def) {
    if (!def || !def.id) { console.error('Atlas.register: missing id'); return; }
    if (!Engine.catalog[def.id]) console.warn('Atlas.register: scene not in catalog:', def.id);
    Engine.scenes[def.id] = def;
  };

  Engine.meta = function (id) { return Engine.catalog[id] || null; };
  Engine.children = function (id) { return Engine.order.filter(function (m) { return m.parent === id; }); };
  Engine.path = function (id) { var p = [], m = Engine.meta(id); while (m) { p.unshift(m); m = Engine.meta(m.parent); } return p; };
  Engine.isAncestor = function (a, b) { var m = Engine.meta(b); while (m && m.parent) { if (m.parent === a) return true; m = Engine.meta(m.parent); } return false; };

  function initCatalog() {
    (window.ATLAS_CATALOG || []).forEach(function (m) {
      m.colorHex = C[m.color] || m.color || C.cyan;
      Engine.catalog[m.id] = m;
      Engine.order.push(m);
    });
    var dfs = [];
    (function walk(id) { dfs.push(id); Engine.children(id).forEach(function (c) { walk(c.id); }); })('overview');
    Engine.dfs = dfs;
    window.ATLAS_TOURS.deep = dfs;
  }

  /* global reference numbering: identical references in different chambers share one number */
  function buildRefs() {
    var byKey = {};
    Engine.refList = [];
    Engine.order.forEach(function (m) {
      var impl = Engine.scenes[m.id];
      if (!impl) return;
      impl._refNums = [];
      (impl.refs || []).forEach(function (r) {
        var key = strip(r).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        var e = byKey[key];
        if (!e) {
          e = { n: Engine.refList.length + 1, html: r, text: strip(r), scenes: [] };
          byKey[key] = e; Engine.refList.push(e);
        }
        if (e.scenes.indexOf(m.id) < 0) e.scenes.push(m.id);
        impl._refNums.push(e.n);
      });
    });
  }

  /* ---------------- frame driver ---------------- */
  Engine._wake = function () {
    if (Engine._raf) return;
    Engine._last = performance.now();
    Engine._raf = requestAnimationFrame(Engine._frame);
  };

  Engine._frame = function (now) {
    var dt = Math.min(64, now - Engine._last);
    Engine._last = now;
    var active = false;
    var tws = Engine._etweens;
    for (var i = 0; i < tws.length; i++) {
      var tw = tws[i];
      if (tw.start === null) tw.start = now;
      var p = Math.min(1, (now - tw.start) / tw.dur);
      tw.fn(tw.ease(p));
      if (p >= 1) { tw.done = true; tw.resolve(); } else active = true;
    }
    Engine._etweens = tws.filter(function (t) { return !t.done; });
    if (Engine._leaving && Engine._leaving.ctx && !Engine._leaving.ctx.dead) { if (Engine._leaving.ctx._tick(now, dt)) active = true; }
    if (Engine.cur && Engine.cur.ctx && Engine.cur.ctx._tick(now, dt)) active = true;
    if (active || Engine._etweens.length) Engine._raf = requestAnimationFrame(Engine._frame);
    else Engine._raf = 0;
  };

  function etween(dur, fn, ease) {
    ease = ease || X.Ease.inOut;
    return new Promise(function (resolve) {
      Engine._etweens.push({ dur: dur, fn: fn, ease: ease, start: null, resolve: resolve, done: false });
      Engine._wake();
    });
  }

  function setWrapTf(wrap, cx, cy, s, op) {
    wrap.setAttribute('transform', 'translate(' + (W / 2) + ',' + (H / 2) + ') scale(' + s + ') translate(' + (-cx) + ',' + (-cy) + ')');
    if (op !== undefined) wrap.setAttribute('opacity', op.toFixed(3));
    if (wrap._ctx) wrap._ctx._setWrap(cx, cy, s, op);   /* keep the canvas overlay in sync */
  }

  /* ---------------- scene build ---------------- */
  function placeholderScene(meta) {
    return {
      id: meta.id,
      steps: [{
        title: meta.title,
        say: meta.title + '. ' + meta.summary,
        deep: '<p>' + esc(meta.summary) + '</p><p class="muted">This chamber is still being assembled.</p>',
        run: function (ctx) {
          var kids = Engine.children(meta.id);
          var hub = ctx.node({ x: 800, y: 330, w: 560, h: 110, title: meta.title, sub: meta.kicker, color: meta.colorHex, titleSize: 26, subSize: 14 });
          ctx.reveal(hub, { from: 'scale' });
          var n = kids.length;
          kids.forEach(function (k, i) {
            var x = 800 + (i - (n - 1) / 2) * Math.min(300, 1300 / Math.max(1, n));
            var nd = ctx.node({ x: x, y: 600, w: 250, h: 70, title: k.title, sub: k.kicker, color: k.colorHex, titleSize: 14 });
            var l = ctx.link(hub, nd, { color: k.colorHex, flow: true });
            ctx.reveal(l, { from: 'draw', delay: 200 + i * 120 });
            ctx.reveal(nd, { from: 'up', delay: 300 + i * 120 });
            ctx.hotspot(nd, k.id);
          });
          return ctx.wait(800);
        }
      }]
    };
  }

  Engine.impl = function (id) {
    return Engine.scenes[id] || placeholderScene(Engine.meta(id));
  };

  /* Build a scene into a fresh wrapper; fast-forward steps [0, upto) instantly. */
  Engine._build = function (id, upto) {
    var meta = Engine.meta(id);
    var impl = Engine.impl(id);
    var wrap = document.createElementNS(NS, 'g');
    wrap.setAttribute('class', 'scene-wrap');
    wrap.setAttribute('visibility', 'hidden');
    var layer = document.createElementNS(NS, 'g');
    layer.setAttribute('class', 'scene-layer');
    wrap.appendChild(layer);
    Engine.camEl.appendChild(wrap);
    var ctx = new X.SceneCtx({ engine: Engine, scene: impl, layer: layer, cam: wrap, stageEl: Engine.canvasHost, instant: true, speed: Engine.speed || 1 });
    wrap._ctx = ctx;
    var chain = Promise.resolve();
    chain = chain.then(function () { if (impl.setup) return impl.setup(ctx); });
    var steps = impl.steps || [];
    for (var i = 0; i < upto && i < steps.length; i++) {
      (function (st) {
        chain = chain.then(function () { return st.run ? st.run(ctx) : null; }).catch(function (e) { reportError(meta, st, e); });
      })(steps[i]);
    }
    return chain.catch(function (e) { reportError(meta, null, e); }).then(function () {
      ctx.instant = false;
      wrap.removeAttribute('visibility');
      return { id: id, meta: meta, impl: impl, ctx: ctx, wrap: wrap, step: upto - 1 };
    });
  };

  function reportError(meta, step, e) {
    console.error('[scene ' + (meta && meta.id) + (step ? ' / ' + step.title : '') + ']', e);
    toast('Animation glitch in "' + (step ? step.title : (meta && meta.title)) + '" — continuing.');
  }

  function teardown(s) {
    if (!s) return;
    if (s.ctx) s.ctx.destroy();
    if (s.wrap && s.wrap.parentNode) s.wrap.parentNode.removeChild(s.wrap);
  }

  /* ---------------- navigation ---------------- */
  /* opts: { step (0-based), beat, transition: 'zoomIn'|'zoomOut'|'fade'|'none', box: {x,y,w,h} } */
  Engine.go = function (id, opts) {
    opts = opts || {};
    if (!Engine.meta(id)) id = 'overview';
    if (Engine._busy) { Engine._queued = [id, opts]; return Promise.resolve(); }
    Engine._busy = true;
    stopAll();
    var prev = Engine.cur;
    var step = Math.max(0, opts.step || 0);
    var impl = Engine.impl(id);
    step = Math.min(step, Math.max(0, (impl.steps || []).length - 1));
    var trans = opts.transition;
    if (!trans) {
      if (!prev) trans = 'fade';
      else if (Engine.isAncestor(prev.id, id)) trans = 'zoomIn';
      else if (Engine.isAncestor(id, prev.id)) trans = 'zoomOut';
      else if (prev.id === id) trans = 'none';
      else trans = 'fade';
    }
    if (prev && prev.id !== id && trans === 'zoomIn') {
      Engine._zoomMemo = Engine._zoomMemo || {};
      Engine._zoomMemo[id] = opts.box || null;
    }
    var backBox = trans === 'zoomOut' && prev && Engine._zoomMemo ? Engine._zoomMemo[prev.id] : null;
    if (prev && prev.ctx) prev.ctx.destroy(true);   /* freeze outgoing scene (its canvas fades with the wrap) */
    Engine.setHud('');
    return Engine._build(id, step).then(function (next) {
      next.wrap.setAttribute('opacity', 0);
      next.ctx._setWrap(null, null, null, 0);
      Engine.cur = next;
      markVisited(id);
      updateChrome();
      return transition(prev, next, trans, opts.box, backBox).then(function () {
        teardown(prev);
        Engine._busy = false;
        if (Engine._queued) { var q = Engine._queued; Engine._queued = null; return Engine.go(q[0], q[1]); }
        return Engine.playStep(step, { startBeat: opts.beat || 0 });
      });
    });
  };

  function transition(prev, next, kind, box, backBox) {
    var bg = Engine.bgEl;
    if (!prev || kind === 'none') {
      return etween(prev ? 10 : 700, function (t) { setWrapTf(next.wrap, W / 2, H / 2, 0.96 + 0.04 * t, t); }, X.Ease.out);
    }
    if (kind === 'zoomIn') {
      var b = box || { x: W / 2 - 200, y: H / 2 - 120, w: 400, h: 240 };
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      var S = Math.min(7, Math.min(W / Math.max(40, b.w), H / Math.max(40, b.h)) * 0.95);
      flash(Engine.meta(next.id).colorHex);
      return Promise.all([
        etween(900, function (t) {
          var s = 1 + (S - 1) * t * t;
          setWrapTf(prev.wrap, W / 2 + (cx - W / 2) * Math.min(1, t * 1.6), H / 2 + (cy - H / 2) * Math.min(1, t * 1.6), s, 1 - Math.max(0, (t - 0.35) / 0.65));
          bg.setAttribute('transform', 'translate(800,450) scale(' + (1 + t * 0.6) + ') translate(-800,-450)');
          bg.setAttribute('opacity', (1 - 0.6 * Math.sin(t * Math.PI)).toFixed(3));
        }, X.Ease.inOut),
        new Promise(function (r) { setTimeout(r, 420); }).then(function () {
          return etween(820, function (t) { setWrapTf(next.wrap, W / 2, H / 2, 0.3 + 0.7 * t, t); }, X.Ease.out);
        })
      ]).then(function () { bg.removeAttribute('transform'); bg.setAttribute('opacity', 1); });
    }
    if (kind === 'zoomOut') {
      var bb = backBox || { x: W / 2 - 200, y: H / 2 - 120, w: 400, h: 240 };
      var bx = bb.x + bb.w / 2, by = bb.y + bb.h / 2;
      var S2 = Math.min(7, Math.min(W / Math.max(40, bb.w), H / Math.max(40, bb.h)) * 0.95);
      return Promise.all([
        etween(700, function (t) { setWrapTf(prev.wrap, W / 2, H / 2, 1 - 0.7 * t, 1 - t); }, X.Ease.inOut),
        etween(950, function (t) {
          var s = S2 + (1 - S2) * t;
          setWrapTf(next.wrap, bx + (W / 2 - bx) * t, by + (H / 2 - by) * t, s, Math.min(1, t * 1.5));
          bg.setAttribute('transform', 'translate(800,450) scale(' + (1.6 - 0.6 * t) + ') translate(-800,-450)');
        }, X.Ease.out)
      ]).then(function () { bg.removeAttribute('transform'); });
    }
    /* lateral crossfade */
    return Promise.all([
      etween(550, function (t) { setWrapTf(prev.wrap, W / 2 + 80 * t, H / 2, 1 - 0.05 * t, 1 - t); }, X.Ease.in),
      new Promise(function (r) { setTimeout(r, 250); }).then(function () {
        return etween(650, function (t) { setWrapTf(next.wrap, W / 2 - 80 * (1 - t), H / 2, 0.95 + 0.05 * t, t); }, X.Ease.out);
      })
    ]);
  }

  function flash(col) {
    var f = Engine.flashEl;
    f.style.background = 'radial-gradient(circle at 50% 50%, ' + X.hexA(col, 0.3) + ', transparent 60%)';
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  }

  Engine.zoomInto = function (id, localBox, el) {
    var box = localBox;
    if (el && el.getBoundingClientRect) {
      var r = el.getBoundingClientRect(), s = Engine.svg.getBoundingClientRect();
      var k = W / s.width;
      box = { x: (r.left - s.left) * k, y: (r.top - s.top) * k, w: r.width * k, h: r.height * k };
    }
    if (Engine.tour) Engine.tour = null;
    return Engine.go(id, { transition: 'zoomIn', box: box });
  };

  Engine.up = function () {
    if (!Engine.cur) return;
    var m = Engine.meta(Engine.cur.id);
    if (m && m.parent) Engine.go(m.parent, { transition: 'zoomOut', step: stepCount(m.parent) - 1 });
  };

  function stepCount(id) { return (Engine.impl(id).steps || []).length || 1; }

  /* ================================================================
   * BEATS
   * A step is a sequence of beats. Each beat = one idea: a narration chunk, an optional callout card
   * (left rail), a chunk of deep-dive HTML (right rail) and the animation segment gated by ctx.beat(k).
   * Authored steps declare `beats: [{say, card, deep}]`. Legacy steps (say + deep only) get beats derived
   * automatically so they still play beat by beat.
   * ================================================================ */
  function stepSay(st) {
    if (st.say) return st.say;
    return (st.beats || []).map(function (b) { return b.say || ''; }).join(' ');
  }

  function autoBeats(st) {
    var sentences = N.splitSentences(stepSay(st));
    var n = Math.max(1, Math.min(5, Math.round(sentences.length / 2)));
    var tpl = document.createElement('template');
    tpl.innerHTML = st.deep || '';
    var nodes = Array.prototype.slice.call(tpl.content.children);
    var lens = nodes.map(function (nd) { return (nd.textContent || '').length + 40; });
    var total = lens.reduce(function (a, b) { return a + b; }, 0) || 1;
    var chunks = [], cards = [], i;
    for (i = 0; i < n; i++) chunks.push([]);
    var cum = 0;
    nodes.forEach(function (nd, k) {
      var b = Math.min(n - 1, Math.floor(((cum + lens[k] / 2) / total) * n));
      cum += lens[k];
      if (nd.classList && nd.classList.contains('note') && !cards[b]) cards[b] = { tag: 'NOTE', title: '', body: nd.innerHTML };
      else chunks[b].push(nd.outerHTML);
    });
    var out = [];
    for (i = 0; i < n; i++) {
      var a = Math.round(i * sentences.length / n), z = Math.round((i + 1) * sentences.length / n);
      out.push({ say: sentences.slice(a, z).join(' '), card: cards[i] || null, deep: chunks[i].join('') });
    }
    return out;
  }

  function beatsOf(st) {
    if (st._beats) return st._beats;
    var bs;
    if (Array.isArray(st.beats) && st.beats.length) {
      bs = st.beats.map(function (b) { return { say: b.say || '', card: b.card || null, deep: b.deep || '' }; });
      st._gated = true;
    } else {
      bs = autoBeats(st);
      st._gated = false;
    }
    st._beats = bs;
    return bs;
  }
  Engine.beatsOf = beatsOf;
  Engine.stepSay = stepSay;

  function beatWords(b) {
    var c = b.card || {};
    return { card: words(strip((c.title || '') + ' ' + (c.body || '') + ' ' + ((c.stat && c.stat.l) || ''))), deep: words(strip(b.deep)) };
  }

  /* how long to hold after a beat in Auto mode so the callouts can be read */
  function pauseMs(b) {
    var w = beatWords(b);
    var slow = 1 / Math.min(1, Engine.settings.rate || 1);
    return clamp((900 + 75 * w.card + 22 * w.deep) * Engine.settings.pause * slow, 700, 12000);
  }
  function stepPauseMs() { return clamp(1600 * Engine.settings.pause / Math.min(1, Engine.settings.rate || 1), 900, 8000); }

  function clearTimer() { if (Engine._timer) { clearTimeout(Engine._timer); Engine._timer = 0; } }
  function stopAll() { clearTimer(); N.stop(); Engine._stepToken++; if (Engine.cur && Engine.cur.bt) flushWaiters(Engine.cur.bt, Infinity); }

  function flushWaiters(bt, upTo) {
    var keep = [];
    bt.waiters.forEach(function (w) { if (w.k <= upTo) w.res(); else keep.push(w); });
    bt.waiters = keep;
  }

  /* run a step's animation instantly up to (and including) beat `upTo`; stalls at gate upTo+1 */
  Engine._runInstantTo = function (cur, st, upTo) {
    var ctx = cur.ctx, bt = cur.bt;
    ctx.instant = true;
    bt.entered = upTo;
    flushWaiters(bt, upTo);
    Promise.resolve().then(function () { return st.run ? st.run(ctx) : null; })
      .catch(function (e) { reportError(cur.meta, st, e); })
      .then(function () { bt.runDone = true; if (bt.onProgress) bt.onProgress(); });
    return new Promise(function (res) {
      var n = 0;
      (function poll() { if (bt.runDone || bt.reached >= upTo + 1 || ++n > 120) return res(); setTimeout(poll, 8); })();
    }).then(function () { ctx.instant = false; });
  };

  function newBt(n, gated) { return { n: n, gated: gated, entered: -1, reached: 0, waiters: [], runDone: false, onProgress: null }; }

  /* ---------------- step playback ---------------- */
  /* opts: { startBeat } */
  Engine.playStep = function (k, opts) {
    opts = opts || {};
    var cur = Engine.cur;
    if (!cur) return Promise.resolve();
    var steps = cur.impl.steps || [];
    if (k < 0 || k >= steps.length) return Promise.resolve();
    clearTimer();
    N.stop();
    if (cur.bt) flushWaiters(cur.bt, Infinity);
    var token = ++Engine._stepToken;
    var st = steps[k];
    var bs = beatsOf(st);
    var start = clamp(opts.startBeat || 0, 0, bs.length - 1);
    cur.step = k; cur.idle = false; cur.wait = null; cur.beatIdx = -1;
    var bt = cur.bt = newBt(bs.length, st._gated);
    cur.ctx._bt = bt;
    renderStepStart(cur, st, bs);
    writeHash();
    setReady(false);

    var begin;
    if (start > 0) {
      begin = Engine._runInstantTo(cur, st, start - 1).then(function () {
        if (token !== Engine._stepToken) return;
        for (var i = 0; i < start; i++) showBeat(cur, bs, i, true);
      });
    } else {
      Promise.resolve().then(function () { return st.run ? st.run(cur.ctx) : null; })
        .catch(function (e) { reportError(cur.meta, st, e); })
        .then(function () { bt.runDone = true; if (bt.onProgress) bt.onProgress(); });
      begin = Promise.resolve();
    }
    return begin.then(function () {
      if (token !== Engine._stepToken) return;
      enterBeat(cur, st, bs, start, token);
    });
  };

  function animDone(cur, j) {
    var bt = cur.bt;
    return new Promise(function (res) {
      var last = j >= bt.n - 1;
      var cap = 0;
      function check() {
        if (!bt.gated && !last) return true;
        return bt.reached >= j + 1 || bt.runDone;
      }
      if (check()) return res();
      bt.onProgress = function () { if (check()) { bt.onProgress = null; clearTimeout(cap); res(); } };
      if (last) cap = setTimeout(function () { bt.onProgress = null; res(); }, 30000);
    });
  }

  function enterBeat(cur, st, bs, j, token) {
    if (token !== Engine._stepToken) return;
    var bt = cur.bt;
    clearTimer();
    bt.entered = j;
    cur.beatIdx = j; cur.wait = null;
    flushWaiters(bt, j);
    showBeat(cur, bs, j, false);
    setReady(false);
    var spoke = N.speak(bs[j].say || '', { key: cur.id + '/' + cur.step + '/' + j });
    Promise.all([spoke, animDone(cur, j)]).then(function (r) {
      if (token !== Engine._stepToken || cur.bt.entered !== j) return;
      onBeatDone(cur, st, bs, j, token, r[0] !== false);
    });
  }

  function autoRunning() { return Engine.settings.mode === 'auto' && Engine.playing; }

  function onBeatDone(cur, st, bs, j, token, spoke) {
    var last = j >= bs.length - 1;
    Engine.dockEl.classList.remove('speaking');
    /* cur.wait = "the next thing needs a nudge": the timer (Auto) or the user (Step / paused) provides it */
    if (!last) {
      cur.wait = 'beat';
      if (spoke && autoRunning()) {
        Engine._timer = setTimeout(function () {
          Engine._timer = 0;
          if (token === Engine._stepToken && cur.bt.entered === j && autoRunning()) enterBeat(cur, st, bs, j + 1, token);
          else if (token === Engine._stepToken) setReady(true);
        }, pauseMs(bs[j]));
      } else setReady(true);
      return;
    }
    cur.idle = true;
    cur.wait = 'step';
    flushWaiters(cur.bt, Infinity);
    updateNextButton();
    onStepIdle();
    if (spoke && autoRunning()) {
      Engine._timer = setTimeout(function () {
        Engine._timer = 0;
        if (token === Engine._stepToken && autoRunning()) Engine.advance();
        else if (token === Engine._stepToken) setReady(true);
      }, stepPauseMs());
    } else setReady(true);
  }
  function onStepIdle() {
    var cur = Engine.cur;
    if (!cur) return;
    var last = cur.step >= (cur.impl.steps || []).length - 1;
    Engine.zoomEl.classList.toggle('attention', last && Engine.children(cur.id).length > 0);
  }

  /* next step, next tour chamber, or stop at the end of a chamber */
  Engine.advance = function () {
    var cur = Engine.cur;
    if (!cur || Engine._busy) return;
    var n = (cur.impl.steps || []).length;
    if (cur.step < n - 1) return Engine.gotoStep(cur.step + 1);
    if (Engine.tour) {
      Engine.tour.i++;
      if (Engine.tour.i < Engine.tour.list.length) return Engine.go(Engine.tour.list[Engine.tour.i]);
      toast('Tour complete. Open the System Map (M) to explore any chamber.');
      Engine.tour = null;
    }
    cur.wait = null;
    setReady(false);
    onStepIdle();
    var kids = Engine.children(cur.id).length;
    toast(kids ? 'End of chamber. Zoom into a highlighted component, or press Esc to go up.' : 'End of chamber. Press Esc to zoom out.');
  };

  /* move to step k. Cheap when continuing straight on from a finished step; otherwise rebuild. */
  Engine.gotoStep = function (k, opts) {
    opts = opts || {};
    var cur = Engine.cur;
    if (!cur || Engine._busy) return Promise.resolve();
    var n = (cur.impl.steps || []).length;
    k = clamp(k, 0, n - 1);
    if (k === cur.step + 1 && cur.idle && !opts.startBeat) return Engine.playStep(k);
    stopAll();
    Engine._busy = true;
    var old = cur;
    old.ctx.destroy();
    return Engine._build(cur.id, k).then(function (next) {
      teardown(old);
      setWrapTf(next.wrap, W / 2, H / 2, 1, 1);
      Engine.cur = next;
      Engine._busy = false;
      return Engine.playStep(k, opts);
    });
  };

  /* jump to the start of beat j of the current step */
  Engine.seekBeat = function (j) {
    var cur = Engine.cur;
    if (!cur) return Promise.resolve();
    return Engine.gotoStep(cur.step, { startBeat: j });
  };

  /* Next: skip to the next beat, or on from the last beat */
  Engine.next = function () {
    var cur = Engine.cur;
    if (!cur || Engine._busy) return;
    if (cur.bt && cur.beatIdx < cur.bt.n - 1) {
      var st = cur.impl.steps[cur.step], bs = beatsOf(st);
      enterBeat(cur, st, bs, cur.beatIdx + 1, Engine._stepToken);
      return;
    }
    var n = (cur.impl.steps || []).length;
    if (cur.step < n - 1 || Engine.tour) { Engine.advance(); return; }
    if (Engine.children(cur.id).length) pulseZoom();
    else toast('End of chamber. Press Esc to zoom out.');
  };

  Engine.prev = function () {
    var cur = Engine.cur;
    if (!cur || Engine._busy) return;
    if (cur.beatIdx > 0) Engine.seekBeat(cur.beatIdx - 1);
    else if (cur.step > 0) Engine.gotoStep(cur.step - 1);
    else Engine.seekBeat(0);
  };

  Engine.replay = function () { if (Engine.cur) Engine.seekBeat(Math.max(0, Engine.cur.beatIdx)); };

  Engine.resume = function () {
    var cur = Engine.cur;
    if (!cur || Engine._busy || !cur.wait) return;
    if (cur.wait === 'beat') Engine.next();
    else if (cur.wait === 'step') Engine.advance();
  };

  Engine.setPlaying = function (p) {
    Engine.playing = p;
    syncControls();
    var cur = Engine.cur;
    if (!p) { clearTimer(); if (cur && cur.wait) setReady(true); return; }
    if (cur && cur.wait && Engine.settings.mode === 'auto') Engine.resume();
  };

  Engine.setMode = function (mode) {
    Engine.settings.mode = mode;
    Engine.playing = mode === 'auto';
    saveSettings();
    syncControls();
    var cur = Engine.cur;
    if (!cur) return;
    if (mode === 'step') { clearTimer(); if (cur.wait) setReady(true); }
    else if (cur.wait) Engine.resume();
  };
  Engine.startTour = function (name) {
    var list = window.ATLAS_TOURS[name];
    Engine.tour = { name: name, list: list, i: 0 };
    closeMap(); closeRefs(true);
    $('#intro').classList.add('hidden');
    Engine.go(list[0], { step: 0 });
    toast(name === 'deep' ? 'Deep tour: all ' + list.length + ' chambers, top-down.' : 'Big-picture tour: ' + list.length + ' chambers.');
  };

  /* HUD metric chip. Clearing only fades it out (the old text fades with it, no empty chip);
   * long strings get a smaller font and are ellipsized rather than wrapping. */
  Engine.setHud = function (s) {
    var el = Engine.hudMetric;
    if (!s) { el.style.opacity = 0; return; }
    el.textContent = s;
    el.title = s;
    el.classList.toggle('long', s.length > 48);
    el.style.opacity = 1;
  };

  /* ---------------- controls state ---------------- */
  function setReady(on) {
    $('#btn-next').classList.toggle('ready', !!on);
    updateNextButton();
  }

  function updateNextButton() {
    var cur = Engine.cur, lbl = $('#next-label'), cnt = $('#next-count');
    if (!cur || !cur.bt) { lbl.textContent = 'Next'; cnt.textContent = ''; return; }
    var nb = cur.bt.n, j = Math.max(0, cur.beatIdx);
    var n = (cur.impl.steps || []).length;
    if (cur.beatIdx < nb - 1) { lbl.textContent = 'Next point'; cnt.textContent = (j + 1) + '/' + nb; }
    else if (cur.step < n - 1) { lbl.textContent = 'Next step'; cnt.textContent = ''; }
    else if (Engine.tour) { lbl.textContent = 'Next chamber'; cnt.textContent = ''; }
    else if (Engine.children(cur.id).length) { lbl.textContent = 'Zoom in'; cnt.textContent = ''; }
    else { lbl.textContent = 'End'; cnt.textContent = ''; }
  }

  function syncControls() {
    var s = Engine.settings;
    $('#mode-auto').classList.toggle('on', s.mode === 'auto');
    $('#mode-step').classList.toggle('on', s.mode === 'step');
    var pb = $('#btn-pause');
    pb.classList.toggle('hide', s.mode !== 'auto');
    pb.innerHTML = Engine.playing
      ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 4l12 8-12 8z"/></svg>';
    pb.title = Engine.playing ? 'Pause autoplay (Space)' : 'Resume autoplay (Space)';
    $$('#set-mode button, #intro-mode-seg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === s.mode); });
    $$('#set-theme button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === s.theme); });
    $('#set-rate').value = String(s.rate);
    $('#set-pause').value = String(s.pause);
    $('#set-voice-mode').value = s.voiceMode;
    $('#btn-rails').classList.toggle('on', s.rails);
  }

  /* ---------------- chrome (HUD, rails, dock) ---------------- */
  function markVisited(id) { Engine.visited[id] = 1; store('atlas.visited', Engine.visited); }

  function accentFor(hex) {
    return Engine.settings.theme === 'light' ? X.mix(hex, '#000000', 0.38) : hex;
  }
  function applyAccent(meta) {
    var hex = meta ? meta.colorHex : '#2997ff';
    var root = document.documentElement.style;
    root.setProperty('--accent', accentFor(hex));
    root.setProperty('--accent-soft', X.hexA(hex, Engine.settings.theme === 'light' ? 0.12 : 0.18));
  }

  function updateChrome() {
    var cur = Engine.cur, meta = cur.meta;
    applyAccent(meta);
    var crumbs = Engine.crumbsEl;
    crumbs.innerHTML = '';
    Engine.path(cur.id).forEach(function (m, i, arr) {
      var b = h('button', 'crumb' + (i === arr.length - 1 ? ' cur' : ''), '<i>L' + m.level + '</i>' + esc(m.title));
      b.style.setProperty('--c', m.colorHex);
      b.onclick = function () { if (m.id !== cur.id) Engine.go(m.id, { transition: 'zoomOut' }); };
      crumbs.appendChild(b);
      if (i < arr.length - 1) crumbs.appendChild(h('span', 'sep', '›'));
    });
    $('#hud-level').textContent = ['System', 'Subsystem', 'Component', 'Primitive'][meta.level] + ' · L' + meta.level;
    $('#hud-kicker').textContent = meta.kicker;
    $('#hud-title').textContent = meta.title;
    var z = Engine.zoomEl;
    z.innerHTML = '';
    z.classList.remove('attention');
    var kids = Engine.children(cur.id);
    if (meta.parent) {
      var up = h('button', 'zchip up', '&#8598; ' + esc(Engine.meta(meta.parent).title));
      up.title = 'Zoom out (Esc)';
      up.onclick = Engine.up;
      z.appendChild(up);
    }
    if (kids.length) z.appendChild(h('span', 'zlabel', 'Zoom into'));
    kids.forEach(function (k) {
      var b = h('button', 'zchip', esc(k.title) + (Engine.visited[k.id] ? ' <em>&#10003;</em>' : ''));
      b.style.setProperty('--c', k.colorHex);
      b.title = k.summary;
      b.onclick = function () { Engine.tour = null; Engine.go(k.id, { transition: 'zoomIn' }); };
      z.appendChild(b);
    });
    var tl = Engine.timelineEl;
    tl.innerHTML = '';
    (cur.impl.steps || []).forEach(function (st, i) {
      var d = h('button', 'tick', '<span>' + esc(st.title || ('Step ' + (i + 1))) + '</span>');
      d.onclick = function () { Engine.gotoStep(i); };
      tl.appendChild(d);
    });
    $('#deep-scene').innerHTML = '<div class="dk">' + esc(meta.kicker) + '</div><h2>' + esc(meta.title) + '</h2><p>' + esc(meta.summary) + '</p>';
    renderSources(cur);
    renderMap();
  }

  function renderSources(cur) {
    var nums = (cur.impl._refNums || []).slice().sort(function (a, b) { return a - b; });
    var el = $('#sources');
    el.innerHTML = '';
    if (!nums.length) return;
    el.appendChild(h('span', 'lbl', 'Sources'));
    nums.forEach(function (n) {
      var e = Engine.refList[n - 1];
      var b = h('button', 'src', String(n));
      b.title = e ? e.text : '';
      b.onclick = function () { openRefs(n); };
      el.appendChild(b);
    });
    var all = h('button', 'src all', 'All references ›');
    all.onclick = function () { openRefs(); };
    el.appendChild(all);
  }

  function renderStepStart(cur, st, bs) {
    var steps = cur.impl.steps || [];
    $$('.tick', Engine.timelineEl).forEach(function (d, i) {
      d.classList.toggle('done', i < cur.step);
      d.classList.toggle('cur', i === cur.step);
    });
    $('#hud-step').textContent = String(cur.step + 1).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0') + '  ·  ' + (st.title || '');
    var rs = $('#rail-step');
    rs.innerHTML = '<small>Step ' + (cur.step + 1) + ' of ' + steps.length + '</small>' + esc(st.title || '');
    rs.classList.remove('swap'); void rs.offsetWidth; rs.classList.add('swap');
    Engine.cardsEl.innerHTML = '';
    Engine.blocksEl.innerHTML = '';
    Engine._glossSeen = {};
    var pips = $('#pips');
    pips.innerHTML = '';
    bs.forEach(function (b, i) {
      var p = h('button', 'pip'); p.title = 'Point ' + (i + 1) + ' of ' + bs.length;
      p.onclick = function () { if (Engine.cur && Engine.cur.beatIdx !== i) Engine.seekBeat(i); };
      pips.appendChild(p);
    });
    Engine.subEl.textContent = '';
    Engine.dockEl.classList.add('speaking');
    Engine.zoomEl.classList.remove('attention');
    updateNextButton();
  }

  function showBeat(cur, bs, j, instant) {
    var b = bs[j];
    /* pips */
    $$('.pip', $('#pips')).forEach(function (p, i) { p.classList.toggle('done', i < j); p.classList.toggle('cur', i === j); });
    /* subtitle: this beat's sentences */
    var sentences = N.splitSentences(b.say || '');
    Engine.subEl.innerHTML = sentences.map(function (s, i) { return '<span data-i="' + i + '">' + esc(s) + ' </span>'; }).join('');
    Engine.subEl.scrollTop = 0;
    /* card */
    if (b.card) addCard(b.card, j, instant);
    $$('.card', Engine.cardsEl).forEach(function (c, i) { c.classList.toggle('old', i >= 2); });
    /* deep block */
    $$('.blk', Engine.blocksEl).forEach(function (e) { e.classList.remove('now'); });
    if (b.deep) {
      var blk = h('section', 'blk' + (instant ? '' : ' enter') + ' now');
      blk.setAttribute('data-beat', j);
      var num = h('button', 'blk-n', String(j + 1));
      num.title = 'Replay this point';
      num.onclick = function () { Engine.seekBeat(j); };
      blk.appendChild(num);
      var body = h('div', 'blk-body', b.deep);
      blk.appendChild(body);
      decorateBlock(body);
      Engine.blocksEl.appendChild(blk);
      if (!instant) setTimeout(function () { blk.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 60);
    }
  }

  function addCard(c, j, instant) {
    var tag = String(c.tag || 'KEY IDEA').toUpperCase();
    var el = h('article', 'card' + (instant ? '' : ' enter'));
    el.setAttribute('data-tag', tag);
    el.setAttribute('data-beat', j);
    var html = '<div class="tag">' + esc(tag) + '</div>';
    if (c.title) html += '<h4>' + esc(c.title) + '</h4>';
    if (c.stat) html += '<div class="stat"><div class="v">' + esc(c.stat.v) + (c.stat.u ? '<u>' + esc(c.stat.u) + '</u>' : '') + '</div>' + (c.stat.l ? '<div class="l">' + esc(c.stat.l) + '</div>' : '') + '</div>';
    if (c.body) html += '<p>' + c.body + '</p>';
    if (c.more) html += '<button class="more-btn">Go deeper</button><div class="more"><div>' + c.more + '</div></div>';
    el.innerHTML = html;
    var mb = $('.more-btn', el);
    if (mb) mb.onclick = function () { el.classList.toggle('open'); };
    el.addEventListener('dblclick', function () { if (Engine.cur && Engine.cur.beatIdx !== j) Engine.seekBeat(j); });
    Engine.cardsEl.insertBefore(el, Engine.cardsEl.firstChild);
    if (!instant) { Engine.cardsEl.scrollTop = 0; var strip = $('#cards-strip'); if (strip) strip.scrollLeft = 0; }
  }

  /* copy buttons on code, glossary terms on prose */
  function decorateBlock(root) {
    $$('pre', root).forEach(function (pre) {
      var b = h('button', 'copy', 'Copy');
      b.onclick = function (ev) {
        ev.stopPropagation();
        var txt = pre.innerText.replace(/Copy$/, '').trim();
        try { navigator.clipboard.writeText(txt); b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1200); } catch (e) { b.textContent = '—'; }
      };
      pre.appendChild(b);
    });
    applyGlossary(root);
  }

  var glossIndex = null;
  function buildGlossary() {
    glossIndex = (window.ATLAS_GLOSSARY || []).map(function (g) {
      var pat = g.re || g.t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re;
      try { re = new RegExp('(^|[^A-Za-z0-9_])(' + pat + ')(?![A-Za-z0-9_])', 'i'); } catch (e) { return null; }
      return { g: g, re: re };
    }).filter(Boolean).sort(function (a, b) { return b.g.t.length - a.g.t.length; });
  }

  function applyGlossary(root) {
    if (!glossIndex || !glossIndex.length) return;
    var seen = Engine._glossSeen || (Engine._glossSeen = {});
    var made = 0;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        for (var p = n.parentNode; p && p !== root; p = p.parentNode) {
          var t = p.nodeName;
          if (t === 'PRE' || t === 'CODE' || t === 'A' || t === 'SUMMARY' || t === 'BUTTON' || (p.classList && (p.classList.contains('eq') || p.classList.contains('term')))) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (tn) {
      if (made >= 3) return;
      for (var i = 0; i < glossIndex.length && made < 3; i++) {
        var gi = glossIndex[i];
        if (seen[gi.g.t]) continue;
        var m = gi.re.exec(tn.nodeValue);
        if (!m) continue;
        var start = m.index + m[1].length, end = start + m[2].length;
        var after = tn.splitText(end);
        var mid = tn.splitText(start);
        var span = h('span', 'term', esc(mid.nodeValue));
        span.setAttribute('data-t', gi.g.t);
        mid.parentNode.replaceChild(span, mid);
        seen[gi.g.t] = 1; made++;
        tn = after;      /* continue searching the remainder for other terms */
        i = -1;
      }
    });
  }

  /* glossary popover */
  function bindPopover() {
    var pop = $('#pop'), hideT = 0;
    function show(term) {
      var g = (window.ATLAS_GLOSSARY || []).filter(function (x) { return x.t === term.getAttribute('data-t'); })[0];
      if (!g) return;
      clearTimeout(hideT);
      var meta = g.s ? Engine.meta(g.s) : null;
      pop.innerHTML = '<b>' + esc(g.t) + '</b>' + esc(g.d) + (meta && (!Engine.cur || Engine.cur.id !== g.s) ? '<br><a data-go="' + g.s + '">Open ' + esc(meta.title) + ' &rsaquo;</a>' : '');
      var r = term.getBoundingClientRect();
      pop.classList.add('show');
      var pw = pop.offsetWidth, ph = pop.offsetHeight;
      var x = clamp(r.left, 12, window.innerWidth - pw - 12);
      var y = r.bottom + 8 + ph > window.innerHeight ? r.top - ph - 8 : r.bottom + 8;
      pop.style.left = x + 'px'; pop.style.top = y + 'px';
    }
    function hide() { hideT = setTimeout(function () { pop.classList.remove('show'); }, 180); }
    document.addEventListener('mouseover', function (e) { var t = e.target.closest && e.target.closest('.term'); if (t) show(t); else if (e.target.closest && e.target.closest('#pop')) clearTimeout(hideT); });
    document.addEventListener('mouseout', function (e) { if (e.target.closest && (e.target.closest('.term') || e.target.closest('#pop'))) hide(); });
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.term'); if (t) { show(t); return; }
      var a = e.target.closest && e.target.closest('#pop a[data-go]');
      if (a) { pop.classList.remove('show'); Engine.tour = null; Engine.go(a.getAttribute('data-go')); return; }
      if (!e.target.closest || !e.target.closest('#pop')) pop.classList.remove('show');
    });
  }

  N.onSentence = function (i) {
    var spans = Engine.subEl.querySelectorAll('span');
    for (var k = 0; k < spans.length; k++) { spans[k].classList.toggle('now', k === i); spans[k].classList.toggle('past', k < i); }
    var el = spans[i];
    if (el) Engine.subEl.scrollTop = Math.max(0, el.offsetTop - Engine.subEl.offsetTop - 4);
  };

  function pulseZoom() {
    Engine.zoomEl.classList.remove('attention'); void Engine.zoomEl.offsetWidth; Engine.zoomEl.classList.add('attention');
  }

  var toastTimer = 0;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 4200);
  }
  Engine.toast = toast;

  /* ---------------- system map ---------------- */
  function renderMap() {
    var grid = $('#map-grid');
    if (!grid) return;
    var q = ($('#map-filter').value || '').toLowerCase();
    grid.innerHTML = '';
    var root = Engine.meta('overview');
    var curId = Engine.cur && Engine.cur.id;
    function chip(m, cls) {
      var b = h('button', 'mchip ' + (cls || '') + (m.id === curId ? ' cur' : '') + (Engine.visited[m.id] ? ' seen' : ''),
        '<i>L' + m.level + '</i>' + esc(m.title));
      b.style.setProperty('--c', m.colorHex);
      b.title = m.summary;
      var hit = !q || (m.title + ' ' + m.summary + ' ' + m.kicker).toLowerCase().indexOf(q) >= 0;
      if (!hit) b.classList.add('miss');
      b.onclick = function () { closeMap(true); Engine.tour = null; Engine.go(m.id); };
      return b;
    }
    var head = h('div', 'mroot');
    head.appendChild(chip(root, 'big'));
    head.appendChild(h('p', '', esc(root.summary)));
    grid.appendChild(head);
    Engine.children('overview').forEach(function (m) {
      var card = h('div', 'mcard');
      card.style.setProperty('--c', m.colorHex);
      card.appendChild(chip(m, 'l1'));
      card.appendChild(h('p', '', esc(m.summary)));
      var sub = h('div', 'msub');
      (function walk(id, depth) {
        Engine.children(id).forEach(function (k) {
          var c = chip(k, 'l' + k.level);
          c.style.marginLeft = (depth * 14) + 'px';
          sub.appendChild(c);
          walk(k.id, depth + 1);
        });
      })(m.id, 0);
      card.appendChild(sub);
      grid.appendChild(card);
    });
    var n = Object.keys(Engine.visited).length;
    $('#map-progress').textContent = n + ' of ' + Engine.order.length + ' chambers explored';
  }

  /* pausing narration while a full-screen page is open */
  function hold() {
    if (Engine._held) return;
    Engine._held = true;
    clearTimer(); N.stop();
    Engine._stepToken++;
    if (Engine.cur && Engine.cur.bt) flushWaiters(Engine.cur.bt, Infinity);
  }
  function release() {
    if (!Engine._held) return;
    Engine._held = false;
    if (Engine.cur && !Engine._busy) Engine.replay();
  }

  function openMap() { hold(); renderMap(); $('#map').classList.remove('hidden'); setTimeout(function () { $('#map-filter').focus(); }, 60); }
  function closeMap(noRelease) { $('#map').classList.add('hidden'); if (!noRelease) release(); else Engine._held = false; }
  Engine.openMap = openMap; Engine.closeMap = closeMap;

  /* ---------------- references page ---------------- */
  function scholarUrl(e) {
    var m = /<i>(.*?)<\/i>/i.exec(e.html);
    var q = m ? strip(m[1]) : e.text.slice(0, 110);
    return 'https://scholar.google.com/scholar?q=' + encodeURIComponent(q);
  }

  function renderRefs(hl) {
    var q = ($('#refs-filter').value || '').toLowerCase();
    var list = $('#refs-list');
    list.innerHTML = '';
    var shown = 0;
    Engine.refList.forEach(function (e) {
      if (q && e.text.toLowerCase().indexOf(q) < 0) return;
      shown++;
      var row = h('div', 'ref' + (hl === e.n ? ' hl' : ''));
      row.id = 'ref-' + e.n;
      row.appendChild(h('div', 'n', '[' + e.n + ']'));
      var t = h('div', 't', e.html);
      var meta = h('div', 'meta');
      var a = h('a', '', 'Find online ↗'); a.href = scholarUrl(e); a.target = '_blank'; a.rel = 'noopener';
      meta.appendChild(a);
      e.scenes.forEach(function (sid) {
        var m = Engine.meta(sid);
        var b = h('button', '', esc(m.title));
        b.onclick = function () { closeRefs(true); Engine.tour = null; Engine.go(sid); };
        meta.appendChild(b);
      });
      t.appendChild(meta);
      row.appendChild(t);
      list.appendChild(row);
    });
    $('#refs-count').textContent = shown + ' of ' + Engine.refList.length + ' references · numbers match the Sources chips in each chamber';
    if (hl) { var el = $('#ref-' + hl); if (el) setTimeout(function () { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 80); }
  }

  function openRefs(n) {
    hold();
    Engine._refsFrom = Engine.cur ? location.hash : '';
    $('#refs-filter').value = '';
    renderRefs(n);
    $('#refs-page').classList.remove('hidden');
    history.replaceState(null, '', '#/refs' + (n ? '/' + n : ''));
    Engine._ownHash = location.hash;
  }
  function closeRefs(noRelease) {
    var pg = $('#refs-page');
    if (pg.classList.contains('hidden')) return;
    pg.classList.add('hidden');
    writeHash();
    if (!noRelease) release(); else Engine._held = false;
  }
  Engine.openRefs = openRefs; Engine.closeRefs = closeRefs;

  /* ---------------- routing ---------------- */
  function writeHash() {
    if (!Engine.cur) return;
    var hsh = '#/' + Engine.cur.id + '/' + (Engine.cur.step + 1);
    if (location.hash !== hsh) { Engine._ownHash = hsh; history.replaceState(null, '', hsh); }
  }

  function readHash() {
    var r = /^#\/refs(?:\/(\d+))?/.exec(location.hash || '');
    if (r) return { refs: r[1] ? parseInt(r[1], 10) : 0, isRefs: true };
    var m = /^#\/([\w-]+)(?:\/(\d+))?/.exec(location.hash || '');
    if (!m || !Engine.meta(m[1])) return null;
    return { id: m[1], step: m[2] ? parseInt(m[2], 10) - 1 : 0 };
  }

  /* ---------------- layout ---------------- */
  function placeCards(wide) {
    var rs = $('#rail-step'), cards = Engine.cardsEl;
    var host = wide ? $('#rail-left') : $('#cards-strip');
    if (rs.parentNode !== host) { host.appendChild(rs); host.appendChild(cards); }
  }

  function fit() {
    var main = $('#main'), st = $('#stage');
    var cs = getComputedStyle(main);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var innerW = main.clientWidth - padX, innerH = main.clientHeight - padY;
    var narrow = window.innerWidth < 820;
    var railsOff = document.body.classList.contains('rails-off');
    var gap = 18;
    var rightMin = window.innerWidth < 1100 ? 320 : 380, leftMin = 290;
    var wide = !railsOff && !narrow && innerW >= 1660;
    document.body.classList.toggle('layout-wide', wide);
    placeCards(wide);
    var stripH = (!wide && !railsOff) ? Math.max(120, Math.min(176, Math.round(innerH * 0.2))) : 0;
    document.documentElement.style.setProperty('--strip-h', stripH + 'px');
    var availW;
    if (railsOff || narrow) availW = innerW;
    else if (wide) availW = innerW - leftMin - rightMin - 2 * gap;
    else availW = innerW - rightMin - gap;
    var availH = innerH - (stripH ? stripH + 14 : 0);
    var w = Math.max(320, Math.min(availW, availH * 16 / 9));
    st.style.width = Math.floor(w) + 'px';
    st.style.height = Math.floor(w * 9 / 16) + 'px';
    $('#cards-strip').style.width = stripH ? Math.floor(w) + 'px' : '';
    if (railsOff || narrow) main.style.gridTemplateColumns = '';
    else if (wide) main.style.gridTemplateColumns = 'minmax(' + leftMin + 'px,1fr) ' + Math.floor(w) + 'px minmax(' + rightMin + 'px,1.25fr)';
    else main.style.gridTemplateColumns = Math.floor(w) + 'px minmax(' + rightMin + 'px,1fr)';
    if (window.__atlasFit) window.__atlasFit();
  }
  Engine.fit = fit;

  function setRails(on) {
    Engine.settings.rails = on;
    document.body.classList.toggle('rails-off', !on);
    saveSettings(); syncControls();
    setTimeout(fit, 0);
  }

  /* ---------------- theme / settings ---------------- */
  function saveSettings() { store('atlas.settings', Engine.settings); }

  function setTheme(t) {
    Engine.settings.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    var mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute('content', t === 'light' ? '#f5f5f7' : '#000000');
    applyAccent(Engine.cur && Engine.cur.meta);
    saveSettings(); syncControls();
  }

  Engine.setTheme = function (t) { setTheme(t); };
  Engine.setRails = function (on) { setRails(on); };

  function applyVoiceSettings() {
    var s = Engine.settings;
    N.rate = s.rate;
    N.mode = s.voiceMode;
    N.enabled = s.voiceMode !== 'off';
    Engine.speed = Math.max(1, s.rate);
    if (s.voiceName) N.setVoiceByName(s.voiceName);
  }

  function fillVoices() {
    var sel = $('#set-voice');
    var vs = N.voices().slice().sort(function (a, b) {
      function sc(v) { return (/natural|neural|online/i.test(v.name) ? 0 : 2) + (/^en[-_]US/i.test(v.lang) ? 0 : 1); }
      return sc(a) - sc(b) || a.name.localeCompare(b.name);
    });
    sel.innerHTML = vs.map(function (v) { return '<option value="' + esc(v.name) + '">' + esc(v.name.replace(/^Microsoft /, '')) + '</option>'; }).join('') || '<option>(none available)</option>';
    var want = Engine.settings.voiceName || (N.voice && N.voice.name) || '';
    if (want) sel.value = want;
  }

  function bindSettings() {
    var pan = $('#settings');
    function toggle(force) { var open = force === undefined ? pan.classList.contains('hidden') : force; pan.classList.toggle('hidden', !open); $('#btn-settings').classList.toggle('on', open); }
    $('#btn-settings').onclick = function (e) { e.stopPropagation(); toggle(); };
    document.addEventListener('click', function (e) { if (!pan.classList.contains('hidden') && !e.target.closest('#settings') && !e.target.closest('#btn-settings')) toggle(false); });
    $$('#set-mode button, #intro-mode-seg button, #mode-seg button').forEach(function (b) {
      b.onclick = function () { Engine.setMode(b.getAttribute('data-v') || (b.id === 'mode-step' ? 'step' : 'auto')); };
    });
    $$('#set-theme button').forEach(function (b) { b.onclick = function () { setTheme(b.getAttribute('data-v')); }; });
    $('#set-rate').onchange = function (e) { Engine.settings.rate = parseFloat(e.target.value); applyVoiceSettings(); saveSettings(); };
    $('#set-pause').onchange = function (e) { Engine.settings.pause = parseFloat(e.target.value); saveSettings(); };
    $('#set-voice-mode').onchange = function (e) {
      Engine.settings.voiceMode = e.target.value; applyVoiceSettings(); saveSettings();
      if (!N.enabled) N.stop();
      if (Engine.cur && !Engine._busy) Engine.replay();
    };
    $('#set-voice').onchange = function (e) {
      Engine.settings.voiceName = e.target.value; N.setVoiceByName(e.target.value); saveSettings();
      if (Engine.cur && !Engine._busy) Engine.replay();
    };
    if (N.supported) { var prevCb = window.speechSynthesis.onvoiceschanged; window.speechSynthesis.onvoiceschanged = function () { if (prevCb) prevCb(); fillVoices(); }; }
    fillVoices();
  }

  /* ---------------- boot ---------------- */
  function buildDefs(defs) {
    defs.innerHTML =
      '<filter id="fx-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b"/><feComponentTransfer in="b" result="b2"><feFuncA type="linear" slope="0.6"/></feComponentTransfer><feMerge><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<filter id="fx-glow-strong" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="b"/><feComponentTransfer in="b" result="b2"><feFuncA type="linear" slope="0.8"/></feComponentTransfer><feMerge><feMergeNode in="b2"/><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<linearGradient id="fx-panel-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#171d2e" stop-opacity="0.97"/><stop offset="1" stop-color="#0b0f1a" stop-opacity="0.97"/></linearGradient>' +
      '<pattern id="fx-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#131a2b" stroke-width="1"/></pattern>' +
      '<pattern id="fx-grid-big" width="200" height="200" patternUnits="userSpaceOnUse"><path d="M200 0H0V200" fill="none" stroke="#182136" stroke-width="1.1"/></pattern>' +
      '<radialGradient id="fx-vignette" cx="50%" cy="50%" r="70%"><stop offset="0.74" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.4"/></radialGradient>';
  }

  function buildBg(bg) {
    bg.innerHTML = '<rect x="-800" y="-450" width="3200" height="1800" fill="url(#fx-grid)"/><rect x="-800" y="-450" width="3200" height="1800" fill="url(#fx-grid-big)"/>';
  }

  function anyOverlayOpen() {
    return !$('#map').classList.contains('hidden') || !$('#refs-page').classList.contains('hidden') || !$('#intro').classList.contains('hidden');
  }

  function bindUi() {
    $('#btn-pause').onclick = function () { Engine.setPlaying(!Engine.playing); };
    $('#btn-prev').onclick = Engine.prev;
    $('#btn-next').onclick = Engine.next;
    $('#btn-replay').onclick = Engine.replay;
    $('#btn-up').onclick = Engine.up;
    $('#btn-map').onclick = openMap;
    $('#map-close').onclick = function () { closeMap(); };
    $('#map').onclick = function (e) { if (e.target.id === 'map') closeMap(); };
    $('#map-filter').oninput = renderMap;
    $('#tour-big').onclick = function () { Engine.startTour('bigpicture'); };
    $('#tour-deep').onclick = function () { Engine.startTour('deep'); };
    $('#btn-tour').onclick = function () { Engine.startTour('bigpicture'); };
    $('#btn-refs').onclick = function () { openRefs(); };
    $('#refs-close').onclick = function () { closeRefs(); };
    $('#refs-back').onclick = function () { closeRefs(); };
    $('#refs-page').onclick = function (e) { if (e.target.id === 'refs-page') closeRefs(); };
    $('#refs-filter').oninput = function () { renderRefs(); };
    $('#btn-rails').onclick = function () { setRails(!Engine.settings.rails); };
    $('#btn-theme').onclick = function () { setTheme(Engine.settings.theme === 'dark' ? 'light' : 'dark'); };
    window.addEventListener('keydown', function (e) {
      var tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') { if (e.key === 'Escape') { closeMap(); closeRefs(); } return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key;
      if (!$('#intro').classList.contains('hidden')) return;
      var mapOpen = !$('#map').classList.contains('hidden'), refsOpen = !$('#refs-page').classList.contains('hidden');
      if (k === 'Escape' && (mapOpen || refsOpen)) { closeMap(); closeRefs(); return; }
      if (k === 'm' || k === 'M') { mapOpen ? closeMap() : openMap(); e.preventDefault(); return; }
      if (mapOpen || refsOpen) return;
      if (k === 'ArrowRight' || k === 'PageDown') { Engine.next(); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { Engine.prev(); e.preventDefault(); }
      else if (k === ' ') { if (Engine.settings.mode === 'auto') Engine.setPlaying(!Engine.playing); else Engine.next(); e.preventDefault(); }
      else if (k === 'Escape' || k === 'Backspace' || k === 'ArrowUp') { Engine.tour = null; Engine.up(); e.preventDefault(); }
      else if (k === 'd' || k === 'D') { setRails(!Engine.settings.rails); }
      else if (k === 'r' || k === 'R') { Engine.replay(); }
      else if (k === 't' || k === 'T') { setTheme(Engine.settings.theme === 'dark' ? 'light' : 'dark'); }
      else if (k === 's' || k === 'S') { Engine.setMode(Engine.settings.mode === 'auto' ? 'step' : 'auto'); }
    });
    window.addEventListener('resize', fit);
    window.addEventListener('hashchange', function () {
      if (location.hash === Engine._ownHash) return;
      var r = readHash();
      if (r && r.isRefs) { openRefs(r.refs); return; }
      if (r && (!Engine.cur || r.id !== Engine.cur.id)) Engine.go(r.id, { step: r.step });
    });
    bindSettings();
    bindPopover();
  }

  Engine.boot = function () {
    initCatalog();
    buildRefs();
    buildGlossary();
    Engine.settings = Object.assign({}, DEFAULTS, store('atlas.settings') || {});
    var hasStudio = window.ATLAS_AUDIO && Object.keys(window.ATLAS_AUDIO).length > 0;
    if (!hasStudio && Engine.settings.voiceMode === 'studio') Engine.settings.voiceMode = 'browser';
    Engine.visited = store('atlas.visited') || {};
    Engine.svg = $('#svg');
    Engine.defs = $('#defs');
    Engine.bgEl = $('#bg');
    Engine.camEl = $('#cam');
    Engine.canvasHost = $('#canvas-host');
    Engine.crumbsEl = $('#crumbs');
    Engine.timelineEl = $('#timeline');
    Engine.subEl = $('#subtitle');
    Engine.dockEl = $('#dock');
    Engine.zoomEl = $('#zoom-chips');
    Engine.flashEl = $('#flash');
    Engine.hudMetric = $('#hud-metric');
    Engine.cardsEl = $('#cards');
    Engine.blocksEl = $('#deep-blocks');
    if (!hasStudio) { var opt = $('#set-voice-mode option[value="studio"]'); if (opt) { opt.disabled = true; opt.textContent = 'Studio voice (not installed)'; } }
    buildDefs(Engine.defs);
    buildBg(Engine.bgEl);
    Engine.playing = Engine.settings.mode === 'auto';
    document.body.classList.toggle('rails-off', !Engine.settings.rails);
    if (window.innerWidth < 820) { Engine.settings.rails = false; document.body.classList.add('rails-off'); }
    document.documentElement.setAttribute('data-theme', Engine.settings.theme);
    applyVoiceSettings();
    bindUi();
    syncControls();
    fit();
    var missing = Engine.order.filter(function (m) { return !Engine.scenes[m.id]; }).map(function (m) { return m.id; });
    if (missing.length) console.info('[atlas] placeholder scenes:', missing.join(', '));
    $('#intro-count').textContent = Engine.order.length;
    var nBeats = 0;
    Engine.order.forEach(function (m) { (Engine.impl(m.id).steps || []).forEach(function (st) { nBeats += beatsOf(st).length; }); });
    $('#intro-beats').textContent = nBeats.toLocaleString('en-US');
    function start(fn) { $('#intro').classList.add('hidden'); fn(); }
    $('#intro-go').onclick = function () { start(function () { var r = readHash(); if (r && r.isRefs) { Engine.go('overview'); openRefs(r.refs); } else Engine.go(r ? r.id : 'overview', { step: r ? r.step : 0 }); }); };
    $('#intro-tour').onclick = function () { start(function () { Engine.startTour('bigpicture'); }); };
    $('#intro-map').onclick = function () { start(function () { Engine.setMode('step'); Engine.go('overview').then(function () { openMap(); }); }); };
  };

  window.Atlas = {
    register: Engine.register,
    engine: Engine,
    C: C
  };
  document.addEventListener('DOMContentLoaded', function () { Engine.boot(); });
})();
