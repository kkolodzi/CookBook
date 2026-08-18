---
date: 2026-08-18T09:40:30+02:00
researcher: Konrad Kolodziejski
git_commit: ea6d3f38096f9ff76aa13dd4b0bf4f6c3ec18473
branch: main
repository: CookBook
topic: "Extraction integrity & visible feedback (test-plan Phase 1: Risks #2, #3)"
tags: [research, codebase, recipe-extraction, photo-upload-form, testing-gaps]
status: complete
last_updated: 2026-08-18
last_updated_by: Konrad Kolodziejski
---

# Research: Extraction integrity & visible feedback

**Date**: 2026-08-18T09:40:30+02:00
**Researcher**: Konrad Kolodziejski
**Git Commit**: ea6d3f38096f9ff76aa13dd4b0bf4f6c3ec18473
**Branch**: main
**Repository**: CookBook

## Research Question

Ground `context/foundation/test-plan.md` §3 Phase 1 ("Extraction integrity &
visible feedback") before planning tests for Risk #2 (AI extraction returns
garbage/empty data and the recipe is saved with no signal anything went
wrong) and Risk #3 (a failed/degraded extraction isn't visibly surfaced in
the upload UI). Specifically: what is the extraction service's actual
success/degraded/failure contract, how are nullable fields represented, what
does the upload form's state machine actually do today, and what test
tooling gap exists.

## Summary

The extraction service (`recipe-extraction.ts`) already returns a clean
discriminated union (`success: true | false`) and the API route
(`recipes.ts`) does branch on it — a classified failure never persists a
recipe. **But the "success" gate is presence-only, not content-quality.**
`meetsFloor()` only checks that `name` is non-blank and
`ingredients.length >= 1` — it never checks that ingredient strings are
non-blank, never validates `instructions`, and has no DB-level backstop
(only `NOT NULL`, no `CHECK` for emptiness). Concretely: an ingredients
array like `["", "x"]` passes both the Zod schema and `meetsFloor`, so a
recipe with a blank ingredient can be persisted as a plain, unqualified
success.

On the UI side, `PhotoUploadForm.tsx` has exactly one degraded-state signal
wired end-to-end today — `typeUnconfirmed` (shown as a yellow nudge banner
when the model couldn't confidently assign a `type`). Missing
`instructions` or an empty `ingredients` list are rendered by silently
omitting that section of the success card — no warning, no distinct copy.
A fully degraded save (no instructions, thin ingredients) looks visually
identical to a full-fidelity one except for the unrelated type nudge. This
is a direct violation of the PRD guardrail requiring "clear, visible
feedback on both success and failure... a silent, status-free process is a
regression" (`prd.md:45`), for the specific case of a save that technically
succeeds but is content-degraded.

Test tooling is a hard blocker for half this phase: `vitest.config.ts` uses
`environment: "node"` with no jsdom/happy-dom, and `@testing-library/react`
is entirely absent from `package.json` and `node_modules`. No test in the
repo has ever rendered a React component. This must be added before any
`PhotoUploadForm` test can run.

## Detailed Findings

### Extraction service contract (`src/lib/services/recipe-extraction.ts`)

- `extractRecipeFromPhoto(imageBytes, mimeType): Promise<ExtractionResult>` (recipe-extraction.ts:88).
- `ExtractionResult` discriminated union (recipe-extraction.ts:8-17):
  - `{ success: true, name: string, type: RecipeTypeValue | null, ingredients: string[], instructions: string | null, raw: unknown }`
  - `{ success: false, reason: ExtractionFailureReason, raw: unknown }`
- Nullable fields are always explicit `null`, never `undefined`/omitted. `ingredients` is always an array, never null, but **can be empty or contain empty strings** — the Zod schema (`z.array(z.string())`, recipe-extraction.ts:49) has no `.min(1)` on the array or non-empty check per element.
- `meetsFloor(name, ingredients)` (recipe-extraction.ts:84-86) is the **only** content gate: `Boolean(name && name.trim().length > 0 && ingredients.length >= 1)`. Length only — no per-string blankness check, no `instructions` check.
- `ExtractionFailureReason` values: `not_a_recipe`, `blurry_or_low_light`, `cut_off_or_partial`, `handwriting_illegible` (model self-reported), `incomplete_extraction` (floor-check downgrade), `technical_error` (HTTP failure, missing content field, JSON parse failure, Zod validation failure, missing API key, unsupported MIME, thrown exception/timeout — all six distinct failure paths collapse to this one reason).
- The outer `catch` (recipe-extraction.ts:161-163) is a true catch-all with no discrimination between timeout, network error, or an unrelated bug — everything becomes `technical_error`.
- No path ever returns `success: true` from a caught/degraded state — errors are not silently swallowed into false success. The gap is narrower and different in shape: content that structurally clears the floor but is semantically empty/garbage (e.g. `["", "x"]`) is treated as a full, unqualified success.

### Downstream persistence (`src/pages/api/recipes.ts`)

- `POST` handler calls `extractRecipeFromPhoto` (recipes.ts:104) and branches on `result.success` (recipes.ts:106-189).
- Failure branch: logs `extraction_attempts` row, returns `{ success: false, reason }` with **HTTP 200** (recipes.ts:113) — no recipe/ingredient/storage writes.
- Success branch does **zero re-validation** of `result.name`/`result.ingredients`/`result.instructions` content — it trusts the extraction service's floor check completely. Ingredients are inserted via `result.ingredients.map(...)` (recipes.ts:142-148) with no filtering of empty-string entries.
- The only degraded-state signal computed and returned to the client is `typeUnconfirmed: result.type === null` (recipes.ts:186). There is no equivalent `ingredientsUnconfirmed` / `lowConfidence` flag for empty/thin ingredients or missing instructions.
- Technical-failure compensation exists (photo/DB rollback on storage or insert errors) but this is unrelated to content quality.

### Database schema — no content-quality backstop

- `recipes` table (`supabase/migrations/20260815132912_recipe_schema.sql:25-34`): `name text not null`, `type recipe_type not null`, `photo_path text not null` — NOT NULL only; an empty string would satisfy this.
- `recipe_ingredients` table (same migration, lines 70-76): `name text not null` — same, no CHECK against blank strings.
- `instructions` column (`supabase/migrations/20260816180000_add_recipe_instructions.sql:1-2`): nullable, `check (char_length(instructions) <= 5000)` — an upper-bound length cap only, no lower-bound/quality check.
- `extraction_attempts` table does have a real CHECK constraint enforcing `success ⇔ failure_reason` consistency, but that's a logging table, not `recipes` itself.
- **All quality gating today lives in application code (`meetsFloor`) — nothing in the schema would stop a garbage row if that function were bypassed or buggy.**

### Upload form state machine (`src/components/recipes/PhotoUploadForm.tsx`)

- `Status = "idle" | "loading" | "success" | "error"` (PhotoUploadForm.tsx:21), four top-level render branches.
- Success branch reads `ApiResponseBody` (PhotoUploadForm.tsx:39-42) and only branches further on `body.typeUnconfirmed` (lines 105-109) — it does not inspect `recipe.instructions` or `recipe.ingredients.length` to alter the UI at all.
- Missing `instructions`: the whole instructions block is conditionally omitted (`{successData.recipe.instructions && (...)}`, lines 159-164) — no "instructions not detected" messaging.
- Empty `ingredients`: renders an empty `<ul>` with no items and no "no ingredients found" messaging (lines 154-158).
- The only degraded-state UI that exists is the `typeUnconfirmed` yellow nudge (`TypeConfirmationNudge`, lines 166-174) — it also gates auto-redirect (redirect is suppressed until the user confirms a type; otherwise auto-redirects after 2s).
- The success header ("Przepis zapisany!", lines 140-143) renders identically whether the save is full-fidelity or has empty ingredients/no instructions.
- `src/components/hooks/` does not exist — the component uses only built-in `useState`/`useEffect`/`useRef`, no extracted hooks.
- PRD guardrail (`prd.md:45`): "clear, visible feedback on both success and failure — a silent, status-free process is a regression." FR-021 (`prd.md:119-120`) explicitly defines instructions extraction as best-effort/nullable, same pattern as FR-008 (type) — meaning a degraded-but-saved state is an expected, designed-for outcome that the UI is nonetheless not surfacing distinctly.

### Existing test coverage

**`recipe-extraction.test.ts`** (5 test cases, single `vi.mock` for `astro:env/server`): happy path (with and without instructions), `incomplete_extraction` floor-check downgrade, malformed-JSON `technical_error`, timeout `technical_error`.
- Not covered: any `is_recipe: false` model-reported reason, non-OK HTTP response, missing `.choices[0].message.content`, Zod validation failure on structurally-wrong-but-parseable JSON (the actual adversarial-input gap), missing API key/unsupported MIME short-circuit, non-abort thrown error, and — critically — no test feeds an ingredients array like `["", "x"]` through to confirm it's treated as a full success today.

**`recipes.test.ts`**: happy path persistence, `typeUnconfirmed` fallback, classified-failure passthrough (mocked service already returns failure), ingredients-insert-fails rollback.
- Not covered: `extractRecipeFromPhoto` resolving `success: true` with a garbage/empty-string ingredient or a blank-ish name — the exact scenario the schema gap above allows through.

**`PhotoUploadForm.tsx`**: zero existing tests. No file under `src/components/` has ever been tested; `src/**/*.test.*` search for `render(`/`@testing-library/react`/`screen.`/`fireEvent` returned no matches anywhere in the repo.

### Test tooling gap

- `vitest.config.ts:14` — `test.environment: "node"`, no jsdom/happy-dom. This is the sole config blocker for any DOM rendering; `vitest run` (the `npm run test` script, `package.json:13`) fully depends on this.
- `package.json` devDependencies (lines 39-61) has only `"vitest": "^4.1.10"` for testing — no `jsdom`, `happy-dom`, `@testing-library/react`, `@testing-library/jest-dom`, or `@testing-library/user-event`. `@vitejs/plugin-react` exists transitively in `node_modules` (pulled in by Astro tooling) but is not a listed devDependency and isn't required for Vitest-only component tests (no `vite.config.ts` feeds `vitest.config.ts`).
- No `setupFiles` entry exists for RTL matchers/cleanup.
- Node 22.14.0 (`.nvmrc`) is compatible with current jsdom (≥24) and current `@testing-library/react` (≥16, matches installed React 19.2.6).
- ESLint: no file-scoped block exists for `*.test.ts(x)` today. The broad `reactConfig` (`files: ["**/*.{js,jsx,ts,tsx}"]`, `eslint.config.js:40-41`) already lints `.tsx` test files under the strict type-checked ruleset (`parserOptions.projectService: true`), so a new component test file needs no *new* scoping to pass lint as-is. If `eslint-plugin-testing-library` or RTL-specific rules are wanted, that would be a new scoped block that must be named explicitly per the project's own lesson ("When a phase adds a file needing new ESLint scoping, name it explicitly," `context/foundation/lessons.md:12-25`).

## Code References

- `src/lib/services/recipe-extraction.ts:8-17` — `ExtractionResult` discriminated union
- `src/lib/services/recipe-extraction.ts:43-54` — `modelResponseSchema` (Zod, shape-only validation)
- `src/lib/services/recipe-extraction.ts:84-86` — `meetsFloor` (the sole content gate — length only)
- `src/lib/services/recipe-extraction.ts:88-164` — `extractRecipeFromPhoto` full pipeline
- `src/lib/services/recipe-extraction.test.ts:23-123` — existing test cases (5, happy path + 2 failure reasons)
- `src/pages/api/recipes.ts:104-189` — POST handler, extraction call through persistence
- `src/pages/api/recipes.ts:186` — `typeUnconfirmed: result.type === null`, the only degraded-state client signal
- `src/pages/api/recipes.test.ts:163,206,266,284` — existing extraction-outcome-related test cases
- `src/components/recipes/PhotoUploadForm.tsx:21` — `Status` type (4-state machine)
- `src/components/recipes/PhotoUploadForm.tsx:39-42` — `ApiResponseBody` discriminated union the form parses
- `src/components/recipes/PhotoUploadForm.tsx:90-124` — response-handling / status-branching logic
- `src/components/recipes/PhotoUploadForm.tsx:137-180` — success-state render, including silent instructions/ingredients omission
- `src/components/recipes/PhotoUploadForm.tsx:166-174` — the one existing degraded-state UI (`TypeConfirmationNudge`)
- `src/components/recipes/extraction-failure-copy.ts` — existing `ExtractionFailureReason` → user copy map (used for classified failures, not for degraded-success)
- `supabase/migrations/20260815132912_recipe_schema.sql:25-34,70-76` — `recipes`/`recipe_ingredients` NOT NULL-only constraints
- `supabase/migrations/20260816180000_add_recipe_instructions.sql:1-2` — `instructions` upper-bound-only CHECK
- `vitest.config.ts:14` — `environment: "node"`, the test-tooling blocker
- `package.json:13,39-61` — `test` script and devDependencies (jsdom/RTL absent)
- `eslint.config.js:14-38,40-41` — base and React lint scoping relevant to new test files

## Architecture Insights

- The project already follows a "typed discriminated union + explicit reason enum" pattern for extraction outcomes — any new test/validation work should extend this shape (e.g., a new `contentQualityFlag` alongside `typeUnconfirmed`) rather than introducing a parallel mechanism.
- Content-quality gating is entirely application-level (`meetsFloor`) by design — the schema deliberately only enforces presence (`NOT NULL`) and upper bounds, never lower-bound/quality. Any fix for Risk #2 belongs in `meetsFloor`/the API route, not a migration.
- `typeUnconfirmed` is the existing precedent for "best-effort field, defaulted, surfaced distinctly to the user" — Risk #3's fix (surfacing degraded instructions/ingredients) should likely follow the same pattern (a boolean flag from the API, consumed by a distinct UI element) rather than inventing a new mechanism.
- The API route returns classified failures with HTTP 200, using the JSON body's `success` field as the signal — any new component test must account for this (can't rely on `response.ok` to distinguish extraction failure).

## Historical Context (from prior changes)

- `context/archive/2026-08-16-recipe-prep-instructions/change.md` — FR-021 (instructions extraction) was added as a PRD amendment after S-01 manual testing surfaced it as a "core-value gap," explicitly following the FR-008 best-effort/nullable pattern. This confirms Risk #2/#3 concerns are not hypothetical — the nullable/best-effort design was a deliberate, recently-made tradeoff, and this rollout phase is the first time its failure-visibility implications are being tested.
- `context/archive/2026-08-15-recipe-data-schema/change.md` — establishes that RLS, not schema constraints, is the intended integrity boundary for this project's data model (relevant precedent for why content-quality is expected to live in app code, not migrations).

## Related Research

None — this is the first `/10x-research` document for this change.

## Open Questions

- Should the fix for Risk #2/#3 filter/reject blank ingredient strings inside `meetsFloor` (tightening what counts as "success"), or should it introduce a new `contentDegraded`-style flag (following the `typeUnconfirmed` precedent) and let the UI surface it without blocking the save? This is a `/10x-plan` decision, not a research one — both are consistent with FR-021's "best-effort, non-blocking" framing, but they produce different test surfaces (unit-only vs. unit + component).
- Whether `@testing-library/react` v16 needs `@testing-library/dom` peer alignment with the installed React 19.2.6 — worth a quick version-compat check at plan time, not blocking for research.
