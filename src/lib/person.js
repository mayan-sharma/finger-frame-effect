// Drawing with the person mask: you, cut out of the feed.

import { canvas, ctx, fit, frame, makeScratch, sizeScratch } from "../core/stage.js";
import { maskCanvas, maskImageData, maskReady, segState } from "../core/vision.js";
import { unit } from "./draw.js";

const sPerson = makeScratch(false);
const sVoidAura = makeScratch(false);
const sVoidPerson = makeScratch(false);

// Draws the live person (segmentation mask) over whatever is already in the
// box, so an effect can be placed behind them.
export function drawPersonOver(bx, by, bw, bh) {
  if (!maskReady || segState !== "ready") return;
  const p = sizeScratch(sPerson, bw, bh);
  p.save();
  p.clearRect(0, 0, bw, bh);
  p.drawImage(frame, bx, by, bw, bh, 0, 0, bw, bh);
  p.globalCompositeOperation = "destination-in";
  p.filter = "blur(3px)";            // soften the mask edge
  p.translate(-bx, -by);
  p.transform(-fit.s, 0, 0, fit.s, fit.ox + fit.s * fit.vw, fit.oy);
  p.scale(fit.vw / maskCanvas.width, fit.vh / maskCanvas.height);
  p.drawImage(maskCanvas, 0, 0);
  p.restore();

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = Math.max(10, bw * 0.03);
  ctx.drawImage(sPerson.c, bx, by);
  ctx.restore();
}

export function maskAvailable() {
  return maskReady && maskImageData && maskCanvas.width > 1;
}

// Draws a mask-space canvas onto `g` in canvas space, the way the feed is
// drawn: covered, centred and mirrored.
// `k` scales the result, for a target smaller than the canvas.
export function drawMaskSpace(g, src, blurPx, k = 1) {
  g.save();
  if (blurPx) g.filter = `blur(${blurPx}px)`;
  g.setTransform(-fit.s * fit.vw / src.width * k, 0, 0, fit.s * fit.vh / src.height * k,
                 (fit.ox + fit.s * fit.vw) * k, fit.oy * k);
  g.drawImage(src, 0, 0);
  g.restore();
}

// You, cut out of the feed, in front of the void, with an aura (blue by
// default; Time Stone uses green).
export function drawVoidPerson(color = "#7fc0ff") {
  if (!maskAvailable()) return;
  const W = canvas.width, H = canvas.height, u = unit();
  const aura = sizeScratch(sVoidAura, W, H);
  aura.globalCompositeOperation = "copy";
  aura.fillStyle = color;
  aura.fillRect(0, 0, W, H);
  aura.globalCompositeOperation = "destination-in";
  drawMaskSpace(aura, maskCanvas, 22 * u);
  aura.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.7 + 0.15 * Math.sin(performance.now() * 0.004);
  ctx.drawImage(sVoidAura.c, 0, 0);
  ctx.drawImage(sVoidAura.c, 0, 0);
  ctx.restore();

  const p = sizeScratch(sVoidPerson, W, H);
  p.globalCompositeOperation = "copy";
  p.drawImage(frame, 0, 0);
  p.globalCompositeOperation = "destination-in";
  drawMaskSpace(p, maskCanvas, 2 * u);
  p.globalCompositeOperation = "source-over";
  ctx.drawImage(sVoidPerson.c, 0, 0);
}
