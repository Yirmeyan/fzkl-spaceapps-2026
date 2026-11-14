"""Summary of a frame: its background, its scatter, the share of pixels with a value."""

import numpy as np

# Scatter of a normal distribution for a median absolute deviation of 1.
_MAD_TO_SIGMA = 1.4826


def background_and_noise(image: np.ndarray, mask: np.ndarray) -> tuple[float | None, float | None]:
    """Median and scatter of the pixels that have a value and no flag. None when there is none."""
    clean = image[np.isfinite(image) & (mask == 0)]
    if clean.size == 0:
        return None, None
    background = float(np.median(clean))
    noise = _MAD_TO_SIGMA * float(np.median(np.abs(clean - background)))
    return background, noise


def valid_fraction(image: np.ndarray) -> float:
    """Share of the pixels that hold a value, from 0 to 1."""
    return float(np.count_nonzero(np.isfinite(image))) / image.size
