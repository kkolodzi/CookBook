# Pre-commit Lint + Test Hook Implementation Plan

## Overview

Extend the project's existing husky + lint-staged pre-commit hook so it also
runs unit tests related to staged files, not just lint. Lint on staged files
already runs today; this plan adds the test half.

## Current State Analysis

- `.husky/pre-commit` runs `npx lint-staged` (unchanged by this plan).
- `package.json`'s `lint-staged` config runs `eslint --fix` on staged
  `*.{ts,tsx,astro}` and `prettier --write` on staged `*.{json,css,md}`. No
  test step exists today.
- `vitest.config.ts` runs with `environment: "node"` and excludes
  `tests/integration/**` — `npm run test` (`vitest run`) and `vitest related`
  both resolve against this config by default, so both are unit-only unless a
  separate config is passed.
- `context/foundation/test-plan.md` §5 lists `unit + integration` as
  `required after §3 Phase 4`; Phase 4 (`testing-ci-gate-resource-abuse-posture`)
  is now `complete`, so the local half of that gate is due.
- The `vitest related <file> --run` pattern is already used in this session's
  per-edit hook (`.claude/settings.local.json`, `PostToolUse` on `Write|Edit`)
  — this plan reuses the same command shape at the pre-commit layer, per
  CLAUDE.md's Module 3 Lesson 3 guidance ("the rule is the same — run checks
  on staged files before commit").
- `CLAUDE.md`'s Commands section documents the current pre-commit behavior
  (`husky + lint-staged runs eslint --fix ... and prettier --write ...`) —
  this line goes stale once a test step is added and needs updating in the
  same change.

## Desired End State

Running `git commit` with staged `.ts`/`.tsx`/`.astro` files runs, in order:
`eslint --fix` (existing) then `vitest related --run` (new) against those
staged files. A failing related test blocks the commit the same way a lint
failure already does. Staged files with no related tests (new files,
`.astro`-only changes) pass through silently — `vitest related`'s own
default behavior when it finds no matching test in the module graph.

Verify by: staging a change that breaks an existing unit test and confirming
`git commit` is blocked with the vitest failure printed; then fixing it and
confirming the commit succeeds.

### Key Discoveries:

- lint-staged auto-appends matched staged file paths as CLI arguments to a
  string command (already relied on by the existing `eslint --fix` entry) —
  no function-based lint-staged config or manual filename wiring is needed.
- `.astro` files have no Vite/Vitest transform configured in
  `vitest.config.ts` (no Astro plugin), so `vitest related` can never find a
  match for them — this is expected, not a gap to fix in this change.

## What We're NOT Doing

- Not adding `test:integration` to pre-commit — it's network-dependent
  (hosted `SnapRecipe` dev Supabase project) and needs `.env.test.local`;
  stays CI-only.
- Not adding a `tsc --noEmit` typecheck step to pre-commit — `npm run lint`
  already uses type-checked ESLint rules (per CLAUDE.md), and the task asked
  for lint + tests, not a separate typecheck gate.
- Not changing `.husky/pre-commit` itself (`npx lint-staged` stays as-is) —
  all the new behavior is expressed through the `lint-staged` config.
- Not adding a "no tests found" warning — `vitest related` passing silently
  on zero matches is the accepted, standard behavior.
- Not touching `context/foundation/test-plan.md` — this change satisfies the
  local half of the already-`required` `unit + integration` gate; the gate's
  own description doesn't need editing.

## Implementation Approach

Add `"vitest related --run"` as a second command in the existing
`*.{ts,tsx,astro}` lint-staged array, after `eslint --fix`. Update the
CLAUDE.md line documenting pre-commit behavior to match.

## Phase 1: Extend pre-commit hook with related unit tests

### Overview

Wire `vitest related --run` into the existing lint-staged pipeline and keep
the project's own docs accurate.

### Changes Required:

#### 1. lint-staged config

**File**: `package.json`

**Intent**: Run unit tests related to each staged `.ts`/`.tsx`/`.astro` file
after lint auto-fix, so a commit is blocked if it breaks a test touching the
code being committed.

**Contract**: In the `lint-staged` object, the `"*.{ts,tsx,astro}"` key's
array gains a second entry, `"vitest related --run"`, after the existing
`"eslint --fix"`. The `"*.{json,css,md}"` entry is untouched.

#### 2. Pre-commit hook documentation

**File**: `CLAUDE.md`

**Intent**: Keep the "Commands" section's description of pre-commit hooks
accurate now that a test step exists — this is the exact failure mode
`context/foundation/lessons.md` warns about (undocumented tooling changes
surfacing later as review findings).

**Contract**: Update the sentence "Pre-commit hooks: husky + lint-staged runs
`eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on
`*.{json,css,md}`." to also name the new `vitest related --run` step on
`*.{ts,tsx,astro}`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass: `npm run test`
- `package.json` is valid JSON and lint-staged config parses: `npx lint-staged --config package.json --dry-run` (or equivalent no-op invocation)

#### Manual Verification:

- Stage a change to a `.ts` file that breaks one of its related unit tests, run `git commit`, and confirm the commit is blocked with the failing test's output visible.
- Fix the test, re-stage, and confirm `git commit` now succeeds and runs both eslint and vitest related.
- Stage a change to a `.astro`-only file with no related test and confirm the commit succeeds without a vitest failure (silent pass-through).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Manual Testing Steps:

1. Break a unit test via its source file, stage both, attempt commit, confirm block.
2. Fix and re-stage, confirm commit succeeds.
3. Stage an `.astro`-only change, confirm commit succeeds with no vitest failure.

## Performance Considerations

`vitest related` only runs tests transitively importing the staged files, so
commit-time cost scales with the size of the staged change, not the full
suite (14 test files today) — consistent with the existing lint step's cost
profile.

## Migration Notes

None — additive change to existing tooling config, no data or schema impact.

## References

- Existing hook: `.husky/pre-commit`, `package.json` (`lint-staged`)
- Per-edit hook precedent: `.claude/settings.local.json`
- Quality gate context: `context/foundation/test-plan.md` §5

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extend pre-commit hook with related unit tests

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Unit tests pass: `npm run test`
- [x] 1.3 `package.json` lint-staged config parses cleanly

#### Manual

- [x] 1.4 Broken related test blocks commit with visible failure output
- [x] 1.5 Fixed test allows commit to succeed running both eslint and vitest related
- [x] 1.6 `.astro`-only staged change commits successfully with no vitest failure
