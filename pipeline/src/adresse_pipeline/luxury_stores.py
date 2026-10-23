"""Find catalogue luxury boutiques among map places."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from adresse_pipeline.brands import Catalogue, Place, Store, dedupe

CATALOGUE = Path(__file__).resolve().parents[2] / "data" / "luxury_brands.csv"


def find_stores(places: Iterable[Place], catalogue: Catalogue) -> list[Store]:
    return dedupe([Store(p, b) for p in places if (b := catalogue.match(p))])


def to_geojson(stores: list[Store], release: str, confirmed: set[str] | None = None) -> dict:
    """`confirmed` holds the ids OpenStreetMap agrees on; None when OSM was not checked."""
    return {
        "type": "FeatureCollection",
        "metadata": {
            "source": f"Overture Maps Foundation, places release {release}",
            "license": "CDLA-Permissive-2.0 / ODbL depending on source; see DATA_LICENSES.md",
        },
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(s.place.lon, 6), round(s.place.lat, 6)],
                },
                "properties": {
                    "id": s.place.id,
                    "brand": s.brand.name,
                    "segment": s.brand.segment.value,
                    "profile": s.brand.profile.value,
                    "name": s.place.name,
                    **({} if confirmed is None else {"osm_confirmed": s.place.id in confirmed}),
                },
            }
            for s in sorted(stores, key=lambda s: (s.brand.name, s.place.id))
        ],
    }
