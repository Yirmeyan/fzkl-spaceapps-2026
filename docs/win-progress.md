# Win progress tracker (Nic / frontend + shared)

Last recalibration: 2026-11-14 ~13:30 America/Toronto.
Audience: **non-technical people** (not “schools only”). Friendly UX for anyone.

## Stop rule for the agent loop

Stop the local loop **only when all of these are true** (prefer under-estimate):

1. **Nic unblocked lane ≥ 90%**
2. **Team win / top-tier ≥ 90%** (needs Tommy data path + submission-ready story — do not claim 90% team while B2–B6 / live sky / P1 are missing)
3. Or the human says **stop**

If team win is still &lt; 90% because Tommy is blocked: **keep looping** on Nic polish + bridge watch, but do **not** fake team % upward. When Tommy marks B2/B3/… on `docs/AGENT_BRIDGE.md`, the next loop **must** pull `main`/bridge, wire what became available, and add progress rows for that integration.

## How to read %

| Lane | Meaning |
| --- | --- |
| Nic unblocked | Sample UI, demo, docs Nic can finish alone |
| Team win / top-tier | Literally ship-to-NASA / competitive win bar |

| Lane | Now | Notes |
| --- | ---: | --- |
| Unblocked Nic lane | **68%** | +keys, mobile, demo script, de-school copy; A5 (latest UI on main) still open |
| Team win / top-tier | **40%** | Still need live frames, 4 targets, P1; do not inflate |

## Checklist

### A. Product story

| ID | Item | Status |
| --- | --- | --- |
| A1 | 30s path: Barnard → Blink → Difference → Fullscreen | Better (script + keys) |
| A2 | English, non-technical copy (not school-only) | Done this loop |
| A3 | Mode tabs hide irrelevant controls | Done |
| A4 | Tech metadata behind disclosure | Done (“Technical details”) |
| A5 | Latest UI on `main` / production | **Not done** |
| A6 | Demo script / slide outline | Drafted `docs/demo-script.md` |

### B. Frontend quality

| ID | Item | Status |
| --- | --- | --- |
| B1–B4 | F1–F7 core, diff fix, trail, fullscreen | Done |
| B5 | Mobile | Improved |
| B6 | Keyboard shortcuts | Done |
| B7 | Empty/error states | Partial |
| B8 | CI green locally | Done |
| B9 | a11y | Partial |

### C. Backend-dependent (watch the bridge each loop)

| ID | Item | Status |
| --- | --- | --- |
| C1 | B1 exposures | Done on main |
| C2 | B2–B5 frames + resolve | Blocked — **re-check bridge every loop** |
| C3 | B6 other bundles | Blocked — same |
| C4 | `VITE_API_BASE` / CORS | Blocked |
| C5 | Real flux spectrum | Blocked |

### D. Submission

| ID | Item | Status |
| --- | --- | --- |
| D1 | Space Apps page (human) | Open |
| D2–D3 | Sources / AI disclosure | Partial |
| D4 | P1 demo script | Draft started |

## Work log

| Time | Loop | Action | Nic % | Team % | Recalibration |
| --- | ---: | --- | ---: | ---: | --- |
| 13:15 | 0 | Tracker created | 62 | 38 | Cut fake “90% F checklist” |
| 13:30 | 1 | Keys, mobile, demo script, non-school copy; re-armed stop@90 both lanes | 68 | 40 | Team still honestly low |

## Loop instructions (for ticks)

1. `git fetch` + read `docs/AGENT_BRIDGE.md` + this file.
2. If Tommy shipped B2/B3/… → integrate, test, update C-rows and **team %**.
3. Else advance highest-value Nic item (A5 PR first).
4. Update this file; **under-estimate**.
5. If Nic≥90 **and** Team≥90 → kill loop PID. Else continue.
