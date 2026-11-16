import { describe, expect, it } from "vitest";
import { placeCard } from "./place";

const CARD = { width: 360, height: 200 };
const SCREEN = { width: 1280, height: 800 };

describe("where the card of the tour goes", () => {
  it("is docked at the bottom of a narrow screen", () => {
    const phone = { width: 390, height: 800 };
    expect(placeCard(null, CARD, phone)).toEqual({ docked: true, at: "bottom" });
    const high = { top: 60, left: 20, width: 350, height: 300 };
    expect(placeCard(high, CARD, phone)).toEqual({ docked: true, at: "bottom" });
  });

  it("is docked at the top when the element sits low on a narrow screen", () => {
    const low = { top: 640, left: 0, width: 390, height: 140 };
    expect(placeCard(low, CARD, { width: 390, height: 800 })).toEqual({ docked: true, at: "top" });
  });

  it("is centered when there is nothing to point at", () => {
    expect(placeCard(null, CARD, SCREEN)).toEqual({ docked: false, top: 300, left: 460 });
  });

  it("goes under the element when there is room", () => {
    const placed = placeCard({ top: 100, left: 400, width: 200, height: 50 }, CARD, SCREEN);
    expect(placed).toEqual({ docked: false, top: 164, left: 320 });
  });

  it("goes above an element that sits low on the screen", () => {
    const placed = placeCard({ top: 700, left: 400, width: 200, height: 60 }, CARD, SCREEN);
    expect(placed).toEqual({ docked: false, top: 486, left: 320 });
  });

  it("goes beside an element as tall as the screen", () => {
    const placed = placeCard({ top: 0, left: 100, width: 500, height: 800 }, CARD, SCREEN);
    expect(placed).toEqual({ docked: false, top: 12, left: 614 });
  });

  it("takes the lower right corner when the element fills the screen", () => {
    const placed = placeCard({ top: 0, left: 0, width: 1280, height: 800 }, CARD, SCREEN);
    expect(placed).toEqual({ docked: false, top: 576, left: 896 });
  });

  it("never leaves the screen sideways", () => {
    const placed = placeCard({ top: 100, left: 1200, width: 60, height: 40 }, CARD, SCREEN);
    expect(placed).toEqual({ docked: false, top: 154, left: 908 });
  });
});
