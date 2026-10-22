// The mouth, from face landmarks: updated before a needs.face effect runs.

import { fctx, frame, toScreen } from "../core/stage.js";
import { DEMO_SKIN } from "./demo-props.js";
import { clamp01, dist } from "./math.js";

// Face mesh indices: inner-lip centres and the outer mouth corners.
const LIP_UP = 13, LIP_LO = 14, MOUTH_L = 61, MOUTH_R = 291;

// Mouth-open ratio = lip gap / mouth width. Talking and a toothy grin both
// peak around 0.2, so the latch sits above that and lets go below it.
const MOUTH_ON = 0.28, MOUTH_OFF = 0.16, MOUTH_SPAN = 0.3;

// The inner-lip loop (upper lip left to right, then the lower lip back).
// Rainbow fills it, so the stream starts inside the mouth rather than
// hanging off the lips.
const LIPS_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308,
                    324, 318, 402, 317, 14, 87, 178, 88, 95];

export const mouth = {
  seen: false, lost: 0, latched: false, open: 0, breath: 1,
  x: 0, y: 0, w: 1, gap: 0, dir: Math.PI / 2,
  poly: null, iw: 1,            // inner-lip outline and its width (Rainbow)
};

// Screen-space lips in, mouth state out. `up`/`lo` are the inner-lip centres;
// `poly` is the inner-lip outline, left corner first and right corner at [10].
function applyMouth(up, lo, left, right, poly) {
  const w = Math.max(1, dist(left, right));
  const gap = dist(up, lo);
  const ratio = gap / w;
  mouth.ratio = ratio;
  mouth.latched = ratio > (mouth.latched ? MOUTH_OFF : MOUTH_ON);
  mouth.open = mouth.latched ? clamp01((ratio - MOUTH_OFF) / MOUTH_SPAN) : 0;
  mouth.x = (up.x + lo.x) / 2;
  mouth.y = (up.y + lo.y) / 2;
  mouth.w = w;
  mouth.gap = gap;
  mouth.poly = poly || null;
  mouth.iw = poly ? dist(poly[0], poly[10]) : w * 0.8;
  // Upper lip -> lower lip is "down the face", which is where breath goes,
  // and it stays right when the head is tilted.
  if (mouth.latched) mouth.dir = Math.atan2(lo.y - up.y, lo.x - up.x);
  mouth.seen = true;
  mouth.lost = 0;
}

export function updateMouth(res) {
  const f = res.faceLandmarks && res.faceLandmarks[0];
  if (!f) {
    if (++mouth.lost > 10) { mouth.seen = false; mouth.latched = false; mouth.open = 0; }
    return;
  }
  applyMouth(toScreen(f[LIP_UP]), toScreen(f[LIP_LO]),
             toScreen(f[MOUTH_L]), toScreen(f[MOUTH_R]),
             LIPS_INNER.map((i) => toScreen(f[i])));
}

// Demo stand-ins for the camera, painted onto the frame and fed through the
// same code paths as live tracking: a face whose mouth opens and shuts...
export function demoFace(t) {
  const w = frame.width, h = frame.height;
  const m = h / 0.55;                       // pixels per metre

  // Swaying, so whatever comes out of the mouth has to follow a moving head.
  const fcx = w * 0.4 + Math.sin(t * 0.0021) * w * 0.025, fcy = h * 0.4;
  fctx.fillStyle = DEMO_SKIN;
  fctx.beginPath();
  fctx.ellipse(fcx, fcy, m * 0.075, m * 0.098, 0, 0, Math.PI * 2);
  fctx.fill();
  fctx.fillStyle = "#2a1f1c";
  for (const sx of [-1, 1]) {
    fctx.beginPath();
    fctx.arc(fcx + sx * m * 0.03, fcy - m * 0.02, m * 0.007, 0, Math.PI * 2);
    fctx.fill();
  }
  const open = Math.max(0, Math.sin(t * 0.0011));
  const mw = m * 0.05, gap = m * 0.028 * open;
  const my = fcy + m * 0.045;
  fctx.fillStyle = "#4a1f22";
  fctx.beginPath();
  fctx.ellipse(fcx, my, mw * 0.4, Math.max(m * 0.003, gap / 2), 0, 0, Math.PI * 2);
  fctx.fill();
  // Same winding as LIPS_INNER: left corner, over the top, right corner, back.
  const poly = [];
  for (let k = 0; k < 20; k++) {
    const a = Math.PI + k * Math.PI / 10;
    poly.push({ x: fcx + Math.cos(a) * mw * 0.4, y: my + Math.sin(a) * gap / 2 });
  }
  applyMouth({ x: fcx, y: my - gap / 2 }, { x: fcx, y: my + gap / 2 },
             { x: fcx - mw / 2, y: my }, { x: fcx + mw / 2, y: my }, poly);
  return { x: fcx, y: fcy, m };
}
