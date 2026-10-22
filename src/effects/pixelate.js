// Pixelate — the frame turns everything inside it into big square blocks.
// Knob: closing the frame coarsens the blocks, opening it refines them.

import { canvas, ctx, defineEffect, frame, knobs, makeScratch, sizeScratch } from "../api.js";

const sPix = makeScratch(false);

// `draw` gets the frame's bounding box; ctx is already clipped to the quad.
function drawPixelate({ x: bx, y: by, w: bw, h: bh }) {
  // Knob: closing the frame coarsens the blocks, opening it refines them.
  const cell = Math.max(3,
    Math.round((canvas.width / 53) * (2.3 - 1.9 * knobs.size)));
  const tw = Math.max(2, Math.round(bw / cell));
  const th = Math.max(2, Math.round(bh / cell));
  const g = sizeScratch(sPix, tw, th);
  g.imageSmoothingEnabled = true;
  g.drawImage(frame, bx, by, bw, bh, 0, 0, tw, th);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sPix.c, 0, 0, tw, th, bx, by, bw, bh);
  ctx.imageSmoothingEnabled = true;
}

export default defineEffect({
  id: "pixelate",
  name: "Pixelate",
  kind: "frame",
  draw: drawPixelate,
});
