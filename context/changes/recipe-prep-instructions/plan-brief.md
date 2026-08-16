# Recipe Preparation Instructions — Plan Brief

> Full plan: `context/changes/recipe-prep-instructions/plan.md`
> Frame brief: `context/changes/recipe-prep-instructions/frame.md`

## What & Why

The PRD never specified capturing recipe preparation instructions — FR-005 only asked for name,
ingredients, and type, so nothing downstream (F-02 schema, S-01 extraction) captured them.
Surfaced during S-01 manual testing as a real core-value gap: a saved recipe couldn't be cooked
from without reopening the photo. This plan adds extraction + storage (FR-021), detail-view
display (FR-018), and edit-form editing (FR-019) for a freeform `instructions` field — the full
S-04 roadmap slice in one pass.

## Starting Point

`recipes` has 8 columns, no `instructions`. The extraction service (`recipe-extraction.ts`) asks
the vision model for name/type/ingredients only. S-02 and S-03 have both merged to `main`: the
recipe detail view (`[id].astro`), edit page (`[id]/edit.astro` + `RecipeEditForm`), and an
atomic `edit_recipe()` Postgres RPC all exist for real — this plan extends them rather than
guessing at their post-merge shape.

## Desired End State

A photo upload extracts preparation instructions as flowing prose (best-effort, nullable — same
non-blocking treatment as recipe type) and saves them with the recipe. Instructions show in the
post-upload confirmation and the detail view, and are editable (add/change/clear) via the edit
form. Existing recipes are unaffected (`instructions = NULL`, no section shown).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Instructions format | Freeform text, not structured steps | Simpler schema/extraction, matches how most physical recipes are written | Plan (shaping interview) |
| FR-021 priority | Must-have, but best-effort/nullable | Core-value gap, but the photo itself is already the fallback (guardrail), so extraction shouldn't block save — same pattern as FR-008 (type) | Plan (shaping interview, Socrates round) |
| Original plan scope | Backend-only first (deferred UI) | S-02/S-03 hadn't merged yet and both touched the detail/edit files this needs | Plan (superseded — both merged, plan extended) |
| Column constraint | `text` with 5000-char check constraint | Guards against a runaway/garbled extraction without meaningfully limiting real recipes | Plan |
| Extraction prompt style | Normalize to flowing paragraph (not preserve as-written numbering) | More uniform for later display; a deliberate deviation from the "extract as written" treatment given to ingredients | Plan |
| Empty-state treatment | Hide the instructions section entirely when null, everywhere (upload confirmation, detail view) | One consistent rule across the app instead of a per-surface decision | Plan |
| Edit RPC change | Extend `edit_recipe()` with `p_instructions default null` rather than a second update call | Keeps the edit atomic (S-03's whole reason for introducing the RPC) instead of reintroducing a partial-failure window | Plan |
| Editing instructions | Optional textarea; empty saves as `null`, not a validation error | Unlike name/ingredients, instructions were always best-effort — editing should match that permissiveness | Plan |

## Scope

**In scope:**
- New `recipes.instructions` column (nullable text, 5000-char cap), migrated to dev then prod
- Extraction service: request + validate + normalize instructions (best-effort)
- POST `/api/recipes`: persist and return instructions
- `PhotoUploadForm.tsx`: show instructions in the post-upload confirmation
- Detail view (`[id].astro` + `RecipeDetailDto` + `getRecipeDetail()`): show instructions
- Edit form (`RecipeEditForm.tsx` + `edit.astro` + PATCH route + extended `edit_recipe()` RPC):
  add/edit/clear instructions

**Out of scope:**
- Structured step lists, backfilling old recipes, UI truncation/collapse anywhere
- Refactoring `edit.astro`'s inline query to reuse `getRecipeDetail()`
- Wiring `GET /api/recipes/[id]` into any client (stays unused, kept response-shape-consistent only)

## Architecture / Approach

Additive-only throughout: one nullable column, one field threaded through the existing
single-pass extraction call and single-row `recipes` insert, one extra RPC parameter (keeping
the edit atomic), and matching UI blocks in three existing components. No new endpoints, tables,
or transactions beyond the existing `edit_recipe()` RPC.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema migration | `instructions` column live in dev; `src/types.ts` regenerated | Low — additive, nullable column |
| 2. Extraction service | Model asked for instructions; best-effort, non-blocking | Extraction quality unverified for multi-line Polish text (graceful degradation by design) |
| 3. API route persistence | Instructions saved + returned by the existing recipe insert | None |
| 4. Upload confirmation UI | User sees instructions right after upload | None |
| 5. Detail view (FR-018) | Instructions shown on the recipe page | None — DTO/query/render, all additive |
| 6. Edit form (FR-019) | User can add/change/clear instructions | RPC signature change — mitigated with `default null` |
| 7. Production rollout | Both migrations live in prod; full regression | Standard migration-rollout risk, mitigated by dev verification first |

**Prerequisites:** S-01 (extraction pipeline, done), S-02 (detail view, merged 2026-08-16), S-03
(edit form + `edit_recipe()` RPC, merged 2026-08-16). All three are now satisfied — no blockers.
**Estimated effort:** Small-medium — 7 phases, all additive, no new subsystems.

## Open Risks & Assumptions

- Extraction quality for multi-line Polish preparation text is unverified (unlike ingredients,
  validated during S-01 manual testing) — mitigated by best-effort/nullable design, not a
  blocker.
- `edit_recipe()`'s signature changes (Phase 6) — the API route is its only caller, so this is
  low-risk, but worth confirming no other caller exists before merging (checked: only
  `src/pages/api/recipes/[id]/index.ts` calls it).

## Success Criteria (Summary)

- A freshly uploaded recipe photo with visible preparation steps shows those steps as prose in
  the post-upload confirmation card and the detail view
- A user can add, change, or clear a recipe's instructions via the edit form, and the detail
  view reflects it
- A recipe photo without visible steps still saves successfully with no error, and no
  instructions section appears anywhere
- Existing (pre-change) recipes remain fully functional with no instructions section
