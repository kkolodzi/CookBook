<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Photo Upload → AI Extraction → Recipe Save

- **Plan**: context/changes/photo-to-recipe-save/plan.md
- **Scope**: Phase 1-7 of 7 (full plan; Phases 1-2 previously reviewed separately, all 4 findings from that round FIXED — see Notes)
- **Date**: 2026-08-16
- **Verdict**: APPROVED (all 5 findings triaged and FIXED — see Decision fields)
- **Findings**: 0 critical, 4 warnings, 1 observation (0 unresolved)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS (was WARNING — F4 fixed) |
| Safety & Quality | PASS (was WARNING — F1, F2, F3, F5 fixed) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Orphaned storage object when the `recipes` insert fails after upload succeeds

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/recipes.ts:81-97
- **Detail**: The photo is uploaded to the `recipe-photos` Storage bucket (line 81-83) before the `recipes` row is inserted (line 89-93). If the `recipes` insert fails (line 95-97), the handler returns 500 but never deletes the just-uploaded Storage object — unlike the ingredients-insert failure path a few lines below, which does compensate (delete the `recipes` row). The plan's Critical Implementation Details section only names an accepted-risk exception for the ingredients-insert-failure case ("the Storage object itself is left — acceptable for MVP"); this earlier failure point (recipes-insert itself failing) isn't covered by that language, so the object is silently orphaned with no documented rationale.
- **Fix A ⭐ Recommended**: Extend the existing accepted-risk note in the plan's Critical Implementation Details to explicitly cover this path too — no code change, since the failure mode and blast radius (one orphaned Storage object, no data corruption) are identical to the already-accepted case.
  - Strength: Consistent with the plan's own stated MVP posture; zero new code/tests needed.
  - Tradeoff: Orphaned objects still accumulate in Storage with no cleanup job.
  - Confidence: HIGH — matches an already-approved precedent in this same plan.
  - Blind spot: No visibility into how large the `recipe-photos` bucket could grow from this path specifically.
- **Fix B**: Add `await supabase.storage.from("recipe-photos").remove([storagePath])` in the `recipeError` branch before returning 500.
  - Strength: Actually prevents the orphan rather than just documenting it as accepted.
  - Tradeoff: One more fallible network call in an already-failing path (the remove itself could fail silently); small code/test addition.
  - Confidence: MEDIUM — straightforward Supabase Storage API call, but untested against real failure-mode combinations.
  - Blind spot: Whether a failed `recipes` insert ever actually happens in practice (RLS/constraint violations are the only realistic trigger) — may be a very low-frequency path not worth the extra code.
- **Decision**: FIXED via Fix B — src/pages/api/recipes.ts (recipeError branch now calls storage.remove([storagePath])); new test "removes the uploaded photo from storage when the recipes insert fails" added to recipes.test.ts

### F2 — Compensating delete's own failure is unchecked, and this failure path skips attempt logging

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/recipes.ts:107-110
- **Detail**: When the `recipe_ingredients` insert fails, the code calls `.delete()` on the just-created `recipes` row but never checks that delete's own `error` — if the delete itself also fails (transient DB/network issue), a `recipes` row with zero ingredients silently persists with no error surfaced. Separately, the plan's Critical Implementation Details step 5 says "Log the `extraction_attempts` row last" implying every outcome gets logged, but this specific failure path returns 500 without ever inserting an `extraction_attempts` row — unlike every other branch (classified extraction failure, success, storage-upload failure aside). This makes the failure invisible to the debugging log (`raw_response`) this table exists for.
- **Fix**: Check the delete's `error` (log/alert on double-failure — at minimum this shouldn't be silent), and insert an `extraction_attempts` row (`success: false`, e.g. `failure_reason: "technical_error"`, `raw_response: result.raw`) in this branch before responding, matching every other exit path's logging behavior.
  - Strength: Restores audit-trail consistency across all failure branches and surfaces a currently-silent double-failure mode.
  - Tradeoff: One more DB write on an already-failing request path.
  - Confidence: HIGH — directly matches the plan's own stated intent (step 5) and the pattern already used on the other two failure branches in this same file.
  - Blind spot: None significant — this is a straightforward gap-fill, not a design question.
- **Decision**: FIXED — src/pages/api/recipes.ts (ingredientsError branch now checks the delete's error and logs an extraction_attempts row with failure_reason: technical_error); recipes.test.ts assertion added to the existing compensating-delete test

### F3 — TOCTOU race on the daily rate-limit cap

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/recipes.ts:50-68
- **Detail**: The 10/day cap is enforced by counting existing `extraction_attempts` rows (line 50-58) before the ~10s extraction call (line 68), with the new attempt only inserted afterward (line 71-76 or 112-117). Concurrent requests issued within that window all read the same pre-insert count and can all pass the check, allowing a burst past the stated cap. This is a soft business-logic limit (API/model cost control), not a security or data-integrity boundary, so the practical blast radius is limited to extra OpenRouter spend from a single user deliberately racing their own requests.
- **Fix A ⭐ Recommended**: Accept as a documented risk — add a one-line note to the plan's Performance Considerations or Critical Implementation Details acknowledging the cap is best-effort, not atomic, consistent with this slice's MVP scope.
  - Strength: Matches the plan's existing MVP-acceptable-risk pattern (same posture as the Storage-orphan risk already accepted); zero code change.
  - Tradeoff: A user who intentionally races requests can exceed 10/day by a small margin.
  - Confidence: HIGH — self-inflicted cost only, no cross-user exposure.
  - Blind spot: Actual OpenRouter cost sensitivity to this margin hasn't been quantified.
- **Fix B**: Make the cap atomic via a DB-side mechanism (e.g., a Postgres function that inserts-and-checks under a row lock, or a unique constraint on a per-day counter row).
  - Strength: Closes the race entirely.
  - Tradeoff: Requires a new migration and a rewrite of the cap-check logic — real scope growth for a low-severity issue.
  - Confidence: MEDIUM — correct approach exists but adds meaningful complexity relative to the risk being mitigated.
  - Blind spot: Whether Cloudflare Workers' request concurrency model makes this race realistically exploitable at any meaningful scale.
- **Decision**: FIXED via Fix B — new migration supabase/migrations/20260816160000_atomic_extraction_rate_limit.sql (extraction_daily_counters table + reserve_extraction_attempt() security-definer function), applied to dev via MCP apply_migration and verified with a rolled-back transaction test (p_cap=3, 4th call correctly returned false); src/pages/api/recipes.ts now calls supabase.rpc("reserve_extraction_attempt", ...) instead of the count query; src/types.ts regenerated; recipes.test.ts mock updated (reserveResult config replaces attemptsCount)

### F4 — Two justified additions undocumented in the plan text

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260816153000_grant_app_tables_to_authenticated.sql; src/lib/supabase.ts:7
- **Detail**: Two files were added/changed during Phases 3-4 that aren't named in any phase's "Changes Required": (1) a GRANT migration fixing a real bug (raw-SQL-created tables never got the `authenticated` role's implicit table-level GRANTs, so every RLS-protected query was failing with "permission denied" before RLS was even evaluated) — well-documented in its commit message but absent from plan.md itself; (2) `createServerClient<Database>` typing added to `src/lib/supabase.ts` so the new typed `.from("extraction_attempts")` queries type-check. Both are small, correct, and non-scope-creeping — same category as the vitest-infrastructure addendum from the Phase 1-2 review round (that round's F2), which was resolved by documenting it in the plan rather than treating it as a problem.
- **Fix**: Add a short addendum note (mirroring the existing Phase 2 "Test infrastructure (addendum)" pattern) under Phase 3's "Changes Required" documenting the GRANT migration and the `supabase.ts` typing change, so the plan stays an accurate record.
- **Decision**: FIXED — plan.md Phase 3 "Changes Required" items 2 and 3 added (item 2 documents the GRANT migration + supabase.ts typing; item 3 documents the F3 atomic rate-limit fix applied during this same review)

### F5 — Unhandled exceptions in request-body reads bypass the route's JSON error contract

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/recipes.ts:40,67
- **Detail**: `context.request.formData()` (line 40) and `photo.arrayBuffer()` (line 67) aren't wrapped in try/catch. A malformed multipart body or a stream-read failure would throw and fall through to Astro's default error page instead of this route's consistent `{ error: string }` JSON shape that every other failure path returns. Low likelihood in practice, and the frontend already degrades gracefully via `response.json().catch(() => null)`, so this is an observation rather than a real-world-triggered gap.
- **Fix**: Wrap both reads in try/catch and return the existing generic 500 JSON error on failure, for contract consistency.
- **Decision**: FIXED — src/pages/api/recipes.ts (both formData() and arrayBuffer() reads wrapped in try/catch, returning the existing generic 500 JSON error)

## Notes

- Plan-drift check (Phases 3-7): no DRIFT or MISSING items — every phase's "Changes Required" Contract is implemented exactly as specified, including the exact persistence ordering (extract → upload → insert recipe → insert ingredients → compensating delete → log attempt) from Critical Implementation Details.
- "What We're NOT Doing" boundaries confirmed respected: no type-override edit UI beyond the narrow PATCH, no client-side compression, no multi-recipe handling, no async/notification flow, no in-app camera capture (`accept="image/jpeg,image/png"` with no `capture` attribute), no manual-entry route, existing Dashboard/auth scaffold copy left in English.
- Safety/pattern scan confirmed correct: both new API routes check `context.locals.user` first (401 on absent); the PATCH endpoint relies purely on RLS for ownership (no client-trusted owner field) and returns a uniform 404 on any error, avoiding existence leaks; the GRANT migration grants exactly what each table's RLS policies allow (no over-grant, nothing to `anon`); all DB access goes through the parameterized Supabase query builder; no hardcoded secrets; `prerender = false` present on both routes; no Next.js directives; `cn()` used correctly wherever Tailwind classes are conditionally combined; middleware protection and API self-auth patterns are both consistent with the existing `signin`/`signup` conventions.
- Phases 1-2 were reviewed in an earlier round (`context/changes/photo-to-recipe-save/reviews/impl-review.md`, since superseded by this full-plan report): all 4 findings from that round (missing FK index, undocumented vitest addendum, discarded HTTP failure diagnostics, missing mime-type allowlist) were FIXED and are not re-flagged here. Spot-checked in this round: `recipe-extraction.ts`'s try/catch/timeout structure remains correct.
- Automated verification re-run for the full plan: `npx astro check` → 0 errors; `npm run lint` → 0 errors (4 pre-existing warnings in an unrelated file); `npx vitest run` → 16/16 passed (3 test files: recipe-extraction, recipes, recipes/[id]/type).
- Manual verification for all 7 phases has observable evidence across the session history (dashboard RLS checks, live OpenRouter extraction, curl/REST checks for 401/400/429, real end-to-end photo submissions verified in the Supabase dashboard, mobile-viewport happy-path + quality-validation pass, non-recipe/blurry failure-tip verification, and the type-nudge PATCH flow verified via a fetch-response-override devtools technique).
