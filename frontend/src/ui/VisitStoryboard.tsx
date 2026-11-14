import type { ColorMap } from "../data/contract";
import { FrameCanvas } from "../viewer/FrameCanvas";
import type { TrailPoint } from "../viewer/overlays";

export interface StoryboardCell {
  pass: number;
  pixels: Float32Array;
  mask: Uint8Array;
  label: string;
  dateLabel: string;
}

interface VisitStoryboardProps {
  size: number;
  lo: number;
  hi: number;
  colorMap: ColorMap;
  cells: StoryboardCell[];
  trail: TrailPoint[];
  activePass: number | null;
  onPickPass: (pass: number) => void;
}

/**
 * Filmstrip of visit stacks. one glance across months of SPHEREx revisits.
 */
export function VisitStoryboard({
  size,
  lo,
  hi,
  colorMap,
  cells,
  trail,
  activePass,
  onPickPass,
}: VisitStoryboardProps) {
  if (cells.length < 2) return null;
  const cellPx = Math.min(148, Math.floor(920 / cells.length));

  return (
    <section className="visit-storyboard" aria-label="Visit storyboard across SPHEREx passes">
      <div className="visit-storyboard-head">
        <p className="visit-storyboard-kicker">Visit storyboard</p>
        <h3 className="visit-storyboard-title">Months of sky in one strip</h3>
      </div>
      <div className="visit-storyboard-strip">
        {cells.map((cell) => {
          const bead = trail.find((t) => t.pass === cell.pass);
          const active = activePass === cell.pass;
          return (
            <button
              key={cell.pass}
              type="button"
              className={`visit-storyboard-cell${active ? " active" : ""}`}
              onClick={() => onPickPass(cell.pass)}
              aria-current={active ? "true" : undefined}
              aria-label={`${cell.label}, ${cell.dateLabel}`}
            >
              <FrameCanvas
                pixels={cell.pixels}
                mask={cell.mask}
                size={size}
                lo={lo}
                hi={hi}
                background={0}
                colorMap={colorMap}
                targetXy={bead ? [bead.x, bead.y] : null}
                trail={trail}
                displayPx={cellPx}
              />
              <span className="visit-storyboard-pass">Visit {cell.pass}</span>
              <span className="visit-storyboard-date">{cell.dateLabel}</span>
            </button>
          );
        })}
      </div>
      <p className="visit-storyboard-hint">
        Tap a visit to jump there. Watch the orange cross walk.
      </p>
    </section>
  );
}
