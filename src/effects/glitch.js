// Glitch — torn horizontal slices, split colour channels and scanlines.
// Knobs: a closed frame glitches harder, and a fast squeeze (punch) fires a
// burst.

import { cellHash, ctx, defineEffect, frame, knobs, makeScratch, sizeScratch } from "../api.js";

const sGlitchSrc = makeScratch(false);
const sGlitchR = makeScratch(false);
const sGlitchC = makeScratch(false);

function drawGlitch({ x: bx, y: by, w: bw, h: bh }, t) {
  const g = sizeScratch(sGlitchSrc, bw, bh);
  g.clearRect(0, 0, bw, bh);
  // Knob: a closed frame glitches harder, and a fast squeeze fires a burst.
  // Punch is the best showcase for the transient dial — the tear is over
  // before the dial has finished decaying.
  const sev = 0.35 + 0.85 * (1 - knobs.size) + 2.4 * knobs.punch;

  // Horizontal slice displacement, jittering over time.
  const seed = Math.floor(t / 90);
  let y = 0, i = 0;
  while (y < bh) {
    const sh = 8 + Math.floor(cellHash(seed, i) * 40);
    const off = (cellHash(seed + 13, i * 7) - 0.5) * bw * 0.06 * sev *
      (cellHash(seed + 5, i) > 0.6 ? 1 : 0.15);
    g.drawImage(frame, bx, by + y, bw, sh, off, y, bw, sh);
    y += sh;
    i++;
  }

  // Chromatic aberration: isolate red / cyan channels, offset, add.
  const gr = sizeScratch(sGlitchR, bw, bh);
  gr.globalCompositeOperation = "source-over";
  gr.drawImage(sGlitchSrc.c, 0, 0);
  gr.globalCompositeOperation = "multiply";
  gr.fillStyle = "#f00";
  gr.fillRect(0, 0, bw, bh);

  const gc = sizeScratch(sGlitchC, bw, bh);
  gc.globalCompositeOperation = "source-over";
  gc.drawImage(sGlitchSrc.c, 0, 0);
  gc.globalCompositeOperation = "multiply";
  gc.fillStyle = "#0ff";
  gc.fillRect(0, 0, bw, bh);

  const shift = Math.round(8 * sev);
  ctx.drawImage(sGlitchR.c, bx - shift, by);
  const prevOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(sGlitchC.c, bx + shift, by);
  ctx.globalCompositeOperation = prevOp;

  // Scanlines
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  for (let sy = by + (Math.floor(t / 40) % 6); sy < by + bh; sy += 6) {
    ctx.fillRect(bx, sy, bw, 2);
  }
}

export default defineEffect({
  id: "glitch",
  name: "Glitch",
  kind: "frame",
  draw: drawGlitch,
});
