"""Docker Desktop on this Mac shares /tmp and /var/folders, not /private/*.

Harbor calls Path.resolve(), which turns those into /private/tmp and
/private/var/folders, and compose then fails with mounts denied.
"""

from __future__ import annotations

from pathlib import Path

_ORIG = Path.resolve
_UNPRIVATE = (
    ("/private/tmp", "/tmp"),
    ("/private/var/folders", "/var/folders"),
)


def _resolve(self: Path, *args: object, **kwargs: object) -> Path:
    resolved = _ORIG(self, *args, **kwargs)
    text = str(resolved)
    for private, public in _UNPRIVATE:
        if text == private or text.startswith(private + "/"):
            return Path(public + text[len(private) :])
    return resolved


def install() -> None:
    Path.resolve = _resolve  # type: ignore[method-assign]
