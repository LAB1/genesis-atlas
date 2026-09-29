/* Headless test harness. Loaded by index.html when the URL has ?smoke. Results are written into
 * <pre id="smoke-out"> as JSON between SMOKE-BEGIN / SMOKE-END; tools/smoke.py drives it in one headless
 * Edge/Chrome process.
 *   ?smoke[=id1,id2]      build + animated replay + beat-gate + seek-consistency checks
 *   ?smoke&nav            zoom in/out, backward jumps, tour boundaries, map/refs pages
 *   ?smoke&layout[=ids]   layout audit at the end of every beat (overlaps, overflow, HUD, off-canvas)
 *   ?smoke&shot=id:step[:beat]&theme=dark|light   render one beat for a screenshot                    */
(function () {
  'use strict';
  /* headless virtual time does not drive rAF; use timers and a synthetic clock instead */
  var fakeNow = 0;
  window.requestAnimationFrame = function (cb) { return setTimeout(function () { fakeNow += 16; cb(fakeNow); }, 16); };
  window.cancelAnimationFrame = function (id) { clearTimeout(id); };
  var realPerfNow = performance.now.bind(performance);
  performance.now = function () { return fakeNow || realPerfNow(); };

  var errs = [];
  var cur = '';
  var origErr = console.error;
  console.error = function () {
    var a = Array.prototype.map.call(arguments, function (x) { return x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x); });
    errs.push({ scene: cur, msg: a.join(' ') });
    origErr.apply(console, arguments);
  };
  window.addEventListener('error', function (e) { errs.push({ scene: cur, msg: 'window.onerror: ' + e.message + ' @' + e.lineno }); });

  var QS = location.search;
  function param(name) { var m = new RegExp('[?&]' + name + '=([^&]*)').exec(QS); return m ? decodeURIComponent(m[1]) : null; }
  function has(name) { return new RegExp('[?&]' + name + '(?:[=&]|$)').test(QS); }

  function withTimeout(p, ms, what) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout: ' + what)); }, ms); })]);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function prep() {
    var E = window.Atlas.engine;
    window.AtlasNarrator.enabled = false;
    E.speed = 60;
    var intro = document.getElementById('intro');
    intro.classList.add('hidden'); intro.style.display = 'none';   /* never let it into a screenshot */
    var th = param('theme');
    if (th) E.setTheme(th);
    return E;
  }

  function newBt(n, gated) {
    var bt = { n: n, gated: gated, entered: -1, reached: 0, waiters: [], runDone: false, onProgress: null };
    return bt;
  }
  function flush(bt) {
    var keep = [];
    bt.waiters.forEach(function (w) { if (w.k <= bt.entered) w.res(); else keep.push(w); });
    bt.waiters = keep;
  }
  /* emulate Auto mode with no narration: entering the next beat as soon as a segment reports done */
  function autoBt(n, gated) {
    var bt = newBt(n, gated);
    bt.entered = 0;
    bt.onProgress = function () { if (bt.reached > bt.entered) { bt.entered = bt.reached; flush(bt); } };
    return bt;
  }

  /* ---------------------------------------------------------------- run */
  function run() {
    var E = prep();
    var only = param('smoke');
    var ids = E.order.map(function (m) { return m.id; }).filter(function (id) { return !only || only.split(',').indexOf(id) >= 0; });
    var report = [];
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        cur = id;
        var impl = E.scenes[id];
        if (!impl) { report.push({ id: id, status: 'placeholder' }); return; }
        var steps = impl.steps || [];
        var n = steps.length;
        var before = errs.length;
        var rec = { id: id, steps: n, beats: 0, gated: 0 };
        var fullCounts = [];
        /* pass 1: instant fast-forward of all steps; element counts after each step */
        return withTimeout(E._build(id, n), 8000, id + ' instant').then(function (s) {
          rec.elements = s.wrap.getElementsByTagName('*').length;
          s.ctx.destroy(); s.wrap.parentNode.removeChild(s.wrap);
          var p = Promise.resolve();
          steps.forEach(function (st, k) {
            p = p.then(function () { return E._build(id, k + 1); }).then(function (b) {
              fullCounts[k] = b.wrap.getElementsByTagName('*').length;
              b.ctx.destroy(); b.wrap.parentNode.removeChild(b.wrap);
            });
          });
          return p;
        }).then(function () {
          /* pass 2: animated replay of every step with beat gating emulated */
          return E._build(id, 0);
        }).then(function (s) {
          s.ctx.speed = 60;
          E.cur = s;
          var p = Promise.resolve();
          steps.forEach(function (st, k) {
            p = p.then(function () {
              cur = id + '#' + (k + 1);
              var bs = E.beatsOf(st);
              rec.beats += bs.length;
              if (st._gated) rec.gated++;
              var bt = autoBt(bs.length, st._gated);
              s.ctx._bt = bt;
              return withTimeout(Promise.resolve().then(function () { return st.run(s.ctx); }), 20000, id + ' step ' + (k + 1)).then(function () {
                bt.runDone = true;
                if (st._gated && bs.length > 1 && bt.reached !== bs.length - 1) {
                  errs.push({ scene: cur, msg: 'step declares ' + bs.length + ' beats but run() reached gate ' + bt.reached + ' (expected ctx.beat(1..' + (bs.length - 1) + ')); step "' + st.title + '"' });
                }
                if (!st._gated && bt.reached > 0) errs.push({ scene: cur, msg: 'run() calls ctx.beat() but the step has no beats[]' });
                s.ctx._bt = null;
              });
            });
          });
          return p.then(function () {
            rec.elementsAnimated = s.wrap.getElementsByTagName('*').length;
            s.ctx.destroy(); s.wrap.parentNode.removeChild(s.wrap);
            E.cur = null;
          });
        }).then(function () {
          /* pass 3: seek consistency. Jump instantly to the start of the LAST beat of each gated step,
           * release the gate and let the step finish: the DOM must match the straight instant build. */
          var p = Promise.resolve();
          steps.forEach(function (st, k) {
            var bs = E.beatsOf(st);
            if (!st._gated || bs.length < 2) return;
            p = p.then(function () {
              cur = id + '#' + (k + 1) + ' seek';
              return E._build(id, k).then(function (s) {
                var bt = newBt(bs.length, true);
                s.ctx._bt = bt; s.bt = bt;
                s.step = k; s.meta = E.meta(id);
                return E._runInstantTo(s, st, bs.length - 2).then(function () {
                  if (!bt.runDone && bt.reached < bs.length - 1) errs.push({ scene: cur, msg: 'instant seek did not reach gate ' + (bs.length - 1) + ' (reached ' + bt.reached + ')' });
                  bt.entered = Infinity; flush(bt);
                  s.ctx.instant = true;
                  return sleep(30).then(function () {
                    var cnt = s.wrap.getElementsByTagName('*').length;
                    if (fullCounts[k] !== undefined && Math.abs(cnt - fullCounts[k]) > 0) {
                      errs.push({ scene: cur, msg: 'seek+resume DOM differs from straight build: ' + cnt + ' vs ' + fullCounts[k] + ' elements (step "' + st.title + '")' });
                    }
                    s.ctx.destroy(); s.wrap.parentNode.removeChild(s.wrap);
                  });
                });
              });
            });
          });
          return p;
        }).catch(function (e) {
          errs.push({ scene: cur, msg: 'FAILED: ' + (e && e.message) });
        }).then(function () {
          rec.errors = errs.slice(before).map(function (x) { return x.scene + ': ' + x.msg; });
          rec.status = rec.errors.length ? 'ERROR' : 'ok';
          report.push(rec);
        });
      });
    });
    chain.then(function () { finish(report); });
  }

  function finish(report) {
    var pre = document.createElement('pre');
    pre.id = 'smoke-out';
    pre.textContent = 'SMOKE-BEGIN' + JSON.stringify(report) + 'SMOKE-END';
    document.body.appendChild(pre);
  }

  /* ---------------------------------------------------------------- layout audit */
  function effOpacity(el, root) {
    var o = 1;
    for (var n = el; n && n !== root.parentNode; n = n.parentNode) {
      if (n.nodeType !== 1) break;
      var a = n.getAttribute && n.getAttribute('opacity');
      if (a !== null && a !== undefined && a !== '') o *= parseFloat(a);
      var cs = n.style;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return 0;
      if (n.getAttribute && (n.getAttribute('display') === 'none' || n.getAttribute('visibility') === 'hidden')) return 0;
      if (n.getAttribute && n.getAttribute('data-overlap-ok') !== null) return -1;   /* author whitelisted */
    }
    return o;
  }

  function measure(E, s) {
    var svgR = E.svg.getBoundingClientRect();
    var k = 1600 / svgR.width;
    function toBox(r) { return { x: (r.left - svgR.left) * k, y: (r.top - svgR.top) * k, w: r.width * k, h: r.height * k }; }
    var camActive = s.ctx._camNow && (Math.abs(s.ctx._camNow.s - 1) > 0.01 || Math.abs(s.ctx._camNow.x - 800) > 1 || Math.abs(s.ctx._camNow.y - 450) > 1);
    var items = [];
    Array.prototype.forEach.call(s.wrap.querySelectorAll('text'), function (t) {
      var str = (t.textContent || '').trim();
      if (!str) return;
      var eff = effOpacity(t, s.wrap);
      if (eff < 0.3 && eff !== -1) return;
      if (eff === -1) return;
      var r = t.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      items.push({ el: t, str: str, eff: eff, b: toBox(r) });
    });
    var issues = [];
    function inner(b) { return { x: b.x + 1, y: b.y + b.h * 0.18, w: Math.max(0, b.w - 2), h: b.h * 0.64 }; }
    function inter(a, b) { var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? w * h : 0; }
    /* 1. text over text */
    for (var i = 0; i < items.length; i++) {
      for (var j = i + 1; j < items.length; j++) {
        var A = inner(items[i].b), B = inner(items[j].b);
        var ia = inter(A, B);
        if (!ia) continue;
        var ratio = ia / Math.max(1, Math.min(A.w * A.h, B.w * B.h));
        if (ratio > 0.18) issues.push({ type: 'text-overlap', a: items[i].str.slice(0, 40), b: items[j].str.slice(0, 40), at: [Math.round(A.x), Math.round(A.y)], ratio: +ratio.toFixed(2) });
      }
    }
    /* 2. off-canvas, 3. HUD collisions */
    items.forEach(function (it) {
      var b = it.b;
      if (!camActive && (b.x < -2 || b.y < -2 || b.x + b.w > 1602 || b.y + b.h > 902)) issues.push({ type: 'offscreen', a: it.str.slice(0, 40), at: [Math.round(b.x), Math.round(b.y)], size: [Math.round(b.w), Math.round(b.h)] });
      if (!camActive) {
        var hud1 = { x: 0, y: 0, w: 860, h: 150 }, hud2 = { x: 1150, y: 0, w: 450, h: 66 };
        var ib = inner(b);
        if (inter(ib, hud1) > 0 || inter(ib, hud2) > 0) issues.push({ type: 'hud-collision', a: it.str.slice(0, 40), at: [Math.round(b.x), Math.round(b.y)] });
      }
    });
    /* 3b. text hidden behind an opaque node drawn after it */
    var bodies = [];
    Array.prototype.forEach.call(s.wrap.querySelectorAll('g.node'), function (g) {
      if (!g.body || g.body.getAttribute('fill') === 'none') return;
      if (effOpacity(g, s.wrap) < 0.7) return;
      bodies.push({ g: g, box: toBox(g.body.getBoundingClientRect()) });
    });
    items.forEach(function (it) {
      if (it.eff < 0.5) return;
      bodies.forEach(function (bd) {
        if (bd.g.contains(it.el)) return;
        if (!(it.el.compareDocumentPosition(bd.g.body) & 4)) return;   /* node must come later in DOM = on top */
        var ib = inner(it.b);
        var ia = inter(ib, bd.box);
        if (ia > 0.5 * Math.max(1, ib.w * ib.h)) issues.push({ type: 'text-occluded', a: it.str.slice(0, 40), by: (bd.g.titleEl ? bd.g.titleEl.textContent : 'node').slice(0, 30), at: [Math.round(it.b.x), Math.round(it.b.y)] });
      });
    });    /* 4. text spilling out of its node / pill */
    Array.prototype.forEach.call(s.wrap.querySelectorAll('g'), function (g) {
      var body = g.body || g.rectEl;
      var texts = [];
      if (g.body) { if (g.titleEl) texts.push(g.titleEl); if (g.subEl) texts.push(g.subEl); }
      else if (g.rectEl && g.textEl) texts.push(g.textEl);
      if (!body || !texts.length) return;
      if (effOpacity(g, s.wrap) < 0.3) return;
      var rb = toBox(body.getBoundingClientRect());
      texts.forEach(function (t) {
        if (!t.textContent) return;
        var rt = toBox(t.getBoundingClientRect());
        var over = Math.max(rb.x - rt.x, (rt.x + rt.w) - (rb.x + rb.w));
        if (over > 3) issues.push({ type: g.body ? 'node-overflow' : 'pill-overflow', a: t.textContent.slice(0, 40), by: Math.round(over), at: [Math.round(rt.x), Math.round(rt.y)] });
      });
    });
    return issues;
  }

  function layout() {
    var E = prep();
    var only = param('layout');
    var ids = E.order.map(function (m) { return m.id; }).filter(function (id) { return !only || only.split(',').indexOf(id) >= 0; });
    var report = [];
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      var impl = E.scenes[id];
      if (!impl) return;
      var steps = impl.steps || [];
      steps.forEach(function (st, k) {
        var bs = E.beatsOf(st);
        var nb = st._gated ? bs.length : 1;
        for (var j = 0; j < nb; j++) {
          (function (j) {
            chain = chain.then(function () {
              cur = id + '#' + (k + 1) + '.' + (j + 1);
              return E._build(id, k).then(function (s) {
                s.step = k; s.meta = E.meta(id);
                var bt = newBt(bs.length, st._gated);
                s.ctx._bt = bt; s.bt = bt;
                E.cur = s;
                var upTo = st._gated ? j : bs.length;      /* end state of beat j (last beat = whole step) */
                return E._runInstantTo(s, st, upTo).then(function () {
                  return sleep(5);
                }).then(function () {
                  var iss = measure(E, s);
                  iss.forEach(function (x) { x.scene = id; x.step = k + 1; x.beat = j + 1; x.title = st.title; report.push(x); });
                  s.ctx.destroy(); s.wrap.parentNode.removeChild(s.wrap); E.cur = null;
                });
              });
            }).catch(function (e) { errs.push({ scene: cur, msg: 'layout FAILED: ' + (e && e.message) }); });
          })(j);
        }
      });
    });
    chain.then(function () {
      var rep = [{ id: 'layout', status: errs.length ? 'ERROR' : 'ok', errors: errs.map(function (x) { return x.scene + ': ' + x.msg; }), issues: report }];
      finish(rep);
    });
  }

  /* ---------------------------------------------------------------- navigation */
  function nav() {
    var E = prep();
    var N = window.AtlasNarrator;
    N.speak = function () { return new Promise(function (r) { setTimeout(function () { r(true); }, 25); }); };
    E.setMode('step');
    var log = [];
    /* settle: keep pressing Next until the step is idle */
    function settle(what) {
      return new Promise(function (resolve) {
        var t0 = 0;
        (function poll() {
          var c = E.cur;
          if (!E._busy && c && c.bt && c.idle) return resolve();
          if (!E._busy && c && c.wait === 'beat') E.next();
          t0 += 40;
          if (t0 > 40000) { errs.push({ scene: what, msg: 'nav settle timeout (beat ' + (c && c.beatIdx) + ' wait=' + (c && c.wait) + ')' }); return resolve(); }
          setTimeout(poll, 40);
        })();
      });
    }
    function expect(id, what) { if (!E.cur || E.cur.id !== id) errs.push({ scene: what, msg: 'expected scene ' + id + ' got ' + (E.cur && E.cur.id) }); }
    function last(id) { return (E.impl(id).steps || []).length - 1; }
    var chain = Promise.resolve().then(function () { E.go('overview'); return settle('overview'); });
    E.order.filter(function (m) { return m.parent; }).forEach(function (m) {
      chain = chain.then(function () {
        cur = 'nav:' + m.id;
        E.go(m.parent, { step: last(m.parent), transition: 'fade' });
        return settle(cur);
      }).then(function () {
        E.zoomInto(m.id, { x: 700, y: 400, w: 200, h: 100 });
        return settle(cur);
      }).then(function () {
        expect(m.id, cur);
        E.gotoStep(last(m.id)); return settle(cur);
      }).then(function () {
        E.gotoStep(1); return settle(cur);            /* backward rebuild */
      }).then(function () {
        expect(m.id, cur);
        E.seekBeat(0); return sleep(80);              /* pips / beat seek */
      }).then(function () {
        E.up(); return settle(cur);
      }).then(function () {
        expect(m.parent, cur + ' (up)');
        log.push(m.id);
      });
    });
    chain = chain.then(function () {
      var list = window.ATLAS_TOURS.bigpicture;
      E.tour = { name: 'bigpicture', list: list, i: 0 };
      var c = Promise.resolve();
      list.slice(0, -1).forEach(function (id, i) {
        c = c.then(function () {
          cur = 'tour:' + id;
          E.tour.i = i;
          E.go(id, { step: last(id), transition: 'none' });
          return settle(cur);
        }).then(function () { E.advance(); return settle(cur); }).then(function () { expect(list[i + 1], cur + ' advance'); });
      });
      return c;
    }).then(function () {
      E.tour = null;
      E.openMap(); E.closeMap(true);
      E.openRefs(3); E.closeRefs(true);
      if (!E.refList.length) errs.push({ scene: 'refs', msg: 'no references indexed' });
    });
    chain.then(function () {
      finish([{ id: 'navigation', steps: log.length, elementsAnimated: log.length + ' zoom round-trips, ' + E.refList.length + ' references', status: errs.length ? 'ERROR' : 'ok', errors: errs.map(function (x) { return x.scene + ': ' + x.msg; }) }]);
    });
  }

  /* ---------------------------------------------------------------- screenshots */
  function shot(spec) {
    var E = prep();
    var parts = spec.split(':');
    var size = param('size');
    E.setMode('step');
    window.AtlasNarrator.rate = 40;
    E.go(parts[0], { step: Math.max(0, parseInt(parts[1] || '1', 10) - 1), beat: Math.max(0, parseInt(parts[2] || '1', 10) - 1), transition: 'none' });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var m = /[?&]shot=([\w-]+(?::\d+){0,2})/.exec(QS);
    setTimeout(function () {
      if (m) shot(m[1]);
      else if (has('nav')) nav();
      else if (has('layout')) layout();
      else run();
    }, 50);
  });
})();
