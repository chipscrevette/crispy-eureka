"""Spending potential per block, from three groups of people who could walk into a boutique.

    python -m adresse_pipeline.demand

Retailers measure demand with card spending and phone footfall panels. Neither is open, so
each group here has an open stand-in:

- residents: the disposable income of the people living in the block (INSEE Filosofi);
- workers: the people working in the block (Sirene headcount bands);
- visitors: hotels (Overture) and station entries (Île-de-France Mobilités), half each.

Each group is turned into the block's share of the Paris total, so the units cancel out,
and the groups are added with equal weights: nothing open tells us how much each group
spends on luxury, so we do not pretend to. The index is scaled so that the average block
is 100. The sensitivity table shows how much the ranking moves under other weights.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import StrEnum

import numpy as np
import pandas as pd

from adresse_pipeline.model import OUTPUT, WEB_DATA


class Group(StrEnum):
    RESIDENTS = "residents"
    WORKERS = "workers"
    VISITORS = "visitors"


LABELS = {
    Group.RESIDENTS: "Residents' income",
    Group.WORKERS: "Workers",
    Group.VISITORS: "Visitors",
}
INPUTS = {
    Group.RESIDENTS: "Disposable income of the residents (INSEE Filosofi, 200 m grid)",
    Group.WORKERS: "People working in the block, from Sirene headcount bands",
    Group.VISITORS: "Hotels (Overture Maps) and daily station entries (IDFM), half each",
}
EQUAL = {g: 1 / 3 for g in Group}
TOP = 50


@dataclass(frozen=True)
class Blocks:
    """Each block's own inputs, as `build` wrote them to paris_h3_blocks.csv."""

    frame: pd.DataFrame  # index cell; columns resident_income, workers, hotels, station_entries

    REQUIRED = ("resident_income", "workers", "hotels", "station_entries")

    @classmethod
    def read(cls, path=OUTPUT / "paris_h3_blocks.csv") -> Blocks:
        frame = pd.read_csv(path, index_col="cell")
        missing = [c for c in cls.REQUIRED if c not in frame.columns]
        if missing:
            raise ValueError(f"{path.name} has no {missing}: rebuild without --skip for them")
        return cls(frame[list(cls.REQUIRED)].fillna(0.0))


def share(values: pd.Series) -> pd.Series:
    total = values.sum()
    if total <= 0:
        raise ValueError(f"{values.name} is zero everywhere")
    return values / total


def group_shares(blocks: Blocks) -> pd.DataFrame:
    """Each block's share of the Paris total, per group. Every column sums to 1."""
    f = blocks.frame
    return pd.DataFrame(
        {
            Group.RESIDENTS: share(f["resident_income"]),
            Group.WORKERS: share(f["workers"]),
            Group.VISITORS: (share(f["hotels"]) + share(f["station_entries"])) / 2,
        }
    )


def index(shares: pd.DataFrame, weights: dict[Group, float]) -> pd.Series:
    """Weighted demand, scaled so the average block is 100."""
    total = sum(weights.values())
    combined = sum(shares[g] * (w / total) for g, w in weights.items())
    return combined * len(shares) * 100


def spearman(a: pd.Series, b: pd.Series) -> float:
    return float(np.corrcoef(a.rank(), b.rank())[0, 1])


def sensitivity(shares: pd.DataFrame) -> list[dict]:
    """How the ranking moves when one group is dropped or used alone."""
    base = index(shares, EQUAL)
    top = set(base.nlargest(TOP).index)
    variants = {f"without {LABELS[g].lower()}": {h: 1.0 for h in Group if h != g} for g in Group}
    variants |= {f"{LABELS[g].lower()} only": {g: 1.0} for g in Group}
    rows = []
    for name, weights in variants.items():
        other = index(shares, weights)
        rows.append(
            {
                "weights": name,
                "rank_correlation": round(spearman(base, other), 3),
                "top_overlap": len(top & set(other.nlargest(TOP).index)),
            }
        )
    return rows


def main() -> None:
    shares = group_shares(Blocks.read())
    table = pd.DataFrame({g.value: index(shares, {g: 1.0}) for g in Group})
    table["demand"] = index(shares, EQUAL)
    table = table.round(1)
    table.to_csv(OUTPUT / "demand.csv", index_label="cell")

    sources = json.loads((WEB_DATA / "features.json").read_text())["sources"]
    out = {
        "weights": {g.value: round(w, 4) for g, w in EQUAL.items()},
        "groups": [{"key": g.value, "label": LABELS[g], "inputs": INPUTS[g]} for g in Group],
        "scale": "100 = the average block of Paris",
        "sources": sources,
        "top": TOP,
        "sensitivity": sensitivity(shares),
        "columns": [*(g.value for g in Group), "demand"],
        "cells": table.T.to_dict("list"),
    }
    (WEB_DATA / "demand.json").write_text(json.dumps(out, separators=(",", ":")))

    grid = pd.read_csv(OUTPUT / "paris_h3_features.csv", index_col="cell")["arrondissement"]
    for column in table.columns:
        best = table[column].nlargest(5)
        print(f"top {column}: " + "; ".join(f"{grid.get(c, '?')} {v:g}" for c, v in best.items()))
    for row in out["sensitivity"]:
        print(
            f"  {row['weights']}: rank correlation {row['rank_correlation']}, "
            f"{row['top_overlap']}/{TOP} of the top blocks kept"
        )


if __name__ == "__main__":
    main()
