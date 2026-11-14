"""Detection: what moved or changed in a field, from one visit of SPHEREx to the next."""

from spherex_explorer.detection.candidates import (
    CHANGED,
    CLAIM,
    HIGH,
    MEDIUM,
    MOVED,
    SMALLEST_CHANGE,
    SMALLEST_SHIFT,
    Candidate,
    find_candidates,
)
from spherex_explorer.detection.field import (
    Change,
    Field,
    FieldFrame,
    FieldSource,
    Motion,
    SaturatedStar,
    Sighting,
    Visit,
    measure_field,
)

__all__ = [
    "CHANGED",
    "CLAIM",
    "HIGH",
    "MEDIUM",
    "MOVED",
    "SMALLEST_CHANGE",
    "SMALLEST_SHIFT",
    "Candidate",
    "Change",
    "Field",
    "FieldFrame",
    "FieldSource",
    "Motion",
    "SaturatedStar",
    "Sighting",
    "Visit",
    "find_candidates",
    "measure_field",
]
