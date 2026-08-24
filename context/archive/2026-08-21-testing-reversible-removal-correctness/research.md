---
date: 2026-08-21T08:12:09+02:00
researcher: Claude (10x-research)
git_commit: affd739face67ae1dd0cacfe6036433ede9ceb9f
branch: main
repository: CookBook
topic: "Reversible recipe removal (trash/restore) — round-trip correctness for Phase 3 integration tests"
tags: [research, codebase, recipes, soft-delete, trash, restore, rls, integration-testing]
status: complete
last_updated: 2026-08-21
last_updated_by: Claude (10x-research)
---

# Research: Reversible recipe removal (trash/restore) — round-trip correctness

**Date**: 2026-08-21T08:12:09+02:00
**Researcher**: Claude (10x-research)
**Git Commit**: affd739face67ae1dd0cacfe6036433ede9ceb9f
**Branch**: main
**Repository**: CookBook

## Research Question

For rollout Phase 3 of `context/foundation/test-plan.md` (risk #5 — "reversible recipe removal (trash/restore) loses data or leaves it unrecoverable"): how is trash/restore actually implemented today, what data must survive a round-trip, does the codebase assume restore is the exact inverse of trash, and are partial/concurrent states reachable? This grounds the `/10x-plan` for an integration-test suite proving the round-trip.

## Summary

Trash/restore is a **pure soft-delete** on a single `recipes.deleted_at timestamptz` column — no separate trash table, no row movement. Trash sets `deleted_at = now()`; restore is the **literal, single-column inverse** (`deleted_at = null`). Every other column (`name`, `type`, `instructions`, `photo_path`, `created_at`) and the entire `recipe_ingredients` child table are untouched by both operations, so in the current implementation there is no field that *could* diverge across a round-trip — the risk is not "data gets mutated by trash/restore" but two other things:

1. **RLS does not enforce trash visibility at all.** `recipes_select_own` only checks `user_id`; every read path must remember an explicit `deleted_at is null` (or `is not null` for trash) filter with no database-level backstop. One prior change (`recipe-search-and-browse`) already flagged this as an easy-to-forget gap in its own plan.
2. **Idempotency/concurrency guards are implicit**, resting entirely on the conditional `WHERE`/`.is()`/`.not()` clause of each single-statement `UPDATE` plus Postgres's default READ COMMITTED re-check semantics — never verified against a real database.

There is **zero integration/e2e coverage** today. All three existing test files (`trash.test.ts`, `restore.test.ts`, `index.test.ts`) mock the Supabase client and assert which methods were called, not real row state — exactly the gap this phase is scoped to close.

A secondary finding: the PRD/roadmap **decided** a 30-day recovery window (FR-020, Open Roadmap Question 2) but this window is **not implemented anywhere in code** — recovery is indefinite for MVP by explicit design choice (`recipe-edit-and-remove/plan.md:38`). This is documented drift between spec and code, not a bug; flag it so the integration-test plan doesn't accidentally try to test a TTL that doesn't exist.

## Detailed Findings

### Trash (soft-delete)

- Route: `DELETE /api/recipes/[id]` — `src/pages/api/recipes/[id]/index.ts:109-138`
  ```ts
  const { data, error } = await supabase
    .from("recipes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .single();
  ```
- The `.is("deleted_at", null)` guard makes double-trash a 404, not a silent no-op or error.
- RLS policy `recipes_update_own` (`supabase/migrations/20260815132912_recipe_schema.sql:58-62`) scopes the `UPDATE` to `auth.uid() = user_id` — ownership is enforced entirely by RLS, not by an explicit `user_id` filter in the query.
- UI entry point: `src/components/recipes/RecipeRemoveButton.tsx:30` — confirm dialog ("will be moved to trash, you can restore it") → `DELETE` → redirect to `/recipes` on success.
- Nothing else is written except `deleted_at` and, via the `set_updated_at` trigger (`20260815132912_recipe_schema.sql:41-44`), `updated_at`.

### Restore

- Route: `POST /api/recipes/[id]/restore` — `src/pages/api/recipes/[id]/restore.ts:10-39`
  ```ts
  const { data, error } = await supabase
    .from("recipes")
    .update({ deleted_at: null })
    .eq("id", id)
    .not("deleted_at", "is", null)
    .select("id")
    .single();
  ```
- Literal inverse of trash — no re-validation, no re-insert, no field re-derivation. The `.not("deleted_at", "is", null)` guard makes restoring an active recipe a 404.
- UI entry point: `src/components/recipes/TrashList.tsx:28` ("Przywróć" button on `/recipes/trash`, removes item from local state on success).
- Trash list route: `GET /api/recipes/trash` — `src/pages/api/recipes/trash.ts:21-25`, filters `.not("deleted_at","is",null)`, ordered `deleted_at desc`. Also rendered server-side by `src/pages/recipes/trash.astro:20-24` with the same filter.

### Schema

`supabase/migrations/20260815132912_recipe_schema.sql:25-39`:
```sql
create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type recipe_type not null,
  photo_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index recipes_user_id_idx on recipes (user_id);
create index recipes_user_id_active_idx on recipes (user_id) where deleted_at is null;
```
`instructions text` was added later (`supabase/migrations/20260816180000_add_recipe_instructions.sql:2`).

Origin/rationale (`context/archive/2026-08-15-recipe-data-schema/plan.md:111-114`): `deleted_at timestamptz` — "null = active; soft-delete marker for FR-020." Rejected alternative in the same change (`change.md:17-24`): an opt-in shared/donated-recipe pool instead of pure soft-delete — parked, out of scope, blocked on consent/copyright questions, not revisited here.

### What must survive the round-trip

Because trash/restore only ever touch `deleted_at` (+`updated_at`), every other field is trivially preserved by construction in the current implementation:

- `recipes.name`, `type`, `instructions`, `photo_path`, `created_at` — never part of either `UPDATE`'s SET list.
- `recipe_ingredients` rows (`recipe_id`, `name`, `position`) — a separate table, `on delete cascade` (`20260815132912_recipe_schema.sql:72`), but that cascade only fires on a **hard** delete of the parent row, which no code path ever issues. Trash/restore never touch this table.
- `photo_path` / the underlying Storage object — the ownership trigger `validate_recipe_photo_path_ownership()` (`supabase/migrations/20260819161958_recipe_photo_path_storage_ownership.sql:10-30`) is scoped `before insert or update **of photo_path**` — column-specific — so it never fires during trash/restore (neither `UPDATE` includes `photo_path`). The Storage object is untouched throughout.
- `extraction_attempts.recipe_id` (`20260815140000_extraction_attempts.sql:20`, `on delete set null`) — same reasoning, irrelevant to a soft-delete.
- **Edit-then-remove-then-restore**: the `edit_recipe()` RPC (`supabase/migrations/20260816190000_edit_recipe_instructions.sql:28-43`) fully replaces `recipe_ingredients` (delete-all + reinsert with fresh `position` from array order) atomically, and guards `and deleted_at is null` so it cannot run against an already-trashed recipe. This means the state to verify is: edit (ingredients atomically replaced) → trash (only `deleted_at` set) → restore (only `deleted_at` cleared) → the post-edit ingredient set/positions must still match exactly, since nothing in between touches `recipe_ingredients`.

### RLS does not filter trash visibility — real coverage target

`recipes_select_own` (`20260815132912_recipe_schema.sql:48-51`) only checks `(select auth.uid()) = user_id` — **a trashed recipe is fully selectable via RLS by its owner.** Active-vs-trashed visibility is enforced entirely at the application query layer via `.is("deleted_at", null)` / `.not("deleted_at", "is", null)`, found consistently at:
- `src/lib/services/recipe-query.ts:62` (`listRecipes`), `:104` (`getRecipeDetail`)
- `src/pages/recipes/[id]/edit.astro:27`
- `src/pages/api/recipes/[id]/index.ts:39` (GET)
- `src/pages/recipes/trash.astro:23`, `src/pages/api/recipes/trash.ts:24` (inverse)
- `edit_recipe()` RPC: `and deleted_at is null` (`20260816190000_edit_recipe_instructions.sql:32`)

There is no schema-level backstop (no `security_barrier` view, no RLS predicate on `deleted_at`) — it's convention, not a guarantee. A prior change already flagged this exact gap as a live risk while building an unrelated feature: `context/archive/2026-08-16-recipe-search-and-browse/plan.md:13-15` — "`recipes` has a soft-delete column (`deleted_at`) that **RLS does not filter** — every query this plan writes must add `.is("deleted_at", null)` explicitly," with its own verification checkpoints at `plan.md:436` and `plan.md:465`. This is strong precedent that "does a trashed recipe leak through some read surface" is a real, previously-worried-about failure mode — a good integration-test target for this phase (verify each recipe-reading surface 404s/omits a trashed recipe), not just that trash/restore themselves round-trip.

### Concurrency / idempotency — implicit, unverified

No version column, advisory lock, or idempotency table exists anywhere in this flow. The only guard is the conditional `WHERE`/`.is()`/`.not()` on each single-statement `UPDATE`:
- Double-trash / double-restore: guard clause matches 0 rows on the second call → `.single()` errors → mapped to 404. Not a silent no-op.
- Concurrent double-restore: relies on Postgres's default READ COMMITTED re-check of the `UPDATE ... WHERE` predicate against the post-lock-wait committed row version — the second transaction correctly finds 0 matching rows and 404s. This is implicit engine behavior, never exercised by a test.
- Edit-while-trashed: `edit_recipe()`'s `and deleted_at is null` guard runs inside the same atomic `plpgsql` function that also replaces `recipe_ingredients`, so a trashed recipe's edit fails atomically before any ingredient mutation — PATCH handler maps this to 404 (`src/pages/api/recipes/[id]/index.ts:102-104`). No partial-write risk.
- Genuine gap: none of this is proven against a real Postgres instance today — worth explicit integration-test coverage, per the risk's own "must challenge" framing (do not assume restore is the exact inverse without checking whether partial/concurrent states are reachable).

### Existing test coverage — none real

All three touchpoints are unit-tested only with a fully mocked Supabase client (no `tests/` directory pattern here — these are colocated `*.test.ts` files):
- `src/pages/api/recipes/trash.test.ts`
- `src/pages/api/recipes/[id]/restore.test.ts`
- `src/pages/api/recipes/[id]/index.test.ts` (covers GET/PATCH/DELETE)

These assert which Supabase-client methods were called and HTTP status mapping — never real row state, RLS enforcement, the `edit_recipe()` SQL body, the photo ownership trigger, or concurrent-request races. This is exactly the gap `context/changes/testing-reversible-removal-correctness/change.md` (risk #5) is scoped to close with real integration tests, following the same pattern already established by Phase 2 (`tests/integration/cross-user-rls.test.ts`, real hosted-dev Postgres via `.env.test.local`).

### Recovery-window drift (spec vs. code) — informational, not a test target

`prd.md:182` and `roadmap.md:155` record the 30-day recovery window as **resolved** (matching common trash/recycle-bin convention). But `context/archive/2026-08-16-recipe-edit-and-remove/plan.md:38` explicitly scoped this out: "A hard-delete / purge job for old soft-deleted recipes — recovery stays indefinite for MVP... `deleted_at` is a timestamp column, not a hard TTL." No purge job, no expiry filter, and no TTL logic exist anywhere in the code searched. There is nothing to integration-test here (no enforcement to verify) — but it's worth naming explicitly in the plan so nobody accidentally treats "30 days" as a testable contract.

## Code References

- `src/pages/api/recipes/[id]/index.ts:109-138` — `DELETE` handler (trash): sets `deleted_at`, `.is("deleted_at", null)` guard
- `src/pages/api/recipes/[id]/index.ts:35-40` — `GET` handler: `.is("deleted_at", null)` filter
- `src/pages/api/recipes/[id]/index.ts:102-104` — `PATCH` handler: maps `edit_recipe` RPC `false` result to 404
- `src/pages/api/recipes/[id]/restore.ts:10-39` — `POST` handler (restore): clears `deleted_at`, `.not("deleted_at","is",null)` guard
- `src/pages/api/recipes/trash.ts:21-25` — trash list endpoint
- `src/pages/recipes/trash.astro:20-24` — server-rendered trash page query
- `src/pages/recipes/[id]/edit.astro:27` — `.is("deleted_at", null)` guard on edit-page load
- `src/components/recipes/RecipeRemoveButton.tsx:30` — trash UI trigger + confirm dialog
- `src/components/recipes/TrashList.tsx:28` — restore UI trigger
- `src/lib/services/recipe-query.ts:62,104` — `listRecipes`/`getRecipeDetail` active-recipe filters
- `supabase/migrations/20260815132912_recipe_schema.sql:25-39` — `recipes` table + `deleted_at` column + partial index
- `supabase/migrations/20260815132912_recipe_schema.sql:48-51` — `recipes_select_own` RLS policy (no `deleted_at` check)
- `supabase/migrations/20260815132912_recipe_schema.sql:58-62` — `recipes_update_own` RLS policy
- `supabase/migrations/20260815132912_recipe_schema.sql:72` — `recipe_ingredients` FK `on delete cascade`
- `supabase/migrations/20260816170000_atomic_recipe_ingredient_edit.sql:28` — `edit_recipe()` original guard
- `supabase/migrations/20260816190000_edit_recipe_instructions.sql:28-43` — `edit_recipe()` extended: atomic ingredient replace + `deleted_at is null` guard
- `supabase/migrations/20260819161958_recipe_photo_path_storage_ownership.sql:10-30` — `validate_recipe_photo_path_ownership()` trigger, scoped to `photo_path` column only
- `supabase/migrations/20260815140000_extraction_attempts.sql:20` — `extraction_attempts.recipe_id` FK, `on delete set null`
- `src/pages/api/recipes/trash.test.ts`, `src/pages/api/recipes/[id]/restore.test.ts`, `src/pages/api/recipes/[id]/index.test.ts` — existing mocked-only unit coverage
- `src/types.ts:99-131` — generated `recipes` table type, `deleted_at: string | null`

## Architecture Insights

- Soft-delete-by-timestamp is the project's one and only removal pattern for `recipes` — no generic "trash table" abstraction, no status enum. Simple by design, at the cost of every read path being individually responsible for the active/trashed filter.
- Idempotency is achieved cheaply via conditional `WHERE`/`.is()`/`.not()` clauses on single-statement `UPDATE`s rather than any explicit state machine — this is a recurring, minimal pattern (mirrors the `recipe_photo_path_ownership` trigger's own reliance on Postgres-native guarantees rather than app-level locks).
- RLS in this project is used strictly for **ownership** (cross-user isolation), never for **soft-delete visibility** — that split is consistent across `recipes` and its policies; app code is the sole enforcer of "active vs. trashed," a distinct trust boundary from the RLS-enforced "mine vs. not mine" boundary that Phase 2 (cross-user-access-integrity) already covered.
- The `edit_recipe()` RPC's atomic delete+reinsert-of-ingredients pattern is the only place ingredient state is rewritten; trash/restore deliberately avoid touching it at all, which is precisely why the round-trip risk is really about *read-path leakage* and *concurrent-guard correctness*, not data corruption from the trash/restore operations themselves.

## Historical Context (from prior changes)

- `context/archive/2026-08-15-recipe-data-schema/plan.md:111-114,60-62` — original schema + soft-delete rationale; explicit non-goal of a purge job.
- `context/archive/2026-08-15-recipe-data-schema/change.md:17-24` — parked "shared/donated recipe pool" alternative, rejected for consent/copyright reasons; not relevant to this phase but explains why pure soft-delete (not a trash table with visibility to others) was chosen.
- `context/archive/2026-08-16-recipe-edit-and-remove/plan.md:79-95` — original trash/restore/trash-list endpoint contracts (matches current code exactly); `plan.md:38` — explicit "no purge job, indefinite recovery for MVP" scope decision.
- `context/archive/2026-08-16-recipe-edit-and-remove/plan-brief.md:23,31` — UX rationale for a dedicated trash view over an undo toast; 30-day window decision record.
- `context/archive/2026-08-16-recipe-search-and-browse/plan.md:13-15,107-109,436,465` — independent confirmation that "RLS doesn't filter `deleted_at`, every read must remember the explicit filter" was already a recognized risk in a prior, unrelated change — directly supports prioritizing read-path leak tests in this phase.
- `context/archive/2026-08-19-testing-cross-user-access-integrity/research.md:78,158,222-223` — catalogued the same trash/restore endpoints and `deleted_at` column while researching cross-user RLS; scope there was ownership, not soft-delete correctness, so it left this risk untouched — confirms no overlap/duplication with Phase 2's shipped tests.
- `context/foundation/prd.md:147-148` (FR-020), `:43-44` (Guardrails), `:182` (30-day resolution) — requirement source.
- `context/foundation/roadmap.md:78-81` (F-02), `:118-126` (S-03), `:155` (Open Question 2 resolution) — slice/likelihood source.
- `context/foundation/test-plan.md` §2 row 5 and Risk Response Guidance row 5, §3 Phase 3 row — the governing risk and rollout entry for this change.

## Related Research

- `context/changes/testing-reversible-removal-correctness/change.md` — this change's identity file (risk #5 intent).
- `context/archive/2026-08-19-testing-cross-user-access-integrity/research.md` — sibling Phase 2 research; establishes the integration-test harness pattern (`tests/integration/`, `.env.test.local`, real hosted-dev Postgres) this phase should reuse rather than re-derive.
- `context/archive/2026-08-19-testing-cross-user-access-integrity/plan.md` and `reviews/impl-review.md` — precedent for RLS-adjacent integration-test structure and the F2/F3-style findings (join-based ownership checks, missing `search_path`) that a careful reviewer should watch for again here (e.g., does any new trigger/function this phase might touch also need explicit `search_path`?).

## Open Questions

- Should read-path "trashed recipe never leaks" coverage (detail/edit/list/search surfaces) be scoped into this phase, or deferred as a narrower follow-up? The risk statement (#5) is framed around the round-trip itself, but the strongest historical signal (`recipe-search-and-browse`'s own risk note) points at leak-through-a-forgotten-filter as the more likely real-world failure mode. Recommend `/10x-plan` decide explicitly rather than silently including or excluding it.
- Is proving the concurrent-double-restore race (relying on Postgres's implicit READ COMMITTED re-check) worth a dedicated integration test, given it requires deliberately racing two requests? Cheapest layer per the risk's own guidance is "integration test on the trash/restore flow" — worth scoping whether that includes a concurrency case or stays to sequential round-trip + guard-rejection assertions.
- No action needed on the 30-day recovery window — flagged above as documented-but-unimplemented; nothing to test.
