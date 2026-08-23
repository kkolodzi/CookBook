# Reversible Removal Correctness — Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md` (risk #5). Adds real, unmocked
integration-test coverage proving that a recipe's trash → restore round-trip preserves all
data, and that the application's soft-delete visibility filter — the one thing RLS does not
enforce — actually excludes trashed recipes from every read surface that must exclude them.

## Current State Analysis

Trash/restore is a pure soft-delete on `recipes.deleted_at timestamptz`: `DELETE
/api/recipes/[id]` sets it, `POST /api/recipes/[id]/restore` clears it
(`src/pages/api/recipes/[id]/index.ts:109-138`, `src/pages/api/recipes/[id]/restore.ts:10-39`).
Neither operation touches any other column or the `recipe_ingredients` child table, so
field-level corruption across the round-trip is not structurally possible today — but two real
gaps exist and are both currently unverified against a real database:

1. `recipes_select_own` RLS (`supabase/migrations/20260815132912_recipe_schema.sql:48-51`)
   checks ownership only, never `deleted_at` — a trashed recipe is fully selectable by its
   owner via RLS. Every read surface independently applies its own `.is()`/`.not()` filter, with
   no schema-level backstop. A prior, unrelated change
   (`context/archive/2026-08-16-recipe-search-and-browse/plan.md:13-15`) already flagged this
   exact "forgot the filter" failure mode as a live risk.
2. Idempotency (double-trash, double-restore) relies entirely on the conditional
   `.is()`/`.not()` clause of each single-statement `UPDATE` re-checking against the committed
   row — never exercised by a test.

All three existing tests at this touchpoint (`src/pages/api/recipes/trash.test.ts`,
`src/pages/api/recipes/[id]/restore.test.ts`, `src/pages/api/recipes/[id]/index.test.ts`) fully
mock the Supabase client and assert which methods were called — zero real-row-state coverage.

Two prior integration-test phases already shipped the harness this plan reuses:
`tests/integration/helpers/test-client.ts` (`createTestUser()`, `createAnonClient()`),
`vitest.integration.config.ts`, run via `npm run test:integration`, targeting the hosted
`SnapRecipe` **dev** project via `.env.test.local` — never `SnapRecipe_live`. Existing files
(`cross-user-rls.test.ts`, `photo-path-ownership.test.ts`, `harness-smoke.test.ts`) establish a
one-file-per-concern convention, and consistently exercise the `recipes`/`recipe_ingredients`
tables (and, where they exist, extracted service functions) directly with the Supabase client —
never through Astro API routes or pages.

### Key Discoveries:

- `listRecipes()` and `getRecipeDetail()` (`src/lib/services/recipe-query.ts:46-92,94-144`) are
  plain exported functions taking `(supabase, userId, ...)` — callable directly from an
  integration test, so the visibility tests can exercise the actual production filter logic
  rather than re-implementing it inline.
- The trash-list surfaces (`src/pages/api/recipes/trash.ts:21-25`,
  `src/pages/recipes/trash.astro:20-24`) are Astro route/page files, not extractable functions —
  consistent with existing convention, their invariant (`.not("deleted_at", "is", null)`
  correctly excludes an active recipe) is verified via a direct table query, the same way
  `cross-user-rls.test.ts` verifies RLS invariants directly rather than driving them through a
  page.
- `edit_recipe()` RPC (`supabase/migrations/20260816190000_edit_recipe_instructions.sql:28-43`)
  guards `and deleted_at is null` and atomically replaces `recipe_ingredients` — this is the
  mechanism the edit-then-trash-then-restore scenario depends on: ingredients are rewritten only
  by this RPC, never by trash/restore, so whatever `edit_recipe()` leaves behind must still match
  exactly after a trash/restore round-trip.
- `edit_recipe` RPC signature (from `cross-user-rls.test.ts:209-214`):
  `rpc("edit_recipe", { p_recipe_id, p_name, p_type, p_ingredients })`, returns `boolean` (not an
  error) on ownership/guard rejection.

## Desired End State

Two new integration-test files exist under `tests/integration/`, both passing against the
hosted `SnapRecipe` dev project via `npm run test:integration`:

- `trash-restore-roundtrip.test.ts` proves data survives a trash→restore round-trip (including
  an edit-then-trash-then-restore sequence) and that double-trash/double-restore are rejected,
  not silently accepted.
- `trashed-recipe-visibility.test.ts` proves a trashed recipe is excluded from every read
  surface with an independent `deleted_at` filter, and that an active recipe is excluded from
  the trash-list query.

`context/foundation/test-plan.md` §6.3 documents this as a named variant of the existing
integration-test cookbook pattern.

### Key Discoveries:

(see Current State Analysis above — consolidated there per plan convention)

## What We're NOT Doing

- Not adding a concurrent-double-restore race test (two simultaneous requests via
  `Promise.all`) — decided against per cost/reliability tradeoff; sequential guard-rejection
  (double-trash, double-restore → 404-equivalent empty result) is the chosen coverage for the
  idempotency risk.
- Not testing the 30-day recovery window — confirmed by research as documented-but-unimplemented
  (`context/archive/2026-08-16-recipe-edit-and-remove/plan.md:38`); there is no enforcement to
  test.
- Not modifying or replacing the three existing mocked unit tests
  (`trash.test.ts`, `restore.test.ts`, `index.test.ts`) — they cover a different, still-valid
  concern (HTTP status mapping / which Supabase methods get called) and stay as-is.
- Not driving these tests through the actual Astro API routes or pages (no HTTP server, no
  route-handler invocation) — consistent with the existing integration-test convention of
  exercising the database/service-function layer directly.
- Not testing the `validate_recipe_photo_path_ownership()` trigger or storage-object survival —
  research confirmed it's scoped to `photo_path`-column updates only and structurally cannot
  fire during trash/restore; already out of scope for risk #5.

## Implementation Approach

Two single-concern integration-test files, following the exact harness and conventions Phase 2
established. Each test seeds its own recipe via `createTestUser()` + a direct `recipes` insert
(mirroring `createRecipeAs()` in `cross-user-rls.test.ts`), drives state transitions with the
same table-level `.update()` calls the production routes use (mirroring their `.is()`/`.not()`
guards exactly, since these tests exist specifically to prove *those* guards work), and asserts
against real returned row state — never a mock.

## Phase 1: Trash/restore round-trip integrity

### Overview

Proves a full trash → restore round-trip preserves every recipe field and all ingredients,
including when an edit precedes the trash, and that trash/restore each reject being called
twice in a row.

### Changes Required:

#### 1. New integration test file

**File**: `tests/integration/trash-restore-roundtrip.test.ts`

**Intent**: Prove the round-trip preserves data (risk #5's core claim) and that the idempotency
guard on each operation actually rejects a repeat call, rather than assuming Postgres's
READ COMMITTED re-check behaves correctly.

**Contract**: A `describe("trash/restore round-trip")` block, one `beforeAll`-created test user
(single-user scope — this is not a cross-user risk), with these cases:

- `it("a trash -> restore round-trip preserves all recipe fields and ingredients")` — insert a
  recipe with 2+ `recipe_ingredients` rows, trash it
  (`.update({ deleted_at: <iso> }).eq("id", id).is("deleted_at", null)`), assert
  `deleted_at` is now set, restore it (`.update({ deleted_at: null }).eq("id",
  id).not("deleted_at", "is", null)`), then assert every original field (`name`, `type`,
  `instructions`, `photo_path`, `created_at`) and the full `recipe_ingredients` set (by `name`
  and `position`) are unchanged from before trashing.
- `it("an edit -> trash -> restore round-trip preserves the post-edit ingredient set and positions")`
  — insert a recipe, call the `edit_recipe` RPC to replace its ingredients with a distinct new
  set (per `edit_recipe` signature: `p_recipe_id`, `p_name`, `p_type`, `p_ingredients`), trash,
  restore, then assert `recipe_ingredients` matches the **post-edit** set exactly (not the
  original insert-time set) — this is the scenario risk #5 names explicitly.
- `it("double-trashing an already-trashed recipe is rejected, not a silent no-op")` — trash
  once (succeeds), trash again with the same guarded query, assert the second call's `.single()`
  errors / returns no row (mirrors the production `.is("deleted_at", null)` guard becoming
  unsatisfiable), then assert the recipe is still trashed with its original `deleted_at`
  timestamp unchanged by the second call.
- `it("double-restoring an already-active (or never-trashed) recipe is rejected, not a silent no-op")`
  — same shape, inverse guard (`.not("deleted_at", "is", null)`).

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:integration`
- Lint passes: `npm run lint`
- Type checking passes: `npm run lint` (project's type-checked ESLint config covers this; no
  separate `tsc` script exists)

#### Manual Verification:

- Run `npm run test:integration -- trash-restore-roundtrip` locally against the dev project and
  confirm all 4 cases pass with no flakiness on a second run.

---

## Phase 2: Trashed-recipe read-path visibility

### Overview

Proves the application-level `deleted_at` filter — the sole enforcement mechanism since RLS
doesn't check it — actually excludes a trashed recipe from every read surface that must exclude
it, and that the trash-list surface correctly excludes an active recipe (the inverse leak).

### Changes Required:

#### 1. New integration test file

**File**: `tests/integration/trashed-recipe-visibility.test.ts`

**Intent**: Close the read-path leak gap research identified as the strongest historically
grounded failure mode for this risk (`recipe-search-and-browse` already hit this exact class of
bug in its own plan). Exercises real production functions/queries, not re-implementations of
their filters.

**Contract**: A `describe("trashed recipe visibility")` block, one `beforeAll`-created test
user, one trashed recipe (with a distinct name) and one active recipe seeded per test as needed:

- `it("listRecipes() excludes a trashed recipe")` — import and call
  `listRecipes(supabase, userId, {})` directly from `@/lib/services/recipe-query`; assert the
  trashed recipe's id is absent from the returned array while the active recipe's id is present.
- `it("getRecipeDetail() returns null for a trashed recipe")` — call
  `getRecipeDetail(supabase, userId, trashedRecipeId)` directly; assert it returns `null` (its
  documented not-found behavior), matching the API layer's 404 mapping.
- `it("the trash-list query excludes an active recipe")` — run the same query shape trash.ts
  uses (`.from("recipes").select().eq("user_id", userId).not("deleted_at", "is",
  null)`) directly against the seeded pair; assert only the trashed recipe's id is returned.
- `it("edit_recipe RPC rejects an edit against a trashed recipe")` — call the `edit_recipe` RPC
  against the trashed recipe's id; assert it returns `false` (the RPC's documented
  ownership/guard-rejection contract, per the `cross-user-rls.test.ts` precedent for this same
  RPC) and that `recipe_ingredients` for that recipe is unchanged.

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:integration`
- Lint passes: `npm run lint`

#### Manual Verification:

- Run `npm run test:integration -- trashed-recipe-visibility` locally against the dev project
  and confirm all 4 cases pass with no flakiness on a second run.

---

## Phase 3: Cookbook update

### Overview

Documents this phase's pattern in `context/foundation/test-plan.md` §6.3 as a named variant, and
reconciles §3's rollout-phase status, so a future contributor adding a soft-delete visibility
test elsewhere in the project finds this precedent instead of re-deriving it.

### Changes Required:

#### 1. Cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Extend §6.3 ("Adding an RLS / cross-user integration test") with a short "Variant:
soft-delete / app-level visibility filters" note — same harness, same file-location convention,
same run command, but the invariant under test is an app-level query filter rather than an RLS
policy. Point to `tests/integration/trash-restore-roundtrip.test.ts` and
`trashed-recipe-visibility.test.ts` as reference tests for this variant.

**Contract**: A new bullet or short paragraph appended inside §6.3, not a new top-level §6.x
section — the location/helper/prerequisites/run-command conventions it already documents apply
unchanged; only the "what invariant this proves" line differs for the variant.

#### 2. Rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: Once both test files are implemented and passing, §3 Phase 3's row should read
`complete` (this is normally reconciled by `/10x-test-plan` after `/10x-implement` finishes, per
its lazy-reconciliation rule — named here only so the implementer/reviewer knows not to
hand-edit it mid-phase).

**Contract**: No edit in this phase — informational only; §3 status is orchestrator-owned.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (Markdown isn't linted, but confirms no adjacent code drift)

#### Manual Verification:

- §6.3 reads coherently with the new variant note in place; a reader unfamiliar with this phase
  could use it to locate the reference tests.

---

## Testing Strategy

### Unit Tests:

- None added — this phase is scoped entirely to integration coverage per risk #5's response
  guidance ("integration test on the trash/restore flow"); the existing mocked unit tests at
  this touchpoint already cover HTTP-layer contract behavior and are left untouched.

### Integration Tests:

- Phase 1 and Phase 2 test files, as detailed above.

### Manual Testing Steps:

1. Run `npm run test:integration` locally against `SnapRecipe` dev and confirm both new files
   pass alongside the existing three integration files with zero regressions.
2. Run the full suite a second time immediately after to catch any test-user or fixture
   leakage between runs (this project's `createTestUser()` never cleans up users by design, so
   confirm this doesn't cause cross-run interference for these specific tests).

## Performance Considerations

None — these are integration tests against a dev database, not a performance-sensitive code
path. Test count (8 new `it` blocks) is small enough not to meaningfully affect
`npm run test:integration` runtime.

## Migration Notes

Not applicable — no schema or data changes in this phase.

## References

- Research: `context/changes/testing-reversible-removal-correctness/research.md`
- Change identity: `context/changes/testing-reversible-removal-correctness/change.md`
- Reference integration tests: `tests/integration/cross-user-rls.test.ts`,
  `tests/integration/photo-path-ownership.test.ts`
- Test harness: `tests/integration/helpers/test-client.ts`
- Governing risk: `context/foundation/test-plan.md` §2 row 5, Risk Response Guidance row 5, §3
  Phase 3

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Trash/restore round-trip integrity

#### Automated

- [x] 1.1 Integration suite passes: `npm run test:integration` — 26575ba
- [x] 1.2 Lint passes: `npm run lint` — 26575ba

#### Manual

- [x] 1.3 `npm run test:integration -- trash-restore-roundtrip` passes twice in a row, no
      flakiness — 26575ba

### Phase 2: Trashed-recipe read-path visibility

#### Automated

- [x] 2.1 Integration suite passes: `npm run test:integration` — 26575ba
- [x] 2.2 Lint passes: `npm run lint` — 26575ba

#### Manual

- [x] 2.3 `npm run test:integration -- trashed-recipe-visibility` passes twice in a row, no
      flakiness — 26575ba

### Phase 3: Cookbook update

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 26575ba

#### Manual

- [x] 3.2 §6.3 variant note reads coherently and points to the correct reference tests — 26575ba
