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

/** One plain English sentence per candidate (Tommy addition A / 17:12). */
export function candidateSentence(c: Candidate): string {
  const conf = c.confidence === "high" ? "high confidence" : "medium confidence";
  const who = c.is_target ? "This is the object you asked for. " : "Another object in this field. ";
  if (c.kind === "moved" && c.motion) {
    const m = c.motion;
    const bits = [
      `Moved ${m.shift_arcsec.toFixed(1)} arcseconds in ${m.days.toFixed(0)} days`,
      `${m.rate_arcsec_per_year.toFixed(2)} ± ${m.rate_error_arcsec_per_year.toFixed(2)}″ per year`,
    ];
    if (m.distance_ly != null && m.distance_ly_range) {
      bits.push(
        `about ${m.distance_ly.toFixed(1)} light-years away (${m.distance_ly_range[0].toFixed(1)} to ${m.distance_ly_range[1].toFixed(1)}), measured from its swing with the seasons`,
      );
    }
    return `${who}Candidate: ${bits.join("; ")} (${conf}).`;
  }
  if (c.kind === "changed" && c.changes.length > 0) {
    const ch = c.changes[0]!;
    const wave = `${ch.wavelength_um[0].toFixed(1)} to ${ch.wavelength_um[1].toFixed(1)} µm`;
    const how =
      ch.ratio < 1
        ? `about ${(1 / ch.ratio).toFixed(1)}× fainter`
        : `about ${ch.ratio.toFixed(1)}× brighter`;
    return `${who}Candidate: ${how} near ${wave} between Visit ${ch.from_pass} and Visit ${ch.to_pass} (${conf}).`;
  }
  return `${who}Candidate marked “${c.kind}” (${conf}).`;
}

export function emptyCandidatesSentence(limits: CandidatesLimits, sources?: number): string {
  const n = sources != null ? ` among the ${sources} sources followed` : "";
  return `Nothing moved by more than ${limits.shift_arcsec}″ or changed by more than ${(limits.change * 100).toFixed(0)}%${n}.`;
}

/** xy of the candidate in the visit currently on screen. */
export function candidateXyForPass(c: Candidate, pass: number | null): [number, number] {
  if (pass != null) {
    const hit = c.track.find((t) => t.pass === pass);
    if (hit) return hit.xy;
  }
  return c.xy;
}
