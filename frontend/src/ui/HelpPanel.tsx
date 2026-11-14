interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

export function HelpPanel({ open, onClose }: HelpPanelProps) {
  if (!open) return null;
  return (
    <aside className="help-panel" role="dialog" aria-label="How to use this tool">
      <header>
        <h2>Three-minute classroom demo</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close help">
          Close
        </button>
      </header>
      <ol>
        <li>
          Open <strong>Barnard's Star</strong> — the fastest-moving nearby star.
        </li>
        <li>
          Press <strong>Play movie</strong>. You are walking through infrared “colors” the eye cannot
          see.
        </li>
        <li>
          Press <strong>Blink visits</strong>. The star jumps north between Visit 1 and Visit 3 while
          background stars stay put. That jump is real motion through space.
        </li>
        <li>
          Try <strong>Show the move</strong> (difference). A bright/dark pair means “it moved.”
        </li>
        <li>
          Use <strong>Fullscreen</strong> for the whole class. Technical numbers live under{" "}
          <strong>Details for teachers</strong>.
        </li>
      </ol>
      <p className="help-foot">
        Data: NASA SPHEREx. Challenge: Planet X and SPHEREx · Space Apps 2026 · team FZKL.
      </p>
    </aside>
  );
}
