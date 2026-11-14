"""Wavelength seen by a pixel of a detector.

A filter whose color changes gradually covers each SPHEREx detector. The file gives the
wavelength and the width of the band at a coarse grid of control points, and asks for a
linear interpolation between them.
"""

import numpy as np

from spherex_explorer.archive import WavelengthTable


def _bracket(points: np.ndarray, position: float) -> tuple[int, float]:
    """Interval of the control points that holds a position, and where it falls inside."""
    position = min(max(position, float(points[0])), float(points[-1]))
    index = int(np.searchsorted(points, position, side="right")) - 1
    index = min(max(index, 0), points.size - 2)
    span = float(points[index + 1] - points[index])
    return index, (position - float(points[index])) / span if span else 0.0


def wavelength_at(table: WavelengthTable, x: float, y: float) -> tuple[float, float]:
    """Wavelength and bandwidth, in micrometers, at a pixel position counted from 0.

    A position outside the detector takes the value of the nearest edge.
    """
    column, right = _bracket(table.x, x + 1.0)
    row, down = _bracket(table.y, y + 1.0)
    corners = table.values[row : row + 2, column : column + 2]
    weights = np.array(
        [[(1 - right) * (1 - down), right * (1 - down)], [(1 - right) * down, right * down]]
    )
    wavelength = float((corners[..., 0] * weights).sum())
    bandwidth = float((corners[..., 1] * weights).sum())
    return wavelength, bandwidth
