import {
  type Bundle,
  computeDisplayLimits,
  decodeImage,
  decodeMask,
  type Exposure,
  type Frame,
  type Grid,
  type Target,
} from "./contract";

export interface DecodedFrame {
  frame: Frame;
  exposure: Exposure;
  pixels: Float32Array;
  mask: Uint8Array;
}

export interface DecodedBundle {
  target: Target;
  grid: Grid;
  exposures: Exposure[];
  frames: DecodedFrame[];
  limits: { lo: number; hi: number };
}

export function decodeBundle(bundle: Bundle): DecodedBundle {
  const byId = new Map(bundle.exposures.map((e) => [e.id, e]));
  const size = bundle.grid.size;
  const frames: DecodedFrame[] = [];

  for (const frame of bundle.frames) {
    const exposure = byId.get(frame.id);
    if (!exposure) continue;
    frames.push({
      frame,
      exposure,
      pixels: decodeImage(frame.image, size),
      mask: decodeMask(frame.mask, size),
    });
  }

  const limits = computeDisplayLimits(
    frames.map((f) => ({
      pixels: f.pixels,
      background: f.frame.background,
      noise: f.frame.noise,
      mask: f.mask,
    })),
  );

  return {
    target: bundle.target,
    grid: bundle.grid,
    exposures: bundle.exposures,
    frames,
    limits,
  };
}
