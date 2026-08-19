# Cross-User Access & Reference Integrity Testing — Implementation Plan

## Overview

Land the project's first real-Postgres integration-test layer to prove two things the mocked-Supabase
convention structurally can't: (1) RLS actually denies cross-user reads/writes against `recipes`,
`recipe_ingredients`, and `storage.objects` (bucket `recipe-photos`) — risk #4; and (2) a `recipes`
row's `photo_path` cannot be set to point at a storage object the acting user doesn't own, even via a
direct insert — risk #6. Risk #6 currently has **no** database-level protection (only an app-route
convention), so this plan also adds a DB-level fix (a trigger) and deploys it to both hosted Supabase
projects.

**Deviation from the original plan, decided during Phase 1 implementation**: the plan originally
targeted a local Docker-based Supabase stack (`npx supabase start`) as the test target, isolated from
both hosted projects, per `test-plan.md` §4's constraint that "tests must not run against either."
During implementation this hit two consecutive environment blockers on this machine — Docker
Desktop's daemon wasn't running, and once started, Windows had dynamically excluded the entire local
port range Supabase needs (`54241–54340`, covering all of ports 54321–54329), requiring an
elevated-privileges system-service restart to fix. Rather than keep fighting local infrastructure,
this plan now targets the hosted **`SnapRecipe` dev project** (`xmyeeuyeszvpvrjszohr`) directly —
explicitly **not** `SnapRecipe_live` (prod). This is a considered, user-confirmed deviation from
`test-plan.md` §4, not a silent one; see "What Changed From Research" below for the full reasoning
and the mitigations that make this safe.

## What Changed From Research

`research.md` grounded this plan in a local-Postgres design (see its "Open Questions" §2-3). That
design is still sound in principle, but proved impractical on this development machine today. Two
concerns from the original local-only reasoning needed mitigation before targeting hosted dev safely,
both resolved here:

1. **Throwaway test users accumulating in a real project.** Mitigated by prefixing every test user's
   email with `integration-test-` (e.g. `integration-test-<uuid>@example.com`), making them
   trivially identifiable and safe to bulk-delete later if the project ever needs tidying. This is
   `SnapRecipe` — the developer's own personal dev project, not shared with teammates.
2. **Phase 2's original "temporarily disable a live RLS policy" sanity check** would have meant
   mutating a real, hosted database's security policies, even briefly. Redesigned below to invert an
   assertion inside the test file instead (see Phase 2) — proves the same thing (the suite would
   catch a real regression) without ever touching a live policy, on any database. This redesign is
   strictly safer and would have been the better choice even under the original local-only design.
3. **Confirmed live, not assumed**: hosted dev's auth config does not require email confirmation
   either (verified via a direct `POST /auth/v1/signup` call against `https://xmyeeuyeszvpvrjszohr.supabase.co`
   during planning — a session/access token came back immediately). The plain-`signUp()`,
   no-service-role-key design from the original plan carries over unchanged.

Local Supabase (`npx supabase start`) remains a reasonable future upgrade once the Windows port
exclusion is resolved (`net stop winnat && net start winnat` in an elevated terminal, then retry) —
not pursued further in this plan.

## Current State Analysis

- RLS is fully enabled and correct today on all three tables in scope
  (`supabase/migrations/20260815132912_recipe_schema.sql:46-67,80-132`,
  `supabase/migrations/20260815134500_recipe_photos_bucket.sql:8-43`) — see `research.md` for the
  exact policy definitions. No test in the repo currently exercises any of this against a real
  Postgres instance; both existing "integration" tests (`src/pages/api/recipes.test.ts`,
  `src/lib/services/recipe-query.test.ts`) fully mock the Supabase client and assert on *what the code
  called*, never on what the database actually enforces.
- `recipes.photo_path` (`supabase/migrations/20260815132912_recipe_schema.sql:30`) is a plain
  `text not null` column with zero FK/CHECK/trigger tying it to `storage.objects`. The only thing
  preventing a cross-user reference today is that `POST /api/recipes`
  (`src/pages/api/recipes.ts:116-135`) always derives `photo_path` server-side from `user.id` and a
  fresh UUID, immediately before use — it never accepts a client-supplied path. This is a recorded,
  previously-deferred gap (`context/archive/2026-08-15-recipe-data-schema/reviews/impl-review.md:39-53`,
  finding F2), not a new discovery.
- No integration-test infrastructure exists: one flat `vitest.config.ts` (`environment: "node"`, no
  `include`/`exclude` split), no admin/service-role Supabase client anywhere in `src/`, no
  two-test-user helper, `package.json` has only a single `"test": "vitest run"` script.
- `SnapRecipe` (dev, `xmyeeuyeszvpvrjszohr`) already has the full schema this plan tests against
  (`recipes`, `recipe_ingredients`, `recipe-photos` bucket, all with RLS) — deployed there originally
  by the archived `recipe-data-schema` change. Its auth config allows sign-up without email
  confirmation (confirmed live during planning), so the same-plan test-user helper design works
  unchanged against it.

## Desired End State

`npm run test:integration` (new script) runs a real-Postgres integration suite against the hosted
`SnapRecipe` dev project that:

- Proves `recipes`, `recipe_ingredients`, and `storage.objects`/`recipe-photos` all deny cross-user
  reads/writes at the database level, using two real authenticated users and no mocking.
- Proves the `edit_recipe` RPC rejects another user's `recipe_id`.
- Proves a direct insert into `recipes` with a `photo_path` pointing at another user's real,
  uploaded storage object is rejected by the database itself (not just by app-route convention),
  while the legitimate same-owner case still succeeds.

The new DB-level protection (a trigger on `recipes`) is live in both hosted projects (`SnapRecipe`
dev, `SnapRecipe_live` prod). `test-plan.md` §6.3 documents the new pattern for future integration
tests, including the dev-project-as-test-target deviation. Verify by: running
`npm run test:integration` locally with all assertions passing, and confirming the trigger/function
exist in both hosted projects' Studio.

### Key Discoveries:

- `src/pages/api/recipes.ts:116` — `storagePath` is generated as `` `${user.id}/${crypto.randomUUID()}.${ext}` `` immediately before the Storage upload and reused verbatim for the `recipes` insert two lines later — the real upload flow will always satisfy an ownership-matching trigger, so the fix is safe to add without touching route code.
- `edit_recipe`'s `UPDATE` statement (`supabase/migrations/20260816190000_edit_recipe_instructions.sql:21-24`) never lists `photo_path` in its `SET` clause, so a `before ... update of photo_path` trigger will never fire from that RPC — no interaction to account for.
- Hosted dev's auth does not require email confirmation (verified live via `POST /auth/v1/signup` against `https://xmyeeuyeszvpvrjszohr.supabase.co` — an `access_token` came back immediately) — test users need only `auth.signUp()` via the plain `@supabase/supabase-js` client (not the SSR-cookie-bound `src/lib/supabase.ts` factory, which requires live `Headers`/`AstroCookies`). No service-role key anywhere in this plan.
- Node 22.14.0 (`.nvmrc`) has built-in `process.loadEnvFile()` — no new dependency needed to load a git-ignored `.env.test.local` into the integration Vitest config.
- `storage.objects` has a default unique index on `(bucket_id, name)` (Supabase platform default, not defined in this repo's migrations) — the trigger's existence check is checking against a genuinely unique key, not a duplicate-prone one.

## What We're NOT Doing

- Not building a service-role/admin Supabase client — test users are disposable, uniquely-named
  (`integration-test-<uuid>@example.com`), and identifiable-but-unmanaged in the hosted dev project.
- Not running any test against `SnapRecipe_live` (prod) — only `SnapRecipe` (dev) is a test target;
  prod only ever receives the finished migration, never test traffic.
- Not mutating any live RLS policy, even temporarily, for the Phase 2 sanity check — redesigned to be
  schema-non-invasive (see Phase 2).
- Not wiring this suite into CI — `test-plan.md` §3 Phase 4 owns the CI-gate decision for the whole
  test suite (including the existing unit/component layer, which also isn't wired in yet).
- Not backfilling or auditing existing `recipes` rows against the new trigger — it's a forward-only
  guard on future inserts/updates of `photo_path`, matching how the column's `not null` constraint
  itself behaves (no retroactive data audit).
- Not changing the `edit_recipe` RPC or its existing manual ownership-guard pattern — Phase 2 adds a
  test proving it already works correctly; no code change to the function itself.
- Not pursuing local Docker Supabase further in this plan — parked as future work once the Windows
  port-exclusion issue is resolved outside this session.

## Implementation Approach

Four phases, strictly ordered: prove the test harness itself works before writing risk assertions (so
a harness bug can't masquerade as a passing security test); prove risk #4 (already-correct RLS)
before touching schema, to validate the harness against known-good behavior first; only then add and
prove the risk #6 fix directly against dev, then push the same migration to prod; document the
pattern last, once it's proven to work.

## Critical Implementation Details

- **The trigger does not need to be `security definer`.** Unlike `edit_recipe`, the validation query
  (`select 1 from storage.objects where bucket_id = 'recipe-photos' and name = new.photo_path and
  owner = new.user_id`) only needs to see rows the acting user already owns — and `new.user_id` is
  already constrained to equal `auth.uid()` by `recipes`' own `with check` clause on insert/update.
  So `storage.objects`' existing `owner = (select auth.uid())` select policy and this query's
  explicit `owner = new.user_id` filter are equivalent for a legitimately-scoped row, and running as
  the invoking role (not the table owner) is strictly safer — no new RLS-bypass surface is
  introduced.
- **Credentials are never hardcoded.** `.env.test.local` (git-ignored) holds `SnapRecipe` dev's
  project URL and anon key, obtained via the Supabase dashboard/CLI, not committed anywhere.
  `.env.test.local.example` (committed) documents the two required keys with placeholder values.
- **Test users are permanent, tagged clutter in a real project, by design.** Every integration test
  run adds real rows to `SnapRecipe` dev (users, recipes, storage objects). This is accepted, not
  accidental — the `integration-test-` email prefix makes them trivially findable if cleanup is ever
  wanted, and this project's data volume is low enough that it's a non-issue in practice.

## Phase 1: Integration-test harness scaffold

### Overview

Stand up the Vitest config, script, env-file convention, and two-user test-client helper — proven
by one smoke test against the hosted `SnapRecipe` dev project — before any risk-specific assertions
exist.

### Changes Required:

#### 1. Integration Vitest config

**File**: `vitest.integration.config.ts`

**Intent**: A separate config for the new layer — real Node environment, no jsdom, its own include
glob, longer timeout for real network/DB calls — kept independent of the existing fast unit/component
config per the "add a layer, don't modify the existing one" decision.

**Contract**: Mirrors `vitest.config.ts`'s `resolve.alias` (`@` → `./src`) and `environment: "node"`,
but sets `test.include: ["tests/integration/**/*.test.ts"]` and a longer `test.testTimeout` (e.g.
15000ms — real HTTP calls to a hosted project are slower than mocked unit tests). Loads
`.env.test.local` via Node's built-in `process.loadEnvFile()`, wrapped so a missing file (CI, or a
developer using plain shell-exported env vars) doesn't throw.

#### 2. `test:integration` script

**File**: `package.json`

**Intent**: A dedicated run command, parallel to the existing `"test"` script, that selects the new
config.

**Contract**: `"test:integration": "vitest run -c vitest.integration.config.ts"`.

#### 3. Two-user test-client helper

**File**: `tests/integration/helpers/test-client.ts`

**Intent**: Give every integration test a one-line way to get a fresh, uniquely-identified,
authenticated Supabase client against the dev project — no admin/service-role key, no cleanup.

**Contract**: Exports an async `createTestUser()` returning `{ client, userId, email }`. Internally:
build a plain `@supabase/supabase-js` `createClient<Database>(url, anonKey)` (not the SSR wrapper —
no `Headers`/`AstroCookies` available outside a request), read `SUPABASE_TEST_URL` and require
`SUPABASE_TEST_ANON_KEY` from `process.env` (throw a clear, actionable error naming
`.env.test.local.example` if unset), then call `client.auth.signUp({ email:
\`integration-test-${crypto.randomUUID()}@example.com\`, password: crypto.randomUUID() })` and
return the now session-bound client plus `data.user.id`.

#### 4. Env-file convention

**Files**: `.env.test.local.example` (committed), `.gitignore` (append `.env.test.local`)

**Intent**: Document the two required test env vars without ever committing a real key value.

**Contract**: `.env.test.local.example` contains `SUPABASE_TEST_URL=` and `SUPABASE_TEST_ANON_KEY=`
(both empty), with a comment pointing at the `SnapRecipe` (dev) project — explicitly not
`SnapRecipe_live`.

#### 5. Smoke test

**File**: `tests/integration/harness-smoke.test.ts`

**Intent**: Prove the harness itself works — a user can be created, can upload a photo and insert a
recipe as themselves, and can read it back — before any cross-user assertion is written on top of it.

**Contract**: One test: `createTestUser()`, upload a small file to `recipe-photos`, insert a
`recipes` row referencing it, `select` it back, assert it matches.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes (harness smoke test) against `SnapRecipe` dev
- `npm run lint` passes on all new files

#### Manual Verification:

- `.env.test.local` does not appear in `git status` (confirms it's actually git-ignored)
- Supabase Studio for `SnapRecipe` (dev): the smoke test's `integration-test-` user and its recipe
  row are visible, confirming the test ran against the real dev project

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 2: Cross-user RLS integration tests (risk #4)

### Overview

Prove RLS actually isolates users on all three tables in scope, plus the `edit_recipe` RPC's manual
ownership guard, using two real authenticated users and no mocking.

### Changes Required:

#### 1. Cross-user RLS test suite

**File**: `tests/integration/cross-user-rls.test.ts`

**Intent**: For each of `recipes`, `recipe_ingredients`, and `storage.objects`/`recipe-photos`,
prove that user A cannot select, insert, update, or delete user B's rows/objects — and that user A's
own equivalent operations still succeed (a pure "everything's blocked" suite that never exercises the
success path would be a false-positive risk in itself). Also prove `recipe_ingredients_insert_own`
rejects an insert naming another user's `recipe_id`, and that the `edit_recipe` RPC returns a
falsy/no-op result (not an error, per its existing `return false` contract) when called with another
user's `p_recipe_id`.

**Contract**: Two `createTestUser()` calls per test (or a shared `beforeAll` pair, reused across
cases in this file). For each table/operation pair: user A creates a row via their own client; user
B's client attempts the cross-user operation and the assertion is on the Postgrest error/empty-result
shape (RLS violations surface as either a `42501`-style permission error or a silently empty
affected-row set, depending on operation — assert on whichever this project's Supabase version
actually returns, observed while writing the test, not assumed in advance).

#### 2. Non-invasive regression sanity check

**File**: `tests/integration/cross-user-rls.test.ts` (same file, one additional, self-contained case)

**Intent**: Prove this test layer would actually catch a real RLS regression, without ever mutating a
live policy on any database — the redesign from "What Changed From Research" above.

**Contract**: One test case that constructs a Postgrest query bypassing the normal helper — e.g.
directly asserting that a hand-crafted request *without* the acting user's session (using a bare
client with no signed-in user, or user A's client queried for user B's row with the filter
deliberately omitted) is rejected — i.e., proves the *assertion itself* is capable of failing by
exercising a known-bad path within the same test run, rather than by disabling real policies. Document
inline (a short comment) why this replaces a schema-mutation sanity check.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes, including every case in `cross-user-rls.test.ts`
- `npm run lint` passes

#### Manual Verification:

- Spot-check Supabase Studio for `SnapRecipe` (dev) → Authentication: the two `integration-test-`
  users from this phase's run are present, confirming real cross-user identities were exercised (not
  a single reused session)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 3: `photo_path` ownership DB fix, deployed to dev then prod (risk #6)

### Overview

Add the database-level guard risk #6 currently lacks, apply it to `SnapRecipe` dev (the same project
the integration suite already targets, so the fix is proven in place immediately), then push the
same migration to `SnapRecipe_live` (prod).

### Changes Required:

#### 1. Ownership-check trigger migration

**File**: `supabase/migrations/<timestamp>_recipe_photo_path_storage_ownership.sql`

**Intent**: Close the recorded, previously-deferred gap (impl-review F2) — `recipes.photo_path` must
reference a `storage.objects` row in bucket `recipe-photos` owned by the same user, enforced at
insert time and whenever `photo_path` is updated.

**Contract**:

```sql
create or replace function validate_recipe_photo_path_ownership()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'recipe-photos'
      and name = new.photo_path
      and owner = new.user_id
  ) then
    raise exception 'photo_path must reference a storage object in recipe-photos owned by the same user';
  end if;
  return new;
end;
$$;

create trigger recipes_photo_path_ownership_check
  before insert or update of photo_path on recipes
  for each row
  execute function validate_recipe_photo_path_ownership();
```

Not `security definer` — see Critical Implementation Details above for why that's correct here, not
an oversight.

Applied via `supabase link --project-ref xmyeeuyeszvpvrjszohr` (dev) → `supabase db push`.

#### 2. `photo_path` ownership test

**File**: `tests/integration/photo-path-ownership.test.ts`

**Intent**: Prove the trigger actually does its job against real data — a real uploaded object, not
a guessed path string, so the test reflects the actual threat model.

**Contract**: Two cases, run against dev (where the trigger now lives). Negative: user B uploads a
real file to `recipe-photos` (via their client, so `owner` is set correctly by Storage's own RLS);
user A's client attempts a direct `recipes` insert with `photo_path` set to that exact object key and
`user_id = A`; assert the insert fails with the trigger's exception. Positive: user A uploads their
own file and inserts a `recipes` row referencing it; assert the insert succeeds — this is the
regression guard for the real `POST /api/recipes` flow.

#### 3. Push to prod

**File**: n/a — CLI operation, reuses the migration file from item 1

**Intent**: Bring `SnapRecipe_live` in sync with dev, so the ownership guard is live wherever real
users' data lives, only after it's proven correct against dev via the integration suite.

**Contract**: `supabase link --project-ref gtrhakzhlammvfifvlyf` (prod) → `supabase db push`, only
after item 2's tests pass against dev.

### Success Criteria:

#### Automated Verification:

- `supabase link --project-ref xmyeeuyeszvpvrjszohr` succeeds; `supabase db push` applies the new
  migration to dev with exit code 0
- `npm run test:integration` passes, including both cases in `photo-path-ownership.test.ts`, against
  dev
- `supabase link --project-ref gtrhakzhlammvfifvlyf` succeeds; `supabase db push` applies the same
  migration to prod with exit code 0
- `npm run lint` passes

#### Manual Verification:

- Studio (dev, `SnapRecipe`): trigger + function present on `recipes`
- Studio (prod, `SnapRecipe_live`): trigger + function present on `recipes`
- Spot-check one existing recipe row in each project is still readable (confirms the trigger, which
  only fires on insert/update of `photo_path`, doesn't affect existing reads)
- Exercise the real photo-upload flow once against the dev-linked app and confirm it still saves
  successfully in the actual hosted environment

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 4: Cookbook update

### Overview

Fill in `test-plan.md` §6.3 with this phase's pattern, per the rollout convention that every phase's
plan ends by updating the relevant cookbook entry — including the dev-project-as-test-target
deviation from the original local-only design.

### Changes Required:

#### 1. §6.3 cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Give future contributors (and `/10x-tdd` in Module 3 Lesson 2) a concrete answer for "how
do I add an RLS/cross-user integration test in this project?" — replacing the current
`TBD — see §3 Phase 2` placeholder, and documenting why the target is hosted dev rather than local.

**Contract**: Follows the shape of the existing §6.1/§6.2 entries: test type (integration, Vitest,
real Postgres via the hosted `SnapRecipe` dev project, no mocking — a deviation from §4's original
"needs a local Supabase stack" line, with the reasoning summarized), location convention
(`tests/integration/*.test.ts`, not colocated — these test table/RLS behavior, not one route),
prerequisites (`.env.test.local` populated with `SnapRecipe` dev's URL + anon key, never
`SnapRecipe_live`), reference test (`tests/integration/cross-user-rls.test.ts`), run command
(`npm run test:integration`), and a note on the two-user helper
(`tests/integration/helpers/test-client.ts`, no service-role key, no cleanup, `integration-test-`
email prefix).

### Success Criteria:

#### Manual Verification:

- §6.3 reads accurately against what Phases 1-3 actually built (location, naming, reference test, run
  command, prerequisites, and the dev-vs-local deviation all correct)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Testing Strategy

### Unit Tests:

N/A — this plan's deliverable is the integration-test layer itself; no new unit-testable application
code is introduced beyond the trigger function (which is only meaningfully testable against real
Postgres, i.e. via the Phase 3 integration test, not a unit test).

### Integration Tests:

- Phase 1: harness smoke test (one authenticated user, own-data round-trip) against `SnapRecipe` dev
- Phase 2: cross-user denial + own-data success, across `recipes`, `recipe_ingredients`,
  `storage.objects`, and the `edit_recipe` RPC, plus a non-invasive regression sanity check
- Phase 3: `photo_path` ownership — mismatched-owner rejection and same-owner success, against dev,
  before the same migration is pushed to prod

### Manual Testing Steps:

1. Populate `.env.test.local` with `SnapRecipe` dev's URL and anon key
2. Run `npm run test:integration`; confirm every case passes
3. Manually exercise the real photo-upload flow against dev (Phase 3) and again after the prod push,
   to confirm the new trigger never rejects a legitimate upload

## Performance Considerations

The new trigger adds one indexed lookup (`storage.objects` has a default unique index on
`(bucket_id, name)`) per `recipes` insert or update-of-`photo_path` — negligible given this project's
low per-user data volume (`recipe-data-schema` plan: "low qps, personal collections"). No new indexes
needed.

## Migration Notes

Purely additive — a new function + trigger, no column/table changes, no backfill. Existing rows are
never re-validated retroactively; the guard only governs future writes, consistent with how
`photo_path`'s existing `not null` constraint already behaves.

## References

- Research: `context/changes/testing-cross-user-access-integrity/research.md`
- Test-plan source: `context/foundation/test-plan.md` §2 (risks #4, #6), §3 Phase 2, §4 Stack
- Prior schema decisions: `context/archive/2026-08-15-recipe-data-schema/plan.md`
  (`owner` column choice, hosted-only topology)
- Deferred gap, original recording: `context/archive/2026-08-15-recipe-data-schema/reviews/impl-review.md:39-53` (finding F2)
- How the gap was previously "resolved" (app-layer only): `context/archive/2026-08-15-photo-to-recipe-save/change.md:21-24`
- Existing mocked-Supabase convention (for contrast): `src/pages/api/recipes.test.ts`,
  `src/lib/services/recipe-query.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Integration-test harness scaffold

#### Automated

- [x] 1.1 `npm run test:integration` passes (harness smoke test) against `SnapRecipe` dev
- [x] 1.2 `npm run lint` passes on all new files

#### Manual

- [ ] 1.3 `.env.test.local` does not appear in `git status`
- [ ] 1.4 Studio (dev): smoke test's `integration-test-` user and recipe row visible

### Phase 2: Cross-user RLS integration tests (risk #4)

#### Automated

- [ ] 2.1 `npm run test:integration` passes, including every case in `cross-user-rls.test.ts`
- [ ] 2.2 `npm run lint` passes

#### Manual

- [ ] 2.3 Studio (dev) → Authentication: this phase's `integration-test-` users are present

### Phase 3: `photo_path` ownership DB fix, deployed to dev then prod (risk #6)

#### Automated

- [ ] 3.1 `supabase link --project-ref xmyeeuyeszvpvrjszohr` succeeds; `supabase db push` exits 0 (dev)
- [ ] 3.2 `npm run test:integration` passes, including both cases in `photo-path-ownership.test.ts`, against dev
- [ ] 3.3 `supabase link --project-ref gtrhakzhlammvfifvlyf` succeeds; `supabase db push` exits 0 (prod)
- [ ] 3.4 `npm run lint` passes

#### Manual

- [ ] 3.5 Trigger + function present on `recipes` in dev Studio
- [ ] 3.6 Trigger + function present on `recipes` in prod Studio
- [ ] 3.7 Spot-checked existing recipe row still readable in both projects
- [ ] 3.8 Real photo-upload flow still succeeds against dev, then against prod after the push

### Phase 4: Cookbook update

#### Manual

- [ ] 4.1 §6.3 reads accurately against what Phases 1-3 actually built
