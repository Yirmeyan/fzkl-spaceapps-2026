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
          Press <strong>Blink visits</strong>. The star jumps between Visit 1 and Visit 3 while
          background stars stay put.
        </li>
        <li>
          Try <strong>Blend visits</strong> — early and late images together so the hop is obvious —
          or <strong>Show the move</strong> for a bright/dark difference pair.
        </li>
        <li>
          The right panel summarizes the hop. Trust the bright core in the image; the orange path is
          a catalogue guide. Hover any button for a short tip.
        </li>
      </ol>
      <p className="help-foot">
        Keys: <strong>J</strong> demo · <strong>G</strong> blend visits · <strong>S</strong>{" "}
        side-by-side · <strong>B</strong> blink · <strong>D</strong> difference · <strong>F</strong>{" "}
        fullscreen. Data: NASA SPHEREx · Space Apps 2026 · FZKL.
      </p>
    </aside>
  );
}
