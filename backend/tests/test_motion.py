import pytest

from spherex_explorer.targets import Target, position_at

MJD_J2000 = 51544.5
JULIAN_YEAR = 365.25
ONE_DEGREE_PER_YEAR = 3.6e6


def test_target_without_motion_stays_in_place():
    target = Target(ra=10.0, dec=-20.0)

    assert position_at(target, MJD_J2000 + 30 * JULIAN_YEAR) == (10.0, -20.0)


def test_motion_toward_the_north_changes_declination_only():
    target = Target(ra=10.0, dec=0.0, pm_dec=ONE_DEGREE_PER_YEAR)

    ra, dec = position_at(target, MJD_J2000 + 2 * JULIAN_YEAR)

    assert ra == pytest.approx(10.0)
    assert dec == pytest.approx(2.0)


def test_motion_toward_the_east_is_an_angle_on_the_sky():
    # At 60 degrees of declination, one degree on the sky spans two degrees of right ascension.
    target = Target(ra=10.0, dec=60.0, pm_ra=ONE_DEGREE_PER_YEAR)

    ra, dec = position_at(target, MJD_J2000 + JULIAN_YEAR)

    assert ra == pytest.approx(12.0)
    assert dec == pytest.approx(60.0)


def test_motion_starts_at_the_epoch_of_the_position():
    target = Target(ra=10.0, dec=0.0, epoch=2016.0, pm_dec=ONE_DEGREE_PER_YEAR)

    _, at_epoch = position_at(target, MJD_J2000 + 16 * JULIAN_YEAR)
    _, a_year_later = position_at(target, MJD_J2000 + 17 * JULIAN_YEAR)

    assert at_epoch == pytest.approx(0.0)
    assert a_year_later == pytest.approx(1.0)


def test_right_ascension_stays_between_0_and_360():
    target = Target(ra=359.5, dec=0.0, pm_ra=ONE_DEGREE_PER_YEAR)

    ra, _ = position_at(target, MJD_J2000 + JULIAN_YEAR)

    assert ra == pytest.approx(0.5)


def test_pole_does_not_break_the_computation():
    target = Target(ra=123.0, dec=90.0, pm_ra=ONE_DEGREE_PER_YEAR, pm_dec=ONE_DEGREE_PER_YEAR)

    assert position_at(target, MJD_J2000 + JULIAN_YEAR) == (123.0, 90.0)
