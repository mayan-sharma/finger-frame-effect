// Shadow Clone Jutsu — 影分身の術
//
// Both hands up in the two-finger sign, held together: four clones of you
// poof out of smoke on either side. Each is your live cut-out, played back a
// different beat late, so they move like four separate people rather than
// a mirror. The back pair is smaller and darker, for depth. The sign again
// dispels them, each in its own puff.

import { canvas, ctx, defineEffect, demoPerson, dist, drawMaskSpace,
  drawSmoke, emitSmoke, flashStatus, frame, gagClock, isTwoFingerPose, jpFont,
  latinFont, lerpPt, makeScratch, maskAvailable, maskCanvas, maskImageData,
  MIDDLE_MCP, palmCentre, playSound, sizeScratch, smoothstep, stepSmoke,
  titleCardAt, toScreen, trackedHands, unit, WRIST } from "../api.js";

// Shadow Clone: both hands in the two-finger pose, palm centres within
// CLONE_SIGN_GAP palm lengths, held for CLONE_HOLD_S. Clones replay you from
// a ring buffer of CLONE_BUF cut-outs, captured every other frame.
const CLONE_SIGN_GAP = 1.6;
const CLONE_HOLD_S = 0.4;
const CLONE_BUF = 12;

const clones = {
  active: false, signOn: false, since: 0, armed: true, lost: 0, age: 0, title: 99,
  tick: 0, head: 0, filled: 0,
  // Front pair close in, back pair further out, smaller and later.
  list: [{ off: -0.27, s: 0.94, lag: 3, delay: 0 }, { off: 0.27, s: 0.94, lag: 4, delay: 0.09 },
         { off: -0.5, s: 0.78, lag: 7, delay: 0.18 }, { off: 0.5, s: 0.78, lag: 9, delay: 0.27 }]
    .map((c) => ({ ...c, shown: false, p: 0 })),
};
const sCutout = makeScratch(false); // you, cut out, for the real you on top

const cloneBuf = [];             // ring of your recent cut-outs

function updateClones(res, t) {
  const hands = trackedHands(res, t);
  let sign = null;
  if (hands.length >= 2) {
    const [a, b] = hands, on = clones.signOn;
    if (isTwoFingerPose(a.w, on) && isTwoFingerPose(b.w, on)) {
      const ca = palmCentre(a.pts), cb = palmCentre(b.pts);
      const palm = (dist(a.pts[WRIST], a.pts[MIDDLE_MCP]) + dist(b.pts[WRIST], b.pts[MIDDLE_MCP])) / 2;
      if (dist(ca, cb) < CLONE_SIGN_GAP * palm) sign = lerpPt(ca, cb, 0.5);
    }
  }
  cloneSign(sign, t);
}

// Same latch as Infinite Void's: held for CLONE_HOLD_S it fires once, and
// the sign must be dropped before it can fire again.
function cloneSign(p, t) {
  const now = t / 1000;
  if (!p) {
    if (++clones.lost > 4) { clones.signOn = false; clones.armed = true; }
    return;
  }
  clones.lost = 0;
  if (!clones.signOn) { clones.signOn = true; clones.since = now; }
  if (clones.armed && now - clones.since >= CLONE_HOLD_S) {
    clones.armed = false;
    toggleClones();
  }
}

function toggleClones() {
  clones.active = !clones.active;
  clones.age = 0;
  if (clones.active) {
    clones.title = 0;
    if (!maskAvailable()) flashStatus("Shadow Clone needs the person mask — still loading", 2500);
  }
}

// Your centre in canvas space, from the mask, for placing the puffs.
function personCentre() {
  if (!maskAvailable()) return { x: canvas.width / 2, y: canvas.height * 0.55 };
  const d = maskImageData.data, mw = maskCanvas.width, mh = maskCanvas.height;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < mh; y += 2) {
    for (let x = 0; x < mw; x += 2) {
      const a = d[(y * mw + x) * 4 + 3];
      if (a > 128) { sx += x; sy += y; n++; }
    }
  }
  if (!n) return { x: canvas.width / 2, y: canvas.height * 0.55 };
  return toScreen({ x: (sx / n + 0.5) / mw, y: (sy / n + 0.5) / mh });
}

function poof(x, y, size) {
  playSound("poof", { pan: x, volume: 0.7 });
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2, sp = size * (0.8 + Math.random() * 1.8);
    emitSmoke({
      x: x + Math.cos(a) * size * 0.25, y: y + Math.sin(a) * size * 0.35,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8,
      r0: size * 0.15, r1: size * (0.5 + Math.random() * 0.4), grow: 0.55,
      life: 0.8 + Math.random() * 0.7, alpha: 0.6 + Math.random() * 0.3,
      rise: size * 0.3, drag: 3.5, turb: size * 0.3,
    });
  }
}

// Writes this frame's cut-out of you into the ring buffer the clones play
// back from. Kept below full resolution: it is many frames deep.
function captureClone() {
  if (!maskAvailable()) return;
  const W = canvas.width, H = canvas.height;
  const k = Math.min(0.5, 960 / W), bw = Math.max(2, Math.round(W * k)), bh = Math.max(2, Math.round(H * k));
  clones.head = (clones.head + 1) % CLONE_BUF;
  if (!cloneBuf[clones.head]) cloneBuf[clones.head] = makeScratch(false);
  const g = sizeScratch(cloneBuf[clones.head], bw, bh);
  g.globalCompositeOperation = "copy";
  g.drawImage(frame, 0, 0, bw, bh);
  g.globalCompositeOperation = "destination-in";
  drawMaskSpace(g, maskCanvas, 1.5, k);
  g.globalCompositeOperation = "source-over";
  clones.filled = Math.min(CLONE_BUF, clones.filled + 1);
}

function renderClones(t) {
  const dt = gagClock(t);
  const W = canvas.width, H = canvas.height;
  clones.age += dt;
  clones.title += dt;
  clones.tick++;
  if (clones.tick % 2 === 0) captureClone();

  let any = false;
  for (const c of clones.list) {
    const want = clones.active && clones.age >= c.delay;
    if (want !== c.shown && (clones.active ? clones.age >= c.delay : clones.age >= c.delay * 0.6)) {
      c.shown = want;
      const pc = personCentre();
      poof(W / 2 + c.off * W + (pc.x - W / 2) * c.s, H + (pc.y - H) * c.s, H * 0.2 * c.s);
    }
    c.p += ((c.shown ? 1 : 0) - c.p) * (c.shown ? 0.3 : 0.45);
    if (c.p > 0.01) any = true;
  }

  if (any && clones.filled) {
    // Back row first, so the front pair overlaps it.
    for (const c of [...clones.list].sort((a, b) => a.s - b.s)) {
      if (c.p <= 0.01) continue;
      const lag = Math.min(c.lag, clones.filled - 1);
      const slot = cloneBuf[(clones.head - lag + CLONE_BUF) % CLONE_BUF];
      if (!slot) continue;
      const s = c.s * (0.85 + 0.15 * c.p);
      ctx.save();
      ctx.globalAlpha = c.p;
      if (c.s < 0.9) ctx.filter = "brightness(0.82) saturate(0.9)";
      ctx.translate(W / 2 + c.off * W, H);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -H);
      ctx.drawImage(slot.c, 0, 0, W, H);
      ctx.restore();
    }
    // The real you, back on top.
    if (maskAvailable()) {
      const p = sizeScratch(sCutout, W, H);
      p.globalCompositeOperation = "copy";
      p.drawImage(frame, 0, 0);
      p.globalCompositeOperation = "destination-in";
      drawMaskSpace(p, maskCanvas, 2 * unit());
      p.globalCompositeOperation = "source-over";
      ctx.drawImage(sCutout.c, 0, 0);
    }
  }
  stepSmoke(dt, t / 1000);
  drawSmoke();

  const c = clones.title, env = (a0, b0, c0, d0) => smoothstep(a0, b0, c) * (1 - smoothstep(c0, d0, c));
  titleCardAt("影分身の術", W / 2, H * 0.14, H * 0.085, env(0.05, 0.3, 2.2, 2.8), H * 0.015, jpFont, "rgba(255,140,40,0.95)");
  titleCardAt("SHADOW CLONE JUTSU", W / 2, H * 0.215, H * 0.022, env(0.15, 0.4, 2.2, 2.8), H * 0.012, latinFont, "rgba(255,140,40,0.95)");
}

function resetClones() {
  clones.active = false;
  clones.signOn = false;
  clones.armed = true;
  clones.lost = 0;
  clones.age = 0;
  clones.title = 99;
  clones.filled = 0;
  for (const c of clones.list) { c.shown = false; c.p = 0; }
}

// `f`: summon or dispel.
function triggerClones() {
  toggleClones();
}

// The silhouette with both hands up in the sign at its chest: four clones
// early in each 11 s cycle, dispelled near the end.
function demoClones(t) {
  const { hx, hy } = demoPerson(t, (x, m) => ({
    x: x + m * 0.02, y: frame.height * 0.6, fingers: [[-1.75, 0.09], [-1.4, 0.09]] }));
  const c = t % 11000;
  const holding = (c > 500 && c < 1100) || (c > 8000 && c < 8600);
  cloneSign(holding ? { x: hx, y: hy } : null, t);
}

export default defineEffect({
  id: "shadow-clone",
  name: "Shadow Clone",
  kind: "overlay",
  hint: "✌️✌️ Both hands two-finger sign, held together — Shadow Clone",
  needs: { mask: true },
  hands: updateClones,
  demo: demoClones,
  render: renderClones,
  reset: resetClones,
  trigger: triggerClones,
});
