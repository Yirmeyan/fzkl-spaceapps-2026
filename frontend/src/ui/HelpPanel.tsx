interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

export function HelpPanel({ open, onClose }: HelpPanelProps) {
  if (!open) return null;
  return (
    <aside className="help-panel" role="dialog" aria-label="How to use this tool">
      <header>
        <h2>See the star move in one minute</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close help">
          Close
        </button>
      </header>
      <ol>
        <li>
          Open <strong>Barnard's Star</strong> — the fastest-moving nearby star.
        </li>
        <li>
          Press <strong>Play movie</strong>. You walk through infrared “colors” the eye cannot see.
        </li>
        <li>
          Press <strong>Blink visits</strong>. The star jumps north between Visit 1 and Visit 3 while
          background stars stay put. That jump is real motion through space.
        </li>
        <li>
          Try <strong>Show the move</strong>. A bright/dark pair means “it moved.”
        </li>
        <li>
          Use <strong>Fullscreen</strong> when showing others. Numbers live under{" "}
          <strong>Technical details</strong> if you want them.
        </li>
        <li>
          Keys: <strong>J</strong> auto demo · <strong>S</strong> side-by-side ·{" "}
          <strong>Space</strong> play · <strong>B</strong> blink · <strong>D</strong> difference ·{" "}
          <strong>F</strong> fullscreen · <strong>?</strong> help.
        </li>
      </ol>
      <p className="help-foot">
        Data: NASA SPHEREx. Challenge: Planet X and SPHEREx · Space Apps 2026 · team FZKL.
      </p>
    </aside>
  );
}
