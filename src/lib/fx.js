// The kit the gesture effects share: a frame clock, one screen shake and one
// pool of sparks. Only one effect runs at a time, so sharing them is safe; the
// runtime clears the shake and the sparks whenever the effect changes.

import { ctx } from "../core/stage.js";
import { unit } from "./draw.js";

export const gagSparks = [];
let gagLastT = 0;
export let shake = 0;                   // screen shake, canvas px; decays every frame

// Seconds since the last rendered frame (0 on the very first, capped at 50 ms
// so a stalled tab does not teleport everything). Call it once per render.
export function gagClock(t) {
  const dt = gagLastT ? Math.min(0.05, (t - gagLastT) / 1000) : 0;
  gagLastT = t;
  return dt;
}

// Screen shake, canvas px. Effects only ever raise it; tick decays it.
export function shakeScreen(px) {
  shake = Math.max(shake, px);
}

export function settleShake() {
  shake *= 0.86;
}

export function clearShake() {
  shake = 0;
}

// --- Shared sparks ----------------------------------------------------------

export function addSpark(x, y, ang, sp, life, g, color) {
  if (gagSparks.length > 600) return;
  gagSparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g, life, age: 0, color });
}

export function stepSparks(dt) {
  let n = 0;
  for (const p of gagSparks) {
    p.age += dt;
    if (p.age >= p.life) continue;
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    gagSparks[n++] = p;
  }
  gagSparks.length = n;
}

export function drawSparks() {
  if (!gagSparks.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, 2 * unit());
  for (const p of gagSparks) {
    ctx.globalAlpha = 1 - p.age / p.life;
    ctx.strokeStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
    ctx.stroke();
  }
  ctx.restore();
}

export function clearSparks() {
  gagSparks.length = 0;
}

// Steps a list of things that only age, dropping the expired ones.
export function ageOut(list, dt, life) {
  let n = 0;
  for (const p of list) {
    p.age += dt;
    if (p.age < (p.life || life)) list[n++] = p;
  }
  list.length = n;
}
