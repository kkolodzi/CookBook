<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fix Polish Ingredient Search Implementation Plan

- **Plan**: context/changes/fix-polish-ingredient-search/plan.md
- **Scope**: Phase 1 of 2 (full plan)
- **Date**: 2026-08-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning (fixed), 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

**Git scope**: commits `e05935f` (p1), `d190a79` (p2), `c3a28a3` (epilogue). Changed files: `supabase/migrations/20260825140334_polish_ingredient_search.sql`, `tests/integration/polish-ingredient-search.test.ts`, `src/types.ts`, `src/lib/services/recipe-query.ts`, `src/lib/services/recipe-query.test.ts` (plus `context/changes/fix-polish-ingredient-search/*` and `context/foundation/roadmap.md`, both process docs).

**Plan Adherence** — both phases verified against actual file contents by an independent sub-agent: migration function/trigger/backfill/RPC match the plan's contract exactly (including the guard-threshold correction from ≥5 to ≥3, confirmed as a deliberate, user-approved implementation-time correction, not drift); `listRecipes()`'s RPC branch and the no-query path match; unit and integration tests match the plan's described coverage.

**Scope Discipline** — guardrails held: FR-014 (name search) untouched (no `ilike`-on-name matches anywhere in `src/`), no `pg_trgm`/index added, `.husky/pre-commit` untouched.

**Safety & Quality** — `search_recipes_by_ingredient()` mirrors `edit_recipe()`'s security pattern exactly (`security definer`, explicit `auth.uid()` check, `set search_path = public`, filters by `user_id` directly rather than relying on RLS). `normalize_polish_ingredient()` is called as a plain function, never inside dynamic/`execute` SQL — no injection vector; the `ilike '%' || v_normalized_query || '%'` is standard parameter-bound WHERE-clause use of a `text` variable. Bonus finding: the tokenizer strips `%`/`_`/`\` entirely, so the search value can never contain ilike wildcard metacharacters — safer by construction than the old JS-side manual escaping it replaces. Backfill handles `NULL` input gracefully, is forward-only (no destructive DDL), consistent with every prior migration in this project. No new index needed — `ilike` with a leading wildcard can't use a btree index regardless, and the query is already bounded by `limit 200` plus the mandatory `user_id` filter, matching the app's existing single-user-scale profile (not a regression).

**Architecture** — RPC-based query-time normalization plus a write-time-synced column via trigger keeps all three existing write paths (API insert, `edit_recipe()` RPC, seed data) working without touching any of them, exactly as the plan intended.

**Pattern Consistency** — `recipe-query.ts`'s new RPC branch uses `if (error) return []`, matching `getRecipeDetail`'s existing error handling in the same file. The new integration test mirrors `trash-restore-roundtrip.test.ts`'s structure (`createTestUser`, `beforeAll`, local setup helpers, unique markers to avoid cross-test collisions).

**Success Criteria** — Automated: `npm run test` (73/73), `npm run lint` (0 errors), `npm run test:integration` (48/48, including 19 new declension-pair tests against real Postgres). Manual: all 5 manual rows (1.4, 2.3–2.6) marked `[x]` in Progress with the user explicitly confirming each round (including a substantive side-discussion about compound-ingredient substring matching, resolved as pre-existing/accepted PRD behavior, not a regression).

## Findings

### F1 — src/types.ts didn't match Prettier formatting after regeneration

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/types.ts (whole file)
- **Detail**: The Supabase CLI's regenerated types output uses no semicolons and different line-wrapping than this repo's Prettier config (`semi: true`, `printWidth: 120`) — confirmed via `npx prettier --check src/types.ts` failing. `npm run lint`'s `eslint --fix` doesn't touch formatting-only issues in `.ts` files (pre-commit `lint-staged` only runs `prettier --write` on `*.{json,css,md}`), so this would have stayed broken indefinitely without being caught.
- **Fix**: Run `npx prettier --write src/types.ts`.
- **Decision**: FIXED — applied during this review's verification pass (`npx prettier --write src/types.ts`); re-ran `npx tsc --noEmit` and `npm run lint` afterward, both clean, no regressions.
