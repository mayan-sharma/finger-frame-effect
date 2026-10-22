// The stage canvas, the camera frame every effect samples, and the mapping
// from the video to the screen.

import { demoMode } from "./env.js";

export const canvas = document.getElementById("stage");
export const ctx = canvas.getContext("2d");
export const video = document.getElementById("cam");

// Offscreen canvas holding the mirrored camera frame (or demo scene) at
// canvas resolution. All effects sample from this.
export const frame = document.createElement("canvas");
export const fctx = frame.getContext("2d");

// Reusable scratch canvases for effects (resized lazily).
export function makeScratch(readFrequently) {
  const c = document.createElement("canvas");
  return { c, g: c.getContext("2d", readFrequently ? { willReadFrequently: true } : undefined) };
}

export function sizeScratch(s, w, h) {
  if (s.c.width !== w || s.c.height !== h) { s.c.width = w; s.c.height = h; }
  return s.g;
}

// Video -> canvas "cover" mapping (recomputed per frame)
export const fit = { s: 1, ox: 0, oy: 0, vw: 1, vh: 1 };

export function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  frame.width = canvas.width;
  frame.height = canvas.height;
}

export function computeFit() {
  const vw = demoMode ? canvas.width : (video.videoWidth || 1280);
  const vh = demoMode ? canvas.height : (video.videoHeight || 720);
  const s = Math.max(canvas.width / vw, canvas.height / vh);
  fit.s = s;
  fit.vw = vw;
  fit.vh = vh;
  fit.ox = (canvas.width - vw * s) / 2;
  fit.oy = (canvas.height - vh * s) / 2;
}

// Normalized landmark -> mirrored canvas coordinates.
export function toScreen(lm) {
  return {
    x: fit.ox + fit.s * (fit.vw - lm.x * fit.vw),
    y: fit.oy + fit.s * (lm.y * fit.vh),
  };
}
