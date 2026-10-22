// Rainbow — open your mouth and a rainbow pours out
//
// The stream is a chain of cross-sections ("slices"). Each one is launched
// from the mouth, then falls on its own, so the ribbon is simply wherever the
// slices have got to: swing your head and it whips, shut your mouth and the
// tail detaches and drops away.

import { canvas, clamp, ctx, defineEffect, mouth } from "../api.js";

const RAINBOW = ["#ff3d3d", "#ff9a1f", "#ffe62e", "#35d45a", "#2f96ff", "#8a4dff"];
// Physics is in mouth widths, so it looks the same near or far from the
// camera. Gravity is far below the real thing on purpose: at true scale the
// stream leaves the screen in a quarter of a second and reads as a flash.
const RB_WIDTH = 0.9;            // stream width, x the inner mouth width
const RB_SPEED = 4.5;            // launch speed, mouth widths / s
const RB_GRAVITY = 30;           // mouth widths / s^2
const RB_MAX_SPEED = 13;         // terminal speed, so it pours rather than drops
const RB_WOBBLE = 0.13;          // sideways wiggle, x stream width
const RB_FLARE = 0.4;            // how much wider it gets as it falls
const RB_STAR_RATE = 16;         // sparkles per second while it flows

// Rainbow state. Slices are cross-sections of the stream, oldest first.
const rainbow = { slices: [], stars: [], lastT: 0, flowing: false,
                  px: 0, py: 0, vx: 0, vy: 0, starAcc: 0 };

function resetRainbow() {
  rainbow.slices.length = 0;
  rainbow.stars.length = 0;
  rainbow.lastT = 0;
  rainbow.flowing = false;
}

function stepRainbow(dt) {
  const sl = rainbow.slices;
  for (const s of sl) {
    s.age += dt;
    s.vx *= Math.exp(-1.2 * dt);
    s.vy = Math.min(s.vmax, s.vy + s.g * dt);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
  // Only ever drop from the old end, so a run never loses a middle slice and
  // jumps. The slice behind inherits the break and becomes the run's head.
  while (sl.length && (sl[0].y - sl[0].w > canvas.height || sl[0].age > 6)) {
    sl.shift();
    if (sl.length) sl[0].brk = true;
  }

  let n = 0;
  for (const p of rainbow.stars) {
    p.age += dt;
    if (p.age >= p.life) continue;
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    rainbow.stars[n++] = p;
  }
  rainbow.stars.length = n;
}

function emitRainbow(dt, time) {
  const flowing = mouth.seen && mouth.latched;
  if (flowing && dt > 0) {
    // The head's own motion carries into the stream, which is what lets you
    // fling it around. Smoothed, because the mouth only moves on video frames
    // and would otherwise read as stop-go.
    const u = mouth.w;
    if (rainbow.flowing) {
      const lim = u * 10;
      rainbow.vx += (clamp((mouth.x - rainbow.px) / dt, -lim, lim) - rainbow.vx) * 0.3;
      rainbow.vy += (clamp((mouth.y - rainbow.py) / dt, -lim, lim) - rainbow.vy) * 0.3;
    } else {
      rainbow.vx = rainbow.vy = 0;
    }
    const sp = u * RB_SPEED;
    rainbow.slices.push({
      x: mouth.x, y: mouth.y,
      vx: Math.cos(mouth.dir) * sp + rainbow.vx * 0.6,
      vy: Math.sin(mouth.dir) * sp + rainbow.vy * 0.6,
      w: mouth.iw * RB_WIDTH, g: u * RB_GRAVITY, vmax: u * RB_MAX_SPEED,
      age: 0, born: time,
      brk: !rainbow.flowing,        // first slice of a new run: the stream's head
    });

    rainbow.starAcc += RB_STAR_RATE * dt;
    while (rainbow.starAcc >= 1) {
      rainbow.starAcc--;
      const sl = rainbow.slices;
      const s = sl[sl.length - 1 - ((Math.random() * Math.min(sl.length, 40)) | 0)];
      const side = Math.random() < 0.5 ? -1 : 1;
      rainbow.stars.push({
        x: s.x + side * s.w * 0.5, y: s.y,
        vx: side * u * (0.6 + Math.random() * 1.6), vy: -u * Math.random() * 1.5,
        g: u * 4, r: u * (0.10 + Math.random() * 0.18),
        age: 0, life: 0.5 + Math.random() * 0.6, spin: Math.random() * Math.PI,
      });
    }
  }
  rainbow.px = mouth.x;
  rainbow.py = mouth.y;
  rainbow.flowing = flowing;
}

// One run of slices [i, j) as coloured bands. `attached` means its newest end
// is still in the mouth, so that end gets no rounded cap.
function drawRainbowRun(sl, i, j, attached) {
  const n = j - i;
  const cx = new Array(n), cy = new Array(n), ax = new Array(n), ay = new Array(n);
  const ww = new Array(n);
  for (let k = 0; k < n; k++) {
    const s = sl[i + k];
    // Direction of flow, from the slices either side: newer -> older. Two
    // apart, since adjacent ones sit a few pixels from each other and their
    // difference is mostly tracking jitter.
    const newer = sl[Math.min(j - 1, i + k + 2)], older = sl[Math.max(i, i + k - 2)];
    let tx = older.x - newer.x, ty = older.y - newer.y;
    let tl = Math.hypot(tx, ty);
    if (tl < 1) { tx = s.vx; ty = s.vy; tl = Math.hypot(tx, ty) || 1; }
    ax[k] = ty / tl;
    ay[k] = -tx / tl;
    // The wiggle is keyed to when the slice was born, so it is fixed in the
    // material and travels down with it; it fades in, leaving the mouth end
    // pinned exactly to the lips.
    const wob = Math.sin(s.born * 9) * RB_WOBBLE * s.w * Math.min(1, s.age * 1.6);
    cx[k] = s.x + ax[k] * wob;
    cy[k] = s.y + ay[k] * wob;
    // It fans out as it falls and pulses a little; both start from zero so
    // the mouth end stays exactly as wide as the fill inside the mouth.
    const out = Math.min(1, s.age * 1.8);
    ww[k] = s.w * (1 + RB_FLARE * out + 0.06 * out * Math.sin(s.born * 13));
  }
  if (attached) {
    // Square the mouth end to the lip line so it meets the fill inside the
    // mouth band for band.
    ax[n - 1] = Math.sin(mouth.dir);
    ay[n - 1] = -Math.cos(mouth.dir);
  }

  const N = RAINBOW.length;
  // A band between two fractions of the width (-0.5 .. 0.5), plus round caps
  // on the free ends, so the head of the stream is a row of drips.
  const band = (f0, f1, fill, caps) => {
    ctx.fillStyle = fill;
    if (n > 1) {
      ctx.beginPath();
      for (let k = 0; k < n; k++) ctx.lineTo(cx[k] + ax[k] * ww[k] * f0, cy[k] + ay[k] * ww[k] * f0);
      for (let k = n - 1; k >= 0; k--) ctx.lineTo(cx[k] + ax[k] * ww[k] * f1, cy[k] + ay[k] * ww[k] * f1);
      ctx.closePath();
      ctx.fill();
    }
    if (!caps) return;
    const fm = (f0 + f1) / 2;
    for (const k of attached ? [0] : [0, n - 1]) {
      ctx.beginPath();
      ctx.arc(cx[k] + ax[k] * ww[k] * fm, cy[k] + ay[k] * ww[k] * fm,
              ww[k] * (f1 - f0) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  // Each band overlaps the next by a hair, or antialiasing leaves a seam of
  // camera showing between them.
  for (let b = 0; b < N; b++) band(b / N - 0.5, (b + 1) / N - 0.5 + (b < N - 1 ? 0.012 : 0), RAINBOW[b], true);
  // Gloss and a shaded edge: the difference between a flag and a liquid.
  band(-0.38, -0.29, "rgba(255,255,255,0.30)", false);
  band(0.36, 0.5, "rgba(20,0,60,0.13)", false);
}

// The open mouth itself, filled with the same bands, darkening toward the
// upper lip so the stream looks like it comes up from the throat.
function drawRainbowMouth() {
  const poly = mouth.poly;
  const dx = Math.cos(mouth.dir), dy = Math.sin(mouth.dir);
  ctx.save();
  ctx.beginPath();
  for (const p of poly) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.clip();
  // Local frame: x across the lips, y down the face, origin mid-mouth.
  ctx.transform(dy, -dx, dx, dy, mouth.x, mouth.y);
  const N = RAINBOW.length, W = mouth.iw * RB_WIDTH, bw = W / N, H = mouth.gap + 4;
  for (let b = 0; b < N; b++) {
    // The outer bands run on to the corners of the mouth.
    const x0 = b === 0 ? -W * 2 : -W / 2 + b * bw;
    const x1 = b === N - 1 ? W * 2 : -W / 2 + (b + 1) * bw + 1;
    ctx.fillStyle = RAINBOW[b];
    ctx.fillRect(x0, -H, x1 - x0, H * 2);
  }
  const depth = ctx.createLinearGradient(0, -mouth.gap / 2, 0, mouth.gap * 0.15);
  depth.addColorStop(0, "rgba(25,0,30,0.75)");
  depth.addColorStop(1, "rgba(25,0,30,0)");
  ctx.fillStyle = depth;
  ctx.fillRect(-W * 2, -H, W * 4, H * 2);
  ctx.restore();
}

function drawRainbowStars() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "#fffbe0";
  for (const p of rainbow.stars) {
    const u = p.age / p.life;
    // Pop in, twinkle, shrink away.
    const r = p.r * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (0.75 + 0.25 * Math.sin(p.age * 30));
    if (r < 0.5) continue;
    ctx.globalAlpha = 1 - u * u;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = p.spin + k * Math.PI / 4;
      const rr = k % 2 ? r * 0.28 : r;
      ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Called once per rendered frame, after the camera is on the canvas.
function renderRainbow(t) {
  const dt = rainbow.lastT ? Math.min(0.05, (t - rainbow.lastT) / 1000) : 0;
  rainbow.lastT = t;
  stepRainbow(dt);
  emitRainbow(dt, t / 1000);

  const flowing = rainbow.flowing;
  if (flowing && mouth.poly) drawRainbowMouth();
  const sl = rainbow.slices;
  for (let i = 0; i < sl.length;) {
    let j = i + 1;
    while (j < sl.length && !sl[j].brk) j++;
    drawRainbowRun(sl, i, j, flowing && j === sl.length);
    i = j;
  }
  drawRainbowStars();
}

export default defineEffect({
  id: "rainbow",
  name: "Rainbow",
  kind: "overlay",
  hint: "Open your mouth wide 🌈",
  needs: { face: true },
  render: renderRainbow,
  reset: resetRainbow,
});
