"""Targets: what the user points at, and where it is at a given date."""

from spherex_explorer.targets.motion import Target, position_at
from spherex_explorer.targets.sesame import (
    MAX_NAME_LENGTH,
    InvalidName,
    ResolvedTarget,
    SesameResolver,
    clean_name,
    parse_sesame,
)

__all__ = [
    "MAX_NAME_LENGTH",
    "InvalidName",
    "ResolvedTarget",
    "SesameResolver",
    "Target",
    "clean_name",
    "parse_sesame",
    "position_at",
]
