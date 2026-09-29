/* L2 — Multi-Agent Collaboration. A film crew of agents: topologies, pass-by-reference artifacts,
 * a shared production bible, parallel fan-out, a critic gate, cost trade-offs and the A2A protocol. */
(function () {
  var AG = [
    { t: 'Writer', s: 'beats · script.md', ic: 'doc', tool: 'LLM', tc: 'amber', pk: 'write' },
    { t: 'Storyboard', s: 'shot list · frames', ic: 'image', tool: 'image model', tc: 'violet', pk: 'board' },
    { t: 'Cinematographer', s: 'prompts · camera', ic: 'film', tool: 'video DiT', tc: 'lime', pk: 'shots' },
    { t: 'Sound Designer', s: 'VO · score · foley', ic: 'music', tool: 'TTS · V2A', tc: 'orange', pk: 'audio' },
    { t: 'Editor', s: 'EDL · timeline', ic: 'layers', tool: 'compositor', tc: 'cyan', pk: 'cut' },
    { t: 'Critic', s: 'VLM judge · rubric', ic: 'eye', tool: 'VLM', tc: 'violet', pk: 'judge' }
  ];
  var AX = [150, 410, 670, 930, 1190, 1450];
  var SHOTS = ['descent streak', 'crash on ice', 'fox exits pod', 'visor close-up', 'walk to ridge', 'title reveal'];
  var DUR = [82, 95, 88, 101, 90, 76];           /* seconds per shot render (illustrative) */
  var RUB = ['adhere', 'identity', 'motion', 'physics', 'contin.', 'aesth.'];
  var WTS = [0.2, 0.3, 0.15, 0.1, 0.15, 0.1];
  var SC = [
    [0.88, 0.90, 0.84, 0.86, 0.85, 0.87],
    [0.83, 0.85, 0.79, 0.80, 0.84, 0.86],
    [0.81, 0.41, 0.82, 0.84, 0.55, 0.83],
    [0.86, 0.89, 0.80, 0.88, 0.86, 0.90],
    [0.84, 0.87, 0.81, 0.83, 0.82, 0.85],
    [0.90, 0.92, 0.88, 0.90, 0.87, 0.91]
  ];
  var SC3B = [0.86, 0.88, 0.84, 0.86, 0.87, 0.85];

  /* SVG collapses leading spaces: indent code lines with no-break spaces */
  function nb(lines) { return lines.map(function (s) { return s.replace(/^ +/, function (m) { return '\u00a0'.repeat(m.length); }); }); }
  function total(row) { var s = 0; for (var i = 0; i < row.length; i++) s += row[i] * WTS[i]; return s; }
  function scoreCol(ctx, v) { return v < 0.6 ? ctx.C.red : (v < 0.75 ? ctx.C.amber : ctx.C.lime); }

  function panel(ctx, x, y, w, h, col, parent) {
    return ctx.rect(x, y, w, h, { rx: 12, fill: 'rgba(7,12,26,0.93)', stroke: ctx.alpha(col, 0.5), sw: 1.2, parent: parent });
  }
  function head(ctx, x, y, str, col, parent, anchor) {
    return ctx.text(x, y, str, { size: 13, font: 'mono', weight: 600, color: col, parent: parent, anchor: anchor || 'start', spacing: 1.2 });
  }

  /* tiny procedurally drawn fox astronaut */
  function fox(ctx, cx, cy, s, visor, parent) {
    var g = ctx.group({ parent: parent });
    ctx.el('ellipse', { cx: cx, cy: cy + 7 * s, rx: 5.5 * s, ry: 7 * s, fill: '#e8eef5' }, g);
    ctx.poly([[cx - 5 * s, cy - 1 * s], [cx - 4 * s, cy - 9 * s], [cx - 1.5 * s, cy - 3 * s], [cx + 1.5 * s, cy - 3 * s], [cx + 4 * s, cy - 9 * s], [cx + 5 * s, cy - 1 * s], [cx, cy + 3 * s]], { fill: '#ff8a3d', parent: g });
    ctx.circle(cx, cy - 1 * s, 5.2 * s, { stroke: visor, sw: 1.3, parent: g });
    return g;
  }

  /* 100x56 thumbnail of shot v; bad=true draws the drifted (amber visor) version */
  function thumb(ctx, x, y, v, parent, bad) {
    var w = 100, h = 56, g = ctx.group({ parent: parent });
    ctx.rect(x, y, w, h, { rx: 4, fill: v === 3 ? '#1a0a14' : '#060b1a', stroke: ctx.alpha(bad ? 'red' : 'lime', 0.7), sw: 1.2, parent: g });
    var r = ctx.rng(31 + v);
    for (var i = 0; i < 4; i++) ctx.circle(x + 8 + r() * (w - 16), y + 5 + r() * 20, 0.9, { fill: '#cfe3ff', opacity: 0.8, parent: g });
    var teal = ctx.C.teal, vis = bad ? ctx.C.amber : teal;
    if (v === 0) {
      ctx.circle(x + 78, y + 50, 22, { fill: ctx.alpha('violet', 0.35), stroke: ctx.alpha(teal, 0.8), sw: 1, parent: g });
      ctx.line(x + 10, y + 8, x + 58, y + 34, { color: 'orange', sw: 2.2, parent: g, glow: true });
    } else if (v === 1) {
      ctx.poly([[x + 1, y + 44], [x + 40, y + 36], [x + 99, y + 42], [x + 99, y + 55], [x + 1, y + 55]], { fill: ctx.alpha(teal, 0.35), parent: g });
      ctx.circle(x + 52, y + 36, 10, { fill: ctx.alpha('orange', 0.75), parent: g, glow: true });
    } else if (v === 2) {
      ctx.poly([[x + 1, y + 46], [x + 99, y + 42], [x + 99, y + 55], [x + 1, y + 55]], { fill: ctx.alpha(teal, 0.3), parent: g });
      ctx.rect(x + 16, y + 14, 26, 32, { rx: 3, stroke: 'dim', sw: 1.2, parent: g });
      fox(ctx, x + 60, y + 30, 1.25, vis, g);
      if (bad) ctx.circle(x + 60, y + 21, 3, { fill: ctx.alpha('amber', 0.5), parent: g });
    } else if (v === 3) {
      fox(ctx, x + 50, y + 28, 2.2, teal, g);
    } else if (v === 4) {
      ctx.path('M' + (x + 1) + ',' + (y + 44) + ' L' + (x + 30) + ',' + (y + 30) + ' L' + (x + 55) + ',' + (y + 38) + ' L' + (x + 99) + ',' + (y + 24), { stroke: 'violet', sw: 2, parent: g, glow: true });
      fox(ctx, x + 36, y + 40, 0.9, teal, g);
    } else {
      ctx.text(x + 50, y + 29, 'VEGA', { size: 15, font: 'display', weight: 700, anchor: 'middle', color: 'white', parent: g, spacing: 4 });
    }
    return g;
  }

  Atlas.register({
    id: 'multi-agent',
    refs: [
      'Anthropic Engineering, <i>How we built our multi-agent research system</i>, June 2025',
      'Cognition (W. Yan), <i>Don\'t Build Multi-Agents</i>, June 2025',
      'Cemri et al., <i>Why Do Multi-Agent LLM Systems Fail?</i> (MAST taxonomy), arXiv 2503.13657, 2025',
      'Google / Linux Foundation, <i>Agent2Agent (A2A) Protocol Specification</i> v0.3, 2025',
      'Du et al., <i>Improving Factuality and Reasoning in Language Models through Multiagent Debate</i>, ICML 2024',
      'Hong et al., <i>MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework</i>, ICLR 2024',
      'Wu et al., <i>AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation</i>, COLM 2024',
      'Zheng et al., <i>Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena</i>, NeurIPS 2023'
    ],
    steps: [
      /* 1 ------------------------------------------------------------------ */
      {
        title: 'The film crew',
        say: 'Zoom into the crew. The director agent is a supervisor: it reads the brief, writes a plan and a budget, and delegates. Around it sit narrow specialists. A writer drafts the beats, a storyboard agent designs the shots, a cinematographer turns each shot into a precise prompt for the video model, a sound designer handles voice and music, an editor owns the timeline, and a critic, a vision language model, judges every clip. Each specialist has its own tools, and they all share one artifact store.',
        deep: '<p>Each agent is <b>a system prompt + a tool subset + a model tier + a budget</b>, wired together with typed (JSON-Schema) interfaces. Narrow roles make each agent easier to evaluate, cheaper to run and safer to give tools to.</p>' +
          '<table><tr><th>Agent (model)</th><th>Tools</th><th>Output</th></tr>' +
          '<tr><td>Director (frontier reasoner)</td><td>spawn, join, budget</td><td><code>plan.json</code></td></tr>' +
          '<tr><td>Writer (mid-tier LLM)</td><td>read bible</td><td><code>script.md</code></td></tr>' +
          '<tr><td>Storyboard (LLM + image)</td><td>gen_image, refs</td><td><code>board.json</code></td></tr>' +
          '<tr><td>Cinematographer (LLM)</td><td>render_shot</td><td>shot URIs</td></tr>' +
          '<tr><td>Sound (LLM + TTS/V2A)</td><td>tts, music, foley</td><td>stems</td></tr>' +
          '<tr><td>Editor (LLM + compositor)</td><td>EDL → ffmpeg</td><td><code>cut.mp4</code></td></tr>' +
          '<tr><td>Critic (VLM)</td><td>frames, embed, score</td><td><code>verdict</code></td></tr></table>' +
          '<div class="note">The supervisor never renders anything itself: it plans, dispatches, joins and enforces budgets (tokens, GPU-seconds, retries). That keeps its own context small and its decisions auditable.</div>',
        run: function (ctx) {
          var S = ctx.state;
          S.crew = ctx.group();
          S.brief = ctx.code({ x: 1010, y: 84, w: 540, title: 'user.request', lang: 'text', typing: true, size: 13, maxLines: 2, color: 'cyan', parent: S.crew, lines: [
            '"30 s trailer: a fox astronaut crash-lands on',
            ' a glowing ice moon" + 3 sketches + voice memo'
          ] });
          ctx.reveal(S.brief, { from: 'down', dur: 450 });
          S.dir = ctx.node({ x: 800, y: 255, w: 300, h: 84, title: 'Director', sub: 'supervisor · plan · budget', icon: 'agent', color: 'magenta', titleSize: 19, parent: S.crew });
          ctx.reveal(S.dir, { from: 'scale', delay: 200 });
          S.bl = ctx.link({ x: 1010, y: 130 }, S.dir, { to: 'r', color: 'cyan', parent: S.crew });
          ctx.reveal(S.bl, { from: 'draw', delay: 500 });
          S.store = ctx.node({ x: 800, y: 705, w: 440, h: 96, kind: 'cyl', title: 'Artifact Store', sub: 'blackboard · URIs · production bible', icon: 'db', color: 'teal', parent: S.crew });
          S.agG = []; S.ag = []; S.dl = []; S.sl = [];
          AG.forEach(function (a, i) {
            var g = ctx.group({ parent: S.crew });
            var n = ctx.node({ x: AX[i], y: 470, w: 230, h: 84, title: a.t, sub: a.s, icon: a.ic, color: i === 5 ? 'violet' : 'magenta', titleSize: 15, subSize: 11, parent: g });
            ctx.label(AX[i], 548, a.tool, { color: a.tc, size: 12, parent: g });
            S.agG.push(g); S.ag.push(n);
            S.dl.push(ctx.link(S.dir, n, { from: 'b', to: 't', color: ctx.alpha('magenta', 0.75), parent: S.crew }));
            S.sl.push(ctx.link({ x: AX[i], y: 562 }, { x: 800 + (i - 2.5) * 62, y: 662 }, { from: 'b', to: 't', color: ctx.alpha('teal', 0.55), dash: '3 5', arrow: false, parent: S.crew }));
          });
          ctx.reveal(S.agG, { from: 'up', delay: 900, stagger: 110 });
          ctx.reveal(S.dl, { from: 'draw', delay: 900, stagger: 110 });
          ctx.reveal(S.store, { from: 'up', delay: 1500 });
          ctx.reveal(S.sl, { from: 'draw', delay: 1700, stagger: 60 });
          S.caption = ctx.text(800, 805, 'supervisor (orchestrator–worker): one planner, six typed specialists, one shared store', { size: 14, font: 'mono', color: 'dim', anchor: 'middle', parent: S.crew });
          ctx.reveal(S.caption, { delay: 2000 });
          return S.brief.typeAll().then(function () {
            return ctx.packet(S.bl, { color: 'cyan', dur: 700, label: 'brief' });
          }).then(function () {
            ctx.pulse(S.dir, { color: 'magenta' });
            return ctx.wait(700);
          }).then(function () {
            return Promise.all(S.dl.map(function (l, i) { return ctx.packet(l, { color: 'magenta', dur: 900, label: AG[i].pk }); }));
          });
        }
      },
      /* 2 ------------------------------------------------------------------ */
      {
        title: 'Topologies',
        say: 'There is more than one way to wire a crew. In a supervisor topology, one orchestrator delegates and joins. Hierarchies add middle managers, so a lead can own a batch of workers. Handoffs pass control itself from agent to agent, like a relay baton. A blackboard lets agents coordinate only through shared state. And debate pits proposers against each other in front of a judge. Our trailer mixes three of them: a supervisor, a blackboard, and a critic loop.',
        deep: '<table><tr><th>Topology</th><th>Control</th><th>Parallelism</th><th>Context flow</th></tr>' +
          '<tr><td>Supervisor</td><td>central LLM</td><td>fan-out / join</td><td>brief down, summary up</td></tr>' +
          '<tr><td>Hierarchical</td><td>tree of leads</td><td>high (per subtree)</td><td>compressed per level</td></tr>' +
          '<tr><td>Handoff (swarm)</td><td>baton passes</td><td>none (one active)</td><td>full history travels</td></tr>' +
          '<tr><td>Blackboard</td><td>data-driven</td><td>asynchronous</td><td>via shared artifacts</td></tr>' +
          '<tr><td>Debate / critique</td><td>judge</td><td>proposers in parallel</td><td>arguments exchanged</td></tr></table>' +
          '<p>Frameworks map onto these: LangGraph supervisor graphs, OpenAI Agents SDK <i>handoffs</i>, AutoGen group chat, MetaGPT SOP pipelines. The blackboard idea dates to Hearsay-II (1980).</p>' +
          '<p>Debate (Du et al., 2024): <i>n</i> agents × <i>r</i> rounds costs ≈ <i>n·r</i> generations and improves factuality/maths; in media pipelines the cheaper variant is <b>generate → critique → targeted redo</b>.</p>' +
          '<div class="note">Latency of a supervisor is the critical path through the DAG plus one LLM hop per join; a handoff chain is the <i>sum</i> of all turns.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.fade(S.crew, 0, 500);
          S.topo = ctx.group();
          S.topoStreams = [];
          var cards = [
            { t: 'Supervisor', s: 'orchestrator–worker', used: 'director → 6 specialists',
              p: ['+ simple control, bounded cost', '+ parallel fan-out + join', '− hub context is a bottleneck', '− every join costs an LLM hop'] },
            { t: 'Hierarchical', s: 'tree of leads', used: 'director → shot lead → ×6',
              p: ['+ scales to dozens of workers', '+ leads compress results up', '− latency + loss per level', '− errors compound across tiers'] },
            { t: 'Handoff', s: 'swarm · baton passing', used: 'intake → director only',
              p: ['+ no central hop, agent owns turn', '+ natural for triage / routing', '− serial; can ping-pong', '− full context must travel'] },
            { t: 'Blackboard', s: 'shared artifact state', used: 'artifact store + bible',
              p: ['+ agents decoupled by data', '+ async, resumable, auditable', '− needs schemas + versions', '− write conflicts on shared docs'] },
            { t: 'Debate / critique', s: 'proposers + judge', used: 'critic ↔ cinematographer',
              p: ['+ independent check finds errors', '+ judge decides with evidence', '− 2–3× tokens per decision', '− judges share model biases'] }
          ];
          var cardEls = [];
          cards.forEach(function (c, i) {
            var x = 36 + i * 309, y = 172, w = 295, cx = x + w / 2;
            var g = ctx.group({ parent: S.topo });
            panel(ctx, x, y, w, 530, 'magenta', g);
            ctx.text(x + 16, y + 28, c.t, { size: 18, font: 'display', weight: 700, color: 'white', parent: g });
            ctx.text(x + 16, y + 52, c.s, { size: 12, font: 'mono', color: 'dim', parent: g });
            var gg = ctx.group({ parent: g });
            function dot(px, py, lab, col) {
              ctx.circle(px, py, 17, { fill: ctx.alpha(col, 0.16), stroke: col, sw: 1.5, parent: gg });
              ctx.text(px, py + 0.5, lab, { size: 11, font: 'mono', weight: 600, anchor: 'middle', color: 'white', parent: gg });
              return { x: px, y: py };
            }
            function edge(a, b, col, back) {
              var dx = b.x - a.x, dy = b.y - a.y, L = Math.sqrt(dx * dx + dy * dy), ux = dx / L, uy = dy / L;
              var p = ctx.path('M' + (a.x + ux * 19) + ',' + (a.y + uy * 19) + ' L' + (b.x - ux * 19) + ',' + (b.y - uy * 19), { stroke: ctx.alpha(col, 0.55), sw: 1.4, parent: gg });
              S.topoStreams.push(ctx.stream(p, { color: col, count: 1, period: 1800 + (S.topoStreams.length % 5) * 170, r: 3 }));
              if (back) S.topoStreams.push(ctx.stream(p, { color: 'teal', count: 1, period: 2300, r: 2.6, reverse: true }));
              return p;
            }
            var M = 'magenta';
            if (i === 0) {
              var hub = dot(cx, y + 115, 'Dir', M);
              [-105, -35, 35, 105].forEach(function (dx, k) { edge(hub, dot(cx + dx, y + 265, ['W', 'SB', 'C', 'Ed'][k], M), M, true); });
            } else if (i === 1) {
              var root = dot(cx, y + 100, 'Dir', M), l1 = dot(cx - 70, y + 185, 'Vis', M), l2 = dot(cx + 70, y + 185, 'Aud', 'orange');
              edge(root, l1, M); edge(root, l2, M);
              edge(l1, dot(cx - 110, y + 280, 'S1', 'lime'), M, true); edge(l1, dot(cx - 38, y + 280, 'S2', 'lime'), M, true);
              edge(l2, dot(cx + 38, y + 280, 'VO', 'orange'), 'orange', true); edge(l2, dot(cx + 110, y + 280, 'Mx', 'orange'), 'orange', true);
            } else if (i === 2) {
              var pts = [[cx, y + 105, 'In'], [cx + 95, y + 195, 'Dir'], [cx, y + 285, 'Wr'], [cx - 95, y + 195, 'Ed']];
              pts.forEach(function (p) { dot(p[0], p[1], p[2], M); });
              var ring = ctx.path('M' + cx + ',' + (y + 105) + ' L' + (cx + 95) + ',' + (y + 195) + ' L' + cx + ',' + (y + 285) + ' L' + (cx - 95) + ',' + (y + 195) + ' Z', { stroke: ctx.alpha(M, 0.45), sw: 1.4, dash: '4 5', parent: gg });
              gg.insertBefore(ring, gg.firstChild);
              S.topoStreams.push(ctx.stream(ring, { color: 'amber', count: 1, period: 4200, r: 6 }));
              ctx.text(cx, y + 195, 'baton', { size: 11, font: 'mono', color: 'amber', anchor: 'middle', parent: gg });
            } else if (i === 3) {
              ctx.rect(cx - 62, y + 160, 124, 70, { rx: 8, fill: ctx.alpha('teal', 0.12), stroke: 'teal', parent: gg });
              ctx.text(cx, y + 186, 'artifacts', { size: 12, font: 'mono', color: 'teal', anchor: 'middle', parent: gg });
              ctx.text(cx, y + 206, 'bible · clips', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: gg });
              [[-105, 100, 'W'], [105, 100, 'SB'], [-105, 292, 'C'], [105, 292, 'Ed']].forEach(function (d) {
                var a = dot(cx + d[0], y + d[1], d[2], M);
                var tgt = { x: cx + (d[0] < 0 ? -62 : 62), y: y + (d[1] < 200 ? 160 : 230) };
                var p = ctx.path('M' + (a.x + (d[0] < 0 ? 14 : -14)) + ',' + (a.y + (d[1] < 200 ? 12 : -12)) + ' L' + tgt.x + ',' + tgt.y, { stroke: ctx.alpha('teal', 0.5), sw: 1.4, parent: gg });
                S.topoStreams.push(ctx.stream(p, { color: 'teal', count: 1, period: 2000 + d[0] * 3, r: 3 }));
                S.topoStreams.push(ctx.stream(p, { color: 'magenta', count: 1, period: 2600, r: 2.6, reverse: true }));
              });
            } else {
              var jd = dot(cx, y + 105, 'Judge', 'violet'), A = dot(cx - 85, y + 270, 'A', M), B = dot(cx + 85, y + 270, 'B', M);
              var ab = ctx.path('M' + (cx - 67) + ',' + (y + 262) + ' Q' + cx + ',' + (y + 215) + ' ' + (cx + 67) + ',' + (y + 262), { stroke: ctx.alpha(M, 0.5), sw: 1.4, parent: gg });
              var ba = ctx.path('M' + (cx + 67) + ',' + (y + 280) + ' Q' + cx + ',' + (y + 325) + ' ' + (cx - 67) + ',' + (y + 280), { stroke: ctx.alpha(M, 0.5), sw: 1.4, parent: gg });
              S.topoStreams.push(ctx.stream(ab, { color: M, count: 1, period: 2000, r: 3 }));
              S.topoStreams.push(ctx.stream(ba, { color: 'amber', count: 1, period: 2000, r: 3 }));
              edge(A, jd, 'violet'); edge(B, jd, 'violet');
            }
            c.p.forEach(function (line, k) {
              ctx.text(x + 18, y + 355 + k * 25, line, { size: 13, color: line.charAt(0) === '+' ? '#a9f58a' : '#ff9aad', parent: g });
            });
            ctx.line(x + 16, y + 468, x + w - 16, y + 468, { color: 'line', sw: 1, parent: g });
            ctx.text(x + 18, y + 492, 'in the trailer:', { size: 11, font: 'mono', color: 'dim', parent: g });
            ctx.text(x + 18, y + 512, c.used, { size: 12, font: 'mono', color: 'magenta', parent: g });
            cardEls.push(g);
          });
          S.topoCap = ctx.group({ parent: S.topo });
          ctx.text(800, 748, 'Our trailer composes three of these:', { size: 15, color: 'white', anchor: 'middle', parent: S.topoCap });
          ctx.text(800, 778, 'supervisor (director → specialists)  +  blackboard (artifact store + bible)  +  critique loop (critic ↔ cinematographer)', { size: 14, font: 'mono', color: 'magenta', anchor: 'middle', parent: S.topoCap });
          ctx.text(800, 806, 'latency: supervisor ≈ critical path of the DAG + one LLM hop per join; a handoff chain ≈ the sum of every turn', { size: 12.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.topoCap });
          ctx.reveal(S.topoCap, { from: 'up', delay: 1400 });
          return ctx.reveal(cardEls, { from: 'up', delay: 300, stagger: 180, dur: 600 }).then(function () { return ctx.wait(1500); });
        }
      },
      /* 3 ------------------------------------------------------------------ */
      {
        title: 'Pass references',
        say: 'Agents never pass pixels to each other. When the cinematographer finishes shot three, the six megabyte clip goes straight into object storage, and only a reference travels onward: a URI, a content hash, a duration and a one line summary, about ninety tokens. Pasting the same clip into context as base64 would cost millions of tokens, and even as sampled video frames it costs tens of thousands, paid again on every turn. Agents that really need to look, like the critic, fetch and encode the frames themselves.',
        deep: '<p><b>Rule: context carries pointers; the store carries bytes.</b> Visual input cost per turn:</p>' +
          '<div class="eq">C<sub>vis</sub> = f<sub>s</sub> · T · t<sub>frame</sub> &nbsp;⇒&nbsp; 24 fps · 5 s · 258 = 30,960 tokens</div>' +
          '<p>(258 tokens/frame is Gemini’s default per-frame rate; 1 fps sampling gives 1,290.) As base64 text a 6&nbsp;MB H.264 clip (≈10&nbsp;Mb/s × 5&nbsp;s) is 8&nbsp;MB of characters; base64 tokenizes at only ~2–3 chars/token, i.e. ~3 M tokens — beyond any context window. The <code>artifact_ref</code> JSON on the right is ~90 tokens (URIs and hashes tokenize poorly). Worse, an agent loop re-sends its context every turn, so prompt cost grows ≈ Σ<sub>turns</sub>|context| unless prefix-cached.</p>' +
          '<ul><li><b>Content-addressed</b>: <code>sha256</code> gives dedup + integrity; versions are immutable (<code>v1</code>, <code>v2</code>) so the critic can diff.</li>' +
          '<li><b>Scoped access</b>: agents receive short-TTL pre-signed GETs, never bucket credentials.</li>' +
          '<li><b>Previews</b>: a summary + keyframe thumbnail let an LLM reason about a clip for ~100 tokens; only the critic pays for dense frames.</li>' +
          '<li>Workflow engines enforce this too: Temporal payloads are capped (~2&nbsp;MB), so results must be references.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          S.topoStreams.forEach(function (h) { h.stop(); });
          ctx.remove(S.topo, 400);
          ctx.fade(S.crew, 1, 500);
          ctx.fade(S.brief, 0, 400);
          ctx.fade(S.bl, 0, 400);
          [0, 1, 3, 5].forEach(function (i) { ctx.fade([S.agG[i], S.dl[i], S.sl[i]], 0.2, 500); });
          S.refG = ctx.group();
          /* log-scale token cost bars */
          var bars = ctx.group({ parent: S.refG });
          panel(ctx, 36, 165, 590, 235, 'teal', bars);
          head(ctx, 56, 190, 'TOKENS TO PUT ONE 5 s CLIP IN CONTEXT', 'teal', bars);
          ctx.text(606, 190, 'log scale', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: bars });
          var rows = [['base64 bytes in JSON', 3.0e6, 'red', '~3,000,000'], ['frames @24 fps × 258', 30960, 'amber', '30,960'], ['frames @1 fps × 258', 1290, 'violet', '1,290'], ['artifact_ref (JSON)', 90, 'teal', '~90']];
          S.refBars = [];
          rows.forEach(function (r, k) {
            var y = 228 + k * 42;
            ctx.text(56, y, r[0], { size: 13, color: 'text', parent: bars });
            var w = 250 * Math.log(r[1]) / Math.log(3.0e6);
            var b = ctx.rect(250, y - 11, w, 22, { rx: 4, fill: ctx.alpha(r[2], 0.45), stroke: r[2], sw: 1, parent: bars });
            b.setAttribute('data-w', w);
            ctx.text(250 + w + 8, y, r[3], { size: 12, font: 'mono', color: r[2], parent: bars });
            S.refBars.push(b);
          });
          ctx.reveal(bars, { from: 'left', delay: 300 });
          S.refBars.forEach(function (b, k) { var w = +b.getAttribute('data-w'); ctx.animate(b, { width: [0, w] }, 700, 'out', 500 + k * 180); });
          S.refJson = ctx.code({ x: 1000, y: 165, w: 560, title: 'artifact_ref · what actually travels', lang: 'json', size: 13, color: 'teal', typing: true, maxLines: 8, parent: S.refG, lines: nb([
            '{"type": "artifact_ref",',
            ' "uri": "s3://atlas/job-7f3/shot03/v1.mp4",',
            ' "sha256": "9f2c41d0…e41a",',
            ' "mime": "video/mp4", "dur_s": 5.0,',
            ' "thumb": "s3://atlas/job-7f3/shot03/v1_kf.jpg",',
            ' "summary": "fox exits pod, low angle, rim light",',
            ' "producer": "cinematographer#3"}'
          ]) });
          ctx.reveal(S.refJson, { from: 'right', delay: 200 });
          return ctx.wait(700).then(function () {
            return ctx.packet(S.sl[2], { color: 'lime', r: 9, dur: 1100, label: 'shot03.mp4 · 6 MB' });
          }).then(function () {
            ctx.pulse(S.store, { color: 'teal' });
            return S.refJson.typeAll();
          }).then(function () {
            return ctx.packet(S.dl[2], { color: 'teal', r: 4, dur: 800, reverse: true, label: 'ref' });
          }).then(function () {
            return ctx.packet(S.dl[4], { color: 'teal', r: 4, dur: 800, label: 'ref · ~90 tok' });
          }).then(function () {
            return ctx.packet(S.sl[4], { color: 'lime', r: 7, dur: 900, reverse: true, label: 'GET pre-signed' });
          });
        }
      },
      /* 4 ------------------------------------------------------------------ */
      {
        title: 'Production bible',
        say: 'Consistency across six independently rendered shots is the hardest part of AI film. The fix is a shared production bible: a character sheet for the fox, a style guide, a color palette, and reference embeddings from the creator\'s sketches. Every shot worker starts with exactly the same bible as the prefix of its context, so the serving engine can reuse the cached prefix. The first request writes the cache, and the next five read it at a fraction of the cost and latency.',
        deep: '<p>The bible is one immutable, versioned artifact (<code>bible/v3</code>) consumed two ways:</p>' +
          '<ul><li><b>By LLM agents</b> as a byte-identical <i>prompt prefix</i>. Serving engines reuse its KV cache: vLLM hashes 16-token blocks (automatic prefix caching), SGLang keeps a radix tree (RadixAttention). Any byte change before a block invalidates everything after it, so volatile content (shot brief, tool results) goes <i>after</i> the prefix.</li>' +
          '<li><b>By the video model</b> as conditioning: reference images of the character (subject/identity conditioning), palette and style tokens in every prompt, a fixed negative prompt.</li></ul>' +
          '<p>Cost with Anthropic-style pricing (cache write 1.25×, cache read 0.1× the input price) for a prefix of P = 3.1k tokens across 6 workers:</p>' +
          '<div class="eq">1.25P + 5 · 0.1P = 1.75P &nbsp;vs&nbsp; 6P &nbsp;⇒&nbsp; −71% prefix cost</div>' +
          '<p>Cached prefixes also cut time-to-first-token, because prefill of those blocks is skipped. Other providers discount cached input by roughly 50–90%.</p>' +
          '<p><b>Fan-out gotcha</b>: a provider-side cache entry is usable only once the first request has written it. Six requests fired in the same instant can all miss (six writes). Send worker 1 first (or a 1-token warm-up call), then fan out — the stagger in the animation. Self-hosted engines with a shared radix/prefix cache behave the same way within one replica, so route all six to the same replica (prefix-aware load balancing).</p>' +
          '<div class="note">Consistency is also verified, not just requested: the critic compares every clip against the same sheet (next steps).</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.remove(S.refG, 400);
          ctx.fade([S.agG[4], S.dl[4], S.sl[4]], 0.2, 400);
          S.bib = ctx.group();
          var bx = 990, by = 160;
          panel(ctx, bx, by, 570, 262, 'teal', S.bib);
          head(ctx, bx + 18, by + 24, 'production_bible.md · v3', 'teal', S.bib);
          ctx.text(bx + 552, by + 24, 'sha256 7e1a…', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.bib });
          var L = [['CHARACTER', 'Vega: red fox, amber eyes, white EVA suit'], ['', 'teal visor, mission patch ARGO-7 (left arm)'], ['STYLE', '2.39:1 anamorphic · 24 fps · fine grain'], ['LIGHT', 'cold 7000K key, teal rim, orange wreck fire'], ['NEGATIVE', 'no text, no extra limbs, no lens warp']];
          L.forEach(function (l, k) {
            ctx.text(bx + 18, by + 56 + k * 24, l[0], { size: 12, font: 'mono', color: 'magenta', parent: S.bib });
            ctx.text(bx + 120, by + 56 + k * 24, l[1], { size: 13, color: 'text', parent: S.bib });
          });
          var pal = [['#ff8a3d', 'fur'], ['#e8eef5', 'suit'], ['#2bf5c4', 'visor'], ['#7fd6ff', 'ice'], ['#9b7bff', 'glow']];
          S.sw = pal.map(function (p, k) {
            var g = ctx.group({ parent: S.bib });
            ctx.rect(bx + 18 + k * 58, by + 186, 46, 30, { rx: 4, fill: p[0], parent: g });
            ctx.text(bx + 41 + k * 58, by + 232, p[1], { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
            return g;
          });
          ctx.text(bx + 330, by + 196, 'refs: 3 sketches', { size: 12, font: 'mono', color: 'violet', parent: S.bib });
          ctx.text(bx + 330, by + 216, '→ SigLIP emb ×3', { size: 12, font: 'mono', color: 'violet', parent: S.bib });
          [0, 1, 2].forEach(function (k) { ctx.icon('image', bx + 478 + k * 30, by + 206, 24, 'violet', { parent: S.bib }); });
          ctx.reveal(S.bib, { from: 'right', dur: 500 });
          ctx.reveal(S.sw, { from: 'scale', delay: 500, stagger: 90 });
          /* context bars */
          S.ctxG = ctx.group();
          panel(ctx, 36, 160, 590, 262, 'magenta', S.ctxG);
          head(ctx, 56, 184, 'SHOT-WORKER CONTEXTS · SHARED PREFIX', 'magenta', S.ctxG);
          var x0 = 110, pw = 330, sw = 46;
          S.pre = []; S.suf = []; S.tags = [];
          for (var i = 0; i < 6; i++) {
            var y = 212 + i * 32;
            ctx.text(56, y, 'S' + (i + 1), { size: 13, font: 'mono', color: 'text', parent: S.ctxG });
            var p = ctx.rect(x0, y - 10, 0, 20, { rx: 3, fill: ctx.alpha('teal', 0.45), stroke: 'teal', sw: 1, parent: S.ctxG });
            var s = ctx.rect(x0 + pw + 2, y - 10, 0, 20, { rx: 3, fill: ctx.alpha('magenta', 0.45), stroke: 'magenta', sw: 1, parent: S.ctxG });
            var tg = ctx.label(x0 + pw + sw + 44, y, i === 0 ? 'WRITE' : 'HIT', { color: i === 0 ? 'amber' : 'lime', size: 11, w: 58 });
            S.ctxG.appendChild(tg);
            tg.setAttribute('opacity', 0);
            S.pre.push(p); S.suf.push(s); S.tags.push(tg);
          }
          ctx.text(x0 + pw / 2, 406, 'bible prefix 3.1k tok', { size: 11, font: 'mono', color: 'teal', anchor: 'middle', parent: S.ctxG });
          ctx.text(x0 + pw + 26, 406, 'brief 0.4k', { size: 11, font: 'mono', color: 'magenta', anchor: 'middle', parent: S.ctxG });
          ctx.reveal(S.ctxG, { from: 'left', delay: 200 });
          ctx.hud('prefix cost 1.75P vs 6P  (−71%)');
          return ctx.wait(900).then(function () {
            var ps = [];
            for (var k = 0; k < 6; k++) {
              (function (k) {
                var path = ctx.path('M990,' + (by + 240) + ' L' + (x0 + pw) + ',' + (212 + k * 32), { parent: S.ctxG });
                ps.push(ctx.wait(k * 220).then(function () {
                  return ctx.packet(path, { color: 'teal', r: 4, dur: 650 });
                }).then(function () {
                  return ctx.animate(S.pre[k], { width: [0, pw] }, 450, 'out');
                }).then(function () {
                  ctx.animate(S.suf[k], { width: [0, sw] }, 300, 'out');
                  return ctx.fade(S.tags[k], 1, 250);
                }));
              })(k);
            }
            return Promise.all(ps);
          });
        }
      },
      /* 5 ------------------------------------------------------------------ */
      {
        title: 'Parallel fan-out',
        say: 'Now the director fans out. Six shot workers start at once, each with a fresh context that holds only the bible and its own shot brief. Each worker calls the video model, and six renders proceed in parallel on the GPU pool. The director simply awaits all of them, a join barrier. Run one after another, the six shots would take about nine minutes of wall clock. In parallel, the batch finishes when the slowest shot does, in under two minutes.',
        deep: '<p>Fan-out / fan-in with a concurrency cap derived from the GPU quota:</p>' +
          '<pre>async def film(board, bible_ref):\n  sem = Semaphore(gpu_quota // 8)\n  async def shoot(s):      # 8 GPUs/shot\n    async with sem:\n      return await spawn(\n        "cinematographer", brief=s,\n        prefix=bible_ref,\n        budget=Budget(tok=40e3, redo=2))\n  return await gather(\n    *[shoot(s) for s in board.shots])</pre>' +
          '<div class="eq">T<sub>serial</sub> = Σ<sub>i</sub> T<sub>i</sub> = 532 s &nbsp;&nbsp; T<sub>par</sub> = max<sub>i</sub> T<sub>i</sub> + ε ≈ 101 s &nbsp;⇒ 5.3×</div>' +
          '<ul><li><b>Stragglers</b> set the makespan: E[max of n] grows with n, so tail latency of the video pool matters more than its mean.</li>' +
          '<li><b>Fresh context</b> per worker (≈3.5k tokens) instead of one agent carrying all six shots’ history.</li>' +
          '<li>Workers return <i>references + a short report</i>, never transcripts; the director’s context grows by ~150 tokens per shot.</li>' +
          '<li>Each spawn is a durable activity, so a crashed worker is retried without re-running the other five.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.bib, 400); ctx.remove(S.ctxG, 400);
          ctx.fade(S.crew, 0, 500);
          S.fan = ctx.group();
          S.fDir = ctx.node({ x: 150, y: 450, w: 200, h: 76, title: 'Director', sub: 'fan-out · join', icon: 'agent', color: 'magenta', parent: S.fan });
          S.join = ctx.node({ x: 1440, y: 440, w: 200, h: 72, title: 'join()', sub: 'barrier · 6 of 6', icon: 'check', color: 'magenta', parent: S.fan });
          S.wk = []; S.fl = []; S.lanes = []; S.th = []; S.jl = [];
          S.laneG = ctx.group({ parent: S.fan });
          var X0 = 580, LW = 560, TMAX = 110;
          [0, 30, 60, 90].forEach(function (t) {
            var x = X0 + LW * t / TMAX;
            ctx.line(x, 186, x, 700, { color: 'faint', sw: 1, dash: '2 6', parent: S.laneG });
            ctx.text(x, 174, t + ' s', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.laneG });
          });
          for (var i = 0; i < 6; i++) {
            var y = 215 + i * 90;
            var w = ctx.node({ x: 440, y: y, w: 200, h: 60, title: 'Shot ' + (i + 1), sub: SHOTS[i], icon: 'film', color: 'lime', titleSize: 14, subSize: 11, parent: S.fan });
            S.wk.push(w);
            S.fl.push(ctx.link(S.fDir, w, { from: 'r', to: 'l', color: ctx.alpha('magenta', 0.7), parent: S.fan }));
            ctx.rect(X0, y - 8, LW, 16, { rx: 4, fill: 'rgba(255,255,255,0.03)', stroke: 'line', sw: 1, parent: S.laneG });
            var bar = ctx.rect(X0, y - 8, 0, 16, { rx: 4, fill: ctx.alpha('lime', 0.55), stroke: 'lime', sw: 1, parent: S.laneG });
            bar.setAttribute('data-w', LW * DUR[i] / TMAX);
            var tl = ctx.text(X0 + LW * DUR[i] / TMAX, y - 20, DUR[i] + ' s', { size: 11, font: 'mono', color: 'lime', anchor: 'end', parent: S.laneG, opacity: 0 });
            S.lanes.push([bar, tl]);
            var th = thumb(ctx, 1170, y - 28, i, S.fan, i === 2);
            th.setAttribute('opacity', 0);
            S.th.push(th);
            S.jl.push(ctx.link({ x: 1270, y: y }, S.join, { to: 'l', color: ctx.alpha('lime', 0.5), sw: 1.4, parent: S.fan }));
          }
          S.jl.forEach(function (l) { l.setAttribute('opacity', 0); });
          ctx.reveal([S.fDir, S.join], { from: 'scale' });
          ctx.reveal(S.wk, { from: 'left', delay: 200, stagger: 80 });
          ctx.reveal(S.fl, { from: 'draw', delay: 300, stagger: 60 });
          ctx.reveal(S.laneG, { delay: 400 });
          /* serial vs parallel comparison */
          S.cmpG = ctx.group({ parent: S.fan });
          ctx.text(X0 - 12, 752, 'one agent, serial', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.cmpG });
          ctx.text(X0 - 12, 790, 'fan-out ×6', { size: 12, font: 'mono', color: 'dim', anchor: 'end', parent: S.cmpG });
          var serW = 560, parW = 560 * 101 / 532;
          S.serBar = ctx.rect(X0, 742, 0, 20, { rx: 4, fill: ctx.alpha('red', 0.4), stroke: 'red', sw: 1, parent: S.cmpG });
          S.parBar = ctx.rect(X0, 780, 0, 20, { rx: 4, fill: ctx.alpha('lime', 0.5), stroke: 'lime', sw: 1, parent: S.cmpG });
          S.serT = ctx.text(X0 + serW + 10, 752, '532 s', { size: 13, font: 'mono', color: 'red', parent: S.cmpG, opacity: 0 });
          S.parT = ctx.text(X0 + parW + 10, 790, '101 s  (5.3× faster)', { size: 13, font: 'mono', color: 'lime', parent: S.cmpG, opacity: 0 });
          return ctx.wait(900).then(function () {
            return Promise.all(S.fl.map(function (l, i) { return ctx.packet(l, { color: 'magenta', dur: 700, label: i === 0 ? 'brief + bible_ref' : null }); }));
          }).then(function () {
            return Promise.all(S.lanes.map(function (ln, i) {
              var w = +ln[0].getAttribute('data-w');
              return ctx.animate(ln[0], { width: [0, w] }, 3200 * DUR[i] / 101, 'linear').then(function () {
                ctx.fade(ln[1], 1, 200);
                return ctx.reveal(S.th[i], { from: 'scale', dur: 400 });
              });
            }));
          }).then(function () {
            S.jl.forEach(function (l) { l.setAttribute('opacity', 1); });
            ctx.reveal(S.jl, { from: 'draw', dur: 400 });
            return Promise.all(S.jl.map(function (l) { return ctx.packet(l, { color: 'lime', dur: 600 }); }));
          }).then(function () {
            ctx.pulse(S.join, { color: 'magenta' });
            ctx.animate(S.serBar, { width: [0, serW] }, 900, 'out');
            ctx.animate(S.parBar, { width: [0, parW] }, 500, 'out', 200);
            ctx.fade(S.serT, 1, 300); ctx.fade(S.parT, 1, 300);
            ctx.hud('makespan: max(Tᵢ) = 101 s  vs  ΣTᵢ = 532 s');
            return ctx.wait(900);
          });
        }
      },
      /* 6 ------------------------------------------------------------------ */
      {
        title: 'Critic & re-render',
        say: 'When the batch joins, the critic scores every shot against a rubric: prompt adherence, character identity, motion, physics, continuity and aesthetics. Shot three fails. The fox\'s visor came out amber instead of teal, and the mission patch is missing, so identity scores only point four one. The critic returns structured feedback, not prose, and the director re-renders only shot three, with the character sheet attached as a reference. Version two passes, and the five good shots are never touched.',
        deep: '<p>Weighted rubric score per shot, gate at τ:</p>' +
          '<div class="eq">s = Σ<sub>k</sub> w<sub>k</sub> r<sub>k</sub>, &nbsp; w = (.20, .30, .15, .10, .15, .10), &nbsp; pass ⇔ s ≥ τ = 0.75</div>' +
          '<p>Shot 3 v1: s = 0.2·0.81 + 0.3·0.41 + 0.15·0.82 + 0.1·0.84 + 0.15·0.55 + 0.1·0.83 = <b>0.66</b> → reject. v2: <b>0.86</b> → pass.</p>' +
          '<ul><li><b>Identity</b> mixes a metric and a judge: cosine similarity of DINOv2/SigLIP embeddings of character crops vs the sheet, plus VLM yes/no checks (“is the visor teal?”, “is the ARGO-7 patch visible?”).</li>' +
          '<li><b>Motion / physics</b>: VBench-style dimensions (subject consistency, motion smoothness, dynamic degree) computed on sampled frames.</li>' +
          '<li><b>Judge hygiene</b>: LLM/VLM judges show position, verbosity and self-preference biases (Zheng et al.). Calibrate thresholds on human-labelled clips (report Spearman ρ), use pairwise v1-vs-v2 comparison for re-renders.</li>' +
          '<li><b>Budget</b>: max 2 targeted re-renders per shot, then escalate to the human. Here the redo costs 1/6 of the batch (≈17% extra GPU time) instead of 100%.</li></ul>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.laneG, 400);
          ctx.remove(S.cmpG, 400);
          S.crit = ctx.node({ x: 1440, y: 640, w: 200, h: 72, title: 'Critic', sub: 'VLM judge · rubric', icon: 'eye', color: 'violet', parent: S.fan });
          S.cl = ctx.link(S.join, S.crit, { from: 'b', to: 't', color: 'violet', parent: S.fan });
          ctx.reveal(S.crit, { from: 'scale', delay: 200 });
          ctx.reveal(S.cl, { from: 'draw', delay: 350 });
          S.rub = ctx.group({ parent: S.fan });
          var CX = 585, CW = 72, CS = 80;
          RUB.concat(['score']).forEach(function (h, c) {
            ctx.text(CX + c * CS + CW / 2, 176, h, { size: 12, font: 'mono', color: c === 6 ? 'white' : 'dim', anchor: 'middle', parent: S.rub, weight: c === 6 ? 600 : 400 });
          });
          S.cells = [];
          for (var r = 0; r < 6; r++) {
            S.cells.push([]);
            var y = 215 + r * 90;
            for (var c = 0; c < 7; c++) {
              var v = c < 6 ? SC[r][c] : total(SC[r]);
              var g = ctx.group({ parent: S.rub });
              var rc = ctx.rect(CX + c * CS, y - 20, CW, 40, { rx: 6, fill: ctx.alpha(scoreCol(ctx, v), c === 6 ? 0.28 : 0.16), stroke: ctx.alpha(scoreCol(ctx, v), 0.8), sw: c === 6 ? 1.6 : 1, parent: g });
              var tx = ctx.text(CX + c * CS + CW / 2, y + 1, v.toFixed(2), { size: c === 6 ? 15 : 14, font: 'mono', weight: c === 6 ? 700 : 400, color: scoreCol(ctx, v), anchor: 'middle', parent: g });
              g.setAttribute('opacity', 0);
              S.cells[r].push({ g: g, rc: rc, tx: tx });
            }
          }
          ctx.text(CX + 6 * CS + CW / 2, 712, 'pass ≥ 0.75', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.rub });
          S.fb = ctx.code({ x: 36, y: 724, w: 540, title: 'verdict.json · critic → director', lang: 'json', size: 12, color: 'violet', typing: true, maxLines: 6, parent: S.fan, lines: nb([
            '{"shot": 3, "verdict": "reject", "score": 0.66,',
            ' "fail": ["identity 0.41: visor amber, bible=teal",',
            '          "continuity 0.55: ARGO-7 patch missing"],',
            ' "fix": {"ref_images": ["vega_sheet_v3"],',
            '         "prompt_delta": "+teal visor +ARGO-7 patch",',
            '         "keep_seed": false}}'
          ]) });
          ctx.reveal(S.fb, { from: 'up', delay: 200 });
          S.fbPath = ctx.path('M1440,676 Q1440,800 1300,800 L582,800', { stroke: ctx.alpha('violet', 0.6), sw: 1.6, dash: '5 5', arrow: true, parent: S.fan });
          S.fbPath.setAttribute('opacity', 0);
          return ctx.wait(700).then(function () {
            return ctx.packet(S.cl, { color: 'lime', dur: 500, label: '6 refs' });
          }).then(function () {
            ctx.pulse(S.crit, { color: 'violet' });
            return Promise.all(S.cells.map(function (row, r) {
              return Promise.all(row.map(function (cell, c) { return ctx.reveal(cell.g, { from: 'scale', dur: 280, delay: c * 110 + r * 40 }); }));
            }));
          }).then(function () {
            S.bad = ctx.highlight(S.cells[2][6].g, { color: 'red', pad: 5 });
            S.fan.appendChild(S.bad);
            S.badTh = ctx.highlight(S.th[2], { color: 'red', pad: 4, dash: '4 3' });
            S.fan.appendChild(S.badTh);
            ctx.pulse(S.th[2], { color: 'red', times: 2, dur: 500 });
            S.fbPath.setAttribute('opacity', 1);
            ctx.reveal(S.fbPath, { from: 'draw', dur: 700 });
            return ctx.packet(S.fbPath, { color: 'violet', dur: 1100, label: 'reject S3' });
          }).then(function () {
            return S.fb.typeAll();
          }).then(function () {
            return ctx.packet(S.fl[2], { color: 'magenta', dur: 700, label: 'redo S3 v2' });
          }).then(function () {
            ctx.pulse(S.wk[2], { color: 'lime', times: 2, dur: 600 });
            return ctx.wait(700);
          }).then(function () {
            ctx.remove(S.th[2], 300);
            ctx.remove(S.badTh, 300);
            S.th3b = thumb(ctx, 1170, 215 + 2 * 90 - 28, 2, S.fan, false);
            ctx.reveal(S.th3b, { from: 'scale', dur: 450 });
            return ctx.packet(S.jl[2], { color: 'lime', dur: 500, label: 'v2' });
          }).then(function () {
            return ctx.packet(S.cl, { color: 'lime', dur: 400 });
          }).then(function () {
            ctx.remove(S.bad, 300);
            var row = S.cells[2];
            return Promise.all(row.map(function (cell, c) {
              var v = c < 6 ? SC3B[c] : total(SC3B);
              var col = scoreCol(ctx, v);
              return ctx.wait(c * 90).then(function () {
                cell.tx.textContent = v.toFixed(2);
                cell.tx.setAttribute('fill', col);
                cell.rc.setAttribute('fill', ctx.alpha(col, c === 6 ? 0.28 : 0.16));
                cell.rc.setAttribute('stroke', ctx.alpha(col, 0.8));
                return ctx.pulse(cell.g, { color: col, dur: 500 });
              });
            }));
          }).then(function () {
            S.redoTag = ctx.label(1220, 350, 'v2 · was 0.66 ✕', { color: 'amber', size: 11, parent: S.fan });
            ctx.reveal(S.redoTag, { from: 'scale', dur: 350 });
            ctx.hud('re-render cost: 1 of 6 shots (≈17% GPU)');
            return ctx.wait(600);
          });
        }
      },
      /* 7 ------------------------------------------------------------------ */
      {
        title: 'Isolation vs cost',
        say: 'Why not one big agent? Isolation is the win: each sub-agent gets a fresh, focused context, works in parallel, and returns a compressed result. But it is not free. Anthropic reported that agents use about four times the tokens of a chat, and multi-agent systems about fifteen times. Context is lost at hand-off boundaries, and coordination itself fails in characteristic ways: agents ignore each other, withhold information, or stop before verifying. Use many agents for broad, parallel, read-heavy work, and a single thread for tightly coupled decisions.',
        deep: '<p><b>Evidence (Anthropic, 2025)</b>: a lead agent (Claude Opus 4) with Sonnet 4 sub-agents beat single-agent Opus 4 by <b>90.2%</b> on an internal research eval; token usage alone explained ~80% of performance variance on BrowseComp (with tool-call count and model choice, ~95%). Agents use ~4× the tokens of chat; multi-agent systems ~15×.</p>' +
          '<p><b>Counter-evidence (Cognition, 2025)</b>: “actions carry implicit decisions” — parallel sub-agents that cannot see each other’s traces make conflicting choices (two shots lit differently). Principle: share full context or keep the task single-threaded.</p>' +
          '<p><b>MAST</b> (Cemri et al., 2025): 14 failure modes in 3 groups, derived from expert-annotated traces of popular open-source MAS frameworks — <i>specification &amp; system design</i> (disobey task spec, disobey role spec, step repetition, loss of history, unaware of termination), <i>inter-agent misalignment</i> (conversation reset, fail to ask for clarification, task derailment, information withholding, ignored input, reasoning–action mismatch), <i>task verification</i> (premature termination, no/incomplete verification, incorrect verification).</p>' +
          '<div class="eq">Cost ≈ Σ<sub>agents</sub>(in·p<sub>in</sub> + out·p<sub>out</sub>) + Σ<sub>shots</sub> GPU·s · p<sub>gpu</sub> · (1 + redo rate)</div>' +
          '<div class="note">In video, the LLM overhead is usually small next to GPU cost (≈200k tokens ≈ $1 vs ≈76 GPU-min ≈ $3–4). The expensive failure is a coordination error that triggers extra renders — so spend tokens on the critic and the bible.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.fan, 450);
          S.cost = ctx.group();
          var G = S.cost;
          /* single agent */
          var top = ctx.group({ parent: G });
          panel(ctx, 36, 165, 740, 300, 'amber', top);
          head(ctx, 56, 190, 'SINGLE AGENT · one growing window', 'amber', top);
          var segs = [['script', 15], ['board', 14], ['S1', 12], ['S2', 12], ['S3', 12], ['S4', 12], ['S5', 12], ['S6', 12], ['critic', 30], ['edit', 12]];
          var sc = 690 / 143, x = 56;
          S.segs = segs.map(function (s, k) {
            var w = s[1] * sc;
            var r = ctx.rect(x, 222, w - 1.5, 38, { rx: 3, fill: ctx.alpha(k % 2 ? 'amber' : 'orange', 0.35 + 0.03 * (k % 3)), stroke: ctx.alpha('amber', 0.8), sw: 1, parent: top });
            ctx.text(x + w / 2, 241, s[0], { size: 11, font: 'mono', color: 'white', anchor: 'middle', parent: top });
            r.setAttribute('opacity', 0);
            x += w;
            return r;
          });
          ctx.text(56, 290, '143k tokens in one context · every turn re-reads all of it', { size: 13, color: 'text', parent: top });
          ctx.text(56, 314, 'serial wall-clock · early details diluted (“lost in the middle”)', { size: 13, color: 'text', parent: top });
          for (var q = 0; q < 30; q++) {
            var u = (q + 0.5) / 30, rec = 0.18 + 0.8 * Math.pow(2 * u - 1, 2);
            ctx.rect(56 + q * 23, 334, 21, 12, { rx: 2, fill: ctx.alpha('amber', rec), parent: top });
          }
          ctx.text(56, 362, 'attention recall across the window: strong at the ends, weak in the middle', { size: 11, font: 'mono', color: 'dim', parent: top });
          ctx.text(56, 400, 'wall-clock ≈ Σ turns', { size: 14, font: 'mono', color: 'amber', parent: top });
          ctx.text(56, 430, 'one decision-maker → coherent choices', { size: 13, color: '#a9f58a', parent: top });
          /* multi agent */
          var mt = ctx.group({ parent: G });
          panel(ctx, 824, 165, 740, 300, 'magenta', mt);
          head(ctx, 844, 190, 'LEAD + 6 SUB-AGENTS · isolated windows', 'magenta', mt);
          S.lead = ctx.rect(844, 222, 22 * sc, 30, { rx: 3, fill: ctx.alpha('magenta', 0.45), stroke: 'magenta', sw: 1, parent: mt });
          ctx.text(844 + 22 * sc + 8, 237, 'lead 22k', { size: 12, font: 'mono', color: 'magenta', parent: mt });
          S.subs = [];
          for (var i = 0; i < 6; i++) {
            var yy = 272 + i * 26;
            ctx.text(844, yy + 9, 'sub ' + (i + 1), { size: 11, font: 'mono', color: 'dim', parent: mt });
            var b = ctx.rect(900, yy, 0, 18, { rx: 3, fill: ctx.alpha('lime', 0.35), stroke: ctx.alpha('lime', 0.8), sw: 1, parent: mt });
            b.setAttribute('data-w', 28 * sc);
            S.subs.push(b);
            ctx.text(900 + 28 * sc + 8, yy + 9, '28k → 1.5k summary', { size: 11, font: 'mono', color: 'teal', parent: mt });
          }
          ctx.text(1210, 237, 'total ≈ 190k tokens', { size: 13, font: 'mono', color: 'text', parent: mt });
          ctx.text(1210, 300, 'wall-clock ≈ max(subs)', { size: 14, font: 'mono', color: 'magenta', parent: mt });
          ctx.text(1210, 330, '+ fresh, focused windows', { size: 13, color: '#a9f58a', parent: mt });
          ctx.text(1210, 356, '− context lost at hand-offs', { size: 13, color: '#ff9aad', parent: mt });
          ctx.text(1210, 382, '− implicit decisions conflict', { size: 13, color: '#ff9aad', parent: mt });
          ctx.text(844, 440, 'each sub-agent re-reads bible + tools; lead sees only summaries', { size: 12, font: 'mono', color: 'dim', parent: mt });
          ctx.reveal([top, mt], { from: 'up', stagger: 200 });
          /* token multiplier chart */
          var ch = ctx.group({ parent: G });
          panel(ctx, 36, 490, 740, 390, 'cyan', ch);
          head(ctx, 56, 515, 'TOKENS RELATIVE TO A CHAT (Anthropic, 2025)', 'cyan', ch);
          var vals = [['chat', 1, 'cyan'], ['single agent', 4, 'amber'], ['multi-agent', 15, 'magenta']];
          S.mult = vals.map(function (v, k) {
            var bx = 120 + k * 210, h = 250 * v[1] / 15;
            ctx.text(bx + 50, 850, v[0], { size: 13, font: 'mono', color: 'text', anchor: 'middle', parent: ch });
            var r = ctx.rect(bx, 830 - h, 100, h, { rx: 4, fill: ctx.alpha(v[2], 0.45), stroke: v[2], sw: 1.2, parent: ch });
            r.setAttribute('data-h', h);
            var t = ctx.text(bx + 50, 830 - h - 16, '≈' + v[1] + '×', { size: 18, font: 'display', weight: 700, color: v[2], anchor: 'middle', parent: ch, opacity: 0 });
            return [r, t];
          });
          ctx.line(90, 830, 740, 830, { color: 'faint', parent: ch });
          ctx.text(90, 556, 'multi-agent vs single agent:', { size: 12, font: 'mono', color: 'dim', parent: ch });
          ctx.text(90, 582, '+90.2% on internal research eval', { size: 15, font: 'mono', weight: 600, color: 'lime', parent: ch });
          ctx.text(90, 608, 'token usage explains ~80% of variance', { size: 12, font: 'mono', color: 'dim', parent: ch });
          ctx.reveal(ch, { delay: 500 });
          /* MAST */
          var fm = ctx.group({ parent: G });
          panel(ctx, 824, 490, 740, 390, 'pink', fm);
          head(ctx, 844, 515, 'WHY MULTI-AGENT SYSTEMS FAIL · MAST (14 modes, excerpt)', 'pink', fm);
          var cats = [['Specification & system design', ['disobey task / role spec', 'step repetition', 'loss of conversation history', 'unaware of termination']],
            ['Inter-agent misalignment', ['information withholding', "ignored other agent's input", 'task derailment', 'reasoning–action mismatch']],
            ['Task verification', ['premature termination', 'no or incomplete verification', 'incorrect verification']]];
          S.cats = cats.map(function (c, k) {
            var g = ctx.group({ parent: fm });
            var yy = 545 + k * 112;
            ctx.rect(844, yy, 700, 100, { rx: 8, fill: ctx.alpha('pink', 0.06), stroke: ctx.alpha('pink', 0.4), sw: 1, parent: g });
            ctx.text(860, yy + 20, (k + 1) + '  ' + c[0], { size: 14, weight: 600, color: 'pink', parent: g });
            c[1].forEach(function (m, j) {
              ctx.text(876 + (j % 2) * 340, yy + 48 + Math.floor(j / 2) * 24, '• ' + m, { size: 13, color: 'text', parent: g });
            });
            return g;
          });
          ctx.reveal(fm, { delay: 700 });
          ctx.reveal(S.cats, { from: 'left', delay: 900, stagger: 250 });
          return ctx.wait(700).then(function () {
            var chain = Promise.resolve();
            S.segs.forEach(function (r) { chain = chain.then(function () { return ctx.fade(r, 1, 140); }); });
            var par = ctx.wait(200).then(function () {
              return Promise.all(S.subs.map(function (b) { return ctx.animate(b, { width: [0, +b.getAttribute('data-w')] }, 700, 'out'); }));
            });
            return Promise.all([chain, par]);
          }).then(function () {
            return Promise.all(S.mult.map(function (m, k) {
              var h = +m[0].getAttribute('data-h');
              return ctx.animate(m[0], { height: [0, h], y: [830, 830 - h] }, 700, 'out', k * 250).then(function () { return ctx.fade(m[1], 1, 250); });
            }));
          }).then(function () {
            ctx.hud('multi-agent ≈ 15× chat tokens');
            return ctx.wait(600);
          });
        }
      },
      /* 8 ------------------------------------------------------------------ */
      {
        title: 'A2A protocol',
        say: 'Sometimes a crew member lives in another company. The Agent to Agent protocol, A2A, lets our director hire an external foley studio agent without seeing its internals. The director fetches the studio\'s agent card, which lists its skills, input and output types, and auth. It then sends a message that creates a task, streams status updates over server sent events, answers a clarifying question when the task becomes input required, and finally receives the score as an artifact. MCP connects agents to tools. A2A connects agents to agents.',
        deep: '<p><b>A2A</b> (Google, Apr 2025; Linux Foundation since Jun 2025; spec v0.3 adds gRPC and signed cards). Transport: JSON-RPC 2.0 over HTTPS, SSE for streaming, webhooks for push.</p>' +
          '<ul><li><b>Agent Card</b> at <code>/.well-known/agent-card.json</code>: name, url, <code>capabilities</code> (streaming, pushNotifications), <code>securitySchemes</code> (OAuth2, API key, mTLS), <code>skills[]</code> with input/output MIME modes.</li>' +
          '<li><b>Methods</b>: <code>message/send</code>, <code>message/stream</code>, <code>tasks/get</code>, <code>tasks/cancel</code>, <code>tasks/resubscribe</code>, <code>tasks/pushNotificationConfig/set</code>.</li>' +
          '<li><b>Task states</b>: submitted, working, input-required, auth-required, completed, canceled, failed, rejected. <i>input-required</i> is an interrupted state: the status event arrives with <code>final: true</code>, the SSE stream closes, and the client answers with a new <code>message/stream</code> carrying the same <code>taskId</code> (and <code>contextId</code>).</li>' +
          '<li><b>Message</b> = role + <code>parts[]</code>: TextPart | FilePart (uri or bytes + mimeType) | DataPart (JSON). Results come back as <b>Artifacts</b> via <code>TaskArtifactUpdateEvent</code>.</li></ul>' +
          '<table><tr><th></th><th>MCP</th><th>A2A</th></tr><tr><td>Peer</td><td>tool / resource server</td><td>opaque agent</td></tr><tr><td>Unit</td><td>tool call (JSON-Schema)</td><td>long-running task</td></tr><tr><td>State</td><td>mostly request/response (async tasks are experimental in the 2025-11 spec)</td><td>task + contextId, multi-turn</td></tr></table>' +
          '<div class="note">The remote agent never sees our bible or tools — pass it a <code>FilePart</code> URI to the locked cut and a DataPart with BPM / mood constraints.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.cost, 450);
          S.a2a = ctx.group();
          var G = S.a2a, XA = 200, XB = 900;
          S.hA = ctx.node({ x: XA, y: 205, w: 250, h: 64, title: 'Director', sub: 'A2A client', icon: 'agent', color: 'magenta', parent: G });
          S.hB = ctx.node({ x: XB, y: 205, w: 270, h: 64, title: 'Foley Studio', sub: 'remote agent · vendor', icon: 'music', color: 'orange', parent: G });
          var llA = ctx.line(XA, 240, XA, 690, { color: ctx.alpha('magenta', 0.5), sw: 1.4, dash: '4 6', parent: G });
          var llB = ctx.line(XB, 240, XB, 690, { color: ctx.alpha('orange', 0.5), sw: 1.4, dash: '4 6', parent: G });
          ctx.reveal([S.hA, S.hB], { from: 'down', stagger: 150 });
          ctx.reveal([llA, llB], { from: 'draw', delay: 300 });
          var msgs = [
            [270, 1, 'GET /.well-known/agent-card.json', 'cyan', null],
            [310, -1, 'AgentCard · skills · securitySchemes', 'cyan', null],
            [360, 1, 'message/stream  parts: text + file(uri: cut_v3.mp4)', 'magenta', 0],
            [405, -1, 'SSE  Task t-91 · state: working', 'magenta', 1],
            [450, -1, 'SSE  status: input-required  "synth or orchestral?"', 'amber', 2],
            [500, 1, 'message/stream  taskId t-91  "synth, 90 bpm"', 'magenta', 1],
            [550, -1, 'SSE  artifact-update: score.wav (FilePart uri)', 'orange', 1],
            [595, -1, 'SSE  status: completed  final=true', 'lime', 3]
          ];
          S.msg = msgs.map(function (m) {
            var x1 = m[1] > 0 ? XA + 6 : XB - 6, x2 = m[1] > 0 ? XB - 8 : XA + 8;
            var p = ctx.path('M' + x1 + ',' + m[0] + ' L' + x2 + ',' + m[0], { stroke: m[3], sw: 1.6, arrow: true, parent: G });
            p.setAttribute('opacity', 0);
            var t = ctx.text((XA + XB) / 2, m[0] - 12, m[2], { size: 13.5, font: 'mono', color: m[3], anchor: 'middle', parent: G, opacity: 0 });
            return { p: p, t: t, st: m[4], dir: m[1], col: m[3] };
          });
          ctx.text(XA, 720, 'MCP · agent → tool: schema-typed, synchronous call', { size: 13, font: 'mono', color: 'amber', parent: G, anchor: 'start' });
          ctx.text(XA, 748, 'A2A · agent → agent: opaque peer, long-running task + artifacts', { size: 13, font: 'mono', color: 'magenta', parent: G });
          ctx.text(XA, 776, 'JSON-RPC 2.0 over HTTPS · SSE streaming · push webhooks · gRPC (v0.3)', { size: 12, font: 'mono', color: 'dim', parent: G });
          /* agent card */
          S.card = ctx.code({ x: 1080, y: 160, w: 484, title: 'agent-card.json', lang: 'json', size: 12, color: 'orange', maxLines: 11, parent: G, lines: nb([
            '{"name": "foley-studio",',
            ' "url": "https://foley.example/a2a",',
            ' "protocolVersion": "0.3.0",',
            ' "capabilities": {"streaming": true,',
            '                  "pushNotifications": true},',
            ' "securitySchemes": {"oauth2": {...}},',
            ' "skills": [{"id": "score_to_picture",',
            '   "inputModes": ["video/mp4",',
            '                  "text/plain"],',
            '   "outputModes": ["audio/wav"]}]}'
          ]) });
          S.card.setAttribute('opacity', 0);
          /* state machine */
          S.sm = ctx.group({ parent: G });
          panel(ctx, 1080, 490, 484, 300, 'magenta', S.sm);
          head(ctx, 1100, 514, 'TASK LIFECYCLE', 'magenta', S.sm);
          var st = [['submitted', 1160, 575, 'cyan'], ['working', 1322, 575, 'magenta'], ['input-required', 1484, 575, 'amber'], ['completed', 1160, 690, 'lime'], ['failed', 1322, 690, 'red'], ['canceled', 1484, 690, 'dim']];
          S.stN = st.map(function (s) { return ctx.node({ x: s[1], y: s[2], w: 130, h: 40, kind: 'pill', title: s[0], color: s[3], titleSize: 13, glow: false, parent: S.sm }); });
          var e = function (a, b, o) { return ctx.link(S.stN[a], S.stN[b], Object.assign({ color: ctx.alpha('#e8f1ff', 0.4), sw: 1.2, parent: S.sm }, o || {})); };
          e(0, 1, { straight: true }); e(1, 2, { straight: true }); e(2, 1, { from: 't', to: 't', bend: { x: 1403, y: 518 } });
          e(1, 3, { from: 'b', to: 't' }); e(1, 4, { from: 'b', to: 't' }); e(1, 5, { from: 'b', to: 't' });
          ctx.text(1322, 760, 'also: auth-required · rejected', { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.sm });
          ctx.reveal(S.sm, { from: 'right', delay: 400 });
          S.cur = ctx.rect(0, 0, 146, 48, { rx: 24, stroke: 'white', sw: 2.4, parent: S.sm, glow: true, opacity: 0 });
          function mark(k) {
            if (k === null || k === undefined) return Promise.resolve();
            var b = S.stN[k].box;
            S.cur.setAttribute('x', b.x - 4); S.cur.setAttribute('y', b.y - 4);
            S.cur.setAttribute('opacity', 1);
            return ctx.pulse(S.stN[k], { color: st[k][3], dur: 500 });
          }
          var chain = ctx.wait(700);
          S.msg.forEach(function (m, k) {
            chain = chain.then(function () {
              m.p.setAttribute('opacity', 1);
              ctx.fade(m.t, 1, 200);
              if (k === 1) ctx.reveal(S.card, { from: 'right', dur: 500 });
              return ctx.reveal(m.p, { from: 'draw', dur: 350 }).then(function () {
                return ctx.packet(m.p, { color: m.col, r: 4, dur: 450 });
              }).then(function () { return mark(m.st); });
            });
          });
          return chain;
        }
      },
      /* 9 ------------------------------------------------------------------ */
      {
        title: 'Design rules',
        say: 'Here is the crew again, with what we learned attached. The director plans, budgets and joins. Specialists run in parallel with fresh contexts. Everything they make lands in the store and travels by reference, and one bible keeps the fox looking like the same fox in every shot. The critic gates every clip, so only failures are re-rendered. And when a crew member lives outside, A2A gives it a clean contract. Next door in the orchestration plane, durable execution makes this whole graph survive crashes.',
        deep: '<p><b>Checklist for a production multi-agent media pipeline</b></p>' +
          '<ol><li><b>Parallelize reads, serialize writes.</b> Shots, research and critique fan out; one editor owns the cut, one director owns the plan.</li>' +
          '<li><b>Typed contracts.</b> Each hand-off is a JSON-Schema object (brief, verdict, artifact_ref), validated at the boundary — often with constrained decoding.</li>' +
          '<li><b>Reference, don’t embed.</b> URIs + hashes + summaries in context; bytes in the store.</li>' +
          '<li><b>One bible, byte-stable prefix.</b> Consistency and prompt-cache hits come from the same design decision.</li>' +
          '<li><b>Calibrated critic with a budget.</b> Rubric + metrics, threshold tuned on human labels, ≤2 redos then escalate.</li>' +
          '<li><b>Budgets everywhere.</b> Per-agent token caps, per-job GPU-seconds, wall-clock deadlines; the supervisor enforces them.</li>' +
          '<li><b>Trace everything.</b> One span per agent turn and tool call (OpenTelemetry GenAI conventions) so cost and failure modes are attributable.</li></ol>' +
          '<div class="note">Rule of thumb: add an agent only when it buys parallelism, isolation of a noisy context, or an independent check. Otherwise, it is just another hop that can lose information.</div>',
        run: function (ctx) {
          var S = ctx.state;
          ctx.hud('');
          ctx.remove(S.a2a, 450);
          ctx.fade(S.crew, 1, 600);
          S.agG.forEach(function (g, i) { ctx.fade([g, S.dl[i], S.sl[i]], 1, 400); });
          ctx.fade(S.caption, 0, 300);
          S.ann = ctx.group();
          var notes = [
            [800, 170, 'plan · budget · join', 'magenta'],
            [670, 395, '6× parallel · fresh ctx', 'lime'],
            [1450, 395, 'rubric gate ≥ 0.75', 'violet'],
            [1190, 395, 'owns the cut (single writer)', 'cyan'],
            [800, 610, 'URIs + hashes · bible = cached prefix', 'teal']
          ];
          S.notes = notes.map(function (n) {
            var g = ctx.group({ parent: S.ann });
            var w = n[2].length * 7.6 + 24;
            ctx.rect(n[0] - w / 2, n[1] - 13, w, 26, { rx: 13, fill: '#0b1324', stroke: n[3], sw: 1.2, parent: g });
            ctx.text(n[0], n[1] + 0.5, n[2], { size: 12.5, font: 'mono', color: n[3], anchor: 'middle', parent: g });
            return g;
          });
          var rules = ctx.group({ parent: S.ann });
          ctx.text(800, 800, 'Parallelize reads (shots, research, critique) · serialize writes (one plan, one cut)', { size: 15, color: 'white', anchor: 'middle', parent: rules });
          ctx.text(800, 830, 'Pass references · share one bible · gate with a calibrated critic · budget every agent', { size: 15, color: 'white', anchor: 'middle', parent: rules });
          ctx.text(800, 862, 'external specialists via A2A (agent card → task → artifacts)', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: rules });
          ctx.reveal(S.notes, { from: 'scale', delay: 600, stagger: 200 });
          ctx.reveal(rules, { from: 'up', delay: 1500 });
          ctx.hud('fan-out 5.3× faster · 1 targeted redo, not 6');
          return ctx.wait(900).then(function () {
            return Promise.all(S.dl.map(function (l) { return ctx.packet(l, { color: 'magenta', dur: 800 }); }));
          }).then(function () {
            return Promise.all(S.sl.map(function (l) { return ctx.packet(l, { color: 'teal', dur: 700, r: 4 }); }));
          });
        }
      }
    ]
  });
})();
