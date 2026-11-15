"""A made-up body of the outer solar system: where it is drawn, how bright, and if it is found."""

import dataclasses

import numpy as np
import pytest

from made_up_field import field_frames, steady_stars
from spherex_explorer.api.candidates import candidates_out
from spherex_explorer.frames import Grid, sky_to_grid
from spherex_explorer.pipeline import report_field
from spherex_explorer.synthetic import STAR_WIDTH_ARCSEC, SyntheticBody, add_body, place_at
from spherex_explorer.targets import Target, parallax_shift

GRID = Grid(ra=133.76, dec=-7.24, fov_deg=96 * 2.8125 / 3600, size=96)
SCALE = GRID.scale_deg * 3600
FIRST_DAY = 60800.0
EPOCH = 2000 + (FIRST_DAY + 182.6 - 51544.5) / 365.25
PIXEL_SR = np.radians(GRID.scale_deg) ** 2


def body(distance_au: float = 6000.0, flux=None, pm=(0.0, 0.0)) -> SyntheticBody:
    seen = Target(ra=133.762, dec=-7.241, epoch=EPOCH, pm_ra=pm[0], pm_dec=pm[1])
    return SyntheticBody(seen, distance_au, flux if flux is not None else {2: 0.3, 5: 0.3})


def test_the_parallax_is_the_distance():
    assert body(6000.0).parallax_arcsec == pytest.approx(34.38, abs=0.01)
    assert body(206264.806).parallax_arcsec == pytest.approx(1.0)


def test_the_body_is_seen_away_from_where_the_sun_sees_it_by_its_parallax():
    far = body()
    for date in (FIRST_DAY, FIRST_DAY + 182.6):
        ra, dec = place_at(far, date)
        east, north = parallax_shift(133.762, -7.241, np.array(date))
        assert (ra - 133.762) * 3600 * np.cos(np.radians(-7.241)) == pytest.approx(
            34.38 * float(east), abs=0.02
        )
        assert (dec + 7.241) * 3600 == pytest.approx(34.38 * float(north), abs=0.02)
    # Six months apart the Earth is on the other side of the Sun, and so is the swing.
    first = np.array(place_at(far, FIRST_DAY))
    second = np.array(place_at(far, FIRST_DAY + 182.6))
    apart = np.hypot((first[0] - second[0]) * np.cos(np.radians(-7.241)), first[1] - second[1])
    assert apart * 3600 > 60


def test_its_own_motion_adds_to_its_swing():
    still = np.array(place_at(body(), FIRST_DAY + 182.6 + 365.25))
    moving = np.array(place_at(body(pm=(0.0, 3000.0)), FIRST_DAY + 182.6 + 365.25))

    assert (moving[1] - still[1]) * 3600 == pytest.approx(3.0, abs=0.01)
    assert moving[0] == pytest.approx(still[0], abs=1e-6)


def test_the_light_drawn_adds_up_to_the_flux():
    sky = np.zeros((96, 96), dtype=np.float32)

    drawn = add_body(sky, GRID, 5, FIRST_DAY + 90.0, body(flux={5: 2.0}))

    # Megajanskys per steradian, times the steradians of a pixel, in millijanskys.
    assert drawn.sum() * PIXEL_SR * 1e9 == pytest.approx(2.0, rel=0.01)
    assert drawn.dtype == np.float32
    assert not sky.any()


def test_the_body_is_drawn_where_it_is_with_the_width_of_a_star():
    far = body(flux={6: 1.0})
    date = FIRST_DAY + 90.0
    drawn = add_body(np.zeros((96, 96), dtype=np.float32), GRID, 6, date, far)

    x, y = sky_to_grid(GRID, *(np.array(value) for value in place_at(far, date)))
    rows, columns = np.mgrid[0:96, 0:96]
    center_x = (drawn * columns).sum() / drawn.sum()
    center_y = (drawn * rows).sum() / drawn.sum()
    assert (center_x, center_y) == pytest.approx((float(x), float(y)), abs=0.02)
    spread = np.sqrt((drawn * (columns - center_x) ** 2).sum() / drawn.sum())
    assert spread * SCALE == pytest.approx(STAR_WIDTH_ARCSEC[6], rel=0.02)


def test_a_detector_that_does_not_show_the_body_keeps_its_image():
    sky = np.ones((96, 96), dtype=np.float32)

    assert add_body(sky, GRID, 1, FIRST_DAY, body(flux={6: 1.0})) is sky


def test_a_pixel_without_a_value_stays_without_one():
    sky = np.zeros((96, 96), dtype=np.float32)
    sky[40:60, 40:60] = np.nan

    drawn = add_body(sky, GRID, 5, FIRST_DAY, body(flux={5: 1.0}))

    assert np.isnan(drawn[40:60, 40:60]).all()
    assert np.isfinite(drawn[:40]).all()


def test_the_search_finds_the_made_up_body_and_its_distance():
    far = body(distance_au=6000.0)
    frames = [
        dataclasses.replace(
            frame, image=add_body(frame.image, GRID, frame.detector, frame.time_mjd, far)
        )
        for frame in field_frames(lambda detector, visit, wavelength: steady_stars())
    ]

    out = candidates_out(report_field(Target(ra=GRID.ra, dec=GRID.dec), GRID, frames))

    found = out.model_dump(by_alias=True)["candidates"]
    assert [(one["kind"], one["confidence"]) for one in found] == [("swung", "high")]
    assert found[0]["swing"]["distance_au"] == pytest.approx(6000, rel=0.03)
    assert (found[0]["ra"], found[0]["dec"]) == pytest.approx((133.762, -7.241), abs=0.0005)
