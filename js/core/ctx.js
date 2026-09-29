/* Scene context: SVG drawing toolkit + animation runtime.
 * One SceneCtx exists per scene build. Everything it creates (elements, tweens,
 * loops, timers, canvas) is torn down by destroy(), so scenes cannot leak. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 1600, H = 900;

  var C = {
    cyan: '#22e4ff', blue: '#4d8dff', magenta: '#ff3fd2', violet: '#9b7bff',
    amber: '#ffbf3a', lime: '#8dff5a', orange: '#ff8a3d', red: '#ff4d6d',
    teal: '#2bf5c4', pink: '#ff7eb6', white: '#e8f1ff', text: '#cfe3ff',
    dim: '#7b8cab', faint: '#3a4763', line: '#2a3754', panel: '#0b1324',
    panel2: '#101b33', bg: '#05080f'
  };

  var Ease = {
    linear: function (t) { return t; },
    in: function (t) { return t * t * t; },
    out: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOut: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    back: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    elastic: function (t) {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
    }
  };

  /* 24x24 stroke icons */
  var ICONS = {
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
    phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    cloud: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z',
    server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
    db: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    gpu: 'M3 7h18v10H3zM7 17v3M11 17v3M15 17v3M7 10h4v4H7zM14 10h3M14 13h3',
    chip: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
    brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
    film: 'M3 4h18v16H3zM7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4',
    image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01',
    mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    wave: 'M2 12h2l2-6 3 12 3-15 3 18 3-12 2 3h2',
    gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    doc: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
    tool: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
    agent: 'M12 2v3M8 5h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM9 10h.01M15 10h.01M9 14h6M8 17l-2 4M16 17l2 4',
    loop: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
    queue: 'M3 6h18M3 12h18M3 18h18M7 3v6M12 9v6M17 15v6',
    net: 'M12 5a2 2 0 1 0 0-.01zM5 19a2 2 0 1 0 0-.01zM19 19a2 2 0 1 0 0-.01zM12 7v4M12 11l-6 6M12 11l6 6',
    chart: 'M3 21h18M6 17V10M11 17V5M16 17v-8M21 17v-4',
    check: 'M4 12l5 5L20 6',
    warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    spark: 'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3',
    music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5'
  };

  function colorOf(c) { return (c && C[c]) ? C[c] : (c || C.cyan); }

  function hexA(hex, a) {
    hex = colorOf(hex);
    if (/^rgb\(/i.test(hex)) return hex.replace(/^rgb\(/i, 'rgba(').replace(/\)\s*$/, ',' + a + ')');
    if (hex.charAt(0) !== '#') return hex;
    var h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* parse '#rgb' | '#rrggbb' | 'rgb(r,g,b)' | 'rgba(r,g,b,a)' | palette name → [r,g,b] */
  function toRgb(c) {
    c = String(colorOf(c)).trim();
    if (c.charAt(0) === '#') {
      var h = c.slice(1);
      if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
    if (m) return [+m[1], +m[2], +m[3]];
    console.warn('ctx.mix: unsupported color', c);
    return [0, 0, 0];
  }

  function mix(c1, c2, t) {
    var rgb = toRgb;
    var a = rgb(c1), b = rgb(c2);
    var r = a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); });
    return 'rgb(' + r[0] + ',' + r[1] + ',' + r[2] + ')';
  }

  /* colormaps for matrices / heatmaps: v in [0,1] (diverge: [-1,1]) */
  var CMAPS = {
    cyan: function (v) { return mix('#0a1428', C.cyan, clamp(v, 0, 1)); },
    magenta: function (v) { return mix('#140a24', C.magenta, clamp(v, 0, 1)); },
    amber: function (v) { return mix('#1a1206', C.amber, clamp(v, 0, 1)); },
    lime: function (v) { return mix('#0b1a0a', C.lime, clamp(v, 0, 1)); },
    violet: function (v) { return mix('#0f0b24', C.violet, clamp(v, 0, 1)); },
    red: function (v) { return mix('#1d0a10', C.red, clamp(v, 0, 1)); },
    heat: function (v) {
      v = clamp(v, 0, 1);
      return v < 0.5 ? mix('#0a1030', C.violet, v * 2) : mix(C.violet, C.amber, (v - 0.5) * 2);
    },
    diverge: function (v) {
      v = clamp(v, -1, 1);
      return v < 0 ? mix('#0b1222', C.blue, -v) : mix('#0b1222', C.orange, v);
    },
    gray: function (v) { var k = Math.round(clamp(v, 0, 1) * 235 + 10); return 'rgb(' + k + ',' + k + ',' + k + ')'; }
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function rng(seed) {
    var s = (seed | 0) || 1234567;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------------------------------------------- */
  function SceneCtx(opts) {
    this.engine = opts.engine;
    this.scene = opts.scene;
    this.layer = opts.layer;       /* <g> root for this scene */
    this.cam = opts.cam;           /* <g> camera wrapper (parent of layer) */
    this.stageEl = opts.stageEl;   /* HTML container for canvas overlay */
    this.instant = !!opts.instant;
    this.speed = opts.speed || 1;
    this.state = {};
    this.dead = false;
    this.W = W; this.H = H; this.C = C; this.Ease = Ease;
    this._tweens = [];
    this._loops = [];
    this._timers = [];
    this._canvas = null;
    this._focused = null;
    this._camState = { x: W / 2, y: H / 2, s: 1 };
  }

  var P = SceneCtx.prototype;

  /* ---------- lifecycle ---------- */
  /* keepCanvas: freeze but leave the canvas overlay visible (outgoing scene during a transition);
   * a second destroy() call removes it. */
  P.destroy = function (keepCanvas) {
    this.dead = true;
    this._tweens.forEach(function (tw) { tw.done = true; tw.resolve(); });
    this._tweens = [];
    this._loops = [];
    this._timers.forEach(function (id) { clearTimeout(id); });
    this._timers = [];
    if (keepCanvas) return;
    if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
    this._canvas = null;
  };

  P._tick = function (now, dt) {
    if (this.dead) return false;
    var active = false;
    var tws = this._tweens;
    for (var i = 0; i < tws.length; i++) {
      var tw = tws[i];
      if (tw.done) continue;
      if (tw.start === null) tw.start = now + tw.delay;
      if (now < tw.start) { active = true; continue; }
      var p = tw.dur <= 0 ? 1 : clamp((now - tw.start) / tw.dur, 0, 1);
      try { tw.fn(tw.ease(p), p); } catch (e) { console.error(e); tw.done = true; }
      if (p >= 1) { tw.done = true; tw.resolve(); } else active = true;
    }
    this._tweens = tws.filter(function (t) { return !t.done; });
    var t = now / 1000;
    var loops = this._loops;
    for (var j = 0; j < loops.length; j++) {
      if (loops[j].stopped) continue;
      active = true;
      try { loops[j].fn(t, dt / 1000); } catch (e2) { console.error(e2); loops[j].stopped = true; }
    }
    this._loops = loops.filter(function (l) { return !l.stopped; });
    return active || this._tweens.length > 0;
  };

  /* ---------- time ---------- */
  P.tween = function (dur, fn, ease, delay) {
    var self = this;
    if (typeof ease === 'string') ease = Ease[ease] || Ease.inOut;
    ease = ease || Ease.inOut;
    if (this.dead) return Promise.resolve();
    if (this.instant || !dur || dur <= 0) {
      try { fn(1, 1); } catch (e) { console.error(e); }
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      self._tweens.push({ dur: dur / self.speed, delay: (delay || 0) / self.speed, fn: fn, ease: ease, start: null, resolve: resolve, done: false });
      self.engine._wake();
    });
  };

  P.wait = function (ms) {
    var self = this;
    if (this.instant || this.dead || !ms) return Promise.resolve();
    return new Promise(function (resolve) {
      self._timers.push(setTimeout(resolve, ms / self.speed));
    });
  };

  P.after = function (ms, fn) {
    var self = this;
    if (this.instant) { fn(); return; }
    this._timers.push(setTimeout(function () { if (!self.dead) fn(); }, ms / self.speed));
  };

  /* continuous animation; fn(tSeconds, dtSeconds). Runs in instant mode too. */
  P.loop = function (fn) {
    var h = { fn: fn, stopped: false, stop: function () { h.stopped = true; } };
    if (this.dead) { h.stopped = true; return h; }
    this._loops.push(h);
    this.engine._wake();
    return h;
  };

  P.rng = rng;
  P.clamp = clamp;
  P.lerp = function (a, b, t) { return a + (b - a) * t; };
  P.alpha = hexA;
  P.mix = mix;
  P.cmap = function (name, v) { return (CMAPS[name] || CMAPS.cyan)(v); };
  P.color = colorOf;

  /* ---------- raw SVG ---------- */
  P.el = function (tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    (parent || this.layer).appendChild(e);
    return e;
  };

  P.group = function (opts, parent) {
    opts = opts || {};
    var g = this.el('g', { 'class': opts.cls, opacity: opts.opacity }, parent || opts.parent);
    if (opts.x || opts.y) this.place(g, opts.x || 0, opts.y || 0);
    return g;
  };

  /* absolute transform setter (no animation) */
  P.place = function (el, x, y, s, r) {
    el._tf = { x: x || 0, y: y || 0, s: s === undefined ? 1 : s, r: r || 0 };
    el.setAttribute('transform', 'translate(' + el._tf.x + ',' + el._tf.y + ') rotate(' + el._tf.r + ') scale(' + el._tf.s + ')');
    return el;
  };

  P._style = function (e, o) {
    if (o.opacity !== undefined) e.setAttribute('opacity', o.opacity);
    if (o.glow) e.setAttribute('filter', this._glowFor(e, o.glow === 'strong'));
    if (o.cls) e.setAttribute('class', o.cls);
    return e;
  };

  /* Glow filter reference. The shared filters use objectBoundingBox regions, which collapse to
   * nothing for perfectly horizontal/vertical lines (zero-width bbox) and make them vanish.
   * For such 1-D shapes a user-space filter with a padded region is created (cached per region). */
  P._glowFor = function (e, strong) {
    var def = strong ? 'url(#fx-glow-strong)' : 'url(#fx-glow)';
    var tag = e.tagName;
    if (tag !== 'line' && tag !== 'path' && tag !== 'polyline') return def;
    var bb = safeBBox(e);
    var thin = (bb.w < 1) !== (bb.h < 1);   /* exactly one degenerate axis */
    if (!thin) return def;
    var pad = strong ? 28 : 14;
    var x = Math.floor(bb.x - pad), y = Math.floor(bb.y - pad), w = Math.ceil(bb.w + 2 * pad), h = Math.ceil(bb.h + 2 * pad);
    var id = 'fx-glow-u' + (strong ? 's' : '') + '-' + [x, y, w, h].join('_').replace(/-/g, 'm');
    if (!document.getElementById(id)) {
      var f = document.createElementNS(NS, 'filter');
      f.setAttribute('id', id); f.setAttribute('filterUnits', 'userSpaceOnUse');
      f.setAttribute('x', x); f.setAttribute('y', y); f.setAttribute('width', w); f.setAttribute('height', h);
      f.innerHTML = strong
        ? '<feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'
        : '<feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>';
      this.engine.defs.appendChild(f);
    }
    return 'url(#' + id + ')';
  };

  P.rect = function (x, y, w, h, o) {
    o = o || {};
    var e = this.el('rect', {
      x: x, y: y, width: Math.max(0, w), height: Math.max(0, h), rx: o.rx === undefined ? 6 : o.rx,
      fill: o.fill === undefined ? 'none' : colorOf(o.fill), stroke: o.stroke ? colorOf(o.stroke) : 'none',
      'stroke-width': o.sw || 1.5, 'stroke-dasharray': o.dash
    }, o.parent);
    return this._style(e, o);
  };

  P.circle = function (cx, cy, r, o) {
    o = o || {};
    var e = this.el('circle', {
      cx: cx, cy: cy, r: r, fill: o.fill === undefined ? 'none' : colorOf(o.fill),
      stroke: o.stroke ? colorOf(o.stroke) : 'none', 'stroke-width': o.sw || 1.5, 'stroke-dasharray': o.dash
    }, o.parent);
    return this._style(e, o);
  };

  P.line = function (x1, y1, x2, y2, o) {
    o = o || {};
    var e = this.el('line', {
      x1: x1, y1: y1, x2: x2, y2: y2, stroke: colorOf(o.color || o.stroke || C.line),
      'stroke-width': o.sw || 1.5, 'stroke-dasharray': o.dash, 'stroke-linecap': 'round',
      'marker-end': o.arrow ? this._arrowHead(o.color || o.stroke || C.line) : null
    }, o.parent);
    return this._style(e, o);
  };

  P.path = function (d, o) {
    o = o || {};
    var e = this.el('path', {
      d: d, fill: o.fill ? colorOf(o.fill) : 'none', stroke: o.stroke || o.color ? colorOf(o.stroke || o.color) : 'none',
      'stroke-width': o.sw || 1.5, 'stroke-dasharray': o.dash, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'marker-end': o.arrow ? this._arrowHead(o.stroke || o.color) : null
    }, o.parent);
    return this._style(e, o);
  };

  P.poly = function (points, o) {
    o = o || {};
    var pts = points.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
    var e = this.el(o.closed === false ? 'polyline' : 'polygon', {
      points: pts, fill: o.fill ? colorOf(o.fill) : 'none', stroke: o.stroke ? colorOf(o.stroke) : 'none',
      'stroke-width': o.sw || 1.5, 'stroke-linejoin': 'round'
    }, o.parent);
    return this._style(e, o);
  };

  P._arrowHead = function (color) {
    var col = colorOf(color || C.line);
    var id = 'ah-' + col.replace(/[^a-z0-9]/gi, '');
    if (!document.getElementById(id)) {
      var defs = this.engine.defs;
      var m = document.createElementNS(NS, 'marker');
      m.setAttribute('id', id); m.setAttribute('viewBox', '0 0 10 10'); m.setAttribute('refX', '8'); m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '7'); m.setAttribute('markerHeight', '7'); m.setAttribute('orient', 'auto-start-reverse');
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M0,0 L10,5 L0,10 z'); p.setAttribute('fill', col);
      m.appendChild(p); defs.appendChild(m);
    }
    return 'url(#' + id + ')';
  };

  /* ---------- text ---------- */
  P.text = function (x, y, str, o) {
    o = o || {};
    var fam = { sans: 'f-sans', mono: 'f-mono', display: 'f-display' }[o.font || 'sans'];
    var e = this.el('text', {
      x: x, y: y, fill: colorOf(o.color || C.text), 'font-size': o.size || 16,
      'text-anchor': o.anchor || 'start', 'font-weight': o.weight || 400, 'class': fam,
      'dominant-baseline': o.baseline || 'middle', 'letter-spacing': o.spacing
    }, o.parent);
    e.textContent = str === undefined || str === null ? '' : String(str);
    if (o.rotate) e.setAttribute('transform', 'rotate(' + o.rotate + ',' + x + ',' + y + ')');
    if (o.pre) preserveSpace(e);
    return this._style(e, Object.assign({}, o, { cls: fam + (o.cls ? ' ' + o.cls : '') }));
  };

  /* keep runs of spaces / indentation in an SVG <text> (default SVG collapses them) */
  function preserveSpace(e) {
    e.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    e.style.whiteSpace = 'pre';
    return e;
  }

  /* multi-line text; lines = array of strings; returns <g> */
  P.para = function (x, y, lines, o) {
    o = o || {};
    var g = this.group({ parent: o.parent });
    var lh = o.lh || (o.size || 16) * 1.4;
    for (var i = 0; i < lines.length; i++) {
      this.text(x, y + i * lh, lines[i], Object.assign({}, o, { parent: g, opacity: undefined, glow: undefined }));
    }
    if (o.opacity !== undefined) g.setAttribute('opacity', o.opacity);
    return g;
  };

  /* small chip with background: returns <g> with .w */
  P.label = function (x, y, str, o) {
    o = o || {};
    var col = colorOf(o.color || C.cyan);
    var size = o.size || 13;
    var w = o.w || Math.max(24, String(str).length * size * 0.62 + 18);
    var h = size + 12;
    var anchor = o.anchor || 'middle';
    var x0 = anchor === 'middle' ? x - w / 2 : (anchor === 'end' ? x - w : x);
    var g = this.group({ parent: o.parent });
    var bgFill = o.bg ? colorOf(o.bg) : hexA(col, o.bgAlpha === undefined ? 0.14 : o.bgAlpha);
    var rectEl = this.rect(x0, y - h / 2, w, h, { rx: h / 2, fill: bgFill, stroke: hexA(col, 0.7), sw: 1, parent: g });
    var textEl = this.text(x0 + w / 2, y + 0.5, str, { size: size, color: o.textColor || col, anchor: 'middle', font: o.font || 'mono', weight: o.weight || 500, parent: g });
    g.w = w; g.h = h;
    g.rectEl = rectEl; g.textEl = textEl;
    /* change the text and (unless a fixed w was given) resize the pill around its anchor */
    g.setText = function (s) {
      textEl.textContent = String(s);
      if (o.w) return g;
      var nw = Math.max(24, String(s).length * size * 0.62 + 18);
      var nx = anchor === 'middle' ? x - nw / 2 : (anchor === 'end' ? x - nw : x);
      rectEl.setAttribute('x', nx); rectEl.setAttribute('width', nw);
      textEl.setAttribute('x', nx + nw / 2);
      g.w = nw;
      return g;
    };
    if (o.opacity !== undefined) g.setAttribute('opacity', o.opacity);
    return g;
  };

  P.icon = function (name, x, y, size, color, o) {
    o = o || {};
    size = size || 24;
    var g = this.group({ parent: o.parent });
    var p = this.el('path', {
      d: ICONS[name] || ICONS.spark, fill: 'none', stroke: colorOf(color || C.cyan), 'stroke-width': o.sw || 1.8,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }, g);
    var s = size / 24;
    g.setAttribute('transform', 'translate(' + (x - size / 2) + ',' + (y - size / 2) + ') scale(' + s + ')');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    return g;
  };

  /* ---------- high-level node ----------
   * opts: x,y (CENTER), w,h, title, sub, icon, color, kind ('box'|'pill'|'cyl'|'hex'|'chip'|'ghost'),
   *       parent, titleSize, subSize, fill, glow
   * returns <g> with .box = {x,y,w,h,cx,cy,l,r,t,b} and .color */
  P.node = function (o) {
    var col = colorOf(o.color || C.cyan);
    var w = o.w || 200, h = o.h || 64;
    var g = this.group({ parent: o.parent, cls: 'node' });
    var x0 = o.x - w / 2, y0 = o.y - h / 2;
    var kind = o.kind || 'box';
    var fill = o.fill || (kind === 'ghost' ? 'none' : 'url(#fx-panel-grad)');
    var body;
    if (kind === 'cyl') {
      var ry = Math.min(14, h * 0.18);
      body = this.path('M' + x0 + ',' + (y0 + ry) + ' A' + w / 2 + ',' + ry + ' 0 0 1 ' + (x0 + w) + ',' + (y0 + ry) +
        ' V' + (y0 + h - ry) + ' A' + w / 2 + ',' + ry + ' 0 0 1 ' + x0 + ',' + (y0 + h - ry) + ' Z', { fill: fill, stroke: col, sw: 1.6, parent: g });
      this.path('M' + x0 + ',' + (y0 + ry) + ' A' + w / 2 + ',' + ry + ' 0 0 0 ' + (x0 + w) + ',' + (y0 + ry), { stroke: col, sw: 1.2, parent: g, opacity: 0.8 });
    } else if (kind === 'hex') {
      var k = Math.min(22, h / 2);
      body = this.poly([[x0 + k, y0], [x0 + w - k, y0], [x0 + w, y0 + h / 2], [x0 + w - k, y0 + h], [x0 + k, y0 + h], [x0, y0 + h / 2]], { fill: fill, stroke: col, sw: 1.6, parent: g });
    } else {
      var rx = kind === 'pill' ? h / 2 : (kind === 'chip' ? 4 : 10);
      body = this.rect(x0, y0, w, h, { rx: rx, fill: fill, stroke: col, sw: kind === 'ghost' ? 1.2 : 1.6, dash: kind === 'ghost' ? '5 5' : null, parent: g });
      if (kind === 'chip') {
        for (var i = 1; i < 5; i++) {
          var px = x0 + (w * i) / 5;
          this.line(px, y0 - 6, px, y0, { color: col, sw: 1.2, parent: g, opacity: 0.7 });
          this.line(px, y0 + h, px, y0 + h + 6, { color: col, sw: 1.2, parent: g, opacity: 0.7 });
        }
      }
    }
    if (o.glow !== false) body.setAttribute('filter', 'url(#fx-glow)');
    /* corner ticks (tech accent) */
    if (kind === 'box') {
      this.path('M' + (x0 + 2) + ',' + (y0 + 12) + ' V' + (y0 + 2) + ' H' + (x0 + 12), { stroke: col, sw: 2.2, parent: g });
      this.path('M' + (x0 + w - 2) + ',' + (y0 + h - 12) + ' V' + (y0 + h - 2) + ' H' + (x0 + w - 12), { stroke: col, sw: 2.2, parent: g });
    }
    var tx = o.x, anchor = 'middle';
    if (o.icon) {
      var isz = Math.min(28, h * 0.5);
      if (o.title) {
        this.icon(o.icon, x0 + 14 + isz / 2, o.y, isz, col, { parent: g });
        tx = x0 + 22 + isz; anchor = 'start';
      } else {
        this.icon(o.icon, o.x, o.y, isz, col, { parent: g });
      }
    }
    var ts = o.titleSize || 16, ss = o.subSize || 12;
    if (o.title) {
      var ty = o.sub ? o.y - ss * 0.65 : o.y;
      g.titleEl = this.text(tx, ty, o.title, { size: ts, weight: 600, color: C.white, anchor: anchor, font: 'display', parent: g });
    }
    if (o.sub) {
      g.subEl = this.text(tx, o.y + ts * 0.7, o.sub, { size: ss, color: hexA(col, 0.9), anchor: anchor, font: 'mono', parent: g });
    }
    g.body = body;
    g.color = col;
    g.box = { x: x0, y: y0, w: w, h: h, cx: o.x, cy: o.y, l: x0, r: x0 + w, t: y0, b: y0 + h };
    if (o.opacity !== undefined) g.setAttribute('opacity', o.opacity);
    return g;
  };

  /* anchor point on a node's edge: side 'l','r','t','b','c' */
  P.anchor = function (n, side) {
    if (!n.box) return { x: n.x, y: n.y };
    var b = n.box;
    switch (side) {
      case 'l': return { x: b.l, y: b.cy };
      case 'r': return { x: b.r, y: b.cy };
      case 't': return { x: b.cx, y: b.t };
      case 'b': return { x: b.cx, y: b.b };
      default: return { x: b.cx, y: b.cy };
    }
  };

  function autoSides(a, b) {
    var ca = a.box ? { x: a.box.cx, y: a.box.cy } : a, cb = b.box ? { x: b.box.cx, y: b.box.cy } : b;
    var dx = cb.x - ca.x, dy = cb.y - ca.y;
    var aw = a.box ? a.box.w / 2 : 0, ah = a.box ? a.box.h / 2 : 0;
    if (Math.abs(dx) - aw > Math.abs(dy) - ah) return dx > 0 ? ['r', 'l'] : ['l', 'r'];
    return dy > 0 ? ['b', 't'] : ['t', 'b'];
  }

  /* link between nodes/points. opts: color, from, to, curve (0..1), dash, sw, arrow (default true),
   * label, flow (animated dashes), bend ({x,y} explicit control point), opacity.
   * returns <path> with .len, .pts(t) helper, .labelEl */
  P.link = function (a, b, o) {
    o = o || {};
    var sides = autoSides(a, b);
    var p1 = a.box ? this.anchor(a, o.from || sides[0]) : a;
    var p2 = b.box ? this.anchor(b, o.to || sides[1]) : b;
    var s1 = o.from || sides[0], s2 = o.to || sides[1];
    var d;
    if (o.bend) {
      d = 'M' + p1.x + ',' + p1.y + ' Q' + o.bend.x + ',' + o.bend.y + ' ' + p2.x + ',' + p2.y;
    } else if (o.curve === 0 || o.straight) {
      d = 'M' + p1.x + ',' + p1.y + ' L' + p2.x + ',' + p2.y;
    } else {
      var k = o.curve === undefined ? 0.5 : o.curve;
      var dist = Math.max(40, Math.hypot(p2.x - p1.x, p2.y - p1.y) * k);
      var c1 = ctrl(p1, s1, dist), c2 = ctrl(p2, s2, dist);
      d = 'M' + p1.x + ',' + p1.y + ' C' + c1.x + ',' + c1.y + ' ' + c2.x + ',' + c2.y + ' ' + p2.x + ',' + p2.y;
    }
    var col = colorOf(o.color || C.dim);
    var e = this.path(d, { stroke: col, sw: o.sw || 1.8, dash: o.dash || (o.flow ? '6 8' : null), arrow: o.arrow !== false, parent: o.parent, opacity: o.opacity });
    e.len = e.getTotalLength ? e.getTotalLength() : 0;
    if (o.flow) {
      var self = this, off = 0;
      e._flow = this.loop(function (t, dt) { off -= dt * 40 * (o.flowSpeed || 1); e.setAttribute('stroke-dashoffset', off); });
    }
    if (o.label) {
      var mid = e.getPointAtLength ? e.getPointAtLength(e.len / 2) : { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      e.labelEl = this.label(mid.x + (o.labelDx || 0), mid.y + (o.labelDy || -14), o.label, { color: col, size: 11, parent: o.parent });
    }
    return e;
  };

  function ctrl(p, side, d) {
    switch (side) {
      case 'l': return { x: p.x - d, y: p.y };
      case 'r': return { x: p.x + d, y: p.y };
      case 't': return { x: p.x, y: p.y - d };
      case 'b': return { x: p.x, y: p.y + d };
      default: return p;
    }
  }

  /* send one glowing packet along a path. opts: color, r, dur, label, ease. Promise resolves on arrival. */
  P.packet = function (pathEl, o) {
    o = o || {};
    var self = this;
    var len = pathEl.len || (pathEl.getTotalLength ? pathEl.getTotalLength() : 0);
    var col = colorOf(o.color || C.cyan);
    var g = this.group({ parent: o.parent || pathEl.parentNode });
    this.circle(0, 0, (o.r || 5) * 2.2, { fill: hexA(col, 0.18), parent: g });
    this.circle(0, 0, o.r || 5, { fill: col, parent: g, glow: true });
    if (o.label) this.text(0, -16, o.label, { size: 11, color: col, anchor: 'middle', font: 'mono', parent: g });
    if (this.instant) { g.parentNode.removeChild(g); return Promise.resolve(); }
    var rev = !!o.reverse;
    return this.tween(o.dur || 1200, function (t) {
      var p = pathEl.getPointAtLength(len * (rev ? 1 - t : t));
      g.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
    }, o.ease || 'inOut').then(function () {
      if (o.keep) return;
      if (g.parentNode) g.parentNode.removeChild(g);
    });
  };

  /* continuous stream of packets along a path; returns handle {stop()} */
  P.stream = function (pathEl, o) {
    o = o || {};
    var len = pathEl.len || pathEl.getTotalLength();
    var n = o.count || 3, period = (o.period || 2000) / 1000;
    var col = colorOf(o.color || C.cyan);
    var g = this.group({ parent: o.parent || pathEl.parentNode });
    var dots = [];
    for (var i = 0; i < n; i++) dots.push(this.circle(0, 0, o.r || 3.5, { fill: col, parent: g, glow: true }));
    var rev = !!o.reverse, speed = this.speed;
    var h = this.loop(function (t) {
      for (var i = 0; i < n; i++) {
        var f = ((t * speed / period) + i / n) % 1;
        var p = pathEl.getPointAtLength(len * (rev ? 1 - f : f));
        dots[i].setAttribute('cx', p.x); dots[i].setAttribute('cy', p.y);
        dots[i].setAttribute('opacity', Math.sin(f * Math.PI).toFixed(3));
      }
    });
    return { el: g, stop: function () { h.stop(); if (g.parentNode) g.parentNode.removeChild(g); } };
  };

  /* ---------- matrices / heatmaps ----------
   * opts: cell (size), gap, values (2D array or fn(r,c)), cmap, stroke, parent, rowLabels, colLabels
   * returns <g> with .cells[r][c], .set(fnOrArray), .cellCenter(r,c), .w, .h */
  P.matrix = function (x, y, rows, cols, o) {
    o = o || {};
    var self = this;
    var cell = o.cell || 18, gap = o.gap === undefined ? 2 : o.gap;
    var g = this.group({ parent: o.parent });
    var cells = [];
    var cm = o.cmap || 'cyan';
    function val(r, c) {
      if (typeof o.values === 'function') return o.values(r, c);
      if (o.values) return o.values[r][c];
      return 0.15;
    }
    for (var r = 0; r < rows; r++) {
      cells.push([]);
      for (var c = 0; c < cols; c++) {
        var v = val(r, c);
        cells[r].push(this.rect(x + c * (cell + gap), y + r * (cell + gap), cell, cell, {
          rx: Math.min(3, cell / 5), fill: typeof v === 'string' ? v : self.cmap(cm, v), stroke: o.stroke, sw: 0.6, parent: g
        }));
      }
    }
    g.cells = cells;
    g.w = cols * (cell + gap) - gap; g.h = rows * (cell + gap) - gap;
    g.box = { x: x, y: y, w: g.w, h: g.h, cx: x + g.w / 2, cy: y + g.h / 2, l: x, r: x + g.w, t: y, b: y + g.h };
    g.cellCenter = function (r, c) { return { x: x + c * (cell + gap) + cell / 2, y: y + r * (cell + gap) + cell / 2 }; };
    g.set = function (values, cmap) {
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var v = typeof values === 'function' ? values(r, c) : values[r][c];
        cells[r][c].setAttribute('fill', typeof v === 'string' ? v : self.cmap(cmap || cm, v));
      }
    };
    if (o.rowLabels) o.rowLabels.forEach(function (s, r) { self.text(x - 8, y + r * (cell + gap) + cell / 2, s, { size: o.labelSize || 11, anchor: 'end', font: 'mono', color: C.dim, parent: g }); });
    if (o.colLabels) o.colLabels.forEach(function (s, c) { self.text(x + c * (cell + gap) + cell / 2, y - 10, s, { size: o.labelSize || 11, anchor: 'middle', font: 'mono', color: C.dim, parent: g }); });
    return g;
  };

  /* vector as a column/row of cells: returns matrix group */
  P.vector = function (x, y, n, o) {
    o = o || {};
    return o.horizontal ? this.matrix(x, y, 1, n, o) : this.matrix(x, y, n, 1, Object.assign({}, o, {
      values: Array.isArray(o.values) && !Array.isArray(o.values[0]) ? o.values.map(function (v) { return [v]; }) : o.values
    }));
  };

  /* ---------- code / JSON panel ----------
   * opts: x,y (top-left), w, title, lines [strings], lang ('json'|'py'|'text'|'sh'), size, color, typing (bool)
   * returns <g> with .lineEls, .addLine(str) → Promise, .h */
  P.code = function (o) {
    var self = this;
    var col = colorOf(o.color || C.cyan);
    var size = o.size || 13, lh = size * 1.55;
    var lines = o.lines || [];
    var h = o.h || (46 + Math.max(1, (o.maxLines || lines.length)) * lh);
    var g = this.group({ parent: o.parent });
    this.rect(o.x, o.y, o.w, h, { rx: 10, fill: 'rgba(6,12,24,0.92)', stroke: hexA(col, 0.55), sw: 1.2, parent: g });
    this.rect(o.x, o.y, o.w, 28, { rx: 10, fill: hexA(col, 0.12), parent: g });
    [0, 1, 2].forEach(function (i) { self.circle(o.x + 16 + i * 14, o.y + 14, 4, { fill: [C.red, C.amber, C.lime][i], opacity: 0.8, parent: g }); });
    if (o.title) this.text(o.x + 64, o.y + 14.5, o.title, { size: 12, color: hexA(col, 0.95), font: 'mono', parent: g });
    g.lineEls = [];
    g.h = h;
    g.box = { x: o.x, y: o.y, w: o.w, h: h, cx: o.x + o.w / 2, cy: o.y + h / 2, l: o.x, r: o.x + o.w, t: o.y, b: o.y + h };
    var n = 0;
    g.addLine = function (str, instantLine) {
      var y = o.y + 46 + n * lh; n++;
      var t = self.text(o.x + 16, y, '', { size: size, font: 'mono', color: C.text, parent: g, baseline: 'middle', pre: true });
      g.lineEls.push(t);
      if (self.instant || instantLine || !o.typing) { highlight(t, str, o.lang); return Promise.resolve(); }
      var chars = str.length;
      return self.tween(Math.min(900, 18 * chars + 60), function (p) {
        t.textContent = str.slice(0, Math.round(chars * p));
      }, 'linear').then(function () { highlight(t, str, o.lang); });
    };
    g.typeAll = function () {
      var chain = Promise.resolve();
      lines.forEach(function (s) { chain = chain.then(function () { return g.addLine(s); }); });
      return chain;
    };
    if (!o.typing) lines.forEach(function (s) { g.addLine(s, true); });
    return g;
  };

  function highlight(t, str, lang) {
    while (t.firstChild) t.removeChild(t.firstChild);
    var re;
    if (lang === 'json') re = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(\b-?\d+(?:\.\d+)?(?:e-?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|([{}\[\],])/g;
    else if (lang === 'py' || lang === 'js' || lang === 'sh') re = /(#.*$|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|(\b(?:def|return|for|in|if|else|elif|while|await|async|import|from|class|const|let|function|yield|with|as|not|and|or|None|True|False|lambda)\b)|([{}\[\]().,:=+\-*\/@<>])/g;
    else { t.textContent = str; return; }
    var cols = lang === 'json' ? ['#8fd3ff', '#9dffb0', '#ffc46b', '#ff8fd8', '#6f7f9f'] : ['#5f6f8f', '#9dffb0', '#ffc46b', '#ff8fd8', '#7f8faf'];
    var last = 0, m;
    function span(s, c) { var ts = document.createElementNS(NS, 'tspan'); ts.textContent = s; if (c) ts.setAttribute('fill', c); t.appendChild(ts); }
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) span(str.slice(last, m.index));
      for (var i = 1; i <= 5; i++) if (m[i] !== undefined) { span(m[0], cols[i - 1]); break; }
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < str.length) span(str.slice(last));
  }

  /* ---------- charts ---------- */
  /* bars: x,y top-left, w,h, values [0..1] ; opts: color, labels, gap. returns g with .update(values) */
  P.bars = function (x, y, w, h, values, o) {
    o = o || {};
    var self = this, n = values.length, gap = o.gap === undefined ? 6 : o.gap;
    var bw = (w - gap * (n - 1)) / n;
    var g = this.group({ parent: o.parent });
    this.line(x, y + h, x + w, y + h, { color: C.faint, parent: g });
    var bars = values.map(function (v, i) {
      var col = Array.isArray(o.color) ? o.color[i] : (o.color || C.cyan);
      return self.rect(x + i * (bw + gap), y + h - h * v, bw, h * v, { rx: 3, fill: hexA(col, 0.75), stroke: col, sw: 1, parent: g });
    });
    if (o.labels) o.labels.forEach(function (s, i) { self.text(x + i * (bw + gap) + bw / 2, y + h + 14, s, { size: o.labelSize || 11, anchor: 'middle', font: 'mono', color: C.dim, parent: g }); });
    g.bars = bars;
    g.update = function (vals, dur) {
      var from = bars.map(function (b) { return parseFloat(b.getAttribute('height')) / h; });
      return self.tween(dur === undefined ? 500 : dur, function (t) {
        vals.forEach(function (v, i) {
          var vv = from[i] + (v - from[i]) * t;
          bars[i].setAttribute('y', y + h - h * vv); bars[i].setAttribute('height', Math.max(0, h * vv));
        });
      });
    };
    return g;
  };

  /* line plot: fn(x) over [x0,x1] or points [[x,y]], domain y [y0,y1]; returns <g> with .curve */
  P.plot = function (x, y, w, h, data, o) {
    o = o || {};
    var g = this.group({ parent: o.parent });
    var xd = o.xDomain || [0, 1], yd = o.yDomain || [0, 1];
    if (o.axes !== false) {
      this.line(x, y + h, x + w, y + h, { color: C.faint, parent: g });
      this.line(x, y, x, y + h, { color: C.faint, parent: g });
      if (o.xLabel) this.text(x + w, y + h + 16, o.xLabel, { size: 11, anchor: 'end', color: C.dim, font: 'mono', parent: g });
      if (o.yLabel) this.text(x - 6, y - 10, o.yLabel, { size: 11, anchor: 'start', color: C.dim, font: 'mono', parent: g });
    }
    var pts = [];
    if (typeof data === 'function') {
      var N = o.samples || 120;
      for (var i = 0; i <= N; i++) { var xv = xd[0] + (xd[1] - xd[0]) * i / N; pts.push([xv, data(xv)]); }
    } else pts = data;
    var d = pts.map(function (p, i) {
      var px = x + (p[0] - xd[0]) / (xd[1] - xd[0]) * w;
      var py = y + h - (p[1] - yd[0]) / (yd[1] - yd[0]) * h;
      return (i ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1);
    }).join(' ');
    g.curve = this.path(d, { stroke: o.color || C.cyan, sw: o.sw || 2, parent: g, glow: o.glow });
    g.toPx = function (xv, yv) { return { x: x + (xv - xd[0]) / (xd[1] - xd[0]) * w, y: y + h - (yv - yd[0]) / (yd[1] - yd[0]) * h }; };
    return g;
  };

  /* ---------- animation helpers ---------- */
  /* reveal: from 'fade'|'up'|'down'|'left'|'right'|'scale'|'draw'. Sets start state synchronously. */
  P.reveal = function (el, o) {
    o = o || {};
    if (Array.isArray(el)) {
      var self = this, stagger = o.stagger === undefined ? 90 : o.stagger;
      return Promise.all(el.map(function (e, i) { return self.reveal(e, Object.assign({}, o, { delay: (o.delay || 0) + i * stagger, stagger: undefined })); }));
    }
    if (!el) return Promise.resolve();
    var from = o.from || 'fade', dur = o.dur || 600;
    var target = o.opacity;
    if (target === undefined) {
      var cur0 = parseFloat(el.getAttribute('opacity'));
      target = el.hasAttribute('data-op') ? el.getAttribute('data-op') : (cur0 > 0 ? cur0 : 1);
    }
    target = parseFloat(target);
    el.setAttribute('data-op', target);
    if (from === 'draw' && el.getTotalLength) {
      var L = el.getTotalLength();
      var dash = el.getAttribute('stroke-dasharray');
      el.setAttribute('stroke-dasharray', L + ' ' + L);
      el.setAttribute('stroke-dashoffset', L);
      el.setAttribute('opacity', target);
      return this.tween(dur, function (t) { el.setAttribute('stroke-dashoffset', L * (1 - t)); }, o.ease || 'inOut', o.delay).then(function () {
        if (dash) el.setAttribute('stroke-dasharray', dash); else el.removeAttribute('stroke-dasharray');
        el.removeAttribute('stroke-dashoffset');
      });
    }
    var dx = 0, dy = 0, s0 = 1, dist = o.dist || 24;
    if (from === 'up') dy = dist; else if (from === 'down') dy = -dist;
    else if (from === 'left') dx = -dist; else if (from === 'right') dx = dist;
    else if (from === 'scale') s0 = o.s0 || 0.6;
    var base = el._tf || { x: 0, y: 0, s: 1, r: 0 };
    var hasBox = s0 !== 1;
    var cx = 0, cy = 0;
    if (hasBox) {
      var bb = el.box || safeBBox(el);
      cx = bb.x + bb.w / 2; cy = bb.y + bb.h / 2;
    }
    var self2 = this;
    el.setAttribute('opacity', 0);
    var apply = function (t) {
      el.setAttribute('opacity', (target * t).toFixed(3));
      if (dx || dy || hasBox) {
        var s = s0 + (1 - s0) * t;
        var tx = base.x + dx * (1 - t), ty = base.y + dy * (1 - t);
        var tr = 'translate(' + tx + ',' + ty + ') rotate(' + base.r + ') scale(' + base.s + ')';
        if (hasBox) tr += ' translate(' + cx + ',' + cy + ') scale(' + s + ') translate(' + (-cx) + ',' + (-cy) + ')';
        el.setAttribute('transform', tr);
      }
    };
    apply(0);
    return this.tween(dur, apply, o.ease || (from === 'scale' ? 'back' : 'out'), o.delay).then(function () {
      if (!self2.dead && (dx || dy || hasBox)) self2.place(el, base.x, base.y, base.s, base.r);
    });
  };

  function safeBBox(el) {
    try { var b = el.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; } catch (e) { return { x: 0, y: 0, w: 0, h: 0 }; }
  }
  P.bbox = safeBBox;

  P.fadeOut = function (el, dur, remove) {
    if (Array.isArray(el)) { var s = this; return Promise.all(el.map(function (e) { return s.fadeOut(e, dur, remove); })); }
    if (!el) return Promise.resolve();
    var from = parseFloat(el.getAttribute('opacity') || 1);
    return this.tween(dur || 400, function (t) { el.setAttribute('opacity', (from * (1 - t)).toFixed(3)); }, 'out').then(function () {
      if (remove && el.parentNode) el.parentNode.removeChild(el);
    });
  };

  P.remove = function (el, dur) { return this.fadeOut(el, dur || 300, true); };

  P.fade = function (el, to, dur) {
    if (Array.isArray(el)) { var s = this; return Promise.all(el.map(function (e) { return s.fade(e, to, dur); })); }
    var from = parseFloat(el.getAttribute('opacity') || 1);
    el.setAttribute('data-op', to);
    return this.tween(dur || 400, function (t) { el.setAttribute('opacity', (from + (to - from) * t).toFixed(3)); });
  };

  /* animate numeric attributes: attrs = {name: [from, to]} */
  P.animate = function (el, attrs, dur, ease, delay) {
    return this.tween(dur || 500, function (t) {
      for (var k in attrs) el.setAttribute(k, attrs[k][0] + (attrs[k][1] - attrs[k][0]) * t);
    }, ease, delay);
  };

  /* animated transform: target {x,y,s,r} (absolute translate/scale/rotate of the element) */
  P.transform = function (el, to, dur, ease, delay) {
    var from = el._tf || { x: 0, y: 0, s: 1, r: 0 };
    var tgt = { x: to.x === undefined ? from.x : to.x, y: to.y === undefined ? from.y : to.y, s: to.s === undefined ? from.s : to.s, r: to.r === undefined ? from.r : to.r };
    var self = this;
    return this.tween(dur || 600, function (t) {
      self.place(el, from.x + (tgt.x - from.x) * t, from.y + (tgt.y - from.y) * t, from.s + (tgt.s - from.s) * t, from.r + (tgt.r - from.r) * t);
    }, ease, delay);
  };

  P.pulse = function (el, o) {
    o = o || {};
    var self = this;
    var bb = el.box || safeBBox(el);
    var col = colorOf(o.color || el.color || C.cyan);
    var ring = this.rect(bb.x - 6, bb.y - 6, bb.w + 12, bb.h + 12, { rx: 14, stroke: col, sw: 2, parent: o.parent || el.parentNode, glow: true });
    var times = o.times || 1;
    if (this.instant) { ring.parentNode.removeChild(ring); return Promise.resolve(); }
    return this.tween((o.dur || 900) * times, function (t) {
      var k = (t * times) % 1;
      var g = 6 + k * 14;
      ring.setAttribute('x', bb.x - g); ring.setAttribute('y', bb.y - g);
      ring.setAttribute('width', bb.w + 2 * g); ring.setAttribute('height', bb.h + 2 * g);
      ring.setAttribute('opacity', (1 - k).toFixed(3));
    }, 'linear').then(function () { if (ring.parentNode) ring.parentNode.removeChild(ring); });
  };

  /* persistent highlight frame around an element; returns rect */
  P.highlight = function (el, o) {
    o = o || {};
    var bb = el.box || safeBBox(el);
    var pad = o.pad === undefined ? 8 : o.pad;
    var r = this.rect(bb.x - pad, bb.y - pad, bb.w + 2 * pad, bb.h + 2 * pad, { rx: o.rx || 12, stroke: o.color || C.amber, sw: 2, dash: o.dash || '8 5', parent: o.parent, glow: true });
    this.reveal(r, { dur: 300 });
    return r;
  };

  /* dim every top-level child of the scene layer except `keep` (array); focus(null) restores */
  P.focus = function (keep, level) {
    var lv = level === undefined ? 0.15 : level;
    var kids = Array.prototype.slice.call(this.layer.childNodes);
    var set = keep ? keep : [];
    var self = this;
    var anims = [];
    kids.forEach(function (k) {
      if (k.nodeType !== 1) return;
      var base = k.hasAttribute('data-op') ? parseFloat(k.getAttribute('data-op')) : 1;
      var target = (!keep || set.indexOf(k) >= 0) ? base : base * lv;
      var cur = parseFloat(k.getAttribute('opacity') || 1);
      if (Math.abs(cur - target) > 0.01) anims.push(self.tween(450, function (t) { k.setAttribute('opacity', (cur + (target - cur) * t).toFixed(3)); }));
    });
    return Promise.all(anims);
  };

  /* camera: center scene point (x,y) and scale s. camera() resets. */
  P.camera = function (x, y, s, dur) {
    if (x === undefined || x === null) { x = W / 2; y = H / 2; s = 1; }
    var from = this._camState, self = this;
    var to = { x: x, y: y, s: s || 1 };
    if (dur === 0) { this._applyCam(to.x, to.y, to.s); this._camState = to; return Promise.resolve(); }
    return this.tween(dur || 900, function (t) {
      var cx = from.x + (to.x - from.x) * t, cy = from.y + (to.y - from.y) * t, cs = from.s + (to.s - from.s) * t;
      self._applyCam(cx, cy, cs);
    }, 'inOut').then(function () { self._camState = to; });
  };

  P._applyCam = function (x, y, s) {
    this.layer.setAttribute('transform', 'translate(' + (W / 2) + ',' + (H / 2) + ') scale(' + s + ') translate(' + (-x) + ',' + (-y) + ')');
    this._camNow = { x: x, y: y, s: s };
    this._syncCanvas();
  };

  /* engine hook: the scene wrapper's transform/opacity changed (zoom / fade transitions) */
  P._setWrap = function (cx, cy, s, op) {
    var w = this._wrapTf || { cx: W / 2, cy: H / 2, s: 1, op: 1 };
    this._wrapTf = { cx: cx === undefined || cx === null ? w.cx : cx, cy: cy === undefined || cy === null ? w.cy : cy, s: s === undefined || s === null ? w.s : s, op: op === undefined || op === null ? w.op : op };
    this._syncCanvas();
  };

  /* keep the 2D canvas overlay aligned with the SVG: compose wrapper transform and ctx.camera */
  P._syncCanvas = function () {
    var cv = this._canvas;
    if (!cv) return;
    var w = this._wrapTf || { cx: W / 2, cy: H / 2, s: 1, op: 1 };
    var c = this._camNow || { x: W / 2, y: H / 2, s: 1 };
    var S = w.s * c.s;
    var ax = W / 2 + w.s * (W / 2 - w.cx) - S * c.x;
    var ay = H / 2 + w.s * (H / 2 - w.cy) - S * c.y;
    var ident = Math.abs(S - 1) < 1e-4 && Math.abs(ax) < 0.01 && Math.abs(ay) < 0.01;
    cv.style.transformOrigin = '0 0';
    cv.style.transform = ident ? '' : 'translate(' + (ax / W * 100).toFixed(4) + '%,' + (ay / H * 100).toFixed(4) + '%) scale(' + S.toFixed(5) + ')';
    cv.style.opacity = w.op >= 0.999 ? '' : String(Math.max(0, w.op).toFixed(3));
  };

  P.typeText = function (el, str, dur) {
    var n = str.length;
    return this.tween(dur || Math.min(1400, n * 28), function (t) { el.textContent = str.slice(0, Math.round(n * t)); }, 'linear');
  };

  P.counter = function (el, from, to, dur, fmt) {
    fmt = fmt || function (v) { return Math.round(v).toLocaleString('en-US'); };
    return this.tween(dur || 900, function (t) { el.textContent = fmt(from + (to - from) * t); }, 'out');
  };

  /* make an element a zoom target: click zooms into scene `sceneId` */
  P.hotspot = function (el, sceneId, o) {
    o = o || {};
    var eng = this.engine;
    var meta = eng.meta(sceneId);
    if (!meta) { console.warn('hotspot: unknown scene', sceneId); return el; }
    el.classList.add('hotspot');
    el.setAttribute('data-target', sceneId);
    var bb = el.box || safeBBox(el);
    var col = colorOf(o.color || el.color || meta.colorHex);
    var ring = this.rect(bb.x - 5, bb.y - 5, bb.w + 10, bb.h + 10, { rx: 12, stroke: col, sw: 1.4, dash: '3 6', parent: el, cls: 'hotspot-ring' });
    var hint = this.label(bb.x + bb.w - 6, bb.y - 4, o.hint || 'ZOOM ⤢', { color: col, size: 10, anchor: 'end', parent: el });
    hint.classList.add('hotspot-hint');
    var tip = document.createElementNS(NS, 'title');
    tip.textContent = 'Zoom into: ' + meta.title;
    el.appendChild(tip);
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      eng.zoomInto(sceneId, bb, el);
    });
    return el;
  };

  /* lazily created canvas overlay in scene coordinates (1600x900). Returns {ctx2d, canvas, W, H} */
  P.canvas = function () {
    if (this._canvas) return this._canvasApi;
    var cv = document.createElement('canvas');
    cv.className = 'scene-canvas';
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    this.stageEl.appendChild(cv);
    var c2 = cv.getContext('2d');
    c2.scale(dpr, dpr);
    this._canvas = cv;
    this._canvasApi = { ctx2d: c2, canvas: cv, W: W, H: H };
    this._syncCanvas();
    return this._canvasApi;
  };

  /* notify the engine/drawer of a key metric or callout (shown in the HUD) */
  P.hud = function (str) { this.engine.setHud(str); };

  window.AtlasCtx = { SceneCtx: SceneCtx, C: C, Ease: Ease, ICONS: ICONS, hexA: hexA, mix: mix, W: W, H: H, rng: rng };
})();
