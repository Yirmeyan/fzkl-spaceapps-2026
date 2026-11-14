import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  normalizeTargetKey,
  readSkyFromUrl,
  readViewFromUrl,
  viewToSearchParams,
} from "./url";

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

  it("opens custom sky from ra and dec", () => {
    const v = readViewFromUrl("?ra=83.8221&dec=-5.3911");
    expect(v.targetKey).toBe("custom");
    expect(v.query).toBe("83.8221, -5.3911");
  });

  it("maps index target keys to UI keys", () => {
    expect(normalizeTargetKey("barnard-star")).toBe("barnard");
    expect(normalizeTargetKey("epsilon-indi-b")).toBe("epsindi");
    expect(readViewFromUrl("?target=rw-aurigae&detector=3&mode=stack").targetKey).toBe("rwaur");
  });

  it("reads optional epoch and proper motion", () => {
    const sky = readSkyFromUrl("?ra=133.8&dec=-7.2&epoch=2000&pm_ra=-8123.7&pm_dec=673.2");
    expect(sky).toEqual({
      ra: 133.8,
      dec: -7.2,
      epoch: 2000,
      pm_ra: -8123.7,
      pm_dec: 673.2,
    });
  });

  it("writes preset as index target key with detector and mode", () => {
    const q = viewToSearchParams({
      ...DEFAULT_VIEW,
      targetKey: "epsindi",
      detector: 2,
      mode: "stack",
    });
    expect(q.get("target")).toBe("epsilon-indi-b");
    expect(q.get("detector")).toBe("2");
    expect(q.get("mode")).toBe("stack");
  });

  it("writes custom sky as ra and dec", () => {
    const q = viewToSearchParams(
      { ...DEFAULT_VIEW, targetKey: "custom", query: "Vega", detector: 2, mode: "single" },
      { ra: 279.23, dec: 38.78, epoch: 2000, pm_ra: 200.94, pm_dec: 286.23 },
    );
    expect(q.get("ra")).toBe("279.23");
    expect(q.get("dec")).toBe("38.78");
    expect(q.get("pm_ra")).toBe("200.94");
    expect(q.get("detector")).toBe("2");
    expect(q.get("target")).toBeNull();
  });
});
