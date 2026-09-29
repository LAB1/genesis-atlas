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
    E._forceAutoStart = true;      /* tests drive topics themselves; the wait-for-Play gate is tested separately in nav */
    E._forceFresh = true;          /* ... and never restore saved positions unless a test asks for it */
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
      if (n.classList && n.classList.contains('hotspot-hint')) return 0;      /* hidden by CSS until hover */
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
        /* the REAL rendered title block at this viewport (it scales with the stage, but measure, don't assume) */
        var hr = document.getElementById('hud').getBoundingClientRect();
        var hud1 = toBox(hr); hud1.w += 8; hud1.h += 8;
        var hud2 = { x: 1150, y: 0, w: 450, h: 66 };
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
    var realSpeak = N.speak;
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
      if (!E.refList.length) errs.push({ scene: 'refs', msg: 'no references indexed' });
      /* narration play / pause button, captions, zoom menu */
      cur = 'controls';
      E.go('overview', { step: 1, transition: 'none' });
      return sleep(300).then(function () {
        N.speak = realSpeak; N.enabled = false; N.rate = 0.6;     /* real narrator, muted reading clock */
        E.setMode('auto');
        E.next(); return sleep(120);
      }).then(function () {
        E.togglePlay();
        if (!E.voicePaused) errs.push({ scene: cur, msg: 'togglePlay did not pause' });
        var b = document.getElementById('btn-voice-play');
        if (!b || !/M8 4l12 8/.test(b.innerHTML)) errs.push({ scene: cur, msg: 'play button should show a play icon while paused' });
        E.togglePlay();
        if (E.voicePaused) errs.push({ scene: cur, msg: 'togglePlay did not resume' });
        E.setCaptions(false); E.setCaptions(true);
        document.getElementById('btn-zoom').click();
        var menuOpen = !document.getElementById('zoom-menu').classList.contains('hidden');
        if (!menuOpen) errs.push({ scene: cur, msg: 'zoom menu did not open' });
        document.getElementById('btn-zoom').click();
        /* a newly opened topic waits for Play unless the user chose Auto */
        cur = 'wait-for-play';
        E._forceAutoStart = false; E.setMode('topic');
        E.go('llm', { transition: 'none' });
        return sleep(500);
      }).then(function () {
        if (!E.cur || E.cur.id !== 'llm') { errs.push({ scene: cur, msg: 'did not open llm' }); return; }
        if (!E.cur.pending) errs.push({ scene: cur, msg: 'a newly opened topic should wait for Play' });
        if (N.active) errs.push({ scene: cur, msg: 'narration started by itself' });
        if (document.getElementById('start').classList.contains('hidden')) errs.push({ scene: cur, msg: 'start prompt is not shown' });
        E.next();
        return sleep(250).then(function () {
          if (E.cur.pending) errs.push({ scene: cur, msg: 'Next did not start the waiting topic' });
          if (E.cur.beatIdx !== 0) errs.push({ scene: cur, msg: 'first beat did not start' });
          E.setMode('auto');
          E.go('overview', { transition: 'none' });
          return sleep(500);
        }).then(function () {
          if (!E.cur || E.cur.pending) errs.push({ scene: cur, msg: 'Auto mode must start new topics by itself' });
          E._forceAutoStart = false; E.setMode('topic');
          cur = 'chrome';
          E.go('llm', { transition: 'none' });
          return sleep(1000);
        }).then(function () {
          /* backdrop = complete system diagram while the topic waits */
          var g = document.getElementById('poster');
          if (!E.cur || !E.cur.pending) errs.push({ scene: cur, msg: 'llm should be waiting for Play' });
          if (!g.classList.contains('show') || !g.getElementsByTagName('text').length) errs.push({ scene: cur, msg: 'pending topic has no system-diagram backdrop' });
          /* back button goes to the parent chamber */
          document.getElementById('btn-up').click();
          return sleep(1000);
        }).then(function () {
          if (!E.cur || E.cur.id !== 'overview') errs.push({ scene: cur, msg: 'Back did not return to the parent (got ' + (E.cur && E.cur.id) + ')' });
          /* home shows the start page and can resume */
          E.home();
          var intro = document.getElementById('intro');
          if (intro.classList.contains('hidden')) errs.push({ scene: cur, msg: 'Home did not show the start page' });
          if (document.getElementById('intro-resume').style.display === 'none') errs.push({ scene: cur, msg: 'start page lacks Continue button' });
          document.getElementById('intro-resume').click();
          if (!intro.classList.contains('hidden')) errs.push({ scene: cur, msg: 'Continue did not close the start page' });
          /* mute = reading mode */
          E.setMuted(true);
          if (N.enabled) errs.push({ scene: cur, msg: 'mute left narration enabled' });
          if (!document.getElementById('btn-mute').classList.contains('muted')) errs.push({ scene: cur, msg: 'mute button not shown as muted' });
          E.setMuted(false);
          if (!N.enabled) errs.push({ scene: cur, msg: 'unmute did not re-enable narration' });
          /* progress: two separate marks, jump */
          E.openProgress();
          var prog = document.getElementById('prog');
          if (prog.classList.contains('hidden')) errs.push({ scene: cur, msg: 'progress panel did not open' });
          if (document.querySelectorAll('#prog-tree .pc').length < 10) errs.push({ scene: cur, msg: 'progress tree is too short' });
          E.setLearned('overview', 0, true);
          if (!E.progress.l['overview/0']) errs.push({ scene: cur, msg: 'learned mark not stored' });
          if (E.progress.p['overview/0'] === E.progress.l['overview/0'] && E.progress.p['overview/0'] === 1) { /* same object is fine; the maps are separate */ }
          E.setLearned('overview', 0, false);
          E.jumpTo('llm', 1);
          return sleep(1000);
        }).then(function () {
          if (!E.cur || E.cur.id !== 'llm' || E.cur.step !== 1) errs.push({ scene: cur, msg: 'jumpTo did not open llm step 2 (got ' + (E.cur && E.cur.id) + '/' + (E.cur && E.cur.step) + ')' });
          if (!document.getElementById('prog').classList.contains('hidden')) errs.push({ scene: cur, msg: 'progress panel should close after a jump' });
          /* saved position: leave a chamber mid-way, come back, land in the same picture; Start over resets */
          cur = 'restore';
          E._forceFresh = false; E._forceAutoStart = false; E.setMode('topic');
          E.go('overview', { step: 3, transition: 'none' });
          return sleep(700);
        }).then(function () {
          E.next(); return sleep(300);            /* start the waiting topic: point 1 */
        }).then(function () {
          E.next(); return sleep(300);            /* point 2 */
        }).then(function () {
          if (!E.pos.overview || E.pos.overview.s !== 3 || E.pos.overview.b !== 1) errs.push({ scene: cur, msg: 'position not recorded: ' + JSON.stringify(E.pos.overview) });
          E.zoomInto('llm', { x: 700, y: 400, w: 200, h: 100 });
          return sleep(1300);
        }).then(function () {
          if (!E.cur || E.cur.id !== 'llm') errs.push({ scene: cur, msg: 'did not zoom into llm' });
          document.getElementById('btn-up').click();
          return sleep(1600);
        }).then(function () {
          var c2 = E.cur;
          if (!c2 || c2.id !== 'overview') { errs.push({ scene: cur, msg: 'Back did not return to overview' }); return; }
          if (c2.step !== 3 || c2.beatIdx !== 1) errs.push({ scene: cur, msg: 'returned to step ' + c2.step + ' point ' + c2.beatIdx + ', expected step 3 point 1' });
          if (c2.pending) errs.push({ scene: cur, msg: 'returning should restore the picture, not wait at the start' });
          if (!document.querySelectorAll('#card-new .card, #hist-list .card').length) errs.push({ scene: cur, msg: 'restored page lost its callout cards' });
          if (!document.getElementById('poster').classList.contains('show') === false && document.getElementById('poster').children.length) errs.push({ scene: cur, msg: 'poster should not show on a restored page' });
          document.getElementById('btn-restart').click();
          return sleep(900);
        }).then(function () {
          var c3 = E.cur;
          if (!c3 || c3.step !== 0 || !c3.pending) errs.push({ scene: cur, msg: 'Start over did not return to a waiting first step' });
          if (E.pos.overview) errs.push({ scene: cur, msg: 'Start over should forget the saved position' });
          E._forceFresh = true;
          E._forceAutoStart = true; E.setMode('step');
        });
      });
    });
    chain.then(function () {
      finish([{ id: 'navigation', steps: log.length, elementsAnimated: log.length + ' zoom round-trips, ' + E.refList.length + ' references', status: errs.length ? 'ERROR' : 'ok', errors: errs.map(function (x) { return x.scene + ': ' + x.msg; }) }]);
    });
  }

  /* ---------------------------------------------------------------- chrome audit (shell layout at this window size) */
  /* CSS animations / transitions are jumped to their end state (headless virtual time does not run them reliably) */
  function noAnim() {
    var st0 = document.createElement('style');
    st0.textContent = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }';
    document.head.appendChild(st0);
  }

  function chrome() {
    var E = prep();
    noAnim();
    E.setMode('step');
    var iw = window.innerWidth, ih = window.innerHeight;
    var issues = [], info = {};
    function R(el) { return el.getBoundingClientRect(); }
    function vis(el) { var r = R(el), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }
    function name(el) { return el.id ? '#' + el.id : (el.className && el.className.baseVal === undefined ? '.' + String(el.className).split(' ')[0] : el.tagName.toLowerCase()); }
    function overlap(a, b) { var w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return w > 0 && h > 0 ? w * h : 0; }
    function audit(tag, opts) {
      var tb = document.getElementById('topbar');
      var ctrls = Array.prototype.slice.call(tb.querySelectorAll('.brand, #btn-home, #btn-up, #btn-restart, #crumbs, #playbar > *, .top-actions > *, .top-actions .menuwrap > button')).filter(function (e) { return e.id !== 'zoom-menu' && !e.classList.contains('menuwrap') && !e.classList.contains('tick'); });
      var boxes = [];
      ctrls.forEach(function (e) {
        if (!vis(e)) return;
        var r = R(e);
        boxes.push({ e: e, r: r });
        if (r.left < -0.5 || r.right > iw + 0.5) issues.push({ type: 'topbar-clipped', tag: tag, el: name(e), x: [Math.round(r.left), Math.round(r.right)], win: iw });
        if (r.top < -0.5 || r.bottom > tb.getBoundingClientRect().bottom + 0.5) issues.push({ type: 'topbar-outside', tag: tag, el: name(e) });
      });
      for (var i = 0; i < boxes.length; i++) for (var j = i + 1; j < boxes.length; j++) {
        if (boxes[i].e.contains(boxes[j].e) || boxes[j].e.contains(boxes[i].e)) continue;
        var a = overlap(boxes[i].r, boxes[j].r);
        if (a > 6) issues.push({ type: 'topbar-overlap', tag: tag, a: name(boxes[i].e), b: name(boxes[j].e), area: Math.round(a) });
      }
      var de = document.documentElement;
      if (de.scrollWidth > iw + 1 || document.body.scrollWidth > iw + 1) {
        var offs = [];
        Array.prototype.slice.call(document.querySelectorAll('#app *')).forEach(function (e) {
          if (e.closest('svg') || e.closest('#poster')) return;
          var cs = getComputedStyle(e);
          if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return;
          var pcs = e.parentElement && getComputedStyle(e.parentElement);
          if (e.closest('#rail-right, #prog, #settings, #map, #intro, #toast, #hud, #hud-metric, #start, #pop')) return;
          var r = R(e);
          if (r.width > 0 && r.right > iw + 1) offs.push(name(e) + ':' + Math.round(r.right));
        });
        issues.push({ type: 'page-hscroll', tag: tag, scrollWidth: Math.max(de.scrollWidth, document.body.scrollWidth), win: iw, offenders: offs.slice(0, 6) });
      }
      if (de.scrollHeight > ih + 1) issues.push({ type: 'page-vscroll', tag: tag, scrollHeight: de.scrollHeight, win: ih });
      /* the main column */
      var st = R(document.getElementById('stage'));
      if (st.right > iw + 1 || st.bottom > ih + 1 || st.left < -1) issues.push({ type: 'stage-outside', tag: tag, rect: [Math.round(st.left), Math.round(st.top), Math.round(st.right), Math.round(st.bottom)] });
      info[tag] = { stage: [Math.round(st.width), Math.round(st.height)], topbarH: Math.round(R(tb).height), stageTop: Math.round(st.top), free: [Math.round(iw - st.width), Math.round(ih - R(tb).height - st.height)] };
      var rl = document.getElementById('rail-left');
      if (vis(rl)) {
        var lr = R(rl);
        if (lr.right > iw + 1 || lr.bottom > ih + 1) issues.push({ type: 'left-rail-outside', tag: tag, rect: [Math.round(lr.left), Math.round(lr.top), Math.round(lr.right), Math.round(lr.bottom)] });
        info[tag].left = [Math.round(lr.width), Math.round(lr.height)];
        var narr = R(document.getElementById('narr')), ch = R(document.getElementById('cards-host'));
        info[tag].narr = [Math.round(narr.width), Math.round(narr.height)]; info[tag].cards = [Math.round(ch.width), Math.round(ch.height)];
        if (ch.height < 90 && !document.body.classList.contains('cc-off')) issues.push({ type: 'cards-squeezed', tag: tag, h: Math.round(ch.height) });
      }
      /* fixed panels must stay inside the window and below the top bar */
      ['settings', 'prog', 'rail-right', 'zoom-menu'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el || !vis(el)) return;
        var r = R(el);
        if (r.right > iw + 1 || r.bottom > ih + 1 || r.left < -1) issues.push({ type: 'panel-outside', tag: tag, el: id, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
        if (id !== 'zoom-menu' && r.top < R(tb).bottom - 1) issues.push({ type: 'panel-over-topbar', tag: tag, el: id, top: Math.round(r.top), bar: Math.round(R(tb).bottom) });
      });
      /* text that does not fit its control */
      Array.prototype.slice.call(document.querySelectorAll('#topbar button, #topbar .seg button, #settings .srow')).forEach(function (e) {
        if (vis(e) && !e.classList.contains('crumb') && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible') issues.push({ type: 'text-clipped', tag: tag, el: name(e), sw: e.scrollWidth, cw: e.clientWidth });
      });
      /* hidden controls (display:none by responsive rules) */
      var hid = [];
      Array.prototype.slice.call(tb.querySelectorAll('button, .seg, #pips, #crumbs')).forEach(function (e) { if (!vis(e) && !e.closest('#zoom-menu') && !e.classList.contains('tick') && !e.classList.contains('pip') && !e.closest('#crumbs') && !e.closest('.seg') || (e.classList && e.classList.contains('seg') && !vis(e))) hid.push(name(e)); });
      info[tag].hidden = hid;
    }
    var chain = Promise.resolve();
    chain = chain.then(function () { E.go('client', { step: 2, beat: 2, transition: 'none' }); return sleep(1200); })
      .then(function () { audit('base'); })
      .then(function () { E.setDeep(true); return sleep(700); }).then(function () {
        if (!document.body.classList.contains('deep-open') && !document.body.classList.contains('deep-inline')) issues.push({ type: 'deep-did-not-open', tag: 'deep-open', win: iw });
        var rr = document.getElementById('rail-right').getBoundingClientRect();
        if (rr.width < 200 || rr.left >= iw) issues.push({ type: 'deep-not-visible', tag: 'deep-open', rect: [Math.round(rr.left), Math.round(rr.top), Math.round(rr.right), Math.round(rr.bottom)] });
        audit('deep-open'); E.setDeep(false); return sleep(700);
      })
      .then(function () { document.getElementById('btn-settings').click(); return sleep(700); }).then(function () { audit('settings'); document.getElementById('btn-settings').click(); return sleep(700); })
      .then(function () { E.openProgress(); return sleep(700); }).then(function () { audit('progress'); E.closeProgress(); return sleep(700); })
      .then(function () { document.getElementById('btn-zoom').click(); return sleep(700); }).then(function () { audit('zoom'); document.getElementById('btn-zoom').click(); return sleep(700); })
      .then(function () { E.setRails(false); return sleep(700); }).then(function () { audit('focus'); E.setRails(true); return sleep(700); })
      .then(function () {
        /* keyboard: is anything focusable parked off-screen or hidden while it is closed? */
        var bad = [];
        Array.prototype.slice.call(document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')).forEach(function (e) {
          if (e.tabIndex < 0 || e.disabled) return;
          var cs = getComputedStyle(e), r = R(e);
          if (cs.visibility === 'hidden' || cs.display === 'none') return;         /* unreachable = fine */
          if (e.closest('[inert]')) return;
          if (r.width && r.height && (r.left >= iw || r.right <= 0 || r.top >= ih || r.bottom <= 0) && !e.closest('#timeline')) bad.push(name(e) + '<' + (e.closest('[id]') ? e.closest('[id]').id : '?') + ':' + cs.visibility);
        });
        if (bad.length) issues.push({ type: 'focusable-offscreen', tag: 'base', els: bad.slice(0, 8), n: bad.length });
      });
    chain.then(function () {
      finish([{ id: 'chrome', status: errs.length ? 'ERROR' : 'ok', errors: errs.map(function (x) { return x.scene + ': ' + x.msg; }), issues: issues, info: info, win: [iw, ih] }]);
    });
  }

  /* ---------------------------------------------------------------- keyboard / accessibility checks
   *   ?smoke&a11y : every control has an accessible name, focus is visible, Escape closes the topmost panel, a closed drawer
   *   is not focusable, toggle buttons expose aria-pressed, hotspots are keyboard operable                                     */
  function a11y() {
    var E = prep();
    noAnim();
    E.setMode('step');
    var $ = function (s) { return document.querySelector(s); };
    var problems = [];
    function bad(m) { problems.push(m); errs.push({ scene: 'a11y', msg: m }); }
    function key(k, target) { (target || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }
    function open(sel) { return !$(sel).classList.contains('hidden'); }
    function nameOf(b) { return (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').replace(/\s+/g, ' ').trim(); }
    E.go('client', { step: 2, beat: 1, transition: 'none' });
    return sleep(1200).then(function () {
      /* 1. accessible names */
      Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], a[href], select, input')).forEach(function (b) {
        var r = b.getBoundingClientRect(), cs = getComputedStyle(b);
        if (cs.display === 'none' || (b.closest('#map, #intro') && false)) return;
        var n = nameOf(b);
        if (!n && b.labels && b.labels.length) n = 'label';
        if (!n) bad('control without an accessible name: <' + b.tagName.toLowerCase() + ' ' + (b.id ? '#' + b.id : b.className) + '>');
      });
      /* 2. focus ring: focus each topbar button by script (keyboard modality) and read the computed outline */
      var noRing = [];
      Array.prototype.slice.call(document.querySelectorAll('#topbar button:not(.tick), .brand, #btn-next, #start-btn, #intro-go, #map-close, #prog-close, #deep-close')).forEach(function (b) {
        if (getComputedStyle(b).display === 'none' || getComputedStyle(b).visibility === 'hidden') return;
        b.focus();
        var cs = getComputedStyle(b);
        var ok = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 && cs.outlineColor !== 'rgba(0, 0, 0, 0)';
        if (document.activeElement === b && !ok) noRing.push(b.id || b.className);
        if (document.activeElement === b && !b.matches(':focus-visible')) noRing.push((b.id || b.className) + '(not :focus-visible)');
      });
      if (noRing.length) bad('no visible focus ring on: ' + noRing.join(', '));
      document.activeElement && document.activeElement.blur();
      /* 3. Escape closes exactly one layer at a time, topmost first */
      E.setDeep(true);
      $('#btn-settings').click(); $('#btn-zoom').click();
      /* opening the map takes the small popovers (settings, zoom menu, progress) away: the map is then the topmost layer */
      $('#btn-settings').click();
      E.openMap();
      if (open('#settings') || open('#zoom-menu') || open('#prog')) bad('opening the map left a popover open on top of it');
      var layers = [['map', function () { return open('#map'); }], ['deep drawer', function () { return document.body.classList.contains('deep-open') || document.body.classList.contains('deep-inline'); }]];
      var wide = document.body.classList.contains('deep-inline');
      layers.forEach(function (L) { L.was = L[1](); });
      layers.forEach(function (L) {
        if (L[0] === 'deep drawer' && wide) return;
        if (!L.was) { bad('setup: ' + L[0] + ' was not open'); return; }
        key('Escape');
        if (L[1]()) bad('Escape did not close the ' + L[0]);
      });
      E.openProgress(); key('Escape'); if (open('#prog')) bad('Escape did not close Progress');
      document.getElementById('btn-zoom').click(); key('Escape'); if (open('#zoom-menu')) bad('Escape did not close the zoom menu');
      /* Escape with nothing open still zooms out (client -> overview) */
      /* 4. closed drawer is unreachable by Tab */
      if (!wide) {
        E.setDeep(false);
        var rr = $('#rail-right'), inertOrHidden = rr.inert || getComputedStyle(rr).visibility === 'hidden';
        if (!inertOrHidden) bad('a closed deep-dive drawer can still take keyboard focus');
      }
      /* 5. toggle state exposed */
      ['#btn-mute', '#btn-cc', '#btn-rails'].forEach(function (s) { if (!$(s).hasAttribute('aria-pressed')) bad(s + ' has no aria-pressed'); });
      ['#btn-zoom', '#btn-settings', '#btn-progress'].forEach(function (s) { if (!$(s).hasAttribute('aria-expanded')) bad(s + ' has no aria-expanded'); });
      /* 6. Space on a focused button activates the button, not the atlas' Next */
      var before = E.cur && E.cur.beatIdx;
      $('#btn-cc').focus(); key('Enter', $('#btn-cc'));
      var sp = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      $('#btn-cc').dispatchEvent(sp);
      if (sp.defaultPrevented) bad('Space on a focused button is swallowed by the global shortcut handler');
      var pg = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
      $('#deep').dispatchEvent(pg);
      if (pg.defaultPrevented) bad('PageDown inside the scrolling deep-dive text is swallowed (keyboard users cannot scroll it)');
      /* 7. reduced motion rule exists in the stylesheet */
      var hasRM = false;
      Array.prototype.slice.call(document.styleSheets).forEach(function (ss) { try { Array.prototype.slice.call(ss.cssRules).forEach(function (r) { if (r.media && /prefers-reduced-motion/.test(r.media.mediaText)) hasRM = true; }); } catch (e) { /* cross-origin */ } });
      if (!hasRM) bad('no prefers-reduced-motion rule');
      /* 8. tab order: DOM order equals visual order in the top bar (left to right), then left panel, stage, deep */
      var seen = [];
      Array.prototype.slice.call(document.querySelectorAll('#topbar button:not(.tick), #topbar .brand')).forEach(function (b) {
        var r = b.getBoundingClientRect(); if (r.width && getComputedStyle(b).visibility !== 'hidden') seen.push(Math.round((r.top + r.height / 2) / 30) * 100000 + r.left);
      });
      for (var i = 1; i < seen.length; i++) if (seen[i] < seen[i - 1] - 1) { bad('top bar Tab order differs from visual order at index ' + i); break; }
    }).then(function () {
      finish([{ id: 'a11y', status: problems.length ? 'ERROR' : 'ok', errors: errs.map(function (x) { return x.scene + ': ' + x.msg; }), issues: [], win: [innerWidth, innerHeight], info: { checked: 'names, focus rings, Escape stack, drawer inert, aria state, key handling, tab order' } }]);
    });
  }

  /* ---------------------------------------------------------------- click harness
   *   ?smoke&clicks[=id1,id2]
   * For every scene, and for the END state of every step (built instantly, like --layout):
   *   1. find the interactive SVG elements: those a scene gave a listener for click / mouse / pointer events (addEventListener is
   *      instrumented while scenes build, `el.onclick = ...` properties are read) and those with style.cursor === 'pointer';
   *   2. dispatch the events on them (hover, press, click; two passes so toggles are exercised both ways) and assert that no
   *      console error / window error / unhandled rejection is raised, that the scene layer still has its elements and that no
   *      click navigated away;
   *   3. separately click every .hotspot with Engine.go stubbed: it must be invoked once with the hotspot's data-target as a zoom-in,
   *      the target must be a child of the scene, and Enter on the focused hotspot must do the same. Every child of the scene must be
   *      reachable by some hotspot. */
  function clicks() {
    var E = prep();
    var only = param('clicks');
    var ids = E.order.map(function (m) { return m.id; }).filter(function (id) { return !only || only.split(',').indexOf(id) >= 0; });
    var report = [];
    var recorded = [];
    var REC = { click: 1, dblclick: 1, mousedown: 1, mouseup: 1, mouseover: 1, mouseenter: 1, mousemove: 1, pointerdown: 1, pointerup: 1, pointerover: 1, pointerenter: 1, pointermove: 1, touchstart: 1, touchend: 1 };
    var origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (REC[type] && this && this.nodeType === 1) recorded.push({ el: this, type: type });
      return origAdd.apply(this, arguments);
    };
    window.addEventListener('unhandledrejection', function (e) { errs.push({ scene: cur, msg: 'unhandled rejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason) }); });
    var PROPS = ['onclick', 'onmousedown', 'onmouseup', 'onmouseover', 'onmouseenter', 'onmousemove', 'onpointerdown', 'onpointerup', 'onpointerover', 'onpointermove', 'ontouchstart'];

    function fire(el, type) {
      var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, ev;
      try {
        if (type.indexOf('pointer') === 0) ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window });
        else if (type.indexOf('touch') === 0) ev = new Event(type, { bubbles: true, cancelable: true });
        else ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window });
      } catch (e) { ev = new Event(type, { bubbles: true, cancelable: true }); }
      el.dispatchEvent(ev);
    }
    function visible(el, layer) {
      var o = effOpacity(el, layer);              /* -1 = data-overlap-ok ancestor (layout whitelist), counts as visible */
      if (o !== -1 && o < 0.05) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    }
    /* interactive elements in the layer: [{el, types}] (hotspots excluded) */
    function collect(layer) {
      var map = new Map();
      function add(el, t) { if (!map.has(el)) map.set(el, {}); map.get(el)[t] = 1; }
      recorded.forEach(function (r) { if (layer.contains(r.el) && !r.el.closest('.hotspot')) add(r.el, r.type); });
      Array.prototype.forEach.call(layer.querySelectorAll('*'), function (el) {
        if (el.closest('.hotspot') || el.closest('defs')) return;
        if (el.style && el.style.cursor === 'pointer') add(el, 'click');
        for (var i = 0; i < PROPS.length; i++) if (typeof el[PROPS[i]] === 'function') add(el, PROPS[i].slice(2));
      });
      var out = [];
      map.forEach(function (types, el) { if (visible(el, layer)) out.push({ el: el, types: Object.keys(types) }); });
      return out;
    }
    var ORDER = ['pointerover', 'mouseover', 'mouseenter', 'pointerenter', 'pointermove', 'mousemove', 'pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'dblclick'];
    function exercise(it, counters) {
      var types = ORDER.filter(function (t) { return t === 'click' || it.types.indexOf(t) >= 0; });
      types.forEach(function (t) { fire(it.el, t); });
      counters.clicks++;
    }
    function hasContent(layer) { return layer.getElementsByTagName('*').length > 0; }

    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        var impl = E.scenes[id];
        if (!impl) { report.push({ id: id, status: 'placeholder' }); return; }
        var steps = impl.steps || [];
        var rec = { id: id, steps: steps.length, clickable: 0, interactions: 0, hotspots: 0 };
        var before = errs.length;
        var counters = { clicks: 0 };
        var reach = {}, notes = [], soft = [];
        var realGo = E.go, calls = [];
        var p = Promise.resolve();
        steps.forEach(function (st, k) {
          p = p.then(function () {
            cur = id + '#' + (k + 1) + ' clicks';
            recorded.length = 0;
            return withTimeout(E._build(id, k + 1), 15000, cur + ' build').then(function (s) {
              var layer = s.ctx.layer, wrap = s.wrap;
              var items = collect(layer);
              rec.clickable += items.length;
              var n0 = layer.getElementsByTagName('*').length;
              /* real navigation must not be triggered by scene clicks; stub Engine.go for the whole step to catch it */
              calls.length = 0;
              E.go = function (gid, o) { calls.push({ id: gid, opts: o }); return Promise.resolve(); };
              var q = Promise.resolve();
              [1, 2].forEach(function (pass) {
                q = q.then(function () {
                  var list = pass === 1 ? items : collect(layer);
                  list = list.slice(0, 80);
                  var chain2 = Promise.resolve();
                  list.forEach(function (it) {
                    chain2 = chain2.then(function () {
                      if (!wrap.parentNode || !layer.contains(it.el)) return;          /* removed by an earlier click */
                      var nErr = errs.length;
                      try { exercise(it, counters); } catch (e) { errs.push({ scene: cur, msg: 'click handler threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) + ' on <' + it.el.tagName + ' ' + (it.el.getAttribute('class') || '') + '>' }); }
                      return sleep(12).then(function () {
                        if (errs.length > nErr) { errs[errs.length - 1].msg += '  [after clicking <' + it.el.tagName + ' ' + (it.el.getAttribute('class') || '') + '> in pass ' + pass + ']'; }
                      });
                    });
                  });
                  return chain2;
                });
              });
              return q.then(function () {
                /* teardown while the clicks' animations are still running: nothing may throw on the detached DOM */
                var list = collect(layer).slice(0, 40);
                list.forEach(function (it) { try { exercise(it, counters); } catch (e) { /* reported by the window error hook */ } });
                return null;
              }).then(function () {
                var ne = errs.length;
                s.ctx.destroy(); if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
                return sleep(80).then(function () {
                  if (errs.length > ne) errs[ne].msg += '  [thrown after the scene was torn down while click animations were running]';
                  /* a second build to keep the checks below on a live scene */
                  return E._build(id, k + 1);
                });
              }).then(function (s2) {
                s = s2; layer = s.ctx.layer; wrap = s.wrap;
                return sleep(40);
              }).then(function () {
                if (calls.length) errs.push({ scene: cur, msg: 'a scene click called Engine.go(' + calls.map(function (c) { return c.id; }).join(',') + '), expected no navigation' });
                if (!hasContent(layer)) errs.push({ scene: cur, msg: 'scene layer is empty after clicking' });
                if (items.length && layer.getElementsByTagName('*').length === 0) errs.push({ scene: cur, msg: 'all elements vanished after clicks' });
                /* ---- hotspots: separate check ---- */
                var hs = Array.prototype.slice.call(layer.querySelectorAll('.hotspot[data-target]'));
                hs.forEach(function (h) {
                  var target = h.getAttribute('data-target');
                  reach[target] = 1;
                  [['click', function () { fire(h, 'click'); }], ['Enter', function () { h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }]].forEach(function (how) {
                    calls.length = 0;
                    var ne = errs.length;
                    try { how[1](); } catch (e) { errs.push({ scene: cur, msg: 'hotspot ' + how[0] + ' threw: ' + e }); }
                    var c = calls.slice();
                    if (c.length !== 1) errs.push({ scene: cur, msg: 'hotspot -> ' + target + ' (' + how[0] + '): Engine.go called ' + c.length + ' time(s), expected 1' });
                    else if (c[0].id !== target) errs.push({ scene: cur, msg: 'hotspot ' + how[0] + ' went to "' + c[0].id + '" but data-target is "' + target + '"' });
                    else if (!c[0].opts || c[0].opts.transition !== 'zoomIn') errs.push({ scene: cur, msg: 'hotspot -> ' + target + ' is not a zoomIn transition' });
                    rec.hotspots++;
                  });
                  var tm = E.meta(target);
                  if (!tm) errs.push({ scene: cur, msg: 'hotspot to unknown chamber "' + target + '"' });
                  else if (tm.parent !== id) soft.push('hotspot to "' + target + '" which is not a child of "' + id + '" (contract: only your own children)');
                });
                E.go = realGo;
                s.ctx.destroy(); if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
                return sleep(30);
              });
            }).catch(function (e) { E.go = realGo; errs.push({ scene: cur, msg: 'FAILED: ' + (e && e.message) }); });
          });
        });
        /* leave a scene while its animation is running (what Back / Zoom / a tour do in the middle of a step) */
        rec.teardowns = 0;
        steps.forEach(function (st, k) {
          p = p.then(function () {
            cur = id + '#' + (k + 1) + ' teardown';
            var bs = E.beatsOf(st), ne = errs.length;
            return withTimeout(E._build(id, k), 15000, cur + ' build').then(function (s) {
              E.cur = s;
              var bt = autoBt(bs.length, st._gated);
              s.ctx._bt = bt; s.ctx.instant = false; s.ctx.speed = 6;
              var running = Promise.resolve().then(function () { return st.run ? st.run(s.ctx) : null; }).catch(function (e) { errs.push({ scene: cur, msg: 'run threw: ' + (e && e.message) }); });
              var ms = [90, 260, 700][k % 3];
              return sleep(ms).then(function () {
                s.ctx.destroy(); if (s.wrap.parentNode) s.wrap.parentNode.removeChild(s.wrap); E.cur = null;
                return sleep(90);
              }).then(function () {
                rec.teardowns++;
                if (errs.length > ne) errs[ne].msg += '  [thrown when the chamber was left ' + ms + ' ms into step ' + (k + 1) + ']';
              });
            }).catch(function (e) { errs.push({ scene: cur, msg: 'FAILED: ' + (e && e.message) }); });
          });
        });
        return p.then(function () {
          E.go = realGo;
          E.children(id).forEach(function (c) { if (!reach[c.id]) notes.push('child chamber "' + c.id + '" has no hotspot in any step (contract: every child must be reachable)'); });
          rec.interactions = counters.clicks;
          rec.errors = errs.slice(before).map(function (x) { return x.scene + ': ' + x.msg; }).concat(notes.filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (m) { return id + ': ' + m; }));
          rec.notes = soft.filter(function (v, i, a) { return a.indexOf(v) === i; });
          rec.status = rec.errors.length ? 'ERROR' : 'ok';
          report.push(rec);
        });
      });
    });
    chain.then(function () { EventTarget.prototype.addEventListener = origAdd; finish(report); });
  }

  /* ---------------------------------------------------------------- poster picker diagnostics */
  function posters() {
    var E = prep();
    var only = param('posters');
    var ids = E.order.map(function (m) { return m.id; }).filter(function (id) { return E.scenes[id] && (!only || only.split(',').indexOf(id) >= 0); });
    var out = [], chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        cur = 'poster:' + id;
        return E.makePoster(id).then(function () {
          var inf = E._posterInfo[id];
          if (!inf) { errs.push({ scene: cur, msg: 'no poster produced' }); return; }
          out.push({ id: id, pick: inf.pick, steps: inf.stats.map(function (s) { return s.step + ':' + Math.round(s.score) + '(t' + s.text + ' n' + s.nodes + ' s' + s.shapes + ' c' + s.cells + (s.off ? ' off' + s.off : '') + (s.faded ? ' dim' + s.faded : '') + (s.canvas ? ' CANVAS' : '') + ')'; }) });
        });
      });
    });
    chain.then(function () { finish([{ id: 'posters', status: errs.length ? 'ERROR' : 'ok', errors: errs.map(function (x) { return x.scene + ': ' + x.msg; }), summary: out }]); });
  }

  /* ---------------------------------------------------------------- left-panel stress test */
  function cards() {
    var E = prep();
    noAnim();
    E.setMode('step');
    var UI = E._ui;
    var $ = function (s) { return document.querySelector(s); };
    var hidden = 0, tall = 0;
    var rows = [], total = 0, cardScroll = 0, narrScroll = 0, histOpen = 0, overlaps = 0, moreTall = 0, maxCard = 0, maxNarr = 0;
    var chain = Promise.resolve().then(function () { E.go('overview', { step: 0, transition: 'none' }); return sleep(800); });
    E.order.forEach(function (m) {
      chain = chain.then(function () {
        cur = 'cards:' + m.id;
        var impl = E.impl(m.id), steps = impl.steps || [];
        steps.forEach(function (st, k) {
          var bs = E.beatsOf(st);
          var fake = { id: m.id, meta: m, impl: impl, step: k, beatIdx: -1, bt: null };
          UI.renderStepStart(fake, st, bs);
          for (var j = 0; j < bs.length; j++) {
            UI.showBeat(fake, bs, j, false);
            UI.setNarration(bs[j].say);
            total++;
            var host = $('#cards-host'), nt = $('#narr-text'), hr = host.getBoundingClientRect(), nr = $('#narr').getBoundingClientRect();
            var card = $('#card-new .card:last-child');
            var issue = [];
            if (card) {
              var cr = card.getBoundingClientRect();
              maxCard = Math.max(maxCard, cr.height);
              if (cr.bottom > hr.bottom + 1 || cr.top < hr.top - 1) { cardScroll++; issue.push('card needs scroll (' + Math.round(cr.height) + ' > ' + Math.round(hr.height) + ')'); }
              /* with "Go deeper" open */
              var mb = card.querySelector('.more-btn');
              if (mb) { card.classList.add('open'); var cr2 = card.getBoundingClientRect(); if (cr2.height > hr.height - 6) { moreTall++; } card.classList.remove('open'); }
            }
            if (nt.scrollHeight > nt.clientHeight + 2) {
              narrScroll++; maxNarr = Math.max(maxNarr, nt.scrollHeight);
              /* as the last sentence is spoken the box must scroll so that it is completely visible */
              var sp = nt.querySelectorAll('span'), N0 = window.AtlasNarrator;
              if (N0.onSentence && sp.length) {
                N0.onSentence(sp.length - 1, null);
                var sr = sp[sp.length - 1].getBoundingClientRect(), br = nt.getBoundingClientRect();
                if (E._narrCreep) {
                  /* the sentence is taller than the box: it is scrolled while spoken; its end must be reachable */
                  tall++;
                  var endTop = sr.bottom - br.top + nt.scrollTop;        /* bottom of the sentence in content coordinates */
                  if (E._narrCreep.to + nt.clientHeight < endTop - 2) { hidden++; issue.push('creep does not reach the end of a long sentence'); }
                } else if (sr.bottom > br.bottom + 2) { hidden++; issue.push('last narration sentence is cut off (bottom ' + Math.round(sr.bottom - br.bottom) + 'px below the box; scrollTop=' + nt.scrollTop + ' sh=' + nt.scrollHeight + ' ch=' + nt.clientHeight + ' spanTop=' + sp[sp.length - 1].offsetTop + ' ntTop=' + nt.offsetTop + ' op=' + (sp[sp.length - 1].offsetParent && sp[sp.length - 1].offsetParent.id) + '/' + (nt.offsetParent && nt.offsetParent.id) + ')'); }
              }
            }
            if ($('#card-hist').open) histOpen++;
            var ns = $('#narr').getBoundingClientRect();
            if (ns.bottom > hr.top + 1) { overlaps++; issue.push('narration box overlaps the cards'); }
            if (issue.length && rows.length < 400) rows.push({ id: m.id, step: k + 1, beat: j + 1, issue: issue.join('; ') });
          }
        });
      });
    });
    chain.then(function () {
      var host = $('#cards-host'), nr = $('#narr');
      var worst = rows.slice(0, 12);
      finish([{ id: 'cards', status: errs.length ? 'ERROR' : 'ok', errors: errs.map(function (x) { return x.scene + ': ' + x.msg; }),
        summary: { window: [innerWidth, innerHeight], beats: total, cardsHostHeight: Math.round(host.clientHeight), narrHeight: Math.round(nr.getBoundingClientRect().height),
          cardNeedsScroll: cardScroll, cardWithMoreTooTall: moreTall, narrationScrolls: narrScroll, sentencesTallerThanTheBox: tall, lastSentenceCutOff: hidden, maxNarrationContent: Math.round(maxNarr), maxCardHeight: Math.round(maxCard), historyOpen: histOpen, overlaps: overlaps, examples: worst } }]);
    });
  }

  /* ---------------------------------------------------------------- screenshots */
  function shot(spec) {
    var E = prep();
    var parts = spec.split(':');
    var size = param('size');
    E.setMode('step');
    if (has('pending')) E._forceAutoStart = false;     /* show the wait-for-Play state of a freshly opened topic */
    window.AtlasNarrator.rate = 40;
    E.go(parts[0], { step: Math.max(0, parseInt(parts[1] || '1', 10) - 1), beat: Math.max(0, parseInt(parts[2] || '1', 10) - 1), transition: 'none' });
    /* headless capture freezes CSS animations at their first frame (cards and blocks would be invisible): jump every
     * animation / transition to its end state so the picture shows what a viewer sees a moment later. &anim keeps them. */
    if (!has('anim')) {
      var st0 = document.createElement('style');
      st0.textContent = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }';
      document.head.appendChild(st0);
    }
    var lf = param('lf');        /* &lf=<css filter>: try another light-theme stage filter (screenshots only) */
    if (lf) { var stl = document.createElement('style'); stl.textContent = ':root[data-theme="light"] #stage-fx { filter: ' + lf + ' !important; }'; document.head.appendChild(stl); }
    if (has('dbgnarr')) setTimeout(function () {
      var nt = document.getElementById('narr-text'), d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99;background:#c00;color:#fff;font:12px monospace;padding:4px 8px';
      d.textContent = 'narr-text scrollTop=' + nt.scrollTop + ' scrollHeight=' + nt.scrollHeight + ' clientHeight=' + nt.clientHeight + ' narrH=' + document.getElementById('narr').clientHeight + ' overflow=' + getComputedStyle(nt).overflowY + ' sb=' + getComputedStyle(nt).scrollBehavior;
      document.body.appendChild(d);
    }, 25000);
    var op = param('open');      /* &open=progress|home|map|zoom|deep|settings|more|hist|focus[,..]: show panels in the screenshot */
    if (has('dbgstyle')) setTimeout(function () {
      var c = document.querySelector('.mchip'), cs = c && getComputedStyle(c), mt = c && c.querySelector('.mt'), ms = mt && getComputedStyle(mt);
      var pre = document.createElement('pre'); pre.id = 'dbg';
      var r = c && c.getBoundingClientRect(), hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      var mp = document.querySelector('#map'), mcs = getComputedStyle(mp);
      var pp = document.querySelector('.mcard p'), pcs = pp && getComputedStyle(pp);
      pre.textContent = 'DBG ' + JSON.stringify(c ? { vis: cs.visibility, mapVis: mcs.visibility, mapOp: mcs.opacity, mapCls: mp.className, pVis: pcs.visibility, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], hit: hit && (hit.tagName + '.' + hit.className), mtColor: ms.color, mtOverflow: ms.overflow, mtTF: ms.transform } : 'no chip') + ' DBG';
      document.body.appendChild(pre);
    }, 20000);
    if (op) setTimeout(function () {
      op.split(',').forEach(function (o) {
        if (o === 'progress') E.openProgress();
        else if (o === 'home') { var it0 = document.getElementById('intro'); it0.style.display = ''; E.home(); }
        else if (o === 'map') E.openMap();
        else if (o === 'zoom') document.getElementById('btn-zoom').click();
        else if (o === 'deep') E.setDeep(true);
        else if (o === 'settings') document.getElementById('btn-settings').click();
        else if (o === 'focus') E.setRails(false);
        else if (o === 'hist') { var hd = document.getElementById('card-hist'); if (hd) hd.open = true; }
        else if (o === 'more') { var mb = document.querySelector('#card-new .card:last-child .more-btn'); if (mb) mb.click(); }
        else if (o === 'refs') { /* references page has its own screenshot path */ }
      });
    }, 1500);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var m = /[?&]shot=([\w-]+(?::\d+){0,2})/.exec(QS);
    setTimeout(function () {
      if (m) shot(m[1]);
      else if (has('nav')) nav();
      else if (has('clicks')) clicks();
      else if (has('a11y')) a11y();
      else if (has('chrome')) chrome();
      else if (has('cards')) cards();
      else if (has('posters')) posters();
      else if (has('layout')) layout();
      else run();
    }, 50);
  });
})();
