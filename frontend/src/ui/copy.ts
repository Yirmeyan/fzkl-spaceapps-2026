/**
 * The words of the explorer, in one place.
 *
 * One vocabulary for a newcomer: visit, detector, infrared color. Each control has a label
 * and one sentence that says what it does. The sentence is the title of its button, and
 * the one of the selected option is shown under its group: a phone has no hover.
 * Reference: docs/ui-copy.md.
 */

export interface Words {
  /** What the button says. */
  label: string;
  /** One sentence in plain English: what it does. */
  hint: string;
}

export const TOP = {
  journal: { label: "Journal", hint: "What our search and other visitors have found so far." },
  skyMap: {
    label: "Sky map",
    hint: "The whole sky as SPHEREx sees it. Click a place to open it here.",
  },
  copyLink: {
    label: "Copy link",
    hint: "Copy the address of exactly what you see, to send it to someone.",
  },
  howItWorks: { label: "How it works", hint: "Reopen the introduction." },
  guidedTour: {
    label: "Guided tour",
    hint: "Nine short steps, from the sky map to this page. You only press Next.",
  },
} satisfies Record<string, Words>;

export const EXAMPLES = {
  label: "Five places to try, and one made-up example",
  /** Shown when the place comes from the search, the sky map or a link. */
  typed: "A place you chose. Its images come straight from the SPHEREx archive.",
};

export type Way = "watch" | "compare" | "difference" | "more";

export const WAYS: Record<Way, Words> = {
  watch: {
    label: "Watch",
    hint: "Play the images one after the other. Each one is a slightly different infrared color.",
  },
  compare: {
    label: "Blink",
    hint: "Flip between the first and the last visit. What jumps has moved.",
  },
  difference: {
    label: "Subtract",
    hint: "Subtract one visit from another. What stayed put disappears. What moved leaves a bright spot next to a dark one.",
  },
  more: {
    label: "Average",
    hint: "Average the images of a visit. Faint objects such as WISE 0855 come out of the noise.",
  },
};

export const PLAYER = {
  overlay: {
    label: "Overlay",
    hint: "Show the first and the last visit on top of each other (G).",
  },
  sideBySide: { label: "Side by side", hint: "Show two visits next to each other (S)." },
} satisfies Record<string, Words>;

export const STRIP = {
  label: "First visit, difference, last visit",
  hint: "Tap a picture to show it large.",
  difference: "Difference",
};

/** What is worth knowing about a detector beyond its range of colors. */
const DETECTOR_NOTES: Record<number, string> = {
  1: " The closest to visible light.",
  5: " Cold objects start to glow here.",
  6: " The coldest objects are brightest here.",
};

export const DETECTORS = {
  label: "Detectors",
  all: { label: "All detectors", hint: "Use the images of all six detectors." },
  group:
    "SPHEREx has six detectors, like six cameras behind one telescope. Each sees a different range of infrared colors. The coldest objects show up mostly in detectors 5 and 6.",
  /** Written before the number of a detector where there is room for it. */
  word: "Detector",
  hint: (detector: number, shortest: number, longest: number, images: number) =>
    `Detector ${detector}: colors from ${shortest.toFixed(2)} to ${longest.toFixed(2)} µm, ${images} images of this place.${DETECTOR_NOTES[detector] ?? ""}`,
};

export const VISITS = {
  label: "Visit",
  all: { label: "All visits", hint: "Use the images of every visit." },
  one: (visit: number): Words => ({
    label: String(visit),
    hint: `Use the images of visit ${visit} only.`,
  }),
};

export type Combine = "single" | "stack" | "difference" | "track";

export const COMBINE = {
  label: "How images are combined",
  options: {
    single: { label: "One image", hint: "One image at a time." },
    stack: {
      label: "Average",
      hint: "Average the images of a visit. Faint objects come out of the noise.",
    },
    difference: { label: "Subtract", hint: WAYS.difference.hint },
    track: {
      label: "Follow the target",
      hint: "Average the images while following the motion of the target. What moves with it stays sharp, and the fixed stars smear.",
    },
  } satisfies Record<Combine, Words>,
  averageThisVisit: "Average this visit",
  averageMovie: {
    label: "Average of each visit",
    hint: "The average of each visit, one after the other, then the last minus the first.",
  },
};

export const COLORS = {
  label: "Infrared colors",
  all: { label: "All colors", hint: "Play every infrared color." },
  thisOne: {
    label: "This color only",
    hint: "Keep the images close to the color shown, so that visits compare like with like.",
  },
} satisfies Record<string, Words | string>;

export const CONTRAST = {
  label: "Contrast",
  hint: "Slide to bring out faint details, or to tame bright ones.",
};

export const PALETTE = {
  label: "Colors of the picture",
  heat: {
    label: "Heat",
    hint: "Black to yellow, like a thermal camera. These colors are a choice: infrared has none.",
  },
  gray: { label: "Gray", hint: "Black to white." },
} satisfies Record<string, Words | string>;

export const LOOK = {
  label: "Look",
  smooth: { label: "Smooth", hint: "A smoothed picture, easier on the eye." },
  pixels: { label: "Pixels", hint: "The true square pixels of the detector." },
  path: {
    hint: "Draw where the object was at each visit.",
    on: "The path shows where the object was at each visit.",
  },
};

export const SIZE = {
  label: "Size of the picture",
  close: {
    label: "Close · 0.1°",
    hint: "A tenth of a degree across, a fifth of the width of the full Moon.",
  },
  wide: {
    label: "Wide · 0.3°",
    hint: "Three times wider on the sky, same square on screen. It takes longer to load.",
  },
} satisfies Record<string, Words | string>;

export const SURVEYS = {
  label: "Compare with other surveys",
  group: "Draw over the picture what other telescopes measured at this place.",
  gaia: { label: "Gaia stars", hint: "Circle the stars measured by the Gaia space telescope." },
  wise: {
    label: "WISE in 2010",
    hint: "Show where the WISE telescope saw these objects around 2010.",
  },
  path: { label: "Path since 2010", hint: "Draw the path from the 2010 position to today." },
  years: { label: "Play the years", hint: "Animate the years between 2010 and now." },
  legendGaia:
    "Purple ring: a star of the Gaia catalog, placed where it is at the date of this image.",
  legendWise: "Green ring: an object of the WISE catalog, where it was in 2010.",
  legendGap: "A green ring left behind its star means that the star has moved since 2010.",
  legendBlank: "Gray hatching: no data in this image.",
  legendMost: "Only the 100 brightest of each catalog are drawn.",
} satisfies Record<string, Words | string>;

export const FLAGS = {
  label: "Show unreliable pixels",
  hint: "Tint in pink the pixels that SPHEREx itself flags as unreliable, for example saturated ones.",
  on: "On: the pink pixels are the ones SPHEREx flags as unreliable.",
  off: "Turn on Show unreliable pixels to see them on the image.",
};

export const FOUND = {
  open: { label: "Open this object", hint: "Center the tool on this object and load its colors." },
  panel: {
    label: "What the tool found here",
    hint: "Objects that changed place or brightness between visits, measured automatically.",
  },
} satisfies Record<string, Words>;

export const ADVANCED: Words = {
  label: "Advanced tools",
  hint: "Every setting of the picture: visits, colors, contrast, size, other surveys.",
};

export const PANELS = {
  sky: "Where this is on the sky",
  timeline: "Colors and brightness over time",
};

export const PLACE = {
  hint: "The place on the sky you are looking at. The cross marks it.",
  coordinates: (ra: number, dec: number) =>
    `RA ${ra.toFixed(4)}° · Dec ${dec >= 0 ? "+" : "−"}${Math.abs(dec).toFixed(4)}°`,
  visits: (count: number) => (count === 1 ? "1 visit" : `${count} visits`),
};
