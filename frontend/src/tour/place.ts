/** Where the card of the tour goes on the screen, next to the element it points at. */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Docked: the style sheet pins the card to one end of a narrow screen. */
export type Placed =
  | { docked: true; at: "top" | "bottom" }
  | { docked: false; top: number; left: number };

/** Screens narrower than this dock the card: there is no room beside an element. */
export const DOCK_BELOW_WIDTH = 640;

/** Space kept between the card and the element, and between the card and the screen edge. */
const GAP = 14;
const EDGE = 12;

function clamp(value: number, least: number, most: number): number {
  return Math.min(Math.max(value, least), Math.max(least, most));
}

/**
 * Under the element when there is room, else above it, else beside it. An element that
 * fills the screen leaves no room at all: the card then takes the lower right corner.
 * With no element to point at, the card is centered. On a narrow screen the card is
 * docked at the bottom, or at the top when the element sits in the lower half.
 */
export function placeCard(anchor: Box | null, card: Size, screen: Size): Placed {
  if (screen.width < DOCK_BELOW_WIDTH) {
    // At the end of the screen the element is not in, so that the card never hides it.
    const low = anchor !== null && anchor.top + anchor.height / 2 > screen.height / 2;
    return { docked: true, at: low ? "top" : "bottom" };
  }
  const mostLeft = screen.width - card.width - EDGE;
  const mostTop = screen.height - card.height - EDGE;
  if (!anchor) {
    return {
      docked: false,
      top: clamp((screen.height - card.height) / 2, EDGE, mostTop),
      left: clamp((screen.width - card.width) / 2, EDGE, mostLeft),
    };
  }
  const centered = clamp(anchor.left + anchor.width / 2 - card.width / 2, EDGE, mostLeft);
  const under = anchor.top + anchor.height + GAP;
  if (under + card.height + EDGE <= screen.height) {
    return { docked: false, top: Math.max(under, EDGE), left: centered };
  }
  const above = anchor.top - GAP - card.height;
  if (above >= EDGE) return { docked: false, top: above, left: centered };
  const level = clamp(anchor.top, EDGE, mostTop);
  const right = anchor.left + anchor.width + GAP;
  if (right + card.width + EDGE <= screen.width) return { docked: false, top: level, left: right };
  const left = anchor.left - GAP - card.width;
  if (left >= EDGE) return { docked: false, top: level, left };
  return { docked: false, top: mostTop - EDGE, left: mostLeft - EDGE };
}
