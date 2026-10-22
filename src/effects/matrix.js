// Matrix — digital rain in the frame. Slide up/down (or press `k`) to cut
// yourself out of it, so it falls behind you; ?keepPerson starts that way.
// Knobs: size is how dense the rain is; punch shoves every column down.

import { cellHash, ctx, defineEffect, drawPersonOver, flashStatus, knobs,
  makeScratch, sizeScratch, urlParams } from "../api.js";

// Matrix rain, ported from the terminal build. Rendered on a coarse grid and
// scaled up, so the glyph cells stay chunky and readable.
const MATRIX_CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789XYZ";

// Default: rain in FRONT of you. Cutting yourself out of it instead is what
// the terminal build called --keep-person.
let keepPerson = urlParams.has("keepPerson");

const sRain = makeScratch(false);

// Column speed is a function of absolute time, so a punch cannot just scale
// it — that would teleport the rain. It advances a shared time offset instead,
// which every column inherits at its own rate.
let matrixRush = 0;

function drawMatrix({ x: bx, y: by, w: bw, h: bh }, t) {
  matrixRush += knobs.punch * 60;
  const g = sizeScratch(sRain, bw, bh);
  g.fillStyle = "#010703";
  g.fillRect(0, 0, bw, bh);

  // Knob: size is rain density, punch shoves every column downward at once.
  const cols = Math.max(8, Math.min(90,
    Math.round((bw / 22) * (0.55 + 1.0 * knobs.size))));
  const cw = bw / cols;
  const fs = cw * 0.9;
  const rows = Math.ceil(bh / fs);
  const trail = 14;
  g.font = `bold ${fs}px monospace`;
  g.textAlign = "center";
  for (let c = 0; c < cols; c++) {
    // Per-column speed and offset, fixed by hash: the rain is steady rather
    // than reshuffling every frame.
    const speed = 0.006 + 0.012 * cellHash(c, 3);
    const head = (((t + matrixRush) * speed + cellHash(c, 9) * 100) %
      (rows + trail)) - 1;
    for (let k = 0; k < trail; k++) {
      const row = Math.floor(head) - k;
      if (row < 0 || row > rows) continue;
      const mut = Math.floor(t / 400);
      const ch = MATRIX_CHARS[
        Math.floor(cellHash(c * 31 + 7, row * 17 + (k === 0 ? mut : 0)) *
          MATRIX_CHARS.length)
      ];
      g.fillStyle = k === 0
        ? "rgba(215,255,228,0.96)"
        : `rgba(0,255,90,${(1 - k / trail) * 0.8})`;
      g.fillText(ch, c * cw + cw / 2, row * fs + fs);
    }
  }
  ctx.drawImage(sRain.c, bx, by);
  // Default is rain in front; `k` puts it behind you instead.
  if (keepPerson) drawPersonOver(bx, by, bw, bh);
}

const rainLabel = () => (keepPerson ? "Matrix rain behind you" : "Matrix rain in front");

export default defineEffect({
  id: "matrix",
  name: "Matrix",
  kind: "frame",
  // The person mask only matters once you are cut out of the rain.
  needs: { mask: () => keepPerson },
  draw: drawMatrix,
  cycle() {
    keepPerson = !keepPerson;
    return rainLabel();
  },
  onKey(key) {
    if (key !== "k") return false;
    keepPerson = !keepPerson;
    flashStatus(rainLabel());
    return true;
  },
});
