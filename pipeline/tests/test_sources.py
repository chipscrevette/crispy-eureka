import gzip
import zipfile

import h3
import pytest

from adresse_pipeline import dvf, insee
from adresse_pipeline.grid import cell_of, ring_sum, ring_weighted_mean

# --- grid ---


def test_ring_sum_counts_the_cell_and_its_six_neighbours():
    centre = cell_of(2.3308, 48.8686)
    neighbour = next(c for c in h3.grid_disk(centre, 1) if c != centre)
    far = next(iter(h3.grid_ring(centre, 3)))
    values = {centre: 2, neighbour: 3, far: 100}

    assert ring_sum(values, [centre])[centre] == 5


def test_ring_weighted_mean_is_none_where_nobody_lives():
    centre = cell_of(2.3308, 48.8686)
    assert ring_weighted_mean({}, {}, [centre])[centre] is None


def test_ring_weighted_mean_weights_by_population():
    centre = cell_of(2.3308, 48.8686)
    neighbour = next(c for c in h3.grid_disk(centre, 1) if c != centre)
    mean = ring_weighted_mean({centre: 10, neighbour: 40}, {centre: 3, neighbour: 1}, [centre])
    assert mean[centre] == pytest.approx(17.5)


# --- INSEE Filosofi ---


def test_square_centre_lands_in_paris():
    # The square holding Place Vendôme in ETRS89-LAEA.
    lon, lat = insee.square_centre("CRS3035RES200mN2890800E3759200")
    assert lon == pytest.approx(2.3294, abs=0.003)
    assert lat == pytest.approx(48.8675, abs=0.002)


def test_square_centre_rejects_other_ids():
    with pytest.raises(ValueError):
        insee.square_centre("CRS3035RES1000mN2891000E3759000")


FILOSOFI_CSV = (
    "Idcar_200m;Lcog_geo;Ind;Ind_snv;Men;Men_pauv;Men_prop\n"
    "CRS3035RES200mN2890800E3759200;75101;120;6000000;70;5;30\n"
    "CRS3035RES200mN2890800E3759400;75101;80;3200000;40;4;10\n"
    "CRS3035RES200mN2880000E3770000;92012;500;10000000;200;20;100\n"
)


def filosofi_zip(tmp_path):
    path = tmp_path / "filosofi.zip"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("carreaux_200m_reun.csv", "")
        z.writestr("carreaux_200m_met.csv", FILOSOFI_CSV)
    return path


def test_reads_paris_squares_from_the_metropolitan_csv_with_any_header_case(tmp_path):
    squares = list(insee.read_squares(insee.csv_rows_from_zip(filosofi_zip(tmp_path))))

    assert len(squares) == 2
    assert squares[0].individuals == 120 and squares[0].owner_households == 30


def test_by_cell_sums_squares_sharing_a_cell(tmp_path):
    squares = list(insee.read_squares(insee.csv_rows_from_zip(filosofi_zip(tmp_path))))
    cells = insee.by_cell(squares)

    assert sum(c.individuals for c in cells.values()) == 200
    assert sum(c.living_standard_sum for c in cells.values()) == 9_200_000


# --- DVF ---

DVF_HEADER = "id_mutation,date_mutation,nature_mutation,valeur_fonciere,type_local,surface_reelle_bati,longitude,latitude\n"


def dvf_rows(tmp_path, body):
    path = tmp_path / "75.csv.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write(DVF_HEADER + body)
    return list(dvf.read_rows(path))


def test_keeps_a_single_apartment_sale_with_its_cellar(tmp_path):
    rows = dvf_rows(
        tmp_path,
        "m1,2024-03-01,Vente,600000,Appartement,50,2.33,48.86\n"
        "m1,2024-03-01,Vente,600000,Dépendance,,2.33,48.86\n",
    )
    [sale] = dvf.single_premise_sales(rows)
    assert sale.kind is dvf.Kind.APARTMENT
    assert sale.price_m2 == 12_000 and sale.year == 2024


def test_drops_sales_of_several_premises_sharing_one_price(tmp_path):
    rows = dvf_rows(
        tmp_path,
        "m2,2024-03-01,Vente,2000000,Appartement,50,2.33,48.86\n"
        "m2,2024-03-01,Vente,2000000,Appartement,60,2.33,48.86\n",
    )
    assert list(dvf.single_premise_sales(rows)) == []


def test_drops_non_sales_houses_and_implausible_prices(tmp_path):
    rows = dvf_rows(
        tmp_path,
        "m3,2024-03-01,Echange,600000,Appartement,50,2.33,48.86\n"
        "m4,2024-03-01,Vente,900000,Maison,90,2.33,48.86\n"
        "m5,2024-03-01,Vente,1,Appartement,50,2.33,48.86\n"
        "m6,2024-03-01,Vente,600000,Appartement,,2.33,48.86\n",
    )
    assert list(dvf.single_premise_sales(rows)) == []


def test_keeps_commercial_premises(tmp_path):
    rows = dvf_rows(
        tmp_path,
        "m7,2023-06-01,Vente,1500000,Local industriel. commercial ou assimilé,100,2.33,48.86\n",
    )
    [sale] = dvf.single_premise_sales(rows)
    assert sale.kind is dvf.Kind.COMMERCIAL and sale.price_m2 == 15_000


def test_median_widens_to_two_rings_when_sales_are_sparse():
    centre = cell_of(2.3308, 48.8686)
    two_away = next(iter(h3.grid_ring(centre, 2)))
    lat, lon = h3.cell_to_latlng(two_away)
    sales = [dvf.Sale(dvf.Kind.APARTMENT, 2024, lon, lat, p) for p in (10_000, 12_000, 14_000)]

    medians, counts = dvf.median_price_m2(sales, dvf.Kind.APARTMENT, [centre], min_sales=3)

    assert medians[centre] == 12_000
    assert counts[centre] == 0


def test_no_median_without_enough_sales():
    centre = cell_of(2.3308, 48.8686)
    lat, lon = h3.cell_to_latlng(centre)
    sales = [dvf.Sale(dvf.Kind.APARTMENT, 2024, lon, lat, 10_000)]

    medians, _ = dvf.median_price_m2(sales, dvf.Kind.APARTMENT, [centre], min_sales=5)

    assert medians[centre] is None


# --- retries on busy servers ---


def test_downloads_retry_busy_or_stalled_servers_but_not_missing_files(monkeypatch):
    import urllib.error

    from adresse_pipeline import download

    monkeypatch.setattr(download.time, "sleep", lambda s: None)
    failures = [
        urllib.error.HTTPError("u", 502, "Bad Gateway", {}, None),
        TimeoutError("read timed out"),
    ]

    def flaky():
        if failures:
            raise failures.pop(0)
        return "ok"

    assert download.retrying(flaky) == "ok"

    calls = []

    def missing():
        calls.append(1)
        raise urllib.error.HTTPError("u", 404, "Not Found", {}, None)

    with pytest.raises(urllib.error.HTTPError):
        download.retrying(missing)
    assert len(calls) == 1

    def always_stalls():
        calls.append(1)
        raise TimeoutError("read timed out")

    calls.clear()
    with pytest.raises(TimeoutError):
        download.retrying(always_stalls, attempts=3)
    assert len(calls) == 3


def test_fetch_replaces_an_html_page_saved_as_a_zip(tmp_path, monkeypatch):
    import io

    from adresse_pipeline import download

    monkeypatch.setattr(download, "CACHE", tmp_path)
    monkeypatch.setattr(download.time, "sleep", lambda s: None)
    url = "https://example.org/data.zip"
    cached = tmp_path / "example.org" / "data.zip"
    cached.parent.mkdir(parents=True)
    cached.write_text("<html>Too many requests</html>")

    good = io.BytesIO()
    with zipfile.ZipFile(good, "w") as z:
        z.writestr("a.csv", "x\n1\n")
    answers = [b"<html>still busy</html>", good.getvalue()]
    monkeypatch.setattr(
        download.urllib.request, "urlopen", lambda url, timeout: io.BytesIO(answers.pop(0))
    )

    assert zipfile.is_zipfile(download.fetch(url))
    assert answers == []
