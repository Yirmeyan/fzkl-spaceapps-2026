interface SpectralRulerProps {
  /** Active frame wavelength in µm; null hides the needle. */
  wavelengthUm: number | null;
  /** Span always matches SPHEREx (Tommy chart rules). */
  minUm?: number;
  maxUm?: number;
}

/** Living µm ruler under the eyepiece. the needle tracks the infrared color on screen. */
export function SpectralRuler({ wavelengthUm, minUm = 0.75, maxUm = 5 }: SpectralRulerProps) {
  const span = maxUm - minUm;
  const t = wavelengthUm != null ? Math.min(1, Math.max(0, (wavelengthUm - minUm) / span)) : null;
  const ticks = [0.75, 1, 1.5, 2, 3, 4, 5];

  return (
    <div
      className="spectral-ruler"
      role="img"
      aria-label={
        wavelengthUm != null
          ? `Infrared color ${wavelengthUm.toFixed(2)} micrometers`
          : "SPHEREx wavelength span 0.75 to 5 micrometers"
      }
    >
      <div className="spectral-ruler-track">
        <div className="spectral-ruler-band" aria-hidden="true" />
        {ticks.map((um) => {
          const left = ((um - minUm) / span) * 100;
          return (
            <span key={um} className="spectral-ruler-tick" style={{ left: `${left}%` }}>
              <span className="spectral-ruler-mark" />
              <span className="spectral-ruler-label">{um}</span>
            </span>
          );
        })}
        {t != null && wavelengthUm != null && (
          <span
            className="spectral-ruler-needle"
            style={{ left: `${t * 100}%` }}
            title={`${wavelengthUm.toFixed(2)} µm`}
          >
            <span className="spectral-ruler-needle-cap">{wavelengthUm.toFixed(2)}</span>
          </span>
        )}
      </div>
      <p className="spectral-ruler-caption">µm · SPHEREx band</p>
    </div>
  );
}
