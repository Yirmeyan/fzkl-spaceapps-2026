# Agents — read this first

This repository is built by **two humans + their Cursor agents** during NASA Space Apps 2026.

**Before any non-trivial work, every agent MUST open and follow:**

1. [`docs/AGENT_BRIDGE.md`](docs/AGENT_BRIDGE.md) — Nic ↔ Tommy request board (read **and** update)
2. [`docs/architecture.md`](docs/architecture.md) — ownership + MVP steps
3. [`docs/api-contract.md`](docs/api-contract.md) — shared interface (changes need both sides)

## Ownership (do not cross without asking)

| Who | Owns |
| --- | --- |
| **Nicolas (Nic)** | `frontend/`, Cloudflare site, classroom UX |
| **Tommy / Yirmeyan** | `backend/`, Cloud Run, sample/precompute bundles |
| **Both** | Contract, CI, submission (P1), this bridge |

## Agent bridge protocol

1. At session start: read `docs/AGENT_BRIDGE.md`.
2. If the other side left a **Need**, address it or reply under **Response**.
3. Before ending a useful session: append what you shipped and what you still need.
4. Keep the bridge in **English**. Newest entries at the top of each section.
5. Do not invent API fields — change the contract in a PR both can see.

## English everywhere

Code, UI, commits, docs, and the bridge are English only (team rule).
