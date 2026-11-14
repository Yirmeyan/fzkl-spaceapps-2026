from spherex_explorer.mjd import mjd_to_iso


def test_mjd_is_written_as_a_utc_date():
    assert mjd_to_iso(60908.982595) == "2025-08-21T23:34:56Z"


def test_j2000_is_mjd_51544_5():
    assert mjd_to_iso(51544.5) == "2000-01-01T12:00:00Z"


def test_date_is_rounded_to_the_nearest_second():
    second = 1 / 86400

    assert mjd_to_iso(51544.5 + 0.4 * second) == "2000-01-01T12:00:00Z"
    assert mjd_to_iso(51544.5 + 0.6 * second) == "2000-01-01T12:00:01Z"
