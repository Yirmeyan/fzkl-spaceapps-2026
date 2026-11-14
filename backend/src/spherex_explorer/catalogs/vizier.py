"""Catalogs of other telescopes, read at VizieR: what is already known in a piece of sky.

VizieR, the catalog service of the CDS, answers a cone of any catalog as a table of
tab-separated values. Two catalogs are read: Gaia DR3, which knows how the stars move,
and AllWISE, which saw the same infrared sky as SPHEREx fifteen years earlier.
"""

import asyncio
import logging
import time
from collections import OrderedDict
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import httpx2

from spherex_explorer.errors import UpstreamError, UpstreamUnavailable

logger = logging.getLogger(__name__)

_SERVICE = "The VizieR catalog service"
_PUBLIC = "The catalog service did not answer. Try again in a moment."
_QUERY = "/viz-bin/asu-tsv"
_CLIENT_RETRY_AFTER_S = 10
_ERROR = "#INFO\tError="
_MJD_J2000 = 51544.5
_DAYS_PER_JULIAN_YEAR = 365.25
# A ten-thousandth of a degree is a third of an arcsecond: two requests that close get
# the same answer.
_KEY_DECIMALS = 4


@dataclass(frozen=True, slots=True)
class Catalog:
    """A catalog of VizieR and the columns read from it.

    `epoch` is the date of its positions, as a Julian year. `bands` names each magnitude
    kept and the column that holds it. The first one is the band the sources are sorted
    by, the brightest first.
    """

    key: str
    name: str
    table: str
    epoch: float
    identifier: str
    ra: str
    dec: str
    bands: tuple[tuple[str, str], ...]
    pm_ra: str | None = None
    pm_dec: str | None = None
    parallax: str | None = None
    parallax_error: str | None = None

    @property
    def columns(self) -> tuple[str, ...]:
        """The columns asked for, in the order of the answer."""
        optional = (self.pm_ra, self.pm_dec, self.parallax, self.parallax_error)
        return (
            self.identifier,
            self.ra,
            self.dec,
            *(column for column in optional if column is not None),
            *(column for _, column in self.bands),
        )

    @property
    def band(self) -> str:
        """The band the sources are sorted by."""
        return self.bands[0][0]


GAIA = Catalog(
    key="gaia",
    name="Gaia DR3",
    table="I/355/gaiadr3",
    epoch=2016.0,
    identifier="DR3Name",
    ra="RA_ICRS",
    dec="DE_ICRS",
    bands=(("G", "Gmag"),),
    pm_ra="pmRA",
    pm_dec="pmDE",
    parallax="Plx",
    parallax_error="e_Plx",
)
# AllWISE gives where a source was in the middle of the survey, near MJD 55400, and no
# motion that can be trusted. It is sorted by its band at 4.6 micrometers, the one where
# a cold object is brightest.
ALLWISE = Catalog(
    key="allwise",
    name="AllWISE",
    table="II/328/allwise",
    epoch=round(2000.0 + (55400.0 - _MJD_J2000) / _DAYS_PER_JULIAN_YEAR, 2),
    identifier="AllWISE",
    ra="RAJ2000",
    dec="DEJ2000",
    bands=(("W2", "W2mag"), ("W1", "W1mag")),
)
CATALOGS = (GAIA, ALLWISE)


@dataclass(frozen=True, slots=True)
class CatalogSource:
    """One line of a catalog.

    Angles are in degrees (ICRS) at the epoch of the catalog. Proper motions are in
    milliarcseconds per year, with the cos(dec) factor in pm_ra, and the parallax is in
    milliarcseconds. What the catalog does not give is None, or absent from `magnitudes`.
    """

    id: str
    ra: float
    dec: float
    magnitudes: tuple[tuple[str, float], ...] = ()
    pm_ra: float | None = None
    pm_dec: float | None = None
    parallax: float | None = None
    parallax_error: float | None = None


@dataclass(frozen=True, slots=True)
class Cone:
    """The sources of a catalog around a place, the brightest first.

    `complete` is False when the catalog holds more of them than were asked for: the
    faintest are missing.
    """

    sources: tuple[CatalogSource, ...]
    complete: bool


def _number(text: str) -> float | None:
    try:
        return float(text)
    except ValueError:
        return None


def refusal(payload: str) -> str | None:
    """Why VizieR did not answer the request, when it says so. None otherwise.

    VizieR reports a failure inside an answer that looks like any other: status 200,
    and one line that starts with an error. "The database is not currently reachable"
    comes and goes within minutes.
    """
    for line in payload.splitlines():
        if line.startswith(_ERROR):
            return line[len(_ERROR) :].strip() or "no reason given"
    return None


def parse_vizier(payload: str, catalog: Catalog) -> list[CatalogSource]:
    """Read the answer of VizieR to a request for the columns of a catalog.

    Lines that start with # describe the answer. The table follows: the names of the
    columns, their units, a rule, then one line per source. An empty cone has no table.
    """
    refused = refusal(payload)
    if refused is not None:
        raise UpstreamError(f"{_SERVICE} refused the request: {refused}")
    lines = payload.splitlines()
    if f"#Name: {catalog.table}" not in lines:
        raise UpstreamError(f"{_SERVICE} did not answer about {catalog.table}")
    table = [line for line in lines if line.strip() and not line.startswith("#")]
    if not table:
        return []
    names = tuple(name.strip() for name in table[0].split("\t"))
    if names != catalog.columns:
        raise UpstreamError(f"{_SERVICE} answered other columns than asked: {names}")
    rule = next((i for i, line in enumerate(table) if line.startswith("-")), None)
    if rule is None:
        raise UpstreamError(f"{_SERVICE} answered a table without its rule")
    sources = []
    for line in table[rule + 1 :]:
        cells = [cell.strip() for cell in line.split("\t")]
        if len(cells) != len(names):
            raise UpstreamError(f"{_SERVICE} answered a line of {len(cells)} cells: {line!r}")
        row = dict(zip(names, cells, strict=True))
        ra, dec = _number(row[catalog.ra]), _number(row[catalog.dec])
        if not row[catalog.identifier] or ra is None or dec is None:
            continue
        if not (0 <= ra < 360.0001 and -90 <= dec <= 90):
            continue

        def read(column: str | None, row: dict[str, str] = row) -> float | None:
            return None if column is None else _number(row[column])

        magnitudes = ((band, read(column)) for band, column in catalog.bands)
        sources.append(
            CatalogSource(
                id=row[catalog.identifier],
                ra=ra % 360.0,
                dec=dec,
                magnitudes=tuple((band, value) for band, value in magnitudes if value is not None),
                pm_ra=read(catalog.pm_ra),
                pm_dec=read(catalog.pm_dec),
                parallax=read(catalog.parallax),
                parallax_error=read(catalog.parallax_error),
            )
        )
    return sources


class VizierCatalogs:
    """Asks VizieR for a cone of a catalog, remembers the answers, and goes to a mirror
    when a site fails."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        *,
        urls: Sequence[str],
        timeout_s: float,
        limit: int = 300,
        fresh_s: float = 86400.0,
        remembered: int = 128,
        rounds: int = 2,
        pause_s: float = 0.5,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._urls = tuple(url.rstrip("/") for url in urls)
        self._timeout_s = timeout_s
        # A site of VizieR fails for a moment and answers the next: the list of sites
        # is gone through this many times, with a pause in between.
        self._rounds = rounds
        self._pause_s = pause_s
        self.limit = limit
        self._fresh_s = fresh_s
        self._remembered = remembered
        self._clock = clock
        # A catalog does not change: an answer is kept for a day, the last ones only.
        self._known: OrderedDict[tuple[str, float, float, float], tuple[float, Cone]] = (
            OrderedDict()
        )

    async def around(self, catalog: Catalog, ra: float, dec: float, radius_deg: float) -> Cone:
        """The sources of a catalog within a radius of a place, the brightest first."""
        key = (
            catalog.key,
            round(ra, _KEY_DECIMALS),
            round(dec, _KEY_DECIMALS),
            round(radius_deg, _KEY_DECIMALS),
        )
        known = self._known.get(key)
        if known is not None and self._clock() - known[0] <= self._fresh_s:
            self._known.move_to_end(key)
            return known[1]
        params = {
            "-source": catalog.table,
            "-c": f"{key[1]:.4f} {key[2]:+.4f}",
            "-c.rd": f"{key[3]:.4f}",
            "-out": ",".join(catalog.columns),
            "-sort": catalog.bands[0][1],
            # One more than kept, to know whether the catalog holds more.
            "-out.max": str(self.limit + 1),
        }
        sources = parse_vizier(await self._fetch(params), catalog)
        cone = Cone(tuple(sources[: self.limit]), complete=len(sources) <= self.limit)
        self._known[key] = (self._clock(), cone)
        self._known.move_to_end(key)
        while len(self._known) > self._remembered:
            self._known.popitem(last=False)
        return cone

    async def _fetch(self, params: dict[str, str]) -> str:
        reason = "no address to ask"
        for attempt in range(self._rounds):
            if attempt:
                await asyncio.sleep(self._pause_s)
            for url in self._urls:
                try:
                    response = await self._client.get(
                        url + _QUERY,
                        params=params,
                        timeout=self._timeout_s,
                        follow_redirects=True,
                    )
                except httpx2.TimeoutException:
                    reason = "no answer within the time limit"
                except httpx2.HTTPError as exc:
                    reason = f"request failed ({type(exc).__name__})"
                else:
                    if response.status_code == 200:
                        refused = refusal(response.text)
                        if refused is None:
                            return response.text
                        # The request is the same every time and the real service
                        # accepts it: a refusal is this site failing for now.
                        reason = f"refused: {refused}"
                    else:
                        reason = f"HTTP {response.status_code}"
                logger.warning("%s: %s failed: %s", _SERVICE, url, reason)
        raise UpstreamUnavailable(
            _SERVICE, reason, retry_after_s=_CLIENT_RETRY_AFTER_S, public=_PUBLIC
        )
