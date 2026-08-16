---
change_id: recipe-prep-instructions
title: Capture recipe preparation instructions/steps
status: planned
created: 2026-08-16
updated: 2026-08-16
archived_at: null
---

## Notes

Surfaced during S-01 manual testing (2026-08-16) as a candidate idea in
`context/foundation/roadmap.md`. Framed at `/10x-frame` — see `frame.md` in this folder.

**Shaped 2026-08-16** (lightweight interview, not a full `/10x-shape` — this is a PRD amendment,
not a from-scratch reshape; see conversation record). Decisions:
- Preparation instructions captured as freeform text (not a structured step list).
- New FR-021 added to `context/foundation/prd.md`, must-have, extraction is best-effort/nullable
  (same pattern as FR-008 type). FR-018 (detail view) and FR-019 (edit) updated to include
  instructions.
- Roadmap slice added: S-04 (`context/foundation/roadmap.md`).
- **Sequencing**: FR-018/FR-019 are the exact surfaces S-02 (`recipe-search-and-browse`, detail
  view) and S-03 (`recipe-edit-and-remove`, edit form) are actively building in their own
  worktrees as of 2026-08-16. Decision: run `/10x-plan recipe-prep-instructions` now (planning
  touches no code), but hold `/10x-implement` until both S-02 and S-03 have merged, to avoid
  colliding on the detail-view and edit-form files.

**Planned 2026-08-16** — `plan.md` + `plan-brief.md` written. Scoped to the backend slice only
(migration, extraction, API, upload-confirmation UI) — FR-018/FR-019 (detail view, edit form)
deferred to a follow-up plan after S-02/S-03 merge (see plan's "What We're NOT Doing").

Next step: `/10x-implement recipe-prep-instructions phase 1` — safe to run now, this plan does
not touch any S-02/S-03 file.
