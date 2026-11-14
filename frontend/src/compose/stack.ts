import { MASK_OVERFLOW } from "../data/contract";
import type { DecodedFrame } from "../data/decode";

export type ComposeMode = "single" | "stack" | "difference" | "track";

/**
 * Mean stack of background-subtracted frames.
 * Skips NaN and OVERFLOW pixels per frame; requires at least one valid sample.
 */
export function stackFrames(frames: DecodedFrame[]): {
  pixels: Float32Array;
  mask: Uint8Array;
  background: number;
  noise: number | null;
} {
  if (frames.length === 0) {
    return {
      pixels: new Float32Array(0),
      mask: new Uint8Array(0),
      background: 0,
      noise: null,
    };
  }

  const n = frames[0]!.pixels.length;
  const sum = new Float64Array(n);
  const count = new Uint16Array(n);
  const outMask = new Uint8Array(n);

  for (const f of frames) {
    const bg = f.frame.background ?? 0;
    for (let i = 0; i < n; i++) {
      const v = f.pixels[i]!;
      const m = f.mask[i]!;
      if (Number.isNaN(v) || (m & MASK_OVERFLOW) !== 0) {
        outMask[i] = outMask[i]! | m;
        continue;
      }
      sum[i]! += v - bg;
      count[i]! += 1;
      outMask[i] = outMask[i]! | m;
    }
  }

  const pixels = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pixels[i] = count[i]! > 0 ? sum[i]! / count[i]! : Number.NaN;
  }

  const noises = frames.map((f) => f.frame.noise).filter((x): x is number => x != null && x > 0);
  const noise =
    noises.length > 0
      ? noises.reduce((a, b) => a + b, 0) / noises.length / Math.sqrt(frames.length)
      : null;

  return { pixels, mask: outMask, background: 0, noise };
}

/**
 * Mean(pass A) − mean(pass B), background-subtracted per frame before averaging.
 */
export function differencePasses(
  frames: DecodedFrame[],
  passA: number,
  passB: number,
): {
  pixels: Float32Array;
  mask: Uint8Array;
  background: number;
  noise: number | null;
} {
  const a = stackFrames(frames.filter((f) => f.exposure.pass === passA));
  const b = stackFrames(frames.filter((f) => f.exposure.pass === passB));
  const n = a.pixels.length;
  const pixels = new Float32Array(n);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const va = a.pixels[i]!;
    const vb = b.pixels[i]!;
    mask[i] = a.mask[i]! | b.mask[i]!;
    pixels[i] = Number.isNaN(va) || Number.isNaN(vb) ? Number.NaN : va - vb;
  }
  const noise =
    a.noise != null && b.noise != null ? Math.hypot(a.noise, b.noise) : (a.noise ?? b.noise);
  return { pixels, mask, background: 0, noise };
}

/**
 * Shift each frame so the target sits at a common pixel, then stack.
 * Reveals co-moving sources; background stars smear.
 */
export function stackTrackingTarget(frames: DecodedFrame[]): {
  pixels: Float32Array;
  mask: Uint8Array;
  background: number;
  noise: number | null;
} {
  if (frames.length === 0) {
    return {
      pixels: new Float32Array(0),
      mask: new Uint8Array(0),
      background: 0,
      noise: null,
    };
  }

  const size = Math.sqrt(frames[0]!.pixels.length) | 0;
  const ref = frames[0]!.frame.target_xy;
  const n = size * size;
  const sum = new Float64Array(n);
  const count = new Uint16Array(n);
  const outMask = new Uint8Array(n);

  for (const f of frames) {
    const dx = Math.round(ref[0] - f.frame.target_xy[0]);
    const dy = Math.round(ref[1] - f.frame.target_xy[1]);
    const bg = f.frame.background ?? 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sx = x - dx;
        const sy = y - dy;
        if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
        const si = sy * size + sx;
        const di = y * size + x;
        const v = f.pixels[si]!;
        const m = f.mask[si]!;
        if (Number.isNaN(v) || (m & MASK_OVERFLOW) !== 0) {
          outMask[di] = outMask[di]! | m;
          continue;
        }
        sum[di]! += v - bg;
        count[di]! += 1;
        outMask[di] = outMask[di]! | m;
      }
    }
  }

  const pixels = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pixels[i] = count[i]! > 0 ? sum[i]! / count[i]! : Number.NaN;
  }

  return { pixels, mask: outMask, background: 0, noise: null };
}
