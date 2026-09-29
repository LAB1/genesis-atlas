/* Headless smoke test. Open index.html?smoke (or ?smoke=id1,id2) — results are written
 * into <pre id="smoke-out"> as JSON. Driven by tools/smoke.py via headless Edge/Chrome. */
(function () {
  'use strict';
  /* headless virtual time does not drive rAF; use timers instead */
  var fakeNow = 0;
  window.requestAnimationFrame = function (cb) { return setTimeout(function () { fakeNow += 16; cb(fakeNow); }, 16); };
  var realPerfNow = performance.now.bind(performance);
  performance.now = function () { return fakeNow || realPerfNow(); };
  window.cancelAnimationFrame = function (id) { clearTimeout(id); };
  var errs = [];
  var cur = '';
  var origErr = console.error;
  console.error = function () {
    var a = Array.prototype.map.call(arguments, function (x) { return x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x); });
    errs.push({ scene: cur, msg: a.join(' ') });
    origErr.apply(console, arguments);
  };
  window.addEventListener('error', function (e) { errs.push({ scene: cur, msg: 'window.onerror: ' + e.message + ' @' + e.lineno }); });

  function withTimeout(p, ms, what) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout: ' + what)); }, ms); })]);
  }

  function run() {
    var E = window.Atlas.engine;
    window.AtlasNarrator.enabled = false;
    E.speed = 60;
    var only = (/smoke=([\w,-]+)/.exec(location.search) || [])[1];
    var ids = E.order.map(function (m) { return m.id; }).filter(function (id) { return !only || only.split(',').indexOf(id) >= 0; });
    var report = [];
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        cur = id;
        var impl = E.scenes[id];
        if (!impl) { report.push({ id: id, status: 'placeholder' }); return; }
        var n = (impl.steps || []).length;
        var before = errs.length;
        var rec = { id: id, steps: n };
        /* pass 1: instant fast-forward of all steps */
        return withTimeout(E._build(id, n), 8000, id + ' instant').then(function (s) {
          rec.elements = s.wrap.getElementsByTagName('*').length;
          s.ctx.destroy(); s.wrap.parentNode.removeChild(s.wrap);
          /* pass 2: animated playback of every step at high speed */
          return E._build(id, 0);
        }).then(function (s) {
          s.ctx.speed = 60;
          E.cur = s;
          var p = Promise.resolve();
          (impl.steps || []).forEach(function (st, k) {
            p = p.then(function () {
              cur = id + '#' + (k + 1);
              return withTimeout(Promise.resolve().then(function () { return st.run(s.ctx); }), 15000, id + ' step ' + (k + 1));
            });
          });
          return p.then(function () {
            rec.elementsAnimated = s.wrap.getElementsByTagName('*').length;
            s.ctx.destroy(); s.wrap.parentNode.removeChild(s.wrap);
            E.cur = null;
          });
        }).catch(function (e) {
          errs.push({ scene: cur, msg: 'FAILED: ' + (e && e.message) });
        }).then(function () {
          rec.errors = errs.slice(before).map(function (x) { return x.scene + ': ' + x.msg; });
          rec.status = rec.errors.length ? 'ERROR' : 'ok';
          report.push(rec);
        });
      });
    });
    chain.then(function () {
      var pre = document.createElement('pre');
      pre.id = 'smoke-out';
      pre.textContent = 'SMOKE-BEGIN' + JSON.stringify(report) + 'SMOKE-END';
      document.body.appendChild(pre);
    });
  }

  /* ?smoke&shot=id:step  → render one step (1-based) with full chrome for a screenshot */
  function shot(spec) {
    var E = window.Atlas.engine;
    var parts = spec.split(':');
    window.AtlasNarrator.enabled = false;
    E.speed = 60;
    var intro = document.getElementById('intro');
    intro.classList.add('hidden');
    intro.style.display = 'none';   /* no fade: screenshots must never catch the overlay */
    E.setPlaying(false, true);
    E.go(parts[0], { step: Math.max(0, parseInt(parts[1] || '1', 10) - 1), transition: 'none' });
  }

  /* ?smoke&nav → exercise real navigation: zoom in/out transitions, backward rebuilds,
   * tour advance across scene boundaries, map open/close. */
  function nav() {
    var E = window.Atlas.engine;
    var N = window.AtlasNarrator;
    N.enabled = false; E.speed = 60;
    N.speak = function () { return new Promise(function (r) { setTimeout(function () { r(true); }, 30); }); };
    document.getElementById('intro').style.display = 'none';
    E.setPlaying(false, true);
    var log = [];
    function settle(what) {
      return new Promise(function (resolve) {
        var t0 = 0;
        (function poll() {
          if (!E._busy && E.cur && E.cur.idle) return resolve();
          t0 += 50;
          if (t0 > 30000) { errs.push({ scene: what, msg: 'nav settle timeout' }); return resolve(); }
          setTimeout(poll, 50);
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
        E.up(); return settle(cur);
      }).then(function () {
        expect(m.parent, cur + ' (up)');
        log.push(m.id);
      });
    });
    /* tour: jump to the last step of each scene and advance across the boundary */
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
      E.openMap(); E.closeMap();
    });
    chain.then(function () {
      var pre = document.createElement('pre');
      pre.id = 'smoke-out';
      var rep = [{ id: 'navigation', steps: log.length, elementsAnimated: log.length + ' zoom round-trips', status: errs.length ? 'ERROR' : 'ok', errors: errs.map(function (x) { return x.scene + ': ' + x.msg; }) }];
      pre.textContent = 'SMOKE-BEGIN' + JSON.stringify(rep) + 'SMOKE-END';
      document.body.appendChild(pre);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var m = /[?&]shot=([\w-]+(?::\d+)?)/.exec(location.search);
    var isNav = /[?&]nav\b/.test(location.search);
    setTimeout(function () { if (m) shot(m[1]); else if (isNav) nav(); else run(); }, 50);
  });
})();
