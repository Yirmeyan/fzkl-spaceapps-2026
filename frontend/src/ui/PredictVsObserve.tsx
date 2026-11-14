import { useId } from "react";
import { type Grid, mjdToDate, skyToPixel, type Target, targetAt } from "../data/contract";
import type { DecodedFrame } from "../data/decode";

interface PredictVsObserveProps {
  target: Target;
  grid: Grid;
  frames: DecodedFrame[];
}

interface PassMean {
  pass: number;
  x: number;
  y: number;
  mjd: number;
}

function passMeans(frames: DecodedFrame[]): PassMean[] {
  const map = new Map<number, { sx: number; sy: number; sm: number; n: number }>();
  for (const f of frames) {
    const p = f.exposure.pass;
    const cur = map.get(p) ?? { sx: 0, sy: 0, sm: 0, n: 0 };
    cur.sx += f.frame.target_xy[0];
    cur.sy += f.frame.target_xy[1];
    cur.sm += f.frame.time_mjd;
    cur.n += 1;
    map.set(p, cur);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pass, v]) => ({
      pass,
      x: v.sx / v.n,
      y: v.sy / v.n,
      mjd: v.sm / v.n,
    }));
}

function pixelDeltaToSkyArcsec(
  grid: Grid,
  dx: number,
  dy: number,
): { east: number; north: number; total: number } {
  const arcsecPerPx = (grid.fov_deg / grid.size) * 3600;
  const east = -dx * arcsecPerPx;
  const north = -dy * arcsecPerPx;
  return { east, north, total: Math.hypot(east, north) };
}

/** Catalogue prediction vs measured trail — jury-ready “does the sky agree?” ribbon. */
export function PredictVsObserve({ target, grid, frames }: PredictVsObserveProps) {
  const gid = useId();
  if (target.pm_ra == null || target.pm_dec == null) return null;

  const means = passMeans(frames);
  if (means.length < 2) return null;

  const first = means[0]!;
  const last = means[means.length - 1]!;
  const years = (last.mjd - first.mjd) / 365.25;
  if (!(years > 0)) return null;

  const observed = pixelDeltaToSkyArcsec(grid, last.x - first.x, last.y - first.y);

  const [ra0, dec0] = targetAt(target, first.mjd);
  const [ra1, dec1] = targetAt(target, last.mjd);
  const [px0, py0] = skyToPixel(grid, ra0, dec0);
  const [px1, py1] = skyToPixel(grid, ra1, dec1);
  const predicted = pixelDeltaToSkyArcsec(grid, px1 - px0, py1 - py0);

  const maxSpan = Math.max(observed.total, predicted.total, 0.05);
  const obsPct = Math.min(100, (observed.total / maxSpan) * 100);
  const predPct = Math.min(100, (predicted.total / maxSpan) * 100);

  // Cosine similarity of sky vectors (east, north)
  const dot = observed.east * predicted.east + observed.north * predicted.north;
  const denom = observed.total * predicted.total;
  const agreement = denom > 0 ? Math.max(0, Math.min(1, dot / denom)) : 0;
  const matchPct = Math.round(agreement * 100);

  const t0 = mjdToDate(first.mjd);
  const t1 = mjdToDate(last.mjd);
  const spanLabel = `${t0.toLocaleDateString("en-US", { month: "short", year: "numeric" })} → ${t1.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;

  const verdict =
    matchPct >= 75
      ? "Catalogue path and the images agree — this is real sky motion."
      : matchPct >= 40
        ? "Same general direction — SPHEREx is catching the mover."
        : "Directions diverge a bit — still useful; check visit timing and saturation.";

  return (
    <aside className="predict-observe" aria-labelledby={`${gid}-title`}>
      <div className="predict-observe-head">
        <div>
          <p className="predict-observe-kicker">Predict vs observe</p>
          <h3 id={`${gid}-title`} className="predict-observe-title">
            Does the catalogue match what SPHEREx saw?
          </h3>
        </div>
        <p
          className={`predict-observe-score ${matchPct >= 75 ? "good" : matchPct >= 40 ? "ok" : "soft"}`}
          title="How well the predicted and measured motion directions align"
        >
          {matchPct}%<span>match</span>
        </p>
      </div>

      <p className="predict-observe-span">
        Visit {first.pass} → {last.pass} · {spanLabel} · {years.toFixed(2)} yr
      </p>

      <div
        className="predict-ribbon"
        role="img"
        aria-label="Predicted versus observed displacement"
      >
        <div className="predict-ribbon-row">
          <span className="predict-ribbon-label">Predicted</span>
          <div className="predict-ribbon-track">
            <div className="predict-ribbon-fill pred" style={{ width: `${predPct}%` }} />
          </div>
          <span className="predict-ribbon-val">{predicted.total.toFixed(1)}″</span>
        </div>
        <div className="predict-ribbon-row">
          <span className="predict-ribbon-label">Observed</span>
          <div className="predict-ribbon-track">
            <div className="predict-ribbon-fill obs" style={{ width: `${obsPct}%` }} />
          </div>
          <span className="predict-ribbon-val">{observed.total.toFixed(1)}″</span>
        </div>
      </div>

      <p className="predict-observe-verdict">{verdict}</p>
    </aside>
  );
}
