"""Read Overture Maps places straight from the public S3 bucket."""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as fs

from adresse_pipeline.brands import Place

BUCKET = "overturemaps-us-west-2"
COLUMNS = ["id", "names", "brand", "basic_category", "operating_status", "confidence", "bbox"]


@dataclass(frozen=True)
class BBox:
    xmin: float
    ymin: float
    xmax: float
    ymax: float


PARIS = BBox(2.224, 48.815, 2.470, 48.902)


def places_dataset(release: str) -> ds.Dataset:
    s3 = fs.S3FileSystem(
        anonymous=True, region="us-west-2", proxy_options=os.environ.get("HTTPS_PROXY")
    )
    return ds.dataset(
        f"{BUCKET}/release/{release}/theme=places/type=place/", filesystem=s3, format="parquet"
    )


def read_places(release: str, bbox: BBox) -> Iterator[Place]:
    inside = (
        (pc.field("bbox", "xmin") >= bbox.xmin)
        & (pc.field("bbox", "xmax") <= bbox.xmax)
        & (pc.field("bbox", "ymin") >= bbox.ymin)
        & (pc.field("bbox", "ymax") <= bbox.ymax)
    )
    table = places_dataset(release).to_table(filter=inside, columns=COLUMNS)
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
