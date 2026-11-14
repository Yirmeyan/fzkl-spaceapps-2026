"""Route that lists the exposures of a target, as described in docs/api-contract.md."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from spherex_explorer.api.params import Dec, Epoch, Fov, PmDec, PmRa, Ra, Size
from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.frames import DEFAULT_FOV_DEG, DEFAULT_SIZE
from spherex_explorer.mjd import mjd_to_iso
from spherex_explorer.pipeline import ExposureArchive, list_exposures
from spherex_explorer.targets import Target

router = APIRouter(tags=["exposures"])

# New exposures are published every week: a list may be reused for an hour, not longer.
_CACHE_CONTROL = "public, max-age=3600"
_TIME_DECIMALS = 6
# Seconds a client is asked to wait before it tries again.
_RETRY_AFTER_S = 10


class TargetOut(BaseModel):
    ra: float
    dec: float
    epoch: float
    pm_ra: float
    pm_dec: float


class GridOut(BaseModel):
    ra: float
    dec: float
    fov_deg: float
    size: int


class ExposureOut(BaseModel):
    id: str
    collection: str
    detector: int
    # "pass" is a reserved word in Python, so the field carries the name through an alias.
    pass_number: int = Field(serialization_alias="pass")
    time_mjd: float
    time_iso: str


class ExposuresOut(BaseModel):
    target: TargetOut
    grid: GridOut
    exposures: list[ExposureOut]


def get_archive(request: Request) -> ExposureArchive:
    """Archive of the running application, created when it starts."""
    archive = getattr(request.app.state, "archive", None)
    if archive is None:
        raise RuntimeError("The archive client was not started with the application.")
    return archive


def get_time_budget_s(request: Request) -> float:
    """Longest time one request may spend on the archive, in seconds."""
    return request.app.state.settings.archive_budget_s


@router.get("/exposures", response_model=ExposuresOut)
async def read_exposures(
    response: Response,
    archive: Annotated[ExposureArchive, Depends(get_archive)],
    time_budget_s: Annotated[float, Depends(get_time_budget_s)],
    ra: Ra,
    dec: Dec,
    epoch: Epoch = 2000.0,
    pm_ra: PmRa = 0.0,
    pm_dec: PmDec = 0.0,
    fov: Fov = DEFAULT_FOV_DEG,
    size: Size = DEFAULT_SIZE,
) -> ExposuresOut:
    target = Target(ra=ra, dec=dec, epoch=epoch, pm_ra=pm_ra, pm_dec=pm_dec)
    try:
        # A moving target takes two searches. Together they get the time of one request,
        # so that the answer always comes from this service and never from its host.
        async with asyncio.timeout(time_budget_s):
            listing = await list_exposures(archive, target, fov_deg=fov, size=size)
    except TimeoutError as exc:
        raise UpstreamUnavailable(
            "The SPHEREx archive",
            f"no complete answer within {time_budget_s:g} s",
            retry_after_s=_RETRY_AFTER_S,
        ) from exc

    response.headers["Cache-Control"] = _CACHE_CONTROL
    return ExposuresOut(
        target=TargetOut(ra=ra, dec=dec, epoch=epoch, pm_ra=pm_ra, pm_dec=pm_dec),
        grid=GridOut(
            ra=listing.grid.ra,
            dec=listing.grid.dec,
            fov_deg=listing.grid.fov_deg,
            size=listing.grid.size,
        ),
        exposures=[
            ExposureOut(
                id=listed.exposure.id,
                collection=listed.exposure.collection,
                detector=listed.exposure.detector,
                pass_number=listed.pass_number,
                time_mjd=round(listed.exposure.time_mjd, _TIME_DECIMALS),
                time_iso=mjd_to_iso(listed.exposure.time_mjd),
            )
            for listed in listing.exposures
        ],
    )
