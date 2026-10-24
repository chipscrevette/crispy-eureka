import io
import json

import pandas as pd
import pytest

from adresse_pipeline import sirene
from adresse_pipeline.demand import EQUAL, Blocks, Group, group_shares, index, sensitivity

# --- Sirene ---

COLUMNS = sirene.COLUMNS
VENDOME = ("650900", "6862700")  # Lambert 93 metres


def stock(tmp_path, rows):
    path = tmp_path / "StockEtablissement_utf8.parquet"
    pd.DataFrame(rows, columns=COLUMNS).to_parquet(path, index=False)
    return path


def test_counts_only_open_paris_establishments_with_staff_and_a_position(tmp_path):
    path = stock(
        tmp_path,
        [
            ("1", "75101", "A", "12", *VENDOME),  # 20 to 49 people, open
            ("2", "75108", "F", "53", *VENDOME),  # closed: a headquarters that moved out
            ("3", "75101", "A", "NN", *VENDOME),  # no staff that year
            ("4", "75101", "A", "03", "[ND]", "[ND]"),  # position not published
            ("5", "92012", "A", "53", *VENDOME),  # Boulogne, outside Paris
            ("6", "75116", "A", "01", "648000", "6862000"),
        ],
    )
    found = list(sirene.establishments(sirene.read_rows(path)))

    assert [e.siret for e in found] == ["1", "6"]
    assert sum(e.workers for e in found) == 34.5 + 1.5
    assert found[0].lon == pytest.approx(2.33, abs=0.01)
    assert found[0].lat == pytest.approx(48.86, abs=0.01)


def test_refuses_a_stock_without_positions(tmp_path):
    path = tmp_path / "old.parquet"
    pd.DataFrame([("1", "75101", "A", "12")], columns=COLUMNS[:4]).to_parquet(path)
    with pytest.raises(ValueError, match="coordonneeLambert"):
        list(sirene.read_rows(path))


# --- demand index ---


def blocks(**columns):
    base = {"resident_income": [1.0] * 3, "workers": [1.0] * 3}
    base |= {"hotels": [1.0] * 3, "station_entries": [1.0] * 3}
    return Blocks(pd.DataFrame(base | columns, index=["a", "b", "c"]))


def test_each_group_is_a_share_of_paris():
    shares = group_shares(blocks(workers=[0.0, 30.0, 10.0], hotels=[4.0, 0.0, 0.0]))

    assert shares.sum().tolist() == pytest.approx([1, 1, 1])
    assert shares[Group.WORKERS]["b"] == pytest.approx(0.75)
    # visitors: half from hotels (all in a), half from even station entries
    assert shares[Group.VISITORS]["a"] == pytest.approx(0.5 + 1 / 6)


def test_the_average_block_scores_100():
    demand = index(group_shares(blocks(workers=[0.0, 30.0, 10.0])), EQUAL)

    assert demand.mean() == pytest.approx(100)
    assert demand.idxmax() == "b"


def test_units_cancel_out():
    # income in euros dwarfs worker counts, yet one block of each counts the same
    shares = group_shares(blocks(resident_income=[9e9, 0, 0], workers=[0, 9, 0]))
    demand = index(shares, EQUAL)

    assert demand["a"] == pytest.approx(demand["b"])


def test_a_group_with_no_data_is_an_error_not_a_zero():
    with pytest.raises(ValueError, match="workers"):
        group_shares(blocks(workers=[0.0, 0.0, 0.0]))


def test_sensitivity_names_every_variant():
    shares = group_shares(
        blocks(resident_income=[1.0, 2.0, 3.0], workers=[0.0, 30.0, 10.0], hotels=[4.0, 0.0, 1.0])
    )
    names = [row["weights"] for row in sensitivity(shares)]

    assert len(names) == 6 and "workers only" in names and "without visitors" in names


def test_finds_this_month_s_establishment_stock_in_parquet(monkeypatch):
    titles = [
        "Sirene : Fichier StockEtablissement - 01 octobre 2026",
        "Sirene : Fichier StockEtablissement - 01 octobre 2026 (format parquet)",
        "Sirene : Fichier StockEtablissementHistorique - 01 octobre 2026 (format parquet)",
    ]
    body = {
        "resources": [
            {"title": t, "url": f"u{i}", "last_modified": "2026-10-01T03:00"}
            for i, t in enumerate(titles)
        ]
    }
    monkeypatch.setattr(
        sirene.urllib.request, "urlopen", lambda *a, **k: io.BytesIO(json.dumps(body).encode())
    )

    assert sirene.stock_release() == sirene.Release("u1", "2026-10-01")
