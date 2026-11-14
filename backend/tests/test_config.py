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
