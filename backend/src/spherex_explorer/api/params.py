"""Query parameters shared by the routes, with the limits docs/api-contract.md gives them."""

from typing import Annotated

from fastapi import Query

from spherex_explorer.frames import MAX_FOV_DEG, MAX_SIZE, MIN_FOV_DEG, MIN_SIZE

# Widest proper motion accepted, in milliarcseconds per year. The fastest star reaches 10,400.
_MAX_PROPER_MOTION = 20000.0

Ra = Annotated[float, Query(ge=0, lt=360, description="Right ascension, degrees (ICRS).")]
Dec = Annotated[float, Query(ge=-90, le=90, description="Declination, degrees (ICRS).")]
Epoch = Annotated[float, Query(ge=1900, le=2100, description="Date of the position, Julian year.")]
PmRa = Annotated[
    float,
    Query(
        ge=-_MAX_PROPER_MOTION,
        le=_MAX_PROPER_MOTION,
        description="Proper motion toward the east, mas per year, cos(dec) included.",
    ),
]
PmDec = Annotated[
    float,
    Query(
        ge=-_MAX_PROPER_MOTION,
        le=_MAX_PROPER_MOTION,
        description="Proper motion toward the north, mas per year.",
    ),
]
Fov = Annotated[
    float, Query(ge=MIN_FOV_DEG, le=MAX_FOV_DEG, description="Width of the view, degrees.")
]
Size = Annotated[int, Query(ge=MIN_SIZE, le=MAX_SIZE, description="Width of the view, pixels.")]
GridRa = Annotated[
    float | None,
    Query(ge=0, lt=360, description="Right ascension of the center of the grid, degrees."),
]
GridDec = Annotated[
    float | None,
    Query(ge=-90, le=90, description="Declination of the center of the grid, degrees."),
]
