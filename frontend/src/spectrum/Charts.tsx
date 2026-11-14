import type { DecodedFrame } from "../data/decode";

interface ChartsProps {
  frames: DecodedFrame[];
  activeIndex: number;
  onSelectFrame?: (index: number) => void;
}

/** Classroom-friendly wavelength / visit timeline. */
export function Charts({ frames, activeIndex, onSelectFrame }: ChartsProps) {
  if (frames.length === 0) return null;

  const withFlux = frames.filter((f) => f.frame.photometry.flux_mjy != null);
  const spectrumPoints = [...frames].sort((a, b) => a.frame.wavelength_um - b.frame.wavelength_um);
  const lightPoints = [...frames].sort((a, b) => a.frame.time_mjd - b.frame.time_mjd);
  const active = frames[activeIndex];
  const activeWave = active?.frame.wavelength_um;

  return (
    <div className="charts">
      <section className="chart-panel">
        <h3>Infrared color of this frame</h3>
        <p className="chart-empty">
          Each frame is a slightly different infrared “color.” The bright dot is the one you are
          watching
          {activeWave != null ? ` (${activeWave.toFixed(2)} µm)` : ""}. Click any dot to jump there.
          {withFlux.length === 0
            ? " A full brightness spectrum needs clearer photometry (coming with the backend)."
            : ""}
        </p>
        {withFlux.length > 0 && (
          <FluxSvg
            points={spectrumPoints.map((f) => ({
              x: f.frame.wavelength_um,
              y: f.frame.photometry.flux_mjy as number,
              active: f === active,
              flagged: f.frame.photometry.quality === "flagged",
            }))}
            xLabel="µm"
            yLabel="mJy"
          />
        )}
        <DotStrip
          frames={spectrumPoints}
          activeId={active?.frame.id}
          mode="wave"
          onPick={(id) => {
            const idx = frames.findIndex((f) => f.frame.id === id);
            if (idx >= 0) onSelectFrame?.(idx);
          }}
        />
      </section>

      <section className="chart-panel">
        <h3>When SPHEREx looked</h3>
        <p className="chart-empty">
          Clusters of dots are the three visits months apart. Click to jump to that day.
        </p>
        {withFlux.length > 0 && (
          <FluxSvg
            points={lightPoints.map((f) => ({
              x: f.frame.time_mjd,
              y: f.frame.photometry.flux_mjy as number,
              active: f === active,
              flagged: f.frame.photometry.quality === "flagged",
            }))}
            xLabel="MJD"
            yLabel="mJy"
          />
        )}
        <DotStrip
          frames={lightPoints}
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
  const min =
    mode === "wave" ? frames[0]!.frame.wavelength_um : frames[0]!.frame.time_mjd;
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
          <circle
            key={f.frame.id}
            cx={x}
            cy={14}
            r={active ? 4.5 : 2.5}
            fill={active ? "var(--accent)" : "var(--muted)"}
            style={{ cursor: onPick ? "pointer" : undefined }}
            onClick={() => onPick?.(f.frame.id)}
          >
            <title>
              {mode === "wave"
                ? `${f.frame.wavelength_um.toFixed(3)} µm`
                : `Visit ${f.exposure.pass} · ${f.frame.time_iso}`}
            </title>
          </circle>
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

function FluxSvg({
  points,
  xLabel,
  yLabel,
}: {
  points: { x: number; y: number; active: boolean; flagged: boolean }[];
  xLabel: string;
  yLabel: string;
}) {
  const w = 300;
  const h = 120;
  const pad = 28;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (w - 2 * pad);
  const sy = (y: number) => h - pad - ((y - minY) / (maxY - minY || 1)) * (h - 2 * pad);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x)},${sy(p.y)}`).join(" ");

  return (
    <svg className="flux-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Flux chart">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      {points.map((p) => (
        <circle
          key={`${p.x}-${p.y}`}
          cx={sx(p.x)}
          cy={sy(p.y)}
          r={p.active ? 4 : 2.5}
          fill={p.flagged ? "var(--warn)" : "var(--accent)"}
        />
      ))}
      <text x={pad} y={12} className="strip-label">
        {yLabel}
      </text>
      <text x={w - pad} y={h - 6} textAnchor="end" className="strip-label">
        {xLabel}
      </text>
    </svg>
  );
}
