"""The candidates of a field as docs/api-contract.md writes them."""

import math

import numpy as np
from pydantic import BaseModel, Field

from spherex_explorer.api.exposures import GridOut, TargetOut, grid_out
from spherex_explorer.api.numbers import TIME_DECIMALS
from spherex_explorer.detection import (
    CLAIM,
    MOVED,
    SMALLEST_CHANGE,
    SMALLEST_SHIFT,
    Candidate,
    Change,
    Motion,
    Sighting,
)
from spherex_explorer.frames import Grid, grid_to_sky, sky_to_grid
from spherex_explorer.mjd import mjd_to_iso
from spherex_explorer.pipeline.candidates import FieldReport
from spherex_explorer.targets import LIGHT_YEARS_AT_ONE_ARCSECOND, Target, position_at

_ARCSEC_PER_DEGREE = 3600.0
_MAS_PER_ARCSEC = 1000.0
_DAYS_PER_YEAR = 365.25
_MJD_J2000 = 51544.5
_EPOCH_DECIMALS = 3
_PLACE_DECIMALS = 6
_PIXEL_DECIMALS = 2
_ARCSEC_DECIMALS = 2
_RATIO_DECIMALS = 3
_WAVELENGTH_DECIMALS = 3
# A candidate is the target when it stays this close, in pixels, to where the catalog
# puts the target at the date of each visit: three SPHEREx pixels at most.
_SAME_AS_TARGET = 6.6


class VisitOut(BaseModel):
    # "pass" is a reserved word in Python, so the field carries the name through an alias.
    pass_number: int = Field(serialization_alias="pass")
    time_mjd: float
    time_iso: str
    frames: int


class LimitsOut(BaseModel):
    significance: float
    shift_arcsec: float
    change: float


class SaturatedOut(BaseModel):
    ra: float
    dec: float
    xy: tuple[float, float]
    radius_arcsec: float
    detectors: list[int]


class SightingOut(BaseModel):
    pass_number: int = Field(serialization_alias="pass")
    time_mjd: float
    time_iso: str
    ra: float
    dec: float
    xy: tuple[float, float]
    error_arcsec: float
    detectors: list[int]


class MotionOut(BaseModel):
    shift_arcsec: float
    days: float
    rate_arcsec_per_year: float
    rate_error_arcsec_per_year: float
    angle_deg: float
    pm_ra: float
    pm_dec: float
    parallax_arcsec: float | None
    parallax_error_arcsec: float | None
    distance_ly: float | None
    distance_ly_range: tuple[float, float] | None


class ChangeOut(BaseModel):
    detector: int
    from_pass: int
    to_pass: int
    ratio: float
    error: float
    significance: float
    wavelength_um: tuple[float, float]


class CandidateOut(BaseModel):
    kind: str
    confidence: str
    significance: float
    is_target: bool
    ra: float
    dec: float
    epoch: float
    xy: tuple[float, float]
    detectors: list[int]
    track: list[SightingOut]
    motion: MotionOut | None
    changes: list[ChangeOut]


class CandidatesOut(BaseModel):
    target: TargetOut
    grid: GridOut
    frames: int
    sources: int
    visits: list[VisitOut]
    limits: LimitsOut
    saturated: list[SaturatedOut]
    candidates: list[CandidateOut]


def _place(grid: Grid, x: float, y: float) -> tuple[float, float]:
    ra, dec = grid_to_sky(grid, np.array(x), np.array(y))
    return round(float(ra), _PLACE_DECIMALS), round(float(dec), _PLACE_DECIMALS)


def _pixel(x: float, y: float) -> tuple[float, float]:
    return round(x, _PIXEL_DECIMALS), round(y, _PIXEL_DECIMALS)


def _sighting_out(grid: Grid, sighting: Sighting) -> SightingOut:
    ra, dec = _place(grid, sighting.x, sighting.y)
    return SightingOut(
        pass_number=sighting.pass_number,
        time_mjd=round(sighting.time_mjd, TIME_DECIMALS),
        time_iso=mjd_to_iso(sighting.time_mjd),
        ra=ra,
        dec=dec,
        xy=_pixel(sighting.x, sighting.y),
        error_arcsec=round(
            sighting.error * grid.scale_deg * _ARCSEC_PER_DEGREE, _ARCSEC_DECIMALS + 1
        ),
        detectors=list(sighting.detectors),
    )


def _motion_out(grid: Grid, motion: Motion) -> MotionOut:
    """A motion in arcseconds on the sky. On the grid, east is toward smaller x and north
    toward smaller y."""
    arcsec = grid.scale_deg * _ARCSEC_PER_DEGREE
    east = -motion.rate_x * arcsec * _DAYS_PER_YEAR
    north = -motion.rate_y * arcsec * _DAYS_PER_YEAR
    parallax = error = distance = reach = None
    if motion.parallax is not None and motion.parallax_error is not None:
        parallax = motion.parallax * arcsec
        error = motion.parallax_error * arcsec
        distance = round(LIGHT_YEARS_AT_ONE_ARCSECOND / parallax, 1)
        nearest = LIGHT_YEARS_AT_ONE_ARCSECOND / (parallax + error)
        # A parallax barely above its uncertainty leaves the far side open.
        farthest = LIGHT_YEARS_AT_ONE_ARCSECOND / (parallax - error) if parallax > error else None
        reach = (round(nearest, 1), round(farthest, 1)) if farthest is not None else None
    return MotionOut(
        shift_arcsec=round(math.hypot(motion.shift_x, motion.shift_y) * arcsec, _ARCSEC_DECIMALS),
        days=round(motion.days, 1),
        rate_arcsec_per_year=round(math.hypot(east, north), _ARCSEC_DECIMALS),
        rate_error_arcsec_per_year=round(
            motion.rate_error * arcsec * _DAYS_PER_YEAR, _ARCSEC_DECIMALS
        ),
        angle_deg=round(math.degrees(math.atan2(east, north)) % 360.0, 1),
        pm_ra=round(east * _MAS_PER_ARCSEC, 0),
        pm_dec=round(north * _MAS_PER_ARCSEC, 0),
        parallax_arcsec=None if parallax is None else round(parallax, _ARCSEC_DECIMALS + 1),
        parallax_error_arcsec=None if error is None else round(error, _ARCSEC_DECIMALS + 1),
        distance_ly=distance,
        distance_ly_range=reach,
    )


def _change_out(change: Change) -> ChangeOut:
    return ChangeOut(
        detector=change.detector,
        from_pass=change.from_pass,
        to_pass=change.to_pass,
        ratio=round(change.ratio, _RATIO_DECIMALS),
        error=round(change.error, _RATIO_DECIMALS),
        significance=round(change.significance, 1),
        wavelength_um=(
            round(change.wavelength_um[0], _WAVELENGTH_DECIMALS),
            round(change.wavelength_um[1], _WAVELENGTH_DECIMALS),
        ),
    )


def _is_target(target: Target, grid: Grid, sightings: tuple[Sighting, ...]) -> bool:
    """Is the source where the catalog puts the target, at the date of each visit?"""
    for sighting in sightings:
        ra, dec = position_at(target, sighting.time_mjd)
        x, y = sky_to_grid(grid, np.array(ra), np.array(dec))
        if math.hypot(sighting.x - float(x), sighting.y - float(y)) > _SAME_AS_TARGET:
            return False
    return bool(sightings)


def _candidate_out(target: Target, grid: Grid, candidate: Candidate) -> CandidateOut:
    source = candidate.source
    ra, dec = _place(grid, source.x, source.y)
    moved = candidate.kind == MOVED and source.motion is not None
    return CandidateOut(
        kind=candidate.kind,
        confidence=candidate.confidence,
        significance=round(candidate.significance, 1),
        is_target=_is_target(target, grid, source.sightings),
        ra=ra,
        dec=dec,
        epoch=round(
            2000.0
            + (float(np.mean([sighting.time_mjd for sighting in source.sightings])) - _MJD_J2000)
            / _DAYS_PER_YEAR,
            _EPOCH_DECIMALS,
        ),
        xy=_pixel(source.x, source.y),
        detectors=sorted({d for sighting in source.sightings for d in sighting.detectors}),
        track=[_sighting_out(grid, sighting) for sighting in source.sightings],
        motion=_motion_out(grid, source.motion) if moved and source.motion else None,
        changes=[_change_out(change) for change in candidate.changes],
    )


def candidates_out(report: FieldReport) -> CandidatesOut:
    """The report on a field as the contract writes it."""
    target, grid = report.target, report.grid
    arcsec = grid.scale_deg * _ARCSEC_PER_DEGREE
    saturated = []
    for star in report.field.saturated:
        ra, dec = _place(grid, star.x, star.y)
        saturated.append(
            SaturatedOut(
                ra=ra,
                dec=dec,
                xy=_pixel(star.x, star.y),
                radius_arcsec=round(star.radius * arcsec, 1),
                detectors=list(star.detectors),
            )
        )
    return CandidatesOut(
        target=TargetOut(
            ra=target.ra,
            dec=target.dec,
            epoch=target.epoch,
            pm_ra=target.pm_ra,
            pm_dec=target.pm_dec,
        ),
        grid=grid_out(grid),
        frames=report.frames,
        sources=len(report.field.sources),
        visits=[
            VisitOut(
                pass_number=visit.pass_number,
                time_mjd=round(visit.time_mjd, TIME_DECIMALS),
                time_iso=mjd_to_iso(visit.time_mjd),
                frames=visit.frames,
            )
            for visit in report.field.visits
        ],
        limits=LimitsOut(
            significance=CLAIM,
            shift_arcsec=round(SMALLEST_SHIFT * arcsec, _ARCSEC_DECIMALS),
            change=SMALLEST_CHANGE,
        ),
        saturated=saturated,
        candidates=[_candidate_out(target, grid, candidate) for candidate in report.candidates],
    )
