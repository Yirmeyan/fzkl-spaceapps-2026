/**
 * The guided tour: one card after the other, from the sky map to the explorer. The visitor
 * only presses Next.
 *
 * The cards are data. A step names the page it belongs to, the element it points at and,
 * where the tour has to act for the visitor, the control it presses.
 */

export type TourPage = "sky" | "explorer";

export interface TourStep {
  page: TourPage;
  /** Selector of the element the card points at. The card is centered while it is absent. */
  anchor: string;
  title: string;
  body: string;
  /**
   * Selectors of the controls the tour presses when the card opens, as the visitor would,
   * in this order. The tour waits for the last one, and skips the others when they are absent.
   */
  press?: string | readonly string[];
  /** Words of the Next button when it does more than show the next card. */
  next?: string;
}

/** Name of the address parameter that carries the step, counted from 1. */
export const TOUR_PARAM = "tour";

/** The example the tour opens: it loads at once, from files that ship with the site. */
export const TOUR_TARGET = "barnard-star";

/** The Close button of the journal: the cards around the one of the journal press it. */
const CLOSE_JOURNAL = '[data-tour="journal-close"]';

export const TOUR_STEPS: readonly TourStep[] = [
  {
    page: "sky",
    anchor: ".sky-map",
    title: "The whole sky, seen by SPHEREx",
    body: "SPHEREx is a NASA space telescope. It photographs the entire sky in infrared light, about every six months. This map is made of its own images, published by the mission in November 2026.",
  },
  {
    page: "sky",
    anchor: ".sky-controls",
    title: "Move around the sky",
    body: "Drag the map to move and scroll to zoom. The slider changes the wavelength: the same sky in another infrared color. The Sky menu shows what other telescopes saw.",
  },
  {
    page: "sky",
    anchor: ".sky-map",
    title: "Choose any place",
    body: "Click any point of the map to watch that place over time. The pins mark what our search and other visitors already found. The tour has just picked Barnard's Star, a close neighbor of the Sun that moves fast.",
    press: '.sky-pins button[title^="Barnard"]',
    next: "Open Barnard's Star",
  },
  {
    page: "explorer",
    anchor: ".stage-measure",
    title: "A film of one place",
    body: "Every image here is real SPHEREx data of this place. Each time SPHEREx points here it takes an exposure, and an exposure gives six images, one for each of its six detectors. Play shows them one after the other.",
  },
  {
    page: "explorer",
    anchor: ".place-line",
    title: "Visits, six months apart",
    body: "SPHEREx surveys the whole sky again and again, so it comes back to each place about every six months. Each return is a visit, and this line says how many this place has. What moved or changed between two visits is what we look for.",
  },
  {
    page: "explorer",
    anchor: ".detector-dial",
    title: "Six detectors, six ranges of color",
    body: "SPHEREx has six detectors, like six cameras behind one telescope. Each sees its own range of infrared colors, from 0.75 to 5 micrometers. Pick one to watch the place in those colors. The coldest objects show up in detectors 5 and 6.",
  },
  {
    page: "explorer",
    anchor: '[data-tour="found"]',
    title: "What the tool measured by itself",
    body: "The service follows every source of the picture from visit to visit. It lists the ones that moved or changed, with a speed, a direction and a confidence. Nothing here is typed by hand, and each result is a candidate to check.",
    press: CLOSE_JOURNAL,
  },
  {
    page: "explorer",
    anchor: '[data-tour="journal-panel"]',
    title: "The journal, open to everyone",
    body: "The journal lists what our search found in the fields we checked, each with what the catalogs say of it, and what visitors shared. A click on a line opens that place. To add yours, use Share a place under the picture: frame the point, say what you saw, and share. There is nothing to write.",
    press: '[data-tour="journal"]',
  },
  {
    page: "explorer",
    anchor: ".mode-tabs",
    title: "Four ways to compare visits",
    body: "Watch plays the film. Blink flips between the first and the last visit: what jumps has moved. Subtract removes everything that stayed put. Average brings out faint objects. The tour has just pressed Blink: look at the star for a moment, it jumps.",
    press: [CLOSE_JOURNAL, '.mode-tabs [data-tour-way="compare"]'],
  },
  {
    page: "explorer",
    anchor: '[data-tour="size"]',
    title: "A wider view",
    body: "Back on Watch, the tour has just pressed Wide. The picture is now three times wider, three fifths of the width of the full Moon. Close comes back to the star.",
    press: ['.mode-tabs [data-tour-way="watch"]', '[data-tour="wide"]'],
  },
  {
    page: "explorer",
    anchor: '[data-tour="palette"]',
    title: "Colors are a choice",
    body: "Infrared light has no color for our eyes, so the picture is painted. Heat goes from black to yellow. The tour has just pressed Gray, the way astronomers often look at images.",
    press: '[data-tour="gray"]',
  },
  {
    page: "explorer",
    anchor: ".transport",
    title: "Your turn",
    body: "The tour has pressed Play and put the first colors back: the film is running. Type the name of a star or coordinates, pick an example, or go back to the sky map and click anywhere.",
    press: ['.play-btn[aria-pressed="false"]', '[data-tour="heat"]'],
  },
];

/** Index of the step an address asks for, or null when it asks for no tour. */
export function stepFromSearch(search: string): number | null {
  const asked = new URLSearchParams(search).get(TOUR_PARAM);
  if (asked === null || !/^\d+$/.test(asked)) return null;
  const index = Number(asked) - 1;
  return index >= 0 && index < TOUR_STEPS.length ? index : null;
}

/** Address that opens the tour at a step. `home` is the base address of the site. */
export function addressOfStep(index: number, home: string): string {
  const step = TOUR_STEPS[index];
  if (!step) throw new RangeError(`The tour has no step ${index + 1}.`);
  const asked = new URLSearchParams();
  if (step.page === "explorer") asked.set("target", TOUR_TARGET);
  asked.set(TOUR_PARAM, String(index + 1));
  return `${home}${step.page === "sky" ? "sky.html" : ""}?${asked.toString()}`;
}
