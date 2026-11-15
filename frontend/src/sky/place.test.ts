import { describe, expect, it } from "vitest";
import { explorerLink, inDegrees, isPlace, sexagesimal } from "./place";

describe("a place written for a person", () => {
  it("is in hours and degrees, as astronomers write it", () => {
    expect(sexagesimal(266.4168, -29.0078)).toBe("17h45m40.0s -29°00'28\"");
    expect(sexagesimal(0, 0)).toBe("00h00m00.0s +00°00'00\"");
    expect(sexagesimal(133.795129, -7.245147)).toBe("08h55m10.8s -07°14'43\"");
  });

  it("never shows sixty seconds or twenty-four hours", () => {
    expect(sexagesimal(359.99999, 89.99999)).toBe("00h00m00.0s +90°00'00\"");
    expect(sexagesimal(-15, 10)).toBe("23h00m00.0s +10°00'00\"");
  });

  it("is also in degrees", () => {
    expect(inDegrees(266.4168, -29.0078)).toBe("266.4168, -29.0078");
    expect(inDegrees(10, 20)).toBe("10.0000, +20.0000");
  });
});

describe("the link to the explorer", () => {
  it("carries the place as the explorer reads it", () => {
    expect(explorerLink(266.416834, -29.007806, "/")).toBe("/?ra=266.41683&dec=-29.00781");
    expect(explorerLink(10, 20, "/app/")).toBe("/app/?ra=10&dec=20");
  });
});

describe("a pair of numbers", () => {
  it("is a place when it is on the sky", () => {
    expect(isPlace(10, 20)).toBe(true);
    expect(isPlace(Number.NaN, 20)).toBe(false);
    expect(isPlace(10, 91)).toBe(false);
  });
});
