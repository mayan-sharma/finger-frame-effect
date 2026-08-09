// Finger Frame Effect
// Hold both hands up in an open "L" (thumb + index spread). The four fingertips
// form a quad, and the selected visual effect renders inside it.
// Keys 1-7 switch effects; arrow keys / click cycle. Append ?demo for a
// synthetic scene when no camera is available.

"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_TIP = 8, MIDDLE_MCP = 9;

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

const EFFECTS = ["Pixelate", "Blur", "Invert", "Noir", "Glitch", "Toon", "Van Gogh"];

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

function sizeScratch(s, w, h) {
  if (s.c.width !== w || s.c.height !== h) { s.c.width = w; s.c.height = h; }
  return s.g;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let landmarker = null;
let demoMode = new URLSearchParams(location.search).has("demo");
let cameraReady = false;
let effectIndex = 0;

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
    el.innerHTML = `<span class="k">${i + 1}</span>${name}`;
    el.addEventListener("click", () => setEffect(i));
    hintEl.appendChild(el);
  });
}
function setEffect(i) {
  effectIndex = (i + EFFECTS.length) % EFFECTS.length;
  [...hintEl.children].forEach((el, j) => el.classList.toggle("active", j === effectIndex));
}
buildHint();

addEventListener("keydown", (e) => {
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= EFFECTS.length) setEffect(n - 1);
  else if (e.key === "ArrowRight") setEffect(effectIndex + 1);
  else if (e.key === "ArrowLeft") setEffect(effectIndex - 1);
});
canvas.addEventListener("click", () => setEffect(effectIndex + 1));

function setStatus(text) {
  if (text === null) { statusEl.classList.add("hidden"); return; }
  statusEl.textContent = text;
  statusEl.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Camera + MediaPipe init
// ---------------------------------------------------------------------------

async function initTracker() {
  const { FilesetResolver, HandLandmarker } = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"
  );
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  landmarker = await HandLandmarker.createFromOptions(fileset, {
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
    setStatus("Demo mode — synthetic frame, keys 1-7 switch effects");
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

const EFFECT_FNS = [fxPixelate, fxBlur, fxInvert, fxNoir, fxGlitch, fxToon, fxVanGogh];

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
