# Photo Upload → AI Extraction → Recipe Save — Plan Brief

> Full plan: `context/changes/photo-to-recipe-save/plan.md`

## What & Why

Build the product's north-star slice (roadmap S-01): a user photographs a physical recipe, the
app extracts the name, ingredients, and meal type via an AI vision API, and saves it to their
collection automatically. This is the riskiest assumption the whole product depends on — if
Polish-language extraction doesn't work reliably enough, nothing downstream matters yet.

## Starting Point

The `recipes` and `recipe_ingredients` tables and a private `recipe-photos` Storage bucket
already exist (F-02, done) with per-user RLS. Auth is live (F-01, done). Nothing else exists:
no vision API integration, no service layer, no upload UI. The roadmap flagged this slice as
`blocked` on choosing a vision provider — that's the first decision this plan resolves.

## Desired End State

A logged-in user opens a new upload page, picks a photo from their gallery, and within ~10
seconds either sees the recipe saved (with an optional one-tap nudge to confirm the meal type if
the AI was unsure) or sees a clear, Polish, reason-specific error with a retry option.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Vision provider | OpenRouter (model-agnostic) | No lock-in — swap the underlying model by changing a config string, one secret to manage |
| Extraction UX | Synchronous, single request | Simplest correct implementation of the 10s NFR; no polling/job infra needed at this scale |
| Photo upload path | Proxy through the API route | Server controls file validation before Storage; matches the existing route pattern |
| Vision call ordering | Extract first, upload to Storage only on success | Avoids ever needing to clean up an orphaned Storage object after a failed extraction |
| Cost control | 10 extraction calls/user/day, logged in a shared attempts table | Hard ceiling on worst-case cost; the same table doubles as a debugging log of raw model responses |
| Sub-floor results (name/ingredients missing) | Treated as a failure, not saved | Matches the NFR literally; keeps every saved recipe searchable by ingredient from day one |
| Bad/non-recipe photos | Model self-classifies into one of 6 failure reasons | Drives specific, actionable Polish retry tips instead of one generic error |
| Uncertain meal type | Save as "Other" immediately; optional post-save nudge to confirm | Keeps the save itself non-blocking (matches PRD's rejection of a pre-save review screen); nudge is cuttable if time is short |
| Retry UX | Resubmit via the same form, reason-specific tips | Simplest possible retry mechanism; no dedicated retry state machine |
| File constraints | JPEG/PNG only, ≤5MB, no client-side compression | Matches real device output for the common case; compression explicitly deferred |

## Scope

**In scope:** gallery photo upload, OpenRouter vision extraction, structured Polish failure
taxonomy + retry tips, daily rate cap, auto-save with type fallback, optional type-confirmation
nudge.

**Out of scope:** type override / full edit UI (S-03), client-side image compression, multi-
recipe or multi-photo extraction, async/notification-based upload flow, in-app camera capture,
manual recipe entry, retrofitting existing English scaffold pages to Polish.

## Architecture / Approach

Client (React island, `fetch` + `FormData`) → `POST /api/recipes` (Astro API route, session-
scoped Supabase client) → extraction service (`src/lib/services/recipe-extraction.ts`, calls
OpenRouter with a 10s hard timeout) → on success: Storage upload → `recipes` +
`recipe_ingredients` insert → `extraction_attempts` log (also used for the daily cap) → JSON
response back to the client, which shows a success view or a reason-specific failure view.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model | `extraction_attempts` table (cap + debug log) | Low — additive migration |
| 2. Vision extraction service | OpenRouter integration, failure taxonomy, timeout | Highest — unverified Polish extraction quality |
| 3. Route: validation & orchestration | Auth, file validation, daily cap, calls extraction | Low |
| 4. Route: persistence | Storage upload, recipe + ingredients save, compensating cleanup | Medium — ordering must be correct to avoid orphaned data |
| 5. Upload UI — happy path | Mobile upload page, loading state, success view | Medium — one-handed mobile usability |
| 6. Failure & retry UX | Reason-specific Polish tips, retry flow | Low |
| 7. Type-confirmation nudge | Inline type picker + PATCH endpoint (cuttable first) | Low |

**Prerequisites:** F-01 and F-02 done (both are). An OpenRouter API key must be obtained and
set in `.dev.vars` (local) and as a Cloudflare Worker secret (prod) before Phase 2 can be
manually verified.
**Estimated effort:** ~4-6 sessions across 7 phases, after-hours solo pace.

## Open Risks & Assumptions

- Polish-language extraction quality (handwritten and printed) is unverified until the Phase 5
  manual validation pass runs against real photos — this is the roadmap's stated riskiest
  assumption.
- The specific OpenRouter model slug is left to implementation time (Phase 2) so the choice
  reflects the current model catalog and pricing rather than a value fixed during planning.
- If a failed Storage upload happens *after* a successful `recipes` insert (rare — DB commit vs.
  Storage write ordering), the ingredients-insert compensating delete doesn't cover that case;
  accepted as a known MVP gap, not built out.

## Success Criteria (Summary)

- A real Polish recipe photo (printed or handwritten) reliably produces a saved recipe with a
  correct name and at least one correctly extracted ingredient, within 10 seconds.
- Every extracted ingredient is immediately searchable once S-02 lands (schema already supports
  this; this slice populates it correctly).
- Failure and success are always visibly communicated — no silent drops, per the PRD guardrail.
