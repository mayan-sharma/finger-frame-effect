"""OS-specific action backends. Import `backend` for the current platform."""

import sys

if sys.platform == "win32":
    from . import win as backend
elif sys.platform == "darwin":
    from . import mac as backend
else:
    from . import linux as backend
