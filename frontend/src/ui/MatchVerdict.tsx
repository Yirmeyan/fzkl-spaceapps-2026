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
  const target = candidates.find((c) => c.is_target && c.kind === "moved" && c.motion);
  const catalog = catalogRateArcsecPerYear(catalogPmRa, catalogPmDec);
  const measured = target?.motion?.rate_arcsec_per_year ?? null;
  const err = target?.motion?.rate_error_arcsec_per_year ?? null;

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

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
    </div>
  );
}
