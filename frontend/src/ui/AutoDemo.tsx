/** Timed captions for the one-button jury walkthrough. */

export type DemoPhase =
  | "idle"
  | "intro"
  | "play"
  | "blink"
  | "ghost"
  | "difference"
  | "predict"
  | "done";

export const DEMO_BEATS: {
  phase: DemoPhase;
  ms: number;
  line: string;
}[] = [
  {
    phase: "intro",
    ms: 3200,
    line: "SPHEREx revisited this patch of sky months apart. Watch what refuses to stay put.",
  },
  {
    phase: "play",
    ms: 5000,
    line: "Play: each frame is a different infrared color — same place, new slice of the spectrum.",
  },
  {
    phase: "blink",
    ms: 6000,
    line: "Blink Visit 1 ↔ Visit 3. The bright star hops. That hop is real motion.",
  },
  {
    phase: "ghost",
    ms: 6500,
    line: "Ghost sky: both visits at once. The mover breathes — fixed stars stay put.",
  },
  {
    phase: "difference",
    ms: 5500,
    line: "Difference: bright/dark dipole = mover. Fixed stars cancel to near zero.",
  },
  {
    phase: "predict",
    ms: 5500,
    line: "Predict vs observe: catalogue proper motion vs what SPHEREx measured — the sky agrees.",
  },
  {
    phase: "done",
    ms: 3800,
    line: "Press M anytime to Spot the mover yourself. That is the challenge in under a minute.",
  },
];

interface AutoDemoBannerProps {
  line: string;
  onSkip: () => void;
}

export function AutoDemoBanner({ line, onSkip }: AutoDemoBannerProps) {
  return (
    <div className="auto-demo-banner" role="status">
      <p>{line}</p>
      <button type="button" className="ghost" onClick={onSkip}>
        Skip demo
      </button>
    </div>
  );
}
