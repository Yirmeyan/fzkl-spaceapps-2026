/** A place of the sky, written for a person and turned into a link to the explorer. */

const HOURS_PER_DEGREE = 1 / 15;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** Right ascension and declination as astronomers write them: 17h45m40.0s -29°00'28". */
export function sexagesimal(ra: number, dec: number): string {
  const turned = ((ra % 360) + 360) % 360;
  const tenths = Math.round(turned * HOURS_PER_DEGREE * 36000) % (24 * 36000);
  const hours = Math.floor(tenths / 36000);
  const minutes = Math.floor((tenths % 36000) / 600);
  const seconds = (tenths % 600) / 10;
  const arcseconds = Math.round(Math.abs(dec) * 3600);
  const degrees = Math.floor(arcseconds / 3600);
  const arcminutes = Math.floor((arcseconds % 3600) / 60);
  const sign = dec < 0 ? "-" : "+";
  const time = `${twoDigits(hours)}h${twoDigits(minutes)}m${seconds.toFixed(1).padStart(4, "0")}s`;
  const angle = `${sign}${twoDigits(degrees)}°${twoDigits(arcminutes)}'${twoDigits(arcseconds % 60)}"`;
  return `${time} ${angle}`;
}

/** The same place in degrees, as the explorer takes it. */
export function inDegrees(ra: number, dec: number): string {
  return `${ra.toFixed(4)}, ${dec >= 0 ? "+" : ""}${dec.toFixed(4)}`;
}

/**
 * Address of the explorer opened on a place.
 *
 * `home` is the address of the explorer itself: the map lives beside it.
 */
export function explorerLink(ra: number, dec: number, home: string): string {
  const asked = new URLSearchParams();
  asked.set("ra", String(Number(ra.toFixed(5))));
  asked.set("dec", String(Number(dec.toFixed(5))));
  return `${home}?${asked.toString()}`;
}

/** True when a pair of numbers is a place of the sky. */
export function isPlace(ra: number, dec: number): boolean {
  return Number.isFinite(ra) && Number.isFinite(dec) && dec >= -90 && dec <= 90;
}
