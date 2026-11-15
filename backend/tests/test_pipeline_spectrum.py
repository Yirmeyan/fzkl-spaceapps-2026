import asyncio

import numpy as np
import pytest

from level2_file import (
    HEIGHT,
    MJD,
    SKY_CENTER,
    WIDTH,
    FakeStorage,
    build_level2_file,
    detector_position,
    star,
)
from spherex_explorer.archive import Exposure, Level2Reader, key_from_id
from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.frames import Grid, wavelength_at
from spherex_explorer.pipeline import build_frame, measure_spectrum
from spherex_explorer.targets import Target

ARCSEC = 1 / 3600
# A star 20 arcseconds north-east of the middle of the detector.
STAR = (
    SKY_CENTER[0] + 15 * ARCSEC / np.cos(np.radians(SKY_CENTER[1])),
    SKY_CENTER[1] + 13 * ARCSEC,
)
TARGET = Target(ra=STAR[0], dec=STAR[1])
IDS = [
    "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229",
    "dr1.2025W34_2B_0091_1D5.l2b-v27-2026-229",
    "qr3.2026W10_1A_0007_2D2.l2b-v27-2026-241",
    "qr3.2026W10_1A_0008_3D5.l2b-v27-2026-241",
]


class FakeArchive:
    def __init__(self, identifiers=IDS):
        self.identifiers = identifiers

    async def find_exposures(self, ra: float, dec: float) -> list[Exposure]:
        return [
            Exposure(
                id=identifier,
                collection=identifier.split(".")[0],
                detector=int(identifier.split(".")[1][-1]),
                time_mjd=MJD + (200.0 if identifier.startswith("qr3") else 0.0) + index / 100,
            )
            for index, identifier in enumerate(self.identifiers)
        ]


class BusyStorage:
    """A storage that fails on the files it is told to."""

    def __init__(self, storage: FakeStorage, busy: set[str]):
        self.storage = storage
        self.busy = busy

    async def read(self, key: str, start: int, length: int) -> bytes:
        if key in self.busy:
            raise UpstreamUnavailable("The SPHEREx file storage", "HTTP 503", retry_after_s=5)
        return await self.storage.read(key, start, length)

    async def read_tail(self, key: str, length: int) -> bytes:
        return await self.storage.read_tail(key, length)


@pytest.fixture(scope="module")
def content() -> bytes:
    image = np.random.default_rng(3).normal(0.3, 0.02, (HEIGHT, WIDTH))
    image += star((HEIGHT, WIDTH), *detector_position(*STAR), 50.0, 1.3)
    return build_level2_file(image=image, flags=np.zeros((HEIGHT, WIDTH), dtype=np.int32))


def storage_of(content: bytes, identifiers=IDS) -> FakeStorage:
    return FakeStorage({key_from_id(identifier): content for identifier in identifiers})


def spectrum_of(storage, target: Target = TARGET, archive=None, **options):
    reader = Level2Reader(storage)
    return asyncio.run(measure_spectrum(archive or FakeArchive(), reader, target, **options))


def test_spectrum_has_one_point_per_exposure_in_the_order_of_the_list(content):
    spectrum = spectrum_of(storage_of(content))

    assert [point.listed.exposure.id for point in spectrum.points] == IDS
    assert [point.listed.pass_number for point in spectrum.points] == [1, 1, 2, 2]
    assert spectrum.target == TARGET
    assert all(point.photometry.quality == "ok" for point in spectrum.points)
    assert all(point.time_mjd == pytest.approx(MJD) for point in spectrum.points)


def test_points_follow_the_dates_their_files_give(content):
    # Two detectors expose together, and their files give dates a fraction of a second
    # apart. Here the file of the first exposure of the list gives the later one.
    image = np.random.default_rng(3).normal(0.3, 0.02, (HEIGHT, WIDTH))
    flags = np.zeros((HEIGHT, WIDTH), dtype=np.int32)
    a_moment_later = build_level2_file(image=image, flags=flags, mjd=MJD + 2e-6)
    storage = FakeStorage(
        {key_from_id(IDS[0]): a_moment_later, key_from_id(IDS[1]): content},
    )

    spectrum = spectrum_of(storage, archive=FakeArchive(IDS[:2]))

    assert [point.listed.exposure.id for point in spectrum.points] == [IDS[1], IDS[0]]
    dates = [point.time_mjd for point in spectrum.points]
    assert dates == sorted(dates)


def test_point_is_the_measurement_of_the_frame_of_the_same_exposure(content):
    storage = storage_of(content)
    grid = Grid(ra=STAR[0], dec=STAR[1], fov_deg=0.05, size=64)
    frame = asyncio.run(build_frame(Level2Reader(storage), IDS[0], TARGET, grid))

    point = spectrum_of(storage).points[0]

    assert point.photometry.flux_mjy == pytest.approx(frame.photometry.flux_mjy, rel=1e-6)
    assert point.photometry.error_mjy == pytest.approx(frame.photometry.error_mjy, rel=1e-6)
    # The grid of that frame is centered on the target: both read the same wavelength.
    assert point.wavelength_um == pytest.approx(frame.wavelength_um)
    assert point.bandwidth_um == pytest.approx(frame.bandwidth_um)


def test_wavelength_is_the_one_at_the_place_of_the_target_on_the_detector(content):
    storage = storage_of(content)
    table = asyncio.run(Level2Reader(storage).wavelength_table(IDS[0]))

    point = spectrum_of(storage).points[0]

    assert point.wavelength_um == pytest.approx(wavelength_at(table, *detector_position(*STAR))[0])


def test_one_detector_can_be_asked_alone(content):
    spectrum = spectrum_of(storage_of(content), detector=5)

    assert [point.listed.exposure.id for point in spectrum.points] == [IDS[1], IDS[3]]
    # Passes are numbered on all the exposures, whatever the detector asked.
    assert [point.listed.pass_number for point in spectrum.points] == [1, 2]


def test_spectrum_reads_far_less_than_the_frames_of_the_same_exposures(content):
    for_frames, for_spectrum = storage_of(content, IDS[:1]), storage_of(content, IDS[:1])
    grid = Grid(ra=SKY_CENTER[0], dec=SKY_CENTER[1], fov_deg=0.1, size=128)
    asyncio.run(build_frame(Level2Reader(for_frames), IDS[0], TARGET, grid))

    spectrum_of(for_spectrum, archive=FakeArchive(IDS[:1]))

    def pixels_read(storage):
        # The first three reads give the layout of the file, the same for both.
        return sum(length for _, _, length in storage.reads[3:])

    assert pixels_read(for_spectrum) < 0.6 * pixels_read(for_frames)


def test_target_off_the_detector_gives_a_point_without_value_and_reads_no_pixel(content):
    storage = storage_of(content, IDS[:1])
    away = Target(ra=SKY_CENTER[0] + 1.0, dec=SKY_CENTER[1])

    point = spectrum_of(storage, target=away, archive=FakeArchive(IDS[:1])).points[0]

    assert (point.photometry.quality, point.photometry.flux_mjy) == ("outside", None)
    assert (point.wavelength_um, point.bandwidth_um) == (None, None)
    # The three reads that give the layout of the file, and nothing else.
    assert len(storage.reads) == 3


def test_target_that_moves_is_measured_where_it_was(content):
    # A target that was 41 arcseconds away in 2000 and reaches the star at the date
    # of the exposures, at 1.6 arcsecond a year toward the north.
    years = (MJD - 51544.5) / 365.25
    moving = Target(ra=STAR[0], dec=STAR[1] - 1.6 * years * ARCSEC, epoch=2000.0, pm_dec=1600.0)
    still = Target(ra=STAR[0], dec=STAR[1] - 1.6 * years * ARCSEC)

    followed = spectrum_of(
        storage_of(content, IDS[:1]), target=moving, archive=FakeArchive(IDS[:1])
    )
    left_behind = spectrum_of(
        storage_of(content, IDS[:1]), target=still, archive=FakeArchive(IDS[:1])
    )

    fixed = spectrum_of(storage_of(content, IDS[:1]), archive=FakeArchive(IDS[:1]))
    assert followed.points[0].photometry.flux_mjy == pytest.approx(
        fixed.points[0].photometry.flux_mjy, rel=0.01
    )
    assert left_behind.points[0].photometry.flux_mjy < 0.1 * fixed.points[0].photometry.flux_mjy


def test_exposure_whose_file_is_gone_gives_no_point(content):
    spectrum = spectrum_of(storage_of(content, IDS[:3]))

    assert [point.listed.exposure.id for point in spectrum.points] == IDS[:3]


def test_a_few_unreadable_files_leave_a_spectrum_with_fewer_points(content):
    storage = BusyStorage(storage_of(content), busy={key_from_id(IDS[1])})

    spectrum = spectrum_of(storage)

    assert [point.listed.exposure.id for point in spectrum.points] == [IDS[0], IDS[2], IDS[3]]


def test_storage_that_fails_on_most_files_is_reported_as_unavailable(content):
    storage = BusyStorage(storage_of(content), busy={key_from_id(i) for i in IDS[:3]})

    with pytest.raises(UpstreamUnavailable) as failure:
        spectrum_of(storage)

    assert "3 exposures of 4" in failure.value.reason


def test_place_never_observed_gives_an_empty_spectrum(content):
    spectrum = spectrum_of(storage_of(content), archive=FakeArchive([]))

    assert spectrum.points == ()
