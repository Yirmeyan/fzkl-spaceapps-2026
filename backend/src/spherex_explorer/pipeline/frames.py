"""Answer to "show me this exposure": one exposure cut out and aligned on the grid of a view."""

import asyncio
import math
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from spherex_explorer.archive import Layout, RawWindow, WavelengthTable, Window
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
from spherex_explorer.photometry import Measurement, measure
from spherex_explorer.photometry.aperture import APERTURE_RADIUS, SKY_OUTER_RADIUS
from spherex_explorer.targets import Target, position_at

# Detector pixels kept around the target for its measurement: the sky ring, and one more.
_REACH = math.ceil(SKY_OUTER_RADIUS) + 1
# No view comes close to this many detector pixels along a side. Beyond it, the
# coordinates of the file are not what they claim to be.
_WIDEST_WINDOW = 800


class FrameSource(Protocol):
    """What a frame needs from the archive. Tests provide their own."""

    async def layout(self, exposure_id: str) -> Layout: ...

    async def read_window(self, exposure_id: str, window: Window) -> RawWindow: ...

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


def _number(layout: Layout, keyword: str) -> float:
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
        and -_REACH <= target_x <= width - 1 + _REACH
        and -_REACH <= target_y <= height - 1 + _REACH
    )
    if near:
        lows_x.append(math.floor(target_x) - _REACH)
        highs_x.append(math.floor(target_x) + _REACH + 1)
        lows_y.append(math.floor(target_y) - _REACH)
        highs_y.append(math.floor(target_y) + _REACH + 1)
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
    time_mjd = _number(layout, "MJD-AVG")
    exposure_s = _number(layout, "XPOSURE")
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
        raw, table = await asyncio.gather(source.read_window(exposure_id, window), table_read)
        plan = flag_plan(layout.flag_planes)
        window_mask = translate(raw.flags, plan)
        no_value = has_no_value(raw.flags, plan)
        values = np.where(no_value, np.nan, raw.image)
        image, mask = resample(values, window_mask, detector_x - window.x0, detector_y - window.y0)
        area_x = target_x if math.isfinite(target_x) else center_x
        area_y = target_y if math.isfinite(target_y) else center_y
        photometry = measure(
            raw.image,
            raw.variance,
            window_mask,
            no_value,
            is_saturated(raw.flags, plan),
            target_x - window.x0,
            target_y - window.y0,
            wcs.pixel_area_sr(area_x, area_y),
        )
        if not _fully_on_detector(layout, target_x, target_y):
            photometry = Measurement(flux_mjy=None, error_mjy=None, quality="outside")

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


def _fully_on_detector(layout: Layout, x: float, y: float) -> bool:
    """True when the circle of the measurement is entirely on the detector."""
    return (
        math.isfinite(x)
        and math.isfinite(y)
        and APERTURE_RADIUS <= x <= layout.width - 1 - APERTURE_RADIUS
        and APERTURE_RADIUS <= y <= layout.height - 1 - APERTURE_RADIUS
    )
