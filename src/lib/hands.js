// Hand pose helpers. Distances on the hand are in palm lengths (wrist ->
// middle knuckle), so every threshold holds for any hand size and distance
// from the camera.

import { canvas, toScreen } from "../core/stage.js";
import { INDEX_MCP, MIDDLE_MCP, PINKY_MCP, PIPS, RING_MCP, TIPS, WRIST } from "./landmarks.js";
import { d3, dist } from "./math.js";

// Finger "straightness" is the cosine between a finger's first bone and the
// rest of it, in the tracker's metric 3D landmarks: ~1 extended, <0 in a fist.
// The pair of thresholds is a hysteresis latch, so a relaxed hold (nobody
// keeps a smoking hand ramrod straight) does not flicker the cigarette.
const POSE_UP_ON = 0.75, POSE_UP_OFF = 0.55;
export const POSE_DOWN_ON = 0.5, POSE_DOWN_OFF = 0.75;

// Real-world width of an index finger, in metres.
export const FINGER_W_M = 0.0185;

// A shove toward the camera: the hand's on-screen size growing by this
// fraction of itself per second.
export const KAME_PUSH = 0.6;

// Extended-finger count, excluding the thumb: a fingertip sitting further
// from the wrist than its PIP joint is extended. Measuring against the wrist
// (rather than comparing raw y) keeps the test valid for a rotated hand.
export function openFingerCount(lms) {
  const w = lms[WRIST];
  let n = 0;
  for (let i = 0; i < TIPS.length; i++) {
    const tip = lms[TIPS[i]], pip = lms[PIPS[i]];
    const td = Math.hypot(tip.x - w.x, tip.y - w.y);
    const pd = Math.hypot(pip.x - w.x, pip.y - w.y);
    if (td / Math.max(pd, 1e-4) > 1.06) n++;
  }
  return n;
}

// Cosine between a finger's first bone (MCP -> PIP) and the rest of it
// (PIP -> tip). Works on the metric world landmarks, so a finger pointing at
// the camera still reads as straight where a 2D test would call it curled.
export function fingerStraightness(w, mcp) {
  const a = w[mcp], b = w[mcp + 1], c = w[mcp + 3];
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const d = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
  return d > 1e-12 ? (ux * vx + uy * vy + uz * vz) / d : 0;
}

// Index + middle up, ring + pinky down. The thumb is ignored: it is tucked in
// for a peace sign and loose for a smoker's hold, and both should count.
export function isTwoFingerPose(w, latched) {
  const up = latched ? POSE_UP_OFF : POSE_UP_ON;
  const down = latched ? POSE_DOWN_OFF : POSE_DOWN_ON;
  return fingerStraightness(w, INDEX_MCP) > up &&
         fingerStraightness(w, MIDDLE_MCP) > up &&
         fingerStraightness(w, RING_MCP) < down &&
         fingerStraightness(w, PINKY_MCP) < down;
}

// Bones used to measure the hand's on-screen scale. Summing several means no
// single foreshortened bone decides it.
const SCALE_BONES = [[0, 5], [0, 17], [5, 17], [5, 8], [9, 12]];

export function handPxPerMetre(pts, world) {
  if (!world) return dist(pts[WRIST], pts[MIDDLE_MCP]) / 0.095;
  let px = 0, m = 0;
  for (const [a, b] of SCALE_BONES) {
    px += dist(pts[a], pts[b]);
    m += Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y);
  }
  return m > 1e-6 ? px / m : dist(pts[WRIST], pts[MIDDLE_MCP]) / 0.095;
}

// Every tracked hand as screen points, its landmarks (metric when the tracker
// gives them), pixels per metre, palm length in landmark units, and a key that
// stays with the same hand from one frame to the next.
export function trackedHands(res, t) {
  const out = [], seen = new Set();
  const lms = res.landmarks || [];
  for (let i = 0; i < lms.length; i++) {
    const world = res.worldLandmarks && res.worldLandmarks[i];
    const label = res.handedness && res.handedness[i] && res.handedness[i][0];
    let key = label ? label.categoryName : "H";
    if (seen.has(key)) key += i;
    seen.add(key);
    const pts = smoothPoints(key, lms[i].map(toScreen), t);
    const w = world || lms[i];
    out.push({ pts, w, key, metric: !!world, scale: handPxPerMetre(pts, world),
               palm: d3(w[WRIST], w[MIDDLE_MCP]) || 1 });
  }
  return out;
}

// One-Euro filter (Casiez et al., CHI 2012) over a set of screen points: a
// low-pass whose cutoff rises with speed. A hand held still stops trembling
// with the tracker's pixel noise, and a fast one still keeps up, where a
// fixed smoothing would have to pick one or the other. Speed is in screen
// heights per second, so the feel is the same at any resolution. A set not
// seen for a moment starts fresh rather than gliding in from where it was.
const OE_MIN_CUTOFF = 1.6;       // Hz with the hand at rest
const OE_BETA = 6;               // extra Hz per screen height per second
const OE_D_CUTOFF = 1.2;         // Hz, for the speed estimate itself
const oneEuro = new Map();

const oeAlpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export function smoothPoints(key, pts, t) {
  const now = (t || 0) / 1000;
  let st = oneEuro.get(key);
  if (!st || st.p.length !== pts.length || now - st.t > 0.3 || now <= st.t) {
    st = { t: now, p: pts.map((p) => ({ x: p.x, y: p.y, vx: 0, vy: 0 })) };
    oneEuro.set(key, st);
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }
  const dt = now - st.t, H = canvas.height || 1, ad = oeAlpha(OE_D_CUTOFF, dt);
  st.t = now;
  return pts.map((p, i) => {
    const f = st.p[i];
    f.vx += ((p.x - f.x) / dt - f.vx) * ad;
    f.vy += ((p.y - f.y) / dt - f.vy) * ad;
    const a = oeAlpha(OE_MIN_CUTOFF + OE_BETA * Math.hypot(f.vx, f.vy) / H, dt);
    f.x += (p.x - f.x) * a;
    f.y += (p.y - f.y) * a;
    return { x: f.x, y: f.y };
  });
}

export const fingerUp = (w, mcp, latched) =>
  fingerStraightness(w, mcp) > (latched ? POSE_UP_OFF : POSE_UP_ON);
export const fingerDown = (w, mcp, latched) =>
  fingerStraightness(w, mcp) < (latched ? POSE_DOWN_OFF : POSE_DOWN_ON);

// The middle of the palm, from screen points.
export const palmCentre = (p) => ({
  x: (p[WRIST].x + p[INDEX_MCP].x + p[MIDDLE_MCP].x + p[PINKY_MCP].x) / 4,
  y: (p[WRIST].y + p[INDEX_MCP].y + p[MIDDLE_MCP].y + p[PINKY_MCP].y) / 4,
});

// Extended fingers, thumb excluded, from (world) landmarks.
export const openCount = (w) =>
  [INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP].filter((k) => fingerUp(w, k, true)).length;
