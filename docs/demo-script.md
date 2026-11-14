# Jury demo (English)

Goal: anyone non-technical sees **real stellar motion** and **real spectra** without a lecture. One viewport, dark desk, no page scroll.

## One-click path

1. Open production (or preview) and click **Judge link** — or paste `?demo=1&target=barnard`.
2. The walkthrough starts when Barnard's Star is ready (fullscreen + timed captions).
3. Backup if auto-demo is interrupted: press **J**.

## Live walkthrough beats (≈40 s, key J)

1. **Intro** — SPHEREx revisited this sky months apart.
2. **Play** — each frame is a different infrared color.
3. **Blink** — Visit 1 ↔ Visit 3; the star hops.
4. **Blend visits** — early + late together; the mover shimmers.
5. **Difference** — bright/dark dipole = mover.
6. **Right panel** — “Where the catalog puts it” plus “What moved or changed here” (service measurement next to catalog rate).
7. **Done** — story complete without mini-games.

## Manual 30-second path (preferred for video)

1. **(0–10 s) Barnard's Star hops** — preset loaded; **Play**, then blink visits (**B**) so the bright core jumps while the background stays. Turn on **Gaia DR3**: the violet ring follows the star. **AllWISE** sits south where it was in 2010.
2. **(10–20 s) Epsilon Indi B spectrum** — switch to **Epsilon Indi B**. Unsaturated; open the spectrum chart (log y when the range is wide). One short line: “nearby brown dwarf, real SPHEREx flux.”
3. **(20–30 s) WISE 0855 or R Draconis** — **WISE 0855**: AllWISE ring far east (2010); Gaia cannot see it — Planet X search shape. **R Draconis**: too bright for SPHEREx to measure, and the tool still tells it faded by half in a year, from its halo.

Backup if “is this fake?”: “NASA SPHEREx cutouts; orange marks are catalogue or measured positions on the same grid.”

Deep links for cut takes: `?target=barnard`, `?target=epsindi`, `?target=rwaur`, `?target=rdra` (plus `demo=1` on Barnard for the auto walkthrough).

## 7-slide outline (P1)

1. Problem — too much SPHEREx sky for one human
2. Idea — public tool to blink / difference / ghost visits, then measure what moved
3. Demo — Barnard's Star hops (`?demo=1`), then Epsilon Indi B spectrum, then RW Aurigae across three passes
4. How it works — browser compose + Cloud Run frames, resolve, spectrum, candidates
5. SPHEREx-aware — wavelength, passes, saturated cores honest, wider field on demand
6. What we shipped — five live presets each with a result (including R Dra via its halo), any-sky resolve, spectrum in one request, candidates that match the catalog, shareable URLs
7. Team / AI disclosure / links / AGPL

## Do not say

- Wavelength micrometers unless asked
- Internal step codes (F7, B4, addition A) unless a technical judge asks
