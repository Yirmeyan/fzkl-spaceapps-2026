import type { Grid, Target } from "./contract";

/** Contract: docs/api-contract.md § Candidates */

export interface CandidateTrackPoint {
  pass: number;
  time_mjd: number;
  time_iso: string;
  ra: number;
  dec: number;
  xy: [number, number];
  error_arcsec: number;
  detectors: number[];
}

export interface CandidateMotion {
  shift_arcsec: number;
  days: number;
  rate_arcsec_per_year: number;
  rate_error_arcsec_per_year: number;
  angle_deg: number;
  pm_ra: number;
  pm_dec: number;
  parallax_arcsec: number | null;
  parallax_error_arcsec: number | null;
  distance_ly: number | null;
  distance_ly_range: [number, number] | null;
}

export interface CandidateChange {
  detector: number;
  from_pass: number;
  to_pass: number;
  ratio: number;
  error: number;
  significance: number;
  wavelength_um: [number, number];
}

export interface Candidate {
  kind: string;
  confidence: string;
  significance: number;
  is_target: boolean;
  ra: number;
  dec: number;
  epoch: number;
  xy: [number, number];
  detectors: number[];
  track: CandidateTrackPoint[];
  motion: CandidateMotion | null;
  changes: CandidateChange[];
}

export interface CandidatesLimits {
  significance: number;
  shift_arcsec: number;
  change: number;
}

export interface SaturatedStar {
  ra: number;
  dec: number;
  xy: [number, number];
  radius_arcsec: number;
  detectors: number[];
}

export interface CandidatesFile {
  format: "spherex-explorer/candidates";
  version: number;
  generated: string;
  target: Target;
  grid: Grid;
  frames: number;
  sources?: number;
  limits: CandidatesLimits;
  saturated: SaturatedStar[];
  candidates: Candidate[];
}

export async function fetchCandidatesFile(
  url: string,
  signal?: AbortSignal,
): Promise<CandidatesFile> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Failed to load candidates: ${res.status}`);
  const data = (await res.json()) as CandidatesFile;
  if (data.format !== "spherex-explorer/candidates") {
    throw new Error("Not a SPHEREx candidates file");
  }
  return data;
}

/** One plain English sentence per candidate (Tommy addition A). */
export function candidateSentence(c: Candidate): string {
  const conf = c.confidence === "high" ? "high confidence" : "medium confidence";
  if (c.kind === "moved" && c.motion) {
    const rate = c.motion.rate_arcsec_per_year;
    const err = c.motion.rate_error_arcsec_per_year;
    const para =
      c.motion.parallax_arcsec != null
        ? ` Parallax ≈ ${c.motion.parallax_arcsec.toFixed(2)}″.`
        : "";
    return `Moved about ${rate.toFixed(2)} ± ${err.toFixed(2)}″ per year (${conf}).${para}`;
  }
  if (c.kind === "changed" && c.changes.length > 0) {
    const ch = c.changes[0]!;
    const pct = ((ch.ratio - 1) * 100).toFixed(0);
    const dir = ch.ratio >= 1 ? `brighter by ~${pct}%` : `fainter by ~${Math.abs(Number(pct))}%`;
    return `Brightness ${dir} between Visit ${ch.from_pass} and Visit ${ch.to_pass} on detector ${ch.detector} (${conf}).`;
  }
  return `Candidate marked “${c.kind}” (${conf}).`;
}

export function emptyCandidatesSentence(limits: CandidatesLimits): string {
  return `Nothing moved or changed above the limit (${limits.significance}σ, ${limits.shift_arcsec}″, or ${(limits.change * 100).toFixed(0)}% brightness).`;
}
