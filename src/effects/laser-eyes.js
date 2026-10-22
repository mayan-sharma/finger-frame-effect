// Laser Eyes — raise your eyebrows; turn your head to aim

import { addSpark, canvas, clamp01, ctx, defineEffect, dist, drawSmoke,
  drawSparks, emitSmoke, flashStatus, gagClock, makeScratch, rayToEdge,
  sizeScratch, smoothPoints, smoothstep, spill, stepSmoke, stepSparks,
  toScreen } from "../api.js";

// Laser Eyes: blendshape score (brow raise or wide eyes) latch, and how far
// a head turn (nose offset in face widths) throws the beams.
const LASER_ON = 0.45, LASER_OFF = 0.28;
const LASER_GAIN = 5;
const IRIS_R = 468, IRIS_L = 473;  // iris centres in the 478-point face mesh
const NOSE_TIP = 1, FACE_R = 234, FACE_L = 454;

// Half-res burn marks, and their cooling glow.
const sScorch = makeScratch(false), sScorchGlow = makeScratch(false);

const laser = { seen: false, latched: false, forced: false, lost: 0, presence: 0,
                eyes: null, faceW: 1, dx: 0, dy: 0, ux: 0, uy: 1, v0: 0,
                lastHit: null, smokeAcc: 0 };

function updateLaser(face, t) {
  const f = face && face.faceLandmarks && face.faceLandmarks[0];
  if (!f) {
    if (++laser.lost > 10) { laser.seen = false; laser.latched = false; }
    return;
  }
  // Blendshapes when the model gives them: a brow raise or wide eyes.
  let score = null;
  const bs = face.faceBlendshapes && face.faceBlendshapes[0];
  if (bs && bs.categories) {
    const s = {};
    for (const c of bs.categories) s[c.categoryName] = c.score;
    score = Math.max(s.browInnerUp || 0, ((s.eyeWideLeft || 0) + (s.eyeWideRight || 0)) / 2);
  }
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const iris = f.length > IRIS_L ? [f[IRIS_R], f[IRIS_L]]
                                 : [mid(f[33], f[133]), mid(f[362], f[263])];
  const [e0, e1, nose, cr, cl] = smoothPoints("face",
    [...iris, f[NOSE_TIP], f[FACE_R], f[FACE_L]].map(toScreen), t);
  applyEyes([e0, e1], nose, cr, cl, score);
}

// Screen-space eyes, nose tip and the two sides of the face in; aim out. The
// nose swings toward whichever way the head turns, so its offset from the
// middle of the face, in face widths, is the aim. Across the face that is
// zero when you look straight ahead; down the face it is not (the nose sits
// low), so that axis is measured against a slow running baseline.
function applyEyes(eyes, nose, cr, cl, score) {
  const faceW = Math.max(1, dist(cr, cl));
  const ax = (cl.x - cr.x) / faceW, ay = (cl.y - cr.y) / faceW;
  const px = -ay, py = ax;
  const ox = nose.x - (cr.x + cl.x) / 2, oy = nose.y - (cr.y + cl.y) / 2;
  const u = (ox * ax + oy * ay) / faceW, v = (ox * px + oy * py) / faceW;
  if (!laser.seen) laser.v0 = v;
  else if (!laser.latched) laser.v0 += (v - laser.v0) * 0.004;
  const dv = v - laser.v0;
  const dx = u * ax + dv * px, dy = u * ay + dv * py;
  const k = laser.seen ? 0.35 : 1;
  laser.dx += (dx - laser.dx) * k;
  laser.dy += (dy - laser.dy) * k;
  laser.eyes = eyes;
  laser.faceW = faceW;
  if (score !== null) laser.latched = score > (laser.latched ? LASER_OFF : LASER_ON);
  laser.seen = true;
  laser.lost = 0;
}

function renderLaser(t) {
  const dt = gagClock(t);
  const on = laser.seen && (laser.latched || laser.forced);
  laser.presence += ((on ? 1 : 0) - laser.presence) * (on ? 0.35 : 0.2);
  const W = canvas.width, H = canvas.height;
  const sw = Math.max(1, Math.round(W / 2)), sh = Math.max(1, Math.round(H / 2));
  const burn = sizeScratch(sScorch, sw, sh), glow = sizeScratch(sScorchGlow, sw, sh);
  // Burns linger for seconds; their glow cools in a fraction of one.
  for (const [g, tau] of [[burn, 6], [glow, 0.35]]) {
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = `rgba(0,0,0,${1 - Math.exp(-dt / tau)})`;
    g.fillRect(0, 0, sw, sh);
    g.globalCompositeOperation = "source-over";
  }

  // Last frame's burns go under this frame's beams.
  ctx.drawImage(sScorch.c, 0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(sScorchGlow.c, 0, 0, W, H);
  ctx.restore();

  if (laser.eyes && laser.presence > 0.02) {
    const fw = laser.faceW, p = laser.presence;
    const mag = Math.hypot(laser.dx, laser.dy);
    if (mag > 1e-3) { laser.ux = laser.dx / mag; laser.uy = laser.dy / mag; }
    const ex = (laser.eyes[0].x + laser.eyes[1].x) / 2, ey = (laser.eyes[0].y + laser.eyes[1].y) / 2;
    const reach = clamp01(mag * LASER_GAIN);
    const edge = rayToEdge(ex, ey, laser.ux, laser.uy);
    const L = Math.min(edge, fw * 0.5) + Math.max(0, edge - fw * 0.5) * reach;
    const lineA = smoothstep(0.015, 0.05, mag) * p;
    const hit = { x: ex + laser.ux * L, y: ey + laser.uy * L };

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const flick = 1 + 0.15 * Math.sin(t * 0.07) + 0.1 * Math.sin(t * 0.19);
    // Both beams converge on one point, the way a heat-vision stare does.
    if (lineA > 0.01) {
      for (const [w, col] of [[0.11, `rgba(255,0,0,${0.2 * lineA})`], [0.05, `rgba(255,40,30,${0.65 * lineA})`],
                              [0.017, `rgba(255,235,225,${0.95 * lineA})`]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = fw * w * flick;
        ctx.beginPath();
        for (const e of laser.eyes) { ctx.moveTo(e.x, e.y); ctx.lineTo(hit.x, hit.y); }
        ctx.stroke();
      }
      const hr = fw * 0.3 * flick;
      const hg = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, hr);
      hg.addColorStop(0, `rgba(255,250,220,${lineA})`);
      hg.addColorStop(0.3, `rgba(255,140,40,${0.7 * lineA})`);
      hg.addColorStop(1, "rgba(255,40,0,0)");
      ctx.fillStyle = hg;
      ctx.fillRect(hit.x - hr, hit.y - hr, hr * 2, hr * 2);
    }
    // Red light on the face around the eyes, and on whatever is burning.
    for (const e of laser.eyes) spill(e.x, e.y, fw * 0.55, "255,40,25", 0.3 * p);
    if (lineA > 0.01) spill(hit.x, hit.y, fw * 1.4, "255,120,40", 0.35 * lineA);
    // Each eye: a hot core and an anamorphic streak.
    for (const e of laser.eyes) {
      const r = fw * 0.17 * flick;
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      g.addColorStop(0, `rgba(255,255,255,${p})`);
      g.addColorStop(0.25, `rgba(255,60,40,${0.85 * p})`);
      g.addColorStop(1, "rgba(255,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(e.x - r, e.y - r, r * 2, r * 2);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.scale(1, 0.07);
      const sr = fw * 0.75;
      const s = ctx.createRadialGradient(0, 0, 0, 0, 0, sr);
      s.addColorStop(0, `rgba(255,90,70,${0.6 * p})`);
      s.addColorStop(1, "rgba(255,0,0,0)");
      ctx.fillStyle = s;
      ctx.fillRect(-sr, -sr, sr * 2, sr * 2);
      ctx.restore();
    }
    ctx.restore();

    // Only a beam that is actually reaching out leaves a mark.
    if (lineA > 0.5) {
      const prev = laser.lastHit && Math.hypot(hit.x - laser.lastHit.x, hit.y - laser.lastHit.y) < W * 0.25
        ? laser.lastHit : hit;
      const mark = (g, w, col) => {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(prev.x / 2, prev.y / 2);
        g.lineTo(hit.x / 2 + 0.01, hit.y / 2);
        g.stroke();
      };
      mark(burn, fw * 0.11, "rgba(40,20,10,0.10)");
      mark(burn, fw * 0.05, "rgba(20,8,2,0.35)");
      mark(glow, fw * 0.04, "rgba(255,120,30,0.9)");
      mark(glow, fw * 0.015, "rgba(255,240,190,1)");
      for (let i = 0; i < 300 * dt; i++) {
        const a = Math.atan2(-laser.uy, -laser.ux) + (Math.random() - 0.5) * 2.6;
        addSpark(hit.x, hit.y, a, fw * (1 + Math.random() * 2.5), 0.2 + Math.random() * 0.3,
                 fw * 5, Math.random() < 0.5 ? "#ffb347" : "#ffe9a8");
      }
      laser.smokeAcc += 22 * dt;
      while (laser.smokeAcc >= 1) {
        laser.smokeAcc--;
        emitSmoke({
          x: hit.x, y: hit.y, vx: (Math.random() - 0.5) * fw * 0.4, vy: -fw * (0.2 + Math.random() * 0.4),
          r0: fw * 0.05, r1: fw * (0.4 + Math.random() * 0.4), grow: 0.9,
          life: 1.6 + Math.random() * 1.2, alpha: 0.14 + Math.random() * 0.1,
          rise: fw * 1.2, drag: 1, turb: fw * 0.8,
        });
      }
      laser.lastHit = hit;
    } else {
      laser.lastHit = null;
    }
  } else {
    laser.lastHit = null;
  }

  stepSparks(dt);
  stepSmoke(dt, t / 1000);
  drawSmoke();
  drawSparks();
}

function resetLaser() {
  laser.seen = false;
  laser.latched = false;
  laser.forced = false;
  laser.lost = 0;
  laser.presence = 0;
  laser.eyes = null;
  laser.lastHit = null;
  laser.dx = laser.dy = 0;
  for (const s of [sScorch, sScorchGlow]) s.c.width = s.c.height = 1;
}

// `f`: lasers on or off by hand, for when your eyebrows are tired.
function triggerLaser() {
  laser.forced = !laser.forced;
  flashStatus(laser.forced ? "Lasers locked on 🔴 (f again to release)" : "Lasers back on your eyebrows");
}

// Laser eyes on the stand-in face, sweeping its gaze side to side.
function demoLaser(t, face) {
  if (!face) return;
  const { x, y, m } = face;
  const yaw = 0.14 * Math.sin(t * 0.0008), pitch = 0.05 * Math.sin(t * 0.0013);
  const eyes = [{ x: x - m * 0.03, y: y - m * 0.02 }, { x: x + m * 0.03, y: y - m * 0.02 }];
  applyEyes(eyes, { x: x + yaw * m * 0.15, y: y + m * 0.015 + pitch * m * 0.15 },
            { x: x + m * 0.075, y }, { x: x - m * 0.075, y }, (t % 7000) < 5200 ? 1 : 0);
}

export default defineEffect({
  id: "laser-eyes",
  name: "Laser Eyes",
  kind: "overlay",
  hint: "Raise your eyebrows 👀 — turn your head to aim",
  needs: { face: true },
  face: updateLaser,
  demo: demoLaser,
  render: renderLaser,
  reset: resetLaser,
  trigger: triggerLaser,
});
