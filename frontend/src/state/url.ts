import type { ComposeMode } from "../compose/stack";
import type { ColorMap } from "../data/contract";
import { INDEX_KEY_BY_UI } from "../data/sampleIndex";

export interface ViewState {
  targetKey: string;
  pass: number | null;
  detector: number | null;
  frameIndex: number;
  playing: boolean;
  fps: number;
  mode: ComposeMode;
  diffPassA: number;
  diffPassB: number;
  showHelp: boolean;
  query: string;
  /** Reference wavelength in µm for matched blinking; null = all λ */
  waveUm: number | null;
  /** Half-width of the wavelength match window in µm */
  waveTolUm: number;
  /** Display contrast (>1 = tighter asinh window) */
  contrast: number;
  colorMap: ColorMap;
}

export const DEFAULT_VIEW: ViewState = {
  targetKey: "barnard",
  pass: null,
  detector: null,
  frameIndex: 0,
  playing: false,
  fps: 4,
  mode: "single",
  diffPassA: 1,
  diffPassB: 3,
  showHelp: false,
  query: "",
  waveUm: null,
  waveTolUm: 0.03,
  contrast: 0.85,
  colorMap: "heat",
};

export interface TargetExtras {
  ra: number;
  dec: number;
  epoch: number;
  pm_ra: number | null;
  pm_dec: number | null;
}

const UI_KEY_BY_INDEX: Record<string, string> = Object.fromEntries(
  Object.entries(INDEX_KEY_BY_UI).map(([ui, index]) => [index, ui]),
);

/** Accept UI keys (barnard) or index keys (barnard-star). */
export function normalizeTargetKey(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_VIEW.targetKey;
  if (INDEX_KEY_BY_UI[raw]) return raw;
  if (UI_KEY_BY_INDEX[raw]) return UI_KEY_BY_INDEX[raw]!;
  return raw;
}

function num(v: string | null, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function optInt(v: string | null): number | null {
  if (v == null || v === "" || v === "all") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function optFloat(v: string | null): number | null {
  if (v == null || v === "" || v === "all") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function readViewFromUrl(search = window.location.search): ViewState {
  const q = new URLSearchParams(search);
  const mode = (q.get("mode") as ComposeMode | null) ?? DEFAULT_VIEW.mode;
  const validModes: ComposeMode[] = ["single", "stack", "difference", "track"];
  const ra = optFloat(q.get("ra"));
  const dec = optFloat(q.get("dec"));
  // Tommy item 3/4: ?ra=&dec= opens any position without a preset key.
  const fromSky = ra != null && dec != null;
  const targetRaw = q.get("target");
  return {
    targetKey: fromSky ? "custom" : normalizeTargetKey(targetRaw),
    pass: optInt(q.get("pass")),
    detector: optInt(q.get("detector")),
    frameIndex: Math.max(0, num(q.get("frame"), 0)),
    playing: q.has("play") ? q.get("play") !== "0" : DEFAULT_VIEW.playing,
    fps: Math.min(30, Math.max(1, num(q.get("fps"), DEFAULT_VIEW.fps))),
    mode: validModes.includes(mode) ? mode : "single",
    diffPassA: num(q.get("a"), DEFAULT_VIEW.diffPassA),
    diffPassB: num(q.get("b"), DEFAULT_VIEW.diffPassB),
    showHelp: q.get("help") === "1",
    query: q.get("q") || (fromSky ? `${ra}, ${dec}` : ""),
    waveUm: optFloat(q.get("wave")),
    waveTolUm: Math.min(0.5, Math.max(0.005, num(q.get("wtol"), DEFAULT_VIEW.waveTolUm))),
    contrast: Math.min(8, Math.max(0.25, num(q.get("contrast"), DEFAULT_VIEW.contrast))),
    colorMap: q.get("cmap") === "gray" ? "gray" : "heat",
  };
}

/** Optional sky position extras from the address bar (item 3 / 4). */
export function readSkyFromUrl(search = window.location.search): TargetExtras | null {
  const q = new URLSearchParams(search);
  const ra = optFloat(q.get("ra"));
  const dec = optFloat(q.get("dec"));
  if (ra == null || dec == null) return null;
  return {
    ra,
    dec,
    epoch: optFloat(q.get("epoch")) ?? 2000,
    pm_ra: optFloat(q.get("pm_ra")),
    pm_dec: optFloat(q.get("pm_dec")),
  };
}

/** Build the query string for the current view (Tommy item 4). Pure for tests. */
export function viewToSearchParams(
  state: ViewState,
  sky: TargetExtras | null = null,
): URLSearchParams {
  const q = new URLSearchParams();
  if (state.targetKey === "custom" && sky) {
    q.set("ra", String(sky.ra));
    q.set("dec", String(sky.dec));
    if (sky.epoch !== 2000) q.set("epoch", String(sky.epoch));
    if (sky.pm_ra != null) q.set("pm_ra", String(sky.pm_ra));
    if (sky.pm_dec != null) q.set("pm_dec", String(sky.pm_dec));
    if (state.query && !/^[+-]?\d/.test(state.query.trim())) q.set("q", state.query);
  } else {
    const indexKey = INDEX_KEY_BY_UI[state.targetKey] ?? state.targetKey;
    q.set("target", indexKey);
  }
  if (state.pass != null) q.set("pass", String(state.pass));
  if (state.detector != null) q.set("detector", String(state.detector));
  if (state.frameIndex > 0) q.set("frame", String(state.frameIndex));
  if (state.playing) q.set("play", "1");
  if (state.fps !== DEFAULT_VIEW.fps) q.set("fps", String(state.fps));
  if (state.mode !== "single") q.set("mode", state.mode);
  if (state.mode === "difference") {
    q.set("a", String(state.diffPassA));
    q.set("b", String(state.diffPassB));
  }
  if (state.showHelp) q.set("help", "1");
  if (state.targetKey !== "custom" && state.query) q.set("q", state.query);
  if (state.waveUm != null) q.set("wave", String(state.waveUm));
  if (state.waveTolUm !== DEFAULT_VIEW.waveTolUm) q.set("wtol", String(state.waveTolUm));
  if (state.contrast !== DEFAULT_VIEW.contrast) q.set("contrast", String(state.contrast));
  if (state.colorMap !== DEFAULT_VIEW.colorMap) q.set("cmap", state.colorMap);
  return q;
}

/**
 * Persist the view in the address bar (Tommy item 4).
 * Presets use ?target= (index key). Custom sky uses ?ra=&dec= (+ epoch / PM).
 */
export function writeViewToUrl(
  state: ViewState,
  replace = true,
  sky: TargetExtras | null = null,
): void {
  const search = viewToSearchParams(state, sky).toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}
