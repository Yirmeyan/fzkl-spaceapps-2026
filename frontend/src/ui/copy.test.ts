import { describe, expect, it } from "vitest";
import * as copy from "./copy";

/** Every text of the table, with the functions called on a plain case. */
function texts(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    found.push(value);
  } else if (typeof value === "function") {
    texts(value(5, 3.8, 4.43, 62), found);
  } else if (value && typeof value === "object") {
    for (const inner of Object.values(value)) texts(inner, found);
  }
  return found;
}

const ALL = texts(copy);

describe("the words of the explorer", () => {
  it("keeps to one vocabulary: visit, camera, infrared color", () => {
    const jargon = /\b(pass|passes|detectors?|hops?|fov|eyepiece)\b|λ/i;
    expect(ALL.filter((text) => jargon.test(text))).toEqual([]);
  });

  it("uses no dash as punctuation", () => {
    expect(ALL.filter((text) => /—|–| - /.test(text))).toEqual([]);
  });

  it("gives every control a label and a full sentence", () => {
    const controls: copy.Words[] = [
      ...Object.values(copy.TOP),
      ...Object.values(copy.WAYS),
      ...Object.values(copy.PLAYER),
      ...Object.values(copy.COMBINE.options),
      ...Object.values(copy.FOUND),
      copy.CAMERAS.all,
      copy.VISITS.all,
      copy.VISITS.one(2),
    ];
    for (const { label, hint } of controls) {
      expect(label.length).toBeGreaterThan(0);
      expect(hint).toMatch(/^[A-Z].*[.)]$/);
    }
  });

  it("says which camera, which colors and how many images", () => {
    expect(copy.CAMERAS.hint(5, 3.8, 4.43, 62)).toBe(
      "Camera 5: colors from 3.80 to 4.43 µm, 62 images of this place. Cold objects start to glow here.",
    );
    expect(copy.CAMERAS.hint(3, 1.62, 2.42, 61)).toBe(
      "Camera 3: colors from 1.62 to 2.42 µm, 61 images of this place.",
    );
  });
});
