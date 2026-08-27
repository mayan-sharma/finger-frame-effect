"""Non-blocking single-key reader for the live preview.

The preview owns the terminal and redraws every frame, so key handling has to
be *polled* — never blocking, never echoing, and never waiting for Enter.

On POSIX that means putting the tty in cbreak mode (canonical input and echo
off) for the lifetime of the preview and draining stdin each frame with a
zero-timeout select. Windows has no tty modes to change: msvcrt reads console
keystrokes directly.

Used as a context manager so the terminal is always restored, including when
the app exits through an exception:

    with KeyReader() as keys:
        for key in keys.poll():
            ...
"""

import os
import sys

try:                                    # POSIX
    import select
    import termios
    import tty
    _POSIX = True
except ImportError:                     # Windows
    import msvcrt
    _POSIX = False


class KeyReader:
    """Polls stdin for keystrokes without blocking the render loop."""

    def __init__(self, enabled=True):
        # Piped stdin (tests, CI) has no tty to configure and never has keys.
        self.enabled = enabled and sys.stdin.isatty()
        self._saved = None

    def __enter__(self):
        if self.enabled and _POSIX:
            try:
                self._saved = termios.tcgetattr(sys.stdin)
                tty.setcbreak(sys.stdin.fileno())
            except (termios.error, ValueError):
                self.enabled = False    # not a real terminal after all
        return self

    def __exit__(self, *exc):
        self.restore()
        return False

    def restore(self):
        if self._saved is not None:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, self._saved)
            self._saved = None

    def poll(self):
        """Return the keys pressed since the last call, as a list of str."""
        if not self.enabled:
            return []
        out = []
        if _POSIX:
            # Read the raw fd, not sys.stdin. A buffered read(1) pulls the
            # whole pending burst into Python's internal buffer, after which
            # select() sees an empty fd and reports nothing to read — so every
            # key after the first would be stranded until the next keypress.
            fd = sys.stdin.fileno()
            while select.select([fd], [], [], 0)[0]:
                try:
                    data = os.read(fd, 32)
                except OSError:
                    break
                if not data:
                    break
                out.extend(data.decode("utf-8", "ignore"))
        else:
            while msvcrt.kbhit():
                ch = msvcrt.getwch()
                # Arrow and function keys arrive as a two-character escape;
                # swallow the second half so it is not read as a plain key.
                if ch in ("\x00", "\xe0"):
                    msvcrt.getwch()
                    continue
                out.append(ch)
        return out
