// The frame loop: feed in, trackers, the finger frame, then the live effect.

import { demoQuad, drawDemoScene } from "./demo.js";
import { demoMode } from "./env.js";
import { drawBrackets, drawGlassEdge } from "./frame-chrome.js";
import { refreshKnobReadout, updateKnobs } from "./knobs.js";
import { computeQuad, presence, smoothQuad, updateQuadState } from "./quad.js";
import { currentEffect, cycleVariant, setEffect, currentIndex, wantsMask } from "./runtime.js";
import { canvas, computeFit, ctx, fctx, fit, frame, video } from "./stage.js";
import { detectSwipe } from "./swipe.js";
import { flashStatus, setStatus } from "./ui.js";
import { cameraReady, faceLandmarker, faceState, landmarker, segState, segmenter, writeMask } from "./vision.js";
import { demoFace, mouth, updateMouth } from "../lib/face.js";
import { settleShake, shake } from "../lib/fx.js";
import { quadCentroid } from "../lib/math.js";

let lastVideoTime = -1;
let announcedTracking = false;

export function tick(t) {
  requestAnimationFrame(tick);
  computeFit();
  // The effect this frame started on. A swipe can change the selection part
  // way through; the rest of this frame still finishes the old one.
  const fx = currentEffect();
  const overlayFx = fx.kind === "overlay";
  let overlaySeen = false;

  // 1. Refresh the frame canvas (mirrored camera or demo scene)
  if (demoMode) {
    drawDemoScene(t);
    const face = fx.needs.face ? demoFace(t) : null;
    if (fx.demo) fx.demo(t, face);
  } else if (cameraReady && video.readyState >= 2) {
    fctx.save();
    fctx.setTransform(-fit.s, 0, 0, fit.s, fit.ox + fit.s * fit.vw, fit.oy);
    fctx.drawImage(video, 0, 0);
    fctx.restore();
  } else {
    fctx.fillStyle = "#0b0d10";
    fctx.fillRect(0, 0, frame.width, frame.height);
  }

  // 2. Detect the finger frame
  let raw = null;
  if (demoMode) {
    // Synthetic quad, with dropout windows to exercise fade in/out.
    raw = (!overlayFx && Math.sin(t * 0.0002) > -0.85) ? demoQuad(t) : null;
  } else if (landmarker && cameraReady && video.readyState >= 2) {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const res = landmarker.detectForVideo(video, t);
      if (overlayFx) {
        if (fx.hands) fx.hands(res, t);
        if (fx.needs.face && faceState === "ready") {
          const face = faceLandmarker.detectForVideo(video, t);
          updateMouth(face);
          if (fx.face) fx.face(face, t);
        }
        overlaySeen = !!(res.landmarks && res.landmarks.length) || mouth.seen;
      } else {
        raw = computeQuad(res.landmarks);
      }
      // A gesture that moves like a swipe (twisting time, throwing a Spirit
      // Bomb) must not also change the effect.
      const swiped = detectSwipe(res.landmarks, t);
      const swipe = fx.locksSwipe && fx.locksSwipe() ? null : swiped;
      if (swipe === "right" || swipe === "left") {
        setEffect(currentIndex() + (swipe === "right" ? 1 : -1), { repeatCycles: false });
        flashStatus(`${swipe === "right" ? "▶" : "◀"} ${currentEffect().name}`);
      } else if (swipe) {
        // Vertical slides walk the current effect's variant, so the two axes
        // read as "which effect" and "which variant of it".
        if (!cycleVariant(swipe === "up" ? 1 : -1)) flashStatus(`${currentEffect().name} has no variants`);
      }
      // Only segment when an effect actually needs the person mask.
      if (wantsMask(currentEffect()) && segState === "ready") {
        segmenter.segmentForVideo(video, t, writeMask);
      }
    } else if (smoothQuad) {
      raw = null; // no new video frame; treat as a (buffered) dropout
    }
  }
  updateQuadState(raw);
  // Dials come off the smoothed quad, not the popped-in one: the pop is a
  // presentation flourish and would otherwise read as someone yanking the
  // size dial every time a frame appears.
  const framed = presence > 0.01 && smoothQuad;
  updateKnobs(framed ? smoothQuad : null);
  refreshKnobReadout(!!framed);

  if ((raw || overlaySeen) && !announcedTracking && !demoMode) {
    announcedTracking = true;
    setStatus(null);
  }

  // 3. Composite
  ctx.imageSmoothingEnabled = true;
  if (shake > 0.5) {
    // Kick: the feed is drawn a little oversized and jolted inside it.
    const a = Math.random() * Math.PI * 2;
    ctx.drawImage(frame, -shake + Math.cos(a) * shake, -shake + Math.sin(a) * shake,
                  canvas.width + 2 * shake, canvas.height + 2 * shake);
  } else {
    ctx.drawImage(frame, 0, 0);
  }
  settleShake();

  if (!overlayFx && presence > 0.01 && smoothQuad) {
    const ease = presence * presence * (3 - 2 * presence); // smoothstep
    // Pop-in: scale the quad from its centroid as it fades in.
    const c = quadCentroid(smoothQuad);
    const s = 0.85 + 0.15 * ease;
    const q = smoothQuad.map((p) => ({
      x: c.x + (p.x - c.x) * s,
      y: c.y + (p.y - c.y) * s,
    }));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of q) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const bx = Math.max(0, Math.floor(minX));
    const by = Math.max(0, Math.floor(minY));
    const bw = Math.min(canvas.width, Math.ceil(maxX)) - bx;
    const bh = Math.min(canvas.height, Math.ceil(maxY)) - by;

    if (bw > 8 && bh > 8) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
      ctx.closePath();
      ctx.clip();
      ctx.globalAlpha = ease;
      // The live selection: after a swipe this frame it may be an overlay,
      // which has nothing to draw in the frame.
      const live = currentEffect();
      if (live.draw) live.draw({ x: bx, y: by, w: bw, h: bh, quad: q }, t);
      ctx.restore();

      drawGlassEdge(q, ease);
      drawBrackets(q, ease);
    }
  }

  if (fx.render) fx.render(t);
}
