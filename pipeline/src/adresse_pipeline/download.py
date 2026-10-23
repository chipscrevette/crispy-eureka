"""Download source files once into a local cache."""

from __future__ import annotations

import shutil
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

CACHE = Path(__file__).resolve().parents[2] / ".cache"
# Public servers (Overpass, data.gouv.fr) answer 429 or 5xx when busy; that is worth a wait.
RETRY_STATUS = {429, 500, 502, 503, 504}
ATTEMPTS = 4
T = TypeVar("T")


def retrying(action: Callable[[], T], wait: float = 5.0, attempts: int = ATTEMPTS) -> T:
    """Run a whole download (connect and read), retried with backoff when the server is busy,
    unreachable or stalls mid-transfer. Other HTTP errors (404, 403) fail at once."""
    for attempt in range(attempts):
        try:
            return action()
        except urllib.error.HTTPError as e:
            if e.code not in RETRY_STATUS or attempt == attempts - 1:
                raise
            reason = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt == attempts - 1:
                raise
            reason = repr(e)
        print(f"download: {reason}, retrying in {wait * 2**attempt:.0f} s", flush=True)
        time.sleep(wait * 2**attempt)
    raise AssertionError("unreachable")


def fetch(url: str) -> Path:
    path = CACHE / url.split("://", 1)[1]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")

        def download() -> None:
            with urllib.request.urlopen(url, timeout=120) as res, tmp.open("wb") as f:
                shutil.copyfileobj(res, f)

        retrying(download)
        tmp.rename(path)
    return path
