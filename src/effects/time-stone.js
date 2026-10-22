// Time Stone — the Eye of Agamotto
//
// An open palm brings up the green mandala and stops time. Twist the hand
// like a dial: counter-clockwise rewinds the room, clockwise runs it
// forward again, and holding still holds the moment. You stay in the
// present (the person mask keeps you live) while the world behind you plays
// backwards. Drop the hand and time races forward to catch up with now.

import { canvas, clamp, ctx, defineEffect, demoBlob, dist, drawVoidPerson,
  frame, gagClock, hum, makeScratch, MIDDLE_MCP, openCount, palmCentre,
  playSound, sizeScratch, smoothstep, spill, trackedHands, unit, WRIST } from "../api.js";

// Time Stone: an open palm (three or more fingers up) stops time; twisting
// it moves time by TIME_GAIN seconds per radian, through a TIME_SPAN_S ring
// of TIME_W-wide frames captured at TIME_FPS. Let go and time runs at
// 1 + TIME_RETURN times real speed until it catches up.
const TIME_FPS = 20;
const TIME_SPAN_S = 6;
const TIME_W = 560;
const TIME_GAIN = 1.2;
const TIME_RETURN = 2;

const timeFx = { on: false, lost: 0, x: 0, y: 0, palm: 1, spin: 0, prevAng: null, prevT: 0,
                 target: Infinity, k: 0, head: 0, lastCap: -1 };
const timeBuf = [];              // ring of recent frames, each { s, t }

function updateTime(res, t) {
  let pose = null;
  for (const h of trackedHands(res, t)) {
    if (openCount(h.w) >= 3) {
      const p = h.pts, c = palmCentre(p);
      pose = { x: c.x, y: c.y, palm: dist(p[WRIST], p[MIDDLE_MCP]),
               ang: Math.atan2(p[MIDDLE_MCP].y - p[WRIST].y, p[MIDDLE_MCP].x - p[WRIST].x) };
      break;
    }
  }
  timeTrack(pose, t);
}

// The open hand this frame ({x, y, palm, ang}) or null.
function timeTrack(pose, t) {
  const now = t / 1000;
  if (!pose) {
    if (++timeFx.lost > 6) { timeFx.on = false; timeFx.prevAng = null; timeFx.spin = 0; }
    return;
  }
  if (!timeFx.on) {
    timeFx.target = now;   // the moment the spell starts, time stops
    playSound("shimmer", { pan: pose.x, pitch: 0.8 });
  }
  timeFx.on = true;
  timeFx.lost = 0;
  timeFx.x = pose.x;
  timeFx.y = pose.y;
  timeFx.palm = pose.palm;
  if (timeFx.prevAng !== null) {
    const d = pose.ang - timeFx.prevAng;
    const w = Math.atan2(Math.sin(d), Math.cos(d)) / Math.max(1e-3, now - timeFx.prevT);
    timeFx.spin += (w - timeFx.spin) * 0.5;
  }
  timeFx.prevAng = pose.ang;
  timeFx.prevT = now;
}

// The live feed, small, into a ring of timestamped slots.
function captureTime(now) {
  if (now - timeFx.lastCap < 1 / TIME_FPS) return;
  timeFx.lastCap = now;
  const n = Math.ceil(TIME_SPAN_S * TIME_FPS);
  timeFx.head = (timeFx.head + 1) % n;
  if (!timeBuf[timeFx.head]) timeBuf[timeFx.head] = { s: makeScratch(false), t: -1 };
  const slot = timeBuf[timeFx.head];
  const w = Math.min(TIME_W, canvas.width), h = Math.round(w * canvas.height / canvas.width);
  sizeScratch(slot.s, w, h).drawImage(frame, 0, 0, w, h);
  slot.t = now;
}

// The newest slot at or before `target`, and the one before that.
function timeSlotAt(target) {
  const n = Math.ceil(TIME_SPAN_S * TIME_FPS);
  let best = null, prev = null;
  for (let i = 0; i < n; i++) {
    const slot = timeBuf[(timeFx.head - i + n) % n];
    if (!slot || slot.t < 0) break;
    if (slot.t <= target) { best = slot; prev = timeBuf[(timeFx.head - i - 1 + n) % n] || null; break; }
    best = slot;
  }
  return { best, prev };
}

function oldestTime() {
  let oldest = timeFx.lastCap;
  for (const slot of timeBuf) if (slot && slot.t >= 0) oldest = Math.min(oldest, slot.t);
  return oldest;
}

// Concentric rune rings, turning against each other: the spell on the hand,
// and faintly behind the whole room while time is bent.
function drawMandala(x, y, R, rot, a) {
  if (a <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(110,255,160,${a})`;
  ctx.fillStyle = `rgba(150,255,190,${a})`;
  ctx.lineWidth = Math.max(1, R * 0.012);
  [1, 0.78, 0.55].forEach((f, i) => {
    const r = R * f;
    ctx.save();
    ctx.rotate(rot * (i % 2 ? -1 : 1) * (1 + i * 0.35));
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.moveTo(r * 0.9, 0);
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    const marks = 24 + i * 8;
    ctx.beginPath();
    for (let k = 0; k < marks; k++) {
      const ang = (k / marks) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      if (k % 3 === 0) {
        // A little rune: a bar and a hook between the two circles.
        ctx.moveTo(c * r * 0.91, s * r * 0.91);
        ctx.lineTo(c * r * 0.99, s * r * 0.99);
        const a2 = ang + 0.06;
        ctx.moveTo(Math.cos(a2) * r * 0.93, Math.sin(a2) * r * 0.93);
        ctx.arc(0, 0, r * 0.95, a2, a2 + 0.05);
      } else {
        ctx.moveTo(c * r * 0.94, s * r * 0.94);
        ctx.lineTo(c * r * 0.97, s * r * 0.97);
      }
    }
    ctx.stroke();
    // The innermost ring carries an eight-pointed star.
    if (i === 2) {
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const ang = (k * 3 / 8) * Math.PI * 2;
        ctx.lineTo(Math.cos(ang) * r * 0.88, Math.sin(ang) * r * 0.88);
      }
      ctx.stroke();
    }
    ctx.restore();
  });
  ctx.restore();
}

function renderTime(t) {
  const dt = gagClock(t);
  const now = t / 1000, W = canvas.width, H = canvas.height, u = unit();
  captureTime(now);

  // Where in time we are. The spin decays between tracker frames so a hand
  // that stops twisting stops time moving.
  timeFx.spin *= Math.exp(-6 * dt);
  if (timeFx.on) {
    timeFx.target += timeFx.spin * TIME_GAIN * dt;
  } else {
    timeFx.target += dt * (1 + TIME_RETURN);
  }
  timeFx.target = clamp(timeFx.target, oldestTime(), now);
  const behind = now - timeFx.target;
  const bent = timeFx.on || behind > 0.03;
  timeFx.k += ((bent ? 1 : 0) - timeFx.k) * 0.15;
  hum("rumble", Math.min(1, Math.abs(timeFx.spin) * 0.5) * timeFx.k);

  if (behind > 0.03) {
    const { best, prev } = timeSlotAt(timeFx.target);
    if (best) {
      ctx.drawImage(best.s.c, 0, 0, W, H);
      // A ghost of the neighbouring moment, so moving time smears.
      if (prev && Math.abs(timeFx.spin) > 0.2) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.drawImage(prev.s.c, 0, 0, W, H);
        ctx.restore();
      }
    }
  }
  if (timeFx.k > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = `rgba(60,255,140,${0.45 * timeFx.k})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    drawMandala(W / 2, H / 2, H * 0.62, -timeFx.target * 0.8, 0.12 * timeFx.k);
  }
  // You stay in the present, in front of the bent world.
  if (behind > 0.03) drawVoidPerson("#7dffb0");

  if (timeFx.on || timeFx.k > 0.05) {
    const R = timeFx.palm * 1.6, a = timeFx.k;
    spill(timeFx.x, timeFx.y, R * 2.2, "90,255,150", 0.35 * a);
    drawMandala(timeFx.x, timeFx.y, R, now * 0.8 + (now - timeFx.target) * 1.5, 0.85 * a);
    const eye = ctx.createRadialGradient(timeFx.x, timeFx.y, 0, timeFx.x, timeFx.y, R * 0.2);
    eye.addColorStop(0, `rgba(230,255,235,${a})`);
    eye.addColorStop(0.4, `rgba(80,255,140,${0.9 * a})`);
    eye.addColorStop(1, "rgba(0,200,90,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = eye;
    ctx.fillRect(timeFx.x - R * 0.2, timeFx.y - R * 0.2, R * 0.4, R * 0.4);
    ctx.restore();
  }

  // How far from now, and which way time is going.
  if (behind > 0.05 || timeFx.on) {
    const dir = !timeFx.on ? "▶▶" : timeFx.spin < -0.15 ? "◀◀" : timeFx.spin > 0.15 ? "▶" : "❚❚";
    ctx.save();
    ctx.font = `600 ${Math.round(H * 0.03)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(140,255,180,0.95)";
    ctx.shadowColor = "rgba(0,255,120,0.8)";
    ctx.shadowBlur = 12 * u;
    ctx.fillText(`${dir}  −${behind.toFixed(1)} s`, W - 24 * u, H * 0.09);
    ctx.restore();
  }
}

function resetTime() {
  timeFx.on = false;
  timeFx.lost = 0;
  timeFx.spin = 0;
  timeFx.prevAng = null;
  timeFx.k = 0;
  timeFx.target = Infinity;
  for (const slot of timeBuf) if (slot) slot.t = -1;
}

// `f`: rewinds three seconds, then lets time run back to now.
function triggerTime() {
  timeFx.target = Math.min(timeFx.target, timeFx.lastCap) - 3;
}

// An open hand that stops time, twists it back, holds, runs it forward a
// little and lets go, every 12 s.
function demoTime(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const c = t % 12000;
  if (c < 1500 || c > 8000) { timeTrack(null, t); return; }
  const twist = -2.6 * smoothstep(2000, 4500, c) + 1.0 * smoothstep(5500, 6500, c);
  const ang = -Math.PI / 2 + twist, x = w * 0.72, y = h * 0.55;
  demoBlob(x, y, m, ang + Math.PI / 2,
           [[ang - 0.35, 0.1], [ang - 0.12, 0.11], [ang + 0.12, 0.105], [ang + 0.35, 0.09]]);
  timeTrack({ x, y, palm: m * 0.095, ang }, t);
}

export default defineEffect({
  id: "time-stone",
  name: "Time Stone",
  kind: "overlay",
  hint: "✋ Open palm stops time — twist it like a dial to rewind",
  needs: { mask: true },
  hands: updateTime,
  demo: demoTime,
  render: renderTime,
  reset: resetTime,
  trigger: triggerTime,
  // Twisting time is an open palm on the move: not a swipe.
  locksSwipe: () => timeFx.on,
});
