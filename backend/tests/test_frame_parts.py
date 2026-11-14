import numpy as np
import pytest

from level2_file import FLAG_PLANES
from spherex_explorer.archive import WavelengthTable
from spherex_explorer.frames import (
    background_and_noise,
    flag_plan,
    has_no_value,
    is_saturated,
    resample,
    translate,
    valid_fraction,
    wavelength_at,
)

PLAN = flag_plan(FLAG_PLANES)


# Flags


def test_named_flags_take_the_bits_of_the_contract():
    flags = np.array(
        [FLAG_PLANES[name] for name in ("TRANSIENT", "OVERFLOW", "SUR_ERROR", "PERSIST")]
        + [FLAG_PLANES[name] for name in ("OUTLIER", "BLOOM", "HALO")],
        dtype=np.int32,
    )

    assert translate(flags, PLAN).tolist() == [1, 2, 4, 8, 16, 32, 64]


def test_informative_flags_and_unusable_pixels_leave_no_bit():
    flags = np.array(
        [FLAG_PLANES["SOURCE"], FLAG_PLANES["FULLSAMPLE"], FLAG_PLANES["NONFUNC"], 0], np.int32
    )

    assert translate(flags, PLAN).tolist() == [0, 0, 0, 0]
    assert has_no_value(flags, PLAN).tolist() == [False, False, True, False]


def test_any_other_flag_even_one_the_file_does_not_name_is_the_last_bit():
    unnamed = 1 << 30
    flags = np.array([FLAG_PLANES["HOT"], unnamed, FLAG_PLANES["HOT"] | FLAG_PLANES["BLOOM"]])

    assert translate(flags.astype(np.int32), PLAN).tolist() == [128, 128, 128 | 32]


def test_highest_bit_of_a_signed_mask_is_read_as_a_flag():
    flags = np.array([-(2**31)], dtype=np.int32)

    assert translate(flags, PLAN).tolist() == [128]


def test_saturation_is_read_from_the_overflow_flag():
    flags = np.array([FLAG_PLANES["OVERFLOW"] | FLAG_PLANES["SOURCE"], FLAG_PLANES["BLOOM"]])

    assert is_saturated(flags.astype(np.int32), PLAN).tolist() == [True, False]


def test_file_without_flag_names_counts_every_flag_as_other():
    plan = flag_plan({})

    assert translate(np.array([0, 5], dtype=np.int32), plan).tolist() == [0, 128]
    assert not has_no_value(np.array([64], dtype=np.int32), plan).any()


# Resampling


def ramp(height: int = 6, width: int = 8) -> np.ndarray:
    rows, columns = np.indices((height, width))
    return (10 * rows + columns).astype(np.float32)


def test_value_at_a_pixel_center_is_the_pixel_and_between_two_is_their_mean():
    values = ramp()
    mask = np.zeros(values.shape, dtype=np.uint8)

    image, _ = resample(values, mask, np.array([2.0, 2.5, 2.0]), np.array([3.0, 3.0, 3.5]))

    assert image.tolist() == [32.0, 32.5, 37.0]
    assert image.dtype == np.float32


def test_value_carries_the_flags_of_its_four_neighbors():
    values = ramp()
    mask = np.zeros(values.shape, dtype=np.uint8)
    mask[3, 2], mask[4, 3] = 1, 32

    _, flags = resample(values, mask, np.array([2.5, 4.5]), np.array([3.5, 3.5]))

    assert flags.tolist() == [33, 0]


def test_neighbor_without_value_or_outside_the_window_gives_no_value():
    values = ramp()
    values[3, 3] = np.nan
    mask = np.full(values.shape, 2, dtype=np.uint8)
    x = np.array([2.5, -0.5, 7.2, 3.0, np.nan])
    y = np.array([3.5, 2.0, 2.0, 5.5, 1.0])

    image, flags = resample(values, mask, x, y)

    assert np.isnan(image).all()
    # The flags of a hole are kept: they say why it is one.
    assert flags.tolist() == [2, 0, 0, 0, 0]


def test_window_of_one_pixel_cannot_be_interpolated():
    image, flags = resample(
        np.ones((1, 1), np.float32), np.zeros((1, 1), np.uint8), np.zeros((4, 4)), np.zeros((4, 4))
    )

    assert np.isnan(image).all() and image.shape == (4, 4)
    assert not flags.any()


# Wavelength

TABLE = WavelengthTable(
    x=np.array([1.0, 101.0, 201.0]),
    y=np.array([1.0, 51.0]),
    values=np.stack(
        [
            np.array([[1.0, 1.1, 1.2], [2.0, 2.1, 2.2]]),
            np.array([[0.01, 0.01, 0.01], [0.03, 0.03, 0.03]]),
        ],
        axis=-1,
    ),
)


def test_wavelength_at_a_control_point_is_the_value_of_the_table():
    # Control points are counted from 1, pixels from 0.
    assert wavelength_at(TABLE, 100.0, 0.0) == pytest.approx((1.1, 0.01))
    assert wavelength_at(TABLE, 200.0, 50.0) == pytest.approx((2.2, 0.03))


def test_wavelength_between_control_points_is_interpolated_along_both_axes():
    assert wavelength_at(TABLE, 50.0, 25.0) == pytest.approx((1.55, 0.02))


def test_position_outside_the_detector_takes_the_value_of_the_nearest_edge():
    assert wavelength_at(TABLE, -40.0, -3.0) == pytest.approx((1.0, 0.01))
    assert wavelength_at(TABLE, 900.0, 900.0) == pytest.approx((2.2, 0.03))


# Summary


def test_background_and_noise_ignore_flagged_pixels_and_holes():
    image = np.array([[1.0, 2.0, 3.0, 4.0, 5.0], [100.0, np.nan, 3.0, 3.0, 3.0]], np.float32)
    mask = np.zeros(image.shape, dtype=np.uint8)
    mask[1, 0] = 2

    background, noise = background_and_noise(image, mask)

    assert background == pytest.approx(3.0)
    assert noise == pytest.approx(1.4826 * 0.5)
    assert valid_fraction(image) == pytest.approx(0.9)


def test_frame_without_a_clean_pixel_has_no_background():
    image = np.full((4, 4), np.nan, dtype=np.float32)

    assert background_and_noise(image, np.zeros((4, 4), np.uint8)) == (None, None)
    assert valid_fraction(image) == 0.0
