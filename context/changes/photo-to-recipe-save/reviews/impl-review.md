<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Photo Upload → AI Extraction → Recipe Save

- **Plan**: context/changes/photo-to-recipe-save/plan.md
- **Scope**: Phase 1-2 of 7
- **Date**: 2026-08-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Missing index on `extraction_attempts.recipe_id`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260815140000_extraction_attempts.sql:20,27
- **Detail**: An index is created for `(user_id, created_at)` but not for `recipe_id`, unlike the reference migration (`recipe_schema.sql`) where every FK column gets its own index. Without one, `ON DELETE SET NULL` on the `recipes` FK forces a sequential scan of `extraction_attempts` on every recipe delete.
- **Fix A ⭐ Recommended**: Add a new migration file (e.g. `20260816..._extraction_attempts_recipe_id_index.sql`) with `create index extraction_attempts_recipe_id_idx on extraction_attempts (recipe_id);`, apply to dev now, and it rides along with the still-pending prod application.
  - Strength: Matches this plan's own "Additive only" migration philosophy and the repo's migration-per-change convention.
  - Tradeoff: Two migration files for one logical table instead of one.
  - Confidence: HIGH — consistent with existing practice in this repo.
  - Blind spot: None significant.
- **Fix B**: Edit the original migration file directly (it hasn't reached prod yet) and reset dev to pick it up.
  - Strength: Keeps the feature's schema in one file.
  - Tradeoff: Violates the "migrations are immutable once created" convention this repo otherwise follows.
  - Confidence: MEDIUM — works, but non-standard for this project.
  - Blind spot: Haven't checked whether anything else in dev depends on this migration's exact prior content.
- **Decision**: FIXED via Fix A — supabase/migrations/20260816150000_extraction_attempts_recipe_id_index.sql, applied to dev

### F2 — vitest test infrastructure not documented in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/photo-to-recipe-save/plan.md (Phase 2 "Changes Required")
- **Detail**: `vitest.config.ts` and `recipe-extraction.test.ts` were added as a live, user-approved scope decision (the repo had zero test tooling before this phase) but the plan's Phase 2 "Changes Required" section still only lists the original 4 items — this addition isn't recorded anywhere in the plan text itself, only in session history.
- **Fix**: Add a short addendum bullet to Phase 2's "Changes Required" (or "Current State Analysis") noting the vitest addition and why, so the plan stays an accurate record for future readers.
- **Decision**: FIXED — plan.md Phase 2 "Changes Required" item 5 added

### F3 — HTTP failure path discards diagnostic detail

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/recipe-extraction.ts:112-114
- **Detail**: On `!response.ok`, `raw` is set to `null`, discarding the status code and error body. `extraction_attempts.raw_response` exists specifically for debugging — for the most actionable failure case (rate limits, auth errors, quota) it currently captures nothing. This exact gap is what made the OpenRouter 402 credits error opaque during today's manual verification — it had to be diagnosed by bypassing the service entirely.
- **Fix**: Capture `{ status: response.status, body: (await response.text()).slice(0, 2000) }` into `raw` on this path instead of `null`.
- **Decision**: FIXED — recipe-extraction.ts:112-115

### F4 — `mimeType` parameter has no allowlist check

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/recipe-extraction.ts:78-83
- **Detail**: `mimeType` is interpolated directly into the `data:` URL with no allowlist. Not an injection risk, but a caller passing an unexpected value would silently build a bogus data URL rather than failing fast. Phase 3's route is expected to validate mime type before calling this service, so this is defense-in-depth only.
- **Fix**: Add `if (mimeType !== "image/jpeg" && mimeType !== "image/png") return { success: false, reason: "technical_error", raw: null };` at the top of the function.
- **Decision**: FIXED — recipe-extraction.ts (SUPPORTED_MIME_TYPES allowlist check)

## Notes

- Plan drift check: no DRIFT or MISSING items. All Phase 1-2 "Changes Required" contract items are implemented exactly as specified.
- Automated verification re-run: `npx astro check` → 0 errors, 0 warnings, 5 hints; `npm run lint` → 0 errors (4 pre-existing warnings in an unrelated file); `npx vitest run` → 4/4 passed.
- Manual verification for both phases has observable evidence in this session (RLS dashboard check for 1.4; live OpenRouter call producing a plausible "CIASTO CYTRYNOWE" extraction for 2.4).
- `max_tokens: 2000` in `recipe-extraction.ts:99` is an undocumented-in-plan addition, but it's a confirmed-necessary bugfix (default was large enough to exceed this account's OpenRouter credit balance, failing every call with HTTP 402) — not flagged as a separate finding since it's already understood and correct.
