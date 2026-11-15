"""Routes of the public journal: the marks visitors shared, as docs/api-contract.md describes."""

import hashlib
import time
from collections import deque
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from spherex_explorer.archive import InvalidExposure, key_from_id
from spherex_explorer.config import Settings
from spherex_explorer.journal import JOURNAL_FIELDS
from spherex_explorer.marks import MarkStore, new_mark, separation_arcsec

router = APIRouter(tags=["journal"])

# The list of a process is good for this long: then the store is asked what is new. A
# visitor who has just shared a mark sees it at once, and the others a few seconds later.
_FRESH_S = 20.0
_CACHE_CONTROL = "public, max-age=20"
# The whole journal is read again this often, so that a mark removed by hand goes away.
_WHOLE_S = 3 * 3600.0
# Two marks of one category this close to each other, in arcseconds, are the same mark.
_SAME_MARK = 10.0
# A mark must be inside the view it was made in: half the diagonal of the widest view.
_FARTHEST_FROM_TARGET = 0.36 * 3600.0
_HOUR_S = 3600.0
_MAX_PROPER_MOTION = 20000.0
_PRESETS = frozenset(field.preset for field in JOURNAL_FIELDS if field.preset)


class TargetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    epoch: float = Field(default=2000.0, ge=1900, le=2100)
    pm_ra: float = Field(default=0.0, ge=-_MAX_PROPER_MOTION, le=_MAX_PROPER_MOTION)
    pm_dec: float = Field(default=0.0, ge=-_MAX_PROPER_MOTION, le=_MAX_PROPER_MOTION)


class MarkIn(BaseModel):
    """What a visitor shares: numbers and choices in short lists, and no text of their own."""

    model_config = ConfigDict(extra="forbid")

    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    category: Literal["moved", "changed", "appears-once", "other"]
    target: TargetIn
    preset: str | None = None
    detector: int | None = Field(default=None, ge=1, le=6)
    # "pass" is a reserved word in Python, so the field carries the name through an alias.
    pass_number: int | None = Field(default=None, ge=1, le=99, alias="pass")
    frame: str | None = None

    @field_validator("preset")
    @classmethod
    def _known_preset(cls, value: str | None) -> str | None:
        if value is not None and value not in _PRESETS:
            raise ValueError("should be the key of a static target")
        return value

    @field_validator("frame")
    @classmethod
    def _an_exposure(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            key_from_id(value)
        except InvalidExposure as exc:
            raise ValueError("should be the identifier of an exposure") from exc
        return value


class Journal:
    """The marks of the journal, with the rules that keep it clean.

    One per process. It remembers the list of the store for a few seconds, and how
    many marks each visitor shared within the hour. A visitor is known by a digest of
    the address the request came from, kept in memory only and never written anywhere.
    """

    def __init__(self, store: MarkStore, settings: Settings, clock=time.monotonic) -> None:
        self.store = store
        self.settings = settings
        self._clock = clock
        self._marks: dict[str, dict] | None = None
        self._listed: list[dict] = []
        self._asked_at = 0.0
        self._whole_at = 0.0
        self._shared: dict[str, deque[float]] = {}

    def _keep(self, marks: list[dict]) -> None:
        for mark in marks:
            self._marks[mark["id"]] = mark
        # Of two marks shared within the same second, the one learned last comes first.
        learned = reversed(list(self._marks.values()))
        self._listed = sorted(learned, key=lambda mark: mark["shared"], reverse=True)

    async def marks(self) -> list[dict]:
        """The marks, the newest first."""
        now = self._clock()
        if self._marks is None or now - self._whole_at > _WHOLE_S:
            found = await self.store.marks()
            self._marks = {}
            self._keep(found)
            self._whole_at = self._asked_at = now
        elif now - self._asked_at > _FRESH_S:
            # Marks shared within the same second as the newest known come back too.
            newest = self._listed[0]["shared"] if self._listed else None
            self._keep(await self.store.marks(since=newest))
            self._asked_at = now
        return self._listed

    def wait_s(self, visitor: str) -> int:
        """Seconds a visitor must wait before sharing again. Zero when they may share now."""
        now = self._clock()
        recent = self._shared.setdefault(visitor, deque())
        while recent and now - recent[0] >= _HOUR_S:
            recent.popleft()
        if len(recent) < self.settings.journal_per_hour:
            return 0
        return max(1, round(_HOUR_S - (now - recent[0])))

    async def add(self, visitor: str, mark: dict) -> None:
        await self.store.add(mark)
        self._shared.setdefault(visitor, deque()).append(self._clock())
        if self._marks is not None:
            self._keep([mark])


def get_journal(request: Request) -> Journal:
    """The journal of the running application."""
    return request.app.state.journal


def _visitor(request: Request) -> str:
    """A digest of where the request came from.

    Cloud Run adds the address to the end of a header: what stands before it was sent
    by the caller, who could write anything there, so only the last one is read.
    """
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
    address = forwarded or (request.client.host if request.client else "")
    return hashlib.sha256(address.encode()).hexdigest()


def _refused(status: int, code: str, message: str, wait_s: int | None = None) -> JSONResponse:
    headers = {"Retry-After": str(wait_s)} if wait_s is not None else None
    return JSONResponse(
        status_code=status, content={"error": {"code": code, "message": message}}, headers=headers
    )


class JournalOut(BaseModel):
    open: bool
    limit: int
    per_hour: int
    entries: list[dict]


@router.get("/journal", response_model=JournalOut)
async def read_journal(
    response: Response, journal: Annotated[Journal, Depends(get_journal)]
) -> JournalOut:
    marks = await journal.marks()
    settings = journal.settings
    response.headers["Cache-Control"] = _CACHE_CONTROL
    return JournalOut(
        open=settings.journal_open and len(marks) < settings.journal_limit,
        limit=settings.journal_limit,
        per_hour=settings.journal_per_hour,
        entries=marks,
    )


@router.post("/journal", status_code=201)
async def share_mark(
    request: Request, shared: MarkIn, journal: Annotated[Journal, Depends(get_journal)]
) -> JSONResponse:
    settings = journal.settings
    if not settings.journal_open:
        return _refused(503, "journal_closed", "The journal takes no new mark for now.")
    target = shared.target
    if separation_arcsec(shared.ra, shared.dec, target.ra, target.dec) > _FARTHEST_FROM_TARGET:
        return _refused(422, "invalid_request", "The mark is outside the view of its target.")
    marks = await journal.marks()
    for mark in marks:
        same_place = separation_arcsec(shared.ra, shared.dec, mark["ra"], mark["dec"]) <= _SAME_MARK
        if same_place and mark.get("category") == shared.category:
            # Someone marked this place already: the journal keeps one mark of it.
            return JSONResponse(status_code=200, content=mark)
    if len(marks) >= settings.journal_limit:
        return _refused(409, "journal_full", "The journal is full: it takes no new mark.")
    visitor = _visitor(request)
    wait_s = journal.wait_s(visitor)
    if wait_s:
        return _refused(
            429,
            "too_many_marks",
            f"{settings.journal_per_hour} marks an hour at most. Try again later.",
            wait_s,
        )
    mark = new_mark(
        ra=shared.ra,
        dec=shared.dec,
        category=shared.category,
        target=target.model_dump(),
        preset=shared.preset,
        view={"detector": shared.detector, "pass": shared.pass_number, "frame": shared.frame},
    )
    await journal.add(visitor, mark)
    return JSONResponse(status_code=201, content=mark)
