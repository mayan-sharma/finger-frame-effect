// Blur — frosted glass.
// Knobs: size is focus (a wide frame is nearly sharp, a closed one is soup);
// tilt shifts the hue.

import { ctx, defineEffect, filmGrain, frame, knobs } from "../api.js";

function drawBlur({ x: bx, y: by, w: bw, h: bh }) {
  const radius = (3 + 26 * (1 - knobs.size)).toFixed(1);
  ctx.filter = `blur(${radius}px) saturate(1.15) brightness(1.06) hue-rotate(${(knobs.tilt * 60) | 0}deg)`;
  // Overdraw beyond the bbox so the blur doesn't pull in transparent edges.
  const pad = 30;
  ctx.drawImage(frame, bx - pad, by - pad, bw + pad * 2, bh + pad * 2,
    bx - pad, by - pad, bw + pad * 2, bh + pad * 2);
  ctx.filter = "none";
  // The frost: a cool milky wash, and a fine static grain the light catches.
  ctx.fillStyle = "rgba(225,235,245,0.08)";
  ctx.fillRect(bx, by, bw, bh);
  filmGrain(bx, by, bw, bh, 0.1);
}

export default defineEffect({
  id: "blur",
  name: "Blur",
  kind: "frame",
  draw: drawBlur,
});
