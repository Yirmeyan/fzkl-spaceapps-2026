"""Pipeline of the candidates: from the exposures of a target to a report on its field."""

import asyncio

import numpy as np
import pytest

from level2_file import MJD, SKY_CENTER, FakeStorage, build_level2_file
from made_up_field import field_frames, steady_stars
from spherex_explorer.archive import Exposure, Level2Reader, key_from_id
from spherex_explorer.detection import MOVED
from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.frames import Grid
from spherex_explorer.pipeline import (
    FieldMemory,
    ListedExposure,
    build_frame,
    field_frame,
    find_field_candidates,
    report_field,
)
from spherex_explorer.targets import Target, parallax_shift

TARGET = Target(ra=SKY_CENTER[0], dec=SKY_CENTER[1])
GRID = Grid(ra=133.76, dec=-7.24, fov_deg=96 * 2.8125 / 3600, size=96)
# Three visits of two detectors, four exposures each.
IDS = [
    f"dr1.2025W{week}_2B_{number:04d}_1D{detector}.l2b-v27-2026-229"
    for week in (20, 46, 72)
    for detector in (2, 5)
    for number in range(4)
]


class FakeArchive:
    def __init__(self, identifiers):
        self.identifiers = identifiers

    async def find_exposures(self, ra: float, dec: float) -> list[Exposure]:
        return [
            Exposure(
                id=identifier,
                collection="dr1",
                detector=int(identifier.split(".")[1][-1]),
                time_mjd=MJD + 7.0 * (int(identifier[9:11]) - 20) + index / 100,
            )
            for index, identifier in enumerate(self.identifiers)
        ]


def storage(identifiers=IDS, missing=()):
    content = build_level2_file(flags=np.zeros((72, 96), dtype=np.int32))
    return FakeStorage({key_from_id(i): content for i in identifiers if i not in missing})


def test_a_frame_goes_to_the_detection_with_its_detector_and_its_visit():
    exposure = Exposure(id=IDS[0], collection="dr1", detector=2, time_mjd=MJD)
    listed = ListedExposure(exposure=exposure, pass_number=3)
    grid = Grid(ra=SKY_CENTER[0], dec=SKY_CENTER[1], fov_deg=0.05, size=64)
    frame = asyncio.run(build_frame(Level2Reader(storage(IDS[:1])), IDS[0], TARGET, grid))

    seen = field_frame(listed, frame)

    assert (seen.detector, seen.pass_number) == (2, 3)
    assert (seen.time_mjd, seen.wavelength_um, seen.bandwidth_um) == (
        frame.time_mjd,
        frame.wavelength_um,
        frame.bandwidth_um,
    )
    assert seen.background == frame.background
    assert seen.image is frame.image and seen.mask is frame.mask


def test_every_exposure_of_the_view_is_read_and_the_field_is_reported():
    report = asyncio.run(find_field_candidates(FakeArchive(IDS), Level2Reader(storage()), TARGET))

    assert report.target == TARGET
    assert (report.grid.ra, report.grid.dec) == SKY_CENTER
    assert (report.grid.fov_deg, report.grid.size) == (0.1, 128)
    assert report.frames == len(IDS)
    assert [(visit.pass_number, visit.frames) for visit in report.field.visits] == [
        (1, 8),
        (2, 8),
        (3, 8),
    ]
    # The same file stands for every exposure: nothing moves and nothing changes.
    assert report.candidates == ()


def test_an_exposure_whose_file_is_gone_is_left_out():
    source = Level2Reader(storage(missing=IDS[:3]))

    report = asyncio.run(find_field_candidates(FakeArchive(IDS), source, TARGET))

    assert report.frames == len(IDS) - 3
    assert report.field.visits[0].frames == 5


def test_a_place_never_observed_gives_an_empty_report():
    report = asyncio.run(find_field_candidates(FakeArchive([]), Level2Reader(storage()), TARGET))

    assert report.frames == 0
    assert (report.field.visits, report.field.sources, report.candidates) == ((), (), ())


def test_too_many_files_that_cannot_be_read_stop_the_report():
    class Busy:
        async def layout(self, exposure_id):
            raise UpstreamUnavailable("The SPHEREx file storage", "HTTP 503", retry_after_s=5)

    with pytest.raises(UpstreamUnavailable) as stopped:
        asyncio.run(find_field_candidates(FakeArchive(IDS), Busy(), TARGET))

    assert f"{len(IDS)} exposures of {len(IDS)}" in str(stopped.value)


def test_the_swing_of_a_nearby_object_is_read_on_the_grid_of_the_view():
    # A parallax of 0.6 arcsecond on top of a motion toward the west and the north.
    scale = GRID.scale_deg * 3600

    def scene(detector, visit, wavelength):
        date = 60800.0 + 182.6 * (visit - 1) + 1.5
        years = (date - 60800.0) / 365.25
        east, north = parallax_shift(GRID.ra, GRID.dec, np.array(date))
        x = 45.0 - (-2.0 * years + 0.6 * float(east)) / scale
        y = 50.0 - (0.5 * years + 0.6 * float(north)) / scale
        return [*steady_stars(), (x, y, 30.0)]

    report = report_field(TARGET, GRID, field_frames(scene, visits=(1, 2, 3, 4), noise=0.01))

    assert report.frames == 64
    assert [candidate.kind for candidate in report.candidates] == [MOVED]
    motion = report.candidates[0].source.motion
    assert motion.parallax * scale == pytest.approx(0.6, abs=0.1)
    assert -motion.rate_x * scale * 365.25 == pytest.approx(-2.0, abs=0.15)
    assert -motion.rate_y * scale * 365.25 == pytest.approx(0.5, abs=0.15)


# --- the memory of the fields


class Counted:
    """A measurement that counts its runs, and can be slow or fail."""

    def __init__(self, delay_s: float = 0.0, failure: Exception | None = None):
        self.runs = 0
        self.delay_s = delay_s
        self.failure = failure

    async def __call__(self):
        self.runs += 1
        await asyncio.sleep(self.delay_s)
        if self.failure is not None:
            raise self.failure
        return report_field(TARGET, GRID, [])


def test_a_field_asked_twice_is_measured_once():
    async def scenario():
        memory, measure = FieldMemory(), Counted(delay_s=0.01)
        together = await asyncio.gather(memory.report("a", measure), memory.report("a", measure))
        later = await memory.report("a", measure)
        other = await memory.report("b", measure)
        return measure.runs, together[0] is together[1] is later, other is later

    assert asyncio.run(scenario()) == (2, True, False)


def test_a_report_is_measured_again_once_it_is_stale():
    async def scenario():
        now = [0.0]
        memory, measure = FieldMemory(fresh_s=100.0, clock=lambda: now[0]), Counted()
        await memory.report("a", measure)
        now[0] = 100.0
        await memory.report("a", measure)
        now[0] = 201.0
        await memory.report("a", measure)
        return measure.runs

    assert asyncio.run(scenario()) == 2


def test_only_the_latest_fields_are_kept():
    async def scenario():
        memory, measure = FieldMemory(kept=2), Counted()
        for key in ("a", "b", "a", "c", "a", "b"):
            await memory.report(key, measure)
        return measure.runs

    # "b" was the oldest when "c" came, and is measured again when asked.
    assert asyncio.run(scenario()) == 4


def test_a_failure_is_given_to_everyone_waiting_and_is_not_kept():
    async def scenario():
        memory = FieldMemory()
        failing = Counted(delay_s=0.01, failure=UpstreamUnavailable("Storage", "HTTP 503", 5))
        results = await asyncio.gather(
            memory.report("a", failing), memory.report("a", failing), return_exceptions=True
        )
        working = Counted()
        await memory.report("a", working)
        return [type(result) for result in results], failing.runs, working.runs

    assert asyncio.run(scenario()) == ([UpstreamUnavailable, UpstreamUnavailable], 1, 1)


def test_a_request_that_gives_up_does_not_stop_the_measurement():
    async def scenario():
        memory, measure = FieldMemory(), Counted(delay_s=0.05)
        with pytest.raises(TimeoutError):
            async with asyncio.timeout(0.01):
                await memory.report("a", measure)
        await asyncio.sleep(0.1)
        await memory.report("a", measure)
        return measure.runs

    assert asyncio.run(scenario()) == 1


def test_few_fields_are_measured_at_the_same_time():
    async def scenario():
        memory = FieldMemory()
        running = peak = 0

        async def measure():
            nonlocal running, peak
            running += 1
            peak = max(peak, running)
            await asyncio.sleep(0.01)
            running -= 1
            return report_field(TARGET, GRID, [])

        await asyncio.gather(*(memory.report(key, measure) for key in "abcde"))
        return peak

    assert asyncio.run(scenario()) == 2
