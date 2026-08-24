# CI Gate & Resource-Abuse Posture Implementation Plan

## Overview

Rollout Phase 4 of `context/foundation/test-plan.md` (risks #1 and #7). Fixes a branch-trigger
bug that has left the entire CI workflow inert since the repo's default branch became `main`,
adds `npm run test` as a required CI gate, and closes the one real, previously-unverified gap in
the existing extraction rate-limit mechanism (its atomic cap-enforcement has never been proven
against real Postgres).

## Current State Analysis

`.github/workflows/ci.yml` triggers on `branches: [master]` for both `push` and `pull_request`
(`:4-7`), and the `deploy` job's condition checks `github.ref == 'refs/heads/master'` (`:29`).
This repo's only branch, ever, is `main` — confirmed via `git ls-remote --heads origin` (single
ref: `refs/heads/main`) and `gh run list` (zero workflow runs, ever). The workflow has never
executed once, lint and build included; `CLAUDE.md:57` documents the same "master" assumption,
so this has been silently wrong since the workflow was written. `main` has no branch-protection
rule configured (`gh api .../branches/main/protection` → `404 Branch not protected`).

Two independent test suites exist. `npm run test` (`vitest.config.ts`) is fully self-contained —
`environment: "node"`, jsdom opt-in per file, `exclude: ["tests/integration/**"]`, and every
sampled test file mocks its Supabase/fetch/`astro:env` boundary (research.md, "CI workflow —
current state" section). It needs zero secrets and zero network access. `npm run test:integration`
(`vitest.integration.config.ts`) hits the real hosted `SnapRecipe` dev Postgres project via
`SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`, which are not wired into CI anywhere today.

Risk #7's premise — "research first, a cost-control mechanism may not exist" — turned out to be
false. `reserve_extraction_attempt(p_cap integer)`
(`supabase/migrations/20260816160000_atomic_extraction_rate_limit.sql:19-41`) does a single
atomic `INSERT ... ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 RETURNING count`,
returning `count <= p_cap`. It is called at the sole extraction call site
(`src/pages/api/recipes.ts:83-85`), **before** the AI request, and fails closed (HTTP 429,
extraction never invoked) on cap breach. The only existing coverage
(`src/pages/api/recipes.test.ts:45,155-161`) mocks the RPC entirely — the atomic upsert's
behavior under real concurrent calls has never been exercised against a real database.

### Key Discoveries:

- `.github/workflows/ci.yml:4-7,29` — both the trigger and the deploy gate reference the
  nonexistent `master` branch; this is a single root cause, not two unrelated bugs.
- `.github/workflows/ci.yml:27` — `deploy` already has `needs: ci`, so adding a step to the `ci`
  job automatically becomes a deploy gate once the branch names are fixed — no new job needed.
- `reserve_extraction_attempt` takes `p_cap` as a caller-supplied parameter, not a hardcoded SQL
  constant — a test can call it directly with its own small cap value, independent of the
  production route's `DAILY_ATTEMPT_CAP = 10` (`src/pages/api/recipes.ts:11`), avoiding any
  dependency on that implementation-detail number.
- `tests/integration/helpers/test-client.ts`'s `createTestUser()` provides an authenticated
  client whose `auth.uid()` the RPC reads directly (`security definer`, same pattern already
  exercised for `edit_recipe` in `tests/integration/cross-user-rls.test.ts:209-220`) — no new
  harness needed.

## Desired End State

- `.github/workflows/ci.yml` triggers correctly on `main`, and a PR with a failing unit test
  shows a red `ci` check (verified by a deliberate throwaway failing assertion during manual
  verification, then reverted).
- `npm run test` runs as a required step inside the existing `ci` job.
- A new integration test proves `reserve_extraction_attempt` enforces its cap correctly across
  a sequential run of calls exceeding it, using a test-controlled `p_cap`, against real Postgres.
- `CLAUDE.md`'s `## CI` section and `test-plan.md` §2 Risk #7 Response Guidance both reflect
  reality: the branch is `main`, tests are gated, and the cost-control mechanism is confirmed to
  exist with its concurrency-safety now covered by a test.

## What We're NOT Doing

- Not wiring `npm run test:integration` into CI — decided against for this phase; it needs two
  new GitHub secrets and introduces real-network-in-CI flakiness/shared-dev-DB-pollution risk on
  every PR. Left as a candidate for a future phase, not silently dropped.
- Not configuring GitHub branch protection to make the `ci` check literally required — that's a
  repo-settings change outside version control, left as a documented follow-up rather than part
  of this phase.
- Not testing `reserve_extraction_attempt` under genuine concurrent load (`Promise.all`-style
  race) — decided against; the sequential-loop proof is the chosen coverage for this phase.
- Not adding any new application-level or Cloudflare-level rate-limiting/throttling — research
  found the existing atomic RPC is correctly wired with no bypass route; nothing here suggests a
  second layer is needed.
- Not touching the extraction feature's `DAILY_ATTEMPT_CAP = 10` value itself, nor asserting
  against it in the new test — it carries no PRD/roadmap authority and asserting on it would
  reintroduce the oracle-problem risk research flagged.

## Implementation Approach

Phase 1 fixes the CI workflow's root cause (wrong branch name) and adds the cheapest possible
gate (`npm run test`, already secret-free) in the same change, since shipping one without the
other leaves either a gate that never runs or a workflow that runs but still gates nothing new.
Phase 2 follows the exact integration-test harness and single-concern-file convention Phases 2–3
established, calling the RPC directly with a test-owned cap value. Phase 3 syncs the two
documents (`CLAUDE.md`, `test-plan.md`) that currently assert something no longer true.

## Phase 1: Fix the CI branch trigger and add the test gate

### Overview

Corrects the `master`/`main` mismatch that has left `ci.yml` completely inert, and adds
`npm run test` as a required step in the same job `deploy` already depends on.

### Changes Required:

#### 1. CI workflow branch fix + test step

**File**: `.github/workflows/ci.yml`

**Intent**: Make the workflow actually trigger on this repo's real branch, and make a failing
unit test block the same way a failing lint or build already does.

**Contract**: Change `on.push.branches` and `on.pull_request.branches` (currently `[master]`,
lines 5 and 7) to `[main]`. Change the `deploy` job's `if` condition (line 29,
`github.ref == 'refs/heads/master'`) to `refs/heads/main`. Add a `run: npm run test` step inside
the `ci` job, after the existing `npm run lint` step and before `npm run build` — no `env:` block
needed (the suite requires no secrets, per Current State Analysis).

### Success Criteria:

#### Automated Verification:

- Workflow YAML is valid: `npx --yes yaml-lint .github/workflows/ci.yml` (or equivalent
  parse-only check available in this environment)
- Lint passes: `npm run lint`
- Local dry run of the added step passes: `npm run test`

#### Manual Verification:

- Push this change on a branch and open a PR against `main`; confirm the `ci` check actually
  triggers and appears on the PR (proving the branch-name fix works) — this is the only way to
  verify a GitHub Actions trigger fix locally-run tools cannot confirm.
- Temporarily break one assertion in an existing test file, push, confirm the `ci` check goes
  red; revert the temporary breakage, confirm it goes green again.

---

## Phase 2: Extraction rate-limit concurrency-safety test

### Overview

Proves `reserve_extraction_attempt`'s atomic cap enforcement holds across a sequential run of
calls against real Postgres — the one previously-unverified claim risk #7 turned out to hinge on.

### Changes Required:

#### 1. New integration test file

**File**: `tests/integration/extraction-rate-limit.test.ts`

**Intent**: Prove the RPC's cap enforcement is real, not just mocked, using a test-owned cap
value so the assertion's oracle comes from the test's own input, never from the production
route's `DAILY_ATTEMPT_CAP` literal.

**Contract**: A `describe("extraction rate limit")` block, one `beforeAll`-created test user
(single-user scope — this is a per-user counter, not a cross-user risk), with these cases:

- `it("allows attempts up to the cap and rejects the next one")` — call
  `user.client.rpc("reserve_extraction_attempt", { p_cap: 3 })` four times in sequence for the
  same user on the same day; assert the first 3 calls return `true` and the 4th returns `false`,
  with no RPC-level error on any call.
- `it("keeps counting against the same day across multiple reservation calls")` — after the
  above, call the RPC again with a **different, larger** `p_cap` (e.g. `10`) for the same user;
  assert it still returns `true` (the counter carries forward — 5th attempt, still `<= 10`),
  proving the counter isn't reset or scoped per-call-value.
- `it("scopes the counter per user")` — create a second test user, call the RPC once with
  `p_cap: 1` for that user; assert it returns `true` (the first user's earlier attempts against a
  different cap value don't leak across users), confirming the `(user_id, day)` primary key
  actually isolates counters.

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:integration`
- Lint passes: `npm run lint`

#### Manual Verification:

- Run `npm run test:integration -- extraction-rate-limit` locally against the dev project and
  confirm all 3 cases pass with no flakiness on a second run.

---

## Phase 3: Docs sync

### Overview

Brings `CLAUDE.md` and `test-plan.md` back in line with what Phases 1–2 just made true, so
neither document keeps asserting something no longer accurate.

### Changes Required:

#### 1. CLAUDE.md CI section

**File**: `CLAUDE.md`

**Intent**: Correct the branch name and document that tests are now a required CI step, so a
future agent session reading this file doesn't inherit the same stale assumption that caused
this phase's root-cause bug.

**Contract**: Rewrite the single sentence under `## CI` (currently: "GitHub Actions workflow
(`.github/workflows/ci.yml`) runs lint + build on every push and PR to master.") to say `main`
instead of `master`, and to mention that `npm run test` now runs as part of the same job.

#### 2. test-plan.md Risk #7 correction

**File**: `context/foundation/test-plan.md`

**Intent**: Backport the correction research surfaced — Risk #7's Response Guidance currently
reads as if a cost-control mechanism's existence were unconfirmed; it exists and is correctly
wired, and the real, now-closed gap was concurrency verification.

**Contract**: Rewrite the Risk #7 row in the §2 "Risk Response Guidance" table only (not the top
risk-map row's Source column, per the plan's own rule that only response guidance, not risk
anchors, may be backported here): "What would prove protection" becomes proving the atomic
per-user-per-day cap holds across repeated calls; "Must challenge" becomes not assuming the
atomic upsert is race-safe without a test proving it; "Context needed" references the migration
and call site already grounded in research.md; "Likely cheapest layer" becomes an integration
test directly against the RPC; "Anti-pattern to avoid" becomes asserting against the production
route's hardcoded cap value instead of a test-owned one.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (confirms no adjacent code drift from the doc edits)

#### Manual Verification:

- `CLAUDE.md`'s CI section and `test-plan.md` §2 Risk #7 both read coherently and match what
  Phases 1–2 actually shipped.

---

## Testing Strategy

### Unit Tests:

- None added — Phase 1 only wires an existing suite into CI; no new unit-test code.

### Integration Tests:

- Phase 2's test file, as detailed above.

### Manual Testing Steps:

1. Open a PR after Phase 1 lands and confirm the `ci` check actually appears and runs (proves
   the branch-trigger fix).
2. Deliberately break then restore a test to confirm the gate is load-bearing, not decorative.
3. Run `npm run test:integration -- extraction-rate-limit` twice in a row to rule out flakiness
   from the no-cleanup test-user pattern this project's harness already accepts.

## Performance Considerations

None — Phase 1 adds one fast (`npm run test`, already run locally routinely) step to CI; Phase 2
adds 3 test cases making a handful of RPC calls each, negligible against the existing suite's
runtime.

## Migration Notes

Not applicable — no schema changes; the extraction rate-limit schema already exists.

## References

- Research: `context/changes/testing-ci-gate-resource-abuse-posture/research.md`
- Change identity: `context/changes/testing-ci-gate-resource-abuse-posture/change.md`
- Reference integration test (RPC-calling pattern): `tests/integration/cross-user-rls.test.ts:206-220`
- Governing risks: `context/foundation/test-plan.md` §2 rows 1 and 7, Risk Response Guidance rows
  1 and 7, §3 Phase 4

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Fix the CI branch trigger and add the test gate

#### Automated

- [x] 1.1 Workflow YAML is valid — 2b56bd0
- [x] 1.2 Lint passes: `npm run lint` — 2b56bd0
- [x] 1.3 Local dry run of the added step passes: `npm run test` — 2b56bd0

#### Manual

- [x] 1.4 A PR against `main` triggers the `ci` check — 2b56bd0
- [x] 1.5 A deliberately broken test turns the `ci` check red, then green again after revert — 2b56bd0

### Phase 2: Extraction rate-limit concurrency-safety test

#### Automated

- [x] 2.1 Integration suite passes: `npm run test:integration` — 7942b8a
- [x] 2.2 Lint passes: `npm run lint` — 7942b8a

#### Manual

- [x] 2.3 `npm run test:integration -- extraction-rate-limit` passes twice in a row, no flakiness — 7942b8a

### Phase 3: Docs sync

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 828340e

#### Manual

- [x] 3.2 CLAUDE.md CI section and test-plan.md §2 Risk #7 both read coherently and match reality — 828340e
