"""Stacks: the frames of one visit and one detector, averaged pixel by pixel.

One exposure shows a faint object badly or not at all. The average of the exposures of
a visit shows it, and it is the image a position is measured on.
"""

import warnings
from collections.abc import Iterator
from contextlib import contextmanager

import numpy as np

# Scatter of a normal distribution for a median absolute deviation of 1.
MAD_TO_SIGMA = 1.4826
# A value further than this many times the scatter from the median of its pixel is an
# accident of one exposure: a cosmic ray, a satellite, an asteroid passing by.
_CLIP = 4.0
# Below this many frames a scatter means little: the median does the cleaning instead.
_FEWEST_TO_CLIP = 5
# A pixel of the stack needs a value in at least this share of the frames. The heart of
# a saturated star has one in a few exposures only, and they do not describe the star.
_SHARE_NEEDED = 0.5


@contextmanager
def all_nan_allowed() -> Iterator[None]:
    """NumPy warns when a pixel has no value in any frame. Here it is an expected case."""
    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore", RuntimeWarning)
        yield


def without_outliers(values: np.ndarray) -> np.ndarray:
    """Frames of one visit, where the accidents of a single exposure are replaced by NaN.

    `values` holds one frame per row of its first axis. With fewer than five frames
    nothing is removed.
    """
    if values.shape[0] < _FEWEST_TO_CLIP:
        return values
    with all_nan_allowed():
        middle = np.nanmedian(values, axis=0)
        scatter = MAD_TO_SIGMA * np.nanmedian(np.abs(values - middle), axis=0)
    # A scatter of zero would remove everything but the median itself.
    far = np.abs(values - middle) > _CLIP * np.maximum(scatter, 1e-6)
    return np.where(far, np.nan, values)


def average(values: np.ndarray) -> np.ndarray:
    """Average of frames, pixel by pixel. NaN where too few of them have a value.

    The frames are expected without their outliers. With fewer than five frames the
    median is used, since it resists one accident on its own.
    """
    frames = values.shape[0]
    if frames == 0:
        return np.full(values.shape[1:], np.nan, dtype=np.float64)
    count = np.isfinite(values).sum(axis=0)
    with all_nan_allowed():
        if frames < _FEWEST_TO_CLIP:
            stacked = np.nanmedian(values, axis=0)
        else:
            stacked = np.nanmean(values, axis=0)
    enough = count >= max(1.0, _SHARE_NEEDED * frames)
    return np.where(enough, stacked, np.nan).astype(np.float64)
