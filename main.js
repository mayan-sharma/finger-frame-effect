// Finger Frame Effect
// Hold both hands up in an open "L" (thumb + index spread). The four fingertips
// form a quad, and the selected visual effect renders inside it.
// Keys 1-9 and 0 switch effects; arrow keys / click cycle. Append ?demo for a
// synthetic scene when no camera is available.
//
// Beyond the four pixel effects:
//   Polaroid — the frame is a camera: squeeze it to take a shot, which
//            prints, flies to a pile and develops; `s` saves it.
//   Matrix — digital rain in front of you; `k` cuts you out so it falls behind.
//   Portal — you stay real (selfie segmentation) and the world behind you is
//            replaced; press its key again to cycle scenes.
//   Smoke  — no frame needed: raise two fingers and a cigarette sits between
//            them; a thumbs-up on the other hand is a lighter. Once it is
//            lit, open your mouth and you exhale smoke.
//   Rainbow — no frame either: open your mouth and a rainbow pours out.
//   Gags   — also frame-less, a pose plus a trigger each: Finger Guns (drop
//            the thumb), Snap (you turn to dust), Kamehameha (charge, shove),
//            Web (thwip), Laser Eyes (raise your eyebrows), Claws (make a
//            fist, then swing), Infinite Void (hold Gojo's crossed-finger
//            sign), Hollow Purple (fuse blue and red, then thrust) and Shadow
//            Clone (both hands in the two-finger sign) and Strange Portal
//            (draw a circle in the air). Speech Bubbles puts what you say in
//            a comic bubble. Spirit Bomb (raise both hands, throw them down)
//            and Time Stone (twist an open hand to rewind the room). `f` fires
//            the current one by hand.

"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WRIST = 0, THUMB_IP = 3, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_TIP = 8, MIDDLE_MCP = 9;
const RING_MCP = 13, PINKY_MCP = 17;

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


// --- The frame as a knob ---------------------------------------------------
// Dial calibration. The area bounds are deliberately tighter than AREA_MIN /
// AREA_MAX above: those decide whether a quad is a frame at all, these decide
// where the dial reads 0 and 1, and a dial that only saturates at the very
// edge of what tracking accepts is a dial nobody ever reaches.
const KNOB_AREA_LO = 0.012;      // quad area fraction that reads as "closed"
const KNOB_AREA_HI = 0.26;       // ... and as "wide open"
const KNOB_TILT_MAX = Math.PI / 4;  // tilt that pins the dial to +/-1
const KNOB_ASPECT_MAX = 1.1;     // log2(w/h) that pins the dial to +/-1
const KNOB_LERP = 0.16;          // dial smoothing per frame
const KNOB_PUNCH_GAIN = 14;      // how hard a fast squeeze fires the transient
const KNOB_PUNCH_DECAY = 0.90;

const EFFECTS = ["Pixelate", "Blur", "Noir", "Glitch", "Matrix", "Portal",
                 "Smoke", "Rainbow",
                 "Finger Guns", "Snap", "Kamehameha", "Web", "Laser Eyes", "Claws",
                 "Infinite Void", "Hollow Purple", "Shadow Clone",
                 "Strange Portal", "Speech Bubbles", "Polaroid",
                 "Spirit Bomb", "Time Stone"];
// Effects 1-10 are the number row (0 is the tenth); the rest walk the
// keyboard's top row left to right. Single source of truth for the chips and
// the key handler.
const EFFECT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
                     "q", "w", "e", "r", "t", "y", "u", "i", "o", "p",
                     "a", "d"];

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

// --- Portal / Matrix: person mask ------------------------------------------
const SEG_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/" +
  "selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const PORTAL_SCENES = ["Space", "Synthwave", "Sunset"];

// Matrix rain, ported from the terminal build. Rendered on a coarse grid and
// scaled up, so the glyph cells stay chunky and readable.
const MATRIX_CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789XYZ";

// --- Smoke: a cigarette between two raised fingers, and an exhale -----------
// The one effect that ignores the frame. It is driven by a one-hand pose
// (index + middle up, ring + pinky curled) and by how far the mouth is open,
// so it needs face landmarks on top of the hand tracker.
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/" +
  "face_landmarker/float16/1/face_landmarker.task";
// Face mesh indices: inner-lip centres and the outer mouth corners.
const LIP_UP = 13, LIP_LO = 14, MOUTH_L = 61, MOUTH_R = 291;

// Finger "straightness" is the cosine between a finger's first bone and the
// rest of it, in the tracker's metric 3D landmarks: ~1 extended, <0 in a fist.
// The pair of thresholds is a hysteresis latch, so a relaxed hold (nobody
// keeps a smoking hand ramrod straight) does not flicker the cigarette.
const POSE_UP_ON = 0.75, POSE_UP_OFF = 0.55;
const POSE_DOWN_ON = 0.5, POSE_DOWN_OFF = 0.75;
const CIG_CONFIRM_FRAMES = 3;    // frames the pose must hold before it lights
const CIG_LOST_FRAMES = 8;       // frames it survives a tracking dropout

// Real-world sizes, in metres, scaled by the hand's measured pixels-per-metre
// so the cigarette stays in proportion at any distance from the camera.
const CIG_LEN_M = 0.09;
const CIG_DIA_M = 0.0102;
const FINGER_W_M = 0.0185;       // the index finger that passes in front of it
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

// Mouth-open ratio = lip gap / mouth width. Talking and a toothy grin both
// peak around 0.2, so the latch sits above that and lets go below it.
const MOUTH_ON = 0.28, MOUTH_OFF = 0.16, MOUTH_SPAN = 0.3;
const BREATH_S = 2.6;            // seconds for a held-open exhale to thin out
const BREATH_REFILL_S = 1.4;
const EXHALE_RATE = 150;         // particles per second at full breath
const WISP_RATE = 60;            // ... rising off the lit tip
const SMOKE_MAX = 900;
const SMOKE_RES = 0.25;          // smoke layer scale: low-res reads as soft

// --- Rainbow: open your mouth and a rainbow pours out ------------------------
// Rides on Smoke's mouth tracking. The inner-lip loop (upper lip left to
// right, then the lower lip back) is filled as well, so the stream starts
// inside the mouth rather than hanging off the lips.
const LIPS_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308,
                    324, 318, 402, 317, 14, 87, 178, 88, 95];
const RAINBOW = ["#ff3d3d", "#ff9a1f", "#ffe62e", "#35d45a", "#2f96ff", "#8a4dff"];
// Physics is in mouth widths, so it looks the same near or far from the
// camera. Gravity is far below the real thing on purpose: at true scale the
// stream leaves the screen in a quarter of a second and reads as a flash.
const RB_WIDTH = 0.9;            // stream width, x the inner mouth width
const RB_SPEED = 4.5;            // launch speed, mouth widths / s
const RB_GRAVITY = 30;           // mouth widths / s^2
const RB_MAX_SPEED = 13;         // terminal speed, so it pours rather than drops
const RB_WOBBLE = 0.13;          // sideways wiggle, x stream width
const RB_FLARE = 0.4;            // how much wider it gets as it falls
const RB_STAR_RATE = 16;         // sparkles per second while it flows

// --- Gesture gags ------------------------------------------------------------
// Distances on the hand are in palm lengths (wrist -> middle knuckle), so
// every threshold holds for any hand size and distance from the camera.

// Finger Guns: index out, the rest curled, thumb cocked up. Dropping the
// thumb onto the hand fires (its reach to the index's first bone falls
// through GUN_HAMMER), and so does the recoil flick: the fingertip jerking up
// off its knuckle faster than GUN_FLICK palm lengths a second.
const GUN_COCK = 0.42, GUN_HAMMER = 0.28;
const GUN_FLICK = 4.5;
const GUN_COOLDOWN_S = 0.18;
const GUN_FLASH_S = 0.09;
const GUN_TRACER_S = 0.12;
const GUN_HOLE_S = 5;            // bullet holes stay in the glass this long
const GUN_HOLES_MAX = 14;
const GUN_POP_S = 0.6;
const GUN_CASING_S = 1.1;
const GUN_WORDS = ["BANG!", "PEW!", "POW!"];

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

// Kamehameha: both palms together charges the ball; once it has charged a
// moment, a shove fires it. Sideways is a beam; at the camera (the hands
// suddenly grow) is a blast that fills the screen.
const KAME_TOGETHER = 1.25;      // palm-centre gap
const KAME_CHARGE_S = 1.6;       // to full size
const KAME_MIN_S = 0.5;          // charge needed before it will fire
const KAME_THRUST = 1.8;         // palm lengths / s sideways
const KAME_PUSH = 0.6;           // relative growth / s in hand size
const KAME_BEAM_S = 1.8;
const KAME_LOST_FRAMES = 8;

// Web: index + pinky up, middle + ring folded. Each new thwip shoots.
const WEB_COOLDOWN_S = 0.35;
const WEB_SHOT_S = 0.12;         // line travel time
const WEB_LIFE_S = 7;            // splats stay on the glass this long
const WEB_MAX = 8;

// Laser Eyes: blendshape score (brow raise or wide eyes) latch, and how far
// a head turn (nose offset in face widths) throws the beams.
const LASER_ON = 0.45, LASER_OFF = 0.28;
const LASER_GAIN = 5;
const IRIS_R = 468, IRIS_L = 473;  // iris centres in the 478-point face mesh
const NOSE_TIP = 1, FACE_R = 234, FACE_L = 454;

// Claws: a fist pops three from between the knuckles. Swing it with the tips
// moving faster than SLASH_SPEED palm lengths a second and they slash.
const CLAW_LEN_M = 0.28;         // real ones are a foot long
const CLAW_W_M = 0.009;          // blade width at the root
const CLAW_OUT_S = 0.11, CLAW_IN_S = 0.16;
const CLAW_LOST_FRAMES = 6;
const SLASH_SPEED = 8;
const CLAW_SLASH_GAP_S = 0.25;
const SLASH_S = 4;               // gashes stay in the glass this long
const SLASH_MAX = 18;

// Infinite Void: index + middle up and crossed (or pressed together), ring +
// pinky curled, held for VOID_HOLD_S. Crossing is crossAmount() falling
// through VOID_CROSS_ON; the same sign again collapses the domain.
const VOID_CROSS_ON = 0.25, VOID_CROSS_OFF = 0.5;
const VOID_HOLD_S = 0.45;
const VOID_OPEN_S = 0.9, VOID_CLOSE_S = 0.6;
const VOID_STARS = 360;

// Hollow Purple: an orb over each hand (blue on the left of the screen, red
// on the right). Held within PURPLE_FUSE palm lengths for PURPLE_FUSE_S they
// fuse; after PURPLE_MIN_S a shove fires it (the Kamehameha test).
const PURPLE_FUSE = 1.6;
const PURPLE_FUSE_S = 0.7;
const PURPLE_MIN_S = 0.4;
const PURPLE_THRUST = 2;         // palm lengths / s sideways
const PURPLE_SPEED = 0.9;        // screen diagonals / s
const PURPLE_SCAR_S = 3;         // the tunnel it erased lasts this long

// Shadow Clone: both hands in the two-finger pose, palm centres within
// CLONE_SIGN_GAP palm lengths, held for CLONE_HOLD_S. Clones replay you from
// a ring buffer of CLONE_BUF cut-outs, captured every other frame.
const CLONE_SIGN_GAP = 1.6;
const CLONE_HOLD_S = 0.4;
const CLONE_BUF = 12;

// Strange Portal: index up (ring + pinky curled) draws. A stretch of the
// fingertip's trail that sweeps STRANGE_SWEEP radians round its own centroid,
// with radius spread under STRANGE_ROUND of its mean, is a circle.
const STRANGE_SWEEP = Math.PI * 1.75;
const STRANGE_ROUND = 0.38;
const STRANGE_MIN_R = 0.05;      // of screen height
const STRANGE_TRAIL_S = 2.2;
const STRANGE_OPEN_S = 0.55, STRANGE_CLOSE_S = 0.35;
const STRANGE_WORLDS = ["Mirror Dimension", ...PORTAL_SCENES];

// Speech Bubbles: the browser's speech recognition (`?lang=hi-IN` etc. to
// pick a language). A bubble finished BUBBLE_HOLD_S ago floats off.
const BUBBLE_MAX = 3;
const BUBBLE_LINES = 4;
const BUBBLE_HOLD_S = 2.2;
const BUBBLE_SHOUT = 0.7;        // mouth.open (0..1 past the latch) that is yelling

// Polaroid: squeezing the frame fast (punch past POLAROID_SQUEEZE) is the
// shutter. There is deliberately no self-timer: a shot only ever happens
// when you ask for one.
const POLAROID_SQUEEZE = 0.55;
const POLAROID_PX = 720;         // the print's photo width
const POLAROID_PILE = 8;
const POLAROID_DEVELOP_S = 5;

// Spirit Bomb: both open hands with palm centres above BOMB_RAISE of the
// screen height charge it. After BOMB_MIN_S, hands thrown down faster than
// BOMB_THROW palm lengths a second (or a shove at the camera) throw it.
const BOMB_RAISE = 0.55;
const BOMB_FULL_S = 4;
const BOMB_MIN_S = 1;
const BOMB_THROW = 2.2;
const BOMB_MAX_R = 0.2;          // of screen height, at full charge
const BOMB_FLY_S = 0.55;

// Time Stone: an open palm (three or more fingers up) stops time; twisting
// it moves time by TIME_GAIN seconds per radian, through a TIME_SPAN_S ring
// of TIME_W-wide frames captured at TIME_FPS. Let go and time runs at
// 1 + TIME_RETURN times real speed until it catches up.
const TIME_FPS = 20;
const TIME_SPAN_S = 6;
const TIME_W = 560;
const TIME_GAIN = 1.2;
const TIME_RETURN = 2;

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
const sScene = makeScratch(false);
const sPerson = makeScratch(false);
const sCig = makeScratch(false);     // cigarette, with the finger cut out of it
const sSmoke = makeScratch(false);   // low-res smoke layer
// Snap: mask-space layers, the background plate and its fill, the output.
const sSnapHole = makeScratch(false), sSnapErase = makeScratch(false);
const sSnapTmp = makeScratch(false), sSnapPlate = makeScratch(false);
const sSnapFill = makeScratch(false), sSnapOut = makeScratch(false);
const sSnapSample = makeScratch(true);
// Infinite Void: the half-res void, your aura, and you cut out in front.
const sVoid = makeScratch(false), sVoidAura = makeScratch(false), sVoidPerson = makeScratch(false);
const sStrange = makeScratch(false); // a Strange portal's world
// Laser Eyes: half-res burn marks, and their cooling glow.
const sScorch = makeScratch(false), sScorchGlow = makeScratch(false);

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

// Smoke state. Declared up here, not beside its code, because ?fx= selects
// the effect while the module is still evaluating.
let faceLandmarker = null;
let faceState = "idle";         // idle | loading | ready | error
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
const mouth = {
  seen: false, lost: 0, latched: false, open: 0, breath: 1,
  x: 0, y: 0, w: 1, gap: 0, dir: Math.PI / 2,
  poly: null, iw: 1,            // inner-lip outline and its width (Rainbow)
};
// Rainbow state. Slices are cross-sections of the stream, oldest first.
const rainbow = { slices: [], stars: [], lastT: 0, flowing: false,
                  px: 0, py: 0, vx: 0, vy: 0, starAcc: 0 };
const smokeParts = [];
let smokeLastT = 0;
let wispAcc = 0, exhaleAcc = 0;

// Gesture-gag state, up here for the same reason as Smoke's.
const guns = new Map();          // hand key -> gun
const gunFx = { tracers: [], holes: [], pops: [], casings: [] };
const snap = {
  phase: "idle", t: 0, prog: 0, // idle | snapped | dusting | gone | returning
  rings: [], pinch: new Map(), hand: null, handLost: 0,
  field: null, fw: 0, fh: 0, holeImg: null, eraseImg: null, cand: null,
  fillAge: 0, demoCycle: -1, lastHand: null, handP: 0,
};
const dust = [];
const snapLevels = [];           // the plate fill's halving pyramid
const kame = { on: false, lost: 0, charge: 0, x: 0, y: 0, palm: 1,
               hist: [], beam: null, motes: [], moteAcc: 0 };
const webs = { lines: [], hands: new Map() };
const laser = { seen: false, latched: false, forced: false, lost: 0, presence: 0,
                eyes: null, faceW: 1, dx: 0, dy: 0, ux: 0, uy: 1, v0: 0,
                lastHit: null, smokeAcc: 0 };
const claws = new Map();         // hand key -> its three claws
const slashes = [];
const voidFx = { phase: "idle", t: 0, cast: 0, x: 0, y: 0, hx: 0, hy: 0,
                 signOn: false, since: 0, armed: true, lost: 0, stars: [] };
const purple = {
  blue: { on: false, p: 0, x: 0, y: 0, palm: 1, lost: 0, born: 0 },
  red: { on: false, p: 0, x: 0, y: 0, palm: 1, lost: 0, born: 0 },
  near: false, merge: 0, formed: false, fp: 0, fx: 0, fy: 0, palm: 1,
  formedT: 0, lostT: 0, hist: [], shot: null, debris: [], cool: 0, title: 99,
};
const clones = {
  active: false, signOn: false, since: 0, armed: true, lost: 0, age: 0, title: 99,
  tick: 0, head: 0, filled: 0,
  // Front pair close in, back pair further out, smaller and later.
  list: [{ off: -0.27, s: 0.94, lag: 3, delay: 0 }, { off: 0.27, s: 0.94, lag: 4, delay: 0.09 },
         { off: -0.5, s: 0.78, lag: 7, delay: 0.18 }, { off: 0.5, s: 0.78, lag: 9, delay: 0.27 }]
    .map((c) => ({ ...c, shown: false, p: 0 })),
};
const cloneBuf = [];             // ring of your recent cut-outs
const strange = { trail: [], drawing: false, lost: 0, cool: 0, scale: 1, tipX: 0, tipY: 0,
                  tipAcc: 0, portals: [], world: 0 };
const speech = { state: "off", rec: null, now: 0, ratios: [], demoKey: "" };
const bubbles = [];
const polaroid = { pile: [], now: 0, flash: 0, lastSqueeze: 0, demoT: 0 };
const bomb = { up: false, forced: false, lost: 0, charge: 0, hx: 0, hy: 0, palm: 1, x: 0, y: 0, r: 0,
               hist: [], motes: [], acc: 0, shot: null, title: 99 };
const timeFx = { on: false, lost: 0, x: 0, y: 0, palm: 1, spin: 0, prevAng: null, prevT: 0,
                 target: Infinity, k: 0, head: 0, lastCap: -1 };
const timeBuf = [];              // ring of recent frames, each { s, t }
const gagSparks = [];
let gagLastT = 0;
let shake = 0;                   // screen shake, canvas px; decays every frame
// One entry per gag. `hands` gets the hand tracker's result and `face` the
// face tracker's, on each new video frame; `render` draws every frame;
// `demo` stands in for the camera; `trigger` is the `f` key.
const GAGS = {
  "Finger Guns": { hands: updateGuns, render: renderGuns, reset: resetGuns,
                   demo: demoGuns, trigger: triggerGuns },
  "Snap": { hands: updateSnap, render: renderSnap, reset: resetSnap,
            demo: demoSnap, trigger: triggerSnap },
  "Kamehameha": { hands: updateKame, render: renderKame, reset: resetKame,
                  demo: demoKame, trigger: triggerKame },
  "Web": { hands: updateWebs, render: renderWebs, reset: resetWebs,
           demo: demoWeb, trigger: triggerWeb },
  "Laser Eyes": { face: updateLaser, render: renderLaser, reset: resetLaser,
                  demo: demoLaser, trigger: triggerLaser },
  "Claws": { hands: updateClaws, render: renderClaws, reset: resetClaws,
             demo: demoClaws, trigger: triggerClaws },
  "Infinite Void": { hands: updateVoid, render: renderVoid, reset: resetVoid,
                     demo: demoVoid, trigger: triggerVoid },
  "Hollow Purple": { hands: updatePurple, render: renderPurple, reset: resetPurple,
                     demo: demoPurple, trigger: triggerPurple },
  "Shadow Clone": { hands: updateClones, render: renderClones, reset: resetClones,
                    demo: demoClones, trigger: triggerClones },
  "Strange Portal": { hands: updateStrange, render: renderStrange, reset: resetStrange,
                      demo: demoStrange, trigger: triggerStrange },
  "Speech Bubbles": { render: renderBubbles, reset: resetBubbles,
                      demo: demoBubbles, trigger: triggerBubbles },
  "Spirit Bomb": { hands: updateBomb, render: renderBomb, reset: resetBomb,
                   demo: demoBomb, trigger: triggerBomb },
  "Time Stone": { hands: updateTime, render: renderTime, reset: resetTime,
                  demo: demoTime, trigger: triggerTime },
};

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
// Portal cycles its scene on repeat presses; show which one is live so the
// extra press is discoverable rather than hidden.
function refreshChips() {
  [...hintEl.children].forEach((el, j) => {
    const label = el.querySelector(".n");
    if (!label) return;
    if (EFFECTS[j] === "Portal") {
      label.textContent = `Portal · ${PORTAL_SCENES[portalScene]}`;
    }
  });
}

// Which effects read the person mask. Segmentation is started for them and
// skipped for the rest.
const MASK_FX = new Set(["Portal", "Snap", "Infinite Void", "Shadow Clone", "Time Stone"]);
const wantsMask = (name) =>
  MASK_FX.has(name) || (name === "Matrix" && keepPerson);

function setEffect(i) {
  const idx = (i + EFFECTS.length) % EFFECTS.length;
  // Pressing the active Portal key again cycles its scene, so all three
  // worlds are reachable without extra keys.
  if (idx === effectIndex && EFFECTS[idx] === "Portal") {
    portalScene = (portalScene + 1) % PORTAL_SCENES.length;
    flashStatus(`Portal → ${PORTAL_SCENES[portalScene]}`);
  }
  effectIndex = idx;
  [...hintEl.children].forEach((el, j) => el.classList.toggle("active", j === effectIndex));
  refreshChips();
  const name = EFFECTS[idx];
  if (wantsMask(name)) ensureSegmenter();
  if (FACE_FX.has(name)) ensureFace();
  if (name === "Speech Bubbles") startSpeech();
  if (OVERLAY_FX.has(name)) flashStatus(OVERLAY_HINTS[name], 3500);
  if (name === "Polaroid") flashStatus("📸 Frame a shot with both hands — squeeze the frame to click", 3500);
  if (name !== "Smoke") resetSmoke();
  if (name !== "Rainbow") resetRainbow();
  for (const g in GAGS) if (g !== name) GAGS[g].reset();
  if (!GAGS[name]) { gagSparks.length = 0; shake = 0; }
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
  } else if ((e.key === "l" || e.key === "L") && EFFECTS[effectIndex] === "Smoke") {
    // Manual light / stub out, for when a second hand is not free.
    if (cig.lit) cig.lit = false; else lightCigarette();
    flashStatus(cig.lit ? "Lit 🔥" : "Stubbed out");
  } else if ((e.key === "f" || e.key === "F") && EFFECTS[effectIndex] === "Polaroid") {
    snapPolaroidNow();
  } else if ((e.key === "s" || e.key === "S") && EFFECTS[effectIndex] === "Polaroid") {
    savePolaroid();
  } else if ((e.key === "f" || e.key === "F") && GAGS[EFFECTS[effectIndex]]) {
    // Fires the current gag without the gesture.
    GAGS[EFFECTS[effectIndex]].trigger();
  }
});
canvas.addEventListener("click", (e) => {
  // On Polaroid, a click on the pile saves the newest print.
  const k = canvas.width / (canvas.clientWidth || 1);
  if (EFFECTS[effectIndex] === "Polaroid" && onPolaroidPile(e.offsetX * k, e.offsetY * k)) {
    savePolaroid();
    return;
  }
  setEffect(effectIndex + 1);
});

function setStatus(text) {
  if (text === null) { statusEl.classList.add("hidden"); return; }
  statusEl.textContent = text;
  statusEl.classList.remove("hidden");
}

let flashTimer = 0;
function flashStatus(text, ms = 1600) {
  setStatus(text);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => setStatus(null), ms);
}
const FRAME_HINT = "Show both hands — thumb + index like a picture frame 🤳";
// The effects that ignore the frame and overlay the whole feed instead...
const OVERLAY_HINTS = {
  Smoke: "✌️ holds a cigarette — 👍 with your other hand lights it",
  Rainbow: "Open your mouth wide 🌈",
  "Finger Guns": "👉 Finger gun, thumb up — drop the thumb to fire",
  Snap: "🫰 Snap your fingers… and step back into the frame",
  Kamehameha: "Cup both hands together to charge — then shove them out",
  Web: "🤟 Thwip! Index + pinky up, middle + ring folded",
  "Laser Eyes": "Raise your eyebrows 👀 — turn your head to aim",
  Claws: "Make a fist ✊ — then swing to slash",
  "Infinite Void": "🤞 Cross index + middle fingers and hold — Domain Expansion",
  "Hollow Purple": "Raise both hands — 蒼 and 赫. Bring them together, then thrust 🟣",
  "Shadow Clone": "✌️✌️ Both hands two-finger sign, held together — Shadow Clone",
  "Strange Portal": "☝️ Draw a circle in the air to open a portal — draw over it to close",
  "Speech Bubbles": "🗨️ Just talk — allow the mic and your words appear in a comic bubble",
  "Spirit Bomb": "🙌 Raise both open hands high to gather light — throw them down",
  "Time Stone": "✋ Open palm stops time — twist it like a dial to rewind",
};
const OVERLAY_FX = new Set(Object.keys(OVERLAY_HINTS));
// ...and the ones among them that need the face tracker.
const FACE_FX = new Set(["Smoke", "Rainbow", "Laser Eyes", "Speech Bubbles"]);

// ---------------------------------------------------------------------------
// Camera + MediaPipe init
// ---------------------------------------------------------------------------

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
      const mod = await import(base + "vision_bundle.mjs");
      const fileset = await mod.FilesetResolver.forVisionTasks(base + "wasm");
      visionLib = { mod, fileset };
      return visionLib;
    })().catch((err) => { visionLoading = null; throw err; });
  }
  return visionLoading;
}

async function initTracker() {
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

// A failed load is not final: selecting the effect again retries it.
async function ensureSegmenter() {
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

// --- Face landmarks (the mouth for Smoke and Rainbow, eyes for Laser Eyes) ----

async function ensureFace() {
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

// ?fx=8 selects a starting effect (1-based) and ?scene=2 a portal scene
// (0-based).
{
  const fx = parseInt(urlParams.get("fx"), 10);
  const sc = parseInt(urlParams.get("scene"), 10);
  if (sc >= 0 && sc < PORTAL_SCENES.length) portalScene = sc;
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
      setStatus(OVERLAY_HINTS[EFFECTS[effectIndex]] || FRAME_HINT);
    } catch (err) {
      console.warn("Falling back to demo mode:", err);
      demoMode = true;
    }
  }
  if (demoMode) {
    badgeEl.classList.add("show");
    setStatus("Demo mode — synthetic frame, keys 1-0 / q-p / a d switch effects");
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
// The frame as a knob
//
// Until now the quad was a stencil and nothing more: it said WHERE an effect
// drew and never HOW. But your hands are already holding three continuous
// values — how far apart they are, how far you tilt them, how far you squash
// the box — and discarding them means every effect runs at one fixed setting
// forever. So the quad's geometry is normalized into four dials that every
// effect reads, with the same meaning everywhere, so learning them on one
// effect transfers to all of them:
//
//   size    0..1   how much. Open your hands for more, close them for less.
//   tilt   -1..1   which angle / which hue. Rotate the frame.
//   aspect -1..1   a second axis. Squash the box wide or tall.
//   punch   0..1   a transient. A fast squeeze fires it; it then decays.
//
// Everything is smoothed, because raw fingertip geometry jitters by a few
// pixels every frame and an unsmoothed dial makes the whole effect buzz.
// ---------------------------------------------------------------------------

const knobs = { size: 0.5, tilt: 0, aspect: 0, punch: 0 };
let knobSizePrev = null;         // null = no frame last time, so no punch

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);

function updateKnobs(q) {
  if (!q) {
    // No frame up: let the transient die but leave the dials where they were,
    // so a momentary tracking dropout does not slam every effect to neutral.
    knobs.punch *= KNOB_PUNCH_DECAY;
    knobSizePrev = null;
    return;
  }

  // Square-root the area so the dial tracks the box's linear size. On area
  // alone, moving your hands apart at arm's length barely registers while the
  // last few centimetres near a closed frame swing it wildly.
  const lo = Math.sqrt(KNOB_AREA_LO), hi = Math.sqrt(KNOB_AREA_HI);
  const lin = Math.sqrt(polyArea(q) / (canvas.width * canvas.height));
  const size = clamp01((lin - lo) / (hi - lo));

  // Corners are [L.index, R.index, R.thumb, L.thumb], so 0->1 is the frame's
  // top edge and 0->3 its left edge.
  const tx = q[1].x - q[0].x, ty = q[1].y - q[0].y;
  const lx = q[3].x - q[0].x, ly = q[3].y - q[0].y;
  const tilt = clamp(Math.atan2(ty, tx) / KNOB_TILT_MAX, -1, 1);
  const w = Math.max(1e-3, Math.hypot(tx, ty));
  const h = Math.max(1e-3, Math.hypot(lx, ly));
  const aspect = clamp(Math.log(w / h) / Math.LN2 / KNOB_ASPECT_MAX, -1, 1);

  // Punch is |d size| per frame, so it fires on a *fast* squeeze and ignores
  // a slow one. It rises instantly and decays, which is what makes it read as
  // a hit rather than another position dial.
  const d = knobSizePrev === null ? 0 : size - knobSizePrev;
  knobSizePrev = size;
  knobs.punch = Math.max(knobs.punch * KNOB_PUNCH_DECAY,
                         clamp01(Math.abs(d) * KNOB_PUNCH_GAIN));

  knobs.size += (size - knobs.size) * KNOB_LERP;
  knobs.tilt += (tilt - knobs.tilt) * KNOB_LERP;
  knobs.aspect += (aspect - knobs.aspect) * KNOB_LERP;
}

// A readout, because a dial you cannot see is a dial you cannot learn. The
// bipolar ones fill outward from the centre so "off centre" is the signal.
const knobEl = document.getElementById("knobs");
const KNOB_ROWS = [
  { key: "size", bipolar: false, cls: "" },
  { key: "tilt", bipolar: true, cls: "" },
  { key: "aspect", bipolar: true, cls: "" },
  { key: "punch", bipolar: false, cls: "punch" },
];
const knobFills = KNOB_ROWS.map((row) => {
  const el = document.createElement("div");
  el.className = "knob";
  el.innerHTML = `<span class="kl">${row.key}</span>` +
    `<div class="bar${row.bipolar ? " bipolar" : ""}${row.cls ? " " + row.cls : ""}"><i></i></div>`;
  knobEl.appendChild(el);
  return el.querySelector("i");
});

function refreshKnobReadout(visible) {
  knobEl.classList.toggle("hidden", !visible);
  if (!visible) return;
  KNOB_ROWS.forEach((row, i) => {
    const v = knobs[row.key];
    const origin = row.bipolar ? 50 : 0;
    const span = row.bipolar ? v * 50 : v * 100;
    knobFills[i].style.left = `${Math.min(origin, origin + span)}%`;
    knobFills[i].style.width = `${Math.abs(span)}%`;
  });
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
  // Ranges are wide enough to sweep the size / tilt / aspect dials through
  // most of their travel, so `?demo` exercises the knobs too.
  const hw = w * (0.15 + 0.10 * Math.sin(t * 0.0007));
  const hh = h * (0.17 + 0.09 * Math.cos(t * 0.0006));
  const rot = Math.sin(t * 0.0003) * 0.45;
  const c = Math.cos(rot), s = Math.sin(rot);
  const pt = (dx, dy) => ({ x: cx + dx * c - dy * s, y: cy + dx * s + dy * c });
  return [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)];
}

// ---------------------------------------------------------------------------
// Effects — each reads the frame canvas within bbox and draws into ctx,
// which is already clipped to the quad with globalAlpha = presence.
// ---------------------------------------------------------------------------

function fxPixelate(bx, by, bw, bh) {
  // Knob: closing the frame coarsens the blocks, opening it refines them.
  const cell = Math.max(3,
    Math.round((canvas.width / 53) * (2.3 - 1.9 * knobs.size)));
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
  // Frosted glass. Knob: size is focus — a wide frame is nearly sharp, a
  // closed one is soup; tilt shifts the hue.
  const radius = (3 + 26 * (1 - knobs.size)).toFixed(1);
  ctx.filter = `blur(${radius}px) saturate(1.15) brightness(1.06) hue-rotate(${(knobs.tilt * 60) | 0}deg)`;
  // Overdraw beyond the bbox so the blur doesn't pull in transparent edges.
  const pad = 30;
  ctx.drawImage(frame, bx - pad, by - pad, bw + pad * 2, bh + pad * 2,
    bx - pad, by - pad, bw + pad * 2, bh + pad * 2);
  ctx.filter = "none";
  // The frost: a cool milky wash, and a fine static grain the light catches.
  ctx.fillStyle = "rgba(225,235,245,0.08)";
  ctx.fillRect(bx, by, bw, bh);
  filmGrain(bx, by, bw, bh, 0.1);
}

function fxNoir(bx, by, bw, bh, t) {
  // Knob: size drives contrast, from flat grey up to hard blacks-and-whites;
  // tilt warms it from cold silver toward a faded sepia print.
  const con = (0.85 + 1.5 * knobs.size).toFixed(2);
  const sep = clamp01(knobs.tilt).toFixed(2);
  ctx.filter = `grayscale(1) contrast(${con}) brightness(0.95) sepia(${sep})`;
  ctx.drawImage(frame, bx, by, bw, bh, bx, by, bw, bh);
  ctx.filter = "none";
  // Film: a vignette pulled in toward the middle of the frame, a little gate
  // weave in its brightness, and grain that is new every frame.
  const cx = bx + bw / 2, cy = by + bh / 2, r = Math.hypot(bw, bh) / 2;
  const v = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(0,0,0,${0.55 + 0.04 * Math.sin(t * 0.011)})`);
  ctx.fillStyle = v;
  ctx.fillRect(bx, by, bw, bh);
  filmGrain(bx, by, bw, bh, 0.28);
}

// A tile of noise, drawn at a random offset each frame in "overlay" mode:
// grain that crawls like film rather than sitting on the image like a screen.
let grainTile = null;
function filmGrain(bx, by, bw, bh, alpha) {
  if (!grainTile) {
    grainTile = document.createElement("canvas");
    grainTile.width = grainTile.height = 192;
    const g = grainTile.getContext("2d"), img = g.createImageData(192, 192);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() + Math.random() - 1) * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const pat = ctx.createPattern(grainTile, "repeat");
  const scale = Math.max(1, canvas.height / 900);
  pat.setTransform(new DOMMatrix([scale, 0, 0, scale, Math.random() * 192, Math.random() * 192]));
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();
}

// The frame as a pane of glass: a soft shadow outside it, a bright rim just
// inside, and a faint diagonal sheen across it that turns with the frame.
function drawGlassEdge(q, alpha) {
  const u = unit();
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round";
  path();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 22 * u;
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 2 * u;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 9 * u;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1.3 * u;
  ctx.stroke();
  const a = q[0], b = q[2];
  const sheen = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  sheen.addColorStop(0.18, "rgba(255,255,255,0)");
  sheen.addColorStop(0.3, "rgba(255,255,255,0.07)");
  sheen.addColorStop(0.36, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fill();
  ctx.restore();
}

// Deterministic per-cell hash, so glitch bands are stable within a burst.
function cellHash(i, j) {
  const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function fxGlitch(bx, by, bw, bh, t) {
  const g = sizeScratch(sGlitchSrc, bw, bh);
  g.clearRect(0, 0, bw, bh);
  // Knob: a closed frame glitches harder, and a fast squeeze fires a burst.
  // Punch is the best showcase for the transient dial — the tear is over
  // before the dial has finished decaying.
  const sev = 0.35 + 0.85 * (1 - knobs.size) + 2.4 * knobs.punch;

  // Horizontal slice displacement, jittering over time.
  const seed = Math.floor(t / 90);
  let y = 0, i = 0;
  while (y < bh) {
    const sh = 8 + Math.floor(cellHash(seed, i) * 40);
    const off = (cellHash(seed + 13, i * 7) - 0.5) * bw * 0.06 * sev *
      (cellHash(seed + 5, i) > 0.6 ? 1 : 0.15);
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

  const shift = Math.round(8 * sev);
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

// Column speed is a function of absolute time, so a punch cannot just scale
// it — that would teleport the rain. It advances a shared time offset instead,
// which every column inherits at its own rate.
let matrixRush = 0;

function fxMatrix(bx, by, bw, bh, t) {
  matrixRush += knobs.punch * 60;
  const g = sizeScratch(sScene, bw, bh);
  g.fillStyle = "#010703";
  g.fillRect(0, 0, bw, bh);

  // Knob: size is rain density, punch shoves every column downward at once.
  const cols = Math.max(8, Math.min(90,
    Math.round((bw / 22) * (0.55 + 1.0 * knobs.size))));
  const cw = bw / cols;
  const fs = cw * 0.9;
  const rows = Math.ceil(bh / fs);
  const trail = 14;
  g.font = `bold ${fs}px monospace`;
  g.textAlign = "center";
  for (let c = 0; c < cols; c++) {
    // Per-column speed and offset, fixed by hash: the rain is steady rather
    // than reshuffling every frame.
    const speed = 0.006 + 0.012 * cellHash(c, 3);
    const head = (((t + matrixRush) * speed + cellHash(c, 9) * 100) %
      (rows + trail)) - 1;
    for (let k = 0; k < trail; k++) {
      const row = Math.floor(head) - k;
      if (row < 0 || row > rows) continue;
      const mut = Math.floor(t / 400);
      const ch = MATRIX_CHARS[
        Math.floor(cellHash(c * 31 + 7, row * 17 + (k === 0 ? mut : 0)) *
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
      const x = (cellHash(i, L * 11 + 1) * w + t * speed) % w;
      const y = cellHash(i + 41, L * 7 + 3) * h;
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
    const sx = w * (0.15 + 0.6 * cellHash(epoch, 5));
    const sy = h * (0.1 + 0.3 * cellHash(epoch, 9));
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
      const cw2 = w * (0.3 + 0.16 * cellHash(i, L));
      const x = ((cellHash(i, L + 5) * w + t * (0.006 + L * 0.004)) % (w + cw2)) - cw2 / 2;
      const y = h * (0.18 + 0.22 * cellHash(i + 3, L + 1)) + L * h * 0.06;
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

// The scenes animate off absolute time, so the size knob cannot just scale it
// — that would jump the stars around. It runs a clock of its own instead.
let portalClock = 0;
let portalLastT = 0;

// --- Polaroid ------------------------------------------------------------------

// Inside the frame: the plain feed as a viewfinder, with thirds lines and
// focus corners.
function fxPolaroid(bx, by, bw, bh) {
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

function fxPortal(bx, by, bw, bh, t) {
  // Knob: size is how fast the other world runs, from nearly frozen to a
  // world in fast-forward.
  const step = Math.min(64, Math.max(0, t - portalLastT));
  portalLastT = t;
  portalClock += step * (0.25 + 2.0 * knobs.size);

  // Another world replaces the box…
  const g = sizeScratch(sScene, bw, bh);
  g.save();
  PORTAL_SCENE_FNS[portalScene](g, bw, bh, portalClock);
  g.restore();
  ctx.drawImage(sScene.c, bx, by);
  // …except you, who stay real in front of it.
  drawPersonOver(bx, by, bw, bh);
}


// ---------------------------------------------------------------------------
// Smoke — a lit cigarette between two raised fingers, and an exhale
//
// Unlike everything above, this one is not drawn inside the frame. It is an
// overlay on the whole feed with two independent triggers: a hand showing
// exactly two fingers gets a cigarette pinched between them, and an open
// mouth breathes smoke. Bring the filter to your lips and the ember flares.
// ---------------------------------------------------------------------------

// Cosine between a finger's first bone (MCP -> PIP) and the rest of it
// (PIP -> tip). Works on the metric world landmarks, so a finger pointing at
// the camera still reads as straight where a 2D test would call it curled.
function fingerStraightness(w, mcp) {
  const a = w[mcp], b = w[mcp + 1], c = w[mcp + 3];
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const d = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
  return d > 1e-12 ? (ux * vx + uy * vy + uz * vz) / d : 0;
}

// Index + middle up, ring + pinky down. The thumb is ignored: it is tucked in
// for a peace sign and loose for a smoker's hold, and both should count.
function isTwoFingerPose(w, latched) {
  const up = latched ? POSE_UP_OFF : POSE_UP_ON;
  const down = latched ? POSE_DOWN_OFF : POSE_DOWN_ON;
  return fingerStraightness(w, INDEX_MCP) > up &&
         fingerStraightness(w, MIDDLE_MCP) > up &&
         fingerStraightness(w, RING_MCP) < down &&
         fingerStraightness(w, PINKY_MCP) < down;
}

// Bones used to measure the hand's on-screen scale. Summing several means no
// single foreshortened bone decides it.
const SCALE_BONES = [[0, 5], [0, 17], [5, 17], [5, 8], [9, 12]];

function handPxPerMetre(pts, world) {
  if (!world) return dist(pts[WRIST], pts[MIDDLE_MCP]) / 0.095;
  let px = 0, m = 0;
  for (const [a, b] of SCALE_BONES) {
    px += dist(pts[a], pts[b]);
    m += Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y);
  }
  return m > 1e-6 ? px / m : dist(pts[WRIST], pts[MIDDLE_MCP]) / 0.095;
}

const lerpPt = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

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

// Screen-space lips in, mouth state out. `up`/`lo` are the inner-lip centres;
// `poly` is the inner-lip outline, left corner first and right corner at [10].
function applyMouth(up, lo, left, right, poly) {
  const w = Math.max(1, dist(left, right));
  const gap = dist(up, lo);
  const ratio = gap / w;
  mouth.ratio = ratio;
  mouth.latched = ratio > (mouth.latched ? MOUTH_OFF : MOUTH_ON);
  mouth.open = mouth.latched ? clamp01((ratio - MOUTH_OFF) / MOUTH_SPAN) : 0;
  mouth.x = (up.x + lo.x) / 2;
  mouth.y = (up.y + lo.y) / 2;
  mouth.w = w;
  mouth.gap = gap;
  mouth.poly = poly || null;
  mouth.iw = poly ? dist(poly[0], poly[10]) : w * 0.8;
  // Upper lip -> lower lip is "down the face", which is where breath goes,
  // and it stays right when the head is tilted.
  if (mouth.latched) mouth.dir = Math.atan2(lo.y - up.y, lo.x - up.x);
  mouth.seen = true;
  mouth.lost = 0;
}

function updateMouth(res) {
  const f = res.faceLandmarks && res.faceLandmarks[0];
  if (!f) {
    if (++mouth.lost > 10) { mouth.seen = false; mouth.latched = false; mouth.open = 0; }
    return;
  }
  applyMouth(toScreen(f[LIP_UP]), toScreen(f[LIP_LO]),
             toScreen(f[MOUTH_L]), toScreen(f[MOUTH_R]),
             LIPS_INNER.map((i) => toScreen(f[i])));
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

// --- Smoke particles --------------------------------------------------------

// A few lumpy puff sprites. One round gradient stamped a few hundred times
// reads as a pile of circles; irregular ones, each spinning, read as smoke.
// The grey is deliberately a mid-light blue-grey rather than white: white
// smoke vanishes against a bright wall or a shirt, this shows on both.
const smokeSprites = Array.from({ length: 4 }, () => {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d");
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = i === 0 ? 0 : 6 + Math.random() * 12;
    const x = 48 + Math.cos(a) * d, y = 48 + Math.sin(a) * d;
    const r = 29 - d * 0.55;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(206,210,220,0.42)");
    grad.addColorStop(0.5, "rgba(206,210,220,0.16)");
    grad.addColorStop(1, "rgba(206,210,220,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
  }
  return c;
});

function emitSmoke(p) {
  if (smokeParts.length >= SMOKE_MAX) return;
  p.age = 0;
  p.fine = !!p.fine;
  p.rot = Math.random() * Math.PI * 2;
  p.spin = (Math.random() - 0.5) * 1.4;
  p.sprite = (Math.random() * smokeSprites.length) | 0;
  smokeParts.push(p);
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

function stepSmoke(dt, time) {
  // One flow field for every particle, so neighbours bend together and the
  // plume forms ribbons instead of boiling as independent dots.
  const k = (Math.PI * 2) / (canvas.height * 0.22);
  let n = 0;
  for (let i = 0; i < smokeParts.length; i++) {
    const p = smokeParts[i];
    p.age += dt;
    if (p.age >= p.life) continue;
    const drag = Math.exp(-p.drag * dt);
    const fx = Math.sin(p.y * k + time * 0.9) +
      0.6 * Math.sin(p.y * k * 2.1 - time * 1.4 + p.x * k * 0.7);
    const fy = Math.cos(p.x * k * 1.3 + time * 0.7);
    p.vx = p.vx * drag + fx * p.turb * dt;
    p.vy = p.vy * drag + (fy * p.turb * 0.4 - p.rise) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    smokeParts[n++] = p;
  }
  smokeParts.length = n;
}

// Stamps every particle of one kind into `g`, whose pixels are `scale` canvas
// pixels each.
function stampSmoke(g, scale, fine) {
  for (const p of smokeParts) {
    if (p.fine !== fine) continue;
    const u = p.age / p.life;
    // Quick fade in, long fade out. `grow` shapes the swell: below 1 billows
    // out at once like a breath, above 1 stays a thin thread before opening.
    const a = p.alpha * Math.min(1, u * 9) * (1 - u) * (1 - u);
    if (a < 0.004) continue;
    const r = (p.r0 + (p.r1 - p.r0) * Math.pow(u, p.grow)) * scale;
    const c = Math.cos(p.rot) * r, s = Math.sin(p.rot) * r;
    g.globalAlpha = a;
    g.setTransform(c, s, -s, c, p.x * scale, p.y * scale);
    g.drawImage(smokeSprites[p.sprite], -1, -1, 2, 2);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
}

function drawSmoke() {
  if (!smokeParts.length) return;
  // The breath is big, soft and heavily overdrawn, so it goes through a
  // quarter-res layer: a sixteenth of the fill, and the upscale is free blur.
  const w = Math.max(2, Math.round(canvas.width * SMOKE_RES));
  const h = Math.max(2, Math.round(canvas.height * SMOKE_RES));
  const g = sizeScratch(sSmoke, w, h);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  stampSmoke(g, SMOKE_RES, false);
  ctx.drawImage(sSmoke.c, 0, 0, canvas.width, canvas.height);
  // The thread off the tip is only a few pixels wide; at quarter-res it
  // turns into visible blocks, so it is stamped straight onto the canvas.
  ctx.save();
  stampSmoke(ctx, 1, true);
  ctx.restore();
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

// ---------------------------------------------------------------------------
// Rainbow — open your mouth and a rainbow pours out
//
// The stream is a chain of cross-sections ("slices"). Each one is launched
// from the mouth, then falls on its own, so the ribbon is simply wherever the
// slices have got to: swing your head and it whips, shut your mouth and the
// tail detaches and drops away.
// ---------------------------------------------------------------------------

function resetRainbow() {
  rainbow.slices.length = 0;
  rainbow.stars.length = 0;
  rainbow.lastT = 0;
  rainbow.flowing = false;
}

function stepRainbow(dt) {
  const sl = rainbow.slices;
  for (const s of sl) {
    s.age += dt;
    s.vx *= Math.exp(-1.2 * dt);
    s.vy = Math.min(s.vmax, s.vy + s.g * dt);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
  // Only ever drop from the old end, so a run never loses a middle slice and
  // jumps. The slice behind inherits the break and becomes the run's head.
  while (sl.length && (sl[0].y - sl[0].w > canvas.height || sl[0].age > 6)) {
    sl.shift();
    if (sl.length) sl[0].brk = true;
  }

  let n = 0;
  for (const p of rainbow.stars) {
    p.age += dt;
    if (p.age >= p.life) continue;
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    rainbow.stars[n++] = p;
  }
  rainbow.stars.length = n;
}

function emitRainbow(dt, time) {
  const flowing = mouth.seen && mouth.latched;
  if (flowing && dt > 0) {
    // The head's own motion carries into the stream, which is what lets you
    // fling it around. Smoothed, because the mouth only moves on video frames
    // and would otherwise read as stop-go.
    const u = mouth.w;
    if (rainbow.flowing) {
      const lim = u * 10;
      rainbow.vx += (clamp((mouth.x - rainbow.px) / dt, -lim, lim) - rainbow.vx) * 0.3;
      rainbow.vy += (clamp((mouth.y - rainbow.py) / dt, -lim, lim) - rainbow.vy) * 0.3;
    } else {
      rainbow.vx = rainbow.vy = 0;
    }
    const sp = u * RB_SPEED;
    rainbow.slices.push({
      x: mouth.x, y: mouth.y,
      vx: Math.cos(mouth.dir) * sp + rainbow.vx * 0.6,
      vy: Math.sin(mouth.dir) * sp + rainbow.vy * 0.6,
      w: mouth.iw * RB_WIDTH, g: u * RB_GRAVITY, vmax: u * RB_MAX_SPEED,
      age: 0, born: time,
      brk: !rainbow.flowing,        // first slice of a new run: the stream's head
    });

    rainbow.starAcc += RB_STAR_RATE * dt;
    while (rainbow.starAcc >= 1) {
      rainbow.starAcc--;
      const sl = rainbow.slices;
      const s = sl[sl.length - 1 - ((Math.random() * Math.min(sl.length, 40)) | 0)];
      const side = Math.random() < 0.5 ? -1 : 1;
      rainbow.stars.push({
        x: s.x + side * s.w * 0.5, y: s.y,
        vx: side * u * (0.6 + Math.random() * 1.6), vy: -u * Math.random() * 1.5,
        g: u * 4, r: u * (0.10 + Math.random() * 0.18),
        age: 0, life: 0.5 + Math.random() * 0.6, spin: Math.random() * Math.PI,
      });
    }
  }
  rainbow.px = mouth.x;
  rainbow.py = mouth.y;
  rainbow.flowing = flowing;
}

// One run of slices [i, j) as coloured bands. `attached` means its newest end
// is still in the mouth, so that end gets no rounded cap.
function drawRainbowRun(sl, i, j, attached) {
  const n = j - i;
  const cx = new Array(n), cy = new Array(n), ax = new Array(n), ay = new Array(n);
  const ww = new Array(n);
  for (let k = 0; k < n; k++) {
    const s = sl[i + k];
    // Direction of flow, from the slices either side: newer -> older. Two
    // apart, since adjacent ones sit a few pixels from each other and their
    // difference is mostly tracking jitter.
    const newer = sl[Math.min(j - 1, i + k + 2)], older = sl[Math.max(i, i + k - 2)];
    let tx = older.x - newer.x, ty = older.y - newer.y;
    let tl = Math.hypot(tx, ty);
    if (tl < 1) { tx = s.vx; ty = s.vy; tl = Math.hypot(tx, ty) || 1; }
    ax[k] = ty / tl;
    ay[k] = -tx / tl;
    // The wiggle is keyed to when the slice was born, so it is fixed in the
    // material and travels down with it; it fades in, leaving the mouth end
    // pinned exactly to the lips.
    const wob = Math.sin(s.born * 9) * RB_WOBBLE * s.w * Math.min(1, s.age * 1.6);
    cx[k] = s.x + ax[k] * wob;
    cy[k] = s.y + ay[k] * wob;
    // It fans out as it falls and pulses a little; both start from zero so
    // the mouth end stays exactly as wide as the fill inside the mouth.
    const out = Math.min(1, s.age * 1.8);
    ww[k] = s.w * (1 + RB_FLARE * out + 0.06 * out * Math.sin(s.born * 13));
  }
  if (attached) {
    // Square the mouth end to the lip line so it meets the fill inside the
    // mouth band for band.
    ax[n - 1] = Math.sin(mouth.dir);
    ay[n - 1] = -Math.cos(mouth.dir);
  }

  const N = RAINBOW.length;
  // A band between two fractions of the width (-0.5 .. 0.5), plus round caps
  // on the free ends, so the head of the stream is a row of drips.
  const band = (f0, f1, fill, caps) => {
    ctx.fillStyle = fill;
    if (n > 1) {
      ctx.beginPath();
      for (let k = 0; k < n; k++) ctx.lineTo(cx[k] + ax[k] * ww[k] * f0, cy[k] + ay[k] * ww[k] * f0);
      for (let k = n - 1; k >= 0; k--) ctx.lineTo(cx[k] + ax[k] * ww[k] * f1, cy[k] + ay[k] * ww[k] * f1);
      ctx.closePath();
      ctx.fill();
    }
    if (!caps) return;
    const fm = (f0 + f1) / 2;
    for (const k of attached ? [0] : [0, n - 1]) {
      ctx.beginPath();
      ctx.arc(cx[k] + ax[k] * ww[k] * fm, cy[k] + ay[k] * ww[k] * fm,
              ww[k] * (f1 - f0) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  // Each band overlaps the next by a hair, or antialiasing leaves a seam of
  // camera showing between them.
  for (let b = 0; b < N; b++) band(b / N - 0.5, (b + 1) / N - 0.5 + (b < N - 1 ? 0.012 : 0), RAINBOW[b], true);
  // Gloss and a shaded edge: the difference between a flag and a liquid.
  band(-0.38, -0.29, "rgba(255,255,255,0.30)", false);
  band(0.36, 0.5, "rgba(20,0,60,0.13)", false);
}

// The open mouth itself, filled with the same bands, darkening toward the
// upper lip so the stream looks like it comes up from the throat.
function drawRainbowMouth() {
  const poly = mouth.poly;
  const dx = Math.cos(mouth.dir), dy = Math.sin(mouth.dir);
  ctx.save();
  ctx.beginPath();
  for (const p of poly) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.clip();
  // Local frame: x across the lips, y down the face, origin mid-mouth.
  ctx.transform(dy, -dx, dx, dy, mouth.x, mouth.y);
  const N = RAINBOW.length, W = mouth.iw * RB_WIDTH, bw = W / N, H = mouth.gap + 4;
  for (let b = 0; b < N; b++) {
    // The outer bands run on to the corners of the mouth.
    const x0 = b === 0 ? -W * 2 : -W / 2 + b * bw;
    const x1 = b === N - 1 ? W * 2 : -W / 2 + (b + 1) * bw + 1;
    ctx.fillStyle = RAINBOW[b];
    ctx.fillRect(x0, -H, x1 - x0, H * 2);
  }
  const depth = ctx.createLinearGradient(0, -mouth.gap / 2, 0, mouth.gap * 0.15);
  depth.addColorStop(0, "rgba(25,0,30,0.75)");
  depth.addColorStop(1, "rgba(25,0,30,0)");
  ctx.fillStyle = depth;
  ctx.fillRect(-W * 2, -H, W * 4, H * 2);
  ctx.restore();
}

function drawRainbowStars() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "#fffbe0";
  for (const p of rainbow.stars) {
    const u = p.age / p.life;
    // Pop in, twinkle, shrink away.
    const r = p.r * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (0.75 + 0.25 * Math.sin(p.age * 30));
    if (r < 0.5) continue;
    ctx.globalAlpha = 1 - u * u;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = p.spin + k * Math.PI / 4;
      const rr = k % 2 ? r * 0.28 : r;
      ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Called once per rendered frame, after the camera is on the canvas.
function renderRainbow(t) {
  const dt = rainbow.lastT ? Math.min(0.05, (t - rainbow.lastT) / 1000) : 0;
  rainbow.lastT = t;
  stepRainbow(dt);
  emitRainbow(dt, t / 1000);

  const flowing = rainbow.flowing;
  if (flowing && mouth.poly) drawRainbowMouth();
  const sl = rainbow.slices;
  for (let i = 0; i < sl.length;) {
    let j = i + 1;
    while (j < sl.length && !sl[j].brk) j++;
    drawRainbowRun(sl, i, j, flowing && j === sl.length);
    i = j;
  }
  drawRainbowStars();
}

// ---------------------------------------------------------------------------
// Gesture gags — Finger Guns, Snap, Kamehameha, Web, Laser Eyes
//
// Frame-less, like Smoke: each one is a pose that arms it plus a motion that
// fires it. They share the hand helpers below, Smoke's particle system for
// anything that smokes, one pool of sparks and one screen shake. Each is an
// entry in GAGS (State section): hands/face update, render, reset, demo and
// a manual trigger on `f`.
// ---------------------------------------------------------------------------

const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

// Every tracked hand as screen points, its landmarks (metric when the tracker
// gives them), pixels per metre, palm length in landmark units, and a key that
// stays with the same hand from one frame to the next.
function trackedHands(res, t) {
  const out = [], seen = new Set();
  const lms = res.landmarks || [];
  for (let i = 0; i < lms.length; i++) {
    const world = res.worldLandmarks && res.worldLandmarks[i];
    const label = res.handedness && res.handedness[i] && res.handedness[i][0];
    let key = label ? label.categoryName : "H";
    if (seen.has(key)) key += i;
    seen.add(key);
    const pts = smoothPoints(key, lms[i].map(toScreen), t);
    const w = world || lms[i];
    out.push({ pts, w, key, metric: !!world, scale: handPxPerMetre(pts, world),
               palm: d3(w[WRIST], w[MIDDLE_MCP]) || 1 });
  }
  return out;
}

// One-Euro filter (Casiez et al., CHI 2012) over a set of screen points: a
// low-pass whose cutoff rises with speed. A hand held still stops trembling
// with the tracker's pixel noise, and a fast one still keeps up, where a
// fixed smoothing would have to pick one or the other. Speed is in screen
// heights per second, so the feel is the same at any resolution. A set not
// seen for a moment starts fresh rather than gliding in from where it was.
const OE_MIN_CUTOFF = 1.6;       // Hz with the hand at rest
const OE_BETA = 6;               // extra Hz per screen height per second
const OE_D_CUTOFF = 1.2;         // Hz, for the speed estimate itself
const oneEuro = new Map();

const oeAlpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

function smoothPoints(key, pts, t) {
  const now = (t || 0) / 1000;
  let st = oneEuro.get(key);
  if (!st || st.p.length !== pts.length || now - st.t > 0.3 || now <= st.t) {
    st = { t: now, p: pts.map((p) => ({ x: p.x, y: p.y, vx: 0, vy: 0 })) };
    oneEuro.set(key, st);
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }
  const dt = now - st.t, H = canvas.height || 1, ad = oeAlpha(OE_D_CUTOFF, dt);
  st.t = now;
  return pts.map((p, i) => {
    const f = st.p[i];
    f.vx += ((p.x - f.x) / dt - f.vx) * ad;
    f.vy += ((p.y - f.y) / dt - f.vy) * ad;
    const a = oeAlpha(OE_MIN_CUTOFF + OE_BETA * Math.hypot(f.vx, f.vy) / H, dt);
    f.x += (p.x - f.x) * a;
    f.y += (p.y - f.y) * a;
    return { x: f.x, y: f.y };
  });
}

// Light a bright thing throws onto the room: a wide, faint radial falloff in
// "screen" mode, so props sit in the scene rather than pasted on top of it.
function spill(x, y, r, rgb, a) {
  if (a <= 0.004 || r < 1) return;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.3, `rgba(${rgb},${a * 0.4})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

const fingerUp = (w, mcp, latched) =>
  fingerStraightness(w, mcp) > (latched ? POSE_UP_OFF : POSE_UP_ON);
const fingerDown = (w, mcp, latched) =>
  fingerStraightness(w, mcp) < (latched ? POSE_DOWN_OFF : POSE_DOWN_ON);

// Seconds since the last rendered frame. Only one gag runs at a time, so they
// share the clock; every reset zeroes it.
function gagClock(t) {
  const dt = gagLastT ? Math.min(0.05, (t - gagLastT) / 1000) : 0;
  gagLastT = t;
  return dt;
}

// Distance along unit (dx, dy) from (x, y) to the edge of the canvas.
function rayToEdge(x, y, dx, dy) {
  let k = Infinity;
  if (dx > 1e-6) k = Math.min(k, (canvas.width - x) / dx);
  if (dx < -1e-6) k = Math.min(k, -x / dx);
  if (dy > 1e-6) k = Math.min(k, (canvas.height - y) / dy);
  if (dy < -1e-6) k = Math.min(k, -y / dy);
  return Number.isFinite(k) ? Math.max(0, k) : 0;
}

const smoothstep = (a, b, v) => { const k = clamp01((v - a) / (b - a)); return k * k * (3 - 2 * k); };
// Line widths and the like, in canvas pixels per 900px of screen height.
const unit = () => canvas.height / 900;

// --- Shared sparks ----------------------------------------------------------

function addSpark(x, y, ang, sp, life, g, color) {
  if (gagSparks.length > 600) return;
  gagSparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g, life, age: 0, color });
}

function stepSparks(dt) {
  let n = 0;
  for (const p of gagSparks) {
    p.age += dt;
    if (p.age >= p.life) continue;
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    gagSparks[n++] = p;
  }
  gagSparks.length = n;
}

function drawSparks() {
  if (!gagSparks.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, 2 * unit());
  for (const p of gagSparks) {
    ctx.globalAlpha = 1 - p.age / p.life;
    ctx.strokeStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
    ctx.stroke();
  }
  ctx.restore();
}

// Steps a list of things that only age, dropping the expired ones.
function ageOut(list, dt, life) {
  let n = 0;
  for (const p of list) {
    p.age += dt;
    if (p.age < (p.life || life)) list[n++] = p;
  }
  list.length = n;
}

// ===========================================================================
// Finger Guns — 👉 thumb up, drop the thumb (or flick the wrist) to fire
// ===========================================================================

// Index out, the other three curled. The thumb is the hammer, so it is read
// on its own rather than as part of the pose.
function isGunPose(w, latched) {
  return fingerUp(w, INDEX_MCP, latched) && fingerDown(w, MIDDLE_MCP, latched) &&
         fingerDown(w, RING_MCP, latched) && fingerDown(w, PINKY_MCP, latched);
}

// Thumb tip to the index finger's first bone, in palm lengths: high with the
// thumb cocked up, low with it dropped against the side of the hand.
function hammerReach(w, palm) {
  const a = w[INDEX_MCP], b = w[INDEX_MCP + 1], p = w[THUMB_TIP];
  const az = a.z || 0, vx = b.x - a.x, vy = b.y - a.y, vz = (b.z || 0) - az;
  const k = clamp01(((p.x - a.x) * vx + (p.y - a.y) * vy + ((p.z || 0) - az) * vz) /
                    (vx * vx + vy * vy + vz * vz || 1));
  return Math.hypot(p.x - a.x - vx * k, p.y - a.y - vy * k, (p.z || 0) - az - vz * k) / palm;
}

function updateGuns(res, t) {
  const now = t / 1000;
  const live = new Set();
  for (const h of trackedHands(res, t)) {
    let g = guns.get(h.key);
    if (!isGunPose(h.w, !!(g && g.on))) continue;
    if (!g) {
      g = { on: false, cocked: false, last: -1, lift: null, liftT: 0,
            x: 0, y: 0, ang: 0, scale: 1, atCam: false, flash: 0, smoke: 0, smokeAcc: 0 };
      guns.set(h.key, g);
    }
    live.add(h.key);
    const p = h.pts;
    g.on = true;
    g.scale = h.scale;
    g.x = p[INDEX_TIP].x;
    g.y = p[INDEX_TIP].y;
    // Aimed at the camera the finger foreshortens to a stub and its 2D angle
    // is noise, so that shot goes into the glass right at the muzzle.
    const bx = p[INDEX_TIP].x - p[INDEX_MCP].x, by = p[INDEX_TIP].y - p[INDEX_MCP].y;
    g.atCam = Math.hypot(bx, by) < h.scale * 0.03;
    if (!g.atCam) g.ang = Math.atan2(by, bx);

    let fire = false;
    // Trigger one: the thumb drops onto the hand.
    const reach = hammerReach(h.w, h.palm);
    if (reach > GUN_COCK) g.cocked = true;
    else if (g.cocked && reach < GUN_HAMMER) { g.cocked = false; fire = true; }
    // Trigger two: the recoil flick, the fingertip jerking up off its knuckle.
    const palmPx = dist(p[WRIST], p[MIDDLE_MCP]) || 1;
    const lift = (p[INDEX_MCP].y - p[INDEX_TIP].y) / palmPx;
    if (g.lift !== null && (lift - g.lift) / Math.max(1e-3, now - g.liftT) > GUN_FLICK) fire = true;
    g.lift = lift;
    g.liftT = now;

    if (fire && now - g.last > GUN_COOLDOWN_S) {
      g.last = now;
      fireGun(g);
    }
  }
  for (const [k, g] of guns) {
    if (!live.has(k)) { g.on = false; g.lift = null; g.cocked = false; }
  }
}

function fireGun(g) {
  const dx = Math.cos(g.ang), dy = Math.sin(g.ang);
  const s = g.scale;
  const mx = g.x + (g.atCam ? 0 : dx * s * 0.012), my = g.y + (g.atCam ? 0 : dy * s * 0.012);
  g.flash = GUN_FLASH_S;
  g.smoke = 1;
  if (g.atCam) {
    // Straight at the viewer: the round stars the glass over the muzzle.
    gunFx.holes.push(makeBulletHole(mx, my, s * 1.6));
  } else {
    const reach = rayToEdge(mx, my, dx, dy);
    gunFx.tracers.push({ x: mx, y: my, dx, dy, len: reach, w: s * 0.004, age: 0 });
    // The round hits the glass somewhere down the line.
    if (reach > s * 0.06) {
      const k = reach * (0.45 + Math.random() * 0.4);
      gunFx.holes.push(makeBulletHole(mx + dx * k, my + dy * k, s));
    }
  }
  while (gunFx.holes.length > GUN_HOLES_MAX) gunFx.holes.shift();
  gunFx.pops.push({
    x: mx - dy * s * 0.04 * (dx < 0 ? -1 : 1), y: my - s * 0.045,
    word: GUN_WORDS[(Math.random() * GUN_WORDS.length) | 0],
    size: s * 0.045, rot: (Math.random() - 0.5) * 0.5, age: 0,
  });
  for (let i = 0; i < 12; i++) {
    const a = g.atCam ? Math.random() * Math.PI * 2 : g.ang + (Math.random() - 0.5) * 0.9;
    addSpark(mx, my, a, s * (0.4 + Math.random() * 0.8), 0.08 + Math.random() * 0.14,
             s * 0.5, "#ffd27a");
  }
  shake = Math.max(shake, s * 0.006);
  // A brass casing kicked out of the top of the hand, back over the knuckles.
  if (!g.atCam) {
    const up = dx < 0 ? 1 : -1;               // whichever perpendicular points up
    const px = -dy * up, py = dx * up;
    gunFx.casings.push({
      x: g.x - dx * s * 0.07, y: g.y - dy * s * 0.07,
      vx: (px * 0.9 - dx * 0.5) * s * (0.5 + Math.random() * 0.3),
      vy: (py * 0.9 - dy * 0.5) * s * (0.5 + Math.random() * 0.3) - s * 0.25,
      rot: g.ang, spin: (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 10),
      s, age: 0,
    });
    while (gunFx.casings.length > 12) gunFx.casings.shift();
  }
}

function stepCasings(dt) {
  for (const c of gunFx.casings) {
    c.age += dt;
    c.vy += c.s * 2.4 * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.spin * dt;
  }
  ageOut(gunFx.casings, 0, GUN_CASING_S);
}

function drawCasings() {
  for (const c of gunFx.casings) {
    const L = c.s * 0.016, W = c.s * 0.0065;
    ctx.save();
    ctx.globalAlpha = 1 - smoothstep(GUN_CASING_S - 0.3, GUN_CASING_S, c.age);
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    const g = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
    g.addColorStop(0, "#fff2b8");
    g.addColorStop(0.35, "#e0a83a");
    g.addColorStop(1, "#7a4f10");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.3);
    ctx.fill();
    ctx.fillStyle = "#3a2508";
    ctx.fillRect(-L / 2, -W / 2, L * 0.12, W);
    ctx.restore();
  }
}

// A star in the glass: a dark core, a chipped rim and jagged radial cracks
// joined here and there by a ring of short cross-cracks.
function makeBulletHole(x, y, s) {
  const R = Math.max(canvas.height * 0.008, s * 0.006);
  const n = 7 + ((Math.random() * 5) | 0);
  const cracks = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const len = R * (3 + Math.random() * 5);
    const pts = [];
    let a = a0;
    for (let k = 0; k <= 4; k++) {
      const r = R * 0.9 + (len - R * 0.9) * (k / 4);
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      a += (Math.random() - 0.5) * 0.35;
    }
    cracks.push(pts);
  }
  const ring = [];
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.35) continue;
    const j = (i + 1) % n, k = 1 + ((Math.random() * 2) | 0);
    ring.push([cracks[i][k], cracks[j][k]]);
  }
  return { x, y, R, cracks, ring, age: 0, rot: Math.random() * Math.PI };
}

function drawBulletHoles() {
  const u = unit();
  for (const h of gunFx.holes) {
    const a = 1 - smoothstep(GUN_HOLE_S - 1, GUN_HOLE_S, h.age);
    if (a <= 0) continue;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    ctx.globalAlpha = a;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Each crack twice: a dark line under a bright one, so it reads on both
    // a light wall and a dark shirt.
    for (const [style, lw, off] of [["rgba(0,0,0,0.45)", 2.4 * u, u], ["rgba(255,255,255,0.85)", 1.1 * u, 0]]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const c of h.cracks) {
        ctx.moveTo(c[0].x + off, c[0].y + off);
        for (let k = 1; k < c.length; k++) ctx.lineTo(c[k].x + off, c[k].y + off);
      }
      for (const [p, q] of h.ring) {
        ctx.moveTo(p.x + off, p.y + off);
        ctx.lineTo(q.x + off, q.y + off);
      }
      ctx.stroke();
    }
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, h.R * 1.25);
    core.addColorStop(0, "rgba(5,5,8,0.95)");
    core.addColorStop(0.65, "rgba(30,30,36,0.85)");
    core.addColorStop(1, "rgba(220,225,235,0.55)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, h.R * 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function emitGunSmoke(g) {
  const s = g.scale;
  emitSmoke({
    x: g.x + (Math.random() - 0.5) * s * 0.006, y: g.y + (Math.random() - 0.5) * s * 0.006,
    vx: Math.cos(g.ang) * s * 0.04 + (Math.random() - 0.5) * s * 0.02, vy: -s * (0.04 + Math.random() * 0.04),
    r0: s * 0.004, r1: s * (0.018 + Math.random() * 0.016), grow: 1.1, fine: true,
    life: 1.3 + Math.random() * 0.9, alpha: 0.22 + Math.random() * 0.1,
    rise: s * 0.13, drag: 0.8, turb: s * 0.12,
  });
}

function drawMuzzleFlash(g, t) {
  const k = g.flash / GUN_FLASH_S;
  const s = g.scale, L = s * (g.atCam ? 0.05 : 0.07) * (0.7 + 0.3 * k), W = s * 0.03;
  spill(g.x, g.y, s * 0.45, "255,190,110", 0.5 * k);
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(g.atCam ? t * 0.01 : g.ang);
  ctx.globalCompositeOperation = "lighter";
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, L * 1.4);
  glow.addColorStop(0, `rgba(255,230,160,${0.7 * k})`);
  glow.addColorStop(1, "rgba(255,120,20,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-L * 1.4, -L * 1.4, L * 2.8, L * 2.8);
  // A spiky star stretched out along the barrel.
  for (const [sc, col] of [[1, "rgba(255,150,40,0.9)"], [0.55, "rgba(255,250,220,1)"]]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = (i % 2 ? 0.25 : 1) * sc;
      const stretch = g.atCam ? 1 : 0.35 + 0.65 * Math.max(0, Math.cos(a));
      ctx.lineTo(Math.cos(a) * L * r * stretch, Math.sin(a) * W * r * (g.atCam ? L / W : 1));
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawTracers() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const tr of gunFx.tracers) {
    const k = tr.age / GUN_TRACER_S;
    const head = Math.min(1, k * 1.6) * tr.len, tail = Math.max(0, k * 1.6 - 0.45) * tr.len;
    if (head <= tail) continue;
    const grad = ctx.createLinearGradient(tr.x + tr.dx * tail, tr.y + tr.dy * tail,
                                          tr.x + tr.dx * head, tr.y + tr.dy * head);
    grad.addColorStop(0, "rgba(255,200,90,0)");
    grad.addColorStop(1, "rgba(255,250,220,0.95)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2, tr.w);
    ctx.beginPath();
    ctx.moveTo(tr.x + tr.dx * tail, tr.y + tr.dy * tail);
    ctx.lineTo(tr.x + tr.dx * head, tr.y + tr.dy * head);
    ctx.stroke();
  }
  ctx.restore();
}

// Comic-book sound effects: they pop in oversized, settle, then float away.
function drawPops() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const p of gunFx.pops) {
    const u = p.age / GUN_POP_S;
    const sc = u < 0.15 ? 0.4 + u / 0.15 * 0.9 : 1.3 - 0.3 * smoothstep(0.15, 0.4, u);
    ctx.globalAlpha = 1 - smoothstep(0.6, 1, u);
    ctx.setTransform(1, 0, 0, 1, p.x, p.y - u * p.size * 1.2);
    ctx.rotate(p.rot);
    ctx.scale(sc, sc);
    ctx.font = `900 ${Math.round(p.size)}px Impact, "Arial Black", system-ui, sans-serif`;
    ctx.lineWidth = p.size * 0.18;
    ctx.strokeStyle = "#7a0c0c";
    ctx.strokeText(p.word, 0, 0);
    ctx.fillStyle = "#ffd93b";
    ctx.fillText(p.word, 0, 0);
  }
  ctx.restore();
}

function renderGuns(t) {
  const dt = gagClock(t);
  for (const g of guns.values()) {
    g.flash = Math.max(0, g.flash - dt);
    if (g.smoke > 0) {
      g.smokeAcc += 55 * g.smoke * dt;
      while (g.smokeAcc >= 1) { g.smokeAcc--; emitGunSmoke(g); }
      g.smoke = Math.max(0, g.smoke - dt * 0.8);
    }
  }
  ageOut(gunFx.tracers, dt, GUN_TRACER_S);
  ageOut(gunFx.holes, dt, GUN_HOLE_S);
  ageOut(gunFx.pops, dt, GUN_POP_S);
  stepCasings(dt);
  stepSparks(dt);
  stepSmoke(dt, t / 1000);

  drawBulletHoles();
  drawSmoke();
  drawCasings();
  drawTracers();
  for (const g of guns.values()) if (g.flash > 0) drawMuzzleFlash(g, t);
  drawSparks();
  drawPops();
}

function resetGuns() {
  guns.clear();
  gunFx.tracers.length = 0;
  gunFx.holes.length = 0;
  gunFx.pops.length = 0;
  gunFx.casings.length = 0;
}

// `f`: every gun in view fires; with none up, one off-screen right takes a shot.
function triggerGuns() {
  let any = false;
  for (const g of guns.values()) if (g.on) { fireGun(g); any = true; }
  if (any) return;
  const s = canvas.height / 0.55;
  fireGun({ x: canvas.width * 0.85, y: canvas.height * 0.7, ang: Math.PI * 1.08, scale: s,
            atCam: false, flash: 0, smoke: 0, smokeAcc: 0 });
}

// ===========================================================================
// Snap — 🫰 thumb + middle finger, and half of you turns to dust
// ===========================================================================

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

function maskAvailable() {
  return maskReady && maskImageData && maskCanvas.width > 1;
}

function doSnap(x, y, scale) {
  snap.rings.push({ x, y, s: scale, age: 0 });
  for (let i = 0; i < 26; i++) {
    addSpark(x, y, Math.random() * Math.PI * 2, scale * (0.3 + Math.random() * 0.7),
             0.2 + Math.random() * 0.35, scale * 0.6, i % 3 ? "#ffe9a8" : "#ffffff");
  }
  shake = Math.max(shake, scale * 0.004);
  if (snap.phase === "idle") {
    snap.phase = "snapped";
    snap.t = 0;
    if (!maskAvailable()) flashStatus("Snap needs the person mask — still loading", 2500);
  } else if (snap.phase === "dusting" || snap.phase === "gone") {
    // Snap again to undo it.
    snap.phase = "returning";
    snap.t = 0;
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

// Draws a mask-space canvas onto `g` in canvas space, the way the feed is
// drawn: covered, centred and mirrored.
// `k` scales the result, for a target smaller than the canvas.
function drawMaskSpace(g, src, blurPx, k = 1) {
  g.save();
  if (blurPx) g.filter = `blur(${blurPx}px)`;
  g.setTransform(-fit.s * fit.vw / src.width * k, 0, 0, fit.s * fit.vh / src.height * k,
                 (fit.ox + fit.s * fit.vw) * k, fit.oy * k);
  g.drawImage(src, 0, 0);
  g.restore();
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
  }
  if (snap.phase === "dusting") {
    snap.prog = Math.min(1, snap.t / DUST_S);
    if (snap.t >= DUST_S) { snap.phase = "gone"; snap.t = 0; }
  } else if (snap.phase === "gone") {
    snap.prog = 1;
    if (snap.t >= DUST_HOLD_S) { snap.phase = "returning"; snap.t = 0; }
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

// ===========================================================================
// Kamehameha — cup both hands to charge, shove them to fire
// ===========================================================================

const palmCentre = (p) => ({
  x: (p[WRIST].x + p[INDEX_MCP].x + p[MIDDLE_MCP].x + p[PINKY_MCP].x) / 4,
  y: (p[WRIST].y + p[INDEX_MCP].y + p[MIDDLE_MCP].y + p[PINKY_MCP].y) / 4,
});

function updateKame(res, t) {
  const hands = trackedHands(res, t);
  if (hands.length < 2) { kameTrack(null, t); return; }
  const [a, b] = hands;
  kameTrack({
    a: palmCentre(a.pts), b: palmCentre(b.pts),
    palm: (dist(a.pts[WRIST], a.pts[MIDDLE_MCP]) + dist(b.pts[WRIST], b.pts[MIDDLE_MCP])) / 2,
  }, t);
}

// `m` is both palm centres and the palm length in pixels, or null.
function kameTrack(m, t) {
  const now = t / 1000;
  if (!m || m.palm < 1) {
    if (++kame.lost > KAME_LOST_FRAMES) { kame.on = false; kame.hist.length = 0; }
    return;
  }
  const gap = dist(m.a, m.b) / m.palm;
  const x = (m.a.x + m.b.x) / 2, y = (m.a.y + m.b.y) / 2;
  const together = gap < KAME_TOGETHER * (kame.on ? 1.3 : 1);
  if (together || kame.beam) {
    // The beam stays rooted in your hands even once they part.
    const jump = Math.hypot(x - kame.x, y - kame.y) > m.palm * 2;
    const k = kame.on && !jump ? 0.55 : 1;
    kame.x += (x - kame.x) * k;
    kame.y += (y - kame.y) * k;
    kame.palm += (m.palm - kame.palm) * (kame.on ? 0.3 : 1);
  }
  if (together) { kame.on = true; kame.lost = 0; }
  else if (++kame.lost > KAME_LOST_FRAMES) kame.on = false;

  // Thrust: over the last quarter second, the hands either shoved sideways
  // (a beam that way) or grew fast, which is a shove at the camera.
  const hist = kame.hist;
  hist.push({ t: now, x, y, palm: m.palm });
  while (hist.length && now - hist[0].t > 0.25) hist.shift();
  if (kame.charge >= KAME_MIN_S && !kame.beam && hist.length >= 3) {
    const h0 = hist[0], span = now - h0.t;
    if (span > 0.06) {
      const vx = (x - h0.x) / span / m.palm, vy = (y - h0.y) / span / m.palm;
      const grow = (m.palm / h0.palm - 1) / span;
      if (grow > KAME_PUSH) fireKame(null);
      else if (Math.hypot(vx, vy) > KAME_THRUST) fireKame(Math.atan2(vy, vx));
    }
  }
}

const kameBallR = () => kame.palm * (0.12 + 0.5 * clamp01(kame.charge / KAME_CHARGE_S));

// `ang` null means straight at the camera.
function fireKame(ang) {
  const power = clamp01(kame.charge / KAME_CHARGE_S);
  kame.beam = { ang, age: 0, power, r: kameBallR(), dur: KAME_BEAM_S * (0.6 + 0.4 * power) };
  kame.charge = 0;
  kame.hist.length = 0;
  shake = Math.max(shake, canvas.height * (ang === null ? 0.03 : 0.015) * (0.5 + power));
}

function drawKameBall(x, y, r, t, k) {
  r *= 1 + 0.06 * Math.sin(t * 0.05) + 0.04 * Math.sin(t * 0.13);
  // It lights your hands and face from below, flickering with the ball.
  spill(x, y, r * 9, "110,175,255", 0.4 * k * (0.9 + 0.1 * Math.sin(t * 0.07)));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3.4);
  halo.addColorStop(0, `rgba(120,200,255,${0.45 * k})`);
  halo.addColorStop(0.4, `rgba(40,110,255,${0.18 * k})`);
  halo.addColorStop(1, "rgba(20,60,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - r * 3.4, y - r * 3.4, r * 6.8, r * 6.8);
  const body = ctx.createRadialGradient(x, y, 0, x, y, r);
  body.addColorStop(0, `rgba(255,255,255,${k})`);
  body.addColorStop(0.45, `rgba(190,240,255,${0.95 * k})`);
  body.addColorStop(0.8, `rgba(70,170,255,${0.6 * k})`);
  body.addColorStop(1, "rgba(40,120,255,0)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Crackling arcs, redrawn at random every frame so they flicker.
  ctx.strokeStyle = `rgba(210,245,255,${0.85 * k})`;
  ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.lineJoin = "round";
  const bolts = 2 + Math.round(4 * k);
  for (let i = 0; i < bolts; i++) {
    let a = Math.random() * Math.PI * 2;
    const reach = r * (1.3 + Math.random() * 1.1);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4);
    for (let s = 1; s <= 6; s++) {
      a += (Math.random() - 0.5) * 0.7;
      const rr = r * 0.4 + (reach - r * 0.4) * (s / 6);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Energy motes spiralling in while it charges, in polar coordinates around
// the ball so they follow it when you move.
function stepMotes(dt, r) {
  if (kame.on && !kame.beam) {
    kame.moteAcc += dt * 40;
    while (kame.moteAcc >= 1) {
      kame.moteAcc--;
      kame.motes.push({ a: Math.random() * Math.PI * 2, rad: r * (2.6 + Math.random() * 1.6), age: 0 });
    }
  }
  let n = 0;
  for (const m of kame.motes) {
    m.age += dt;
    m.rad -= m.rad * 2.6 * dt + r * 0.5 * dt;
    m.a += 3 * dt;
    if (m.rad > r * 0.5 && m.age < 1.5) kame.motes[n++] = m;
  }
  kame.motes.length = n;
}

function drawMotes(r) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "#bff0ff";
  for (const m of kame.motes) {
    ctx.globalAlpha = Math.min(1, m.age * 4);
    ctx.beginPath();
    ctx.arc(kame.x + Math.cos(m.a) * m.rad, kame.y + Math.sin(m.a) * m.rad, Math.max(1.5, r * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawKameBeam(b, t, dt) {
  const env = Math.min(1, b.age / 0.08) * (1 - smoothstep(b.dur - 0.35, b.dur, b.age));
  if (env <= 0) return;
  const R = b.r * (0.75 + 0.45 * b.power) * env;
  const W = canvas.width, H = canvas.height;
  if (b.ang === null) {
    // At the camera: the ball swells until it swallows the screen.
    const grow = smoothstep(0, 0.35, b.age);
    const rad = R + Math.hypot(W, H) * grow;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(kame.x, kame.y, 0, kame.x, kame.y, rad);
    g.addColorStop(0, `rgba(255,255,255,${env})`);
    g.addColorStop(0.35, `rgba(170,235,255,${0.85 * env})`);
    g.addColorStop(0.75, `rgba(60,140,255,${0.5 * env})`);
    g.addColorStop(1, "rgba(30,80,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    drawKameBall(kame.x, kame.y, R * 1.3, t, env);
    return;
  }
  const len = Math.hypot(W, H) * 1.2 * Math.min(1, b.age / 0.15);
  // The beam floods the room blue along its length.
  for (let d = 0; d < Math.min(len, Math.hypot(W, H)); d += H * 0.3) {
    spill(kame.x + Math.cos(b.ang) * d, kame.y + Math.sin(b.ang) * d, R * 6, "90,160,255", 0.22 * env);
  }
  ctx.save();
  ctx.translate(kame.x, kame.y);
  ctx.rotate(b.ang);
  ctx.globalCompositeOperation = "lighter";
  const layers = [[2.2, "rgba(40,110,255,0.22)"], [1.5, "rgba(80,190,255,0.45)"],
                  [1.05, "rgba(170,240,255,0.8)"], [0.5, "rgba(255,255,255,0.95)"]];
  const steps = 48;
  layers.forEach(([w, col], li) => {
    const half = (x, side) => R * w / 2 *
      (1 + 0.09 * Math.sin(x / R * 1.7 - b.age * 38 + li * 1.3 + side));
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) { const x = len * i / steps; ctx.lineTo(x, -half(x, 0)); }
    for (let i = steps; i >= 0; i--) { const x = len * i / steps; ctx.lineTo(x, half(x, 2)); }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, R * w / 2 * 1.15, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
  // Sparks peel off the beam's edges.
  for (let i = 0; i < 120 * dt; i++) {
    const along = Math.random() * Math.min(len, Math.hypot(W, H)) * 0.8;
    const side = Math.random() < 0.5 ? -1 : 1;
    const cx = Math.cos(b.ang), cy = Math.sin(b.ang);
    addSpark(kame.x + cx * along - cy * side * R * 0.6, kame.y + cy * along + cx * side * R * 0.6,
             b.ang + side * (0.6 + Math.random() * 0.8), R * (2 + Math.random() * 4),
             0.15 + Math.random() * 0.2, 0, "#c8f4ff");
  }
  drawKameBall(kame.x, kame.y, R * 0.9, t, env);
}

function renderKame(t) {
  const dt = gagClock(t);
  if (kame.on && !kame.beam) {
    kame.charge = Math.min(KAME_CHARGE_S * 1.2, kame.charge + dt);
  } else if (!kame.beam) {
    kame.charge = Math.max(0, kame.charge - dt * 3);   // hands parted: it fizzles
  }
  const r = kameBallR();
  stepMotes(dt, r);
  stepSparks(dt);
  if (kame.beam) {
    kame.beam.age += dt;
    drawKameBeam(kame.beam, t, dt);
    if (kame.beam.age >= kame.beam.dur) kame.beam = null;
  } else if (kame.charge > 0.02) {
    drawMotes(r);
    drawKameBall(kame.x, kame.y, r, t, Math.min(1, kame.charge * 3));
  }
  drawSparks();
}

function resetKame() {
  kame.on = false;
  kame.lost = 0;
  kame.charge = 0;
  kame.hist.length = 0;
  kame.beam = null;
  kame.motes.length = 0;
}

// `f`: fires whatever is charged (or a full one from mid-screen), to the right.
function triggerKame() {
  if (kame.beam) return;
  if (kame.charge < KAME_MIN_S) {
    if (!kame.on) {
      kame.x = canvas.width * 0.35;
      kame.y = canvas.height * 0.55;
      kame.palm = canvas.height * 0.17;
    }
    kame.charge = KAME_CHARGE_S;
  }
  fireKame(0);
}

// ===========================================================================
// Web — 🤟 thwip: index + pinky up, middle + ring folded
// ===========================================================================

function isThwipPose(w, latched) {
  return fingerUp(w, INDEX_MCP, latched) && fingerUp(w, PINKY_MCP, latched) &&
         fingerDown(w, MIDDLE_MCP, latched) && fingerDown(w, RING_MCP, latched);
}

function updateWebs(res, t) {
  const live = new Set();
  for (const h of trackedHands(res, t)) {
    const st = webs.hands.get(h.key);
    if (!isThwipPose(h.w, !!(st && st.on))) continue;
    const p = h.pts;
    // The shooter is on the wrist; it fires along the back of the hand.
    const o = lerpPt(p[WRIST], p[MIDDLE_MCP], 0.25);
    const dl = dist(p[WRIST], p[MIDDLE_MCP]) || 1;
    webHand(h.key, { x: o.x, y: o.y, dx: (p[MIDDLE_MCP].x - p[WRIST].x) / dl,
                     dy: (p[MIDDLE_MCP].y - p[WRIST].y) / dl, scale: h.scale }, t);
    live.add(h.key);
  }
  for (const k of webs.hands.keys()) if (!live.has(k)) webHand(k, null, t);
}

// One hand's pose this frame (null = not thwipping). The rising edge, held
// for two frames, shoots; while it is held the line stays on the shooter.
function webHand(key, pose, t) {
  let st = webs.hands.get(key);
  if (!st) { st = { on: false, seen: 0, last: -9 }; webs.hands.set(key, st); }
  if (!pose) {
    st.seen = 0;
    if (st.on) {
      st.on = false;
      for (const L of webs.lines) if (L.key === key && L.cut < 0) cutWeb(L);
    }
    return;
  }
  Object.assign(st, pose);
  if (!st.on && ++st.seen >= 2) {
    st.on = true;
    if (t / 1000 - st.last > WEB_COOLDOWN_S) { st.last = t / 1000; shootWeb(key, st); }
  }
  for (const L of webs.lines) if (L.key === key && L.cut < 0) { L.ox = st.x; L.oy = st.y; }
}

function cutWeb(L) {
  L.cut = L.age;
  L.fx = L.ox; L.fy = L.oy;
  L.fvx = 0; L.fvy = 0;
}

function shootWeb(key, st) {
  const reach = rayToEdge(st.x, st.y, st.dx, st.dy);
  const k = Math.max(reach * (0.55 + Math.random() * 0.3), Math.min(reach, canvas.height * 0.25));
  const R = clamp(st.scale * 0.11, canvas.height * 0.07, canvas.height * 0.2);
  // Any earlier line from this hand lets go.
  for (const L of webs.lines) if (L.key === key && L.cut < 0) cutWeb(L);
  webs.lines.push({
    key, ox: st.x, oy: st.y, ax: st.x + st.dx * k, ay: st.y + st.dy * k,
    age: 0, cut: -1, fx: 0, fy: 0, fvx: 0, fvy: 0, R, splat: makeSplat(R),
    rot: Math.random() * Math.PI * 2,
  });
  while (webs.lines.length > WEB_MAX) webs.lines.shift();
}

// Spokes of slightly random angle and length, joined by rings that sag
// toward the middle between each pair of spokes.
function makeSplat(R) {
  const n = 9 + ((Math.random() * 4) | 0);
  const spokes = [];
  for (let i = 0; i < n; i++) {
    spokes.push({ a: (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.35,
                  l: R * (0.75 + Math.random() * 0.45) });
  }
  const rings = [0.2, 0.4, 0.6, 0.8].map((f) => f * (0.92 + Math.random() * 0.16));
  return { spokes, rings };
}

function drawSplat(L, grow, alpha) {
  const { spokes, rings } = L.splat;
  const u = unit();
  ctx.save();
  ctx.translate(L.ax, L.ay);
  ctx.rotate(L.rot);
  ctx.scale(grow, grow);
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  const path = () => {
    ctx.beginPath();
    for (const s of spokes) {
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(s.a) * s.l, Math.sin(s.a) * s.l);
    }
    for (const f of rings) {
      for (let i = 0; i < spokes.length; i++) {
        const s0 = spokes[i], s1 = spokes[(i + 1) % spokes.length];
        const a1 = s1.a + (i === spokes.length - 1 ? Math.PI * 2 : 0);
        const am = (s0.a + a1) / 2, rm = f * (s0.l + s1.l) / 2 * 0.78;
        ctx.moveTo(Math.cos(s0.a) * s0.l * f, Math.sin(s0.a) * s0.l * f);
        ctx.quadraticCurveTo(Math.cos(am) * rm, Math.sin(am) * rm,
                             Math.cos(a1) * s1.l * f, Math.sin(a1) * s1.l * f);
      }
    }
  };
  path();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 3.4 * u / grow;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 1.6 * u / grow;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(0, 0, L.R * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The line: taut and twanging just after it lands, two strands twisted
// together. Cut, its free end drops and the line goes slack and fades.
function drawWebLine(L, alpha) {
  const u = unit();
  let x0 = L.ox, y0 = L.oy, sag = 0;
  if (L.cut >= 0) { x0 = L.fx; y0 = L.fy; sag = Math.min(1, (L.age - L.cut) * 3); }
  const shot = Math.min(1, L.age / WEB_SHOT_S);
  const x1 = x0 + (L.ax - x0) * shot, y1 = y0 + (L.ay - y0) * shot;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
  const twang = len * 0.04 * Math.exp(-Math.max(0, L.age - WEB_SHOT_S) * 7);
  const N = 28;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  for (const [col, lw] of [["rgba(0,0,0,0.3)", 3 * u], ["rgba(255,255,255,0.95)", 1.3 * u]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    for (const strand of [0, Math.PI]) {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const off = Math.sin(Math.PI * s) * (twang * Math.sin(s * Math.PI * 3 - L.age * 40)) +
          Math.sin(s * len / (9 * u) + strand) * 1.4 * u;
        const droop = Math.sin(Math.PI * s) * sag * len * 0.25;
        ctx.lineTo(x0 + (x1 - x0) * s + nx * off, y0 + (y1 - y0) * s + ny * off + droop);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

function renderWebs(t) {
  const dt = gagClock(t);
  const g = canvas.height * 2.5;
  let n = 0;
  for (const L of webs.lines) {
    L.age += dt;
    if (L.cut >= 0) {
      L.fvy += g * dt;
      L.fx += L.fvx * dt;
      L.fy += L.fvy * dt;
    }
    if (L.age < WEB_LIFE_S) webs.lines[n++] = L;
  }
  webs.lines.length = n;
  stepSparks(dt);

  for (const L of webs.lines) {
    if (L.age > WEB_SHOT_S) {
      const k = clamp01((L.age - WEB_SHOT_S) / 0.12);
      const grow = 1 - (1 - k) * (1 - k);
      drawSplat(L, Math.max(0.05, grow), 1 - smoothstep(WEB_LIFE_S - 1, WEB_LIFE_S, L.age));
    }
    const lineA = L.cut < 0 ? 1 : 1 - clamp01((L.age - L.cut) / 0.7);
    if (lineA > 0) drawWebLine(L, lineA);
  }
  drawSparks();
}

function resetWebs() {
  webs.lines.length = 0;
  webs.hands.clear();
}

// `f`: a shot up and across from the bottom of the screen.
function triggerWeb() {
  const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
  shootWeb("key", { x: canvas.width * (0.3 + Math.random() * 0.4), y: canvas.height * 0.98,
                    dx: Math.cos(a), dy: Math.sin(a), scale: canvas.height / 0.55 });
  const L = webs.lines[webs.lines.length - 1];
  setTimeout(() => cutWeb(L), 600);
}

// ===========================================================================
// Laser Eyes — raise your eyebrows; turn your head to aim
// ===========================================================================

function updateLaser(face, t) {
  const f = face && face.faceLandmarks && face.faceLandmarks[0];
  if (!f) {
    if (++laser.lost > 10) { laser.seen = false; laser.latched = false; }
    return;
  }
  // Blendshapes when the model gives them: a brow raise or wide eyes.
  let score = null;
  const bs = face.faceBlendshapes && face.faceBlendshapes[0];
  if (bs && bs.categories) {
    const s = {};
    for (const c of bs.categories) s[c.categoryName] = c.score;
    score = Math.max(s.browInnerUp || 0, ((s.eyeWideLeft || 0) + (s.eyeWideRight || 0)) / 2);
  }
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const iris = f.length > IRIS_L ? [f[IRIS_R], f[IRIS_L]]
                                 : [mid(f[33], f[133]), mid(f[362], f[263])];
  const [e0, e1, nose, cr, cl] = smoothPoints("face",
    [...iris, f[NOSE_TIP], f[FACE_R], f[FACE_L]].map(toScreen), t);
  applyEyes([e0, e1], nose, cr, cl, score);
}

// Screen-space eyes, nose tip and the two sides of the face in; aim out. The
// nose swings toward whichever way the head turns, so its offset from the
// middle of the face, in face widths, is the aim. Across the face that is
// zero when you look straight ahead; down the face it is not (the nose sits
// low), so that axis is measured against a slow running baseline.
function applyEyes(eyes, nose, cr, cl, score) {
  const faceW = Math.max(1, dist(cr, cl));
  const ax = (cl.x - cr.x) / faceW, ay = (cl.y - cr.y) / faceW;
  const px = -ay, py = ax;
  const ox = nose.x - (cr.x + cl.x) / 2, oy = nose.y - (cr.y + cl.y) / 2;
  const u = (ox * ax + oy * ay) / faceW, v = (ox * px + oy * py) / faceW;
  if (!laser.seen) laser.v0 = v;
  else if (!laser.latched) laser.v0 += (v - laser.v0) * 0.004;
  const dv = v - laser.v0;
  const dx = u * ax + dv * px, dy = u * ay + dv * py;
  const k = laser.seen ? 0.35 : 1;
  laser.dx += (dx - laser.dx) * k;
  laser.dy += (dy - laser.dy) * k;
  laser.eyes = eyes;
  laser.faceW = faceW;
  if (score !== null) laser.latched = score > (laser.latched ? LASER_OFF : LASER_ON);
  laser.seen = true;
  laser.lost = 0;
}

function renderLaser(t) {
  const dt = gagClock(t);
  const on = laser.seen && (laser.latched || laser.forced);
  laser.presence += ((on ? 1 : 0) - laser.presence) * (on ? 0.35 : 0.2);
  const W = canvas.width, H = canvas.height;
  const sw = Math.max(1, Math.round(W / 2)), sh = Math.max(1, Math.round(H / 2));
  const burn = sizeScratch(sScorch, sw, sh), glow = sizeScratch(sScorchGlow, sw, sh);
  // Burns linger for seconds; their glow cools in a fraction of one.
  for (const [g, tau] of [[burn, 6], [glow, 0.35]]) {
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = `rgba(0,0,0,${1 - Math.exp(-dt / tau)})`;
    g.fillRect(0, 0, sw, sh);
    g.globalCompositeOperation = "source-over";
  }

  // Last frame's burns go under this frame's beams.
  ctx.drawImage(sScorch.c, 0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(sScorchGlow.c, 0, 0, W, H);
  ctx.restore();

  if (laser.eyes && laser.presence > 0.02) {
    const fw = laser.faceW, p = laser.presence;
    const mag = Math.hypot(laser.dx, laser.dy);
    if (mag > 1e-3) { laser.ux = laser.dx / mag; laser.uy = laser.dy / mag; }
    const ex = (laser.eyes[0].x + laser.eyes[1].x) / 2, ey = (laser.eyes[0].y + laser.eyes[1].y) / 2;
    const reach = clamp01(mag * LASER_GAIN);
    const edge = rayToEdge(ex, ey, laser.ux, laser.uy);
    const L = Math.min(edge, fw * 0.5) + Math.max(0, edge - fw * 0.5) * reach;
    const lineA = smoothstep(0.015, 0.05, mag) * p;
    const hit = { x: ex + laser.ux * L, y: ey + laser.uy * L };

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const flick = 1 + 0.15 * Math.sin(t * 0.07) + 0.1 * Math.sin(t * 0.19);
    // Both beams converge on one point, the way a heat-vision stare does.
    if (lineA > 0.01) {
      for (const [w, col] of [[0.11, `rgba(255,0,0,${0.2 * lineA})`], [0.05, `rgba(255,40,30,${0.65 * lineA})`],
                              [0.017, `rgba(255,235,225,${0.95 * lineA})`]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = fw * w * flick;
        ctx.beginPath();
        for (const e of laser.eyes) { ctx.moveTo(e.x, e.y); ctx.lineTo(hit.x, hit.y); }
        ctx.stroke();
      }
      const hr = fw * 0.3 * flick;
      const hg = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, hr);
      hg.addColorStop(0, `rgba(255,250,220,${lineA})`);
      hg.addColorStop(0.3, `rgba(255,140,40,${0.7 * lineA})`);
      hg.addColorStop(1, "rgba(255,40,0,0)");
      ctx.fillStyle = hg;
      ctx.fillRect(hit.x - hr, hit.y - hr, hr * 2, hr * 2);
    }
    // Red light on the face around the eyes, and on whatever is burning.
    for (const e of laser.eyes) spill(e.x, e.y, fw * 0.55, "255,40,25", 0.3 * p);
    if (lineA > 0.01) spill(hit.x, hit.y, fw * 1.4, "255,120,40", 0.35 * lineA);
    // Each eye: a hot core and an anamorphic streak.
    for (const e of laser.eyes) {
      const r = fw * 0.17 * flick;
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      g.addColorStop(0, `rgba(255,255,255,${p})`);
      g.addColorStop(0.25, `rgba(255,60,40,${0.85 * p})`);
      g.addColorStop(1, "rgba(255,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(e.x - r, e.y - r, r * 2, r * 2);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.scale(1, 0.07);
      const sr = fw * 0.75;
      const s = ctx.createRadialGradient(0, 0, 0, 0, 0, sr);
      s.addColorStop(0, `rgba(255,90,70,${0.6 * p})`);
      s.addColorStop(1, "rgba(255,0,0,0)");
      ctx.fillStyle = s;
      ctx.fillRect(-sr, -sr, sr * 2, sr * 2);
      ctx.restore();
    }
    ctx.restore();

    // Only a beam that is actually reaching out leaves a mark.
    if (lineA > 0.5) {
      const prev = laser.lastHit && Math.hypot(hit.x - laser.lastHit.x, hit.y - laser.lastHit.y) < W * 0.25
        ? laser.lastHit : hit;
      const mark = (g, w, col) => {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(prev.x / 2, prev.y / 2);
        g.lineTo(hit.x / 2 + 0.01, hit.y / 2);
        g.stroke();
      };
      mark(burn, fw * 0.11, "rgba(40,20,10,0.10)");
      mark(burn, fw * 0.05, "rgba(20,8,2,0.35)");
      mark(glow, fw * 0.04, "rgba(255,120,30,0.9)");
      mark(glow, fw * 0.015, "rgba(255,240,190,1)");
      for (let i = 0; i < 300 * dt; i++) {
        const a = Math.atan2(-laser.uy, -laser.ux) + (Math.random() - 0.5) * 2.6;
        addSpark(hit.x, hit.y, a, fw * (1 + Math.random() * 2.5), 0.2 + Math.random() * 0.3,
                 fw * 5, Math.random() < 0.5 ? "#ffb347" : "#ffe9a8");
      }
      laser.smokeAcc += 22 * dt;
      while (laser.smokeAcc >= 1) {
        laser.smokeAcc--;
        emitSmoke({
          x: hit.x, y: hit.y, vx: (Math.random() - 0.5) * fw * 0.4, vy: -fw * (0.2 + Math.random() * 0.4),
          r0: fw * 0.05, r1: fw * (0.4 + Math.random() * 0.4), grow: 0.9,
          life: 1.6 + Math.random() * 1.2, alpha: 0.14 + Math.random() * 0.1,
          rise: fw * 1.2, drag: 1, turb: fw * 0.8,
        });
      }
      laser.lastHit = hit;
    } else {
      laser.lastHit = null;
    }
  } else {
    laser.lastHit = null;
  }

  stepSparks(dt);
  stepSmoke(dt, t / 1000);
  drawSmoke();
  drawSparks();
}

function resetLaser() {
  laser.seen = false;
  laser.latched = false;
  laser.forced = false;
  laser.lost = 0;
  laser.presence = 0;
  laser.eyes = null;
  laser.lastHit = null;
  laser.dx = laser.dy = 0;
  for (const s of [sScorch, sScorchGlow]) s.c.width = s.c.height = 1;
}

// `f`: lasers on or off by hand, for when your eyebrows are tired.
function triggerLaser() {
  laser.forced = !laser.forced;
  flashStatus(laser.forced ? "Lasers locked on 🔴 (f again to release)" : "Lasers back on your eyebrows");
}

// ===========================================================================
// Claws — make a fist: SNIKT. Swing it and they slash the glass
// ===========================================================================

// Every finger curled; the thumb is free, so a fist either way counts.
function isFist(w, latched) {
  return fingerDown(w, INDEX_MCP, latched) && fingerDown(w, MIDDLE_MCP, latched) &&
         fingerDown(w, RING_MCP, latched) && fingerDown(w, PINKY_MCP, latched);
}

function updateClaws(res, t) {
  const live = new Set();
  for (const h of trackedHands(res, t)) {
    const c = claws.get(h.key);
    if (!isFist(h.w, !!(c && c.out))) continue;
    clawPose(h.key, h.pts, h.metric ? h.w : null, h.scale, t);
    live.add(h.key);
  }
  for (const [k, c] of claws) {
    if (!live.has(k) && ++c.lost > CLAW_LOST_FRAMES) { c.out = false; c.trail.length = 0; }
  }
}

// One fist this frame. The three claws come out of the gaps between the
// knuckles and run on, parallel, along the back of the hand. Their
// length is real-world, foreshortened by as much as the hand itself is: a
// fist punched at the camera shows its metacarpals end-on, so do the claws.
function clawPose(key, pts, world, scale, t) {
  let c = claws.get(key);
  if (!c) {
    c = { out: false, ext: 0, lost: 0, roots: [], dirs: [], len: 0, w: 0, scale,
          trail: [], lastSlash: -9, glint: 1 };
    claws.set(key, c);
  }
  const wr = pts[WRIST];
  const mcpPx = dist(wr, pts[MIDDLE_MCP]);
  const mcpM = world ? d3(world[WRIST], world[MIDDLE_MCP]) : 0.09;
  const fore = clamp(mcpPx / (mcpM * scale || 1), 0.15, 1);
  [[INDEX_MCP, MIDDLE_MCP], [MIDDLE_MCP, RING_MCP], [RING_MCP, PINKY_MCP]].forEach(([a, b], i) => {
    c.roots[i] = lerpPt(pts[a], pts[b], 0.5);
  });
  const vx = c.roots[1].x - wr.x, vy = c.roots[1].y - wr.y, vl = Math.hypot(vx, vy) || 1;
  for (let i = 0; i < 3; i++) c.dirs[i] = { x: vx / vl, y: vy / vl };
  c.len = CLAW_LEN_M * scale * fore;
  c.w = CLAW_W_M * scale;
  c.scale = scale;
  c.palmPx = mcpPx || 1;
  c.lost = 0;
  if (!c.out) {
    c.out = true;
    snikt(c);
  }

  // Slash: the middle claw's tip, tracked over a tenth of a second. Fast
  // enough and the three tips' paths are torn into the glass.
  const now = t / 1000;
  const tips = c.roots.map((r, i) => ({ x: r.x + c.dirs[i].x * c.len, y: r.y + c.dirs[i].y * c.len }));
  c.trail.push({ t: now, tips });
  while (c.trail.length > 2 && now - c.trail[0].t > 0.1) c.trail.shift();
  const first = c.trail[0], span = now - first.t;
  if (c.ext > 0.9 && span > 0.02 && now - c.lastSlash > CLAW_SLASH_GAP_S) {
    const speed = dist(first.tips[1], tips[1]) / span / c.palmPx;
    if (speed > SLASH_SPEED) {
      c.lastSlash = now;
      addSlash(first.tips, tips, c.w);
      c.trail = [{ t: now, tips }];
    }
  }
}

function snikt(c) {
  c.glint = 0;
  const r = c.roots[1];
  gunFx.pops.push({ x: r.x, y: r.y - c.scale * 0.08, word: "SNIKT!", size: c.scale * 0.04,
                    rot: (Math.random() - 0.5) * 0.4, age: 0 });
  for (let i = 0; i < 3; i++) {
    const d = c.dirs[i];
    for (let k = 0; k < 5; k++) {
      addSpark(c.roots[i].x, c.roots[i].y, Math.atan2(d.y, d.x) + (Math.random() - 0.5) * 1.2,
               c.scale * (0.3 + Math.random() * 0.5), 0.1 + Math.random() * 0.15, c.scale * 0.4,
               k % 2 ? "#ffffff" : "#cfe3ff");
    }
  }
  shake = Math.max(shake, c.scale * 0.002);
}

// Three gashes, each from where a claw tip was to where it is now, pushed
// out past both ends so even a short flick reads as a long cut.
function addSlash(from, to, w) {
  const cuts = from.map((a, i) => {
    const b = to[i], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const ext = Math.max(0, w * 24 - l) / 2 + l * 0.35;
    return { ax: a.x - dx / l * ext, ay: a.y - dy / l * ext, bx: b.x + dx / l * ext, by: b.y + dy / l * ext,
             wob: Math.random() * 10 };
  });
  slashes.push({ cuts, w: w * 0.55, age: 0 });
  // Steel on glass: sparks thrown off along each cut.
  for (const c of cuts) {
    const a = Math.atan2(c.by - c.ay, c.bx - c.ax);
    for (let k = 0; k < 7; k++) {
      const u = Math.random();
      addSpark(c.ax + (c.bx - c.ax) * u, c.ay + (c.by - c.ay) * u, a + (Math.random() - 0.5) * 1.4,
               canvas.height * (0.15 + Math.random() * 0.35), 0.12 + Math.random() * 0.2,
               canvas.height * 0.8, k % 2 ? "#ffffff" : "#bcd8ff");
    }
  }
  while (slashes.length > SLASH_MAX) slashes.shift();
  shake = Math.max(shake, w * 0.6);
}

// A gash: a lens-shaped tear, dark inside, with a bright lip along one side
// and a dark one along the other, as if the glass were cut and pushed open.
function drawSlashes() {
  for (const s of slashes) {
    const a = 1 - smoothstep(SLASH_S - 1, SLASH_S, s.age);
    if (a <= 0) continue;
    const open = Math.min(1, s.age / 0.06);
    for (const c of s.cuts) {
      const dx = c.bx - c.ax, dy = c.by - c.ay, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, N = 16;
      const edge = (side, k) => {
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const u = i / N;
          // Widest a third of the way in, ragged along its length.
          const half = s.w * open * k * Math.pow(Math.sin(Math.PI * u), 0.7) * (1.15 - 0.3 * u) *
            (1 + 0.12 * Math.sin(u * 31 + c.wob));
          pts.push({ x: c.ax + dx * u + nx * half * side, y: c.ay + dy * u + ny * half * side });
        }
        return pts;
      };
      const lens = (k) => {
        ctx.beginPath();
        for (const p of edge(1, k)) ctx.lineTo(p.x, p.y);
        for (const p of edge(-1, k).reverse()) ctx.lineTo(p.x, p.y);
        ctx.closePath();
      };
      ctx.save();
      ctx.globalAlpha = a;
      ctx.lineJoin = "round";
      lens(1.6);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fill();
      ctx.translate(nx * s.w * 0.25, ny * s.w * 0.25);
      lens(1.2);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fill();
      ctx.translate(-nx * s.w * 0.25, -ny * s.w * 0.25);
      lens(1);
      ctx.fillStyle = "rgba(14,10,12,0.92)";
      ctx.fill();
      // The swipe itself: a white streak that flares and fades in a blink.
      if (s.age < 0.2) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a * (1 - s.age / 0.2);
        lens(2.2);
        ctx.fillStyle = "rgba(220,235,255,0.8)";
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

// One blade in its own frame: x from the knuckle (0) to the tip (L), a
// gentle curve, brushed-steel shading across it and a glint that runs up it
// as it comes out.
function drawClaw(root, d, L, W, glint) {
  if (L < 2) return;
  const bend = L * 0.05;
  ctx.save();
  ctx.setTransform(d.x, d.y, -d.y, d.x, root.x, root.y);
  ctx.beginPath();
  ctx.moveTo(0, -W / 2);
  ctx.quadraticCurveTo(L * 0.55, -W * 0.45 - bend, L, -bend * 1.6);
  ctx.quadraticCurveTo(L * 0.6, W * 0.4 - bend * 0.6, 0, W / 2);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -W / 2 - bend, 0, W / 2);
  g.addColorStop(0, "#4a525d");
  g.addColorStop(0.3, "#eef3f8");
  g.addColorStop(0.5, "#b4bec9");
  g.addColorStop(0.75, "#7d8793");
  g.addColorStop(1, "#353b44");
  ctx.fillStyle = g;
  // A soft shadow under each blade, so it sits on the hand and the scene
  // rather than floating over them.
  ctx.shadowColor = "rgba(0,0,0,0.38)";
  ctx.shadowBlur = W * 1.6;
  ctx.shadowOffsetX = W * 0.5;
  ctx.shadowOffsetY = W * 0.7;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(20,24,30,0.55)";
  ctx.lineWidth = Math.max(1, W * 0.08);
  ctx.stroke();
  // Where it leaves the hand.
  ctx.fillStyle = "rgba(60,20,20,0.5)";
  ctx.beginPath();
  ctx.ellipse(0, 0, W * 0.35, W * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  if (glint < 1) {
    const x = L * (0.15 + 0.85 * glint), r = W * 2.2;
    ctx.globalCompositeOperation = "lighter";
    const s = ctx.createRadialGradient(x, -W * 0.15, 0, x, -W * 0.15, r);
    s.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - glint)})`);
    s.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = s;
    ctx.fillRect(x - r, -W * 0.15 - r, r * 2, r * 2);
  }
  ctx.restore();
}

function renderClaws(t) {
  const dt = gagClock(t);
  for (const c of claws.values()) {
    c.ext = c.out ? Math.min(1, c.ext + dt / CLAW_OUT_S) : Math.max(0, c.ext - dt / CLAW_IN_S);
    c.glint = Math.min(1, c.glint + dt / 0.45);
  }
  ageOut(slashes, dt, SLASH_S);
  ageOut(gunFx.pops, dt, GUN_POP_S);   // the SNIKT! uses Finger Guns' pops
  stepSparks(dt);

  drawSlashes();
  for (const c of claws.values()) {
    if (c.ext <= 0) continue;
    if (c.glint < 1) spill(c.roots[1].x, c.roots[1].y, c.scale * 0.2, "220,235,255", 0.25 * (1 - c.glint));
    // A snap out (ease-out) and a quicker slide back.
    const e = c.out ? 1 - Math.pow(1 - c.ext, 3) : c.ext * c.ext;
    for (let i = 0; i < 3; i++) {
      // The middle claw is the longest, as in the comics.
      const L = c.len * e * (i === 1 ? 1 : 0.9);
      drawClaw(c.roots[i], c.dirs[i], L, c.w, c.glint);
    }
  }
  drawSparks();
  drawPops();
}

function resetClaws() {
  claws.clear();
  slashes.length = 0;
}

// `f`: three slashes across the middle of the screen.
function triggerClaws() {
  const W = canvas.width, H = canvas.height, a = -0.6 + (Math.random() - 0.5) * 0.6;
  const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx, gap = H * 0.035, l = H * 0.28;
  const from = [], to = [];
  for (let i = -1; i <= 1; i++) {
    from.push({ x: W / 2 - dx * l + nx * gap * i, y: H / 2 - dy * l + ny * gap * i });
    to.push({ x: W / 2 + dx * l + nx * gap * i, y: H / 2 + dy * l + ny * gap * i });
  }
  addSlash(from, to, H * 0.012);
}

// ===========================================================================
// Infinite Void — 🤞 Domain Expansion
//
// Gojo's sign held for a moment expands a domain out of your fingertips: a
// circle that swallows the room and replaces it with the void (a black sun
// with a white-hot rim, light rays, nebula, and stars streaming out of it).
// You stay in front of it through the person mask, outlined in blue. The
// same sign again collapses it back into your hand.
// ---------------------------------------------------------------------------

// Middle fingertip's offset from the index fingertip, measured along the
// index -> middle knuckle line and in units of it: about 1 side by side,
// more for a V, near 0 pressed together, and negative once crossed.
function crossAmount(w) {
  const a = w[INDEX_MCP], b = w[MIDDLE_MCP], p = w[INDEX_TIP], q = w[MIDDLE_MCP + 3];
  const ax = b.x - a.x, ay = b.y - a.y, az = (b.z || 0) - (a.z || 0);
  const a2 = ax * ax + ay * ay + az * az || 1;
  return ((q.x - p.x) * ax + (q.y - p.y) * ay + ((q.z || 0) - (p.z || 0)) * az) / a2;
}

function updateVoid(res, t) {
  let sign = null;
  for (const h of trackedHands(res, t)) {
    const on = voidFx.signOn;
    // Crossed fingers are never quite straight, so "up" uses the looser
    // stay-on threshold from the start.
    if (!fingerUp(h.w, INDEX_MCP, true) || !fingerUp(h.w, MIDDLE_MCP, true) ||
        !fingerDown(h.w, RING_MCP, on) || !fingerDown(h.w, PINKY_MCP, on)) continue;
    if (crossAmount(h.w) < (on ? VOID_CROSS_OFF : VOID_CROSS_ON)) {
      sign = lerpPt(h.pts[INDEX_TIP], h.pts[MIDDLE_MCP + 3], 0.5);
      break;
    }
  }
  voidSign(sign, t);
}

// The sign's fingertips this frame, or null. Held for VOID_HOLD_S it casts
// (or collapses); it has to be dropped before it can fire again.
function voidSign(p, t) {
  const now = t / 1000;
  if (!p) {
    if (++voidFx.lost > 4) { voidFx.signOn = false; voidFx.armed = true; }
    return;
  }
  voidFx.lost = 0;
  if (!voidFx.signOn) { voidFx.signOn = true; voidFx.since = now; }
  voidFx.hx = p.x;
  voidFx.hy = p.y;
  if (voidFx.armed && now - voidFx.since >= VOID_HOLD_S) {
    voidFx.armed = false;
    toggleVoid(p.x, p.y);
  }
}

function toggleVoid(x, y) {
  voidFx.x = x;
  voidFx.y = y;
  if (voidFx.phase === "idle" || voidFx.phase === "closing") {
    voidFx.phase = "opening";
    voidFx.t = 0;
    voidFx.cast = 0;
    if (!maskAvailable()) flashStatus("Infinite Void keeps you in front once the person mask loads", 2500);
  } else {
    voidFx.phase = "closing";
    voidFx.t = 0;
  }
  for (let i = 0; i < 30; i++) {
    addSpark(x, y, Math.random() * Math.PI * 2, canvas.height * (0.2 + Math.random() * 0.6),
             0.2 + Math.random() * 0.4, 0, i % 2 ? "#ffffff" : "#8fc4ff");
  }
  shake = Math.max(shake, canvas.height * 0.01);
}

// Stars in 3D, flying at the viewer out of the black sun.
function stepVoidStars(dt) {
  const st = voidFx.stars;
  while (st.length < VOID_STARS) {
    st.push({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2,
              z: st.length ? 1 : Math.random(), pz: 1 });
  }
  for (const s of st) {
    s.pz = s.z;
    s.z -= dt * (0.25 + 0.15 * Math.abs(s.x));
    if (s.z < 0.03) { s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = s.pz = 1; }
  }
}

// The void, into a half-resolution layer: it is all glow and gradients, and
// the upscale only softens it further.
function drawVoidScene(t) {
  const W = Math.max(2, Math.round(canvas.width / 2)), H = Math.max(2, Math.round(canvas.height / 2));
  const g = sizeScratch(sVoid, W, H);
  const time = t / 1000;
  const cx = W * 0.5, cy = H * 0.36, R = H * 0.2;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.7);
  bg.addColorStop(0, "#101a3c");
  bg.addColorStop(0.5, "#060a1e");
  bg.addColorStop(1, "#010208");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  g.globalCompositeOperation = "lighter";
  // Nebula: a few big soft clouds wheeling slowly around the sun.
  const clouds = [["90,60,200", 0.9, 0], ["30,110,230", 1.1, 2.1], ["170,70,210", 0.75, 4.2], ["40,170,220", 1.3, 5.3]];
  for (const [rgb, r, ph] of clouds) {
    const a = ph + time * 0.05, d = H * (0.35 + 0.1 * Math.sin(time * 0.2 + ph));
    const x = cx + Math.cos(a) * d * 1.4, y = cy + Math.sin(a) * d * 0.7, rad = H * 0.55 * r;
    const n = g.createRadialGradient(x, y, 0, x, y, rad);
    n.addColorStop(0, `rgba(${rgb},0.22)`);
    n.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = n;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // Warp stars, as streaks from where they were to where they are.
  const S = H * 0.5;
  g.lineCap = "round";
  for (const s of voidFx.stars) {
    const x0 = cx + s.x / s.pz * S * 0.3, y0 = cy + s.y / s.pz * S * 0.3;
    const x1 = cx + s.x / s.z * S * 0.3, y1 = cy + s.y / s.z * S * 0.3;
    const k = 1 - s.z;
    g.strokeStyle = `rgba(${200 + 55 * k | 0},${220 + 35 * k | 0},255,${0.15 + 0.85 * k})`;
    g.lineWidth = 0.6 + 1.8 * k;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }

  // Rays fanning off the rim, slowly turning.
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2 + time * 0.08;
    const len = R * (1.3 + 0.9 * (0.5 + 0.5 * Math.sin(i * 12.9 + time * 1.7)));
    g.strokeStyle = `rgba(170,205,255,${0.05 + 0.08 * (0.5 + 0.5 * Math.sin(i * 7.3 + time))})`;
    g.lineWidth = 1 + (i % 3);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    g.stroke();
  }
  const halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 2.8);
  halo.addColorStop(0, "rgba(150,195,255,0.55)");
  halo.addColorStop(0.25, "rgba(80,130,255,0.22)");
  halo.addColorStop(1, "rgba(40,60,200,0)");
  g.fillStyle = halo;
  g.fillRect(cx - R * 2.8, cy - R * 2.8, R * 5.6, R * 5.6);

  // The black sun itself, and its rim, glowing white-hot.
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "#000004";
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = "lighter";
  const pulse = 1 + 0.04 * Math.sin(time * 2.3);
  for (const [w, a] of [[R * 0.22, 0.12], [R * 0.1, 0.3], [R * 0.035, 0.9]]) {
    g.strokeStyle = `rgba(225,240,255,${a})`;
    g.lineWidth = w * pulse;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";
}

// You, cut out of the feed, in front of the void, with an aura (blue by
// default; Time Stone uses green).
function drawVoidPerson(color = "#7fc0ff") {
  if (!maskAvailable()) return;
  const W = canvas.width, H = canvas.height, u = unit();
  const aura = sizeScratch(sVoidAura, W, H);
  aura.globalCompositeOperation = "copy";
  aura.fillStyle = color;
  aura.fillRect(0, 0, W, H);
  aura.globalCompositeOperation = "destination-in";
  drawMaskSpace(aura, maskCanvas, 22 * u);
  aura.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.7 + 0.15 * Math.sin(performance.now() * 0.004);
  ctx.drawImage(sVoidAura.c, 0, 0);
  ctx.drawImage(sVoidAura.c, 0, 0);
  ctx.restore();

  const p = sizeScratch(sVoidPerson, W, H);
  p.globalCompositeOperation = "copy";
  p.drawImage(frame, 0, 0);
  p.globalCompositeOperation = "destination-in";
  drawMaskSpace(p, maskCanvas, 2 * u);
  p.globalCompositeOperation = "source-over";
  ctx.drawImage(sVoidPerson.c, 0, 0);
}

// A glowing title card, centred on (x, y). Shared by the anime techniques.
const jpFont = (s) => `700 ${s}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "MS Mincho", serif`;
const latinFont = (s) => `600 ${s}px "Hiragino Sans", system-ui, sans-serif`;
function titleCardAt(text, x, y, size, a, spacing, font, glow) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font(size);
  try { ctx.letterSpacing = `${spacing}px`; } catch (e) { /* older canvas */ }
  ctx.shadowColor = glow;
  ctx.shadowBlur = size * 0.4;
  ctx.fillStyle = "#f4f8ff";
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Title cards: 領域展開 as the domain spreads, then the domain's name.
function drawVoidTitles(c) {
  const W = canvas.width, H = canvas.height, blue = "rgba(90,150,255,0.9)";
  const card = (text, size, y, a, spacing, font) => titleCardAt(text, W / 2, y, size, a, spacing, font, blue);
  const jp = jpFont, latin = latinFont;
  const env = (a, b, c0, d) => smoothstep(a, b, c) * (1 - smoothstep(c0, d, c));
  card("領域展開", H * 0.085, H * 0.14, env(0.05, 0.35, 1.5, 2.0), H * 0.02, jp);
  card("DOMAIN EXPANSION", H * 0.022, H * 0.215, env(0.15, 0.45, 1.5, 2.0), H * 0.012, latin);
  card("無量空処", H * 0.12, H * 0.66, env(1.1, 1.5, 4.2, 5.0), H * 0.03, jp);
  card("INFINITE VOID", H * 0.03, H * 0.76, env(1.3, 1.7, 4.2, 5.0), H * 0.02, latin);
}

function renderVoid(t) {
  const dt = gagClock(t);
  voidFx.t += dt;
  voidFx.cast += dt;
  const W = canvas.width, H = canvas.height;
  const maxR = Math.hypot(Math.max(voidFx.x, W - voidFx.x), Math.max(voidFx.y, H - voidFx.y)) * 1.05;
  let r = 0;
  if (voidFx.phase === "opening") {
    const k = clamp01(voidFx.t / VOID_OPEN_S);
    r = maxR * (1 - Math.pow(1 - k, 3));
    if (k >= 1) voidFx.phase = "open";
  } else if (voidFx.phase === "open") {
    r = maxR;
  } else if (voidFx.phase === "closing") {
    const k = clamp01(voidFx.t / VOID_CLOSE_S);
    r = maxR * (1 - k * k);
    if (k >= 1) voidFx.phase = "idle";
  }
  stepSparks(dt);

  if (r > 1) {
    stepVoidStars(dt);
    drawVoidScene(t);
    ctx.save();
    ctx.beginPath();
    ctx.arc(voidFx.x, voidFx.y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(sVoid.c, 0, 0, W, H);
    // The information overload: now and then the void flares white.
    const flare = Math.max(0, Math.sin(voidFx.cast * 2.1) ** 40);
    if (flare > 0.02) {
      ctx.fillStyle = `rgba(230,240,255,${0.35 * flare})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawVoidPerson();
    ctx.restore();
    if (voidFx.phase === "opening" || voidFx.phase === "closing") {
      // The domain's boundary as it moves.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [w, a] of [[H * 0.05, 0.12], [H * 0.015, 0.4], [H * 0.004, 0.95]]) {
        ctx.strokeStyle = `rgba(200,225,255,${a})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.arc(voidFx.x, voidFx.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (voidFx.phase !== "closing") drawVoidTitles(voidFx.cast);
  }

  // While the sign is being held, a small blue charge gathers on the tips.
  if (voidFx.signOn && voidFx.armed) {
    const k = clamp01((t / 1000 - voidFx.since) / VOID_HOLD_S);
    const rad = H * (0.015 + 0.05 * k);
    spill(voidFx.hx, voidFx.hy, H * 0.3 * k, "120,170,255", 0.3 * k);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(voidFx.hx, voidFx.hy, 0, voidFx.hx, voidFx.hy, rad);
    g.addColorStop(0, `rgba(255,255,255,${0.5 + 0.5 * k})`);
    g.addColorStop(0.4, `rgba(120,180,255,${0.6 * k + 0.2})`);
    g.addColorStop(1, "rgba(60,100,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(voidFx.hx - rad, voidFx.hy - rad, rad * 2, rad * 2);
    ctx.restore();
  }
  drawSparks();
}

function resetVoid() {
  voidFx.phase = "idle";
  voidFx.t = 0;
  voidFx.signOn = false;
  voidFx.armed = true;
  voidFx.lost = 0;
  voidFx.stars.length = 0;
}

// `f`: expands from the middle of the screen, or collapses it.
function triggerVoid() {
  toggleVoid(voidFx.signOn ? voidFx.hx : canvas.width * 0.5,
             voidFx.signOn ? voidFx.hy : canvas.height * 0.45);
}

// ===========================================================================
// Hollow Purple — 蒼 + 赫 = 茈
//
// Blue (the hand on the left of the screen) pulls in; Red (the right) pushes
// out. Bring them together and they spiral into each other and fuse into
// Purple. Thrust and it fires, erasing a tunnel through everything in its
// path; shove it at the camera and it erases the whole screen.
// ---------------------------------------------------------------------------

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
  shake = Math.max(shake, canvas.height * 0.006);
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
  shake = Math.max(shake, H * (ang === null ? 0.035 : 0.02));
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
  const sg = sizeScratch(sSnapSample, sw, sh);
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

// ===========================================================================
// Shadow Clone Jutsu — 影分身の術
//
// Both hands up in the two-finger sign, held together: four clones of you
// poof out of smoke on either side. Each is your live cut-out, played back a
// different beat late, so they move like four separate people rather than
// a mirror. The back pair is smaller and darker, for depth. The sign again
// dispels them, each in its own puff.
// ---------------------------------------------------------------------------

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
      const p = sizeScratch(sVoidPerson, W, H);
      p.globalCompositeOperation = "copy";
      p.drawImage(frame, 0, 0);
      p.globalCompositeOperation = "destination-in";
      drawMaskSpace(p, maskCanvas, 2 * unit());
      p.globalCompositeOperation = "source-over";
      ctx.drawImage(sVoidPerson.c, 0, 0);
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

// ===========================================================================
// Strange Portal — draw a circle in the air, and it opens
//
// Point your index finger (ring and pinky curled) and trace a circle: sparks
// follow the fingertip, and once the loop closes a ring of molten sparks
// spins open at that size and place, with another world inside it. First
// the Mirror Dimension (the room itself, folded into a turning kaleidoscope),
// then the Portal effect's worlds. Draw a circle over it to close it; draw
// one elsewhere and the portal moves there.
// ---------------------------------------------------------------------------

function updateStrange(res, t) {
  let tip = null, scale = 1;
  for (const h of trackedHands(res, t)) {
    const on = strange.drawing;
    if (fingerUp(h.w, INDEX_MCP, on) && fingerDown(h.w, RING_MCP, on) && fingerDown(h.w, PINKY_MCP, on)) {
      tip = h.pts[INDEX_TIP];
      scale = h.scale;
      break;
    }
  }
  strangeTrack(tip, scale, t);
}

// The drawing fingertip this frame, or null.
function strangeTrack(tip, scale, t) {
  const now = t / 1000;
  if (!tip) {
    if (++strange.lost > 6) { strange.drawing = false; strange.trail.length = 0; }
    return;
  }
  strange.lost = 0;
  strange.drawing = true;
  strange.tipX = tip.x;
  strange.tipY = tip.y;
  strange.scale = scale;
  const tr = strange.trail;
  tr.push({ x: tip.x, y: tip.y, t: now });
  while (tr.length && now - tr[0].t > STRANGE_TRAIL_S) tr.shift();
  if (now < strange.cool) return;
  const c = findCircle(tr);
  if (c) {
    tr.length = 0;
    strange.cool = now + 0.6;
    castPortal(c.x, c.y, c.r, c.dir);
  }
}

// The newest stretch of the trail that loops round its own centre: it has
// to sweep most of a full turn about its centroid and stay roughly round, so
// a wave or a zigzag does not count. Returns its centre, mean radius and
// which way it was drawn.
function findCircle(tr) {
  const n = tr.length, H = canvas.height;
  if (n < 10) return null;
  for (let j = n - 10; j >= 0; j--) {
    const m = n - j;
    let cx = 0, cy = 0;
    for (let i = j; i < n; i++) { cx += tr[i].x; cy += tr[i].y; }
    cx /= m;
    cy /= m;
    let sum = 0, sum2 = 0, sweep = 0, prev = null;
    for (let i = j; i < n; i++) {
      const dx = tr[i].x - cx, dy = tr[i].y - cy, r = Math.hypot(dx, dy);
      sum += r;
      sum2 += r * r;
      const a = Math.atan2(dy, dx);
      if (prev !== null) { const d = a - prev; sweep += Math.atan2(Math.sin(d), Math.cos(d)); }
      prev = a;
    }
    const mean = sum / m, sd = Math.sqrt(Math.max(0, sum2 / m - mean * mean));
    if (mean < STRANGE_MIN_R * H) continue;
    if (Math.abs(sweep) >= STRANGE_SWEEP && sd / mean < STRANGE_ROUND) {
      return { x: cx, y: cy, r: mean, dir: Math.sign(sweep) || 1 };
    }
  }
  return null;
}

function castPortal(x, y, r, dir) {
  const H = canvas.height;
  const open = strange.portals.find((p) => !p.closing);
  if (open) {
    open.closing = true;
    open.closeAge = 0;
    // Drawn over the open one: that was a close, not a new portal.
    if (Math.hypot(x - open.x, y - open.y) < open.R) return;
  }
  const world = strange.world;
  strange.world = (strange.world + 1) % STRANGE_WORLDS.length;
  strange.portals.push({ x, y, R: clamp(r * 1.15, H * 0.12, H * 0.45), age: 0,
                         closing: false, closeAge: 0, world, spin: dir || 1 });
  flashStatus(`Portal → ${STRANGE_WORLDS[world]}`);
  shake = Math.max(shake, H * 0.004);
}

// The room, sliced into eight wedges round the portal's centre, every other
// one mirrored, turning slowly: the Mirror Dimension.
function drawMirrorDimension(P, r, t) {
  const N = 8, wedge = (Math.PI * 2) / N, spin = t * 0.00015 * P.spin;
  const sx = P.x + r * 0.6 * Math.cos(t * 0.0002), sy = P.y + r * 0.35 * Math.sin(t * 0.00027);
  for (let k = 0; k < N; k++) {
    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.rotate(k * wedge + spin);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 1.02, -wedge / 2 - 0.01, wedge / 2 + 0.01);
    ctx.closePath();
    ctx.clip();
    if (k % 2) ctx.scale(1, -1);
    ctx.scale(1.35, 1.35);
    ctx.drawImage(frame, -sx + r * 0.35, -sy);
    ctx.restore();
  }
  // A cold, other-worldly cast over it.
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = "rgba(70,230,190,0.55)";
  ctx.fillRect(P.x - r, P.y - r, r * 2, r * 2);
  ctx.restore();
}

function drawStrangePortal(P, t, dt) {
  const k = P.closing ? 1 - clamp01(P.closeAge / STRANGE_CLOSE_S)
                      : 1 - Math.pow(1 - clamp01(P.age / STRANGE_OPEN_S), 3);
  const r = P.R * k, H = canvas.height;
  if (r < 2) return;
  spill(P.x, P.y, r * 1.9, "255,140,40", 0.32 * k);

  // The world inside, darkening toward the rim so it reads as depth.
  ctx.save();
  ctx.beginPath();
  ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
  ctx.clip();
  if (P.world === 0) {
    drawMirrorDimension(P, r, t);
  } else {
    const S = Math.max(2, Math.ceil(r * 2));
    const g = sizeScratch(sStrange, S, S);
    g.save();
    PORTAL_SCENE_FNS[P.world - 1](g, S, S, t);
    g.restore();
    ctx.drawImage(sStrange.c, P.x - r, P.y - r);
  }
  const depth = ctx.createRadialGradient(P.x, P.y, r * 0.65, P.x, P.y, r);
  depth.addColorStop(0, "rgba(0,0,0,0)");
  depth.addColorStop(1, "rgba(10,4,0,0.55)");
  ctx.fillStyle = depth;
  ctx.fillRect(P.x - r, P.y - r, r * 2, r * 2);
  ctx.restore();

  // The ring: a few jittered loops of molten orange, the wobble running
  // round in the direction it was drawn.
  const ph = t * 0.004 * P.spin;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  const loops = [[0.07, "rgba(255,110,20,0.30)"], [0.035, "rgba(255,150,40,0.55)"],
                 [0.014, "rgba(255,210,110,0.9)"], [0.006, "rgba(255,250,220,1)"]];
  loops.forEach(([w, col], i) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, r * w);
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.06; a += 0.05) {
      const rr = r * (1 + 0.022 * Math.sin(a * 9 + ph * 3 + i) + 0.012 * Math.sin(a * 23 - ph * 5 + i * 2));
      ctx.lineTo(P.x + Math.cos(a) * rr, P.y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.stroke();
  });
  ctx.restore();

  // Sparks thrown off the rim along the spin, falling as they go.
  P.sparkAcc = (P.sparkAcc || 0) + dt * 520 * k;
  while (P.sparkAcc >= 1) {
    P.sparkAcc--;
    const a = Math.random() * Math.PI * 2;
    const tangent = a + P.spin * Math.PI / 2 + (Math.random() - 0.5) * 0.5 + 0.25 * P.spin;
    const roll = Math.random();
    addSpark(P.x + Math.cos(a) * r, P.y + Math.sin(a) * r, tangent, H * (0.25 + Math.random() * 0.6),
             0.25 + Math.random() * 0.45, H * 1.6, roll < 0.5 ? "#ffb347" : roll < 0.85 ? "#ffd27a" : "#fff4d6");
  }
}

function renderStrange(t) {
  const dt = gagClock(t);
  const now = t / 1000, H = canvas.height, u = unit();
  stepSparks(dt);
  for (const P of strange.portals) {
    P.age += dt;
    if (P.closing) P.closeAge += dt;
  }
  strange.portals = strange.portals.filter((P) => !P.closing || P.closeAge < STRANGE_CLOSE_S);
  for (const P of strange.portals) drawStrangePortal(P, t, dt);

  // The trail the fingertip is drawing, fading over a second, with sparks
  // coming off the tip itself.
  const tr = strange.trail;
  if (strange.drawing && tr.length > 1) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 1; i < tr.length; i++) {
      const a = 1 - clamp01((now - tr[i].t) / 1.0);
      if (a <= 0) continue;
      ctx.strokeStyle = `rgba(255,160,50,${0.8 * a})`;
      ctx.lineWidth = (2 + 4 * a) * u;
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
      ctx.lineTo(tr[i].x, tr[i].y);
      ctx.stroke();
    }
    ctx.restore();
    spill(strange.tipX, strange.tipY, H * 0.08, "255,150,40", 0.3);
    strange.tipAcc += dt * 140;
    while (strange.tipAcc >= 1) {
      strange.tipAcc--;
      addSpark(strange.tipX, strange.tipY, Math.random() * Math.PI * 2, H * (0.05 + Math.random() * 0.2),
               0.15 + Math.random() * 0.2, H * 1.2, Math.random() < 0.6 ? "#ffb347" : "#fff0c8");
    }
  }
  drawSparks();
}

function resetStrange() {
  strange.trail.length = 0;
  strange.drawing = false;
  strange.lost = 0;
  strange.cool = 0;
  strange.portals.length = 0;
}

// `f`: opens one mid-screen, or closes the one that is open.
function triggerStrange() {
  const open = strange.portals.find((p) => !p.closing);
  if (open) castPortal(open.x, open.y, open.R, open.spin);
  else castPortal(canvas.width * 0.5, canvas.height * 0.45, canvas.height * 0.25, 1);
}

// ===========================================================================
// Speech Bubbles — talk, and it comes out as a comic
//
// The browser's speech recognition turns what you say into text, live, and
// it fills a comic bubble beside your head with its tail on your mouth. A
// pause ends a bubble; the next words start a new one and the old ones float
// up and fade. Talk with your mouth wide open and the bubble is a shout:
// jagged and in capitals. With no recogniser or no microphone, moving your
// mouth still gets a bubble of animated dots.
// ---------------------------------------------------------------------------

function startSpeech() {
  if (demoMode || speech.state === "on") return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    speech.state = "unsupported";
    flashStatus("This browser has no speech recognition — bubbles show • • • instead", 4000);
    return;
  }
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = urlParams.get("lang") || navigator.language || "en-US";
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript.trim();
      if (text) bubbleSay(text, e.results[i].isFinal);
    }
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      speech.state = "denied";
      flashStatus("Microphone blocked — bubbles show • • • instead", 4000);
    } else if (e.error === "network") {
      speech.state = "denied";
      flashStatus("Speech service unreachable — bubbles show • • • instead", 4000);
    }
  };
  // Chrome ends a session after a while of silence; keep it going for as
  // long as the effect is up.
  rec.onend = () => {
    if (speech.state === "on" && speech.rec === rec) {
      try { rec.start(); } catch (err) { speech.state = "off"; }
    }
  };
  speech.rec = rec;
  speech.state = "on";
  try { rec.start(); } catch (err) { speech.state = "off"; }
}

function stopSpeech() {
  const rec = speech.rec;
  speech.rec = null;
  if (speech.state === "on") speech.state = "off";
  if (rec) { try { rec.abort(); } catch (err) { /* already stopped */ } }
}

// New words for the current bubble, or the first words of a new one once
// the last was finished. `opts.shout` forces the shout style (demo).
function bubbleSay(text, isFinal, opts) {
  const now = speech.now;
  let b = bubbles[bubbles.length - 1];
  if (!b || b.final || b.dots) {
    if (b && b.dots) b.final = true;
    b = { text: "", final: false, dots: false, born: now, last: now, p: 0, shout: false,
          x: null, y: null, rx: 0, ry: 0, seed: Math.random() * 100 };
    bubbles.push(b);
    while (bubbles.length > BUBBLE_MAX) bubbles.shift();
  }
  b.text = text;
  b.last = now;
  if (isFinal) b.final = true;
  // A mouth wide open while the words come (well past talking) is shouting.
  if ((opts && opts.shout) || (!demoMode && mouth.seen && mouth.open > BUBBLE_SHOUT)) b.shout = true;
}

// Without a recogniser: a bubble of dots for as long as the mouth is moving.
// Talking shows up as the lip gap changing, not as it being open.
function trackTalking(now) {
  if (demoMode || speech.state === "on" || !mouth.seen) return;
  const h = speech.ratios;
  h.push({ t: now, r: mouth.ratio || 0 });
  while (h.length && now - h[0].t > 0.6) h.shift();
  let lo = Infinity, hi = -Infinity;
  for (const s of h) { lo = Math.min(lo, s.r); hi = Math.max(hi, s.r); }
  if (h.length > 4 && hi - lo > 0.08) {
    let b = bubbles[bubbles.length - 1];
    if (!b || !b.dots || b.final) {
      bubbleSay("", false);
      b = bubbles[bubbles.length - 1];
      b.dots = true;
      b.final = false;
    }
    b.last = now;
  }
}

function bubbleFont(b, fs) {
  return b.shout
    ? `900 ${Math.round(fs * 1.12)}px "Bangers", Impact, "Arial Black", sans-serif`
    : `700 ${Math.round(fs)}px "Chalkboard SE", "Comic Sans MS", "Comic Neue", cursive`;
}

// Words into lines no wider than maxW, keeping only the last few lines of a
// long sentence (it is a bubble, not a transcript).
function wrapBubble(text, maxW) {
  const words = text.split(/\s+/).filter(Boolean), lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > BUBBLE_LINES) {
    const keep = lines.slice(-BUBBLE_LINES);
    keep[0] = "…" + keep[0];
    return keep;
  }
  return lines;
}

// One bubble: outlines first, then the fills over them, so the tail joins
// the body with no seam. `tail` is the point it aims at, or null.
function drawBubbleShape(b, cx, cy, rx, ry, tail, u) {
  const body = () => {
    ctx.beginPath();
    if (b.shout) {
      const n = 22;
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const k = i % 2 ? 1 : 1.22 + 0.08 * Math.sin(b.seed + i * 2.7);
        ctx.lineTo(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k);
      }
      ctx.closePath();
    } else {
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    }
  };
  const tailPath = () => {
    if (!tail) return false;
    const ang = Math.atan2(tail.y - cy, tail.x - cx);
    // The tail leaves the body's edge as a wedge and curves to a point.
    const spread = 0.28;
    const e = (a) => ({ x: cx + Math.cos(a) * rx * 0.9, y: cy + Math.sin(a) * ry * 0.9 });
    const p0 = e(ang - spread), p1 = e(ang + spread);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo((p0.x + tail.x) / 2 + (tail.y - cy) * 0.05, (p0.y + tail.y) / 2, tail.x, tail.y);
    ctx.quadraticCurveTo((p1.x + tail.x) / 2, (p1.y + tail.y) / 2, p1.x, p1.y);
    ctx.closePath();
    return true;
  };
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 10 * u;
  ctx.shadowOffsetY = 4 * u;
  ctx.fillStyle = "#16161a";
  ctx.strokeStyle = "#16161a";
  ctx.lineWidth = 5 * u;
  body(); ctx.fill(); ctx.stroke();
  if (tailPath()) { ctx.fill(); ctx.stroke(); }
  ctx.shadowColor = "transparent";
  ctx.fillStyle = b.shout ? "#fff6c9" : "#ffffff";
  body(); ctx.fill();
  if (tailPath()) ctx.fill();
}

function renderBubbles(t) {
  gagClock(t);
  const now = speech.now = t / 1000;
  const W = canvas.width, H = canvas.height, u = unit();
  trackTalking(now);

  // Retire bubbles: finished ones linger, then float off.
  for (const b of bubbles) {
    const quiet = now - b.last;
    if (!b.final && quiet > (b.dots ? 1.0 : 2.5)) b.final = true;
    b.gone = b.final ? clamp01((quiet - BUBBLE_HOLD_S) / 0.6) : 0;
  }
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].gone >= 1) bubbles.splice(i, 1);

  // Anchor: beside your head, on whichever side has more room.
  const seen = mouth.seen;
  const mx = seen ? mouth.x : W / 2, my = seen ? mouth.y : H * 0.6, mw = seen ? mouth.w : H * 0.06;
  const side = mx < W / 2 ? 1 : -1;
  const fs = Math.max(16, H * 0.032);

  let stackY = null;
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i], newest = i === bubbles.length - 1;
    b.p += (1 - b.p) * 0.25;
    ctx.save();
    ctx.font = bubbleFont(b, fs);
    const text = b.dots ? "•  •  •".slice(0, 1 + 3 * (Math.floor(now * 3) % 3)) : (b.shout ? b.text.toUpperCase() + "!" : b.text);
    const lines = wrapBubble(text || "…", Math.min(W * 0.34, fs * 15));
    const lh = fs * (b.shout ? 1.12 : 1.22);
    let tw = 0;
    for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
    const th = lines.length * lh;
    // The body eases to fit the words as they arrive.
    const trx = tw / 2 * 1.32 + fs * 0.9, try_ = th / 2 * 1.45 + fs * 0.75;
    b.rx = b.rx ? b.rx + (trx - b.rx) * 0.3 : trx;
    b.ry = b.ry ? b.ry + (try_ - b.ry) * 0.3 : try_;

    // Newest sits beside the head at about eye level, clear of the face (which
    // is roughly three mouth-widths across); older ones stack above it and
    // drift up as they go.
    let tx = mx + side * (mw * 2.2 + b.rx * 1.1), ty;
    if (newest) ty = my - mw * 1.7;
    else ty = stackY - b.ry * 1.15 - fs * 0.5 - b.gone * H * 0.08;
    tx = clamp(tx, b.rx * 1.25 + 8 * u, W - b.rx * 1.25 - 8 * u);
    ty = clamp(ty, b.ry * 1.3 + 8 * u, H - b.ry * 1.3 - 8 * u);
    b.x = b.x === null ? tx : b.x + (tx - b.x) * 0.2;
    b.y = b.y === null ? ty : b.y + (ty - b.y) * 0.2;
    stackY = b.y - b.ry * 1.15;

    // Pop in with a little overshoot; older bubbles shrink back a touch.
    const age = now - b.born, k = clamp01(age / 0.22);
    const pop = k < 1 ? 1 + 0.18 * Math.sin(k * Math.PI) - (1 - k) * 0.6 : 1;
    const sc = Math.max(0.05, pop * (newest ? 1 : 0.88) * (1 - 0.15 * b.gone));
    const jitter = b.shout && !b.final ? (Math.random() - 0.5) * 3 * u : 0;
    ctx.globalAlpha = 1 - b.gone;
    ctx.translate(b.x + jitter, b.y + jitter);
    ctx.scale(sc, sc);
    ctx.translate(-b.x, -b.y);
    const tail = newest && seen && !b.final
      ? { x: mx + side * mw * 0.55 + (b.x - mx) * 0.18, y: my - mw * 0.25 + (b.y - my) * 0.18 }
      : newest && seen ? { x: mx + side * mw * 0.7 + (b.x - mx) * 0.35, y: my + (b.y - my) * 0.35 } : null;
    drawBubbleShape(b, b.x, b.y, b.rx, b.ry, tail, u);
    ctx.fillStyle = b.shout ? "#b3121b" : "#16161a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((l, j) => ctx.fillText(l, b.x, b.y - th / 2 + lh * (j + 0.5)));
    ctx.restore();
  }
}

function resetBubbles() {
  stopSpeech();
  bubbles.length = 0;
  speech.ratios.length = 0;
}

// `f`: says something, to check it works without talking.
function triggerBubbles() {
  const lines = ["Is this thing on?", "I'm in a comic now!", "Testing, one, two, three."];
  bubbleSay(lines[(Math.random() * lines.length) | 0], true);
}

// ===========================================================================
// Spirit Bomb — 元気玉
//
// Both open hands raised high: the light drains out of the room into a
// sphere gathering above them, in streams from every corner, until the
// screen is dark but for it. Throw your hands down (or shove at the camera)
// and it comes crashing toward you in a blinding impact, and the light
// floods back. Lower your hands slowly instead and it fizzles.
// ---------------------------------------------------------------------------

const openCount = (w) =>
  [INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP].filter((k) => fingerUp(w, k, true)).length;

function updateBomb(res, t) {
  const hands = trackedHands(res, t);
  let m = null;
  if (hands.length >= 2) {
    const [a, b] = hands;
    if (openCount(a.w) >= 3 && openCount(b.w) >= 3) {
      m = { a: palmCentre(a.pts), b: palmCentre(b.pts),
            palm: (dist(a.pts[WRIST], a.pts[MIDDLE_MCP]) + dist(b.pts[WRIST], b.pts[MIDDLE_MCP])) / 2 };
    }
  }
  bombTrack(m, t);
}

// Both palm centres and the palm length in pixels, or null.
function bombTrack(m, t) {
  const now = t / 1000, H = canvas.height;
  if (!m) {
    if (++bomb.lost > 8) { bomb.up = false; bomb.hist.length = 0; }
    return;
  }
  const x = (m.a.x + m.b.x) / 2, y = Math.min(m.a.y, m.b.y);
  bomb.hx = x;
  bomb.hy = y;
  bomb.palm = m.palm;
  // The throw: over the last quarter second the hands came down fast, or
  // grew fast (a shove at the camera). Checked before "still raised", since
  // a throw is exactly the hands leaving the top of the screen.
  const hist = bomb.hist;
  hist.push({ t: now, y, palm: m.palm });
  while (hist.length && now - hist[0].t > 0.25) hist.shift();
  if (bomb.charge >= BOMB_MIN_S && !bomb.shot && hist.length >= 3) {
    const h0 = hist[0], span = now - h0.t;
    if (span > 0.06 && ((y - h0.y) / span / m.palm > BOMB_THROW || (m.palm / h0.palm - 1) / span > KAME_PUSH)) {
      throwBomb();
    }
  }
  if (Math.max(m.a.y, m.b.y) < H * BOMB_RAISE) { bomb.up = true; bomb.lost = 0; }
  else if (++bomb.lost > 8) bomb.up = false;
}

function throwBomb() {
  bomb.forced = false;
  bomb.shot = { age: 0, x: bomb.x, y: bomb.y, r: bomb.r, power: clamp01(bomb.charge / BOMB_FULL_S) };
  bomb.charge = 0;
  bomb.hist.length = 0;
}

function renderBomb(t) {
  const dt = gagClock(t);
  const W = canvas.width, H = canvas.height;
  const s = bomb.shot, up = bomb.up || bomb.forced;
  if (up && !s) {
    if (bomb.charge === 0) bomb.title = 0;
    bomb.charge = Math.min(BOMB_FULL_S * 1.2, bomb.charge + dt);
  } else if (!s) {
    bomb.charge = Math.max(0, bomb.charge - dt * 2);   // lowered: it fizzles
  }
  bomb.title += dt;
  const k = clamp01(bomb.charge / BOMB_FULL_S);

  // How dark the room is: the charge, or after a throw, the light flooding
  // back in once the bomb has landed.
  let dark = k;
  if (s) {
    s.age += dt;
    dark = s.power * (1 - smoothstep(BOMB_FLY_S, BOMB_FLY_S + 1.2, s.age));
  }
  if (dark > 0.005) {
    ctx.fillStyle = `rgba(2,6,22,${0.66 * dark})`;
    ctx.fillRect(0, 0, W, H);
  }

  // The sphere rides above your hands, growing with the charge.
  const r = bomb.palm * 0.5 + H * BOMB_MAX_R * k;
  // Kept mostly on screen even with your hands near the top of the frame.
  const tx = bomb.hx, ty = Math.max(r * 0.8, bomb.hy - bomb.palm * 1.1 - r * 0.9);
  bomb.x = bomb.r ? bomb.x + (tx - bomb.x) * 0.3 : tx;
  bomb.y = bomb.r ? bomb.y + (ty - bomb.y) * 0.3 : ty;
  bomb.r = r;

  // Light streaming in from all over the room while it charges.
  if (up && !s) {
    bomb.acc += dt * (40 + 120 * k);
    while (bomb.acc >= 1 && bomb.motes.length < 500) {
      bomb.acc--;
      const edge = Math.random();
      const x0 = edge < 0.5 ? Math.random() * W : (Math.random() < 0.5 ? 0 : W);
      const y0 = edge < 0.5 ? (Math.random() < 0.7 ? H : Math.random() * H) : Math.random() * H;
      bomb.motes.push({ x: x0, y: y0, vx: 0, vy: 0, age: 0, swirl: (Math.random() - 0.5) * 2 });
    }
  }
  let n = 0;
  for (const p of bomb.motes) {
    p.age += dt;
    const dx = bomb.x - p.x, dy = bomb.y - p.y, d = Math.hypot(dx, dy) || 1;
    const acc = H * (1.5 + p.age * 4);
    p.vx += (dx / d * acc - dy / d * acc * 0.3 * p.swirl) * dt;
    p.vy += (dy / d * acc + dx / d * acc * 0.3 * p.swirl) * dt;
    p.vx *= Math.exp(-1.5 * dt);
    p.vy *= Math.exp(-1.5 * dt);
    p.px = p.x; p.py = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (d > bomb.r * 0.8 && p.age < 4 && !s) bomb.motes[n++] = p;
  }
  bomb.motes.length = n;
  if (n) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    // Motes of light with short tails, brightening as they near the sphere.
    ctx.lineWidth = Math.max(1.5, 2.4 * unit());
    for (const p of bomb.motes) {
      const near = clamp01(1 - Math.hypot(bomb.x - p.x, bomb.y - p.y) / (H * 0.8));
      ctx.strokeStyle = `rgba(185,225,255,${0.35 + 0.6 * near})`;
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (s) {
    // Thrown: it comes down at you, swelling, then hits.
    const f = clamp01(s.age / BOMB_FLY_S), e = f * f;
    const x = s.x + (W / 2 - s.x) * e, y = s.y + (H * 0.62 - s.y) * e;
    if (f < 1) drawBombSphere(x, y, s.r * (1 + 3.5 * e), t, 1);
    else {
      if (!s.hit) { s.hit = true; shake = Math.max(shake, H * 0.04 * (0.5 + s.power)); }
      const a = s.age - BOMB_FLY_S;
      ctx.fillStyle = `rgba(235,245,255,${Math.max(0, 1 - a / 0.9)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const rr = (a - i * 0.12) * Math.hypot(W, H) * 0.9;
        if (rr <= 0) continue;
        ctx.strokeStyle = `rgba(160,210,255,${Math.max(0, 0.6 - a * 0.5)})`;
        ctx.lineWidth = H * 0.02;
        ctx.beginPath();
        ctx.arc(W / 2, H * 0.62, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (s.age > BOMB_FLY_S + 1.6) bomb.shot = null;
  } else if (bomb.charge > 0.05) {
    drawBombSphere(bomb.x, bomb.y, bomb.r, t, Math.min(1, bomb.charge * 2));
  }

  const c = bomb.title, env = (a0, b0, c0, d0) => smoothstep(a0, b0, c) * (1 - smoothstep(c0, d0, c));
  if (!s && up) {
    titleCardAt("元気玉", W / 2, H * 0.86, H * 0.075, env(0.3, 0.6, 2.6, 3.2), H * 0.02, jpFont, "rgba(120,190,255,0.95)");
    titleCardAt("SPIRIT BOMB", W / 2, H * 0.925, H * 0.022, env(0.4, 0.7, 2.6, 3.2), H * 0.012, latinFont, "rgba(120,190,255,0.95)");
  }
}

// A ball of gathered light: a white core, pale blue body, a churning
// surface and a wide glow that lights the darkened room.
function drawBombSphere(x, y, r, t, k) {
  spill(x, y, r * 5, "150,200,255", 0.55 * k);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2.4);
  halo.addColorStop(0, `rgba(140,200,255,${0.55 * k})`);
  halo.addColorStop(1, "rgba(60,120,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
  const body = ctx.createRadialGradient(x - r * 0.2, y - r * 0.25, 0, x, y, r);
  body.addColorStop(0, `rgba(255,255,255,${k})`);
  body.addColorStop(0.5, `rgba(200,232,255,${0.95 * k})`);
  body.addColorStop(0.9, `rgba(110,175,255,${0.8 * k})`);
  body.addColorStop(1, "rgba(80,140,255,0)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${0.35 * k})`;
  ctx.lineWidth = Math.max(1, r * 0.03);
  for (let i = 0; i < 5; i++) {
    const a = t * 0.0013 * (i % 2 ? 1 : -1) + i * 1.3;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (0.55 + 0.08 * i), r * (0.25 + 0.06 * i), a, 0, Math.PI * 1.3);
    ctx.stroke();
  }
  ctx.restore();
}

function resetBomb() {
  bomb.up = false;
  bomb.forced = false;
  bomb.lost = 0;
  bomb.charge = 0;
  bomb.shot = null;
  bomb.motes.length = 0;
  bomb.hist.length = 0;
  bomb.r = 0;
}

// `f`: a full charge mid-screen, thrown on the second press.
function triggerBomb() {
  if (bomb.shot) return;
  if (bomb.charge >= BOMB_MIN_S) { throwBomb(); return; }
  bomb.hx = canvas.width / 2;
  bomb.hy = canvas.height * 0.45;
  bomb.palm = canvas.height * 0.15;
  bomb.charge = BOMB_FULL_S;
  bomb.forced = true;
  bomb.title = 0;
}

// ===========================================================================
// Time Stone — the Eye of Agamotto
//
// An open palm brings up the green mandala and stops time. Twist the hand
// like a dial: counter-clockwise rewinds the room, clockwise runs it
// forward again, and holding still holds the moment. You stay in the
// present (the person mask keeps you live) while the world behind you plays
// backwards. Drop the hand and time races forward to catch up with now.
// ---------------------------------------------------------------------------

function updateTime(res, t) {
  let pose = null;
  for (const h of trackedHands(res, t)) {
    if (openCount(h.w) >= 3) {
      const p = h.pts, c = palmCentre(p);
      pose = { x: c.x, y: c.y, palm: dist(p[WRIST], p[MIDDLE_MCP]),
               ang: Math.atan2(p[MIDDLE_MCP].y - p[WRIST].y, p[MIDDLE_MCP].x - p[WRIST].x) };
      break;
    }
  }
  timeTrack(pose, t);
}

// The open hand this frame ({x, y, palm, ang}) or null.
function timeTrack(pose, t) {
  const now = t / 1000;
  if (!pose) {
    if (++timeFx.lost > 6) { timeFx.on = false; timeFx.prevAng = null; timeFx.spin = 0; }
    return;
  }
  if (!timeFx.on) timeFx.target = now;   // the moment the spell starts, time stops
  timeFx.on = true;
  timeFx.lost = 0;
  timeFx.x = pose.x;
  timeFx.y = pose.y;
  timeFx.palm = pose.palm;
  if (timeFx.prevAng !== null) {
    const d = pose.ang - timeFx.prevAng;
    const w = Math.atan2(Math.sin(d), Math.cos(d)) / Math.max(1e-3, now - timeFx.prevT);
    timeFx.spin += (w - timeFx.spin) * 0.5;
  }
  timeFx.prevAng = pose.ang;
  timeFx.prevT = now;
}

// The live feed, small, into a ring of timestamped slots.
function captureTime(now) {
  if (now - timeFx.lastCap < 1 / TIME_FPS) return;
  timeFx.lastCap = now;
  const n = Math.ceil(TIME_SPAN_S * TIME_FPS);
  timeFx.head = (timeFx.head + 1) % n;
  if (!timeBuf[timeFx.head]) timeBuf[timeFx.head] = { s: makeScratch(false), t: -1 };
  const slot = timeBuf[timeFx.head];
  const w = Math.min(TIME_W, canvas.width), h = Math.round(w * canvas.height / canvas.width);
  sizeScratch(slot.s, w, h).drawImage(frame, 0, 0, w, h);
  slot.t = now;
}

// The newest slot at or before `target`, and the one before that.
function timeSlotAt(target) {
  const n = Math.ceil(TIME_SPAN_S * TIME_FPS);
  let best = null, prev = null;
  for (let i = 0; i < n; i++) {
    const slot = timeBuf[(timeFx.head - i + n) % n];
    if (!slot || slot.t < 0) break;
    if (slot.t <= target) { best = slot; prev = timeBuf[(timeFx.head - i - 1 + n) % n] || null; break; }
    best = slot;
  }
  return { best, prev };
}

function oldestTime() {
  let oldest = timeFx.lastCap;
  for (const slot of timeBuf) if (slot && slot.t >= 0) oldest = Math.min(oldest, slot.t);
  return oldest;
}

// Concentric rune rings, turning against each other: the spell on the hand,
// and faintly behind the whole room while time is bent.
function drawMandala(x, y, R, rot, a) {
  if (a <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(110,255,160,${a})`;
  ctx.fillStyle = `rgba(150,255,190,${a})`;
  ctx.lineWidth = Math.max(1, R * 0.012);
  [1, 0.78, 0.55].forEach((f, i) => {
    const r = R * f;
    ctx.save();
    ctx.rotate(rot * (i % 2 ? -1 : 1) * (1 + i * 0.35));
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.moveTo(r * 0.9, 0);
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    const marks = 24 + i * 8;
    ctx.beginPath();
    for (let k = 0; k < marks; k++) {
      const ang = (k / marks) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      if (k % 3 === 0) {
        // A little rune: a bar and a hook between the two circles.
        ctx.moveTo(c * r * 0.91, s * r * 0.91);
        ctx.lineTo(c * r * 0.99, s * r * 0.99);
        const a2 = ang + 0.06;
        ctx.moveTo(Math.cos(a2) * r * 0.93, Math.sin(a2) * r * 0.93);
        ctx.arc(0, 0, r * 0.95, a2, a2 + 0.05);
      } else {
        ctx.moveTo(c * r * 0.94, s * r * 0.94);
        ctx.lineTo(c * r * 0.97, s * r * 0.97);
      }
    }
    ctx.stroke();
    // The innermost ring carries an eight-pointed star.
    if (i === 2) {
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const ang = (k * 3 / 8) * Math.PI * 2;
        ctx.lineTo(Math.cos(ang) * r * 0.88, Math.sin(ang) * r * 0.88);
      }
      ctx.stroke();
    }
    ctx.restore();
  });
  ctx.restore();
}

function renderTime(t) {
  const dt = gagClock(t);
  const now = t / 1000, W = canvas.width, H = canvas.height, u = unit();
  captureTime(now);

  // Where in time we are. The spin decays between tracker frames so a hand
  // that stops twisting stops time moving.
  timeFx.spin *= Math.exp(-6 * dt);
  if (timeFx.on) {
    timeFx.target += timeFx.spin * TIME_GAIN * dt;
  } else {
    timeFx.target += dt * (1 + TIME_RETURN);
  }
  timeFx.target = clamp(timeFx.target, oldestTime(), now);
  const behind = now - timeFx.target;
  const bent = timeFx.on || behind > 0.03;
  timeFx.k += ((bent ? 1 : 0) - timeFx.k) * 0.15;

  if (behind > 0.03) {
    const { best, prev } = timeSlotAt(timeFx.target);
    if (best) {
      ctx.drawImage(best.s.c, 0, 0, W, H);
      // A ghost of the neighbouring moment, so moving time smears.
      if (prev && Math.abs(timeFx.spin) > 0.2) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.drawImage(prev.s.c, 0, 0, W, H);
        ctx.restore();
      }
    }
  }
  if (timeFx.k > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = `rgba(60,255,140,${0.45 * timeFx.k})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    drawMandala(W / 2, H / 2, H * 0.62, -timeFx.target * 0.8, 0.12 * timeFx.k);
  }
  // You stay in the present, in front of the bent world.
  if (behind > 0.03) drawVoidPerson("#7dffb0");

  if (timeFx.on || timeFx.k > 0.05) {
    const R = timeFx.palm * 1.6, a = timeFx.k;
    spill(timeFx.x, timeFx.y, R * 2.2, "90,255,150", 0.35 * a);
    drawMandala(timeFx.x, timeFx.y, R, now * 0.8 + (now - timeFx.target) * 1.5, 0.85 * a);
    const eye = ctx.createRadialGradient(timeFx.x, timeFx.y, 0, timeFx.x, timeFx.y, R * 0.2);
    eye.addColorStop(0, `rgba(230,255,235,${a})`);
    eye.addColorStop(0.4, `rgba(80,255,140,${0.9 * a})`);
    eye.addColorStop(1, "rgba(0,200,90,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = eye;
    ctx.fillRect(timeFx.x - R * 0.2, timeFx.y - R * 0.2, R * 0.4, R * 0.4);
    ctx.restore();
  }

  // How far from now, and which way time is going.
  if (behind > 0.05 || timeFx.on) {
    const dir = !timeFx.on ? "▶▶" : timeFx.spin < -0.15 ? "◀◀" : timeFx.spin > 0.15 ? "▶" : "❚❚";
    ctx.save();
    ctx.font = `600 ${Math.round(H * 0.03)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(140,255,180,0.95)";
    ctx.shadowColor = "rgba(0,255,120,0.8)";
    ctx.shadowBlur = 12 * u;
    ctx.fillText(`${dir}  −${behind.toFixed(1)} s`, W - 24 * u, H * 0.09);
    ctx.restore();
  }
}

function resetTime() {
  timeFx.on = false;
  timeFx.lost = 0;
  timeFx.spin = 0;
  timeFx.prevAng = null;
  timeFx.k = 0;
  timeFx.target = Infinity;
  for (const slot of timeBuf) if (slot) slot.t = -1;
}

// `f`: rewinds three seconds, then lets time run back to now.
function triggerTime() {
  timeFx.target = Math.min(timeFx.target, timeFx.lastCap) - 3;
}

// ===========================================================================
// Demo stand-ins for the gags, fed through the same code paths as tracking
// ===========================================================================

// A plain fist-and-finger blob for the demo hands.
function demoBlob(x, y, m, rot, fingers) {
  fctx.save();
  fctx.fillStyle = fctx.strokeStyle = DEMO_SKIN;
  fctx.beginPath();
  fctx.ellipse(x, y, m * 0.045, m * 0.05, rot, 0, Math.PI * 2);
  fctx.fill();
  fctx.lineWidth = FINGER_W_M * m;
  fctx.lineCap = "round";
  for (const [a, l] of fingers) {
    fctx.beginPath();
    fctx.moveTo(x + Math.cos(a) * m * 0.03, y + Math.sin(a) * m * 0.03);
    fctx.lineTo(x + Math.cos(a) * m * l, y + Math.sin(a) * m * l);
    fctx.stroke();
  }
  fctx.restore();
}

// A finger gun on the right, swinging its aim and firing every 1.4 s.
function demoGuns(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const ang = Math.PI + 0.25 * Math.sin(t * 0.0007) - 0.15;
  const hx = w * 0.72, hy = h * 0.62;
  demoBlob(hx, hy, m, ang, [[ang, 0.11], [ang - Math.PI / 2.4, 0.06]]);
  let g = guns.get("demo");
  if (!g) {
    g = { on: true, cocked: false, last: -1, lift: null, liftT: 0, x: 0, y: 0, ang: 0,
          scale: m, atCam: false, flash: 0, smoke: 0, smokeAcc: 0 };
    guns.set("demo", g);
  }
  g.x = hx + Math.cos(ang) * m * 0.11;
  g.y = hy + Math.sin(ang) * m * 0.11;
  g.ang = ang;
  const shot = Math.floor(t / 1400);
  if (shot !== g.demoShot) { g.demoShot = shot; if (t > 500) fireGun(g); }
}

// A person-shaped silhouette, written into the frame and into the mask, so
// the dissolve has a body and a background plate to work with.
// A person-shaped silhouette with one hand up at (hx, hy), painted into the
// frame and written into the mask, for the effects that cut you out.
function demoPerson(t, handAt) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const cx = w * 0.42, sway = Math.sin(t * 0.0009) * w * 0.01;
  const body = (g) => {
    g.beginPath();
    g.ellipse(cx + sway, h * 0.33, m * 0.075, m * 0.095, 0, 0, Math.PI * 2);
    g.moveTo(cx + sway - m * 0.2, h * 1.02);
    g.bezierCurveTo(cx + sway - m * 0.21, h * 0.62, cx + sway - m * 0.12, h * 0.52, cx + sway, h * 0.52);
    g.bezierCurveTo(cx + sway + m * 0.12, h * 0.52, cx + sway + m * 0.21, h * 0.62, cx + sway + m * 0.2, h * 1.02);
    g.closePath();
    g.fill();
  };
  fctx.fillStyle = "#3a6ea5";
  body(fctx);
  fctx.fillStyle = DEMO_SKIN;
  fctx.beginPath();
  fctx.ellipse(cx + sway, h * 0.33, m * 0.075, m * 0.095, 0, 0, Math.PI * 2);
  fctx.fill();
  const { x: hx, y: hy, fingers } = handAt(cx + sway, m);
  demoBlob(hx, hy, m, -1.2, fingers);

  const mw = 160, mh = 90;
  if (maskCanvas.width !== mw || maskCanvas.height !== mh) { maskCanvas.width = mw; maskCanvas.height = mh; }
  maskCtx.setTransform(-mw / w, 0, 0, mh / h, mw, 0);   // mask space is unmirrored
  maskCtx.clearRect(0, 0, w, h);
  maskCtx.fillStyle = "#fff";
  body(maskCtx);
  maskCtx.beginPath();
  maskCtx.ellipse(hx, hy, m * 0.06, m * 0.07, 0, 0, Math.PI * 2);
  maskCtx.fill();
  maskCtx.setTransform(1, 0, 0, 1, 0, 0);
  maskImageData = maskCtx.getImageData(0, 0, mw, mh);
  maskReady = true;
  return { hx, hy, m };
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

// Two hands come together, charge, and shove — alternately sideways and at
// the camera.
function demoKame(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const c = t % 7000, n = Math.floor(t / 7000);
  const close = smoothstep(200, 900, c) * (1 - smoothstep(5600, 6200, c));
  const shove = smoothstep(3300, 3550, c);
  const atCam = n % 2 === 1;
  const cx = w * 0.4 + (atCam ? 0 : shove * w * 0.08), cy = h * 0.6;
  const sep = m * (0.16 - 0.12 * close);
  const palm = m * 0.095 * (1 + (atCam ? shove * 0.35 : 0));
  const a = { x: cx - sep, y: cy }, b = { x: cx + sep, y: cy };
  demoBlob(a.x, a.y, m * palm / (m * 0.095), 0.3, [[-1.3, 0.09], [-1.1, 0.095], [-0.9, 0.09]]);
  demoBlob(b.x, b.y, m * palm / (m * 0.095), -0.3, [[-1.85, 0.09], [-2.05, 0.095], [-2.25, 0.09]]);
  kameTrack({ a, b, palm }, t);
}

// A hand low on the left, thwipping every 2.6 s at a new angle.
function demoWeb(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const c = t % 2600, n = Math.floor(t / 2600);
  const hx = w * (0.25 + 0.5 * ((n * 0.37) % 1)), hy = h * 0.85;
  const a = -Math.PI / 2 + Math.sin(n * 1.7) * 0.6;
  const on = c > 300 && c < 1900;
  demoBlob(hx, hy, m, a, on ? [[a - 0.25, 0.1], [a + 0.35, 0.08]] : [[a, 0.05]]);
  webHand("demo", on ? { x: hx, y: hy, dx: Math.cos(a), dy: Math.sin(a), scale: m } : null, t);
}

// A fist that pops its claws, holds, slashes twice across, then sheathes.
function demoClaws(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const c = t % 4200;
  const swing = (k) => smoothstep(0, 1, k);
  // Rest low right; two fast swipes (0.12 s each) across the middle.
  let k = 0;
  if (c > 1400 && c < 1520) k = swing((c - 1400) / 120);
  else if (c >= 1520 && c < 2300) k = 1;
  else if (c >= 2300 && c < 2420) k = 1 - swing((c - 2300) / 120);
  const hx = w * (0.68 - 0.3 * k), hy = h * (0.62 - 0.12 * k);
  const rot = -0.5 - 0.6 * k;                // knuckles lean into the swing
  const pts = [];
  const ux = Math.cos(rot - Math.PI / 2), uy = Math.sin(rot - Math.PI / 2);
  const px = -uy, py = ux;
  pts[WRIST] = { x: hx - ux * m * 0.05, y: hy - uy * m * 0.05 };
  [INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP].forEach((i, j) => {
    const off = (j - 1.5) * m * 0.021;
    pts[i] = { x: hx + ux * m * 0.04 + px * off, y: hy + uy * m * 0.04 + py * off };
  });
  fctx.save();
  fctx.fillStyle = DEMO_SKIN;
  fctx.beginPath();
  fctx.ellipse(hx, hy, m * 0.05, m * 0.055, rot, 0, Math.PI * 2);
  fctx.fill();
  fctx.restore();
  if (c > 400 && c < 3400) clawPose("demo", pts, null, m, t);
  else { const cl = claws.get("demo"); if (cl) { cl.out = false; cl.trail.length = 0; } }
}

// The silhouette making Gojo's sign by its face: the domain opens early in
// each 14 s cycle and collapses near the end.
function demoVoid(t) {
  const { hx, hy, m } = demoPerson(t, (x, m) => ({
    x: x + m * 0.15, y: frame.height * 0.47, fingers: [[-1.62, 0.1], [-1.5, 0.1]] }));
  const c = t % 14000;
  const holding = (c > 500 && c < 1200) || (c > 10500 && c < 11200);
  voidSign(holding ? { x: hx + m * 0.01, y: hy - m * 0.1 } : null, t);
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

// The silhouette with both hands up in the sign at its chest: four clones
// early in each 11 s cycle, dispelled near the end.
function demoClones(t) {
  const { hx, hy } = demoPerson(t, (x, m) => ({
    x: x + m * 0.02, y: frame.height * 0.6, fingers: [[-1.75, 0.09], [-1.4, 0.09]] }));
  const c = t % 11000;
  const holding = (c > 500 && c < 1100) || (c > 8000 && c < 8600);
  cloneSign(holding ? { x: hx, y: hy } : null, t);
}

// A pointing hand that traces a circle early in each 12 s cycle (a portal
// opens), then traces over it near the end (it closes).
function demoStrange(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const c = t % 12000;
  const cx = w * 0.6, cy = h * 0.42, r = h * 0.17;
  let k = -1;
  if (c > 400 && c < 2200) k = (c - 400) / 1500;
  else if (c > 8000 && c < 9800) k = (c - 8000) / 1500;
  if (k < 0) { strangeTrack(null, m, t); return; }
  const a = -Math.PI / 2 + Math.min(k, 1.15) * Math.PI * 2;
  const tip = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  demoBlob(tip.x, tip.y + m * 0.1, m, 0, [[-Math.PI / 2, 0.1]]);
  strangeTrack(tip, m, t);
}

// The stand-in face "says" three lines in turn, word by word as live
// recognition would deliver them; the last one is shouted.
const DEMO_SAYINGS = [["Wait, is this thing on?", false], ["Hey! I'm in a comic now", false],
                      ["This is amazing", true]];
function demoBubbles(t) {
  const c = t % 15000, i = Math.floor(c / 5000), k = c % 5000;
  const [line, shout] = DEMO_SAYINGS[i], words = line.split(" ");
  let key = null, text = null, fin = false;
  if (k > 300 && k < 2300) {
    const n = Math.max(1, Math.ceil((k - 300) / 2000 * words.length));
    key = `${Math.floor(t / 15000)}-${i}-${n}`;
    text = words.slice(0, n).join(" ");
  } else if (k >= 2300) {
    key = `${Math.floor(t / 15000)}-${i}-final`;
    text = line;
    fin = true;
  }
  if (key && key !== speech.demoKey) {
    speech.demoKey = key;
    speech.now = t / 1000;
    bubbleSay(text, fin, { shout });
  }
}

// Both hands raised: it charges, is thrown down and lands, every 10 s.
function demoBomb(t) {
  const w = frame.width, h = frame.height, m = h / 0.55, palm = m * 0.095;
  const c = t % 10000;
  if (c < 400 || c > 6200) { bombTrack(null, t); return; }
  const drop = smoothstep(4600, 4750, c);
  const y = h * (0.28 + 0.45 * drop);
  const a = { x: w * 0.36, y }, b = { x: w * 0.5, y };
  for (const p of [a, b]) {
    demoBlob(p.x, p.y + palm * 0.4, m, 0, [[-1.85, 0.09], [-1.65, 0.1], [-1.45, 0.1], [-1.25, 0.09]]);
  }
  bombTrack({ a, b, palm }, t);
}

// An open hand that stops time, twists it back, holds, runs it forward a
// little and lets go, every 12 s.
function demoTime(t) {
  const w = frame.width, h = frame.height, m = h / 0.55;
  const c = t % 12000;
  if (c < 1500 || c > 8000) { timeTrack(null, t); return; }
  const twist = -2.6 * smoothstep(2000, 4500, c) + 1.0 * smoothstep(5500, 6500, c);
  const ang = -Math.PI / 2 + twist, x = w * 0.72, y = h * 0.55;
  demoBlob(x, y, m, ang + Math.PI / 2,
           [[ang - 0.35, 0.1], [ang - 0.12, 0.11], [ang + 0.12, 0.105], [ang + 0.35, 0.09]]);
  timeTrack({ x, y, palm: m * 0.095, ang }, t);
}

// Laser eyes on the stand-in face, sweeping its gaze side to side.
function demoLaser(t, face) {
  if (!face) return;
  const { x, y, m } = face;
  const yaw = 0.14 * Math.sin(t * 0.0008), pitch = 0.05 * Math.sin(t * 0.0013);
  const eyes = [{ x: x - m * 0.03, y: y - m * 0.02 }, { x: x + m * 0.03, y: y - m * 0.02 }];
  applyEyes(eyes, { x: x + yaw * m * 0.15, y: y + m * 0.015 + pitch * m * 0.15 },
            { x: x + m * 0.075, y }, { x: x - m * 0.075, y }, (t % 7000) < 5200 ? 1 : 0);
}

// Never called: the frame-less effects draw through their render functions,
// outside the frame. This keeps EFFECT_FNS index-aligned with EFFECTS.
function fxOverlay() {}

const DEMO_SKIN = "#d9a27e";

// Demo stand-ins for the camera, painted onto the frame and fed through the
// same code paths as live tracking: a face whose mouth opens and shuts...
function demoFace(t) {
  const w = frame.width, h = frame.height;
  const m = h / 0.55;                       // pixels per metre

  // Swaying, so whatever comes out of the mouth has to follow a moving head.
  const fcx = w * 0.4 + Math.sin(t * 0.0021) * w * 0.025, fcy = h * 0.4;
  fctx.fillStyle = DEMO_SKIN;
  fctx.beginPath();
  fctx.ellipse(fcx, fcy, m * 0.075, m * 0.098, 0, 0, Math.PI * 2);
  fctx.fill();
  fctx.fillStyle = "#2a1f1c";
  for (const sx of [-1, 1]) {
    fctx.beginPath();
    fctx.arc(fcx + sx * m * 0.03, fcy - m * 0.02, m * 0.007, 0, Math.PI * 2);
    fctx.fill();
  }
  const open = Math.max(0, Math.sin(t * 0.0011));
  const mw = m * 0.05, gap = m * 0.028 * open;
  const my = fcy + m * 0.045;
  fctx.fillStyle = "#4a1f22";
  fctx.beginPath();
  fctx.ellipse(fcx, my, mw * 0.4, Math.max(m * 0.003, gap / 2), 0, 0, Math.PI * 2);
  fctx.fill();
  // Same winding as LIPS_INNER: left corner, over the top, right corner, back.
  const poly = [];
  for (let k = 0; k < 20; k++) {
    const a = Math.PI + k * Math.PI / 10;
    poly.push({ x: fcx + Math.cos(a) * mw * 0.4, y: my + Math.sin(a) * gap / 2 });
  }
  applyMouth({ x: fcx, y: my - gap / 2 }, { x: fcx, y: my + gap / 2 },
             { x: fcx - mw / 2, y: my }, { x: fcx + mw / 2, y: my }, poly);
  return { x: fcx, y: fcy, m };
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

const EFFECT_FNS = [fxPixelate, fxBlur, fxNoir, fxGlitch, fxMatrix, fxPortal,
                    fxOverlay, fxOverlay, fxOverlay, fxOverlay, fxOverlay,
                    fxOverlay, fxOverlay, fxOverlay, fxOverlay, fxOverlay, fxOverlay,
                    fxOverlay, fxOverlay, fxPolaroid, fxOverlay, fxOverlay];


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
  // The frame-less effects overlay the whole feed, so the frame is switched
  // off for them.
  const fxName = EFFECTS[effectIndex];
  const smokeFx = fxName === "Smoke";
  const overlayFx = OVERLAY_FX.has(fxName);
  const faceFx = FACE_FX.has(fxName);
  const gag = GAGS[fxName];
  let overlaySeen = false;

  // 1. Refresh the frame canvas (mirrored camera or demo scene)
  if (demoMode) {
    drawDemoScene(t);
    const face = faceFx ? demoFace(t) : null;
    if (smokeFx) { demoHand(t); demoLighter(t); }
    if (gag) gag.demo(t, face);
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
    raw = (!overlayFx && Math.sin(t * 0.0002) > -0.85) ? demoQuad(t) : null;
  } else if (landmarker && cameraReady && video.readyState >= 2) {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const res = landmarker.detectForVideo(video, t);
      if (overlayFx) {
        if (smokeFx) updateSmokeHands(res);
        if (gag && gag.hands) gag.hands(res, t);
        if (faceFx && faceState === "ready") {
          const face = faceLandmarker.detectForVideo(video, t);
          updateMouth(face);
          if (gag && gag.face) gag.face(face, t);
        }
        overlaySeen = !!(res.landmarks && res.landmarks.length) || mouth.seen;
      } else {
        raw = computeQuad(res.landmarks);
      }
      // Twisting time or holding up a Spirit Bomb must not also swipe.
      const swiped = detectSwipe(res.landmarks, t);
      const swipe = (timeFx.on && fxName === "Time Stone") || (bomb.up && fxName === "Spirit Bomb") ? null : swiped;
      if (swipe === "right" || swipe === "left") {
        setEffect(effectIndex + (swipe === "right" ? 1 : -1));
        flashStatus(`${swipe === "right" ? "▶" : "◀"} ${EFFECTS[effectIndex]}`);
      } else if (swipe) {
        // Vertical slides walk the current effect's sub-option, so the two
        // axes read as "which effect" and "which variant of it".
        const name = EFFECTS[effectIndex];
        if (name === "Portal") {
          portalScene = (portalScene + (swipe === "up" ? 1 : -1) +
            PORTAL_SCENES.length) % PORTAL_SCENES.length;
          refreshChips();
          flashStatus(`Portal → ${PORTAL_SCENES[portalScene]}`);
        } else if (name === "Strange Portal") {
          // Changes the world through the open portal, and the next one's.
          const n = STRANGE_WORLDS.length, step = swipe === "up" ? 1 : -1;
          const open = strange.portals.find((p) => !p.closing);
          if (open) open.world = (open.world + step + n) % n;
          strange.world = ((open ? open.world : strange.world) + (open ? 1 : step) + n) % n;
          flashStatus(`Portal → ${STRANGE_WORLDS[open ? open.world : strange.world]}`);
        } else if (name === "Matrix") {
          keepPerson = !keepPerson;
          flashStatus(keepPerson ? "Matrix rain behind you" : "Matrix rain in front");
          if (keepPerson) ensureSegmenter();
        } else {
          flashStatus(`${EFFECTS[effectIndex]} has no variants`);
        }
      }
      // Only segment when an effect actually needs the person mask.
      if (wantsMask(EFFECTS[effectIndex]) && segState === "ready") {
        segmenter.segmentForVideo(video, t, writeMask);
      }
    } else if (smoothQuad) {
      raw = null; // no new video frame; treat as a (buffered) dropout
    }
  }
  updateQuadState(raw);
  // Dials come off the smoothed quad, not the popped-in one: the pop is a
  // presentation flourish and would otherwise read as someone yanking the
  // size dial every time a frame appears.
  const framed = presence > 0.01 && smoothQuad;
  updateKnobs(framed ? smoothQuad : null);
  refreshKnobReadout(!!framed);

  if ((raw || overlaySeen) && !announcedTracking && !demoMode) {
    announcedTracking = true;
    setStatus(null);
  }

  // 3. Composite
  ctx.imageSmoothingEnabled = true;
  if (shake > 0.5) {
    // Kick: the feed is drawn a little oversized and jolted inside it.
    const a = Math.random() * Math.PI * 2;
    ctx.drawImage(frame, -shake + Math.cos(a) * shake, -shake + Math.sin(a) * shake,
                  canvas.width + 2 * shake, canvas.height + 2 * shake);
  } else {
    ctx.drawImage(frame, 0, 0);
  }
  shake *= 0.86;

  if (!overlayFx && presence > 0.01 && smoothQuad) {
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

      drawGlassEdge(q, ease);
      drawBrackets(q, ease);
    }
  }

  if (smokeFx) renderSmoke(t);
  else if (fxName === "Rainbow") renderRainbow(t);
  else if (gag) gag.render(t);
  else if (fxName === "Polaroid") renderPolaroid(t);
}
