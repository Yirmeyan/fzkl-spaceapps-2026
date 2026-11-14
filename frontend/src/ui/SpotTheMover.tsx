import { type MouseEvent, useId, useState } from "react";
import type { ColorMap, Grid } from "../data/contract";
import { FrameCanvas } from "../viewer/FrameCanvas";
import type { TrailPoint } from "../viewer/overlays";

interface SpotTheMoverProps {
  size: number;
  lo: number;
  hi: number;
  colorMap: ColorMap;
  displayPx: number;
  grid: Grid;
  early: { pixels: Float32Array; mask: Uint8Array; label: string };
  late: { pixels: Float32Array; mask: Uint8Array; label: string };
  trail: TrailPoint[];
  onExit: () => void;
}

/**
 * Click where you think the mover ends up. then reveal catalogue trail.
 */
export function SpotTheMover({
  size,
  lo,
  hi,
  colorMap,
  displayPx,
  grid,
  early,
  late,
  trail,
  onExit,
}: SpotTheMoverProps) {
  const titleId = useId();
  const [guess, setGuess] = useState<{ x: number; y: number } | null>(null);
  const [revealed, setRevealed] = useState(false);

  const start = trail[0];
  const end = trail[trail.length - 1];
  if (!start || !end || trail.length < 2) return null;

  const arcsecPerPx = (grid.fov_deg / grid.size) * 3600;

  function onBoardClick(e: MouseEvent<HTMLButtonElement>) {
    if (revealed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * size;
    const y = ((e.clientY - rect.top) / rect.height) * size;
    setGuess({ x, y });
    setRevealed(true);
  }

  const missArcsec =
    guess != null ? Math.hypot(guess.x - end.x, guess.y - end.y) * arcsecPerPx : null;

  const grade =
    missArcsec == null
      ? null
      : missArcsec < 2
        ? { label: "Bullseye", tone: "good" as const }
        : missArcsec < 6
          ? { label: "Close", tone: "ok" as const }
          : { label: "Keep looking", tone: "soft" as const };

  return (
    <aside className="spot-mover" aria-labelledby={titleId}>
      <div className="spot-mover-head">
        <div>
          <p className="spot-mover-kicker">Challenge</p>
          <h3 id={titleId} className="spot-mover-title">
            Spot the mover
          </h3>
          <p className="spot-mover-hint">
            {revealed
              ? "Reveal on. orange is your tap, cyan beads are the real path."
              : `Tap where Visit ${end.pass} puts the star (starts near Visit ${start.pass}).`}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onExit}>
          Exit
        </button>
      </div>

      <div className="spot-mover-board-wrap" style={{ width: displayPx, height: displayPx }}>
        <button
          type="button"
          className="spot-mover-board"
          onClick={onBoardClick}
          disabled={revealed}
          aria-label={
            revealed ? "Challenge revealed" : "Tap the image where you think the star moved"
          }
        >
          <FrameCanvas
            pixels={revealed ? late.pixels : early.pixels}
            mask={revealed ? late.mask : early.mask}
            size={size}
            lo={lo}
            hi={hi}
            background={0}
            colorMap={colorMap}
            targetXy={revealed ? [end.x, end.y] : [start.x, start.y]}
            trail={revealed ? trail : [{ pass: start.pass, x: start.x, y: start.y }]}
            displayPx={displayPx}
          />
          {guess != null && (
            <span
              className="spot-guess"
              style={{
                left: `${(guess.x / size) * 100}%`,
                top: `${(guess.y / size) * 100}%`,
              }}
              aria-hidden
            />
          )}
        </button>
        {!revealed && <p className="spot-mover-prompt">Your move</p>}
      </div>

      {revealed && grade && missArcsec != null && (
        <p className={`spot-mover-result ${grade.tone}`}>
          <strong>{grade.label}</strong>. {missArcsec.toFixed(1)}″ from the Visit {end.pass}{" "}
          position ({early.label} → {late.label}).
        </p>
      )}

      {revealed && (
        <button
          type="button"
          className="primary"
          onClick={() => {
            setGuess(null);
            setRevealed(false);
          }}
        >
          Try again
        </button>
      )}
    </aside>
  );
}
