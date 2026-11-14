import gzip
import warnings
from pathlib import Path

import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS

from level2_file import PIXEL_AREA_SR, reference_wcs, sky_cards
from spherex_explorer.errors import UpstreamError
from spherex_explorer.frames import DetectorWcs

DATA = Path(__file__).parent / "data"
_SKY_KEYWORDS = ("CTYPE", "CUNIT", "CRPIX", "CRVAL", "CDELT", "PC", "LONPOLE", "LATPOLE")
_DISTORTION = ("A_", "B_", "AP_", "BP_")


@pytest.fixture(scope="module")
def real_header() -> fits.Header:
    """Header of the image of a real exposure of Barnard's Star, detector 2."""
    text = gzip.decompress((DATA / "image_header_barnard_d2.txt.gz").read_bytes())
    return fits.Header.fromstring(text.decode("ascii"))


@pytest.fixture(scope="module")
def astropy_wcs(real_header) -> WCS:
    """The same coordinates as Astropy reads them, without the wavelength axes."""
    kept = fits.Header()
    for card in real_header.cards:
        keyword = card.keyword
        main = keyword.startswith(_SKY_KEYWORDS) and keyword[-1].isdigit()
        if main or keyword.startswith(_DISTORTION) or keyword in ("LONPOLE", "LATPOLE"):
            kept[keyword] = card.value
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return WCS(kept)


def test_pixels_of_a_real_image_go_to_the_sky_as_astropy_says(real_header, astropy_wcs):
    rng = np.random.default_rng(1)
    x, y = rng.uniform(0, 2039, 400), rng.uniform(0, 2039, 400)

    ra, dec = DetectorWcs.from_header(real_header).pixel_to_sky(x, y)
    expected_ra, expected_dec = astropy_wcs.all_pix2world(x, y, 0)

    # A thousandth of an arcsecond, for pixels of 6 arcseconds.
    assert np.abs((ra - expected_ra) * np.cos(np.radians(dec))).max() * 3600 < 1e-3
    assert np.abs(dec - expected_dec).max() * 3600 < 1e-3


def test_sky_goes_back_to_the_pixel_it_came_from(real_header):
    wcs = DetectorWcs.from_header(real_header)
    rng = np.random.default_rng(2)
    x, y = rng.uniform(0, 2039, 400), rng.uniform(0, 2039, 400)

    back_x, back_y = wcs.sky_to_pixel(*wcs.pixel_to_sky(x, y))

    assert np.abs(back_x - x).max() < 1e-4
    assert np.abs(back_y - y).max() < 1e-4


def test_barnards_star_is_on_the_detector_where_the_cutout_of_the_archive_was(real_header):
    x, y = DetectorWcs.from_header(real_header).sky_to_pixel(269.44623, 4.768703)

    # The archive cut 59 pixels from column 1132 and row 1943 around this position.
    assert 1132 < float(x) < 1191
    assert 1943 < float(y) < 2002


def test_a_pixel_of_spherex_covers_about_six_arcseconds(real_header):
    area = DetectorWcs.from_header(real_header).pixel_area_sr(1020.0, 1020.0)

    assert np.degrees(np.sqrt(area)) * 3600 == pytest.approx(6.15, abs=0.1)


def test_plain_projection_without_distortion_is_read_too():
    cards = sky_cards()
    wcs = DetectorWcs.from_header(fits.Header(cards))
    x, y = np.array([0.0, 40.0, 95.0]), np.array([0.0, 30.0, 71.0])

    ra, dec = wcs.pixel_to_sky(x, y)
    expected_ra, expected_dec = reference_wcs(cards).all_pix2world(x, y, 0)

    assert np.allclose(ra, expected_ra, atol=1e-9)
    assert np.allclose(dec, expected_dec, atol=1e-9)
    assert wcs.pixel_area_sr(40.0, 30.0) == pytest.approx(PIXEL_AREA_SR, rel=1e-4)


def test_position_on_the_far_side_of_the_sky_has_no_pixel():
    wcs = DetectorWcs.from_header(fits.Header(sky_cards()))

    x, y = wcs.sky_to_pixel(np.array(330.0), np.array(-20.0))

    assert np.isnan(x) and np.isnan(y)


@pytest.mark.parametrize(
    "change",
    [
        {"CTYPE1": "GLON-CAR"},
        {"LONPOLE": 90.0},
        {"CRVAL1": "somewhere"},
        {"PC1_1": 0.0, "PC1_2": 0.0},
    ],
)
def test_coordinates_this_service_does_not_handle_are_an_error(change):
    header = fits.Header(sky_cards())
    header.update(change)

    with pytest.raises(UpstreamError):
        DetectorWcs.from_header(header)


def test_header_without_coordinates_is_an_error():
    with pytest.raises(UpstreamError):
        DetectorWcs.from_header(fits.Header([("NAXIS", 2)]))
