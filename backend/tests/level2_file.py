"""A small file built like a SPHEREx level 2 file, and a storage that serves it.

Astropy writes the file, then reads it back as the reference: the reader under test
must find the same offsets and the same pixels through byte ranges alone.
"""

import io

import numpy as np
from astropy.io import fits

from spherex_explorer.archive import key_from_id
from spherex_explorer.errors import NotFound

EXPOSURE_ID = "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229"
KEY = key_from_id(EXPOSURE_ID)
WIDTH = 96
HEIGHT = 72


def build_level2_file(
    *,
    width: int = WIDTH,
    height: int = HEIGHT,
    extra_cards: int = 40,
    flags_compression: str | None = "RICE_1",
    with_wavelength_table: bool = True,
    seed: int = 7,
) -> bytes:
    rng = np.random.default_rng(seed)
    image = rng.normal(0.3, 0.05, size=(height, width)).astype(np.float32)
    image[5, 7] = np.nan
    variance = rng.uniform(1e-4, 1e-3, size=(height, width)).astype(np.float32)
    zodi = np.full((height, width), 0.25, dtype=np.float32)
    flags = np.zeros((height, width), dtype=np.int32)
    marked = rng.random((height, width)) < 0.08
    flags[marked] = rng.integers(1, 2**22, size=int(marked.sum()))
    flags[10, :] = 1 << 21

    header = fits.Header()
    header["BUNIT"] = ("MJy / sr", "Unit of pixel value")
    header["DETECTOR"] = (2, "1-3: SWIR, 4-6: MWIR")
    header["MJD-AVG"] = (60908.982594812, "[d] MJD at midpoint of observation")
    header["XPOSURE"] = (113.5826, "[s] Exposure (integration) time")
    header["HIERARCH L2 N_PIX_FLAGGED"] = (1234, "a long keyword, as the real files have")
    # A comment that ends a card with END, followed by a blank card: the three letters
    # and 77 spaces appear in the bytes, but not as a card of their own.
    header["COMMENT"] = " " * 69 + "END"
    header.append(("", ""), end=True)
    for index in range(extra_cards):
        header[f"FILL{index:04d}"] = (index * 1.5, "padding, to give the header a real size")

    if flags_compression is None:
        flags_unit: fits.hdu.base.ExtensionHDU = fits.ImageHDU(flags, name="FLAGS")
    else:
        flags_unit = fits.CompImageHDU(
            flags, name="FLAGS", compression_type=flags_compression, tile_shape=(1, width)
        )

    units = [
        fits.PrimaryHDU(),
        fits.ImageHDU(image, header=header, name="IMAGE"),
        flags_unit,
        fits.ImageHDU(variance, name="VARIANCE"),
        fits.ImageHDU(zodi, name="ZODI"),
        fits.BinTableHDU.from_columns(
            [fits.Column(name="PSF", format="16E", array=rng.random((3, 16)).astype(np.float32))],
            name="EPSF",
        ),
    ]
    if with_wavelength_table:
        # Five control points along x and four along y, so that a swap of the axes shows.
        x = np.linspace(1, width, 5).round().astype(np.int32)
        y = np.linspace(1, height, 4).round().astype(np.int32)
        values = np.empty((4, 5, 2), dtype=np.float32)
        values[..., 0] = 1.1 + 0.001 * y[:, None] + 0.00001 * x[None, :]
        values[..., 1] = 0.03
        units.append(
            fits.BinTableHDU.from_columns(
                [
                    fits.Column(name="X", format="5J", dim="(5)", array=x[None, :]),
                    fits.Column(name="Y", format="4J", dim="(4)", array=y[None, :]),
                    fits.Column(name="VALUES", format="40E", dim="(2,5,4)", array=values[None]),
                ],
                name="WCS-WAVE",
            )
        )

    buffer = io.BytesIO()
    fits.HDUList(units).writeto(buffer)
    return buffer.getvalue()


def reference(content: bytes) -> fits.HDUList:
    """The same file as Astropy reads it."""
    return fits.open(io.BytesIO(content))


class FakeStorage:
    """Storage that serves files held in memory and remembers every read."""

    def __init__(self, files: dict[str, bytes]):
        self.files = files
        self.reads: list[tuple[str, int, int]] = []

    def _file(self, key: str) -> bytes:
        if key not in self.files:
            raise NotFound(f"no file {key!r} in the archive")
        return self.files[key]

    async def read(self, key: str, start: int, length: int) -> bytes:
        self.reads.append((key, start, length))
        return self._file(key)[start : start + length]

    async def read_tail(self, key: str, length: int) -> bytes:
        self.reads.append((key, -length, length))
        return self._file(key)[-length:]
