"""The candidates of a field as the contract writes them."""

import numpy as np
import pytest

from made_up_field import OVERFLOW, field_frames, steady_stars
from spherex_explorer.api.candidates import candidates_out
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
    assert nearby["limits"] == {"significance": 5.0, "shift_arcsec": 1.0, "change": 0.1}
    assert nearby["saturated"] == []


def test_a_motion_is_told_in_the_words_of_the_sky(nearby):
    assert len(nearby["candidates"]) == 1
    found = nearby["candidates"][0]
    assert list(found) == [
        "kind",
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
        "changes",
    ]
    assert (found["kind"], found["confidence"], found["is_target"]) == ("moved", "high", True)
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
