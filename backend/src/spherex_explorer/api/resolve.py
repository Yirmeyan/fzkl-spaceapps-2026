"""Route that turns the name of an object into a target, as described in docs/api-contract.md."""

import asyncio
from typing import Annotated, Protocol

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel

from spherex_explorer.api.exposures import get_time_budget_s
from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.targets import MAX_NAME_LENGTH, ResolvedTarget, catalog_name

router = APIRouter(tags=["resolve"])

# A name does not change its meaning, but catalogs refine positions now and then.
_CACHE_CONTROL = "public, max-age=86400"
_RETRY_AFTER_S = 10
# A millionth of a degree is 4 milliarcseconds, far below a SPHEREx pixel.
_ANGLE_DECIMALS = 6
_MOTION_DECIMALS = 3


class NameResolver(Protocol):
    """What the route needs from a resolver. Tests provide their own."""

    async def resolve(self, name: str) -> ResolvedTarget: ...


class TargetOut(BaseModel):
    name: str
    ra: float
    dec: float
    epoch: float
    pm_ra: float | None
    pm_dec: float | None


def get_resolver(request: Request) -> NameResolver:
    """Name resolver of the running application, created when it starts."""
    resolver = getattr(request.app.state, "resolver", None)
    if resolver is None:
        raise RuntimeError("The name resolver was not started with the application.")
    return resolver


def _rounded(value: float | None) -> float | None:
    return None if value is None else round(value, _MOTION_DECIMALS)


@router.get("/resolve", response_model=TargetOut)
async def read_target(
    response: Response,
    resolver: Annotated[NameResolver, Depends(get_resolver)],
    time_budget_s: Annotated[float, Depends(get_time_budget_s)],
    name: Annotated[
        str,
        Query(
            min_length=1,
            max_length=MAX_NAME_LENGTH,
            pattern=r".*\S.*",
            description="Name of the object, as an astronomer would type it.",
        ),
    ],
) -> TargetOut:
    try:
        async with asyncio.timeout(time_budget_s):
            # "WISE 0855" is asked for under the name catalogs know it by.
            target = await resolver.resolve(catalog_name(name))
    except TimeoutError as exc:
        raise UpstreamUnavailable(
            "The CDS name resolver",
            f"no answer within {time_budget_s:g} s",
            retry_after_s=_RETRY_AFTER_S,
        ) from exc

    response.headers["Cache-Control"] = _CACHE_CONTROL
    return TargetOut(
        name=" ".join(name.split()),
        ra=round(target.ra, _ANGLE_DECIMALS),
        dec=round(target.dec, _ANGLE_DECIMALS),
        epoch=target.epoch,
        pm_ra=_rounded(target.pm_ra),
        pm_dec=_rounded(target.pm_dec),
    )
