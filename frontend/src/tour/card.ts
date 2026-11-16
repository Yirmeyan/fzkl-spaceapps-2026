/**
 * The card of the guided tour and the ring around what it points at.
 *
 * Plain DOM on purpose: the sky map is not a React page, and one module serves both pages.
 * The card never blocks the page. An element that is missing leaves the card centered,
 * and the tour goes on.
 */
import "./tour.css";
import { DOCK_BELOW_WIDTH, placeCard } from "./place";
import { addressOfStep, TOUR_PARAM, TOUR_STEPS, type TourPage } from "./steps";

/** How long the tour looks for an element that the page is still building. */
const LOOK_FOR_MS = 10_000;
const LOOK_EVERY_MS = 200;
/** Time left to read the card before the tour presses a control for the visitor. */
const PRESS_AFTER_MS = 600;
/** How far the ring stands off the element it circles. */
const RING_MARGIN = 5;

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(className: string, text: string): HTMLButtonElement {
  const made = make("button", className, text);
  made.type = "button";
  return made;
}

/**
 * Shows the cards of one page, starting at a step. A step of the other page opens that
 * page at the step. Returns what takes the tour off the page.
 */
export function runTour(page: TourPage, first: number, home: string): () => void {
  const ring = make("div", "tour-ring");
  ring.hidden = true;
  ring.setAttribute("aria-hidden", "true");

  const card = make("section", "tour-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", "tour-title");
  card.setAttribute("aria-describedby", "tour-body");
  const count = make("p", "tour-count");
  const title = make("h2", "tour-title");
  title.id = "tour-title";
  const body = make("p", "tour-body");
  body.id = "tour-body";
  const close = button("tour-close", "End tour");
  const back = button("tour-back", "Back");
  const next = button("tour-next", "Next");
  const actions = make("div", "tour-actions");
  actions.append(close, back, next);
  card.append(count, title, body, actions);

  let index = first;
  let anchor: Element | null = null;
  let looking: number | undefined;
  let pressing: number | undefined;
  let frame = 0;
  let ended = false;
  // The page keeps growing while images arrive: the ring follows its element.
  const watcher = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => redraw());

  function draw(): void {
    frame = 0;
    if (ended) return;
    const rect = anchor?.getBoundingClientRect();
    const seen = rect && rect.width > 0 && rect.height > 0 ? rect : null;
    ring.hidden = seen === null;
    if (seen) {
      ring.style.top = `${seen.top - RING_MARGIN}px`;
      ring.style.left = `${seen.left - RING_MARGIN}px`;
      ring.style.width = `${seen.width + 2 * RING_MARGIN}px`;
      ring.style.height = `${seen.height + 2 * RING_MARGIN}px`;
    }
    const placed = placeCard(
      seen,
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    card.classList.toggle("is-docked", placed.docked);
    card.classList.toggle("is-top", placed.docked && placed.at === "top");
    card.style.top = placed.docked ? "" : `${placed.top}px`;
    card.style.left = placed.docked ? "" : `${placed.left}px`;
  }

  function redraw(): void {
    if (frame === 0) frame = window.requestAnimationFrame(draw);
  }

  /**
   * Bring the element on screen. On a phone it goes to the top at once, and the card is
   * docked under it: a slow scroll would make the card change ends on the way.
   */
  function bring(element: Element): void {
    const narrow = window.innerWidth < DOCK_BELOW_WIDTH;
    const calm = narrow || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({
      block: narrow ? "start" : "center",
      inline: "nearest",
      behavior: calm ? "auto" : "smooth",
    });
  }

  function stopLooking(): void {
    window.clearInterval(looking);
    window.clearTimeout(pressing);
    looking = undefined;
    pressing = undefined;
  }

  function show(to: number): void {
    const step = TOUR_STEPS[to];
    if (!step) {
      end(true);
      return;
    }
    if (step.page !== page) {
      window.location.assign(addressOfStep(to, home));
      return;
    }
    stopLooking();
    index = to;
    anchor = null;
    count.textContent = `Step ${to + 1} of ${TOUR_STEPS.length}`;
    title.textContent = step.title;
    body.textContent = step.body;
    back.hidden = to === 0;
    next.textContent = step.next ?? (to === TOUR_STEPS.length - 1 ? "Finish" : "Next");

    let pressed = step.press === undefined;
    const since = Date.now();
    const look = (): void => {
      if (anchor === null) {
        anchor = document.querySelector(step.anchor);
        if (anchor !== null) bring(anchor);
      }
      if (!pressed && step.press !== undefined) {
        const control = document.querySelector<HTMLElement>(step.press);
        if (control !== null) {
          pressed = true;
          pressing = window.setTimeout(() => control.click(), PRESS_AFTER_MS);
        }
      }
      draw();
      if ((anchor !== null && pressed) || Date.now() - since > LOOK_FOR_MS) {
        window.clearInterval(looking);
        looking = undefined;
      }
    };
    looking = window.setInterval(look, LOOK_EVERY_MS);
    look();
    next.focus({ preventScroll: true });
  }

  /** Take the tour off the page. Ended by the visitor, the address stops asking for it. */
  function end(byVisitor: boolean): void {
    if (ended) return;
    ended = true;
    stopLooking();
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", redraw);
    window.removeEventListener("scroll", redraw, true);
    watcher?.disconnect();
    ring.remove();
    card.remove();
    if (!byVisitor) return;
    const address = new URL(window.location.href);
    if (address.searchParams.has(TOUR_PARAM)) {
      address.searchParams.delete(TOUR_PARAM);
      window.history.replaceState(window.history.state, "", address);
    }
  }

  next.addEventListener("click", () => show(index + 1));
  back.addEventListener("click", () => show(index - 1));
  close.addEventListener("click", () => end(true));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      end(true);
    }
  });
  window.addEventListener("resize", redraw);
  // Captured: a panel that scrolls inside the page moves the element too.
  window.addEventListener("scroll", redraw, true);
  watcher?.observe(document.body);

  document.body.append(ring, card);
  show(first);
  return () => end(false);
}
