"""Runtime settings, read from environment variables and from an optional .env file."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})


def _split(value: str) -> list[str]:
    """Split a comma separated list, dropping blanks and trailing slashes."""
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


class Settings(BaseSettings):
    """Settings of the service. Each field maps to an SPX_ environment variable."""

    model_config = SettingsConfigDict(env_prefix="SPX_", env_file=".env", extra="ignore")

    environment: str = "development"
    log_level: str = "INFO"
    allowed_origins: str = "http://localhost:5173"

    @field_validator("log_level")
    @classmethod
    def _normalize_log_level(cls, value: str) -> str:
        level = value.strip().upper()
        if level not in _LOG_LEVELS:
            raise ValueError(f"log level must be one of {sorted(_LOG_LEVELS)}, got {value!r}")
        return level

    @field_validator("allowed_origins")
    @classmethod
    def _check_origins(cls, value: str) -> str:
        for origin in _split(value):
            if not origin.startswith(("http://", "https://")):
                raise ValueError(f"origin must start with http:// or https://, got {origin!r}")
        return value

    @property
    def allowed_origin_list(self) -> list[str]:
        """Origins allowed to call the API from a browser."""
        return _split(self.allowed_origins)


@lru_cache
def get_settings() -> Settings:
    """Settings of the running process, read once."""
    return Settings()
