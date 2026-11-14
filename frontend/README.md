# Frontend

Browser app of the SPHEREx explorer. See [the architecture plan](../docs/architecture.md) and the [API contract](../docs/api-contract.md).

## Requirements

- Node 24+

## Commands

Run them from the `frontend/` folder.

| Goal | Command |
| --- | --- |
| Install | `npm install` |
| Copy sample bundles into `public/samples` | `npm run samples` |
| Run locally | `npm run dev` |
| Test | `npm test` |
| Lint | `npm run lint` |
| Build | `npm run build` |

The dev server proxies `/api` to `http://127.0.0.1:8000`. Start the Python service from `backend/` when you want a live health check and (later) live frames. Without it, Barnard's Star still loads from the static sample.

Open http://127.0.0.1:5173/

## Settings

Copy `.env.example` to `.env` if you need a custom API base. `VITE_API_BASE` is empty by default so the Vite proxy is used.

For GitHub Pages builds, set `VITE_BASE=/fzkl-spaceapps-2026/`.

## Checks

Every pull request runs the `frontend` check: Biome, typecheck, Vitest, then production build.

```
npm run lint
npm run typecheck
npm test
npm run build
```
