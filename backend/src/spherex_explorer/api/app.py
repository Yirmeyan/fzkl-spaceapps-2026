"""Application factory of the HTTP service."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx2
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from spherex_explorer import __version__
from spherex_explorer.api.candidates import router as candidates_router
from spherex_explorer.api.catalog import router as catalog_router
from spherex_explorer.api.errors import register_error_handlers
from spherex_explorer.api.exposures import router as exposures_router
from spherex_explorer.api.frames import router as frames_router
from spherex_explorer.api.health import router as health_router
from spherex_explorer.api.resolve import NameResolver
from spherex_explorer.api.resolve import router as resolve_router
from spherex_explorer.api.spectrum import router as spectrum_router
from spherex_explorer.archive import Level2Reader, S3Reader, SiaArchive
from spherex_explorer.catalogs import VizierCatalogs
from spherex_explorer.config import Settings, get_settings
from spherex_explorer.pipeline import ExposureArchive, FieldMemory, FrameSource, SkyCatalogs
from spherex_explorer.targets import SesameResolver

logger = logging.getLogger(__name__)

# Connections kept for the search of exposures, next to those of the file reads.
_SEARCH_CONNECTIONS = 8
# Smallest answer worth compressing, and how hard to try: a frame shrinks by half.
_COMPRESS_FROM_BYTES = 1024
_COMPRESSION_LEVEL = 6


def create_app(
    settings: Settings | None = None,
    archive: ExposureArchive | None = None,
    frames: FrameSource | None = None,
    resolver: NameResolver | None = None,
    catalogs: SkyCatalogs | None = None,
) -> FastAPI:
    """Build the application.

    Tests pass their own settings and their own doubles of the outside services.
    The server reads the environment and opens its connections when it starts.
    """
    settings = settings or get_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        given = (app.state.archive, app.state.frames, app.state.resolver, app.state.catalogs)
        if None not in given:
            yield
            return
        # One client for the life of the process: its connections are reused across
        # requests. A view asks for many parts of files at once, hence the wide pool.
        limits = httpx2.Limits(
            max_connections=settings.storage_concurrency + _SEARCH_CONNECTIONS,
            max_keepalive_connections=settings.storage_concurrency,
        )
        async with httpx2.AsyncClient(
            timeout=settings.archive_timeout_s,
            limits=limits,
            headers={"User-Agent": f"spherex-explorer/{__version__}"},
        ) as client:
            if app.state.archive is None:
                app.state.archive = SiaArchive(
                    client,
                    url=settings.sia_url,
                    collections=settings.sia_collection_list,
                    bucket=settings.archive_bucket,
                    radius_deg=settings.search_radius_deg,
                    timeout_s=settings.archive_timeout_s,
                    budget_s=settings.archive_budget_s,
                    attempts=settings.archive_attempts,
                    max_exposures=settings.max_exposures,
                    fresh_s=settings.search_fresh_s,
                    stale_s=settings.search_stale_s,
                )
            if app.state.frames is None:
                app.state.frames = Level2Reader(
                    S3Reader(
                        client,
                        base_url=settings.storage_url,
                        timeout_s=settings.storage_timeout_s,
                        attempts=settings.storage_attempts,
                        concurrency=settings.storage_concurrency,
                    )
                )
            if app.state.resolver is None:
                app.state.resolver = SesameResolver(
                    client,
                    urls=settings.resolver_url_list,
                    timeout_s=settings.resolver_timeout_s,
                )
            if app.state.catalogs is None:
                app.state.catalogs = VizierCatalogs(
                    client,
                    urls=settings.catalog_url_list,
                    timeout_s=settings.catalog_timeout_s,
                    limit=settings.catalog_limit,
                )
            try:
                yield
            finally:
                (
                    app.state.archive,
                    app.state.frames,
                    app.state.resolver,
                    app.state.catalogs,
                ) = given

    app = FastAPI(
        title="SPHEREx explorer service",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.archive = archive
    app.state.frames = frames
    app.state.resolver = resolver
    app.state.catalogs = catalogs
    # A field stays measured for as long as its list of exposures stays fresh.
    app.state.fields = FieldMemory(fresh_s=settings.search_fresh_s)

    # The browser application is served from another origin than this service.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origin_list,
        allow_methods=["GET"],
        allow_headers=["*"],
        # Without this, a browser hides the delay a 503 answer asks the client to wait.
        expose_headers=["Retry-After"],
    )
    app.add_middleware(
        GZipMiddleware, minimum_size=_COMPRESS_FROM_BYTES, compresslevel=_COMPRESSION_LEVEL
    )
    register_error_handlers(app)

    @app.get("/", include_in_schema=False)
    async def welcome() -> dict[str, str]:
        """What answers here, for someone who opens the address of the service in a browser."""
        return {
            "service": "SPHEREx explorer",
            "version": __version__,
            "documentation": "/api/docs",
            "status": "/api/health",
        }

    app.include_router(health_router, prefix="/api")
    app.include_router(exposures_router, prefix="/api")
    app.include_router(frames_router, prefix="/api")
    app.include_router(resolve_router, prefix="/api")
    app.include_router(spectrum_router, prefix="/api")
    app.include_router(candidates_router, prefix="/api")
    app.include_router(catalog_router, prefix="/api")

    logger.info(
        "Service %s ready in %s, origins allowed: %s",
        __version__,
        settings.environment,
        settings.allowed_origin_list,
    )
    return app
