import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, readViewFromUrl } from "./url";

describe("url state", () => {
  it("reads defaults from empty search", () => {
    expect(readViewFromUrl("")).toMatchObject({
      targetKey: DEFAULT_VIEW.targetKey,
      playing: true,
      mode: "single",
    });
  });

  it("parses filters and mode", () => {
    const v = readViewFromUrl("?target=wise0855&pass=2&frame=5&play=0&mode=difference&a=1&b=3");
    expect(v.targetKey).toBe("wise0855");
    expect(v.pass).toBe(2);
    expect(v.frameIndex).toBe(5);
    expect(v.playing).toBe(false);
    expect(v.mode).toBe("difference");
    expect(v.diffPassA).toBe(1);
    expect(v.diffPassB).toBe(3);
  });
});
