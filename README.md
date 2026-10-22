# Finger Frame Effect

Hand-tracked webcam effects that run entirely in your browser. Hold both hands
up in an open "L", like a director framing a shot, and the box between your
fingertips becomes a live effect window. Or put the frame down and use your
hands and face instead: charge a Kamehameha, snap half of yourself to dust,
draw a portal in the air, talk in comic bubbles.

**[Try it live](https://mayan-sharma.github.io/finger-frame-effect/)**. It
needs a webcam; add `?demo` to try it without one.

- **22 effects**: 7 inside the frame, 15 driven by hand poses or your face.
- **No build step, no install.** Plain ES modules and MediaPipe from a CDN.
- **Adding an effect is one file.** See [Writing an effect](docs/EFFECTS.md).

Inspired by [sophiamyang/finger-frame-effect](https://github.com/sophiamyang/finger-frame-effect).

## Run it locally

The camera only works on `localhost` or HTTPS, and ES modules need a server,
so serve the folder:

```sh
npm start                      # Node 18+; or: python3 -m http.server 8123
# open http://localhost:8123
```

`npm start` turns caching off. With Python's server, hard-reload after
editing a file, or the browser may keep running the old module.

No camera handy? `http://localhost:8123/?demo` paints a synthetic scene with
stand-in hands and faces, and every effect works on it.

URL options (they combine):

| Param | Does |
| ----- | ---- |
| `?demo` | Synthetic scene instead of the camera |
| `?fx=portal` | Start on an effect, by id or by number (`?fx=6`) |
| `?try=my-effect` | Load `src/effects/my-effect.js` without listing it, and start on it |
| `?scene=1` | Portal's starting world (0 to 2) |
| `?keepPerson` | Matrix rain behind you rather than in front |
| `?lang=hi-IN` | Speech Bubbles' language (any BCP 47 tag) |

## Add your own effect

```sh
cp src/effects/_template-frame.js src/effects/my-effect.js    # or _template-overlay.js
npm start
# open http://localhost:8123/?try=my-effect&demo, then edit and reload
```

Change the `id` and `name`, make it yours, then add one line to
`src/effects/index.js` and run `npm test`. [docs/EFFECTS.md](docs/EFFECTS.md)
covers the API, recipes for poses, faces and the person mask, and the
conventions. [CONTRIBUTING.md](CONTRIBUTING.md) covers the rest.

## Controls

| Key | Effect |
| --- | ------ |
| 1 | Pixelate |
| 2 | Blur: frosted glass |
| 3 | Noir: film grain and vignette; tilt warms it to sepia |
| 4 | Glitch |
| 5 | Matrix: press again to put the rain behind you |
| 6 | Portal: press again to cycle scenes (Space / Synthwave / Sunset) |
| 7 | Smoke (no frame): two fingers hold a cigarette, a thumbs-up lights it, an open mouth exhales |
| 8 | Rainbow (no frame): open your mouth and a rainbow pours out |
| 9 | Finger Guns (no frame): 👉 thumb up, drop the thumb (or flick) to fire |
| 0 | Snap (no frame): snap your fingers and you turn to dust |
| q | Kamehameha (no frame): cup both hands to charge, shove to fire |
| w | Web (no frame): 🤟 thwip to shoot a web onto the glass |
| e | Laser Eyes (no frame): raise your eyebrows, turn your head to aim |
| r | Claws (no frame): make a fist and three claws pop out; swing to slash |
| t | Infinite Void (no frame): hold Gojo's crossed-finger sign for a Domain Expansion |
| y | Hollow Purple (no frame): blue and red orbs over your hands; fuse them, then thrust |
| u | Shadow Clone (no frame): both hands in the two-finger sign; four clones of you poof in |
| i | Strange Portal (no frame): draw a circle in the air with your index finger; a sparking portal opens |
| o | Speech Bubbles (no frame): talk, and your words appear in a comic bubble beside your head |
| p | Polaroid: the frame is a camera; squeeze it to take a shot, which prints, develops and lands in a pile |
| a | Spirit Bomb (no frame): raise both open hands to gather light, throw them down |
| d | Time Stone (no frame): an open palm stops time; twist it like a dial to rewind |

← / → or clicking the canvas cycle effects. ↑ / ↓, or pressing the current
effect's key again, step its variant (Portal's world, Matrix front/behind,
Strange Portal's world). On the frame-less effects, `f` fires the current one
without the gesture. `k` toggles the Matrix rain, `l` lights Smoke's
cigarette, and `s` saves the newest Polaroid.

## The frame is a knob

The quad used to be a stencil and nothing else — it said *where* an effect
drew and never *how*, so every effect ran at one fixed setting forever. But
your hands are already holding three continuous values, and the box's
geometry is now normalized into four dials that every effect reads:

| Dial | Range | You do this | It means |
| ---- | ----- | ----------- | -------- |
| **size** | 0…1 | open or close the frame | how much |
| **tilt** | −1…1 | rotate the frame | which angle, or which hue |
| **aspect** | −1…1 | squash it wide or tall | a second axis |
| **punch** | 0…1 | squeeze *fast* | a transient hit that then decays |

The meaning is deliberately the same everywhere, so learning it on one effect
transfers to the rest. A readout in the top-left corner shows all four while a
frame is up, because a dial you cannot see is a dial you cannot learn.

| Effect | size | tilt | punch |
| ------ | ---- | ---- | ----- |
| Pixelate | block size | | |
| Blur | focus | hue | |
| Noir | contrast | sepia warmth | |
| Glitch | severity | | tear burst |
| Matrix | rain density | | shoves the rain down |
| Portal | how fast the other world runs | | |

Everything is smoothed: raw fingertip geometry jitters by a few pixels a
frame, and an unsmoothed dial makes the effect buzz. Punch is the derivative
of size, which is what makes it read as a *hit* rather than as another
position dial — a slow squeeze does nothing, a fast one fires it.

### Slide gestures

With **one open hand** up, sweep it:

| Slide | Does |
| ----- | ---- |
| ← / → | Previous / next effect |
| ↑ / ↓ | Cycle the current effect's variant: Portal's scene, Matrix front/behind, or Strange Portal's world |

(The other effects have no variant axis; they are steered by the frame's own
geometry instead — see **The frame is a knob** above.)

It gates on an open hand (three or more fingers extended, measured from the
landmarks rather than a model label, since a swiping hand is motion blurred),
ignores the first 250 ms after a hand appears so raising it into frame
doesn't count, requires one axis to clearly beat the other so a diagonal wave
does nothing, and only fires once per 700 ms. Two hands up is the framing
pose, so slides are one-handed only.

### Polaroid

Effect `p` turns the frame into a camera.

- **Frame a shot** and the frame becomes a viewfinder, with thirds lines and focus corners.
- **Take it** by squeezing the frame fast (the punch dial), like pressing a shutter. There is no self-timer: a photo only happens when you squeeze, or press `f`.
- **The print** is straightened from the frame's tilt, so a tilted frame still gives an upright photo. It gets an instant-film grade (warm, slightly faded, vignetted) and a card with a deep bottom strip and the date in marker.
- It flies from the frame to a pile in the corner and **develops** over 5 s, coming up out of a murky grey-green, cool first and full colour last.
- **Save** the newest print as a PNG by clicking the pile or pressing `s`. `f` takes a shot without the gesture.

### Matrix and Portal

**Matrix** fills the frame with digital rain, in front of you by default.
Press `k` and selfie segmentation cuts you out so the rain falls behind you
instead.

**Portal** keeps you real and replaces the world behind you with an animated
scene. Both it and `k`-mode need the camera, so demo mode shows scenes only.

### Smoke — the one effect with no frame

Select it (`7`) and the two-hand frame is switched off. Instead:

| You do this | You get |
| ----------- | ------- |
| Hold up **two fingers** (index + middle, ring + pinky curled) | A cigarette pinched between them — unlit |
| **Thumbs-up** with your other hand | Your thumb is a lighter: sparks, then a flame off the tip |
| Hold the flame on the cigarette's tip | The tip warms, then catches with a puff; a thread of smoke rises off it |
| **Open your mouth** (once it is lit) | You exhale a plume — dense at first, thinning as the breath runs out |
| Bring the filter to your lips | The ember flares, like taking a drag |

No smoke without fire: until it is lit, an open mouth only gets a hint to
light it. `l` lights or stubs it out by hand, for when a second hand is not
free. Put the cigarette away for six seconds and the next one is fresh.

- **The pose** is read from the hand tracker's metric 3D landmarks: a finger
  is "up" when its first bone and the rest of it point the same way. That
  holds for a finger aimed at the camera, where a 2D test calls it curled.
  The thumb is ignored, so a peace sign and a relaxed smoker's hold both count.
- **"Between the fingers"** is an occlusion trick. The cigarette is drawn on
  its own layer, then the index finger is erased out of that layer, so the
  camera's own pixels show through: it passes *behind* the index finger while
  its filter end sits in front of the middle one.
- **The lighter** is a fist with the thumb out: four fingers curled, and the
  thumb tip at least half a palm length from the index finger's middle joint.
  The flame always burns upward on screen whichever way the thumb points, and
  leans back against the hand's motion. The cigarette catches once its tip has
  sat in the body of the flame for about a third of a second.
- **Scale** comes from the hand's measured pixels-per-metre, so the cigarette
  keeps real-world proportions (9 cm long) at any distance.
- **The mouth** comes from MediaPipe Face Landmarker, loaded only when Smoke
  is first selected. "Open" is lip gap over mouth width with a hysteresis
  latch set above what talking or a grin reaches.
- **The smoke** is a particle system in one shared flow field, so neighbours
  bend together into ribbons. The breath is stamped into a quarter-res layer
  (cheap, and the upscale is free blur); the thin thread off the tip is drawn
  at full res, where quarter-res would turn it into blocks.

`?demo&fx=smoke` paints a stand-in face and both hands, and lights the cigarette
by itself, so the whole sequence runs without a camera.

### Rainbow — open wide

The other frame-less effect (`8`), on the same mouth tracking as Smoke. Open
your mouth and a rainbow pours out; shut it and the tail detaches and falls
away. Swing your head and the stream whips around behind it.

- **The stream is a chain of cross-sections.** Each is launched from the
  mouth and then falls on its own, inheriting some of the head's velocity, so
  the ribbon is simply wherever they have got to. The six bands are polygons
  threaded through them, with round caps on the free ends — the head of the
  stream is a row of drips.
- **It starts inside the mouth.** The inner-lip outline from the face mesh is
  filled with the same bands, darkening toward the upper lip, and the stream
  is squared to the lip line where it leaves, so the two meet band for band.
- **Physics is in mouth widths**, so it behaves the same near or far from the
  camera. Gravity is far below the real thing on purpose: at true scale the
  stream is off screen in a quarter of a second.

`?demo&fx=rainbow` runs it on the stand-in face.

### The gesture gags

Thirteen more frame-less effects, each a pose that arms it plus a motion
that fires it. Every hand threshold is in palm lengths (wrist to middle knuckle),
read off the tracker's metric 3D landmarks, so they hold at any distance.
`f` fires the current gag by hand; `?demo&fx=<id>` (say `?demo&fx=claws`)
runs each one on stand-ins.

| Key | Gag | Pose | Trigger | You get |
| --- | --- | ---- | ------- | ------- |
| 9 | **Finger Guns** | Index out, others curled, thumb up | Drop the thumb onto the hand, or flick the fingertip up | Muzzle flash, tracer, a bullet hole cracked into the glass down the line of fire, a comic BANG/PEW/POW, barrel smoke and a screen kick. Aim at the camera and the hole lands on the muzzle. Both hands work. |
| 0 | **Snap** | Thumb + middle fingertips pinched | Spring them apart inside a quarter second | A shockwave and an Infinity Gauntlet on your hand. A beat later you dissolve into dust that blows away. Snap again, or wait 7 s, to come back. |
| q | **Kamehameha** | Both palms together | Hold to charge, then shove | A crackling ball that grows as it charges. A sideways shove fires a beam that way. A shove at the camera (your hands suddenly grow) whites out the screen. |
| w | **Web** | 🤟 index + pinky up, middle + ring folded | Each new thwip | A line from your wrist that splats a web onto the glass. It stays attached while you hold the pose and goes slack when you let go. |
| e | **Laser Eyes** | — | Raise your eyebrows (or widen your eyes) | Heat vision from both irises, converging on one point. Turn your head to sweep it. Where it lands, it burns a trail into the glass that smoulders, sparks and smokes. |
| r | **Claws** | ✊ a fist (thumb either way) | Swing it fast | SNIKT: three steel claws slide out from between your knuckles, a foot long at real scale and foreshortened with your hand. Swing with them out and the three tips tear parallel gashes into the glass. |
| t | **Infinite Void** | 🤞 index + middle up and crossed (or pressed together), ring + pinky curled | Hold it half a second; again to collapse | Domain Expansion: a circle spreads from your fingertips and replaces the room with the void, a black sun with a white-hot rim, nebula and stars streaming out. You stay in front with a blue aura (person mask). 領域展開 then 無量空処 / INFINITE VOID title cards. |
| y | **Hollow Purple** | Both hands up: an orb of 蒼 Blue over the one on the left of the screen, 赫 Red over the right | Bring them together until they fuse into 茈 Purple, then shove | Blue's motes fall inward, Red's rings push outward. Together they spiral round each other and fuse, with 虚式「茈」. A sideways shove fires the sphere across the screen, carving a tunnel of void with glowing ragged edges and sucking the feed's own colours into it; the tunnel heals after 3 s. A shove at the camera swells it over the whole screen. |
| u | **Shadow Clone** | Both hands in the two-finger pose, held together | Hold it 0.4 s; again to dispel | 影分身の術: four clones poof out of smoke on either side. Each is your live cut-out (person mask) replayed a different beat late from a ring buffer, so they move like separate people. The back pair is smaller and darker, and the real you stays in front. |
| i | **Strange Portal** | ☝️ index up, ring + pinky curled | Trace a circle in the air | Sparks follow your fingertip; close the loop and a ring of molten sparks spins open at that size and place, throwing sparks off its rim and lighting the room orange. Inside is another world: first the Mirror Dimension (the room folded into a turning kaleidoscope), then Space, Synthwave and Sunset. A vertical slide changes the world. Draw a circle over it to close it; draw one elsewhere and it moves there. A loop counts once it sweeps 315° round its own centre and stays round, so a wave or zigzag doesn't open one. |
| o | **Speech Bubbles** | Just talk (allow the microphone) | Each pause ends a bubble | Live speech recognition fills a comic bubble beside your head, with its tail on your mouth, as you speak. It sits on whichever side has more room. The next words start a new bubble and the old ones stack up and float away. Talk with your mouth wide open and it's a shout: a jagged yellow burst in red capitals. With no recogniser, no mic or no network, a moving mouth still gets a bubble of animated dots. Uses Chrome's Web Speech API, which sends the audio to Google's speech service. |
| a | **Spirit Bomb** | Both open hands raised high | Throw them down, or shove at the camera | The light drains out of the room into a sphere gathering above your hands, in streams from every corner, until the screen is dark but for it. Throw it and it comes crashing toward you in a blinding impact as the light floods back. Lower your hands slowly instead and it fizzles. |
| d | **Time Stone** | ✋ An open palm | Twist it like a dial | The green mandala comes up and time stops. Counter-clockwise rewinds the room, clockwise runs it forward again, and holding still holds the moment. You stay in the present (person mask) while the world behind you plays backwards. Drop the hand and time races forward to catch up. |

- **Snap** needs the person mask, and you can only disappear if something
  is behind you. The background is learned from every pixel you are not
  covering. Where you have never moved, it is filled by push-pull inpainting:
  the frame with you cut out is halved down to a few pixels (each level
  averages only the uncovered pixels), then painted back up coarsest first.
  Step aside for a moment before snapping and the reveal is the real room.
  The cut-out is dilated two mask pixels, because the plate is repainted
  every frame and even a half-strength sliver of you would build up into an
  outline.
- **The dissolve order** is a sweep from the side the dust blows toward,
  broken up by value noise, so the dust never flies across parts of you that
  are still standing. Each mask pixel the sweep crosses sheds a particle in
  your own colour, which greys to ash as it drifts.
- **Laser aim** is the nose tip's offset from the middle of the face, in face
  widths. Side to side, that is zero when you look straight ahead. Up and
  down, the nose sits low, so that axis is measured against a slow baseline,
  which only updates while the lasers are off. Looking straight at the
  camera, the beams come at you: two flares, no line, no burn.
- **Laser trigger** uses the face model's blendshapes (`browInnerUp`,
  `eyeWide*`), turned on for every face effect.

### Finish

Small things that make the effects feel like they are in the room rather
than pasted over it:

- **Steady hands.** Every gag's hand points go through a One-Euro filter, a
  low-pass whose cutoff rises with speed. At rest it more than halves the
  tracker's pixel jitter, so props stop trembling, while a fast swipe trails
  by about a third of a frame. The eyes and face points for Laser Eyes get
  the same filter.
- **Light spill.** Bright things light the scene around them: muzzle flashes
  throw warm light, the Kamehameha ball and beam flood the room blue, laser
  eyes redden the face and the burn point glows, the snap flashes, and the
  Infinite Void charge glows on your fingertips. Each is a wide, faint radial
  falloff in `screen` mode.
- **The frame is glass.** A soft shadow outside the quad, a bright rim just
  inside it, and a faint diagonal sheen that turns with the frame.
- **Blur** is frosted glass (a cool milky wash and fine grain). **Noir** is
  film: a vignette, a little gate weave, grain that changes every frame, and
  tilt warms it from silver toward sepia.
- **Finger Guns** eject a spinning brass casing back over your knuckles on
  every shot. **Claws** cast a soft shadow, glint as they come out, and throw
  sparks along every slash. **The gauntlet** fades in and out with your hand
  instead of blinking on a dropped frame.

## How it works

- **Every effect is a module** in `src/effects/`, registered in
  `src/effects/index.js` through `defineEffect()`. The app shell in
  `src/core/` runs the camera, trackers, frame and loop, and calls each
  effect's hooks. Effects reach the shared helpers in `src/lib/` only
  through `src/api.js`.
- **MediaPipe Hand Landmarker** (GPU delegate) tracks up to two hands per
  video frame.
- When both hands pass a thumb–index spread check (with hysteresis), the four
  fingertips are ordered into a quad: `[left.index, right.index, right.thumb,
  left.thumb]`, gated on polygon area and bowtie rejection.
- Corners are blended with velocity-adaptive smoothing; the quad survives up
  to 25 dropped frames and large jumps must persist 2 frames before being
  accepted.
- The same quad is normalized into the four dials — area to `size`, the top
  edge's angle to `tilt`, the edge-length ratio to `aspect`, the frame-to-frame
  change in `size` to `punch` — and every effect reads them.
- The selected effect renders inside the quad via canvas `clip()`, with a
  smooth presence fade and pop-in. The dials come off the *smoothed* quad, not
  the popped-in one: the pop is a presentation flourish and would otherwise
  read as someone yanking the size dial every time a frame appears.

Modules load from jsDelivr with an automatic fallback to unpkg, since
jsDelivr is blocked or TLS-untrusted on some networks. Needs an internet
connection for the WASM + models (demo mode works offline once cached).

## Project layout

```
index.html            the page
src/main.js           boot: URL options, camera, trackers, the loop
src/api.js            everything an effect may import, documented
src/effects/          one file per effect, plus index.js (the list) and templates
src/core/             registry, frame loop, the finger frame, trackers, input
src/lib/              shared helpers: hands, face, person mask, particles, scenes
test/                 headless smoke test with a scripted fake tracker
docs/EFFECTS.md       how to write an effect
terminal/             the terminal edition (Python), below
```

## Privacy

Everything runs on your device. The camera feed goes to MediaPipe's trackers
running in the page (WebAssembly and WebGL) and is never uploaded. The page
downloads the MediaPipe runtime and models from jsDelivr or unpkg and from
`storage.googleapis.com`. Polaroid prints save to your own downloads. The
one exception is **Speech Bubbles**: it uses the browser's Web Speech API,
which in Chrome sends your audio to Google's speech service. It only starts
when you select that effect.

## Contributing

New effects are the most welcome contribution, and the easiest:
[docs/EFFECTS.md](docs/EFFECTS.md). Everything else is in
[CONTRIBUTING.md](CONTRIBUTING.md). `npm test` runs every effect headless,
and CI runs it on every pull request.

## License

[MIT](LICENSE)

---

# Terminal edition — gesture control for your computer

`terminal/` is the native sibling. The webcam renders **inside your terminal**
as ANSI block video, and gestures control the machine — no browser sandbox,
so it can do the one thing the web app cannot: send keystrokes to other
applications. Cross-platform: Windows, macOS, Linux (not WSL — no webcam
access there).

The trade is resolution. A terminal shows roughly 240x70 "pixels" against the
browser's full camera frame, so the visual effects are far weaker here. Use
this edition for **control**, the browser for **looks**.

## Setup

```
cd terminal
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt     # macOS / Linux
# .venv\Scripts\pip install -r requirements.txt   # Windows
.venv/bin/python app.py
```

Models (~8 MB gesture recognizer, ~8 MB anime) download on first use.

Flags: `--headless`, `--camera N`, `--spotlight`, `--capture WxH`,
`--frame-fx matrix|anime|pixelate|invert|off`, `--keep-person`,
`--blocks quad|half`, `--selftest N`.

Press **1-4** while running to switch the portal effect, **q** to quit.

## Default gestures (edit `terminal/config.json`)

| Gesture | Action |
| ------- | ------ |
| Snap (thumb+middle release) | Open a new Claude instance in Warp |
| Fist, hold 0.6s | Focus Warp, send Esc (interrupts Claude) |
| Open palm, hold 1.2s | Arm / disarm all gestures |
| Thumb up / down | Enter / close window |
| Pinch and drag | Volume |
| Swipe left / right | Switch desktop |

Safety rails: hold-times before firing, per-gesture cooldowns, drift reset (a
moving hand doesn't count as a hold), and the palm toggle as a global
kill-switch (`SAFE` mode).

## Platform notes

- **macOS**: keystrokes need Accessibility permission for your terminal
  (System Settings -> Privacy & Security -> Accessibility).
- **Linux**: install `xdotool`, `playerctl`, `pactl`; X11 assumed.
- **mediapipe is pinned below 1.0** — 1.0.x aborts at startup with
  `Check failed: service_ Service is unavailable.`
