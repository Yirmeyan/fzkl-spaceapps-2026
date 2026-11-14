import type { Grid, Target } from "../data/contract";
import type { TrailPoint } from "../viewer/overlays";

interface MotionStoryProps {
  target: Target;
  grid: Grid;
  trail: TrailPoint[];
}

/** Plain-language motion readout judges can quote. */
export function MotionStory({ target, grid, trail }: MotionStoryProps) {
  if (trail.length < 2) return null;

  const first = trail[0]!;
  const last = trail[trail.length - 1]!;
  const arcsecPerPx = (grid.fov_deg / grid.size) * 3600;
  const dx = (last.x - first.x) * arcsecPerPx;
  const dy = (last.y - first.y) * arcsecPerPx;
  // Image y increases south-ish in our north-up grid (skyToPixel: north → smaller y).
  const northArcsec = -dy;
  const eastArcsec = -dx;
  const total = Math.hypot(eastArcsec, northArcsec);

  const pm =
    target.pm_ra != null && target.pm_dec != null
      ? Math.hypot(target.pm_ra, target.pm_dec) / 1000
      : null;

  const direction =
    Math.abs(northArcsec) >= Math.abs(eastArcsec)
      ? northArcsec >= 0
        ? "north"
        : "south"
      : eastArcsec >= 0
        ? "east"
        : "west";

  return (
    <aside className="motion-story" aria-live="polite">
      <p className="motion-story-kicker">What changed between visits</p>
      <p className="motion-story-headline">
        About <strong>{total.toFixed(1)}″</strong> across the sky — mostly{" "}
        <strong>{direction}</strong>
      </p>
      <p className="motion-story-body">
        That is the catalogue path from Visit {first.pass} → Visit {last.pass} on this cutout (~
        {arcsecPerPx.toFixed(1)}″ per pixel). Background stars barely move; the target does.
        {pm != null ? ` Catalogue proper motion ≈ ${pm.toFixed(1)}″ per year.` : null}
      </p>
      <p className="motion-story-punch">
        If you only remember one thing: <em>something in this field is not fixed on the sky.</em>
      </p>
    </aside>
  );
}
