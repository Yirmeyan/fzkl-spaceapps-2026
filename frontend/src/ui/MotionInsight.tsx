import type { Grid, Target } from "../data/contract";
import type { DecodedFrame } from "../data/decode";
import type { TrailPoint } from "../viewer/overlays";
import { MotionFingerprint } from "./MotionFingerprint";
import { PredictVsObserve } from "./PredictVsObserve";

interface MotionInsightProps {
  target: Target;
  grid: Grid;
  frames: DecodedFrame[];
  trail: TrailPoint[];
  targetName: string;
}

/**
 * One presentation block: path + catalogue check — not three stacked essays.
 */
export function MotionInsight({ target, grid, frames, trail, targetName }: MotionInsightProps) {
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
          Background stars barely move; {targetName} does. That hop is real motion through space.
        </p>
      </header>
      <MotionFingerprint grid={grid} trail={trail} targetName={targetName} />
      <PredictVsObserve target={target} grid={grid} frames={frames} />
    </div>
  );
}
