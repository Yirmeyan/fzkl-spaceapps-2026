import asyncio
import json
from datetime import UTC, datetime

import httpx2
import pytest

from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.marks import (
    FirestoreStore,
    MemoryStore,
    new_mark,
    separation_arcsec,
    sexagesimal,
)

TARGET = {"ra": 200.0, "dec": 30.0, "epoch": 2000.0, "pm_ra": 0.0, "pm_dec": 0.0}
VIEW = {"detector": 5, "pass": 2, "frame": None}
DOCUMENTS = "/v1/projects/my-project/databases/(default)/documents"


def a_mark(**changes) -> dict:
    values = {
        "ra": 200.01,
        "dec": 30.01,
        "category": "moved",
        "target": TARGET,
        "preset": None,
        "view": VIEW,
    }
    return new_mark(**{**values, **changes})


def test_a_place_is_written_as_astronomers_write_it():
    assert sexagesimal(269.984167, -24.976667) == "17h59m56.2s -24d58m36s"
    assert sexagesimal(0.0, 0.0) == "00h00m00.0s +00d00m00s"
    # Rounding up never writes sixty seconds or twenty-four hours.
    assert sexagesimal(359.99999, 89.99999) == "00h00m00.0s +90d00m00s"


def test_the_angle_between_two_places_counts_the_narrowing_of_the_sky_toward_the_poles():
    assert separation_arcsec(10.0, 0.0, 10.0, 0.001) == pytest.approx(3.6)
    assert separation_arcsec(10.001, 60.0, 10.0, 60.0) == pytest.approx(1.8, rel=1e-3)
    assert separation_arcsec(0.0005, 0.0, 359.9995, 0.0) == pytest.approx(3.6)


def test_a_mark_has_the_fields_of_an_entry_and_claims_nothing():
    mark = a_mark(now=datetime(2026, 11, 15, 3, 4, 5, tzinfo=UTC))
    assert list(mark)[:16] == [
        "id",
        "name",
        "source",
        "status",
        "kind",
        "method",
        "confidence",
        "significance",
        "ra",
        "dec",
        "epoch",
        "target",
        "preset",
        "found",
        "known",
        "measured",
    ]
    assert mark["source"] == "visitor"
    assert mark["status"] == "unconfirmed"
    assert mark["name"] == "Mark at 13h20m02.4s +30d00m36s"
    assert mark["shared"] == "2026-11-15T03:04:05Z"
    assert mark["category"] == "moved" and mark["view"] == VIEW
    for claim in ("kind", "method", "confidence", "significance", "found", "known", "measured"):
        assert mark[claim] is None


def test_each_mark_has_its_own_identifier():
    assert a_mark()["id"] != a_mark()["id"]
    assert a_mark()["id"].startswith("v-")


def test_a_mark_made_in_the_synthetic_field_says_so():
    assert a_mark(preset="synthetic-planet-x")["status"] == "synthetic"
    assert a_mark(preset="barnards-star")["status"] == "unconfirmed"


def test_the_memory_store_gives_back_what_it_was_given():
    async def run():
        store = MemoryStore()
        old = a_mark(now=datetime(2026, 11, 15, 3, 0, 0, tzinfo=UTC))
        new = a_mark(ra=200.02, now=datetime(2026, 11, 15, 4, 0, 0, tzinfo=UTC))
        await store.add(old)
        await store.add(new)
        return old, new, await store.marks(), await store.marks(since=new["shared"])

    old, new, marks, since = asyncio.run(run())
    assert marks == [old, new]
    assert since == [new]


class Google:
    """What the two addresses of Google answer, and what they were asked."""

    def __init__(self, rows=None, token_status=200, status=200, token=None):
        self.rows = rows if rows is not None else [{"readTime": "2026-11-15T00:00:00Z"}]
        self.token_status = token_status
        self.status = status
        self.token = token or {"access_token": "abc", "expires_in": 3600}
        self.asked: list[httpx2.Request] = []
        self.tokens = 0

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        self.asked.append(request)
        if request.url.host == "metadata.test":
            self.tokens += 1
            return httpx2.Response(self.token_status, json=self.token)
        if self.status != 200:
            return httpx2.Response(self.status, json={"error": {"message": "no"}})
        if request.url.path.endswith(":runQuery"):
            return httpx2.Response(200, json=self.rows)
        return httpx2.Response(200, json={"name": "created"})


def with_store(google: Google, work, clock=None):
    async def run():
        transport = httpx2.MockTransport(google.handle)
        async with httpx2.AsyncClient(transport=transport) as client:
            options = {"clock": clock} if clock else {}
            store = FirestoreStore(
                client,
                project="my-project",
                collection="marks",
                timeout_s=2.0,
                token_url="http://metadata.test/token",
                base_url="https://firestore.test/v1",
                **options,
            )
            return await work(store)

    return asyncio.run(run())


def row(mark) -> dict:
    return {"document": {"fields": {"mark": {"stringValue": json.dumps(mark)}}}}


def test_a_mark_is_written_as_one_document_under_its_identifier():
    google = Google()
    mark = a_mark()
    with_store(google, lambda store: store.add(mark))
    token, written = google.asked
    assert token.headers["Metadata-Flavor"] == "Google"
    assert written.method == "POST"
    assert written.url.path == f"{DOCUMENTS}/marks"
    assert written.url.params["documentId"] == mark["id"]
    assert written.headers["Authorization"] == "Bearer abc"
    fields = json.loads(written.content)["fields"]
    assert json.loads(fields["mark"]["stringValue"]) == mark
    # The moment it was shared is beside it, for the store to sort and filter on.
    assert fields["shared"] == {"stringValue": mark["shared"]}


def test_the_whole_journal_is_one_question_to_the_store():
    first, second = a_mark(), a_mark(ra=200.02)
    google = Google(rows=[row(first), row(second)])
    assert with_store(google, lambda store: store.marks()) == [first, second]
    asked = google.asked[-1]
    assert asked.method == "POST" and asked.url.path == f"{DOCUMENTS}:runQuery"
    query = json.loads(asked.content)["structuredQuery"]
    assert query["from"] == [{"collectionId": "marks"}]
    assert "where" not in query


def test_what_is_new_is_asked_since_a_moment():
    google = Google()
    marks = with_store(google, lambda store: store.marks(since="2026-11-15T03:04:05Z"))
    assert marks == []
    query = json.loads(google.asked[-1].content)["structuredQuery"]
    assert query["where"] == {
        "fieldFilter": {
            "field": {"fieldPath": "shared"},
            "op": "GREATER_THAN_OR_EQUAL",
            "value": {"stringValue": "2026-11-15T03:04:05Z"},
        }
    }


def test_an_empty_database_holds_no_mark():
    assert with_store(Google(), lambda store: store.marks()) == []


@pytest.mark.parametrize(
    "other",
    [
        {"document": {"fields": {"other": {}}}},
        {"document": {"fields": {"mark": {"stringValue": "not json"}}}},
        row([1, 2]),
        row({"id": "v-1", "shared": "2026-11-15T00:00:00Z", "ra": "east", "dec": 1.0}),
        row({"id": "v-1", "ra": 1.0, "dec": 1.0}),
    ],
    ids=["no mark", "not json", "a list", "a place in words", "no moment"],
)
def test_a_document_that_is_not_a_mark_is_left_out(other):
    mark = a_mark()
    google = Google(rows=[row(mark), other])
    assert with_store(google, lambda store: store.marks()) == [mark]


def test_the_token_is_asked_once_and_again_when_it_ends():
    google = Google()
    now = [0.0]

    async def work(store):
        await store.marks()
        await store.marks()
        now[0] = 3600.0
        await store.marks()

    with_store(google, work, clock=lambda: now[0])
    assert google.tokens == 2


@pytest.mark.parametrize(
    "google",
    [Google(status=403), Google(token_status=404), Google(token={"no": "token"})],
    ids=["refused", "no token service", "no token"],
)
def test_a_store_that_does_not_answer_is_an_upstream_failure(google):
    with pytest.raises(UpstreamUnavailable) as raised:
        with_store(google, lambda store: store.marks())
    assert raised.value.retry_after_s == 5
    assert "journal" in raised.value.public


def test_a_store_that_cannot_be_reached_is_an_upstream_failure():
    def refuse(request):
        raise httpx2.ConnectError("no route")

    google = Google()
    google.handle = refuse
    with pytest.raises(UpstreamUnavailable):
        with_store(google, lambda store: store.add(a_mark()))
