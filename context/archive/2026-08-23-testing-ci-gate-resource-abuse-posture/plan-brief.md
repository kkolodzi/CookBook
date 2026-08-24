# CI Gate & Resource-Abuse Posture — Plan Brief

> Full plan: `context/changes/testing-ci-gate-resource-abuse-posture/plan.md`
> Research: `context/changes/testing-ci-gate-resource-abuse-posture/research.md`

## What & Why

Rollout Phase 4 of `context/foundation/test-plan.md` (risks #1 and #7). Fixes a branch-trigger
bug that has left the CI workflow completely inert since the repo's default branch became `main`,
adds `npm run test` as a required gate, and proves the existing extraction rate-limit RPC's
atomic cap enforcement actually holds — the one part of it never verified against real Postgres.

## Starting Point

`.github/workflows/ci.yml` triggers on `branches: [master]`, but this repo's only branch, ever,
is `main` — confirmed via `git ls-remote` and zero GitHub Actions runs in history. CI has never
executed once, lint/build included. Separately, research revealed risk #7's premise was wrong:
a real, atomic cost-control mechanism (`reserve_extraction_attempt`) already exists and is
correctly wired before the AI call — but only tested against a mocked RPC result, never real
Postgres concurrency.

## Desired End State

CI actually runs on every PR against `main`, with `npm run test` as a required step (zero new
secrets — the suite is fully mocked). A new integration test proves the extraction cap RPC
enforces correctly across a sequential run of calls. `CLAUDE.md` and `test-plan.md` both reflect
what actually shipped.

## Key Decisions Made

| Decision                          | Choice                                                   | Why (1 sentence)                                                                 | Source   |
| ---------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| CI test-suite scope                | `npm run test` only, every PR                              | Zero new secrets, zero network-in-CI flakiness; closes risk #1's core claim now. | Plan     |
| Branch protection                  | Left as a follow-up, not configured this phase             | Repo-settings change outside version control, out of this phase's code-only scope. | Plan     |
| Rate-limit test design             | Sequential-loop proof, not a concurrent `Promise.all` race | User's explicit choice over the recommended concurrent-race option.              | Plan     |
| test-plan.md §2 backport           | Included as Phase 3                                        | Matches Phase 3's own precedent of updating the cookbook in its final sub-phase. | Plan     |
| CLAUDE.md docs sync                | Included as Phase 3                                        | Leaving it wrong would re-seed the exact assumption that caused the CI bug.      | Plan     |
| Rate-limit test cap value          | Test-owned `p_cap` (e.g. 3), not the production `10`        | Avoids the oracle-problem risk research flagged; RPC takes `p_cap` as a parameter. | Plan     |

## Scope

**In scope:**

- Fixing `.github/workflows/ci.yml`'s `master` → `main` branch references (trigger + deploy gate)
- Adding `npm run test` as a required CI step
- A new integration test proving `reserve_extraction_attempt`'s cap enforcement (sequential)
- Syncing `CLAUDE.md`'s CI section and `test-plan.md` §2 Risk #7 to match reality

**Out of scope:**

- Wiring `npm run test:integration` into CI (needs new secrets; deferred)
- Configuring GitHub branch protection to require the `ci` check
- A concurrent (`Promise.all`) race test for the rate-limit RPC
- Any new rate-limiting/throttling layer beyond what already exists

## Architecture / Approach

Phase 1 fixes the root cause (wrong branch name) and adds the cheapest gate in one change — a
gate that never triggers is as useless as no gate. Phase 2 follows the exact single-concern
integration-test convention Phases 2–3 established, calling the RPC directly with its own cap
value rather than routing through the real API endpoint. Phase 3 syncs the two documents that
currently assert something no longer true.

## Phases at a Glance

| Phase                      | What it delivers                                              | Key risk                                                        |
| ---------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. CI branch fix + test gate | Working `ci.yml` triggering on `main`, `npm run test` required   | Verifying the trigger fix requires a real PR, not just local tools  |
| 2. Rate-limit test           | `extraction-rate-limit.test.ts` — 3 cases                        | None significant — direct precedent from Phases 2–3                 |
| 3. Docs sync                 | `CLAUDE.md` + `test-plan.md` §2 corrected                        | None                                                                 |

**Prerequisites:** None beyond what already exists (`.env.test.local` already populated from
earlier phases).
**Estimated effort:** ~1 session, 3 phases, one YAML fix + 3 new test cases + 2 doc edits.

## Open Risks & Assumptions

- Phase 1's manual verification requires actually opening a PR against `main` to confirm the
  `ci` check triggers — this can't be verified by local tooling alone.
- Deferring branch protection means a failing `ci` check doesn't yet literally block merge; this
  is a known, deliberate gap left for a follow-up, not an oversight.

## Success Criteria (Summary)

- A PR against `main` shows a running, and enforceable-in-spirit, `ci` check that includes tests.
- `reserve_extraction_attempt`'s cap enforcement is proven against real Postgres, not just mocks.
- `CLAUDE.md` and `test-plan.md` no longer describe a CI setup or an "unknown" risk #7 that isn't
  true anymore.
