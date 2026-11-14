"""Decompression of image rows stored with the Rice algorithm.

SPHEREx compresses its flags one row at a time. A pure Python decoder would take
about a second per exposure, so the compiled one of Astropy does the work. It lives
in a private module of Astropy: tests/test_rice.py fails if a new version moves it.
"""

from collections.abc import Sequence

import numpy as np
from astropy.io.fits.hdu.compressed._codecs import Rice1

from spherex_explorer.errors import UpstreamError


def decode_rows(
    rows: Sequence[bytes], *, width: int, blocksize: int, bytes_per_pixel: int
) -> np.ndarray:
    """Rows of `width` integer pixels, one per compressed row, in the order given."""
    codec = Rice1(blocksize=blocksize, bytepix=bytes_per_pixel, tilesize=width)
    decoded = np.empty((len(rows), width), dtype=f"i{bytes_per_pixel}")
    for index, row in enumerate(rows):
        try:
            pixels = codec.decode(np.frombuffer(row, dtype=np.uint8))
        except Exception as exc:
            # The compiled decoder raises several types on damaged data.
            raise UpstreamError(f"a compressed row cannot be decoded: {exc}") from exc
        if pixels.size != width:
            raise UpstreamError(f"a compressed row holds {pixels.size} pixels instead of {width}")
        decoded[index] = pixels
    return decoded
