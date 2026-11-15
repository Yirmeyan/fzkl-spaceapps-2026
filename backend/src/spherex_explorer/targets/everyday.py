"""Everyday names of the targets of the challenge, and the name catalogs know them by.

SIMBAD answers to "Barnard's Star" and to "WISE J085510.83-071442.5". It does not answer
to "Barnard" or to "WISE 0855", which is what the challenge calls them and what a
visitor types. The few names below are turned into the catalog's own before the resolver
is asked. Every other name goes to the resolver as it was typed.
"""

import re

_BARNARD = "Barnard's Star"
_WISE_0855 = "WISE J085510.83-071442.5"
_EPSILON_INDI_B = "eps Ind B"

# Keys are names as `_plain` leaves them: lower case, letters and digits, single spaces.
_CATALOG_NAMES = {
    "barnard": _BARNARD,
    "barnards": _BARNARD,
    "barnard star": _BARNARD,
    "barnards star": _BARNARD,
    "barnard s star": _BARNARD,
    "wise 0855": _WISE_0855,
    "wise0855": _WISE_0855,
    "w0855": _WISE_0855,
    "wise 0855 0714": _WISE_0855,
    "wise 0855 07": _WISE_0855,
    "wise j0855 0714": _WISE_0855,
    "wise j0855": _WISE_0855,
    "epsilon indi b": _EPSILON_INDI_B,
    "epsilon indi ba": _EPSILON_INDI_B,
    "epsilon indi bb": _EPSILON_INDI_B,
    "eps indi b": _EPSILON_INDI_B,
}

_NOT_A_LETTER_OR_DIGIT = re.compile(r"[^a-z0-9]+")


def _plain(name: str) -> str:
    return _NOT_A_LETTER_OR_DIGIT.sub(" ", name.casefold()).strip()


def catalog_name(name: str) -> str:
    """The name to ask the resolver for: the catalog's own when `name` is an everyday one."""
    return _CATALOG_NAMES.get(_plain(name), name)
