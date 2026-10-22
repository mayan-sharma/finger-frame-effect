# Writing an effect

An effect is one JavaScript file in `src/effects/`. It imports what it needs
from `src/api.js`, and its default export is `defineEffect({...})`. Listing
it in `src/effects/index.js` gives it a chip, a keyboard key, a place in the
swipe order, and a smoke test. No build step, no framework.

Every built-in effect follows exactly this pattern and imports only from
`api.js`, so any of them is a working example to learn from.

## Quickstart

```sh
npm install           # once: the test runner (the app has no dependencies)
npm start             # http://localhost:8123
```

1. Copy a template and give it your own `id` and `name`:
   - `src/effects/_template-frame.js`: draws inside the finger frame (Night Vision).
   - `src/effects/_template-overlay.js`: driven by a hand pose, no frame (Fireflies).
2. Open `http://localhost:8123/?try=<your-file>&demo`. `?try` loads a file
   that isn't in `index.js` yet and starts on it. `&demo` paints a synthetic
   scene, so you don't need a camera. Drop `&demo` to use your hands.
3. Edit, then reload. The dev server turns caching off, so the change shows
   up straight away. Errors show in the status pill at the top, and in full
   in the console.
4. Add an import and an entry to `src/effects/index.js`.
5. Run `npm test`. It runs every listed effect in headless Chrome, both in
   demo mode and on scripted fake hand tracking.

## Two kinds of effect

| `kind` | What you get | You implement | Examples |
| ------ | ------------ | ------------- | -------- |
| `"frame"` | Shown while both hands hold up the "L" frame. `ctx` is already clipped to the frame and faded in with it. | `draw(box, t)` | Pixelate, Noir, Portal, Polaroid |
| `"overlay"` | No frame. You get the tracker results and draw on the whole stage. | `render(t)`, usually with `hands()` or `face()` | Finger Guns, Laser Eyes, Spirit Bomb |

## The contract

All fields except `id`, `name`, `kind`, and the one required hook are
optional. `src/core/registry.js` is the source of truth. It validates every
effect when the page loads, so a typo shows up as a readable error instead
of a blank screen.

| Field | Meaning |
| ----- | ------- |
| `id` | kebab-case and unique. `?fx=<id>` starts on it. |
| `name` | The text on the chip and in the status pill. |
| `kind` | `"frame"` or `"overlay"`, as above. |
| `hint` | Status text flashed when the effect is selected. Overlay effects should always have one: it is the only instruction the user gets. |
| `needs.face` | `true` loads the face tracker and keeps `mouth` up to date. |
| `needs.mask` | `true` (or a function returning a boolean) loads the person segmenter, which fills `maskCanvas`. |

| Hook | When it runs |
| ---- | ------------ |
| `draw(box, t)` | Frame effects, every frame the frame is up. `box = { x, y, w, h, quad }` in canvas px. |
| `hands(res, t)` | Overlay effects, on each new camera frame. `res` is MediaPipe's HandLandmarker result; `trackedHands(res, t)` turns it into something friendlier. |
| `face(res, t)` | Overlay effects with `needs.face`, on each new camera frame, after `mouth` is updated. |
| `demo(t, face)` | `?demo` only, before anything is drawn. Paint a stand-in into `fctx` (see `demoBlob`, `demoPerson`) and drive your state the way `hands()` would. `face` is the stand-in face `{ x, y, m }` when `needs.face` is set. |
| `render(t)` | Every frame, after the camera feed (and the frame) are on the stage. |
| `enter()` | Your effect was just selected. |
| `reset()` | Another effect was selected. Drop transient state. It runs for every non-selected effect on each switch, so keep it cheap and idempotent. |
| `trigger()` | The `f` key: fire the effect without the gesture. Good for demos, and for people whose hands the tracker struggles with. |
| `cycle(step)` | Next or previous variant: an up/down slide, ArrowUp/ArrowDown, or pressing the effect's key again. `step` is `1` or `-1`. Return the status text to flash. |
| `chipLabel()` | The chip's text, if it should show more than the name (Portal shows its current world). |
| `onKey(key)` | Any other key, lower-cased. Return `true` if you handled it. Only the live effect sees keys, so `k`, `l` and `s` are free to reuse. `f` is the trigger, and digits and most letters switch effects. |
| `onClick(x, y)` | A click on the stage, in canvas px. Return `true` if handled; otherwise the click moves to the next effect. |
| `locksSwipe()` | Return `true` while your own gesture could look like a swipe, so it doesn't change the effect mid-move. Time Stone's twist and Spirit Bomb's throw use this. |

`t` is the frame time in milliseconds. For per-frame physics, call
`gagClock(t)` once in `render`: it returns the seconds since the last frame,
capped so a background tab doesn't teleport everything.

### What happens in a frame

1. The camera image (or the demo scene) is drawn into `frame`. In demo mode,
   `demo(t, face)` runs here.
2. On a new camera frame: overlay effects get `hands()`, then `face()`. Frame
   effects get the quad computed instead. Swipes are checked, and the person
   mask is updated if any effect needs it.
3. The frame's dials (`knobs`) are updated.
4. The feed is drawn onto the stage, shaken if anything called `shakeScreen`.
5. Frame effects: `draw(box, t)` runs inside the clip, then the glass edge and
   corner brackets are drawn over it.
6. `render(t)`.

## The API

`src/api.js` is the whole surface, with a comment on every group. In short:

- **Canvases.** `ctx` is the stage you draw on. `frame` is this frame's
  mirrored camera image, at stage size: read from it. `fctx` paints into it.
  `makeScratch()` / `sizeScratch()` give you reusable offscreen canvases.
- **The frame as four dials.** `knobs.size` (0..1, hands apart), `tilt`
  (-1..1), `aspect` (-1..1), and `punch` (0..1, a fast squeeze that then
  decays). Frame effects should read at least one: it's what makes the
  frame feel like an instrument rather than a stencil. `smoothQuad` and
  `presence` are the frame itself.
- **Hands.** Landmark indices (`WRIST`, `INDEX_MCP`, ...), `trackedHands`,
  `fingerUp`, `fingerDown`, `openCount`, `palmCentre`, `handPxPerMetre`.
- **Face.** `mouth`: `{ seen, latched, open, x, y, w, dir, poly, ... }`.
- **Person mask.** `maskCanvas`, `drawPersonOver`, `drawVoidPerson`,
  `drawMaskSpace`, `maskAvailable`.
- **Kits.** `spill` (light on the room), `filmGrain`, `titleCardAt`, sparks,
  `shakeScreen`, smoke particles, comic pops, Portal's scenes.
- **Sound.** `playSound(name, { pan, pitch, volume, duration })` for a
  one-shot, `hum(name, level)` every frame for a held sound (a charge, a
  laser). All synthesized: see the Sound section of `api.js` for the names.
- **Page.** `demoMode`, `urlParams` (for your own options), `flashStatus`.

Effects import only from `api.js`, never from `core/` or `lib/` directly.
That keeps the API one documented file, and lets the internals change
without breaking your effect. If you need something that isn't exported,
say so in your PR: adding it to `api.js` is usually the right fix.

## Recipes

### Read the dials (frame effect)

```js
import { ctx, defineEffect, frame, knobs } from "../api.js";

function draw({ x, y, w, h }) {
  // Open the frame for more saturation; tilt it to turn the hue.
  ctx.filter = `saturate(${1 + 3 * knobs.size}) hue-rotate(${knobs.tilt * 180}deg)`;
  ctx.drawImage(frame, x, y, w, h, x, y, w, h);
  ctx.filter = "none";
}

export default defineEffect({ id: "candy", name: "Candy", kind: "frame", draw });
```

### A pose with hysteresis, and a trigger (overlay effect)

Tracking jitters, so a pose test that flips at one threshold flickers on and
off. Use two thresholds: easy to stay in, hard to get into. `fingerUp` and
`fingerDown` take a `latched` flag for exactly this.

```js
import { defineEffect, fingerDown, fingerUp, INDEX_MCP, MIDDLE_MCP,
  PINKY_MCP, RING_MCP, trackedHands } from "../api.js";

const state = { on: false, lost: 0, x: 0, y: 0 };

function isPointing(w, latched) {
  return fingerUp(w, INDEX_MCP, latched) && fingerDown(w, MIDDLE_MCP, latched) &&
         fingerDown(w, RING_MCP, latched) && fingerDown(w, PINKY_MCP, latched);
}

function hands(res, t) {
  const hand = trackedHands(res, t).find((h) => isPointing(h.w, state.on));
  if (!hand) { if (++state.lost > 6) state.on = false; return; }  // ride out dropouts
  state.on = true;
  state.lost = 0;
  ({ x: state.x, y: state.y } = hand.pts[8]);    // index fingertip, canvas px
}
```

Measure distances on the hand in palm lengths (`h.palm`), and sizes in metres
(`h.scale` is pixels per metre). Then the effect behaves the same at any
distance from the camera.

### Use the face

Set `needs: { face: true }` and read `mouth`. It's updated before your hooks
run, including in demo mode, where a stand-in face opens and closes its mouth.
Rainbow is the smallest example. For anything beyond the mouth, implement
`face(res, t)` and read MediaPipe's `res.faceLandmarks[0]` (478 points) and
`res.faceBlendshapes`, as Laser Eyes does.

### Cut the person out

Set `needs: { mask: true }`, draw your scene, then put the person back on top
with `drawPersonOver(x, y, w, h)` (Portal) or `drawVoidPerson(color)`
(Infinite Void, Time Stone). In demo mode, call `demoPerson(t, handAt)` from
your `demo` hook to paint a silhouette and a matching mask.

### Variants and options

```js
let mode = urlParams.get("mode") === "dark" ? 1 : 0;   // ?mode=dark starts there
const MODES = ["Light", "Dark"];

export default defineEffect({
  // ...
  cycle(step) {
    mode = (mode + step + MODES.length) % MODES.length;
    return `My Effect → ${MODES[mode]}`;
  },
  chipLabel: () => `My Effect · ${MODES[mode]}`,
});
```

## Conventions

- **Everything lives in your file.** Constants at the top, with a comment
  saying what each one is in real units. Then state, functions, and the
  `defineEffect` at the bottom. Module-level state is fine, because only one
  effect is live at a time.
- **No allocation per frame.** Make scratch canvases once, at module level,
  with `makeScratch()`, and size them each frame with `sizeScratch()`. Reuse
  particle arrays. The whole app has one frame budget (16 ms).
- **Scale with the screen.** Multiply line widths and pixel sizes by
  `unit()` (canvas px per 900 px of screen height), or derive them from the
  hand's scale.
- **Give it a `demo` hook.** With one, the effect works in `?demo`, can be
  seen without a camera, and gets real coverage from `npm test`.
- **Give the big moment a sound.** A launch, a hit, a snap. Pass `pan:` the
  x where it happens. Leave quiet effects quiet.
- **Give overlay effects a `hint` and a `trigger`.** The hint is the only
  instruction anyone gets. The trigger makes the effect usable when the
  gesture is hard.
- **Comments say why**, not what: the threshold that was measured, the
  shortcut that looked right but wasn't.

## Testing

- `?demo&fx=<id>` (or `?demo&try=<file>`) is the quickest visual check.
- `npm test` runs every listed effect (and both templates) headless, twice:
  once in demo mode, and once on scripted fake tracking (`test/fake-vision.js`).
  The scripted hands walk through the poses the built-ins react to: the L
  frame, a finger gun, a snap, palms together, a fist, crossed fingers, a
  circle drawn in the air, raised open hands, a twisted palm, and swipes.
  It presses `f` part way through. Any exception or console error fails the run.
  `npm test -- <id>` runs just one effect.
- The thresholds still need real hands. Before you open a PR, try the effect
  on a camera, ideally in more than one light.

## Before you open a PR

- [ ] It's one file in `src/effects/`, plus one line in `index.js`.
- [ ] It imports only from `../api.js`.
- [ ] `npm test` passes.
- [ ] Tried with real hands (and a real face, if it uses one).
- [ ] A frame effect reads at least one dial; an overlay effect has a
      `hint`, a `demo` and a `trigger`.
- [ ] A short GIF or screenshot in the PR description.
