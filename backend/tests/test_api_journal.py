import asyncio
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from spherex_explorer.api.app import create_app
from spherex_explorer.api.journal import Journal
from spherex_explorer.config import Settings
from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.marks import MemoryStore, new_mark

ORIGIN = "https://site.example"
FRAME = "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229"


def make_client(store=None, **settings) -> TestClient:
    app = create_app(
        Settings(_env_file=None, allowed_origins=ORIGIN, **settings), marks=store or MemoryStore()
    )
    return TestClient(app, raise_server_exceptions=False)


def a_mark(**changes) -> dict:
    mark = {
        "ra": 200.01,
        "dec": 30.01,
        "category": "moved",
        "target": {"ra": 200.0, "dec": 30.0},
        "detector": 5,
        "pass": 2,
        "frame": FRAME,
    }
    mark.update(changes)
    return {key: value for key, value in mark.items() if value is not ...}


def test_an_empty_journal_is_open_and_says_its_limits():
    response = make_client().get("/api/journal")
    assert response.status_code == 200
    assert response.json() == {"open": True, "limit": 300, "per_hour": 5, "entries": []}
    assert response.headers["cache-control"] == "public, max-age=20"


def test_a_shared_mark_is_listed_at_once():
    client = make_client()
    response = client.post("/api/journal", json=a_mark())
    assert response.status_code == 201
    mark = response.json()
    assert mark["source"] == "visitor" and mark["status"] == "unconfirmed"
    assert mark["category"] == "moved"
    assert mark["target"] == {
        "ra": 200.0,
        "dec": 30.0,
        "epoch": 2000.0,
        "pm_ra": 0.0,
        "pm_dec": 0.0,
    }
    assert mark["view"] == {"detector": 5, "pass": 2, "frame": FRAME}
    assert mark["kind"] is None and mark["found"] is None
    assert client.get("/api/journal").json()["entries"] == [mark]


def test_the_newest_mark_comes_first():
    client = make_client()
    first = client.post("/api/journal", json=a_mark()).json()
    second = client.post("/api/journal", json=a_mark(ra=200.05)).json()
    assert [mark["id"] for mark in client.get("/api/journal").json()["entries"]] == [
        second["id"],
        first["id"],
    ]


def test_a_mark_needs_nothing_of_the_view():
    response = make_client().post(
        "/api/journal", json=a_mark(detector=..., frame=..., **{"pass": ...})
    )
    assert response.status_code == 201
    assert response.json()["view"] == {"detector": None, "pass": None, "frame": None}


def test_a_mark_of_the_synthetic_field_says_so():
    mark = a_mark(
        ra=199.99,
        dec=29.995,
        target={"ra": 199.990528, "dec": 29.994922},
        preset="synthetic-planet-x",
    )
    response = make_client().post("/api/journal", json=mark)
    assert response.status_code == 201
    assert response.json()["status"] == "synthetic"
    assert response.json()["preset"] == "synthetic-planet-x"


@pytest.mark.parametrize(
    "changes",
    [
        {"note": "hello"},
        {"name": "Planet X"},
        {"category": "alien"},
        {"ra": 360.0},
        {"dec": -91.0},
        {"detector": 7},
        {"pass": 0},
        {"frame": "../../etc/passwd"},
        {"preset": "not-a-target"},
        {"target": {"ra": 200.0, "dec": 30.0, "name": "mine"}},
        {"target": {"ra": 200.0}},
        {"category": ...},
    ],
    ids=lambda changes: next(iter(changes)),
)
def test_what_is_not_a_mark_is_refused(changes):
    client = make_client()
    response = client.post("/api/journal", json=a_mark(**changes))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert client.get("/api/journal").json()["entries"] == []


def test_a_mark_outside_the_view_of_its_target_is_refused():
    response = make_client().post("/api/journal", json=a_mark(dec=31.0))
    assert response.status_code == 422
    assert "outside the view" in response.json()["error"]["message"]


def test_the_same_place_is_marked_once():
    client = make_client()
    first = client.post("/api/journal", json=a_mark())
    again = client.post("/api/journal", json=a_mark(dec=30.0105))
    assert again.status_code == 200
    assert again.json() == first.json()
    assert len(client.get("/api/journal").json()["entries"]) == 1


def test_the_same_place_under_another_category_is_another_mark():
    client = make_client()
    client.post("/api/journal", json=a_mark())
    assert client.post("/api/journal", json=a_mark(category="changed")).status_code == 201
    assert len(client.get("/api/journal").json()["entries"]) == 2


def test_a_visitor_shares_so_many_marks_an_hour():
    client = make_client(journal_per_hour=2)
    for step in (1, 2):
        assert client.post("/api/journal", json=a_mark(ra=200.0 + step * 0.01)).status_code == 201
    response = client.post("/api/journal", json=a_mark(ra=200.05))
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "too_many_marks"
    assert 0 < int(response.headers["retry-after"]) <= 3600
    # Another visitor is not held back: Cloud Run names the address in a header.
    other = client.post(
        "/api/journal", json=a_mark(ra=200.05), headers={"X-Forwarded-For": "203.0.113.7"}
    )
    assert other.status_code == 201
    # The start of the header is written by the caller: it does not make a new visitor.
    for made_up in ("198.51.100.1", "198.51.100.2"):
        client.post(
            "/api/journal",
            json=a_mark(ra=200.07),
            headers={"X-Forwarded-For": f"{made_up}, 203.0.113.7"},
        )
    again = client.post(
        "/api/journal",
        json=a_mark(ra=200.09),
        headers={"X-Forwarded-For": "198.51.100.3, 203.0.113.7"},
    )
    assert again.status_code == 429


def test_a_full_journal_takes_no_new_mark():
    client = make_client(journal_limit=1)
    client.post("/api/journal", json=a_mark())
    response = client.post("/api/journal", json=a_mark(ra=200.05))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "journal_full"
    assert client.get("/api/journal").json()["open"] is False


def test_a_closed_journal_is_still_read():
    store = MemoryStore()
    make_client(store).post("/api/journal", json=a_mark())
    client = make_client(store, journal_open=False)
    response = client.post("/api/journal", json=a_mark(ra=200.05))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "journal_closed"
    journal = client.get("/api/journal").json()
    assert journal["open"] is False and len(journal["entries"]) == 1


class Silent:
    async def marks(self, since=None):
        raise UpstreamUnavailable("The store of the journal", "HTTP 503", retry_after_s=5)

    async def add(self, mark):
        raise AssertionError("nothing is written when the store cannot be read")


def test_a_store_that_does_not_answer_is_said_plainly():
    client = make_client(Silent())
    for response in (client.get("/api/journal"), client.post("/api/journal", json=a_mark())):
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "upstream_unavailable"
        assert response.headers["retry-after"] == "5"


def test_a_page_of_the_site_may_share_a_mark():
    response = make_client().options(
        "/api/journal",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert "POST" in response.headers["access-control-allow-methods"]
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_nothing_of_the_visitor_is_kept_in_a_mark():
    client = make_client()
    mark = client.post(
        "/api/journal", json=a_mark(), headers={"X-Forwarded-For": "203.0.113.7"}
    ).json()
    assert "203.0.113.7" not in str(mark)
    assert set(mark) == {
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
        "category",
        "view",
        "shared",
    }


class Counted(MemoryStore):
    """A store that remembers what it was asked."""

    def __init__(self):
        super().__init__()
        self.asked = []

    async def marks(self, since=None):
        self.asked.append(since)
        return await super().marks(since)


def shared_at(second: int, ra: float = 200.01) -> dict:
    return new_mark(
        ra=ra,
        dec=30.0,
        category="moved",
        target={"ra": 200.0, "dec": 30.0},
        preset=None,
        view={},
        now=datetime(2026, 11, 15, 3, 0, second, tzinfo=UTC),
    )


def test_the_store_is_asked_for_what_is_new_and_not_for_the_whole_journal_again():
    async def run():
        store = Counted()
        now = [0.0]
        journal = Journal(store, Settings(_env_file=None), clock=lambda: now[0])
        first = shared_at(1)
        await store.add(first)
        assert await journal.marks() == [first]
        # Within the freshness of the list, the store is left alone.
        now[0] = 10.0
        await journal.marks()
        assert store.asked == [None]
        # Another process shared two marks, one of them within the same second.
        twin, later = shared_at(1, ra=200.02), shared_at(7, ra=200.03)
        await store.add(twin)
        await store.add(later)
        now[0] = 31.0
        listed = await journal.marks()
        assert store.asked == [None, first["shared"]]
        assert listed[0]["id"] == later["id"]
        assert {mark["id"] for mark in listed} == {first["id"], twin["id"], later["id"]}
        # After a few hours the whole journal is read again: a mark removed by hand goes.
        store._marks.remove(twin)
        now[0] = 31.0 + 3 * 3600 + 1
        listed = await journal.marks()
        assert store.asked[-1] is None
        assert {mark["id"] for mark in listed} == {first["id"], later["id"]}

    asyncio.run(run())
