"""Candidates: the sources of a field that moved, or whose light changed.

A candidate is a measurement that stands out, not a discovery. What is asked of it is
written here, with the reason for each demand.
"""

from dataclasses import dataclass

import numpy as np

from spherex_explorer.detection.field import Change, Field, FieldSource

MOVED = "moved"
CHANGED = "changed"
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


@dataclass(frozen=True, slots=True)
class Candidate:
    """A source that stands out, why, and how surely.

    `changes` holds, for a source whose light changed, the clearest change of each
    detector that shows one, the clearest first.
    """

    kind: str
    confidence: str
    significance: float
    source: FieldSource
    changes: tuple[Change, ...]


def _clear_changes(source: FieldSource) -> tuple[Change, ...]:
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


def find_candidates(field: Field) -> tuple[Candidate, ...]:
    """The sources of a field that moved or changed, the surest first."""
    candidates = []
    for source in field.sources:
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
    return tuple(sorted(candidates, key=lambda candidate: -candidate.significance))
