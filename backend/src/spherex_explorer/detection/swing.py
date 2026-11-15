"""Bodies of the outer solar system: they swing with the seasons, by more than a source is followed.

A star a few light-years away swings by a fraction of an arcsecond as the Earth goes
around the Sun, and `field` fits that swing around one place. A body a few thousand
astronomical units away swings by tens of arcseconds: it is at one place during a visit
and at another during the next. Around either place it is a source that comes and goes.

Here the body is followed instead. For a parallax that is tried, the place of a body on
every frame is known, but for where the Sun would see it. Each frame is read with that
shift: the body stays where it is and adds up, visit after visit, while the stars of
the field slide. A body is a source that is there in every visit, at the same place once
followed, where the sky shows nothing, or far less, in the visits when the body is
elsewhere. That last demand tells it from two stars that happen to sit along the line.

Positions are in pixels of the default view, as everywhere in the detection.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from spherex_explorer.detection.sources import centroids, peaks, signal_to_noise
from spherex_explorer.detection.stack import all_nan_allowed, average

# Parallaxes tried, in pixels of the default view: 2.8 arcseconds each. A parallax of
# 3 pixels is a body 24,000 astronomical units away, and one of 46 a body at 1,600.
# Farther, the two places of a body overlap. Nearer, they do not fit in the view.
SMALLEST_PARALLAX = 3.0
LARGEST_PARALLAX = 46.0
_STEP = 1.0
# Around the best of them the parallax is tried again, this finely and this far.
_FINE_STEP = 0.25
_FINE_REACH = 1.0
# A body may be this far from where the trial puts it, in pixels: the trials are a pixel
# apart, and a body has a motion of its own on top of its swing.
_REACH = 2
# What every visit must show within that reach, and what all of them must show at one
# same place, in units of the scatter of the sky.
_THERE = 6.0
_AT_THE_SAME_PLACE = 5.0
# The sky is empty where it shows less than this, or less than this share of what the
# body shows during its own visit. A star that stays where it is spends little time
# under a body that crosses many pixels during a visit: to pass for the body it would
# have to be that many times brighter, the path counted in lengths of this many pixels.
_ABSENT = 3.0
_FAINTER = 0.3
_DWELL = 4.0
# A visit with fewer frames than this share of the richest one is a thin visit. It is
# not asked to show the body as the others are, only not to contradict them: it must
# show half of what its share of frames lets it show, less this many times its scatter.
# Half, because that share is a rough guide: a few frames are averaged by their median,
# and they are not at the wavelengths of the others.
_THIN_VISIT = 1 / 3
_SHARE_EXPECTED = 0.5
_CONTRADICTED = 3.0
# In a thin visit a place is measured where the body stands this far above the sky.
_SEEN_IN_A_THIN_VISIT = 4.0
# Two places of a body can be told apart when they are this far from each other.
_APART = 5.0
# A visit of fewer frames than this in a detector cannot clean itself: it is left aside.
_FEWEST_FRAMES = 3
# Under this many frames, nothing is left out of an average: the median is used.
_FEWEST_TO_TRIM = 5
_SHARE_NEEDED = 0.5
# Nothing is looked for where a body would come this close to the edge of the view.
_EDGE = 8
# Two finds this close are one body, found at two neighboring parallaxes.
_SAME_BODY = 6.0
# Dates along a visit where the place of the body is checked against the fixed sky.
_DATES_ALONG_A_VISIT = 9
# A detector shows the body on its own when it stands this far above the sky there.
_SEEN_ALONE = 3.0
# Width of a star once smoothed, in pixels: a position is known to that width over how
# far the source stands above the sky, and never better than the floor.
_SMOOTHED_WIDTH = 2.2
_POSITION_FLOOR = 0.3
# The two reddest detectors: a cold body shows there and nowhere else.
_REDDEST = (5, 6)

Wobble = Callable[[np.ndarray], tuple[np.ndarray, np.ndarray]]


class Pile(Protocol):
    """Frames of one detector and one visit, background removed, as `field` holds them."""

    values: np.ndarray
    stack: np.ndarray
    time_mjd: np.ndarray


@dataclass(frozen=True, slots=True)
class Place:
    """Where a body is during one visit, and the detectors that show it."""

    pass_number: int
    time_mjd: float
    x: float
    y: float
    error: float
    detectors: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class Swing:
    """A body followed through its swing with the seasons.

    `x` and `y` are where the Sun would see it at `time_mjd`. The parallax, in pixels,
    is how far it is from that place when the swing is of one unit. Its own motion, in
    pixels per day, is measured with three visits or more. With two it cannot be told
    from the swing: `followed` is False and the rates are zero.
    """

    x: float
    y: float
    time_mjd: float
    parallax: float
    parallax_error: float
    rate_x: float
    rate_y: float
    rate_error: float
    followed: bool
    significance: float
    places: tuple[Place, ...]


def read_along(values: np.ndarray, shift: np.ndarray) -> np.ndarray:
    """Frames read where a body would be. NaN where that falls outside the frame.

    `shift` holds, for each frame, how far the body is from where the Sun would see it,
    in whole pixels along x and y.
    """
    out = np.full_like(values, np.nan)
    height, width = values.shape[1:]
    for index, (dx, dy) in enumerate(shift):
        left, right = max(0, -dx), min(width, width - dx)
        top, bottom = max(0, -dy), min(height, height - dy)
        if left < right and top < bottom:
            out[index, top:bottom, left:right] = values[
                index, top + dy : bottom + dy, left + dx : right + dx
            ]
    return out


def without_the_brightest(values: np.ndarray) -> np.ndarray:
    """Average of frames, the brightest left out at each place. NaN where too few have a value.

    The frames of a visit are cleaned by comparing them at each place of the sky. A
    body that moves during the visit would be taken there for the accident of one
    exposure, and removed. Frames read along a path are cleaned otherwise: with the
    brightest one left out, one accident cannot make a source, and a source that is
    there in every frame loses one of them.
    """
    frames = values.shape[0]
    if frames < _FEWEST_TO_TRIM:
        return average(values)
    known = np.isfinite(values)
    count = known.sum(axis=0)
    total = np.where(known, values, 0.0).sum(axis=0, dtype=np.float64)
    top = np.where(known, values, -np.inf).max(axis=0)
    enough = count >= max(_FEWEST_FRAMES, _SHARE_NEEDED * frames)
    with all_nan_allowed():
        return np.where(enough, (total - top) / np.maximum(count - 1, 1), np.nan)


def _widest(image: np.ndarray, reach: int) -> np.ndarray:
    """The highest value within `reach` pixels of each place. No value counts as none."""
    filled = np.where(np.isfinite(image), image, -np.inf)
    padded = np.pad(filled, reach, constant_values=-np.inf)
    height, width = image.shape
    side = 2 * reach + 1
    return np.max(
        [padded[dy : dy + height, dx : dx + width] for dy in range(side) for dx in range(side)],
        axis=0,
    )


def _together(maps: Mapping[int, np.ndarray]) -> np.ndarray:
    """How far a place stands above the sky in several detectors at once.

    All the detectors are taken together, and the two reddest on their own: the four
    others would drown a cold body. The better of the two is kept at each place.
    """

    def joined(detectors: list[int]) -> np.ndarray:
        count = np.sum([np.isfinite(maps[d]) for d in detectors], axis=0)
        total = np.sum([np.nan_to_num(maps[d], nan=0.0) for d in detectors], axis=0)
        enough = count >= max(1, (len(detectors) + 1) // 2)
        return np.where(enough, total / np.sqrt(np.maximum(count, 1)), np.nan)

    every = joined(sorted(maps))
    reddest = [d for d in _REDDEST if d in maps]
    return np.fmax(every, joined(reddest)) if reddest else every


@dataclass(frozen=True, slots=True)
class _Find:
    x: float
    y: float
    parallax: float
    significance: float


class _Search:
    """The frames of a field, ready to be read along the path of a body."""

    def __init__(self, piles: Mapping[tuple[int, int], Pile], wobble: Wobble) -> None:
        self.piles = {
            key: pile for key, pile in piles.items() if pile.values.shape[0] >= _FEWEST_FRAMES
        }
        self.visits = sorted({key[1] for key in self.piles})
        self.swing = {
            key: np.column_stack(wobble(pile.time_mjd)) for key, pile in self.piles.items()
        }
        self.time: dict[int, float] = {}
        self.middle: dict[int, np.ndarray] = {}
        self.along: dict[int, np.ndarray] = {}
        self.still: dict[int, np.ndarray] = {}
        frames: dict[int, int] = {}
        for visit in self.visits:
            keys = [key for key in self.piles if key[1] == visit]
            times = np.concatenate([self.piles[key].time_mjd for key in keys])
            frames[visit] = times.size
            self.time[visit] = float(times.mean())
            self.middle[visit] = np.concatenate([self.swing[key] for key in keys]).mean(axis=0)
            dates = np.linspace(times.min(), times.max(), _DATES_ALONG_A_VISIT)
            self.along[visit] = np.column_stack(wobble(dates))
            fixed = {key[0]: signal_to_noise(self.piles[key].stack) for key in keys}
            self.still[visit] = _widest(_together(fixed), _REACH)
        self.size = next(iter(self.still.values())).shape[0] if self.still else 0
        richest = max(frames.values(), default=0)
        # What a visit can show of a body, next to the richest one: noise falls as the
        # square root of the number of frames.
        self.depth = {visit: float(np.sqrt(count / richest)) for visit, count in frames.items()}
        self.full = [visit for visit in self.visits if frames[visit] >= _THIN_VISIT * richest]

    def followed(self, parallax: float, visit: int) -> dict[int, np.ndarray]:
        """Each detector of a visit read along the path of a body of that parallax."""
        maps = {}
        for (detector, number), pile in self.piles.items():
            if number == visit:
                shift = np.rint(parallax * self.swing[(detector, number)]).astype(np.int64)
                maps[detector] = signal_to_noise(
                    without_the_brightest(read_along(pile.values, shift))
                )
        return maps

    def _elsewhere_empty(
        self, parallax: float, x: float, y: float, shown: Mapping[int, float]
    ) -> bool:
        """Is the sky empty, in the other visits, where the body is during each visit?

        `shown` tells how far the body stands above the sky in each visit that shows it.
        """
        at = {visit: np.array([x, y]) + parallax * self.middle[visit] for visit in self.visits}
        inside = all(
            _EDGE <= at[visit][0] <= self.size - 1 - _EDGE
            and _EDGE <= at[visit][1] <= self.size - 1 - _EDGE
            for visit in shown
        )
        if not inside:
            return False
        checked = 0
        for visit, level in shown.items():
            crossed = parallax * self.along[visit]
            length = float(np.hypot(*np.diff(crossed, axis=0).T).sum())
            path = np.rint(np.array([x, y]) + crossed).astype(np.int64)
            path = path[
                (path[:, 0] >= 0)
                & (path[:, 0] < self.size)
                & (path[:, 1] >= 0)
                & (path[:, 1] < self.size)
            ]
            if path.size == 0:
                return False
            allowed = max(_ABSENT, _FAINTER * level * max(1.0, length / _DWELL))
            for other in self.visits:
                if other == visit or np.hypot(*(at[other] - at[visit])) < _APART:
                    continue
                checked += 1
                if float(self.still[other][path[:, 1], path[:, 0]].max()) >= allowed:
                    return False
        # One visit against one other, each way: under that nothing was checked.
        return checked >= 2

    def _shown(self, wide: Mapping[int, np.ndarray], x: float, y: float) -> dict[int, float] | None:
        """How far the body stands above the sky in each visit that shows it.

        None when a thin visit contradicts the others: it shows far less than its share
        of frames lets it show of what they see.
        """
        row, column = int(y), int(x)
        shown = {visit: float(wide[visit][row, column]) for visit in self.full}
        least = min(shown.values())
        for visit in self.visits:
            if visit in shown:
                continue
            level = float(wide[visit][row, column])
            if level < _SHARE_EXPECTED * self.depth[visit] * least - _CONTRADICTED:
                return None
            if level >= _SEEN_IN_A_THIN_VISIT:
                shown[visit] = level
        return shown

    def finds(self, parallaxes: np.ndarray) -> list[_Find]:
        """Bodies that hold for one of the parallaxes, with how surely."""
        found = []
        for parallax in parallaxes:
            seen = {
                visit: _together(self.followed(float(parallax), visit)) for visit in self.visits
            }
            wide = {visit: _widest(seen[visit], _REACH) for visit in self.visits}
            nearby = np.min([wide[visit] for visit in self.full], axis=0)
            same = _widest(
                np.min([np.nan_to_num(seen[visit], nan=-np.inf) for visit in self.full], axis=0), 1
            )
            for x, y, _ in peaks(np.where(np.isfinite(nearby), nearby, np.nan), _THERE):
                level = float(same[int(y), int(x)])
                if level < _AT_THE_SAME_PLACE:
                    continue
                shown = self._shown(wide, x, y)
                if shown is not None and self._elsewhere_empty(float(parallax), x, y, shown):
                    found.append(_Find(x, y, float(parallax), level))
        return found

    def measured(self, find: _Find) -> Swing | None:
        """The body of a find: where it is in each visit, and what its places say."""
        places = []
        swings = []
        for visit in self.visits:
            maps = self.followed(find.parallax, visit)
            seen = _together(maps)
            thin = visit not in self.full
            if thin and _widest(seen, _REACH)[int(find.y), int(find.x)] < _SEEN_IN_A_THIN_VISIT:
                continue
            found_x, found_y = centroids(seen, np.array([find.x]), np.array([find.y]))
            if not np.isfinite(found_x[0]):
                if thin:
                    continue
                return None
            x, y = float(found_x[0]), float(found_y[0])
            row, column = round(y), round(x)
            level = float(_widest(seen, 1)[row, column])
            if level <= 0:
                if thin:
                    continue
                return None
            swings.append(self.middle[visit])
            alone = tuple(
                detector
                for detector, one in sorted(maps.items())
                if _widest(one, 1)[row, column] >= _SEEN_ALONE
            )
            # The frames were read a whole number of pixels away: that is what is put back.
            read_at = np.concatenate(
                [np.rint(find.parallax * self.swing[key]) for key in self.piles if key[1] == visit]
            ).mean(axis=0)
            sky = np.array([x, y]) + read_at
            places.append(
                Place(
                    pass_number=visit,
                    time_mjd=self.time[visit],
                    x=float(sky[0]),
                    y=float(sky[1]),
                    error=float(np.hypot(_SMOOTHED_WIDTH / level, _POSITION_FLOOR)),
                    detectors=alone or tuple(sorted(maps)),
                )
            )
        return _fitted(places, swings, find.significance)


def _fitted(places: list[Place], swing: list[np.ndarray], significance: float) -> Swing | None:
    """Where the Sun would see the body, its parallax and its own motion, from its places.

    Each place is where the Sun would see the body, plus the parallax times the swing
    of the visit, plus the motion since the middle of the visits. With two visits the
    motion is left out: there is nothing to measure it with.
    """
    times = np.array([place.time_mjd for place in places])
    middle = float(times.mean())
    followed = len(places) >= 3
    rows, values, weights = [], [], []
    for place, (swing_x, swing_y) in zip(places, swing, strict=True):
        days = place.time_mjd - middle
        rows.append([1.0, 0.0, swing_x, days if followed else 0.0, 0.0])
        rows.append([0.0, 1.0, swing_y, 0.0, days if followed else 0.0])
        values += [place.x, place.y]
        weights += [1.0 / place.error, 1.0 / place.error]
    unknowns = 5 if followed else 3
    design = np.array(rows)[:, :unknowns] * np.array(weights)[:, None]
    solution, *_ = np.linalg.lstsq(design, np.array(values) * np.array(weights), rcond=None)
    try:
        spread = np.linalg.inv(design.T @ design)
    except np.linalg.LinAlgError:
        return None
    left = np.array(values) - np.array(rows)[:, :unknowns] @ solution
    if np.hypot(left[0::2], left[1::2]).max() > _REACH or solution[2] <= 0:
        return None
    rate_x, rate_y = (float(solution[3]), float(solution[4])) if followed else (0.0, 0.0)
    rate_error = float(np.sqrt((spread[3, 3] + spread[4, 4]) / 2)) if followed else 0.0
    return Swing(
        x=float(solution[0]),
        y=float(solution[1]),
        time_mjd=middle,
        parallax=float(solution[2]),
        parallax_error=float(np.sqrt(spread[2, 2])),
        rate_x=rate_x,
        rate_y=rate_y,
        rate_error=rate_error,
        followed=followed,
        significance=significance,
        places=tuple(places),
    )


def find_swings(piles: Mapping[tuple[int, int], Pile], wobble: Wobble) -> tuple[Swing, ...]:
    """Bodies of the field that swing with the seasons, the surest first.

    `wobble` gives, for dates in days (MJD), where a parallax of one pixel puts a body
    along x and y. It takes two visits at least, on opposite sides of the swing.
    """
    search = _Search(piles, wobble)
    if len(search.full) < 2:
        return ()
    coarse = np.arange(SMALLEST_PARALLAX, LARGEST_PARALLAX + _STEP / 2, _STEP)
    best: list[_Find] = []
    for find in sorted(search.finds(coarse), key=lambda find: -find.significance):
        if all(np.hypot(find.x - other.x, find.y - other.y) > _SAME_BODY for other in best):
            best.append(find)
    swings = []
    for find in best:
        fine = np.arange(
            max(SMALLEST_PARALLAX - _FINE_REACH, find.parallax - _FINE_REACH),
            find.parallax + _FINE_REACH + _FINE_STEP / 2,
            _FINE_STEP,
        )
        close = [
            other
            for other in search.finds(fine)
            if np.hypot(other.x - find.x, other.y - find.y) <= _SAME_BODY
        ]
        if not close:
            continue
        swing = search.measured(max(close, key=lambda other: other.significance))
        if swing is not None:
            swings.append(swing)
    return tuple(sorted(swings, key=lambda swing: -swing.significance))
