"""Runtime settings, read from environment variables and from an optional .env file."""

import re
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})
_COLLECTION_NAME = re.compile(r"[a-z0-9_]+")


def _split(value: str) -> list[str]:
    """Split a comma separated list, dropping blanks and trailing slashes."""
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


class Settings(BaseSettings):
    """Settings of the service. Each field maps to an SPX_ environment variable."""

    model_config = SettingsConfigDict(env_prefix="SPX_", env_file=".env", extra="ignore")

    environment: str = "development"
    log_level: str = "INFO"
    allowed_origins: str = "http://localhost:5173"

    # Exposure search of the IRSA archive.
    sia_url: str = "https://irsa.ipac.caltech.edu/SIA"
    # Data releases to search, by order of preference when both hold the same exposure.
    sia_collections: str = "spherex_dr1,spherex_qr3"
    archive_bucket: str = "nasa-irsa-spherex"
    search_radius_deg: float = Field(default=0.01, gt=0, le=1)
    # Longest wait for one answer of the archive, and longest time one request of this
    # service spends on the archive, all searches and attempts together. The second one
    # must stay below the request timeout of the host, 60 seconds on Cloud Run.
    archive_timeout_s: float = Field(default=25.0, gt=0, le=60)
    archive_budget_s: float = Field(default=45.0, gt=0, le=120)
    # The archive fails in bursts of a few seconds. Six attempts and the pauses between
    # them last about twelve seconds, enough to outlast the bursts seen so far.
    archive_attempts: int = Field(default=6, ge=1, le=10)
    max_exposures: int = Field(default=5000, ge=1, le=50000)

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

    @field_validator("sia_url")
    @classmethod
    def _check_sia_url(cls, value: str) -> str:
        url = value.strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise ValueError(
                f"the search address must start with http:// or https://, got {value!r}"
            )
        return url

    @field_validator("sia_collections")
    @classmethod
    def _check_collections(cls, value: str) -> str:
        names = _split(value)
        if not names:
            raise ValueError("at least one data release must be searched")
        for name in names:
            if not _COLLECTION_NAME.fullmatch(name):
                raise ValueError(f"not a data release name: {name!r}")
        return value

    @property
    def sia_collection_list(self) -> list[str]:
        """Data releases to search, in order of preference."""
        return _split(self.sia_collections)

    @property
    def allowed_origin_list(self) -> list[str]:
        """Origins allowed to call the API from a browser."""
        return _split(self.allowed_origins)


@lru_cache
def get_settings() -> Settings:
    """Settings of the running process, read once."""
    return Settings()
