// The effect API: everything an effect module may import. The built-in
// effects use nothing else, so every one of them is a working example.
// docs/EFFECTS.md walks through writing one.
//
// Coordinates are canvas pixels with the image mirrored like a mirror, unless
// a name says otherwise. Hand landmarks arrive in MediaPipe's normalized
// video space; `toScreen` (or `trackedHands`) turns them into canvas pixels.

// --- Defining an effect -------------------------------------------------------
// See src/core/registry.js for every field and hook.
export { defineEffect } from "./core/registry.js";

// --- Canvases ---------------------------------------------------------------
// ctx      the stage you draw on (canvas = its <canvas>).
// frame    this frame's camera image (or demo scene) at stage size: read from
//          it, and draw it back processed. fctx paints into it, which is how
//          the ?demo stand-ins put a face or a hand into the "camera".
// makeScratch / sizeScratch   a reusable offscreen canvas: make one per
//          layer at module level, size it each frame, draw into its `.g`.
// fit / toScreen   the video -> canvas mapping, and one landmark through it.
export { canvas, ctx, fctx, fit, frame, makeScratch, sizeScratch, toScreen } from "./core/stage.js";

// --- The finger frame -----------------------------------------------------------
// knobs       { size, tilt, aspect, punch }: the frame read as four dials.
//             size 0..1 (hands apart), tilt -1..1 (rotate the frame),
//             aspect -1..1 (squash it wide or tall), punch 0..1 (a fast
//             squeeze; decays). Frame effects should read at least one.
// smoothQuad  the frame's four corners [TL, TR, BR, BL], or null when down.
// presence    0..1, how far the frame has faded in.
export { knobs } from "./core/knobs.js";
export { presence, smoothQuad } from "./core/quad.js";

// --- The page ----------------------------------------------------------------
// demoMode is true with ?demo (or when no camera could start). urlParams is
// the page's query string, for an effect's own options.
export { demoMode, urlParams } from "./core/env.js";
export { flashStatus, setStatus } from "./core/ui.js";

// --- Hands -------------------------------------------------------------------
// MediaPipe hand landmark indices, and helpers that measure in palm lengths
// (wrist -> middle knuckle) so a threshold holds at any distance from camera.
//   trackedHands(res, t)  every hand as { pts (canvas px, smoothed), w
//                         (landmarks, metric when available), key (stable
//                         per hand), scale (px per metre), palm }.
//   fingerUp / fingerDown(w, mcp, latched)  one finger extended / curled,
//                         with hysteresis: pass whether you were latched.
//   openCount(w)          extended fingers, thumb excluded.
//   palmCentre(pts)       the middle of the palm.
//   KAME_PUSH             relative hand growth per second that reads as a
//                         shove toward the camera.
export {
  INDEX_MCP, INDEX_TIP, MIDDLE_MCP, PINKY_MCP, RING_MCP, THUMB_IP, THUMB_TIP, WRIST,
} from "./lib/landmarks.js";
export {
  FINGER_W_M, fingerDown, fingerStraightness, fingerUp, handPxPerMetre, isTwoFingerPose,
  KAME_PUSH, openCount, palmCentre, POSE_DOWN_OFF, POSE_DOWN_ON, smoothPoints, trackedHands,
} from "./lib/hands.js";

// --- Face --------------------------------------------------------------------
// With `needs: { face: true }`, `mouth` is kept up to date before your hooks
// run: { seen, latched (open wide), open 0..1, x, y, w, dir, poly, ... }.
export { mouth } from "./lib/face.js";

// --- The person mask ---------------------------------------------------------
// With `needs: { mask: true }`, maskCanvas holds the selfie segmentation
// (white = you, in video space). These draw with it:
//   drawPersonOver(x, y, w, h)  you, cut out, over whatever is in that box.
//   drawVoidPerson(color)       you over the whole stage, with a glow.
//   drawMaskSpace(g, src, blur) the mask, mapped into a scratch canvas.
export { maskCanvas, maskImageData } from "./core/vision.js";
export { drawMaskSpace, drawPersonOver, drawVoidPerson, maskAvailable } from "./lib/person.js";

// --- Drawing kit ---------------------------------------------------------------
// unit()       canvas px per 900 px of screen height: scale line widths by it.
// spill(...)   the light a bright thing throws on the room ("screen" blend).
// filmGrain    crawling film grain over a box.
// titleCardAt  big spaced-out title text (jpFont / latinFont pick the face).
// PORTAL_SCENES / PORTAL_SCENE_FNS   the Portal's worlds: fn(g, w, h, t).
export { filmGrain, jpFont, latinFont, spill, titleCardAt, unit } from "./lib/draw.js";
export { PORTAL_SCENE_FNS, PORTAL_SCENES } from "./lib/scenes.js";

// --- Gesture-effect kit ----------------------------------------------------------
// gagClock(t)      seconds since your last render: call once per render(t).
// shakeScreen(px)  kick the whole feed; it settles by itself.
// addSpark / stepSparks / drawSparks   one shared pool of sparks.
// ageOut(list, dt, life)   age a list of { age } things, drop expired ones.
// emitSmoke / stepSmoke / drawSmoke    soft smoke particles (smokeParts).
// comicPops / drawPops / POP_S         "BANG!"-style comic words.
export { addSpark, ageOut, drawSparks, gagClock, shakeScreen, stepSparks } from "./lib/fx.js";
export { drawSmoke, emitSmoke, smokeParts, stepSmoke } from "./lib/smoke.js";
export { comicPops, drawPops, POP_S } from "./lib/comic.js";

// --- Sound ---------------------------------------------------------------------
// Synthesized, so there are no files to ship. Silent until the first click or
// key press (a browser rule), and when muted (`m`).
//   playSound(name, { volume, pitch, pan, delay, duration })  a one-shot.
//       pan: a canvas x, so the sound comes from where it happens.
//       reverb: 0..1 into a shared hall (big sounds have some by default).
//       Returns false if nothing played. A recording listed in
//       sounds/sounds.json under the same name plays instead.
//   hum(name, level 0..1, pitch)  a held sound; call every frame. It fades
//       out once you stop calling. Names: charge, laser, rumble, drone.
//   SOUNDS: every one-shot name (bang, tink, snikt, whoosh, slash, snap,
//       thwip, boom, blast, shutter, poof, stretch, boing, thud, shimmer,
//       crackle, flick, rewind, gong, swell, click).
export { hum, playSound, SOUNDS } from "./lib/sound.js";

// --- Demo stand-ins ------------------------------------------------------------
// For your demo(t) hook: paint a hand blob or a whole person into the frame.
// demoPerson also writes a matching person mask.
export { DEMO_SKIN, demoBlob, demoPerson } from "./lib/demo-props.js";

// --- Math ---------------------------------------------------------------------
export {
  cellHash, clamp, clamp01, d3, dist, lerpPt, quadCentroid, rayToEdge, smoothstep,
} from "./lib/math.js";
