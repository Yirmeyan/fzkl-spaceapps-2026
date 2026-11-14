# Win progress tracker (Nic / frontend + shared)

Honest scope: **what Nicolas can ship without waiting on Tommy**, plus blocked team items.
Last recalibration: 2026-11-14 ~13:15 America/Toronto.

## How to read %

- **Unblocked Nic lane** = work we can finish with sample data + Cloudflare + docs/demo.
- **Team win lane** = needs Tommy B2–B6 + live API + full 5 targets + submission.
- Prefer under-estimate. If unsure, mark lower.

| Lane | Now | Target tonight | Notes |
| --- | ---: | ---: | --- |
| Unblocked Nic lane | **62%** | ~90% | Was overstated earlier as ~90% MVP checklist |
| Team win / top-tier | **38%** | ~70% if Tommy ships frames+bundles | Jury cares about this |

## Top-tier win checklist

### A. Product story (judges notice in 30s)

| ID | Item | Status | Owner |
| --- | --- | --- | --- |
| A1 | One-breath demo: Barnard → Blink → Difference → Fullscreen | Partial | Nic |
| A2 | Classroom language, English only (dates included) | Done | Nic |
| A3 | Mode tabs that hide irrelevant controls | Done | Nic |
| A4 | Technical metadata behind “teachers” disclosure | Done | Nic |
| A5 | Production URL shows latest UI (not old squash) | **Not done** | Nic |
| A6 | 30s video / 7 slides draft | Not started | Shared (Nic can draft) |

### B. Frontend quality

| ID | Item | Status | Owner |
| --- | --- | --- | --- |
| B1 | F1–F7 on Barnard sample | Done | Nic |
| B2 | Difference A/B not broken by pass filter | Done | Nic |
| B3 | Motion trail + blink | Done | Nic |
| B4 | Fullscreen stage (replace useless zoom) | Done | Nic |
| B5 | Responsive / phone usable | Weak | Nic |
| B6 | Keyboard shortcuts (play, blink, modes) | Missing | Nic |
| B7 | Empty/error states feel product-grade | Partial | Nic |
| B8 | Lint/typecheck/tests green on ship branch | Done locally | Nic |
| B9 | a11y pass (focus, labels, reduced motion) | Partial | Nic |

### C. Data / backend dependency

| ID | Item | Status | Owner |
| --- | --- | --- | --- |
| C1 | B1 exposures API | Done on main | Tommy |
| C2 | B2–B5 live frames + resolve | Blocked | Tommy |
| C3 | B6 other four target bundles | Blocked | Tommy |
| C4 | Wire `VITE_API_BASE` + CORS when Cloud Run public | Blocked | Both |
| C5 | Real flux spectrum (unsaturated target) | Blocked | Tommy+Nic |

### D. Submission / rules

| ID | Item | Status | Owner |
| --- | --- | --- | --- |
| D1 | Space Apps project challenge set + English description | Human Nic | Nic |
| D2 | Sources/licenses page complete | Partial | Shared |
| D3 | AI disclosure current | Partial | Shared |
| D4 | P1 README polish + demo script | Not started | Shared |

## Active work log

| Time | Action | % Nic unblocked | Recalibration note |
| --- | --- | ---: | --- |
| 13:15 | Created tracker; started ship+polish loop | 62 | Lowered from “~90% F checklist” illusion |

## Next loops (Nic only)

1. Rebase classroom UI onto `main`, open PR, get it merge-ready.
2. Mobile + keyboard + demo polish loop.
3. Draft demo script + slide outline in `docs/`.
4. Recalibrate %; if Nic lane < 90, continue.
