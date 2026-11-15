"""The journal: a finding in words, and the entries a field gives."""

import asyncio
import json

import pytest

from spherex_explorer.errors import UpstreamUnavailable
from spherex_explorer.journal import (
    JOURNAL_FIELDS,
    JournalField,
    Known,
    catalog_motion,
    entries_of,
    found_sentence,
)
from spherex_explorer.precompute import TARGETS, write_journal
from spherex_explorer.targets import Target

STAR = JournalField("fast-star", "Fast Star", Target(10.0, 20.0, 2000.0, 3000.0, -4000.0))
MEASURED = "2026-11-14"


def candidate(kind="moved", is_target=True, **more) -> dict:
    """A candidate as `candidates` writes one, with what a test needs to change."""
    base = {
        "kind": kind,
        "method": "source",
        "confidence": "high",
        "significance": 12.3,
        "is_target": is_target,
        "ra": 10.001,
        "dec": 19.999,
        "epoch": 2025.9,
        "xy": [63.5, 63.5],
        "detectors": [5, 6],
        "track": [],
        "motion": None,
        "swing": None,
        "changes": [],
    }
    if kind == "moved":
        base["motion"] = {
            "shift_arcsec": 5.0,
            "days": 365.0,
            "rate_arcsec_per_year": 4.98,
            "rate_error_arcsec_per_year": 0.21,
            "angle_deg": 143.2,
            "pm_ra": 2980.0,
            "pm_dec": -3990.0,
            "parallax_arcsec": None,
            "parallax_error_arcsec": None,
            "distance_ly": None,
            "distance_ly_range": None,
        }
    return {**base, **more}


def change(ratio: float) -> dict:
    return {
        "detector": 5,
        "from_pass": 1,
        "to_pass": 3,
        "ratio": ratio,
        "error": 0.03,
        "significance": 14.0,
        "wavelength_um": [3.82, 4.41],
    }


# --- a finding in words


def test_a_motion_is_told_with_its_speed_and_its_direction():
    assert found_sentence(candidate()) == (
        "Moved by 4.98 ± 0.21 arcseconds per year toward 143 degrees"
    )


def test_a_parallax_adds_the_distance():
    found = candidate()
    found["motion"]["distance_ly"] = 11.04

    assert found_sentence(found).endswith(", 11.0 light-years away by its parallax")


def test_a_change_is_told_as_times_fainter_or_brighter():
    fainter = candidate("changed", changes=[change(0.497)])
    brighter = candidate("changed", changes=[change(1.42)])

    assert found_sentence(fainter) == (
        "2.0 times fainter from 3.8 to 4.4 micrometers between visits 1 and 3"
    )
    assert found_sentence(brighter).startswith("1.4 times brighter from 3.8 to 4.4")


def test_a_change_read_on_a_halo_says_so():
    found = candidate("changed", method="halo", changes=[change(0.45)])

    assert found_sentence(found).endswith(", read on the halo of light around the star")


def test_a_swing_is_told_with_its_distance():
    swing = {
        "parallax_arcsec": 33.55,
        "parallax_error_arcsec": 0.56,
        "distance_au": 6148,
        "distance_au_range": [6048, 6252],
        "swing_arcsec": 64.9,
    }

    assert found_sentence(candidate("swung", swing=swing)) == (
        "Swings by 65 arcseconds with the seasons: "
        "6,148 astronomical units away, between 6,048 and 6,252"
    )


def test_the_motion_of_a_catalog_is_told_the_same_way():
    assert catalog_motion(STAR.target) == "5.00 arcseconds per year toward 143 degrees in SIMBAD"
    assert catalog_motion(Target(10.0, 20.0)) is None


# --- the entries of a field


def test_the_target_found_is_a_confirmed_entry_that_opens_on_the_target():
    (entry,) = entries_of(STAR, {"candidates": [candidate()]}, MEASURED)

    assert list(entry) == [
        "id",
        "name",
        "source",
        "status",
        "kind",
        "method",
        "confidence",
        "significance",
        "ra",
        "dec",
        "epoch",
        "target",
        "preset",
        "found",
        "known",
        "measured",
    ]
    assert (entry["id"], entry["name"], entry["source"]) == ("fast-star", "Fast Star", "team")
    assert (entry["status"], entry["kind"], entry["confidence"]) == ("confirmed", "moved", "high")
    assert entry["target"] == {
        "ra": 10.0,
        "dec": 20.0,
        "epoch": 2000.0,
        "pm_ra": 3000.0,
        "pm_dec": -4000.0,
    }
    assert entry["known"] == "5.00 arcseconds per year toward 143 degrees in SIMBAD"
    assert (entry["preset"], entry["measured"]) == (None, MEASURED)


def test_what_catalogs_say_of_a_target_that_changed_is_what_was_written_for_it():
    field = JournalField("faint", "Fading Star", Target(10.0, 20.0), said="A known variable")
    found = candidate("changed", changes=[change(0.5)])

    (entry,) = entries_of(field, {"candidates": [found]}, MEASURED)

    assert (entry["status"], entry["known"]) == ("confirmed", "A known variable")


def test_another_object_of_the_field_is_confirmed_when_catalogs_know_it():
    known = Known("Old Variable", 10.0010, 19.9992, "A long-period variable")
    field = JournalField("place", "A place", Target(10.0, 20.0), others=(known,))
    found = candidate("changed", is_target=False, changes=[change(0.6)])

    (entry,) = entries_of(field, {"candidates": [found]}, MEASURED)

    assert (entry["id"], entry["name"], entry["status"]) == (
        "place-1",
        "Old Variable",
        "confirmed",
    )
    assert entry["known"] == "A long-period variable"
    # The tool opens on the object, not on the middle of the field.
    assert entry["target"] == {
        "ra": 10.001,
        "dec": 19.999,
        "epoch": 2025.9,
        "pm_ra": 0.0,
        "pm_dec": 0.0,
    }


def test_a_finding_no_catalog_explains_is_unconfirmed_and_keeps_its_motion():
    field = JournalField("place", "A place", Target(10.0, 20.0))
    reports = {"candidates": [candidate(is_target=False), candidate("changed", is_target=False)]}

    first, second = entries_of(field, reports, MEASURED)

    assert (first["id"], second["id"]) == ("place-1", "place-2")
    assert first["name"] == "Candidate at 10.0010, +19.9990"
    assert (first["status"], first["known"], first["preset"]) == ("unconfirmed", None, None)
    assert (first["target"]["pm_ra"], first["target"]["pm_dec"]) == (2980.0, -3990.0)


def test_a_made_up_body_is_never_listed_as_a_finding_of_the_sky():
    field = JournalField("made-up", "Synthetic Body", Target(10.0, 20.0), preset="made-up")
    report = {
        "candidates": [candidate("swung", is_target=True)],
        "synthetic": {"note": "A made-up body. It does not exist."},
    }

    (entry,) = entries_of(field, report, MEASURED)

    assert (entry["status"], entry["preset"]) == ("synthetic", "made-up")
    assert entry["known"] == "A made-up body. It does not exist."


def test_a_field_that_shows_nothing_gives_no_entry():
    assert entries_of(STAR, {"candidates": []}, MEASURED) == []


# --- the fields of the journal


def test_the_fields_of_the_journal_have_one_key_each_and_real_presets():
    keys = [field.key for field in JOURNAL_FIELDS]
    presets = {field.preset for field in JOURNAL_FIELDS if field.preset}

    assert len(keys) == len(set(keys))
    assert presets == {target.key for target in TARGETS} | {"synthetic-planet-x"}


# --- the file


def test_the_journal_file_reads_the_static_targets_and_measures_the_others(tmp_path):
    preset = JournalField(
        "kept", "Kept Star", Target(10.0, 20.0, 2000.0, 3000.0, -4000.0), preset="kept"
    )
    (tmp_path / "kept-candidates.json").write_text(
        json.dumps({"generated": "2026-11-01T10:00:00Z", "candidates": [candidate()]}),
        encoding="utf-8",
    )
    asked = []

    async def measure(field):
        asked.append(field.key)
        if field.key == "silent":
            raise UpstreamUnavailable("The SPHEREx archive", "no answer", retry_after_s=5)
        return {"candidates": [candidate()]}

    silent = JournalField("silent", "Silent Field", Target(30.0, 40.0))
    count = asyncio.run(write_journal(tmp_path, [preset, STAR, silent], measure))

    journal = json.loads((tmp_path / "journal.json").read_text(encoding="utf-8"))
    assert list(journal) == ["format", "version", "generated", "entries"]
    assert (journal["format"], journal["version"]) == ("spherex-explorer/journal", 1)
    assert count == 2
    assert [entry["id"] for entry in journal["entries"]] == ["kept", "fast-star"]
    # A static target is not measured again, and keeps the day of its file.
    assert asked == ["fast-star", "silent"]
    assert journal["entries"][0]["measured"] == "2026-11-01"
    assert journal["entries"][0]["preset"] == "kept"


def test_the_command_refuses_the_journal_with_another_partial_build(tmp_path, capsys):
    from spherex_explorer.precompute import main

    with pytest.raises(SystemExit):
        main(["--output", str(tmp_path), "--journal", "--candidates-only"])
    assert "cannot go together" in capsys.readouterr().err
