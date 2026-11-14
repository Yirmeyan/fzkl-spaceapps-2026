/** Catalog / proper-motion marker + optional pass trail. */

export interface TrailPoint {
  pass: number;
  x: number;
  y: number;
}

const PASS_COLORS = ["#7dd3fc", "#fbbf24", "#f472b6", "#a3e635"];

export function drawTargetOverlay(
  ctx: CanvasRenderingContext2D,
  targetXy: [number, number],
  trail: TrailPoint[] = [],
): void {
  if (trail.length > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    trail.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of trail) {
      const color = PASS_COLORS[(p.pass - 1) % PASS_COLORS.length]!;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = "7px sans-serif";
      ctx.fillText(`P${p.pass}`, p.x + 3.5, p.y - 2.5);
    }
    ctx.restore();
  }

  const [tx, ty] = targetXy;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 176, 64, 0.95)";
  ctx.lineWidth = 1;
  const r = 4;
  ctx.beginPath();
  ctx.moveTo(tx - r, ty);
  ctx.lineTo(tx + r, ty);
  ctx.moveTo(tx, ty - r);
  ctx.lineTo(tx, ty + r);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 176, 64, 0.9)";
  ctx.font = "7px sans-serif";
  ctx.fillText("cat", tx + 5, ty + 9);
  ctx.restore();
}
