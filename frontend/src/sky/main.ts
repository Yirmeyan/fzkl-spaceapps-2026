/**
 * The sky map: the whole sky as SPHEREx sees it, to choose where to look.
 *
 * A click on the sky opens the explorer on that place. The address of the page follows
 * the map, so that the Back button of the browser returns to the same view.
 */

import "./sky.css";
import { runTour } from "../tour/card";
import { addressOfStep, stepFromSearch, TOUR_TARGET } from "../tour/steps";
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
import { type Pin, pinLink, pinsFrom, statusLabel } from "./pins";
import { explorerLink, inDegrees, sexagesimal } from "./place";
import { type MapView, mapViewToSearch, NARROWEST_FOV, readMapView } from "./view";

// Address of the explorer: the map is a page beside it.
const HOME = import.meta.env.BASE_URL;
// The explorer on its first example. The bare address of the site opens this map instead.
const EXPLORER = `${HOME}?target=${TOUR_TARGET}`;
const REPOSITORY = "https://github.com/Yirmeyan/fzkl-spaceapps-2026";
// Address of the service, as the explorer is given it. Empty when the site and the
// service share an address, as on a developer's machine.
const SERVICE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");
const JOURNAL_TIMEOUT_MS = 10_000;
// A pin this far outside the map, in pixels, is not drawn.
const OUT_OF_SIGHT = 40;
const PROPERTIES_TIMEOUT_MS = 15_000;
// A press that moved less than this many pixels is a click, more is a drag of the map.
const CLICK_SLOP = 5;
// The address is written once the map has rested this long: browsers refuse a page
// that rewrites its address at every frame of a drag.
const ADDRESS_DELAY_MS = 350;
const FALLBACK_LAYER = "wise";
// The archive takes a few seconds to send its images. The page says it is waiting, and
// stops saying so after this long even when it saw none: images the engine already has
// are not asked for again.
const WAITING_AT_MOST_MS = 8000;

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
  waiting: HTMLDivElement;
  closest: HTMLDivElement;
  pins: HTMLDivElement;
  showPins: HTMLInputElement;
  pinsField: HTMLLabelElement;
  card: HTMLElement;
  cardBadge: HTMLParagraphElement;
  cardPlace: HTMLParagraphElement;
  cardDegrees: HTMLParagraphElement;
  cardSaid: HTMLParagraphElement;
  cardKnown: HTMLParagraphElement;
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
  home.href = EXPLORER;
  const title = make("h1", "sky-title", "Sky map");
  const lede = make(
    "p",
    "sky-lede",
    "The whole sky as SPHEREx sees it. Drag to move, scroll to zoom, click a place to watch it change over time.",
  );
  const tour = make("a", "sky-tour", "Guided tour");
  tour.href = addressOfStep(0, HOME);
  tour.title = "Nine short steps, from this map to the explorer. You only press Next.";
  bar.append(home, title, lede, tour);

  const stage = make("main", "sky-stage");
  const map = make("div", "sky-map");
  const pin = make("div", "sky-pin");
  pin.hidden = true;
  const notice = make("div", "sky-notice");
  notice.setAttribute("role", "status");

  const card = make("aside", "sky-card");
  card.hidden = true;
  card.setAttribute("aria-label", "Selected place");
  const cardBadge = make("p", "sky-card-badge");
  const cardPlace = make("p", "sky-card-place");
  const cardDegrees = make("p", "sky-card-degrees");
  const cardSaid = make("p", "sky-card-said");
  const cardKnown = make("p", "sky-card-known");
  const cardOpen = make("a", "sky-card-open", "Watch this place over time");
  const cardHint = make(
    "p",
    "sky-card-hint",
    "The Back button of your browser returns to the map.",
  );
  const cardClose = make("button", "sky-card-close", "Close");
  cardClose.type = "button";
  card.append(
    cardBadge,
    cardPlace,
    cardDegrees,
    cardSaid,
    cardKnown,
    cardOpen,
    cardHint,
    cardClose,
  );
  const pins = make("div", "sky-pins");
  const waiting = make("div", "sky-waiting", "Loading the images from the archive...");
  waiting.setAttribute("role", "status");
  waiting.hidden = true;
  const closest = make(
    "div",
    "sky-closest",
    "This is as close as the all-sky map goes. Click a place to see it in full detail.",
  );
  closest.setAttribute("role", "status");
  closest.hidden = true;
  stage.append(map, pins, pin, card, closest, waiting, notice);

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

  const pinsField = make("label", "sky-field sky-pins-field");
  const showPins = make("input", "sky-check");
  showPins.type = "checkbox";
  showPins.checked = true;
  pinsField.append(showPins, " Findings of the journal");
  pinsField.hidden = true;

  const center = make("a", "sky-center", "Open the explorer at the center of the map");
  const credit = make("p", "sky-credit");
  const source = make("a", "sky-source", "Source code");
  source.href = REPOSITORY;
  controls.append(layerLabel, wave, pinsField, center, credit, source);

  root.replaceChildren(bar, stage, controls);
  return {
    map,
    pin,
    notice,
    waiting,
    closest,
    pins,
    showPins,
    pinsField,
    card,
    cardBadge,
    cardPlace,
    cardDegrees,
    cardSaid,
    cardKnown,
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

/** A JSON document from an address, or null when it does not arrive or is not JSON. */
async function fetchJson(url: string): Promise<unknown> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), JOURNAL_TIMEOUT_MS);
  try {
    const answer = await fetch(url, { signal: stop.signal });
    return answer.ok ? await answer.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function entriesOf(document: unknown): unknown {
  return typeof document === "object" && document !== null && "entries" in document
    ? document.entries
    : null;
}

/**
 * The pins of the journal: what our checks found, then what visitors shared.
 *
 * The map works without them. A list that does not arrive is said in the console and
 * gives no pin.
 */
async function loadPins(): Promise<Pin[]> {
  const [checks, marks] = await Promise.all([
    fetchJson(`${HOME}samples/journal.json`),
    fetchJson(`${SERVICE}/api/journal`),
  ]);
  if (checks === null) {
    console.warn("The sky map could not read the journal of our checks.");
  }
  if (marks === null) {
    console.warn("The sky map could not read the marks of visitors.");
  }
  return pinsFrom(entriesOf(checks), entriesOf(marks));
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

/**
 * Call `seen` each time an image tile of a sky arrives. The engine does not say when it
 * has something to draw: the browser does, for every file a page receives.
 */
function watchTiles(seen: () => void): void {
  if (typeof PerformanceObserver === "undefined") {
    return;
  }
  const observer = new PerformanceObserver((list) => {
    if (list.getEntries().some((entry) => entry.name.includes("/Norder"))) {
      seen();
    }
  });
  observer.observe({ type: "resource" });
}

function say(page: Page, message: string, action?: { label: string; run: () => void }): void {
  page.notice.replaceChildren(make("p", "sky-notice-text", message));
  if (action) {
    const button = make("button", "sky-notice-action", action.label);
    button.type = "button";
    button.addEventListener("click", action.run);
    const explorer = make("a", "sky-notice-link", "Open SPHEREx Explorer");
    explorer.href = EXPLORER;
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

  const frames = axis ? usableFrames(axis) : [];
  // The frame the slider is on, or null for a sky that is not a cube.
  function frameAsked(): number | null {
    if (!axis || !layerOf(view.layer).cube) {
      return null;
    }
    return frames[Number(page.slider.value)] ?? frames[0];
  }
  if (axis) {
    page.slider.max = String(frames.length - 1);
    page.slider.value = String(Math.max(0, frames.indexOf(nearestFrame(view.wavelength, axis))));
  }

  const map = new SkyMap(engine, page.map, view, layerOf(view.layer), frameAsked(), axis);
  map.onLayerFailure((layer) => {
    page.waiting.hidden = true;
    say(page, `The sky "${layer.label}" did not load. Choose another one in the list below.`);
  });
  let selected: Place | null = null;

  let waited: ReturnType<typeof setTimeout> | undefined;
  function stopWaiting(): void {
    clearTimeout(waited);
    page.waiting.hidden = true;
  }
  // Said each time other images are asked for: another sky, another wavelength.
  function waitForImages(): void {
    clearTimeout(waited);
    page.waiting.hidden = false;
    waited = setTimeout(stopWaiting, WAITING_AT_MOST_MS);
  }
  watchTiles(stopWaiting);
  waitForImages();

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
    // Said as soon as the map reaches the closest view it allows.
    page.closest.hidden = map.fov() > NARROWEST_FOV * 1.02;
    clearTimeout(resting);
    resting = setTimeout(writeAddress, ADDRESS_DELAY_MS);
  }

  // What the page says of the frame the slider is on.
  function sayFrame(): void {
    const frame = frameAsked();
    if (frame === null || !axis) {
      return;
    }
    page.waveSaid.textContent = frameLabel(frame, axis);
    view.wavelength = wavelengthOf(frame, axis) ?? view.wavelength;
  }

  // What the page says of the layer the map is on.
  function sayLayer(): void {
    const layer = layerOf(view.layer);
    page.layer.value = layer.key;
    page.credit.textContent = `Image: ${layer.credit}. Map engine: Aladin Lite, CDS.`;
    page.wave.hidden = !layer.cube;
    sayFrame();
  }

  // The ring follows its place while the map moves: one look at the map for each frame
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

  /** Show the card of a place, with what is known of it when it is a pin. */
  function select(place: Place | null, pin: Pin | null = null): void {
    const wasFollowing = selected !== null;
    selected = place;
    page.card.hidden = place === null;
    if (place === null) {
      page.pin.hidden = true;
      return;
    }
    const where = sexagesimal(place.ra, place.dec);
    page.cardBadge.hidden = pin === null;
    page.cardSaid.hidden = pin === null || pin.said === "";
    page.cardKnown.hidden = pin === null || pin.known === null;
    if (pin === null) {
      page.cardPlace.textContent = where;
      page.cardDegrees.textContent = `${inDegrees(place.ra, place.dec)} degrees`;
      page.cardOpen.href = explorerLink(place.ra, place.dec, HOME);
    } else {
      page.cardBadge.textContent = statusLabel(pin);
      page.cardBadge.dataset.status = pin.shared ? "shared" : pin.status;
      page.cardPlace.textContent = pin.name;
      page.cardDegrees.textContent = where;
      page.cardSaid.textContent = pin.said;
      page.cardKnown.textContent = pin.known ?? "";
      page.cardOpen.href = pinLink(pin, HOME);
    }
    if (!wasFollowing) {
      requestAnimationFrame(followPin);
    }
  }

  // The pins of the journal are buttons laid over the map. They follow the sky the same
  // way the ring does, for as long as they are shown.
  const drawn: { pin: Pin; button: HTMLButtonElement }[] = [];
  function followPins(): void {
    if (page.pins.hidden || drawn.length === 0) {
      return;
    }
    const width = page.map.clientWidth;
    const height = page.map.clientHeight;
    for (const { pin, button } of drawn) {
      const at = map.pixelOf(pin);
      const inSight =
        at !== null &&
        at.x > -OUT_OF_SIGHT &&
        at.y > -OUT_OF_SIGHT &&
        at.x < width + OUT_OF_SIGHT &&
        at.y < height + OUT_OF_SIGHT;
      button.hidden = !inSight;
      if (at !== null && inSight) {
        button.style.transform = `translate(${at.x}px, ${at.y}px)`;
      }
    }
    requestAnimationFrame(followPins);
  }

  function drawPins(pins: Pin[]): void {
    for (const pin of pins) {
      const button = make("button", "sky-mark");
      button.type = "button";
      button.dataset.status = pin.shared ? "shared" : pin.status;
      button.title = `${pin.name}. ${statusLabel(pin)}.`;
      button.setAttribute("aria-label", button.title);
      // The targets of the challenge and the synthetic one carry their name on the map.
      if (pin.preset !== null && !pin.shared) {
        button.append(make("span", "sky-mark-name", pin.name));
      }
      button.addEventListener("click", () => select(pin, pin));
      page.pins.append(button);
      drawn.push({ pin, button });
    }
    page.pinsField.hidden = drawn.length === 0;
    requestAnimationFrame(followPins);
  }

  page.showPins.addEventListener("change", () => {
    page.pins.hidden = !page.showPins.checked;
    requestAnimationFrame(followPins);
  });
  void loadPins().then(drawPins);

  for (const option of Array.from(page.layer.options)) {
    option.disabled = axis === null && layerOf(option.value).cube;
  }
  sayLayer();
  writeAddress();

  page.layer.addEventListener("change", () => {
    view.layer = layerOf(page.layer.value).key;
    page.notice.hidden = true;
    waitForImages();
    map.show(layerOf(view.layer), frameAsked(), axis);
    sayLayer();
    writeAddress();
  });
  page.slider.addEventListener("input", () => {
    const frame = frameAsked();
    if (frame !== null && axis) {
      waitForImages();
      map.showFrame(frame, axis);
    }
    sayFrame();
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
  // The cards of the guided tour that belong to the map, when the address asks for them.
  const step = stepFromSearch(location.search);
  if (step !== null) runTour("sky", step, HOME);
}
