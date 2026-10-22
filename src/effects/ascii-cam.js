// ASCII Cam — the frame turns into text: every cell of the picture becomes
// a glyph, denser where it is brighter. Slide up/down (or press its key
// again) for the palette: full colour, green terminal, amber, or mono.
// ?ascii=terminal (or amber, mono) starts on one.
// Knobs: size is the glyph size (open your hands for finer text), tilt the
// brightness, and a fast squeeze flashes it inverted.

import { clamp01, ctx, defineEffect, frame, knobs, makeScratch, playSound,
  sizeScratch, unit, urlParams } from "../api.js";

// Dark to bright. Light glyphs on a dark ground, so the ramp runs from a
// space up to the densest glyph.
const RAMP = " .,:;i1tfLCG08@";
const PALETTES = [
  { name: "Color", tint: null },
  { name: "Terminal", tint: "#39ff7a" },
  { name: "Amber", tint: "#ffb43a" },
  { name: "Mono", tint: "#e8ecf1" },
];
const CELL_MIN = 7, CELL_MAX = 30;  // glyph height range, x unit()
const ASPECT = 0.6;              // a monospace glyph's width / height
const LEVELS_LERP = 0.08;        // how fast auto-contrast follows the scene

const sSample = makeScratch(true);  // one pixel per cell
const sText = makeScratch(false);   // the rendered text
const sAtlas = makeScratch(false);  // every glyph, white, in a row

const start = PALETTES.findIndex((p) => p.name.toLowerCase() === urlParams.get("ascii"));
let palette = start >= 0 ? start : 0;
let atlasCell = 0;               // the glyph height the atlas was built for
let lo = 0, hi = 255;            // smoothed darkest / brightest luminance
let lum = new Float32Array(0);   // per-cell luminance, grown as needed

// White glyphs on transparent, one cell each, so a cell is one drawImage
// rather than one fillText.
function buildAtlas(cw, ch) {
  const g = sizeScratch(sAtlas, cw * RAMP.length, ch);
  g.clearRect(0, 0, cw * RAMP.length, ch);
  g.fillStyle = "#fff";
  g.font = `600 ${Math.round(ch * 0.92)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let i = 0; i < RAMP.length; i++) g.fillText(RAMP[i], i * cw + cw / 2, ch * 0.54);
  atlasCell = ch;
}

function draw({ x: bx, y: by, w: bw, h: bh }) {
  const ch = Math.max(5, Math.round(unit() * (CELL_MAX - (CELL_MAX - CELL_MIN) * knobs.size)));
  const cw = Math.max(3, Math.round(ch * ASPECT));
  const cols = Math.ceil(bw / cw), rows = Math.ceil(bh / ch);
  if (ch !== atlasCell) buildAtlas(cw, ch);

  // One sample per cell.
  const sg = sizeScratch(sSample, cols, rows);
  sg.imageSmoothingEnabled = true;
  sg.drawImage(frame, bx, by, cols * cw, rows * ch, 0, 0, cols, rows);
  const px = sg.getImageData(0, 0, cols, rows).data;

  // Auto-contrast, smoothed so the text doesn't pump as the scene changes.
  let mn = 255, mx = 0;
  const n = cols * rows;
  if (lum.length < n) lum = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const l = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
    lum[i] = l;
    if (l < mn) mn = l;
    if (l > mx) mx = l;
  }
  lo += (mn - lo) * LEVELS_LERP;
  hi += (mx - hi) * LEVELS_LERP;
  const span = Math.max(24, hi - lo);
  const gamma = Math.pow(2, -knobs.tilt);   // tilt one way brightens, the other darkens
  const inv = clamp01(knobs.punch * 1.4);

  const tw = cols * cw, th = rows * ch;
  const g = sizeScratch(sText, tw, th);
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "#05070a";
  g.fillRect(0, 0, tw, th);
  const last = RAMP.length - 1;
  for (let r = 0, i = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++, i++) {
      let v = Math.pow(clamp01((lum[i] - lo) / span), gamma);
      v += (1 - 2 * v) * inv;
      const gi = Math.round(v * last);
      if (gi > 0) g.drawImage(sAtlas.c, gi * cw, 0, cw, ch, c * cw, r * ch, cw, ch);
    }
  }

  // Colour the white text: by the picture itself, or by one ink.
  g.globalCompositeOperation = "multiply";
  const tint = PALETTES[palette].tint;
  if (tint) {
    g.fillStyle = tint;
    g.fillRect(0, 0, tw, th);
  } else {
    g.imageSmoothingEnabled = false;
    g.filter = "saturate(1.5) brightness(1.35)";
    g.drawImage(sSample.c, 0, 0, tw, th);
    g.filter = "none";
    g.imageSmoothingEnabled = true;
  }
  g.globalCompositeOperation = "source-over";

  ctx.drawImage(sText.c, bx, by);
  // A soft phosphor glow over the top.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = tint ? 0.45 : 0.3;
  ctx.filter = `blur(${(ch * 0.35).toFixed(1)}px)`;
  ctx.drawImage(sText.c, bx, by);
  ctx.restore();
}

export default defineEffect({
  id: "ascii-cam",
  name: "ASCII Cam",
  kind: "frame",
  draw,
  cycle(step) {
    palette = (palette + step + PALETTES.length) % PALETTES.length;
    playSound("click");
    return `ASCII → ${PALETTES[palette].name}`;
  },
  chipLabel: () => `ASCII · ${PALETTES[palette].name}`,
});
