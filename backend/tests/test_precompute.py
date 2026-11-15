import asyncio
import base64
import json

import numpy as np
import pytest

from level2_file import MJD, SKY_CENTER, FakeStorage, build_level2_file
from spherex_explorer.archive import Exposure, Level2Reader, key_from_id
from spherex_explorer.catalogs import CatalogSource, Cone
from spherex_explorer.errors import NotFound, UpstreamUnavailable
from spherex_explorer.precompute import (
    SYNTHETIC_TARGETS,
    TARGETS,
    BundleTarget,
    build_target,
    main,
    rebuild_candidates,
    rebuild_catalogs,
    write_catalog,
    write_index,
)
from spherex_explorer.synthetic import SyntheticBody
from spherex_explorer.targets import ResolvedTarget, Target

WANTED = BundleTarget("test-star", "Test Star", "TST 1")
IDS = [
    "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229",
    "dr1.2025W34_2B_0091_1D2.l2b-v27-2026-229",
    "qr3.2026W10_1A_0007_2D5.l2b-v27-2026-241",
    "qr3.2026W10_1A_0008_3D5.l2b-v27-2026-241",
]


class FakeResolver:
    async def resolve(self, name: str) -> ResolvedTarget:
        assert name == "TST 1"
        return ResolvedTarget(
            name=name,
            ra=SKY_CENTER[0] + 1e-9,
            dec=SKY_CENTER[1],
            epoch=2000.0,
            pm_ra=None,
            pm_dec=None,
        )


class FakeArchive:
    def __init__(self, identifiers):
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


async def no_wait(seconds: float) -> None:
    return None


def build(tmp_path, identifiers=IDS, missing=(), source=None, wanted=WANTED, **options):
    content = build_level2_file(flags=np.zeros((72, 96), dtype=np.int32))
    files = {key_from_id(i): content for i in identifiers if i not in missing}
    return asyncio.run(
        build_target(
            wanted,
            resolver=FakeResolver(),
            archive=FakeArchive(identifiers),
            frames=source or Level2Reader(FakeStorage(files)),
            output=tmp_path,
            fov_deg=0.05,
            size=64,
            sleep=no_wait,
            **options,
        )
    )


def test_one_file_per_detector_in_the_format_of_the_contract(tmp_path):
    entry = build(tmp_path)

    assert sorted(path.name for path in tmp_path.iterdir()) == [
        "test-star-candidates.json",
        "test-star-d2.json",
        "test-star-d5.json",
        "test-star-spectrum.json",
    ]
    bundle = json.loads((tmp_path / "test-star-d2.json").read_text(encoding="utf-8"))
    assert list(bundle) == [
        "format",
        "version",
        "generated",
        "target",
        "grid",
        "exposures",
        "frames",
    ]
    assert (bundle["format"], bundle["version"]) == ("spherex-explorer/bundle", 1)
    assert bundle["target"] == {
        "name": "Test Star",
        "ra": SKY_CENTER[0],
        "dec": SKY_CENTER[1],
        "epoch": 2000.0,
        "pm_ra": 0.0,
        "pm_dec": 0.0,
    }
    assert bundle["grid"] == {
        "ra": SKY_CENTER[0],
        "dec": SKY_CENTER[1],
        "fov_deg": 0.05,
        "size": 64,
    }
    assert [exposure["id"] for exposure in bundle["exposures"]] == IDS[:2]
    assert [frame["id"] for frame in bundle["frames"]] == IDS[:2]
    assert list(bundle["exposures"][0]) == [
        "id",
        "collection",
        "detector",
        "pass",
        "time_mjd",
        "time_iso",
    ]
    assert {exposure["detector"] for exposure in bundle["exposures"]} == {2}
    assert bundle["frames"][0]["target_xy"] == [31.5, 31.5]
    assert entry["key"] == "test-star" and entry["passes"] == 2


def test_entry_of_the_index_describes_each_file(tmp_path):
    entry = build(tmp_path)

    assert [detector["detector"] for detector in entry["detectors"]] == [2, 5]
    first = entry["detectors"][0]
    assert first["file"] == "test-star-d2.json" and first["frames"] == 2
    assert first["bytes"] == (tmp_path / "test-star-d2.json").stat().st_size
    assert first["wavelength_um"][0] <= first["wavelength_um"][1]
    assert entry["target"]["name"] == "Test Star"


def test_exposure_whose_file_is_gone_is_left_out_of_the_list_too(tmp_path):
    entry = build(tmp_path, missing=IDS[1:3])

    bundle = json.loads((tmp_path / "test-star-d2.json").read_text(encoding="utf-8"))
    assert [exposure["id"] for exposure in bundle["exposures"]] == IDS[:1]
    assert [detector["frames"] for detector in entry["detectors"]] == [1, 1]


def test_detector_without_any_frame_gets_no_file(tmp_path):
    entry = build(tmp_path, missing=IDS[2:])

    assert [detector["detector"] for detector in entry["detectors"]] == [2]
    assert not (tmp_path / "test-star-d5.json").exists()


def test_busy_storage_is_tried_again_then_stops_the_run(tmp_path):
    class Busy:
        calls = 0

        async def layout(self, exposure_id):
            Busy.calls += 1
            raise UpstreamUnavailable("The SPHEREx file storage", "HTTP 503", retry_after_s=5)

    with pytest.raises(UpstreamUnavailable):
        build(tmp_path, identifiers=IDS[:1], source=Busy())

    assert Busy.calls == 4


def test_index_keeps_the_targets_built_before_and_replaces_the_one_built_again(tmp_path):
    write_index(tmp_path, [{"key": "r-draconis", "name": "R Draconis", "detectors": []}])
    write_index(tmp_path, [{"key": "barnard-star", "name": "Barnard's Star", "detectors": []}])
    write_index(tmp_path, [{"key": "r-draconis", "name": "R Draconis", "detectors": [1]}])

    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))

    assert (index["format"], index["version"]) == ("spherex-explorer/index", 1)
    # The order is the one of the challenge, whatever the order they were built in.
    assert [entry["key"] for entry in index["targets"]] == ["barnard-star", "r-draconis"]
    assert index["targets"][1]["detectors"] == [1]


def test_index_that_cannot_be_read_is_written_again(tmp_path):
    (tmp_path / "index.json").write_text("not json", encoding="utf-8")

    write_index(tmp_path, [{"key": "wise-0855", "name": "WISE 0855", "detectors": []}])

    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    assert [entry["key"] for entry in index["targets"]] == ["wise-0855"]


def test_command_refuses_a_folder_that_does_not_exist(tmp_path, capsys):
    with pytest.raises(SystemExit) as stop:
        main(["--output", str(tmp_path / "nowhere")])

    assert stop.value.code == 2
    assert "is not a folder" in capsys.readouterr().err


def test_missing_file_error_carries_a_sentence_for_the_client():
    assert NotFound("detail", public="sentence").public == "sentence"


def test_spectrum_file_holds_one_point_per_exposure_in_the_format_of_the_contract(tmp_path):
    entry = build(tmp_path)

    spectrum = json.loads((tmp_path / "test-star-spectrum.json").read_text(encoding="utf-8"))
    assert list(spectrum) == ["format", "version", "generated", "target", "points"]
    assert (spectrum["format"], spectrum["version"]) == ("spherex-explorer/spectrum", 1)
    assert spectrum["target"]["name"] == "Test Star"
    assert [point["id"] for point in spectrum["points"]] == IDS
    assert list(spectrum["points"][0]) == [
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
    assert entry["spectrum"] == {
        "file": "test-star-spectrum.json",
        "points": 4,
        "with_flux": 4,
        "bytes": (tmp_path / "test-star-spectrum.json").stat().st_size,
    }


def test_point_of_the_spectrum_file_is_the_measurement_of_the_frame_of_the_bundle(tmp_path):
    build(tmp_path)

    spectrum = json.loads((tmp_path / "test-star-spectrum.json").read_text(encoding="utf-8"))
    bundle = json.loads((tmp_path / "test-star-d2.json").read_text(encoding="utf-8"))

    point, frame = spectrum["points"][0], bundle["frames"][0]
    assert point["id"] == frame["id"]
    assert point["flux_mjy"] == frame["photometry"]["flux_mjy"]
    assert point["quality"] == frame["photometry"]["quality"]
    assert point["wavelength_um"] == frame["wavelength_um"]


def test_spectra_alone_leave_the_bundles_and_complete_the_index(tmp_path):
    write_index(tmp_path, [build(tmp_path)])
    bundle = tmp_path / "test-star-d2.json"
    before = bundle.read_bytes()
    (tmp_path / "test-star-spectrum.json").unlink()

    entry = build(tmp_path, with_frames=False)
    write_index(tmp_path, [entry])

    assert list(entry) == ["key", "spectrum"]
    assert bundle.read_bytes() == before
    assert (tmp_path / "test-star-spectrum.json").exists()
    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    (only,) = index["targets"]
    assert [detector["detector"] for detector in only["detectors"]] == [2, 5]
    assert only["spectrum"]["points"] == 4


def test_candidates_file_is_measured_on_the_frames_of_the_bundles(tmp_path):
    entry = build(tmp_path)

    report = json.loads((tmp_path / "test-star-candidates.json").read_text(encoding="utf-8"))
    assert list(report) == [
        "format",
        "version",
        "generated",
        "target",
        "grid",
        "frames",
        "sources",
        "visits",
        "limits",
        "saturated",
        "candidates",
    ]
    assert (report["format"], report["version"]) == ("spherex-explorer/candidates", 1)
    bundle = json.loads((tmp_path / "test-star-d2.json").read_text(encoding="utf-8"))
    assert report["target"] == bundle["target"]
    assert report["grid"] == bundle["grid"]
    assert report["frames"] == 4
    assert [(visit["pass"], visit["frames"]) for visit in report["visits"]] == [(1, 2), (2, 2)]
    assert report["candidates"] == []
    assert entry["candidates"] == {
        "file": "test-star-candidates.json",
        "count": 0,
        "moved": 0,
        "swung": 0,
        "changed": 0,
        "bytes": (tmp_path / "test-star-candidates.json").stat().st_size,
    }


def test_target_without_any_frame_gets_no_candidates_file(tmp_path):
    entry = build(tmp_path, missing=IDS)

    assert "candidates" not in entry
    assert not (tmp_path / "test-star-candidates.json").exists()


def test_candidates_are_built_again_from_the_bundles_without_any_download(tmp_path):
    write_index(tmp_path, [build(tmp_path)])
    written = tmp_path / "test-star-candidates.json"
    before = json.loads(written.read_text(encoding="utf-8"))
    written.unlink()

    rebuild_candidates(tmp_path, ["another-target"])
    assert not written.exists()
    assert main(["--output", str(tmp_path), "--candidates-only"]) == 0

    after = json.loads(written.read_text(encoding="utf-8"))
    assert {**after, "generated": ""} == {**before, "generated": ""}
    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    assert index["targets"][0]["candidates"]["bytes"] == written.stat().st_size
    assert [detector["detector"] for detector in index["targets"][0]["detectors"]] == [2, 5]


def test_command_refuses_candidates_without_bundles_and_two_partial_builds(tmp_path, capsys):
    with pytest.raises(SystemExit) as stop:
        main(["--output", str(tmp_path), "--candidates-only"])
    assert stop.value.code == 2
    assert "build the bundles first" in capsys.readouterr().err

    with pytest.raises(SystemExit):
        main(["--output", str(tmp_path), "--candidates-only", "--spectra-only"])
    assert "cannot go together" in capsys.readouterr().err


class FakeCatalogs:
    """A catalog service that knows one source, at the center of whatever is asked."""

    limit = 300

    def __init__(self):
        self.asked: list[str] = []

    async def around(self, catalog, ra, dec, radius_deg):
        self.asked.append(catalog.key)
        source = CatalogSource(
            id=f"{catalog.name} 1", ra=ra, dec=dec, magnitudes=((catalog.band, 12.3),)
        )
        return Cone((source,), complete=True)


def test_catalog_file_holds_what_other_telescopes_know_in_the_view_of_the_bundles(tmp_path):
    entry = build(tmp_path)

    listed = asyncio.run(write_catalog(tmp_path, entry, FakeCatalogs()))

    written = tmp_path / "test-star-catalog.json"
    report = json.loads(written.read_text(encoding="utf-8"))
    assert list(report) == ["format", "version", "generated", "view", "epoch", "catalogs"]
    assert (report["format"], report["version"]) == ("spherex-explorer/catalog", 1)
    grid = entry["grid"]
    assert report["view"] == {"ra": grid["ra"], "dec": grid["dec"], "fov_deg": 0.05}
    # The date of the frames: every made-up file carries the same one.
    assert report["epoch"] == pytest.approx(2000 + (MJD - 51544.5) / 365.25, abs=0.01)
    assert [catalog["key"] for catalog in report["catalogs"]] == ["gaia", "allwise"]
    assert report["catalogs"][0]["sources"] == [
        {
            "id": "Gaia DR3 1",
            "ra": grid["ra"],
            "dec": grid["dec"],
            "pm_ra": None,
            "pm_dec": None,
            "parallax_mas": None,
            "mags": {"G": 12.3},
        }
    ]
    assert listed == {
        "file": "test-star-catalog.json",
        "sources": {"gaia": 1, "allwise": 1},
        "bytes": written.stat().st_size,
    }


def test_target_without_any_frame_gets_no_catalog_file(tmp_path):
    entry = build(tmp_path, missing=IDS)
    service = FakeCatalogs()

    assert asyncio.run(write_catalog(tmp_path, entry, service)) is None
    assert service.asked == []
    assert not (tmp_path / "test-star-catalog.json").exists()


def test_catalog_files_are_built_again_for_the_targets_asked(tmp_path):
    write_index(tmp_path, [build(tmp_path)])
    service = FakeCatalogs()

    asyncio.run(rebuild_catalogs(tmp_path, ["another-target"], service))
    assert service.asked == []
    asyncio.run(rebuild_catalogs(tmp_path, [], service))

    assert sorted(service.asked) == ["allwise", "gaia"]
    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    (only,) = index["targets"]
    assert only["catalog"]["file"] == "test-star-catalog.json"
    assert only["catalog"]["bytes"] == (tmp_path / "test-star-catalog.json").stat().st_size
    assert [detector["detector"] for detector in only["detectors"]] == [2, 5]


def test_command_refuses_catalogs_without_bundles_and_with_another_partial_build(tmp_path, capsys):
    with pytest.raises(SystemExit) as stop:
        main(["--output", str(tmp_path), "--catalogs-only"])
    assert stop.value.code == 2
    assert "build the bundles first" in capsys.readouterr().err

    with pytest.raises(SystemExit):
        main(["--output", str(tmp_path), "--catalogs-only", "--candidates-only"])
    assert "cannot go together" in capsys.readouterr().err


# --- a made-up body

# A body of the outer solar system that no catalog knows: 20,000 astronomical units
# away, seen by detector 2 alone, where the Sun would see it at the center of the files.
MADE_UP = BundleTarget(
    "made-up",
    "Synthetic Test Body",
    "",
    SyntheticBody(
        Target(ra=SKY_CENTER[0], dec=SKY_CENTER[1], epoch=2025.5),
        distance_au=20000.0,
        flux_mjy={2: 50.0},
    ),
)


def images(path) -> np.ndarray:
    """The pixels of each frame of a bundle, one frame per row."""
    bundle = json.loads(path.read_text(encoding="utf-8"))
    return np.array(
        [
            np.frombuffer(base64.b64decode(frame["image"]), dtype="<f2").astype(np.float64)
            for frame in bundle["frames"]
        ]
    )


def test_a_made_up_body_is_drawn_on_the_frames_of_the_detectors_that_show_it(tmp_path):
    (tmp_path / "real").mkdir()
    (tmp_path / "made-up").mkdir()
    build(tmp_path / "real")
    # No catalog is asked: the resolver of the tests would refuse the name.
    entry = build(tmp_path / "made-up", wanted=MADE_UP)

    assert entry["target"] == {
        "name": "Synthetic Test Body",
        "ra": SKY_CENTER[0],
        "dec": SKY_CENTER[1],
        "epoch": 2025.5,
        "pm_ra": 0.0,
        "pm_dec": 0.0,
    }
    drawn = images(tmp_path / "made-up" / "made-up-d2.json")
    real = images(tmp_path / "real" / "test-star-d2.json")
    # The light added to each frame is the flux of the body: megajanskys per steradian,
    # times the steradians of a pixel of the view, in millijanskys.
    pixel_sr = np.radians(0.05 / 64) ** 2
    added = np.nansum(drawn - real, axis=1) * pixel_sr * 1e9
    assert added == pytest.approx([50.0, 50.0], rel=0.03)
    # Detector 5 does not show it: its frames are the real ones.
    assert np.array_equal(
        images(tmp_path / "made-up" / "made-up-d5.json"),
        images(tmp_path / "real" / "test-star-d5.json"),
        equal_nan=True,
    )


def test_every_file_of_a_made_up_body_says_that_it_is_made_up(tmp_path):
    entry = build(tmp_path, wanted=MADE_UP)

    said = {
        "note": (
            "A made-up body added to real SPHEREx frames to test the search for a swing. "
            "It does not exist."
        ),
        "distance_au": 20000.0,
        "parallax_arcsec": 10.31,
        "flux_mjy": {"2": 50.0},
    }
    assert entry["synthetic"] == said
    for name in ("made-up-d2.json", "made-up-d5.json", "made-up-candidates.json"):
        file = json.loads((tmp_path / name).read_text(encoding="utf-8"))
        assert list(file)[-1] == "synthetic"
        assert file["synthetic"] == said
    # Built again from the bundles alone, the candidates file still says it.
    rebuild_candidates_of(tmp_path, entry)
    again = json.loads((tmp_path / "made-up-candidates.json").read_text(encoding="utf-8"))
    assert again["synthetic"] == said


def rebuild_candidates_of(folder, entry) -> None:
    write_index(folder, [entry])
    rebuild_candidates(folder, [entry["key"]])


def test_a_real_target_is_not_told_as_made_up(tmp_path):
    entry = build(tmp_path)

    assert "synthetic" not in entry
    for name in ("test-star-d2.json", "test-star-candidates.json"):
        assert "synthetic" not in json.loads((tmp_path / name).read_text(encoding="utf-8"))


def test_the_made_up_target_of_the_site_is_named_as_such_and_built_on_request():
    assert [wanted.key for wanted in TARGETS] == [
        "barnard-star",
        "epsilon-indi-b",
        "wise-0855",
        "rw-aurigae",
        "r-draconis",
    ]
    assert all(wanted.body is None for wanted in TARGETS)
    (made_up,) = SYNTHETIC_TARGETS
    assert made_up.key == "synthetic-planet-x"
    assert "Synthetic" in made_up.name
    assert made_up.body is not None and made_up.body.distance_au == 6000.0
