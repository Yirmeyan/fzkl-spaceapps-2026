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
| Test against the real archive | `uv run python -m pytest -m network` |
| Lint | `uv run ruff check` |
| Format | `uv run ruff format` |

The run and test commands go through `python -m` on purpose: on Windows, an application control policy can block the small launchers that tools install.

Once started, the service answers on http://127.0.0.1:8000/api/health, and its interactive documentation is on http://127.0.0.1:8000/api/docs. To list the exposures of Barnard's Star:

```
curl "http://127.0.0.1:8000/api/exposures?ra=269.452077&dec=4.693365&pm_ra=-801.551&pm_dec=10362.394"
```

The plain test command leaves out the tests marked `network`, which call IRSA. Run them on demand: they depend on the archive being up, so they are not part of the checks.

## Checks

Every pull request runs the `backend` check, defined in `.github/workflows/ci.yml`: lint, formatting, the tests that need no network, then the build of the container image. Run the first three before pushing:

```
uv run ruff check
uv run ruff format --check
uv run python -m pytest -m "not network"
```

## Deployment

Every merge to `main` that touches this folder deploys the service to Cloud Run. See [the deployment guide](../docs/deployment.md).

## Settings

Every setting is an environment variable that starts with `SPX_`. Copy `.env.example` to `.env` to change one locally. Never commit `.env`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `SPX_ENVIRONMENT` | `development` | Shown in logs only |
| `SPX_LOG_LEVEL` | `INFO` | Level of the logs |
| `SPX_ALLOWED_ORIGINS` | `http://localhost:5173` | Origins allowed to call the API from a browser, separated by commas |
| `SPX_SIA_URL` | `https://irsa.ipac.caltech.edu/SIA` | Search service of the archive |
| `SPX_SIA_COLLECTIONS` | `spherex_dr1,spherex_qr3` | Data releases searched. When two hold the same exposure, the first one wins |
| `SPX_ARCHIVE_BUCKET` | `nasa-irsa-spherex` | Storage that holds the files. Exposures stored elsewhere are ignored |
| `SPX_SEARCH_RADIUS_DEG` | `0.01` | Radius of the search around the target, in degrees |
| `SPX_ARCHIVE_TIMEOUT_S` | `25` | Longest wait for one answer of the archive, in seconds |
| `SPX_ARCHIVE_BUDGET_S` | `45` | Longest time one request spends on the archive, all searches and attempts together. Keep it below the request timeout of the host, 60 seconds on Cloud Run |
| `SPX_ARCHIVE_ATTEMPTS` | `3` | Attempts before the service answers 503 |
| `SPX_MAX_EXPOSURES` | `5000` | Most exposures asked from the archive for one position |
