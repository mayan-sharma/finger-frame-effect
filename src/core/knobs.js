// The frame as a knob.
//
// The quad is not just a stencil saying WHERE an effect draws: it also says
// HOW. Your hands are already holding three continuous values — how far
// apart they are, how far you tilt them, how far you squash the box — and
// discarding them would run every effect at one fixed setting forever. So
// the quad's geometry is normalized into four dials that every effect reads,
// with the same meaning everywhere, so learning them on one effect transfers
// to all of them:
//
//   size    0..1   how much. Open your hands for more, close them for less.
//   tilt   -1..1   which angle / which hue. Rotate the frame.
//   aspect -1..1   a second axis. Squash the box wide or tall.
//   punch   0..1   a transient. A fast squeeze fires it; it then decays.
//
// Everything is smoothed, because raw fingertip geometry jitters by a few
// pixels every frame and an unsmoothed dial makes the whole effect buzz.

import { canvas } from "./stage.js";
import { clamp, clamp01, polyArea } from "../lib/math.js";

// Dial calibration. The area bounds are deliberately tighter than AREA_MIN /
// AREA_MAX in quad.js: those decide whether a quad is a frame at all, these
// decide where the dial reads 0 and 1, and a dial that only saturates at the
// very edge of what tracking accepts is a dial nobody ever reaches.
const KNOB_AREA_LO = 0.012;      // quad area fraction that reads as "closed"
const KNOB_AREA_HI = 0.26;       // ... and as "wide open"
const KNOB_TILT_MAX = Math.PI / 4;  // tilt that pins the dial to +/-1
const KNOB_ASPECT_MAX = 1.1;     // log2(w/h) that pins the dial to +/-1
const KNOB_LERP = 0.16;          // dial smoothing per frame
const KNOB_PUNCH_GAIN = 14;      // how hard a fast squeeze fires the transient
const KNOB_PUNCH_DECAY = 0.90;

export const knobs = { size: 0.5, tilt: 0, aspect: 0, punch: 0 };
let knobSizePrev = null;         // null = no frame last time, so no punch

export function updateKnobs(q) {
  if (!q) {
    // No frame up: let the transient die but leave the dials where they were,
    // so a momentary tracking dropout does not slam every effect to neutral.
    knobs.punch *= KNOB_PUNCH_DECAY;
    knobSizePrev = null;
    return;
  }

  // Square-root the area so the dial tracks the box's linear size. On area
  // alone, moving your hands apart at arm's length barely registers while the
  // last few centimetres near a closed frame swing it wildly.
  const lo = Math.sqrt(KNOB_AREA_LO), hi = Math.sqrt(KNOB_AREA_HI);
  const lin = Math.sqrt(polyArea(q) / (canvas.width * canvas.height));
  const size = clamp01((lin - lo) / (hi - lo));

  // Corners are [L.index, R.index, R.thumb, L.thumb], so 0->1 is the frame's
  // top edge and 0->3 its left edge.
  const tx = q[1].x - q[0].x, ty = q[1].y - q[0].y;
  const lx = q[3].x - q[0].x, ly = q[3].y - q[0].y;
  const tilt = clamp(Math.atan2(ty, tx) / KNOB_TILT_MAX, -1, 1);
  const w = Math.max(1e-3, Math.hypot(tx, ty));
  const h = Math.max(1e-3, Math.hypot(lx, ly));
  const aspect = clamp(Math.log(w / h) / Math.LN2 / KNOB_ASPECT_MAX, -1, 1);

  // Punch is |d size| per frame, so it fires on a *fast* squeeze and ignores
  // a slow one. It rises instantly and decays, which is what makes it read as
  // a hit rather than another position dial.
  const d = knobSizePrev === null ? 0 : size - knobSizePrev;
  knobSizePrev = size;
  knobs.punch = Math.max(knobs.punch * KNOB_PUNCH_DECAY,
                         clamp01(Math.abs(d) * KNOB_PUNCH_GAIN));

  knobs.size += (size - knobs.size) * KNOB_LERP;
  knobs.tilt += (tilt - knobs.tilt) * KNOB_LERP;
  knobs.aspect += (aspect - knobs.aspect) * KNOB_LERP;
}

// A readout, because a dial you cannot see is a dial you cannot learn. The
// bipolar ones fill outward from the centre so "off centre" is the signal.
const knobEl = document.getElementById("knobs");
const KNOB_ROWS = [
  { key: "size", bipolar: false, cls: "" },
  { key: "tilt", bipolar: true, cls: "" },
  { key: "aspect", bipolar: true, cls: "" },
  { key: "punch", bipolar: false, cls: "punch" },
];
const knobFills = KNOB_ROWS.map((row) => {
  const el = document.createElement("div");
  el.className = "knob";
  el.innerHTML = `<span class="kl">${row.key}</span>` +
    `<div class="bar${row.bipolar ? " bipolar" : ""}${row.cls ? " " + row.cls : ""}"><i></i></div>`;
  knobEl.appendChild(el);
  return el.querySelector("i");
});

export function refreshKnobReadout(visible) {
  knobEl.classList.toggle("hidden", !visible);
  if (!visible) return;
  KNOB_ROWS.forEach((row, i) => {
    const v = knobs[row.key];
    const origin = row.bipolar ? 50 : 0;
    const span = row.bipolar ? v * 50 : v * 100;
    knobFills[i].style.left = `${Math.min(origin, origin + span)}%`;
    knobFills[i].style.width = `${Math.abs(span)}%`;
  });
}
