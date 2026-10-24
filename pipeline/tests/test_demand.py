import gzip

import pandas as pd
import pytest

from adresse_pipeline import sirene
from adresse_pipeline.demand import EQUAL, Blocks, Group, group_shares, index, sensitivity

# --- Sirene ---

SIRENE_CSV = (
    "siret,etatAdministratifEtablissement,trancheEffectifsEtablissement,longitude,latitude\n"
    "1,A,12,2.3294,48.8675\n"  # 20 to 49 people, open
    "2,F,53,2.3294,48.8675\n"  # closed: a headquarters that moved out
    "3,A,NN,2.3294,48.8675\n"  # no staff that year
    "4,A,03,,\n"  # open but not geolocated
    "5,A,01,2.3500,48.8600\n"
)


def sirene_file(tmp_path, text=SIRENE_CSV):
    path = tmp_path / "geo_siret_75.csv.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write(text)
    return path


def test_counts_only_open_geolocated_establishments_with_staff(tmp_path):
    found = list(sirene.establishments(sirene.read_rows(sirene_file(tmp_path))))

    assert [e.siret for e in found] == ["1", "5"]
    assert sum(e.workers for e in found) == 34.5 + 1.5


def test_reads_lambert_93_positions_from_the_insee_stock(tmp_path):
    text = (
        "siret;etatAdministratifEtablissement;trancheEffectifsEtablissement;"
        "coordonneeLambertAbscisseEtablissement;coordonneeLambertOrdonneeEtablissement\n"
        "1;A;11;650900;6862700\n"
    )
    (place,) = sirene.establishments(sirene.read_rows(sirene_file(tmp_path, text)))

    assert place.lon == pytest.approx(2.33, abs=0.01)
    assert place.lat == pytest.approx(48.86, abs=0.01)


def test_refuses_a_file_without_positions(tmp_path):
    text = "siret,etatAdministratifEtablissement,trancheEffectifsEtablissement\n1,A,12\n"
    with pytest.raises(ValueError, match="unexpected Sirene file"):
        list(sirene.establishments(sirene.read_rows(sirene_file(tmp_path, text))))


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
