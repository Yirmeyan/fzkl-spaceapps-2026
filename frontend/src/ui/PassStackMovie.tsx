import { useEffect, useState } from "react";
import type { ColorMap } from "../data/contract";
import { FrameCanvas } from "../viewer/FrameCanvas";

export interface PassStackFrame {
  pass: number;
  pixels: Float32Array;
  mask: Uint8Array;
  label: string;
}

interface PassStackMovieProps {
  stacks: PassStackFrame[];
  diff: PassStackFrame | null;
  size: number;
  lo: number;
  hi: number;
  colorMap: ColorMap;
  displayPx: number;
  targetXy: [number, number] | null;
  faintHint?: string;
}

/** Cycles clean per-pass mean stacks, then the last-minus-first difference. */
export function PassStackMovie({
  stacks,
  diff,
  size,
  lo,
  hi,
  colorMap,
  displayPx,
  targetXy,
  faintHint,
}: PassStackMovieProps) {
  const frames = diff ? [...stacks, diff] : stacks;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (frames.length < 2) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, 1100);
    return () => window.clearInterval(id);
  }, [frames.length]);

  if (frames.length === 0) return null;
  const active = frames[Math.min(index, frames.length - 1)]!;

  return (
    <div className="pass-stack-movie">
      <FrameCanvas
        pixels={active.pixels}
        mask={active.mask}
        size={size}
        lo={lo}
        hi={hi}
        background={0}
        colorMap={colorMap}
        displayPx={displayPx}
        targetXy={targetXy}
      />
      <p className="pass-stack-caption" aria-live="polite">
        {active.label}
      </p>
      <div className="pass-stack-dots" role="tablist" aria-label="Pass stacks">
        {frames.map((f, i) => (
          <button
            key={`${f.pass}-${f.label}`}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={i === index ? "active" : ""}
            onClick={() => setIndex(i)}
            title={f.label}
          />
        ))}
      </div>
      {faintHint && <p className="pass-stack-hint">{faintHint}</p>}
    </div>
  );
}
