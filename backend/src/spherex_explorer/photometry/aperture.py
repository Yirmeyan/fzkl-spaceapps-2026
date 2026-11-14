"""Aperture photometry: the light inside a small circle, minus the sky around it.

The method is the one of docs/api-contract.md: a circle of 2.5 SPHEREx pixels in radius,
a sky ring from 5 to 8 pixels, a correction for the light of the target that falls
outside the circle, and an uncertainty that adds, to the noise the file gives, the
scatter seen between exposures of steady stars.
"""

from dataclasses import dataclass

import numpy as np

APERTURE_RADIUS = 2.5
SKY_INNER_RADIUS = 5.0
SKY_OUTER_RADIUS = 8.0
# Each pixel is cut in this many parts along each side to weigh the edge of the circle.
_PARTS = 5
# Fewer sky pixels than this do not make a median worth trusting.
_FEWEST_SKY_PIXELS = 20
_MAD_TO_SIGMA = 1.4826
_MJY_PER_MEGAJANSKY = 1e9
# Share of the light of a point source that falls inside the circle, by detector: the
# median, over the 441 zones of a detector, of the PSF models the level-2 files carry
# (unit EPSF). The zones of one detector stay within 0.01 of it. Dividing by this share
# puts the flux on the scale of a fit of that PSF, the reference measurement of the
# mission. Checked on 2MASS and AllWISE stars: see docs/api-contract.md.
_SHARE_INSIDE_CIRCLE = {1: 0.984, 2: 0.982, 3: 0.976, 4: 0.983, 5: 0.981, 6: 0.985}
# Scatter between exposures of a steady star, as a share of its flux, that the variance
# of the file does not explain: where the star falls on a pixel, the flat field. It is
# larger when a pixel of the circle nears saturation.
_STEADY_SCATTER = 0.02
_NEAR_SATURATION_SCATTER = 0.05


def share_inside_circle(detector: int) -> float:
    """Share of the light of a point source that the circle catches, for one detector."""
    try:
        return _SHARE_INSIDE_CIRCLE[detector]
    except KeyError:
        raise ValueError(f"SPHEREx has no detector {detector!r}") from None


@dataclass(frozen=True, slots=True)
class Measurement:
    """Flux of a target in one exposure, in millijansky, and how far to trust it.

    Quality is ok or flagged when a value is present, and masked, saturated or outside
    when there is none.
    """

    flux_mjy: float | None
    error_mjy: float | None
    quality: str


def _without_value(quality: str) -> Measurement:
    return Measurement(flux_mjy=None, error_mjy=None, quality=quality)


def _circle_weights(shape: tuple[int, int], x: float, y: float, radius: float) -> np.ndarray:
    """Share of each pixel that lies inside a circle, from 0 to 1."""
    height, width = shape
    offsets = (np.arange(_PARTS) + 0.5) / _PARTS - 0.5
    fine_x = (np.arange(width)[:, None] + offsets[None, :]).ravel()
    fine_y = (np.arange(height)[:, None] + offsets[None, :]).ravel()
    inside = (fine_x[None, :] - x) ** 2 + (fine_y[:, None] - y) ** 2 <= radius**2
    return inside.reshape(height, _PARTS, width, _PARTS).mean(axis=(1, 3))


def measure(
    image: np.ndarray,
    variance: np.ndarray,
    mask: np.ndarray,
    no_value: np.ndarray,
    saturated: np.ndarray,
    x: float,
    y: float,
    pixel_area_sr: float,
    share_inside: float = 1.0,
) -> Measurement:
    """Measure a target at position (x, y) of a window of original pixels.

    `mask` holds the flags of a frame, `no_value` marks the pixels the file declares
    unusable and `saturated` those it flags as overflowing. Such a pixel keeps a value
    while it only nears saturation, and loses it once saturated. `share_inside` is the
    share of the light of a point source the circle catches: the flux is divided by it.
    The window must reach the edge of the detector or hold the whole circle: a circle
    that leaves the window has left the detector.
    """
    height, width = image.shape
    on_detector = (
        np.isfinite(x)
        and np.isfinite(y)
        and APERTURE_RADIUS <= x <= width - 1 - APERTURE_RADIUS
        and APERTURE_RADIUS <= y <= height - 1 - APERTURE_RADIUS
    )
    if not on_detector:
        return _without_value("outside")

    weights = _circle_weights(image.shape, x, y, APERTURE_RADIUS)
    circle = weights > 0
    usable = np.isfinite(image) & ~no_value
    # A saturated heart has no value left. Around it, or on a fainter star, a pixel
    # that nears saturation keeps a value the mission itself measures with.
    if (saturated & ~usable)[circle].any():
        return _without_value("saturated")
    near_saturation = bool(saturated[circle].any())
    # The variance only matters inside the circle: the caller may give it there alone.
    if not (usable[circle].all() and np.isfinite(variance[circle]).all()):
        return _without_value("masked")

    distance = np.hypot(np.arange(width)[None, :] - x, np.arange(height)[:, None] - y)
    ring = (distance >= SKY_INNER_RADIUS) & (distance <= SKY_OUTER_RADIUS) & usable
    sky_pixels = image[ring & (mask == 0)]
    if sky_pixels.size < _FEWEST_SKY_PIXELS:
        # A crowded or flagged surrounding: better a sky from flagged pixels than none.
        sky_pixels = image[ring]
    if sky_pixels.size < _FEWEST_SKY_PIXELS:
        return _without_value("masked")
    sky = float(np.median(sky_pixels))
    sky_scatter = _MAD_TO_SIGMA * float(np.median(np.abs(sky_pixels - sky)))

    to_mjy = pixel_area_sr * _MJY_PER_MEGAJANSKY / share_inside
    total = float((weights * (image - sky))[circle].sum())
    spread = float((weights**2 * variance)[circle].sum())
    spread += float(weights.sum()) ** 2 * sky_scatter**2 / sky_pixels.size
    flux = total * to_mjy
    scatter = _NEAR_SATURATION_SCATTER if near_saturation else _STEADY_SCATTER
    error = float(np.hypot(np.sqrt(spread) * to_mjy, scatter * flux))
    quality = "flagged" if near_saturation or (mask[circle] != 0).any() else "ok"
    return Measurement(flux_mjy=flux, error_mjy=error, quality=quality)
