# Finger Frame Effect

Hold both hands up in an open "L" (thumb + index spread apart) like a movie
director framing a shot. The quad formed by your four fingertips becomes a
live effect window over your webcam feed.

Inspired by [sophiamyang/finger-frame-effect](https://github.com/sophiamyang/finger-frame-effect).

## Run

No build step. The camera requires localhost or HTTPS:

```
cd finger-frame
python -m http.server 8123
# open http://localhost:8123
```

No camera handy? Use the synthetic demo scene:

```
http://localhost:8123/?demo
```

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

Arrow keys or clicking the canvas cycle effects.

## How it works

- **MediaPipe Hand Landmarker** (loaded from CDN, GPU delegate) tracks up to
  two hands per video frame.
- When both hands pass a thumb–index spread check (with hysteresis), the four
  fingertips are ordered into a quad: `[left.index, right.index, right.thumb,
  left.thumb]`, gated on polygon area and bowtie rejection.
- Corners are blended with velocity-adaptive smoothing; the quad survives up
  to 25 dropped frames and large jumps must persist 2 frames before being
  accepted.
- The selected effect renders inside the quad via canvas `clip()`, with a
  smooth presence fade and pop-in.

Needs an internet connection for the MediaPipe WASM + model (demo mode works
offline once cached).
