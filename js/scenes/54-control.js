/* L2 — Control, Consistency & Long Video. How agents direct a video DiT, beat by beat: keyframes (I2V / FLF2V),
 * reference identity tokens, Plücker camera control, motion/structure adapters, character LoRA, long-video extension
 * (chunked AR, diffusion forcing, causal students), drift, and shot-to-shot continuity for the 6-shot trailer. */
(function () {
  var ROAD = ['inputs', 'I2V · FLF', 'identity', 'camera', 'motion', 'LoRA', 'long video', 'drift', 'trailer'];

  /* make elements invisible until the beat that introduces them reveals them */
  function hide(list) { (Array.isArray(list) ? list : [list]).forEach(function (e) { if (Array.isArray(e)) hide(e); else if (e) e.setAttribute('opacity', 0); }); }

  /* The light theme inverts luminance with a CSS filter. Magenta, violet, blue and red keep a mid luminance, so small text in those
   * hues turns pale on white. Lighten such text once (the inversion then makes it dark); hue and dark-theme legibility are unchanged. */
  var HARD = [[255, 63, 210], [155, 123, 255], [77, 141, 255], [255, 77, 109]];
  function tint(ctx) {
    var list = ctx.layer.querySelectorAll('text');
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.hasAttribute('data-tt')) continue;
      t.setAttribute('data-tt', '1');
      var m = /^(?:#([0-9a-f]{6})|rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+))/i.exec(t.getAttribute('fill') || '');
      if (!m) continue;
      var rgb = m[1] ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [+m[2], +m[3], +m[4]];
      for (var k = 0; k < HARD.length; k++) {
        if (Math.abs(rgb[0] - HARD[k][0]) + Math.abs(rgb[1] - HARD[k][1]) + Math.abs(rgb[2] - HARD[k][2]) < 8) {
          t.setAttribute('fill', ctx.mix('rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')', '#ffffff', 0.42));
          break;
        }
      }
    }
  }

  function buildRoad(ctx, S) {
    S.roadG = ctx.group();
    S.pills = ROAD.map(function (s, i) {
      var x = 866 + i * 78;
      var r = ctx.rect(x, 88, 72, 24, { rx: 12, fill: 'rgba(255,255,255,0.03)', stroke: ctx.C.line, sw: 1, parent: S.roadG });
      var t = ctx.text(x + 36, 100.5, s, { size: 11, font: 'mono', anchor: 'middle', color: 'dim', parent: S.roadG });
      return { r: r, t: t };
    });
    ctx.reveal(S.roadG, { from: 'down', dur: 400 });
  }
  function road(ctx, S, i) {
    S.pills.forEach(function (p, k) {
      var on = k === i, seen = k < i;
      p.r.setAttribute('stroke', on ? ctx.C.lime : (seen ? ctx.alpha('lime', 0.45) : ctx.C.line));
      p.r.setAttribute('fill', on ? ctx.alpha('lime', 0.25) : 'rgba(255,255,255,0.03)');
      p.t.setAttribute('fill', on ? ctx.C.white : (seen ? ctx.C.lime : ctx.C.dim));
    });
  }
  function swap(ctx, S, idx) {
    road(ctx, S, idx);
    var old = S.cur;
    S.cur = ctx.group();
    if (old) ctx.fadeOut(old, 450, true);
    return S.cur;
  }
  function title(ctx, g, str) { return ctx.text(70, 190, str, { size: 19, font: 'display', weight: 700, color: 'white', parent: g }); }

  /* the fox astronaut glyph (local units ~ 36 x 44). drift in [0,1] = identity corruption, turn in [-1,1] = head yaw */
  function fox(ctx, parent, cx, cy, s, drift, turn) {
    drift = drift || 0; turn = turn || 0;
    var g = ctx.group({ parent: parent });
    ctx.place(g, cx, cy, s);
    var fur = ctx.mix('#ff8a3d', '#c77dff', drift), suit = ctx.mix('#dfe9ff', '#6f8fbf', drift);
    var hel = ctx.mix('#e8f1ff', '#2bf5c4', drift), k = 1 + 0.35 * drift, tx = 3 * turn;
    ctx.rect(-9, 13, 18, 14, { rx: 4, fill: suit, parent: g });
    ctx.line(-9, 20, 9, 20, { color: '#ff8a3d', sw: 1, parent: g });
    ctx.poly([[-9 * k + tx * 0.3, 4], [-10 * k, -10 - 3 * drift], [-5 + tx * 0.5, -5], [5 + tx * 0.5, -5], [10 * k, -10 + 2 * drift], [9 * k + tx * 0.3, 4], [tx, 10]], { fill: fur, parent: g });
    ctx.poly([[-5 + tx, 5], [tx, 10], [5 + tx, 5], [tx, 7]], { fill: '#fff2e6', parent: g });
    ctx.circle(-4 + tx, -1, 1.4, { fill: '#1a1030', parent: g });
    ctx.circle(4 + tx, -1 + 1.5 * drift, 1.4, { fill: '#1a1030', parent: g });
    ctx.circle(0, -1, 15.5, { stroke: hel, sw: 1.4, fill: ctx.alpha('cyan', 0.08), parent: g });
    ctx.path('M8,-12 L10,-8 L8.5,-6 L11,-3', { stroke: 'white', sw: 0.7, parent: g });
    return g;
  }

  function chip(ctx, parent, x, y, w, str, onClick) {
    var g = ctx.group({ parent: parent });
    var r = ctx.rect(x - w / 2, y - 13, w, 26, { rx: 13, fill: 'rgba(255,255,255,0.03)', stroke: ctx.C.line, sw: 1.2, parent: g });
    var t = ctx.text(x, y + 0.5, str, { size: 11.5, font: 'mono', anchor: 'middle', color: 'dim', weight: 600, parent: g });
    g.style.cursor = 'pointer';
    g.addEventListener('click', onClick);
    return { g: g, r: r, t: t };
  }
  function chipOn(ctx, c, on) {
    c.r.setAttribute('fill', on ? ctx.alpha('lime', 0.3) : 'rgba(255,255,255,0.03)');
    c.r.setAttribute('stroke', on ? ctx.C.lime : ctx.C.line);
    c.t.setAttribute('fill', on ? ctx.C.white : ctx.C.dim);
  }

  /* ---------- step 2 helpers: I2V / FLF2V channel-concat conditioning ---------- */
  var CX0 = 400, CW = 58, CSTEP = 70, FRAMES = [0, 3, 6, 9, 12, 15, 18, 20];
  function i2vUpdate(ctx, S) {
    var flf = !!S.flf;
    S.maskCells.forEach(function (m, i) {
      var on = i === 0 ? S.firstOn : (i === 7 && flf);
      m.r.setAttribute('fill', on ? ctx.alpha('white', 0.85) : '#0a1120');
      m.t.textContent = on ? '1' : '0';
      m.t.setAttribute('fill', on ? ctx.C.bg : ctx.C.dim);
    });
    S.condFox[0].setAttribute('opacity', S.firstOn ? 1 : 0);
    S.condZero[0].setAttribute('opacity', S.firstOn ? 0 : 1);
    S.condFox[1].setAttribute('opacity', flf ? 1 : 0);
    S.condZero[1].setAttribute('opacity', flf ? 0 : 1);
    if (S.i2vChips) { chipOn(ctx, S.i2vChips[0], !flf); chipOn(ctx, S.i2vChips[1], flf); }
    S.modeT.textContent = flf ? 'FLF2V: mask = 1 at t = 0 and t = 20; y = VAE([img₀, 0, …, 0, img₈₀])' : 'I2V: mask = 1 at t = 0 only; y = VAE([img₀, 0, …, 0])';
  }

  /* ---------- step 4 helpers: Plücker rays ---------- */
  function v3(x, y, z) { return { x: x, y: y, z: z }; }
  function sub(a, b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
  function cross(a, b) { return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
  function norm(a) { var l = Math.hypot(a.x, a.y, a.z) || 1; return v3(a.x / l, a.y / l, a.z / l); }
  function camPos(s) { var th = -1.2 + 2.1 * s, r = 6 - 3 * s; return v3(r * Math.sin(th), 1.2 - 0.6 * s, r * Math.cos(th)); }
  function rgb(v) {
    function c(a) { return Math.round(128 + 120 * Math.max(-1, Math.min(1, a))); }
    return 'rgb(' + c(v.x) + ',' + c(v.y) + ',' + c(v.z) + ')';
  }
  function camScreen(p) { return { x: 380 + 50 * p.x, y: 360 + 44 * p.z - 30 * p.y }; }
  function camUpdate(ctx, S, s) {
    var o = camPos(s);
    var f = norm(sub(v3(0, 0.3, 0), o)), r = norm(cross(f, v3(0, 1, 0))), u = cross(r, f);
    var tanH = Math.tan(20 * Math.PI / 180);
    S.dGrid.set(function (i, j) {
      var uu = (j - 3.5) / 3.5 * tanH, vv = -(i - 3.5) / 3.5 * tanH * 0.5625;
      var d = norm(v3(r.x * uu + u.x * vv + f.x, r.y * uu + u.y * vv + f.y, r.z * uu + u.z * vv + f.z));
      return rgb(d);
    });
    S.mGrid.set(function (i, j) {
      var uu = (j - 3.5) / 3.5 * tanH, vv = -(i - 3.5) / 3.5 * tanH * 0.5625;
      var d = norm(v3(r.x * uu + u.x * vv + f.x, r.y * uu + u.y * vv + f.y, r.z * uu + u.z * vv + f.z));
      var m = cross(o, d);
      return rgb(v3(m.x / 3, m.y / 3, m.z / 3));
    });
    var p = camScreen(o), tgt = camScreen(v3(0, 0.3, 0));
    var ang = Math.atan2(tgt.y - p.y, tgt.x - p.x);
    ctx.place(S.camFr, p.x, p.y, 1, ang * 180 / Math.PI);
    S.camRead.textContent = 'frame t = ' + Math.round(s * 20) + ' / 20 · o = (' + o.x.toFixed(1) + ', ' + o.y.toFixed(1) + ', ' + o.z.toFixed(1) + ')';
  }
  function frustum(ctx, parent, col, op) {
    var g = ctx.group({ parent: parent });
    ctx.poly([[0, 0], [46, -17], [46, 17]], { fill: ctx.alpha(col, 0.18), stroke: col, sw: 1.4, parent: g });
    ctx.rect(-10, -8, 13, 16, { rx: 2, fill: col, parent: g });
    if (op !== undefined) g.setAttribute('opacity', op);
    return g;
  }

  /* ---------- step 7 helpers: per-frame noise levels ---------- */
  function sigmaRow(mode, i, tau) {
    if (mode === 'A') return 1 - tau;
    if (mode === 'B') {
      if (i < 6) return Math.max(0, 1 - 2 * tau);
      if (tau < 0.5) return 1;
      return Math.max(0, 1 - 2 * (tau - 0.5));
    }
    var k = tau * 16, w = 4;
    return Math.max(0, Math.min(1, (i - k + w) / w));
  }
  function longUpdate(ctx, S, tau) {
    ['A', 'B', 'C'].forEach(function (m, ri) {
      for (var i = 0; i < 12; i++) {
        var s = sigmaRow(m, i, tau);
        var pending = m === 'B' && i >= 6 && tau < 0.5;
        var b = S.lbars[ri][i], th = S.lthumb[ri][i];
        var h = 86 * s;
        b.setAttribute('y', S.lrowY[ri] + 96 - h);
        b.setAttribute('height', Math.max(0, h));
        b.setAttribute('opacity', pending ? 0.25 : 1);
        th.setAttribute('fill', pending ? '#0a1120' : ctx.mix('#6b7690', '#8dff5a', 1 - s));
        th.setAttribute('opacity', pending ? 0.4 : 1);
      }
    });
    S.ltau.textContent = 'sampling progress ' + Math.round(tau * 100) + '%';
  }

  /* ---------- step 9 ---------- */
  var SHOTS = [['S1 · descent', 'cockpit alarms'], ['S2 · impact', 'crash on ice'], ['S3 · emerge', 'cracked helmet'], ['S4 · the glow', 'ice-cave light'], ['S5 · close-up', 'visor fogs up'], ['S6 · wide', 'moonrise, alone']];

  Atlas.register({
    id: 'consistency',
    refs: [
      'Team Wan et al., <i>Wan: Open and Advanced Large-Scale Video Generative Models</i>, arXiv 2503.20314, 2025',
      'Liu et al., <i>Phantom: Subject-Consistent Video Generation via Cross-Modal Alignment</i>, arXiv 2502.11079, 2025; Jiang et al., <i>VACE: All-in-One Video Creation and Editing</i>, ICCV 2025',
      'He et al., <i>CameraCtrl: Enabling Camera Control for Video Diffusion Models</i>, ICLR 2025; Bahmani et al., <i>AC3D: Analyzing and Improving 3D Camera Control in Video Diffusion Transformers</i>, CVPR 2025',
      'Zhang, Rao &amp; Agrawala, <i>Adding Conditional Control to Text-to-Image Diffusion Models (ControlNet)</i>, ICCV 2023; Geng et al., <i>Motion Prompting: Controlling Video Generation with Motion Trajectories</i>, CVPR 2025; Burgert et al., <i>Go-with-the-Flow: Motion-Controllable Video Diffusion Models Using Real-Time Warped Noise</i>, CVPR 2025',
      'Hu et al., <i>LoRA: Low-Rank Adaptation of Large Language Models</i>, ICLR 2022',
      'Chen et al., <i>Diffusion Forcing: Next-token Prediction Meets Full-Sequence Diffusion</i>, NeurIPS 2024',
      'Yin et al., <i>From Slow Bidirectional to Fast Autoregressive Video Diffusion Models</i> (CausVid), CVPR 2025',
      'Huang et al., <i>Self Forcing: Bridging the Train-Test Gap in Autoregressive Video Diffusion</i>, NeurIPS 2025',
      'Zhang et al., <i>Frame Context Packing and Drift Prevention in Next-Frame-Prediction Video Diffusion Models (FramePack)</i>, arXiv 2504.12626, 2025'
    ],
    steps: [
      /* ------------------------------------------------------------------ 1 */
      {
        title: 'Directing the model',
        beats: [
          {
            say: 'A text prompt alone is a slot machine. Every sample invents a new fox, a new camera and a new moon, so the six shots of our trailer would show six different characters.',
            card: { tag: 'PITFALL', title: 'Text alone is a slot machine', body: 'A prompt says <i>what</i>, statistically. Six independent samples give six foxes with different fur, helmets and suits.' },
            deep: '<p>Text conditioning specifies <i>what</i>, statistically. A director needs <i>exactly this</i>: this character, this framing, this motion, continuing from that frame. With text alone each of the 6 shots is an independent sample: the fox’s fur, helmet and suit drift from shot to shot, as the strip on the stage shows.</p>' +
              '<div class="note">The DiT of the previous chamber models p(video | text). Every control method in this chamber narrows that distribution with extra evidence.</div>'
          },
          {
            say: 'To direct a film, the agents need control inputs. Three of them pin down content: a first or last frame, reference images of the fox, and the previous chunk of video.',
            card: { tag: 'HOW IT WORKS', title: 'Levers that fix content', body: 'Keyframes, references and previous-chunk context hand the model pixels it must keep, not words it may interpret.' },
            deep: '<p><b>Keyframes</b> pin one moment (I2V, or first-and-last-frame FLF2V): the model must start or end at an image. <b>References</b> pin identity across all frames (Phantom, VACE, Veo’s “ingredients to video”). <b>The previous chunk</b> pins continuity across a long take by feeding clean context frames and a KV cache. Steps 2, 3 and 7 of this chamber take them in turn.</p>'
          },
          {
            say: 'Three more control how the scene moves and who is in it: a camera path, structure signals such as depth and pose, and a character specific fine tune called a LoRA.',
            card: { tag: 'HOW IT WORKS', title: 'Levers for motion and identity', body: 'Camera rays, depth or pose maps, and low-rank weight updates constrain <i>how</i> the shot plays out, not just its first frame.' },
            deep: '<p><b>Camera path</b>: per-frame extrinsics turned into dense Plücker rays (step 4). <b>Motion, depth and pose</b>: control videos fed to a zero-initialised adapter (step 5). <b>Character LoRA</b>: a low-rank update to the weights that bakes the fox into the model (step 6).</p>' +
              '<p>Each lever has a different cost profile and a different failure mode, which is why production systems combine several rather than choose one.</p>'
          },
          {
            say: 'Just as important is where each lever enters the diffusion transformer: as extra input channels, as extra tokens in attention, as residuals from an adapter, or as changes to the weights themselves.',
            card: { tag: 'HOW IT WORKS', title: 'Four injection routes', body: 'Channels, tokens, adapter residuals, weight deltas. The route decides cost, flexibility and what must be retrained.', more: '<p>Rule of thumb: channel concat is free at inference but fixed at training time; tokens are flexible but add sequence length and quadratic attention; adapters add FLOPs per block; LoRA costs a training job per character but nothing once merged.</p>' },
            deep: '<p>Every control method is one of four <b>injection routes</b> into the DiT:</p>' +
              '<table><tr><th>Route</th><th>Mechanism</th><th>Examples</th></tr>' +
              '<tr><td>input channels</td><td>concat to z<sub>σ</sub> before patchify</td><td>I2V, FLF2V, inpainting masks</td></tr>' +
              '<tr><td>sequence tokens</td><td>extra (clean) tokens in self-attention</td><td>reference identity, context frames</td></tr>' +
              '<tr><td>adapter residuals</td><td>trainable side network or embedding, zero-init add</td><td>camera Plücker maps, depth / pose / track ControlNets, VACE</td></tr>' +
              '<tr><td>weights</td><td>low-rank ΔW</td><td>character / style LoRA</td></tr></table>' +
              '<p>Route choice is a systems decision, with the trade-offs in the card above.</p>'
          },
          {
            say: 'Our trailer has six shots, and every one of them must show the same fox. The rest of this chamber pins that down, lever by lever.',
            card: { tag: 'NUMBERS', title: 'The goal of the chamber', stat: { v: '6 → 1', u: 'fox', l: 'six independently rendered shots must agree on identity, palette and lens' } },
            deep: '<p>Continuity is a systems property: the model provides the levers, and the orchestration layer decides how to pull them so that six independently rendered 5 s shots read as one film. The last step of this chamber closes that loop with a critic that measures identity per shot and re-renders the shot that fails.</p>' +
              '<div class="note">Without control, each of the 6 shots is an independent sample. The fox’s fur, helmet and suit drift from shot to shot.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          buildRoad(ctx, S);
          var g = swap(ctx, S, 0);
          S.dit = ctx.node({ x: 800, y: 440, w: 290, h: 250, title: 'Video DiT', sub: 'text-only ⇒ a new fox per sample', icon: 'film', color: 'lime', titleSize: 20, subSize: 11.5, glow: 'strong', parent: g });
          S.txt = ctx.node({ x: 800, y: 238, w: 290, h: 50, title: 'Text prompt', sub: 'cross-attn: "what", not "exactly how"', icon: 'doc', color: 'amber', titleSize: 14, subSize: 10.5, parent: g });
          S.lTxt = ctx.link(S.txt, S.dit, { from: 'b', to: 't', color: 'amber', parent: g });
          var L = [['First / last frame', 'latent → input channels', 'image', 'cyan', 350, 'channels'], ['Reference identity', 'clean ref tokens in attention', 'eye', 'violet', 440, 'tokens'], ['Previous chunk', 'context frames · KV cache', 'clock', 'teal', 530, 'tokens']];
          var R = [['Camera path', 'Plücker rays added to tokens', 'globe', 'blue', 350, 'residual'], ['Motion · depth · pose', 'adapter residuals', 'net', 'orange', 440, 'residual'], ['Character LoRA', 'ΔW = B·A in the weights', 'layers', 'magenta', 530, 'weights']];
          S.ins = []; S.inLinks = [];
          L.concat(R).forEach(function (c, i) {
            var left = i < 3;
            var n = ctx.node({ x: left ? 250 : 1350, y: c[4], w: 280, h: 56, title: c[0], sub: c[1], icon: c[2], color: c[3], titleSize: 14, subSize: 10.5, parent: g });
            S.ins.push(n);
            /* straight, horizontal links onto the DiT's edge: the route label sits above its own line and no link crosses another */
            var lk = ctx.link(n, { x: left ? S.dit.box.l : S.dit.box.r, y: c[4] }, { from: left ? 'r' : 'l', straight: true, color: c[3], label: c[5], labelDy: -18, parent: g });
            S.inLinks.push(lk);
          });
          S.routeT = ctx.text(800, 596, 'four injection routes: input channels · attention tokens · adapter residuals · weight deltas', { size: 13, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          /* the trailer strip, uncontrolled */
          S.shotG = ctx.group({ parent: g });
          S.shotTitle = ctx.text(95, 656, 'THE TRAILER · 6 shots = 6 independent sampling runs · text-only: six different foxes', { size: 14, font: 'display', weight: 700, color: 'amber', parent: S.shotG });
          var drifts = [0, 0.7, 0.3, 1, 0.5, 0.15], turns = [0, 0.6, -0.5, 0.3, -0.8, 0.9];
          S.cardFox = [];
          S.cards = SHOTS.map(function (sh, i) {
            var x = 95 + i * 238, cg = ctx.group({ parent: S.shotG });
            ctx.rect(x, 682, 212, 110, { rx: 8, fill: '#08101f', stroke: ctx.alpha('lime', 0.4), sw: 1.2, parent: cg });
            ctx.line(x + 8, 772, x + 204, 772, { color: ctx.alpha('cyan', 0.5), sw: 1, parent: cg });
            S.cardFox.push(fox(ctx, cg, x + 50, 732, 1.35, drifts[i], turns[i]));
            ctx.text(x + 100, 716, sh[0], { size: 12.5, font: 'mono', weight: 700, color: 'white', parent: cg });
            ctx.text(x + 100, 738, sh[1], { size: 11.5, font: 'mono', color: 'dim', parent: cg });
            ctx.text(x + 100, 758, '5 s · 720p', { size: 11, font: 'mono', color: 'lime', parent: cg });
            return cg;
          });
          S.shotNote = ctx.text(800, 830, 'the agents must pin identity, framing, motion and continuity — each lever is a step of this chamber', { size: 12.5, font: 'mono', color: 'dim', anchor: 'middle', parent: g });
          var labs = S.inLinks.map(function (l) { return l.labelEl; });
          tint(ctx);
          hide([S.dit, S.txt, S.lTxt, S.ins, S.inLinks, labs, S.routeT, S.shotG, S.cards, S.shotNote]);

          /* beat 0: text only, and six different foxes */
          return Promise.all([ctx.reveal([S.dit, S.txt], { from: 'scale', stagger: 200 }), ctx.reveal(S.lTxt, { from: 'draw', delay: 400 })]).then(function () {
            return Promise.all([ctx.packet(S.lTxt, { color: 'amber', dur: 700, label: 'text' }), ctx.reveal(S.shotG, { dur: 300 }), ctx.reveal(S.cards, { from: 'up', delay: 300, stagger: 160 })]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: levers that fix content */
            return Promise.all([ctx.reveal(S.ins.slice(0, 3), { from: 'left', stagger: 150 }), ctx.reveal(S.inLinks.slice(0, 3), { from: 'draw', delay: 300, stagger: 150 })]).then(function () {
              return Promise.all(S.inLinks.slice(0, 3).map(function (l, i) { return ctx.packet(l, { color: S.ins[i].color, dur: 800 }); }));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: levers for motion and identity */
            return Promise.all([ctx.reveal(S.ins.slice(3), { from: 'right', stagger: 150 }), ctx.reveal(S.inLinks.slice(3), { from: 'draw', delay: 300, stagger: 150 })]).then(function () {
              return Promise.all(S.inLinks.slice(3).map(function (l, i) { return ctx.packet(l, { color: S.ins[i + 3].color, dur: 800 }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: where each one enters the DiT */
            return Promise.all([ctx.reveal(labs, { delay: 100, stagger: 120 }), ctx.reveal(S.routeT, { from: 'up', delay: 600 })]).then(function () {
              return ctx.pulse(S.dit, { color: 'lime', times: 2, dur: 700 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the goal, one fox in six shots: every card now shows the same identity */
            S.shotTitle.textContent = 'THE GOAL · 6 shots, one fox: identity, palette and lens agree in every shot';
            S.shotTitle.setAttribute('fill', ctx.C.lime);
            S.cards.forEach(function (c, i) {
              ctx.fadeOut(S.cardFox[i], 500, true);
              ctx.reveal(fox(ctx, c, 95 + i * 238 + 50, 732, 1.35, 0, turns[i]), { from: 'fade', dur: 700 });
            });
            return Promise.all([ctx.reveal(S.shotNote, { from: 'up' })].concat(S.cards.map(function (c) { return ctx.pulse(c, { color: 'lime', dur: 500 }); })));
          });
        }
      },
      /* ------------------------------------------------------------------ 2 */
      {
        title: 'Keyframes: I2V & FLF',
        beats: [
          {
            say: 'The simplest control is a keyframe. The storyboard agent\'s image for shot three is encoded by the VAE into a latent frame.',
            card: { tag: 'KEY IDEA', title: 'A keyframe is just an image', body: 'The storyboard agent hands over a picture. The same VAE that built the training latents encodes it into a latent frame.' },
            deep: '<p><b>Channel concatenation</b> (Wan 2.1 I2V / FLF2V, SVD, CogVideoX-I2V) starts by encoding the given image with the model’s own causal VAE: a 3 × 720 × 1280 keyframe becomes a 16 × 90 × 160 latent frame E(I<sub>0</sub>). Using the same VAE as in training guarantees that the condition lives in exactly the latent space the DiT generates in.</p>' +
              '<details><summary>Go deeper</summary><p>Conditioning in latent space is also cheaper: the keyframe is 3 × 720 × 1280 = 2.8 M numbers as pixels but 16 × 90 × 160 = 230 k as a latent, 12× fewer, and the DiT never saw raw pixels during training, so pixel-space conditioning would mismatch its input statistics.</p></details>'
          },
          {
            say: 'Wan\'s image to video model then builds its input from three tensors along the channel axis: the noisy latent, a binary mask that marks which frames are given, and the condition video, which is the keyframe followed by zeros.',
            card: { tag: 'HOW IT WORKS', title: 'Three tensors, one concat', body: 'The noisy latent, a 0 / 1 mask marking given frames, and a condition video: the keyframe padded with zeros.' },
            deep: '<div class="eq">x<sub>in</sub> = concat<sub>C</sub>( z<sub>σ</sub> [16], m [4], y = E([I<sub>0</sub>, 0, …, 0]) [16] ) ∈ ℝ<sup>36×21×90×160</sup></div>' +
              '<p>The mask tells the network which latent frames are hard evidence (1) and which it must generate (0); y carries the evidence itself. Where m = 0 the padding frames are blank (zero-valued pixels, encoded by the same VAE) and carry no content, so the network learns to trust y only at masked-in frames.</p>' +
              '<details><summary>Go deeper</summary><p>Why a mask <i>and</i> zero padding: the blank padding frames are just another video the VAE can encode, indistinguishable from a real, flat-coloured keyframe. Without m the network could not tell “nothing given here” from “a flat frame is required here”. The mask removes that ambiguity at the cost of 4 extra input channels.</p></details>'
          },
          {
            say: 'Sixteen plus four plus sixteen makes thirty six input channels, so the patch embedder widens while the transformer blocks are reused. The mask has four channels because each latent frame summarizes four pixel frames.',
            card: { tag: 'NUMBERS', title: 'A wider front door', stat: { v: '36', u: 'input channels', l: '16 noisy latent + 4 mask + 16 condition video, into a widened patch embedder: Conv3d 36 → 5120' } },
            deep: '<p><b>Why 4 mask channels:</b> the mask is defined on the 81 pixel frames; frame 0 is repeated 4× (84 frames), reshaped to 21 × 4, so each latent frame carries the 4 pixel-frame flags it summarises, matching the VAE’s 4× temporal compression and its causal first frame.</p>' +
              '<pre>m = ones(81, h, w); m[1:] = 0\nm = cat([m[:1].repeat(4), m[1:]])\nm = m.view(21, 4, h, w)</pre>' +
              '<p class="muted">Only frame 0 is given; repeating it 4× gives 84 frames, regrouped as 21 latent frames with 4 flags each (h, w are latent-grid sizes).</p>' +
              '<p>The input projection grows (16 → 36 channels), and Wan 2.1 I2V also adds a CLIP-image cross-attention branch (extra K/V projections, ≈ 2 B parameters over 40 blocks); the ≈ 14 B backbone weights are reused and fine-tuned on image–video pairs.</p>'
          },
          {
            say: 'Give it both a first and a last frame, and the same mechanism interpolates between them. The agent uses this for match cuts: the last frame of shot two becomes the first frame of shot three.',
            card: { tag: 'TRY IT', title: 'First frame, or first and last', body: 'Click I2V and FLF2V. The mask and the condition video gain a second given frame at the end of the clip.' },
            deep: '<p><b>FLF2V:</b> set m = 1 and encode images at both t = 0 and t = 80; the model inpaints the motion in between. The agent uses this for <i>match cuts</i>: the last frame of shot 2 becomes the first frame of shot 3.</p>' +
              '<p>Both modes use the same weights: the mask decides how much is given. The same idea covers inpainting, outpainting and video extension: they are just other mask patterns over the frame axis.</p>'
          },
          {
            say: 'There is a second route, used by HunyuanVideo image to video, the five billion parameter Wan two point two model and LTX Video: put the clean keyframe latent into the token sequence with a timestep of zero, or close to it. It needs no new input layer, so a single model can serve both text to video and image to video.',
            card: { tag: 'STATE OF THE ART', title: 'Keyframes as in-context tokens', body: 'A clean latent at timestep 0 joins the sequence. No widened input layer, so one model can do both text-to-video and image-to-video.' },
            deep: '<p><b>Route B: in-context tokens with per-token timestep.</b> The clean keyframe latent enters the sequence with timestep 0 (LTX-Video: a small value) while the rest is noisy. Either it <i>replaces</i> the first latent frame’s tokens (HunyuanVideo-I2V “token replace”, Wan 2.2 TI2V-5B, LTX-Video first-frame conditioning; zero extra tokens) or it is <i>appended</i> as extra tokens at any frame index (LTX-Video multi-keyframe conditioning; each keyframe adds one latent frame of tokens, 3,600 in this chamber’s 720p layout).</p>' +
              '<p>No new input layer is needed. For comparison, Wan 2.1 I2V also encodes the keyframe with CLIP ViT-H/14 (257 tokens) and reads it through a decoupled image cross-attention, which gives every block a global semantic view of the keyframe.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 1);
          title(ctx, g, 'IMAGE-TO-VIDEO · condition by channel concatenation (Wan 2.1 I2V / FLF2V)');
          var rnd = ctx.rng(17);
          S.gridG = ctx.group({ parent: g });
          FRAMES.forEach(function (f, i) { ctx.text(CX0 + i * CSTEP + CW / 2, 246, 't=' + f, { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gridG }); });
          var rows = [['zσ · noise', '16 ch', 262, 'lime'], ['mask m', '4 ch', 352, 'white'], ['y = VAE(cond video)', '16 ch', 442, 'cyan']];
          rows.forEach(function (r) {
            ctx.text(CX0 - 16, r[2] + 22, r[0], { size: 12.5, font: 'mono', color: r[3], anchor: 'end', parent: S.gridG });
            ctx.text(CX0 - 16, r[2] + 40, r[1], { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.gridG });
          });
          S.maskCells = []; S.condFox = []; S.condZero = [];
          for (var i = 0; i < 8; i++) {
            var x = CX0 + i * CSTEP;
            ctx.rect(x, 262, CW, CW, { rx: 6, fill: '#08101f', stroke: ctx.alpha('lime', 0.5), sw: 1, parent: S.gridG });
            ctx.matrix(x + 4, 266, 3, 3, { cell: 15, gap: 2.5, cmap: 'lime', values: function () { return 0.15 + 0.7 * rnd(); }, parent: S.gridG });
            var mr = ctx.rect(x, 352, CW, CW, { rx: 6, fill: '#0a1120', stroke: ctx.alpha('white', 0.4), sw: 1, parent: S.gridG });
            var mt = ctx.text(x + CW / 2, 381, '0', { size: 16, font: 'mono', weight: 700, color: 'dim', anchor: 'middle', parent: S.gridG });
            S.maskCells.push({ r: mr, t: mt });
            ctx.rect(x, 442, CW, CW, { rx: 6, fill: '#08101f', stroke: ctx.alpha('cyan', 0.5), sw: 1, parent: S.gridG });
            if (i === 0 || i === 7) {
              var cf = ctx.group({ parent: S.gridG });
              fox(ctx, cf, x + CW / 2, 468, 1.05, 0, i === 7 ? 0.8 : 0);
              var cz = ctx.text(x + CW / 2, 471, '0', { size: 16, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gridG });
              S.condFox.push(cf); S.condZero.push(cz);
            } else {
              ctx.text(x + CW / 2, 471, '0', { size: 16, font: 'mono', color: 'dim', anchor: 'middle', parent: S.gridG });
            }
          }
          /* concat -> DiT */
          S.catG = ctx.group({ parent: g });
          ctx.path('M962,262 H978 V500 H962', { stroke: 'lime', sw: 1.6, parent: S.catG });
          S.catBox = ctx.node({ x: 1100, y: 381, w: 140, h: 238, title: '36 ch', sub: '× 21 × 90 × 160', color: 'lime', titleSize: 22, subSize: 11, parent: S.catG });
          S.lCat = ctx.link({ x: 980, y: 381 }, S.catBox, { to: 'l', color: 'lime', straight: true, parent: S.catG });
          S.dnode = ctx.node({ x: 1390, y: 381, w: 250, h: 84, title: 'DiT patchify', sub: 'Conv3d 36 → 5120 · 1×2×2', icon: 'film', color: 'lime', titleSize: 15, subSize: 11, parent: S.catG });
          S.lDit = ctx.link(S.catBox, S.dnode, { color: 'lime', parent: S.catG });
          ctx.text(1100, 534, '16 + 4 + 16', { size: 13, font: 'mono', color: 'lime', anchor: 'middle', parent: S.catG });
          /* keyframe image + VAE */
          S.imgG = ctx.group({ parent: g });
          ctx.rect(90, 580, 170, 128, { rx: 8, fill: '#071126', stroke: 'violet', sw: 1.4, parent: S.imgG });
          ctx.path('M92,690 Q175,664 258,690', { stroke: 'cyan', sw: 1.2, fill: ctx.alpha('cyan', 0.15), parent: S.imgG });
          fox(ctx, S.imgG, 175, 636, 1.9, 0, 0);
          ctx.text(175, 726, 'storyboard keyframe · shot 3', { size: 11.5, font: 'mono', color: 'violet', anchor: 'middle', parent: S.imgG });
          S.vae = ctx.node({ x: 360, y: 644, w: 120, h: 40, title: 'VAE encode', color: 'cyan', titleSize: 13, glow: false, parent: S.imgG });
          S.lImg = ctx.link({ x: 262, y: 644 }, S.vae, { to: 'l', color: 'violet', straight: true, parent: S.imgG });
          S.lVae = ctx.link(S.vae, { x: CX0 + CW / 2, y: 502 }, { from: 't', color: 'cyan', parent: S.imgG });
          /* mode chips + mask explainer */
          S.i2vChips = [chip(ctx, g, 620, 548, 90, 'I2V', function () { S.flf = false; i2vUpdate(ctx, S); }), chip(ctx, g, 730, 548, 100, 'FLF2V', function () { S.flf = true; i2vUpdate(ctx, S); })];
          S.expG = ctx.group({ parent: g });
          S.modeT = ctx.text(470, 606, '', { size: 12.5, font: 'mono', color: 'white', parent: S.expG });
          ctx.text(470, 632, 'mask: 81 pixel frames, frame 0 repeated ×4 → 84 = 21 × 4', { size: 12, font: 'mono', color: 'dim', parent: S.expG });
          ctx.text(470, 654, '⇒ 4 mask channels per latent frame (VAE is 4× in time)', { size: 12, font: 'mono', color: 'dim', parent: S.expG });
          ctx.text(470, 684, 'patch embedder widens (16 → 36); DiT blocks reused, plus a CLIP branch', { size: 12, font: 'mono', color: 'dim', parent: S.expG });
          /* route B */
          S.rb = ctx.group({ parent: g });
          ctx.rect(1000, 580, 550, 270, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('violet', 0.45), sw: 1.2, parent: S.rb });
          ctx.text(1020, 604, 'ROUTE B · keyframes as in-context tokens', { size: 14, font: 'display', weight: 700, color: 'violet', parent: S.rb });
          for (i = 0; i < 18; i++) {
            var isC = i < 4;
            ctx.rect(1020 + i * 28, 624, 24, 24, { rx: 3, fill: isC ? ctx.alpha('violet', 0.75) : ctx.cmap('lime', 0.25 + 0.5 * rnd()), parent: S.rb });
          }
          ctx.text(1072, 664, 'σ = 0', { size: 11.5, font: 'mono', color: 'violet', anchor: 'middle', parent: S.rb });
          ctx.text(1296, 664, 'noisy video tokens, σ = σₖ', { size: 11.5, font: 'mono', color: 'lime', anchor: 'middle', parent: S.rb });
          [['clean keyframe latent is patchified and joins the', 'text'], ['sequence with per-token timestep 0; attention copies it', 'text'], ['replace frame 0: HunyuanVideo-I2V, Wan 2.2 TI2V', 'dim'], ['or append at any index (LTX-Video): +1 frame of tokens', 'dim'], ['Wan 2.1 I2V also adds CLIP ViT-H tokens (257)', 'amber'], ['through a decoupled image cross-attention', 'amber']].forEach(function (l, k) {
            ctx.text(1020, 694 + k * 24, l[0], { size: 12, font: 'mono', color: l[1], parent: S.rb });
          });

          S.flf = false; S.firstOn = false;
          i2vUpdate(ctx, S);
          var chipGs = S.i2vChips.map(function (c) { return c.g; });
          tint(ctx);
          hide([S.gridG, S.catG, S.imgG, chipGs, S.expG, S.rb]);

          /* beat 0: the storyboard keyframe is VAE-encoded */
          return ctx.reveal(S.imgG, { from: 'left' }).then(function () {
            return ctx.packet(S.lImg, { color: 'violet', dur: 600 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: the three tensors, with the keyframe in frame 0 of the condition row */
            return ctx.reveal(S.gridG, { from: 'up' }).then(function () {
              return ctx.packet(S.lVae, { color: 'cyan', dur: 700, label: 'E(I₀)' });
            }).then(function () {
              S.firstOn = true; i2vUpdate(ctx, S);
              return ctx.pulse(S.maskCells[0].r, { color: 'white', dur: 600 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: 16 + 4 + 16 = 36 channels into a wider patch embedder */
            return Promise.all([ctx.reveal(S.catG, { from: 'right' }), ctx.reveal(S.expG, { from: 'up', delay: 400 })]).then(function () {
              return ctx.packet(S.lCat, { color: 'lime', dur: 400 });
            }).then(function () {
              return ctx.packet(S.lDit, { color: 'lime', dur: 600, label: '36 ch' });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: add a last frame */
            return ctx.reveal(chipGs, { from: 'up', stagger: 120 }).then(function () {
              S.flf = true; i2vUpdate(ctx, S);
              return ctx.pulse(S.maskCells[7].r, { color: 'white', times: 2, dur: 600 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: route B, keyframes as in-context tokens */
            return ctx.reveal(S.rb, { from: 'up' }).then(function () {
              return ctx.pulse(S.rb, { color: 'violet', dur: 700 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 3 */
      {
        title: 'Reference identity',
        beats: [
          {
            say: 'Keyframes pin one moment. Identity must hold everywhere. Reference to video models start from the fox\'s character sheet: three views from the production bible.',
            card: { tag: 'KEY IDEA', title: 'Identity must hold everywhere', body: 'A keyframe fixes one instant. A reference set fixes <i>who</i> is in every frame, from any angle.' },
            deep: '<p><b>Reference-to-video (R2V, subject-to-video)</b> conditions generation on a small set of images of a subject. In our pipeline the references are the character sheet from the production bible: front, three-quarter and side views of the fox in the same suit and helmet.</p>' +
              '<p>Unlike I2V, references carry no position in time: they say <i>who</i>, not <i>when</i>. The model must decide where and how the subject appears, including views the sheet never shows.</p>'
          },
          {
            say: 'The references are encoded by the VAE, patchified, and appended to the video sequence as clean tokens, each with its own position slot.',
            card: { tag: 'NUMBERS', title: 'The cost of three references', stat: { v: '+10,800', u: 'tokens', l: 'three references × 3,600 tokens: +14% sequence length and +31% attention FLOPs at 720p' }, more: '<p>n′ = 75,600 + 10,800 = 86,400. Attention grows by (86,400 / 75,600)² = 1.31, the linear layers by 1.14. Weighted by the 72% / 28% split of a block, the whole block costs about 26% more per pass.</p>' },
            deep: '<p>The references are VAE-encoded, patchified and concatenated to the video tokens as <i>clean</i> tokens (σ = 0), with a distinct RoPE slot (e.g. a temporal index outside 0…20) so the model can tell them apart from real frames.</p>' +
              '<div class="eq">X = [ x<sub>ref</sub><sup>(1..R)</sup> ; x<sub>vid</sub> ],&nbsp;&nbsp; n′ = n + R·3,600 &nbsp;(3 refs at 720p: +14%, attention +31%)</div>'
          },
          {
            say: 'Self attention then lets every fox token in every frame look up the reference, which acts like a content addressable visual dictionary.',
            card: { tag: 'KEY IDEA', title: 'Identity as a lookup', body: 'Fox-token queries in every frame find high-similarity keys in the reference block. No extra module: plain self-attention.' },
            deep: '<p>Self-attention does the rest: fox-token queries in every frame find high-similarity keys in the reference block, a content-addressable identity memory. Each video token can copy fur colour, suit details and the helmet crack from wherever they appear in the sheet.</p>' +
              '<p class="muted">The arcs on the stage are illustrative: real heads spread across the reference block and mix identity with pose and lighting information.</p>'
          },
          {
            say: 'A one way mask, and a timestep of zero for the references, make their keys and values independent of the noise level and of the video. So they can be computed once and cached across all fifty steps.',
            card: { tag: 'HOW IT WORKS', title: 'Compute the references once', body: 'If refs never attend to the video and sit at σ = 0, their K and V are identical at every step. Cache them: cost 1×, not 50×.' },
            deep: '<p>An optional one-way mask (refs do not attend to video), together with a per-token timestep of 0 for the refs, makes the reference K/V independent of σ and of the video, so it can be computed once per layer and cached across all 50 steps. The cost that remains is the longer sequence: at 720p with 3 refs, n grows 14% and attention FLOPs 31%.</p>' +
              '<p class="muted">The four blocks on the stage are the query × key partitions: ref→ref, ref→vid, vid→ref and vid→vid.</p>'
          },
          {
            say: 'The danger is copy and paste: the model pastes the reference pose and lighting into every frame. Methods such as Phantom fight this by training on references taken from different clips of the same subject.',
            card: { tag: 'PITFALL', title: 'The copy-paste shortcut', body: 'If training refs come from the same clip, pasting is the cheapest solution. Cross-pair references force real understanding.' },
            deep: '<p><b>Copy-paste failure:</b> if training pairs take the reference from the <i>same</i> clip, the cheapest solution is to paste its pose, crop and lighting. Fixes: <b>cross-pair data</b> (reference from a different clip of the same identity), strong augmentation and background removal, reference dropout.</p>' +
              '<p><b>Phantom</b> builds text–image–video triplets with cross-pair references and injects text and image jointly; <b>VACE</b> (Wan) feeds references as context tokens in a unified editing model; Veo’s <b>“ingredients to video”</b> exposes the same idea in a product. Identity is measured with face or subject embedding similarity (ArcFace for humans, DINOv2 or CLIP-I for stylised characters) against the references.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 2);
          title(ctx, g, 'REFERENCE-TO-VIDEO · identity as clean tokens inside self-attention');
          S.refG = ctx.group({ parent: g });
          [['front', 0], ['3/4 view', 0.6], ['side', 1]].forEach(function (r, i) {
            var x = 80 + i * 118;
            ctx.rect(x, 226, 104, 120, { rx: 8, fill: '#071126', stroke: 'violet', sw: 1.4, parent: S.refG });
            fox(ctx, S.refG, x + 52, 282, 2.1, 0, r[1]);
            ctx.text(x + 52, 362, r[0], { size: 11.5, font: 'mono', color: 'violet', anchor: 'middle', parent: S.refG });
          });
          ctx.text(80, 384, 'character sheet (production bible)', { size: 11.5, font: 'mono', color: 'dim', parent: S.refG });
          S.vaeLab = ctx.label(236, 414, 'VAE → patchify · σ = 0', { color: 'violet', size: 11.5, parent: g });
          /* video frames */
          S.vfG = ctx.group({ parent: g });
          var fpos = [[70, 40], [110, 70], [150, 95], [175, 104]];
          S.vfFox = [];
          [0, 7, 14, 20].forEach(function (t, i) {
            var x = 470 + i * 270;
            ctx.rect(x, 226, 240, 136, { rx: 8, fill: '#08101f', stroke: ctx.alpha('lime', 0.45), sw: 1.2, parent: S.vfG });
            ctx.path('M' + (x + 2) + ',340 Q' + (x + 120) + ',320 ' + (x + 238) + ',340', { stroke: 'cyan', sw: 1, fill: ctx.alpha('cyan', 0.1), parent: S.vfG });
            S.vfFox.push(fox(ctx, S.vfG, x + fpos[i][0], 226 + fpos[i][1] * 0.95, 1.2, 0, [0.5, 0.2, -0.3, -0.7][i]));
            ctx.text(x + 120, 378, 'frame t = ' + t, { size: 11.5, font: 'mono', color: 'lime', anchor: 'middle', parent: S.vfG });
          });
          /* token strip */
          S.stG = ctx.group({ parent: g });
          var r2 = ctx.rng(3);
          for (var i = 0; i < 18; i++) ctx.rect(80 + i * 20, 520, 18, 22, { rx: 3, fill: ctx.alpha('violet', 0.55 + 0.35 * r2()), parent: S.stG });
          for (i = 0; i < 42; i++) ctx.rect(480 + i * 20, 520, 18, 22, { rx: 3, fill: ctx.cmap('lime', 0.25 + 0.45 * r2()), parent: S.stG });
          [1, 2].forEach(function (k) { ctx.line(80 + k * 120 - 1, 514, 80 + k * 120 - 1, 548, { color: ctx.alpha('white', 0.5), sw: 1, parent: S.stG }); });
          ctx.text(258, 564, 'ref tokens · 3 × 3,600 · σ = 0 · own RoPE slot', { size: 11.5, font: 'mono', color: 'violet', anchor: 'middle', parent: S.stG });
          ctx.text(898, 564, 'video tokens · 21 × 3,600 · noised · t = 0…20', { size: 11.5, font: 'mono', color: 'lime', anchor: 'middle', parent: S.stG });
          ctx.text(1340, 531, 'n′ = 75,600 + 10,800', { size: 12.5, font: 'mono', color: 'white', parent: S.stG });
          /* attention arcs from video segments back to ref segment */
          S.arcG = ctx.group({ parent: g });
          S.arcs = [];
          [560, 760, 960, 1160].forEach(function (sx, k) {
            var tx = 110 + k * 90;
            S.arcs.push(ctx.path('M' + sx + ',516 Q' + ((sx + tx) / 2) + ',' + (440 - k * 6) + ' ' + tx + ',516', { stroke: 'magenta', sw: 1.6, arrow: true, opacity: 0.85, parent: S.arcG }));
          });
          ctx.text(760, 440, 'fox-token queries → reference keys (identity lookup)', { size: 12, font: 'mono', color: 'magenta', anchor: 'middle', parent: S.arcG });
          /* mask blocks */
          S.mkG = ctx.group({ parent: g });
          ctx.text(80, 612, 'ATTENTION BLOCKS  (query ↓ × key →)', { size: 13, font: 'display', weight: 700, color: 'white', parent: S.mkG });
          var bx = 150, by = 640, bs = 96;
          [['ref→ref', 0, 0, 'violet', null], ['ref→vid', 0, 1, 'dim', '5 4'], ['vid→ref', 1, 0, 'magenta', null], ['vid→vid', 1, 1, 'lime', null]].forEach(function (b) {
            ctx.rect(bx + b[2] * (bs + 4), by + b[1] * (bs + 4), bs, bs, { rx: 6, fill: b[4] ? 'none' : ctx.alpha(b[3], 0.25), stroke: b[3], sw: 1.4, dash: b[4], parent: S.mkG });
            ctx.text(bx + b[2] * (bs + 4) + bs / 2, by + b[1] * (bs + 4) + bs / 2, b[0], { size: 12, font: 'mono', color: b[3], anchor: 'middle', parent: S.mkG });
          });
          ctx.text(bx - 10, by + bs / 2, 'ref', { size: 11.5, font: 'mono', color: 'violet', anchor: 'end', parent: S.mkG });
          ctx.text(bx - 10, by + bs * 1.5 + 4, 'vid', { size: 11.5, font: 'mono', color: 'lime', anchor: 'end', parent: S.mkG });
          [['vid→ref = the identity lookup', 'magenta'], ['ref→vid optional: masking it makes', 'dim'], ['ref K/V independent of σ ⇒ compute', 'dim'], ['once, cache for all 50 steps', 'dim'], ['cost at 720p, 3 refs: n +14%,', 'text'], ['attention FLOPs +31%', 'text']].forEach(function (l, k) {
            ctx.text(370, 660 + k * 26, l[0], { size: 12, font: 'mono', color: l[1], parent: S.mkG });
          });
          /* failure & fixes */
          S.fxG = ctx.group({ parent: g });
          ctx.rect(820, 596, 730, 264, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('red', 0.45), sw: 1.2, parent: S.fxG });
          ctx.text(840, 620, 'COPY-PASTE FAILURE → FIXES', { size: 14, font: 'display', weight: 700, color: 'red', parent: S.fxG });
          [['symptom: reference pose / crop / lighting pasted into frames;', 'text'], ['         the fox cannot turn around or change expression', 'text'], ['cause:   training ref = a frame of the same clip (trivial shortcut)', 'dim'],
            ['fix:     cross-pair refs (another clip of the same subject),', 'lime'], ['         augmentation, background removal, ref dropout', 'lime'], ['Phantom: text-image-video triplets, joint text+image injection', 'dim'],
            ['VACE (Wan): refs as context tokens in one editing model', 'dim'], ['Veo "ingredients to video": several refs → one clip', 'dim']].forEach(function (l, k) {
            ctx.text(840, 648 + k * 26, l[0], { size: 12, font: 'code', pre: true, color: l[1], parent: S.fxG });
          });
          tint(ctx);
          hide([S.refG, S.vfG, S.vaeLab, S.stG, S.arcG, S.arcs, S.mkG, S.fxG]);

          /* beat 0: the character sheet and the frames to be generated */
          return Promise.all([ctx.reveal(S.refG, { from: 'left' }), ctx.reveal(S.vfG, { from: 'right', delay: 300 })]).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: refs become clean tokens in the sequence */
            return Promise.all([ctx.reveal(S.vaeLab, { from: 'up' }), ctx.reveal(S.stG, { from: 'up', delay: 300 })]).then(function () {
              return ctx.pulse(S.stG, { color: 'violet', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: video queries look up the reference */
            return Promise.all([ctx.reveal(S.arcG, { dur: 300 }), ctx.reveal(S.arcs, { from: 'draw', dur: 800, stagger: 180, opacity: 0.85 })]).then(function () {
              return Promise.all(S.arcs.map(function (a) { return ctx.packet(a, { color: 'magenta', dur: 800, r: 4 }); }));
            }).then(function () {
              return Promise.all(S.vfFox.map(function (f) { return ctx.pulse(f, { color: 'violet', dur: 700 }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: attention blocks and caching */
            return ctx.reveal(S.mkG, { from: 'up' }).then(function () {
              return ctx.pulse(S.mkG, { color: 'magenta', dur: 700 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: copy-paste failure and its fixes */
            return ctx.reveal(S.fxG, { from: 'up' });
          });
        }
      },
      /* ------------------------------------------------------------------ 4 */
      {
        title: 'Camera control',
        beats: [
          {
            say: 'Camera moves are directed with geometry, not adjectives. For each frame, the agent specifies a camera pose along a path, here a slow dolly in that orbits the fox.',
            card: { tag: 'KEY IDEA', title: 'Geometry, not adjectives', body: 'The cinematographer agent emits a camera JSON: per-frame extrinsics, field of view, look-at target. A tool validates it before any GPU runs.' },
            deep: '<p><b>Agent side:</b> the cinematographer agent emits a camera JSON (path type, per-frame extrinsics [R|t], FOV), validated by a tool before rendering: smooth, no clipping through the moon surface, target stays in frame. Text-only camera words (“slow dolly in”) remain the cheap, imprecise fallback: they steer statistically, cannot be verified and mix badly with subject motion.</p>' +
              '<p><b>Related:</b> ReCamMaster re-renders an existing clip along a new trajectory.</p>'
          },
          {
            say: 'For every pixel, that pose defines a ray, with an origin at the camera centre and a direction through the pixel. Click the dashed orbit to place the camera yourself, and watch the direction map turn.',
            card: { tag: 'TRY IT', title: 'Click the orbit, move the camera', body: 'The frustum jumps to the clicked point and the ray-direction map recolours to match. Click away from the path to resume the orbit.' },
            deep: '<p>Per frame f with intrinsics K and extrinsics [R|t], every pixel (u, v) defines a ray:</p>' +
              '<div class="eq">o = −Rᵀt,&nbsp;&nbsp; d = normalize(Rᵀ K⁻¹ [u, v, 1]ᵀ)</div>' +
              '<p>The coloured grid shows the direction d as RGB = (x, y, z) for an 8 × 8 subsample of the 720 × 1280 pixels. As the camera dollies in and orbits, the whole map rotates smoothly with it; the camera centre o moves, but every pixel of a frame shares the same o.</p>'
          },
          {
            say: 'A Plücker embedding encodes the ray as six numbers: its direction, and its moment, the cross product of the camera origin and the direction. The moment stays the same wherever you slide the origin along the ray.',
            card: { tag: 'KEY IDEA', title: 'Six numbers per ray', body: 'Plücker coordinates (o × d, d) are dense, treat intrinsics and extrinsics uniformly, and are invariant to where o sits on the ray.', more: '<p>Slide the origin along the ray: o′ = o + λd. Then o′ × d = o × d + λ (d × d) = o × d, because a vector crossed with itself is zero. The moment therefore identifies the ray, not the point you happened to pick on it.</p>' },
            deep: '<div class="eq">p(u, v) = (o × d, d) ∈ ℝ⁶</div>' +
              '<p><b>Why Plücker:</b> (o × d, d) is invariant to where o slides along the ray, dense (one vector per pixel), and encodes intrinsics and extrinsics uniformly, so the network sees geometry in the same spatial layout as the latent. Feeding the raw 12 numbers of [R|t] per frame (MotionCtrl) also works, but in CameraCtrl’s ablation Plücker maps gave lower translation and rotation errors than raw camera parameters (12.98 vs 13.88 and 1.29 vs 1.51).</p>' +
              '<pre>d = normalize(R.T @ inv(K) @ uv1)\no = -R.T @ t\np = cat([cross(o, d), d])</pre>' +
              '<p class="muted">uv1 = [u, v, 1] per pixel; p is 6 × H × W per frame.</p>'
          },
          {
            say: 'These maps are patchified like the latent and added to the video tokens, so every token knows exactly which ray it sees.',
            card: { tag: 'HOW IT WORKS', title: 'Added to the video tokens', body: 'A small encoder reduces the 6 × 81 × H × W map to the latent grid, projects it to width d, and adds it token by token.' },
            deep: '<p><b>Injection:</b> the 6 × 81 × H × W map is reduced to the latent grid (pixel-unshuffle or strided conv to 21 × 45 × 80), projected to d and <i>added</i> to the video tokens (or fed through an adapter). In DiT-based systems such as AC3D the camera branch is ControlNet-style and summed into the video tokens, so the base model can stay frozen while only the camera encoder and adapter are trained.</p>'
          },
          {
            say: 'Variants differ in where they inject. CameraCtrl used temporal attention in a U-Net, AC three D adds the signal only to the early blocks of a DiT, and text words such as slow dolly in remain the imprecise fallback.',
            card: { tag: 'STATE OF THE ART', title: 'Camera motion is low frequency', body: 'AC3D found that conditioning only the early blocks, mostly at high noise, is enough: camera motion is decided early.' },
            deep: '<p>CameraCtrl added the map to the temporal-attention layers of a U-Net (AnimateDiff). In DiTs, AC3D (on an 11.5 B, 32-block video DiT) injects the camera only into the first 8 blocks and only during the first ~40% of the reverse trajectory, the high-noise part, because camera motion is low-frequency information resolved early in both depth and denoising time.</p>' +
              '<p>The variants list on the stage maps the design space: where to inject, how much of the network, how much of the trajectory. Fewer conditioned blocks also means less interference with the base model’s appearance prior.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 3);
          title(ctx, g, 'CAMERA CONTROL · per-pixel Plücker rays');
          /* world view */
          S.wv = ctx.group({ parent: g });
          ctx.rect(70, 216, 630, 400, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('blue', 0.45), sw: 1.2, parent: S.wv });
          ctx.text(90, 240, 'top-down · "slow dolly-in + orbit", 81 frames', { size: 12, font: 'mono', color: 'blue', parent: S.wv });
          ctx.el('ellipse', { cx: 380, cy: 420, rx: 295, ry: 160, fill: ctx.alpha('cyan', 0.06), stroke: ctx.alpha('cyan', 0.35), 'stroke-width': 1, 'stroke-dasharray': '4 6' }, S.wv);
          ctx.text(610, 596, 'ice-moon surface', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.wv });
          fox(ctx, S.wv, 380, 350, 1.7, 0, 0);
          var d = '';
          for (var i = 0; i <= 30; i++) { var p = camScreen(camPos(i / 30)); d += (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }
          S.camPath = ctx.path(d, { stroke: 'blue', sw: 2, dash: '6 5', arrow: true, parent: S.wv });
          [0, 0.25, 0.5, 0.75, 1].forEach(function (s) {
            var fr = frustum(ctx, S.wv, 'blue', 0.35);
            var o = camScreen(camPos(s)), tg = camScreen(v3(0, 0.3, 0));
            ctx.place(fr, o.x, o.y, 0.8, Math.atan2(tg.y - o.y, tg.x - o.x) * 180 / Math.PI);
          });
          S.camFr = frustum(ctx, S.wv, 'lime');
          S.camRead = ctx.text(90, 600, '', { size: 12, font: 'mono', color: 'lime', parent: S.wv });
          /* plücker maps: direction, then moment */
          S.pkD = ctx.group({ parent: g });
          ctx.text(740, 240, 'Plücker map of the current frame (8 × 8 of 720 × 1280 px)', { size: 12, font: 'mono', color: 'text', parent: S.pkD });
          ctx.text(827, 268, 'direction d', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.pkD });
          S.dGrid = ctx.matrix(740, 282, 8, 8, { cell: 20, gap: 2, values: function () { return '#222'; }, parent: S.pkD });
          ctx.text(740, 480, 'RGB = (x, y, z) components · 6 channels per pixel', { size: 11.5, font: 'mono', color: 'dim', parent: S.pkD });
          [['o = −Rᵀt   (camera centre)', 'text', 0], ['d = normalize(Rᵀ K⁻¹ [u, v, 1]ᵀ)', 'text', 1]].forEach(function (l) {
            ctx.text(740, 516 + l[2] * 26, l[0], { size: 13, font: 'code', pre: true, color: l[1], parent: S.pkD });
          });
          S.pkM = ctx.group({ parent: g });
          ctx.text(1017, 268, 'moment m = o × d', { size: 12, font: 'mono', color: 'white', anchor: 'middle', parent: S.pkM });
          S.mGrid = ctx.matrix(930, 282, 8, 8, { cell: 20, gap: 2, values: function () { return '#222'; }, parent: S.pkM });
          [['p(u, v) = (o × d, d) ∈ ℝ⁶', 'white', 2], ['invariant to sliding o along the ray', 'dim', 3]].forEach(function (l) {
            ctx.text(740, 516 + l[2] * 26, l[0], { size: 13, font: 'code', pre: true, color: l[1], parent: S.pkM });
          });
          /* injection chain */
          S.ch = ctx.group({ parent: g });
          var cn = [
            ctx.node({ x: 1350, y: 262, w: 300, h: 54, title: 'Plücker maps', sub: '6 × 81 × 720 × 1280', color: 'blue', titleSize: 14, subSize: 11, parent: S.ch }),
            ctx.node({ x: 1350, y: 362, w: 300, h: 54, title: 'Camera encoder', sub: 'unshuffle/conv → 21 × 45 × 80 × d', color: 'blue', titleSize: 14, subSize: 11, parent: S.ch }),
            ctx.node({ x: 1350, y: 462, w: 300, h: 54, title: '⊕ video tokens', sub: 'early blocks only (camera = low freq)', color: 'lime', titleSize: 14, subSize: 11, parent: S.ch }),
            ctx.node({ x: 1350, y: 562, w: 300, h: 54, title: 'DiT', sub: 'base frozen · adapter trained', icon: 'film', color: 'lime', titleSize: 14, subSize: 11, parent: S.ch })
          ];
          S.chL = [];
          for (i = 0; i < 3; i++) S.chL.push(ctx.link(cn[i], cn[i + 1], { from: 'b', to: 't', color: 'blue', parent: S.ch }));
          /* bottom: agent json + variants */
          S.cj = ctx.code({ parent: g, x: 70, y: 648, w: 630, title: 'cinematographer agent → render_shot(camera=…)', lang: 'json', typing: true, maxLines: 5, color: 'blue', lines: [
            '{"shot": 3, "path": "dolly_in+orbit", "frames": 81,',
            ' "look_at": "fox", "fov_deg": 40, "speed": "slow",',
            ' "extrinsics": "[R|t] x 81 (validated, smooth)",',
            ' "encode": "plucker", "strength": 1.0}'
          ] });
          S.vr = ctx.group({ parent: g });
          [['CameraCtrl: Plücker → camera encoder → temporal attention (U-Net)', 'text'], ['AC3D: DiT, condition early blocks only (camera = low freq)', 'text'], ['camera tokens: per-frame pose embedded as extra tokens', 'dim'], ['ReCamMaster: re-render an existing clip along a new path', 'dim'], ['fallback: text ("slow dolly in") — imprecise, unverifiable', 'amber']].forEach(function (l, k) {
            ctx.text(740, 676 + k * 30, l[0], { size: 12.5, font: 'mono', color: l[1], parent: S.vr });
          });

          camUpdate(ctx, S, 0);
          /* TRY IT: clicking near the orbit places the camera there (the loop of beat 2 honours S.camHold); clicking away resumes the orbit */
          S.camHold = null;
          S.camHint = ctx.label(600, 240, 'CLICK THE ORBIT', { color: 'cyan', size: 11.5, opacity: 0, parent: S.wv });
          var pathPts = [];
          for (i = 0; i <= 60; i++) pathPts.push(camScreen(camPos(i / 60)));
          S.wv.style.cursor = 'pointer';
          S.wv.addEventListener('click', function (e) {
            if (!S.camLoop) return;
            var svg = S.wv.ownerSVGElement, mtx = S.wv.getScreenCTM();
            if (!svg || !mtx) return;
            var pt = svg.createSVGPoint();
            pt.x = e.clientX; pt.y = e.clientY;
            var p = pt.matrixTransform(mtx.inverse());
            var best = 0, bd = 1e9;
            pathPts.forEach(function (q, k) { var d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = k; } });
            S.camHold = bd < 60 ? best / 60 : null;
            camUpdate(ctx, S, S.camHold !== null ? S.camHold : 0.5);
          });
          tint(ctx);
          hide([S.wv, S.camPath, S.pkD, S.pkM, S.ch, S.cj, S.vr]);

          /* beat 0: a camera path around the fox, written as JSON */
          return Promise.all([ctx.reveal(S.wv, { from: 'left' }), ctx.reveal(S.camPath, { from: 'draw', dur: 1200, delay: 300 }), ctx.reveal(S.cj, { from: 'up', delay: 600 })]).then(function () {
            return Promise.all([S.cj.typeAll(), ctx.tween(3200, function (t) { camUpdate(ctx, S, t); }, 'inOut')]);
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: a ray per pixel; the direction map turns with the camera */
            var t0 = null;
            S.camLoop = ctx.loop(function (t) { if (t0 === null) t0 = t; camUpdate(ctx, S, S.camHold !== null ? S.camHold : 0.5 + 0.5 * Math.cos((t - t0) * 0.6)); });
            return Promise.all([ctx.reveal(S.pkD, { from: 'up' }), ctx.reveal(S.camHint, { from: 'left', delay: 300 })]).then(function () {
              return ctx.pulse(S.dGrid, { color: 'cyan', dur: 700 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the moment completes the Plücker embedding */
            return ctx.reveal(S.pkM, { from: 'up' }).then(function () {
              return ctx.pulse(S.mGrid, { color: 'violet', dur: 700 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: encoder and injection into the video tokens */
            return ctx.reveal(S.ch, { from: 'right' }).then(function () {
              return S.chL.reduce(function (p, l) { return p.then(function () { return ctx.packet(l, { color: 'blue', dur: 450 }); }); }, Promise.resolve());
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: design variants */
            return ctx.reveal(S.vr, { from: 'up' });
          });
        }
      },
      /* ------------------------------------------------------------------ 5 */
      {
        title: 'Motion & structure',
        beats: [
          {
            say: 'Motion control works the same way, at a finer grain. The creator sketches the crash trajectory, and it becomes a point track: one position per latent frame.',
            card: { tag: 'HOW IT WORKS', title: 'A sketch becomes a track', body: 'A hand-drawn path is sampled into one point per latent frame: 21 positions that say where the fox must be, and when.' },
            deep: '<p><b>Signals:</b> sparse point tracks (drag / trajectory), dense optical flow, depth, edges, human pose, segmentation masks. Each is rendered as a control video and encoded (VAE or a light conv stem) to the latent grid 21 × 90 × 160.</p>' +
              '<p>The creator’s sketch needs no annotation tool: the agent samples the stroke at 21 equally spaced times, one per latent frame, and hands the track to the renderer.</p>'
          },
          {
            say: 'Each point is rendered as a Gaussian heat map on the latent grid, one map per frame. Depth maps from a rough blockout, or pose skeletons, give structure in the same way.',
            card: { tag: 'HOW IT WORKS', title: 'Everything becomes a control video', body: 'Tracks, depth and pose are rendered as image sequences on the latent grid, so one adapter design serves all of them.' },
            deep: '<div class="eq">G<sub>t</sub>(h, w) = exp(−‖(h, w) − p(t)‖² / 2s²)&nbsp;&nbsp; (trajectory map per latent frame)</div>' +
              '<p>The standard deviation s sets how strictly the object must sit on the track. Depth from a cheap 3D blockout fixes composition and perspective; pose skeletons fix a character’s limbs. All arrive as a 21 × 90 × 160 control latent.</p>' +
              '<p>Training needs no manual labels: control videos are extracted from the training clips themselves, with a point tracker for trajectories, a monocular depth network for depth and an off-the-shelf estimator for pose.</p>'
          },
          {
            say: 'These control videos feed an adapter: a trainable copy of the first few blocks of the network, whose outputs are added to the frozen model.',
            card: { tag: 'HOW IT WORKS', title: 'A trainable copy, base frozen', body: 'The adapter copies the first N blocks and processes the control latents. The base DiT stays frozen (lock icons).' },
            deep: '<p><b>ControlNet-style adapter</b> (Zhang, Rao &amp; Agrawala): copy the first N blocks as a trainable branch; its output enters block i of the frozen DiT through a projection Z<sub>i</sub>.</p>' +
              '<p><b>VACE</b> (Wan) generalises this: “context blocks” inserted every k-th layer (every fifth, 8 blocks in the Wan-14B version) consume a unified context (depth, pose, flow, masks, references), so one set of weights serves all editing tasks.</p>'
          },
          {
            say: 'Its outputs are added through zero initialized projections. Training therefore starts from the unmodified model and cannot damage it on day one, and the projections learn to open as training proceeds.',
            card: { tag: 'KEY IDEA', title: 'Zero-init: start as the base model', body: 'Z = 0 at step 0, so the network is exactly the pretrained one. Control strength is a tunable scale on Z.', more: '<p>At inference the branch is added as h + s·Z·A(c). Turning s from 0 to about 1 slides from the base model to full control; values below 1 let the prompt override the track where it conflicts, which is useful when a sketch is only approximate.</p>' },
            deep: '<div class="eq">h<sub>i</sub> ← h<sub>i</sub> + Z<sub>i</sub> · A<sub>i</sub>(c<sub>ctrl</sub>, h),&nbsp;&nbsp; Z<sub>i</sub> = 0 at init</div>' +
              '<p>At step 0 the model is exactly the base model, so fine-tuning cannot destroy its prior. Z receives a non-zero gradient immediately, so it leaves zero after the first update and the adapter A then starts to learn. The same trick appears in adaLN-Zero and in LoRA’s zero-initialised B.</p>'
          },
          {
            say: 'Related methods control motion without an adapter: Tora and Motion Prompting condition on trajectories, and Go with the Flow warps the initial noise along optical flow. An eight block adapter costs about twenty percent extra compute.',
            card: { tag: 'NUMBERS', title: 'What an adapter costs', stat: { v: '+20%', u: 'FLOPs per step', l: 'for an 8-block adapter on a 40-block DiT; LoRA-style adapters are cheaper but weaker for dense structure' } },
            deep: '<p><b>Trajectory methods:</b> DragNUWA, Tora (trajectory-oriented DiT) and Motion Prompting (sparse-to-dense point tracks). <b>Go-with-the-Flow</b> instead warps the <i>noise</i> along optical flow, so motion is controlled without any architecture change.</p>' +
              '<p>Cost: an adapter of N = 8 blocks on Wan 14B adds about 20% FLOPs per step (8 of 40 blocks, taking the control sequence to be as long as the video); LoRA-style adapters on the attention projections are cheaper but weaker for dense structure.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.camLoop) { S.camLoop.stop(); S.camLoop = null; }
          var g = swap(ctx, S, 4);
          title(ctx, g, 'MOTION & STRUCTURE · tracks, depth, pose → zero-init adapters');
          /* sketch frame */
          S.sk = ctx.group({ parent: g });
          ctx.rect(70, 226, 480, 270, { rx: 8, fill: '#071126', stroke: ctx.alpha('orange', 0.5), sw: 1.2, parent: S.sk });
          ctx.path('M72,462 Q310,420 548,462 L548,494 L72,494 Z', { fill: ctx.alpha('cyan', 0.18), stroke: 'cyan', sw: 1, parent: S.sk });
          S.track = ctx.path('M110,262 C230,272 340,370 460,440', { stroke: 'orange', sw: 2.4, dash: '7 5', arrow: true, parent: S.sk });
          var L = S.track.getTotalLength();
          S.trackPts = [];
          for (var i = 0; i <= 20; i++) {
            var p = S.track.getPointAtLength(L * i / 20);
            S.trackPts.push({ x: p.x, y: p.y });
            ctx.circle(p.x, p.y, 2.6, { fill: 'orange', opacity: 0.8, parent: S.sk });
          }
          S.mfox = fox(ctx, S.sk, 110, 262, 1.3, 0, 0.4);
          ctx.text(70, 514, 'creator sketch → point track p(t), t = 0…20 (one dot per latent frame)', { size: 12, font: 'mono', color: 'orange', parent: S.sk });
          /* heatmaps */
          S.hm = ctx.group({ parent: g });
          ctx.text(600, 240, 'track → Gaussian map per latent frame', { size: 12, font: 'mono', color: 'text', parent: S.hm });
          S.hmaps = [];
          [[0, 600, 258], [7, 790, 258], [14, 600, 382], [20, 790, 382]].forEach(function (h) {
            var pt = S.trackPts[h[0]];
            var gu = (pt.x - 70) / 480 * 10, gv = (pt.y - 226) / 270 * 6;
            ctx.rect(h[1] - 4, h[2] - 4, 157, 97, { rx: 4, stroke: ctx.alpha('orange', 0.45), sw: 1, parent: S.hm });
            var m = ctx.matrix(h[1], h[2], 6, 10, { cell: 14, gap: 1.5, cmap: 'heat', values: function (r, c) { return Math.exp(-(Math.pow(c + 0.5 - gu, 2) + Math.pow(r + 0.5 - gv, 2)) / 2.2); }, parent: S.hm });
            S.hmaps.push(m);
            ctx.text(h[1] + 76, h[2] + 102, 't = ' + h[0], { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: S.hm });
          });
          ctx.text(600, 520, 'depth (blockout render)', { size: 12, font: 'mono', color: 'text', parent: S.hm });
          ctx.matrix(600, 534, 6, 10, { cell: 14, gap: 1.5, cmap: 'violet', values: function (r, c) { return Math.min(1, 0.15 + r * 0.14 + (Math.abs(c - 6) < 2 && r > 1 && r < 5 ? 0.35 : 0)); }, parent: S.hm });
          ctx.text(790, 520, 'pose / edges', { size: 12, font: 'mono', color: 'text', parent: S.hm });
          var pg = ctx.group({ parent: S.hm });
          ctx.rect(790, 534, 149, 89, { rx: 3, fill: '#0a1120', parent: pg });
          ctx.path('M840,560 L860,575 L900,572 L915,590 M860,575 L850,605 M900,572 L905,605 M840,560 L832,550 M840,560 L848,548', { stroke: 'orange', sw: 2, parent: pg });
          [[840, 560], [860, 575], [900, 572], [915, 590], [850, 605], [905, 605]].forEach(function (q) { ctx.circle(q[0], q[1], 2.6, { fill: 'white', parent: pg }); });
          /* adapter diagram */
          S.ad = ctx.group({ parent: g });
          ctx.text(1010, 240, 'ADAPTER (ControlNet / VACE style)', { size: 14, font: 'display', weight: 700, color: 'white', parent: S.ad });
          var cin = ctx.node({ x: 1120, y: 290, w: 200, h: 44, title: 'control latents', sub: 'track · depth · pose', color: 'orange', titleSize: 13, subSize: 10.5, parent: S.ad });
          S.adL = [];
          S.zb = [];
          S.zt = [];
          for (i = 0; i < 6; i++) {
            var y = 350 + i * 44;
            ctx.rect(1400, y, 150, 34, { rx: 5, fill: ctx.alpha('lime', 0.1), stroke: ctx.alpha('lime', 0.7), sw: 1.2, parent: S.ad });
            ctx.text(1475, y + 17.5, 'DiT block ' + (i + 1) + (i === 5 ? ' … 40' : ''), { size: 11.5, font: 'mono', color: 'lime', anchor: 'middle', parent: S.ad });
            ctx.icon('lock', 1540, y + 17, 12, 'dim', { parent: S.ad });
            if (i < 3) {
              ctx.rect(1040, y, 160, 34, { rx: 5, fill: ctx.alpha('orange', 0.18), stroke: 'orange', sw: 1.2, parent: S.ad });
              ctx.text(1120, y + 17.5, 'adapter ' + (i + 1) + ' (trainable)', { size: 11.5, font: 'mono', color: 'orange', anchor: 'middle', parent: S.ad });
              S.zb.push(ctx.rect(1262, y + 5, 44, 24, { rx: 4, fill: ctx.alpha('magenta', 0.2), stroke: 'magenta', sw: 1.2, parent: S.ad }));
              S.zt.push(ctx.text(1284, y + 17.5, 'Z=0', { size: 11, font: 'mono', color: 'magenta', anchor: 'middle', parent: S.ad }));
              ctx.line(1200, y + 17, 1260, y + 17, { color: 'orange', sw: 1.4, arrow: true, parent: S.ad });
              S.adL.push(ctx.link({ x: 1306, y: y + 17 }, { x: 1398, y: y + 17 }, { color: 'magenta', straight: true, parent: S.ad }));
              if (i < 2) ctx.line(1120, y + 34, 1120, y + 44, { color: 'orange', sw: 1.4, parent: S.ad });
            }
            if (i < 5) ctx.line(1475, y + 34, 1475, y + 44, { color: ctx.alpha('lime', 0.7), sw: 1.4, parent: S.ad });
          }
          ctx.line(1120, 312, 1120, 348, { color: 'orange', sw: 1.4, arrow: true, parent: S.ad });
          ctx.text(1040, 500, 'copies of the first N blocks', { size: 11.5, font: 'mono', color: 'dim', parent: S.ad });
          ctx.text(1040, 518, 'feed the frozen stream via Z', { size: 11.5, font: 'mono', color: 'dim', parent: S.ad });
          S.zState = ctx.text(1040, 552, 'step 0 · Z = 0 → adapter silent', { size: 11.5, font: 'mono', color: 'amber', weight: 600, parent: g });
          /* bottom equation + methods */
          S.eqE = ctx.text(70, 680, 'hᵢ ← hᵢ + Zᵢ · Aᵢ(c_ctrl, h),   Zᵢ = 0 at init  ⇒  fθ unchanged at training step 0', { size: 17, font: 'mono', color: 'white', parent: g });
          S.eqM = ctx.group({ parent: g });
          [['ControlNet: trainable encoder copy + zero-convs  ·  VACE (Wan): context blocks every k-th layer, one model for depth / pose / flow / mask / refs', 'text'],
            ['Tora, DragNUWA, Motion Prompting: trajectory maps or sparse → dense point tracks as the control signal', 'dim'],
            ['Go-with-the-Flow: warp the initial noise along optical flow — motion control with no architecture change', 'dim'],
            ['cost: an 8-block adapter on a 40-block DiT adds ~20% FLOPs per step; control strength is a tunable scale on Z', 'amber']].forEach(function (l, k) {
            ctx.text(70, 718 + k * 30, l[0], { size: 12.5, font: 'mono', color: l[1], parent: S.eqM });
          });
          tint(ctx);
          hide([S.sk, S.track, S.hm, S.hmaps, S.ad, S.eqE, S.eqM, S.zState]);

          /* beat 0: the sketch becomes a track and the fox follows it */
          return Promise.all([ctx.reveal(S.sk, { from: 'left' }), ctx.reveal(S.track, { from: 'draw', dur: 1200, delay: 200 })]).then(function () {
            return ctx.tween(2400, function (t) {
              var q = S.track.getPointAtLength(L * t);
              ctx.place(S.mfox, q.x, q.y, 1.3);
            }, 'inOut');
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: Gaussian heat maps, depth and pose */
            return Promise.all([ctx.reveal(S.hm, { from: 'up' }), ctx.reveal(S.hmaps, { from: 'scale', delay: 200, stagger: 150 })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the adapter, a trainable copy beside the frozen blocks */
            return ctx.reveal(S.ad, { from: 'right' }).then(function () {
              return Promise.all(S.adL.map(function (l) { return ctx.packet(l, { color: 'magenta', dur: 600 }); }));
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: zero-initialised projections */
            return Promise.all([ctx.reveal(S.eqE, { from: 'up' }), ctx.reveal(S.zState, { from: 'up' })].concat(S.zb.map(function (z) { return ctx.pulse(z, { color: 'magenta', times: 2, dur: 600 }); }))).then(function () {
              /* at initialisation the adapter is silent; training opens Z and control flows into the frozen blocks */
              S.zState.textContent = 'trained · Z ≠ 0 → control flows in';
              S.zState.setAttribute('fill', ctx.C.lime);
              S.zt.forEach(function (t) { t.textContent = 'Z≠0'; });
              return Promise.all(S.adL.map(function (l) { return ctx.packet(l, { color: 'magenta', dur: 600 }); }));
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: related methods and the cost */
            return ctx.reveal(S.eqM, { from: 'up' });
          });
        }
      },
      /* ------------------------------------------------------------------ 6 */
      {
        title: 'Character LoRA',
        beats: [
          {
            say: 'For the strongest identity, the system trains a LoRA on the fox. Every weight matrix of the base model stays frozen.',
            card: { tag: 'KEY IDEA', title: 'Teach the fox once', body: 'A LoRA bakes the character into the model. After a short fine-tune, the trigger word alone summons the fox in any shot.' },
            deep: '<p>The matrix on the stage stands for one 5120 × 5120 projection of the 14 B model: 26.2 M weights, frozen (lock icon). Fine-tuning all 14 B parameters per character would need optimizer state well beyond 100 GB and a 28 GB checkpoint per fox. LoRA learns a tiny correction instead and leaves W untouched.</p>' +
              '<p>Because W never changes, one base model in GPU memory can serve every character; the correction is just a small extra file.</p>'
          },
          {
            say: 'The fine tune learns only a low rank update: the product of a tall matrix B and a wide matrix A, of rank thirty two. B starts at zero, so training begins from the unchanged model.',
            card: { tag: 'KEY IDEA', title: 'A low-rank update', body: 'ΔW = (α / r) · B · A with r = 32: two thin matrices instead of a full 5120 × 5120 correction.', more: '<p>Low rank works in practice because fine-tuning updates appear to have a low intrinsic rank (the LoRA paper’s hypothesis): adapting a pretrained model to one subject moves the weights along a few directions, not thousands.</p>' },
            deep: '<div class="eq">W′ = W + (α / r) · B A,&nbsp;&nbsp; B ∈ ℝ<sup>d<sub>out</sub>×r</sup>, A ∈ ℝ<sup>r×d<sub>in</sub></sup>, B<sub>0</sub> = 0</div>' +
              '<p>B starts at zero, so W′ = W at step 0 (the same trick as adaLN-Zero and ControlNet’s zero-convs). Parameters per adapted linear: r·(d<sub>in</sub> + d<sub>out</sub>). The animation is a rank-2 toy: every row of ΔW is a mix of A’s rows.</p>' +
              '<details><summary>Go deeper</summary><p>With G = ∂L/∂W′ (the ordinary full-weight gradient), the two factors receive ∂L/∂B = (α/r)·G·Aᵀ and ∂L/∂A = (α/r)·Bᵀ·G. At B = 0 only B moves in the first step, so the update starts inside the row space of the random A and grows from there: LoRA is gradient descent restricted to rank-r matrices.</p></details>'
          },
          {
            say: 'Across all attention and feed forward layers of the fourteen billion parameter model, that is about one hundred fifty million parameters, roughly one percent, and a file of about three hundred megabytes.',
            card: { tag: 'NUMBERS', title: 'Parameter budget', stat: { v: '≈ 153 M', u: 'trainable', l: 'parameters: 1.1% of Wan 14B, a 0.31 GB bf16 file compared with 28 GB for the full model' } },
            deep: '<table><tr><th>Wan 14B, r = 32</th><th>params</th></tr>' +
              '<tr><td>one 5120×5120 projection</td><td>327,680 (1.25% of 26.2M)</td></tr>' +
              '<tr><td>8 attn projections (self + cross q,k,v,o)</td><td>2.62M / block</td></tr>' +
              '<tr><td>FFN 5120↔13,824 (2 linears)</td><td>1.21M / block</td></tr>' +
              '<tr><td>× 40 blocks</td><td>≈ 153M ≈ 1.1% · 0.31 GB bf16</td></tr></table>' +
              '<p>The rank is a capacity dial: ranks of 16 to 64 are a common range for character LoRAs, and higher ranks mostly add room to overfit a few dozen training images.</p>'
          },
          {
            say: 'The recipe is small: thirty to sixty images and short clips from the character sheet, captions with a rare trigger token, and a few GPU hours. At inference the update can be merged at zero cost, or hot swapped per request.',
            card: { tag: 'HOW IT WORKS', title: 'A few GPU-hours, free to serve', body: 'Merge W′ = W + ΔW for a dedicated deployment, or keep adapters separate and batch many characters over one base model.' },
            deep: '<p><b>Recipe for the fox:</b> 30–60 images and short clips (character-sheet renders plus curated generations), captions containing a rare trigger token, flow-matching loss with the base frozen, a few thousand steps at lr ≈ 10<sup>−4</sup>: a few GPU-hours with gradient checkpointing.</p>' +
              '<p><b>Serving:</b> merge into W for a dedicated deployment (zero overhead), or keep adapters separate and apply them per request (S-LoRA / Punica-style batched LoRA kernels), so many characters share one base model in GPU memory.</p>'
          },
          {
            say: 'LoRA and reference tokens are complements. LoRA gives the strongest identity at no inference cost, but needs a training job per character, while reference tokens are zero shot but cost attention and risk copy and paste. Production systems use both.',
            card: { tag: 'TRADE-OFF', title: 'LoRA versus reference tokens', body: 'Weights: strongest identity, free at inference, one training job per character. Tokens: zero-shot, but +31% attention and copy-paste risk.' },
            deep: '<p><b>LoRA vs reference tokens:</b> LoRA gives the strongest identity and no sequence growth, but needs a training job per character and can overfit (baked-in pose, background, style). Reference tokens are zero-shot but cost attention FLOPs and carry copy-paste risk.</p>' +
              '<p>Production systems often use both: a LoRA for the lead character, reference tokens for props, one-off guests and the moon surface. The bible of step 9 records which mechanism each entity uses.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 5);
          title(ctx, g, 'CHARACTER LoRA · teach the fox once, reuse it in every shot');
          var r1 = ctx.rng(21), r2 = ctx.rng(22), r3 = ctx.rng(23);
          var Bv = [], Av = [];
          for (var i = 0; i < 12; i++) { Bv.push([r1() * 2 - 1, r1() * 2 - 1]); Av.push([r2() * 2 - 1, r2() * 2 - 1]); }
          S.mxW = ctx.group({ parent: g });
          S.W = ctx.matrix(90, 330, 12, 12, { cell: 20, gap: 2, cmap: 'gray', values: function () { return 0.12 + 0.25 * r3(); }, parent: S.mxW });
          ctx.text(221, 308, 'W  (frozen)', { size: 13, font: 'mono', color: 'white', anchor: 'middle', parent: S.mxW });
          ctx.text(221, 612, '5120 × 5120 = 26.2M', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.mxW });
          ctx.icon('lock', 330, 308, 16, 'dim', { parent: S.mxW });
          S.mx = ctx.group({ parent: g });
          ctx.text(372, 460, '+', { size: 34, color: 'white', anchor: 'middle', weight: 700, parent: S.mx });
          S.B = ctx.matrix(396, 330, 12, 2, { cell: 20, gap: 2, cmap: 'diverge', values: function () { return 0; }, parent: S.mx });
          ctx.text(417, 612, 'B: d × r', { size: 12, font: 'mono', color: 'magenta', anchor: 'middle', parent: S.mx });
          S.A = ctx.matrix(456, 278, 2, 12, { cell: 20, gap: 2, cmap: 'diverge', values: function () { return 0; }, parent: S.mx });
          ctx.text(587, 262, 'A: r × d', { size: 12, font: 'mono', color: 'magenta', anchor: 'middle', parent: S.mx });
          S.dW = ctx.matrix(456, 330, 12, 12, { cell: 20, gap: 2, cmap: 'diverge', values: function () { return 0; }, parent: S.mx });
          ctx.text(587, 612, 'ΔW = (α/r)·BA · rank r = 32', { size: 12, font: 'mono', color: 'magenta', anchor: 'middle', parent: S.mx });
          S.step = ctx.text(90, 650, 'training step 0 · B = 0 ⇒ W′ = W', { size: 13, font: 'mono', color: 'lime', parent: S.mx });
          function setLora(t) {
            S.B.set(function (r, c) { return Bv[r][c] * t; });
            S.A.set(function (r, c) { return Av[c][r] * Math.min(1, 0.4 + 0.6 * t); });
            S.dW.set(function (r, c) { return 0.9 * t * (Bv[r][0] * Av[c][0] + Bv[r][1] * Av[c][1]); });
            S.step.textContent = 'training step ' + Math.round(t * 2500) + (t < 0.01 ? ' · B = 0 ⇒ W′ = W' : ' · rank-2 toy: every row of ΔW is a mix of A’s rows');
          }
          setLora(0);
          /* param table */
          S.pt = ctx.group({ parent: g });
          ctx.rect(760, 226, 790, 250, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('magenta', 0.45), sw: 1.2, parent: S.pt });
          ctx.text(780, 250, 'PARAMETER BUDGET · Wan 14B, r = 32, attention + FFN', { size: 14, font: 'display', weight: 700, color: 'magenta', parent: S.pt });
          S.ptRows = [['per 5120×5120 linear: r(d_in + d_out)', '327,680', '1.25%'], ['8 attn projections (self + cross q k v o)', '2.62M', '/ block'], ['FFN 5120 ↔ 13,824 (2 linears)', '1.21M', '/ block'], ['× 40 blocks', '≈ 153M', '≈ 1.1%'], ['file size (bf16)', '≈ 0.31 GB', 'vs 28 GB']].map(function (rw, k) {
            var rg = ctx.group({ parent: S.pt });
            var y = 286 + k * 38;
            ctx.text(780, y, rw[0], { size: 12.5, font: 'mono', color: 'text', parent: rg });
            ctx.text(1400, y, rw[1], { size: 13, font: 'mono', color: 'white', weight: 700, anchor: 'end', parent: rg });
            ctx.text(1530, y, rw[2], { size: 12, font: 'mono', color: 'magenta', anchor: 'end', parent: rg });
            return rg;
          });
          /* recipe & serving */
          S.rc = ctx.group({ parent: g });
          ctx.text(760, 516, 'RECIPE (fox)', { size: 14, font: 'display', weight: 700, color: 'lime', parent: S.rc });
          [['30–60 images + short clips from the character sheet', 'text'], ['captions with a rare trigger token, e.g. "fxastro"', 'text'], ['flow-matching loss, base frozen, lr ≈ 1e-4', 'dim'], ['a few thousand steps · a few GPU-hours', 'dim']].forEach(function (l, k) {
            ctx.text(760, 546 + k * 26, l[0], { size: 12.5, font: 'mono', color: l[1], parent: S.rc });
          });
          ctx.text(1170, 516, 'SERVING', { size: 14, font: 'display', weight: 700, color: 'cyan', parent: S.rc });
          [['merge W′ = W + ΔW: zero overhead', 'text'], ['or per-request hot-swap:', 'text'], ['batched LoRA kernels (S-LoRA,', 'dim'], ['Punica) share one base model', 'dim']].forEach(function (l, k) {
            ctx.text(1170, 546 + k * 26, l[0], { size: 12.5, font: 'mono', color: l[1], parent: S.rc });
          });
          S.tr = ctx.group({ parent: g });
          ctx.rect(70, 686, 1480, 178, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('amber', 0.4), sw: 1.2, parent: S.tr });
          ctx.text(90, 712, 'LoRA vs REFERENCE TOKENS', { size: 14, font: 'display', weight: 700, color: 'amber', parent: S.tr });
          [['', 'LoRA (weights)', 'reference tokens (attention)'], ['identity strength', 'strongest, all angles', 'good; weaker on unseen views'], ['per-character cost', 'training job (GPU-hours)', 'zero-shot'], ['inference cost', '0 when merged', '+R·3,600 tokens; attention grows quadratically'], ['failure mode', 'overfit: baked-in pose / style', 'copy-paste of ref pose / lighting']].forEach(function (rw, k) {
            var y = 742 + k * 23;
            var col = k === 0 ? 'white' : 'text';
            ctx.text(90, y, rw[0], { size: 12, font: 'mono', color: k === 0 ? 'white' : 'dim', parent: S.tr });
            ctx.text(400, y, rw[1], { size: 12, font: 'mono', color: k === 0 ? 'magenta' : col, weight: k === 0 ? 700 : 400, parent: S.tr });
            ctx.text(820, y, rw[2], { size: 12, font: 'mono', color: k === 0 ? 'violet' : col, weight: k === 0 ? 700 : 400, parent: S.tr });
          });
          ctx.text(1290, 812, 'production: both', { size: 12.5, font: 'mono', color: 'lime', weight: 700, parent: S.tr });
          tint(ctx);
          hide([S.mxW, S.mx, S.pt, S.ptRows, S.rc, S.tr]);

          /* beat 0: the frozen weight matrix */
          return ctx.reveal(S.mxW, { from: 'left' }).then(function () {
            return ctx.pulse(S.W, { color: 'white', dur: 700 });
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: B and A appear and training grows the update */
            return ctx.reveal(S.mx, { from: 'right', dur: 500 }).then(function () {
              return ctx.tween(3000, function (t) { setLora(t); }, 'inOut');
            }).then(function () {
              return ctx.pulse(S.dW, { color: 'magenta', dur: 800 });
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the parameter budget */
            return Promise.all([ctx.reveal(S.pt, { from: 'right' }), ctx.reveal(S.ptRows, { from: 'right', delay: 300, stagger: 180 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: recipe and serving */
            return ctx.reveal(S.rc, { from: 'up' });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: trade-offs against reference tokens */
            return ctx.reveal(S.tr, { from: 'up' });
          });
        }
      },
      /* ------------------------------------------------------------------ 7 */
      {
        title: 'Long video',
        beats: [
          {
            say: 'One model call yields about five seconds. Longer takes need extension. The baseline, full sequence diffusion, denoises every frame together at the same noise level.',
            card: { tag: 'KEY IDEA', title: 'A window of five seconds', body: 'Bidirectional attention over a fixed 81-frame window: one σ, every frame denoised together. Length is fixed by training.' },
            deep: '<p><b>A · full-sequence:</b> one σ for all frames; bidirectional attention; length fixed by training (81 frames for Wan) and O(n²) in length. Each bar is one latent frame; its height is that frame’s noise level σ, and the tile below turns from grey noise to green clean as σ falls.</p>' +
              '<p>Everything in the previous chamber was variant A. Stretching it to a 60 s clip would mean roughly 12× the tokens and 144× the attention cost, so long takes must be built from windows.</p>'
          },
          {
            say: 'Chunked autoregression generates one chunk, then conditions the next chunk on a few clean context frames from the end of the previous one. It works with any image to video model, but every boundary is a potential seam.',
            card: { tag: 'TRADE-OFF', title: 'Simple, but seams at the joints', body: 'Two clean context frames link chunk 2 to chunk 1. It works with any I2V model, but errors can accumulate at each boundary.' },
            deep: '<p><b>B · chunked AR with context:</b> generate chunk k conditioned on the last c clean latent frames of chunk k−1 (as mask-concat or clean tokens). Simple, and it works with any I2V-style model, but each boundary is a potential seam: the model sees only c frames of history, so slow drifts in lighting or identity slip through.</p>' +
              '<p>Cost becomes linear in length: N chunks of n tokens, each also attending c context frames of n<sub>s</sub> tokens, cost N·n·(n + c·n<sub>s</sub>) attention work, against (N·n)² for one long sequence.</p>'
          },
          {
            say: 'Diffusion forcing goes further. Each frame gets its own noise level, so near frames can be almost clean while far frames are still noisy, and a rolling window can stream forever.',
            card: { tag: 'KEY IDEA', title: 'Every frame has its own σ', body: 'Train with independent per-frame noise levels and any schedule is valid at test time, including a sliding pyramid of noise.', more: '<p>With window w = 4, frame i starts to be denoised when the head of the pyramid reaches it and is fully clean w steps later. Each sampling step emits one clean frame at the front and admits one pure-noise frame at the back, so the cost per emitted frame is one network evaluation over w frames instead of a full-clip pass.</p>' },
            deep: '<p><b>C · diffusion forcing:</b> train with <i>independent</i> per-frame noise levels, so any schedule matrix is valid at test time:</p>' +
              '<div class="eq">σ<sub>i</sub> ~ U[0,1] i.i.d.;&nbsp; L = E‖v<sub>θ</sub>(z<sup>1</sup><sub>σ<sub>1</sub></sub>, …, z<sup>T</sup><sub>σ<sub>T</sub></sub>) − v‖²</div>' +
              '<div class="eq">rolling: σ<sub>i</sub>(k) = clip((i − k + w)/w, 0, 1)</div>' +
              '<p>Near frames are nearly clean while far frames stay noisy: a pyramid that slides forward. SkyReels-V2 uses it for “infinite-length” generation; MAGI-1 denoises chunks autoregressively with monotonically increasing noise; FramePack compresses history instead.</p>'
          },
          {
            say: 'Causal distilled students like CausVid turn this into real time generation. A bidirectional teacher is distilled into a block causal student that takes four steps per chunk and keeps a key value cache, so past chunks are never recomputed.',
            card: { tag: 'STATE OF THE ART', title: 'Causal students stream in real time', body: 'CausVid distills a bidirectional teacher into a block-causal student: 4 steps per chunk, KV cache, about 9.4 fps after 1.3 s.' },
            deep: '<p><b>Causal students:</b> CausVid distils a bidirectional teacher (50 steps × 2 for guidance) into a block-causal student with DMD (distribution matching distillation): 4 steps per chunk and a KV cache of past chunks. The block-causal mask lets chunk k see chunks ≤ k, never the future.</p>' +
              '<p>Result: ≈ 9.4 fps streaming after ≈ 1.3 s to the first frame on a single GPU at 352 × 640, versus 219 s for the bidirectional teacher to produce a 128-frame clip. The student is initialised from the teacher’s ODE trajectories and trained with an asymmetric loss: the bidirectional teacher supervises the causal student.</p>'
          },
          {
            say: 'Self Forcing trains the student on its own rollouts, closing the train test gap, and reaches about seventeen frames per second with sub second latency on one H one hundred. For our trailer, five to eight seconds per shot fits one window, so extension is needed only for a long take, and it brings drift.',
            card: { tag: 'NUMBERS', title: 'Self Forcing: real-time streaming', stat: { v: '≈ 17', u: 'fps on one H100', l: '0.69 s latency, chunk-wise, 1.3 B student at 480p; trained on its own rollouts with a video-level loss' } },
            deep: '<p><b>Self Forcing</b> trains the student on its <i>own</i> rollouts with a video-level loss, closing the train–test gap that plagues autoregressive video models. Its Wan 2.1 1.3 B student at 832 × 480 reaches ≈ 17 fps with 0.69 s latency on one H100 when generating 3-latent-frame chunks (the frame-wise variant: 8.9 fps at 0.45 s). The limit of both students is the fixed KV window: the memory of the distant past fades.</p>' +
              '<p>For the trailer, 5–8 s per shot fits one window, so AR extension is only needed for a long take. It brings <i>drift</i>, the subject of the next step.</p>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 6);
          title(ctx, g, 'LONG VIDEO · beyond one 5-second window');
          S.lrowY = [228, 382, 536];
          S.lbars = []; S.lthumb = [];
          S.lrowG = [];
          [['A · full-sequence', 'one σ for all frames', 'bidirectional, 81 f max'], ['B · chunked AR', 'chunk 2 conditioned on', '2 clean context frames'], ['C · diffusion forcing', 'per-frame σᵢ, rolling', 'window w = 4 frames']].forEach(function (lab, ri) {
            var y0 = S.lrowY[ri];
            var rg = ctx.group({ parent: g });
            S.lrowG.push(rg);
            ctx.rect(70, y0, 840, 140, { rx: 10, fill: 'rgba(6,12,24,0.75)', stroke: ctx.alpha('lime', 0.3), sw: 1, parent: rg });
            ctx.text(90, y0 + 30, lab[0], { size: 14, font: 'display', weight: 700, color: 'lime', parent: rg });
            ctx.text(90, y0 + 56, lab[1], { size: 12, font: 'mono', color: 'text', parent: rg });
            ctx.text(90, y0 + 76, lab[2], { size: 12, font: 'mono', color: 'dim', parent: rg });
            ctx.text(300, y0 + 20, 'σ', { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: rg });
            ctx.line(310, y0 + 96, 900, y0 + 96, { color: ctx.alpha('white', 0.2), sw: 1, parent: rg });
            var bars = [], ths = [];
            for (var i = 0; i < 12; i++) {
              var x = 320 + i * 48;
              ctx.rect(x, y0 + 10, 38, 86, { rx: 3, fill: 'rgba(255,255,255,0.025)', parent: rg });
              bars.push(ctx.rect(x, y0 + 10, 38, 86, { rx: 3, fill: ctx.alpha('amber', 0.55), stroke: 'amber', sw: 1, parent: rg }));
              ths.push(ctx.rect(x, y0 + 102, 38, 26, { rx: 3, fill: '#6b7690', parent: rg }));
            }
            S.lbars.push(bars); S.lthumb.push(ths);
            if (ri === 1) {
              /* context-frame marker for B */
              ctx.rect(510, y0 + 4, 98, 128, { rx: 6, stroke: 'teal', sw: 1.6, dash: '5 4', parent: rg });
              ctx.text(559, y0 + 22, 'context', { size: 11.5, font: 'mono', color: 'teal', anchor: 'middle', parent: rg });
              ctx.line(608 + 7, y0 + 6, 608 + 7, y0 + 130, { color: ctx.alpha('white', 0.5), sw: 1, dash: '3 3', parent: rg });
            }
          });
          S.lhead = ctx.group({ parent: g });
          S.ltau = ctx.text(910, 190, '', { size: 12.5, font: 'mono', color: 'lime', anchor: 'end', parent: S.lhead });
          ctx.text(320, 212, 'bar = noise level σ per latent frame · tile = frame (grey = noise, green = clean)', { size: 11.5, font: 'mono', color: 'dim', parent: S.lhead });
          /* causal students */
          S.cs = ctx.group({ parent: g });
          ctx.rect(950, 228, 600, 448, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('teal', 0.45), sw: 1.2, parent: S.cs });
          ctx.text(970, 254, 'CAUSAL STUDENTS · streaming with a KV cache', { size: 14, font: 'display', weight: 700, color: 'teal', parent: S.cs });
          S.cm = ctx.matrix(975, 282, 8, 8, { cell: 22, gap: 2, values: function (r, c) { return c <= r ? (c === r ? ctx.alpha('teal', 0.9) : ctx.alpha('teal', 0.45)) : '#0a1120'; }, parent: S.cs });
          ctx.text(972, 486, 'block-causal mask: chunk k sees chunks ≤ k', { size: 11.5, font: 'mono', color: 'dim', parent: S.cs });
          ctx.text(972, 504, '(rows = query chunk, cols = key chunk)', { size: 11, font: 'mono', color: 'dim', parent: S.cs });
          [['teacher: bidirectional DiT,', 'text'], ['50 steps × 2 (CFG)', 'text'], ['↓ DMD distillation (CausVid)', 'amber'], ['student: causal, 4 steps', 'lime'], ['per chunk, KV cache of', 'lime'], ['past chunks (no recompute)', 'lime']].forEach(function (l, k) {
            ctx.text(1190, 294 + k * 26, l[0], { size: 12.5, font: 'mono', color: l[1], parent: S.cs });
          });
          ctx.text(970, 552, 'CausVid: ≈ 9.4 fps streaming, ≈ 1.3 s to first frame', { size: 12, font: 'mono', color: 'text', parent: S.cs });
          S.csB = ctx.group({ parent: g });
          [['Self Forcing: trains on its own rollouts (narrows the', 'text'], ['exposure-bias gap) → ≈ 17 fps, sub-second, 1 H100', 'text'], ['limits: fixed KV window ⇒ memory of the distant past fades', 'dim']].forEach(function (l, k) {
            ctx.text(970, 580 + k * 28, l[0], { size: 12, font: 'mono', color: l[1], parent: S.csB });
          });
          /* bottom equations */
          S.leA = ctx.group({ parent: g });
          ctx.text(70, 720, 'diffusion forcing:  σᵢ ~ U[0, 1] i.i.d. per frame in training  ⇒  any per-frame schedule is valid at test time', { size: 14, font: 'mono', color: 'white', parent: S.leA });
          ctx.text(70, 752, 'L = E ‖vθ(z¹ at σ₁, …, zᵀ at σₜ) − v‖²      rolling schedule: σᵢ(k) = clip((i − k + w) / w, 0, 1)', { size: 13.5, font: 'mono', color: 'text', parent: S.leA });
          ctx.text(70, 790, 'used by SkyReels-V2 (diffusion forcing, "infinite" length) · MAGI-1 (chunk-wise AR, noise rising along the chunk queue) · FramePack (compressed history)', { size: 12.5, font: 'mono', color: 'dim', parent: S.leA });
          S.leB = ctx.text(70, 818, 'for the trailer: 5–8 s per shot fits one window — AR extension is only needed for a long take, and it brings drift (next)', { size: 12.5, font: 'mono', color: 'amber', parent: g });

          longUpdate(ctx, S, 0);
          tint(ctx);
          hide([S.lrowG, S.lhead, S.cs, S.csB, S.leA, S.leB]);
          function sample() { return ctx.tween(2200, function (t) { longUpdate(ctx, S, t * 0.62); }, 'linear', 300); }

          /* beat 0: full-sequence diffusion, one noise level for all frames */
          return Promise.all([ctx.reveal(S.lrowG[0], { from: 'left' }), ctx.reveal(S.lhead, { dur: 300 })]).then(sample).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: chunked autoregression */
            return ctx.reveal(S.lrowG[1], { from: 'left' }).then(sample);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: diffusion forcing, a rolling pyramid of noise */
            return Promise.all([ctx.reveal(S.lrowG[2], { from: 'left' }), ctx.reveal(S.leA, { from: 'up', delay: 300 })]).then(sample).then(function () {
              var t0 = null;
              S.longLoop = ctx.loop(function (t) {
                if (t0 === null) t0 = t;
                var ph = ((t - t0) / 8 + 0.62) % 1;
                longUpdate(ctx, S, ph);
              });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: causal students */
            return ctx.reveal(S.cs, { from: 'right' }).then(function () {
              return ctx.pulse(S.cm, { color: 'teal', dur: 700 });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: Self Forcing and the trailer's needs */
            return Promise.all([ctx.reveal(S.csB, { from: 'up' }), ctx.reveal(S.leB, { from: 'up', delay: 300 })]);
          });
        }
      },
      /* ------------------------------------------------------------------ 8 */
      {
        title: 'Drift',
        beats: [
          {
            say: 'Autoregression has a price: drift. Each chunk is conditioned on the model\'s own slightly imperfect output, so small errors in color, shape or identity compound.',
            card: { tag: 'PITFALL', title: 'Errors compound chunk by chunk', body: 'The fox in chunk 8 is conditioned on a fox that was conditioned on a fox, each copy slightly off in colour, snout and helmet.' },
            deep: '<p>Errors that the model treats as signal (a slightly purple tint, a wider snout) are copied forward and amplified: identity, colour saturation and sharpness are the usual first casualties. In the row of chunks, the fox drifts from orange toward purple and its helmet from white toward green as the chunk index grows.</p>' +
              '<p class="muted">The similarity values are illustrative of reported trends, not a benchmark.</p>'
          },
          {
            say: 'A model trained only on real context frames never learned to recover from its own mistakes. That is exposure bias, and it lets the fox slowly become someone else.',
            card: { tag: 'KEY IDEA', title: 'Exposure bias', body: 'Training conditions on real context, inference on the model’s own. The mismatch grows every chunk until similarity falls below the critic’s threshold.' },
            deep: '<p><b>Exposure bias:</b> training conditions on p<sub>data</sub>(context); inference conditions on p<sub>θ</sub>(context). A first-order error model per chunk:</p>' +
              '<div class="eq">e<sub>k+1</sub> = J e<sub>k</sub> + δ<sub>k</sub> &nbsp;⇒&nbsp; ‖e<sub>k</sub>‖ ≈ k·δ if ρ(J) ≈ 1, exponential if ρ(J) &gt; 1</div>' +
              '<p>Here δ is the fresh error each chunk adds and J says how much of the previous error the model passes on. If the model treats its own artefacts as signal, J is at least the identity and errors never decay.</p>'
          },
          {
            say: 'Remedies attack this from several sides. Train on self generated rollouts, add noise to the context frames, and pin reference tokens in the cache as a permanent anchor.',
            card: { tag: 'HOW IT WORKS', title: 'Three remedies flatten the curve', body: 'In the illustration, they hold similarity between 0.84 and 0.88 at 60 seconds, where naive extension falls to about 0.6.' },
            deep: '<ul><li><b>Train on own rollouts</b> (Self Forcing; also the rationale behind diffusion forcing’s noisy context): the model sees its own artefacts and learns to correct them.</li>' +
              '<li><b>Noise-augment context</b> (σ<sub>ctx</sub> ≈ 0.1–0.3): conditioning frames are “trust but verify”, so high-frequency errors are not copied.</li>' +
              '<li><b>Anchor tokens</b>: keep reference / first-frame tokens permanently in the KV cache (an attention sink for identity) while the rolling window evicts the rest.</li></ul>'
          },
          {
            say: 'Compress the history so the context budget stays fixed. And the cheapest remedy of all is planning in shots, because every cut resets the error.',
            card: { tag: 'WHY IT MATTERS', title: 'Cuts reset the error', body: 'A trailer is a sequence of 5–8 s shots, each anchored to the production bible. Drift never gets time to accumulate.' },
            deep: '<ul><li><b>Compress history</b> (FramePack): recent frames get full tokens, older frames progressively fewer (larger patches), so context length stays O(1); its anti-drifting sampling also generates endpoints first.</li>' +
              '<li><b>Rolling window plus sink</b>: evict old chunks but re-anchor from the bible.</li>' +
              '<li><b>Plan in shots</b>: cuts reset error. A trailer is naturally a sequence of 5–8 s shots, each anchored to the bible (next step).</li></ul>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          if (S.longLoop) { S.longLoop.stop(); S.longLoop = null; }
          var g = swap(ctx, S, 7);
          title(ctx, g, 'DRIFT · errors compound when the model eats its own output');
          function naive(t) { return 0.93 - 0.4 * (1 - Math.exp(-t / 35)); }
          function selff(t) { return 0.93 - 0.12 * (1 - Math.exp(-t / 40)); }
          function anch(t) { return 0.92 - 0.04 * (1 - Math.exp(-t / 20)); }
          S.fr = [];
          S.frG = ctx.group({ parent: g });
          for (var i = 0; i < 8; i++) {
            var x = 80 + i * 182, fg = ctx.group({ parent: S.frG }), tt = (i + 1) * 7.5;
            ctx.rect(x, 222, 160, 110, { rx: 8, fill: '#08101f', stroke: ctx.alpha(naive(tt) >= 0.75 ? 'lime' : 'red', 0.35 + 0.07 * i), sw: 1.2, parent: fg });
            ctx.path('M' + (x + 2) + ',312 Q' + (x + 80) + ',300 ' + (x + 158) + ',312', { stroke: ctx.mix('#22e4ff', '#9b7bff', i / 7), sw: 1, fill: ctx.alpha('cyan', 0.1), parent: fg });
            fox(ctx, fg, x + 80, 272, 1.7, i / 7 * 0.95, 0.1);
            ctx.text(x + 80, 348, 'chunk ' + (i + 1) + ' · ' + tt.toFixed(0) + ' s', { size: 11.5, font: 'mono', color: 'dim', anchor: 'middle', parent: fg });
            ctx.text(x + 80, 366, 'sim ' + naive(tt).toFixed(2), { size: 11.5, font: 'mono', color: naive(tt) < 0.75 ? 'red' : 'lime', anchor: 'middle', parent: fg });
            S.fr.push(fg);
          }
          /* plot: naive curve first, remedies later */
          S.pgA = ctx.group({ parent: g });
          ctx.text(80, 410, 'identity similarity vs generated length · illustrative curves, 7.5 s chunks', { size: 12.5, font: 'mono', color: 'text', parent: S.pgA });
          var P = { xDomain: [0, 60], yDomain: [0.45, 1] };
          var p1 = ctx.plot(120, 440, 620, 300, naive, Object.assign({ color: 'red', sw: 2.4, yLabel: '', parent: S.pgA }, P));
          ctx.text(740, 774, 'seconds of video', { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.pgA });
          var th = p1.toPx(0, 0.75), th2 = p1.toPx(60, 0.75);
          ctx.line(th.x, th.y, th2.x, th2.y, { color: ctx.alpha('white', 0.5), sw: 1.2, dash: '6 5', parent: S.pgA });
          ctx.text(th2.x - 4, th.y - 10, 'critic threshold 0.75', { size: 11.5, font: 'mono', color: 'white', anchor: 'end', parent: S.pgA });
          [0.5, 0.75, 1].forEach(function (v) { ctx.text(112, p1.toPx(0, v).y, v.toFixed(2), { size: 11, font: 'mono', color: 'dim', anchor: 'end', parent: S.pgA }); });
          [0, 15, 30, 45, 60].forEach(function (v) { ctx.text(p1.toPx(v, 0.45).x, 756, String(v), { size: 11, font: 'mono', color: 'dim', anchor: 'middle', parent: S.pgA }); });
          ctx.text(140, 790, '— naive AR (trained on real context)', { size: 12, font: 'mono', color: 'red', parent: S.pgA });
          S.pgB = ctx.group({ parent: g });
          var p2 = ctx.plot(120, 440, 620, 300, selff, Object.assign({ color: 'amber', sw: 2.4, axes: false, parent: S.pgB }, P));
          var p3 = ctx.plot(120, 440, 620, 300, anch, Object.assign({ color: 'lime', sw: 2.4, axes: false, parent: S.pgB }, P));
          ctx.text(140, 812, '— self-forcing (trained on own rollouts)', { size: 12, font: 'mono', color: 'amber', parent: S.pgB });
          ctx.text(140, 834, '— + anchored ref tokens + noisy context', { size: 12, font: 'mono', color: 'lime', parent: S.pgB });
          S.dc1 = p1.curve; S.dc23 = [p2.curve, p3.curve];
          /* why it drifts, and the remedies */
          S.mg = ctx.group({ parent: g });
          ctx.rect(800, 396, 750, 460, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('lime', 0.35), sw: 1.2, parent: S.mg });
          S.mgWhy = ctx.group({ parent: g });
          ctx.text(820, 422, 'WHY IT DRIFTS', { size: 14, font: 'display', weight: 700, color: 'red', parent: S.mgWhy });
          ctx.text(820, 452, 'eₖ₊₁ = J eₖ + δₖ   ⇒   ‖eₖ‖ ~ k·δ (ρ(J) ≈ 1) or exponential (ρ(J) > 1)', { size: 13, font: 'mono', color: 'white', parent: S.mgWhy });
          ctx.text(820, 478, 'exposure bias: trained on p_data(context), run on pθ(context)', { size: 12.5, font: 'mono', color: 'dim', parent: S.mgWhy });
          S.mgRemT = ctx.text(820, 516, 'REMEDIES', { size: 14, font: 'display', weight: 700, color: 'lime', parent: g });
          S.rem = [['train on own rollouts (Self Forcing): smaller train/test gap', 'loop'], ['noise-augment context frames, σ_ctx ≈ 0.1–0.3', 'wave'], ['anchor: ref / first-frame tokens pinned in the KV cache', 'lock'], ['compress history (FramePack): old frames → fewer tokens', 'layers'], ['rolling KV window + sink; re-anchor from the bible', 'db'], ['plan in shots: a cut resets the error (next step)', 'film']].map(function (r, k) {
            var rg = ctx.group({ parent: g });
            var y = 550 + k * 46;
            ctx.circle(836, y, 15, { fill: ctx.alpha('lime', 0.12), stroke: ctx.alpha('lime', 0.6), sw: 1, parent: rg });
            ctx.icon(r[1], 836, y, 16, 'lime', { parent: rg });
            ctx.text(862, y, r[0], { size: 13, font: 'mono', color: 'text', parent: rg });
            return rg;
          });
          tint(ctx);
          hide([S.frG, S.fr, S.pgA, S.pgB, S.mg, S.mgWhy, S.mgRemT, S.rem, S.dc1, S.dc23]);

          /* beat 0: the chunks slowly change identity */
          return ctx.reveal(S.frG, { dur: 200 }).then(function () {
            return ctx.reveal(S.fr, { from: 'up', stagger: 160 });
          }).then(function () {
            return Promise.all(S.fr.slice(5).map(function (f) { return ctx.pulse(f, { color: 'red', dur: 700 }); }));
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: exposure bias, and the naive similarity curve */
            return Promise.all([ctx.reveal(S.pgA, { from: 'left' }), ctx.reveal(S.dc1, { from: 'draw', dur: 1400, delay: 300 }), ctx.reveal([S.mg, S.mgWhy], { from: 'right', delay: 200, stagger: 100 })]);
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: remedies that flatten the curve */
            return Promise.all([ctx.reveal(S.pgB, { dur: 300 }), ctx.reveal(S.dc23, { from: 'draw', dur: 1400, delay: 200, stagger: 300 }), ctx.reveal(S.mgRemT, { delay: 200 }), ctx.reveal(S.rem.slice(0, 3), { from: 'right', delay: 300, stagger: 200 })]);
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: compress history, plan in shots */
            return ctx.reveal(S.rem.slice(3), { from: 'right', stagger: 220 }).then(function () {
              return ctx.pulse(S.rem[5], { color: 'lime', times: 2, dur: 600 });
            });
          });
        }
      },
      /* ------------------------------------------------------------------ 9 */
      {
        title: 'Trailer continuity',
        beats: [
          {
            say: 'Back to the trailer. Six shots are rendered as separate jobs, but they share one production bible: the same reference sheets, the same character LoRA, the same palette and lens.',
            card: { tag: 'KEY IDEA', title: 'Continuity is a systems property', body: 'No single model call guarantees it. The orchestration layer gives every render the same versioned bible.' },
            deep: '<p><b>Continuity is a systems property</b>, enforced by the orchestration layer rather than by any single model call. The <b>production bible</b> (a versioned artifact in the object store) holds reference sheets, the LoRA id, palette, lens / FOV, lighting notes and per-character embeddings.</p>' +
              '<p>Every <code>render_shot</code> call receives the same bible version, so shots are conditionally independent <i>given</i> shared anchors: they can render in parallel on different GPUs and still agree.</p>'
          },
          {
            say: 'Match cuts reuse the last frame of one shot as the first frame of the next, so the boundary frames are identical by construction.',
            card: { tag: 'HOW IT WORKS', title: 'Hand-offs at the cuts', body: 'S2 to S3 and S5 to S6 share a frame: FLF2V or I2V takes shot k’s last frame as shot k+1’s first.' },
            deep: '<p><b>Hand-offs:</b> for match cuts the agent passes shot k’s last frame as shot k+1’s first frame (FLF2V / I2V), so boundary frames are identical by construction. Everywhere else a cut resets the error, so shots may differ in staging while still sharing identity.</p>' +
              '<p>The <code>handoffs</code> entry of the bible lists which pairs are match cuts, so the scheduler knows S3 must wait for the last frame of S2 and S6 for that of S5, while S1, S2, S4 and S5 start immediately.</p>'
          },
          {
            say: 'After rendering, a critic embeds the fox in every shot and compares it with the references. Each shot is scored by its worst sampled frame.',
            card: { tag: 'HOW IT WORKS', title: 'Measure identity, do not eyeball', body: 'Detect and crop the fox, embed it with DINOv2 or CLIP, take the cosine to the mean reference embedding, min over frames.' },
            deep: '<p><b>Verification:</b> detect and crop the character in sampled frames, embed with E (DINOv2 or CLIP image features for a stylised fox; ArcFace-style face embeddings for humans) and score:</p>' +
              '<div class="eq">sim<sub>shot</sub> = min<sub>frames</sub> cos( E(crop), mean<sub>refs</sub> E(ref) )</div>' +
              '<p>plus a VLM judge answering structured questions (“helmet crack on the left?”, “orange suit stripe present?”) that embeddings miss. The min over frames is deliberately harsh: viewers notice a single off-model frame more than a slightly low average.</p>'
          },
          {
            say: 'Shot four scores zero point six two, below the threshold of zero point seven five. Only that shot is sent back, to be re-rendered with stronger reference guidance.',
            card: { tag: 'NUMBERS', title: 'One shot fails the check', stat: { v: '0.62', u: 'S4 similarity', l: 'below the 0.75 threshold: only S4 is re-rendered; retries are bounded, then a human decides' }, more: '<p>In practice τ is calibrated on shots that humans rated acceptable versus visibly off-model. Raising τ catches more subtle drift but re-renders more shots; lowering it saves compute but lets small identity changes through. The bounded retry count caps the worst case.</p>' },
            deep: '<p><b>Repair policy:</b> sim &lt; τ (here 0.75) → re-render only that shot with a new seed, higher reference / LoRA scale, or a keyframe taken from a passing neighbour. Retries are bounded (here ≤ 2), then the job escalates to the human.</p>' +
              '<p>The loop on the stage is an ordinary workflow: bible → six parallel <code>render_shot</code> tasks → critic → editor, with a conditional back-edge from the critic to the failing shot. It is durable, so a crash mid-loop resumes instead of restarting.</p>'
          },
          {
            say: 'The re-render scores zero point eight nine, and now all six shots agree. The fix cost one extra five second render, instead of redoing the trailer.',
            card: { tag: 'NUMBERS', title: 'Repair one shot, not six', stat: { v: '1 of 6', u: 'shots redone', l: 'S4: 0.62 → 0.89 for one more ~95 s render on 8 GPUs (≈ 13 GPU-min), instead of a full re-run' } },
            deep: '<p>Cost is one extra 5 s render (≈ 95 s of diffusion on 8 GPUs, about 13 GPU-min) instead of re-running the trailer (≈ 76 GPU-min), and the other five shots are left untouched, so their approvals stand. With a per-shot failure probability p the expected extra work is about p renders per shot, which is why a critic in the loop beats over-sampling everything.</p>' +
              '<div class="note">The trailer now goes to the editor with six verified shots. The audio, edit and delivery stages are the subject of the next subsystem.</div>'
          }
        ],
        run: function (ctx) {
          var S = ctx.state;
          var g = swap(ctx, S, 8);
          title(ctx, g, 'SHOT-TO-SHOT CONTINUITY · one bible, six renders, one critic');
          var sims = [0.91, 0.88, 0.86, 0.62, 0.9, 0.87];
          S.shots = [];
          S.shotG = ctx.group({ parent: g });
          SHOTS.forEach(function (sh, i) {
            var x = 80 + i * 245, cg = ctx.group({ parent: S.shotG });
            var fr = ctx.rect(x, 222, 222, 132, { rx: 8, fill: '#08101f', stroke: ctx.alpha('lime', 0.5), sw: 1.3, parent: cg });
            ctx.path('M' + (x + 2) + ',330 Q' + (x + 111) + ',312 ' + (x + 220) + ',330', { stroke: 'cyan', sw: 1, fill: ctx.alpha('cyan', 0.12), parent: cg });
            ctx.text(x + 12, 240, sh[0], { size: 12.5, font: 'mono', weight: 700, color: 'white', parent: cg });
            ctx.text(x + 12, 258, sh[1], { size: 11, font: 'mono', color: 'dim', parent: cg });
            var fx = fox(ctx, cg, x + 64, 296, 1.5, i === 3 ? 0.3 : 0.03, [0, 0.6, -0.5, 0.3, -0.2, 0.8][i]);
            ctx.text(x + 124, 290, 'refs ✓', { size: 11, font: 'mono', color: 'violet', parent: cg });
            ctx.text(x + 124, 308, 'LoRA ✓', { size: 11, font: 'mono', color: 'magenta', parent: cg });
            S.shots.push({ g: cg, fr: fr, fox: fx, x: x });
          });
          /* hand-off arcs */
          S.ho = ctx.group({ parent: g });
          S.hoArcs = [];
          [1, 4].forEach(function (i) {
            var x1 = 80 + i * 245 + 200, x2 = 80 + (i + 1) * 245 + 22;
            S.hoArcs.push(ctx.path('M' + x1 + ',356 Q' + ((x1 + x2) / 2) + ',392 ' + x2 + ',356', { stroke: 'cyan', sw: 1.6, arrow: true, parent: S.ho }));
            ctx.text((x1 + x2) / 2, 400, 'last → first frame', { size: 11, font: 'mono', color: 'cyan', anchor: 'middle', parent: S.ho });
          });
          /* bible */
          S.bible = ctx.code({ parent: g, x: 70, y: 426, w: 600, title: 'artifact://bible/fox-trailer@v3.json', lang: 'json', typing: true, maxLines: 8, size: 11.8, color: 'violet', lines: [
            '{"characters": {"fox": {',
            '   "refs": ["fox_front.png", "fox_34.png", "fox_side.png"],',
            '   "lora": "fxastro_r32@v3", "lora_scale": 0.8,',
            '   "embed": "dinov2:9f3a..", "must": ["crack left", "orange stripe"]}},',
            ' "style": {"palette": ["#0b1e3a", "#7fe3ff", "#ff8a3d"],',
            '           "lens": "anamorphic 40mm", "grade": "teal-orange"},',
            ' "moon": {"refs": ["ice_moon.png"]},',
            ' "handoffs": [["S2", "S3"], ["S5", "S6"]], "seed_base": 1377}'
          ] });
          /* critic */
          S.cr = ctx.group({ parent: g });
          ctx.rect(720, 426, 830, 424, { rx: 10, fill: 'rgba(6,12,24,0.8)', stroke: ctx.alpha('pink', 0.45), sw: 1.2, parent: S.cr });
          ctx.text(740, 452, 'CRITIC · identity similarity per shot (min over sampled frames)', { size: 14, font: 'display', weight: 700, color: 'pink', parent: S.cr });
          var base = 720, top = 480, H = 220;
          function yOf(v) { return base - (v - 0.4) / 0.6 * H; }
          ctx.line(760, base, 1510, base, { color: ctx.alpha('white', 0.3), sw: 1, parent: S.cr });
          ctx.line(760, yOf(0.75), 1510, yOf(0.75), { color: 'white', sw: 1.2, dash: '6 5', opacity: 0.6, parent: S.cr });
          ctx.text(1540, yOf(0.75) - 12, 'τ = 0.75', { size: 11.5, font: 'mono', color: 'white', anchor: 'end', parent: S.cr });
          S.sbars = []; S.svals = [];
          sims.forEach(function (v, i) {
            var x = 800 + i * 120;
            ctx.rect(x, top, 60, base - top, { rx: 4, fill: 'rgba(255,255,255,0.025)', parent: S.cr });
            var col = v < 0.75 ? 'red' : 'lime';
            var b = ctx.rect(x, yOf(v), 60, base - yOf(v), { rx: 4, fill: ctx.alpha(col, 0.55), stroke: col, sw: 1, parent: S.cr });
            b.setAttribute('data-v', v);
            S.sbars.push(b);
            S.svals.push(ctx.text(x + 30, yOf(v) - 12, v.toFixed(2), { size: 12.5, font: 'mono', weight: 700, color: col, anchor: 'middle', parent: S.cr }));
            ctx.text(x + 30, base + 16, 'S' + (i + 1), { size: 12, font: 'mono', color: 'dim', anchor: 'middle', parent: S.cr });
          });
          S.crT = [['sim = cos(E(fox crop), mean E(refs)), E = DINOv2 / CLIP image embedding', 'text'], ['VLM judge: "crack on the left? orange stripe?" → structured verdict', 'text'], ['fail → re-render that shot only: new seed, ref / LoRA scale ↑, keyframe from neighbour', 'amber']].map(function (l, k) {
            return ctx.text(740, 758 + k * 22, l[0], { size: 12, font: 'mono', color: l[1], parent: S.cr });
          });
          S.verdict = ctx.label(1135, 830, 'S4 FAIL 0.62 → re-render queued', { color: 'red', size: 11.5, parent: S.cr });
          /* orchestration loop */
          S.ol = ctx.group({ parent: g });
          var on = [
            ctx.node({ x: 130, y: 700, w: 120, h: 42, title: 'bible@v3', color: 'violet', titleSize: 13, glow: false, parent: S.ol }),
            ctx.node({ x: 305, y: 700, w: 180, h: 42, title: '6 × render_shot', color: 'lime', titleSize: 13, glow: false, parent: S.ol }),
            ctx.node({ x: 475, y: 700, w: 110, h: 42, title: 'critic', color: 'pink', titleSize: 13, glow: false, parent: S.ol }),
            ctx.node({ x: 612, y: 700, w: 110, h: 42, title: 'editor', color: 'orange', titleSize: 13, glow: false, parent: S.ol })
          ];
          for (var q = 0; q < 3; q++) ctx.link(on[q], on[q + 1], { color: 'dim', straight: true, parent: S.ol });
          S.back = ctx.path('M475,721 Q390,790 305,721', { stroke: 'red', sw: 1.6, dash: '5 4', arrow: true, parent: S.ol });
          ctx.text(390, 786, 'S4: retry (new seed, ref scale ↑)', { size: 11.5, font: 'mono', color: 'red', anchor: 'middle', parent: S.ol });
          ctx.text(70, 822, 'bounded retries (≤ 2), then escalate to the human', { size: 11.5, font: 'mono', color: 'dim', parent: S.ol });
          S.baseY = base; S.yOf = yOf;
          tint(ctx);
          var shotGs = S.shots.map(function (s) { return s.g; });
          /* the bars start at zero height and grow when the critic appears */
          S.sbars.forEach(function (b) {
            b._y1 = parseFloat(b.getAttribute('y')); b._h1 = parseFloat(b.getAttribute('height'));
            b.setAttribute('y', base); b.setAttribute('height', 0);
          });
          hide([S.shotG, shotGs, S.ho, S.hoArcs, S.bible, S.cr, S.crT, S.verdict, S.ol]);
          S.svals.forEach(function (v) { v.setAttribute('opacity', 0); });

          /* beat 0: six shots and the shared bible */
          return Promise.all([ctx.reveal(S.shotG, { dur: 200 }), ctx.reveal(shotGs, { from: 'up', stagger: 120 }), ctx.reveal(S.bible, { from: 'left', delay: 500 })]).then(function () {
            return S.bible.typeAll();
          }).then(function () { return ctx.beat(1); }).then(function () {
            /* beat 1: match cuts hand a frame over: the two pairs of shots that share a boundary frame light up */
            [1, 2, 4, 5].forEach(function (i) { S.shots[i].fr.setAttribute('stroke', ctx.C.cyan); S.shots[i].fr.setAttribute('stroke-width', 2.2); });
            return Promise.all([ctx.reveal(S.ho, { dur: 200 }), ctx.reveal(S.hoArcs, { from: 'draw', dur: 800, stagger: 200 })]).then(function () {
              return Promise.all(S.hoArcs.map(function (a) { return ctx.packet(a, { color: 'cyan', dur: 900, label: 'frame' }); }));
            });
          }).then(function () { return ctx.beat(2); }).then(function () {
            /* beat 2: the critic scores every shot */
            return Promise.all([ctx.reveal(S.cr, { from: 'right' }), ctx.reveal(S.crT.slice(0, 2), { from: 'up', delay: 300, stagger: 150 })].concat(S.sbars.map(function (b, i) {
              return ctx.animate(b, { y: [S.baseY, b._y1], height: [0, b._h1] }, 700, 'out', 300 + i * 140);
            }))).then(function () {
              return ctx.reveal(S.svals, { from: 'up', stagger: 80, dur: 300 });
            });
          }).then(function () { return ctx.beat(3); }).then(function () {
            /* beat 3: shot 4 fails and is queued for a re-render; the off-model fox is now plain to see */
            S.shots[3].fr.setAttribute('stroke', ctx.C.red);
            ctx.fadeOut(S.shots[3].fox, 300, true);
            S.shots[3].fox = fox(ctx, S.shots[3].g, S.shots[3].x + 64, 296, 1.5, 0.75, 0.3);
            ctx.reveal(S.shots[3].fox, { from: 'fade', dur: 500 });
            return Promise.all([ctx.reveal(S.verdict, { from: 'up' }), ctx.reveal(S.crT[2], { from: 'up', delay: 200 }), ctx.reveal(S.ol, { from: 'up', delay: 300 }), ctx.pulse(S.shots[3].g, { color: 'red', times: 2, dur: 600 })]).then(function () {
              return ctx.packet(S.back, { color: 'red', dur: 1000, label: 'S4' });
            });
          }).then(function () { return ctx.beat(4); }).then(function () {
            /* beat 4: the re-rendered shot passes */
            var s4 = S.shots[3];
            ctx.fadeOut(s4.fox, 400, true);
            s4.fox = fox(ctx, s4.g, s4.x + 64, 296, 1.5, 0.02, 0.3);
            ctx.reveal(s4.fox, { from: 'scale', dur: 600 });
            s4.fr.setAttribute('stroke', ctx.alpha('lime', 0.5));
            var b = S.sbars[3], y0 = parseFloat(b.getAttribute('y')), y1 = S.yOf(0.89);
            b.setAttribute('fill', ctx.alpha('lime', 0.55)); b.setAttribute('stroke', ctx.C.lime);
            S.svals[3].setAttribute('fill', ctx.C.lime);
            S.verdict.setAttribute('opacity', 0);
            S.verdict2 = ctx.label(1135, 830, 'all 6 shots ≥ 0.75 → hand to the editor', { color: 'lime', size: 11.5, parent: S.cr });
            ctx.reveal(S.verdict2, { delay: 900 });
            ctx.hud('S4 re-rendered: 0.62 → 0.89 · 1 shot, not 6');
            return ctx.tween(900, function (t) {
              var y = y0 + (y1 - y0) * t;
              b.setAttribute('y', y); b.setAttribute('height', S.baseY - y);
              S.svals[3].setAttribute('y', y - 12);
              S.svals[3].textContent = (0.62 + 0.27 * t).toFixed(2);
            }, 'out', 300);
          });
        }
      },
    ]
  });
})();
