// Spirit Bomb — 元気玉
//
// Both open hands raised high: the light drains out of the room into a
// sphere gathering above them, in streams from every corner, until the
// screen is dark but for it. Throw your hands down (or shove at the camera)
// and it comes crashing toward you in a blinding impact, and the light
// floods back. Lower your hands slowly instead and it fizzles.

import { canvas, clamp01, ctx, defineEffect, demoBlob, dist, frame, gagClock,
  jpFont, KAME_PUSH, latinFont, MIDDLE_MCP, openCount, palmCentre,
  shakeScreen, smoothstep, spill, titleCardAt, trackedHands, unit, WRIST } from "../api.js";

// Spirit Bomb: both open hands with palm centres above BOMB_RAISE of the
// screen height charge it. After BOMB_MIN_S, hands thrown down faster than
// BOMB_THROW palm lengths a second (or a shove at the camera) throw it.
const BOMB_RAISE = 0.55;
const BOMB_FULL_S = 4;
const BOMB_MIN_S = 1;
const BOMB_THROW = 2.2;
const BOMB_MAX_R = 0.2;          // of screen height, at full charge
const BOMB_FLY_S = 0.55;

const bomb = { up: false, forced: false, lost: 0, charge: 0, hx: 0, hy: 0, palm: 1, x: 0, y: 0, r: 0,
               hist: [], motes: [], acc: 0, shot: null, title: 99 };

function updateBomb(res, t) {
  const hands = trackedHands(res, t);
  let m = null;
  if (hands.length >= 2) {
    const [a, b] = hands;
    if (openCount(a.w) >= 3 && openCount(b.w) >= 3) {
      m = { a: palmCentre(a.pts), b: palmCentre(b.pts),
            palm: (dist(a.pts[WRIST], a.pts[MIDDLE_MCP]) + dist(b.pts[WRIST], b.pts[MIDDLE_MCP])) / 2 };
    }
  }
  bombTrack(m, t);
}

// Both palm centres and the palm length in pixels, or null.
function bombTrack(m, t) {
  const now = t / 1000, H = canvas.height;
  if (!m) {
    if (++bomb.lost > 8) { bomb.up = false; bomb.hist.length = 0; }
    return;
  }
  const x = (m.a.x + m.b.x) / 2, y = Math.min(m.a.y, m.b.y);
  bomb.hx = x;
  bomb.hy = y;
  bomb.palm = m.palm;
  // The throw: over the last quarter second the hands came down fast, or
  // grew fast (a shove at the camera). Checked before "still raised", since
  // a throw is exactly the hands leaving the top of the screen.
  const hist = bomb.hist;
  hist.push({ t: now, y, palm: m.palm });
  while (hist.length && now - hist[0].t > 0.25) hist.shift();
  if (bomb.charge >= BOMB_MIN_S && !bomb.shot && hist.length >= 3) {
    const h0 = hist[0], span = now - h0.t;
    if (span > 0.06 && ((y - h0.y) / span / m.palm > BOMB_THROW || (m.palm / h0.palm - 1) / span > KAME_PUSH)) {
      throwBomb();
    }
  }
  if (Math.max(m.a.y, m.b.y) < H * BOMB_RAISE) { bomb.up = true; bomb.lost = 0; }
  else if (++bomb.lost > 8) bomb.up = false;
}

function throwBomb() {
  bomb.forced = false;
  bomb.shot = { age: 0, x: bomb.x, y: bomb.y, r: bomb.r, power: clamp01(bomb.charge / BOMB_FULL_S) };
  bomb.charge = 0;
  bomb.hist.length = 0;
}

function renderBomb(t) {
  const dt = gagClock(t);
  const W = canvas.width, H = canvas.height;
  const s = bomb.shot, up = bomb.up || bomb.forced;
  if (up && !s) {
    if (bomb.charge === 0) bomb.title = 0;
    bomb.charge = Math.min(BOMB_FULL_S * 1.2, bomb.charge + dt);
  } else if (!s) {
    bomb.charge = Math.max(0, bomb.charge - dt * 2);   // lowered: it fizzles
  }
  bomb.title += dt;
  const k = clamp01(bomb.charge / BOMB_FULL_S);

  // How dark the room is: the charge, or after a throw, the light flooding
  // back in once the bomb has landed.
  let dark = k;
  if (s) {
    s.age += dt;
    dark = s.power * (1 - smoothstep(BOMB_FLY_S, BOMB_FLY_S + 1.2, s.age));
  }
  if (dark > 0.005) {
    ctx.fillStyle = `rgba(2,6,22,${0.66 * dark})`;
    ctx.fillRect(0, 0, W, H);
  }

  // The sphere rides above your hands, growing with the charge.
  const r = bomb.palm * 0.5 + H * BOMB_MAX_R * k;
  // Kept mostly on screen even with your hands near the top of the frame.
  const tx = bomb.hx, ty = Math.max(r * 0.8, bomb.hy - bomb.palm * 1.1 - r * 0.9);
  bomb.x = bomb.r ? bomb.x + (tx - bomb.x) * 0.3 : tx;
  bomb.y = bomb.r ? bomb.y + (ty - bomb.y) * 0.3 : ty;
  bomb.r = r;

  // Light streaming in from all over the room while it charges.
  if (up && !s) {
    bomb.acc += dt * (40 + 120 * k);
    while (bomb.acc >= 1 && bomb.motes.length < 500) {
      bomb.acc--;
      const edge = Math.random();
      const x0 = edge < 0.5 ? Math.random() * W : (Math.random() < 0.5 ? 0 : W);
      const y0 = edge < 0.5 ? (Math.random() < 0.7 ? H : Math.random() * H) : Math.random() * H;
      bomb.motes.push({ x: x0, y: y0, vx: 0, vy: 0, age: 0, swirl: (Math.random() - 0.5) * 2 });
    }
  }
  let n = 0;
  for (const p of bomb.motes) {
    p.age += dt;
    const dx = bomb.x - p.x, dy = bomb.y - p.y, d = Math.hypot(dx, dy) || 1;
    const acc = H * (1.5 + p.age * 4);
    p.vx += (dx / d * acc - dy / d * acc * 0.3 * p.swirl) * dt;
    p.vy += (dy / d * acc + dx / d * acc * 0.3 * p.swirl) * dt;
    p.vx *= Math.exp(-1.5 * dt);
    p.vy *= Math.exp(-1.5 * dt);
    p.px = p.x; p.py = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (d > bomb.r * 0.8 && p.age < 4 && !s) bomb.motes[n++] = p;
  }
  bomb.motes.length = n;
  if (n) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    // Motes of light with short tails, brightening as they near the sphere.
    ctx.lineWidth = Math.max(1.5, 2.4 * unit());
    for (const p of bomb.motes) {
      const near = clamp01(1 - Math.hypot(bomb.x - p.x, bomb.y - p.y) / (H * 0.8));
      ctx.strokeStyle = `rgba(185,225,255,${0.35 + 0.6 * near})`;
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (s) {
    // Thrown: it comes down at you, swelling, then hits.
    const f = clamp01(s.age / BOMB_FLY_S), e = f * f;
    const x = s.x + (W / 2 - s.x) * e, y = s.y + (H * 0.62 - s.y) * e;
    if (f < 1) drawBombSphere(x, y, s.r * (1 + 3.5 * e), t, 1);
    else {
      if (!s.hit) { s.hit = true; shakeScreen(H * 0.04 * (0.5 + s.power)); }
      const a = s.age - BOMB_FLY_S;
      ctx.fillStyle = `rgba(235,245,255,${Math.max(0, 1 - a / 0.9)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const rr = (a - i * 0.12) * Math.hypot(W, H) * 0.9;
        if (rr <= 0) continue;
        ctx.strokeStyle = `rgba(160,210,255,${Math.max(0, 0.6 - a * 0.5)})`;
        ctx.lineWidth = H * 0.02;
        ctx.beginPath();
        ctx.arc(W / 2, H * 0.62, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (s.age > BOMB_FLY_S + 1.6) bomb.shot = null;
  } else if (bomb.charge > 0.05) {
    drawBombSphere(bomb.x, bomb.y, bomb.r, t, Math.min(1, bomb.charge * 2));
  }

  const c = bomb.title, env = (a0, b0, c0, d0) => smoothstep(a0, b0, c) * (1 - smoothstep(c0, d0, c));
  if (!s && up) {
    titleCardAt("元気玉", W / 2, H * 0.86, H * 0.075, env(0.3, 0.6, 2.6, 3.2), H * 0.02, jpFont, "rgba(120,190,255,0.95)");
    titleCardAt("SPIRIT BOMB", W / 2, H * 0.925, H * 0.022, env(0.4, 0.7, 2.6, 3.2), H * 0.012, latinFont, "rgba(120,190,255,0.95)");
  }
}

// A ball of gathered light: a white core, pale blue body, a churning
// surface and a wide glow that lights the darkened room.
function drawBombSphere(x, y, r, t, k) {
  spill(x, y, r * 5, "150,200,255", 0.55 * k);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2.4);
  halo.addColorStop(0, `rgba(140,200,255,${0.55 * k})`);
  halo.addColorStop(1, "rgba(60,120,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
  const body = ctx.createRadialGradient(x - r * 0.2, y - r * 0.25, 0, x, y, r);
  body.addColorStop(0, `rgba(255,255,255,${k})`);
  body.addColorStop(0.5, `rgba(200,232,255,${0.95 * k})`);
  body.addColorStop(0.9, `rgba(110,175,255,${0.8 * k})`);
  body.addColorStop(1, "rgba(80,140,255,0)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${0.35 * k})`;
  ctx.lineWidth = Math.max(1, r * 0.03);
  for (let i = 0; i < 5; i++) {
    const a = t * 0.0013 * (i % 2 ? 1 : -1) + i * 1.3;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (0.55 + 0.08 * i), r * (0.25 + 0.06 * i), a, 0, Math.PI * 1.3);
    ctx.stroke();
  }
  ctx.restore();
}

function resetBomb() {
  bomb.up = false;
  bomb.forced = false;
  bomb.lost = 0;
  bomb.charge = 0;
  bomb.shot = null;
  bomb.motes.length = 0;
  bomb.hist.length = 0;
  bomb.r = 0;
}

// `f`: a full charge mid-screen, thrown on the second press.
function triggerBomb() {
  if (bomb.shot) return;
  if (bomb.charge >= BOMB_MIN_S) { throwBomb(); return; }
  bomb.hx = canvas.width / 2;
  bomb.hy = canvas.height * 0.45;
  bomb.palm = canvas.height * 0.15;
  bomb.charge = BOMB_FULL_S;
  bomb.forced = true;
  bomb.title = 0;
}

// Both hands raised: it charges, is thrown down and lands, every 10 s.
function demoBomb(t) {
  const w = frame.width, h = frame.height, m = h / 0.55, palm = m * 0.095;
  const c = t % 10000;
  if (c < 400 || c > 6200) { bombTrack(null, t); return; }
  const drop = smoothstep(4600, 4750, c);
  const y = h * (0.28 + 0.45 * drop);
  const a = { x: w * 0.36, y }, b = { x: w * 0.5, y };
  for (const p of [a, b]) {
    demoBlob(p.x, p.y + palm * 0.4, m, 0, [[-1.85, 0.09], [-1.65, 0.1], [-1.45, 0.1], [-1.25, 0.09]]);
  }
  bombTrack({ a, b, palm }, t);
}

export default defineEffect({
  id: "spirit-bomb",
  name: "Spirit Bomb",
  kind: "overlay",
  hint: "🙌 Raise both open hands high to gather light — throw them down",
  hands: updateBomb,
  demo: demoBomb,
  render: renderBomb,
  reset: resetBomb,
  trigger: triggerBomb,
  // Throwing it is a fast downward hand: that must not read as a swipe.
  locksSwipe: () => bomb.up,
});
