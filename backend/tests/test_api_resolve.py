import asyncio

import pytest
from fastapi.testclient import TestClient

from spherex_explorer.api.app import create_app
from spherex_explorer.config import Settings
from spherex_explorer.errors import NotFound, UpstreamError, UpstreamUnavailable
from spherex_explorer.targets import ResolvedTarget, SesameResolver, clean_name

ORIGIN = "https://site.example"
BARNARD = ResolvedTarget(
    name="Barnard's Star",
    ra=269.4520769586187,
    dec=4.69336496657667,
    epoch=2000.0,
    pm_ra=-801.551,
    pm_dec=10362.394,
)


class FakeResolver:
    def __init__(self, target: ResolvedTarget | None = None, failure: Exception | None = None):
        self.target = target
        self.failure = failure
        self.asked: list[str] = []

    async def resolve(self, name: str) -> ResolvedTarget:
        self.asked.append(clean_name(name))
        if self.failure is not None:
            raise self.failure
        return self.target


def make_client(resolver, **settings) -> TestClient:
    app = create_app(
        Settings(_env_file=None, allowed_origins=ORIGIN, **settings), resolver=resolver
    )
    return TestClient(app, raise_server_exceptions=False)


def test_answer_is_the_target_of_the_contract():
    response = make_client(FakeResolver(BARNARD)).get(
        "/api/resolve", params={"name": "Barnard's Star"}
    )

    assert response.status_code == 200
    assert response.json() == {
        "name": "Barnard's Star",
        "ra": 269.452077,
        "dec": 4.693365,
        "epoch": 2000.0,
        "pm_ra": -801.551,
        "pm_dec": 10362.394,
    }
    assert list(response.json()) == ["name", "ra", "dec", "epoch", "pm_ra", "pm_dec"]
    assert response.headers["cache-control"] == "public, max-age=86400"


def test_name_in_the_answer_is_the_one_that_was_asked():
    resolver = FakeResolver(BARNARD)

    body = make_client(resolver).get("/api/resolve", params={"name": "  gj   699 "}).json()

    assert body["name"] == "gj 699"
    assert resolver.asked == ["gj 699"]


def test_unknown_proper_motion_is_null():
    galaxy = ResolvedTarget(
        name="M31", ra=10.684708, dec=41.26875, epoch=2000.0, pm_ra=None, pm_dec=None
    )

    body = make_client(FakeResolver(galaxy)).get("/api/resolve", params={"name": "M31"}).json()

    assert body["pm_ra"] is None and body["pm_dec"] is None


@pytest.mark.parametrize("params", [{}, {"name": ""}, {"name": "   "}, {"name": "x" * 101}])
def test_missing_or_impossible_name_is_refused(params):
    response = make_client(FakeResolver(BARNARD)).get("/api/resolve", params=params)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_name_with_a_control_character_is_refused():
    response = make_client(FakeResolver(BARNARD)).get("/api/resolve", params={"name": "bell\x07"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_unknown_name_is_not_found_in_the_words_of_the_contract():
    failure = NotFound("no object named 'zzqq'", public="No object is known under this name.")
    client = make_client(FakeResolver(failure=failure))

    response = client.get("/api/resolve", params={"name": "zzqq"}, headers={"Origin": ORIGIN})

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "not_found", "message": "No object is known under this name."}
    }
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_silent_resolver_gives_a_503_the_browser_can_read():
    failure = UpstreamUnavailable("The CDS name resolver", "HTTP 503", retry_after_s=10)

    response = make_client(FakeResolver(failure=failure)).get(
        "/api/resolve", params={"name": "Vega"}
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_unavailable"
    assert response.headers["retry-after"] == "10"
    assert "CDS" not in response.text


def test_resolver_that_never_answers_gives_a_503_instead_of_hanging():
    class Slow:
        async def resolve(self, name):
            await asyncio.sleep(30)

    response = make_client(Slow(), archive_budget_s=0.05).get(
        "/api/resolve", params={"name": "Vega"}
    )

    assert response.status_code == 503
    assert response.headers["retry-after"] == "10"


def test_unusable_answer_of_the_resolver_is_an_internal_error_without_details():
    client = make_client(FakeResolver(failure=UpstreamError("did not answer XML: line 3")))

    response = client.get("/api/resolve", params={"name": "Vega"})

    assert response.status_code == 500
    assert "XML" not in response.text


def test_application_opens_its_name_resolver_when_it_starts():
    app = create_app(Settings(_env_file=None))
    assert app.state.resolver is None

    with TestClient(app):
        assert isinstance(app.state.resolver, SesameResolver)

    assert app.state.resolver is None


@pytest.mark.parametrize(
    ("typed", "asked"),
    [
        ("WISE 0855", "WISE J085510.83-071442.5"),
        ("wise 0855-0714", "WISE J085510.83-071442.5"),
        ("W0855", "WISE J085510.83-071442.5"),
        ("Barnard", "Barnard's Star"),
        ("barnards  star", "Barnard's Star"),
        # Typed on a phone: the apostrophe is the curly one.
        ("Barnard\u2019s Star", "Barnard's Star"),
        ("Epsilon Indi Ba", "eps Ind B"),
    ],
)
def test_an_everyday_name_of_a_test_target_is_asked_under_its_catalog_name(typed, asked):
    resolver = FakeResolver(BARNARD)
    response = make_client(resolver).get("/api/resolve", params={"name": typed})

    assert response.status_code == 200
    assert resolver.asked == [clean_name(asked)]
    # The answer keeps the name the visitor typed.
    assert response.json()["name"] == " ".join(typed.split())


def test_any_other_name_is_asked_as_it_was_typed():
    resolver = FakeResolver(BARNARD)
    make_client(resolver).get("/api/resolve", params={"name": "Luhman 16"})
    make_client(resolver).get("/api/resolve", params={"name": "Barnard 68"})

    assert resolver.asked == [clean_name("Luhman 16"), clean_name("Barnard 68")]
