import type { Grid, Target } from "./contract";

/** Contract: docs/api-contract.md. One file per detector, and an index */

export interface SampleDetectorEntry {
  detector: number;
  file: string;
  frames: number;
  wavelength_um: [number, number];
  bytes: number;
}

export interface SampleSpectrumEntry {
  file: string;
  points: number;
  with_flux: number;
  bytes: number;
}

export interface SampleCandidatesEntry {
  file: string;
  count: number;
  moved: number;
  changed: number;
  bytes: number;
}

export interface SampleCatalogEntry {
  file: string;
  sources: { gaia: number; allwise: number };
  bytes: number;
}

export interface SampleTargetEntry {
  key: string;
  name: string;
  target: Target;
  grid: Grid;
  passes: number;
  detectors: SampleDetectorEntry[];
  /** Photometry-only spectrum file (Tommy #28). */
  spectrum?: SampleSpectrumEntry;
  /** What moved or changed in the field (Tommy addition A / #42). */
  candidates?: SampleCandidatesEntry;
  /** Gaia + AllWISE overlay for the preset grid (Tommy #59). */
  catalog?: SampleCatalogEntry;
}

export interface SampleIndex {
  format: "spherex-explorer/index";
  version: number;
  generated: string;
  targets: SampleTargetEntry[];
}

const INDEX_URL = `${import.meta.env.BASE_URL}samples/index.json`;

/** UI key → index.json key (Tommy B6). */
export const INDEX_KEY_BY_UI: Record<string, string> = {
  barnard: "barnard-star",
  epsindi: "epsilon-indi-b",
  wise0855: "wise-0855",
  rwaur: "rw-aurigae",
  rdra: "r-draconis",
};

let cached: SampleIndex | null = null;

export function clearSampleIndexCache(): void {
  cached = null;
}

export async function fetchSampleIndex(signal?: AbortSignal): Promise<SampleIndex> {
  if (cached) return cached;
  const res = await fetch(INDEX_URL, { signal });
  if (!res.ok) throw new Error(`Failed to load sample index: ${res.status}`);
  const data = (await res.json()) as SampleIndex;
  if (data.format !== "spherex-explorer/index") {
    throw new Error("Not a SPHEREx sample index");
  }
  cached = data;
  return data;
}

export function sampleTargetByUiKey(
  index: SampleIndex,
  uiKey: string,
): SampleTargetEntry | undefined {
  const indexKey = INDEX_KEY_BY_UI[uiKey] ?? uiKey;
  return index.targets.find((t) => t.key === indexKey);
}

export function preferredDetector(uiKey: string, entry: SampleTargetEntry): number {
  const prefer = uiKey === "wise0855" ? 6 : 2;
  if (entry.detectors.some((d) => d.detector === prefer)) return prefer;
  return entry.detectors[0]?.detector ?? prefer;
}

export function detectorBundleUrl(file: string): string {
  return `${import.meta.env.BASE_URL}samples/${file}`;
}

export function spectrumFileUrl(file: string): string {
  return `${import.meta.env.BASE_URL}samples/${file}`;
}

export function candidatesFileUrl(file: string): string {
  return `${import.meta.env.BASE_URL}samples/${file}`;
}

export function catalogFileUrl(file: string): string {
  return `${import.meta.env.BASE_URL}samples/${file}`;
}

export function orderedDetectors(uiKey: string, entry: SampleTargetEntry): SampleDetectorEntry[] {
  const prefer = preferredDetector(uiKey, entry);
  return [...entry.detectors].sort((a, b) => {
    if (a.detector === prefer) return -1;
    if (b.detector === prefer) return 1;
    return a.detector - b.detector;
  });
}
