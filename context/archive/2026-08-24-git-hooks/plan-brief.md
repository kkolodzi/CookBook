# Pre-commit Lint + Test Hook — Plan Brief

> Full plan: `context/changes/git-hooks/plan.md`

## What & Why

Add a pre-commit git hook step that runs unit tests related to staged files,
alongside the lint that already runs. The `unit + integration` quality gate
in `context/foundation/test-plan.md` became `required` once rollout Phase 4
completed — this closes the local half of that gate so a broken test is
caught before it ever reaches CI.

## Starting Point

Husky's `.husky/pre-commit` already runs `npx lint-staged`, which runs
`eslint --fix` on staged `*.{ts,tsx,astro}` and `prettier --write` on staged
`*.{json,css,md}`. No test step exists in that pipeline today — tests only
run in CI (`npm run test`, `npm run test:integration`).

## Desired End State

`git commit` with staged TS/TSX/Astro files runs `eslint --fix` then
`vitest related --run` against those files. A commit touching code that
breaks a related unit test is blocked locally, with the failure printed,
before it ever reaches CI.

## Key Decisions Made

| Decision                          | Choice                                   | Why (1 sentence)                                                                 | Source |
| ---------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| Test scope                         | `vitest related --run`, not full suite    | Matches Lesson 3's "scoped tests, not the whole suite" and the per-edit hook's own pattern. | Plan   |
| Integration tests                  | Excluded from pre-commit, stays CI-only   | Needs network + `.env.test.local`; would block commits on hosted-Supabase availability, not code correctness. | Plan   |
| Typecheck                          | Not added to this hook                    | `npm run lint` already uses type-checked ESLint rules; task scope was lint + tests only. | Plan   |
| Trigger file types                 | Same glob as eslint (`*.ts,*.tsx,*.astro`) | Consistent with the existing lint-staged convention.                             | Plan   |
| No-related-test behavior           | Silent pass (vitest's default)            | Standard behavior; no extra warning logic needed.                                | Plan   |

## Scope

**In scope:**
- `lint-staged` config in `package.json`: add `vitest related --run` for staged `*.{ts,tsx,astro}`.
- `CLAUDE.md` doc line describing pre-commit hooks, updated to match.

**Out of scope:**
- `test:integration` in pre-commit (stays CI-only).
- A separate `tsc --noEmit` pre-commit step.
- Any change to `.husky/pre-commit` itself or to `context/foundation/test-plan.md`.

## Architecture / Approach

Single-file config change: append `"vitest related --run"` to the existing
`*.{ts,tsx,astro}` array in `lint-staged`. lint-staged already auto-appends
staged file paths as CLI args to string commands (proven by the existing
`eslint --fix` entry), so no function-based config is needed. `vitest
related` resolves against `vitest.config.ts`, which already excludes
`tests/integration/**`, so the integration-exclusion decision above requires
no extra config.

## Phases at a Glance

| Phase                                          | What it delivers                                  | Key risk                                                          |
| ----------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Extend pre-commit hook with related unit tests | `vitest related --run` wired into lint-staged + docs updated | `.astro` files never match any test (no Vitest Astro transform) — expected, not a defect |

**Prerequisites:** None — builds directly on the existing husky + lint-staged setup.
**Estimated effort:** ~1 short session, single phase.

## Open Risks & Assumptions

- `.astro`-only commits will never trigger a related-test failure (no transform configured for `.astro` in `vitest.config.ts`) — accepted as expected behavior, not a gap this plan fixes.

## Success Criteria (Summary)

- A commit that breaks a unit test related to a staged file is blocked locally with the failure visible, before reaching CI.
- A clean commit runs both eslint and vitest related without extra manual steps.
- `CLAUDE.md` accurately describes the pre-commit pipeline after this change.
