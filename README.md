# Genesis Atlas

**How a sentence becomes a film.** Genesis Atlas is an interactive, narrated, zoomable teardown of a
state-of-the-art multimodal AI-agent video-creation system, written for CS/EE PhD-level engineers.

The whole system is followed through one running example: *a creator asks for a 30-second cinematic
trailer of a fox astronaut crash-landing on a glowing ice moon, with 3 style sketches and a voice memo
for narration.* The request is traced from the keystroke through edge and gateway, the agent
orchestration plane, multimodal encoders, the LLM (down to attention kernels and a single neuron),
diffusion video generation, the GPU cluster, post-production and delivery, and safety and evals.

* 41 chambers, 5–9 animated steps each, arranged in 4 levels:
  L0 system → L1 subsystem → L2 component → L3 primitive.
* Every step has progressive-disclosure SVG animation, English narration (Web Speech API) with
  synchronized subtitles, and a **Deep Dive** side panel with equations, numbers, pseudo-code,
  trade-offs and references.
* Clickable hotspots let you zoom from the architecture overview into any subsystem, and from
  there into components and primitives, with camera transitions.
* The app is static. It has no build step, no server and no dependencies. Web fonts load from
  Google Fonts when online and fall back to system fonts offline.

## Original product brief

This app was built from the following requirements (translated from Chinese):

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

* **Chrome or Edge is recommended.** Narration uses the browser's English speech voices. Edge's
  "Natural" voices (Aria, Jenny, Guy) and Chrome's "Google US English" sound best.
* Firefox and Safari work, but they may have fewer or robotic voices. With voice muted, the
  narrator still paces the steps on a reading-speed clock, so autoplay and subtitles behave the same.
* A 16:9 window of 1280 px or wider works best. The stage scales to fit.
* Deep links work: `index.html#/attention/3` opens the Attention chamber at step 3.

## Controls

| Input | Action |
|---|---|
| `→` / `PageDown`, ▶▶ | next step (at the last step: pulse the zoom chips / continue the tour) |
| `←` / `PageUp`, ◀◀ | previous step |
| `Space`, ▶ / ❚❚ | toggle autoplay (steps advance after the narration finishes) |
| click a glowing / dashed-ring component | zoom into that chamber |
| `Esc` / `Backspace` / `↑`, ↖ | zoom out to the parent chamber |
| `R`, ↻ | replay the current step |
| `M` | system map: every chamber, a filter box, visited marks, and the tours |
| `D` | show or hide the Deep Dive panel |
| `V` | toggle narration voice |
| speed selector | narration rate 0.9×–1.3× (animations speed up to match) |
| timeline ticks (bottom) | jump to any step (hover shows its title) |
| breadcrumbs (top) / zoom chips (bottom) | jump to an ancestor or zoom into a child |

There are two guided tours. **Big-picture** covers L0 and the 10 subsystems in request-lifecycle order.
**Full deep tour** walks all 41 chambers depth-first. Some chambers have in-scene interactivity, such as
clicking tokens to inspect attention rows, temperature chips, sliders and toggles.

## App architecture

```
index.html            page shell: stage (SVG 1600×900 + canvas host + HUD), drawer, dock, map, intro
css/atlas.css         dark "tech" theme, HUD, dock, drawer, map, overlays
js/core/catalog.js    ATLAS_CATALOG: the single source of truth for the chamber tree (id, parent,
                      level, file, color, title, kicker, summary) + tour definitions
js/core/ctx.js        SceneCtx: the drawing + animation toolkit handed to every scene
js/core/narrator.js   Web Speech narration, sentence chunking, subtitle callbacks, muted reading clock
js/core/engine.js     registry, navigation, zoom transitions, step playback, HUD, drawer, map,
                      tours, hash routing, frame driver
js/scenes/NN-*.js     one file per chamber; each calls Atlas.register({...})
docs/SCENE_API.md     the scene authoring contract (read this before writing a scene)
tools/                check.py, smoke.py (+ smoke.js), shot.py
```

**Engine (`engine.js`).** The engine loads the catalog, registers the scenes, and drives one
`requestAnimationFrame` loop that sleeps when idle. `Engine.go(id, {step, transition})` builds the
target scene into a fresh `<g class="scene-wrap">` and runs a transition. The transition is
*zoomIn* when the target is a descendant (the camera flies into the clicked hotspot's box), *zoomOut*
when it is an ancestor, and a lateral crossfade otherwise. Steps are **cumulative**. To jump to
step *k*, the engine rebuilds the scene and fast-forwards steps `0..k-1` in *instant* mode, where
every tween completes synchronously, then animates step *k*. Step playback waits for both the
step's animation promise and the narration before autoplay advances. A catalog entry without a
scene file gets an automatic placeholder scene, so the tree is always navigable.

**Scene context (`ctx.js`).** One `SceneCtx` exists per build. It owns everything a scene creates:
SVG elements, tweens, loops, timers and the optional canvas. `destroy()` tears all of it down, so
scenes cannot leak. It provides:
* primitives such as `rect`, `text`, `path`, `node`, `link`, `label`, `icon`, `code`, `matrix`, `bars`, `plot` and `canvas`;
* animation such as `tween`, `reveal`, `fade`, `transform`, `packet`, `stream`, `pulse`, `focus` and `camera` (in-scene zoom);
* the `hotspot(el, childId)` zoom link;
* utilities such as a seeded `rng`, colour maps and `mix`/`alpha`.

The palette is semantic: amber = LLM, lime = video generation, violet = multimodal,
magenta = agents, red = GPU/infra, teal = data, pink = safety, orange = audio/post, cyan/blue =
client/network.

**Narrator (`narrator.js`).** The narrator splits `say` text into sentences, splitting only at
punctuation followed by whitespace so "Qwen2.5" stays intact. It speaks each sentence as its own
utterance, because Chrome truncates long utterances, with a watchdog. It highlights the current
sentence in the subtitle strip and picks the best available English voice.

**Scenes (`js/scenes`).** Each file is an IIFE that calls
`Atlas.register({ id, refs, setup?, steps: [{title, say, deep, run(ctx)}] })`:
* `say` is the spoken narration;
* `deep` is HTML for the drawer;
* `run` draws and animates, and returns a promise.

Scenes are deterministic: they use `ctx.rng` and `ctx.wait` and never touch
`Math.random` or `setTimeout`. Instant and animated builds therefore converge on the same DOM.

## Chamber map

```
L0  overview ─ The Whole Machine
├─ L1 client ─ Client & Real-time Transport
├─ L1 gateway ─ Edge, Gateway & Admission Control
├─ L1 orchestration ─ AI Orchestration Plane
│   ├─ L2 agent-loop ─ The Agent Loop: from LLM to Agent
│   ├─ L2 tool-calling ─ Tool Calling & MCP
│   ├─ L2 multi-agent ─ Multi-Agent Collaboration
│   └─ L2 durable-exec ─ Durable Workflow Execution
├─ L1 multimodal ─ Multimodal Understanding
│   ├─ L2 vision-encoder ─ Vision Encoders & Visual Tokens
│   ├─ L2 audio-encoder ─ Audio & Speech Encoding
│   └─ L2 contrastive ─ Contrastive Alignment (CLIP / SigLIP)
├─ L1 llm ─ Inside the LLM
│   ├─ L2 tokenization ─ Tokenization & Embeddings
│   ├─ L2 transformer ─ The Transformer Block
│   │   ├─ L3 neuron ─ A Single Neuron
│   │   └─ L3 moe ─ Mixture of Experts
│   ├─ L2 attention ─ Attention, Up Close
│   │   └─ L3 flash-attention ─ FlashAttention
│   ├─ L2 decoding ─ Decoding & Structured Output
│   └─ L2 training ─ How an LLM Learns to Be an Agent
├─ L1 videogen ─ Video Generation Models
│   ├─ L2 diffusion ─ Diffusion & Flow Matching
│   ├─ L2 video-vae ─ Spatiotemporal VAE
│   ├─ L2 dit ─ Diffusion Transformer (DiT)
│   └─ L2 consistency ─ Control, Consistency & Long Video
├─ L1 postprod ─ Audio, Editing & Delivery
│   ├─ L2 tts-audio ─ Speech, Music & Lip-Sync
│   └─ L2 render-delivery ─ Compositing, Encoding & Streaming
├─ L1 infra ─ AI Infrastructure & GPU Cluster
│   ├─ L2 scheduler ─ GPU Cluster Scheduling
│   ├─ L2 load-balancing ─ Inference Load Balancing
│   ├─ L2 llm-serving ─ LLM Serving Engine
│   ├─ L2 video-serving ─ Video Model Serving
│   ├─ L2 gpu ─ Inside the GPU & Interconnect
│   └─ L2 parallelism ─ Distributed Parallelism
├─ L1 data ─ Data, Memory & Storage
│   └─ L2 rag-memory ─ Vector Memory & Retrieval
└─ L1 trust ─ Safety, Evaluation & Observability
    ├─ L2 safety ─ Guardrails & Provenance
    └─ L2 eval-obs ─ Evals & Observability
```

**Running-example numbers.** The trailer is 6 shots of 5 s at 720p, a 42 s voice memo and 3
sketches of 256 visual tokens each. Across the video chambers the shot is described at two frame rates:
* The Video Generation, VAE, Diffusion and Video Serving chambers use the render spec, 24 fps. That is
  121 frames, a latent of 16×31×90×160 and 111,600 tokens.
* The DiT, Attention, FlashAttention, GPU and Parallelism chambers quote Wan 2.1's native 16 fps
  setting. That is 81 frames, a latent of 16×21×90×160 and 75,600 tokens.

The deep panels explain the difference. After the serving optimizations, the trailer's GPU budget is
about 76 GPU-minutes: 6 shots × 8 GPUs × about 95 s.

## Adding or changing a scene

1. Read `docs/SCENE_API.md` (the contract) and `js/scenes/00-overview.js` (the reference implementation).
2. Add a catalog entry in `js/core/catalog.js`: `{ id, parent, level, file, color, title, kicker, summary }`.
   The file name must match `file`.
3. Create `js/scenes/NN-name.js` and add its `<script>` tag to `index.html`. A catalog entry
   without a file shows a placeholder.
4. In the parent scene, add a hotspot on the element that represents the new chamber, in the step
   where it first appears: `ctx.hotspot(el, 'new-id')`.
5. Rules:
   * keep 5–9 steps, with `say` at 45–120 spoken words (no symbols) and `deep` at 80–250 words;
   * keep the HUD zones free (x < 820, y < 150 and x > 1180, y < 70);
   * stay under about 1,500 SVG elements;
   * make steps cumulative and deterministic, with cross-step handles in `ctx.state`;
   * use ES2017 only: no `?.`, `??`, class fields or regex lookbehind.
6. Verify with the tools below, one command at a time.

## Tools

The tools need Python 3. `check.py` needs `esprima` (`python -m pip install --user esprima`).
`smoke.py` and `shot.py` drive a single headless Edge or Chrome process and exit, so they stay light
on memory. Run them one at a time.

| Command | What it does |
|---|---|
| `python tools/check.py [files…]` | Static lint with no browser. Checks ES2017 syntax, one `Atlas.register` per file, that the id matches the catalog and file name, required step fields, narration length and language, that every `ctx.*` member exists on `SceneCtx`, that hotspot targets exist, and flags `Math.random`. With no arguments it checks every file and reports `scene files present: N / 41`. Prints `OK` on success. |
| `python tools/smoke.py [ids…]` | Loads `index.html?smoke`, builds every step of every scene instantly, then replays all steps animated at 60× speed. It reports JS errors and timeouts per scene and prints `SMOKE OK` on success. |
| `python tools/shot.py <id> <step> [out.png]` | Renders one step (1-based) with the full UI chrome at 1600×1000. Output goes to `tools/shots/<id>-<step>.png`. Treat the screenshots as scratch output. |
