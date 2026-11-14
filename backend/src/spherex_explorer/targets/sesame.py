"""From the name of an object to its position, through the CDS Sesame name resolver.

Sesame asks SIMBAD, then NED, then VizieR, and answers a small XML document. SIMBAD
gives positions at epoch 2000 with proper motions, which is what a target needs.
"""

import logging
import xml.etree.ElementTree as ET
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from urllib.parse import quote

import httpx2

from spherex_explorer.errors import NotFound, UpstreamError, UpstreamUnavailable

logger = logging.getLogger(__name__)

_SERVICE = "The CDS name resolver"
# XML output, then the catalogs asked in turn: SIMBAD, NED, VizieR.
_QUERY = "/-ox/SNV?"
_UNKNOWN = "No object is known under this name."
_CLIENT_RETRY_AFTER_S = 10
_J2000 = 2000.0
MAX_NAME_LENGTH = 100


class InvalidName(ValueError):
    """What was given is not something a catalog could know as a name."""


@dataclass(frozen=True, slots=True)
class ResolvedTarget:
    """An object found by its name: where it was in 2000, and how it moves.

    Angles are in degrees (ICRS). Proper motions are in milliarcseconds per year, with
    the cos(dec) factor in pm_ra, and None when the catalog gives none.
    """

    name: str
    ra: float
    dec: float
    epoch: float
    pm_ra: float | None
    pm_dec: float | None


def clean_name(name: str) -> str:
    """Name as it is sent to the resolver: single spaces, no control character."""
    cleaned = " ".join(name.split())
    if not cleaned or len(cleaned) > MAX_NAME_LENGTH or not cleaned.isprintable():
        raise InvalidName(f"not a name of 1 to {MAX_NAME_LENGTH} printable characters")
    return cleaned


def _number(element: ET.Element | None) -> float | None:
    if element is None or element.text is None:
        return None
    try:
        return float(element.text)
    except ValueError:
        return None


def parse_sesame(payload: bytes, name: str) -> ResolvedTarget | None:
    """Read the answer of Sesame. None when no catalog knows the name."""
    # Sesame declares no entity. An answer that does is not what was asked for.
    if b"<!DOCTYPE" in payload or b"<!ENTITY" in payload:
        raise UpstreamError(f"{_SERVICE} answered XML that declares entities")
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise UpstreamError(f"{_SERVICE} did not answer XML: {exc}") from exc
    if root.tag != "Sesame":
        raise UpstreamError(f"{_SERVICE} answered a document of another kind: {root.tag!r}")
    for resolver in root.iter("Resolver"):
        ra = _number(resolver.find("jradeg"))
        dec = _number(resolver.find("jdedeg"))
        if ra is None or dec is None or not (0 <= ra < 360.0001 and -90 <= dec <= 90):
            continue
        return ResolvedTarget(
            name=name,
            ra=ra % 360.0,
            dec=dec,
            epoch=_J2000,
            pm_ra=_number(resolver.find("pm/pmRA")),
            pm_dec=_number(resolver.find("pm/pmDE")),
        )
    return None


class SesameResolver:
    """Resolves names, remembers the answers, and goes to a mirror when a site fails."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        *,
        urls: Sequence[str],
        timeout_s: float,
        remembered: int = 512,
    ) -> None:
        self._client = client
        self._urls = tuple(url.rstrip("/") for url in urls)
        self._timeout_s = timeout_s
        # A name always means the same object: an answer is kept for the life of the process.
        self._known: OrderedDict[str, ResolvedTarget] = OrderedDict()
        self._remembered = remembered

    async def resolve(self, name: str) -> ResolvedTarget:
        """Target of a name. NotFound when no catalog knows it."""
        asked = clean_name(name)
        key = asked.casefold()
        known = self._known.get(key)
        if known is not None:
            return known
        target = parse_sesame(await self._fetch(asked), asked)
        if target is None:
            raise NotFound(f"no object named {asked!r}", public=_UNKNOWN)
        self._known[key] = target
        while len(self._known) > self._remembered:
            self._known.popitem(last=False)
        return target

    async def _fetch(self, name: str) -> bytes:
        reason = "no address to ask"
        for url in self._urls:
            try:
                # The main site sends to a mirror when it is busy: follow it.
                response = await self._client.get(
                    url + _QUERY + quote(name),
                    timeout=self._timeout_s,
                    follow_redirects=True,
                )
            except httpx2.TimeoutException:
                reason = "no answer within the time limit"
            except httpx2.HTTPError as exc:
                reason = f"request failed ({type(exc).__name__})"
            else:
                if response.status_code == 200:
                    return response.content
                reason = f"HTTP {response.status_code}"
            logger.warning("%s: %s failed: %s", _SERVICE, url, reason)
        raise UpstreamUnavailable(_SERVICE, reason, retry_after_s=_CLIENT_RETRY_AFTER_S)
