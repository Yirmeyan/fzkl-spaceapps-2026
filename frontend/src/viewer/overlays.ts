import type { Candidate, SaturatedStar } from "../data/candidates";
import { candidateXyForPass } from "../data/candidates";
import type { CatalogSlice, CatalogSource } from "../data/catalog";
import type { Grid } from "../data/contract";
import { skyToPixel, targetAt } from "../data/contract";

/** Catalog ring colors — distinct from candidate yellow/cyan. */
export const CATALOG_COLORS: Record<string, string> = {
  gaia: "#a78bfa",
  allwise: "#34d399",
};

/** Dashed trek from a past catalog epoch to where SPHEREx sees the object now. */
export interface FlightPath {
  from: [number, number];
  to: [number, number];
  label: string;
  sourceId?: string;
  fromYear: number;
  toYear: number;
}

/**
 * Draw the AllWISE→now trek.
 * `scrubT` 0 = 2010 bead, 1 = now (default). Judges can drag years along the path.
 */
export function drawFlightPath(ctx: CanvasRenderingContext2D, path: FlightPath, scrubT = 1): void {
  const [x0, y0] = path.from;
  const [x1, y1] = path.to;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const t = Math.min(1, Math.max(0, scrubT));

  ctx.save();
  ctx.strokeStyle = "rgba(52, 211, 153, 0.95)";
  ctx.fillStyle = "rgba(52, 211, 153, 0.95)";
  ctx.lineWidth = 1.35;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);

  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(7, len * 0.28);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * head - uy * head * 0.55, y1 - uy * head + ux * head * 0.55);
  ctx.lineTo(x1 - ux * head + uy * head * 0.55, y1 - uy * head - ux * head * 0.55);
  ctx.closePath();
  ctx.fill();

  // Past epoch bead
  ctx.beginPath();
  ctx.arc(x0, y0, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#04120a";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Scrub bead — the year the judge is holding
  const sx = x0 + dx * t;
  const sy = y0 + dy * t;
  const year = path.fromYear + (path.toYear - path.fromYear) * t;
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.arc(sx, sy, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#04120a";
  ctx.lineWidth = 1;
  ctx.stroke();

  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  ctx.font = "bold 7px IBM Plex Sans, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(7, 11, 18, 0.85)";
  const scrubLabel = t < 0.98 ? `${year.toFixed(1)}` : path.label;
  ctx.strokeText(scrubLabel, t < 0.98 ? sx : mx, (t < 0.98 ? sy : my) - 5);
  ctx.fillStyle = "#e8eef6";
  ctx.fillText(scrubLabel, t < 0.98 ? sx : mx, (t < 0.98 ? sy : my) - 5);
  ctx.restore();
}

/** Angular separation in arcseconds (small-angle approx). */
export function sepArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const midDec = ((dec1 + dec2) / 2) * (Math.PI / 180);
  const dra = (ra1 - ra2) * Math.cos(midDec) * 3600;
  const ddec = (dec1 - dec2) * 3600;
  return Math.hypot(dra, ddec);
}

/**
 * Closest AllWISE source to the live target → flight path from 2010 coords to now.
 * Search radius 5′ (covers Barnard ~2.7′ and WISE 0855 ~2.1′).
 */
export function allwiseFlightPath(
  slice: CatalogSlice,
  targetRa: number,
  targetDec: number,
  nowXy: [number, number],
  viewGrid: Grid,
  nowEpochYear: number,
  maxArcmin = 5,
): FlightPath | null {
  let best: CatalogSource | null = null;
  let bestSep = Infinity;
  for (const s of slice.sources) {
    const sep = sepArcsec(s.ra, s.dec, targetRa, targetDec);
    if (sep < bestSep) {
      bestSep = sep;
      best = s;
    }
  }
  if (!best || bestSep > maxArcmin * 60) return null;

  const from = skyToPixel(viewGrid, best.ra, best.dec);
  const years = Math.max(0.1, nowEpochYear - slice.epoch);
  const rate = bestSep / years;
  const yearLabel = years >= 10 ? `${years.toFixed(0)} yr` : `${years.toFixed(1)} yr`;
  const rateLabel = rate >= 1 ? `${rate.toFixed(1)}″/yr` : `${rate.toFixed(2)}″/yr`;
  return {
    from,
    to: nowXy,
    label: `${yearLabel} · ${rateLabel}`,
    sourceId: best.id,
    fromYear: slice.epoch,
    toYear: nowEpochYear,
  };
}

/** Optional pass trail beads (off by default — sky stays cross-only). */

export interface TrailPoint {
  pass: number;
  x: number;
  y: number;
}

const PASS_COLORS = ["#38bdf8", "#fbbf24", "#fb7185"];

export function drawTargetOverlay(
  ctx: CanvasRenderingContext2D,
  targetXy: [number, number],
  trail: TrailPoint[] = [],
): void {
  if (trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    trail.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  for (const p of trail) {
    const color = PASS_COLORS[(p.pass - 1) % PASS_COLORS.length]!;
    ctx.save();
    ctx.fillStyle = "rgba(10, 16, 24, 0.75)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(p.pass), p.x + 7, p.y + 3);
    ctx.restore();
  }

  // Cross only — no ring around the star (human preference).
  const [tx, ty] = targetXy;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 196, 80, 0.95)";
  ctx.lineWidth = 1.4;
  const arm = 6;
  ctx.beginPath();
  ctx.moveTo(tx - arm, ty);
  ctx.lineTo(tx + arm, ty);
  ctx.moveTo(tx, ty - arm);
  ctx.lineTo(tx, ty + arm);
  ctx.stroke();
  ctx.restore();
}

/**
 * Rings + motion arrows for service candidates.
 * Uses track xy when the view grid matches the candidates file grid;
 * otherwise projects ra/dec through skyToPixel.
 */
export function drawCandidatesOverlay(
  ctx: CanvasRenderingContext2D,
  candidates: Candidate[],
  viewGrid: Grid,
  candidatesGrid: Grid,
  activeIndex: number | null,
  currentPass: number | null = null,
  saturated: SaturatedStar[] = [],
): void {
  const sameGrid =
    Math.abs(viewGrid.ra - candidatesGrid.ra) < 1e-6 &&
    Math.abs(viewGrid.dec - candidatesGrid.dec) < 1e-6 &&
    viewGrid.size === candidatesGrid.size &&
    Math.abs(viewGrid.fov_deg - candidatesGrid.fov_deg) < 1e-9;

  for (const s of saturated) {
    const [sx, sy] = sameGrid ? s.xy : skyToPixel(viewGrid, s.ra, s.dec);
    const rPx = (s.radius_arcsec / 3600 / viewGrid.fov_deg) * viewGrid.size;
    ctx.save();
    ctx.strokeStyle = "rgba(248, 113, 113, 0.7)";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(4, rPx), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(248, 113, 113, 0.85)";
    ctx.font = "6px sans-serif";
    ctx.fillText("sat", sx + Math.max(4, rPx) + 2, sy + 2);
    ctx.restore();
  }

  candidates.forEach((c, i) => {
    const active = activeIndex === i;
    const color = c.kind === "changed" ? "#38bdf8" : c.kind === "swung" ? "#f472b6" : "#fbbf24";

    // Swung: ring the visit sighting (track), never the mean Sun-view xy; dashed path.
    if (c.kind === "swung" && c.track.length > 0) {
      const pts = c.track.map((t) => (sameGrid ? t.xy : skyToPixel(viewGrid, t.ra, t.dec)));
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = active ? 1.6 : 1.1;
      ctx.globalAlpha = active ? 0.95 : 0.7;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      pts.forEach(([x, y], j) => {
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      const sight = candidateXyForPass(c, currentPass);
      const [sx, sy] = sameGrid ? sight : skyToPixel(viewGrid, c.ra, c.dec);
      // Prefer track projection when grids differ
      const [rx, ry] =
        currentPass != null
          ? (() => {
              const hit = c.track.find((t) => t.pass === currentPass);
              return hit ? (sameGrid ? hit.xy : skyToPixel(viewGrid, hit.ra, hit.dec)) : [sx, sy];
            })()
          : pts[0]!;
      ctx.lineWidth = active ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.arc(rx, ry, active ? 9 : 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rx, ry, active ? 5 : 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const xy = candidateXyForPass(c, currentPass);
    const [cx, cy] = sameGrid ? xy : skyToPixel(viewGrid, c.ra, c.dec);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = active ? 2.2 : 1.4;
    ctx.globalAlpha = active ? 1 : 0.85;
    ctx.beginPath();
    ctx.arc(cx, cy, active ? 9 : 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, active ? 5 : 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Halo method: track.error_arcsec is the saturated-heart radius, not a
    // position uncertainty — draw it as a dashed heart ring, never an error bar.
    if (c.method === "halo" && c.track.length > 0) {
      const heart = c.track.find((t) => t.pass === currentPass) ?? c.track[0]!;
      const rPx = (heart.error_arcsec / 3600 / viewGrid.fov_deg) * viewGrid.size;
      ctx.save();
      ctx.strokeStyle = "rgba(56, 189, 248, 0.65)";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(6, rPx), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (c.kind === "moved" && c.track.length >= 2) {
      const first = c.track[0]!;
      const last = c.track[c.track.length - 1]!;
      const [x0, y0] = sameGrid ? first.xy : skyToPixel(viewGrid, first.ra, first.dec);
      const [x1, y1] = sameGrid ? last.xy : skyToPixel(viewGrid, last.ra, last.dec);
      drawArrow(ctx, x0, y0, x1, y1, color, active);
    }
  });
}

/**
 * Thin rings for Gaia / AllWISE sources, proper-motioned to the frame date.
 * Draw at most `maxDraw` brightest per catalog (already sorted by the service).
 */
export function drawCatalogOverlay(
  ctx: CanvasRenderingContext2D,
  slices: CatalogSlice[],
  enabledKeys: Set<string>,
  viewGrid: Grid,
  timeMjd: number,
  maxDraw = 100,
  highlightId: string | null = null,
): void {
  for (const slice of slices) {
    if (!enabledKeys.has(slice.key)) continue;
    const color = CATALOG_COLORS[slice.key] ?? "#e2e8f0";
    const list = slice.sources.slice(0, maxDraw);
    for (const s of list) {
      const [ra, dec] = targetAt(
        {
          ra: s.ra,
          dec: s.dec,
          epoch: slice.epoch,
          pm_ra: s.pm_ra,
          pm_dec: s.pm_dec,
        },
        timeMjd,
      );
      const [cx, cy] = skyToPixel(viewGrid, ra, dec);
      if (cx < -2 || cy < -2 || cx > viewGrid.size + 2 || cy > viewGrid.size + 2) continue;
      const hot = highlightId != null && highlightId === s.id;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = hot ? 1.8 : 1;
      ctx.globalAlpha = hot ? 1 : 0.75;
      ctx.beginPath();
      ctx.arc(cx, cy, hot ? 5.5 : 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  active: boolean,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(6, len * 0.35);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = active ? 2 : 1.4;
  ctx.globalAlpha = active ? 1 : 0.9;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * head - uy * head * 0.55, y1 - uy * head + ux * head * 0.55);
  ctx.lineTo(x1 - ux * head + uy * head * 0.55, y1 - uy * head - ux * head * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
