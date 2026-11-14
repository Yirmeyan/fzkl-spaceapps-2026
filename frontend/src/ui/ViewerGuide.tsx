interface ViewerGuideProps {
  targetName?: string;
  pass: number | null;
}

/** Plain-language legend so newcomers know what the false-color image means. */
export function ViewerGuide({ targetName, pass }: ViewerGuideProps) {
  return (
    <div className="viewer-guide">
      <p className="viewer-guide-title">What you are looking at</p>
      <ul>
        <li>
          This is a <strong>near-infrared</strong> SPHEREx image
          {targetName ? (
            <>
              {" "}
              of <strong>{targetName}</strong>
            </>
          ) : null}
          , shown in false color (dark → red → yellow → white = brighter).
        </li>
        <li>
          The <strong>bright blob</strong> under the orange cross is the target. It looks blown out
          because it saturates the detector — that is normal for Barnard's Star here.
        </li>
        <li>
          Smaller yellow/white dots are other stars. Black patches are missing pixels (detector
          edge).
        </li>
        <li>
          <strong>What to notice:</strong> press Play, or click Pass 1 then Pass 2 then Pass 3 —
          the bright blob drifts <strong>up (north)</strong> while background stars stay put. That
          motion is the whole point of the challenge.
          {pass != null ? ` (showing pass ${pass} only)` : null}
        </li>
        <li>
          Tip: mode <strong>Difference</strong> with passes 1 − 3 makes movers light up even more
          clearly.
        </li>
      </ul>
    </div>
  );
}
