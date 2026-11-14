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
