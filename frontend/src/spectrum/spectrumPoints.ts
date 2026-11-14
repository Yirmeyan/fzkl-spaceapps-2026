import type { PhotometryQuality, Target } from "../data/contract";
import type { DecodedFrame } from "../data/decode";

/**
 * Photometry-only spectrum point (Tommy B4 / spectrum file + GET /api/spectrum).
 * Same fields as a frame without pixels.
 */
export interface SpectrumPoint {
  id: string;
  detector: number;
  pass: number;
  time_mjd: number;
  time_iso: string;
  wavelength_um: number | null;
  bandwidth_um: number | null;
  flux_mjy: number | null;
  error_mjy: number | null;
  quality: PhotometryQuality;
}

export interface SpectrumApiResponse {
  target: Target;
  points: SpectrumPoint[];
}

/** Build spectrum points from loaded frames (fallback when no spectrum file). */
export function spectrumPointsFromFrames(frames: DecodedFrame[]): SpectrumPoint[] {
  return frames.map((f) => ({
    id: f.frame.id,
    detector: f.exposure.detector,
    pass: f.exposure.pass,
    time_mjd: f.frame.time_mjd,
    time_iso: f.frame.time_iso,
    wavelength_um: f.frame.wavelength_um,
    bandwidth_um: f.frame.bandwidth_um,
    flux_mjy: f.frame.photometry.flux_mjy,
    error_mjy: f.frame.photometry.error_mjy,
    quality: f.frame.photometry.quality,
  }));
}

export interface SpectrumFile {
  format: "spherex-explorer/spectrum";
  version: number;
  generated: string;
  target: unknown;
  points: SpectrumPoint[];
}

/** Load `<key>-spectrum.json` listed in the sample index. */
export async function fetchSpectrumFile(
  url: string,
  signal?: AbortSignal,
): Promise<SpectrumPoint[]> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Failed to load spectrum: ${res.status}`);
  const data = (await res.json()) as SpectrumFile;
  if (data.format !== "spherex-explorer/spectrum") {
    throw new Error("Not a SPHEREx spectrum file");
  }
  return data.points;
}
