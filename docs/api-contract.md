# API contract

The agreement between the Python service (`backend/`) and the browser (`frontend/`). Real files in the final format are in [`samples/`](../samples/README.md).

- **Version:** 1, written at step S1 of the [architecture plan](architecture.md).
- **Changes:** through a pull request approved by the other teammate.
- **Compatibility:** fields can be added at any time, so a client ignores the fields it does not know. Renaming or removing a field changes `version`.
- **Status:** the service answers the nine calls of this document.

## The idea in one minute

The browser asks three questions, in this order:

1. **Where is this object?** `GET /api/resolve` turns a name into a position. Skipped when the user types coordinates.
2. **What did SPHEREx see there?** `GET /api/exposures` lists the exposures that cover the position, and gives the grid that every image of the view shares.
3. **Show me this exposure.** `GET /api/frames/{id}` returns one frame: the image cut out and aligned on the grid, with its date, its wavelength and its measurement.

The five test targets skip questions 2 and 3: a static file, the [bundle](#the-bundle), holds both answers in the same format.

A fourth question needs no image: **what is the spectrum of this object?** `GET /api/spectrum` measures the target in every exposure and returns the fluxes alone. The five test targets have that answer in a static file too.

So does a fifth: **what moved or changed around it?** `GET /api/candidates` follows every source of the view from one visit of SPHEREx to the next and returns the ones that stand out. See [Candidates](#candidates).

A sixth one looks elsewhere: **what do other telescopes already know there?** `GET /api/catalog` lists the sources of Gaia DR3 and of AllWISE inside a view, to draw on top of the image.

| Call | Returns | Expected time |
| --- | --- | --- |
| `GET /api/health` | Service status | Immediate |
| `GET /api/resolve?name=` | A target | 1.5 s |
| `GET /api/exposures?ra=&dec=` | A target, a grid and a list of exposures | 1.5 s, 3 s for a moving target |
| `GET /api/frames/{id}?ra=&dec=` | One frame | 0.6 s |
| `GET /api/spectrum?ra=&dec=` | A target and one flux per exposure | 6 to 11 s for 250 to 550 exposures |
| `GET /api/candidates?ra=&dec=` | The sources of the view that moved or changed | See [the call](#get-apicandidates): it reads every frame of the view |
| `GET /api/catalog?ra=&dec=` | The sources of Gaia DR3 and of AllWISE inside a view | 1 to 2 s the first time for the default view, 3 to 5 s for a view of 0.3 degree in the Milky Way. Immediate after that, for a day |

The times of `exposures` and `frames` are measured on the service, the second one from a laptop: 0.6 s for a first frame, 2.4 to 3.9 s for the 62 frames of a detector asked together. The time of `resolve` is that of the underlying request.

## Conventions

- Every call is a `GET` and answers in JSON, UTF-8.
- Field names are in snake case and end with their unit when they have one: `_deg`, `_um`, `_mjy`, `_s`, `_mjd`.
- Positions are in degrees, in the ICRS frame. Right ascension goes from 0 to 360, declination from -90 to 90.
- Times are in UTC and come twice: `time_mjd` (Modified Julian Date) to compute, `time_iso` to display.
- A missing value is `null`. JSON has no NaN: only the binary pixels use it.
- Numbers are rounded to what the data supports. Do not test them for strict equality.

## Target and grid

Two small objects travel through every call.

The **target** is the object the user cares about:

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string, optional | Name of the object. Present when it comes from `resolve` or from a bundle |
| `ra`, `dec` | number | Position in degrees at the date `epoch` |
| `epoch` | number | Date of that position, as a Julian year. It is 2000.0 for almost every catalog |
| `pm_ra`, `pm_dec` | number or null | Proper motion in milliarcseconds per year, toward the east and toward the north. `pm_ra` already includes the cos(dec) factor. `null` means unknown and is read as 0 |

The **grid** is the frame of the picture:

| Field | Type | Meaning |
| --- | --- | --- |
| `ra`, `dec` | number | Position of the center of the image, in degrees |
| `fov_deg` | number | Width and height of the image on the sky, in degrees |
| `size` | integer | Width and height of the image, in pixels |

Every frame of a view is resampled on the same grid, so the pixel (x, y) is the same piece of sky in all of them. This is what lets the browser animate, stack and subtract frames without any astronomy library.

- North is up and east is left, as on a sky chart.
- `x` is the column counted from the left and `y` is the row counted from the top, both from 0.
- Pixel centers are at whole numbers. The center of the image is at `(size - 1) / 2`: 63.5 for 128 pixels.
- The pixel (x, y) is at index `y * size + x` of the decoded arrays.
- The projection is gnomonic (`TAN` in FITS files), centered on the grid center. One pixel covers `fov_deg / size` degrees: 2.8 arcseconds in the default view, against 6.2 arcseconds for a SPHEREx pixel.
- The grid never moves. A moving object drifts across it, and `target_xy` tells where the object is in each frame.

### Conversions

```ts
interface Target {
  name?: string;
  ra: number;
  dec: number;
  epoch: number;
  pm_ra: number | null;
  pm_dec: number | null;
}

interface Grid {
  ra: number;
  dec: number;
  fov_deg: number;
  size: number;
}

const DEG = Math.PI / 180;

/** Sky position in degrees to pixel position [x, y]. */
function skyToPixel(grid: Grid, ra: number, dec: number): [number, number] {
  const scale = grid.fov_deg / grid.size;
  const center = (grid.size - 1) / 2;
  const d0 = grid.dec * DEG;
  const d = dec * DEG;
  const da = (ra - grid.ra) * DEG;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  const east = (Math.cos(d) * Math.sin(da)) / cosc / DEG;
  const north = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc / DEG;
  return [center - east / scale, center - north / scale];
}

/** Pixel position to sky position [ra, dec] in degrees. */
function pixelToSky(grid: Grid, x: number, y: number): [number, number] {
  const scale = grid.fov_deg / grid.size;
  const center = (grid.size - 1) / 2;
  const east = (center - x) * scale * DEG;
  const north = (center - y) * scale * DEG;
  const d0 = grid.dec * DEG;
  const denominator = Math.cos(d0) - north * Math.sin(d0);
  const ra = grid.ra + Math.atan2(east, denominator) / DEG;
  const dec = Math.atan2(Math.sin(d0) + north * Math.cos(d0), Math.hypot(east, denominator)) / DEG;
  return [((ra % 360) + 360) % 360, dec];
}

/** Position [ra, dec] of the target at a given date, proper motion applied. */
function targetAt(target: Target, timeMjd: number): [number, number] {
  const years = (timeMjd - 51544.5) / 365.25 - (target.epoch - 2000);
  const dec = target.dec + ((target.pm_dec ?? 0) * years) / 3.6e6;
  const ra = target.ra + ((target.pm_ra ?? 0) * years) / 3.6e6 / Math.cos(target.dec * DEG);
  return [ra, dec];
}

function mjdToDate(mjd: number): Date {
  return new Date((mjd - 40587) * 86400000);
}
```

`skyToPixel(grid, ...targetAt(target, frame.time_mjd))` gives the `target_xy` of a frame. The service uses the same straight-line motion. It ignores parallax and perspective effects: together they stay under one arcsecond for Barnard's Star, the fastest star of the sky, which is a small fraction of a SPHEREx pixel.

## Calls

### `GET /api/health`

```json
{ "status": "ok", "version": "0.1.0" }
```

Never cached. It is the call to use to wake the service up and to check that it is there.

### `GET /api/resolve`

Turns a name into a target, through the CDS Sesame name resolver.

The everyday names of the test targets are understood: `Barnard`, `WISE 0855`, `Epsilon Indi B` and their usual spellings are asked for under the name catalogs know them by. Any other name is asked as it was typed.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `name` | Yes | Name of the object, 1 to 100 characters |

```json
{
  "name": "Barnard's Star",
  "ra": 269.452077,
  "dec": 4.693365,
  "epoch": 2000.0,
  "pm_ra": -801.551,
  "pm_dec": 10362.394
}
```

`name` is the name that was asked, with its spaces tidied. An unknown name is a `not_found` error.

- The position is the one of the year 2000, as SIMBAD gives it. A fast object is elsewhere today: `exposures` and `frames` move it with `pm_ra` and `pm_dec`.
- `pm_ra` and `pm_dec` are `null` when the catalog gives no proper motion, for a galaxy for example.
- The catalogs know designations, not nicknames. `WISE J085510.83-071442.5` is found, `WISE 0855` is not.
- A name already asked is answered from the memory of the service. A new one takes 0.4 to 1.2 s, and an unknown one up to 5 s.

### `GET /api/exposures`

Lists the SPHEREx exposures that cover the target, and sets the grid of the view.

| Parameter | Required | Default | Meaning |
| --- | --- | --- | --- |
| `ra`, `dec` | Yes | | Position of the target, in degrees |
| `epoch` | No | 2000.0 | Date of that position, as a Julian year |
| `pm_ra`, `pm_dec` | No | 0 | Proper motion, in milliarcseconds per year |
| `fov` | No | 0.1 | Width of the view in degrees, from 0.02 to 0.5 |
| `size` | No | 128 | Width of the view in pixels, from 32 to 256 |

```json
{
  "target": { "ra": 269.452077, "dec": 4.693365, "epoch": 2000.0, "pm_ra": -801.551, "pm_dec": 10362.394 },
  "grid": { "ra": 269.44623, "dec": 4.768703, "fov_deg": 0.1, "size": 128 },
  "exposures": [
    {
      "id": "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229",
      "collection": "dr1",
      "detector": 2,
      "pass": 1,
      "time_mjd": 60908.982595,
      "time_iso": "2025-08-21T23:34:56Z"
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Identifier of the exposure. Send it back as it is, do not parse it |
| `collection` | string | SPHEREx data release that holds the file, for example `dr1` or `qr3` |
| `detector` | integer | 1 to 6, from the shortest wavelengths to the longest. In the sample, detector 2 covers 1.09 to 1.66 micrometers |
| `pass` | integer | Visit number, from 1. SPHEREx comes back to a place about every six months and observes it over several days. Exposures less than 30 days apart share a pass |
| `time_mjd`, `time_iso` | number, string | Middle of the exposure, from the archive index. The frame carries the value read in the file, less than a second away |

- The list is sorted by time, then by detector.
- It holds every exposure whose image comes within 0.01 degree (36 arcseconds) of the target. A few of them miss the target itself: their frame says `outside`.
- A target with a proper motion is searched where it was when SPHEREx observed it. That takes two searches of the archive instead of one, and the answer does not depend on the day of the request.
- A place SPHEREx never observed gives an empty list. It is not an error.
- The center of the grid is the position of the target at the middle of the period covered by the list. For an object with no proper motion, it is the position that was asked.
- For Barnard's Star, the list holds 364 exposures in 3 passes, 59 to 62 per detector.
- The archive usually answers in 2 seconds and sometimes in 20. It also fails in bursts of a few seconds, and the service then tries again, which can add up to 12 seconds. The service waits up to 45 seconds in total, then answers 503 with a `Retry-After` header.
- The service remembers the list of a position for an hour and answers at once in the meantime. When the archive does not answer, a list up to a day old is given instead of a 503: the exposures of a place change by a few additions a week.

Passes are what reveals a moving object: it is at the same place within a pass and at another place in the next one.

### `GET /api/frames/{id}`

Returns one exposure as a [frame](#the-frame).

| Parameter | Required | Default | Meaning |
| --- | --- | --- | --- |
| `id` (in the path) | Yes | | Identifier taken from the list of exposures |
| `ra`, `dec`, `epoch`, `pm_ra`, `pm_dec` | `ra` and `dec` | As above | The target, exactly as `exposures` returned it |
| `grid_ra`, `grid_dec` | No | `ra`, `dec` | Center of the grid, exactly as `exposures` returned it |
| `fov`, `size` | No | 0.1, 128 | Size of the grid, exactly as `exposures` returned it |

```
/api/frames/dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229?ra=269.452077&dec=4.693365&pm_ra=-801.551&pm_dec=10362.394&grid_ra=269.44623&grid_dec=4.768703
```

The service is stateless: each frame request carries the whole view. Build the query string once per view, with the values as they were received and always in the same order, so that identical requests share the same cache entry.

The service accepts only identifiers of the expected shape and builds the address of the file itself. It never reads an address supplied by a client.

To study another object of the image, make it the target: convert the clicked pixel with `pixelToSky`, then call `exposures` and `frames` again.

### `GET /api/spectrum`

Measures the target in every exposure that covers it and returns the fluxes, without any image. One request draws the whole spectrum of an object, from 0.75 to 5 micrometers, where the frames of its six detectors would weigh 17 to 36 MB.

| Parameter | Required | Default | Meaning |
| --- | --- | --- | --- |
| `ra`, `dec`, `epoch`, `pm_ra`, `pm_dec` | `ra` and `dec` | As for `exposures` | The target |
| `detector` | No | All | 1 to 6: measure the exposures of that detector only |

```json
{
  "target": { "ra": 331.044147, "dec": -56.782844, "epoch": 2000.0, "pm_ra": 3981.977, "pm_dec": -2466.832 },
  "points": [
    {"id": "dr1.2025W17_4B_0222_3D2.l2b-v27-2026-196", "detector": 2, "pass": 1, "time_mjd": 60791.214263, "time_iso": "2025-04-26T05:08:32Z", "wavelength_um": 1.216, "bandwidth_um": 0.0293, "flux_mjy": 29.366, "error_mjy": 0.61978, "quality": "ok"}
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id`, `detector`, `pass` | string, integer, integer | The exposure, as in the list of `exposures` |
| `time_mjd`, `time_iso` | number, string | Middle of the exposure, read in the file, as in its frame |
| `wavelength_um`, `bandwidth_um` | number or null | Wavelength and width of the band at the place of the target on the detector. `null` when the target is off the detector |
| `flux_mjy`, `error_mjy`, `quality` | as in [`photometry`](#measurement-photometry) | The same measurement as in the frame of that exposure |

- One point per exposure, in the order of the list of `exposures`: by time, then by detector. Sort by `wavelength_um` to draw a spectrum.
- A point without a flux (`saturated`, `masked`, `outside`) is still listed, so that the interface can say why a part of the spectrum is empty.
- An exposure whose file cannot be read gives no point. The call only fails, with a 503, when most of the files cannot be read.
- `wavelength_um` is taken where the target is, and the frame of the same exposure gives the wavelength at the center of its grid. The two differ by less than 0.005 micrometer in the default view.
- With `detector`, the six detectors can be asked in parallel and drawn as they arrive. Measured on the service, the whole does not come sooner that way: ask one detector at a time only to show progress. The passes keep the numbers they have over all the detectors.
- The place of a moving target is computed at the date of each exposure, as for a frame.

### `GET /api/candidates`

Measures the field around the target and returns its [candidates](#candidates): the sources that moved, swung or changed between the visits of SPHEREx.

| Parameter | Required | Default | Meaning |
| --- | --- | --- | --- |
| `ra`, `dec`, `epoch`, `pm_ra`, `pm_dec` | `ra` and `dec` | As for `exposures` | The target. The field measured is its default view: 0.1 degree on 128 pixels, centered as `exposures` centers it |

The answer is the object described in [Candidates](#candidates), without the three fields that open a file: `target`, `grid`, `frames`, `sources`, `visits`, `limits`, `saturated` and `candidates`.

- **It is the longest call.** Every frame of the view is read, the six detectors together, then measured. Ask for it once the frames of the first detector are on screen, and show the rest of the page meanwhile.
- **A field is measured once.** The service remembers its report for an hour and answers at once in the meantime. Two requests for the same field at the same time share one measurement.
- **A 503 here often means "not ready yet".** When the measurement outlasts the time of one request, the answer is a 503 with `Retry-After: 10`, and the measurement goes on. The next request finds it done, or joins it.
- A place SPHEREx never observed gives no visit and no candidate. It is not an error.
- An exposure whose file cannot be read is left out. The call only fails, with a 503, when most of the files cannot be read.
- The parameters must be exactly those of the view: a target written with other digits is another field to measure.

### `GET /api/catalog`

Lists what two catalogs of other telescopes hold inside a view, so that the interface can draw them over the image: a star SPHEREx shows and Gaia knows, or a source that is in no catalog.

| Parameter | Required | Default | Meaning |
| --- | --- | --- | --- |
| `ra`, `dec` | Yes | | Center of the view, degrees: the `ra` and `dec` of the grid on screen, not those of the target |
| `fov` | No | 0.1 | Width of the view, degrees, 0.02 to 0.5: the `fov_deg` of the grid |
| `epoch` | No | Today | Date the view is looked at, as a Julian year. A source counts as inside the view where its motion puts it at that date |

```json
{
  "view": {"ra": 269.4463, "dec": 4.7682, "fov_deg": 0.1},
  "epoch": 2026.0,
  "catalogs": [
    {
      "key": "gaia",
      "name": "Gaia DR3",
      "epoch": 2016.0,
      "band": "G",
      "limit": 300,
      "truncated": false,
      "sources": [
        {"id": "Gaia DR3 4472832130942575872", "ra": 269.448503, "dec": 4.73942, "pm_ra": -801.551, "pm_dec": 10362.394, "parallax_mas": 546.976, "mags": {"G": 8.19}}
      ]
    },
    {
      "key": "allwise",
      "name": "AllWISE",
      "epoch": 2010.56,
      "band": "W2",
      "limit": 300,
      "truncated": false,
      "sources": [
        {"id": "J175747.94+044323.8", "ra": 269.44977, "dec": 4.72328, "pm_ra": null, "pm_dec": null, "parallax_mas": null, "mags": {"W2": 3.66, "W1": 4.36}}
      ]
    }
  ]
}
```

Both sources above are Barnard's Star: where Gaia saw it in 2016, and where WISE saw it in 2010, 58 arcseconds further south.

| Field | Type | Meaning |
| --- | --- | --- |
| `view`, `epoch` | object, number | What was asked: the square of sky, and the date |
| `catalogs[]` | objects | One entry per catalog, always in this order: `gaia`, then `allwise` |
| `key`, `name` | strings | `key` is for the program, `name` for the screen |
| `epoch` | number | Date of the positions of the catalog, as a Julian year. AllWISE gives where a source was in the middle of its survey: 2010.56, within a few months |
| `band` | string | The band the sources are sorted by, the brightest first: `G` for Gaia, in visible light, and `W2` for AllWISE, at 4.6 micrometers, inside the range of SPHEREx and where a cold object is brightest |
| `limit`, `truncated` | integer, boolean | At most `limit` sources are asked of a catalog, the brightest. `truncated` tells that it holds more: the faintest are missing. It happens in the Milky Way |
| `sources[]` | objects | `id` as the catalog writes it, `ra` and `dec` in degrees at the `epoch` of the catalog, `pm_ra` and `pm_dec` in milliarcseconds per year as for a target, `parallax_mas`, and `mags`, a magnitude per band the catalog gives. Each of the last four can be `null`, or absent from `mags` |

- **A source is a target.** With the `epoch` of its catalog it has the fields of a `Target`: `skyToPixel(grid, ...targetAt({...source, epoch: catalog.epoch}, frame.time_mjd))` places it on a frame. For nearly every star the motion does not show. For Barnard's Star it is the whole point: the marker of Gaia follows the star, and the marker of AllWISE stays where the star was in 2010.
- **AllWISE gives no motion.** Its sources are drawn where they were seen. A fast object is then away from its marker, by 15 years of its motion.
- **Pass `epoch`.** The middle of the dates of the frames on screen is right. It only decides which fast stars count as inside the view.
- **The two catalogs are asked together, and the call fails as a whole.** A 503 means that the catalog service did not answer. Nothing else on the page depends on it: leave the overlay off and say so.
- **The five test targets have the answer in a static file,** `<key>-catalog.json`, listed in the [index](#one-file-per-detector-and-an-index): the same object for the grid of the target, 11 to 38 kB. Read the file for a test target shown in its default view, and ask the call for anything else.
- The catalogs are read at VizieR, the catalog service of the CDS, through its mirror at Harvard first. A site of VizieR fails for a minute now and then: the service asks each site twice before it answers 503, and remembers an answer for a day.

## The frame

A frame is one exposure, cut out and aligned on the grid, with everything measured on it. The pixels are shortened here:

```json
{
  "id": "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229",
  "time_mjd": 60908.982595,
  "time_iso": "2025-08-21T23:34:56Z",
  "exposure_s": 113.6,
  "wavelength_um": 1.1012,
  "bandwidth_um": 0.0254,
  "background": 0.4463,
  "noise": 0.1664,
  "valid_fraction": 0.991,
  "target_xy": [63.35, 65.47],
  "photometry": { "flux_mjy": null, "error_mjy": null, "quality": "saturated" },
  "image": "43,692 characters of base64",
  "mask": "21,848 characters of base64"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Identifier of the exposure, the same as in the list. It is the key to find `collection`, `detector` and `pass` |
| `time_mjd`, `time_iso` | number, string | Middle of the exposure, read in the file |
| `exposure_s` | number | Exposure time, in seconds |
| `wavelength_um` | number | Wavelength seen at the center of the grid, in micrometers |
| `bandwidth_um` | number | Width of the band at that place, in micrometers |
| `background` | number or null | Median of the unflagged pixels of the field, in MJy/sr. `null` when there is none |
| `noise` | number or null | Scatter of the unflagged pixels, in MJy/sr: 1.4826 times their median absolute deviation. `null` when there is none |
| `valid_fraction` | number | Share of the pixels that hold a value, from 0 to 1 |
| `target_xy` | [number, number] | Position [x, y] of the target in this frame, proper motion applied. It can fall outside the image |
| `photometry` | object | Flux of the target in this frame. See [Measurement](#measurement-photometry) |
| `image` | string | The pixels. See [Pixels](#pixels-image) |
| `mask` | string | The flags of the pixels. See [Flags](#flags-mask) |

Three things to know before drawing a frame:

- **Each frame has its own wavelength.** SPHEREx has no filter wheel. A filter whose color changes gradually covers each detector, so the wavelength depends on where the object falls on the detector. Each exposure of the same object is taken at a different wavelength, and the frames of an object are the points of its spectrum. Inside one image the wavelength also drifts a little, by roughly 0.02 micrometers from one edge to the other in the default view of detector 2.
- **The background changes from one frame to the next.** It is mostly the glow of the dust of the solar system, the zodiacal light. Subtract `background` before comparing, stacking or subtracting frames.
- **`noise` is a display scale.** It includes the faint stars of the field. Use it to set the contrast, not to claim a detection.

### Pixels: `image`

- Base64 of `size * size` numbers, row by row from the top, each one a 16-bit float (IEEE 754 half precision), little endian.
- The unit is MJy/sr (megajansky per steradian), the surface brightness unit of the SPHEREx files. The background is not subtracted.
- NaN means no value: the pixel is outside the detector or cannot be used.
- 16 bits halve the size of a frame. Measured on the sample, the rounding costs at most 0.7% of the noise on sky pixels and 0.05% of the value anywhere. Values beyond 65,504 are clipped; the brightest pixel of the sample is at 2,109.

```ts
function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function halfToNumber(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

function decodeImage(text: string, size: number): Float32Array {
  const bytes = base64ToBytes(text);
  if (bytes.length !== size * size * 2) throw new Error("Unexpected image length");
  const view = new DataView(bytes.buffer);
  const pixels = new Float32Array(size * size);
  for (let i = 0; i < pixels.length; i++) pixels[i] = halfToNumber(view.getUint16(i * 2, true));
  return pixels;
}

function decodeMask(text: string, size: number): Uint8Array {
  const bytes = base64ToBytes(text);
  if (bytes.length !== size * size) throw new Error("Unexpected mask length");
  return bytes;
}
```

Where the native `Float16Array` exists, `new Float16Array(base64ToBytes(text).buffer)` gives the same values. Checked with Node 24.

### Flags: `mask`

Base64 of `size * size` bytes, in the same order as the image. A byte is 0 when there is nothing to report. Otherwise it is a sum of these bits, named after the SPHEREx flags:

| Bit | SPHEREx flag | Our reading of the name |
| --- | --- | --- |
| 1 | `TRANSIENT` | Brief event during the exposure, such as a cosmic ray |
| 2 | `OVERFLOW` | Pixel that nears saturation and keeps its value, or saturated pixel, which is NaN |
| 4 | `SUR_ERROR` | The fit that estimates the flux of the pixel failed or is doubtful |
| 8 | `PERSIST` | Afterglow of a bright source seen in an earlier exposure |
| 16 | `OUTLIER` | Value far from what is expected |
| 32 | `BLOOM` | Charge spilled from a saturated neighbor |
| 64 | `HALO` | Halo of a bright source |
| 128 | other | Any other flag, except `SOURCE` and `FULLSAMPLE`, which are informative, and the two flags below that remove the value |

The official definitions are in the SPHEREx Explanatory Supplement. The third column is only our reading.

- **A flagged pixel keeps its value.** The browser decides: show everything in the viewer, skip flagged pixels when stacking or subtracting.
- A grid pixel carries the flags of the four SPHEREx pixels it is interpolated from.
- Pixels flagged `NONFUNC` or `MISSING_DATA` have no value to show. They are NaN in the image.
- **A NaN pixel with the `OVERFLOW` bit is a saturated core, not a hole.** Draw it at the top of the color scale. In the sample, the heart of Barnard's Star is in this state in 61 frames out of 62.

### Measurement: `photometry`

The flux of the target, measured by the service on the original pixels, at the position the target has at the date of the frame. The browser plots it and never measures on the resampled image.

| Field | Type | Meaning |
| --- | --- | --- |
| `flux_mjy` | number or null | Flux of the target, in millijansky |
| `error_mjy` | number or null | One sigma uncertainty, in millijansky |
| `quality` | string | How far the value can be trusted |

| `quality` | Value present | Meaning |
| --- | --- | --- |
| `ok` | Yes | Nothing to report |
| `flagged` | Yes | At least one pixel of the measurement carries a flag, often a pixel that nears saturation. Show the point with a warning |
| `masked` | No | A pixel of the measurement has no data |
| `saturated` | No | The heart of the object is saturated: SPHEREx has no value there in this exposure |
| `outside` | No | The target is off the detector or too close to its edge |

How the flux is measured:

- **A circle and a ring.** The light inside a circle of 2.5 SPHEREx pixels in radius (15.4 arcseconds) around the target, minus the sky, which is the median of a ring from 5 to 8 pixels.
- **A correction for the light outside the circle.** The circle catches 97.6 to 98.5 percent of the light of a point source, depending on the detector. The flux is divided by that share, taken from the PSF model each SPHEREx file carries. This puts it on the scale of a fit of that PSF, the method of the SPHEREx spectrophotometry tool of the archive.
- **An honest uncertainty.** `error_mjy` adds two terms: the noise given by the variance plane of the file, and the scatter measured between exposures of steady stars, 2 percent of the flux. The second term is 5 percent when a pixel of the circle nears saturation.
- **Near saturation is not saturation.** A pixel flagged `OVERFLOW` that still has a value is used, as the SPHEREx spectrophotometry tool of the archive does, and the point is `flagged`. When the heart of the object has no value left, the quality is `saturated` and there is no flux.
- **One number per frame, at the wavelength of the frame.** It is a flux density. Plot `flux_mjy` against `wavelength_um` for a spectrum, and against `time_mjd` inside one detector for a light curve.
- **A crowded field biases it.** Every source inside the circle is counted, and bright sources in the ring raise the sky.

What to expect on the five test targets is in [`samples/README.md`](../samples/README.md#the-five-targets). In short: Epsilon Indi B has clean points, RW Aurigae nears saturation so most of its points are `flagged`, WISE 0855 is at the noise level in a single frame, Barnard's Star only has points beyond 3.8 micrometers, and R Draconis is saturated everywhere. What R Draconis did between its visits is read on its halo instead: see [Candidates](#a-star-too-bright-is-followed-through-its-halo).

## The bundle

A bundle is a static file that answers `exposures` and `frames` at once. The five test targets are served this way.

```json
{
  "format": "spherex-explorer/bundle",
  "version": 1,
  "generated": "2026-11-14T07:16:32Z",
  "target": { "name": "Barnard's Star", "ra": 269.452077, "dec": 4.693365, "epoch": 2000.0, "pm_ra": -801.551, "pm_dec": 10362.394 },
  "grid": { "ra": 269.44623, "dec": 4.768703, "fov_deg": 0.1, "size": 128 },
  "exposures": [],
  "frames": []
}
```

- `target`, `grid` and `exposures` are what `GET /api/exposures` returns.
- `frames[i]` is the frame of `exposures[i]`, as `GET /api/frames/{id}` returns it for this target and this grid.
- The browser therefore has one code path and two sources: a bundle or the service.

### The spectrum file

`<key>-spectrum.json` is the answer of `GET /api/spectrum` for a test target, in a static file of 60 to 130 kB, 10 to 25 kB in transit:

```json
{
  "format": "spherex-explorer/spectrum",
  "version": 1,
  "generated": "2026-11-14T20:18:54Z",
  "target": { "name": "Epsilon Indi B", "ra": 331.044147, "dec": -56.782844, "epoch": 2000.0, "pm_ra": 3981.977, "pm_dec": -2466.832 },
  "points": []
}
```

Load it before any bundle to draw the spectrum of a preset at once. Its points are the measurements of the frames of the bundles, exposure for exposure: `samples/check-sample.ts` compares them.

### One file per detector, and an index

A target has one bundle per detector, named `<key>-d<detector>.json`, so that the browser loads the 2 to 6 MB of the detector it shows and not the 17 to 36 MB of the six. The files are in [`samples/`](../samples/README.md) and the site serves them under `/samples/`.

`index.json`, in the same folder, lists them. Read it first: it tells which targets and detectors have a file, so that a file added later needs no change in the browser.

```json
{
  "format": "spherex-explorer/index",
  "version": 1,
  "generated": "2026-11-14T19:28:45Z",
  "targets": [
    {
      "key": "barnard-star",
      "name": "Barnard's Star",
      "target": { "name": "Barnard's Star", "ra": 269.452077, "dec": 4.693365, "epoch": 2000.0, "pm_ra": -801.551, "pm_dec": 10362.394 },
      "grid": { "ra": 269.44623, "dec": 4.768703, "fov_deg": 0.1, "size": 128 },
      "passes": 3,
      "detectors": [
        { "detector": 1, "file": "barnard-star-d1.json", "frames": 60, "wavelength_um": [0.7413, 1.1074], "bytes": 3962335 }
      ],
      "spectrum": { "file": "barnard-star-spectrum.json", "points": 364, "with_flux": 101, "bytes": 83927 },
      "candidates": { "file": "barnard-star-candidates.json", "count": 1, "moved": 1, "swung": 0, "changed": 0, "bytes": 1663 },
      "catalog": { "file": "barnard-star-catalog.json", "sources": { "gaia": 85, "allwise": 184 }, "bytes": 37502 }
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `key` | string | Name of the target in the file names |
| `name` | string | Name to display |
| `target`, `grid` | objects | The same as in each bundle of the target: the six detectors share one grid |
| `passes` | integer | Number of passes over all the detectors |
| `detectors[].detector` | integer | 1 to 6. A detector that never saw the target has no entry |
| `detectors[].file` | string | Name of the bundle, relative to the index |
| `detectors[].frames` | integer | Number of frames in the bundle |
| `detectors[].wavelength_um` | two numbers | Shortest and longest wavelength of the frames, in micrometers |
| `detectors[].bytes` | integer | Size of the bundle before compression in transit |
| `spectrum.file` | string | Name of the [spectrum file](#the-spectrum-file), relative to the index |
| `spectrum.points`, `spectrum.with_flux` | integers | Number of points, and how many of them hold a flux |
| `spectrum.bytes` | integer | Size of the spectrum file before compression in transit |
| `candidates.file` | string | Name of the [candidates file](#candidates), relative to the index |
| `candidates.count`, `candidates.moved`, `candidates.swung`, `candidates.changed` | integers | Number of candidates, and how many of each kind |
| `candidates.bytes` | integer | Size of the candidates file |
| `catalog.file` | string | Name of the catalog file, relative to the index: the answer of [`GET /api/catalog`](#get-apicatalog) for the grid of the target, at the middle of the dates of its frames |
| `catalog.sources` | object | Number of sources of each catalog in the file, by its `key` |
| `catalog.bytes` | integer | Size of the catalog file |

- The keys of the five test targets are `barnard-star`, `epsilon-indi-b`, `wise-0855`, `rw-aurigae` and `r-draconis`.
- An exposure whose file is gone from the archive is left out of both `exposures` and `frames`, so the two lists of a bundle always have the same length.
- The bundles are built by the code of the service, with `python -m spherex_explorer.precompute`: a frame of a bundle is the frame the service returns for the same target and grid.
- The candidates of a test target are measured on the frames of its bundles, the very ones the site shows. `python -m spherex_explorer.precompute --output samples --candidates-only` writes them again without any download.
- A sixth key, `synthetic-planet-x`, is not a test target and is not real: see [below](#a-sixth-target-that-is-not-real).
- The catalog file of a test target, `<key>-catalog.json`, is the object `GET /api/catalog` returns, after three fields that open it: `format`, which is `spherex-explorer/catalog`, `version` and `generated`. The overlay of a test target then works when the catalog service does not answer. `--catalogs-only` writes these files again: it asks the catalog service alone.

### A sixth target that is not real

`synthetic-planet-x` is a quiet field of the sky, at right ascension 199.99 and declination +29.99, with a made-up body of the outer solar system drawn on its frames. It shows what the search for [a body that swings](#a-body-of-the-outer-solar-system-swings-with-the-seasons) finds when there is one, since the real sky has given none.

```json
"synthetic": {
  "note": "A made-up body added to real SPHEREx frames to test the search for a swing. It does not exist.",
  "distance_au": 6000.0,
  "parallax_arcsec": 34.38,
  "flux_mjy": {"5": 0.45, "6": 1.5}
}
```

- **Three places say it.** The entry of the target in the index, each of its six bundles and its candidates file carry this object, as their last field. A target without it is real.
- **The frames are real, the body is not.** They are the frames of that field, as the service returns them. The body is added to the image of each frame of detectors 5 and 6, where it would be at the date of the frame, with the shape of a star and the flux of `flux_mjy`, in millijanskys for each detector. Nothing else is touched: the flags, the dates, `background`, `noise` and `photometry` are those of the real frame.
- **The body.** It is cold, seen from 3.8 to 5 micrometers only, as WISE 0855 is, and three times as bright. It is 6,000 astronomical units from the Sun and moves by 2.76 arcseconds per year on its own, as a body on a round orbit there would.
- **`target` is where the Sun would see it,** with its own motion. No frame shows the body there: it is 34 arcseconds to one side during the first and the third visit, and to the other side during the second.
- **The candidates file is what the search finds, with no hint:** one `swung` candidate, 6,148 astronomical units away, between 6,048 and 6,252. The check of the static files fails if the body is not found at the distance it was drawn at.
- **The spectrum file holds the sky.** It is measured in the files of the archive at the place of `target`, where the body is not. It is of no use on screen.
- **On screen, say that it is synthetic wherever it shows:** on the control that opens it, on the image, in the panel of the candidates, and on anything saved or shared from it.

`python -m spherex_explorer.precompute --output samples --target synthetic-planet-x` builds it again, from the archive.

## Candidates

A fifth question: **what moved or changed in this field?** The service follows every source of the default view from one visit of SPHEREx to the next and keeps the ones that stand out. The visitor no longer has to spot them by eye. It also looks for a body of the outer solar system, which does not stay around one place: see [a body that swings](#a-body-of-the-outer-solar-system-swings-with-the-seasons).

The five test targets have the answer in a static file, `<key>-candidates.json`, of 1 to 2 kB. For any other position, [`GET /api/candidates`](#get-apicandidates) returns the same object without its first three fields.

```json
{
  "format": "spherex-explorer/candidates",
  "version": 1,
  "generated": "2026-11-14T22:36:39Z",
  "target": {"name": "Epsilon Indi B", "ra": 331.044147, "dec": -56.782844, "epoch": 2000.0, "pm_ra": 3981.977, "pm_dec": -2466.832},
  "grid": {"ra": 331.096709, "dec": -56.800682, "fov_deg": 0.1, "size": 128},
  "frames": 462,
  "sources": 13,
  "visits": [
    {"pass": 1, "time_mjd": 60804.640346, "time_iso": "2025-05-09T15:22:06Z", "frames": 121}
  ],
  "limits": {"significance": 5.0, "shift_arcsec": 1.0, "change": 0.1, "swing_distance_au": [1600, 24400]},
  "saturated": [],
  "candidates": [
    {
      "kind": "moved",
      "method": "source",
      "confidence": "high",
      "significance": 77.7,
      "is_target": true,
      "ra": 331.096878,
      "dec": -56.800849,
      "epoch": 2026.045,
      "xy": [63.38, 63.71],
      "detectors": [1, 2, 3, 4, 5, 6],
      "track": [
        {"pass": 1, "time_mjd": 60804.135297, "time_iso": "2025-05-09T03:14:50Z", "ra": 331.095605, "dec": -56.800338, "xy": [64.27, 63.06], "error_arcsec": 0.055, "detectors": [1, 2, 3, 4, 5, 6]},
        {"pass": 2, "time_mjd": 60959.410255, "time_iso": "2025-10-11T09:50:46Z", "ra": 331.096236, "dec": -56.800721, "xy": [63.83, 63.55], "error_arcsec": 0.057, "detectors": [2, 3, 4, 5, 6]}
      ],
      "motion": {
        "shift_arcsec": 6.43,
        "days": 507.1,
        "rate_arcsec_per_year": 4.63,
        "rate_error_arcsec_per_year": 0.06,
        "angle_deg": 121.9,
        "pm_ra": 3934.0,
        "pm_dec": -2448.0,
        "parallax_arcsec": 0.296,
        "parallax_error_arcsec": 0.038,
        "distance_ly": 11.0,
        "distance_ly_range": [9.8, 12.6]
      },
      "swing": null,
      "changes": []
    }
  ]
}
```

This is Epsilon Indi B, found with no position given. The catalog says 4.68 arcseconds per year toward 121.8 degrees, and 12.0 light-years.

| Field | Type | Meaning |
| --- | --- | --- |
| `target`, `grid` | objects | The view that was measured: always the default one, 0.1 degree on 128 pixels |
| `frames`, `sources` | integers | Frames measured, and sources followed in them |
| `visits[]` | objects | Each visit of SPHEREx: its `pass`, its mean date, its number of frames |
| `limits` | object | The least that is claimed: `significance` in sigma, `shift_arcsec` for a motion, `change` as a share of the brightness. `swing_distance_au` gives the two distances, in astronomical units, between which a body that swings was looked for. It is `null` when the field has fewer than two visits: nothing was looked for |
| `saturated[]` | objects | Stars too bright to be measured: place (`ra`, `dec`, `xy`), `radius_arcsec` of the saturated heart, and the `detectors` it saturates |
| `candidates[]` | objects | The sources that stand out, the surest first. An empty list is a result: nothing moved or changed above the limits, and no body swings between the two distances of `limits` |

One candidate:

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | string | `moved`, `swung` or `changed`. Other kinds can be added: ignore the ones you do not know |
| `method` | string | What was measured: `source`, the object itself, or `halo`, the light around a star too bright to be measured. See [a star too bright](#a-star-too-bright-is-followed-through-its-halo). Other methods can be added |
| `confidence` | string | `high` or `medium`. See below |
| `significance` | number | How many times its uncertainty the motion, or the clearest change, is. For `swung`, how far the body stands above the sky in the visit that shows it least |
| `is_target` | boolean | The candidate is where the catalog puts the target at the date of each visit. For `swung`, where the Sun would see the body is where the target is at the middle of the visits |
| `ra`, `dec`, `xy` | numbers | Mean place over the visits, on the sky and on the grid of the file. For `swung`, where the Sun would see the body: no frame shows it there |
| `epoch` | number | Date of that place, as a Julian year: the middle of the sightings |
| `detectors` | integers | Detectors the measurement rests on |
| `track[]` | objects | Where the source was in each visit: `pass`, date, `ra`, `dec`, `xy`, `error_arcsec` along each axis, `detectors`. With the method `halo` it is the saturated heart at every visit, and `error_arcsec` is its radius. For `swung`, the sightings are tens of arcseconds apart: this is where to look in the frames of each visit |
| `motion` | object or null | The fitted motion. Present for `moved`. For `swung` it is the motion of the body itself, its swing taken out, and it is present when three visits or more could check it |
| `swing` | object or null | The swing of the body with the seasons, and its distance. Present for `swung` only |
| `changes[]` | objects | The clearest change of each detector that shows one, the clearest first. Empty unless the brightness changed |

`motion`:

| Field | Type | Meaning |
| --- | --- | --- |
| `shift_arcsec`, `days` | numbers | Motion between the first and the last sighting, and the days between them |
| `rate_arcsec_per_year`, `rate_error_arcsec_per_year` | numbers | Speed on the sky and its one sigma uncertainty |
| `angle_deg` | number | Direction of the motion: 0 is north, 90 is east |
| `pm_ra`, `pm_dec` | numbers | The same motion as a proper motion, in milliarcseconds per year, ready for `exposures` |
| `parallax_arcsec`, `parallax_error_arcsec` | numbers or null | Swing of the object with the seasons, when the positions ask for one |
| `distance_ly`, `distance_ly_range` | number, two numbers, or null | Distance the parallax gives, in light-years, and the distances one sigma allows. The range alone is `null` when the parallax is too unsure to bound the far side |

`swing`:

| Field | Type | Meaning |
| --- | --- | --- |
| `parallax_arcsec`, `parallax_error_arcsec` | numbers | How far the body is from where the Sun would see it, when the Earth is at a right angle to it, and the one sigma uncertainty |
| `distance_au`, `distance_au_range` | integer, two integers | Distance that parallax gives, in astronomical units, and the distances one sigma allows. 206,265 divided by the parallax |
| `swing_arcsec` | number | The widest gap between two sightings of `track`: what the eye sees on the frames |

`changes[]`:

| Field | Type | Meaning |
| --- | --- | --- |
| `detector` | integer | 1 to 6 |
| `from_pass`, `to_pass` | integers | The two visits compared |
| `ratio`, `error` | numbers | Brightness in `to_pass` over brightness in `from_pass`, and its one sigma uncertainty |
| `significance` | number | How many times its uncertainty the change is |
| `wavelength_um` | two numbers | The wavelengths at which the two visits were compared |

To show a candidate, draw `track` on the image: `xy` is on the default grid, and `ra`, `dec` go through `skyToPixel` for any other grid. To study it, make it the target: its `ra`, `dec` and `epoch`, with the `pm_ra` and `pm_dec` of its `motion` when it has one, are the parameters of `exposures`.

### How a candidate is measured

- **Visit by visit.** Nothing has time to move within a visit. The frames of a visit are averaged, detector by detector, after the accidents of a single exposure are removed. Each source is measured in each average.
- **Measured uncertainties.** The frames of a visit are split in two halves at random, eight times, and the two halves are asked for the same position. They are also split by wavelength: two stars too close to be told apart, of different colors, have a center that slides with the wavelength.
- **A position needs a source.** It is kept where the average of a visit shows the source at 4 sigma or more, from three frames at least, and with its whole window inside the image. Under that, the center of light follows the noise.
- **The field corrects itself.** Most sources are steady. Their median shift lines each visit up on the others, and their median brightness ratio between two visits is taken out.
- **A motion is a straight line, plus a swing.** A nearby object swings back and forth with the seasons: its parallax. The swing is kept when three visits or more ask for it clearly, and it gives the distance.
- **A motion must follow its path.** When the path fits worse than chance allows, the motion counts for less, all the more as few measurements are left to judge it. When the positions are too few to check the path at all, two visits in one detector, the motion needs twice the evidence.
- **A change is compared at equal wavelengths.** Two frames are compared when they differ by less than half the width of their band, so that the color of a source is not taken for a change. A change must show in two detectors: a reflection of a bright star outside the field touches one.
- **A cold object in front of a star** is followed in the detectors that show it move, when the others disagree. This is how WISE 0855 is found, in detectors 5 and 6 alone.

`confidence` is `high` when the significance is 10 or more and, for a motion or a swing, when the source was followed over three visits or more. Otherwise it is `medium`.

### A star too bright is followed through its halo

A star that saturates has no value left at its heart, and the spectrum call gives it no flux. Its light still spreads far around it, and that halo is as bright as the star is: when the star fades by half, so does its halo. SPHEREx flags these pixels `HALO` and keeps their value.

- **Two rings.** The brightness of the halo is the median of a ring around the heart, minus the median of a ring far from the star, which removes the sky. The first ring starts 17 arcseconds outside the saturated heart and never closer than 37 arcseconds to the star. A second ring starts where the first one ends. Medians ignore the neighbors of the star and its spikes, which turn with the telescope.
- **Same rule as any change.** Two visits are compared at equal wavelengths, in each detector the star saturates, and a change must show in two detectors at 5 sigma and 10 percent.
- **What a halo does by itself.** The halo of a steady star is not perfectly steady. On fifteen saturated stars that are not known to change much, 205 comparisons of two visits, its usual wander is 4 percent in detectors 4 to 6 and 10 percent in detectors 1 to 3. The uncertainty of a change holds 5 and 15 percent for it, the scatter of the frames, and what the two rings disagree by. Now and then one detector alone jumps by much more, up to 50 percent in the giant Psi Ursae Majoris: the rule of the two detectors is there for that.
- **What is read, and what is not.** The ratio is that of the star between two visits. It is not a flux: `changes` has no unit. A change the second ring cannot confirm is dropped, and so is a star whose rings leave the image by more than a third.
- **One star, one candidate.** A star that saturates some detectors only is followed as a source in the others. When that already makes it a candidate, its halo is not reported a second time.

### A body of the outer solar system swings with the seasons

A star a few light-years away swings by a fraction of an arcsecond as the Earth goes around the Sun. A body a few thousand astronomical units away swings by tens of arcseconds: it is at one place during a visit, at another during the next, and back at the first one six months later. Around either place it is a source that comes and goes, and the detection above does not follow it. This is what a distant planet of the solar system would do, and what the name of the challenge asks about.

```json
{
  "kind": "swung",
  "method": "source",
  "confidence": "high",
  "significance": 27.0,
  "is_target": true,
  "ra": 199.990463,
  "dec": 29.995123,
  "epoch": 2025.94,
  "xy": [63.57, 63.24],
  "detectors": [5, 6],
  "track": [
    {"pass": 1, "time_mjd": 60831.562228, "time_iso": "2025-06-05T13:29:37Z", "ra": 199.982791, "dec": 30.000581, "xy": [72.08, 56.25], "error_arcsec": 0.861, "detectors": [5, 6]},
    {"pass": 2, "time_mjd": 61034.541972, "time_iso": "2025-12-25T13:00:26Z", "ra": 199.999764, "dec": 29.990875, "xy": [53.26, 68.68], "error_arcsec": 0.874, "detectors": [5, 6]}
  ],
  "motion": {"shift_arcsec": 2.4, "days": 359.4, "rate_arcsec_per_year": 2.44, "rate_error_arcsec_per_year": 1.23, "angle_deg": 301.3, "pm_ra": -2085.0, "pm_dec": 1268.0, "parallax_arcsec": 33.55, "parallax_error_arcsec": 0.557, "distance_ly": 0.1, "distance_ly_range": [0.1, 0.1]},
  "swing": {"parallax_arcsec": 33.55, "parallax_error_arcsec": 0.56, "distance_au": 6148, "distance_au_range": [6048, 6252], "swing_arcsec": 64.9},
  "changes": []
}
```

**This body does not exist.** It is the one of the [synthetic target](#a-sixth-target-that-is-not-real): a made-up body, cold, 6,000 astronomical units away, drawn on the real frames of a quiet field. The third sighting of its track is left out here. No real field gave a `swung` candidate.

- **The body is followed, not the place.** For a parallax that is tried, the place of a body on every frame is known, but for where the Sun would see it. Each frame is read with that shift: the body stays where it is and adds up, while the stars slide. 44 parallaxes are tried, from 8.4 to 129 arcseconds, then the best one more finely.
- **It must be there in every visit,** at 6 sigma or more near the place and at 5 sigma or more at one same place, all the detectors together or the two reddest alone. A cold body shows in those two only. A visit with less than a third of the frames of the richest one is not asked that much: it must only not contradict the others.
- **And the sky must be empty where it is not.** Where the body is during one visit, the other visits must show nothing, or less than three tenths of it. Two stars that happen to sit along the line of the swing fail there: each is at its place in every visit. A visit that did not look at the place cannot say it is empty.
- **Two bodies do not share a place.** Beside a bright body, its light and a source of the field can line up as a second, fainter one: the surer of the two is kept.
- **Its places give its distance.** The center of light of the body is measured in each visit. The places are fitted with where the Sun would see it, its parallax, and its own motion when three visits or more allow it. The parallax is the distance: at 34 arcseconds, 6,000 astronomical units.
- **Two visits show a swing and cannot check it.** The body then needs twice the evidence, a significance of 10, the claim is `medium` at most, and `motion` is `null`.
- **A source at one of its places is not reported again.** The detection above may see the body, around one of its places, as a source that moved. That candidate is dropped: the swing says it better.
- **What the distances mean.** Anything whose parallax is 8 arcseconds or more is within 0.4 light-year, a tenth of the way to the nearest star: it belongs to the Sun. From 1,600 to 24,000 astronomical units are the distances of the inner Oort cloud, where comets come from. A planet as near as the ones proposed so far, a few hundred astronomical units, swings by more than the view holds: this search does not reach it.
- **Do not expect one.** The WISE mission found nothing as large as Saturn out to 10,000 astronomical units, nor as large as Jupiter out to 26,000 (Luhman 2014). What this adds is a search anyone can run on any field, and its answer when it finds nothing: `limits.swing_distance_au` says between which distances nothing swings.

To show such a candidate, mark each sighting of `track` on the frames of its own visit, and say the distance. To study it as a target, give `exposures` its `ra`, `dec` and `epoch`: the view is then centered between its places.

### Is a candidate known?

A candidate says that something moved or changed. The catalog of Gaia says whether that something is a star already known, and how it moves. Putting the two side by side is the browser's job, with the [catalog](#get-apicatalog) of the view and this function:

```ts
/** The source of a catalog that is the candidate, or null. Each source is moved to the
 *  date of the candidate with its own motion. */
function knownAs(candidate: Candidate, catalog: Catalog, withinArcsec = 3): { source: CatalogSource; separation: number } | null {
  const date = 51544.5 + (candidate.epoch - 2000) * 365.25;
  let best: { source: CatalogSource; separation: number } | null = null;
  for (const source of catalog.sources) {
    const [ra, dec] = targetAt({ ra: source.ra, dec: source.dec, epoch: catalog.epoch, pm_ra: source.pm_ra, pm_dec: source.pm_dec }, date);
    const east = (((ra - candidate.ra + 540) % 360) - 180) * Math.cos(candidate.dec * DEG) * 3600;
    const north = (dec - candidate.dec) * 3600;
    const separation = Math.hypot(east, north);
    if (separation <= withinArcsec && (best === null || separation < best.separation)) best = { source, separation };
  }
  return best;
}
```

Call it with the `gaia` catalog. Three arcseconds is half a SPHEREx pixel: the candidates of the test targets are 0.2 to 0.7 arcsecond from their source of Gaia, and the nearest star that is not WISE 0855 is 6.3 arcseconds from it.

| Test target | `knownAs(candidate, gaia)` | What Gaia says | What the candidate says |
| --- | --- | --- | --- |
| Barnard's Star | `Gaia DR3 4472832130942575872`, 0.2 arcsecond | 10.39 arcseconds per year, 5.96 light-years | 10.5 ± 0.9 |
| Epsilon Indi B | `Gaia DR3 6412596012146801152`, 0.6 arcsecond | 4.68 arcseconds per year, 12.1 light-years | 4.63 ± 0.06, 11.0 light-years, between 9.8 and 12.6 |
| WISE 0855 | `null` | Nothing: the object is too cold for Gaia | 7.5 ± 0.9 |
| RW Aurigae | `Gaia DR3 156430817820015232`, 0.7 arcsecond | A star that barely moves | `changed` |
| R Draconis | `Gaia DR3 1648328016354496384`, 0.6 arcsecond | A star that barely moves | `changed`, on its halo |

- **The motion of Gaia** is `Math.hypot(source.pm_ra, source.pm_dec) / 1000` arcseconds per year, to set next to `motion.rate_arcsec_per_year` of a candidate that moved. It is there for any candidate of the field, not only for the target.
- **The distance of Gaia** is `3261.6 / source.parallax_mas` light-years. Show it when `parallax_mas` is 5 or more, 650 light-years or closer: further out, the parallax of a faint star is not sure enough to be shown as a distance.
- **`null` is the interesting answer.** Say "Gaia DR3 holds no source here". Gaia stops near magnitude 21 in visible light: an object too cold, like WISE 0855, is not in it. Do not say "unknown" or "new": other catalogs may hold it, as AllWISE holds WISE 0855.
- **A truncated catalog cannot say no.** When `truncated` is true and the answer is `null`, the source may be among the faint ones left out. Ask `GET /api/catalog` again around the candidate, with its `ra`, `dec` and `epoch` and `fov=0.02`, and call the function on that answer.
- **AllWISE is not matched this way** for a candidate that moved: it gives no motion, and the object is elsewhere in its list, where it was in 2010. For a candidate that did not move, the same function works with the `allwise` catalog.

`node samples/check-sample.ts samples/index.json` runs this function on the files of the five test targets, and fails when a candidate that moved disagrees with the motion Gaia gives it.

### What is not claimed

- A shift under 1 arcsecond, a sixth of a SPHEREx pixel, or a change under 10 percent.
- A star that nears saturation and moves slowly. Its position is only trusted to 0.8 arcsecond, so it has to move by several arcseconds: Ross 128, at 1.4 arcsecond per year, is missed.
- Anything else within reach of a saturated star, in the glare of a star thousands of times brighter, or closer than 20 arcseconds to the edge of the view.
- A source with a neighbor closer than 22 arcseconds and at least a third as bright, in the detectors that show both.
- The motion or the flux of a star in the detectors it saturates. Only a change of its halo is, and in practice a change of a quarter or more: the halo of a steady star wanders by itself.
- The halo of a star so bright that its saturated heart reaches more than 50 arcseconds from its center, or of a saturated star near the edge of the view. Such a star is listed in `saturated` and nothing more is said.
- A body of the solar system nearer than 1,600 astronomical units. Its swing, more than two arcminutes, does not fit in the view with a margin on each side: it shows in one visit only, which is not reported. Neptune is at 30, and the planets proposed beyond it at a few hundred.
- A body that swings by less than 8 arcseconds, farther than 24,000 astronomical units, and by more than a source is followed: between the two searches, its two places overlap.
- A body that swings and that the sky hides: at a place where a star sits in the other visits, or with a place closer than 22 arcseconds to the edge of the view.

A candidate is a measurement that stands out, not a discovery. Say "candidate" on screen.

## The journal

A sixth thing to show: **what has been found so far.** `journal.json`, beside the index, lists the findings of the fields the search was checked on: 28 entries, 14 kB. A visitor opens any of them in one click, and sees the service measure it again.

```json
{
  "format": "spherex-explorer/journal",
  "version": 1,
  "generated": "2026-11-15T03:37:04Z",
  "entries": [
    {
      "id": "wolf-359",
      "name": "Wolf 359",
      "source": "team",
      "status": "confirmed",
      "kind": "moved",
      "method": "source",
      "confidence": "medium",
      "significance": 9.6,
      "ra": 164.092532,
      "dec": 6.99531,
      "epoch": 2025.89,
      "target": {
        "ra": 164.120504,
        "dec": 7.014723,
        "epoch": 2000.0,
        "pm_ra": -3866.338,
        "pm_dec": -2699.215
      },
      "preset": null,
      "found": "Moved by 4.84 ± 0.51 arcseconds per year toward 243 degrees",
      "known": "4.72 arcseconds per year toward 235 degrees in SIMBAD",
      "measured": "2026-11-15"
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Key of the entry, one of a kind in the file |
| `name` | string | Name to display: the object when catalogs know it, or `Candidate at` and its place |
| `source` | string | Who listed it. `team`: one of our checks. `visitor`: a mark shared from the site, which `journal.json` never holds: see [Marks shared by visitors](#marks-shared-by-visitors) |
| `status` | string | `confirmed`: a catalog knows the object and what it does. `unconfirmed`: no catalog we asked explains it. `synthetic`: a made-up body, see [the sixth target](#a-sixth-target-that-is-not-real) |
| `kind`, `method`, `confidence`, `significance` | as in a candidate | What the service found, copied from [the candidate](#candidates) |
| `ra`, `dec`, `epoch` | numbers | Place of the candidate and its date |
| `target` | object | What opens the tool on the finding: `ra`, `dec`, `epoch`, `pm_ra`, `pm_dec`, the parameters of `exposures`. For an object that is not the one its field was chosen for, it is the candidate itself, with the motion measured |
| `preset` | string or null | Key of the static files of the target, when it has some: open those instead of calling the service |
| `found` | string | What the service measured, in one sentence written from the candidate |
| `known` | string or null | What catalogs say of the object. `null` when `status` is `unconfirmed` |
| `measured` | string | Day of the measurement |

- **25 confirmed, 2 unconfirmed, 1 synthetic.** 16 moved, 11 changed, 1 swung: the made-up body, the only one of its kind.
- **Unconfirmed is not a discovery.** It means that SIMBAD, the AAVSO index and the variables of Gaia DR3 hold nothing at that place that explains the change. It is something for a visitor to look at.
- **Every number comes from the service.** A static target is read from its candidates file. Any other field is measured through the archive, by the code that answers `candidates`. What catalogs say is written by hand in `backend/src/spherex_explorer/journal.py`, from the checks of [How it was checked](#how-it-was-checked).
- **To open an entry:** with a `preset`, load the static files of that key. Without one, pass `target` to `exposures`, `frames` and `candidates` as for any position: the candidates take 20 to 35 seconds the first time.
- A synthetic entry must be shown as synthetic, in the list as on the page it opens.
- `python -m spherex_explorer.precompute --output samples --journal` builds it again: about eight minutes, for the twenty fields that have no static files.

### Marks shared by visitors

The second half of the journal is written by the visitors. Someone pauses the film on something odd, frames it, and shares it in one click. The others see it in the list and open the tool there.

A mark is **a place, a category and the view it was made in**. It holds no text a visitor wrote, no name and no address: there is nothing in it to moderate, and nothing that tells who made it. It is **not a claim of the service**: nothing was measured. The field is measured when someone opens the mark, by `candidates`, like any other field.

#### `GET /api/journal`

```json
{
  "open": true,
  "limit": 300,
  "per_hour": 5,
  "entries": [
    {
      "id": "v-3f9a1c20b7",
      "name": "Mark at 13h20m02.4s +30d00m36s",
      "source": "visitor",
      "status": "unconfirmed",
      "kind": null, "method": null, "confidence": null, "significance": null,
      "ra": 200.01, "dec": 30.01, "epoch": null,
      "target": { "ra": 200.0, "dec": 30.0, "epoch": 2000.0, "pm_ra": 0.0, "pm_dec": 0.0 },
      "preset": null,
      "found": null, "known": null, "measured": null,
      "category": "moved",
      "view": { "detector": 5, "pass": 2, "frame": "dr1.2025W34_2B_0090_4D2.l2b-v27-2026-229" },
      "shared": "2026-11-15T03:04:05Z"
    }
  ]
}
```

- `entries`: the marks, the newest first. Each has the sixteen fields of an entry of `journal.json`, so one list shows both, and three more: `category`, `view`, `shared`.
- What the service would say is `null`: `kind`, `method`, `confidence`, `significance`, `epoch`, `found`, `known`, `measured`. Write "Shared by a visitor, not measured yet", never a sentence that sounds like a finding.
- `status` is `unconfirmed`, or `synthetic` when the mark was made in the synthetic field. The second must be shown as synthetic.
- `open`: `false` when the journal takes no new mark, because it was closed or because it is full. Hide or disable the button then.
- The answer may be kept 20 seconds. A mark shared from another machine appears within that time.

#### `POST /api/journal`

The body is JSON:

| Field | Type | Meaning |
| --- | --- | --- |
| `ra`, `dec` | number | The framed place, in degrees: the center of the frame the visitor drew |
| `category` | string | `moved`, `changed`, `appears-once` or `other`. Chosen in a list: there is no free text |
| `target` | object | The target of the view, as the other calls take it: `ra`, `dec`, and `epoch`, `pm_ra`, `pm_dec` when it has them |
| `preset` | string, optional | Key of the static target, when the view is one |
| `detector` | 1 to 6, optional | Detector shown when the mark was made |
| `pass` | integer, optional | Visit shown when the mark was made |
| `frame` | string, optional | `id` of the exposure the film was paused on |

- `201` and the mark, as `GET` lists it. Add it to the list at once: there is no need to read the journal again.
- `200` and the **existing** mark when the same category was already marked within 10 arcseconds: the journal keeps one mark of a place. Tell the visitor it was already shared, and show that mark.
- Anything else in the body is refused: an unknown field, a category out of the list, a `preset` that is not a static target, a `frame` that is not an exposure, a place outside the view of its target (more than 0.36 degree away).

| Status | `code` | When | What the browser does |
| --- | --- | --- | --- |
| 422 | `invalid_request` | The body is not a mark | A bug of the caller |
| 429 | `too_many_marks` | The visitor shared 5 marks within the hour | Say so. `Retry-After` gives the seconds to wait |
| 409 | `journal_full` | The journal holds its 300 marks | Say so, hide the button |
| 503 | `journal_closed` | The journal was closed to new marks | Say so, hide the button |
| 503 | `upstream_unavailable` | The store did not answer | Retry after `Retry-After`, once |

What keeps the journal clean:

- **Nothing to write.** No field of a mark is text of the visitor. The name is built from the place.
- **Five marks an hour for each visitor.** The service counts them against a digest of the address of the request, kept in memory for the hour and written nowhere.
- **One mark for one place,** and 300 marks in all.
- **A switch.** `SPX_JOURNAL_OPEN: "false"` closes the journal to new marks: the list stays readable.
- **What is stored** is the mark as shown above, in a Firestore database of the project, and nothing else. Removing one is deleting its document.

## Errors

An error is an HTTP status and this body:

```json
{ "error": { "code": "not_found", "message": "No object is known under this name." } }
```

`code` is stable and meant for the program. `message` is in English and meant for developers and logs: the interface writes its own texts from `code`.

| Status | `code` | When | What the browser does |
| --- | --- | --- | --- |
| 404 | `not_found` | The name is unknown, or the archive has no such exposure | Tell the user, do not retry |
| 422 | `invalid_request` | A parameter or an identifier is missing or invalid. The message names it: `ra is required; dec should be less than or equal to 90` | Fix the request. It is a bug of the caller |
| 503 | `upstream_unavailable` | IRSA, the SPHEREx storage or the CDS, for names and catalogs, did not answer, or the field of `candidates` is still being measured | Wait for the number of seconds of the `Retry-After` header and retry, three times at most. For `candidates`, six times |
| 500 | `internal_error` | A bug of the service. Details stay in its logs | Tell the user, do not retry |
| 409, 429, 503 | `journal_full`, `too_many_marks`, `journal_closed` | Sharing a mark only: see [Marks shared by visitors](#marks-shared-by-visitors) | Say so |
| Other | `http_error` | An error raised by the framework, for example an unknown route | Treat as a bug |

One frame that fails does not fail the view: show the others.

## Loading and caching

- Ask for frames in parallel, 8 at a time, and show each one as soon as it arrives.
- A frame weighs 66 kB, and 31 kB once compressed in transit. The 62 frames of the default view of one detector weigh 4.1 MB, 1.9 MB compressed.
- The service sets `Cache-Control`, and the cache of the browser does the rest. No cache logic is needed in the application.

| Call | Cache |
| --- | --- |
| `health` | None |
| `resolve` | 1 day |
| `exposures` | 1 hour, because new exposures are published |
| `spectrum` | 1 hour, for the same reason |
| `candidates` | 1 hour, for the same reason |
| `catalog` | 1 day |
| `frames` | 1 day while the pipeline still changes, much longer once it is frozen |

## Stable and provisional

Stable, safe to build on: the calls, the names of the parameters and of the fields, the units, the orientation, the two encodings, the error body and its codes.

The candidates are new. The names of their fields are stable. Their thresholds, their limits and the kinds of candidates can still change. The kind `swung`, the field `swing` and `limits.swing_distance_au` were added on November 14, 2026: a client that does not know them can ignore them.

Provisional, the values can change but not the shape:

- The constants of the photometry: the share of the light inside the circle for each detector, and the two scatter terms of the uncertainty. The method is final since step B4.
- The list of flags that turn a pixel into NaN.
- The estimate of `background`. The SPHEREx files carry a model of the zodiacal light that may replace the median.
- The limits of `fov` and `size`, the cache durations and the number of parallel requests.
- The search radius of `exposures`, and its limit of 5000 exposures per answer. Nothing tells the client today that a list was cut. The deepest fields, near the ecliptic poles, are the only places that could reach it.

`GET /api/catalog` is new too. Its fields are stable. Its `limit` and the list of catalogs can change: read `catalogs` as a list, and ignore a `key` you do not know.

## Choices made at step S1

Each one can be reopened by a pull request on this file.

1. **Pixels in base64 inside the JSON.** One request gives a complete frame, and a bundle is a single readable file. Base64 adds a third to the size, and compression in transit takes most of it back.
2. **16-bit floats.** Half the size of 32 bits for an error far below the noise.
3. **A default view of 0.1 degree on 128 pixels.** 2.8 arcseconds per pixel, 2.2 times finer than SPHEREx, so that a shift of a fraction of a SPHEREx pixel stays visible. 62 frames fit in 4.1 MB.
4. **Flags next to the pixels, not applied to them.** A saturated star must stay visible in the viewer, and the same star must be skipped in a stack. Only the browser knows which case it is in.
5. **`pass`, `detector` and `collection` live in the list of exposures only.** A frame is computed from one file and does not know the other exposures. The browser joins the two by `id`.
6. **The target and the grid are two objects.** The image stays fixed on the sky so that motion is visible, while the measurement follows the object.

## How it was checked

On the sample, generated from the public SPHEREx files on November 14, 2026:

| Check | Result |
| --- | --- |
| Identifiers | The 364 file addresses of the archive are rebuilt exactly from the identifiers, including one whose version name has another shape (`l2b_retry-v27-2026-230`) |
| Orientation | Five 2MASS stars of the field are found within 0.53 pixel of where `skyToPixel` puts them. The mirrored places, east and west swapped, are empty: 0.03 MJy/sr against 22.7 |
| Motion | Between the first and the last pass, the predicted shift of Barnard's Star is 0.28 pixel in x and -3.64 in y, north. The saturated core moves by 0.79 and -3.30 |
| Formulas | `target_xy` recomputed with the TypeScript functions above matches the file within 0.005 pixel on the 62 frames |
| Dates | The frame dates are within 0.06 second of the archive index |
| Precision | 16 bits against 32 bits: at most 0.7% of the noise on sky pixels |

The flux, checked at step B4 on stars of known brightness:

| Check | Result |
| --- | --- |
| Scale | 8 steady stars of K magnitude 9.3 to 11.2, in three fields, 1,967 clean exposures. Compared with 2MASS (J, H, Ks) and AllWISE (W1, W2) in 38 pairs of star and band: the median of measured over catalog is 0.998, against 0.982 before the correction. 33 pairs of 38 are within 5 percent, all within 9 |
| Band by band | J 0.98, H 1.01, Ks 1.02, W1 1.00, W2 1.00 |
| Scatter between exposures | 1 to 3 percent for a steady star, where the variance of the file alone predicts 0.3 to 1 percent. Hence the 2 percent term of `error_mjy` |
| Near saturation | A star of about 1 Jy whose pixels all carry `OVERFLOW`: 2 to 5 percent above 2MASS, with 4 to 5 percent of scatter between exposures. Hence the 5 percent term |
| Against a published library | SPIFF (Gagné et al. 2026) holds spectra of brown dwarfs measured on the SPHEREx images by another team and another way: a fit of the image of a star, on the QR2 release, where this service adds up the light in a circle, on DR1 and QR3. Three objects are in both: Epsilon Indi B, Luhman 16, which the library lists as Luhman 16 A and SPHEREx does not separate, and LP 944-20. Over 297 bands from 0.74 to 5 micrometers, the median of ours over theirs is 1.016, 1.011 to 1.020 by object. Three bands in four agree within 5 percent, nine in ten within 10. By detector and by object the median stays between 0.98 and 1.06 |
| Where the two differ | Seven bands of the 297 differ by more than 20 percent. Three are bands of Epsilon Indi B at the ends of detectors, where it is faintest. Four are bands of Luhman 16 from 3.85 to 3.95 micrometers: there the library drops to a fifth of its neighbors, and our spectrum stays smooth and the same over the three visits |
| PSF model | The same in files of 2025 and 2026 and in both data releases, for the three detectors compared. Its share inside the circle varies by less than 0.01 across a detector |

The candidates, checked on November 14, 2026 on the frames of 74 fields: 58 for the sources, and 16 more for the halo of saturated stars. The detection is never told where to look. Rates are in arcseconds per year, parallaxes in arcseconds, and the catalog values are those of SIMBAD.

| Field | Result | Measured | Catalog |
| --- | --- | --- | --- |
| Barnard's Star | `moved`, high | 10.5 ± 0.9 | 10.39 |
| Epsilon Indi B | `moved`, high | 4.63 ± 0.06, parallax 0.30 ± 0.04 | 4.68, 0.271 |
| WISE 0855 | `moved`, medium, detectors 5 and 6 | 7.5 ± 0.9 | 8.15 |
| RW Aurigae | `changed`, high | Half as bright from 3.8 to 5 micrometers, 1.3 to 1.4 times brighter under 1.6 | A T Tauri star known for its deep fadings |
| R Draconis | `changed`, medium, read on its halo: it saturates the six detectors | Halo at 0.45 of its brightness from 4.4 to 5 micrometers between June 2025 and June 2026, at 0.56 from 2.4 to 3.8 | A Mira variable of 246 days in the AAVSO index: just past its maximum at the first visit, near its minimum at the last |
| Teegarden's Star | `moved`, high | 4.92 ± 0.14, parallax 0.25 ± 0.05 | 5.12, 0.261 |
| Luhman 16 | `moved`, high | 2.84 ± 0.09, parallax 0.47 ± 0.04 | 2.79, 0.502 |
| SCR J1845-6357 | `moved`, high | 2.58 ± 0.10, parallax 0.25 ± 0.04 | 2.65, 0.250 |
| Wolf 359 | `moved`, medium | 4.84 ± 0.51 | 4.72 |
| DENIS J0255-4700 | `moved`, high | 1.10 ± 0.08, parallax 0.21 ± 0.04 | 1.15, 0.205 |
| Kapteyn's Star | `moved`, high, detectors 5 and 6 | 8.8 ± 0.9 | 8.64 |
| van Maanen's Star | `moved`, high | 2.97 ± 0.09, parallax 0.22 ± 0.04 | 2.98, 0.232 |
| TRAPPIST-1 | `moved`, high | 1.04 ± 0.08 | 1.05 |
| LHS 292 | `moved`, high | 1.88 ± 0.18 | 1.64 |
| Proxima Centauri | `moved`, medium, detectors 5 and 6 | 4.4 ± 0.9 | 3.86 |
| Ross 128 | Missed: it nears saturation and moves by 1.4 arcsecond only | | 1.37 |
| YZ Ceti | `moved`, medium | 1.62 ± 0.27 | 1.36 |
| GJ 1002 | `moved`, high, 2.6 arcminutes from where the name resolver put it | 2.05 ± 0.14, parallax 0.20 ± 0.06 | 2.06, 0.206 |
| EZ Aquarii | `moved`, medium | 3.7 ± 0.7 | 3.26 |
| GJ 1061 and LP 944-20 | Not claimed, as designed: they move by less than 1 arcsecond in the data | | 0.83 and 0.41 |
| 32 quiet fields far from the Milky Way, 831 sources | No candidate | | |
| Orion Nebula | No candidate, five saturated stars listed | | |
| A place of the Milky Way taken at random (280.0, 0.0) | One `changed`, high, in five detectors | 0.2 arcsecond from IRAS 18372-0002 | A long-period variable: 354 days in the AAVSO index, and one of the variables of Gaia DR3 |
| Toward the center of the Milky Way (270.0, -25.0) | Three `changed`, high, in three or four detectors each | One is 0.6 arcsecond from a long-period variable of Gaia DR3 | The two others are in none of the three catalogs asked: unconfirmed |
| Two other places of the Milky Way | No candidate | | |
| S Coronae Borealis, R Bootis, R Canum Venaticorum, T Herculis, U Ursae Minoris | `changed`, read on their halo: they saturate the six detectors | Between two visits, 1.4 to 2.8 times brighter or fainter from 2.4 to 5 micrometers, and up to 11 times under 1.1 | Mira variables of the AAVSO index. Each change goes the way the period and the date of maximum of the index predict |
| R Ursae Majoris, R Trianguli, V Coronae Borealis | Not claimed. Their halo changes by a quarter to a half, under the rule | | Mira variables of the AAVSO index |
| Eta, Xi, Iota and Epsilon Draconis, Epsilon Virginis, Kappa Ophiuchi, Mu Leonis, Psi Ursae Majoris | No candidate. They saturate the six detectors | | Giants of type G7 to K2, steady to a few hundredths of a magnitude where the AAVSO index gives a range |

- **A fast star that saturates some detectors is followed in the others, wherever it is in the view.** Barnard's Star saturates detectors 1 to 4 and moves two pixels of the default view between visits. Where a star saturates, the peaks left around its heart are pieces of the ring of its halo: they are not taken for sources. Before this rule, one of them split the three places of Barnard's Star between two sources when the view was centered 14 arcseconds away, and nothing was claimed. Asked for the place a visitor would click on the sky map, with no name and no proper motion, `candidates` now finds it (10.5 arcseconds per year, 12 sigma), as it finds Epsilon Indi B, WISE 0855, RW Aurigae and R Draconis.
- **16 of the 17 stars that move by more than 1 arcsecond were found,** each with a rate within two sigma of its catalog. The seven parallaxes measured are within one sigma of theirs. They are a twelfth to a thirtieth of a SPHEREx pixel.
- **How these numbers were reached matters as much as the numbers.** The method was built on the first 18 fields. It was then run on 19 fresh ones: it found five of six moving stars, and raised two false alarms of medium confidence. Three rules came out of it: a position needs a source seen at 4 sigma, a path that cannot be checked needs twice the evidence, and a bad fit is one that chance does not explain.
- **One round was blind.** 21 more fields were chosen before the run and run once. The three stars that move by more than 1 arcsecond were found, the two slower ones were left alone, and 15 quiet fields of 16 gave nothing. The sixteenth gave one false alarm, of high confidence: a source cut by the edge of the view. Positions that close to the edge are now refused.
- With that last rule, the 58 fields give the table above and no false alarm among 1,394 sources. That count is not blind: the rule came from the blind round.
- **The halo of saturated stars had its own blind round.** The method was set on the saturated stars of the 58 fields: R Draconis, and seven stars that are not known to change much. Then 16 stars that saturate the six detectors were chosen before the run and run once: the last three rows of the table. Five of the eight variables were flagged, and none of the eight giants. The three variables left out do change, the way their period predicts for two of them, but pass the rule in one detector at most. Nothing was changed after that round.
- **A halo and a direct measurement agree.** IRAS 18372-0002, the variable of the Milky Way field above, saturates detector 4 alone. Between its second and third visits its halo there fades to 0.69 ± 0.12 of its brightness. Measured directly in detectors 5 and 6, the star fades to 0.75 and to 0.63.

The faintest object the detection finds, measured on November 14, 2026 by adding stars to real frames. In each of the 32 quiet fields a made-up star was added to every frame, at the place its motion gives at the time of the frame, and the detection was run as the service runs it. One star at a time, 80 runs per field, 2,560 in all. The table counts the fields, out of 32, where the star came out as a `moved` candidate:

| Flux of the star, millijansky | Seen by the six detectors, at 1.5, 3 and 8 arcseconds per year | Seen by detectors 5 and 6 only, at the same speeds |
| --- | --- | --- |
| 0.03 | 0, 0, 0 | 0, 0, 0 |
| 0.05 | 0, 1, 1 | 0, 0, 0 |
| 0.1 | 1, 5, 10 | 0, 0, 0 |
| 0.2 | 12, 19, 24 | 0, 1, 8 |
| 0.3 | 25, 28, 28 | 0, 3, 17 |
| 0.5 | 21, 26, 28 | 2, 12, 25 |
| 1 | 25, 29, 32 | 12, 25, 32 |
| 2 | 28, 29, 30 | 20, 28, 28 |
| 5 | 30, 32, 31 | 25, 28, 31 |
| 20 | 30, 32, 31 | 27, 32, 32 |

- **A star seen by the six detectors is found from 0.2 to 0.3 millijansky,** magnitude 18.2 to 17.7 in the AB system. A star seen by detectors 5 and 6 only has the stated flux in detector 6, three tenths of it in detector 5 and nothing under 3.8 micrometers: the color of a cold brown dwarf. It needs 0.5 to 1 millijansky. WISE 0855 is that kind of object, about 0.5 millijansky beyond 4.5 micrometers and 8.15 arcseconds per year, and it is found, at medium confidence.
- **No star that did not move was claimed.** A fourth of the runs, 640, added a star that stays where it is. None came out as a candidate, of either kind. Before any star was added, the 32 fields gave no candidate.
- **The speeds are right, their uncertainties a little short.** Over the 976 stars found, the median of the speed found minus the true one is -0.02 arcsecond per year, and half are within 0.1. The true speed is within two stated sigma for 85 percent of them and within three for 92 percent, where 95 and 99.7 would be exact. The ones far off sit beside a real star.
- **Why a bright star is sometimes missed.** Two of the 32 fields have two visits only, half a year apart: at 1.5 arcseconds per year a star moves by 0.8 arcsecond there, under the rule of 1 arcsecond. The others fell beside a real star of the field, where a position is refused.
- **A near neighbor can mislead, about once in 200.** In 12 runs a candidate came out elsewhere than on the added star, once with a star that did not move. The two cases looked at are a real star of the field, 5 and 9 pixels of the view from the added one, whose measured position the added star disturbed.
- **What this test does not say.** The added star is round, with the width real stars have in each detector, 9 to 10.5 arcseconds at half height on the grid of the view. It has one flux across a detector and a straight path, without parallax. The fields are quiet ones, far from the Milky Way. A real object in a crowded field does worse.

A body that swings with the seasons, checked on November 14, 2026. None is known, so the check has two halves.

- **Nothing in the real sky.** The 74 fields kept for tests were searched as they are: the 32 quiet fields, the fields of the nearby stars that move, those of the Milky Way, the saturated stars and the five test targets. None gives a `swung` candidate.
- **Made-up bodies in real frames.** In each of the 32 quiet fields a body was added to every frame, at the place its distance and its own motion give at the date of the frame. One body at a time, 42 per field, 1,344 in all. Each moves as a body on a round orbit at its distance would, from 0.3 to 1.2 times as fast, in a direction drawn at random. The table counts the fields, out of 32, where the body came out as a `swung` candidate:

| Body, and its distance in astronomical units | 2,000 | 3,000 | 5,000 | 8,000 | 12,000 | 18,000 | 25,000 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Six detectors, 0.1 millijansky | 2 | 2 | 5 | 6 | 6 | 6 | 3 |
| Six detectors, 0.3 | 19 | 18 | 19 | 17 | 18 | 19 | 16 |
| Six detectors, 1 | 23 | 27 | 25 | 25 | 28 | 24 | 24 |
| Detectors 5 and 6, 0.5 | 7 | 7 | 6 | 4 | 10 | 5 | 8 |
| Detectors 5 and 6, 1 | 18 | 21 | 18 | 19 | 25 | 19 | 15 |
| Detectors 5 and 6, 3 | 26 | 19 | 23 | 22 | 24 | 22 | 24 |

- **A bright body is found about three times in four:** 79 percent of those of 1 millijansky in the six detectors, 71 percent of the cold ones of 3 millijanskys, at any distance from 2,000 to 25,000 astronomical units. At a third of those fluxes, 56 and 60 percent. Fainter still, 13 and 21 percent.
- **The distance is right.** Over the 674 bodies found, half of the distances are within 0.8 percent of the true one, and nine in ten within 4.6 percent. The true distance is inside the stated range for 78 percent of them, where 68 would be exact. The own motion found is within two stated sigma of the true one for 97 percent of the bodies seen in three visits or more.
- **Why a bright body is missed.** A visit that lacks a detector, or that lasts two months: the body then crosses tens of pixels during the visit and leaves the view. A star at one of its places, where the sky cannot be found empty. Two visits only, where twice the evidence is asked.
- **A second body beside a real one: 11 runs of 1,344.** With nothing hidden no field gives a body. With one hidden, its light and a source of the field can line up as a second, fainter body elsewhere. A body that shares a place with a surer one is dropped, which removes most of them.
- **What this test does not say.** The bodies are round, with one flux across a detector, and they are the ones the search was built for. The fields are quiet ones. No body of the real sky was there to check the search against.

The catalogs, checked on November 14, 2026 against the candidates of the five test targets. Each source of Gaia DR3 is moved from 2016 to the date of the candidate with its own motion:

| Target | The nearest source of Gaia DR3, at the date of the candidate | The nearest source of AllWISE, where it was in 2010 |
| --- | --- | --- |
| Barnard's Star | 0.2 arcsecond away: the star itself, 106 arcseconds from where Gaia saw it | 17 arcseconds: a faint neighbor. The star is 2.7 arcminutes south, where it was then |
| Epsilon Indi B | 0.6 arcsecond: the brown dwarf, of magnitude 18 for Gaia | 11 arcseconds: another source. The pair has moved by 72 arcseconds since |
| WISE 0855 | 6.3 arcseconds: a star of the background. Gaia does not hold the object itself | The same star of the background. The object is J085510.74-071442.5, 126 arcseconds away to the east: 2.5 magnitudes brighter at 4.6 micrometers than at 3.4, the color of a cold object |
| RW Aurigae | 0.7 and 0.9 arcsecond: the two stars of the pair | 0.6 arcsecond |
| R Draconis | 0.6 arcsecond | 0.5 arcsecond |

Where Gaia holds the object, the place measured on the SPHEREx frames and the place Gaia predicts agree within a tenth of a SPHEREx pixel. And from where WISE saw WISE 0855 in 2010 to where the candidates file puts it in 2025, the object covered 126 arcseconds in 15.3 years: 8.2 arcseconds per year toward 275 degrees, for 8.15 toward 275 in the catalog.

`node samples/check-sample.ts samples/barnard-star-d2.json --bright-star` replays the checks that need no network. `node samples/check-sample.ts samples/index.json` checks every file of the index.
