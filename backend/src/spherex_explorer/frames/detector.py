"""Where the sky falls on a detector, from the coordinates written in the header of an image.

SPHEREx describes each image with a gnomonic projection (TAN) corrected by polynomials
(SIP) that absorb the distortion of the optics. Pixel positions here are counted from 0,
as NumPy does. FITS counts them from 1: the shift is applied inside.
"""

from dataclasses import dataclass

import numpy as np
from astropy.io import fits

from spherex_explorer.errors import UpstreamError

_WHAT = "the coordinates of IMAGE"
# The polynomial that goes from the sky back to the pixels is an approximation. A few
# corrections with the exact direction bring the error far below a thousandth of a pixel.
_REFINEMENTS = 3


def _number(header: fits.Header, keyword: str, default: float | None = None) -> float:
    value = header.get(keyword, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise UpstreamError(f"{keyword} of {_WHAT} is missing or is not a number")
    return float(value)


def _polynomial(header: fits.Header, prefix: str) -> tuple[tuple[int, int, float], ...]:
    """Terms (p, q, coefficient) of one SIP polynomial. Empty when the header has none."""
    if f"{prefix}_ORDER" not in header:
        return ()
    order = int(_number(header, f"{prefix}_ORDER"))
    terms = []
    for p in range(order + 1):
        for q in range(order + 1 - p):
            coefficient = _number(header, f"{prefix}_{p}_{q}", 0.0)
            if coefficient != 0.0:
                terms.append((p, q, coefficient))
    return tuple(terms)


def _evaluate(terms: tuple[tuple[int, int, float], ...], u: np.ndarray, v: np.ndarray):
    total = np.zeros_like(u)
    for p, q, coefficient in terms:
        total = total + coefficient * u**p * v**q
    return total


@dataclass(frozen=True, slots=True, eq=False)
class DetectorWcs:
    """Link between the pixels of one image and the sky."""

    crpix: tuple[float, float]
    crval: tuple[float, float]
    # Degrees on the tangent plane per pixel, and its inverse.
    matrix: np.ndarray
    inverse: np.ndarray
    a: tuple[tuple[int, int, float], ...]
    b: tuple[tuple[int, int, float], ...]
    ap: tuple[tuple[int, int, float], ...]
    bp: tuple[tuple[int, int, float], ...]

    @classmethod
    def from_header(cls, header: fits.Header) -> "DetectorWcs":
        kinds = (str(header.get("CTYPE1", "")).strip(), str(header.get("CTYPE2", "")).strip())
        if kinds not in (("RA---TAN-SIP", "DEC--TAN-SIP"), ("RA---TAN", "DEC--TAN")):
            raise UpstreamError(f"{_WHAT} use a projection this service does not know: {kinds}")
        if _number(header, "LONPOLE", 180.0) != 180.0:
            raise UpstreamError(f"{_WHAT} use a pole this service does not handle")
        if "CD1_1" in header:
            matrix = np.array(
                [
                    [_number(header, "CD1_1"), _number(header, "CD1_2", 0.0)],
                    [_number(header, "CD2_1", 0.0), _number(header, "CD2_2")],
                ]
            )
        else:
            steps = (_number(header, "CDELT1", 1.0), _number(header, "CDELT2", 1.0))
            matrix = np.array(
                [
                    [
                        steps[0] * _number(header, "PC1_1", 1.0),
                        steps[0] * _number(header, "PC1_2", 0.0),
                    ],
                    [
                        steps[1] * _number(header, "PC2_1", 0.0),
                        steps[1] * _number(header, "PC2_2", 1.0),
                    ],
                ]
            )
        if abs(np.linalg.det(matrix)) < 1e-20:
            raise UpstreamError(f"{_WHAT} have no pixel scale")
        return cls(
            crpix=(_number(header, "CRPIX1"), _number(header, "CRPIX2")),
            crval=(_number(header, "CRVAL1"), _number(header, "CRVAL2")),
            matrix=matrix,
            inverse=np.linalg.inv(matrix),
            a=_polynomial(header, "A"),
            b=_polynomial(header, "B"),
            ap=_polynomial(header, "AP"),
            bp=_polynomial(header, "BP"),
        )

    def _to_plane(self, u: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Offsets from the reference pixel to degrees on the tangent plane."""
        corrected_u = u + _evaluate(self.a, u, v)
        corrected_v = v + _evaluate(self.b, u, v)
        east = self.matrix[0, 0] * corrected_u + self.matrix[0, 1] * corrected_v
        north = self.matrix[1, 0] * corrected_u + self.matrix[1, 1] * corrected_v
        return east, north

    def pixel_to_sky(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Right ascension and declination, in degrees, of pixel positions."""
        u = np.asarray(x, dtype=np.float64) + 1.0 - self.crpix[0]
        v = np.asarray(y, dtype=np.float64) + 1.0 - self.crpix[1]
        east, north = self._to_plane(u, v)
        east, north = np.radians(east), np.radians(north)
        dec0 = np.radians(self.crval[1])
        denominator = np.cos(dec0) - north * np.sin(dec0)
        ra = self.crval[0] + np.degrees(np.arctan2(east, denominator))
        dec = np.degrees(
            np.arctan2(np.sin(dec0) + north * np.cos(dec0), np.hypot(east, denominator))
        )
        return ra % 360.0, dec

    def sky_to_pixel(self, ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Pixel positions of sky positions given in degrees. NaN on the far side of the sky."""
        dec0 = np.radians(self.crval[1])
        d = np.radians(np.asarray(dec, dtype=np.float64))
        da = np.radians(np.asarray(ra, dtype=np.float64) - self.crval[0])
        cosc = np.sin(dec0) * np.sin(d) + np.cos(dec0) * np.cos(d) * np.cos(da)
        cosc = np.where(cosc > 1e-6, cosc, np.nan)
        east = np.degrees(np.cos(d) * np.sin(da) / cosc)
        north = np.degrees(
            (np.cos(dec0) * np.sin(d) - np.sin(dec0) * np.cos(d) * np.cos(da)) / cosc
        )
        linear_u = self.inverse[0, 0] * east + self.inverse[0, 1] * north
        linear_v = self.inverse[1, 0] * east + self.inverse[1, 1] * north
        u = linear_u + _evaluate(self.ap, linear_u, linear_v)
        v = linear_v + _evaluate(self.bp, linear_u, linear_v)
        for _ in range(_REFINEMENTS):
            u = u + linear_u - (u + _evaluate(self.a, u, v))
            v = v + linear_v - (v + _evaluate(self.b, u, v))
        return u + self.crpix[0] - 1.0, v + self.crpix[1] - 1.0

    def pixel_area_sr(self, x: float, y: float) -> float:
        """Solid angle of the pixel at a position, in steradians."""
        ra, dec = self.pixel_to_sky(
            np.array([x - 0.5, x + 0.5, x, x]), np.array([y, y, y - 0.5, y + 0.5])
        )
        cos_dec = np.cos(np.radians(dec.mean()))
        along_x = np.radians([(ra[1] - ra[0] + 180.0) % 360.0 - 180.0, dec[1] - dec[0]])
        along_y = np.radians([(ra[3] - ra[2] + 180.0) % 360.0 - 180.0, dec[3] - dec[2]])
        return float(abs(along_x[0] * cos_dec * along_y[1] - along_y[0] * cos_dec * along_x[1]))
