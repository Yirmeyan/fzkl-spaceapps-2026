import asyncio

import pytest
from fastapi.testclient import TestClient

from conftest import BARNARD
from spherex_explorer.api.app import create_app
from spherex_explorer.archive import Exposure, SiaArchive, parse_sia_response
from spherex_explorer.config import Settings
from spherex_explorer.errors import UpstreamError, UpstreamUnavailable

ORIGIN = "https://site.example"


class FakeArchive:
    def __init__(self, exposures=(), failure: Exception | None = None):
        self.exposures = list(exposures)
        self.failure = failure

    async def find_exposures(self, ra: float, dec: float) -> list[Exposure]:
        if self.failure is not None:
            raise self.failure
        return list(self.exposures)


class SlowArchive:
    async def find_exposures(self, ra: float, dec: float) -> list[Exposure]:
        await asyncio.sleep(30)
        return []


def make_client(archive, **settings) -> TestClient:
    app = create_app(Settings(_env_file=None, allowed_origins=ORIGIN, **settings), archive=archive)
    return TestClient(app, raise_server_exceptions=False)


def exposure(time_mjd: float, detector: int = 2) -> Exposure:
    return Exposure(
        id=f"dr1.2025W34_2B_0090_4D{detector}.l2b-v27-2026-229",
        collection="dr1",
        detector=detector,
        time_mjd=time_mjd,
    )


def test_answer_has_the_shape_of_the_contract():
    client = make_client(FakeArchive([exposure(60908.9825948)]))

    response = client.get("/api/exposures", params=BARNARD)

    assert response.status_code == 200
    body = response.json()
    assert list(body) == ["target", "grid", "exposures"]
    assert body["target"] == BARNARD
    assert list(body["grid"]) == ["ra", "dec", "fov_deg", "size"]
    assert body["exposures"] == [
        {
            "id": "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229",
            "collection": "dr1",
            "detector": 2,
            "pass": 1,
            "time_mjd": 60908.982595,
            "time_iso": "2025-08-21T23:34:56Z",
        }
    ]
    assert response.headers["cache-control"] == "public, max-age=3600"


def test_optional_parameters_have_the_defaults_of_the_contract():
    response = make_client(FakeArchive()).get("/api/exposures", params={"ra": 10, "dec": -20})

    body = response.json()
    assert body["target"] == {
        "ra": 10.0,
        "dec": -20.0,
        "epoch": 2000.0,
        "pm_ra": 0.0,
        "pm_dec": 0.0,
    }
    assert body["grid"] == {"ra": 10.0, "dec": -20.0, "fov_deg": 0.1, "size": 128}
    assert body["exposures"] == []


def test_recorded_archive_answer_goes_through_the_whole_route(sia_payload, sample_bundle):
    recorded = parse_sia_response(sia_payload, bucket="nasa-irsa-spherex").exposures

    body = make_client(FakeArchive(recorded)).get("/api/exposures", params=BARNARD).json()

    assert len(body["exposures"]) == 364
    assert body["grid"] == sample_bundle["grid"]
    detector_2 = [entry for entry in body["exposures"] if entry["detector"] == 2]
    assert detector_2 == sample_bundle["exposures"]


@pytest.mark.parametrize(
    "params",
    [
        {"dec": 4.7},
        {"ra": 269.4},
        {"ra": 360, "dec": 4.7},
        {"ra": -0.1, "dec": 4.7},
        {"ra": 269.4, "dec": 90.1},
        {"ra": "nan", "dec": 4.7},
        {"ra": "inf", "dec": 4.7},
        {"ra": "abc", "dec": 4.7},
        {"ra": 269.4, "dec": 4.7, "fov": 0.6},
        {"ra": 269.4, "dec": 4.7, "fov": 0.01},
        {"ra": 269.4, "dec": 4.7, "size": 16},
        {"ra": 269.4, "dec": 4.7, "size": 1024},
        {"ra": 269.4, "dec": 4.7, "size": 64.5},
        {"ra": 269.4, "dec": 4.7, "epoch": 1500},
        {"ra": 269.4, "dec": 4.7, "pm_ra": 1e9},
        {"ra": 269.4, "dec": 4.7, "pm_dec": "nan"},
    ],
)
def test_invalid_request_is_refused_with_a_reason(params):
    response = make_client(FakeArchive()).get("/api/exposures", params=params)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid_request"
    assert error["message"]


def test_silent_archive_gives_a_503_the_browser_can_read():
    failure = UpstreamUnavailable("The IRSA exposure search", "HTTP 503", retry_after_s=10)
    client = make_client(FakeArchive(failure=failure))

    response = client.get("/api/exposures", params=BARNARD, headers={"Origin": ORIGIN})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_unavailable"
    assert response.headers["retry-after"] == "10"
    assert "IRSA" not in response.text
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert "retry-after" in response.headers["access-control-expose-headers"].lower()


def test_request_that_runs_out_of_time_gives_a_503_instead_of_hanging():
    client = make_client(SlowArchive(), archive_budget_s=0.05)

    response = client.get("/api/exposures", params=BARNARD, headers={"Origin": ORIGIN})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_unavailable"
    assert response.headers["retry-after"] == "10"
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_unusable_archive_answer_is_an_internal_error_without_details():
    client = make_client(FakeArchive(failure=UpstreamError("table without the columns ['t_min']")))

    response = client.get("/api/exposures", params=BARNARD)

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "t_min" not in response.text


def test_application_opens_its_archive_client_when_it_starts():
    app = create_app(Settings(_env_file=None))
    assert app.state.archive is None

    with TestClient(app):
        assert isinstance(app.state.archive, SiaArchive)

    assert app.state.archive is None


def test_route_fails_cleanly_when_the_application_was_not_started():
    app = create_app(Settings(_env_file=None))

    response = TestClient(app, raise_server_exceptions=False).get(
        "/api/exposures", params={"ra": 10, "dec": 20}
    )

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
