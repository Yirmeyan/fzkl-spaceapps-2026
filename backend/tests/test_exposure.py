import pytest

from spherex_explorer.archive import InvalidExposure, exposure_from_key, key_from_id

KEY = (
    "qr3/level2/2026W33_2A/l2b-v27-2026-241/6/level2_2026W33_2A_0594_3D6_spx_l2b-v27-2026-241.fits"
)
RETRIED_KEY = (
    "dr1/level2/2025W35_1A/l2b_retry-v27-2026-230/3/"
    "level2_2025W35_1A_0123_2D3_spx_l2b_retry-v27-2026-230.fits"
)


def test_exposure_is_named_after_its_file():
    exposure = exposure_from_key(KEY, 61268.63)

    assert exposure.id == "qr3.2026W33_2A_0594_3D6.l2b-v27-2026-241"
    assert exposure.collection == "qr3"
    assert exposure.detector == 6
    assert exposure.time_mjd == 61268.63
    assert exposure.observation == "2026W33_2A_0594_3D6"


@pytest.mark.parametrize("key", [KEY, RETRIED_KEY])
def test_identifier_gives_the_key_back(key):
    assert key_from_id(exposure_from_key(key, 0.0).id) == key


@pytest.mark.parametrize(
    "key",
    [
        "",
        "https://example.org/" + KEY,
        "../" + KEY,
        KEY.replace("level2/", "level3/", 1),
        KEY.replace("/6/", "/5/"),
        KEY.replace("D6_spx_l2b-v27-2026-241", "D6_spx_l2b-v27-2026-999"),
        KEY.replace("level2/2026W33_2A/", "level2/2026W34_2A/"),
        KEY + "?versionId=1",
        KEY.replace(".fits", ".fits.gz"),
    ],
)
def test_key_of_another_shape_is_refused(key):
    with pytest.raises(InvalidExposure):
        exposure_from_key(key, 0.0)


@pytest.mark.parametrize(
    "identifier",
    [
        "",
        "qr3",
        "qr3.2026W33_2A_0594_3D7.l2b-v27-2026-241",
        "qr3.2026W33_2A_0594_3D6.L2B-v27-2026-241",
        "qr3.2026W33_2A_0594_3D6.l2b-v27-2026-241/../../secret",
        "qr3/2026W33_2A_0594_3D6.l2b-v27-2026-241",
        "https://example.org/qr3.2026W33_2A_0594_3D6.l2b-v27-2026-241",
        "qr3.2026W33_2A_0594_3D6.l2b-v27-2026-241\n",
        "xx3.2026W33_2A_0594_3D6.l2b-v27-2026-241",
    ],
)
def test_identifier_of_another_shape_is_refused(identifier):
    with pytest.raises(InvalidExposure):
        key_from_id(identifier)
