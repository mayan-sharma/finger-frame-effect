// What the frame looks like around any frame effect: glass and brackets.

import { canvas, ctx } from "./stage.js";
import { unit } from "../lib/draw.js";
import { quadCentroid } from "../lib/math.js";

// The frame as a pane of glass: a soft shadow outside it, a bright rim just
// inside, and a faint diagonal sheen across it that turns with the frame.
export function drawGlassEdge(q, alpha) {
  const u = unit();
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round";
  path();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 22 * u;
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 2 * u;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 9 * u;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1.3 * u;
  ctx.stroke();
  const a = q[0], b = q[2];
  const sheen = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  sheen.addColorStop(0.18, "rgba(255,255,255,0)");
  sheen.addColorStop(0.3, "rgba(255,255,255,0.07)");
  sheen.addColorStop(0.36, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fill();
  ctx.restore();
}

// Frame overlay: corner brackets so the frame reads as a "camera"

export function drawBrackets(q, alpha) {
  const c = quadCentroid(q);
  ctx.save();
  ctx.globalAlpha = alpha * 0.9;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(2, canvas.width * 0.0022);
  ctx.lineCap = "round";
  const arm = Math.max(14, canvas.width * 0.018);
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const prev = q[(i + 3) % 4];
    const next = q[(i + 1) % 4];
    for (const other of [prev, next]) {
      const dx = other.x - p.x, dy = other.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + (dx / len) * arm, p.y + (dy / len) * arm);
      ctx.stroke();
    }
    // small dot toward the centroid
    ctx.beginPath();
    ctx.arc(p.x + (c.x - p.x) * 0.02, p.y + (c.y - p.y) * 0.02, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
