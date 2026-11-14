"""Sources of a stacked image: where they are, and how bright.

Everything here is counted in pixels of the default view, 2.8 arcseconds, where a
SPHEREx pixel is 2.2 pixels wide and a star about 4.
"""

import numpy as np

from spherex_explorer.detection.stack import MAD_TO_SIGMA, all_nan_allowed

# Width of the smoothing that makes a point source stand out best: close to that of a star.
_SMOOTHING_SIGMA = 1.6
# A source is a peak this many times above the scatter of the smoothed image.
DETECTION_THRESHOLD = 5.0
# Two peaks closer than this are one source, or a pair that cannot be measured apart.
_SEPARATION = 5.0
# No source is measured closer than this to the edge: its window would leave the image.
MARGIN = 7

# Window of the position measurement: weights that fall off as a Gaussian of this width,
# out to this radius.
_WINDOW_SIGMA = 2.0
_WINDOW_RADIUS = 6.0
# The sky under a source is the median of a ring between these radii.
_SKY_INNER = 9.0
_SKY_OUTER = 13.0
_FEWEST_SKY_PIXELS = 20
# A position is not trusted when a pixel is missing this close to it, or when less than
# this share of its window has a value.
_HEART_RADIUS = 2.0
_WINDOW_SHARE = 0.9
_ITERATIONS = 12
_CONVERGED = 1e-3

# Brightness of a source in one frame: the same circle and ring as the photometry of the
# service, 2.5 and 5 to 8 SPHEREx pixels, in pixels of the default view.
APERTURE_RADIUS = 5.5
_RING_INNER = 11.0
_RING_OUTER = 17.5
_PARTS = 5
# Neighboring pixels of a frame are drawn from the same SPHEREx pixels, 2.2 times wider:
# their noise does not average out as that of independent pixels would. The noise of a
# sum of pixels is this many times larger than their scatter suggests.
_NOISE_SPREAD = 3.3


def _gaussian(sigma: float) -> np.ndarray:
    reach = int(3 * sigma + 0.5)
    taps = np.exp(-0.5 * (np.arange(-reach, reach + 1) / sigma) ** 2)
    return taps / taps.sum()


def _blur(image: np.ndarray, taps: np.ndarray) -> np.ndarray:
    """Convolution with the same taps along both axes. The image is padded with zeros."""
    reach = taps.size // 2
    height, width = image.shape
    padded = np.pad(image, reach)
    rows = sum(tap * padded[i : i + height, :] for i, tap in enumerate(taps))
    return sum(tap * rows[:, i : i + width] for i, tap in enumerate(taps))


def smooth(image: np.ndarray) -> np.ndarray:
    """Image smoothed to the width of a star. Pixels without a value are left aside."""
    taps = _gaussian(_SMOOTHING_SIGMA)
    known = np.isfinite(image)
    total = _blur(np.where(known, image, 0.0), taps)
    weight = _blur(known.astype(np.float64), taps)
    return np.where(weight > 0.5, total / np.maximum(weight, 1e-9), np.nan)


def signal_to_noise(image: np.ndarray) -> np.ndarray:
    """How far each place of an image stands above the sky, in units of its scatter.

    The scatter is that of the smoothed image itself: it includes the faint sources of
    the field, which is what a detection has to beat.
    """
    smoothed = smooth(image)
    values = smoothed[np.isfinite(smoothed)]
    if values.size == 0:
        return np.full(image.shape, np.nan)
    sky = np.median(values)
    scatter = MAD_TO_SIGMA * np.median(np.abs(values - sky))
    if scatter <= 0:
        return np.full(image.shape, np.nan)
    return (smoothed - sky) / scatter


def peaks(
    snr: np.ndarray, threshold: float = DETECTION_THRESHOLD
) -> list[tuple[float, float, float]]:
    """Sources of a signal-to-noise image, as (x, y, signal to noise), brightest first."""
    height, width = snr.shape
    filled = np.where(np.isfinite(snr), snr, -np.inf)
    padded = np.pad(filled, 1, constant_values=-np.inf)
    neighbors = [
        padded[1 + dy : 1 + dy + height, 1 + dx : 1 + dx + width]
        for dy in (-1, 0, 1)
        for dx in (-1, 0, 1)
        if (dx, dy) != (0, 0)
    ]
    highest = filled >= np.max(neighbors, axis=0)
    inside = np.zeros(snr.shape, dtype=bool)
    inside[MARGIN : height - MARGIN, MARGIN : width - MARGIN] = True
    rows, columns = np.nonzero(highest & inside & (filled >= threshold))
    found: list[tuple[float, float, float]] = []
    for index in np.argsort(-filled[rows, columns]):
        x, y = float(columns[index]), float(rows[index])
        if all(np.hypot(x - other_x, y - other_y) >= _SEPARATION for other_x, other_y, _ in found):
            found.append((x, y, float(filled[rows[index], columns[index]])))
    return found


def _cutouts(
    images: np.ndarray, x: np.ndarray, y: np.ndarray, half: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Squares cut around positions, with the offsets of the positions from their centers.

    `images` is one image, or a pile of images cut at the same single position.
    """
    column = np.rint(x).astype(np.int64)
    row = np.rint(y).astype(np.int64)
    pile = images if images.ndim == 3 else images[None]
    padded = np.pad(pile, ((0, 0), (half, half), (half, half)), constant_values=np.nan)
    side = 2 * half + 1
    if images.ndim == 3:
        cut = padded[:, row[0] : row[0] + side, column[0] : column[0] + side]
    else:
        cut = np.stack(
            [padded[0, r : r + side, c : c + side] for r, c in zip(row, column, strict=True)]
        )
    return cut, x - column, y - row


def centroids(image: np.ndarray, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Refined positions of sources near the given ones. NaN where none can be trusted.

    The position is the center of light under a Gaussian window that follows it, the
    sky of a ring removed. It moves from the given position by a few pixels at most.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if x.size == 0:
        return x.copy(), y.copy()
    half = int(np.ceil(_SKY_OUTER))
    inside = (x >= 0) & (x <= image.shape[1] - 1) & (y >= 0) & (y <= image.shape[0] - 1)
    start_x = np.where(inside, x, 0.0)
    start_y = np.where(inside, y, 0.0)
    cut, offset_x, offset_y = _cutouts(image, start_x, start_y, half)
    axis = np.arange(-half, half + 1, dtype=np.float64)
    grid_x = axis[None, None, :]
    grid_y = axis[None, :, None]
    known = np.isfinite(cut)

    distance = np.hypot(grid_x - offset_x[:, None, None], grid_y - offset_y[:, None, None])
    ring = (distance >= _SKY_INNER) & (distance <= _SKY_OUTER) & known
    with all_nan_allowed():
        sky = np.nanmedian(np.where(ring, cut, np.nan), axis=(1, 2))
    data = np.where(known, cut - sky[:, None, None], 0.0)

    now_x, now_y = offset_x.copy(), offset_y.copy()
    alive = inside & (ring.sum(axis=(1, 2)) >= _FEWEST_SKY_PIXELS) & np.isfinite(sky)
    for _ in range(_ITERATIONS):
        away_x = grid_x - now_x[:, None, None]
        away_y = grid_y - now_y[:, None, None]
        square = away_x**2 + away_y**2
        window = (square <= _WINDOW_RADIUS**2) & known
        weighted = data * np.exp(-square / (2 * _WINDOW_SIGMA**2)) * window
        total = weighted.sum(axis=(1, 2))
        alive &= total > 0
        safe = np.where(alive, total, 1.0)
        # The factor 2 makes up for the window, which pulls the center toward itself.
        step_x = np.clip(2 * (weighted * away_x).sum(axis=(1, 2)) / safe, -1.0, 1.0)
        step_y = np.clip(2 * (weighted * away_y).sum(axis=(1, 2)) / safe, -1.0, 1.0)
        now_x = np.where(alive, now_x + step_x, now_x)
        now_y = np.where(alive, now_y + step_y, now_y)
        if np.all(np.hypot(step_x, step_y)[alive] < _CONVERGED):
            break

    square = (grid_x - now_x[:, None, None]) ** 2 + (grid_y - now_y[:, None, None]) ** 2
    in_window = square <= _WINDOW_RADIUS**2
    heart = square <= _HEART_RADIUS**2
    alive &= ~(heart & ~known).any(axis=(1, 2))
    alive &= (in_window & known).sum(axis=(1, 2)) >= _WINDOW_SHARE * in_window.sum(axis=(1, 2))
    alive &= np.hypot(now_x - offset_x, now_y - offset_y) <= _WINDOW_RADIUS
    column = np.rint(start_x)
    row = np.rint(start_y)
    return np.where(alive, column + now_x, np.nan), np.where(alive, row + now_y, np.nan)


def _circle_weights(half: int, x: float, y: float, radius: float) -> np.ndarray:
    """Share of each pixel of a square that lies inside a circle, from 0 to 1."""
    side = 2 * half + 1
    parts = (np.arange(_PARTS) + 0.5) / _PARTS - 0.5
    fine = (np.arange(-half, half + 1)[:, None] + parts[None, :]).ravel()
    inside = (fine[None, :] - x) ** 2 + (fine[:, None] - y) ** 2 <= radius**2
    return inside.reshape(side, _PARTS, side, _PARTS).mean(axis=(1, 3))


def brightness(frames: np.ndarray, x: float, y: float) -> tuple[np.ndarray, np.ndarray]:
    """Light of a source in each frame of a pile, and its noise: a circle minus a ring of sky.

    The unit is that of the frames times one pixel. The light is only meant to be
    compared with itself from one frame to another. NaN where a pixel of the circle
    has no value.
    """
    height, width = frames.shape[1:]
    if not (np.isfinite(x) and np.isfinite(y) and 0 <= x <= width - 1 and 0 <= y <= height - 1):
        nothing = np.full(frames.shape[0], np.nan)
        return nothing, nothing.copy()
    half = int(np.ceil(_RING_OUTER))
    cut, offset_x, offset_y = _cutouts(frames, np.array([x]), np.array([y]), half)
    weights = _circle_weights(half, float(offset_x[0]), float(offset_y[0]), APERTURE_RADIUS)
    axis = np.arange(-half, half + 1, dtype=np.float64)
    distance = np.hypot(axis[None, :] - offset_x[0], axis[:, None] - offset_y[0])
    ring = (distance >= _RING_INNER) & (distance <= _RING_OUTER)
    known = np.isfinite(cut)
    around = np.where(ring[None] & known, cut, np.nan)
    with all_nan_allowed():
        sky = np.nanmedian(around, axis=(1, 2))
        scatter = MAD_TO_SIGMA * np.nanmedian(np.abs(around - sky[:, None, None]), axis=(1, 2))
    enough_sky = (ring[None] & known).sum(axis=(1, 2)) >= _FEWEST_SKY_PIXELS
    circle = weights > 0
    measured = known[:, circle].all(axis=1) & enough_sky
    light = (np.where(known, cut - sky[:, None, None], 0.0) * weights[None]).sum(axis=(1, 2))
    noise = _NOISE_SPREAD * scatter * np.sqrt((weights**2).sum())
    return np.where(measured, light, np.nan), np.where(measured, noise, np.nan)
