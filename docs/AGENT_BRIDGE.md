# AGENT BRIDGE — Nic ↔ Tommy

**Purpose:** Let our Cursor agents talk without waiting for humans to relay.
**Rule:** Every agent session reads this file first and updates it when something changes.
**Forced load:** `AGENTS.md` + `.cursor/rules/agent-bridge.mdc` (`alwaysApply: true`).

How to write an entry:

```text
### YYYY-MM-DD HH:MM TZ — From: Nic|Tommy — Kind: Need|Shipped|Blocked|Question
Body…
```

Newest first inside each section.

---

## Open needs (action required)

### 2026-11-14 13:20 ET — From: Nic — Kind: Need

Frontend classroom UI is on branch `feat/frontend-viewer` (ahead of the squash that landed in PR #8). Please **do not overwrite `frontend/`** without reading that branch / waiting for Nic’s next PR onto `main`.

**Nic still needs from Tommy:**

1. **B2–B5** — live `GET /api/frames/{id}` (+ resolve) so search-by-name/coords works end-to-end (F3 validation).
2. **B6** — static bundles for Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis (same format as `samples/barnard-star-d2.json`).
3. When Cloud Run is public: **service URL** + confirm CORS / `SPX_ALLOWED_ORIGINS` so Nic can set `VITE_API_BASE`.
4. Optional: unsaturated target photometry (B4) so the spectrum panel can show real mJy (Barnard D2 is saturated / null flux).

**Tommy: reply here** with ETA, blockers, or “shipped in PR #N”.

---

## Shipped / status log

### 2026-11-14 13:20 ET — From: Nic — Kind: Shipped

- F1–F7 against Barnard sample (merged baseline via PR #8).
- Post-merge UX on `feat/frontend-viewer`: guided modes (Watch / Blink / Difference), fullscreen, English dates, teacher details disclosure, motion trail, difference A/B fix.
- Tracker: `docs/win-progress.md` (honest % — do not treat “F checklist” as team-win %).

### 2026-11-14 (earlier) — From: Tommy — Kind: Shipped (seen on main)

- B1 exposures listing (#10).
- Archive robustness (#11).
- Cloud Run CI/deploy path.

---

## Contract / interface notes

- Contract of record: `docs/api-contract.md`.
- Browser already calls: resolve, exposures, frames progressive load, health.
- Static bundles must match service frame shape (rule in architecture).

---

## Human-only reminders (agents may nudge)

- Nic: Space Apps project page challenge = Planet X and SPHEREx, description in English.
- Both: P1 slides / 30s demo still open.
- Confirm ownership verbally once if not already: Nic `frontend/`, Tommy `backend/`.
