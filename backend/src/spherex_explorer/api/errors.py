"""JSON error responses, so that no failure reaches a client as a bare stack trace."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from spherex_explorer.errors import UpstreamUnavailable

logger = logging.getLogger(__name__)


def _body(code: str, message: str) -> dict[str, dict[str, str]]:
    return {"error": {"code": code, "message": message}}


def _describe(exc: RequestValidationError) -> str:
    parts = []
    for error in exc.errors():
        location = ".".join(str(item) for item in error.get("loc", ()))
        parts.append(f"{location}: {error.get('msg', 'invalid value')}")
    return "; ".join(parts) or "Invalid request."


def register_error_handlers(app: FastAPI) -> None:
    """Attach the handlers that turn every failure into the same JSON envelope."""

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_body("http_error", str(exc.detail)),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content=_body("invalid_request", _describe(exc)))

    @app.exception_handler(UpstreamUnavailable)
    async def upstream_unavailable(request: Request, exc: UpstreamUnavailable) -> JSONResponse:
        # The reason names an outside service: it goes to the logs, not to the client.
        logger.warning("%s on %s %s", exc, request.method, request.url.path)
        return JSONResponse(
            status_code=503,
            content=_body(
                "upstream_unavailable",
                "The SPHEREx archive did not answer. Try again in a moment.",
            ),
            headers={"Retry-After": str(exc.retry_after_s)},
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        # The details go to the logs only: a client must never see internals.
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content=_body("internal_error", "Unexpected error. The incident was logged."),
        )
