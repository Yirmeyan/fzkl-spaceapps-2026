import { describe, expect, it } from "vitest";
import {
  type CatalogSlice,
  type CatalogSource,
  catalogSourceTip,
  julianYearFromMjd,
  middleFrameEpochYear,
} from "./catalog";

describe("catalog helpers", () => {
  it("converts MJD to Julian year", () => {
    // J2000.0 = MJD 51544.5
    expect(julianYearFromMjd(51544.5)).toBeCloseTo(2000, 5);
  });

  it("takes the middle of frame times", () => {
    const y = middleFrameEpochYear([60000, 60100, 60200]);
    expect(y).toBeCloseTo(julianYearFromMjd(60100), 5);
  });

  it("builds a tip with mag and fast Gaia motion", () => {
    const slice: CatalogSlice = {
      key: "gaia",
      name: "Gaia DR3",
      epoch: 2016,
      band: "G",
      limit: 300,
      truncated: false,
      sources: [],
    };
    const source: CatalogSource = {
      id: "Gaia DR3 4472832130942575872",
      ra: 269.45,
      dec: 4.74,
      pm_ra: -801.551,
      pm_dec: 10362.394,
      parallax_mas: 547,
      mags: { G: 8.19 },
    };
    const tip = catalogSourceTip(slice, source);
    expect(tip).toContain("Gaia DR3 4472832130942575872");
    expect(tip).toContain("G = 8.2");
    expect(tip).toMatch(/moves 10\.39″ per year/);
  });
});
