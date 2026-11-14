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

The service then answers on http://127.0.0.1:8000/api/health, and its interactive documentation is on http://127.0.0.1:8000/api/docs.

## Settings

Every setting is an environment variable that starts with `SPX_`. Copy `.env.example` to `.env` to change one locally. Never commit `.env`.
