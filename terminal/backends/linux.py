"""Linux backend. Best-effort over common CLI tools:
- keys / window focus: xdotool (X11; on Wayland install ydotool and adapt)
- volume: pactl, media: playerctl, screenshots: gnome-screenshot/spectacle/scrot
Missing tools degrade to a clear status message instead of crashing."""

import os
import shutil
import subprocess
import time
from pathlib import Path

KEY_NAMES = {"esc": "Escape", "enter": "Return", "tab": "Tab", "space": "space",
             "ctrl": "ctrl", "alt": "alt", "shift": "shift", "win": "super",
             "left": "Left", "right": "Right", "up": "Up", "down": "Down",
             "vol_up": "XF86AudioRaiseVolume", "vol_down": "XF86AudioLowerVolume",
             "mute": "XF86AudioMute", "play_pause": "XF86AudioPlay",
             "next_track": "XF86AudioNext", "prev_track": "XF86AudioPrev"}


def _run(*cmd):
    if not shutil.which(cmd[0]):
        return False
    subprocess.run(cmd, capture_output=True, timeout=10)
    return True


def press(combo):
    keys = "+".join(KEY_NAMES.get(k.strip().lower(), k.strip()) for k in combo.split("+"))
    if not _run("xdotool", "key", keys):
        return "xdotool not installed"
    return f"keys: {combo}"


def volume(direction):
    arg = {"up": "+5%", "down": "-5%"}.get(direction)
    if direction == "mute":
        ok = _run("pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle")
    else:
        ok = _run("pactl", "set-sink-volume", "@DEFAULT_SINK@", arg)
    return f"volume {direction}" if ok else press({"up": "vol_up", "down": "vol_down", "mute": "mute"}[direction])


def media(cmd):
    verb = {"play_pause": "play-pause", "next": "next", "prev": "previous"}[cmd]
    if _run("playerctl", verb):
        return f"media: {cmd}"
    return press({"play_pause": "play_pause", "next": "next_track", "prev": "prev_track"}[cmd])


def screenshot():
    out = Path.home() / "Pictures" / f"gesture-shot-{time.strftime('%Y%m%d-%H%M%S')}.png"
    out.parent.mkdir(exist_ok=True)
    for tool in (["gnome-screenshot", "-f", str(out)],
                 ["spectacle", "-b", "-n", "-o", str(out)],
                 ["scrot", str(out)]):
        if _run(*tool):
            return f"screenshot -> {out.name}"
    return "no screenshot tool found"


def lock():
    if _run("loginctl", "lock-session"):
        return "locked"
    return "loginctl not available"


def open_uri(uri, background=False):
    # xdg-open has no background flag; the parameter is accepted so callers
    # stay platform-neutral.
    subprocess.run(["xdg-open", uri], check=True, timeout=10)


def launch_config_dir():
    state = os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local" / "state"))
    return Path(state) / "warp-terminal" / "launch_configurations"


def enable_vt():
    pass


def warp_esc():
    if not shutil.which("xdotool"):
        return "xdotool not installed"
    r = subprocess.run(["xdotool", "search", "--class", "warp"],
                       capture_output=True, text=True, timeout=10)
    wins = [w for w in r.stdout.split() if w.strip()]
    if not wins:
        return "no Warp window"
    subprocess.run(["xdotool", "windowactivate", "--sync", wins[-1]], timeout=10)
    time.sleep(0.15)
    subprocess.run(["xdotool", "key", "Escape"], timeout=10)
    return "sent Esc to Warp"
