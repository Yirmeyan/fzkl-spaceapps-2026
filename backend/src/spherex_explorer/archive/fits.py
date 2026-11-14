"""Just enough of the FITS format to find one part of a remote file.

A FITS file is a chain of units. Each unit is a text header followed by binary data,
both padded to blocks of 2880 bytes. A header says how long its data is, so reading
it tells where the next unit starts. Nothing here touches the network.

The headers are read here and not by Astropy: a level 2 file has three of them, some
700 cards, and a view reads hundreds of files. Reading the values alone takes a sixth
of the time, and that time was 40 percent of what the processor spent on a spectrum.
"""

from collections.abc import Mapping

from spherex_explorer.errors import UpstreamError

# Value of a card: a logical, a number, a text, or nothing when the card gives none.
Value = bool | int | float | str | None
# Values of the cards of a header by keyword. Comments and history are left out.
Header = Mapping[str, Value]

BLOCK = 2880
_CARD = 80
_END_CARD = b"END" + b" " * (_CARD - 3)
_KEYWORD = 8
# A card carries a value when these two characters follow its keyword.
_VALUE_MARK = "= "
_QUOTE = "'"
# Convention for keywords longer than eight characters: HIERARCH LONG KEYWORD = value.
_LONG_KEYWORD = "HIERARCH "


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


def _text_value(field: str) -> str | None:
    """Text between quotes at the start of a field. A quote inside it is written twice."""
    parts = []
    start = 1
    while True:
        close = field.find(_QUOTE, start)
        if close == -1:
            return None
        if field[close + 1 : close + 2] == _QUOTE:
            parts.append(field[start : close + 1])
            start = close + 2
            continue
        parts.append(field[start:close])
        # Spaces at the end of a text are padding, those at its start are part of it.
        return "".join(parts).rstrip()


def _value(field: str, keyword: str, what: str) -> Value:
    """Value written in a card, after its keyword and its equals sign."""
    field = field.lstrip()
    if field.startswith(_QUOTE):
        value = _text_value(field)
        if value is None:
            raise UpstreamError(f"{keyword} of {what} holds a text that never ends")
        return value
    # What follows a slash is a comment.
    token = field.partition("/")[0].strip()
    if token == "T":
        return True
    if token == "F":
        return False
    if not token:
        return None
    try:
        return int(token)
    except ValueError:
        pass
    try:
        # FORTRAN wrote the exponent of a double with a D.
        return float(token.replace("D", "E").replace("d", "e"))
    except ValueError:
        raise UpstreamError(f"{keyword} of {what} holds {token!r}, which is no value") from None


def parse_header(raw: bytes, what: str) -> dict[str, Value]:
    """Values of the cards of a header, by keyword. `what` names the unit in error messages.

    When a keyword comes twice, its first value is kept.
    """
    try:
        cards = raw.decode("ascii")
    except UnicodeDecodeError as exc:
        raise UpstreamError(f"the header of {what} cannot be read: {exc}") from exc
    header: dict[str, Value] = {}
    for start in range(0, len(cards), _CARD):
        card = cards[start : start + _CARD]
        if card[_KEYWORD : _KEYWORD + 2] == _VALUE_MARK:
            keyword, field = card[:_KEYWORD].rstrip(), card[_KEYWORD + 2 :]
        elif card.startswith(_LONG_KEYWORD) and "=" in card:
            keyword, _, field = card[len(_LONG_KEYWORD) :].partition("=")
            keyword = keyword.strip()
        elif card.startswith("END") and not card[3:].strip():
            break
        else:
            continue
        if keyword and keyword not in header:
            header[keyword] = _value(field, keyword, what)
    return header


def integer(header: Header, keyword: str, what: str, default: int | None = None) -> int:
    """Integer value of a keyword, or an error that names what is missing."""
    value = header.get(keyword, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise UpstreamError(f"{keyword} of {what} is not an integer: {value!r}")
    return value


def text(header: Header, keyword: str, what: str) -> str:
    """Text value of a keyword, without its padding."""
    value = header.get(keyword)
    if not isinstance(value, str):
        raise UpstreamError(f"{keyword} of {what} is not a text: {value!r}")
    return value.strip()


def data_length(header: Header, what: str) -> int:
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
