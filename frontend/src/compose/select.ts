import type { DecodedFrame } from "../data/decode";

export interface FrameFilter {
  /** null = all passes */
  pass: number | null;
  /** null = all detectors */
  detector: number | null;
}

export function filterFrames(frames: DecodedFrame[], filter: FrameFilter): DecodedFrame[] {
  return frames.filter((f) => {
    if (filter.pass != null && f.exposure.pass !== filter.pass) return false;
    if (filter.detector != null && f.exposure.detector !== filter.detector) return false;
    return true;
  });
}

export function uniquePasses(frames: DecodedFrame[]): number[] {
  return [...new Set(frames.map((f) => f.exposure.pass))].sort((a, b) => a - b);
}

export function uniqueDetectors(frames: DecodedFrame[]): number[] {
  return [...new Set(frames.map((f) => f.exposure.detector))].sort((a, b) => a - b);
}

/** Wavelength window in micrometers; both ends inclusive. null = no cut. */
export function filterByWavelength(
  frames: DecodedFrame[],
  minUm: number | null,
  maxUm: number | null,
): DecodedFrame[] {
  return frames.filter((f) => {
    const w = f.frame.wavelength_um;
    if (minUm != null && w < minUm) return false;
    if (maxUm != null && w > maxUm) return false;
    return true;
  });
}
