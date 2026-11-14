"""From the flags of a SPHEREx file to the eight bits of a frame.

A file names up to 32 kinds of flags in its header. A frame keeps the seven that matter
to someone who looks at an image, and folds the others into one bit, as
docs/api-contract.md lists them.
"""

from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np

# Bit of a frame for each flag a frame names.
NAMED_BITS = {
    "TRANSIENT": 1,
    "OVERFLOW": 2,
    "SUR_ERROR": 4,
    "PERSIST": 8,
    "OUTLIER": 16,
    "BLOOM": 32,
    "HALO": 64,
}
OTHER_BIT = 128
# They describe the pixel without casting doubt on its value.
_INFORMATIVE = ("SOURCE", "FULLSAMPLE")
# The pixel has no value worth showing.
_NO_VALUE = ("NONFUNC", "MISSING_DATA")
_SATURATED = "OVERFLOW"
_EVERY_BIT = 0xFFFFFFFF


@dataclass(frozen=True, slots=True)
class FlagPlan:
    """How to read the flags of one file. Masks are those of the file."""

    named: tuple[tuple[int, int], ...]
    other: int
    no_value: int
    saturated: int


def flag_plan(planes: Mapping[str, int]) -> FlagPlan:
    """Reading plan for a file, from the names and masks of its header."""
    named = tuple((planes[name], bit) for name, bit in NAMED_BITS.items() if name in planes)
    informative = sum(planes.get(name, 0) for name in _INFORMATIVE)
    no_value = sum(planes.get(name, 0) for name in _NO_VALUE)
    counted = sum(mask for mask, _ in named)
    # A flag the header does not name is counted too: better a warning than a silence.
    other = _EVERY_BIT & ~(counted | informative | no_value)
    return FlagPlan(
        named=named, other=other, no_value=no_value, saturated=planes.get(_SATURATED, 0)
    )


def translate(flags: np.ndarray, plan: FlagPlan) -> np.ndarray:
    """Flags of a file, pixel by pixel, as the bits of a frame."""
    raw = flags.astype(np.int64) & _EVERY_BIT
    mask = np.zeros(raw.shape, dtype=np.uint8)
    for file_mask, bit in plan.named:
        mask[(raw & file_mask) != 0] |= bit
    mask[(raw & plan.other) != 0] |= OTHER_BIT
    return mask


def has_no_value(flags: np.ndarray, plan: FlagPlan) -> np.ndarray:
    """Pixels the file marks as unusable."""
    return ((flags.astype(np.int64) & _EVERY_BIT) & plan.no_value) != 0


def is_saturated(flags: np.ndarray, plan: FlagPlan) -> np.ndarray:
    """Pixels the file flags as overflowing: near saturation with a value, saturated without."""
    return ((flags.astype(np.int64) & _EVERY_BIT) & plan.saturated) != 0
