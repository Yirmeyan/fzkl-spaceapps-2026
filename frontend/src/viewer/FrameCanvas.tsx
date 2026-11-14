import { useEffect, useRef } from "react";
import { renderFrameToRgba } from "../data/contract";

export interface FrameCanvasProps {
  pixels: Float32Array;
  mask: Uint8Array;
  size: number;
  lo: number;
  hi: number;
  background: number | null;
  /** Optional marker at target position [x, y] in grid pixels */
  targetXy?: [number, number] | null;
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
  targetXy,
  className,
  scale = 4,
}: FrameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size <= 0 || pixels.length !== size * size) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rgba = renderFrameToRgba(pixels, mask, size, lo, hi, background);
    const imageData = ctx.createImageData(size, size);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    if (targetXy) {
      const [tx, ty] = targetXy;
      ctx.save();
      ctx.strokeStyle = "rgba(255, 176, 64, 0.95)";
      ctx.lineWidth = 1;
      const r = 4;
      ctx.beginPath();
      ctx.moveTo(tx - r, ty);
      ctx.lineTo(tx + r, ty);
      ctx.moveTo(tx, ty - r);
      ctx.lineTo(tx, ty + r);
      ctx.stroke();
      ctx.restore();
    }
  }, [pixels, mask, size, lo, hi, background, targetXy]);

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
