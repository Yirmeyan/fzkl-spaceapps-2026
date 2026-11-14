import asyncio
import base64
import gzip
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from level2_file import EXPOSURE_ID, KEY, MJD, SKY_CENTER, FakeStorage, build_level2_file
from spherex_explorer.api.app import create_app
from spherex_explorer.api.frames import encode_image
from spherex_explorer.archive import Level2Reader, S3Reader
from spherex_explorer.config import Settings
from spherex_explorer.frames import Grid
from spherex_explorer.pipeline import build_frame
from spherex_explorer.targets import Target

ORIGIN = "https://site.example"
URL = f"/api/frames/{EXPOSURE_ID}"
VIEW = {"ra": SKY_CENTER[0], "dec": SKY_CENTER[1], "fov": 0.05, "size": 64}
FRAME_KEYS = [
    "id",
    "time_mjd",
    "time_iso",
    "exposure_s",
    "wavelength_um",
    "bandwidth_um",
    "background",
    "noise",
    "valid_fraction",
    "target_xy",
    "photometry",
    "image",
    "mask",
]


@pytest.fixture(scope="module")
def content() -> bytes:
    return build_level2_file(flags=np.zeros((72, 96), dtype=np.int32))


def source_of(files: dict[str, bytes]) -> Level2Reader:
    return Level2Reader(FakeStorage(files))


def make_client(source, **settings) -> TestClient:
    app = create_app(Settings(_env_file=None, allowed_origins=ORIGIN, **settings), frames=source)
    return TestClient(app, raise_server_exceptions=False)


def test_answer_has_the_fields_of_the_contract_in_its_order(content):
    response = make_client(source_of({KEY: content})).get(URL, params=VIEW)

    assert response.status_code == 200
    body = response.json()
    assert list(body) == FRAME_KEYS
    assert body["id"] == EXPOSURE_ID
    assert body["time_mjd"] == round(MJD, 6)
    assert body["time_iso"] == "2025-08-21T23:34:56Z"
    assert body["exposure_s"] == 113.6
    assert list(body["photometry"]) == ["flux_mjy", "error_mjy", "quality"]
    assert body["photometry"]["quality"] in {"ok", "flagged", "masked", "saturated", "outside"}
    assert body["target_xy"] == [31.5, 31.5]
    assert response.headers["cache-control"] == "public, max-age=86400"


def test_numbers_are_rounded_as_in_the_sample_of_the_contract(content, sample_bundle):
    body = make_client(source_of({KEY: content})).get(URL, params=VIEW).json()
    sample = sample_bundle["frames"][0]

    for field in ("wavelength_um", "bandwidth_um", "background", "noise", "valid_fraction"):
        ours, theirs = repr(body[field]), repr(sample[field])
        assert len(ours.partition(".")[2]) <= len(theirs.partition(".")[2]), field


def test_pixels_and_flags_decode_to_the_frame_the_pipeline_builds(content):
    body = make_client(source_of({KEY: content})).get(URL, params=VIEW).json()
    grid = Grid(ra=VIEW["ra"], dec=VIEW["dec"], fov_deg=VIEW["fov"], size=VIEW["size"])
    expected = asyncio.run(
        build_frame(source_of({KEY: content}), EXPOSURE_ID, Target(*SKY_CENTER), grid)
    )

    image = np.frombuffer(base64.b64decode(body["image"]), dtype="<f2").reshape(64, 64)
    mask = np.frombuffer(base64.b64decode(body["mask"]), dtype=np.uint8).reshape(64, 64)

    assert np.array_equal(mask, expected.mask)
    assert np.allclose(image, expected.image, rtol=1e-3, equal_nan=True)


def test_values_beyond_a_16_bit_float_are_clipped_and_holes_stay_holes():
    image = np.array([[1e6, -1e6], [np.nan, 0.25]], dtype=np.float32)

    decoded = np.frombuffer(base64.b64decode(encode_image(image)), dtype="<f2")

    assert decoded[:2].tolist() == [65504.0, -65504.0]
    assert np.isnan(decoded[2]) and decoded[3] == 0.25


def test_grid_is_centered_on_the_target_unless_the_request_says_otherwise(content):
    client = make_client(source_of({KEY: content}))

    centered = client.get(URL, params=VIEW).json()
    moved = client.get(URL, params={**VIEW, "grid_dec": SKY_CENTER[1] + 10 / 3600}).json()

    assert centered["target_xy"] == [31.5, 31.5]
    # The grid went 10 arcseconds north: the target is lower in the image.
    assert moved["target_xy"] == [31.5, pytest.approx(31.5 + 10 / 2.8125, abs=0.01)]


def test_answer_is_compressed_for_a_browser_that_accepts_it(content):
    client = make_client(source_of({KEY: content}))

    with client.stream("GET", URL, params=VIEW, headers={"Accept-Encoding": "gzip"}) as response:
        raw = b"".join(response.iter_raw())

    assert response.headers["content-encoding"] == "gzip"
    body = json.loads(gzip.decompress(raw))
    assert len(raw) < 0.8 * len(json.dumps(body))


@pytest.mark.parametrize(
    "identifier",
    ["dr1.nothing.here", "dr1.2025W34_2B_0090_4D9.l2b-v27-2026-229", "x" * 121],
)
def test_identifier_of_another_shape_is_refused(content, identifier):
    response = make_client(source_of({KEY: content})).get(f"/api/frames/{identifier}", params=VIEW)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


@pytest.mark.parametrize(
    "change",
    [
        {"ra": 360},
        {"dec": 91},
        {"grid_ra": -1},
        {"grid_dec": "north"},
        {"fov": 2},
        {"size": 8},
        {"pm_dec": "nan"},
    ],
)
def test_invalid_view_is_refused_with_a_reason(content, change):
    response = make_client(source_of({KEY: content})).get(URL, params={**VIEW, **change})

    assert response.status_code == 422
    assert response.json()["error"]["message"]


def test_view_without_a_target_is_refused(content):
    response = make_client(source_of({KEY: content})).get(URL, params={"fov": 0.05})

    assert response.status_code == 422


def test_exposure_the_archive_does_not_hold_is_not_found():
    response = make_client(source_of({})).get(URL, params=VIEW, headers={"Origin": ORIGIN})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert "level2" not in response.text
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_file_that_cannot_be_read_is_an_internal_error_without_details():
    response = make_client(source_of({KEY: b"not a FITS file " * 5000})).get(URL, params=VIEW)

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "header" not in response.text


def test_frame_that_runs_out_of_time_gives_a_503_instead_of_hanging():
    class Slow:
        async def layout(self, exposure_id):
            await asyncio.sleep(30)

    client = make_client(Slow(), archive_budget_s=0.05)

    response = client.get(URL, params=VIEW, headers={"Origin": ORIGIN})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_unavailable"
    assert response.headers["retry-after"] == "5"
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_application_opens_its_reader_of_files_when_it_starts():
    app = create_app(Settings(_env_file=None))
    assert app.state.frames is None

    with TestClient(app):
        assert isinstance(app.state.frames, Level2Reader)
        assert isinstance(app.state.frames._ranges, S3Reader)

    assert app.state.frames is None


def test_route_fails_cleanly_when_the_application_was_not_started():
    app = create_app(Settings(_env_file=None))

    response = TestClient(app, raise_server_exceptions=False).get(URL, params=VIEW)

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
