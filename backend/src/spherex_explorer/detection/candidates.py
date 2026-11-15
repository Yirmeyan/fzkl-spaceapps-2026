"""Candidates: the sources of a field that moved, swung, or whose light changed.

A candidate is a measurement that stands out, not a discovery. What is asked of it is
written here, with the reason for each demand.
"""

from dataclasses import dataclass

import numpy as np

from spherex_explorer.detection.field import (
    Change,
    Field,
    FieldSource,
    SaturatedStar,
    Sighting,
)

MOVED = "moved"
CHANGED = "changed"
SWUNG = "swung"
HIGH = "high"
MEDIUM = "medium"

# A motion or a change is claimed when it is this many times its uncertainty, and the
# claim is firm when it is twice that.
CLAIM = 5.0
_FIRM = 10.0
# Smallest shift claimed, in pixels of the default view: one arcsecond, a sixth of a
# SPHEREx pixel. Below it, the checks made on steady stars say nothing.
SMALLEST_SHIFT = 1.0 / 2.8125
# Smallest change of brightness claimed, as a share of the brightness.
SMALLEST_CHANGE = 0.1
# A change must show in this many detectors. A reflection or the spike of a bright
# star outside the field touches one detector at one place, and comes back with the
# season: it looks like a change.
_DETECTORS_NEEDED = 2
# Two positions draw a line whatever happened. It takes more of them, a third visit or a
# second detector, to check a motion at all: without that check it needs twice the
# evidence to be claimed. And it takes three visits to see that the source keeps going
# the same way: a claim made on two is never firm.
_VISITS_TO_BE_FIRM = 3
# A source that both moved by less than this and changed is reported as changed: the
# center of light of a close pair shifts when one of the two fades.
_SHIFT_OF_A_PAIR = 3.0 / 2.8125
# A body that swings with the seasons is, around each of its places, a source that comes
# and goes. A source this close to one of those places, in pixels, is the body itself.
_PLACE_OF_A_SWING = 5.0
# A star that saturates some detectors only is followed as a source in the others. A
# candidate this close to its heart, in pixels beyond the radius of the heart, is the
# same star: its halo is not reported a second time.
_BESIDE_THE_HEART = 3.0


@dataclass(frozen=True, slots=True)
class Candidate:
    """A source that stands out, why, and how surely.

    `changes` holds, for a source whose light changed, the clearest change of each
    detector that shows one, the clearest first. `halo` tells that the source is a
    saturated star, followed through the light around its heart.
    """

    kind: str
    confidence: str
    significance: float
    source: FieldSource
    changes: tuple[Change, ...]
    halo: bool = False


def _clear_changes(source: FieldSource | SaturatedStar) -> tuple[Change, ...]:
    """The clearest change of each detector, when clear enough to be claimed."""
    best: dict[int, Change] = {}
    for change in source.changes:
        if (
            change.significance >= CLAIM
            and abs(change.ratio - 1.0) >= SMALLEST_CHANGE
            and change.significance > getattr(best.get(change.detector), "significance", 0.0)
        ):
            best[change.detector] = change
    return tuple(sorted(best.values(), key=lambda change: -change.significance))


def _claimed_already(star: SaturatedStar, candidates: list[Candidate]) -> bool:
    """Is one of the candidates this saturated star, followed where it does not saturate?"""
    reach = star.radius + _BESIDE_THE_HEART
    return any(
        np.hypot(candidate.source.x - star.x, candidate.source.y - star.y) <= reach
        for candidate in candidates
    )


def _as_source(star: SaturatedStar, field: Field) -> FieldSource:
    """A saturated star as a source seen at every visit.

    Of such a star only the place of the heart is known, to its radius: that radius
    stands for the uncertainty of each position, and no motion is measured.
    """
    seen = tuple(
        Sighting(visit.pass_number, visit.time_mjd, star.x, star.y, star.radius, star.detectors)
        for visit in field.visits
    )
    return FieldSource(star.x, star.y, 0.0, seen, None, star.changes)


def _swung(field: Field) -> list[Candidate]:
    """The bodies that swing with the seasons, when sure enough to be claimed.

    Three visits show a body going and coming back: the third one checks what the
    first two drew. With two visits there is no such check. The body then needs twice
    the evidence, and the claim is never firm.
    """
    candidates = []
    for body in field.swung:
        motion = body.motion
        if motion is None or motion.significance < (CLAIM if motion.checked else _FIRM):
            continue
        confidence = HIGH if motion.checked and motion.significance >= _FIRM else MEDIUM
        candidates.append(Candidate(SWUNG, confidence, motion.significance, body, ()))
    return candidates


def _place_of_a_swing(source: FieldSource, swung: list[Candidate]) -> bool:
    """Is the source one of the places of a body that swings?"""
    return any(
        np.hypot(source.x - sighting.x, source.y - sighting.y) <= _PLACE_OF_A_SWING
        for candidate in swung
        for sighting in candidate.source.sightings
    )


def find_candidates(field: Field) -> tuple[Candidate, ...]:
    """The sources of a field that moved, swung or changed, the surest first.

    A saturated star has no source to follow in the detectors it saturates. It is a
    candidate when its halo changed, under the rule every change is held to.
    """
    candidates = _swung(field)
    swung = list(candidates)
    for source in field.sources:
        if _place_of_a_swing(source, swung):
            continue
        motion = source.motion
        shift = float(np.hypot(motion.shift_x, motion.shift_y)) if motion else 0.0
        checked = motion is not None and motion.checked
        needed = CLAIM if checked else _FIRM
        moved = motion is not None and motion.significance >= needed and shift >= SMALLEST_SHIFT
        changes = _clear_changes(source)
        changed = len(changes) >= _DETECTORS_NEEDED
        if changed and not (moved and shift >= _SHIFT_OF_A_PAIR):
            significance = changes[0].significance
            confidence = HIGH if significance >= _FIRM else MEDIUM
            candidates.append(Candidate(CHANGED, confidence, significance, source, changes))
        elif moved and motion is not None:
            followed = checked and len(source.sightings) >= _VISITS_TO_BE_FIRM
            confidence = HIGH if followed and motion.significance >= _FIRM else MEDIUM
            candidates.append(Candidate(MOVED, confidence, motion.significance, source, changes))
    for star in field.saturated:
        changes = _clear_changes(star)
        if len(changes) < _DETECTORS_NEEDED or _claimed_already(star, candidates):
            continue
        significance = changes[0].significance
        confidence = HIGH if significance >= _FIRM else MEDIUM
        candidates.append(
            Candidate(CHANGED, confidence, significance, _as_source(star, field), changes, True)
        )
    return tuple(sorted(candidates, key=lambda candidate: -candidate.significance))
