import { useEffect, useRef } from "react";
import type { Candidate, SaturatedStar } from "../data/candidates";
import type { CatalogSlice } from "../data/catalog";
import { type ColorMap, type Grid, renderFrameToRgba } from "../data/contract";
import {
  drawCandidatesOverlay,
  drawCatalogOverlay,
  drawTargetOverlay,
  type TrailPoint,
} from "./overlays";

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
  candidates?: Candidate[];
  candidatesGrid?: Grid | null;
  viewGrid?: Grid | null;
  activeCandidate?: number | null;
  candidatePass?: number | null;
  saturated?: SaturatedStar[];
  catalogSlices?: CatalogSlice[];
  catalogEnabled?: Set<string>;
  catalogHighlightId?: string | null;
  catalogTimeMjd?: number | null;
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
  candidates = [],
  candidatesGrid = null,
  viewGrid = null,
  activeCandidate = null,
  candidatePass = null,
  saturated = [],
  catalogSlices = [],
  catalogEnabled,
  catalogHighlightId = null,
  catalogTimeMjd = null,
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
    if ((candidates.length > 0 || saturated.length > 0) && candidatesGrid && viewGrid) {
      drawCandidatesOverlay(
        ctx,
        candidates,
        viewGrid,
        candidatesGrid,
        activeCandidate,
        candidatePass,
        saturated,
      );
    }
    if (
      viewGrid &&
      catalogTimeMjd != null &&
      catalogEnabled &&
      catalogEnabled.size > 0 &&
      catalogSlices.length > 0
    ) {
      drawCatalogOverlay(
        ctx,
        catalogSlices,
        catalogEnabled,
        viewGrid,
        catalogTimeMjd,
        100,
        catalogHighlightId,
      );
    }
  }, [
    pixels,
    mask,
    size,
    lo,
    hi,
    background,
    colorMap,
    tintMask,
    targetXy,
    trail,
    candidates,
    candidatesGrid,
    viewGrid,
    activeCandidate,
    candidatePass,
    saturated,
    catalogSlices,
    catalogEnabled,
    catalogHighlightId,
    catalogTimeMjd,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={size}
      height={size}
      style={{
        width: css,
        height: css,
        // When the parent picked an explicit display size (Split tiles), do not
        // let max-width shrink the canvas back into a tiny square.
        ...(displayPx == null ? { maxWidth: "100%" } : {}),
        imageRendering: "pixelated",
      }}
      aria-label="SPHEREx image frame"
    />
  );
}
