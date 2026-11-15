"""Answer to "what is the spectrum of this object": its flux in every exposure, no image.

Each SPHEREx exposure sees a place of the sky at one wavelength, which changes with the
place on the detector. The fluxes of a target in all its exposures, sorted by
wavelength, are therefore its spectrum. Only the pixels around the target are read.
"""

import asyncio
import logging
import math
from dataclasses import dataclass

from spherex_explorer.archive import Layout, Window
from spherex_explorer.errors import NotFound, UpstreamError, UpstreamUnavailable
from spherex_explorer.frames import (
    DEFAULT_FOV_DEG,
    DEFAULT_SIZE,
    DetectorWcs,
    flag_plan,
    has_no_value,
    is_saturated,
    translate,
    wavelength_at,
)
from spherex_explorer.photometry import Measurement
from spherex_explorer.pipeline.exposures import ExposureArchive, ListedExposure, list_exposures
from spherex_explorer.pipeline.frames import (
    TARGET_REACH,
    FrameSource,
    circle_window,
    header_number,
    measure_in_window,
)
from spherex_explorer.targets import Target, position_at

logger = logging.getLogger(__name__)

# Exposures measured at the same time. The reader of the files has its own limit on
# the reads in flight: this one bounds the memory a spectrum takes.
_PARALLEL = 32
# Seconds a client is asked to wait when too many files could not be read.
_RETRY_AFTER_S = 5


@dataclass(frozen=True, slots=True)
class SpectrumPoint:
    """Flux of a target in one exposure, at the wavelength the target was seen at.

    The wavelength is unknown when the target is off the detector.
    """

    listed: ListedExposure
    time_mjd: float
    wavelength_um: float | None
    bandwidth_um: float | None
    photometry: Measurement


@dataclass(frozen=True, slots=True)
class Spectrum:
    """A target and one point per exposure that could be read, in the order of the list."""

    target: Target
    points: tuple[SpectrumPoint, ...]


def _window_around(layout: Layout, x: float, y: float) -> Window:
    """Detector pixels that hold the circle and the sky ring of a target on the detector."""
    return Window(
        x0=max(0, math.floor(x) - TARGET_REACH),
        y0=max(0, math.floor(y) - TARGET_REACH),
        x1=min(layout.width, math.floor(x) + TARGET_REACH + 1),
        y1=min(layout.height, math.floor(y) + TARGET_REACH + 1),
    )


async def measure_exposure(
    source: FrameSource, listed: ListedExposure, target: Target
) -> SpectrumPoint:
    """Measure a target in one exposure, where it was at the date of that exposure."""
    exposure_id = listed.exposure.id
    layout = await source.layout(exposure_id)
    wcs = DetectorWcs.from_header(layout.header)
    time_mjd = header_number(layout, "MJD-AVG")
    x, y = (float(value) for value in wcs.sky_to_pixel(*position_at(target, time_mjd)))
    circle = circle_window(layout, x, y)
    if circle is None:
        outside = Measurement(flux_mjy=None, error_mjy=None, quality="outside")
        return SpectrumPoint(listed, time_mjd, None, None, outside)

    window = _window_around(layout, x, y)
    raw, table, circle_variance = await asyncio.gather(
        source.read_window(exposure_id, window, with_variance=False),
        source.wavelength_table(exposure_id),
        source.read_variance(exposure_id, circle),
    )
    plan = flag_plan(layout.flag_planes)
    photometry = measure_in_window(
        exposure_id,
        raw,
        window,
        translate(raw.flags, plan),
        has_no_value(raw.flags, plan),
        is_saturated(raw.flags, plan),
        circle,
        circle_variance,
        (x, y),
        wcs.pixel_area_sr(x, y),
    )
    wavelength, bandwidth = wavelength_at(table, x, y)
    return SpectrumPoint(listed, time_mjd, wavelength, bandwidth, photometry)


def _date(point: SpectrumPoint) -> float:
    return point.time_mjd


async def measure_spectrum(
    archive: ExposureArchive,
    source: FrameSource,
    target: Target,
    *,
    detector: int | None = None,
) -> Spectrum:
    """Measure a target in every exposure that covers it, or in those of one detector.

    An exposure whose file is gone gives no point. A file that cannot be read gives no
    point either, as long as most of the others can: a spectrum with a few points
    missing is worth more than no spectrum.
    """
    listing = await list_exposures(archive, target, fov_deg=DEFAULT_FOV_DEG, size=DEFAULT_SIZE)
    chosen = [
        listed
        for listed in listing.exposures
        if detector is None or listed.exposure.detector == detector
    ]
    slots = asyncio.Semaphore(_PARALLEL)
    failures: list[Exception] = []

    async def point_or_none(listed: ListedExposure) -> SpectrumPoint | None:
        async with slots:
            try:
                return await measure_exposure(source, listed, target)
            except NotFound:
                logger.warning("%s: no file in the archive, no point", listed.exposure.id)
            except (UpstreamUnavailable, UpstreamError) as exc:
                logger.warning("%s: %s, no point", listed.exposure.id, exc)
                failures.append(exc)
            return None

    measured = await asyncio.gather(*(point_or_none(listed) for listed in chosen))
    if 2 * len(failures) > len(chosen):
        raise UpstreamUnavailable(
            "The SPHEREx file storage",
            f"{len(failures)} exposures of {len(chosen)} could not be read",
            retry_after_s=_RETRY_AFTER_S,
        ) from failures[0]
    # The date of a point is read in its file. Two detectors that expose together carry
    # dates a fraction of a second apart, and not always in the order of the list.
    points = sorted((point for point in measured if point is not None), key=_date)
    return Spectrum(target=target, points=tuple(points))
