"""Do satellite embeddings, or a newly added source, improve the lookalike score?

    python -m adresse_pipeline.benchmark

Runs the same brand hold-out validation as `model` for several feature sets and writes
pipeline/output/benchmark.json. Every set keeps the luxury-neighbours feature, so the
comparison isolates what the extra features add. Each ablation drops one recent source from
the open data, to show what that source adds on the same boutiques and splits. The PCA is fitted on all cells without
labels, so it leaks nothing from the held-out brands.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from adresse_pipeline import alphaearth, olmoearth
from adresse_pipeline.brands import Catalogue, Profile
from adresse_pipeline.luxury_stores import CATALOGUE
from adresse_pipeline.model import OUTPUT, WEB_DATA, PositiveSet, load_boutiques, validate

POSITIVES = PositiveSet.OVERTURE
PCA_DIMS = 8
# Different splits of brands into folds; the spread across them shows how much is noise.
SEEDS = (7, 11, 23, 42, 101)
# Recently added sources, each run once without, to show what it adds.
ABLATIONS = {"upscale hotel rooms": ["upscale_rooms_r1"]}


def pca(x: pd.DataFrame, dims: int, name: str = "aef") -> pd.DataFrame:
    centred = x - x.mean()
    _, _, vt = np.linalg.svd(centred.to_numpy(), full_matrices=False)
    scores = centred.to_numpy() @ vt[:dims].T
    return pd.DataFrame(
        scores, index=x.index, columns=[f"{name.lower()}_pc{i + 1}" for i in range(dims)]
    )


def embedding_sets(name: str, grid: pd.DataFrame, emb: pd.DataFrame) -> dict[str, pd.DataFrame]:
    emb = emb.reindex(grid.index)
    dims = emb.shape[1]
    return {
        f"open data + {name} ({PCA_DIMS} components)": grid.join(
            pca(emb.fillna(0), PCA_DIMS, name)
        ),
        f"open data + {name} ({dims} dims)": grid.join(emb),
        f"{name} ({dims} dims) + luxury neighbours": grid[[]].join(emb),
    }


def feature_sets(
    grid: pd.DataFrame, embeddings: dict[str, pd.DataFrame]
) -> dict[str, pd.DataFrame]:
    sets = {"open data": grid}
    for name, columns in ABLATIONS.items():
        if set(columns) <= set(grid.columns):
            sets[f"open data without {name}"] = grid.drop(columns=columns)
    for name, emb in embeddings.items():
        sets |= embedding_sets(name, grid, emb)
    return sets


def main() -> None:
    catalogue = Catalogue.from_csv(CATALOGUE)
    grid = pd.read_csv(OUTPUT / "paris_h3_features.csv", index_col="cell").drop(
        columns=["arrondissement"]
    )
    embeddings = {"AlphaEarth": pd.read_csv(alphaearth.OUTPUT, index_col="cell")}
    if olmoearth.OUTPUT.exists():
        embeddings["OlmoEarth"] = pd.read_csv(olmoearth.OUTPUT, index_col="cell")
    boutiques = load_boutiques(catalogue)

    results: dict = {
        "positives": POSITIVES.value,
        "seeds": list(SEEDS),
        "embeddings": {
            "AlphaEarth": f"AlphaEarth Foundations annual {alphaearth.YEAR}",
            **(
                {"OlmoEarth": f"{olmoearth.MODEL}, Sentinel-2 {olmoearth.YEAR}"}
                if "OlmoEarth" in embeddings
                else {}
            ),
        },
        "sets": {},
    }
    for name, x in feature_sets(grid, embeddings).items():
        # validate() needs the apartment-price column for its baseline; hide it from a satellite-only model
        exclude = [] if "apartment_price_m2" in x.columns else ["apartment_price_m2"]
        x = x if not exclude else x.assign(apartment_price_m2=grid["apartment_price_m2"])
        per_profile = {}
        for p in Profile:
            runs = [validate(x, boutiques, p, POSITIVES, exclude=exclude, seed=s) for s in SEEDS]
            model = [r["model"].mean_percentile for r in runs]
            per_profile[p.value] = {
                "mean_percentile": round(float(np.mean(model)), 1),
                "min": min(model),
                "max": max(model),
                "top10_hit_rate": round(
                    float(np.mean([r["model"].top10_hit_rate for r in runs])), 3
                ),
                "luxury_neighbours_baseline": round(
                    float(np.mean([r["luxury neighbours"].mean_percentile for r in runs])), 1
                ),
            }
        results["sets"][name] = per_profile
        print(
            name,
            {p: (r["mean_percentile"], r["min"], r["max"]) for p, r in per_profile.items()},
            flush=True,
        )
    (OUTPUT / "benchmark.json").write_text(json.dumps(results, indent=1))
    (WEB_DATA / "benchmark.json").write_text(json.dumps(results, separators=(",", ":")))


if __name__ == "__main__":
    main()
