// Stand-in for @mediapipe/tasks-vision, for the smoke test: hands, a face and
// a person mask, scripted as a pure function of the frame time. The hands
// walk through every pose the built-in effects react to (the L frame, a
// finger gun, a snap, palms together, a fist, crossed fingers, a circle
// drawn in the air, raised hands, a twisted palm) and end with swipes.
// The test serves this file in place of the CDN bundle.
const W = 1280, H = 720, PXM = 1600; // video px, px per metre
const SEG = { t: [0.035, 0.032, 0.028], i: [0.042, 0.025, 0.02], m: [0.046, 0.028, 0.022],
              r: [0.043, 0.026, 0.02], p: [0.033, 0.02, 0.018] };
const BASE = { i: [0.026, 0.088], m: [0.006, 0.094], r: [-0.013, 0.089], p: [-0.03, 0.078] };

// x: toward the thumb, y: toward the fingers, z: out of the palm.
function chain(base, len, dir, curl, out) {
  let [x, y, z] = [base[0], base[1], 0];
  out.push([x, y, z]);
  const F = [curl * 1.2, curl * 1.6, curl * 1.1];
  let acc = 0;
  for (let k = 0; k < 3; k++) {
    acc += F[k];
    const c = Math.cos(acc), s = Math.sin(acc);
    x += dir[0] * c * len[k]; y += dir[1] * c * len[k]; z += -s * len[k];
    out.push([x, y, z]);
  }
}
function hand(o) {
  const c = o.curl || {};
  const local = [[0, 0, 0]];
  const ta = o.thumb ?? 0.8, tc = c.t ?? 0;
  // thumb: CMC then three segments
  local.push([0.022, 0.025, 0]);
  chain([0.022, 0.025], SEG.t, [Math.sin(ta), Math.cos(ta)], tc, []);
  { const tmp = []; chain([0.022, 0.025], SEG.t, [Math.sin(ta), Math.cos(ta)], tc, tmp); local.push(tmp[1], tmp[2], tmp[3]); }
  for (const f of ["i", "m", "r", "p"]) {
    const sp = (o.spread && o.spread[f]) || 0;
    const tmp = [];
    chain(BASE[f], SEG[f], [Math.sin(sp), Math.cos(sp)], c[f] ?? 0, tmp);
    local.push(...tmp);
  }
  const side = o.side || 1, rot = o.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
  const lm = [], world = [];
  for (const [x, y, z] of local) {
    // hand frame -> video px: fingers point "up" (-y) rotated by rot
    const hx = x * side, hy = -y;
    const rx = hx * cr - hy * sr, ry = hx * sr + hy * cr;
    lm.push({ x: (o.x + rx * PXM * (o.s || 1)) / W, y: (o.y + ry * PXM * (o.s || 1)) / H, z: -z * 0.5 });
    world.push({ x: rx, y: ry, z: -z });
  }
  return { lm, world, label: side > 0 ? "Left" : "Right" };
}
const sm = (a, b, v) => { const k = Math.min(1, Math.max(0, (v - a) / (b - a))); return k * k * (3 - 2 * k); };
const CURLED = { m: 1, r: 1, p: 1 };
// Timeline, seconds. Gaps between segments are tracking dropouts.
function handsAt(T) {
  const u = T % 30;
  if (u < 4) {             // the L frame: breathe, tilt, then a fast squeeze
    const open = 1 + 0.25 * Math.sin(u * 1.7) - (u > 3 && u < 3.25 ? 0.5 : 0);
    const tilt = 0.15 * Math.sin(u * 0.9);
    const dx = 230 * open;
    return [hand({ x: 640 - dx, y: 470 + tilt * 200, side: 1, rot: 0.25 + tilt, thumb: Math.PI / 2, curl: CURLED }),
            hand({ x: 640 + dx, y: 470 - tilt * 200, side: -1, rot: -0.25 + tilt, thumb: Math.PI / 2, curl: CURLED })];
  }
  if (u < 4.3) return [];
  if (u < 6.5) {           // finger gun; thumb drops twice
    const k = u - 4.3;
    const thumb = (k % 1) < 0.15 ? 0.15 : 1.0;
    return [hand({ x: 900, y: 420, side: -1, rot: -Math.PI / 2 + 0.2 * Math.sin(k * 3), thumb, curl: CURLED })];
  }
  if (u < 8) {             // snap-ish: thumb onto the middle tip, then away
    const k = u - 6.5, pinch = (k % 0.7) < 0.4;
    return [hand({ x: 800, y: 480, side: -1, rot: 0.1, thumb: pinch ? 0.05 : 1.2,
                   curl: { t: pinch ? 0.6 : 0, i: 0.3, m: pinch ? 0.55 : 0, r: 0.8, p: 0.8 } })];
  }
  if (u < 10) {            // palms together, then shoved sideways
    const k = u - 8, push = sm(1.2, 1.5, k) * 500;
    return [hand({ x: 600 + push, y: 420, side: 1, rot: 1.2, thumb: 0.5 }),
            hand({ x: 690 + push, y: 420, side: -1, rot: -1.2, thumb: 0.5 })];
  }
  if (u < 11.5) {          // web: index + pinky up
    const k = u - 10;
    return [hand({ x: 760, y: 450, side: -1, rot: -0.3 + 0.4 * Math.sin(k * 4), thumb: 1.1, curl: { m: 1, r: 1 } })];
  }
  if (u < 13) {            // fist, swung hard
    const k = u - 11.5;
    return [hand({ x: 640 + 300 * Math.sin(k * 6), y: 430 + 80 * Math.cos(k * 6), side: 1, rot: 0.2, thumb: 0.3, curl: { t: 0.8, i: 1, m: 1, r: 1, p: 1 } })];
  }
  if (u < 15) {            // crossed index + middle, held
    return [hand({ x: 700, y: 470, side: -1, rot: 0, thumb: 0.4, curl: { t: 0.5, r: 1, p: 1 }, spread: { i: -0.12, m: 0.14 } })];
  }
  if (u < 16.5) {          // both hands two-finger sign, close together
    return [hand({ x: 600, y: 450, side: 1, rot: 0.1, thumb: 0.3, curl: { t: 0.6, r: 1, p: 1 } }),
            hand({ x: 690, y: 450, side: -1, rot: -0.1, thumb: 0.3, curl: { t: 0.6, r: 1, p: 1 } })];
  }
  if (u < 18) {            // two fingers + a thumbs-up on the other hand
    return [hand({ x: 800, y: 470, side: -1, rot: 0.2, thumb: 0.3, curl: { t: 0.6, r: 1, p: 1 } }),
            hand({ x: 520, y: 500, side: 1, rot: 0, thumb: 0.05, curl: { i: 1, m: 1, r: 1, p: 1 } })];
  }
  if (u < 20.5) {          // index up, drawing a circle
    const k = (u - 18) * 3.2;
    return [hand({ x: 640 + 140 * Math.cos(k), y: 420 + 140 * Math.sin(k), side: -1, rot: 0, thumb: 0.3, curl: { t: 0.7, m: 0.9, r: 1, p: 1 } })];
  }
  if (u < 23) {            // both open hands raised, then thrown down
    const k = u - 20.5, drop = sm(1.8, 2.0, k) * 450;
    return [hand({ x: 480, y: 160 + drop, side: 1, rot: 0, thumb: 0.9 }),
            hand({ x: 800, y: 160 + drop, side: -1, rot: 0, thumb: 0.9 })];
  }
  if (u < 25.5) {          // open palm, twisted like a dial
    const k = u - 23;
    return [hand({ x: 700, y: 430, side: -1, rot: 0.8 * Math.sin(k * 2.2), thumb: 0.9 })];
  }
  if (u < 25.8) return [];
  if (u < 26.6) {          // vertical swipe up
    const k = u - 25.8;
    return [hand({ x: 700, y: 560 - sm(0.3, 0.5, k) * 260, side: -1, rot: 0, thumb: 0.9 })];
  }
  if (u < 27) return [];
  if (u < 28) {            // horizontal swipe
    const k = u - 27;
    return [hand({ x: 400 + sm(0.3, 0.5, k) * 420, y: 420, side: -1, rot: 0, thumb: 0.9 })];
  }
  return [];
}

function faceAt(T) {
  const u = T % 30;
  if (u > 5 && u < 5.6) return null;
  const cx = 640 + 25 * Math.sin(T * 0.9), cy = 300, fw = 170;
  const yaw = 0.25 * Math.sin(T * 0.7);
  const open = Math.max(0, Math.sin(T * 1.3));
  const f = [];
  for (let i = 0; i < 478; i++) {
    const a = i * 2.39996;
    const r = Math.sqrt((i % 200) / 200);
    f.push({ x: (cx + Math.cos(a) * r * fw * 0.5) / W, y: (cy + Math.sin(a) * r * fw * 0.62) / H, z: 0 });
  }
  const P = (i, x, y) => { f[i] = { x: (cx + x) / W, y: (cy + y) / H, z: 0 }; };
  const my = 55, mw = 30, gap = 22 * open;
  P(13, 0, my - gap / 2); P(14, 0, my + gap / 2); P(61, -mw, my); P(291, mw, my);
  const inner = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
  inner.forEach((idx, k) => {
    const a = Math.PI + k * Math.PI / 10;
    if (idx !== 13 && idx !== 14) P(idx, Math.cos(a) * mw * 0.8, my + Math.sin(a) * gap / 2);
  });
  P(468, -32, -18); P(473, 32, -18); P(33, -45, -18); P(133, -20, -18); P(362, 20, -18); P(263, 45, -18);
  P(1, yaw * 60, 15); P(234, -85, 0); P(454, 85, 0);
  const brow = (T % 7) < 4 ? 0.7 : 0.1;
  return { landmarks: f, blend: [{ categories: [
    { categoryName: "browInnerUp", score: brow },
    { categoryName: "eyeWideLeft", score: brow * 0.5 },
    { categoryName: "eyeWideRight", score: brow * 0.5 },
    { categoryName: "jawOpen", score: open } ] }] };
}

export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const HandLandmarker = {
  createFromOptions: async () => ({
    detectForVideo(video, t) {
      const hs = handsAt(t / 1000);
      window.__lastHands = hs.map((h) => h.lm);
      return { landmarks: hs.map((h) => h.lm), worldLandmarks: hs.map((h) => h.world),
               handedness: hs.map((h) => [{ categoryName: h.label, score: 0.9 }]) };
    },
  }),
};
export const FaceLandmarker = {
  createFromOptions: async () => ({
    detectForVideo(video, t) {
      const f = faceAt(t / 1000);
      return f ? { faceLandmarks: [f.landmarks], faceBlendshapes: f.blend } : { faceLandmarks: [], faceBlendshapes: [] };
    },
  }),
};
export const ImageSegmenter = {
  createFromOptions: async () => ({
    segmentForVideo(video, t, cb) {
      const mw = 256, mh = 144, conf = new Float32Array(mw * mh);
      const T = t / 1000, sway = 10 * Math.sin(T);
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
        const X = x * 5 + 2.5, Y = y * 5 + 2.5;
        const head = ((X - 640 - sway) / 90) ** 2 + ((Y - 300) / 115) ** 2;
        const body = ((X - 640 - sway) / 260) ** 2 + ((Y - 720) / 300) ** 2;
        const d = Math.min(head, body);
        conf[y * mw + x] = d < 0.8 ? 1 : d < 1.1 ? (1.1 - d) / 0.3 : 0;
      }
      cb({ confidenceMasks: [{ width: mw, height: mh, getAsFloat32Array: () => conf }] });
    },
  }),
};
