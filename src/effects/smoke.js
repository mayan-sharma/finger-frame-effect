// Smoke — a lit cigarette between two raised fingers, and an exhale
//
// No frame: an overlay on the whole feed with two independent triggers. A
// hand showing exactly two fingers gets a cigarette pinched between them; a
// thumbs-up on the other hand is a lighter, and holding its flame to the tip
// lights it (or press `l`). Once it is lit, an open mouth breathes smoke.

import { clamp, clamp01, ctx, defineEffect, DEMO_SKIN, dist, drawSmoke,
  emitSmoke, fctx, FINGER_W_M, fingerStraightness, flashStatus, frame,
  handPxPerMetre, INDEX_MCP, isTwoFingerPose, lerpPt, makeScratch, MIDDLE_MCP,
  mouth, PINKY_MCP, POSE_DOWN_OFF, POSE_DOWN_ON, RING_MCP, sizeScratch,
  smokeParts, stepSmoke, THUMB_IP, THUMB_TIP, toScreen, WRIST } from "../api.js";

const CIG_CONFIRM_FRAMES = 3;    // frames the pose must hold before it lights
const CIG_LOST_FRAMES = 8;       // frames it survives a tracking dropout

// Real-world sizes, in metres, scaled by the hand's measured pixels-per-metre
// so the cigarette stays in proportion at any distance from the camera.
const CIG_LEN_M = 0.09;
const CIG_DIA_M = 0.0102;
const CIG_GRIP = 0.2;            // fraction of its length behind the grip point
const CIG_TILT = 0.3;            // radians it leans toward the fingertips

// The lighter is the other hand in a thumbs-up: four fingers curled, and the
// thumb tip well clear of the index finger's middle joint. That reach is in
// palm lengths (wrist -> middle knuckle), so it holds for any hand size, and
// it is a hysteresis pair like the rest.
const THUMB_UP_ON = 0.52, THUMB_UP_OFF = 0.42;
const LIGHTER_CONFIRM_FRAMES = 2;
const LIGHTER_LOST_FRAMES = 6;
const FLAME_H_M = 0.042, FLAME_W_M = 0.013;
const LIGHT_S = 0.35;            // seconds of flame on the tip before it catches
const CIG_OUT_S = 6;             // seconds put away before the next one is unlit

const BREATH_S = 2.6;            // seconds for a held-open exhale to thin out
const BREATH_REFILL_S = 1.4;
const EXHALE_RATE = 150;         // particles per second at full breath
const WISP_RATE = 60;            // ... rising off the lit tip

const sCig = makeScratch(false);     // cigarette, with the finger cut out of it

const cig = {
  on: false, seen: 0, lost: 0, presence: 0,
  x: 0, y: 0, ang: 0, len: 0,   // filter end, direction, length (canvas px)
  side: 1,                      // which way it sticks out across the fingers
  finger: null, fingerW: 0,     // the index finger, redrawn in front of it
  glow: 0.45,
  lit: false, heat: 0, away: 0, // lit state, seconds in the flame, seconds gone
};
const lighter = {
  on: false, seen: 0, lost: 0, presence: 0,
  x: 0, y: 0, px: 0,            // flame base (canvas px) and where it was last frame
  scale: 1,                     // that hand's pixels per metre
  vx: 0, lean: 0,               // sideways speed, and the tilt it gives the flame
  sparks: [],
};
let smokeNudgeT = -1e9;         // last time the "light it first" hint was shown

let smokeLastT = 0;
let wispAcc = 0, exhaleAcc = 0;

// Where the cigarette goes, from screen-space hand points. It is gripped
// between the two fingers just below their last joints and lies across them,
// sticking out past the index finger and leaning a little toward the tips.
function cigTarget(pts, pxPerM) {
  const gi = lerpPt(pts[6], pts[7], 0.55);      // grip point on the index...
  const gm = lerpPt(pts[10], pts[11], 0.55);    // ...and on the middle finger
  const gx = (gi.x + gm.x) / 2, gy = (gi.y + gm.y) / 2;

  // Shared finger axis, knuckle -> tip.
  let fx = (pts[8].x - pts[5].x) + (pts[12].x - pts[9].x);
  let fy = (pts[8].y - pts[5].y) + (pts[12].y - pts[9].y);
  const fl = Math.hypot(fx, fy) || 1;
  fx /= fl; fy /= fl;

  // Which perpendicular is "past the index finger". When the hand turns
  // edge-on the two fingers overlap and this goes to noise, so the last
  // confident answer is kept.
  const px = -fy, py = fx;
  const across = (gi.x - gm.x) * px + (gi.y - gm.y) * py;
  if (Math.abs(across) > 0.004 * pxPerM) cig.side = across > 0 ? 1 : -1;

  const c = Math.cos(CIG_TILT) * cig.side, t = Math.sin(CIG_TILT);
  const dx = px * c + fx * t, dy = py * c + fy * t;
  const len = CIG_LEN_M * pxPerM;
  return {
    x: gx - dx * len * CIG_GRIP,
    y: gy - dy * len * CIG_GRIP,
    ang: Math.atan2(dy, dx),
    len,
    finger: [pts[5], pts[6], pts[7], pts[8]],
    fingerW: FINGER_W_M * pxPerM,
  };
}

function applyCigTarget(target) {
  if (!target) {
    cig.seen = 0;
    if (++cig.lost > CIG_LOST_FRAMES) cig.on = false;
    return;
  }
  cig.lost = 0;
  if (++cig.seen < CIG_CONFIRM_FRAMES && !cig.on) return;

  // Snap on first appearance or when it jumps to the other hand; otherwise
  // smooth lightly. Heavier smoothing would let it lag behind the fingers,
  // which reads far worse than a pixel of jitter.
  const jumped = Math.hypot(target.x - cig.x, target.y - cig.y) > target.len * 1.5;
  if (!cig.on || jumped) {
    cig.x = target.x; cig.y = target.y; cig.ang = target.ang; cig.len = target.len;
  } else {
    cig.x += (target.x - cig.x) * 0.65;
    cig.y += (target.y - cig.y) * 0.65;
    const da = target.ang - cig.ang;
    cig.ang += Math.atan2(Math.sin(da), Math.cos(da)) * 0.45;
    cig.len += (target.len - cig.len) * 0.3;
  }
  // The finger is cut out at its raw position: that is where it is in the
  // video frame this was measured on.
  cig.finger = target.finger;
  cig.fingerW = target.fingerW;
  cig.on = true;
}

// Thumbs-up: every finger curled, thumb sticking well out of the fist.
function isLighterPose(w, latched) {
  const down = latched ? POSE_DOWN_OFF : POSE_DOWN_ON;
  for (const mcp of [INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]) {
    if (fingerStraightness(w, mcp) >= down) return false;
  }
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const reach = d3(w[THUMB_TIP], w[INDEX_MCP + 1]) / (d3(w[WRIST], w[MIDDLE_MCP]) || 1);
  return reach > (latched ? THUMB_UP_OFF : THUMB_UP_ON);
}

function applyLighterTarget(target) {
  if (!target) {
    lighter.seen = 0;
    if (++lighter.lost > LIGHTER_LOST_FRAMES) lighter.on = false;
    return;
  }
  lighter.lost = 0;
  if (++lighter.seen < LIGHTER_CONFIRM_FRAMES && !lighter.on) return;
  lighter.scale = target.scale;
  if (!lighter.on) {
    // The flick: it catches with a spray of sparks.
    lighter.x = lighter.px = target.x;
    lighter.y = target.y;
    lighter.vx = lighter.lean = 0;
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = target.scale * (0.25 + Math.random() * 0.55);
      lighter.sparks.push({
        x: target.x, y: target.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        age: 0, life: 0.18 + Math.random() * 0.25,
      });
    }
  } else {
    lighter.x += (target.x - lighter.x) * 0.65;
    lighter.y += (target.y - lighter.y) * 0.65;
  }
  lighter.on = true;
}

// One pass over the tracked hands: the first showing two fingers holds the
// cigarette, the first thumbs-up is the lighter.
function updateSmokeHands(res) {
  const hands = res.landmarks || [];
  let cigT = null, lightT = null;
  for (let i = 0; i < hands.length; i++) {
    const world = res.worldLandmarks && res.worldLandmarks[i];
    const w = world || hands[i];
    if (!cigT && isTwoFingerPose(w, cig.on)) {
      const pts = hands[i].map(toScreen);
      cigT = cigTarget(pts, handPxPerMetre(pts, world));
    } else if (!lightT && isLighterPose(w, lighter.on)) {
      const pts = hands[i].map(toScreen);
      const scale = handPxPerMetre(pts, world);
      // The flame sits just past the thumb tip, along the thumb.
      const tip = pts[THUMB_TIP], ip = pts[THUMB_IP];
      const len = dist(tip, ip) || 1;
      const off = 0.008 * scale / len;
      lightT = { x: tip.x + (tip.x - ip.x) * off, y: tip.y + (tip.y - ip.y) * off, scale };
    }
  }
  applyCigTarget(cigT);
  applyLighterTarget(lightT);
}

function lightCigarette() {
  cig.lit = true;
  cig.heat = 0;
  cig.glow = 1;
  // It catches with a puff.
  if (cig.on) for (let i = 0; i < 18; i++) emitWisp();
}

function resetSmoke() {
  smokeParts.length = 0;
  cig.on = false; cig.seen = 0; cig.lost = 0; cig.presence = 0;
  cig.lit = false; cig.heat = 0; cig.away = 0;
  lighter.on = false; lighter.seen = 0; lighter.lost = 0; lighter.presence = 0;
  lighter.sparks.length = 0;
  mouth.seen = false; mouth.latched = false; mouth.open = 0; mouth.breath = 1;
  smokeLastT = 0;
}

function emitWisp() {
  const L = cig.len;
  const tx = cig.x + Math.cos(cig.ang) * L, ty = cig.y + Math.sin(cig.ang) * L;
  const r = L * (CIG_DIA_M / CIG_LEN_M);
  emitSmoke({
    x: tx + (Math.random() - 0.5) * r, y: ty + (Math.random() - 0.5) * r,
    vx: (Math.random() - 0.5) * L * 0.15, vy: -L * (0.5 + Math.random() * 0.4),
    r0: r * 0.6, r1: L * (0.22 + Math.random() * 0.16), grow: 1.1, fine: true,
    life: 1.9 + Math.random() * 1.2, alpha: 0.20 + Math.random() * 0.10,
    rise: L * 1.5, drag: 0.8, turb: L * 1.3,
  });
}

function emitExhale() {
  const w = mouth.w;
  // Along the lip line, then out in a fan centred on "down the face".
  const along = (Math.random() - 0.5) * w * 0.45;
  const lx = -Math.sin(mouth.dir), ly = Math.cos(mouth.dir);
  const a = mouth.dir + (Math.random() - 0.5) * 1.0;
  const sp = w * (3.0 + Math.random() * 2.6);
  emitSmoke({
    x: mouth.x + lx * along, y: mouth.y + ly * along,
    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
    r0: Math.max(mouth.gap * 0.5, w * 0.1), r1: w * (1.3 + Math.random() * 1.3), grow: 0.75,
    life: 2.4 + Math.random() * 1.8, alpha: 0.22 + Math.random() * 0.12,
    rise: w * 2.4, drag: 1.5, turb: w * 2.2,
  });
}

// --- The cigarette ----------------------------------------------------------

// Drawn in its own space: x runs from the filter end (0) to the tip (L), y
// across its width (+/-R). `hot` is 1 when lit; before that it is how far the
// tip has got toward catching (0..1), and it glows to match.
function paintCigarette(g, L, R, glow, lit, hot) {
  const filt = L * 0.27, ash = L * 0.075, ember = L * 0.03;
  const paperEnd = lit ? L - ash - ember : L - L * 0.02;

  const paper = g.createLinearGradient(0, -R, 0, R);
  paper.addColorStop(0, "#d6d3cc");
  paper.addColorStop(0.28, "#ffffff");
  paper.addColorStop(0.62, "#ecebe6");
  paper.addColorStop(1, "#a19d95");
  g.fillStyle = paper;
  g.fillRect(filt, -R, paperEnd - filt, R * 2);

  const cork = g.createLinearGradient(0, -R, 0, R);
  cork.addColorStop(0, "#b4722c");
  cork.addColorStop(0.28, "#eab064");
  cork.addColorStop(0.62, "#cf8c3e");
  cork.addColorStop(1, "#84501d");
  g.fillStyle = cork;
  g.beginPath();
  g.roundRect(0, -R, filt + 0.5, R * 2, [R * 0.35, 0, 0, R * 0.35]);
  g.fill();
  // Cork flecks, fixed so they do not crawl from frame to frame.
  g.fillStyle = "rgba(255,226,170,0.5)";
  for (let i = 0; i < 16; i++) {
    const hx = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const hy = Math.abs(Math.sin(i * 78.233) * 12345.678) % 1;
    g.fillRect(hx * filt * 0.9, (hy * 2 - 1) * R * 0.8, R * 0.22, R * 0.16);
  }
  g.fillStyle = "rgba(176,136,58,0.95)";
  g.fillRect(filt, -R, Math.max(1, L * 0.013), R * 2);

  if (!lit) {
    // Fresh: paper right to the end, with the cut tobacco showing, which
    // starts to glow as the flame is held on it.
    g.fillStyle = "#6e4a2a";
    g.fillRect(paperEnd, -R, L - paperEnd, R * 2);
    if (hot > 0) {
      const warm = g.createLinearGradient(L - L * 0.09, 0, L, 0);
      warm.addColorStop(0, "rgba(255,120,30,0)");
      warm.addColorStop(1, `rgba(255,${Math.round(110 + 80 * hot)},40,${hot})`);
      g.fillStyle = warm;
      g.fillRect(L - L * 0.09, -R, L * 0.09, R * 2);
    }
    const shade = g.createLinearGradient(0, -R, 0, R);
    shade.addColorStop(0.55, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.30)");
    g.fillStyle = shade;
    g.fillRect(paperEnd, -R, L - paperEnd, R * 2);
    return;
  }

  // Scorched paper, then the ember, then grey ash with a ragged end.
  const burn = g.createLinearGradient(paperEnd - L * 0.035, 0, paperEnd, 0);
  burn.addColorStop(0, "rgba(70,45,25,0)");
  burn.addColorStop(1, "rgba(45,28,18,0.85)");
  g.fillStyle = burn;
  g.fillRect(paperEnd - L * 0.035, -R, L * 0.035, R * 2);

  g.fillStyle = `rgb(255,${Math.round(70 + 120 * glow)},${Math.round(15 + 60 * glow)})`;
  g.fillRect(paperEnd, -R, ember + 0.5, R * 2);

  const ashG = g.createLinearGradient(L - ash, 0, L, 0);
  ashG.addColorStop(0, `rgb(${Math.round(130 + 90 * glow)},${Math.round(50 + 40 * glow)},30)`);
  ashG.addColorStop(0.3, "#4b4644");
  ashG.addColorStop(1, "#8f8b88");
  g.fillStyle = ashG;
  g.beginPath();
  g.roundRect(L - ash, -R, ash, R * 2, [0, R * 0.75, R * 0.55, 0]);
  g.fill();

  // The paper and cork gradients already shade across the width; the ash and
  // ember do not, so one pass of shadow along the underside ties them in.
  const shade = g.createLinearGradient(0, -R, 0, R);
  shade.addColorStop(0.55, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.30)");
  g.fillStyle = shade;
  g.fillRect(paperEnd, -R, L - paperEnd, R * 2);
}

function drawCigarette(t) {
  if (cig.presence < 0.02 || !cig.finger) return;
  const L = cig.len, R = L * (CIG_DIA_M / CIG_LEN_M) / 2;
  const dx = Math.cos(cig.ang), dy = Math.sin(cig.ang);

  // A small layer around the cigarette rather than a full-canvas one. Its
  // size is quantized, or the hand breathing in and out of depth would
  // reallocate the canvas nearly every frame.
  const S = Math.ceil((L + R * 4 + 8) / 32) * 32;
  const ox = Math.round(cig.x + dx * L / 2 - S / 2);
  const oy = Math.round(cig.y + dy * L / 2 - S / 2);
  const g = sizeScratch(sCig, S, S);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, S, S);

  // Keep the lit side of the cylinder on top whichever way it points.
  const flip = dx < 0 ? -1 : 1;
  g.setTransform(dx, dy, -dy * flip, dx * flip, cig.x - ox, cig.y - oy);
  const flicker = 0.10 * Math.sin(t * 0.013) + 0.07 * Math.sin(t * 0.031 + 1.3);
  const glow = clamp01(cig.glow + flicker);
  const hot = cig.lit ? 1 : clamp01(cig.heat / LIGHT_S);
  paintCigarette(g, L, R, glow, cig.lit, hot);

  // "Between the fingers": the index finger is erased out of the layer, so
  // the camera's own pixels show through and the cigarette passes behind it
  // while its filter end still sits in front of the middle finger.
  g.setTransform(1, 0, 0, 1, -ox, -oy);
  g.globalCompositeOperation = "destination-out";
  g.lineWidth = cig.fingerW;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(cig.finger[0].x, cig.finger[0].y);
  for (let i = 1; i < cig.finger.length; i++) g.lineTo(cig.finger[i].x, cig.finger[i].y);
  g.stroke();
  g.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalAlpha = cig.presence;
  ctx.drawImage(sCig.c, ox, oy);

  // Ember light, added on top so it bleeds past the cigarette's own edge.
  // Unlit there is none, until the flame starts to warm the tip.
  if (hot > 0.02) {
    const at = cig.lit ? 0.91 : 0.98;
    const ex = cig.x + dx * L * at, ey = cig.y + dy * L * at;
    const rad = R * (4.5 + 6 * glow);
    const halo = ctx.createRadialGradient(ex, ey, 0, ex, ey, rad);
    halo.addColorStop(0, `rgba(255,${Math.round(120 + 70 * glow)},50,${(0.22 + 0.45 * glow) * hot})`);
    halo.addColorStop(0.3, `rgba(255,96,24,${(0.10 + 0.2 * glow) * hot})`);
    halo.addColorStop(1, "rgba(255,60,0,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = halo;
    ctx.fillRect(ex - rad, ey - rad, rad * 2, rad * 2);
  }
  ctx.restore();
}

// --- The lighter ------------------------------------------------------------

// Shortest distance from point p to segment a-b.
function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const k = clamp01(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1));
  return Math.hypot(px - ax - vx * k, py - ay - vy * k);
}

// The flame always burns upward on screen, whichever way the thumb points,
// and trails behind the hand when it moves.
function flameGeometry(t) {
  const s = lighter.scale, p = lighter.presence;
  const flick = 1 + 0.08 * Math.sin(t * 0.021) + 0.05 * Math.sin(t * 0.047 + 1);
  const H = FLAME_H_M * s * flick * p;
  const W = FLAME_W_M * s * (0.6 + 0.4 * p);
  const sway = (lighter.lean + 0.07 * Math.sin(t * 0.011) + 0.04 * Math.sin(t * 0.029)) * H * 0.6;
  return { H, W, sway };
}

function drawFlame(t) {
  if (lighter.presence < 0.02 && !lighter.sparks.length) return;
  const bx = lighter.x, by = lighter.y;
  ctx.save();

  if (lighter.presence >= 0.02) {
    const { H, W, sway } = flameGeometry(t);
    // Light thrown on the thumb and whatever is near.
    const gy = by - H * 0.45, rad = H * 1.5;
    const halo = ctx.createRadialGradient(bx, gy, 0, bx, gy, rad);
    halo.addColorStop(0, `rgba(255,170,60,${0.34 * lighter.presence})`);
    halo.addColorStop(0.4, `rgba(255,110,30,${0.12 * lighter.presence})`);
    halo.addColorStop(1, "rgba(255,80,0,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = halo;
    ctx.fillRect(bx - rad, gy - rad, rad * 2, rad * 2);
    ctx.globalCompositeOperation = "source-over";

    // A teardrop scaled by k, its tip bent over by the sway. The bend grows
    // with the square of the height, so the base stays planted on the thumb.
    const tear = (k, lift) => {
      const h = H * k, w = W * k, y0 = by - lift, bend = sway * k * k;
      ctx.beginPath();
      ctx.moveTo(bx, y0 + w * 0.35);
      ctx.bezierCurveTo(bx - w * 1.35, y0 + w * 0.2, bx + bend * 0.2 - w, y0 - h * 0.45, bx + bend, y0 - h);
      ctx.bezierCurveTo(bx + bend * 0.2 + w, y0 - h * 0.45, bx + w * 1.35, y0 + w * 0.2, bx, y0 + w * 0.35);
      ctx.fill();
    };
    // Blue where it leaves the thumb, orange body, a tip that fades out.
    const outer = ctx.createLinearGradient(0, by, 0, by - H);
    outer.addColorStop(0, "rgba(70,130,255,0.85)");
    outer.addColorStop(0.24, "rgba(255,185,60,0.95)");
    outer.addColorStop(0.68, "rgba(255,125,25,0.9)");
    outer.addColorStop(1, "rgba(255,70,10,0)");
    ctx.fillStyle = outer;
    tear(1, 0);
    const inner = ctx.createLinearGradient(0, by - H * 0.08, 0, by - H * 0.68);
    inner.addColorStop(0, "rgba(255,255,238,0.95)");
    inner.addColorStop(0.6, "rgba(255,232,130,0.85)");
    inner.addColorStop(1, "rgba(255,210,80,0)");
    ctx.fillStyle = inner;
    tear(0.6, H * 0.08);
  }

  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "#ffe9a8";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, lighter.scale * 0.0014);
  for (const p of lighter.sparks) {
    ctx.globalAlpha = 1 - p.age / p.life;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
    ctx.stroke();
  }
  ctx.restore();
}

// Advances the flame and works out whether it is on the cigarette's tip.
function stepLighter(dt, t) {
  lighter.presence += ((lighter.on ? 1 : 0) - lighter.presence) * (lighter.on ? 0.3 : 0.25);
  if (dt > 0) lighter.vx += ((lighter.x - lighter.px) / dt - lighter.vx) * 0.2;
  lighter.px = lighter.x;
  lighter.lean += (clamp(-lighter.vx / (lighter.scale * 0.5), -0.9, 0.9) - lighter.lean) * 0.15;

  let n = 0;
  for (const p of lighter.sparks) {
    p.age += dt;
    if (p.age >= p.life) continue;
    p.vy += lighter.scale * 1.2 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    lighter.sparks[n++] = p;
  }
  lighter.sparks.length = n;

  // The tip has to sit in the body of the flame, and stay there a moment.
  let heating = false;
  if (cig.on && !cig.lit && lighter.on && lighter.presence > 0.6) {
    const { H, W, sway } = flameGeometry(t);
    const tx = cig.x + Math.cos(cig.ang) * cig.len, ty = cig.y + Math.sin(cig.ang) * cig.len;
    const d = distToSegment(tx, ty, lighter.x, lighter.y - H * 0.05,
                            lighter.x + sway * 0.7, lighter.y - H * 0.85);
    heating = d < W * 1.5 + cig.len * (CIG_DIA_M / CIG_LEN_M) / 2;
  }
  cig.heat = heating ? cig.heat + dt : Math.max(0, cig.heat - dt * 2);
  if (cig.heat >= LIGHT_S) lightCigarette();
}

// Called once per rendered frame, after the camera is on the canvas.
function renderSmoke(t) {
  const dt = smokeLastT ? Math.min(0.05, (t - smokeLastT) / 1000) : 0;
  smokeLastT = t;

  cig.presence += ((cig.on ? 1 : 0) - cig.presence) * (cig.on ? 0.25 : 0.15);

  stepLighter(dt, t);
  // Put away for long enough and the next one out of the pack is fresh.
  // Short of that it stays lit, so a tracking dropout does not stub it out.
  if (cig.on) cig.away = 0;
  else if ((cig.away += dt) > CIG_OUT_S) cig.lit = false;

  // Taking a drag: the filter end is at the lips, so the ember flares.
  const dragging = cig.on && cig.lit && mouth.seen &&
    Math.hypot(cig.x - mouth.x, cig.y - mouth.y) < mouth.w * 0.8;
  cig.glow += ((dragging ? 1 : 0.45) - cig.glow) * (dragging ? 0.12 : 0.04);

  if (cig.lit && cig.on && cig.presence > 0.5) {
    wispAcc += WISP_RATE * dt;
    while (wispAcc >= 1) { wispAcc--; emitWisp(); }
  }

  // No smoke without fire: an open mouth only exhales once it is lit. Asking
  // for smoke before that gets a nudge toward the lighter instead.
  if (!cig.lit && mouth.seen && mouth.open > 0 && t - smokeNudgeT > 8000) {
    smokeNudgeT = t;
    flashStatus("Light it first — 👍 with your other hand, flame to the tip", 3000);
  }

  // A held-open mouth starts as a dense plume and thins as the breath runs
  // out, then recovers while the mouth is shut.
  if (cig.lit && mouth.seen && mouth.open > 0) {
    mouth.breath = Math.max(0, mouth.breath - dt / BREATH_S);
    exhaleAcc += EXHALE_RATE * dt * (0.45 + 0.55 * mouth.breath) * (0.4 + 0.6 * mouth.open);
    while (exhaleAcc >= 1) { exhaleAcc--; emitExhale(); }
  } else {
    mouth.breath = Math.min(1, mouth.breath + dt / BREATH_REFILL_S);
  }

  stepSmoke(dt, t / 1000);
  drawCigarette(t);
  drawFlame(t);
  drawSmoke();
}

// ...and a hand holding up two fingers, so Smoke's cut-out finger has real
// pixels to reveal.
function demoHand(t) {
  const w = frame.width, h = frame.height;
  const m = h / 0.55;

  // Slowly rocking, with dropout windows to exercise the fade.
  const hx = w * 0.66 + Math.sin(t * 0.0004) * w * 0.03;
  const hy = h * 0.66 + Math.cos(t * 0.0005) * h * 0.03;
  const rot = -0.15 + Math.sin(t * 0.0006) * 0.35;
  const pts = [];
  pts[WRIST] = { x: hx, y: hy + m * 0.06 };
  const finger = (base, off, spread) => {
    const a = rot + spread - Math.PI / 2;
    const bx = hx + off * m * Math.cos(rot), by = hy - m * 0.035 + off * m * Math.sin(rot);
    [0, 0.42, 0.7, 1].forEach((k, j) => {
      pts[base + j] = { x: bx + Math.cos(a) * m * 0.078 * k, y: by + Math.sin(a) * m * 0.078 * k };
    });
  };
  finger(INDEX_MCP, -0.013, -0.2);
  finger(MIDDLE_MCP, 0.013, 0.2);

  fctx.fillStyle = DEMO_SKIN;
  fctx.beginPath();
  fctx.ellipse(hx, hy + m * 0.01, m * 0.043, m * 0.05, rot, 0, Math.PI * 2);
  fctx.fill();
  fctx.strokeStyle = DEMO_SKIN;
  fctx.lineWidth = FINGER_W_M * m;
  fctx.lineCap = "round";
  for (const base of [INDEX_MCP, MIDDLE_MCP]) {
    fctx.beginPath();
    fctx.moveTo(pts[base].x, pts[base].y);
    fctx.lineTo(pts[base + 3].x, pts[base + 3].y);
    fctx.stroke();
  }
  applyCigTarget(Math.sin(t * 0.0003) > -0.8 ? cigTarget(pts, m) : null);
}

// ...and a second hand, a thumbs-up fist, that brings its flame over to the
// cigarette early in each cycle and then backs off again.
function demoLighter(t) {
  const w = frame.width, h = frame.height;
  const m = h / 0.55;
  const tl = t % 20944;                     // in step with the hand's dropouts
  const ramp = (a, b) => { const k = clamp01((tl - a) / (b - a)); return k * k * (3 - 2 * k); };
  const near = ramp(900, 2100) * (1 - ramp(3600, 4600));
  const thumbUp = tl > 500 && tl < 5200;

  // Rest off to the side; "near" puts the flame's body on the cigarette tip.
  const tipX = cig.x + Math.cos(cig.ang) * cig.len, tipY = cig.y + Math.sin(cig.ang) * cig.len;
  const restX = w * 0.84, restY = h * 0.6;
  const goX = cig.on ? tipX : restX, goY = cig.on ? tipY + m * 0.028 : restY;
  const tx = restX + (goX - restX) * near, ty = restY + (goY - restY) * near;

  fctx.fillStyle = DEMO_SKIN;
  fctx.beginPath();
  fctx.ellipse(tx + m * 0.022, ty + m * 0.085, m * 0.042, m * 0.04, 0, 0, Math.PI * 2);
  fctx.fill();
  if (thumbUp) {
    fctx.strokeStyle = DEMO_SKIN;
    fctx.lineWidth = m * 0.021;
    fctx.lineCap = "round";
    fctx.beginPath();
    fctx.moveTo(tx, ty + m * 0.06);
    fctx.lineTo(tx, ty);
    fctx.stroke();
  }
  applyLighterTarget(thumbUp ? { x: tx, y: ty - m * 0.008, scale: m } : null);
}

export default defineEffect({
  id: "smoke",
  name: "Smoke",
  kind: "overlay",
  hint: "✌️ holds a cigarette — 👍 with your other hand lights it",
  needs: { face: true },
  hands: updateSmokeHands,
  demo(t) {
    demoHand(t);
    demoLighter(t);
  },
  render: renderSmoke,
  reset: resetSmoke,
  onKey(key) {
    if (key !== "l") return false;
    // Manual light / stub out, for when a second hand is not free.
    if (cig.lit) cig.lit = false; else lightCigarette();
    flashStatus(cig.lit ? "Lit 🔥" : "Stubbed out");
    return true;
  },
});
