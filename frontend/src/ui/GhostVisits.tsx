import { useEffect, useState } from "react";
import type { ColorMap } from "../data/contract";
import { FrameCanvas } from "../viewer/FrameCanvas";
import type { TrailPoint } from "../viewer/overlays";

export interface GhostLayer {
  pixels: Float32Array;
  mask: Uint8Array;
  label: string;
}

interface GhostVisitsProps {
  size: number;
  lo: number;
  hi: number;
  colorMap: ColorMap;
  displayPx: number;
  early: GhostLayer;
  late: GhostLayer;
  trail: TrailPoint[];
}

/**
 * Onion-skin two visit stacks: late layer breathes on top of early.
 * Motion becomes a shimmer you feel, not a blink you time.
 */
export function GhostVisits({
  size,
  lo,
  hi,
  colorMap,
  displayPx,
  early,
  late,
  trail,
}: GhostVisitsProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setPhase((p) => (p + 1) % 200), 40);
    return () => window.clearInterval(id);
  }, []);

  // 0.35 … 0.85 opacity pulse
  const t = (Math.sin((phase / 200) * Math.PI * 2) + 1) / 2;
  const lateOpacity = 0.35 + t * 0.5;

  return (
    <div className="ghost-visits" style={{ width: displayPx, height: displayPx }}>
      <div className="ghost-layer ghost-early">
        <FrameCanvas
          pixels={early.pixels}
          mask={early.mask}
          size={size}
          lo={lo}
          hi={hi}
          background={0}
          colorMap={colorMap}
          trail={trail}
          displayPx={displayPx}
        />
      </div>
      <div className="ghost-layer ghost-late" style={{ opacity: lateOpacity }}>
        <FrameCanvas
          pixels={late.pixels}
          mask={late.mask}
          size={size}
          lo={lo}
          hi={hi}
          background={0}
          colorMap={colorMap}
          displayPx={displayPx}
        />
      </div>
      <div className="ghost-caption">
        <span>{early.label}</span>
        <span className="ghost-caption-mid">both visits blended</span>
        <span>{late.label}</span>
      </div>
    </div>
  );
}
