import numpy as np
import pytest

from conftest import BARNARD
from spherex_explorer.frames import Grid, grid_to_sky, pixel_centers, sky_to_grid
from spherex_explorer.targets import Target, position_at

GRID = Grid(ra=269.44623, dec=4.768703, fov_deg=0.1, size=128)


def test_center_of_the_image_is_the_center_of_the_grid():
    ra, dec = grid_to_sky(GRID, np.array(63.5), np.array(63.5))

    assert float(ra) == pytest.approx(GRID.ra, abs=1e-12)
    assert float(dec) == pytest.approx(GRID.dec, abs=1e-12)


def test_north_is_up_and_east_is_left():
    x, y = sky_to_grid(
        GRID, np.array([GRID.ra, GRID.ra + 0.01]), np.array([GRID.dec + 0.01, GRID.dec])
    )

    assert y[0] < GRID.center and x[0] == pytest.approx(GRID.center, abs=1e-9)
    assert x[1] < GRID.center


def test_one_pixel_covers_the_field_divided_by_the_size():
    _, dec = grid_to_sky(GRID, np.array([63.5, 63.5]), np.array([63.5, 62.5]))

    assert (dec[1] - dec[0]) * 3600 == pytest.approx(2.8125, rel=1e-6)


def test_sky_and_grid_conversions_undo_each_other():
    grid = Grid(ra=10.0, dec=-75.0, fov_deg=0.5, size=64)
    x, y = pixel_centers(grid)

    back_x, back_y = sky_to_grid(grid, *grid_to_sky(grid, x, y))

    assert np.allclose(back_x, x, atol=1e-8)
    assert np.allclose(back_y, y, atol=1e-8)


def test_right_ascension_stays_between_0_and_360():
    grid = Grid(ra=0.001, dec=10.0, fov_deg=0.1, size=32)

    ra, _ = grid_to_sky(grid, *pixel_centers(grid))

    assert ra.min() >= 0.0 and ra.max() < 360.0
    assert (ra > 359.9).any() and (ra < 0.1).any()


def test_target_of_every_frame_of_the_sample_is_where_the_contract_says(sample_bundle):
    target = Target(**BARNARD)
    grid = Grid(**{key: sample_bundle["grid"][key] for key in ("ra", "dec", "fov_deg", "size")})

    for frame in sample_bundle["frames"]:
        ra, dec = position_at(target, frame["time_mjd"])
        x, y = sky_to_grid(grid, np.array(ra), np.array(dec))
        assert float(x) == pytest.approx(frame["target_xy"][0], abs=0.006)
        assert float(y) == pytest.approx(frame["target_xy"][1], abs=0.006)
