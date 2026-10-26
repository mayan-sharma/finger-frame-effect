// The camera and the MediaPipe trackers: hands always, and the face tracker
// and the person segmenter on demand. Everything loads from a CDN at runtime
// and runs on this device.

import { demoMode } from "./env.js";
import { video } from "./stage.js";
import { flashStatus } from "./ui.js";

// CDNs are tried in order. jsdelivr is the usual first choice, but it is
// blocked or TLS-untrusted on some networks and machines, which fails the
// dynamic import — so every CDN-loaded module falls back rather than leaving
// the app dead. `pickCdn` remembers whichever host answered first.
const CDNS = ["https://cdn.jsdelivr.net/npm/", "https://unpkg.com/"];
let cdnBase = null;

// Resolve a package path against the first CDN that serves it.
async function pickCdn(probePath) {
  if (cdnBase) return cdnBase;
  for (const base of CDNS) {
    try {
      const res = await fetch(base + probePath, { method: "HEAD" });
      if (res.ok) { cdnBase = base; return base; }
    } catch (err) {
      console.warn("CDN unreachable:", base, err.message);
    }
  }
  cdnBase = CDNS[0];      // nothing answered; let the real load report why
  return cdnBase;
}

// The person mask (selfie segmentation), for effects with needs.mask.
const SEG_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/" +
  "selfie_segmenter/float16/latest/selfie_segmenter.tflite";

// Face landmarks, for effects with needs.face (the mouth, the eyes).
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/" +
  "face_landmarker/float16/1/face_landmarker.task";

export let landmarker = null;
export let cameraReady = false;

// Person segmentation, started by the first effect that needs it.
let visionLib = null;
export let segmenter = null;
export let segState = "idle";          // idle | loading | ready | error
export let maskReady = false;

export const maskCanvas = document.createElement("canvas");
export const maskCtx = maskCanvas.getContext("2d");
export let maskImageData = null;

// Face tracking, likewise.
export let faceLandmarker = null;
export let faceState = "idle";         // idle | loading | ready | error

// The tasks-vision module and its wasm fileset are shared by the hand
// tracker and the segmenter; loading them twice would download the runtime
// twice for no reason.
const VISION_PATH = "@mediapipe/tasks-vision@0.10.14/";

// Models are created one at a time. Creating two GPU graphs at once (the
// hand tracker still loading when a face effect asks for its model, say)
// can fail in the wasm runtime, so every create waits for the last.
let visionQueue = Promise.resolve();
function createSerially(make) {
  const run = visionQueue.then(make, make);
  visionQueue = run.catch(() => {});
  return run;
}

// GPU first; if that graph will not start on this machine, the CPU one is
// slower but works.
async function createWithFallback(what, make) {
  try {
    return await createSerially(() => make("GPU"));
  } catch (gpuErr) {
    console.warn(`${what} on GPU failed, retrying on CPU:`, gpuErr);
    return await createSerially(() => make("CPU"));
  }
}

const errText = (err) => String((err && err.message) || err || "unknown error").slice(0, 80);

// One load shared by every caller, including ones that arrive while it is
// still in flight; a failed load is forgotten so the next caller retries.
let visionLoading = null;
function loadVision() {
  if (visionLib) return Promise.resolve(visionLib);
  if (!visionLoading) {
    visionLoading = (async () => {
      const base = (await pickCdn(VISION_PATH + "vision_bundle.mjs")) + VISION_PATH;
      const mod = await import(/* @vite-ignore */ base + "vision_bundle.mjs");
      const fileset = await mod.FilesetResolver.forVisionTasks(base + "wasm");
      visionLib = { mod, fileset };
      return visionLib;
    })().catch((err) => { visionLoading = null; throw err; });
  }
  return visionLoading;
}

export async function initTracker() {
  const { mod, fileset } = await loadVision();
  landmarker = await createWithFallback("Hand tracker", (delegate) => mod.HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate,
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  }));
}

export async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  cameraReady = true;
}

// --- Selfie segmentation ---------------------------------------------------

// A failed load is not final: selecting the effect again retries it.
export async function ensureSegmenter() {
  if (demoMode || segState === "loading" || segState === "ready") return;
  segState = "loading";
  try {
    const { mod, fileset } = await loadVision();
    segmenter = await createWithFallback("Segmenter", (delegate) => mod.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: SEG_MODEL_URL, delegate },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    }));
    segState = "ready";
  } catch (err) {
    console.warn("Segmenter unavailable:", err);
    segState = "error";
    flashStatus(`Person mask unavailable (${errText(err)}) — reselect the effect to retry`, 5000);
  }
}

// Copies the confidence mask into maskCanvas (video space, white = person,
// confidence in alpha) so it can be used as a clip source.
export function writeMask(result) {
  const m = result.confidenceMasks && result.confidenceMasks[0];
  if (!m) return;
  const mw = m.width, mh = m.height;
  const conf = m.getAsFloat32Array();
  if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
    maskCanvas.width = mw;
    maskCanvas.height = mh;
    maskImageData = maskCtx.createImageData(mw, mh);
  }
  const px = maskImageData.data;
  for (let i = 0, p = 0; i < conf.length; i++, p += 4) {
    px[p] = 255; px[p + 1] = 255; px[p + 2] = 255;
    px[p + 3] = (conf[i] * 255) | 0;
  }
  maskCtx.putImageData(maskImageData, 0, 0);
  maskReady = true;
}

// Publishes whatever was drawn into maskCanvas directly (the demo stand-ins).
export function commitMask() {
  maskImageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  maskReady = true;
}

// --- Face landmarks (the mouth for Smoke and Rainbow, eyes for Laser Eyes) ----

export async function ensureFace() {
  if (demoMode || faceState === "loading" || faceState === "ready") return;
  faceState = "loading";
  try {
    const { mod, fileset } = await loadVision();
    faceLandmarker = await createWithFallback("Face tracker", (delegate) => mod.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,   // Laser Eyes' brow raise
    }));
    faceState = "ready";
  } catch (err) {
    console.warn("Face tracker unavailable:", err);
    faceState = "error";
    flashStatus(`Face tracker unavailable (${errText(err)}) — reselect the effect to retry`, 5000);
  }
}
