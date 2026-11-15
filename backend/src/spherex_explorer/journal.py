"""The journal: what the search found, as a list of findings anyone can open.

An entry is one finding: where it is, what the service measured there, whether a
catalog knows it, and the parameters that open the tool on it. The measurements are
those of the service, on the field of each object. What catalogs say of an object is
written here by hand, from the checks told in docs/api-contract.md: a finding that no
catalog explains is listed as unconfirmed, for a visitor to look at.
"""

import math
from dataclasses import dataclass

from spherex_explorer.targets import Target

CONFIRMED = "confirmed"
UNCONFIRMED = "unconfirmed"
SYNTHETIC = "synthetic"
# Who listed an entry. The team did, for the fields the search was checked on.
TEAM = "team"
# A candidate is a known object of its field when it is this close to it, in arcseconds.
_SAME_OBJECT = 3.0
_ARCSEC_PER_DEGREE = 3600.0
_MAS_PER_ARCSEC = 1000.0
_MIRA = "A Mira variable of the AAVSO index: its change goes the way its period predicts"


@dataclass(frozen=True, slots=True)
class Known:
    """An object of a field that catalogs know: its name, its place, and what they say."""

    name: str
    ra: float
    dec: float
    said: str


@dataclass(frozen=True, slots=True)
class JournalField:
    """A field of the journal: the object it was chosen for, and what is known there.

    `said` is what catalogs say of the target beyond its motion. `preset` is the key of
    its static files, when it has some. `others` are known objects of the field that
    are not the target.
    """

    key: str
    name: str
    target: Target
    said: str | None = None
    preset: str | None = None
    others: tuple[Known, ...] = ()


def _star(key: str, name: str, ra: float, dec: float, pm_ra: float, pm_dec: float, **more):
    return JournalField(key, name, Target(ra, dec, 2000.0, pm_ra, pm_dec), **more)


# The fields the search was checked on that hold a finding. Positions and motions of
# the stars are those of SIMBAD, at the epoch 2000.
JOURNAL_FIELDS = (
    _star(
        "barnard-star",
        "Barnard's Star",
        269.452077,
        4.693365,
        -801.551,
        10362.394,
        preset="barnard-star",
    ),
    _star(
        "epsilon-indi-b",
        "Epsilon Indi B",
        331.044147,
        -56.782844,
        3981.977,
        -2466.832,
        preset="epsilon-indi-b",
    ),
    _star(
        "wise-0855",
        "WISE 0855",
        133.818908,
        -7.247048,
        -8123.7,
        673.2,
        said="Gaia DR3 holds no source there: the object is too cold for it",
        preset="wise-0855",
    ),
    _star("teegarden-star", "Teegarden's Star", 43.253716, 16.881287, 3429.083, -3805.541),
    _star("luhman-16", "Luhman 16", 162.328814, -53.319466, -2767.502, 356.856),
    _star("scr-1845-6357", "SCR J1845-6357", 281.271889, -63.963181, 2583.19, 588.504),
    _star("wolf-359", "Wolf 359", 164.120504, 7.014723, -3866.338, -2699.215),
    _star("denis-0255-4700", "DENIS J0255-4700", 43.765386, -47.014266, 1012.445, -554.031),
    _star("kapteyn-star", "Kapteyn's Star", 77.919124, -45.018434, 6491.223, -5708.614),
    _star("van-maanen-star", "van Maanen's Star", 12.291243, 5.388609, 1231.399, -2711.883),
    _star("trappist-1", "TRAPPIST-1", 346.622369, -5.041399, 930.788, -479.038),
    _star("lhs-292", "LHS 292", 162.052559, -11.336003, 579.019, -1530.076),
    _star("proxima-centauri", "Proxima Centauri", 217.428942, -62.67949, -3781.741, 769.465),
    _star("yz-ceti", "YZ Ceti", 18.127654, -16.998988, 1205.074, 637.547),
    _star("gj-1002", "GJ 1002", 1.679989, -7.538061, -811.566, -1893.251),
    _star("ez-aquarii", "EZ Aquarii", 339.6399, -15.299933, 2314.8, 2295.3),
    _star(
        "rw-aurigae",
        "RW Aurigae",
        76.956526,
        30.401438,
        7.23,
        -20.33,
        said="A T Tauri star known for its deep fadings",
        preset="rw-aurigae",
    ),
    _star(
        "r-draconis",
        "R Draconis",
        248.167611,
        66.754979,
        -20.643,
        6.149,
        said="A Mira variable of 246 days in the AAVSO index",
        preset="r-draconis",
    ),
    _star(
        "s-coronae-borealis",
        "S Coronae Borealis",
        230.349814,
        31.367385,
        -10.149,
        -12.432,
        said=_MIRA,
    ),
    _star("r-bootis", "R Bootis", 219.298234, 26.736571, -25.537, 11.968, said=_MIRA),
    _star(
        "r-canum-venaticorum",
        "R Canum Venaticorum",
        207.237673,
        39.542548,
        -1.115,
        -5.148,
        said=_MIRA,
    ),
    _star("t-herculis", "T Herculis", 272.275879, 31.021168, -1.975, 6.997, said=_MIRA),
    _star("u-ursae-minoris", "U Ursae Minoris", 214.332933, 66.794225, -0.697, 6.89, said=_MIRA),
    _star(
        "milky-way-280",
        "A place of the Milky Way taken at random",
        280.0,
        0.0,
        0.0,
        0.0,
        others=(
            Known(
                "IRAS 18372-0002",
                279.963281,
                0.012891,
                "A long-period variable: 354 days in the AAVSO index, and one of the "
                "variables of Gaia DR3",
            ),
        ),
    ),
    _star(
        "milky-way-center",
        "Toward the center of the Milky Way",
        270.0,
        -25.0,
        0.0,
        0.0,
        others=(
            Known(
                "Gaia DR3 4064471626921276672",
                269.961204,
                -25.018276,
                "A long-period variable of Gaia DR3",
            ),
        ),
    ),
    JournalField(
        "synthetic-planet-x",
        "Synthetic Planet X",
        Target(199.990528, 29.994922, 2025.94, -2000.0, 1900.0),
        preset="synthetic-planet-x",
    ),
)


def catalog_motion(target: Target) -> str | None:
    """The motion a catalog gives to a target, in words. None for a target that stays."""
    rate = math.hypot(target.pm_ra, target.pm_dec) / _MAS_PER_ARCSEC
    if rate < 0.1:
        return None
    angle = math.degrees(math.atan2(target.pm_ra, target.pm_dec)) % 360.0
    return f"{rate:.2f} arcseconds per year toward {angle:.0f} degrees in SIMBAD"


def found_sentence(candidate: dict) -> str:
    """What the service measured of a candidate, in one sentence."""
    kind = candidate["kind"]
    if kind == "swung" and candidate["swing"]:
        swing = candidate["swing"]
        near, far = swing["distance_au_range"]
        return (
            f"Swings by {swing['swing_arcsec']:.0f} arcseconds with the seasons: "
            f"{swing['distance_au']:,} astronomical units away, between {near:,} and {far:,}"
        )
    if kind == "moved" and candidate["motion"]:
        motion = candidate["motion"]
        said = (
            f"Moved by {motion['rate_arcsec_per_year']:.2f} "
            f"± {motion['rate_error_arcsec_per_year']:.2f} arcseconds per year "
            f"toward {motion['angle_deg']:.0f} degrees"
        )
        if motion["distance_ly"] is not None:
            said += f", {motion['distance_ly']:.1f} light-years away by its parallax"
        return said
    if candidate["changes"]:
        change = candidate["changes"][0]
        ratio = change["ratio"]
        how = f"{1 / ratio:.1f} times fainter" if ratio < 1 else f"{ratio:.1f} times brighter"
        low, high = change["wavelength_um"]
        said = (
            f"{how} from {low:.1f} to {high:.1f} micrometers "
            f"between visits {change['from_pass']} and {change['to_pass']}"
        )
        if candidate["method"] == "halo":
            said += ", read on the halo of light around the star"
        return said[0].upper() + said[1:]
    return "Stands out from one visit to the next"


def _known_here(field: JournalField, candidate: dict) -> Known | None:
    """The known object of the field a candidate is, if it is one of them."""
    for known in field.others:
        east = (candidate["ra"] - known.ra) * math.cos(math.radians(known.dec))
        north = candidate["dec"] - known.dec
        if math.hypot(east, north) * _ARCSEC_PER_DEGREE <= _SAME_OBJECT:
            return known
    return None


def _as_target(candidate: dict) -> dict:
    """The parameters that open the tool on a candidate: its place, and its motion if it has one."""
    motion = candidate["motion"] or {}
    return {
        "ra": candidate["ra"],
        "dec": candidate["dec"],
        "epoch": candidate["epoch"],
        "pm_ra": motion.get("pm_ra", 0.0),
        "pm_dec": motion.get("pm_dec", 0.0),
    }


def entries_of(field: JournalField, report: dict, measured: str) -> list[dict]:
    """The entries of a field, one for each candidate of its report.

    `report` is the answer of `candidates` for the field, or the candidates file of a
    static target. `measured` is the day of that measurement.
    """
    target = {
        "ra": field.target.ra,
        "dec": field.target.dec,
        "epoch": field.target.epoch,
        "pm_ra": field.target.pm_ra,
        "pm_dec": field.target.pm_dec,
    }
    made_up = report.get("synthetic")
    entries = []
    for candidate in report["candidates"]:
        known = _known_here(field, candidate)
        number = len(entries) + 1
        if made_up:
            name, status, said, opens = field.name, SYNTHETIC, made_up["note"], target
        elif candidate["is_target"]:
            parts = [catalog_motion(field.target) if candidate["kind"] == "moved" else None]
            said = ". ".join(part for part in [*parts, field.said] if part) or None
            name, status, opens = field.name, CONFIRMED, target
        elif known is not None:
            name, status, said, opens = known.name, CONFIRMED, known.said, _as_target(candidate)
        else:
            name = f"Candidate at {candidate['ra']:.4f}, {candidate['dec']:+.4f}"
            status, said, opens = UNCONFIRMED, None, _as_target(candidate)
        whole_field = bool(made_up or candidate["is_target"])
        taken = {entry["id"] for entry in entries}
        entries.append(
            {
                "id": field.key
                if whole_field and field.key not in taken
                else f"{field.key}-{number}",
                "name": name,
                "source": TEAM,
                "status": status,
                "kind": candidate["kind"],
                "method": candidate["method"],
                "confidence": candidate["confidence"],
                "significance": candidate["significance"],
                "ra": candidate["ra"],
                "dec": candidate["dec"],
                "epoch": candidate["epoch"],
                "target": opens,
                "preset": field.preset if whole_field else None,
                "found": found_sentence(candidate),
                "known": said,
                "measured": measured,
            }
        )
    return entries
