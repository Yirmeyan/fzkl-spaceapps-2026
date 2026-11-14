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
  /** Optional marker at target position [x, y] in grid pixels */
  targetXy?: [number, number] | null;
  trail?: TrailPoint[];
  className?: string;
  /** Display scale (CSS pixels per image pixel). Default 4 → 512px for 128. */
  scale?: number;
}

export function FrameCanvas({
  pixels,
  mask,
  size,
  lo,
  hi,
  background,
  colorMap = "heat",
  targetXy,
  trail = [],
  className,
  scale = 4,
}: FrameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size <= 0 || pixels.length !== size * size) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    ctx.fillStyle = "#05080e";
    ctx.fillRect(0, 0, size, size);
    const rgba = renderFrameToRgba(pixels, mask, size, lo, hi, background, colorMap);
    const imageData = ctx.createImageData(size, size);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    if (targetXy) {
      drawTargetOverlay(ctx, targetXy, trail);
    }
  }, [pixels, mask, size, lo, hi, background, colorMap, targetXy, trail]);

  const css = size * scale;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size}
      height={size}
      style={{ width: css, height: css, imageRendering: "pixelated" }}
      aria-label="SPHEREx image frame"
    />
  );
}
