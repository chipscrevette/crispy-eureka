"""Upscale hotels: Atout France's register of classified hotels, our tourist-quality signal.

Overture counts every hotel the same, so a budget hotel by a station weighs as much as a
palace. Atout France publishes the official star rating of each classified hotel with its
room count. Guests of 4- and 5-star hotels are the international, high-spending visitors a
luxury boutique lives on. The register gives addresses only, so we place each Paris hotel
with the national address base (BAN) batch geocoder.
"""

from __future__ import annotations

import csv
import hashlib
import io
import urllib.request
import uuid
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from adresse_pipeline.download import CACHE, retrying

# "Hébergements touristiques classés en France", Atout France, Licence Ouverte (data.gouv.fr
# dataset 59c36c6a88ee3826d5998a35); the file is replaced as hotels are classified.
REGISTER_URL = (
    "https://data.classement.atout-france.fr/static/exportHebergementsClasses/"
    "hebergements_classes.csv"
)
GEOCODER_URL = "https://data.geopf.fr/geocodage/search/csv"
HOTEL = "HÔTEL DE TOURISME"
UPSCALE = 4  # stars
# below this BAN score the match is usually the right street but the wrong number, or worse
MIN_SCORE = 0.6
PARIS_CITYCODES = "751"  # 75101 to 75120, the arrondissements


@dataclass(frozen=True)
class ClassifiedHotel:
    name: str
    address: str
    postcode: str
    stars: int
    rooms: int


@dataclass(frozen=True)
class PlacedHotel:
    hotel: ClassifiedHotel
    lon: float
    lat: float


def read_register(path: Path) -> Iterator[dict[str, str]]:
    text = path.read_text(encoding="utf-8-sig")
    for row in csv.DictReader(io.StringIO(text), delimiter=";"):
        yield {k.strip().upper(): (v or "").strip() for k, v in row.items() if k}


def paris_hotels(rows: Iterable[dict[str, str]]) -> Iterator[ClassifiedHotel]:
    """Classified hotels of tourism in Paris (postcodes 75001 to 75020 and 75116)."""
    for row in rows:
        if row.get("TYPOLOGIE ÉTABLISSEMENT") != HOTEL or not row["CODE POSTAL"].startswith("75"):
            continue
        stars = row["CLASSEMENT"][:1]
        if not stars.isdigit():
            continue
        rooms = row["NOMBRE DE CHAMBRES"]
        yield ClassifiedHotel(
            row["NOM COMMERCIAL"],
            row["ADRESSE"],
            row["CODE POSTAL"],
            int(stars),
            int(rooms) if rooms.isdigit() else 0,
        )


def _multipart(fields: dict[str, str], file: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        for k, v in fields.items()
    ]
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="data"; filename="h.csv"\r\n'
        "Content-Type: text/csv\r\n\r\n".encode()
        + file
        + b"\r\n"
    )
    return b"".join(parts) + f"--{boundary}--\r\n".encode(), boundary


def geocode_csv(table: bytes) -> str:
    """Send a CSV of addresses to the BAN batch geocoder; the answer is cached by content."""
    path = CACHE / "geocode" / f"{hashlib.sha256(table).hexdigest()}.csv"
    if not path.exists():
        body, boundary = _multipart({"columns": "address", "postcode": "postcode"}, table)
        request = urllib.request.Request(
            GEOCODER_URL,
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )

        def post() -> str:
            with urllib.request.urlopen(request, timeout=300) as res:
                return res.read().decode("utf-8")

        text = retrying(post)
        if not text.startswith("id,"):
            raise ValueError(f"the geocoder answered {text[:200]!r}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return path.read_text(encoding="utf-8")


def place(hotels: list[ClassifiedHotel], geocode=geocode_csv) -> list[PlacedHotel]:
    """Each hotel at its address, when the geocoder is sure and the address is in Paris."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["id", "address", "postcode"])
    writer.writerows([i, h.address, h.postcode] for i, h in enumerate(hotels))
    placed = []
    for row in csv.DictReader(io.StringIO(geocode(out.getvalue().encode("utf-8")))):
        hotel = hotels[int(row["id"])]
        score = float(row["result_score"] or 0)
        if score < MIN_SCORE or not row["result_citycode"].startswith(PARIS_CITYCODES):
            continue
        placed.append(PlacedHotel(hotel, float(row["longitude"]), float(row["latitude"])))
    return placed
