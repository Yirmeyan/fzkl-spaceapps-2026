/**
 * What the map shows, kept in the address of the page.
 *
 * The address follows the map as it moves, so that coming back with the Back button, or
 * opening a link someone sent, gives the same sky.
 */

import { DEFAULT_LAYER_KEY, layerOf } from "./layers";

export interface MapView {
  /** Center of the map, in degrees. */
  ra: number;
  dec: number;
  /** Width of the sky shown, in degrees. */
  fov: number;
  layer: string;
  /** Wavelength asked for, in micrometers: the SPHEREx layer shows the closest frame. */
  wavelength: number;
}

/** The whole sky, centered on the middle of the Milky Way. */
export const DEFAULT_MAP_VIEW: MapView = {
  ra: 266.4168,
  dec: -29.0078,
  fov: 360,
  layer: DEFAULT_LAYER_KEY,
  wavelength: 1.65,
};

/**
 * The all-sky cube has pixels of 13 arcseconds, twice those of SPHEREx, and nothing where
 * a bright source saturates. Closer than this the map shows tiles and holes, not sky: the
 * detail is in the explorer, which reads the images themselves.
 */
export const NARROWEST_FOV = 2;
export const WIDEST_FOV = 360;

function numberOr(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function between(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The view an address asks for. What is missing or not a number takes its default. */
export function readMapView(search: string): MapView {
  const asked = new URLSearchParams(search);
  const ra = numberOr(asked.get("ra"), DEFAULT_MAP_VIEW.ra);
  const dec = numberOr(asked.get("dec"), DEFAULT_MAP_VIEW.dec);
  const placed = ra >= 0 && ra < 360 && dec >= -90 && dec <= 90;
  return {
    ra: placed ? ra : DEFAULT_MAP_VIEW.ra,
    dec: placed ? dec : DEFAULT_MAP_VIEW.dec,
    fov: between(numberOr(asked.get("fov"), DEFAULT_MAP_VIEW.fov), NARROWEST_FOV, WIDEST_FOV),
    layer: layerOf(asked.get("layer")).key,
    wavelength: between(numberOr(asked.get("um"), DEFAULT_MAP_VIEW.wavelength), 0.7, 5.1),
  };
}

function rounded(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** The address of a view, without the question mark. Defaults are left out. */
export function mapViewToSearch(view: MapView): string {
  const said = new URLSearchParams();
  said.set("ra", rounded(view.ra, 4));
  said.set("dec", rounded(view.dec, 4));
  // A wide view needs no decimals, a narrow one needs a few.
  said.set("fov", rounded(view.fov, view.fov >= 10 ? 1 : 3));
  if (view.layer !== DEFAULT_LAYER_KEY) {
    said.set("layer", view.layer);
  }
  if (layerOf(view.layer).cube) {
    said.set("um", rounded(view.wavelength, 2));
  }
  return said.toString();
}
