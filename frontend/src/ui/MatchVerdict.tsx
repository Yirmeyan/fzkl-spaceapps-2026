import { useEffect, useState } from "react";
import type { Candidate } from "../data/candidates";

interface MatchVerdictProps {
  candidates: Candidate[];
  catalogPmRa: number | null | undefined;
  catalogPmDec: number | null | undefined;
  targetName: string;
}

function catalogRateArcsecPerYear(
  pmRa: number | null | undefined,
  pmDec: number | null | undefined,
): number | null {
  const ra = pmRa ?? 0;
  const dec = pmDec ?? 0;
  if (ra === 0 && dec === 0) return null;
  return Math.hypot(ra, dec) / 1000;
}

/** Paint a shareable judge postcard: brand + sky still + measured vs catalog. */
function downloadSkyPostcard(targetName: string, verdictLine: string, agrees: boolean): boolean {
  const sky = document.querySelector<HTMLCanvasElement>(
    ".stage-measure > canvas, .stage-measure .sky-player canvas, .stage-measure canvas",
  );
  if (!sky || sky.width < 8) return false;

  const pad = 36;
  const skySize = 512;
  const footer = 118;
  const w = skySize + pad * 2;
  const h = pad + 52 + skySize + footer;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return false;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0b121f");
  bg.addColorStop(1, "#05080e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#f4f7fb";
  ctx.font = "700 28px Fraunces, Georgia, serif";
  ctx.fillText("SPHEREx Explorer", pad, pad + 28);
  ctx.fillStyle = "#93a4b8";
  ctx.font = "500 14px Segoe UI, system-ui, sans-serif";
  ctx.fillText(targetName, pad, pad + 48);

  const boxY = pad + 60;
  ctx.fillStyle = "#05080e";
  ctx.fillRect(pad - 4, boxY - 4, skySize + 8, skySize + 8);
  ctx.drawImage(sky, pad, boxY, skySize, skySize);

  const textY = boxY + skySize + 28;
  ctx.fillStyle = agrees ? "#6ee7b7" : "#fdba74";
  ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
  ctx.fillText("MEASURED VS CATALOG", pad, textY);
  ctx.fillStyle = "#e8eef7";
  ctx.font = "500 15px Segoe UI, system-ui, sans-serif";
  const words = verdictLine.split(" ");
  let line = "";
  let y = textY + 22;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > skySize && line) {
      ctx.fillText(line, pad, y);
      line = word;
      y += 20;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, pad, y);
  ctx.fillStyle = "#6b7c90";
  ctx.font = "500 12px Segoe UI, system-ui, sans-serif";
  ctx.fillText("NASA Space Apps 2026 · real SPHEREx cutouts", pad, h - 18);

  const a = document.createElement("a");
  const slug = targetName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  a.download = `spherex-${slug || "postcard"}.png`;
  a.href = out.toDataURL("image/png");
  a.click();
  return true;
}

/**
 * Stage stamp: SPHEREx-measured proper motion next to the catalog rate.
 * Shareable judge moment when they agree (Tommy panel line, lifted onto the sky).
 */
export function MatchVerdict({
  candidates,
  catalogPmRa,
  catalogPmDec,
  targetName,
}: MatchVerdictProps) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const target = candidates.find((c) => c.is_target && c.kind === "moved" && c.motion);
  const catalog = catalogRateArcsecPerYear(catalogPmRa, catalogPmDec);
  const measured = target?.motion?.rate_arcsec_per_year ?? null;
  const err = target?.motion?.rate_error_arcsec_per_year ?? null;

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(t);
  }, [saved]);

  if (measured == null || catalog == null || err == null) return null;

  const delta = Math.abs(measured - catalog);
  const agrees = delta <= Math.max(3 * err, 0.15 * catalog);
  const line = `${targetName}: SPHEREx ${measured.toFixed(2)} ± ${err.toFixed(2)}″/yr · Catalog ${catalog.toFixed(2)}″/yr${agrees ? " · they agree" : ""}`;

  return (
    <div className={`match-verdict${agrees ? " match-verdict--agree" : ""}`} role="status">
      <p className="match-verdict-kicker">Measured vs catalog</p>
      <p className="match-verdict-line">
        SPHEREx{" "}
        <strong>
          {measured.toFixed(2)} ± {err.toFixed(2)}″/yr
        </strong>
        <span className="match-verdict-sep">·</span>
        Catalog <strong>{catalog.toFixed(2)}″/yr</strong>
        {agrees && <span className="match-verdict-agree"> · they agree</span>}
      </p>
      <div className="match-verdict-actions">
        <button
          type="button"
          className="match-verdict-copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(line);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy verdict"}
        </button>
        <button
          type="button"
          className="match-verdict-copy match-verdict-postcard"
          title="Download a PNG of this sky and the measured vs catalog line"
          onClick={() => {
            const ok = downloadSkyPostcard(targetName, line, agrees);
            setSaved(ok);
          }}
        >
          {saved ? "Saved" : "Save postcard"}
        </button>
      </div>
    </div>
  );
}
