// Checks a bundle file against docs/api-contract.md.
// The helpers below are the ones printed in the contract, so this script also tests them.
// Usage: node samples/check-sample.ts samples/barnard-star-d2.json (Node 24, no dependency)

import { readFileSync } from "node:fs";

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

const path = process.argv[2];
if (!path) {
  console.error("Usage: node samples/check-sample.ts <bundle.json>");
  process.exit(2);
}

const bundle = JSON.parse(readFileSync(path, "utf8"));
const target: Target = bundle.target;
const grid: Grid = bundle.grid;
const exposures: any[] = bundle.exposures;
const frames: any[] = bundle.frames;
const size = grid.size;
const center = (size - 1) / 2;

let problems = 0;
function check(condition: boolean, message: string): void {
  if (condition) return;
  problems++;
  console.log("PROBLEM:", message);
}

check(bundle.format === "spherex-explorer/bundle" && bundle.version === 1, "format or version");
check(exposures.length === frames.length, "every exposure of the file must have its frame");

let worstTarget = 0;
let worstValid = 0;
let worstDate = 0;
let targetSeen = 0;
let previousTime = -Infinity;
const cores: { pass: number; x: number; y: number; predicted: [number, number] }[] = [];

frames.forEach((frame, index) => {
  const exposure = exposures[index] ?? {};
  check(exposure.id === frame.id, `frame ${index} is not the frame of exposure ${index}`);
  check(ID_PATTERN.test(frame.id), `identifier ${frame.id}`);
  check(EXPOSURE_KEYS.every((key) => key in exposure), `fields of exposure ${index}`);
  check(FRAME_KEYS.every((key) => key in frame), `fields of frame ${index}`);
  check(QUALITIES.includes(frame.photometry.quality), `photometry quality of frame ${index}`);
  check(frame.time_mjd >= previousTime, "frames must be sorted by time");
  previousTime = frame.time_mjd;
  worstDate = Math.max(worstDate, Math.abs(mjdToDate(frame.time_mjd).getTime() - Date.parse(frame.time_iso)));

  const pixels = decodeImage(frame.image, size);
  const mask = decodeMask(frame.mask, size);

  let valid = 0;
  for (const value of pixels) if (!Number.isNaN(value)) valid++;
  worstValid = Math.max(worstValid, Math.abs(valid / pixels.length - frame.valid_fraction));

  const [ra, dec] = targetAt(target, frame.time_mjd);
  const [x, y] = skyToPixel(grid, ra, dec);
  worstTarget = Math.max(worstTarget, Math.abs(x - frame.target_xy[0]), Math.abs(y - frame.target_xy[1]));

  // The target is either a bright spot or a saturated core: NaN pixels that carry the OVERFLOW bit.
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
  if (bright || saturated) targetSeen++;

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
  if (Math.hypot(predicted[0], predicted[1]) > 2) {
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
check(targetSeen >= frames.length - 1, "the target is not at target_xy");
check(roundTrip < 1e-6, "skyToPixel and pixelToSky do not round trip");
check(north > 0 && east > 0, "the first row must be north and the first column east");

console.log(`${frames.length} frames of ${size} x ${size} pixels, ${mjdToDate(frames[0].time_mjd).toISOString().slice(0, 10)} to ${mjdToDate(frames[frames.length - 1].time_mjd).toISOString().slice(0, 10)}`);
console.log(`target_xy against the contract formulas: worst difference ${worstTarget.toFixed(4)} pixel`);
console.log(`valid_fraction against the decoded pixels: worst difference ${worstValid.toFixed(5)}`);
console.log(`time_iso against time_mjd: worst difference ${worstDate} ms`);
console.log(`target found at target_xy in ${targetSeen} of ${frames.length} frames`);
console.log(`motion in pixels between the first and the last pass (x, y): ${motion}`);
console.log(`first row is ${north.toFixed(1)} arcsec north of the center, first column ${east.toFixed(1)} arcsec east`);
console.log(problems === 0 ? "ALL CHECKS PASSED" : `${problems} CHECK(S) FAILED`);
process.exitCode = problems === 0 ? 0 : 1;
