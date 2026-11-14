import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CandidatesFile, candidateLines, emptyCandidatesSentence } from "./candidates";

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
    expect(lines.catalog).toBe("Catalog: 10.35″ per year");
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
    expect(lines.catalog).toBe("Catalog: 4.69″ per year");
  });

  it("explains an empty list with the limits", () => {
    expect(emptyCandidatesSentence({ significance: 5, shift_arcsec: 1, change: 0.1 }, 12)).toMatch(
      /Nothing moved by more than/,
    );
  });
});
