import { describe, expect, it } from "vitest";
import type { DecodedFrame } from "../data/decode";
import {
  differencePasses,
  stackByPass,
  stackFrames,
  stackPassClean,
  stackTrackingTarget,
} from "./stack";

function fakeFrame(pass: number, fill: number, targetXy: [number, number] = [2, 2]): DecodedFrame {
  const size = 4;
  return {
    exposure: {
      id: `id-${pass}-${fill}`,
      collection: "dr1",
      detector: 2,
      pass,
      time_mjd: 60000 + pass,
      time_iso: "2025-01-01T00:00:00Z",
    },
    frame: {
      id: `id-${pass}-${fill}`,
      time_mjd: 60000 + pass,
      time_iso: "2025-01-01T00:00:00Z",
      exposure_s: 100,
      wavelength_um: 1.2,
      bandwidth_um: 0.02,
      background: 0,
      noise: 0.1,
      valid_fraction: 1,
      target_xy: targetXy,
      photometry: { flux_mjy: null, error_mjy: null, quality: "ok" },
      image: "",
      mask: "",
    },
    pixels: new Float32Array(size * size).fill(fill),
    mask: new Uint8Array(size * size),
  };
}

describe("compose", () => {
  it("stacks as the mean", () => {
    const out = stackFrames([fakeFrame(1, 2), fakeFrame(1, 4)]);
    expect(out.pixels[0]).toBeCloseTo(3);
  });

  it("differences two passes", () => {
    const frames = [fakeFrame(1, 5), fakeFrame(2, 2)];
    const out = differencePasses(frames, 1, 2);
    expect(out.pixels[0]).toBeCloseTo(3);
  });

  it("track stack shifts the target to a common pixel", () => {
    const a = fakeFrame(1, 0, [1, 1]);
    a.pixels[1 * 4 + 1] = 10;
    const b = fakeFrame(2, 0, [2, 1]);
    b.pixels[1 * 4 + 2] = 10;
    const out = stackTrackingTarget([a, b]);
    // Both peaks should land on ref target (1,1)
    expect(out.pixels[1 * 4 + 1]).toBeCloseTo(10);
  });

  it("clean pass stack skips any non-zero mask pixel", () => {
    const a = fakeFrame(1, 4);
    const b = fakeFrame(1, 8);
    b.mask[0] = 1;
    const out = stackPassClean([a, b]);
    expect(out.pixels[0]).toBeCloseTo(4);
    expect(out.pixels[1]).toBeCloseTo(6);
  });

  it("stackByPass returns one mean per visit", () => {
    const out = stackByPass([fakeFrame(1, 2), fakeFrame(1, 4), fakeFrame(2, 10)]);
    expect(out.map((x) => x.pass)).toEqual([1, 2]);
    expect(out[0]!.stack.pixels[0]).toBeCloseTo(3);
    expect(out[1]!.stack.pixels[0]).toBeCloseTo(10);
  });
});
