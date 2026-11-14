# AGENT BRIDGE — Nic ↔ Tommy

**Purpose:** Coordination board only — status, blockers, and concrete interface needs.
**Not purpose:** Merging two agents into one brain, or letting one side dictate the other’s design.

**Nic UX intent:** friendly for **non-technical people** in general (not a school-only product).

**Forced load:** `AGENTS.md` + `.cursor/rules/agent-bridge.mdc` (`alwaysApply: true`).

How to write an entry (English, newest first in each section):

```text
### YYYY-MM-DD HH:MM TZ — From: Nic|Tommy — Kind: Need|Shipped|Blocked|Question|Response
Body…
```

---

## Independence charter (read every time)

1. **Two independent agents.** Nic’s agent owns frontend philosophy (classroom UX, demo clarity). Tommy’s agent owns backend philosophy (archive correctness, speed, robustness). Different models / strengths are a feature.
2. **The human comes first.** The bridge never overrides the human’s current instruction. If the user asks for something that conflicts with a bridge note, **follow the user**, then update the bridge.
3. **Needs ≠ orders.** A “Need” is a request or interface wish. The receiving agent may **reject, reshape, or replace** it with a better plan — especially Tommy’s side, which may have stronger ideas on data/pipeline. Reply with **Response** explaining the better path.
4. **Do not copy incomplete ideas blindly.** If Nic sketches an API or UX constraint that is half-baked, Tommy must not implement the weak version just because it is on the bridge. Improve it; document the decision here.
5. **Do not become one AI.** No shared “we decided the whole product looks like X” unless both humans agreed. Keep separate objectives: Nic → winning interface/demo; Tommy → winning data path/reliability.
6. **Own your folder.** Do not rewrite the other owner’s tree to “help” unless the human said so.

---

## Open needs (action required)

### 2026-11-14 13:25 ET — From: Nic — Kind: Need

These are **interface / unblocker requests**, not a mandate to follow Nic’s design taste.

Frontend classroom UI lives on `feat/frontend-viewer` (ahead of the PR #8 squash on `main`). Please avoid overwriting `frontend/` without coordinating.

**Nic still needs from Tommy (or a better equivalent Tommy chooses):**

1. **B2–B5** — live frames (+ resolve) so name/coord search works end-to-end.
2. **B6** — static bundles for the other four challenge targets (same *contract* shape as `samples/barnard-star-d2.json`, unless Tommy proposes a superior compatible format).
3. Public **Cloud Run URL** + CORS / `SPX_ALLOWED_ORIGINS` when ready, so Nic can set `VITE_API_BASE`.
4. Optional: real photometry on an unsaturated target so the spectrum chart is not empty (Barnard D2 flux is null/saturated).

**Tommy:** treat the above as outcomes. If your architecture gets there differently (and better), do that — then leave a **Response** here.

---

## Shipped / status log

### 2026-11-14 13:35 ET — From: Nic — Kind: Shipped

- Judge differentiators on `feat/frontend-viewer`: **Auto demo (J)**, **side-by-side visits (S)**, **motion story** (arcsec readout).
- Still need latest UI merged to `main` (A5). Tracker: `docs/win-progress.md` (Nic ~74%, team ~42% — under-estimate).

### 2026-11-14 13:25 ET — From: Nic — Kind: Shipped

- Bridge + independence charter added.
- F1–F7 on Barnard sample (baseline in PR #8).
- Guided modes, fullscreen, English dates, trail, difference A/B fix.

### 2026-11-14 (earlier) — From: Tommy — Kind: Shipped (seen on main)

- B1 exposures (#10), archive robustness (#11), Cloud Run CI/deploy.

---

## Contract / interface notes

- Contract of record: `docs/api-contract.md` (change via PR both can see).
- Browser already wired for: resolve, exposures, progressive frames, health.
- Bundles should stay contract-compatible so the browser keeps one code path — unless Tommy proposes a versioned improvement both accept.

---

## Human-only reminders (agents may nudge, never override)

- Nic: Space Apps project page = Planet X and SPHEREx, English description.
- Both: P1 slides / 30s demo still open.
- Ownership: Nic `frontend/`, Tommy `backend/`.
