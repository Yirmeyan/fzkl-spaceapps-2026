"""Parallax: where the Earth is, and where that puts a nearby object on the sky."""

import numpy as np
import pytest
from astropy.coordinates import get_body_barycentric
from astropy.time import Time

from spherex_explorer.targets.parallax import (
    LIGHT_YEARS_AT_ONE_ARCSECOND,
    earth_position,
    parallax_shift,
)

# Dates across the survey: its start, a few seasons, the end of the first data release.
DATES = np.array([60790.0, 60880.5, 60975.25, 61060.0, 61155.75, 61250.0, 61340.5])


def reference_earth(time_mjd: np.ndarray) -> np.ndarray:
    place = get_body_barycentric("earth", Time(time_mjd, format="mjd"))
    return np.array([place.x.to_value("au"), place.y.to_value("au"), place.z.to_value("au")])


def test_the_earth_is_where_astropy_puts_it():
    ours = np.array(earth_position(DATES))

    # The Sun itself sits up to 0.01 astronomical unit from the center the reference uses.
    assert ours == pytest.approx(reference_earth(DATES), abs=0.015)
    assert np.linalg.norm(ours, axis=0) == pytest.approx(1.0, abs=0.02)


@pytest.mark.parametrize(
    ("ra", "dec"), [(269.45, 4.69), (331.04, -56.78), (133.76, -7.24), (10.0, 80.0)]
)
def test_an_object_shifts_away_from_where_the_earth_went(ra, dec):
    east, north = parallax_shift(ra, dec, DATES)

    alpha, delta = np.radians(ra), np.radians(dec)
    toward_east = np.array([-np.sin(alpha), np.cos(alpha), 0.0])
    toward_north = np.array(
        [-np.cos(alpha) * np.sin(delta), -np.sin(alpha) * np.sin(delta), np.cos(delta)]
    )
    earth = reference_earth(DATES)
    assert east == pytest.approx(-toward_east @ earth, abs=0.015)
    assert north == pytest.approx(-toward_north @ earth, abs=0.015)
    assert (np.hypot(east, north) <= 1.02).all()


def test_six_months_apart_the_shift_is_the_other_way():
    east, north = parallax_shift(133.76, -7.24, np.array([60801.0, 60801.0 + 182.6]))

    assert east[0] == pytest.approx(-east[1], abs=0.05)
    assert north[0] == pytest.approx(-north[1], abs=0.05)


def test_one_arcsecond_of_parallax_is_one_parsec():
    assert pytest.approx(3.2616, abs=1e-4) == LIGHT_YEARS_AT_ONE_ARCSECOND
