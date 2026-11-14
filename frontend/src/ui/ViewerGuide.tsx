interface ViewerGuideProps {
  targetName?: string;
  mode: "watch" | "blink" | "difference" | "stack" | "track" | "blend" | "split";
}

/**
 * Short orientation for the active mode — under the transport, not competing
 * with measured "What moved" on the rail. Jury value: one tip, not a wall.
 */
export function ViewerGuide({ targetName, mode }: ViewerGuideProps) {
  const tip =
    mode === "difference"
      ? "White and black next to each other = the star moved between the two visits you picked."
      : mode === "blink"
        ? "Same infrared color on both visits — watch the bright blob hop. Background stars stay put."
        : mode === "blend"
          ? "Early and late visits are overlaid. The moving star shimmers; background stars stay put."
          : mode === "split"
            ? "Pick a visit for each panel. Same infrared color on both sides so the hop is easy to see."
            : mode === "stack"
              ? "Many frames averaged into one sharper still. Motion is blurred on purpose."
              : mode === "track"
                ? "Frames are aligned on the star so it stays centered while the sky drifts."
                : "Press Play to step through infrared colors, or Blink visits to see the hop.";

  return (
    <div className="viewer-guide">
      <p className="viewer-guide-title">
        {targetName ? `What you are looking at — ${targetName}` : "What you are looking at"}
      </p>
      <p className="viewer-guide-tip">{tip}</p>
    </div>
  );
}
