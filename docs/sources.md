# Sources and licenses

Every external resource this project uses, with its license. A pull request that adds a source or a dependency adds a line here.

## Data and services

| Source | Use in this repository | Terms and credit |
| --- | --- | --- |
| [SPHEREx spectral images](https://irsa.ipac.caltech.edu/Missions/spherex.html), level 2, releases DR1 and QR3, from the NASA/IPAC Infrared Science Archive (IRSA) | Read by the service from the public bucket `nasa-irsa-spherex`, a few byte ranges per exposure, and served as frames by `GET /api/frames/{id}`. The header of one image is kept in `backend/tests/data/` for the tests. Pixels, flags and wavelengths of `samples/barnard-star-d2.json` come from it | [IRSA data use terms](https://irsa.ipac.caltech.edu/data_use_terms.html). Acknowledgements requested by [SPHEREx](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html) and by [IRSA](https://irsa.ipac.caltech.edu/ack.html) |
| [SPHEREx DR1 all-sky data cube](https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube/properties) (`ivo://IPAC/P/SPHEREx/DR1/cube`): a HiPS cube of 102 maps of the whole sky, one for each wavelength channel, made by the SPHEREx Science Data Center and served by IRSA | The sky map, `frontend/src/sky/`: the browser of the visitor loads its tiles from IRSA, and reads its `properties` file to name the wavelengths. Nothing of it is stored in this repository | Copyright NASA/SPHEREx and Caltech/IPAC, as its `properties` file states. [IRSA data use terms](https://irsa.ipac.caltech.edu/data_use_terms.html) |
| AllWISE color, 2MASS color and DSS2 color HiPS, served by the sky server of [ESA Sky](https://sky.esa.int/) (`skies.esac.esa.int`) | The three skies the sky map offers beside SPHEREx, to compare. Loaded by the browser of the visitor | AllWISE: NASA/JPL-Caltech/UCLA. 2MASS: UMass/IPAC-Caltech/NASA/NSF. Digitized Sky Survey: STScI/NASA, colored and cut into tiles by the CDS |
| [IRSA Simple Image Access service](https://irsa.ipac.caltech.edu/ibe/sia.html) (SIA version 2), collections `spherex_dr1` and `spherex_qr3` | Called by `GET /api/exposures` to list the exposures of a position. One recorded answer, the index entries of Barnard's Star, is kept in `backend/tests/data/` for the tests | Same IRSA terms and acknowledgements as the images |
| [IRSA cutout service](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/cutouts.html) | Reference of one on-demand test: the pixels the service reads must be those the archive cuts itself. Nothing is stored | Same IRSA terms and acknowledgements as the images |
| [SIMBAD](https://simbad.cds.unistra.fr/simbad/), through the [CDS Sesame](https://cds.unistra.fr/cgi-bin/nph-sesame) name resolver | Called by `GET /api/resolve` to turn a name into a position and a proper motion. Position and proper motion of Barnard's Star in the sample. Proper motions and parallaxes of 19 nearby stars, and the type of the stars found variable, as the reference the candidates are checked against. Most of these values are those of Gaia DR3 | Credit: SIMBAD database, CDS, Strasbourg, France |
| [Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3) source catalog (Gaia Collaboration, Vallenari et al. 2023) and [AllWISE](https://wise2.ipac.caltech.edu/docs/release/allwise/) Source Catalog (Cutri et al. 2013), through [VizieR](https://vizier.cds.unistra.fr/) (catalogs I/355/gaiadr3 and II/328/allwise, Ochsenbein et al. 2000) and its mirror at Harvard | Called by `GET /api/catalog`: the sources of a view, drawn over the SPHEREx images. Kept in memory for a day by the service. The sources of the views of the five test targets, 402 lines of Gaia DR3 and 643 of AllWISE, are stored in `samples/<key>-catalog.json` | Public catalogs. Acknowledgements of ESA Gaia and its Data Processing and Analysis Consortium (DPAC), of WISE and NEOWISE (University of California Los Angeles, Jet Propulsion Laboratory, NASA), and of VizieR (CDS, Strasbourg, France; DOI 10.26093/cds/vizier) |
| AAVSO International Variable Star Index (VSX, Watson et al. 2006) and the variable sources of Gaia DR3 (Gaia Collaboration 2023, Rimoldini et al. 2023), through [VizieR](https://vizier.cds.unistra.fr/) (catalogs B/vsx and I/358) | One-time checks: are the stars the detection flags as changed known variables, and the period and date of maximum of R Draconis and of the eight variables of the halo check. No catalog data is stored in the repository | Public catalogs. Acknowledgements of the AAVSO, of ESA Gaia and its DPAC, and of VizieR (CDS, Strasbourg, France) |
| [The SPHEREx Photometry and Image Fitting Framework (SPIFF) Spectrophotometry Library](https://doi.org/10.5281/zenodo.19051216), version QR2-2026-04-24 (Gagné et al. 2026, submitted to the Astrophysical Journal), on Zenodo | One-time check: the spectra of Epsilon Indi B, Luhman 16 and LP 944-20 measured by this service against those of the library, band by band. One file was read, `spiff_known_bds_binned_csv.zip`. No data of the library is stored in the repository | Creative Commons Attribution 4.0 International (CC BY 4.0) |
| 2MASS Point Source Catalog (Skrutskie et al. 2006) and AllWISE Source Catalog (Cutri et al. 2013), queried at IRSA and through [VizieR](https://vizier.cds.unistra.fr/) (catalogs II/246 and II/328) | One-time checks: the orientation of the sample, and the flux scale of step B4 on 8 stars. No catalog data is stored in the repository | Public catalogs. Acknowledgements of 2MASS, WISE, IRSA and VizieR (CDS, Strasbourg, France) |
| Luhman 2014, "A Search for a Distant Companion to the Sun with the Wide-field Infrared Survey Explorer", The Astrophysical Journal 781, 4, and the [NASA release](https://www.nasa.gov/press/2014/march/nasas-wise-survey-finds-thousands-of-new-stars-but-no-planet-x) of March 7, 2014 about it. Rice and Laughlin 2020, "Exploring Trans-Neptunian Space with TESS: A Targeted Shift-stacking Search for Planet Nine and Distant TNOs in the Galactic Plane", [The Planetary Science Journal 1, 81](https://doi.org/10.3847/PSJ/abc42c) | Quoted, nothing is copied. The first says what WISE already excluded: nothing as large as Saturn out to 10,000 astronomical units, nor as large as Jupiter out to 26,000. The search for a body that swings is to be read against it. The second is a published search of the same family, shift and stack: frames are read along the path a distant body would follow, so that it adds up. Our code is our own | Published articles and a NASA page, cited |

The exact acknowledgement sentences and the identifier (DOI) of each data release go in the README and in the submission at step P1.

## Formulas

| Formula | Use in this repository | Source |
| --- | --- | --- |
| Low-precision position of the Sun | `targets/parallax.py`: where the Earth is at a date, to fit the parallax of a moving object | The Astronomical Almanac, section C, U.S. Naval Observatory and HM Nautical Almanac Office. Checked in the tests against the ephemeris built in Astropy |
| Normal approximation of the law of Student | `detection/field.py`: how much a motion counts when its uncertainty was drawn from a few leftovers of a fit | D. L. Wallace, "Bounds on normal approximations to Student's and the chi-square distributions", Annals of Mathematical Statistics 30, 1121 (1959) |
| Center of light under a Gaussian window that follows it | `detection/sources.py`: position of a source in a stacked image | The windowed positions of SExtractor (E. Bertin and S. Arnouts, Astronomy and Astrophysics Supplement 117, 393, 1996). Written again here, no code taken |

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
| [Astropy](https://www.astropy.org/) | Decompression of the flags. In the tests, the reference that the reader of the files and of their headers is compared with | BSD-3-Clause |
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
| [Aladin Lite](https://github.com/cds-astro/aladin-lite) 3.8.2 (Boch and Fernique 2014; Baumann et al. 2022), developed at CDS, Strasbourg Observatory, France. Not in the lock file: the sky map page loads it from jsDelivr at this fixed version, and `frontend/sky.html` holds the hash the browser checks | Engine of the sky map: tiles, projection, moving and zooming | LGPL-3.0-or-later. Its logo and link stay on the map, as its terms ask |
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
