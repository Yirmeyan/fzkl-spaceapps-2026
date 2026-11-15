"""The candidates of a field: the route, and the answer as the contract writes it."""

import asyncio
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from level2_file import MJD, SKY_CENTER, FakeStorage, build_level2_file
from made_up_field import OVERFLOW, add_bright_star, field_frames, steady_stars
from spherex_explorer.api.app import create_app
from spherex_explorer.api.candidates import candidates_out
from spherex_explorer.archive import Exposure, Level2Reader, key_from_id
from spherex_explorer.config import Settings
from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.frames import Grid, grid_to_sky, sky_to_grid
from spherex_explorer.pipeline import report_field
from spherex_explorer.targets import Target, parallax_shift

GRID = Grid(ra=133.76, dec=-7.24, fov_deg=96 * 2.8125 / 3600, size=96)
SCALE = GRID.scale_deg * 3600
FIRST_DAY = 60800.0


def place(x: float, y: float) -> tuple[float, float]:
    ra, dec = grid_to_sky(GRID, np.array(x), np.array(y))
    return float(ra), float(dec)


def moving(visit: int) -> tuple[float, float]:
    """A nearby object: 2 arcseconds a year to the west, 0.5 to the north, parallax 0.6."""
    date = FIRST_DAY + 182.6 * (visit - 1) + 1.5
    years = (date - FIRST_DAY) / 365.25
    east, north = parallax_shift(GRID.ra, GRID.dec, np.array(date))
    return (
        45.0 - (-2.0 * years + 0.6 * float(east)) / SCALE,
        50.0 - (0.5 * years + 0.6 * float(north)) / SCALE,
    )


def answer(scene, target, **options):
    frames = field_frames(scene, **options)
    return candidates_out(report_field(target, GRID, frames)).model_dump(by_alias=True)


@pytest.fixture(scope="module")
def nearby():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (*moving(visit), 30.0)]

    # The target is the object itself, as a catalog would give it: where it was on the
    # first day, and how it moves.
    ra, dec = place(45.0, 50.0)
    target = Target(
        ra=ra, dec=dec, epoch=2000 + (FIRST_DAY - 51544.5) / 365.25, pm_ra=-2000.0, pm_dec=500.0
    )
    return answer(scene, target, visits=(1, 2, 3, 4), noise=0.01)


def test_the_answer_carries_the_view_and_what_was_looked_at(nearby):
    assert list(nearby) == [
        "target",
        "grid",
        "frames",
        "sources",
        "visits",
        "limits",
        "saturated",
        "candidates",
    ]
    assert nearby["grid"] == {"ra": 133.76, "dec": -7.24, "fov_deg": GRID.fov_deg, "size": 96}
    assert (nearby["frames"], nearby["sources"]) == (64, 7)
    assert [visit["pass"] for visit in nearby["visits"]] == [1, 2, 3, 4]
    assert nearby["visits"][0]["frames"] == 16
    assert nearby["visits"][0]["time_iso"].startswith("2025-05-0")
    assert nearby["limits"] == {
        "significance": 5.0,
        "shift_arcsec": 1.0,
        "change": 0.1,
        "swing_distance_au": (1600, 24400),
    }
    assert nearby["saturated"] == []


def test_a_motion_is_told_in_the_words_of_the_sky(nearby):
    assert len(nearby["candidates"]) == 1
    found = nearby["candidates"][0]
    assert list(found) == [
        "kind",
        "method",
        "confidence",
        "significance",
        "is_target",
        "ra",
        "dec",
        "epoch",
        "xy",
        "detectors",
        "track",
        "motion",
        "swing",
        "changes",
    ]
    assert (found["kind"], found["confidence"], found["is_target"]) == ("moved", "high", True)
    assert found["swing"] is None
    assert found["method"] == "source"
    assert found["significance"] > 10
    assert found["detectors"] == [2, 5]
    assert found["changes"] == []
    # The place is the mean of the four sightings, and the epoch the mean of their dates.
    assert found["epoch"] == pytest.approx(2000 + (FIRST_DAY + 275.4 - 51544.5) / 365.25, abs=0.01)
    assert found["xy"] == pytest.approx(
        np.mean([moving(visit) for visit in (1, 2, 3, 4)], axis=0), abs=0.1
    )
    motion = found["motion"]
    # West is a negative motion in right ascension, and it is toward larger x.
    assert motion["pm_ra"] == pytest.approx(-2000, abs=150)
    assert motion["pm_dec"] == pytest.approx(500, abs=150)
    assert motion["rate_arcsec_per_year"] == pytest.approx(2.06, abs=0.15)
    assert motion["angle_deg"] == pytest.approx(284.0, abs=4)
    assert motion["days"] == pytest.approx(547.8, abs=4)
    assert motion["shift_arcsec"] == pytest.approx(motion["rate_arcsec_per_year"] * 1.5, abs=0.1)
    assert 0 < motion["rate_error_arcsec_per_year"] < 0.2


def test_a_parallax_comes_with_a_distance_and_how_sure_it_is(nearby):
    motion = nearby["candidates"][0]["motion"]

    assert motion["parallax_arcsec"] == pytest.approx(0.6, abs=0.1)
    assert 0 < motion["parallax_error_arcsec"] < 0.1
    assert motion["distance_ly"] == pytest.approx(3.2616 / motion["parallax_arcsec"], abs=0.06)
    near, far = motion["distance_ly_range"]
    assert near < motion["distance_ly"] < far
    assert near == pytest.approx(
        3.2616 / (motion["parallax_arcsec"] + motion["parallax_error_arcsec"]), abs=0.06
    )


def test_each_sighting_is_given_on_the_sky_and_on_the_grid(nearby):
    track = nearby["candidates"][0]["track"]

    assert [sighting["pass"] for sighting in track] == [1, 2, 3, 4]
    for visit, sighting in enumerate(track, start=1):
        x, y = moving(visit)
        assert sighting["xy"] == pytest.approx([x, y], abs=0.15)
        back = sky_to_grid(GRID, np.array(sighting["ra"]), np.array(sighting["dec"]))
        assert [float(back[0]), float(back[1])] == pytest.approx(sighting["xy"], abs=0.02)
        assert 0 < sighting["error_arcsec"] < 0.3
        assert sighting["detectors"] == [2, 5]
        assert sighting["time_iso"].endswith("Z")
    assert track[0]["xy"][0] < track[-1]["xy"][0]


def test_another_object_of_the_field_is_not_the_target():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0 + 1.5 * (visit - 2), 50.0, 30.0)]

    far = Target(ra=place(80.0, 20.0)[0], dec=place(80.0, 20.0)[1])
    out = answer(scene, far)

    assert [found["is_target"] for found in out["candidates"]] == [False]
    assert out["candidates"][0]["motion"]["parallax_arcsec"] is None
    assert out["candidates"][0]["motion"]["distance_ly"] is None
    assert out["candidates"][0]["motion"]["distance_ly_range"] is None


def swinging(visit: int, parallax_arcsec: float = 30.0) -> tuple[float, float]:
    """A body of the outer solar system: no motion of its own, and a parallax of 30 arcseconds."""
    date = FIRST_DAY + 182.6 * (visit - 1) + 1.5
    east, north = parallax_shift(GRID.ra, GRID.dec, np.array(date))
    return (
        48.0 - parallax_arcsec * float(east) / SCALE,
        50.0 - parallax_arcsec * float(north) / SCALE,
    )


def swung(**options):
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (*swinging(visit), 6.0)]

    ra, dec = place(48.0, 50.0)
    return answer(scene, Target(ra=ra, dec=dec), **options)


def test_a_body_that_swings_comes_with_its_distance():
    out = swung()

    assert len(out["candidates"]) == 1
    found = out["candidates"][0]
    assert (found["kind"], found["method"], found["confidence"]) == ("swung", "source", "high")
    # The place is where the Sun would see the body, and each sighting where a visit does.
    assert found["xy"] == pytest.approx((48.0, 50.0), abs=0.3)
    assert [sighting["pass"] for sighting in found["track"]] == [1, 2, 3]
    for sighting in found["track"]:
        assert sighting["xy"] == pytest.approx(swinging(sighting["pass"]), abs=0.4)
    swing = found["swing"]
    assert list(swing) == [
        "parallax_arcsec",
        "parallax_error_arcsec",
        "distance_au",
        "distance_au_range",
        "swing_arcsec",
    ]
    assert swing["parallax_arcsec"] == pytest.approx(30.0, abs=1.0)
    assert 0 < swing["parallax_error_arcsec"] < 1.5
    # A parallax of 30 arcseconds is 206,265 / 30 astronomical units.
    assert swing["distance_au"] == pytest.approx(6875, abs=250)
    near, far = swing["distance_au_range"]
    assert near < swing["distance_au"] < far
    first, second = (np.array(swinging(visit)) for visit in (1, 2))
    assert swing["swing_arcsec"] == pytest.approx(np.hypot(*(first - second)) * SCALE, abs=1.5)
    # Its own motion was checked by the third visit: next to nothing.
    assert found["motion"]["rate_arcsec_per_year"] < 1.0
    assert found["motion"]["parallax_arcsec"] == pytest.approx(swing["parallax_arcsec"], abs=0.1)


def test_two_visits_give_the_swing_of_a_body_and_not_its_motion():
    found = swung(visits=(1, 2))["candidates"][0]

    assert (found["kind"], found["confidence"], found["motion"]) == ("swung", "medium", None)
    assert found["swing"]["distance_au"] == pytest.approx(6875, abs=250)


def test_a_change_names_its_detectors_and_carries_no_motion():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0, 50.0, 30.0 * (0.6 if visit == 3 else 1.0))]

    ra, dec = place(45.0, 50.0)
    out = answer(scene, Target(ra=ra, dec=dec))

    assert len(out["candidates"]) == 1
    found = out["candidates"][0]
    assert (found["kind"], found["is_target"], found["motion"]) == ("changed", True, None)
    assert {change["detector"] for change in found["changes"]} == {2, 5}
    first = found["changes"][0]
    assert list(first) == [
        "detector",
        "from_pass",
        "to_pass",
        "ratio",
        "error",
        "significance",
        "wavelength_um",
    ]
    assert first["to_pass"] == 3
    assert first["ratio"] == pytest.approx(0.6, abs=0.05)
    assert first["significance"] == found["significance"]
    assert first["wavelength_um"][0] < first["wavelength_um"][1]


def test_a_saturated_star_is_placed_on_the_sky():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (48.0, 48.0, 5000.0)]

    frames = field_frames(scene)
    for frame in frames:
        frame.image[45:52, 45:52] = np.nan
        frame.mask[44:53, 44:53] |= OVERFLOW
    out = candidates_out(report_field(Target(ra=GRID.ra, dec=GRID.dec), GRID, frames)).model_dump()

    assert out["candidates"] == []
    assert len(out["saturated"]) == 1
    star = out["saturated"][0]
    assert star["xy"] == pytest.approx([48.0, 48.0], abs=0.01)
    assert (star["ra"], star["dec"]) == pytest.approx(place(48.0, 48.0), abs=1e-6)
    assert star["radius_arcsec"] == pytest.approx(np.sqrt(49 / np.pi) * SCALE, abs=0.1)
    assert star["detectors"] == [2, 5]


def test_a_saturated_star_is_a_candidate_when_its_halo_changed():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (48.0, 48.0, 5000.0)]

    frames = field_frames(scene, detectors=(4, 5))
    add_bright_star(
        frames, 48.0, 48.0, lambda visit: 10.0 * (0.5 if visit == 3 else 1.0), saturating=(4, 5)
    )
    ra, dec = place(48.0, 48.0)
    report = candidates_out(report_field(Target(ra=ra, dec=dec), GRID, frames))
    out = report.model_dump(by_alias=True)

    assert len(out["candidates"]) == 1
    found, heart = out["candidates"][0], out["saturated"][0]
    assert (found["kind"], found["method"]) == ("changed", "halo")
    assert (found["is_target"], found["motion"]) == (True, None)
    assert (found["xy"], found["detectors"]) == (heart["xy"], [4, 5])
    assert [sighting["pass"] for sighting in found["track"]] == [1, 2, 3]
    assert all(
        sighting["error_arcsec"] == pytest.approx(heart["radius_arcsec"], abs=0.01)
        for sighting in found["track"]
    )
    assert found["changes"][0]["ratio"] == pytest.approx(0.5, abs=0.03)


# --- the route

ORIGIN = "https://site.example"
HERE = {"ra": SKY_CENTER[0], "dec": SKY_CENTER[1]}
# Two visits of two detectors, three exposures each.
IDS = [
    f"dr1.2025W{week}_2B_{number:04d}_1D{detector}.l2b-v27-2026-229"
    for week in (20, 46)
    for detector in (2, 5)
    for number in range(3)
]


class FakeArchive:
    def __init__(self, failure: Exception | None = None, delay_s: float = 0.0):
        self.failure = failure
        self.delay_s = delay_s
        self.searches = 0

    async def find_exposures(self, ra: float, dec: float) -> list[Exposure]:
        self.searches += 1
        await asyncio.sleep(self.delay_s)
        if self.failure is not None:
            raise self.failure
        return [
            Exposure(
                id=identifier,
                collection="dr1",
                detector=int(identifier.split(".")[1][-1]),
                time_mjd=MJD + 7.0 * (int(identifier[9:11]) - 20) + index / 100,
            )
            for index, identifier in enumerate(IDS)
        ]


@pytest.fixture(scope="module")
def source() -> Level2Reader:
    content = build_level2_file(flags=np.zeros((72, 96), dtype=np.int32))
    return Level2Reader(FakeStorage({key_from_id(identifier): content for identifier in IDS}))


def make_client(source, archive=None, **settings) -> TestClient:
    app = create_app(
        Settings(_env_file=None, allowed_origins=ORIGIN, **settings),
        archive=archive or FakeArchive(),
        frames=source,
    )
    return TestClient(app, raise_server_exceptions=False)


def test_the_route_answers_as_the_contract_writes_it(source):
    response = make_client(source).get("/api/candidates", params=HERE)

    assert response.status_code == 200
    body = response.json()
    assert list(body) == [
        "target",
        "grid",
        "frames",
        "sources",
        "visits",
        "limits",
        "saturated",
        "candidates",
    ]
    assert body["target"] == {**HERE, "epoch": 2000.0, "pm_ra": 0.0, "pm_dec": 0.0}
    assert body["grid"] == {**HERE, "fov_deg": 0.1, "size": 128}
    assert body["frames"] == len(IDS)
    assert [(visit["pass"], visit["frames"]) for visit in body["visits"]] == [(1, 6), (2, 6)]
    assert list(body["visits"][0]) == ["pass", "time_mjd", "time_iso", "frames"]
    assert body["limits"] == {
        "significance": 5.0,
        "shift_arcsec": 1.0,
        "change": 0.1,
        "swing_distance_au": [1600, 24400],
    }
    # The same file stands for every exposure: nothing moves and nothing changes.
    assert body["candidates"] == []
    assert response.headers["cache-control"] == "public, max-age=3600"


def test_a_field_already_measured_is_answered_from_memory(source):
    archive = FakeArchive()
    with make_client(source, archive=archive) as client:
        first = client.get("/api/candidates", params=HERE)
        again = client.get("/api/candidates", params=HERE)
        elsewhere = client.get("/api/candidates", params={**HERE, "pm_ra": 100.0})

    assert first.status_code == again.status_code == elsewhere.status_code == 200
    assert first.json() == again.json()
    # One search for the field asked twice, one for the other target.
    assert archive.searches == 2


def test_a_place_never_observed_has_no_candidate_and_no_visit(source):
    class Nothing:
        async def find_exposures(self, ra: float, dec: float) -> list[Exposure]:
            return []

    body = make_client(source, archive=Nothing()).get("/api/candidates", params=HERE).json()

    assert (body["frames"], body["sources"], body["visits"], body["candidates"]) == (0, 0, [], [])
    # With no visit there was nothing to look for a swing in.
    assert body["limits"]["swing_distance_au"] is None


@pytest.mark.parametrize("params", [{}, {"ra": 400, "dec": 4}, {"ra": 10}, {**HERE, "pm_ra": "x"}])
def test_invalid_request_is_refused(source, params):
    response = make_client(source).get("/api/candidates", params=params)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_silent_archive_gives_a_503_the_browser_can_read(source):
    failure = UpstreamUnavailable("The IRSA exposure search", "HTTP 503", retry_after_s=10)
    client = make_client(source, archive=FakeArchive(failure=failure))

    response = client.get("/api/candidates", params=HERE, headers={"Origin": ORIGIN})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_unavailable"
    assert response.headers["retry-after"] == "10"
    assert response.headers["access-control-expose-headers"] == "Retry-After"


def test_a_field_that_takes_too_long_is_ready_for_the_next_request(source):
    archive = FakeArchive(delay_s=0.3)
    with make_client(source, archive=archive, archive_budget_s=0.05) as client:
        early = client.get("/api/candidates", params=HERE)
        time.sleep(1.5)
        later = client.get("/api/candidates", params=HERE)

    assert early.status_code == 503
    assert early.json()["error"]["code"] == "upstream_unavailable"
    assert early.headers["retry-after"] == "10"
    assert later.status_code == 200
    assert later.json()["frames"] == len(IDS)
    assert archive.searches == 1
