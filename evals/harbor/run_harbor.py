#!/usr/bin/env python3
"""Launch Harbor with macOS Docker bind-path rewrite. Not part of the kernel."""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from evals.harbor.macos_bind import install as install_macos_bind
from evals.harbor.settings import apply_environ

install_macos_bind()
apply_environ()

from harbor.cli.main import app


def main() -> None:
    sys.argv[0] = re.sub(r"(-script\.pyw|\.exe)?$", "", sys.argv[0])
    raise SystemExit(app())


if __name__ == "__main__":
    main()
