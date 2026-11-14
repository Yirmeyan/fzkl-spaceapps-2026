import pytest
from astropy.io import fits

from spherex_explorer.archive.fits import (
    BLOCK,
    data_length,
    header_length,
    integer,
    padded,
    parse_header,
    text,
)
from spherex_explorer.errors import UpstreamError


def raw_header(header: fits.Header) -> bytes:
    return header.tostring().encode("ascii")


@pytest.mark.parametrize(
    ("size", "expected"), [(0, 0), (1, BLOCK), (BLOCK, BLOCK), (BLOCK + 1, 2 * BLOCK)]
)
def test_sizes_are_rounded_up_to_whole_blocks(size, expected):
    assert padded(size) == expected


def test_header_ends_at_the_block_that_holds_its_end_card():
    header = fits.Header([("SIMPLE", True), ("BITPIX", 8), ("NAXIS", 0)])
    raw = raw_header(header)

    assert len(raw) == BLOCK
    assert header_length(raw) == BLOCK
    # The padding after the END card does not have to be there.
    assert header_length(raw[: 4 * 80]) == BLOCK


def test_header_cut_before_its_end_asks_for_more():
    header = fits.Header([(f"KEY{index}", index) for index in range(40)])
    raw = raw_header(header)

    assert header_length(raw) == 2 * BLOCK
    assert header_length(raw[:BLOCK]) is None
    assert header_length(b"") is None


def test_the_word_end_inside_a_comment_is_not_the_end():
    comment = ("COMMENT " + " " * 69 + "END").encode("ascii")
    blank = b" " * 80
    last = ("NAXIS   =                    0" + " " * 50).encode("ascii")
    end = b"END" + b" " * 77
    raw = comment + blank + last + end

    assert (b"END" + b" " * 77) in raw[:160]
    assert header_length(raw) == BLOCK


def test_bytes_that_are_not_text_are_an_error():
    with pytest.raises(UpstreamError, match="IMAGE"):
        parse_header(b"\xff\xfe" * 40, "IMAGE")


def test_data_of_an_image_is_its_pixels_rounded_up():
    header = fits.Header([("BITPIX", -32), ("NAXIS", 2), ("NAXIS1", 2040), ("NAXIS2", 2040)])

    assert data_length(header, "IMAGE") == 2040 * 2040 * 4


def test_data_of_a_table_counts_its_heap():
    header = fits.Header(
        [("BITPIX", 8), ("NAXIS", 2), ("NAXIS1", 8), ("NAXIS2", 2040), ("PCOUNT", 7725629)]
    )

    assert data_length(header, "FLAGS") == padded(8 * 2040 + 7725629)


def test_unit_without_axes_has_no_data():
    assert data_length(fits.Header([("BITPIX", 8), ("NAXIS", 0)]), "PRIMARY") == 0


def test_missing_or_mistyped_keyword_is_an_error_that_names_it():
    header = fits.Header([("NAXIS", "two"), ("EXTNAME", 3), ("ZIMAGE", True)])

    with pytest.raises(UpstreamError, match="NAXIS of IMAGE"):
        integer(header, "NAXIS", "IMAGE")
    with pytest.raises(UpstreamError, match="BITPIX of IMAGE"):
        integer(header, "BITPIX", "IMAGE")
    with pytest.raises(UpstreamError, match="ZIMAGE of IMAGE"):
        integer(header, "ZIMAGE", "IMAGE")
    with pytest.raises(UpstreamError, match="EXTNAME of IMAGE"):
        text(header, "EXTNAME", "IMAGE")


def test_text_values_lose_their_padding():
    header = fits.Header([("EXTNAME", "FLAGS   ")])

    assert text(header, "EXTNAME", "FLAGS") == "FLAGS"
    assert integer(header, "GCOUNT", "FLAGS", default=1) == 1
