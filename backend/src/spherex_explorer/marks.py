"""Marks: places of the sky that visitors shared, kept in the public journal.

A mark is a place, a category chosen in a short list, and the view it was made in. It
holds no text a visitor wrote, no name and no address: nothing in it can insult anyone,
and nothing in it tells who made it. A mark is not a claim of the service either. It
says that someone saw something there: the field is measured when a mark is opened.
"""

import json
import logging
import math
import secrets
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

import httpx2

from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.journal import SYNTHETIC, UNCONFIRMED

logger = logging.getLogger(__name__)

# What a visitor says of a mark: one of these, and nothing else.
CATEGORIES = ("moved", "changed", "appears-once", "other")
VISITOR = "visitor"
# The static target whose field holds a made-up body: a mark made there says so.
SYNTHETIC_PRESETS = frozenset({"synthetic-planet-x"})
_HOURS_PER_DEGREE = 1 / 15
_ARCSEC_PER_DEGREE = 3600.0
# Seconds a client is asked to wait when the store of the marks does not answer.
_RETRY_AFTER_S = 5
_STORE = "The store of the journal"
_PUBLIC = "The journal did not answer. Try again in a moment."
# Google answers these two addresses: the first from inside its own machines only.
TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
)
FIRESTORE_URL = "https://firestore.googleapis.com/v1"
# A token is asked again this many seconds before it ends.
_TOKEN_MARGIN_S = 60.0
# Most marks one question to the store brings back.
_MOST = 5000


def sexagesimal(ra: float, dec: float) -> str:
    """A place as astronomers write it: 17h59m56.2s -24d58m36s."""
    hours = (ra % 360.0) * _HOURS_PER_DEGREE
    tenths = round(hours * 36000)
    h, rest = divmod(tenths, 36000)
    m, s = divmod(rest, 600)
    sign = "-" if dec < 0 else "+"
    seconds = round(abs(dec) * _ARCSEC_PER_DEGREE)
    d, rest = divmod(seconds, 3600)
    arcmin, arcsec = divmod(rest, 60)
    return f"{h % 24:02d}h{m:02d}m{s / 10:04.1f}s {sign}{d:02d}d{arcmin:02d}m{arcsec:02d}s"


def separation_arcsec(ra: float, dec: float, other_ra: float, other_dec: float) -> float:
    """Angle between two places close to each other, in arcseconds."""
    east = ((ra - other_ra + 180.0) % 360.0 - 180.0) * math.cos(math.radians(dec))
    return math.hypot(east, dec - other_dec) * _ARCSEC_PER_DEGREE


def new_mark(
    *,
    ra: float,
    dec: float,
    category: str,
    target: dict,
    preset: str | None,
    view: dict,
    now: datetime | None = None,
) -> dict:
    """A mark as the journal lists it, with the fields of an entry of the team.

    What the service would say of the place is left empty: nothing was measured.
    """
    shared = (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "id": f"v-{secrets.token_hex(5)}",
        "name": f"Mark at {sexagesimal(ra, dec)}",
        "source": VISITOR,
        "status": SYNTHETIC if preset in SYNTHETIC_PRESETS else UNCONFIRMED,
        "kind": None,
        "method": None,
        "confidence": None,
        "significance": None,
        "ra": ra,
        "dec": dec,
        "epoch": None,
        "target": target,
        "preset": preset,
        "found": None,
        "known": None,
        "measured": None,
        "category": category,
        "view": view,
        "shared": shared,
    }


def _checked(mark: object) -> None:
    """Raise when what the store holds does not have what the journal reads of a mark."""
    if not isinstance(mark, dict):
        raise TypeError("not an object")
    for name, kind in (("id", str), ("shared", str), ("ra", (int, float)), ("dec", (int, float))):
        if not isinstance(mark[name], kind):
            raise TypeError(f"{name} is not a {kind}")


class MarkStore(Protocol):
    """Where the marks are kept."""

    async def marks(self, since: str | None = None) -> list[dict]:
        """The marks, or those shared at `since` or later, in no promised order."""
        ...

    async def add(self, mark: dict) -> None: ...


class MemoryStore:
    """Marks kept in the memory of the process: for the tests, and for a machine with no store.

    They are lost when the process stops, and another process does not see them.
    """

    def __init__(self) -> None:
        self._marks: list[dict] = []

    async def marks(self, since: str | None = None) -> list[dict]:
        return [mark for mark in self._marks if since is None or mark["shared"] >= since]

    async def add(self, mark: dict) -> None:
        self._marks.append(mark)


class FirestoreStore:
    """Marks kept in a Firestore database of Google Cloud, one document for each.

    The service runs on Cloud Run, whose machines hand it a token for its own account:
    no key is stored anywhere. A document holds the mark as one text, so that the shape
    of a mark can change without touching the database, and the moment it was shared
    beside it: the store is asked for what is new since a moment, which costs one read
    when nothing is, where reading the whole journal would cost one read for each mark.
    """

    def __init__(
        self,
        client: httpx2.AsyncClient,
        *,
        project: str,
        collection: str,
        timeout_s: float,
        token_url: str = TOKEN_URL,
        base_url: str = FIRESTORE_URL,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._documents = f"{base_url}/projects/{project}/databases/(default)/documents"
        self._collection = collection
        self._timeout_s = timeout_s
        self._token_url = token_url
        self._clock = clock
        self._token: str | None = None
        self._token_until = 0.0

    async def _ask(self, method: str, url: str, **options) -> httpx2.Response:
        try:
            response = await self._client.request(method, url, timeout=self._timeout_s, **options)
        except httpx2.HTTPError as exc:
            raise UpstreamUnavailable(
                _STORE, type(exc).__name__, retry_after_s=_RETRY_AFTER_S, public=_PUBLIC
            ) from exc
        if response.status_code != 200:
            raise UpstreamUnavailable(
                _STORE,
                f"HTTP {response.status_code}",
                retry_after_s=_RETRY_AFTER_S,
                public=_PUBLIC,
            )
        return response

    async def _headers(self) -> dict[str, str]:
        if self._token is None or self._clock() >= self._token_until:
            response = await self._ask(
                "GET", self._token_url, headers={"Metadata-Flavor": "Google"}
            )
            try:
                answer = response.json()
                self._token = str(answer["access_token"])
                lasts = float(answer["expires_in"])
            except (ValueError, KeyError, TypeError) as exc:
                raise UpstreamUnavailable(
                    _STORE, "no token", retry_after_s=_RETRY_AFTER_S, public=_PUBLIC
                ) from exc
            self._token_until = self._clock() + lasts - _TOKEN_MARGIN_S
        return {"Authorization": f"Bearer {self._token}"}

    async def marks(self, since: str | None = None) -> list[dict]:
        query: dict = {
            "from": [{"collectionId": self._collection}],
            "orderBy": [{"field": {"fieldPath": "shared"}}],
            "limit": _MOST,
        }
        if since is not None:
            query["where"] = {
                "fieldFilter": {
                    "field": {"fieldPath": "shared"},
                    "op": "GREATER_THAN_OR_EQUAL",
                    "value": {"stringValue": since},
                }
            }
        response = await self._ask(
            "POST",
            f"{self._documents}:runQuery",
            json={"structuredQuery": query},
            headers=await self._headers(),
        )
        try:
            rows = response.json()
        except ValueError as exc:
            raise UpstreamUnavailable(
                _STORE, "not JSON", retry_after_s=_RETRY_AFTER_S, public=_PUBLIC
            ) from exc
        found: list[dict] = []
        for row in rows if isinstance(rows, list) else []:
            # A question with no answer comes back as one row with no document.
            if not isinstance(row, dict) or "document" not in row:
                continue
            try:
                mark = json.loads(row["document"]["fields"]["mark"]["stringValue"])
                _checked(mark)
            except (ValueError, KeyError, TypeError) as exc:
                # A document that is not a mark: someone wrote in the database by hand.
                logger.warning("A document of the journal cannot be read: %r", exc)
                continue
            found.append(mark)
        return found

    async def add(self, mark: dict) -> None:
        body = {
            "fields": {
                "mark": {"stringValue": json.dumps(mark, separators=(",", ":"))},
                "shared": {"stringValue": mark["shared"]},
            }
        }
        await self._ask(
            "POST",
            f"{self._documents}/{self._collection}",
            params={"documentId": mark["id"]},
            json=body,
            headers=await self._headers(),
        )
