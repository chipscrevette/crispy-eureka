import h3
import numpy as np

from adresse_pipeline.grid import RESOLUTION
from adresse_pipeline.olmoearth import add_raster, embedding_rasters


def write_raster(path, data, west=448_000.0, north=5_413_000.0):
    import rasterio
    from rasterio.transform import from_origin

    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=data.shape[2],
        height=data.shape[1],
        count=data.shape[0],
        dtype="float32",
        crs="EPSG:32631",
        transform=from_origin(west, north, 40, 40),
    ) as dst:
        dst.write(data)


def test_cells_get_the_plain_mean_of_their_valid_pixels(tmp_path):
    raster = tmp_path / "windows" / "default" / "w0" / "layers" / "embeddings" / "geotiff.tif"
    raster.parent.mkdir(parents=True)
    data = np.ones((3, 4, 4), dtype=np.float32)
    data[:, 0, 0] = [3, 3, 3]
    data[:, 3, 3] = 0  # nodata pixels come out as all zeros
    write_raster(raster, data)
    assert embedding_rasters(tmp_path) == [raster]

    sums, counts = {}, {}
    cells = {h3.latlng_to_cell(48.857, 2.31, RESOLUTION)}  # far away: ignored
    add_raster(sums, counts, raster, cells)
    assert sums == {}

    import rasterio

    with rasterio.open(raster) as src:
        from pyproj import Transformer

        lon, lat = Transformer.from_crs(src.crs, 4326, always_xy=True).transform(*src.xy(1, 1))
    cell = h3.latlng_to_cell(lat, lon, RESOLUTION)
    add_raster(sums, counts, raster, {cell})
    mean = sums[cell] / counts[cell]
    assert counts[cell] >= 1 and np.all(mean >= 1)
