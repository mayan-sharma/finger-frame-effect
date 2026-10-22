// Web — 🤟 thwip: index + pinky up, middle + ring folded

import { canvas, clamp, clamp01, ctx, defineEffect, demoBlob, dist,
  drawSparks, fingerDown, fingerUp, frame, gagClock, INDEX_MCP, lerpPt,
  MIDDLE_MCP, PINKY_MCP, rayToEdge, RING_MCP, smoothstep, stepSparks,
  trackedHands, unit, WRIST } from "../api.js";

// Web: index + pinky up, middle + ring folded. Each new thwip shoots.
const WEB_COOLDOWN_S = 0.35;
const WEB_SHOT_S = 0.12;         // line travel time
const WEB_LIFE_S = 7;            // splats stay on the glass this long
const WEB_MAX = 8;

const webs = { lines: [], hands: new Map() };

function isThwipPose(w, latched) {
  return fingerUp(w, INDEX_MCP, latched) && fingerUp(w, PINKY_MCP, latched) &&
         fingerDown(w, MIDDLE_MCP, latched) && fingerDown(w, RING_MCP, latched);
}

function updateWebs(res, t) {
  const live = new Set();
  for (const h of trackedHands(res, t)) {
    const st = webs.hands.get(h.key);
    if (!isThwipPose(h.w, !!(st && st.on))) continue;
    const p = h.pts;
    // The shooter is on the wrist; it fires along the back of the hand.
    const o = lerpPt(p[WRIST], p[MIDDLE_MCP], 0.25);
    const dl = dist(p[WRIST], p[MIDDLE_MCP]) || 1;
    webHand(h.key, { x: o.x, y: o.y, dx: (p[MIDDLE_MCP].x - p[WRIST].x) / dl,
                     dy: (p[MIDDLE_MCP].y - p[WRIST].y) / dl, scale: h.scale }, t);
    live.add(h.key);
  }
  for (const k of webs.hands.keys()) if (!live.has(k)) webHand(k, null, t);
}

// One hand's pose this frame (null = not thwipping). The rising edge, held
// for two frames, shoots; while it is held the line stays on the shooter.
function webHand(key, pose, t) {
  let st = webs.hands.get(key);
  if (!st) { st = { on: false, seen: 0, last: -9 }; webs.hands.set(key, st); }
  if (!pose) {
    st.seen = 0;
    if (st.on) {
      st.on = false;
      for (const L of webs.lines) if (L.key === key && L.cut < 0) cutWeb(L);
    }
    return;
  }
  Object.assign(st, pose);
  if (!st.on && ++st.seen >= 2) {
    st.on = true;
    if (t / 1000 - st.last > WEB_COOLDOWN_S) { st.last = t / 1000; shootWeb(key, st); }
  }
  for (const L of webs.lines) if (L.key === key && L.cut < 0) { L.ox = st.x; L.oy = st.y; }
}

function cutWeb(L) {
  L.cut = L.age;
  L.fx = L.ox; L.fy = L.oy;
  L.fvx = 0; L.fvy = 0;
}

function shootWeb(key, st) {
  const reach = rayToEdge(st.x, st.y, st.dx, st.dy);
  const k = Math.max(reach * (0.55 + Math.random() * 0.3), Math.min(reach, canvas.height * 0.25));
  const R = clamp(st.scale * 0.11, canvas.height * 0.07, canvas.height * 0.2);
  // Any earlier line from this hand lets go.
  for (const L of webs.lines) if (L.key === key && L.cut < 0) cutWeb(L);
  webs.lines.push({
    key, ox: st.x, oy: st.y, ax: st.x + st.dx * k, ay: st.y + st.dy * k,
    age: 0, cut: -1, fx: 0, fy: 0, fvx: 0, fvy: 0, R, splat: makeSplat(R),
    rot: Math.random() * Math.PI * 2,
  });
  while (webs.lines.length > WEB_MAX) webs.lines.shift();
}

// Spokes of slightly random angle and length, joined by rings that sag
// toward the middle between each pair of spokes.
function makeSplat(R) {
  const n = 9 + ((Math.random() * 4) | 0);
  const spokes = [];
  for (let i = 0; i < n; i++) {
    spokes.push({ a: (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.35,
                  l: R * (0.75 + Math.random() * 0.45) });
  }
  const rings = [0.2, 0.4, 0.6, 0.8].map((f) => f * (0.92 + Math.random() * 0.16));
  return { spokes, rings };
}

function drawSplat(L, grow, alpha) {
  const { spokes, rings } = L.splat;
  const u = unit();
  ctx.save();
  ctx.translate(L.ax, L.ay);
  ctx.rotate(L.rot);
  ctx.scale(grow, grow);
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  const path = () => {
    ctx.beginPath();
    for (const s of spokes) {
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(s.a) * s.l, Math.sin(s.a) * s.l);
    }
    for (const f of rings) {
      for (let i = 0; i < spokes.length; i++) {
        const s0 = spokes[i], s1 = spokes[(i + 1) % spokes.length];
        const a1 = s1.a + (i === spokes.length - 1 ? Math.PI * 2 : 0);
        const am = (s0.a + a1) / 2, rm = f * (s0.l + s1.l) / 2 * 0.78;
        ctx.moveTo(Math.cos(s0.a) * s0.l * f, Math.sin(s0.a) * s0.l * f);
        ctx.quadraticCurveTo(Math.cos(am) * rm, Math.sin(am) * rm,
                             Math.cos(a1) * s1.l * f, Math.sin(a1) * s1.l * f);
      }
    }
  };
  path();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 3.4 * u / grow;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 1.6 * u / grow;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(0, 0, L.R * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The line: taut and twanging just after it lands, two strands twisted
// together. Cut, its free end drops and the line goes slack and fades.
function drawWebLine(L, alpha) {
  const u = unit();
  let x0 = L.ox, y0 = L.oy, sag = 0;
  if (L.cut >= 0) { x0 = L.fx; y0 = L.fy; sag = Math.min(1, (L.age - L.cut) * 3); }
  const shot = Math.min(1, L.age / WEB_SHOT_S);
  const x1 = x0 + (L.ax - x0) * shot, y1 = y0 + (L.ay - y0) * shot;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
  const twang = len * 0.04 * Math.exp(-Math.max(0, L.age - WEB_SHOT_S) * 7);
  const N = 28;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  for (const [col, lw] of [["rgba(0,0,0,0.3)", 3 * u], ["rgba(255,255,255,0.95)", 1.3 * u]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    for (const strand of [0, Math.PI]) {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const off = Math.sin(Math.PI * s) * (twang * Math.sin(s * Math.PI * 3 - L.age * 40)) +
          Math.sin(s * len / (9 * u) + strand) * 1.4 * u;
        const droop = Math.sin(Math.PI * s) * sag * len * 0.25;
        ctx.lineTo(x0 + (x1 - x0) * s + nx * off, y0 + (y1 - y0) * s + ny * off + droop);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

function renderWebs(t) {
  const dt = gagClock(t);
  const g = canvas.height * 2.5;
  let n = 0;
  for (const L of webs.lines) {
    L.age += dt;
    if (L.cut >= 0) {
      L.fvy += g * dt;
      L.fx += L.fvx * dt;
      L.fy += L.fvy * dt;
    }
    if (L.age < WEB_LIFE_S) webs.lines[n++] = L;
  }
  webs.lines.length = n;
  stepSparks(dt);

  for (const L of webs.lines) {
    if (L.age > WEB_SHOT_S) {
      const k = clamp01((L.age - WEB_SHOT_S) / 0.12);
      const grow = 1 - (1 - k) * (1 - k);
      drawSplat(L, Math.max(0.05, grow), 1 - smoothstep(WEB_LIFE_S - 1, WEB_LIFE_S, L.age));
    }
    const lineA = L.cut < 0 ? 1 : 1 - clamp01((L.age - L.cut) / 0.7);
    if (lineA > 0) drawWebLine(L, lineA);
  }
  drawSparks();
}

function resetWebs() {
  webs.lines.length = 0;
  webs.hands.clear();
}

// `f`: a shot up and across from the bottom of the screen.
function triggerWeb() {
  const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
  shootWeb("key", { x: canvas.width * (0.3 + Math.random() * 0.4), y: canvas.height * 0.98,
                    dx: Math.cos(a), dy: Math.sin(a), scale: canvas.height / 0.55 });
  const L = webs.lines[webs.lines.length - 1];
  setTimeout(() => cutWeb(L), 600);
}

// A hand low on the left, thwipping every 2.6 s at a new angle.
function demoWeb(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const c = t % 2600, n = Math.floor(t / 2600);
  const hx = w * (0.25 + 0.5 * ((n * 0.37) % 1)), hy = h * 0.85;
  const a = -Math.PI / 2 + Math.sin(n * 1.7) * 0.6;
  const on = c > 300 && c < 1900;
  demoBlob(hx, hy, m, a, on ? [[a - 0.25, 0.1], [a + 0.35, 0.08]] : [[a, 0.05]]);
  webHand("demo", on ? { x: hx, y: hy, dx: Math.cos(a), dy: Math.sin(a), scale: m } : null, t);
}

export default defineEffect({
  id: "web",
  name: "Web",
  kind: "overlay",
  hint: "🤟 Thwip! Index + pinky up, middle + ring folded",
  hands: updateWebs,
  demo: demoWeb,
  render: renderWebs,
  reset: resetWebs,
  trigger: triggerWeb,
});
