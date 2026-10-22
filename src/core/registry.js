// The effect contract. Every effect is one module whose default export is
// `defineEffect({...})`, listed once in src/effects/index.js. Nothing else in
// the app names a particular effect: the chips, keys, swipes, model loading
// and per-frame calls are all driven from the fields below.
//
//   id        "kebab-case", unique. `?fx=<id>` starts on it.
//   name      what the chip and the status line call it.
//   kind      "frame"   — drawn inside the quad your two hands make.
//             "overlay" — no frame; works on the whole feed (gestures, face).
//   hint      status text shown when it is selected (optional for "frame").
//   needs     { face: true } loads the face tracker; { mask: true } (or a
//             function returning a boolean) loads the person segmenter.
//
// Per-frame hooks (all optional; `t` is the frame time in ms):
//   draw(box, t)     "frame" effects: paint into `ctx`, already clipped to the
//                    quad. box = { x, y, w, h, quad } in canvas pixels.
//   hands(res, t)    a new hand-tracker result (MediaPipe HandLandmarker).
//   face(res, t)     a new face-tracker result, when needs.face is set.
//   demo(t, face)    `?demo` stand-in for the camera: paint into `fctx` and
//                    drive your state the way hands()/face() would.
//   render(t)        every frame, after the feed (and frame) are composited.
//
// Lifecycle and input (all optional):
//   enter()          it was just selected.
//   reset()          another effect was selected: drop transient state.
//                    Called for every non-selected effect, so keep it cheap.
//   trigger()        the `f` key: fire it without the gesture.
//   cycle(step)      next/previous variant (slide up/down, or press the
//                    effect's key again). Return the status text to flash.
//   chipLabel()      the chip's text, if it should show more than the name.
//   onKey(key)       any other key (lower-cased); return true if handled.
//   onClick(x, y)    a click on the stage, canvas px; true if handled.
//   locksSwipe()     true while a gesture of yours looks like a swipe and
//                    must not change the effect (e.g. Spirit Bomb's throw).

const KINDS = ["frame", "overlay"];
const HOOKS = ["draw", "hands", "face", "demo", "render", "enter", "reset", "trigger",
               "cycle", "chipLabel", "onKey", "onClick", "locksSwipe"];
const FIELDS = new Set(["id", "name", "kind", "hint", "needs", ...HOOKS]);

export function defineEffect(spec) {
  const where = `defineEffect(${spec && (spec.id || spec.name) ? JSON.stringify(spec.id || spec.name) : "?"})`;
  if (!spec || typeof spec !== "object") throw new TypeError(`${where}: expected an object`);
  if (typeof spec.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(spec.id)) {
    throw new TypeError(`${where}: id must be kebab-case, like "my-effect"`);
  }
  if (typeof spec.name !== "string" || !spec.name) throw new TypeError(`${where}: name is required`);
  if (!KINDS.includes(spec.kind)) throw new TypeError(`${where}: kind must be "frame" or "overlay"`);
  if (spec.kind === "frame" && typeof spec.draw !== "function") {
    throw new TypeError(`${where}: a "frame" effect needs draw(box, t)`);
  }
  if (spec.kind === "overlay" && typeof spec.render !== "function") {
    throw new TypeError(`${where}: an "overlay" effect needs render(t)`);
  }
  for (const k of Object.keys(spec)) {
    if (!FIELDS.has(k)) throw new TypeError(`${where}: unknown field "${k}"`);
  }
  for (const k of HOOKS) {
    if (spec[k] !== undefined && typeof spec[k] !== "function") {
      throw new TypeError(`${where}: ${k} must be a function`);
    }
  }
  const needs = spec.needs || {};
  return Object.freeze({ ...spec, needs: Object.freeze({ face: !!needs.face, mask: needs.mask || false }) });
}

// Effects 1-10 are the number row (0 is the tenth), then the keyboard's top
// row left to right, then the rows below. Skipped: f (trigger), k, l and s,
// which effects use for their own actions, and m (mute). Effects past the end
// of the pool have no key but are still on the chips, the arrows and the swipe.
const KEY_POOL = [..."1234567890qwertyuiopadghjzxcvbn"];

export function buildRegistry(list) {
  const ids = new Set(), names = new Set();
  return list.map((fx, i) => {
    if (!fx || !fx.id || !Object.isFrozen(fx)) {
      throw new TypeError(`effects/index.js entry ${i + 1} is not a defineEffect(...) result`);
    }
    if (ids.has(fx.id)) throw new Error(`Two effects share the id "${fx.id}"`);
    if (names.has(fx.name)) throw new Error(`Two effects share the name "${fx.name}"`);
    ids.add(fx.id);
    names.add(fx.name);
    return { fx, key: KEY_POOL[i] || null };
  });
}
