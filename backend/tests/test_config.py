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


def test_every_origin_is_allowed_by_default():
    assert Settings(_env_file=None).allowed_origin_list == ["*"]


def test_star_cannot_be_mixed_with_a_list_of_origins():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, allowed_origins="*,https://a.example")


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
        {"storage_timeout_s": 0},
        {"storage_attempts": 0},
        {"storage_concurrency": 0},
    ],
)
def test_limit_that_makes_no_sense_is_rejected(setting):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **setting)


def test_storage_address_is_built_from_the_bucket_and_its_region():
    settings = Settings(_env_file=None)

    assert settings.storage_url == "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com"


@pytest.mark.parametrize(
    "setting",
    [
        {"archive_bucket": "bucket.example/other"},
        {"archive_bucket": ""},
        {"archive_region": "us-east-1.evil.example"},
        {"archive_region": "US-EAST-1"},
    ],
)
def test_bucket_or_region_that_could_change_the_address_is_rejected(setting):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **setting)


def test_resolver_addresses_are_tried_in_the_order_given():
    settings = Settings(
        _env_file=None, resolver_urls="https://a.example/sesame/, https://b.example/s"
    )

    assert settings.resolver_url_list == ["https://a.example/sesame", "https://b.example/s"]


@pytest.mark.parametrize("value", ["", "cds.unistra.fr/sesame", "https://a.example/s?x=1"])
def test_resolver_address_that_cannot_be_called_is_rejected(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, resolver_urls=value)


def test_catalog_addresses_are_tried_in_the_order_given():
    settings = Settings(_env_file=None, catalog_urls="https://a.example/, https://b.example")

    assert settings.catalog_url_list == ["https://a.example", "https://b.example"]
    assert Settings(_env_file=None).catalog_url_list[0] == "https://vizier.cfa.harvard.edu"


@pytest.mark.parametrize("value", ["", "vizier.example", "https://a.example/tsv?x=1"])
def test_catalog_address_that_cannot_be_called_is_rejected(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, catalog_urls=value)


def test_the_journal_stays_in_memory_unless_a_project_is_named():
    settings = Settings(_env_file=None)
    assert settings.journal_project == ""
    assert settings.journal_open is True
    assert (
        Settings(_env_file=None, journal_project="my-project-1").journal_project == "my-project-1"
    )


@pytest.mark.parametrize("value", ["My Project", "a/b", "x", "project/../other"])
def test_a_project_of_the_journal_must_be_a_name(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, journal_project=value)


@pytest.mark.parametrize("value", ["", "marks/others", "a b", "../marks"])
def test_a_collection_of_the_journal_must_be_a_name(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, journal_collection=value)
