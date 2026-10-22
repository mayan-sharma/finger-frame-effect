// Polaroid — the frame is a viewfinder; squeeze it fast to take the shot.
// The print leaves from where the frame was, flies to a pile in the corner
// and develops. `f` shoots without the squeeze; `s`, or a click on the pile,
// saves the newest print as a PNG.

import { canvas, clamp, clamp01, ctx, defineEffect, demoMode, dist,
  flashStatus, frame, gagClock, knobs, lerpPt, presence, quadCentroid,
  smoothQuad, smoothstep, unit } from "../api.js";

// Polaroid: squeezing the frame fast (punch past POLAROID_SQUEEZE) is the
// shutter. There is deliberately no self-timer: a shot only ever happens
// when you ask for one.
const POLAROID_SQUEEZE = 0.55;
const POLAROID_PX = 720;         // the print's photo width
const POLAROID_PILE = 8;
const POLAROID_DEVELOP_S = 5;

const polaroid = { pile: [], now: 0, flash: 0, lastSqueeze: 0, demoT: 0 };

// Inside the frame: the plain feed as a viewfinder, with thirds lines and
// focus corners.
function drawViewfinder({ w: bw, h: bh }) {
  const u = unit(), q = smoothQuad;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1.2 * u;
  ctx.beginPath();
  for (const k of [1 / 3, 2 / 3]) {
    const a = lerpPt(q[0], q[1], k), b = lerpPt(q[3], q[2], k);
    const c = lerpPt(q[0], q[3], k), d = lerpPt(q[1], q[2], k);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  }
  ctx.stroke();
  const c = quadCentroid(q), s = Math.min(bw, bh) * 0.09;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(c.x + sx * s, c.y + sy * s * 0.4);
    ctx.lineTo(c.x + sx * s, c.y + sy * s);
    ctx.lineTo(c.x + sx * s * 0.6, c.y + sy * s);
  }
  ctx.stroke();
  ctx.restore();
}

// The framed quad, straightened into an upright photo: its top edge sets the
// rotation, its edges the size, and the aspect is held to what a Polaroid
// print will take.
function snapPolaroid(q) {
  const c = quadCentroid(q), ang = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x);
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const aspect = clamp(w / Math.max(1, h), 0.8, 1.25);
  const cw = Math.min(w, h * aspect), ch = cw / aspect;
  const PW = POLAROID_PX, PH = Math.round(PW / aspect);

  // The print: a warm, slightly faded instant-film grade and a soft vignette.
  const photo = document.createElement("canvas");
  photo.width = PW;
  photo.height = PH;
  const g = photo.getContext("2d");
  g.filter = "contrast(1.06) saturate(1.18) sepia(0.14) brightness(1.04)";
  g.translate(PW / 2, PH / 2);
  g.rotate(-ang);
  g.scale(PW / cw, PW / cw);
  g.drawImage(frame, -c.x, -c.y);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.filter = "none";
  const v = g.createRadialGradient(PW / 2, PH / 2, Math.min(PW, PH) * 0.35, PW / 2, PH / 2, Math.hypot(PW, PH) * 0.55);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(20,10,0,0.35)");
  g.fillStyle = v;
  g.fillRect(0, 0, PW, PH);

  // The card: thin border on three sides, the deep strip at the bottom with
  // the date written on it.
  const side = Math.round(PW * 0.06), bottom = Math.round(PW * 0.26);
  const card = document.createElement("canvas");
  card.width = PW + side * 2;
  card.height = PH + side + bottom;
  const cg = card.getContext("2d");
  const paper = cg.createLinearGradient(0, 0, card.width, card.height);
  paper.addColorStop(0, "#fbfaf5");
  paper.addColorStop(1, "#ecebe3");
  cg.fillStyle = paper;
  cg.fillRect(0, 0, card.width, card.height);
  cg.drawImage(photo, side, side);
  cg.strokeStyle = "rgba(0,0,0,0.12)";
  cg.strokeRect(side + 0.5, side + 0.5, PW - 1, PH - 1);
  const when = new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  cg.save();
  cg.translate(card.width * 0.5, PH + side + bottom * 0.52);
  cg.rotate(-0.025);
  cg.fillStyle = "rgba(40,40,70,0.85)";
  cg.font = `${Math.round(bottom * 0.32)}px "Marker Felt", "Bradley Hand", "Segoe Print", cursive`;
  cg.textAlign = "center";
  cg.textBaseline = "middle";
  cg.fillText(when, 0, 0);
  cg.restore();

  // It leaves from where the frame was, at the frame's size and tilt, and
  // lands on the pile.
  const n = polaroid.pile.length, H = canvas.height, W = canvas.width;
  const toScale = (H * 0.24) / card.width;
  polaroid.pile.push({
    card, photoRect: { x: side, y: side, w: PW, h: PH }, born: polaroid.now,
    from: { x: c.x, y: c.y + ch * 0.12, ang, s: cw / PW },
    to: { x: W - H * 0.2 + (Math.random() - 0.5) * H * 0.05, y: H - H * 0.25 + (Math.random() - 0.5) * H * 0.04,
          ang: (Math.random() - 0.5) * 0.4 + (n % 2 ? 0.08 : -0.08), s: toScale },
  });
  while (polaroid.pile.length > POLAROID_PILE) polaroid.pile.shift();
  polaroid.flash = 1;
  flashStatus("📸 Click! — tap the pile or press s to save it", 2500);
}

function renderPolaroid(t) {
  const dt = gagClock(t);
  const now = polaroid.now = t / 1000, W = canvas.width, H = canvas.height;
  const q = presence > 0.85 && smoothQuad ? smoothQuad : null;

  if (q) {
    // The shutter is a fast squeeze of the frame. Demo mode has no hands to
    // squeeze, so its stand-in frame takes a shot every 7 s instead.
    const squeeze = knobs.punch > POLAROID_SQUEEZE && now - polaroid.lastSqueeze > 0.8;
    if (squeeze) polaroid.lastSqueeze = now;
    if (squeeze || (demoMode && now - polaroid.demoT > 7)) {
      polaroid.demoT = now;
      snapPolaroid(q);
    }
  }

  // The pile, oldest at the bottom; the newest flies in from the frame.
  for (const p of polaroid.pile) {
    const age = now - p.born;
    const k = smoothstep(0.12, 0.95, age);
    const lift = Math.sin(Math.PI * k) * H * 0.06;
    const x = p.from.x + (p.to.x - p.from.x) * k, y = p.from.y + (p.to.y - p.from.y) * k - lift;
    const a = p.from.ang + (p.to.ang - p.from.ang) * k, s = p.from.s + (p.to.s - p.from.s) * k;
    const dev = clamp01((age - 0.3) / POLAROID_DEVELOP_S);
    const cw = p.card.width, ch = p.card.height, r = p.photoRect;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(s, s);
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 18 / s * unit();
    ctx.shadowOffsetY = 6 / s * unit();
    ctx.drawImage(p.card, -cw / 2, -ch / 2);
    ctx.shadowColor = "transparent";
    // Developing: the image comes up out of a murky grey-green, cool first,
    // reaching full colour last.
    if (dev < 1) {
      const e = 1 - dev;
      ctx.fillStyle = `rgba(48,56,52,${Math.min(1, e * 1.25)})`;
      ctx.fillRect(-cw / 2 + r.x, -ch / 2 + r.y, r.w, r.h);
      ctx.globalCompositeOperation = "color";
      ctx.fillStyle = `rgba(70,110,130,${0.6 * e})`;
      ctx.fillRect(-cw / 2 + r.x, -ch / 2 + r.y, r.w, r.h);
    }
    ctx.restore();
  }
  if (polaroid.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${polaroid.flash * 0.85})`;
    ctx.fillRect(0, 0, W, H);
    polaroid.flash = Math.max(0, polaroid.flash - dt / 0.22);
  }
}

// Saves the newest print as a PNG.
function savePolaroid() {
  const p = polaroid.pile[polaroid.pile.length - 1];
  if (!p) { flashStatus("No photos yet — frame a shot first"); return; }
  p.card.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `polaroid-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    flashStatus("Saved 📥");
  }, "image/png");
}

// Is a click on the pile? (The pile sits round each print's landing spot.)
function onPolaroidPile(x, y) {
  return polaroid.pile.some((p) => Math.hypot(x - p.to.x, y - p.to.y) < canvas.height * 0.16);
}

// `f`: a shot of the frame you are holding, or of the middle of the screen.
function snapPolaroidNow() {
  if (presence > 0.5 && smoothQuad) { snapPolaroid(smoothQuad); return; }
  const W = canvas.width, H = canvas.height, w = H * 0.5, h = H * 0.42;
  snapPolaroid([{ x: W / 2 - w / 2, y: H / 2 - h / 2 }, { x: W / 2 + w / 2, y: H / 2 - h / 2 },
                { x: W / 2 + w / 2, y: H / 2 + h / 2 }, { x: W / 2 - w / 2, y: H / 2 + h / 2 }]);
}

export default defineEffect({
  id: "polaroid",
  name: "Polaroid",
  kind: "frame",
  hint: "📸 Frame a shot with both hands — squeeze the frame to click",
  draw: drawViewfinder,
  render: renderPolaroid,
  trigger: snapPolaroidNow,
  onKey(key) {
    if (key !== "s") return false;
    savePolaroid();
    return true;
  },
  onClick(x, y) {
    if (!onPolaroidPile(x, y)) return false;
    savePolaroid();
    return true;
  },
});
