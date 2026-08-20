<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Cross-User Access & Reference Integrity Testing

- **Plan**: context/changes/testing-cross-user-access-integrity/plan.md
- **Scope**: Phase 1 of 4 (all phases — full plan review; all committed through e447d87)
- **Date**: 2026-08-20
- **Verdict**: REJECTED at time of review — resolved post-triage (see below)
- **Findings**: 1 critical, 3 warnings, 2 observations
- **Post-triage**: F1 (critical), F2, F3, F4 (warnings) all FIXED and re-verified; F5 (observation) fixed; F6 (observation) accepted as-is. No unresolved CRITICAL/WARNING findings remain.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — `npm run test` broken by unscoped base Vitest config

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: vitest.config.ts (no `include`/`exclude`)
- **Detail**: `vitest.integration.config.ts` scopes itself to `tests/integration/**/*.test.ts`, but nothing reciprocally excludes that path from the base `vitest.config.ts`. Verified live: `npm run test` now picks up all three new integration files and fails — `SUPABASE_TEST_URL is not set` thrown from `tests/integration/helpers/test-client.ts:7` (confirmed by direct run: 3 failed / 63 passed / 12 skipped). For anyone with `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY` set as ambient shell/CI env vars (not the `.env.test.local` file, which only `vitest.integration.config.ts` loads), plain `npm run test` would instead silently make real network calls against the hosted `SnapRecipe` dev project — turning the fast mocked unit-test command into a slow, network-dependent one. This directly contradicts the plan's own Phase 1 intent: "kept independent of the existing fast unit/component config."
- **Fix**: Add `exclude: [...configDefaults.exclude, "tests/integration/**"]` to `vitest.config.ts`'s `test` block (import `configDefaults` from `vitest/config`).
- **Decision**: FIXED — applied; `npm run test` verified back to 8 files / 63 tests.

### F2 — `recipe_ingredients` cross-user coverage narrower than the plan's own stated intent

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: tests/integration/cross-user-rls.test.ts:86-110
- **Detail**: The plan's Phase 2 contract calls for proving, per table, that "user A cannot select, insert, update, or delete user B's rows... and that user A's own equivalent operations still succeed (a pure 'everything's blocked' suite... would be a false-positive risk in itself)." `recipes` and `storage.objects` both get that full treatment. `recipe_ingredients` gets only select-denial and insert-denial — no update/delete-denial case, and no assertion that a legitimate same-owner operation succeeds (the setup helper inserts ingredients as a side effect but never asserts on it). This matters because `recipe_ingredients_update_own`/`_delete_own` (`supabase/migrations/20260815132912_recipe_schema.sql:105-132`) are join-based policies (via a subquery to `recipes.user_id`), structurally different from `recipes`' own direct-column checks — a join-condition regression there wouldn't be caught by any current test.
- **Fix A ⭐ Recommended**: Add the missing `recipe_ingredients` update/delete-denial cases plus one owner-success case, mirroring the existing `recipes table` block in the same file.
  - Strength: Closes a real, structurally-distinct-policy gap while the harness and fixtures are already in hand; the pattern to copy is right there in the same file.
  - Tradeoff: A few more real network calls per `test:integration` run (already an accepted cost of this layer).
  - Confidence: HIGH — mechanical extension of an existing, working pattern.
  - Blind spot: None significant.
- **Fix B**: Accept the narrower coverage as sufficient for now and record the reasoning (e.g., in test-plan.md §6.3 or a plan addendum) — defer full coverage to a follow-up.
  - Strength: No further test-time cost right now.
  - Tradeoff: Leaves the join-based policy's update/delete paths unverified; a real regression there wouldn't be caught.
  - Confidence: MEDIUM — depends on whether any current or planned UI path actually allows cross-user ingredient edits.
  - Blind spot: Haven't checked whether ingredient-level editing is reachable by anything other than the same-owner `edit_recipe` RPC flow.
- **Decision**: FIXED via Fix A — added owner-select, cross-user update-denial, and cross-user delete-denial cases; `npm run test:integration` verified 18/18 passing (up from 15), lint clean.

### F3 — New trigger function omits `search_path`, breaking this migration set's own convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260819161958_recipe_photo_path_storage_ownership.sql:10
- **Detail**: `validate_recipe_photo_path_ownership()` doesn't set `search_path`, unlike the three other `plpgsql` functions already in this migration set (`edit_recipe_instructions.sql:18`, `atomic_recipe_ingredient_edit.sql:14`, `atomic_extraction_rate_limit.sql:23`, all `set search_path = public`). Confirmed live via Supabase's security advisor on the dev project: `function_search_path_mutable` (WARN) is raised specifically for this new function (and for one pre-existing, out-of-scope function, `set_updated_at`). Practical exploitability here is genuinely low — the function is `SECURITY INVOKER` (not definer, correctly so) and its only table reference (`storage.objects`) is already schema-qualified — but it's a real, currently-live advisor finding and a real deviation from an established local convention.
- **Fix A ⭐ Recommended**: Ship a follow-up migration (`alter function validate_recipe_photo_path_ownership() set search_path = public;`), applied to dev then prod, matching the rest of this migration set.
  - Strength: Matches established convention exactly; clears the live advisor WARN on both hosted projects; single-statement, zero behavior change.
  - Tradeoff: One more dev→prod migration round-trip for a fix whose practical exploitability is already low.
  - Confidence: HIGH — trivial, well-precedented fix already used three times in this same migration set.
  - Blind spot: None significant.
- **Fix B**: Accept as-is — document why this function is the exception (all referenced identifiers are already schema-qualified or trigger-record fields, so there's no real object-resolution ambiguity for `search_path` to exploit here, unlike the `SECURITY DEFINER` functions this rule primarily protects).
  - Strength: No additional migration/deploy cycle.
  - Tradeoff: The live security advisor keeps flagging it in both projects indefinitely; breaks the now-consistent "always set search_path" convention for anyone copying this file as a future template.
  - Confidence: MEDIUM — reasoning holds today but depends on nobody adding an unqualified reference later.
- **Decision**: FIXED via Fix A — added migration `20260820080646_recipe_photo_path_ownership_search_path.sql`, applied to dev then prod via `supabase link`+`db push`. Verified: advisor's `function_search_path_mutable` for this function cleared on dev; migration recorded on both projects; `npm run test:integration` still 18/18; lint clean.

### F4 — `test-plan.md` orchestrator state is stale

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/test-plan.md:9 (header), :77 (§3 row 2)
- **Detail**: The file header still reads "Last updated: 2026-08-18 (§3 Phase 1: researched)" and §3's row 2 (this change) still shows Status `change opened`, even though Phases 1-4 are all committed (through `e447d87`, the §6.3 cookbook-fill-in commit) and §6.3 itself is filled in correctly. This project's own orchestrator (`/10x-test-plan`) reads §3 as its state source on every invocation — a stale `change opened` row risks it re-suggesting `/10x-new` for an already-shipped phase next time it runs. This project has precedent for a dedicated reconciliation commit (`45c2a53 chore(test-plan): reconcile §3 Phase 1 status to complete`).
- **Fix**: Update the header date/phase note and change §3 row 2's Status to `complete` (or run `/10x-test-plan` once — it's designed to reconcile this from on-disk state).
- **Decision**: FIXED — header updated to "2026-08-20 (§3 Phase 2: complete)"; §3 row 2 Status changed to `complete`.

### F5 — Plan's own manual-verification checkboxes never checked off

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/testing-cross-user-access-integrity/plan.md (Progress section, items 1.3, 1.4, 2.3, 3.5-3.8, 4.1)
- **Detail**: All Automated items across Phases 1-3 are checked `[x]` with commit shas, but every Manual item across all four phases remains `[ ]`, despite the work being fully implemented, committed through Phase 4, and (per this session) manually confirmed. No rubber-stamping risk (nothing's falsely marked done) — just tracking hygiene that leaves the plan's own Progress section understating actual completion.
- **Fix**: Check off items 1.3, 1.4, 2.3, 3.5-3.8, and 4.1 now that they're confirmed, and update `change.md`'s `status` accordingly once triage on this review completes.
- **Decision**: FIXED — all 8 manual Progress items checked off in plan.md.

### F6 — `.env.test.local.example`'s `SUPABASE_TEST_URL` pre-filled, contract said both vars empty

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: .env.test.local.example:5
- **Detail**: The plan's Phase 1 contract specified both `SUPABASE_TEST_URL=` and `SUPABASE_TEST_ANON_KEY=` empty. The committed file has the dev project's real URL pre-filled (`https://xmyeeuyeszvpvrjszohr.supabase.co`) — not a secret, and arguably a helpful onboarding shortcut, but a literal deviation from the written contract.
- **Fix**: No action needed — pre-filling a non-secret project URL is a harmless, arguably useful deviation; leave as-is.
- **Decision**: SKIPPED — accepted as-is.
