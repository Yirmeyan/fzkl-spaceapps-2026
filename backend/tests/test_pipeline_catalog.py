"""Catalogs in a view: where their sources are at the date the view is looked at."""

import asyncio
import math

import pytest

from spherex_explorer.catalogs import ALLWISE, GAIA, CatalogSource, Cone
from spherex_explorer.frames import Grid
from spherex_explorer.pipeline import place_at, sources_in_view, view_catalog, view_catalogs

ARCSECOND = 1 / 3600
# Barnard's Star as Gaia saw it in 2016, and a view centered where it is ten years later.
BARNARD = CatalogSource(
    id="Gaia DR3 4472832130942575872",
    ra=269.448503,
    dec=4.739420,
    magnitudes=(("G", 8.19),),
    pm_ra=-801.551,
    pm_dec=10362.394,
)
VIEW = Grid(ra=269.4463, dec=4.7682, fov_deg=0.1)


def still(ra: float, dec: float, name: str = "still") -> CatalogSource:
    return CatalogSource(id=name, ra=ra, dec=dec)


def test_a_source_is_moved_by_its_motion_since_the_date_of_its_catalog():
    ra, dec = place_at(BARNARD, GAIA, 2026.0)

    assert dec - BARNARD.dec == pytest.approx(10 * 10.362394 * ARCSECOND, abs=1e-9)
    east = (ra - BARNARD.ra) * math.cos(math.radians(BARNARD.dec))
    assert east == pytest.approx(10 * -0.801551 * ARCSECOND, abs=1e-9)
    assert place_at(BARNARD, GAIA, 2016.0) == pytest.approx((BARNARD.ra, BARNARD.dec))


def test_a_source_without_a_motion_stays_where_its_catalog_saw_it():
    assert place_at(still(10.0, 20.0), ALLWISE, 2026.0) == (10.0, 20.0)


def test_only_the_sources_inside_the_square_of_the_view_are_kept():
    half = VIEW.fov_deg / 2
    inside = still(VIEW.ra, VIEW.dec + 0.9 * half, "inside")
    north = still(VIEW.ra, VIEW.dec + 1.1 * half, "north")
    # In the circle around the view, and outside its square.
    east = still(VIEW.ra + 1.2 * half / math.cos(math.radians(VIEW.dec)), VIEW.dec, "east")

    kept = sources_in_view([north, inside, east], GAIA, VIEW, 2026.0)

    assert [source.id for source in kept] == ["inside"]
    assert sources_in_view([], GAIA, VIEW, 2026.0) == ()


def test_a_fast_star_counts_where_it_is_at_the_date_of_the_view():
    # A narrow view around the place of the star in 2026: in 2016 it was 104 arcseconds
    # to the south, outside of it.
    narrow = Grid(ra=VIEW.ra, dec=VIEW.dec, fov_deg=0.03)

    assert sources_in_view([BARNARD], GAIA, narrow, 2026.0) == (BARNARD,)
    assert sources_in_view([BARNARD], GAIA, narrow, 2016.0) == ()


class FakeCatalogs:
    """A catalog service that answers the same cone to every request, and notes them."""

    limit = 300

    def __init__(self, sources=(), complete=True):
        self.cone = Cone(tuple(sources), complete)
        self.asked: list[tuple[str, float, float, float]] = []

    async def around(self, catalog, ra, dec, radius_deg):
        self.asked.append((catalog.key, ra, dec, radius_deg))
        return self.cone


def test_a_catalog_with_motions_is_searched_further_than_the_view():
    service = FakeCatalogs([BARNARD, still(0.0, 0.0, "elsewhere")])

    found = asyncio.run(view_catalog(service, GAIA, VIEW, 2026.0))

    key, ra, dec, radius = service.asked[0]
    assert (key, ra, dec) == ("gaia", VIEW.ra, VIEW.dec)
    # Half the diagonal of the view, and what the fastest star covers in ten years.
    assert radius == pytest.approx(0.1 / math.sqrt(2) + 10 * 10.5 * ARCSECOND)
    assert (found.catalog, found.sources) == (GAIA, (BARNARD,))
    assert (found.truncated, found.limit) == (False, 300)


def test_a_catalog_without_motions_is_searched_on_the_view_alone():
    service = FakeCatalogs(complete=False)

    found = asyncio.run(view_catalog(service, ALLWISE, VIEW, 2026.0))

    assert service.asked[0][3] == pytest.approx(0.1 / math.sqrt(2))
    assert (found.sources, found.truncated) == ((), True)


def test_every_catalog_is_asked_for_a_view():
    service = FakeCatalogs([still(VIEW.ra, VIEW.dec)])

    found = asyncio.run(view_catalogs(service, VIEW, 2026.0))

    assert [one.catalog.key for one in found] == ["gaia", "allwise"]
    assert sorted(asked[0] for asked in service.asked) == ["allwise", "gaia"]
