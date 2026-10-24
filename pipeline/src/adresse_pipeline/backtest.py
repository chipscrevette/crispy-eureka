"""Does the planner find real boutiques it was not shown?

    python -m adresse_pipeline.backtest

Each brand is hidden in turn, with the same brand folds as the lookalike model's own
validation: its boutiques are removed from the market and the lookalike score is retrained
without its fold. Every method then picks as many blocks as the brand really has, and we
measure how many of the brand's real boutiques have a pick within a WITHIN-minute walk.

Methods:
- planner: Huff greedy among blocks the (retrained) lookalike score rates SUITABLE or more;
- Huff alone: the same greedy over every block.

Both use the cluster pull and outside option of `huff.Market.with_cluster`. That setting
(gamma, outside) is chosen for each fold on the other folds only, so the figure is not
tuned on the brands it scores; the final setting is the best over all folds.
Baselines, each picking the same number of blocks:
- lookalike: the blocks with the highest lookalike score;
- luxury neighbours: the blocks with the most luxury boutiques of other brands next door;
- demand: the blocks with the highest demand index;
- random: blocks drawn at random, averaged over many draws.

Only the brands and boutiques inside the city grid count. The result is published
whatever it is.
"""

from __future__ import annotations

import itertools
import json
import random

import numpy as np
import pandas as pd

from adresse_pipeline.brands import Catalogue, Profile
from adresse_pipeline.huff import Market, by_profile
from adresse_pipeline.luxury_stores import CATALOGUE
from adresse_pipeline.model import (
    FOLDS,
    NEIGHBOURS,
    OUTPUT,
    SEED,
    WEB_DATA,
    Boutique,
    PositiveSet,
    design_matrix,
    fit,
    in_set,
    labels,
    load_boutiques,
    percentile,
)
from adresse_pipeline.planner import SUITABLE, plan

GAMMAS = [0.0, 0.5, 1.0, 1.5, 2.0]  # cluster strengths tried
OUTSIDES = [1.0, 10.0, 100.0, 1000.0, 10000.0]  # pull of everything else, in boutiques
NONE: Setting = (0.0, 0.0)  # baselines have no setting
WITHIN = 5.0  # minutes of walking: a pick this close to a real boutique counts as found
RANDOM_DRAWS = 200


def found(minutes: np.ndarray, hidden: np.ndarray, picks: np.ndarray) -> int:
    """How many hidden blocks have a picked block within WITHIN minutes."""
    if len(picks) == 0:
        return 0
    return int((minutes[np.ix_(hidden, picks)] <= WITHIN).any(axis=1).sum())


def top(values: np.ndarray, k: int, allowed: np.ndarray) -> np.ndarray:
    """The k allowed blocks with the highest values; ties go to the lower index."""
    order = np.lexsort((np.arange(len(values)), -values))
    return np.array([i for i in order if allowed[i]][:k], dtype=int)


def folds_for(boutiques: list[Boutique], profile: Profile) -> list[list[str]]:
    """The same brand folds as `model.validate`."""
    brands = sorted({b.brand for b in boutiques if b.profile == profile})
    random.Random(SEED).shuffle(brands)
    return [brands[i::FOLDS] for i in range(FOLDS)]


Setting = tuple[float, float]  # gamma, outside


def setting_for(table: pd.DataFrame, fold: int) -> Setting:
    """The setting that found most boutiques on the other folds' brands."""
    other = table[table["fold"] != fold].groupby(["gamma", "outside"])["hits"].sum()
    gamma, outside = other.idxmax()  # ties go to the smaller gamma, then outside
    return float(gamma), float(outside)


def main() -> None:
    grid = pd.read_csv(OUTPUT / "paris_h3_features.csv", index_col="cell")
    features = grid.drop(columns=["arrondissement"])
    demand = pd.read_csv(OUTPUT / "demand.csv", index_col="cell")["demand"]
    demand = demand.reindex(grid.index).fillna(0).to_numpy()
    times = pd.read_parquet(OUTPUT / "walk_times.parquet")
    huff = json.loads((OUTPUT / "huff.json").read_text())
    positives = PositiveSet(json.loads((WEB_DATA / "scores.json").read_text())["positives"])
    boutiques = load_boutiques(Catalogue.from_csv(CATALOGUE))
    cells = grid.index.tolist()
    index = {c: i for i, c in enumerate(cells)}
    rng = np.random.default_rng(SEED)
    every = np.ones(len(cells), dtype=bool)
    none = np.zeros(len(cells))

    report: dict = {
        "within_minutes": WITHIN,
        "suitable": SUITABLE,
        "folds": FOLDS,
        "positives": positives.value,
        "gammas": GAMMAS,
        "outsides": OUTSIDES,
        "profiles": {},
    }
    for profile in Profile:
        market = Market.build(cells, demand, times, huff["profiles"][profile.value]["beta"])
        shops = [b for b in by_profile(boutiques, profile) if b.cell in index]
        luxury = [b for b in boutiques if b.cell in index]
        rows = []  # fold, brand, method, gamma, outside, hits, boutique blocks
        for fold, held in enumerate(folds_for(boutiques, profile)):
            train = [b for b in boutiques if b.brand not in held and in_set(b, positives)]
            x = design_matrix(features, train)
            score = percentile(fit(x, labels(features, train, profile)).predict(x))
            neighbours = x[NEIGHBOURS].to_numpy(dtype=float)
            for brand in held:
                hidden = np.array(sorted({index[b.cell] for b in shops if b.brand == brand}))
                if len(hidden) == 0:
                    continue
                k = len(hidden)
                rivals = market.sites([b.cell for b in shops if b.brand != brand])
                others = market.sites([b.cell for b in luxury if b.brand != brand])

                picked: list[tuple[str, Setting, np.ndarray]] = []
                for gamma, outside in itertools.product(GAMMAS, OUTSIDES):
                    m = market.with_cluster(others, gamma, outside)
                    for method, allowed in (("planner", score >= SUITABLE), ("huff alone", every)):
                        picks = [index[p.cell] for p in plan(m, none, rivals, allowed, k)]
                        picked.append((method, (gamma, outside), np.array(picks, dtype=int)))
                picked.append(("lookalike", NONE, top(score, k, every)))
                picked.append(("luxury neighbours", NONE, top(neighbours, k, every)))
                picked.append(("demand", NONE, top(demand, k, every)))
                for method, setting, picks in picked:
                    hits = found(market.minutes, hidden, picks)
                    rows.append((fold, brand, method, *setting, hits, k))
                draws = [
                    found(market.minutes, hidden, rng.choice(len(cells), k, replace=False))
                    for _ in range(RANDOM_DRAWS)
                ]
                rows.append((fold, brand, "random", *NONE, float(np.mean(draws)), k))

        table = pd.DataFrame(
            rows, columns=["fold", "brand", "method", "gamma", "outside", "hits", "k"]
        )
        total = table.drop_duplicates(["fold", "brand"])["k"].sum()
        result = {}
        chosen = {}
        for method in ("planner", "huff alone"):
            t = table[table["method"] == method]
            # the setting for each fold is chosen on the other folds only
            chosen[method] = {f: setting_for(t, f) for f in sorted(t["fold"].unique())}
            hits = sum(
                t[(t["fold"] == f) & (t["gamma"] == g) & (t["outside"] == o)]["hits"].sum()
                for f, (g, o) in chosen[method].items()
            )
            result[method] = round(100 * hits / total, 1)
        for method in ("lookalike", "luxury neighbours", "demand", "random"):
            result[method] = round(100 * table[table["method"] == method]["hits"].sum() / total, 1)
        planner = table[table["method"] == "planner"]
        by_setting = [
            {"gamma": g, "outside": o, "found_percent": round(float(h) * 100 / total, 1)}
            for (g, o), h in planner.groupby(["gamma", "outside"])["hits"].sum().items()
        ]
        gamma, outside = setting_for(planner, fold=-1)

        report["profiles"][profile.value] = {
            "brands": int(table["brand"].nunique()),
            "boutique_blocks": int(total),
            "found_percent": dict(sorted(result.items(), key=lambda kv: -kv[1])),
            "gamma": gamma,
            "outside": outside,
            "setting_by_fold": {str(f): list(s) for f, s in chosen["planner"].items()},
            "planner_by_setting": by_setting,
        }
        print(
            f"{profile.value}: {table['brand'].nunique()} brands, {total} boutique blocks; "
            f"found within {WITHIN:g} min: " + ", ".join(f"{n} {v}%" for n, v in result.items())
        )
        print(
            f"  chosen per fold: {list(chosen['planner'].values())}; "
            f"final gamma {gamma:g}, outside {outside:g}"
        )

    (OUTPUT / "backtest.json").write_text(json.dumps(report, indent=1))
    (WEB_DATA / "backtest.json").write_text(json.dumps(report, separators=(",", ":")))


if __name__ == "__main__":
    main()
