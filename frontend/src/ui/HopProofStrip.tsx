import type { ColorMap } from "../data/contract";
import { FrameCanvas } from "../viewer/FrameCanvas";
import type { TrailPoint } from "../viewer/overlays";

export type HopProofPick = "early" | "diff" | "late";

interface Cell {
  pixels: Float32Array;
  mask: Uint8Array;
  label: string;
  sub: string;
}

interface HopProofStripProps {
  size: number;
  lo: number;
  hi: number;
  colorMap: ColorMap;
  early: Cell;
  diff: Cell;
  late: Cell;
  trail: TrailPoint[];
  earlyXy: [number, number] | null;
  lateXy: [number, number] | null;
  active: HopProofPick | null;
  onPick: (pick: HopProofPick) => void;
}

/**
 * One-glance proof under the square: early visit → difference → late visit.
 * Judges and newcomers see the hop without hunting mode tabs.
 */
export function HopProofStrip({
  size,
  lo,
  hi,
  colorMap,
  early,
  diff,
  late,
  trail,
  earlyXy,
  lateXy,
  active,
  onPick,
}: HopProofStripProps) {
  const cellPx = 72;
  const cells: { id: HopProofPick; cell: Cell; xy: [number, number] | null; showTrail: boolean }[] =
    [
      { id: "early", cell: early, xy: earlyXy, showTrail: true },
      { id: "diff", cell: diff, xy: null, showTrail: false },
      { id: "late", cell: late, xy: lateXy, showTrail: true },
    ];

  return (
    <section className="hop-proof" aria-label="Proof that the star moved">
      <p className="hop-proof-kicker">Hop</p>
      <div className="hop-proof-strip">
        {cells.map(({ id, cell, xy, showTrail }, i) => (
          <div key={id} className="hop-proof-step">
            {i > 0 && <span className="hop-proof-arrow" aria-hidden="true" />}
            <button
              type="button"
              className={`hop-proof-cell${active === id ? " active" : ""}`}
              onClick={() => onPick(id)}
              aria-current={active === id ? "true" : undefined}
              title={cell.sub}
            >
              <FrameCanvas
                pixels={cell.pixels}
                mask={cell.mask}
                size={size}
                lo={lo}
                hi={hi}
                background={0}
                colorMap={colorMap}
                targetXy={xy}
                trail={showTrail ? trail : []}
                displayPx={cellPx}
              />
              <span className="hop-proof-label">{cell.label}</span>
            </button>
          </div>
        ))}
      </div>
      <p className="hop-proof-hint">Tap to jump</p>
    </section>
  );
}
