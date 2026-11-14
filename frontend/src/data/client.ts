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

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, init);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
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

export async function fetchExposures(
  target: Target,
  opts: { fov?: number; size?: number } = {},
  signal?: AbortSignal,
): Promise<ExposuresResponse> {
  const q = new URLSearchParams();
  q.set("ra", String(target.ra));
  q.set("dec", String(target.dec));
  if (target.epoch != null) q.set("epoch", String(target.epoch));
  if (target.pm_ra != null) q.set("pm_ra", String(target.pm_ra));
  if (target.pm_dec != null) q.set("pm_dec", String(target.pm_dec));
  if (opts.fov != null) q.set("fov", String(opts.fov));
  if (opts.size != null) q.set("size", String(opts.size));
  return getJson<ExposuresResponse>(`/api/exposures?${q}`, { signal });
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

/** Load frames with bounded concurrency; yields each as it arrives. */
export async function loadFramesProgressive(
  exposures: Exposure[],
  target: Target,
  grid: Grid,
  onFrame: (frame: Frame, index: number) => void,
  opts: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const concurrency = opts.concurrency ?? 8;
  let next = 0;

  async function worker() {
    while (next < exposures.length) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const index = next++;
      const exp = exposures[index]!;
      const frame = await fetchFrame(exp.id, target, grid, opts.signal);
      onFrame(frame, index);
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
