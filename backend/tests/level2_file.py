"""A small file built like a SPHEREx level 2 file, and a storage that serves it.

Astropy writes the file, then reads it back as the reference: the reader under test
must find the same offsets and the same pixels through byte ranges alone.
"""

import io
import warnings

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from spherex_explorer.archive import key_from_id
from spherex_explorer.errors import NotFound

EXPOSURE_ID = "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229"
KEY = key_from_id(EXPOSURE_ID)
WIDTH = 96
HEIGHT = 72
# Sky position of the middle of the small detector, and what one of its pixels covers.
SKY_CENTER = (150.0, 20.0)
PIXEL_ARCSEC = 6.15
PIXEL_AREA_SR = np.radians(PIXEL_ARCSEC / 3600) ** 2
MJD = 60908.982594812
# Kinds of flags, with the masks the real files give them.
FLAG_PLANES = {
    "TRANSIENT": 1 << 0,
    "OVERFLOW": 1 << 1,
    "SUR_ERROR": 1 << 2,
    "NONFUNC": 1 << 6,
    "MISSING_DATA": 1 << 9,
    "HOT": 1 << 10,
    "FULLSAMPLE": 1 << 12,
    "PERSIST": 1 << 17,
    "OUTLIER": 1 << 19,
    "SOURCE": 1 << 21,
    "BLOOM": 1 << 26,
    "HALO": 1 << 28,
}


def sky_cards(width: int = WIDTH, height: int = HEIGHT) -> list[tuple[str, object]]:
    """Coordinates of a small detector turned by 20 degrees, east to the left."""
    scale = PIXEL_ARCSEC / 3600
    turn = np.radians(20.0)
    return [
        ("CTYPE1", "RA---TAN"),
        ("CTYPE2", "DEC--TAN"),
        ("CUNIT1", "deg"),
        ("CUNIT2", "deg"),
        ("CRPIX1", (width + 1) / 2),
        ("CRPIX2", (height + 1) / 2),
        ("CRVAL1", SKY_CENTER[0]),
        ("CRVAL2", SKY_CENTER[1]),
        ("CDELT1", 1.0),
        ("CDELT2", 1.0),
        ("PC1_1", -scale * np.cos(turn)),
        ("PC1_2", scale * np.sin(turn)),
        ("PC2_1", scale * np.sin(turn)),
        ("PC2_2", scale * np.cos(turn)),
        ("LONPOLE", 180.0),
    ]


def reference_wcs(cards: list[tuple[str, object]]) -> WCS:
    """The same coordinates as Astropy reads them."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return WCS(fits.Header(cards))


def detector_position(ra: float, dec: float) -> tuple[float, float]:
    """Pixel of the small detector, counted from 0, that sees a sky position."""
    x, y = reference_wcs(sky_cards()).all_world2pix(ra, dec, 0)
    return float(x), float(y)


def star(shape: tuple[int, int], x: float, y: float, amplitude: float, sigma: float = 1.3):
    """Image of a round star centered on (x, y)."""
    rows, columns = np.indices(shape)
    return amplitude * np.exp(-((columns - x) ** 2 + (rows - y) ** 2) / (2 * sigma**2))


def build_level2_file(
    *,
    width: int = WIDTH,
    height: int = HEIGHT,
    extra_cards: int = 40,
    flags_compression: str | None = "RICE_1",
    with_wavelength_table: bool = True,
    image: np.ndarray | None = None,
    flags: np.ndarray | None = None,
    seed: int = 7,
) -> bytes:
    rng = np.random.default_rng(seed)
    if image is None:
        image = rng.normal(0.3, 0.05, size=(height, width)).astype(np.float32)
        image[5, 7] = np.nan
    image = image.astype(np.float32)
    variance = rng.uniform(1e-4, 1e-3, size=(height, width)).astype(np.float32)
    zodi = np.full((height, width), 0.25, dtype=np.float32)
    if flags is None:
        flags = np.zeros((height, width), dtype=np.int32)
        marked = rng.random((height, width)) < 0.08
        flags[marked] = rng.integers(1, 2**22, size=int(marked.sum()))
        flags[10, :] = 1 << 21
    flags = flags.astype(np.int32)

    header = fits.Header()
    header["BUNIT"] = ("MJy / sr", "Unit of pixel value")
    header["DETECTOR"] = (2, "1-3: SWIR, 4-6: MWIR")
    header["MJD-AVG"] = (MJD, "[d] MJD at midpoint of observation")
    for keyword, value in sky_cards(width, height):
        header[keyword] = value
    header["XPOSURE"] = (113.5826, "[s] Exposure (integration) time")
    header["HIERARCH L2 N_PIX_FLAGGED"] = (1234, "a long keyword, as the real files have")
    # A comment that ends a card with END, followed by a blank card: the three letters
    # and 77 spaces appear in the bytes, but not as a card of their own.
    header["COMMENT"] = " " * 69 + "END"
    header.append(("", ""), end=True)
    for index in range(extra_cards):
        header[f"FILL{index:04d}"] = (index * 1.5, "padding, to give the header a real size")

    flags_header = fits.Header()
    for name, mask in FLAG_PLANES.items():
        plane = mask.bit_length() - 1
        flags_header[f"MSKN{plane:04d}"] = (name, f"Name for mask plane {plane}")
        flags_header[f"MSKM{plane:04d}"] = (mask, f"Bitmask for plane n={plane}")
    if flags_compression is None:
        flags_unit: fits.hdu.base.ExtensionHDU = fits.ImageHDU(flags, name="FLAGS")
    else:
        flags_unit = fits.CompImageHDU(
            flags,
            header=flags_header,
            name="FLAGS",
            compression_type=flags_compression,
            tile_shape=(1, width),
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
