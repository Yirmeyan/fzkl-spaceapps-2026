/** Known challenge test targets. Bundle paths come from samples/index.json (B6/B4). */

export interface KnownTarget {
  key: string;
  label: string;
  /** Short why-it-matters line for newcomers */
  blurb: string;
  /**
   * Legacy single-file fallback. Prefer samples/index.json via sampleIndex.ts.
   * Kept so Barnard still works if the index is missing.
   */
  bundleUrl: string | null;
  /**
   * Optional fixed coordinates. Prefer index.json `target` (Tommy Need 15:14):
   * WISE 0855 in an old catalogue epoch is wrong by ~2 arcmin without PM.
   */
  ra?: number;
  dec?: number;
  pm_ra?: number;
  pm_dec?: number;
  /** True when samples/index.json ships this target (B4 five-target set). */
  inSampleIndex: boolean;
  /** Made-up body on real frames (Tommy #79). Must be labeled SYNTHETIC everywhere. */
  synthetic?: boolean;
}

export const KNOWN_TARGETS: KnownTarget[] = [
  {
    key: "barnard",
    label: "Barnard's Star",
    blurb: "A nearby star that moves fast. Watch it change place between visits.",
    bundleUrl: `${import.meta.env.BASE_URL}samples/barnard-star-d2.json`,
    // Index also has these; kept as offline fallback only.
    ra: 269.452077,
    dec: 4.693365,
    pm_ra: -801.551,
    pm_dec: 10362.394,
    inSampleIndex: true,
  },
  {
    key: "epsindi",
    label: "Epsilon Indi B",
    blurb:
      "Brown dwarfs, objects too small to shine like stars. Their infrared colors give them away.",
    bundleUrl: null,
    inSampleIndex: true,
  },
  {
    key: "wise0855",
    label: "WISE 0855",
    blurb:
      "One of the coldest and faintest neighbors of the Sun, at the limit of what SPHEREx can see.",
    bundleUrl: null,
    // Do not hardcode 2010 sky position. Use index.json target (has proper motion).
    inSampleIndex: true,
  },
  {
    key: "rwaur",
    label: "RW Aurigae",
    blurb: "A young star whose brightness changes from one visit to the next.",
    bundleUrl: null,
    inSampleIndex: true,
  },
  {
    key: "rdra",
    label: "R Draconis",
    blurb:
      "A giant star so bright that it saturates the detectors. A test of the limits of the tool.",
    bundleUrl: null,
    inSampleIndex: true,
  },
  {
    key: "synthx",
    label: "Synthetic Planet X",
    blurb:
      "SYNTHETIC: not a real object. A made-up moving dot added to real SPHEREx images, to show what a distant planet would look like here.",
    bundleUrl: null,
    inSampleIndex: true,
    synthetic: true,
  },
];

export function targetByKey(key: string): KnownTarget | undefined {
  return KNOWN_TARGETS.find((t) => t.key === key);
}

/** One-line stage tip: what this preset is for (Tommy B4). */
export const TARGET_MISSION_TIP: Record<string, string> = {
  barnard: "The mover: watch the bright core hop between visits.",
  epsindi: "The spectrum: open Infrared timeline for water and methane bands.",
  wise0855: "The faint one: single frames hide it. Try More, then Average stack on D6.",
  rwaur: "The variable: compare visits. The spectrum curves cross by pass.",
  rdra: "The saturated one: images only. Too bright for a flux number.",
  synthx: "SYNTHETIC TEST: a made-up body on real frames. Step visits on detector 6 to see it hop.",
};
