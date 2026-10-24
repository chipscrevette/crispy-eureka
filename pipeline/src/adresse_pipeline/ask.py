"""Ask Adresse: curated questions answered by real tool calls on our data.

Each answer is built from the results of the tool calls it lists, and only from
them: the text templates take numbers from tool results, never from constants.
The output is pre-recorded at build time, so the site needs no model or API key.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import h3

from adresse_pipeline.brands import Profile
from adresse_pipeline.model import NEIGHBOURS, WEB_DATA

OUTPUT = WEB_DATA / "ask.json"
PROFILE_NAME = {
    Profile.JEWELLERY_WATCHES: "jewellery and watch",
    Profile.FASHION_HOUSE: "fashion house",
    Profile.BEAUTY: "beauty",
}
PROFILE_PLURAL = {
    Profile.JEWELLERY_WATCHES: "jewellers and watchmakers",
    Profile.FASHION_HOUSE: "fashion houses",
    Profile.BEAUTY: "beauty brands",
}
# Blocks that score this high are in the top tenth of Paris for a profile.
STRONG = 90
# A white-space block this close to a boutique of its profile extends a cluster.
CLUSTER_EDGE_M = 600


@dataclass(frozen=True)
class Block:
    cell: str
    arrondissement: str | None
    values: dict[str, float]
    # percentile score and SHAP drivers ([key, contribution, value]) per profile
    scores: dict[Profile, float]
    drivers: dict[Profile, list[list]]

    def competitors(self, profile: Profile) -> int:
        """Boutiques of the profile in the block and its six neighbours."""
        return int(self.values.get(f"luxury_{profile.value}_r1", 0))


@dataclass(frozen=True)
class Boutique:
    brand: str
    profile: Profile
    lon: float
    lat: float


@dataclass(frozen=True)
class FeatureLabel:
    key: str
    label: str
    unit: str


@dataclass
class Paris:
    """Every layer Ask Adresse can query, read once from the built data."""

    blocks: dict[str, Block]
    boutiques: list[Boutique]
    features: dict[str, FeatureLabel]
    validation: dict[str, dict]
    importance: dict[str, list]
    benchmark: dict | None

    @classmethod
    def load(cls, data: Path = WEB_DATA) -> Paris:
        grid = json.loads((data / "paris_h3.geojson").read_text())["features"]
        scores = json.loads((data / "scores.json").read_text())
        stores = json.loads((data / "luxury_stores.geojson").read_text())["features"]
        bench = data / "benchmark.json"
        blocks = {}
        for f in grid:
            p = f["properties"]
            cell = p["cell"]
            values = {
                k: float(v) for k, v in p.items() if isinstance(v, int | float) and k != "cell"
            }
            values[NEIGHBOURS] = float(scores[NEIGHBOURS].get(cell, 0))
            per = {pr: scores["profiles"][pr.value]["cells"].get(cell) for pr in Profile}
            blocks[cell] = Block(
                cell,
                p.get("arrondissement"),
                values,
                {pr: v[0] for pr, v in per.items() if v},
                {pr: v[1] for pr, v in per.items() if v},
            )
        return cls(
            blocks,
            [
                Boutique(
                    s["properties"]["brand"],
                    Profile(s["properties"]["profile"]),
                    *s["geometry"]["coordinates"],
                )
                for s in stores
            ],
            {f["key"]: FeatureLabel(f["key"], f["label"], f["unit"]) for f in scores["features"]},
            scores["validation"],
            scores["importance"],
            json.loads(bench.read_text()) if bench.exists() else None,
        )


def short_place(arrondissement: str | None) -> str:
    """'Paris 8e Arrondissement' -> 'the 8th arrondissement'."""
    m = re.match(r"Paris (\d+)", arrondissement or "")
    return f"the {ordinal(int(m.group(1)))} arrondissement" if m else "Paris"


def ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    return h3.great_circle_distance((a[1], a[0]), (b[1], b[0]), unit="m")


def shown(value: float, unit: str) -> float | int:
    """A value rounded the way the answer prints it."""
    if unit == "share":
        return round(value * 100)
    if unit.startswith("€"):
        return int(round(value, -2))
    if abs(value) >= 10 or value == int(value):
        return int(round(value))
    return round(value, 1)


def num(value: float | int) -> str:
    """How an answer prints a number: thousands separated by commas."""
    return f"{value:,}"


def places(items: list[tuple[str, str]]) -> str:
    """[('the 4th arrondissement', '96'), ('the 4th arrondissement', '95')] ->
    'the 4th arrondissement (96, 95)', keeping first-seen order."""
    grouped: dict[str, list[str]] = {}
    for place, value in items:
        grouped.setdefault(place, []).append(value)
    return ", ".join(f"{p} ({', '.join(v)})" for p, v in grouped.items())


@dataclass
class ToolCall:
    tool: str
    args: dict
    result: dict | list


@dataclass
class Trace:
    """The tool calls behind one answer, in the order they ran."""

    calls: list[ToolCall] = field(default_factory=list)

    def record(self, tool: str, args: dict, result):
        self.calls.append(ToolCall(tool, args, result))
        return result


class Tools:
    """The queries Ask Adresse may run. Each call is recorded on the trace."""

    def __init__(self, paris: Paris, trace: Trace):
        self.paris = paris
        self.trace = trace

    def count_boutiques(self) -> dict:
        by_profile = Counter(b.profile.value for b in self.paris.boutiques)
        by_place = Counter(
            short_place(self.paris.blocks[c].arrondissement)
            for b in self.paris.boutiques
            if (c := h3.latlng_to_cell(b.lat, b.lon, 9)) in self.paris.blocks
        )
        result = {
            "total": len(self.paris.boutiques),
            "by_profile": dict(by_profile),
            "top_arrondissements": [[k, v] for k, v in by_place.most_common(3)],
        }
        return self.trace.record("count_boutiques", {}, result)

    def top_blocks(self, profile: Profile, n: int = 5, without_competitors: bool = False) -> list:
        ranked = sorted(
            (b for b in self.paris.blocks.values() if profile in b.scores),
            key=lambda b: -b.scores[profile],
        )
        if without_competitors:
            ranked = [b for b in ranked if b.competitors(profile) == 0]
        result = [
            {
                "cell": b.cell,
                "place": short_place(b.arrondissement),
                "score": round(b.scores[profile]),
            }
            for b in ranked[:n]
        ]
        args = {"profile": profile.value, "n": n, "without_competitors": without_competitors}
        return self.trace.record("top_blocks", args, result)

    def nearest_boutique(self, cell: str, profile: Profile) -> dict:
        lat, lon = h3.cell_to_latlng(cell)
        best = min(
            (b for b in self.paris.boutiques if b.profile == profile),
            key=lambda b: metres((lon, lat), (b.lon, b.lat)),
        )
        result = {
            "brand": best.brand,
            "metres": int(round(metres((lon, lat), (best.lon, best.lat)), -1)),
        }
        return self.trace.record(
            "nearest_boutique", {"cell": cell, "profile": profile.value}, result
        )

    def room_by_arrondissement(self, profile: Profile) -> list:
        strong = Counter()
        free = Counter()
        for b in self.paris.blocks.values():
            if b.scores.get(profile, 0) >= STRONG:
                place = short_place(b.arrondissement)
                strong[place] += 1
                free[place] += b.competitors(profile) == 0
        result = [
            {"place": p, "strong_blocks": strong[p], "without_competitors": free[p]}
            for p in sorted(strong, key=lambda p: (-free[p], -strong[p]))[:3]
        ]
        args = {"profile": profile.value, "min_score": STRONG}
        return self.trace.record("room_by_arrondissement", args, result)

    def locate(self, name: str, lat: float, lon: float) -> dict:
        cell = h3.latlng_to_cell(lat, lon, 9)
        block = self.paris.blocks[cell]
        result = {"cell": cell, "place": short_place(block.arrondissement)}
        return self.trace.record("locate", {"name": name, "lat": lat, "lon": lon}, result)

    def explain_block(self, cell: str, profile: Profile) -> dict:
        block = self.paris.blocks[cell]
        drivers = []
        for key, contribution, _ in block.drivers[profile]:
            info = self.paris.features[key]
            value = block.values.get(key)
            drivers.append(
                {
                    "feature": info.label,
                    "unit": info.unit,
                    "value": None if value is None else shown(value, info.unit),
                    "effect": "raises" if contribution > 0 else "lowers",
                }
            )
        result = {
            "place": short_place(block.arrondissement),
            "score": round(block.scores[profile]),
            "drivers": drivers,
        }
        return self.trace.record("explain_block", {"cell": cell, "profile": profile.value}, result)

    def compare_blocks(self, a: str, b: str, profile: Profile, keys: list[str]) -> dict:
        def side(cell: str) -> dict:
            block = self.paris.blocks[cell]
            return {
                "score": round(block.scores[profile]),
                **{k: shown(block.values[k], self.paris.features[k].unit) for k in keys},
            }

        result = {"a": side(a), "b": side(b)}
        args = {"a": a, "b": b, "profile": profile.value, "features": keys}
        return self.trace.record("compare_blocks", args, result)

    def validation(self) -> dict:
        result = {
            p: {
                method: round(v["mean_percentile"])
                for method, v in self.paris.validation[p].items()
            }
            for p in self.paris.validation
        }
        return self.trace.record("validation", {"held_out": "whole brands"}, result)

    def importance(self, profile: Profile, n: int = 3) -> list:
        result = [self.paris.features[k].label for k, _ in self.paris.importance[profile.value][:n]]
        return self.trace.record("importance", {"profile": profile.value, "n": n}, result)

    def satellite_benchmark(self) -> dict:
        bench = self.paris.benchmark
        if bench is None:
            raise LookupError("benchmark.json has not been built")
        sets = bench["sets"]
        base = sets["open data"]
        best = {
            p: max(
                (s for s in sets if s != "open data"), key=lambda s: sets[s][p]["mean_percentile"]
            )
            for p in base
        }
        result = {
            # older builds stored one description string, newer ones a dict by name
            "embeddings": (
                list(bench["embeddings"])
                if isinstance(bench["embeddings"], dict)
                else [bench["embeddings"].split()[0]]
            ),
            "splits": len(bench["seeds"]),
            "profiles": {
                p: {
                    "open_data": round(base[p]["mean_percentile"], 1),
                    "best_with_satellite": round(sets[best[p]][p]["mean_percentile"], 1),
                    "spread": round(base[p]["max"] - base[p]["min"], 1),
                }
                for p in base
            },
        }
        return self.trace.record("satellite_benchmark", {}, result)


@dataclass(frozen=True)
class Answer:
    text: str
    profile: Profile | None = None
    cells: tuple[str, ...] = ()
    # the two cells are a side-by-side comparison rather than a ranked list
    compare: bool = False


@dataclass(frozen=True)
class Question:
    id: str
    question: str
    answer: Callable[[Tools], Answer]


def white_space(profile: Profile) -> Callable[[Tools], Answer]:
    def run(t: Tools) -> Answer:
        top = t.top_blocks(profile, without_competitors=True)
        first = top[0]
        near = t.nearest_boutique(first["cell"], profile)
        others = places([(b["place"], str(b["score"])) for b in top[1:]])
        where = (
            "so the block extends an existing cluster"
            if near["metres"] <= CLUSTER_EDGE_M
            else "so this would open a new spot rather than join a cluster"
        )
        text = (
            f"The strongest block with no {PROFILE_NAME[profile]} boutique within about 350 m is in "
            f"{first['place']}, scoring {first['score']} / 100. The nearest one is {near['brand']}, "
            f"{num(near['metres'])} m away, {where}. The next blocks, with their scores, are in {others}."
        )
        return Answer(text, profile, tuple(b["cell"] for b in top))

    return run


def most_room(profile: Profile) -> Callable[[Tools], Answer]:
    def run(t: Tools) -> Answer:
        rows = t.room_by_arrondissement(profile)
        first = rows[0]
        rest = " and ".join(
            f"{r['place']} ({r['without_competitors']} of {r['strong_blocks']})" for r in rows[1:]
        )
        text = (
            f"{first['place'].capitalize()} has the most room: {first['strong_blocks']} of its blocks "
            f"score {STRONG} or more for a {PROFILE_NAME[profile]} brand, and "
            f"{first['without_competitors']} of those have no {PROFILE_NAME[profile]} boutique within "
            f"about 350 m. Next come {rest}."
        )
        return Answer(text, profile)

    return run


def why_top(profile: Profile) -> Callable[[Tools], Answer]:
    def run(t: Tools) -> Answer:
        top = t.top_blocks(profile, n=1)[0]
        why = t.explain_block(top["cell"], profile)
        parts = [
            f"{d['feature'].lower()} ({num(d['value'])}{'%' if d['unit'] == 'share' else ' ' + d['unit']})"
            if d["value"] is not None
            else f"{d['feature'].lower()} (no data)"
            for d in why["drivers"]
            if d["effect"] == "raises"
        ]
        text = (
            f"The top {PROFILE_NAME[profile]} block is in {why['place']}, at {why['score']} / 100. "
            f"What lifts it most: {', '.join(parts)}. These are the model's own explanations (SHAP "
            f"values) for this block, not a general rule."
        )
        return Answer(text, profile, (top["cell"],))

    return run


MARAIS = (48.8576, 2.3600)  # rue des Francs-Bourgeois
SAINT_GERMAIN = (48.8536, 2.3330)  # boulevard Saint-Germain at rue de Rennes


def marais_or_saint_germain(t: Tools) -> Answer:
    profile = Profile.FASHION_HOUSE
    a = t.locate("Le Marais, rue des Francs-Bourgeois", *MARAIS)
    b = t.locate("Saint-Germain-des-Prés", *SAINT_GERMAIN)
    keys = [NEIGHBOURS, "fashion_stores_r1", "transit_entries_r2"]
    c = t.compare_blocks(a["cell"], b["cell"], profile, keys)
    ca, cb = c["a"], c["b"]
    lead = "Saint-Germain" if cb["score"] > ca["score"] else "Le Marais"
    text = (
        f"For a fashion house, {lead} scores higher: Saint-Germain {cb['score']} / 100 against "
        f"{ca['score']} for Le Marais. Saint-Germain has {cb[NEIGHBOURS]} luxury boutiques nearby "
        f"and {cb['fashion_stores_r1']} fashion stores; Le Marais has {ca[NEIGHBOURS]} and "
        f"{ca['fashion_stores_r1']}. Station entries a day: {num(cb['transit_entries_r2'])} against "
        f"{num(ca['transit_entries_r2'])}."
    )
    return Answer(text, profile, (a["cell"], b["cell"]), compare=True)


def boutique_census(t: Tools) -> Answer:
    c = t.count_boutiques()
    by = c["by_profile"]
    busiest = places([(p, f"{n} boutiques") for p, n in c["top_arrondissements"]])
    text = (
        f"We found {c['total']} street boutiques of luxury brands in open data: "
        f"{by['fashion-house']} fashion houses, {by['jewellery-watches']} jewellery and watch "
        f"boutiques and {by['beauty']} beauty stores. Department-store counters are left out. "
        f"The busiest arrondissements are {busiest}."
    )
    return Answer(text)


def can_i_trust_it(t: Tools) -> Answer:
    v = t.validation()
    rows = "; ".join(
        f"{PROFILE_PLURAL[Profile(p)]}, {ordinal(s['model'])} (following nearby luxury alone: "
        f"{ordinal(s['luxury neighbours'])})"
        for p, s in v.items()
    )
    beaten = [
        PROFILE_PLURAL[Profile(p)] for p, s in v.items() if s["luxury neighbours"] > s["model"]
    ]
    caveat = (
        f" For {' and '.join(beaten)}, simply following other luxury boutiques does better than "
        "the model, and the map says so."
        if beaten
        else ""
    )
    text = (
        "We hid whole brands from the model and checked where their real boutiques landed. "
        f"On average they reached these percentiles: {rows}.{caveat}"
    )
    return Answer(text)


def what_matters(t: Tools) -> Answer:
    parts = []
    for p in Profile:
        top = t.importance(p)
        parts.append(f"for {PROFILE_PLURAL[p]}, {', '.join(x.lower() for x in top)}")
    text = (
        "Ranked by how much each feature moves the score across Paris (mean SHAP value), the "
        f"top three are: {'; '.join(parts)}."
    )
    return Answer(text)


def satellite(t: Tools) -> Answer:
    b = t.satellite_benchmark()
    rows = "; ".join(
        f"{PROFILE_PLURAL[Profile(p)]} {r['open_data']} without, {r['best_with_satellite']} at "
        f"best with (splits vary by {r['spread']})"
        for p, r in b["profiles"].items()
    )
    helps = [
        PROFILE_PLURAL[Profile(p)]
        for p, r in b["profiles"].items()
        if r["best_with_satellite"] - r["open_data"] > r["spread"]
    ]
    verdict, close = (
        (
            "Not for this question.",
            "Any gain is smaller than the variation between splits, so the satellite fingerprints "
            "stay out of the score.",
        )
        if not helps
        else (
            "For some brands.",
            f"The gain beats the variation between splits for {' and '.join(helps)}.",
        )
    )
    text = (
        f"{verdict} We tested {' and '.join(b['embeddings'])} over {b['splits']} brand splits. "
        f"Mean held-out percentile: {rows}. {close}"
    )
    return Answer(text)


QUESTIONS: list[Question] = [
    Question(
        "jewellery-white-space",
        "Where could a jewellery brand open, away from its competitors?",
        white_space(Profile.JEWELLERY_WATCHES),
    ),
    Question(
        "fashion-white-space",
        "Where could a fashion house open, away from its competitors?",
        white_space(Profile.FASHION_HOUSE),
    ),
    Question(
        "beauty-white-space",
        "Where could a beauty brand open, away from its competitors?",
        white_space(Profile.BEAUTY),
    ),
    Question(
        "beauty-room",
        "Which arrondissement has the most room for a beauty brand?",
        most_room(Profile.BEAUTY),
    ),
    Question(
        "fashion-why-top",
        "Why does the best fashion block score so high?",
        why_top(Profile.FASHION_HOUSE),
    ),
    Question(
        "marais-saint-germain",
        "Le Marais or Saint-Germain for a fashion house?",
        marais_or_saint_germain,
    ),
    Question(
        "census",
        "How many luxury boutiques are there in Paris, and where?",
        boutique_census,
    ),
    Question("trust", "Can I trust the score?", can_i_trust_it),
    Question("what-matters", "What matters most for each kind of brand?", what_matters),
    Question("satellite", "Do satellite images help?", satellite),
]


def run(question: Question, paris: Paris) -> dict:
    trace = Trace()
    answer = question.answer(Tools(paris, trace))
    return {
        "id": question.id,
        "question": question.question,
        "answer": answer.text,
        "profile": answer.profile.value if answer.profile else None,
        "cells": list(answer.cells),
        "compare": answer.compare,
        "calls": [vars(c) for c in trace.calls],
    }


def main() -> None:
    paris = Paris.load()
    answers = [run(q, paris) for q in QUESTIONS]
    OUTPUT.write_text(json.dumps({"answers": answers}, ensure_ascii=False, separators=(",", ":")))
    for a in answers:
        print(f"{a['question']}\n  {a['answer']}\n")


if __name__ == "__main__":
    main()
