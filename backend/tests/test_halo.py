"""The halo of a saturated star: what a ring around its heart tells of its light."""

import numpy as np
import pytest

from made_up_field import SIZE, halo, star
from spherex_explorer.detection.halo import halo_light, ring_starts, steady_within

CENTER = 48.0


def pile(lights, skies=None, seed=3) -> np.ndarray:
    """Frames of a bright star at the center, one per brightness, each over its own sky."""
    rng = np.random.default_rng(seed)
    skies = skies if skies is not None else [0.3] * len(lights)
    frames = [
        halo(CENTER, CENTER, light) + sky + rng.normal(0.0, 0.002, (SIZE, SIZE))
        for light, sky in zip(lights, skies, strict=True)
    ]
    return np.array(frames, dtype=np.float32)


def test_the_rings_start_outside_the_heart_and_never_too_close():
    assert ring_starts(2.0) == (13.0, 20.0)
    assert ring_starts(10.0) == (16.0, 23.0)


def test_the_halo_follows_the_light_of_the_star_whatever_the_sky():
    frames = pile([10.0, 5.0, 20.0], skies=[0.3, 0.8, 0.1])

    for start in ring_starts(4.0):
        light = halo_light(frames, CENTER, CENTER, start)
        assert light[0] > 0.02
        assert light[1] / light[0] == pytest.approx(0.5, rel=0.03)
        assert light[2] / light[0] == pytest.approx(2.0, rel=0.03)


def test_a_neighbor_and_a_spike_in_the_ring_do_not_count():
    alone = pile([10.0])
    busy = alone.copy()
    busy[0] += star(CENTER + 16.0, CENTER, 40.0)
    busy[0, 47:50, :] += 0.5

    start = ring_starts(4.0)[0]
    assert halo_light(busy, CENTER, CENTER, start)[0] == pytest.approx(
        halo_light(alone, CENTER, CENTER, start)[0], rel=0.1
    )


def test_no_halo_where_too_little_of_the_ring_can_be_read():
    frames = pile([10.0, 10.0])
    frames[1, :, :44] = np.nan
    start = ring_starts(4.0)[0]

    light = halo_light(frames, CENTER, CENTER, start)
    assert np.isfinite(light[0])
    assert np.isnan(light[1])
    # Too close to the edge of the image, with no place given, or too wide a heart.
    assert np.isnan(halo_light(frames, 3.0, CENTER, start)).all()
    assert np.isnan(halo_light(frames, np.nan, CENTER, start)).all()
    assert np.isnan(halo_light(frames, CENTER, CENTER, 32.0)).all()


def test_the_halo_of_a_steady_star_wanders_less_in_the_last_detectors():
    assert steady_within(5) < steady_within(2)
    assert steady_within(9) == steady_within(2)
