import { type FormEvent, startTransition, useCallback, useEffect, useMemo, useState } from "react";
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
import { HealthBadge } from "./ui/HealthBadge";
import { HelpPanel } from "./ui/HelpPanel";
import { FrameCanvas } from "./viewer/FrameCanvas";

type LoadState =
  | { status: "idle" }
  | { status: "loading"; message: string; loaded?: number; total?: number }
  | { status: "error"; message: string }
  | { status: "ready"; data: DecodedBundle };

function parseCoordinateQuery(raw: string): Target | null {
  const trimmed = raw.trim();
  // decimal degrees: "269.45 4.69" or "269.45,4.69"
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
          message: `${known.label} will load from a static bundle once backend step B6 ships it. Try Barnard's Star for now, or search by coordinates when the service is up.`,
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
      setLoad({ status: "loading", message: "Resolving exposures…" });
      const { target: t, grid, exposures } = await fetchExposures(target, {}, signal);
      if (signal.aborted) return;
      if (exposures.length === 0) {
        setLoad({
          status: "error",
          message: "SPHEREx has no exposures at this position (or the list is empty).",
        });
        return;
      }

      // Prefer detector 2 first (matches sample / architecture default view).
      const preferred = exposures.filter((e) => e.detector === 2);
      const queue =
        preferred.length > 0
          ? preferred
          : exposures.filter((e) => e.detector === exposures[0]!.detector);

      const frames: Frame[] = new Array(queue.length);
      let loaded = 0;
      setLoad({
        status: "loading",
        message: `Loading frames…`,
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
                  message: `Loading frames… ${loaded}/${queue.length}`,
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

  // Initial + targetKey changes
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
    // Only reload when the selected known target changes, not every view tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.targetKey]);

  const filtered = useMemo(() => {
    if (load.status !== "ready") return [];
    const byPass = filterFrames(load.data.frames, { pass: view.pass, detector: view.detector });
    return filterNearWavelength(byPass, view.waveUm, view.waveTolUm);
  }, [load, view.pass, view.detector, view.waveUm, view.waveTolUm]);

  // Keep frame index in range
  useEffect(() => {
    if (filtered.length === 0) return;
    if (view.frameIndex >= filtered.length) {
      patchView({ frameIndex: 0 });
    }
  }, [filtered.length, view.frameIndex, patchView]);

  // Animation
  useEffect(() => {
    if (!view.playing || view.mode !== "single" || filtered.length < 2) return;
    const ms = 1000 / view.fps;
    const id = window.setInterval(() => {
      setView((prev) => {
        const next = {
          ...prev,
          frameIndex: (prev.frameIndex + 1) % Math.max(filtered.length, 1),
        };
        writeViewToUrl(next);
        return next;
      });
    }, ms);
    return () => window.clearInterval(id);
  }, [view.playing, view.fps, view.mode, filtered.length]);

  const display = useMemo(() => {
    if (load.status !== "ready" || filtered.length === 0) return null;
    const size = load.data.grid.size;
    const active = filtered[Math.min(view.frameIndex, filtered.length - 1)]!;

    if (view.mode === "stack") {
      const stacked = stackFrames(filtered);
      const limits = applyContrast(computeDisplayLimits([stacked]), view.contrast);
      return {
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
    if (view.mode === "difference") {
      const diff = differencePasses(filtered, view.diffPassA, view.diffPassB);
      const limits = applyContrast(computeDisplayLimits([diff]), view.contrast);
      return {
        pixels: diff.pixels,
        mask: diff.mask,
        background: 0,
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
      pixels: active.pixels,
      mask: active.mask,
      background: active.frame.background,
      lo: limits.lo,
      hi: limits.hi,
      size,
      targetXy: active.frame.target_xy,
      meta: active,
    };
  }, [load, filtered, view.frameIndex, view.mode, view.diffPassA, view.diffPassB, view.contrast]);

  const passes = load.status === "ready" ? uniquePasses(load.data.frames) : [];
  const detectors = load.status === "ready" ? uniqueDetectors(load.data.frames) : [];

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
      setLoad({ status: "loading", message: `Resolving “${raw}”…` });
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

  return (
    <div className="app">
      <header className="top">
        <div className="brand-block">
          <p className="brand">SPHEREx Explorer</p>
          <p className="tagline">Watch the near-infrared sky move — NASA Space Apps 2026</p>
        </div>
        <HealthBadge />
      </header>

      <nav className="targets" aria-label="Challenge test targets">
        {KNOWN_TARGETS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`target-btn${view.targetKey === t.key ? " active" : ""}`}
            onClick={() => patchView({ targetKey: t.key })}
            title={t.bundleUrl ? t.blurb : `${t.blurb} (bundle not ready yet)`}
          >
            {t.label}
            {!t.bundleUrl && <span className="soon">soon</span>}
          </button>
        ))}
        <button
          type="button"
          className="ghost"
          onClick={() => patchView({ showHelp: !view.showHelp })}
        >
          Help
        </button>
      </nav>

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
        />
        <button type="submit">Go</button>
      </form>

      <HelpPanel open={view.showHelp} onClose={() => patchView({ showHelp: false })} />

      <main className="main">
        <section className="viewer-pane">
          {load.status === "loading" && (
            <div className="status-banner">
              {load.message}
              {load.total != null && load.loaded != null && (
                <progress value={load.loaded} max={load.total} />
              )}
            </div>
          )}
          {load.status === "error" && <div className="status-banner error">{load.message}</div>}
          {display && (
            <>
              <FrameCanvas
                pixels={display.pixels}
                mask={display.mask}
                size={display.size}
                lo={display.lo}
                hi={display.hi}
                background={display.background}
                targetXy={display.targetXy}
              />
              <div className="transport">
                <button
                  type="button"
                  onClick={() => patchView({ playing: !view.playing })}
                  disabled={view.mode !== "single"}
                >
                  {view.playing ? "Pause" : "Play"}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(filtered.length - 1, 0)}
                  value={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
                  onChange={(e) =>
                    patchView({ frameIndex: Number(e.target.value), playing: false })
                  }
                  disabled={view.mode !== "single" || filtered.length === 0}
                  aria-label="Frame"
                />
                <label>
                  FPS
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={view.fps}
                    onChange={(e) => patchView({ fps: Number(e.target.value) || 8 })}
                  />
                </label>
              </div>
            </>
          )}
        </section>

        <aside className="side">
          <div className="controls">
            <fieldset>
              <legend>Pass</legend>
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
            </fieldset>

            {detectors.length > 1 && (
              <fieldset>
                <legend>Detector</legend>
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
              </fieldset>
            )}

            <fieldset>
              <legend>Mode</legend>
              {(
                [
                  ["single", "Single"],
                  ["stack", "Stack"],
                  ["difference", "Difference"],
                  ["track", "Track"],
                ] as [ComposeMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={view.mode === mode ? "active" : ""}
                  onClick={() =>
                    patchView({ mode, playing: mode === "single" ? view.playing : false })
                  }
                >
                  {label}
                </button>
              ))}
            </fieldset>

            <fieldset>
              <legend>Wavelength</legend>
              <button
                type="button"
                className={view.waveUm == null ? "active" : ""}
                onClick={() => patchView({ waveUm: null, frameIndex: 0 })}
              >
                All λ
              </button>
              <button
                type="button"
                className={view.waveUm != null ? "active" : ""}
                disabled={!display}
                title="Keep frames near this frame's wavelength so blinking is not confused with the spectrum"
                onClick={() => {
                  if (!display) return;
                  patchView({
                    waveUm: Number(display.meta.frame.wavelength_um.toFixed(4)),
                    frameIndex: 0,
                  });
                }}
              >
                Match this λ
              </button>
              {view.waveUm != null && (
                <span className="wave-chip">
                  {view.waveUm.toFixed(3)} ± {view.waveTolUm.toFixed(3)} µm · {filtered.length}{" "}
                  frames
                </span>
              )}
            </fieldset>

            <fieldset className="contrast-field">
              <legend>Contrast</legend>
              <label>
                <span className="sr-only">Contrast</span>
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.1}
                  value={view.contrast}
                  onChange={(e) => patchView({ contrast: Number(e.target.value) })}
                  aria-label="Contrast"
                />
                <span>{view.contrast.toFixed(1)}×</span>
              </label>
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

          {display && load.status === "ready" && (
            <MetadataPanel
              target={load.data.target}
              grid={load.data.grid}
              frame={display.meta}
              filteredCount={filtered.length}
              mode={view.mode}
            />
          )}

          {load.status === "ready" && (
            <Charts
              frames={filtered}
              activeIndex={Math.min(view.frameIndex, Math.max(filtered.length - 1, 0))}
            />
          )}
        </aside>
      </main>

      <footer className="foot">
        Foxtrot Zulu Kilo Lima · Planet X and SPHEREx · AGPL-3.0 · AI-assisted build disclosed in
        README
      </footer>
    </div>
  );
}

function MetadataPanel({
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
        <dt>Date</dt>
        <dd>{f.time_iso}</dd>
      </div>
      <div>
        <dt>Wavelength</dt>
        <dd>
          {f.wavelength_um.toFixed(4)} µm ± {(f.bandwidth_um / 2).toFixed(4)}
        </dd>
      </div>
      <div>
        <dt>Pass / detector</dt>
        <dd>
          {e.pass} / {e.detector} · {e.collection}
        </dd>
      </div>
      <div>
        <dt>Target pixel</dt>
        <dd>
          ({f.target_xy[0].toFixed(2)}, {f.target_xy[1].toFixed(2)})
        </dd>
      </div>
      <div>
        <dt>Photometry</dt>
        <dd>
          {f.photometry.flux_mjy != null
            ? `${f.photometry.flux_mjy.toFixed(3)} ± ${f.photometry.error_mjy?.toFixed(3)} mJy`
            : "—"}{" "}
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
        <dt>Valid</dt>
        <dd>{(f.valid_fraction * 100).toFixed(0)}%</dd>
      </div>
      <div>
        <dt>Grid</dt>
        <dd>
          {grid.size}² · {grid.fov_deg}° · {mode} · {filteredCount} frames
        </dd>
      </div>
    </dl>
  );
}
