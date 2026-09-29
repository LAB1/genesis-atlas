/* Atlas engine: scene registry, navigation, zoom transitions, beat-by-beat playback (Auto / Step),
 * narration + captions, callout cards, progressive deep-dive rail, settings, themes, layout. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var X = window.AtlasCtx;
  var W = X.W, H = X.H, C = X.C;
  var N = window.AtlasNarrator;
  var R = window.AtlasRefs;

  function $(s) { return document.querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function strip(html) { return R.strip(html); }
  function words(s) { s = String(s || '').trim(); return s ? s.split(/\s+/).length : 0; }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return null; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var SETTINGS_KEY = 'atlas.settings.v2';
  /* playMode: 'step' = one point per press; 'topic' = press Play once, the topic plays through with pauses;
   * 'auto' = plays everything and opens each new topic by itself. Derived: settings.mode ('step'|'auto') is
   * how points advance inside a topic, settings.autoStart says whether a newly opened topic starts alone. */
  var DEFAULTS = { playMode: 'topic', rate: 0.9, pause: 1, voiceMode: 'browser', voiceName: '', theme: 'dark', rails: true, deep: null, captions: true };
  function derivePlayMode(s) {
    if (['step', 'topic', 'auto'].indexOf(s.playMode) < 0) s.playMode = 'topic';
    s.mode = s.playMode === 'step' ? 'step' : 'auto';
    s.autoStart = s.playMode === 'auto';
  }
  var ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 4l12 8-12 8z"/></svg>';
  var ICON_SPK_ON = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var ICON_SPK_OFF = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9.5l5 5M22 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  var Engine = {
    scenes: {},          /* registered implementations */
    catalog: {},         /* id -> meta */
    order: [],
    cur: null,           /* { id, ctx, wrap, step, bt, beatIdx, idle, wait } */
    settings: Object.assign({}, DEFAULTS),
    voicePaused: false,  /* the user paused narration / autoplay */
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
    var impl = Engine.impl(id);
    var lastStep = Math.max(0, (impl.steps || []).length - 1);
    /* Where to land. An explicit step starts fresh there (progress list, deep link, tour). Otherwise the chamber
     * returns to where the learner left it. Back lands on the finished last step (its zoom targets are visible). */
    var mode = 'fresh', step = 0, beat = opts.beat || 0;
    if (opts.step !== undefined) step = clamp(opts.step, 0, lastStep);
    else if (!opts.fresh && !Engine._forceFresh && Engine.pos[id]) { mode = 'restore'; step = clamp(Engine.pos[id].s, 0, lastStep); beat = Engine.pos[id].b; }
    else if (opts.landOnEnd) { mode = 'restore'; step = lastStep; beat = 1e9; }
    Engine._last = id;
    posSave();
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
        /* a newly opened topic waits for Play, unless the user chose Auto (or this call insists) */
        if (mode === 'restore') return Engine.restoreStep(step, beat);
        var autostart = opts.autostart !== undefined ? opts.autostart : (Engine._forceAutoStart || Engine.settings.autoStart);
        if (autostart) return Engine.playStep(step, { startBeat: beat });
        return Engine.prepareStep(step, { startBeat: beat });
      });
    });
  };

  /* Show a step's frame (title, panels reset) without running anything; wait for Play / Next / Space. */
  Engine.prepareStep = function (k, opts) {
    opts = opts || {};
    var cur = Engine.cur;
    if (!cur) return Promise.resolve();
    var steps = cur.impl.steps || [];
    if (k < 0 || k >= steps.length) return Promise.resolve();
    clearTimer(); N.stop();
    Engine.voicePaused = false;
    ++Engine._stepToken;
    var st = steps[k], bs = beatsOf(st);
    cur.step = k; cur.idle = false; cur.wait = null; cur.beatIdx = -1;
    cur.bt = newBt(bs.length, st._gated);
    cur.ctx._bt = cur.bt;
    cur.pending = { step: k, startBeat: opts.startBeat || 0 };
    renderStepStart(cur, st, bs);
    writeHash();
    $('#start-sum').textContent = cur.meta.summary || '';
    showStart(true);
    showPoster(cur.id);
    setReady(true);
    updatePlayBtn();
    return Promise.resolve();
  };

  function showStart(on) { $('#start').classList.toggle('hidden', !on); if (!on) hidePoster(); }

  /* the user asked to begin the waiting topic */
  Engine.startPending = function () {
    var cur = Engine.cur;
    if (!cur || !cur.pending || Engine._busy) return;
    var p = cur.pending;
    cur.pending = null;
    showStart(false);
    return Engine.playStep(p.step, { startBeat: p.startBeat });
  };

  /* ================================================================
   * POSTER: the backdrop of a paused (not yet started) topic is the topic's complete system diagram.
   * The scene is replayed silently and instantly; the step whose picture holds the most visible text and
   * nodes is cloned as a static SVG and shown dimmed behind the "Play this topic" prompt.
   * ================================================================ */
  Engine._posters = {};
  function layerScore(layer) {
    var s = 0;
    Array.prototype.forEach.call(layer.querySelectorAll('text'), function (t) {
      if (!(t.textContent || '').trim()) return;
      var o = 1;
      for (var n = t; n && n !== layer.parentNode; n = n.parentNode) {
        var a = n.getAttribute && n.getAttribute('opacity');
        if (a !== null && a !== undefined && a !== '') o *= parseFloat(a);
      }
      if (o > 0.4) s++;
    });
    return s + layer.querySelectorAll('g.node').length * 2;
  }

  Engine.makePoster = function (id) {
    if (Engine._posters[id] !== undefined) return Promise.resolve(Engine._posters[id]);
    if (!Engine.scenes[id]) { Engine._posters[id] = null; return Promise.resolve(null); }
    var steps = Engine.impl(id).steps || [];
    Engine._noHud = true;
    return Engine._build(id, 0).then(function (s) {
      s.wrap.setAttribute('visibility', 'hidden');
      var best = null, bestScore = -1, chain = Promise.resolve();
      steps.forEach(function (st) {
        chain = chain.then(function () { s.ctx.instant = true; s.ctx._bt = null; return st.run ? st.run(s.ctx) : null; })
          .catch(function () { /* a glitching step just contributes nothing */ })
          .then(function () {
            var sc = layerScore(s.ctx.layer);
            if (sc >= bestScore) { bestScore = sc; best = s.ctx.layer.cloneNode(true); }
          });
      });
      return chain.then(function () {
        teardown(s);
        Engine._noHud = false;
        if (best) { best.removeAttribute('transform'); best.removeAttribute('class'); }
        Engine._posters[id] = best;
        return best;
      });
    }).catch(function (err) { Engine._noHud = false; console.error('poster', err); return null; });
  };

  function showPoster(id) {
    var g = $('#poster');
    g.innerHTML = '';
    g.classList.remove('show');
    Engine.makePoster(id).then(function (p) {
      var cur = Engine.cur;
      if (!p || !cur || cur.id !== id || !cur.pending) return;
      g.appendChild(p.cloneNode(true));
      void g.getBBox;                                   /* flush before fading in */
      g.classList.add('show');
    });
  }
  function hidePoster() {
    var g = $('#poster');
    if (!g) return;
    g.classList.remove('show');
    setTimeout(function () { if (!g.classList.contains('show')) g.innerHTML = ''; }, 650);
  }

  /* ================================================================
   * PROGRESS: "played" is recorded automatically as points are shown; "learned" is the learner's own
   * commitment (a checkbox). The two are kept and displayed separately.
   * ================================================================ */
  var PROG_KEY = 'atlas.progress.v1';
  Engine.progress = { p: {}, l: {} };
  var progOpen = {}, progHideLearned = false;
  function progLoad() { var d = store(PROG_KEY) || {}; Engine.progress = { p: d.p || {}, l: d.l || {} }; }
  function progSave() { store(PROG_KEY, Engine.progress); }
  function skey(id, i) { return id + '/' + i; }

  function markPlayed(id, step, j) {
    var k = skey(id, step), n = j + 1;
    if ((Engine.progress.p[k] || 0) >= n) return;
    Engine.progress.p[k] = n;
    progSave();
    progRender();
  }
  function playState(id, i) {
    var n = Engine.progress.p[skey(id, i)] || 0;
    if (!n) return 0;
    var st = (Engine.impl(id).steps || [])[i];
    return n >= (st ? beatsOf(st).length : 1) ? 2 : 1;
  }
  function chamberStats(id) {
    var steps = Engine.impl(id).steps || [], r = { n: steps.length, played: 0, part: 0, learned: 0 };
    steps.forEach(function (st, i) {
      var ps = playState(id, i);
      if (ps === 2) r.played++; else if (ps === 1) r.part++;
      if (Engine.progress.l[skey(id, i)]) r.learned++;
    });
    return r;
  }
  Engine.setLearned = function (id, i, on) {
    if (on) Engine.progress.l[skey(id, i)] = 1; else delete Engine.progress.l[skey(id, i)];
    progSave(); progRender();
  };
  Engine.setChamberLearned = function (id, on) {
    (Engine.impl(id).steps || []).forEach(function (st, i) { if (on) Engine.progress.l[skey(id, i)] = 1; else delete Engine.progress.l[skey(id, i)]; });
    progSave(); progRender();
  };

  Engine.jumpTo = function (id, step) {
    closeProgress();
    Engine.tour = null;
    var cur = Engine.cur;
    if (cur && cur.id === id && !cur.pending && !Engine._busy) return Engine.gotoStep(step);
    return Engine.go(id, { step: step, transition: 'fade' });
  };

  function progRender() {
    if (!$('#map').classList.contains('hidden')) renderMap();      /* the map shows the same numbers */
    var panel = $('#prog');
    if (!panel || panel.classList.contains('hidden')) return;
    var sc = $('#prog-scroll'), top = sc.scrollTop;
    var tree = $('#prog-tree');
    tree.innerHTML = '';
    var tot = 0, pl = 0, le = 0;
    Engine.order.forEach(function (m) { var s = chamberStats(m.id); tot += s.n; pl += s.played; le += s.learned; });
    tot = tot || 1;
    $('#prog-sum').innerHTML =
      '<div class="pg"><b>' + pl + '</b><span>of ' + tot + ' steps played</span><div class="bar"><i style="width:' + (100 * pl / tot).toFixed(1) + '%"></i></div></div>' +
      '<div class="pg l"><b>' + le + '</b><span>of ' + tot + ' marked learned</span><div class="bar"><i style="width:' + (100 * le / tot).toFixed(1) + '%"></i></div></div>';
    $('#prog-filter').textContent = progHideLearned ? 'Show learned' : 'Hide learned';
    var curId = Engine.cur && Engine.cur.id, curStep = Engine.cur ? Engine.cur.step : -1;

    function addChamber(m, parentEl) {
      var steps = Engine.impl(m.id).steps || [], s = chamberStats(m.id);
      var open = progOpen[m.id] === undefined ? (m.id === curId || (curId && Engine.isAncestor(m.id, curId))) : progOpen[m.id];
      var box = h('div', 'pc' + (open ? ' open' : '') + (m.id === curId ? ' cur' : ''));
      box.style.setProperty('--c', m.colorHex);
      var head = h('div', 'pc-head');
      var chev = h('button', 'chev', '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>');
      chev.title = open ? 'Collapse' : 'Show steps';
      chev.onclick = function () { progOpen[m.id] = !open; progRender(); };
      var all = s.n > 0 && s.learned === s.n;
      var ck = h('button', 'ck' + (all ? ' on' : (s.learned ? ' part' : '')), CHECK_SVG);
      ck.title = all ? 'Unmark every step of this chamber' : 'Mark every step of this chamber as learned';
      ck.onclick = function () { Engine.setChamberLearned(m.id, !all); };
      var ttl = h('button', 'pc-title', '<i>L' + m.level + '</i>' + esc(m.title));
      ttl.title = 'Open this chamber';
      ttl.onclick = function () { closeProgress(); Engine.tour = null; Engine.go(m.id); };
      var cnt = h('span', 'pc-count', '<span title="steps played">' + s.played + '/' + s.n + '</span><span class="l" title="steps marked learned">' + s.learned + '/' + s.n + '</span>');
      var pct = function (v) { return s.n ? (100 * v / s.n).toFixed(1) : 0; };
      var bars = h('div', 'dbar', '<i class="p" style="width:' + pct(s.played) + '%"></i><i class="l" style="width:' + pct(s.learned) + '%"></i>');
      head.appendChild(chev); head.appendChild(ck); head.appendChild(ttl); head.appendChild(cnt); head.appendChild(bars);
      box.appendChild(head);
      if (open) {
        var list = h('div', 'pc-steps');
        steps.forEach(function (st, i) {
          var learned = !!Engine.progress.l[skey(m.id, i)];
          if (progHideLearned && learned) return;
          var ps = playState(m.id, i);
          var row = h('div', 'ps' + (learned ? ' done' : '') + (m.id === curId && i === curStep ? ' cur' : ''));
          var c2 = h('button', 'ck' + (learned ? ' on' : ''), CHECK_SVG);
          c2.title = learned ? 'Learned: click to unmark' : 'Mark as learned';
          c2.onclick = function () { Engine.setLearned(m.id, i, !learned); };
          var pr = h('span', 'pr pr' + ps);
          pr.title = ['Not played yet', 'Partly played', 'Played'][ps];
          var t = h('button', 'ps-title', '<em>' + (i + 1) + '</em>' + esc(st.title || ('Step ' + (i + 1))));
          t.title = 'Jump to this step';
          t.onclick = function () { Engine.jumpTo(m.id, i); };
          row.appendChild(c2); row.appendChild(pr); row.appendChild(t);
          list.appendChild(row);
        });
        if (list.children.length) box.appendChild(list);
      }
      parentEl.appendChild(box);
      var kids = Engine.children(m.id);
      if (kids.length) {
        var kw = h('div', 'pc-kids');
        kids.forEach(function (k) { addChamber(k, kw); });
        parentEl.appendChild(kw);
      }
    }
    addChamber(Engine.meta('overview'), tree);
    sc.scrollTop = top;
  }

  function openProgress() {
    toggleZoomMenu(false);
    $('#settings').classList.add('hidden');
    $('#prog').classList.remove('hidden');
    $('#btn-progress').classList.add('on');
    progRender();
    var el = $('#prog .ps.cur') || $('#prog .pc.cur');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  }
  function closeProgress() {
    var p = $('#prog');
    if (p) p.classList.add('hidden');
    var b = $('#btn-progress');
    if (b) b.classList.remove('on');
  }
  function toggleProgress(force) {
    var open = force === undefined ? $('#prog').classList.contains('hidden') : force;
    if (open) openProgress(); else closeProgress();
  }
  Engine.openProgress = openProgress; Engine.closeProgress = closeProgress;

  /* ================================================================
   * POSITION: every chamber remembers where the learner stopped (step + point), across zoom trips and
   * reloads. Returning restores that exact picture, paused; "Start over" forgets it.
   * ================================================================ */
  var POS_KEY = 'atlas.pos.v1';
  Engine.pos = {};
  function posLoad() { var d = store(POS_KEY) || {}; Engine.pos = d.pos || {}; Engine._last = d.last || null; }
  function posSave() { store(POS_KEY, { pos: Engine.pos, last: Engine._last }); }
  function markPos(id, step, beat) { Engine.pos[id] = { s: step, b: beat }; Engine._last = id; posSave(); }

  /* Show the state at the end of point `b` of step `k` without playing anything. */
  Engine.restoreStep = function (k, b) {
    var cur = Engine.cur;
    if (!cur) return Promise.resolve();
    var steps = cur.impl.steps || [];
    if (k < 0 || k >= steps.length) return Promise.resolve();
    clearTimer(); N.stop();
    Engine.voicePaused = false;
    var token = ++Engine._stepToken;
    var st = steps[k], bs = beatsOf(st);
    b = clamp(b, 0, bs.length - 1);
    cur.pending = null; showStart(false);
    cur.step = k; cur.idle = false; cur.wait = null; cur.beatIdx = b;
    var bt = cur.bt = newBt(bs.length, st._gated);
    cur.ctx._bt = bt;
    renderStepStart(cur, st, bs);
    writeHash();
    return Engine._runInstantTo(cur, st, b).then(function () {
      if (token !== Engine._stepToken) return;
      for (var i = 0; i <= b; i++) showBeat(cur, bs, i, true);
      setNarration(bs[b].say);
      $$('span', Engine.subEl).forEach(function (sp) { sp.classList.add('past'); });
      var last = Engine.blocksEl.lastElementChild;
      if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' });
      bt.entered = b; cur.beatIdx = b;
      if (b >= bs.length - 1) { cur.idle = true; cur.wait = 'step'; flushWaiters(bt, Infinity); onStepIdle(); } else cur.wait = 'beat';
      updateNextButton(); setReady(true); updatePlayBtn();
      if (Engine.settings.autoStart) Engine.resume();
      else toast('Back where you left off. Press Next to continue, or Start over (top left).');
    });
  };

  /* forget this chamber's position and begin it again from its first point */
  Engine.restart = function () {
    var cur = Engine.cur;
    if (!cur || Engine._busy) return;
    delete Engine.pos[cur.id];
    posSave();
    Engine.tour = null;
    Engine.go(cur.id, { step: 0, transition: 'none' });
  };

  /* ================================================================
   * HOME and MUTE (reading mode)
   * ================================================================ */
  Engine.home = function () {
    closeMap(true); closeProgress(); toggleZoomMenu(false);
    $('#settings').classList.add('hidden');
    if (Engine.cur && Engine.isPlaying()) Engine.pausePlayback();
    $('#intro-resume').style.display = Engine.cur ? '' : 'none';
    $('#intro').classList.remove('hidden');
  };
  function leaveHome() {
    $('#intro').classList.add('hidden');
    if (Engine.cur && Engine.voicePaused) Engine.resumePlayback();
  }

  Engine.setMuted = function (on) {
    Engine.settings.voiceMode = on ? 'off' : 'browser';
    applyVoiceSettings();
    saveSettings();
    syncControls();
    toast(on ? 'Reading mode: narration is muted. The text panels set the pace.' : 'Narration is back on.');
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
    if (m && m.parent) Engine.go(m.parent, { transition: 'zoomOut', landOnEnd: true });
  };

  function stepCount(id) { return (Engine.impl(id).steps || []).length || 1; }

  /* ================================================================
   * BEATS
   * A step is a sequence of beats. Each beat = one idea: a narration chunk, a callout card, a chunk of
   * deep-dive HTML and the animation segment gated by ctx.beat(k). Authored steps declare
   * `beats: [{say, card, deep}]`. Legacy steps (say + deep only) get beats derived automatically.
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

  function setTimer(fn, ms) { clearTimer(); Engine._timer = setTimeout(function () { Engine._timer = 0; updatePlayBtn(); fn(); }, ms); updatePlayBtn(); }
  function clearTimer() { if (Engine._timer) { clearTimeout(Engine._timer); Engine._timer = 0; updatePlayBtn(); } }
  function stopAll() { clearTimer(); N.stop(); Engine.voicePaused = false; Engine._stepToken++; if (Engine.cur && Engine.cur.bt) flushWaiters(Engine.cur.bt, Infinity); updatePlayBtn(); }

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
    Engine.voicePaused = false;
    cur.pending = null;
    showStart(false);
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
    Engine.voicePaused = false;
    bt.entered = j;
    cur.beatIdx = j; cur.wait = null;
    markPlayed(cur.id, cur.step, j);
    markPos(cur.id, cur.step, j);
    flushWaiters(bt, j);
    showBeat(cur, bs, j, false);
    setReady(false);
    var spoke = N.speak(bs[j].say || '');
    Promise.all([spoke, animDone(cur, j)]).then(function (r) {
      if (token !== Engine._stepToken || cur.bt.entered !== j) return;
      onBeatDone(cur, st, bs, j, token, r[0] !== false);
    });
  }

  function autoRunning() { return Engine.settings.mode === 'auto' && !Engine.voicePaused; }

  function onBeatDone(cur, st, bs, j, token, spoke) {
    var last = j >= bs.length - 1;
    /* cur.wait = "the next thing needs a nudge": the timer (Auto) or the user (Step / paused) provides it */
    if (!last) {
      cur.wait = 'beat';
      if (spoke && autoRunning()) {
        setTimer(function () {
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
      setTimer(function () {
        if (token === Engine._stepToken && autoRunning()) Engine.advance();
        else if (token === Engine._stepToken) setReady(true);
      }, stepPauseMs());
    } else setReady(true);
  }

  function onStepIdle() {
    var cur = Engine.cur;
    if (!cur) return;
    var last = cur.step >= (cur.impl.steps || []).length - 1;
    $('#btn-zoom').classList.toggle('attention', last && Engine.children(cur.id).length > 0);
  }

  /* next step, next tour chamber, or stop at the end of a chamber */
  Engine.advance = function () {
    var cur = Engine.cur;
    if (!cur || Engine._busy) return;
    var n = (cur.impl.steps || []).length;
    if (cur.step < n - 1) return Engine.gotoStep(cur.step + 1);
    if (Engine.tour) {
      Engine.tour.i++;
      if (Engine.tour.i < Engine.tour.list.length) return Engine.go(Engine.tour.list[Engine.tour.i], { step: 0 });
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
    if (cur.pending) { Engine.startPending(); return; }
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

  Engine.replay = function () {
    if (!Engine.cur) return;
    if (Engine.cur.pending) { Engine.startPending(); return; }
    Engine.seekBeat(Math.max(0, Engine.cur.beatIdx));
  };

  /* the user pressed "next" on a waiting step (also how a paused auto flow continues) */
  Engine.resume = function () {
    var cur = Engine.cur;
    if (!cur || Engine._busy || !cur.wait) return;
    if (cur.wait === 'beat') Engine.next();
    else if (cur.wait === 'step') Engine.advance();
  };

  /* ---- narration play / pause (the button next to "Next point") ---- */
  Engine.isPlaying = function () { return !Engine.voicePaused && ((N.active && !N.paused) || !!Engine._timer); };

  Engine.pausePlayback = function () {
    if (Engine.voicePaused) return;
    Engine.voicePaused = true;
    N.pause();
    var cur = Engine.cur;
    clearTimer();
    if (cur && cur.wait) setReady(true);
    updatePlayBtn();
  };

  Engine.resumePlayback = function () {
    if (!Engine.voicePaused) return;
    Engine.voicePaused = false;
    var cur = Engine.cur;
    if (N.paused) N.resume();
    else if (cur && cur.wait && Engine.settings.mode === 'auto') Engine.resume();
    updatePlayBtn();
  };

  Engine.togglePlay = function () {
    if (!Engine.cur || Engine._busy) return;
    if (Engine.cur.pending) { Engine.startPending(); return; }
    if (Engine.voicePaused) Engine.resumePlayback();
    else if (Engine.isPlaying()) Engine.pausePlayback();
    else Engine.replay();          /* idle: play this point's narration again */
  };
  /* API kept for older callers */
  Engine.setPlaying = function (p) { if (p) Engine.resumePlayback(); else Engine.pausePlayback(); };

  Engine.setMode = function (pm) {
    Engine.settings.playMode = pm;
    derivePlayMode(Engine.settings);
    saveSettings();
    syncControls();
    var cur = Engine.cur;
    if (!cur || cur.pending) return;
    if (pm === 'step') { clearTimer(); if (cur.wait) setReady(true); }
    else if (cur.wait && !Engine.voicePaused) Engine.resume();
  };

  Engine.startTour = function (name) {
    var list = window.ATLAS_TOURS[name];
    Engine.tour = { name: name, list: list, i: 0 };
    closeMap(true);
    $('#intro').classList.add('hidden');
    Engine.go(list[0], { step: 0 });
    toast(name === 'deep' ? 'Deep tour: all ' + list.length + ' chambers, top-down.' : 'Big-picture tour: ' + list.length + ' chambers.');
  };

  /* HUD metric chip. Clearing only fades it out (the old text fades with it, no empty chip);
   * long strings get a smaller font and are ellipsized rather than wrapping. */
  Engine.setHud = function (s) {
    if (Engine._noHud) return;      /* poster builds replay scenes silently */
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
    if (cur.pending) { lbl.textContent = 'Start'; cnt.textContent = ''; return; }
    var nb = cur.bt.n, j = Math.max(0, cur.beatIdx);
    var n = (cur.impl.steps || []).length;
    if (cur.beatIdx < nb - 1) { lbl.textContent = 'Next point'; cnt.textContent = (j + 1) + '/' + nb; }
    else if (cur.step < n - 1) { lbl.textContent = 'Next step'; cnt.textContent = ''; }
    else if (Engine.tour) { lbl.textContent = 'Next chamber'; cnt.textContent = ''; }
    else if (Engine.children(cur.id).length) { lbl.textContent = 'Zoom in'; cnt.textContent = ''; }
    else { lbl.textContent = 'End'; cnt.textContent = ''; }
  }

  function updatePlayBtn() {
    var b = $('#btn-voice-play');
    if (!b) return;
    var playing = Engine.isPlaying();
    var waiting = !!(Engine.cur && Engine.cur.pending);
    b.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    b.classList.toggle('on', playing);
    b.classList.toggle('paused', Engine.voicePaused);
    b.classList.toggle('waiting', waiting);
    b.title = waiting ? 'Play this topic (Space)' : (playing ? 'Pause narration (Space)' : (Engine.voicePaused ? 'Resume narration (Space)' : 'Play this point again'));
  }
  N.onState = updatePlayBtn;

  function syncControls() {
    var s = Engine.settings;
    $$('#mode-seg button, #set-mode button, #intro-mode-seg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === s.playMode); });
    $$('#set-theme button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === s.theme); });
    $('#set-rate').value = String(s.rate);
    $('#set-pause').value = String(s.pause);
    $('#set-voice-mode').value = s.voiceMode;
    $('#set-cc').value = s.captions ? 'on' : 'off';
    $('#btn-rails').classList.toggle('on', !s.rails);
    $('#btn-cc').classList.toggle('on', s.captions);
    var muted = s.voiceMode === 'off', mb = $('#btn-mute');
    mb.innerHTML = muted ? ICON_SPK_OFF : ICON_SPK_ON;
    mb.classList.toggle('muted', muted);
    mb.title = muted ? 'Reading mode: narration is muted. Click to turn the voice back on (V)' : 'Mute narration and read instead (V)';
    updatePlayBtn();
  }

  /* ---------------- narration box (fixed callout in the left panel) ---------------- */
  function applyCaptionSettings() {
    document.body.classList.toggle('cc-off', !Engine.settings.captions);
  }
  /* show this beat's narration; the sentence being spoken is highlighted, the box scrolls if it is long */
  function setNarration(text) {
    var sentences = text ? N.splitSentences(text) : [];
    Engine.subEl.innerHTML = sentences.map(function (s, i) { return '<span data-i="' + i + '">' + esc(s) + ' </span>'; }).join('');
    Engine.subEl.scrollTop = 0;
    Engine.captionEl.classList.toggle('empty', !sentences.length);
  }
  N.onSentence = function (i) {
    var spans = Engine.subEl.querySelectorAll('span');
    for (var k = 0; k < spans.length; k++) { spans[k].classList.toggle('now', k === i); spans[k].classList.toggle('past', k < i); }
    var el = spans[i];
    if (el) Engine.subEl.scrollTop = Math.max(0, el.offsetTop - Engine.subEl.offsetTop - 6);
  };

  /* ---------------- chrome (HUD, top bar, rails) ---------------- */
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

  function renderZoomMenu(cur) {
    var meta = cur.meta, menu = $('#zoom-menu'), btn = $('#btn-zoom');
    menu.innerHTML = '';
    var kids = Engine.children(cur.id);
    btn.style.display = (meta.parent || kids.length) ? '' : 'none';
    btn.classList.remove('attention');
    $('#zoom-count').textContent = kids.length ? String(kids.length) : '';
    if (meta.parent) {
      var pm = Engine.meta(meta.parent);
      var up = h('button', 'mi up', '<span class="dot" style="background:' + pm.colorHex + '"></span><span><b>Zoom out</b><small>' + esc(pm.title) + '</small></span><kbd>Esc</kbd>');
      up.onclick = function () { toggleZoomMenu(false); Engine.up(); };
      menu.appendChild(up);
    }
    if (kids.length) menu.appendChild(h('div', 'mh', 'Zoom into'));
    kids.forEach(function (k) {
      var b = h('button', 'mi', '<span class="dot" style="background:' + k.colorHex + '"></span><span><b>' + esc(k.title) + (function () { var s = chamberStats(k.id); return ' <span class="pr pr' + (s.n && s.played === s.n ? 2 : (s.played || s.part ? 1 : 0)) + '"></span>' + (s.n && s.learned === s.n ? ' <em>&#10003;</em>' : ''); })() + '</b><small>' + esc(k.kicker) + '</small></span>');
      b.title = k.summary;
      b.onclick = function () { toggleZoomMenu(false); Engine.tour = null; Engine.go(k.id, { transition: 'zoomIn' }); };
      menu.appendChild(b);
    });
  }

  function toggleZoomMenu(force) {
    var m = $('#zoom-menu');
    var open = force === undefined ? m.classList.contains('hidden') : force;
    m.classList.toggle('hidden', !open);
    $('#btn-zoom').classList.toggle('on', open);
    if (open) $('#btn-zoom').classList.remove('attention');
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
    renderZoomMenu(cur);
    var pm = meta.parent ? Engine.meta(meta.parent) : null;
    $('#up-label').textContent = pm ? 'Back' : 'Start';
    $('#btn-up').title = pm ? 'Back to the level above: ' + pm.title + ' (Esc)' : 'Back to the start page';
    var tl = Engine.timelineEl;
    tl.innerHTML = '';
    (cur.impl.steps || []).forEach(function (st, i) {
      var d = h('button', 'tick', '<span>' + (i + 1) + '. ' + esc(st.title || ('Step ' + (i + 1))) + '</span>');
      d.onclick = function () { Engine.gotoStep(i); };
      tl.appendChild(d);
    });
    $('#deep-scene').innerHTML = '<div class="dk">' + esc(meta.kicker) + '</div><h2>' + esc(meta.title) + '</h2><p>' + esc(meta.summary) + '</p>';
    renderSources(cur);
    renderMap();
  }

  /* references open in their own tab so the atlas keeps playing where it was */
  function refsUrl(n) { return 'references.html' + (n ? '#ref-' + n : ''); }
  function openRefs(n) { var w = window.open(refsUrl(n), 'atlas-refs'); if (w && w.focus) w.focus(); return w; }
  Engine.openRefs = openRefs;

  function renderSources(cur) {
    var nums = (cur.impl._refNums || []).slice().sort(function (a, b) { return a - b; });
    var el = $('#sources');
    el.innerHTML = '';
    if (!nums.length) return;
    el.appendChild(h('span', 'lbl', 'Sources'));
    nums.forEach(function (n) {
      var e = Engine.refList[n - 1];
      var a = h('a', 'src', String(n));
      a.href = refsUrl(n); a.target = 'atlas-refs';
      a.title = (e ? e.text : '') + '  (opens in a new tab)';
      a.onclick = function (ev) { ev.preventDefault(); openRefs(n); };
      el.appendChild(a);
    });
    var all = h('a', 'src all', 'All references ↗');
    all.href = refsUrl(); all.target = 'atlas-refs';
    all.onclick = function (ev) { ev.preventDefault(); openRefs(); };
    el.appendChild(all);
  }

  function renderStepStart(cur, st, bs) {
    var steps = cur.impl.steps || [];
    $$('.tick', Engine.timelineEl).forEach(function (d, i) {
      d.classList.toggle('done', i < cur.step);
      d.classList.toggle('cur', i === cur.step);
    });
    $('#hud-step').textContent = 'Step ' + (cur.step + 1) + ' of ' + steps.length + '  ·  ' + (st.title || '');
    var rs = $('#rail-step');
    rs.innerHTML = '<small>Step ' + (cur.step + 1) + ' of ' + steps.length + '</small>' + esc(st.title || '');
    rs.classList.remove('swap'); void rs.offsetWidth; rs.classList.add('swap');
    $('#card-new').innerHTML = '';
    $('#hist-list').innerHTML = '';
    updateHistSummary();
    Engine.blocksEl.innerHTML = '';
    Engine._glossSeen = {};
    var pips = $('#pips');
    pips.innerHTML = '';
    bs.forEach(function (b, i) {
      var p = h('button', 'pip'); p.title = 'Point ' + (i + 1) + ' of ' + bs.length;
      p.onclick = function () { if (Engine.cur && Engine.cur.beatIdx !== i) Engine.seekBeat(i); };
      pips.appendChild(p);
    });
    setNarration('');
    $('#btn-zoom').classList.remove('attention');
    updateNextButton();
  }

  function showBeat(cur, bs, j, instant) {
    var b = bs[j];
    $$('.pip', $('#pips')).forEach(function (p, i) { p.classList.toggle('done', i < j); p.classList.toggle('cur', i === j); });
    if (!instant) setNarration(b.say);
    if (b.card) addCard(b.card, j, instant);
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
    /* the newest card owns the top slot in full; the previous one folds into "Earlier points" */
    var slot = $('#card-new'), prevCard = slot.firstElementChild;
    if (prevCard) {
      prevCard.classList.add('old');
      prevCard.classList.remove('enter');
      prevCard.onclick = function () { prevCard.classList.toggle('open'); };
      $('#hist-list').insertBefore(prevCard, $('#hist-list').firstChild);
    }
    slot.appendChild(el);
    updateHistSummary();
    if (!instant) { Engine.cardsHost.scrollTop = 0; }
  }

  function updateHistSummary() {
    var n = $('#hist-list').children.length, d = $('#card-hist');
    d.style.display = n ? '' : 'none';
    d.querySelector('summary').textContent = 'Earlier points (' + n + ')';
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

  function pulseZoom() {
    var b = $('#btn-zoom');
    b.classList.remove('attention'); void b.offsetWidth; b.classList.add('attention');
    toggleZoomMenu(true);
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
      /* the same two facts the Progress panel shows: steps played (ring + first number) and steps learned (green) */
      var s = chamberStats(m.id), ps = s.n && s.played === s.n ? 2 : (s.played || s.part ? 1 : 0);
      var b = h('button', 'mchip ' + (cls || '') + (m.id === curId ? ' cur' : ''),
        '<i>L' + m.level + '</i><span class="mt">' + esc(m.title) + '</span><span class="mstat"><span class="pr pr' + ps + '" title="' + s.played + ' of ' + s.n + ' steps played"></span>' +
        '<span class="mp" title="steps played">' + s.played + '/' + s.n + '</span><span class="ml' + (s.n && s.learned === s.n ? ' all' : (s.learned ? ' some' : '')) + '" title="steps marked learned">' + s.learned + '/' + s.n + '</span></span>');
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
          c.style.marginLeft = (depth * 14) + 'px'; c.style.width = 'calc(100% - ' + (depth * 14) + 'px)';
          sub.appendChild(c);
          walk(k.id, depth + 1);
        });
      })(m.id, 0);
      card.appendChild(sub);
      grid.appendChild(card);
    });
    var tot = 0, pl = 0, le = 0;
    Engine.order.forEach(function (m) { var s = chamberStats(m.id); tot += s.n; pl += s.played; le += s.learned; });
    $('#map-progress').textContent = 'Played ' + pl + ' of ' + tot + ' steps · learned ' + le + ' of ' + tot + ' (the same counts as the Progress panel)';
  }

  /* the map covers the stage, so narration pauses while it is open */
  function openMap() {
    if (!Engine._held) { Engine._held = true; if (Engine.isPlaying()) { Engine._heldWasPlaying = true; Engine.pausePlayback(); } else Engine._heldWasPlaying = false; }
    renderMap(); $('#map').classList.remove('hidden'); setTimeout(function () { $('#map-filter').focus(); }, 60);
  }
  function closeMap(navigating) {
    $('#map').classList.add('hidden');
    if (!Engine._held) return;
    Engine._held = false;
    if (!navigating && Engine._heldWasPlaying) Engine.resumePlayback();
  }
  Engine.openMap = openMap; Engine.closeMap = closeMap;
  Engine.closeRefs = function () {};

  /* ---------------- routing ---------------- */
  function writeHash() {
    if (!Engine.cur) return;
    var hsh = '#/' + Engine.cur.id + '/' + (Engine.cur.step + 1);
    if (location.hash !== hsh) { Engine._ownHash = hsh; history.replaceState(null, '', hsh); }
  }

  function readHash() {
    var m = /^#\/([\w-]+)(?:\/(\d+))?/.exec(location.hash || '');
    if (!m || !Engine.meta(m[1])) return null;
    return { id: m[1], step: m[2] ? parseInt(m[2], 10) - 1 : 0 };
  }

  /* ---------------- layout ---------------- */
  /* Layout. The stage is the star: one slim top bar, a left panel (narration box + callout cards) and the
   * deep-dive panel on the right. The deep dive sits inline only when the stage can still be >= 1180px wide
   * with it; on smaller windows it becomes a slide-over drawer (button / key D) so the stage keeps the room.
   * Focus mode (F) hides every panel. On very narrow windows the left panel moves below the stage. */
  var MIN_STAGE_WITH_DEEP = 1180;
  function fit() {
    var main = $('#main'), st = $('#stage'), body = document.body;
    var cs = getComputedStyle(main);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var innerW = main.clientWidth - padX, innerH = main.clientHeight - padY;
    var narrow = window.innerWidth < 900;
    var focus = !Engine.settings.rails;
    var gap = 14;
    var L = innerW < 1300 ? 250 : 280, Rw = 340;
    var maxW = innerH * 16 / 9;
    var w, inline = false, cols = '';
    body.classList.toggle('narrow', narrow);
    if (focus) {
      w = Math.min(innerW, maxW);
      cols = '1fr';
    } else if (narrow) {
      w = Math.min(innerW, innerH * 0.62 * 16 / 9);
      cols = '1fr';
    } else {
      var wBoth = Math.min(innerW - L - Rw - 2 * gap, maxW);
      var fits = wBoth >= MIN_STAGE_WITH_DEEP;
      /* deep: null = automatic (inline when it fits, otherwise closed drawer); true / false = the user's choice */
      var wantDeep = Engine.settings.deep === null || Engine.settings.deep === undefined ? fits : Engine.settings.deep;
      inline = wantDeep && fits;
      Engine._deepOpen = wantDeep;
      if (inline) {
        w = wBoth;
        var extra = Math.max(0, innerW - 2 * gap - w - L - Rw);        /* height-limited stage: share the spare width */
        var leftW = Math.min(400, L + extra * 0.4);
        cols = Math.floor(leftW) + 'px ' + Math.floor(w) + 'px 1fr';
      } else {
        w = Math.min(innerW - L - gap, maxW);
        var leftW2 = Math.min(460, L + Math.max(0, innerW - gap - w - L));
        cols = Math.floor(leftW2) + 'px ' + Math.floor(w) + 'px';
      }
    }
    w = Math.max(320, w);
    body.classList.toggle('deep-inline', inline);
    body.classList.toggle('deep-open', !focus && !inline && !!Engine._deepOpen);
    body.classList.toggle('layout-focus', focus);
    st.style.width = Math.floor(w) + 'px';
    st.style.height = Math.floor(w * 9 / 16) + 'px';
    main.style.gridTemplateColumns = cols;
    main.style.justifyContent = 'center';
    $('#btn-deep').classList.toggle('on', !focus && !!Engine._deepOpen);
  }  Engine.fit = fit;

  function setRails(on) {
    Engine.settings.rails = on;
    saveSettings(); syncControls();
    fit();
  }
  /* deep dive: inline column when there is room, slide-over drawer otherwise */
  function setDeep(on) {
    Engine.settings.deep = !!on;
    saveSettings(); syncControls();
    fit();
  }

  /* ---------------- theme / settings ---------------- */
  function saveSettings() { store(SETTINGS_KEY, Engine.settings); }

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
  Engine.setDeep = function (on) { setDeep(on); };
  Engine.setCaptions = function (on) { Engine.settings.captions = !!on; applyCaptionSettings(); saveSettings(); syncControls(); };

  function applyVoiceSettings() {
    var s = Engine.settings;
    N.rate = s.rate;
    N.setEnabled(s.voiceMode !== 'off');
    Engine.speed = Math.max(1, s.rate);
    if (s.voiceName) N.setVoiceByName(s.voiceName);
  }

  function fillVoices() {
    var sel = $('#set-voice');
    var vs = N.voices().slice().sort(function (a, b) {
      function sc(v) { return (/natural|neural|online/i.test(v.name) ? 0 : 2) + (/^en[-_]US/i.test(v.lang) ? 0 : 1); }
      return sc(a) - sc(b) || a.name.localeCompare(b.name);
    });
    sel.innerHTML = vs.map(function (v) { return '<option value="' + esc(v.name) + '">' + (/natural|neural|online/i.test(v.name) ? '★ ' : '') + esc(v.name.replace(/^Microsoft /, '')) + '</option>'; }).join('') || '<option>(none available)</option>';
    var want = Engine.settings.voiceName || (N.voice && N.voice.name) || '';
    if (want) sel.value = want;
  }

  function bindSettings() {
    var pan = $('#settings');
    function toggle(force) { var open = force === undefined ? pan.classList.contains('hidden') : force; pan.classList.toggle('hidden', !open); $('#btn-settings').classList.toggle('on', open); }
    $('#btn-settings').onclick = function (e) { e.stopPropagation(); toggleZoomMenu(false); closeProgress(); toggle(); };
    document.addEventListener('click', function (e) {
      if (!pan.classList.contains('hidden') && !e.target.closest('#settings') && !e.target.closest('#btn-settings')) toggle(false);
      if (!$('#zoom-menu').classList.contains('hidden') && !e.target.closest('#zoom-menu') && !e.target.closest('#btn-zoom')) toggleZoomMenu(false);
    });
    $$('#set-mode button, #intro-mode-seg button, #mode-seg button').forEach(function (b) {
      b.onclick = function () { Engine.setMode(b.getAttribute('data-v')); };
    });
    $$('#set-theme button').forEach(function (b) { b.onclick = function () { setTheme(b.getAttribute('data-v')); }; });
    $('#set-rate').onchange = function (e) { Engine.settings.rate = parseFloat(e.target.value); applyVoiceSettings(); saveSettings(); };
    $('#set-pause').onchange = function (e) { Engine.settings.pause = parseFloat(e.target.value); saveSettings(); };
    $('#set-voice-mode').onchange = function (e) { Engine.setMuted(e.target.value === 'off'); };
    $('#set-voice').onchange = function (e) {
      Engine.settings.voiceName = e.target.value; N.setVoiceByName(e.target.value); saveSettings();
      if (Engine.cur && !Engine._busy) Engine.replay();
    };
    $('#set-cc').onchange = function (e) { Engine.setCaptions(e.target.value === 'on'); };
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

  function bindUi() {
    $('#btn-voice-play').onclick = Engine.togglePlay;
    $('#btn-prev').onclick = Engine.prev;
    $('#btn-next').onclick = Engine.next;
    $('#btn-replay').onclick = Engine.replay;
    $('#btn-zoom').onclick = function (e) { e.stopPropagation(); $('#settings').classList.add('hidden'); toggleZoomMenu(); };
    $('#btn-cc').onclick = function () { Engine.setCaptions(!Engine.settings.captions); };
    $('#btn-map').onclick = openMap;
    $('#map-close').onclick = function () { closeMap(); };
    $('#map').onclick = function (e) { if (e.target.id === 'map') closeMap(); };
    $('#map-filter').oninput = renderMap;
    $('#tour-big').onclick = function () { Engine.startTour('bigpicture'); };
    $('#tour-deep').onclick = function () { Engine.startTour('deep'); };
    $('#btn-tour').onclick = function () { Engine.startTour('bigpicture'); };
    $('#btn-refs').onclick = function () { openRefs(); };
    $('#btn-home').onclick = Engine.home;
    $('#btn-restart').onclick = Engine.restart;
    $('#btn-up').onclick = function () { Engine.tour = null; var m = Engine.cur && Engine.meta(Engine.cur.id); if (m && m.parent) Engine.up(); else Engine.home(); };
    $('.brand').onclick = Engine.home;
    $('#btn-mute').onclick = function () { Engine.setMuted(Engine.settings.voiceMode !== 'off'); };
    $('#btn-progress').onclick = function (ev) { ev.stopPropagation(); toggleProgress(); };
    $('#prog-close').onclick = closeProgress;
    $('#prog-map').onclick = function () { closeProgress(); openMap(); };
    $('#map-progress-btn').onclick = function () { closeMap(true); openProgress(); };
    $('#prog-expand').onclick = function () { Engine.order.forEach(function (m) { progOpen[m.id] = true; }); progRender(); };
    $('#prog-collapse').onclick = function () { Engine.order.forEach(function (m) { progOpen[m.id] = false; }); progRender(); };
    $('#prog-filter').onclick = function () { progHideLearned = !progHideLearned; progRender(); };
    $('#prog-reset-p').onclick = function () { if (window.confirm('Forget which steps you have played? (Your learned checkmarks stay.)')) { Engine.progress.p = {}; progSave(); progRender(); } };
    $('#prog-reset-l').onclick = function () { if (window.confirm('Clear all learned checkmarks? (Played history stays.)')) { Engine.progress.l = {}; progSave(); progRender(); } };
    $('#btn-rails').onclick = function () { setRails(!Engine.settings.rails); };
    $('#btn-deep').onclick = function () { if (!Engine.settings.rails) Engine.settings.rails = true; setDeep(!Engine._deepOpen); };
    $('#deep-close').onclick = function () { setDeep(false); };
    $('#btn-theme').onclick = function () { setTheme(Engine.settings.theme === 'dark' ? 'light' : 'dark'); };
    window.addEventListener('keydown', function (e) {
      var tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') { if (e.key === 'Escape') closeMap(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key;
      if (!$('#intro').classList.contains('hidden')) { if (k === 'Escape' && Engine.cur) leaveHome(); return; }
      if (k === 'Escape' && !$('#prog').classList.contains('hidden')) { closeProgress(); return; }
      var mapOpen = !$('#map').classList.contains('hidden');
      if (k === 'Escape' && mapOpen) { closeMap(); return; }
      if (k === 'Escape' && !$('#zoom-menu').classList.contains('hidden')) { toggleZoomMenu(false); return; }
      if (k === 'm' || k === 'M') { mapOpen ? closeMap() : openMap(); e.preventDefault(); return; }
      if (mapOpen) return;
      if (k === 'ArrowRight' || k === 'PageDown') { Engine.next(); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { Engine.prev(); e.preventDefault(); }
      else if (k === ' ') { if (Engine.settings.mode === 'auto' || (Engine.cur && Engine.cur.pending)) Engine.togglePlay(); else Engine.next(); e.preventDefault(); }
      else if (k === 'p' || k === 'P') { Engine.togglePlay(); }
      else if (k === 'Escape' || k === 'Backspace' || k === 'ArrowUp') { Engine.tour = null; Engine.up(); e.preventDefault(); }
      else if (k === 'd' || k === 'D') { if (!Engine.settings.rails) Engine.settings.rails = true; setDeep(!Engine._deepOpen); }
      else if (k === 'f' || k === 'F') { setRails(!Engine.settings.rails); }
      else if (k === 'r' || k === 'R') { Engine.replay(); }
      else if (k === 't' || k === 'T') { setTheme(Engine.settings.theme === 'dark' ? 'light' : 'dark'); }
      else if (k === 's' || k === 'S') { var order = ['step', 'topic', 'auto']; Engine.setMode(order[(order.indexOf(Engine.settings.playMode) + 1) % 3]); }
      else if (k === 'c' || k === 'C') { Engine.setCaptions(!Engine.settings.captions); }
      else if (k === 'z' || k === 'Z') { toggleZoomMenu(); }
      else if (k === 'v' || k === 'V') { Engine.setMuted(Engine.settings.voiceMode !== 'off'); }
      else if (k === 'l' || k === 'L') { toggleProgress(); }
      else if (k === 'h' || k === 'H') { Engine.home(); }
    });
    window.addEventListener('resize', fit);
    window.addEventListener('hashchange', function () {
      if (location.hash === Engine._ownHash) return;
      var r = readHash();
      if (r && (!Engine.cur || r.id !== Engine.cur.id)) Engine.go(r.id, { step: r.step });
    });
    bindSettings();
    bindPopover();
  }

  Engine.boot = function () {
    try { window.name = 'atlas-app'; } catch (e) { /* ignore */ }
    initCatalog();
    Engine.refList = R.build(Engine.order, Engine.scenes);
    buildGlossary();
    Engine.settings = Object.assign({}, DEFAULTS, store(SETTINGS_KEY) || {});
    derivePlayMode(Engine.settings);
    Engine.visited = store('atlas.visited') || {};
    progLoad();
    posLoad();
    Engine.svg = $('#svg');
    Engine.defs = $('#defs');
    Engine.bgEl = $('#bg');
    Engine.camEl = $('#cam');
    Engine.canvasHost = $('#canvas-host');
    Engine.crumbsEl = $('#crumbs');
    Engine.timelineEl = $('#timeline');
    Engine.subEl = $('#narr-text');
    Engine.captionEl = $('#narr');
    Engine.flashEl = $('#flash');
    Engine.hudMetric = $('#hud-metric');
    Engine.cardsHost = $('#cards-host');
    Engine.cardsEl = $('#cards');
    Engine.blocksEl = $('#deep-blocks');
    buildDefs(Engine.defs);
    buildBg(Engine.bgEl);
    document.documentElement.setAttribute('data-theme', Engine.settings.theme);
    applyVoiceSettings();
    applyCaptionSettings();
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
    $('#intro-resume').onclick = function () { if (Engine.cur) leaveHome(); else start(function () { Engine.go(Engine._last); }); };
    $('#intro-resume').style.display = Engine._last && Engine.meta(Engine._last) ? '' : 'none';
    $('#intro-go').onclick = function () { start(function () { var r = readHash(); Engine.go(r ? r.id : 'overview', { step: r ? r.step : 0 }); }); };
    $('#intro-tour').onclick = function () { start(function () { Engine.startTour('bigpicture'); }); };
    $('#intro-map').onclick = function () { start(function () { Engine.go('overview').then(function () { openMap(); }); }); };
    $('#start-btn').onclick = function () { Engine.startPending(); };
  };

  window.Atlas = {
    register: Engine.register,
    engine: Engine,
    C: C
  };
  document.addEventListener('DOMContentLoaded', function () { Engine.boot(); });
})();
