---
date: 2026-08-23T13:55:16+00:00
researcher: Claude (10x-research)
git_commit: 2d0945c6db0628eadcb4378188964b9e89411b7e
branch: main
repository: CookBook
topic: "CI gate & resource-abuse posture — wiring the test suite into CI (risk #1) and extraction cost-control posture (risk #7)"
tags: [research, codebase, ci, github-actions, rate-limiting, extraction, resource-abuse]
status: complete
last_updated: 2026-08-23
last_updated_by: Claude (10x-research)
---

# Research: CI gate & resource-abuse posture

**Date**: 2026-08-23T13:55:16+00:00
**Researcher**: Claude (10x-research)
**Git Commit**: 2d0945c6db0628eadcb4378188964b9e89411b7e
**Branch**: main
**Repository**: CookBook

## Research Question

For rollout Phase 4 of `context/foundation/test-plan.md` (risk #1 — regressions ship undetected because the test suite never runs in CI; risk #7 — unbounded/repeated AI extraction calls create uncontrolled cost exposure): what would wiring the test suite into CI actually look like at this project's current state, and does an extraction cost-control mechanism already exist? This grounds `/10x-plan` so it decides scope from facts, not assumptions.

## Summary

**Risk #1 (CI gate).** CI (`.github/workflows/ci.yml`) runs `npm ci` → `astro sync` → `npm run lint` → `npm run build` — no test step exists. The `deploy` job already has `needs: ci`, so anything added to the `ci` job automatically becomes a merge/deploy gate. The two test suites split cleanly on CI-readiness: `npm run test` (unit/component, mocked Supabase/fetch throughout, confirmed secret-free by sampling) can be added as a single `run: npm run test` step with **zero new secrets or infrastructure**. `npm run test:integration` (real hosted-dev-Postgres suite) would require adding two new GitHub secrets (`SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`) that are not wired into CI anywhere today — a bigger, separate decision with real tradeoffs (network flakiness in CI, shared dev-DB pollution across concurrent runs, no prior precedent for a "test/dev" CI secret vs. this repo's existing prod-adjacent build secrets).

**Risk #7 (extraction cost exposure).** This risk is **not open** the way the test plan's "research-first" framing assumed — a real, atomic cost-control mechanism already exists and is correctly wired. `reserve_extraction_attempt(p_cap integer)` (added via an impl-review triage fix during the original, archived `photo-to-recipe-save` change, replacing an earlier non-atomic count-then-insert race) does a single atomic `INSERT ... ON CONFLICT DO UPDATE` per-user-per-day counter, and is called at the sole extraction call site (`src/pages/api/recipes.ts`) **before** the expensive AI request, correctly fail-closed on cap breach (HTTP 429, extraction never invoked). No other call site reaches the AI service. The residual gap: the cap enforcement has **never been verified against a real Postgres instance** — existing coverage is a fully mocked unit test that only checks the route's handling of a pre-scripted RPC result, not the SQL function's actual atomicity under concurrent requests. This is the same class of gap Phase 3 (reversible-removal-correctness) just closed for the soft-delete guards: an implicit Postgres-native correctness guarantee, asserted only by reading the SQL, never exercised by a test.

## Detailed Findings

### CI workflow — current state

- `.github/workflows/ci.yml:9-24` (`ci` job): checkout → setup-node@22 → `npm ci` → `npx astro sync` → `npm run lint` → `npm run build` (env: `SUPABASE_URL`, `SUPABASE_KEY` secrets). No test step.
- `.github/workflows/ci.yml:26-45` (`deploy` job): `needs: ci` (line 27), gated `if: github.ref == 'refs/heads/master' && github.event_name == 'push'`. Rebuilds, then deploys via `cloudflare/wrangler-action@v3` with `CF_API_TOKEN`.
- Only one workflow file exists in `.github/workflows/`.
- `CLAUDE.md`'s own `## CI` section documents exactly this current state (lint + build only) — no mention of test gating anywhere in the file.

### `npm run test` is CI-ready with zero new secrets

- `vitest.config.ts`: `environment: "node"` (jsdom opt-in per file via `// @vitest-environment jsdom` pragma), `setupFiles: ["./vitest.setup.ts"]`, `exclude: [...configDefaults.exclude, "tests/integration/**"]` — the plain `test` script structurally cannot reach the integration suite.
- `vitest.setup.ts` — 7 lines, jest-dom matchers + RTL `cleanup()` only; no env loading, no network setup.
- Sampled 4 files across the suite, all fully mocked, zero real network/credentials:
  - `src/pages/api/recipes/[id]/restore.test.ts:4-6,15-25` — `vi.mock("@/lib/supabase", ...)`.
  - `src/lib/services/recipe-query.test.ts:9-33` — hand-built mock query builder, mocked `storage.createSignedUrls`.
  - `src/components/recipes/PhotoUploadForm.test.tsx:1,36-53` — jsdom pragma, `vi.stubGlobal("fetch", ...)`.
  - `src/lib/services/recipe-extraction.test.ts:3-6,38` — mocks `astro:env/server`, stubs global `fetch`.
- **Minimal CI change**: one `run: npm run test` step inside the existing `ci` job (e.g. after `npm run lint`, before `npm run build`). No new job, no new secrets. Because `deploy` already has `needs: ci`, this single line change is sufficient to make test failures block both merge-adjacent CI and deploy — closing risk #1 as stated, provided a failing `ci` job actually blocks the PR merge via branch protection (branch-protection rule configuration is outside this repo; not verified by this research — a scope decision for the plan).

### `npm run test:integration` is NOT CI-ready without new secrets

- `tests/integration/helpers/test-client.ts:48` calls `requireEnv("SUPABASE_TEST_URL")` / `requireEnv("SUPABASE_TEST_ANON_KEY")` — hard failure if unset.
- Repo-wide search for these two variable names outside the test harness/config finds only `.env.test.local.example:5-6` (dev project URL pre-filled, key blank) and design-doc mentions in `context/archive/2026-08-19-testing-cross-user-access-integrity/{plan.md,reviews/impl-review.md}`. **`ci.yml` never references them** — confirmed zero CI wiring today.
- `vitest.integration.config.ts:7-12` optionally loads `.env.test.local` via `process.loadEnvFile`, wrapped in try/catch specifically because "CI... may export directly instead" — the config already anticipates CI use, but nothing populates it yet.
- Existing CI-secret precedent (`SUPABASE_URL`/`SUPABASE_KEY` for build, `CF_API_TOKEN` for deploy — `ci.yml:22-24,44`) establishes that adding repo secrets is a normal, already-practiced pattern in this project. There is **no precedent** specifically for a "test/dev" tier secret distinct from the prod-adjacent build secret — this would be new, not unprecedented-in-kind.
- Two prior rollout phases explicitly deferred CI wiring to this phase rather than attempting it themselves: `context/archive/2026-08-19-testing-cross-user-access-integrity/plan.md:109-110` and `context/changes/testing-extraction-integrity/plan.md:104` both note "not this phase's job to fix, per test-plan §3 Phase 4."

### Extraction cost-control mechanism — already exists, already correctly wired

- Migration `supabase/migrations/20260816160000_atomic_extraction_rate_limit.sql` (full file): `extraction_daily_counters(user_id, day, count)`, PK `(user_id, day)`, RLS enabled with **no policies** (reachable only via the function). `reserve_extraction_attempt(p_cap integer) returns boolean` (`:19-41`): `v_user_id := auth.uid()`, then `insert ... on conflict (user_id, day) do update set count = count + 1 returning count` (`:33-37`), returns `v_count <= p_cap`. The migration's own header comment documents this replaced an earlier non-atomic "count-then-insert" implementation that had a TOCTOU race — i.e., the atomicity fix is a known, deliberate prior decision, not an accident of this research.
- Sole call site: `src/pages/api/recipes.ts` — `DAILY_ATTEMPT_CAP = 10` hardcoded literal (`:11`), RPC called at `:83-85` via `supabase.rpc("reserve_extraction_attempt", { p_cap: DAILY_ATTEMPT_CAP })`, **before** `photo.arrayBuffer()` (`:100`) and before `extractRecipeFromPhoto(...)` (`:104`) — the reservation genuinely gates the expensive call, not just logs after it. On RPC error → 500 (`:87-89`); on `withinCap === false` → HTTP 429 with a user-facing message, extraction never invoked (`:91-96`) — correct fail-closed behavior.
- `extractRecipeFromPhoto` (`src/lib/services/recipe-extraction.ts:102-124`) — the actual OpenRouter call, 10s timeout, no independent throttling of its own; relies entirely on the caller having already reserved a slot. Confirmed (via repo-wide grep) this is the only call site of `extractRecipeFromPhoto` in `src/` — no bypass route exists.
- No other throttling anywhere: `wrangler.jsonc` has no rate-limiting binding/rule; no IP-based throttling found in `src/`.
- **Test coverage gap**: `src/pages/api/recipes.test.ts` mocks `supabase.rpc` as a `vi.fn()` returning a canned `true`/`false` — it verifies the route's *handling* of a pre-scripted RPC result (e.g. `"returns 429 when the daily attempt cap is reached"`), never the RPC's actual SQL behavior. No `supabase/tests/` pgTAP directory exists. Grep across all test files for `reserve_extraction_attempt`/`extraction_daily_counters` finds zero references outside that mocked literal. **Atomicity and cap-enforcement-under-concurrency have never been verified against a real Postgres instance.**
- Cap value provenance: `DAILY_ATTEMPT_CAP = 10` is an implementer-level decision recorded only in the original archived change's plan-brief (`context/archive/2026-08-15-photo-to-recipe-save/plan-brief.md:43,55,62,64`) — never a PRD/roadmap requirement. `prd.md` and `roadmap.md` have zero cap/quota/rate-limit mentions tied to extraction. This means the specific number `10` carries no external authority to test against — a test should assert "the cap is enforced consistently" (behavioral), not "the cap must be exactly 10" (implementation-detail oracle problem risk if the plan isn't careful).

## Code References

- `.github/workflows/ci.yml:9-24` — `ci` job (lint + build only, no test step)
- `.github/workflows/ci.yml:26-45` — `deploy` job, `needs: ci` at line 27
- `vitest.config.ts` — full file; excludes `tests/integration/**`, no env loading
- `vitest.integration.config.ts:7-12` — optional `.env.test.local` load, CI-aware comment
- `vitest.setup.ts` — full file; no network/env setup
- `tests/integration/helpers/test-client.ts:48` — `requireEnv("SUPABASE_TEST_URL"/"SUPABASE_TEST_ANON_KEY")`
- `.env.test.local.example:5-6` — dev URL pre-filled, key blank
- `supabase/migrations/20260816160000_atomic_extraction_rate_limit.sql:1-6,19-41` — atomic rate-limit migration + header comment on the race it fixed
- `src/pages/api/recipes.ts:11,83-96,100,104` — `DAILY_ATTEMPT_CAP`, RPC call before AI call, 429 fail-closed handling
- `src/lib/services/recipe-extraction.ts:19,89,98-124` — the AI call itself, no independent throttling
- `src/pages/api/recipes.test.ts:45,155-161` — existing mocked-only cap test
- `context/archive/2026-08-15-photo-to-recipe-save/plan.md:339-346` — origin of the atomic rate-limit fix (impl-review triage addendum)
- `context/archive/2026-08-15-photo-to-recipe-save/plan-brief.md:43,55,62,64` — cap value provenance (implementer decision, not PRD/roadmap)

## Architecture Insights

- This project's recurring correctness pattern — an atomic, single-statement Postgres operation (`INSERT ... ON CONFLICT DO UPDATE`, or the `.is()`/`.not()` guarded `UPDATE`s Phase 3 tested) relied on for race-safety, verified only by reading the SQL, never by a concurrency test — has now shown up twice (soft-delete guards in Phase 3, the extraction rate-limit here). Both are strong, cheap integration-test candidates: seed real state, call the RPC/route through the real Supabase client, assert on returned row state, following the exact harness Phase 2/3 already established (`tests/integration/*.test.ts`, `createTestUser()`, hosted dev Postgres).
- The project's CI/CD posture has a consistent split: `ci.yml`'s `ci` job is the merge gate (lint + build today), and `deploy` is a strict downstream dependent (`needs: ci`) that only fires on `master` push. Any new required check belongs inside `ci`, not as a parallel job, to inherit this gating relationship for free.
- Two separate test-secret tiers already exist in the project's *design* (dev-scoped `SUPABASE_TEST_*` vs. prod-adjacent `SUPABASE_URL`/`SUPABASE_KEY`), but only the prod-adjacent tier has ever been wired into CI. Extending CI to the dev tier is additive, not a new pattern-class, but is still a genuine scope decision (cost/flakiness of running real-network tests on every PR) that `/10x-plan` should surface explicitly rather than default silently either way.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md:43,60,79,112-114` — Risk #1 definition, response guidance (explicitly leaves "is gate-wiring in scope" as an open question for this phase), Phase 4 row, and the quality-gates table marking unit/integration and RLS gates as "required after §3 Phase 4."
- `context/archive/2026-08-19-testing-cross-user-access-integrity/research.md:281-283,312` and `plan.md:109-110`, `plan-brief.md:59` — that phase inspected CI itself, confirmed the same gap, and explicitly deferred fixing it to this phase.
- `context/changes/testing-extraction-integrity/plan.md:104`, `plan-brief.md:54` — same deferral pattern.
- `context/archive/2026-08-15-photo-to-recipe-save/plan.md:339-346` — the atomic rate-limit fix's origin (impl-review triage on the original extraction feature build).
- `context/archive/2026-08-19-testing-cross-user-access-integrity/research.md:145-150` — that phase already catalogued `reserve_extraction_attempt` while researching RLS, explicitly scoped it out as "out of scope for #4/#6" — confirms no overlap with this phase's coverage.
- `context/foundation/infrastructure.md:78,80,105-106,116` — precedent for `wrangler secret put` per environment and existing CI secret consumption (`CF_API_TOKEN`); explicitly notes an agent should not perform secret rotation unsupervised.
- `context/archive/2026-08-15-supabase-auth-setup/plan-brief.md:34,49`, `plan.md:65` — that change explicitly declined to automate secret delivery via CI, leaving it manual via the Cloudflare dashboard — relevant precedent if the plan considers whether to add `SUPABASE_TEST_*` as CI secrets versus another approach.

## Related Research

- `context/changes/testing-ci-gate-resource-abuse-posture/change.md` — this change's identity file (risks #1, #7 intent).
- `context/archive/2026-08-19-testing-cross-user-access-integrity/research.md` — establishes the integration-test harness this phase's risk-#7 test (if scoped in) should reuse.
- `context/changes/testing-reversible-removal-correctness/research.md` and `plan.md` — sibling precedent for testing an atomic, implicit-Postgres-guarantee correctness pattern via a real-Postgres integration test; directly analogous to the `reserve_extraction_attempt` gap found here.

## Open Questions

- **CI gate scope**: is adding the single `npm run test` step (zero new secrets, immediate) the full scope of risk #1 for this phase, or should `npm run test:integration` also be wired in (requires two new GitHub secrets, real-network-in-CI tradeoffs: flakiness, shared dev-DB pollution across concurrent PR runs, cost)? Recommend `/10x-plan` decide explicitly and could reasonably split this into two sub-phases (unit-test gate now, integration-test gate as a distinct, more carefully justified sub-phase) rather than treating them as one atomic decision.
- **Risk #7 framing correction**: the test plan's original "research-first, do not invent a test for a safeguard that may not exist" framing assumed the safeguard's existence was unknown. It is not — the safeguard exists and is correctly wired. The remaining, real, testable gap is narrower: prove `reserve_extraction_attempt`'s atomicity/cap-enforcement holds under concurrent real-Postgres calls (a cheap integration test, same pattern as Phase 3), not a broader "does cost control exist" investigation. Recommend backporting this correction into `test-plan.md` §2 (Risk #7's Source/response-guidance currently reads as if the mechanism's existence were unconfirmed) via the standard post-research backport check.
- **Branch protection**: whether GitHub branch protection rules actually require the `ci` check to pass before merge (as opposed to just running it) was not verified by this research — outside the repo's own files. If branch protection isn't configured to require the `ci` check, adding a test step to `ci.yml` alone would not fully close risk #1 ("blocks merge on failure"); `/10x-plan` should decide whether verifying/configuring branch protection is in scope or a separate follow-up.
