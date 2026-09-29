# Genesis Atlas — Scene Authoring Contract

Genesis Atlas is a static web app (no build step, no dependencies, opens from `file://`).
It explains the full architecture of a multimodal AI-agent video-creation system to a CS PhD
audience with narrated, progressively disclosed SVG animations and zoomable hierarchy
(L0 system → L1 subsystem → L2 component → L3 primitive).

**Reference implementation: `js/scenes/00-overview.js`. Read it before writing a scene.** It shows beats, cards,
gates, hotspots, and how a step is split into animation segments.

## Files you may touch
* Only your assigned `js/scenes/NN-name.js` files. The file name/id mapping is fixed in `js/core/catalog.js`.
* Never edit `js/core/*`, `css/*`, `index.html`, `tools/*`, `audio/*` or other agents' scene files. If you truly need
  an engine feature, implement it locally inside your scene file (with `ctx.el`, `ctx.loop`, …) and mention it
  in your final report.

## How the app plays a step: BEATS
A **step** (one item on the timeline) is split into **beats**. One beat = one idea. For every beat the app
shows, together and in order:
1. a new **animation segment** on the stage (your `run` code between two `ctx.beat` gates),
2. the beat's **narration** (`say`, spoken aloud, shown as subtitles),
3. a **callout card** on the left rail (`card`), a punchy takeaway that slides in,
4. a **deep-dive block** in the right rail (`deep`): the math / numbers / pseudo-code for that idea.

Two playback modes use the same data. **Auto** runs beat after beat with a pause proportional to how much new
text appeared. **Step** waits after every beat and blinks the Next button; the user presses it (or → / Space)
to reveal the next idea, like slides. The user can also click the pips to jump to any beat and go back.
So each beat must be a **self-contained, visible unit of progress**: something new appears or changes on the
stage, matching what is said.

```js
{
  title: 'Context assembly',                       // 1–4 words (timeline tooltip, rail heading)
  beats: [                                         // 3–5 beats per step (min 2, max 7)
    {
      say: 'One to three natural spoken sentences, 15–60 words.',   // concatenated beats = the step narration
      card: {                                      // left-rail callout (one per beat)
        tag: 'KEY IDEA',                           // KEY IDEA | HOW IT WORKS | NUMBERS | WHY IT MATTERS | TRADE-OFF | PITFALL | STATE OF THE ART | TRY IT
        title: 'Max 7 words',
        body: 'Max ~35 words. Inline <b>bold</b>, <i>italic</i>, <code> allowed.',
        // OR a big Apple-style number (use for hard numbers):
        // stat: { v: '111,600', u: 'tokens', l: 'per 5 s shot at 720p (latent, patch 1x2x2)' },
        // optional expandable "Go deeper" panel (HTML), for about one card in six:
        // more: '<p>…derivation or caveat…</p>'
      },
      deep: '<p>HTML for the right rail, 40–120 words for this beat…</p>'
    },
    ...
  ],
  run: function (ctx) {
    var S = ctx.state;
    /* beat 0 animation (starts immediately) */
    return Promise.all([ ... ]).then(function () { return ctx.beat(1); }).then(function () {
      /* beat 1 animation: starts only when the app enters beat 1 */
      return Promise.all([ ... ]).then(function () { return ctx.beat(2); });
    }).then(function () {
      /* beat 2 animation … the last segment does NOT call ctx.beat */
    });
  }
}
```

Rules for `run` and gates (enforced by `tools/check.py` and `tools/smoke.py`):
* `run` must call `ctx.beat(k)` with an **integer literal** for **every k in 1 … beats.length−1**, in order: exactly the
  gates between segments. Beat 0's animation runs first. The call `ctx.beat(k)` means *"segment k−1 has finished:
  hold here until beat k begins"*. Call it only after segment k−1's animations have resolved.
* Each segment must create or change something the viewer can see. If a beat is mostly narration, add a visible
  focus cue: `ctx.pulse`, `ctx.highlight`, `ctx.focus`, a fresh label, a highlighted path, a moving packet.
* Everything must stay **idempotent under fast-forward**: the engine rebuilds by running earlier steps with
  `ctx.instant = true` (gates resolve immediately, tweens complete synchronously), and it can jump to the middle
  of a step (instantly running beats 0..k−1, then stalling at gate k). The final DOM after seek-then-finish must
  equal the straight run (`smoke.py` compares element counts). So: create elements at the start of a segment
  (or before the first gate), never rely on wall-clock time, no `setTimeout`.
* Keep continuous loops (`ctx.loop`, `ctx.stream`) alive across beats; start them in the beat that introduces them.
* `say`: natural spoken English, one to three sentences per beat, **no symbols** (write "times", "roughly",
  "percent", "to"), acronyms fine. Sentence-final punctuation matters: subtitles and voice split on it. Never let a
  sentence span two beats. Every beat's `say` is read exactly as written.
* `card`: a headline a viewer can absorb in two seconds. Do not repeat the narration or the deep text verbatim.
  Prefer `NUMBERS` cards with a `stat` whenever the beat has a hard number; use `PITFALL` / `TRADE-OFF` /
  `STATE OF THE ART` where they apply, `TRY IT` when the stage is clickable. Tags must come from the list above.
* `deep` (HTML, right rail): allowed `<p> <b> <i> <code> <pre> <ul>/<ol>/<li> <table>/<tr>/<th>/<td> <sub> <sup> <br>`,
  `<div class="eq">…</div>` (display equation, Unicode math), `<div class="note">…</div>` (pull quote, shown in
  italic serif), `<details><summary>Go deeper</summary>…</details>` for derivations and caveats (interactive,
  collapsed by default), `<span class="muted">`. Each beat's chunk is one block: it should stand alone but flow from the
  previous block. Glossary terms (KV cache, HBM, RoPE …) are auto-linked with hover definitions; do not mark them up.
* Steps: 5–9 per scene, beats 3–5 per step, so a scene has roughly 20–40 beats. Depth: every scene must read like a
  PhD-level lecture: real equations, tensor shapes, numbers, named systems and papers, trade-offs, failure modes.

## Step semantics (important)
* Steps are **cumulative**: step k assumes steps 0..k-1 already ran. Keep cross-step handles in `ctx.state`
  (a plain object, fresh per build). Never keep state in module-level variables.
* `run` returns a Promise that resolves when the step's last segment has finished.
* Continuous motion uses `ctx.loop(fn)`; it is cleaned up automatically. Stop it with `handle.stop()`.
* Never use `setTimeout`, `setInterval`, `requestAnimationFrame`, `Math.random`, `fetch`, global variables,
  or DOM outside your scene layer. Use `ctx.wait`, `ctx.after`, `ctx.loop`, `ctx.rng`.
* JavaScript subset: ES2017. **Forbidden syntax**: class fields, optional chaining `?.`, nullish `??`, regex lookbehind.

## Scene file shape
```js
/* L2 — Title. One-line purpose. */
(function () {
  function helper(ctx, x, y) { ... }        // optional private helpers, no globals
  Atlas.register({
    id: 'agent-loop',                        // must match catalog + file name
    refs: ['Author et al., <i>Paper</i>, Venue Year', ...],   // HTML strings, 4–8 real references
    setup: function (ctx) { ... },           // optional backdrop drawn before step 1
    poster: 6,                               // optional: pin the step (1-based) whose end picture is the "Play this topic" backdrop
    steps: [ { title, beats, run }, ... ]
  });
})();
```
`refs` are shown to the viewer as **numbers only** (Sources chips); the full text lives on the References page,
deduplicated across chambers by text. Write each reference in a stable canonical form
("Authors, <i>Title</i>, Venue Year") and reuse the exact same string when two chambers cite the same work.

## Canvas / layout rules
* Scene coordinates: **1600 × 900** (SVG viewBox). The chamber title (level, kicker, title, step) is a small HTML overlay in the
  top-left that scales with the stage: **keep x < 860, y < 150 free**; the optional metric chip (`ctx.hud`) uses x > 1150, y < 70.
  Everything else is yours. There is no caption overlay: narration text lives in a fixed box in the left panel, callout cards
  below it, the deep dive in the right panel; nothing HTML covers the stage except the title and the "Play this topic" prompt.
* **Text scale:** every SVG text (`ctx.text`, node titles, labels, ...) is drawn at **1.14 ×** the size you pass, never below
  12.5 px (`AtlasCtx.TEXT`), so the stage stays legible on small windows. Write sizes as before (11–26); check that boxes and
  pills still hold the text at that scale (`ctx.label` pill widths already account for it). The layout audit runs at the shipped scale.
* Font sizes you pass: 11–16 for labels and body, 18–26 for headings.
* No overlaps: text must never overlap other text, spill out of its node or pill, sit behind an opaque node, or leave
  the canvas. `python tools/smoke.py --layout <id>` audits the end state of **every beat** (text-overlap, hud-collision,
  offscreen, node-overflow, pill-overflow, text-occluded) and must print `LAYOUT: 0 issue(s)`.
  If an overlap is truly intentional (a label sitting on a link) put `data-overlap-ok` on an ancestor group
  (`g.setAttribute('data-overlap-ok', '')`); use it sparingly.
* Leave breathing room: at most about 60 visible nodes at once. Fade, dim or remove content from earlier steps
  (`ctx.fade`, `ctx.focus`, `ctx.remove`) when attention shifts. Use `ctx.camera` for close-ups.
* Performance: ≤ ~1500 SVG elements per scene; particles and noise images go through `ctx.canvas()`.
* Style: the stage is authored for dark and shown in **both a dark and a light theme** (light inverts luminance with a CSS
  filter and keeps hues). Use the named palette and opaque dark fills like `#0d1a33` or `rgba(5,10,22,0.94)`; do not rely
  on pure black backgrounds, blend modes, or SVG `filter` effects other than `glow`. Check both themes.
  Colors: amber = LLM, lime = video gen, violet = multimodal, magenta = agents/orchestration, red = GPU/infra,
  teal = data, pink = safety, orange = audio/post, cyan/blue = client/network.

## Hotspots (zoom hierarchy)
* Every child scene of your scene (see catalog `parent`) **must** be reachable by a hotspot on the element
  that represents it: `ctx.hotspot(nodeEl, 'child-id')`. Only hotspot to your own children.
* Add the hotspot in the step/beat where that element first appears.
* `ctx.hotspot` automatically adds a dashed ring and a small pulsing "+" badge centered on the element's **top-right corner**
  (about 12 units of radius, its ripple reaches ~30). Keep that corner free of text, and give hotspot elements a bit of room above
  them (the hover label "ZOOM" appears there). A chamber opened from a hotspot starts paused ("Play this topic") behind the
  chamber's complete system diagram, which the engine builds by silently replaying your steps and picking the fullest picture,
  so make sure some step shows the whole system at once. The picker scores the end picture of every step (visible text, shapes and
  nodes at opacity 0.5 or more, canvas coverage, visible hotspots; steps that draw on a 2D canvas overlay are penalised because the
  backdrop is an SVG clone). If it picks a poor step, pin the right one with `poster: N` in `Atlas.register`.

## Content standard
* Audience: CS/EE PhD engineers. Precise and state-of-the-art (2025–2026): real algorithms, equations, tensor shapes,
  orders of magnitude, named systems and papers. No hand-waving, no marketing.
* Progressive disclosure: beat 1 of step 1 frames the chamber at high level; later beats drill into mechanisms, math,
  numbers, trade-offs; the last step summarises and points at deeper chambers (children).
* Tie back to the running example: *a creator asks for a 30-second cinematic trailer of a fox astronaut
  crash-landing on a glowing ice moon, with 3 style sketches and a 42-second voice memo for narration;
  6 shots, 8 GPUs each, about 95 s of diffusion per shot.*
* Interactivity is welcome where natural (click a token to show its attention row, toggle a temperature): attach
  listeners to your own SVG elements, set `el.style.cursor = 'pointer'`, keep state in `ctx.state`, and announce it
  in a `TRY IT` card.

## ctx API reference (the linter rejects any other ctx member)
Colors: pass names `'cyan' 'blue' 'magenta' 'violet' 'amber' 'lime' 'orange' 'red' 'teal' 'pink'
'white' 'text' 'dim' 'faint' 'line' 'panel' 'panel2' 'bg'` or any CSS color. `ctx.C.<name>` gives the hex.

Properties: `ctx.state` (object), `ctx.W`=1600, `ctx.H`=900, `ctx.C`, `ctx.Ease`, `ctx.instant`, `ctx.speed`,
`ctx.layer` (root `<g>`), `ctx.dead`.

Time & animation (all return Promises unless noted; in instant mode they complete immediately):
* `ctx.beat(k)`: **beat gate** (see "How the app plays a step"). Call `ctx.beat(k+1)` after segment k's animation has finished.
* `ctx.tween(ms, fn(easedT, rawT), ease?, delayMs?)`: ease is `'linear'|'in'|'out'|'inOut'|'back'|'elastic'`
* `ctx.wait(ms)`; `ctx.after(ms, fn)` (no promise)
* `ctx.loop(fn(tSec, dtSec))` → `{stop()}`: continuous; runs in instant mode too
* `ctx.reveal(el | [els], {from:'fade'|'up'|'down'|'left'|'right'|'scale'|'draw', dur, delay, stagger, dist, s0, opacity})`
  sets the start state synchronously, so create-then-reveal never flashes. `'draw'` animates a stroke
  (paths, lines, links).
* `ctx.fade(el|[els], toOpacity, ms)`; `ctx.fadeOut(el|[els], ms, removeAfter?)`; `ctx.remove(el, ms)`
* `ctx.animate(el, {attr: [from, to], ...}, ms, ease?, delay?)`: numeric SVG attributes
* `ctx.transform(el, {x, y, s, r}, ms, ease?, delay?)`: animate absolute translate/scale/rotate of a group
* `ctx.place(el, x, y, s?, r?)`: set transform immediately
* `ctx.pulse(el, {color, times, dur})`: expanding ring
* `ctx.highlight(el, {color, pad, dash})` → persistent dashed frame (returns rect)
* `ctx.focus([keepEls], dimLevel=0.15)`: dim all other top-level elements; `ctx.focus(null)` restores
* `ctx.camera(x, y, scale, ms)`: zoom the scene so (x,y) is centered; `ctx.camera()` resets; `ms = 0` applies instantly
* `ctx.typeText(textEl, str, ms?)`; `ctx.counter(textEl, from, to, ms?, fmt?)`
* `ctx.packet(pathEl, {color, r, dur, label, reverse, keep})`: one glowing packet along a path/link (skipped in instant mode)
* `ctx.stream(pathEl, {color, count, period, r, reverse})` → `{stop()}`: continuous packets
* `ctx.hud(str)`: show a metric chip in the top-right of the stage (`''` fades it out). Keep it ≤ 48 characters; longer
  strings get a smaller font and are ellipsized, never wrapped

Drawing (all accept `opts.parent` = a group to draw into; default is the scene **top-level** layer, which includes
`ctx.code`, `ctx.matrix`, `ctx.para`, `ctx.label` and `ctx.highlight`, so pass `parent` whenever the element belongs to a
group you later fade or remove. Most accept `opacity`, `glow: true|'strong'`, `cls`. `glow` also works on perfectly
horizontal/vertical lines and paths):
* `ctx.el(tag, attrs, parent?)` raw SVG; `ctx.group({parent, x, y, opacity})`
* `ctx.rect(x, y, w, h, {fill, stroke, sw, rx, dash})` (top-left origin)
* `ctx.circle(cx, cy, r, {fill, stroke, sw, dash})`; `ctx.line(x1, y1, x2, y2, {color, sw, dash, arrow})`
* `ctx.path(d, {stroke|color, fill, sw, dash, arrow})`; `ctx.poly([[x,y],...], {fill, stroke, closed})`
* `ctx.text(x, y, str, {size, color, anchor:'start'|'middle'|'end', weight, font:'sans'|'mono'|'display'|'code', baseline, rotate, pre})`
  (y is the vertical middle of the text; `rotate` = degrees about (x,y); `pre: true` keeps runs of spaces).
  **Fonts:** `sans` (Inter) for labels; `display` (Inter, semibold, tight) for titles; `mono` is Inter with tabular figures
  (good for numbers, tags, tensor shapes: it no longer looks like a typewriter); `code` is a true monospace (JetBrains
  Mono, no ligatures, so `<|im_start|>` renders literally): use it for code, column-aligned text and per-character
  layouts (`pre:true` selects it automatically; `ctx.code` uses it). Avoid combining marks (r̂) in SVG text; use them in `deep` HTML.
* `ctx.para(x, y, [lines], {size, color, lh, font, anchor})`: multi-line text group
* `ctx.label(x, y, str, {color, size, anchor, w, textColor, bgAlpha, bg})`: pill chip (centered by default); `bg` = opaque
  background colour. Returns `<g>` with `.setText(str)` (resizes the pill unless `w` was fixed), `.rectEl`, `.textEl`
* `ctx.icon(name, cx, cy, size, color)`; names: user phone globe cloud server db gpu chip brain film image
  mic wave gear lock shield bolt eye doc code tool agent loop queue net chart check warn spark layers clock music search
* `ctx.node({x, y, w, h, title, sub, icon, color, kind:'box'|'pill'|'cyl'|'hex'|'chip'|'ghost', titleSize, subSize, glow})`
  where **x,y is the CENTER**. Returns `<g>` with `.box {x,y,w,h,cx,cy,l,r,t,b}`, `.color`, `.titleEl`, `.subEl`.
* `ctx.anchor(node, 'l'|'r'|'t'|'b'|'c')` → `{x,y}`
* `ctx.link(a, b, {color, from, to, curve, straight, bend:{x,y}, dash, sw, arrow=true, flow, flowSpeed, label, labelDx, labelDy})`
  where a/b are nodes (anything with `.box`) or points `{x,y}`. Returns `<path>` with `.len` and `.labelEl`.
* `ctx.matrix(x, y, rows, cols, {cell, gap, values: 2D array | fn(r,c), cmap, rowLabels, colLabels, stroke})`
  → group with `.cells[r][c]`, `.set(values|fn, cmap?)`, `.cellCenter(r,c)`, `.box`, `.w`, `.h`. Values in [0,1]
  (or [-1,1] for `'diverge'`), or a CSS color string. cmaps: `cyan magenta amber lime violet red heat diverge gray`.
* `ctx.vector(x, y, n, {values, cell, cmap, horizontal})`: a 1-D matrix
* `ctx.code({x, y, w, h?, title, lines, lang:'json'|'py'|'js'|'sh'|'text', size, color, typing, maxLines})`
  → group with `.addLine(str)` (Promise), `.typeAll()` (Promise), `.box`, `.h`, `.lineEls`. With `typing:true` nothing is
  shown until you call `typeAll()`/`addLine()`. Code lines preserve leading and repeated spaces.
* `ctx.bars(x, y, w, h, values[0..1], {color | [colors], labels, gap})` → group with `.update(values, ms)`
* `ctx.plot(x, y, w, h, fn | [[x,y],...], {xDomain, yDomain, color, sw, xLabel, yLabel, axes, samples})` → group with `.curve`, `.toPx(x,y)`
* `ctx.canvas()` → `{ctx2d, canvas, W, H}`: 2D canvas overlay in scene coordinates (drawn above the SVG); it follows
  `ctx.camera` and the engine's zoom/fade transitions
* `ctx.bbox(el)` → `{x,y,w,h}`

Utilities: `ctx.rng(seed)` → deterministic `() => [0,1)`; `ctx.clamp(v,a,b)`; `ctx.lerp(a,b,t)`;
`ctx.alpha(color, a)` → rgba string; `ctx.mix(c1, c2, t)` (hex, palette names or `rgb()` strings, e.g. `ctx.cmap` output);
`ctx.cmap(name, v)`; `ctx.color(name)` → hex.

## Verify before you finish (one command at a time; each spawns a single headless browser)
1. `python tools/check.py js/scenes/<file>.js` must print `OK` (fix all ERRORs; address WARNs).
2. `python tools/smoke.py <scene-id>` builds every step instantly, replays animated with beat gates, and checks seek/resume
   consistency. Must print `SMOKE OK`.
3. `python tools/smoke.py --layout <scene-id>` must print `LAYOUT: 0 issue(s)`. Run it at several window sizes, because the title
   block and panels are laid out per viewport: `--viewport 1366x680`, `--viewport 1536x730`, `--viewport 1920x950` (all must be clean).
4. `python tools/shot.py <scene-id> <step> <beat>` (1-based) writes `tools/shots/…png`; view it with the Read tool. Look at the
   **last beat of every step** in dark, at `--size 1536x730` (a typical 125%-scaled laptop: left panel + big stage, deep dive as a
   drawer) and now and then at `--size 1920x950` (three columns), plus at least one step per scene with `--theme light`.
   Check the stage AND the left panel (narration box, cards) and the deep panel text. Fix and re-shoot until clean.
Do not start dev servers, do not install packages, do not open other browsers.
