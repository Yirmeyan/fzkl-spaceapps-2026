import type { CatalogSlice, CatalogSource } from "./catalog";
import type { Grid, Target } from "./contract";
import { targetAt } from "./contract";

const DEG = Math.PI / 180;

/**
 * The source of a catalog that is the candidate, or null.
 * Contract: docs/api-contract.md, section "Is a candidate known?".
 */
export function knownAs(
  candidate: Candidate,
  catalog: CatalogSlice,
  withinArcsec = 3,
): { source: CatalogSource; separation: number } | null {
  const date = 51544.5 + (candidate.epoch - 2000) * 365.25;
  let best: { source: CatalogSource; separation: number } | null = null;
  for (const source of catalog.sources) {
    const [ra, dec] = targetAt(
      {
        ra: source.ra,
        dec: source.dec,
        epoch: catalog.epoch,
        pm_ra: source.pm_ra,
        pm_dec: source.pm_dec,
      },
      date,
    );
    const east = (((ra - candidate.ra + 540) % 360) - 180) * Math.cos(candidate.dec * DEG) * 3600;
    const north = (dec - candidate.dec) * 3600;
    const separation = Math.hypot(east, north);
    if (separation <= withinArcsec && (best === null || separation < best.separation)) {
      best = { source, separation };
    }
  }
  return best;
}

/** Panel / verdict line for a Gaia match. */
export function gaiaKnowsLine(
  candidate: Candidate,
  match: { source: CatalogSource; separation: number } | null,
): string {
  if (!match) return "Gaia DR3 holds no source here";
  if (candidate.kind === "moved") {
    const rate = Math.hypot(match.source.pm_ra ?? 0, match.source.pm_dec ?? 0) / 1000;
    const plx = match.source.parallax_mas;
    const dist = plx != null && plx >= 5 ? `, ${(3261.6 / plx).toFixed(2)} light-years away` : "";
    return `Gaia DR3 knows it: ${rate.toFixed(2)}″ per year${dist}`;
  }
  return `A star Gaia DR3 knows · ${match.source.id}`;
}

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

/** Outer-solar-system swing. Present for `swung` only. */
export interface CandidateSwing {
  parallax_arcsec: number;
  parallax_error_arcsec: number;
  distance_au: number;
  distance_au_range: [number, number];
  swing_arcsec: number;
}

/** Synthetic sixth target metadata. */
export interface CandidatesSynthetic {
  note: string;
  distance_au?: number;
  parallax_arcsec?: number;
  flux_mjy?: Record<string, number>;
}

export interface Candidate {
  kind: string;
  /**
   * What was measured: `source` (the object) or `halo` (light around a
   * saturated heart). Unknown methods should be ignored gracefully.
   */
  method?: string;
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
  swing?: CandidateSwing | null;
  changes: CandidateChange[];
}

export interface CandidatesLimits {
  significance: number;
  shift_arcsec: number;
  change: number;
  /** AU range searched for a swinging body; null when fewer than two visits. */
  swing_distance_au?: [number, number] | null;
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
  synthetic?: CandidatesSynthetic;
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
  /** Extra tip when the measurement is on the saturated halo. */
  howMeasured: string | null;
}

/**
 * Short lines for the panel.
 * The Gaia line replaces the old resolver "Catalog: X″ per year".
 */
export function candidateLines(
  c: Candidate,
  _catalogPmRa: number | null | undefined,
  _catalogPmDec: number | null | undefined,
  gaia: CatalogSlice | null = null,
): CandidateLines {
  const conf = c.confidence === "high" ? "high confidence" : "medium confidence";
  const sure = `Candidate, ${conf}.`;
  const howMeasured =
    c.method === "halo"
      ? "Read on the halo of light around the star. The star itself is too bright for SPHEREx."
      : null;
  const match = gaia ? knownAs(c, gaia) : null;
  const catalog = gaia ? gaiaKnowsLine(c, match) : null;

  if (c.kind === "moved" && c.motion) {
    const m = c.motion;
    const what = `Moved ${m.shift_arcsec.toFixed(1)} arcseconds in ${m.days.toFixed(0)} days, ${m.rate_arcsec_per_year.toFixed(2)} ± ${m.rate_error_arcsec_per_year.toFixed(2)}″ per year`;
    const howFar =
      m.distance_ly != null && m.distance_ly_range
        ? `About ${m.distance_ly.toFixed(1)} light-years away, between ${m.distance_ly_range[0].toFixed(1)} and ${m.distance_ly_range[1].toFixed(1)}, from its swing with the seasons`
        : null;
    return { what, howFar, sure, catalog, howMeasured };
  }
  if (c.kind === "changed" && c.changes.length > 0) {
    const ch = c.changes[0]!;
    const wave = `${ch.wavelength_um[0].toFixed(1)} to ${ch.wavelength_um[1].toFixed(1)} µm`;
    // ratio has no unit — brightness factor between visits, never a flux.
    const how =
      ch.ratio < 1
        ? `About ${(1 / ch.ratio).toFixed(1)}× fainter`
        : `About ${ch.ratio.toFixed(1)}× brighter`;
    return {
      what: `${how} near ${wave} between Visit ${ch.from_pass} and Visit ${ch.to_pass}`,
      howFar: null,
      sure,
      catalog,
      howMeasured,
    };
  }
  if (c.kind === "swung" && c.swing) {
    const s = c.swing;
    const [lo, hi] = s.distance_au_range;
    return {
      what: `About ${Math.round(s.distance_au).toLocaleString("en-US")} AU from the Sun (${Math.round(lo).toLocaleString("en-US")} to ${Math.round(hi).toLocaleString("en-US")})`,
      howFar: `Swing of ${s.swing_arcsec.toFixed(0)} arcseconds between visits`,
      sure,
      catalog: null,
      howMeasured,
    };
  }
  return {
    what: c.is_target ? "This is the loaded target" : "Another object in this field",
    howFar: null,
    sure: `Candidate marked “${c.kind}”, ${conf}.`,
    catalog,
    howMeasured,
  };
}

/** One short flash line for an is_target discovery moment. */
export function discoveryFlashLine(c: Candidate): string | null {
  if (!c.is_target) return null;
  if (c.kind === "moved" && c.motion) {
    const rate = c.motion.rate_arcsec_per_year.toFixed(2);
    const ly =
      c.motion.distance_ly != null ? ` · ~${c.motion.distance_ly.toFixed(1)} light-years` : "";
    return `Found a mover · ${rate}″ per year${ly}`;
  }
  if (c.kind === "changed" && c.changes.length > 0) {
    const ch = c.changes[0]!;
    const how =
      ch.ratio < 1
        ? `About ${(1 / ch.ratio).toFixed(1)}× fainter`
        : `About ${ch.ratio.toFixed(1)}× brighter`;
    return `${how} between Visit ${ch.from_pass} and Visit ${ch.to_pass}`;
  }
  if (c.kind === "swung" && c.swing) {
    return `Swing candidate · ~${Math.round(c.swing.distance_au).toLocaleString("en-US")} AU`;
  }
  return null;
}

/** Quiet empty result when the service looked for an outer-solar-system swing. */
export function noSwingSentence(limits: CandidatesLimits): string | null {
  const range = limits.swing_distance_au;
  if (range == null) return null;
  const [lo, hi] = range;
  return `No body of the outer solar system between ${lo.toLocaleString("en-US")} and ${hi.toLocaleString("en-US")} AU in this field.`;
}

export function candidateKindLabel(kind: string): string {
  if (kind === "swung") return "swings with the seasons";
  return kind;
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
