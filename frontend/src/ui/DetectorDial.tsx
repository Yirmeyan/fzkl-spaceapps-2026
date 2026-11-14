import type { CSSProperties } from "react";
import { wavelengthHue } from "../spectrum/waveHue";

export interface DetectorBand {
  detector: number;
  /** Shortest–longest µm in the loaded frames for this detector */
  waveMin: number;
  waveMax: number;
  frames: number;
}

interface DetectorDialProps {
  bands: DetectorBand[];
  active: number | null;
  onPick: (detector: number | null) => void;
}

/**
 * Stage-facing SPHEREx detector dial — one band per camera.
 * Makes the six-wavelength story visible without opening Technical details.
 */
export function DetectorDial({ bands, active, onPick }: DetectorDialProps) {
  if (bands.length < 2) return null;

  return (
    <section className="detector-dial" aria-label="SPHEREx infrared cameras">
      <div className="detector-dial-head">
        <p className="detector-dial-kicker">Infrared cameras</p>
        <button
          type="button"
          className={active == null ? "detector-dial-all active" : "detector-dial-all"}
          onClick={() => onPick(null)}
          title="Show frames from every detector"
        >
          All
        </button>
      </div>
      <div className="detector-dial-track" role="list">
        {bands.map((b) => {
          const mid = (b.waveMin + b.waveMax) / 2;
          const hue = wavelengthHue(mid);
          const isOn = active === b.detector;
          return (
            <button
              key={b.detector}
              type="button"
              role="listitem"
              className={isOn ? "detector-dial-band active" : "detector-dial-band"}
              style={{ "--band-hue": String(hue) } as CSSProperties}
              title={`Detector ${b.detector}: ${b.waveMin.toFixed(2)}–${b.waveMax.toFixed(2)} µm · ${b.frames} frames`}
              aria-pressed={isOn}
              onClick={() => onPick(b.detector)}
            >
              <span className="detector-dial-swatch" aria-hidden="true" />
              <span className="detector-dial-det">D{b.detector}</span>
              <span className="detector-dial-um">{mid.toFixed(1)} µm</span>
            </button>
          );
        })}
      </div>
      <p className="detector-dial-hint">
        SPHEREx sees in six infrared colors — tap a camera to isolate one.
      </p>
    </section>
  );
}
