# Backend

Python service of the SPHEREx explorer. See [the architecture plan](../docs/architecture.md).

## Requirements

- [uv](https://docs.astral.sh/uv/). It installs Python 3.12 by itself.

## Commands

Run them from the `backend/` folder.

| Goal | Command |
| --- | --- |
| Install | `uv sync` |
| Run locally | `uv run python -m uvicorn spherex_explorer.api.app:create_app --factory --reload` |
| Test | `uv run python -m pytest` |
| Lint | `uv run ruff check` |
| Format | `uv run ruff format` |

The run and test commands go through `python -m` on purpose: on Windows, an application control policy can block the small launchers that tools install.

## Checks

Every pull request runs the `backend` check, defined in `.github/workflows/ci.yml`: lint, formatting, the tests that need no network, then the build of the container image. Run the first three before pushing:

```
uv run ruff check
uv run ruff format --check
uv run python -m pytest -m "not network"
```

The service then answers on http://127.0.0.1:8000/api/health, and its interactive documentation is on http://127.0.0.1:8000/api/docs.

## Deployment

Every merge to `main` that touches this folder deploys the service to Cloud Run. See [the deployment guide](../docs/deployment.md).

## Settings

Every setting is an environment variable that starts with `SPX_`. Copy `.env.example` to `.env` to change one locally. Never commit `.env`.
