// Finger Frame Effect
// Hold both hands up in an open "L" (thumb + index spread). The four fingertips
// form a quad, and the selected visual effect renders inside it.
// Keys 1-9 and 0 switch effects; arrow keys / click cycle. Append ?demo for a
// synthetic scene when no camera is available.
//
// Beyond the seven pixel effects:
//   Anime  — AnimeGANv2 restyles the framed region (onnxruntime-web, WebGPU
//            with a wasm fallback), run async so tracking never stalls.
//   Matrix — digital rain in front of you; `k` cuts you out so it falls behind.
//   Portal — you stay real (selfie segmentation) and the world behind you is
//            replaced; press its key again to cycle scenes.

"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_TIP = 8, MIDDLE_MCP = 9;

// Finger landmarks needed for the open-hand test the swipe gate uses.
const TIPS = [8, 12, 16, 20];    // index, middle, ring, pinky
const PIPS = [6, 10, 14, 18];

// Swipe an open hand sideways to change effect. Constants carried over from
// the terminal build, where they were tuned against real swipes:
//   * Gate on geometry (how many fingers are up), NOT on a model label — a
//     swiping hand is motion blurred and the classifier stops calling it an
//     open palm exactly when you swipe.
//   * Measure travel from the furthest extreme in the window, not the oldest
//     sample, so a swipe starting mid-window still registers fully.
//   * Require one axis to dominate, or a sloppy diagonal fires both.
//   * Ignore the first moments after a hand appears: raising it into frame is
//     itself fast motion. 150ms was measured too short; 250ms swallows it.
const SWIPE_DIST = 0.13;         // normalized screen widths
// Vertical travel is smaller in normalized units: the frame is 4:3, so the
// same physical motion covers less normalized distance across y than x — and
// arms swing sideways more freely than up and down.
const SWIPE_DIST_Y = 0.10;
const SWIPE_WINDOW_MS = 600;
const SWIPE_MIN_FINGERS = 3;     // an open-ish hand; a fist must not swipe
const SWIPE_DOMINANCE = 1.5;     // horizontal must beat vertical by this
const SWIPE_SETTLE_MS = 250;
const SWIPE_COOLDOWN_MS = 700;   // one effect change per swipe, not a burst

const MAX_LOST_FRAMES = 25;      // frames the quad survives a tracking dropout
const JUMP_CONFIRM_FRAMES = 2;   // frames a large reposition must persist
const JUMP_FRAC = 0.3;           // "large" = avg corner move > 30% screen width
const SPREAD_ON = 0.7;           // thumb-index spread (x hand scale) to activate
const SPREAD_OFF = 0.3;          // spread to stay active (hysteresis)
const AREA_MIN = 0.005;          // quad area as fraction of canvas area
const AREA_MAX = 0.6;
const ALPHA_MIN = 0.35;          // corner smoothing lerp range (velocity-adaptive)
const ALPHA_MAX = 0.85;

const VG_SCALE = 4;              // Van Gogh gradient-field downsample factor
const POSTER_LEVELS = 6;         // toon color quantization bands
const TOON_W = 320;              // toon working width

const EFFECTS = ["Pixelate", "Blur", "Invert", "Noir", "Glitch", "Toon",
                 "Van Gogh", "Anime", "Matrix", "Portal",
                 "Inferno", "Shatter", "Aurora"];
// Effects 1-10 are the number row (0 is the tenth); the GPU shaders past that
// take letters. Single source of truth for the chips and the key handler.
const EFFECT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
                     "q", "w", "e"];

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

// --- Anime: the AnimeGAN family via onnxruntime-web -------------------------
// Every style here shares one spec: NHWC float32 [1,H,W,3] in [-1,1], dynamic
// H/W, one input and one output — so switching style is only a model swap.
// Their *input tensor names* differ, so the feed is keyed off the session's
// own inputNames rather than a constant.
//
// Hugging Face `resolve/` URLs send `access-control-allow-origin: *`; GitHub
// release assets send no CORS headers at all and cannot be used here.
const ORT_PATH = "onnxruntime-web@1.19.2/dist/";
const HF = "https://huggingface.co/";
const ANIME_STYLES = [
  { name: "Hayao",  url: HF + "vumichien/AnimeGANv2_Hayao/resolve/main/AnimeGANv2_Hayao.onnx" },
  { name: "Shinkai", url: HF + "vumichien/AnimeGANv2_Shinkai/resolve/main/AnimeGANv2_Shinkai.onnx" },
  { name: "Ghibli",  url: HF + "trysem/AnimeGANv3_Portrait_Inference/resolve/main/AnimeGANv3_large_Ghibli_c1_e299.onnx" },
  { name: "Sketch",  url: HF + "vumichien/AnimeGANv3_PortraitSketch/resolve/main/AnimeGANv3_PortraitSketch.onnx" },
];
// Working widths, stepped by measured inference time. The browser has a real
// GPU, so these are far above what the terminal build could afford.
const ANIME_SIZES = [256, 384, 512];
const ANIME_ALIGN = 32;          // the generator downsamples 3x

// --- Portal / Matrix: person mask ------------------------------------------
const SEG_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/" +
  "selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const PORTAL_SCENES = ["Space", "Synthwave", "Sunset"];

// Matrix rain, ported from the terminal build. Rendered on a coarse grid and
// scaled up, so the glyph cells stay chunky and readable.
const MATRIX_CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789XYZ";

// ---------------------------------------------------------------------------
// DOM / canvases
// ---------------------------------------------------------------------------

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const video = document.getElementById("cam");
const statusEl = document.getElementById("status");
const badgeEl = document.getElementById("badge");
const hintEl = document.getElementById("hint");

// Offscreen canvas holding the mirrored camera frame (or demo scene) at
// canvas resolution. All effects sample from this.
const frame = document.createElement("canvas");
const fctx = frame.getContext("2d");

// Reusable scratch canvases for effects (resized lazily).
function makeScratch(readFrequently) {
  const c = document.createElement("canvas");
  return { c, g: c.getContext("2d", readFrequently ? { willReadFrequently: true } : undefined) };
}
const sPix = makeScratch(false);
const sGlitchSrc = makeScratch(false);
const sGlitchR = makeScratch(false);
const sGlitchC = makeScratch(false);
const sToon = makeScratch(true);
const sVgSmall = makeScratch(true);
const sVgOut = makeScratch(false);
const sScene = makeScratch(false);
const sPerson = makeScratch(false);
const sAnimeIn = makeScratch(true);
const sGlSrc = makeScratch(false);   // crop uploaded as the shader texture
const sGlMask = makeScratch(false);  // person mask, cropped to the same box

function sizeScratch(s, w, h) {
  if (s.c.width !== w || s.c.height !== h) { s.c.width = w; s.c.height = h; }
  return s.g;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let landmarker = null;
const urlParams = new URLSearchParams(location.search);
let demoMode = urlParams.has("demo");
let cameraReady = false;
let effectIndex = 0;

// Anime state. Inference is async: the loop never awaits it, and the newest
// finished frame is stretched to wherever the quad has moved since.
let ort = null;
let animeSession = null;
let animeState = "idle";        // idle | loading | ready | error
let animeBusy = false;
let animeResult = null;
let animeTier = 1;
let animeStyle = 0;             // index into ANIME_STYLES
let animeLoadToken = 0;         // guards against out-of-order style loads
const animeCache = new Map();   // style name -> session, so switching is instant

// Person segmentation (Portal, and Matrix when keepPerson is on).
let visionLib = null;
let segmenter = null;
let segState = "idle";          // idle | loading | ready | error
let maskReady = false;
let portalScene = 0;
// Matrix default: rain in FRONT of you. Toggle with `k` to cut yourself out
// of it instead, which is what the terminal build called --keep-person.
let keepPerson = false;
const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d");
let maskImageData = null;

// Quad tracking state
let smoothQuad = null;           // [{x,y} x4] smoothed screen-space corners
let presence = 0;                // 0..1 fade
let lostFrames = 0;
let jumpCandidate = null;        // pending large-jump quad
let jumpFrames = 0;
let spreadActive = [false, false]; // per-hand hysteresis latch

// Video -> canvas "cover" mapping (recomputed per frame)
const fit = { s: 1, ox: 0, oy: 0, vw: 1, vh: 1 };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  frame.width = canvas.width;
  frame.height = canvas.height;
}
addEventListener("resize", resize);
resize();

function buildHint() {
  hintEl.innerHTML = "";
  EFFECTS.forEach((name, i) => {
    const el = document.createElement("div");
    el.className = "fx" + (i === effectIndex ? " active" : "");
    el.innerHTML = `<span class="k">${EFFECT_KEYS[i]}</span>` +
      `<span class="n">${name}</span>`;
    el.addEventListener("click", () => setEffect(i));
    hintEl.appendChild(el);
  });
  refreshChips();
}
// Anime and Portal cycle a sub-option on repeat presses; show which one is
// live so the extra press is discoverable rather than hidden.
function refreshChips() {
  [...hintEl.children].forEach((el, j) => {
    const label = el.querySelector(".n");
    if (!label) return;
    if (EFFECTS[j] === "Anime") {
      label.textContent = `Anime · ${ANIME_STYLES[animeStyle].name}`;
    } else if (EFFECTS[j] === "Portal") {
      label.textContent = `Portal · ${PORTAL_SCENES[portalScene]}`;
    }
  });
}

function setEffect(i) {
  const idx = (i + EFFECTS.length) % EFFECTS.length;
  // Pressing the active Portal key again cycles its scene, so all three
  // worlds are reachable without extra keys.
  if (idx === effectIndex && EFFECTS[idx] === "Portal") {
    portalScene = (portalScene + 1) % PORTAL_SCENES.length;
    flashStatus(`Portal → ${PORTAL_SCENES[portalScene]}`);
  }
  // Same for Anime: pressing its key again walks through the styles.
  if (idx === effectIndex && EFFECTS[idx] === "Anime") {
    cycleAnimeStyle();
  }
  effectIndex = idx;
  [...hintEl.children].forEach((el, j) => el.classList.toggle("active", j === effectIndex));
  refreshChips();
  const name = EFFECTS[idx];
  if (name === "Anime") ensureAnime();
  // The shader effects key off the person mask; without it they still render
  // (person() returns 1) but lose the body-aware behaviour that is the point.
  const MASK_FX = ["Portal", "Inferno", "Shatter", "Aurora"];
  if (MASK_FX.includes(name) || (name === "Matrix" && keepPerson)) ensureSegmenter();
}
buildHint();

addEventListener("keydown", (e) => {
  const idx = EFFECT_KEYS.indexOf(e.key.toLowerCase());
  if (idx >= 0) setEffect(idx);
  else if (e.key === "ArrowRight") setEffect(effectIndex + 1);
  else if (e.key === "ArrowLeft") setEffect(effectIndex - 1);
  else if (e.key === "k" || e.key === "K") {
    keepPerson = !keepPerson;
    flashStatus(keepPerson ? "Matrix rain behind you" : "Matrix rain in front");
    if (keepPerson) ensureSegmenter();
  }
});
canvas.addEventListener("click", () => setEffect(effectIndex + 1));

function setStatus(text) {
  if (text === null) { statusEl.classList.add("hidden"); return; }
  statusEl.textContent = text;
  statusEl.classList.remove("hidden");
}

let flashTimer = 0;
function flashStatus(text) {
  setStatus(text);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => setStatus(null), 1600);
}

// ---------------------------------------------------------------------------
// Camera + MediaPipe init
// ---------------------------------------------------------------------------

// The tasks-vision module and its wasm fileset are shared by the hand
// tracker and the segmenter; loading them twice would download the runtime
// twice for no reason.
const VISION_PATH = "@mediapipe/tasks-vision@0.10.14/";

async function loadVision() {
  if (visionLib) return visionLib;
  const base = (await pickCdn(VISION_PATH + "vision_bundle.mjs")) + VISION_PATH;
  const mod = await import(base + "vision_bundle.mjs");
  const fileset = await mod.FilesetResolver.forVisionTasks(base + "wasm");
  visionLib = { mod, fileset };
  return visionLib;
}

async function initTracker() {
  const { mod, fileset } = await loadVision();
  landmarker = await mod.HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
}

async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  cameraReady = true;
}

// --- Selfie segmentation ---------------------------------------------------

async function ensureSegmenter() {
  if (demoMode || segState !== "idle") return;
  segState = "loading";
  try {
    const { mod, fileset } = await loadVision();
    segmenter = await mod.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: SEG_MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    segState = "ready";
  } catch (err) {
    console.warn("Segmenter unavailable:", err);
    segState = "error";
    flashStatus("Person mask unavailable — showing scene only");
  }
}

// Copies the confidence mask into maskCanvas (video space, white = person,
// confidence in alpha) so it can be used as a clip source.
function writeMask(result) {
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

// --- Anime -----------------------------------------------------------------

async function loadOrt() {
  if (ort) return ort;
  setStatus("Loading Anime engine…");
  const base = (await pickCdn(ORT_PATH + "ort.webgpu.min.mjs")) + ORT_PATH;
  ort = await import(base + "ort.webgpu.min.mjs");
  ort.env.wasm.wasmPaths = base;
  return ort;
}

async function ensureAnime() {
  if (animeState === "loading") return;
  const style = ANIME_STYLES[animeStyle];
  // Already have this style compiled: switching back is instant.
  const cached = animeCache.get(style.name);
  if (cached) {
    animeSession = cached;
    animeState = "ready";
    return;
  }

  const token = ++animeLoadToken;
  animeState = "loading";
  try {
    await loadOrt();
    setStatus(`Loading Anime · ${style.name}…`);
    let session;
    try {
      session = await ort.InferenceSession.create(style.url, {
        executionProviders: ["webgpu"],
      });
    } catch (err) {
      console.warn("WebGPU unavailable for Anime, using wasm:", err);
      animeTier = 0;                 // wasm is much slower — start small
      session = await ort.InferenceSession.create(style.url, {
        executionProviders: ["wasm"],
      });
    }
    // A newer style was requested while this one was downloading; that load
    // owns the session now, so keep this one only for the cache.
    animeCache.set(style.name, session);
    if (token !== animeLoadToken) return;
    animeSession = session;
    animeResult = null;              // drop the previous style's last frame
    animeState = "ready";
    flashStatus(`Anime · ${style.name} ✨`);
  } catch (err) {
    console.warn("Anime effect unavailable:", err);
    if (token !== animeLoadToken) return;
    animeState = "error";
    flashStatus("Anime model failed to load — using Toon");
  }
}

function cycleAnimeStyle(step = 1) {
  const n = ANIME_STYLES.length;
  animeStyle = (animeStyle + step + n) % n;
  animeState = "idle";
  refreshChips();
  ensureAnime();
}

async function runAnime(bx, by, bw, bh) {
  animeBusy = true;
  try {
    const maxDim = ANIME_SIZES[animeTier];
    const k = maxDim / Math.max(bw, bh);
    const tw = Math.max(96, Math.round((bw * k) / ANIME_ALIGN) * ANIME_ALIGN);
    const th = Math.max(96, Math.round((bh * k) / ANIME_ALIGN) * ANIME_ALIGN);

    const g = sizeScratch(sAnimeIn, tw, th);
    g.imageSmoothingEnabled = true;
    g.drawImage(frame, bx, by, bw, bh, 0, 0, tw, th);
    const src = g.getImageData(0, 0, tw, th).data;

    const data = new Float32Array(tw * th * 3);
    for (let i = 0, p = 0; p < src.length; p += 4) {
      data[i++] = src[p] / 127.5 - 1;
      data[i++] = src[p + 1] / 127.5 - 1;
      data[i++] = src[p + 2] / 127.5 - 1;
    }

    // Capture the session: a style switch mid-inference must not write this
    // result over the new style's output.
    const session = animeSession;
    const t0 = performance.now();
    const feeds = {};
    // Input names differ across the AnimeGAN family, so read it off the model.
    feeds[session.inputNames[0]] =
      new ort.Tensor("float32", data, [1, th, tw, 3]);
    const out = await session.run(feeds);
    const dur = performance.now() - t0;
    if (session !== animeSession) return;

    const tensor = out[session.outputNames[0]];
    const [, oh, ow] = tensor.dims;
    const o = tensor.data;
    if (!animeResult) animeResult = document.createElement("canvas");
    if (animeResult.width !== ow || animeResult.height !== oh) {
      animeResult.width = ow;
      animeResult.height = oh;
    }
    const rctx = animeResult.getContext("2d");
    const img = rctx.createImageData(ow, oh);
    const d = img.data;
    for (let i = 0, p = 0; p < d.length; p += 4) {
      d[p] = Math.max(0, Math.min(255, (o[i++] + 1) * 127.5));
      d[p + 1] = Math.max(0, Math.min(255, (o[i++] + 1) * 127.5));
      d[p + 2] = Math.max(0, Math.min(255, (o[i++] + 1) * 127.5));
      d[p + 3] = 255;
    }
    rctx.putImageData(img, 0, 0);

    // Track the measured cost: step up while there is headroom, down when a
    // frame gets expensive, so this adapts to the machine it lands on.
    if (dur > 420 && animeTier > 0) animeTier--;
    else if (dur < 130 && animeTier < ANIME_SIZES.length - 1) animeTier++;
  } catch (err) {
    console.warn("Anime inference failed:", err);
    animeState = "error";
    flashStatus("Anime inference failed — using Toon");
  } finally {
    animeBusy = false;
  }
}

// ?fx=8 selects a starting effect (1-based), ?scene=2 a portal scene, and
// ?style=1 an anime style (both 0-based).
{
  const fx = parseInt(urlParams.get("fx"), 10);
  const sc = parseInt(urlParams.get("scene"), 10);
  const st = parseInt(urlParams.get("style"), 10);
  if (sc >= 0 && sc < PORTAL_SCENES.length) portalScene = sc;
  if (st >= 0 && st < ANIME_STYLES.length) animeStyle = st;
  if (urlParams.has("keepPerson")) keepPerson = true;
  if (fx >= 1 && fx <= EFFECTS.length) setEffect(fx - 1);
}

async function boot() {
  if (!demoMode) {
    try {
      setStatus("Loading hand tracker…");
      await initTracker();
      setStatus("Starting camera…");
      await initCamera();
      setStatus("Show both hands — thumb + index like a picture frame 🤳");
    } catch (err) {
      console.warn("Falling back to demo mode:", err);
      demoMode = true;
    }
  }
  if (demoMode) {
    badgeEl.classList.add("show");
    setStatus("Demo mode — synthetic frame, keys 1-0 / q w e switch effects");
  }
  requestAnimationFrame(tick);
}
boot();

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function polyArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

function segsIntersect(a, b, c, d) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b);
  const d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// A "bowtie" quad has opposite edges crossing.
const isBowtie = (q) =>
  segsIntersect(q[0], q[1], q[2], q[3]) || segsIntersect(q[1], q[2], q[3], q[0]);

function quadCentroid(q) {
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
}

// ---------------------------------------------------------------------------
// Gesture detection -> raw quad
// ---------------------------------------------------------------------------

function computeFit() {
  const vw = demoMode ? canvas.width : (video.videoWidth || 1280);
  const vh = demoMode ? canvas.height : (video.videoHeight || 720);
  const s = Math.max(canvas.width / vw, canvas.height / vh);
  fit.s = s;
  fit.vw = vw;
  fit.vh = vh;
  fit.ox = (canvas.width - vw * s) / 2;
  fit.oy = (canvas.height - vh * s) / 2;
}

// Normalized landmark -> mirrored canvas coordinates.
function toScreen(lm) {
  return {
    x: fit.ox + fit.s * (fit.vw - lm.x * fit.vw),
    y: fit.oy + fit.s * (lm.y * fit.vh),
  };
}

// --- Swipe to change effect -------------------------------------------------

// Signed excursion from whichever extreme of the window is furthest away.
function swipeTravel(vals, cur) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const up = cur - lo, down = cur - hi;
  return Math.abs(up) >= Math.abs(down) ? up : down;
}

// Extended-finger count, excluding the thumb: a fingertip sitting further
// from the wrist than its PIP joint is extended. Measuring against the wrist
// (rather than comparing raw y) keeps the test valid for a rotated hand.
function openFingerCount(lms) {
  const w = lms[WRIST];
  let n = 0;
  for (let i = 0; i < TIPS.length; i++) {
    const tip = lms[TIPS[i]], pip = lms[PIPS[i]];
    const td = Math.hypot(tip.x - w.x, tip.y - w.y);
    const pd = Math.hypot(pip.x - w.x, pip.y - w.y);
    if (td / Math.max(pd, 1e-4) > 1.06) n++;
  }
  return n;
}

const swipeState = { history: [], enteredAt: null, lastFire: 0 };

function detectSwipe(handsLandmarks, t) {
  // One hand only. Both hands up is the framing pose, and two palms moving
  // together would fire a swipe on each of them.
  if (!handsLandmarks || handsLandmarks.length !== 1) {
    swipeState.history.length = 0;
    swipeState.enteredAt = null;
    return null;
  }
  const lms = handsLandmarks[0];
  if (openFingerCount(lms) < SWIPE_MIN_FINGERS) {
    swipeState.history.length = 0;
    swipeState.enteredAt = null;
    return null;
  }

  if (swipeState.enteredAt === null) swipeState.enteredAt = t;
  if (t - swipeState.enteredAt < SWIPE_SETTLE_MS) return null;

  // Palm centre, not the wrist: the wrist barely moves when you swipe from
  // the elbow, which is how people actually swipe.
  const x = (lms[WRIST].x + lms[MIDDLE_MCP].x) / 2;
  const y = (lms[WRIST].y + lms[MIDDLE_MCP].y) / 2;
  const h = swipeState.history;
  h.push({ t, x, y });
  while (h.length && t - h[0].t > SWIPE_WINDOW_MS) h.shift();
  if (h.length < 3) return null;

  const dx = swipeTravel(h.map((p) => p.x), x);
  const dy = swipeTravel(h.map((p) => p.y), y);

  // One axis must clearly dominate, or a sloppy diagonal wave clears both
  // thresholds and fires whichever happens to be tested first.
  const horizontal = Math.abs(dx) >= SWIPE_DIST &&
    Math.abs(dx) >= Math.abs(dy) * SWIPE_DOMINANCE;
  const vertical = Math.abs(dy) >= SWIPE_DIST_Y &&
    Math.abs(dy) >= Math.abs(dx) * SWIPE_DOMINANCE;
  if (!horizontal && !vertical) return null;
  if (t - swipeState.lastFire < SWIPE_COOLDOWN_MS) return null;

  swipeState.lastFire = t;
  h.length = 0;
  if (horizontal) {
    // Landmarks are in unmirrored video space while the canvas is mirrored,
    // so a hand moving to the user's right decreases x here.
    return dx > 0 ? "left" : "right";
  }
  // Image y grows downward, so +dy means the hand moved down.
  return dy > 0 ? "down" : "up";
}

function computeQuad(handsLandmarks) {
  if (!handsLandmarks || handsLandmarks.length < 2) {
    spreadActive = [false, false];
    return null;
  }

  const hands = handsLandmarks.slice(0, 2).map((lms) => ({
    wrist: toScreen(lms[WRIST]),
    thumb: toScreen(lms[THUMB_TIP]),
    index: toScreen(lms[INDEX_TIP]),
    midMcp: toScreen(lms[MIDDLE_MCP]),
  }));

  // Hand scale from wrist -> middle knuckle: stable under foreshortening.
  for (let i = 0; i < 2; i++) {
    const h = hands[i];
    const scale = dist(h.wrist, h.midMcp);
    if (scale < 1e-3) { spreadActive = [false, false]; return null; }
    const spread = dist(h.thumb, h.index) / scale;
    const threshold = spreadActive[i] ? SPREAD_OFF : SPREAD_ON;
    spreadActive[i] = spread > threshold;
    if (!spreadActive[i]) return null;
  }

  // Order anatomically: left hand's index is top-left, right hand's index
  // top-right, then down to the thumbs.
  hands.sort((a, b) => a.wrist.x - b.wrist.x);
  const [L, R] = hands;
  const quad = [L.index, R.index, R.thumb, L.thumb];

  const areaFrac = polyArea(quad) / (canvas.width * canvas.height);
  if (areaFrac < AREA_MIN || areaFrac > AREA_MAX) return null;
  if (isBowtie(quad)) return null;

  return quad;
}

// ---------------------------------------------------------------------------
// Quad smoothing / hysteresis pipeline
// ---------------------------------------------------------------------------

function avgCornerDelta(a, b) {
  let d = 0;
  for (let i = 0; i < 4; i++) d += dist(a[i], b[i]);
  return d / 4;
}

function updateQuadState(raw) {
  if (raw) {
    if (!smoothQuad) {
      smoothQuad = raw.map((p) => ({ x: p.x, y: p.y }));
    } else {
      const delta = avgCornerDelta(smoothQuad, raw);
      if (delta > JUMP_FRAC * canvas.width) {
        // A huge reposition: might be a mis-detection. Require it to persist.
        jumpFrames++;
        if (jumpFrames >= JUMP_CONFIRM_FRAMES) {
          smoothQuad = raw.map((p) => ({ x: p.x, y: p.y }));
          jumpFrames = 0;
        }
      } else {
        jumpFrames = 0;
        // Velocity-adaptive smoothing: sluggish when still, responsive when moving.
        const speed = delta / (canvas.width * 0.05);
        const alpha = Math.min(ALPHA_MAX, ALPHA_MIN + speed * (ALPHA_MAX - ALPHA_MIN));
        for (let i = 0; i < 4; i++) {
          smoothQuad[i].x += (raw[i].x - smoothQuad[i].x) * alpha;
          smoothQuad[i].y += (raw[i].y - smoothQuad[i].y) * alpha;
        }
      }
    }
    lostFrames = 0;
  } else {
    lostFrames++;
    jumpFrames = 0;
  }

  const visible = smoothQuad && lostFrames <= MAX_LOST_FRAMES;
  presence += ((visible ? 1 : 0) - presence) * (visible ? 0.18 : 0.1);
  if (presence < 0.005 && !visible) {
    presence = 0;
    smoothQuad = null;
  }
}

// ---------------------------------------------------------------------------
// Demo mode: synthetic scene + synthetic quad
// ---------------------------------------------------------------------------

function drawDemoScene(t) {
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

function demoQuad(t) {
  const w = canvas.width, h = canvas.height;
  const cx = w * 0.5 + Math.sin(t * 0.0004) * w * 0.12;
  const cy = h * 0.45 + Math.cos(t * 0.0005) * h * 0.08;
  const hw = w * (0.19 + 0.05 * Math.sin(t * 0.0007));
  const hh = h * (0.2 + 0.04 * Math.cos(t * 0.0006));
  const rot = Math.sin(t * 0.0003) * 0.12;
  const c = Math.cos(rot), s = Math.sin(rot);
  const pt = (dx, dy) => ({ x: cx + dx * c - dy * s, y: cy + dx * s + dy * c });
  return [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)];
}

// ---------------------------------------------------------------------------
// Effects — each reads the frame canvas within bbox and draws into ctx,
// which is already clipped to the quad with globalAlpha = presence.
// ---------------------------------------------------------------------------

function fxPixelate(bx, by, bw, bh) {
  const cell = Math.max(6, Math.round(canvas.width / 53));
  const tw = Math.max(2, Math.round(bw / cell));
  const th = Math.max(2, Math.round(bh / cell));
  const g = sizeScratch(sPix, tw, th);
  g.imageSmoothingEnabled = true;
  g.drawImage(frame, bx, by, bw, bh, 0, 0, tw, th);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sPix.c, 0, 0, tw, th, bx, by, bw, bh);
  ctx.imageSmoothingEnabled = true;
}

function fxBlur(bx, by, bw, bh) {
  ctx.filter = "blur(14px) saturate(1.1)";
  // Overdraw beyond the bbox so the blur doesn't pull in transparent edges.
  const pad = 30;
  ctx.drawImage(frame, bx - pad, by - pad, bw + pad * 2, bh + pad * 2,
    bx - pad, by - pad, bw + pad * 2, bh + pad * 2);
  ctx.filter = "none";
}

function fxInvert(bx, by, bw, bh) {
  ctx.filter = "invert(1)";
  ctx.drawImage(frame, bx, by, bw, bh, bx, by, bw, bh);
  ctx.filter = "none";
}

function fxNoir(bx, by, bw, bh) {
  ctx.filter = "grayscale(1) contrast(1.5) brightness(0.95)";
  ctx.drawImage(frame, bx, by, bw, bh, bx, by, bw, bh);
  ctx.filter = "none";
}

function fxGlitch(bx, by, bw, bh, t) {
  const g = sizeScratch(sGlitchSrc, bw, bh);
  g.clearRect(0, 0, bw, bh);

  // Horizontal slice displacement, jittering over time.
  const seed = Math.floor(t / 90);
  let y = 0, i = 0;
  while (y < bh) {
    const sh = 8 + Math.floor(vgHash(seed, i) * 40);
    const off = (vgHash(seed + 13, i * 7) - 0.5) * bw * 0.06 *
      (vgHash(seed + 5, i) > 0.6 ? 1 : 0.15);
    g.drawImage(frame, bx, by + y, bw, sh, off, y, bw, sh);
    y += sh;
    i++;
  }

  // Chromatic aberration: isolate red / cyan channels, offset, add.
  const gr = sizeScratch(sGlitchR, bw, bh);
  gr.globalCompositeOperation = "source-over";
  gr.drawImage(sGlitchSrc.c, 0, 0);
  gr.globalCompositeOperation = "multiply";
  gr.fillStyle = "#f00";
  gr.fillRect(0, 0, bw, bh);

  const gc = sizeScratch(sGlitchC, bw, bh);
  gc.globalCompositeOperation = "source-over";
  gc.drawImage(sGlitchSrc.c, 0, 0);
  gc.globalCompositeOperation = "multiply";
  gc.fillStyle = "#0ff";
  gc.fillRect(0, 0, bw, bh);

  const shift = 8;
  ctx.drawImage(sGlitchR.c, bx - shift, by);
  const prevOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(sGlitchC.c, bx + shift, by);
  ctx.globalCompositeOperation = prevOp;

  // Scanlines
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  for (let sy = by + (Math.floor(t / 40) % 6); sy < by + bh; sy += 6) {
    ctx.fillRect(bx, sy, bw, 2);
  }
}

function fxToon(bx, by, bw, bh) {
  const tw = Math.min(TOON_W, bw);
  const th = Math.max(2, Math.round(bh * (tw / bw)));
  const g = sizeScratch(sToon, tw, th);
  g.imageSmoothingEnabled = true;
  g.drawImage(frame, bx, by, bw, bh, 0, 0, tw, th);

  const img = g.getImageData(0, 0, tw, th);
  const d = img.data;
  const n = tw * th;

  // Luma before posterization, for edge detection.
  const luma = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    luma[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
  }

  // Posterize
  const L = POSTER_LEVELS, q = 255 / (L - 1);
  for (let p = 0; p < d.length; p += 4) {
    d[p] = Math.round(d[p] / q) * q;
    d[p + 1] = Math.round(d[p + 1] / q) * q;
    d[p + 2] = Math.round(d[p + 2] / q) * q;
  }

  // Sobel edges -> darken
  for (let yy = 1; yy < th - 1; yy++) {
    for (let xx = 1; xx < tw - 1; xx++) {
      const i = yy * tw + xx;
      const gx =
        -luma[i - tw - 1] - 2 * luma[i - 1] - luma[i + tw - 1] +
        luma[i - tw + 1] + 2 * luma[i + 1] + luma[i + tw + 1];
      const gy =
        -luma[i - tw - 1] - 2 * luma[i - tw] - luma[i - tw + 1] +
        luma[i + tw - 1] + 2 * luma[i + tw] + luma[i + tw + 1];
      if (Math.hypot(gx, gy) > 90) {
        const p = i * 4;
        d[p] *= 0.18; d[p + 1] *= 0.18; d[p + 2] *= 0.18;
      }
    }
  }

  g.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sToon.c, 0, 0, tw, th, bx, by, bw, bh);
}

// --- Van Gogh -------------------------------------------------------------

// Deterministic per-cell hash so strokes are stable frame-to-frame.
function vgHash(i, j) {
  const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

// Preallocated buffers, resized only when the working size changes.
const vg = { n: 0, luma: null, blur: null, tmp: null, gx: null, gy: null };
function vgEnsure(n) {
  if (vg.n !== n) {
    vg.n = n;
    vg.luma = new Float32Array(n);
    vg.blur = new Float32Array(n);
    vg.tmp = new Float32Array(n);
    vg.gx = new Float32Array(n);
    vg.gy = new Float32Array(n);
  }
}

function vgBoxBlur(src, dst, tmp, w, h) {
  // 5-tap box blur, separable.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        s += src[row + Math.min(w - 1, Math.max(0, x + k))];
      }
      tmp[row + x] = s / 5;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      }
      dst[y * w + x] = s / 5;
    }
  }
}

function fxVanGogh(bx, by, bw, bh) {
  const sw = Math.max(4, Math.round(bw / VG_SCALE));
  const sh = Math.max(4, Math.round(bh / VG_SCALE));
  const g = sizeScratch(sVgSmall, sw, sh);
  g.imageSmoothingEnabled = true;
  g.drawImage(frame, bx, by, bw, bh, 0, 0, sw, sh);
  const img = g.getImageData(0, 0, sw, sh);
  const d = img.data;
  const n = sw * sh;
  vgEnsure(n);

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    vg.luma[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
  }
  vgBoxBlur(vg.luma, vg.blur, vg.tmp, sw, sh);

  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      vg.gx[i] = vg.blur[i + 1] - vg.blur[i - 1];
      vg.gy[i] = vg.blur[i + sw] - vg.blur[i - sw];
    }
  }

  const o = sizeScratch(sVgOut, bw, bh);
  // Underpaint: darkened base so gaps between strokes don't flash raw video.
  o.filter = "brightness(0.6) saturate(1.2)";
  o.drawImage(frame, bx, by, bw, bh, 0, 0, bw, bh);
  o.filter = "none";
  o.lineCap = "round";

  const sample = (px, py) => {
    const sx = Math.min(sw - 1, Math.max(0, Math.round(px / VG_SCALE)));
    const sy = Math.min(sh - 1, Math.max(0, Math.round(py / VG_SCALE)));
    return sy * sw + sx;
  };

  const strokePass = (step, width, len, edgesOnly) => {
    o.lineWidth = width;
    const gy0 = step / 2, gx0 = step / 2;
    for (let py = gy0, iy = 0; py < bh; py += step, iy++) {
      for (let px = gx0, ix = 0; px < bw; px += step, ix++) {
        const h1 = vgHash(ix + step, iy);
        const h2 = vgHash(ix * 3 + 7, iy * 5 + 1);
        const jx = px + (h1 - 0.5) * step;
        const jy = py + (h2 - 0.5) * step;
        const i = sample(jx, jy);
        const gxv = vg.gx[i], gyv = vg.gy[i];
        const mag = Math.hypot(gxv, gyv);
        if (edgesOnly && mag < 14) continue;

        let angle;
        if (mag > 2) {
          angle = Math.atan2(gyv, gxv) + Math.PI / 2; // along the edge
        } else {
          // Flat region: swirl field, deterministic in space.
          angle = Math.sin(jx * 0.012) * 1.6 + Math.cos(jy * 0.014) * 1.6 + h1 * 0.9;
        }

        const p = i * 4;
        const jit = (h2 - 0.5) * 38;
        const r = Math.max(0, Math.min(255, d[p] + jit));
        const gg = Math.max(0, Math.min(255, d[p + 1] + jit));
        const b = Math.max(0, Math.min(255, d[p + 2] + jit));
        o.strokeStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;

        const l = len * (0.65 + 0.7 * h1);
        const dx = Math.cos(angle) * l * 0.5;
        const dy = Math.sin(angle) * l * 0.5;
        o.beginPath();
        o.moveTo(jx - dx, jy - dy);
        // Slight curvature for a painterly feel.
        o.quadraticCurveTo(
          jx + (h2 - 0.5) * 6, jy + (h1 - 0.5) * 6,
          jx + dx, jy + dy
        );
        o.stroke();
      }
    }
  };

  strokePass(14, 10, 24, false); // mass strokes
  strokePass(6, 4, 11, true);    // fine strokes along edges

  ctx.drawImage(sVgOut.c, 0, 0, bw, bh, bx, by, bw, bh);
}

// --- Anime ------------------------------------------------------------------

function fxAnime(bx, by, bw, bh) {
  // Kick off inference on the current contents and draw whatever finished
  // last. Never awaited, so tracking keeps full frame rate and the portal
  // trails reality by roughly one inference.
  if (animeState === "ready" && !animeBusy && bw > 48 && bh > 48) {
    runAnime(bx, by, bw, bh);
  }
  if (animeResult) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(animeResult, 0, 0, animeResult.width, animeResult.height,
      bx, by, bw, bh);
  } else {
    fxToon(bx, by, bw, bh);   // stand-in until the first stylized frame lands
  }
}

// --- Person compositing -----------------------------------------------------

// Draws the live person (segmentation mask) over whatever is already in the
// box, so an effect can be placed behind them.
function drawPersonOver(bx, by, bw, bh) {
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

// --- Matrix -----------------------------------------------------------------

function fxMatrix(bx, by, bw, bh, t) {
  const g = sizeScratch(sScene, bw, bh);
  g.fillStyle = "#010703";
  g.fillRect(0, 0, bw, bh);

  const cols = Math.max(10, Math.min(64, Math.round(bw / 22)));
  const cw = bw / cols;
  const fs = cw * 0.9;
  const rows = Math.ceil(bh / fs);
  const trail = 14;
  g.font = `bold ${fs}px monospace`;
  g.textAlign = "center";
  for (let c = 0; c < cols; c++) {
    // Per-column speed and offset, fixed by hash: the rain is steady rather
    // than reshuffling every frame.
    const speed = 0.006 + 0.012 * vgHash(c, 3);
    const head = ((t * speed + vgHash(c, 9) * 100) % (rows + trail)) - 1;
    for (let k = 0; k < trail; k++) {
      const row = Math.floor(head) - k;
      if (row < 0 || row > rows) continue;
      const mut = Math.floor(t / 400);
      const ch = MATRIX_CHARS[
        Math.floor(vgHash(c * 31 + 7, row * 17 + (k === 0 ? mut : 0)) *
          MATRIX_CHARS.length)
      ];
      g.fillStyle = k === 0
        ? "rgba(215,255,228,0.96)"
        : `rgba(0,255,90,${(1 - k / trail) * 0.8})`;
      g.fillText(ch, c * cw + cw / 2, row * fs + fs);
    }
  }
  ctx.drawImage(sScene.c, bx, by);
  // Default is rain in front; `k` puts it behind you instead.
  if (keepPerson) drawPersonOver(bx, by, bw, bh);
}

// --- Portal -----------------------------------------------------------------

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
      const x = (vgHash(i, L * 11 + 1) * w + t * speed) % w;
      const y = vgHash(i + 41, L * 7 + 3) * h;
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
    const sx = w * (0.15 + 0.6 * vgHash(epoch, 5));
    const sy = h * (0.1 + 0.3 * vgHash(epoch, 9));
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
      const cw2 = w * (0.3 + 0.16 * vgHash(i, L));
      const x = ((vgHash(i, L + 5) * w + t * (0.006 + L * 0.004)) % (w + cw2)) - cw2 / 2;
      const y = h * (0.18 + 0.22 * vgHash(i + 3, L + 1)) + L * h * 0.06;
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

const PORTAL_SCENE_FNS = [drawSpace, drawSynthwave, drawSunset];

function fxPortal(bx, by, bw, bh, t) {
  // Another world replaces the box…
  const g = sizeScratch(sScene, bw, bh);
  g.save();
  PORTAL_SCENE_FNS[portalScene](g, bw, bh, t);
  g.restore();
  ctx.drawImage(sScene.c, bx, by);
  // …except you, who stay real in front of it.
  drawPersonOver(bx, by, bw, bh);
}


// ---------------------------------------------------------------------------
// WebGL shader effects
//
// These run on the GPU in one pass over the framed region, which is why they
// can afford per-pixel work (kaleidoscope folding, liquid warping, chromatic
// dispersion) that the Canvas 2D effects above cannot.
//
// The integration keeps the existing contract: render into an offscreen GL
// canvas sized to the quad's bounding box, then hand that back as an image
// for the 2D context to draw inside its clip path. Tracking, smoothing and
// clipping stay exactly as they are.
//
// One GL context is shared by every shader — contexts are a limited resource
// and browsers drop the oldest when a page makes too many — so the programs
// are compiled once, cached by name, and swapped per frame.
// ---------------------------------------------------------------------------

const glCanvas = document.createElement("canvas");
let gl = null;
let glFailed = false;
let glQuadBuf = null;
let glTex = null;
const glPrograms = new Map();      // name -> { program, uniforms }
// Feedback needs last frame's OUTPUT, so the shader cannot draw straight to
// the screen. It renders into one of two framebuffers which swap each frame:
// read from the previous, write to the other. Textures are reallocated only
// when the box size changes.
let glFbo = [null, null];
let glFboTex = [null, null];
let glFboSize = [0, 0];
let glPing = 0;
let glMaskTex = null;
let glCamPrevTex = null;          // last frame's camera crop, for motion
let glPrevName = null;            // clears history when the effect changes
let glLastT = 0;                  // for the shader's dt

const GL_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Every fragment shader gets the same uniforms, so the draw path is uniform:
//   uTex  the framed region, uTime seconds, uRes its pixel size.
const GL_FRAG_HEAD = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;    // this frame's crop
uniform sampler2D uPrev;   // last frame's OUTPUT — feedback / simulation state
uniform sampler2D uCamPrev;// last frame's CAMERA crop — gives motion
uniform sampler2D uMask;   // person confidence in .a (1 = person), if loaded
uniform float uTime;
uniform float uDt;
uniform vec2 uRes;
uniform float uHasMask;

// Cheap value noise. Hash-based so it is stable in space and cheap enough to
// call several times per pixel.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Person coverage at a uv, 0 outside / 1 inside. Falls back to 1 so an
// effect still does something sensible before the mask loads.
float person(vec2 uv) {
  if (uHasMask < 0.5) return 1.0;
  return texture2D(uMask, uv).a;
}

// How much this pixel changed since last frame. This is the whole reason the
// simulations feel alive: they are driven by what YOU actually moved, not by
// a clock. Compared on luma so a lighting flicker does not read as motion.
float motion(vec2 uv) {
  float a = luma(texture2D(uTex, uv).rgb);
  float b = luma(texture2D(uCamPrev, uv).rgb);
  return abs(a - b);
}

// Sobel edge magnitude on luma — the silhouette and interior contours.
float edge(vec2 uv, vec2 px) {
  float tl = luma(texture2D(uTex, uv + px * vec2(-1, -1)).rgb);
  float t  = luma(texture2D(uTex, uv + px * vec2( 0, -1)).rgb);
  float tr = luma(texture2D(uTex, uv + px * vec2( 1, -1)).rgb);
  float l  = luma(texture2D(uTex, uv + px * vec2(-1,  0)).rgb);
  float r  = luma(texture2D(uTex, uv + px * vec2( 1,  0)).rgb);
  float bl = luma(texture2D(uTex, uv + px * vec2(-1,  1)).rgb);
  float b  = luma(texture2D(uTex, uv + px * vec2( 0,  1)).rgb);
  float br = luma(texture2D(uTex, uv + px * vec2( 1,  1)).rgb);
  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  return length(vec2(gx, gy));
}
`;

const GL_SHADERS = {
  // --- Inferno -----------------------------------------------------------
  // A real fluid-ish fire simulation, not a fire texture. The feedback buffer
  // IS the heat field: each frame heat advects upward, diffuses into its
  // neighbours, cools, and gets new fuel injected wherever YOU moved. Wave a
  // hand and you inject heat that then rises and curls on its own — the flame
  // outlives the gesture because it is state, not a lookup.
  Inferno: `
    void main() {
      vec2 uv = vUv;
      vec2 px = 1.0 / uRes;

      // Advect: sample the heat field slightly BELOW, so the whole field
      // marches upward every frame. Curl the sample sideways with noise so
      // the column breaks up into tongues instead of a straight bar.
      float sway = (fbm(vec2(uv.x * 5.0, uv.y * 4.0 - uTime * 1.1)) - 0.5);
      vec2 src = uv + vec2(sway * 2.6 * px.x * 6.0, px.y * 2.3);

      // Diffuse while advecting: a 4-tap blur is enough to keep the field
      // smooth without a separate pass.
      float h = texture2D(uPrev, src).r * 0.4
              + texture2D(uPrev, src + vec2(px.x, 0.0)).r * 0.15
              + texture2D(uPrev, src - vec2(px.x, 0.0)).r * 0.15
              + texture2D(uPrev, src + vec2(0.0, px.y)).r * 0.15
              + texture2D(uPrev, src - vec2(0.0, px.y)).r * 0.15;

      // Cool faster near the top so flames die out rather than filling the box.
      h *= 0.955 - 0.055 * (1.0 - uv.y);

      // Fuel injection: motion is the igniter, and the body's lower edge
      // smoulders so you are always alight even when still.
      float mv = motion(uv);
      float p = person(uv);
      float below = person(uv + vec2(0.0, px.y * 3.0));
      float rim = clamp(p - below, 0.0, 1.0);       // bottom edge of the body
      h += smoothstep(0.05, 0.35, mv) * 0.85;
      h += rim * 0.5;
      h = clamp(h, 0.0, 1.4);

      // Colour ramp: black -> blood -> orange -> white hot.
      vec3 fire = vec3(0.0);
      fire += vec3(0.85, 0.13, 0.03) * smoothstep(0.10, 0.45, h);
      fire += vec3(0.85, 0.55, 0.05) * smoothstep(0.35, 0.80, h);
      fire += vec3(0.6, 0.75, 0.9) * smoothstep(0.85, 1.25, h);

      // Show the room dim and cold underneath, lit by the fire it casts.
      vec3 room = texture2D(uTex, uv).rgb;
      vec3 col = room * (0.20 + 0.9 * h) + fire;
      // Store heat in .r so the next frame can read it back.
      gl_FragColor = vec4(max(col.r, h), col.g, col.b, 1.0);
    }`,

  // --- Shatter -----------------------------------------------------------
  // The frame is a sheet of glass that cracks where you move and the shards
  // drift apart. A Voronoi cellular decomposition gives each shard its own
  // centre; each cell then samples the image displaced along its own outward
  // velocity, so the picture separates into pieces that float and rotate
  // independently, with lit bevels along every fracture.
  Shatter: `
    // Voronoi returning: .xy offset to cell centre, .z distance to the
    // nearest EDGE (used for the bevel), .w a per-cell random id.
    vec4 voronoi(vec2 p) {
      vec2 n = floor(p), f = fract(p);
      vec2 mg, mr; float md = 8.0, id = 0.0;
      for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = vec2(hash(n + g), hash(n + g + 17.3));
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < md) { md = d; mr = r; mg = g; id = hash(n + g + 3.7); }
      }
      // Second pass for the true edge distance, which a nearest-centre
      // distance alone cannot give — this is what makes the cracks crisp.
      float me = 8.0;
      for (int j = -2; j <= 2; j++)
      for (int i = -2; i <= 2; i++) {
        vec2 g = mg + vec2(float(i), float(j));
        vec2 o = vec2(hash(n + g), hash(n + g + 17.3));
        vec2 r = g + o - f;
        if (dot(mr - r, mr - r) > 0.00001)
          me = min(me, dot(0.5 * (mr + r), normalize(r - mr)));
      }
      return vec4(mr, me, id);
    }

    void main() {
      vec2 uv = vUv;
      float asp = uRes.x / uRes.y;
      vec2 sp = vec2(uv.x * asp, uv.y) * 9.0;
      vec4 v = voronoi(sp);

      // Break energy accumulates from motion and decays slowly, so a single
      // swipe shatters the glass and it then drifts for a second or two.
      float mv = smoothstep(0.06, 0.30, motion(uv));
      float energy = max(texture2D(uPrev, uv).a * 0.94, mv);

      // Each shard flies outward from the frame centre on its own heading,
      // scaled by its random id so they separate rather than move as one.
      vec2 dir = normalize(uv - 0.5 + 1e-5);
      float spin = (v.w - 0.5) * 2.0;
      vec2 off = (dir * (0.6 + v.w) + vec2(-dir.y, dir.x) * spin * 0.5)
                 * energy * 0.09;
      vec2 suv = clamp(uv + off, 0.001, 0.999);
      vec3 col = texture2D(uTex, suv).rgb;

      // Fracture lines: dark gap plus a bright bevel highlight on one side,
      // which is what sells it as thick glass rather than a painted crack.
      float crack = smoothstep(0.045, 0.0, v.z);
      float bevel = smoothstep(0.16, 0.02, v.z) - crack;
      col = mix(col, vec3(0.02, 0.03, 0.05), crack * energy);
      col += vec3(0.55, 0.75, 1.0) * bevel * energy * 0.55;
      // Fresnel-ish tint per shard so pieces catch different light.
      col *= 1.0 + (v.w - 0.5) * 0.45 * energy;

      gl_FragColor = vec4(col, energy);   // .a carries energy to next frame
    }`,

  // --- Aurora ------------------------------------------------------------
  // A particle-free reaction field: your silhouette emits a signal that
  // propagates outward through the buffer each frame and interferes with
  // itself, producing rippling aurora sheets that bend around your body.
  // Because it is a propagating field, ripples keep travelling after you
  // stop — the box has a memory of where you were.
  Aurora: `
    void main() {
      vec2 uv = vUv;
      vec2 px = 1.0 / uRes;
      float p = person(uv);

      // Propagate: average the neighbourhood of the previous field and let it
      // expand slightly. This is a crude wave step — enough for travelling
      // ripples without a second state texture.
      vec2 c = uv - 0.5;
      vec2 out_ = uv + normalize(c + 1e-5) * px * 1.6;
      float f = texture2D(uPrev, out_).g * 0.36
              + texture2D(uPrev, out_ + vec2(px.x, 0.0) * 1.6).g * 0.16
              + texture2D(uPrev, out_ - vec2(px.x, 0.0) * 1.6).g * 0.16
              + texture2D(uPrev, out_ + vec2(0.0, px.y) * 1.6).g * 0.16
              + texture2D(uPrev, out_ - vec2(0.0, px.y) * 1.6).g * 0.16;
      f *= 0.975;

      // Emit from the silhouette edge, harder where you are moving.
      float rimx = abs(person(uv + vec2(px.x, 0.0) * 2.0) - person(uv - vec2(px.x, 0.0) * 2.0));
      float rimy = abs(person(uv + vec2(0.0, px.y) * 2.0) - person(uv - vec2(0.0, px.y) * 2.0));
      float rim = clamp((rimx + rimy) * 1.5, 0.0, 1.0);
      f = max(f, rim * (0.45 + 1.5 * smoothstep(0.03, 0.25, motion(uv))));
      f = clamp(f, 0.0, 1.0);

      // Fold the field through sine bands so it reads as layered curtains
      // rather than a smooth glow.
      float bands = sin(f * 22.0 - uTime * 2.2 + fbm(uv * 3.0 + uTime * 0.15) * 4.0);
      float sheet = pow(clamp(bands * 0.5 + 0.5, 0.0, 1.0), 3.0) * f;

      // Aurora palette: green core, magenta fringe, cyan tips.
      vec3 col = vec3(0.10, 1.0, 0.55) * sheet * 1.5;
      col += vec3(0.85, 0.25, 1.0) * pow(f, 3.0) * 0.9;
      col += vec3(0.35, 0.85, 1.0) * pow(sheet, 6.0) * 1.2;

      // You stay visible, slightly cooled, standing inside the light.
      vec3 room = texture2D(uTex, uv).rgb;
      col += room * mix(0.22, 0.85, p);
      gl_FragColor = vec4(col.r, f, col.b, 1.0);   // .g carries the field
    }`,
};

function glCompile(src, type) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("shader compile failed: " + log);
  }
  return sh;
}

function glInit() {
  if (gl || glFailed) return gl;
  try {
    gl = glCanvas.getContext("webgl", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      antialias: false,
    });
    if (!gl) throw new Error("no webgl context");

    glQuadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),   // one oversized triangle
      gl.STATIC_DRAW);

    glTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    // CLAMP + LINEAR, and no mipmaps: the source is a non-power-of-two crop,
    // which WebGL1 only supports under exactly these settings.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  } catch (err) {
    console.warn("WebGL unavailable:", err);
    glFailed = true;
    gl = null;
  }
  return gl;
}

function glProgram(name) {
  let entry = glPrograms.get(name);
  if (entry) return entry;
  const vs = glCompile(GL_VERT, gl.VERTEX_SHADER);
  const fs = glCompile(GL_FRAG_HEAD + GL_SHADERS[name], gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error("shader link failed: " + log);
  }
  entry = {
    program,
    uTex: gl.getUniformLocation(program, "uTex"),
    uPrev: gl.getUniformLocation(program, "uPrev"),
    uCamPrev: gl.getUniformLocation(program, "uCamPrev"),
    uDt: gl.getUniformLocation(program, "uDt"),
    uMask: gl.getUniformLocation(program, "uMask"),
    uTime: gl.getUniformLocation(program, "uTime"),
    uRes: gl.getUniformLocation(program, "uRes"),
    uHasMask: gl.getUniformLocation(program, "uHasMask"),
  };
  glPrograms.set(name, entry);
  return entry;
}

function glMakeTex() {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

// (Re)allocate the two feedback targets for a w x h box.
function glEnsureFbo(w, h) {
  if (glFboSize[0] === w && glFboSize[1] === h && glFbo[0]) return;
  for (let i = 0; i < 2; i++) {
    if (glFbo[i]) gl.deleteFramebuffer(glFbo[i]);
    if (glFboTex[i]) gl.deleteTexture(glFboTex[i]);
    glFboTex[i] = glMakeTex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA,
      gl.UNSIGNED_BYTE, null);
    glFbo[i] = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, glFbo[i]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, glFboTex[i], 0);
    // A fresh target holds garbage; clear so the first feedback read is black.
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  glFboSize = [w, h];
}

// Runs `name` over the frame's [bx,by,bw,bh] region and draws the result into
// the already-clipped 2D context. Falls back to the plain feed if GL is
// unavailable or a shader fails, so a driver quirk can never blank the box.
function runShader(name, bx, by, bw, bh, t) {
  if (!glInit()) {
    ctx.drawImage(frame, bx, by, bw, bh, bx, by, bw, bh);
    return;
  }
  try {
    if (glCanvas.width !== bw || glCanvas.height !== bh) {
      glCanvas.width = bw;
      glCanvas.height = bh;
    }
    glEnsureFbo(bw, bh);
    // Switching effects (or resizing) must not inherit the old effect's
    // trails, which would show as a ghost of the previous look.
    if (glPrevName !== name) {
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, glFbo[i]);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      glPrevName = name;
    }

    const p = glProgram(name);
    gl.useProgram(p.program);

    // Unit 0: this frame's crop.
    const g = sizeScratch(sGlSrc, bw, bh);
    g.drawImage(frame, bx, by, bw, bh, 0, 0, bw, bh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sGlSrc.c);
    gl.uniform1i(p.uTex, 0);

    // Unit 1: last frame's output (feedback).
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, glFboTex[glPing]);
    gl.uniform1i(p.uPrev, 1);

    // Unit 2: the person mask, cropped to the same box. Only some effects
    // read it, but binding is cheap and keeps one uniform layout.
    const hasMask = maskReady && segState === "ready";
    if (hasMask) {
      const m = sizeScratch(sGlMask, bw, bh);
      m.clearRect(0, 0, bw, bh);
      m.save();
      m.translate(-bx, -by);
      m.transform(-fit.s, 0, 0, fit.s, fit.ox + fit.s * fit.vw, fit.oy);
      m.scale(fit.vw / maskCanvas.width, fit.vh / maskCanvas.height);
      m.drawImage(maskCanvas, 0, 0);
      m.restore();
      if (!glMaskTex) glMaskTex = glMakeTex();
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, glMaskTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sGlMask.c);
      gl.uniform1i(p.uMask, 2);
    }
    gl.uniform1f(p.uHasMask, hasMask ? 1 : 0);

    // Unit 3: last frame's camera crop, so shaders can measure motion.
    if (!glCamPrevTex) glCamPrevTex = glMakeTex();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, glCamPrevTex);
    gl.uniform1i(p.uCamPrev, 3);

    gl.uniform1f(p.uTime, t / 1000);
    gl.uniform1f(p.uDt, Math.min(0.05, Math.max(0.001, (t - glLastT) / 1000)));
    glLastT = t;
    gl.uniform2f(p.uRes, bw, bh);

    gl.bindBuffer(gl.ARRAY_BUFFER, glQuadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Pass 1: render into the *other* target, which becomes next frame's
    // history. Pass 2: the same draw to the visible canvas.
    const dst = 1 - glPing;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glFbo[dst]);
    gl.viewport(0, 0, bw, bh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, bw, bh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    glPing = dst;

    // Keep this frame's camera crop for the next frame's motion term. Done
    // after drawing so the shader saw the *previous* one.
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, glCamPrevTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sGlSrc.c);

    ctx.drawImage(glCanvas, bx, by);
  } catch (err) {
    console.warn(`Shader ${name} failed:`, err);
    glFailed = true;
    ctx.drawImage(frame, bx, by, bw, bh, bx, by, bw, bh);
  }
}

function fxInferno(bx, by, bw, bh, t) { runShader("Inferno", bx, by, bw, bh, t); }
function fxShatter(bx, by, bw, bh, t) { runShader("Shatter", bx, by, bw, bh, t); }
function fxAurora(bx, by, bw, bh, t)  { runShader("Aurora",  bx, by, bw, bh, t); }

const EFFECT_FNS = [fxPixelate, fxBlur, fxInvert, fxNoir, fxGlitch, fxToon,
                    fxVanGogh, fxAnime, fxMatrix, fxPortal,
                    fxInferno, fxShatter, fxAurora];

// ---------------------------------------------------------------------------
// Frame overlay: corner brackets so the frame reads as a "camera"
// ---------------------------------------------------------------------------

function drawBrackets(q, alpha) {
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

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastVideoTime = -1;
let announcedTracking = false;

function tick(t) {
  requestAnimationFrame(tick);
  computeFit();

  // 1. Refresh the frame canvas (mirrored camera or demo scene)
  if (demoMode) {
    drawDemoScene(t);
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
    raw = (Math.sin(t * 0.0002) > -0.85) ? demoQuad(t) : null;
  } else if (landmarker && cameraReady && video.readyState >= 2) {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const res = landmarker.detectForVideo(video, t);
      raw = computeQuad(res.landmarks);
      const swipe = detectSwipe(res.landmarks, t);
      if (swipe === "right" || swipe === "left") {
        setEffect(effectIndex + (swipe === "right" ? 1 : -1));
        flashStatus(`${swipe === "right" ? "▶" : "◀"} ${EFFECTS[effectIndex]}`);
      } else if (swipe) {
        // Vertical slides walk the current effect's sub-option, so the two
        // axes read as "which effect" and "which variant of it".
        const name = EFFECTS[effectIndex];
        if (name === "Anime") {
          cycleAnimeStyle(swipe === "up" ? 1 : -1);
        } else if (name === "Portal") {
          portalScene = (portalScene + (swipe === "up" ? 1 : -1) +
            PORTAL_SCENES.length) % PORTAL_SCENES.length;
          refreshChips();
          flashStatus(`Portal → ${PORTAL_SCENES[portalScene]}`);
        } else if (name === "Matrix") {
          keepPerson = !keepPerson;
          flashStatus(keepPerson ? "Matrix rain behind you" : "Matrix rain in front");
          if (keepPerson) ensureSegmenter();
        } else {
          flashStatus(`${EFFECTS[effectIndex]} has no variants`);
        }
      }
      // Only segment when an effect actually needs the person mask.
      const fxName = EFFECTS[effectIndex];
      const wantsMask = fxName === "Portal" || fxName === "Inferno" ||
        fxName === "Shatter" || fxName === "Aurora" ||
        (fxName === "Matrix" && keepPerson);
      if (wantsMask && segState === "ready") {
        segmenter.segmentForVideo(video, t, writeMask);
      }
    } else if (smoothQuad) {
      raw = null; // no new video frame; treat as a (buffered) dropout
    }
  }
  updateQuadState(raw);

  if (raw && !announcedTracking && !demoMode) {
    announcedTracking = true;
    setStatus(null);
  }

  // 3. Composite
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(frame, 0, 0);

  if (presence > 0.01 && smoothQuad) {
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
      EFFECT_FNS[effectIndex](bx, by, bw, bh, t);
      ctx.restore();

      drawBrackets(q, ease);
    }
  }
}
