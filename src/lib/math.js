// Small geometry and easing helpers.

import { canvas } from "../core/stage.js";

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function polyArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

function segsIntersect(a, b, c, d) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b);
  const d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// A "bowtie" quad has opposite edges crossing.
export const isBowtie = (q) =>
  segsIntersect(q[0], q[1], q[2], q[3]) || segsIntersect(q[1], q[2], q[3], q[0]);

export function quadCentroid(q) {
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);

// Deterministic per-cell hash, so glitch bands are stable within a burst.
export function cellHash(i, j) {
  const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export const lerpPt = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

export const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

// Distance along unit (dx, dy) from (x, y) to the edge of the canvas.
export function rayToEdge(x, y, dx, dy) {
  let k = Infinity;
  if (dx > 1e-6) k = Math.min(k, (canvas.width - x) / dx);
  if (dx < -1e-6) k = Math.min(k, -x / dx);
  if (dy > 1e-6) k = Math.min(k, (canvas.height - y) / dy);
  if (dy < -1e-6) k = Math.min(k, -y / dy);
  return Number.isFinite(k) ? Math.max(0, k) : 0;
}

export const smoothstep = (a, b, v) => { const k = clamp01((v - a) / (b - a)); return k * k * (3 - 2 * k); };
