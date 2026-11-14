import { useEffect, useRef, useState } from "react";
import type { DecodedFrame } from "../data/decode";

interface FrameCaptionProps {
  frames: DecodedFrame[];
  frameIndex: number;
  playing: boolean;
}

/** Friendly live readout under the sky stage. */
export function FrameCaption({ frames, frameIndex, playing }: FrameCaptionProps) {
  const [passFlash, setPassFlash] = useState(false);
  const prevPass = useRef<number | null>(null);
  const cur = frames[frameIndex];
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

  if (!cur) return null;

  const date = new Date(cur.frame.time_iso);
  const dateLabel = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="frame-caption">
      <p className={`frame-caption-pass${passFlash ? " flash" : ""}`}>
        Visit {pass}
        {passFlash ? " · just changed" : ""}
        {playing ? " · playing" : ""}
      </p>
      <p className="frame-caption-now">
        {dateLabel}
        <span className="frame-caption-sep">·</span>
        Infrared color {cur.frame.wavelength_um.toFixed(2)} µm
      </p>
      <p className="frame-caption-span">
        Frame {frameIndex + 1} of {frames.length}. Bright blob = the star (often too bright for the
        camera). Numbered dots = where it was on each visit.
      </p>
    </div>
  );
}
