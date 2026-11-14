// Checks a bundle file, or the index and every bundle it lists, against docs/api-contract.md.
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

interface Summary {
  frames: number;
  detectors: number[];
  wavelengths: [number, number];
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
  return { frames: frames.length, detectors: [...detectors], wavelengths: [shortest, longest], lines };
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
      console.log(`${listed.file}: ${summary.frames} frames, ${summary.wavelengths[0]} to ${summary.wavelengths[1]} micrometers`);
    }
    context = "";
    console.log(`${entry.name}: ${total} frames in ${(entry.detectors ?? []).length} files, ${entry.passes} passes`);
  }
}

const options = process.argv.slice(2).filter((argument) => argument.startsWith("--"));
const paths = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const unknown = options.filter((option) => option !== "--bright-star");
if (paths.length !== 1 || unknown.length > 0) {
  console.error("Usage: node samples/check-sample.ts <bundle.json or index.json> [--bright-star]");
  process.exit(2);
}

const content = JSON.parse(readFileSync(paths[0], "utf8"));
if (content.format === INDEX_FORMAT) {
  checkIndex(content, dirname(paths[0]));
} else {
  for (const line of checkBundle(content, options.includes("--bright-star")).lines) console.log(line);
}
console.log(problems === 0 ? "ALL CHECKS PASSED" : `${problems} CHECK(S) FAILED`);
process.exitCode = problems === 0 ? 0 : 1;
