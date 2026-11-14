/** Timed captions for the one-button jury walkthrough. */

export type DemoPhase = "idle" | "intro" | "play" | "blink" | "difference" | "done";

export const DEMO_BEATS: {
  phase: DemoPhase;
  ms: number;
  line: string;
}[] = [
  {
    phase: "intro",
    ms: 3500,
    line: "SPHEREx revisited this patch of sky months apart. Watch what refuses to stay put.",
  },
  {
    phase: "play",
    ms: 5500,
    line: "Play: each frame is a different infrared color — same place, new slice of the spectrum.",
  },
  {
    phase: "blink",
    ms: 7000,
    line: "Blink Visit 1 ↔ Visit 3. The bright star hops. That hop is real motion.",
  },
  {
    phase: "difference",
    ms: 6500,
    line: "Difference: bright/dark dipole = mover. Fixed stars cancel to near zero.",
  },
  {
    phase: "done",
    ms: 4000,
    line: "That is the whole challenge in one minute: make sky change obvious to anyone.",
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
