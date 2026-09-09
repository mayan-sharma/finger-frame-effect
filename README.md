# Finger Frame Effect

Hold both hands up in an open "L" (thumb + index spread apart) like a movie
director framing a shot. The quad formed by your four fingertips becomes a
live effect window over your webcam feed.

Inspired by [sophiamyang/finger-frame-effect](https://github.com/sophiamyang/finger-frame-effect).

## Run

No build step. The camera requires localhost or HTTPS:

```
python -m http.server 8123
# open http://localhost:8123
```

No camera handy? Use the synthetic demo scene:

```
http://localhost:8123/?demo
```

Optional URL params: `?fx=N` starts on effect N (1–13), `?scene=N` picks the
Portal scene (0–2), `?style=N` the Anime style (0–3), `?keepPerson` puts the
Matrix rain behind you. They combine with `?demo`.

## Controls

| Key | Effect |
| --- | ------ |
| 1 | Pixelate |
| 2 | Blur |
| 3 | Invert |
| 4 | Noir |
| 5 | Glitch |
| 6 | Toon |
| 7 | Van Gogh |
| 8 | Anime — press again to cycle styles (Hayao / Shinkai / Ghibli / Sketch) |
| 9 | Matrix |
| 0 | Portal — press again to cycle scenes (Space / Synthwave / Sunset) |
| q | Inferno — heat simulation: your movement ignites fire that rises and curls |
| w | Shatter — the frame cracks into Voronoi glass shards that drift apart |
| e | Aurora — your silhouette emits waves that ripple outward as light curtains |

Arrow keys or clicking the canvas cycle effects. `k` toggles whether the
Matrix rain falls in front of you or behind.

### GPU shader effects

`q` / `w` / `e` are **simulations**, not filters. A filter maps this frame's
pixels to output; these carry state forward and evolve it, which is why they
keep moving after you stop.

They get four inputs: the current crop, **the previous frame's output** (used
as a state field, not just for trails), **the previous camera frame** (so they
can measure what actually moved), and **the person mask**.

- **Inferno** treats the feedback buffer as a heat field. Every frame heat
  advects upward, diffuses into neighbours, and cools; your motion injects
  fuel. Wave a hand and the flame outlives the gesture because it's state.
- **Shatter** builds a Voronoi cell decomposition with a second pass for true
  edge distance (which is what makes the cracks crisp rather than blobby).
  Each shard flies out on its own heading with a lit bevel; break energy
  accumulates from motion and decays, so one swipe shatters and then drifts.
- **Aurora** propagates a wave field outward from your silhouette each frame
  and folds it through sine bands into curtains. Ripples keep travelling after
  you move away — the box remembers where you were.

Feedback means the shader can't draw straight to the screen, so it
ping-pongs between two framebuffers: read last frame's texture, write to the
other, then repeat the draw to the visible canvas. History is cleared when
the effect or the box size changes, or an old effect's trails would bleed
into the new one.

One GL context is shared by all three and the programs compile once, since
browsers drop the oldest context when a page opens too many. If WebGL is
unavailable or a shader fails to compile, the box falls back to the plain
feed rather than going blank.

### Slide gestures

With **one open hand** up, sweep it:

| Slide | Does |
| ----- | ---- |
| ← / → | Previous / next effect |
| ↑ / ↓ | Cycle the current effect's variant — Anime style, Portal scene, or Matrix front/behind |

It gates on an open hand (three or more fingers extended, measured from the
landmarks rather than a model label, since a swiping hand is motion blurred),
ignores the first 250 ms after a hand appears so raising it into frame
doesn't count, requires one axis to clearly beat the other so a diagonal wave
does nothing, and only fires once per 700 ms. Two hands up is the framing
pose, so slides are one-handed only.

### The three heavier effects

**Anime** restyles the framed region with the AnimeGAN family. Press `8`
again to cycle four styles:

| Style | Look | Size |
| ----- | ---- | ---- |
| Hayao | Warm Ghibli cel-shading, soft ink outlines | 8.6 MB |
| Shinkai | Saturated teal-blue skies, high contrast (*Your Name*) | 8.6 MB |
| Ghibli | Softer painterly v3 model, faster than the v2 pair | 7.0 MB |
| Sketch | Grey pencil-sketch portrait | 4.2 MB |

Each style downloads on first use and is then cached, so switching back is
instant. They share one tensor spec (NHWC, `[-1,1]`, dynamic H/W) but *not*
their input tensor names, so the feed is keyed off the session's own
`inputNames`. Inference runs on **WebGPU** where available, falling back to
wasm at reduced resolution, and never blocks the render loop — tracking keeps
full speed while stylized frames stream in, and the working resolution adapts
to measured inference time. Toon stands in until the first result lands.

**Matrix** fills the frame with digital rain, in front of you by default.
Press `k` and selfie segmentation cuts you out so the rain falls behind you
instead.

**Portal** keeps you real and replaces the world behind you with an animated
scene. Both it and `k`-mode need the camera, so demo mode shows scenes only.

## How it works

- **MediaPipe Hand Landmarker** (GPU delegate) tracks up to two hands per
  video frame.
- When both hands pass a thumb–index spread check (with hysteresis), the four
  fingertips are ordered into a quad: `[left.index, right.index, right.thumb,
  left.thumb]`, gated on polygon area and bowtie rejection.
- Corners are blended with velocity-adaptive smoothing; the quad survives up
  to 25 dropped frames and large jumps must persist 2 frames before being
  accepted.
- The selected effect renders inside the quad via canvas `clip()`, with a
  smooth presence fade and pop-in.

Modules load from jsDelivr with an automatic fallback to unpkg, since
jsDelivr is blocked or TLS-untrusted on some networks. Needs an internet
connection for the WASM + models (demo mode works offline once cached).

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
