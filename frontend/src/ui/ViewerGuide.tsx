interface ViewerGuideProps {
  targetName?: string;
  mode: "watch" | "blink" | "difference" | "stack" | "track";
}

/** One short tip for the active mode — not a wall of jargon. */
export function ViewerGuide({ targetName, mode }: ViewerGuideProps) {
  const tip =
    mode === "difference"
      ? "White and black next to each other = the star moved between the two visits you picked."
      : mode === "blink"
        ? "Watch the bright blob hop. Background stars should barely move."
        : mode === "stack"
          ? "Many frames averaged into one sharper still. Motion is blurred on purpose."
          : mode === "track"
            ? "Frames are aligned on the star so it stays centered while the sky drifts."
            : "Press Play for infrared colors, Blink visits to see the hop, or Blend visits to overlay early and late.";

  return (
    <div className="viewer-guide">
      <p className="viewer-guide-title">
        {targetName ? `Looking at ${targetName}` : "Looking at the infrared sky"}
      </p>
      <p className="viewer-guide-tip">{tip}</p>
    </div>
  );
}
