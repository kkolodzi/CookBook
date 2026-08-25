# Fix Polish Ingredient Search — Plan Brief

> Full plan: `context/changes/fix-polish-ingredient-search/plan.md`

## What & Why

Ingredient search (FR-015) is a plain substring `ilike` match with no
stemming, so it fails whenever the searched word and the stored word differ
by Polish noun declension — searching "cukier" doesn't match a recipe
storing "cukru". This is roadmap `S-05`, the north star of M-02 (Search and
list quality hardening): it protects the core "find by ingredient" promise
(US-02) that M-01 already shipped and proved works.

## Starting Point

`listRecipes()` in `src/lib/services/recipe-query.ts` embeds
`recipe_ingredients!inner(name)` and filters with a raw `ilike` on the
unmodified stored text. No normalization exists anywhere in the codebase —
no `unaccent`, `pg_trgm`, or JS stemmer dependency. Real production data
(queried directly during planning) shows ingredient rows are full extracted
lines like `"170 g cukru"`, not clean single nouns — the fix has to work on
that free text.

## Desired End State

Searching for any common grammatical form of a Polish ingredient noun
(with or without diacritics) returns every recipe containing it, regardless
of which form was typed or stored. Recipe name search (FR-014) stays
untouched and Parked.

## Key Decisions Made

| Decision                        | Choice                                     | Why (1 sentence)                                                                                          | Source |
| -------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| Architecture                     | Write-time `search_key` column + trigger    | A Postgres trigger auto-populates it on every insert/update, so all 3 existing write paths get the fix for free — no TS write-path changes. | Plan   |
| Where normalization runs         | Postgres SQL function, called from a search RPC | Query and stored text must be normalized identically; an RPC (mirroring the existing `edit_recipe()` pattern) keeps that logic in one place. | Plan   |
| Declension coverage              | Common recipe-relevant cases (genitive, instrumental, mobile-e) | Matches the real bug report and real data, not a full 7-case grammatical engine. | Plan   |
| Diacritics                       | Fold as part of the same fix                | Same root cause (plain substring match); near-free to add alongside case matching; common mobile-typing failure. | Plan   |
| Short-word safety                | Minimum-length guard (≥5 letters) before stripping | Prevents over-matching on short words like "sól" — the exact imprecision a prior naive fix was rejected for. | Plan   |
| Testing                          | Unit tests (TS call shape) + integration test (real Postgres) | Verifies the actual SQL behaves correctly, not a JS approximation of it. | Plan   |
| Acceptance bar                   | Named pairs (cukier/cukru, masło/masła) + real production data | Directly closes the reported gap and validates against real usage. | Plan   |
| Backfill                         | Forward-only migration, no down migration   | Consistent with every prior migration in this project.                                                     | Plan   |
| Name search (FR-014)             | Out of scope, untouched                     | Matches the roadmap's exact north-star scoping — no scope creep into a deliberately-Parked nice-to-have.   | Plan   |

## Scope

**In scope:**
- New `normalize_polish_ingredient()` Postgres function (case-suffix stripping + diacritic folding + short-word guard).
- `search_key` column on `recipe_ingredients`, kept in sync by a trigger.
- Backfill of existing rows, including real production data.
- New `search_recipes_by_ingredient()` RPC.
- `listRecipes()` search-query path switched to the RPC.
- Integration test (real Postgres) + unit test updates.

**Out of scope:**
- `FR-014` recipe name search.
- A comprehensive/full Polish declension engine.
- A search index (`pg_trgm`/GIN) — table is small enough for a plain scan.
- Cleaning up unrelated data-quality issues found in real data (near-duplicate rows, non-ingredient "section header" rows).

## Architecture / Approach

Postgres does all the work: a `BEFORE INSERT OR UPDATE OF name` trigger
computes `search_key` via the normalization function, so every write path
(API insert, `edit_recipe()` RPC, seed data) gets the fix automatically. A
new `search_recipes_by_ingredient()` RPC normalizes the incoming query the
same way and matches it against `search_key`, mirroring the existing
`edit_recipe()` security-definer convention. The app layer just swaps its
data source for the search-query path from an embedded `ilike` select to
this RPC — the no-query/type-only path is untouched.

## Phases at a Glance

| Phase                                                     | What it delivers                                                    | Key risk                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Database layer — function, trigger, backfill, RPC        | Grammatical-case matching verified against real Postgres, independent of app code | Getting the mobile-e/vowel-alternation suffix rules wrong for the named acceptance pairs |
| 2. Application layer — wire `listRecipes()` to the new RPC   | Search UI actually benefits from the fix                                | Regressing the existing type-filter combination or empty-state behavior      |

**Prerequisites:** None — builds on already-shipped `F-01`/`F-02`/`S-01`/`S-02`.
**Estimated effort:** 2 phases, each independently verifiable and committable.

## Open Risks & Assumptions

- The curated suffix-rule table targets common recipe-relevant cases, not a linguistically complete Polish stemmer — an unusual declension pattern could still slip through.
- Real production data was queried read-only during planning to derive the acceptance test pairs; no data was modified.

## Success Criteria (Summary)

- Searching "cukier" finds recipes storing "cukru"; searching without diacritics ("maslo") finds recipes storing "masła".
- Type filter + search query still combine correctly; a non-matching search still shows the existing empty state, not an error.
