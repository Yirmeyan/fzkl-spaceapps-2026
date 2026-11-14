"""Route that returns one exposure as a frame, as described in docs/api-contract.md."""

import asyncio
import base64
from typing import Annotated

import numpy as np
from fastapi import APIRouter, Depends, Path, Request, Response
from pydantic import BaseModel

from spherex_explorer.api.exposures import get_time_budget_s
from spherex_explorer.api.numbers import SKY_DECIMALS, TIME_DECIMALS, rounded, significant
from spherex_explorer.api.params import Dec, Epoch, Fov, GridDec, GridRa, PmDec, PmRa, Ra, Size
from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.frames import DEFAULT_FOV_DEG, DEFAULT_SIZE, Grid
from spherex_explorer.mjd import mjd_to_iso
from spherex_explorer.photometry import Measurement
from spherex_explorer.pipeline import Frame, FrameSource, build_frame
from spherex_explorer.targets import Target

router = APIRouter(tags=["frames"])

# The file of an exposure never changes, but the way it is turned into a frame still does.
_CACHE_CONTROL = "public, max-age=86400"
# Seconds a client is asked to wait before it tries again.
_RETRY_AFTER_S = 5
# Largest value a 16-bit float holds. Brighter pixels are clipped to it.
_FLOAT16_MAX = 65504.0
# Digits kept in the answer, well below what the instrument resolves.
_PIXEL_DECIMALS = 2
_FRACTION_DECIMALS = 3


class PhotometryOut(BaseModel):
    flux_mjy: float | None
    error_mjy: float | None
    quality: str


class FrameOut(BaseModel):
    id: str
    time_mjd: float
    time_iso: str
    exposure_s: float
    wavelength_um: float
    bandwidth_um: float
    background: float | None
    noise: float | None
    valid_fraction: float
    target_xy: tuple[float, float]
    photometry: PhotometryOut
    image: str
    mask: str


def get_frame_source(request: Request) -> FrameSource:
    """Reader of the SPHEREx files of the running application, created when it starts."""
    source = getattr(request.app.state, "frames", None)
    if source is None:
        raise RuntimeError("The reader of the files was not started with the application.")
    return source


def encode_image(image: np.ndarray) -> str:
    """Pixels as base64 of 16-bit floats, little endian, row by row from the top."""
    clipped = np.clip(image, -_FLOAT16_MAX, _FLOAT16_MAX)
    return base64.b64encode(clipped.astype("<f2").tobytes()).decode("ascii")


def encode_mask(mask: np.ndarray) -> str:
    """Flags as base64 of one byte per pixel, in the order of the image."""
    return base64.b64encode(mask.astype(np.uint8).tobytes()).decode("ascii")


def photometry_out(measurement: Measurement) -> PhotometryOut:
    """A measurement as the contract writes it."""
    return PhotometryOut(
        flux_mjy=significant(measurement.flux_mjy),
        error_mjy=significant(measurement.error_mjy),
        quality=measurement.quality,
    )


def frame_out(frame: Frame) -> FrameOut:
    """A frame as the contract writes it: rounded numbers, pixels and flags in base64."""
    return FrameOut(
        id=frame.id,
        time_mjd=round(frame.time_mjd, TIME_DECIMALS),
        time_iso=mjd_to_iso(frame.time_mjd),
        exposure_s=round(frame.exposure_s, 1),
        wavelength_um=round(frame.wavelength_um, SKY_DECIMALS),
        bandwidth_um=round(frame.bandwidth_um, SKY_DECIMALS),
        background=rounded(frame.background, SKY_DECIMALS),
        noise=rounded(frame.noise, SKY_DECIMALS),
        valid_fraction=round(frame.valid_fraction, _FRACTION_DECIMALS),
        target_xy=(
            round(frame.target_xy[0], _PIXEL_DECIMALS),
            round(frame.target_xy[1], _PIXEL_DECIMALS),
        ),
        photometry=photometry_out(frame.photometry),
        image=encode_image(frame.image),
        mask=encode_mask(frame.mask),
    )


@router.get("/frames/{exposure_id}", response_model=FrameOut)
async def read_frame(
    response: Response,
    source: Annotated[FrameSource, Depends(get_frame_source)],
    time_budget_s: Annotated[float, Depends(get_time_budget_s)],
    exposure_id: Annotated[
        str, Path(max_length=120, description="Identifier taken from the list of exposures.")
    ],
    ra: Ra,
    dec: Dec,
    epoch: Epoch = 2000.0,
    pm_ra: PmRa = 0.0,
    pm_dec: PmDec = 0.0,
    grid_ra: GridRa = None,
    grid_dec: GridDec = None,
    fov: Fov = DEFAULT_FOV_DEG,
    size: Size = DEFAULT_SIZE,
) -> FrameOut:
    target = Target(ra=ra, dec=dec, epoch=epoch, pm_ra=pm_ra, pm_dec=pm_dec)
    grid = Grid(
        ra=ra if grid_ra is None else grid_ra,
        dec=dec if grid_dec is None else grid_dec,
        fov_deg=fov,
        size=size,
    )
    try:
        # Reads are tried again when the storage is busy. Together they get the time of
        # one request, so that the answer always comes from this service.
        async with asyncio.timeout(time_budget_s):
            frame = await build_frame(source, exposure_id, target, grid)
    except TimeoutError as exc:
        raise UpstreamUnavailable(
            "The SPHEREx file storage",
            f"no complete frame within {time_budget_s:g} s",
            retry_after_s=_RETRY_AFTER_S,
        ) from exc

    response.headers["Cache-Control"] = _CACHE_CONTROL
    return frame_out(frame)
