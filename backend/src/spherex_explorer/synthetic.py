"""A made-up body of the outer solar system, added to real frames to test the search.

No planet is known beyond Neptune, so there is no real body to try the search for a
swing on. One is made up instead: it is given a distance, a brightness and a motion,
and drawn on each frame where it would be at the date of the frame, with the shape of
a star. The frames are real, the body is not, and everything built from them says so.
"""

from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np

from spherex_explorer.frames import Grid, sky_to_grid
from spherex_explorer.targets import Target, parallax_shift, position_at

_ARCSEC_PER_DEGREE = 3600.0
# Astronomical units to an object whose parallax is one arcsecond: a parsec.
_AU_AT_ONE_ARCSECOND = 206264.806
# A flux of one millijansky spread over one steradian, in megajanskys per steradian.
_MJY_PER_SR = 1e-9
# Width of a star on a frame of each detector, in arcseconds: the sigma of the Gaussian
# that fits real stars of quiet fields on the default view, once the frame is put on
# the grid of the view.
STAR_WIDTH_ARCSEC = {1: 3.94, 2: 3.83, 3: 3.91, 4: 4.42, 5: 4.28, 6: 4.44}


@dataclass(frozen=True, slots=True)
class SyntheticBody:
    """A made-up body: where the Sun would see it, how far it is and how bright.

    `seen_from_the_sun` holds its place at an epoch and its own motion, as for any
    target. The flux is in millijanskys, for each detector that shows the body: a
    detector that is not named shows nothing.
    """

    seen_from_the_sun: Target
    distance_au: float
    flux_mjy: Mapping[int, float]

    @property
    def parallax_arcsec(self) -> float:
        """How far the body is from where the Sun sees it, the Earth at a right angle."""
        return _AU_AT_ONE_ARCSECOND / self.distance_au


def place_at(body: SyntheticBody, time_mjd: float) -> tuple[float, float]:
    """Right ascension and declination of the body as the Earth sees it at a date, in degrees."""
    ra, dec = position_at(body.seen_from_the_sun, time_mjd)
    east, north = parallax_shift(ra, dec, np.array(time_mjd))
    shift = body.parallax_arcsec / _ARCSEC_PER_DEGREE
    return (
        float(ra + shift * float(east) / np.cos(np.radians(dec))),
        float(dec + shift * float(north)),
    )


def add_body(
    image: np.ndarray, grid: Grid, detector: int, time_mjd: float, body: SyntheticBody
) -> np.ndarray:
    """The image of a frame with the body drawn on it. The image itself is left as it is.

    The image is a surface brightness in megajanskys per steradian on the grid. The
    body is a round star of the width real stars have in that detector, and its light
    adds up to its flux. A pixel without a value stays without one.
    """
    flux = body.flux_mjy.get(detector, 0.0)
    if flux == 0.0:
        return image
    ra, dec = place_at(body, time_mjd)
    x, y = sky_to_grid(grid, np.array(ra), np.array(dec))
    arcsec = grid.scale_deg * _ARCSEC_PER_DEGREE
    width = STAR_WIDTH_ARCSEC[detector] / arcsec
    pixel_sr = np.radians(grid.scale_deg) ** 2
    rows, columns = np.mgrid[0 : image.shape[0], 0 : image.shape[1]]
    shape = np.exp(-((columns - float(x)) ** 2 + (rows - float(y)) ** 2) / (2 * width**2))
    star = flux * _MJY_PER_SR / pixel_sr * shape / (2 * np.pi * width**2)
    return (image + star).astype(image.dtype)
