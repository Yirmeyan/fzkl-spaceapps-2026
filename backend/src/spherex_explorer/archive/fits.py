"""Just enough of the FITS format to find one part of a remote file.

A FITS file is a chain of units. Each unit is a text header followed by binary data,
both padded to blocks of 2880 bytes. A header says how long its data is, so reading
it tells where the next unit starts. Nothing here touches the network.
"""

from astropy.io import fits

from spherex_explorer.errors import UpstreamError

BLOCK = 2880
_CARD = 80
_END_CARD = b"END" + b" " * (_CARD - 3)


def padded(size: int) -> int:
    """Size rounded up to whole blocks."""
    return -(-size // BLOCK) * BLOCK


def header_length(raw: bytes) -> int | None:
    """Length in bytes of the header that starts raw, padding included.

    None when raw stops before the end of the header: the caller reads more.
    """
    position = raw.find(_END_CARD)
    while position != -1:
        # The word END can appear inside a comment. Only a whole card counts.
        if position % _CARD == 0:
            return padded(position + _CARD)
        position = raw.find(_END_CARD, position + 1)
    return None


def parse_header(raw: bytes, what: str) -> fits.Header:
    """Header read from its bytes. `what` names the unit in error messages."""
    try:
        return fits.Header.fromstring(raw.decode("ascii"))
    except (UnicodeDecodeError, ValueError, fits.VerifyError) as exc:
        raise UpstreamError(f"the header of {what} cannot be read: {exc}") from exc


def integer(header: fits.Header, keyword: str, what: str, default: int | None = None) -> int:
    """Integer value of a keyword, or an error that names what is missing."""
    try:
        value = header.get(keyword, default)
    except (ValueError, fits.VerifyError) as exc:
        raise UpstreamError(f"{keyword} of {what} cannot be read: {exc}") from exc
    if isinstance(value, bool) or not isinstance(value, int):
        raise UpstreamError(f"{keyword} of {what} is not an integer: {value!r}")
    return value


def text(header: fits.Header, keyword: str, what: str) -> str:
    """Text value of a keyword, without its padding."""
    try:
        value = header.get(keyword)
    except (ValueError, fits.VerifyError) as exc:
        raise UpstreamError(f"{keyword} of {what} cannot be read: {exc}") from exc
    if not isinstance(value, str):
        raise UpstreamError(f"{keyword} of {what} is not a text: {value!r}")
    return value.strip()


def data_length(header: fits.Header, what: str) -> int:
    """Bytes taken by the data that follows a header, padding included."""
    axes = integer(header, "NAXIS", what)
    if axes == 0:
        return 0
    count = 1
    for axis in range(1, axes + 1):
        count *= integer(header, f"NAXIS{axis}", what)
    bytes_per_value = abs(integer(header, "BITPIX", what)) // 8
    groups = integer(header, "GCOUNT", what, default=1)
    extra = integer(header, "PCOUNT", what, default=0)
    return padded(bytes_per_value * groups * (extra + count))
