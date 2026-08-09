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


def volume(direction):
    if direction == "mute":
        _osa("set volume with output muted")
        return "muted"
    sign = "+" if direction == "up" else "-"
    _osa(f"set volume output volume ((output volume of (get volume settings)) {sign} 6)")
    return f"volume {direction}"


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


def open_uri(uri):
    subprocess.run(["open", uri], check=True, timeout=10)


def launch_config_dir():
    return Path.home() / ".warp" / "launch_configurations"


def enable_vt():
    pass  # macOS terminals speak VT natively


def warp_esc():
    _osa('tell application "Warp" to activate')
    time.sleep(0.2)
    _osa('tell application "System Events" to key code 53')
    return "sent Esc to Warp"
