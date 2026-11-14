import {
  type CSSProperties,
  type FormEvent,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyContrast,
  filterFrames,
  filterNearWavelength,
  uniqueDetectors,
  uniquePasses,
} from "./compose/select";
import {
  type ComposeMode,
  differencePasses,
  stackFrames,
  stackTrackingTarget,
} from "./compose/stack";
import {
  ApiError,
  fetchBundle,
  fetchExposures,
  loadFramesProgressive,
  resolveName,
} from "./data/client";
import type { Bundle, Frame, Grid, Target } from "./data/contract";
import { computeDisplayLimits, mjdToDate } from "./data/contract";
import { type DecodedBundle, type DecodedFrame, decodeBundle } from "./data/decode";
import { KNOWN_TARGETS, targetByKey } from "./data/targets";
import { Charts } from "./spectrum/Charts";
import { readViewFromUrl, type ViewState, writeViewToUrl } from "./state/url";
import { AutoDemoBanner, DEMO_BEATS, type DemoPhase } from "./ui/AutoDemo";
import { FrameCaption } from "./ui/FrameCaption";
import { GhostVisits } from "./ui/GhostVisits";
import { HealthBadge } from "./ui/HealthBadge";
import { HelpPanel } from "./ui/HelpPanel";
import { MissionBriefing } from "./ui/MissionBriefing";
import { MotionInsight } from "./ui/MotionInsight";
import { SpotTheMover } from "./ui/SpotTheMover";
import { ViewerGuide } from "./ui/ViewerGuide";
import { type StoryboardCell, VisitStoryboard } from "./ui/VisitStoryboard";
import { FrameCanvas } from "./viewer/FrameCanvas";
import type { TrailPoint } from "./viewer/overlays";
import { SkyPlayer } from "./viewer/SkyPlayer";

type UiMode = "watch" | "compare" | "difference" | "more";

function meanPassTrail(frames: DecodedFrame[]): TrailPoint[] {
  const map = new Map<number, { sx: number; sy: number; n: number }>();
  for (const f of frames) {
    const p = f.exposure.pass;
    const cur = map.get(p) ?? { sx: 0, sy: 0, n: 0 };
    cur.sx += f.frame.target_xy[0];
    cur.sy += f.frame.target_xy[1];
    cur.n += 1;
    map.set(p, cur);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pass, v]) => ({ pass, x: v.sx / v.n, y: v.sy / v.n }));
}

function uiModeFromView(mode: ComposeMode, blink: boolean): UiMode {
  if (blink) return "compare";
  if (mode === "difference") return "difference";
  if (mode === "stack" || mode === "track") return "more";
  return "watch";
}

/** Map SPHEREx λ (µm) → CSS hue for the stage “infrared aurora”. */
function wavelengthHue(um: number): number {
  const t = Math.min(1, Math.max(0, (um - 0.75) / (5.0 - 0.75)));
  return Math.round(210 - t * 200); // blue → amber → rose across the SPHEREx band
}

type LoadState =
  | { status: "idle" }
  | { status: "loading"; message: string; loaded?: number; total?: number }
  | { status: "error"; message: string }
  | { status: "ready"; data: DecodedBundle; source: "sample" | "live" };

function parseCoordinateQuery(raw: string): Target | null {
  const trimmed = raw.trim();
  const decimal = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (decimal) {
    return {
      ra: Number(decimal[1]),
      dec: Number(decimal[2]),
      epoch: 2000.0,
      pm_ra: null,
      pm_dec: null,
    };
  }
  return null;
}

export default function App() {
  const [view, setView] = useState<ViewState>(() => readViewFromUrl());
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [searchInput, setSearchInput] = useState(view.query);
  const [blinkPasses, setBlinkPasses] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [displayPx, setDisplayPx] = useState(560);
  const [splitVisits, setSplitVisits] = useState(false);
  const [ghostVisits, setGhostVisits] = useState(false);
  const [spotMover, setSpotMover] = useState(false);
  const [demoPhase, setDemoPhase] = useState<DemoPhase>("idle");
  const [demoLine, setDemoLine] = useState("");
  const [showBriefing, setShowBriefing] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get("demo") === "1") return false;
      return sessionStorage.getItem("spx-briefing-done") !== "1";
    } catch {
      return true;
    }
  });
  const [linkCopied, setLinkCopied] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const demoTimer = useRef<number | null>(null);
  const demoFromUrl = useRef(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") === "1",
  );
  const demoAutoStarted = useRef(false);

  function dismissBriefing(startDemo: boolean) {
    try {
      sessionStorage.setItem("spx-briefing-done", "1");
    } catch {
      /* ignore */
    }
    setShowBriefing(false);
    if (startDemo) {
      window.setTimeout(() => runAutoDemo(), 200);
    }
  }

  function copyJudgeLink() {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("demo", "1");
    url.searchParams.set("target", view.targetKey || "barnard");
    const href = url.toString();
    void navigator.clipboard.writeText(href).then(() => {
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  const patchView = useCallback((partial: Partial<ViewState>) => {
    setView((prev) => {
      const next = { ...prev, ...partial };
      writeViewToUrl(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onPop = () => setView(readViewFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setDisplayPx(Math.max(280, Math.min(960, Math.floor(w))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loadFromService = useCallback(
    async (target: Target, signal: AbortSignal, targetKey: string = "custom") => {
      setLoad({ status: "loading", message: "SPHEREx archive — listing exposures…" });
      const { target: t, grid, exposures } = await fetchExposures(target, {}, signal);
      if (signal.aborted) return;
      if (exposures.length === 0) {
        setLoad({
          status: "error",
          message: "SPHEREx has no images here yet. Try Barnard's Star sample.",
        });
        return;
      }

      // Tommy bridge: prefer det 2 (det 6 for WISE 0855), then other detectors one at a time.
      const preferDet = targetKey === "wise0855" || /wise\s*0855/i.test(t.name ?? "") ? 6 : 2;
      const byDet = new Map<number, typeof exposures>();
      for (const e of exposures) {
        const list = byDet.get(e.detector) ?? [];
        list.push(e);
        byDet.set(e.detector, list);
      }
      const detOrder = [...byDet.keys()].sort((a, b) => {
        if (a === preferDet) return -1;
        if (b === preferDet) return 1;
        return a - b;
      });
      const priorExposures: typeof exposures = [];
      const priorFrames: Frame[] = [];
      let loadedTotal = 0;
      const grandTotal = exposures.length;

      const publishLive = (exps: typeof exposures, frames: Frame[]) => {
        const partial: Bundle = {
          format: "spherex-explorer/bundle",
          version: 1,
          generated: new Date().toISOString(),
          target: t,
          grid,
          exposures: exps,
          frames,
        };
        startTransition(() => {
          setLoad({ status: "ready", data: decodeBundle(partial), source: "live" });
        });
      };

      for (let di = 0; di < detOrder.length; di++) {
        if (signal.aborted) return;
        const det = detOrder[di]!;
        const queue = byDet.get(det)!;
        const batchFrames: (Frame | undefined)[] = new Array(queue.length);
        let batchLoaded = 0;

        if (di === 0) {
          setLoad({
            status: "loading",
            message: `SPHEREx archive — detector ${det}…`,
            loaded: 0,
            total: grandTotal,
          });
        }

        await loadFramesProgressive(
          queue,
          t,
          grid,
          (frame, index) => {
            batchFrames[index] = frame;
            batchLoaded += 1;
            loadedTotal += 1;
            const present = batchFrames.filter(Boolean) as Frame[];
            const got = new Set(present.map((f) => f.id));
            const kept = queue.filter((e) => got.has(e.id));
            const exps = [...priorExposures, ...kept];
            const frames = [...priorFrames, ...present];
            const shouldPaint =
              di === 0
                ? batchLoaded === 1 || batchLoaded % 8 === 0 || batchLoaded === queue.length
                : batchLoaded === queue.length || batchLoaded % 12 === 0;
            if (shouldPaint) publishLive(exps, frames);
            setLoad((prev) =>
              prev.status === "loading"
                ? {
                    ...prev,
                    loaded: loadedTotal,
                    total: grandTotal,
                    message: `Archive — D${det} ${batchLoaded}/${queue.length} · ${loadedTotal}/${grandTotal}`,
                  }
                : prev,
            );
          },
          { concurrency: 12, signal },
        );

        const finalized = batchFrames.filter(Boolean) as Frame[];
        const got = new Set(finalized.map((f) => f.id));
        const kept = queue.filter((e) => got.has(e.id));
        priorExposures.push(...kept);
        priorFrames.push(...finalized);
        publishLive(priorExposures, priorFrames);

        if (di === 0) {
          patchView({
            targetKey,
            frameIndex: 0,
            pass: null,
            detector: det,
            query: t.name ?? `${t.ra}, ${t.dec}`,
          });
          setSearchInput(t.name ?? `${t.ra}, ${t.dec}`);
        }
      }

      patchView({ detector: null });
      setLoad({
        status: "ready",
        data: decodeBundle({
          format: "spherex-explorer/bundle",
          version: 1,
          generated: new Date().toISOString(),
          target: t,
          grid,
          exposures: priorExposures,
          frames: priorFrames,
        }),
        source: "live",
      });
    },
    [patchView],
  );

  const loadKnownTarget = useCallback(
    async (key: string, signal: AbortSignal, preferLive = false) => {
      const known = targetByKey(key);
      if (!known) {
        setLoad({ status: "error", message: `Unknown target “${key}”.` });
        return;
      }
      const canLive = known.ra != null && known.dec != null;
      if (preferLive && canLive) {
        setLoad({ status: "loading", message: `Loading ${known.label} from SPHEREx archive…` });
        await loadFromService(
          {
            name: known.label,
            ra: known.ra!,
            dec: known.dec!,
            epoch: 2000,
            pm_ra: known.pm_ra ?? null,
            pm_dec: known.pm_dec ?? null,
          },
          signal,
          key,
        );
        return;
      }
      if (!known.bundleUrl) {
        if (canLive) {
          setLoad({ status: "loading", message: `Loading ${known.label} from SPHEREx archive…` });
          await loadFromService(
            {
              name: known.label,
              ra: known.ra!,
              dec: known.dec!,
              epoch: 2000,
              pm_ra: known.pm_ra ?? null,
              pm_dec: known.pm_dec ?? null,
            },
            signal,
            key,
          );
          return;
        }
        setLoad({
          status: "error",
          message: `${known.label} needs a bundle or coordinates. Try Barnard's Star.`,
        });
        return;
      }
      setLoad({ status: "loading", message: `Loading ${known.label}…` });
      const bundle = await fetchBundle(known.bundleUrl, signal);
      if (signal.aborted) return;
      const data = decodeBundle(bundle);
      setLoad({ status: "ready", data, source: "sample" });
      patchView({
        targetKey: key,
        frameIndex: 0,
        pass: null,
        detector: null,
        query: known.label,
      });
      setSearchInput(known.label);
    },
    [patchView, loadFromService],
  );

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        if (view.targetKey === "custom" && view.query) {
          const coords = parseCoordinateQuery(view.query);
          if (coords) {
            await loadFromService(coords, ac.signal);
            return;
          }
          const target = await resolveName(view.query, ac.signal);
          await loadFromService(target, ac.signal);
          return;
        }
        await loadKnownTarget(view.targetKey || "barnard", ac.signal);
      } catch (err) {
        if (ac.signal.aborted) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load data";
        setLoad({ status: "error", message });
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.targetKey]);

  const filtered = useMemo(() => {
    if (load.status !== "ready") return [];
    const byPass = filterFrames(load.data.frames, { pass: view.pass, detector: view.detector });
    return filterNearWavelength(byPass, view.waveUm, view.waveTolUm);
  }, [load, view.pass, view.detector, view.waveUm, view.waveTolUm]);

  const forDifference = useMemo(() => {
    if (load.status !== "ready") return [];
    const byDet = filterFrames(load.data.frames, { pass: null, detector: view.detector });
    return filterNearWavelength(byDet, view.waveUm, view.waveTolUm);
  }, [load, view.detector, view.waveUm, view.waveTolUm]);

  useEffect(() => {
    if (filtered.length === 0) return;
    if (view.frameIndex >= filtered.length) {
      patchView({ frameIndex: 0 });
    }
  }, [filtered.length, view.frameIndex, patchView]);

  const onPlayerFrame = useCallback((index: number) => {
    setView((prev) => {
      if (prev.frameIndex === index) return prev;
      return { ...prev, frameIndex: index };
    });
  }, []);

  const display = useMemo(() => {
    if (load.status !== "ready") return null;
    const size = load.data.grid.size;

    if (view.mode === "difference") {
      const pool = forDifference;
      const nA = pool.filter((f) => f.exposure.pass === view.diffPassA).length;
      const nB = pool.filter((f) => f.exposure.pass === view.diffPassB).length;
      if (nA === 0 || nB === 0) {
        return {
          kind: "difference" as const,
          error: `Need images from both visits. Visit ${view.diffPassA} has ${nA}, visit ${view.diffPassB} has ${nB}.`,
          size,
        };
      }
      const diff = differencePasses(pool, view.diffPassA, view.diffPassB);
      const limits = applyContrast(computeDisplayLimits([diff]), view.contrast);
      const meta = pool.find((f) => f.exposure.pass === view.diffPassA) ?? pool[0]!;
      return {
        kind: "difference" as const,
        pixels: diff.pixels,
        mask: diff.mask,
        background: 0,
        lo: limits.lo,
        hi: limits.hi,
        size,
        targetXy: meta.frame.target_xy,
        meta,
        countA: nA,
        countB: nB,
      };
    }

    if (filtered.length === 0) return null;
    const active = filtered[Math.min(view.frameIndex, filtered.length - 1)]!;

    if (view.mode === "stack") {
      const stacked = stackFrames(filtered);
      const limits = applyContrast(computeDisplayLimits([stacked]), view.contrast);
      return {
        kind: "compose" as const,
        pixels: stacked.pixels,
        mask: stacked.mask,
        background: stacked.background,
        lo: limits.lo,
        hi: limits.hi,
        size,
        targetXy: active.frame.target_xy,
        meta: active,
      };
    }
    if (view.mode === "track") {
      const tracked = stackTrackingTarget(filtered);
      const limits = applyContrast(computeDisplayLimits([tracked]), view.contrast);
      return {
        kind: "compose" as const,
        pixels: tracked.pixels,
        mask: tracked.mask,
        background: 0,
        lo: limits.lo,
        hi: limits.hi,
        size,
        targetXy: filtered[0]!.frame.target_xy,
        meta: active,
      };
    }

    const limits = applyContrast(load.data.limits, view.contrast);
    return {
      kind: "single" as const,
      pixels: active.pixels,
      mask: active.mask,
      background: active.frame.background,
      lo: limits.lo,
      hi: limits.hi,
      size,
      targetXy: active.frame.target_xy,
      meta: active,
    };
  }, [
    load,
    filtered,
    forDifference,
    view.frameIndex,
    view.mode,
    view.diffPassA,
    view.diffPassB,
    view.contrast,
  ]);

  const passes = useMemo(
    () => (load.status === "ready" ? uniquePasses(load.data.frames) : []),
    [load],
  );
  const trail = useMemo(
    () => (load.status === "ready" ? meanPassTrail(load.data.frames) : []),
    [load],
  );
  const blinkA = passes[0] ?? null;
  const blinkB = passes.length >= 2 ? passes[passes.length - 1]! : null;
  const detectors = load.status === "ready" ? uniqueDetectors(load.data.frames) : [];
  const uiMode = uiModeFromView(view.mode, blinkPasses);

  useEffect(() => {
    if (!blinkPasses || view.mode !== "single" || blinkA == null || blinkB == null) return;
    let toggle = false;
    patchView({ pass: blinkA, frameIndex: 0, playing: false });
    const id = window.setInterval(() => {
      toggle = !toggle;
      patchView({ pass: toggle ? blinkB : blinkA, frameIndex: 0, playing: false });
    }, 500);
    return () => window.clearInterval(id);
  }, [blinkPasses, view.mode, blinkA, blinkB, patchView]);

  function setUiMode(next: UiMode) {
    setBlinkPasses(false);
    if (next === "watch") {
      patchView({ mode: "single", pass: null, frameIndex: 0, playing: false });
      return;
    }
    if (next === "compare") {
      patchView({ mode: "single", playing: false, frameIndex: 0 });
      setBlinkPasses(true);
      return;
    }
    if (next === "difference") {
      patchView({
        mode: "difference",
        pass: null,
        playing: false,
        diffPassA: passes[0] ?? 1,
        diffPassB: passes[passes.length - 1] ?? 3,
      });
      return;
    }
    patchView({ mode: "stack", playing: false });
  }

  // Keyboard shortcuts — ignore while typing in fields.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        patchView({ showHelp: !view.showHelp });
        return;
      }
      if (e.key === "Escape") {
        if (demoPhase !== "idle") {
          stopAutoDemo();
          return;
        }
        if (document.fullscreenElement) {
          void document.exitFullscreen();
          return;
        }
        if (view.showHelp) {
          patchView({ showHelp: false });
          return;
        }
        if (blinkPasses) {
          setBlinkPasses(false);
          patchView({ pass: null });
        }
        if (splitVisits) setSplitVisits(false);
        return;
      }
      if (e.key === " " || e.key === "k" || e.key === "K") {
        e.preventDefault();
        if (view.mode !== "single") {
          setUiMode("watch");
        }
        setBlinkPasses(false);
        patchView({ playing: !view.playing, mode: "single" });
        return;
      }
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        if (blinkPasses) {
          setBlinkPasses(false);
          patchView({ pass: null, mode: "single" });
        } else {
          setUiMode("compare");
        }
        return;
      }
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setUiMode("difference");
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        void toggleFullscreen();
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        if (demoPhase === "idle") runAutoDemo();
        else stopAutoDemo();
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setBlinkPasses(false);
        setGhostVisits(false);
        setSpotMover(false);
        setSplitVisits((v) => !v);
        patchView({ playing: false, mode: "single" });
      }
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        setBlinkPasses(false);
        setSplitVisits(false);
        setSpotMover(false);
        setGhostVisits((v) => !v);
        patchView({ playing: false, mode: "single" });
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setBlinkPasses(false);
        setSplitVisits(false);
        setGhostVisits(false);
        setSpotMover((v) => !v);
        patchView({ playing: false, mode: "single" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view.playing,
    view.mode,
    view.showHelp,
    blinkPasses,
    passes,
    patchView,
    demoPhase,
    splitVisits,
  ]);

  async function toggleFullscreen() {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // Browsers may deny without a gesture; ignore.
    }
  }

  function stopAutoDemo() {
    if (demoTimer.current != null) {
      window.clearTimeout(demoTimer.current);
      demoTimer.current = null;
    }
    setDemoPhase("idle");
    setDemoLine("");
    setBlinkPasses(false);
    setGhostVisits(false);
    setSpotMover(false);
    setSplitVisits(false);
    patchView({ playing: false, pass: null, mode: "single" });
  }

  // Judge deep-link: ?demo=1 skips briefing and launches the walkthrough once data is ready.
  useEffect(() => {
    if (!demoFromUrl.current || demoAutoStarted.current) return;
    if (load.status !== "ready") return;
    demoAutoStarted.current = true;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("demo");
      window.history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
      sessionStorage.setItem("spx-briefing-done", "1");
    } catch {
      /* ignore */
    }
    window.setTimeout(() => runAutoDemo(), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.status]);

  function runAutoDemo() {
    if (load.status !== "ready") return;
    if (demoTimer.current != null) window.clearTimeout(demoTimer.current);
    setSplitVisits(false);
    setGhostVisits(false);
    setSpotMover(false);
    setShowAdvanced(false);
    void toggleFullscreen();

    let i = 0;
    const step = () => {
      const beat = DEMO_BEATS[i];
      if (!beat) {
        stopAutoDemo();
        return;
      }
      setDemoPhase(beat.phase);
      setDemoLine(beat.line);
      if (beat.phase === "intro" || beat.phase === "play") {
        setBlinkPasses(false);
        setSplitVisits(false);
        setGhostVisits(false);
        setSpotMover(false);
        patchView({
          mode: "single",
          pass: null,
          frameIndex: 0,
          playing: beat.phase === "play",
        });
      } else if (beat.phase === "blink") {
        setSplitVisits(false);
        setGhostVisits(false);
        setSpotMover(false);
        patchView({ mode: "single", playing: false, frameIndex: 0 });
        setBlinkPasses(true);
      } else if (beat.phase === "ghost") {
        setBlinkPasses(false);
        setSplitVisits(false);
        setSpotMover(false);
        setGhostVisits(true);
        patchView({ mode: "single", playing: false, pass: null });
      } else if (beat.phase === "difference") {
        setBlinkPasses(false);
        setSplitVisits(false);
        setGhostVisits(false);
        setSpotMover(false);
        patchView({
          mode: "difference",
          playing: false,
          pass: null,
          diffPassA: passes[0] ?? 1,
          diffPassB: passes[passes.length - 1] ?? 3,
        });
      } else if (beat.phase === "predict") {
        setBlinkPasses(false);
        setGhostVisits(false);
        setSpotMover(false);
        setSplitVisits(false);
        patchView({ mode: "single", playing: false, pass: null });
        // Scroll predict ribbon into view for judges
        window.requestAnimationFrame(() => {
          document.querySelector(".motion-insight")?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        });
      } else if (beat.phase === "done") {
        setBlinkPasses(false);
        setGhostVisits(false);
        patchView({ playing: false, mode: "single" });
      }
      i += 1;
      demoTimer.current = window.setTimeout(step, beat.ms);
    };
    step();
  }

  const visitStacks = useMemo(() => {
    if (load.status !== "ready" || passes.length < 2) return null;
    if (!splitVisits && !ghostVisits && !spotMover) return null;
    const a = passes[0]!;
    const b = passes[passes.length - 1]!;
    const pool = forDifference;
    const stackA = stackFrames(pool.filter((f) => f.exposure.pass === a));
    const stackB = stackFrames(pool.filter((f) => f.exposure.pass === b));
    const limits = applyContrast(
      computeDisplayLimits([
        {
          pixels: stackA.pixels,
          mask: stackA.mask,
          background: 0,
          noise: stackA.noise,
        },
        {
          pixels: stackB.pixels,
          mask: stackB.mask,
          background: 0,
          noise: stackB.noise,
        },
      ]),
      view.contrast,
    );
    return { a, b, stackA, stackB, limits, size: load.data.grid.size };
  }, [load, splitVisits, ghostVisits, spotMover, passes, forDifference, view.contrast]);

  const splitStacks = splitVisits ? visitStacks : null;
  const ghostStacks = ghostVisits ? visitStacks : null;
  const spotStacks = spotMover ? visitStacks : null;

  const storyboard = useMemo(() => {
    if (load.status !== "ready" || passes.length < 2) return null;
    const pool = forDifference;
    const cells: StoryboardCell[] = [];
    const stacks: { pixels: Float32Array; mask: Uint8Array; noise: number | null }[] = [];
    for (const p of passes) {
      const stack = stackFrames(pool.filter((f) => f.exposure.pass === p));
      stacks.push(stack);
      const mjds = pool.filter((f) => f.exposure.pass === p).map((f) => f.frame.time_mjd);
      const mid = mjds.reduce((a, b) => a + b, 0) / Math.max(mjds.length, 1);
      const dateLabel = Number.isFinite(mid)
        ? mjdToDate(mid).toLocaleDateString("en-US", { month: "short", year: "numeric" })
        : `Visit ${p}`;
      cells.push({
        pass: p,
        pixels: stack.pixels,
        mask: stack.mask,
        label: `Visit ${p}`,
        dateLabel,
      });
    }
    const limits = applyContrast(
      computeDisplayLimits(
        stacks.map((s) => ({
          pixels: s.pixels,
          mask: s.mask,
          background: 0,
          noise: s.noise,
        })),
      ),
      view.contrast,
    );
    return { cells, limits, size: load.data.grid.size };
  }, [load, passes, forDifference, view.contrast]);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    const raw = searchInput.trim();
    if (!raw) return;
    const ac = new AbortController();
    try {
      const known = KNOWN_TARGETS.find(
        (t) => t.label.toLowerCase() === raw.toLowerCase() || t.key === raw.toLowerCase(),
      );
      if (known && (known.bundleUrl || (known.ra != null && known.dec != null))) {
        patchView({ targetKey: known.key, query: known.label });
        await loadKnownTarget(known.key, ac.signal);
        return;
      }
      const coords = parseCoordinateQuery(raw);
      if (coords) {
        patchView({ targetKey: "custom", query: raw });
        await loadFromService(coords, ac.signal);
        return;
      }
      setLoad({ status: "loading", message: `Looking up “${raw}”…` });
      const target = await resolveName(raw, ac.signal);
      patchView({ targetKey: "custom", query: raw });
      await loadFromService(target, ac.signal);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.code === "not_found"
            ? "No object is known under this name."
            : err.message
          : err instanceof Error
            ? err.message
            : "Search failed";
      setLoad({ status: "error", message });
    }
  }

  const targetName =
    load.status === "ready"
      ? (load.data.target.name ?? view.query)
      : view.query || "Barnard's Star";

  const guideMode =
    uiMode === "compare"
      ? "blink"
      : uiMode === "difference"
        ? "difference"
        : view.mode === "stack"
          ? "stack"
          : view.mode === "track"
            ? "track"
            : "watch";

  return (
    <div className="app">
      <div className="sky-wash" aria-hidden="true" />

      {showBriefing && load.status === "ready" && (
        <MissionBriefing
          targetName={targetName}
          onEnter={() => dismissBriefing(true)}
          onSkip={() => dismissBriefing(false)}
        />
      )}

      <header className="top">
        <div className="brand-block">
          <p className="eyebrow">NASA Space Apps 2026 · FZKL</p>
          <h1 className="brand">SPHEREx Explorer</h1>
          <p className="tagline">
            Watch a real star drift across the infrared sky — clear enough for anyone, no astronomy
            degree required.
          </p>
        </div>
        <div className="top-actions">
          <HealthBadge />
          <button
            type="button"
            className="primary impress-btn"
            disabled={load.status !== "ready" || demoPhase !== "idle"}
            onClick={() => runAutoDemo()}
            title="Timed walkthrough for judges (J)"
          >
            Auto demo (30s)
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => copyJudgeLink()}
            title="Copy a link that auto-starts the jury demo"
          >
            {linkCopied ? "Link copied" : "Judge link"}
          </button>
          <button
            type="button"
            className="ghost"
            title="Short how-to: play, blink, blend, difference"
            onClick={() => patchView({ showHelp: !view.showHelp })}
          >
            Quick guide
          </button>
        </div>
      </header>

      {demoPhase !== "idle" && <AutoDemoBanner line={demoLine} onSkip={stopAutoDemo} />}

      <HelpPanel open={view.showHelp} onClose={() => patchView({ showHelp: false })} />

      <section
        className={`picker${load.status === "ready" ? " picker-compact" : ""}`}
        aria-label="Choose a star"
      >
        <div className="picker-head">
          <h2>Pick a star</h2>
          {load.status !== "ready" && (
            <p>
              Start with Barnard's Star — or type any name; live resolve finds the sky position.
            </p>
          )}
        </div>
        <div className="target-row">
          {KNOWN_TARGETS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`target-card${view.targetKey === t.key ? " active" : ""}`}
              onClick={() => {
                setBlinkPasses(false);
                patchView({ targetKey: t.key, mode: "single", pass: null });
              }}
              disabled={!t.bundleUrl && (t.ra == null || t.dec == null)}
              title={
                t.bundleUrl
                  ? t.blurb
                  : t.ra != null
                    ? `${t.blurb} Loads from the live SPHEREx API.`
                    : "Waiting on a sample bundle or coordinates."
              }
            >
              <span className="target-name">{t.label}</span>
              <span className="target-blurb">
                {t.bundleUrl ? t.blurb : t.ra != null ? "Archive load available" : "Coming soon"}
              </span>
            </button>
          ))}
        </div>
        <form className="search" onSubmit={onSearch}>
          <label className="sr-only" htmlFor="sky-query">
            Search by name or coordinates
          </label>
          <input
            id="sky-query"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Name (live resolve) or RA, Dec"
            autoComplete="off"
            title="Type a star name or sky coordinates (RA, Dec in degrees)"
          />
          <button
            type="submit"
            className="primary"
            title="Resolve the name and load SPHEREx images for that sky position"
          >
            Look up
          </button>
        </form>
      </section>

      <nav className="mode-tabs" aria-label="What do you want to do?">
        {(
          [
            [
              "watch",
              "1 · Watch the movie",
              "Play infrared frames of this star — each frame is a slightly different color",
            ],
            [
              "compare",
              "2 · Blink visits",
              "Flip between early and late SPHEREx visits so the star’s hop is obvious",
            ],
            [
              "difference",
              "3 · Show the move",
              "Subtract two visits: a bright/dark pair means the star moved",
            ],
            ["more", "More views", "Averaged stack, tracking, and technical filters"],
          ] as [UiMode, string, string][]
        ).map(([id, label, tip]) => (
          <button
            key={id}
            type="button"
            className={uiMode === id ? "active" : ""}
            title={tip}
            onClick={() => setUiMode(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="workspace">
        <section className="stage" ref={stageRef}>
          <div className="stage-bar">
            <div>
              <p className="stage-kicker">
                Now viewing
                {load.status === "ready" && (
                  <span
                    className={`source-pill ${load.source === "live" ? "archive" : "sample"}`}
                    title={
                      load.source === "live"
                        ? "Loaded from the SPHEREx archive API (past survey visits, not a live telescope stream)"
                        : "Offline sample file bundled with the site"
                    }
                  >
                    {load.source === "live" ? "ARCHIVE" : "SAMPLE"}
                  </span>
                )}
              </p>
              <h2 className="stage-title">{targetName}</h2>
            </div>
            <div className="stage-actions">
              <p className="kbd-hint" title="Keyboard shortcuts">
                J · G · S · B · D · F
              </p>
              {targetByKey(view.targetKey)?.ra != null && (
                <button
                  type="button"
                  className="ghost"
                  disabled={load.status === "loading"}
                  title="Reload cutouts from the SPHEREx survey archive (past visits). Not a real-time telescope feed."
                  onClick={() => {
                    const ac = new AbortController();
                    void loadKnownTarget(view.targetKey || "barnard", ac.signal, true).catch(
                      (err) => {
                        const message =
                          err instanceof ApiError
                            ? err.message
                            : err instanceof Error
                              ? err.message
                              : "Could not load from the SPHEREx archive";
                        setLoad({ status: "error", message });
                      },
                    );
                  }}
                >
                  Load from archive
                </button>
              )}
              <button
                type="button"
                className="primary"
                title="Expand the sky stage to fill the screen (F)"
                onClick={() => void toggleFullscreen()}
              >
                Fullscreen
              </button>
            </div>
          </div>

          <div
            className="stage-measure"
            ref={measureRef}
            style={
              display?.meta?.frame.wavelength_um != null
                ? ({
                    "--wave-hue": String(wavelengthHue(display.meta.frame.wavelength_um)),
                  } as CSSProperties)
                : undefined
            }
            data-wave={
              display?.meta?.frame.wavelength_um != null
                ? display.meta.frame.wavelength_um.toFixed(2)
                : undefined
            }
          >
            {display?.meta?.frame.wavelength_um != null && (
              <p className="wave-aurora-chip" aria-live="polite">
                Infrared color · {display.meta.frame.wavelength_um.toFixed(2)} µm
              </p>
            )}
            {load.status === "loading" && (
              <div className="status-banner">
                {load.message}
                {load.total != null && load.loaded != null && (
                  <progress value={load.loaded} max={load.total} />
                )}
              </div>
            )}
            {load.status === "error" && <div className="status-banner error">{load.message}</div>}

            {spotStacks && load.status === "ready" && (
              <SpotTheMover
                size={spotStacks.size}
                lo={spotStacks.limits.lo}
                hi={spotStacks.limits.hi}
                colorMap={view.colorMap}
                displayPx={displayPx}
                grid={load.data.grid}
                early={{
                  pixels: spotStacks.stackA.pixels,
                  mask: spotStacks.stackA.mask,
                  label: `Visit ${spotStacks.a}`,
                }}
                late={{
                  pixels: spotStacks.stackB.pixels,
                  mask: spotStacks.stackB.mask,
                  label: `Visit ${spotStacks.b}`,
                }}
                trail={trail}
                onExit={() => setSpotMover(false)}
              />
            )}

            {ghostStacks && (
              <GhostVisits
                size={ghostStacks.size}
                lo={ghostStacks.limits.lo}
                hi={ghostStacks.limits.hi}
                colorMap={view.colorMap}
                displayPx={displayPx}
                early={{
                  pixels: ghostStacks.stackA.pixels,
                  mask: ghostStacks.stackA.mask,
                  label: `Visit ${ghostStacks.a}`,
                }}
                late={{
                  pixels: ghostStacks.stackB.pixels,
                  mask: ghostStacks.stackB.mask,
                  label: `Visit ${ghostStacks.b}`,
                }}
                trail={trail}
              />
            )}

            {splitStacks && !ghostStacks && (
              <div className="split-visits">
                <figure>
                  <FrameCanvas
                    pixels={splitStacks.stackA.pixels}
                    mask={splitStacks.stackA.mask}
                    size={splitStacks.size}
                    lo={splitStacks.limits.lo}
                    hi={splitStacks.limits.hi}
                    background={0}
                    colorMap={view.colorMap}
                    trail={trail}
                    displayPx={Math.floor(displayPx * 0.48)}
                  />
                  <figcaption>Visit {splitStacks.a} (earlier)</figcaption>
                </figure>
                <figure>
                  <FrameCanvas
                    pixels={splitStacks.stackB.pixels}
                    mask={splitStacks.stackB.mask}
                    size={splitStacks.size}
                    lo={splitStacks.limits.lo}
                    hi={splitStacks.limits.hi}
                    background={0}
                    colorMap={view.colorMap}
                    trail={trail}
                    displayPx={Math.floor(displayPx * 0.48)}
                  />
                  <figcaption>Visit {splitStacks.b} (later)</figcaption>
                </figure>
              </div>
            )}

            {!splitStacks &&
              !ghostStacks &&
              !spotStacks &&
              display &&
              view.mode === "single" &&
              display.kind === "single" && (
                <SkyPlayer
                  frames={filtered}
                  frameIndex={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                  playing={view.playing}
                  fps={view.fps}
                  lo={display.lo}
                  hi={display.hi}
                  size={display.size}
                  colorMap={view.colorMap}
                  displayPx={displayPx}
                  trail={trail}
                  onFrameIndexChange={onPlayerFrame}
                />
              )}

            {!splitStacks &&
              !ghostStacks &&
              !spotStacks &&
              display &&
              view.mode === "difference" &&
              display.kind === "difference" &&
              ("error" in display && display.error ? (
                <div className="status-banner error">{display.error}</div>
              ) : (
                <FrameCanvas
                  pixels={display.pixels!}
                  mask={display.mask!}
                  size={display.size}
                  lo={display.lo!}
                  hi={display.hi!}
                  background={0}
                  colorMap={view.colorMap}
                  targetXy={display.targetXy}
                  trail={trail}
                  displayPx={displayPx}
                />
              ))}

            {!splitStacks &&
              !ghostStacks &&
              !spotStacks &&
              display &&
              (view.mode === "stack" || view.mode === "track") &&
              display.kind === "compose" && (
                <FrameCanvas
                  pixels={display.pixels}
                  mask={display.mask}
                  size={display.size}
                  lo={display.lo}
                  hi={display.hi}
                  background={display.background}
                  colorMap={view.colorMap}
                  targetXy={display.targetXy}
                  trail={trail}
                  displayPx={displayPx}
                />
              )}
          </div>

          {display && view.mode === "single" && display.kind === "single" && (
            <>
              <FrameCaption
                frames={filtered}
                frameIndex={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                playing={view.playing}
              />
              <div className="transport">
                <button
                  type="button"
                  className="primary play-btn"
                  title="Step through infrared wavelengths for this visit (Space)"
                  onClick={() => {
                    setBlinkPasses(false);
                    setSplitVisits(false);
                    patchView({ playing: !view.playing, mode: "single" });
                  }}
                >
                  {view.playing ? "Pause" : "Play movie"}
                </button>
                <button
                  type="button"
                  className={ghostVisits ? "active" : ""}
                  disabled={passes.length < 2}
                  title="Overlay early and late visits so the moving star shimmers (G)"
                  onClick={() => {
                    setBlinkPasses(false);
                    setSplitVisits(false);
                    setSpotMover(false);
                    setGhostVisits((v) => !v);
                    patchView({ playing: false, mode: "single" });
                  }}
                >
                  Blend visits
                </button>
                <button
                  type="button"
                  className={splitVisits ? "active" : ""}
                  disabled={passes.length < 2}
                  title="Show early and late visits next to each other (S)"
                  onClick={() => {
                    setBlinkPasses(false);
                    setGhostVisits(false);
                    setSpotMover(false);
                    setSplitVisits((v) => !v);
                    patchView({ playing: false, mode: "single" });
                  }}
                >
                  Side-by-side
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(filtered.length - 1, 0)}
                  value={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                  onChange={(e) =>
                    patchView({ frameIndex: Number(e.target.value), playing: false })
                  }
                  disabled={filtered.length === 0}
                  aria-label="Scrub through frames"
                  title="Drag to pick a frame by hand"
                />
              </div>
            </>
          )}

          {view.mode === "difference" &&
            display?.kind === "difference" &&
            !("error" in display && display.error) && (
              <p className="mode-note">
                Visit {view.diffPassA} minus visit {view.diffPassB}. A bright/dark pair near the
                center means the star moved.
              </p>
            )}

          <ViewerGuide targetName={targetName} mode={guideMode} />

          <div className="legend-row" aria-hidden="true">
            <span>
              <i className="swatch heat" /> Brighter infrared
            </span>
            <span>
              <i className="swatch cross" /> Predicted star position
            </span>
            <span>
              <i className="swatch bead" /> Visit 1 → 2 → 3 path
            </span>
          </div>
        </section>

        <aside className="rail">
          {load.status === "ready" && (
            <MotionInsight
              target={load.data.target}
              grid={load.data.grid}
              frames={load.data.frames}
              trail={trail}
              targetName={load.data.target.name ?? targetName}
            />
          )}

          {load.status === "ready" && storyboard && (
            <VisitStoryboard
              size={storyboard.size}
              lo={storyboard.limits.lo}
              hi={storyboard.limits.hi}
              colorMap={view.colorMap}
              cells={storyboard.cells}
              trail={trail}
              activePass={view.pass}
              onPickPass={(pass) => {
                setBlinkPasses(false);
                setGhostVisits(false);
                setSpotMover(false);
                setSplitVisits(false);
                patchView({ mode: "single", pass, frameIndex: 0, playing: false });
              }}
            />
          )}

          <div className="rail-card">
            <h3>Controls for this step</h3>
            <p className="rail-hint">
              Hover any button for a tip. Only the controls for the selected step are active.
            </p>

            {uiMode === "watch" && (
              <div className="control-block">
                <p className="control-label">Which visit to play</p>
                <div className="chip-row">
                  <button
                    type="button"
                    className={view.pass == null ? "active" : ""}
                    title="Include frames from every SPHEREx visit of this field"
                    onClick={() => patchView({ pass: null, frameIndex: 0 })}
                  >
                    All visits
                  </button>
                  {passes.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={view.pass === p ? "active" : ""}
                      title={`Show only Visit ${p} frames`}
                      onClick={() => patchView({ pass: p, frameIndex: 0 })}
                    >
                      Visit {p}
                    </button>
                  ))}
                </div>
                <p className="control-label">Keep one infrared color?</p>
                <div className="chip-row">
                  <button
                    type="button"
                    className={view.waveUm == null ? "active" : ""}
                    title="Use every infrared wavelength in the movie"
                    onClick={() => patchView({ waveUm: null, frameIndex: 0 })}
                  >
                    All colors
                  </button>
                  <button
                    type="button"
                    className={view.waveUm != null ? "active" : ""}
                    disabled={!display || !("meta" in display) || !display.meta}
                    title="Keep only frames near this frame’s wavelength (fairer blink)"
                    onClick={() => {
                      if (!display || !("meta" in display) || !display.meta) return;
                      patchView({
                        waveUm: Number(display.meta.frame.wavelength_um.toFixed(4)),
                        frameIndex: 0,
                        playing: false,
                      });
                    }}
                  >
                    Lock this color
                  </button>
                </div>
                <p className="micro">
                  {view.waveUm == null
                    ? `Playing ${filtered.length} frames across many infrared colors.`
                    : `Locked near ${view.waveUm.toFixed(2)} µm · ${filtered.length} frames.`}
                </p>
              </div>
            )}

            {uiMode === "compare" && (
              <div className="control-block">
                <p className="lead">
                  Blinking Visit {blinkA ?? 1} ↔ Visit {blinkB ?? 3}. Watch the bright star hop
                  north.
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setBlinkPasses(false);
                    patchView({ pass: null, mode: "single" });
                  }}
                >
                  Stop blinking
                </button>
              </div>
            )}

            {uiMode === "difference" && (
              <div className="control-block">
                <p className="control-label">Earlier visit</p>
                <div className="chip-row">
                  {passes.map((p) => (
                    <button
                      key={`a-${p}`}
                      type="button"
                      className={view.diffPassA === p ? "active" : ""}
                      onClick={() => patchView({ diffPassA: p })}
                    >
                      Visit {p}
                    </button>
                  ))}
                </div>
                <p className="control-label">Later visit</p>
                <div className="chip-row">
                  {passes.map((p) => (
                    <button
                      key={`b-${p}`}
                      type="button"
                      className={view.diffPassB === p ? "active" : ""}
                      onClick={() => patchView({ diffPassB: p })}
                    >
                      Visit {p}
                    </button>
                  ))}
                </div>
                <p className="micro">Tip: Visit 1 minus Visit 3 shows the biggest jump.</p>
              </div>
            )}

            {uiMode === "more" && (
              <div className="control-block">
                <p className="control-label">Extra science views</p>
                <div className="chip-row">
                  <button
                    type="button"
                    className={view.mode === "stack" ? "active" : ""}
                    onClick={() => patchView({ mode: "stack", playing: false })}
                  >
                    Average stack
                  </button>
                  <button
                    type="button"
                    className={view.mode === "track" ? "active" : ""}
                    onClick={() => patchView({ mode: "track", playing: false })}
                  >
                    Keep star centered
                  </button>
                </div>
                {view.mode !== "difference" && (
                  <>
                    <p className="control-label">Visit filter</p>
                    <div className="chip-row">
                      <button
                        type="button"
                        className={view.pass == null ? "active" : ""}
                        onClick={() => patchView({ pass: null, frameIndex: 0 })}
                      >
                        All
                      </button>
                      {passes.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={view.pass === p ? "active" : ""}
                          onClick={() => patchView({ pass: p, frameIndex: 0 })}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="control-block soft">
              <p className="control-label">Look</p>
              <label className="slider-row">
                <span>Contrast</span>
                <input
                  type="range"
                  min={0.4}
                  max={3}
                  step={0.1}
                  value={view.contrast}
                  onChange={(e) => patchView({ contrast: Number(e.target.value) })}
                />
              </label>
              <div className="chip-row">
                <button
                  type="button"
                  className={view.colorMap === "heat" ? "active" : ""}
                  onClick={() => patchView({ colorMap: "heat" })}
                >
                  Warm IR
                </button>
                <button
                  type="button"
                  className={view.colorMap === "gray" ? "active" : ""}
                  onClick={() => patchView({ colorMap: "gray" })}
                >
                  Gray
                </button>
              </div>
            </div>

            {detectors.length > 1 && showAdvanced && (
              <div className="control-block soft">
                <p className="control-label">Camera (detector)</p>
                <div className="chip-row">
                  <button
                    type="button"
                    className={view.detector == null ? "active" : ""}
                    onClick={() => patchView({ detector: null, frameIndex: 0 })}
                  >
                    All
                  </button>
                  {detectors.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={view.detector === d ? "active" : ""}
                      onClick={() => patchView({ detector: d, frameIndex: 0 })}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {load.status === "ready" && view.mode === "single" && (
            <details className="rail-card details">
              <summary title="Wavelength and visit timeline — optional for deeper look">
                Infrared timeline
              </summary>
              <Charts
                frames={filtered}
                activeIndex={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                onSelectFrame={(index) => {
                  setBlinkPasses(false);
                  patchView({ frameIndex: index, playing: false, mode: "single" });
                }}
              />
            </details>
          )}

          <details
            className="rail-card details"
            open={showAdvanced}
            onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
          >
            <summary title="Raw metadata for reviewers who want numbers">Technical details</summary>
            {display && load.status === "ready" && display.meta ? (
              <AdvancedDetails
                target={load.data.target}
                grid={load.data.grid}
                frame={display.meta}
                filteredCount={view.mode === "difference" ? forDifference.length : filtered.length}
                mode={view.mode}
              />
            ) : (
              <p className="micro">Load a star to see technical metadata.</p>
            )}
          </details>
        </aside>
      </main>

      <footer className="foot">
        Foxtrot Zulu Kilo Lima · Planet X and SPHEREx · AGPL-3.0 · AI-assisted build disclosed in
        README
      </footer>
    </div>
  );
}

function AdvancedDetails({
  target,
  grid,
  frame,
  filteredCount,
  mode,
}: {
  target: Target;
  grid: Grid;
  frame: DecodedFrame;
  filteredCount: number;
  mode: ComposeMode;
}) {
  const f = frame.frame;
  const e = frame.exposure;
  return (
    <dl className="meta">
      <div>
        <dt>Target</dt>
        <dd>{target.name ?? `${target.ra.toFixed(5)}, ${target.dec.toFixed(5)}`}</dd>
      </div>
      <div>
        <dt>UTC date</dt>
        <dd>{f.time_iso}</dd>
      </div>
      <div>
        <dt>Wavelength</dt>
        <dd>
          {f.wavelength_um.toFixed(4)} µm ± {(f.bandwidth_um / 2).toFixed(4)}
        </dd>
      </div>
      <div>
        <dt>Visit / detector</dt>
        <dd>
          {e.pass} / {e.detector} · {e.collection}
        </dd>
      </div>
      <div>
        <dt>Catalogue pixel</dt>
        <dd>
          ({f.target_xy[0].toFixed(2)}, {f.target_xy[1].toFixed(2)})
        </dd>
      </div>
      <div>
        <dt>Photometry</dt>
        <dd>
          {f.photometry.flux_mjy != null
            ? `${f.photometry.flux_mjy.toFixed(3)} ± ${f.photometry.error_mjy?.toFixed(3)} mJy`
            : "Unavailable (saturated)"}{" "}
          <span className="quality">{f.photometry.quality}</span>
        </dd>
      </div>
      <div>
        <dt>Background / noise</dt>
        <dd>
          {f.background?.toFixed(3) ?? "—"} / {f.noise?.toFixed(3) ?? "—"} MJy/sr
        </dd>
      </div>
      <div>
        <dt>Valid pixels</dt>
        <dd>{(f.valid_fraction * 100).toFixed(0)}%</dd>
      </div>
      <div>
        <dt>Cutout</dt>
        <dd>
          {grid.size}² · {grid.fov_deg}° · {mode} · {filteredCount} frames
        </dd>
      </div>
    </dl>
  );
}
