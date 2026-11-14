# Sources and licenses

Every external resource this project uses, with its license. A pull request that adds a source or a dependency adds a line here.

## Data and services

| Source | Use in this repository | Terms and credit |
| --- | --- | --- |
| [SPHEREx spectral images](https://irsa.ipac.caltech.edu/Missions/spherex.html), level 2, releases DR1 and QR3, from the NASA/IPAC Infrared Science Archive (IRSA) | Read by the service from the public bucket `nasa-irsa-spherex`, a few byte ranges per exposure, and served as frames by `GET /api/frames/{id}`. The header of one image is kept in `backend/tests/data/` for the tests. Pixels, flags and wavelengths of `samples/barnard-star-d2.json` come from it | [IRSA data use terms](https://irsa.ipac.caltech.edu/data_use_terms.html). Acknowledgements requested by [SPHEREx](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html) and by [IRSA](https://irsa.ipac.caltech.edu/ack.html) |
| [IRSA Simple Image Access service](https://irsa.ipac.caltech.edu/ibe/sia.html) (SIA version 2), collections `spherex_dr1` and `spherex_qr3` | Called by `GET /api/exposures` to list the exposures of a position. One recorded answer, the index entries of Barnard's Star, is kept in `backend/tests/data/` for the tests | Same IRSA terms and acknowledgements as the images |
| [IRSA cutout service](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/cutouts.html) | Reference of one on-demand test: the pixels the service reads must be those the archive cuts itself. Nothing is stored | Same IRSA terms and acknowledgements as the images |
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
| [httpx2](https://github.com/pydantic/httpx2) | HTTP client: calls to the archive, and the tests | BSD-3-Clause |
| [NumPy](https://numpy.org/) | Arrays of pixels | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| [Astropy](https://www.astropy.org/) | Reading of FITS headers and decompression of the flags. In the tests, the reference the reader is compared with | BSD-3-Clause |
| [pytest](https://docs.pytest.org/en/latest/) | Tests | MIT |
| [Ruff](https://docs.astral.sh/ruff) | Lint and format | MIT |
| [Hatchling](https://github.com/pypa/hatch) | Build backend | MIT |
| [uv](https://docs.astral.sh/uv/) | Environment and lock file | Apache-2.0 OR MIT |

Licenses come from the metadata of each installed package, except Hatchling and uv, taken from their repositories.

## Frontend dependencies

Versions are locked in `frontend/package-lock.json`.

| Package | Use | License |
| --- | --- | --- |
| [React](https://react.dev/) | UI | MIT |
| [Vite](https://vite.dev/) | Dev server and bundler | MIT |
| [TypeScript](https://www.typescriptlang.org/) | Types | Apache-2.0 |
| [Biome](https://biomejs.dev/) | Lint and format | MIT OR Apache-2.0 |
| [Vitest](https://vitest.dev/) | Tests | MIT |
| [IBM Plex Sans](https://fonts.google.com/specimen/IBM+Plex+Sans) and [Syne](https://fonts.google.com/specimen/Syne), via Google Fonts | Interface typography | OFL-1.1 |

## Continuous integration

GitHub Actions used by the workflows in `.github/workflows/`. Each one is pinned to a commit.

| Action | Use | License |
| --- | --- | --- |
| [actions/checkout](https://github.com/actions/checkout) | Fetches the repository in the workflow | MIT |
| [astral-sh/setup-uv](https://github.com/astral-sh/setup-uv) | Installs uv in the workflow | MIT |
| [google-github-actions/auth](https://github.com/google-github-actions/auth) | Signs the deployment workflow in to Google Cloud without a key | Apache-2.0 |
| [google-github-actions/setup-gcloud](https://github.com/google-github-actions/setup-gcloud) | Installs the Google Cloud CLI that deploys the service | Apache-2.0 |
| [actions/setup-node](https://github.com/actions/setup-node) | Installs Node.js for the frontend job | MIT |
