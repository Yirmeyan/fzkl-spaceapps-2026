import type { CSSProperties } from "react";
import { wavelengthHue } from "../spectrum/waveHue";
import { DETECTORS } from "./copy";

export interface DetectorBand {
  detector: number;
  /** Shortest-longest µm in the loaded frames for this detector */
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
 * Stage-facing SPHEREx detector dial. one band per detector.
 * Makes the six-wavelength story visible without opening Technical details.
 */
export function DetectorDial({ bands, active, onPick }: DetectorDialProps) {
  if (bands.length < 2) return null;
  const chosen = bands.find((band) => band.detector === active);
  const hint = chosen
    ? DETECTORS.hint(chosen.detector, chosen.waveMin, chosen.waveMax, chosen.frames)
    : DETECTORS.group;

  return (
    <section className="detector-dial" aria-label="SPHEREx detectors">
      <div className="detector-dial-head">
        <p className="detector-dial-kicker">{DETECTORS.label}</p>
        <button
          type="button"
          className={active == null ? "detector-dial-all active" : "detector-dial-all"}
          onClick={() => onPick(null)}
          title={DETECTORS.all.hint}
        >
          {DETECTORS.all.label}
        </button>
      </div>
      <div className="detector-dial-track">
        {bands.map((b) => {
          const mid = (b.waveMin + b.waveMax) / 2;
          const hue = wavelengthHue(mid);
          const isOn = active === b.detector;
          return (
            <button
              key={b.detector}
              type="button"
              className={isOn ? "detector-dial-band active" : "detector-dial-band"}
              style={{ "--band-hue": String(hue) } as CSSProperties}
              title={DETECTORS.hint(b.detector, b.waveMin, b.waveMax, b.frames)}
              aria-pressed={isOn}
              onClick={() => onPick(b.detector)}
            >
              <span className="detector-dial-swatch" aria-hidden="true" />
              <span className="detector-dial-det">
                <span className="detector-dial-word">{DETECTORS.word} </span>
                {b.detector}
              </span>
              <span className="detector-dial-um">
                {mid.toFixed(1)} <span className="unit-um">µm</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="detector-dial-hint">{hint}</p>
    </section>
  );
}
