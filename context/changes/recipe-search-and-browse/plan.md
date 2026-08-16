# Recipe Search, Type Filter, and Detail View — Implementation Plan

## Overview

Roadmap slice **S-02**: let a user browse their saved recipe collection (empty-query state),
search it by ingredient, narrow results by meal type, and open a recipe's full detail view.
This is the first read path for `recipes`/`recipe_ingredients` — everything shipped so far
(S-01) only writes.

## Current State Analysis

- `recipes` and `recipe_ingredients` tables, RLS, and the private `recipe-photos` bucket exist
  (F-02, archived). `recipes` has a soft-delete column (`deleted_at`) that **RLS does not
  filter** — every query this plan writes must add `.is("deleted_at", null)` explicitly. A
  partial index `recipes_user_id_active_idx on recipes(user_id) where deleted_at is null`
  already anticipates this query shape.
- `recipe_ingredients` has no `user_id` column — ownership is only provable via a join/embed
  against `recipes`.
- `src/pages/dashboard.astro` is a placeholder (just email + sign-out + a link to
  `/recipes/new`) — no listing exists yet. `src/pages/recipes/[id].astro` does not exist.
  `/recipes` is already in `middleware.ts`'s `PROTECTED_ROUTES`, so any page under it is
  auto-protected with no middleware change needed.
- `src/pages/api/recipes.ts` currently exports `POST` only (photo-upload create).
  `src/pages/api/recipes/[id]/type.ts` is the only existing dynamic-route example — it
  establishes the "RLS-miss → 404, not 403" convention (no row = not found, regardless of
  whether it's someone else's row or doesn't exist).
- No GET routes exist anywhere under `/api/recipes`. No query pattern beyond a plain `.insert()`
  exists yet in this codebase — this plan introduces the first `.select()/.ilike()/.order()`
  query and the first Supabase Storage signed-URL usage (the bucket is private; there is no
  `getPublicUrl`/`createSignedUrl(s)` call anywhere in `src/` yet).
- `src/components/recipes/recipe-type-labels.ts` already has `RECIPE_TYPE_VALUES` (for zod
  validation) and `RECIPE_TYPE_LABELS` (Polish display labels) — reuse both, don't recreate.
- Only `Button` exists in `src/components/ui/`. No `Input`/`Card`/`Select`/empty-state
  primitive exists yet.
- All Polish UI copy so far is hardcoded inline or in small `Record<Key, string>` maps
  colocated with the feature (`recipe-type-labels.ts`, `extraction-failure-copy.ts`) — no i18n
  library. Follow the same colocation pattern for new copy.
- No data-fetching library (no TanStack Query/SWR) — `PhotoUploadForm.tsx` is the canonical
  React-island pattern: local `useState`, raw `fetch` in handlers, discriminated-union response
  typing, Polish copy inline, `lucide-react` icons for loading/error/success states.

## Desired End State

A logged-in user visiting `/recipes` sees their full collection (newest first) with no query
entered. Typing an ingredient narrows the list to recipes containing an ingredient matching
that text; picking a meal-type chip narrows further; both combine. A zero-result state explains
why (searched-but-empty vs. truly-empty collection get different copy). Tapping a card opens
`/recipes/[id]`, showing the recipe's name, type, photo, and full ingredient list.

Verify by: `npm run build` + `npm run lint` pass; `npm run test` (vitest) passes with new route
test coverage; manual walkthrough (listed per phase, batched by the user at the end per this
run's directive).

### Key Discoveries:

- `recipes_user_id_active_idx` (migration `20260815132912_recipe_schema.sql:39`) confirms the
  intended hot-path query is `where user_id = ? and deleted_at is null` — this plan's list
  query matches that shape exactly.
- `recipe-data-schema`'s plan explicitly decided against a trigram/GIN index at this data
  volume (PRD: low QPS, personal per-user collections) — a plain `ilike` is sufficient; this
  plan does not add one either.
- `type.ts:38-47` establishes: query with RLS active, map "no row returned" to 404. The new
  detail read follows the same shape.
- FR-018 requires the detail view to show a "note", but no `note` column exists anywhere in
  the schema (FR-010, which would add it, is parked) — see "What We're NOT Doing".

## What We're NOT Doing

- **No `note` field in the detail view.** FR-018 lists it, but the schema has no `note` column
  (FR-010 is parked/nice-to-have and unshipped). Revisit when FR-010 lands a migration.
- **No name search (FR-014)** — explicitly parked in the PRD; only ingredient search (FR-015)
  and type filter (FR-016) are must-have discovery paths.
- **No sort toggle (FR-017)** — parked; default order is always newest-first.
- **No pagination/infinite scroll UI.** Given per-user collection size at this stage, the list
  query takes a flat safety cap (`limit(200)`) instead of real pagination. Revisit if a
  collection realistically approaches that size.
- **No new search index** (trigram/GIN) — consistent with the schema plan's existing call at
  this data volume.
- **No edit/remove UI** — that's S-03 (`recipe-edit-and-remove`), a separate change.
- **No standalone `GET /api/recipes/[id]` API endpoint.** The detail page is pure Astro SSR
  (no client-side interactivity needed on that screen) and calls the shared query service
  directly — there's no caller that needs it over HTTP. Add one later only if a real
  client-side consumer shows up.

## Implementation Approach

Backend-then-frontend, in 3 phases. A new `src/lib/services/recipe-query.ts` module owns all
recipe-read query building (list + detail + photo signing) so the logic is written once and
called both from the SSR Astro frontmatter (initial paint, no network round-trip to the app's
own API) and from the `GET /api/recipes` route (client-side re-search/re-filter after the
initial load). This is a new precedent for this codebase — existing services
(`recipe-extraction.ts`) don't touch Supabase directly — justified here because the same query
logic has two real call sites (SSR page + API route), not just one.

The browse screen is an Astro page that server-renders the initial (unfiltered) list, hydrating
a React island (`RecipeBrowser`) for the interactive parts (debounced ingredient search, type
filter chips, re-fetching via `GET /api/recipes`) — static shell, React only where interaction
lives, per project convention. The detail screen has no interactive parts and is pure Astro SSR.

Type filter uses a horizontal row of toggle `Button`s (the 8 fixed `recipe_type` values, reusing
`RECIPE_TYPE_LABELS`) rather than a `Select` dropdown — better one-handed mobile ergonomics
(PRD secondary success criterion) for a small fixed set of options, and avoids installing a new
shadcn primitive for a single closed enum.

## Critical Implementation Details

- **Soft-delete filter is easy to forget and RLS won't catch it.** Every read this plan adds
  (list query, detail query) must explicitly add `.is("deleted_at", null)` — RLS on `recipes`
  only checks `user_id`, so a soft-deleted row is otherwise still visible to its owner.
- **Ingredient-match query is a non-obvious PostgREST shape.** Matching "recipes that have an
  ingredient like X" without a raw SQL query uses an embedded-resource inner-join filter:
  `.select("*, recipe_ingredients!inner(name)").ilike("recipe_ingredients.name", `%${q}%`)`.
  Only rows in `recipe_ingredients` matching the filter are embedded — this is fine for the
  list view (which doesn't display the ingredient list, only name/type/photo), but do not reuse
  this exact select for the detail view, which needs *all* ingredients regardless of match.
- **Signed URLs must degrade gracefully, not fail the whole request.** Use
  `supabase.storage.from("recipe-photos").createSignedUrls(paths, 3600)` (plural, batched — one
  call for the whole list, not N calls). If an individual entry in the response has an `error`,
  set that recipe's `photoUrl` to `null` rather than failing the list request — a broken photo
  should degrade to "no image" in the UI, not a 500.

## Phase 1: Recipe query service + list search API

### Overview

Add `src/lib/services/recipe-query.ts` with `listRecipes()` (search + filter + soft-delete
exclusion + batched signed photo URLs), the `RecipeSummaryDto` type, and wire it into a new
`GET` export on the existing `src/pages/api/recipes.ts`.

### Changes Required:

#### 1. Recipe DTO type

**File**: `src/types.ts`

**Intent**: Give the list API and the SSR browse page a shared, hand-written response shape —
the file currently only has Supabase-generated types, per `CLAUDE.md`'s "shared types go in
`src/types.ts`" convention.

**Contract**: Append below the generated section:
```ts
export interface RecipeSummaryDto {
  id: string;
  name: string;
  type: Enums<"recipe_type">;
  createdAt: string;
  photoUrl: string | null;
}
```

#### 2. Recipe query service

**File**: `src/lib/services/recipe-query.ts`

**Intent**: Own the list-query logic (ingredient search, type filter, soft-delete exclusion,
newest-first order, safety-capped result count, batched photo-URL signing) in one place so both
the SSR page (Phase 2) and the API route below call the same code.

**Contract**: `listRecipes(supabase: SupabaseClient<Database>, userId: string, params: { q?: string; type?: RecipeTypeValue }): Promise<RecipeSummaryDto[]>`.
- Base query: `.from("recipes").select("*, recipe_ingredients!inner(name)")` when `q` is
  present and non-empty after trim (apply `.ilike("recipe_ingredients.name", \`%${q}%\`)`);
  `.select("*")` (no embed) when `q` is absent — avoids an unnecessary inner join on the
  unfiltered/type-only-filtered path.
- Always: `.eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: false }).limit(200)`.
- When `type` present: `.eq("type", type)`.
- After the query resolves, batch-sign photos: collect `photo_path` from all returned rows,
  call `createSignedUrls` once, map results back by path (see Critical Implementation Details
  for the graceful-degradation contract), and shape each row into `RecipeSummaryDto`.

#### 3. List API route

**File**: `src/pages/api/recipes.ts`

**Intent**: Expose the search/browse/filter capability over HTTP for the client-side island's
re-fetches (initial load is SSR, not this route — see Phase 2).

**Contract**: Add `export const GET: APIRoute`. Auth check (401) and `createClient` null-check
(503) match the existing `POST` handler exactly (same file, same helpers). Parse `q` (optional
string, trimmed, capped at 200 chars) and `type` (optional, validated against
`RECIPE_TYPE_VALUES` from `recipe-type-labels.ts` via zod, 400 on an invalid value) from
`context.url.searchParams`. Call `listRecipes(supabase, user.id, { q, type })`. Respond
`200 { recipes: RecipeSummaryDto[] }`.

#### 4. Route tests

**File**: `src/pages/api/recipes.test.ts`

**Intent**: Extend the existing test file (same convention as the current `POST` tests —
mocked chainable Supabase client, `makeContext` helper) with `GET` coverage.

**Contract**: Cases: 401 when unauthenticated; empty query returns all of the user's
non-deleted recipes; `q` param triggers the `recipe_ingredients!inner` + `ilike` chain; `type`
param triggers `.eq("type", ...)`; invalid `type` value returns 400; soft-deleted rows are
excluded (assert `.is("deleted_at", null)` was called).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes
- `npm run test -- recipes.test` passes (new GET cases + existing POST cases still green)

#### Manual Verification:

- `GET /api/recipes` (authenticated, browser devtools or curl with a session cookie) returns
  the seeded/test user's recipes, newest first
- `GET /api/recipes?q=<known ingredient>` returns only recipes containing that ingredient
- `GET /api/recipes?type=soup` returns only soup-type recipes
- A soft-deleted recipe (if any test data has one) never appears

---

## Phase 2: Browse & search UI

### Overview

Turn `/recipes` into the collection/search screen: an Astro page that SSR-renders the initial
unfiltered list via `listRecipes()`, hydrating a `RecipeBrowser` React island for debounced
ingredient search, type-filter chips, and empty states. Link to it from the dashboard.

### Changes Required:

#### 1. Browse page

**File**: `src/pages/recipes/index.astro`

**Intent**: SSR the first paint (no client round-trip needed for the default view) and hand off
interactivity to the island.

**Contract**: Frontmatter calls `createClient` + `listRecipes(supabase, user.id, {})` (mirrors
the auth/503 handling already used on other pages/routes) and passes the result as the
`initialRecipes` prop to `<RecipeBrowser client:load initialRecipes={recipes} />`.

#### 2. Recipe type filter chip data

Reuse `RECIPE_TYPE_VALUES` / `RECIPE_TYPE_LABELS` from
`src/components/recipes/recipe-type-labels.ts` — no new file.

#### 3. Browse island

**File**: `src/components/recipes/RecipeBrowser.tsx`

**Intent**: The interactive search/filter/list experience — debounced text input, an "Wszystkie"
+ 8 type chips row (using the existing `Button` component's active/inactive variant), a
recipe-card grid, and two distinct empty states (never-had-any-recipes vs. zero-matches).

**Contract**: `client:load` React component. Local state: `query`, `activeType`,
`recipes: RecipeSummaryDto[]` (seeded from `initialRecipes`), `status: "idle" | "loading" |
"error"`. A `useEffect` debounces `query`/`activeType` changes (~300ms) and calls
`fetch(\`/api/recipes?q=${query}&type=${activeType ?? ""}\`)`, replacing `recipes` on success.
Follows `PhotoUploadForm.tsx`'s raw-fetch-in-handler pattern — no new data-fetching dependency.
Each card links to `/recipes/${id}`.

#### 4. Recipe card + empty-state copy

**File**: `src/components/recipes/RecipeCard.tsx`, `src/components/recipes/browse-copy.ts`

**Intent**: `RecipeCard` renders one recipe's thumbnail/name/type badge. `browse-copy.ts` holds
the two empty-state message pairs (title + hint), following the `extraction-failure-copy.ts`
colocated-copy-map convention.

**Contract**: `RecipeCard({ recipe: RecipeSummaryDto })`. Empty state selection: if
`initialRecipes.length === 0 && !query && !activeType` → "brak przepisów, dodaj pierwszy"
(links to `/recipes/new`); if the current (possibly filtered) `recipes` list is empty but the
collection isn't → "nie znaleziono, spróbuj innego wyszukiwania".

#### 5. shadcn primitives

Install `Input` and `Card` via `npx shadcn@latest add input card` (per `CLAUDE.md`) —
`RecipeBrowser`'s search box and `RecipeCard`'s layout use them instead of hand-rolled markup.

#### 6. Dashboard link

**File**: `src/pages/dashboard.astro`

**Intent**: Give the user a way to reach the new screen.

**Contract**: Add a link to `/recipes` (Polish label, e.g. "Twoje przepisy") alongside the
existing "Dodaj przepis ze zdjęcia" link.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- `/recipes` with an empty collection shows the "no recipes yet" empty state with a working
  link to `/recipes/new`
- `/recipes` with recipes shows them newest-first with photos
- Typing a known ingredient narrows the list within ~300ms; clearing the input restores the
  full list
- Selecting a type chip narrows results; combining a chip + search query narrows further
- A search with no matches shows the "no results" empty state, not a blank screen
- Works one-handed on a phone-width viewport (no horizontal scroll, chips wrap or scroll
  cleanly, tap targets are reasonably sized)

---

## Phase 3: Recipe detail view

### Overview

Add `/recipes/[id]` — a pure Astro SSR page showing the recipe's name, type, photo, and full
ingredient list, reached by tapping a card from Phase 2.

### Changes Required:

#### 1. Detail DTOs

**File**: `src/types.ts`

**Intent**: Shape for the full detail read (adds the ingredient list, which the list DTO
intentionally omits).

**Contract**: Append:
```ts
export interface RecipeIngredientDto {
  id: string;
  name: string;
  position: number;
}

export interface RecipeDetailDto {
  id: string;
  name: string;
  type: Enums<"recipe_type">;
  createdAt: string;
  photoUrl: string | null;
  ingredients: RecipeIngredientDto[];
}
```

#### 2. Detail query function

**File**: `src/lib/services/recipe-query.ts`

**Intent**: Add the single-recipe read, kept in the same service module as `listRecipes()`
since both are recipe-read queries used by SSR pages.

**Contract**: `getRecipeDetail(supabase, userId: string, recipeId: string): Promise<RecipeDetailDto | null>`.
Query `recipes` by `id` + `user_id` + `deleted_at is null` (same ownership/soft-delete
discipline as `listRecipes`), joined with **all** `recipe_ingredients` for that recipe (no
`ilike` filter — unlike the list query's embed, this one is unfiltered), ordered by
`position`. Returns `null` on no-row (caller maps to 404, matching `type.ts`'s existing
RLS-miss-is-404 convention) — sign exactly one photo path via `createSignedUrl` (singular; only
one recipe here, no need for the batched form).

#### 3. Detail page

**File**: `src/pages/recipes/[id].astro`

**Intent**: Render the full recipe. `note` is intentionally not rendered — see "What We're NOT
Doing".

**Contract**: Frontmatter: auth/503 handling (same as other pages), read `Astro.params.id`, call
`getRecipeDetail`; `null` → `Astro.rewrite` or `return new Response(null, { status: 404 })`
(follow whatever 404 pattern other Astro pages in this repo already use, if any — otherwise a
minimal "nie znaleziono" 404 page is acceptable). Render name (heading), type (Polish label from
`RECIPE_TYPE_LABELS`), photo (`<img>`, fallback to a placeholder block if `photoUrl` is `null`),
and the ingredient list (`<ul>`, ordered by `position`). Include a back link to `/recipes`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Opening a card from `/recipes` lands on its detail page showing the correct name, type,
  photo, and full ingredient list (not just the matched ingredient from a search)
- Visiting another user's recipe id (or a nonexistent id) returns a 404, not the recipe
- Visiting a soft-deleted recipe's id (if reachable) returns a 404
- Back link returns to `/recipes`

---

## Testing Strategy

### Unit/Integration Tests:

- Phase 1's extended `recipes.test.ts` covers the list API's auth, search, filter, and
  soft-delete-exclusion behavior via the existing mocked-Supabase-client convention.

### Manual Testing Steps:

1. Seed or use existing dev-project recipes across at least two different `recipe_type` values
   and with distinguishable ingredients.
2. Walk through Phase 1-3's manual verification bullets in order (list → search/filter UI →
   detail view), on both desktop and a phone-width viewport.
3. Confirm cross-user isolation: a second test user sees none of the first user's recipes via
   `/recipes` or by guessing a `/recipes/[id]` URL.

## Performance Considerations

`limit(200)` is a flat safety cap, not real pagination — acceptable at current expected
collection sizes (PRD: low QPS, per-user personal collections). No new index added; the
existing `recipes_user_id_active_idx` partial index already covers the hot path.

## Migration Notes

No schema migration in this plan — no new tables, no new columns. Purely new read queries
against the existing F-02 schema.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-02)
- PRD refs: FR-013, FR-015, FR-016, FR-018, US-02 (`context/foundation/prd.md`)
- Prior change: `context/archive/2026-08-15-recipe-data-schema/` (F-02 — schema this plan reads)
- Prior change: `context/archive/2026-08-15-photo-to-recipe-save/` (S-01 — establishes the
  React-island + raw-fetch UI pattern and the API route conventions this plan follows)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Recipe query service + list search API

#### Automated

- [x] 1.1 `npm run lint` passes — ff07c5c
- [x] 1.2 `npm run build` passes — ff07c5c
- [x] 1.3 `npm run test -- recipes.test` passes — ff07c5c

#### Manual

- [ ] 1.4 `GET /api/recipes` returns the user's recipes, newest first
- [ ] 1.5 `GET /api/recipes?q=<ingredient>` returns only matching recipes
- [ ] 1.6 `GET /api/recipes?type=soup` returns only that type
- [ ] 1.7 Soft-deleted recipes never appear

### Phase 2: Browse & search UI

#### Automated

- [x] 2.1 `npm run lint` passes — 3bed857
- [x] 2.2 `npm run build` passes — 3bed857

#### Manual

- [ ] 2.3 Empty collection shows "no recipes yet" state with working link to `/recipes/new`
- [ ] 2.4 Non-empty collection lists recipes newest-first with photos
- [ ] 2.5 Ingredient search narrows results within ~300ms; clearing restores full list
- [ ] 2.6 Type chip narrows results; chip + search combine
- [ ] 2.7 Zero-match search shows the "no results" state, not blank
- [ ] 2.8 Works one-handed on a phone-width viewport

### Phase 3: Recipe detail view

#### Automated

- [x] 3.1 `npm run lint` passes
- [x] 3.2 `npm run build` passes

#### Manual

- [ ] 3.3 Card tap opens correct detail page with full ingredient list
- [ ] 3.4 Another user's/nonexistent recipe id returns 404
- [ ] 3.5 Soft-deleted recipe id returns 404
- [ ] 3.6 Back link returns to `/recipes`
