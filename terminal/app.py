"""Finger Frame — terminal edition.

Webcam gesture control for your computer, rendered live in the terminal as
ANSI half-block video. Snap to launch Claude in Warp, hold a fist to stop it,
and map any other gesture to any action in config.json.

Usage:
  python app.py                 # live preview + control
  python app.py --headless      # status line only, no video
  python app.py --selftest 60   # pipeline smoke test (60 frames), then exit
  python app.py --camera 1      # pick another webcam
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision

import actions
from backends import backend
from gestures import GestureEngine, THUMB_TIP, INDEX_TIP, MIDDLE_TIP

HERE = Path(__file__).parent
MODEL = HERE / "models" / "gesture_recognizer.task"
MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/gesture_recognizer/"
             "gesture_recognizer/float16/1/gesture_recognizer.task")

ESC = "\x1b"
TIP_COLORS = {THUMB_TIP: (80, 200, 255), INDEX_TIP: (120, 255, 120), MIDDLE_TIP: (255, 160, 255)}


def ensure_model():
    if not MODEL.exists():
        MODEL.parent.mkdir(parents=True, exist_ok=True)
        print("Downloading gesture model (~8 MB)…")
        urllib.request.urlretrieve(MODEL_URL, MODEL)


def open_camera(index):
    backends = ([cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY]
                if sys.platform == "win32" else [cv2.CAP_ANY])
    for be in backends:
        cap = cv2.VideoCapture(index, be)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            return cap
        cap.release()
    return None


def make_recognizer():
    opts = vision.GestureRecognizerOptions(
        base_options=BaseOptions(model_asset_path=str(MODEL)),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.4,
        min_hand_presence_confidence=0.4,
        min_tracking_confidence=0.4,
    )
    return vision.GestureRecognizer.create_from_options(opts)


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class Hud:
    """Rolling status: armed state, current gesture, last actions."""

    def __init__(self):
        self.log = []
        self.gesture = ""
        self.fps = 0.0

    def push(self, msg):
        self.log.append((time.time(), msg))
        self.log = self.log[-4:]

    def line(self, engine):
        armed = "\x1b[92mARMED\x1b[0m" if engine.armed else "\x1b[93mSAFE\x1b[0m"
        bar = ""
        if 0.05 < engine.hold_progress < 1.0:
            n = int(engine.hold_progress * 10)
            bar = " [" + "#" * n + "-" * (10 - n) + "]"
        recent = " | ".join(m for t, m in self.log if time.time() - t < 4)
        return (f" {armed}  {self.fps:4.1f}fps  "
                f"gesture: {self.gesture or '-'}{bar}  {recent}")


def render_preview(frame, cols, rows):
    """Return the frame as ANSI half-block art sized to the terminal."""
    h = max(2, (rows - 3) * 2)
    w = max(10, cols - 1)
    small = cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA)
    out = [f"{ESC}[H"]
    for y in range(0, h - 1, 2):
        row = []
        prev = None
        for x in range(w):
            tb, tg, tr = small[y, x]
            bb, bg, br = small[y + 1, x]
            code = f"{ESC}[38;2;{tr};{tg};{tb}m{ESC}[48;2;{br};{bg};{bb}m"
            if code != prev:
                row.append(code)
                prev = code
            row.append("▀")
        row.append(f"{ESC}[0m")
        out.append("".join(row))
    return "\n".join(out)


def overlay_tips(frame, hands):
    fh, fw = frame.shape[:2]
    for lms in hands:
        for idx, color in TIP_COLORS.items():
            p = lms[idx]
            cv2.circle(frame, (int(p.x * fw), int(p.y * fh)), 9, color, -1)


def main():
    ap = argparse.ArgumentParser(description="Gesture control from your terminal")
    ap.add_argument("--headless", action="store_true", help="no video preview")
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--config", default=str(HERE / "config.json"))
    ap.add_argument("--selftest", type=int, default=0, metavar="N",
                    help="run N frames, print stats, exit (no actions fired)")
    args = ap.parse_args()

    config = load_config(args.config)
    engine = GestureEngine(config)
    hud = Hud()
    ensure_model()
    recognizer = make_recognizer()

    cap = open_camera(args.camera)
    synthetic = cap is None
    if synthetic and not args.selftest:
        print(f"Could not open camera {args.camera}. "
              "(Run with --selftest N to exercise the pipeline without one.)",
              file=sys.stderr)
        return 1
    if synthetic:
        print("No camera — selftest will run on synthetic frames.")

    preview = not args.headless and not args.selftest
    if preview:
        backend.enable_vt()
        sys.stdout.write(f"{ESC}[2J{ESC}[?25l")  # clear, hide cursor

    frames = 0
    last_ts = 0
    hands_seen = 0
    t_fps = time.monotonic()
    fps_count = 0
    started = time.monotonic()

    try:
        while True:
            if synthetic:
                frame = np.full((480, 640, 3), 32, dtype=np.uint8)
                cv2.circle(frame, (320 + int(80 * np.sin(frames * 0.1)), 240),
                           60, (90, 140, 200), -1)
            else:
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.05)
                    continue
            frame = cv2.flip(frame, 1)  # mirror
            now_ms = max(int(time.monotonic() * 1000), last_ts + 1)
            last_ts = now_ms

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = recognizer.recognize_for_video(mp_img, now_ms)

            names = [g[0].category_name if g else "" for g in result.gestures]
            hands = result.hand_landmarks or []
            hud.gesture = next((n for n in names if n and n != "None"), "")
            if hands:
                hands_seen += 1

            events, notices = engine.update(names, hands, now_ms)
            for n in notices:
                hud.push(n)
            for binding in events:
                if args.selftest:
                    hud.push(f"(selftest) {binding['action']}")
                else:
                    hud.push(actions.dispatch(binding))

            fps_count += 1
            if time.monotonic() - t_fps >= 1.0:
                hud.fps = fps_count / (time.monotonic() - t_fps)
                fps_count = 0
                t_fps = time.monotonic()

            if preview:
                overlay_tips(frame, hands)
                size = os.get_terminal_size()
                sys.stdout.write(render_preview(frame, size.columns, size.lines))
                sys.stdout.write(f"\n{ESC}[K" + hud.line(engine))
                sys.stdout.flush()
            elif not args.selftest:
                line = hud.line(engine)
                sys.stdout.write(f"\r{ESC}[K{line}" if os.name == "nt" else f"\r{line}")
                sys.stdout.flush()

            frames += 1
            if args.selftest and frames >= args.selftest:
                break
    except KeyboardInterrupt:
        pass
    finally:
        if cap is not None:
            cap.release()
        recognizer.close()
        if preview:
            sys.stdout.write(f"{ESC}[0m{ESC}[?25h\n")

    if args.selftest:
        dt = time.monotonic() - started
        print(f"selftest: {frames} frames in {dt:.1f}s "
              f"({frames / dt:.1f} fps), frames with hands: {hands_seen}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
