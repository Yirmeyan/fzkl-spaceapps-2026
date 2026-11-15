import { describe, expect, it } from "vitest";
import { pinFrom, pinLink, pinsFrom, statusLabel } from "./pins";

const TEAM = {
  id: "barnard-star-1",
  name: "Barnard's Star",
  source: "team",
  status: "confirmed",
  kind: "moved",
  ra: 269.446294,
  dec: 4.768711,
  epoch: 2026.168,
  target: { ra: 269.452077, dec: 4.693365, epoch: 2000.0, pm_ra: -801.551, pm_dec: 10362.394 },
  preset: "barnard-star",
  found: "Moved 10.4 arcseconds in 363 days, 10.50 ± 0.86 arcseconds per year",
  known: "Gaia DR3: 10.39 arcseconds per year",
  measured: "2026-11-15",
};

const LIVE_FIELD = {
  ...TEAM,
  id: "gj-65-1",
  name: "GJ 65",
  preset: null,
  target: { ra: 24.756, dec: -17.9505, epoch: 2000.0, pm_ra: 3321.0, pm_dec: 562.0 },
};

const MARK = {
  id: "v-1052738196",
  name: "Mark at 17h57m54.9s +04d47m29s",
  source: "visitor",
  status: "unconfirmed",
  kind: null,
  ra: 269.4788635638123,
  dec: 4.791349320003109,
  epoch: null,
  target: { ra: 269.452077, dec: 4.693365, epoch: 2000.0, pm_ra: -801.551, pm_dec: 10362.394 },
  preset: "barnard-star",
  found: null,
  known: null,
  measured: null,
  category: "changed",
  view: { detector: null, pass: 2, frame: null },
  shared: "2026-11-15T05:01:36Z",
};

describe("an entry of the journal as a pin", () => {
  it("keeps where it is, what was found and what catalogs say", () => {
    const pin = pinFrom(TEAM);
    expect(pin).toMatchObject({
      id: "barnard-star-1",
      name: "Barnard's Star",
      ra: 269.446294,
      dec: 4.768711,
      status: "confirmed",
      shared: false,
      said: TEAM.found,
      known: TEAM.known,
      preset: "barnard-star",
    });
  });

  it("says of a mark that a visitor shared it, and that nothing was measured", () => {
    const pin = pinFrom(MARK);
    expect(pin?.shared).toBe(true);
    expect(pin?.said).toBe("A visitor saw something change brightness here. Not measured yet.");
    expect(pin?.known).toBeNull();
    expect(pinFrom({ ...MARK, category: "from-the-future" })?.said).toBe(
      "A visitor marked this place. Not measured yet.",
    );
  });

  it("is refused when it is not what the contract describes", () => {
    expect(pinFrom(null)).toBeNull();
    expect(pinFrom("a pin")).toBeNull();
    expect(pinFrom({ ...TEAM, id: 7 })).toBeNull();
    expect(pinFrom({ ...TEAM, ra: "east" })).toBeNull();
    expect(pinFrom({ ...TEAM, dec: 95 })).toBeNull();
    expect(pinFrom({ ...TEAM, status: "certain" })).toBeNull();
    expect(pinFrom({ ...TEAM, target: null })).toBeNull();
    expect(pinFrom({ ...TEAM, target: { ra: 10 } })).toBeNull();
  });

  it("takes a target without a motion as one that stands still", () => {
    expect(pinFrom({ ...TEAM, target: { ra: 10, dec: 20 } })?.target).toEqual({
      ra: 10,
      dec: 20,
      epoch: 2000,
      pm_ra: 0,
      pm_dec: 0,
    });
  });
});

describe("the pins of the two lists", () => {
  it("come in order, each identifier once, the bad entries left out", () => {
    const pins = pinsFrom([TEAM, { nothing: true }, LIVE_FIELD], [MARK, TEAM]);
    expect(pins.map((pin) => pin.id)).toEqual(["barnard-star-1", "gj-65-1", "v-1052738196"]);
  });

  it("are none for a list that did not arrive", () => {
    expect(pinsFrom(undefined, null, "entries", { entries: [] })).toEqual([]);
  });
});

describe("the link of a pin", () => {
  it("opens a static target by its key", () => {
    expect(pinLink(pinFrom(TEAM)!, "/")).toBe("/?target=barnard-star");
    expect(pinLink(pinFrom(MARK)!, "/")).toBe("/?target=barnard-star");
  });

  it("opens any other field on its target, with the motion that follows it", () => {
    expect(pinLink(pinFrom(LIVE_FIELD)!, "/")).toBe(
      "/?ra=24.756&dec=-17.9505&epoch=2000&pm_ra=3321&pm_dec=562",
    );
  });

  it("carries no motion for a target that stands still", () => {
    const still = pinFrom({ ...LIVE_FIELD, target: { ra: 76.9565, dec: 30.4014 } });
    expect(pinLink(still!, "/app/")).toBe("/app/?ra=76.9565&dec=30.4014");
  });
});

describe("the word on a pin", () => {
  it("says synthetic before anything else", () => {
    expect(statusLabel(pinFrom({ ...MARK, status: "synthetic" })!)).toBe("SYNTHETIC");
    expect(statusLabel(pinFrom({ ...TEAM, status: "synthetic" })!)).toBe("SYNTHETIC");
  });

  it("tells a mark from a finding", () => {
    expect(statusLabel(pinFrom(MARK)!)).toBe("Shared by a visitor");
    expect(statusLabel(pinFrom(TEAM)!)).toBe("Confirmed by a catalog");
    expect(statusLabel(pinFrom({ ...TEAM, status: "unconfirmed" })!)).toBe("Unconfirmed");
  });
});
