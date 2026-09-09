"""Platform-neutral action registry. OS specifics live in backends/."""

import subprocess
import sys

from backends import backend

LAUNCH_CONFIG = """---
name: claude
windows:
  - tabs:
      - title: claude
        layout:
          cwd: "{cwd}"
          commands:
            - exec: claude
"""


def ensure_warp_launch_config(cwd):
    d = backend.launch_config_dir()
    d.mkdir(parents=True, exist_ok=True)
    path = d / "claude.yaml"
    if not path.exists():
        path.write_text(LAUNCH_CONFIG.format(cwd=cwd), encoding="utf-8")
    return path


def warp_claude(params):
    """Open a new Claude instance as a TAB in the existing Warp window.

    Prefers a tab (what you actually want when Warp is already open); falls
    back to the launch-config window on platforms without a tab backend.
    """
    cwd = params.get("cwd", "~")
    if hasattr(backend, "warp_tab"):
        return backend.warp_tab(command="claude", cwd=cwd)
    try:
        ensure_warp_launch_config(cwd)
        backend.open_uri("warp://launch/claude")
        return "warp: launching claude"
    except OSError:
        try:
            backend.open_uri(f"warp://action/new_window?path={cwd}")
            return "warp: new window (run claude manually)"
        except OSError:
            return "warp not found"


def warp_window(params):
    """New Warp tab in the existing window (window only as a fallback)."""
    cwd = params.get("cwd", "~")
    if hasattr(backend, "warp_tab"):
        return backend.warp_tab(cwd=cwd)
    try:
        backend.open_uri(f"warp://action/new_window?path={cwd}")
        return "warp: new window"
    except OSError:
        return "warp not found"


_dictating = False
_drag_base = None      # volume level when the current drag began


def volume_drag(params):
    """Grab the volume. Held pinch + vertical movement scrubs the level."""
    global _drag_base
    if not hasattr(backend, "get_volume"):
        return "volume drag unsupported"
    _drag_base = backend.get_volume()
    return f"volume {_drag_base} — drag up/down"


def volume_drag_move(params, dx, dy):
    """Called each frame while the pinch is held. dy is offset from the grab.

    Image y grows downward, so moving the hand UP is negative dy and must
    raise the volume. `range` is the vertical travel, in normalized screen
    heights, that spans the full 0-100 sweep.
    """
    if _drag_base is None or not hasattr(backend, "set_volume"):
        return None
    span = params.get("range", 0.35)
    level = backend.set_volume(_drag_base - (dy / span) * 100)
    return f"volume {level}"


def dictate(params):
    """Toggle Wispr Flow hands-free dictation — the double-tap-Fn mode.

    Driven through Wispr's own URL scheme rather than by simulating its
    hotkey: Wispr ignores synthesized keystrokes entirely, but these routes
    start and stop a real dictation session. Toggling (rather than holding)
    means you can drop your hand and talk normally.
    """
    global _dictating
    start = params.get("start_uri", "wispr-flow://start-hands-free")
    stop = params.get("stop_uri", "wispr-flow://stop-hands-free")
    _dictating = not _dictating
    # background=True is essential: a normal `open` activates Wispr, and the
    # transcript then lands in Wispr's own window instead of the field you
    # were typing in.
    backend.open_uri(start if _dictating else stop, background=True)
    return "dictating… (repeat gesture to stop)" if _dictating else "dictation stopped"


HOLD_MOVES = {"volume_drag": volume_drag_move}


def dispatch_hold(binding, dx, dy):
    """Per-frame update for a `while_held` binding being dragged."""
    fn = HOLD_MOVES.get(binding.get("action"))
    if not fn:
        return None
    try:
        return fn(binding.get("params") or {}, dx, dy)
    except Exception as e:
        return f"drag failed: {e}"


def release(binding):
    """Undo a `while_held` binding when its gesture ends.

    Kept generic: `while_held` bindings that hold keys down release them here.
    """
    params = binding.get("params") or {}
    keys = params.get("keys")
    if keys and hasattr(backend, "press_up"):
        return backend.press_up(keys)
    return "released"


def run(params):
    flags = subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0
    subprocess.Popen(params["cmd"], shell=True, creationflags=flags)
    return f"run: {params['cmd']}"


ACTIONS = {
    "warp_claude": warp_claude,
    "warp_esc": lambda p: backend.warp_esc(),
    "warp_window": warp_window,
    "volume_up": lambda p: backend.volume("up"),
    "volume_down": lambda p: backend.volume("down"),
    "mute": lambda p: backend.volume("mute"),
    "play_pause": lambda p: backend.media("play_pause"),
    "next_track": lambda p: backend.media("next"),
    "prev_track": lambda p: backend.media("prev"),
    "dictate": dictate,
    # Falls back to arrow keys where the backend has no wheel event.
    "volume_drag": volume_drag,
    "scroll": lambda p: (backend.scroll(p.get("amount", 3))
                         if hasattr(backend, "scroll")
                         else backend.press("up" if p.get("amount", 3) > 0
                                            else "down")),
    "screenshot": lambda p: backend.screenshot(),
    "lock": lambda p: backend.lock(),
    "key": lambda p: backend.press(p["keys"]),
    "open": lambda p: (backend.open_uri(p["target"]), f"open: {p['target']}")[1],
    "run": run,
}


def dispatch(binding):
    fn = ACTIONS.get(binding.get("action"))
    if not fn:
        return f"unknown action: {binding.get('action')}"
    try:
        return fn(binding.get("params") or {})
    except Exception as e:  # keep the loop alive no matter what
        return f"action failed: {e}"
