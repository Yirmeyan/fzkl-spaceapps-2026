"""Search of the SPHEREx exposures of a position, through the IRSA image access service.

The service follows the IVOA Simple Image Access protocol, version 2. Its answer is a
VOTable: an XML table with one row per exposure.
"""

import asyncio
import json
import logging
import math
import time
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

import httpx2

from spherex_explorer.archive.exposure import Exposure, InvalidExposure, exposure_from_key
from spherex_explorer.errors import UpstreamError, UpstreamUnavailable

logger = logging.getLogger(__name__)

_SERVICE = "The IRSA exposure search"
# Statuses that mean "busy, try again", as opposed to "this request is wrong".
_RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})
# Longest pause between two attempts.
_MAX_PAUSE_S = 3.0
# Below this much time left, a new attempt cannot succeed.
_SHORTEST_ATTEMPT_S = 1.0
# Delay a client is asked to wait before it sends the same request again.
_CLIENT_RETRY_AFTER_S = 10
_REQUIRED_COLUMNS = ("cloud_access", "t_min", "t_max")
_COLLECTION_PREFIX = "spherex_"


@dataclass(frozen=True, slots=True)
class SiaResult:
    """Exposures read from one answer of the service."""

    exposures: tuple[Exposure, ...]
    # The service held more rows than the limit that was asked.
    truncated: bool
    # Rows that did not describe a SPHEREx level 2 file in the expected storage.
    skipped: int


def _local_name(tag: str) -> str:
    """Name of an XML element without its namespace, which changes with the VOTable version."""
    return tag.rsplit("}", 1)[-1]


def _exposure_from_row(cells: list[str], column: dict[str, int], bucket: str) -> Exposure:
    location = json.loads(cells[column["cloud_access"]])["aws"]
    if location["bucket_name"] != bucket:
        raise InvalidExposure(f"file stored in another bucket: {location['bucket_name']!r}")
    start = float(cells[column["t_min"]])
    end = float(cells[column["t_max"]])
    if not (math.isfinite(start) and math.isfinite(end)):
        raise InvalidExposure("exposure without a date")
    return exposure_from_key(location["key"], (start + end) / 2)


def parse_sia_response(payload: bytes, *, bucket: str) -> SiaResult:
    """Read the exposures of a VOTable answer.

    A row that cannot be read is skipped and counted. An answer where no row can be
    read is an error: it means the archive changed, not that the sky is empty.
    """
    # A VOTable declares no entity. One that does is not what was asked for, and the
    # standard parser would expand it.
    if b"<!DOCTYPE" in payload or b"<!ENTITY" in payload:
        raise UpstreamError(f"{_SERVICE} answered XML that declares entities")
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise UpstreamError(f"{_SERVICE} did not answer a VOTable: {exc}") from exc

    results = None
    for element in root.iter():
        if _local_name(element.tag) == "RESOURCE" and element.get("type") == "results":
            results = element
            break
    if results is None:
        raise UpstreamError(f"{_SERVICE} answered a VOTable without a results section")

    status = "OK"
    table = None
    for child in results:
        name = _local_name(child.tag)
        if name == "INFO" and child.get("name") == "QUERY_STATUS":
            status = (child.get("value") or "").upper()
            if status == "ERROR":
                detail = (child.text or "").strip()
                raise UpstreamError(f"{_SERVICE} refused the query: {detail}")
        elif name == "TABLE" and table is None:
            table = child
    truncated = status == "OVERFLOW"
    if table is None:
        return SiaResult(exposures=(), truncated=truncated, skipped=0)

    names = [field.get("name") for field in table if _local_name(field.tag) == "FIELD"]
    missing = [name for name in _REQUIRED_COLUMNS if name not in names]
    if missing:
        raise UpstreamError(f"{_SERVICE} answered a table without the columns {missing}")
    column = {name: names.index(name) for name in _REQUIRED_COLUMNS}

    exposures: list[Exposure] = []
    rows = 0
    for row in table.iter():
        if _local_name(row.tag) != "TR":
            continue
        rows += 1
        cells = [cell.text or "" for cell in row if _local_name(cell.tag) == "TD"]
        try:
            exposures.append(_exposure_from_row(cells, column, bucket))
        except (ValueError, KeyError, TypeError, IndexError) as exc:
            logger.debug("Row %d skipped: %s", rows, exc)
    skipped = rows - len(exposures)
    if rows and not exposures:
        raise UpstreamError(f"{_SERVICE} answered {rows} rows and none could be read")
    if skipped:
        logger.warning("%s: %d of %d rows skipped", _SERVICE, skipped, rows)
    return SiaResult(exposures=tuple(exposures), truncated=truncated, skipped=skipped)


def _pause_asked_by(response: httpx2.Response, default: float) -> float:
    """Pause the service asks for in its Retry-After header, when it gives seconds."""
    try:
        return float(response.headers.get("retry-after", ""))
    except ValueError:
        return default


class SiaArchive:
    """Finds the exposures that cover a position."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        *,
        url: str,
        collections: Sequence[str],
        bucket: str,
        radius_deg: float,
        timeout_s: float,
        budget_s: float,
        attempts: int,
        max_exposures: int,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._url = url
        self._collections = tuple(collections)
        self._bucket = bucket
        self._radius_deg = radius_deg
        self._timeout_s = timeout_s
        self._budget_s = budget_s
        self._attempts = attempts
        self._max_exposures = max_exposures
        self._sleep = sleep
        self._clock = clock
        # The same exposure can be published in two data releases: the first one listed wins.
        self._release_rank = {
            name.removeprefix(_COLLECTION_PREFIX): rank for rank, name in enumerate(collections)
        }

    async def find_exposures(self, ra: float, dec: float) -> list[Exposure]:
        """Exposures whose footprint lies within the search radius of the position."""
        payload = await self._fetch(ra, dec)
        result = parse_sia_response(payload, bucket=self._bucket)
        if result.truncated:
            logger.warning(
                "More than %d exposures near %.5f %.5f: the list is cut",
                self._max_exposures,
                ra,
                dec,
            )
        return self._without_duplicates(result.exposures)

    async def _fetch(self, ra: float, dec: float) -> bytes:
        """Ask the service, again if it is busy, within the time budget of one request.

        The archive usually answers in two seconds and sometimes in twenty. A long
        wait is therefore allowed, and the budget keeps the total below what the
        caller of this service accepts.
        """
        params = [("COLLECTION", name) for name in self._collections]
        params.append(("POS", f"circle {ra:.7f} {dec:.7f} {self._radius_deg:g}"))
        params.append(("MAXREC", str(self._max_exposures)))

        started = self._clock()
        reason = "no time left to ask"
        for attempt in range(1, self._attempts + 1):
            remaining = self._budget_s - (self._clock() - started)
            if remaining < _SHORTEST_ATTEMPT_S:
                break
            pause = min(_MAX_PAUSE_S, float(attempt))
            try:
                response = await self._client.get(
                    self._url, params=params, timeout=min(self._timeout_s, remaining)
                )
            except httpx2.TimeoutException:
                reason = "no answer within the time limit"
            except httpx2.TransportError as exc:
                reason = f"connection failed ({type(exc).__name__})"
            else:
                if response.status_code == 200:
                    return response.content
                if response.status_code not in _RETRYABLE_STATUSES:
                    raise UpstreamError(f"{_SERVICE} answered HTTP {response.status_code}")
                reason = f"HTTP {response.status_code}"
                pause = min(_MAX_PAUSE_S, _pause_asked_by(response, default=pause))
            logger.warning(
                "%s: attempt %d of %d failed: %s", _SERVICE, attempt, self._attempts, reason
            )
            if attempt < self._attempts:
                await self._sleep(pause)
        raise UpstreamUnavailable(_SERVICE, reason, retry_after_s=_CLIENT_RETRY_AFTER_S)

    def _without_duplicates(self, exposures: Sequence[Exposure]) -> list[Exposure]:
        last = len(self._release_rank)
        kept: dict[str, Exposure] = {}
        for exposure in exposures:
            current = kept.get(exposure.observation)
            if current is None or self._release_rank.get(
                exposure.collection, last
            ) < self._release_rank.get(current.collection, last):
                kept[exposure.observation] = exposure
        return list(kept.values())
