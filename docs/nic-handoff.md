# Nic handoff

Branch: `feat/frontend-viewer`. **PR:** https://github.com/Yirmeyan/fzkl-spaceapps-2026/pull/8

## Status (2026-11-14 morning)

- Frontend S0 + F1–F7 against the contract + Barnard's Star sample.
- Tommy synced `main`, fixed `package-lock.json`; CI frontend/backend green.
- Cloudflare Pages already deploys previews (no GitHub Pages). `pages.yml` removed.
- Extra UX from the reference dossier + Space Apps forum: **Match this λ** and **Contrast**.

Preview example: https://59fd1719.fzkl-spaceapps-2026.pages.dev

## Decisions

| Topic | Choice |
| --- | --- |
| S1 contract choices | All accepted |
| Hosting | Cloudflare Pages (Tommy). Do **not** enable GitHub Pages |
| `Ressources/` | Local only, gitignored (French reference HTML) |

## Human TODO for Nic

1. Space Apps site: set challenge to Planet X and SPHEREx, description in English.
2. Merge PR 8 when ready (CI green).
3. Confirm ownership with Tommy: Nic = `frontend/`, Tommy = `backend/`.
4. Check [Space Apps Connect](https://github.com/nasa/spaceapps/discussions) Challenges / SPHEREx a few times a day ([#1847](https://github.com/nasa/spaceapps/discussions/1847) already read: match wavelengths when blinking).

## Blocked on Tommy

- B1–B5 live API (search by name/coords).
- B6 bundles for the other four targets.
- Cloud Run URL in `SPX_ALLOWED_ORIGINS` + `VITE_API_BASE` when the service is public.
