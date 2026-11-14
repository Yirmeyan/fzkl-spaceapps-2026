"""Resampling of detector pixels on the grid of a view."""

import numpy as np


def resample(
    values: np.ndarray, mask: np.ndarray, x: np.ndarray, y: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Values and flags at fractional positions of a window of detector pixels.

    Each value is interpolated between the four pixels around the position, and it
    carries the flags of the four. It is NaN when one of them has no value or lies
    outside the window. Positions are counted from the first pixel of the window.
    """
    height, width = values.shape
    known = np.isfinite(x) & np.isfinite(y)
    column = np.floor(np.where(known, x, 0.0)).astype(np.int64)
    row = np.floor(np.where(known, y, 0.0)).astype(np.int64)
    inside = known & (column >= 0) & (column < width - 1) & (row >= 0) & (row < height - 1)
    column = np.where(inside, column, 0)
    row = np.where(inside, row, 0)
    right = np.where(inside, x - column, 0.0)
    down = np.where(inside, y - row, 0.0)

    if width < 2 or height < 2:
        shape = np.shape(x)
        return np.full(shape, np.nan, dtype=np.float32), np.zeros(shape, dtype=np.uint8)

    interpolated = (
        (1 - right) * (1 - down) * values[row, column]
        + right * (1 - down) * values[row, column + 1]
        + (1 - right) * down * values[row + 1, column]
        + right * down * values[row + 1, column + 1]
    )
    flags = (
        mask[row, column]
        | mask[row, column + 1]
        | mask[row + 1, column]
        | mask[row + 1, column + 1]
    )
    image = np.where(inside, interpolated, np.nan).astype(np.float32)
    return image, np.where(inside, flags, 0).astype(np.uint8)
