interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

export function HelpPanel({ open, onClose }: HelpPanelProps) {
  if (!open) return null;
  return (
    <aside className="help-panel" role="dialog" aria-label="How to use this tool">
      <header>
        <h2>How to spot motion</h2>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close help">
          Close
        </button>
      </header>
      <ol>
        <li>
          Pick <strong>Barnard's Star</strong>. Press play. The bright core drifts north between
          passes while background stars stay put.
        </li>
        <li>
          Filter by <strong>pass</strong> to freeze one visit, or use <strong>difference</strong>{" "}
          mode to subtract two passes — movers light up.
        </li>
        <li>
          SPHEREx has no filter wheel: each frame is a different near-infrared wavelength. The strip
          under the charts is the spectrum timeline.
        </li>
        <li>
          Saturated cores show as bright (not holes). That is intentional — the star is too bright
          for the detector there.
        </li>
        <li>
          Share a link: the address bar stores the target, pass, frame, and mode so others see the
          same view.
        </li>
      </ol>
      <p className="help-foot">
        Data: NASA SPHEREx via IRSA. Challenge: Planet X and SPHEREx, NASA Space Apps 2026.
      </p>
    </aside>
  );
}
