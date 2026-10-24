"""The lookalike opportunity score, one model per brand profile.

    python -m adresse_pipeline.model

Reads the grid features and boutique layers that `build` wrote, then:

1. validates the model by holding out whole brands, against two simple baselines,
   for three choices of which boutiques count as positives;
2. trains the final model on the Overture boutiques, unless another choice is clearly better;
3. writes a 0-100 score and its top drivers (SHAP) for every cell and profile.
"""

from __future__ import annotations

import json
import random
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

import h3
import lightgbm as lgb
import numpy as np
import pandas as pd

from adresse_pipeline.brands import Catalogue, Profile
from adresse_pipeline.features import FEATURES
from adresse_pipeline.grid import cell_of
from adresse_pipeline.luxury_stores import CATALOGUE

ROOT = Path(__file__).resolve().parents[3]
WEB_DATA = ROOT / "web" / "public" / "data"
OUTPUT = ROOT / "pipeline" / "output"

NEIGHBOURS = "luxury_neighbours_r1"
NEIGHBOURS_INFO = {
    "key": NEIGHBOURS,
    "label": "Luxury neighbours",
    "unit": "boutiques",
    "source": "Overture Maps Places, OpenStreetMap",
    "description": "Catalogue luxury boutiques of any profile in the six neighbouring cells",
}
# Raw per-profile counts include the cell's own boutiques, which are the labels.
LEAKY = {f"luxury_{p.value}_r1" for p in Profile}
FOLDS = 5
SEED = 7
PARAMS = {
    "objective": "binary",
    "learning_rate": 0.05,
    "num_leaves": 15,
    "min_data_in_leaf": 10,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "is_unbalance": True,
    "verbose": -1,
    "seed": SEED,
}
ROUNDS = 250


class PositiveSet(StrEnum):
    CONFIRMED = "osm-confirmed"
    OVERTURE = "overture"
    UNION = "overture+osm"


@dataclass(frozen=True)
class Boutique:
    brand: str
    profile: Profile
    cell: str
    confirmed: bool
    osm_only: bool


def load_boutiques(catalogue: Catalogue) -> list[Boutique]:
    stores = json.loads((WEB_DATA / "luxury_stores.geojson").read_text())["features"]
    check = json.loads((OUTPUT / "boutique_crosscheck.json").read_text())
    profile_of = {b.name: b.profile for b in catalogue.brands}
    out = [
        Boutique(
            f["properties"]["brand"],
            Profile(f["properties"]["profile"]),
            cell_of(*f["geometry"]["coordinates"]),
            bool(f["properties"].get("osm_confirmed")),
            False,
        )
        for f in stores
    ]
    out += [
        Boutique(o["brand"], profile_of[o["brand"]], cell_of(o["lon"], o["lat"]), True, True)
        for o in check["osm_only"]
    ]
    return out


def in_set(b: Boutique, positives: PositiveSet) -> bool:
    if positives is PositiveSet.CONFIRMED:
        return b.confirmed and not b.osm_only
    if positives is PositiveSet.OVERTURE:
        return not b.osm_only
    return True


def design_matrix(grid: pd.DataFrame, boutiques: list[Boutique]) -> pd.DataFrame:
    """Grid features plus luxury neighbours from `boutiques`, never counting the cell itself."""
    own = Counter(b.cell for b in boutiques)
    neighbours = [sum(own[n] for n in h3.grid_disk(c, 1)) - own[c] for c in grid.index]
    return grid.drop(columns=[c for c in grid.columns if c in LEAKY]).assign(
        **{NEIGHBOURS: neighbours}
    )


def labels(grid: pd.DataFrame, boutiques: list[Boutique], profile: Profile) -> np.ndarray:
    cells = {b.cell for b in boutiques if b.profile == profile}
    return np.array([c in cells for c in grid.index], dtype=int)


def fit(x: pd.DataFrame, y: np.ndarray) -> lgb.Booster:
    return lgb.train(PARAMS, lgb.Dataset(x, y), num_boost_round=ROUNDS)


def percentile(values: np.ndarray) -> np.ndarray:
    """0-100, where 100 is the highest value in Paris."""
    order = pd.Series(values).rank(method="average", pct=True).to_numpy()
    return np.round(order * 100, 1)


@dataclass
class Validation:
    """How the held-out brands' boutique cells ranked among cells with no training label."""

    mean_percentile: float
    top10_hit_rate: float
    held_out_cells: int


def score_held_out(scores: np.ndarray, held_out: np.ndarray, unlabelled: np.ndarray) -> list[float]:
    pool = scores[unlabelled]
    return [float((pool < s).mean() * 100) for s in scores[held_out]]


def validate(
    grid: pd.DataFrame,
    boutiques: list[Boutique],
    profile: Profile,
    positives: PositiveSet,
    exclude: Sequence[str] = (),
    seed: int = SEED,
) -> dict[str, Validation]:
    """Hold out whole brands. Train on `positives` from the other brands, then rank the
    held-out brands' OSM-confirmed boutique cells. Every positive set is judged on the
    same confirmed boutiques, so the sets can be compared. Columns in `exclude` stay available
    to the baselines but are hidden from the model."""
    brands = sorted({b.brand for b in boutiques if b.profile == profile})
    random.Random(seed).shuffle(brands)
    folds = [brands[i::FOLDS] for i in range(FOLDS)]
    ranks: dict[str, list[float]] = {"model": [], "luxury neighbours": [], "apartment price": []}

    for held in folds:
        train_b = [b for b in boutiques if b.brand not in held and in_set(b, positives)]
        test_cells = {
            b.cell for b in boutiques if b.brand in held and b.profile == profile and b.confirmed
        }
        x = design_matrix(grid, train_b)
        y = labels(grid, train_b, profile)
        held_out = np.array([c in test_cells and not y[i] for i, c in enumerate(grid.index)])
        if not held_out.any():
            continue
        unlabelled = y == 0
        candidates = {
            "model": fit(x.drop(columns=list(exclude)), y).predict(x.drop(columns=list(exclude))),
            "luxury neighbours": x[NEIGHBOURS].to_numpy(dtype=float),
            "apartment price": x["apartment_price_m2"].fillna(0).to_numpy(dtype=float),
        }
        for name, scores in candidates.items():
            ranks[name] += score_held_out(scores, held_out, unlabelled)

    return {
        name: Validation(
            round(float(np.mean(r)), 1), round(float(np.mean(np.array(r) >= 90)), 3), len(r)
        )
        for name, r in ranks.items()
    }


def drivers(contrib: np.ndarray, row: np.ndarray, keys: list[str], top: int = 4) -> list[list]:
    """The `top` features that moved this cell's score most: [key, SHAP contribution, value]."""
    order = np.argsort(-np.abs(contrib))[:top]
    return [
        [
            keys[i],
            round(float(contrib[i]), 3),
            None if np.isnan(row[i]) else round(float(row[i]), 3),
        ]
        for i in order
        if contrib[i] != 0
    ]


# The sets hold out different boutiques, so their test scores are only roughly comparable,
# and one boutique added to OpenStreetMap can move them by a few tenths. Leaving the default
# takes a clear gain, so the score does not flip from one data build to the next.
DEFAULT_POSITIVES = PositiveSet.OVERTURE
CLEAR_GAIN = 2.0  # points of mean held-out percentile


def choose_positives(mean_percentile: dict[PositiveSet, float]) -> PositiveSet:
    best = max(mean_percentile, key=mean_percentile.__getitem__)
    gain = mean_percentile[best] - mean_percentile[DEFAULT_POSITIVES]
    return best if gain > CLEAR_GAIN else DEFAULT_POSITIVES


def main() -> None:
    catalogue = Catalogue.from_csv(CATALOGUE)
    grid = pd.read_csv(OUTPUT / "paris_h3_features.csv", index_col="cell").drop(
        columns=["arrondissement"]
    )
    boutiques = load_boutiques(catalogue)

    report: dict = {"folds": FOLDS, "rounds": ROUNDS, "validation": {}}
    for positives in PositiveSet:
        report["validation"][positives.value] = {
            p.value: {k: vars(v) for k, v in validate(grid, boutiques, p, positives).items()}
            for p in Profile
        }
        summary = {
            p: v["model"]["mean_percentile"]
            for p, v in report["validation"][positives.value].items()
        }
        print(f"validation, trained on {positives.value}: {summary}")

    chosen = choose_positives(
        {
            s: float(np.mean([v["model"]["mean_percentile"] for v in by_profile.values()]))
            for s in PositiveSet
            for by_profile in [report["validation"][s.value]]
        }
    )
    report["positives"] = chosen.value
    print(f"final model trained on: {chosen.value}")

    train_b = [b for b in boutiques if in_set(b, chosen)]
    x = design_matrix(grid, train_b)
    keys = list(x.columns)
    scores: dict = {
        "positives": chosen.value,
        "profiles": {},
        # the one model feature that is not on the grid layer, for the compare view
        NEIGHBOURS: dict(zip(grid.index, x[NEIGHBOURS].astype(int).tolist(), strict=True)),
    }
    for profile in Profile:
        y = labels(grid, train_b, profile)
        model = fit(x, y)
        raw = model.predict(x)
        contrib = model.predict(x, pred_contrib=True)[:, :-1]
        values = x.to_numpy(dtype=float)
        pct = percentile(raw)
        scores["profiles"][profile.value] = {
            "boutique_cells": int(y.sum()),
            "cells": {
                cell: [float(pct[i]), drivers(contrib[i], values[i], keys)]
                for i, cell in enumerate(grid.index)
            },
        }
        importance = dict(zip(keys, np.abs(contrib).mean(axis=0).round(3).tolist(), strict=True))
        report.setdefault("importance", {})[profile.value] = dict(
            sorted(importance.items(), key=lambda kv: -kv[1])
        )
        top = sorted(range(len(pct)), key=lambda i: -pct[i])[:3]
        print(
            f"{profile.value}: {int(y.sum())} boutique cells; top cells {[grid.index[i] for i in top]}"
        )

    infos = [f for f in json.loads((WEB_DATA / "features.json").read_text())["features"]]
    scores["features"] = [f for f in infos if f["key"] in keys] + [NEIGHBOURS_INFO]
    scores["validation"] = report["validation"][chosen.value]
    # mean |SHAP| across Paris, for the method page
    scores["importance"] = {
        profile: list(ranked.items())[:6] for profile, ranked in report["importance"].items()
    }
    scores["validation_setup"] = {"folds": FOLDS, "positives": chosen.value}
    (WEB_DATA / "scores.json").write_text(
        json.dumps(scores, ensure_ascii=False, separators=(",", ":"))
    )
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "model_report.json").write_text(json.dumps(report, indent=1))


assert {f.key for f in FEATURES} >= LEAKY
if __name__ == "__main__":
    main()
