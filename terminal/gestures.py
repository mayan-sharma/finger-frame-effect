"""Gesture engine: turns MediaPipe results into debounced, hold-gated events.

Built-in categories come from the GestureRecognizer model:
  Closed_Fist, Open_Palm, Pointing_Up, Thumb_Up, Thumb_Down, Victory, ILoveYou
Custom detectors add: Snap, Swipe_Left, Swipe_Right
"""

import time

WRIST = 0
THUMB_TIP = 4
INDEX_TIP = 8
MIDDLE_MCP = 9
MIDDLE_TIP = 12

# Snap: thumb & middle tips touch, then fly apart quickly.
SNAP_TOUCH_RATIO = 0.35
SNAP_RELEASE_RATIO = 0.9
SNAP_WINDOW_MS = 250

# Swipe: open palm translating fast.
SWIPE_DIST = 0.22        # normalized screen widths
SWIPE_WINDOW_MS = 320

# Hold gestures reset if the wrist wanders (prevents drive-by triggers).
HOLD_DRIFT = 0.10


def _dist(a, b):
    return ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) ** 0.5


class SnapDetector:
    """Per-hand state machine: IDLE -> TOUCH -> (fast release) -> fire."""

    def __init__(self):
        self.touching = False
        self.touch_start = 0.0

    def update(self, lms, now_ms):
        scale = _dist(lms[WRIST], lms[MIDDLE_MCP])
        if scale < 1e-4:
            return False
        ratio = _dist(lms[THUMB_TIP], lms[MIDDLE_TIP]) / scale
        if not self.touching:
            if ratio < SNAP_TOUCH_RATIO:
                self.touching = True
                self.touch_start = now_ms
        else:
            if ratio > SNAP_RELEASE_RATIO:
                self.touching = False
                return (now_ms - self.touch_start) < SNAP_WINDOW_MS
            if ratio > SNAP_TOUCH_RATIO and now_ms - self.touch_start > SNAP_WINDOW_MS:
                self.touching = False
        return False


class SwipeDetector:
    """Detects fast lateral wrist motion while the palm is open."""

    def __init__(self):
        self.history = []  # (t_ms, x)

    def update(self, lms, gesture_name, now_ms):
        if gesture_name != "Open_Palm":
            self.history.clear()
            return None
        x = lms[WRIST].x
        self.history.append((now_ms, x))
        self.history = [(t, v) for t, v in self.history if now_ms - t <= SWIPE_WINDOW_MS]
        if len(self.history) < 3:
            return None
        dx = x - self.history[0][1]
        if abs(dx) >= SWIPE_DIST:
            self.history.clear()
            # Frame is already mirrored, so +x is the user's right.
            return "Swipe_Right" if dx > 0 else "Swipe_Left"
        return None


class GestureEngine:
    def __init__(self, config):
        self.armed = bool(config.get("armed_on_start", True))
        arm = config.get("arm_toggle", {}) or {}
        self.arm_gesture = arm.get("gesture", "Open_Palm")
        self.arm_hold_ms = arm.get("hold_ms", 1200)

        self.bindings = {}
        for b in config.get("bindings", []):
            self.bindings.setdefault(b["gesture"], []).append(b)

        self.snap = [SnapDetector(), SnapDetector()]
        self.swipe = [SwipeDetector(), SwipeDetector()]

        # Hold tracking for the primary continuous gesture.
        self.hold_name = None
        self.hold_start = 0.0
        self.hold_anchor = None    # wrist pos at hold start
        self.hold_fired = False
        self.last_repeat = 0.0
        self.arm_consumed = False

        self.cooldowns = {}        # gesture -> ready-at ms
        self.hold_progress = 0.0   # 0..1 HUD feedback for the active hold

    # -- helpers ------------------------------------------------------------

    def _cooldown_ok(self, name, now_ms):
        return now_ms >= self.cooldowns.get(name, 0)

    def _fire(self, binding, now_ms, events):
        cd = binding.get("cooldown_ms", 1000)
        self.cooldowns[binding["gesture"]] = now_ms + cd
        events.append(binding)

    def _fire_discrete(self, name, now_ms, events):
        if not self._cooldown_ok(name, now_ms):
            return
        for b in self.bindings.get(name, []):
            if self.armed:
                self._fire(b, now_ms, events)

    # -- main entry ---------------------------------------------------------

    def update(self, gesture_names, landmarks, now_ms):
        """gesture_names: list of category names per hand ('' if none).
        landmarks: list of 21-landmark lists per hand.
        Returns (events, notices): bindings to execute + HUD strings."""
        events, notices = [], []

        # Discrete detectors (snap / swipe) per hand.
        for i in range(min(2, len(landmarks))):
            name = gesture_names[i] if i < len(gesture_names) else ""
            if self.snap[i].update(landmarks[i], now_ms):
                notices.append("snap!")
                self._fire_discrete("Snap", now_ms, events)
            sw = self.swipe[i].update(landmarks[i], name, now_ms)
            if sw:
                notices.append(sw.lower())
                self._fire_discrete(sw, now_ms, events)

        # Primary continuous gesture: first non-empty category.
        primary, wrist = None, None
        for i, name in enumerate(gesture_names):
            if name and name != "None" and i < len(landmarks):
                primary, wrist = name, landmarks[i][WRIST]
                break

        if primary != self.hold_name:
            self._reset_hold(primary, wrist, now_ms)
        elif primary and wrist and self.hold_anchor:
            drift = ((wrist.x - self.hold_anchor[0]) ** 2 +
                     (wrist.y - self.hold_anchor[1]) ** 2) ** 0.5
            if drift > HOLD_DRIFT:
                self._reset_hold(primary, wrist, now_ms)

        self.hold_progress = 0.0
        if primary:
            held = now_ms - self.hold_start

            # Arm/disarm toggle takes priority on its gesture.
            if primary == self.arm_gesture:
                self.hold_progress = min(1.0, held / self.arm_hold_ms)
                if held >= self.arm_hold_ms and not self.arm_consumed:
                    self.arm_consumed = True
                    self.armed = not self.armed
                    notices.append("armed" if self.armed else "disarmed")
                return events, notices

            for b in self.bindings.get(primary, []):
                hold_ms = b.get("hold_ms", 0)
                self.hold_progress = min(1.0, held / hold_ms) if hold_ms else 1.0
                if held < hold_ms or not self.armed:
                    continue
                repeat = b.get("repeat_ms")
                if not self.hold_fired:
                    if self._cooldown_ok(primary, now_ms):
                        self.hold_fired = True
                        self.last_repeat = now_ms
                        self._fire(b, now_ms, events)
                elif repeat and now_ms - self.last_repeat >= repeat:
                    self.last_repeat = now_ms
                    self.cooldowns[primary] = 0
                    self._fire(b, now_ms, events)

        return events, notices

    def _reset_hold(self, name, wrist, now_ms):
        self.hold_name = name
        self.hold_start = now_ms
        self.hold_anchor = (wrist.x, wrist.y) if wrist else None
        self.hold_fired = False
        self.arm_consumed = False
