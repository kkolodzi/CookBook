---
change_id: recipe-prep-instructions
title: Capture recipe preparation instructions/steps
status: implemented
created: 2026-08-16
updated: 2026-08-17
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

**Planned 2026-08-16** — `plan.md` + `plan-brief.md` written. Initially scoped to the backend
slice only (migration, extraction, API, upload-confirmation UI) — FR-018/FR-019 (detail view,
edit form) deferred to a follow-up plan after S-02/S-03 merge.

**Extended 2026-08-16** — S-02 and S-03 both merged to `main` same day. Re-planned to cover the
full S-04 slice in one pass: added Phase 5 (detail view, FR-018), Phase 6 (edit form, FR-019,
extends S-03's `edit_recipe()` RPC), and Phase 7 (production rollout for both migrations).
Migration filename bumped to `20260816180000_add_recipe_instructions.sql` to avoid a timestamp
collision with S-03's own `20260816170000_atomic_recipe_ingredient_edit.sql`.

**Implemented 2026-08-17** — All 7 phases shipped: schema + extraction service + API persistence
+ upload confirmation UI + detail view + edit form + production rollout. Both migrations
(`20260816180000_add_recipe_instructions.sql`,
`20260816190000_edit_recipe_instructions.sql`) applied to dev and prod; along the way, prod's
migration backlog was found to be far behind (missing all of S-01/S-02/S-03's post-schema
migrations) and was fully caught up as part of Phase 7. Manual verification confirmed by the user
2026-08-17.

Next step: `/10x-archive recipe-prep-instructions`.
