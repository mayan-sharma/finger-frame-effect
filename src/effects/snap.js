// Snap — 🫰 thumb + middle finger, and half of you turns to dust

import { addSpark, ageOut, canvas, clamp01, ctx, d3, defineEffect, demoPerson,
  drawMaskSpace, drawSparks, FINGER_W_M, fit, flashStatus, frame, gagClock,
  lerpPt, makeScratch, maskAvailable, maskCanvas, maskImageData, MIDDLE_MCP,
  playSound, shakeScreen, sizeScratch, spill, stepSparks, THUMB_TIP, toScreen,
  trackedHands, unit } from "../api.js";

// Snap: thumb and middle fingertips pinched, then sprung apart inside a
// short window, so slowly opening a pinch is not a snap. Then, after the
// film's beat, you dissolve (needs the person mask).
const SNAP_PINCH = 0.3, SNAP_RELEASE = 0.5;
const SNAP_WINDOW_S = 0.25;
const SNAP_DELAY_S = 1.1;
const DUST_S = 3.2;              // seconds for the dissolve to sweep across you
const DUST_HOLD_S = 7;           // gone this long, then you come back
const RETURN_S = 1.4;
const DUST_MAX = 4000;
const DUST_RATE = 2600;          // particles shed per second, at most

// Snap: mask-space layers, the background plate and its fill, the output.
const sSnapHole = makeScratch(false), sSnapErase = makeScratch(false);
const sSnapTmp = makeScratch(false), sSnapPlate = makeScratch(false);
const sSnapFill = makeScratch(false), sSnapOut = makeScratch(false);
const sSnapSample = makeScratch(true);

const snap = {
  phase: "idle", t: 0, prog: 0, // idle | snapped | dusting | gone | returning
  rings: [], pinch: new Map(), hand: null, handLost: 0,
  field: null, fw: 0, fh: 0, holeImg: null, eraseImg: null, cand: null,
  fillAge: 0, demoCycle: -1, lastHand: null, handP: 0,
};
const dust = [];
const snapLevels = [];           // the plate fill's halving pyramid

function updateSnap(res, t) {
  const now = t / 1000;
  const hands = trackedHands(res, t);
  let best = null, bestGap = Infinity;
  for (const h of hands) {
    const gap = d3(h.w[THUMB_TIP], h.w[MIDDLE_MCP + 3]) / h.palm;
    if (gap < bestGap) { bestGap = gap; best = h; }
    const p = h.pts;
    if (gap < SNAP_PINCH) {
      snap.pinch.set(h.key, { t: now, x: (p[THUMB_TIP].x + p[12].x) / 2, y: (p[THUMB_TIP].y + p[12].y) / 2 });
    } else if (gap > SNAP_RELEASE) {
      // Set, then sprung inside the window: a snap. A slow open is not.
      const set = snap.pinch.get(h.key);
      if (set && now - set.t < SNAP_WINDOW_S) doSnap(set.x, set.y, h.scale);
      snap.pinch.delete(h.key);
    }
  }
  if (best) { snap.hand = snap.lastHand = best; snap.handLost = 0; }
  else if (++snap.handLost > 8) snap.hand = null;
}

function doSnap(x, y, scale) {
  snap.rings.push({ x, y, s: scale, age: 0 });
  for (let i = 0; i < 26; i++) {
    addSpark(x, y, Math.random() * Math.PI * 2, scale * (0.3 + Math.random() * 0.7),
             0.2 + Math.random() * 0.35, scale * 0.6, i % 3 ? "#ffe9a8" : "#ffffff");
  }
  shakeScreen(scale * 0.004);
  playSound("snap", { pan: x });
  if (snap.phase === "idle") {
    snap.phase = "snapped";
    snap.t = 0;
    if (!maskAvailable()) flashStatus("Snap needs the person mask — still loading", 2500);
  } else if (snap.phase === "dusting" || snap.phase === "gone") {
    // Snap again to undo it.
    snap.phase = "returning";
    snap.t = 0;
    playSound("rewind", { duration: RETURN_S });
  }
}

// The order you dissolve in, one value per mask pixel: mostly a sweep from
// the side the wind blows toward (so the dust never flies across parts of you
// still standing), broken up by two octaves of value noise.
function buildDustField(mw, mh) {
  const grid = (gw, gh) => {
    const v = new Float32Array((gw + 1) * (gh + 1)).map(() => Math.random());
    return (x, y) => {
      const fx = x * gw, fy = y * gh, ix = Math.min(gw - 1, fx | 0), iy = Math.min(gh - 1, fy | 0);
      const ax = fx - ix, ay = fy - iy, r = gw + 1;
      const a = v[iy * r + ix], b = v[iy * r + ix + 1], c = v[(iy + 1) * r + ix], d = v[(iy + 1) * r + ix + 1];
      return (a + (b - a) * ax) + ((c + (d - c) * ax) - (a + (b - a) * ax)) * ay;
    };
  };
  const n1 = grid(10, 8), n2 = grid(36, 28);
  const f = new Float32Array(mw * mh);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      // Mask x is unmirrored video space, so screen-right is mask-left.
      const v = 0.55 * ((x + 0.5) / mw) + 0.3 * n1(x / mw, y / mh) + 0.15 * n2(x / mw, y / mh);
      f[y * mw + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) / (hi - lo || 1);
  snap.field = f;
  snap.fw = mw;
  snap.fh = mh;
}

// Two mask-space layers per frame: `hole` (you, generously dilated — what
// the background plate must not learn from) and `erase` (the part of you
// that has turned to dust so far). Newly crossed pixels shed particles.
function stepDustMask(prog, prevProg) {
  const mw = maskCanvas.width, mh = maskCanvas.height;
  const hole = sizeScratch(sSnapHole, mw, mh), erase = sizeScratch(sSnapErase, mw, mh);
  if (!snap.holeImg || snap.holeImg.width !== mw || snap.holeImg.height !== mh) {
    snap.holeImg = hole.createImageData(mw, mh);
    snap.eraseImg = erase.createImageData(mw, mh);
    snap.holeImg.data.fill(255);
    snap.eraseImg.data.fill(255);
    snap.cand = new Int32Array(mw * mh);
    snap.dil = new Uint8Array(mw * mh);
    snap.dilTmp = new Uint8Array(mw * mh);
  }
  if (!snap.field || snap.fw !== mw || snap.fh !== mh) buildDustField(mw, mh);
  const src = maskImageData.data, hd = snap.holeImg.data, ed = snap.eraseImg.data, f = snap.field;
  const erasing = snap.phase !== "idle" && snap.phase !== "snapped";
  // Progress maps a little past the field's range so the first and last
  // pixels go at a definite moment rather than asymptotically.
  const thr = prog * 1.1 - 0.05, prevThr = prevProg * 1.1 - 0.05;
  const shed = snap.phase === "dusting";
  // The hole is dilated by two mask pixels (a separable max). A soft edge is
  // not enough: the plate is painted over every frame, so even a sliver of
  // you left in at half strength builds up into a full-strength outline.
  const dil = snap.dil, tmp = snap.dilTmp, R = 2;
  for (let i = 0; i < f.length; i++) dil[i] = src[i * 4 + 3] > 30 ? 1 : 0;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      let m = 0;
      for (let k = Math.max(0, x - R); k <= Math.min(mw - 1, x + R) && !m; k++) m = dil[y * mw + k];
      tmp[y * mw + x] = m;
    }
  }
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      let m = 0;
      for (let k = Math.max(0, y - R); k <= Math.min(mh - 1, y + R) && !m; k++) m = tmp[k * mw + x];
      hd[(y * mw + x) * 4 + 3] = m ? 255 : 0;
    }
  }
  let nc = 0;
  for (let i = 0, p = 3; i < f.length; i++, p += 4) {
    const conf = src[p];
    if (!erasing) continue;
    // Boosted, so the mask's soft edge goes too instead of leaving a ghost.
    const e = clamp01((thr - f[i]) / 0.05);
    ed[p] = Math.min(255, conf * 2) * e;
    if (shed && conf > 120 && f[i] <= thr && f[i] > prevThr) snap.cand[nc++] = i;
  }
  hole.putImageData(snap.holeImg, 0, 0);
  if (erasing) erase.putImageData(snap.eraseImg, 0, 0);
  return nc;
}

// The background behind you, learned from every pixel you are not covering.
// Where you have never moved away it is a push-pull fill: the holed frame is
// halved down to a few pixels, each level averaging only what is not you
// (holes are transparent, and canvas averages premultiplied colour), then
// the levels are painted back up coarsest first, so each hole takes the
// colour of what surrounds it.
function updatePlate() {
  const W = canvas.width, H = canvas.height;
  const tmp = sizeScratch(sSnapTmp, W, H);
  tmp.globalCompositeOperation = "copy";
  tmp.drawImage(frame, 0, 0);
  tmp.globalCompositeOperation = "destination-out";
  drawMaskSpace(tmp, sSnapHole.c, 3 * unit());
  tmp.globalCompositeOperation = "source-over";

  const fresh = sSnapPlate.c.width !== W || sSnapPlate.c.height !== H;
  const plate = sizeScratch(sSnapPlate, W, H);
  if (fresh) plate.clearRect(0, 0, W, H);
  plate.drawImage(sSnapTmp.c, 0, 0);

  if (!fresh && snap.fillAge++ % 20) return;
  let src = sSnapTmp.c, w = W, h = H, k = 0;
  while (w > 8 || h > 8) {
    w = Math.max(1, Math.ceil(w / 2));
    h = Math.max(1, Math.ceil(h / 2));
    if (!snapLevels[k]) snapLevels[k] = makeScratch(true);
    const g = sizeScratch(snapLevels[k], w, h);
    g.globalCompositeOperation = "copy";
    g.drawImage(src, 0, 0, w, h);
    src = snapLevels[k].c;
    k++;
  }
  // The coarsest level is made opaque: nothing is left unfilled unless you
  // cover the whole frame, and then its average is the best there is.
  const top = snapLevels[k - 1];
  const img = top.g.getImageData(0, 0, w, h), d = img.data;
  let r = 0, gr = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++; }
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 8 && n) { d[i] = r / n; d[i + 1] = gr / n; d[i + 2] = b / n; }
    d[i + 3] = 255;
  }
  top.g.putImageData(img, 0, 0);
  const fill = sizeScratch(sSnapFill, W, H);
  fill.globalCompositeOperation = "copy";
  for (let j = k - 1; j >= 0; j--) {
    fill.drawImage(snapLevels[j].c, 0, 0, W, H);
    fill.globalCompositeOperation = "source-over";
  }
}

function shedDust(nc, dt) {
  if (!nc) return;
  const W = canvas.width, H = canvas.height;
  // Colours come from a small copy of the feed, read back once per frame.
  const sw = Math.max(1, Math.round(W / 6)), sh = Math.max(1, Math.round(H / 6));
  const sg = sizeScratch(sSnapSample, sw, sh);
  sg.drawImage(frame, 0, 0, sw, sh);
  const px = sg.getImageData(0, 0, sw, sh).data;
  const mw = maskCanvas.width, mh = maskCanvas.height;
  const cell = fit.s * fit.vw / mw;
  const budget = Math.min(DUST_MAX - dust.length, Math.ceil(DUST_RATE * dt), nc);
  const u = unit();
  for (let k = 0; k < budget; k++) {
    const i = snap.cand[(Math.random() * nc) | 0];
    const s = toScreen({ x: ((i % mw) + Math.random()) / mw, y: (((i / mw) | 0) + Math.random()) / mh });
    if (s.x < 0 || s.y < 0 || s.x >= W || s.y >= H) continue;
    const q = (((s.y / H * sh) | 0) * sw + ((s.x / W * sw) | 0)) * 4;
    dust.push({
      x: s.x, y: s.y,
      vx: (Math.random() - 0.3) * cell * 4, vy: (Math.random() - 0.6) * cell * 4,
      r: px[q], g: px[q + 1], b: px[q + 2],
      size: u * (2 + Math.random() * 3.5), age: 0, life: 1.8 + Math.random() * 1.6,
      wind: 0.6 + Math.random() * 0.8,
    });
  }
}

function stepDust(dt, time) {
  const W = canvas.width, H = canvas.height, k = (Math.PI * 2) / (H * 0.2);
  let n = 0;
  for (const p of dust) {
    p.age += dt;
    if (p.age >= p.life) continue;
    // Blown right and a little up, through a curling flow field.
    p.vx += (W * 0.09 * p.wind + Math.sin(p.y * k + time * 1.3) * H * 0.08) * dt;
    p.vy += (-H * 0.03 + Math.cos(p.x * k * 1.2 + time) * H * 0.06) * dt;
    p.vx *= Math.exp(-0.6 * dt);
    p.vy *= Math.exp(-0.6 * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    dust[n++] = p;
  }
  dust.length = n;
}

function drawDust() {
  for (const p of dust) {
    const u = p.age / p.life;
    // Fades to ash as it goes.
    const m = Math.min(1, u * 1.6);
    const r = (p.r + (95 - p.r) * m) | 0, g = (p.g + (85 - p.g) * m) | 0, b = (p.b + (78 - p.b) * m) | 0;
    ctx.fillStyle = `rgba(${r},${g},${b},${(1 - u * u).toFixed(3)})`;
    const s = p.size * (1 - 0.5 * u);
    ctx.fillRect(p.x, p.y, s, s);
  }
}

// The Infinity Gauntlet, painted over whichever hand is nearest a snap: gold
// blended in "color" mode so the hand's own shading shows through, then the
// six stones on the knuckles, thumb and back of the hand.
function drawGauntlet(h, alpha, t) {
  const p = h.pts, fw = h.scale * FINGER_W_M;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const shape = () => {
    ctx.beginPath();
    for (const i of [0, 1, 2, 5, 9, 13, 17]) ctx.lineTo(p[i].x, p[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (const chain of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
      ctx.moveTo(p[chain[0]].x, p[chain[0]].y);
      for (const i of chain) ctx.lineTo(p[i].x, p[i].y);
    }
    ctx.stroke();
  };
  ctx.lineWidth = fw * 1.05;
  ctx.globalCompositeOperation = "color";
  ctx.fillStyle = ctx.strokeStyle = "#d9a520";
  shape();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = ctx.strokeStyle = "#ffcf3a";
  shape();

  ctx.globalAlpha = alpha;
  const stone = (pt, color, r) => {
    const pulse = 1 + 0.15 * Math.sin(t * 0.004 + pt.x);
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 3.2 * pulse);
    halo.addColorStop(0, color + "aa");
    halo.addColorStop(1, color + "00");
    ctx.fillStyle = halo;
    ctx.fillRect(pt.x - r * 3.2 * pulse, pt.y - r * 3.2 * pulse, r * 6.4 * pulse, r * 6.4 * pulse);
    ctx.globalCompositeOperation = "source-over";
    const gem = ctx.createRadialGradient(pt.x - r * 0.35, pt.y - r * 0.35, 0, pt.x, pt.y, r);
    gem.addColorStop(0, "#ffffff");
    gem.addColorStop(0.35, color);
    gem.addColorStop(1, "#1a1206");
    ctx.fillStyle = gem;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const r = fw * 0.3;
  stone(lerpPt(p[5], p[0], 0.1), "#a34dff", r);   // power
  stone(lerpPt(p[9], p[0], 0.1), "#ff2d3d", r);   // reality
  stone(lerpPt(p[13], p[0], 0.1), "#2f7bff", r);  // space
  stone(lerpPt(p[17], p[0], 0.1), "#ff9a1f", r);  // soul
  stone(lerpPt(p[2], p[3], 0.5), "#2fd45a", r);   // time
  stone(lerpPt(p[9], p[0], 0.5), "#ffe14a", r * 1.45); // mind
  ctx.restore();
}

function drawSnapRings() {
  for (const r of snap.rings) spill(r.x, r.y, r.s * 0.5, "255,228,160", 0.55 * (1 - Math.min(1, r.age / 0.3)));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const r of snap.rings) {
    const u = r.age / 0.6;
    const rad = r.s * (0.02 + 0.25 * Math.sqrt(u));
    ctx.globalAlpha = 1 - u;
    ctx.strokeStyle = "#ffe9a8";
    ctx.lineWidth = r.s * 0.008 * (1 - u) + 1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
    ctx.stroke();
    if (r.age < 0.12) {
      const fl = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.s * 0.12);
      fl.addColorStop(0, `rgba(255,255,255,${1 - r.age / 0.12})`);
      fl.addColorStop(1, "rgba(255,230,160,0)");
      ctx.fillStyle = fl;
      ctx.fillRect(r.x - r.s * 0.12, r.y - r.s * 0.12, r.s * 0.24, r.s * 0.24);
    }
  }
  ctx.restore();
}

function renderSnap(t) {
  const dt = gagClock(t);
  const prevProg = snap.prog;
  snap.t += dt;
  if (snap.phase === "snapped" && snap.t >= SNAP_DELAY_S) {
    snap.phase = "dusting";
    snap.t = 0;
    snap.field = null;            // a new pattern every time
    playSound("whoosh", { duration: DUST_S, volume: 0.8 });
  }
  if (snap.phase === "dusting") {
    snap.prog = Math.min(1, snap.t / DUST_S);
    if (snap.t >= DUST_S) { snap.phase = "gone"; snap.t = 0; }
  } else if (snap.phase === "gone") {
    snap.prog = 1;
    if (snap.t >= DUST_HOLD_S) {
      snap.phase = "returning";
      snap.t = 0;
      playSound("rewind", { duration: RETURN_S });
    }
  } else if (snap.phase === "returning") {
    snap.prog = Math.max(0, snap.prog - dt / RETURN_S);
    if (snap.prog <= 0) { snap.phase = "idle"; snap.t = 0; }
  } else {
    snap.prog = 0;
  }

  if (maskAvailable()) {
    const nc = stepDustMask(snap.prog, prevProg);
    updatePlate();
    if (snap.prog > 0) {
      const W = canvas.width, H = canvas.height;
      const out = sizeScratch(sSnapOut, W, H);
      out.globalCompositeOperation = "copy";
      out.drawImage(sSnapFill.c, 0, 0);
      out.globalCompositeOperation = "source-over";
      out.drawImage(sSnapPlate.c, 0, 0);
      out.globalCompositeOperation = "destination-in";
      drawMaskSpace(out, sSnapErase.c, 2 * unit());
      out.globalCompositeOperation = "source-over";
      ctx.drawImage(sSnapOut.c, 0, 0);
    }
    shedDust(nc, dt);
  }

  ageOut(snap.rings, dt, 0.6);
  stepDust(dt, t / 1000);
  stepSparks(dt);
  drawDust();
  // The gauntlet goes with the rest of you.
  // It fades with the hand rather than blinking out on a dropped frame.
  snap.handP += ((snap.hand ? 1 : 0) - snap.handP) * (snap.hand ? 0.25 : 0.12);
  if (snap.lastHand && snap.handP > 0.01) drawGauntlet(snap.lastHand, snap.handP * (1 - snap.prog), t);
  drawSnapRings();
  drawSparks();
}

function resetSnap() {
  snap.phase = "idle";
  snap.t = 0;
  snap.prog = 0;
  snap.rings.length = 0;
  snap.pinch.clear();
  snap.hand = null;
  snap.field = null;
  snap.fillAge = 0;
  dust.length = 0;
  // Next time, the plate is learned from scratch.
  sSnapPlate.c.width = sSnapPlate.c.height = 1;
}

function triggerSnap() {
  const h = snap.hand;
  if (h) doSnap(h.pts[THUMB_TIP].x, h.pts[THUMB_TIP].y, h.scale);
  else doSnap(canvas.width * 0.5, canvas.height * 0.5, canvas.height / 0.55);
}

// The silhouette, with a snapping hand up by the shoulder.
function demoSnap(t) {
  const { hx, hy, m } = demoPerson(t, (x, m) => ({
    x: x + m * 0.25, y: frame.height * 0.5, fingers: [[-1.9, 0.08], [-1.3, 0.085]] }));

  // A fake gauntlet hand, and a snap early in each 15 s cycle.
  const pts = [];
  for (let i = 0; i < 21; i++) {
    const f = Math.floor((i - 1) / 4), k = ((i - 1) % 4 + 1) / 4;
    const a = i === 0 ? 0 : -2.2 + f * 0.25;
    pts[i] = i === 0 ? { x: hx, y: hy + m * 0.05 }
                     : { x: hx + Math.cos(a) * m * (0.02 + 0.07 * k), y: hy + Math.sin(a) * m * (0.02 + 0.07 * k) };
  }
  snap.hand = snap.lastHand = { pts, scale: m };
  const cycle = Math.floor(t / 15000);
  if (t % 15000 > 1500 && snap.demoCycle !== cycle) {
    snap.demoCycle = cycle;
    doSnap(hx, hy - m * 0.06, m);
  }
}

export default defineEffect({
  id: "snap",
  name: "Snap",
  kind: "overlay",
  hint: "🫰 Snap your fingers… and step back into the frame",
  needs: { mask: true },
  hands: updateSnap,
  demo: demoSnap,
  render: renderSnap,
  reset: resetSnap,
  trigger: triggerSnap,
});
