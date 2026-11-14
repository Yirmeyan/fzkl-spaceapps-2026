import asyncio

import pytest

from conftest import BARNARD
from spherex_explorer.archive import Exposure, parse_sia_response
from spherex_explorer.pipeline import list_exposures, number_passes
from spherex_explorer.pipeline.exposures import FIRST_GUESS_MJD
from spherex_explorer.targets import Target, position_at


class FakeArchive:
    """Archive that answers its lists in turn and remembers where it was asked to look."""

    def __init__(self, *answers):
        self.answers = [list(answer) for answer in answers]
        self.searched: list[tuple[float, float]] = []

    async def find_exposures(self, ra: float, dec: float) -> list[Exposure]:
        self.searched.append((ra, dec))
        # The last answer is repeated, for the tests where the position does not matter.
        answer = self.answers[0] if len(self.answers) == 1 else self.answers.pop(0)
        return list(answer)


def exposure(time_mjd: float, detector: int = 1, number: int = 1) -> Exposure:
    return Exposure(
        id=f"qr3.2026W33_2A_{number:04d}_1D{detector}.l2b-v27-2026-241",
        collection="qr3",
        detector=detector,
        time_mjd=time_mjd,
    )


def listing(archive, target, fov_deg=0.1, size=128):
    return asyncio.run(list_exposures(archive, target, fov_deg=fov_deg, size=size))


def test_exposures_more_than_30_days_apart_are_two_passes():
    times = [100.0, 101.0, 131.0, 161.5, 162.0, 400.0]

    numbered = number_passes([exposure(time) for time in times])

    # 101 to 131 is exactly 30 days: still the same pass.
    assert [item.pass_number for item in numbered] == [1, 1, 1, 2, 2, 3]


def test_exposures_are_sorted_by_time_then_by_detector():
    archive = FakeArchive(
        [exposure(200.0, 3, 2), exposure(100.0, 6, 1), exposure(100.0, 2, 1), exposure(150.0, 1, 3)]
    )

    result = listing(archive, Target(ra=10.0, dec=20.0))

    assert [(item.exposure.time_mjd, item.exposure.detector) for item in result.exposures] == [
        (100.0, 2),
        (100.0, 6),
        (150.0, 1),
        (200.0, 3),
    ]


def test_fixed_target_is_searched_once_and_centered_where_it_was_asked():
    archive = FakeArchive([exposure(100.0), exposure(300.0)])

    result = listing(archive, Target(ra=10.0, dec=20.0), fov_deg=0.25, size=64)

    assert archive.searched == [(10.0, 20.0)]
    assert (result.grid.ra, result.grid.dec) == (10.0, 20.0)
    assert (result.grid.fov_deg, result.grid.size) == (0.25, 64)


def test_moving_target_is_searched_again_where_it_was_when_observed():
    target = Target(**BARNARD)
    first = [exposure(60900.0), exposure(61300.0)]
    second = [exposure(60900.0), exposure(61100.0), exposure(61400.0)]
    archive = FakeArchive(first, second)

    result = listing(archive, target)

    # 61100 is the middle of the first list, 61150 the middle of the second one.
    assert archive.searched == [position_at(target, FIRST_GUESS_MJD), position_at(target, 61100.0)]
    assert len(result.exposures) == 3
    expected_ra, expected_dec = position_at(target, 61150.0)
    assert result.grid.ra == pytest.approx(expected_ra, abs=1e-6)
    assert result.grid.dec == pytest.approx(expected_dec, abs=1e-6)


def test_moving_target_found_where_it_was_expected_is_searched_once():
    target = Target(**BARNARD)
    archive = FakeArchive([exposure(FIRST_GUESS_MJD - 10), exposure(FIRST_GUESS_MJD + 10)])

    listing(archive, target)

    assert len(archive.searched) == 1


def test_first_list_is_kept_when_the_second_search_finds_nothing():
    target = Target(**BARNARD)
    archive = FakeArchive([exposure(60900.0), exposure(61300.0)], [])

    result = listing(archive, target)

    assert len(archive.searched) == 2
    assert len(result.exposures) == 2


def test_place_never_observed_gives_an_empty_list_centered_on_the_target():
    archive = FakeArchive([])

    result = listing(archive, Target(**BARNARD))

    assert len(archive.searched) == 1
    assert result.exposures == ()
    assert (result.grid.ra, result.grid.dec) == (BARNARD["ra"], BARNARD["dec"])


def test_barnards_star_has_364_exposures_on_6_detectors_in_3_passes(sia_payload):
    recorded = parse_sia_response(sia_payload, bucket="nasa-irsa-spherex").exposures

    result = listing(FakeArchive(recorded), Target(**BARNARD))

    assert len(result.exposures) == 364
    assert {item.exposure.detector for item in result.exposures} == {1, 2, 3, 4, 5, 6}
    assert {item.pass_number for item in result.exposures} == {1, 2, 3}


def test_listing_matches_the_sample_file_of_the_contract(sia_payload, sample_bundle):
    recorded = parse_sia_response(sia_payload, bucket="nasa-irsa-spherex").exposures

    result = listing(FakeArchive(recorded), Target(**BARNARD))

    detector_2 = [item for item in result.exposures if item.exposure.detector == 2]
    expected = sample_bundle["exposures"]
    assert [item.exposure.id for item in detector_2] == [entry["id"] for entry in expected]
    assert [item.pass_number for item in detector_2] == [entry["pass"] for entry in expected]
    for item, entry in zip(detector_2, expected, strict=True):
        assert item.exposure.time_mjd == pytest.approx(entry["time_mjd"], abs=1e-6)
    assert result.grid.ra == pytest.approx(sample_bundle["grid"]["ra"], abs=1e-6)
    assert result.grid.dec == pytest.approx(sample_bundle["grid"]["dec"], abs=1e-6)
