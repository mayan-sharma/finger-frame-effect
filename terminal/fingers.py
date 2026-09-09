"""Five-finger geometry: landmark smoothing + per-finger extended-state.

The bundled GestureRecognizer only emits seven fixed categories, so anything
that depends on *which* fingers are up (counting, pinches, per-digit poses)
has to be derived from the 21 landmarks directly. Everything here is pure
geometry — no training, no extra model.

Two ideas do the heavy lifting:

  * **One Euro filter** — raw landmarks jitter a few pixels even when the hand
    is still. A fixed low-pass smooths that but adds lag when you move. The
    One Euro filter varies its cutoff with velocity: heavy smoothing while
    still, light smoothing while moving, so poses are stable *and* snappy.

  * **Tip-vs-PIP extension test** — a finger is extended when its tip sits
    farther from the wrist than its PIP joint. Measuring against the wrist
    (rather than comparing raw y) keeps the test valid with a rotated or
    upside-down hand, which a naive `tip.y < pip.y` check gets wrong.
"""

import math

WRIST = 0
THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP = 1, 2, 3, 4
INDEX_MCP, INDEX_PIP, INDEX_TIP = 5, 6, 8
MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP = 9, 10, 12
RING_MCP, RING_PIP, RING_TIP = 13, 14, 16
PINKY_MCP, PINKY_PIP, PINKY_TIP = 17, 18, 20

FINGER_NAMES = ("thumb", "index", "middle", "ring", "pinky")
TIPS = (THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP)
PIPS = (THUMB_IP, INDEX_PIP, MIDDLE_PIP, RING_PIP, PINKY_PIP)
MCPS = (THUMB_MCP, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP)

# A finger counts as extended once tip-to-wrist exceeds pip-to-wrist by this
# margin (relative to hand scale). The band between the two thresholds is
# hysteresis: it stops a half-curled finger flickering between states.
EXTEND_ON = 1.06
EXTEND_OFF = 0.98

# Thumb sits perpendicular to the other four, so it gets its own test:
# distance from the thumb tip to the pinky MCP, over hand scale.
THUMB_OUT_ON = 0.62
THUMB_OUT_OFF = 0.52

PINCH_ON = 0.32       # thumb-index tip distance / hand scale
PINCH_OFF = 0.45
# Contact must persist this long to count as a pinch. Long enough to reject
# tracking flicker and a snap's wind-up, short enough to feel immediate.
PINCH_HOLD_MS = 120


def _dist(a, b):
    return math.hypot(a.x - b.x, a.y - b.y)


def hand_scale(lms):
    """Reference length that tracks hand size and camera distance.

    Wrist-to-middle-MCP is the palm bone: rigid, always visible, and it does
    not change when fingers curl — which is exactly what a scale reference
    needs. Every ratio below divides by this so thresholds hold whether the
    hand is near the lens or far from it.
    """
    return max(_dist(lms[WRIST], lms[MIDDLE_MCP]), 1e-4)


class OneEuroFilter:
    """Velocity-adaptive low-pass for a single scalar signal.

    Cutoff rises with speed, so the filter smooths hard when the value is
    steady and gets out of the way when it moves.
    """

    def __init__(self, min_cutoff=1.2, beta=0.02, d_cutoff=1.0):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.x_prev = None
        self.dx_prev = 0.0
        self.t_prev = None

    @staticmethod
    def _alpha(cutoff, dt):
        tau = 1.0 / (2 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def __call__(self, x, t_ms):
        if self.x_prev is None:
            self.x_prev, self.t_prev = x, t_ms
            return x
        dt = (t_ms - self.t_prev) / 1000.0
        if dt <= 0:
            return self.x_prev
        self.t_prev = t_ms

        dx = (x - self.x_prev) / dt
        dx_hat = self._alpha(self.d_cutoff, dt) * dx + \
            (1 - self._alpha(self.d_cutoff, dt)) * self.dx_prev
        self.dx_prev = dx_hat

        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        x_hat = self._alpha(cutoff, dt) * x + \
            (1 - self._alpha(cutoff, dt)) * self.x_prev
        self.x_prev = x_hat
        return x_hat


class _Pt:
    """Mutable stand-in for a MediaPipe landmark (which is immutable)."""

    __slots__ = ("x", "y", "z")

    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


class LandmarkSmoother:
    """One Euro pair (x, y) per landmark, for one hand slot."""

    def __init__(self, n=21):
        self.fx = [OneEuroFilter() for _ in range(n)]
        self.fy = [OneEuroFilter() for _ in range(n)]
        self.seen_ms = None

    def reset(self):
        for f in self.fx + self.fy:
            f.x_prev = None
            f.t_prev = None
            f.dx_prev = 0.0

    def __call__(self, lms, now_ms):
        # A gap means the hand left frame and came back somewhere else;
        # filtering across that would drag phantom landmarks over the screen.
        if self.seen_ms is not None and now_ms - self.seen_ms > 300:
            self.reset()
        self.seen_ms = now_ms
        return [_Pt(self.fx[i](p.x, now_ms), self.fy[i](p.y, now_ms),
                    getattr(p, "z", 0.0))
                for i, p in enumerate(lms)]


class FingerState:
    """Per-hand extended-finger vector, with hysteresis on every digit."""

    def __init__(self):
        self.extended = [False] * 5
        self.pinching = False
        self.pinch_since = None

    def update(self, lms, now_ms=None):
        scale = hand_scale(lms)
        wrist = lms[WRIST]

        # Thumb: sideways spread from the pinky knuckle. The tip-vs-PIP test
        # used for the other four misreads it, because a folded thumb still
        # points away from the wrist.
        thumb_ratio = _dist(lms[THUMB_TIP], lms[PINKY_MCP]) / scale
        thr = THUMB_OUT_OFF if self.extended[0] else THUMB_OUT_ON
        self.extended[0] = thumb_ratio > thr

        for i in range(1, 5):
            tip_d = _dist(lms[TIPS[i]], wrist)
            pip_d = _dist(lms[PIPS[i]], wrist)
            ratio = tip_d / max(pip_d, 1e-4)
            thr = EXTEND_OFF if self.extended[i] else EXTEND_ON
            self.extended[i] = ratio > thr

        # A pinch is a *sustained* hold; a snap is a *transient* whose wind-up
        # also brings the thumb near the index. Requiring the contact to
        # persist for PINCH_HOLD_MS lets a snap pass through untouched while a
        # deliberate pinch still registers almost immediately.
        pinch_ratio = _dist(lms[THUMB_TIP], lms[INDEX_TIP]) / scale
        thr = PINCH_OFF if self.pinching else PINCH_ON
        close = pinch_ratio < thr
        if now_ms is None:
            # No clock (unit tests, one-shot classification): fall back to the
            # instantaneous test rather than silently never pinching.
            self.pinching = close
            return self
        if not close:
            self.pinch_since = None
        elif self.pinch_since is None:
            self.pinch_since = now_ms
        self.pinching = bool(
            close and self.pinch_since is not None
            and now_ms - self.pinch_since >= PINCH_HOLD_MS)
        return self

    @property
    def count(self):
        return sum(self.extended)

    def code(self):
        """Compact 5-char display code, e.g. '.IM..' for index+middle up."""
        letters = "TIMRP"
        return "".join(letters[i] if up else "."
                       for i, up in enumerate(self.extended))


# Extended-vector -> gesture name. Thumb is deliberately excluded from the
# count gestures: it drifts in and out at the margin far more than the other
# four, so counting on it would make Count_N flicker.
_POSE_TABLE = {
    (False, True, False, False, False): "Point",
    (False, True, True, False, False): "Two_Fingers",
    (False, True, True, True, False): "Three_Fingers",
    (False, True, True, True, True): "Four_Fingers",
    (True, True, True, True, True): "Five_Fingers",
    (False, False, True, False, False): "Middle_Finger",
    (False, False, False, False, True): "Pinky",
    (True, False, False, False, True): "Shaka",
}


def classify(state):
    """Name a pose from the finger vector, or None if it matches nothing.

    A pinch is thumb and index touching *while the hand is otherwise open* —
    middle, ring and pinky extended. Requiring that is what separates a
    deliberate pinch from a closed fist, where the thumb naturally rests
    against the index and would otherwise read as a pinch and fire its action.
    """
    if state.pinching and all(state.extended[2:]):
        return "Pinch"
    return _POSE_TABLE.get(tuple(state.extended))
