"""The grid every frame of a view is resampled on, and its link with the sky.

The formulas are those of docs/api-contract.md, so that the browser and the service
place every pixel at the same spot. North is up, east is left, and the projection is
gnomonic around the center of the grid.
"""

from dataclasses import dataclass

import numpy as np

DEFAULT_FOV_DEG = 0.1
MIN_FOV_DEG = 0.02
MAX_FOV_DEG = 0.5
DEFAULT_SIZE = 128
MIN_SIZE = 32
MAX_SIZE = 256


@dataclass(frozen=True, slots=True)
class Grid:
    """A square of sky, north up and east left.

    The center is in degrees (ICRS). The side is fov_deg degrees on the sky and
    size pixels in the image.
    """

    ra: float
    dec: float
    fov_deg: float = DEFAULT_FOV_DEG
    size: int = DEFAULT_SIZE

    @property
    def scale_deg(self) -> float:
        """Side of one pixel, in degrees."""
        return self.fov_deg / self.size

    @property
    def center(self) -> float:
        """Pixel coordinate of the center of the image, the same along x and y."""
        return (self.size - 1) / 2


def grid_to_sky(grid: Grid, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Right ascension and declination, in degrees, of pixel positions of the grid."""
    east = np.radians((grid.center - np.asarray(x, dtype=np.float64)) * grid.scale_deg)
    north = np.radians((grid.center - np.asarray(y, dtype=np.float64)) * grid.scale_deg)
    dec0 = np.radians(grid.dec)
    denominator = np.cos(dec0) - north * np.sin(dec0)
    ra = grid.ra + np.degrees(np.arctan2(east, denominator))
    dec = np.degrees(np.arctan2(np.sin(dec0) + north * np.cos(dec0), np.hypot(east, denominator)))
    return ra % 360.0, dec


def sky_to_grid(grid: Grid, ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Pixel position [x, y] of sky positions given in degrees. It can fall outside the image."""
    dec0 = np.radians(grid.dec)
    d = np.radians(np.asarray(dec, dtype=np.float64))
    da = np.radians(np.asarray(ra, dtype=np.float64) - grid.ra)
    cosc = np.sin(dec0) * np.sin(d) + np.cos(dec0) * np.cos(d) * np.cos(da)
    east = np.degrees(np.cos(d) * np.sin(da) / cosc)
    north = np.degrees((np.cos(dec0) * np.sin(d) - np.sin(dec0) * np.cos(d) * np.cos(da)) / cosc)
    return grid.center - east / grid.scale_deg, grid.center - north / grid.scale_deg


def pixel_centers(grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    """Coordinates x and y of every pixel of the grid, as two arrays of size by size."""
    index = np.arange(grid.size, dtype=np.float64)
    return np.meshgrid(index, index)
