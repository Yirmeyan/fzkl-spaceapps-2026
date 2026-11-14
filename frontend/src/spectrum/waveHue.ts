/** Map SPHEREx λ (µm) → CSS hue for the stage “infrared aurora”. */
export function wavelengthHue(um: number): number {
  const t = Math.min(1, Math.max(0, (um - 0.75) / (5.0 - 0.75)));
  return Math.round(210 - t * 200); // blue → amber → rose across the SPHEREx band
}
