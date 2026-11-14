import asyncio

import numpy as np
import pytest

from level2_file import EXPOSURE_ID, HEIGHT, KEY, WIDTH, FakeStorage, build_level2_file, reference
from spherex_explorer.archive import (
    InvalidExposure,
    Level2Reader,
    Window,
    key_from_id,
    parse_wavelength_table,
)
from spherex_explorer.archive.fits import BLOCK
from spherex_explorer.errors import NotFound, UpstreamError

LAYOUT_READS = 3
WINDOW_READS = 3


@pytest.fixture(scope="module")
def content() -> bytes:
    return build_level2_file()


def reader_of(content: bytes) -> tuple[Level2Reader, FakeStorage]:
    storage = FakeStorage({KEY: content})
    return Level2Reader(storage), storage


def read(content: bytes, window: Window):
    reader, _ = reader_of(content)
    return asyncio.run(reader.read_window(EXPOSURE_ID, window))


def test_layout_finds_each_part_where_astropy_finds_it(content):
    reader, storage = reader_of(content)
    expected = reference(content)

    layout = asyncio.run(reader.layout(EXPOSURE_ID))

    assert (layout.width, layout.height) == (WIDTH, HEIGHT)
    assert layout.image_start == expected["IMAGE"].fileinfo()["datLoc"]
    assert layout.variance_start == expected["VARIANCE"].fileinfo()["datLoc"]
    assert layout.header["DETECTOR"] == 2
    assert layout.header["MJD-AVG"] == pytest.approx(60908.982594812)
    assert layout.header["L2 N_PIX_FLAGGED"] == 1234
    assert len(storage.reads) == LAYOUT_READS


@pytest.mark.parametrize(
    "window",
    [
        Window(10, 20, 40, 50),
        Window(0, 0, WIDTH, HEIGHT),
        Window(0, 0, 1, 1),
        Window(WIDTH - 1, HEIGHT - 1, WIDTH, HEIGHT),
        Window(0, 30, WIDTH, 31),
        Window(17, 0, 18, HEIGHT),
        Window(3, 9, 60, 12),
    ],
)
def test_window_is_identical_to_what_astropy_reads(content, window):
    expected = reference(content)
    rows, columns = slice(window.y0, window.y1), slice(window.x0, window.x1)

    raw = read(content, window)

    assert raw.window == window
    assert raw.image.dtype == np.float32 and raw.image.dtype.isnative
    assert raw.flags.dtype == np.int32
    assert raw.image.shape == raw.variance.shape == raw.flags.shape
    assert raw.image.shape == (window.height, window.width)
    assert np.array_equal(raw.image, expected["IMAGE"].data[rows, columns], equal_nan=True)
    assert np.array_equal(raw.variance, expected["VARIANCE"].data[rows, columns])
    assert np.array_equal(raw.flags, expected["FLAGS"].data[rows, columns])


def test_window_without_its_variance_costs_one_read_less(content):
    reader, storage = reader_of(content)

    raw = asyncio.run(reader.read_window(EXPOSURE_ID, Window(10, 20, 40, 50), with_variance=False))

    assert raw.variance is None
    assert len(storage.reads) == LAYOUT_READS + WINDOW_READS - 1


def test_variance_alone_is_identical_to_what_astropy_reads(content):
    reader, storage = reader_of(content)
    expected = reference(content)["VARIANCE"].data

    variance = asyncio.run(reader.read_variance(EXPOSURE_ID, Window(30, 40, 37, 47)))

    assert np.array_equal(variance, expected[40:47, 30:37])
    assert len(storage.reads) == LAYOUT_READS + 1
    with pytest.raises(ValueError, match="outside"):
        asyncio.run(reader.read_variance(EXPOSURE_ID, Window(0, 0, WIDTH + 1, 5)))


def test_pixel_without_value_and_flagged_row_survive_the_reading(content):
    raw = read(content, Window(0, 0, WIDTH, HEIGHT))

    assert np.isnan(raw.image[5, 7])
    assert np.count_nonzero(np.isnan(raw.image)) == 1
    assert np.all(raw.flags[10] == 1 << 21)


def test_layout_is_found_once_and_a_window_costs_three_reads(content):
    reader, storage = reader_of(content)

    async def run():
        await reader.read_window(EXPOSURE_ID, Window(10, 20, 40, 50))
        first = len(storage.reads)
        await reader.read_window(EXPOSURE_ID, Window(50, 5, 70, 25))
        return first

    first = asyncio.run(run())

    assert first == LAYOUT_READS + WINDOW_READS
    assert len(storage.reads) == LAYOUT_READS + 2 * WINDOW_READS


def test_window_reads_only_the_bytes_between_its_first_and_last_pixel(content):
    reader, storage = reader_of(content)
    window = Window(10, 20, 40, 50)

    asyncio.run(reader.read_window(EXPOSURE_ID, window))

    image_read = storage.reads[LAYOUT_READS]
    pixels = (window.height - 1) * WIDTH + window.width
    assert image_read[2] == pixels * 4


def test_oldest_layout_is_forgotten_when_too_many_are_remembered(content):
    other = "dr1.2025W34_2B_0090_4D3.l2b-v27-2026-229"
    storage = FakeStorage({KEY: content, key_from_id(other): content})
    reader = Level2Reader(storage, remembered_layouts=1)

    async def run():
        await reader.layout(EXPOSURE_ID)
        await reader.layout(other)
        await reader.layout(other)
        await reader.layout(EXPOSURE_ID)

    asyncio.run(run())

    assert len(storage.reads) == 3 * LAYOUT_READS


def test_header_longer_than_the_first_read_is_still_found():
    content = build_level2_file(extra_cards=700)
    expected = reference(content)
    reader, storage = reader_of(content)
    window = Window(10, 20, 40, 50)

    raw = asyncio.run(reader.read_window(EXPOSURE_ID, window))

    assert expected["IMAGE"].fileinfo()["datLoc"] > 14 * BLOCK
    assert np.array_equal(raw.image, expected["IMAGE"].data[20:50, 10:40], equal_nan=True)
    assert np.array_equal(raw.flags, expected["FLAGS"].data[20:50, 10:40])
    assert len(storage.reads) > LAYOUT_READS + WINDOW_READS


@pytest.mark.parametrize(
    "window",
    [
        Window(-1, 0, 10, 10),
        Window(0, 0, WIDTH + 1, 10),
        Window(0, 0, 10, HEIGHT + 1),
        Window(10, 10, 10, 20),
        Window(20, 10, 10, 20),
        Window(0, 30, 10, 30),
    ],
)
def test_window_empty_or_outside_the_image_is_refused(content, window):
    with pytest.raises(ValueError, match="outside"):
        read(content, window)


def test_identifier_of_another_shape_is_refused_before_any_read(content):
    reader, storage = reader_of(content)

    with pytest.raises(InvalidExposure):
        asyncio.run(reader.read_window("../../etc/passwd", Window(0, 0, 1, 1)))
    with pytest.raises(InvalidExposure):
        asyncio.run(reader.wavelength_table("dr1.somewhere.else"))

    assert storage.reads == []


def test_file_that_does_not_exist_is_not_found():
    reader = Level2Reader(FakeStorage({}))

    with pytest.raises(NotFound):
        asyncio.run(reader.read_window(EXPOSURE_ID, Window(0, 0, 1, 1)))


def test_file_cut_short_is_an_error(content):
    expected = reference(content)
    cut = expected["VARIANCE"].fileinfo()["datLoc"] + 40 * WIDTH * 4

    with pytest.raises(UpstreamError, match="VARIANCE is shorter"):
        read(content[:cut], Window(0, 30, WIDTH, 60))


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"flags_compression": None}, "FLAGS is not where"),
        ({"flags_compression": "GZIP_1"}, "Rice"),
    ],
)
def test_file_with_another_layout_is_an_error(changes, message):
    content = build_level2_file(**changes)

    with pytest.raises(UpstreamError, match=message):
        read(content, Window(0, 0, 10, 10))


def test_file_that_is_not_fits_is_an_error():
    reader = Level2Reader(FakeStorage({KEY: b"<html>not a FITS file</html>" * 4000}))

    with pytest.raises(UpstreamError):
        asyncio.run(reader.layout(EXPOSURE_ID))


def test_wavelength_table_is_identical_to_what_astropy_reads(content):
    reader, storage = reader_of(content)
    expected = reference(content)["WCS-WAVE"].data

    table = asyncio.run(reader.wavelength_table(EXPOSURE_ID))

    assert np.array_equal(table.x, expected["X"][0])
    assert np.array_equal(table.y, expected["Y"][0])
    assert table.values.shape == (table.y.size, table.x.size, 2)
    assert np.array_equal(table.values, expected["VALUES"][0])
    assert len(storage.reads) == 1


def test_wavelength_table_is_read_once_for_a_detector_of_a_release(content):
    same_detector = "dr1.2025W34_2B_0091_1D2.l2b-v27-2026-229"
    other_detector = "dr1.2025W34_2B_0090_4D3.l2b-v27-2026-229"
    other_version = "dr1.2025W35_1A_0012_2D2.l2b-v27-2026-236"
    identifiers = [EXPOSURE_ID, same_detector, other_detector, other_version]
    storage = FakeStorage({key_from_id(identifier): content for identifier in identifiers})
    reader = Level2Reader(storage)

    async def run():
        for identifier in [*identifiers, EXPOSURE_ID]:
            await reader.wavelength_table(identifier)

    asyncio.run(run())

    assert len(storage.reads) == 3


def test_file_that_does_not_end_with_the_wavelength_table_is_an_error():
    content = build_level2_file(with_wavelength_table=False)
    reader, _ = reader_of(content)

    with pytest.raises(UpstreamError, match="WCS-WAVE"):
        asyncio.run(reader.wavelength_table(EXPOSURE_ID))


def test_wavelength_table_with_another_shape_is_an_error(content):
    tail = bytearray(content[-2 * BLOCK :])
    position = tail.find(b"(2,5,4)")
    tail[position : position + 7] = b"(5,2,4)"

    with pytest.raises(UpstreamError, match="shape"):
        parse_wavelength_table(bytes(tail))
