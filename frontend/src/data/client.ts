import type { SpectrumPoint } from "../spectrum/spectrumPoints";
import type { CandidatesFile } from "./candidates";
import type { CatalogResponse } from "./catalog";
import type {
  ApiErrorBody,
  Bundle,
  ErrorCode,
  Exposure,
  Frame,
  Grid,
  HealthResponse,
  Target,
} from "./contract";

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterSec: number | null;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  const retryAfter = res.headers.get("Retry-After");
  const retryAfterSec = retryAfter ? Number(retryAfter) : null;
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (body?.error?.code) {
      return new ApiError(body.error.code, body.error.message, res.status, retryAfterSec);
    }
  } catch {
    // fall through
  }
  return new ApiError(
    "http_error",
    res.statusText || `HTTP ${res.status}`,
    res.status,
    retryAfterSec,
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** GET JSON with retries on 503 using Retry-After (Tommy live-feed Need). */
async function getJson<T>(path: string, init?: RequestInit, max503Retries = 3): Promise<T> {
  let attempt = 0;
  for (;;) {
    const res = await fetch(`${apiBase}${path}`, init);
    if (res.ok) return (await res.json()) as T;
    const err = await parseError(res);
    if (err.status === 503 && attempt < max503Retries) {
      attempt += 1;
      const waitSec = err.retryAfterSec != null && err.retryAfterSec > 0 ? err.retryAfterSec : 2;
      await sleep(waitSec * 1000, init?.signal ?? undefined);
      continue;
    }
    throw err;
  }
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return getJson<HealthResponse>("/api/health", { signal });
}

export async function resolveName(name: string, signal?: AbortSignal): Promise<Target> {
  const q = new URLSearchParams({ name });
  return getJson<Target>(`/api/resolve?${q}`, { signal });
}

export interface ExposuresResponse {
  target: Target;
  grid: Grid;
  exposures: Exposure[];
}

function targetQuery(target: Target): URLSearchParams {
  const q = new URLSearchParams();
  q.set("ra", String(target.ra));
  q.set("dec", String(target.dec));
  if (target.epoch != null) q.set("epoch", String(target.epoch));
  if (target.pm_ra != null) q.set("pm_ra", String(target.pm_ra));
  if (target.pm_dec != null) q.set("pm_dec", String(target.pm_dec));
  return q;
}

export async function fetchExposures(
  target: Target,
  opts: { fov?: number; size?: number } = {},
  signal?: AbortSignal,
): Promise<ExposuresResponse> {
  const q = targetQuery(target);
  if (opts.fov != null) q.set("fov", String(opts.fov));
  if (opts.size != null) q.set("size", String(opts.size));
  return getJson<ExposuresResponse>(`/api/exposures?${q}`, { signal });
}

/** GET /api/spectrum — photometry only, no pixels (Tommy Need item 3). */
export async function fetchSpectrum(
  target: Target,
  opts: { detector?: number } = {},
  signal?: AbortSignal,
): Promise<{ target: Target; points: SpectrumPoint[] }> {
  const q = targetQuery(target);
  if (opts.detector != null) q.set("detector", String(opts.detector));
  return getJson(`/api/spectrum?${q}`, { signal });
}

/**
 * GET /api/candidates — what moved or changed around any position (#44).
 * Up to six 503 retries: measurement can outlast one request (Tommy contract).
 */
export async function fetchCandidates(
  target: Target,
  signal?: AbortSignal,
): Promise<CandidatesFile> {
  const q = targetQuery(target);
  return getJson<CandidatesFile>(`/api/candidates?${q}`, { signal }, 6);
}

/** GET /api/catalog — Gaia DR3 + AllWISE in the current view (Tommy F8 / #57). */
export async function fetchCatalog(
  opts: { ra: number; dec: number; fov: number; epoch: number },
  signal?: AbortSignal,
): Promise<CatalogResponse> {
  const q = new URLSearchParams({
    ra: String(opts.ra),
    dec: String(opts.dec),
    fov: String(opts.fov),
    epoch: String(opts.epoch),
  });
  return getJson<CatalogResponse>(`/api/catalog?${q}`, { signal }, 2);
}

export async function fetchFrame(
  id: string,
  target: Target,
  grid: Grid,
  signal?: AbortSignal,
): Promise<Frame> {
  const q = new URLSearchParams();
  q.set("ra", String(target.ra));
  q.set("dec", String(target.dec));
  if (target.epoch != null) q.set("epoch", String(target.epoch));
  if (target.pm_ra != null) q.set("pm_ra", String(target.pm_ra));
  if (target.pm_dec != null) q.set("pm_dec", String(target.pm_dec));
  q.set("grid_ra", String(grid.ra));
  q.set("grid_dec", String(grid.dec));
  q.set("fov", String(grid.fov_deg));
  q.set("size", String(grid.size));
  return getJson<Frame>(`/api/frames/${encodeURIComponent(id)}?${q}`, { signal });
}

/** Load frames with bounded concurrency; yields each as it arrives. Skips 404 frames. */
export async function loadFramesProgressive(
  exposures: Exposure[],
  target: Target,
  grid: Grid,
  onFrame: (frame: Frame, index: number) => void,
  opts: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const concurrency = opts.concurrency ?? 12;
  let next = 0;

  async function worker() {
    while (next < exposures.length) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const index = next++;
      const exp = exposures[index]!;
      try {
        const frame = await fetchFrame(exp.id, target, grid, opts.signal);
        onFrame(frame, index);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) continue;
        throw err;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, exposures.length) }, () => worker()),
  );
}

export async function fetchBundle(url: string, signal?: AbortSignal): Promise<Bundle> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new ApiError("http_error", `Failed to load bundle: ${res.status}`, res.status);
  }
  const bundle = (await res.json()) as Bundle;
  if (bundle.format !== "spherex-explorer/bundle") {
    throw new ApiError("invalid_request", "Not a SPHEREx explorer bundle", 422);
  }
  return bundle;
}
