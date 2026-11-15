import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Bundle } from "./contract";
import {
  asinhStretch,
  computeDisplayLimits,
  decodeImage,
  decodeMask,
  MASK_OVERFLOW,
  MASK_TRANSIENT,
  renderFrameToRgba,
  skyToPixel,
  targetAt,
} from "./contract";
import { decodeBundle } from "./decode";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const samplePath = join(root, "samples", "barnard-star-d2.json");

describe("contract helpers", () => {
  it("asinhStretch is odd and zero at zero", () => {
    expect(asinhStretch(0, 1)).toBe(0);
    expect(asinhStretch(1, 1)).toBeCloseTo(-asinhStretch(-1, 1), 10);
  });

  it("decodes the Barnard's Star sample and keeps the star near center", () => {
    const bundle = JSON.parse(readFileSync(samplePath, "utf8")) as Bundle;
    expect(bundle.frames.length).toBe(62);
    const decoded = decodeBundle(bundle);
    expect(decoded.frames.length).toBe(62);
    expect(decoded.limits.hi).toBeGreaterThan(decoded.limits.lo);

    const first = decoded.frames[0];
    expect(first).toBeDefined();
    if (!first) return;
    const [x, y] = first.frame.target_xy;
    expect(x).toBeGreaterThan(50);
    expect(x).toBeLessThan(80);
    expect(y).toBeGreaterThan(50);
    expect(y).toBeLessThan(80);

    const lastPass = decoded.frames.filter((f) => f.exposure.pass === 3);
    const firstPass = decoded.frames.filter((f) => f.exposure.pass === 1);
    expect(lastPass.length).toBeGreaterThan(0);
    const last0 = lastPass[0];
    const first0 = firstPass[0];
    expect(last0).toBeDefined();
    expect(first0).toBeDefined();
    if (!last0 || !first0) return;
    const dy = last0.frame.target_xy[1] - first0.frame.target_xy[1];
    expect(dy).toBeLessThan(-1.5);
  });

  it("tints non-zero mask pixels when tintMask is on", () => {
    const size = 2;
    const pixels = new Float32Array([1, 1, 1, 1]);
    const mask = new Uint8Array([0, MASK_TRANSIENT, 0, 0]);
    const plain = renderFrameToRgba(pixels, mask, size, -1, 5, 0, "heat", false);
    const tinted = renderFrameToRgba(pixels, mask, size, -1, 5, 0, "heat", true);
    expect(plain[0]).toBe(tinted[0]);
    expect(plain[1]).toBe(tinted[1]);
    expect(tinted[4]).not.toBe(plain[4]);
    expect(tinted[5]).not.toBe(plain[5]);
    expect(tinted[6]).not.toBe(plain[6]);
  });

  it("renders OVERFLOW NaN cores as bright pixels and holes as hatched gray", () => {
    const size = 4;
    const pixels = new Float32Array(size * size).fill(1);
    pixels[5] = Number.NaN;
    pixels[6] = Number.NaN;
    const mask = new Uint8Array(size * size);
    mask[5] = MASK_OVERFLOW;
    const lo = -1;
    const hi = 5;
    const bg = 0;
    const rgba = renderFrameToRgba(pixels, mask, size, lo, hi, bg, "heat");
    expect(rgba[5 * 4]).toBeGreaterThan(200);
    expect(rgba[5 * 4 + 3]).toBe(255);
    expect(rgba[6 * 4 + 3]).toBe(255);
    // Hole is neutral gray (not a heat-scale sky color).
    expect(rgba[6 * 4]).toBeGreaterThan(70);
    expect(rgba[6 * 4]).toBeLessThan(140);
    expect(Math.abs(rgba[6 * 4]! - rgba[6 * 4 + 1]!)).toBeLessThanOrEqual(8);
    const sky = renderFrameToRgba(
      Float32Array.from([bg]),
      new Uint8Array([0]),
      1,
      lo,
      hi,
      bg,
      "heat",
    );
    expect(rgba[6 * 4]).not.toBe(sky[0]);
  });

  it("skyToPixel matches targetAt for the sample grid center motion", () => {
    const bundle = JSON.parse(readFileSync(samplePath, "utf8")) as Bundle;
    const frame = bundle.frames[0];
    expect(frame).toBeDefined();
    if (!frame) return;
    const [ra, dec] = targetAt(bundle.target, frame.time_mjd);
    const [x, y] = skyToPixel(bundle.grid, ra, dec);
    expect(x).toBeCloseTo(frame.target_xy[0], 2);
    expect(y).toBeCloseTo(frame.target_xy[1], 2);
  });

  it("decodeImage length matches grid", () => {
    const bundle = JSON.parse(readFileSync(samplePath, "utf8")) as Bundle;
    const size = bundle.grid.size;
    const frame0 = bundle.frames[0];
    expect(frame0).toBeDefined();
    if (!frame0) return;
    const pixels = decodeImage(frame0.image, size);
    const mask = decodeMask(frame0.mask, size);
    expect(pixels.length).toBe(size * size);
    expect(mask.length).toBe(size * size);
    const limits = computeDisplayLimits([
      {
        pixels,
        mask,
        background: frame0.background,
        noise: frame0.noise,
      },
    ]);
    expect(limits.hi).toBeGreaterThan(0);
  });
});
