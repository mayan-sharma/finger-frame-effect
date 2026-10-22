// Claws — make a fist: SNIKT. Swing it and they slash the glass

import { addSpark, ageOut, canvas, clamp, comicPops, ctx, d3, defineEffect,
  DEMO_SKIN, dist, drawPops, drawSparks, fctx, fingerDown, frame, gagClock,
  INDEX_MCP, lerpPt, MIDDLE_MCP, PINKY_MCP, playSound, POP_S, RING_MCP,
  shakeScreen, smoothstep, spill, stepSparks, trackedHands, WRIST } from "../api.js";

// Claws: a fist pops three from between the knuckles. Swing it with the tips
// moving faster than SLASH_SPEED palm lengths a second and they slash.
const CLAW_LEN_M = 0.28;         // real ones are a foot long
const CLAW_W_M = 0.009;          // blade width at the root
const CLAW_OUT_S = 0.11, CLAW_IN_S = 0.16;
const CLAW_LOST_FRAMES = 6;
const SLASH_SPEED = 8;
const CLAW_SLASH_GAP_S = 0.25;
const SLASH_S = 4;               // gashes stay in the glass this long
const SLASH_MAX = 18;

const claws = new Map();         // hand key -> its three claws
const slashes = [];

// Every finger curled; the thumb is free, so a fist either way counts.
function isFist(w, latched) {
  return fingerDown(w, INDEX_MCP, latched) && fingerDown(w, MIDDLE_MCP, latched) &&
         fingerDown(w, RING_MCP, latched) && fingerDown(w, PINKY_MCP, latched);
}

function updateClaws(res, t) {
  const live = new Set();
  for (const h of trackedHands(res, t)) {
    const c = claws.get(h.key);
    if (!isFist(h.w, !!(c && c.out))) continue;
    clawPose(h.key, h.pts, h.metric ? h.w : null, h.scale, t);
    live.add(h.key);
  }
  for (const [k, c] of claws) {
    if (!live.has(k) && ++c.lost > CLAW_LOST_FRAMES) { c.out = false; c.trail.length = 0; }
  }
}

// One fist this frame. The three claws come out of the gaps between the
// knuckles and run on, parallel, along the back of the hand. Their
// length is real-world, foreshortened by as much as the hand itself is: a
// fist punched at the camera shows its metacarpals end-on, so do the claws.
function clawPose(key, pts, world, scale, t) {
  let c = claws.get(key);
  if (!c) {
    c = { out: false, ext: 0, lost: 0, roots: [], dirs: [], len: 0, w: 0, scale,
          trail: [], lastSlash: -9, glint: 1 };
    claws.set(key, c);
  }
  const wr = pts[WRIST];
  const mcpPx = dist(wr, pts[MIDDLE_MCP]);
  const mcpM = world ? d3(world[WRIST], world[MIDDLE_MCP]) : 0.09;
  const fore = clamp(mcpPx / (mcpM * scale || 1), 0.15, 1);
  [[INDEX_MCP, MIDDLE_MCP], [MIDDLE_MCP, RING_MCP], [RING_MCP, PINKY_MCP]].forEach(([a, b], i) => {
    c.roots[i] = lerpPt(pts[a], pts[b], 0.5);
  });
  const vx = c.roots[1].x - wr.x, vy = c.roots[1].y - wr.y, vl = Math.hypot(vx, vy) || 1;
  for (let i = 0; i < 3; i++) c.dirs[i] = { x: vx / vl, y: vy / vl };
  c.len = CLAW_LEN_M * scale * fore;
  c.w = CLAW_W_M * scale;
  c.scale = scale;
  c.palmPx = mcpPx || 1;
  c.lost = 0;
  if (!c.out) {
    c.out = true;
    snikt(c);
  }

  // Slash: the middle claw's tip, tracked over a tenth of a second. Fast
  // enough and the three tips' paths are torn into the glass.
  const now = t / 1000;
  const tips = c.roots.map((r, i) => ({ x: r.x + c.dirs[i].x * c.len, y: r.y + c.dirs[i].y * c.len }));
  c.trail.push({ t: now, tips });
  while (c.trail.length > 2 && now - c.trail[0].t > 0.1) c.trail.shift();
  const first = c.trail[0], span = now - first.t;
  if (c.ext > 0.9 && span > 0.02 && now - c.lastSlash > CLAW_SLASH_GAP_S) {
    const speed = dist(first.tips[1], tips[1]) / span / c.palmPx;
    if (speed > SLASH_SPEED) {
      c.lastSlash = now;
      addSlash(first.tips, tips, c.w);
      c.trail = [{ t: now, tips }];
    }
  }
}

function snikt(c) {
  c.glint = 0;
  const r = c.roots[1];
  comicPops.push({ x: r.x, y: r.y - c.scale * 0.08, word: "SNIKT!", size: c.scale * 0.04,
                    rot: (Math.random() - 0.5) * 0.4, age: 0 });
  for (let i = 0; i < 3; i++) {
    const d = c.dirs[i];
    for (let k = 0; k < 5; k++) {
      addSpark(c.roots[i].x, c.roots[i].y, Math.atan2(d.y, d.x) + (Math.random() - 0.5) * 1.2,
               c.scale * (0.3 + Math.random() * 0.5), 0.1 + Math.random() * 0.15, c.scale * 0.4,
               k % 2 ? "#ffffff" : "#cfe3ff");
    }
  }
  shakeScreen(c.scale * 0.002);
  playSound("snikt", { pan: r.x });
}

// Three gashes, each from where a claw tip was to where it is now, pushed
// out past both ends so even a short flick reads as a long cut.
function addSlash(from, to, w) {
  const cuts = from.map((a, i) => {
    const b = to[i], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const ext = Math.max(0, w * 24 - l) / 2 + l * 0.35;
    return { ax: a.x - dx / l * ext, ay: a.y - dy / l * ext, bx: b.x + dx / l * ext, by: b.y + dy / l * ext,
             wob: Math.random() * 10 };
  });
  slashes.push({ cuts, w: w * 0.55, age: 0 });
  // Steel on glass: sparks thrown off along each cut.
  for (const c of cuts) {
    const a = Math.atan2(c.by - c.ay, c.bx - c.ax);
    for (let k = 0; k < 7; k++) {
      const u = Math.random();
      addSpark(c.ax + (c.bx - c.ax) * u, c.ay + (c.by - c.ay) * u, a + (Math.random() - 0.5) * 1.4,
               canvas.height * (0.15 + Math.random() * 0.35), 0.12 + Math.random() * 0.2,
               canvas.height * 0.8, k % 2 ? "#ffffff" : "#bcd8ff");
    }
  }
  while (slashes.length > SLASH_MAX) slashes.shift();
  shakeScreen(w * 0.6);
  playSound("slash", { pan: to[1].x });
}

// A gash: a lens-shaped tear, dark inside, with a bright lip along one side
// and a dark one along the other, as if the glass were cut and pushed open.
function drawSlashes() {
  for (const s of slashes) {
    const a = 1 - smoothstep(SLASH_S - 1, SLASH_S, s.age);
    if (a <= 0) continue;
    const open = Math.min(1, s.age / 0.06);
    for (const c of s.cuts) {
      const dx = c.bx - c.ax, dy = c.by - c.ay, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, N = 16;
      const edge = (side, k) => {
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const u = i / N;
          // Widest a third of the way in, ragged along its length.
          const half = s.w * open * k * Math.pow(Math.sin(Math.PI * u), 0.7) * (1.15 - 0.3 * u) *
            (1 + 0.12 * Math.sin(u * 31 + c.wob));
          pts.push({ x: c.ax + dx * u + nx * half * side, y: c.ay + dy * u + ny * half * side });
        }
        return pts;
      };
      const lens = (k) => {
        ctx.beginPath();
        for (const p of edge(1, k)) ctx.lineTo(p.x, p.y);
        for (const p of edge(-1, k).reverse()) ctx.lineTo(p.x, p.y);
        ctx.closePath();
      };
      ctx.save();
      ctx.globalAlpha = a;
      ctx.lineJoin = "round";
      lens(1.6);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fill();
      ctx.translate(nx * s.w * 0.25, ny * s.w * 0.25);
      lens(1.2);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fill();
      ctx.translate(-nx * s.w * 0.25, -ny * s.w * 0.25);
      lens(1);
      ctx.fillStyle = "rgba(14,10,12,0.92)";
      ctx.fill();
      // The swipe itself: a white streak that flares and fades in a blink.
      if (s.age < 0.2) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a * (1 - s.age / 0.2);
        lens(2.2);
        ctx.fillStyle = "rgba(220,235,255,0.8)";
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

// One blade in its own frame: x from the knuckle (0) to the tip (L), a
// gentle curve, brushed-steel shading across it and a glint that runs up it
// as it comes out.
function drawClaw(root, d, L, W, glint) {
  if (L < 2) return;
  const bend = L * 0.05;
  ctx.save();
  ctx.setTransform(d.x, d.y, -d.y, d.x, root.x, root.y);
  ctx.beginPath();
  ctx.moveTo(0, -W / 2);
  ctx.quadraticCurveTo(L * 0.55, -W * 0.45 - bend, L, -bend * 1.6);
  ctx.quadraticCurveTo(L * 0.6, W * 0.4 - bend * 0.6, 0, W / 2);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -W / 2 - bend, 0, W / 2);
  g.addColorStop(0, "#4a525d");
  g.addColorStop(0.3, "#eef3f8");
  g.addColorStop(0.5, "#b4bec9");
  g.addColorStop(0.75, "#7d8793");
  g.addColorStop(1, "#353b44");
  ctx.fillStyle = g;
  // A soft shadow under each blade, so it sits on the hand and the scene
  // rather than floating over them.
  ctx.shadowColor = "rgba(0,0,0,0.38)";
  ctx.shadowBlur = W * 1.6;
  ctx.shadowOffsetX = W * 0.5;
  ctx.shadowOffsetY = W * 0.7;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(20,24,30,0.55)";
  ctx.lineWidth = Math.max(1, W * 0.08);
  ctx.stroke();
  // Where it leaves the hand.
  ctx.fillStyle = "rgba(60,20,20,0.5)";
  ctx.beginPath();
  ctx.ellipse(0, 0, W * 0.35, W * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  if (glint < 1) {
    const x = L * (0.15 + 0.85 * glint), r = W * 2.2;
    ctx.globalCompositeOperation = "lighter";
    const s = ctx.createRadialGradient(x, -W * 0.15, 0, x, -W * 0.15, r);
    s.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - glint)})`);
    s.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = s;
    ctx.fillRect(x - r, -W * 0.15 - r, r * 2, r * 2);
  }
  ctx.restore();
}

function renderClaws(t) {
  const dt = gagClock(t);
  for (const c of claws.values()) {
    c.ext = c.out ? Math.min(1, c.ext + dt / CLAW_OUT_S) : Math.max(0, c.ext - dt / CLAW_IN_S);
    c.glint = Math.min(1, c.glint + dt / 0.45);
  }
  ageOut(slashes, dt, SLASH_S);
  ageOut(comicPops, dt, POP_S);   // the SNIKT! uses Finger Guns' pops
  stepSparks(dt);

  drawSlashes();
  for (const c of claws.values()) {
    if (c.ext <= 0) continue;
    if (c.glint < 1) spill(c.roots[1].x, c.roots[1].y, c.scale * 0.2, "220,235,255", 0.25 * (1 - c.glint));
    // A snap out (ease-out) and a quicker slide back.
    const e = c.out ? 1 - Math.pow(1 - c.ext, 3) : c.ext * c.ext;
    for (let i = 0; i < 3; i++) {
      // The middle claw is the longest, as in the comics.
      const L = c.len * e * (i === 1 ? 1 : 0.9);
      drawClaw(c.roots[i], c.dirs[i], L, c.w, c.glint);
    }
  }
  drawSparks();
  drawPops();
}

function resetClaws() {
  claws.clear();
  slashes.length = 0;
}

// `f`: three slashes across the middle of the screen.
function triggerClaws() {
  const W = canvas.width, H = canvas.height, a = -0.6 + (Math.random() - 0.5) * 0.6;
  const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx, gap = H * 0.035, l = H * 0.28;
  const from = [], to = [];
  for (let i = -1; i <= 1; i++) {
    from.push({ x: W / 2 - dx * l + nx * gap * i, y: H / 2 - dy * l + ny * gap * i });
    to.push({ x: W / 2 + dx * l + nx * gap * i, y: H / 2 + dy * l + ny * gap * i });
  }
  addSlash(from, to, H * 0.012);
}

// A fist that pops its claws, holds, slashes twice across, then sheathes.
function demoClaws(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const c = t % 4200;
  const swing = (k) => smoothstep(0, 1, k);
  // Rest low right; two fast swipes (0.12 s each) across the middle.
  let k = 0;
  if (c > 1400 && c < 1520) k = swing((c - 1400) / 120);
  else if (c >= 1520 && c < 2300) k = 1;
  else if (c >= 2300 && c < 2420) k = 1 - swing((c - 2300) / 120);
  const hx = w * (0.68 - 0.3 * k), hy = h * (0.62 - 0.12 * k);
  const rot = -0.5 - 0.6 * k;                // knuckles lean into the swing
  const pts = [];
  const ux = Math.cos(rot - Math.PI / 2), uy = Math.sin(rot - Math.PI / 2);
  const px = -uy, py = ux;
  pts[WRIST] = { x: hx - ux * m * 0.05, y: hy - uy * m * 0.05 };
  [INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP].forEach((i, j) => {
    const off = (j - 1.5) * m * 0.021;
    pts[i] = { x: hx + ux * m * 0.04 + px * off, y: hy + uy * m * 0.04 + py * off };
  });
  fctx.save();
  fctx.fillStyle = DEMO_SKIN;
  fctx.beginPath();
  fctx.ellipse(hx, hy, m * 0.05, m * 0.055, rot, 0, Math.PI * 2);
  fctx.fill();
  fctx.restore();
  if (c > 400 && c < 3400) clawPose("demo", pts, null, m, t);
  else { const cl = claws.get("demo"); if (cl) { cl.out = false; cl.trail.length = 0; } }
}

export default defineEffect({
  id: "claws",
  name: "Claws",
  kind: "overlay",
  hint: "Make a fist ✊ — then swing to slash",
  hands: updateClaws,
  demo: demoClaws,
  render: renderClaws,
  reset: resetClaws,
  trigger: triggerClaws,
});
