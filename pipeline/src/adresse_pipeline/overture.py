"""Read Overture Maps data straight from the public S3 bucket."""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as fs
import shapely
from shapely.geometry.base import BaseGeometry

from adresse_pipeline.brands import Place

BUCKET = "overturemaps-us-west-2"
PLACE_COLUMNS = ["id", "names", "brand", "basic_category", "operating_status", "confidence", "bbox"]


@dataclass(frozen=True)
class BBox:
    xmin: float
    ymin: float
    xmax: float
    ymax: float


PARIS = BBox(2.224, 48.815, 2.470, 48.902)
# Paris plus about 600 m, so neighbourhood counts at the city edge see across it.
PARIS_PADDED = BBox(2.216, 48.809, 2.478, 48.908)


def dataset(release: str, theme: str, kind: str) -> ds.Dataset:
    s3 = fs.S3FileSystem(
        anonymous=True, region="us-west-2", proxy_options=os.environ.get("HTTPS_PROXY")
    )
    return ds.dataset(
        f"{BUCKET}/release/{release}/theme={theme}/type={kind}/", filesystem=s3, format="parquet"
    )


def _inside(bbox: BBox) -> pc.Expression:
    return (
        (pc.field("bbox", "xmin") >= bbox.xmin)
        & (pc.field("bbox", "xmax") <= bbox.xmax)
        & (pc.field("bbox", "ymin") >= bbox.ymin)
        & (pc.field("bbox", "ymax") <= bbox.ymax)
    )


def read_places(release: str, bbox: BBox) -> Iterator[Place]:
    table = dataset(release, "places", "place").to_table(
        filter=_inside(bbox), columns=PLACE_COLUMNS
    )
    for row in table.to_pylist():
        brand = row["brand"] or {}
        box = row["bbox"]
        yield Place(
            id=row["id"],
            name=(row["names"] or {}).get("primary"),
            brand_name=(brand.get("names") or {}).get("primary"),
            brand_wikidata=brand.get("wikidata"),
            category=row["basic_category"],
            operating_status=row["operating_status"],
            confidence=row["confidence"] or 0.0,
            lon=(box["xmin"] + box["xmax"]) / 2,
            lat=(box["ymin"] + box["ymax"]) / 2,
        )


@dataclass(frozen=True)
class Area:
    name: str
    subtype: str
    geometry: BaseGeometry


def read_paris_areas(release: str) -> list[Area]:
    """The Paris commune and its arrondissements, as land polygons."""
    table = dataset(release, "divisions", "division_area").to_table(
        filter=_inside(BBox(2.2, 48.8, 2.5, 48.92))
        & (pc.field("country") == "FR")
        & (pc.field("class") == "land"),
        columns=["names", "subtype", "geometry"],
    )
    areas = []
    for row in table.to_pylist():
        name = (row["names"] or {}).get("primary") or ""
        is_commune = row["subtype"] == "locality" and name == "Paris"
        is_arrondissement = name.startswith("Paris ") and name.endswith("Arrondissement")
        if is_commune or is_arrondissement:
            areas.append(Area(name, row["subtype"], shapely.from_wkb(row["geometry"])))
    return areas
