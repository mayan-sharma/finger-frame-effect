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
    """Snap: open a new Claude instance in a Warp window."""
    cwd = params.get("cwd", "~")
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
    try:
        backend.open_uri(f"warp://action/new_window?path={params.get('cwd', '~')}")
        return "warp: new window"
    except OSError:
        return "warp not found"


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
