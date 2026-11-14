import { useId } from "react";
import type { Grid } from "../data/contract";
import type { TrailPoint } from "../viewer/overlays";

interface MotionFingerprintProps {
  grid: Grid;
  trail: TrailPoint[];
  targetName: string;
}

/**
 * Shareable silhouette of the visit trail — the star’s “fingerprint” on the sky.
 */
export function MotionFingerprint({ grid, trail, targetName }: MotionFingerprintProps) {
  const gid = useId();
  if (trail.length < 2) return null;

  const pad = 18;
  const w = 320;
  const h = 140;
  const xs = trail.map((p) => p.x);
  const ys = trail.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-3);
  const spanY = Math.max(maxY - minY, 1e-3);
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);

  const pts = trail.map((p) => ({
    x: pad + (p.x - minX) * scale + (w - pad * 2 - spanX * scale) / 2,
    y: pad + (p.y - minY) * scale + (h - pad * 2 - spanY * scale) / 2,
    pass: p.pass,
  }));

  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const first = trail[0]!;
  const last = trail[trail.length - 1]!;
  const arcsecPerPx = (grid.fov_deg / grid.size) * 3600;
  const hop = Math.hypot(last.x - first.x, last.y - first.y) * arcsecPerPx;

  return (
    <aside className="motion-fingerprint" aria-labelledby={`${gid}-title`}>
      <div className="motion-fingerprint-copy">
        <p className="motion-fingerprint-kicker">Motion fingerprint</p>
        <h3 id={`${gid}-title`} className="motion-fingerprint-title">
          {targetName}’s path across visits
        </h3>
        <p className="motion-fingerprint-stat">
          <strong>{hop.toFixed(1)}″</strong> from Visit {first.pass} → {last.pass}
        </p>
        <p className="motion-fingerprint-hint">
          Screenshot this — it is the whole story in one curve.
        </p>
      </div>
      <svg
        className="motion-fingerprint-svg"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Trail of ${targetName} across SPHEREx visits`}
      >
        <defs>
          <linearGradient id={`${gid}-stroke`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#fb7185" />
          </linearGradient>
        </defs>
        <path
          d={d}
          fill="none"
          stroke={`url(#${gid}-stroke)`}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="motion-fingerprint-path"
        />
        {pts.map((p) => (
          <g key={p.pass}>
            <circle cx={p.x} cy={p.y} r="5.5" fill="#0a1018" stroke="#fff" strokeWidth="1.2" />
            <text x={p.x + 8} y={p.y + 4} className="motion-fingerprint-label">
              {p.pass}
            </text>
          </g>
        ))}
      </svg>
    </aside>
  );
}
