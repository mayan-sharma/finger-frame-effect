// Stand-ins for ?demo: hands and a person painted into the camera frame,
// so effects can be seen (and tested) without a camera.

import { fctx, frame } from "../core/stage.js";
import { commitMask, maskCanvas, maskCtx } from "../core/vision.js";
import { FINGER_W_M } from "./hands.js";

// A plain fist-and-finger blob for the demo hands.
export function demoBlob(x, y, m, rot, fingers) {
  fctx.save();
  fctx.fillStyle = fctx.strokeStyle = DEMO_SKIN;
  fctx.beginPath();
  fctx.ellipse(x, y, m * 0.045, m * 0.05, rot, 0, Math.PI * 2);
  fctx.fill();
  fctx.lineWidth = FINGER_W_M * m;
  fctx.lineCap = "round";
  for (const [a, l] of fingers) {
    fctx.beginPath();
    fctx.moveTo(x + Math.cos(a) * m * 0.03, y + Math.sin(a) * m * 0.03);
    fctx.lineTo(x + Math.cos(a) * m * l, y + Math.sin(a) * m * l);
    fctx.stroke();
  }
  fctx.restore();
}

// A person-shaped silhouette, written into the frame and into the mask, so
// the dissolve has a body and a background plate to work with.
// A person-shaped silhouette with one hand up at (hx, hy), painted into the
// frame and written into the mask, for the effects that cut you out.
export function demoPerson(t, handAt) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const cx = w * 0.42, sway = Math.sin(t * 0.0009) * w * 0.01;
  const body = (g) => {
    g.beginPath();
    g.ellipse(cx + sway, h * 0.33, m * 0.075, m * 0.095, 0, 0, Math.PI * 2);
    g.moveTo(cx + sway - m * 0.2, h * 1.02);
    g.bezierCurveTo(cx + sway - m * 0.21, h * 0.62, cx + sway - m * 0.12, h * 0.52, cx + sway, h * 0.52);
    g.bezierCurveTo(cx + sway + m * 0.12, h * 0.52, cx + sway + m * 0.21, h * 0.62, cx + sway + m * 0.2, h * 1.02);
    g.closePath();
    g.fill();
  };
  fctx.fillStyle = "#3a6ea5";
  body(fctx);
  fctx.fillStyle = DEMO_SKIN;
  fctx.beginPath();
  fctx.ellipse(cx + sway, h * 0.33, m * 0.075, m * 0.095, 0, 0, Math.PI * 2);
  fctx.fill();
  const { x: hx, y: hy, fingers } = handAt(cx + sway, m);
  demoBlob(hx, hy, m, -1.2, fingers);

  const mw = 160, mh = 90;
  if (maskCanvas.width !== mw || maskCanvas.height !== mh) { maskCanvas.width = mw; maskCanvas.height = mh; }
  maskCtx.setTransform(-mw / w, 0, 0, mh / h, mw, 0);   // mask space is unmirrored
  maskCtx.clearRect(0, 0, w, h);
  maskCtx.fillStyle = "#fff";
  body(maskCtx);
  maskCtx.beginPath();
  maskCtx.ellipse(hx, hy, m * 0.06, m * 0.07, 0, 0, Math.PI * 2);
  maskCtx.fill();
  maskCtx.setTransform(1, 0, 0, 1, 0, 0);
  commitMask();
  return { hx, hy, m };
}

export const DEMO_SKIN = "#d9a27e";
