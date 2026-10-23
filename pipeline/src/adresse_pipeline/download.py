"""Download source files once into a local cache."""

from __future__ import annotations

import shutil
import urllib.request
from pathlib import Path

CACHE = Path(__file__).resolve().parents[2] / ".cache"


def fetch(url: str) -> Path:
    path = CACHE / url.split("://", 1)[1]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        with urllib.request.urlopen(url, timeout=120) as res, tmp.open("wb") as f:
            shutil.copyfileobj(res, f)
        tmp.rename(path)
    return path
