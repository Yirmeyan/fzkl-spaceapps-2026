import pytest
from pydantic import ValidationError

from spherex_explorer.config import Settings


def test_origins_are_split_and_trimmed():
    settings = Settings(
        _env_file=None,
        allowed_origins=" https://a.example/ , http://localhost:5173 ,",
    )

    assert settings.allowed_origin_list == ["https://a.example", "http://localhost:5173"]


def test_origin_without_scheme_is_rejected():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, allowed_origins="example.org")


def test_unknown_log_level_is_rejected():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, log_level="LOUD")


def test_environment_variable_overrides_default(monkeypatch):
    monkeypatch.setenv("SPX_LOG_LEVEL", "debug")

    assert Settings(_env_file=None).log_level == "DEBUG"


def test_data_releases_are_listed_in_order_of_preference():
    settings = Settings(_env_file=None, sia_collections=" spherex_qr3 , spherex_dr1 ,")

    assert settings.sia_collection_list == ["spherex_qr3", "spherex_dr1"]


@pytest.mark.parametrize("value", ["", " , ", "spherex dr1", "spherex_dr1;drop", "SPHEREX_DR1"])
def test_invalid_list_of_data_releases_is_rejected(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, sia_collections=value)


def test_search_address_without_scheme_is_rejected():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, sia_url="irsa.ipac.caltech.edu/SIA")


def test_search_address_loses_its_trailing_slash():
    settings = Settings(_env_file=None, sia_url="https://archive.example/SIA/")

    assert settings.sia_url == "https://archive.example/SIA"


@pytest.mark.parametrize(
    "setting",
    [
        {"search_radius_deg": 0},
        {"archive_timeout_s": 0},
        {"archive_budget_s": -1},
        {"archive_attempts": 0},
        {"archive_attempts": 11},
        {"max_exposures": 0},
    ],
)
def test_limit_that_makes_no_sense_is_rejected(setting):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **setting)
