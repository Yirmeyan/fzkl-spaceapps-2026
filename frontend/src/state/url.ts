import type { ComposeMode } from "../compose/stack";

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
}

export const DEFAULT_VIEW: ViewState = {
  targetKey: "barnard",
  pass: null,
  detector: null,
  frameIndex: 0,
  playing: true,
  fps: 8,
  mode: "single",
  diffPassA: 1,
  diffPassB: 2,
  showHelp: false,
  query: "",
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

export function readViewFromUrl(search = window.location.search): ViewState {
  const q = new URLSearchParams(search);
  const mode = (q.get("mode") as ComposeMode | null) ?? DEFAULT_VIEW.mode;
  const validModes: ComposeMode[] = ["single", "stack", "difference", "track"];
  return {
    targetKey: q.get("target") || DEFAULT_VIEW.targetKey,
    pass: optInt(q.get("pass")),
    detector: optInt(q.get("detector")),
    frameIndex: Math.max(0, num(q.get("frame"), 0)),
    playing: q.get("play") !== "0",
    fps: Math.min(30, Math.max(1, num(q.get("fps"), DEFAULT_VIEW.fps))),
    mode: validModes.includes(mode) ? mode : "single",
    diffPassA: num(q.get("a"), 1),
    diffPassB: num(q.get("b"), 2),
    showHelp: q.get("help") === "1",
    query: q.get("q") || "",
  };
}

export function writeViewToUrl(state: ViewState, replace = true): void {
  const q = new URLSearchParams();
  if (state.targetKey !== DEFAULT_VIEW.targetKey) q.set("target", state.targetKey);
  if (state.pass != null) q.set("pass", String(state.pass));
  if (state.detector != null) q.set("detector", String(state.detector));
  if (state.frameIndex > 0) q.set("frame", String(state.frameIndex));
  if (!state.playing) q.set("play", "0");
  if (state.fps !== DEFAULT_VIEW.fps) q.set("fps", String(state.fps));
  if (state.mode !== "single") q.set("mode", state.mode);
  if (state.mode === "difference") {
    q.set("a", String(state.diffPassA));
    q.set("b", String(state.diffPassB));
  }
  if (state.showHelp) q.set("help", "1");
  if (state.query) q.set("q", state.query);

  const search = q.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}
