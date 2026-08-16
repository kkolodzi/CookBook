# Recipe Preparation Instructions (backend slice) — Plan Brief

> Full plan: `context/changes/recipe-prep-instructions/plan.md`
> Frame brief: `context/changes/recipe-prep-instructions/frame.md`

## What & Why

The PRD never specified capturing recipe preparation instructions — FR-005 only asked for name,
ingredients, and type, so nothing downstream (F-02 schema, S-01 extraction) captured them.
Surfaced during S-01 manual testing as a real core-value gap: a saved recipe couldn't be cooked
from without reopening the photo. This plan adds extraction + storage for a freeform
`instructions` field (new FR-021).

## Starting Point

`recipes` has 8 columns, no `instructions`. The extraction service (`recipe-extraction.ts`)
asks the vision model for name/type/ingredients only. `recipes.ts` (API route) does a single
insert per field set. `PhotoUploadForm.tsx` is the only place recipe fields render today (a
post-upload confirmation card) — no detail or edit view exists on `main` yet.

## Desired End State

A photo upload extracts preparation instructions as flowing prose (best-effort, nullable — same
non-blocking treatment as recipe type) and saves them with the recipe. The post-upload
confirmation card shows the instructions text. Existing recipes are unaffected (`instructions =
NULL`).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Instructions format | Freeform text, not structured steps | Simpler schema/extraction, matches how most physical recipes are written | Plan (shaping interview) |
| FR-021 priority | Must-have, but best-effort/nullable | Core-value gap, but the photo itself is already the fallback (guardrail), so extraction shouldn't block save — same pattern as FR-008 (type) | Plan (shaping interview, Socrates round) |
| Scope of this plan | Backend only (migration, extraction, API, upload confirmation UI) | FR-018/FR-019 (detail view, edit form) are the exact files S-02/S-03 are building right now — planning against them today would target code that won't exist post-merge | Plan |
| Column constraint | `text` with 5000-char check constraint | Guards against a runaway/garbled extraction without meaningfully limiting real recipes | Plan |
| Extraction prompt style | Normalize to flowing paragraph (not preserve as-written numbering) | More uniform for later display; a deliberate deviation from the "extract as written" treatment given to ingredients | Plan |
| Post-upload UI | Show `PhotoUploadForm` instructions in full, no truncation | Matches existing confirmation card's simplicity; it's a one-time view, not a recurring list | Plan |

## Scope

**In scope:**
- New `recipes.instructions` column (nullable text, 5000-char cap), migrated to dev then prod
- Extraction service: request + validate + normalize instructions (best-effort)
- API route: persist and return instructions
- `PhotoUploadForm.tsx`: show instructions in the post-upload confirmation

**Out of scope:**
- Recipe detail view showing instructions (FR-018) — follow-up plan after S-02 merges
- Recipe edit form editing instructions (FR-019) — follow-up plan after S-03 merges
- Structured step lists, backfilling old recipes, UI truncation/collapse

## Architecture / Approach

Additive-only: one nullable column, one field threaded through the existing single-pass
extraction call, one field added to the existing single-row `recipes` insert, one new block in
an existing UI component. No new endpoints, tables, or transactions.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema migration | New `instructions` column live in dev; `src/types.ts` regenerated | Low — additive, nullable column |
| 2. Extraction service | Model asked for instructions; best-effort, non-blocking | Extraction quality unverified for multi-line Polish text (graceful degradation by design) |
| 3. API route persistence | Instructions saved + returned by the existing recipe insert | None — single-column addition to existing insert |
| 4. Upload confirmation UI + prod migration | User sees instructions right after upload; schema live in prod | None — isolated, uncontested file |

**Prerequisites:** S-01 (extraction pipeline, done). Does NOT require S-02/S-03 to merge — this
plan deliberately avoids their files.
**Estimated effort:** Small — 4 phases, all additive, no new subsystems. Comparable in size to a
single S-01 sub-phase.

## Open Risks & Assumptions

- Extraction quality for multi-line Polish preparation text is unverified (unlike ingredients,
  validated during S-01 manual testing) — mitigated by best-effort/nullable design, not a
  blocker.
- FR-018/FR-019 (detail view, edit form) remain unimplemented after this plan — instructions are
  captured and visible only in the post-upload confirmation until the follow-up plan lands.
- S-02 and S-03 independently modify `src/pages/recipes/[id].astro` for different purposes (read
  detail vs. edit) — they will conflict with **each other** at merge time. Unrelated to this
  plan, but the follow-up plan for FR-018/FR-019 can't be written until that's resolved and the
  real merged file exists.

## Success Criteria (Summary)

- A freshly uploaded recipe photo with visible preparation steps shows those steps as prose in
  the post-upload confirmation card
- A recipe photo without visible steps still saves successfully with no error
- Existing (pre-change) recipes remain unaffected
