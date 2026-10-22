// TEMPLATE — a frame effect: it draws inside the quad your hands make.
//
//   1. Copy this file to src/effects/<your-id>.js and change `id` and `name`.
//   2. Open http://localhost:8000/?try=<your-id>&demo to see it (no camera
//      needed), or drop `&demo` to try it with your hands.
//   3. When it looks right, add it to src/effects/index.js.
//
// This one is night vision: the feed in phosphor green with rolling
// scanlines. It reads three of the frame's dials (see `knobs` in api.js).

import { ctx, defineEffect, filmGrain, frame, knobs } from "../api.js";

// `box` is the frame's bounding box in canvas pixels; ctx is already clipped
// to the frame and faded in with it, so just paint the box.
function draw({ x, y, w, h }, t) {
  // size: open your hands for more gain, close them for less.
  const gain = 0.8 + 1.2 * knobs.size;
  ctx.filter = `grayscale(1) brightness(${gain.toFixed(2)}) contrast(1.3)`;
  ctx.drawImage(frame, x, y, w, h, x, y, w, h);
  ctx.filter = "none";

  // Phosphor green; tilt the frame to push it toward amber.
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = `hsl(${(130 - 90 * Math.max(0, knobs.tilt)).toFixed(0)}, 100%, 62%)`;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  // Scanlines that roll slowly down the tube.
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  for (let sy = y + ((t / 40) % 4); sy < y + h; sy += 4) ctx.fillRect(x, sy, w, 1.5);

  // punch: a fast squeeze of the frame flares the tube.
  if (knobs.punch > 0.02) {
    ctx.fillStyle = `rgba(210,255,220,${(0.6 * knobs.punch).toFixed(3)})`;
    ctx.fillRect(x, y, w, h);
  }
  filmGrain(x, y, w, h, 0.22);
}

export default defineEffect({
  id: "night-vision",
  name: "Night Vision",
  kind: "frame",
  draw,
});
