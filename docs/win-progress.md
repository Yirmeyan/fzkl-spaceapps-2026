# Win progress tracker (Nic / frontend + shared)

Last recalibration: 2026-11-14 ~13:48 America/Toronto.
Audience: non-technical people. Model: **Auto OK** — bar is game-breaking ideas, not model brand.

## Creative law (non-negotiable)

**Each loop = exactly one game-breaking idea, shipped.**  
If it is only a color/spacing/label/prettier pass → **illegal**. Discard and pick bigger.

Banned: button colors, gradients-for-show, microcopy nits, pure CSS chrome.  
Allowed: new motion perception, judge demo power, discovery mechanics, prod ship, Tommy data unlocked into UI.

## Stop rule for the agent loop

Stop **only when**:

1. Nic unblocked ≥ **90%** AND team win ≥ **90%**, or
2. Human says **stop**

Prefer under-estimate. Watch `docs/AGENT_BRIDGE.md` every loop for Tommy B2+.

## Lanes

| Lane | Now | Notes |
| --- | ---: | --- |
| Unblocked Nic lane | **74%** | Auto demo / split / motion story landed; A5 (on main) still critical |
| Team win / top-tier | **42%** | Data path still Tommy-gated |

## Idea backlog (game-breaking only — pick ONE per loop)

| Priority | Idea | Why judges care | Status |
| --- | --- | --- | --- |
| P0 | **A5 — latest UI on `main`/prod** | Judges never see your wow if prod is old squash | Next |
| P1 | **Predict vs observe** — overlay expected PM path vs blink | Science punchline, not chrome | Todo |
| P2 | **Spot-the-mover mini challenge** — hide labels, user picks which blob moved | Memorable interaction | Todo |
| P3 | **Share deep-link “motion card”** — URL opens mid-blink/diff with caption | Viral / judging replay | Todo |
| P4 | Wire Tommy frames/bundles the hour they land | Real sky > sample | Blocked |

## Checklist (abbrev)

- A1 Auto demo: done · A5 prod: **open** · B core: done · C B2–B6: blocked · D P1: draft

## Work log

| Time | Loop | Game-breaking idea shipped | Nic % | Team % |
| --- | ---: | --- | ---: | ---: |
| 13:15 | 0 | Tracker | 62 | 38 |
| 13:30 | 1 | Keys/mobile/demo script (borderline — keep bar higher now) | 68 | 40 |
| 13:35 | 1b | Auto demo + side-by-side + motion arcsec story | 74 | 42 |
| 13:48 | — | Law locked: game-breaking only; Auto kept | 74 | 42 |

## Loop tick protocol

1. `git fetch` + read bridge + this file.
2. If Tommy shipped data → integrate (that **is** game-breaking).
3. Else pick **one** backlog idea (P0 first). Write it as “This loop’s idea: …” in the log **before coding**.
4. Ship it. No second cosmetic task.
5. Update %. Stop only at 90/90 or human stop.
