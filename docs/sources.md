# Sources and licenses

Every external resource this project uses, with its license. A pull request that adds a source or a dependency adds a line here.

## Data and services

| Source | Use in this repository | Terms and credit |
| --- | --- | --- |
| [SPHEREx spectral images](https://irsa.ipac.caltech.edu/Missions/spherex.html), level 2, releases DR1 and QR3, from the NASA/IPAC Infrared Science Archive (IRSA) | Pixels, flags and wavelengths of `samples/barnard-star-d2.json`, read from the public bucket `nasa-irsa-spherex` | [IRSA data use terms](https://irsa.ipac.caltech.edu/data_use_terms.html). Acknowledgements requested by [SPHEREx](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html) and by [IRSA](https://irsa.ipac.caltech.edu/ack.html) |
| [SIMBAD](https://simbad.cds.unistra.fr/simbad/), through the [CDS Sesame](https://cds.unistra.fr/cgi-bin/nph-sesame) name resolver | Position and proper motion of Barnard's Star in the sample | Credit: SIMBAD database, CDS, Strasbourg, France |
| 2MASS Point Source Catalog, queried at IRSA | One-time check of the orientation of the sample. No 2MASS data is stored in the repository | Same IRSA terms |

The exact acknowledgement sentences and the identifier (DOI) of each data release go in the README and in the submission at step P1.

The other services the project plans to call are listed in the [architecture plan](architecture.md#sources). Their terms are added here when the code that calls them is merged.

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

## Continuous integration

GitHub Actions used by the workflows in `.github/workflows/`. Each one is pinned to a commit.

| Action | Use | License |
| --- | --- | --- |
| [actions/checkout](https://github.com/actions/checkout) | Fetches the repository in the workflow | MIT |
| [astral-sh/setup-uv](https://github.com/astral-sh/setup-uv) | Installs uv in the workflow | MIT |
| [google-github-actions/auth](https://github.com/google-github-actions/auth) | Signs the deployment workflow in to Google Cloud without a key | Apache-2.0 |
| [google-github-actions/deploy-cloudrun](https://github.com/google-github-actions/deploy-cloudrun) | Deploys the service to Cloud Run | Apache-2.0 |
