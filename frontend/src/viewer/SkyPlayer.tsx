import { useEffect, useRef } from "react";
import type { Candidate, SaturatedStar } from "../data/candidates";
import type { CatalogSlice } from "../data/catalog";
import { type ColorMap, type Grid, renderFrameToRgba } from "../data/contract";
import type { DecodedFrame } from "../data/decode";
import {
  drawCandidatesOverlay,
  drawCatalogOverlay,
  drawFlightPath,
  drawTargetOverlay,
  type FlightPath,
  type TrailPoint,
} from "./overlays";

export interface SkyPlayerProps {
  frames: DecodedFrame[];
  frameIndex: number;
  playing: boolean;
  fps: number;
  lo: number;
  hi: number;
  size: number;
  colorMap?: ColorMap;
  /** Tint pixels whose mask byte is not 0 (Tommy item 6). */
  tintMask?: boolean;
  /** CSS display size in px (square). */
  displayPx?: number;
  /** Soft upscale (default) vs crisp nearest-neighbor blocks. */
  smoothScale?: boolean;
  trail?: TrailPoint[];
  candidates?: Candidate[];
  candidatesGrid?: Grid | null;
  viewGrid?: Grid | null;
  activeCandidate?: number | null;
  saturated?: SaturatedStar[];
  catalogSlices?: CatalogSlice[];
  catalogEnabled?: Set<string>;
  catalogHighlightId?: string | null;
  flightPath?: FlightPath | null;
  /** 0 = AllWISE epoch, 1 = now — bead position on the flight path. */
  flightScrub?: number;
  /** Visitor / share mark (~12 px frame). */
  markXy?: [number, number] | null;
  className?: string;
  onFrameIndexChange?: (index: number) => void;
}

/**
 * Static when paused: one blit, then the canvas is left alone (no rAF).
 * Playback uses setInterval only. never requestAnimationFrame at display Hz.
 * Contrast changes must not re-render every loaded frame — lazy per-index cache.
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
  tintMask = false,
  displayPx,
  smoothScale = true,
  trail = [],
  candidates = [],
  candidatesGrid = null,
  viewGrid = null,
  activeCandidate = null,
  saturated = [],
  catalogSlices = [],
  catalogEnabled,
  catalogHighlightId = null,
  flightPath = null,
  flightScrub = 1,
  markXy = null,
  className,
  onFrameIndexChange,
}: SkyPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const cacheRef = useRef<(ImageData | null)[]>([]);
  const indexRef = useRef(frameIndex);
  const cacheKeyRef = useRef("");
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const trailRef = useRef(trail);
  trailRef.current = trail;
  const candidatesRef = useRef({
    candidates,
    candidatesGrid,
    viewGrid,
    activeCandidate,
    saturated,
    catalogSlices,
    catalogEnabled: catalogEnabled ?? new Set<string>(),
    catalogHighlightId,
    flightPath,
    flightScrub,
    markXy,
  });
  candidatesRef.current = {
    candidates,
    candidatesGrid,
    viewGrid,
    activeCandidate,
    saturated,
    catalogSlices,
    catalogEnabled: catalogEnabled ?? new Set<string>(),
    catalogHighlightId,
    flightPath,
    flightScrub,
    markXy,
  };
  const onChangeRef = useRef(onFrameIndexChange);
  onChangeRef.current = onFrameIndexChange;

  const cacheKey = `${size}|${lo}|${hi}|${colorMap}|${tintMask}|${frames.length}|${frames[0]?.frame.id ?? ""}|${frames[frames.length - 1]?.frame.id ?? ""}`;
  const css = displayPx ?? size * 4;

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

  /** Render only the asked frame. Contrast scrub must not rebuild hundreds of ImageData. */
  function imageFor(index: number): ImageData | null {
    const list = framesRef.current;
    if (index < 0 || index >= list.length || size <= 0) return null;
    if (cacheKeyRef.current !== cacheKey || cacheRef.current.length !== list.length) {
      cacheKeyRef.current = cacheKey;
      cacheRef.current = new Array(list.length).fill(null);
    }
    const hit = cacheRef.current[index];
    if (hit) return hit;
    const f = list[index];
    if (!f) return null;
    const rgba = renderFrameToRgba(
      f.pixels,
      f.mask,
      size,
      lo,
      hi,
      f.frame.background,
      colorMap,
      tintMask,
    );
    const copy = new Uint8ClampedArray(rgba.length);
    copy.set(rgba);
    const image = new ImageData(copy, size, size);
    cacheRef.current[index] = image;
    return image;
  }

  function blit(index: number) {
    const ctx = ensureCtx();
    if (!ctx || size <= 0) return;
    const image = imageFor(index);
    if (!image) return;
    ctx.putImageData(image, 0, 0);

    const f = framesRef.current[index];
    if (!f) return;
    drawTargetOverlay(ctx, f.frame.target_xy, trailRef.current);
    const overlay = candidatesRef.current;
    if (
      (overlay.candidates.length > 0 || overlay.saturated.length > 0) &&
      overlay.candidatesGrid &&
      overlay.viewGrid
    ) {
      drawCandidatesOverlay(
        ctx,
        overlay.candidates,
        overlay.viewGrid,
        overlay.candidatesGrid,
        overlay.activeCandidate,
        f.exposure.pass,
        overlay.saturated,
      );
    }
    if (overlay.viewGrid && overlay.catalogEnabled.size > 0 && overlay.catalogSlices.length > 0) {
      drawCatalogOverlay(
        ctx,
        overlay.catalogSlices,
        overlay.catalogEnabled,
        overlay.viewGrid,
        f.frame.time_mjd,
        100,
        overlay.catalogHighlightId,
      );
    }
    if (overlay.flightPath) {
      drawFlightPath(ctx, overlay.flightPath, overlay.flightScrub);
    }
    if (overlay.markXy) {
      const half = 6;
      ctx.save();
      ctx.strokeStyle = "rgba(251, 191, 36, 0.95)";
      ctx.lineWidth = 1.4;
      ctx.strokeRect(overlay.markXy[0] - half, overlay.markXy[1] - half, half * 2, half * 2);
      ctx.restore();
    }
  }

  useEffect(() => {
    if (playing) return;
    indexRef.current = frameIndex;
    blit(frameIndex);
    onChangeRef.current?.(frameIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playing,
    frameIndex,
    cacheKey,
    trail,
    candidates,
    candidatesGrid,
    viewGrid,
    activeCandidate,
    saturated,
    catalogSlices,
    catalogEnabled,
    catalogHighlightId,
    flightPath,
    flightScrub,
    markXy,
  ]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;

    const id = window.setInterval(() => {
      const next = (indexRef.current + 1) % framesRef.current.length;
      indexRef.current = next;
      blit(next);
      onChangeRef.current?.(next);
    }, 1000 / Math.max(1, fps));

    return () => {
      window.clearInterval(id);
      onChangeRef.current?.(indexRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, fps, frames.length, cacheKey]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size}
      height={size}
      style={{
        width: css,
        height: css,
        // Soft by default — 128² data looks less blocky when upscaled.
        imageRendering: smoothScale ? "auto" : "pixelated",
        background: "#05080e",
      }}
      aria-label="SPHEREx image frame"
    />
  );
}
