# Sources and licenses

Every external resource this project uses, with its license. A pull request that adds a source or a dependency adds a line here.

## Data and services

The data sources and the services we call are listed in the [architecture plan](architecture.md#sources). Their terms are added here when the code that calls them is merged.

## Backend dependencies

Versions are locked in `backend/uv.lock`, which also lists the transitive dependencies.

| Package | Use | License |
| --- | --- | --- |
| [FastAPI](https://github.com/fastapi/fastapi) | HTTP framework | MIT |
| [pydantic-settings](https://github.com/pydantic/pydantic-settings) | Settings read from environment variables | MIT |
| [Uvicorn](https://uvicorn.dev/) | ASGI server | BSD-3-Clause |
| [httpx2](https://github.com/pydantic/httpx2) | HTTP client used by the tests | BSD-3-Clause |
| [pytest](https://docs.pytest.org/en/latest/) | Tests | MIT |
| [Ruff](https://docs.astral.sh/ruff) | Lint and format | MIT |
| [Hatchling](https://github.com/pypa/hatch) | Build backend | MIT |
| [uv](https://docs.astral.sh/uv/) | Environment and lock file | Apache-2.0 OR MIT |

Licenses come from the metadata of each installed package, except Hatchling and uv, taken from their repositories.
