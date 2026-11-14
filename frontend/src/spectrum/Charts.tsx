import type { DecodedFrame } from "../data/decode";

interface ChartsProps {
  frames: DecodedFrame[];
  activeIndex: number;
}

/** Simple SVG spectrum (wavelength vs flux) and light curve (time vs flux). */
export function Charts({ frames, activeIndex }: ChartsProps) {
  if (frames.length === 0) return null;

  const withFlux = frames.filter((f) => f.frame.photometry.flux_mjy != null);
  const spectrumPoints = [...frames].sort((a, b) => a.frame.wavelength_um - b.frame.wavelength_um);
  const lightPoints = [...frames].sort((a, b) => a.frame.time_mjd - b.frame.time_mjd);

  return (
    <div className="charts">
      <section className="chart-panel">
        <h3>Spectrum</h3>
        {withFlux.length === 0 ? (
          <p className="chart-empty">
            No flux yet — this target saturates on detector 2. Wavelengths still mark each frame (
            {frames[0]!.frame.wavelength_um.toFixed(3)}–
            {frames[frames.length - 1]!.frame.wavelength_um.toFixed(3)} µm). Photometry arrives with
            backend step B4.
          </p>
        ) : (
          <FluxSvg
            points={spectrumPoints.map((f) => ({
              x: f.frame.wavelength_um,
              y: f.frame.photometry.flux_mjy as number,
              active: f === frames[activeIndex],
              flagged: f.frame.photometry.quality === "flagged",
            }))}
            xLabel="µm"
            yLabel="mJy"
          />
        )}
        <WavelengthStrip frames={spectrumPoints} activeId={frames[activeIndex]?.frame.id} />
      </section>

      <section className="chart-panel">
        <h3>Light curve</h3>
        {withFlux.length === 0 ? (
          <p className="chart-empty">
            Same story as the spectrum: saturated in the sample. Pass markers show when SPHEREx
            revisited the field.
          </p>
        ) : (
          <FluxSvg
            points={lightPoints.map((f) => ({
              x: f.frame.time_mjd,
              y: f.frame.photometry.flux_mjy as number,
              active: f === frames[activeIndex],
              flagged: f.frame.photometry.quality === "flagged",
            }))}
            xLabel="MJD"
            yLabel="mJy"
          />
        )}
        <PassTimeline frames={lightPoints} activeId={frames[activeIndex]?.frame.id} />
      </section>
    </div>
  );
}

function WavelengthStrip({ frames, activeId }: { frames: DecodedFrame[]; activeId?: string }) {
  const min = frames[0]?.frame.wavelength_um ?? 0;
  const max = frames[frames.length - 1]?.frame.wavelength_um ?? 1;
  const span = max - min || 1;
  return (
    <svg className="strip" viewBox="0 0 300 28" role="img" aria-label="Wavelength timeline">
      <line x1="8" y1="14" x2="292" y2="14" stroke="currentColor" strokeOpacity="0.35" />
      {frames.map((f) => {
        const x = 8 + ((f.frame.wavelength_um - min) / span) * 284;
        const active = f.frame.id === activeId;
        return (
          <circle
            key={f.frame.id}
            cx={x}
            cy={14}
            r={active ? 4 : 2.5}
            fill={active ? "var(--accent)" : "var(--ink-muted)"}
          />
        );
      })}
      <text x="8" y="26" className="strip-label">
        {min.toFixed(2)} µm
      </text>
      <text x="292" y="26" textAnchor="end" className="strip-label">
        {max.toFixed(2)} µm
      </text>
    </svg>
  );
}

function PassTimeline({ frames, activeId }: { frames: DecodedFrame[]; activeId?: string }) {
  if (frames.length === 0) return null;
  const min = frames[0]!.frame.time_mjd;
  const max = frames[frames.length - 1]!.frame.time_mjd;
  const span = max - min || 1;
  return (
    <svg className="strip" viewBox="0 0 300 28" role="img" aria-label="Time timeline">
      <line x1="8" y1="14" x2="292" y2="14" stroke="currentColor" strokeOpacity="0.35" />
      {frames.map((f) => {
        const x = 8 + ((f.frame.time_mjd - min) / span) * 284;
        const active = f.frame.id === activeId;
        return (
          <circle
            key={f.frame.id}
            cx={x}
            cy={14}
            r={active ? 4 : 2.5}
            fill={active ? "var(--accent)" : "var(--ink-muted)"}
          />
        );
      })}
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
