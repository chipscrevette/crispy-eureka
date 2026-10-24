"""Huff gravity model: which boutique the demand of each block walks to.

    python -m adresse_pipeline.huff

A shopper in block i picks boutique j with probability

    P(i, j) = exp(-beta * t_ij) / (OUTSIDE + sum over k of exp(-beta * t_ik))

where t is the walking time along streets and k runs over every boutique of the same
profile within LIMIT_MIN minutes. OUTSIDE is the pull of everything else (shopping
further away, online, not at all), set to one boutique standing in the block itself.
Every boutique has the same pull: there is no open data on store size or sales.

A brand's capture is the demand it wins: sum over i of D_i * sum over its boutiques of
P(i, j). Opening a boutique in block c adds what c wins and takes some of it from the
brand's own boutiques nearby: that part is cannibalisation, and gain = gross - cannibalised.

The decay beta is calibrated per profile: the beta under which the demand reachable from
a block best singles out the blocks where that profile's boutiques already are.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass

import numpy as np
import pandas as pd

from adresse_pipeline.brands import Catalogue, Profile
from adresse_pipeline.luxury_stores import CATALOGUE
from adresse_pipeline.model import OUTPUT, Boutique, load_boutiques
from adresse_pipeline.walk import LIMIT_MIN

OUTSIDE = 1.0
# decay per walking minute; ln 2 / beta is the walk after which pull halves
BETAS = np.round(np.arange(0.05, 1.01, 0.05), 2)


@dataclass(frozen=True)
class Market:
    """Blocks, their demand and walking times, for one decay."""

    cells: list[str]
    demand: np.ndarray  # (n,) demand index of each block
    pull: np.ndarray  # (n, n) exp(-beta * minutes), 0 beyond the walking limit
    beta: float

    @classmethod
    def build(cls, cells: list[str], demand: np.ndarray, times: pd.DataFrame, beta: float):
        index = {c: i for i, c in enumerate(cells)}
        pull = np.zeros((len(cells), len(cells)))
        times = times[times["origin"].isin(index) & times["dest"].isin(index)]
        i = times["origin"].map(index).to_numpy()
        j = times["dest"].map(index).to_numpy()
        pull[i, j] = np.exp(-beta * times["minutes"].to_numpy(dtype=float))
        return cls(cells, np.asarray(demand, dtype=float), pull, beta)

    def sites(self, cells: list[str]) -> np.ndarray:
        """Boutique counts per block, in block order."""
        counts = Counter(cells)
        return np.array([counts[c] for c in self.cells], dtype=float)

    def capture(self, own: np.ndarray, rivals: np.ndarray) -> float:
        """Demand a brand with boutiques `own` wins against `rivals`."""
        mine = self.pull @ own
        return float(self.demand @ (mine / (OUTSIDE + mine + self.pull @ rivals)))

    def openings(self, own: np.ndarray, rivals: np.ndarray) -> pd.DataFrame:
        """For a new boutique in each block: gross capture, cannibalisation and net gain."""
        mine = self.pull @ own
        total = OUTSIDE + mine + self.pull @ rivals  # (n,)
        after = total[:, None] + self.pull  # (i, c): demand block i once c opens
        gross = self.demand @ (self.pull / after)
        kept = self.demand @ (mine[:, None] / after)
        before = float(self.demand @ (mine / total))
        cannibalised = before - kept
        return pd.DataFrame(
            {"gross": gross, "cannibalised": cannibalised, "gain": gross - cannibalised},
            index=pd.Index(self.cells, name="cell"),
        )

    def reachable(self) -> np.ndarray:
        """Demand within walking reach of each block, discounted by walking time."""
        return self.pull.T @ self.demand


def mean_percentile(values: np.ndarray, hits: np.ndarray) -> float:
    """Average percentile (0-100) of the `hits` blocks when Paris is ranked by `values`."""
    pct = pd.Series(values).rank(pct=True).to_numpy() * 100
    return float(pct[hits].mean())


def calibrate(
    cells: list[str], demand: np.ndarray, times: pd.DataFrame, boutique_cells: list[str]
) -> list[dict]:
    """How well reachable demand singles out the boutique blocks, for each decay."""
    hits = np.isin(cells, boutique_cells)
    return [
        {
            "beta": float(b),
            "mean_percentile": round(
                mean_percentile(Market.build(cells, demand, times, b).reachable(), hits), 2
            ),
        }
        for b in BETAS
    ]


def by_profile(boutiques: list[Boutique], profile: Profile) -> list[Boutique]:
    """Every known boutique of the profile, including those only OpenStreetMap lists: a
    rival missing from Overture still takes shoppers. Boutiques outside the city limits
    fall outside the grid and are not modelled."""
    return [b for b in boutiques if b.profile == profile]


def main() -> None:
    demand = pd.read_csv(OUTPUT / "demand.csv", index_col="cell")["demand"]
    times = pd.read_parquet(OUTPUT / "walk_times.parquet")
    cells = demand.index.tolist()
    boutiques = load_boutiques(Catalogue.from_csv(CATALOGUE))

    report = {"outside": OUTSIDE, "limit_minutes": LIMIT_MIN, "profiles": {}}
    for profile in Profile:
        shops = by_profile(boutiques, profile)
        curve = calibrate(cells, demand.to_numpy(), times, [b.cell for b in shops])
        best = max(curve, key=lambda r: r["mean_percentile"])
        market = Market.build(cells, demand.to_numpy(), times, best["beta"])

        brands = Counter(b.brand for b in shops)
        captures = {}
        for brand in brands:
            own = market.sites([b.cell for b in shops if b.brand == brand])
            rivals = market.sites([b.cell for b in shops if b.brand != brand])
            captures[brand] = round(market.capture(own, rivals), 1)
        report["profiles"][profile.value] = {
            "beta": best["beta"],
            "half_life_minutes": round(float(np.log(2) / best["beta"]), 1),
            "calibration": curve,
            "capture": dict(sorted(captures.items(), key=lambda kv: -kv[1])),
        }
        print(
            f"{profile.value}: beta {best['beta']} (pull halves every "
            f"{np.log(2) / best['beta']:.1f} min), boutique blocks at the "
            f"{best['mean_percentile']:.1f}th percentile of reachable demand"
        )

        # spot check: the profile's largest brand opening one more boutique
        brand, count = brands.most_common(1)[0]
        own = market.sites([b.cell for b in shops if b.brand == brand])
        rivals = market.sites([b.cell for b in shops if b.brand != brand])
        best_sites = market.openings(own, rivals).nlargest(3, "gain")
        print(f"  {brand} ({count} boutiques) captures {captures[brand]:.0f}; best next blocks:")
        for cell, row in best_sites.iterrows():
            print(
                f"    {cell}: gross {row.gross:.0f}, cannibalised {row.cannibalised:.0f}, "
                f"gain {row.gain:.0f}"
            )

    (OUTPUT / "huff.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
