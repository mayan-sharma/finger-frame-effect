// TEMPLATE — an overlay effect: no frame, a hand pose drives it instead.
//
//   1. Copy this file to src/effects/<your-id>.js and change `id` and `name`.
//   2. Open http://localhost:8000/?try=<your-id>&demo to see it (no camera
//      needed), or drop `&demo` to try it with your hands.
//   3. When it looks right, add it to src/effects/index.js.
//
// This one is fireflies: show an open palm and they gather around it. `f`
// scatters them in a burst of sparks.

import {
  addSpark, canvas, ctx, defineEffect, demoBlob, drawSparks, frame, gagClock, openCount,
  palmCentre, spill, stepSparks, trackedHands, unit,
} from "../api.js";

const FLIES = 24;
const LOST_FRAMES = 6;           // tracker frames the palm may drop out for

// Where the open palm is, in canvas pixels, and how far the flies roam.
const palm = { on: false, lost: 0, x: 0, y: 0, r: 0 };
const flies = Array.from({ length: FLIES }, (_, i) => ({
  a: i * 2.4, reach: 0.6 + (i % 5) * 0.12, speed: 0.6 + (i % 3) * 0.3,
}));
let glow = 0;                    // 0..1, eases in and out with the palm

// Each new hand-tracker result. trackedHands gives every hand in canvas
// pixels (`pts`), its landmarks (`w`) and its scale in pixels per metre, so
// sizes can be real-world and hold at any distance from the camera.
function hands(res, t) {
  const open = trackedHands(res, t).find((h) => openCount(h.w) === 4);
  if (!open) {
    if (++palm.lost > LOST_FRAMES) palm.on = false;
    return;
  }
  const c = palmCentre(open.pts);
  palm.on = true;
  palm.lost = 0;
  palm.x = c.x;
  palm.y = c.y;
  palm.r = open.scale * 0.12;    // 12 cm
}

// ?demo has no camera: paint a stand-in hand into the frame and drive the
// same state hands() would.
function demo(t) {
  const m = frame.height / 0.55;  // pixels per metre, as the built-in demos use
  const x = frame.width * (0.5 + 0.15 * Math.sin(t * 0.0006)), y = frame.height * 0.62;
  demoBlob(x, y, m, 0, [[-1.95, 0.09], [-1.7, 0.1], [-1.45, 0.095], [-1.2, 0.08]]);
  palm.on = Math.sin(t * 0.0004) > -0.6;
  palm.x = x;
  palm.y = y - m * 0.05;
  palm.r = m * 0.12;
}

// Every frame, on top of the feed.
function render(t) {
  const dt = gagClock(t);
  glow += ((palm.on ? 1 : 0) - glow) * Math.min(1, dt * 4);
  if (glow > 0.01) {
    spill(palm.x, palm.y, palm.r * 3, "255,214,120", 0.22 * glow);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of flies) {
      const a = f.a + t * 0.001 * f.speed;
      const x = palm.x + Math.cos(a) * palm.r * f.reach * 1.6;
      const y = palm.y + Math.sin(a * 1.3) * palm.r * f.reach;
      const r = (4 + 2 * Math.sin(t * 0.008 + f.a)) * unit();
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      g.addColorStop(0, `rgba(255,240,170,${glow})`);
      g.addColorStop(1, "rgba(255,200,80,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    }
    ctx.restore();
  }
  stepSparks(dt);
  drawSparks();
}

// `f`: the flies scatter, from the palm or from the middle of the screen.
function trigger() {
  const x = palm.on ? palm.x : canvas.width / 2, y = palm.on ? palm.y : canvas.height / 2;
  for (let i = 0; i < 40; i++) {
    addSpark(x, y, Math.random() * Math.PI * 2, canvas.height * (0.2 + Math.random() * 0.5),
             0.5 + Math.random() * 0.5, canvas.height * 0.4, "#ffe08a");
  }
}

// Another effect was selected: forget the palm.
function reset() {
  palm.on = false;
  palm.lost = 0;
  glow = 0;
}

export default defineEffect({
  id: "fireflies",
  name: "Fireflies",
  kind: "overlay",
  hint: "✋ Show an open palm — fireflies gather. Press f to scatter them",
  hands,
  demo,
  render,
  reset,
  trigger,
});
