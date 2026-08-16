---
project: SnapRecipe
version: 1
status: draft
created: 2026-08-15
updated: 2026-08-16
prd_version: 1
main_goal: speed
top_blocker: external
---

# Roadmap: SnapRecipe

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Home cooks save recipes on social media but can't find them at meal time — the content is visual and unstructured, and platform-native search fails. SnapRecipe solves the "I saved this somewhere" problem: the user photographs a physical recipe, the app extracts the name and ingredients via AI, and the recipe becomes immediately findable by ingredient or type. The product is validated only when the full loop — photo → save → find — works reliably in Polish for a real user (the builder's wife, the design reference and first user).

## North star

**S-01: Photo → AI extraction → save** — the smallest slice that tests the riskiest assumption behind the whole product: can the app reliably extract a Polish recipe from a photo well enough that a real user never has to type it in by hand? If S-01 works, the rest is delivery; if it doesn't, nothing else matters yet.

> "North star" here means: the smallest end-to-end slice whose successful delivery would prove the assumption the product depends on — placed as early as prerequisites allow, because everything else only matters if this works.

## At a glance

| ID   | Change ID                | Outcome (user can …)                                          | Prerequisites | PRD refs                              | Status   |
| ---- | ------------------------ | --------------------------------------------------------------- | -------------- | -------------------------------------- | -------- |
| F-01 | supabase-auth-setup      | (foundation) sign-up and sign-in work; users can be persisted    | —              | FR-001, FR-002                         | done |
| F-02 | recipe-data-schema       | (foundation) recipe schema with structured ingredients landed    | F-01           | FR-015, FR-008, FR-020                 | done |
| S-01 | photo-to-recipe-save     | upload a photo, get an AI-extracted recipe saved to collection  | F-01, F-02     | FR-004, FR-005, FR-008, US-01          | done |
| S-02 | recipe-search-and-browse | search recipes by ingredient, filter by type, view details       | S-01           | FR-013, FR-015, FR-016, FR-018, US-02  | in-progress |
| S-03 | recipe-edit-and-remove   | edit a saved recipe and remove it reversibly                     | S-01           | FR-019, FR-020                         | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme              | Chain                              | Note                                                          |
| ------ | ------------------- | ----------------------------------- | -------------------------------------------------------------- |
| A      | Core pipeline        | `F-01` → `F-02` → `S-01` → `S-02` | Main sequential path; `S-02` completes the validation loop.     |
| B      | Recipe management     | `S-03`                             | Parallel with `S-02` after `S-01`; joins Stream A at `S-01`.   |

## Baseline

What's already in place in the codebase as of 2026-08-15 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6.4.6 + React 19 + Tailwind 4 + shadcn/ui; auth pages + dashboard at `src/pages/`
- **Backend / API:** partial — Astro SSR API routes present; only auth endpoints wired (`src/pages/api/auth/{signin,signout,signup}.ts`); no recipe routes, no vision API integration
- **Data:** absent — `supabase/` contains only `config.toml` and `.gitignore`; no migrations, no recipe schema, no seed data
- **Auth:** partial — `@supabase/ssr` wired in code (`src/lib/supabase.ts`, `src/middleware.ts` protects `/dashboard`); Supabase project is not configured (confirmed: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone") → sign-up/sign-in are currently non-functional
- **Deploy / infra:** present — `wrangler.jsonc` already in Workers format; GitHub Actions CI auto-deploys to Cloudflare Workers on push to `master` via `wrangler-action@v3`; already deployed once per commit history
- **Observability:** absent — no logging or error-tracking library in code; only Cloudflare's built-in `observability.enabled` flag is on

## Foundations

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
- **Unknowns:**
  - Which vision API provider to use (and at what cost per extraction call)? — Owner: builder. Block: yes — FR-005 cannot be implemented until a provider is chosen and the integration is scoped.
  - Will the chosen vision API reliably extract ingredients from Polish handwritten or printed recipes? — Owner: builder (validate during implementation with sample photos). Block: no — a quality risk to tune, not a planning blocker.
- **Risk:** This is both the north star and the riskiest slice — AI extraction quality on Polish recipes is unverified until tested. Under a speed goal, this sits on the strict must-have path — the smallest set of features already marked must-have in the PRD, skipping every nice-to-have — and every other slice depends on it existing, so it cannot be allowed to slip.
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
- **Status:** in-progress

### S-03: Recipe edit and reversible removal

- **Outcome:** user can edit a saved recipe's name, ingredient list, type, or note, and can remove a recipe from their collection with the ability to recover it within a defined window.
- **Change ID:** recipe-edit-and-remove
- **PRD refs:** FR-019 (edit), FR-020 (reversible removal)
- **Prerequisites:** S-01 (needs saved recipes to edit or remove)
- **Parallel with:** S-02 (browse/search is independent of edit/remove once S-01 is done)
- **Blockers:** —
- **Unknowns:**
  - Recovery window for removed recipes: how long (hours, days)? — Owner: builder. Block: no — PRD Open Question 1; any reasonable default ships and is tunable later if F-02 uses a timestamp column.
- **Risk:** Reversible removal needs some recovery affordance (a "Trash" view, or an undo notification) — that UX choice affects scope. Implementation risk is otherwise low.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                | Suggested issue title                           | Ready for `/10x-plan` | Notes                                      |
| ---------- | ------------------------- | ------------------------------------------------ | ---------------------- | -------------------------------------------- |
| F-01       | supabase-auth-setup      | Configure Supabase project + enable auth          | yes                    | Run `/10x-plan supabase-auth-setup`          |
| F-02       | recipe-data-schema       | Design and migrate recipe data schema             | no                     | Awaits F-01 completion                       |
| S-01       | photo-to-recipe-save     | Photo upload → AI extraction → recipe save        | no                     | Blocked: vision API provider not chosen      |
| S-02       | recipe-search-and-browse | Recipe ingredient search + type filter + detail   | no                     | Awaits S-01                                  |
| S-03       | recipe-edit-and-remove   | Edit recipe + reversible removal                  | no                     | Awaits S-01; parallel with S-02              |

## Open Roadmap Questions

1. **Which vision API provider to use for photo extraction?** — Owner: builder. Block: S-01 (planning and implementation cannot proceed until the provider is chosen; the choice affects integration approach, error handling, cost model, and response format). Resolving this promotes S-01 from `blocked` to `proposed` and makes `/10x-plan photo-to-recipe-save` runnable once F-01 and F-02 are done.
2. **How long should a removed recipe remain recoverable (FR-020)?** — Owner: builder. Block: no — any reasonable default (e.g. 30 days) ships; the value is tunable without a schema migration if F-02 uses a timestamp column. Decision needed before F-02 is finalised.

## Candidate Ideas (unplanned)

> Surfaced during S-01 manual testing (2026-08-16). Not yet triaged into Slices — not scoped,
> not estimated. Candidates for a future `/10x-shape` or `/10x-plan` pass.

- **[Bug] Recipe has no preparation instructions/steps** — the extraction pipeline (S-01) and
  schema (F-02) only capture name, ingredient list, and type — never the "how to make it" text.
  Surfaced during manual testing: a saved recipe has no cooking instructions because none are
  extracted or stored. This isn't in the current PRD at all, and is arguably a core-value gap —
  a "recipe" without steps has limited real usefulness. Needs a `/10x-shape` pass to decide
  scope (structured step list vs. freeform text) before any schema/extraction change.
- **[Bug] Ingredient quantities merged into the ingredient text, not a separate field** —
  `recipe_ingredients.name` currently stores the full line (e.g. "2 szklanki mąki") as one text
  blob; quantity/unit isn't independently addressable. Affects F-02's schema, S-01's extraction
  prompt, and any future ingredient-scaling feature. Needs a schema migration (new
  `quantity`/`unit` columns) plus an extraction-prompt change.
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

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)

- **F-01: (foundation) the Supabase project has valid, working credentials in both local dev and the deployed environment; sign-up and sign-in succeed end-to-end; an authenticated user is resolvable via `context.locals.user`.** — Archived 2026-08-15 → `context/archive/2026-08-15-supabase-auth-setup/`. Lesson: —.
- **F-02: (foundation) recipe schema migrated to Supabase: a `recipes` table with name, type, photo reference, and soft-delete markers, plus an independently addressable ingredient list (each ingredient its own row or array element, not a text blob); RLS policies scoped per authenticated user.** — Archived 2026-08-15 → `context/archive/2026-08-15-recipe-data-schema/`. Lesson: —.
- **S-01: user can upload a photo of a physical recipe from their gallery; the app extracts the recipe name, ingredient list, and type via an AI vision API and saves the result to their personal collection automatically, with clear visible feedback on success or failure.** — Archived 2026-08-16 → `context/archive/2026-08-15-photo-to-recipe-save/`. Lesson: —.
