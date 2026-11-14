import { useEffect, useRef } from "react";
import { renderFrameToRgba } from "../data/contract";
import type { DecodedFrame } from "../data/decode";

export interface SkyPlayerProps {
  frames: DecodedFrame[];
  frameIndex: number;
  playing: boolean;
  fps: number;
  lo: number;
  hi: number;
  size: number;
  scale?: number;
  className?: string;
  /** Called when the visible frame changes. Throttled while playing. */
  onFrameIndexChange?: (index: number) => void;
}

/**
 * Prefers ImageBitmap blits and keeps playback off the React render path
 * so the rest of the page does not repaint 8×/s (that was the screen shimmer).
 */
export function SkyPlayer({
  frames,
  frameIndex,
  playing,
  fps,
  lo,
  hi,
  size,
  scale = 4,
  className,
  onFrameIndexChange,
}: SkyPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapsRef = useRef<(ImageBitmap | null)[]>([]);
  const indexRef = useRef(frameIndex);
  const playingRef = useRef(playing);
  const fpsRef = useRef(fps);
  const onChangeRef = useRef(onFrameIndexChange);
  const lastNotifyRef = useRef(0);

  indexRef.current = frameIndex;
  playingRef.current = playing;
  fpsRef.current = fps;
  onChangeRef.current = onFrameIndexChange;

  // Build ImageBitmaps once per frame set / stretch limits.
  useEffect(() => {
    let cancelled = false;
    const bitmaps: (ImageBitmap | null)[] = frames.map(() => null);
    bitmapsRef.current = bitmaps;

    async function build() {
      for (let i = 0; i < frames.length; i++) {
        if (cancelled) return;
        const f = frames[i]!;
        const rgba = renderFrameToRgba(f.pixels, f.mask, size, lo, hi, f.frame.background);
        // Copy into a plain ArrayBuffer-backed view for createImageBitmap.
        const copy = new Uint8ClampedArray(rgba.length);
        copy.set(rgba);
        const imageData = new ImageData(copy, size, size);
        try {
          bitmaps[i] = await createImageBitmap(imageData);
        } catch {
          bitmaps[i] = null;
        }
        if (i === indexRef.current) blit(indexRef.current);
      }
    }

    void build();
    return () => {
      cancelled = true;
      for (const b of bitmaps) b?.close();
    };
  }, [frames, size, lo, hi]);

  function blit(index: number) {
    const canvas = canvasRef.current;
    if (!canvas || size <= 0) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    ctx.fillStyle = "#05080e";
    ctx.fillRect(0, 0, size, size);

    const bmp = bitmapsRef.current[index];
    const f = frames[index];
    if (bmp) {
      ctx.drawImage(bmp, 0, 0);
    } else if (f) {
      const rgba = renderFrameToRgba(f.pixels, f.mask, size, lo, hi, f.frame.background);
      const imageData = ctx.createImageData(size, size);
      imageData.data.set(rgba);
      ctx.putImageData(imageData, 0, 0);
    }

    if (f) {
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
  }

  // Sync external frameIndex (slider / pause).
  useEffect(() => {
    if (playing) return;
    indexRef.current = frameIndex;
    blit(frameIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameIndex, playing, frames, lo, hi, size]);

  // Playback loop: canvas only, no React setState per tick.
  useEffect(() => {
    if (!playing || frames.length < 2) return;

    let raf = 0;
    let last = performance.now();
    const notifyEveryMs = 200;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!playingRef.current) return;
      const interval = 1000 / Math.max(1, fpsRef.current);
      if (now - last < interval) return;
      last = now;

      const next = (indexRef.current + 1) % frames.length;
      indexRef.current = next;
      blit(next);

      if (now - lastNotifyRef.current >= notifyEveryMs) {
        lastNotifyRef.current = now;
        onChangeRef.current?.(next);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, frames.length]);

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
        contain: "strict",
      }}
      aria-label="SPHEREx image frame"
    />
  );
}
