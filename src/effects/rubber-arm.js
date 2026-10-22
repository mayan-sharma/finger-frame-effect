// Rubber Arm — ゴムゴムの… PISTOL!
//
// Make a fist and punch: the fist shoots out on an arm that stretches like
// rubber (thinner the further it goes), lands with a thud, then snaps back
// and wobbles. Punch at the camera (the fist suddenly grows) and it flies at
// you instead, filling the screen. Both hands work: alternate fast enough
// and it's a Gatling.
//
// The flying fist is your own: a feathered patch copied out of the camera
// frame around your real fist every frame, so it opens and turns with it.
// The arm starts at your real fist and covers it, so there's only ever one.

import { addSpark, ageOut, canvas, clamp01, comicPops, ctx, defineEffect,
  DEMO_SKIN, dist, drawPops, drawSparks, fctx, fingerDown, frame, gagClock,
  INDEX_MCP, KAME_PUSH, lerpPt, makeScratch, MIDDLE_MCP, PINKY_MCP, playSound,
  POP_S, rayToEdge, RING_MCP, shakeScreen, sizeScratch, stepSparks,
  trackedHands, unit, WRIST } from "../api.js";

const PUNCH_SPEED = 5;           // palm lengths / s that launch a loaded fist
const LOAD_S = 0.12;             // a fist must be held this long first
const REACH = 0.85;              // of the way to the screen edge
const OUT_K = 260, OUT_DAMP = 18;    // out: stiff, a little overshoot
const BACK_K = 120, BACK_DAMP = 7;   // back: looser, so it wobbles
const HOLD_S = 0.16;             // at full stretch before it snaps back
const BACK_MAX_S = 0.9;
const COOLDOWN_S = 0.15;
const LOST_FRAMES = 6;           // tracker frames a fist may drop out for
const GATLING_N = 3;             // punches within GATLING_S make a Gatling
const GATLING_S = 1.2;

const arms = new Map();          // hand key -> arm
const recent = [];               // launch times, for the Gatling

function isFist(w, latched) {
  return fingerDown(w, INDEX_MCP, latched) && fingerDown(w, MIDDLE_MCP, latched) &&
         fingerDown(w, RING_MCP, latched) && fingerDown(w, PINKY_MCP, latched);
}

function armFor(key) {
  let a = arms.get(key);
  if (!a) {
    a = { key, fist: false, lost: 0, heldSince: -1, seen: false, x: 0, y: 0, wx: 0, wy: 0,
          palm: 1, hist: [], phase: "idle", t: 0, ext: 0, v: 0, reach: 0, dx: 1, dy: 0,
          atCam: false, cool: 0, skin: DEMO_SKIN, cartoon: false, words: "PISTOL!",
          patch: makeScratch(false), sample: makeScratch(true) };
    arms.set(key, a);
  }
  return a;
}

// One fist this frame: centre and wrist in canvas px, palm length in px.
function feed(key, f, now) {
  const a = armFor(key);
  if (!f) {
    if (++a.lost > LOST_FRAMES) { a.fist = false; a.heldSince = -1; a.hist.length = 0; }
    return;
  }
  a.lost = 0;
  a.seen = true;
  a.cartoon = false;
  a.x = f.x; a.y = f.y; a.wx = f.wx; a.wy = f.wy; a.palm = f.palm;
  if (!f.fist) { a.fist = false; a.heldSince = -1; a.hist.length = 0; return; }
  if (!a.fist) { a.fist = true; a.heldSince = now; }

  // The punch: over the last fifth of a second, fast across the screen, or
  // a fast growth, which is a punch at the camera.
  const h = a.hist;
  h.push({ t: now, x: f.x, y: f.y, palm: f.palm });
  while (h.length && now - h[0].t > 0.2) h.shift();
  if (a.phase !== "idle" || a.cool > 0 || now - a.heldSince < LOAD_S || h.length < 3) return;
  const h0 = h[0], span = now - h0.t;
  if (span < 0.05) return;
  const vx = (f.x - h0.x) / span / f.palm, vy = (f.y - h0.y) / span / f.palm;
  const grow = (f.palm / h0.palm - 1) / span;
  if (grow > KAME_PUSH * 1.5) launch(a, null, now);
  else if (Math.hypot(vx, vy) > PUNCH_SPEED) launch(a, Math.atan2(vy, vx), now);
}

function updateArms(res, t) {
  const seen = new Set();
  for (const h of trackedHands(res, t)) {
    const a = armFor(h.key);
    const p = h.pts;
    const knuckles = lerpPt(p[INDEX_MCP], p[PINKY_MCP], 0.5);
    const c = lerpPt(lerpPt(p[WRIST], knuckles, 0.5), knuckles, 0.5);
    feed(h.key, { x: c.x, y: c.y, wx: p[WRIST].x, wy: p[WRIST].y,
                  palm: dist(p[WRIST], p[MIDDLE_MCP]), fist: isFist(h.w, a.fist) }, t / 1000);
    seen.add(h.key);
  }
  for (const key of arms.keys()) if (!seen.has(key)) feed(key, null, t / 1000);
}

// `ang` null means straight at the camera.
function launch(a, ang, now) {
  a.phase = "out";
  a.t = 0;
  a.ext = 0;
  a.v = 0;
  a.atCam = ang === null;
  if (a.atCam) {
    a.reach = 1;                 // a.ext then runs 0..1: how far it has come at you
  } else {
    a.dx = Math.cos(ang);
    a.dy = Math.sin(ang);
    a.reach = Math.max(a.palm * 3, rayToEdge(a.x, a.y, a.dx, a.dy) * REACH);
  }
  a.hist.length = 0;
  a.skin = a.cartoon ? DEMO_SKIN : skinAt(a);
  while (recent.length && now - recent[0] > GATLING_S) recent.shift();
  recent.push(now);
  a.words = a.atCam ? "BAZOOKA!" : recent.length >= GATLING_N ? "GATLING!" : "PISTOL!";
  if (recent.length === 1) {
    comicPops.push({ x: a.x, y: a.y - a.palm * 1.4, word: "GOMU GOMU NO…", size: a.palm * 0.32,
                     rot: -0.08, age: 0 });
  }
  playSound("stretch", { pan: a.x, duration: 0.22 });
}

// The arm's colour: the average of the skin around the real fist.
function skinAt(a) {
  const g = sizeScratch(a.sample, 1, 1);
  const r = a.palm * 0.35;
  g.drawImage(frame, a.x - r, a.y - r, r * 2, r * 2, 0, 0, 1, 1);
  const [R, G, B] = g.getImageData(0, 0, 1, 1).data;
  return `rgb(${R},${G},${B})`;
}

function landed(a) {
  const W = canvas.width, H = canvas.height;
  const f = fistAt(a);
  const big = a.atCam;
  comicPops.push({ x: f.x, y: f.y - f.r * (big ? 0.2 : 1.3), word: a.words,
                   size: big ? H * 0.12 : a.palm * 0.45, rot: (a.dx < 0 ? 0.12 : -0.12), age: 0 });
  for (let i = 0; i < (big ? 40 : 18); i++) {
    addSpark(f.x, f.y, Math.PI * 2 * i / (big ? 40 : 18), H * (0.25 + 0.2 * (i % 3)),
             0.18 + 0.05 * (i % 4), 0, i % 2 ? "#ffffff" : "#ffd27a");
  }
  shakeScreen(big ? H * 0.035 : a.palm * 0.12);
  playSound(big ? "boom" : "thud", { pan: big ? W / 2 : f.x, duration: 0.8 });
}

// Where the flying fist is, and how big.
function fistAt(a) {
  const r = a.palm * 0.85;
  if (!a.atCam) return { x: a.x + a.dx * a.ext, y: a.y + a.dy * a.ext, r };
  const e = clamp01(a.ext);
  const c = { x: canvas.width / 2, y: canvas.height / 2 };
  return { x: a.x + (c.x - a.x) * e * 0.6, y: a.y + (c.y - a.y) * e * 0.6, r: r * (1 + 4.5 * e * e) };
}

function step(a, dt) {
  a.cool = Math.max(0, a.cool - dt);
  if (a.phase === "idle") return;
  a.t += dt;
  const out = a.phase !== "back";
  const target = out ? a.reach : 0;
  const k = out ? OUT_K : BACK_K, damp = out ? OUT_DAMP : BACK_DAMP;
  a.v += (k * (target - a.ext) - damp * a.v) * dt;
  a.ext += a.v * dt;
  if (a.phase === "out" && a.ext >= a.reach * 0.96) {
    a.phase = "hold";
    a.t = 0;
    landed(a);
  } else if (a.phase === "out" && a.t > 0.6) {
    a.phase = "hold";            // never quite got there: let it go anyway
    a.t = 0;
  } else if (a.phase === "hold" && a.t >= HOLD_S) {
    a.phase = "back";
    a.t = 0;
    playSound("boing", { pan: fistAt(a).x });
  } else if (a.phase === "back" && (a.t > BACK_MAX_S ||
             (a.t > 0.3 && Math.abs(a.ext) < a.reach * 0.03 && Math.abs(a.v) < a.reach * 0.5))) {
    a.phase = "idle";
    a.ext = 0;
    a.cool = COOLDOWN_S;
  }
}

// A cartoon fist, knuckles forward: the stand-in when there is no camera.
function paintFist(g, x, y, R, skin) {
  g.save();
  g.fillStyle = skin;
  g.beginPath();
  g.ellipse(x, y, R * 0.72, R * 0.6, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(70,35,15,0.5)";
  g.lineWidth = Math.max(1, R * 0.06);
  g.lineCap = "round";
  for (let i = 0; i < 4; i++) {
    const kx = x - R * 0.45 + i * R * 0.3;
    g.beginPath();
    g.arc(kx, y - R * 0.2, R * 0.14, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
    if (i < 3) {
      g.beginPath();
      g.moveTo(kx + R * 0.15, y - R * 0.12);
      g.lineTo(kx + R * 0.15, y + R * 0.12);
      g.stroke();
    }
  }
  g.beginPath();                 // the thumb, folded across the front
  g.moveTo(x - R * 0.55, y + R * 0.32);
  g.quadraticCurveTo(x - R * 0.1, y + R * 0.12, x + R * 0.28, y + R * 0.3);
  g.stroke();
  g.restore();
}

// Your fist, cut out of the camera frame with a soft edge.
function cutFist(a) {
  const R = Math.max(4, Math.round(a.palm * 0.95));
  const g = sizeScratch(a.patch, R * 2, R * 2);
  g.globalCompositeOperation = "copy";
  if (a.cartoon) {
    g.clearRect(0, 0, R * 2, R * 2);
    g.globalCompositeOperation = "source-over";
    paintFist(g, R, R, R * 0.95, a.skin);
    return R;
  }
  g.drawImage(frame, a.x - R, a.y - R, R * 2, R * 2, 0, 0, R * 2, R * 2);
  g.globalCompositeOperation = "destination-in";
  const fade = g.createRadialGradient(R, R, R * 0.55, R, R, R);
  fade.addColorStop(0, "#000");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade;
  g.fillRect(0, 0, R * 2, R * 2);
  g.globalCompositeOperation = "source-over";
  return R;
}

// The arm: from just behind your real fist (covering it) out to the flying
// one, sagging a little under its own weight and thinning as it stretches.
// On the way back it wobbles with its own speed.
function drawArm(a, f, t) {
  const u = unit();
  let fx = a.x - a.wx, fy = a.y - a.wy;
  const fl = Math.hypot(fx, fy) || 1;
  fx /= fl; fy /= fl;
  const p0 = { x: a.x - fx * a.palm * 0.35, y: a.y - fy * a.palm * 0.35 };
  const len = dist(p0, f);
  if (len < a.palm * 0.6) return;
  const ax = (f.x - p0.x) / len, ay = (f.y - p0.y) / len;
  const nx = -ay, ny = ax;
  const stretch = clamp01(len / (a.palm * 6));
  const sag = a.atCam ? 0 : len * 0.06;
  // Capped by the length, or a short arm's sides would cross into fins.
  const wobble = a.phase === "back"
    ? Math.min(clamp01(Math.abs(a.v) / (a.reach * 4 || 1)) * a.palm * 0.7, len * 0.08) : 0;
  const wBase = a.palm * 0.68;
  const wTip = a.atCam ? f.r * 0.6 : a.palm * 0.42;
  const N = 24, left = [], right = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const bulge = Math.sin(s * Math.PI);
    const off = bulge * Math.sin(s * 9 - t * 0.04) * wobble;
    const x = p0.x + (f.x - p0.x) * s + nx * off;
    const y = p0.y + (f.y - p0.y) * s + ny * off + bulge * sag;
    const w = (wBase + (wTip - wBase) * s) * (1 - 0.5 * bulge * stretch);
    left.push({ x: x + nx * w, y: y + ny * w });
    right.push({ x: x - nx * w, y: y - ny * w });
  }
  ctx.save();
  // Rounded at both ends: the base swallows your real fist, the tip tucks
  // under the flying one.
  const a0 = Math.atan2(ny, nx);
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  ctx.arc((left[N].x + right[N].x) / 2, (left[N].y + right[N].y) / 2, dist(left[N], right[N]) / 2, a0, a0 - Math.PI, true);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.arc(p0.x, p0.y, wBase, a0 + Math.PI, a0, true);
  ctx.closePath();
  ctx.fillStyle = a.skin;
  ctx.fill();
  // Shade the underside, light the top, so it reads as a tube.
  const mid = N >> 1;
  const shade = ctx.createLinearGradient(left[mid].x, left[mid].y, right[mid].x, right[mid].y);
  shade.addColorStop(0, "rgba(255,255,255,0.18)");
  shade.addColorStop(0.45, "rgba(255,255,255,0)");
  shade.addColorStop(1, "rgba(40,15,5,0.35)");
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(40,20,10,0.45)";
  ctx.stroke();
  ctx.restore();
}

function drawSpeedLines(a, f) {
  const speed = clamp01(Math.abs(a.v) / (a.reach * 6 || 1));
  if (speed < 0.05 || a.atCam) return;
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${0.6 * speed})`;
  ctx.lineWidth = 2 * unit();
  for (let i = -2; i <= 2; i++) {
    const ox = -a.dy * i * f.r * 0.45, oy = a.dx * i * f.r * 0.45;
    const l = f.r * (1.5 + (i & 1)) * (0.5 + speed);
    ctx.beginPath();
    ctx.moveTo(f.x + ox - a.dx * f.r * 1.1, f.y + oy - a.dy * f.r * 1.1);
    ctx.lineTo(f.x + ox - a.dx * (f.r * 1.1 + l), f.y + oy - a.dy * (f.r * 1.1 + l));
    ctx.stroke();
  }
  ctx.restore();
}

function render(t) {
  const dt = gagClock(t);
  for (const a of arms.values()) {
    step(a, dt);
    if (a.phase === "idle") continue;
    const f = fistAt(a);
    const R = cutFist(a);
    drawArm(a, f, t);
    drawSpeedLines(a, f);
    const s = f.r / (a.palm * 0.85);
    ctx.drawImage(a.patch.c, f.x - R * s, f.y - R * s, R * 2 * s, R * 2 * s);
  }
  stepSparks(dt);
  drawSparks();
  ageOut(comicPops, dt, POP_S);
  drawPops();
}

function reset() {
  arms.clear();
  recent.length = 0;
  comicPops.length = 0;
}

// `f`: every fist up punches toward the middle; with none, a cartoon arm
// does it from the bottom right.
function trigger() {
  const now = performance.now() / 1000;
  const W = canvas.width, H = canvas.height;
  let any = false;
  for (const a of arms.values()) {
    if (!a.seen || a.lost > LOST_FRAMES || a.phase !== "idle") continue;
    launch(a, Math.atan2(H / 2 - a.y, W / 2 - a.x), now);
    any = true;
  }
  if (any) return;
  const a = armFor("trigger");
  if (a.phase !== "idle") return;
  Object.assign(a, { cartoon: true, x: W * 0.84, y: H * 0.86, wx: W * 0.92, wy: H * 1.02, palm: H * 0.09 });
  launch(a, Math.atan2(H * 0.45 - a.y, W * 0.35 - a.x), now);
}

// A fist on the right that winds back and jabs left every three seconds,
// and every other time punches at the camera instead.
function demo(t) {
  const W = frame.width, H = frame.height, m = H / 0.55;
  const c = t % 3000, n = Math.floor(t / 3000);
  const atCam = n % 2 === 1;
  const wind = Math.sin(Math.PI * clamp01((c - 600) / 900)) * 0.04;
  const jab = clamp01((c - 1500) / 110);
  const palm = m * 0.095 * (atCam ? 1 + jab * 0.5 : 1);
  const x = W * (0.72 + wind - (atCam ? 0 : jab * 0.12)), y = H * 0.6;
  paintFist(fctx, x, y, palm * 0.8, DEMO_SKIN);
  feed("demo", { x, y, wx: x + palm * 0.6, wy: y + palm * 0.7, palm, fist: c > 300 }, t / 1000);
}

export default defineEffect({
  id: "rubber-arm",
  name: "Rubber Arm",
  kind: "overlay",
  hint: "✊ Make a fist and punch — your arm stretches like rubber. Punch at the camera for a big one",
  hands: updateArms,
  demo,
  render,
  reset,
  trigger,
});
