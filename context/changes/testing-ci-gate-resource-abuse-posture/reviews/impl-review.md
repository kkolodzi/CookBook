<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: CI Gate & Resource-Abuse Posture

- **Plan**: context/changes/testing-ci-gate-resource-abuse-posture/plan.md
- **Scope**: Full plan (Phases 1-3 of 3)
- **Date**: 2026-08-24
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Undocumented cross-test ordering dependency in the rate-limit test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test correctness / fragility risk)
- **Location**: tests/integration/extraction-rate-limit.test.ts:25-32
- **Detail**: The second test ("keeps counting against the same day across multiple reservation calls") genuinely depends on the first test having already run and left 4 reservations in place for the same `user` — the comment on lines 28-30 explains the numbers but doesn't flag this as a *structural* constraint. This is safe today under Vitest's default sequential-per-file `it` execution (confirmed: no `concurrent` usage anywhere in this file or its siblings), and this dependency was part of the plan's own design intent (Phase 2's contract explicitly says "after the above" for test 2). It's the first file in `tests/integration/` to introduce this pattern — every sibling file (`trash-restore-roundtrip.test.ts`, `cross-user-rls.test.ts`) builds fully independent fixtures per `it`. If a future refactor reorders tests, parallelizes the file, or someone modifies test 1, test 2 silently breaks with a confusing failure.
- **Fix**: Add an explicit comment at the top of test 2 (or above the whole `describe` block) noting that this test intentionally relies on Vitest's default sequential execution and running immediately after test 1 — makes the constraint discoverable instead of only inferable from the inline comment about "5th reservation."
- **Decision**: FIXED

## Notes (non-findings)

- `CLAUDE.md`'s CI section ended up as one sentence with a clarifying clause about `test:integration` not being wired in, slightly beyond the plan's literal "rewrite the single sentence" instruction. Verified accurate and consistent with the "What We're NOT Doing" list — not flagged as a finding, just noting the plan-drift agent's observation was checked and is benign.
- Re-ran all automated success criteria independently: `yamllint` on `ci.yml` (clean), `npm run lint` (0 errors, 4 pre-existing unrelated warnings), `npm run test` (8 files, 63 tests, all pass), `npm run test:integration` (6 files including the new one, 29 tests, all pass). No regressions.
- File-list diff across all 4 commits for this change matches the plan's file list exactly — no unplanned files touched.
