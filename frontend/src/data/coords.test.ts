import { describe, expect, it } from "vitest";
import { parseCoordinateQuery } from "./coords";

describe("parseCoordinateQuery", () => {
  it("parses the challenge WISE 0855 sexagesimal line", () => {
    const t = parseCoordinateQuery("08h55m10.831s -7d14m42.53s");
    expect(t).not.toBeNull();
    expect(t!.ra).toBeCloseTo(133.795129, 5);
    expect(t!.dec).toBeCloseTo(-7.245147, 5);
  });

  it("parses comma and zero-padded dec", () => {
    const t = parseCoordinateQuery("08h55m10.831s, -07d14m42.53s");
    expect(t).not.toBeNull();
    expect(t!.ra).toBeCloseTo(133.795129, 5);
    expect(t!.dec).toBeCloseTo(-7.245147, 5);
  });

  it("parses colon form", () => {
    const t = parseCoordinateQuery("08:55:10.831 -07:14:42.53");
    expect(t).not.toBeNull();
    expect(t!.ra).toBeCloseTo(133.795129, 5);
    expect(t!.dec).toBeCloseTo(-7.245147, 5);
  });

  it("parses space-separated sexagesimal", () => {
    const t = parseCoordinateQuery("08 55 10.831 -07 14 42.53");
    expect(t).not.toBeNull();
    expect(t!.ra).toBeCloseTo(133.795129, 5);
    expect(t!.dec).toBeCloseTo(-7.245147, 5);
  });

  it("parses Barnard-like colon coords", () => {
    const t = parseCoordinateQuery("17:57:48.5 +04:41:36");
    expect(t).not.toBeNull();
    expect(t!.ra).toBeCloseTo(269.452083, 5);
    expect(t!.dec).toBeCloseTo(4.693333, 5);
  });

  it("keeps the sign of -0d30m", () => {
    const t = parseCoordinateQuery("00 00 00 -00 30 00");
    expect(t).not.toBeNull();
    expect(t!.ra).toBeCloseTo(0, 6);
    expect(t!.dec).toBeCloseTo(-0.5, 6);
  });

  it("still accepts plain degrees", () => {
    const t = parseCoordinateQuery("133.7951, -7.2451");
    expect(t).not.toBeNull();
    expect(t!.ra).toBeCloseTo(133.7951, 4);
    expect(t!.dec).toBeCloseTo(-7.2451, 4);
  });
});
