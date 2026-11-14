"""How the numbers of an answer are rounded: well below what the instrument resolves."""

TIME_DECIMALS = 6
SKY_DECIMALS = 4
FLUX_DIGITS = 5


def rounded(value: float | None, decimals: int) -> float | None:
    """A number with a fixed count of decimals. Nothing stays nothing."""
    return None if value is None else round(value, decimals)


def significant(value: float | None) -> float | None:
    """A flux with five significant digits. Nothing stays nothing."""
    return None if value is None else float(f"{value:.{FLUX_DIGITS}g}")
