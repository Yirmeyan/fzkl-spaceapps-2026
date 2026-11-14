"""Identity of a SPHEREx exposure, and the address of its file in the public storage."""

import re
from dataclasses import dataclass

_VERSION = r"[a-z0-9_]+-v[0-9]+-[0-9]{4}-[0-9]{3}"
_WEEK = r"[0-9]{4}W[0-9]{2}_[0-9][A-Z]"
_OBSERVATION = _WEEK + r"_[0-9]{4}_[0-9]"

# qr3/level2/2026W33_2A/l2b-v27-2026-241/6/level2_2026W33_2A_0594_3D6_spx_l2b-v27-2026-241.fits
_KEY = re.compile(
    rf"(?P<collection>(?:dr|qr)[0-9]+)/level2/(?P<week>{_WEEK})/(?P<version>{_VERSION})/"
    rf"(?P<detector>[1-6])/level2_(?P<observation>{_OBSERVATION})D(?P<detector_again>[1-6])"
    rf"_spx_(?P<version_again>{_VERSION})\.fits"
)
# qr3.2026W33_2A_0594_3D6.l2b-v27-2026-241
_ID = re.compile(
    rf"(?P<collection>(?:dr|qr)[0-9]+)\.(?P<observation>{_OBSERVATION})D(?P<detector>[1-6])"
    rf"\.(?P<version>{_VERSION})"
)
_WEEK_LENGTH = len("2026W33_2A")


class InvalidExposure(ValueError):
    """A key or an identifier does not have the shape of a SPHEREx exposure."""


@dataclass(frozen=True, slots=True)
class Exposure:
    """One detector image of one SPHEREx observation."""

    id: str
    collection: str
    detector: int
    time_mjd: float

    @property
    def observation(self) -> str:
        """Observation and detector, the part of the identifier shared by every data release."""
        return self.id.split(".")[1]


def exposure_from_key(key: str, time_mjd: float) -> Exposure:
    """Build an exposure from the key of its file. The identifier holds all the key says."""
    match = _KEY.fullmatch(key)
    if match is None:
        raise InvalidExposure(f"not a SPHEREx level 2 key: {key!r}")
    parts = match.groupdict()
    consistent = (
        parts["detector"] == parts["detector_again"]
        and parts["version"] == parts["version_again"]
        and parts["observation"].startswith(parts["week"] + "_")
    )
    if not consistent:
        raise InvalidExposure(f"key with parts that disagree: {key!r}")
    identifier = (
        f"{parts['collection']}.{parts['observation']}D{parts['detector']}.{parts['version']}"
    )
    return Exposure(
        id=identifier,
        collection=parts["collection"],
        detector=int(parts["detector"]),
        time_mjd=time_mjd,
    )


def key_from_id(exposure_id: str) -> str:
    """Key of the file of an exposure.

    The identifier is checked against a strict pattern first: the service only ever
    reads addresses it built itself, never one supplied by a client.
    """
    match = _ID.fullmatch(exposure_id)
    if match is None:
        raise InvalidExposure(f"not an exposure identifier: {exposure_id!r}")
    parts = match.groupdict()
    week = parts["observation"][:_WEEK_LENGTH]
    return (
        f"{parts['collection']}/level2/{week}/{parts['version']}/{parts['detector']}/"
        f"level2_{parts['observation']}D{parts['detector']}_spx_{parts['version']}.fits"
    )
