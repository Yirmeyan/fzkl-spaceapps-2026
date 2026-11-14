# Agents — read this first

This repository is built by **two humans + two independent Cursor agents** (Nic / frontend, Tommy / backend) during NASA Space Apps 2026.

**Before any non-trivial work, every agent MUST:**

1. Open [`docs/AGENT_BRIDGE.md`](docs/AGENT_BRIDGE.md) — coordination board (read **and** update when useful)
2. Skim [`docs/architecture.md`](docs/architecture.md) — ownership + MVP steps
3. Use [`docs/api-contract.md`](docs/api-contract.md) for the shared interface

## Critical: independence + the human

- **The user’s current message beats the bridge.** Never ignore your human to “obey” the other agent.
- **Two AIs, not one.** The bridge shares status and needs. It must not collapse both sides into a single plan or aesthetic.
- **Needs are requests, not orders.** Especially on Tommy’s side: stronger backend ideas should replace weaker bridge suggestions — reply with a Response.
- Do not implement the other owner’s half-baked sketch just because it is written down.

## Ownership (do not cross without asking)

| Who | Owns |
| --- | --- |
| **Nicolas (Nic)** | `frontend/`, Cloudflare site, classroom UX |
| **Tommy / Yirmeyan** | `backend/`, Cloud Run, sample/precompute bundles |
| **Both** | Contract, CI, submission (P1), this bridge |

## Bridge protocol

1. Session start: read `docs/AGENT_BRIDGE.md` (and its independence charter).
2. If the other side left a Need: address it, improve it, or Response why not — then keep serving *your* human’s goals.
3. Before ending useful work: append shipped items and open needs (keep the file short).
4. English only. Newest entries first in each section.
5. Do not invent API fields silently — change the contract in a visible PR.

## English everywhere

Code, UI, commits, docs, and the bridge are English only (team rule).
