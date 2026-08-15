# Recipe Data Schema — Plan Brief

> Full plan: `context/changes/recipe-data-schema/plan.md`

## What & Why

Land the recipe data layer in Supabase — `recipes` + `recipe_ingredients` tables, a private
`recipe-photos` storage bucket, RLS on everything, and generated TypeScript types. This is
roadmap foundation item F-02: nothing in S-01/S-02/S-03 (photo save, search, edit) can be
built until this schema exists.

## Starting Point

No schema exists yet — `supabase/` has only `config.toml`. Auth (F-01) is live, so RLS
policies have a real `auth.uid()` to key against. Two hosted Supabase projects are in use, no
local Docker: `SnapRecipe` (dev) and `SnapRecipe_live` (prod).

## Desired End State

Both hosted projects have identical schema: relational tables + storage bucket, all RLS-scoped
per user. `src/types.ts` reflects it. Dev has a few seeded sample rows for manual testing;
prod stays empty.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Ingredient modeling | Separate `recipe_ingredients` table | Standard relational modeling, clean indexing, supports future per-ingredient annotations (FR-011) without a later migration | Plan |
| Ingredient search matching | Raw text, case-insensitive query-time match | No extra column/sync logic; low qps makes an index unnecessary | Plan |
| Recipe `type` field | Postgres enum | DB-level validity guarantee; Supabase generates a proper TS union type | Plan |
| Recovery window (FR-020) | 30 days via `deleted_at` timestamp | Matches the roadmap's own suggested default; tunable later without a migration | Plan |
| Storage bucket | Created now, in F-02 (not deferred to S-01) | Keeps all data-layer security decisions in one reviewable place | Plan |
| TypeScript types | Generated and committed to `src/types.ts` | S-01/S-02/S-03 need these immediately; CLAUDE.md convention | Plan |
| Seed data | Small dev-only seed script, using an existing real dev user | Enables manual verification without building any UI yet | Plan |

**Parked**: an "opt-in global recipe pool" idea (share deleted recipes instead of purging) was
raised during planning — out of scope here; conflicts with the current PRD's private-only MVP
scope and raises consent/copyright questions needing real product shaping. Noted in
`change.md`, not built.

## Scope

**In scope:** `recipes` + `recipe_ingredients` tables, RLS on both, `recipe-photos` storage
bucket + RLS, generated `src/types.ts`, a dev-only seed script, applying all of the above to
both `SnapRecipe` and `SnapRecipe_live`.

**Out of scope:** any API routes, service layer, or UI (S-01's job); `note` field (FR-010,
parked); custom type tags (FR-012, parked); search indexing beyond plain `ILIKE`; an automatic
purge job for the 30-day soft-delete window; the "global recipe pool" idea.

## Architecture / Approach

Two migration files (relational schema, then storage bucket) applied to `SnapRecipe` first
with full manual verification, then pushed unchanged to `SnapRecipe_live`. Types are generated
from the verified dev schema, not a first draft. No local Docker Supabase is involved anywhere
in this flow — migrations push directly to each hosted project via the Supabase CLI.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Relational schema (dev) | `recipes` + `recipe_ingredients` tables, RLS, trigger | Supabase CLI not yet authenticated locally — `supabase login` needed first |
| 2. Storage bucket (dev) | Private `recipe-photos` bucket + RLS | `storage.objects` ownership column name varies by version — must verify before writing policies |
| 3. Types + seed data (dev only) | `src/types.ts`, sample rows for manual testing | None significant |
| 4. Apply to production | Same schema live on `SnapRecipe_live` | Wrong project linked = migration applied to the wrong project — always confirm the linked ref before pushing |

**Prerequisites:** `supabase login` (interactive), access to both Supabase project dashboards.
**Estimated effort:** ~1 session, 4 phases — schema + CLI work, no application code.

## Open Risks & Assumptions

- Assuming `supabase db push` works against a linked remote project without requiring a local
  Docker stack — consistent with documented CLI behavior for migration-file-based pushes, but
  unverified in this specific environment until Phase 1 runs.
- Assuming the existing dev user UUID (`0501ce12-98e9-4b29-b48c-df74d3a7a41b`) is still valid
  and belongs to `SnapRecipe` (not `SnapRecipe_live`) — as stated during planning.

## Success Criteria (Summary)

- `recipes` + `recipe_ingredients` exist in both projects with RLS enforced per user.
- `recipe-photos` bucket exists in both projects, private, with matching per-user RLS.
- `src/types.ts` compiles and reflects the schema; dev has seed data, prod does not.
