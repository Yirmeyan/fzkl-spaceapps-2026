"""Answer to "show me this exposure": one exposure cut out and aligned on the grid of a view."""

import asyncio
import math
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from spherex_explorer.archive import (
    Layout,
    RawWindow,
    WavelengthTable,
    Window,
    detector_from_id,
)
from spherex_explorer.archive.fits import integer
from spherex_explorer.errors import UpstreamError
from spherex_explorer.frames import (
    DetectorWcs,
    Grid,
    background_and_noise,
    flag_plan,
    grid_to_sky,
    has_no_value,
    is_saturated,
    pixel_centers,
    resample,
    sky_to_grid,
    translate,
    valid_fraction,
    wavelength_at,
)
from spherex_explorer.photometry import Measurement, measure, share_inside_circle
from spherex_explorer.photometry.aperture import APERTURE_RADIUS, SKY_OUTER_RADIUS
from spherex_explorer.targets import Target, position_at

# Detector pixels kept around the target for its measurement: the sky ring, and one more.
TARGET_REACH = math.ceil(SKY_OUTER_RADIUS) + 1
# No view comes close to this many detector pixels along a side. Beyond it, the
# coordinates of the file are not what they claim to be.
_WIDEST_WINDOW = 800


class FrameSource(Protocol):
    """What a frame needs from the archive. Tests provide their own."""

    async def layout(self, exposure_id: str) -> Layout: ...

    async def read_window(
        self, exposure_id: str, window: Window, *, with_variance: bool = True
    ) -> RawWindow: ...

    async def read_variance(self, exposure_id: str, window: Window) -> np.ndarray: ...

    async def wavelength_table(self, exposure_id: str) -> WavelengthTable: ...


@dataclass(frozen=True, slots=True, eq=False)
class Frame:
    """One exposure on the grid of a view, with what was measured on it."""

    id: str
    time_mjd: float
    exposure_s: float
    wavelength_um: float
    bandwidth_um: float
    background: float | None
    noise: float | None
    valid_fraction: float
    target_xy: tuple[float, float]
    photometry: Measurement
    # Surface brightness in MJy/sr, NaN where there is no value, and the flags of a frame.
    image: np.ndarray
    mask: np.ndarray


def header_number(layout: Layout, keyword: str) -> float:
    """Number read in the header of the image, or an error that names it."""
    value = layout.header.get(keyword)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise UpstreamError(f"{keyword} of IMAGE is missing or is not a number")
    return float(value)


def _window(
    layout: Layout, x: np.ndarray, y: np.ndarray, target: tuple[float, float]
) -> Window | None:
    """Detector pixels to read: those under the grid, and those around the target."""
    width, height = layout.width, layout.height
    on_detector = (
        np.isfinite(x) & np.isfinite(y) & (x >= 0) & (x <= width - 1) & (y >= 0) & (y <= height - 1)
    )
    lows_x, highs_x, lows_y, highs_y = [], [], [], []
    if on_detector.any():
        lows_x.append(math.floor(x[on_detector].min()))
        highs_x.append(math.floor(x[on_detector].max()) + 2)
        lows_y.append(math.floor(y[on_detector].min()))
        highs_y.append(math.floor(y[on_detector].max()) + 2)
    target_x, target_y = target
    near = (
        math.isfinite(target_x)
        and math.isfinite(target_y)
        and -TARGET_REACH <= target_x <= width - 1 + TARGET_REACH
        and -TARGET_REACH <= target_y <= height - 1 + TARGET_REACH
    )
    if near:
        lows_x.append(math.floor(target_x) - TARGET_REACH)
        highs_x.append(math.floor(target_x) + TARGET_REACH + 1)
        lows_y.append(math.floor(target_y) - TARGET_REACH)
        highs_y.append(math.floor(target_y) + TARGET_REACH + 1)
    if not lows_x:
        return None
    window = Window(
        x0=max(0, min(lows_x)),
        y0=max(0, min(lows_y)),
        x1=min(width, max(highs_x)),
        y1=min(height, max(highs_y)),
    )
    if window.width < 2 or window.height < 2:
        return None
    if window.width > _WIDEST_WINDOW or window.height > _WIDEST_WINDOW:
        raise UpstreamError(f"the view would need {window.width} x {window.height} detector pixels")
    return window


async def build_frame(source: FrameSource, exposure_id: str, target: Target, grid: Grid) -> Frame:
    """Read one exposure and put it on the grid.

    The pixels are interpolated at the place each pixel of the grid has on the
    detector. The target is measured on the original pixels, where it was at the date
    of the exposure.
    """
    layout = await source.layout(exposure_id)
    wcs = DetectorWcs.from_header(layout.header)
    time_mjd = header_number(layout, "MJD-AVG")
    exposure_s = header_number(layout, "XPOSURE")
    if integer(layout.header, "NAXIS1", "IMAGE") != layout.width:
        raise UpstreamError("the header of IMAGE disagrees with its layout")

    grid_x, grid_y = pixel_centers(grid)
    detector_x, detector_y = wcs.sky_to_pixel(*grid_to_sky(grid, grid_x, grid_y))
    target_ra, target_dec = position_at(target, time_mjd)
    target_in_grid = sky_to_grid(grid, np.array(target_ra), np.array(target_dec))
    target_x, target_y = (float(value) for value in wcs.sky_to_pixel(target_ra, target_dec))
    center_x, center_y = (float(value) for value in wcs.sky_to_pixel(grid.ra, grid.dec))

    window = _window(layout, detector_x, detector_y, (target_x, target_y))
    table_read = source.wavelength_table(exposure_id)
    if window is None:
        table = await table_read
        image = np.full((grid.size, grid.size), np.nan, dtype=np.float32)
        mask = np.zeros((grid.size, grid.size), dtype=np.uint8)
        photometry = Measurement(flux_mjy=None, error_mjy=None, quality="outside")
    else:
        circle = circle_window(layout, target_x, target_y)
        reads = [source.read_window(exposure_id, window, with_variance=False), table_read]
        if circle is not None:
            reads.append(source.read_variance(exposure_id, circle))
        raw, table, *measured = await asyncio.gather(*reads)
        plan = flag_plan(layout.flag_planes)
        window_mask = translate(raw.flags, plan)
        no_value = has_no_value(raw.flags, plan)
        values = np.where(no_value, np.nan, raw.image)
        image, mask = resample(values, window_mask, detector_x - window.x0, detector_y - window.y0)
        area_x = target_x if math.isfinite(target_x) else center_x
        area_y = target_y if math.isfinite(target_y) else center_y
        photometry = measure_in_window(
            exposure_id,
            raw,
            window,
            window_mask,
            no_value,
            is_saturated(raw.flags, plan),
            circle,
            measured[0] if circle is not None else None,
            (target_x, target_y),
            wcs.pixel_area_sr(area_x, area_y),
        )

    wavelength, bandwidth = wavelength_at(table, center_x, center_y)
    background, noise = background_and_noise(image, mask)
    return Frame(
        id=exposure_id,
        time_mjd=time_mjd,
        exposure_s=exposure_s,
        wavelength_um=wavelength,
        bandwidth_um=bandwidth,
        background=background,
        noise=noise,
        valid_fraction=valid_fraction(image),
        target_xy=(float(target_in_grid[0]), float(target_in_grid[1])),
        photometry=photometry,
        image=image,
        mask=mask,
    )


def measure_in_window(
    exposure_id: str,
    raw: RawWindow,
    window: Window,
    window_mask: np.ndarray,
    no_value: np.ndarray,
    saturated: np.ndarray,
    circle: Window | None,
    circle_variance: np.ndarray | None,
    target: tuple[float, float],
    pixel_area_sr: float,
) -> Measurement:
    """Measure a target on the original pixels of a window that holds its sky ring.

    The variance is as heavy as the image and only the measurement uses it, inside its
    circle. Reading it there alone nearly halves what an exposure downloads.
    """
    variance = np.full(raw.image.shape, np.nan, dtype=np.float32)
    if circle is not None and circle_variance is not None:
        variance[
            circle.y0 - window.y0 : circle.y1 - window.y0,
            circle.x0 - window.x0 : circle.x1 - window.x0,
        ] = circle_variance
    return measure(
        raw.image,
        variance,
        window_mask,
        no_value,
        saturated,
        target[0] - window.x0,
        target[1] - window.y0,
        pixel_area_sr,
        share_inside_circle(detector_from_id(exposure_id)),
    )


def circle_window(layout: Layout, x: float, y: float) -> Window | None:
    """Detector pixels the circle of the measurement touches. None when it leaves the detector."""
    on_detector = (
        math.isfinite(x)
        and math.isfinite(y)
        and APERTURE_RADIUS <= x <= layout.width - 1 - APERTURE_RADIUS
        and APERTURE_RADIUS <= y <= layout.height - 1 - APERTURE_RADIUS
    )
    if not on_detector:
        return None
    reach = APERTURE_RADIUS + 0.5
    return Window(
        x0=max(0, math.floor(x - reach)),
        y0=max(0, math.floor(y - reach)),
        x1=min(layout.width, math.floor(x + reach) + 2),
        y1=min(layout.height, math.floor(y + reach) + 2),
    )
