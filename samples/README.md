# Samples

Real SPHEREx data in the format of the [API contract](../docs/api-contract.md). The site shows the test targets of the challenge from these files, at once, even when the service or the archive is slow.

## Files

| File | Content |
| --- | --- |
| `index.json` | The list of the bundles: targets, detectors, frames, wavelengths and sizes. The browser reads it first |
| `barnard-star-d1.json` to `barnard-star-d6.json` | Barnard's Star, one [bundle](../docs/api-contract.md#the-bundle) per detector |
| `check-sample.ts` | The script that checks a bundle, or the index and every file it lists |

The four other test targets (Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis) get their files once the flux values are final, at step B4. Until then the site asks the service for them.

## Barnard's Star

364 frames from August 15, 2025 to September 22, 2026, in 3 passes. The view is 0.1 degree on 128 × 128 pixels, north up, east left, and the six detectors share it.

| Detector | Wavelengths | Frames | Size | Compressed in transit |
| --- | --- | --- | --- | --- |
| 1 | 0.74 to 1.11 micrometers | 60 | 4.0 MB | 1.9 MB |
| 2 | 1.09 to 1.66 micrometers | 62 | 4.1 MB | 1.9 MB |
| 3 | 1.62 to 2.42 micrometers | 61 | 4.0 MB | 1.9 MB |
| 4 | 2.42 to 3.80 micrometers | 59 | 3.9 MB | 1.8 MB |
| 5 | 3.80 to 4.43 micrometers | 62 | 4.1 MB | 1.9 MB |
| 6 | 4.40 to 5.00 micrometers | 60 | 4.0 MB | 1.8 MB |

What to expect when you draw it:

- Barnard's Star is the bright object at the center. It climbs toward the north by about 2 pixels from one pass to the next: in detector 2, `target_xy` goes from y = 65.4 to 63.4, then to 61.8. The other stars do not move.
- The heart of the star is saturated in the six detectors. Its pixels are NaN and carry the `OVERFLOW` bit in the mask: draw them at the top of the color scale, or the star shows a hole.
- `photometry.quality` is therefore `saturated` in 357 frames. It is `outside` in 6 frames, where the star falls off the edge of the detector, and `masked` in 1. No frame holds a flux value: the star is too bright for SPHEREx.
- The background goes from 0.17 to 1.95 MJy/sr depending on the frame and the wavelength. Subtract `background` before comparing frames.
- A few frames are partly empty (`valid_fraction` down to 0.31): the edge of the detector crosses the view. In two frames of detector 3, every pixel that has a value also carries a flag, so their `background` is `null`.

## Checking the files

```
node samples/check-sample.ts samples/index.json
node samples/check-sample.ts samples/barnard-star-d2.json --bright-star
```

It needs Node 24 and no dependency, and ends with `ALL CHECKS PASSED`.

- The first command reads the index and checks every bundle it lists: the fields, the dates, the order, the position of the target, the share of valid pixels, and that each file matches its line of the index.
- The second one checks one bundle. `--bright-star` adds two checks that only hold for a star bright enough to saturate the detector: it shows at `target_xy` in every frame, and its saturated core moves between passes as its proper motion says.

The script decodes every frame with the functions printed in the contract, so it tests them too.

## Building the files

The bundles are made by the code of the service, so a frame of a bundle is the frame the service returns. From `backend/`:

```
uv run python -m spherex_explorer.precompute --output ../samples --target barnard-star
```

Leave `--target` out to build every target. The command looks the target up by name, lists its exposures, reads the public SPHEREx files and writes one bundle per detector, then updates `index.json`. Barnard's Star takes about 20 seconds.

## Credits

- Pixels, flags and wavelengths: SPHEREx level 2 spectral images, releases DR1 and QR3, from the NASA/IPAC Infrared Science Archive.
- Positions and proper motions: SIMBAD database, CDS, Strasbourg, France.

Terms and links are in [`docs/sources.md`](../docs/sources.md).
