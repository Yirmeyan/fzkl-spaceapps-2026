/**
 * The sky map: the whole sky as SPHEREx sees it, to choose where to look.
 *
 * A click on the sky opens the explorer on that place. The address of the page follows
 * the map, so that the Back button of the browser returns to the same view.
 */

import "./sky.css";
import { type Engine, loadEngine, MapUnavailable, type Place, SkyMap } from "./engine";
import {
  type CubeAxis,
  cubeAxisFrom,
  frameLabel,
  nearestFrame,
  parseProperties,
  usableFrames,
  wavelengthOf,
} from "./frames";
import { layerOf, SKY_LAYERS, SPHEREX_CUBE_URL } from "./layers";
import { explorerLink, inDegrees, sexagesimal } from "./place";
import { type MapView, mapViewToSearch, readMapView } from "./view";

// Address of the explorer: the map is a page beside it.
const HOME = import.meta.env.BASE_URL;
const PROPERTIES_TIMEOUT_MS = 15_000;
// A press that moved less than this many pixels is a click, more is a drag of the map.
const CLICK_SLOP = 5;
// The address is written once the map has rested this long: browsers refuse a page
// that rewrites its address at every frame of a drag.
const ADDRESS_DELAY_MS = 350;
const FALLBACK_LAYER = "wise";

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

interface Page {
  map: HTMLDivElement;
  pin: HTMLDivElement;
  notice: HTMLDivElement;
  card: HTMLElement;
  cardPlace: HTMLParagraphElement;
  cardDegrees: HTMLParagraphElement;
  cardOpen: HTMLAnchorElement;
  cardClose: HTMLButtonElement;
  layer: HTMLSelectElement;
  wave: HTMLLabelElement;
  slider: HTMLInputElement;
  waveSaid: HTMLOutputElement;
  center: HTMLAnchorElement;
  credit: HTMLParagraphElement;
}

function buildPage(root: HTMLElement): Page {
  const bar = make("header", "sky-bar");
  const home = make("a", "sky-home", "SPHEREx Explorer");
  home.href = HOME;
  const title = make("h1", "sky-title", "Sky map");
  const lede = make(
    "p",
    "sky-lede",
    "The whole sky as SPHEREx sees it. Drag to move, scroll to zoom, click a place to watch it change over time.",
  );
  bar.append(home, title, lede);

  const stage = make("main", "sky-stage");
  const map = make("div", "sky-map");
  const pin = make("div", "sky-pin");
  pin.hidden = true;
  const notice = make("div", "sky-notice");
  notice.setAttribute("role", "status");

  const card = make("aside", "sky-card");
  card.hidden = true;
  card.setAttribute("aria-label", "Selected place");
  const cardPlace = make("p", "sky-card-place");
  const cardDegrees = make("p", "sky-card-degrees");
  const cardOpen = make("a", "sky-card-open", "Watch this place over time");
  const cardHint = make(
    "p",
    "sky-card-hint",
    "The Back button of your browser returns to the map.",
  );
  const cardClose = make("button", "sky-card-close", "Close");
  cardClose.type = "button";
  card.append(cardPlace, cardDegrees, cardOpen, cardHint, cardClose);
  stage.append(map, pin, card, notice);

  const controls = make("footer", "sky-controls");
  const layerLabel = make("label", "sky-field", "Sky ");
  const layer = make("select", "sky-select");
  for (const choice of SKY_LAYERS) {
    const option = make("option", "", choice.label);
    option.value = choice.key;
    layer.append(option);
  }
  layerLabel.append(layer);

  const wave = make("label", "sky-field sky-wave", "Wavelength ");
  const slider = make("input", "sky-slider");
  slider.type = "range";
  slider.min = "0";
  slider.step = "1";
  const waveSaid = make("output", "sky-wave-said");
  wave.append(slider, waveSaid);

  const center = make("a", "sky-center", "Open the explorer at the center of the map");
  const credit = make("p", "sky-credit");
  controls.append(layerLabel, wave, center, credit);

  root.replaceChildren(bar, stage, controls);
  return {
    map,
    pin,
    notice,
    card,
    cardPlace,
    cardDegrees,
    cardOpen,
    cardClose,
    layer,
    wave,
    slider,
    waveSaid,
    center,
    credit,
  };
}

/** What the archive says of the cube, or null when it does not answer. */
async function loadCubeAxis(): Promise<CubeAxis | null> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), PROPERTIES_TIMEOUT_MS);
  try {
    const answer = await fetch(`${SPHEREX_CUBE_URL}/properties`, { signal: stop.signal });
    if (!answer.ok) {
      return null;
    }
    return cubeAxisFrom(parseProperties(await answer.text()));
  } catch {
    // The archive is out of reach: the caller shows another sky and says so.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function say(page: Page, message: string, action?: { label: string; run: () => void }): void {
  page.notice.replaceChildren(make("p", "sky-notice-text", message));
  if (action) {
    const button = make("button", "sky-notice-action", action.label);
    button.type = "button";
    button.addEventListener("click", action.run);
    const explorer = make("a", "sky-notice-link", "Open SPHEREx Explorer");
    explorer.href = HOME;
    page.notice.append(button, explorer);
  }
  page.notice.hidden = false;
}

function start(page: Page, engine: Engine, axis: CubeAxis | null, asked: MapView): void {
  const view: MapView = { ...asked };
  // Without what the archive says of the cube, no frame can be chosen: another sky is
  // shown, and the visitor is told.
  if (axis === null && layerOf(view.layer).cube) {
    view.layer = FALLBACK_LAYER;
    say(page, "The SPHEREx sky map of the archive did not answer. Showing the WISE sky instead.");
    setTimeout(() => {
      page.notice.hidden = true;
    }, 8000);
  } else {
    page.notice.hidden = true;
  }

  const map = new SkyMap(engine, page.map, view, layerOf(view.layer));
  const frames = axis ? usableFrames(axis) : [];
  let selected: Place | null = null;

  function writeAddress(): void {
    const center = map.center();
    view.ra = center.ra;
    view.dec = center.dec;
    view.fov = map.fov();
    history.replaceState(null, "", `${location.pathname}?${mapViewToSearch(view)}`);
    page.center.href = explorerLink(center.ra, center.dec, HOME);
  }

  let resting: ReturnType<typeof setTimeout> | undefined;
  function moved(): void {
    clearTimeout(resting);
    resting = setTimeout(writeAddress, ADDRESS_DELAY_MS);
  }

  function showFrameOfSlider(): void {
    if (!axis) {
      return;
    }
    const frame = frames[Number(page.slider.value)] ?? frames[0];
    map.showFrame(frame, axis);
    page.waveSaid.textContent = frameLabel(frame, axis);
    view.wavelength = wavelengthOf(frame, axis) ?? view.wavelength;
  }

  function showLayer(): void {
    const layer = layerOf(view.layer);
    page.layer.value = layer.key;
    page.credit.textContent = `Image: ${layer.credit}. Map engine: Aladin Lite, CDS.`;
    page.wave.hidden = !layer.cube;
    if (layer.cube) {
      showFrameOfSlider();
    }
  }

  // The pin follows its place while the map moves: one look at the map for each frame
  // the browser draws, and none when nothing is selected.
  function followPin(): void {
    if (selected === null) {
      page.pin.hidden = true;
      return;
    }
    const at = map.pixelOf(selected);
    page.pin.hidden = at === null;
    if (at !== null) {
      page.pin.style.transform = `translate(${at.x}px, ${at.y}px)`;
    }
    requestAnimationFrame(followPin);
  }

  function select(place: Place | null): void {
    const wasFollowing = selected !== null;
    selected = place;
    page.card.hidden = place === null;
    if (place === null) {
      page.pin.hidden = true;
      return;
    }
    page.cardPlace.textContent = sexagesimal(place.ra, place.dec);
    page.cardDegrees.textContent = `${inDegrees(place.ra, place.dec)} degrees`;
    page.cardOpen.href = explorerLink(place.ra, place.dec, HOME);
    if (!wasFollowing) {
      requestAnimationFrame(followPin);
    }
  }

  if (axis) {
    page.slider.max = String(frames.length - 1);
    page.slider.value = String(Math.max(0, frames.indexOf(nearestFrame(view.wavelength, axis))));
  }
  for (const option of Array.from(page.layer.options)) {
    option.disabled = axis === null && layerOf(option.value).cube;
  }
  showLayer();
  writeAddress();

  page.layer.addEventListener("change", () => {
    view.layer = layerOf(page.layer.value).key;
    map.show(layerOf(view.layer));
    showLayer();
    writeAddress();
  });
  page.slider.addEventListener("input", () => {
    showFrameOfSlider();
    moved();
  });
  page.cardClose.addEventListener("click", () => select(null));
  map.onMove(moved);

  // Listened to on the way down to the map, before the engine sees the press: the
  // engine keeps moving the map as it wants, and the page learns of a click.
  let pressed: { x: number; y: number } | null = null;
  page.map.addEventListener(
    "pointerdown",
    (event) => {
      const onTheSky = event.target instanceof HTMLCanvasElement;
      pressed =
        onTheSky && event.isPrimary && event.button === 0
          ? { x: event.clientX, y: event.clientY }
          : null;
    },
    true,
  );
  page.map.addEventListener(
    "pointerup",
    (event) => {
      const from = pressed;
      pressed = null;
      if (from === null) {
        return;
      }
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > CLICK_SLOP) {
        return;
      }
      const box = page.map.getBoundingClientRect();
      const place = map.placeAt(event.clientX - box.left, event.clientY - box.top);
      if (place !== null) {
        select(place);
      }
    },
    true,
  );
}

async function open(page: Page): Promise<void> {
  say(page, "Loading the sky...");
  try {
    const [engine, axis] = await Promise.all([loadEngine(), loadCubeAxis()]);
    start(page, engine, axis, readMapView(location.search));
  } catch (error) {
    // Said to the visitor and to the console: the explorer itself needs none of this.
    console.error("The sky map could not be shown.", error);
    const why =
      error instanceof MapUnavailable
        ? error.message
        : "The sky map could not be shown in this browser.";
    say(page, `${why} The explorer works without the map.`, {
      label: "Try again",
      run: () => {
        void open(page);
      },
    });
  }
}

const root = document.getElementById("sky-root");
if (root) {
  void open(buildPage(root));
}
