import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, readViewFromUrl } from "./url";

describe("url state", () => {
  it("reads defaults from empty search", () => {
    expect(readViewFromUrl("")).toMatchObject({
      targetKey: DEFAULT_VIEW.targetKey,
      playing: false,
      mode: "single",
      colorMap: "heat",
    });
  });

  it("parses filters and mode", () => {
    const v = readViewFromUrl(
      "?target=wise0855&pass=2&frame=5&play=1&mode=difference&a=1&b=3&wave=1.2&contrast=2&cmap=gray",
    );
    expect(v.targetKey).toBe("wise0855");
    expect(v.pass).toBe(2);
    expect(v.frameIndex).toBe(5);
    expect(v.playing).toBe(true);
    expect(v.mode).toBe("difference");
    expect(v.diffPassA).toBe(1);
    expect(v.diffPassB).toBe(3);
    expect(v.waveUm).toBe(1.2);
    expect(v.contrast).toBe(2);
    expect(v.colorMap).toBe("gray");
  });
});
