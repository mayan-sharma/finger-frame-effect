// Noir — black-and-white film: a vignette, a little gate weave, and grain.
// Knobs: size drives contrast; tilt warms it toward a faded sepia print.

import { clamp01, ctx, defineEffect, filmGrain, frame, knobs } from "../api.js";

function drawNoir({ x: bx, y: by, w: bw, h: bh }, t) {
  // Knob: size drives contrast, from flat grey up to hard blacks-and-whites;
  // tilt warms it from cold silver toward a faded sepia print.
  const con = (0.85 + 1.5 * knobs.size).toFixed(2);
  const sep = clamp01(knobs.tilt).toFixed(2);
  ctx.filter = `grayscale(1) contrast(${con}) brightness(0.95) sepia(${sep})`;
  ctx.drawImage(frame, bx, by, bw, bh, bx, by, bw, bh);
  ctx.filter = "none";
  // Film: a vignette pulled in toward the middle of the frame, a little gate
  // weave in its brightness, and grain that is new every frame.
  const cx = bx + bw / 2, cy = by + bh / 2, r = Math.hypot(bw, bh) / 2;
  const v = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(0,0,0,${0.55 + 0.04 * Math.sin(t * 0.011)})`);
  ctx.fillStyle = v;
  ctx.fillRect(bx, by, bw, bh);
  filmGrain(bx, by, bw, bh, 0.28);
}

export default defineEffect({
  id: "noir",
  name: "Noir",
  kind: "frame",
  draw: drawNoir,
});
