import { ApiError } from "./client";

/** Contract: docs/api-contract.md § GET /api/catalog */

export interface CatalogSource {
  id: string;
  ra: number;
  dec: number;
  pm_ra: number | null;
  pm_dec: number | null;
  parallax_mas: number | null;
  mags: Record<string, number>;
}

export interface CatalogSlice {
  key: string;
  name: string;
  epoch: number;
  band: string;
  limit: number;
  truncated: boolean;
  sources: CatalogSource[];
}

export interface CatalogResponse {
  format?: "spherex-explorer/catalog";
  version?: number;
  generated?: string;
  view: { ra: number; dec: number; fov_deg: number };
  epoch: number;
  catalogs: CatalogSlice[];
}

export type CatalogKey = "gaia" | "allwise";

/** Julian year from MJD (same epoch convention as targetAt). */
export function julianYearFromMjd(mjd: number): number {
  return 2000 + (mjd - 51544.5) / 365.25;
}

/** Middle of the frames on screen: the epoch asked for the catalog call. */
export function middleFrameEpochYear(timeMjds: number[]): number {
  if (timeMjds.length === 0) return julianYearFromMjd(Date.now() / 86400000 + 40587);
  let lo = timeMjds[0]!;
  let hi = timeMjds[0]!;
  for (const t of timeMjds) {
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return julianYearFromMjd((lo + hi) / 2);
}

export function catalogUnavailableMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 503) {
    return "Catalogs unavailable right now";
  }
  if (err instanceof Error) return err.message;
  return "Catalogs unavailable right now";
}

/** Tip line for a hovered catalog source. */
export function catalogSourceTip(slice: CatalogSlice, source: CatalogSource): string {
  const mag = source.mags[slice.band];
  const magBit = mag != null ? `${slice.band} = ${mag.toFixed(1)}` : null;
  const pm = Math.hypot(source.pm_ra ?? 0, source.pm_dec ?? 0);
  const moveBit =
    slice.key === "gaia" && pm > 100 ? `moves ${(pm / 1000).toFixed(2)}″ per year` : null;
  return [source.id, magBit, moveBit].filter(Boolean).join(" · ");
}

export async function fetchCatalogFile(
  url: string,
  signal?: AbortSignal,
): Promise<CatalogResponse> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Failed to load catalog: ${res.status}`);
  const data = (await res.json()) as CatalogResponse;
  if (data.format != null && data.format !== "spherex-explorer/catalog") {
    throw new Error("Not a SPHEREx catalog file");
  }
  return data;
}

export function gaiaSlice(file: CatalogResponse | null): CatalogSlice | null {
  return file?.catalogs.find((c) => c.key === "gaia") ?? null;
}
