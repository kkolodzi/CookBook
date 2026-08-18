# Extraction Integrity & Visible Feedback — Plan Brief

> Full plan: `context/changes/testing-extraction-integrity/plan.md`
> Research: `context/changes/testing-extraction-integrity/research.md`

## What & Why

Close Risk #2 (an AI extraction with garbage/blank content clears the app's
only quality gate and saves as an unqualified success) and Risk #3 (that
degraded save looks identical to a clean one in the upload UI) — the two
risks assigned to rollout Phase 1 of `test-plan.md`. Both are closed with
one mechanism: a `contentDegraded` flag that follows the existing
`typeUnconfirmed` precedent end-to-end.

## Starting Point

`meetsFloor()` (`recipe-extraction.ts:84-86`) only checks raw ingredient
array length — `["", "x"]` clears it today. `recipes.ts` persists
`result.ingredients` verbatim, no filtering. `PhotoUploadForm.tsx` has
exactly one wired degraded-state signal (`typeUnconfirmed`); missing
instructions and blank ingredients are silently omitted with no distinct
copy. Component-test tooling (jsdom, Testing Library) is entirely absent —
no component has ever been rendered in a test in this repo.

## Desired End State

A garbage-but-not-fully-empty extraction still saves, but the API response
and the upload UI both visibly flag it as degraded, and blank ingredient
entries are stripped before persistence. A fully-empty extraction (all
ingredients blank) is reclassified as a failure instead of a hollow
success. `npm run test` gains unit coverage for both layers and the first
component tests in the project.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Fix mechanism | New `contentDegraded` flag (not a tightened all-or-nothing `meetsFloor`) | Reuses the exact `typeUnconfirmed` pattern already proven in this codebase and produces both a unit and component test surface, matching Phase 1's fixed test types | Plan |
| Degraded scope | Both blank ingredients AND missing instructions | Matches Risk #3's evidence directly — research cited both as silently-omitted UI gaps in the same finding | Plan |
| All-blank ingredients edge case | Escalate to `incomplete_extraction` failure, not degraded-success | A recipe with zero real ingredients is "no content," not "best-effort content" | Plan |
| Blank-ingredient persistence | Filter/trim before insert; flag reflects the filtering | Closes Risk #2 at the data layer, not just the UI signal layer | Plan |
| RTL/jsdom footprint | jsdom + `@testing-library/react` + `@testing-library/jest-dom` | Standard, near-universal RTL pairing; avoids future ad-hoc re-adding | Plan |
| jsdom scoping | Per-file `// @vitest-environment jsdom` pragma, global config stays `"node"` | Zero blast radius on the two existing test files, which rely on Node's native fetch/Response | Research (Context7-verified) |
| Component test depth | New degraded notice + a success/error baseline | Gives the state machine a regression net beyond just the new code, cheap once tooling exists | Plan |

## Scope

**In scope:** `meetsFloor` floor-check fix, `recipes.ts` filtering +
`contentDegraded` computation, jsdom/RTL tooling addition, upload UI
notice, unit + component tests, `test-plan.md` §6.1/§6.2 cookbook entries.

**Out of scope:** DB-level CHECK constraints, Zod schema tightening,
`instructions` nullability contract changes, `@testing-library/user-event`,
extracting the notice into its own component file, CI wiring (rollout
Phase 4), Risks #4-#7.

## Architecture / Approach

`contentDegraded` is computed once in `recipes.ts` at response-build time
(no DB column, mirrors `typeUnconfirmed`) and threaded through
`PhotoUploadForm.tsx`'s existing `SuccessData`/`ApiResponseBody` types into
a new conditional banner. Test tooling is added as an isolated phase
(Phase 3) so its own regression risk (does adding jsdom break the existing
two test files?) is verified independently before it's relied on by the UI
tests in Phase 4.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Extraction-floor fix + unit tests | `meetsFloor` rejects all-blank ingredients; adversarial fixtures (blank, partial-blank, wrong-shape) | Floor-check regression on legitimate partial extractions |
| 2. Persistence filtering + `contentDegraded` | `recipes.ts` filters blanks, computes and returns the flag | Off-by-one in filtered-array indexing/positions |
| 3. Component-test tooling foundation | jsdom + RTL + jest-dom + `@vitejs/plugin-react` added, scoped per-file | Global setupFiles regressing the two existing node-environment tests |
| 4. Upload UI notice + component tests | Visible degraded-state banner; first component tests in the repo | Notice not actually visually distinct from clean success (the core anti-pattern to avoid) |
| 5. Cookbook update | `test-plan.md` §6.1/§6.2 filled in | — |

**Prerequisites:** None beyond what's already in the repo — no external
service or account setup needed.
**Estimated effort:** ~2 sessions across 5 phases (Phases 1-2 and 3 are
each small/mechanical; Phase 4 is the most involved).

## Open Risks & Assumptions

- Assumes `@testing-library/react` v16.3.2 / `@testing-library/jest-dom`
  v6.9.1 / `jsdom` v29.1.1 install cleanly against this project's pinned
  `vite ^7.3.2` override — versions were confirmed compatible with Vitest
  4.1.x + React 19 via Context7, not by an actual `npm install` in this
  session.
- Assumes no other code path constructs an `ExtractionResult` with
  `success: true` outside `extractRecipeFromPhoto` — Phase 1's floor-check
  fix is the only enforcement point.

## Success Criteria (Summary)

- A recipe extraction with any blank ingredient strings or missing
  instructions is saved but visibly flagged as degraded, in both the API
  response and the browser.
- A recipe extraction with all-blank ingredients never saves at all — it's
  a classified failure.
- `npm run test` and `npm run lint` pass, including new unit and component
  test coverage; a clean extraction shows no degraded notice.
