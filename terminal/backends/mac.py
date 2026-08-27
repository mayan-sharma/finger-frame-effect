"""macOS backend. Keystrokes via AppleScript (System Events) — requires
granting the terminal app Accessibility permission in System Settings >
Privacy & Security > Accessibility the first time it fires."""

import subprocess
import time
from pathlib import Path

KEY_CODES = {"esc": 53, "enter": 36, "tab": 48, "space": 49,
             "left": 123, "right": 124, "down": 125, "up": 126}


def _osa(script):
    subprocess.run(["osascript", "-e", script], capture_output=True, timeout=10)


def press(combo):
    parts = [k.strip().lower() for k in combo.split("+")]
    mods = [m for m in parts if m in ("cmd", "ctrl", "alt", "shift")]
    keys = [k for k in parts if k not in mods]
    mod_map = {"cmd": "command down", "ctrl": "control down",
               "alt": "option down", "shift": "shift down"}
    using = (" using {" + ", ".join(mod_map[m] for m in mods) + "}") if mods else ""
    for k in keys:
        if k in KEY_CODES:
            _osa(f'tell application "System Events" to key code {KEY_CODES[k]}{using}')
        else:
            _osa(f'tell application "System Events" to keystroke "{k}"{using}')
    return f"keys: {combo}"


# Push-to-talk needs CGEvent, not AppleScript.
#
# System Events posts keystrokes at a level that global hotkey listeners
# (Wispr Flow, and most CGEventTap-based apps) do not observe: the keys report
# success but the app never reacts. Posting to kCGHIDEventTap puts the event in
# at the same place real hardware does, which those listeners do see.
# Verified: an AppleScript hold produced no dictation session; the identical
# CGEvent hold made Wispr start recording.
_MOD_CODES = {"cmd": 0x37, "shift": 0x38, "alt": 0x3A, "ctrl": 0x3B}
_CHAR_CODES = {"a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04,
               "g": 0x05, "z": 0x06, "x": 0x07, "c": 0x08, "v": 0x09,
               "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F,
               "y": 0x10, "t": 0x11, "o": 0x1F, "u": 0x20, "i": 0x22,
               "p": 0x23, "l": 0x25, "j": 0x26, "k": 0x28, "n": 0x2D,
               "m": 0x2E, "space": 0x31, "esc": 0x35, "tab": 0x30,
               "enter": 0x24}


def _cg_parse(combo):
    parts = [k.strip().lower() for k in combo.split("+")]
    mods = [m for m in parts if m in _MOD_CODES]
    keys = [k for k in parts if k not in _MOD_CODES]
    return mods, keys


def _cg_flags(mods):
    import Quartz
    m = {"cmd": Quartz.kCGEventFlagMaskCommand,
         "alt": Quartz.kCGEventFlagMaskAlternate,
         "ctrl": Quartz.kCGEventFlagMaskControl,
         "shift": Quartz.kCGEventFlagMaskShift}
    flags = 0
    for mod in mods:
        flags |= m[mod]
    return flags


def _cg_post(code, down, flags=0):
    import Quartz
    ev = Quartz.CGEventCreateKeyboardEvent(None, code, down)
    if flags:
        Quartz.CGEventSetFlags(ev, flags)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)


_hold_stop = None       # Event that ends the keep-alive thread
_hold_thread = None


def _flags_changed(code, mask):
    """Post a real modifier-state change, the way hardware modifiers do.

    Key-down events for modifier keycodes do NOT hold the modifier: the flags
    never accumulate. A kCGEventFlagsChanged event does.
    """
    import Quartz
    src = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStatePrivate)
    ev = Quartz.CGEventCreate(src)
    Quartz.CGEventSetType(ev, Quartz.kCGEventFlagsChanged)
    Quartz.CGEventSetIntegerValueField(ev, Quartz.kCGKeyboardEventKeycode, code)
    Quartz.CGEventSetFlags(ev, mask)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)


def press_down(combo):
    """Hold a combo down until press_up() releases it (push-to-talk).

    macOS decays synthetic modifier state after roughly a second, which ends
    push-to-talk dictation on its own. A background thread re-asserts the
    flags every 250ms so the modifiers stay genuinely held.
    """
    global _hold_stop, _hold_thread
    import threading
    press_up(combo)             # clear any half-finished previous hold
    mods, keys = _cg_parse(combo)
    flags = _cg_flags(mods)
    for mod in mods:
        _flags_changed(_MOD_CODES[mod], flags)
    # Tap the character key rather than holding it: listeners read the held
    # modifiers as "still active", and a held character key would autorepeat.
    for k in keys:
        code = _CHAR_CODES.get(k)
        if code is not None:
            _cg_post(code, True, flags)
            _cg_post(code, False, flags)

    last_mod = _MOD_CODES[mods[-1]] if mods else None
    if last_mod is not None:
        _hold_stop = threading.Event()

        def keepalive(stop=_hold_stop, code=last_mod, mask=flags):
            while not stop.wait(0.25):
                _flags_changed(code, mask)

        _hold_thread = threading.Thread(target=keepalive, daemon=True)
        _hold_thread.start()
    return f"holding {combo}"


def press_up(combo):
    global _hold_stop, _hold_thread
    if _hold_stop is not None:
        _hold_stop.set()
        _hold_stop = None
        _hold_thread = None
    mods, _ = _cg_parse(combo)
    remaining = _cg_flags(mods)
    for mod in reversed(mods):
        remaining &= ~_cg_flags([mod])
        _flags_changed(_MOD_CODES[mod], remaining)
    return f"released {combo}"


def scroll(amount=3):
    """Scroll the view under the cursor. Positive scrolls up, negative down.

    A real scroll-wheel event rather than arrow keys: arrows only move a
    focused text caret, while a wheel event scrolls whatever is under the
    pointer, which is what people expect from a swipe.
    """
    import Quartz
    ev = Quartz.CGEventCreateScrollWheelEvent(
        None, Quartz.kCGScrollEventUnitLine, 1, int(amount))
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
    return f"scroll {'up' if amount > 0 else 'down'}"


def volume(direction):
    if direction == "mute":
        _osa("set volume with output muted")
        return "muted"
    sign = "+" if direction == "up" else "-"
    _osa(f"set volume output volume ((output volume of (get volume settings)) {sign} 6)")
    return f"volume {direction}"


def get_volume():
    r = subprocess.run(
        ["osascript", "-e", "output volume of (get volume settings)"],
        capture_output=True, text=True, timeout=10)
    try:
        return int(r.stdout.strip())
    except ValueError:
        return 50


def set_volume(level):
    """Set absolute output volume, 0-100.

    A drag needs absolute positioning: nudging by a delta each frame would
    accumulate rounding and drift away from where the hand actually is.
    """
    level = max(0, min(100, int(level)))
    _osa(f"set volume output volume {level}")
    return level


def media(cmd):
    verb = {"play_pause": "playpause", "next": "next track", "prev": "previous track"}[cmd]
    # Prefer Spotify if it's running, else Music.
    _osa(
        f'if application "Spotify" is running then\n'
        f'  tell application "Spotify" to {verb}\n'
        f'else if application "Music" is running then\n'
        f'  tell application "Music" to {verb}\n'
        f"end if"
    )
    return f"media: {cmd}"


def screenshot():
    out = Path.home() / "Desktop" / f"gesture-shot-{time.strftime('%Y%m%d-%H%M%S')}.png"
    subprocess.run(["screencapture", "-x", str(out)], timeout=15)
    return f"screenshot -> {out.name}"


def lock():
    subprocess.run(["pmset", "displaysleepnow"], timeout=10)
    return "display locked"


def open_uri(uri, background=False):
    """Open a URI. With background=True the target app is NOT brought forward.

    Dictation needs this: `open` normally activates the handling app, so Wispr
    would steal focus and insert the transcript into its own window instead of
    whatever you were typing in.
    """
    cmd = ["open", "-g", uri] if background else ["open", uri]
    subprocess.run(cmd, check=True, timeout=10)


def launch_config_dir():
    return Path.home() / ".warp" / "launch_configurations"


def enable_vt():
    pass  # macOS terminals speak VT natively


def warp_tab(command=None, cwd=None):
    """Open a new tab in the existing Warp window and optionally run a command.

    Warp launch configurations always spawn a *window* (their YAML is keyed by
    `windows:`), and warp://action/new_tab is not a supported URI. So drive the
    real UI instead: focus Warp, press Cmd+T, then type. Requires Accessibility.
    """
    _osa('tell application "Warp" to activate')
    time.sleep(0.35)          # let the window take focus before keys land
    _osa('tell application "System Events" to keystroke "t" using {command down}')
    # A freshly opened tab is still wiring up its shell; text sent too early is
    # accepted character-by-character and the first ones get dropped
    # ("claude" -> "claue"). Wait for the tab to settle before typing.
    time.sleep(1.0)
    line = ""
    if cwd and cwd != "~":
        line += f"cd {cwd} && "
    if command:
        line += command
    if line:
        # Type with a per-character delay. A single bulk `keystroke` outruns
        # Warp's input handling and silently loses characters.
        _osa('tell application "System Events"\n'
             'set fast to 0.012\n'
             + "\n".join(f'keystroke "{c}"\ndelay fast'
                         for c in line.replace('"', '\\"'))
             + '\nend tell')
        # Warp needs a beat to render the typed text before Return will submit
        # it; sending them back-to-back drops the Return on the floor.
        time.sleep(0.3)
        _osa('tell application "System Events" to key code 36')  # Return
    return f"warp tab: {command or 'new tab'}"


def warp_esc():
    _osa('tell application "Warp" to activate')
    time.sleep(0.2)
    _osa('tell application "System Events" to key code 53')
    return "sent Esc to Warp"
