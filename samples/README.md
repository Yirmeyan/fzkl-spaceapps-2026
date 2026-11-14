# Samples

Real data in the format of the [API contract](../docs/api-contract.md), to build and test the browser side before the service exists.

## `barnard-star-d2.json`

A [bundle](../docs/api-contract.md#the-bundle) of Barnard's Star seen by detector 2 of SPHEREx.

| | |
| --- | --- |
| Frames | 62, every exposure of detector 2 that covers the star |
| Dates | August 21, 2025 to September 22, 2026, in 3 passes of 18, 19 and 25 frames |
| Wavelengths | 1.09 to 1.66 micrometers, one per frame |
| View | 0.1 degree on 128 × 128 pixels, north up, east left |
| Size | 4.1 MB, 1.9 MB once compressed |

What to expect when you draw it:

- Barnard's Star is the bright object at the center. It climbs toward the north by about 2 pixels from one pass to the next: `target_xy` goes from y = 65.4 to 63.4, then to 61.8. The other stars do not move.
- The heart of the star is saturated. Its pixels are NaN and carry the `OVERFLOW` bit in the mask: draw them at the top of the color scale, or the star shows a hole.
- `photometry.quality` is `saturated` in 61 frames, and `outside` in the frame of March 21, 2026, where the star falls off the edge of the detector. The file holds no flux value. A sample with real flux values comes with step B4.
- The background goes from 0.34 to 0.93 MJy/sr depending on the frame. Subtract `background` before comparing frames.
- A few frames are partly empty (`valid_fraction` down to 0.35): the edge of the detector crosses the view.

## Checking a file

```
node samples/check-sample.ts samples/barnard-star-d2.json
```

It needs Node 24 and no dependency, and ends with `ALL CHECKS PASSED`. The script decodes every frame with the functions printed in the contract, then checks the fields, the dates, the position of the target and its motion between passes.

## How the file was made

A prototype script, not kept in the repository, read the image, variance and flag pixels of 62 public SPHEREx files around the star, aligned them on the grid and wrote the bundle. The production pipeline of steps B1 to B6 will produce the same format and replace this file.

## Credits

- Pixels, flags and wavelengths: SPHEREx level 2 spectral images, releases DR1 and QR3, from the NASA/IPAC Infrared Science Archive.
- Position and proper motion of Barnard's Star: SIMBAD database, CDS, Strasbourg, France.

Terms and links are in [`docs/sources.md`](../docs/sources.md).
