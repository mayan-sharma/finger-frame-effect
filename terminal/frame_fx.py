"""Finger-frame portal: two L-hands make a box, and the box becomes an effect.

Hold both hands in an open "L" (thumb + index spread apart) like a director
framing a shot. The quad between the four fingertips turns into a live effect
window over the preview. Pick the effect in config.json ("frame_effect") or
with --frame-fx:

  * matrix   — Matrix rain falls in front of everything inside the frame.
               Set "frame_keep_person" (or --keep-person) to cut yourself out
               of the rain instead, so it falls behind you.
  * anime    — AnimeGANv2 (Hayao/Ghibli) restyles whatever you frame: ink
               outlines, cel-shaded colour. Inference runs on a worker thread
               so tracking never stalls; the newest finished frame is stretched
               to wherever the quad has moved since.
  * pixelate — chunky mosaic, censor-cam style.
  * invert   — negative film.

Everything is tuned for the half-block preview: the rain runs on a coarse
grid upscaled with NEAREST so it stays readable at ~100 terminal columns,
where fine glyphs would smear into mush.

Detection matches the browser app this repo grew out of: per-hand thumb-index
spread with hysteresis, fingertips ordered left-index → right-index →
right-thumb → left-thumb, gated on quad area and bowtie rejection, with a
presence fade so the portal breathes in and out instead of popping.

While the frame is up, both hands are busy framing — the app suppresses
gesture actions so an L-hand misread as Pointing_Up cannot fire a binding.
"""

import threading
import urllib.request
from pathlib import Path

import cv2
import numpy as np

from fingers import WRIST, THUMB_TIP, INDEX_TIP, hand_scale

EFFECTS = ("matrix", "anime", "pixelate", "invert")

SPREAD_ON = 0.70   # thumb-index spread / hand scale, to activate
SPREAD_OFF = 0.30  # spread to stay active (hysteresis)
AREA_MIN = 0.005   # quad area as a fraction of the frame
AREA_MAX = 0.60
LOST_MS = 350      # how long the quad survives a tracking dropout
FADE_IN = 0.22     # presence lerp per frame while visible…
FADE_OUT = 0.12    # …and while lost (slower, so it lingers a beat)

SEG_MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/"
                 "image_segmenter/selfie_segmenter/float16/latest/"
                 "selfie_segmenter.tflite")

# AnimeGANv2 (Hayao). NHWC float32 in [-1, 1], dynamic H/W.
ANIME_MODEL_URL = ("https://huggingface.co/vumichien/AnimeGANv2_Hayao/"
                   "resolve/main/AnimeGANv2_Hayao.onnx")
# Inference width. The portal is at most a couple hundred terminal sub-pixels
# across, so a wider input buys nothing visible and costs quadratic time —
# measured ~54ms at 192x128 on CoreML versus ~220ms at 384x256.
ANIME_W = 192
ANIME_ALIGN = 32     # the generator downsamples 3x; keep both dims divisible


def _poly_area(q):
    """Shoelace over normalized coords == area as a fraction of the frame."""
    a = 0.0
    for i in range(4):
        px, py = q[i]
        nx, ny = q[(i + 1) % 4]
        a += px * ny - nx * py
    return abs(a) / 2


def _segs_intersect(a, b, c, d):
    def cross(o, p, q):
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    d1, d2 = cross(c, d, a), cross(c, d, b)
    d3, d4 = cross(a, b, c), cross(a, b, d)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def _is_bowtie(q):
    """A quad whose opposite edges cross is a mis-detection, not a frame."""
    return (_segs_intersect(q[0], q[1], q[2], q[3])
            or _segs_intersect(q[1], q[2], q[3], q[0]))


class MatrixRain:
    """Digital rain on a coarse grid, sized for half-block terminal video.

    Columns fall at fixed per-column speeds seeded once, so the rain is
    deterministic and steady rather than reshuffling every frame. Rendered
    tiny and upscaled with NEAREST: the chunky cells *are* the aesthetic at
    terminal resolution.
    """

    COLS, ROWS = 48, 36
    TRAIL = 10

    def __init__(self):
        rng = np.random.default_rng(7)
        self.speed = rng.uniform(6.0, 18.0, self.COLS)      # rows / second
        self.phase = rng.uniform(0, self.ROWS, self.COLS)
        # Per-cell brightness jitter, fixed in space: reads as glyph texture.
        self.grain = rng.uniform(0.55, 1.0, (self.ROWS, self.COLS)).astype(np.float32)

    def render(self, w, h, t_s):
        span = self.ROWS + self.TRAIL
        head = (self.phase + t_s * self.speed) % span
        body = np.zeros((self.ROWS, self.COLS), np.float32)
        heads = np.zeros_like(body)
        cols = np.arange(self.COLS)
        for k in range(self.TRAIL):
            rows = np.floor(head).astype(int) - k
            ok = (rows >= 0) & (rows < self.ROWS)
            fade = 1.0 - k / self.TRAIL
            layer = heads if k == 0 else body
            np.maximum.at(layer, (rows[ok], cols[ok]), fade)
        body *= self.grain

        img = np.zeros((self.ROWS, self.COLS, 3), np.float32)   # BGR
        img[..., 0] = body * 30 + heads * 190
        img[..., 1] = body * 235 + heads * 255
        img[..., 2] = body * 40 + heads * 210
        img = np.clip(img, 0, 255).astype(np.uint8)
        return cv2.resize(img, (w, h), interpolation=cv2.INTER_NEAREST)


class AnimeStylizer:
    """AnimeGANv2 on a worker thread, always stylizing the freshest frame.

    Inference costs ~55ms, which would halve the capture rate if it ran
    inline. Instead the render loop drops off its latest crop and picks up
    whatever the worker has finished; the result is stretched to wherever the
    quad has moved since. The portal therefore trails reality by roughly one
    inference, and tracking keeps full speed.

    Only ever one job is pending: a queued crop that has been superseded is
    discarded rather than rendered late.
    """

    def __init__(self, model_path):
        self.path = Path(model_path)
        self.session = None
        self.input_name = None
        self.result = None          # newest stylized BGR image
        self._job = None            # crop awaiting inference
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = False
        self._thread = None
        self.errors = 0
        self.last_error = None

    def load(self, quiet=False):
        """Create the session up front; returns False if unavailable."""
        try:
            import onnxruntime as ort
            opts = ort.SessionOptions()
            opts.log_severity_level = 3
            # CPU only, deliberately. The CoreML EP compiles this graph but
            # then throws "GetElementType is not implemented" at run time on
            # its dynamic non-square input, and its error spew lands in the
            # middle of the video. Measured, CPU is only ~25% slower here
            # (~69ms vs ~54ms at 192x128) — not worth a corrupted display.
            self.session = ort.InferenceSession(
                str(self.path), opts, providers=["CPUExecutionProvider"])
            self.input_name = self.session.get_inputs()[0].name
            # Warm up now, while printing is still safe: the first run pays
            # for lazy kernel setup and would otherwise stall the first
            # framed shot by several hundred milliseconds.
            warm = np.zeros((1, ANIME_ALIGN * 4, ANIME_W, 3), np.float32)
            self.session.run(None, {self.input_name: warm})
        except Exception as err:
            if not quiet:
                print(f"Anime effect unavailable ({err}).")
            self.last_error = str(err)
            return False
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return True

    def submit(self, crop):
        """Hand the worker a BGR crop to stylize (replaces any pending one)."""
        with self._lock:
            self._job = crop
        self._wake.set()

    def latest(self):
        with self._lock:
            return self.result

    def close(self):
        self._stop = True
        self._wake.set()

    def _run(self):
        while not self._stop:
            self._wake.wait()
            self._wake.clear()
            with self._lock:
                crop = self._job
                self._job = None
            if crop is None or self._stop:
                continue
            try:
                out = self._infer(crop)
            except Exception as err:
                # One bad frame must not kill the worker, but a model that
                # fails every time should not fail silently for ever either.
                self.errors += 1
                if self.errors == 1:
                    self.last_error = str(err)
                continue
            with self._lock:
                self.result = out

    def _infer(self, crop):
        h, w = crop.shape[:2]
        tw = ANIME_W
        th = max(ANIME_ALIGN, round(h * tw / w / ANIME_ALIGN) * ANIME_ALIGN)
        small = cv2.resize(crop, (tw, th), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).astype(np.float32)
        out = self.session.run(None, {self.input_name: rgb[None] / 127.5 - 1})
        img = ((out[0][0] + 1) * 127.5).clip(0, 255).astype(np.uint8)
        return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


class FrameFx:
    """Detects the two-L fingertip quad and renders the chosen effect in it."""

    def __init__(self, effect, model_dir, keep_person=False):
        assert effect in EFFECTS
        self.effect = effect
        # matrix only: cut the person out of the rain so they stay real and the
        # rain falls *behind* them. Off by default — the rain reads as an
        # effect layered in front of you, which is what the gesture implies.
        self.keep_person = keep_person
        self.model_dir = Path(model_dir)
        self.spread = [False, False]
        self.quad = None          # last good quad, normalized [(x, y) x 4]
        self.last_ok_ms = 0
        self.presence = 0.0
        self.rain = MatrixRain()
        self.t0_ms = None
        self._seg = None
        self._seg_state = "idle"  # idle | ready | error
        self._anime = None

    # -- setup ---------------------------------------------------------------

    def prepare(self, quiet=False):
        """Load whatever model the chosen effect needs.

        Called before the preview takes over the terminal, so downloads and
        failures can print normally instead of corrupting the video area.
        `quiet` suppresses that printing for live switches, where the preview
        owns the screen and the HUD reports status instead.
        """
        say = (lambda *_: None) if quiet else print
        if self.effect == "anime":
            if self._anime is not None:
                return                      # already loaded
            path = self.model_dir / "animegan_hayao.onnx"
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                say("Downloading AnimeGANv2 model (~8 MB)…")
                urllib.request.urlretrieve(ANIME_MODEL_URL, path)
            stylizer = AnimeStylizer(path)
            if stylizer.load(quiet=quiet):
                self._anime = stylizer
            else:
                say("Falling back to pixelate for the frame portal.")
                self.effect = "pixelate"
            return
        if (self.effect != "matrix" or not self.keep_person
                or self._seg_state != "idle"):
            return
        try:
            path = self.model_dir / "selfie_segmenter.tflite"
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                print("Downloading selfie segmentation model (~250 KB)…")
                urllib.request.urlretrieve(SEG_MODEL_URL, path)
            from mediapipe.tasks.python import BaseOptions, vision
            self._seg = vision.ImageSegmenter.create_from_options(
                vision.ImageSegmenterOptions(
                    base_options=BaseOptions(model_asset_path=str(path)),
                    running_mode=vision.RunningMode.VIDEO,
                    output_confidence_masks=True,
                ))
            self._seg_state = "ready"
        except Exception as err:  # offline, bad wheel, …: degrade, don't die
            print(f"Selfie segmentation unavailable ({err}); "
                  "matrix will fill the whole frame.")
            self._seg_state = "error"

    # -- detection -----------------------------------------------------------

    def _detect(self, hands):
        if len(hands) < 2:
            self.spread = [False, False]
            return None
        pts = []
        for i, lms in enumerate(hands[:2]):
            gap = ((lms[THUMB_TIP].x - lms[INDEX_TIP].x) ** 2 +
                   (lms[THUMB_TIP].y - lms[INDEX_TIP].y) ** 2) ** 0.5
            spread = gap / hand_scale(lms)
            thr = SPREAD_OFF if self.spread[i] else SPREAD_ON
            self.spread[i] = spread > thr
            if not self.spread[i]:
                return None
            pts.append(lms)
        # Anatomical order: left hand's index is top-left, right hand's index
        # top-right, then down to the thumbs.
        pts.sort(key=lambda lms: lms[WRIST].x)
        left, right = pts
        quad = [(left[INDEX_TIP].x, left[INDEX_TIP].y),
                (right[INDEX_TIP].x, right[INDEX_TIP].y),
                (right[THUMB_TIP].x, right[THUMB_TIP].y),
                (left[THUMB_TIP].x, left[THUMB_TIP].y)]
        area = _poly_area(quad)
        if not (AREA_MIN <= area <= AREA_MAX) or _is_bowtie(quad):
            return None
        return quad

    def set_effect(self, effect):
        """Switch effects live, loading that effect's model on first use.

        Returns a short status string for the HUD. Loading happens inline —
        the models are small and already cached after the first switch, and a
        one-frame hitch is preferable to a portal that silently shows the raw
        feed while something loads in the background.
        """
        if effect not in EFFECTS or effect == self.effect:
            return None
        self.effect = effect
        self.prepare(quiet=True)
        return self.effect

    def close(self):
        if self._anime:
            self._anime.close()

    def update(self, hands, now_ms):
        """Feed smoothed landmarks; returns True while the portal is active."""
        raw = self._detect(hands)
        if raw:
            self.quad = raw
            self.last_ok_ms = now_ms
        visible = self.quad is not None and now_ms - self.last_ok_ms <= LOST_MS
        self.presence += ((1.0 if visible else 0.0) - self.presence) * \
            (FADE_IN if visible else FADE_OUT)
        if not visible and self.presence < 0.02:
            self.presence = 0.0
            self.quad = None
        return self.active

    @property
    def active(self):
        return self.quad is not None and self.presence > 0.02

    # -- rendering -----------------------------------------------------------

    def _person_mask(self, mp_img, now_ms):
        """Person confidence at frame resolution, or None."""
        if self._seg_state != "ready":
            return None
        res = self._seg.segment_for_video(mp_img, now_ms)
        masks = res.confidence_masks
        if not masks:
            return None
        conf = masks[-1].numpy_view().copy()
        # Channel semantics differ between segmenter variants (person-first
        # vs background-first). In a selfie the person owns the centre and
        # the top corners are room, so orient the mask by that instead of
        # trusting the channel order.
        h, w = conf.shape[:2]
        centre = float(conf[h // 3:2 * h // 3, w // 3:2 * w // 3].mean())
        corners = float((conf[:h // 6, :w // 6].mean() +
                         conf[:h // 6, -(w // 6):].mean()) / 2)
        if centre < corners:
            conf = 1.0 - conf
        return conf

    def render(self, frame, orig, mp_img, now_ms):
        """Draw the portal onto `frame`. `orig` is the ungraded camera frame:
        effect sources read from it so the portal pops out of the dimmed
        surround at full brightness."""
        h, w = frame.shape[:2]
        ease = self.presence * self.presence * (3 - 2 * self.presence)
        q = np.array([[x * w, y * h] for x, y in self.quad], np.float32)
        c = q.mean(axis=0)
        q = c + (q - c) * (0.85 + 0.15 * ease)   # pop-in from the centroid
        qi = np.round(q).astype(np.int32)

        bx = max(0, int(qi[:, 0].min()))
        by = max(0, int(qi[:, 1].min()))
        ex = min(w, int(qi[:, 0].max()) + 1)
        ey = min(h, int(qi[:, 1].max()) + 1)
        bw, bh = ex - bx, ey - by
        if bw < 8 or bh < 8:
            return frame

        if self.t0_ms is None:
            self.t0_ms = now_ms

        if self.effect == "pixelate":
            cell = max(4, w // 48)
            small = cv2.resize(orig[by:ey, bx:ex],
                               (max(2, bw // cell), max(2, bh // cell)),
                               interpolation=cv2.INTER_AREA)
            fx = cv2.resize(small, (bw, bh), interpolation=cv2.INTER_NEAREST)
        elif self.effect == "invert":
            fx = 255 - orig[by:ey, bx:ex]
        elif self.effect == "anime":
            crop = orig[by:ey, bx:ex]
            # No stylizer means prepare() never ran or the model was
            # unavailable; show the plain feed rather than crashing the loop.
            styled = None
            if self._anime is not None:
                self._anime.submit(crop.copy())
                styled = self._anime.latest()
            if styled is None:
                # Nothing stylized yet (first ~50ms): show the plain feed
                # rather than a hole where the portal should be.
                fx = orig[by:ey, bx:ex]
            else:
                fx = cv2.resize(styled, (bw, bh), interpolation=cv2.INTER_LINEAR)
        else:  # matrix
            fx = self.rain.render(bw, bh, (now_ms - self.t0_ms) / 1000.0)
            person = self._person_mask(mp_img, now_ms) if self.keep_person else None
            if person is not None:
                # Segmentation ran on the (possibly downscaled) detection
                # image; bring the mask up to render resolution first.
                if person.shape[:2] != (h, w):
                    person = cv2.resize(person, (w, h),
                                        interpolation=cv2.INTER_LINEAR)
                sigma = max(2.0, w / 210)
                pm = cv2.GaussianBlur(person, (0, 0), sigma)[by:ey, bx:ex]
                pm = pm[..., None]
                fx = (fx * (1.0 - pm) +
                      orig[by:ey, bx:ex].astype(np.float32) * pm)
                fx = fx.astype(np.uint8)

        mask = np.zeros((bh, bw), np.uint8)
        cv2.fillPoly(mask, [qi - (bx, by)], 255)
        m = (mask.astype(np.float32) / 255.0 * ease)[..., None]
        roi = frame[by:ey, bx:ex].astype(np.float32)
        frame[by:ey, bx:ex] = (roi * (1.0 - m) + fx.astype(np.float32) * m) \
            .astype(np.uint8)

        self._brackets(frame, q, ease)
        return frame

    @staticmethod
    def _brackets(frame, q, alpha):
        """Corner brackets, so the frame reads as a viewfinder."""
        h, w = frame.shape[:2]
        col = tuple([int(255 * alpha)] * 3)
        arm = max(6, int(w * 0.018))
        for i in range(4):
            p = q[i]
            for other in (q[(i + 3) % 4], q[(i + 1) % 4]):
                v = other - p
                n = float(np.hypot(*v)) or 1.0
                tip = p + v / n * min(arm, n * 0.3)
                cv2.line(frame, tuple(np.int32(p)), tuple(np.int32(tip)),
                         col, max(2, w // 480), cv2.LINE_AA)
