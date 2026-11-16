import { describe, expect, it } from "vitest";
import { rememberWelcome, WELCOME_KEY, welcomesAtOpening } from "./welcome";

function memory(start: Record<string, string> = {}) {
  const held = new Map(Object.entries(start));
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value);
    },
  };
}

const refused = {
  getItem: () => {
    throw new Error("storage refused");
  },
  setItem: () => {
    throw new Error("storage refused");
  },
};

describe("welcomesAtOpening", () => {
  it("opens for a first visit, whatever place the address asks for", () => {
    expect(welcomesAtOpening("", memory())).toBe(true);
    expect(welcomesAtOpening("?target=barnard-star", memory())).toBe(true);
    expect(welcomesAtOpening("?ra=331.0969&dec=-56.7968", memory())).toBe(true);
  });

  it("stays closed once it has been closed", () => {
    const storage = memory();
    rememberWelcome(storage);
    expect(storage.getItem(WELCOME_KEY)).toBe("1");
    expect(welcomesAtOpening("", storage)).toBe(false);
  });

  it("stays closed when the address starts the guided tour, the example or the years", () => {
    expect(welcomesAtOpening("?tour=1", memory())).toBe(false);
    expect(welcomesAtOpening("?target=barnard-star&tour=4", memory())).toBe(false);
    expect(welcomesAtOpening("?demo=1", memory())).toBe(false);
    expect(welcomesAtOpening("?target=barnard-star&years=1", memory())).toBe(false);
  });

  it("opens each time when the browser has no storage or refuses it", () => {
    expect(welcomesAtOpening("", null)).toBe(true);
    expect(welcomesAtOpening("", refused)).toBe(true);
  });
});

describe("rememberWelcome", () => {
  it("does not fail when the browser has no storage or refuses it", () => {
    expect(() => rememberWelcome(null)).not.toThrow();
    expect(() => rememberWelcome(refused)).not.toThrow();
  });
});
