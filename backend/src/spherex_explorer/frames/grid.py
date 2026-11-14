"""The grid every frame of a view is resampled on."""

from dataclasses import dataclass

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
