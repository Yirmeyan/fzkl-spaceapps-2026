"""Answer to "what did SPHEREx see there": the exposures of a target and the grid of its view."""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from spherex_explorer.archive import Exposure
from spherex_explorer.frames import Grid
from spherex_explorer.targets import Target, position_at

# SPHEREx comes back to a place about every six months and observes it over several
# days. Two exposures further apart than this belong to two different visits.
PASS_GAP_DAYS = 30.0
# January 1, 2026, inside the survey: where a moving target is first looked for.
# The result does not depend on the day the question is asked.
FIRST_GUESS_MJD = 61041.0
# A second search is worth its cost when the first one was aimed further off than this.
_SEARCH_TOLERANCE_DEG = 1.0 / 3600.0
_GRID_DECIMALS = 6


class ExposureArchive(Protocol):
    """What the pipeline needs from an archive. Tests provide their own."""

    async def find_exposures(self, ra: float, dec: float) -> list[Exposure]: ...


@dataclass(frozen=True, slots=True)
class ListedExposure:
    """An exposure and the visit it belongs to, numbered from 1."""

    exposure: Exposure
    pass_number: int


@dataclass(frozen=True, slots=True)
class ExposureListing:
    """Everything a client needs to request the frames of a view."""

    target: Target
    grid: Grid
    exposures: tuple[ListedExposure, ...]


def number_passes(exposures: Sequence[Exposure]) -> list[ListedExposure]:
    """Number the visits of a list of exposures sorted by time."""
    listed: list[ListedExposure] = []
    pass_number = 1
    previous: float | None = None
    for exposure in exposures:
        if previous is not None and exposure.time_mjd - previous > PASS_GAP_DAYS:
            pass_number += 1
        listed.append(ListedExposure(exposure=exposure, pass_number=pass_number))
        previous = exposure.time_mjd
    return listed


def _sorted(exposures: Sequence[Exposure]) -> list[Exposure]:
    return sorted(exposures, key=lambda exposure: (exposure.time_mjd, exposure.detector))


def _position_at_mid_observation(
    target: Target, ordered: Sequence[Exposure]
) -> tuple[float, float]:
    middle = (ordered[0].time_mjd + ordered[-1].time_mjd) / 2
    return position_at(target, middle)


def _separation_deg(first: tuple[float, float], second: tuple[float, float]) -> float:
    """Angle between two nearby positions, in degrees."""
    delta_ra = (first[0] - second[0] + 180.0) % 360.0 - 180.0
    delta_dec = first[1] - second[1]
    return math.hypot(delta_ra * math.cos(math.radians(first[1])), delta_dec)


async def list_exposures(
    archive: ExposureArchive,
    target: Target,
    *,
    fov_deg: float,
    size: int,
) -> ExposureListing:
    """List the exposures that cover a target, and center the grid of the view.

    The grid is centered where the target was in the middle of the observations, so
    that a moving object stays in the image from the first exposure to the last. A
    moving target is searched twice: once near where it should be, to learn when it
    was observed, then where it really was at that time.
    """
    searched = position_at(target, FIRST_GUESS_MJD)
    ordered = _sorted(await archive.find_exposures(*searched))

    center = (target.ra, target.dec)
    if ordered:
        center = _position_at_mid_observation(target, ordered)
        if _separation_deg(center, searched) > _SEARCH_TOLERANCE_DEG:
            again = _sorted(await archive.find_exposures(*center))
            if again:
                ordered = again
                center = _position_at_mid_observation(target, ordered)

    grid = Grid(
        ra=round(center[0], _GRID_DECIMALS),
        dec=round(center[1], _GRID_DECIMALS),
        fov_deg=fov_deg,
        size=size,
    )
    return ExposureListing(target=target, grid=grid, exposures=tuple(number_passes(ordered)))
