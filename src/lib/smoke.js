// Soft smoke particles: Smoke's exhale, and gun smoke, puffs and the like.

import { canvas, ctx, makeScratch, sizeScratch } from "../core/stage.js";

const SMOKE_MAX = 900;
const SMOKE_RES = 0.25;          // smoke layer scale: low-res reads as soft

const sSmoke = makeScratch(false);   // low-res smoke layer
export const smokeParts = [];

// A few lumpy puff sprites. One round gradient stamped a few hundred times
// reads as a pile of circles; irregular ones, each spinning, read as smoke.
// The grey is deliberately a mid-light blue-grey rather than white: white
// smoke vanishes against a bright wall or a shirt, this shows on both.
const smokeSprites = Array.from({ length: 4 }, () => {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d");
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = i === 0 ? 0 : 6 + Math.random() * 12;
    const x = 48 + Math.cos(a) * d, y = 48 + Math.sin(a) * d;
    const r = 29 - d * 0.55;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(206,210,220,0.42)");
    grad.addColorStop(0.5, "rgba(206,210,220,0.16)");
    grad.addColorStop(1, "rgba(206,210,220,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
  }
  return c;
});

export function emitSmoke(p) {
  if (smokeParts.length >= SMOKE_MAX) return;
  p.age = 0;
  p.fine = !!p.fine;
  p.rot = Math.random() * Math.PI * 2;
  p.spin = (Math.random() - 0.5) * 1.4;
  p.sprite = (Math.random() * smokeSprites.length) | 0;
  smokeParts.push(p);
}

export function stepSmoke(dt, time) {
  // One flow field for every particle, so neighbours bend together and the
  // plume forms ribbons instead of boiling as independent dots.
  const k = (Math.PI * 2) / (canvas.height * 0.22);
  let n = 0;
  for (let i = 0; i < smokeParts.length; i++) {
    const p = smokeParts[i];
    p.age += dt;
    if (p.age >= p.life) continue;
    const drag = Math.exp(-p.drag * dt);
    const fx = Math.sin(p.y * k + time * 0.9) +
      0.6 * Math.sin(p.y * k * 2.1 - time * 1.4 + p.x * k * 0.7);
    const fy = Math.cos(p.x * k * 1.3 + time * 0.7);
    p.vx = p.vx * drag + fx * p.turb * dt;
    p.vy = p.vy * drag + (fy * p.turb * 0.4 - p.rise) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    smokeParts[n++] = p;
  }
  smokeParts.length = n;
}

// Stamps every particle of one kind into `g`, whose pixels are `scale` canvas
// pixels each.
function stampSmoke(g, scale, fine) {
  for (const p of smokeParts) {
    if (p.fine !== fine) continue;
    const u = p.age / p.life;
    // Quick fade in, long fade out. `grow` shapes the swell: below 1 billows
    // out at once like a breath, above 1 stays a thin thread before opening.
    const a = p.alpha * Math.min(1, u * 9) * (1 - u) * (1 - u);
    if (a < 0.004) continue;
    const r = (p.r0 + (p.r1 - p.r0) * Math.pow(u, p.grow)) * scale;
    const c = Math.cos(p.rot) * r, s = Math.sin(p.rot) * r;
    g.globalAlpha = a;
    g.setTransform(c, s, -s, c, p.x * scale, p.y * scale);
    g.drawImage(smokeSprites[p.sprite], -1, -1, 2, 2);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
}

export function drawSmoke() {
  if (!smokeParts.length) return;
  // The breath is big, soft and heavily overdrawn, so it goes through a
  // quarter-res layer: a sixteenth of the fill, and the upscale is free blur.
  const w = Math.max(2, Math.round(canvas.width * SMOKE_RES));
  const h = Math.max(2, Math.round(canvas.height * SMOKE_RES));
  const g = sizeScratch(sSmoke, w, h);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  stampSmoke(g, SMOKE_RES, false);
  ctx.drawImage(sSmoke.c, 0, 0, canvas.width, canvas.height);
  // The thread off the tip is only a few pixels wide; at quarter-res it
  // turns into visible blocks, so it is stamped straight onto the canvas.
  ctx.save();
  stampSmoke(ctx, 1, true);
  ctx.restore();
}
