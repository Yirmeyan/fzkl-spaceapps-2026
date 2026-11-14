"""Reader of SPHEREx level 2 files: the pixels of a small window, read by byte ranges.

A level 2 file holds one exposure of one detector and weighs 61 to 65 MB:

    PRIMARY    header only
    IMAGE      2040 x 2040 float32, not compressed. Its header holds the sky coordinates
    FLAGS      32-bit masks, compressed with the Rice algorithm one row at a time
    VARIANCE   2040 x 2040 float32, not compressed
    ZODI, EPSF not read here
    WCS-WAVE   small table that gives the wavelength of each pixel, last in the file

Three small reads find where everything is: the layout. Three more bring the rows of
a window, about 1.4 MB for a view of 0.1 degree. Nothing here interprets the pixels.
"""

import asyncio
import re
from collections import OrderedDict
from dataclasses import dataclass

import numpy as np

from spherex_explorer.archive.exposure import key_from_id
from spherex_explorer.archive.fits import (
    BLOCK,
    Header,
    data_length,
    header_length,
    integer,
    parse_header,
    text,
)
from spherex_explorer.archive.rice import decode_rows
from spherex_explorer.archive.s3 import RangeReader
from spherex_explorer.errors import UpstreamError

# Sizes of the first read of each header, chosen above what the files hold today:
# 28,800 bytes for PRIMARY and the IMAGE header, 33,600 for the FLAGS header and its
# table of rows, 11,520 for the VARIANCE header. A longer header costs one more read.
_FIRST_READ = 14 * BLOCK
_FLAGS_READ = 17 * BLOCK
_VARIANCE_READ = 6 * BLOCK
_WAVELENGTH_READ = 2 * BLOCK
# No header of these files comes close to this. Beyond it, the file is not what we expect.
_LONGEST_HEADER = 128 * BLOCK
# Compressed rows of one window, far above what 2040 rows can weigh.
_MOST_FLAG_BYTES = 32 * 1024 * 1024
_FLOAT_BYTES = 4
_PIXEL_BITS = -32
_FLAG_BITS = 32
# Descriptor of a compressed row: its size, then its place in the heap of the table.
_DESCRIPTORS = {"P": ">i4", "Q": ">i8"}
_DESCRIPTOR_FORM = re.compile(r"1?([PQ])B(?:\(\d+\))?")
_COLUMN_FORM = re.compile(r"(\d*)([IJKED])")
_COLUMN_TYPES = {"I": ">i2", "J": ">i4", "K": ">i8", "E": ">f4", "D": ">f8"}
_WAVELENGTH_UNIT = "WCS-WAVE"


@dataclass(frozen=True, slots=True)
class Window:
    """Rectangle of detector pixels, counted from 0. The end column and row are excluded."""

    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def width(self) -> int:
        return self.x1 - self.x0

    @property
    def height(self) -> int:
        return self.y1 - self.y0


@dataclass(frozen=True, slots=True, eq=False)
class Layout:
    """Where the useful parts of one file are, and the header that describes its image."""

    header: Header
    width: int
    height: int
    image_start: int
    variance_start: int
    heap_start: int
    # Size and place in the heap of each compressed row of flags.
    row_sizes: np.ndarray
    row_offsets: np.ndarray
    blocksize: int
    bytes_per_pixel: int
    # Name and mask of each kind of flag, as the header of FLAGS defines them.
    flag_planes: dict[str, int]


@dataclass(frozen=True, slots=True, eq=False)
class RawWindow:
    """Pixels of a window as the file stores them, rows first."""

    window: Window
    # Surface brightness in MJy/sr, and its variance when it was asked for.
    image: np.ndarray
    variance: np.ndarray | None
    # One 32-bit mask per pixel. The meaning of each bit is in the header.
    flags: np.ndarray


@dataclass(frozen=True, slots=True, eq=False)
class WavelengthTable:
    """Wavelength and bandwidth at a grid of control points of the detector.

    `x` and `y` are the pixel coordinates of the control points, counted from 1 as
    FITS does. `values[j, i]` is the wavelength then the bandwidth, in micrometers,
    at `x[i]`, `y[j]`. Between the points, the values are interpolated.
    """

    x: np.ndarray
    y: np.ndarray
    values: np.ndarray


def _expect_image(header: Header, name: str) -> tuple[int, int]:
    """Check that a unit is a plain image of 32-bit floats, and give its width and height."""
    if text(header, "XTENSION", name) != "IMAGE" or text(header, "EXTNAME", name) != name:
        raise UpstreamError(f"{name} is not where the layout of a level 2 file puts it")
    if integer(header, "BITPIX", name) != _PIXEL_BITS or integer(header, "NAXIS", name) != 2:
        raise UpstreamError(f"{name} is not a two-dimensional image of 32-bit floats")
    if header.get("BSCALE", 1) != 1 or header.get("BZERO", 0) != 0:
        raise UpstreamError(f"{name} stores scaled pixels, which this reader does not handle")
    width = integer(header, "NAXIS1", name)
    height = integer(header, "NAXIS2", name)
    if width <= 0 or height <= 0:
        raise UpstreamError(f"{name} is empty")
    return width, height


def _compression_setting(header: Header, setting: str, default: int) -> int:
    """Value of a ZNAMEn/ZVALn pair of the compression, or its default."""
    index = 1
    while f"ZNAME{index}" in header:
        if text(header, f"ZNAME{index}", "FLAGS") == setting:
            return integer(header, f"ZVAL{index}", "FLAGS")
        index += 1
    return default


def _expect_flags(header: Header, width: int, height: int) -> tuple[str, int, int]:
    """Check how FLAGS is compressed. Gives the descriptor type, block size and pixel size."""
    name = "FLAGS"
    compressed = (
        text(header, "XTENSION", name) == "BINTABLE"
        and text(header, "EXTNAME", name) == name
        and header.get("ZIMAGE") is True
    )
    if not compressed:
        raise UpstreamError(f"{name} is not where the layout of a level 2 file puts it")
    if text(header, "ZCMPTYPE", name) != "RICE_1":
        raise UpstreamError(f"{name} is not compressed with the Rice algorithm")
    same_shape = (
        integer(header, "ZNAXIS", name) == 2
        and integer(header, "ZNAXIS1", name) == width
        and integer(header, "ZNAXIS2", name) == height
        and integer(header, "NAXIS2", name) == height
    )
    if not same_shape:
        raise UpstreamError(f"{name} does not have the shape of IMAGE")
    one_row_per_tile = (
        integer(header, "ZTILE1", name, default=width) == width
        and integer(header, "ZTILE2", name, default=1) == 1
    )
    if not one_row_per_tile:
        raise UpstreamError(f"{name} is not compressed one row at a time")
    form = _DESCRIPTOR_FORM.fullmatch(text(header, "TFORM1", name))
    if text(header, "TTYPE1", name) != "COMPRESSED_DATA" or form is None:
        raise UpstreamError(f"the first column of {name} does not hold the compressed rows")
    bytes_per_pixel = _compression_setting(header, "BYTEPIX", default=4)
    if integer(header, "ZBITPIX", name) != _FLAG_BITS or bytes_per_pixel * 8 != _FLAG_BITS:
        raise UpstreamError(f"{name} does not hold 32-bit masks")
    blocksize = _compression_setting(header, "BLOCKSIZE", default=32)
    return _DESCRIPTORS[form.group(1)], blocksize, bytes_per_pixel


def _flag_planes(header: Header) -> dict[str, int]:
    """Kinds of flags a file defines: the name in MSKNnnnn, the mask in MSKMnnnn."""
    planes: dict[str, int] = {}
    for keyword in header:
        if not (keyword.startswith("MSKN") and keyword[4:].isdigit()):
            continue
        name = header.get(keyword)
        mask = header.get("MSKM" + keyword[4:])
        usable = isinstance(name, str) and isinstance(mask, int) and not isinstance(mask, bool)
        if usable and 0 < mask <= 0xFFFFFFFF:
            planes[name.strip()] = mask
    return planes


def _check_window(window: Window, layout: Layout) -> None:
    inside = (
        0 <= window.x0 < window.x1 <= layout.width and 0 <= window.y0 < window.y1 <= layout.height
    )
    if not inside:
        raise ValueError(
            f"{window} is empty or outside an image of {layout.width} x {layout.height}"
        )


def parse_wavelength_table(raw: bytes) -> WavelengthTable:
    """Read the WCS-WAVE unit from the last bytes of a file."""
    name = _WAVELENGTH_UNIT
    length = header_length(raw)
    if length is None:
        raise UpstreamError(f"{name} is not at the end of the file, where it was expected")
    header = parse_header(raw[:length], name)
    if header.get("XTENSION") != "BINTABLE" or header.get("EXTNAME", "").strip() != name:
        raise UpstreamError(f"{name} is not at the end of the file, where it was expected")
    row = raw[length : length + integer(header, "NAXIS1", name)]
    if len(row) != integer(header, "NAXIS1", name) or integer(header, "NAXIS2", name) != 1:
        raise UpstreamError(f"{name} does not hold exactly one row")

    columns: dict[str, np.ndarray] = {}
    shapes: dict[str, str] = {}
    position = 0
    for index in range(1, integer(header, "TFIELDS", name) + 1):
        form = _COLUMN_FORM.fullmatch(text(header, f"TFORM{index}", name))
        if form is None:
            raise UpstreamError(f"column {index} of {name} has a type this reader does not know")
        kind = np.dtype(_COLUMN_TYPES[form.group(2)])
        count = int(form.group(1) or 1)
        column = text(header, f"TTYPE{index}", name)
        chunk = row[position : position + count * kind.itemsize]
        if len(chunk) != count * kind.itemsize:
            raise UpstreamError(f"{name} is shorter than its header says")
        columns[column] = np.frombuffer(chunk, dtype=kind).astype(np.float64)
        shapes[column] = str(header.get(f"TDIM{index}", ""))
        position += count * kind.itemsize

    missing = [column for column in ("X", "Y", "VALUES") if column not in columns]
    if missing:
        raise UpstreamError(f"{name} has no column {missing}")
    x, y, values = columns["X"], columns["Y"], columns["VALUES"]
    # FITS lists the fastest axis first: (2, len(x), len(y)) there is (len(y), len(x), 2) here.
    expected = f"(2,{x.size},{y.size})"
    if shapes["VALUES"].replace(" ", "") != expected or values.size != 2 * x.size * y.size:
        raise UpstreamError(f"VALUES of {name} has the shape {shapes['VALUES']!r}, not {expected}")
    return WavelengthTable(x=x, y=y, values=values.reshape(y.size, x.size, 2))


class Level2Reader:
    """Reads windows of level 2 files, and remembers where things are in each file."""

    def __init__(
        self, ranges: RangeReader, *, remembered_layouts: int = 256, remembered_tables: int = 64
    ) -> None:
        self._ranges = ranges
        # A file never changes once published, so its layout is found once.
        self._layouts: OrderedDict[str, Layout] = OrderedDict()
        self._tables: OrderedDict[tuple[str, str, str], WavelengthTable] = OrderedDict()
        self._remembered_layouts = remembered_layouts
        self._remembered_tables = remembered_tables

    async def layout(self, exposure_id: str) -> Layout:
        """Layout of the file of an exposure, with the header of its image."""
        key = key_from_id(exposure_id)
        layout = self._layouts.get(exposure_id)
        if layout is None:
            layout = await self._find_layout(key)
            self._layouts[exposure_id] = layout
            while len(self._layouts) > self._remembered_layouts:
                self._layouts.popitem(last=False)
        return layout

    async def read_window(
        self, exposure_id: str, window: Window, *, with_variance: bool = True
    ) -> RawWindow:
        """Image and flags of a window of an exposure, and its variance unless told otherwise.

        The variance weighs as much as the image and only a measurement needs it: a
        caller that measures a small part asks for it with `read_variance`.
        """
        key = key_from_id(exposure_id)
        layout = await self.layout(exposure_id)
        _check_window(window, layout)
        reads = [
            self._band(key, layout.image_start, layout.width, window, "IMAGE"),
            self._flag_rows(key, layout, window),
        ]
        if with_variance:
            reads.append(self._band(key, layout.variance_start, layout.width, window, "VARIANCE"))
        image, flags, *variance = await asyncio.gather(*reads)
        return RawWindow(
            window=window, image=image, variance=variance[0] if variance else None, flags=flags
        )

    async def read_variance(self, exposure_id: str, window: Window) -> np.ndarray:
        """Variance of a window of an exposure, in the square of the unit of the image."""
        key = key_from_id(exposure_id)
        layout = await self.layout(exposure_id)
        _check_window(window, layout)
        return await self._band(key, layout.variance_start, layout.width, window, "VARIANCE")

    async def wavelength_table(self, exposure_id: str) -> WavelengthTable:
        """Wavelength table of an exposure. One read serves a whole detector of a release."""
        key = key_from_id(exposure_id)
        collection, observation, version = exposure_id.split(".")
        calibration = (collection, observation.rsplit("D", 1)[1], version)
        table = self._tables.get(calibration)
        if table is None:
            table = parse_wavelength_table(await self._ranges.read_tail(key, _WAVELENGTH_READ))
            self._tables[calibration] = table
            while len(self._tables) > self._remembered_tables:
                self._tables.popitem(last=False)
        return table

    async def _header(
        self, key: str, offset: int, raw: bytes, name: str
    ) -> tuple[Header, int, bytes]:
        """Header that starts at `offset`, from the bytes already read there.

        Gives the header, its length, and the bytes that follow it in what was read.
        """
        length = header_length(raw)
        while length is None:
            if len(raw) >= _LONGEST_HEADER:
                raise UpstreamError(f"the header of {name} has no end")
            more = await self._ranges.read(key, offset + len(raw), max(len(raw), BLOCK))
            if not more:
                raise UpstreamError(f"the file ends inside the header of {name}")
            raw += more
            length = header_length(raw)
        return parse_header(raw[:length], name), length, raw[length:]

    async def _find_layout(self, key: str) -> Layout:
        raw = await self._ranges.read(key, 0, _FIRST_READ)
        primary, image_offset, rest = await self._header(key, 0, raw, "PRIMARY")
        if data_length(primary, "PRIMARY") != 0:
            raise UpstreamError("PRIMARY holds data, which a level 2 file does not")
        header, length, _ = await self._header(key, image_offset, rest, "IMAGE")
        width, height = _expect_image(header, "IMAGE")
        image_start = image_offset + length

        flags_offset = image_start + data_length(header, "IMAGE")
        raw = await self._ranges.read(key, flags_offset, _FLAGS_READ)
        flags, length, rest = await self._header(key, flags_offset, raw, "FLAGS")
        descriptor, blocksize, bytes_per_pixel = _expect_flags(flags, width, height)
        table_start = flags_offset + length
        row_bytes = integer(flags, "NAXIS1", "FLAGS")
        table_bytes = row_bytes * height
        if len(rest) < table_bytes:
            rest += await self._ranges.read(key, table_start + len(rest), table_bytes - len(rest))
        pair_bytes = 2 * np.dtype(descriptor).itemsize
        if len(rest) < table_bytes or row_bytes < pair_bytes:
            raise UpstreamError("the table of FLAGS is shorter than its header says")
        rows = np.frombuffer(rest[:table_bytes], dtype=np.uint8).reshape(height, row_bytes)
        pairs = rows[:, :pair_bytes].copy().view(descriptor).astype(np.int64)
        heap_start = table_start + integer(flags, "THEAP", "FLAGS", default=table_bytes)

        variance_offset = table_start + data_length(flags, "FLAGS")
        raw = await self._ranges.read(key, variance_offset, _VARIANCE_READ)
        variance, length, _ = await self._header(key, variance_offset, raw, "VARIANCE")
        if _expect_image(variance, "VARIANCE") != (width, height):
            raise UpstreamError("VARIANCE does not have the shape of IMAGE")

        return Layout(
            header=header,
            width=width,
            height=height,
            image_start=image_start,
            variance_start=variance_offset + length,
            heap_start=heap_start,
            row_sizes=pairs[:, 0],
            row_offsets=pairs[:, 1],
            blocksize=blocksize,
            bytes_per_pixel=bytes_per_pixel,
            flag_planes=_flag_planes(flags),
        )

    async def _band(
        self, key: str, start: int, width: int, window: Window, name: str
    ) -> np.ndarray:
        """Window of an image stored without compression.

        Rows follow each other in the file, so one range runs from the first pixel
        of the window to its last one. The columns outside the window come along.
        """
        first = window.y0 * width + window.x0
        count = (window.height - 1) * width + window.width
        raw = await self._ranges.read(key, start + first * _FLOAT_BYTES, count * _FLOAT_BYTES)
        if len(raw) != count * _FLOAT_BYTES:
            raise UpstreamError(f"{name} is shorter than its header says")
        stored = np.frombuffer(raw, dtype=">f4")
        wanted = np.arange(window.height)[:, None] * width + np.arange(window.width)[None, :]
        return stored[wanted].astype(np.float32)

    async def _flag_rows(self, key: str, layout: Layout, window: Window) -> np.ndarray:
        """Window of the flags: its rows are read whole, decompressed, then cut."""
        sizes = layout.row_sizes[window.y0 : window.y1]
        offsets = layout.row_offsets[window.y0 : window.y1]
        first = int(offsets.min())
        length = int((offsets + sizes).max()) - first
        if int(sizes.min()) <= 0 or first < 0 or length > _MOST_FLAG_BYTES:
            raise UpstreamError("the table of FLAGS describes rows that cannot exist")
        raw = await self._ranges.read(key, layout.heap_start + first, length)
        if len(raw) != length:
            raise UpstreamError("FLAGS is shorter than its header says")
        rows = [
            raw[offset - first : offset - first + size]
            for offset, size in zip(offsets.tolist(), sizes.tolist(), strict=True)
        ]
        decoded = decode_rows(
            rows,
            width=layout.width,
            blocksize=layout.blocksize,
            bytes_per_pixel=layout.bytes_per_pixel,
        )
        return decoded[:, window.x0 : window.x1].copy()
