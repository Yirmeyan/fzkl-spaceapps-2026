import numpy as np
import pytest
from astropy.io.fits.hdu.compressed._codecs import Rice1

from spherex_explorer.archive.rice import decode_rows
from spherex_explorer.errors import UpstreamError

WIDTH = 200


def compressed(row: np.ndarray) -> bytes:
    return bytes(Rice1(blocksize=32, bytepix=4, tilesize=row.size).encode(row))


def test_rows_come_back_as_they_were_compressed():
    rng = np.random.default_rng(3)
    rows = np.zeros((4, WIDTH), dtype=np.int32)
    rows[1] = 1 << 21
    rows[2] = rng.integers(0, 2**22, size=WIDTH)
    rows[3, ::7] = 5

    decoded = decode_rows(
        [compressed(row) for row in rows], width=WIDTH, blocksize=32, bytes_per_pixel=4
    )

    assert decoded.dtype == np.int32
    assert np.array_equal(decoded, rows)


def test_no_row_gives_an_empty_array():
    decoded = decode_rows([], width=WIDTH, blocksize=32, bytes_per_pixel=4)

    assert decoded.shape == (0, WIDTH)


def test_damaged_row_is_an_error():
    rng = np.random.default_rng(4)
    row = compressed(rng.integers(0, 2**22, size=WIDTH).astype(np.int32))

    with pytest.raises(UpstreamError, match="compressed row"):
        decode_rows([row[: len(row) // 3]], width=WIDTH, blocksize=32, bytes_per_pixel=4)
