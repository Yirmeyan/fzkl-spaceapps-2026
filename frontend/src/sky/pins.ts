/**
 * The pins of the sky map: what the journal lists, drawn where it is on the sky.
 *
 * Two lists feed them. `samples/journal.json` holds what our own checks found, and the
 * service holds the marks visitors shared. Both come from outside the page: every entry
 * is checked before it becomes a pin, and one that is not what the contract describes
 * is left out.
 */

export type PinStatus = "confirmed" | "unconfirmed" | "synthetic";

/** The target a pin opens in the explorer, as the explorer takes it. */
export interface PinTarget {
  ra: number;
  dec: number;
  epoch: number;
  pm_ra: number;
  pm_dec: number;
}

export interface Pin {
  id: string;
  name: string;
  /** Where the finding is on the sky, in degrees. */
  ra: number;
  dec: number;
  status: PinStatus;
  /** True for a mark a visitor shared: nothing was measured there yet. */
  shared: boolean;
  /** What to say of it, in one sentence. */
  said: string;
  /** What catalogs say of it, when they say something. */
  known: string | null;
  /** Key of the static target that holds it, when there is one. */
  preset: string | null;
  target: PinTarget;
}

const STATUSES: readonly string[] = ["confirmed", "unconfirmed", "synthetic"];

// What a visitor chose in the list, said as a sentence.
const SHARED_AS: Record<string, string> = {
  moved: "A visitor saw something move here.",
  changed: "A visitor saw something change brightness here.",
  "appears-once": "A visitor saw something appear once here.",
  other: "A visitor marked this place.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function onTheSky(ra: unknown, dec: unknown): boolean {
  return finite(ra) && finite(dec) && ra >= 0 && ra < 360 && dec >= -90 && dec <= 90;
}

function targetFrom(value: unknown): PinTarget | null {
  if (!isRecord(value) || !onTheSky(value.ra, value.dec)) {
    return null;
  }
  return {
    ra: value.ra as number,
    dec: value.dec as number,
    epoch: finite(value.epoch) ? value.epoch : 2000,
    pm_ra: finite(value.pm_ra) ? value.pm_ra : 0,
    pm_dec: finite(value.pm_dec) ? value.pm_dec : 0,
  };
}

/** One entry of the journal as a pin, or null when it is not one. */
export function pinFrom(entry: unknown): Pin | null {
  if (!isRecord(entry)) {
    return null;
  }
  const target = targetFrom(entry.target);
  const status = entry.status;
  if (
    typeof entry.id !== "string" ||
    typeof entry.name !== "string" ||
    typeof status !== "string" ||
    !STATUSES.includes(status) ||
    !onTheSky(entry.ra, entry.dec) ||
    target === null
  ) {
    return null;
  }
  const shared = entry.source === "visitor";
  const category = typeof entry.category === "string" ? entry.category : "other";
  const found = typeof entry.found === "string" ? entry.found : "";
  return {
    id: entry.id,
    name: entry.name,
    ra: entry.ra as number,
    dec: entry.dec as number,
    status: status as PinStatus,
    shared,
    said: shared ? `${SHARED_AS[category] ?? SHARED_AS.other} Not measured yet.` : found,
    known: typeof entry.known === "string" ? entry.known : null,
    preset: typeof entry.preset === "string" ? entry.preset : null,
    target,
  };
}

/**
 * The pins of the two lists: `entries` of `journal.json`, then `entries` of the service.
 * A list that is missing or not a list gives no pin, and an identifier is drawn once.
 */
export function pinsFrom(...lists: unknown[]): Pin[] {
  const pins: Pin[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      const pin = pinFrom(entry);
      if (pin !== null && !seen.has(pin.id)) {
        seen.add(pin.id);
        pins.push(pin);
      }
    }
  }
  return pins;
}

/**
 * Address of the explorer opened on a pin.
 *
 * A static target opens by its key. Any other pin opens on the target of its field, with
 * the proper motion the journal gives: a fast star is not where its catalog position
 * says, and the explorer needs its motion to follow it.
 */
export function pinLink(pin: Pin, home: string): string {
  const asked = new URLSearchParams();
  if (pin.preset !== null) {
    asked.set("target", pin.preset);
    return `${home}?${asked.toString()}`;
  }
  asked.set("ra", String(pin.target.ra));
  asked.set("dec", String(pin.target.dec));
  if (pin.target.pm_ra !== 0 || pin.target.pm_dec !== 0) {
    asked.set("epoch", String(pin.target.epoch));
    asked.set("pm_ra", String(pin.target.pm_ra));
    asked.set("pm_dec", String(pin.target.pm_dec));
  }
  return `${home}?${asked.toString()}`;
}

/** The word shown on a pin and on its card. */
export function statusLabel(pin: Pin): string {
  if (pin.status === "synthetic") {
    return "SYNTHETIC";
  }
  if (pin.shared) {
    return "Shared by a visitor";
  }
  return pin.status === "confirmed" ? "Confirmed by a catalog" : "Unconfirmed";
}
