# Frame Brief: Recipe preparation instructions/steps

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

A saved recipe has no cooking instructions — the extraction pipeline (S-01) and the
`recipes`/`recipe_ingredients` schema (F-02) capture only name, ingredient list, and type.
Surfaced during S-01 manual testing (2026-08-16); recorded as a "[Bug]" in
`context/foundation/roadmap.md` → Candidate Ideas.

## Initial Framing (preserved)

- **User's stated cause or approach**: the extraction pipeline and schema "forgot" to capture
  preparation steps — implied as a defect in S-01/F-02.
- **User's proposed direction**: extend the schema and the extraction prompt to capture steps.
- **Pre-dispatch narrowing**: not separately gathered via AskUserQuestion — evidence from primary
  sources (PRD, F-02 plan, S-01 extraction code) was already conclusive enough to skip dispatch
  (see Hypothesis Investigation). Confirmed with the requester before writing this brief that a
  direct evidence-based frame was acceptable for this triage pass.

## Dimension Map

The observation could originate at any of these dimensions:

1. **PRD/shaping decision** — was capturing steps explicitly discussed and cut during PRD shaping? ← candidate reframe
2. **F-02 schema design** — was a steps/instructions column considered and dropped while designing `recipes`/`recipe_ingredients`?
3. **S-01 extraction implementation** — did the extraction prompt/response schema deliberately exclude steps as an S-01-planning-time scope cut, independent of the PRD? ← user's initial framing
4. **Vision-model capability** — is this a capability risk (the model can't reliably transcribe multi-line instructions) rather than a scoping omission?

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| PRD/shaping decision explicitly excluded steps | `prd.md` Business Logic section (line 154): "The app classifies each recipe by type and extracts its ingredients from a photo so the user can find any saved recipe by what's in it" — value prop is framed purely as ingredient-based findability. But: no FR (US-01, FR-004, FR-005, FR-008, FR-010, FR-018) mentions instructions/steps at all, and none carries a Socrates accept/reject note about them the way FR-007, FR-010, FR-011, FR-012 do for other deferred fields. Non-Goals (`prd.md:169-174`) and Parked (`roadmap.md` Parked section) also don't mention it. | WEAK — the vision statement is *consistent* with omitting steps, but there's no evidence it was ever raised and consciously rejected. It reads as unconsidered, not decided-against. |
| F-02 schema design considered and dropped an instructions field | `context/archive/2026-08-15-recipe-data-schema/plan.md` — zero occurrences of "instruction", "step", "przygotowanie" anywhere in the plan. | NONE — never came up during schema planning. |
| S-01 extraction implementation deliberately scoped steps out | `src/lib/services/recipe-extraction.ts:36-63` — `modelResponseSchema` and `EXTRACTION_PROMPT` ask the model for exactly `name`, `type`, `ingredients`; no `instructions`/`steps` field, no comment noting an intentional exclusion. Matches FR-005's literal text ("extracts the recipe name, ingredient list, and type") — the implementation faithfully scoped to what FR-005 specified, nothing more. | STRONG (as *implementation matched spec*, not as *deliberate cut of a considered feature*) — S-01 built exactly what FR-005 asked for; the gap traces back to FR-005 never including instructions, not to an S-01-time decision to drop them. |
| Vision-model capability risk | No evidence gathered (no sample photos/extraction runs reviewed for multi-line instruction text) — out of scope for a docs-only frame pass. | NOT INVESTIGATED — a real risk to flag for whichever plan picks this up, not a framing question. |

## Narrowing Signals

- FR-005's literal scope ("name, ingredient list, and type") is the direct ancestor of what S-01 built — the implementation isn't the origin of the gap, the requirement is.
- Unlike quantity/unit (see `recipe-ingredient-quantities/frame.md`), no FR or Socrates note anywhere touches on preparation steps — this is the more "never considered" of the two candidate ideas, not the more "known and deferred" one.
- The roadmap's own note (written when the idea was first captured) already flagged this as "arguably a core-value gap" — a recipe without steps has limited real usefulness. This frame doesn't overturn that instinct; it grounds it in evidence.

## Cross-System Convention

Recipe-management apps (the class of product SnapRecipe is in) universally treat instructions/steps as a core recipe field alongside name and ingredients — this isn't a stretch feature, it's typically assumed baseline. The PRD's ingredient-search framing (findability) and the "can you actually cook from it" expectation (completeness) are two different value props that got conflated when FR-005 was written; only the first was scoped.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: not an S-01 implementation bug, but a requirement gap in the PRD — FR-005 (and the surrounding recipe-data FRs) never specified capturing preparation steps, so nothing downstream (F-02 schema, S-01 extraction) could have captured them.

This changes the entry point: fixing it isn't "patch the extraction prompt," it's "decide whether recipe steps belong in the product at all, and if so, what shape (structured step list vs. freeform text) and what priority (must-have vs. nice-to-have) they get" — a PRD-level decision, same weight as any other FR.

## Confidence

**HIGH** — the absence is corroborated across three independent artifacts (PRD FR list, F-02 plan, S-01 extraction code) with no evidence anywhere of a deliberate cut, and the "implementation matches its own narrower spec" pattern is unambiguous.

## What Changes for /10x-plan

Do not send this straight to `/10x-plan`. It needs a `/10x-shape` pass first — this is new product scope (a PRD amendment: new FR(s) for capturing and displaying preparation steps), not a bug fix to an existing FR. Scope questions for that pass: structured step list vs. freeform text; must-have vs. nice-to-have; whether it warrants a schema migration now or can piggyback on a future recipe-data change alongside `recipe-ingredient-quantities`.

## References

- Source files: `context/foundation/prd.md:37-174`, `context/foundation/roadmap.md:149-154`, `context/archive/2026-08-15-recipe-data-schema/plan.md`, `src/lib/services/recipe-extraction.ts:36-63`
- Related idea: `context/changes/recipe-ingredient-quantities/frame.md`
- Investigation tasks: none (dispatch skipped — primary-source evidence was already conclusive)
