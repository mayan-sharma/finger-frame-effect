"""Windows backend: ctypes/user32 only, no third-party dependencies."""

import ctypes
import os
import time
from pathlib import Path

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

KEYEVENTF_KEYUP = 0x0002

VK = {
    "esc": 0x1B, "enter": 0x0D, "tab": 0x09, "space": 0x20,
    "ctrl": 0x11, "alt": 0x12, "shift": 0x10, "win": 0x5B,
    "prtscn": 0x2C, "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    "vol_up": 0xAF, "vol_down": 0xAE, "mute": 0xAD,
    "play_pause": 0xB3, "next_track": 0xB0, "prev_track": 0xB1,
}


def press(combo):
    keys = [VK[k.strip().lower()] for k in combo.split("+")]
    for vk in keys:
        user32.keybd_event(vk, 0, 0, 0)
    for vk in reversed(keys):
        user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
    return f"keys: {combo}"


def volume(direction):
    return press({"up": "vol_up", "down": "vol_down", "mute": "mute"}[direction])


def media(cmd):
    return press({"play_pause": "play_pause", "next": "next_track", "prev": "prev_track"}[cmd])


def screenshot():
    press("win+prtscn")
    return "screenshot -> Pictures/Screenshots"


def lock():
    user32.LockWorkStation()
    return "locked"


def open_uri(uri):
    os.startfile(uri)


def launch_config_dir():
    return Path(os.environ.get("APPDATA", "")) / "warp" / "Warp" / "data" / "launch_configurations"


def enable_vt():
    h = kernel32.GetStdHandle(-11)
    mode = ctypes.c_ulong()
    kernel32.GetConsoleMode(h, ctypes.byref(mode))
    kernel32.SetConsoleMode(h, mode.value | 0x0004)


# --- Warp window targeting -------------------------------------------------

def _window_exe(hwnd):
    pid = ctypes.c_ulong()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = ctypes.c_ulong(1024)
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return os.path.basename(buf.value).lower()
        return ""
    finally:
        kernel32.CloseHandle(h)


def _warp_windows():
    """Visible top-level windows owned by warp.exe, topmost (most recent) first."""
    found = []
    EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd) and "warp" in _window_exe(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(EnumProc(cb), 0)
    return found


def _force_foreground(hwnd):
    SW_RESTORE = 9
    fg = user32.GetForegroundWindow()
    fg_tid = user32.GetWindowThreadProcessId(fg, None)
    my_tid = kernel32.GetCurrentThreadId()
    user32.AttachThreadInput(my_tid, fg_tid, True)
    user32.ShowWindow(hwnd, SW_RESTORE)
    user32.SetForegroundWindow(hwnd)
    user32.AttachThreadInput(my_tid, fg_tid, False)


def warp_esc():
    wins = _warp_windows()
    if not wins:
        return "no Warp window"
    _force_foreground(wins[0])
    time.sleep(0.15)
    press("esc")
    return "sent Esc to Warp"
