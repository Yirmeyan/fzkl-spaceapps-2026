"""Detection: what moved or changed in a field, from one visit of SPHEREx to the next."""

from spherex_explorer.detection.candidates import (
    CHANGED,
    CLAIM,
    HIGH,
    MEDIUM,
    MOVED,
    SMALLEST_CHANGE,
    SMALLEST_SHIFT,
    SWUNG,
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
from spherex_explorer.detection.swing import LARGEST_PARALLAX, SMALLEST_PARALLAX

__all__ = [
    "CHANGED",
    "CLAIM",
    "HIGH",
    "LARGEST_PARALLAX",
    "MEDIUM",
    "MOVED",
    "SMALLEST_CHANGE",
    "SMALLEST_PARALLAX",
    "SMALLEST_SHIFT",
    "SWUNG",
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
