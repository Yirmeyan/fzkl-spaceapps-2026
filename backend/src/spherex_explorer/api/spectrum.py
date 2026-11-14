"""Route that returns the spectrum of a target, as described in docs/api-contract.md."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from spherex_explorer.api.exposures import TargetOut, get_archive, get_time_budget_s
from spherex_explorer.api.frames import get_frame_source
from spherex_explorer.api.numbers import SKY_DECIMALS, TIME_DECIMALS, rounded, significant
from spherex_explorer.api.params import Dec, Epoch, PmDec, PmRa, Ra
from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.mjd import mjd_to_iso
from spherex_explorer.pipeline import (
    ExposureArchive,
    FrameSource,
    Spectrum,
    SpectrumPoint,
    measure_spectrum,
)
from spherex_explorer.targets import Target

router = APIRouter(tags=["spectrum"])

# As for the list of exposures: new ones are published every week.
_CACHE_CONTROL = "public, max-age=3600"
# Seconds a client is asked to wait before it tries again.
_RETRY_AFTER_S = 10

Detector = Annotated[
    int | None,
    Query(ge=1, le=6, description="Measure the exposures of this detector only, 1 to 6."),
]


class PointOut(BaseModel):
    id: str
    detector: int
    # "pass" is a reserved word in Python, so the field carries the name through an alias.
    pass_number: int = Field(serialization_alias="pass")
    time_mjd: float
    time_iso: str
    wavelength_um: float | None
    bandwidth_um: float | None
    flux_mjy: float | None
    error_mjy: float | None
    quality: str


class SpectrumOut(BaseModel):
    target: TargetOut
    points: list[PointOut]


def point_out(point: SpectrumPoint) -> PointOut:
    """One point of a spectrum as the contract writes it."""
    exposure = point.listed.exposure
    return PointOut(
        id=exposure.id,
        detector=exposure.detector,
        pass_number=point.listed.pass_number,
        time_mjd=round(point.time_mjd, TIME_DECIMALS),
        time_iso=mjd_to_iso(point.time_mjd),
        wavelength_um=rounded(point.wavelength_um, SKY_DECIMALS),
        bandwidth_um=rounded(point.bandwidth_um, SKY_DECIMALS),
        flux_mjy=significant(point.photometry.flux_mjy),
        error_mjy=significant(point.photometry.error_mjy),
        quality=point.photometry.quality,
    )


def spectrum_out(spectrum: Spectrum) -> SpectrumOut:
    """A spectrum as the contract writes it."""
    target = spectrum.target
    return SpectrumOut(
        target=TargetOut(
            ra=target.ra,
            dec=target.dec,
            epoch=target.epoch,
            pm_ra=target.pm_ra,
            pm_dec=target.pm_dec,
        ),
        points=[point_out(point) for point in spectrum.points],
    )


@router.get("/spectrum", response_model=SpectrumOut)
async def read_spectrum(
    response: Response,
    archive: Annotated[ExposureArchive, Depends(get_archive)],
    source: Annotated[FrameSource, Depends(get_frame_source)],
    time_budget_s: Annotated[float, Depends(get_time_budget_s)],
    ra: Ra,
    dec: Dec,
    epoch: Epoch = 2000.0,
    pm_ra: PmRa = 0.0,
    pm_dec: PmDec = 0.0,
    detector: Detector = None,
) -> SpectrumOut:
    target = Target(ra=ra, dec=dec, epoch=epoch, pm_ra=pm_ra, pm_dec=pm_dec)
    try:
        # The search and the reads of every exposure get the time of one request
        # together, so that the answer always comes from this service.
        async with asyncio.timeout(time_budget_s):
            spectrum = await measure_spectrum(archive, source, target, detector=detector)
    except TimeoutError as exc:
        raise UpstreamUnavailable(
            "The SPHEREx archive",
            f"no complete spectrum within {time_budget_s:g} s",
            retry_after_s=_RETRY_AFTER_S,
        ) from exc

    response.headers["Cache-Control"] = _CACHE_CONTROL
    return spectrum_out(spectrum)
