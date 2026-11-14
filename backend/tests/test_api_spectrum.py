import asyncio

import numpy as np
import pytest
from fastapi.testclient import TestClient

from level2_file import HEIGHT, MJD, SKY_CENTER, WIDTH, FakeStorage, build_level2_file, star
from spherex_explorer.api.app import create_app
from spherex_explorer.archive import Exposure, Level2Reader, key_from_id
from spherex_explorer.config import Settings
from spherex_explorer.errors import UpstreamUnavailable

ORIGIN = "https://site.example"
IDS = [
    "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229",
    "qr3.2026W10_1A_0008_3D5.l2b-v27-2026-241",
]
HERE = {"ra": SKY_CENTER[0], "dec": SKY_CENTER[1]}
POINT_KEYS = [
    "id",
    "detector",
    "pass",
    "time_mjd",
    "time_iso",
    "wavelength_um",
    "bandwidth_um",
    "flux_mjy",
    "error_mjy",
    "quality",
]


class FakeArchive:
    def __init__(self, failure: Exception | None = None, delay_s: float = 0.0):
        self.failure = failure
        self.delay_s = delay_s

    async def find_exposures(self, ra: float, dec: float) -> list[Exposure]:
        await asyncio.sleep(self.delay_s)
        if self.failure is not None:
            raise self.failure
        return [
            Exposure(
                id=identifier,
                collection=identifier.split(".")[0],
                detector=int(identifier.split(".")[1][-1]),
                time_mjd=MJD + 200.0 * index,
            )
            for index, identifier in enumerate(IDS)
        ]


@pytest.fixture(scope="module")
def source() -> Level2Reader:
    image = np.random.default_rng(3).normal(0.3, 0.02, (HEIGHT, WIDTH))
    image += star((HEIGHT, WIDTH), (WIDTH - 1) / 2, (HEIGHT - 1) / 2, 50.0, 1.3)
    content = build_level2_file(image=image, flags=np.zeros((HEIGHT, WIDTH), dtype=np.int32))
    return Level2Reader(FakeStorage({key_from_id(identifier): content for identifier in IDS}))


def make_client(source, archive=None, **settings) -> TestClient:
    app = create_app(
        Settings(_env_file=None, allowed_origins=ORIGIN, **settings),
        archive=archive or FakeArchive(),
        frames=source,
    )
    return TestClient(app, raise_server_exceptions=False)


def test_answer_has_the_target_and_one_point_per_exposure_as_the_contract_writes_them(source):
    response = make_client(source).get("/api/spectrum", params=HERE)

    assert response.status_code == 200
    body = response.json()
    assert list(body) == ["target", "points"]
    assert body["target"] == {**HERE, "epoch": 2000.0, "pm_ra": 0.0, "pm_dec": 0.0}
    assert [list(point) for point in body["points"]] == [POINT_KEYS, POINT_KEYS]
    first = body["points"][0]
    assert (first["id"], first["detector"], first["pass"]) == (IDS[0], 2, 1)
    assert (body["points"][1]["detector"], body["points"][1]["pass"]) == (5, 2)
    assert first["time_mjd"] == round(MJD, 6)
    assert first["time_iso"] == "2025-08-21T23:34:56Z"
    assert first["quality"] == "ok"
    assert first["flux_mjy"] > 30 * first["error_mjy"] > 0
    assert response.headers["cache-control"] == "public, max-age=3600"


def test_numbers_are_rounded_like_those_of_a_frame(source):
    client = make_client(source)
    point = client.get("/api/spectrum", params=HERE).json()["points"][0]
    frame = client.get(f"/api/frames/{IDS[0]}", params=HERE).json()

    assert point["flux_mjy"] == frame["photometry"]["flux_mjy"]
    assert point["error_mjy"] == frame["photometry"]["error_mjy"]
    assert point["wavelength_um"] == frame["wavelength_um"]
    assert point["bandwidth_um"] == frame["bandwidth_um"]
    assert point["time_mjd"] == frame["time_mjd"]


def test_one_detector_can_be_asked_alone(source):
    response = make_client(source).get("/api/spectrum", params={**HERE, "detector": 5})

    assert [point["id"] for point in response.json()["points"]] == [IDS[1]]


def test_target_off_the_detector_gives_points_without_value(source):
    response = make_client(source).get("/api/spectrum", params={"ra": 151.5, "dec": 20.0})

    point = response.json()["points"][0]
    assert (point["quality"], point["flux_mjy"], point["wavelength_um"]) == ("outside", None, None)


@pytest.mark.parametrize(
    "params",
    [{}, {"ra": 400, "dec": 4}, {**HERE, "detector": 7}, {**HERE, "detector": "all"}],
)
def test_invalid_request_is_refused(source, params):
    response = make_client(source).get("/api/spectrum", params=params)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_silent_archive_gives_a_503_the_browser_can_read(source):
    failure = UpstreamUnavailable("The IRSA exposure search", "HTTP 503", retry_after_s=10)
    client = make_client(source, archive=FakeArchive(failure=failure))

    response = client.get("/api/spectrum", params=HERE, headers={"Origin": ORIGIN})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_unavailable"
    assert response.headers["retry-after"] == "10"
    assert response.headers["access-control-expose-headers"] == "Retry-After"


def test_spectrum_that_takes_too_long_gives_a_503(source):
    client = make_client(source, archive=FakeArchive(delay_s=5.0), archive_budget_s=0.05)

    response = client.get("/api/spectrum", params=HERE)

    assert response.status_code == 503
    assert response.headers["retry-after"] == "10"
