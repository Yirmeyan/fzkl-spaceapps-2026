"""Runtime settings, read from environment variables and from an optional .env file."""

import re
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})
_COLLECTION_NAME = re.compile(r"[a-z0-9_]+")
# The bucket and its region become part of an address: nothing else than these characters.
_STORAGE_NAME = re.compile(r"[a-z0-9][a-z0-9-]*")
# Stands for every origin in the list of origins a browser may call the service from.
_EVERY_ORIGIN = "*"


def _split(value: str) -> list[str]:
    """Split a comma separated list, dropping blanks and trailing slashes."""
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


class Settings(BaseSettings):
    """Settings of the service. Each field maps to an SPX_ environment variable."""

    model_config = SettingsConfigDict(env_prefix="SPX_", env_file=".env", extra="ignore")

    environment: str = "development"
    log_level: str = "INFO"
    allowed_origins: str = "*"

    # Exposure search of the IRSA archive.
    sia_url: str = "https://irsa.ipac.caltech.edu/SIA"
    # Data releases to search, by order of preference when both hold the same exposure.
    sia_collections: str = "spherex_dr1,spherex_qr3"
    archive_bucket: str = "nasa-irsa-spherex"
    archive_region: str = "us-east-1"
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
    # A list of exposures is reused as it is for the first duration. When the archive
    # does not answer, it is reused up to the second one.
    search_fresh_s: float = Field(default=3600.0, ge=0, le=86400)
    search_stale_s: float = Field(default=86400.0, ge=0, le=604800)

    # Reads of parts of the files. A read brings 1 MB at most and the storage is fast,
    # so the wait is short. One view asks for hundreds of ranges: the limit is on how
    # many are in flight at once.
    storage_timeout_s: float = Field(default=10.0, gt=0, le=60)
    storage_attempts: int = Field(default=3, ge=1, le=10)
    storage_concurrency: int = Field(default=32, ge=1, le=256)

    # Name resolver of the CDS: its mirror at Harvard first, the closest to the service,
    # then the main site in Strasbourg when the mirror fails.
    resolver_urls: str = (
        "https://vizier.cfa.harvard.edu/viz-bin/nph-sesame,"
        "https://cds.unistra.fr/cgi-bin/nph-sesame"
    )
    resolver_timeout_s: float = Field(default=10.0, gt=0, le=60)

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
        origins = _split(value)
        if origins == [_EVERY_ORIGIN]:
            return _EVERY_ORIGIN
        for origin in origins:
            if not origin.startswith(("http://", "https://")):
                raise ValueError(
                    f"origins are {_EVERY_ORIGIN!r} alone or start with http:// or https://, "
                    f"got {origin!r}"
                )
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

    @field_validator("archive_bucket", "archive_region")
    @classmethod
    def _check_storage_name(cls, value: str) -> str:
        if not _STORAGE_NAME.fullmatch(value):
            raise ValueError(f"not a bucket or region name: {value!r}")
        return value

    @field_validator("resolver_urls")
    @classmethod
    def _check_resolver_urls(cls, value: str) -> str:
        urls = _split(value)
        if not urls:
            raise ValueError("at least one resolver address is needed")
        for url in urls:
            if not url.startswith(("http://", "https://")) or "?" in url:
                raise ValueError(f"not a resolver address: {url!r}")
        return value

    @property
    def resolver_url_list(self) -> list[str]:
        """Addresses of the name resolver, in the order they are tried."""
        return _split(self.resolver_urls)

    @property
    def storage_url(self) -> str:
        """Address of the public storage that holds the SPHEREx files."""
        return f"https://{self.archive_bucket}.s3.{self.archive_region}.amazonaws.com"

    @property
    def sia_collection_list(self) -> list[str]:
        """Data releases to search, in order of preference."""
        return _split(self.sia_collections)

    @property
    def allowed_origin_list(self) -> list[str]:
        """Origins allowed to call the API from a browser. ["*"] means every origin."""
        return _split(self.allowed_origins)


@lru_cache
def get_settings() -> Settings:
    """Settings of the running process, read once."""
    return Settings()
