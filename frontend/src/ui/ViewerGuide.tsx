interface ViewerGuideProps {
  targetName?: string;
  pass?: number | null;
  mode?: "watch" | "blink" | "difference" | "stack" | "track" | "blend" | "split";
}

/** Classic plain-language legend under the sky (compact). */
export function ViewerGuide({ targetName, pass = null }: ViewerGuideProps) {
  return (
    <div className="viewer-guide">
      <ul>
        <li>
          Near-infrared SPHEREx
          {targetName ? (
            <>
              {" "}
              of <strong>{targetName}</strong>
            </>
          ) : null}
          : dark → red → yellow → white = brighter.
        </li>
        <li>
          The <strong>bright blob</strong> under the cross is the target. It is often saturated,
          which is normal.
        </li>
        <li>
          <strong>What to notice:</strong> press Play, or go from visit 1 to visit 3: the blob
          drifts <strong>north</strong> while the background stars stay put.
          {pass != null ? ` (visit ${pass} only)` : null}
        </li>
      </ul>
    </div>
  );
}
