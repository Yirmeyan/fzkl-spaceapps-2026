import { describe, expect, it } from "vitest";
import type { DecodedFrame } from "../data/decode";
import { applyContrast, filterNearWavelength } from "./select";

function frame(wave: number): DecodedFrame {
  return {
    exposure: {
      id: `id-${wave}`,
      collection: "dr1",
      detector: 2,
      pass: 1,
      time_mjd: 60000,
      time_iso: "2025-01-01T00:00:00Z",
    },
    frame: {
      id: `id-${wave}`,
      time_mjd: 60000,
      time_iso: "2025-01-01T00:00:00Z",
      exposure_s: 100,
      wavelength_um: wave,
      bandwidth_um: 0.02,
      background: 0,
      noise: 0.1,
      valid_fraction: 1,
      target_xy: [2, 2],
      photometry: { flux_mjy: null, error_mjy: null, quality: "ok" },
      image: "",
      mask: "",
    },
    pixels: new Float32Array(16),
    mask: new Uint8Array(16),
  };
}

describe("wavelength match", () => {
  it("keeps frames within tolerance of the reference wavelength", () => {
    const frames = [frame(1.1), frame(1.12), frame(1.4)];
    const out = filterNearWavelength(frames, 1.1, 0.03);
    expect(out.map((f) => f.frame.wavelength_um)).toEqual([1.1, 1.12]);
  });

  it("passes all frames when no reference is set", () => {
    const frames = [frame(1.1), frame(1.4)];
    expect(filterNearWavelength(frames, null, 0.03)).toHaveLength(2);
  });
});

describe("contrast", () => {
  it("tightens limits when contrast increases", () => {
    const base = { lo: -1, hi: 5 };
    const tight = applyContrast(base, 2);
    expect(tight.lo).toBeCloseTo(-0.5);
    expect(tight.hi).toBeCloseTo(2.5);
  });
});
