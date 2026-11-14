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
  stackByPass,
  stackFrames,
  stackPassClean,
  stackTrackingTarget,
} from "./compose/stack";
import {
  ApiError,
  fetchBundle,
  fetchExposures,
  fetchSpectrum,
  loadFramesProgressive,
  resolveName,
} from "./data/client";
import type { Bundle, Frame, Grid, Target } from "./data/contract";
import { computeDisplayLimits, mjdToDate } from "./data/contract";
import { type DecodedBundle, type DecodedFrame, decodeBundle } from "./data/decode";
import {
  clearSampleIndexCache,
  detectorBundleUrl,
  fetchSampleIndex,
  INDEX_KEY_BY_UI,
  orderedDetectors,
  sampleTargetByUiKey,
  spectrumFileUrl,
} from "./data/sampleIndex";
import { KNOWN_TARGETS, targetByKey } from "./data/targets";
import { Charts } from "./spectrum/Charts";
import { fetchSpectrumFile, type SpectrumPoint } from "./spectrum/spectrumPoints";
import { wavelengthHue } from "./spectrum/waveHue";
import {
  readSkyFromUrl,
  readViewFromUrl,
  type TargetExtras,
  type ViewState,
  writeViewToUrl,
} from "./state/url";
import { AutoDemoBanner, DEMO_BEATS, type DemoPhase } from "./ui/AutoDemo";
import { type DetectorBand, DetectorDial } from "./ui/DetectorDial";
import { FrameCaption } from "./ui/FrameCaption";
import { GhostVisits } from "./ui/GhostVisits";
import { HealthBadge } from "./ui/HealthBadge";
import { HelpPanel } from "./ui/HelpPanel";
import { type HopProofPick, HopProofStrip } from "./ui/HopProofStrip";
import { MissionBriefing } from "./ui/MissionBriefing";
import { MotionInsight } from "./ui/MotionInsight";
import { PassStackMovie } from "./ui/PassStackMovie";
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

type LoadState =
  | { status: "idle" }
  | { status: "loading"; message: string; loaded?: number; total?: number }
  | { status: "error"; message: string; retryable?: boolean }
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
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [spectrumPoints, setSpectrumPoints] = useState<SpectrumPoint[] | null>(null);
  const [spectrumWaiting, setSpectrumWaiting] = useState(false);
  const [skyTarget, setSkyTarget] = useState<TargetExtras | null>(() => readSkyFromUrl());
  const skyTargetRef = useRef(skyTarget);
  skyTargetRef.current = skyTarget;
  const [displayPx, setDisplayPx] = useState(400);
  const [splitVisits, setSplitVisits] = useState(false);
  const [ghostVisits, setGhostVisits] = useState(false);
  const [spotMover, setSpotMover] = useState(false);
  /** Tommy item 5: cycle clean per-pass stacks (WISE default on). */
  const [passMovie, setPassMovie] = useState(false);
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
    const indexKey =
      view.targetKey === "custom"
        ? null
        : (INDEX_KEY_BY_UI[view.targetKey || "barnard"] ?? (view.targetKey || "barnard-star"));
    if (indexKey) url.searchParams.set("target", indexKey);
    const href = url.toString();
    void navigator.clipboard.writeText(href).then(() => {
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  const [hopLinkCopied, setHopLinkCopied] = useState(false);

  const patchView = useCallback((partial: Partial<ViewState>) => {
    setView((prev) => {
      const next = { ...prev, ...partial };
      writeViewToUrl(next, true, skyTargetRef.current);
      return next;
    });
  }, []);

  useEffect(() => {
    const onPop = () => {
      const next = readViewFromUrl();
      setView(next);
      setSkyTarget(readSkyFromUrl());
      setSearchInput(next.query);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const update = () => {
      // Classic desk: square fits the viewport with chrome. no page scroll.
      const colW = el.clientWidth;
      const maxByWidth = Math.floor(colW - 12);
      const maxByHeight = Math.floor(window.innerHeight * 0.52);
      const px = Math.max(280, Math.min(440, maxByWidth, maxByHeight));
      setDisplayPx(px);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const loadFromService = useCallback(
    async (target: Target, signal: AbortSignal, targetKey: string = "custom") => {
      setLoad({ status: "loading", message: "SPHEREx archive. listing exposures…" });
      setSpectrumPoints(null);
      setSpectrumWaiting(true);
      if (targetKey === "custom") {
        const extras: TargetExtras = {
          ra: target.ra,
          dec: target.dec,
          epoch: target.epoch ?? 2000,
          pm_ra: target.pm_ra ?? null,
          pm_dec: target.pm_dec ?? null,
        };
        skyTargetRef.current = extras;
        setSkyTarget(extras);
      } else {
        skyTargetRef.current = null;
        setSkyTarget(null);
      }
      // Spectrum in parallel with exposures/frames (chart waits separately, images do not).
      const spectrumTask = fetchSpectrum(target, {}, signal)
        .then((res) => {
          if (!signal.aborted) setSpectrumPoints(res.points);
        })
        .catch(() => {
          if (!signal.aborted) setSpectrumPoints(null);
        })
        .finally(() => {
          if (!signal.aborted) setSpectrumWaiting(false);
        });

      const { target: t, grid, exposures } = await fetchExposures(target, {}, signal);
      if (signal.aborted) return;
      if (exposures.length === 0) {
        setSpectrumWaiting(false);
        setLoad({
          status: "error",
          message: "SPHEREx has not observed this place yet. Try another name or Barnard's Star.",
          retryable: true,
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
            message: `SPHEREx archive. detector ${det}…`,
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
                    message: `Archive. D${det} ${batchLoaded}/${queue.length} · ${loadedTotal}/${grandTotal}`,
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
      await spectrumTask;
      const known = targetByKey(targetKey);
      if (targetKey !== "custom") {
        applyPresetDefaults(targetKey, known?.label ?? t.name ?? targetKey);
      } else {
        setTimelineOpen(true);
      }
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
      setSpectrumPoints(null);
      skyTargetRef.current = null;
      setSkyTarget(null);
      clearSampleIndexCache();

      // Tommy Need: target/grid come from index.json (correct epoch + PM), not stale targets.ts.
      let indexEntry: ReturnType<typeof sampleTargetByUiKey>;
      try {
        const index = await fetchSampleIndex(signal);
        indexEntry = sampleTargetByUiKey(index, key);
      } catch {
        indexEntry = undefined;
      }
      const indexTarget = indexEntry?.target;
      const liveTarget: Target | null = indexTarget
        ? { ...indexTarget }
        : known.ra != null && known.dec != null
          ? {
              name: known.label,
              ra: known.ra,
              dec: known.dec,
              epoch: 2000,
              pm_ra: known.pm_ra ?? null,
              pm_dec: known.pm_dec ?? null,
            }
          : null;

      if (preferLive && liveTarget) {
        setLoad({ status: "loading", message: `Loading ${known.label} from SPHEREx archive…` });
        await loadFromService(liveTarget, signal, key);
        return;
      }

      // B6: samples/index.json → preferred detector first, then others in background.
      try {
        const entry = indexEntry;
        if (entry && entry.detectors.length > 0) {
          // Spectrum file in parallel with first bundle (tens of kB): chart can paint
          // before multi-MB detector JSON finishes (Tommy Need item 2).
          if (entry.spectrum) {
            void (async () => {
              try {
                const pts = await fetchSpectrumFile(spectrumFileUrl(entry.spectrum!.file), signal);
                if (!signal.aborted) setSpectrumPoints(pts);
              } catch {
                if (!signal.aborted) setSpectrumPoints(null);
              }
            })();
          } else if (!signal.aborted) {
            setSpectrumPoints(null);
          }
          const order = orderedDetectors(key, entry);
          const first = order[0]!;
          setLoad({
            status: "loading",
            message: `Loading ${known.label}. detector ${first.detector}…`,
          });
          const firstBundle = await fetchBundle(detectorBundleUrl(first.file), signal);
          if (signal.aborted) return;
          let merged = decodeBundle(firstBundle);
          setLoad({ status: "ready", data: merged, source: "sample" });
          // First paint on preferred detector; full defaults after cascade.
          patchView({
            targetKey: key,
            frameIndex: 0,
            pass: null,
            detector: first.detector,
            query: known.label,
            playing: false,
            mode: "single",
          });
          setSearchInput(known.label);

          for (let i = 1; i < order.length; i++) {
            if (signal.aborted) return;
            const det = order[i]!;
            const nextBundle = await fetchBundle(detectorBundleUrl(det.file), signal);
            if (signal.aborted) return;
            const next = decodeBundle(nextBundle);
            merged = {
              target: merged.target,
              grid: merged.grid,
              exposures: [...merged.exposures, ...next.exposures],
              frames: [...merged.frames, ...next.frames],
              limits: computeDisplayLimits([
                ...merged.frames.map((f) => ({
                  pixels: f.pixels,
                  background: f.frame.background,
                  noise: f.frame.noise,
                  mask: f.mask,
                })),
                ...next.frames.map((f) => ({
                  pixels: f.pixels,
                  background: f.frame.background,
                  noise: f.frame.noise,
                  mask: f.mask,
                })),
              ]),
            };
            startTransition(() => {
              setLoad({ status: "ready", data: merged, source: "sample" });
            });
          }
          applyPresetDefaults(key, known.label);
          return;
        }
      } catch {
        // Fall through to legacy single bundle or archive.
      }

      if (!known.bundleUrl) {
        if (liveTarget) {
          setLoad({ status: "loading", message: `Loading ${known.label} from SPHEREx archive…` });
          await loadFromService(liveTarget, signal, key);
          return;
        }
        setLoad({
          status: "error",
          message: `${known.label} needs a sample bundle or coordinates. Try Barnard's Star.`,
        });
        return;
      }
      setLoad({ status: "loading", message: `Loading ${known.label}…` });
      const bundle = await fetchBundle(known.bundleUrl, signal);
      if (signal.aborted) return;
      const data = decodeBundle(bundle);
      setLoad({ status: "ready", data, source: "sample" });
      applyPresetDefaults(key, known.label);
    },
    [patchView, loadFromService],
  );

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        if (view.targetKey === "custom" && view.query) {
          const sky = readSkyFromUrl();
          const coords = sky ?? parseCoordinateQuery(view.query);
          if (coords) {
            await loadFromService(
              {
                ra: coords.ra,
                dec: coords.dec,
                epoch: "epoch" in coords && coords.epoch != null ? coords.epoch : 2000,
                pm_ra: "pm_ra" in coords ? (coords.pm_ra ?? null) : null,
                pm_dec: "pm_dec" in coords ? (coords.pm_dec ?? null) : null,
              },
              ac.signal,
            );
            return;
          }
          const target = await resolveName(view.query, ac.signal);
          await loadFromService(target, ac.signal);
          return;
        }
        await loadKnownTarget(view.targetKey || "barnard", ac.signal);
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof ApiError) {
          if (err.status === 404 || err.code === "not_found") {
            setLoad({
              status: "error",
              message: "Unknown name, try coordinates.",
              retryable: true,
            });
            return;
          }
          if (err.status === 503) {
            setLoad({
              status: "error",
              message: err.message || "Archive busy. Try again in a moment.",
              retryable: true,
            });
            return;
          }
          setLoad({ status: "error", message: err.message, retryable: true });
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to load data";
        setLoad({ status: "error", message, retryable: true });
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
      // Tommy item 5: clean mean (mask === 0 only) when stacking a locked visit.
      const stacked = view.pass != null ? stackPassClean(filtered) : stackFrames(filtered);
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
  const detectorBands: DetectorBand[] = useMemo(() => {
    if (load.status !== "ready") return [];
    return detectors.map((d) => {
      const frames = load.data.frames.filter((f) => f.exposure.detector === d);
      const waves = frames.map((f) => f.frame.wavelength_um);
      return {
        detector: d,
        waveMin: Math.min(...waves),
        waveMax: Math.max(...waves),
        frames: frames.length,
      };
    });
  }, [load, detectors]);
  const uiMode = uiModeFromView(view.mode, blinkPasses);
  const overlayActive = ghostVisits || splitVisits || spotMover;

  /** Blend / side-by-side / spot / blink must never stack. leftover flags cause broken stage visuals. */
  function clearPresentationOverlays() {
    setBlinkPasses(false);
    setGhostVisits(false);
    setSplitVisits(false);
    setSpotMover(false);
    setPassMovie(false);
  }

  /** Tommy B4: each preset opens in the view that shows what it’s for. */
  function applyPresetDefaults(key: string, label: string) {
    clearPresentationOverlays();
    setSearchInput(label);
    if (key === "wise0855") {
      // Faint. only visible when stacking detector 6 visits as a short movie.
      patchView({
        targetKey: key,
        query: label,
        frameIndex: 0,
        pass: null,
        detector: 6,
        mode: "stack",
        playing: false,
        waveUm: null,
      });
      setPassMovie(true);
      setTimelineOpen(false);
      return;
    }
    if (key === "epsindi" || key === "rwaur") {
      // Spectrum / variable. show the infrared timeline.
      patchView({
        targetKey: key,
        query: label,
        frameIndex: 0,
        pass: null,
        detector: null,
        mode: "single",
        playing: false,
        waveUm: null,
      });
      setTimelineOpen(true);
      return;
    }
    // Barnard / R Dra: few flux points + "too bright" line belong on the timeline.
    patchView({
      targetKey: key,
      query: label,
      frameIndex: 0,
      pass: null,
      detector: null,
      mode: "single",
      playing: false,
      waveUm: null,
    });
    setTimelineOpen(key === "barnard" || key === "rdra");
  }

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
    // Every top-level mode starts clean: no blend/split/spot/blink leftovers.
    clearPresentationOverlays();
    if (next === "watch") {
      patchView({ mode: "single", pass: null, frameIndex: 0, playing: false });
      return;
    }
    if (next === "compare") {
      patchView({ mode: "single", pass: null, playing: false, frameIndex: 0 });
      setBlinkPasses(true);
      return;
    }
    if (next === "difference") {
      patchView({
        mode: "difference",
        pass: null,
        playing: false,
        frameIndex: 0,
        waveUm: null,
        diffPassA: passes[0] ?? 1,
        diffPassB: passes[passes.length - 1] ?? 3,
      });
      return;
    }
    // More views. start on average stack with no visit lock leftovers.
    patchView({ mode: "stack", playing: false, frameIndex: 0, pass: null });
  }

  // Keyboard shortcuts. ignore while typing in fields.
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
        clearPresentationOverlays();
        if (blinkPasses || overlayActive) {
          patchView({ pass: null, mode: "single", playing: false });
        }
        return;
      }
      if (e.key === " " || e.key === "k" || e.key === "K") {
        e.preventDefault();
        clearPresentationOverlays();
        if (view.mode !== "single") {
          patchView({ mode: "single", playing: !view.playing, frameIndex: 0 });
        } else {
          patchView({ playing: !view.playing, mode: "single" });
        }
        return;
      }
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        if (blinkPasses) {
          clearPresentationOverlays();
          patchView({ pass: null, mode: "single", playing: false });
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
        const next = !splitVisits;
        clearPresentationOverlays();
        setSplitVisits(next);
        patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
      }
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        const next = !ghostVisits;
        clearPresentationOverlays();
        setGhostVisits(next);
        patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        const next = !spotMover;
        clearPresentationOverlays();
        setSpotMover(next);
        patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
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
    ghostVisits,
    spotMover,
    overlayActive,
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
      } else if (beat.phase === "done") {
        setBlinkPasses(false);
        setGhostVisits(false);
        patchView({ playing: false, mode: "single" });
        window.requestAnimationFrame(() => {
          document.querySelector(".motion-insight")?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        });
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

  const passStackMovie = useMemo(() => {
    if (!passMovie || load.status !== "ready") return null;
    const pool =
      view.detector != null
        ? load.data.frames.filter((f) => f.exposure.detector === view.detector)
        : load.data.frames;
    const stacks = stackByPass(pool);
    if (stacks.length < 2) return null;
    const first = stacks[0]!;
    const last = stacks[stacks.length - 1]!;
    const n = first.stack.pixels.length;
    const diffPixels = new Float32Array(n);
    const diffMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const va = last.stack.pixels[i]!;
      const vb = first.stack.pixels[i]!;
      diffMask[i] = last.stack.mask[i]! | first.stack.mask[i]!;
      diffPixels[i] = Number.isNaN(va) || Number.isNaN(vb) ? Number.NaN : va - vb;
    }
    const limits = applyContrast(
      computeDisplayLimits([
        ...stacks.map((s) => ({
          pixels: s.stack.pixels,
          mask: s.stack.mask,
          background: 0,
          noise: s.stack.noise,
        })),
        { pixels: diffPixels, mask: diffMask, background: 0, noise: null },
      ]),
      view.contrast,
    );
    const xy = pool[0]?.frame.target_xy ?? null;
    return {
      size: load.data.grid.size,
      limits,
      targetXy: xy,
      stacks: stacks.map((s) => ({
        pass: s.pass,
        pixels: s.stack.pixels,
        mask: s.stack.mask,
        label: `Visit ${s.pass} average (clean stack)`,
      })),
      diff: {
        pass: last.pass,
        pixels: diffPixels,
        mask: diffMask,
        label: `Visit ${last.pass} minus Visit ${first.pass}`,
      },
    };
  }, [passMovie, load, view.detector, view.contrast]);

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

  /** Always-on early | diff | late proof under the square (independent of overlay flags). */
  const hopProof = useMemo(() => {
    if (load.status !== "ready" || passes.length < 2 || !storyboard) return null;
    const a = passes[0]!;
    const b = passes[passes.length - 1]!;
    const early = storyboard.cells.find((c) => c.pass === a);
    const late = storyboard.cells.find((c) => c.pass === b);
    if (!early || !late) return null;
    const diff = differencePasses(forDifference, a, b);
    const limits = applyContrast(
      computeDisplayLimits([
        {
          pixels: early.pixels,
          mask: early.mask,
          background: 0,
          noise: null,
        },
        {
          pixels: late.pixels,
          mask: late.mask,
          background: 0,
          noise: null,
        },
        {
          pixels: diff.pixels,
          mask: diff.mask,
          background: 0,
          noise: null,
        },
      ]),
      view.contrast,
    );
    const earlyBead = trail.find((t) => t.pass === a);
    const lateBead = trail.find((t) => t.pass === b);
    return {
      a,
      b,
      size: storyboard.size,
      limits,
      early: {
        pixels: early.pixels,
        mask: early.mask,
        label: `Visit ${a}`,
        sub: `${early.dateLabel}. jump to this visit`,
      },
      late: {
        pixels: late.pixels,
        mask: late.mask,
        label: `Visit ${b}`,
        sub: `${late.dateLabel}. jump to this visit`,
      },
      diff: {
        pixels: diff.pixels,
        mask: diff.mask,
        label: "Diff",
        sub: `Visit ${a} − Visit ${b}. bright/dark = motion`,
      },
      earlyXy: earlyBead ? ([earlyBead.x, earlyBead.y] as [number, number]) : null,
      lateXy: lateBead ? ([lateBead.x, lateBead.y] as [number, number]) : null,
    };
  }, [load, passes, storyboard, forDifference, view.contrast, trail]);

  const hopProofActive: HopProofPick | null = blinkPasses
    ? null
    : view.mode === "difference"
      ? "diff"
      : view.mode === "single" && view.pass === hopProof?.a
        ? "early"
        : view.mode === "single" && view.pass === hopProof?.b
          ? "late"
          : null;

  function onHopProofPick(pick: HopProofPick) {
    if (!hopProof) return;
    clearPresentationOverlays();
    if (pick === "diff") {
      patchView({
        mode: "difference",
        pass: null,
        playing: false,
        frameIndex: 0,
        waveUm: null,
        diffPassA: hopProof.a,
        diffPassB: hopProof.b,
      });
      return;
    }
    patchView({
      mode: "single",
      pass: pick === "early" ? hopProof.a : hopProof.b,
      playing: false,
      frameIndex: 0,
    });
  }

  function copyHopLink() {
    if (!hopProof) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("target", view.targetKey || "barnard");
    url.searchParams.set("mode", "difference");
    url.searchParams.set("a", String(hopProof.a));
    url.searchParams.set("b", String(hopProof.b));
    void navigator.clipboard.writeText(url.toString()).then(() => {
      setHopLinkCopied(true);
      window.setTimeout(() => setHopLinkCopied(false), 2000);
    });
  }

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
      if (err instanceof ApiError && (err.status === 404 || err.code === "not_found")) {
        setLoad({
          status: "error",
          message: "Unknown name, try coordinates.",
          retryable: true,
        });
        return;
      }
      if (err instanceof ApiError && err.status === 503) {
        setLoad({
          status: "error",
          message: err.message || "Archive busy. Try again in a moment.",
          retryable: true,
        });
        return;
      }
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Search failed";
      setLoad({ status: "error", message, retryable: true });
    }
  }

  function retryLoad() {
    // Re-trigger the targetKey effect by bumping query whitespace, then trim back.
    const q = view.query;
    patchView({ query: q });
    const ac = new AbortController();
    void (async () => {
      try {
        if (view.targetKey === "custom" && view.query) {
          const sky = readSkyFromUrl();
          const coords = sky ?? parseCoordinateQuery(view.query);
          if (coords) {
            await loadFromService(
              {
                ra: coords.ra,
                dec: coords.dec,
                epoch: "epoch" in coords && coords.epoch != null ? coords.epoch : 2000,
                pm_ra: "pm_ra" in coords ? (coords.pm_ra ?? null) : null,
                pm_dec: "pm_dec" in coords ? (coords.pm_dec ?? null) : null,
              },
              ac.signal,
            );
            return;
          }
          setLoad({ status: "loading", message: `Looking up “${view.query}”…` });
          const target = await resolveName(view.query, ac.signal);
          await loadFromService(target, ac.signal);
          return;
        }
        await loadKnownTarget(view.targetKey || "barnard", ac.signal);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.code === "not_found")) {
          setLoad({
            status: "error",
            message: "Unknown name, try coordinates.",
            retryable: true,
          });
          return;
        }
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Retry failed";
        setLoad({ status: "error", message, retryable: true });
      }
    })();
  }

  const targetName =
    load.status === "ready"
      ? (load.data.target.name ?? view.query)
      : view.query || "Barnard's Star";

  const guideMode =
    blinkPasses || uiMode === "compare"
      ? "blink"
      : ghostVisits
        ? "blend"
        : splitVisits
          ? "split"
          : uiMode === "difference"
            ? "difference"
            : view.mode === "stack"
              ? "stack"
              : view.mode === "track"
                ? "track"
                : "watch";

  const cinema = load.status === "ready";

  return (
    <div className={cinema ? "app app--fit app--ready" : "app app--fit"}>
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
          <h1 className="brand">SPHEREx Explorer</h1>
          <p className="tagline">Watch the near-infrared sky move. NASA Space Apps 2026</p>
        </div>
        <div className="top-actions">
          <HealthBadge />
          <button
            type="button"
            className="ghost"
            disabled={load.status !== "ready" || demoPhase !== "idle"}
            onClick={() => runAutoDemo()}
            title="Timed walkthrough for judges (J)"
          >
            Demo
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => copyJudgeLink()}
            title="Copy a link that auto-starts the jury demo"
          >
            {linkCopied ? "Copied" : "Link"}
          </button>
          <button
            type="button"
            className="ghost"
            title="Short how-to: play, blink, blend, difference"
            onClick={() => patchView({ showHelp: !view.showHelp })}
          >
            Help
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
          {load.status !== "ready" && <h2>Pick a star</h2>}
          {load.status !== "ready" && (
            <p>Start with Barnard's Star. or type any name; live resolve finds the sky position.</p>
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
              disabled={!t.inSampleIndex && !t.bundleUrl && (t.ra == null || t.dec == null)}
              title={t.blurb}
            >
              <span className="target-name">{t.label}</span>
              <span className="target-blurb">{t.blurb}</span>
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
            ["watch", "Watch", "Play infrared frames. each frame is a slightly different color"],
            ["compare", "Blink", "Flip early ↔ late visits so the hop is obvious"],
            ["difference", "Move", "Subtract two visits: bright/dark pair = motion"],
            ["more", "More", "Average stack, tracking, and filters"],
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

      <main className={`workspace${cinema ? " workspace--fit" : ""}`}>
        <section className="stage" ref={stageRef}>
          <div className="stage-bar">
            <div>
              <h2 className="stage-title">
                {targetName}
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
              </h2>
            </div>
            <div className="stage-actions">
              {(() => {
                const known = targetByKey(view.targetKey);
                const showArchive =
                  known != null &&
                  (known.inSampleIndex
                    ? load.status === "ready" && load.source === "live"
                    : known.ra != null);
                if (!showArchive) return null;
                return (
                  <button
                    type="button"
                    className="ghost"
                    disabled={load.status === "loading"}
                    title="Load cutouts from the SPHEREx survey archive (past visits)."
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
                    Archive
                  </button>
                );
              })()}
            </div>
          </div>

          {/* Invisible width probe: column width, not the square box (avoids circular sizing). */}
          <div className="stage-width-probe" ref={measureRef} aria-hidden="true" />
          <div
            className={`stage-measure${splitStacks ? " is-wide" : " is-square"}`}
            style={
              {
                ...(display?.meta?.frame.wavelength_um != null
                  ? { "--wave-hue": String(wavelengthHue(display.meta.frame.wavelength_um)) }
                  : {}),
                // Hard-size the square so we never letterbox a cutout in a wide band.
                ...(!splitStacks
                  ? { width: displayPx + 10, height: displayPx + 10 }
                  : { width: "100%" }),
              } as CSSProperties
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
            {load.status === "error" && (
              <div className="status-banner error">
                <span>{load.message}</span>
                {load.retryable && (
                  <button type="button" className="ghost" onClick={retryLoad}>
                    Retry
                  </button>
                )}
              </div>
            )}

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
                onExit={() => {
                  clearPresentationOverlays();
                  patchView({ mode: "single", playing: false });
                }}
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

            {!splitStacks && !ghostStacks && !spotStacks && passStackMovie && (
              <PassStackMovie
                stacks={passStackMovie.stacks}
                diff={passStackMovie.diff}
                size={passStackMovie.size}
                lo={passStackMovie.limits.lo}
                hi={passStackMovie.limits.hi}
                colorMap={view.colorMap}
                displayPx={displayPx}
                targetXy={passStackMovie.targetXy}
                faintHint={
                  view.targetKey === "wise0855"
                    ? "WISE 0855 is near the detection limit. Stacking each visit of detector 6 is how it can appear. If you still see almost nothing, that is part of the plan."
                    : undefined
                }
              />
            )}

            {!splitStacks &&
              !ghostStacks &&
              !spotStacks &&
              !passStackMovie &&
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

          {hopProof && (
            <div className="hop-proof-wrap">
              <HopProofStrip
                size={hopProof.size}
                lo={hopProof.limits.lo}
                hi={hopProof.limits.hi}
                colorMap={view.colorMap}
                early={hopProof.early}
                diff={hopProof.diff}
                late={hopProof.late}
                trail={trail}
                earlyXy={hopProof.earlyXy}
                lateXy={hopProof.lateXy}
                active={hopProofActive}
                onPick={onHopProofPick}
              />
              <button
                type="button"
                className="hop-share-btn"
                title="Copy a link that opens Show the move for this star"
                onClick={() => copyHopLink()}
              >
                {hopLinkCopied ? "Copied" : "Share hop"}
              </button>
            </div>
          )}

          {detectorBands.length > 1 && (
            <DetectorDial
              bands={detectorBands}
              active={view.detector}
              onPick={(detector) => {
                patchView({ detector, frameIndex: 0, playing: false });
              }}
            />
          )}

          {display && view.mode === "single" && display.kind === "single" && !blinkPasses && (
            <>
              {!overlayActive && (
                <FrameCaption
                  frames={filtered}
                  frameIndex={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                  playing={view.playing}
                />
              )}
              <div className="transport">
                <button
                  type="button"
                  className="primary play-btn"
                  title="Step through infrared wavelengths for this visit (Space)"
                  onClick={() => {
                    clearPresentationOverlays();
                    patchView({ playing: !view.playing, mode: "single" });
                  }}
                >
                  {view.playing ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  className={ghostVisits ? "active" : ""}
                  disabled={passes.length < 2}
                  title="Overlay early and late visits (G)"
                  onClick={() => {
                    const next = !ghostVisits;
                    clearPresentationOverlays();
                    setGhostVisits(next);
                    patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
                  }}
                >
                  Blend
                </button>
                <button
                  type="button"
                  className={splitVisits ? "active" : ""}
                  disabled={passes.length < 2}
                  title="Early and late side by side (S)"
                  onClick={() => {
                    const next = !splitVisits;
                    clearPresentationOverlays();
                    setSplitVisits(next);
                    patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
                  }}
                >
                  Split
                </button>
                {!overlayActive && (
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
                )}
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

          {cinema && <ViewerGuide targetName={targetName} mode={guideMode} />}
        </section>

        <aside className={`rail${cinema ? " rail--fit" : ""}`}>
          {load.status === "ready" && (
            <MotionInsight
              grid={load.data.grid}
              trail={trail}
              targetName={load.data.target.name ?? targetName}
            />
          )}

          <details className="rail-card details adjust-fold" open>
            <summary title="Visits, colors, cameras, contrast">Controls</summary>

            {load.status === "ready" && storyboard && (
              <div className="storyboard-fold-inner">
                <VisitStoryboard
                  size={storyboard.size}
                  lo={storyboard.limits.lo}
                  hi={storyboard.limits.hi}
                  colorMap={view.colorMap}
                  cells={storyboard.cells}
                  trail={trail}
                  activePass={view.pass}
                  onPickPass={(pass) => {
                    clearPresentationOverlays();
                    patchView({ mode: "single", pass, frameIndex: 0, playing: false });
                  }}
                />
              </div>
            )}

            <div className="control-panel">
              <p className="rail-hint">Only the controls for the selected step apply.</p>

              {uiMode === "watch" && (
                <div className="control-block">
                  {overlayActive ? (
                    <>
                      <p className="lead">
                        {ghostVisits
                          ? "Blend visits is on. early and late visits are overlaid."
                          : splitVisits
                            ? "Side-by-side is on. early and late visits are shown together."
                            : "Challenge overlay is on."}{" "}
                        Visit and color filters do not apply until you leave this view.
                      </p>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          clearPresentationOverlays();
                          patchView({ playing: false, mode: "single", pass: null });
                        }}
                      >
                        Back to movie
                      </button>
                    </>
                  ) : (
                    <>
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
                          title="Keep only frames near this frame’s wavelength"
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
                    </>
                  )}
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
                      className={view.mode === "stack" && !passMovie ? "active" : ""}
                      onClick={() => {
                        clearPresentationOverlays();
                        setPassMovie(false);
                        patchView({ mode: "stack", playing: false });
                      }}
                    >
                      Average stack
                    </button>
                    <button
                      type="button"
                      className={passMovie ? "active" : ""}
                      title="Mean of each visit (mask 0 only), then last minus first"
                      onClick={() => {
                        clearPresentationOverlays();
                        setPassMovie(true);
                        patchView({
                          mode: "stack",
                          pass: null,
                          playing: false,
                          detector: view.targetKey === "wise0855" ? 6 : view.detector,
                        });
                      }}
                    >
                      Stack visits movie
                    </button>
                    <button
                      type="button"
                      className={view.mode === "track" ? "active" : ""}
                      onClick={() => {
                        clearPresentationOverlays();
                        setPassMovie(false);
                        patchView({ mode: "track", playing: false });
                      }}
                    >
                      Keep star centered
                    </button>
                  </div>
                  {view.pass != null && (
                    <button
                      type="button"
                      className="ghost"
                      title="Average only this visit with clean mask pixels"
                      onClick={() => {
                        clearPresentationOverlays();
                        setPassMovie(false);
                        patchView({ mode: "stack", playing: false });
                      }}
                    >
                      Stack this pass
                    </button>
                  )}
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
            </div>
          </details>

          {load.status === "ready" && (
            <details
              className="rail-card details"
              open={timelineOpen}
              onToggle={(e) => setTimelineOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary title="Spectrum and light curve. open for Epsilon Indi B / RW Aur">
                Infrared timeline
              </summary>
              <Charts
                frames={filtered}
                spectrumPoints={spectrumPoints ?? undefined}
                spectrumWaiting={spectrumWaiting}
                highlightDetector={view.detector}
                activeIndex={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                onSelectFrame={(index) => {
                  clearPresentationOverlays();
                  patchView({ frameIndex: index, playing: false, mode: "single" });
                  setTimelineOpen(true);
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
          {f.background?.toFixed(3) ?? ". "} / {f.noise?.toFixed(3) ?? ". "} MJy/sr
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
