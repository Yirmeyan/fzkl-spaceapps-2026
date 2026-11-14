"""Every source of a field, followed from one visit to the next.

SPHEREx comes back to a place about every six months. Within a visit nothing has time
to move, so the frames of a visit are stacked, detector by detector. Each source is
then measured in each stack: where it is, and how bright. What these measurements say
about a source, that it moved or that its light changed, is decided in `candidates`.

Uncertainties are measured, not assumed: the frames of a visit are split in two halves
at random, several times, and the two halves are asked the same question.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

from spherex_explorer.detection.sources import (
    DETECTION_THRESHOLD,
    brightness,
    centroids,
    peaks,
    signal_to_noise,
)
from spherex_explorer.detection.stack import (
    MAD_TO_SIGMA,
    all_nan_allowed,
    average,
    without_outliers,
)

# Bit of a frame mask for a pixel that nears saturation, or is saturated.
_OVERFLOW = 2
# A pixel is the heart of a saturated star when it is saturated in this share of the frames.
_SATURATED_SHARE = 0.5
# Nothing is measured around a saturated heart out to this many times its radius, plus
# a few pixels: its wings are cut by spikes and by the flags of the mission.
_SATURATED_REACH = 3.0
_SATURATED_EXTRA = 6.0
# A source seen in a single visit must stand out more than one seen in all of them.
_VISIT_THRESHOLD = 6.0
# Peaks of different detectors or visits closer than this are the same source.
_SAME_SOURCE = 5.0
# In a detector, a source is not measured when a neighbor this close is at least this
# share of its own brightness: the two cannot be told apart.
_CROWDED = 8.0
_CROWDING_SHARE = 0.3
# A star outshines its neighbors far around it: its wings and its spikes turn on the sky
# from one visit to the next. A source this many times fainter than a star is not
# measured within a reach that grows by this many pixels each time the contrast is
# ten times larger.
_GLARE_CONTRAST = 10.0
_GLARE_REACH = 12.0
# A visit of fewer frames than this in a detector cannot clean itself of the accident of
# one exposure: nothing is looked for in it, and nothing is measured.
_FEWEST_FRAMES = 3
# A position is measured where the stack of a visit shows the source this clearly, no
# less. Under it, the center of light follows the noise.
_SEEN = 4.0
_SEEN_REACH = 2
# How many times the frames of a visit are split in two to measure an uncertainty.
_SPLITS = 8
_FEWEST_TO_SPLIT = 4
# Uncertainty of a position that the split cannot see: what is common to the frames of
# a visit. In pixels of the default view: 0.03 pixel is 0.08 arcsecond.
_POSITION_FLOOR = 0.03
# A star that nears saturation spills charge along one side of the detector, and that side
# turns on the sky from one visit to the next. Its position is this much less sure when
# its heart carries the overflow flag in this share of the frames.
_BRIGHT_POSITION = 0.3
_BRIGHT_SHARE = 0.5
_HEART = 2
# Without halves to compare, the uncertainty is drawn from how faint the source is.
_FAINT_POSITION = 3.0
# Each visit of each detector is shifted onto the others with the steady sources of the
# field. It takes this many of them, each known this well.
_FEWEST_REFERENCES = 4
_REFERENCE_ERROR = 0.12
# What is added to the uncertainty when a visit cannot be shifted onto the others.
_UNREGISTERED = 0.07
# Detectors that disagree this much on the path of a source do not see the same object:
# a cold one in front of a star, for example, that only the last detector shows.
_DISAGREEMENT = 2.0
# A detector on its own must then show a motion this clear, and the others are kept
# with it when their own motion is this close to its.
_CLEAR_ALONE = 5.0
_SAME_MOTION = 2.5
# When the straight line had to be forgiven a bad fit, the motion counts for less: the
# forgiveness itself rests on a few measurements only.
_ALWAYS_TRUSTED = 60
# What a fit leaves over is, by chance alone, about as large as its count of leftovers.
# It is a bad fit when it exceeds that count by this many times its own scatter.
_BEYOND_CHANCE = 2.0
_VISITS_FOR_PARALLAX = 3
_LEFTOVERS_FOR_PARALLAX = 4
_CLEAR_PARALLAX = 3.0
_DAYS_PER_YEAR = 365.25
# Two frames show a source at the same wavelength when they differ by less than this
# share of the width of their band.
_SAME_WAVELENGTH = 0.5
_FEWEST_PAIRS = 5
# Share of the pairs where the source must stand above the sky in both frames.
_SEEN_SHARE = 0.8
# Uncertainty of a brightness ratio that the pairs cannot see, with and without steady
# sources to compare with.
_RATIO_FLOOR = 0.02
_UNCALIBRATED_RATIO = 0.05
_REFERENCE_RATIO_ERROR = 0.04
# The median of n values is this many times less sure than their mean.
_MEDIAN_LOSS = 1.2533
_SEED = 20261114

_Peak = tuple[float, float, float]
_Heart = tuple[float, float, float]


@dataclass(frozen=True, slots=True, eq=False)
class FieldFrame:
    """One exposure on the grid of the default view, as the measurement needs it."""

    detector: int
    pass_number: int
    time_mjd: float
    wavelength_um: float
    bandwidth_um: float
    background: float | None
    # Surface brightness, NaN where there is no value, and the flags of a frame.
    image: np.ndarray
    mask: np.ndarray


@dataclass(frozen=True, slots=True)
class Visit:
    """One visit of SPHEREx to the field."""

    pass_number: int
    time_mjd: float
    frames: int


@dataclass(frozen=True, slots=True)
class Sighting:
    """Where a source was during one visit, in pixels, with its uncertainty along each axis."""

    pass_number: int
    time_mjd: float
    x: float
    y: float
    error: float
    detectors: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class Motion:
    """Straight-line motion fitted through the sightings of a source.

    Rates are in pixels per day, toward increasing x and y, with one uncertainty for
    both. The shift is the motion over the days between the first and the last sighting.
    `checked` tells that the positions were more than the fit needed, so that the path
    itself could be checked: two visits in one detector draw a line whatever happened.
    The parallax, in pixels, is the swing of a nearby object with the seasons. It is
    None when it was not fitted: fewer than three visits, or no date to draw it from.
    """

    rate_x: float
    rate_y: float
    rate_error: float
    shift_x: float
    shift_y: float
    days: float
    significance: float
    checked: bool = False
    parallax: float | None = None
    parallax_error: float | None = None


@dataclass(frozen=True, slots=True)
class Change:
    """Brightness of a source in one visit over that in an earlier one, in one detector.

    The two visits are compared at the same wavelengths only, between the two given.
    """

    detector: int
    from_pass: int
    to_pass: int
    ratio: float
    error: float
    significance: float
    wavelength_um: tuple[float, float]
    pairs: int


@dataclass(frozen=True, slots=True)
class FieldSource:
    """A source of the field: where it is on average, and what was measured of it."""

    x: float
    y: float
    snr: float
    sightings: tuple[Sighting, ...]
    motion: Motion | None
    changes: tuple[Change, ...]


@dataclass(frozen=True, slots=True)
class SaturatedStar:
    """A star too bright to be measured in some detectors, and how far its heart extends."""

    x: float
    y: float
    radius: float
    detectors: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class Field:
    """What was measured in a field: its visits, its sources and its saturated stars."""

    visits: tuple[Visit, ...]
    sources: tuple[FieldSource, ...]
    saturated: tuple[SaturatedStar, ...]


@dataclass(slots=True)
class _Pile:
    """Frames of one detector and one visit, background removed.

    `values` are the frames as they are, `cleaned` the same without the accidents of a
    single exposure, `stack` their average and `overflow` the share of the frames where
    each pixel carries the overflow flag.
    """

    values: np.ndarray
    cleaned: np.ndarray
    stack: np.ndarray
    overflow: np.ndarray
    time_mjd: np.ndarray
    wavelength_um: np.ndarray
    bandwidth_um: np.ndarray


def _piles(frames: Sequence[FieldFrame]) -> dict[tuple[int, int], _Pile]:
    groups: dict[tuple[int, int], list[FieldFrame]] = {}
    for frame in frames:
        if frame.background is not None:
            groups.setdefault((frame.detector, frame.pass_number), []).append(frame)
    piles = {}
    for key, group in sorted(groups.items()):
        # Single precision: a field is hundreds of frames, and their noise is far above it.
        values = np.stack([f.image.astype(np.float32) - np.float32(f.background) for f in group])
        cleaned = without_outliers(values)
        piles[key] = _Pile(
            values=values,
            cleaned=cleaned,
            stack=average(cleaned),
            overflow=np.mean([(f.mask & _OVERFLOW) != 0 for f in group], axis=0),
            time_mjd=np.array([f.time_mjd for f in group]),
            wavelength_um=np.array([f.wavelength_um for f in group]),
            bandwidth_um=np.array([f.bandwidth_um for f in group]),
        )
    return piles


def _patches(zone: np.ndarray) -> list[_Heart]:
    """Connected patches of a mask, as (x, y, radius of a disk of the same area)."""
    remaining = zone.copy()
    patches = []
    height, width = zone.shape
    for row, column in zip(*np.nonzero(zone), strict=True):
        if not remaining[row, column]:
            continue
        remaining[row, column] = False
        members, queue = [], [(int(row), int(column))]
        while queue:
            r, c = queue.pop()
            members.append((r, c))
            for nr in range(max(0, r - 1), min(height, r + 2)):
                for nc in range(max(0, c - 1), min(width, c + 2)):
                    if remaining[nr, nc]:
                        remaining[nr, nc] = False
                        queue.append((nr, nc))
        rows, columns = np.array(members).T
        radius = float(np.sqrt(len(members) / np.pi))
        patches.append((float(columns.mean()), float(rows.mean()), radius))
    return patches


def _saturated_hearts(frames: Sequence[FieldFrame]) -> dict[int, list[_Heart]]:
    """Hearts of saturated stars, detector by detector."""
    by_detector: dict[int, list[FieldFrame]] = {}
    for frame in frames:
        by_detector.setdefault(frame.detector, []).append(frame)
    hearts = {}
    for detector, group in by_detector.items():
        saturated = np.mean(
            [np.isnan(f.image) & ((f.mask & _OVERFLOW) != 0) for f in group], axis=0
        )
        hearts[detector] = _patches(saturated >= _SATURATED_SHARE)
    return hearts


def _near_heart(x: float, y: float, hearts: Sequence[_Heart]) -> bool:
    return any(
        np.hypot(x - heart_x, y - heart_y) <= _SATURATED_REACH * radius + _SATURATED_EXTRA
        for heart_x, heart_y, radius in hearts
    )


def _saturated_stars(hearts: dict[int, list[_Heart]]) -> tuple[SaturatedStar, ...]:
    """The saturated hearts of all detectors, gathered star by star."""
    stars: list[list[tuple[float, float, float, int]]] = []
    for detector, patches in sorted(hearts.items()):
        for x, y, radius in patches:
            for members in stars:
                if np.hypot(x - members[0][0], y - members[0][1]) <= _SAME_SOURCE + members[0][2]:
                    members.append((x, y, radius, detector))
                    break
            else:
                stars.append([(x, y, radius, detector)])
    gathered = []
    for members in stars:
        xs, ys, radii, detectors = zip(*members, strict=True)
        gathered.append(
            SaturatedStar(
                x=float(np.mean(xs)),
                y=float(np.mean(ys)),
                radius=float(max(radii)),
                detectors=tuple(sorted(set(detectors))),
            )
        )
    return tuple(gathered)


def _refined(image: np.ndarray, found: list[_Peak]) -> list[_Peak]:
    """Peaks moved to the center of light of their source, where one is found."""
    if not found:
        return []
    x = np.array([peak[0] for peak in found])
    y = np.array([peak[1] for peak in found])
    better_x, better_y = centroids(image, x, y)
    return [
        (float(bx), float(by), snr) if np.isfinite(bx) else (px, py, snr)
        for (px, py, snr), bx, by in zip(found, better_x, better_y, strict=True)
    ]


def _find(
    piles: dict[tuple[int, int], _Pile], hearts: dict[int, list[_Heart]]
) -> tuple[list[_Peak], dict[int, list[_Peak]]]:
    """Sources of the field, brightest first, and those of each detector.

    A source is looked for in the average of the visits of each detector, and in each
    visit on its own, where an object that moves fast is not smeared.
    """
    by_detector: dict[int, list[_Peak]] = {}
    found: list[_Peak] = []
    for detector in sorted({key[0] for key in piles}):
        stacks = [
            pile.stack
            for key, pile in piles.items()
            if key[0] == detector and pile.values.shape[0] >= _FEWEST_FRAMES
        ]
        if not stacks:
            by_detector[detector] = []
            continue
        with all_nan_allowed():
            together = np.nanmean(stacks, axis=0)
        seen = _refined(together, peaks(signal_to_noise(together), DETECTION_THRESHOLD))
        by_detector[detector] = seen
        found += seen
        for stack in stacks:
            found += _refined(stack, peaks(signal_to_noise(stack), _VISIT_THRESHOLD))
    sources: list[_Peak] = []
    for x, y, snr in sorted(found, key=lambda peak: -peak[2]):
        if all(np.hypot(x - sx, y - sy) >= _SAME_SOURCE for sx, sy, _ in sources):
            sources.append((x, y, snr))
    return sources, by_detector


def _crowded(source: _Peak, seen: list[_Peak]) -> bool:
    """Does a detector show, next to a source, a neighbor bright enough to disturb it?"""
    x, y, _ = source
    own = [snr for sx, sy, snr in seen if np.hypot(x - sx, y - sy) < _SAME_SOURCE / 2]
    if not own:
        return False
    return any(
        _SAME_SOURCE / 2 <= np.hypot(x - sx, y - sy) <= _CROWDED
        and snr >= _CROWDING_SHARE * max(own)
        for sx, sy, snr in seen
    )


def _in_glare(source: _Peak, found: list[_Peak]) -> bool:
    """Is a source lost in the light of a much brighter star of the field?"""
    x, y, snr = source
    for star_x, star_y, star_snr in found:
        contrast = star_snr / max(snr, 1.0)
        if contrast > _GLARE_CONTRAST and np.hypot(
            x - star_x, y - star_y
        ) <= _GLARE_REACH * np.log10(contrast / _GLARE_CONTRAST):
            return True
    return False


def _positions(
    pile: _Pile, x: np.ndarray, y: np.ndarray, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Position of every source in the stack of a pile, with its uncertainty per axis."""
    found_x, found_y = centroids(pile.stack, x, y)
    # A center that ends nearer to another source than to its own was caught by it.
    distance = np.hypot(found_x[:, None] - x[None, :], found_y[:, None] - y[None, :])
    caught = np.nanargmin(np.where(np.isfinite(distance), distance, np.inf), axis=1) != np.arange(
        x.size
    )
    found_x = np.where(caught, np.nan, found_x)
    found_y = np.where(caught, np.nan, found_y)

    frames = pile.cleaned.shape[0]
    snr = signal_to_noise(pile.stack)
    height, width = snr.shape
    row = np.clip(np.rint(np.nan_to_num(found_y)).astype(int), 0, height - 1)
    column = np.clip(np.rint(np.nan_to_num(found_x)).astype(int), 0, width - 1)

    def highest_around(image: np.ndarray, reach: int) -> np.ndarray:
        padded = np.pad(np.nan_to_num(image, nan=-np.inf), reach, constant_values=-np.inf)
        side = 2 * reach + 1
        return np.array(
            [padded[r : r + side, c : c + side].max() for r, c in zip(row, column, strict=True)]
        )

    seen = highest_around(snr, _SEEN_REACH)
    found_x = np.where(seen >= _SEEN, found_x, np.nan)
    found_y = np.where(seen >= _SEEN, found_y, np.nan)
    bright = highest_around(pile.overflow, _HEART)
    floor = np.where(bright >= _BRIGHT_SHARE, _BRIGHT_POSITION, _POSITION_FLOOR)
    faint = _FAINT_POSITION / np.maximum(seen, 1.0)
    if frames < _FEWEST_TO_SPLIT:
        return found_x, found_y, np.hypot(floor, faint)

    def halves_apart(order: np.ndarray) -> np.ndarray:
        """Square of the distance between the centers the two halves of the frames give."""
        first = centroids(average(pile.cleaned[order[: frames // 2]]), found_x, found_y)
        second = centroids(average(pile.cleaned[order[frames // 2 :]]), found_x, found_y)
        return ((first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2) / 2

    with all_nan_allowed():
        # Two halves differ by twice the uncertainty of the whole.
        split = (
            np.sqrt(
                np.nanmean([halves_apart(rng.permutation(frames)) for _ in range(_SPLITS)], axis=0)
            )
            / 2
        )
    # Two stars too close to be told apart, one bluer than the other, have a center that
    # slides with the wavelength. Another visit may look at other wavelengths: the
    # short half of the frames against the long half shows how much that would cost.
    colored = np.sqrt(halves_apart(np.argsort(pile.wavelength_um))) / 2
    spread = np.where(np.isfinite(split), np.fmax(split, colored), faint)
    return found_x, found_y, np.hypot(floor, spread)


def _median(values: np.ndarray) -> tuple[float, float]:
    """Median of values and its uncertainty, from their own scatter."""
    middle = float(np.median(values))
    scatter = MAD_TO_SIGMA * float(np.median(np.abs(values - middle)))
    return middle, _MEDIAN_LOSS * scatter / float(np.sqrt(values.size))


def _register(x: np.ndarray, y: np.ndarray, error: np.ndarray) -> None:
    """Shift each visit of each detector onto the others, in place.

    The arrays are indexed by source, detector and visit. The shift of a visit is the
    median, over the steady sources, of the distance to their mean place in that detector.
    """
    for d in range(x.shape[1]):
        measured = np.isfinite(x[:, d, :])
        visited = measured.any(axis=0)
        with all_nan_allowed():
            mean_x = np.nanmean(x[:, d, :], axis=1)
            mean_y = np.nanmean(y[:, d, :], axis=1)
        everywhere = measured.sum(axis=1) == visited.sum()
        for v in np.nonzero(visited)[0]:
            steady = everywhere & (error[:, d, v] <= _REFERENCE_ERROR)
            if steady.sum() < _FEWEST_REFERENCES or visited.sum() < 2:
                error[:, d, v] = np.hypot(error[:, d, v], _UNREGISTERED)
                continue
            shift_x, doubt_x = _median(x[steady, d, v] - mean_x[steady])
            shift_y, doubt_y = _median(y[steady, d, v] - mean_y[steady])
            x[:, d, v] -= shift_x
            y[:, d, v] -= shift_y
            error[:, d, v] = np.hypot(error[:, d, v], np.hypot(doubt_x, doubt_y) / np.sqrt(2))


def _as_sure_as(ratio: float, freedom: int) -> float:
    """How many sigma a value over its uncertainty is worth, when the uncertainty itself
    was drawn from `freedom` leftovers of a fit.

    With few leftovers the ratio follows the law of Student, with heavy tails. The
    approximation of Wallace (1959) turns it into the usual count of sigma.
    """
    spread = float(np.sqrt(freedom * np.log1p(ratio**2 / freedom)))
    return spread * (8 * freedom + 1) / (8 * freedom + 3)


@dataclass(frozen=True, slots=True)
class _Path:
    """What a set of detectors says of a source: its sightings, its motion, their agreement."""

    sightings: tuple[Sighting, ...]
    motion: Motion | None
    stretch: float


@dataclass(frozen=True, slots=True)
class _Seen:
    """Positions of one source by detector and visit, with what is needed to fit a path.

    `wobble_x` and `wobble_y` are where a parallax of one pixel puts the source at each
    date, from its mean place. They are zero when the parallax is not to be fitted.
    """

    x: np.ndarray
    y: np.ndarray
    error: np.ndarray
    time: np.ndarray
    wobble_x: np.ndarray
    wobble_y: np.ndarray


def _sightings(
    seen: _Seen, known: np.ndarray, detectors: Sequence[int], passes: Sequence[int]
) -> tuple[tuple[Sighting, ...], float]:
    """Place of a source in each visit, and how well the detectors agree on it.

    A source is not at the same place in two detectors when it has a neighbor of another
    color: each detector keeps its own mean place, and only the differences between
    visits are compared.
    """
    weight = np.where(known, 1.0 / np.maximum(seen.error, 1e-6) ** 2, 0.0)
    clean_x = np.where(known, seen.x, 0.0)
    clean_y = np.where(known, seen.y, 0.0)

    def mean(values: np.ndarray, axis: int) -> np.ndarray:
        total = weight.sum(axis=axis)
        return (weight * values).sum(axis=axis) / np.where(total > 0, total, 1.0)

    place_x = np.zeros(known.shape[1])
    place_y = np.zeros(known.shape[1])
    for _ in range(30):
        own_x = mean(clean_x - place_x[None, :], axis=1)
        own_y = mean(clean_y - place_y[None, :], axis=1)
        place_x = mean(clean_x - own_x[:, None], axis=0)
        place_y = mean(clean_y - own_y[:, None], axis=0)
    by_detector = weight.sum(axis=1)
    center_x = float((by_detector * own_x).sum() / by_detector.sum())
    center_y = float((by_detector * own_y).sum() / by_detector.sum())

    # Do the detectors agree on the differences between visits? If they do not, all of
    # them are less sure than they say.
    left_x = np.where(known, seen.x - own_x[:, None] - place_x[None, :], 0.0)
    left_y = np.where(known, seen.y - own_y[:, None] - place_y[None, :], 0.0)
    freedom = 2 * (
        int(known.sum()) - int(known.any(axis=1).sum()) - int(known.any(axis=0).sum()) + 1
    )
    stretch = 1.0
    if freedom >= 2:
        stretch = max(1.0, float(np.sqrt((weight * (left_x**2 + left_y**2)).sum() / freedom)))

    sightings = []
    for v, pass_number in enumerate(passes):
        total = weight[:, v].sum()
        if total <= 0:
            continue
        sightings.append(
            Sighting(
                pass_number=pass_number,
                time_mjd=float(
                    (weight[:, v] * np.where(known[:, v], seen.time[:, v], 0.0)).sum() / total
                ),
                x=float(place_x[v] + center_x),
                y=float(place_y[v] + center_y),
                error=float(stretch / np.sqrt(total)),
                detectors=tuple(
                    det for det, here in zip(detectors, known[:, v], strict=True) if here
                ),
            )
        )
    return tuple(sightings), stretch


def _fit(
    seen: _Seen, known: np.ndarray, with_parallax: bool
) -> tuple[np.ndarray, np.ndarray, float, int] | None:
    """Straight line, and parallax when asked, through the positions of a source.

    Gives the rate along x and y in pixels per day followed by the parallax in pixels,
    their covariance, what the fit leaves over and how many leftovers there are. None
    when the positions do not settle the fit.
    """
    rows = np.argwhere(known)
    used = sorted({int(d) for d, _ in rows})
    column = {d: index for index, d in enumerate(used)}
    unknowns = 2 * len(used) + 2 + int(with_parallax)
    design = np.zeros((2 * len(rows), unknowns))
    value = np.zeros(2 * len(rows))
    doubt = np.zeros(2 * len(rows))
    middle = float(np.mean([seen.time[d, v] for d, v in rows]))
    for index, (d, v) in enumerate(rows):
        for axis, (place, wobble) in enumerate(((seen.x, seen.wobble_x), (seen.y, seen.wobble_y))):
            row = 2 * index + axis
            design[row, axis * len(used) + column[int(d)]] = 1.0
            design[row, 2 * len(used) + axis] = (seen.time[d, v] - middle) / _DAYS_PER_YEAR
            if with_parallax:
                design[row, -1] = wobble[d, v]
            value[row] = place[d, v]
            doubt[row] = seen.error[d, v]
    scaled = design / doubt[:, None]
    if np.linalg.matrix_rank(scaled) < unknowns:
        return None
    solution, *_ = np.linalg.lstsq(scaled, value / doubt, rcond=None)
    covariance = np.linalg.inv(scaled.T @ scaled)
    missed = float((((design @ solution - value) / doubt) ** 2).sum())
    keep = slice(2 * len(used), unknowns)
    found = solution[keep].copy()
    spread = covariance[keep, keep].copy()
    found[:2] /= _DAYS_PER_YEAR
    spread[:2, :] /= _DAYS_PER_YEAR
    spread[:, :2] /= _DAYS_PER_YEAR
    return found, spread, missed, design.shape[0] - unknowns


def _path(
    seen: _Seen, detectors: Sequence[int], passes: Sequence[int], chosen: np.ndarray
) -> _Path:
    """Path of one source through the visits, from the detectors chosen."""
    known = np.isfinite(seen.x) & np.isfinite(seen.y) & np.isfinite(seen.error) & chosen[:, None]
    if not known.any():
        return _Path(sightings=(), motion=None, stretch=1.0)
    sightings, stretch = _sightings(seen, known, detectors, passes)
    if len(sightings) < 2:
        return _Path(sightings=sightings, motion=None, stretch=stretch)

    fitted = _fit(seen, known, with_parallax=False)
    if fitted is None:
        return _Path(sightings=sightings, motion=None, stretch=stretch)
    # A nearby object swings back and forth with the seasons on top of its straight
    # line. The swing is kept when the positions ask for it clearly: three visits at
    # least, enough leftovers to check it, a parallax above zero and a fit that it
    # improves for good.
    parallax = False
    wobbles = bool(np.any(seen.wobble_x[known] != 0) or np.any(seen.wobble_y[known] != 0))
    if wobbles and len(sightings) >= _VISITS_FOR_PARALLAX:
        swinging = _fit(seen, known, with_parallax=True)
        if swinging is not None and swinging[3] >= _LEFTOVERS_FOR_PARALLAX and swinging[0][2] > 0:
            gained = (fitted[2] - swinging[2]) / max(1.0, swinging[2] / swinging[3])
            if gained >= _CLEAR_PARALLAX**2:
                fitted, parallax = swinging, True
    found, spread, missed, freedom = fitted

    # Does the source follow the path? A center pushed back and forth by the spike of a
    # neighbor does not. When the path fits worse than chance allows, the motion is as
    # unsure as the fit is bad, and that forgiveness itself rests on a few leftovers.
    scale, forgiven = 1.0, False
    if freedom < 2:
        scale = stretch
    elif missed > freedom + _BEYOND_CHANCE * np.sqrt(2 * freedom):
        scale, forgiven = float(np.sqrt(missed / freedom)), True
    rate = found[:2]
    significance = float(np.sqrt(rate @ np.linalg.solve(spread[:2, :2], rate))) / scale
    if forgiven and freedom < _ALWAYS_TRUSTED:
        significance = _as_sure_as(significance, freedom)
    days = sightings[-1].time_mjd - sightings[0].time_mjd
    motion = Motion(
        rate_x=float(rate[0]),
        rate_y=float(rate[1]),
        rate_error=float(scale * np.sqrt((spread[0, 0] + spread[1, 1]) / 2)),
        shift_x=float(rate[0] * days),
        shift_y=float(rate[1] * days),
        days=float(days),
        significance=significance,
        checked=freedom >= 2,
        parallax=float(found[2]) if parallax else None,
        parallax_error=float(scale * np.sqrt(spread[2, 2])) if parallax else None,
    )
    return _Path(sightings=sightings, motion=motion, stretch=stretch)


def _follow(seen: _Seen, detectors: Sequence[int], passes: Sequence[int]) -> _Path:
    """Path of one source, from all the detectors that agree on it.

    When the detectors disagree, they may not be looking at the same object: a cold
    object in front of a star shows in the last detector alone. The detector with the
    clearest motion is then followed, with those that see the same motion.
    """
    everyone = np.ones(len(detectors), dtype=bool)
    together = _path(seen, detectors, passes, everyone)
    if together.stretch <= _DISAGREEMENT:
        return together
    alone = [
        _path(seen, detectors, passes, np.arange(len(detectors)) == d)
        for d in range(len(detectors))
    ]
    moving = [path.motion for path in alone if path.motion is not None]
    if not moving:
        return together
    leader = max(moving, key=lambda motion: motion.significance)
    if leader.significance < _CLEAR_ALONE:
        return together
    same = np.array(
        [
            path.motion is not None
            and np.hypot(path.motion.rate_x - leader.rate_x, path.motion.rate_y - leader.rate_y)
            <= _SAME_MOTION * np.hypot(path.motion.rate_error, leader.rate_error)
            for path in alone
        ]
    )
    return _path(seen, detectors, passes, same)


def _pairs(first: _Pile, second: _Pile) -> list[tuple[int, int]]:
    """Frames of two piles taken at the same wavelength, each frame used once."""
    gap = np.abs(first.wavelength_um[:, None] - second.wavelength_um[None, :])
    width = np.minimum(first.bandwidth_um[:, None], second.bandwidth_um[None, :])
    near = np.nonzero(gap <= _SAME_WAVELENGTH * width)
    used_first: set[int] = set()
    used_second: set[int] = set()
    pairs = []
    for _, i, j in sorted((float(gap[i, j]), int(i), int(j)) for i, j in zip(*near, strict=True)):
        if i not in used_first and j not in used_second:
            used_first.add(i)
            used_second.add(j)
            pairs.append((i, j))
    return pairs


def _ratio(
    first: tuple[np.ndarray, np.ndarray],
    second: tuple[np.ndarray, np.ndarray],
    pairs: list[tuple[int, int]],
) -> tuple[float, float, int] | None:
    """Brightness of the second pile over the first, its uncertainty and the pairs used.

    Each pile comes as the light of the source in its frames and the noise of that
    light. The uncertainty is the larger of two: what the scatter of the pairs shows,
    and what the noise of the frames allows.
    """
    before, before_noise = (np.array([values[i] for i, _ in pairs]) for values in first)
    after, after_noise = (np.array([values[j] for _, j in pairs]) for values in second)
    both = np.isfinite(before) & np.isfinite(after)
    seen = both & (before > 0) & (after > 0)
    if seen.sum() < max(_FEWEST_PAIRS, _SEEN_SHARE * both.sum()):
        return None
    ratios = after[seen] / before[seen]
    middle, shown = _median(ratios)
    allowed = ratios * np.hypot(before_noise[seen] / before[seen], after_noise[seen] / after[seen])
    expected = _MEDIAN_LOSS * float(np.median(allowed)) / float(np.sqrt(ratios.size))
    return middle, max(shown, expected), int(ratios.size)


def _changes(
    piles: dict[tuple[int, int], _Pile],
    light: dict[tuple[int, int, int], tuple[np.ndarray, np.ndarray]],
    count: int,
) -> list[list[Change]]:
    """Brightness ratios of every source between the visits of each detector.

    Most sources of a field are steady. Their median ratio is what the instrument and
    the choice of wavelengths did between two visits, and it is taken out.
    """
    changes: list[list[Change]] = [[] for _ in range(count)]
    keys = sorted(piles)
    for index, (detector, first_pass) in enumerate(keys):
        for other, second_pass in keys[index + 1 :]:
            if other != detector:
                continue
            first, second = piles[(detector, first_pass)], piles[(detector, second_pass)]
            pairs = _pairs(first, second)
            if len(pairs) < _FEWEST_PAIRS:
                continue
            waves = [float(first.wavelength_um[i]) for i, _ in pairs]
            measured: dict[int, tuple[float, float, int]] = {}
            for s in range(count):
                before = light.get((s, detector, first_pass))
                after = light.get((s, detector, second_pass))
                if before is None or after is None:
                    continue
                result = _ratio(before, after, pairs)
                if result is not None:
                    measured[s] = result
            steady = np.array(
                [np.log(r) for r, e, _ in measured.values() if e / r <= _REFERENCE_RATIO_ERROR]
            )
            zero, floor = 0.0, _UNCALIBRATED_RATIO
            if steady.size >= _FEWEST_REFERENCES:
                zero, doubt = _median(steady)
                floor = float(np.hypot(_RATIO_FLOOR, doubt))
            for s, (ratio, ratio_error, used) in measured.items():
                corrected = float(ratio / np.exp(zero))
                relative = float(np.hypot(ratio_error / ratio, floor))
                changes[s].append(
                    Change(
                        detector=detector,
                        from_pass=first_pass,
                        to_pass=second_pass,
                        ratio=corrected,
                        error=corrected * relative,
                        significance=float(abs(np.log(corrected)) / relative),
                        wavelength_um=(min(waves), max(waves)),
                        pairs=used,
                    )
                )
    return changes


Wobble = Callable[[np.ndarray], tuple[np.ndarray, np.ndarray]]


def measure_field(frames: Sequence[FieldFrame], wobble: Wobble | None = None) -> Field:
    """Measure every source of a field in every visit.

    The frames are those of one view, all on the same grid, from any number of
    detectors and visits. `wobble` gives, for dates in days (MJD), where a parallax of
    one pixel puts a source of the field along x and y. Without it no parallax is fitted.
    """
    piles = _piles(frames)
    if not piles:
        return Field(visits=(), sources=(), saturated=())
    passes = sorted({key[1] for key in piles})
    detectors = sorted({key[0] for key in piles})
    visits = []
    for number in passes:
        times = np.concatenate([pile.time_mjd for key, pile in piles.items() if key[1] == number])
        visits.append(Visit(pass_number=number, time_mjd=float(times.mean()), frames=times.size))

    hearts = _saturated_hearts(frames)
    found, by_detector = _find(piles, hearts)
    count = len(found)
    start_x = np.array([peak[0] for peak in found])
    start_y = np.array([peak[1] for peak in found])

    shape = (count, len(detectors), len(passes))
    x = np.full(shape, np.nan)
    y = np.full(shape, np.nan)
    error = np.full(shape, np.nan)
    time = np.full(shape[1:], np.nan)
    rng = np.random.default_rng(_SEED)
    in_glare = [_in_glare(peak, found) for peak in found]
    for d, detector in enumerate(detectors):
        hidden = np.array(
            [
                glare
                or _near_heart(peak[0], peak[1], hearts[detector])
                or _crowded(peak, by_detector[detector])
                for peak, glare in zip(found, in_glare, strict=True)
            ],
            dtype=bool,
        )
        for v, number in enumerate(passes):
            pile = piles.get((detector, number))
            if pile is None:
                continue
            time[d, v] = pile.time_mjd.mean()
            if count and pile.values.shape[0] >= _FEWEST_FRAMES:
                x[:, d, v], y[:, d, v], error[:, d, v] = _positions(pile, start_x, start_y, rng)
                x[hidden, d, v] = np.nan
                y[hidden, d, v] = np.nan
    _register(x, y, error)
    still = np.zeros(time.shape)
    wobble_x, wobble_y = wobble(np.nan_to_num(time)) if wobble else (still, still)
    paths = [
        _follow(_Seen(x[s], y[s], error[s], time, wobble_x, wobble_y), detectors, passes)
        for s in range(count)
    ]

    # Light of every source in every frame, at the place it had during the visit.
    light = {
        (s, detector, sighting.pass_number): brightness(
            piles[(detector, sighting.pass_number)].values, sighting.x, sighting.y
        )
        for s, path in enumerate(paths)
        for sighting in path.sightings
        for detector in sighting.detectors
    }
    changes = _changes(piles, light, count)

    sources = [
        FieldSource(
            x=float(np.mean([sighting.x for sighting in path.sightings])),
            y=float(np.mean([sighting.y for sighting in path.sightings])),
            snr=found[s][2],
            sightings=path.sightings,
            motion=path.motion,
            changes=tuple(changes[s]),
        )
        for s, path in enumerate(paths)
        if path.sightings
    ]
    return Field(visits=tuple(visits), sources=tuple(sources), saturated=_saturated_stars(hearts))
