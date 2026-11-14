import { useEffect, useRef } from "react";
import { type ColorMap, renderFrameToRgba } from "../data/contract";
import type { DecodedFrame } from "../data/decode";

export interface SkyPlayerProps {
  frames: DecodedFrame[];
  frameIndex: number;
  playing: boolean;
  fps: number;
  lo: number;
  hi: number;
  size: number;
  colorMap?: ColorMap;
  scale?: number;
  className?: string;
  onFrameIndexChange?: (index: number) => void;
}

/**
 * Static when paused: one blit, then the canvas is left alone (no rAF).
 * Playback uses setInterval only — never requestAnimationFrame at display Hz,
 * which was driving GPU coil-whine on some machines.
 */
export function SkyPlayer({
  frames,
  frameIndex,
  playing,
  fps,
  lo,
  hi,
  size,
  colorMap = "heat",
  scale = 4,
  className,
  onFrameIndexChange,
}: SkyPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const cacheRef = useRef<(ImageData | null)[]>([]);
  const indexRef = useRef(frameIndex);
  const cacheKeyRef = useRef("");
  const onChangeRef = useRef(onFrameIndexChange);
  onChangeRef.current = onFrameIndexChange;

  const cacheKey = `${size}|${lo}|${hi}|${colorMap}|${frames.length}|${frames[0]?.frame.id ?? ""}|${frames[frames.length - 1]?.frame.id ?? ""}`;

  function ensureCtx(): CanvasRenderingContext2D | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
      });
    }
    return ctxRef.current;
  }

  function ensureCache() {
    if (cacheKeyRef.current === cacheKey && cacheRef.current.length === frames.length) {
      return;
    }
    cacheKeyRef.current = cacheKey;
    cacheRef.current = frames.map((f) => {
      const rgba = renderFrameToRgba(f.pixels, f.mask, size, lo, hi, f.frame.background, colorMap);
      const copy = new Uint8ClampedArray(rgba.length);
      copy.set(rgba);
      return new ImageData(copy, size, size);
    });
  }

  function blit(index: number) {
    const ctx = ensureCtx();
    if (!ctx || size <= 0) return;
    ensureCache();
    const image = cacheRef.current[index];
    if (!image) return;
    ctx.putImageData(image, 0, 0);

    const f = frames[index];
    if (!f) return;
    const [tx, ty] = f.frame.target_xy;
    ctx.strokeStyle = "rgba(255, 176, 64, 0.95)";
    ctx.lineWidth = 1;
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(tx - r, ty);
    ctx.lineTo(tx + r, ty);
    ctx.moveTo(tx, ty - r);
    ctx.lineTo(tx, ty + r);
    ctx.stroke();
  }

  // Still frame: one blit, then stop. Never leave a timer running while paused.
  useEffect(() => {
    if (playing) return;
    indexRef.current = frameIndex;
    blit(frameIndex);
    onChangeRef.current?.(frameIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, frameIndex, cacheKey]);

  // Playback: setInterval only (no rAF). Do not notify React every tick —
  // that re-rendered the whole page and kept the GPU busy.
  useEffect(() => {
    if (!playing || frames.length < 2) return;

    const id = window.setInterval(() => {
      const next = (indexRef.current + 1) % frames.length;
      indexRef.current = next;
      blit(next);
    }, 1000 / Math.max(1, fps));

    return () => {
      window.clearInterval(id);
      onChangeRef.current?.(indexRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, fps, frames.length, cacheKey]);

  const css = size * scale;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size}
      height={size}
      style={{
        width: css,
        height: css,
        imageRendering: "pixelated",
        background: "#05080e",
      }}
      aria-label="SPHEREx image frame"
    />
  );
}
