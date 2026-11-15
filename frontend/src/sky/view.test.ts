import { describe, expect, it } from "vitest";
import { layerOf, SKY_LAYERS } from "./layers";
import { DEFAULT_MAP_VIEW, mapViewToSearch, NARROWEST_FOV, readMapView } from "./view";

describe("the view an address asks for", () => {
  it("is the whole sky when the address says nothing", () => {
    expect(readMapView("")).toEqual(DEFAULT_MAP_VIEW);
  });

  it("is read from the address", () => {
    expect(readMapView("?ra=10.5&dec=-20&fov=5&layer=wise&um=3.3")).toEqual({
      ra: 10.5,
      dec: -20,
      fov: 5,
      layer: "wise",
      wavelength: 3.3,
    });
  });

  it("takes its defaults where the address is not a place or not a number", () => {
    expect(readMapView("?ra=400&dec=10").ra).toBe(DEFAULT_MAP_VIEW.ra);
    expect(readMapView("?ra=10&dec=95").dec).toBe(DEFAULT_MAP_VIEW.dec);
    expect(readMapView("?ra=east&dec=north&fov=wide")).toEqual(DEFAULT_MAP_VIEW);
    expect(readMapView("?layer=unknown").layer).toBe("spherex");
  });

  it("keeps the zoom within what the images can show", () => {
    expect(readMapView("?fov=0.0001").fov).toBe(NARROWEST_FOV);
    expect(readMapView("?fov=9999").fov).toBe(360);
  });
});

describe("the address of a view", () => {
  it("comes back as the same view", () => {
    const view = { ra: 133.7862, dec: -7.2444, fov: 2.346, layer: "spherex", wavelength: 4.6 };
    expect(readMapView(`?${mapViewToSearch(view)}`)).toEqual(view);
  });

  it("is short: rounded, and without what is the default", () => {
    expect(mapViewToSearch(DEFAULT_MAP_VIEW)).toBe("ra=266.4168&dec=-29.0078&fov=360&um=1.65");
    expect(
      mapViewToSearch({ ...DEFAULT_MAP_VIEW, ra: 10.123456, fov: 123.456, layer: "wise" }),
    ).toBe("ra=10.1235&dec=-29.0078&fov=123.5&layer=wise");
  });
});

describe("the skies of the map", () => {
  it("start with SPHEREx, the only cube", () => {
    expect(SKY_LAYERS[0].key).toBe("spherex");
    expect(SKY_LAYERS.filter((layer) => layer.cube).map((layer) => layer.key)).toEqual(["spherex"]);
  });

  it("have each their own key, an address and a credit", () => {
    expect(new Set(SKY_LAYERS.map((layer) => layer.key)).size).toBe(SKY_LAYERS.length);
    for (const layer of SKY_LAYERS) {
      expect(layer.url).toMatch(/^https:\/\//);
      expect(layer.credit.length).toBeGreaterThan(10);
      expect(layerOf(layer.key)).toBe(layer);
    }
    expect(layerOf(null)).toBe(SKY_LAYERS[0]);
  });
});
