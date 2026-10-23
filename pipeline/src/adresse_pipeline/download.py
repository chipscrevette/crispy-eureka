"""Download source files once into a local cache."""

from __future__ import annotations

import shutil
import time
import urllib.error
import urllib.request
import zipfile
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


class NotTheFile(ConnectionError):
    """The server answered 200 with something else, usually an HTML error or bot-check page."""


def looks_complete(path: Path, name: str | None = None) -> bool:
    """A zip or gzip file (judged by `name`, default the file's own) that really is one.
    Other files are taken as they come."""
    name = name or path.name
    if name.endswith(".zip"):
        return zipfile.is_zipfile(path)
    if name.endswith(".gz"):
        with path.open("rb") as f:
            return f.read(2) == b"\x1f\x8b"
    return True


def fetch(url: str) -> Path:
    path = CACHE / url.split("://", 1)[1]
    if path.exists() and not looks_complete(path):
        print(f"download: cached {path.name} is damaged, fetching it again", flush=True)
        path.unlink()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")

        def download() -> None:
            with urllib.request.urlopen(url, timeout=120) as res, tmp.open("wb") as f:
                shutil.copyfileobj(res, f)
            if not looks_complete(tmp, path.name):
                raise NotTheFile(f"{url} did not return a valid {path.suffix} file")

        retrying(download)
        tmp.rename(path)
    return path
