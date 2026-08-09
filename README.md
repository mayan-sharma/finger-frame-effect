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

---

# Terminal edition — gesture control for your computer

`terminal/` is the native sibling: the webcam feed renders **inside your
terminal** as ANSI half-block video, and gestures control the machine —
no browser sandbox. Cross-platform: Windows, macOS, Linux (not WSL — WSL has
no webcam access; run it natively per OS).

## Setup

```
cd terminal
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt     # Windows
# .venv/bin/pip install -r requirements.txt       # macOS / Linux
.venv\Scripts\python app.py
```

The gesture model (~8 MB) downloads automatically on first run.

Flags: `--headless` (status line only), `--camera N`, `--selftest N`
(pipeline smoke test, works without a camera, actions are logged not fired).

## Default gestures (edit `terminal/config.json`)

| Gesture | Action |
| ------- | ------ |
| 🫰 Snap (thumb+middle release) | Open a new Claude instance in Warp |
| ✊ Fist, hold 0.6s | Focus Warp, send Esc (interrupts Claude) |
| ✋ Open palm, hold 1.2s | Arm / disarm all gestures |
| 👍 / 👎 hold | Volume up / down (repeats while held) |
| 🤟 hold | Play / pause |
| ✌️ hold 0.8s | Screenshot |
| ✋ swipe left / right | Next / previous track |

Safety rails: hold-times before firing, per-gesture cooldowns, drift reset
(a moving hand doesn't count as a hold), and the palm toggle for a global
kill-switch (`SAFE` mode). Actions available for bindings: `warp_claude`,
`warp_esc`, `warp_window`, `volume_up/down`, `mute`, `play_pause`,
`next_track`, `prev_track`, `screenshot`, `lock`, `key`, `open`, `run`.

## Platform notes

- **Windows**: works out of the box (ctypes/user32, no extra deps).
- **macOS**: keystrokes need Accessibility permission for your terminal
  (System Settings → Privacy & Security → Accessibility).
- **Linux**: install `xdotool` (keys/focus), `playerctl` (media),
  `pactl` (volume); X11 assumed — on Wayland adapt to `ydotool`.
- The snap→Claude binding writes a Warp launch configuration
  (`claude.yaml`) into Warp's config dir on first use, then opens
  `warp://launch/claude`.
