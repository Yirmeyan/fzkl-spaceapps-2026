"""Made-up fields: frames of stars that stay, move, swing, fade or saturate."""

import numpy as np

from spherex_explorer.detection import FieldFrame

SIZE = 96
OVERFLOW = 2
STAR_WIDTH = 1.6
HALO_WIDTH = 4.0
NOISE = 0.02
# Six steady stars, bright enough to line the visits up on each other.
STEADY = [(20.3, 22.6), (70.8, 18.2), (25.4, 72.9), (76.1, 74.5), (15.7, 47.3), (80.2, 46.4)]


def star(x: float, y: float, light: float = 1.0, size: int = SIZE) -> np.ndarray:
    """A round star of a given total light, as SPHEREx draws one on the default view."""
    rows, columns = np.mgrid[0:size, 0:size]
    shape = np.exp(-((columns - x) ** 2 + (rows - y) ** 2) / (2 * STAR_WIDTH**2))
    return light * shape / (2 * np.pi * STAR_WIDTH**2)


def halo(x: float, y: float, light: float = 1.0, size: int = SIZE) -> np.ndarray:
    """The wide halo of a very bright star: far from it, it falls as the cube of the distance."""
    rows, columns = np.mgrid[0:size, 0:size]
    return light / (1.0 + ((columns - x) ** 2 + (rows - y) ** 2) / HALO_WIDTH**2) ** 1.5


def add_bright_star(frames, x: float, y: float, light, saturating) -> None:
    """Give the frames the halo of a very bright star, and blind its heart where it saturates.

    `light(visit)` is the brightness of the halo during a visit, and `saturating` the
    detectors the star is too bright for.
    """
    column, row = round(x), round(y)
    for frame in frames:
        frame.image[:] += halo(x, y, light(frame.pass_number)).astype(np.float32)
        if frame.detector in saturating:
            frame.image[row - 3 : row + 4, column - 3 : column + 4] = np.nan
            frame.mask[row - 4 : row + 5, column - 4 : column + 5] |= OVERFLOW


def field_frames(
    scene,
    *,
    detectors=(2, 5),
    visits=(1, 2, 3),
    per_visit=8,
    seed=1,
    noise=NOISE,
) -> list[FieldFrame]:
    """Frames of a made-up field.

    `scene(detector, visit, wavelength)` gives the stars of a frame as (x, y, light).
    Each visit lasts a few days, six months after the one before, and each frame is
    taken at its own wavelength, as with SPHEREx.
    """
    rng = np.random.default_rng(seed)
    frames = []
    for detector in detectors:
        low = 1.0 * detector
        for visit in visits:
            for wavelength in rng.permutation(np.linspace(low, low + 0.5, per_visit)):
                image = rng.normal(0.0, noise, (SIZE, SIZE))
                for x, y, light in scene(detector, visit, wavelength):
                    image += star(x, y, light)
                background = 0.3 + 0.1 * rng.random()
                frames.append(
                    FieldFrame(
                        detector=detector,
                        pass_number=visit,
                        time_mjd=60800.0 + 182.6 * (visit - 1) + 3 * rng.random(),
                        wavelength_um=float(wavelength),
                        bandwidth_um=0.5 / per_visit,
                        background=background,
                        image=(image + background).astype(np.float32),
                        mask=np.zeros((SIZE, SIZE), dtype=np.uint8),
                    )
                )
    return frames


def seasons(time_mjd: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """A made-up swing: one way in the odd visits, the other way in the even ones."""
    visit = np.rint((np.asarray(time_mjd) - 60800.0) / 182.6)
    side = np.where(visit % 2 == 0, 1.0, -1.0)
    return 0.8 * side, -0.6 * side


def steady_stars(light: float = 40.0):
    return [(x, y, light) for x, y in STEADY]
