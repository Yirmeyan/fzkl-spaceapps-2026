import type { Grid } from "../data/contract";
import type { TrailPoint } from "../viewer/overlays";
import { MotionFingerprint } from "./MotionFingerprint";

interface MotionInsightProps {
  grid: Grid;
  trail: TrailPoint[];
  targetName: string;
  /** False when catalogue pm_ra/pm_dec are both 0 or absent. */
  hasCatalogMotion: boolean;
}

/**
 * Honest summary: trail beads/cross are catalogue proper motion on the grid.
 * The proof to trust is the bright core moving in the pixels.
 */
export function MotionInsight({ grid, trail, targetName, hasCatalogMotion }: MotionInsightProps) {
  if (!hasCatalogMotion) {
    return (
      <div className="motion-insight">
        <header className="motion-insight-head">
          <p className="motion-insight-kicker">What moved</p>
          <h3 className="motion-insight-title">No catalog motion for this place</h3>
          <p className="motion-insight-body">
            SPHEREx has no known proper motion here, so we do not draw a predicted path. Use Blink
            and Difference to catch anything that moves or changes in the pixels themselves.
          </p>
        </header>
      </div>
    );
  }

  if (trail.length < 2) return null;

  const first = trail[0]!;
  const last = trail[trail.length - 1]!;
  const arcsecPerPx = (grid.fov_deg / grid.size) * 3600;
  const hop = Math.hypot(last.x - first.x, last.y - first.y) * arcsecPerPx;

  return (
    <div className="motion-insight">
      <header className="motion-insight-head">
        <p className="motion-insight-kicker">What moved</p>
        <h3 className="motion-insight-title">
          About {hop.toFixed(1)}″ between Visit {first.pass} and Visit {last.pass}
        </h3>
        <p className="motion-insight-body">
          The bright core in the image is the real SPHEREx data. The orange cross and numbered path
          are the catalogue proper-motion track drawn on top: a guide, not a second independent
          measurement. Watch {targetName} hop; background stars stay put.
        </p>
      </header>
      <MotionFingerprint grid={grid} trail={trail} targetName={targetName} />
    </div>
  );
}
