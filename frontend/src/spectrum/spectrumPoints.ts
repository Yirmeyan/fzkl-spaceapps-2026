import type { PhotometryQuality } from "../data/contract";
import type { DecodedFrame } from "../data/decode";

/**
 * Photometry-only spectrum point (Tommy B4 / upcoming spectrum file + GET /api/spectrum).
 * Same fields as a frame without pixels.
 */
export interface SpectrumPoint {
  id: string;
  detector: number;
  pass: number;
  time_mjd: number;
  time_iso: string;
  wavelength_um: number;
  bandwidth_um: number;
  flux_mjy: number | null;
  error_mjy: number | null;
  quality: PhotometryQuality;
}

/** Build spectrum points from loaded frames (today). Swap source when index ships spectrum files. */
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
