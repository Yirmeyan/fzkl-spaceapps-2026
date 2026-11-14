"""Application factory of the HTTP service."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from spherex_explorer import __version__
from spherex_explorer.api.errors import register_error_handlers
from spherex_explorer.api.health import router as health_router
from spherex_explorer.config import Settings, get_settings

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application. Tests pass their own settings, the server reads the environment."""
    settings = settings or get_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    app = FastAPI(
        title="SPHEREx explorer service",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings

    # The browser application is served from another origin than this service.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origin_list,
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(health_router, prefix="/api")

    logger.info(
        "Service %s ready in %s, origins allowed: %s",
        __version__,
        settings.environment,
        settings.allowed_origin_list,
    )
    return app
