"""Answer to "what moved or changed here": the candidates of the field around a target.

The frames of the default view are read as for a movie, all detectors together, then
handed to the detection. The reading is the long part: the measurement itself takes a
second or two, and runs aside so that the service keeps answering meanwhile.
"""

import asyncio
import logging
from collections.abc import Sequence
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
