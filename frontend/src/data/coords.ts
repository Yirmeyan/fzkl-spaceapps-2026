import type { Target } from "./contract";

/**
 * Parse a sky search string into RA/Dec degrees.
 * Accepts decimal degrees, or sexagesimal RA (hours) + Dec.
 */
export function parseCoordinateQuery(raw: string): Target | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;

  // Two plain numbers → already degrees
  const decimal = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (decimal) {
    return targetFromDegrees(Number(decimal[1]), Number(decimal[2]));
  }

  const parts = splitRaDec(trimmed);
  if (!parts) return null;
  const ra = parseSexagesimal(parts.ra, "hours");
  const dec = parseSexagesimal(parts.dec, "degrees");
  if (ra == null || dec == null) return null;
  return targetFromDegrees(ra, dec);
}

function targetFromDegrees(ra: number, dec: number): Target | null {
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  if (ra < 0 || ra >= 360) return null;
  if (dec < -90 || dec > 90) return null;
  return { ra, dec, epoch: 2000.0, pm_ra: null, pm_dec: null };
}

/** Split "RA Dec" allowing h/m/s or : or spaces inside each side. */
function splitRaDec(s: string): { ra: string; dec: string } | null {
  const comma = s.indexOf(",");
  if (comma >= 0) {
    const ra = s.slice(0, comma).trim();
    const dec = s.slice(comma + 1).trim();
    return ra && dec ? { ra, dec } : null;
  }
  // Dec starts with an explicit sign
  const signed = s.match(/^(.+?)\s+([+-].+)$/);
  if (signed?.[1] && signed[2]) return { ra: signed[1].trim(), dec: signed[2].trim() };

  const tokens = s.split(/\s+/);
  if (tokens.length === 6) {
    return { ra: tokens.slice(0, 3).join(" "), dec: tokens.slice(3).join(" ") };
  }
  if (tokens.length === 2) {
    return { ra: tokens[0]!, dec: tokens[1]! };
  }
  return null;
}

/**
 * Sexagesimal → degrees.
 * hours: 15 × (h + m/60 + s/3600). degrees: sign × (d + m/60 + s/3600).
 * Keeps the sign of values like -0d30m / -00 30 00.
 */
function parseSexagesimal(raw: string, mode: "hours" | "degrees"): number | null {
  const s = raw.trim();

  if (mode === "hours" && /h/i.test(s)) {
    const m = s.match(/^([+-])?(\d+(?:\.\d+)?)h(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
    if (!m) return null;
    const sign = m[1] === "-" ? -1 : 1;
    const mag = Number(m[2]) + Number(m[3] ?? 0) / 60 + Number(m[4] ?? 0) / 3600;
    return sign * 15 * mag;
  }

  if (mode === "degrees" && /d/i.test(s)) {
    const m = s.match(/^([+-])?(\d+(?:\.\d+)?)d(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
    if (!m) return null;
    const sign = m[1] === "-" ? -1 : 1;
    const mag = Number(m[2]) + Number(m[3] ?? 0) / 60 + Number(m[4] ?? 0) / 3600;
    return sign * mag;
  }

  // Colon or space separated: ±A B C
  const three = s.match(/^([+-])?(\d+(?:\.\d+)?)[:\s]+(\d+(?:\.\d+)?)[:\s]+(\d+(?:\.\d+)?)$/);
  if (three) {
    const sign = three[1] === "-" ? -1 : 1;
    const mag = Number(three[2]) + Number(three[3]) / 60 + Number(three[4]) / 3600;
    return mode === "hours" ? sign * 15 * mag : sign * mag;
  }

  const two = s.match(/^([+-])?(\d+(?:\.\d+)?)[:\s]+(\d+(?:\.\d+)?)$/);
  if (two) {
    const sign = two[1] === "-" ? -1 : 1;
    const mag = Number(two[2]) + Number(two[3]) / 60;
    return mode === "hours" ? sign * 15 * mag : sign * mag;
  }

  return null;
}
