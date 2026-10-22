// Kamehameha — cup both hands to charge, shove them to fire

import { addSpark, canvas, clamp01, ctx, defineEffect, demoBlob, dist,
  drawSparks, frame, gagClock, KAME_PUSH, MIDDLE_MCP, palmCentre, shakeScreen,
  smoothstep, spill, stepSparks, trackedHands, WRIST } from "../api.js";

// Kamehameha: both palms together charges the ball; once it has charged a
// moment, a shove fires it. Sideways is a beam; at the camera (the hands
// suddenly grow) is a blast that fills the screen.
const KAME_TOGETHER = 1.25;      // palm-centre gap
const KAME_CHARGE_S = 1.6;       // to full size
const KAME_MIN_S = 0.5;          // charge needed before it will fire
const KAME_THRUST = 1.8;         // palm lengths / s sideways
const KAME_BEAM_S = 1.8;
const KAME_LOST_FRAMES = 8;

const kame = { on: false, lost: 0, charge: 0, x: 0, y: 0, palm: 1,
               hist: [], beam: null, motes: [], moteAcc: 0 };

function updateKame(res, t) {
  const hands = trackedHands(res, t);
  if (hands.length < 2) { kameTrack(null, t); return; }
  const [a, b] = hands;
  kameTrack({
    a: palmCentre(a.pts), b: palmCentre(b.pts),
    palm: (dist(a.pts[WRIST], a.pts[MIDDLE_MCP]) + dist(b.pts[WRIST], b.pts[MIDDLE_MCP])) / 2,
  }, t);
}

// `m` is both palm centres and the palm length in pixels, or null.
function kameTrack(m, t) {
  const now = t / 1000;
  if (!m || m.palm < 1) {
    if (++kame.lost > KAME_LOST_FRAMES) { kame.on = false; kame.hist.length = 0; }
    return;
  }
  const gap = dist(m.a, m.b) / m.palm;
  const x = (m.a.x + m.b.x) / 2, y = (m.a.y + m.b.y) / 2;
  const together = gap < KAME_TOGETHER * (kame.on ? 1.3 : 1);
  if (together || kame.beam) {
    // The beam stays rooted in your hands even once they part.
    const jump = Math.hypot(x - kame.x, y - kame.y) > m.palm * 2;
    const k = kame.on && !jump ? 0.55 : 1;
    kame.x += (x - kame.x) * k;
    kame.y += (y - kame.y) * k;
    kame.palm += (m.palm - kame.palm) * (kame.on ? 0.3 : 1);
  }
  if (together) { kame.on = true; kame.lost = 0; }
  else if (++kame.lost > KAME_LOST_FRAMES) kame.on = false;

  // Thrust: over the last quarter second, the hands either shoved sideways
  // (a beam that way) or grew fast, which is a shove at the camera.
  const hist = kame.hist;
  hist.push({ t: now, x, y, palm: m.palm });
  while (hist.length && now - hist[0].t > 0.25) hist.shift();
  if (kame.charge >= KAME_MIN_S && !kame.beam && hist.length >= 3) {
    const h0 = hist[0], span = now - h0.t;
    if (span > 0.06) {
      const vx = (x - h0.x) / span / m.palm, vy = (y - h0.y) / span / m.palm;
      const grow = (m.palm / h0.palm - 1) / span;
      if (grow > KAME_PUSH) fireKame(null);
      else if (Math.hypot(vx, vy) > KAME_THRUST) fireKame(Math.atan2(vy, vx));
    }
  }
}

const kameBallR = () => kame.palm * (0.12 + 0.5 * clamp01(kame.charge / KAME_CHARGE_S));

// `ang` null means straight at the camera.
function fireKame(ang) {
  const power = clamp01(kame.charge / KAME_CHARGE_S);
  kame.beam = { ang, age: 0, power, r: kameBallR(), dur: KAME_BEAM_S * (0.6 + 0.4 * power) };
  kame.charge = 0;
  kame.hist.length = 0;
  shakeScreen(canvas.height * (ang === null ? 0.03 : 0.015) * (0.5 + power));
}

function drawKameBall(x, y, r, t, k) {
  r *= 1 + 0.06 * Math.sin(t * 0.05) + 0.04 * Math.sin(t * 0.13);
  // It lights your hands and face from below, flickering with the ball.
  spill(x, y, r * 9, "110,175,255", 0.4 * k * (0.9 + 0.1 * Math.sin(t * 0.07)));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3.4);
  halo.addColorStop(0, `rgba(120,200,255,${0.45 * k})`);
  halo.addColorStop(0.4, `rgba(40,110,255,${0.18 * k})`);
  halo.addColorStop(1, "rgba(20,60,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - r * 3.4, y - r * 3.4, r * 6.8, r * 6.8);
  const body = ctx.createRadialGradient(x, y, 0, x, y, r);
  body.addColorStop(0, `rgba(255,255,255,${k})`);
  body.addColorStop(0.45, `rgba(190,240,255,${0.95 * k})`);
  body.addColorStop(0.8, `rgba(70,170,255,${0.6 * k})`);
  body.addColorStop(1, "rgba(40,120,255,0)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Crackling arcs, redrawn at random every frame so they flicker.
  ctx.strokeStyle = `rgba(210,245,255,${0.85 * k})`;
  ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.lineJoin = "round";
  const bolts = 2 + Math.round(4 * k);
  for (let i = 0; i < bolts; i++) {
    let a = Math.random() * Math.PI * 2;
    const reach = r * (1.3 + Math.random() * 1.1);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4);
    for (let s = 1; s <= 6; s++) {
      a += (Math.random() - 0.5) * 0.7;
      const rr = r * 0.4 + (reach - r * 0.4) * (s / 6);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Energy motes spiralling in while it charges, in polar coordinates around
// the ball so they follow it when you move.
function stepMotes(dt, r) {
  if (kame.on && !kame.beam) {
    kame.moteAcc += dt * 40;
    while (kame.moteAcc >= 1) {
      kame.moteAcc--;
      kame.motes.push({ a: Math.random() * Math.PI * 2, rad: r * (2.6 + Math.random() * 1.6), age: 0 });
    }
  }
  let n = 0;
  for (const m of kame.motes) {
    m.age += dt;
    m.rad -= m.rad * 2.6 * dt + r * 0.5 * dt;
    m.a += 3 * dt;
    if (m.rad > r * 0.5 && m.age < 1.5) kame.motes[n++] = m;
  }
  kame.motes.length = n;
}

function drawMotes(r) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "#bff0ff";
  for (const m of kame.motes) {
    ctx.globalAlpha = Math.min(1, m.age * 4);
    ctx.beginPath();
    ctx.arc(kame.x + Math.cos(m.a) * m.rad, kame.y + Math.sin(m.a) * m.rad, Math.max(1.5, r * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawKameBeam(b, t, dt) {
  const env = Math.min(1, b.age / 0.08) * (1 - smoothstep(b.dur - 0.35, b.dur, b.age));
  if (env <= 0) return;
  const R = b.r * (0.75 + 0.45 * b.power) * env;
  const W = canvas.width, H = canvas.height;
  if (b.ang === null) {
    // At the camera: the ball swells until it swallows the screen.
    const grow = smoothstep(0, 0.35, b.age);
    const rad = R + Math.hypot(W, H) * grow;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(kame.x, kame.y, 0, kame.x, kame.y, rad);
    g.addColorStop(0, `rgba(255,255,255,${env})`);
    g.addColorStop(0.35, `rgba(170,235,255,${0.85 * env})`);
    g.addColorStop(0.75, `rgba(60,140,255,${0.5 * env})`);
    g.addColorStop(1, "rgba(30,80,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    drawKameBall(kame.x, kame.y, R * 1.3, t, env);
    return;
  }
  const len = Math.hypot(W, H) * 1.2 * Math.min(1, b.age / 0.15);
  // The beam floods the room blue along its length.
  for (let d = 0; d < Math.min(len, Math.hypot(W, H)); d += H * 0.3) {
    spill(kame.x + Math.cos(b.ang) * d, kame.y + Math.sin(b.ang) * d, R * 6, "90,160,255", 0.22 * env);
  }
  ctx.save();
  ctx.translate(kame.x, kame.y);
  ctx.rotate(b.ang);
  ctx.globalCompositeOperation = "lighter";
  const layers = [[2.2, "rgba(40,110,255,0.22)"], [1.5, "rgba(80,190,255,0.45)"],
                  [1.05, "rgba(170,240,255,0.8)"], [0.5, "rgba(255,255,255,0.95)"]];
  const steps = 48;
  layers.forEach(([w, col], li) => {
    const half = (x, side) => R * w / 2 *
      (1 + 0.09 * Math.sin(x / R * 1.7 - b.age * 38 + li * 1.3 + side));
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) { const x = len * i / steps; ctx.lineTo(x, -half(x, 0)); }
    for (let i = steps; i >= 0; i--) { const x = len * i / steps; ctx.lineTo(x, half(x, 2)); }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, R * w / 2 * 1.15, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
  // Sparks peel off the beam's edges.
  for (let i = 0; i < 120 * dt; i++) {
    const along = Math.random() * Math.min(len, Math.hypot(W, H)) * 0.8;
    const side = Math.random() < 0.5 ? -1 : 1;
    const cx = Math.cos(b.ang), cy = Math.sin(b.ang);
    addSpark(kame.x + cx * along - cy * side * R * 0.6, kame.y + cy * along + cx * side * R * 0.6,
             b.ang + side * (0.6 + Math.random() * 0.8), R * (2 + Math.random() * 4),
             0.15 + Math.random() * 0.2, 0, "#c8f4ff");
  }
  drawKameBall(kame.x, kame.y, R * 0.9, t, env);
}

function renderKame(t) {
  const dt = gagClock(t);
  if (kame.on && !kame.beam) {
    kame.charge = Math.min(KAME_CHARGE_S * 1.2, kame.charge + dt);
  } else if (!kame.beam) {
    kame.charge = Math.max(0, kame.charge - dt * 3);   // hands parted: it fizzles
  }
  const r = kameBallR();
  stepMotes(dt, r);
  stepSparks(dt);
  if (kame.beam) {
    kame.beam.age += dt;
    drawKameBeam(kame.beam, t, dt);
    if (kame.beam.age >= kame.beam.dur) kame.beam = null;
  } else if (kame.charge > 0.02) {
    drawMotes(r);
    drawKameBall(kame.x, kame.y, r, t, Math.min(1, kame.charge * 3));
  }
  drawSparks();
}

function resetKame() {
  kame.on = false;
  kame.lost = 0;
  kame.charge = 0;
  kame.hist.length = 0;
  kame.beam = null;
  kame.motes.length = 0;
}

// `f`: fires whatever is charged (or a full one from mid-screen), to the right.
function triggerKame() {
  if (kame.beam) return;
  if (kame.charge < KAME_MIN_S) {
    if (!kame.on) {
      kame.x = canvas.width * 0.35;
      kame.y = canvas.height * 0.55;
      kame.palm = canvas.height * 0.17;
    }
    kame.charge = KAME_CHARGE_S;
  }
  fireKame(0);
}

// Two hands come together, charge, and shove — alternately sideways and at
// the camera.
function demoKame(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const c = t % 7000, n = Math.floor(t / 7000);
  const close = smoothstep(200, 900, c) * (1 - smoothstep(5600, 6200, c));
  const shove = smoothstep(3300, 3550, c);
  const atCam = n % 2 === 1;
  const cx = w * 0.4 + (atCam ? 0 : shove * w * 0.08), cy = h * 0.6;
  const sep = m * (0.16 - 0.12 * close);
  const palm = m * 0.095 * (1 + (atCam ? shove * 0.35 : 0));
  const a = { x: cx - sep, y: cy }, b = { x: cx + sep, y: cy };
  demoBlob(a.x, a.y, m * palm / (m * 0.095), 0.3, [[-1.3, 0.09], [-1.1, 0.095], [-0.9, 0.09]]);
  demoBlob(b.x, b.y, m * palm / (m * 0.095), -0.3, [[-1.85, 0.09], [-2.05, 0.095], [-2.25, 0.09]]);
  kameTrack({ a, b, palm }, t);
}

export default defineEffect({
  id: "kamehameha",
  name: "Kamehameha",
  kind: "overlay",
  hint: "Cup both hands together to charge — then shove them out",
  hands: updateKame,
  demo: demoKame,
  render: renderKame,
  reset: resetKame,
  trigger: triggerKame,
});
