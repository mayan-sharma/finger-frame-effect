"""Finger Frame — terminal edition.

Webcam gesture control for your computer, rendered live in the terminal as
ANSI half-block video. Snap to launch Claude in Warp, hold a fist to stop it,
and map any other gesture to any action in config.json.

Frame both hands in an open "L" like a director and the fingertip quad
becomes a live effect portal (matrix rain / anime / pixelate / invert — see
frame_fx.py). Press 1-4 to switch effects while it runs, q to quit.

Usage:
  python app.py                 # live preview + control
  python app.py --headless      # status line only, no video
  python app.py --selftest 60   # pipeline smoke test (60 frames), then exit
  python app.py --camera 1      # pick another webcam
  python app.py --frame-fx off  # disable the finger-frame portal
  python app.py --capture 1920x1080   # ask the camera for more pixels
  python app.py --spotlight     # stage look: hands lit, room dimmed
"""

import argparse
import json
import os
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision

import actions
from backends import backend
from frame_fx import FrameFx, EFFECTS as FRAME_EFFECTS
from gestures import GestureEngine
from keys import KeyReader
from fingers import (THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP,
                     PIPS, MCPS, TIPS)

HERE = Path(__file__).parent
MODEL = HERE / "models" / "gesture_recognizer.task"
MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/gesture_recognizer/"
             "gesture_recognizer/float16/1/gesture_recognizer.task")

ESC = "\x1b"
# BGR, one per finger (thumb→pinky). Extended fingers draw at full colour and
# a larger radius; curled ones dim, so the extension test is visible on screen.
TIP_COLORS = {
    THUMB_TIP: (80, 200, 255),
    INDEX_TIP: (120, 255, 120),
    MIDDLE_TIP: (255, 160, 255),
    RING_TIP: (255, 210, 90),
    PINKY_TIP: (140, 140, 255),
}


def ensure_model():
    if not MODEL.exists():
        MODEL.parent.mkdir(parents=True, exist_ok=True)
        print("Downloading gesture model (~8 MB)…")
        urllib.request.urlretrieve(MODEL_URL, MODEL)


def open_camera(index, width, height):
    backends = ([cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY]
                if sys.platform == "win32" else [cv2.CAP_ANY])
    for be in backends:
        cap = cv2.VideoCapture(index, be)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
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


def _rgb(r, g, b):
    return f"{ESC}[38;2;{r};{g};{b}m"


def _clip(s, width):
    """Truncate to `width` visible cells, keeping escape sequences intact.

    The status text is assembled from fields of varying length, and a line
    that overruns the terminal wraps — which pushes the video up and smears
    the whole frame. Escapes are zero-width and must pass through whole, so
    the walk counts printable cells only and never cuts mid-sequence.
    """
    out = []
    cells = 0
    i = 0
    n = len(s)
    while i < n:
        if s[i] == ESC:
            j = s.find("m", i)
            if j == -1:
                break
            out.append(s[i:j + 1])
            i = j + 1
            continue
        # East-Asian wide glyphs occupy two cells; the rest occupy one.
        w = 2 if unicodedata.east_asian_width(s[i]) in ("W", "F") else 1
        if cells + w > width:
            out.append(f"{ESC}[0m")
            return "".join(out)
        out.append(s[i])
        cells += w
        i += 1
    return "".join(out)


# One palette for the whole HUD, so every colour means exactly one thing.
# Neutrals are tinted cool to match the graded surround of the preview; the
# ramp (DIM -> MUTED -> TEXT) carries hierarchy on its own, which lets the
# saturated hues stay reserved for state rather than decoration.
C_RESET = f"{ESC}[0m"
C_DIM = _rgb(88, 96, 112)      # rules, separators, inactive glyphs
C_MUTED = _rgb(138, 148, 168)  # labels and secondary values
C_TEXT = _rgb(226, 232, 244)   # primary readout
C_LIVE = _rgb(74, 222, 160)    # armed / firing: the only green on screen
C_WARN = _rgb(255, 190, 74)    # safe-mode amber
C_ARM = _rgb(214, 142, 255)    # the arm toggle, and nothing else
C_HOLD = _rgb(96, 208, 255)    # an ordinary action charging
# Fingertip tints, matched to the dots drawn on the video (BGR -> RGB).
C_TIPS = (_rgb(255, 200, 80), _rgb(120, 255, 120), _rgb(255, 160, 255),
          _rgb(90, 210, 255), _rgb(255, 140, 140))

BAR_W = 14
_EIGHTHS = " ▏▎▍▌▋▊▉"


def _bar(progress, color):
    """Eighth-block meter: ~8x the resolution of '#', so a 350ms hold moves.

    The unfilled remainder stays visible as a dim track, so the bar always
    reads as "this much of that much" rather than a growing blob.
    """
    filled = max(0.0, min(1.0, progress)) * BAR_W
    whole = int(filled)
    eighth = int((filled - whole) * 8)
    # An eighth of 0 would emit a blank cell and punch a hole in the bar, so
    # the fractional glyph is only drawn once there is something to show.
    part = _EIGHTHS[eighth] if (eighth and whole < BAR_W) else ""
    rest = BAR_W - whole - len(part)
    return (f"{color}{'█' * whole}{part}"
            f"{C_DIM}{'╌' * max(0, rest)}{C_RESET}")


class Hud:
    """Two-line instrument panel: state and intent on top, evidence below."""

    def __init__(self):
        self.log = []
        self.gesture = ""
        self.fps = 0.0

    def push(self, msg):
        self.log.append((time.time(), msg))
        self.log = self.log[-4:]

    def fx_line(self, effects, active, width=None):
        """Effect picker: the number key beside each name, active one lit.

        Mirrors the browser original's chip row. Without it the number-key
        bindings are invisible, and an undiscoverable shortcut may as well
        not exist.
        """
        parts = []
        for i, name in enumerate(effects):
            if name == active:
                parts.append(f"{C_DIM}{i + 1}{C_RESET}"
                             f"{ESC}[1m{C_TEXT} {name}{C_RESET}")
            else:
                parts.append(f"{C_DIM}{i + 1} {name}{C_RESET}")
        sep = f"  {C_DIM}·{C_RESET} "
        line = f" {C_DIM}portal{C_RESET}  " + sep.join(parts)
        line += f"   {C_DIM}q quit{C_RESET}"
        return _clip(line, width) if width else line

    def lines(self, engine, width=None):
        """Return the HUD as a list of lines, clipped to `width` columns."""
        # -- line 1: am I live, what am I holding, how far along ------------
        #
        # Disarmed is the state people get stuck in without noticing: gestures
        # still track and display, they just never fire. So it blinks, states
        # the consequence, and says how to get out.
        if engine.armed:
            badge = f"{ESC}[1m{_rgb(6,20,14)}{ESC}[48;2;74;222;160m LIVE {C_RESET}"
            note = ""
        else:
            # Inverse on the half-second gives a slow pulse; the text beside
            # it stays legible in both phases so it never flickers to noise.
            if int(time.time() * 2) % 2:
                badge = (f"{ESC}[1m{_rgb(24,16,0)}"
                         f"{ESC}[48;2;255;190;74m SAFE {C_RESET}")
            else:
                badge = f"{ESC}[1m{C_WARN} SAFE {C_RESET}"
            # State the consequence *and* the way out: this is the state
            # people get stuck in, and "disabled" alone does not help them.
            # The gesture is read from config rather than hardcoded, so the
            # instruction stays true if the arm toggle is rebound.
            how = engine.arm_gesture.replace("_", " ").lower()
            note = (f"{C_WARN}nothing will fire{C_RESET}"
                    f"{C_DIM} · hold {C_MUTED}{how}{C_DIM} to arm{C_RESET}")

        # The pose currently winning, held at a fixed width so the meter that
        # follows it never slides sideways while a hold charges.
        name = (self.gesture or "").replace("_", " ")
        if name:
            pose = f"{C_TEXT}{name[:16]:<16}{C_RESET}"
        else:
            pose = f"{C_DIM}{'waiting':<16}{C_RESET}"

        charging = 0.05 < engine.hold_progress < 1.0
        if charging and engine.hold_name == engine.arm_gesture:
            # The kill-switch is about to flip: label it, in its own colour.
            verb = "disarm" if engine.armed else "arm"
            meter = f"{_bar(engine.hold_progress, C_ARM)} {C_ARM}{verb}{C_RESET}"
        elif charging:
            meter = f"{_bar(engine.hold_progress, C_HOLD)}"
        else:
            # Reserve the meter's space even when idle, so line 1 holds a
            # constant shape and the eye stops re-finding the fields.
            meter = f"{C_DIM}{'╌' * BAR_W}{C_RESET}"

        one = f" {badge}  {pose}  {meter}"
        if note:
            one += f"  {note}"

        # -- line 2: the evidence — fingers, rate, what just fired ----------
        code = engine.finger_code
        if code:
            digits = " ".join(
                (C_TIPS[i] + ch + C_RESET) if ch != "." else f"{C_DIM}·{C_RESET}"
                for i, ch in enumerate(code))
        else:
            digits = f"{C_DIM}·  ·  ·  ·  ·{C_RESET}"

        rule = f"{C_DIM}│{C_RESET}"
        # Frame rate is diagnostic, not operational: it stays the dimmest
        # thing on the line until it drops far enough to explain sluggish
        # tracking, at which point it earns the warning colour.
        rate = C_WARN if 0 < self.fps < 12 else C_DIM
        fps = f"{rate}{self.fps:4.1f}fps{C_RESET}"

        recent = [m for t, m in self.log if time.time() - t < 4]
        if recent:
            # Newest last, and only the newest at full brightness: the log is
            # a receipt, not a headline.
            body = f" {C_DIM}·{C_RESET} ".join(
                f"{C_MUTED}{m}{C_RESET}" for m in recent[:-1])
            newest = f"{C_LIVE}{recent[-1]}{C_RESET}"
            trail = f"{body} {C_DIM}·{C_RESET} {newest}" if body else newest
        else:
            # Nothing has fired: say nothing rather than occupying the slot
            # with a permanent placeholder.
            trail = ""

        two = f" {digits}  {rule} {fps}"
        if trail:
            two += f"  {rule} {trail}"

        out = [one, two]
        if width:
            out = [_clip(s, width) for s in out]
        return out

    def line(self, engine, width=None):
        """Single-line form for --headless, where this is the entire UI.

        With no video above it, the one line has to carry the evidence too,
        so both halves are joined on a rule rather than the second dropped.
        """
        one, two = self.lines(engine)
        joined = f"{one}  {C_DIM}│{C_RESET}{two}"
        return _clip(joined, width) if width else joined


def _sharpen(small):
    """Mild unsharp mask at cell scale.

    INTER_AREA averaging is faithful but soft, and at ~100 columns every bit
    of local contrast reads as detail.
    """
    return cv2.addWeighted(small, 1.35,
                           cv2.GaussianBlur(small, (0, 0), 1.0), -0.35, 0)


# Rows below the video: two HUD lines, the effect picker, the newline that
# separates them from the art, and one spare so a full-width status line
# cannot scroll the frame.
HUD_ROWS = 5


def _preview_size(cols, rows, hud_rows=HUD_ROWS):
    """Cell grid for the video: full width, minus the rows the HUD needs."""
    return max(10, cols - 1), max(1, rows - hud_rows)


# Quadrant glyphs indexed by a 4-bit mask of which sub-cells take the
# foreground colour: bit 0 = top-left, 1 = top-right, 2 = bottom-left,
# 3 = bottom-right. Index 0 (nothing set) is a space; 15 is a full block.
_QUAD_GLYPHS = (" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛",
                "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█")


def render_preview_quad(frame, cols, rows, hud_rows=HUD_ROWS):
    """Frame as ANSI quadrant art: 2x2 sub-pixels per cell.

    Twice the horizontal detail of half-blocks. A cell can only show two
    colours, so the four samples are split into two groups around the mean
    luma and each group is averaged — a cheap 2-means that keeps edges
    crisp instead of smearing them into one flat colour.
    """
    cw, ch = _preview_size(cols, rows, hud_rows)
    w, h = cw * 2, ch * 2
    small = _sharpen(cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA))

    px = small.reshape(ch, 2, cw, 2, 3).transpose(0, 2, 1, 3, 4)
    quads = px.reshape(ch, cw, 4, 3).astype(np.int32)      # BGR per sub-cell
    # Rec. 601 luma, integer weights: the split axis for the two colour groups.
    # int32 throughout — the weighted sum peaks at 255000, well past int16.
    luma = (quads[..., 2] * 299 + quads[..., 1] * 587 + quads[..., 0] * 114)
    fg_sel = luma >= luma.mean(axis=2, keepdims=True)      # brighter half

    # Guard the degenerate case: a flat cell puts every sample in fg, leaving
    # bg with no members. Its colour is then unused (mask is 15 = full block),
    # so any finite value works — clamping the divisor just avoids a warning.
    n_fg = fg_sel.sum(axis=2)[..., None]
    fg = (quads * fg_sel[..., None]).sum(axis=2) // np.maximum(n_fg, 1)
    bg = (quads * ~fg_sel[..., None]).sum(axis=2) // np.maximum(4 - n_fg, 1)

    bits = (fg_sel * np.array([1, 2, 4, 8], np.int32)).sum(axis=2)
    fg = fg.astype(np.uint8)
    bg = bg.astype(np.uint8)

    out = [f"{ESC}[H"]
    for y in range(ch):
        row = []
        prev_fg = prev_bg = None
        brow, frow, grow = bits[y], fg[y], bg[y]
        for x in range(cw):
            m = int(brow[x])
            if m == 0 or m == 15:
                # Solid cell: one colour does the whole job, so emit only the
                # background and a space — half the escape bytes of a glyph.
                b, g, r = frow[x] if m == 15 else grow[x]
                key = (int(r), int(g), int(b))
                if key != prev_bg:
                    row.append(f"{ESC}[48;2;{key[0]};{key[1]};{key[2]}m")
                    prev_bg = key
                row.append(" ")
                continue
            fb, fg_, fr = frow[x]
            bb, bg_, br = grow[x]
            kf, kb = (int(fr), int(fg_), int(fb)), (int(br), int(bg_), int(bb))
            if kf != prev_fg:
                row.append(f"{ESC}[38;2;{kf[0]};{kf[1]};{kf[2]}m")
                prev_fg = kf
            if kb != prev_bg:
                row.append(f"{ESC}[48;2;{kb[0]};{kb[1]};{kb[2]}m")
                prev_bg = kb
            row.append(_QUAD_GLYPHS[m])
        row.append(f"{ESC}[0m")
        out.append("".join(row))
    return "\n".join(out)


def render_preview(frame, cols, rows, hud_rows=HUD_ROWS):
    """Frame as ANSI half-block art: one cell is an upper and lower pixel."""
    cw, ch = _preview_size(cols, rows, hud_rows)
    w, h = cw, ch * 2
    small = _sharpen(cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA))
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


# Bones of the hand skeleton, as landmark index pairs: four segments per
# finger, plus the palm arch that ties the knuckles to the wrist. The mask is
# grown from these rather than from a convex hull, because a hull over a
# spread hand swallows all the background *between* the fingers — which is
# precisely the clutter the spotlight exists to remove.
_BONES = []
for _chain in ((1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11, 12),
               (13, 14, 15, 16), (17, 18, 19, 20)):
    _BONES.extend(zip(_chain[:-1], _chain[1:]))
_BONES += [(0, 1), (0, 5), (0, 17), (5, 9), (9, 13), (13, 17)]
# Wrist + the five knuckles: the one part of the hand that is genuinely solid.
_PALM = (0, 1, 5, 9, 13, 17)

_VIGNETTE_CACHE = {}


def _vignette(h, w, strength=0.30):
    """Radial falloff, cached — the frame size never changes between frames."""
    cached = _VIGNETTE_CACHE.get((h, w, strength))
    if cached is None:
        yy = (np.linspace(-1.0, 1.0, h, dtype=np.float32) ** 2)[:, None]
        xx = (np.linspace(-1.0, 1.0, w, dtype=np.float32) ** 2)[None, :]
        r = np.clip(np.sqrt(xx * 0.92 + yy) / 1.25, 0.0, 1.0)
        cached = (1.0 - strength * r ** 1.8)[:, :, None].astype(np.float32)
        _VIGNETTE_CACHE.clear()      # only ever one size in play
        _VIGNETTE_CACHE[(h, w, strength)] = cached
    return cached


def spotlight_hands(frame, hands, dim=0.15, halo=0.30, rim=0.85):
    """Light the hands from within; sink everything else into the dark.

    The half-block preview is low-resolution enough that a busy background
    (a face, a bright window) drowns out the hands, so the frame is graded
    like a stage: the hand is the only thing holding colour, the room falls
    to dim grey, and a rim just inside the silhouette gives the shape a
    readable edge at a resolution where a soft gradient alone would mush.

    Three fields do the work, all at quarter resolution:
      * **body** — distance *outward* from the skeleton, so the pool follows
        the hand's real shape and the gaps between spread fingers stay dark.
      * **edge** — distance *inward* from the silhouette, used as a rim light.
        Being gated by the silhouette, it can only ever brighten the hand;
        an additive glow that spilled outward would light the clutter.
      * **vignette** — a fixed corner falloff that settles the frame.

    With no hand, it degrades to a clean, evenly dimmed, desaturated frame.
    """
    fh, fw = frame.shape[:2]
    sh, sw = fh // 4, fw // 4

    seeds = np.zeros((sh, sw), dtype=np.uint8)
    spans = []
    for lms in hands:
        pts = np.array([[p.x * sw, p.y * sh] for p in lms], dtype=np.float32)
        if not np.isfinite(pts).all():
            continue                      # tracking hiccup; skip this hand
        span = max(float(np.ptp(pts[:, 0])), float(np.ptp(pts[:, 1])), 6.0)
        spans.append(span)
        ip = np.round(pts).astype(np.int32)
        cv2.fillConvexPoly(seeds, cv2.convexHull(ip[list(_PALM)]), 255)
        # Bone thickness scales with the hand, so the mask holds its
        # proportions whether the hand is at the lens or across the room.
        thick = max(2, int(span * 0.13))
        for a, b in _BONES:
            cv2.line(seeds, tuple(ip[a]), tuple(ip[b]), 255, thick, cv2.LINE_8)

    # Composite small and upscale once. The preview is ~100 columns of
    # half-blocks, so quarter-res is already finer than anything that reaches
    # the screen, and it makes the grade ~3x cheaper than the full-res version.
    small = cv2.resize(frame, (sw, sh), interpolation=cv2.INTER_AREA)
    lit = small.astype(np.float32)
    # cvtColor rather than .mean(axis=2): same greyscale, ~50x faster.
    grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)[:, :, None]
    vign = _vignette(sh, sw)

    if not spans:
        dark = np.repeat(grey * dim, 3, axis=2) * vign
        return cv2.resize(np.clip(dark, 0, 255).astype(np.uint8), (fw, fh),
                          interpolation=cv2.INTER_LINEAR)

    span = float(np.mean(spans))
    reach = max(span * halo, 5.0)
    dist_out = cv2.distanceTransform(255 - seeds, cv2.DIST_L2, 3)
    body = np.clip(1.0 - dist_out / reach, 0.0, 1.0) ** 1.35
    body = cv2.GaussianBlur(body, (0, 0), reach * 0.22)

    dist_in = cv2.distanceTransform(seeds, cv2.DIST_L2, 3)
    edge = np.clip(1.0 - dist_in / max(span * 0.16, 2.0), 0.0, 1.0) ** 2.0
    edge = cv2.GaussianBlur(edge, (0, 0), max(span * 0.05, 1.0))
    edge *= seeds > 0

    m = body[:, :, None]
    # A bright window or lamp survives dimming better than the rest of the
    # room and ends up competing with the hand, so the surround is pulled
    # down harder where it is brightest.
    guard = 1.0 - 0.55 * np.clip(grey / 190.0, 0.0, 1.0) ** 2
    surround = grey * dim * guard
    # Cool the surround slightly (B,G,R): a hint of blue in the shadows makes
    # the warm skin tones of the lit hand read as the only living thing.
    surround = np.concatenate(
        [surround * 1.16, surround * 1.02, surround * 0.90], axis=2)

    lit = lit * m + surround * (1.0 - m)
    lit += edge[:, :, None] * rim * 34.0
    lit *= vign
    return cv2.resize(np.clip(lit, 0, 255).astype(np.uint8), (fw, fh),
                      interpolation=cv2.INTER_LINEAR)


def overlay_tips(frame, hands, states=()):
    """Draw all five fingertips; extended ones bright and large, curled dim."""
    fh, fw = frame.shape[:2]
    # Marker sizes scale with the frame, so a 720p capture shows the same
    # relative dots as the old 640x480 did after the terminal downscale.
    r_up = max(5, round(fw * 0.014))
    r_dn = max(3, round(fw * 0.008))
    for h, lms in enumerate(hands):
        state = states[h] if h < len(states) else None
        for i, idx in enumerate(TIPS):
            up = state.extended[i] if state else True
            color = TIP_COLORS[idx]
            if not up:
                color = tuple(int(c * 0.35) for c in color)
            p = lms[idx]
            cv2.circle(frame, (int(p.x * fw), int(p.y * fh)),
                       r_up if up else r_dn, color, -1)
        if state and state.pinching:
            a, b = lms[THUMB_TIP], lms[INDEX_TIP]
            cv2.line(frame, (int(a.x * fw), int(a.y * fh)),
                     (int(b.x * fw), int(b.y * fh)), (255, 255, 255),
                     max(2, fw // 480))


def main():
    ap = argparse.ArgumentParser(description="Gesture control from your terminal")
    ap.add_argument("--headless", action="store_true", help="no video preview")
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--spotlight", action="store_true",
                    help="stage-grade the frame: hands lit, room dimmed "
                         "(the old default look)")
    ap.add_argument("--frame-fx", choices=(*FRAME_EFFECTS, "off"), default=None,
                    help="effect inside the two-handed finger frame "
                         "(default: config frame_effect, else matrix)")
    ap.add_argument("--capture", default="1280x720", metavar="WxH",
                    help="camera capture resolution (default 1280x720); "
                         "detection always runs on a ~640-wide copy")
    ap.add_argument("--keep-person", action="store_true",
                    help="matrix portal: cut yourself out of the rain so it "
                         "falls behind you (default: rain in front)")
    ap.add_argument("--blocks", choices=("quad", "half"), default="quad",
                    help="preview cell shape: quad = 2x2 sub-pixels per cell "
                         "(sharper), half = 2x1 (default before, more "
                         "faithful colour)")
    ap.add_argument("--config", default=str(HERE / "config.json"))
    ap.add_argument("--selftest", type=int, default=0, metavar="N",
                    help="run N frames, print stats, exit (no actions fired)")
    args = ap.parse_args()

    try:
        cap_w, cap_h = (int(v) for v in args.capture.lower().split("x"))
    except ValueError:
        ap.error("--capture expects WxH, e.g. 1280x720")

    config = load_config(args.config)
    engine = GestureEngine(config)
    # Push-to-talk bindings need their keys lifted when the gesture ends.
    engine.on_release = (
        (lambda b: f"(selftest) release {b['action']}") if args.selftest
        else actions.release)
    engine.on_hold = (
        (lambda b, dx, dy: None) if args.selftest
        else actions.dispatch_hold)
    hud = Hud()
    ensure_model()
    fx_name = args.frame_fx or config.get("frame_effect", "matrix")
    keep_person = args.keep_person or config.get("frame_keep_person", False)
    framefx = (None if fx_name == "off"
               else FrameFx(fx_name, HERE / "models", keep_person=keep_person))
    if framefx:
        framefx.prepare()   # may download the segmentation model; prints here,
                            # before the preview owns the terminal
    recognizer = make_recognizer()

    cap = open_camera(args.camera, cap_w, cap_h)
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
    keys = KeyReader(enabled=preview)
    quit_requested = False

    frames = 0
    last_ts = 0
    hands_seen = 0
    t_fps = time.monotonic()
    fps_count = 0
    started = time.monotonic()

    try:
        keys.__enter__()
        while True:
            # Number keys pick an effect, arrows cycle, q quits. Handled
            # before the frame is grabbed so a switch shows on this frame.
            for key in keys.poll():
                if key in ("q", "Q", "\x03"):     # q or ctrl-c
                    quit_requested = True
                elif framefx is not None and key.isdigit():
                    i = int(key) - 1
                    if 0 <= i < len(FRAME_EFFECTS):
                        name = framefx.set_effect(FRAME_EFFECTS[i])
                        if name:
                            hud.push(f"effect: {name}")
            if quit_requested:
                break

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

            # Detect on a ~640-wide copy: landmarks come back normalized, so
            # they map straight onto the full-res frame, and the recognizer's
            # cost stays flat however large the camera captures.
            if frame.shape[1] > 704:
                dw = 640
                dh = round(frame.shape[0] * dw / frame.shape[1])
                det = cv2.resize(frame, (dw, dh), interpolation=cv2.INTER_AREA)
            else:
                det = frame
            rgb = cv2.cvtColor(det, cv2.COLOR_BGR2RGB)
            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = recognizer.recognize_for_video(mp_img, now_ms)

            names = [g[0].category_name if g else "" for g in result.gestures]
            hands = result.hand_landmarks or []
            if hands:
                hands_seen += 1

            events, notices = engine.update(names, hands, now_ms)
            framing = (framefx is not None
                       and framefx.update(engine.smoothed_hands(), now_ms))
            if framing:
                # Both hands are busy framing the shot. An L-hand misreads as
                # a pose (the model is fond of Pointing_Up), and firing its
                # binding mid-frame would be a drive-by trigger.
                events = []
            # Show whichever pose won — built-in category or geometry.
            if framing:
                hud.gesture = f"Framing · {framefx.effect}"
            else:
                hud.gesture = engine.hold_name or ""
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
                # Draw the smoothed landmarks the engine actually acted on,
                # not the raw ones — otherwise the dots jitter against a
                # steady readout.
                sm_hands = engine.smoothed_hands()
                # Effects sample the ungraded frame, so the portal contents
                # stay full-brightness against a spotlighted surround.
                orig = frame.copy() if (framing and args.spotlight) else frame
                if args.spotlight:
                    frame = spotlight_hands(frame, sm_hands)
                if framing:
                    frame = framefx.render(frame, orig, mp_img, now_ms)
                overlay_tips(frame, sm_hands, engine.fingers)
                size = os.get_terminal_size()
                draw = (render_preview_quad if args.blocks == "quad"
                        else render_preview)
                hud_rows = HUD_ROWS if framefx is not None else HUD_ROWS - 1
                sys.stdout.write(draw(frame, size.columns, size.lines,
                                      hud_rows))
                # Clear each status row before writing: the fields change
                # width, and a stale tail would otherwise survive under the
                # shorter line.
                rows_out = hud.lines(engine, size.columns - 1)
                if framefx is not None:
                    rows_out.append(hud.fx_line(FRAME_EFFECTS, framefx.effect,
                                                size.columns - 1))
                for row in rows_out:
                    sys.stdout.write(f"\n{ESC}[K{row}")
                sys.stdout.flush()
            elif not args.selftest:
                # Always clear to end-of-line: the status text changes width
                # (the SAFE banner is much longer than ARMED), and a bare \r
                # would leave the tail of the previous line on screen.
                try:
                    cols = os.get_terminal_size().columns - 1
                except OSError:
                    cols = None          # piped to a file: no clipping needed
                line = hud.line(engine, cols)
                sys.stdout.write(f"\r{ESC}[K{line}")
                sys.stdout.flush()

            frames += 1
            if args.selftest and frames >= args.selftest:
                break
    except KeyboardInterrupt:
        pass
    finally:
        # Restore the tty first: if anything below raises, the terminal must
        # not be left in cbreak mode with the cursor hidden.
        keys.restore()
        if cap is not None:
            cap.release()
        if framefx is not None:
            framefx.close()
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
