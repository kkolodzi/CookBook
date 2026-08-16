# Photo Upload → AI Extraction → Recipe Save Implementation Plan

## Overview

Build the FR-004/FR-005/FR-008 pipeline (roadmap S-01, the product's north-star slice): a user
uploads a photo of a physical recipe, the app extracts the recipe name, ingredient list, and
meal type via an OpenRouter vision model, saves it to their collection, and gives clear
Polish-language success or failure feedback — synchronously, within the PRD's 10-second budget.

## Current State Analysis

- `recipes` (id, user_id, name, type, photo_path, timestamps, `deleted_at`) and
  `recipe_ingredients` (id, recipe_id, name, position) already exist with per-user RLS
  (`supabase/migrations/20260815132912_recipe_schema.sql`) — no schema changes needed for
  recipe storage itself.
- A private `recipe-photos` Storage bucket exists with owner-scoped RLS
  (`supabase/migrations/20260815134500_recipe_photos_bucket.sql`) — uploads must go through
  an authenticated Supabase client so `owner` is set to `auth.uid()` automatically.
- No vision API library or service layer exists yet (`src/lib/` has only `supabase.ts`,
  `utils.ts`, `config-status.ts`). `src/lib/services/` does not exist yet — this is its first use.
- No `zod` dependency is installed despite CLAUDE.md requiring it for API route input
  validation — this plan adds it.
- Existing API routes (`src/pages/api/auth/*.ts`) use native `<form method="POST" action="...">`
  submission with server-side redirects carrying errors as query params
  (`src/pages/api/auth/signup.ts`). That pattern doesn't fit this feature: the upload needs a
  loading state during a ~10s call, structured per-failure-reason retry tips, and an inline
  post-save type nudge — none of which map cleanly onto redirect-based error passing. This plan
  uses `fetch` + `FormData` from a React island instead, returning JSON.
- `src/lib/config-status.ts` + `Layout.astro` already have a working pattern for a Polish
  "not configured" banner (currently only for Supabase) — this plan extends it for the new
  OpenRouter secret.
- `src/middleware.ts` protects routes via a `PROTECTED_ROUTES` prefix list — currently only
  `/dashboard`.

## Desired End State

A logged-in user can navigate to a new upload page, pick a JPEG/PNG photo of a physical recipe
from their gallery, submit it, and within ~10 seconds either see the recipe saved to their
collection (with a nudge to confirm the meal type if the AI was unsure) or see a clear,
Polish-language error with a specific tip for what went wrong and a way to retry. Verify by:
running the manual photo test set in Phase 4, and confirming a saved recipe's ingredients exist
as individual `recipe_ingredients` rows queryable by the existing schema.

### Key Discoveries:

- `supabase/migrations/20260815134500_recipe_photos_bucket.sql:8-13` — Storage RLS requires
  `owner = auth.uid()`, which the session-bound `createClient()` satisfies automatically; no
  service-role key needed anywhere in this feature.
- `src/lib/supabase.ts` — `createClient(headers, cookies)` returns `null` when
  `SUPABASE_URL`/`SUPABASE_KEY` are unset; every new route/service must handle that the same
  way the existing auth routes do.
- `astro.config.mjs:17-21` — secrets are declared via `envField.string({ context: "server",
  access: "secret", optional: true })`; the new `OPENROUTER_API_KEY` follows the same shape.

## What We're NOT Doing

- **Type override / full edit UI (FR-008 override, FR-019)** — out of scope; deferred to S-03.
  This slice's type-confirmation nudge (Phase 7) is a narrow, single-field exception scoped
  only to the immediate post-save moment when the AI was unsure — not a general edit flow.
- **Client-side image compression/resizing** — explicitly deferred; flagged by the user as
  "add later." Uploads are capped at 5MB and sent as-is.
- **Multiple recipes in one photo, or one recipe spanning multiple photos** — out of scope for
  this slice. The extraction prompt targets a single recipe per photo; a spread with two dishes
  yields one extracted recipe (the most prominent). Both directions (one-photo-many-recipes and
  many-photos-one-recipe) are flagged as ideas worth a future `/10x-shape` pass, not built here.
- **Async/notification-based upload flow** — the user floated this as a future direction
  ("eventually ... asynchronous ... getting a notification it has been done"). Explicitly
  deferred: this slice is a single synchronous request/response, no job queue, no polling, no
  push notifications.
- **In-app camera capture (FR-004b)** — gallery picker only, per roadmap Parked list.
- **Manual recipe entry (FR-007)** — photo flow only.
- **Retrofitting the existing English-language scaffold (Dashboard, Sign up/Sign in) to
  Polish** — out of scope for this slice. All *new* UI copy this plan introduces is Polish,
  matching the PRD guardrail for user-facing text, but existing pages are untouched.

## Implementation Approach

Seven phases, each independently verifiable, in dependency order: data model → extraction
service → route orchestration (validation/cap/extraction, no persistence) → route persistence
→ upload UI happy path → failure/retry UX → the cuttable type-nudge extra. The route is
deliberately split so that "can we correctly call the vision API and classify the result" is
provable before "can we correctly save it" — the two failure modes (bad extraction vs. bad
persistence) are easy to conflate if built as one phase.

The core ordering decision that shapes Phases 3-4: **extract before uploading to Storage.**
Calling the vision service directly on the in-memory photo bytes — before anything is written
to Storage — means a failed extraction never leaves an orphaned Storage object needing cleanup.
Storage is only written to once extraction has already succeeded and the floor rule is met.

## Critical Implementation Details

### Extraction result contract and failure taxonomy

The extraction service (Phase 2) is the single owner of the floor rule (NFR: a saved recipe
must have at minimum a name and one ingredient) and of failure classification — the route
(Phase 3) treats the service's result as final and never re-derives these judgments. Six
failure reasons, each mapped to distinct Polish retry-tip copy in Phase 6:

| Reason | Meaning | Who determines it |
|---|---|---|
| `not_a_recipe` | Photo isn't recipe content | Model self-classification |
| `blurry_or_low_light` | Image quality too poor to read | Model self-classification |
| `cut_off_or_partial` | Recipe visible but out of frame | Model self-classification |
| `handwriting_illegible` | Handwritten text present but undecipherable | Model self-classification |
| `incomplete_extraction` | Readable, but couldn't produce name + ≥1 ingredient | Service, post-hoc floor check — overrides even a model-reported "success" |
| `technical_error` | Network/timeout/malformed-JSON/HTTP failure | Route/service catch-all — the model was never meaningfully consulted |

The service's success payload carries `type: RecipeType | null` — `null` means the model was
not confident enough to assign one of the 8 predefined types. The route (Phase 4) is what
turns `null` into the stored value `"other"`; the service itself never guesses a type it isn't
confident about.

### State sequencing in the persistence phase (Phase 4)

Order matters and is not the obvious "upload then process" sequence:

1. Call the extraction service on the in-memory bytes (no Storage write yet).
2. On failure of any kind: log the `extraction_attempts` row, return the failure JSON. Nothing
   else happens — no Storage object, no recipe row.
3. On success: upload the same bytes to `recipe-photos` Storage, **then** insert the `recipes`
   row (using the path Storage just returned), **then** insert `recipe_ingredients` rows.
4. If the `recipe_ingredients` insert fails after the `recipes` insert already succeeded,
   delete the just-created `recipes` row as a compensating action (cascade delete handles the
   Storage object's DB reference, but the Storage object itself is left — acceptable for MVP;
   note as an accepted risk, not built out).
5. Log the `extraction_attempts` row last, with `recipe_id` populated on success.

## Phase 1: Data Model — Extraction Attempts Table

### Overview

Add a table that serves two purposes at once: counting a user's extraction calls for the daily
cap, and storing the raw model response for debugging/prompt-tuning — the two purposes share
the same rows so this is a single migration, not two.

### Changes Required:

#### 1. Migration — `extraction_attempts` table

**File**: `supabase/migrations/20260815140000_extraction_attempts.sql`

**Intent**: One row per extraction call (success or failure), scoped to the calling user, with
enough detail to (a) count today's attempts for the 10/day cap and (b) inspect what the model
actually returned when tuning the prompt against real Polish photos.

**Contract**: New enum `extraction_failure_reason` with the six values from the taxonomy table
above. New table `extraction_attempts`: `id uuid pk`, `user_id uuid not null references
auth.users(id) on delete cascade`, `created_at timestamptz not null default now()`, `success
boolean not null`, `failure_reason extraction_failure_reason` (nullable), `raw_response jsonb`
(nullable — null for `technical_error` where no model response was ever received), `recipe_id
uuid references recipes(id) on delete set null` (nullable, populated only on success). A check
constraint enforces `(success and failure_reason is null) or (not success and failure_reason is
not null)`. Index on `(user_id, created_at)` for the cap-count query. RLS enabled, mirroring the
`recipes` table's own-row policies exactly: `select`/`insert` for `authenticated` where
`(select auth.uid()) = user_id`; no `update`/`delete` policies — attempts are an immutable log.

#### 2. Regenerate `src/types.ts`

**File**: `src/types.ts`

**Intent**: Pick up the new table/enum in the generated Supabase types, following the same
regeneration step F-02 used.

**Contract**: Adds `extraction_attempts` to `Database["public"]["Tables"]` and
`extraction_failure_reason` to `Database["public"]["Enums"]` and `Constants.public.Enums`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local/dev Supabase project
- Type checking passes: `npm run typecheck` (or `npx astro check` if no dedicated script)
- Linting passes: `npm run lint`

#### Manual Verification:

- In the Supabase dashboard (dev project), confirm RLS is enabled on `extraction_attempts` and
  a test insert as an authenticated user succeeds while an insert with a mismatched `user_id`
  is rejected

---

## Phase 2: Vision Extraction Service

### Overview

Wrap OpenRouter's chat completions API behind a single service function that returns the
result contract from Critical Implementation Details — the only piece of the codebase that
knows about OpenRouter's request/response shape.

### Changes Required:

#### 1. Env schema — OpenRouter secrets

**File**: `astro.config.mjs`

**Intent**: Declare the new server-only secrets the same way `SUPABASE_URL`/`SUPABASE_KEY` are
declared.

**Contract**: Add `OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret",
optional: true })` and `OPENROUTER_MODEL: envField.string({ context: "server", access:
"public", optional: true, default: "<vision-capable model slug, chosen at implementation time
by checking OpenRouter's current model catalog for a cost-effective vision-capable option>" })`.

#### 2. Config status banner

**File**: `src/lib/config-status.ts`

**Intent**: Extend the existing Polish "not configured" banner pattern so a missing
`OPENROUTER_API_KEY` is as visible as a missing Supabase config currently is.

**Contract**: Add an entry to `configStatuses` — `name: "OpenRouter"`, `configured:
Boolean(OPENROUTER_API_KEY)`, `message: "AI do rozpoznawania przepisów nie jest skonfigurowane
— przesyłanie zdjęć jest wyłączone."`.

#### 3. Extraction service

**File**: `src/lib/services/recipe-extraction.ts`

**Intent**: Given raw photo bytes and a mime type, call the OpenRouter vision model with a
prompt instructing it to extract a Polish recipe's name, ingredients (as a list), and meal type
(one of the 8 `recipe_type` enum values, or abstain if unsure), or to classify why it couldn't.
Enforce the 10-second hard timeout and the name+≥1-ingredient floor rule here, per Critical
Implementation Details.

**Contract**: `extractRecipeFromPhoto(imageBytes: ArrayBuffer, mimeType: string):
Promise<ExtractionResult>` where `ExtractionResult` is the discriminated union from Critical
Implementation Details (`{ success: true; name; type: RecipeType | null; ingredients: string[];
raw }` | `{ success: false; reason: ExtractionFailureReason; raw }`). Internally: build a
base64 data URL from `imageBytes`, request OpenRouter's chat completions endpoint with the
configured model, request structured JSON output (via `response_format: json_schema` where the
model supports it, else a prompt-enforced JSON instruction), validate the response shape with
`zod`, and enforce the timeout via `AbortController` on the underlying `fetch` — a call that
aborts or errors becomes `{ success: false, reason: "technical_error", raw: null }`. A response
that parses but yields an empty name or zero ingredients is downgraded to `{ success: false,
reason: "incomplete_extraction", raw: <the parsed response> }` rather than returned as success.

#### 4. Add `zod` dependency

**File**: `package.json`

**Intent**: CLAUDE.md requires zod for API route input validation; this is its first use in the
codebase.

**Contract**: `npm install zod`.

#### 5. Test infrastructure (addendum — added during implementation)

**Files**: `vitest.config.ts`, `src/lib/services/recipe-extraction.test.ts`, `package.json`
(`test` script, `vitest` dev dependency)

**Intent**: This phase's Success Criteria require unit tests for `extractRecipeFromPhoto`, but
the repo had no test runner at all. Discovered mid-phase; user explicitly chose to adapt (set up
vitest now) rather than skip the tests or replan. Not part of the original plan — recorded here
as an addendum so the plan reflects what was actually built.

**Contract**: Standard vitest config (`node` environment, `@` path alias matching tsconfig);
4 unit tests covering the cases listed in Testing Strategy below.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck` / `npx astro check`
- Linting passes: `npm run lint`
- Unit tests for `extractRecipeFromPhoto` pass (mocking the OpenRouter HTTP call): a
  well-formed model response maps to `success: true`; a response with no ingredients maps to
  `incomplete_extraction`; a simulated timeout maps to `technical_error`

#### Manual Verification:

- Set `OPENROUTER_API_KEY` in `.dev.vars` locally, call the service directly (e.g. a scratch
  script or REPL) with one real recipe photo and confirm a plausible Polish name + ingredient
  list comes back

---

## Phase 3: API Route — Validation, Rate Limiting & Extraction Orchestration

### Overview

Stand up `POST /api/recipes` as far as "call the extraction service and return its result" —
auth, input validation, and the daily cap gate, but no Storage writes or database saves yet.
This phase is fully testable on its own: hit the endpoint, get back the extraction JSON.

### Changes Required:

#### 1. API route skeleton

**File**: `src/pages/api/recipes.ts`

**Intent**: Authenticate the request, validate the uploaded file, enforce the per-user daily
cap, then delegate to the extraction service and return its result as JSON. Persistence (Phase
4) plugs into the success branch of this same handler.

**Contract**: `export const prerender = false;` (per CLAUDE.md's hard rule for SSR API routes).
`export const POST: APIRoute = async (context) => { ... }`. Steps: resolve `context.locals.user`
(401 if absent — though middleware already protects this route once added to
`PROTECTED_ROUTES` in Phase 5); parse `context.request.formData()`, extract the file field;
validate with a `zod` schema — mime type in `["image/jpeg", "image/png"]`, size ≤ 5MB — 400 with
a Polish message on failure; query `extraction_attempts` for `count(*) where user_id = $me and
created_at >= current_date` via the session-scoped Supabase client — if ≥ 10, return 429 with a
Polish rate-limit message *without* logging an attempt row (the request never reached the
model); otherwise read the file into an `ArrayBuffer` and call `extractRecipeFromPhoto`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Integration test: unauthenticated request → 401; oversized/wrong-type file → 400; 10 prior
  attempts today → 429; valid request → the extraction service's result is returned as JSON

#### Manual Verification:

- `curl` or a REST client against the running dev server confirms the 401/400/429 paths return
  the expected Polish messages

---

## Phase 4: API Route — Persistence

### Overview

Complete `POST /api/recipes`: on a successful extraction, upload the photo, save the recipe and
its ingredients, and log the attempt — implementing the ordering from Critical Implementation
Details.

### Changes Required:

#### 1. Persistence branch in the route handler

**File**: `src/pages/api/recipes.ts`

**Intent**: Turn a successful `ExtractionResult` into a saved recipe; turn a failed one into a
logged attempt with no side effects on `recipes`/`recipe_ingredients`/Storage.

**Contract**: On `{ success: false, ... }`: insert an `extraction_attempts` row (`success:
false`, the given `reason`, `raw_response: raw`), respond `200` with `{ success: false, reason
}` (a classified extraction failure is a normal response, not a 5xx). On `{ success: true, ...
}`: upload the bytes to the `recipe-photos` bucket via the session-scoped client at a path like
`${user.id}/${crypto.randomUUID()}.${extensionFromMimeType}`; insert into `recipes` using the
returned Storage path and `type: extractedType ?? "other"`; insert each ingredient into
`recipe_ingredients` with `position` set to its index; if the ingredients insert fails, delete
the just-inserted `recipes` row (compensating action, per Critical Implementation Details);
insert the `extraction_attempts` row with `success: true`, `raw_response: raw`, `recipe_id`;
respond `200` with `{ success: true, recipe: { id, name, type, ingredients }, typeUnconfirmed:
extractedType === null }`. The `typeUnconfirmed` flag is what Phase 7's nudge keys off of.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Integration test: a successful extraction results in one `recipes` row, N `recipe_ingredients`
  rows (N = ingredient count), one Storage object, and one `extraction_attempts` row with
  `recipe_id` set; a failed extraction results in zero `recipes`/`recipe_ingredients`/Storage
  side effects and one `extraction_attempts` row with `recipe_id` null
- Integration test: simulating an ingredients-insert failure after a successful recipe insert
  results in the `recipes` row being rolled back (compensating delete)

#### Manual Verification:

- Using the dev user (`0501ce12-98e9-4b29-b48c-df74d3a7a41b`), submit one real recipe photo via
  the running dev server and confirm the recipe + ingredients + photo all appear correctly in
  the Supabase dashboard (dev project)

---

## Phase 5: Upload UI — Happy Path

### Overview

The mobile-first entry point: a protected page with a photo picker that submits to `POST
/api/recipes` and shows a loading state, then a success view.

### Changes Required:

#### 1. Protect the new route

**File**: `src/middleware.ts`

**Intent**: Extend route protection to the new page, matching how `/dashboard` is protected.

**Contract**: Add `/recipes` to the `PROTECTED_ROUTES` array.

#### 2. New page

**File**: `src/pages/recipes/new.astro`

**Intent**: Host the upload form, following the layout/styling conventions of
`src/pages/auth/signup.astro`.

**Contract**: Uses `Layout`, renders a `PhotoUploadForm` React island with `client:load`, Polish
page title/heading (e.g. "Dodaj przepis ze zdjęcia").

#### 3. Upload form component

**File**: `src/components/recipes/PhotoUploadForm.tsx`

**Intent**: File picker restricted to JPEG/PNG, client-side size pre-check (≤5MB) before
submit, `fetch`-based submission (not native form action, per the "Current State Analysis" note
on why redirect-based error passing doesn't fit this feature), a loading state with reassuring
Polish copy while the request is in flight, and a success view rendering the saved recipe's
name/type/ingredients.

**Contract**: Local state machine: `idle | loading | success | error`. On submit: build
`FormData`, `fetch("/api/recipes", { method: "POST", body: formData })`, parse JSON response.
On `{ success: true, ... }`: transition to `success`, render the recipe summary, and — if
`typeUnconfirmed` — render the `TypeConfirmationNudge` component from Phase 7. On `{ success:
false, reason }` or a non-2xx/network error: transition to `error` and hand off to the
Phase 6 failure UI (this phase can stub `error` as a generic message; Phase 6 replaces it with
reason-specific copy).

#### 4. Dashboard entry point

**File**: `src/pages/dashboard.astro`

**Intent**: Give the user a way to reach the new upload page.

**Contract**: Add a link/button to `/recipes/new`, Polish label (e.g. "Dodaj przepis ze
zdjęcia"), styled consistently with the existing sign-out button.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- On a mobile-width viewport, navigate from the dashboard to `/recipes/new`, pick a real recipe
  photo, submit, and confirm the loading state shows during the wait and the success view shows
  the correct name/type/ingredients — one-handed operability per the PRD's secondary success
  criterion
- Run the quality-validation pass: submit 5-10 real Polish recipe photos (mix of printed and
  handwritten, varying photo quality) and manually check extraction accuracy — this directly
  tests the roadmap's stated riskiest assumption

---

## Phase 6: Failure & Retry UX

### Overview

Replace Phase 5's generic error stub with reason-specific Polish retry tips for all six failure
categories, plus a retry affordance.

### Changes Required:

#### 1. Failure copy map

**File**: `src/components/recipes/extraction-failure-copy.ts`

**Intent**: Centralize the six `ExtractionFailureReason` → Polish tip mappings so the UI
component stays declarative.

**Contract**: A `Record<ExtractionFailureReason, { title: string; tip: string }>` covering all
six reasons from Critical Implementation Details, plus a fallback for the 429 rate-limit case
and generic network failures (these aren't `ExtractionFailureReason` values but need copy too).

#### 2. Failure view

**File**: `src/components/recipes/PhotoUploadForm.tsx`

**Intent**: Render the failure state using the copy map, with a retry button that resets the
form back to `idle` (same photo picker, no special retry state machine — per the earlier
decision to keep retry as simple as resubmitting).

**Contract**: `error` state carries the `reason` (or a synthetic `"network_error"` /
`"rate_limited"` key); render `extraction-failure-copy[reason]` and a "Spróbuj ponownie" button
that resets state.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Submit a photo of something that isn't a recipe (e.g. a random object) and confirm the
  `not_a_recipe` tip shows; submit an intentionally blurry photo and confirm the
  `blurry_or_low_light` tip shows; confirm the retry button returns to a clean upload state

---

## Phase 7: Type-Confirmation Nudge (cuttable first if time is short)

### Overview

When the AI wasn't confident about the meal type, the recipe already saved as `"other"` (Phase
4) — this phase adds a lightweight inline nudge to confirm the real type, without a full edit
flow. If time runs short, skip this phase entirely; the silent `"other"` fallback from Phase 4
already stands on its own.

### Changes Required:

#### 1. Type patch endpoint

**File**: `src/pages/api/recipes/[id]/type.ts`

**Intent**: A narrow, single-field update — not a general recipe edit endpoint (that's S-03).

**Contract**: `export const prerender = false;`. `export const PATCH: APIRoute = async (context)
=> { ... }` — validate `context.params.id` and a `type` field (zod, must be one of the 8
`recipe_type` enum values) from the JSON body, update the `recipes` row where `id` matches and
RLS confirms ownership, return the updated `type`.

#### 2. Nudge component

**File**: `src/components/recipes/TypeConfirmationNudge.tsx`

**Intent**: Shown only when `typeUnconfirmed` is true in the success view; a small set of type
buttons (the 8 predefined types, Polish labels) that PATCHes the type on click and then hides
itself.

**Contract**: Props: `recipeId: string`, `onConfirmed: (type: RecipeType) => void`. Renders 8
buttons (or a select), `fetch`-PATCHes `/api/recipes/${recipeId}/type` on selection, calls
`onConfirmed` on success so the parent success view can update the displayed type.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Integration test: PATCH as the owning user succeeds; PATCH as a different authenticated user
  is rejected by RLS

#### Manual Verification:

- Trigger a save where the AI is deliberately uncertain of type (or manually force
  `typeUnconfirmed` in dev tools) and confirm picking a type updates the displayed recipe
  without a page reload

---

## Testing Strategy

### Unit Tests:

- `extractRecipeFromPhoto`: well-formed success response, empty-ingredients downgrade to
  `incomplete_extraction`, timeout/network-error mapping to `technical_error`, malformed JSON
  from the model handled gracefully

### Integration Tests:

- Full `POST /api/recipes` flow: unauthenticated, invalid file, over daily cap, successful save
  (recipe + ingredients + Storage object + attempt log all consistent), failed extraction (no
  side effects except the attempt log), ingredients-insert failure triggers compensating recipe
  delete
- `PATCH /api/recipes/[id]/type`: owner succeeds, non-owner rejected by RLS

### Manual Testing Steps:

1. Submit a clear, well-lit printed recipe photo — confirm save + correct extraction
2. Submit a handwritten recipe photo — confirm save or an appropriate `handwriting_illegible`
   failure
3. Submit a non-recipe photo — confirm `not_a_recipe` failure and tip
4. Submit a blurry photo — confirm `blurry_or_low_light` failure and tip
5. Submit 10 photos in one day as the same user — confirm the 11th is rate-limited
6. Run the 5-10 real Polish recipe photo validation pass (Phase 5) and record the observed
   accuracy — this is the roadmap's riskiest-assumption check

## Performance Considerations

The 10-second NFR is enforced as a hard server-side timeout on the OpenRouter call (Phase 2),
not a soft target — a slow-but-correct extraction is deliberately killed rather than allowed to
run long, per the decision in Critical Implementation Details. Cloudflare Workers' own request
duration limits (paid tier) sit above this 10s budget with headroom, per
`context/foundation/infrastructure.md`'s risk register.

## Migration Notes

Additive only — one new table (`extraction_attempts`), no changes to existing tables. No data
backfill needed.

## References

- Roadmap: `context/foundation/roadmap.md` (S-01)
- PRD: `context/foundation/prd.md` (FR-004, FR-005, FR-008, US-01)
- Prior schema work: `context/archive/2026-08-15-recipe-data-schema/`
- Existing auth route pattern: `src/pages/api/auth/signup.ts`
- Existing form pattern: `src/components/auth/SignUpForm.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Model — Extraction Attempts Table

#### Automated

- [x] 1.1 Migration applies cleanly against local/dev Supabase project — 4520a9b
- [x] 1.2 Type checking passes — 4520a9b
- [x] 1.3 Linting passes — 4520a9b

#### Manual

- [x] 1.4 RLS confirmed enabled and correctly scoped in Supabase dashboard — 4520a9b

### Phase 2: Vision Extraction Service

#### Automated

- [x] 2.1 Type checking passes — ef71152
- [x] 2.2 Linting passes — ef71152
- [x] 2.3 Unit tests for `extractRecipeFromPhoto` pass — ef71152

#### Manual

- [x] 2.4 Service called directly with one real recipe photo returns plausible extraction — ef71152

### Phase 3: API Route — Validation, Rate Limiting & Extraction Orchestration

#### Automated

- [x] 3.1 Type checking passes — e72aa46
- [x] 3.2 Linting passes — e72aa46
- [x] 3.3 Integration test: 401/400/429 paths and successful extraction pass-through — e72aa46

#### Manual

- [x] 3.4 REST client confirms 401/400/429 paths return expected Polish messages — e72aa46

### Phase 4: API Route — Persistence

#### Automated

- [x] 4.1 Type checking passes — 2b4c3b0
- [x] 4.2 Linting passes — 2b4c3b0
- [x] 4.3 Integration test: successful save produces consistent recipe/ingredients/storage/attempt rows — 2b4c3b0
- [x] 4.4 Integration test: ingredients-insert failure triggers compensating recipe delete — 2b4c3b0

#### Manual

- [x] 4.5 Real photo submission via dev server verified end-to-end in Supabase dashboard — 2b4c3b0

### Phase 5: Upload UI — Happy Path

#### Automated

- [x] 5.1 Type checking passes
- [x] 5.2 Linting passes

#### Manual

- [x] 5.3 Mobile-width upload flow verified one-handed, loading + success states correct
- [x] 5.4 Quality-validation pass: 5-10 real Polish recipe photos, accuracy recorded

### Phase 6: Failure & Retry UX

#### Automated

- [ ] 6.1 Type checking passes
- [ ] 6.2 Linting passes

#### Manual

- [ ] 6.3 Non-recipe and blurry-photo failure tips verified; retry button resets cleanly

### Phase 7: Type-Confirmation Nudge (cuttable first if time is short)

#### Automated

- [ ] 7.1 Type checking passes
- [ ] 7.2 Linting passes
- [ ] 7.3 Integration test: owner PATCH succeeds, non-owner PATCH rejected by RLS

#### Manual

- [ ] 7.4 Type nudge confirmed working end-to-end without page reload
