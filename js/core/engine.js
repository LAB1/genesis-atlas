/* Atlas engine: scene registry, navigation, zoom transitions, step playback,
 * narration sync, deep-dive drawer, system map, tours and hash routing. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var X = window.AtlasCtx;
  var W = X.W, H = X.H, C = X.C;
  var N = window.AtlasNarrator;

  function $(s) { return document.querySelector(s); }
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return null; }

  var Engine = {
    scenes: {},          /* registered implementations */
    catalog: {},         /* id -> meta */
    order: [],
    cur: null,           /* { id, ctx, wrap, step } */
    playing: true,
    tour: null,          /* { list, i, name } */
    visited: {},
    _stepToken: 0,
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
    /* depth-first order for the deep tour */
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
  /* opts: { step (0-based), transition: 'zoomIn'|'zoomOut'|'fade'|'none', box: {x,y,w,h} } */
  Engine.go = function (id, opts) {
    opts = opts || {};
    if (!Engine.meta(id)) id = 'overview';
    if (Engine._busy) { Engine._queued = [id, opts]; return Promise.resolve(); }
    Engine._busy = true;
    N.stop();
    Engine._stepToken++;
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
        return Engine.playStep(step);
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
    f.style.background = 'radial-gradient(circle at 50% 50%, ' + X.hexA(col, 0.35) + ', transparent 60%)';
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

  /* ---------------- step playback ---------------- */
  Engine.playStep = function (k) {
    var cur = Engine.cur;
    if (!cur) return Promise.resolve();
    var steps = cur.impl.steps || [];
    if (k < 0 || k >= steps.length) return Promise.resolve();
    var token = ++Engine._stepToken;
    cur.step = k;
    cur.idle = false;
    var st = steps[k];
    updateStepChrome();
    writeHash();
    var anim = Promise.resolve().then(function () { return st.run ? st.run(cur.ctx) : null; })
      .catch(function (e) { reportError(cur.meta, st, e); });
    var voice = N.speak(st.say || '');
    return Promise.all([anim, voice]).then(function (res) {
      if (token !== Engine._stepToken) return;
      cur.idle = true;
      Engine.dockEl.classList.remove('speaking');
      if (!Engine.playing || res[1] === false) { onStepIdle(); return; }
      setTimeout(function () {
        if (token !== Engine._stepToken || !Engine.playing) return;
        Engine.advance();
      }, 900);
    });
  };

  function onStepIdle() {
    var cur = Engine.cur;
    if (!cur) return;
    var last = cur.step >= (cur.impl.steps || []).length - 1;
    Engine.zoomEl.classList.toggle('attention', last);
  }

  /* next step, or next scene when a tour is active */
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
    Engine.setPlaying(false);
    onStepIdle();
    if (!Engine.tour) toast(Engine.children(cur.id).length ? 'End of chamber — zoom into a highlighted component, or press Esc to go up.' : 'End of chamber — press Esc to zoom out.');
  };

  Engine.gotoStep = function (k) {
    var cur = Engine.cur;
    if (!cur || Engine._busy) return;
    var n = (cur.impl.steps || []).length;
    k = Math.max(0, Math.min(n - 1, k));
    if (k === cur.step + 1) return Engine.playStep(k);
    /* rebuild to k (fast-forward), then animate step k */
    N.stop();
    Engine._stepToken++;
    Engine._busy = true;
    var old = cur;
    old.ctx.destroy();
    return Engine._build(cur.id, k).then(function (next) {
      teardown(old);
      setWrapTf(next.wrap, W / 2, H / 2, 1, 1);
      Engine.cur = next;
      Engine._busy = false;
      return Engine.playStep(k);
    });
  };

  Engine.prev = function () { if (Engine.cur) Engine.gotoStep(Engine.cur.step - 1); };
  Engine.next = function () {
    if (!Engine.cur) return;
    var n = (Engine.cur.impl.steps || []).length;
    if (Engine.cur.step < n - 1) Engine.gotoStep(Engine.cur.step + 1);
    else { var kids = Engine.children(Engine.cur.id); if (Engine.tour) Engine.advance(); else if (kids.length) pulseZoom(); }
  };

  Engine.replay = function () { if (Engine.cur) Engine.gotoStep(Engine.cur.step); };

  Engine.setPlaying = function (p, noAdvance) {
    Engine.playing = p;
    $('#btn-play').innerHTML = p ? '&#10074;&#10074;' : '&#9654;';
    $('#btn-play').classList.toggle('on', p);
    $('#btn-play').title = p ? 'Pause autoplay (Space)' : 'Autoplay (Space)';
    if (p && !noAdvance && Engine.cur && Engine.cur.idle && !Engine._busy) Engine.advance();
  };

  Engine.startTour = function (name) {
    var list = window.ATLAS_TOURS[name];
    Engine.tour = { name: name, list: list, i: 0 };
    Engine.setPlaying(true, true);
    closeMap();
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

  /* ---------------- chrome (HUD, drawer, dock) ---------------- */
  function markVisited(id) { Engine.visited[id] = 1; store('atlas.visited', Engine.visited); }

  function updateChrome() {
    var cur = Engine.cur, meta = cur.meta;
    document.documentElement.style.setProperty('--accent', meta.colorHex);
    document.documentElement.style.setProperty('--accent-a', X.hexA(meta.colorHex, 0.16));
    /* breadcrumbs */
    var crumbs = Engine.crumbsEl;
    crumbs.innerHTML = '';
    Engine.path(cur.id).forEach(function (m, i, arr) {
      var b = h('button', 'crumb' + (i === arr.length - 1 ? ' cur' : ''), '<i>L' + m.level + '</i>' + esc(m.title));
      b.style.setProperty('--c', m.colorHex);
      b.onclick = function () { if (m.id !== cur.id) Engine.go(m.id, { transition: 'zoomOut' }); };
      crumbs.appendChild(b);
      if (i < arr.length - 1) crumbs.appendChild(h('span', 'sep', '›'));
    });
    /* HUD */
    $('#hud-level').textContent = 'L' + meta.level + ' · ' + ['SYSTEM', 'SUBSYSTEM', 'COMPONENT', 'PRIMITIVE'][meta.level];
    $('#hud-kicker').textContent = meta.kicker;
    $('#hud-title').textContent = meta.title;
    /* zoom chips */
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
    if (kids.length) z.appendChild(h('span', 'zlabel', 'ZOOM INTO'));
    kids.forEach(function (k) {
      var b = h('button', 'zchip', esc(k.title) + (Engine.visited[k.id] ? ' <em>&#10003;</em>' : ''));
      b.style.setProperty('--c', k.colorHex);
      b.title = k.summary;
      b.onclick = function () { Engine.tour = null; Engine.go(k.id, { transition: 'zoomIn' }); };
      z.appendChild(b);
    });
    /* timeline */
    var tl = Engine.timelineEl;
    tl.innerHTML = '';
    (cur.impl.steps || []).forEach(function (st, i) {
      var d = h('button', 'tick', '<span>' + esc(st.title || ('Step ' + (i + 1))) + '</span>');
      d.onclick = function () { Engine.gotoStep(i); };
      tl.appendChild(d);
    });
    /* drawer: scene header + refs */
    $('#deep-scene').innerHTML = '<div class="dk">' + esc(meta.kicker) + '</div><h2>' + esc(meta.title) + '</h2><p>' + esc(meta.summary) + '</p>';
    var refs = cur.impl.refs || [];
    $('#refs').innerHTML = refs.length ? '<h4>Key references</h4><ul>' + refs.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' : '';
    renderMap();
  }

  function updateStepChrome() {
    var cur = Engine.cur;
    var steps = cur.impl.steps || [];
    var st = steps[cur.step] || {};
    Array.prototype.forEach.call(Engine.timelineEl.children, function (d, i) {
      d.classList.toggle('done', i < cur.step);
      d.classList.toggle('cur', i === cur.step);
    });
    $('#hud-step').textContent = String(cur.step + 1).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0') + '  ·  ' + (st.title || '');
    $('#deep-step').innerHTML = '<div class="step-no">STEP ' + (cur.step + 1) + '</div><h3>' + esc(st.title || '') + '</h3>' + (st.deep || '<p class="muted">—</p>');
    $('#deep').scrollTop = 0;
    var sentences = N.splitSentences(st.say || '');
    Engine.subEl.innerHTML = sentences.map(function (s, i) { return '<span data-i="' + i + '">' + esc(s) + ' </span>'; }).join('');
    Engine.dockEl.classList.add('speaking');
    Engine.zoomEl.classList.toggle('attention', cur.step >= steps.length - 1);
  }

  N.onSentence = function (i) {
    var spans = Engine.subEl.querySelectorAll('span');
    for (var k = 0; k < spans.length; k++) { spans[k].classList.toggle('now', k === i); spans[k].classList.toggle('past', k < i); }
    var el = spans[i];
    if (el) Engine.subEl.scrollTop = Math.max(0, el.offsetTop - Engine.subEl.offsetTop - 8);
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
      b.onclick = function () { closeMap(); Engine.tour = null; Engine.go(m.id); };
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
    $('#map-progress').textContent = n + ' / ' + Engine.order.length + ' chambers explored';
  }

  function openMap() { renderMap(); $('#map').classList.remove('hidden'); setTimeout(function () { $('#map-filter').focus(); }, 50); }
  function closeMap() { $('#map').classList.add('hidden'); }
  Engine.openMap = openMap; Engine.closeMap = closeMap;

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

  /* ---------------- stage sizing ---------------- */
  function fit() {
    var wrap = $('#stage-wrap'), st = $('#stage');
    var ww = wrap.clientWidth - 24, hh = wrap.clientHeight - 16;
    var w = Math.min(ww, hh * 16 / 9);
    st.style.width = Math.floor(w) + 'px';
    st.style.height = Math.floor(w * 9 / 16) + 'px';
  }

  /* ---------------- boot ---------------- */
  function buildDefs(defs) {
    defs.innerHTML =
      '<filter id="fx-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<filter id="fx-glow-strong" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<linearGradient id="fx-panel-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#12203c" stop-opacity="0.95"/><stop offset="1" stop-color="#070d1b" stop-opacity="0.95"/></linearGradient>' +
      '<pattern id="fx-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#16223a" stroke-width="1"/></pattern>' +
      '<pattern id="fx-grid-big" width="200" height="200" patternUnits="userSpaceOnUse"><path d="M200 0H0V200" fill="none" stroke="#1d2c4b" stroke-width="1.2"/></pattern>' +
      '<radialGradient id="fx-vignette" cx="50%" cy="50%" r="70%"><stop offset="0.72" stop-color="#05080f" stop-opacity="0"/><stop offset="1" stop-color="#05080f" stop-opacity="0.45"/></radialGradient>';
  }

  function buildBg(bg) {
    bg.innerHTML = '<rect x="-800" y="-450" width="3200" height="1800" fill="url(#fx-grid)"/><rect x="-800" y="-450" width="3200" height="1800" fill="url(#fx-grid-big)"/>';
  }

  function bindUi() {
    $('#btn-play').onclick = function () { Engine.setPlaying(!Engine.playing); };
    $('#btn-prev').onclick = Engine.prev;
    $('#btn-next').onclick = Engine.next;
    $('#btn-replay').onclick = Engine.replay;
    $('#btn-up').onclick = Engine.up;
    $('#btn-map').onclick = openMap;
    $('#map-close').onclick = closeMap;
    $('#map').onclick = function (e) { if (e.target.id === 'map') closeMap(); };
    $('#map-filter').oninput = renderMap;
    $('#tour-big').onclick = function () { Engine.startTour('bigpicture'); };
    $('#tour-deep').onclick = function () { Engine.startTour('deep'); };
    $('#btn-tour').onclick = function () { Engine.startTour('bigpicture'); };
    $('#btn-drawer').onclick = function () { document.body.classList.toggle('drawer-closed'); setTimeout(fit, 320); };
    var vb = $('#btn-voice');
    function syncVoice() { vb.classList.toggle('on', N.enabled); vb.innerHTML = N.enabled ? '&#128266; Voice' : '&#128263; Muted'; }
    vb.onclick = function () { N.enabled = !N.enabled; store('atlas.voice', N.enabled); syncVoice(); if (!N.enabled) N.stop(); Engine.replay(); };
    var saved = store('atlas.voice');
    if (saved === false) N.enabled = false;
    syncVoice();
    $('#sel-rate').onchange = function (e) { N.rate = parseFloat(e.target.value); Engine.speed = Math.max(1, N.rate); };
    window.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Escape') closeMap(); return; }
      var mapOpen = !$('#map').classList.contains('hidden');
      if (e.key === 'm' || e.key === 'M') { mapOpen ? closeMap() : openMap(); e.preventDefault(); }
      else if (mapOpen) { if (e.key === 'Escape') closeMap(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { Engine.next(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { Engine.prev(); e.preventDefault(); }
      else if (e.key === ' ') { Engine.setPlaying(!Engine.playing); e.preventDefault(); }
      else if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'ArrowUp') { Engine.tour = null; Engine.up(); e.preventDefault(); }
      else if (e.key === 'd' || e.key === 'D') { $('#btn-drawer').click(); }
      else if (e.key === 'r' || e.key === 'R') { Engine.replay(); }
      else if (e.key === 'v' || e.key === 'V') { vb.click(); }
    });
    window.addEventListener('resize', fit);
    window.addEventListener('hashchange', function () {
      if (location.hash === Engine._ownHash) return;
      var r = readHash();
      if (r && (!Engine.cur || r.id !== Engine.cur.id)) Engine.go(r.id, { step: r.step });
    });
  }

  Engine.boot = function () {
    initCatalog();
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
    buildDefs(Engine.defs);
    buildBg(Engine.bgEl);
    if (window.innerWidth < 820) document.body.classList.add('drawer-closed');
    bindUi();
    fit();
    var missing = Engine.order.filter(function (m) { return !Engine.scenes[m.id]; }).map(function (m) { return m.id; });
    if (missing.length) console.info('[atlas] placeholder scenes:', missing.join(', '));
    $('#intro-count').textContent = Engine.order.length;
    $('#intro-go').onclick = function () { $('#intro').classList.add('hidden'); var r = readHash(); Engine.go(r ? r.id : 'overview', { step: r ? r.step : 0 }); };
    $('#intro-tour').onclick = function () { $('#intro').classList.add('hidden'); Engine.startTour('bigpicture'); };
    $('#intro-map').onclick = function () { $('#intro').classList.add('hidden'); Engine.setPlaying(false, true); Engine.go('overview'); openMap(); };
    Engine.setPlaying(true, true);
  };

  window.Atlas = {
    register: Engine.register,
    engine: Engine,
    C: C
  };
  document.addEventListener('DOMContentLoaded', function () { Engine.boot(); });
})();
