import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CandidatesFile,
  candidateKindLabel,
  candidateLines,
  discoveryFlashLine,
  emptyCandidatesSentence,
  noSwingSentence,
} from "./candidates";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("candidates", () => {
  it("reads Barnard's Star sample and builds short panel lines", () => {
    const raw = JSON.parse(
      readFileSync(join(root, "samples", "barnard-star-candidates.json"), "utf8"),
    ) as CandidatesFile;
    expect(raw.format).toBe("spherex-explorer/candidates");
    expect(raw.candidates).toHaveLength(1);
    const c = raw.candidates[0]!;
    const lines = candidateLines(c, -798.58, 10322.89);
    expect(lines.what).toMatch(/Moved/);
    expect(lines.what).toMatch(/per year/);
    // Barnard's sample has no parallax yet; howFar stays null.
    expect(lines.howFar).toBeNull();
    expect(lines.sure).toMatch(/Candidate,/);
    // Without a Gaia slice, the panel keeps no catalog line (Tommy 19:00).
    expect(lines.catalog).toBeNull();
  });

  it("formats distance and catalog lines when parallax is present", () => {
    const c = {
      kind: "moved",
      confidence: "high",
      significance: 20,
      is_target: true,
      ra: 0,
      dec: 0,
      epoch: 2016,
      xy: [64, 64] as [number, number],
      detectors: [1],
      track: [],
      motion: {
        shift_arcsec: 6.4,
        days: 507,
        rate_arcsec_per_year: 4.63,
        rate_error_arcsec_per_year: 0.06,
        angle_deg: 0,
        pm_ra: 0,
        pm_dec: 0,
        parallax_arcsec: 0.3,
        parallax_error_arcsec: 0.02,
        distance_ly: 10.7,
        distance_ly_range: [9.5, 12.1] as [number, number],
      },
      changes: [],
    };
    const lines = candidateLines(c, 3966.7, 2497.1);
    expect(lines.howFar).toMatch(/10\.7 light-years/);
    expect(lines.howFar).toMatch(/between 9\.5 and 12\.1/);
    expect(lines.catalog).toBeNull();
  });

  it("matches Barnard's Star to its Gaia source", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { knownAs, gaiaKnowsLine } = await import("./candidates");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const cand = JSON.parse(
      readFileSync(join(root, "samples", "barnard-star-candidates.json"), "utf8"),
    ) as CandidatesFile;
    const cat = JSON.parse(
      readFileSync(join(root, "samples", "barnard-star-catalog.json"), "utf8"),
    ) as { catalogs: { key: string; epoch: number; sources: unknown[] }[] };
    const gaia = cat.catalogs.find((c) => c.key === "gaia")!;
    const c = cand.candidates[0]!;
    const hit = knownAs(c, gaia as never);
    expect(hit?.source.id).toBe("Gaia DR3 4472832130942575872");
    expect(hit!.separation).toBeLessThan(0.5);
    expect(gaiaKnowsLine(c, hit)).toMatch(/Gaia DR3 knows it: 10\.39″ per year/);
  });

  it("explains an empty list with the limits", () => {
    expect(emptyCandidatesSentence({ significance: 5, shift_arcsec: 1, change: 0.1 }, 12)).toMatch(
      /Nothing moved by more than/,
    );
  });

  it("explains a halo change without a catalog rate line", () => {
    const c = {
      kind: "changed",
      method: "halo",
      confidence: "medium",
      significance: 8,
      is_target: true,
      ra: 0,
      dec: 0,
      epoch: 2025.5,
      xy: [64, 64] as [number, number],
      detectors: [5, 6],
      track: [],
      motion: null,
      changes: [
        {
          detector: 5,
          from_pass: 1,
          to_pass: 3,
          ratio: 0.45,
          error: 0.05,
          significance: 8,
          wavelength_um: [4.4, 5.0] as [number, number],
        },
      ],
    };
    const lines = candidateLines(c, 100, 50);
    expect(lines.what).toMatch(/2\.2× fainter/);
    expect(lines.catalog).toBeNull();
    expect(lines.howMeasured).toMatch(/halo of light/);
    expect(discoveryFlashLine(c)).toBe("About 2.2× fainter between Visit 1 and Visit 3");
  });

  it("formats a swung candidate from the synthetic Planet X sample", () => {
    const raw = JSON.parse(
      readFileSync(join(root, "samples", "synthetic-planet-x-candidates.json"), "utf8"),
    ) as CandidatesFile;
    expect(raw.synthetic?.note).toMatch(/does not exist/i);
    expect(raw.candidates).toHaveLength(1);
    const c = raw.candidates[0]!;
    expect(c.kind).toBe("swung");
    expect(candidateKindLabel(c.kind)).toBe("swings with the seasons");
    const lines = candidateLines(c, null, null);
    expect(lines.what).toMatch(/6,148 AU/);
    expect(lines.howFar).toMatch(/65 arcseconds/);
    // Limits still name the search window; the panel hides this line when a swung candidate exists.
    expect(noSwingSentence(raw.limits)).toMatch(/1,600 and 24,400 AU/);
  });

  it("states when no outer-solar-system body was found", () => {
    expect(
      noSwingSentence({
        significance: 5,
        shift_arcsec: 1,
        change: 0.1,
        swing_distance_au: [1600, 24400],
      }),
    ).toMatch(/1,600 and 24,400 AU/);
    expect(noSwingSentence({ significance: 5, shift_arcsec: 1, change: 0.1 })).toBeNull();
  });
});
