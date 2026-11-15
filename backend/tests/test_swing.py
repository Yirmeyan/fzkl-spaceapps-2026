"""Bodies that swing with the seasons: frames read along a path, and what is found there."""

import numpy as np
import pytest

from made_up_field import field_frames, seasons, steady_stars
from spherex_explorer.detection import (
    HIGH,
    MEDIUM,
    SWUNG,
    find_candidates,
    measure_field,
)
from spherex_explorer.detection.field import _piles
from spherex_explorer.detection.swing import find_swings, read_along, without_the_brightest

X0, Y0 = 48.0, 50.0
DAYS_PER_VISIT = 182.6


def side(visit: int) -> tuple[float, float]:
    """Where a swing of one pixel puts a body during a visit."""
    swing_x, swing_y = seasons(np.array(60800.0 + DAYS_PER_VISIT * (visit - 1)))
    return float(swing_x), float(swing_y)


def swinging(parallax: float, light: float = 6.0, per_visit=(0.0, 0.0), only=None):
    """The steady stars, and a body that swings by `parallax` pixels around (X0, Y0).

    `per_visit` is its own motion from one visit to the next, and `only` the detectors
    that show it.
    """

    def scene(detector, visit, wavelength):
        if only is not None and detector not in only:
            return steady_stars()
        swing_x, swing_y = side(visit)
        x = X0 + parallax * swing_x + per_visit[0] * (visit - 2)
        y = Y0 + parallax * swing_y + per_visit[1] * (visit - 2)
        return [*steady_stars(), (x, y, light)]

    return scene


def swings_of(scene, **options):
    return find_swings(_piles(field_frames(scene, **options)), seasons)


# --- frames read along a path


def test_frames_are_read_where_the_body_would_be():
    values = np.arange(2 * 5 * 6, dtype=np.float32).reshape(2, 5, 6)

    read = read_along(values, np.array([[2, -1], [0, 0]]))

    # The first frame is read 2 pixels to the right and 1 up: what was at (x, y) = (3, 1)
    # is now at (1, 2).
    assert read[0, 2, 1] == values[0, 1, 3]
    assert np.isnan(read[0, 0]).all()
    assert np.isnan(read[0, :, 4:]).all()
    assert np.array_equal(read[1], values[1])


def test_the_brightest_frame_is_left_out_of_an_average():
    values = np.ones((8, 4, 4), dtype=np.float32)
    values[3, 1, 2] = 500.0
    values[:, 0, 0] = np.arange(8)

    stacked = without_the_brightest(values)

    assert stacked[1, 2] == pytest.approx(1.0)
    # 0 to 7 without the 7: the mean of 0 to 6.
    assert stacked[0, 0] == pytest.approx(3.0)


def test_a_place_seen_by_too_few_frames_has_no_average():
    values = np.ones((8, 4, 4), dtype=np.float32)
    values[:5, 2, 2] = np.nan
    values[:4, 3, 3] = np.nan

    stacked = without_the_brightest(values)

    assert np.isnan(stacked[2, 2])
    assert stacked[3, 3] == pytest.approx(1.0)


def test_a_few_frames_are_averaged_by_their_median():
    values = np.ones((3, 4, 4), dtype=np.float32)
    values[1, 1, 1] = 500.0

    assert without_the_brightest(values)[1, 1] == pytest.approx(1.0)


# --- a body that swings


@pytest.mark.parametrize("parallax", [4.0, 10.0, 20.3])
def test_a_body_that_swings_is_found_with_its_parallax(parallax):
    found = swings_of(swinging(parallax))

    assert len(found) == 1
    body = found[0]
    assert (body.x, body.y) == pytest.approx((X0, Y0), abs=0.2)
    assert body.parallax == pytest.approx(parallax, abs=0.2)
    assert 0 < body.parallax_error < 0.3
    assert body.followed
    assert body.significance > 50
    assert [place.pass_number for place in body.places] == [1, 2, 3]
    for place in body.places:
        swing_x, swing_y = side(place.pass_number)
        assert (place.x, place.y) == pytest.approx(
            (X0 + parallax * swing_x, Y0 + parallax * swing_y), abs=0.3
        )
        assert place.detectors == (2, 5)
    # It has no motion of its own.
    assert abs(body.rate_x * DAYS_PER_VISIT) < 0.3
    assert abs(body.rate_y * DAYS_PER_VISIT) < 0.3


def test_its_own_motion_is_measured_apart_from_its_swing():
    body = swings_of(swinging(12.0, per_visit=(0.75, -0.5)))[0]

    assert body.parallax == pytest.approx(12.0, abs=0.2)
    assert body.rate_x * DAYS_PER_VISIT == pytest.approx(0.75, abs=0.2)
    assert body.rate_y * DAYS_PER_VISIT == pytest.approx(-0.5, abs=0.2)
    assert 0 < body.rate_error * DAYS_PER_VISIT < 0.4


def test_a_faint_body_is_found_and_is_less_sure():
    body = swings_of(swinging(7.4, light=0.5))[0]

    assert body.parallax == pytest.approx(7.4, abs=0.5)
    assert 5 < body.significance < 20


def test_a_cold_body_is_found_in_the_reddest_detector_alone():
    found = swings_of(swinging(10.0, light=2.0, only=(5,)), detectors=(1, 2, 3, 5))

    assert len(found) == 1
    assert found[0].parallax == pytest.approx(10.0, abs=0.3)
    assert all(place.detectors == (5,) for place in found[0].places)


# --- what is not a body


def test_steady_stars_are_not_bodies():
    assert swings_of(lambda detector, visit, wavelength: steady_stars()) == ()


def test_two_stars_along_the_line_of_the_swing_are_not_one_body():
    # Each star sits where a body would be during one visit, and stays there.
    def scene(detector, visit, wavelength):
        return [
            *steady_stars(),
            (X0 + 10.0 * side(1)[0], Y0 + 10.0 * side(1)[1], 6.0),
            (X0 + 10.0 * side(2)[0], Y0 + 10.0 * side(2)[1], 6.0),
        ]

    assert swings_of(scene) == ()


def test_a_source_that_shows_during_one_visit_only_is_not_a_body():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (X0, Y0, 6.0)] if visit == 2 else steady_stars()

    assert swings_of(scene) == ()


def test_a_star_that_moves_straight_on_is_not_a_body():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (X0 + 6.0 * (visit - 2), Y0 - 4.0 * (visit - 2), 6.0)]

    assert swings_of(scene) == ()


def test_one_visit_shows_no_swing():
    assert swings_of(swinging(10.0), visits=(1,)) == ()


# --- two visits only


def test_two_visits_show_a_swing_but_not_the_motion_of_the_body():
    found = swings_of(swinging(10.0), visits=(1, 2))

    assert len(found) == 1
    body = found[0]
    assert body.parallax == pytest.approx(10.0, abs=0.2)
    assert not body.followed
    assert (body.rate_x, body.rate_y, body.rate_error) == (0.0, 0.0, 0.0)


# --- a visit of a few frames


def thinned(frames, visit: int, kept: int):
    """The same frames, with only the first `kept` of each detector during one visit."""
    seen: dict[int, int] = {}
    out = []
    for frame in frames:
        if frame.pass_number == visit:
            seen[frame.detector] = seen.get(frame.detector, 0) + 1
            if seen[frame.detector] > kept:
                continue
        out.append(frame)
    return out


def test_a_thin_visit_is_not_asked_to_show_a_faint_body():
    frames = thinned(field_frames(swinging(7.4, light=0.4), per_visit=12), visit=1, kept=3)

    found = find_swings(_piles(frames), seasons)

    # Three frames of twelve cannot show it at 6 sigma. The two other visits do.
    assert len(found) == 1
    assert found[0].parallax == pytest.approx(7.4, abs=0.5)
    assert {place.pass_number for place in found[0].places} >= {2, 3}


def test_a_thin_visit_that_should_show_a_bright_body_and_does_not_contradicts_it():
    def scene(detector, visit, wavelength):
        return steady_stars() if visit == 1 else swinging(10.0)(detector, visit, wavelength)

    frames = thinned(field_frames(scene, visits=(1, 2, 3, 4), per_visit=12), visit=1, kept=3)

    assert find_swings(_piles(frames), seasons) == ()
    # With the body there during that visit too, it is found.
    whole = thinned(field_frames(swinging(10.0), visits=(1, 2, 3, 4), per_visit=12), 1, 3)
    assert len(find_swings(_piles(whole), seasons)) == 1


# --- candidates


def test_a_body_that_swings_is_one_candidate_and_not_two_sources():
    field = measure_field(field_frames(swinging(10.0)), seasons)

    # Around each of its two places, the body is a source that comes and goes.
    assert len(field.sources) == 8
    found = find_candidates(field)
    assert [(one.kind, one.confidence) for one in found] == [(SWUNG, HIGH)]
    motion = found[0].source.motion
    assert motion.parallax == pytest.approx(10.0, abs=0.2)
    assert motion.checked
    assert [sighting.pass_number for sighting in found[0].source.sightings] == [1, 2, 3]


def test_a_swing_drawn_by_two_visits_is_never_a_firm_claim():
    field = measure_field(field_frames(swinging(10.0), visits=(1, 2)), seasons)

    found = find_candidates(field)
    assert [(one.kind, one.confidence) for one in found] == [(SWUNG, MEDIUM)]
    assert not found[0].source.motion.checked


def test_a_faint_swing_drawn_by_two_visits_is_not_claimed():
    faint = swinging(7.4, light=0.4)
    two = measure_field(field_frames(faint, visits=(1, 2)), seasons)
    three = measure_field(field_frames(faint), seasons)

    # The same body, seen as surely: two visits leave it unchecked, three do not.
    assert len(two.swung) == 1
    assert 5 < two.swung[0].motion.significance < 10
    assert [one.kind for one in find_candidates(two)] == []
    assert [(one.kind, one.confidence) for one in find_candidates(three)] == [(SWUNG, MEDIUM)]


def test_without_dates_no_body_is_looked_for():
    field = measure_field(field_frames(swinging(10.0)))

    assert field.swung == ()
    assert all(one.kind != SWUNG for one in find_candidates(field))
