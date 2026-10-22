// The finger frame: both hands' thumb and index tips as a quad, with
// hysteresis, jump rejection and velocity-adaptive smoothing.

import { canvas, toScreen } from "./stage.js";
import { INDEX_TIP, MIDDLE_MCP, THUMB_TIP, WRIST } from "../lib/landmarks.js";
import { dist, isBowtie, polyArea } from "../lib/math.js";

const MAX_LOST_FRAMES = 25;      // frames the quad survives a tracking dropout
const JUMP_CONFIRM_FRAMES = 2;   // frames a large reposition must persist
const JUMP_FRAC = 0.3;           // "large" = avg corner move > 30% screen width
const SPREAD_ON = 0.7;           // thumb-index spread (x hand scale) to activate
const SPREAD_OFF = 0.3;          // spread to stay active (hysteresis)
const AREA_MIN = 0.005;          // quad area as fraction of canvas area
const AREA_MAX = 0.6;
const ALPHA_MIN = 0.35;          // corner smoothing lerp range (velocity-adaptive)
const ALPHA_MAX = 0.85;

// Quad tracking state
export let smoothQuad = null;           // [{x,y} x4] smoothed screen-space corners
export let presence = 0;                // 0..1 fade
let lostFrames = 0;
let jumpCandidate = null;        // pending large-jump quad
let jumpFrames = 0;
let spreadActive = [false, false]; // per-hand hysteresis latch

export function computeQuad(handsLandmarks) {
  if (!handsLandmarks || handsLandmarks.length < 2) {
    spreadActive = [false, false];
    return null;
  }

  const hands = handsLandmarks.slice(0, 2).map((lms) => ({
    wrist: toScreen(lms[WRIST]),
    thumb: toScreen(lms[THUMB_TIP]),
    index: toScreen(lms[INDEX_TIP]),
    midMcp: toScreen(lms[MIDDLE_MCP]),
  }));

  // Hand scale from wrist -> middle knuckle: stable under foreshortening.
  for (let i = 0; i < 2; i++) {
    const h = hands[i];
    const scale = dist(h.wrist, h.midMcp);
    if (scale < 1e-3) { spreadActive = [false, false]; return null; }
    const spread = dist(h.thumb, h.index) / scale;
    const threshold = spreadActive[i] ? SPREAD_OFF : SPREAD_ON;
    spreadActive[i] = spread > threshold;
    if (!spreadActive[i]) return null;
  }

  // Order anatomically: left hand's index is top-left, right hand's index
  // top-right, then down to the thumbs.
  hands.sort((a, b) => a.wrist.x - b.wrist.x);
  const [L, R] = hands;
  const quad = [L.index, R.index, R.thumb, L.thumb];

  const areaFrac = polyArea(quad) / (canvas.width * canvas.height);
  if (areaFrac < AREA_MIN || areaFrac > AREA_MAX) return null;
  if (isBowtie(quad)) return null;

  return quad;
}

// Quad smoothing / hysteresis pipeline

function avgCornerDelta(a, b) {
  let d = 0;
  for (let i = 0; i < 4; i++) d += dist(a[i], b[i]);
  return d / 4;
}

export function updateQuadState(raw) {
  if (raw) {
    if (!smoothQuad) {
      smoothQuad = raw.map((p) => ({ x: p.x, y: p.y }));
    } else {
      const delta = avgCornerDelta(smoothQuad, raw);
      if (delta > JUMP_FRAC * canvas.width) {
        // A huge reposition: might be a mis-detection. Require it to persist.
        jumpFrames++;
        if (jumpFrames >= JUMP_CONFIRM_FRAMES) {
          smoothQuad = raw.map((p) => ({ x: p.x, y: p.y }));
          jumpFrames = 0;
        }
      } else {
        jumpFrames = 0;
        // Velocity-adaptive smoothing: sluggish when still, responsive when moving.
        const speed = delta / (canvas.width * 0.05);
        const alpha = Math.min(ALPHA_MAX, ALPHA_MIN + speed * (ALPHA_MAX - ALPHA_MIN));
        for (let i = 0; i < 4; i++) {
          smoothQuad[i].x += (raw[i].x - smoothQuad[i].x) * alpha;
          smoothQuad[i].y += (raw[i].y - smoothQuad[i].y) * alpha;
        }
      }
    }
    lostFrames = 0;
  } else {
    lostFrames++;
    jumpFrames = 0;
  }

  const visible = smoothQuad && lostFrames <= MAX_LOST_FRAMES;
  presence += ((visible ? 1 : 0) - presence) * (visible ? 0.18 : 0.1);
  if (presence < 0.005 && !visible) {
    presence = 0;
    smoothQuad = null;
  }
}
