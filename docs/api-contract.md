# API contract

The agreement between the Python service (`backend/`) and the browser (`frontend/`). The browser can be built against it before the service exists: a real file in the final format is in [`samples/`](../samples/README.md).

- **Version:** 1, written at step S1 of the [architecture plan](architecture.md).
- **Changes:** through a pull request approved by the other teammate.
- **Compatibility:** fields can be added at any time, so a client ignores the fields it does not know. Renaming or removing a field changes `version`.
- **Status:** the service answers `GET /api/health`, `GET /api/exposures` and `GET /api/frames/{id}` today. `GET /api/resolve` arrives with step B5 and will follow this document.

## The idea in one minute

The browser asks three questions, in this order:

1. **Where is this object?** `GET /api/resolve` turns a name into a position. Skipped when the user types coordinates.
2. **What did SPHEREx see there?** `GET /api/exposures` lists the exposures that cover the position, and gives the grid that every image of the view shares.
3. **Show me this exposure.** `GET /api/frames/{id}` returns one frame: the image cut out and aligned on the grid, with its date, its wavelength and its measurement.

The five test targets skip questions 2 and 3: a static file, the [bundle](#the-bundle), holds both answers in the same format.

| Call | Returns | Expected time |
| --- | --- | --- |
| `GET /api/health` | Service status | Immediate |
| `GET /api/resolve?name=` | A target | 1.5 s |
| `GET /api/exposures?ra=&dec=` | A target, a grid and a list of exposures | 1.5 s, 3 s for a moving target |
| `GET /api/frames/{id}?ra=&dec=` | One frame | 0.6 s |

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

`name` is the name that was asked. An unknown name is a `not_found` error.

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
  "background": 0.4371,
  "noise": 0.1643,
  "valid_fraction": 0.99,
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
| 2 | `OVERFLOW` | Saturated pixel |
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
| `flagged` | Yes | At least one pixel of the measurement carries a flag. Show the point with a warning |
| `masked` | No | A pixel of the measurement has no data |
| `saturated` | No | The object is too bright for SPHEREx in this exposure |
| `outside` | No | The target is off the detector or too close to its edge |

Barnard's Star saturates in every frame of detector 2, so the sample holds no flux value. A sample with real values comes with step B4, on an unsaturated star.

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

The sample, [`samples/barnard-star-d2.json`](../samples/barnard-star-d2.json), holds detector 2 only: 62 of the 364 exposures of the star. How the six detectors of a target are split into files is decided at step B6.

## Errors

An error is an HTTP status and this body:

```json
{ "error": { "code": "not_found", "message": "No object is known under this name." } }
```

`code` is stable and meant for the program. `message` is in English and meant for developers and logs: the interface writes its own texts from `code`.

| Status | `code` | When | What the browser does |
| --- | --- | --- | --- |
| 404 | `not_found` | The name is unknown, or the archive has no such exposure | Tell the user, do not retry |
| 422 | `invalid_request` | A parameter or an identifier is missing or invalid | Fix the request. It is a bug of the caller |
| 503 | `upstream_unavailable` | IRSA, the SPHEREx storage or the CDS did not answer | Wait for the number of seconds of the `Retry-After` header and retry, three times at most |
| 500 | `internal_error` | A bug of the service. Details stay in its logs | Tell the user, do not retry |
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
| `frames` | 1 day while the pipeline still changes, much longer once it is frozen |

## Stable and provisional

Stable, safe to build on: the calls, the names of the parameters and of the fields, the units, the orientation, the two encodings, the error body and its codes.

Provisional, the values can change but not the shape:

- The photometry method. Today: a circular aperture of 2.5 SPHEREx pixels in radius (15.4 arcseconds), a sky ring from 5 to 8 pixels, the uncertainty from the variance plane of the file, no aperture correction. The service applies it since step B3. It is checked on an unsaturated star and finalized at step B4.
- The list of flags that turn a pixel into NaN.
- The estimate of `background`. The SPHEREx files carry a model of the zodiacal light that may replace the median. The sample file was made by a prototype that took its median from slightly different pixels: its `background` and `noise` differ from those of the service by 2 to 3 percent, until the sample is rebuilt at step B6.
- The limits of `fov` and `size`, the cache durations and the number of parallel requests.
- The search radius of `exposures`, and its limit of 5000 exposures per answer. Nothing tells the client today that a list was cut. The deepest fields, near the ecliptic poles, are the only places that could reach it.

Planned after the MVP: `GET /api/catalog`, the Gaia sources of the view moved to a given date.

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

`node samples/check-sample.ts samples/barnard-star-d2.json` replays the checks that need no network.
