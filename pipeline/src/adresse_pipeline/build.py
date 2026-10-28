"""Build every Paris data layer the app and the model use.

    python -m adresse_pipeline.build --overture-release 2026-10-21.0

Writes the boutique layer and the H3 grid to web/public/data/, and the grid's
feature table and the boutique cross-check to pipeline/output/. `--skip dvf insee
idfm osm sirene apur hotels footfall` builds without those sources (for machines that can't reach data.gouv.fr,
insee.fr, data.iledefrance-mobilites.fr, the Overpass API, carto2.apur.org or the BAN geocoder); their features are then
left empty.

It also writes each block's own counts (not ring sums) to pipeline/output/paris_h3_blocks.csv,
the inputs of the demand index in `adresse_pipeline.demand`.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import date
from pathlib import Path

import h3
from shapely.geometry import Point, box
from shapely.ops import unary_union

from adresse_pipeline import apur, dvf, footfall, hotels, idfm, insee, network, osm, sirene
from adresse_pipeline.brands import Catalogue, Profile
from adresse_pipeline.download import fetch
from adresse_pipeline.features import (
    APUR,
    CONTEXT_CATEGORIES,
    DVF,
    FEATURES,
    HOTELS,
    IDFM,
    INSEE,
    OVERLAYS,
    OVERTURE,
    SIRENE,
    STREETS,
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
from adresse_pipeline.luxury_stores import (
    CATALOGUE,
    find_stores,
    in_city,
    not_boutiques,
    to_geojson,
)
from adresse_pipeline.overture import (
    PARIS_PADDED,
    arrondissements_geojson,
    read_paris_areas,
    read_places,
)
from adresse_pipeline.walk import build_graph, read_segments

SKIPPABLE = ["dvf", "insee", "idfm", "osm", "sirene", "apur", "hotels", "footfall"]

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
    (WEB_DATA / "arrondissements.geojson").write_text(
        json.dumps(arrondissements_geojson(arrondissements), separators=(",", ":"))
    )
    print(f"arrondissements: {len(arrondissements)} written for the map")
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
    stores, concessions = find_stores(places, catalogue, not_boutiques())
    beyond = len(stores)
    stores = in_city(stores, commune.geometry)
    beyond -= len(stores)
    for profile in Profile:
        counts = count_by_cell(
            (s.place.lon, s.place.lat) for s in stores if s.brand.profile == profile
        )
        columns[f"luxury_{profile.value}_r1"] = ring_sum(counts, cells)
    print(
        f"overture: {len(places)} open places, {len(stores)} luxury street boutiques "
        f"({concessions} department-store concessions and {beyond} beyond the city left out)"
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
        with_lines = sum(1 for s in stations if s.lines)
        if not with_lines:
            print(
                f"idfm: no line columns in the stations file; columns {sorted(next(idfm.read_csv(fetch(idfm.STATIONS_URL))))}"
            )
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
        print(f"idfm: {with_lines} of {len(stations)} stations list their lines")
        # the metro and RER lines in their colours, for the map
        branches = network.traces(
            network.read_traces(fetch(network.TRACES_URL)),
            network.read_lines(fetch(network.LINES_URL)),
            box(PARIS_PADDED.xmin, PARIS_PADDED.ymin, PARIS_PADDED.xmax, PARIS_PADDED.ymax),
        )
        lines = network.to_geojson(branches)
        (WEB_DATA / "network.geojson").write_text(json.dumps(lines, separators=(",", ":")))
        print(
            f"network: {len(lines['features'])} metro and RER lines: "
            + ", ".join(f["properties"]["line"] for f in lines["features"])
        )

    if "footfall" not in args.skip:
        streets = footfall.street_betweenness(build_graph(read_segments(args.overture_release)))
        columns["street_footfall"] = (
            footfall.by_cell(streets, cell_of).reindex(list(cells)).fillna(0).to_dict()
        )
        lines = footfall.to_geojson(streets)
        print(
            f"footfall: {len(streets):,} street pieces, walks of up to {footfall.RADIUS_M:g} m; "
            f"{len(lines['features']):,} busiest drawn on the map"
        )
        sources.append(f"{STREETS}, release {args.overture_release}")
        WEB_DATA.mkdir(parents=True, exist_ok=True)
        (WEB_DATA / "streets.geojson").write_text(json.dumps(lines, separators=(",", ":")))

    if "hotels" not in args.skip:
        classified = list(hotels.paris_hotels(hotels.read_register(fetch(hotels.REGISTER_URL))))
        upscale = [h for h in classified if h.stars >= hotels.UPSCALE]
        placed = hotels.place(upscale)
        rooms: dict[str, float] = Counter()
        for p in placed:
            rooms[cell_of(p.lon, p.lat)] += p.hotel.rooms
        columns["upscale_rooms_r1"] = ring_sum(rooms, cells)
        print(
            f"hotels: {len(classified)} classified Paris hotels, {len(upscale)} with 4 or 5 stars, "
            f"{len(placed)} placed by the geocoder ({sum(p.hotel.rooms for p in placed):,} rooms)"
        )
        sources.append(f"{HOTELS}, register of {date.today().isoformat()}")

    if "apur" not in args.skip:
        fronts = [u for u in apur.units(apur.fetch_units()) if u.on_street]
        empty = [u for u in fronts if u.empty]
        all_fronts = ring_sum(count_by_cell((u.lon, u.lat) for u in fronts), cells)
        columns["vacant_shops_r1"] = ring_sum(count_by_cell((u.lon, u.lat) for u in empty), cells)
        columns["vacancy_r1"] = {
            c: columns["vacant_shops_r1"][c] / all_fronts[c] if all_fronts[c] else None
            for c in cells
        }
        columns["large_vacant_r1"] = ring_sum(
            count_by_cell((u.lon, u.lat) for u in empty if u.flagship_size), cells
        )
        print(
            f"apur: {len(fronts):,} shopfronts on the street or a corner, {len(empty):,} empty "
            f"({len(empty) / len(fronts):.1%}), {sum(u.flagship_size for u in empty)} of 300 m² or more"
        )
        zones = apur.fetch_tourist_zones()
        zti = unary_union([z.area for z in zones if z.international])
        inside = {c: 1.0 for c in cells if zti.contains(Point(*reversed(h3.cell_to_latlng(c))))}
        # the share of the block and its six neighbours (by their centres) inside a ZTI
        columns["tourist_zone_r1"] = {
            c: ring_sum(inside, [c])[c] / len(h3.grid_disk(c, 1)) for c in cells
        }
        print(
            f"apur: {sum(z.international for z in zones)} international tourist zones of "
            f"{len(zones)} ({', '.join(sorted(z.name for z in zones if z.international))}); "
            f"{len(inside)} blocks inside"
        )
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

    # the overlays on their own, so the benchmark can test what each would add to the model
    with (OUTPUT / "paris_h3_overlays.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["cell", *overlays], extrasaction="ignore")
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
