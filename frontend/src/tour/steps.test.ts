import { describe, expect, it } from "vitest";
import { addressOfStep, stepFromSearch, TOUR_STEPS } from "./steps";

describe("the steps of the guided tour", () => {
  it("starts on the sky map and changes page once, toward the explorer", () => {
    const pages = TOUR_STEPS.map((step) => step.page);
    expect(pages[0]).toBe("sky");
    expect(pages.at(-1)).toBe("explorer");
    const changes = pages.filter((page, at) => at > 0 && page !== pages[at - 1]);
    expect(changes).toEqual(["explorer"]);
  });

  it("gives every card an element to point at, a title and full sentences", () => {
    for (const step of TOUR_STEPS) {
      expect(step.anchor.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body).toMatch(/^[A-Z].*\.$/);
    }
    const titles = TOUR_STEPS.map((step) => step.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("keeps to the words of the interface, with no dash as punctuation", () => {
    const texts = TOUR_STEPS.flatMap((step) => [step.title, step.body, step.next ?? ""]);
    expect(texts.filter((text) => /—|–| - /.test(text))).toEqual([]);
    expect(texts.filter((text) => /\b(pass|passes|hops?|fov|eyepiece)\b|λ/i.test(text))).toEqual(
      [],
    );
  });

  it("names every control it presses", () => {
    for (const step of TOUR_STEPS) {
      for (const selector of [step.press ?? []].flat()) {
        expect(selector.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("ends on the film, with Play pressed only when it is not running yet", () => {
    const last = TOUR_STEPS.at(-1);
    expect(last?.anchor).toBe(".transport");
    expect([last?.press ?? []].flat()).toContain('.play-btn[aria-pressed="false"]');
  });

  it("says what Next does on the card that leaves the sky map", () => {
    const last = TOUR_STEPS.findLastIndex((step) => step.page === "sky");
    expect(TOUR_STEPS[last]?.next).toBe("Open Barnard's Star");
  });
});

describe("the step asked by an address", () => {
  it("counts from 1", () => {
    expect(stepFromSearch("?tour=1")).toBe(0);
    expect(stepFromSearch(`?target=barnard-star&tour=${TOUR_STEPS.length}`)).toBe(
      TOUR_STEPS.length - 1,
    );
  });

  it("asks for no tour on anything else", () => {
    for (const search of [
      "",
      "?demo=1",
      "?tour=",
      "?tour=0",
      "?tour=abc",
      "?tour=-2",
      "?tour=99",
    ]) {
      expect(stepFromSearch(search)).toBeNull();
    }
  });
});

describe("the address of a step", () => {
  it("opens the sky map for the first cards", () => {
    expect(addressOfStep(0, "/")).toBe("/sky.html?tour=1");
  });

  it("opens the explorer on the example of the tour for the others", () => {
    const first = TOUR_STEPS.findIndex((step) => step.page === "explorer");
    expect(addressOfStep(first, "/")).toBe(`/?target=barnard-star&tour=${first + 1}`);
  });

  it("is read back as the same step", () => {
    TOUR_STEPS.forEach((_, index) => {
      const search = addressOfStep(index, "/").split("?")[1] ?? "";
      expect(stepFromSearch(`?${search}`)).toBe(index);
    });
  });

  it("refuses a step that does not exist", () => {
    expect(() => addressOfStep(TOUR_STEPS.length, "/")).toThrow(RangeError);
  });
});
