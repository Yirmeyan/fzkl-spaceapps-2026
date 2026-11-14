// Checks a bundle, a spectrum file, a candidates file, or the index and every file it lists,
// against docs/api-contract.md.
// The helpers below are the ones printed in the contract, so this script also tests them.
// Usage (Node 24, no dependency):
//   node samples/check-sample.ts samples/index.json
//   node samples/check-sample.ts samples/barnard-star-d2.json --bright-star
// --bright-star adds two checks that only hold for a star bright enough to saturate the
// detector: it shows in every frame, and its saturated core moves as its proper motion says.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
const OVERFLOW = 2;

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

function targetAt(target: Target, timeMjd: number): [number, number] {
  const years = (timeMjd - 51544.5) / 365.25 - (target.epoch - 2000);
  const dec = target.dec + ((target.pm_dec ?? 0) * years) / 3.6e6;
  const ra = target.ra + ((target.pm_ra ?? 0) * years) / 3.6e6 / Math.cos(target.dec * DEG);
  return [ra, dec];
}

function mjdToDate(mjd: number): Date {
  return new Date((mjd - 40587) * 86400000);
}

const ID_PATTERN =
  /^(dr|qr)[0-9]+\.[0-9]{4}W[0-9]{2}_[0-9][A-Z]_[0-9]{4}_[0-9]D[1-6]\.[a-z0-9_]+-v[0-9]+-[0-9]{4}-[0-9]{3}$/;
const EXPOSURE_KEYS = ["id", "collection", "detector", "pass", "time_mjd", "time_iso"];
const FRAME_KEYS = [
  "id",
  "time_mjd",
  "time_iso",
  "exposure_s",
  "wavelength_um",
  "bandwidth_um",
  "background",
  "noise",
  "valid_fraction",
  "target_xy",
  "photometry",
  "image",
  "mask",
];
const QUALITIES = ["ok", "flagged", "masked", "saturated", "outside"];

const BUNDLE_FORMAT = "spherex-explorer/bundle";
const INDEX_FORMAT = "spherex-explorer/index";
const SPECTRUM_FORMAT = "spherex-explorer/spectrum";
const POINT_KEYS = ["id", "detector", "pass", "time_mjd", "time_iso", "wavelength_um", "bandwidth_um", "flux_mjy", "error_mjy", "quality"];
const WITHOUT_VALUE = ["masked", "saturated", "outside"];
const CANDIDATES_FORMAT = "spherex-explorer/candidates";
const CATALOG_FORMAT = "spherex-explorer/catalog";
const CATALOG_FILE_KEYS = ["format", "version", "generated", "view", "epoch", "catalogs"];
const VIEW_KEYS = ["ra", "dec", "fov_deg"];
const CATALOG_KEYS = ["key", "name", "epoch", "band", "limit", "truncated", "sources"];
const SOURCE_KEYS = ["id", "ra", "dec", "pm_ra", "pm_dec", "parallax_mas", "mags"];
const CANDIDATES_KEYS = ["format", "version", "generated", "target", "grid", "frames", "sources", "visits", "limits", "saturated", "candidates"];
const CANDIDATE_KEYS = ["kind", "method", "confidence", "significance", "is_target", "ra", "dec", "epoch", "xy", "detectors", "track", "motion", "changes"];
const SIGHTING_KEYS = ["pass", "time_mjd", "time_iso", "ra", "dec", "xy", "error_arcsec", "detectors"];
const MOTION_KEYS = [
  "shift_arcsec",
  "days",
  "rate_arcsec_per_year",
  "rate_error_arcsec_per_year",
  "angle_deg",
  "pm_ra",
  "pm_dec",
  "parallax_arcsec",
  "parallax_error_arcsec",
  "distance_ly",
  "distance_ly_range",
];
const CHANGE_KEYS = ["detector", "from_pass", "to_pass", "ratio", "error", "significance", "wavelength_um"];
const LIGHT_YEARS_AT_ONE_ARCSECOND = 3.2616;
const TARGET_KEYS = ["name", "ra", "dec", "epoch", "pm_ra", "pm_dec"];
const GRID_KEYS = ["ra", "dec", "fov_deg", "size"];

let problems = 0;
// Name of the file being checked, printed in front of its problems.
let context = "";
function check(condition: boolean, message: string): void {
  if (condition) return;
  problems++;
  console.log("PROBLEM:", context + message);
}

interface Measured {
  flux: number | null;
  quality: string;
  wavelength: number;
}

interface Summary {
  frames: number;
  detectors: number[];
  wavelengths: [number, number];
  measured: Map<string, Measured>;
  lines: string[];
}

function checkBundle(bundle: any, brightStar: boolean): Summary {
  const target: Target = bundle.target;
  const grid: Grid = bundle.grid;
  const exposures: any[] = bundle.exposures;
  const frames: any[] = bundle.frames;
  const size = grid.size;
  const center = (size - 1) / 2;

  check(bundle.format === BUNDLE_FORMAT && bundle.version === 1, "format or version");
  check(exposures.length === frames.length, "every exposure of the file must have its frame");
  check(frames.length > 0, "the file holds no frame");

  let worstTarget = 0;
  let worstValid = 0;
  let worstDate = 0;
  let targetSeen = 0;
  let targetOnDetector = 0;
  let previousTime = -Infinity;
  let shortest = Infinity;
  let longest = -Infinity;
  const detectors = new Set<number>();
  const measured = new Map<string, Measured>();
  const cores: { pass: number; x: number; y: number; predicted: [number, number] }[] = [];

  frames.forEach((frame, index) => {
    const exposure = exposures[index] ?? {};
    check(exposure.id === frame.id, `frame ${index} is not the frame of exposure ${index}`);
    check(ID_PATTERN.test(frame.id), `identifier ${frame.id}`);
    check(EXPOSURE_KEYS.every((key) => key in exposure), `fields of exposure ${index}`);
    check(FRAME_KEYS.every((key) => key in frame), `fields of frame ${index}`);
    check(QUALITIES.includes(frame.photometry.quality), `photometry quality of frame ${index}`);
    check(frame.time_mjd >= previousTime, "frames must be sorted by time");
    // The list takes its dates from the archive and the frame from the file itself: a rounding apart.
    check(Math.abs(exposure.time_mjd - frame.time_mjd) * 86400 <= 1, `date of frame ${index} differs from its exposure`);
    previousTime = frame.time_mjd;
    worstDate = Math.max(worstDate, Math.abs(mjdToDate(frame.time_mjd).getTime() - Date.parse(frame.time_iso)));
    detectors.add(exposure.detector);
    measured.set(frame.id, { flux: frame.photometry.flux_mjy, quality: frame.photometry.quality, wavelength: frame.wavelength_um });
    check((frame.photometry.flux_mjy === null) === WITHOUT_VALUE.includes(frame.photometry.quality), `frame ${index}: a flux goes with the qualities ok and flagged, and only with them`);
    shortest = Math.min(shortest, frame.wavelength_um);
    longest = Math.max(longest, frame.wavelength_um);

    const pixels = decodeImage(frame.image, size);
    const mask = decodeMask(frame.mask, size);

    let valid = 0;
    for (const value of pixels) if (!Number.isNaN(value)) valid++;
    worstValid = Math.max(worstValid, Math.abs(valid / pixels.length - frame.valid_fraction));

    const [ra, dec] = targetAt(target, frame.time_mjd);
    const [x, y] = skyToPixel(grid, ra, dec);
    worstTarget = Math.max(worstTarget, Math.abs(x - frame.target_xy[0]), Math.abs(y - frame.target_xy[1]));

    // A bright target is either a bright spot or a saturated core: NaN pixels that carry the OVERFLOW bit.
    let bright = false;
    let saturated = false;
    for (let yy = Math.round(y) - 3; yy <= Math.round(y) + 3; yy++) {
      for (let xx = Math.round(x) - 3; xx <= Math.round(x) + 3; xx++) {
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const i = yy * size + xx;
        if (Number.isNaN(pixels[i])) saturated ||= (mask[i] & OVERFLOW) !== 0;
        else bright ||= pixels[i] > frame.background + 100 * frame.noise;
      }
    }
    if (frame.photometry.quality !== "outside") {
      targetOnDetector++;
      if (bright || saturated) targetSeen++;
    }

    // Center of the saturated core, searched in a window fixed on the sky, not on the prediction.
    let n = 0;
    let sumX = 0;
    let sumY = 0;
    for (let yy = 0; yy < size; yy++) {
      for (let xx = 0; xx < size; xx++) {
        const i = yy * size + xx;
        if (Math.hypot(xx - center, yy - center) > 12) continue;
        if (!Number.isNaN(pixels[i]) || (mask[i] & OVERFLOW) === 0) continue;
        n++;
        sumX += xx;
        sumY += yy;
      }
    }
    if (n >= 5) cores.push({ pass: exposure.pass, x: sumX / n, y: sumY / n, predicted: [x, y] });
  });

  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const passes = [...new Set(cores.map((core) => core.pass))].sort((a, b) => a - b);
  const first = cores.filter((core) => core.pass === passes[0]);
  const last = cores.filter((core) => core.pass === passes[passes.length - 1]);
  let motion = "skipped: no saturated core seen in two passes";
  if (passes.length >= 2 && first.length >= 3 && last.length >= 3) {
    const predicted = [0, 1].map((k) => mean(last.map((c) => c.predicted[k])) - mean(first.map((c) => c.predicted[k])));
    const measured = [mean(last.map((c) => c.x)) - mean(first.map((c) => c.x)), mean(last.map((c) => c.y)) - mean(first.map((c) => c.y))];
    motion = `predicted ${predicted.map((v) => v.toFixed(2)).join(", ")} measured ${measured.map((v) => v.toFixed(2)).join(", ")}`;
    if (brightStar && Math.hypot(predicted[0], predicted[1]) > 2) {
      check(Math.hypot(measured[0] - predicted[0], measured[1] - predicted[1]) < 1.5, "the target does not move as predicted");
    }
  }

  const [backRa, backDec] = pixelToSky(grid, ...skyToPixel(grid, target.ra, target.dec));
  const roundTrip = Math.max(Math.abs(backRa - target.ra), Math.abs(backDec - target.dec)) * 3600;
  const north = (pixelToSky(grid, center, 0)[1] - grid.dec) * 3600;
  const east = (pixelToSky(grid, 0, center)[0] - grid.ra) * Math.cos(grid.dec * DEG) * 3600;

  check(worstTarget <= 0.011, "target_xy differs from targetAt and skyToPixel");
  check(worstValid <= 0.0006, "valid_fraction differs from the decoded pixels");
  check(worstDate <= 600, "time_iso differs from time_mjd");
  if (brightStar) check(targetSeen === targetOnDetector, "the target is not at target_xy");
  check(roundTrip < 1e-6, "skyToPixel and pixelToSky do not round trip");
  check(north > 0 && east > 0, "the first row must be north and the first column east");

  const day = (mjd: number) => mjdToDate(mjd).toISOString().slice(0, 10);
  const lines = frames.length === 0 ? [] : [
    `${frames.length} frames of ${size} x ${size} pixels, ${day(frames[0].time_mjd)} to ${day(frames[frames.length - 1].time_mjd)}`,
    `target_xy against the contract formulas: worst difference ${worstTarget.toFixed(4)} pixel`,
    `valid_fraction against the decoded pixels: worst difference ${worstValid.toFixed(5)}`,
    `time_iso against time_mjd: worst difference ${worstDate} ms`,
    `bright target found at target_xy in ${targetSeen} of the ${targetOnDetector} frames where it falls on the detector`,
    `motion in pixels between the first and the last pass (x, y): ${motion}`,
    `first row is ${north.toFixed(1)} arcsec north of the center, first column ${east.toFixed(1)} arcsec east`,
  ];
  return { frames: frames.length, detectors: [...detectors], wavelengths: [shortest, longest], measured, lines };
}

interface SpectrumSummary {
  points: number;
  withFlux: number;
  byId: Map<string, any>;
  lines: string[];
}

function checkSpectrum(spectrum: any): SpectrumSummary {
  const points: any[] = spectrum.points ?? [];
  check(spectrum.format === SPECTRUM_FORMAT && spectrum.version === 1, "format or version");
  check(Array.isArray(spectrum.points), "the file holds no list of points");
  const byId = new Map<string, any>();
  let previousTime = -Infinity;
  let worstDate = 0;
  let withFlux = 0;
  let shortest = Infinity;
  let longest = -Infinity;
  points.forEach((point, index) => {
    check(POINT_KEYS.every((key) => key in point), `fields of point ${index}`);
    check(ID_PATTERN.test(point.id), `identifier ${point.id}`);
    check(!byId.has(point.id), `point ${index} repeats an exposure`);
    byId.set(point.id, point);
    check(Number.isInteger(point.detector) && String(point.id).includes(`D${point.detector}.`), `detector of point ${index}`);
    check(Number.isInteger(point.pass) && point.pass >= 1, `pass of point ${index}`);
    check(QUALITIES.includes(point.quality), `quality of point ${index}`);
    check((point.flux_mjy === null) === WITHOUT_VALUE.includes(point.quality), `point ${index}: a flux goes with the qualities ok and flagged, and only with them`);
    check((point.error_mjy === null) === (point.flux_mjy === null), `point ${index}: a flux and its uncertainty come together`);
    check(point.error_mjy === null || point.error_mjy > 0, `uncertainty of point ${index}`);
    check(point.time_mjd >= previousTime, "points must be sorted by time");
    previousTime = point.time_mjd;
    worstDate = Math.max(worstDate, Math.abs(mjdToDate(point.time_mjd).getTime() - Date.parse(point.time_iso)));
    if (point.wavelength_um === null) {
      check(point.quality === "outside", `point ${index} has no wavelength although the target is on the detector`);
    } else {
      check(point.wavelength_um > 0.7 && point.wavelength_um < 5.2 && point.bandwidth_um > 0, `wavelength of point ${index}`);
      shortest = Math.min(shortest, point.wavelength_um);
      longest = Math.max(longest, point.wavelength_um);
    }
    if (point.flux_mjy !== null) withFlux++;
  });
  check(worstDate <= 600, "time_iso differs from time_mjd");
  const lines = [
    `${points.length} points, ${withFlux} with a flux`,
    `wavelengths from ${shortest} to ${longest} micrometers`,
    `time_iso against time_mjd: worst difference ${worstDate} ms`,
  ];
  return { points: points.length, withFlux, byId, lines };
}

interface CandidatesSummary {
  count: number;
  moved: number;
  changed: number;
  frames: number;
  lines: string[];
}

function sameKeys(value: any, keys: string[]): boolean {
  return value != null && JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
}

function isDetectorList(value: any): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((d: any) => Number.isInteger(d) && d >= 1 && d <= 6);
}

// A date given twice must be the same date, to the rounding of a second.
function sameMoment(dated: any): boolean {
  return Math.abs(mjdToDate(dated.time_mjd).getTime() - Date.parse(dated.time_iso)) <= 600;
}

// A place given twice, on the sky and on the grid, must be the same place.
function samePlace(grid: Grid, place: any): boolean {
  if (!Array.isArray(place?.xy) || typeof place.ra !== "number" || typeof place.dec !== "number") return false;
  const [x, y] = skyToPixel(grid, place.ra, place.dec);
  return Math.hypot(x - place.xy[0], y - place.xy[1]) <= 0.02;
}

function checkCandidates(file: any): CandidatesSummary {
  const lines: string[] = [];
  check(file.format === CANDIDATES_FORMAT && file.version === 1, "format or version");
  check(sameKeys(file, CANDIDATES_KEYS), "fields of the file");
  check(sameKeys(file.target, TARGET_KEYS), "fields of the target");
  check(sameKeys(file.grid, GRID_KEYS), "fields of the grid");
  const grid: Grid = file.grid;
  const arcsec = (grid.fov_deg / grid.size) * 3600;
  const visits: any[] = file.visits ?? [];
  const limits = file.limits ?? {};
  check(Number.isInteger(file.frames) && file.frames >= 0 && Number.isInteger(file.sources) && file.sources >= 0, "counts of frames and sources");
  check(
    visits.every((visit, i) => Number.isInteger(visit.pass) && (i === 0 || visit.pass > visits[i - 1].pass) && visit.frames > 0),
    "visits are numbered in order and hold frames",
  );
  check(visits.reduce((sum, visit) => sum + visit.frames, 0) === file.frames, "frames of the visits add up to the frames measured");
  check(
    visits.every((visit) => sameMoment(visit)),
    "time_iso of a visit differs from its time_mjd",
  );
  check(limits.significance >= 5 && limits.shift_arcsec > 0 && limits.change > 0, "limits of the claims");
  const passes = new Set(visits.map((visit) => visit.pass));

  for (const star of file.saturated ?? []) {
    check(samePlace(grid, star) && star.radius_arcsec > 0 && isDetectorList(star.detectors), "a saturated star is ill described");
  }

  let moved = 0;
  const candidates: any[] = file.candidates ?? [];
  check(
    candidates.every((candidate, i) => i === 0 || candidate.significance <= candidates[i - 1].significance),
    "candidates are not sorted, the surest first",
  );
  for (const candidate of candidates) {
    const where = `candidate at ${candidate.xy}: `;
    check(sameKeys(candidate, CANDIDATE_KEYS), where + "fields");
    check(["moved", "changed"].includes(candidate.kind), where + "kind");
    check(["source", "halo"].includes(candidate.method), where + "method");
    check(["high", "medium"].includes(candidate.confidence), where + "confidence");
    check(candidate.significance >= limits.significance, where + "significance under the limit");
    check(typeof candidate.is_target === "boolean", where + "is_target");
    check(samePlace(grid, candidate), where + "ra and dec do not match xy");
    const dates = (candidate.track ?? []).map((sighting: any) => sighting.time_mjd);
    const middle = 2000 + (dates.reduce((sum: number, date: number) => sum + date, 0) / dates.length - 51544.5) / 365.25;
    check(Math.abs(candidate.epoch - middle) <= 0.001, where + "epoch is not the middle of the sightings");
    check(isDetectorList(candidate.detectors), where + "detectors");
    const track: any[] = candidate.track ?? [];
    check(track.length >= 1, where + "no track");
    for (const [i, sighting] of track.entries()) {
      check(sameKeys(sighting, SIGHTING_KEYS), where + "fields of a sighting");
      check(passes.has(sighting.pass) && (i === 0 || sighting.pass > track[i - 1].pass), where + "passes of the track");
      check(samePlace(grid, sighting), where + "a sighting has ra and dec that do not match xy");
      check(sighting.error_arcsec > 0 && isDetectorList(sighting.detectors), where + "error or detectors of a sighting");
      check(sameMoment(sighting), where + "time_iso of a sighting differs from its time_mjd");
    }
    const changes: any[] = candidate.changes ?? [];
    for (const change of changes) {
      check(sameKeys(change, CHANGE_KEYS), where + "fields of a change");
      check(passes.has(change.from_pass) && passes.has(change.to_pass) && change.from_pass < change.to_pass, where + "passes of a change");
      check(change.ratio > 0 && change.error > 0 && Math.abs(change.ratio - 1) >= limits.change, where + "ratio of a change");
      check(change.significance >= limits.significance, where + "a change under the limit");
      check(change.wavelength_um?.[0] <= change.wavelength_um?.[1], where + "wavelengths of a change");
    }
    const onHalo = candidate.method === "halo";
    if (onHalo) {
      // A saturated star has no source to follow: only its halo can change, and it is
      // placed where the file puts the saturated star, to the radius of its heart.
      const heart = (file.saturated ?? []).find((star: any) => star.xy[0] === candidate.xy[0] && star.xy[1] === candidate.xy[1]);
      check(candidate.kind === "changed", where + "a halo can only change");
      check(heart !== undefined, where + "a candidate on a halo is not one of the saturated stars");
      check(
        heart !== undefined && track.every((sighting) => Math.abs(sighting.error_arcsec - heart.radius_arcsec) <= 0.1),
        where + "a saturated star is placed to the radius of its heart",
      );
    }
    if (candidate.kind === "moved") {
      moved++;
      const motion = candidate.motion;
      check(sameKeys(motion, MOTION_KEYS), where + "fields of the motion");
      if (!motion || track.length < 2) {
        check(false, where + "a moved candidate needs a motion and two sightings");
        continue;
      }
      check(motion.shift_arcsec >= limits.shift_arcsec, where + "shift under the limit");
      check(Math.abs(Math.hypot(motion.pm_ra, motion.pm_dec) / 1000 - motion.rate_arcsec_per_year) <= 0.01, where + "rate and proper motion disagree");
      const angle = ((Math.atan2(motion.pm_ra, motion.pm_dec) / DEG) % 360 + 360) % 360;
      check(Math.abs(((angle - motion.angle_deg + 540) % 360) - 180) <= 0.5, where + "angle and proper motion disagree");
      check(Math.abs((motion.rate_arcsec_per_year * motion.days) / 365.25 - motion.shift_arcsec) <= 0.05, where + "shift, rate and days disagree");
      // The motion is told in the words of the sky, the track in pixels: east is toward
      // smaller x and north toward smaller y. From the first sighting to the last, the
      // two must point the same way.
      const first = track[0];
      const last = track[track.length - 1];
      const east = -(last.xy[0] - first.xy[0]) * arcsec;
      const north = -(last.xy[1] - first.xy[1]) * arcsec;
      const along = (east * motion.pm_ra + north * motion.pm_dec) / Math.hypot(motion.pm_ra, motion.pm_dec);
      check(along >= 0.7 * Math.hypot(east, north), where + "the motion does not point along the track");
      check(Math.abs(Math.hypot(east, north) - motion.shift_arcsec) <= Math.max(1.5, 0.3 * motion.shift_arcsec), where + "the track is not as long as the shift");
      if (motion.parallax_arcsec !== null) {
        check(motion.parallax_arcsec > 0 && motion.parallax_error_arcsec > 0, where + "parallax");
        check(Math.abs(motion.distance_ly - LIGHT_YEARS_AT_ONE_ARCSECOND / motion.parallax_arcsec) <= 0.02 * motion.distance_ly + 0.1, where + "distance and parallax disagree");
        const range = motion.distance_ly_range;
        check(range === null || (range[0] <= motion.distance_ly && motion.distance_ly <= range[1]), where + "range of the distance");
      } else {
        check(motion.parallax_error_arcsec === null && motion.distance_ly === null && motion.distance_ly_range === null, where + "a distance without a parallax");
      }
      const far = motion.distance_ly === null ? "" : `, ${motion.distance_ly} light-years away`;
      lines.push(`moved (${candidate.confidence}): ${motion.rate_arcsec_per_year} +- ${motion.rate_error_arcsec_per_year} arcsec per year toward ${motion.angle_deg} degrees${far}, detectors ${candidate.detectors.join("")}`);
    } else {
      check(candidate.motion === null, where + "a changed candidate carries no motion");
      check(new Set(changes.map((change) => change.detector)).size >= 2, where + "a change needs two detectors");
      lines.push(`changed (${candidate.confidence}${onHalo ? ", on the halo of a saturated star" : ""}): ${changes.map((change) => `x${change.ratio} in detector ${change.detector}`).join(", ")}`);
    }
  }
  return { count: candidates.length, moved, changed: candidates.length - moved, frames: file.frames ?? 0, lines };
}

interface CatalogSummary {
  counts: Record<string, number>;
  lines: string[];
}

// A catalog file: what Gaia DR3 and AllWISE hold inside a view at a date. Each source
// is moved to that date with its own motion, as the contract tells the browser to do,
// and must then be inside the square of the view.
function checkCatalog(file: any): CatalogSummary {
  const counts: Record<string, number> = {};
  const lines: string[] = [];
  check(file.format === CATALOG_FORMAT && file.version === 1, "format or version");
  check(sameKeys(file, CATALOG_FILE_KEYS), "fields of the file");
  check(sameKeys(file.view, VIEW_KEYS), "fields of the view");
  check(file.epoch > 2000 && file.epoch < 2100, "date of the view");
  const view = file.view ?? {};
  // Any size does: the grid only tells whether a place is inside the square.
  const grid: Grid = { ra: view.ra, dec: view.dec, fov_deg: view.fov_deg, size: 128 };
  const date = 51544.5 + (file.epoch - 2000) * 365.25;
  const catalogs: any[] = file.catalogs ?? [];
  check(catalogs.map((catalog) => catalog.key).join() === "gaia,allwise", "the catalogs and their order");
  for (const catalog of catalogs) {
    const where = `catalog ${catalog.key}: `;
    check(sameKeys(catalog, CATALOG_KEYS), where + "fields");
    check(typeof catalog.name === "string" && catalog.name.length > 0 && typeof catalog.band === "string", where + "name or band");
    check(catalog.epoch > 1990 && catalog.epoch < file.epoch, where + "date of the positions");
    const sources: any[] = catalog.sources ?? [];
    check(Number.isInteger(catalog.limit) && sources.length <= catalog.limit && typeof catalog.truncated === "boolean", where + "limit");
    check(new Set(sources.map((source) => source.id)).size === sources.length, where + "a source is listed twice");
    let faintest = -Infinity;
    for (const source of sources) {
      const who = `${where}${source.id}: `;
      check(sameKeys(source, SOURCE_KEYS), who + "fields");
      check(typeof source.id === "string" && source.id.length > 0, who + "id");
      check((source.pm_ra === null) === (source.pm_dec === null), who + "a motion needs both of its parts");
      check(source.parallax_mas === null || typeof source.parallax_mas === "number", who + "parallax");
      const moving = { ra: source.ra, dec: source.dec, epoch: catalog.epoch, pm_ra: source.pm_ra, pm_dec: source.pm_dec };
      const [x, y] = skyToPixel(grid, ...targetAt(moving, date));
      const edge = grid.size - 0.5;
      check(x >= -0.51 && x <= edge + 0.01 && y >= -0.51 && y <= edge + 0.01, who + "outside the view at the date of the file");
      const magnitudes = Object.values(source.mags ?? {});
      check(magnitudes.every((value) => typeof value === "number" && value > -5 && value < 30), who + "magnitudes");
      const brightness = source.mags?.[catalog.band];
      if (typeof brightness === "number") {
        check(brightness >= faintest, who + "sources are not sorted, the brightest first");
        faintest = brightness;
      }
    }
    counts[catalog.key] = sources.length;
    lines.push(`${catalog.name}: ${sources.length} sources${catalog.truncated ? ", the brightest of more" : ""}`);
  }
  return { counts, lines };
}

function sameFields(a: any, b: any, keys: string[]): boolean {
  return a != null && b != null && keys.every((key) => a[key] === b[key]);
}

function checkIndex(index: any, folder: string): void {
  check(index.version === 1, "version of the index");
  check(Array.isArray(index.targets) && index.targets.length > 0, "the index lists no target");
  for (const entry of index.targets ?? []) {
    context = `${entry.key}: `;
    check(typeof entry.key === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.key), "key of the target");
    check(typeof entry.name === "string" && entry.name.length > 0, "name of the target");
    check(Number.isInteger(entry.passes) && entry.passes >= 1, "number of passes");
    check(Array.isArray(entry.detectors) && entry.detectors.length > 0, "the target lists no file");
    let total = 0;
    const measured = new Map<string, Measured>();
    for (const listed of entry.detectors ?? []) {
      context = `${listed.file}: `;
      check(listed.file === `${entry.key}-d${listed.detector}.json`, "name of the file");
      let text: string;
      try {
        text = readFileSync(join(folder, listed.file), "utf8");
      } catch {
        check(false, "the file is missing");
        continue;
      }
      const bundle = JSON.parse(text);
      const summary = checkBundle(bundle, false);
      check(Buffer.byteLength(text, "utf8") === listed.bytes, "size differs from the index");
      check(sameFields(bundle.target, entry.target, TARGET_KEYS), "target differs from the index");
      check(sameFields(bundle.grid, entry.grid, GRID_KEYS), "grid differs from the index");
      check(summary.frames === listed.frames, "number of frames differs from the index");
      check(summary.detectors.length === 1 && summary.detectors[0] === listed.detector, "detector of the exposures");
      check(
        summary.wavelengths[0] === listed.wavelength_um?.[0] && summary.wavelengths[1] === listed.wavelength_um?.[1],
        "wavelengths differ from the index",
      );
      total += summary.frames;
      for (const [id, value] of summary.measured) measured.set(id, value);
      console.log(`${listed.file}: ${summary.frames} frames, ${summary.wavelengths[0]} to ${summary.wavelengths[1]} micrometers`);
    }
    if (entry.spectrum) checkListedSpectrum(entry, folder, measured);
    if (entry.candidates) checkListedCandidates(entry, folder, total);
    if (entry.catalog) checkListedCatalog(entry, folder);
    if (entry.candidates && entry.catalog) checkKnown(entry, folder);
    context = "";
    console.log(`${entry.name}: ${total} frames in ${(entry.detectors ?? []).length} files, ${entry.passes} passes`);
  }
}

// Is a candidate known? The source of a catalog that is at the place of the candidate,
// once moved to the date of the candidate with its own motion. This is the function of
// the contract: half a SPHEREx pixel is close enough to be the same object.
function knownAs(candidate: any, catalog: any, withinArcsec = 3): { source: any; separation: number } | null {
  const date = 51544.5 + (candidate.epoch - 2000) * 365.25;
  let best: { source: any; separation: number } | null = null;
  for (const source of catalog.sources ?? []) {
    const moving = { ra: source.ra, dec: source.dec, epoch: catalog.epoch, pm_ra: source.pm_ra, pm_dec: source.pm_dec };
    const [ra, dec] = targetAt(moving, date);
    const east = (((ra - candidate.ra + 540) % 360) - 180) * Math.cos(candidate.dec * DEG) * 3600;
    const north = (dec - candidate.dec) * 3600;
    const separation = Math.hypot(east, north);
    if (separation <= withinArcsec && (best === null || separation < best.separation)) best = { source, separation };
  }
  return best;
}

// The candidates of a target against its catalog file: two files built apart, one from
// the SPHEREx frames and one from Gaia, that must tell the same sky. A candidate that
// moved and that Gaia holds must move as Gaia says.
function checkKnown(entry: any, folder: string): void {
  let candidates: any;
  let catalogs: any;
  try {
    candidates = JSON.parse(readFileSync(join(folder, entry.candidates.file), "utf8"));
    catalogs = JSON.parse(readFileSync(join(folder, entry.catalog.file), "utf8"));
  } catch {
    return;
  }
  context = `${entry.candidates.file} against ${entry.catalog.file}: `;
  const gaia = (catalogs.catalogs ?? []).find((catalog: any) => catalog.key === "gaia");
  if (!gaia) return;
  for (const candidate of candidates.candidates ?? []) {
    const known = knownAs(candidate, gaia);
    if (known === null) {
      console.log(`  ${candidate.kind}: no source of Gaia DR3 within 3 arcseconds${gaia.truncated ? ", among the brightest" : ""}`);
      continue;
    }
    const { source, separation } = known;
    let said = `  ${candidate.kind}: ${source.id} at ${separation.toFixed(1)} arcsecond`;
    if (source.pm_ra !== null && source.pm_dec !== null) {
      const rate = Math.hypot(source.pm_ra, source.pm_dec) / 1000;
      said += `, ${rate.toFixed(2)} arcsec per year for Gaia`;
      const motion = candidate.motion;
      if (candidate.kind === "moved" && motion) {
        said += `, ${motion.rate_arcsec_per_year} +- ${motion.rate_error_arcsec_per_year} measured`;
        const east = motion.pm_ra / 1000 - source.pm_ra / 1000;
        const north = motion.pm_dec / 1000 - source.pm_dec / 1000;
        check(Math.hypot(east, north) <= 3 * motion.rate_error_arcsec_per_year + 0.1, `the motion measured and the motion of ${source.id} disagree`);
      }
    }
    console.log(said);
  }
}

// The catalog file of a target against the index: same view, same counts.
function checkListedCatalog(entry: any, folder: string): void {
  const listed = entry.catalog;
  context = `${listed.file}: `;
  check(listed.file === `${entry.key}-catalog.json`, "name of the file");
  let text: string;
  try {
    text = readFileSync(join(folder, listed.file), "utf8");
  } catch {
    check(false, "the file is missing");
    return;
  }
  const file = JSON.parse(text);
  const summary = checkCatalog(file);
  check(Buffer.byteLength(text, "utf8") === listed.bytes, "size differs from the index");
  check(
    file.view?.ra === entry.grid?.ra && file.view?.dec === entry.grid?.dec && file.view?.fov_deg === entry.grid?.fov_deg,
    "view differs from the grid of the index",
  );
  check(
    Object.keys(summary.counts).length === Object.keys(listed.sources ?? {}).length &&
      Object.entries(summary.counts).every(([key, count]) => listed.sources?.[key] === count),
    "counts differ from the index",
  );
  console.log(`${listed.file}: ${summary.lines.join(", ")}`);
}

// The spectrum file of a target against the index, and against the frames of its bundles:
// two paths of the service measured the same exposures, and they must agree.
function checkListedSpectrum(entry: any, folder: string, measured: Map<string, Measured>): void {
  const listed = entry.spectrum;
  context = `${listed.file}: `;
  check(listed.file === `${entry.key}-spectrum.json`, "name of the file");
  let text: string;
  try {
    text = readFileSync(join(folder, listed.file), "utf8");
  } catch {
    check(false, "the file is missing");
    return;
  }
  const spectrum = JSON.parse(text);
  const summary = checkSpectrum(spectrum);
  check(Buffer.byteLength(text, "utf8") === listed.bytes, "size differs from the index");
  check(sameFields(spectrum.target, entry.target, TARGET_KEYS), "target differs from the index");
  check(summary.points === listed.points, "number of points differs from the index");
  check(summary.withFlux === listed.with_flux, "number of points with a flux differs from the index");
  let compared = 0;
  let worstFlux = 0;
  let worstWavelength = 0;
  for (const [id, frame] of measured) {
    const point = summary.byId.get(id);
    if (!point) {
      check(false, `the frame ${id} of a bundle has no point`);
      continue;
    }
    check(point.quality === frame.quality, `quality of ${id} differs from its frame`);
    if (point.flux_mjy !== null && frame.flux !== null) {
      worstFlux = Math.max(worstFlux, Math.abs(point.flux_mjy - frame.flux) / Math.abs(frame.flux));
      compared++;
    }
    if (point.wavelength_um !== null) worstWavelength = Math.max(worstWavelength, Math.abs(point.wavelength_um - frame.wavelength));
  }
  check(worstFlux <= 1e-4, "a flux differs from the one of its frame");
  // A frame gives the wavelength at the center of its grid, a point at the target itself.
  check(worstWavelength <= 0.005, "a wavelength differs from the one of its frame");
  console.log(`${listed.file}: ${summary.points} points, ${summary.withFlux} with a flux, ${compared} equal to their frame within ${worstFlux.toExponential(1)}`);
}

// The candidates file of a target against the index and against its bundles.
function checkListedCandidates(entry: any, folder: string, frames: number): void {
  const listed = entry.candidates;
  context = `${listed.file}: `;
  check(listed.file === `${entry.key}-candidates.json`, "name of the file");
  let text: string;
  try {
    text = readFileSync(join(folder, listed.file), "utf8");
  } catch {
    check(false, "the file is missing");
    return;
  }
  const file = JSON.parse(text);
  const summary = checkCandidates(file);
  check(Buffer.byteLength(text, "utf8") === listed.bytes, "size differs from the index");
  check(sameFields(file.target, entry.target, TARGET_KEYS), "target differs from the index");
  check(sameFields(file.grid, entry.grid, GRID_KEYS), "grid differs from the index");
  check(summary.count === listed.count && summary.moved === listed.moved && summary.changed === listed.changed, "counts differ from the index");
  // A frame without a background cannot be compared with the others and is left out.
  check(summary.frames <= frames && summary.frames >= 0.9 * frames, "frames measured against the frames of the bundles");
  check((file.visits ?? []).length === entry.passes, "visits differ from the passes of the index");
  console.log(`${listed.file}: ${summary.count} candidates in ${file.sources} sources and ${summary.frames} frames`);
  for (const line of summary.lines) console.log(`  ${line}`);
}

const options = process.argv.slice(2).filter((argument) => argument.startsWith("--"));
const paths = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const unknown = options.filter((option) => option !== "--bright-star");
if (paths.length !== 1 || unknown.length > 0) {
  console.error("Usage: node samples/check-sample.ts <bundle.json, spectrum.json, candidates.json, catalog.json or index.json> [--bright-star]");
  process.exit(2);
}

const content = JSON.parse(readFileSync(paths[0], "utf8"));
if (content.format === INDEX_FORMAT) {
  checkIndex(content, dirname(paths[0]));
} else if (content.format === SPECTRUM_FORMAT) {
  for (const line of checkSpectrum(content).lines) console.log(line);
} else if (content.format === CANDIDATES_FORMAT) {
  for (const line of checkCandidates(content).lines) console.log(line);
} else if (content.format === CATALOG_FORMAT) {
  for (const line of checkCatalog(content).lines) console.log(line);
} else {
  for (const line of checkBundle(content, options.includes("--bright-star")).lines) console.log(line);
}
console.log(problems === 0 ? "ALL CHECKS PASSED" : `${problems} CHECK(S) FAILED`);
process.exitCode = problems === 0 ? 0 : 1;
