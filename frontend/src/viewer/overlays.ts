import type { Candidate, SaturatedStar } from "../data/candidates";
import { candidateXyForPass } from "../data/candidates";
import type { Grid } from "../data/contract";
import { skyToPixel } from "../data/contract";

/** Catalogue marker + pass trail (big numbered beads, not stick-figure crosses). */

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
  ctx.beginPath();
  ctx.arc(tx, ty, 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Rings + motion arrows for service candidates (Tommy addition A).
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
    const xy = candidateXyForPass(c, currentPass);
    const [cx, cy] = sameGrid ? xy : skyToPixel(viewGrid, c.ra, c.dec);
    const color = c.kind === "changed" ? "#38bdf8" : "#fbbf24";

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
