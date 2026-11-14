"""Health route: tells a client or a deployment probe that the service is up."""

from fastapi import APIRouter, Response
from pydantic import BaseModel

from spherex_explorer import __version__

router = APIRouter(tags=["health"])


class Health(BaseModel):
    """State of the service."""

    status: str
    version: str


@router.get("/health")
def read_health(response: Response) -> Health:
    # A health answer describes this instant only, so no cache may keep it.
    response.headers["Cache-Control"] = "no-store"
    return Health(status="ok", version=__version__)
