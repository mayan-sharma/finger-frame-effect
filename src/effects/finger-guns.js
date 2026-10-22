// Finger Guns — 👉 thumb up, drop the thumb (or flick the wrist) to fire

import { addSpark, ageOut, canvas, clamp01, comicPops, ctx, defineEffect,
  demoBlob, dist, drawPops, drawSmoke, drawSparks, emitSmoke, fingerDown,
  fingerUp, frame, gagClock, INDEX_MCP, INDEX_TIP, MIDDLE_MCP, PINKY_MCP,
  POP_S, rayToEdge, RING_MCP, shakeScreen, smoothstep, spill, stepSmoke,
  stepSparks, THUMB_TIP, trackedHands, unit, WRIST } from "../api.js";

// Finger Guns: index out, the rest curled, thumb cocked up. Dropping the
// thumb onto the hand fires (its reach to the index's first bone falls
// through GUN_HAMMER), and so does the recoil flick: the fingertip jerking up
// off its knuckle faster than GUN_FLICK palm lengths a second.
const GUN_COCK = 0.42, GUN_HAMMER = 0.28;
const GUN_FLICK = 4.5;
const GUN_COOLDOWN_S = 0.18;
const GUN_FLASH_S = 0.09;
const GUN_TRACER_S = 0.12;
const GUN_HOLE_S = 5;            // bullet holes stay in the glass this long
const GUN_HOLES_MAX = 14;
const GUN_CASING_S = 1.1;
const GUN_WORDS = ["BANG!", "PEW!", "POW!"];

const guns = new Map();          // hand key -> gun
const gunFx = { tracers: [], holes: [], casings: [] };

// Index out, the other three curled. The thumb is the hammer, so it is read
// on its own rather than as part of the pose.
function isGunPose(w, latched) {
  return fingerUp(w, INDEX_MCP, latched) && fingerDown(w, MIDDLE_MCP, latched) &&
         fingerDown(w, RING_MCP, latched) && fingerDown(w, PINKY_MCP, latched);
}

// Thumb tip to the index finger's first bone, in palm lengths: high with the
// thumb cocked up, low with it dropped against the side of the hand.
function hammerReach(w, palm) {
  const a = w[INDEX_MCP], b = w[INDEX_MCP + 1], p = w[THUMB_TIP];
  const az = a.z || 0, vx = b.x - a.x, vy = b.y - a.y, vz = (b.z || 0) - az;
  const k = clamp01(((p.x - a.x) * vx + (p.y - a.y) * vy + ((p.z || 0) - az) * vz) /
                    (vx * vx + vy * vy + vz * vz || 1));
  return Math.hypot(p.x - a.x - vx * k, p.y - a.y - vy * k, (p.z || 0) - az - vz * k) / palm;
}

function updateGuns(res, t) {
  const now = t / 1000;
  const live = new Set();
  for (const h of trackedHands(res, t)) {
    let g = guns.get(h.key);
    if (!isGunPose(h.w, !!(g && g.on))) continue;
    if (!g) {
      g = { on: false, cocked: false, last: -1, lift: null, liftT: 0,
            x: 0, y: 0, ang: 0, scale: 1, atCam: false, flash: 0, smoke: 0, smokeAcc: 0 };
      guns.set(h.key, g);
    }
    live.add(h.key);
    const p = h.pts;
    g.on = true;
    g.scale = h.scale;
    g.x = p[INDEX_TIP].x;
    g.y = p[INDEX_TIP].y;
    // Aimed at the camera the finger foreshortens to a stub and its 2D angle
    // is noise, so that shot goes into the glass right at the muzzle.
    const bx = p[INDEX_TIP].x - p[INDEX_MCP].x, by = p[INDEX_TIP].y - p[INDEX_MCP].y;
    g.atCam = Math.hypot(bx, by) < h.scale * 0.03;
    if (!g.atCam) g.ang = Math.atan2(by, bx);

    let fire = false;
    // Trigger one: the thumb drops onto the hand.
    const reach = hammerReach(h.w, h.palm);
    if (reach > GUN_COCK) g.cocked = true;
    else if (g.cocked && reach < GUN_HAMMER) { g.cocked = false; fire = true; }
    // Trigger two: the recoil flick, the fingertip jerking up off its knuckle.
    const palmPx = dist(p[WRIST], p[MIDDLE_MCP]) || 1;
    const lift = (p[INDEX_MCP].y - p[INDEX_TIP].y) / palmPx;
    if (g.lift !== null && (lift - g.lift) / Math.max(1e-3, now - g.liftT) > GUN_FLICK) fire = true;
    g.lift = lift;
    g.liftT = now;

    if (fire && now - g.last > GUN_COOLDOWN_S) {
      g.last = now;
      fireGun(g);
    }
  }
  for (const [k, g] of guns) {
    if (!live.has(k)) { g.on = false; g.lift = null; g.cocked = false; }
  }
}

function fireGun(g) {
  const dx = Math.cos(g.ang), dy = Math.sin(g.ang);
  const s = g.scale;
  const mx = g.x + (g.atCam ? 0 : dx * s * 0.012), my = g.y + (g.atCam ? 0 : dy * s * 0.012);
  g.flash = GUN_FLASH_S;
  g.smoke = 1;
  if (g.atCam) {
    // Straight at the viewer: the round stars the glass over the muzzle.
    gunFx.holes.push(makeBulletHole(mx, my, s * 1.6));
  } else {
    const reach = rayToEdge(mx, my, dx, dy);
    gunFx.tracers.push({ x: mx, y: my, dx, dy, len: reach, w: s * 0.004, age: 0 });
    // The round hits the glass somewhere down the line.
    if (reach > s * 0.06) {
      const k = reach * (0.45 + Math.random() * 0.4);
      gunFx.holes.push(makeBulletHole(mx + dx * k, my + dy * k, s));
    }
  }
  while (gunFx.holes.length > GUN_HOLES_MAX) gunFx.holes.shift();
  comicPops.push({
    x: mx - dy * s * 0.04 * (dx < 0 ? -1 : 1), y: my - s * 0.045,
    word: GUN_WORDS[(Math.random() * GUN_WORDS.length) | 0],
    size: s * 0.045, rot: (Math.random() - 0.5) * 0.5, age: 0,
  });
  for (let i = 0; i < 12; i++) {
    const a = g.atCam ? Math.random() * Math.PI * 2 : g.ang + (Math.random() - 0.5) * 0.9;
    addSpark(mx, my, a, s * (0.4 + Math.random() * 0.8), 0.08 + Math.random() * 0.14,
             s * 0.5, "#ffd27a");
  }
  shakeScreen(s * 0.006);
  // A brass casing kicked out of the top of the hand, back over the knuckles.
  if (!g.atCam) {
    const up = dx < 0 ? 1 : -1;               // whichever perpendicular points up
    const px = -dy * up, py = dx * up;
    gunFx.casings.push({
      x: g.x - dx * s * 0.07, y: g.y - dy * s * 0.07,
      vx: (px * 0.9 - dx * 0.5) * s * (0.5 + Math.random() * 0.3),
      vy: (py * 0.9 - dy * 0.5) * s * (0.5 + Math.random() * 0.3) - s * 0.25,
      rot: g.ang, spin: (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 10),
      s, age: 0,
    });
    while (gunFx.casings.length > 12) gunFx.casings.shift();
  }
}

function stepCasings(dt) {
  for (const c of gunFx.casings) {
    c.age += dt;
    c.vy += c.s * 2.4 * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.spin * dt;
  }
  ageOut(gunFx.casings, 0, GUN_CASING_S);
}

function drawCasings() {
  for (const c of gunFx.casings) {
    const L = c.s * 0.016, W = c.s * 0.0065;
    ctx.save();
    ctx.globalAlpha = 1 - smoothstep(GUN_CASING_S - 0.3, GUN_CASING_S, c.age);
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    const g = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
    g.addColorStop(0, "#fff2b8");
    g.addColorStop(0.35, "#e0a83a");
    g.addColorStop(1, "#7a4f10");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.3);
    ctx.fill();
    ctx.fillStyle = "#3a2508";
    ctx.fillRect(-L / 2, -W / 2, L * 0.12, W);
    ctx.restore();
  }
}

// A star in the glass: a dark core, a chipped rim and jagged radial cracks
// joined here and there by a ring of short cross-cracks.
function makeBulletHole(x, y, s) {
  const R = Math.max(canvas.height * 0.008, s * 0.006);
  const n = 7 + ((Math.random() * 5) | 0);
  const cracks = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const len = R * (3 + Math.random() * 5);
    const pts = [];
    let a = a0;
    for (let k = 0; k <= 4; k++) {
      const r = R * 0.9 + (len - R * 0.9) * (k / 4);
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      a += (Math.random() - 0.5) * 0.35;
    }
    cracks.push(pts);
  }
  const ring = [];
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.35) continue;
    const j = (i + 1) % n, k = 1 + ((Math.random() * 2) | 0);
    ring.push([cracks[i][k], cracks[j][k]]);
  }
  return { x, y, R, cracks, ring, age: 0, rot: Math.random() * Math.PI };
}

function drawBulletHoles() {
  const u = unit();
  for (const h of gunFx.holes) {
    const a = 1 - smoothstep(GUN_HOLE_S - 1, GUN_HOLE_S, h.age);
    if (a <= 0) continue;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    ctx.globalAlpha = a;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Each crack twice: a dark line under a bright one, so it reads on both
    // a light wall and a dark shirt.
    for (const [style, lw, off] of [["rgba(0,0,0,0.45)", 2.4 * u, u], ["rgba(255,255,255,0.85)", 1.1 * u, 0]]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const c of h.cracks) {
        ctx.moveTo(c[0].x + off, c[0].y + off);
        for (let k = 1; k < c.length; k++) ctx.lineTo(c[k].x + off, c[k].y + off);
      }
      for (const [p, q] of h.ring) {
        ctx.moveTo(p.x + off, p.y + off);
        ctx.lineTo(q.x + off, q.y + off);
      }
      ctx.stroke();
    }
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, h.R * 1.25);
    core.addColorStop(0, "rgba(5,5,8,0.95)");
    core.addColorStop(0.65, "rgba(30,30,36,0.85)");
    core.addColorStop(1, "rgba(220,225,235,0.55)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, h.R * 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function emitGunSmoke(g) {
  const s = g.scale;
  emitSmoke({
    x: g.x + (Math.random() - 0.5) * s * 0.006, y: g.y + (Math.random() - 0.5) * s * 0.006,
    vx: Math.cos(g.ang) * s * 0.04 + (Math.random() - 0.5) * s * 0.02, vy: -s * (0.04 + Math.random() * 0.04),
    r0: s * 0.004, r1: s * (0.018 + Math.random() * 0.016), grow: 1.1, fine: true,
    life: 1.3 + Math.random() * 0.9, alpha: 0.22 + Math.random() * 0.1,
    rise: s * 0.13, drag: 0.8, turb: s * 0.12,
  });
}

function drawMuzzleFlash(g, t) {
  const k = g.flash / GUN_FLASH_S;
  const s = g.scale, L = s * (g.atCam ? 0.05 : 0.07) * (0.7 + 0.3 * k), W = s * 0.03;
  spill(g.x, g.y, s * 0.45, "255,190,110", 0.5 * k);
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(g.atCam ? t * 0.01 : g.ang);
  ctx.globalCompositeOperation = "lighter";
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, L * 1.4);
  glow.addColorStop(0, `rgba(255,230,160,${0.7 * k})`);
  glow.addColorStop(1, "rgba(255,120,20,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-L * 1.4, -L * 1.4, L * 2.8, L * 2.8);
  // A spiky star stretched out along the barrel.
  for (const [sc, col] of [[1, "rgba(255,150,40,0.9)"], [0.55, "rgba(255,250,220,1)"]]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = (i % 2 ? 0.25 : 1) * sc;
      const stretch = g.atCam ? 1 : 0.35 + 0.65 * Math.max(0, Math.cos(a));
      ctx.lineTo(Math.cos(a) * L * r * stretch, Math.sin(a) * W * r * (g.atCam ? L / W : 1));
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawTracers() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const tr of gunFx.tracers) {
    const k = tr.age / GUN_TRACER_S;
    const head = Math.min(1, k * 1.6) * tr.len, tail = Math.max(0, k * 1.6 - 0.45) * tr.len;
    if (head <= tail) continue;
    const grad = ctx.createLinearGradient(tr.x + tr.dx * tail, tr.y + tr.dy * tail,
                                          tr.x + tr.dx * head, tr.y + tr.dy * head);
    grad.addColorStop(0, "rgba(255,200,90,0)");
    grad.addColorStop(1, "rgba(255,250,220,0.95)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2, tr.w);
    ctx.beginPath();
    ctx.moveTo(tr.x + tr.dx * tail, tr.y + tr.dy * tail);
    ctx.lineTo(tr.x + tr.dx * head, tr.y + tr.dy * head);
    ctx.stroke();
  }
  ctx.restore();
}

function renderGuns(t) {
  const dt = gagClock(t);
  for (const g of guns.values()) {
    g.flash = Math.max(0, g.flash - dt);
    if (g.smoke > 0) {
      g.smokeAcc += 55 * g.smoke * dt;
      while (g.smokeAcc >= 1) { g.smokeAcc--; emitGunSmoke(g); }
      g.smoke = Math.max(0, g.smoke - dt * 0.8);
    }
  }
  ageOut(gunFx.tracers, dt, GUN_TRACER_S);
  ageOut(gunFx.holes, dt, GUN_HOLE_S);
  ageOut(comicPops, dt, POP_S);
  stepCasings(dt);
  stepSparks(dt);
  stepSmoke(dt, t / 1000);

  drawBulletHoles();
  drawSmoke();
  drawCasings();
  drawTracers();
  for (const g of guns.values()) if (g.flash > 0) drawMuzzleFlash(g, t);
  drawSparks();
  drawPops();
}

function resetGuns() {
  guns.clear();
  gunFx.tracers.length = 0;
  gunFx.holes.length = 0;
  comicPops.length = 0;
  gunFx.casings.length = 0;
}

// `f`: every gun in view fires; with none up, one off-screen right takes a shot.
function triggerGuns() {
  let any = false;
  for (const g of guns.values()) if (g.on) { fireGun(g); any = true; }
  if (any) return;
  const s = canvas.height / 0.55;
  fireGun({ x: canvas.width * 0.85, y: canvas.height * 0.7, ang: Math.PI * 1.08, scale: s,
            atCam: false, flash: 0, smoke: 0, smokeAcc: 0 });
}

// A finger gun on the right, swinging its aim and firing every 1.4 s.
function demoGuns(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const ang = Math.PI + 0.25 * Math.sin(t * 0.0007) - 0.15;
  const hx = w * 0.72, hy = h * 0.62;
  demoBlob(hx, hy, m, ang, [[ang, 0.11], [ang - Math.PI / 2.4, 0.06]]);
  let g = guns.get("demo");
  if (!g) {
    g = { on: true, cocked: false, last: -1, lift: null, liftT: 0, x: 0, y: 0, ang: 0,
          scale: m, atCam: false, flash: 0, smoke: 0, smokeAcc: 0 };
    guns.set("demo", g);
  }
  g.x = hx + Math.cos(ang) * m * 0.11;
  g.y = hy + Math.sin(ang) * m * 0.11;
  g.ang = ang;
  const shot = Math.floor(t / 1400);
  if (shot !== g.demoShot) { g.demoShot = shot; if (t > 500) fireGun(g); }
}

export default defineEffect({
  id: "finger-guns",
  name: "Finger Guns",
  kind: "overlay",
  hint: "👉 Finger gun, thumb up — drop the thumb to fire",
  hands: updateGuns,
  demo: demoGuns,
  render: renderGuns,
  reset: resetGuns,
  trigger: triggerGuns,
});
