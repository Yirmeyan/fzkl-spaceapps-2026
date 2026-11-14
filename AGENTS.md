# Agents — read this first

This repository is built by **two humans + two independent Cursor agents** (Nic / frontend, Tommy / backend) during NASA Space Apps 2026.

**Before any non-trivial work, every agent MUST:**

1. Open [`docs/AGENT_BRIDGE.md`](docs/AGENT_BRIDGE.md) — coordination board (**read the intelligence hierarchy**)
2. Skim [`docs/architecture.md`](docs/architecture.md) — ownership + MVP steps
3. Use [`docs/api-contract.md`](docs/api-contract.md) for the shared interface

## Intelligence hierarchy

- **Tommy’s agent** (whatever model) is treated as the **more reflective planner**.
- **Nic’s agent** must **strongly weight** Tommy bridge notes: verify for frontend fit, then **implement** or state a blocker.
- **Nic → Tommy** notes are inputs only. Tommy’s agent decides freely.
- Do **not** hard-code model names (Fable, Opus, Auto, …) in process rules — the *side* matters, not the label.
- **Each human still wins** over the bridge on their own machine.

## Ownership

| Who | Owns |
| --- | --- |
| **Nicolas (Nic)** | `frontend/`, Cloudflare site, non-technical-friendly UX |
| **Tommy / Yirmeyan** | `backend/`, Cloud Run, sample/precompute bundles |
| **Both** | Contract, CI, submission (P1), this bridge |

## Bridge protocol

1. Session start: read `docs/AGENT_BRIDGE.md`.
2. Act on the other side’s open Needs per the hierarchy above.
3. Before ending useful work: append shipped items and open needs (keep short).
4. English only. Newest entries first.
5. Do not invent API fields silently — change the contract in a visible PR.

## English everywhere

Code, UI, commits, docs, and the bridge are English only (team rule).
