import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CandidatesFile, candidateSentence, emptyCandidatesSentence } from "./candidates";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("candidates", () => {
  it("reads Barnard's Star sample and builds a motion sentence", () => {
    const raw = JSON.parse(
      readFileSync(join(root, "samples", "barnard-star-candidates.json"), "utf8"),
    ) as CandidatesFile;
    expect(raw.format).toBe("spherex-explorer/candidates");
    expect(raw.candidates).toHaveLength(1);
    const sentence = candidateSentence(raw.candidates[0]!);
    expect(sentence).toMatch(/Moved about/);
    expect(sentence).toMatch(/per year/);
  });

  it("explains an empty list with the limits", () => {
    expect(emptyCandidatesSentence({ significance: 5, shift_arcsec: 1, change: 0.1 })).toMatch(
      /Nothing moved or changed/,
    );
  });
});
