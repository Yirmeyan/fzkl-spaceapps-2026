"""Parallax: the swing of a nearby object on the sky as the Earth goes around the Sun.

Seen from one side of the orbit, then from the other six months later, a nearby object
shifts against the far ones. The shift is the parallax, and it gives the distance:
one arcsecond at 3.26 light-years, half of it twice as far.
"""

import numpy as np

_MJD_J2000 = 51544.5
# Distance, in light-years, of an object whose parallax is one arcsecond.
LIGHT_YEARS_AT_ONE_ARCSECOND = 3.2616


def earth_position(time_mjd: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Place of the Earth around the Sun at dates in days (MJD), in astronomical units.

    The axes are those of right ascension and declination. The formula is the short
    one of the Astronomical Almanac, good to a hundredth of a degree: a thousand times
    better than a parallax measured on SPHEREx images needs. SPHEREx itself flies 700
    kilometers above the Earth, which changes nothing here.
    """
    days = np.asarray(time_mjd, dtype=np.float64) - _MJD_J2000
    mean_longitude = np.radians(280.460 + 0.9856474 * days)
    anomaly = np.radians(357.528 + 0.9856003 * days)
    longitude = mean_longitude + np.radians(1.915 * np.sin(anomaly) + 0.020 * np.sin(2 * anomaly))
    distance = 1.00014 - 0.01671 * np.cos(anomaly) - 0.00014 * np.cos(2 * anomaly)
    tilt = np.radians(23.439 - 0.0000004 * days)
    # The formula gives the Sun seen from the Earth: the Earth is on the other side.
    return (
        -distance * np.cos(longitude),
        -distance * np.cos(tilt) * np.sin(longitude),
        -distance * np.sin(tilt) * np.sin(longitude),
    )


def parallax_shift(ra: float, dec: float, time_mjd: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Shift of an object toward the east and toward the north, for a parallax of 1.

    The position is in degrees and the dates in days (MJD). The result is in the unit
    the parallax is counted in.
    """
    x, y, z = earth_position(time_mjd)
    alpha, delta = np.radians(ra), np.radians(dec)
    east = x * np.sin(alpha) - y * np.cos(alpha)
    north = (
        x * np.cos(alpha) * np.sin(delta) + y * np.sin(alpha) * np.sin(delta) - z * np.cos(delta)
    )
    return east, north
