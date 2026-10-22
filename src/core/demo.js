// ?demo: a synthetic scene and a synthetic finger frame, for working without
// a camera. Effects add their own stand-ins in their demo() hooks.

import { canvas, fctx, frame } from "./stage.js";

export function drawDemoScene(t) {
  const w = frame.width, h = frame.height;
  const grad = fctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#1a2b4a");
  grad.addColorStop(0.55, "#4a3b6b");
  grad.addColorStop(0.75, "#c96f4a");
  grad.addColorStop(1, "#e8b44a");
  fctx.fillStyle = grad;
  fctx.fillRect(0, 0, w, h);

  // Sun
  fctx.fillStyle = "#ffd98a";
  fctx.beginPath();
  fctx.arc(w * 0.72, h * 0.62, h * 0.09, 0, Math.PI * 2);
  fctx.fill();

  // Rolling hills
  fctx.fillStyle = "#22333f";
  fctx.beginPath();
  fctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 16) {
    fctx.lineTo(x, h * 0.78 + Math.sin(x * 0.004 + 1.5) * h * 0.06);
  }
  fctx.lineTo(w, h);
  fctx.fill();
  fctx.fillStyle = "#141f27";
  fctx.beginPath();
  fctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 16) {
    fctx.lineTo(x, h * 0.88 + Math.sin(x * 0.006 - 0.6) * h * 0.05);
  }
  fctx.lineTo(w, h);
  fctx.fill();

  // Drifting orbs so motion is visible inside effects
  const colors = ["#ff6b6b", "#4ecdc4", "#ffe66d", "#95e1d3"];
  for (let i = 0; i < 4; i++) {
    const px = w * (0.2 + 0.6 * ((Math.sin(t * 0.00023 + i * 1.7) + 1) / 2));
    const py = h * (0.15 + 0.4 * ((Math.cos(t * 0.00031 + i * 2.3) + 1) / 2));
    fctx.fillStyle = colors[i];
    fctx.beginPath();
    fctx.arc(px, py, h * 0.03 + i * 4, 0, Math.PI * 2);
    fctx.fill();
  }
}

export function demoQuad(t) {
  const w = canvas.width, h = canvas.height;
  const cx = w * 0.5 + Math.sin(t * 0.0004) * w * 0.12;
  const cy = h * 0.45 + Math.cos(t * 0.0005) * h * 0.08;
  // Ranges are wide enough to sweep the size / tilt / aspect dials through
  // most of their travel, so `?demo` exercises the knobs too.
  const hw = w * (0.15 + 0.10 * Math.sin(t * 0.0007));
  const hh = h * (0.17 + 0.09 * Math.cos(t * 0.0006));
  const rot = Math.sin(t * 0.0003) * 0.45;
  const c = Math.cos(rot), s = Math.sin(rot);
  const pt = (dx, dy) => ({ x: cx + dx * c - dy * s, y: cy + dx * s + dy * c });
  return [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)];
}
