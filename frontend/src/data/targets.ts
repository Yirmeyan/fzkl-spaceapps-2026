/** Known challenge test targets and static bundle paths. */

export interface KnownTarget {
  key: string;
  label: string;
  /** Short why-it-matters line for newcomers */
  blurb: string;
  /** Static bundle URL when precomputed (B6). null = service only / not ready */
  bundleUrl: string | null;
  /** Optional fixed coordinates for search form defaults */
  ra?: number;
  dec?: number;
}

export const KNOWN_TARGETS: KnownTarget[] = [
  {
    key: "barnard",
    label: "Barnard's Star",
    blurb: "Fast nearby star — watch it jump between SPHEREx passes.",
    bundleUrl: `${import.meta.env.BASE_URL}samples/barnard-star-d2.json`,
    ra: 269.452077,
    dec: 4.693365,
  },
  {
    key: "epsindi",
    label: "Epsilon Indi B",
    blurb: "A pair of brown dwarfs orbiting a star.",
    bundleUrl: null,
  },
  {
    key: "wise0855",
    label: "WISE 0855",
    blurb: "Fast-moving brown dwarf near the detection limit.",
    bundleUrl: null,
    ra: 133.795129,
    dec: -7.245147,
  },
  {
    key: "rwaur",
    label: "RW Aurigae",
    blurb: "Variable star — brightness changes from pass to pass.",
    bundleUrl: null,
  },
  {
    key: "rdra",
    label: "R Draconis",
    blurb: "Variable star — good for light curves once unsaturated.",
    bundleUrl: null,
  },
];

export function targetByKey(key: string): KnownTarget | undefined {
  return KNOWN_TARGETS.find((t) => t.key === key);
}
