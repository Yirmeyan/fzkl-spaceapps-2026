import type { ComposeMode } from "../compose/stack";
import type { ColorMap } from "../data/contract";

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
  // Tommy item 3: ?ra=&dec= opens any position without a preset key.
  const fromSky = ra != null && dec != null;
  return {
    targetKey: fromSky ? "custom" : q.get("target") || DEFAULT_VIEW.targetKey,
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

export interface TargetExtras {
  ra: number;
  dec: number;
  epoch: number;
  pm_ra: number | null;
  pm_dec: number | null;
}

export function writeViewToUrl(state: ViewState, replace = true): void {
  const q = new URLSearchParams();
  if (state.targetKey !== DEFAULT_VIEW.targetKey) q.set("target", state.targetKey);
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
  if (state.query) q.set("q", state.query);
  if (state.waveUm != null) q.set("wave", String(state.waveUm));
  if (state.waveTolUm !== DEFAULT_VIEW.waveTolUm) q.set("wtol", String(state.waveTolUm));
  if (state.contrast !== DEFAULT_VIEW.contrast) q.set("contrast", String(state.contrast));
  if (state.colorMap !== DEFAULT_VIEW.colorMap) q.set("cmap", state.colorMap);

  const search = q.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}
