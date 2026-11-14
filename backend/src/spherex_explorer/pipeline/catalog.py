"""What the catalogs of other telescopes hold in a view, at the date the view is looked at."""

import asyncio
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from spherex_explorer.catalogs import CATALOGS, Catalog, CatalogSource, Cone
from spherex_explorer.frames import Grid, sky_to_grid
from spherex_explorer.targets import Target, position_at

_MJD_J2000 = 51544.5
_DAYS_PER_JULIAN_YEAR = 365.25
# The fastest star of the sky, Barnard's Star, in degrees per year. A source can be this
# far, each year, from where its catalog saw it: the search reaches that much further.
_FASTEST_DEG_PER_YEAR = 10.5 / 3600


class SkyCatalogs(Protocol):
    """What the pipeline needs from a catalog service. Tests provide their own."""

    limit: int

    async def around(self, catalog: Catalog, ra: float, dec: float, radius_deg: float) -> Cone: ...


@dataclass(frozen=True, slots=True)
class CatalogView:
    """The sources of a catalog that are inside a view at a date, the brightest first.

    `truncated` tells that the catalog holds more sources there than the `limit` asked
    for: the faintest are missing.
    """

    catalog: Catalog
    sources: tuple[CatalogSource, ...]
    truncated: bool
    limit: int


def place_at(source: CatalogSource, catalog: Catalog, epoch: float) -> tuple[float, float]:
    """Right ascension and declination of a source at a date given as a Julian year."""
    target = Target(
        ra=source.ra,
        dec=source.dec,
        epoch=catalog.epoch,
        pm_ra=source.pm_ra or 0.0,
        pm_dec=source.pm_dec or 0.0,
    )
    return position_at(target, _MJD_J2000 + (epoch - 2000.0) * _DAYS_PER_JULIAN_YEAR)


def sources_in_view(
    sources: Sequence[CatalogSource], catalog: Catalog, view: Grid, epoch: float
) -> tuple[CatalogSource, ...]:
    """The sources that are inside the square of a view at a date, in the order given."""
    if not sources:
        return ()
    places = np.array([place_at(source, catalog, epoch) for source in sources])
    x, y = sky_to_grid(view, places[:, 0], places[:, 1])
    edge = view.size - 0.5
    inside = (x >= -0.5) & (x <= edge) & (y >= -0.5) & (y <= edge)
    return tuple(source for source, kept in zip(sources, inside, strict=True) if kept)


async def view_catalog(
    service: SkyCatalogs, catalog: Catalog, view: Grid, epoch: float
) -> CatalogView:
    """Ask a catalog for the circle around a view, and keep what is inside the view.

    A catalog that gives motions is searched further out: a fast star seen elsewhere
    years ago may be inside the view today.
    """
    moves = catalog.pm_ra is not None
    reach = _FASTEST_DEG_PER_YEAR * abs(epoch - catalog.epoch) if moves else 0.0
    cone = await service.around(catalog, view.ra, view.dec, view.fov_deg / math.sqrt(2) + reach)
    return CatalogView(
        catalog=catalog,
        sources=sources_in_view(cone.sources, catalog, view, epoch),
        truncated=not cone.complete,
        limit=service.limit,
    )


async def view_catalogs(service: SkyCatalogs, view: Grid, epoch: float) -> list[CatalogView]:
    """Every catalog of the service for a view, asked at the same time."""
    answers = await asyncio.gather(
        *(view_catalog(service, catalog, view, epoch) for catalog in CATALOGS)
    )
    return list(answers)
