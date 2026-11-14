# Samples

Real SPHEREx data in the format of the [API contract](../docs/api-contract.md). The site shows the test targets of the challenge from these files, at once, even when the service or the archive is slow.

## Files

| File | Content |
| --- | --- |
| `index.json` | The list of the bundles: targets, detectors, frames, wavelengths and sizes. The browser reads it first |
| `<key>-d1.json` to `<key>-d6.json` | One [bundle](../docs/api-contract.md#the-bundle) per target and per detector: 30 files |
| `<key>-spectrum.json` | The [spectrum](../docs/api-contract.md#the-spectrum-file) of a target, every detector together, without the images: 5 files of 60 to 130 kB |
| `<key>-candidates.json` | The [candidates](../docs/api-contract.md#candidates) of the field of a target: the sources that moved or changed between the visits, found with no position given. 5 files of 1 to 2 kB |
| `<key>-catalog.json` | What [Gaia DR3 and AllWISE](../docs/api-contract.md#get-apicatalog) hold inside the view of a target, to draw over the images: 5 files of 11 to 38 kB, 60 to 90 sources of Gaia and 17 to 184 of AllWISE |
| `check-sample.ts` | The script that checks a bundle, a spectrum file, a candidates file, a catalog file, or the index and every file it lists |

The view of every target is 0.1 degree on 128 × 128 pixels, north up, east left. The six detectors of a target share it.

## The five targets

They are the test targets of the challenge. Detectors 1 to 6 cover 0.74 to 5.0 micrometers.

| Target | Key | Frames | Dates | Passes | Frames with a flux | Size, compressed in transit |
| --- | --- | --- | --- | --- | --- | --- |
| Barnard's Star | `barnard-star` | 364 | August 2025 to September 2026 | 3 | 101 | 24 MB, 11 MB |
| Epsilon Indi B | `epsilon-indi-b` | 467 | April 2025 to October 2026 | 4 | 413 | 31 MB, 14 MB |
| WISE 0855 | `wise-0855` | 258 | May 2025 to May 2026 | 3 | 228 | 17 MB, 8 MB |
| RW Aurigae | `rw-aurigae` | 336 | September 2025 to September 2026 | 3 | 300 | 22 MB, 10 MB |
| R Draconis | `r-draconis` | 548 | May 2025 to July 2026 | 3 | 2 | 36 MB, 17 MB |

A file of one detector weighs 2.4 to 6.5 MB, 1 to 3 MB in transit.

What to expect when you draw them:

- **Barnard's Star** moves fast. It climbs toward the north by about 2 pixels from one pass to the next: `target_xy` goes from y = 65.4 to 63.4, then to 61.8. The other stars do not move. Its heart is saturated: the pixels are NaN and carry the `OVERFLOW` bit, so draw them at the top of the color scale, or the star shows a hole. It only has a flux in detectors 5 and 6, `flagged`, steady within 1 percent from one pass to the next.
- **Epsilon Indi B** is a pair of brown dwarfs that drifts by 0.6 pixel in x and 0.4 in y per pass. It is faint enough to be measured cleanly, and its spectrum is the most telling of the five: bright near 1.3, 1.6, 2.1 and 4.0 micrometers, up to 60 mJy, with deep bands in between where the water and the methane of its atmosphere absorb the light.
- **WISE 0855** is the coldest and the fastest: 1.5 pixel per pass toward the west. No single frame shows it. It is only bright enough near 4.5 to 5 micrometers, in detector 6, about 0.5 mJy for a noise of 0.24 per frame: stack the frames of a pass to see it. Below 4 micrometers, the flux in its circle is that of a faint star of the background, not of the object.
- **RW Aurigae** is a young variable star that does not move, and its light changes between passes. From 4.4 to 5 micrometers its flux drops from 3.2 to 2.1, then to 1.5 Jy, while it rises from 0.16 to 0.24 Jy below 1.1 micrometer. Its pixels near saturation, so most of its points are `flagged`: their value is good to about 5 percent.
- **R Draconis** is a variable giant, far too bright for SPHEREx: its heart is saturated in every detector and `quality` is `saturated` in 532 frames of 548. What changes between its passes shows in the images, not in a flux: the halo around its heart is half as bright in June 2026 as in June 2025, and the candidates file says so.
- The background changes with the frame and the wavelength. Subtract `background` before comparing frames.
- Some frames are partly empty: the edge of the detector crosses the view. In a few of them every pixel that has a value also carries a flag, and `background` is `null`.

What the candidates files say, with no position given to the detection:

| Target | Candidate | Measured | Catalog (SIMBAD) |
| --- | --- | --- | --- |
| Barnard's Star | `moved`, high, in detectors 5 and 6 | 10.5 ± 0.9 arcseconds per year toward 349 degrees | 10.39 toward 356 |
| Epsilon Indi B | `moved`, high, in the six detectors | 4.63 ± 0.06 arcseconds per year toward 122 degrees. Parallax 0.30 ± 0.04 arcsecond: 11.0 light-years, between 9.8 and 12.6 | 4.68 toward 122. 0.271: 12.0 light-years |
| WISE 0855 | `moved`, medium, in detectors 5 and 6 | 7.5 ± 0.9 arcseconds per year toward 284 degrees | 8.15 toward 275 |
| RW Aurigae | `changed`, high | Half as bright from 3.8 to 5 micrometers between the first and the last visit, 1.3 to 1.4 times brighter under 1.6 | A T Tauri star known for its deep fadings |
| R Draconis | `changed`, medium, read on its halo: the star saturates the six detectors | The halo fades to 0.45 of its brightness from 4.4 to 5 micrometers between the first and the last visit, and to 0.56 from 2.4 to 3.8 | A Mira variable of 246 days: close to its maximum at the first visit, close to its minimum at the last (AAVSO index) |

No other source of the five fields is a candidate: 92 sources and one saturated star followed, 5 candidates, all of them the targets. The same code was run on 53 other fields: see [how it was checked](../docs/api-contract.md#how-it-was-checked).

## Checking the files

```
node samples/check-sample.ts samples/index.json
node samples/check-sample.ts samples/barnard-star-d2.json --bright-star
```

It needs Node 24 and no dependency, and ends with `ALL CHECKS PASSED`.

- For a candidates file it checks that each place is the same on the sky and on the grid, and that the motion points along the track: east is toward smaller x, north toward smaller y.
- The first command reads the index and checks every file it lists: the fields, the dates, the order, the position of the target, the share of valid pixels, and that each file matches its line of the index. It also compares every point of a spectrum file with the frame of the same exposure: the two were measured by two paths of the service and must agree.
- The second one checks one bundle. `--bright-star` adds two checks that only hold for a star bright enough to saturate the detector: it shows at `target_xy` in every frame, and its saturated core moves between passes as its proper motion says.

The script decodes every frame with the functions printed in the contract, so it tests them too.

## Building the files

The bundles are made by the code of the service, so a frame of a bundle is the frame the service returns. From `backend/`:

```
uv run python -m spherex_explorer.precompute --output ../samples
```

Add `--target barnard-star` to build one target only, `--spectra-only` to build the spectrum files and leave the bundles as they are, and `--candidates-only` to measure the candidates again on the bundles already there, without any download, and `--catalogs-only` to ask Gaia DR3 and AllWISE again for the views already there. The command looks each target up by name, lists its exposures, reads the public SPHEREx files and writes one bundle per detector, then measures the spectrum and updates `index.json`. The five targets take about three minutes: 1,973 frames.

## Credits

- Pixels, flags and wavelengths: SPHEREx level 2 spectral images, releases DR1 and QR3, from the NASA/IPAC Infrared Science Archive.
- Positions, proper motions and parallaxes: SIMBAD database, CDS, Strasbourg, France.

Terms and links are in [`docs/sources.md`](../docs/sources.md).
