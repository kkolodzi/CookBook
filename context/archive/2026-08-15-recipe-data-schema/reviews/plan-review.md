<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Recipe Data Schema Implementation Plan

- **Plan**: context/changes/recipe-data-schema/plan.md
- **Mode**: Deep
- **Date**: 2026-08-15
- **Verdict**: REVISE
- **Findings**: 2 critical, 2 warnings

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

6/6 paths ✓, 3/3 symbols ✓, brief↔plan ✓. Phase 1 was already implemented and pushed live
against the real `SnapRecipe` (dev) database at review time — several claims below were
verified directly against that live project rather than by inspection alone.

## Findings

### F1 — RLS is verified as "enabled," never as actually blocking unauthorized access

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 & Phase 4, Manual Verification
- **Detail**: Every RLS check in this plan (Phase 1's "RLS is enabled on both tables (Studio's
  table editor shows the RLS badge)", Phase 4's equivalent) only confirms RLS is *turned on*,
  never that the policies actually *block* cross-user access. A policy with a typo'd predicate
  (e.g. `using (true)`) would still show the "enabled" badge and pass every check in this plan
  while leaking every user's data. Given the PRD's Access Control section states "no user can
  access another user's collection under any circumstance," this is the single load-bearing
  security guarantee of the entire app, and it's currently only positively tested (query as
  the owning user, confirm rows come back) — never negatively tested (query as someone/something
  else, confirm zero rows).
- **Fix**: Add a negative RLS check to Phase 3 (after seed data exists, so there's something to
  potentially leak): query `recipes`/`recipe_ingredients` using the anon key (no `Authorization`
  header) and confirm it returns zero rows / a permission error, not the seeded data. Mirror the
  same check in Phase 4 against the (empty, but still policy-bearing) live project. This doesn't
  require a second real user — proving the `to authenticated` restriction actually holds is the
  meaningful, cheap test available with only one dev user on hand.
- **Decision**: FIXED — added Manual Verification bullets + Progress rows 3.5 (Phase 3) and 4.6 (Phase 4)

### F2 — Progress section is missing two Success Criteria rows (Phase 1 & Phase 4)

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Manual Verification (3rd bullet) / `## Progress` → Phase 1; Phase 4
  Manual Verification (2nd bullet) / `## Progress` → Phase 4
- **Detail**: Mechanical Progress↔Phase check: Phase 1's Manual Verification has 3 bullets, but
  `## Progress` → Phase 1 → Manual only has 2 rows (1.4, 1.5) — the third bullet ("Querying as
  the seeded dev user... returns only that user's rows") has no matching checkbox. Phase 4's
  Manual Verification has 3 bullets, but Progress → Phase 4 → Manual only has 2 rows (4.3, 4.4)
  — the second bullet ("RLS is enabled on both tables and storage policies are present, matching
  dev") has no matching checkbox. A bullet without a Progress row is a check `/10x-implement`
  will never be prompted to gate on.
- **Fix**: Phase 1's orphaned bullet is explicitly self-described as "spot-checked later in
  Phase 3, not blocking here" and is genuinely redundant with Phase 3's own `3.3` — remove that
  bullet from Phase 1's Manual Verification rather than add a vacuous checkbox for something
  already marked non-blocking. Phase 4's orphaned bullet is a real, blocking check with no such
  caveat — add a Progress row for it (renumbering the existing 4.3/4.4 to 4.4/4.5, new row
  becomes 4.3).
- **Decision**: FIXED — removed Phase 1's orphaned bullet; added Progress row 4.4 (RLS + storage policies matching dev) for Phase 4, renumbered 4.5/4.6

### F3 — Storage `owner` column: plan's stated assumption was wrong, now verified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details, "`storage.objects` ownership column name
  varies by Supabase CLI/platform version"
- **Detail**: The plan guessed "recent versions use `owner_id` (uuid); older ones used `owner`."
  I queried `information_schema.columns` against the live `SnapRecipe` project directly:
  **both** columns exist — `owner` is `uuid`, but `owner_id` is `text`, not `uuid` as the plan
  assumed. Using `owner_id` would need an explicit cast (`owner_id = (select auth.uid())::text`)
  to type-match `auth.uid()`; `owner` type-matches directly.
- **Fix**: Replace the guess in Critical Implementation Details with the verified fact: use
  `owner uuid` (via `owner = (select auth.uid())`) in the Phase 2 storage policies — no cast
  needed, no more "verify before writing this" hedge required.
- **Decision**: FIXED — Critical Implementation Details and Phase 2 Contract updated with verified column + predicate

### F4 — Phase 1's documented RLS predicate is stale relative to what was actually applied

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Changes Required → Contract
- **Detail**: The plan's Contract text says policies key on `auth.uid() = user_id` (unwrapped).
  The actually-applied migration (`supabase/migrations/20260815132912_recipe_schema.sql`,
  confirmed via `grep`) uses `(select auth.uid()) = user_id` instead — the Supabase-recommended
  performance pattern (wrapping in `select` lets Postgres evaluate it once and cache it, instead
  of once per row) applied after the plan text was written but before the migration was
  authored. The deviation is a genuine improvement, but the plan's Contract section no longer
  describes what was actually built.
- **Fix**: Update the Phase 1 Contract text to show `(select auth.uid())` throughout, matching
  the applied migration.
- **Decision**: FIXED — Phase 1 Contract text updated to match the applied migration
