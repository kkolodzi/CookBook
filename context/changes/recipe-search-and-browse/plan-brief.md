# Recipe Search, Type Filter, and Detail View — Plan Brief

> Full plan: `context/changes/recipe-search-and-browse/plan.md`

## What & Why

Let a user browse their saved recipe collection, search it by ingredient, filter by meal type,
and open a recipe's full detail view. This is Roadmap slice S-02 — the first read path against
the `recipes`/`recipe_ingredients` schema landed by F-02; everything shipped so far (S-01) only
writes.

## Starting Point

`/recipes/new` (photo upload → save) exists and works. `/recipes` and `/recipes/[id]` don't
exist yet — the dashboard is a placeholder with no listing. No GET routes exist under
`/api/recipes`. No search/filter/detail UI exists.

## Desired End State

Visiting `/recipes` shows the full collection (newest first) with no query entered. Typing an
ingredient narrows results to recipes that actually contain it (not a full-text guess); picking
a meal-type chip narrows further; both combine. Tapping a card opens `/recipes/[id]` with the
recipe's name, type, photo, and full ingredient list.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Search UX | Debounced live search via a React island (`RecipeBrowser`), not full-page reload | Matches the PRD's mobile one-handed usability goal and the codebase's existing island pattern | Plan |
| Type filter UI | Button-chip row (8 fixed values), not a `Select` dropdown | Better one-handed mobile ergonomics for a small closed enum; avoids installing a new primitive | Plan |
| Query logic ownership | New `src/lib/services/recipe-query.ts`, called by both the SSR page and the API route | Same query logic has two real call sites; first Supabase-touching service in this codebase, justified by actual reuse | Plan |
| Detail view API | No standalone `GET /api/recipes/[id]` — detail page calls the service directly | No client-side consumer needs it over HTTP; avoids unused surface | Plan |
| FR-018 "note" field | Omit from detail view | No `note` column exists yet (FR-010 is parked) — nothing to display | Plan |
| Soft-delete handling | Explicit `.is("deleted_at", null)` on every new query | RLS doesn't filter it; the existing partial index anticipates this exact filter | Plan |
| Photo URLs | Batched `createSignedUrls` for the list, single `createSignedUrl` for detail; failures degrade to `null`, never fail the request | Bucket is private, no public URL exists; graceful degradation over a broken list | Plan |
| Search index | None added (plain `ilike`) | Consistent with the schema plan's existing call at this data volume (low QPS, personal collections) | Plan |
| Pagination | Flat `limit(200)` safety cap, no real pagination UI | Personal collections aren't expected to approach that size yet; avoids scope creep | Plan |

## Scope

**In scope:** browse (empty-query state), ingredient search, type filter, recipe detail view,
new `GET /api/recipes` route, `recipe-query.ts` service, `RecipeBrowser`/`RecipeCard` React
components, dashboard nav link.

**Out of scope:** name search (FR-014, parked), sort toggle (FR-017, parked), note display
(FR-010 unshipped), edit/remove (S-03, separate change), pagination UI, new search indexes,
standalone detail API route.

## Architecture / Approach

Backend-then-frontend. Phase 1 builds the shared query service + list API. Phase 2 builds the
SSR browse page + interactive search/filter island. Phase 3 builds the pure-SSR detail page,
reusing the same service.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Recipe query service + list search API | `GET /api/recipes` with search/filter/photo-signing | The embedded-resource `ilike` join is a non-obvious PostgREST shape |
| 2. Browse & search UI | `/recipes` page + debounced search/filter island | Mobile one-handed usability (PRD secondary criterion) |
| 3. Recipe detail view | `/recipes/[id]` page | 404-vs-403 handling for cross-user/soft-deleted ids |

**Prerequisites:** S-01 (done, gives at least one saved recipe to search against).
**Estimated effort:** ~3 phases, single autonomous implementation run.

## Open Risks & Assumptions

- Mobile one-handed usability is a PRD secondary success criterion but hasn't been validated on
  a real device — this plan's chip-row and debounced-search choices target it, but real-device
  validation is a manual step, not something automated checks confirm.
- No existing 404 pattern was confirmed in this codebase for Astro pages (only API routes have
  an established RLS-miss → 404 convention) — Phase 3 picks a minimal approach and documents it
  rather than blocking on discovering a nonexistent precedent.

## Success Criteria (Summary)

- A user can find a saved recipe by typing any of its ingredients and can also browse the full
  collection with an empty search.
- Filtering by type narrows results correctly, alone or combined with a search term.
- Tapping through from a search/browse result shows the recipe's full details.
