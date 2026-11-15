import type { DecodedFrame } from "../data/decode";
import { type SpectrumPoint, spectrumPointsFromFrames } from "./spectrumPoints";

interface ChartsProps {
  frames: DecodedFrame[];
  /** Optional photometry-only points (index spectrum file / GET /api/spectrum). */
  spectrumPoints?: SpectrumPoint[];
  /** Live /api/spectrum still in flight (images may already be ready). */
  spectrumWaiting?: boolean;
  /** Detector currently on the stage: those points are drawn brighter. */
  highlightDetector?: number | null;
  /** Tommy SPIFF check: one-line trust mark under Spectrum (e.g. Epsilon Indi B). */
  spiffLine?: string | null;
  /** Absorption band callouts on the spectrum (brown-dwarf fingerprint). */
  bandMarkers?: SpectrumBand[] | null;
  activeIndex: number;
  onSelectFrame?: (index: number) => void;
}

export interface SpectrumBand {
  label: string;
  /** Center wavelength µm */
  um: number;
  /** Half-width for the soft band wash */
  halfUm?: number;
}

const PASS_COLORS = ["#0f766e", "#d97706", "#7c3aed", "#2563eb", "#be123c"];

function passColor(pass: number): string {
  return PASS_COLORS[(pass - 1) % PASS_COLORS.length]!;
}

/** Classroom-friendly wavelength / visit charts. B4 photometry rules. */
export function Charts({
  frames,
  spectrumPoints: spectrumPointsProp,
  spectrumWaiting = false,
  highlightDetector = null,
  spiffLine = null,
  bandMarkers = null,
  activeIndex,
  onSelectFrame,
}: ChartsProps) {
  if (
    frames.length === 0 &&
    !(spectrumPointsProp && spectrumPointsProp.length > 0) &&
    !spectrumWaiting
  ) {
    return null;
  }

  const points = spectrumPointsProp ?? spectrumPointsFromFrames(frames);
  // Null flux: no marker. Null wavelength (outside): skip from the plot.
  const withFlux = points.filter((p) => p.flux_mjy != null && p.wavelength_um != null);
  const waveStrip = [...frames].sort((a, b) => a.frame.wavelength_um - b.frame.wavelength_um);
  const active = frames[activeIndex];
  const activeWave = active?.frame.wavelength_um ?? null;
  const activeDet = active?.exposure.detector ?? null;
  const activeId = active?.frame.id;

  // Light curve: one detector only (Tommy B4). Wavelength changes across detectors.
  const lightPool = activeDet != null ? withFlux.filter((p) => p.detector === activeDet) : withFlux;
  const lightPoints = [...lightPool].sort((a, b) => a.time_mjd - b.time_mjd);

  const saturatedEverywhere = withFlux.length === 0;

  return (
    <div className="charts">
      <section className="chart-panel">
        <h3>Spectrum</h3>
        {spiffLine && !saturatedEverywhere && (
          <p
            className="spiff-badge"
            title="Checked against SPIFF (Gagné et al. 2026) — Tommy bridge"
          >
            {spiffLine}
          </p>
        )}
        <p className="chart-empty">
          Brightness vs infrared color (µm).
          {activeWave != null ? ` Watching ${activeWave.toFixed(2)} µm.` : ""}
          {spectrumWaiting && !(spectrumPointsProp && spectrumPointsProp.length > 0)
            ? " Measuring spectrum…"
            : saturatedEverywhere
              ? " This target saturates SPHEREx here. No flux number; the movie still works."
              : ` ${withFlux.length} points · one color per visit · hollow = flagged (still good).`}
        </p>
        {spectrumWaiting && withFlux.length === 0 ? (
          <p className="chart-empty">Waiting for /api/spectrum. Images keep loading.</p>
        ) : saturatedEverywhere ? (
          <p className="chart-saturated">
            Too bright for a flux number here. The images still work. Try Epsilon Indi B for a full
            infrared spectrum.
          </p>
        ) : (
          <FluxSvg
            points={withFlux
              .slice()
              .sort((a, b) => (a.wavelength_um as number) - (b.wavelength_um as number))
              .map((p) => ({
                x: p.wavelength_um as number,
                y: p.flux_mjy as number,
                err: p.error_mjy,
                pass: p.pass,
                detector: p.detector,
                active: p.id === activeId,
                flagged: p.quality === "flagged",
                quality: p.quality,
                id: p.id,
              }))}
            xLabel="µm"
            yLabel="mJy"
            fixedX={[0.75, 5]}
            highlightDetector={highlightDetector}
            bands={bandMarkers ?? undefined}
            onPick={(id) => {
              const idx = frames.findIndex((f) => f.frame.id === id);
              if (idx >= 0) onSelectFrame?.(idx);
            }}
          />
        )}
        <DotStrip
          frames={waveStrip}
          activeId={activeId}
          mode="wave"
          onPick={(id) => {
            const idx = frames.findIndex((f) => f.frame.id === id);
            if (idx >= 0) onSelectFrame?.(idx);
          }}
        />
      </section>

      <section className="chart-panel">
        <h3>Light curve</h3>
        <p className="chart-empty">
          Brightness over time inside one camera
          {activeDet != null ? ` (detector ${activeDet})` : ""}. Never mixed across detectors.
        </p>
        {lightPoints.length > 0 ? (
          <FluxSvg
            points={lightPoints.map((p) => ({
              x: p.time_mjd,
              y: p.flux_mjy as number,
              err: p.error_mjy,
              pass: p.pass,
              detector: p.detector,
              active: p.id === activeId,
              flagged: p.quality === "flagged",
              quality: p.quality,
              id: p.id,
            }))}
            xLabel="MJD"
            yLabel="mJy"
            highlightDetector={highlightDetector}
            onPick={(id) => {
              const idx = frames.findIndex((f) => f.frame.id === id);
              if (idx >= 0) onSelectFrame?.(idx);
            }}
          />
        ) : (
          <p className="chart-empty">No flux points in this camera yet.</p>
        )}
        <DotStrip
          frames={[...frames]
            .filter((f) => (activeDet == null ? true : f.exposure.detector === activeDet))
            .sort((a, b) => a.frame.time_mjd - b.frame.time_mjd)}
          activeId={active?.frame.id}
          mode="time"
          onPick={(id) => {
            const idx = frames.findIndex((f) => f.frame.id === id);
            if (idx >= 0) onSelectFrame?.(idx);
          }}
        />
      </section>
    </div>
  );
}

function DotStrip({
  frames,
  activeId,
  mode,
  onPick,
}: {
  frames: DecodedFrame[];
  activeId?: string;
  mode: "wave" | "time";
  onPick?: (id: string) => void;
}) {
  if (frames.length === 0) return null;
  const min = mode === "wave" ? frames[0]!.frame.wavelength_um : frames[0]!.frame.time_mjd;
  const max =
    mode === "wave"
      ? frames[frames.length - 1]!.frame.wavelength_um
      : frames[frames.length - 1]!.frame.time_mjd;
  const span = max - min || 1;
  const labelLeft =
    mode === "wave" ? `${min.toFixed(2)} µm` : new Date(frames[0]!.frame.time_iso).getFullYear();
  const labelRight =
    mode === "wave"
      ? `${max.toFixed(2)} µm`
      : new Date(frames[frames.length - 1]!.frame.time_iso).getFullYear();

  return (
    <svg className="strip" viewBox="0 0 300 28" role="img" aria-label="Timeline">
      <line x1="8" y1="14" x2="292" y2="14" stroke="currentColor" strokeOpacity="0.35" />
      {frames.map((f) => {
        const value = mode === "wave" ? f.frame.wavelength_um : f.frame.time_mjd;
        const x = 8 + ((value - min) / span) * 284;
        const active = f.frame.id === activeId;
        return (
          // biome-ignore lint/a11y/useSemanticElements: SVG timeline dots need a <g> hit target
          <g
            key={f.frame.id}
            role="button"
            tabIndex={0}
            style={{ cursor: onPick ? "pointer" : undefined }}
            onClick={() => onPick?.(f.frame.id)}
            onKeyDown={(e) => {
              if (!onPick) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(f.frame.id);
              }
            }}
          >
            <title>
              {mode === "wave"
                ? `${f.frame.wavelength_um.toFixed(3)} µm · Visit ${f.exposure.pass}`
                : `Visit ${f.exposure.pass} · ${f.frame.time_iso}`}
            </title>
            <circle
              cx={x}
              cy={14}
              r={active ? 4.5 : 2.5}
              fill={active ? passColor(f.exposure.pass) : "var(--muted)"}
            />
          </g>
        );
      })}
      <text x="8" y="26" className="strip-label">
        {labelLeft}
      </text>
      <text x="292" y="26" textAnchor="end" className="strip-label">
        {labelRight}
      </text>
    </svg>
  );
}

interface FluxPoint {
  x: number;
  y: number;
  err: number | null;
  pass: number;
  detector?: number;
  active: boolean;
  flagged: boolean;
  /** Photometry quality tag; unknown values still plot (Tommy addition B). */
  quality: string;
  id: string;
}

function FluxSvg({
  points,
  xLabel,
  yLabel,
  onPick,
  fixedX,
  highlightDetector = null,
  bands,
}: {
  points: FluxPoint[];
  xLabel: string;
  yLabel: string;
  onPick?: (id: string) => void;
  /** Spectrum always spans SPHEREx 0.75 to 5 µm when set. */
  fixedX?: [number, number];
  highlightDetector?: number | null;
  bands?: SpectrumBand[];
}) {
  const w = 320;
  const h = 140;
  const padL = 36;
  const padR = 16;
  const padT = 14;
  const padB = 22;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = fixedX ? fixedX[0] : Math.min(...xs);
  const maxX = fixedX ? fixedX[1] : Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const ratio = maxY / Math.max(minY, 1e-9);
  const useLog = ratio > 20 && minY > 0;

  const yMin = useLog ? Math.log10(minY) : minY;
  const yMax = useLog ? Math.log10(maxY) : maxY;
  const sx = (x: number) => padL + ((x - minX) / (maxX - minX || 1)) * (w - padL - padR);
  const sy = (y: number) => {
    const v = useLog ? Math.log10(Math.max(y, 1e-12)) : y;
    return h - padB - ((v - yMin) / (yMax - yMin || 1)) * (h - padT - padB);
  };

  const byPass = new Map<number, FluxPoint[]>();
  for (const p of points) {
    const list = byPass.get(p.pass) ?? [];
    list.push(p);
    byPass.set(p.pass, list);
  }

  return (
    <svg className="flux-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Flux chart">
      {bands?.map((b) => {
        const half = b.halfUm ?? 0.12;
        const x0 = sx(Math.max(minX, b.um - half));
        const x1 = sx(Math.min(maxX, b.um + half));
        const cx = sx(b.um);
        if (cx < padL || cx > w - padR) return null;
        return (
          <g key={`${b.label}-${b.um}`} className="spectrum-band">
            <rect
              x={x0}
              y={padT}
              width={Math.max(2, x1 - x0)}
              height={h - padT - padB}
              fill="rgba(56, 189, 248, 0.12)"
              stroke="none"
            />
            <line
              x1={cx}
              x2={cx}
              y1={padT}
              y2={h - padB}
              stroke="rgba(125, 211, 252, 0.85)"
              strokeWidth="1"
              strokeDasharray="3 2"
            />
            <text
              x={cx + 3}
              y={padT + 9}
              className="spectrum-band-label"
              fill="#7dd3fc"
              fontSize="8"
              fontFamily="IBM Plex Sans, sans-serif"
              fontWeight="600"
            >
              {b.label}
            </text>
          </g>
        );
      })}
      {[...byPass.entries()].map(([pass, pts]) => {
        const sorted = [...pts].sort((a, b) => a.x - b.x);
        const d = sorted.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x)},${sy(p.y)}`).join(" ");
        return (
          <path
            key={`line-${pass}`}
            d={d}
            fill="none"
            stroke={passColor(pass)}
            strokeWidth="1.4"
            strokeOpacity="0.55"
          />
        );
      })}
      {points.map((p) => {
        const color = passColor(p.pass);
        const cx = sx(p.x);
        const cy = sy(p.y);
        const err = p.err != null && p.err > 0 ? p.err : null;
        const yLo = err != null ? sy(Math.max(p.y - err, useLog ? p.y * 0.01 : p.y - err)) : cy;
        const yHi = err != null ? sy(p.y + err) : cy;
        const dim =
          highlightDetector != null && p.detector != null && p.detector !== highlightDetector;
        const opacity = dim ? 0.28 : 1;
        return (
          // biome-ignore lint/a11y/useSemanticElements: SVG point hit target
          <g
            key={p.id}
            role="button"
            tabIndex={0}
            style={{ cursor: onPick ? "pointer" : undefined, opacity }}
            onClick={() => onPick?.(p.id)}
            onKeyDown={(e) => {
              if (!onPick) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(p.id);
              }
            }}
          >
            <title>{`Visit ${p.pass} · ${p.y.toFixed(3)} mJy · quality ${p.quality}`}</title>
            {err != null && (
              <line
                x1={cx}
                x2={cx}
                y1={yLo}
                y2={yHi}
                stroke={color}
                strokeWidth="1"
                strokeOpacity="0.7"
              />
            )}
            {p.quality !== "ok" && p.quality !== "flagged" ? (
              <rect
                x={cx - (p.active ? 3.5 : 2.4)}
                y={cy - (p.active ? 3.5 : 2.4)}
                width={p.active ? 7 : 4.8}
                height={p.active ? 7 : 4.8}
                fill="var(--panel)"
                stroke={color}
                strokeWidth={1.4}
              />
            ) : (
              <circle
                cx={cx}
                cy={cy}
                r={p.active ? 4.5 : dim ? 2.2 : 2.8}
                fill={p.flagged ? "var(--panel)" : color}
                stroke={color}
                strokeWidth={p.flagged || p.active ? 1.6 : 0}
              />
            )}
          </g>
        );
      })}
      <text x={padL} y={11} className="strip-label">
        {yLabel}
        {useLog ? " (log)" : ""}
      </text>
      <text x={w - padR} y={h - 6} textAnchor="end" className="strip-label">
        {xLabel}
      </text>
    </svg>
  );
}
