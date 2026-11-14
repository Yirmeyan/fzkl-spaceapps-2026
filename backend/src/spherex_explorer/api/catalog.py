"""Route that lists what other telescopes know in a view, as described in docs/api-contract.md."""

import asyncio
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel

from spherex_explorer.api.exposures import get_time_budget_s
from spherex_explorer.api.params import Dec, Fov, Ra
from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.frames import DEFAULT_FOV_DEG, Grid
from spherex_explorer.pipeline import CatalogView, SkyCatalogs, view_catalogs

router = APIRouter(tags=["catalog"])

# A catalog does not change between two of its releases.
_CACHE_CONTROL = "public, max-age=86400"
_RETRY_AFTER_S = 10
_PUBLIC = "The catalog service did not answer. Try again in a moment."
# A millionth of a degree is 4 milliarcseconds, far below a SPHEREx pixel.
_ANGLE_DECIMALS = 6
_MOTION_DECIMALS = 3
_MAGNITUDE_DECIMALS = 2
_EPOCH_DECIMALS = 3
_UNIX_DAY_MJD = 40587.0
_MJD_J2000 = 51544.5
_SECONDS_PER_DAY = 86400.0
_DAYS_PER_JULIAN_YEAR = 365.25


class ViewOut(BaseModel):
    ra: float
    dec: float
    fov_deg: float


class CatalogSourceOut(BaseModel):
    id: str
    ra: float
    dec: float
    pm_ra: float | None
    pm_dec: float | None
    parallax_mas: float | None
    mags: dict[str, float]


class CatalogOut(BaseModel):
    key: str
    name: str
    epoch: float
    band: str
    limit: int
    truncated: bool
    sources: list[CatalogSourceOut]


class CatalogsOut(BaseModel):
    view: ViewOut
    epoch: float
    catalogs: list[CatalogOut]


def get_catalogs(request: Request) -> SkyCatalogs:
    """Catalog service of the running application, created when it starts."""
    catalogs = getattr(request.app.state, "catalogs", None)
    if catalogs is None:
        raise RuntimeError("The catalog service was not started with the application.")
    return catalogs


def today() -> float:
    """The date of the request, as a Julian year."""
    mjd = _UNIX_DAY_MJD + time.time() / _SECONDS_PER_DAY
    return 2000.0 + (mjd - _MJD_J2000) / _DAYS_PER_JULIAN_YEAR


def _rounded(value: float | None, decimals: int) -> float | None:
    return None if value is None else round(value, decimals)


def catalog_out(found: CatalogView) -> CatalogOut:
    """One catalog of a view, in the shape of the contract."""
    return CatalogOut(
        key=found.catalog.key,
        name=found.catalog.name,
        epoch=found.catalog.epoch,
        band=found.catalog.band,
        limit=found.limit,
        truncated=found.truncated,
        sources=[
            CatalogSourceOut(
                id=source.id,
                ra=round(source.ra, _ANGLE_DECIMALS),
                dec=round(source.dec, _ANGLE_DECIMALS),
                pm_ra=_rounded(source.pm_ra, _MOTION_DECIMALS),
                pm_dec=_rounded(source.pm_dec, _MOTION_DECIMALS),
                parallax_mas=_rounded(source.parallax, _MOTION_DECIMALS),
                mags={band: round(value, _MAGNITUDE_DECIMALS) for band, value in source.magnitudes},
            )
            for source in found.sources
        ],
    )


@router.get("/catalog", response_model=CatalogsOut)
async def read_catalogs(
    response: Response,
    catalogs: Annotated[SkyCatalogs, Depends(get_catalogs)],
    time_budget_s: Annotated[float, Depends(get_time_budget_s)],
    ra: Ra,
    dec: Dec,
    fov: Fov = DEFAULT_FOV_DEG,
    epoch: Annotated[
        float | None,
        Query(
            ge=1900,
            le=2100,
            description="Date the view is looked at, Julian year. Today when left out.",
        ),
    ] = None,
) -> CatalogsOut:
    date = today() if epoch is None else epoch
    view = Grid(ra=ra, dec=dec, fov_deg=fov)
    try:
        async with asyncio.timeout(time_budget_s):
            found = await view_catalogs(catalogs, view, date)
    except TimeoutError as exc:
        raise UpstreamUnavailable(
            "The VizieR catalog service",
            f"no answer within {time_budget_s:g} s",
            retry_after_s=_RETRY_AFTER_S,
            public=_PUBLIC,
        ) from exc

    response.headers["Cache-Control"] = _CACHE_CONTROL
    return CatalogsOut(
        view=ViewOut(ra=ra, dec=dec, fov_deg=fov),
        epoch=round(date, _EPOCH_DECIMALS),
        catalogs=[catalog_out(one) for one in found],
    )
