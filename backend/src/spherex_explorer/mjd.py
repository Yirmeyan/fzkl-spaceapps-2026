"""Conversion of Modified Julian Dates to calendar dates, in UTC."""

from datetime import UTC, datetime, timedelta

_MJD_ORIGIN = datetime(1858, 11, 17, tzinfo=UTC)
_SECONDS_PER_DAY = 86400


def mjd_to_iso(mjd: float) -> str:
    """Calendar date of an MJD, rounded to the second: 2025-08-21T23:34:56Z."""
    moment = _MJD_ORIGIN + timedelta(seconds=round(mjd * _SECONDS_PER_DAY))
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")
