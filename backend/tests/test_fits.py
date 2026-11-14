import gzip
import io
from pathlib import Path

import pytest
from astropy.io import fits

from level2_file import build_level2_file
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


# Reading the values of a header, against Astropy


def values_by_astropy(raw: bytes) -> dict:
    """What Astropy reads in the cards this reader keeps: those that carry a value."""
    header = fits.Header.fromstring(raw.decode("ascii"))
    kept = {}
    for card in header.cards:
        if card.keyword and card.keyword not in ("COMMENT", "HISTORY") and card.keyword not in kept:
            kept[card.keyword] = card.value
    return kept


def test_real_header_of_a_spherex_image_is_read_as_astropy_reads_it():
    recorded = Path(__file__).parent / "data" / "image_header_barnard_d2.txt.gz"
    raw = gzip.decompress(recorded.read_bytes())

    ours = parse_header(raw, "IMAGE")
    theirs = values_by_astropy(raw)

    assert len(ours) > 200
    assert set(ours) == set(theirs)
    for keyword, value in theirs.items():
        assert type(ours[keyword]) is type(value), keyword
        assert ours[keyword] == value, keyword


def test_every_header_of_a_level_2_file_is_read_as_astropy_reads_it():
    with fits.open(io.BytesIO(build_level2_file())) as units:
        for unit in units:
            raw = unit.header.tostring().encode("ascii")
            assert parse_header(raw, unit.name) == values_by_astropy(raw), unit.name


@pytest.mark.parametrize(
    ("card", "value"),
    [
        ("LOGICAL =                    T / a comment", True),
        ("LOGICAL =                    F", False),
        ("WHOLE   =                 2040 / [pix] width", 2040),
        ("FREE    = 500 / [adu2] a value that starts right after the sign", 500),
        ("NEGATIVE=   -3.36422975169E-05 / with an exponent", -3.36422975169e-05),
        ("FORTRAN =               1.5D+3", 1500.0),
        ("TEXT    = 'IMAGE   '           / padded", "IMAGE"),
        ("QUOTE   = 'Barnard''s Star'", "Barnard's Star"),
        ("SLASH   = 'MJy / sr'           / a slash inside a text is not a comment", "MJy / sr"),
        ("LEADING = '  kept'", "  kept"),
        ("EMPTY   = '        '", ""),
        ("NOTHING =                      / no value at all", None),
    ],
)
def test_values_are_read_as_the_standard_writes_them(card, value):
    raw = card.ljust(80).encode("ascii")

    read = parse_header(raw, "IMAGE")[card[:8].strip()]

    assert read == value and type(read) is type(value)


def test_cards_without_a_value_are_left_out():
    cards = [
        "COMMENT   NAXIS   =                    2 written inside a comment",
        "HISTORY Calibration source file: epsf_2_20260507.fits",
        "",
        "NAXIS   =                    2",
        "END",
        "AFTER   =                    1",
    ]
    raw = "".join(card.ljust(80) for card in cards).encode("ascii")

    assert parse_header(raw, "IMAGE") == {"NAXIS": 2}


def test_long_keywords_are_read_without_their_prefix():
    cards = [
        "HIERARCH SPS_TARGET = 'SPS_086985_S12' / Extended target ID",
        "HIERARCH L2 N_PERSIST = 24427 / number of pixels flagged persist",
        "HIERARCH OMEGA_MEDIAN = 37.69340975495044 /  [arcsec**2] solid angle",
    ]
    raw = "".join(card.ljust(80) for card in cards).encode("ascii")

    assert parse_header(raw, "IMAGE") == {
        "SPS_TARGET": "SPS_086985_S12",
        "L2 N_PERSIST": 24427,
        "OMEGA_MEDIAN": 37.69340975495044,
    }


def test_first_value_of_a_repeated_keyword_is_kept():
    raw = "NAXIS   =                    2".ljust(80) + "NAXIS   =                    3".ljust(80)

    assert parse_header(raw.encode("ascii"), "IMAGE") == {"NAXIS": 2}


@pytest.mark.parametrize(
    "card", ["TEXT    = 'never closed", "NUMBER  = 12 apples", "NUMBER  = 1.2.3"]
)
def test_value_that_cannot_be_read_is_an_error_that_names_its_keyword(card):
    with pytest.raises(UpstreamError, match=card[:8].strip() + " of IMAGE"):
        parse_header(card.ljust(80).encode("ascii"), "IMAGE")
