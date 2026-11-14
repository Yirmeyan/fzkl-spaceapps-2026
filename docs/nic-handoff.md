# Nic handoff — overnight frontend run

Written while Nic sleeps (2026-11-14 night → morning). Branch: `feat/frontend-viewer`.

**Pull request:** https://github.com/Yirmeyan/fzkl-spaceapps-2026/pull/8

## Verdict

Frontend S0 + F1–F7 are implemented against the API contract and the Barnard's Star sample. Lint, typecheck, tests (10), and production build are green locally. Preview checked in the browser: Barnard's Star visible with crosshair, animation, passes, metadata. Six S1 contract choices: **all accepted**.

## Decisions taken

| Decision | Choice |
| --- | --- |
| Six S1 contract choices | All accepted. None block the viewer. |
| Stack | React 19 + TypeScript + Vite 8, as in the architecture plan |
| Lint / test | Biome + Vitest |
| Hosting | GitHub Pages workflow (`.github/workflows/pages.yml`). Cloudflare still needs an account. |
| Backend folder | Untouched |
| Sample | Copied to `frontend/public/samples/` on `npm run samples` / predev / prebuild |
| Other four targets | Buttons present; show “soon” until B6 bundles exist |
| Git | One PR branch `feat/frontend-viewer` (not pushed to `main`) |

## What ships in the PR

- `frontend/` full app: health badge, Barnard's Star viewer, play/pause, pass filter, stack / difference / track modes, URL state, metadata, spectrum/light-curve panels, five-target strip, help, search form wired to `/api/resolve` + exposures + frames
- CI `frontend` job in `.github/workflows/ci.yml`
- Pages deploy workflow (runs on `main` after merge; enable Pages in repo settings)
- `docs/challenge.md`, this handoff, sources + root README updates

## Run locally

```bash
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173/ — Barnard's Star should animate. Optional: start the backend for a green health badge (`backend/README.md`). `uv` was not installed on this machine overnight.

Checks:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## What Nic must do at wake-up (human only)

1. **Space Apps site:** set the team challenge to **Planet X and SPHEREx** and the description in English (you are team owner).
2. Confirm ownership with Tommy: Nic = `frontend/`, Tommy = `backend/`.
3. Review / merge the frontend PR when CI is green.
4. In the GitHub repo: Settings → Pages → Source = GitHub Actions (once), so the Pages workflow can publish after merge.
5. Optional: install `uv` to run the Python service beside Vite.
6. Tell Tommy the six S1 choices are fine (already assumed).

## Validation checklist

- [x] `npm test && npm run lint && npm run typecheck && npm run build`
- [ ] `npm run dev` → Barnard's Star visible, animates, drifts north between passes (spot-check in the browser)
- [ ] Health badge green when backend runs
- [ ] Copied URL reopens the same view
- [ ] After merge + Pages enabled: public URL opens without sign-in

## Left for Tommy / later

- B1–B5 live API (search by name/coords will error until then; UI is ready)
- B6 bundles for the other four challenge targets
- Backend deploy (Cloud Run)
- Cloudflare Pages if preferred over GitHub Pages
