import {
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
import { computeDisplayLimits } from "./data/contract";
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
import { MotionStory } from "./ui/MotionStory";
import { ViewerGuide } from "./ui/ViewerGuide";
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

type LoadState =
  | { status: "idle" }
  | { status: "loading"; message: string; loaded?: number; total?: number }
  | { status: "error"; message: string }
  | { status: "ready"; data: DecodedBundle };

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
  const [demoPhase, setDemoPhase] = useState<DemoPhase>("idle");
  const [demoLine, setDemoLine] = useState("");
  const [showBriefing, setShowBriefing] = useState(() => {
    try {
      return sessionStorage.getItem("spx-briefing-done") !== "1";
    } catch {
      return true;
    }
  });
  const stageRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const demoTimer = useRef<number | null>(null);

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
      setDisplayPx(Math.max(280, Math.min(720, Math.floor(w))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loadKnownTarget = useCallback(
    async (key: string, signal: AbortSignal) => {
      const known = targetByKey(key);
      if (!known) {
        setLoad({ status: "error", message: `Unknown target “${key}”.` });
        return;
      }
      if (!known.bundleUrl) {
        setLoad({
          status: "error",
          message: `${known.label} is not ready yet. Try Barnard's Star — it works offline from the sample.`,
        });
        return;
      }
      setLoad({ status: "loading", message: `Loading ${known.label}…` });
      const bundle = await fetchBundle(known.bundleUrl, signal);
      if (signal.aborted) return;
      const data = decodeBundle(bundle);
      setLoad({ status: "ready", data });
      patchView({
        targetKey: key,
        frameIndex: 0,
        pass: null,
        detector: null,
        query: known.label,
      });
      setSearchInput(known.label);
    },
    [patchView],
  );

  const loadFromService = useCallback(
    async (target: Target, signal: AbortSignal) => {
      setLoad({ status: "loading", message: "Looking up this patch of sky…" });
      const { target: t, grid, exposures } = await fetchExposures(target, {}, signal);
      if (signal.aborted) return;
      if (exposures.length === 0) {
        setLoad({
          status: "error",
          message: "SPHEREx has no images here yet. Try Barnard's Star.",
        });
        return;
      }

      const preferred = exposures.filter((e) => e.detector === 2);
      const queue =
        preferred.length > 0
          ? preferred
          : exposures.filter((e) => e.detector === exposures[0]!.detector);

      const frames: Frame[] = new Array(queue.length);
      let loaded = 0;
      setLoad({
        status: "loading",
        message: `Loading images…`,
        loaded: 0,
        total: queue.length,
      });

      await loadFramesProgressive(
        queue,
        t,
        grid,
        (frame, index) => {
          frames[index] = frame;
          loaded += 1;
          if (loaded === queue.length || loaded === 1 || loaded % 8 === 0) {
            const present = frames.filter(Boolean) as Frame[];
            const partial: Bundle = {
              format: "spherex-explorer/bundle",
              version: 1,
              generated: new Date().toISOString(),
              target: t,
              grid,
              exposures: queue,
              frames: present,
            };
            startTransition(() => {
              setLoad({
                status: "ready",
                data: decodeBundle(partial),
              });
            });
          }
          setLoad((prev) =>
            prev.status === "loading"
              ? {
                  ...prev,
                  loaded,
                  total: queue.length,
                  message: `Loading images… ${loaded}/${queue.length}`,
                }
              : prev,
          );
        },
        { signal },
      );

      const finalBundle: Bundle = {
        format: "spherex-explorer/bundle",
        version: 1,
        generated: new Date().toISOString(),
        target: t,
        grid,
        exposures: queue,
        frames: frames.filter(Boolean) as Frame[],
      };
      setLoad({ status: "ready", data: decodeBundle(finalBundle) });
      patchView({ targetKey: "custom", frameIndex: 0, query: t.name ?? `${t.ra}, ${t.dec}` });
    },
    [patchView],
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
        setSplitVisits((v) => !v);
        patchView({ playing: false, mode: "single" });
      }
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        setBlinkPasses(false);
        setSplitVisits(false);
        setGhostVisits((v) => !v);
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
    patchView({ playing: false, pass: null, mode: "single" });
  }

  function runAutoDemo() {
    if (load.status !== "ready") return;
    if (demoTimer.current != null) window.clearTimeout(demoTimer.current);
    setSplitVisits(false);
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
        patchView({
          mode: "single",
          pass: null,
          frameIndex: 0,
          playing: beat.phase === "play",
        });
      } else if (beat.phase === "blink") {
        setSplitVisits(false);
        patchView({ mode: "single", playing: false, frameIndex: 0 });
        setBlinkPasses(true);
      } else if (beat.phase === "difference") {
        setBlinkPasses(false);
        setSplitVisits(false);
        patchView({
          mode: "difference",
          playing: false,
          pass: null,
          diffPassA: passes[0] ?? 1,
          diffPassB: passes[passes.length - 1] ?? 3,
        });
      } else if (beat.phase === "done") {
        setBlinkPasses(false);
        patchView({ playing: false });
      }
      i += 1;
      demoTimer.current = window.setTimeout(step, beat.ms);
    };
    step();
  }

  const visitStacks = useMemo(() => {
    if (load.status !== "ready" || passes.length < 2) return null;
    if (!splitVisits && !ghostVisits) return null;
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
  }, [load, splitVisits, ghostVisits, passes, forDifference, view.contrast]);

  const splitStacks = splitVisits ? visitStacks : null;
  const ghostStacks = ghostVisits ? visitStacks : null;

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    const raw = searchInput.trim();
    if (!raw) return;
    const ac = new AbortController();
    try {
      const known = KNOWN_TARGETS.find(
        (t) => t.label.toLowerCase() === raw.toLowerCase() || t.key === raw.toLowerCase(),
      );
      if (known?.bundleUrl) {
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
            onClick={() => patchView({ showHelp: !view.showHelp })}
          >
            Quick guide
          </button>
        </div>
      </header>

      {demoPhase !== "idle" && <AutoDemoBanner line={demoLine} onSkip={stopAutoDemo} />}

      <HelpPanel open={view.showHelp} onClose={() => patchView({ showHelp: false })} />

      <section className="picker" aria-label="Choose a star">
        <div className="picker-head">
          <h2>Pick a star</h2>
          <p>Start with Barnard's Star — it moves the fastest of any nearby star.</p>
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
              disabled={!t.bundleUrl && t.key !== view.targetKey}
            >
              <span className="target-name">{t.label}</span>
              <span className="target-blurb">{t.bundleUrl ? t.blurb : "Coming soon"}</span>
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
            placeholder="Or type a name / sky coordinates"
            autoComplete="off"
          />
          <button type="submit" className="primary">
            Look up
          </button>
        </form>
      </section>

      <nav className="mode-tabs" aria-label="What do you want to do?">
        {(
          [
            ["watch", "1 · Watch the movie"],
            ["compare", "2 · Blink visits"],
            ["difference", "3 · Show the move"],
            ["more", "More views"],
          ] as [UiMode, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={uiMode === id ? "active" : ""}
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
              <p className="stage-kicker">Now viewing</p>
              <h2 className="stage-title">{targetName}</h2>
            </div>
            <div className="stage-actions">
              <p className="kbd-hint" title="Keyboard shortcuts">
                J · G · S · B · D · F
              </p>
              <button type="button" className="primary" onClick={() => void toggleFullscreen()}>
                Fullscreen
              </button>
            </div>
          </div>

          <div className="stage-measure" ref={measureRef}>
            {load.status === "loading" && (
              <div className="status-banner">
                {load.message}
                {load.total != null && load.loaded != null && (
                  <progress value={load.loaded} max={load.total} />
                )}
              </div>
            )}
            {load.status === "error" && <div className="status-banner error">{load.message}</div>}

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

          {load.status === "ready" && (
            <MotionStory target={load.data.target} grid={load.data.grid} trail={trail} />
          )}

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
                  onClick={() => {
                    setBlinkPasses(false);
                    setSplitVisits(false);
                    setGhostVisits((v) => !v);
                    patchView({ playing: false, mode: "single" });
                  }}
                >
                  Ghost sky
                </button>
                <button
                  type="button"
                  className={splitVisits ? "active" : ""}
                  disabled={passes.length < 2}
                  onClick={() => {
                    setBlinkPasses(false);
                    setGhostVisits(false);
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
          <div className="rail-card">
            <h3>Controls for this step</h3>
            <p className="rail-hint">
              Only the buttons for the selected step are active. Switch steps with the tabs above.
            </p>

            {uiMode === "watch" && (
              <div className="control-block">
                <p className="control-label">Which visit to play</p>
                <div className="chip-row">
                  <button
                    type="button"
                    className={view.pass == null ? "active" : ""}
                    onClick={() => patchView({ pass: null, frameIndex: 0 })}
                  >
                    All visits
                  </button>
                  {passes.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={view.pass === p ? "active" : ""}
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
                    onClick={() => patchView({ waveUm: null, frameIndex: 0 })}
                  >
                    All colors
                  </button>
                  <button
                    type="button"
                    className={view.waveUm != null ? "active" : ""}
                    disabled={!display || !("meta" in display) || !display.meta}
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
            <div className="rail-card">
              <Charts
                frames={filtered}
                activeIndex={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                onSelectFrame={(index) => {
                  setBlinkPasses(false);
                  patchView({ frameIndex: index, playing: false, mode: "single" });
                }}
              />
            </div>
          )}

          <details
            className="rail-card details"
            open={showAdvanced}
            onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
          >
            <summary>Technical details</summary>
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
