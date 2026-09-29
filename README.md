# Genesis Atlas

**How a sentence becomes a film.** Genesis Atlas is an interactive, narrated, zoomable teardown of a
state-of-the-art multimodal AI-agent video-creation system, written for CS/EE PhD-level engineers.

The whole system is followed through one running example: *a creator asks for a 30-second cinematic
trailer of a fox astronaut crash-landing on a glowing ice moon, with 3 style sketches and a 42-second
voice memo for narration.* The request is traced from the keystroke through edge and gateway, the agent
orchestration plane, multimodal encoders, the LLM (down to attention kernels and a single neuron),
diffusion video generation, the GPU cluster, post-production and delivery, and safety and evals.

* 41 chambers arranged in 4 levels: L0 system, L1 subsystem, L2 component, L3 primitive.
  In total there are 356 steps and 1,619 narrated points (beats).
* Every step is split into **beats**, one idea each. For every beat the app shows, together and in order:
  an animation segment on the stage, the narration (spoken and captioned), a **callout card** in the left
  panel, and a **deep-dive block** with the math, numbers and trade-offs for that idea.
* You choose the pace: press Next for every idea (**Step**), press Play once and let a topic run (**Topic**),
  or let every topic you open start by itself (**Auto**).
* Components with a dashed ring and a pulsing "+" are zoom targets: click one to fly from the architecture
  overview into a subsystem, and from there into components and primitives.
* Every chamber remembers where you stopped. Back, Home, a Progress panel and a system map let you move
  around freely and come back to the exact picture you left.
* 281 distinct references (papers, specs, systems; 413 citations) are numbered globally and listed on a
  References page in their own tab. A glossary of 200 terms turns jargon into hover definitions inside the
  deep-dive text.
* The app is static. It has no build step, no server and no dependencies, and it works offline: the fonts are
  bundled.

## Original product brief

This app was built from the following requirements:

> Design and implement a complete, hardcore web application that explains the principles behind an
> AI system for multimodal video creation. It should explain in detail how the complete AI solution
> architecture works when a person interacts with a multimodal AI agent to create an AI video.
> That includes, but is not limited to:
>
> * the AI orchestration system
> * agent tool calling
> * multi-agent interaction
> * communication from the user's client to the cloud
> * how the AI infrastructure schedules user requests on the GPU cluster
> * load balancing
> * how an LLM becomes an AI agent (the orchestration loop)
> * the transformer
> * understanding of multimodal assets
> * video generation models
> * how a single neuron works
> * any other key technologies in the system not listed here
>
> Requirements:
>
> * Animations use progressive disclosure and come with English narration.
> * Users can choose interactively which system to learn about in detail. The app shows the
>   high-level structure and also lets users zoom in on a specific system's internals.
> * Interaction feels natural.
> * Explanations go from simple to deep and are detailed and state-of-the-art, pitched at CS
>   engineering PhDs.
> * The UI has a tech aesthetic.
> * Animations and transitions between systems are natural and smooth.

## Opening it

Double-click `index.html`. It runs from `file://`.

* **Chrome or Edge is recommended.** Narration uses the browser's English speech voices. Edge's "Natural"
  voices (Aria, Jenny, Ava, Guy) and Chrome's "Google US English" sound best.
* Firefox and Safari work, but they may have fewer or robotic voices. With narration muted, the narrator
  still paces the steps on a reading-speed clock, so playback and captions behave the same.
* A window of 1280 px or wider works best. The stage keeps a 16:9 shape and scales to fit. The top bar wraps
  onto a second row on narrower windows, and on phone widths the left panel moves below the stage.
* The deep-dive panel sits beside the stage only when the stage can still be 1,180 px wide (roughly a
  1,850 px window and up); on smaller windows it becomes a slide-over drawer (press `D`).
* Deep links work: `index.html#/attention/3` opens the Attention chamber at step 3.
* The references page is `references.html`. It opens in its own tab from the References button.
* The start page offers **Continue where I left off** (when the browser remembers a place), the guided tour,
  free exploration and the map, plus the play mode.

## How it plays

### Beats: one idea at a time

A step is a short chapter of a chamber (5 to 9 steps per chamber). It is cut into 3 to 7 beats. A beat is a
self-contained unit of progress: something new appears or changes on the stage, and the narration, the card
and the deep-dive block talk about exactly that. The dots in the top bar (pips) show the beats of the
current step, and you can click any pip to jump there and go back. The timeline under the top bar has one tick
per step; click a tick to jump to that step.

### Play modes

| Mode | What happens |
|---|---|
| **Step** | Everything waits for you. After each beat the Next button blinks; press it (or `→`, or `Space`) to reveal the next idea, like slides. |
| **Topic** (default) | Press Play once. Beats and steps advance by themselves, with a pause after each beat that is long enough to read its card and deep-dive block, until the chamber ends. |
| **Auto** | Like Topic, but every chamber you open, or the next chamber of a guided tour, starts playing by itself. |

Switch modes from the segmented control in the top bar, from the settings panel, from the start page, or with `S`.

A newly opened topic waits for Play (Step and Topic modes): a chamber opened from a hotspot, the map, the
Progress panel or a tour starts paused behind its complete system diagram, with a "Play this topic" prompt
(press it, `Space` or `→`). Only in Auto does it start alone. The backdrop is picked automatically: the engine
silently replays the chamber's steps and shows the fullest picture; a scene can pin one with `poster: N`.
At the end of a chamber playback stops and the Zoom button pulses when the chamber has components to open
(in a guided tour the next chamber follows).

### Position memory, Start over, Continue

* **Every chamber remembers where you stopped** (step and point), across zoom trips and browser reloads.
  Returning to a chamber (Back, the map, a hotspot, Continue) restores that exact picture, paused, with a hint
  to press Next; in Auto it carries on by itself.
* **Start over** (top left) forgets the position of the current chamber and begins it again from its first
  point. A step chosen explicitly (a timeline tick, the Progress list, a deep link, a tour) starts fresh there.
* **Continue where I left off** on the start page reopens the chamber you last visited at its remembered point.

### Back, Home, narration play/pause, reading mode

* **Back** (`Esc`, `Backspace`, `↑`) zooms out to the parent chamber and lands on the parent's remembered
  position, or on its finished last step (where the zoom targets are visible) if you never played it. On the
  overview the button reads Start and opens the start page. **Home** (`H`, the brand, or the house button)
  pauses playback and opens the start page; Continue picks up exactly where you were.
* The round button next to Next **pauses and resumes narration** (`Space` in Topic and Auto, or `P`). The
  sentence in progress restarts on resume. On a waiting topic the same button starts it.
* **Mute** (`V`, the speaker button) switches to **reading mode**: no speech, the text panels set the pace, and a
  reading-speed clock (about 2.5 words a second, scaled by the speed setting) still drives captions and Auto.
* **Replay** (`R`) plays the current point again.

### The left panel: narration box and callout cards

The left panel starts with the step title. Below it is the **narration box**, a fixed-height box that shows the
`say` text of the current point sentence by sentence: the sentence being spoken is highlighted, earlier ones
are dimmed, a sentence that is taller than the box scrolls slowly while it is spoken, and fades at the top and
bottom edge show that there is more to scroll. `C` (or the text-box button) hides or shows it.

Under it, each beat drops one **callout card**: a takeaway a viewer can absorb in two seconds. Cards are
tagged KEY IDEA, HOW IT WORKS, NUMBERS (with a big stat), WHY IT MATTERS, TRADE-OFF, PITFALL, STATE OF THE ART
or TRY IT (the stage is clickable). Some cards have a "Go deeper" panel. Only the newest card is open; the
earlier ones of the step are folded into "Earlier points (n)".

### Deep dive

The deep-dive panel collects one block per beat as the step unfolds: equations, tensor shapes, orders of
magnitude, pseudo-code, tables, caveats and expandable derivations ("Go deeper"). It is an inline column next
to the stage when there is room and a slide-over **drawer** otherwise (`D` or the Deep dive button toggles it;
`Esc` closes the drawer). Code blocks have a Copy button. Below the blocks, the Sources chips give the
reference numbers cited by this chamber.

### Focus mode

`F` (or the corner-arrows button) hides every panel and leaves only the stage. `D` leaves focus mode and
opens the deep dive.

### Zoom targets, the "+" badge, the Zoom menu

Components that lead to a deeper chamber carry a dashed ring and a small pulsing **"+" badge** on their
top-right corner; hovering shows a ZOOM label, and clicking (or `Enter` / `Space` on the focused ring) flies
into that chamber. The **Zoom** menu (`Z`) lists the children of the current chamber, and its badge shows how
many there are.

### Progress panel and map

* **Progress** (`L`) is a tree of all chambers with two separate records, both stored in the browser:
  * **played** is recorded automatically as points are shown (a step is "partly played" until its last point
    has been shown, then "played");
  * **learned** is your own commitment: tick a step, or tick a whole chamber.
  Click any step title to **jump to that step**, click a chamber title to open it. Buttons expand or collapse
  the tree, hide learned steps, open the map or reset either record independently.
* The **System map** (`M`) shows every chamber grouped by subsystem, with a filter box. It shares the counts
  of the Progress panel: the ring and the first number are steps played, the green number is steps learned.
  Click any chamber to fly there; it opens where you left off. The map also holds the Progress button and both
  tours. Narration pauses while the map is open.
* Two guided tours: **Big-picture** covers L0 and the 10 subsystems in request-lifecycle order.
  **Full deep tour** walks all 41 chambers depth-first.
* Some chambers have in-scene interactivity (click tokens to inspect attention rows, drag a sampler
  schedule, toggle a temperature, kill a load-balancer node). These beats carry a TRY IT card.

### References page

`references.html` opens in its own tab and lists every cited work once. A work cited in several chambers has one
number everywhere: the page de-duplicates by the reference text, so the same work is written with an identical
string in every scene that cites it. The list can be searched and filtered by chamber, each entry links to the
chambers that cite it, and "Find online" opens a scholar search for the title.

### Glossary hover definitions

Underlined terms in the deep-dive text (KV cache, HBM, RoPE, ...) show a short definition on hover or click,
with a link that opens the chamber that explains the term. There are 200 terms; each is underlined once per
step, at most three new ones per block.

### Themes, fonts, accessibility

The stage is authored for dark and shown in a **dark** and a **light** theme (`T`, the sun button or Settings);
the light theme inverts luminance with a CSS filter and keeps the hues. The fonts (Inter, Instrument Serif,
JetBrains Mono, all OFL) are **bundled** in `fonts/`, so text metrics are identical everywhere and nothing is
fetched from the network. Every control has a visible focus ring and an accessible name, zoom targets are
keyboard-operable, `Esc` closes the topmost open layer first, and `prefers-reduced-motion` removes pulses,
slides and camera flights.

## Controls

| Input | Action |
|---|---|
| `→` / `PageDown`, Next | next point (beat) |
| `←` / `PageUp`, the previous button | previous point |
| `Space` | in Topic and Auto: pause or resume (start a waiting topic); in Step: next point |
| `P` | play or pause narration |
| `R`, the replay button | replay this point |
| `V` | mute narration (reading mode) or turn it back on |
| click a pip | jump to any beat of the current step |
| click a timeline tick (top) | jump to any step |
| click a dashed-ring component | zoom into that chamber |
| `Esc` | close the topmost open layer (popover, menu, settings, map, progress, drawer); when nothing is open, zoom out |
| `Backspace` / `↑`, Back | zoom out to the parent (not while a text panel has focus) |
| `H`, Home | start page |
| `S` | cycle the play mode: Step, Topic, Auto |
| `Z` | Zoom menu (children of this chamber) |
| `M` | System map |
| `L` | Progress panel |
| `D` | Deep dive panel or drawer |
| `F` | Focus mode (hide all panels) |
| `C` | Narration text box on or off |
| `T` | Dark or light theme |

Space and Enter on a focused button, and the paging and arrow keys inside a scrolling panel, keep their
native meaning.

## Settings

The gear button opens the playback settings. They are stored in the browser (`localStorage`,
key `atlas.settings.v2`).

| Setting | Values | Notes |
|---|---|---|
| Play mode | Step, Topic, Auto | see above |
| Speech speed | 0.5x, 0.6x, 0.7x, 0.8x, **0.9x (default)**, 1.0x, 1.15x, 1.3x | slower speech also lengthens the pauses |
| Pauses | Short (0.5x), Normal (1x), Long (1.8x), Very long (3x) | time allowed to read the callouts in Topic and Auto |
| Narration | Voice on, Off (captions only) | same as the mute button; with narration off, a reading-speed clock paces the beats |
| Voice | the English voices installed in your browser | changing it replays the current point |
| Narration text box | Shown, Hidden | |
| Theme | Dark, Light | |

The pause after a beat is `(0.9 s + 75 ms per word of the card + 22 ms per word of the deep-dive block)`, multiplied
by the Pauses setting and by 1 divided by the speech speed when it is below 1x, and clamped to 0.7 to 12 seconds.
The pause between steps is 1.6 s on the same scale. Other things the browser remembers: the progress
(`atlas.progress.v1`), each chamber's position (`atlas.pos.v1`) and the visited chambers (`atlas.visited`).

## Narration and the voice pipeline

Narration is the `say` text of each beat: one to three plain-English sentences (15 to 60 words), written
without symbols, so any voice can read it as written. Sentences are the unit of speech: the narrator splits
at sentence ends, speaks one utterance per sentence (Chrome truncates long utterances), highlights the current
sentence in the narration box, and restarts the sentence in progress when you pause and resume.

* **Today:** the app speaks with the browser's Web Speech voices (or stays silent and paces itself on a
  reading clock). There is no studio voice yet, and no voice has been chosen for the project.
* **Deciding the voice:** the choice is left to a listening test by the author. Nothing in the scene files depends on it.
* **After a voice is chosen:** pre-rendered audio can be generated once per beat from the same `say` text
  (`tools/gen_audio.py` does not exist yet; it would write one audio file per beat under `audio/`, plus a
  manifest of durations). The narrator would then prefer the studio file and fall back to the browser voice
  when a file is missing. Re-check the Auto-mode pauses once the real voice timing is known.

## App architecture

```
index.html            page shell: stage (SVG 1600x900 + canvas host + HUD), left panel (narration, cards),
                      deep-dive panel, top bar (playbar, modes), settings, progress, map, start page
references.html       the global reference list (shares js/core/refs.js and the scene files)
css/atlas.css         dark and light themes, HUD, panels, cards, settings, map, overlays
css/fonts.css         bundled fonts (Inter, JetBrains Mono, Instrument Serif; OFL) from fonts/
css/refs.css          styles of the reference page
fonts/                the bundled woff2 files
js/core/catalog.js    ATLAS_CATALOG: the single source of truth for the chamber tree (id, parent, level,
                      file, color, title, kicker, summary) + the tour definitions
js/core/glossary.js   ATLAS_GLOSSARY: 200 entries { t: term, re: regex, d: definition, s: chamber }
js/core/refs.js       global reference numbering: identical references share one number
js/core/ctx.js        SceneCtx: the drawing + animation toolkit handed to every scene
js/core/narrator.js   Web Speech narration, sentence chunking, pause and resume, reading-speed clock
js/core/engine.js     registry, navigation, zoom transitions, beat-by-beat playback, cards, deep dive,
                      glossary, settings, progress, position memory, map, tours, hash routing, poster picker
js/scenes/NN-*.js     one file per chamber; each calls Atlas.register({...})
docs/SCENE_API.md     the scene authoring contract (read this before writing a scene)
tools/                check.py, smoke.py (+ smoke.js, the in-page test driver), shot.py
```

**Catalog and scenes.** `catalog.js` defines the tree and the file of every chamber. A catalog entry without a
scene file gets an automatic placeholder scene, so the tree is always navigable. Each scene file is an IIFE that
calls `Atlas.register({ id, refs, setup?, poster?, steps })`. A step is `{ title, beats: [{ say, card, deep }], run(ctx) }`.
`run` draws the animation and calls `ctx.beat(k)` between the segments; the engine holds each gate until the
viewer enters beat `k`, so animation, narration, card and deep-dive block advance together.

**Engine.** One `requestAnimationFrame` loop drives everything and sleeps when idle. `Engine.go(id, {step})`
builds the target chamber into a fresh `<g class="scene-wrap">` and runs a transition: *zoom in* when the
target is a descendant (the camera flies into the clicked hotspot), *zoom out* when it is an ancestor, and a
crossfade otherwise. Steps are **cumulative**: to jump to step *k* (or into the middle of a step, or back to a
remembered position), the engine rebuilds the chamber and fast-forwards the earlier work in *instant* mode,
where every tween completes synchronously and every beat gate resolves immediately, then plays the rest
animated. Scenes are therefore deterministic: they use `ctx.rng` and `ctx.wait` and never touch `Math.random`
or `setTimeout`.

**Scene context (`ctx.js`).** One `SceneCtx` exists per build and owns everything a scene creates: SVG
elements, tweens, loops, timers and the optional canvas. `destroy()` tears all of it down, so scenes cannot
leak. It provides primitives (`rect`, `text`, `path`, `node`, `link`, `label`, `icon`, `code`, `matrix`, `bars`,
`plot`, `canvas`), animation (`tween`, `reveal`, `fade`, `transform`, `packet`, `stream`, `pulse`, `focus`,
`camera`, `beat`), the `hotspot(el, childId)` zoom link (dashed ring, "+" badge, keyboard-operable), and
utilities (seeded `rng`, colour maps, `mix`, `alpha`). The palette is semantic: amber = LLM, lime = video
generation, violet = multimodal, magenta = agents and orchestration, red = GPU and infrastructure, teal = data,
pink = safety, orange = audio and post-production, cyan and blue = client and network. Every SVG text is drawn
at 1.14 times the size a scene passes, never below 12.5 px.

**Narrator.** Splits `say` text into sentences (only at punctuation followed by whitespace, so "Qwen2.5"
stays intact), speaks each as its own utterance with a watchdog, reports the current sentence for the captions,
picks the best available English voice unless you pin one in the settings, and switches between spoken and
silent (reading-clock) narration without losing the place.

**Glossary.** After a deep-dive block is drawn, the engine scans its text nodes (never code, equations or links)
for glossary terms and wraps up to three previously unseen terms per block in a dotted underline. Hover or click shows the
definition (at most about 32 words) and a link that opens the chamber that explains the term.

**References.** `refs.js` builds one global list in catalog order. Two references are the same work when their
text is the same after stripping markup and punctuation, so the rule for authors is: write each work in one
canonical string ("Authors, *Title*, Venue Year") and paste exactly that string wherever it is cited. Prefer one
work per entry; where several works are bundled in one string, paste the identical bundle wherever it is cited.

**Poster.** A topic that is waiting for Play shows its complete system diagram, dimmed, behind the prompt. The
engine replays the chamber silently, scores the picture at the end of every step (visible text and nodes at
opacity 0.5 or more, how much of the canvas is covered, how many zoom targets are visible, penalties for
dimmed or off-canvas items and for steps that draw on a 2D canvas, which an SVG clone cannot carry) and clones
the best one; step 1 or the last step wins when it is within 5 % of the best. `poster: N` in `Atlas.register`
pins step N (1-based); `neuron`, `contrastive` and `postprod` do.

## Running-example ledger

Every chamber tells the same trailer story, so the figures below are shared. When you change one, change it everywhere.

| Item | Figure |
|---|---|
| Request | 30 s cinematic trailer, a 25-word prompt (about 35 tokens; about 60 ids with the chat template), 3 sketches (2048x1536), one 42 s voice memo |
| Understanding | sketch = 256 visual tokens; memo = 1,050 audio tokens (25 Hz); the reference analysis of the request is about 3,158 tokens |
| Agents | six: director, writer, storyboard, cinematographer, editor, critic |
| Shots | 6 shots of 5 s, 720p, 14B video DiT (d = 5,120, 40 layers, 40 heads), flow matching, **50 steps x 2 (CFG, w = 5) = 100 forward passes** for the plain teacher recipe (Wan 2.1's default sampler is UniPC; the diagrams draw Euler) |
| Tokens per shot | Video Generation, VAE, Diffusion, Video Serving, Post-production, Trust and Eval chambers use the 24 fps render spec: 121 frames, latent 16x31x90x160, **111,600 tokens**. DiT, Attention, FlashAttention, GPU, Parallelism, Infra and Scheduler quote Wan 2.1's native 16 fps: 81 frames, latent 16x21x90x160, **75,600 tokens** (the deep panels explain the difference) |
| GPU time | **8 GPUs x ~95 s = 760 GPU-s per shot; 6 shots = 4,560 GPU-s = 76 GPU-min.** One number, two derivations: (a) 75,600 tokens, plain 100-pass recipe, 8xB200 at about 40% MFU = 94 to 95 s (8xH100: about 215 s), used by Infra, GPU and Parallelism; (b) 111,600 tokens on 8xH100, where the plain recipe would need about 7 min (54 H100-min, 1.29e18 FLOP), and the production sampler (guidance-distilled, step-cached: about 25 full forwards, 3.2e17 FLOP, 43% MFU) needs about 95 s, used by Video Generation, Diffusion, Video Serving, Trust and Eval |
| The critic's verdict | shot 3 fails: identity 0.41 against a 0.75 threshold (the visor flips from teal to amber and the mission patch vanishes between 3.1 and 3.6 s). The repair regenerates only a window of about 1.5 s: about 30 s on 8 GPUs = **240 GPU-s (5% extra)**; the budget reserves the worst case of 760 GPU-s and refunds the difference. v2 scores identity 0.88 |
| Admission | the gateway estimates 5,420 GPU-s (4,560 shots + 760 one budgeted re-render + 100 planning, encoders, audio, edit), holds 5,960 (x 1.1), settles the 5,000 actually metered and releases 960 |
| Wall-clock | **about 150 s** (151 s in the trace): plan 12 s, shots 95 s, repair 30 s, edit, encode and CDN 14 s; audio overlaps the shots |
| The bill | 212k LLM tokens (190k in, 60% cached, 22k out) about $0.59 + 5,000 GPU-s (4,560 shots + 240 repair + 200 refs, voice, edit) at $2.50 per H100-hour about $3.47, total **about $4.07** (the sum of the rounded line items 3.17 + 0.17 + 0.59 + 0.14; the exact sum is $4.06) |
| Delivery | five HEVC renditions from 1080p at 4.5 Mb/s to 360p at 0.6 Mb/s (0.6, 0.9, 1.4, 2.5, 4.5), 4 s CMAF segments (the client chamber's ABR simulation uses a 4-rung ladder with 2 s segments and says so). Shots are generated at 720p and super-resolved before the 1080p master. H100 and A100 have no NVENC block: encoding runs on an L4 / L40S pool |
| Provenance | invisible watermark with a 48-bit payload plus a signed C2PA manifest (spec v2.1) |
| The planner LLM | Llama-3-70B class: 80 layers, d = 8,192, 64 query and 8 KV heads of dimension 128, 70.6 B parameters (141 GB in BF16; chambers that round to 70 B say 140 GB), KV cache 320 KiB per token |
| Scaling-law fit | the Besiroglu et al. replication of Chinchilla in both the LLM and the Training chambers: E = 1.82, A = 482, B = 2,085, alpha = 0.348, beta = 0.366, loss about 1.93 at 70.6 B parameters and 15 T tokens, optimum near 20 tokens per parameter |
| Hardware | H100 SXM: 80 GB HBM3, 3.35 TB/s, 989 TFLOP/s dense BF16 (1,979 with sparsity or FP8), NVLink 4 at 450 GB/s per direction. H200: 141 GB, 4.8 TB/s. B200: about 192 GB, about 8 TB/s, about 2.25 PFLOP/s dense BF16, NVLink 5 at 900 GB/s per direction (1.8 TB/s in total). FlashAttention-3 reaches about 650 TFLOP/s in BF16 at head dimension 128 (740 at 256) |

Design-level numbers with no primary source (latency budgets, TTLs, pool sizes, prices) are illustrative and
are labelled as such in the deep-dive text.

## Chamber map

Each chamber is listed with its steps and beats (narrated points).

```
L0  overview ─ The Whole Machine (9 steps, 29 beats)
├─ L1 client ─ Client & Real-time Transport (9, 47)
├─ L1 gateway ─ Edge, Gateway & Admission Control (9, 43)
├─ L1 orchestration ─ AI Orchestration Plane (9, 36)
│   ├─ L2 agent-loop ─ The Agent Loop: from LLM to Agent (9, 40)
│   ├─ L2 tool-calling ─ Tool Calling & MCP (9, 39)
│   ├─ L2 multi-agent ─ Multi-Agent Collaboration (9, 41)
│   └─ L2 durable-exec ─ Durable Workflow Execution (9, 46)
├─ L1 multimodal ─ Multimodal Understanding (9, 40)
│   ├─ L2 vision-encoder ─ Vision Encoders & Visual Tokens (9, 40)
│   ├─ L2 audio-encoder ─ Audio & Speech Encoding (9, 38)
│   └─ L2 contrastive ─ Contrastive Alignment (CLIP / SigLIP) (8, 35)
├─ L1 llm ─ Inside the LLM (8, 36)
│   ├─ L2 tokenization ─ Tokenization & Embeddings (8, 37)
│   ├─ L2 transformer ─ The Transformer Block (8, 35)
│   │   ├─ L3 neuron ─ A Single Neuron (8, 35)
│   │   └─ L3 moe ─ Mixture of Experts (8, 35)
│   ├─ L2 attention ─ Attention, Up Close (9, 40)
│   │   └─ L3 flash-attention ─ FlashAttention (8, 36)
│   ├─ L2 decoding ─ Decoding & Structured Output (9, 44)
│   └─ L2 training ─ How an LLM Learns to Be an Agent (9, 41)
├─ L1 videogen ─ Video Generation Models (9, 38)
│   ├─ L2 diffusion ─ Diffusion & Flow Matching (8, 32)
│   ├─ L2 video-vae ─ Spatiotemporal VAE (8, 32)
│   ├─ L2 dit ─ Diffusion Transformer (DiT) (9, 44)
│   └─ L2 consistency ─ Control, Consistency & Long Video (9, 44)
├─ L1 postprod ─ Audio, Editing & Delivery (8, 35)
│   ├─ L2 tts-audio ─ Speech, Music & Lip-Sync (9, 41)
│   └─ L2 render-delivery ─ Compositing, Encoding & Streaming (9, 40)
├─ L1 infra ─ AI Infrastructure & GPU Cluster (8, 37)
│   ├─ L2 scheduler ─ GPU Cluster Scheduling (8, 36)
│   ├─ L2 load-balancing ─ Inference Load Balancing (8, 33)
│   ├─ L2 llm-serving ─ LLM Serving Engine (9, 46)
│   ├─ L2 video-serving ─ Video Model Serving (9, 46)
│   ├─ L2 gpu ─ Inside the GPU & Interconnect (9, 41)
│   └─ L2 parallelism ─ Distributed Parallelism (9, 44)
├─ L1 data ─ Data, Memory & Storage (9, 47)
│   └─ L2 rag-memory ─ Vector Memory & Retrieval (9, 45)
└─ L1 trust ─ Safety, Evaluation & Observability (9, 41)
    ├─ L2 safety ─ Guardrails & Provenance (9, 42)
    └─ L2 eval-obs ─ Evals & Observability (9, 42)
```

The overview's agent crew is a second zoom target into `orchestration` (where the agents live); every
chamber is reachable through its parent's hotspot, from the map and from the Progress panel.

## Adding or changing a scene

1. Read `docs/SCENE_API.md` (the contract) and `js/scenes/00-overview.js` (the reference implementation).
2. Add a catalog entry in `js/core/catalog.js`: `{ id, parent, level, file, color, title, kicker, summary }`.
   The file name must match `file`.
3. Create `js/scenes/NN-name.js` and add its `<script>` tag to `index.html`. `references.html` loads the scene
   files from the catalog by itself. A catalog entry without a file shows a placeholder.
4. In the parent scene, add a hotspot on the element that represents the new chamber, in the step
   where it first appears: `ctx.hotspot(el, 'new-id')`. Hotspot only your own children.
5. Rules (the full list is in `docs/SCENE_API.md`):
   * 5 to 9 steps, 3 to 5 beats per step (2 to 7 allowed); each beat has `say` (15 to 60 words, no symbols),
     a `card` (tag, a title of at most 7 words, a body of about 35 words or a `stat`) and a `deep` block;
   * `run` calls `ctx.beat(k)` with an integer literal for every k from 1 to beats.length minus 1, in order;
   * keep the HUD zones free (x < 860, y < 150 and x > 1150, y < 70) and stay under about 1,500 SVG elements;
   * make steps cumulative and deterministic, with cross-step handles in `ctx.state`;
   * make sure one step shows the whole chamber at once (it becomes the poster), or pin one with `poster: N`;
   * use ES2017 only: no `?.`, `??`, class fields or regex lookbehind;
   * write references in the canonical form and reuse the exact string when another chamber cites the same work;
   * reuse the running-example figures above.
6. Verify with the tools below, one command at a time.

## Tools

The tools need Python 3. `check.py` needs `esprima` (`python -m pip install --user esprima`).
`smoke.py` and `shot.py` drive a single headless Edge or Chrome process and exit, so they stay light
on memory. Run them one at a time.

| Command | What it does |
|---|---|
| `python tools/check.py [files...]` | Static lint with no browser. Checks ES2017 syntax, one `Atlas.register` per file, that the id matches the catalog and file name, that every step has beats with `say`, `card` and `deep`, narration length and language, that `ctx.beat(k)` gates match the beats, that every `ctx.*` member exists on `SceneCtx`, that hotspot targets exist, and flags `Math.random`. With no arguments it checks every file and reports `scene files present: N / 41`. Prints `OK` on success. |
| `python tools/smoke.py [ids...]` | Loads `index.html?smoke`, builds every step instantly, replays it animated with beat gates, and checks that seeking into the middle of a step gives the same DOM as playing straight through. Reports JS errors and timeouts per scene and prints `SMOKE OK`. |
| `python tools/smoke.py --nav` | Navigation test: 40 zoom round-trips, backward jumps, the tours, the map and the reference numbering. Prints `SMOKE OK`. |
| `python tools/smoke.py --layout [ids...]` | Layout audit at the end of every beat: text overlap, HUD collision, off-canvas, node and pill overflow, text hidden behind nodes. Prints `LAYOUT: 0 issue(s)` when clean. `--json out.json` saves the issues. |
| `--viewport WxH` | Works with every mode: the inner window size, so the title block and panels are laid out for that window. Run `--layout` at 1366x680, 1536x730, 1600x900 (the default) and 1920x950. |
| `python tools/smoke.py --clicks [ids...]` | Click harness: clicks every interactive SVG element in the end state of every step (also just before a teardown mid-animation) and checks every hotspot (click and `Enter` must call `Engine.go` with the right target). No console or window error is allowed. Prints `CLICKS OK`. |
| `python tools/smoke.py --a11y` | Keyboard and accessibility checks: names, focus ring, the `Esc` stack, the drawer, aria state. |
| `python tools/smoke.py --chrome` | Shell layout audit at `--viewport`: top bar clipping and overlap, panels, page scroll. |
| `python tools/smoke.py --cards` | Stress test of the left panel (narration box and newest card) for every beat. |
| `python tools/smoke.py --posters [ids...]` | Poster picker diagnostic: the score of every step of a chamber. |
| `python tools/shot.py <id> <step> [beat] [--theme dark\|light] [--size 1920x1080] [--out file.png]` | Renders one step (1-based) at the end of the given beat, with the full UI chrome. Default size 1600x1000, output `tools/shots/<id>-<step>[-b<beat>][-light][-pending]-<size>.png`. CSS animations are jumped to their end state. |
| `--pending` | Shows the "Play this topic" state of a freshly opened chamber, with its poster (`python tools/shot.py <id> 1 1 --pending --size 1536x730`). |
| `--open progress\|map\|zoom\|home\|deep\|settings\|focus\|hist\|more[,..]` | Opens panels before the screenshot. |
| `python tools/shot.py references [n] [--theme light] [--size 800x900]` | Screenshot of the references page, optionally scrolled to reference n. |

The screenshots are scratch output: delete the contents of `tools/shots` when you are done.
