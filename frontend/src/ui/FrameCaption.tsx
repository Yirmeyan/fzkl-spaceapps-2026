import { useEffect, useRef, useState } from "react";
import type { DecodedFrame } from "../data/decode";

interface FrameCaptionProps {
  frames: DecodedFrame[];
  frameIndex: number;
  playing: boolean;
}

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Live date / pass / wavelength under the player. */
export function FrameCaption({ frames, frameIndex, playing }: FrameCaptionProps) {
  const [passFlash, setPassFlash] = useState(false);
  const prevPass = useRef<number | null>(null);

  const i = frames.length === 0 ? 0 : Math.min(frameIndex, frames.length - 1);
  const cur = frames[i];
  const pass = cur?.exposure.pass ?? null;

  useEffect(() => {
    if (pass == null) return;
    if (prevPass.current != null && prevPass.current !== pass) {
      setPassFlash(true);
      const t = window.setTimeout(() => setPassFlash(false), 900);
      prevPass.current = pass;
      return () => window.clearTimeout(t);
    }
    prevPass.current = pass;
  }, [pass]);

  if (!cur || frames.length === 0) return null;

  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  const spanDays = Math.max(0, Math.round(last.frame.time_mjd - first.frame.time_mjd));

  return (
    <div className="frame-caption" aria-live="polite">
      <p className={`frame-caption-pass${passFlash ? " flash" : ""}`}>
        PASS {pass}
        {passFlash ? " ← changed" : ""}
      </p>
      <p className="frame-caption-now">
        {playing ? "Playing" : "Frame"} {i + 1}/{frames.length}
        {" · "}
        <strong>{shortDate(cur.frame.time_iso)}</strong>
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
