import { openFingerCount } from "../lib/hands.js";
import { MIDDLE_MCP, WRIST } from "../lib/landmarks.js";

// Swipe an open hand sideways to change effect. Constants carried over from
// the terminal build, where they were tuned against real swipes:
//   * Gate on geometry (how many fingers are up), NOT on a model label — a
//     swiping hand is motion blurred and the classifier stops calling it an
//     open palm exactly when you swipe.
//   * Measure travel from the furthest extreme in the window, not the oldest
//     sample, so a swipe starting mid-window still registers fully.
//   * Require one axis to dominate, or a sloppy diagonal fires both.
//   * Ignore the first moments after a hand appears: raising it into frame is
//     itself fast motion. 150ms was measured too short; 250ms swallows it.
const SWIPE_DIST = 0.13;         // normalized screen widths
// Vertical travel is smaller in normalized units: the frame is 4:3, so the
// same physical motion covers less normalized distance across y than x — and
// arms swing sideways more freely than up and down.
const SWIPE_DIST_Y = 0.10;
const SWIPE_WINDOW_MS = 600;
const SWIPE_MIN_FINGERS = 3;     // an open-ish hand; a fist must not swipe
const SWIPE_DOMINANCE = 1.5;     // horizontal must beat vertical by this
const SWIPE_SETTLE_MS = 250;
const SWIPE_COOLDOWN_MS = 700;   // one effect change per swipe, not a burst

// Signed excursion from whichever extreme of the window is furthest away.
function swipeTravel(vals, cur) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const up = cur - lo, down = cur - hi;
  return Math.abs(up) >= Math.abs(down) ? up : down;
}

const swipeState = { history: [], enteredAt: null, lastFire: 0 };

export function detectSwipe(handsLandmarks, t) {
  // One hand only. Both hands up is the framing pose, and two palms moving
  // together would fire a swipe on each of them.
  if (!handsLandmarks || handsLandmarks.length !== 1) {
    swipeState.history.length = 0;
    swipeState.enteredAt = null;
    return null;
  }
  const lms = handsLandmarks[0];
  if (openFingerCount(lms) < SWIPE_MIN_FINGERS) {
    swipeState.history.length = 0;
    swipeState.enteredAt = null;
    return null;
  }

  if (swipeState.enteredAt === null) swipeState.enteredAt = t;
  if (t - swipeState.enteredAt < SWIPE_SETTLE_MS) return null;

  // Palm centre, not the wrist: the wrist barely moves when you swipe from
  // the elbow, which is how people actually swipe.
  const x = (lms[WRIST].x + lms[MIDDLE_MCP].x) / 2;
  const y = (lms[WRIST].y + lms[MIDDLE_MCP].y) / 2;
  const h = swipeState.history;
  h.push({ t, x, y });
  while (h.length && t - h[0].t > SWIPE_WINDOW_MS) h.shift();
  if (h.length < 3) return null;

  const dx = swipeTravel(h.map((p) => p.x), x);
  const dy = swipeTravel(h.map((p) => p.y), y);

  // One axis must clearly dominate, or a sloppy diagonal wave clears both
  // thresholds and fires whichever happens to be tested first.
  const horizontal = Math.abs(dx) >= SWIPE_DIST &&
    Math.abs(dx) >= Math.abs(dy) * SWIPE_DOMINANCE;
  const vertical = Math.abs(dy) >= SWIPE_DIST_Y &&
    Math.abs(dy) >= Math.abs(dx) * SWIPE_DOMINANCE;
  if (!horizontal && !vertical) return null;
  if (t - swipeState.lastFire < SWIPE_COOLDOWN_MS) return null;

  swipeState.lastFire = t;
  h.length = 0;
  if (horizontal) {
    // Landmarks are in unmirrored video space while the canvas is mirrored,
    // so a hand moving to the user's right decreases x here.
    return dx > 0 ? "left" : "right";
  }
  // Image y grows downward, so +dy means the hand moved down.
  return dy > 0 ? "down" : "up";
}
