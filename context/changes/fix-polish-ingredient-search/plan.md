# Fix Polish Ingredient Search Implementation Plan

## Overview

Ingredient search (`listRecipes()` with a query) currently does a plain
Postgres `ilike` substring match against `recipe_ingredients.name`. It fails
whenever the searched word and the stored word differ by ordinary Polish noun
declension — e.g. searching "cukier" (nominative) does not match a recipe
whose ingredient is stored as "cukru" (genitive, e.g. "170 g cukru"). This is
roadmap `S-05` (M-02: Search and list quality hardening), the milestone's
north star, tracing to FR-015 (must-have) and US-02.

This plan adds a write-time `search_key` column on `recipe_ingredients`,
computed automatically by a Postgres trigger from a new
`normalize_polish_ingredient()` SQL function (case-suffix stripping +
diacritic folding), plus a `search_recipes_by_ingredient()` RPC that applies
the same normalization to the incoming query before matching. The trigger
means all three existing write paths (API insert, `edit_recipe()` RPC,
`seed-dev.sql`) get `search_key` populated automatically with zero changes to
their code.

## Current State Analysis

- `src/lib/services/recipe-query.ts`'s `listRecipes()`: when `params.q` is
  set, it embeds `recipe_ingredients!inner(name)` and filters with
  `.ilike("recipe_ingredients.name", "%" + escaped(query) + "%")`. No
  normalization of either side.
- `recipe_ingredients` (migration `20260815132912_recipe_schema.sql`): one
  row per ingredient, `name text not null`, no other text-processing column.
- Ingredient names are written from three places, all storing raw extracted
  or user-typed text: `POST /api/recipes` (`src/pages/api/recipes.ts:151`,
  initial save), the `edit_recipe()` RPC (delete-all-then-reinsert on every
  edit, latest version in `supabase/migrations/20260816190000_edit_recipe_instructions.sql`),
  and `supabase/seed-dev.sql`.
- No stemming/normalization infrastructure exists anywhere in the codebase —
  no `unaccent`, `pg_trgm`, or JS stemmer dependency.
- There is real production data (`SnapRecipe_live`) already saved by the
  primary user. Queried directly during planning; representative real
  ingredient values include `"170 g cukru"`, `"160 g masła w temp.
  pokojowej"`, `"190 g mąki"` / `"190g mąki"`, `"5 łyżek cukru pudra"` / `"5
  łyżek cukru pudru"`, `"2 łyżki soku z cytryny"`, `"skórka otarta z 2
  cytryn"`, `"3 jajka"`, and non-ingredient section-header rows like
  `"Polewa:"`. **Ingredient rows are full extracted lines (quantity + unit +
  noun + optional prep note), not clean single nouns** — the normalizer must
  operate safely on that free text, not assume one word per row.
- `edit_recipe()` establishes the project's RPC convention this plan follows:
  `security definer`, `set search_path = public`, an explicit
  `auth.uid()` check inside (RLS is bypassed under `security definer`, so
  ownership is enforced manually), granted to `authenticated`.
- `tests/integration/` (real Postgres, `npm run test:integration`) has an
  established pattern: `createTestUser()` from
  `tests/integration/helpers/test-client.ts`, direct `.insert()` on
  `recipes`/`recipe_ingredients`, and `user.client.rpc(...)` for calling
  RPCs (see `tests/integration/trash-restore-roundtrip.test.ts`).

## Desired End State

Searching for any common grammatical form of a Polish ingredient noun
returns recipes containing that ingredient regardless of which form was
typed or which form was stored — including without Polish diacritics.
`FR-014` (recipe name search) remains untouched and Parked; this plan is
ingredient search only.

Verify by: searching "cukier" and confirming it returns every real recipe
containing "170 g cukru"; searching "maslo" (no diacritics) matches "160 g
masła"; the type filter still combines correctly with a search query; a
query with no matches still shows the existing empty state.

### Key Discoveries:

- The `search_key` column is populated by a `BEFORE INSERT OR UPDATE OF
  name` trigger, not by application code — this is what lets all three
  write paths pick up the fix with zero TypeScript changes.
- Because `search_recipes_by_ingredient()` does the normalization
  server-side, the existing ilike-wildcard escaping in
  `recipe-query.ts` (`trimmedQuery.replace(/[\\%_]/g, ...)`) becomes dead
  code for the search-query path once it switches to the RPC, and should be
  removed rather than left stale.
- The existing `!inner`-embed pattern can return the parent recipe more than
  once if more than one of its ingredients matches; the new RPC uses `exists
  (...)` instead, which returns each matching recipe exactly once — a
  correctness improvement that falls out of the redesign rather than
  separate scope.

## What We're NOT Doing

- Not touching `FR-014` (recipe name search) — stays Parked, out of scope.
- Not building a comprehensive Polish declension engine (all 7 cases,
  vocative, dative, etc.) — targeting genitive, instrumental, and the vowel
  alternation/mobile-e patterns that actually appear in recipe ingredient
  text, per the roadmap's "common recipe-relevant cases" scoping.
- Not adding a search index (`pg_trgm`/GIN) — the table is small (single
  user, capped at 200 rows per list query today); a plain `ilike` scan on
  `search_key` is fast enough at this scale.
- Not changing `.husky/pre-commit`, CI, or any other quality-gate config.
- Not deduplicating or cleaning up existing messy production data (near-
  duplicate rows differing only by capitalization, non-ingredient
  "section header" rows like `"Polewa:"`) — a real but separate data-quality
  concern, not this bug.

## Implementation Approach

Two phases, database layer then application layer. The database layer
(migration: function + trigger + backfill + RPC + integration test) is
fully verifiable against real Postgres on its own before any application
code changes. The application layer then swaps the query-path data source
from the embedded `ilike` select to the new RPC.

## Critical Implementation Details

### Polish normalization rule design

`normalize_polish_ingredient(text) returns text` must, in order:

1. Lowercase the input.
2. Fold Polish diacritics: ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź→z, ż→z.
3. Split into whitespace/punctuation/digit-delimited tokens and process each
   alphabetic token independently (this is what makes the function safe on
   full lines like `"170 g cukru"` rather than assuming one clean noun per
   row — numbers, units, and punctuation pass through the tokenization
   boundary unaffected). Rejoin normalized tokens with a single space.
4. For each alphabetic token of length ≥ 5 (shorter tokens are left as-is —
   this is the short-word guard: it's what stops "sól" from being stripped
   into something that false-matches unrelated words, the exact imprecision
   the roadmap risk note already rejected once for a naive fix):
   - Apply the **mobile-e drop**: several common ingredient nouns insert a
     "movable e" in their nominative form that disappears in oblique cases
     — `cukier`→`cukr(u)`, `proszek`→`proszk(u)`. After stripping a
     recognized case ending (below), if the resulting stem ends in
     consonant+`e`+consonant, drop that `e` too.
   - Apply a longest-suffix-first case-ending strip table covering the
     genitive/instrumental endings that actually occur in the real
     ingredient data pulled during planning: `-ami`, `-om`, `-ów`, `-iem`,
     `-owi`, `-ie`, `-ą`, `-ę`, `-a`, `-i`, `-y`, `-u`, `-e`, `-o`.
   - These two rules together must turn every word in each pair below into
     the same stem (this is the acceptance bar for Phase 1's automated
     tests, sourced from the real production data pulled during planning):
     `cukier`/`cukru`, `masło`/`masła`, `mąka`/`mąki`, `cytryna`/`cytryny`/
     `cytryn`, `łyżka`/`łyżki`/`łyżeczka`/`łyżek`, `sok`/`soku`, `jogurt`/
     `jogurtu`, `proszek`/`proszku`.

### RPC contract

```sql
create or replace function search_recipes_by_ingredient(
  p_query text,
  p_type recipe_type default null
)
returns table (id uuid, name text, type recipe_type, photo_path text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
```

Same `auth.uid()`-check-then-filter pattern as `edit_recipe()`. Body: derive
`v_normalized_query := normalize_polish_ingredient(p_query)`, then select
distinct-by-recipe rows from `recipes r` where `r.user_id = v_user_id and
r.deleted_at is null and (p_type is null or r.type = p_type) and exists
(select 1 from recipe_ingredients ri where ri.recipe_id = r.id and
ri.search_key ilike '%' || v_normalized_query || '%')`, ordered by
`created_at desc`, capped at 200 (matching `LIST_RESULT_CAP` in
`recipe-query.ts` — keep the two in sync). Grant execute to `authenticated`.

## Phase 1: Database layer — normalization function, trigger, backfill, RPC

### Overview

Everything needed to make grammatical-case-insensitive matching work is
verifiable against real Postgres in this phase alone, independent of any
application code change.

### Changes Required:

#### 1. Migration: normalization function, `search_key` column, sync trigger, backfill, search RPC

**File**: `supabase/migrations/<timestamp>_polish_ingredient_search.sql`
(stamp `<timestamp>` with the real creation time, `YYYYMMDDHHmmss`, per this
project's migration-naming convention)

**Intent**: Add everything needed for grammatical-case matching without
touching any of the three existing write paths in application code.

**Contract**:
- `normalize_polish_ingredient(text) returns text`, `language plpgsql
  immutable`, implementing the rule design above.
- `alter table recipe_ingredients add column search_key text;`
- A `before insert or update of name on recipe_ingredients` trigger that
  sets `new.search_key := normalize_polish_ingredient(new.name)`.
- Backfill: `update recipe_ingredients set search_key =
  normalize_polish_ingredient(name);` (forward-only migration, no down
  migration, matching every prior migration in this project).
- `search_recipes_by_ingredient()` per the RPC contract above, plus `grant
  execute on function search_recipes_by_ingredient(text, recipe_type) to
  authenticated;`.

#### 2. Integration test: real-Postgres declension matching

**File**: `tests/integration/polish-ingredient-search.test.ts`

**Intent**: Verify the actual SQL (not a JS approximation of it) correctly
matches every declension pair against real production-shaped ingredient
text, using this project's established integration-test pattern
(`createTestUser()`, direct `.insert()`, `user.client.rpc(...)`).

**Contract**: For each pair in the acceptance list above, insert a recipe
whose ingredient stores one form (e.g. `"170 g cukru"`) and assert
`search_recipes_by_ingredient` with the other form (e.g. `"cukier"`) as
`p_query` returns that recipe — and vice versa (query with the stored form
too, confirming the trigger populated `search_key` correctly on insert).
Also assert: a short word like `"sól"` is not over-matched (searching a
short unrelated word doesn't return it); combining `p_type` with `p_query`
narrows correctly; a non-matching query returns an empty set, not an error.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Integration test passes: `npm run test:integration`
- Lint passes: `npm run lint`

#### Manual Verification:

- Inspect a few real rows in the local dev DB after the backfill runs and
  confirm `search_key` looks like a sane normalized form (spot-check, not
  exhaustive).

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Application layer — wire `listRecipes()` to the new RPC

### Overview

Switch the search-query path of `listRecipes()` from the embedded `ilike`
select to `search_recipes_by_ingredient`; leave the no-query/type-only path
untouched.

### Changes Required:

#### 1. Query path

**File**: `src/lib/services/recipe-query.ts`

**Intent**: When `params.q` is set, call the new RPC instead of the
embedded-`ilike` select; keep the no-query branch exactly as it is today.

**Contract**: In `listRecipes()`, branch on `hasQuery`: the existing
`.from("recipes").select(...)` path stays for the no-query/type-only case;
the query-present case instead calls `supabase.rpc("search_recipes_by_ingredient",
{ p_query: trimmedQuery, p_type: params.type ?? null })`, and its returned
rows feed into the same `signPhotoUrls` + row-mapping logic already present
(no change needed there — both paths must keep returning the same
`RecipeRow`-shaped rows). Remove the now-dead ilike-wildcard-escaping code
(`trimmedQuery.replace(/[\\%_]/g, ...)`), since normalization already strips
non-letter characters during tokenization.

#### 2. Unit tests

**File**: `src/lib/services/recipe-query.test.ts`

**Intent**: Match the new call shape — the two existing tests asserting
`ilike`/`select` behavior for the query path (`"filters by ingredient..."`
and `"escapes ilike wildcard characters..."`) need to assert an `rpc(...)`
call instead. The no-query tests (soft-delete/user scoping, type-only
filter, error handling, photo-URL mapping) are unaffected and stay as-is.

**Contract**: Extend the mock `SupabaseClient` fixture with an `rpc` mock
returning `{ data: [...], error: null }`; replace the two query-path
assertions to check `client.rpc` was called with `"search_recipes_by_ingredient"`
and the expected `{ p_query, p_type }` args; add one new test asserting the
mapped result shape when the RPC returns rows (mirrors the existing
"maps rows to summaries..." test but via the RPC path).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- In the running app, search "cukier" and confirm a recipe stored with
  "cukru" appears in results.
- Search "maslo" (no diacritics) and confirm a recipe stored with "masła"
  appears.
- Combine a search query with the type filter and confirm results narrow
  correctly.
- Search a term with zero matches and confirm the existing empty-state UI
  still renders (no regression, no error).

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- `recipe-query.test.ts`: RPC-call shape for the search-query path; no-query
  path stays covered by its existing tests.

### Integration Tests:

- `polish-ingredient-search.test.ts`: real-Postgres declension-pair matching
  against `search_recipes_by_ingredient`, short-word guard, type+query
  combination, empty-result case.

### Manual Testing Steps:

1. After Phase 1's backfill, spot-check a few real `search_key` values in
   local dev.
2. After Phase 2, search "cukier" in the running app and confirm a
   "cukru"-stored recipe appears.
3. Search "maslo" (no diacritics) and confirm a "masła"-stored recipe
   appears.
4. Combine search + type filter; confirm narrowing still works.
5. Search a non-matching term; confirm the existing empty state, not an
   error.

## Performance Considerations

No new index — table size (single user, ≤200 rows per query today) makes a
plain `ilike` scan on `search_key` fast enough; revisit if the collection
grows into the thousands (already flagged as a separate Candidate Idea in
the roadmap — pagination).

## Migration Notes

Forward-only migration (no down migration), consistent with every prior
migration in this project. The backfill (`update recipe_ingredients set
search_key = ...`) runs once, in the same migration, over existing rows
including the real production data on `SnapRecipe_live`.

## References

- Roadmap: `context/foundation/roadmap.md`, slice `S-05` (M-02 north star)
- Existing RPC convention: `supabase/migrations/20260816190000_edit_recipe_instructions.sql`
- Existing integration-test pattern: `tests/integration/trash-restore-roundtrip.test.ts`,
  `tests/integration/helpers/test-client.ts`
- Query path being changed: `src/lib/services/recipe-query.ts:46-92`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database layer — normalization function, trigger, backfill, RPC

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — e05935f
- [x] 1.2 Integration test passes: `npm run test:integration` — e05935f
- [x] 1.3 Lint passes: `npm run lint` — e05935f

#### Manual

- [x] 1.4 Spot-check backfilled `search_key` values in local dev — e05935f

### Phase 2: Application layer — wire `listRecipes()` to the new RPC

#### Automated

- [x] 2.1 Unit tests pass: `npm run test`
- [x] 2.2 Lint passes: `npm run lint`

#### Manual

- [x] 2.3 Search "cukier" finds a "cukru"-stored recipe
- [x] 2.4 Search "maslo" (no diacritics) finds a "masła"-stored recipe
- [x] 2.5 Search + type filter combination still narrows correctly
- [x] 2.6 Non-matching search shows the existing empty state, not an error
