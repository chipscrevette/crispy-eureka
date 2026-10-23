import h3
import numpy as np
import pandas as pd

from adresse_pipeline.alphaearth import add_to_cells, dequantize, unit
from adresse_pipeline.benchmark import pca

VENDOME = (2.3290, 48.8675)
BASTILLE = (2.3690, 48.8530)


def test_dequantize_follows_the_dataset_readme():
    raw = np.array([127, -127, 0, 64], dtype=np.int8)
    np.testing.assert_allclose(
        dequantize(raw),
        [(127 / 127.5) ** 2, -((127 / 127.5) ** 2), 0, (64 / 127.5) ** 2],
        rtol=1e-6,
    )


def test_cell_mean_is_the_renormalised_sum_and_ignores_cells_outside_paris():
    a, b = np.array([1.0, 0.0]), np.array([0.0, 1.0])
    lon = np.array([VENDOME[0], VENDOME[0], BASTILLE[0]])
    lat = np.array([VENDOME[1], VENDOME[1], BASTILLE[1]])
    vendome = h3.latlng_to_cell(VENDOME[1], VENDOME[0], 9)
    sums: dict = {}
    add_to_cells(sums, iter([(lon, lat, np.stack([a, b, a]))]), {vendome})
    assert list(sums) == [vendome]
    np.testing.assert_allclose(unit(sums[vendome]), [2**-0.5, 2**-0.5])


def test_pca_keeps_the_main_direction():
    x = pd.DataFrame({"a": [0.0, 1, 2, 3], "b": [0.0, 1, 2, 3.1], "c": [1.0, 1, 1, 1]})
    out = pca(x, 1)
    assert out.shape == (4, 1)
    assert abs(np.corrcoef(out["aef_pc1"], x["a"])[0, 1]) > 0.99
