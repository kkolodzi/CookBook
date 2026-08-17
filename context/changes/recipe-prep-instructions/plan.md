# Recipe Preparation Instructions — Implementation Plan

## Overview

Add a freeform `instructions` field to recipes: extracted from the photo alongside
name/type/ingredients (best-effort, non-blocking, normalized into flowing-paragraph prose),
persisted to the database, surfaced in the post-upload confirmation UI (FR-021), shown in the
recipe detail view (FR-018), and editable in the edit form (FR-019). Originally scoped as a
backend-only plan (S-02/S-03 hadn't merged yet, and both touched the detail/edit surfaces this
plan needs); both have since merged to `main` with real `[id].astro` (detail), `[id]/edit.astro`
+ `RecipeEditForm` (edit), and an atomic `edit_recipe()` Postgres RPC backing the edit flow — so
this plan now covers the full S-04 slice in one pass (Phases 1-4: backend, unchanged from the
original scope; Phases 5-7: detail view, edit form, and production rollout, newly added).

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
- `src/components/recipes/PhotoUploadForm.tsx:113-141` renders an inline post-upload success card
  showing name/type/ingredients. Untouched by S-02/S-03.
- **Detail view** (`src/pages/recipes/[id].astro`, FR-018, from S-02): loads via
  `getRecipeDetail()` (`src/lib/services/recipe-query.ts:94-143`) into a `RecipeDetailDto`
  (`src/types.ts:309-316`); renders name/type/photo/ingredients in a card (lines 51-77), with an
  "Edytuj" link to `/recipes/${id}/edit` and a `RecipeRemoveButton` (lines 59-67, added by S-03's
  merge-conflict reconciliation).
- **Edit page** (`src/pages/recipes/[id]/edit.astro` + `RecipeEditForm.tsx`, FR-019, from S-03):
  the `.astro` page does its own inline Supabase query (`select("id, name, type")` +
  `recipe_ingredients`, lines 16-28) rather than reusing `getRecipeDetail`, then renders
  `RecipeEditForm` (`client:load`) with `{ id, name, type, ingredients }`. The form
  (`RecipeEditForm.tsx`) is a controlled form with local state for name/type/ingredients;
  `handleSubmit` (lines 41-79) `PATCH`es `/api/recipes/${recipe.id}` with
  `{ name, type, ingredients }`.
- **PATCH route** (`src/pages/api/recipes/[id]/index.ts`): `patchSchema` (lines 8-12) validates
  `{ name, type, ingredients }`; the handler calls the atomic `edit_recipe` Postgres RPC (lines
  84-89) rather than doing separate insert/delete calls — S-03 replaced the naive two-step
  ingredient replace with a single transactional function
  (`supabase/migrations/20260816170000_atomic_recipe_ingredient_edit.sql`) to avoid a
  duplicated/zero-ingredient state on partial failure. The RPC signature is
  `edit_recipe(p_recipe_id uuid, p_name text, p_type recipe_type, p_ingredients text[])`. The
  same file's `GET` handler (lines 18-59) returns `{ id, name, type, ingredients }` but has no
  client caller today (`edit.astro` queries Supabase directly instead) — kept in sync anyway for
  API-shape consistency with `PATCH`.

## Desired End State

A photo upload extracts and saves preparation instructions (freeform text, nullable) alongside
name/type/ingredients. The post-upload confirmation, the recipe detail view, and the edit form
all show/allow editing instructions, consistently. `src/types.ts` reflects the new column.
Existing recipes (saved before this change) have `instructions = null` and continue to work
unchanged everywhere.

Verify by: uploading a recipe photo with visible preparation steps, confirming the instructions
text appears in the post-upload confirmation card and in the recipe's detail view, then editing
the recipe to change the instructions and confirming the edit persists and displays correctly.

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
  apply to `SnapRecipe` (dev, ref `xmyeeuyeszvpvrjszohr`) first, verify everything end-to-end,
  then apply all accumulated migrations to `SnapRecipe_live` (prod, ref
  `gtrhakzhlammvfifvlyf`) in one final phase.
- `edit_recipe()`'s signature will need a new `p_instructions text default null` parameter and an
  `instructions = p_instructions` clause in its `update` — `create or replace function` with a
  default keeps the change additive; the API route (the RPC's only caller) will always pass the
  parameter explicitly.

## What We're NOT Doing

- Not building a structured step list — instructions are a single freeform text field (decided
  during shaping; see `frame.md` and `change.md`).
- Not adding a length-based UI truncation/collapse control anywhere (`PhotoUploadForm`, detail
  view, edit form) — full text is always shown.
- Not backfilling `instructions` for recipes saved before this change — they simply have `null`.
- Not reworking `edit.astro`'s inline Supabase query to reuse `getRecipeDetail()` — out of scope
  refactor; extend its existing inline query the same way it already selects `name`/`type`.
- Not wiring the `GET /api/recipes/[id]` route into `edit.astro` — that's a pre-existing
  architecture choice (inline query vs. API call) unrelated to this change; only keeping the
  route's response shape consistent with `PATCH`.

## Implementation Approach

Additive-only change throughout: one nullable `text` column with a length check constraint, one
extra field threaded through the extraction service's zod schema/prompt/type, one extra field in
the existing `recipes` insert + response payload, one new block in the post-upload confirmation
UI, one new block in the detail view, and one new form field (backed by an extended
`edit_recipe()` RPC) in the edit form. No new API endpoints, no new database tables, no
transaction changes beyond the existing `edit_recipe()` RPC.

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

**Intent**: Get the new column live in `SnapRecipe` (dev) so local development and Phases 2-6
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
  Phase 4's and Phase 5's manual steps

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

## Phase 4: Post-upload confirmation UI

### Overview

Show the extracted instructions in the existing post-upload success card.

### Changes Required:

#### 1. Confirmation UI

**File**: `src/components/recipes/PhotoUploadForm.tsx`

**Intent**: Add an "Instructions" block to the existing inline success state, below the
ingredients list, following the same visual treatment as the existing name/type/ingredients
block. Render nothing (no empty-state message) when `instructions` is `null` — matches how the
confirmation card already just omits absent optional data.

**Contract**: Add a conditional block near lines 121-141 that renders `instructions` as a single
text block (no truncation, no "show more") when non-null.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification:

- Upload a real photo of a recipe with visible preparation steps; confirm the post-upload card
  shows the instructions as continuous prose text
- Upload a photo where preparation steps aren't legible/visible; confirm the card renders
  normally with no instructions block and no error

---

## Phase 5: Detail view (FR-018)

### Overview

Show the recipe's instructions on its detail page.

### Changes Required:

#### 1. DTO

**File**: `src/types.ts`

**Intent**: Extend the hand-authored `RecipeDetailDto` (distinct from the Supabase-generated
`Database` types above it in the same file) to carry instructions through to the detail view.

**Contract**: `RecipeDetailDto` (lines 309-316) gains `instructions: string | null`.

#### 2. Query service

**File**: `src/lib/services/recipe-query.ts`

**Intent**: Select and map the new column through `getRecipeDetail()` — the only place that
builds a `RecipeDetailDto`.

**Contract**: The `recipes` select in `getRecipeDetail()` (line 101) gains `instructions`; the
returned object (lines 135-142) gains `instructions: recipe.instructions`. `listRecipes()` /
`RecipeSummaryDto` are untouched — the collection view never showed full detail fields and
doesn't need to start now.

#### 3. Detail page

**File**: `src/pages/recipes/[id].astro`

**Intent**: Render instructions below the ingredients section, following the same heading +
body pattern as "Składniki" (lines 69-76). Omit the whole section when `instructions` is `null`
— same empty-state treatment as Phase 4's confirmation card, for consistency across the app.

**Contract**: Add a conditional block after the ingredients `<div>` (after line 76) rendering an
"Instrukcje przygotowania" heading + the instructions text, only when `recipe.instructions` is
non-null.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification:

- Open the detail view of a recipe with instructions; confirm they render below the ingredients
- Open the detail view of a recipe without instructions (e.g. one saved before this change);
  confirm no instructions section renders and nothing else regresses

---

## Phase 6: Edit form (FR-019)

### Overview

Let the user add, edit, or clear a recipe's instructions from the edit page.

### Changes Required:

#### 1. Extend the atomic edit RPC

**File**: `supabase/migrations/20260816190000_edit_recipe_instructions.sql`

**Intent**: Thread instructions through the same atomic update `edit_recipe()` already uses for
name/type/ingredients, keeping the edit a single transaction.

**Contract**: `create or replace function edit_recipe(p_recipe_id uuid, p_name text, p_type
recipe_type, p_ingredients text[], p_instructions text default null) ...` — same body as today
plus `instructions = p_instructions` added to the `update recipes set ...` clause. `default
null` keeps the signature change additive; re-run the existing `grant execute` for the new
signature.

#### 2. Apply to dev

**Intent**: Get the updated RPC live in `SnapRecipe` (dev).

**Contract**: `supabase link --project-ref xmyeeuyeszvpvrjszohr && supabase db push`.

#### 3. PATCH route

**File**: `src/pages/api/recipes/[id]/index.ts`

**Intent**: Accept and pass through instructions on edit, with the same best-effort/optional
treatment as extraction (a user can leave it blank). Also keep `GET`'s response shape consistent
with `PATCH` even though nothing currently calls `GET` (see "What We're NOT Doing").

**Contract**:
- `patchSchema` (lines 8-12) gains `instructions: z.string().trim().max(5000).nullable()` —
  unlike `name`/`ingredients`, empty/omitted is valid (maps to `null`, not a validation error).
- The `edit_recipe` RPC call (lines 84-89) gains `p_instructions: instructions`.
- The success response (line 98) gains `instructions`.
- `GET`'s `recipes` select (line 36) and response (lines 55-58) gain `instructions`.

#### 4. Edit page + form

**File**: `src/pages/recipes/[id]/edit.astro`

**Intent**: Fetch instructions alongside the existing inline query and pass it to the form.

**Contract**: The inline `.select("id, name, type")` (line 18) gains `instructions`; the `recipe`
object built at lines 30-35 and its type annotation (line 9) gain `instructions: string | null`.

**File**: `src/components/recipes/RecipeEditForm.tsx`

**Intent**: Add a textarea for instructions below the ingredients list, matching the form's
existing field styling (see the "Nazwa" input, lines 102-113). Optional field — unlike
ingredients, an empty value is valid and saves as `null` rather than blocking submit.

**Contract**: `RecipeEditFormProps` (lines 10-17) gains `instructions: string | null`; local
state gains `useState(recipe.instructions ?? "")`; `handleSubmit`'s request body (line 63) gains
`instructions: instructions.trim() || null`; no new validation error path — instructions has no
`min(1)` equivalent to `cleanedIngredients`'s check.

#### 5. Update tests

**Files**: `src/pages/api/recipes/[id]/index.test.ts`

**Intent**: Cover the new field in both `GET` and `PATCH`, matching how `type` is covered today.

**Contract**: Extend `"returns the recipe with ordered ingredients"` (line 87) and `"calls the
atomic edit_recipe RPC and returns the updated recipe on success"` (line 129) to include
`instructions`.

### Success Criteria:

#### Automated Verification:

- `supabase link --project-ref xmyeeuyeszvpvrjszohr` succeeds
- `supabase db push` applies the migration with exit code 0
- `npm run test` passes (`src/pages/api/recipes/[id]/index.test.ts`)
- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- Edit a recipe to add instructions where none existed; save; confirm the detail view now shows
  them
- Edit a recipe's existing instructions; save; confirm the change persists and displays
- Clear a recipe's instructions to empty; save; confirm the detail view shows no instructions
  section afterward (not an empty one)

---

## Phase 7: Production rollout

### Overview

Ship both migrations (Phase 1's column, Phase 6's RPC update) to production once everything is
verified in dev.

### Changes Required:

#### 1. Apply migrations to production

**Intent**: Ship the accumulated schema changes to `SnapRecipe_live` in one step, now that the
full slice (extraction, detail view, edit form) is verified end-to-end in dev.

**Contract**: `supabase link --project-ref gtrhakzhlammvfifvlyf && supabase db push` — applies
both `20260816180000_add_recipe_instructions.sql` and `20260816190000_edit_recipe_instructions.sql`
in one push, since neither has been applied to prod yet.

### Success Criteria:

#### Automated Verification:

- `supabase link --project-ref gtrhakzhlammvfifvlyf` succeeds
- `supabase db push` applies both migrations to production with exit code 0
- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification:

- Confirm an existing (pre-this-change) production recipe is unaffected — detail view renders,
  edit form loads, `instructions` is simply absent
- Full regression on production: upload → confirmation shows instructions → detail view shows
  them → edit changes them → detail view reflects the edit

---

## Testing Strategy

### Unit Tests:

- Extraction service: instructions present / instructions null, both treated as success
- POST `/api/recipes`: insert payload and response include `instructions`
- GET/PATCH `/api/recipes/[id]`: response and RPC call include `instructions`

### Integration Tests:

- Existing `recipes.test.ts` and `[id]/index.test.ts` integration coverage extended, not
  duplicated

### Manual Testing Steps:

1. Upload a clear photo of a recipe with numbered or paragraph-style preparation steps; confirm
   instructions appear as prose in the confirmation card
2. Upload a photo with no visible preparation text (ingredients-only recipe); confirm the recipe
   still saves and no instructions block renders anywhere
3. Open that recipe's detail view; confirm instructions appear (or the section is absent, for
   the no-instructions case)
4. Edit the recipe: add/change/clear instructions; save; confirm the detail view reflects the
   change
5. Confirm dev and prod Supabase projects both show the new column and updated `edit_recipe`
   function via Studio

## Performance Considerations

None — one additional text column, one extra RPC parameter, no new queries, no new API calls.

## Migration Notes

Additive-only throughout: existing rows get `instructions = NULL` automatically; no backfill
script needed. Two migrations ship together: the column (Phase 1) and the `edit_recipe()` RPC
update (Phase 6) — both applied to dev as they're built, both applied to prod together in
Phase 7.

## References

- Frame brief: `context/changes/recipe-prep-instructions/frame.md`
- Prior schema plan (migration + two-project pattern precedent): `context/archive/2026-08-15-recipe-data-schema/plan.md`
- S-02 plan (detail view origin): `context/archive/2026-08-16-recipe-search-and-browse/plan.md`
- S-03 plan (edit form + atomic RPC origin): `context/archive/2026-08-16-recipe-edit-and-remove/plan.md`
- PRD: `context/foundation/prd.md` FR-021, FR-018, FR-019
- Roadmap: `context/foundation/roadmap.md` S-04

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Schema migration

#### Automated

- [x] 1.1 supabase link (dev) succeeds — f25419f
- [x] 1.2 supabase db push applies migration — f25419f
- [x] 1.3 npm run build succeeds — f25419f
- [x] 1.4 npm run lint passes — f25419f

#### Manual

- [ ] 1.5 Confirm new column in dev via Studio

### Phase 2: Extraction service

#### Automated

- [x] 2.1 npm run test passes (recipe-extraction.test.ts) — 18ae153
- [x] 2.2 npm run lint passes — 18ae153
- [x] 2.3 npm run build succeeds — 18ae153

### Phase 3: API route persistence

#### Automated

- [x] 3.1 npm run test passes (recipes.test.ts) — 08d92ed
- [x] 3.2 npm run lint passes — 08d92ed
- [x] 3.3 npm run build succeeds — 08d92ed

### Phase 4: Post-upload confirmation UI

#### Automated

- [x] 4.1 npm run build succeeds — 36c4f5f
- [x] 4.2 npm run lint passes — 36c4f5f

#### Manual

- [ ] 4.3 Upload photo with visible steps; confirm prose renders
- [ ] 4.4 Upload photo without visible steps; confirm graceful omission

### Phase 5: Detail view (FR-018)

#### Automated

- [x] 5.1 npm run build succeeds — e9cf3e0
- [x] 5.2 npm run lint passes — e9cf3e0

#### Manual

- [ ] 5.3 Detail view shows instructions when present
- [ ] 5.4 Detail view omits the section when instructions is null

### Phase 6: Edit form (FR-019)

#### Automated

- [x] 6.1 supabase link (dev) succeeds — 49c3d15
- [x] 6.2 supabase db push applies migration — 49c3d15
- [x] 6.3 npm run test passes ([id]/index.test.ts) — 49c3d15
- [x] 6.4 npm run lint passes — 49c3d15
- [x] 6.5 npm run build succeeds — 49c3d15

#### Manual

- [ ] 6.6 Add instructions via edit form; detail view reflects it
- [ ] 6.7 Change existing instructions via edit form; detail view reflects it
- [ ] 6.8 Clear instructions via edit form; detail view shows no section

### Phase 7: Production rollout

#### Automated

- [x] 7.1 supabase link (prod) succeeds
- [x] 7.2 supabase db push applies both migrations to production
- [x] 7.3 npm run build succeeds
- [x] 7.4 npm run lint passes

#### Manual

- [ ] 7.5 Existing production recipe unaffected (detail + edit load fine, instructions absent)
- [ ] 7.6 Full regression: upload → confirmation → detail view → edit → detail view reflects edit
