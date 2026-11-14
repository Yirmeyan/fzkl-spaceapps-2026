/** Timed captions for the one-button jury walkthrough. */

export type DemoPhase = "idle" | "intro" | "play" | "blink" | "ghost" | "difference" | "done";

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
    line: "Play: each frame is a different infrared color. same place, new slice of the spectrum.",
  },
  {
    phase: "blink",
    ms: 6500,
    line: "Eyepiece on: Visit 1 ↔ Visit 3. The bright star hops. That hop is real motion.",
  },
  {
    phase: "ghost",
    ms: 6000,
    line: "Blend visits: early and late stacked together. the mover shimmers; fixed stars stay put.",
  },
  {
    phase: "difference",
    ms: 5500,
    line: "Show the move: bright/dark pair = it moved. Fixed stars cancel to near zero.",
  },
  {
    phase: "done",
    ms: 4500,
    line: "Measured vs catalog under the sky. Copy the verdict or save a postcard for the jury.",
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
