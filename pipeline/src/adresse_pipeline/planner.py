"""Where a brand should open its next k boutiques: greedy location-allocation.

    python -m adresse_pipeline.planner

For a brand, each step opens the boutique that adds the most net demand (Huff capture
gained minus what its own boutiques lose), given every boutique already open, and then
repeats with that boutique in place. Greedy picking is the standard heuristic for this
problem (maximum capture location), and it never picks two sites that only win the same
shoppers.

Huff alone would send a luxury brand to any busy block nobody serves yet. So the planner
only considers blocks that the lookalike score already rates as suitable for the profile
(SUITABLE or more), and never a block where the brand already is.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass

import numpy as np
import pandas as pd

from adresse_pipeline.brands import Catalogue, Profile
from adresse_pipeline.huff import Market, by_profile
from adresse_pipeline.luxury_stores import CATALOGUE
from adresse_pipeline.model import OUTPUT, WEB_DATA, load_boutiques

SUITABLE = 80.0  # lookalike score: the block resembles luxury blocks more than 80% of Paris
STEPS = 5
NEW_BRAND = "A new brand"


@dataclass(frozen=True)
class Pick:
    cell: str
    gross: float
    cannibalised: float
    gain: float


def plan(market: Market, own: np.ndarray, rivals: np.ndarray, allowed: np.ndarray, k: int):
    """The k blocks, in order, that each add the most net demand given the earlier picks."""
    own = own.astype(float).copy()
    allowed = allowed & (own == 0)
    picks: list[Pick] = []
    for _ in range(k):
        if not allowed.any():
            break
        options = market.openings(own, rivals)[allowed]
        # ties go to the first block in id order, so a rerun gives the same plan
        best = options.sort_index().sort_values("gain", ascending=False, kind="stable").iloc[0]
        picks.append(Pick(best.name, *(float(best[c]) for c in ("gross", "cannibalised", "gain"))))
        i = market.cells.index(best.name)
        own[i] += 1
        allowed[i] = False
    return picks


def main() -> None:
    huff = json.loads((OUTPUT / "huff.json").read_text())
    scores = json.loads((WEB_DATA / "scores.json").read_text())["profiles"]
    demand = pd.read_csv(OUTPUT / "demand.csv", index_col="cell")["demand"]
    times = pd.read_parquet(OUTPUT / "walk_times.parquet")
    cells = demand.index.tolist()
    boutiques = load_boutiques(Catalogue.from_csv(CATALOGUE))

    out = {"suitable": SUITABLE, "steps": STEPS, "profiles": {}}
    for profile in Profile:
        beta = huff["profiles"][profile.value]["beta"]
        market = Market.build(cells, demand.to_numpy(), times, beta)
        score = np.array([scores[profile.value]["cells"].get(c, [0])[0] for c in cells])
        allowed = score >= SUITABLE
        shops = by_profile(boutiques, profile)
        brands = [b for b, _ in Counter(s.brand for s in shops).most_common()]

        plans = {}
        for brand in [*brands, NEW_BRAND]:
            own = market.sites([s.cell for s in shops if s.brand == brand])
            rivals = market.sites([s.cell for s in shops if s.brand != brand])
            picks = plan(market, own, rivals, allowed, STEPS)
            plans[brand] = {
                "boutiques": int(own.sum()),
                "capture": round(market.capture(own, rivals), 1),
                "picks": [
                    {
                        "cell": p.cell,
                        "gross": round(p.gross, 1),
                        "cannibalised": round(p.cannibalised, 1),
                        "gain": round(p.gain, 1),
                    }
                    for p in picks
                ],
            }
        out["profiles"][profile.value] = {
            "beta": beta,
            "candidates": int(allowed.sum()),
            "plans": plans,
        }

        arrondissement = pd.read_csv(OUTPUT / "paris_h3_features.csv", index_col="cell")[
            "arrondissement"
        ]
        print(f"{profile.value}: {allowed.sum()} candidate blocks (score >= {SUITABLE:g})")
        for brand in [brands[0], NEW_BRAND]:
            p = plans[brand]
            steps = "; ".join(
                f"{arrondissement[x['cell']].removeprefix('Paris ')} +{x['gain']:.0f}"
                f" (-{x['cannibalised']:.0f} own)"
                for x in p["picks"]
            )
            print(f"  {brand} ({p['boutiques']} boutiques, capture {p['capture']:.0f}): {steps}")

    (WEB_DATA / "planner.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    )


if __name__ == "__main__":
    main()
