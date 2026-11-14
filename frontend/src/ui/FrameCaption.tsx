import type { DecodedFrame } from "../data/decode";

interface FrameCaptionProps {
  frames: DecodedFrame[];
  frameIndex: number;
  playing: boolean;
}

function shortDate(iso: string): string {
  // 2025-08-21T23:34:56Z → 2025-08-21
  return iso.slice(0, 10);
}

/** Live date / pass / wavelength under the player. */
export function FrameCaption({ frames, frameIndex, playing }: FrameCaptionProps) {
  if (frames.length === 0) return null;
  const i = Math.min(frameIndex, frames.length - 1);
  const cur = frames[i]!;
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  const spanDays = Math.max(0, Math.round(last.frame.time_mjd - first.frame.time_mjd));

  return (
    <div className="frame-caption" aria-live="polite">
      <p className="frame-caption-now">
        {playing ? "Playing" : "Frame"} {i + 1}/{frames.length}
        {" · "}
        <strong>{shortDate(cur.frame.time_iso)}</strong>
        {" · pass "}
        {cur.exposure.pass}
        {" · "}
        {cur.frame.wavelength_um.toFixed(3)} µm
      </p>
      <p className="frame-caption-span">
        Sequence: {shortDate(first.frame.time_iso)} → {shortDate(last.frame.time_iso)}
        {spanDays > 0 ? ` (${spanDays} days)` : ""}
        {" · "}
        {frames.length} exposures
      </p>
    </div>
  );
}
