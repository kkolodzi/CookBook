# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-24 (§3 Phase 4: complete — rollout complete, all phases done)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in area Y"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` only (excludes
vendored/build/generated), last 30 days, 37 commits.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                            | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Regressions ship undetected because the existing test suite never runs in CI                                       | High   | High       | CI workflow: lint + build only, no test-execution step, despite 7 test files existing in the repo                                                                                                                                                                       |
| 2   | AI recipe extraction returns garbage or empty data and the recipe is saved with no signal that anything went wrong | High   | Medium     | interview Q1 (top concern); PRD guardrail — "clear visible feedback on success/failure — silent status-free process is a regression"; PRD FR-005/FR-008/FR-021 define extraction as best-effort/nullable                                                                |
| 3   | A failed or degraded extraction isn't visibly surfaced in the upload flow — the UI looks like a normal success     | High   | Medium     | same PRD guardrail as #2; hot-spot dir `src/components/recipes` (24 commits/30d) — the single most actively changed area of the app                                                                                                                                     |
| 4   | A user reaches another user's recipe or photo (RLS gap)                                                            | High   | Low        | interview Q4 (top concern); archived `recipe-data-schema` plan — "RLS on `recipes` and `storage.objects` independently prevents any real cross-user leak, but nothing validates the reference at insert time"; PRD Access Control section (per-user private, RLS-based) |
| 5   | Reversible recipe removal (trash/restore) loses data or leaves it unrecoverable                                    | Medium | Medium     | PRD guardrail — "saved recipe must never disappear or be corrupted"; roadmap slice S-03 (recipe edit and remove)                                                                                                                                                        |
| 6   | A recipe's photo reference points at a storage object the owning user never actually uploaded                      | Medium | Low        | archived `recipe-data-schema` plan, same deferral note as #4 — resolved "by convention" in a later slice, not by a database constraint                                                                                                                                  |
| 7   | Unbounded or repeated AI extraction calls create uncontrolled cost exposure                                        | Low    | Low        | tech-stack.md (`has_ai: true`); abuse-lens requirement — mandatory check for products accepting user input into an AI call                                                                                                                                              |

**Abuse / security lens applied**: Risk #4 (authorization/access — RLS as
the sole cross-user isolation boundary) and Risk #7 (resource abuse via
uncontrolled AI-call volume) satisfy the mandatory abuse-scenario
requirement for a product with auth and AI input.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                        | Must challenge                                                                                                                       | Context `/10x-research` must ground                                                                                                       | Likely cheapest layer                                              | Anti-pattern to avoid                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| #1   | `npm run test` runs on every PR and blocks merge on failure                                                                                                        | Whether wiring the gate itself is in scope for this rollout, or only naming the requirement                                          | Which script `npm run test` actually is; whether the deploy job should also gate on it                                                    | gate config (no test code)                                         | Raising coverage numbers without wiring the gate — untested-but-passing tests protect nothing if CI never runs them            |
| #2   | Adversarial or malformed AI responses (empty, wrong shape, partial) produce a recipe that is flagged or degraded, never one indistinguishable from a clean success | The assumption that the AI vendor's output shape is stable and well-formed                                                           | The extraction service's contract boundary — what it returns on success vs. degraded vs. failure, and how nullable fields are represented | unit test at the extraction parsing boundary, adversarial fixtures | Testing only the happy-path AI response shape — proves nothing about garbage-in handling                                       |
| #3   | A degraded or failed extraction result visibly changes what the user sees in the upload flow, not just what gets persisted                                         | Whether "saved successfully" and "saved but nothing extracted" are currently even visually distinguishable today                     | The upload form's state machine (loading / success / error / degraded) and what test setup it needs                                       | component test (requires adding jsdom + RTL — not present today)   | A snapshot test that captures current markup without asserting the failure state actually differs from the success state       |
| #4   | Cross-user reads/writes against recipes and storage objects are denied by the database itself, verified without mocking Supabase                                   | Whether mocking the Supabase client (today's default convention) is quietly treated as sufficient coverage for this risk — it is not | RLS policy definitions on `recipes` and `storage.objects`; how to seed two distinct authenticated users in a test environment             | integration test against local Supabase (real Postgres + policies) | Over-mocking — asserting the app "calls Supabase correctly" instead of asserting the database refuses the cross-user operation |
| #5   | A full trash → restore round-trip preserves every field, including edit-then-remove-then-restore sequences                                                         | Whether restore is assumed to be the exact inverse of trash, or whether partial/concurrent states are reachable                      | The trash/restore state transitions and whether removal is soft-delete or a separate table                                                | integration test on the trash/restore flow                         | Testing trash and restore as two independent unit tests that never verify the round-trip together                              |
| #6   | A recipe's photo reference cannot be set to point at a storage object the acting user doesn't own, even when the insert path is exercised directly                 | Whether this is already fully covered by Risk #4's RLS test, or is a distinct path worth its own case                                | How `photo_path` is populated end-to-end (upload response → recipe insert), and whether any path accepts it as raw client input           | integration test, same layer as #4, narrower fixture               | Assuming "RLS covers it" without a test proving this specific insert path is actually subject to the same policy               |
| #7   | The atomic per-user-per-day extraction cap (`reserve_extraction_attempt`) correctly enforces its limit across repeated calls, verified against real Postgres, not just a mocked RPC result | Do not assume the atomic `INSERT ... ON CONFLICT` upsert is race-safe without a test proving it — its whole purpose is a prior TOCTOU-race fix | The migration and call site already grounded in `context/changes/testing-ci-gate-resource-abuse-posture/research.md` — the mechanism exists and is correctly wired before the AI call; nothing further to research | integration test directly against the RPC, real Postgres           | Asserting against the production route's hardcoded cap value instead of a test-owned `p_cap` — couples the test to an implementation detail with no PRD/roadmap authority |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                              | Goal (one line)                                                                          | Risks covered | Test types       | Status        | Change folder                                          |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------- | ------------- | ---------------- | ------------- | ------------------------------------------------------ |
| 1   | Extraction integrity & visible feedback | Catch silent-garbage extraction and make failures visible in the upload UI               | #2, #3        | unit + component | complete      | `context/changes/testing-extraction-integrity/`        |
| 2   | Cross-user access & reference integrity | Prove RLS actually isolates users and that photo references stay scoped to their owner   | #4, #6        | integration      | complete      | `context/changes/testing-cross-user-access-integrity/` |
| 3   | Reversible removal correctness          | Verify trash/restore round-trips without data loss                                       | #5            | integration      | complete      | `context/changes/testing-reversible-removal-correctness/` |
| 4   | CI gate & resource-abuse posture        | Make the test suite a required CI gate; establish whether extraction cost controls exist | #1, #7        | gates + research | complete      | `context/changes/testing-ci-gate-resource-abuse-posture/` |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section are grounded in local manifests/configs
plus the MCP/tools actually exposed in the current session.

| Layer                        | Tool                                                                      | Version | Notes                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration           | Vitest                                                                    | ^4.1.10 | `environment: "node"` only today — no jsdom; Phase 1 must add jsdom + a component-testing library for `PhotoUploadForm`-style tests                                                                                       |
| API mocking                  | Vitest `vi.mock`                                                          | n/a     | current convention mocks the Supabase client entirely — sufficient for API-contract tests, structurally blind to RLS (see Risk #4); Phase 2 must introduce a real-Postgres integration layer alongside it, not replace it |
| RLS / cross-user integration | none yet — see Phase 2                                                    | n/a     | needs a local Supabase stack (`npx supabase start`) as the real-Postgres test target; two hosted projects exist (`SnapRecipe` dev, `SnapRecipe_live` prod) but tests must not run against either                          |
| e2e                          | none yet — see Phase 4 (gate only; no e2e test authoring in this rollout) | n/a     | no Playwright/Cypress configured; not scoped into any phase's test-writing, only named as a gate placeholder                                                                                                              |
| accessibility                | none proposed                                                             | n/a     | not raised as a risk in interview or PRD; out of scope for this rollout                                                                                                                                                   |
| (optional) AI-native         | none proposed                                                             | n/a     | interview Q5 explicitly excluded UI snapshot/pixel-diff testing and vendored shadcn/ui components from test budget; no AI-native layer justified under cost × signal for the risks in this map                            |

**Stack grounding tools (current session):**

- Docs: Context7 MCP available — not queried this session; Vitest version taken directly from `package.json`. checked: 2026-08-18
- Search: no dedicated search MCP (Exa or similar) available, only generic web search; not used — all sourcing came from local docs and git history. checked: 2026-08-18
- Runtime/browser: no Playwright/browser MCP available in this session; not used. checked: 2026-08-18
- Provider/platform: Supabase MCP and Cloudflare MCP available; not queried this session — relevant for Phase 2 (RLS policy verification) and Phase 4 (deploy-gate wiring) respectively. checked: 2026-08-18

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                         | Where                | Required?                                    | Catches                                                                                  |
| ---------------------------- | -------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| lint + typecheck             | local + CI           | required (already wired)                     | syntactic / type drift                                                                   |
| unit + integration           | local + CI           | required after §3 Phase 4                    | logic regressions                                                                        |
| RLS / cross-user integration | CI on PR             | required after §3 Phase 4                    | cross-user data leaks                                                                    |
| e2e on critical flows        | —                    | not planned this rollout                     | broken critical user paths (out of scope — no e2e layer justified, see §4)               |
| post-edit hook               | local (agent loop)   | not configured (Module 3 Lesson 3 territory) | regressions at edit time                                                                 |
| multimodal visual review     | —                    | not planned this rollout                     | interview Q5 excluded static/low-risk screens from test budget                           |
| pre-prod smoke               | between merge + prod | optional                                     | environment-specific failures (relevant given the prior prod-migration-backlog incident) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Test type**: unit, Vitest, `vi.mock`/`vi.stubGlobal` to isolate external
  boundaries (e.g. `fetch`, `astro:env/server`) rather than the module under
  test.
- **Location convention**: colocated `*.test.ts` next to the module it
  covers (e.g. `src/lib/services/recipe-extraction.test.ts` next to
  `recipe-extraction.ts`).
- **Reference test**: `src/lib/services/recipe-extraction.test.ts`.
- **Run locally**: `npm run test`.

### 6.2 Adding a component test

- **Test type**: component, Vitest + `@testing-library/react` + jsdom.
  Render the real component and assert on rendered output (`getByText`,
  `queryByText`, `findByText`); mock `global.fetch` per test via
  `vi.stubGlobal`, matching the unit-test convention in §6.1.
- **Location convention**: colocated `*.test.tsx` next to the component it
  covers (e.g. `src/components/recipes/PhotoUploadForm.test.tsx` next to
  `PhotoUploadForm.tsx`).
- **jsdom is opt-in per file**: the project-wide Vitest `environment` stays
  `"node"` (`vitest.config.ts`) — every component test file must start with
  `// @vitest-environment jsdom` as its first line to get a DOM. Omitting
  the pragma runs the file under Node and RTL's `render` will fail.
- **Reference test**: `src/components/recipes/PhotoUploadForm.test.tsx`.
- **Run locally**: `npm run test`.

### 6.3 Adding an RLS / cross-user integration test

- **Test type**: integration, Vitest, real Postgres via the hosted `SnapRecipe` (dev) project — no
  mocking. **Deviates from this table's original "needs a local Supabase stack" line**: Phase 2
  hit two consecutive Windows/Docker blockers (daemon not running, then a system-wide port
  exclusion needing elevated privileges to fix) and pivoted to targeting dev directly instead.
  Never run these tests against `SnapRecipe_live` (prod).
- **Location convention**: `tests/integration/*.test.ts` — **not** colocated next to a route or
  component, unlike §6.1/§6.2. These tests exercise table/RLS/trigger behavior shared across
  routes, not one file's logic.
- **Two-user helper**: `tests/integration/helpers/test-client.ts` — `createTestUser()` creates a
  fresh, uniquely-named user via plain `signUp()` (no service-role key; dev's auth config allows
  sign-up without email confirmation). Emails are prefixed `integration-test-` so they're
  identifiable in the dev project. Users are **never cleaned up** — accepted, tagged clutter in a
  real project, not accidental. `createAnonClient()` returns an unauthenticated client, useful as a
  non-invasive regression sanity check (an `anon`-role client is denied the same way a broken
  policy would be, without ever mutating a live policy to prove it).
- **Prerequisites**: `.env.test.local` (git-ignored; copy from `.env.test.local.example`) populated
  with `SnapRecipe` dev's URL and anon key from the Supabase dashboard.
- **Reference test**: `tests/integration/cross-user-rls.test.ts`.
- **Run locally**: `npm run test:integration` (separate from `npm run test` — its own
  `vitest.integration.config.ts`, no jsdom, longer timeout for real network calls).
- **When NOT to use**: for anything the existing mocked-Supabase convention (§6.4) already covers —
  this layer exists specifically for claims a mock can't verify (RLS enforcement, trigger behavior,
  real cross-user identity checks), not as a general replacement for API-contract tests.

**Variant: soft-delete / app-level visibility filters.** Same harness, same location convention,
same run command — but the invariant under test is an application-level query filter
(`.is("deleted_at", null)` / `.not("deleted_at", "is", null)`), not an RLS policy. Some tables in
this project (e.g. `recipes`) use RLS strictly for ownership and leave "active vs. trashed"
visibility entirely to the app layer with no database-level backstop, so a forgotten filter on a
new read path is a real, previously-hit failure mode — this variant proves each read surface
still applies it. Call the real production function where one is extractable (e.g. `listRecipes`,
`getRecipeDetail` from `@/lib/services/recipe-query`) rather than re-implementing the filter
inline; for surfaces with no extractable function (an Astro page/route), mirror the exact
production query instead of driving it through HTTP. Reference tests:
`tests/integration/trash-restore-roundtrip.test.ts`,
`tests/integration/trashed-recipe-visibility.test.ts`.

### 6.4 Adding a test for a new API endpoint

- **Test type**: integration, mocking the Supabase client at the boundary (existing convention).
- **Reference test**: `src/pages/api/recipes.test.ts`.
- **Run locally**: `npm run test`.
- **When to add the RLS layer instead**: when the endpoint touches cross-user data access — see §6.3.

### 6.5 Wiring a gate into CI

- TBD — see §3 Phase 4.

### 6.6 Per-rollout-phase notes

(Appended by `/10x-implement` after each phase lands.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Vendored shadcn/ui components** — third-party, not our logic; a break
  would surface as a visible rendering failure elsewhere first. Re-evaluate
  if we start patching vendored component internals. (Source: interview Q5.)
- **UI snapshot / pixel-diff tests** — high maintenance cost, low signal
  for this project's actual risks (data integrity, access control), which
  are not visual in nature. Re-evaluate if a visual-regression incident
  actually occurs. (Source: interview Q5.)
- **Static / low-risk screens (dashboard, Topbar)** — no dynamic data, low
  churn, cosmetic-only failure mode. Re-evaluate if these screens start
  carrying real logic or user data. (Source: interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-18
- Stack versions last verified: 2026-08-18
- AI-native tool references last verified: 2026-08-18

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
