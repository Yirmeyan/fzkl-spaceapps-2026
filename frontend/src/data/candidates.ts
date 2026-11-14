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

export interface CandidateLines {
  what: string;
  howFar: string | null;
  sure: string;
  catalog: string | null;
}

/**
 * Short lines for the panel (Tommy 17:40): what happened, how far, how sure.
 * Catalog rate is hypot(pm_ra, pm_dec)/1000 when is_target and PM is known.
 */
export function candidateLines(
  c: Candidate,
  catalogPmRa: number | null | undefined,
  catalogPmDec: number | null | undefined,
): CandidateLines {
  const conf = c.confidence === "high" ? "high confidence" : "medium confidence";
  const sure = `Candidate, ${conf}.`;
  let catalog: string | null = null;
  if (c.is_target) {
    const ra = catalogPmRa ?? 0;
    const dec = catalogPmDec ?? 0;
    if (ra !== 0 || dec !== 0) {
      catalog = `Catalog: ${(Math.hypot(ra, dec) / 1000).toFixed(2)}″ per year`;
    }
  }

  if (c.kind === "moved" && c.motion) {
    const m = c.motion;
    const what = `Moved ${m.shift_arcsec.toFixed(1)} arcseconds in ${m.days.toFixed(0)} days, ${m.rate_arcsec_per_year.toFixed(2)} ± ${m.rate_error_arcsec_per_year.toFixed(2)}″ per year`;
    const howFar =
      m.distance_ly != null && m.distance_ly_range
        ? `About ${m.distance_ly.toFixed(1)} light-years away, between ${m.distance_ly_range[0].toFixed(1)} and ${m.distance_ly_range[1].toFixed(1)}, from its swing with the seasons`
        : null;
    return { what, howFar, sure, catalog };
  }
  if (c.kind === "changed" && c.changes.length > 0) {
    const ch = c.changes[0]!;
    const wave = `${ch.wavelength_um[0].toFixed(1)} to ${ch.wavelength_um[1].toFixed(1)} µm`;
    const how =
      ch.ratio < 1
        ? `About ${(1 / ch.ratio).toFixed(1)}× fainter`
        : `About ${ch.ratio.toFixed(1)}× brighter`;
    return {
      what: `${how} near ${wave} between Visit ${ch.from_pass} and Visit ${ch.to_pass}`,
      howFar: null,
      sure,
      catalog,
    };
  }
  return {
    what: c.is_target ? "This is the object you asked for" : "Another object in this field",
    howFar: null,
    sure: `Candidate marked “${c.kind}”, ${conf}.`,
    catalog,
  };
}

/** @deprecated Prefer candidateLines for the panel. */
export function candidateSentence(c: Candidate): string {
  const lines = candidateLines(c, null, null);
  return [lines.what, lines.howFar, lines.sure].filter(Boolean).join(". ");
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
