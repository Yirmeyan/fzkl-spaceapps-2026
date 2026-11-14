/**
 * SPHEREx explorer API contract types and browser helpers.
 * Matches docs/api-contract.md (version 1, step S1).
 */

export interface Target {
  name?: string;
  ra: number;
  dec: number;
  epoch: number;
  pm_ra: number | null;
  pm_dec: number | null;
}

export interface Grid {
  ra: number;
  dec: number;
  fov_deg: number;
  size: number;
}

export interface Exposure {
  id: string;
  collection: string;
  detector: number;
  pass: number;
  time_mjd: number;
  time_iso: string;
}

export type PhotometryQuality = "ok" | "flagged" | "masked" | "saturated" | "outside";

export interface Photometry {
  flux_mjy: number | null;
  error_mjy: number | null;
  quality: PhotometryQuality;
}

export interface Frame {
  id: string;
  time_mjd: number;
  time_iso: string;
  exposure_s: number;
  wavelength_um: number;
  bandwidth_um: number;
  background: number | null;
  noise: number | null;
  valid_fraction: number;
  target_xy: [number, number];
  photometry: Photometry;
  image: string;
  mask: string;
}

export interface Bundle {
  format: "spherex-explorer/bundle";
  version: number;
  generated: string;
  target: Target;
  grid: Grid;
  exposures: Exposure[];
  frames: Frame[];
}

export interface HealthResponse {
  status: string;
  version: string;
}

export type ErrorCode =
  | "not_found"
  | "invalid_request"
  | "upstream_unavailable"
  | "internal_error"
  | "http_error";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export const MASK_TRANSIENT = 1;
export const MASK_OVERFLOW = 2;
export const MASK_SUR_ERROR = 4;
export const MASK_PERSIST = 8;
export const MASK_OUTLIER = 16;
export const MASK_BLOOM = 32;
export const MASK_HALO = 64;
export const MASK_OTHER = 128;

const DEG = Math.PI / 180;

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function halfToNumber(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

export function decodeImage(text: string, size: number): Float32Array {
  const bytes = base64ToBytes(text);
  if (bytes.length !== size * size * 2) throw new Error("Unexpected image length");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const view = new DataView(buffer);
  const pixels = new Float32Array(size * size);
  for (let i = 0; i < pixels.length; i++) pixels[i] = halfToNumber(view.getUint16(i * 2, true));
  return pixels;
}

export function decodeMask(text: string, size: number): Uint8Array {
  const bytes = base64ToBytes(text);
  if (bytes.length !== size * size) throw new Error("Unexpected mask length");
  return bytes;
}

/** Sky position in degrees to pixel position [x, y]. */
export function skyToPixel(grid: Grid, ra: number, dec: number): [number, number] {
  const scale = grid.fov_deg / grid.size;
  const center = (grid.size - 1) / 2;
  const d0 = grid.dec * DEG;
  const d = dec * DEG;
  const da = (ra - grid.ra) * DEG;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  const east = (Math.cos(d) * Math.sin(da)) / cosc / DEG;
  const north =
    (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc / DEG;
  return [center - east / scale, center - north / scale];
}

/** Pixel position to sky position [ra, dec] in degrees. */
export function pixelToSky(grid: Grid, x: number, y: number): [number, number] {
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
export function targetAt(target: Target, timeMjd: number): [number, number] {
  const years = (timeMjd - 51544.5) / 365.25 - (target.epoch - 2000);
  const dec = target.dec + ((target.pm_dec ?? 0) * years) / 3.6e6;
  const ra = target.ra + ((target.pm_ra ?? 0) * years) / 3.6e6 / Math.cos(target.dec * DEG);
  return [ra, dec];
}

export function mjdToDate(mjd: number): Date {
  return new Date((mjd - 40587) * 86400000);
}

/** Inverse hyperbolic sine stretch; `soft` is the knee in the same units as `value`. */
export function asinhStretch(value: number, soft: number): number {
  return Math.asinh(value / soft);
}

export interface DisplayFrameInput {
  pixels: Float32Array;
  background: number | null;
  noise: number | null;
  mask: Uint8Array;
}

/**
 * Common {lo, hi} in background-subtracted units (MJy/sr residual).
 *
 * Wide window (−2σ … 35σ): a tight 5σ stretch turned the sky into TV static and
 * crushed everything into black/white. Shared across the sequence so contrast
 * stays stable from frame to frame.
 */
export function computeDisplayLimits(frames: DisplayFrameInput[]): { lo: number; hi: number } {
  const noises: number[] = [];
  for (const f of frames) {
    if (f.noise != null && Number.isFinite(f.noise) && f.noise > 0) {
      noises.push(f.noise);
    }
  }

  let sigma: number;
  if (noises.length > 0) {
    noises.sort((a, b) => a - b);
    sigma = noises[Math.floor(noises.length / 2)]!;
  } else {
    sigma = estimateNoiseFromFrames(frames);
  }

  if (!(sigma > 0) || !Number.isFinite(sigma)) sigma = 1;
  return { lo: -2 * sigma, hi: 35 * sigma };
}

export type ColorMap = "heat" | "gray";

/** False-color IR ramp: dark → red → orange → yellow → white. */
export function heatColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  if (x < 0.25) {
    const u = x / 0.25;
    return [Math.round(8 + 130 * u), Math.round(8 + 12 * u), Math.round(20 + 10 * u)];
  }
  if (x < 0.5) {
    const u = (x - 0.25) / 0.25;
    return [Math.round(138 + 90 * u), Math.round(20 + 70 * u), Math.round(30 - 10 * u)];
  }
  if (x < 0.75) {
    const u = (x - 0.5) / 0.25;
    return [Math.round(228 + 22 * u), Math.round(90 + 100 * u), Math.round(20 + 30 * u)];
  }
  const u = (x - 0.75) / 0.25;
  return [Math.round(250 + 5 * u), Math.round(190 + 60 * u), Math.round(50 + 170 * u)];
}

function estimateNoiseFromFrames(frames: DisplayFrameInput[]): number {
  const samples: number[] = [];
  for (const f of frames) {
    const bg = f.background ?? 0;
    const n = f.pixels.length;
    const step = Math.max(1, Math.floor(n / 4096));
    for (let i = 0; i < n; i += step) {
      const v = f.pixels[i]!;
      if (Number.isNaN(v)) continue;
      if (f.mask[i]! !== 0) continue;
      samples.push(v - bg);
    }
  }
  if (samples.length < 16) return 1;
  samples.sort((a, b) => a - b);
  const med = samples[Math.floor(samples.length / 2)]!;
  const absDev = samples.map((s) => Math.abs(s - med));
  absDev.sort((a, b) => a - b);
  return 1.4826 * absDev[Math.floor(absDev.length / 2)]!;
}

function residualToRgb(
  residual: number,
  lo: number,
  hi: number,
  soft: number,
  denom: number,
  colorMap: ColorMap,
): [number, number, number] {
  const clipped = Math.min(hi, Math.max(lo, residual));
  const t = denom === 0 ? 0 : asinhStretch(clipped - lo, soft) / denom;
  const u = Math.min(1, Math.max(0, t));
  if (colorMap === "heat") return heatColor(u);
  const g = Math.round(u * 255);
  return [g, g, g];
}

/**
 * Render one frame to RGBA. Subtracts background, soft asinh between lo/hi.
 * Default heat colormap (IR false color). NaN+OVERFLOW → top of scale;
 * other NaN → sky at the frame background level (no punched-out holes).
 */
export function renderFrameToRgba(
  pixels: Float32Array,
  mask: Uint8Array,
  size: number,
  lo: number,
  hi: number,
  background: number | null,
  colorMap: ColorMap = "heat",
): Uint8ClampedArray {
  const n = size * size;
  const rgba = new Uint8ClampedArray(n * 4);
  const bg = background ?? 0;
  const span = hi - lo;
  // Larger soft knee → less “crushed” black/white look.
  const soft = Math.max(Math.abs(span) / 3.5, 1e-12);
  const denom = asinhStretch(span, soft);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const raw = pixels[i]!;

    if (Number.isNaN(raw)) {
      if ((mask[i]! & MASK_OVERFLOW) !== 0) {
        const [r, g, b] = colorMap === "heat" ? heatColor(1) : [255, 255, 255];
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = 255;
      } else {
        // Missing value, not saturated: paint as background so holes blend with sky.
        const [r, g, b] = residualToRgb(0, lo, hi, soft, denom, colorMap);
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = 255;
      }
      continue;
    }

    const [r, g, b] = residualToRgb(raw - bg, lo, hi, soft, denom, colorMap);
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }

  return rgba;
}
