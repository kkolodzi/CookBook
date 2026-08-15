# Recipe Data Schema Implementation Plan

## Overview

Roadmap item **F-02**: land the recipe data layer in Supabase — a `recipes` table, an
independently-addressable `recipe_ingredients` table, a private `recipe-photos` storage
bucket, RLS on all three, and generated TypeScript types — applied to both hosted Supabase
projects (`SnapRecipe` dev, `SnapRecipe_live` prod). No API routes or UI in this plan; this is
pure data-layer foundation that S-01/S-02/S-03 build on top of.

## Current State Analysis

- **No schema exists yet**: `supabase/` has only `config.toml` and `.gitignore` — no
  `migrations/` directory, no `src/types.ts`.
- **Auth is live** (F-01, archived): `context.locals.user` resolves a real authenticated user
  via `src/middleware.ts` + `src/lib/supabase.ts`, so RLS policies have a real `auth.uid()` to
  key against.
- **Two hosted Supabase projects, no local Docker**: `SnapRecipe` (dev, project ref
  `xmyeeuyeszvpvrjszohr`) and `SnapRecipe_live` (prod, project ref `gtrhakzhlammvfifvlyf`) —
  per `CLAUDE.md`'s `### Environment` section. Migrations are pushed directly to each hosted
  project via the Supabase CLI (`supabase link` + `supabase db push`), not applied through
  `supabase start`.
- **Supabase CLI is not authenticated locally** — `npx supabase projects list` currently
  returns "Access token not provided." `supabase login` (interactive) is a prerequisite for
  Phase 1.
- **A real dev-project user already exists** for manual verification/seeding:
  `0501ce12-98e9-4b29-b48c-df74d3a7a41b` (in `SnapRecipe`, not `SnapRecipe_live`).

## Desired End State

Both hosted projects have identical schema: `recipes` + `recipe_ingredients` tables with RLS
scoping every row to its owning user, a private `recipe-photos` storage bucket with matching
per-user RLS, and `src/types.ts` reflects the schema. `SnapRecipe` additionally has a few
seeded sample rows for manual testing; `SnapRecipe_live` stays empty (real user data only).

### Key Discoveries:

- `CLAUDE.md` hard rule: "Always enable RLS on new Supabase tables with per-operation,
  per-role policies" — every table (and the storage bucket) needs four policies
  (select/insert/update/delete), each scoped `to authenticated`.
- `CLAUDE.md` convention: migrations live in `supabase/migrations/` named
  `YYYYMMDDHHmmss_short_description.sql`; shared types go in `src/types.ts`.
- PRD Parked list already confirms per-ingredient annotations (FR-011) and custom type tags
  (FR-012) are deferred — the schema below doesn't need to accommodate either yet, but the
  separate `recipe_ingredients` table (vs. a JSONB blob) means FR-011 won't require a
  migration when it's eventually picked up.
- `supabase/config.toml`'s `[auth]`/seed hooks only apply to a local `supabase start` stack,
  which this topology doesn't use — `db push` talks directly to the linked remote project over
  a Postgres connection and does not require Docker.

## What We're NOT Doing

- Not building any API routes, service layer, or UI — this is schema only. S-01 (photo →
  extraction → save) is where `recipes`/`recipe_ingredients` get their first consumer.
- Not adding a `note` column (FR-010) or custom-type support (FR-012) — both are explicitly
  parked/nice-to-have per the PRD; adding speculative columns now is premature.
- Not adding a trigram/GIN search index on ingredient names — at this data volume (PRD: low
  qps, per-user-scoped collections) a plain `ILIKE` query needs no special indexing. Revisit
  only if search becomes measurably slow.
- Not building an automatic purge job for soft-deleted rows past the 30-day window — rows past
  the window just aren't actively cleaned up yet; add a job only if storage becomes a real
  concern.
- Not pursuing the "global recipe pool" idea raised during planning — out of scope for the
  current PRD (private-only collections in MVP) and raises consent/copyright questions that
  need real product shaping first (see `change.md` Notes).
- Not seeding `SnapRecipe_live` — seed data is a dev-only manual-testing aid.

## Implementation Approach

One migration file per logical concern (relational schema, then storage bucket), both applied
to `SnapRecipe` first with full manual verification before the same two files are pushed to
`SnapRecipe_live`. Types are generated from the dev project once its schema is confirmed
correct, so `src/types.ts` reflects a verified schema rather than a first draft.

## Critical Implementation Details

- **Supabase CLI auth is a hard prerequisite.** `supabase login` must be run interactively
  (this is not scriptable/agent-runnable) before any `supabase link`/`db push` command in
  Phase 1 will work. If already logged in from a prior session, this is a no-op.
- **Project refs**: `SnapRecipe` (dev) = `xmyeeuyeszvpvrjszohr`, `SnapRecipe_live` (prod) =
  `gtrhakzhlammvfifvlyf`. `supabase link --project-ref <ref>` must point at the correct one
  before each `db push` — pushing dev's migration to the wrong linked project is the single
  easiest mistake to make in this plan.
- **`storage.objects` ownership column: verified against the live `SnapRecipe` project.** Both
  `owner` (uuid) and `owner_id` (text) columns exist on this project. Use `owner` — it
  type-matches `auth.uid()` directly (`owner = (select auth.uid())`), while `owner_id` would
  require an explicit `::text` cast since it's typed `text`, not `uuid`.
- **Seed data must never reach `SnapRecipe_live`.** The seed script lives at
  `supabase/seed-dev.sql` (deliberately not named `seed.sql`, which is the Docker-local
  auto-run convention referenced in `config.toml` but unused in this topology) and is run
  manually, once, only against the linked dev project in Phase 3. Phase 4 must not re-run it.

## Phase 1: Relational schema (dev)

### Overview

Create the `recipe_type` enum, `recipes` and `recipe_ingredients` tables, their RLS policies,
and an `updated_at` trigger; push to `SnapRecipe`.

### Changes Required:

#### 1. Relational schema migration

**File**: `supabase/migrations/<timestamp>_recipe_schema.sql`

**Intent**: Land the core relational schema for recipes and their ingredients, with RLS
ensuring every row is only visible/writable by its owning user.

**Contract**:
- `create type recipe_type as enum ('dessert','soup','main_course','salad','breakfast','snack','drink','other');`
- `recipes`: `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `name text not null`, `type recipe_type not null`, `photo_path text not null` (storage object path, not the binary), `created_at`/`updated_at timestamptz not null default now()`, `deleted_at timestamptz` (null = active; soft-delete marker for FR-020).
- `recipe_ingredients`: `id uuid pk default gen_random_uuid()`, `recipe_id uuid not null references recipes(id) on delete cascade`, `name text not null`, `position integer not null default 0` (preserves ingredient order), `created_at timestamptz not null default now()`.
- Indexes: `recipes(user_id)`, a partial index `recipes(user_id) where deleted_at is null` (the hot path — active recipes), `recipe_ingredients(recipe_id)`.
- `updated_at` trigger: a `set_updated_at()` function + `before update` trigger on `recipes`.
- RLS: `alter table ... enable row level security` on both tables. Four policies per table
  (`select`/`insert`/`update`/`delete`, `to authenticated`), `recipes` keyed on
  `(select auth.uid()) = user_id` (wrapped in `select` per Supabase's RLS performance guidance
  — evaluated once and cached, not once per row); `recipe_ingredients` keyed on an `exists`
  subquery against `recipes` for the parent row's `user_id = (select auth.uid())` (it has no
  direct `user_id` column of its own).

### Success Criteria:

#### Automated Verification:

- `supabase login` completed (prerequisite, not agent-runnable — confirm before proceeding)
- `supabase link --project-ref xmyeeuyeszvpvrjszohr` succeeds
- `supabase db push` applies the migration with exit code 0

#### Manual Verification:

- Supabase Studio (dev project): `recipes` and `recipe_ingredients` tables exist with the
  columns above; `recipe_type` enum shows all 8 values
- RLS is enabled on both tables (Studio's table editor shows the RLS badge)

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: Storage bucket (dev)

### Overview

Create the private `recipe-photos` bucket and its per-user RLS policies; push to `SnapRecipe`.

### Changes Required:

#### 1. Storage bucket migration

**File**: `supabase/migrations/<timestamp>_recipe_photos_bucket.sql`

**Intent**: Give recipe photos (FR-004/FR-018) a private, per-user-scoped home in Supabase
Storage — no user can read another user's photos.

**Contract**: `insert into storage.buckets (id, name, public) values ('recipe-photos', 'recipe-photos', false)`. Four RLS policies on `storage.objects` (`select`/`insert`/`update`/`delete`, `to authenticated`), each scoped to `bucket_id = 'recipe-photos' and owner = (select auth.uid())` (see Critical Implementation Details above — `owner` is the verified, type-matching ownership column).

### Success Criteria:

#### Automated Verification:

- `supabase db push` applies the migration with exit code 0

#### Manual Verification:

- Supabase Studio (dev project) → Storage: `recipe-photos` bucket exists, "Public" is off
- Storage policies for the bucket are listed under Studio's Policies tab, one per operation

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 3: Types + seed data (dev only)

### Overview

Generate TypeScript types from the now-verified dev schema and commit them; seed a few sample
rows against the existing dev user for manual testing.

### Changes Required:

#### 1. Generated types

**File**: `src/types.ts`

**Intent**: Give the app compile-time types for `recipes`/`recipe_ingredients`/storage, per
`CLAUDE.md`'s "shared types go in `src/types.ts`" convention — S-01/S-02/S-03 need these
immediately.

**Contract**: Output of `supabase gen types typescript` run against the linked `SnapRecipe`
project, committed as-is (regenerate on any future schema change).

#### 2. Dev-only seed script

**File**: `supabase/seed-dev.sql`

**Intent**: A handful of sample recipes + ingredients under the existing dev user
(`0501ce12-98e9-4b29-b48c-df74d3a7a41b`) so RLS and the schema can be exercised manually
without building any UI yet.

**Contract**: Plain `insert` statements (2-3 sample recipes, a few ingredients each) using the
given user UUID. Run manually, once, via Studio's SQL editor or `supabase db execute` against
the linked dev project — not part of any automated push, and never run against prod.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds (validates `src/types.ts` compiles with the rest of the project)
- `npm run lint` passes

#### Manual Verification:

- Supabase Studio (dev project), SQL editor: querying
  `select * from recipes where user_id = '0501ce12-98e9-4b29-b48c-df74d3a7a41b'` returns the
  seeded rows, each with its ingredients joinable via `recipe_ingredients`
- `src/types.ts` reviewed for accuracy against the actual schema
- Negative RLS check: querying `recipes`/`recipe_ingredients` with the project's anon key (no
  authenticated session) returns zero rows or a permission error — proves RLS actually blocks
  unauthorized access, not just that it's enabled

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 4: Apply to production (`SnapRecipe_live`)

### Overview

Push the same two migrations to the live project; verify structure matches dev; confirm no
seed data leaked to prod.

### Changes Required:

#### 1. Re-link and push to live

**File**: n/a — CLI operation, no new files (reuses the migration files from Phases 1-2)

**Intent**: Bring `SnapRecipe_live` to the same schema state as `SnapRecipe`, without touching
seed data.

**Contract**: `supabase link --project-ref gtrhakzhlammvfifvlyf`, then `supabase db push`
(applies both pending migrations). `supabase/seed-dev.sql` is NOT run against this project.

### Success Criteria:

#### Automated Verification:

- `supabase link --project-ref gtrhakzhlammvfifvlyf` succeeds
- `supabase db push` applies both migrations with exit code 0

#### Manual Verification:

- Supabase Studio (live project): `recipes`, `recipe_ingredients`, `recipe_type` enum, and the
  `recipe-photos` bucket all exist and match the dev project's structure
- RLS is enabled on both tables and storage policies are present, matching dev
- `recipes` table is empty (confirms seed data did not leak to prod)
- Negative RLS check: querying `recipes`/`recipe_ingredients` with the live project's anon key
  returns zero rows or a permission error, same as dev

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Testing Strategy

### Manual Testing Steps:

1. Dev: verify schema + RLS + bucket via Studio (Phases 1-2)
2. Dev: verify seeded rows are queryable and scoped to the seeded user (Phase 3)
3. Prod: verify schema matches dev and remains unseeded (Phase 4)

## Performance Considerations

None beyond the two partial/plain indexes already specified — data volume is low per user
(PRD: low qps, personal collections), so no additional indexing or query optimization is
warranted at this stage.

## Migration Notes

This *is* the first migration for this project — no existing data to migrate. Future schema
changes (e.g., adding FR-011 per-ingredient annotations) build on top of `recipe_ingredients`
without needing to restructure it, since it's already a proper relational table rather than a
JSONB blob.

## References

- Roadmap item: `context/foundation/roadmap.md` (F-02)
- PRD refs: FR-008, FR-015, FR-020 (`context/foundation/prd.md`)
- Prior change: `context/archive/2026-08-15-supabase-auth-setup/` (F-01 — auth + two-project
  topology this plan builds on)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Relational schema (dev)

#### Automated

- [x] 1.1 `supabase login` completed (prerequisite)
- [x] 1.2 `supabase link --project-ref xmyeeuyeszvpvrjszohr` succeeds
- [x] 1.3 `supabase db push` applies the migration with exit code 0

#### Manual

- [x] 1.4 Studio (dev): tables + enum exist with expected columns/values
- [x] 1.5 RLS enabled on both tables

### Phase 2: Storage bucket (dev)

#### Automated

- [ ] 2.1 `supabase db push` applies the migration with exit code 0

#### Manual

- [ ] 2.2 Studio (dev): `recipe-photos` bucket exists, not public
- [ ] 2.3 Storage policies present, one per operation

### Phase 3: Types + seed data (dev only)

#### Automated

- [ ] 3.1 `npm run build` succeeds
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 Seeded rows queryable and correctly scoped to the seeded user
- [ ] 3.4 `src/types.ts` reviewed for accuracy
- [ ] 3.5 Negative RLS check: anon key returns zero rows / permission error

### Phase 4: Apply to production (`SnapRecipe_live`)

#### Automated

- [ ] 4.1 `supabase link --project-ref gtrhakzhlammvfifvlyf` succeeds
- [ ] 4.2 `supabase db push` applies both migrations with exit code 0

#### Manual

- [ ] 4.3 Studio (live): schema matches dev
- [ ] 4.4 RLS enabled + storage policies present, matching dev
- [ ] 4.5 `recipes` table is empty in prod (no seed leakage)
- [ ] 4.6 Negative RLS check: live anon key returns zero rows / permission error
