# Genesis Atlas — Scene Authoring Contract

Genesis Atlas is a static web app (no build step, no dependencies, opens from `file://`).
It explains the full architecture of a multimodal AI-agent video-creation system to a CS PhD
audience with narrated, progressively disclosed SVG animations and zoomable hierarchy
(L0 system → L1 subsystem → L2 component → L3 primitive).

**Reference implementation: `js/scenes/00-overview.js`. Read it before writing a scene.**

## Files you may touch
* Only your assigned `js/scenes/NN-name.js` files. The file name/id mapping is fixed in `js/core/catalog.js`.
* Never edit `js/core/*`, `css/*`, `index.html`, `tools/*`, or other agents' scene files. If you truly need
  an engine feature, implement it locally inside your scene file (with `ctx.el`, `ctx.loop`, …) and mention it
  in your final report.

## Scene file shape
```js
/* L2 — Title. One-line purpose. */
(function () {
  // optional private helpers (no globals leak)
  function drawThing(ctx, x, y) { ... }

  Atlas.register({
    id: 'agent-loop',                 // must match catalog + file name
    refs: ['Author et al., <i>Paper</i>, Venue Year', ...],   // HTML strings, 4–8 real references
    setup: function (ctx) { ... },    // optional: static backdrop drawn before step 1
    steps: [
      {
        title: 'Context assembly',                 // 1–4 words, shown on the timeline
        say: 'English narration, spoken style ...', // 45–120 words; this is read aloud by TTS
        deep: '<p>HTML deep dive for the side panel ...</p>',
        run: function (ctx) { ...; return promise; }
      },
      ...                                          // 5–9 steps per scene
    ]
  });
})();
```

## Step semantics (important)
* Steps are **cumulative**: step k assumes steps 0..k-1 already ran. Keep cross-step handles in `ctx.state`
  (a plain object, fresh per build). Never keep state in module-level variables.
* To jump backwards/forwards the engine **rebuilds** the scene: it runs `setup` and steps 0..k-1 with
  `ctx.instant = true` (all tweens/waits complete synchronously, packets are skipped), then animates step k.
  Your `run` functions must therefore produce the same final DOM whether instant or animated.
  Use `ctx.rng(seed)` instead of `Math.random()`.
* `run` returns a Promise that resolves when the step's main animation has finished (the engine also waits
  for the narration). Aim for 1.5–6 s of animation per step. Fire-and-forget animations are fine too.
* Continuous motion (flows, shimmering, particles) uses `ctx.loop(fn)`; it keeps running across later steps
  and is cleaned up automatically. Stop it with `handle.stop()` when a later step no longer needs it.
* Never use `setTimeout`, `setInterval`, `requestAnimationFrame`, `Math.random`, `fetch`, global variables,
  or DOM outside your scene layer. Use `ctx.wait`, `ctx.after`, `ctx.loop`, `ctx.rng`.
* JavaScript subset: ES2017 (`const/let`, arrow functions, template literals, destructuring, spread are fine).
  **Forbidden syntax**: class fields, optional chaining `?.`, nullish `??`, regex lookbehind. The linter enforces this.

## Canvas / layout rules
* Scene coordinates: **1600 × 900** (SVG viewBox). The HUD (level, scene title, step counter) is an HTML
  overlay: **keep x < 820, y < 150 free and x > 1180, y < 70 free.** Everything else is yours.
* Minimum font size 11; body labels 12–16; headings 18–26. Mono font for code, numbers, tensor shapes.
* Leave breathing room: don't exceed ~60 visible nodes at once. Fade/dim or remove content from earlier
  steps (`ctx.fade`, `ctx.focus`, `ctx.remove`) when a step shifts attention. Use `ctx.camera` to zoom into
  a region of the scene for close-ups (progressive disclosure *inside* a scene), and `ctx.camera()` to reset.
* Performance: ≤ ~1500 SVG elements per scene; for particle systems/noise images use `ctx.canvas()`
  (a 2D canvas in scene coordinates; draw inside a `ctx.loop`, keep images ≤ 128×128 then scale up).
* Style: dark tech aesthetic. Use the named palette; accent the scene with its catalog color and use other
  colors semantically (amber = LLM, lime = video gen, violet = multimodal, magenta = agents/orchestration,
  red = GPU/infra, teal = data, pink = safety, orange = audio/post, cyan/blue = client/network).

## Hotspots (zoom hierarchy)
* Every child scene of your scene (see catalog `parent`) **must** be reachable by a hotspot on the element
  that represents it: `ctx.hotspot(nodeEl, 'child-id')`. Clicking zooms into that chamber with a camera
  transition. Only hotspot to your own children (never to parents/siblings).
* Add the hotspot in the step where that element first appears.

## Content standard
* Audience: CS/EE PhD engineers. Be precise and state-of-the-art (as of 2025–2026): real algorithms, real
  equations, real tensor shapes and orders of magnitude, named systems/papers. No hand-waving, no marketing.
* Progressive disclosure: step 1 frames the chamber at high level (what it is, where it sits in the video
  pipeline); later steps drill into mechanisms, math, numbers, trade-offs; the last step summarises and
  points at deeper chambers (children) if any.
* Tie back to the running example: *a creator asks for a 30-second cinematic trailer of a fox astronaut
  crash-landing on a glowing ice moon, with 3 style sketches and a voice memo for narration.*
* `say`: natural spoken English for TTS. No markup, no symbols like →, ×, ≈, ², √ — write words
  ("times", "roughly", "squared"). Acronyms are fine. 45–120 words.
* `deep`: HTML for the side panel. Allowed: `<p> <b> <i> <code> <pre> <ul>/<ol>/<li> <table>/<tr>/<th>/<td>
  <sub> <sup> <br>`, plus `<div class="eq">…</div>` for display equations (Unicode math, e.g.
  `Attention(Q,K,V) = softmax(QKᵀ/√d<sub>k</sub>)V`), `<div class="note">…</div>` for callouts,
  `<span class="muted">`. Aim for 80–250 words of dense technical content per step: formulas, pseudo-code,
  numbers, trade-offs, failure modes.
* Interactivity is welcome where natural (e.g. click a token to show its attention row, click to toggle a
  temperature): attach listeners to your own SVG elements with `el.addEventListener('click', ...)`,
  set `el.style.cursor = 'pointer'`, and keep such state in `ctx.state`.

## ctx API reference (the linter rejects any other ctx member)
Colors: pass names `'cyan' 'blue' 'magenta' 'violet' 'amber' 'lime' 'orange' 'red' 'teal' 'pink'
'white' 'text' 'dim' 'faint' 'line' 'panel' 'panel2' 'bg'` or any CSS color. `ctx.C.<name>` gives the hex.

Properties: `ctx.state` (object), `ctx.W`=1600, `ctx.H`=900, `ctx.C`, `ctx.Ease`, `ctx.instant`, `ctx.speed`,
`ctx.layer` (root `<g>`), `ctx.dead`.

Time & animation (all return Promises unless noted; in instant mode they complete immediately):
* `ctx.tween(ms, fn(easedT, rawT), ease?, delayMs?)` — ease: `'linear'|'in'|'out'|'inOut'|'back'|'elastic'`
* `ctx.wait(ms)`; `ctx.after(ms, fn)` (no promise)
* `ctx.loop(fn(tSec, dtSec))` → `{stop()}` — continuous; runs in instant mode too
* `ctx.reveal(el | [els], {from:'fade'|'up'|'down'|'left'|'right'|'scale'|'draw', dur, delay, stagger, dist, s0, opacity})`
  — sets the start state synchronously, so create-then-reveal never flashes. `'draw'` animates a stroke
  (paths/lines/links).
* `ctx.fade(el|[els], toOpacity, ms)`; `ctx.fadeOut(el|[els], ms, removeAfter?)`; `ctx.remove(el, ms)`
* `ctx.animate(el, {attr: [from, to], ...}, ms, ease?, delay?)` — numeric SVG attributes
* `ctx.transform(el, {x, y, s, r}, ms, ease?, delay?)` — animate absolute translate/scale/rotate of a group
* `ctx.place(el, x, y, s?, r?)` — set transform immediately
* `ctx.pulse(el, {color, times, dur})` — expanding ring
* `ctx.highlight(el, {color, pad, dash})` → persistent dashed frame (returns rect)
* `ctx.focus([keepEls], dimLevel=0.15)` — dim all other top-level elements; `ctx.focus(null)` restores
* `ctx.camera(x, y, scale, ms)` — zoom the scene so (x,y) is centered; `ctx.camera()` resets; `ms = 0` applies instantly
* `ctx.typeText(textEl, str, ms?)`; `ctx.counter(textEl, from, to, ms?, fmt?)`
* `ctx.packet(pathEl, {color, r, dur, label, reverse, keep})` — one glowing packet along a path/link (skipped in instant mode)
* `ctx.stream(pathEl, {color, count, period, r, reverse})` → `{stop()}` — continuous packets
* `ctx.hud(str)` — show a metric chip in the top-right HUD (`''` fades it out). Keep it ≤ 48 characters; longer strings get a smaller font and are ellipsized, never wrapped

Drawing (all accept `opts.parent` = a group to draw into; default is the scene **top-level** layer — this includes
`ctx.code`, `ctx.matrix`, `ctx.para`, `ctx.label` and `ctx.highlight`, so pass `parent` whenever the element belongs to a
group you later fade or remove. Most accept `opacity`, `glow: true|'strong'`, `cls`. `glow` also works on perfectly
horizontal/vertical lines and paths):
* `ctx.el(tag, attrs, parent?)` raw SVG; `ctx.group({parent, x, y, opacity})`
* `ctx.rect(x, y, w, h, {fill, stroke, sw, rx, dash})` (top-left origin)
* `ctx.circle(cx, cy, r, {fill, stroke, sw, dash})`; `ctx.line(x1, y1, x2, y2, {color, sw, dash, arrow})`
* `ctx.path(d, {stroke|color, fill, sw, dash, arrow})`; `ctx.poly([[x,y],...], {fill, stroke, closed})`
* `ctx.text(x, y, str, {size, color, anchor:'start'|'middle'|'end', weight, font:'sans'|'mono'|'display', baseline, rotate, pre})`
  (y is the vertical middle of the text; `rotate` = degrees about (x,y); `pre: true` keeps runs of spaces).
  Mono text has ligatures disabled, so `<|im_start|>` renders literally. Avoid combining marks (r̂) in SVG text; use them in `deep` HTML.
* `ctx.para(x, y, [lines], {size, color, lh, font, anchor})` multi-line text group
* `ctx.label(x, y, str, {color, size, anchor, w, textColor, bgAlpha, bg})` pill chip (centered by default); `bg` = opaque
  background colour. Returns `<g>` with `.setText(str)` (resizes the pill unless `w` was fixed), `.rectEl`, `.textEl`
* `ctx.icon(name, cx, cy, size, color)` — names: user phone globe cloud server db gpu chip brain film image
  mic wave gear lock shield bolt eye doc code tool agent loop queue net chart check warn spark layers clock music search
* `ctx.node({x, y, w, h, title, sub, icon, color, kind:'box'|'pill'|'cyl'|'hex'|'chip'|'ghost', titleSize, subSize, glow})`
  — **x,y is the CENTER**. Returns `<g>` with `.box {x,y,w,h,cx,cy,l,r,t,b}`, `.color`, `.titleEl`, `.subEl`.
* `ctx.anchor(node, 'l'|'r'|'t'|'b'|'c')` → `{x,y}`
* `ctx.link(a, b, {color, from, to, curve, straight, bend:{x,y}, dash, sw, arrow=true, flow, flowSpeed, label, labelDx, labelDy})`
  — a/b are nodes (anything with `.box`) or points `{x,y}`. Returns `<path>` with `.len` and `.labelEl`.
* `ctx.matrix(x, y, rows, cols, {cell, gap, values: 2D array | fn(r,c), cmap, rowLabels, colLabels, stroke})`
  → group with `.cells[r][c]`, `.set(values|fn, cmap?)`, `.cellCenter(r,c)`, `.box`, `.w`, `.h`. Values in [0,1]
  (or [-1,1] for `'diverge'`), or a CSS color string. cmaps: `cyan magenta amber lime violet red heat diverge gray`.
* `ctx.vector(x, y, n, {values, cell, cmap, horizontal})` — a 1-D matrix
* `ctx.code({x, y, w, h?, title, lines, lang:'json'|'py'|'js'|'sh'|'text', size, color, typing, maxLines})`
  → group with `.addLine(str)` (Promise), `.typeAll()` (Promise), `.box`, `.h`, `.lineEls`. With `typing:true` nothing is
  shown until you call `typeAll()`/`addLine()`. Code lines preserve leading/repeated spaces (indentation survives).
* `ctx.bars(x, y, w, h, values[0..1], {color | [colors], labels, gap})` → group with `.update(values, ms)`
* `ctx.plot(x, y, w, h, fn | [[x,y],...], {xDomain, yDomain, color, sw, xLabel, yLabel, axes, samples})` → group with `.curve`, `.toPx(x,y)`
* `ctx.canvas()` → `{ctx2d, canvas, W, H}` — 2D canvas overlay in scene coordinates (drawn above the SVG); it follows
  `ctx.camera` and the engine's zoom/fade transitions
* `ctx.bbox(el)` → `{x,y,w,h}`

Utilities: `ctx.rng(seed)` → deterministic `() => [0,1)`; `ctx.clamp(v,a,b)`; `ctx.lerp(a,b,t)`;
`ctx.alpha(color, a)` → rgba string; `ctx.mix(c1, c2, t)` (hex, palette names or `rgb()` strings, e.g. `ctx.cmap` output); `ctx.cmap(name, v)`; `ctx.color(name)` → hex.

## Verify before you finish (run sequentially — one command at a time, they spawn one headless browser)
1. `python tools/check.py js/scenes/<file>.js` — must print `OK` (fix all ERRORs; address WARNs).
2. `python tools/smoke.py <scene-id>` — builds every step instantly and replays them animated at 60×;
   must print `SMOKE OK`.
3. `python tools/shot.py <scene-id> <step>` for **every** step, then view the PNG with the Read tool
   (saved to `tools/shots/<id>-<step>.png`). Check: no overlaps with the HUD or between labels, text fits
   inside boxes, nothing off-canvas, the step reads clearly. Fix and re-shoot until clean.
Do not start dev servers, do not install packages, do not open other browsers.
