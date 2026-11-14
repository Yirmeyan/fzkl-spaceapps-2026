# SPHEREx Explorer

Type a name or coordinates, and watch what NASA's SPHEREx telescope saw there: a short movie of the infrared sky, visit after visit, with the spectrum of the object you point at. Things that move hop. Things that vary change color.

Project of team **Foxtrot Zulu Kilo Lima** for the 2026 NASA Space Apps Challenge, Montréal local event, November 14 and 15, 2026. Challenge: [Planet X and SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/).

| | |
| --- | --- |
| **The tool** | https://fzkl-spaceapps-2026.pages.dev |
| **The service and its interactive documentation** | https://spherex-explorer-139331018511.us-east4.run.app/api/docs |
| **How the two talk** | [`docs/api-contract.md`](docs/api-contract.md) |
| **The plan and its reasons** | [`docs/architecture.md`](docs/architecture.md) |

## Try it in one minute

| Open | And look for |
| --- | --- |
| [Barnard's Star](https://fzkl-spaceapps-2026.pages.dev/?target=barnard) | The fastest star of the sky hops by 10 arcseconds between the first visit and the last, while the stars around it stay put |
| [Epsilon Indi B](https://fzkl-spaceapps-2026.pages.dev/?target=epsindi) | The spectrum of a pair of brown dwarfs, measured on the fly: peaks near 1.3, 1.6, 2.1 and 4.0 micrometers, and deep bands where the water and the methane of their atmosphere absorb the light |
| [RW Aurigae](https://fzkl-spaceapps-2026.pages.dev/?target=rwaur) | A young star that varies: between the first visit and the third, its light near 5 micrometers falls by half while its light below 1.1 micrometer rises by half |
| [WISE 0855](https://fzkl-spaceapps-2026.pages.dev/?target=wise0855) | A cold world 7 light-years away that no single image shows. It moves by 8 arcseconds a year |
| [R Draconis](https://fzkl-spaceapps-2026.pages.dev/?target=rdra) | A giant variable star, too bright for SPHEREx: the tool gives no flux and says why, instead of showing a wrong number. It still tells that the star faded by half in a year, read on the halo of light around it |

These are the five test targets of the challenge. Any other place works the same way: type a name or coordinates.

## What the challenge asks, and where it stands

| The challenge asks for | In this project |
| --- | --- |
| Coordinates in, a flipbook of SPHEREx images out | Done. Images are grouped by detector and by visit, so that what changes on screen is the sky and not the wavelength |
| The five test targets | Done. They load at once from static files, even when the archive is slow |
| Easy to update with new data releases | Done. Nothing is copied ahead of time for other places: the service asks the archive for the exposures of a position each time, and the releases it searches are one setting |
| Use the 102 bands, the six detectors, and spectra on the fly | Done. One request measures an object in every exposure that covers it, from 0.75 to 5 micrometers: [`GET /api/spectrum`](docs/api-contract.md#get-apispectrum) |
| Add or subtract images taken at different dates | Done in the browser: blink, blend and difference between visits, and the stack of the frames of a visit, which brings out an object as faint as WISE 0855 |
| Find what moves or varies | Beyond what was asked: the service finds it by itself. It follows every source of a field from visit to visit and lists the ones that moved or changed, with their speed, their distance when it can be measured, and a confidence. See [Candidates](docs/api-contract.md#candidates). It works for any place of the sky, and a panel shows the list |
| Coordinates in the URL, to embed the tool elsewhere | Done. The address of the page holds the target, a preset, a name or coordinates, and the view: detector, visit, mode |
| Adjustable field of view | The service accepts any width from 0.02 to 0.5 degree. The interface shows 0.1 degree |
| Metadata such as the contamination flags | Done. Each image shows its date, its wavelength, its detector, its visit and the quality of its measurement, and a switch tints the flagged pixels. See [the frame](docs/api-contract.md#the-frame) |
| Overlay catalogs of other telescopes | Done in the service: [`GET /api/catalog`](docs/api-contract.md#get-apicatalog) lists the sources of Gaia DR3 and of AllWISE inside a view, with their motion, so that a marker follows a fast star from frame to frame. The five test targets have that list in a static file. The switch that draws them over the image is being added to the interface |

## What makes SPHEREx hard, and what we did about it

- **Two images in a row are not the same color.** SPHEREx has no filter wheel: the wavelength an object is seen at depends on where it falls on the detector, and changes at every exposure. A movie sorted by date alone flickers for no reason. The tool compares images of the same detector, visit against visit.
- **The interesting objects move.** Barnard's Star is more than 4 arcminutes from its catalog position of the year 2000. The service computes where a target was at the date of each exposure, and searches the archive there.
- **A file weighs 62 MB and a view needs 60 of them.** The service reads only the bytes it needs in the public files, about 1 percent of each: a few rows of pixels, their flags, and the headers.
- **Bright stars saturate, and the files say it two ways.** A pixel flagged as overflowing may only be near saturation and still hold a good value, or be truly saturated and hold none. The tool keeps the first and warns, and refuses to give a flux for the second. A saturated star is not lost for all that: its halo, far from the heart, still follows its brightness from one visit to the next.
- **The archive has bad minutes.** Its search fails in bursts of a few seconds. The service tries again, remembers what it learned, and tells the browser when to come back.

## What we checked

Nobody gave us the expected answer for the five targets, so each step was checked against something independent. The details are in [the contract](docs/api-contract.md#how-it-was-checked).

| Question | Answer |
| --- | --- |
| Are these the right pixels? | The pixels the service reads are identical to the cutout the archive makes of the same exposure |
| Is north up and east left? | Five 2MASS stars of the field of Barnard's Star are where the grid puts them, within half a pixel |
| Does the motion match? | The saturated heart of Barnard's Star moves by 3.4 pixels of the view between the first and the last visit. Its catalog proper motion predicts 3.7 |
| Is the flux right? | 8 steady stars compared with 2MASS and AllWISE in 38 pairs of star and band: the median of measured over catalog is 0.998 |
| Does another team measure the same spectrum? | SPIFF, a published library of SPHEREx spectra of brown dwarfs (Gagné et al. 2026), measures three of our objects another way and on another data release: Epsilon Indi B, Luhman 16 and LP 944-20. Over 297 bands from 0.74 to 5 micrometers, the median of ours over theirs is 1.016, and nine bands in ten agree within 10 percent |
| Is the uncertainty honest? | Exposures of a steady star differ by 1 to 3 percent, more than the files alone predict. The stated uncertainty includes it |
| Do two ways of measuring agree? | The 1,044 fluxes of the spectrum files equal those of the image files, exposure for exposure |
| Does it find what moves, with no position given? | 16 of the 17 nearby stars tried that move by more than 1 arcsecond, the three test targets among them, each with a speed within two sigma of its catalog. The one missed, Ross 128, is too bright and too slow. 32 quiet fields, 831 sources, give no candidate |
| Can it tell how far a moving object is? | For seven of them the swing with the seasons is measured, a twelfth to a thirtieth of a SPHEREx pixel, and gives the distance: Luhman 16 at 7.0 light-years for 6.5 in the catalog, Epsilon Indi B at 11.0 for 12.0, van Maanen's Star at 15.2 for 14.1 |
| Does it find a star that varies, unasked? | RW Aurigae, and more: pointed at a place of the Milky Way taken at random, it flags one star of 35, IRAS 18372-0002, a long-period variable known to SIMBAD, to the AAVSO and to Gaia. Toward the center of the Milky Way it flags three, one of them a variable of Gaia |
| Do other telescopes agree? | Moved to the date of the SPHEREx frames with its own motion, the source of Gaia DR3 falls 0.2 to 0.7 arcsecond from where we measure Barnard's Star, Epsilon Indi B, RW Aurigae and R Draconis: a tenth of a SPHEREx pixel. Gaia holds nothing at the place of WISE 0855, which is too cold for it. AllWISE saw that object in 2010, 126 arcseconds from where SPHEREx sees it now: 8.2 arcseconds per year, for 8.15 in the catalog |
| Can it follow a star too bright to be measured? | Through the halo of light around it. R Draconis saturates the six detectors, and its halo says it faded by half between June 2025 and June 2026: a Mira variable going from its maximum to its minimum. Checked blind on 16 saturated stars chosen before the run: five of eight known long-period variables were flagged, each change in the direction the AAVSO index predicts, and none of eight steady giants |
| How often is it wrong? | The one blind round, 21 fields chosen before the run, gave one false alarm in 16 quiet fields: a source cut by the edge of the view. Such positions are now refused. Every rule, and what it cost to find it, is in [the contract](docs/api-contract.md#how-it-was-checked) |

The service has 514 automated tests. Every pull request runs them, and checks the 45 static files against the contract.

## How it works

```
Browser (TypeScript, React)            Service (Python, FastAPI, Cloud Run)         Public data
  movie, blink, difference    <---->     exposures of a position            <---->   IRSA image search
  spectrum chart                         images aligned on one grid         <---->   SPHEREx files on Amazon S3
  the view in the page address           flux of the target in each one     <---->   SIMBAD, for names
                                         what other telescopes know there   <---->   VizieR, for Gaia and AllWISE
        ^
        |  static files of the five test targets (Cloudflare Pages)
```

- **The browser** does everything interactive without a round trip: animation, contrast, blink, blend, difference, charts.
- **The service** answers seven calls: `health`, `resolve`, `exposures`, `frames`, `spectrum`, `candidates` and `catalog`. It keeps no user data, and what it remembers for an hour, lists of exposures and measured fields, only saves time.
- **One grid per view.** Every image of a view is resampled on the same piece of sky, north up, so that pixel (x, y) is the same place in all of them. This is what lets the browser blink and subtract.
- **Speed.** The 62 images of one detector arrive in about 3 seconds. A spectrum over 250 to 550 exposures takes 6 to 11 seconds. The five test targets show at once.

## Run it

Requirements: Node 24, and [uv](https://docs.astral.sh/uv/) for the service.

```bash
# The site, on the five test targets, without the service
cd frontend
npm install
npm run dev

# The service, for any other place of the sky
cd backend
uv sync
uv run python -m uvicorn spherex_explorer.api.app:create_app --factory --reload
```

More in [`backend/README.md`](backend/README.md), [`samples/README.md`](samples/README.md) and [`docs/deployment.md`](docs/deployment.md).

## Repository

| Folder | Content | Owner |
| --- | --- | --- |
| [`frontend/`](frontend/) | The site | Nicolas |
| [`backend/`](backend/) | The service, its tests, and the command that builds the static files | Yirmeyan |
| [`samples/`](samples/README.md) | The static files of the five test targets, and the script that checks them | Yirmeyan |
| [`docs/`](docs/) | Contract, architecture, deployment, sources | Both |
| [`infra/`](infra/) | One-time setup of the hosting | Yirmeyan |

How we work together is in [`CONTRIBUTING.md`](CONTRIBUTING.md). The two AI agents of the team coordinate through [`docs/AGENT_BRIDGE.md`](docs/AGENT_BRIDGE.md), as [`AGENTS.md`](AGENTS.md) explains.

## Data and credits

- **SPHEREx.** This project makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration. Data: SPHEREx Data Release 1 Spectral Images, [10.26131/IRSA678](https://doi.org/10.26131/IRSA678), and SPHEREx Quick Release Spectral Images QR3, [10.26131/IRSA662](https://doi.org/10.26131/IRSA662).
- **IRSA.** The data come from the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology. The files are read from the public bucket `nasa-irsa-spherex` of the Registry of Open Data on AWS.
- **SIMBAD and VizieR.** Names are turned into positions by the SIMBAD database, and the reference stars of our checks come from the VizieR catalog service, both operated at CDS, Strasbourg, France.
- **2MASS and WISE.** Our flux checks use the Two Micron All Sky Survey and the Wide-field Infrared Survey Explorer, both funded by the National Aeronautics and Space Administration.
- **Papers.** The mission: Bock et al. 2026, ApJ 999, 139. The pipeline: Akeson et al. 2026, ApJS 285, 67. The instrument: Korngut et al. 2026, arXiv:2603.29835.

Every source and dependency, with its license, is in [`docs/sources.md`](docs/sources.md).

## AI usage

The Space Apps rules ask teams to say how they used AI. Here it is, plainly.

- **Most of the code, the tests and the documentation of this repository were written by AI assistants directed by the team.** The service, the data pipeline, the static files and their checks were written with Claude, by Anthropic. The site was written with Cursor Agent.
- **The idea and the decisions are the team's.** The team chose the challenge and the idea, set the priorities (speed first, then a correct handling of SPHEREx, then the spectrum, then comfort), approved the architecture plan and every change to the contract, and decided what to build and what to drop.
- **Every scientific claim above comes from a check we can rerun,** not from what a model remembers: the tests of this repository, and the comparisons listed under "What we checked".
- **No image or video of the tool is generated.** Every picture it shows is SPHEREx data.

## License

Copyright (C) 2026 the Foxtrot Zulu Kilo Lima team.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3. It is distributed without any warranty. See [LICENSE](LICENSE) for the full text.
