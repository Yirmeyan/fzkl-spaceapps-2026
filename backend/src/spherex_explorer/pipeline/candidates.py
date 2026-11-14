"""Answer to "what moved or changed here": the candidates of the field around a target.

The frames of the default view are read as for a movie, all detectors together, then
handed to the detection. The reading is the long part: the measurement itself takes a
second or two, and runs aside so that the service keeps answering meanwhile.
"""

import asyncio
import logging
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Hashable, Sequence
from dataclasses import dataclass

import numpy as np

from spherex_explorer.detection import (
    Candidate,
    Field,
    FieldFrame,
    find_candidates,
    measure_field,
)
from spherex_explorer.errors import NotFound, UpstreamError, UpstreamUnavailable
from spherex_explorer.frames import DEFAULT_FOV_DEG, DEFAULT_SIZE, Grid
from spherex_explorer.pipeline.exposures import ExposureArchive, ListedExposure, list_exposures
from spherex_explorer.pipeline.frames import Frame, FrameSource, build_frame
from spherex_explorer.targets import Target, parallax_shift

logger = logging.getLogger(__name__)

# Frames read at the same time. The reader of the files has its own limit on the reads
# in flight: this one bounds the memory a field takes.
_PARALLEL = 32
# Seconds a client is asked to wait when too many files could not be read.
_RETRY_AFTER_S = 5
# Fields measured at the same time in one process: each holds hundreds of frames.
_FIELDS_AT_ONCE = 2


@dataclass(frozen=True, slots=True)
class FieldReport:
    """What was measured in the field of a target, and what stands out in it."""

    target: Target
    grid: Grid
    frames: int
    field: Field
    candidates: tuple[Candidate, ...]


def field_frame(listed: ListedExposure, frame: Frame) -> FieldFrame:
    """A frame of the view as the detection needs it, with its detector and its visit."""
    return FieldFrame(
        detector=listed.exposure.detector,
        pass_number=listed.pass_number,
        time_mjd=frame.time_mjd,
        wavelength_um=frame.wavelength_um,
        bandwidth_um=frame.bandwidth_um,
        background=frame.background,
        image=frame.image,
        mask=frame.mask,
    )


def report_field(target: Target, grid: Grid, frames: Sequence[FieldFrame]) -> FieldReport:
    """Measure the field of a view and pick its candidates. No network: only arithmetic.

    The frames must be on the default scale of a view, 2.8 arcseconds per pixel: the
    detection counts in those pixels.
    """

    def wobble(time_mjd: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        # On the grid, x grows toward the west and y toward the south.
        east, north = parallax_shift(grid.ra, grid.dec, time_mjd)
        return -east, -north

    field = measure_field(frames, wobble)
    return FieldReport(
        target=target,
        grid=grid,
        frames=sum(visit.frames for visit in field.visits),
        field=field,
        candidates=find_candidates(field),
    )


async def find_field_candidates(
    archive: ExposureArchive, source: FrameSource, target: Target
) -> FieldReport:
    """Read every exposure of the default view of a target and report on its field.

    An exposure whose file is gone gives no frame. A file that cannot be read gives
    none either, as long as most of the others can: the visits are compared with the
    frames that are there.
    """
    listing = await list_exposures(archive, target, fov_deg=DEFAULT_FOV_DEG, size=DEFAULT_SIZE)
    slots = asyncio.Semaphore(_PARALLEL)
    failures: list[Exception] = []

    async def frame_or_none(listed: ListedExposure) -> FieldFrame | None:
        async with slots:
            try:
                frame = await build_frame(source, listed.exposure.id, target, listing.grid)
                return field_frame(listed, frame)
            except NotFound:
                logger.warning("%s: no file in the archive, no frame", listed.exposure.id)
            except (UpstreamUnavailable, UpstreamError) as exc:
                logger.warning("%s: %s, no frame", listed.exposure.id, exc)
                failures.append(exc)
            return None

    built = await asyncio.gather(*(frame_or_none(listed) for listed in listing.exposures))
    if 2 * len(failures) > len(listing.exposures):
        raise UpstreamUnavailable(
            "The SPHEREx file storage",
            f"{len(failures)} exposures of {len(listing.exposures)} could not be read",
            retry_after_s=_RETRY_AFTER_S,
        ) from failures[0]
    frames = [frame for frame in built if frame is not None]
    return await asyncio.to_thread(report_field, target, listing.grid, frames)


class FieldMemory:
    """Reports already made, and those being made.

    Measuring a field reads hundreds of files. The same field asked twice is measured
    once: a second request joins the first while it runs, and finds its report
    afterwards for as long as it stays fresh. A request that gives up waiting does not
    stop the measurement, so that the next one finds it done. A failure is not kept.
    """

    def __init__(
        self,
        *,
        fresh_s: float = 3600.0,
        kept: int = 64,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._fresh_s = fresh_s
        self._kept = kept
        self._clock = clock
        self._reports: OrderedDict[Hashable, tuple[float, FieldReport]] = OrderedDict()
        self._running: dict[Hashable, asyncio.Task[FieldReport]] = {}
        self._slots = asyncio.Semaphore(_FIELDS_AT_ONCE)

    async def report(
        self, key: Hashable, measure: Callable[[], Awaitable[FieldReport]]
    ) -> FieldReport:
        """The report of the field `key`, measured with `measure` unless it is known."""
        known = self._reports.get(key)
        if known is not None and self._clock() - known[0] <= self._fresh_s:
            self._reports.move_to_end(key)
            return known[1]
        task = self._running.get(key)
        if task is None:
            task = asyncio.create_task(self._measure(key, measure))
            self._running[key] = task
            # A measurement nobody waits for any more may still fail: its error is read
            # here, so that it is not reported as forgotten.
            task.add_done_callback(lambda done: done.cancelled() or done.exception())
        return await asyncio.shield(task)

    async def _measure(
        self, key: Hashable, measure: Callable[[], Awaitable[FieldReport]]
    ) -> FieldReport:
        try:
            async with self._slots:
                report = await measure()
            self._reports[key] = (self._clock(), report)
            self._reports.move_to_end(key)
            while len(self._reports) > self._kept:
                self._reports.popitem(last=False)
            return report
        finally:
            del self._running[key]
