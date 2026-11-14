import { useEffect, useRef } from "react";
import { type ColorMap, renderFrameToRgba } from "../data/contract";
import { drawTargetOverlay, type TrailPoint } from "./overlays";

export interface FrameCanvasProps {
  pixels: Float32Array;
  mask: Uint8Array;
  size: number;
  lo: number;
  hi: number;
  background: number | null;
  colorMap?: ColorMap;
  /** Tint pixels whose mask byte is not 0 (Tommy item 6). */
  tintMask?: boolean;
  targetXy?: [number, number] | null;
  trail?: TrailPoint[];
  className?: string;
  displayPx?: number;
}

export function FrameCanvas({
  pixels,
  mask,
  size,
  lo,
  hi,
  background,
  colorMap = "heat",
  tintMask = false,
  targetXy,
  trail = [],
  className,
  displayPx,
}: FrameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const css = displayPx ?? size * 4;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size <= 0 || pixels.length !== size * size) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    ctx.fillStyle = "#05080e";
    ctx.fillRect(0, 0, size, size);
    const rgba = renderFrameToRgba(pixels, mask, size, lo, hi, background, colorMap, tintMask);
    const imageData = ctx.createImageData(size, size);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    if (targetXy) {
      drawTargetOverlay(ctx, targetXy, trail);
    }
  }, [pixels, mask, size, lo, hi, background, colorMap, tintMask, targetXy, trail]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size}
      height={size}
      style={{ width: css, height: css, maxWidth: "100%", imageRendering: "pixelated" }}
      aria-label="SPHEREx image frame"
    />
  );
}
