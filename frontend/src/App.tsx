import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
import { type CandidatesFile, fetchCandidatesFile, knownAs } from "./data/candidates";
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
  fetchJournalLive,
  fetchSpectrum,
  type JournalShareCategory,
  loadFramesProgressive,
  postJournalMark,
  resolveName,
} from "./data/client";
import type { Bundle, Frame, Grid, Target } from "./data/contract";
import {
  computeDisplayLimits,
  MASK_BIT_LEGEND,
  mjdToDate,
  pixelToSky,
  skyToPixel,
  targetAt,
} from "./data/contract";
import { parseCoordinateQuery } from "./data/coords";
import { type DecodedBundle, type DecodedFrame, decodeBundle } from "./data/decode";
import { fetchJournalFile, type JournalEntry } from "./data/journal";
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
  normalizeTargetKey,
  readSkyFromUrl,
  readViewFromUrl,
  type TargetExtras,
  type ViewState,
  viewToSearchParams,
  writeViewToUrl,
} from "./state/url";
import { browserStorage, rememberWelcome, welcomesAtOpening } from "./state/welcome";
import { AutoDemoBanner, DEMO_BEATS, type DemoPhase } from "./ui/AutoDemo";
import { CandidatesPanel } from "./ui/CandidatesPanel";
import { CatalogLegend } from "./ui/CatalogLegend";
import {
  ADVANCED,
  COLORS,
  COMBINE,
  CONTRAST,
  EXAMPLES,
  FLAGS,
  FOUND,
  LOOK,
  PALETTE,
  PANELS,
  PLACE,
  PLAYER,
  SIZE,
  STRIP,
  SURVEYS,
  TOP,
  VISITS,
  WAYS,
} from "./ui/copy";
import { type DetectorBand, DetectorDial } from "./ui/DetectorDial";
import { FrameCaption } from "./ui/FrameCaption";
import { GhostVisits } from "./ui/GhostVisits";
import { HealthBadge } from "./ui/HealthBadge";
import { type HopProofPick, HopProofStrip } from "./ui/HopProofStrip";
import { JournalPanel } from "./ui/JournalPanel";
import { MatchVerdict } from "./ui/MatchVerdict";
import { MotionInsight } from "./ui/MotionInsight";
import { PassStackMovie } from "./ui/PassStackMovie";
import { ShareFinding } from "./ui/ShareFinding";
import { CHALLENGE_SKY_PINS, SkyContextGlobe } from "./ui/SkyContextGlobe";
import { SpotTheMover } from "./ui/SpotTheMover";
import { ViewerGuide } from "./ui/ViewerGuide";
import { type StoryboardCell, VisitStoryboard } from "./ui/VisitStoryboard";
import { WelcomeWindow } from "./ui/WelcomeWindow";
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

type FieldCacheEntry = { data: DecodedBundle; source: "sample" | "live" };

function fieldCacheKey(targetKey: string, target: Target, preset: FieldPreset): string {
  const tk = normalizeTargetKey(targetKey);
  if (!tk || tk === "custom") {
    return `c:${target.ra.toFixed(5)},${target.dec.toFixed(5)}|${preset}`;
  }
  return `${tk}|${preset}`;
}

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

/** While the images of a live place arrive, the film is drawn again this often, no more. */
const LIVE_PAINT_MS = 700;

type LoadState =
  | { status: "idle" }
  | { status: "loading"; message: string; loaded?: number; total?: number }
  | { status: "error"; message: string; retryable?: boolean }
  | { status: "ready"; data: DecodedBundle; source: "sample" | "live" };

export default function App() {
  const [view, setView] = useState<ViewState>(() => readViewFromUrl());
  /** One-shot: honor ?frame=&detector= from the address bar (Tommy 19:55). */
  const deepLinkBootRef = useRef(readViewFromUrl());
  const deepLinkAppliedRef = useRef(false);
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  /** Tommy item 6: tint non-zero mask pixels on the stage. */
  const [tintMask, setTintMask] = useState(false);
  /** Tommy F8: catalog overlay switches (off until first asked). */
  const [showGaia, setShowGaia] = useState(false);
  const [showAllwise, setShowAllwise] = useState(false);
  /** Soft upscale of 128² cutouts (default). Sharp = nearest-neighbor blocks. */
  const [smoothScale, setSmoothScale] = useState(true);
  /** Numbered visit beads on the sky — off by default (cross only). */
  const [showPathTrail, setShowPathTrail] = useState(false);
  /** 0 = AllWISE epoch, 1 = SPHEREx now — scrub bead on the flight path. */
  const [flightScrub, setFlightScrub] = useState(1);
  const [flightPlaying, setFlightPlaying] = useState(false);
  const flightPlayRef = useRef<number | null>(null);
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
  /** Allow emptying the FPS field while typing; commit on blur. */
  const [fpsDraft, setFpsDraft] = useState(() => String(view.fps));
  useEffect(() => {
    setFpsDraft(String(view.fps));
  }, [view.fps]);
  const [journalOpen, setJournalOpen] = useState(false);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [visitorEntries, setVisitorEntries] = useState<JournalEntry[]>([]);
  const [journalLiveOpen, setJournalLiveOpen] = useState(false);
  const [journalMeasuringId, setJournalMeasuringId] = useState<string | null>(null);
  const [shareArmed, setShareArmed] = useState(false);
  const [shareMark, setShareMark] = useState<{ ra: number; dec: number } | null>(null);
  const [shareCategory, setShareCategory] = useState<JournalShareCategory>("moved");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  /** Seek to this exposure id after a journal open (visitor or team). */
  const [pendingJournalFrame, setPendingJournalFrame] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    void fetchJournalFile(ac.signal)
      .then((file) => {
        if (!ac.signal.aborted) setJournalEntries(file.entries);
      })
      .catch(() => {
        if (!ac.signal.aborted) setJournalEntries([]);
      });
    return () => ac.abort();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      void fetchJournalLive()
        .then((live) => {
          if (cancelled) return;
          setJournalLiveOpen(live.open);
          setVisitorEntries(live.entries ?? []);
        })
        .catch(() => {
          if (cancelled) return;
          setJournalLiveOpen(false);
          setVisitorEntries([]);
        });
    };
    pull();
    const id = window.setInterval(pull, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  /** Live contrast for the slider/sky; URL + heavy overlays commit on pointer up. */
  const [contrastLive, setContrastLive] = useState(view.contrast);
  useEffect(() => {
    setContrastLive(view.contrast);
  }, [view.contrast]);
  /** Sky context globe: open on desk, collapsed on narrow phones. */
  const [skyContextOpen, setSkyContextOpen] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(max-width: 720px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const sync = () => setSkyContextOpen(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  /** Instant FOV switch: both cutouts stay warm after first fetch (~2 slots / target). */
  const fieldCacheRef = useRef<Map<string, FieldCacheEntry>>(new Map());
  /** In-flight FOV fetches — switch joins these instead of starting a second download. */
  const fieldWarmRef = useRef<Map<string, Promise<FieldCacheEntry | null>>>(new Map());
  const [timelineOpen, setTimelineOpen] = useState(true);
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
  const [displayPx, setDisplayPx] = useState(512);
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
  // Opens by itself at the first opening only. "How it works" opens it again through
  // `view.showHelp`, which the address carries.
  /** Images of a live place still on their way while the film already plays. */
  const [liveProgress, setLiveProgress] = useState<{ loaded: number; total: number } | null>(null);
  /** Picture settings (visits, FOV, palette…). Open by default so they stay findable. */
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [showWelcome, setShowWelcome] = useState(() =>
    welcomesAtOpening(window.location.search, browserStorage()),
  );
  const [linkCopied, setLinkCopied] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const demoTimer = useRef<number | null>(null);
  const demoFromUrl = useRef(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") === "1",
  );
  const demoAutoStarted = useRef(false);
  /** Jury deep-link: ?years=1 arms AllWISE and plays the 2010→now trek once. */
  const yearsFromUrl = useRef(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("years") === "1",
  );
  const yearsAutoStarted = useRef(false);
  const [yearsLinkCopied, setYearsLinkCopied] = useState(false);

  function closeWelcome(startTour: boolean) {
    rememberWelcome(browserStorage());
    setShowWelcome(false);
    if (view.showHelp) patchView({ showHelp: false });
    if (startTour) {
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

  const [frameLinkCopied, setFrameLinkCopied] = useState(false);

  /** Exact view for judges / journal: keeps frame, detector, λ (Tommy 19:55). */
  function copyFrameLink() {
    const url = new URL(window.location.href);
    url.search = `?${viewToSearchParams(view, skyTargetRef.current).toString()}`;
    const href = url.toString();
    const synthetic = targetByKey(view.targetKey)?.synthetic === true;
    const text = synthetic
      ? `${href}\nSYNTHETIC TEST: a made-up body added to real SPHEREx frames. It does not exist.`
      : href;
    void navigator.clipboard.writeText(text).then(() => {
      setFrameLinkCopied(true);
      window.setTimeout(() => setFrameLinkCopied(false), 2000);
      setDiscoveryIsHalo(false);
      setDiscoveryFlash(
        `Link copied · image ${view.frameIndex + 1}${
          view.detector != null ? ` · detector ${view.detector}` : ""
        }${synthetic ? " · SYNTHETIC" : ""}`,
      );
      window.setTimeout(() => setDiscoveryFlash(null), 2400);
    });
  }

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
      // Same on-screen square for Close and Wide: FOV only changes the cutout content.
      // Fill the viewer column (leave a small gutter); no fixed 512 cap that leaves empty sides.
      const colW = el.clientWidth;
      const maxByWidth = Math.floor(colW - 12);
      if (eyepiece) {
        const maxByHeight = Math.floor(window.innerHeight * 0.78);
        setDisplayPx(Math.max(480, Math.min(720, maxByWidth, maxByHeight)));
        return;
      }
      if (splitVisits) {
        setDisplayPx(Math.max(300, Math.min(420, Math.floor(maxByWidth / 2) - 24)));
        return;
      }
      // A phone gets the picture at the width of its screen: no floor wider than a phone.
      setDisplayPx(Math.max(240, maxByWidth || FIELD_PRESETS.default.size * 4));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [eyepiece, splitVisits, load]);

  const loadFromService = useCallback(
    async (
      target: Target,
      signal: AbortSignal,
      targetKey: string = "custom",
      opts?: { keepFieldCache?: boolean },
    ) => {
      const fovOnly = opts?.keepFieldCache === true;
      if (!fovOnly) {
        fieldCacheRef.current.clear();
        fieldWarmRef.current.clear();
        setLoad({
          status: "loading",
          message:
            "Asking the SPHEREx archive which images cover this place… It can take half a minute when the archive is busy.",
        });
        setLiveProgress(null);
        setSpectrumPoints(null);
        setCandidatesFile(null);
        setActiveCandidate(null);
        setSpectrumWaiting(true);
        setCandidatesWaiting(true);
      } else {
        // Keep current sky on screen while the other FOV loads (or use cache).
        setLoad((prev) =>
          prev.status === "ready" ? prev : { status: "loading", message: "Loading field of view…" },
        );
      }
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
      // Spectrum / candidates: skip on FOV-only swaps (same target, cutout size changes).
      const spectrumTask = fovOnly
        ? Promise.resolve()
        : fetchSpectrum(target, {}, signal)
            .then((res) => {
              if (!signal.aborted) setSpectrumPoints(res.points);
            })
            .catch(() => {
              if (!signal.aborted) setSpectrumPoints(null);
            })
            .finally(() => {
              if (!signal.aborted) setSpectrumWaiting(false);
            });
      if (!fovOnly) {
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
      }

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

      let lastPaint = 0;
      const publishLive = (exps: typeof exposures, frames: Frame[]) => {
        lastPaint = performance.now();
        const partial: Bundle = {
          format: "spherex-explorer/bundle",
          version: 1,
          generated: new Date().toISOString(),
          target: t,
          grid,
          exposures: exps,
          frames,
        };
        // Urgent on purpose. Inside a transition, the images that kept arriving pushed this
        // paint back until the last one: a place opened by its coordinates stayed blank for
        // up to 45 seconds. The pace is held by LIVE_PAINT_MS instead.
        setLoad({ status: "ready", data: decodeBundle(partial), source: "live" });
        setLiveProgress({ loaded: loadedTotal, total: grandTotal });
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
            message: `Loading the images of detector ${det}…`,
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
            // The first image shows at once, then the film grows a few times a second.
            const first = di === 0 && batchLoaded === 1;
            if (first || performance.now() - lastPaint >= LIVE_PAINT_MS) publishLive(exps, frames);
            setLoad((prev) =>
              prev.status === "loading"
                ? {
                    ...prev,
                    loaded: loadedTotal,
                    total: grandTotal,
                    message: `Loading the images: ${loadedTotal} of ${grandTotal}`,
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
          const boot = deepLinkBootRef.current;
          const honor =
            !deepLinkAppliedRef.current && normalizeTargetKey(boot.targetKey) === targetKey;
          if (honor) deepLinkAppliedRef.current = true;
          patchView({
            targetKey,
            frameIndex: honor ? boot.frameIndex : 0,
            pass: honor ? boot.pass : null,
            detector: honor && boot.detector != null ? boot.detector : det,
            query: t.name ?? `${t.ra}, ${t.dec}`,
            playing: honor ? false : undefined,
          });
          setSearchInput(t.name ?? `${t.ra}, ${t.dec}`);
        }
      }

      const readyData = decodeBundle({
        format: "spherex-explorer/bundle",
        version: 1,
        generated: new Date().toISOString(),
        target: t,
        grid,
        exposures: priorExposures,
        frames: priorFrames,
      });
      const preset = fieldPresetRef.current;
      fieldCacheRef.current.set(fieldCacheKey(targetKey, t, preset), {
        data: readyData,
        source: "live",
      });
      setLoad({
        status: "ready",
        data: readyData,
        source: "live",
      });
      setLiveProgress(null);
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

  const applyFieldPreset = useCallback(
    (next: FieldPreset) => {
      if (fieldPreset === next) return;
      setFieldPreset(next);
      fieldPresetRef.current = next;
      if (load.status !== "ready") return;
      const t = load.data.target;
      const tk = view.targetKey === "custom" ? "custom" : view.targetKey || "custom";
      const key = fieldCacheKey(tk, t, next);
      const hit = fieldCacheRef.current.get(key);
      if (hit) {
        setLoad({ status: "ready", data: hit.data, source: hit.source });
        patchView({ frameIndex: 0, pass: null, playing: false, detector: null });
        return;
      }
      // Join in-flight warm fetch (no second download) when possible.
      const pending = fieldWarmRef.current.get(key);
      if (pending) {
        void pending.then((entry) => {
          if (!entry) {
            const ac = new AbortController();
            void loadFromService(t, ac.signal, tk, { keepFieldCache: true });
            return;
          }
          if (fieldPresetRef.current !== next) return;
          setLoad({ status: "ready", data: entry.data, source: entry.source });
          patchView({ frameIndex: 0, pass: null, playing: false, detector: null });
        });
        return;
      }
      const ac = new AbortController();
      void loadFromService(t, ac.signal, tk, { keepFieldCache: true });
    },
    [fieldPreset, load, view.targetKey, loadFromService, patchView],
  );

  // Warm the other FOV in the background. Two cutouts in RAM — switch is free after warm.
  // Target-id deps only: progressive sample merges must not abort the warm fetch.
  const loadReadyRef = useRef(load);
  loadReadyRef.current = load;
  const fovWarmTargetId =
    load.status === "ready"
      ? `${view.targetKey ?? "custom"}|${load.data.target.ra.toFixed(5)}|${load.data.target.dec.toFixed(5)}`
      : null;

  useEffect(() => {
    if (!fovWarmTargetId) return;
    const cur = loadReadyRef.current;
    if (cur.status !== "ready") return;
    const tk = view.targetKey === "custom" ? "custom" : view.targetKey || "custom";
    const t = cur.data.target;
    const activePreset = fieldPresetRef.current;
    const activeKey = fieldCacheKey(tk, t, activePreset);
    if (!fieldCacheRef.current.has(activeKey)) {
      fieldCacheRef.current.set(activeKey, { data: cur.data, source: cur.source });
    }

    const other: FieldPreset = activePreset === "default" ? "wide" : "default";
    const key = fieldCacheKey(tk, t, other);
    if (fieldCacheRef.current.has(key) || fieldWarmRef.current.has(key)) return;

    const ac = new AbortController();
    const field = FIELD_PRESETS[other];
    const warm = (async (): Promise<FieldCacheEntry | null> => {
      try {
        const {
          target: tt,
          grid,
          exposures,
        } = await fetchExposures(t, { fov: field.fov, size: field.size }, ac.signal);
        if (ac.signal.aborted || exposures.length === 0) return null;
        const preferDet = tk === "wise0855" || /wise\s*0855/i.test(tt.name ?? "") ? 6 : 2;
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
        for (const det of detOrder) {
          if (ac.signal.aborted) return null;
          const queue = byDet.get(det)!;
          const batchFrames: (Frame | undefined)[] = new Array(queue.length);
          await loadFramesProgressive(
            queue,
            tt,
            grid,
            (frame, index) => {
              batchFrames[index] = frame;
            },
            { concurrency: 12, signal: ac.signal },
          );
          const finalized = batchFrames.filter(Boolean) as Frame[];
          const got = new Set(finalized.map((f) => f.id));
          priorExposures.push(...queue.filter((e) => got.has(e.id)));
          priorFrames.push(...finalized);
        }
        if (ac.signal.aborted) return null;
        const entry: FieldCacheEntry = {
          data: decodeBundle({
            format: "spherex-explorer/bundle",
            version: 1,
            generated: new Date().toISOString(),
            target: tt,
            grid,
            exposures: priorExposures,
            frames: priorFrames,
          }),
          source: "live",
        };
        fieldCacheRef.current.set(key, entry);
        return entry;
      } catch {
        return null;
      } finally {
        fieldWarmRef.current.delete(key);
      }
    })();
    fieldWarmRef.current.set(key, warm);
    return () => ac.abort();
  }, [fovWarmTargetId, view.targetKey]);

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
          // Synthetic Planet X: spectrum file is empty sky at center — do not chart it (Tommy #79).
          if (entry.spectrum && !entry.synthetic && !known.synthetic) {
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
          fieldCacheRef.current.set(fieldCacheKey(key, merged.target, "default"), {
            data: merged,
            source: "sample",
          });
          setLoad({ status: "ready", data: merged, source: "sample" });
          // Honor deep-link frame/detector once; otherwise preferred detector at frame 0.
          const boot = deepLinkBootRef.current;
          const honor = !deepLinkAppliedRef.current && normalizeTargetKey(boot.targetKey) === key;
          if (honor) deepLinkAppliedRef.current = true;
          patchView({
            targetKey: key,
            frameIndex: honor ? boot.frameIndex : 0,
            pass: honor ? boot.pass : null,
            detector: honor && boot.detector != null ? boot.detector : first.detector,
            query: known.label,
            playing: false,
            mode: honor ? boot.mode : "single",
            waveUm: honor ? boot.waveUm : null,
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
              fieldCacheRef.current.set(fieldCacheKey(key, merged.target, "default"), {
                data: merged,
                source: "sample",
              });
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
      fieldCacheRef.current.set(fieldCacheKey(key, data.target, "default"), {
        data,
        source: "sample",
      });
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
              message:
                "No object is known under this name. Check the spelling, or type coordinates.",
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
      // Clamp to last frame — never snap to 0 (wipes deep-linked ?frame=).
      patchView({ frameIndex: filtered.length - 1 });
    }
  }, [filtered.length, view.frameIndex, patchView]);

  useEffect(() => {
    if (!pendingJournalFrame || filtered.length === 0) return;
    const idx = filtered.findIndex((f) => f.frame.id === pendingJournalFrame);
    setPendingJournalFrame(null);
    if (idx >= 0) patchView({ frameIndex: idx, playing: false });
  }, [pendingJournalFrame, filtered, patchView]);

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
      const limits = applyContrast(computeDisplayLimits([diff]), contrastLive);
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
      const limits = applyContrast(computeDisplayLimits([stacked]), contrastLive);
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
      const limits = applyContrast(computeDisplayLimits([tracked]), contrastLive);
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

    const limits = applyContrast(load.data.limits, contrastLive);
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
    contrastLive,
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

  useEffect(() => {
    if (!showAllwise) {
      setFlightScrub(1);
      setFlightPlaying(false);
    }
  }, [showAllwise]);

  useEffect(() => {
    return () => {
      if (flightPlayRef.current != null) window.clearInterval(flightPlayRef.current);
    };
  }, []);

  function playFlightYears() {
    setShowAllwise(true);
    if (!flightPath) return;
    if (flightPlayRef.current != null) window.clearInterval(flightPlayRef.current);
    setFlightScrub(0);
    setFlightPlaying(true);
    if (view.targetKey === "wise0855") {
      setDiscoveryIsHalo(false);
      setDiscoveryFlash(
        "Too cold for Gaia. WISE saw it in 2010. SPHEREx sees it now — the Planet X shape.",
      );
      window.setTimeout(() => setDiscoveryFlash(null), 5200);
    }
    const started = performance.now();
    const dur = 2400;
    flightPlayRef.current = window.setInterval(() => {
      const u = Math.min(1, (performance.now() - started) / dur);
      // Ease-out so the last years linger
      const eased = 1 - (1 - u) ** 2;
      setFlightScrub(eased);
      if (u >= 1) {
        if (flightPlayRef.current != null) window.clearInterval(flightPlayRef.current);
        flightPlayRef.current = null;
        setFlightPlaying(false);
        setFlightScrub(1);
      }
    }, 32);
  }

  function copyYearsLink() {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("years", "1");
    const indexKey =
      view.targetKey === "custom"
        ? null
        : (INDEX_KEY_BY_UI[view.targetKey || "wise0855"] ?? (view.targetKey || "wise-0855"));
    if (indexKey) url.searchParams.set("target", indexKey);
    const href = url.toString();
    void navigator.clipboard.writeText(href).then(() => {
      setYearsLinkCopied(true);
      window.setTimeout(() => setYearsLinkCopied(false), 2000);
    });
  }

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
    if (key === "synthx") {
      // Made-up body: hop between visits on detector 6 (Tommy #79).
      patchView({
        targetKey: key,
        query: label,
        frameIndex: 0,
        pass: null,
        detector: 6,
        mode: "single",
        playing: false,
        waveUm: null,
      });
      setBlinkPasses(true);
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

  // Halo pulse only (R Dra) — no "Found a mover" popup on every load (MatchVerdict covers it).
  useEffect(() => {
    if (!candidatesFile) {
      discoverySeenRef.current = null;
      setHaloPulse(null);
      setDiscoveryIsHalo(false);
      setDiscoveryFlash(null);
      return;
    }
    const hit = candidatesFile.candidates.find(
      (c) => c.is_target && c.kind === "moved" && c.motion && c.method === "halo",
    );
    if (!hit) return;
    const key = `halo:${hit.ra.toFixed(5)},${hit.dec.toFixed(5)}`;
    if (discoverySeenRef.current === key) return;
    discoverySeenRef.current = key;
    const grid = candidatesFile.grid;
    const heart = hit.track[0];
    const rArc = heart?.error_arcsec ?? 20;
    const rGrid = (rArc / 3600 / grid.fov_deg) * grid.size;
    setHaloPulse({
      xFrac: hit.xy[0] / grid.size,
      yFrac: hit.xy[1] / grid.size,
      rPx: Math.max(28, rGrid * (displayPx / grid.size)),
    });
    const pulseTimer = window.setTimeout(() => setHaloPulse(null), 2800);
    return () => window.clearTimeout(pulseTimer);
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
      // Lock λ first (navigator advice): blink at the same band, not the spectrum.
      const cur = filtered[Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))];
      const wave = view.waveUm ?? cur?.frame.wavelength_um ?? null;
      blinkWaveRef.current = wave;
      patchView({
        mode: "single",
        pass: blinkA,
        playing: false,
        frameIndex: 0,
        waveUm: wave != null ? Number(Number(wave).toFixed(4)) : null,
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

  // Judge deep-link: ?demo=1 launches the walkthrough once data is ready.
  useEffect(() => {
    if (!demoFromUrl.current || demoAutoStarted.current) return;
    if (load.status !== "ready") return;
    demoAutoStarted.current = true;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("demo");
      window.history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => runAutoDemo(), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.status]);

  // Judge deep-link: ?years=1 → AllWISE on, then Play years when the path exists.
  useEffect(() => {
    if (!yearsFromUrl.current) return;
    if (load.status !== "ready") return;
    setShowAllwise(true);
  }, [load.status]);

  useEffect(() => {
    if (!yearsFromUrl.current || yearsAutoStarted.current) return;
    if (!flightPath || load.status !== "ready") return;
    yearsAutoStarted.current = true;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("years");
      window.history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => playFlightYears(), 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightPath, load.status]);

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
        label: STRIP.difference,
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
          message: "No object is known under this name. Check the spelling, or type coordinates.",
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
            message: "No object is known under this name. Check the spelling, or type coordinates.",
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
    <div className={`app app--classic${eyepiece ? " app--eyepiece" : ""}`}>
      <div className="sky-wash" aria-hidden="true" />

      {(showWelcome || view.showHelp) && !eyepiece && demoPhase === "idle" && (
        <WelcomeWindow
          tourReady={load.status === "ready"}
          onClose={() => closeWelcome(false)}
          onTour={() => closeWelcome(true)}
        />
      )}

      <header className="top">
        <div className="brand-block">
          <p className="brand">SPHEREx Explorer</p>
          <p className="tagline">
            Watch the infrared sky change, visit after visit · NASA Space Apps 2026
          </p>
        </div>
        <div className="top-actions">
          <HealthBadge />
          <button
            type="button"
            className="ghost"
            title={TOP.journal.hint}
            onClick={() => setJournalOpen(true)}
          >
            {TOP.journal.label}
          </button>
          <a
            className="ghost"
            href={
              load.status === "ready"
                ? `${import.meta.env.BASE_URL}sky.html?ra=${load.data.target.ra}&dec=${load.data.target.dec}&fov=30`
                : `${import.meta.env.BASE_URL}sky.html`
            }
            title={TOP.skyMap.hint}
          >
            {TOP.skyMap.label}
          </a>
          <button
            type="button"
            className={frameLinkCopied ? "active" : "ghost"}
            disabled={load.status !== "ready"}
            onClick={() => copyFrameLink()}
            title={TOP.copyLink.hint}
          >
            {frameLinkCopied ? "Copied" : TOP.copyLink.label}
          </button>
          <details className="jury-tools">
            <summary title={TOP.tour.hint}>{TOP.tour.label}</summary>
            <button
              type="button"
              className="ghost"
              disabled={load.status !== "ready" || demoPhase !== "idle" || eyepiece}
              onClick={() => runAutoDemo()}
              title={TOP.guidedTour.hint}
            >
              {TOP.guidedTour.label}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => copyJudgeLink()}
              title={TOP.tourLink.hint}
            >
              {linkCopied ? "Copied" : TOP.tourLink.label}
            </button>
            {cinema && (
              <button
                type="button"
                className={eyepiece ? "primary" : "ghost"}
                onClick={() => setEyepiece((v) => !v)}
                title={eyepiece ? TOP.leaveFullScreen.hint : TOP.fullScreen.hint}
              >
                {eyepiece ? TOP.leaveFullScreen.label : TOP.fullScreen.label}
              </button>
            )}
          </details>
        </div>
      </header>

      {demoPhase !== "idle" && <AutoDemoBanner line={demoLine} onSkip={stopAutoDemo} />}

      <JournalPanel
        open={journalOpen}
        onClose={() => setJournalOpen(false)}
        teamEntries={journalEntries}
        visitorEntries={visitorEntries}
        measuringId={journalMeasuringId}
        onOpen={(entry) => {
          setJournalOpen(false);
          setBlinkPasses(false);
          setShareMark({ ra: entry.ra, dec: entry.dec });
          setShareArmed(false);
          setPendingJournalFrame(entry.view?.frame ?? null);
          setShareStatus(
            entry.source === "visitor" ? "Shared by a visitor, not measured yet" : null,
          );
          if (entry.preset) {
            const uiKey = normalizeTargetKey(entry.preset);
            patchView({
              targetKey: uiKey,
              mode: "single",
              pass: entry.view?.pass ?? null,
              detector: entry.view?.detector ?? null,
              playing: false,
            });
            return;
          }
          const t: Target = {
            name: entry.name,
            ra: entry.target.ra,
            dec: entry.target.dec,
            epoch: entry.target.epoch ?? 2000,
            pm_ra: entry.target.pm_ra,
            pm_dec: entry.target.pm_dec,
          };
          const label = `${entry.target.ra.toFixed(4)}, ${entry.target.dec.toFixed(4)}`;
          setSearchInput(label);
          setJournalMeasuringId(entry.id);
          patchView({
            targetKey: "custom",
            query: label,
            mode: "single",
            pass: entry.view?.pass ?? null,
            detector: entry.view?.detector ?? null,
            frameIndex: 0,
            playing: false,
          });
          const ac = new AbortController();
          void loadFromService(t, ac.signal, "custom").finally(() => {
            setJournalMeasuringId(null);
          });
        }}
      />

      <p className="targets-label">{EXAMPLES.label}</p>
      <nav className="targets" aria-label="Challenge test targets">
        {KNOWN_TARGETS.filter((t) => !t.synthetic).map((t) => {
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
              {t.label}
              {!ready && <span className="soon">SOON</span>}
            </button>
          );
        })}
        {KNOWN_TARGETS.filter((t) => t.synthetic).map((t) => {
          const ready = t.inSampleIndex || !!t.bundleUrl || (t.ra != null && t.dec != null);
          return (
            <button
              key={t.key}
              type="button"
              className={`target-btn target-btn--synthetic${view.targetKey === t.key ? " active" : ""}`}
              onClick={() => {
                setBlinkPasses(false);
                patchView({ targetKey: t.key, mode: "single", pass: null });
              }}
              disabled={!ready}
              title={t.blurb}
            >
              {t.label}
              <span className="synthetic-badge">SYNTHETIC</span>
            </button>
          );
        })}
        <button
          type="button"
          className="ghost"
          title={TOP.howItWorks.hint}
          onClick={() => patchView({ showHelp: true })}
        >
          {TOP.howItWorks.label}
        </button>
      </nav>
      <p className="targets-hint">{targetByKey(view.targetKey)?.blurb ?? EXAMPLES.typed}</p>
      <form className="search" onSubmit={onSearch}>
        <label className="sr-only" htmlFor="sky-query">
          Object name or RA Dec
        </label>
        <input
          id="sky-query"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Name or RA Dec (e.g. 269.45 4.69)"
          autoComplete="off"
          title="Type a star name or sky coordinates (degrees or sexagesimal)"
        />
        <button type="submit" title="Resolve the name and load SPHEREx images">
          Go
        </button>
      </form>
      <p className="search-hint">Try: Luhman 16 · 133.7951, -7.2451 · 08h55m10.8s -07d14m43s</p>

      <nav className="mode-tabs" aria-label="What do you want to do?">
        {(["watch", "compare", "difference", "more"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={uiMode === id ? "active" : ""}
            title={WAYS[id].hint}
            onClick={() => setUiMode(id)}
          >
            {WAYS[id].label}
          </button>
        ))}
      </nav>
      <p className="mode-hint">{WAYS[uiMode].hint}</p>

      <main className="main workspace">
        <section className="viewer-pane stage" ref={stageRef}>
          {/* Invisible width probe: column width, not the square box (avoids circular sizing). */}
          <div className="stage-width-probe" ref={measureRef} aria-hidden="true" />
          {load.status === "ready" && (
            <p className="place-line" title={PLACE.hint}>
              <strong>{load.data.target.name ?? targetName}</strong>
              <span>{PLACE.coordinates(load.data.target.ra, load.data.target.dec)}</span>
              {passes.length > 0 && <span>{PLACE.visits(passes.length)}</span>}
            </p>
          )}
          <div
            className={`stage-measure${splitPair ? " is-wide" : " is-square"}${shareArmed ? " is-share-armed" : ""}`}
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
            {...(shareArmed
              ? {
                  role: "application" as const,
                  tabIndex: 0,
                  "aria-label": "Click the sky to drop a frame on what you see",
                  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
                    if (e.key === "Escape") {
                      setShareArmed(false);
                      setShareStatus(null);
                    }
                  },
                  onClick: (e: ReactMouseEvent<HTMLDivElement>) => {
                    if (load.status !== "ready") return;
                    const canvas = (e.target as HTMLElement).closest("canvas");
                    if (!canvas) return;
                    const rect = canvas.getBoundingClientRect();
                    if (rect.width < 8 || rect.height < 8) return;
                    const grid = load.data.grid;
                    const x = ((e.clientX - rect.left) / rect.width) * grid.size;
                    const y = ((e.clientY - rect.top) / rect.height) * grid.size;
                    const [ra, dec] = pixelToSky(grid, x, y);
                    setShareMark({ ra, dec });
                    setShareArmed(false);
                    setShareStatus("Frame set. Pick a category and share.");
                  },
                }
              : {})}
          >
            {(targetByKey(view.targetKey)?.synthetic || candidatesFile?.synthetic) && (
              <p className="synthetic-banner" role="status">
                SYNTHETIC TEST: a made-up body added to real SPHEREx frames. It does not exist.
              </p>
            )}
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
                    smoothScale={smoothScale}
                    trail={showPathTrail ? trail : []}
                    candidates={showPathTrail ? (candidatesFile?.candidates ?? []) : []}
                    candidatesGrid={candidatesFile?.grid ?? null}
                    viewGrid={load.status === "ready" ? load.data.grid : null}
                    activeCandidate={activeCandidate}
                    saturated={showPathTrail ? (candidatesFile?.saturated ?? []) : []}
                    catalogSlices={catalogFile?.catalogs ?? []}
                    catalogEnabled={
                      new Set(
                        [showGaia ? "gaia" : null, showAllwise ? "allwise" : null].filter(
                          Boolean,
                        ) as CatalogKey[],
                      )
                    }
                    catalogHighlightId={catalogHighlightId ?? flightPath?.sourceId ?? null}
                    flightPath={showPathTrail ? flightPath : null}
                    flightScrub={flightScrub}
                    markXy={
                      shareMark && load.status === "ready"
                        ? skyToPixel(load.data.grid, shareMark.ra, shareMark.dec)
                        : null
                    }
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
            {display &&
              view.mode === "single" &&
              display.kind === "single" &&
              display.meta &&
              display.meta.frame.valid_fraction < 0.95 && (
                <p className="edge-nodata" role="status">
                  Edge of the detector: no data in the hatched area.
                </p>
              )}
          </div>
          {flightPath && (
            <fieldset className="flight-scrub">
              <legend className="sr-only">Scrub years along the AllWISE path</legend>
              <span className="flight-scrub-year">
                {Math.round(
                  flightPath.fromYear + (flightPath.toYear - flightPath.fromYear) * flightScrub,
                )}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={flightScrub}
                onChange={(e) => {
                  if (flightPlayRef.current != null) {
                    window.clearInterval(flightPlayRef.current);
                    flightPlayRef.current = null;
                    setFlightPlaying(false);
                  }
                  setFlightScrub(Number(e.target.value));
                }}
                aria-label="Year along the flight path"
                title="Drag to slide from 2010 to now"
              />
              <button
                type="button"
                className={flightPlaying ? "active" : "primary"}
                onClick={() => playFlightYears()}
                disabled={flightPlaying}
                title="Animate the object from AllWISE 2010 to SPHEREx now"
              >
                {flightPlaying ? "Playing…" : SURVEYS.years.label}
              </button>
            </fieldset>
          )}
          <CatalogLegend gaia={showGaia} wise={showAllwise} />
          {load.status === "ready" && liveProgress && liveProgress.loaded < liveProgress.total && (
            <div className="status-banner quiet" role="status">
              More images are arriving from the archive: {liveProgress.loaded} of{" "}
              {liveProgress.total}. You can already play the ones that are here.
              <progress value={liveProgress.loaded} max={liveProgress.total} />
            </div>
          )}

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
                    aria-label="Frame"
                    title="Drag to pick a frame by hand"
                  />
                )}
                {(advancedOpen || blinkPasses || ghostVisits || splitVisits) && (
                  <>
                    {!overlayActive && !blinkPasses && (
                      <label className="fps-field" title="Playback speed (1–30)">
                        FPS
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={fpsDraft}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/\D/g, "");
                            setFpsDraft(raw);
                            if (raw === "") return;
                            const n = Number(raw);
                            if (n >= 1 && n <= 30) patchView({ fps: n });
                          }}
                          onBlur={() => {
                            const n = Number(fpsDraft);
                            const next =
                              Number.isFinite(n) && n >= 1 ? Math.min(30, Math.floor(n)) : 24;
                            setFpsDraft(String(next));
                            if (next !== view.fps) patchView({ fps: next });
                          }}
                          aria-label="Frames per second"
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      className={blinkPasses ? "active" : "ghost"}
                      disabled={passes.length < 2}
                      title={`${WAYS.compare.hint} (B)`}
                      onClick={() => {
                        if (blinkPasses) {
                          setBlinkPasses(false);
                          blinkWaveRef.current = null;
                          patchView({ pass: null, mode: "single", waveUm: null });
                        } else {
                          setUiMode("compare");
                        }
                      }}
                    >
                      {blinkPasses ? "Stop blink" : WAYS.compare.label}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={passes.length < 2}
                      title={WAYS.difference.hint}
                      onClick={() => setUiMode("difference")}
                    >
                      {WAYS.difference.label}
                    </button>
                    <button
                      type="button"
                      className={ghostVisits ? "active" : "ghost"}
                      disabled={passes.length < 2}
                      title={PLAYER.overlay.hint}
                      onClick={() => {
                        setExclusiveOverlay(ghostVisits ? null : "ghost");
                        patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
                      }}
                    >
                      {PLAYER.overlay.label}
                    </button>
                    <button
                      type="button"
                      className={splitVisits ? "active" : "ghost"}
                      disabled={passes.length < 2}
                      title={PLAYER.sideBySide.hint}
                      onClick={() => {
                        setExclusiveOverlay(splitVisits ? null : "split");
                        patchView({ playing: false, mode: "single", pass: null, frameIndex: 0 });
                      }}
                    >
                      {PLAYER.sideBySide.label}
                    </button>
                  </>
                )}
              </div>
              {!overlayActive && (
                <FrameCaption
                  frames={filtered}
                  frameIndex={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                  playing={view.playing || blinkPasses}
                  hasCatalogMotion={hasCatalogMotion}
                />
              )}
              <ShareFinding
                open={journalLiveOpen && load.status === "ready" && !eyepiece}
                armed={shareArmed}
                hasMark={shareMark != null}
                category={shareCategory}
                status={shareStatus}
                busy={shareBusy}
                onToggleArm={() => {
                  const next = !shareArmed;
                  setShareArmed(next);
                  if (next) {
                    patchView({ playing: false });
                    setShareStatus("Click the sky to drop a small frame on what you see.");
                  } else {
                    setShareStatus(null);
                  }
                }}
                onCategory={setShareCategory}
                onClear={() => {
                  setShareMark(null);
                  setShareStatus(null);
                  setShareArmed(false);
                }}
                onShare={() => {
                  if (!shareMark || load.status !== "ready") return;
                  const t = load.data.target;
                  const preset =
                    view.targetKey !== "custom"
                      ? (INDEX_KEY_BY_UI[view.targetKey] ?? view.targetKey)
                      : undefined;
                  setShareBusy(true);
                  setShareStatus(null);
                  void postJournalMark({
                    ra: shareMark.ra,
                    dec: shareMark.dec,
                    category: shareCategory,
                    target: {
                      ra: t.ra,
                      dec: t.dec,
                      epoch: t.epoch,
                      pm_ra: t.pm_ra,
                      pm_dec: t.pm_dec,
                    },
                    preset,
                    detector: view.detector ?? undefined,
                    pass: view.pass ?? display?.meta?.exposure.pass,
                    frame: display?.meta?.frame.id,
                  })
                    .then((res) => {
                      setVisitorEntries((prev) => [
                        res.entry,
                        ...prev.filter((e) => e.id !== res.entry.id),
                      ]);
                      setShareStatus(
                        res.status === 200 ? "Someone already shared this place." : "Shared.",
                      );
                      setShareArmed(false);
                    })
                    .catch((err: unknown) => {
                      if (err instanceof ApiError) {
                        if (err.code === "too_many_marks") {
                          setShareStatus("Five marks an hour. Try again later.");
                          return;
                        }
                        if (err.code === "journal_full" || err.code === "journal_closed") {
                          setJournalLiveOpen(false);
                          setShareStatus("Sharing is closed right now.");
                          return;
                        }
                      }
                      setShareStatus("Could not share. Try again.");
                    })
                    .finally(() => setShareBusy(false));
                }}
              />
              {!eyepiece && (
                <details className="viewer-guide-fold" open>
                  <summary>What you are looking at</summary>
                  <ViewerGuide targetName={targetName} pass={view.pass} mode={guideMode} />
                </details>
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
              {eyepiece && <p className="app--eyepiece-hint">Eyepiece on · Esc or E to leave</p>}
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

        <aside className="side rail">
          {(candidatesFile || candidatesWaiting) && (
            <details className="rail-card details rail-secondary" open>
              <summary title={FOUND.panel.hint}>{FOUND.panel.label}</summary>
              <CandidatesPanel
                data={candidatesFile}
                waiting={candidatesWaiting}
                activeIndex={activeCandidate}
                detector={view.detector}
                catalogPmRa={load.status === "ready" ? load.data.target.pm_ra : null}
                catalogPmDec={load.status === "ready" ? load.data.target.pm_dec : null}
                gaiaCatalog={gaiaForKnownAs}
                showDetectionTrust={
                  view.targetKey === "wise0855" ||
                  (candidatesFile?.candidates.some((c) => c.kind === "moved") ?? false)
                }
                coldDetectionNote={view.targetKey === "wise0855"}
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
            </details>
          )}

          {display && load.status === "ready" && display.meta && (
            <dl className="meta">
              <div>
                <dt>Target</dt>
                <dd>{load.data.target.name ?? targetName}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{display.meta.frame.time_iso}</dd>
              </div>
              <div>
                <dt>Wavelength</dt>
                <dd>
                  {display.meta.frame.wavelength_um.toFixed(4)} µm ±{" "}
                  {(display.meta.frame.bandwidth_um / 2).toFixed(4)}
                </dd>
              </div>
              <div>
                <dt>Visit / detector</dt>
                <dd>
                  {display.meta.exposure.pass} / {display.meta.exposure.detector} ·{" "}
                  {display.meta.exposure.collection}
                </dd>
              </div>
              <div>
                <dt>Target pixel</dt>
                <dd>
                  ({display.meta.frame.target_xy[0].toFixed(2)},{" "}
                  {display.meta.frame.target_xy[1].toFixed(2)})
                </dd>
              </div>
              <div>
                <dt>Photometry</dt>
                <dd className="meta-value-row">
                  <span className="meta-value-text">
                    {display.meta.frame.photometry.flux_mjy != null
                      ? `${display.meta.frame.photometry.flux_mjy.toFixed(3)} ± ${display.meta.frame.photometry.error_mjy?.toFixed(3)} mJy`
                      : "—"}
                  </span>
                  <span className="quality">{display.meta.frame.photometry.quality}</span>
                </dd>
              </div>
              <div>
                <dt>Bg / noise</dt>
                <dd className="meta-value-nowrap">
                  {display.meta.frame.background?.toFixed(3) ?? "—"} /{" "}
                  {display.meta.frame.noise?.toFixed(3) ?? "—"} MJy/sr
                </dd>
              </div>
              <div>
                <dt>Valid</dt>
                <dd>{(display.meta.frame.valid_fraction * 100).toFixed(0)}%</dd>
              </div>
              <div>
                <dt>Grid</dt>
                <dd className="meta-value-nowrap">
                  {load.data.grid.size}² · {load.data.grid.fov_deg}° · {view.mode} ·{" "}
                  {filtered.length} frames
                </dd>
              </div>
              <div>
                <dt>Frame</dt>
                <dd>
                  {Math.min(view.frameIndex, Math.max(filtered.length - 1, 0)) + 1} of{" "}
                  {filtered.length || "—"}
                </dd>
              </div>
            </dl>
          )}

          <details
            className="rail-card details sky-context-card"
            open={skyContextOpen}
            onToggle={(e) => setSkyContextOpen(e.currentTarget.open)}
          >
            <summary title="Where this cutout sits among the five challenge targets">
              {PANELS.sky}
            </summary>
            <SkyContextGlobe
              pins={CHALLENGE_SKY_PINS}
              activeKey={view.targetKey && view.targetKey !== "custom" ? view.targetKey : null}
              activeRa={load.status === "ready" ? load.data.target.ra : (skyTarget?.ra ?? null)}
              activeDec={load.status === "ready" ? load.data.target.dec : (skyTarget?.dec ?? null)}
              placeLabel={
                load.status === "ready"
                  ? (load.data.target.name ?? "This place")
                  : skyTarget
                    ? "This place"
                    : null
              }
              fovDeg={FIELD_PRESETS[fieldPreset].fov}
              onSelect={(key) => {
                setBlinkPasses(false);
                patchView({ targetKey: key, mode: "single", pass: null });
              }}
            />
          </details>

          {load.status === "ready" && (
            <details className="rail-card details rail-secondary" open>
              <summary title="How far star catalogs say this object should move between visits.">
                What the catalogs predict
              </summary>
              <MotionInsight
                grid={load.data.grid}
                trail={trail}
                targetName={load.data.target.name ?? targetName}
                hasCatalogMotion={hasCatalogMotion}
              />
            </details>
          )}

          <details
            className="rail-card details adjust-fold"
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
          >
            <summary title={ADVANCED.hint}>{ADVANCED.label}</summary>
            <div className="controls">
              <fieldset>
                <legend>{VISITS.label}</legend>
                <button
                  type="button"
                  className={view.pass == null ? "active" : ""}
                  title={VISITS.all.hint}
                  onClick={() => {
                    clearPresentationOverlays();
                    patchView({ pass: null, frameIndex: 0, playing: false });
                  }}
                >
                  {VISITS.all.label}
                </button>
                {passes.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={view.pass === p ? "active" : ""}
                    title={VISITS.one(p).hint}
                    onClick={() => {
                      clearPresentationOverlays();
                      patchView({ pass: p, frameIndex: 0, playing: false, mode: "single" });
                    }}
                  >
                    {p}
                  </button>
                ))}
                <p className="control-hint">
                  {view.pass == null ? VISITS.all.hint : VISITS.one(view.pass).hint}
                </p>
              </fieldset>

              <fieldset>
                <legend>{COMBINE.label}</legend>
                {(["single", "stack", "difference", "track"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={view.mode === mode && !passMovie ? "active" : ""}
                    title={COMBINE.options[mode].hint}
                    onClick={() => {
                      clearPresentationOverlays();
                      setBlinkPasses(false);
                      setPassMovie(false);
                      setUiMode(
                        mode === "difference" ? "difference" : mode === "single" ? "watch" : "more",
                      );
                      patchView({
                        mode,
                        playing: mode === "single" ? view.playing : false,
                      });
                    }}
                  >
                    {COMBINE.options[mode].label}
                  </button>
                ))}
                <p className="control-hint">{COMBINE.options[view.mode].hint}</p>
              </fieldset>

              <fieldset>
                <legend>{COLORS.label}</legend>
                <button
                  type="button"
                  className={view.waveUm == null ? "active" : ""}
                  title={COLORS.all.hint}
                  onClick={() => patchView({ waveUm: null, frameIndex: 0 })}
                >
                  {COLORS.all.label}
                </button>
                <button
                  type="button"
                  className={view.waveUm != null ? "active" : ""}
                  disabled={!display || !("meta" in display) || !display.meta}
                  title={COLORS.thisOne.hint}
                  onClick={() => {
                    if (!display || !("meta" in display) || !display.meta) return;
                    patchView({
                      waveUm: Number(display.meta.frame.wavelength_um.toFixed(4)),
                      frameIndex: 0,
                      playing: false,
                    });
                  }}
                >
                  {COLORS.thisOne.label}
                </button>
                {view.waveUm != null && (
                  <span className="wave-chip">
                    {view.waveUm.toFixed(3)} ± {view.waveTolUm.toFixed(3)} µm · {filtered.length}{" "}
                    images
                  </span>
                )}
                <p className="control-hint">
                  {view.waveUm == null ? COLORS.all.hint : COLORS.thisOne.hint}
                </p>
              </fieldset>

              <fieldset className="contrast-field">
                <legend>{CONTRAST.label}</legend>
                <label title={CONTRAST.hint}>
                  <span className="sr-only">{CONTRAST.label}</span>
                  <input
                    type="range"
                    min={0.4}
                    max={3}
                    step={0.1}
                    value={contrastLive}
                    onChange={(e) => setContrastLive(Number(e.target.value))}
                    onPointerUp={() => {
                      if (contrastLive !== view.contrast) patchView({ contrast: contrastLive });
                    }}
                    onKeyUp={() => {
                      if (contrastLive !== view.contrast) patchView({ contrast: contrastLive });
                    }}
                    aria-label={CONTRAST.label}
                  />
                  <span>{contrastLive.toFixed(1)}×</span>
                </label>
                <p className="control-hint">{CONTRAST.hint}</p>
              </fieldset>

              <fieldset>
                <legend>{PALETTE.label}</legend>
                <button
                  type="button"
                  className={view.colorMap === "heat" ? "active" : ""}
                  title={PALETTE.heat.hint}
                  onClick={() => patchView({ colorMap: "heat" })}
                >
                  {PALETTE.heat.label}
                </button>
                <button
                  type="button"
                  className={view.colorMap === "gray" ? "active" : ""}
                  title={PALETTE.gray.hint}
                  onClick={() => patchView({ colorMap: "gray" })}
                >
                  {PALETTE.gray.label}
                </button>
                <p className="control-hint">
                  {view.colorMap === "heat" ? PALETTE.heat.hint : PALETTE.gray.hint}
                </p>
              </fieldset>

              <fieldset>
                <legend>{LOOK.label}</legend>
                <button
                  type="button"
                  className={smoothScale ? "active" : ""}
                  title={LOOK.smooth.hint}
                  onClick={() => setSmoothScale(true)}
                >
                  {LOOK.smooth.label}
                </button>
                <button
                  type="button"
                  className={!smoothScale ? "active" : ""}
                  title={LOOK.pixels.hint}
                  onClick={() => setSmoothScale(false)}
                >
                  {LOOK.pixels.label}
                </button>
                <button
                  type="button"
                  className={showPathTrail ? "active" : ""}
                  title={LOOK.path.hint}
                  onClick={() => setShowPathTrail((v) => !v)}
                >
                  {showPathTrail ? "Path on" : "Path off"}
                </button>
                <p className="control-hint">
                  {smoothScale ? LOOK.smooth.hint : LOOK.pixels.hint}
                  {showPathTrail ? ` ${LOOK.path.on}` : ""}
                </p>
              </fieldset>

              <fieldset>
                <legend>{SIZE.label}</legend>
                <button
                  type="button"
                  className={fieldPreset === "default" ? "active" : ""}
                  title={SIZE.close.hint}
                  onClick={() => applyFieldPreset("default")}
                >
                  {SIZE.close.label}
                </button>
                <button
                  type="button"
                  className={fieldPreset === "wide" ? "active" : ""}
                  title={SIZE.wide.hint}
                  onClick={() => applyFieldPreset("wide")}
                >
                  {SIZE.wide.label}
                </button>
                <p className="control-hint">
                  {fieldPreset === "wide" ? SIZE.wide.hint : SIZE.close.hint}
                </p>
              </fieldset>

              <fieldset>
                <legend>{SURVEYS.label}</legend>
                <button
                  type="button"
                  className={showGaia ? "active" : ""}
                  disabled={catalogError != null && !catalogFile}
                  title={SURVEYS.gaia.hint}
                  onClick={() => setShowGaia((v) => !v)}
                >
                  {SURVEYS.gaia.label}
                </button>
                <button
                  type="button"
                  className={showAllwise ? "active" : ""}
                  disabled={catalogError != null && !catalogFile}
                  title={SURVEYS.wise.hint}
                  onClick={() => setShowAllwise((v) => !v)}
                >
                  {SURVEYS.wise.label}
                </button>
                <button
                  type="button"
                  className={showAllwise && flightPath ? "active" : ""}
                  disabled={catalogError != null && !catalogFile}
                  title={SURVEYS.path.hint}
                  onClick={() => {
                    setShowAllwise(true);
                    setShowPathTrail(true);
                    setFlightScrub(1);
                  }}
                >
                  {SURVEYS.path.label}
                </button>
                <button
                  type="button"
                  className={flightPlaying ? "active" : ""}
                  disabled={(catalogError != null && !catalogFile) || flightPlaying}
                  title={SURVEYS.years.hint}
                  onClick={() => {
                    setShowAllwise(true);
                    setShowPathTrail(true);
                    playFlightYears();
                  }}
                >
                  {SURVEYS.years.label}
                </button>
                <p className="control-hint">{SURVEYS.group}</p>
                {catalogWaiting && <span className="wave-chip">Asking catalogs…</span>}
                {catalogError && <span className="wave-chip catalog-unavail">{catalogError}</span>}
                {catalogTip && <span className="wave-chip catalog-tip">{catalogTip}</span>}
              </fieldset>

              {view.mode === "difference" && (
                <fieldset className="diff-picks">
                  <legend>Passes A − B</legend>
                  <label>
                    A
                    <select
                      value={view.diffPassA}
                      onChange={(e) => patchView({ diffPassA: Number(e.target.value) })}
                    >
                      {passes.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    B
                    <select
                      value={view.diffPassB}
                      onChange={(e) => patchView({ diffPassB: Number(e.target.value) })}
                    >
                      {passes.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                </fieldset>
              )}
            </div>

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
              {false && uiMode === "watch" && (
                <div className="control-block">
                  {overlayActive ? (
                    <>
                      <p className="lead">Overlay on.</p>
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
                  ) : null}
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
                      title={COMBINE.options.stack.hint}
                    >
                      {COMBINE.options.stack.label}
                    </button>
                    <button
                      type="button"
                      className={passMovie ? "active" : ""}
                      title={COMBINE.averageMovie.hint}
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
                      {COMBINE.averageMovie.label}
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
                      {COMBINE.averageThisVisit}
                    </button>
                  )}
                  {view.mode !== "difference" && (
                    <>
                      <p className="control-label">{VISITS.label}</p>
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
                <label className="tint-mask-row">
                  <input
                    type="checkbox"
                    checked={tintMask}
                    onChange={(e) => setTintMask(e.target.checked)}
                  />
                  <span title={FLAGS.hint}>{FLAGS.label}</span>
                </label>
                <button
                  type="button"
                  className="ghost"
                  title="Copy a link that auto-plays 2010→now for this target"
                  onClick={() => copyYearsLink()}
                >
                  {yearsLinkCopied ? "Copied" : "Years link"}
                </button>
                {showAllwise && flightPath && (
                  <p className="micro flight-path-note">
                    Flight path {flightPath.label}
                    {flightPath.sourceId ? ` · ${flightPath.sourceId}` : ""} · scrub or{" "}
                    {SURVEYS.years.label}
                  </p>
                )}
                {catalogFile?.catalogs.some((c) => c.truncated) && (
                  <p className="micro">Showing the 300 brightest</p>
                )}
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
                {PANELS.timeline}
              </summary>
              <Charts
                frames={filtered}
                spectrumPoints={spectrumPoints ?? undefined}
                spectrumWaiting={spectrumWaiting}
                highlightDetector={view.detector}
                spiffLine={
                  view.targetKey === "epsindi"
                    ? "Within 2 percent of the published SPIFF library"
                    : null
                }
                bandMarkers={
                  view.targetKey === "epsindi"
                    ? [
                        { label: "H₂O", um: 1.4, halfUm: 0.15 },
                        { label: "CH₄", um: 2.3, halfUm: 0.18 },
                        { label: "H₂O", um: 1.9, halfUm: 0.1 },
                      ]
                    : null
                }
                onBandPick={(um, label) => {
                  clearPresentationOverlays();
                  const pool =
                    load.status === "ready"
                      ? filterFrames(load.data.frames, {
                          pass: view.pass,
                          detector: view.detector,
                        })
                      : [];
                  const near = filterNearWavelength(pool, um, view.waveTolUm);
                  const idx = near.length > 0 ? closestFrameIndex(near, um) : 0;
                  patchView({
                    waveUm: Number(um.toFixed(4)),
                    frameIndex: idx,
                    playing: false,
                    mode: "single",
                  });
                  setDiscoveryIsHalo(false);
                  setDiscoveryFlash(`Sky locked near ${label} · ${um.toFixed(1)} µm`);
                  window.setTimeout(() => setDiscoveryFlash(null), 2800);
                }}
                lockedWaveUm={view.waveUm}
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

      <footer className="foot">Foxtrot Zulu Kilo Lima · Planet X and SPHEREx · AGPL-3.0</footer>
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
          <dd className="meta-value-row">
            <span className="quality">{f.photometry.quality}</span>
            <span className="meta-value-text">
              {f.photometry.flux_mjy != null
                ? `${f.photometry.flux_mjy.toFixed(3)} ± ${f.photometry.error_mjy?.toFixed(3)} mJy`
                : "flux unavailable"}
            </span>
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
        <p className="mask-legend-hint">{tintMask ? FLAGS.on : FLAGS.off}</p>
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
