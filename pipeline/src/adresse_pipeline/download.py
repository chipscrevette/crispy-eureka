"""Download source files once into a local cache."""

from __future__ import annotations

import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import IO

CACHE = Path(__file__).resolve().parents[2] / ".cache"
# Public servers (Overpass, data.gouv.fr) answer 429 or 5xx when busy; that is worth a wait.
RETRY_STATUS = {429, 500, 502, 503, 504}
ATTEMPTS = 4


def urlopen(
    request: str | urllib.request.Request,
    timeout: float,
    wait: float = 5.0,
    attempts: int = ATTEMPTS,
) -> IO[bytes]:
    """`urllib.request.urlopen`, retried with backoff on busy-server errors."""
    for attempt in range(attempts):
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code not in RETRY_STATUS or attempt == attempts - 1:
                raise
        except urllib.error.URLError:
            if attempt == attempts - 1:
                raise
        time.sleep(wait * 2**attempt)
    raise AssertionError("unreachable")


def fetch(url: str) -> Path:
    path = CACHE / url.split("://", 1)[1]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        with urlopen(url, timeout=120) as res, tmp.open("wb") as f:
            shutil.copyfileobj(res, f)
        tmp.rename(path)
    return path
