// The Portal's worlds, each drawn as fn(g, w, h, t) into a scratch canvas.
// Strange Portal reuses them.

import { cellHash } from "./math.js";

export const PORTAL_SCENES = ["Space", "Synthwave", "Sunset"];

function drawSpace(g, w, h, t) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#04050f");
  grad.addColorStop(0.6, "#0a0f2c");
  grad.addColorStop(1, "#1c1038");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  const neb = (fx, fy, r, color) => {
    const ng = g.createRadialGradient(w * fx, h * fy, 0, w * fx, h * fy, r);
    ng.addColorStop(0, color);
    ng.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = ng;
    g.fillRect(0, 0, w, h);
  };
  neb(0.3 + 0.03 * Math.sin(t * 0.0002), 0.35, Math.max(w, h) * 0.5,
      "rgba(120,60,220,0.16)");
  neb(0.75, 0.7 + 0.03 * Math.cos(t * 0.00025), Math.max(w, h) * 0.45,
      "rgba(40,190,200,0.13)");

  for (let L = 0; L < 3; L++) {
    const speed = 0.004 * (L + 1);
    const size = 0.8 + L * 0.7;
    for (let i = 0; i < 34; i++) {
      const x = (cellHash(i, L * 11 + 1) * w + t * speed) % w;
      const y = cellHash(i + 41, L * 7 + 3) * h;
      const tw = 0.45 + 0.55 * Math.sin(t * 0.003 + i * 1.9 + L);
      g.fillStyle = `rgba(255,255,255,${(0.35 + L * 0.16) * tw})`;
      g.beginPath();
      g.arc(x, y, size, 0, Math.PI * 2);
      g.fill();
    }
  }

  const period = 2800;
  const phase = (t % period) / period;
  if (phase < 0.16) {
    const epoch = Math.floor(t / period);
    const sx = w * (0.15 + 0.6 * cellHash(epoch, 5));
    const sy = h * (0.1 + 0.3 * cellHash(epoch, 9));
    const d = phase / 0.16;
    const len = w * 0.12;
    g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - d)})`;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(sx + d * w * 0.3, sy + d * h * 0.18);
    g.lineTo(sx + d * w * 0.3 - len, sy + d * h * 0.18 - len * 0.45);
    g.stroke();
  }
}

function drawSynthwave(g, w, h, t) {
  const horizon = h * 0.55;
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#12002e");
  sky.addColorStop(0.6, "#3c0663");
  sky.addColorStop(1, "#b3125e");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, horizon);

  const R = Math.min(w, h) * 0.24;
  const cx = w * 0.5, cy = horizon - R * 0.25;
  g.save();
  g.beginPath();
  g.rect(0, 0, w, horizon);
  g.clip();
  const sun = g.createLinearGradient(0, cy - R, 0, cy + R);
  sun.addColorStop(0, "#ffd319");
  sun.addColorStop(1, "#ff2975");
  g.fillStyle = sun;
  g.shadowColor = "rgba(255,60,140,0.8)";
  g.shadowBlur = R * 0.5;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  // Scanline cutouts drifting up through the sun.
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 6; i++) {
    const gap = R * (0.05 + i * 0.02);
    const yy = cy + R * 0.05 + i * R * 0.16 - ((t * 0.01) % (R * 0.16));
    g.fillRect(cx - R, yy, R * 2, gap * 0.5);
  }
  g.restore();

  g.fillStyle = "#0d0221";
  g.fillRect(0, horizon, w, h - horizon);
  g.strokeStyle = "rgba(255,42,109,0.75)";
  g.lineWidth = Math.max(1, w * 0.002);
  for (let k = -9; k <= 9; k++) {
    g.beginPath();
    g.moveTo(cx + k * w * 0.02, horizon);
    g.lineTo(cx + k * w * 0.16, h + 2);
    g.stroke();
  }
  for (let j = 0; j < 9; j++) {
    const z = (j / 9 + (t * 0.00035) % (1 / 9)) % 1;
    const y = horizon + z * z * (h - horizon);
    g.globalAlpha = 0.25 + 0.75 * z;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function drawSunset(g, w, h, t) {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#12224a");
  sky.addColorStop(0.45, "#7a3b6b");
  sky.addColorStop(0.75, "#d9713f");
  sky.addColorStop(1, "#f3c05a");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  const cy = h * 0.62;
  g.fillStyle = "rgba(255,226,150,0.95)";
  g.beginPath();
  g.arc(w * 0.5, cy, Math.min(w, h) * 0.16, 0, Math.PI * 2);
  g.fill();

  // Layered clouds drifting at different speeds for depth.
  for (let L = 0; L < 3; L++) {
    g.fillStyle = `rgba(${30 + L * 20},${20 + L * 14},${50 + L * 20},${0.5 - L * 0.12})`;
    for (let i = 0; i < 4; i++) {
      const cw2 = w * (0.3 + 0.16 * cellHash(i, L));
      const x = ((cellHash(i, L + 5) * w + t * (0.006 + L * 0.004)) % (w + cw2)) - cw2 / 2;
      const y = h * (0.18 + 0.22 * cellHash(i + 3, L + 1)) + L * h * 0.06;
      g.beginPath();
      g.ellipse(x, y, cw2 * 0.5, h * 0.035, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.fillStyle = "#1a1230";
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += 8) {
    g.lineTo(x, h * 0.8 + Math.sin(x * 0.01 + 1.2) * h * 0.05);
  }
  g.lineTo(w, h);
  g.fill();
}

export const PORTAL_SCENE_FNS = [drawSpace, drawSynthwave, drawSunset];
