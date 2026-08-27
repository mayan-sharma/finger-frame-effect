"""Gesture engine: turns MediaPipe results into debounced, hold-gated events.

Built-in categories come from the GestureRecognizer model:
  Closed_Fist, Open_Palm, Pointing_Up, Thumb_Up, Thumb_Down, Victory, ILoveYou
Custom detectors add: Snap, Swipe_Left, Swipe_Right
Finger geometry (fingers.py) adds: Pinch, Point, Two/Three/Four/Five_Fingers,
Pinky, Shaka — poses the built-in classifier cannot express.

Landmarks are One Euro smoothed before any of this runs; raw MediaPipe output
jitters enough to flicker the extension tests.
"""

import time

from fingers import (LandmarkSmoother, FingerState, classify, hand_scale,
                     PINCH_ON, PINCH_OFF,
                     WRIST, THUMB_TIP, INDEX_TIP, MIDDLE_MCP, MIDDLE_TIP)

# Snap: thumb & middle tips touch, then fly apart quickly.
#
# Ratios are thumb-middle distance over hand scale. MediaPipe puts tip
# landmarks at finger *centres*, so touching fingertips bottom out around
# 0.55-0.65 rather than 0.0 — measured on real snaps, the minimum was 0.59.
# The old 0.35 threshold was therefore unreachable and snap never fired.
SNAP_TOUCH_RATIO = 0.72
SNAP_RELEASE_RATIO = 1.15
# A snap is ballistic (~30ms), so at 20-30fps the contact often lands between
# frames. Widening the window lets a touch seen one frame and a release seen
# two frames later still count.
SNAP_WINDOW_MS = 400
# After a snap fires, mute geometry poses while the hand recoils.
SNAP_MASK_MS = 600

# Double pinch: pinch, release, pinch again — like a double-click.
#
# A pinch is a *held* pose, which MediaPipe tracks reliably, whereas a snap is
# a ~30ms ballistic event that tracking routinely loses entirely. Two cheap
# reliable detections beat one unreliable one.
DPINCH_GAP_MS = 600      # max time between the two pinches
DPINCH_MIN_MS = 40       # each pinch must last this long (rejects flicker)

# Swipe: an open hand translating sideways.
#
# The original 0.22-width-in-320ms demanded a fast, wide motion — and because
# fast motion blurs the hand, the model tends to drop the Open_Palm label
# exactly when you swipe, so the attempt was discarded anyway. Accept a
# shorter travel over a longer window, and gate on the hand simply being open
# (geometry) rather than on the model naming it Open_Palm.
SWIPE_DIST = 0.13        # normalized screen widths
# Vertical travel is smaller in normalized units — the frame is 4:3, so the
# same physical motion covers less normalized distance across x than y, and
# arms swing sideways more freely than up and down.
SWIPE_DIST_Y = 0.10
SWIPE_WINDOW_MS = 600
SWIPE_MIN_FINGERS = 3    # an open-ish hand; a fist should not swipe
# One axis must beat the other by this factor. Without it a diagonal wave
# clears both thresholds and fires whichever axis happens to be tested first.
SWIPE_DOMINANCE = 1.5
# Grace after an open hand appears: raising it into frame is fast upward
# motion that would otherwise read as a swipe up.
# Measured: at 150ms, raising an open hand into frame still fires a spurious
# swipe up. 250ms swallows the entry motion reliably, and a deliberate swipe
# is unaffected because you naturally pause before making one.
SWIPE_SETTLE_MS = 250

# Clap: two palms converge, touch, then part. Distances are palm-centre gap
# over hand scale, so they hold at any distance from the camera.
CLAP_TOUCH = 1.30        # palms this close count as contact
CLAP_RELEASE = 1.90      # and this far apart counts as parted
CLAP_APPROACH = 0.05     # gap must be shrinking this fast to arm the clap
# Generous: at 20-30fps the contact spans several frames, and hands rebound
# over a couple hundred ms more. Too tight and a normal clap misses entirely.
CLAP_WINDOW_MS = 900
CLAP_REFRACTORY_MS = 900  # ignore repeat claps (and the rebound) after firing

# Poses the built-in classifier cannot distinguish, where the landmark
# geometry is authoritative. It labels any single raised finger "Pointing_Up",
# so without this a raised middle finger fires whatever Pointing_Up is bound to.
_GEOMETRY_WINS = frozenset({"Middle_Finger", "Pinky"})

# Hold gestures reset if the wrist wanders (prevents drive-by triggers).
HOLD_DRIFT = 0.10

# How long a `while_held` gesture may go unrecognised before it is released.
# Pose classification flickers frame to frame (a curled finger reads as
# extended for a frame, motion blurs the hand); without this grace period a
# held action would end almost immediately.
HELD_GRACE_MS = 700


def _dist(a, b):
    return ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) ** 0.5


class SnapDetector:
    """Per-hand state machine: IDLE -> TOUCH -> (fast release) -> fire."""

    def __init__(self):
        self.touching = False
        self.touch_start = 0.0
        self.last_seen = None

    def update(self, lms, now_ms):
        # The hand routinely drops out of tracking mid-snap (fast motion, or
        # fingers leaving frame). Without this, `touching` survives the gap
        # with a stale touch_start, so the eventual release is measured
        # against an ancient timestamp, lands outside SNAP_WINDOW_MS, and the
        # snap silently never fires.
        if self.last_seen is not None and now_ms - self.last_seen > 250:
            self.touching = False
        self.last_seen = now_ms

        ratio = _dist(lms[THUMB_TIP], lms[MIDDLE_TIP]) / hand_scale(lms)
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


class DoublePinchDetector:
    """Per-hand: two thumb-index contacts in quick succession.

    Reads the raw thumb-index distance rather than FingerState.pinching, so it
    can fire before the sustained-pinch hold has elapsed — otherwise the first
    contact of a double pinch would already have registered as a plain Pinch.
    """

    def __init__(self):
        self.closed = False
        self.closed_at = 0.0
        self.last_release = None
        self.last_seen = None

    def update(self, lms, now_ms):
        # Same dropout guard as SnapDetector: a stale half-finished double
        # pinch must not pair with a contact from seconds later.
        if self.last_seen is not None and now_ms - self.last_seen > 250:
            self.closed = False
            self.last_release = None
        self.last_seen = now_ms

        ratio = _dist(lms[THUMB_TIP], lms[INDEX_TIP]) / hand_scale(lms)
        thr = PINCH_OFF if self.closed else PINCH_ON
        close = ratio < thr

        fired = False
        if close and not self.closed:
            self.closed = True
            self.closed_at = now_ms
        elif not close and self.closed:
            self.closed = False
            # Ignore single-frame flickers; they are tracking noise, not intent.
            if now_ms - self.closed_at >= DPINCH_MIN_MS:
                if (self.last_release is not None
                        and now_ms - self.last_release <= DPINCH_GAP_MS):
                    fired = True
                    self.last_release = None   # consume, don't chain triples
                else:
                    self.last_release = now_ms
        # Expire a lone first pinch so it cannot pair with a much later one.
        if (self.last_release is not None
                and now_ms - self.last_release > DPINCH_GAP_MS):
            self.last_release = None
        return fired


class ClapDetector:
    """Two palms meeting, then parting — a clap.

    Distance is measured between palm centres and divided by hand scale, so
    the thresholds hold whether the hands are near the lens or far from it.
    Requires an approach (hands closing fast) before the contact counts, which
    is what separates a clap from hands that merely rest close together.
    """

    def __init__(self):
        self.closed = False
        self.closed_at = 0.0
        self.prev_gap = None
        self.approaching = False
        self.last_seen = None
        # None, not 0: with 0 the refractory check compares against the epoch
        # and swallows the very first clap of the session.
        self.last_fire = None

    def update(self, left, right, now_ms):
        if self.last_seen is not None and now_ms - self.last_seen > 250:
            self.closed = False
            self.approaching = False
            self.prev_gap = None
        self.last_seen = now_ms

        # Palm centre: midpoint of wrist and middle-finger knuckle.
        def centre(l):
            return ((l[WRIST].x + l[MIDDLE_MCP].x) / 2,
                    (l[WRIST].y + l[MIDDLE_MCP].y) / 2)

        lc, rc = centre(left), centre(right)
        scale = max(hand_scale(left), hand_scale(right))
        gap = ((lc[0] - rc[0]) ** 2 + (lc[1] - rc[1]) ** 2) ** 0.5 / scale

        fired = False
        if self.prev_gap is not None:
            closing = self.prev_gap - gap
            if closing > CLAP_APPROACH:
                self.approaching = True
            if not self.closed and gap < CLAP_TOUCH and self.approaching:
                self.closed = True
                self.closed_at = now_ms
            elif self.closed and gap > CLAP_RELEASE:
                self.closed = False
                self.approaching = False
                if (now_ms - self.closed_at < CLAP_WINDOW_MS
                        and (self.last_fire is None
                             or now_ms - self.last_fire > CLAP_REFRACTORY_MS)):
                    self.last_fire = now_ms
                    fired = True
        self.prev_gap = gap
        return fired


class SwipeDetector:
    """Fast palm motion while the hand is open — horizontal or vertical."""

    def __init__(self):
        self.history = []  # (t_ms, x, y)
        self.entered_at = None

    @staticmethod
    def _travel(vals, cur):
        """Signed excursion from whichever extreme of the window is furthest.

        Measuring against the extreme rather than the oldest sample means a
        swipe that starts mid-window still registers its full travel.
        """
        up = cur - min(vals)
        down = cur - max(vals)
        return up if abs(up) >= abs(down) else down

    def update(self, lms, gesture_name, now_ms, fingers_up=None):
        # Gate on geometry, not the model's label: a swiping hand is motion
        # blurred, and the classifier stops calling it Open_Palm mid-swipe.
        open_hand = (fingers_up >= SWIPE_MIN_FINGERS if fingers_up is not None
                     else gesture_name == "Open_Palm")
        if not open_hand:
            self.history.clear()
            self.entered_at = None
            return None

        # Ignore the first moments after an open hand appears: raising your
        # hand into frame is itself fast upward motion and would otherwise
        # register as a swipe before you have done anything.
        if self.entered_at is None:
            self.entered_at = now_ms
        if now_ms - self.entered_at < SWIPE_SETTLE_MS:
            return None

        # Track the palm centre rather than the wrist: the wrist barely moves
        # when you swipe from the elbow, which is how people actually swipe.
        x = (lms[WRIST].x + lms[MIDDLE_MCP].x) / 2
        y = (lms[WRIST].y + lms[MIDDLE_MCP].y) / 2
        self.history.append((now_ms, x, y))
        self.history = [h for h in self.history
                        if now_ms - h[0] <= SWIPE_WINDOW_MS]
        if len(self.history) < 3:
            return None

        dx = self._travel([h[1] for h in self.history], x)
        dy = self._travel([h[2] for h in self.history], y)

        # One axis must clearly dominate. A sloppy diagonal wave otherwise
        # satisfies both thresholds and fires whichever is tested first.
        if abs(dx) >= SWIPE_DIST and abs(dx) >= abs(dy) * SWIPE_DOMINANCE:
            self.history.clear()
            # Frame is already mirrored, so +x is the user's right.
            return "Swipe_Right" if dx > 0 else "Swipe_Left"
        if abs(dy) >= SWIPE_DIST_Y and abs(dy) >= abs(dx) * SWIPE_DOMINANCE:
            self.history.clear()
            # Image y grows downward, so +dy means the hand moved down.
            return "Swipe_Down" if dy > 0 else "Swipe_Up"
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
        self.dpinch = [DoublePinchDetector(), DoublePinchDetector()]
        self.clap = ClapDetector()
        self.swipe = [SwipeDetector(), SwipeDetector()]
        self.smooth = [LandmarkSmoother(), LandmarkSmoother()]
        self.fingers = [FingerState(), FingerState()]
        self.snap_until = [0, 0]   # geometry poses muted until this time
        self._hands = []
        # Set by the app: called with the binding when a `while_held` gesture
        # ends, so push-to-talk actions can release their keys.
        self.on_release = None
        # Called each frame while a `while_held` binding is active, with the
        # hand's offset from where the gesture began. Drives drag actions.
        self.on_hold = None
        self.held_origin = (0.0, 0.0)
        self.held_binding = None
        self.held_name = None      # gesture that started the held binding
        self.held_lost_at = None   # when it first went missing
        self.finger_code = ""   # HUD: which digits are up, e.g. '.IM..'

        # Geometry poses only win when the built-in model is unsure. The
        # bundled classifier is better at the seven it knows than a
        # hand-rolled test would be, so it keeps priority on those.
        self.prefer_geometry = bool(config.get("prefer_geometry", False))

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

    def smoothed_hands(self):
        """Landmarks as of the last update() — what the engine actually saw."""
        return self._hands

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

        # Smooth every hand up front so the detectors, the extension tests and
        # the on-screen dots all read the same de-jittered landmarks.
        hands = [self.smooth[i](lms, now_ms)
                 for i, lms in enumerate(landmarks[:2])]
        for i in range(len(hands), 2):
            self.smooth[i].reset()
        self._hands = hands

        # Update the finger vectors first: the swipe detector gates on how many
        # fingers are up, so it needs this frame's values, not last frame's.
        for i in range(len(hands)):
            self.fingers[i].update(hands[i], now_ms)

        # Clap needs both hands, so it lives outside the per-hand loop. Use
        # raw landmarks: smoothing lags the fast approach that arms it.
        if len(landmarks) >= 2:
            if self.clap.update(landmarks[0], landmarks[1], now_ms):
                notices.append("clap!")
                self._fire_discrete("Clap", now_ms, events)

        # Discrete detectors (snap / swipe) per hand.
        snapped = [False] * len(hands)
        for i in range(len(hands)):
            name = gesture_names[i] if i < len(gesture_names) else ""
            if self.snap[i].update(hands[i], now_ms):
                snapped[i] = True
                self.snap_until[i] = now_ms + SNAP_MASK_MS
                notices.append("snap!")
                self._fire_discrete("Snap", now_ms, events)
            if self.dpinch[i].update(hands[i], now_ms):
                # Mute geometry poses too: the hand is still mid-pinch, which
                # would otherwise immediately register as a plain Pinch.
                self.snap_until[i] = now_ms + SNAP_MASK_MS
                notices.append("double pinch!")
                self._fire_discrete("Double_Pinch", now_ms, events)
            # Swipes read RAW landmarks: One Euro smoothing lags fast motion by
            # ~0.04 screen widths, which is a third of the swipe threshold, so
            # a real swipe measures short and never fires. Smoothing still
            # governs the pose tests, where stability is what matters.
            raw = landmarks[i] if i < len(landmarks) else hands[i]
            # A pinching hand has its other three fingers extended, so it
            # clears the swipe finger-count gate — and pinch-and-drag is
            # deliberate motion of exactly that hand. Report zero fingers
            # while pinching so a drag cannot also fire a swipe.
            up = 0 if self.fingers[i].pinching else self.fingers[i].count
            sw = self.swipe[i].update(raw, name, now_ms, fingers_up=up)
            # One-handed only. A clap is two open palms rushing toward each
            # other, which reads as a swipe on BOTH hands at once — firing
            # left and right together before the clap itself resolves.
            if sw and len(hands) == 1:
                notices.append(sw.lower())
                self._fire_discrete(sw, now_ms, events)
            elif sw:
                # Discard the travel that accumulated while two hands were up,
                # so a swipe cannot fire the instant the second hand leaves.
                self.swipe[i].history.clear()

        # Per-hand finger vector, and the geometry pose it implies.
        geo = []
        for i in range(len(hands)):
            pose = classify(self.fingers[i])     # already updated above
            # Right after a snap the hand is mid-recoil and drifts through
            # poses it never meant; ignore geometry briefly so the snap's own
            # action is not immediately overridden.
            if now_ms < self.snap_until[i]:
                pose = None
            geo.append(pose)
        self.finger_code = self.fingers[0].code() if hands else ""

        # Primary continuous gesture: the built-in category if the model named
        # one, else the geometry pose. `prefer_geometry` flips that order.
        primary, wrist = None, None
        for i in range(len(hands)):
            model = gesture_names[i] if i < len(gesture_names) else ""
            model = model if model and model != "None" else None
            pose = geo[i] if i < len(geo) else None
            # A geometry pose that is bound beats an unbound model category.
            # The classifier often names a pose the config never binds (it
            # labels many hand shapes Pointing_Up) — the model would win, the
            # action would never fire, and any flicker between the two would
            # start and instantly stop a `while_held` action.
            if pose and pose in self.bindings and model not in self.bindings:
                pick = pose
            elif pose in _GEOMETRY_WINS:
                # The classifier cannot tell one raised finger from another —
                # it reports Pointing_Up for a raised middle finger too. Which
                # finger it is comes from the landmarks, so geometry decides.
                pick = pose
            else:
                pick = ((pose or model) if self.prefer_geometry
                        else (model or pose))
            if pick:
                primary, wrist = pick, hands[i][WRIST]
                break
        # Fall back to the raw landmarks so smoothing never costs us a hand.
        if primary is None and landmarks:
            wrist = landmarks[0][WRIST]

        if primary != self.hold_name:
            # A `while_held` gesture (push-to-talk) must survive brief
            # misreads: one frame where a curled finger looks extended, or the
            # hand blurs, would otherwise cut the action short. Only
            # release once the gesture has been continuously absent for
            # HELD_GRACE_MS.
            if self.held_binding is not None:
                if primary == self.held_name:
                    self.held_lost_at = None        # gesture came back
                else:
                    if self.held_lost_at is None:
                        self.held_lost_at = now_ms
                    if now_ms - self.held_lost_at < HELD_GRACE_MS:
                        # Still within grace: keep holding, and keep the
                        # gesture "current" so the hold state is not reset.
                        self.hold_name = self.held_name
                        return events, notices
                    if self.on_release:
                        notices.append(self.on_release(self.held_binding))
                    self.held_binding = None
                    self.held_lost_at = None
            self._reset_hold(primary, wrist, now_ms)
        elif (primary and wrist and self.hold_anchor
                and self.held_binding is None):
            # Drift reset is skipped while a `while_held` binding is active:
            # a hand naturally wanders while you talk, and resetting would
            # re-fire the action without ever releasing the keys.
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
                        if b.get("while_held"):
                            self.held_binding = b
                            self.held_name = primary
                            self.held_lost_at = None
                            # Anchor the drag where the gesture began, so
                            # movement is measured from the grab point.
                            self.held_origin = (wrist.x, wrist.y)
                elif self.held_binding is b and self.on_hold:
                    # Continuous update while held: the action reads how far
                    # the hand has travelled from where it grabbed.
                    note = self.on_hold(b, wrist.x - self.held_origin[0],
                                        wrist.y - self.held_origin[1])
                    if note:
                        notices.append(note)
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
