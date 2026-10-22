// Hollow Purple — 蒼 + 赫 = 茈
//
// Blue (the hand on the left of the screen) pulls in; Red (the right) pushes
// out. Bring them together and they spiral into each other and fuse into
// Purple. Thrust and it fires, erasing a tunnel through everything in its
// path; shove it at the camera and it erases the whole screen.

import { addSpark, canvas, cellHash, ctx, defineEffect, demoBlob, dist,
  drawSparks, frame, gagClock, jpFont, KAME_PUSH, latinFont, makeScratch,
  MIDDLE_MCP, palmCentre, rayToEdge, shakeScreen, sizeScratch, smoothstep,
  spill, stepSparks, titleCardAt, trackedHands, unit, WRIST } from "../api.js";

// Hollow Purple: an orb over each hand (blue on the left of the screen, red
// on the right). Held within PURPLE_FUSE palm lengths for PURPLE_FUSE_S they
// fuse; after PURPLE_MIN_S a shove fires it (the Kamehameha test).
const PURPLE_FUSE = 1.6;
const PURPLE_FUSE_S = 0.7;
const PURPLE_MIN_S = 0.4;
const PURPLE_THRUST = 2;         // palm lengths / s sideways
const PURPLE_SPEED = 0.9;        // screen diagonals / s
const PURPLE_SCAR_S = 3;         // the tunnel it erased lasts this long

const sDebris = makeScratch(true); // samples the feed for debris colours

const purple = {
  blue: { on: false, p: 0, x: 0, y: 0, palm: 1, lost: 0, born: 0 },
  red: { on: false, p: 0, x: 0, y: 0, palm: 1, lost: 0, born: 0 },
  near: false, merge: 0, formed: false, fp: 0, fx: 0, fy: 0, palm: 1,
  formedT: 0, lostT: 0, hist: [], shot: null, debris: [], cool: 0, title: 99,
};

function updatePurple(res, t) {
  const anchors = trackedHands(res, t).map((h) => {
    const p = h.pts, palm = dist(p[WRIST], p[MIDDLE_MCP]) || 1;
    const tip = p[MIDDLE_MCP + 3], base = p[MIDDLE_MCP], l = dist(tip, base) || 1;
    // The orb floats just past the fingertips.
    return { x: tip.x + (tip.x - base.x) / l * palm * 0.45, y: tip.y + (tip.y - base.y) / l * palm * 0.45,
             palm, cx: palmCentre(p).x };
  }).sort((a, b) => a.cx - b.cx);
  let blue = null, red = null;
  if (anchors.length >= 2) { blue = anchors[0]; red = anchors[anchors.length - 1]; }
  else if (anchors.length === 1) {
    if (anchors[0].cx < canvas.width / 2) blue = anchors[0]; else red = anchors[0];
  }
  purpleTrack(blue, red, t);
}

// Each hand's orb anchor this frame ({x, y, palm} or null).
function purpleTrack(blue, red, t) {
  const now = t / 1000;
  for (const [orb, a] of [[purple.blue, blue], [purple.red, red]]) {
    if (a) {
      if (!orb.on) { orb.on = true; orb.born = now; orb.x = a.x; orb.y = a.y; }
      orb.x += (a.x - orb.x) * 0.6;
      orb.y += (a.y - orb.y) * 0.6;
      orb.palm = a.palm;
      orb.lost = 0;
    } else if (++orb.lost > 8) {
      orb.on = false;
    }
  }
  const b = purple.blue, r = purple.red;
  const both = b.on && r.on;
  const palm = both ? (b.palm + r.palm) / 2 : (b.on ? b.palm : r.palm) || 1;
  purple.near = both && dist(b, r) < PURPLE_FUSE * palm;

  if (!purple.formed) return;
  // Formed: it rides between your hands, or on whichever one is left.
  if (b.on || r.on) {
    const x = both ? (b.x + r.x) / 2 : b.on ? b.x : r.x;
    const y = both ? (b.y + r.y) / 2 : b.on ? b.y : r.y;
    purple.fx = x;
    purple.fy = y;
    purple.palm = palm;
    purple.lostT = now;
    const hist = purple.hist;
    hist.push({ t: now, x, y, palm });
    while (hist.length && now - hist[0].t > 0.25) hist.shift();
    // The same shove test as Kamehameha: sideways is a beam that way, a fast
    // growth in hand size is a shove at the camera.
    if (now - purple.formedT > PURPLE_MIN_S && hist.length >= 3) {
      const h0 = hist[0], span = now - h0.t;
      if (span > 0.06) {
        const vx = (x - h0.x) / span / palm, vy = (y - h0.y) / span / palm;
        if ((palm / h0.palm - 1) / span > KAME_PUSH) firePurple(null);
        else if (Math.hypot(vx, vy) > PURPLE_THRUST) firePurple(Math.atan2(vy, vx));
      }
    }
  } else if (now - purple.lostT > 1.2) {
    purple.formed = false;          // both hands gone: it fizzles
  }
}

function formPurple(x, y, palm, now) {
  purple.formed = true;
  purple.formedT = now;
  purple.lostT = now;
  purple.fx = x;
  purple.fy = y;
  purple.palm = palm;
  purple.hist.length = 0;
  purple.title = 0;
  for (let i = 0; i < 30; i++) {
    addSpark(x, y, Math.random() * Math.PI * 2, palm * (2 + Math.random() * 4), 0.2 + Math.random() * 0.3,
             0, i % 3 === 0 ? "#7fb2ff" : i % 3 === 1 ? "#ff6b6b" : "#e2b8ff");
  }
  shakeScreen(canvas.height * 0.006);
}

// `ang` null is straight at the camera.
function firePurple(ang) {
  const H = canvas.height;
  purple.shot = { ox: purple.fx, oy: purple.fy, ang, age: 0, r0: purple.palm * 0.45,
                  R: H * 0.17, seed: Math.random() * 1000 };
  purple.formed = false;
  purple.merge = 0;
  purple.cool = 1.4;                // the hands need a moment before the next
  purple.hist.length = 0;
  shakeScreen(H * (ang === null ? 0.035 : 0.02));
}

// Where the shot's head is, how long its tunnel is, and whether it is done.
function purpleShotState(s) {
  const W = canvas.width, H = canvas.height;
  if (s.ang === null) return { atCam: true, life: 0.35 + 0.6 + 1.2 };
  const dx = Math.cos(s.ang), dy = Math.sin(s.ang);
  const reach = rayToEdge(s.ox, s.oy, dx, dy) + s.R * 1.5;
  const speed = Math.hypot(W, H) * PURPLE_SPEED;
  const d = Math.min(reach, s.age * speed);
  const travel = reach / speed;
  return { dx, dy, d, reach, travel, life: travel + PURPLE_SCAR_S };
}

// The tunnel it erased: a void with ragged edges that glow where they were
// cut, a few cold stars inside, healing over after a few seconds.
function drawPurpleScar(s, st, a) {
  const { dx, dy, d } = st;
  if (d < 2) return;
  const nx = -dy, ny = dx, w = s.R * 0.9, u = unit();
  const N = Math.max(8, Math.ceil(d / (s.R * 0.2)));
  const top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const k = i / N, x = s.ox + dx * d * k, y = s.oy + dy * d * k;
    // Narrow at the hand, full width a sphere's length out.
    const taper = Math.min(1, (d * k) / (s.R * 1.2)) * 0.75 + 0.25;
    const j1 = 1 + 0.1 * Math.sin(s.seed + i * 1.9) + 0.06 * Math.sin(s.seed * 2 + i * 5.3);
    const j2 = 1 + 0.1 * Math.sin(s.seed * 3 + i * 2.3) + 0.06 * Math.sin(s.seed + i * 4.7);
    top.push({ x: x + nx * w * taper * j1, y: y + ny * w * taper * j1 });
    bot.push({ x: x - nx * w * taper * j2, y: y - ny * w * taper * j2 });
  }
  const hx = s.ox + dx * d, hy = s.oy + dy * d;
  const path = () => {
    ctx.beginPath();
    for (const p of top) ctx.lineTo(p.x, p.y);
    ctx.arc(hx, hy, w, Math.atan2(ny, nx), Math.atan2(-ny, -nx), true);
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
    ctx.closePath();
  };
  ctx.save();
  ctx.globalAlpha = a;
  path();
  const g = ctx.createLinearGradient(hx + nx * w, hy + ny * w, hx - nx * w, hy - ny * w);
  g.addColorStop(0, "#2a0b48");
  g.addColorStop(0.5, "#04010a");
  g.addColorStop(1, "#2a0b48");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  const stars = Math.ceil(d / (s.R * 0.35));
  for (let i = 0; i < stars; i++) {
    const k = cellHash(s.seed, i), o = cellHash(i, s.seed) * 2 - 1;
    const x = s.ox + dx * d * k + nx * w * 0.8 * o, y = s.oy + dy * d * k + ny * w * 0.8 * o;
    ctx.globalAlpha = a * (0.3 + 0.7 * cellHash(i * 3, s.seed + 1));
    ctx.fillRect(x, y, 1.6 * u, 1.6 * u);
  }
  ctx.restore();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  for (const [lw, col] of [[12 * u, "rgba(170,90,255,0.25)"], [3.5 * u, "rgba(215,160,255,0.85)"]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    for (const edge of [top, bot]) {
      ctx.beginPath();
      for (const p of edge) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// The purple sphere: a white-hot core with blue and red still swirling round
// it, crackling, lighting the room.
function drawPurpleSphere(x, y, r, t, k) {
  if (r < 1 || k <= 0) return;
  spill(x, y, r * 6, "185,110,255", 0.45 * k);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.6);
  halo.addColorStop(0, `rgba(190,110,255,${0.55 * k})`);
  halo.addColorStop(1, "rgba(120,40,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
  const body = ctx.createRadialGradient(x, y, 0, x, y, r);
  body.addColorStop(0, `rgba(255,255,255,${k})`);
  body.addColorStop(0.4, `rgba(230,190,255,${0.95 * k})`);
  body.addColorStop(0.8, `rgba(150,60,255,${0.75 * k})`);
  body.addColorStop(1, "rgba(110,30,230,0)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  const spin = t * 0.006;
  ctx.lineCap = "round";
  for (const [col, ph] of [["rgba(110,170,255,", 0], ["rgba(255,90,90,", Math.PI]]) {
    ctx.strokeStyle = col + 0.8 * k + ")";
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.15, r * 0.45, spin + ph * 0.5, ph, ph + Math.PI * 1.2);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(235,205,255,${0.8 * k})`;
  ctx.lineWidth = Math.max(1, r * 0.03);
  for (let i = 0; i < 4; i++) {
    let a = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5);
    for (let s = 1; s <= 5; s++) {
      a += (Math.random() - 0.5) * 0.8;
      const rr = r * (0.5 + 0.25 * s);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// One technique orb. Blue's motes fall inward, Red's rings push outward.
function drawPurpleOrb(x, y, r, t, k, isBlue, now, born) {
  if (k <= 0.01) return;
  const time = t / 1000;
  const rgb = isBlue ? "90,150,255" : "255,70,70";
  spill(x, y, r * 7, rgb, 0.35 * k);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
  halo.addColorStop(0, `rgba(${rgb},${0.5 * k})`);
  halo.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  const body = ctx.createRadialGradient(x, y, 0, x, y, r);
  body.addColorStop(0, `rgba(255,255,255,${k})`);
  body.addColorStop(0.45, isBlue ? `rgba(160,210,255,${k})` : `rgba(255,170,150,${k})`);
  body.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = isBlue ? "#cfe3ff" : "#ffd0c8";
  ctx.strokeStyle = `rgba(${rgb},${0.7 * k})`;
  for (let i = 0; i < 14; i++) {
    const ph = (time * (isBlue ? 0.9 : 0.7) + i / 14) % 1;
    if (isBlue) {
      const rad = r * (3.2 - 2.4 * ph), a = i * 2.4 + ph * 5;
      ctx.globalAlpha = k * ph;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * rad, y + Math.sin(a) * rad, Math.max(1, r * 0.06), 0, Math.PI * 2);
      ctx.fill();
    } else if (i < 3) {
      const p3 = (time * 1.3 + i / 3) % 1;
      ctx.globalAlpha = k * (1 - p3);
      ctx.lineWidth = Math.max(1, r * 0.08 * (1 - p3));
      ctx.beginPath();
      ctx.arc(x, y, r * (1 + 2.2 * p3), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
  // Its name, under it, for a moment after it first appears.
  const age = now - born;
  if (age < 2) {
    titleCardAt(isBlue ? "蒼" : "赫", x, y + r * 2.6, r * 1.1, smoothstep(0, 0.3, age) * (1 - smoothstep(1.4, 2, age)),
                0, jpFont, isBlue ? "rgba(90,150,255,0.9)" : "rgba(255,80,80,0.9)");
  }
}

// Matter at the sphere's rim, in the feed's own colours, being sucked in.
function shedPurpleDebris(x, y, R, dt) {
  const W = canvas.width, H = canvas.height;
  const sw = Math.max(1, Math.round(W / 8)), sh = Math.max(1, Math.round(H / 8));
  const sg = sizeScratch(sDebris, sw, sh);
  sg.drawImage(frame, 0, 0, sw, sh);
  const px = sg.getImageData(0, 0, sw, sh).data;
  for (let i = 0; i < 2400 * dt && purple.debris.length < 1200; i++) {
    const a = Math.random() * Math.PI * 2, rad = R * (1.1 + Math.random() * 0.6);
    const ex = x + Math.cos(a) * rad, ey = y + Math.sin(a) * rad;
    if (ex < 0 || ey < 0 || ex >= W || ey >= H) continue;
    const q = (((ey / H * sh) | 0) * sw + ((ex / W * sw) | 0)) * 4;
    purple.debris.push({ x: ex, y: ey, a, rad, r: px[q], g: px[q + 1], b: px[q + 2],
                         size: unit() * (2 + Math.random() * 4), age: 0 });
  }
}

function renderPurple(t) {
  const dt = gagClock(t);
  const now = t / 1000, W = canvas.width, H = canvas.height;
  purple.cool = Math.max(0, purple.cool - dt);
  purple.title += dt;
  const b = purple.blue, r = purple.red;

  // Fusing: the two orbs have to stay together for PURPLE_FUSE_S.
  if (!purple.formed && purple.near && purple.cool <= 0) {
    purple.merge = Math.min(1, purple.merge + dt / PURPLE_FUSE_S);
    if (purple.merge >= 1) formPurple((b.x + r.x) / 2, (b.y + r.y) / 2, (b.palm + r.palm) / 2, now);
  } else if (!purple.formed) {
    purple.merge = Math.max(0, purple.merge - dt * 2);
  }
  for (const orb of [b, r]) {
    const show = orb.on && !purple.formed && purple.cool <= 0;
    orb.p += ((show ? 1 : 0) - orb.p) * (show ? 0.2 : 0.3);
  }
  purple.fp += ((purple.formed ? 1 : 0) - purple.fp) * 0.25;
  stepSparks(dt);

  // The shot and the tunnel it leaves.
  const s = purple.shot;
  if (s) {
    s.age += dt;
    const st = purpleShotState(s);
    if (st.atCam) {
      // At the camera: it swells over everything, holds, then the room heals.
      const grow = smoothstep(0, 0.35, s.age);
      const fade = 1 - smoothstep(0.95, 2.15, s.age);
      const R = s.r0 + Math.hypot(W, H) * grow;
      const sc = { ox: s.ox - W * 2, oy: s.oy, R: Math.hypot(W, H), seed: s.seed };
      if (grow >= 1) drawPurpleScar(sc, { dx: 1, dy: 0, d: W * 4 }, fade);
      drawPurpleSphere(s.ox, s.oy, R * (grow < 1 ? 1 : 0), t, 1 - grow * 0.6);
      if (s.age < 0.5) {
        ctx.fillStyle = `rgba(245,225,255,${0.9 * (1 - s.age / 0.5)})`;
        ctx.fillRect(0, 0, W, H);
      }
    } else {
      const fade = 1 - smoothstep(st.life - 1.2, st.life, s.age);
      drawPurpleScar(s, st, fade);
      if (st.d < st.reach) {
        const R = s.r0 + (s.R - s.r0) * smoothstep(0, 0.15, s.age);
        const hx = s.ox + st.dx * st.d, hy = s.oy + st.dy * st.d;
        shedPurpleDebris(hx, hy, R, dt);
        drawPurpleSphere(hx, hy, R, t, 1);
      }
    }
    if (s.age > st.life) purple.shot = null;
  }
  // Debris spirals into wherever the sphere is now.
  if (purple.debris.length) {
    const st = s ? purpleShotState(s) : null;
    const live = st && !st.atCam;
    const hx = live ? s.ox + st.dx * st.d : null, hy = live ? s.oy + st.dy * st.d : null;
    let n = 0;
    for (const p of purple.debris) {
      p.age += dt;
      p.rad *= Math.exp(-4 * dt);
      p.a += 3 * dt;
      if (hx !== null) { p.x = hx + Math.cos(p.a) * p.rad; p.y = hy + Math.sin(p.a) * p.rad; }
      if (p.age < 0.6 && p.rad > 2) purple.debris[n++] = p;
    }
    purple.debris.length = n;
    for (const p of purple.debris) {
      ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${1 - p.age / 0.6})`;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
  }

  // The orbs, pulled round each other as they fuse.
  if (!purple.formed) {
    const mx = (b.x + r.x) / 2, my = (b.y + r.y) / 2, m = purple.merge;
    const swirl = m * m * Math.PI * 1.5, pull = m * 0.85;
    const place = (o) => {
      const ox = o.x - mx, oy = o.y - my, c = Math.cos(swirl), sn = Math.sin(swirl);
      return m > 0 ? { x: mx + (ox * c - oy * sn) * (1 - pull), y: my + (ox * sn + oy * c) * (1 - pull) }
                   : { x: o.x, y: o.y };
    };
    const pb = place(b), pr = place(r);
    drawPurpleOrb(pb.x, pb.y, (b.palm || 1) * 0.2 * (1 + m * 0.4), t, b.p, true, now, b.born);
    drawPurpleOrb(pr.x, pr.y, (r.palm || 1) * 0.2 * (1 + m * 0.4), t, r.p, false, now, r.born);
  }
  if (purple.fp > 0.01) {
    drawPurpleSphere(purple.fx, purple.fy, purple.palm * 0.42 * (1 + 0.05 * Math.sin(t * 0.02)), t, purple.fp);
  }
  drawSparks();
  // 虚式「茈」 as it forms.
  const c = purple.title, env = (a0, b0, c0, d0) => smoothstep(a0, b0, c) * (1 - smoothstep(c0, d0, c));
  titleCardAt("虚式「茈」", W / 2, H * 0.14, H * 0.085, env(0.05, 0.3, 1.9, 2.5), H * 0.015, jpFont, "rgba(170,90,255,0.95)");
  titleCardAt("HOLLOW TECHNIQUE: PURPLE", W / 2, H * 0.215, H * 0.022, env(0.15, 0.4, 1.9, 2.5), H * 0.01, latinFont, "rgba(170,90,255,0.95)");
}

function resetPurple() {
  for (const o of [purple.blue, purple.red]) { o.on = false; o.p = 0; o.lost = 0; }
  purple.formed = false;
  purple.fp = 0;
  purple.merge = 0;
  purple.near = false;
  purple.shot = null;
  purple.debris.length = 0;
  purple.hist.length = 0;
  purple.cool = 0;
  purple.title = 99;
}

// `f`: forms Purple mid-screen; again, fires it to the right.
function triggerPurple() {
  const now = performance.now() / 1000;
  if (purple.formed) { firePurple(0); return; }
  if (purple.shot) return;
  formPurple(canvas.width * 0.3, canvas.height * 0.5, canvas.height * 0.17, now);
}

// Two hands, an orb each: they come together, fuse and fire, sideways and
// then at the camera on alternate cycles.
function demoPurple(t) {
  const w = frame.width, h = frame.height, m = h / 0.55, palm = m * 0.095;
  const c = t % 9000, n = Math.floor(t / 9000);
  if (c < 300 || c > 6800) { purpleTrack(null, null, t); return; }
  const close = smoothstep(1400, 2400, c) * (1 - smoothstep(4400, 5000, c));
  const atCam = n % 2 === 1;
  const shove = smoothstep(4000, 4200, c);
  const cx = w * 0.42 + (atCam ? 0 : shove * w * 0.1), cy = h * 0.5;
  const sep = w * (0.2 - 0.17 * close);
  const pp = palm * (1 + (atCam ? shove * 0.4 : 0));
  const bl = { x: cx - sep, y: cy, palm: pp }, rd = { x: cx + sep, y: cy, palm: pp };
  for (const a of [bl, rd]) {
    demoBlob(a.x, a.y + pp * 1.3, m * pp / palm, 0, [[-1.75, 0.09], [-1.57, 0.095], [-1.4, 0.09]]);
  }
  purpleTrack(bl, rd, t);
}

export default defineEffect({
  id: "hollow-purple",
  name: "Hollow Purple",
  kind: "overlay",
  hint: "Raise both hands — 蒼 and 赫. Bring them together, then thrust 🟣",
  hands: updatePurple,
  demo: demoPurple,
  render: renderPurple,
  reset: resetPurple,
  trigger: triggerPurple,
});
