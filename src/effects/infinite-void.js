// Infinite Void — 🤞 Domain Expansion
//
// Gojo's sign held for a moment expands a domain out of your fingertips: a
// circle that swallows the room and replaces it with the void (a black sun
// with a white-hot rim, light rays, nebula, and stars streaming out of it).
// You stay in front of it through the person mask, outlined in blue. The
// same sign again collapses it back into your hand.

import { addSpark, canvas, clamp01, ctx, defineEffect, demoPerson, drawSparks,
  drawVoidPerson, fingerDown, fingerUp, flashStatus, frame, gagClock,
  INDEX_MCP, INDEX_TIP, jpFont, latinFont, lerpPt, makeScratch, maskAvailable,
  MIDDLE_MCP, PINKY_MCP, playSound, RING_MCP, shakeScreen, sizeScratch,
  smoothstep, spill, stepSparks, titleCardAt, trackedHands } from "../api.js";

// Infinite Void: index + middle up and crossed (or pressed together), ring +
// pinky curled, held for VOID_HOLD_S. Crossing is crossAmount() falling
// through VOID_CROSS_ON; the same sign again collapses the domain.
const VOID_CROSS_ON = 0.25, VOID_CROSS_OFF = 0.5;
const VOID_HOLD_S = 0.45;
const VOID_OPEN_S = 0.9, VOID_CLOSE_S = 0.6;
const VOID_STARS = 360;

// The half-res void.
const sVoid = makeScratch(false);

const voidFx = { phase: "idle", t: 0, cast: 0, x: 0, y: 0, hx: 0, hy: 0,
                 signOn: false, since: 0, armed: true, lost: 0, stars: [] };

// Middle fingertip's offset from the index fingertip, measured along the
// index -> middle knuckle line and in units of it: about 1 side by side,
// more for a V, near 0 pressed together, and negative once crossed.
function crossAmount(w) {
  const a = w[INDEX_MCP], b = w[MIDDLE_MCP], p = w[INDEX_TIP], q = w[MIDDLE_MCP + 3];
  const ax = b.x - a.x, ay = b.y - a.y, az = (b.z || 0) - (a.z || 0);
  const a2 = ax * ax + ay * ay + az * az || 1;
  return ((q.x - p.x) * ax + (q.y - p.y) * ay + ((q.z || 0) - (p.z || 0)) * az) / a2;
}

function updateVoid(res, t) {
  let sign = null;
  for (const h of trackedHands(res, t)) {
    const on = voidFx.signOn;
    // Crossed fingers are never quite straight, so "up" uses the looser
    // stay-on threshold from the start.
    if (!fingerUp(h.w, INDEX_MCP, true) || !fingerUp(h.w, MIDDLE_MCP, true) ||
        !fingerDown(h.w, RING_MCP, on) || !fingerDown(h.w, PINKY_MCP, on)) continue;
    if (crossAmount(h.w) < (on ? VOID_CROSS_OFF : VOID_CROSS_ON)) {
      sign = lerpPt(h.pts[INDEX_TIP], h.pts[MIDDLE_MCP + 3], 0.5);
      break;
    }
  }
  voidSign(sign, t);
}

// The sign's fingertips this frame, or null. Held for VOID_HOLD_S it casts
// (or collapses); it has to be dropped before it can fire again.
function voidSign(p, t) {
  const now = t / 1000;
  if (!p) {
    if (++voidFx.lost > 4) { voidFx.signOn = false; voidFx.armed = true; }
    return;
  }
  voidFx.lost = 0;
  if (!voidFx.signOn) { voidFx.signOn = true; voidFx.since = now; }
  voidFx.hx = p.x;
  voidFx.hy = p.y;
  if (voidFx.armed && now - voidFx.since >= VOID_HOLD_S) {
    voidFx.armed = false;
    toggleVoid(p.x, p.y);
  }
}

function toggleVoid(x, y) {
  voidFx.x = x;
  voidFx.y = y;
  if (voidFx.phase === "idle" || voidFx.phase === "closing") {
    voidFx.phase = "opening";
    voidFx.t = 0;
    voidFx.cast = 0;
    if (!maskAvailable()) flashStatus("Infinite Void keeps you in front once the person mask loads", 2500);
  } else {
    voidFx.phase = "closing";
    voidFx.t = 0;
  }
  for (let i = 0; i < 30; i++) {
    addSpark(x, y, Math.random() * Math.PI * 2, canvas.height * (0.2 + Math.random() * 0.6),
             0.2 + Math.random() * 0.4, 0, i % 2 ? "#ffffff" : "#8fc4ff");
  }
  shakeScreen(canvas.height * 0.01);
  playSound("boom", { pan: x, pitch: voidFx.phase === "opening" ? 1 : 1.4 });
}

// Stars in 3D, flying at the viewer out of the black sun.
function stepVoidStars(dt) {
  const st = voidFx.stars;
  while (st.length < VOID_STARS) {
    st.push({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2,
              z: st.length ? 1 : Math.random(), pz: 1 });
  }
  for (const s of st) {
    s.pz = s.z;
    s.z -= dt * (0.25 + 0.15 * Math.abs(s.x));
    if (s.z < 0.03) { s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = s.pz = 1; }
  }
}

// The void, into a half-resolution layer: it is all glow and gradients, and
// the upscale only softens it further.
function drawVoidScene(t) {
  const W = Math.max(2, Math.round(canvas.width / 2)), H = Math.max(2, Math.round(canvas.height / 2));
  const g = sizeScratch(sVoid, W, H);
  const time = t / 1000;
  const cx = W * 0.5, cy = H * 0.36, R = H * 0.2;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.7);
  bg.addColorStop(0, "#101a3c");
  bg.addColorStop(0.5, "#060a1e");
  bg.addColorStop(1, "#010208");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  g.globalCompositeOperation = "lighter";
  // Nebula: a few big soft clouds wheeling slowly around the sun.
  const clouds = [["90,60,200", 0.9, 0], ["30,110,230", 1.1, 2.1], ["170,70,210", 0.75, 4.2], ["40,170,220", 1.3, 5.3]];
  for (const [rgb, r, ph] of clouds) {
    const a = ph + time * 0.05, d = H * (0.35 + 0.1 * Math.sin(time * 0.2 + ph));
    const x = cx + Math.cos(a) * d * 1.4, y = cy + Math.sin(a) * d * 0.7, rad = H * 0.55 * r;
    const n = g.createRadialGradient(x, y, 0, x, y, rad);
    n.addColorStop(0, `rgba(${rgb},0.22)`);
    n.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = n;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // Warp stars, as streaks from where they were to where they are.
  const S = H * 0.5;
  g.lineCap = "round";
  for (const s of voidFx.stars) {
    const x0 = cx + s.x / s.pz * S * 0.3, y0 = cy + s.y / s.pz * S * 0.3;
    const x1 = cx + s.x / s.z * S * 0.3, y1 = cy + s.y / s.z * S * 0.3;
    const k = 1 - s.z;
    g.strokeStyle = `rgba(${200 + 55 * k | 0},${220 + 35 * k | 0},255,${0.15 + 0.85 * k})`;
    g.lineWidth = 0.6 + 1.8 * k;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }

  // Rays fanning off the rim, slowly turning.
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2 + time * 0.08;
    const len = R * (1.3 + 0.9 * (0.5 + 0.5 * Math.sin(i * 12.9 + time * 1.7)));
    g.strokeStyle = `rgba(170,205,255,${0.05 + 0.08 * (0.5 + 0.5 * Math.sin(i * 7.3 + time))})`;
    g.lineWidth = 1 + (i % 3);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    g.stroke();
  }
  const halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 2.8);
  halo.addColorStop(0, "rgba(150,195,255,0.55)");
  halo.addColorStop(0.25, "rgba(80,130,255,0.22)");
  halo.addColorStop(1, "rgba(40,60,200,0)");
  g.fillStyle = halo;
  g.fillRect(cx - R * 2.8, cy - R * 2.8, R * 5.6, R * 5.6);

  // The black sun itself, and its rim, glowing white-hot.
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "#000004";
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = "lighter";
  const pulse = 1 + 0.04 * Math.sin(time * 2.3);
  for (const [w, a] of [[R * 0.22, 0.12], [R * 0.1, 0.3], [R * 0.035, 0.9]]) {
    g.strokeStyle = `rgba(225,240,255,${a})`;
    g.lineWidth = w * pulse;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";
}

// Title cards: 領域展開 as the domain spreads, then the domain's name.
function drawVoidTitles(c) {
  const W = canvas.width, H = canvas.height, blue = "rgba(90,150,255,0.9)";
  const card = (text, size, y, a, spacing, font) => titleCardAt(text, W / 2, y, size, a, spacing, font, blue);
  const jp = jpFont, latin = latinFont;
  const env = (a, b, c0, d) => smoothstep(a, b, c) * (1 - smoothstep(c0, d, c));
  card("領域展開", H * 0.085, H * 0.14, env(0.05, 0.35, 1.5, 2.0), H * 0.02, jp);
  card("DOMAIN EXPANSION", H * 0.022, H * 0.215, env(0.15, 0.45, 1.5, 2.0), H * 0.012, latin);
  card("無量空処", H * 0.12, H * 0.66, env(1.1, 1.5, 4.2, 5.0), H * 0.03, jp);
  card("INFINITE VOID", H * 0.03, H * 0.76, env(1.3, 1.7, 4.2, 5.0), H * 0.02, latin);
}

function renderVoid(t) {
  const dt = gagClock(t);
  voidFx.t += dt;
  voidFx.cast += dt;
  const W = canvas.width, H = canvas.height;
  const maxR = Math.hypot(Math.max(voidFx.x, W - voidFx.x), Math.max(voidFx.y, H - voidFx.y)) * 1.05;
  let r = 0;
  if (voidFx.phase === "opening") {
    const k = clamp01(voidFx.t / VOID_OPEN_S);
    r = maxR * (1 - Math.pow(1 - k, 3));
    if (k >= 1) voidFx.phase = "open";
  } else if (voidFx.phase === "open") {
    r = maxR;
  } else if (voidFx.phase === "closing") {
    const k = clamp01(voidFx.t / VOID_CLOSE_S);
    r = maxR * (1 - k * k);
    if (k >= 1) voidFx.phase = "idle";
  }
  stepSparks(dt);

  if (r > 1) {
    stepVoidStars(dt);
    drawVoidScene(t);
    ctx.save();
    ctx.beginPath();
    ctx.arc(voidFx.x, voidFx.y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(sVoid.c, 0, 0, W, H);
    // The information overload: now and then the void flares white.
    const flare = Math.max(0, Math.sin(voidFx.cast * 2.1) ** 40);
    if (flare > 0.02) {
      ctx.fillStyle = `rgba(230,240,255,${0.35 * flare})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawVoidPerson();
    ctx.restore();
    if (voidFx.phase === "opening" || voidFx.phase === "closing") {
      // The domain's boundary as it moves.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [w, a] of [[H * 0.05, 0.12], [H * 0.015, 0.4], [H * 0.004, 0.95]]) {
        ctx.strokeStyle = `rgba(200,225,255,${a})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.arc(voidFx.x, voidFx.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (voidFx.phase !== "closing") drawVoidTitles(voidFx.cast);
  }

  // While the sign is being held, a small blue charge gathers on the tips.
  if (voidFx.signOn && voidFx.armed) {
    const k = clamp01((t / 1000 - voidFx.since) / VOID_HOLD_S);
    const rad = H * (0.015 + 0.05 * k);
    spill(voidFx.hx, voidFx.hy, H * 0.3 * k, "120,170,255", 0.3 * k);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(voidFx.hx, voidFx.hy, 0, voidFx.hx, voidFx.hy, rad);
    g.addColorStop(0, `rgba(255,255,255,${0.5 + 0.5 * k})`);
    g.addColorStop(0.4, `rgba(120,180,255,${0.6 * k + 0.2})`);
    g.addColorStop(1, "rgba(60,100,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(voidFx.hx - rad, voidFx.hy - rad, rad * 2, rad * 2);
    ctx.restore();
  }
  drawSparks();
}

function resetVoid() {
  voidFx.phase = "idle";
  voidFx.t = 0;
  voidFx.signOn = false;
  voidFx.armed = true;
  voidFx.lost = 0;
  voidFx.stars.length = 0;
}

// `f`: expands from the middle of the screen, or collapses it.
function triggerVoid() {
  toggleVoid(voidFx.signOn ? voidFx.hx : canvas.width * 0.5,
             voidFx.signOn ? voidFx.hy : canvas.height * 0.45);
}

// The silhouette making Gojo's sign by its face: the domain opens early in
// each 14 s cycle and collapses near the end.
function demoVoid(t) {
  const { hx, hy, m } = demoPerson(t, (x, m) => ({
    x: x + m * 0.15, y: frame.height * 0.47, fingers: [[-1.62, 0.1], [-1.5, 0.1]] }));
  const c = t % 14000;
  const holding = (c > 500 && c < 1200) || (c > 10500 && c < 11200);
  voidSign(holding ? { x: hx + m * 0.01, y: hy - m * 0.1 } : null, t);
}

export default defineEffect({
  id: "infinite-void",
  name: "Infinite Void",
  kind: "overlay",
  hint: "🤞 Cross index + middle fingers and hold — Domain Expansion",
  needs: { mask: true },
  hands: updateVoid,
  demo: demoVoid,
  render: renderVoid,
  reset: resetVoid,
  trigger: triggerVoid,
});
