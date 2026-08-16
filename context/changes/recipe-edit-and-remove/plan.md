# Recipe Edit and Reversible Removal Implementation Plan

## Overview

Let a user edit a saved recipe's name, type, and ingredient list, and remove a recipe reversibly (soft-delete with restore), per FR-019 and FR-020. Since no recipe list or detail UI exists yet on this branch (S-02 `recipe-search-and-browse` is being built in a parallel worktree), this plan also builds the minimal list/detail/trash surface needed to reach edit and remove — deliberately scoped down, since the fuller browse/search experience is S-02's job.

## Current State Analysis

- `recipes` (migration `20260815132912_recipe_schema.sql`) already has `deleted_at` (soft-delete) and an `updated_at` trigger. RLS already grants the owner `update`/`delete` on both `recipes` and `recipe_ingredients` (via the parent-recipe ownership check). **No schema migration is needed for this change.**
- `src/pages/api/recipes.ts` has `POST` only (photo upload → extraction → save). No `GET`.
- `src/pages/api/recipes/[id]/type.ts` is the only existing per-recipe endpoint: a narrow `PATCH` that updates just `type`, used by the post-upload type-confirmation nudge (`TypeConfirmationNudge.tsx`). It stays untouched — it serves a different UI moment (the nudge) than the general edit form this plan adds.
- `src/pages` has no recipe list or detail page — only `recipes/new.astro` (the upload flow) and `dashboard.astro`. `/recipes` is already covered by `PROTECTED_ROUTES` in `src/middleware.ts` (prefix match), so any page under it is auto-protected.
- Only `Button` is installed from shadcn/ui (`components.json`: style `new-york`). `Input` and `Dialog` are not yet added.
- The `recipe-photos` storage bucket is private with no signed-URL helper anywhere in the codebase yet — photo display belongs to S-02 (FR-018), not this change.

### Key Discoveries:

- `src/pages/api/recipes.ts:94-125` — the existing ingredient-insert pattern (`recipe_ingredients` rows with `position`) is the template for how this plan re-saves ingredients on edit.
- `src/pages/api/recipes/[id]/type.test.ts` — the vitest convention for API route tests: mock `@/lib/supabase`'s `createClient`, build a chainable mock query builder, assert on status codes and calls.
- `src/components/recipes/recipe-type-labels.ts` — `RECIPE_TYPE_VALUES` / `RECIPE_TYPE_LABELS` already exist and should be reused for the edit form's type selector.
- `src/components/recipes/PhotoUploadForm.tsx` — the established React-island convention: local status state machine, `fetch` to a typed API response union, Polish user-facing copy, shadcn `Button` + `cn()`, no external form library.

## Desired End State

A signed-in user can:
- See a list of their active (non-removed) recipes at `/recipes`, newest first.
- Open a recipe at `/recipes/[id]` and edit its name, type, and ingredient list (add/remove/reorder rows), with at least one ingredient required to save.
- Remove a recipe from `/recipes` behind a confirm dialog; it disappears from the active list.
- View removed recipes at `/recipes/trash` and restore any of them back to the active list.

Verification: manual walkthrough of add → edit → remove → restore end-to-end, plus passing automated checks per phase below.

## What We're NOT Doing

- Photo display anywhere in this change (list, detail, or edit) — no signed-URL helper exists yet; that's S-02/FR-018 scope.
- A freeform recipe note field — FR-010 is parked in the roadmap as nice-to-have; the schema has no `note` column.
- Ingredient quantity/unit as separate fields — current schema stores each ingredient as one text line; splitting that out is a separate roadmap candidate idea, not this change.
- A hard-delete / purge job for old soft-deleted recipes — recovery stays indefinite for MVP; the roadmap explicitly notes the window is "tunable later" since `deleted_at` is a timestamp column, not a hard TTL.
- Search, filtering, sorting-toggle, or pagination on the recipe list — S-02 scope; this list is a minimal newest-first surface only.
- Diff-based ingredient updates (tracking which specific rows changed) — full replace-on-save is simpler and matches the existing insert pattern; nothing today reads ingredient row history.

## Implementation Approach

Four vertical phases: backend API first (all CRUD + restore + list/trash endpoints, fully tested in isolation), then three UI phases that each consume a slice of that API — list+remove, detail+edit, trash+restore. This lets each phase be manually verified against a real endpoint rather than a mock, and keeps each phase's diff small enough to review and commit independently.

## Critical Implementation Details

### State sequencing (Phase 1 — ingredient full-replace)

When `PATCH` replaces a recipe's ingredients, insert the new rows **before** deleting the old ones (capture the old ingredient ids first, then insert new rows, then delete by the captured old ids) — not delete-then-insert. This avoids a window where the recipe has zero ingredients if the second operation fails (there's no cross-statement transaction available through the Supabase client here, so ordering is the only guard). Worst case on a failed delete is a few orphaned old rows a user could theoretically see duplicated on retry-free reload; that's an acceptable rare edge case for a single-owner recipe app and self-corrects the next time the recipe is edited.

## Phase 1: Recipe API — get, edit, remove, restore, list

### Overview

All backend surface for this change: fetching a single recipe with its ingredients, full-edit `PATCH`, soft-delete `DELETE`, restore `POST`, plus `GET` list endpoints for the active collection and the trash. No UI changes in this phase.

### Changes Required:

#### 1. Active recipe list endpoint

**File**: `src/pages/api/recipes.ts`

**Intent**: Add a `GET` handler alongside the existing `POST`, returning the signed-in user's active (non-removed) recipes, newest first, for the list page to render.

**Contract**: `GET /api/recipes` → 200 `{ recipes: { id, name, type, createdAt }[] }` for the authenticated user where `deleted_at is null`, ordered by `created_at desc`. 401 if unauthenticated, matching the existing `POST` handler's auth check.

#### 2. Recipe detail, edit, and soft-delete endpoint

**File**: `src/pages/api/recipes/[id]/index.ts` (new)

**Intent**: One endpoint file covering the three per-recipe operations that operate on the same resource: fetch for the edit page, full edit, and soft-delete.

**Contract**:
- `GET` → 200 `{ id, name, type, ingredients: string[] }` for an owned, non-deleted recipe (ingredients ordered by `position`); 404 if not found, not owned, or already soft-deleted.
- `PATCH` → body `{ name: string, type: RecipeTypeValue, ingredients: string[] }` validated with zod (`name` non-empty trimmed, `type` one of `RECIPE_TYPE_VALUES`, `ingredients` a min-length-1 array of non-empty trimmed strings). Updates `recipes.name`/`recipes.type`, then replaces `recipe_ingredients` per the ordering in "Critical Implementation Details". 400 on validation failure, 404 if not found/owned/already-deleted, 200 with the updated `{ id, name, type, ingredients }` on success.
- `DELETE` → sets `deleted_at = now()` on an owned, currently-active recipe. 404 if not found, not owned, or already deleted. 200 with `{ id }` on success.

#### 3. Restore endpoint

**File**: `src/pages/api/recipes/[id]/restore.ts` (new)

**Intent**: Reverse a soft-delete.

**Contract**: `POST /api/recipes/[id]/restore` → sets `deleted_at = null` on an owned, currently-deleted recipe. 404 if not found, not owned, or not currently deleted. 200 with `{ id }` on success.

#### 4. Trash list endpoint

**File**: `src/pages/api/recipes/trash.ts` (new)

**Intent**: List the signed-in user's soft-deleted recipes for the trash view.

**Contract**: `GET /api/recipes/trash` → 200 `{ recipes: { id, name, type, deletedAt }[] }` where `deleted_at is not null`, ordered by `deleted_at desc`. 401 if unauthenticated.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Using the browser or a REST client while signed in: `GET /api/recipes` returns only active recipes; `PATCH /api/recipes/[id]` updates name/type/ingredients and the change is visible on a subsequent `GET`; `DELETE /api/recipes/[id]` removes it from `GET /api/recipes` and it appears in `GET /api/recipes/trash`; `POST /api/recipes/[id]/restore` moves it back.

---

## Phase 2: Recipe list page

### Overview

The active-recipe list at `/recipes`, with a remove action behind a confirm dialog, and a dashboard link into it.

### Changes Required:

#### 1. Add shadcn Dialog component

**Intent**: Needed for the remove-confirmation dialog in this phase.

**Contract**: Run `npx shadcn@latest add dialog`, landing `src/components/ui/dialog.tsx`.

#### 2. Recipe list page

**File**: `src/pages/recipes/index.astro` (new)

**Intent**: Server-rendered page that fetches the signed-in user's active recipes (via `GET /api/recipes` or a direct Supabase query in frontmatter, matching `dashboard.astro`'s SSR style) and renders the `RecipeList` island with the initial data.

**Contract**: Astro page under the already-protected `/recipes` prefix; passes fetched recipes as props to `<RecipeList client:load recipes={...} />`.

#### 3. Recipe list island

**File**: `src/components/recipes/RecipeList.tsx` (new)

**Intent**: Render each active recipe with a link to `/recipes/[id]` and a "Usuń" (remove) button. Confirming the shadcn `Dialog` calls `DELETE /api/recipes/[id]` and removes the recipe from local state on success.

**Contract**: Props `{ recipes: { id: string; name: string; type: RecipeTypeValue }[] }`. Follows `PhotoUploadForm.tsx`'s status-state-machine and Polish-copy conventions.

#### 4. Dashboard link

**File**: `src/pages/dashboard.astro`

**Intent**: Add a link to `/recipes` next to the existing "Dodaj przepis ze zdjęcia" link, so the list is reachable from the app's entry point.

**Contract**: One new `<a href="/recipes">` in the existing action list, same styling as the sibling link.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Signed in, visiting `/recipes` lists the user's saved recipes newest-first.
- Clicking remove opens a confirm dialog; confirming removes the recipe from the list and it no longer appears on reload.
- The dashboard's new link navigates to `/recipes`.

---

## Phase 3: Recipe detail and edit page

### Overview

`/recipes/[id]` shows an edit form pre-filled with the recipe's current name, type, and ingredients, and saves via the Phase 1 `PATCH` endpoint.

### Changes Required:

#### 1. Add shadcn Input component

**Intent**: Needed for the name and per-ingredient text fields.

**Contract**: Run `npx shadcn@latest add input`, landing `src/components/ui/input.tsx`.

#### 2. Recipe detail/edit page

**File**: `src/pages/recipes/[id].astro` (new)

**Intent**: Server-rendered page that fetches the recipe (owned, non-deleted) via a direct Supabase query or the Phase 1 `GET` endpoint; renders a 404-equivalent (e.g. `Astro.redirect` to `/recipes` or a not-found message) when the recipe doesn't exist, isn't owned, or is soft-deleted; otherwise renders the `RecipeEditForm` island pre-filled.

**Contract**: Astro dynamic route under `/recipes`, params `{ id }`; passes the fetched recipe as props to `<RecipeEditForm client:load recipe={...} />`.

#### 3. Recipe edit form island

**File**: `src/components/recipes/RecipeEditForm.tsx` (new)

**Intent**: Editable name field, type selector (reusing `RECIPE_TYPE_LABELS`/`RECIPE_TYPE_VALUES`), and a dynamic list of ingredient text rows with add/remove/reorder controls. Blocks submit client-side when fewer than one non-empty ingredient remains (mirrors the server's `min(1)` validation). On submit, `PATCH`es `/api/recipes/[id]` and shows success/error state.

**Contract**: Props `{ recipe: { id: string; name: string; type: RecipeTypeValue; ingredients: string[] } }`. Same fetch/status-state-machine conventions as `PhotoUploadForm.tsx`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Visiting `/recipes/[id]` for an owned, active recipe shows the current name/type/ingredients pre-filled.
- Editing the name, changing the type, adding an ingredient row, and removing a different one, then saving, persists all three kinds of changes after a reload.
- Removing every ingredient row blocks save with a visible validation message.
- Visiting `/recipes/[id]` for another user's recipe, or for a recipe already in the trash, does not show the recipe (404/redirect behavior).

---

## Phase 4: Trash view and restore

### Overview

`/recipes/trash` lists soft-deleted recipes with a restore action, closing the loop on reversible removal.

### Changes Required:

#### 1. Trash page

**File**: `src/pages/recipes/trash.astro` (new)

**Intent**: Server-rendered page fetching the signed-in user's soft-deleted recipes (Phase 1's `GET /api/recipes/trash` or a direct Supabase query) and rendering the `TrashList` island.

**Contract**: Astro page under `/recipes`; passes fetched recipes as props to `<TrashList client:load recipes={...} />`.

#### 2. Trash list island

**File**: `src/components/recipes/TrashList.tsx` (new)

**Intent**: Render each removed recipe with a "Przywróć" (restore) button that calls `POST /api/recipes/[id]/restore` and removes the recipe from local state on success.

**Contract**: Props `{ recipes: { id: string; name: string; type: RecipeTypeValue }[] }`. Same conventions as `RecipeList.tsx`.

#### 3. Navigation link to trash

**File**: `src/pages/recipes/index.astro`

**Intent**: Add a link from the active list to `/recipes/trash` so removed recipes are discoverable.

**Contract**: One new `<a href="/recipes/trash">` on the list page.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Removing a recipe from `/recipes`, then visiting `/recipes/trash`, shows it listed.
- Clicking restore makes it reappear in `/recipes` and disappear from `/recipes/trash`.
- The link from `/recipes` to `/recipes/trash` works.

---

## Testing Strategy

### Unit Tests:

- Phase 1 endpoints, following `src/pages/api/recipes/[id]/type.test.ts`'s mock-`createClient` convention: auth (401), validation (400), ownership/not-found (404), and success-path assertions for `GET`/`PATCH`/`DELETE` on `[id]/index.ts`, `POST` on `[id]/restore.ts`, and `GET` on `recipes.ts` and `recipes/trash.ts`.
- Ingredient full-replace: a test asserting the insert-before-delete ordering (or at minimum that the final state contains exactly the submitted ingredient set).

### Integration Tests:

- None beyond the API unit tests above — no existing integration-test harness in this codebase to extend (the current suite is unit-level route tests only).

### Manual Testing Steps:

1. Sign in, save a recipe via the existing photo-upload flow (or use one already in the collection).
2. Visit `/recipes`, confirm it's listed.
3. Open it, edit the name, type, and ingredients (add one, remove one), save, reload, confirm all changes persisted.
4. Try saving with zero ingredients — confirm it's blocked.
5. Return to `/recipes`, remove the recipe via the confirm dialog, confirm it disappears.
6. Visit `/recipes/trash`, confirm it's listed there; restore it; confirm it's back in `/recipes` and gone from the trash.
7. As a second user (or via direct URL with a foreign recipe id), confirm `/recipes/[id]` for a recipe you don't own is inaccessible.

## Performance Considerations

None beyond existing patterns — recipe counts per user are expected to be small (personal collection), so no pagination or indexing changes are needed beyond the existing `recipes_user_id_active_idx` partial index.

## Migration Notes

None — no schema changes in this plan.

## References

- Existing per-field PATCH pattern: `src/pages/api/recipes/[id]/type.ts`
- Existing route test convention: `src/pages/api/recipes/[id]/type.test.ts`
- Existing ingredient-insert pattern: `src/pages/api/recipes.ts:94-125`
- Existing React-island conventions: `src/components/recipes/PhotoUploadForm.tsx`
- Recipe type constants: `src/components/recipes/recipe-type-labels.ts`
- Schema: `supabase/migrations/20260815132912_recipe_schema.sql`
- Roadmap slice: `context/foundation/roadmap.md` (S-03)
- PRD requirements: `context/foundation/prd.md` (FR-019, FR-020)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Recipe API — get, edit, remove, restore, list

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 Type checking passes: `npm run astro check`
- [x] 1.3 Linting passes: `npm run lint`

#### Manual

- [ ] 1.4 GET/PATCH/DELETE/restore endpoints verified end-to-end via browser or REST client

### Phase 2: Recipe list page

#### Automated

- [ ] 2.1 Type checking passes: `npm run astro check`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Build succeeds: `npm run build`

#### Manual

- [ ] 2.4 `/recipes` lists active recipes newest-first
- [ ] 2.5 Remove flow (confirm dialog → removal) works
- [ ] 2.6 Dashboard link to `/recipes` works

### Phase 3: Recipe detail and edit page

#### Automated

- [ ] 3.1 Type checking passes: `npm run astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build succeeds: `npm run build`

#### Manual

- [ ] 3.4 `/recipes/[id]` pre-fills name/type/ingredients for an owned recipe
- [ ] 3.5 Editing name, type, and ingredients (add + remove) persists after reload
- [ ] 3.6 Saving with zero ingredients is blocked
- [ ] 3.7 A foreign or soft-deleted recipe id is inaccessible at `/recipes/[id]`

### Phase 4: Trash view and restore

#### Automated

- [ ] 4.1 Type checking passes: `npm run astro check`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Build succeeds: `npm run build`

#### Manual

- [ ] 4.4 Removed recipes appear in `/recipes/trash`
- [ ] 4.5 Restore returns a recipe to `/recipes` and removes it from the trash
- [ ] 4.6 Link from `/recipes` to `/recipes/trash` works
