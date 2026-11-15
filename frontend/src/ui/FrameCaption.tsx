import type { DecodedFrame } from "../data/decode";

interface FrameCaptionProps {
  frames: DecodedFrame[];
  frameIndex: number;
  playing: boolean;
  /** When false, skip the catalogue-path tip (no proper motion known). */
  hasCatalogMotion?: boolean;
}

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Classic live readout under the sky: frame, day, visit, infrared color. */
export function FrameCaption({
  frames,
  frameIndex,
  playing,
  hasCatalogMotion = true,
}: FrameCaptionProps) {
  const cur = frames[frameIndex];
  const pass = cur?.exposure.pass ?? null;
  const first = frames[0];
  const last = frames[frames.length - 1];

  if (!cur || !first || !last) return null;

  const spanDays = Math.max(0, Math.round(last.frame.time_mjd - first.frame.time_mjd));

  return (
    <div className="frame-caption" aria-live="polite">
      <p className="frame-caption-pass">
        Visit {pass}
        {playing ? " · playing" : ""}
      </p>
      <p className="frame-caption-now">
        Image {frameIndex + 1} of {frames.length}
        <span className="frame-caption-sep">·</span>
        <strong>{shortDate(cur.frame.time_iso)}</strong>
        <span className="frame-caption-sep">·</span>
        {cur.frame.wavelength_um.toFixed(3)} µm
        <span className="frame-caption-sep">·</span>
        Camera {cur.exposure.detector}
      </p>
      <p className="frame-caption-span">
        Sequence {shortDate(first.frame.time_iso)} → {shortDate(last.frame.time_iso)}
        {spanDays > 0 ? ` (${spanDays} days)` : ""}
        {" · "}
        {hasCatalogMotion
          ? "The bright blob is the star under the cross. Turn Path on to see where it was at each visit."
          : "The bright blob is the star under the cross."}
      </p>
    </div>
  );
}
