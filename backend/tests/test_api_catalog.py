"""GET /api/catalog: what other telescopes know in a view, as the contract writes it."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from spherex_explorer.api.app import create_app
from spherex_explorer.catalogs import CatalogSource, Cone, VizierCatalogs
from spherex_explorer.config import Settings
from spherex_explorer.errors import UpstreamError, UpstreamUnavailable

ORIGIN = "https://site.example"
HERE = {"ra": 269.4463, "dec": 4.7682, "epoch": 2026.0}
BARNARD = CatalogSource(
    id="Gaia DR3 4472832130942575872",
    ra=269.44850252544,
    dec=4.73942005111,
    magnitudes=(("G", 8.193974),),
    pm_ra=-801.551,
    pm_dec=10362.394,
    parallax=546.9759,
    parallax_error=0.0401,
)
SEEN_BY_WISE = CatalogSource(
    id="J175747.94+044323.8",
    ra=269.44977,
    dec=4.72328,
    magnitudes=(("W2", 3.658), ("W1", 4.358)),
)
FAR_AWAY = CatalogSource(id="far", ra=270.4, dec=4.7)


class FakeCatalogs:
    limit = 300

    def __init__(self, failure: Exception | None = None, complete: bool = True, delay_s=0.0):
        self.failure = failure
        self.complete = complete
        self.delay_s = delay_s
        self.asked: list[tuple[str, float, float, float]] = []

    async def around(self, catalog, ra, dec, radius_deg):
        self.asked.append((catalog.key, ra, dec, radius_deg))
        await asyncio.sleep(self.delay_s)
        if self.failure is not None:
            raise self.failure
        seen = (BARNARD, FAR_AWAY) if catalog.key == "gaia" else (SEEN_BY_WISE,)
        return Cone(seen, self.complete)


def make_client(catalogs, **settings) -> TestClient:
    app = create_app(
        Settings(_env_file=None, allowed_origins=ORIGIN, **settings), catalogs=catalogs
    )
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_answers_as_the_contract_writes_it():
    response = make_client(FakeCatalogs()).get(
        "/api/catalog", params=HERE, headers={"Origin": ORIGIN}
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=86400"
    assert response.headers["access-control-allow-origin"] == ORIGIN
    body = response.json()
    assert list(body) == ["view", "epoch", "catalogs"]
    assert body["view"] == {"ra": 269.4463, "dec": 4.7682, "fov_deg": 0.1}
    assert body["epoch"] == 2026.0
    gaia, allwise = body["catalogs"]
    assert list(gaia) == ["key", "name", "epoch", "band", "limit", "truncated", "sources"]
    assert (gaia["key"], gaia["name"], gaia["epoch"], gaia["band"]) == (
        "gaia",
        "Gaia DR3",
        2016.0,
        "G",
    )
    assert (gaia["limit"], gaia["truncated"]) == (300, False)
    # The source outside the view is left out.
    assert gaia["sources"] == [
        {
            "id": "Gaia DR3 4472832130942575872",
            "ra": 269.448503,
            "dec": 4.73942,
            "pm_ra": -801.551,
            "pm_dec": 10362.394,
            "parallax_mas": 546.976,
            "mags": {"G": 8.19},
        }
    ]
    assert (allwise["key"], allwise["name"], allwise["band"]) == ("allwise", "AllWISE", "W2")
    assert allwise["epoch"] == pytest.approx(2010.56)
    assert allwise["sources"] == [
        {
            "id": "J175747.94+044323.8",
            "ra": 269.44977,
            "dec": 4.72328,
            "pm_ra": None,
            "pm_dec": None,
            "parallax_mas": None,
            "mags": {"W2": 3.66, "W1": 4.36},
        }
    ]


def test_a_wider_view_is_asked_wider_and_a_full_catalog_says_so():
    catalogs = FakeCatalogs(complete=False)

    body = make_client(catalogs).get("/api/catalog", params={**HERE, "fov": 0.3}).json()

    assert body["view"]["fov_deg"] == 0.3
    assert all(catalog["truncated"] for catalog in body["catalogs"])
    assert min(asked[3] for asked in catalogs.asked) == pytest.approx(0.3 / 2**0.5)


def test_without_a_date_the_view_is_looked_at_today():
    body = make_client(FakeCatalogs()).get("/api/catalog", params={"ra": 10, "dec": 20}).json()

    assert 2026.8 < body["epoch"] < 2100


@pytest.mark.parametrize(
    "params",
    [
        {"dec": 4.7},
        {"ra": 360, "dec": 4.7},
        {"ra": 269.4, "dec": 91},
        {"ra": 269.4, "dec": 4.7, "fov": 5},
        {"ra": 269.4, "dec": 4.7, "epoch": 1500},
    ],
)
def test_invalid_request_is_refused(params):
    catalogs = FakeCatalogs()

    response = make_client(catalogs).get("/api/catalog", params=params)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert catalogs.asked == []


def test_silent_catalog_service_gives_a_503_that_names_the_catalogs():
    failure = UpstreamUnavailable(
        "The VizieR catalog service",
        "HTTP 502",
        retry_after_s=10,
        public="The catalog service did not answer. Try again in a moment.",
    )

    response = make_client(FakeCatalogs(failure=failure)).get("/api/catalog", params=HERE)

    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "upstream_unavailable",
            "message": "The catalog service did not answer. Try again in a moment.",
        }
    }
    assert response.headers["retry-after"] == "10"
    assert "VizieR" not in response.text


def test_catalog_service_that_never_answers_gives_a_503_instead_of_hanging():
    response = make_client(FakeCatalogs(delay_s=30), archive_budget_s=0.05).get(
        "/api/catalog", params=HERE
    )

    assert response.status_code == 503
    assert response.headers["retry-after"] == "10"
    assert "catalog service" in response.json()["error"]["message"]


def test_unusable_answer_of_the_catalog_service_is_an_internal_error_without_details():
    client = make_client(FakeCatalogs(failure=UpstreamError("answered other columns: pmDE")))

    response = client.get("/api/catalog", params=HERE)

    assert response.status_code == 500
    assert "pmDE" not in response.text


def test_application_opens_its_catalog_service_when_it_starts():
    app = create_app(Settings(_env_file=None, catalog_limit=50))
    assert app.state.catalogs is None

    with TestClient(app):
        assert isinstance(app.state.catalogs, VizierCatalogs)
        assert app.state.catalogs.limit == 50

    assert app.state.catalogs is None
