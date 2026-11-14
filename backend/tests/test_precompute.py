import asyncio
import json

import numpy as np
import pytest

from level2_file import MJD, SKY_CENTER, FakeStorage, build_level2_file
from spherex_explorer.archive import Exposure, Level2Reader, key_from_id
from spherex_explorer.errors import NotFound, UpstreamUnavailable
from spherex_explorer.precompute import BundleTarget, build_target, main, write_index
from spherex_explorer.targets import ResolvedTarget

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


def build(tmp_path, identifiers=IDS, missing=(), source=None):
    content = build_level2_file(flags=np.zeros((72, 96), dtype=np.int32))
    files = {key_from_id(i): content for i in identifiers if i not in missing}
    return asyncio.run(
        build_target(
            WANTED,
            resolver=FakeResolver(),
            archive=FakeArchive(identifiers),
            frames=source or Level2Reader(FakeStorage(files)),
            output=tmp_path,
            fov_deg=0.05,
            size=64,
            sleep=no_wait,
        )
    )


def test_one_file_per_detector_in_the_format_of_the_contract(tmp_path):
    entry = build(tmp_path)

    assert sorted(path.name for path in tmp_path.iterdir()) == [
        "test-star-d2.json",
        "test-star-d5.json",
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
