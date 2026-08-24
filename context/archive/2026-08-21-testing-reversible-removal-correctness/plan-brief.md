# Reversible Removal Correctness — Plan Brief

> Full plan: `context/changes/testing-reversible-removal-correctness/plan.md`
> Research: `context/changes/testing-reversible-removal-correctness/research.md`

## What & Why

Rollout Phase 3 of `context/foundation/test-plan.md` (risk #5). Adds real, unmocked
integration-test coverage proving a recipe's trash → restore round-trip preserves all data, and
that the application's soft-delete visibility filter — the one thing RLS does not enforce for
this table — actually excludes trashed recipes from every read surface that must exclude them.

## Starting Point

Trash/restore touches only `recipes.deleted_at`, so field-level corruption isn't structurally
possible today. The two real, currently-unverified gaps are: (1) RLS checks ownership only, so
every read path independently enforces "active vs. trashed" via an app-level `.is()`/`.not()`
filter with no database backstop — a prior unrelated change already hit this exact class of bug;
(2) idempotency (double-trash, double-restore) relies on an unverified conditional-`UPDATE`
guard. All three existing tests at this touchpoint mock Supabase entirely — zero real coverage.

## Desired End State

Two new integration-test files under `tests/integration/`, run via `npm run test:integration`
against the hosted `SnapRecipe` dev project, proving both the round-trip and the visibility
filter hold against a real Postgres instance — and `test-plan.md` §6.3 documents this as a
reusable pattern.

## Key Decisions Made

| Decision                          | Choice                                                        | Why (1 sentence)                                                                 | Source   |
| ---------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| Read-path leak coverage           | In scope                                                       | Strongest historically-grounded failure mode; no DB-level backstop exists.       | Plan     |
| Concurrent-restore race test      | Excluded — sequential guard-rejection only                     | Same guard mechanism as sequential case; avoids flaky timing-dependent tests.    | Plan     |
| Round-trip scenario depth         | Full set: simple, edit-then-trash-then-restore, guard rejection| Matches risk #5's explicit wording and research's identified idempotency gap.    | Plan     |
| Test file organization            | Two files, one per concern                                     | Matches existing convention (`photo-path-ownership.test.ts`, `cross-user-rls.test.ts`). | Plan     |
| Test call layer                   | Call real service functions / direct table queries, not HTTP   | Matches existing convention; no route-handler test infra exists in this project. | Research |

## Scope

**In scope:**

- Trash → restore round-trip preservation (all fields + ingredients)
- Edit-then-trash-then-restore sequence
- Double-trash / double-restore guard-rejection
- Trashed-recipe exclusion from `listRecipes()`, `getRecipeDetail()`, trash-list query, and
  `edit_recipe` RPC

**Out of scope:**

- Concurrent-request race testing
- The documented-but-unimplemented 30-day recovery window
- Changes to the existing mocked unit tests at this touchpoint
- `photo_path`/storage-object survival (structurally untouched by trash/restore, already
  confirmed by research)

## Architecture / Approach

Two single-concern integration-test files following the exact harness Phase 2 shipped
(`createTestUser()`, hosted dev Postgres via `.env.test.local`, `npm run test:integration`).
Tests call real production functions (`listRecipes`, `getRecipeDetail`, `edit_recipe` RPC) where
they exist as extractable functions, and mirror the exact `.is()`/`.not()` guard clauses used by
the API routes elsewhere, asserting on real returned row state.

## Phases at a Glance

| Phase                | What it delivers                                                | Key risk                                                        |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Round-trip integrity | `trash-restore-roundtrip.test.ts` — 4 cases                    | Getting the edit-then-trash-then-restore ingredient assertion right |
| 2. Visibility          | `trashed-recipe-visibility.test.ts` — 4 cases                    | None significant — direct precedent from Phase 2                  |
| 3. Cookbook update     | §6.3 variant note in `test-plan.md`                                | None                                                               |

**Prerequisites:** `.env.test.local` populated (already required and in place from Phase 2).
**Estimated effort:** ~1 session, 3 phases, ~8 new test cases across 2 files.

## Open Risks & Assumptions

- Assumes `createTestUser()`'s no-cleanup behavior (accepted clutter in dev, per Phase 2
  precedent) doesn't interfere with these specific assertions across repeated runs — Phase 1's
  manual verification step checks this explicitly.

## Success Criteria (Summary)

- `npm run test:integration` passes with both new files included, twice in a row (no flakiness).
- A trashed recipe is provably invisible to `listRecipes()`, `getRecipeDetail()`, and
  `edit_recipe()`, and provably absent from the active-recipe set after a round-trip's ingredient
  set is checked against its post-edit state.
