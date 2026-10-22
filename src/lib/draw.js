// Drawing helpers shared by the effects.

import { canvas, ctx } from "../core/stage.js";

// A tile of noise, drawn at a random offset each frame in "overlay" mode:
// grain that crawls like film rather than sitting on the image like a screen.
let grainTile = null;
export function filmGrain(bx, by, bw, bh, alpha) {
  if (!grainTile) {
    grainTile = document.createElement("canvas");
    grainTile.width = grainTile.height = 192;
    const g = grainTile.getContext("2d"), img = g.createImageData(192, 192);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() + Math.random() - 1) * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const pat = ctx.createPattern(grainTile, "repeat");
  const scale = Math.max(1, canvas.height / 900);
  pat.setTransform(new DOMMatrix([scale, 0, 0, scale, Math.random() * 192, Math.random() * 192]));
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();
}

// Light a bright thing throws onto the room: a wide, faint radial falloff in
// "screen" mode, so props sit in the scene rather than pasted on top of it.
export function spill(x, y, r, rgb, a) {
  if (a <= 0.004 || r < 1) return;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.3, `rgba(${rgb},${a * 0.4})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// Line widths and the like, in canvas pixels per 900px of screen height.
export const unit = () => canvas.height / 900;

// A glowing title card, centred on (x, y). Shared by the anime techniques.
export const jpFont = (s) => `700 ${s}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "MS Mincho", serif`;
export const latinFont = (s) => `600 ${s}px "Hiragino Sans", system-ui, sans-serif`;
export function titleCardAt(text, x, y, size, a, spacing, font, glow) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font(size);
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
  ctx.shadowColor = glow;
  ctx.shadowBlur = size * 0.4;
  ctx.fillStyle = "#f4f8ff";
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillText(text, x, y);
  ctx.restore();
}
