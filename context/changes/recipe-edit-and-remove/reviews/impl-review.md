<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Recipe Edit and Reversible Removal Implementation Plan

- **Plan**: context/changes/recipe-edit-and-remove/plan.md
- **Scope**: Phase 1-4 of 4 (all automated success criteria complete; manual verification intentionally deferred — see note below)
- **Date**: 2026-08-16
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 0 observations

> **Note on manual verification**: per explicit user instruction for this session, all manual verification steps across all 4 phases are deliberately left unchecked in `## Progress` and will be batch-tested by the user once, after all phases land — this is not rubber-stamping or an oversight. Automated verification (tests/typecheck/lint/build) passed and was re-run fresh for every phase before each commit.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (automated); manual pending by design |

## Findings

### F1 — Ingredient reorder not implemented

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/recipes/RecipeEditForm.tsx
- **Detail**: The plan's Phase 3 Intent text for the edit form explicitly calls for "a dynamic list of ingredient text rows with add/remove/reorder controls." The implementation has `addIngredient`/`removeIngredient` but no reorder mechanism (no move-up/move-down buttons, no drag handle, no index-swap logic). The plan's **Contract** line for this file doesn't separately re-state reorder as part of the interface, so this is a soft drift (Intent-prose vs. actual scope) rather than a broken contract — ingredient order can still be set at extraction time and edited by delete+re-add, just not reordered in place.
- **Fix**: Add move-up/move-down icon buttons per ingredient row (swap adjacent array indices in `ingredients` state) — small, self-contained addition to the existing row-rendering loop.
- **Decision**: FIXED — added ArrowUp/ArrowDown buttons per ingredient row in `RecipeEditForm.tsx` (`moveIngredient`), disabled at the list boundaries.

### F2 — Ingredient full-replace ordering: insert-then-delete accepts a duplicate-row window on partial failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/recipes/[id]/index.ts:96-123 (PATCH handler)
- **Detail**: This matches the plan exactly — the plan's "Critical Implementation Details" section deliberately chose insert-before-delete (capture old ingredient ids, insert new rows, then delete by the captured old ids) specifically to avoid a zero-ingredient window if the second step fails, and accepted the alternative risk ("a few orphaned old rows... self-corrects the next time the recipe is edited") at plan-writing time. The safety-review sub-agent re-flagged this same tradeoff independently: if insert succeeds but the subsequent delete-by-id fails, the response is a 500 but the new ingredients are already persisted alongside the stale ones — a subsequent GET would show duplicated/mixed ingredients rather than the zero-ingredient state the ordering was chosen to avoid. The existing test suite covers insert-failure but not delete-failure-after-successful-insert, so this specific gap is untested. This is a pre-existing, documented, low-probability tradeoff (both Supabase calls are same-request, back-to-back) rather than a newly-introduced bug — not CRITICAL given how narrow and self-correcting the failure window is, but worth a second look since a strictly better fix exists.
- **Fix A ⭐ Recommended**: Wrap the update+insert+delete in a single Postgres function called via `.rpc()`, matching the atomic-operation precedent already used for `reserve_extraction_attempt` in `src/pages/api/recipes.ts`. This eliminates both the zero-ingredient window and the duplicate-row window in one move.
  - Strength: Removes the entire failure class rather than trading one edge case for another; reuses a pattern already proven in this codebase.
  - Tradeoff: Requires a new Postgres function + migration, and a bit more test setup (mocking `.rpc()` instead of chained table calls) — real but bounded effort.
  - Confidence: HIGH — the codebase already has exactly this pattern for a similar atomicity need.
  - Blind spot: Haven't scoped the exact function signature/migration; assumed straightforward given the existing RPC precedent.
- **Fix B**: Leave as-is — this is the plan's deliberate, reasoned choice and the failure window is narrow and self-correcting.
  - Strength: Zero additional work; matches what was explicitly planned and already shipped in Phase 1's commit.
  - Tradeoff: A rare partial failure still leaves duplicated ingredients until the next edit, with a generic 500 that doesn't distinguish "fully failed" from "partially applied."
  - Confidence: MEDIUM — acceptable for a single-user personal app under a speed-oriented roadmap goal, but the risk is real, just small.
  - Blind spot: No telemetry in this app to detect if this ever actually happens in practice.
- **Decision**: FIXED via Fix A — added `edit_recipe()` Postgres function (migration `20260816170000_atomic_recipe_ingredient_edit.sql`, applied to the SnapRecipe dev project), rewired `PATCH /api/recipes/[id]` to call it via `.rpc()`, updated `src/types.ts` and the route's tests accordingly. Plan's Critical Implementation Details section annotated with an addendum pointing here.

## Positive notes (no action needed)

- `PATCH` in `[id]/index.ts` gates its update on `.is("deleted_at", null)`, which is *stricter* than the existing sibling `type.ts` PATCH (no such gate) — this is an improvement over precedent, not a regression. Worth back-porting to `type.ts` in a future change, not this one.
- Both review sub-agents independently confirmed: RLS fully covers ownership enforcement for `recipes` and `recipe_ingredients` (no route adds a redundant `user_id` filter, consistent with the existing `type.ts` convention); no scope-boundary violations against "What We're NOT Doing"; no N+1 queries; pattern conventions (jsonResponse-per-file, component status-machine naming, Polish copy, shadcn usage) all follow existing precedent rather than breaking it.
