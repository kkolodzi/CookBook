# Recipe Preparation Instructions (backend slice) — Implementation Plan

## Overview

Add a freeform `instructions` field to recipes: extracted from the photo alongside
name/type/ingredients (best-effort, non-blocking, normalized into flowing-paragraph prose),
persisted to the database, and surfaced in the existing post-upload confirmation UI. This plan
covers the **backend slice only** (FR-021) — displaying/editing instructions in the recipe
detail view and edit form (FR-018, FR-019) is a separate follow-up plan, written after S-02
(`recipe-search-and-browse`) and S-03 (`recipe-edit-and-remove`) merge, because both branches
modify `src/pages/recipes/[id].astro` in incompatible ways and the real post-merge file doesn't
exist yet.

## Current State Analysis

- `recipes` table (`supabase/migrations/20260815132912_recipe_schema.sql:25-34`) has 8 columns;
  no `instructions` column.
- Extraction service (`src/lib/services/recipe-extraction.ts`) returns `{ name, type, ingredients }`
  via `modelResponseSchema` (zod, lines 36-46) and `EXTRACTION_PROMPT` (lines 48-63); consumed
  only by `src/pages/api/recipes.ts:73` and tested in `src/lib/services/recipe-extraction.test.ts`.
- `src/pages/api/recipes.ts` POST handler inserts into `recipes` (single insert, lines 125-129) and
  `recipe_ingredients` (lines 136-142) with app-level compensating deletes on failure — no DB
  transaction. (Line numbers as of 2026-08-16 post-S-02-merge; S-02 added a `GET` list handler
  above `POST`, shifting what were lines 94-141 pre-merge down by ~31 lines.)
- `src/types.ts` is Supabase-generated (committed static file), currently matches the 8-column
  schema exactly.
- `src/components/recipes/PhotoUploadForm.tsx:113-141` is the only place in the codebase that
  renders recipe fields today — an inline post-upload success card showing name/type/ingredients.
  It's on `main`, untouched by S-02/S-03.
- No recipe detail or edit view exists on `main`. S-02 and S-03 each independently created
  `src/pages/recipes/[id].astro` for different purposes (read-only detail vs. edit form) — a real
  merge conflict between those two branches, unrelated to this plan.

## Desired End State

A photo upload extracts and saves preparation instructions (freeform text, nullable) alongside
name/type/ingredients. The post-upload confirmation shows the extracted instructions in full.
`src/types.ts` reflects the new column. Existing recipes (saved before this change) have
`instructions = null` and continue to work unchanged.

Verify by: uploading a recipe photo with visible preparation steps and confirming the
instructions text appears in the post-upload confirmation card, worded as continuous prose.

### Key Discoveries:

- Extraction is single-pass (one OpenRouter call) — adding `instructions` to the model's JSON
  response is additive to the existing schema, no new API call needed
  (`src/lib/services/recipe-extraction.ts:99-114`).
- `recipes` insert and `recipe_ingredients` insert are two separate calls with manual
  compensation (`src/pages/api/recipes.ts:125-156`) — `instructions` is a single-column addition
  to the first insert, no new compensation path needed.
- Migration naming convention: `YYYYMMDDHHmmss_short_description.sql`; the last migration on
  `main` is `20260816170000_atomic_recipe_ingredient_edit.sql` (landed with S-03), so the next
  one is `20260816180000_add_recipe_instructions.sql`.
- Two-project migration pattern (per F-02's plan, `context/archive/2026-08-15-recipe-data-schema/plan.md`):
  apply to `SnapRecipe` (dev, ref `xmyeeuyeszvpvrjszohr`) first, verify, then apply to
  `SnapRecipe_live` (prod, ref `gtrhakzhlammvfifvlyf`) in a later phase.

## What We're NOT Doing

- Not touching `src/pages/recipes/[id].astro`, `RecipeEditForm.tsx`, or any other S-02/S-03 file
  — FR-018 (detail view) and FR-019 (edit) are explicitly deferred to a follow-up plan after
  those branches merge.
- Not building a structured step list — instructions are a single freeform text field (decided
  during shaping; see `frame.md` and `change.md`).
- Not adding a length-based UI truncation/collapse control to `PhotoUploadForm` — full text is
  always shown.
- Not backfilling `instructions` for recipes saved before this change — they simply have `null`.

## Implementation Approach

Additive-only change: one nullable `text` column with a length check constraint, one extra field
threaded through the extraction service's zod schema/prompt/type, one extra field in the existing
`recipes` insert + response payload, and one new block in the existing post-upload confirmation
UI. No new API endpoints, no new database tables, no transaction changes.

## Phase 1: Schema migration

### Overview

Add the `instructions` column to `recipes` and regenerate `src/types.ts`.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20260816180000_add_recipe_instructions.sql`

**Intent**: Add a nullable freeform-text column for preparation instructions, matching the
existing `recipes` table's soft-delete/timestamp conventions.

**Contract**: `alter table recipes add column instructions text check (char_length(instructions) <= 5000);`
— nullable (no `not null`), so existing rows default to `NULL` with no backfill required.

#### 2. Apply to dev

**Intent**: Get the new column live in `SnapRecipe` (dev) so local development and Phase 2-4
work against real schema.

**Contract**: `supabase link --project-ref xmyeeuyeszvpvrjszohr && supabase db push`.

#### 3. Regenerate types

**File**: `src/types.ts`

**Intent**: Keep the committed generated-types file in sync with the new column, matching how
`recipes` is currently typed (`Row`/`Insert`/`Update` all gain `instructions: string | null` /
`instructions?: string | null`).

**Contract**: Regenerate via `supabase gen types typescript` (or the `generate_typescript_types`
MCP tool) against the dev project, then commit the diff.

### Success Criteria:

#### Automated Verification:

- `supabase link --project-ref xmyeeuyeszvpvrjszohr` succeeds
- `supabase db push` applies the migration with exit code 0
- `npm run build` succeeds (validates regenerated `src/types.ts` compiles with the rest of the project)
- `npm run lint` passes

#### Manual Verification:

- Confirm the new column appears via `\d recipes` (or Supabase Studio table editor) on the dev
  project, nullable, with the 5000-char check constraint listed

---

## Phase 2: Extraction service

### Overview

Extend the extraction service to request, validate, and normalize preparation instructions from
the vision model.

### Changes Required:

#### 1. Extraction schema, prompt, and result type

**File**: `src/lib/services/recipe-extraction.ts`

**Intent**: Ask the model for preparation instructions as flowing-paragraph prose (not
preserving numbered-step formatting — a deliberate deviation from the "extract as written"
treatment given to name/ingredients, chosen for more uniform downstream display), rewritten from
whatever structure the source uses. Extraction is best-effort: a missing or unreadable
instructions block does not affect `is_recipe`/`not_recipe_reason` or the existing `meetsFloor`
check — same non-blocking treatment as `type`.

**Contract**:
- `modelResponseSchema` (lines 36-46) gains `instructions: z.string().trim().max(5000).nullable()`.
- `EXTRACTION_PROMPT` (lines 48-63) gains an `"instructions"` field in the described JSON shape,
  instructing the model to rewrite the preparation steps as continuous prose in the source
  language (Polish), or `null` if no preparation steps are visible in the photo.
- `ExtractionResult`'s success variant (lines 8-10) gains `instructions: string | null`.
- The success return (line 151) threads `instructions` through unchanged — no new floor/validation
  logic; a `null` or empty instructions value is valid and does not affect success.

#### 2. Update extraction unit tests

**File**: `src/lib/services/recipe-extraction.test.ts`

**Intent**: Cover the new field the same way `type` is covered today — success case with
instructions present, success case with instructions `null`.

**Contract**: Extend existing sample model-response fixtures (around lines 33-45) and their
expected `ExtractionResult` assertions to include `instructions`.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes (`src/lib/services/recipe-extraction.test.ts`)
- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- None — fully covered by unit tests; extraction quality against real photos is validated in
  Phase 4's manual step

---

## Phase 3: API route persistence

### Overview

Persist and return the extracted instructions through the existing recipe-creation flow.

### Changes Required:

#### 1. Insert and response payload

**File**: `src/pages/api/recipes.ts`

**Intent**: Save `instructions` alongside the existing fields in the same single-row `recipes`
insert (no new insert, no new compensation path), and return it in the success response so
`PhotoUploadForm` (Phase 4) can render it.

**Contract**:
- The `recipes` insert object (line 127) gains `instructions: result.instructions`.
- The `.select(...)` on that insert (line 128) and the success response body (lines 165-171)
  both gain `instructions`.

#### 2. Update API route tests

**File**: `src/pages/api/recipes.test.ts`

**Intent**: Cover the new field the same way `type` is covered today.

**Contract**: In the `describe("POST /api/recipes", ...)` block (line 93), extend the mocked
extraction results and insert/response assertions to include `instructions` — primarily
`"persists recipe, ingredients, photo, and a success attempt log on a successful extraction"`
(line 133) and `"falls back to 'other' and flags typeUnconfirmed..."` (line 166).

### Success Criteria:

#### Automated Verification:

- `npm run test` passes (`src/pages/api/recipes.test.ts`)
- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- None — covered by automated tests; end-to-end confirmation happens in Phase 4

---

## Phase 4: Post-upload confirmation UI + production migration

### Overview

Show the extracted instructions in the existing post-upload success card, and ship the schema
change to production.

### Changes Required:

#### 1. Confirmation UI

**File**: `src/components/recipes/PhotoUploadForm.tsx`

**Intent**: Add an "Instructions" block to the existing inline success state, below the
ingredients list, following the same visual treatment as the existing name/type/ingredients
block. Render nothing (no empty-state message) when `instructions` is `null` — matches how the
confirmation card already just omits absent optional data.

**Contract**: Add a conditional block near lines 121-141 that renders `instructions` as a single
text block (no truncation, no "show more") when non-null.

#### 2. Apply migration to production

**Intent**: Ship the schema change to `SnapRecipe_live` once dev + code changes are verified.

**Contract**: `supabase link --project-ref gtrhakzhlammvfifvlyf && supabase db push`.

### Success Criteria:

#### Automated Verification:

- `supabase link --project-ref gtrhakzhlammvfifvlyf` succeeds
- `supabase db push` applies the migration to production with exit code 0
- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification:

- Upload a real photo of a recipe with visible preparation steps; confirm the post-upload card
  shows the instructions as continuous prose text
- Upload a photo where preparation steps aren't legible/visible; confirm the card renders
  normally with no instructions block and no error
- Confirm an existing (pre-this-change) recipe is unaffected — no crash, no visible regression,
  `instructions` is simply absent

---

## Testing Strategy

### Unit Tests:

- Extraction service: instructions present / instructions null, both treated as success
- API route: insert payload and response include `instructions`

### Integration Tests:

- Existing `recipes.test.ts` integration coverage extended, not duplicated

### Manual Testing Steps:

1. Upload a clear photo of a recipe with numbered or paragraph-style preparation steps; confirm
   instructions appear as prose in the confirmation card
2. Upload a photo with no visible preparation text (ingredients-only recipe); confirm the recipe
   still saves and no instructions block renders
3. Confirm dev and prod Supabase projects both show the new column via Studio

## Performance Considerations

None — single additional text column, no new queries, no new API calls.

## Migration Notes

Additive-only: existing rows get `instructions = NULL` automatically; no backfill script needed.
FR-018 (detail view) and FR-019 (edit form) will need their own schema-consuming changes once
S-02/S-03 merge — see "What We're NOT Doing".

## References

- Frame brief: `context/changes/recipe-prep-instructions/frame.md`
- Prior schema plan (migration + two-project pattern precedent): `context/archive/2026-08-15-recipe-data-schema/plan.md`
- PRD: `context/foundation/prd.md` FR-021, FR-018, FR-019
- Roadmap: `context/foundation/roadmap.md` S-04

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Schema migration

#### Automated

- [ ] 1.1 supabase link (dev) succeeds
- [ ] 1.2 supabase db push applies migration
- [ ] 1.3 npm run build succeeds
- [ ] 1.4 npm run lint passes

#### Manual

- [ ] 1.5 Confirm new column in dev via Studio

### Phase 2: Extraction service

#### Automated

- [ ] 2.1 npm run test passes (recipe-extraction.test.ts)
- [ ] 2.2 npm run lint passes
- [ ] 2.3 npm run build succeeds

### Phase 3: API route persistence

#### Automated

- [ ] 3.1 npm run test passes (recipes.test.ts)
- [ ] 3.2 npm run lint passes
- [ ] 3.3 npm run build succeeds

### Phase 4: Post-upload confirmation UI + production migration

#### Automated

- [ ] 4.1 supabase link (prod) succeeds
- [ ] 4.2 supabase db push applies migration to production
- [ ] 4.3 npm run build succeeds
- [ ] 4.4 npm run lint passes

#### Manual

- [ ] 4.5 Upload photo with visible steps; confirm prose renders
- [ ] 4.6 Upload photo without visible steps; confirm graceful omission
- [ ] 4.7 Confirm existing recipe unaffected
