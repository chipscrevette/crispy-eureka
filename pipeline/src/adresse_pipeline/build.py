"""Build every Paris data layer the app and the model use.

    python -m adresse_pipeline.build --overture-release 2026-10-21.0

Writes the boutique layer and the H3 grid to web/public/data/, and the grid's
feature table and the boutique cross-check to pipeline/output/. `--skip dvf insee
idfm osm sirene apur` builds without those sources (for machines that can't reach data.gouv.fr,
insee.fr, data.iledefrance-mobilites.fr, the Overpass API or carto2.apur.org); their features are then
left empty.

It also writes each block's own counts (not ring sums) to pipeline/output/paris_h3_blocks.csv,
the inputs of the demand index in `adresse_pipeline.demand`.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import h3
from shapely.geometry import Point

from adresse_pipeline import apur, dvf, idfm, insee, osm, sirene
from adresse_pipeline.brands import Catalogue, Profile
from adresse_pipeline.download import fetch
from adresse_pipeline.features import (
    APUR,
    CONTEXT_CATEGORIES,
    DVF,
    FEATURES,
    IDFM,
    INSEE,
    OVERLAYS,
    OVERTURE,
    SIRENE,
    as_json,
)
from adresse_pipeline.grid import (
    cell_of,
    cell_polygon,
    cells_covering,
    count_by_cell,
    ring_sum,
    ring_weighted_mean,
)
from adresse_pipeline.luxury_stores import CATALOGUE, find_stores, to_geojson
from adresse_pipeline.overture import PARIS_PADDED, read_paris_areas, read_places

SKIPPABLE = ["dvf", "insee", "idfm", "osm", "sirene", "apur"]

ROOT = Path(__file__).resolve().parents[3]
WEB_DATA = ROOT / "web" / "public" / "data"
OUTPUT = ROOT / "pipeline" / "output"
DVF_YEARS = [2021, 2022, 2023, 2024, 2025]


def share(
    part: dict[str, float], whole: dict[str, float], cells: set[str]
) -> dict[str, float | None]:
    p, w = ring_sum(part, cells), ring_sum(whole, cells)
    return {c: p[c] / w[c] if w[c] else None for c in cells}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--overture-release", required=True)
    parser.add_argument("--dvf-years", type=int, nargs="+", default=DVF_YEARS)
    parser.add_argument("--filosofi-year", type=int, default=2021, choices=insee.FILOSOFI_URLS)
    parser.add_argument("--skip", nargs="*", default=[], choices=SKIPPABLE)
    args = parser.parse_args()

    areas = read_paris_areas(args.overture_release)
    commune = next(a for a in areas if a.subtype == "locality")
    arrondissements = [a for a in areas if a is not commune]
    cells = cells_covering(commune.geometry)
    print(f"grid: {len(cells)} H3 cells at resolution 9 cover Paris")

    columns: dict[str, dict[str, float | None]] = {}
    # each block's own values, for the demand index
    own: dict[str, dict[str, float]] = {}

    places = [
        p
        for p in read_places(args.overture_release, PARIS_PADDED)
        if p.operating_status in (None, "open")
    ]
    for key, categories in CONTEXT_CATEGORIES.items():
        counts = count_by_cell((p.lon, p.lat) for p in places if p.category in categories)
        columns[key] = ring_sum(counts, cells)
        if key == "hotels_r1":
            own["hotels"] = counts

    catalogue = Catalogue.from_csv(CATALOGUE)
    stores, concessions = find_stores(places, catalogue)
    for profile in Profile:
        counts = count_by_cell(
            (s.place.lon, s.place.lat) for s in stores if s.brand.profile == profile
        )
        columns[f"luxury_{profile.value}_r1"] = ring_sum(counts, cells)
    print(
        f"overture: {len(places)} open places, {len(stores)} luxury street boutiques "
        f"({concessions} department-store concessions left out)"
    )

    sources = [f"{OVERTURE}, release {args.overture_release}"]

    if "insee" not in args.skip:
        url = insee.FILOSOFI_URLS[args.filosofi_year]
        income = insee.by_cell(insee.read_squares(insee.csv_rows_from_zip(fetch(url))))
        people = {c: v.individuals for c, v in income.items()}
        households = {c: v.households for c, v in income.items()}
        mean_ls = {
            c: v.living_standard_sum / v.individuals for c, v in income.items() if v.individuals
        }
        own["residents"] = people
        own["resident_income"] = {c: v.living_standard_sum for c, v in income.items()}
        columns["population_r1"] = ring_sum(people, cells)
        columns["living_standard_r1"] = ring_weighted_mean(mean_ls, people, cells)
        columns["owners_share_r1"] = share(
            {c: v.owner_households for c, v in income.items()}, households, cells
        )
        columns["poverty_share_r1"] = share(
            {c: v.poor_households for c, v in income.items()}, households, cells
        )
        print(f"insee: {sum(people.values()):,.0f} residents in {len(income)} cells")
        sources.append(f"{INSEE}, Filosofi {args.filosofi_year}")

    if "dvf" not in args.skip:
        sales = [
            sale
            for year in args.dvf_years
            for sale in dvf.single_premise_sales(dvf.read_rows(fetch(dvf.dvf_url(year))))
        ]
        columns["apartment_price_m2"], columns["apartment_sales_r1"] = dvf.median_price_m2(
            sales, dvf.Kind.APARTMENT, cells, min_sales=5
        )
        columns["commercial_price_m2"], columns["commercial_sales_r1"] = dvf.median_price_m2(
            sales, dvf.Kind.COMMERCIAL, cells, min_sales=3
        )
        print(
            f"dvf: {Counter(s.kind.name for s in sales)} usable sales, {min(args.dvf_years)}-{max(args.dvf_years)}"
        )
        sources.append(f"{DVF}, {min(args.dvf_years)}-{max(args.dvf_years)}")

    if "idfm" not in args.skip:
        entries = idfm.daily_entries_by_zdc(idfm.read_csv(fetch(idfm.VALIDATIONS_URL)))
        stations = [
            s
            for s in idfm.stations(idfm.read_csv(fetch(idfm.STATIONS_URL)), entries)
            if PARIS_PADDED.xmin <= s.lon <= PARIS_PADDED.xmax
            and PARIS_PADDED.ymin <= s.lat <= PARIS_PADDED.ymax
        ]
        by_cell: dict[str, float] = Counter()
        for st in stations:
            by_cell[cell_of(st.lon, st.lat)] += st.daily_entries
        own["station_entries"] = by_cell
        columns["transit_entries_r2"] = ring_sum(by_cell, cells, k=2)
        busiest = sorted(stations, key=lambda s: -s.daily_entries)[:5]
        print(
            f"idfm: {len(stations)} stations in and around Paris; busiest: "
            + ", ".join(f"{s.name} {s.daily_entries:,.0f}/day" for s in busiest)
        )
        sources.append(f"{IDFM}, {idfm.VALIDATIONS_PERIOD}")
        # the station points for the map's on/off layer; written now, as only this step has them
        WEB_DATA.mkdir(parents=True, exist_ok=True)
        (WEB_DATA / "stations.geojson").write_text(
            json.dumps(idfm.to_geojson(stations), ensure_ascii=False, separators=(",", ":"))
        )

    if "apur" not in args.skip:
        empty = list(apur.vacant_shops(apur.fetch_vacant()))
        street = [s for s in empty if s.on_street]
        columns["vacant_shops_r1"] = ring_sum(count_by_cell((s.lon, s.lat) for s in street), cells)
        print(f"apur: {len(empty):,} empty units, {len(street):,} on the street or a corner")
        sources.append(f"{APUR}, {apur.RELEASE}")

    if "sirene" not in args.skip:
        release = sirene.stock_release()
        firms = list(sirene.establishments(sirene.read_rows(fetch(release.url))))
        own["workers"] = sirene.workers_by_cell(firms)
        inside = sum(v for c, v in own["workers"].items() if c in cells)
        print(f"sirene: {len(firms):,} open establishments with staff, ~{inside:,.0f} workers")
        sources.append(f"{SIRENE}, stock of {release.updated}")

    confirmed: set[str] | None = None
    if "osm" not in args.skip:
        check = osm.cross_check(stores, osm.shops(osm.fetch_paris_shops()), catalogue)
        confirmed = check.confirmed
        (OUTPUT / "boutique_crosscheck.json").parent.mkdir(parents=True, exist_ok=True)
        (OUTPUT / "boutique_crosscheck.json").write_text(
            json.dumps(
                {
                    "overture_boutiques": len(stores),
                    "confirmed_by_osm": len(check.confirmed),
                    "osm_only": [
                        {
                            "brand": b.name,
                            "name": s.name,
                            "osm": s.osm_id,
                            "lon": s.lon,
                            "lat": s.lat,
                        }
                        for b, s in sorted(check.osm_only, key=lambda x: (x[0].name, x[1].osm_id))
                    ],
                },
                ensure_ascii=False,
                indent=1,
            )
        )
        print(
            f"osm: {len(check.confirmed)}/{len(stores)} Overture boutiques confirmed within "
            f"{osm.MATCH_RADIUS_M} m; {len(check.osm_only)} catalogue boutiques only in OSM"
        )

    def arrondissement(cell: str) -> str | None:
        lat, lon = h3.cell_to_latlng(cell)
        point = Point(lon, lat)
        return next((a.name for a in arrondissements if a.geometry.contains(point)), None)

    keys = [f.key for f in FEATURES]
    # the overlays go to the map, not to the feature table the model trains on
    overlays = [f.key for f in OVERLAYS]
    rows = []
    for cell in sorted(cells):
        row = {"cell": cell, "arrondissement": arrondissement(cell)}
        for key in [*keys, *overlays]:
            value = columns.get(key, {}).get(cell)
            row[key] = None if value is None else round(value, 4)
        rows.append(row)

    WEB_DATA.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with (OUTPUT / "paris_h3_features.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["cell", "arrondissement", *keys], extrasaction="ignore"
        )
        writer.writeheader()
        writer.writerows(rows)

    with (OUTPUT / "paris_h3_blocks.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["cell", *own])
        writer.writeheader()
        writer.writerows(
            {"cell": c, **{k: round(v.get(c, 0), 2) for k, v in own.items()}} for c in sorted(cells)
        )

    grid = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": cell_polygon(r["cell"]),
                "properties": {k: v for k, v in r.items() if v is not None},
            }
            for r in rows
        ],
    }
    (WEB_DATA / "paris_h3.geojson").write_text(
        json.dumps(grid, ensure_ascii=False, separators=(",", ":"))
    )
    (WEB_DATA / "luxury_stores.geojson").write_text(
        json.dumps(to_geojson(stores, args.overture_release, confirmed), ensure_ascii=False)
    )
    (WEB_DATA / "features.json").write_text(
        json.dumps(
            {
                "sources": sources,
                "features": [f for f in as_json() if f["key"] in columns],
            },
            ensure_ascii=False,
            indent=1,
        )
    )

    filled = {k: sum(r[k] is not None for r in rows) for k in [*keys, *overlays] if k in columns}
    print("coverage (cells with a value):")
    for k, n in filled.items():
        print(f"  {k}: {n}/{len(rows)}")


if __name__ == "__main__":
    main()
