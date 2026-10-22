// Strange Portal — draw a circle in the air, and it opens
//
// Point your index finger (ring and pinky curled) and trace a circle: sparks
// follow the fingertip, and once the loop closes a ring of molten sparks
// spins open at that size and place, with another world inside it. First
// the Mirror Dimension (the room itself, folded into a turning kaleidoscope),
// then the Portal effect's worlds. Draw a circle over it to close it; draw
// one elsewhere and the portal moves there.

import { addSpark, canvas, clamp, clamp01, ctx, defineEffect, demoBlob,
  drawSparks, fingerDown, fingerUp, flashStatus, frame, gagClock, INDEX_MCP,
  INDEX_TIP, makeScratch, PINKY_MCP, playSound, PORTAL_SCENE_FNS,
  PORTAL_SCENES, RING_MCP, shakeScreen, sizeScratch, spill, stepSparks,
  trackedHands, unit } from "../api.js";

// Strange Portal: index up (ring + pinky curled) draws. A stretch of the
// fingertip's trail that sweeps STRANGE_SWEEP radians round its own centroid,
// with radius spread under STRANGE_ROUND of its mean, is a circle.
const STRANGE_SWEEP = Math.PI * 1.75;
const STRANGE_ROUND = 0.38;
const STRANGE_MIN_R = 0.05;      // of screen height
const STRANGE_TRAIL_S = 2.2;
const STRANGE_OPEN_S = 0.55, STRANGE_CLOSE_S = 0.35;
const STRANGE_WORLDS = ["Mirror Dimension", ...PORTAL_SCENES];

const sStrange = makeScratch(false); // a Strange portal's world

const strange = { trail: [], drawing: false, lost: 0, cool: 0, scale: 1, tipX: 0, tipY: 0,
                  tipAcc: 0, portals: [], world: 0 };

function updateStrange(res, t) {
  let tip = null, scale = 1;
  for (const h of trackedHands(res, t)) {
    const on = strange.drawing;
    if (fingerUp(h.w, INDEX_MCP, on) && fingerDown(h.w, RING_MCP, on) && fingerDown(h.w, PINKY_MCP, on)) {
      tip = h.pts[INDEX_TIP];
      scale = h.scale;
      break;
    }
  }
  strangeTrack(tip, scale, t);
}

// The drawing fingertip this frame, or null.
function strangeTrack(tip, scale, t) {
  const now = t / 1000;
  if (!tip) {
    if (++strange.lost > 6) { strange.drawing = false; strange.trail.length = 0; }
    return;
  }
  strange.lost = 0;
  strange.drawing = true;
  strange.tipX = tip.x;
  strange.tipY = tip.y;
  strange.scale = scale;
  const tr = strange.trail;
  tr.push({ x: tip.x, y: tip.y, t: now });
  while (tr.length && now - tr[0].t > STRANGE_TRAIL_S) tr.shift();
  if (now < strange.cool) return;
  const c = findCircle(tr);
  if (c) {
    tr.length = 0;
    strange.cool = now + 0.6;
    castPortal(c.x, c.y, c.r, c.dir);
  }
}

// The newest stretch of the trail that loops round its own centre: it has
// to sweep most of a full turn about its centroid and stay roughly round, so
// a wave or a zigzag does not count. Returns its centre, mean radius and
// which way it was drawn.
function findCircle(tr) {
  const n = tr.length, H = canvas.height;
  if (n < 10) return null;
  for (let j = n - 10; j >= 0; j--) {
    const m = n - j;
    let cx = 0, cy = 0;
    for (let i = j; i < n; i++) { cx += tr[i].x; cy += tr[i].y; }
    cx /= m;
    cy /= m;
    let sum = 0, sum2 = 0, sweep = 0, prev = null;
    for (let i = j; i < n; i++) {
      const dx = tr[i].x - cx, dy = tr[i].y - cy, r = Math.hypot(dx, dy);
      sum += r;
      sum2 += r * r;
      const a = Math.atan2(dy, dx);
      if (prev !== null) { const d = a - prev; sweep += Math.atan2(Math.sin(d), Math.cos(d)); }
      prev = a;
    }
    const mean = sum / m, sd = Math.sqrt(Math.max(0, sum2 / m - mean * mean));
    if (mean < STRANGE_MIN_R * H) continue;
    if (Math.abs(sweep) >= STRANGE_SWEEP && sd / mean < STRANGE_ROUND) {
      return { x: cx, y: cy, r: mean, dir: Math.sign(sweep) || 1 };
    }
  }
  return null;
}

function castPortal(x, y, r, dir) {
  const H = canvas.height;
  const open = strange.portals.find((p) => !p.closing);
  if (open) {
    open.closing = true;
    open.closeAge = 0;
    playSound("crackle", { pan: open.x });
    // Drawn over the open one: that was a close, not a new portal.
    if (Math.hypot(x - open.x, y - open.y) < open.R) return;
  }
  const world = strange.world;
  strange.world = (strange.world + 1) % STRANGE_WORLDS.length;
  strange.portals.push({ x, y, R: clamp(r * 1.15, H * 0.12, H * 0.45), age: 0,
                         closing: false, closeAge: 0, world, spin: dir || 1 });
  flashStatus(`Portal → ${STRANGE_WORLDS[world]}`);
  shakeScreen(H * 0.004);
  playSound("shimmer", { pan: x });
  playSound("crackle", { pan: x, duration: 0.8 });
}

// The room, sliced into eight wedges round the portal's centre, every other
// one mirrored, turning slowly: the Mirror Dimension.
function drawMirrorDimension(P, r, t) {
  const N = 8, wedge = (Math.PI * 2) / N, spin = t * 0.00015 * P.spin;
  const sx = P.x + r * 0.6 * Math.cos(t * 0.0002), sy = P.y + r * 0.35 * Math.sin(t * 0.00027);
  for (let k = 0; k < N; k++) {
    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.rotate(k * wedge + spin);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 1.02, -wedge / 2 - 0.01, wedge / 2 + 0.01);
    ctx.closePath();
    ctx.clip();
    if (k % 2) ctx.scale(1, -1);
    ctx.scale(1.35, 1.35);
    ctx.drawImage(frame, -sx + r * 0.35, -sy);
    ctx.restore();
  }
  // A cold, other-worldly cast over it.
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = "rgba(70,230,190,0.55)";
  ctx.fillRect(P.x - r, P.y - r, r * 2, r * 2);
  ctx.restore();
}

function drawStrangePortal(P, t, dt) {
  const k = P.closing ? 1 - clamp01(P.closeAge / STRANGE_CLOSE_S)
                      : 1 - Math.pow(1 - clamp01(P.age / STRANGE_OPEN_S), 3);
  const r = P.R * k, H = canvas.height;
  if (r < 2) return;
  spill(P.x, P.y, r * 1.9, "255,140,40", 0.32 * k);

  // The world inside, darkening toward the rim so it reads as depth.
  ctx.save();
  ctx.beginPath();
  ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
  ctx.clip();
  if (P.world === 0) {
    drawMirrorDimension(P, r, t);
  } else {
    const S = Math.max(2, Math.ceil(r * 2));
    const g = sizeScratch(sStrange, S, S);
    g.save();
    PORTAL_SCENE_FNS[P.world - 1](g, S, S, t);
    g.restore();
    ctx.drawImage(sStrange.c, P.x - r, P.y - r);
  }
  const depth = ctx.createRadialGradient(P.x, P.y, r * 0.65, P.x, P.y, r);
  depth.addColorStop(0, "rgba(0,0,0,0)");
  depth.addColorStop(1, "rgba(10,4,0,0.55)");
  ctx.fillStyle = depth;
  ctx.fillRect(P.x - r, P.y - r, r * 2, r * 2);
  ctx.restore();

  // The ring: a few jittered loops of molten orange, the wobble running
  // round in the direction it was drawn.
  const ph = t * 0.004 * P.spin;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  const loops = [[0.07, "rgba(255,110,20,0.30)"], [0.035, "rgba(255,150,40,0.55)"],
                 [0.014, "rgba(255,210,110,0.9)"], [0.006, "rgba(255,250,220,1)"]];
  loops.forEach(([w, col], i) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, r * w);
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.06; a += 0.05) {
      const rr = r * (1 + 0.022 * Math.sin(a * 9 + ph * 3 + i) + 0.012 * Math.sin(a * 23 - ph * 5 + i * 2));
      ctx.lineTo(P.x + Math.cos(a) * rr, P.y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.stroke();
  });
  ctx.restore();

  // Sparks thrown off the rim along the spin, falling as they go.
  P.sparkAcc = (P.sparkAcc || 0) + dt * 520 * k;
  while (P.sparkAcc >= 1) {
    P.sparkAcc--;
    const a = Math.random() * Math.PI * 2;
    const tangent = a + P.spin * Math.PI / 2 + (Math.random() - 0.5) * 0.5 + 0.25 * P.spin;
    const roll = Math.random();
    addSpark(P.x + Math.cos(a) * r, P.y + Math.sin(a) * r, tangent, H * (0.25 + Math.random() * 0.6),
             0.25 + Math.random() * 0.45, H * 1.6, roll < 0.5 ? "#ffb347" : roll < 0.85 ? "#ffd27a" : "#fff4d6");
  }
}

function renderStrange(t) {
  const dt = gagClock(t);
  const now = t / 1000, H = canvas.height, u = unit();
  stepSparks(dt);
  for (const P of strange.portals) {
    P.age += dt;
    if (P.closing) P.closeAge += dt;
  }
  strange.portals = strange.portals.filter((P) => !P.closing || P.closeAge < STRANGE_CLOSE_S);
  for (const P of strange.portals) drawStrangePortal(P, t, dt);

  // The trail the fingertip is drawing, fading over a second, with sparks
  // coming off the tip itself.
  const tr = strange.trail;
  if (strange.drawing && tr.length > 1) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 1; i < tr.length; i++) {
      const a = 1 - clamp01((now - tr[i].t) / 1.0);
      if (a <= 0) continue;
      ctx.strokeStyle = `rgba(255,160,50,${0.8 * a})`;
      ctx.lineWidth = (2 + 4 * a) * u;
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
      ctx.lineTo(tr[i].x, tr[i].y);
      ctx.stroke();
    }
    ctx.restore();
    spill(strange.tipX, strange.tipY, H * 0.08, "255,150,40", 0.3);
    strange.tipAcc += dt * 140;
    while (strange.tipAcc >= 1) {
      strange.tipAcc--;
      addSpark(strange.tipX, strange.tipY, Math.random() * Math.PI * 2, H * (0.05 + Math.random() * 0.2),
               0.15 + Math.random() * 0.2, H * 1.2, Math.random() < 0.6 ? "#ffb347" : "#fff0c8");
    }
  }
  drawSparks();
}

function resetStrange() {
  strange.trail.length = 0;
  strange.drawing = false;
  strange.lost = 0;
  strange.cool = 0;
  strange.portals.length = 0;
}

// `f`: opens one mid-screen, or closes the one that is open.
function triggerStrange() {
  const open = strange.portals.find((p) => !p.closing);
  if (open) castPortal(open.x, open.y, open.R, open.spin);
  else castPortal(canvas.width * 0.5, canvas.height * 0.45, canvas.height * 0.25, 1);
}

// A pointing hand that traces a circle early in each 12 s cycle (a portal
// opens), then traces over it near the end (it closes).
function demoStrange(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const c = t % 12000;
  const cx = w * 0.6, cy = h * 0.42, r = h * 0.17;
  let k = -1;
  if (c > 400 && c < 2200) k = (c - 400) / 1500;
  else if (c > 8000 && c < 9800) k = (c - 8000) / 1500;
  if (k < 0) { strangeTrack(null, m, t); return; }
  const a = -Math.PI / 2 + Math.min(k, 1.15) * Math.PI * 2;
  const tip = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  demoBlob(tip.x, tip.y + m * 0.1, m, 0, [[-Math.PI / 2, 0.1]]);
  strangeTrack(tip, m, t);
}

export default defineEffect({
  id: "strange-portal",
  name: "Strange Portal",
  kind: "overlay",
  hint: "☝️ Draw a circle in the air to open a portal — draw over it to close",
  hands: updateStrange,
  demo: demoStrange,
  render: renderStrange,
  reset: resetStrange,
  trigger: triggerStrange,
  // Changes the world through the open portal, and the next one's.
  cycle(step) {
    const n = STRANGE_WORLDS.length;
    const open = strange.portals.find((p) => !p.closing);
    if (open) open.world = (open.world + step + n) % n;
    strange.world = ((open ? open.world : strange.world) + (open ? 1 : step) + n) % n;
    return `Portal → ${STRANGE_WORLDS[open ? open.world : strange.world]}`;
  },
});
