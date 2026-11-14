"""Detection: stacks, sources, and what moved or changed in a made-up field."""

import numpy as np
import pytest

from made_up_field import NOISE, OVERFLOW, SIZE, field_frames, seasons, star, steady_stars
from spherex_explorer.detection import (
    CHANGED,
    HIGH,
    MEDIUM,
    MOVED,
    FieldFrame,
    find_candidates,
    measure_field,
)
from spherex_explorer.detection.field import _as_sure_as
from spherex_explorer.detection.sources import (
    MARGIN,
    brightness,
    centroids,
    peaks,
    signal_to_noise,
)
from spherex_explorer.detection.stack import average, without_outliers


def nearest(field, x: float, y: float):
    return min(field.sources, key=lambda source: np.hypot(source.x - x, source.y - y))


# --- stacks


def test_an_accident_of_one_exposure_is_removed_from_the_stack():
    rng = np.random.default_rng(0)
    values = rng.normal(1.0, 0.01, (9, 8, 8))
    values[4, 3, 3] = 50.0

    cleaned = without_outliers(values)

    assert np.isnan(cleaned[4, 3, 3])
    # A scatter drawn from nine values is rough: a few ordinary values go with the accident.
    assert np.isfinite(cleaned).mean() > 0.95
    assert average(cleaned)[3, 3] == pytest.approx(1.0, abs=0.02)


def test_few_frames_are_cleaned_by_their_median():
    values = np.ones((3, 4, 4))
    values[1, 2, 2] = 50.0

    assert without_outliers(values) is values
    assert average(values)[2, 2] == 1.0


def test_a_pixel_seen_in_too_few_frames_has_no_average():
    values = np.ones((6, 4, 4))
    values[:4, 0, 0] = np.nan
    values[:3, 1, 1] = np.nan

    stacked = average(values)

    assert np.isnan(stacked[0, 0])
    assert stacked[1, 1] == 1.0
    assert np.isnan(average(np.ones((0, 4, 4)))).all()


# --- sources


def test_sources_are_found_brightest_first_and_never_near_the_edge():
    rng = np.random.default_rng(2)
    image = rng.normal(0.0, NOISE, (SIZE, SIZE))
    image += star(30.0, 40.0, 20.0) + star(60.0, 50.0, 5.0) + star(3.0, 3.0, 20.0)

    found = peaks(signal_to_noise(image))

    assert [(x, y) for x, y, _ in found[:2]] == [(30.0, 40.0), (60.0, 50.0)]
    assert found[0][2] > found[1][2] > 5
    assert all(MARGIN <= x < SIZE - MARGIN and MARGIN <= y < SIZE - MARGIN for x, y, _ in found)


def test_two_peaks_too_close_are_one_source():
    image = star(40.0, 40.0, 20.0) + star(43.0, 40.0, 10.0)
    image += np.random.default_rng(3).normal(0.0, NOISE, image.shape)

    found = peaks(signal_to_noise(image))

    assert len([peak for peak in found if abs(peak[1] - 40) < 6 and abs(peak[0] - 41) < 8]) == 1


def test_a_position_is_found_to_a_small_fraction_of_a_pixel():
    image = star(40.37, 51.81, 30.0) + star(70.5, 20.25, 30.0)

    x, y = centroids(image, np.array([40.0, 71.0]), np.array([52.0, 20.0]))

    assert x == pytest.approx([40.37, 70.5], abs=0.02)
    assert y == pytest.approx([51.81, 20.25], abs=0.02)


def test_a_position_follows_a_source_a_few_pixels_away():
    image = star(43.2, 50.0, 30.0)

    x, y = centroids(image, np.array([40.0]), np.array([50.0]))

    assert x[0] == pytest.approx(43.2, abs=0.03)
    assert y[0] == pytest.approx(50.0, abs=0.03)


def test_no_position_without_a_heart_or_without_a_source():
    image = star(40.0, 40.0, 30.0)
    image[39:42, 39:42] = np.nan
    empty = np.random.default_rng(4).normal(0.0, NOISE, (SIZE, SIZE))

    holed_x, _ = centroids(image, np.array([40.0]), np.array([40.0]))
    outside_x, outside_y = centroids(empty, np.array([np.nan, 500.0]), np.array([10.0, 10.0]))
    nothing_x, nothing_y = centroids(empty, np.array([]), np.array([]))

    assert np.isnan(holed_x[0])
    assert np.isnan(outside_x).all() and np.isnan(outside_y).all()
    assert nothing_x.size == 0 and nothing_y.size == 0


def test_no_position_for_a_source_that_ends_at_the_edge_of_the_image():
    image = star(MARGIN - 2.0, 40.0, 30.0) + star(60.0, SIZE - 1 - MARGIN + 1.5, 30.0)
    image += star(MARGIN + 0.5, 70.0, 30.0)

    x, y = centroids(
        image, np.array([MARGIN, 60.0, MARGIN + 1.0]), np.array([40.0, SIZE - 1 - MARGIN, 70.0])
    )

    assert np.isnan(x[:2]).all() and np.isnan(y[:2]).all()
    assert x[2] == pytest.approx(MARGIN + 0.5, abs=0.03)


def test_brightness_follows_the_light_of_the_source_and_ignores_the_sky():
    rng = np.random.default_rng(5)
    pile = np.stack(
        [
            star(40.3, 40.6, light) + 7.0 + rng.normal(0.0, NOISE, (SIZE, SIZE))
            for light in (10.0, 20.0, 40.0)
        ]
    )
    pile[2, 41, 41] = np.nan

    light, noise = brightness(pile, 40.3, 40.6)

    assert light[1] / light[0] == pytest.approx(2.0, rel=0.05)
    assert light[0] == pytest.approx(10.0, rel=0.05)
    assert np.isnan(light[2]) and np.isnan(noise[2])
    assert (noise[:2] > 0).all()
    # The noise given is that of the sum, not below what the pixels show.
    assert noise[0] >= NOISE * np.sqrt(np.pi * 5.5**2)
    assert np.isnan(brightness(pile, np.nan, 40.0)[0]).all()
    assert np.isnan(brightness(pile, 400.0, 40.0)[0]).all()


# --- the field


def test_a_source_that_moves_is_found_with_its_rate_and_the_others_are_not():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0 + 1.5 * (visit - 2), 50.0 - 0.5 * (visit - 2), 30.0)]

    field = measure_field(field_frames(scene))
    candidates = find_candidates(field)

    assert [visit.pass_number for visit in field.visits] == [1, 2, 3]
    assert field.visits[0].frames == 16
    assert len(field.sources) == 7
    assert len(candidates) == 1
    found = candidates[0]
    assert (found.kind, found.confidence) == (MOVED, HIGH)
    motion = found.source.motion
    assert motion.shift_x == pytest.approx(3.0, abs=0.15)
    assert motion.shift_y == pytest.approx(-1.0, abs=0.15)
    assert motion.days == pytest.approx(365.2, abs=4)
    assert motion.significance > 20
    assert [sighting.pass_number for sighting in found.source.sightings] == [1, 2, 3]
    assert found.source.sightings[0].x == pytest.approx(43.5, abs=0.1)
    assert found.source.sightings[0].detectors == (2, 5)
    steady = [source for source in field.sources if source is not found.source]
    assert max(source.motion.significance for source in steady) < 4
    assert max(np.hypot(s.motion.shift_x, s.motion.shift_y) for s in steady) < 0.1


def test_the_same_frames_give_the_same_answer():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0 + visit, 50.0, 30.0)]

    frames = field_frames(scene)

    assert measure_field(frames) == measure_field(frames)


def test_a_steady_field_has_no_candidate():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0, 50.0, 3.0), (60.0, 30.0, 1.0)]

    field = measure_field(field_frames(scene, seed=7))

    assert len(field.sources) >= 7
    assert find_candidates(field) == ()


def test_two_visits_make_a_claim_that_is_never_firm():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0 + 2.0 * visit, 50.0, 30.0)]

    candidates = find_candidates(measure_field(field_frames(scene, visits=(1, 2))))

    assert [(found.kind, found.confidence) for found in candidates] == [(MOVED, MEDIUM)]
    assert candidates[0].source.motion.shift_x == pytest.approx(2.0, abs=0.1)


def test_two_visits_need_twice_the_evidence_of_three():
    # A faint source that moves: clear enough over three visits, not over two.
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0 + 0.7 * visit, 50.0, 0.9)]

    three = measure_field(field_frames(scene, detectors=(2,), seed=5))
    two = measure_field(field_frames(scene, detectors=(2,), visits=(1, 3), seed=5))

    assert 5 < nearest(two, 46.4, 50.0).motion.significance < 10
    assert find_candidates(two) == ()
    assert [found.kind for found in find_candidates(three)] == [MOVED]


def test_a_source_pushed_aside_in_one_visit_did_not_move():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0 + (1.5 if visit == 2 else 0.0), 50.0, 30.0)]

    field = measure_field(field_frames(scene))

    assert find_candidates(field) == ()
    assert nearest(field, 45.5, 50.0).motion.significance < 5


def test_a_shift_under_one_arcsecond_is_not_claimed():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0 + 0.12 * visit, 50.0, 60.0)]

    field = measure_field(field_frames(scene, noise=0.002))

    assert nearest(field, 45.2, 50.0).motion.significance > 5
    assert find_candidates(field) == ()


def test_a_cold_object_in_front_of_a_star_is_followed_in_the_detector_that_shows_it():
    def scene(detector, visit, wavelength):
        stars = steady_stars()
        if detector == 2:
            return [*stars, (46.0, 50.5, 20.0)]
        return [*stars, (45.0 + 1.5 * (visit - 2), 50.0, 20.0)]

    candidates = find_candidates(measure_field(field_frames(scene)))

    assert [found.kind for found in candidates] == [MOVED]
    source = candidates[0].source
    assert {sighting.detectors for sighting in source.sightings} == {(5,)}
    assert source.motion.shift_x == pytest.approx(3.0, abs=0.2)


def test_a_source_whose_light_changes_in_two_detectors_is_found():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0, 50.0, 30.0 * (0.6 if visit == 3 else 1.0))]

    field = measure_field(field_frames(scene))
    candidates = find_candidates(field)

    assert [(found.kind, found.confidence) for found in candidates] == [(CHANGED, HIGH)]
    found = candidates[0]
    assert {change.detector for change in found.changes} == {2, 5}
    assert all(change.to_pass == 3 for change in found.changes)
    assert found.changes[0].ratio == pytest.approx(0.6, abs=0.05)
    assert found.changes[0].pairs == 8
    assert found.changes[0].wavelength_um == pytest.approx((2.0, 2.5)) or found.changes[
        0
    ].wavelength_um == pytest.approx((5.0, 5.5))
    steady = [source for source in field.sources if source is not found.source]
    assert max(change.significance for source in steady for change in source.changes) < 5


def test_a_change_in_one_detector_alone_is_not_believed():
    def scene(detector, visit, wavelength):
        dimmed = 0.5 if (visit == 2 and detector == 5) else 1.0
        return [*steady_stars(), (45.0, 50.0, 30.0 * dimmed)]

    field = measure_field(field_frames(scene))

    assert max(change.significance for change in nearest(field, 45.0, 50.0).changes) > 5
    assert find_candidates(field) == ()


def test_the_color_of_a_source_is_not_a_change():
    # Twice as bright at one end of the band as at the other, and each visit looks at
    # the band in its own order: the visits are compared wavelength by wavelength.
    def scene(detector, visit, wavelength):
        slope = 1.0 + 2.0 * (wavelength - detector)
        return [*steady_stars(), (45.0, 50.0, 30.0 * slope)]

    field = measure_field(field_frames(scene))

    changes = nearest(field, 45.0, 50.0).changes
    assert len(changes) == 6
    assert all(change.ratio == pytest.approx(1.0, abs=0.05) for change in changes)
    assert find_candidates(field) == ()


def test_what_the_instrument_does_to_every_source_is_not_a_change():
    def scene(detector, visit, wavelength):
        gain = 0.8 if visit == 2 else 1.0
        return [(x, y, light * gain) for x, y, light in [*steady_stars(), (45.0, 50.0, 30.0)]]

    assert find_candidates(measure_field(field_frames(scene))) == ()


def test_a_saturated_star_is_reported_and_nothing_is_measured_around_it():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (48.0, 48.0, 5000.0), (58.0, 48.0, 30.0 + 20.0 * visit)]

    frames = field_frames(scene)
    for frame in frames:
        if frame.detector == 2:
            frame.image[45:52, 45:52] = np.nan
            frame.mask[44:53, 44:53] |= OVERFLOW

    field = measure_field(frames)

    assert len(field.saturated) == 1
    saturated = field.saturated[0]
    assert (saturated.x, saturated.y) == pytest.approx((48.0, 48.0), abs=0.01)
    assert saturated.detectors == (2,)
    assert saturated.radius == pytest.approx(np.sqrt(49 / np.pi), abs=0.01)
    bright = nearest(field, 48.0, 48.0)
    assert {sighting.detectors for sighting in bright.sightings} == {(5,)}
    # The neighbor ten pixels away changes, and is lost in the light of the star.
    assert find_candidates(field) == ()


def test_a_star_near_saturation_has_a_less_certain_position():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0, 50.0, 300.0)]

    plain = field_frames(scene)
    flagged = field_frames(scene)
    for frame in flagged:
        frame.mask[49:52, 44:47] |= OVERFLOW

    sure = nearest(measure_field(plain), 45.0, 50.0).sightings[0].error
    unsure = nearest(measure_field(flagged), 45.0, 50.0).sightings[0].error

    assert sure < 0.05
    assert unsure > 0.2


def test_frames_without_a_background_and_empty_lists_are_handled():
    def scene(detector, visit, wavelength):
        return steady_stars()

    frames = field_frames(scene, detectors=(2,), visits=(1,))
    blind = [
        FieldFrame(
            detector=f.detector,
            pass_number=f.pass_number,
            time_mjd=f.time_mjd,
            wavelength_um=f.wavelength_um,
            bandwidth_um=f.bandwidth_um,
            background=None,
            image=f.image,
            mask=f.mask,
        )
        for f in frames
    ]

    empty = measure_field([])
    unseen = measure_field(blind)
    single = measure_field(frames)

    assert (empty.visits, empty.sources, empty.saturated) == ((), (), ())
    assert unseen.sources == ()
    assert len(single.sources) == 6
    assert all(source.motion is None and source.changes == () for source in single.sources)
    assert find_candidates(single) == ()


# --- the swing of a nearby object


def test_the_parallax_of_a_nearby_object_is_measured_with_its_motion():
    def scene(detector, visit, wavelength):
        swing_x, swing_y = seasons(np.array(60800.0 + 182.6 * (visit - 1)))
        x = 45.0 + 0.9 * (visit - 2) + 0.25 * swing_x
        y = 50.0 - 0.4 * (visit - 2) + 0.25 * swing_y
        return [*steady_stars(), (float(x), float(y), 30.0)]

    frames = field_frames(scene, visits=(1, 2, 3, 4))
    with_swing = find_candidates(measure_field(frames, seasons))
    without = find_candidates(measure_field(frames))

    assert [(found.kind, found.confidence) for found in with_swing] == [(MOVED, HIGH)]
    motion = with_swing[0].source.motion
    assert motion.parallax == pytest.approx(0.25, abs=0.03)
    assert 0 < motion.parallax_error < 0.03
    assert motion.rate_x * 182.6 == pytest.approx(0.9, abs=0.03)
    assert motion.rate_y * 182.6 == pytest.approx(-0.4, abs=0.03)
    # Without the swing the object is still found, with a line that fits less well.
    assert [found.kind for found in without] == [MOVED]
    assert without[0].source.motion.parallax is None
    assert without[0].significance < with_swing[0].significance


def test_no_parallax_is_given_to_a_source_that_does_not_ask_for_one():
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0 + 1.5 * (visit - 2), 50.0, 30.0)]

    field = measure_field(field_frames(scene), seasons)

    assert all(source.motion.parallax is None for source in field.sources)
    assert [found.kind for found in find_candidates(field)] == [MOVED]


def test_one_detector_and_three_visits_cannot_tell_a_swing_from_an_accident():
    # The source jumps once and stays: a line and a swing together would fit it.
    def scene(detector, visit, wavelength):
        return [*steady_stars(), (45.0 + (1.3 if visit == 1 else 0.0), 50.0, 30.0)]

    field = measure_field(field_frames(scene, detectors=(2,)), seasons)

    assert nearest(field, 45.4, 50.0).motion.parallax is None
    assert find_candidates(field) == ()


@pytest.mark.parametrize(
    ("ratio", "freedom", "sigma"),
    [(4.303, 2, 1.96), (2.228, 10, 1.96), (9.925, 2, 2.576), (5.0, 1000, 5.0)],
)
def test_a_ratio_drawn_from_few_leftovers_counts_for_less(ratio, freedom, sigma):
    assert _as_sure_as(ratio, freedom) == pytest.approx(sigma, abs=0.12)
