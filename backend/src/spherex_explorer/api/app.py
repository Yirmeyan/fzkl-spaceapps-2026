"""Application factory of the HTTP service."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx2
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from spherex_explorer import __version__
from spherex_explorer.api.errors import register_error_handlers
from spherex_explorer.api.exposures import router as exposures_router
from spherex_explorer.api.health import router as health_router
from spherex_explorer.archive import SiaArchive
from spherex_explorer.config import Settings, get_settings
from spherex_explorer.pipeline import ExposureArchive

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, archive: ExposureArchive | None = None) -> FastAPI:
    """Build the application.

    Tests pass their own settings and their own archive. The server reads the
    environment and opens its connections when it starts.
    """
    settings = settings or get_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if app.state.archive is not None:
            yield
            return
        # One client for the life of the process: its connections are reused across requests.
        async with httpx2.AsyncClient(
            timeout=settings.archive_timeout_s,
            headers={"User-Agent": f"spherex-explorer/{__version__}"},
        ) as client:
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
            )
            try:
                yield
            finally:
                app.state.archive = None

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

    # The browser application is served from another origin than this service.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origin_list,
        allow_methods=["GET"],
        allow_headers=["*"],
        # Without this, a browser hides the delay a 503 answer asks the client to wait.
        expose_headers=["Retry-After"],
    )
    register_error_handlers(app)
    app.include_router(health_router, prefix="/api")
    app.include_router(exposures_router, prefix="/api")

    logger.info(
        "Service %s ready in %s, origins allowed: %s",
        __version__,
        settings.environment,
        settings.allowed_origin_list,
    )
    return app
