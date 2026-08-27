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

Optional URL params: `?fx=N` starts on effect N (1–10), `?scene=N` picks the
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

Arrow keys or clicking the canvas cycle effects. `k` toggles whether the
Matrix rain falls in front of you or behind.

**Swipe to change effect**: with one open hand up, sweep sideways — right for
the next effect, left for the previous. It gates on an open hand (three or
more fingers extended, measured from the landmarks rather than a model label,
since a swiping hand is motion blurred), ignores the first 250 ms after a
hand appears so raising it into frame doesn't count, requires horizontal
travel to clearly beat vertical, and only fires once per 700 ms. Two hands up
is the framing pose, so swipes are one-handed only.

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
