# Recipe Edit and Reversible Removal — Plan Brief

> Full plan: `context/changes/recipe-edit-and-remove/plan.md`

## What & Why

Let a user edit a saved recipe's name, type, and ingredient list, and remove a recipe reversibly with restore (FR-019, FR-020). These are must-have requirements from the PRD, and the roadmap flags S-03 as parallel with S-02 (search/browse) rather than dependent on it — so this change also has to supply its own minimal way to reach a recipe, since S-02's list/detail UI hasn't landed on this branch yet.

## Starting Point

The `recipes` schema already has `deleted_at` (soft-delete) and owner-scoped RLS for update/delete — no migration needed. The only per-recipe API today is a narrow `PATCH .../type` used by the post-upload type-confirmation nudge. There is no recipe list or detail page anywhere on this branch; `dashboard.astro` only links to the photo-upload flow.

## Desired End State

A signed-in user can browse their saved recipes at `/recipes`, open one to edit name/type/ingredients, remove it (behind a confirm dialog), and recover it later from `/recipes/trash`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| UI scope given no S-02 UI yet | Build a minimal own list + detail page | Unblocks manual testing and real usability now; some overlap with S-02 is expected and acceptable in this parallel-worktree workflow. |
| Ingredient edit model | Full replace-on-save (delete old rows, insert new) | Matches the insert pattern `POST /api/recipes` already uses; diffing adds complexity nothing currently needs. |
| Removal UX | Dedicated trash view with restore, not a toast | A multi-day recovery window doesn't fit a toast that vanishes in seconds. |
| Recovery window enforcement | Indefinite for MVP, no purge job | Avoids a pg_cron migration; roadmap already flags the window as tunable later. |
| Delete confirmation | Confirm dialog before soft-delete | Cheap guard against accidental destructive clicks. |
| Type field on edit form | New general PATCH covers name+type+ingredients in one request | One save = one request; existing `type.ts` PATCH stays untouched for the nudge's separate flow. |
| Minimum ingredients | Require at least 1 to save | Matches the product's own guarantee that a saved recipe always has ≥1 ingredient. |

## Scope

**In scope:** GET/PATCH/DELETE + restore + list + trash API endpoints; a minimal `/recipes` list page; a `/recipes/[id]` edit page; a `/recipes/trash` restore page; dashboard nav links.

**Out of scope:** photo display anywhere (no signed-URL helper exists yet — S-02/FR-018), freeform note field (parked FR-010), ingredient quantity/unit split, hard-delete/purge job, search/filter/sort/pagination (S-02), diff-based ingredient updates.

## Architecture / Approach

Four vertical phases, backend-first: Phase 1 lands all API routes (fully unit-tested against a mocked Supabase client, following the existing `type.ts`/`type.test.ts` pattern). Phases 2-4 each wire one UI surface — list+remove, detail+edit, trash+restore — as an Astro SSR page plus a React island, matching the `PhotoUploadForm.tsx` conventions (local status state machine, Polish copy, shadcn `Button`/`cn()`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Recipe API | GET/PATCH/DELETE/restore/list/trash endpoints, tested | Ingredient full-replace ordering (insert-before-delete) to avoid a zero-ingredient window |
| 2. Recipe list page | `/recipes` + remove confirm dialog + dashboard link | New shadcn `dialog` component |
| 3. Recipe detail/edit page | `/recipes/[id]` edit form (name/type/ingredients) | New shadcn `input` component; client+server min-1-ingredient validation |
| 4. Trash view | `/recipes/trash` + restore | None significant |

**Prerequisites:** S-01 (photo-to-recipe-save) done — confirmed on this branch.
**Estimated effort:** ~1-2 sessions across 4 phases.

## Open Risks & Assumptions

- The minimal list/detail UI built here may need reconciling with S-02's fuller browse UI when that branch merges (expected, not a blocker).
- No cross-statement DB transaction is available through the Supabase client for the ingredient full-replace — mitigated by insert-before-delete ordering, not eliminated.

## Success Criteria (Summary)

- A user can edit a recipe's name, type, and ingredients and see the changes persist.
- A user can remove a recipe and restore it later from the trash view.
- Neither action is reachable for a recipe the user doesn't own.
