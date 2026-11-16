/**
 * The map engine: Aladin Lite, written by the CDS of Strasbourg, LGPL-3.0-or-later.
 *
 * This file is the only one that knows it. The rest of the page asks for a place, a
 * layer or a frame, and never touches the engine: another engine would change this file
 * alone.
 *
 * The engine is loaded from jsDelivr at one fixed version, and the page says which
 * bytes it expects (see sky.html). The images come from the archives themselves.
 */

import { type CubeAxis, sliceForFrame } from "./frames";
import type { SkyLayer } from "./layers";
import { isPlace } from "./place";
import { NARROWEST_FOV, WIDEST_FOV } from "./view";

// Typed as a plain string: the compiler must not look for this module on disk.
export const ENGINE_URL: string = "https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js";
const LOAD_TIMEOUT_MS = 30_000;
// A layer that has not said it is ready after this long is counted as failed.
const LAYER_TIMEOUT_MS = 20_000;
const BACKGROUND = "rgb(7, 11, 18)";

interface EngineLayer {
  setSliceNumber(slice: number): void;
}

interface EngineLayerOptions {
  name: string;
  /** Called once the engine has read what the archive says of the layer. */
  successCallback: () => void;
  errorCallback: () => void;
}

interface EngineView {
  getRaDec(): ArrayLike<number>;
  getFov(): ArrayLike<number>;
  pix2world(x: number, y: number): ArrayLike<number> | null | undefined;
  world2pix(ra: number, dec: number): ArrayLike<number> | null | undefined;
  setBaseImageLayer(layer: EngineLayer): void;
  on(what: string, listener: () => void): void;
  setFoVRange?: (narrowest: number, widest: number) => void;
  animateToRaDec?: (ra: number, dec: number, seconds: number) => void;
  zoomToFoV?: (fov: number, seconds: number) => void;
  setBackgroundColor?: (color: string) => void;
}

export interface Engine {
  init: Promise<unknown>;
  aladin(element: HTMLElement, options: Record<string, unknown>): EngineView;
  HiPS(url: string, options: EngineLayerOptions): EngineLayer;
}

export interface Place {
  ra: number;
  dec: number;
}

export interface Pixel {
  x: number;
  y: number;
}

/** The map could not be shown: the engine or the images did not arrive. */
export class MapUnavailable extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "MapUnavailable";
  }
}

function isEngine(value: unknown): value is Engine {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.aladin === "function" &&
    typeof candidate.HiPS === "function" &&
    candidate.init instanceof Promise
  );
}

function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MapUnavailable(`${what} took too long.`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

let loading: Promise<Engine> | null = null;

async function fetchEngine(): Promise<Engine> {
  let loaded: unknown;
  try {
    loaded = await within(import(/* @vite-ignore */ ENGINE_URL), LOAD_TIMEOUT_MS, "The map engine");
  } catch (error) {
    if (error instanceof MapUnavailable) {
      throw error;
    }
    throw new MapUnavailable("The map engine could not be loaded.", error);
  }
  const engine = (loaded as { default?: unknown }).default;
  if (!isEngine(engine)) {
    throw new MapUnavailable("The map engine did not load as expected.");
  }
  try {
    await within(engine.init, LOAD_TIMEOUT_MS, "Starting the map engine");
  } catch (error) {
    throw new MapUnavailable("The map engine could not start in this browser.", error);
  }
  return engine;
}

/** The engine, loaded once. A failure is not kept: the next call tries again. */
export function loadEngine(): Promise<Engine> {
  if (loading === null) {
    loading = fetchEngine().catch((error: unknown) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

/** The map, as the page uses it. */
export class SkyMap {
  private readonly engine: Engine;
  private readonly view: EngineView;
  private layer: EngineLayer | null = null;
  // True once the layer on the map has said it is ready: a frame asked before waits.
  private ready = false;
  private slice: number | null = null;
  private failed: (layer: SkyLayer) => void = () => {};

  /**
   * `frame` and `axis` choose the frame of a cube, and are null for any other layer.
   */
  constructor(
    engine: Engine,
    element: HTMLElement,
    start: Place & { fov: number },
    layer: SkyLayer,
    frame: number | null,
    axis: CubeAxis | null,
  ) {
    this.engine = engine;
    try {
      this.view = engine.aladin(element, {
        // Named here too: left alone, the engine would start on a sky of its own choice.
        survey: layer.url,
        target: `${start.ra} ${start.dec}`,
        fov: start.fov,
        // The whole sky on one ellipse, north up, as the explorer shows its images.
        projection: "AIT",
        cooFrame: "ICRSd",
        backgroundColor: BACKGROUND,
        showReticle: false,
        showCooGrid: false,
        showLayersControl: false,
        showProjectionControl: false,
        showFullscreenControl: false,
        showFrame: false,
        showGotoControl: false,
        showSimbadPointerControl: false,
        showCooGridControl: false,
        showSettingsControl: false,
        showShareControl: false,
        showContextMenu: false,
        showStatusBar: false,
        // The engine would otherwise tell the CDS of each visit, and offer to talk to
        // desktop tools: the page does neither.
        log: false,
        samp: false,
      });
    } catch (error) {
      throw new MapUnavailable("The map could not be drawn in this browser.", error);
    }
    this.view.setFoVRange?.(NARROWEST_FOV, WIDEST_FOV);
    this.view.setBackgroundColor?.(BACKGROUND);
    this.show(layer, frame, axis);
  }

  /** Change the sky shown. `frame` and `axis` as for the constructor. */
  show(layer: SkyLayer, frame: number | null, axis: CubeAxis | null): void {
    this.ready = false;
    this.slice = frame !== null && axis !== null ? sliceForFrame(frame, axis) : null;
    const giveUp = setTimeout(() => {
      if (this.layer === made && !this.ready) {
        this.failed(layer);
      }
    }, LAYER_TIMEOUT_MS);
    const made: EngineLayer = this.engine.HiPS(layer.url, {
      name: layer.label,
      successCallback: () => {
        clearTimeout(giveUp);
        // A layer the visitor has already left says nothing to the map.
        if (this.layer === made) {
          this.ready = true;
          this.give();
        }
      },
      errorCallback: () => {
        clearTimeout(giveUp);
        if (this.layer === made) {
          this.failed(layer);
        }
      },
    });
    this.layer = made;
    this.view.setBaseImageLayer(made);
  }

  /** Show one frame of the cube the map is on. */
  showFrame(frame: number, axis: CubeAxis): void {
    this.slice = sliceForFrame(frame, axis);
    if (this.ready) {
      this.give();
    }
  }

  /** Call `listener` when a sky could not be loaded. */
  onLayerFailure(listener: (layer: SkyLayer) => void): void {
    this.failed = listener;
  }

  private give(): void {
    if (this.layer !== null && this.slice !== null) {
      this.layer.setSliceNumber(this.slice);
    }
  }

  center(): Place {
    const at = this.view.getRaDec();
    return { ra: at[0], dec: at[1] };
  }

  /** Width of the sky shown, in degrees. */
  fov(): number {
    return this.view.getFov()[0];
  }

  /** Move the map toward a place and show a narrower part of the sky around it. */
  approach(place: Place, fov: number, seconds: number): void {
    this.view.animateToRaDec?.(place.ra, place.dec, seconds);
    this.view.zoomToFoV?.(fov, seconds);
  }

  /** The place under a point of the map, or null outside the sky. */
  placeAt(x: number, y: number): Place | null {
    let at: ArrayLike<number> | null | undefined;
    try {
      at = this.view.pix2world(x, y);
    } catch {
      return null;
    }
    if (!at || !isPlace(at[0], at[1])) {
      return null;
    }
    return { ra: ((at[0] % 360) + 360) % 360, dec: at[1] };
  }

  /** Where a place is drawn on the map, or null when it is not in view. */
  pixelOf(place: Place): Pixel | null {
    let at: ArrayLike<number> | null | undefined;
    try {
      at = this.view.world2pix(place.ra, place.dec);
    } catch {
      return null;
    }
    if (!at || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) {
      return null;
    }
    return { x: at[0], y: at[1] };
  }

  /** Call `listener` when the map moves or zooms. */
  onMove(listener: () => void): void {
    this.view.on("positionChanged", listener);
    this.view.on("zoomChanged", listener);
  }
}
