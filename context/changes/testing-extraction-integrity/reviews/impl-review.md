<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Extraction Integrity & Visible Feedback

- **Plan**: context/changes/testing-extraction-integrity/plan.md
- **Scope**: Full plan (Phases 1-5)
- **Date**: 2026-08-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `@vitejs/plugin-react` version drift

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: package.json
- **Detail**: Plan specified `^5.1.4`; the installed devDependency resolved to `^5.2.0`. No behavioral difference observed in `vitest.config.ts` or the test suite — a component-test-tooling package pinned to whatever was current on the npm registry at implementation time.
- **Fix**: No action needed. Plan version pins are targets, not contracts; the delta is inert.
- **Decision**: SKIPPED

### F2 — Pre-existing `key={ingredient}` collision risk (out of scope)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/recipes/PhotoUploadForm.tsx:161
- **Detail**: The ingredient `<li>` list is keyed by the ingredient string itself; two identical ingredient strings after filtering would collide as React keys. This line predates this change (the diff only touched `SuccessData`/`ApiResponseBody` typing and added the notice block) — flagged as a pre-existing note, not a regression introduced by `testing-extraction-integrity`.
- **Fix**: Key by index (or `${ingredient}-${index}`) if duplicate ingredient strings become a real occurrence. Not required for this change to be considered complete.
- **Decision**: FIXED — keyed by `index` instead of `ingredient` string.

## Supporting detail

**Plan Adherence** — verified phase-by-phase against actual file content:
- Phase 1 (`recipe-extraction.ts` floor check, 3 adversarial tests): exact match.
- Phase 2 (`recipes.ts` filtering + `contentDegraded`, 3 test cases): exact match, including operator and field order.
- Phase 3 (jsdom/RTL tooling): exact match — critical invariant `test.environment: "node"` confirmed intact globally, jsdom applied only via the file-local pragma.
- Phase 4 (`PhotoUploadForm.tsx` notice + 3 component tests): exact match, including notice ordering before the `typeUnconfirmed` nudge and the negative assertion in the clean-success test.
- Phase 5 (test-plan.md §6.1/§6.2): both sections filled in per contract, no `TBD` remaining in-scope.

**Scope Discipline** — `git diff --name-only` across the change's commit range contains only files named in the plan (plus the expected `package-lock.json` regeneration and change-folder process artifacts). No unplanned/EXTRA files.

**Safety & Quality** — no CRITICAL or WARNING findings. Specifically verified:
- The floor-check invariant the plan relies on (`ingredientRows` can never be an empty-batch insert) actually holds in the current code, not just asserted by the plan.
- `URL.createObjectURL`/`revokeObjectURL` handling is unaffected and leak-free (pre-existing cleanup effect untouched by this diff).
- jsdom's missing `URL.createObjectURL` is stubbed and reset every test (`beforeEach` with fresh `vi.fn()`), no cross-test pollution.
- No hardcoded secrets in new/modified test fixtures; auth checks in `recipes.ts` unchanged.

**Pattern Consistency** — new test files follow the repo's existing `vi.mock`/`vi.stubGlobal`/`beforeEach`-reset conventions; `PhotoUploadForm.test.tsx` colocation matches the `*.test.ts` next-to-module convention used elsewhere.

**Success Criteria** — automated: `npm run test` → 63/63 passing; `npm run lint` → 0 errors (4 pre-existing, unrelated warnings in `scripts/check-auth-config.mjs`). Manual: Phase 4's browser-verification steps (4.3/4.4) were confirmed by the user during implementation ("yeah seems ok").
