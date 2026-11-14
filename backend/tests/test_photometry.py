import numpy as np
import pytest

from level2_file import PIXEL_AREA_SR, star
from spherex_explorer.photometry import measure, share_inside_circle
from spherex_explorer.photometry.aperture import APERTURE_RADIUS

SHAPE = (41, 41)
SIGMA = 1.3
AMPLITUDE = 50.0
SKY = 0.3
# Light of a round star that falls inside the circle of the measurement.
INSIDE = 1 - np.exp(-(APERTURE_RADIUS**2) / (2 * SIGMA**2))
TOTAL_MJY = AMPLITUDE * 2 * np.pi * SIGMA**2 * PIXEL_AREA_SR * 1e9


def scene(x: float = 20.3, y: float = 19.6):
    rng = np.random.default_rng(5)
    image = (SKY + rng.normal(0, 0.02, SHAPE) + star(SHAPE, x, y, AMPLITUDE, SIGMA)).astype("f4")
    variance = np.full(SHAPE, 0.02**2, dtype=np.float32)
    nothing = np.zeros(SHAPE, dtype=bool)
    return image, variance, np.zeros(SHAPE, dtype=np.uint8), nothing.copy(), nothing.copy(), x, y


def test_flux_of_a_star_is_the_light_inside_the_circle_minus_the_sky():
    result = measure(*scene(), PIXEL_AREA_SR)

    assert result.quality == "ok"
    assert result.flux_mjy == pytest.approx(INSIDE * TOTAL_MJY, rel=0.02)


def test_flux_is_divided_by_the_share_of_the_light_the_circle_catches():
    whole = measure(*scene(), PIXEL_AREA_SR)
    corrected = measure(*scene(), PIXEL_AREA_SR, share_inside=0.98)

    assert corrected.flux_mjy == pytest.approx(whole.flux_mjy / 0.98)
    assert corrected.error_mjy == pytest.approx(whole.error_mjy / 0.98)


@pytest.mark.parametrize("detector", [1, 2, 3, 4, 5, 6])
def test_circle_catches_about_98_percent_of_a_point_source_in_every_detector(detector):
    assert 0.97 < share_inside_circle(detector) < 0.99


def test_share_of_a_detector_that_does_not_exist_is_refused():
    with pytest.raises(ValueError, match="detector 7"):
        share_inside_circle(7)


def test_uncertainty_of_a_bright_star_is_the_scatter_between_exposures():
    result = measure(*scene(), PIXEL_AREA_SR)

    # The noise of the file is far below 1 percent here: what is left is the 2 percent
    # by which exposures of a steady star differ.
    assert result.error_mjy == pytest.approx(0.02 * result.flux_mjy, rel=0.05)


def test_uncertainty_of_a_faint_star_is_the_noise_of_the_file():
    image, variance, mask, no_value, saturated, x, y = scene()
    image = SKY + np.random.default_rng(7).normal(0, 0.02, SHAPE) + star(SHAPE, x, y, 0.05, SIGMA)
    image = image.astype("f4")

    result = measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR)

    noise = 0.02 * np.sqrt(np.pi * APERTURE_RADIUS**2) * PIXEL_AREA_SR * 1e9
    assert result.error_mjy == pytest.approx(noise, rel=0.15)


def test_flux_does_not_depend_on_where_the_star_falls_inside_a_pixel():
    fluxes = [
        measure(*scene(20.0 + shift, 20.0 - shift / 2), PIXEL_AREA_SR).flux_mjy
        for shift in (0.0, 0.25, 0.5, 0.75)
    ]

    assert max(fluxes) / min(fluxes) < 1.02


def test_empty_sky_gives_a_flux_compatible_with_zero():
    image, variance, mask, no_value, saturated, x, y = scene()
    image = np.random.default_rng(6).normal(SKY, 0.02, SHAPE).astype("f4")

    result = measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR)

    assert abs(result.flux_mjy) < 4 * result.error_mjy


def test_saturated_pixel_in_the_circle_gives_no_value():
    image, variance, mask, no_value, saturated, x, y = scene()
    saturated[20, 20] = True
    image[20, 20] = np.nan

    result = measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR)

    assert (result.flux_mjy, result.error_mjy, result.quality) == (None, None, "saturated")


def test_pixel_that_nears_saturation_keeps_the_value_with_a_warning_and_a_wider_uncertainty():
    image, variance, mask, no_value, saturated, x, y = scene()
    saturated[20, 20] = True
    mask[20, 20] = 2

    result = measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR)

    assert result.quality == "flagged"
    assert result.flux_mjy == pytest.approx(INSIDE * TOTAL_MJY, rel=0.02)
    assert result.error_mjy == pytest.approx(0.05 * result.flux_mjy, rel=0.05)


def test_overflowing_pixel_declared_unusable_counts_as_saturated():
    image, variance, mask, no_value, saturated, x, y = scene()
    saturated[20, 20] = True
    no_value[20, 20] = True

    result = measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR)

    assert (result.flux_mjy, result.quality) == (None, "saturated")


@pytest.mark.parametrize("damage", ["hole", "unusable", "no variance"])
def test_pixel_without_data_in_the_circle_gives_no_value(damage):
    image, variance, mask, no_value, saturated, x, y = scene()
    if damage == "hole":
        image[19, 21] = np.nan
    elif damage == "unusable":
        no_value[19, 21] = True
    else:
        variance[19, 21] = np.nan

    result = measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR)

    assert (result.flux_mjy, result.quality) == (None, "masked")


def test_flag_in_the_circle_keeps_the_value_and_says_so():
    image, variance, mask, no_value, saturated, x, y = scene()
    mask[20, 21] = 1

    result = measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR)

    assert result.quality == "flagged"
    assert result.flux_mjy == pytest.approx(INSIDE * TOTAL_MJY, rel=0.02)


def test_flag_far_from_the_circle_changes_nothing():
    image, variance, mask, no_value, saturated, x, y = scene()
    mask[2, 2] = 1
    saturated[38, 38] = True

    assert measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR).quality == "ok"


@pytest.mark.parametrize(("x", "y"), [(1.0, 20.0), (20.0, 39.5), (-30.0, 20.0), (np.nan, 20.0)])
def test_circle_that_leaves_the_detector_is_outside(x, y):
    image, variance, mask, no_value, saturated, _, _ = scene()

    result = measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR)

    assert (result.flux_mjy, result.quality) == (None, "outside")


def test_sky_is_taken_from_flagged_pixels_when_the_ring_has_no_clean_one():
    image, variance, mask, no_value, saturated, x, y = scene()
    mask[:] = 64

    result = measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR)

    assert result.quality == "flagged"
    assert result.flux_mjy == pytest.approx(INSIDE * TOTAL_MJY, rel=0.02)


def test_ring_without_enough_usable_pixels_gives_no_value():
    image, variance, mask, no_value, saturated, x, y = scene()
    rows, columns = np.indices(SHAPE)
    far = np.hypot(columns - x, rows - y) > 4.0
    image[far] = np.nan

    result = measure(image, variance, mask, no_value, saturated, x, y, PIXEL_AREA_SR)

    assert (result.flux_mjy, result.quality) == (None, "masked")
