"""A target and the position its proper motion gives it at a date."""

import math
from dataclasses import dataclass

_MJD_J2000 = 51544.5
_DAYS_PER_JULIAN_YEAR = 365.25
_MAS_PER_DEGREE = 3.6e6
# Closer to a pole than this, right ascension loses its meaning and is left untouched.
_POLE_LIMIT_DEG = 89.9999


@dataclass(frozen=True, slots=True)
class Target:
    """Position of an object at a reference date, with its proper motion.

    Angles are in degrees (ICRS) and the epoch is a Julian year. The proper motion
    is in milliarcseconds per year, and pm_ra includes the cos(dec) factor.
    """

    ra: float
    dec: float
    epoch: float = 2000.0
    pm_ra: float = 0.0
    pm_dec: float = 0.0


def position_at(target: Target, time_mjd: float) -> tuple[float, float]:
    """Right ascension and declination of the target at a date, in degrees.

    The motion is a straight line, as the API contract states. Parallax and
    perspective effects stay under one arcsecond for the fastest star of the sky,
    far below the 6 arcsecond pixels of SPHEREx.
    """
    years = (time_mjd - _MJD_J2000) / _DAYS_PER_JULIAN_YEAR - (target.epoch - 2000.0)
    dec = target.dec + target.pm_dec * years / _MAS_PER_DEGREE
    dec = max(-90.0, min(90.0, dec))
    ra = target.ra
    if abs(target.dec) < _POLE_LIMIT_DEG:
        ra += target.pm_ra * years / _MAS_PER_DEGREE / math.cos(math.radians(target.dec))
    return ra % 360.0, dec
