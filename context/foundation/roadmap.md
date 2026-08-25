---
project: SnapRecipe
version: 1
status: draft
created: 2026-08-15
updated: 2026-08-25
prd_version: 1
main_goal: quality
top_blocker: none
milestone_id: search-and-list-quality
milestone_seq: 2
milestone_status: open
---

# Roadmap: SnapRecipe

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-02: Search and list quality hardening** — Status: open

- **Intent:** M-01's manual testing surfaced two real defects in the already-shipped core loop — ingredient search misses Polish grammatical-case variants (undercutting US-02's core promise), and a just-saved recipe doesn't reliably appear in the collection view. Fix both before adding any new nice-to-have surface area, so the loop M-01 proved stays trustworthy under real daily use.
- **Source materials:** `context/foundation/prd.md` (v1) — same PRD as M-01, no version change; this milestone targets already-must-have FRs whose implementation has a known defect, not new FR scope.
- **Done when:** every F-NN and S-NN below is `done`.

## Vision recap

Home cooks save recipes on social media but can't find them at meal time — the content is visual and unstructured, and platform-native search fails. SnapRecipe solves the "I saved this somewhere" problem: the user photographs a physical recipe, the app extracts the name and ingredients via AI, and the recipe becomes immediately findable by ingredient or type. The product is validated only when the full loop — photo → save → find — works reliably in Polish for a real user (the builder's wife, the design reference and first user).

## North star

**S-05: Fix Polish ingredient search** — the highest-leverage fix for this milestone: search-by-ingredient (FR-015, must-have) is the primary discovery path US-02 promises, and it currently fails on ordinary Polish grammatical-case variants. Fixing it protects the core loop M-01 already proved works, before any new surface area is added.

> M-01's own product-level "north star" — the smallest end-to-end slice whose successful delivery proves the core hypothesis the product depends on — was S-01 (photo → AI extraction → save), already shipped; see `## Milestone History`. M-02 doesn't re-validate the hypothesis, it hardens what M-01 proved.

## At a glance

| ID   | Change ID                  | Outcome (user can …)                                          | Prerequisites | PRD refs                              | Status   |
| ---- | --------------------------- | --------------------------------------------------------------- | -------------- | -------------------------------------- | -------- |
| F-01 | supabase-auth-setup      | (foundation) sign-up and sign-in work; users can be persisted    | —              | FR-001, FR-002                         | done |
| F-02 | recipe-data-schema       | (foundation) recipe schema with structured ingredients landed    | F-01           | FR-015, FR-008, FR-020                 | done |
| S-01 | photo-to-recipe-save     | upload a photo, get an AI-extracted recipe saved to collection  | F-01, F-02     | FR-004, FR-005, FR-008, US-01          | done |
| S-02 | recipe-search-and-browse | search recipes by ingredient, filter by type, view details       | S-01           | FR-013, FR-015, FR-016, FR-018, US-02  | done |
| S-03 | recipe-edit-and-remove   | edit a saved recipe and remove it reversibly                     | S-01           | FR-019, FR-020                         | done |
| S-04 | recipe-prep-instructions | see a recipe's preparation instructions, extracted from the photo | S-01           | FR-021, FR-018, FR-019                 | done |
| S-05 | fix-polish-ingredient-search | find a recipe by any grammatical form of a Polish ingredient name | S-02        | FR-015, US-02                          | ready |
| S-06 | fix-recipe-list-staleness  | see a just-saved recipe in the collection immediately, no manual refresh | S-01, S-02 | FR-013, US-01                     | ready |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme              | Chain                              | Note                                                          |
| ------ | ------------------- | ----------------------------------- | -------------------------------------------------------------- |
| A      | Core pipeline        | `F-01` → `F-02` → `S-01` → `S-02` | Main sequential path; `S-02` completes the validation loop.     |
| B      | Recipe management     | `S-03`                             | Parallel with `S-02` after `S-01`; joins Stream A at `S-01`.   |
| C      | Recipe completeness   | `S-04`                             | Depends on S-01, S-02, and S-03 all being merged (touches the detail-view and edit-form surfaces those two built). All three are merged as of 2026-08-16 — no longer blocked. |
| D      | Discovery quality (M-02) | `S-05` → `S-06`                | Joins Stream A at `S-02`. Both fix defects in S-02's discovery surface; mutually independent (not a hard dependency chain) but sequenced by main_goal=quality, north star (S-05) first. |

## Baseline

What's already in place in the codebase as of 2026-08-25 (auto-researched + user-confirmed; refreshed for M-02).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 islands + Tailwind 4 + shadcn/ui; recipe pages, dashboard, auth pages all shipped
- **Backend / API:** present — `src/pages/api/recipes/*` (CRUD, trash, restore, type) and `src/pages/api/auth/*`, both fully wired
- **Data:** present — 11 migrations landed: recipe schema, photo bucket, extraction attempts, instructions, RLS/ownership hardening
- **Auth:** present — Supabase SSR wired end-to-end; `src/middleware.ts` protects `/recipes`; fully functional (M-01's baseline gap is resolved)
- **Deploy / infra:** present — `wrangler.jsonc` + `.github/workflows/ci.yml` auto-deploys to Cloudflare Workers on push to `main`
- **Observability:** absent — still no logging/error-tracking library in code (Parked below; unchanged since M-01)

## Foundations

No new Foundations for M-02 — every layer S-05 and S-06 touch (data query logic, frontend fetch/render) is already present per Baseline above. F-01 and F-02 below are M-01's foundations, carried forward for PRD-coverage and dependency-graph continuity.

### F-01: Supabase auth configuration

- **Outcome:** (foundation) the Supabase project has valid, working credentials in both local dev and the deployed environment; sign-up and sign-in succeed end-to-end; an authenticated user is resolvable via `context.locals.user`.
- **Change ID:** supabase-auth-setup
- **PRD refs:** FR-001 (create account), FR-002 (log in)
- **Unlocks:** F-02 (schema migration requires a live Supabase project), S-01, S-02, S-03 (every slice requires a working authenticated user)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nothing downstream can be built or verified without a real authenticated user, and auth is currently non-functional (Supabase not configured). This is the first work item regardless of sequencing goal.
- **Status:** done

### F-02: Recipe data schema

- **Outcome:** (foundation) recipe schema migrated to Supabase: a `recipes` table with name, type, photo reference, and soft-delete markers, plus an independently addressable ingredient list (each ingredient its own row or array element, not a text blob); RLS policies scoped per authenticated user.
- **Change ID:** recipe-data-schema
- **PRD refs:** FR-015 (independently-addressable ingredient constraint), FR-008 (type enum), FR-020 (soft-delete / reversible removal)
- **Unlocks:** S-01 (needs a place to persist extracted recipes), S-02 (needs to query by ingredient and type), S-03 (needs to update and soft-delete)
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - How long should a removed recipe remain recoverable (PRD Open Question 1)? — Owner: builder. Block: no — any reasonable default (e.g., 30 days) ships; tunable later if the schema uses a timestamp column rather than a hard TTL.
- **Risk:** The independently-addressable ingredient constraint (FR-015) is load-bearing — getting it wrong forces a later migration once S-01–S-03 are already built on top of it. Under a speed goal this argues for locking the schema down correctly once rather than iterating on it mid-build.
- **Status:** done

## Slices

### S-01: Photo upload → AI extraction → recipe save

- **Outcome:** user can upload a photo of a physical recipe from their gallery; the app extracts the recipe name, ingredient list, and type via an AI vision API and saves the result to their personal collection automatically, with clear visible feedback on success or failure.
- **Change ID:** photo-to-recipe-save
- **PRD refs:** FR-004 (photo upload), FR-005 (AI extraction + auto-save), FR-008 (type auto-assignment with user override), US-01
- **Prerequisites:** F-01 (Supabase configured), F-02 (recipe schema)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** — none open. Provider chosen (OpenRouter, see Open Roadmap Question 1); Polish extraction quality validated during manual testing 2026-08-16 (see Candidate Ideas below for gaps found, not blockers).
- **Risk:** Resolved — implemented and archived. Extraction works well enough to ship; manual testing surfaced two scope gaps, one of which (no prep instructions) shipped as S-04, the other (quantities not independently addressable) remains Parked.
- **Status:** done

### S-02: Recipe search, type filter, and detail view

- **Outcome:** user can browse the full recipe collection with an empty search, search by ingredient (e.g. "marchewka"), filter by meal type, and view a recipe's full details — name, ingredient list, type, photo, and note.
- **Change ID:** recipe-search-and-browse
- **PRD refs:** FR-013 (collection screen / empty-query browse), FR-015 (ingredient search), FR-016 (type filter), FR-018 (recipe detail view), US-02
- **Prerequisites:** S-01 (needs at least one saved recipe to search against)
- **Parallel with:** S-03 (edit and remove are independent of search once S-01 is done)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low technical risk; the main risk is mobile one-handed usability (PRD secondary success criterion), which needs validation on a real device before this slice is called done. FR-015 and FR-016 are must-have, so under a speed goal this stays squarely on the must-have path rather than becoming a candidate for parking.
- **Status:** done

### S-03: Recipe edit and reversible removal

- **Outcome:** user can edit a saved recipe's name, ingredient list, type, or note, and can remove a recipe from their collection with the ability to recover it within a defined window.
- **Change ID:** recipe-edit-and-remove
- **PRD refs:** FR-019 (edit), FR-020 (reversible removal)
- **Prerequisites:** S-01 (needs saved recipes to edit or remove)
- **Parallel with:** S-02 (browse/search is independent of edit/remove once S-01 is done)
- **Blockers:** —
- **Unknowns:** — recovery window resolved (30 days; see Open Roadmap Question 2). Still open: whether recovery is a dedicated "Trash" view or an undo notification after delete — that's a UX/scope call for planning, not a blocker.
- **Risk:** Reversible removal needs some recovery affordance (a "Trash" view, or an undo notification) — that UX choice affects scope. Implementation risk is otherwise low.
- **Status:** done

### S-04: Recipe preparation instructions

- **Outcome:** user's saved recipe includes preparation instructions extracted from the photo as freeform text; visible in the recipe detail view and editable, same as name/ingredients/type/note today.
- **Change ID:** recipe-prep-instructions
- **PRD refs:** FR-021 (extract + save instructions, must-have, best-effort/non-blocking), FR-018 (detail view now includes instructions), FR-019 (edit now includes instructions)
- **Prerequisites:** S-01 (extraction pipeline + schema pattern to extend)
- **Parallel with:** S-02 and S-03 (both merged to `main` 2026-08-16) — no longer a sequencing concern; this plan now builds on their real, merged detail-view/edit-form code instead of worktree guesses.
- **Blockers:** none. All prerequisites (S-01, S-02, S-03) are merged.
- **Unknowns:**
  - Can the vision API reliably transcribe multi-line Polish preparation instructions from handwritten/printed recipes, at the same quality bar validated for ingredients during S-01? — Owner: builder, validate during implementation. Block: no — extraction is best-effort/nullable by design (see FR-021), so a quality shortfall degrades gracefully rather than blocking.
- **Risk:** Low technical risk — additive `instructions text` column, one extra `edit_recipe()` RPC parameter (kept additive via `default null`), matching UI patterns in three existing components. No remaining sequencing risk.
- **Status:** done

### S-05: Fix Polish ingredient search

- **Outcome:** user can find a recipe by any grammatical form of a Polish ingredient name — searching "cukier" (nominative) also matches a recipe storing "cukru" (genitive, e.g. "łyżka cukru"), and likewise for other common declension patterns (e.g. "masło" → "masła").
- **Change ID:** fix-polish-ingredient-search
- **PRD refs:** FR-015 (must-have — ingredient search, independently-addressable ingredient constraint), US-02
- **Prerequisites:** S-02 (the existing search implementation this fixes)
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Polish declension has many irregular forms; a naive prefix-truncation fix was already considered and rejected during M-01 manual testing as too imprecise (false positives on short words, doesn't handle vowel alternation like masło→masła). A real fix needs actual stemming/lemmatization, which is more effort than a typical bug fix — flagging so `/10x-plan` scopes it as such rather than a one-line patch.
- **Status:** ready

### S-06: Fix recipe list staleness after save

- **Outcome:** user sees a just-saved recipe in their collection immediately after navigating back to it from `/recipes/new` — no manual refresh needed.
- **Change ID:** fix-recipe-list-staleness
- **PRD refs:** FR-013 (must-have — collection screen shows all saved recipes), US-01
- **Prerequisites:** S-01 (the save flow), S-02 (the collection/browse view this affects)
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:**
  - Root cause not yet confirmed — candidates are a fetch-once-on-mount pattern with no refetch-on-navigation, a caching layer, or Astro page/data caching. Owner: builder, investigate during planning. Block: no — a `/10x-frame` pass is recommended before `/10x-plan` given the cause is unconfirmed, but this doesn't block roadmap sequencing.
- **Risk:** Undiagnosed root cause means the fix's actual size is unknown until investigated — could be a one-line refetch trigger or a deeper caching-strategy change. The symptom directly touches the PRD guardrail "a saved recipe must never disappear... after a successful save confirmation" (it doesn't actually disappear, but looks like it did), which is why this is sequenced alongside S-05 rather than parked.
- **Status:** ready

## Backlog Handoff

| Roadmap ID | Change ID                | Suggested issue title                           | Ready for `/10x-plan` | Notes                                      |
| ---------- | ------------------------- | ------------------------------------------------ | ---------------------- | -------------------------------------------- |
| F-01       | supabase-auth-setup      | Configure Supabase project + enable auth          | done                   | Archived 2026-08-15                          |
| F-02       | recipe-data-schema       | Design and migrate recipe data schema             | done                   | Archived 2026-08-15                          |
| S-01       | photo-to-recipe-save     | Photo upload → AI extraction → recipe save        | done                   | Archived 2026-08-16                          |
| S-02       | recipe-search-and-browse | Recipe ingredient search + type filter + detail   | done                   | Merged to `main` 2026-08-16; archived to `context/archive/2026-08-16-recipe-search-and-browse/` |
| S-03       | recipe-edit-and-remove   | Edit recipe + reversible removal                  | yes                    | S-01 done; recovery window resolved (30 days, Open Roadmap Question 2); implementation + impl-review complete in worktree `cookbook_recipe-edit-and-remove` (branch `feature/recipe-edit-and-remove`); resolving merge conflicts against `main` (introduced by S-02 landing first — both branches touched `src/pages/recipes/[id].astro`) as of 2026-08-16 |
| S-04       | recipe-prep-instructions | Capture and show recipe preparation instructions  | planned                | Full 7-phase plan (backend + detail view + edit form + prod rollout) ready 2026-08-16, after S-02 + S-03 merged same day. `/10x-implement recipe-prep-instructions phase 1` is safe to start. |
| S-05       | fix-polish-ingredient-search | Fix Polish ingredient search (grammatical-case variants) | yes           | North star of M-02. `/10x-plan fix-polish-ingredient-search` is safe to start. |
| S-06       | fix-recipe-list-staleness | Fix stale recipe list after save                  | yes                     | Recommend a `/10x-frame` pass first — root cause unconfirmed (fetch-once-on-mount vs. caching layer vs. Astro page caching). |

## Open Roadmap Questions

1. ~~**Which vision API provider to use for photo extraction?**~~ — **Resolved during S-01 planning (2026-08-15): OpenRouter**, a model-agnostic gateway, rather than a direct single-provider SDK — the underlying vision model can be swapped without rewriting the integration. See `context/archive/2026-08-15-photo-to-recipe-save/change.md`.
2. ~~**How long should a removed recipe remain recoverable (FR-020)?**~~ — **Resolved (2026-08-16): 30 days.** Matches the common trash/recycle-bin convention (Gmail, Drive, Dropbox) and needs no schema change — `recipes.deleted_at` (migration `20260815132912_recipe_schema.sql`) is already a `timestamptz`, so the window is a pure business-logic constant enforced by a query filter (`deleted_at > now() - interval '30 days'`) or a scheduled hard-delete job, not a column. S-03 (`recipe-edit-and-remove`) should treat this as the default recovery window unless the builder overrides it during planning.

## Candidate Ideas (unplanned)

> Surfaced during S-01/S-02/S-04 manual testing (2026-08-16 to 2026-08-17). Not yet triaged into
> Slices — not scoped, not estimated. Candidates for a future `/10x-shape` or `/10x-plan` pass.
> Two items originally listed here (the Polish ingredient-search bug and the stale-recipe-list
> bug) were promoted into M-02 as S-05 and S-06 — see `## Slices` above.

- **[Feature] Dashboard — favorite recipes** — let users mark/star recipes as favorites and
  surface them on the dashboard. Depends on S-02 existing (a collection view to favorite from).
- **[Feature] PDF recipe upload** — extend FR-004 (currently photo-only: JPEG/PNG) to also
  accept PDF recipe files. Affects the upload UI, file validation, and possibly the extraction
  approach (PDF text extraction vs. vision-model image analysis).
- **[Feature] Social login (Google/Facebook)** — already captured; see **Parked** below
  ("Social login (OAuth)") — PRD currently specifies email + password only at launch.
- **[UX] Dashboard is a redundant middle step — make "Twoje przepisy" the post-login landing
  screen** — surfaced during S-02 manual testing (2026-08-16). Current flow: login → placeholder
  `/dashboard` (email + two links) → user clicks "Twoje przepisy" → `/recipes`. The dashboard
  adds a click with no value of its own; the recipe collection (`/recipes`, built in S-02) is
  what a returning user actually wants to see right after signing in. Candidate fix: either
  redirect post-login straight to `/recipes` and demote/remove `/dashboard`, or fold
  `/dashboard`'s remaining content (sign-out, "add recipe" entry point) into `/recipes` as its
  header/nav so it becomes the true welcome screen. Touches `src/middleware.ts` (redirect
  target after auth), `src/pages/auth/signin.astro`'s post-login redirect, and possibly removes
  `src/pages/dashboard.astro` entirely. Needs a `/10x-shape` or `/10x-plan` pass to decide
  between "redirect only" vs. "merge dashboard into /recipes".
- **[Feature] Multiple photos per recipe, not all "the recipe card"** — surfaced during S-02
  manual testing (2026-08-16). Today a recipe has exactly one `photo_path` (F-02 schema),
  captured once at save time (S-01) and treated as *the* source image. Idea: let a user attach
  several images to one recipe, where only one (or none) needs to be the original recipe
  card/text — others could be a photo of the finished dish, a prep/ingredients-laid-out shot, or
  an in-progress step photo. Raises real design questions: does extraction (S-01) still run
  against just the first/primary photo, or could multiple photos each contribute ingredients
  (e.g. one photo of the card + one of a handwritten addition)? Does the detail view (S-02) need
  a gallery/carousel instead of a single `<img>`? Affects F-02's schema (photo_path would need
  to become a one-to-many `recipe_photos` table, likely with a "primary/card" flag), the
  storage/signed-URL logic in `recipe-query.ts`, the upload flow (`PhotoUploadForm.tsx`), and
  the detail page. Needs a `/10x-shape` pass before scoping — meaningfully bigger than a single
  Slice-sized tweak.
- **[Feature] Paginate/lazy-load the recipe collection instead of a flat 200-row cap** —
  surfaced during S-02 manual testing (2026-08-16). `listRecipes()` currently fetches up to 200
  rows in one request (`src/lib/services/recipe-query.ts`), and `RecipeBrowser.tsx` renders the
  whole result set at once — no pagination, "load more", or infinite scroll, on either mobile or
  desktop. The plan explicitly scoped this out as a v1 tradeoff ("personal collections aren't
  expected to approach that size yet"), but real usage may want incremental loading well before
  200 recipes for a snappier first paint and less scroll-heavy browsing. Needs a `/10x-shape` or
  `/10x-plan` pass to choose an approach (offset/cursor-based `GET /api/recipes` params +
  infinite scroll vs. a simpler "load more" button) — a real API contract change, not a
  UI-only tweak.
- **[UX] No photo thumbnail shown after upload** — surfaced during S-04 manual testing
  (2026-08-17). The post-upload success card (`PhotoUploadForm.tsx`) shows name/type/ingredients/
  instructions but never the photo itself, so there's no visual confirmation of which photo was
  just uploaded — easy to lose track of when uploading several recipes in a row. `POST
  /api/recipes`'s success response doesn't currently include a photo URL at all (only
  `id, name, type, ingredients, instructions`), so this needs a signed-URL addition to that
  response (see `getRecipeDetail`'s pattern in `recipe-query.ts`) before the UI can render a
  thumbnail. Likely also worth showing a thumbnail in the recipe list (`RecipeBrowser.tsx`)
  and/or a local preview of the picked file before upload, but the confirmation-card case is the
  one directly reported. Needs a `/10x-plan` pass to scope which surface(s).

## Parked

- **Manual recipe creation (FR-007)** — Why parked: nice-to-have per PRD; a gallery photo covers all physical recipes in MVP.
- **In-app camera launch (FR-004b)** — Why parked: nice-to-have; gallery upload (S-01) covers the core use case.
- **Recipe name search (FR-014)** — Why parked: nice-to-have; type filter + ingredient search (S-02) are the must-have discovery paths.
- **Sort by date toggle (FR-017)** — Why parked: nice-to-have; default newest-first is sufficient for MVP.
- **Freeform recipe note (FR-010)** — Why parked: nice-to-have; a post-cook annotation is a polish item.
- **Per-ingredient annotations (FR-011)** — Why parked: nice-to-have; the data structure supports it via F-02, but the annotation UI is deferred.
- **Custom type tags (FR-012)** — Why parked: nice-to-have; the predefined list covers MVP.
- **Recipe recommendation engine** — Why parked: PRD §Non-Goals; explicitly v2+ scope.
- **Social media link import** — Why parked: PRD §Non-Goals; URL import is v2.
- **Recipe sharing between users** — Why parked: PRD §Non-Goals; deferred to v2.
- **Offline-first** — Why parked: PRD §Non-Goals; AI extraction requires a live network connection.
- **Social login (OAuth)** — Why parked: PRD says email + password only at launch.
- **Observability infrastructure** — Why parked: no launch-blocking NFR names it, and under a speed goal it isn't on the must-have path; `wrangler tail` covers live debugging for now. Revisit before the first real production incident.
- **Ingredient quantities as a separate field** (`quantity`/`unit` columns on `recipe_ingredients`) — Why parked: framed via `/10x-frame` (2026-08-16, HIGH confidence) as a deliberate S-01 design choice, not a bug — the extraction prompt explicitly says "keep quantities if present" to match F-02's single-column schema, and FR-015's independent-addressability requirement is satisfied at the ingredient-row level already. No current FR needs quantity as structured data. Revisit if FR-011 (per-ingredient annotations) or an ingredient-scaling feature is ever picked up. See `context/changes/recipe-ingredient-quantities/frame.md`.

## Milestone History

- **M-01: Core recipe capture-and-discovery loop** (`core-recipe-loop`) — closed 2026-08-25. Photo → AI extraction → save, search/browse, edit/reversible-remove, and prep-instructions all shipped and archived; the full photo → save → find loop validated end-to-end in Polish.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)

- **F-01: (foundation) the Supabase project has valid, working credentials in both local dev and the deployed environment; sign-up and sign-in succeed end-to-end; an authenticated user is resolvable via `context.locals.user`.** — Archived 2026-08-15 → `context/archive/2026-08-15-supabase-auth-setup/`. Lesson: —.
- **F-02: (foundation) recipe schema migrated to Supabase: a `recipes` table with name, type, photo reference, and soft-delete markers, plus an independently addressable ingredient list (each ingredient its own row or array element, not a text blob); RLS policies scoped per authenticated user.** — Archived 2026-08-15 → `context/archive/2026-08-15-recipe-data-schema/`. Lesson: —.
- **S-01: user can upload a photo of a physical recipe from their gallery; the app extracts the recipe name, ingredient list, and type via an AI vision API and saves the result to their personal collection automatically, with clear visible feedback on success or failure.** — Archived 2026-08-16 → `context/archive/2026-08-15-photo-to-recipe-save/`. Lesson: —.
- **S-02: user can browse the full recipe collection with an empty search, search by ingredient (e.g. "marchewka"), filter by meal type, and view a recipe's full details — name, ingredient list, type, photo, and note.** — Archived 2026-08-16 → `context/archive/2026-08-16-recipe-search-and-browse/`. Lesson: —.
- **S-03: user can edit a saved recipe's name, ingredient list, type, or note, and can remove a recipe from their collection with the ability to recover it within a defined window.** — Archived 2026-08-16 → `context/archive/2026-08-16-recipe-edit-and-remove/`. Lesson: —.
- **S-04: user's saved recipe includes preparation instructions extracted from the photo as freeform text; visible in the recipe detail view and editable, same as name/ingredients/type/note today.** — Archived 2026-08-17 → `context/archive/2026-08-16-recipe-prep-instructions/`. Lesson: —.
