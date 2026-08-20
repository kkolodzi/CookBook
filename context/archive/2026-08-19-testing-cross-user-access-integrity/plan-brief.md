# Cross-User Access & Reference Integrity Testing — Plan Brief

> Full plan: `context/changes/testing-cross-user-access-integrity/plan.md`
> Research: `context/changes/testing-cross-user-access-integrity/research.md`

## What & Why

Land the project's first real-Postgres integration-test layer to prove RLS actually isolates users
on `recipes`, `recipe_ingredients`, and `storage.objects` (risk #4), and to prove a recipe's
`photo_path` can't be set to point at another user's storage object even via a direct insert (risk
#6). The mocked-Supabase convention used everywhere else in this project structurally cannot test
either claim — it fabricates the entire query builder and never runs real SQL, so RLS enforcement is
outside what it could ever catch.

## Starting Point

RLS on all three tables is already correctly configured today (confirmed in research). Risk #6 is
not: `photo_path` has zero database-level tie to `storage.objects`, and the only thing preventing a
cross-user reference is that the one app route that writes it (`POST /api/recipes`) always derives
the path server-side and never trusts client input — a previously-recorded, deliberately-deferred gap
(impl-review finding F2). No integration-test infrastructure existed at plan time.

**Mid-implementation pivot**: the plan originally targeted a local Docker Supabase stack. Phase 1 hit
two consecutive Windows/Docker environment blockers (daemon not running, then a system-wide port
exclusion requiring elevated privileges to fix). After weighing the tradeoffs with the user, the plan
now targets the hosted `SnapRecipe` **dev** project directly instead — see the full plan's "What
Changed From Research" section for the reasoning and mitigations.

## Desired End State

`npm run test:integration` runs a real-Postgres suite (against `SnapRecipe` dev) proving both risks
are covered. The `photo_path` gap is closed with a new DB trigger, applied to dev first and proven
via the integration suite, then deployed to prod (`SnapRecipe_live`). The test-plan cookbook
documents the pattern, including the dev-vs-local deviation.

## Key Decisions Made

| Decision                          | Choice                                              | Why (1 sentence)                                                                 | Source   |
| ---------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| Risk #6 scope                      | Close the gap now, not just test/document it        | User chose to fix rather than pin a known, unmitigated security gap.               | Plan     |
| Two-user provisioning              | Plain `auth.signUp()`, no service-role client         | Sign-up doesn't require email confirmation on either local or hosted dev; avoids a new admin-key surface entirely. | Plan     |
| Test-user cleanup                  | None — disposable, uniquely-named, `integration-test-` prefixed | Kept identifiable/cleanable in a real project since local was dropped.    | Plan (revised) |
| **Test target**                    | **Hosted `SnapRecipe` dev, not local Docker**        | **Local Supabase hit two consecutive Windows/Docker blockers; dev is the developer's own project, not shared.** | **Plan (revised mid-implementation)** |
| Phase 2 sanity check               | Assertion-inversion inside the test file, not disabling a live policy | Switching to a real hosted target made schema mutation for a sanity check too risky; this redesign is safer regardless of target. | Plan (revised) |
| Vitest wiring                      | Separate `vitest.integration.config.ts` + new script  | Integration tests need different environment/timeouts than the fast unit config; matches "add a layer, don't modify the existing one." | Plan     |
| Test file location                 | New `tests/integration/` folder, not colocated        | These tests exercise table/RLS behavior directly, not one route or component.      | Plan     |
| Trigger security mode              | Not `security definer`                                | The check only needs rows the acting user already owns; least-privilege, no new bypass surface. | Plan     |

## Scope

**In scope:**
- New Vitest integration config + `test:integration` script
- Two-user test-client helper (no admin key, no cleanup, tagged emails)
- Cross-user RLS tests for `recipes`, `recipe_ingredients`, `storage.objects`, and the `edit_recipe` RPC, run against `SnapRecipe` dev
- A new migration (trigger) closing the `photo_path` ownership gap, applied to dev then prod
- Cookbook (`test-plan.md` §6.3) update, including the dev-vs-local deviation

**Out of scope:**
- CI wiring for this suite (test-plan §3 Phase 4's job)
- Any local Docker Supabase work (parked; Windows port-exclusion issue unresolved)
- Any service-role/admin Supabase client
- Any test traffic against `SnapRecipe_live` (prod) — prod only ever receives the finished migration
- Backfilling or auditing existing `recipes` rows against the new trigger
- Any change to `edit_recipe`'s own logic (only a test proving it already works correctly)

## Architecture / Approach

Two real, uniquely-named (`integration-test-` prefixed) test users are created per test via a plain
`@supabase/supabase-js` client's `signUp()` against `SnapRecipe` dev — no service-role key. Tests run
each operation through the acting user's own session-bound client, so RLS is exercised exactly as
production would. Risk #6's fix is a `before insert or update of photo_path` trigger on `recipes`
that requires a matching, same-owner row in `storage.objects` — applied to dev, proven via the
integration suite, then pushed to prod through the same `supabase link` + `db push` flow every prior
schema change has used.

## Phases at a Glance

| Phase                                    | What it delivers                                              | Key risk                                                          |
| ----------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Harness scaffold                       | Vitest config, script, two-user helper, smoke test (against dev) | None remaining — dev-target pivot already resolved the blocker       |
| 2. Cross-user RLS tests (#4)               | Proves RLS denies cross-user ops on all 3 tables + `edit_recipe`, non-invasive sanity check | Assertions on RLS error shape must match what this Supabase version actually returns |
| 3. `photo_path` fix, dev then prod (#6)    | New trigger applied to dev + tested, then pushed to prod          | Trigger must not break the real upload flow it's modeled on          |
| 4. Cookbook update                         | `test-plan.md` §6.3 filled in, including the dev-target deviation | Low — documentation only                                             |

**Prerequisites:** `.env.test.local` (git-ignored) populated with `SnapRecipe` dev's URL + anon key
(never prod's).
**Estimated effort:** ~4 sessions, one per phase — Phase 3 (the schema fix + prod deploy) is the
highest-stakes since it's the only phase touching production data.

## Open Risks & Assumptions

- The exact RLS error shape (permission error vs. silently empty result) for each blocked operation
  is confirmed live while writing Phase 2's tests, not assumed in advance.
- Test users accumulate permanently in `SnapRecipe` dev by design — acceptable at this project's
  data volume, but worth knowing if the dev project is ever used for something sensitive to row
  count.

## Success Criteria (Summary)

- `npm run test:integration` passes against `SnapRecipe` dev, covering both risks with real
  cross-user assertions
- The `photo_path` ownership trigger is live and verified in both hosted Supabase projects
- `test-plan.md` §6.3 gives a future contributor everything needed to add another integration test
  without re-deriving any of this, including why dev (not local) is the target
