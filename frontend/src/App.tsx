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
  closestFrameIndex,
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
  type CandidatesFile,
  discoveryFlashLine,
  fetchCandidatesFile,
  knownAs,
} from "./data/candidates";
import {
  type CatalogKey,
  type CatalogResponse,
  type CatalogSlice,
  catalogSourceTip,
  catalogUnavailableMessage,
  fetchCatalogFile,
  gaiaSlice,
  middleFrameEpochYear,
} from "./data/catalog";
import {
  ApiError,
  fetchBundle,
  fetchCandidates,
  fetchCatalog,
  fetchExposures,
  fetchSpectrum,
  loadFramesProgressive,
  resolveName,
} from "./data/client";
import type { Bundle, Frame, Grid, Target } from "./data/contract";
import {
  computeDisplayLimits,
  MASK_BIT_LEGEND,
  mjdToDate,
  skyToPixel,
  targetAt,
} from "./data/contract";
import { type DecodedBundle, type DecodedFrame, decodeBundle } from "./data/decode";
import {
  candidatesFileUrl,
  catalogFileUrl,
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
import { CandidatesPanel } from "./ui/CandidatesPanel";
import { type DetectorBand, DetectorDial } from "./ui/DetectorDial";
import { FrameCaption } from "./ui/FrameCaption";
import { GhostVisits } from "./ui/GhostVisits";
import { HealthBadge } from "./ui/HealthBadge";
import { HelpPanel } from "./ui/HelpPanel";
import { type HopProofPick, HopProofStrip } from "./ui/HopProofStrip";
import { MatchVerdict } from "./ui/MatchVerdict";
import { MissionBriefing } from "./ui/MissionBriefing";
import { MotionInsight } from "./ui/MotionInsight";
import { PassStackMovie } from "./ui/PassStackMovie";
import { SpotTheMover } from "./ui/SpotTheMover";
import { ViewerGuide } from "./ui/ViewerGuide";
import { type StoryboardCell, VisitStoryboard } from "./ui/VisitStoryboard";
import { FrameCanvas } from "./viewer/FrameCanvas";
import { allwiseFlightPath, type TrailPoint } from "./viewer/overlays";
import { SkyPlayer } from "./viewer/SkyPlayer";

type UiMode = "watch" | "compare" | "difference" | "more";

/** Tommy item 7: live archive FOV. Sample bundles stay at the default. */
const FIELD_PRESETS = {
  default: { fov: 0.1, size: 128, label: "0.1° · 128²" },
  wide: { fov: 0.3, size: 256, label: "0.3° · 256²" },
} as const;
type FieldPreset = keyof typeof FIELD_PRESETS;

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
  /** Infrared color locked for the blink hop (matched across visits). */
  const blinkWaveRef = useRef<number | null>(null);
  /** Hide chrome; sky fills the viewport like looking through an eyepiece (E). */
  const [eyepiece, setEyepiece] = useState(false);
  /** Brief double-exposure of the previous visit while blinking (hop afterimage). */
  const [hopGhost, setHopGhost] = useState<{
    pixels: Float32Array;
    mask: Uint8Array;
    size: number;
    lo: number;
    hi: number;
    background: number | null;
    targetXy: [number, number] | null;
    pass: number | null;
  } | null>(null);
  const hopSnapRef = useRef<{
    pixels: Float32Array;
    mask: Uint8Array;
    size: number;
    lo: number;
    hi: number;
    background: number | null;
    targetXy: [number, number] | null;
    pass: number | null;
  } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(true);
  /** Tommy item 6: tint non-zero mask pixels on the stage. */
  const [tintMask, setTintMask] = useState(false);
  /** Tommy F8: catalog overlay switches (off until first asked). */
  const [showGaia, setShowGaia] = useState(false);
  const [showAllwise, setShowAllwise] = useState(false);
  const [catalogFile, setCatalogFile] = useState<CatalogResponse | null>(null);
  /** Gaia slice with optional tight-FOV refill when the view catalog is truncated. */
  const [gaiaForKnownAs, setGaiaForKnownAs] = useState<CatalogSlice | null>(null);
  const [catalogWaiting, setCatalogWaiting] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogTip, setCatalogTip] = useState<string | null>(null);
  const [catalogHighlightId, setCatalogHighlightId] = useState<string | null>(null);
  const [fieldPreset, setFieldPreset] = useState<FieldPreset>("default");
  const fieldPresetRef = useRef<FieldPreset>("default");
  fieldPresetRef.current = fieldPreset;
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [spectrumPoints, setSpectrumPoints] = useState<SpectrumPoint[] | null>(null);
  const [spectrumWaiting, setSpectrumWaiting] = useState(false);
  const [candidatesFile, setCandidatesFile] = useState<CandidatesFile | null>(null);
  const [candidatesWaiting, setCandidatesWaiting] = useState(false);
  const [activeCandidate, setActiveCandidate] = useState<number | null>(null);
  /** Brief stage whisper when the service first finds a target mover. */
  const [discoveryFlash, setDiscoveryFlash] = useState<string | null>(null);
  const [discoveryIsHalo, setDiscoveryIsHalo] = useState(false);
  /** Expanding ring on stage when the target was read through its saturated halo. */
  const [haloPulse, setHaloPulse] = useState<{
    xFrac: number;
    yFrac: number;
    rPx: number;
  } | null>(null);
  const discoverySeenRef = useRef<string | null>(null);
  const [skyTarget, setSkyTarget] = useState<TargetExtras | null>(() => readSkyFromUrl());
  const skyTargetRef = useRef(skyTarget);
  skyTargetRef.current = skyTarget;
  const [displayPx, setDisplayPx] = useState(400);
  const [splitVisits, setSplitVisits] = useState(false);
  /** Which visits the Split panels show (defaults: first / last). */
  const [splitPassA, setSplitPassA] = useState<number | null>(null);
  const [splitPassB, setSplitPassB] = useState<number | null>(null);
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
      // Eyepiece / Split: grow so the sky stays readable.
      const colW = el.clientWidth;
      const maxByWidth = Math.floor(colW - 12);
      const maxByHeight = Math.floor(
        window.innerHeight * (eyepiece ? 0.78 : splitVisits ? 0.64 : 0.52),
      );
      // Split: size one tile; stage will hold two side by side.
      const cap = eyepiece ? 720 : splitVisits ? 420 : 440;
      const floor = eyepiece ? 360 : splitVisits ? 300 : 280;
      const px = Math.max(floor, Math.min(cap, maxByWidth, maxByHeight));
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
  }, [eyepiece, splitVisits]);

  const loadFromService = useCallback(
    async (target: Target, signal: AbortSignal, targetKey: string = "custom") => {
      setLoad({ status: "loading", message: "SPHEREx archive. listing exposures…" });
      setSpectrumPoints(null);
      setCandidatesFile(null);
      setActiveCandidate(null);
      setSpectrumWaiting(true);
      setCandidatesWaiting(true);
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
      // Candidates after first paint is fine; start now so cache warms (Tommy #44).
      void fetchCandidates(target, signal)
        .then((file) => {
          if (!signal.aborted) {
            setCandidatesFile(file);
            setActiveCandidate(file.candidates.length > 0 ? 0 : null);
          }
        })
        .catch(() => {
          if (!signal.aborted) setCandidatesFile(null);
        })
        .finally(() => {
          if (!signal.aborted) setCandidatesWaiting(false);
        });

      const field = FIELD_PRESETS[fieldPresetRef.current];
      const {
        target: t,
        grid,
        exposures,
      } = await fetchExposures(target, { fov: field.fov, size: field.size }, signal);
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
      setCandidatesFile(null);
      setActiveCandidate(null);
      // Sample bundles are always the default cutout.
      if (!preferLive) {
        setFieldPreset("default");
        fieldPresetRef.current = "default";
      }
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
          if (entry.candidates) {
            setCandidatesWaiting(true);
            void (async () => {
              try {
                const file = await fetchCandidatesFile(
                  candidatesFileUrl(entry.candidates!.file),
                  signal,
                );
                if (!signal.aborted) {
                  setCandidatesFile(file);
                  setActiveCandidate(file.candidates.length > 0 ? 0 : null);
                }
              } catch {
                if (!signal.aborted) setCandidatesFile(null);
              } finally {
                if (!signal.aborted) setCandidatesWaiting(false);
              }
            })();
          } else if (!signal.aborted) {
            setCandidatesFile(null);
            setCandidatesWaiting(false);
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

  // Tommy F8 / #59 / 19:00: load catalog for overlay OR candidates (knownAs).
  // Prefer static preset file; otherwise GET /api/catalog.
  useEffect(() => {
    const need = showGaia || showAllwise || candidatesFile != null;
    if (!need || load.status !== "ready") return;
    const ac = new AbortController();
    const grid = load.data.grid;
    const epoch = middleFrameEpochYear(load.data.frames.map((f) => f.frame.time_mjd));
    setCatalogWaiting(true);
    setCatalogError(null);

    void (async () => {
      try {
        let data: CatalogResponse | null = null;
        try {
          const index = await fetchSampleIndex(ac.signal);
          const entry = sampleTargetByUiKey(index, view.targetKey);
          const defaultFov = FIELD_PRESETS.default.fov;
          if (
            entry?.catalog &&
            fieldPreset === "default" &&
            Math.abs(grid.fov_deg - defaultFov) < 1e-9
          ) {
            data = await fetchCatalogFile(catalogFileUrl(entry.catalog.file), ac.signal);
          }
        } catch {
          /* fall through to live call */
        }
        if (!data) {
          data = await fetchCatalog(
            { ra: grid.ra, dec: grid.dec, fov: grid.fov_deg, epoch },
            ac.signal,
          );
        }
        if (ac.signal.aborted) return;
        setCatalogFile(data);
        setCatalogWaiting(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setCatalogFile(null);
        setCatalogWaiting(false);
        if (showGaia || showAllwise) {
          setCatalogError(catalogUnavailableMessage(err));
          setShowGaia(false);
          setShowAllwise(false);
        }
      }
    })();

    return () => ac.abort();
  }, [showGaia, showAllwise, load, candidatesFile, view.targetKey, fieldPreset]);

  useEffect(() => {
    setCatalogFile(null);
    setGaiaForKnownAs(null);
    setCatalogTip(null);
    setCatalogHighlightId(null);
    setCatalogError(null);
  }, [view.targetKey, fieldPreset]);

  // Tommy 19:00: if Gaia is truncated and knownAs is null, ask a tight 0.02° field
  // around the candidate before saying "holds no source here".
  useEffect(() => {
    const base = gaiaSlice(catalogFile);
    setGaiaForKnownAs(base);
    if (!base || !candidatesFile) return;
    if (!base.truncated) return;
    const needs = candidatesFile.candidates.filter((c) => knownAs(c, base) == null);
    if (needs.length === 0) return;
    const ac = new AbortController();
    void (async () => {
      const extra = [...base.sources];
      for (const c of needs) {
        if (ac.signal.aborted) return;
        try {
          const tight = await fetchCatalog(
            { ra: c.ra, dec: c.dec, fov: 0.02, epoch: c.epoch },
            ac.signal,
          );
          const g = gaiaSlice(tight);
          if (!g) continue;
          for (const s of g.sources) {
            if (!extra.some((e) => e.id === s.id)) extra.push(s);
          }
        } catch {
          /* keep null for this candidate */
        }
      }
      if (ac.signal.aborted) return;
      setGaiaForKnownAs({ ...base, sources: extra, truncated: false });
    })();
    return () => ac.abort();
  }, [catalogFile, candidatesFile]);

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

  useEffect(() => {
    if (passes.length < 2) {
      setSplitPassA(null);
      setSplitPassB(null);
      return;
    }
    setSplitPassA((prev) => (prev != null && passes.includes(prev) ? prev : passes[0]!));
    setSplitPassB((prev) =>
      prev != null && passes.includes(prev) ? prev : passes[passes.length - 1]!,
    );
  }, [passes]);

  const hasCatalogMotion = useMemo(() => {
    if (load.status !== "ready") return false;
    const { pm_ra, pm_dec } = load.data.target;
    return (pm_ra ?? 0) !== 0 || (pm_dec ?? 0) !== 0;
  }, [load]);
  const trail = useMemo(() => {
    if (load.status !== "ready" || !hasCatalogMotion) return [];
    return meanPassTrail(load.data.frames);
  }, [load, hasCatalogMotion]);

  /** AllWISE 2010 → SPHEREx now: the Planet X / Barnard trek on the sky. */
  const flightPath = useMemo(() => {
    if (!showAllwise || !catalogFile || load.status !== "ready") return null;
    const slice = catalogFile.catalogs.find((c) => c.key === "allwise");
    if (!slice) return null;
    const frame = filtered[Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))];
    const nowXy =
      frame?.frame.target_xy ??
      skyToPixel(load.data.grid, load.data.target.ra, load.data.target.dec);
    const nowEpoch = middleFrameEpochYear(load.data.frames.map((f) => f.frame.time_mjd));
    return allwiseFlightPath(
      slice,
      load.data.target.ra,
      load.data.target.dec,
      nowXy,
      load.data.grid,
      nowEpoch,
    );
  }, [showAllwise, catalogFile, load, filtered, view.frameIndex]);

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
    blinkWaveRef.current = null;
    setGhostVisits(false);
    setSplitVisits(false);
    setSpotMover(false);
    setPassMovie(false);
  }

  /** Turn on exactly one presentation overlay (or none). Avoids Blend+Split both looking active. */
  function setExclusiveOverlay(kind: "ghost" | "split" | "spot" | null) {
    setBlinkPasses(false);
    setPassMovie(false);
    setGhostVisits(kind === "ghost");
    setSplitVisits(kind === "split");
    setSpotMover(kind === "spot");
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

  // Blink must flip visits at the *same* infrared color — frame 0 of each pass
  // is a different λ, which looks like a spectrum change, not motion.
  useEffect(() => {
    if (!blinkPasses || view.mode !== "single" || blinkA == null || blinkB == null) return;
    if (load.status !== "ready") return;

    if (blinkWaveRef.current == null) {
      const seedPool = filterFrames(load.data.frames, { pass: blinkA, detector: view.detector });
      blinkWaveRef.current =
        seedPool.length > 0 ? seedPool[Math.floor(seedPool.length / 2)]!.frame.wavelength_um : null;
    }
    const wave = blinkWaveRef.current;

    const go = (pass: number) => {
      // Pass-only list (waveUm cleared) so frameIndex maps 1:1 onto `filtered`.
      const pool = filterFrames(load.data.frames, { pass, detector: view.detector });
      if (pool.length === 0) {
        patchView({ pass, frameIndex: 0, playing: false, waveUm: null });
        return;
      }
      const idx = wave != null ? closestFrameIndex(pool, wave) : Math.floor(pool.length / 2);
      patchView({ pass, frameIndex: idx, playing: false, waveUm: null });
    };

    go(blinkA);
    let toggle = false;
    const id = window.setInterval(() => {
      toggle = !toggle;
      go(toggle ? blinkB : blinkA);
    }, 500);
    return () => window.clearInterval(id);
    // Lock reference λ from the first blink tick; do not re-seed on waveUm edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinkPasses, view.mode, blinkA, blinkB, load, view.detector, patchView]);

  // Cinematic arrival when the service first reports a target mover or changer.
  useEffect(() => {
    if (!candidatesFile) {
      discoverySeenRef.current = null;
      setHaloPulse(null);
      setDiscoveryIsHalo(false);
      return;
    }
    const hit = candidatesFile.candidates.find(
      (c) =>
        c.is_target &&
        ((c.kind === "moved" && c.motion) || (c.kind === "changed" && c.changes.length > 0)),
    );
    if (!hit) return;
    const line = discoveryFlashLine(hit);
    if (!line) return;
    const key = `${hit.ra.toFixed(5)},${hit.dec.toFixed(5)},${hit.kind},${line}`;
    if (discoverySeenRef.current === key) return;
    discoverySeenRef.current = key;
    const isHalo = hit.method === "halo";
    setDiscoveryIsHalo(isHalo);
    setDiscoveryFlash(line);

    let pulseTimer: number | undefined;
    if (isHalo) {
      const grid = candidatesFile.grid;
      const heart = hit.track[0];
      const rArc = heart?.error_arcsec ?? 20;
      const rGrid = (rArc / 3600 / grid.fov_deg) * grid.size;
      setHaloPulse({
        xFrac: hit.xy[0] / grid.size,
        yFrac: hit.xy[1] / grid.size,
        rPx: Math.max(28, rGrid * (displayPx / grid.size)),
      });
      pulseTimer = window.setTimeout(() => setHaloPulse(null), 2800);
    }

    const t = window.setTimeout(() => {
      setDiscoveryFlash(null);
      setDiscoveryIsHalo(false);
    }, 3000);
    return () => {
      window.clearTimeout(t);
      if (pulseTimer != null) window.clearTimeout(pulseTimer);
    };
  }, [candidatesFile, displayPx]);

  // Capture the previous visit for a short afterimage so the hop is visible as a double exposure.
  useEffect(() => {
    if (!blinkPasses || !display || display.kind !== "single") {
      hopSnapRef.current = null;
      setHopGhost(null);
      return;
    }
    const snap = {
      pixels: display.pixels,
      mask: display.mask,
      size: display.size,
      lo: display.lo,
      hi: display.hi,
      background: display.background,
      targetXy: display.targetXy,
      pass: view.pass,
    };
    const prev = hopSnapRef.current;
    if (prev && prev.pass != null && snap.pass != null && prev.pass !== snap.pass) {
      setHopGhost(prev);
      hopSnapRef.current = snap;
      const t = window.setTimeout(() => setHopGhost(null), 340);
      return () => window.clearTimeout(t);
    }
    hopSnapRef.current = snap;
  }, [blinkPasses, display, view.pass]);

  function setUiMode(next: UiMode) {
    // Every top-level mode starts clean: no blend/split/spot/blink leftovers.
    clearPresentationOverlays();
    if (next === "watch") {
      patchView({ mode: "single", pass: null, frameIndex: 0, playing: false });
      return;
    }
    if (next === "compare") {
      const cur = filtered[Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))];
      blinkWaveRef.current = view.waveUm ?? cur?.frame.wavelength_um ?? null;
      patchView({
        mode: "single",
        pass: blinkA,
        playing: false,
        frameIndex: 0,
        waveUm: null,
      });
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
        if (eyepiece) {
          setEyepiece(false);
          return;
        }
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
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        if (load.status === "ready") setEyepiece((v) => !v);
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
        setExclusiveOverlay(splitVisits ? null : "split");
        patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
      }
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        setExclusiveOverlay(ghostVisits ? null : "ghost");
        patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setExclusiveOverlay(spotMover ? null : "spot");
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
    eyepiece,
    load.status,
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
        {
          const cur = filtered[Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))];
          blinkWaveRef.current = view.waveUm ?? cur?.frame.wavelength_um ?? null;
          patchView({
            mode: "single",
            playing: false,
            frameIndex: 0,
            pass: blinkA,
            waveUm: null,
          });
        }
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
    if (!ghostVisits && !spotMover) return null;
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
  }, [load, ghostVisits, spotMover, passes, forDifference, view.contrast]);

  /**
   * Split uses one frame per visit at the same infrared color (not a stack).
   * Stacks of every wavelength look like a blend and hide the hop.
   */
  const splitPair = useMemo(() => {
    if (!splitVisits || load.status !== "ready" || passes.length < 2) return null;
    const a = splitPassA ?? passes[0]!;
    const b = splitPassB ?? passes[passes.length - 1]!;
    const pool = forDifference;
    const pick = (pass: number) => {
      const frames = pool.filter((f) => f.exposure.pass === pass);
      if (frames.length === 0) return null;
      if (view.waveUm == null) return frames[Math.floor(frames.length / 2)]!;
      let best = frames[0]!;
      let bestD = Math.abs(best.frame.wavelength_um - view.waveUm);
      for (const f of frames) {
        const d = Math.abs(f.frame.wavelength_um - view.waveUm);
        if (d < bestD) {
          best = f;
          bestD = d;
        }
      }
      return best;
    };
    const frameA = pick(a);
    const frameB = pick(b);
    if (!frameA || !frameB) return null;
    const limits = applyContrast(
      computeDisplayLimits([
        {
          pixels: frameA.pixels,
          mask: frameA.mask,
          background: frameA.frame.background,
          noise: frameA.frame.noise,
        },
        {
          pixels: frameB.pixels,
          mask: frameB.mask,
          background: frameB.frame.background,
          noise: frameB.frame.noise,
        },
      ]),
      view.contrast,
    );
    return {
      a,
      b,
      frameA,
      frameB,
      limits,
      size: load.data.grid.size,
    };
  }, [
    splitVisits,
    load,
    passes,
    splitPassA,
    splitPassB,
    forDifference,
    view.waveUm,
    view.contrast,
  ]);

  const ghostStacks = ghostVisits ? visitStacks : null;
  const spotStacks = spotMover ? visitStacks : null;
  // Keep each Split tile near full single-frame size; stage grows to fit both.
  const splitPx = Math.max(300, displayPx);

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
    <div
      className={`app app--fit${cinema ? " app--ready" : ""}${eyepiece ? " app--eyepiece" : ""}`}
    >
      <div className="sky-wash" aria-hidden="true" />

      {showBriefing && load.status === "ready" && !eyepiece && (
        <MissionBriefing
          targetName={targetName}
          onEnter={() => dismissBriefing(true)}
          onSkip={() => dismissBriefing(false)}
        />
      )}

      <header className="top">
        <div className="brand-block">
          <h1 className="brand">SPHEREx Explorer</h1>
          <p className="tagline">Watch the near-infrared sky move — NASA Space Apps 2026</p>
        </div>
        <div className="top-actions">
          <HealthBadge />
          {cinema && (
            <button
              type="button"
              className={eyepiece ? "primary" : "ghost"}
              onClick={() => setEyepiece((v) => !v)}
              title={eyepiece ? "Leave eyepiece (Esc or E)" : "Eyepiece: sky only (E)"}
            >
              {eyepiece ? "Leave eyepiece" : "Eyepiece"}
            </button>
          )}
          <button
            type="button"
            className="ghost"
            disabled={load.status !== "ready" || demoPhase !== "idle" || eyepiece}
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
          {KNOWN_TARGETS.map((t) => {
            const ready = t.inSampleIndex || !!t.bundleUrl || (t.ra != null && t.dec != null);
            return (
              <button
                key={t.key}
                type="button"
                className={`target-btn${view.targetKey === t.key ? " active" : ""}`}
                onClick={() => {
                  setBlinkPasses(false);
                  patchView({ targetKey: t.key, mode: "single", pass: null });
                }}
                disabled={!ready}
                title={t.blurb}
              >
                <span className="target-name">{t.label}</span>
                {!ready && <span className="soon">soon</span>}
              </button>
            );
          })}
          <button
            type="button"
            className="ghost"
            title="Short how-to: play, blink, blend, difference"
            onClick={() => patchView({ showHelp: !view.showHelp })}
          >
            Help
          </button>
        </div>
        <form className="search" onSubmit={onSearch}>
          <label className="sr-only" htmlFor="sky-query">
            Search by name or coordinates
          </label>
          <input
            id="sky-query"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Name or RA, Dec"
            autoComplete="off"
            title="Type a star name or sky coordinates (RA, Dec in degrees)"
          />
          <button
            type="submit"
            className="primary"
            title="Resolve the name and load SPHEREx images for that sky position"
          >
            Go
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
            className={`stage-measure${splitPair ? " is-wide" : " is-square"}`}
            style={
              {
                ...(display?.meta?.frame.wavelength_um != null
                  ? { "--wave-hue": String(wavelengthHue(display.meta.frame.wavelength_um)) }
                  : {}),
                // Hard-size the square so we never letterbox a cutout in a wide band.
                ...(!splitPair
                  ? { width: displayPx + 10, height: displayPx + 10 }
                  : {
                      width: splitPx * 2 + 56,
                      maxWidth: "100%",
                      minHeight: splitPx + 64,
                    }),
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
            {haloPulse && (
              <div
                className="halo-pulse"
                aria-hidden="true"
                style={
                  {
                    left: `${haloPulse.xFrac * 100}%`,
                    top: `${haloPulse.yFrac * 100}%`,
                    "--halo-r": `${haloPulse.rPx}px`,
                  } as CSSProperties
                }
              >
                <span className="halo-pulse-ring" />
                <span className="halo-pulse-ring halo-pulse-ring--late" />
              </div>
            )}
            {discoveryFlash && (
              <div className="discovery-flash" role="status" aria-live="polite">
                <p className="discovery-flash-kicker">
                  {discoveryIsHalo ? "Halo measurement" : "Service measurement"}
                </p>
                <p className="discovery-flash-line">{discoveryFlash}</p>
              </div>
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

            {splitPair && !ghostStacks && (
              <div className="split-visits">
                <figure style={{ width: splitPx }}>
                  <FrameCanvas
                    pixels={splitPair.frameA.pixels}
                    mask={splitPair.frameA.mask}
                    size={splitPair.size}
                    lo={splitPair.limits.lo}
                    hi={splitPair.limits.hi}
                    background={splitPair.frameA.frame.background}
                    colorMap={view.colorMap}
                    targetXy={splitPair.frameA.frame.target_xy}
                    displayPx={splitPx}
                  />
                  <figcaption>
                    <label className="split-pass-pick">
                      <span className="sr-only">Left visit</span>
                      <select
                        value={splitPair.a}
                        onChange={(e) => setSplitPassA(Number(e.target.value))}
                        aria-label="Left visit"
                      >
                        {passes.map((p) => (
                          <option key={`split-a-${p}`} value={p}>
                            Visit {p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="split-wave">
                      {splitPair.frameA.frame.wavelength_um.toFixed(2)} µm ·{" "}
                      {new Date(splitPair.frameA.frame.time_iso).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </figcaption>
                </figure>
                <figure style={{ width: splitPx }}>
                  <FrameCanvas
                    pixels={splitPair.frameB.pixels}
                    mask={splitPair.frameB.mask}
                    size={splitPair.size}
                    lo={splitPair.limits.lo}
                    hi={splitPair.limits.hi}
                    background={splitPair.frameB.frame.background}
                    colorMap={view.colorMap}
                    targetXy={splitPair.frameB.frame.target_xy}
                    displayPx={splitPx}
                  />
                  <figcaption>
                    <label className="split-pass-pick">
                      <span className="sr-only">Right visit</span>
                      <select
                        value={splitPair.b}
                        onChange={(e) => setSplitPassB(Number(e.target.value))}
                        aria-label="Right visit"
                      >
                        {passes.map((p) => (
                          <option key={`split-b-${p}`} value={p}>
                            Visit {p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="split-wave">
                      {splitPair.frameB.frame.wavelength_um.toFixed(2)} µm ·{" "}
                      {new Date(splitPair.frameB.frame.time_iso).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </figcaption>
                </figure>
              </div>
            )}

            {!splitPair &&
              !ghostStacks &&
              !spotStacks &&
              display &&
              view.mode === "single" &&
              display.kind === "single" && (
                <>
                  <SkyPlayer
                    frames={filtered}
                    frameIndex={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                    playing={view.playing}
                    fps={view.fps}
                    lo={display.lo}
                    hi={display.hi}
                    size={display.size}
                    colorMap={view.colorMap}
                    tintMask={tintMask}
                    displayPx={displayPx}
                    trail={trail}
                    candidates={candidatesFile?.candidates ?? []}
                    candidatesGrid={candidatesFile?.grid ?? null}
                    viewGrid={load.status === "ready" ? load.data.grid : null}
                    activeCandidate={activeCandidate}
                    saturated={candidatesFile?.saturated ?? []}
                    catalogSlices={catalogFile?.catalogs ?? []}
                    catalogEnabled={
                      new Set(
                        [showGaia ? "gaia" : null, showAllwise ? "allwise" : null].filter(
                          Boolean,
                        ) as CatalogKey[],
                      )
                    }
                    catalogHighlightId={catalogHighlightId ?? flightPath?.sourceId ?? null}
                    flightPath={flightPath}
                    onFrameIndexChange={onPlayerFrame}
                  />
                  {(showGaia || showAllwise) && catalogFile && load.status === "ready" && (
                    <button
                      type="button"
                      className="catalog-hit-layer"
                      aria-label="Identify a catalog source under the pointer"
                      onClick={(e) => {
                        const canvas = (e.currentTarget.parentElement?.querySelector("canvas") ??
                          null) as HTMLCanvasElement | null;
                        if (!canvas || load.status !== "ready") return;
                        const rect = canvas.getBoundingClientRect();
                        const x = ((e.clientX - rect.left) / rect.width) * load.data.grid.size;
                        const y = ((e.clientY - rect.top) / rect.height) * load.data.grid.size;
                        const frame =
                          filtered[Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))];
                        if (!frame) return;
                        const tMjd = frame.frame.time_mjd;
                        let best: { tip: string; id: string; d: number } | null = null;
                        for (const slice of catalogFile.catalogs) {
                          if (slice.key === "gaia" && !showGaia) continue;
                          if (slice.key === "allwise" && !showAllwise) continue;
                          for (const s of slice.sources.slice(0, 100)) {
                            const [ra, dec] = targetAt(
                              {
                                ra: s.ra,
                                dec: s.dec,
                                epoch: slice.epoch,
                                pm_ra: s.pm_ra,
                                pm_dec: s.pm_dec,
                              },
                              tMjd,
                            );
                            const [cx, cy] = skyToPixel(load.data.grid, ra, dec);
                            const d = Math.hypot(cx - x, cy - y);
                            if (d > 6) continue;
                            if (!best || d < best.d) {
                              best = { tip: catalogSourceTip(slice, s), id: s.id, d };
                            }
                          }
                        }
                        if (best) {
                          setCatalogTip(best.tip);
                          setCatalogHighlightId(best.id);
                        } else {
                          setCatalogTip(null);
                          setCatalogHighlightId(null);
                        }
                      }}
                    />
                  )}
                  {hopGhost && (
                    <div className="hop-ghost" aria-hidden="true">
                      <FrameCanvas
                        pixels={hopGhost.pixels}
                        mask={hopGhost.mask}
                        size={hopGhost.size}
                        lo={hopGhost.lo}
                        hi={hopGhost.hi}
                        background={hopGhost.background}
                        colorMap={view.colorMap}
                        tintMask={tintMask}
                        targetXy={hopGhost.targetXy}
                        displayPx={displayPx}
                      />
                      <span className="hop-ghost-label">Visit {hopGhost.pass}</span>
                    </div>
                  )}
                </>
              )}

            {!splitPair &&
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
                  tintMask={tintMask}
                  targetXy={display.targetXy}
                  trail={trail}
                  candidates={candidatesFile?.candidates ?? []}
                  candidatesGrid={candidatesFile?.grid ?? null}
                  viewGrid={load.status === "ready" ? load.data.grid : null}
                  activeCandidate={activeCandidate}
                  candidatePass={view.pass}
                  saturated={candidatesFile?.saturated ?? []}
                  displayPx={displayPx}
                />
              ))}

            {!splitPair && !ghostStacks && !spotStacks && passStackMovie && (
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

            {!splitPair &&
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
                  tintMask={tintMask}
                  targetXy={display.targetXy}
                  trail={trail}
                  candidates={candidatesFile?.candidates ?? []}
                  candidatesGrid={candidatesFile?.grid ?? null}
                  viewGrid={load.status === "ready" ? load.data.grid : null}
                  activeCandidate={activeCandidate}
                  candidatePass={view.pass}
                  saturated={candidatesFile?.saturated ?? []}
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

          {display && view.mode === "single" && display.kind === "single" && (
            <>
              {!overlayActive && (
                <FrameCaption
                  frames={filtered}
                  frameIndex={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                  playing={view.playing || blinkPasses}
                  hasCatalogMotion={hasCatalogMotion}
                />
              )}
              {candidatesFile && load.status === "ready" && !blinkPasses && (
                <MatchVerdict
                  candidates={candidatesFile.candidates}
                  catalogPmRa={load.data.target.pm_ra}
                  catalogPmDec={load.data.target.pm_dec}
                  gaiaCatalog={gaiaForKnownAs}
                  targetName={load.data.target.name ?? targetName}
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
                    setExclusiveOverlay(ghostVisits ? null : "ghost");
                    patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
                  }}
                >
                  Blend
                </button>
                <button
                  type="button"
                  className={splitVisits ? "active" : ""}
                  disabled={passes.length < 2}
                  title="Compare two visits side by side (S)"
                  onClick={() => {
                    setExclusiveOverlay(splitVisits ? null : "split");
                    patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
                  }}
                >
                  Split
                </button>
                {!overlayActive && !blinkPasses && (
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
                {!overlayActive && !blinkPasses && (
                  <label className="fps-field">
                    FPS
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={view.fps}
                      onChange={(e) => patchView({ fps: Number(e.target.value) || 4 })}
                      aria-label="Frames per second"
                    />
                  </label>
                )}
                {blinkPasses && (
                  <button
                    type="button"
                    className="active"
                    onClick={() => {
                      setBlinkPasses(false);
                      blinkWaveRef.current = null;
                      patchView({ pass: null, mode: "single" });
                    }}
                  >
                    Stop blink
                  </button>
                )}
              </div>
              {eyepiece && <p className="app--eyepiece-hint">Eyepiece on · Esc or E to leave</p>}
              {/* After commands: short tip. Skip when candidates already tell the motion story. */}
              {!eyepiece && !candidatesFile && !candidatesWaiting && (
                <ViewerGuide targetName={targetName} mode={guideMode} />
              )}
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
        </section>

        <aside className={`rail${cinema ? " rail--fit" : ""}`}>
          {load.status === "ready" && (
            <MotionInsight
              grid={load.data.grid}
              trail={trail}
              targetName={load.data.target.name ?? targetName}
              hasCatalogMotion={hasCatalogMotion}
            />
          )}

          {(candidatesFile || candidatesWaiting) && (
            <div className="rail-card">
              <CandidatesPanel
                data={candidatesFile}
                waiting={candidatesWaiting}
                activeIndex={activeCandidate}
                detector={view.detector}
                catalogPmRa={load.status === "ready" ? load.data.target.pm_ra : null}
                catalogPmDec={load.status === "ready" ? load.data.target.pm_dec : null}
                gaiaCatalog={gaiaForKnownAs}
                onPick={(index) => setActiveCandidate(index)}
                onStudy={(index) => {
                  const c = candidatesFile?.candidates[index];
                  if (!c) return;
                  const target: Target = {
                    name: `Candidate ${index + 1}`,
                    ra: c.ra,
                    dec: c.dec,
                    epoch: c.epoch,
                    pm_ra: c.motion?.pm_ra ?? null,
                    pm_dec: c.motion?.pm_dec ?? null,
                  };
                  const label = `${c.ra.toFixed(4)}, ${c.dec.toFixed(4)}`;
                  setSearchInput(label);
                  patchView({
                    targetKey: "custom",
                    query: label,
                    mode: "single",
                    pass: null,
                    frameIndex: 0,
                    playing: false,
                  });
                  const ac = new AbortController();
                  void loadFromService(target, ac.signal, "custom");
                }}
              />
            </div>
          )}

          {display && load.status === "ready" && display.meta && (
            <div className="rail-card frame-facts">
              <p className="control-label">This frame</p>
              <dl className="meta meta--compact">
                <div>
                  <dt>Date</dt>
                  <dd>{display.meta.frame.time_iso}</dd>
                </div>
                <div>
                  <dt>Visit / detector</dt>
                  <dd>
                    {display.meta.exposure.pass} / {display.meta.exposure.detector} ·{" "}
                    {display.meta.exposure.collection}
                  </dd>
                </div>
                <div>
                  <dt>Wavelength</dt>
                  <dd>
                    {display.meta.frame.wavelength_um.toFixed(4)} µm ±{" "}
                    {(display.meta.frame.bandwidth_um / 2).toFixed(4)}
                  </dd>
                </div>
                <div>
                  <dt>Frame</dt>
                  <dd>
                    {Math.min(view.frameIndex, Math.max(filtered.length - 1, 0)) + 1} of{" "}
                    {filtered.length || "—"}
                  </dd>
                </div>
                <div>
                  <dt>Photometry</dt>
                  <dd>
                    <span className="quality">{display.meta.frame.photometry.quality}</span>
                  </dd>
                </div>
              </dl>
            </div>
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
                      <p className="control-label">Pass</p>
                      <div className="chip-row">
                        <button
                          type="button"
                          className={view.pass == null ? "active" : ""}
                          title="Include frames from every SPHEREx visit of this field"
                          onClick={() => patchView({ pass: null, frameIndex: 0 })}
                        >
                          All
                        </button>
                        {passes.map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={view.pass === p ? "active" : ""}
                            title={`Show only Visit ${p} frames`}
                            onClick={() => patchView({ pass: p, frameIndex: 0 })}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                      <p className="control-label">Wavelength</p>
                      <div className="chip-row">
                        <button
                          type="button"
                          className={view.waveUm == null ? "active" : ""}
                          title="Use every infrared wavelength in the movie"
                          onClick={() => patchView({ waveUm: null, frameIndex: 0 })}
                        >
                          All λ
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
                          Match this λ
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
                    {hasCatalogMotion
                      ? `Blinking Visit ${blinkA ?? 1} ↔ Visit ${blinkB ?? 3}. Watch the bright star hop north.`
                      : `Blinking Visit ${blinkA ?? 1} ↔ Visit ${blinkB ?? 3}. No catalog motion here. Watch the pixels for anything that moves or changes.`}
                  </p>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      setBlinkPasses(false);
                      blinkWaveRef.current = null;
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
                  <p className="control-label">Mode</p>
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
                      Stack
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
                      Stack movie
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
                      Track
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
                      <p className="control-label">Pass</p>
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
                <p className="control-label">Contrast</p>
                <label className="slider-row">
                  <span>{view.contrast.toFixed(1)}×</span>
                  <input
                    type="range"
                    min={0.4}
                    max={3}
                    step={0.1}
                    value={view.contrast}
                    onChange={(e) => patchView({ contrast: Number(e.target.value) })}
                  />
                </label>
                <p className="control-label">Color</p>
                <div className="chip-row">
                  <button
                    type="button"
                    className={view.colorMap === "heat" ? "active" : ""}
                    onClick={() => patchView({ colorMap: "heat" })}
                  >
                    IR heat
                  </button>
                  <button
                    type="button"
                    className={view.colorMap === "gray" ? "active" : ""}
                    onClick={() => patchView({ colorMap: "gray" })}
                  >
                    Gray
                  </button>
                </div>
                <label className="tint-mask-row">
                  <input
                    type="checkbox"
                    checked={tintMask}
                    onChange={(e) => setTintMask(e.target.checked)}
                  />
                  <span>Tint flagged pixels</span>
                </label>
                <p className="control-label">Other telescopes</p>
                <label className="tint-mask-row">
                  <input
                    type="checkbox"
                    checked={showGaia}
                    disabled={catalogError != null && !catalogFile}
                    onChange={(e) => setShowGaia(e.target.checked)}
                  />
                  <span>Gaia DR3</span>
                </label>
                <label className="tint-mask-row">
                  <input
                    type="checkbox"
                    checked={showAllwise}
                    disabled={catalogError != null && !catalogFile}
                    onChange={(e) => setShowAllwise(e.target.checked)}
                  />
                  <span>AllWISE (the infrared sky in 2010)</span>
                </label>
                <div className="chip-row" style={{ marginTop: "0.35rem" }}>
                  <button
                    type="button"
                    className={showAllwise && flightPath ? "active" : ""}
                    disabled={catalogError != null && !catalogFile}
                    title="Draw the path from where WISE saw this object in 2010 to where SPHEREx sees it now"
                    onClick={() => setShowAllwise(true)}
                  >
                    2010 → now
                  </button>
                </div>
                {showAllwise && flightPath && (
                  <p className="micro flight-path-note">
                    Flight path {flightPath.label}
                    {flightPath.sourceId ? ` · ${flightPath.sourceId}` : ""}
                  </p>
                )}
                {catalogWaiting && <p className="micro">Asking the catalogs…</p>}
                {catalogError && <p className="micro catalog-unavail">{catalogError}</p>}
                {catalogFile?.catalogs.some((c) => c.truncated) && (
                  <p className="micro">Showing the 300 brightest</p>
                )}
                {catalogTip && <p className="micro catalog-tip">{catalogTip}</p>}
                <p className="control-label">Field of view</p>
                <div className="chip-row">
                  <button
                    type="button"
                    className={fieldPreset === "default" ? "active" : ""}
                    title="Default SPHEREx explorer cutout"
                    onClick={() => {
                      if (fieldPreset === "default") return;
                      setFieldPreset("default");
                      fieldPresetRef.current = "default";
                      if (load.status !== "ready") return;
                      const t = load.data.target;
                      const ac = new AbortController();
                      void loadFromService(
                        t,
                        ac.signal,
                        view.targetKey === "custom" ? "custom" : view.targetKey,
                      );
                    }}
                  >
                    Default
                  </button>
                  <button
                    type="button"
                    className={fieldPreset === "wide" ? "active" : ""}
                    title="Wider live cutout: fov=0.3° size=256 (Tommy item 7)"
                    onClick={() => {
                      if (fieldPreset === "wide") return;
                      setFieldPreset("wide");
                      fieldPresetRef.current = "wide";
                      if (load.status !== "ready") return;
                      const t = load.data.target;
                      const ac = new AbortController();
                      void loadFromService(
                        t,
                        ac.signal,
                        view.targetKey === "custom" ? "custom" : view.targetKey,
                      );
                    }}
                  >
                    Wider
                  </button>
                </div>
                <p className="micro">
                  {fieldPreset === "wide"
                    ? `Live archive ${FIELD_PRESETS.wide.label}. Sample movies stay at 0.1°.`
                    : `Default cutout ${FIELD_PRESETS.default.label}. Wider reloads from the live archive.`}
                </p>
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
                tintMask={tintMask}
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
  tintMask,
}: {
  target: Target;
  grid: Grid;
  frame: DecodedFrame;
  filteredCount: number;
  mode: ComposeMode;
  tintMask: boolean;
}) {
  const f = frame.frame;
  const e = frame.exposure;
  return (
    <div className="frame-meta">
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
            {f.wavelength_um.toFixed(4)} µm · band {f.bandwidth_um.toFixed(4)} µm wide
          </dd>
        </div>
        <div>
          <dt>Detector / visit</dt>
          <dd>
            Detector {e.detector} · Visit {e.pass} · {e.collection}
          </dd>
        </div>
        <div>
          <dt>Exposure</dt>
          <dd>{f.exposure_s.toFixed(1)} s</dd>
        </div>
        <div>
          <dt>Valid fraction</dt>
          <dd>{(f.valid_fraction * 100).toFixed(0)}%</dd>
        </div>
        <div>
          <dt>Quality</dt>
          <dd>
            <span className="quality">{f.photometry.quality}</span>
            {f.photometry.flux_mjy != null
              ? ` · ${f.photometry.flux_mjy.toFixed(3)} ± ${f.photometry.error_mjy?.toFixed(3)} mJy`
              : " · flux unavailable"}
          </dd>
        </div>
        <div>
          <dt>Catalogue pixel</dt>
          <dd>
            ({f.target_xy[0].toFixed(2)}, {f.target_xy[1].toFixed(2)})
          </dd>
        </div>
        <div>
          <dt>Background / noise</dt>
          <dd>
            {f.background?.toFixed(3) ?? "—"} / {f.noise?.toFixed(3) ?? "—"} MJy/sr
          </dd>
        </div>
        <div>
          <dt>Cutout</dt>
          <dd>
            {grid.size}² · {grid.fov_deg}° · {mode} · {filteredCount} frames
          </dd>
        </div>
      </dl>
      <div className={`mask-legend${tintMask ? " mask-legend--on" : ""}`}>
        <p className="mask-legend-title">Mask bits (SPHEREx Flags)</p>
        <p className="mask-legend-hint">
          {tintMask
            ? "Tint is on: pink-magenta pixels have any flag set."
            : "Turn on Tint flagged pixels in Look to see them on the image."}
        </p>
        <ul className="mask-legend-list">
          {MASK_BIT_LEGEND.map((row) => (
            <li key={row.bit}>
              <span className="mask-legend-bit">{row.bit}</span>
              <span className="mask-legend-flag">{row.flag}</span>
              <span className="mask-legend-meaning">{row.meaning}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
