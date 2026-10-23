"""Build the layer of luxury boutiques in Paris.

    python -m adresse_pipeline.luxury_stores --release 2026-10-21.0 \
        --out ../web/public/data/luxury_stores.geojson
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from adresse_pipeline.brands import Catalogue, Store, dedupe
from adresse_pipeline.overture import PARIS, read_places

CATALOGUE = Path(__file__).resolve().parents[2] / "data" / "luxury_brands.csv"


def to_geojson(stores: list[Store], release: str) -> dict:
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
                },
            }
            for s in sorted(stores, key=lambda s: (s.brand.name, s.place.id))
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--release", required=True, help="Overture release, e.g. 2026-10-21.0")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    catalogue = Catalogue.from_csv(CATALOGUE)
    matched = [
        Store(place, brand)
        for place in read_places(args.release, PARIS)
        if (brand := catalogue.match(place))
    ]
    stores = dedupe(matched)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(to_geojson(stores, args.release), ensure_ascii=False))

    by_profile = Counter(s.brand.profile.value for s in stores)
    print(f"matched {len(matched)} places, kept {len(stores)} boutiques after dedupe")
    print(f"brands present: {len({s.brand for s in stores})} of {len(catalogue.brands)}")
    for profile, n in by_profile.most_common():
        print(f"  {profile}: {n}")


if __name__ == "__main__":
    main()
