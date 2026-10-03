"""Where the external tools and sample libraries live on this machine.

Each path comes from an environment variable, else from `analysis/paths.local.json` (git-ignored, one
machine's own paths), else it is unset. Example paths.local.json:

    {"FATE_SF2": "/path/to/MuseScore_General.sf2",
     "FATE_VSCO": "/path/to/VSCO-2-CE",
     "FATE_SFIZZ": "/path/to/sfizz_render"}
"""
from __future__ import annotations

import json
import os
from pathlib import Path

_LOCAL = Path(__file__).resolve().parent / "paths.local.json"


def local_path(name: str) -> Path | None:
    """The path set for `name` (environment first, then paths.local.json), or None."""
    v = os.environ.get(name)
    if not v and _LOCAL.exists():
        v = json.loads(_LOCAL.read_text(encoding="utf-8")).get(name)
    return Path(v) if v else None


def require(name: str, what: str) -> Path:
    p = local_path(name)
    if p is None or not p.exists():
        raise SystemExit(f"{what} not found: set {name} (environment or analysis/paths.local.json)"
                         + (f"; {p} does not exist" if p else ""))
    return p
