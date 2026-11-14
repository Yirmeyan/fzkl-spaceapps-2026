import asyncio

import numpy as np
import pytest

from level2_file import (
    EXPOSURE_ID,
    FLAG_PLANES,
    HEIGHT,
    KEY,
    MJD,
    PIXEL_AREA_SR,
    SKY_CENTER,
    WIDTH,
    FakeStorage,
    build_level2_file,
    detector_position,
    reference_wcs,
    sky_cards,
    star,
)
from spherex_explorer.archive import Level2Reader
from spherex_explorer.frames import Grid
from spherex_explorer.photometry.aperture import APERTURE_RADIUS
from spherex_explorer.pipeline import build_frame
from spherex_explorer.targets import Target

SIGMA = 1.3
AMPLITUDE = 50.0
ARCSEC = 1 / 3600
# A star 20 arcseconds north-east of the middle of the detector.
STAR = (
    SKY_CENTER[0] + 15 * ARCSEC / np.cos(np.radians(SKY_CENTER[1])),
    SKY_CENTER[1] + 13 * ARCSEC,
)
GRID = Grid(ra=SKY_CENTER[0], dec=SKY_CENTER[1], fov_deg=0.05, size=64)


def sky_with(*stars: tuple[float, float], seed: int = 3) -> np.ndarray:
    image = np.random.default_rng(seed).normal(0.3, 0.02, (HEIGHT, WIDTH))
    for ra, dec in stars:
        image += star((HEIGHT, WIDTH), *detector_position(ra, dec), AMPLITUDE, SIGMA)
    return image


def frame_of(content: bytes, target: Target, grid: Grid = GRID):
    storage = FakeStorage({KEY: content})
    frame = asyncio.run(build_frame(Level2Reader(storage), EXPOSURE_ID, target, grid))
    return frame, storage


def brightest(image: np.ndarray) -> tuple[int, int]:
    row, column = np.unravel_index(np.nanargmax(image), image.shape)
    return int(column), int(row)


def no_flags() -> np.ndarray:
    return np.zeros((HEIGHT, WIDTH), dtype=np.int32)


def test_star_appears_where_the_grid_puts_its_sky_position():
    content = build_level2_file(image=sky_with(STAR), flags=no_flags())

    frame, _ = frame_of(content, Target(ra=STAR[0], dec=STAR[1]))

    # 15 arcseconds east and 13 north of the center, at 2.8125 arcseconds per pixel.
    assert frame.target_xy == pytest.approx((31.5 - 15 / 2.8125, 31.5 - 13 / 2.8125), abs=0.01)
    x, y = brightest(frame.image)
    assert abs(x - frame.target_xy[0]) <= 1 and abs(y - frame.target_xy[1]) <= 1
    assert frame.image.shape == frame.mask.shape == (64, 64)
    assert frame.image.dtype == np.float32 and frame.mask.dtype == np.uint8


def test_north_is_up_and_east_is_left():
    north = (SKY_CENTER[0], SKY_CENTER[1] + 30 * ARCSEC)
    east = (SKY_CENTER[0] + 30 * ARCSEC / np.cos(np.radians(SKY_CENTER[1])), SKY_CENTER[1])

    seen_north, _ = frame_of(
        build_level2_file(image=sky_with(north), flags=no_flags()), Target(*SKY_CENTER)
    )
    seen_east, _ = frame_of(
        build_level2_file(image=sky_with(east), flags=no_flags()), Target(*SKY_CENTER)
    )

    x, y = brightest(seen_north.image)
    assert abs(x - 31.5) <= 1 and y == pytest.approx(31.5 - 30 / 2.8125, abs=1)
    x, y = brightest(seen_east.image)
    assert abs(y - 31.5) <= 1 and x == pytest.approx(31.5 - 30 / 2.8125, abs=1)


def test_date_exposure_time_and_wavelength_come_from_the_file():
    frame, _ = frame_of(build_level2_file(flags=no_flags()), Target(*SKY_CENTER))

    assert frame.id == EXPOSURE_ID
    assert frame.time_mjd == MJD
    assert frame.exposure_s == pytest.approx(113.5826)
    # The table of the small file gives 1.1 + 0.001 y + 0.00001 x, counted from 1.
    x, y = detector_position(*SKY_CENTER)
    assert frame.wavelength_um == pytest.approx(1.1 + 0.001 * (y + 1) + 0.00001 * (x + 1), abs=2e-4)
    assert frame.bandwidth_um == pytest.approx(0.03)
    assert frame.background == pytest.approx(0.3, abs=0.02)
    assert 0 < frame.noise < 0.1


def test_flags_reach_the_frame_and_unusable_pixels_lose_their_value():
    flags = no_flags()
    x, y = (round(value) for value in detector_position(*SKY_CENTER))
    flags[:, :] = FLAG_PLANES["SOURCE"]
    flags[y - 6 : y - 3, x - 6 : x - 3] |= FLAG_PLANES["OVERFLOW"]
    flags[y + 5, x + 5] |= FLAG_PLANES["NONFUNC"]

    frame, _ = frame_of(build_level2_file(flags=flags), Target(*SKY_CENTER))

    assert set(np.unique(frame.mask).tolist()) == {0, 2}
    assert 0.01 < np.count_nonzero(frame.mask == 2) / frame.mask.size < 0.1
    holes = np.isnan(frame.image)
    # One detector pixel is about five pixels of this grid, and it spoils its neighbors.
    assert 5 <= np.count_nonzero(holes) <= 40
    assert not (frame.mask[holes] != 0).any()
    assert frame.valid_fraction == pytest.approx(1 - np.count_nonzero(holes) / holes.size)


def test_target_is_measured_on_the_original_pixels():
    content = build_level2_file(image=sky_with(STAR), flags=no_flags())

    frame, _ = frame_of(content, Target(ra=STAR[0], dec=STAR[1]))

    total = AMPLITUDE * 2 * np.pi * SIGMA**2 * PIXEL_AREA_SR * 1e9
    inside = 1 - np.exp(-(APERTURE_RADIUS**2) / (2 * SIGMA**2))
    assert frame.photometry.quality == "ok"
    assert frame.photometry.flux_mjy == pytest.approx(inside * total, rel=0.03)


def test_variance_is_read_under_the_circle_of_the_measurement_only():
    content = build_level2_file(image=sky_with(STAR), flags=no_flags())
    storage = FakeStorage({KEY: content})
    reader = Level2Reader(storage)

    asyncio.run(build_frame(reader, EXPOSURE_ID, Target(ra=STAR[0], dec=STAR[1]), GRID))

    layout = asyncio.run(reader.layout(EXPOSURE_ID))
    variance_reads = [
        length for _, start, length in storage.reads if start >= layout.variance_start
    ]
    # Layout, then the image, the flags, the wavelength table and the variance.
    assert len(storage.reads) == 7
    # Eight rows at most around a circle of 2.5 pixels in radius.
    assert len(variance_reads) == 1 and variance_reads[0] <= 8 * WIDTH * 4


def test_moving_target_is_measured_where_it_was_at_the_date_of_the_exposure():
    content = build_level2_file(image=sky_with(STAR), flags=no_flags())
    years = (MJD - 51544.5) / 365.25
    # A target that was 26 arcseconds south of the star in 2000 and moves north.
    moving = Target(ra=STAR[0], dec=STAR[1] - 26 * ARCSEC, pm_dec=26_000 / years)

    frame, _ = frame_of(content, moving)

    assert frame.photometry.quality == "ok"
    assert frame.target_xy[1] == pytest.approx(31.5 - 13 / 2.8125, abs=0.01)


def test_saturated_target_has_no_flux_and_keeps_its_flag():
    flags = no_flags()
    x, y = (round(value) for value in detector_position(*STAR))
    flags[y, x] = FLAG_PLANES["OVERFLOW"]
    image = sky_with(STAR)
    image[y, x] = np.nan

    frame, _ = frame_of(build_level2_file(image=image, flags=flags), Target(*STAR))

    assert frame.photometry.quality == "saturated"
    assert frame.photometry.flux_mjy is None
    core = np.isnan(frame.image) & (frame.mask == 2)
    assert core.any()


def test_target_at_the_edge_of_the_detector_is_outside():
    # The sky position seen by the pixel of column 1, halfway up the detector.
    ra, dec = reference_wcs(sky_cards()).all_pix2world(1.0, HEIGHT / 2, 0)

    frame, _ = frame_of(build_level2_file(flags=no_flags()), Target(float(ra), float(dec)))

    assert frame.photometry.quality == "outside"
    assert frame.photometry.flux_mjy is None


def test_view_far_from_the_detector_is_an_empty_frame_and_reads_no_pixel():
    far = Grid(ra=SKY_CENTER[0] + 2.0, dec=SKY_CENTER[1], fov_deg=0.05, size=64)

    frame, storage = frame_of(build_level2_file(flags=no_flags()), Target(far.ra, far.dec), far)

    assert np.isnan(frame.image).all() and not frame.mask.any()
    assert frame.valid_fraction == 0.0
    assert (frame.background, frame.noise) == (None, None)
    assert frame.photometry.quality == "outside"
    assert np.isfinite(frame.wavelength_um)
    # Three reads for the layout, one for the wavelength table, none for pixels.
    assert len(storage.reads) == 4


def test_view_across_the_edge_of_the_detector_is_partly_empty():
    shifted = Grid(ra=SKY_CENTER[0], dec=SKY_CENTER[1] + 0.05, fov_deg=0.05, size=64)

    frame, _ = frame_of(build_level2_file(flags=no_flags()), Target(*SKY_CENTER), shifted)

    assert 0.05 < frame.valid_fraction < 0.95
    assert frame.target_xy[1] > 63
