interface MissionBriefingProps {
  targetName: string;
  onEnter: () => void;
  onSkip: () => void;
}

/** First-run cinematic gate. feels like a mission, not a web form. */
export function MissionBriefing({ targetName, onEnter, onSkip }: MissionBriefingProps) {
  return (
    <div className="mission-briefing" role="dialog" aria-modal="true" aria-label="Mission briefing">
      <div className="mission-briefing-veil" />
      <div className="mission-briefing-card">
        <p className="mission-eyebrow">SPHEREx · public sky · FZKL</p>
        <h2 className="mission-title">Something in this field is moving</h2>
        <p className="mission-lead">
          NASA’s SPHEREx revisits the sky every ~six months in infrared. Most points of light stay
          nailed to the celestial sphere. <strong>{targetName}</strong> does not.
        </p>
        <p className="mission-lead dim">
          Your job is simple: see the hop. Then you’ll never unsee it.
        </p>
        <div className="mission-actions">
          <button type="button" className="primary mission-cta" onClick={onEnter}>
            Enter the sky
          </button>
          <button type="button" className="ghost" onClick={onSkip}>
            Skip briefing
          </button>
        </div>
      </div>
    </div>
  );
}
