"""The halo of a saturated star: its light, read where the detector still can.

A star too bright for SPHEREx has no usable pixel at its heart. Its light still spreads
far around it, and that halo is as bright as the star is: when the star fades by half,
so does its halo. The brightness of the halo, taken in a ring around the heart, follows
the star from one visit to the next. It does not give its flux.

The halo is read in two rings, one further out than the other. Where both can be read
they must tell the same change, and what they disagree by counts as uncertainty.
"""

import numpy as np

from spherex_explorer.detection.stack import all_nan_allowed

# The first ring starts this many pixels outside the saturated heart, and never closer
# to the star than this. Pixels of the default view, 2.8 arcseconds. The second ring
# starts where the first one ends.
_FROM_HEART = 6.0
_CLOSEST = 13.0
_WIDTH = 7.0
# The sky and the faint end of the halo are taken far from the star, and removed.
_FAR_INNER = 38.0
_FAR_OUTER = 55.0
_FEWEST_FAR = 500
# Share of a ring that must be on the image and hold a value. The spikes of a bright
# star turn with the telescope: on a piece of ring, one spike is enough to move a median.
_SHARE_OF_RING = 2.0 / 3.0
# How far the halo of a steady star wanders between two visits, as a share of its
# brightness: what a change of the halo must beat. Set on the seven saturated stars of
# the test fields that are not known to change much, then checked on eight bright giants
# chosen before the run. Over the fifteen, 205 comparisons, the usual wander is 4
# percent in detectors 4 to 6 and 10 percent in detectors 1 to 3, where the wings of a
# star are full of structure. Now and then one detector alone jumps by much more, up
# to 50 percent: that is left to the rule that a change must show in two detectors.
_STEADY_WITHIN = {1: 0.15, 2: 0.15, 3: 0.15, 4: 0.05, 5: 0.05, 6: 0.05}


def steady_within(detector: int) -> float:
    """How far the halo of a steady star wanders between two visits, in one detector."""
    return _STEADY_WITHIN.get(detector, max(_STEADY_WITHIN.values()))


def ring_starts(heart_radius: float) -> tuple[float, float]:
    """Where the two rings that read a halo start, for a saturated heart of this radius."""
    first = max(_CLOSEST, heart_radius + _FROM_HEART)
    return first, first + _WIDTH


def halo_light(frames: np.ndarray, x: float, y: float, start: float) -> np.ndarray:
    """Brightness of the halo of a star in each frame of a pile, in a ring from `start`.

    It is the median of the ring minus the median of a far ring, in the unit of the
    frames. Medians ignore the neighbors of the star and its spikes, which turn on the
    sky from one visit to the next. NaN where too little of the ring is on the image
    and holds a value, or where the ring would reach the far one.
    """
    height, width = frames.shape[1:]
    nothing = np.full(frames.shape[0], np.nan)
    if not (np.isfinite(x) and np.isfinite(y)) or start + _WIDTH > _FAR_INNER:
        return nothing
    distance = np.hypot(np.arange(width)[None, :] - x, np.arange(height)[:, None] - y)
    near = (distance >= start) & (distance <= start + _WIDTH)
    far = (distance >= _FAR_INNER) & (distance <= _FAR_OUTER)
    fewest = _SHARE_OF_RING * np.pi * ((start + _WIDTH) ** 2 - start**2)
    if near.sum() < fewest or far.sum() < _FEWEST_FAR:
        return nothing
    around = frames[:, near]
    beyond = frames[:, far]
    enough = (np.isfinite(around).sum(axis=1) >= fewest) & (
        np.isfinite(beyond).sum(axis=1) >= _FEWEST_FAR
    )
    with all_nan_allowed():
        light = np.nanmedian(around, axis=1) - np.nanmedian(beyond, axis=1)
    return np.where(enough, light, np.nan)
