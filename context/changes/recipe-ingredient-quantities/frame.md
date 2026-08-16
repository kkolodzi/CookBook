# Frame Brief: Independently-addressable ingredient quantity/unit

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

`recipe_ingredients.name` stores the full ingredient line (e.g. "2 szklanki mąki") as one text
blob; quantity and unit are not independently addressable fields. Surfaced during S-01 manual
testing (2026-08-16); recorded as a "[Bug]" in `context/foundation/roadmap.md` → Candidate Ideas.

## Initial Framing (preserved)

- **User's stated cause or approach**: the schema/extraction pipeline never split quantity/unit
  out of the ingredient text — implied as a defect.
- **User's proposed direction**: schema migration (new `quantity`/`unit` columns) plus an
  extraction-prompt change.
- **Pre-dispatch narrowing**: not separately gathered via AskUserQuestion — primary-source
  evidence (F-02 schema, F-02 plan, FR-011/FR-015 text, S-01 extraction prompt) was already
  conclusive enough to skip dispatch (see Hypothesis Investigation).

## Dimension Map

1. **PRD/shaping decision** — did FR-011 (per-ingredient annotations) or FR-015 (ingredient search) explicitly discuss and resolve quantity separation?
2. **F-02 schema design** — was a `quantity`/`unit` column considered and dropped while designing `recipe_ingredients`?
3. **S-01 extraction implementation** — did the extraction prompt deliberately fold quantity into the ingredient string? ← candidate reframe
4. **FR-015 search-quality risk** — does merging quantity into the ingredient text actually break the false-positive concern FR-015's Socrates note raised ("butter" matching "buttermilk")?

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| PRD explicitly resolved quantity as merged-or-separate | FR-011 (`prd.md:112-113`, nice-to-have, parked): "per-ingredient annotations require each ingredient to be independently addressable... the data structure must support independently-addressable ingredients regardless (see FR-015 constraint)." FR-015 (`prd.md:126-127`, must-have): constraint is "each ingredient must be independently addressable **per recipe**" — i.e. one row per ingredient, to fix name-substring false positives ("butter" vs "buttermilk"). Neither FR ever discusses splitting quantity/unit *within* an ingredient's own text. | WEAK/NONE on "quantity separation" specifically — the PRD's independent-addressability requirement is about ingredient-level granularity (satisfied), not sub-field (quantity/unit) granularity. Silent, not decided. |
| F-02 schema design considered and dropped quantity/unit columns | `context/archive/2026-08-15-recipe-data-schema/plan.md` — zero occurrences of "quantity" or "unit". `supabase/migrations/20260815132912_recipe_schema.sql:69-76` — `recipe_ingredients` has only `name text not null` (plus `position`, `id`, `recipe_id`, `created_at`); comment at line 69 reads "independently-addressable ingredients (FR-015), one row each" — explicitly ties the design to FR-015's row-level requirement, not a sub-field one. | NONE on "considered and dropped" — never discussed; STRONG on "column design intentionally satisfies FR-015 at row granularity only." |
| S-01 extraction deliberately merges quantity into the ingredient string | `src/lib/services/recipe-extraction.ts:60` — the extraction prompt instructs the model explicitly: `"ingredients": an array of individual ingredient strings as written in the source, each ingredient as its own array entry (**keep quantities if present**)`. This is a written, deliberate instruction, not an omission. | STRONG — this is a conscious design choice made during S-01 planning, matching the F-02 column shape it writes into. |
| Merged quantity breaks FR-015's stated search-quality goal | FR-015's Socrates note is about ingredient-*name* token boundaries ("butter" inside "buttermilk"), not about quantity noise. A search for "mąka" against "2 szklanki mąki" still substring-matches correctly; quantity text doesn't introduce a *false positive* of the kind FR-015 worried about, only extra unsearched noise in the same field. | WEAK — some search-quality degradation is plausible (e.g. matching digits/units accidentally), but it's a different, milder concern than the one FR-015 was written to solve, and no failure has actually been observed/tested. |

## Narrowing Signals

- The extraction prompt's "keep quantities if present" (`recipe-extraction.ts:60`) is a positive, written instruction — this is the opposite of an oversight; someone chose this shape during S-01 planning, consistent with F-02's single-column design.
- Contrast with `recipe-prep-instructions`: that gap has *zero* trace anywhere in the FR list, plan, or code. This one has a real (if narrow) FR touchpoint (FR-011/FR-015) and a matching, intentional implementation — it's the "known and implicitly resolved" idea, not the "never considered" one.
- No test or bug report shows an actual FR-015 search-quality failure caused by merged quantities; this is a structural improvement opportunity, not a reproduced defect.

## Cross-System Convention

Recipe apps that support ingredient scaling (e.g. "serves 4 → serves 2") require quantity/unit as structured fields, not text; apps that only support search-by-ingredient-name (which is all FR-015 asks for) commonly leave quantity in the display string. SnapRecipe's PRD is squarely in the second camp today — no FR asks for scaling.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: not a bug against any stated FR — FR-015's independent-addressability requirement is satisfied at the ingredient-row level, and the merged-quantity shape was a deliberate, documented S-01 choice. It's an **enhancement candidate** (finer-grained data) with no current FR demand, most valuable if/when a future feature (ingredient scaling, structured per-ingredient annotations under FR-011) needs it.

## Confidence

**HIGH** — the "keep quantities if present" instruction is direct, unambiguous evidence of intent, and FR-011/FR-015's text confirms the PRD's addressability requirement stops at the ingredient-row boundary.

## What Changes for /10x-plan

Do not plan this now. Park it explicitly (add to `roadmap.md` Parked, with the reasoning above) unless/until a concrete feature needs quantity as data — most likely FR-011 (per-ingredient annotations, already parked) or a future ingredient-scaling feature (currently a Non-Goal). If it's ever picked up, it's a straightforward `/10x-shape` → schema migration (`quantity`/`unit` columns) + extraction-prompt change, not urgent triage.

## References

- Source files: `context/foundation/prd.md:112-113,126-127`, `context/archive/2026-08-15-recipe-data-schema/plan.md`, `supabase/migrations/20260815132912_recipe_schema.sql:69-76`, `src/lib/services/recipe-extraction.ts:60`
- Related idea: `context/changes/recipe-prep-instructions/frame.md`
- Investigation tasks: none (dispatch skipped — primary-source evidence was already conclusive)
