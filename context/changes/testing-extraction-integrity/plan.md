# Extraction Integrity & Visible Feedback Implementation Plan

## Overview

Close two related gaps identified in `research.md` against `test-plan.md`
§3 Phase 1: Risk #2 (an adversarial/garbage AI extraction — e.g. blank
ingredient strings — clears the app's only content gate and is persisted as
an unqualified success) and Risk #3 (a degraded-but-saved extraction is
visually indistinguishable from a clean one in the upload UI). Both are
closed with one mechanism: a `contentDegraded` boolean flag that follows
the existing `typeUnconfirmed` precedent (`recipes.ts:186`) end-to-end —
computed at persistence time, returned in the API response, and surfaced
with distinct copy in `PhotoUploadForm.tsx`. Component-test tooling
(jsdom + Testing Library), entirely absent today, is added as its own
phase so the UI fix can be verified by an actual rendered assertion instead
of trusted by inspection.

## Current State Analysis

- `meetsFloor()` (`recipe-extraction.ts:84-86`) only checks
  `ingredients.length >= 1` on the raw array — `["", "x"]` clears it. No
  per-string blankness check exists anywhere in the extraction pipeline.
- `recipes.ts` trusts the extraction result completely: `result.ingredients`
  is inserted verbatim (`recipes.ts:142-148`), no filtering, no
  content-quality re-validation.
- The only degraded-state signal that exists end-to-end is
  `typeUnconfirmed: result.type === null` (`recipes.ts:186`), consumed by
  `PhotoUploadForm.tsx:166-174` via `TypeConfirmationNudge`. Missing
  `instructions` and empty/blank `ingredients` are silently omitted from
  the success card with no distinct copy (`PhotoUploadForm.tsx:154-164`).
- Vitest runs `environment: "node"` project-wide
  (`vitest.config.ts:14`); `@testing-library/react` and jsdom are absent
  from `package.json`. No component has ever been rendered in a test.

## Desired End State

- An extraction where at least one ingredient string is non-blank, but not
  all of them are (or `instructions` is `null`), still saves — but the API
  response carries `contentDegraded: true`, and the saved ingredients list
  has blank entries stripped.
- An extraction where every ingredient string is blank after trimming is
  reclassified as `incomplete_extraction` (a full failure) rather than a
  degraded success — a recipe with zero real ingredients is "no content,"
  not "best-effort content."
- `PhotoUploadForm.tsx`'s success view renders a distinct, visible notice
  whenever `contentDegraded` is true; a clean success renders no such
  notice.
- `npm run test` covers both with unit tests (extraction-floor behavior,
  persistence-layer filtering) and component tests (degraded notice
  present/absent, classified-failure baseline) — the first component tests
  in this repository.
- `test-plan.md` §6.1 and a new §6.2 document how to add each kind of test
  going forward.

**Verification**: `npm run test` and `npm run lint` both pass; manually
uploading a photo whose extraction yields a blank ingredient (or no
instructions) shows the new notice in the browser, and a clean upload does
not.

### Key Discoveries:

- `meetsFloor(name, ingredients)` (`recipe-extraction.ts:84-86`) is a type
  predicate (`name is string`) — its signature doesn't need to change, only
  its internal check.
- `recipes.ts`'s response object is built by hand (`recipes.ts:175-189`),
  not derived from the DB row — `recipe.ingredients` in the response comes
  straight from `result.ingredients`/a locally computed array, not a
  `select()`. Filtering can happen entirely in application code before both
  the insert and the response are built, in one place.
- Vitest supports a per-file `// @vitest-environment jsdom` pragma
  (confirmed via Context7 against Vitest v4.1.6 docs) that overrides the
  global environment for exactly one test file, leaving
  `vitest.config.ts`'s project-wide `environment: "node"` — and therefore
  the two existing test files — untouched.
- Context7 confirms `@testing-library/react` v16.3.2 officially pairs with
  React 19 (an official Vitest example pins `react ^19.2.4` alongside
  `@testing-library/react ^16.3.2`), resolving `research.md`'s open
  question about React 19 peer compatibility.
- `tsconfig.json`'s `include: ["**/*"]` and `eslint.config.js`'s
  `reactConfig` (`files: ["**/*.{js,jsx,ts,tsx}"]`) both already cover a
  new root-level `vitest.setup.ts` — no new TS/ESLint scoping is needed.

## What We're NOT Doing

- Not adding a DB-level `CHECK` constraint for ingredient/name blankness —
  `research.md`'s Architecture Insights and the archived
  `recipe-data-schema` decision establish content-quality gating as
  application-level by design in this project.
- Not adding `.min(1)` or a non-empty refinement to the Zod
  `modelResponseSchema` — Zod stays shape-only validation; the floor check
  stays the sole content gate, per existing architecture.
- Not touching `instructions`' nullability contract (FR-021's best-effort
  design) — a missing `instructions` value continues to save; it now also
  sets `contentDegraded`, but is never itself a failure reason.
- Not adding `@testing-library/user-event` — the two `fireEvent` calls
  this phase's component tests need (file-input change, submit click) are
  covered by `@testing-library/react`'s built-in `fireEvent`, keeping the
  new dependency footprint to exactly the three RTL/jsdom packages
  confirmed in questioning.
- Not extracting the new degraded-content notice into its own component
  file — unlike `TypeConfirmationNudge`, it has no interactive state or API
  call, so it's a plain conditional JSX block inline in
  `PhotoUploadForm.tsx`.
- Not wiring `npm run test` into CI — that's rollout Phase 4 (Risk #1),
  out of scope here.
- Not touching Risks #4-#7 — separate rollout phases per `test-plan.md`
  §3.

## Implementation Approach

Five phases, ordered cheapest-and-highest-signal first:

1. Fix the extraction-service floor check and prove it with adversarial
   unit tests (no new tooling — the cheapest layer for Risk #2's core
   gap).
2. Extend the fix into the persistence layer (filtering + the
   `contentDegraded` computation) with unit tests on the existing
   `recipes.test.ts` convention — still no new tooling.
3. Add the component-test tooling as its own phase, verified by proving
   the *existing* suite still passes unchanged — isolates tooling risk
   from feature risk.
4. Wire `contentDegraded` into the upload UI and prove the visual
   difference with component tests — the most expensive layer, done last,
   now that tooling exists.
5. Update the cookbook (`test-plan.md` §6.1/§6.2) so future contributors
   have a reference test and run command for both new test kinds.

## Critical Implementation Details

**Floor-check invariant downstream.** Phase 1's updated `meetsFloor` only
returns `success: true` when at least one ingredient string is non-blank
after trimming. This means Phase 2's `filteredIngredients` array (blank
strings stripped) can **never** end up empty when `result.success` is
true — `recipes.ts` does not need its own empty-array guard after
filtering.

**jsdom is opt-in per file, not global.** `vitest.config.ts`'s
`test.environment` stays `"node"`. Only the new
`PhotoUploadForm.test.tsx` (Phase 4) carries the
`// @vitest-environment jsdom` pragma at the top of the file. Do not add
`environment: "jsdom"` to the shared config — the two existing test files
rely on Node's native `fetch`/`Response`/`File`/`FormData`, and switching
the global environment risks changing their behavior.

**`contentDegraded` is computed, not persisted.** Like `typeUnconfirmed`,
there is no database column for it — it's derived in `recipes.ts` at
response-build time from the filtering outcome and `instructions === null`,
returned once in the JSON body. Do not add a migration for this phase.

## Phase 1: Extraction-floor fix + adversarial unit tests

### Overview

Tighten `meetsFloor` so an all-blank ingredients array is reclassified as
`incomplete_extraction` instead of a false success, and add the adversarial
unit-test coverage `research.md` identified as missing (all-blank,
partial-blank, wrong-shape).

### Changes Required:

#### 1. Trim-aware floor check

**File**: `src/lib/services/recipe-extraction.ts`

**Intent**: `meetsFloor` currently counts raw array length, so an array of
only blank strings clears it. Change the ingredient check to count
non-blank (trimmed) entries instead, so an all-blank array now fails the
floor and the extraction is reclassified as `incomplete_extraction` via the
existing `!meetsFloor(...)` branch at `recipe-extraction.ts:156-158`. A
partial-blank array (e.g. `["", "mąka"]`) still passes — at least one
non-blank entry remains — and is returned **unfiltered**; filtering is
Phase 2's responsibility in `recipes.ts`, not this service's.

**Contract**: `meetsFloor(name, ingredients)` keeps its `name is string`
predicate signature. Its ingredient check changes from
`ingredients.length >= 1` to `ingredients.some((i) => i.trim().length > 0)`.
No other line in `extractRecipeFromPhoto` changes — the existing
`!meetsFloor(name, ingredients)` branch and its `incomplete_extraction`
reason are reused as-is.

#### 2. Adversarial unit tests

**File**: `src/lib/services/recipe-extraction.test.ts`

**Intent**: Cover the three adversarial shapes `research.md` flagged as
untested: an ingredients array that's blank-only (new failure behavior), an
ingredients array that's partial-blank (proves the extraction layer still
succeeds and does *not* filter), and a structurally-wrong-shape response
(proves the Zod boundary rejects garbage typed correctly, not just
malformed JSON).

**Contract**: Add three `it(...)` cases to the existing
`describe("extractRecipeFromPhoto", ...)` block, following the file's
existing `mockFetchResponse`/`chatCompletion` fixture helpers:
- All-blank ingredients (`ingredients: ["", "   "]`, valid `name`) →
  `expect(result).toEqual({ success: false, reason: "incomplete_extraction", raw: modelPayload })`.
- Partial-blank ingredients (`ingredients: ["", "mąka"]`, valid `name`) →
  `expect(result).toEqual({ success: true, ..., ingredients: ["", "mąka"], ... })`
  — asserts the raw array passes through unfiltered.
- Wrong-shape adversarial payload (`ingredients: "not-an-array"` in an
  otherwise well-formed `chatCompletion` body) →
  `expect(result).toEqual({ success: false, reason: "technical_error", raw: parsedContent })`,
  matching the existing malformed-JSON test's assertion shape
  (`recipe-extraction.test.ts:91-100`) since both go through the same
  `safeParse`-failure branch.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Lint (type-checked) passes: `npm run lint`

---

## Phase 2: Persistence-layer filtering + `contentDegraded`

### Overview

`recipes.ts` filters blank ingredient strings out of what gets persisted
and returned, and computes `contentDegraded` — the API-level signal Phase
4's UI will consume — following the exact pattern `typeUnconfirmed`
already establishes one line below it.

### Changes Required:

#### 1. Filter + flag computation

**File**: `src/pages/api/recipes.ts`

**Intent**: Strip blank/whitespace-only ingredient strings before they're
inserted or echoed back to the client, and compute whether this save is
content-degraded (either the filtering actually dropped something, or
`instructions` is `null`) so the client can distinguish it from a clean
save.

**Contract**: Between the existing success branch's `result` destructure
and the `ingredientRows` map (`recipes.ts:142`), introduce:

```ts
const filteredIngredients = result.ingredients.map((i) => i.trim()).filter((i) => i.length > 0);
const contentDegraded = filteredIngredients.length < result.ingredients.length || result.instructions === null;
```

`ingredientRows` (`recipes.ts:142-146`) maps over `filteredIngredients`
instead of `result.ingredients`. The response's `recipe.ingredients`
(`recipes.ts:182`) uses `filteredIngredients` instead of
`result.ingredients`. The response body gains a sibling field to
`typeUnconfirmed`: `contentDegraded` (`recipes.ts:186`).

#### 2. Unit tests

**File**: `src/pages/api/recipes.test.ts`

**Intent**: Prove the filtering and flag land correctly for the three
cases that matter: ingredients need filtering, instructions are missing
with otherwise-clean ingredients, and a fully clean save is *not* flagged
— the negative case that proves the flag actually discriminates instead of
always firing.

**Contract**: Add `it(...)` cases to the existing
`describe("POST /api/recipes", ...)` block, using the file's existing
`mockSupabaseClient`/`makeContext`/`photoFormData` helpers:
- `extractRecipeFromPhoto` mocked to resolve
  `ingredients: ["", "mąka", " "]` → assert
  `client.ingredientsChain.insert` was called with only the filtered,
  trimmed entries (positions re-indexed from 0), assert
  `body.recipe.ingredients` in the response equals the filtered array, and
  assert `body.contentDegraded === true`.
- `extractRecipeFromPhoto` mocked to resolve clean ingredients but
  `instructions: null` → assert `body.contentDegraded === true` even
  though no ingredient was filtered.
- Extend the existing full-fidelity happy-path test
  (`recipes.test.ts:163-204`) with an added assertion:
  `expect(body.contentDegraded).toBe(false)`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Lint (type-checked) passes: `npm run lint`

---

## Phase 3: Component-test tooling foundation

### Overview

Add the jsdom + Testing Library stack this project has never had, scoped
so it cannot regress the two existing test files.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add exactly the packages needed to render and query a React
component under Vitest, matching the versions Context7 confirmed against
this project's Vitest v4.1.10 / React 19.2.6.

**Contract**: Add to `devDependencies`: `jsdom` (`^29.1.1`),
`@testing-library/react` (`^16.3.2`),
`@testing-library/jest-dom` (`^6.9.1`), `@vitejs/plugin-react` (`^5.1.4`).

#### 2. Vitest config

**File**: `vitest.config.ts`

**Intent**: Register the React plugin (required for JSX transform inside
Vitest, per Context7's official Vitest+React example) and a setup file for
jest-dom matchers and RTL cleanup — without changing the project-wide
`environment`.

**Contract**:

```ts
import react from "@vitejs/plugin-react";
// ...
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(dirname, "./src") } },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

#### 3. Setup file

**File**: `vitest.setup.ts` (new, project root)

**Intent**: Register jest-dom matchers globally and clean up rendered
components after each test — the standard RTL/Vitest pairing.

**Contract**:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

This file runs for every test file, including the two existing
node-environment ones — `cleanup()` is a no-op when nothing was rendered,
so this is safe by construction, not by exemption. Phase 3's automated
verification (below) exists specifically to confirm this.

### Success Criteria:

#### Automated Verification:

- Full suite passes with zero regressions in the two pre-existing test
  files: `npm run test`
- Lint passes: `npm run lint`

---

## Phase 4: Upload UI degraded-content notice + component tests

### Overview

Surface `contentDegraded` in `PhotoUploadForm.tsx`'s success view with a
distinct notice, and prove — via the first real component tests in this
repository — that it's visually present when degraded and visually absent
when clean.

### Changes Required:

#### 1. Thread `contentDegraded` through component state

**File**: `src/components/recipes/PhotoUploadForm.tsx`

**Intent**: The component currently only tracks `typeUnconfirmed` from the
API response; it needs to also track and render on `contentDegraded`.

**Contract**: `SuccessData` (`PhotoUploadForm.tsx:32-35`) gains
`contentDegraded: boolean`. `ApiResponseBody`'s success variant
(`PhotoUploadForm.tsx:40`) gains `contentDegraded: boolean`. The
`setSuccessData(...)` call in `handleSubmit` (`PhotoUploadForm.tsx:105`)
passes `contentDegraded: body.contentDegraded` alongside the existing
fields.

#### 2. Render the notice

**File**: `src/components/recipes/PhotoUploadForm.tsx`

**Intent**: A visible, distinct banner in the success card whenever the
save is content-degraded — styled consistently with the existing
`typeUnconfirmed` nudge (yellow, informational) but with no interactive
controls, since there's no action for the user to take beyond awareness.

**Contract**: Inside the `status === "success"` render branch, add a
conditional block immediately after the ingredients/instructions display
(`PhotoUploadForm.tsx:154-164`) and before the existing
`{successData.typeUnconfirmed && <TypeConfirmationNudge .../>}` block
(`PhotoUploadForm.tsx:166-174`):

```tsx
{successData.contentDegraded && (
  <div className="rounded-lg border border-yellow-400/30 bg-yellow-900/20 p-3 text-sm text-yellow-200">
    Nie wszystkie elementy przepisu udało się rozpoznać — sprawdź listę
    składników i instrukcje, mogą być niepełne.
  </div>
)}
```

Both banners can render simultaneously (a save can be both type-unconfirmed
and content-degraded); the content-degraded notice comes first since it
concerns the recipe's actual content, ahead of the meal-type metadata
nudge.

#### 3. Component tests

**File**: `src/components/recipes/PhotoUploadForm.test.tsx` (new)

**Intent**: Prove the degraded state is visually distinguishable from a
clean success — the exact anti-pattern `research.md` and the risk-response
guidance both call out avoiding (a test that doesn't assert the states
actually differ).

**Contract**: File opens with `// @vitest-environment jsdom` as its first
line (per Phase 3's per-file scoping). Mock `global.fetch` per test via
`vi.stubGlobal("fetch", ...)`, matching the existing service-test
convention. For each case: render `<PhotoUploadForm />`, simulate a file
selection via `fireEvent.change` on the file input (`getByLabelText` or the
input's `id="photo"`), then `fireEvent.click` the submit button, then
`await` the response resolution before asserting (`findByText` or
`waitFor`).

Three cases:
- `contentDegraded: true` in the mocked response → the notice's exact text
  is present (`getByText(...)` on the copy string above).
- `contentDegraded: false`, full-fidelity response (clean-success
  baseline) → `queryByText(...)` for the same copy string returns `null`
  — the explicit negative assertion that makes this a real
  regression-detecting test, not a snapshot.
- A classified failure (e.g. `{ success: false, reason: "not_a_recipe" }`)
  (error-state baseline) → the corresponding `EXTRACTION_FAILURE_COPY`
  title renders, proving the 4-state machine's error branch has at least
  one anchor test.

### Success Criteria:

#### Automated Verification:

- Component tests pass: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Upload a photo that yields a garbage/partial extraction (or temporarily
  stub the API response) via `npm run dev` and confirm the yellow notice
  renders in the browser exactly as in the component test.
- Upload a clean photo and confirm no notice appears.

---

## Phase 5: Cookbook update

### Overview

Fill in `test-plan.md` §6.1 (unit) and add §6.2 (component) so future
contributors have a concrete reference.

### Changes Required:

#### 1. Cookbook entries

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD` placeholders this phase is responsible for,
per the lesson's cookbook contract.

**Contract**: §6.1 gets: test type (unit, Vitest, `vi.mock`/`vi.stubGlobal`
for external boundaries), location convention (colocated `*.test.ts` next
to the module), reference test (`src/lib/services/recipe-extraction.test.ts`),
run command (`npm run test`). §6.2 gets: test type (component, Vitest +
`@testing-library/react` + jsdom), location convention (colocated
`*.test.tsx` next to the component), the per-file
`// @vitest-environment jsdom` pragma requirement (global environment stays
`"node"`), reference test
(`src/components/recipes/PhotoUploadForm.test.tsx`), run command
(`npm run test`).

### Success Criteria:

#### Automated Verification:

- `context/foundation/test-plan.md` §6.1 and §6.2 no longer contain `TBD`
  placeholders for this phase: manual grep confirms absence (no automated
  gate beyond file review)

#### Manual Verification:

- §6.1 and §6.2 read as accurate, actionable instructions for the tests
  this phase actually added.

---

## Testing Strategy

### Unit Tests:

- Extraction-floor behavior: all-blank, partial-blank, wrong-shape
  (Phase 1).
- Persistence filtering and `contentDegraded` computation: filtered case,
  instructions-only case, clean-negative case (Phase 2).

### Component Tests:

- Degraded notice present/absent (the core Risk #3 assertion), plus a
  classified-failure baseline (Phase 4).

### Manual Testing Steps:

1. Run `npm run dev`, upload a photo, confirm existing flows (clean
   success, `typeUnconfirmed` nudge, classified failure) still render
   exactly as before.
2. Force or stub a degraded response and confirm the new notice renders
   and reads clearly.
3. Confirm a clean success shows no notice.

## Performance Considerations

None — all changes are synchronous array operations on already-small
arrays (ingredient counts are low single digits) and a client-side
conditional render.

## Migration Notes

None — `contentDegraded` is computed at response time, not persisted; no
schema change.

## References

- Related research: `context/changes/testing-extraction-integrity/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risk #2/#3, §3 Phase 1)
- Existing degraded-signal precedent: `src/pages/api/recipes.ts:186`,
  `src/components/recipes/PhotoUploadForm.tsx:166-174`,
  `src/components/recipes/TypeConfirmationNudge.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extraction-floor fix + adversarial unit tests

#### Automated

- [x] 1.1 Unit tests pass: `npm run test` — 908e1bb
- [x] 1.2 Lint (type-checked) passes: `npm run lint` — 908e1bb

### Phase 2: Persistence-layer filtering + contentDegraded

#### Automated

- [x] 2.1 Unit tests pass: `npm run test` — 427ef03
- [x] 2.2 Lint (type-checked) passes: `npm run lint` — 427ef03

### Phase 3: Component-test tooling foundation

#### Automated

- [x] 3.1 Full suite passes with zero regressions in the two pre-existing test files: `npm run test`
- [x] 3.2 Lint passes: `npm run lint`

### Phase 4: Upload UI degraded-content notice + component tests

#### Automated

- [ ] 4.1 Component tests pass: `npm run test`
- [ ] 4.2 Lint passes: `npm run lint`

#### Manual

- [ ] 4.3 Degraded extraction shows the yellow notice in the browser via `npm run dev`
- [ ] 4.4 Clean extraction shows no notice in the browser

### Phase 5: Cookbook update

#### Automated

- [ ] 5.1 test-plan.md §6.1 and §6.2 no longer contain TBD placeholders for this phase

#### Manual

- [ ] 5.2 §6.1 and §6.2 read as accurate, actionable instructions for the tests this phase added
