---
date: 2026-08-19T11:38:36+02:00
researcher: Konrad Kolodziejski
git_commit: 349637457f3f8ad46c40b1304614372d524c19f6
branch: main
repository: CookBook
topic: "Cross-user access & reference integrity — grounding for test-plan §3 Phase 2 (risks #4, #6)"
tags: [research, codebase, rls, storage, supabase, testing, recipes, photo_path]
status: complete
last_updated: 2026-08-19
last_updated_by: Konrad Kolodziejski
---

# Research: Cross-user access & reference integrity — grounding for test-plan §3 Phase 2

**Date**: 2026-08-19T11:38:36+02:00
**Researcher**: Konrad Kolodziejski
**Git Commit**: 349637457f3f8ad46c40b1304614372d524c19f6
**Branch**: main
**Repository**: CookBook

## Research Question

Ground `test-plan.md` §3 Phase 2 ("Cross-user access & reference integrity", risks #4 and #6)
in the current codebase before planning:

- **#4**: What do the current RLS policies on `recipes`, `recipe_ingredients`, and
  `storage.objects` (bucket `recipe-photos`) actually enforce, and how would a test seed two
  distinct authenticated users to verify that enforcement against a real Postgres instance
  (not a mock)?
- **#6**: How is a recipe's `photo_path` populated end-to-end, and does any code path let a
  client (or a direct insert) set it to point at a storage object the acting user doesn't own?

## Summary

**Risk #4 (cross-user RLS isolation) is enforced today, and the mechanism is fully mapped.**
Every table in scope (`recipes`, `recipe_ingredients`, `storage.objects` for bucket
`recipe-photos`) has RLS enabled with four per-operation policies (`select`/`insert`/`update`/
`delete`), all scoped to `auth.uid()`, wrapped in `(select auth.uid())` per Supabase's RLS
performance guidance. `recipe_ingredients` has no direct `user_id` column, so its policies use
an `exists` subquery back to `recipes.user_id`. There is no `SECURITY DEFINER` function that
bypasses these checks against a *different* user's data — the two `edit_recipe` RPC variants
are `security definer` but re-implement an equivalent `user_id = auth.uid()` ownership guard
manually before touching any row. **No local Supabase stack has ever actually been run** in
this repo — `supabase/config.toml` has stock default ports, but every prior Supabase-touching
change explicitly chose the two-hosted-project (`db push`) topology instead and noted the local
Docker stack "isn't in use here." This rollout phase would be the first time `npx supabase
start` is exercised in practice. No admin/service-role client, no second-test-user helper, and
no separate Vitest config for an integration layer exist yet — all of that is new territory.

**Risk #6 (`photo_path` cross-user reference) is *not* enforced at the database layer — only by
application convention, and this is a known, previously-accepted gap.** `recipes.photo_path` is
a plain `text not null` column with zero FK, CHECK constraint, or trigger tying it to
`storage.objects`. The `recipes` RLS insert/update policies only check `user_id = auth.uid()`
and say nothing about `photo_path`. In the *current* code, this is not exploitable through the
app's own UI/API: `POST /api/recipes` (the only write path for `photo_path`) generates the
storage key itself — `${user.id}/${crypto.randomUUID()}.${ext}` — immediately before use and
never reads a `photo_path` field from the request body at all. But this protection lives
entirely in that one route's logic, not in the schema. This was an explicit, recorded decision:
the archived `recipe-data-schema` implementation review flagged this exact gap (finding F2,
observation severity) and deferred it to the photo-upload feature, which "resolved" it purely
at the application level. **A direct insert against `recipes` (bypassing the app's route
entirely — the scenario risk #6 and the change's stated intent explicitly call for) is
currently not blocked by anything in the database.** This is the central finding research
surfaces for planning: the test for #6 must decide whether it's *characterizing an accepted,
currently-unmitigated gap* (test proves the gap exists, documents it as a known risk) or whether
this rollout phase is also expected to *close* it with a DB-level constraint — that's a planning
decision, not a research one, but the current state is unambiguous: no DB-level protection
exists for this scenario today.

## Detailed Findings

### RLS policies — `recipes`

`supabase/migrations/20260815132912_recipe_schema.sql:25-67` defines the table and its RLS.
Table (`:25-34`): `id`, `user_id uuid not null references auth.users(id) on delete cascade`,
`name`, `type recipe_type not null`, `photo_path text not null`, `created_at`/`updated_at`,
`deleted_at timestamptz` (soft-delete marker). `instructions text check (char_length(...) <=
5000)` was added later, `supabase/migrations/20260816180000_add_recipe_instructions.sql:2`.

RLS enabled at `:46`. Four policies (`:48-67`), all `to authenticated`:

```sql
create policy recipes_select_own on recipes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy recipes_insert_own on recipes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy recipes_update_own on recipes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy recipes_delete_own on recipes for delete to authenticated
  using ((select auth.uid()) = user_id);
```

Table-level grant (RLS is meaningless without a base grant first):
`supabase/migrations/20260816153000_grant_app_tables_to_authenticated.sql:5` —
`grant select, insert, update, delete on recipes to authenticated;`. That migration's own
comment (`:1-4`) explains it exists because the original `create table` never granted
table-level privileges, so every query failed with `permission denied for table` regardless of
RLS until this migration landed.

**Gap for #6, confirmed at the policy level**: `recipes_insert_own`'s `with check` only
constrains `user_id`. Nothing in this policy — or anywhere else — constrains `photo_path`.

No later migration alters or drops any of the above; this is the live, current policy set.

### RLS policies — `recipe_ingredients`

`supabase/migrations/20260815132912_recipe_schema.sql:70-132`. Table (`:70-76`) confirmed to
have **no direct `user_id` column** — `id`, `recipe_id uuid not null references recipes(id) on
delete cascade`, `name`, `position`, `created_at`. RLS enabled `:80`. All four policies
(`:83-132`) key off an `exists` subquery back to the parent recipe's ownership, e.g. select:

```sql
create policy recipe_ingredients_select_own on recipe_ingredients for select to authenticated
  using (exists (select 1 from recipes r
                 where r.id = recipe_ingredients.recipe_id and r.user_id = (select auth.uid())));
```

Insert/update/delete mirror this shape. The insert policy's `with check` evaluates against
`NEW.recipe_id`, so a user cannot attach an ingredient row to a `recipe_id` they don't already
own — this is a distinct, independently-enforced check from the `recipes` table's own RLS, and
worth its own assertion in a cross-user test (inserting an ingredient row pointing at another
user's `recipe_id` should fail even though the acting user is otherwise fully authenticated).
Grant: `supabase/migrations/20260816153000_grant_app_tables_to_authenticated.sql:6`.

### RLS policies — `storage.objects` (bucket `recipe-photos`)

`supabase/migrations/20260815134500_recipe_photos_bucket.sql` (full file, 43 lines). Bucket
creation (`:1-4`): `insert into storage.buckets (id, name, public) values ('recipe-photos',
'recipe-photos', false) on conflict (id) do nothing;` — private bucket.

Ownership column is `owner` (uuid), confirmed by an inline comment (`:6-7`) recording that it
was chosen because it type-matches `auth.uid()` directly (the alternative, `owner_id`, is typed
`text` and would need an explicit cast). Four policies (`:8-43`), all `to authenticated`,
scoped `bucket_id = 'recipe-photos' and owner = (select auth.uid())` for select/insert/
update/delete. No later migration touches `storage.objects` or this bucket — this is the
complete, current policy set. No explicit `grant ... on storage.objects to authenticated`
appears in this repo's migrations (Supabase's storage schema grants base access at project
bootstrap, outside migration history — this repo has no migration recreating that grant, so it
can't be quoted from here, only inferred as platform-level).

### `SECURITY DEFINER` bypass surface (relevant to a cross-user RLS test's threat model)

Three `security definer` functions exist, none of which bypass ownership checks against a
*different* user's data:

- `reserve_extraction_attempt(p_cap integer)` —
  `supabase/migrations/20260816160000_atomic_extraction_rate_limit.sql:19-41`. Touches only
  `extraction_daily_counters` (out of scope for #4/#6), self-scopes via
  `v_user_id := (select auth.uid())`.
- `edit_recipe(...)` (original 4-arg) —
  `supabase/migrations/20260816170000_atomic_recipe_ingredient_edit.sql:5-43` — later dropped
  and replaced.
- `edit_recipe(...)` (current 5-arg, adds `p_instructions`) —
  `supabase/migrations/20260816190000_edit_recipe_instructions.sql:8-47`. The old overload is
  explicitly dropped first (`:6`) to avoid a stale RPC surface. Re-implements the ownership
  guard manually: `update recipes ... where id = p_recipe_id and user_id = v_user_id and
  deleted_at is null` (`:21-24`); if zero rows match, returns `false` (`:28-33`) *before*
  touching `recipe_ingredients`. The subsequent unconditional `delete from recipe_ingredients
  where recipe_id = p_recipe_id` (`:39`) and re-insert (`:41-43`) are not independently
  re-checked against `v_user_id`, but are only reachable after the ownership-gated early
  return — not directly exploitable today, but worth flagging: because this function is
  `security definer`, RLS provides **no backstop** here at all if a future edit to this
  function ever reorders or removes its manual ownership check. A test asserting `edit_recipe`
  rejects another user's `p_recipe_id` (returns `false` / no rows affected) is a reasonable,
  narrow addition alongside the direct-table RLS tests, since this specific code path is RLS's
  one blind spot in the current schema.

No `SECURITY DEFINER` trigger functions exist. The only trigger, `set_updated_at()`
(`supabase/migrations/20260815132912_recipe_schema.sql:14-22`, attached `:41-44`), is a plain
(non-definer) function with no RLS interaction.

### `photo_path` — no database-level referential integrity to `storage.objects`

Confirmed via full-repo grep and full migration read: `recipes.photo_path` is declared only as
`photo_path text not null`
(`supabase/migrations/20260815132912_recipe_schema.sql:30`) — a free-text column. No FK, CHECK
constraint, or trigger anywhere in `supabase/migrations/` ties it to `storage.objects`. The
`recipes_insert_own`/`recipes_update_own` policies (above) only check `user_id`.

This is a **known, previously-recorded gap**, not a new finding:

- `context/archive/2026-08-15-recipe-data-schema/reviews/impl-review.md:39-53` — finding F2
  (observation severity): *"`recipes.photo_path` has no validation tying it to the calling
  user's own storage object... nothing stops a user from inserting a recipe row whose
  `photo_path` guesses/references another user's object key, which would just fail to resolve
  via storage RLS rather than leak anything. Worth deciding whether to validate the path at the
  API layer once S-01 (photo upload) exists to consume this column."* Decision recorded there:
  *"No action needed now — this is schema-only; defer the decision to S-01."*
- `context/archive/2026-08-15-photo-to-recipe-save/change.md:21-24` — records how S-01 actually
  resolved that deferral: *"This plan's persistence phase always derives `photo_path` from the
  Storage upload response completed earlier in the same request — never from client input — so
  no additional validation is needed at the API layer."* I.e., the gap was closed by **an
  application-code convention**, not a schema change.

### `photo_path` population — traced end-to-end in the current route

`src/pages/api/recipes.ts` is the **only** place in `src/` that writes `photo_path`, and the
only place that calls `.storage.from(...).upload(...)`. There is no separate upload API route —
`PhotoUploadForm.tsx` posts the raw file directly to this one endpoint.

- `src/pages/api/recipes.ts:20-27` — `photoSchema` (zod) validates only the uploaded `File`
  itself (MIME type, size). There is no zod field for `photo_path`, because the client never
  sends one — request body is `multipart/form-data` with a single `photo` field.
- `src/pages/api/recipes.ts:104` — `extractRecipeFromPhoto(bytes, photo.type)` runs first, on
  the in-memory bytes, before any Storage write (matches the ordering decision recorded in
  `context/archive/2026-08-15-photo-to-recipe-save/plan.md:85-88`: extract before uploading, so
  a failed extraction never orphans a Storage object).
- `src/pages/api/recipes.ts:116` — the storage key is generated **entirely server-side** from
  the authenticated session's own id: `const storagePath = \`${user.id}/${crypto.randomUUID()}.${extensionFromMimeType(photo.type)}\`;` where `user.id` is `context.locals.user.id`.
- `src/pages/api/recipes.ts:117-119` — upload to that exact key: `.storage.from("recipe-photos").upload(storagePath, bytes, { contentType: photo.type })`.
- `src/pages/api/recipes.ts:125-135` — the `recipes` insert uses the **same local variable**,
  `storagePath`, computed two steps earlier in the same function invocation: `.insert({
  user_id: user.id, name: result.name, type: result.type ?? "other", photo_path: storagePath,
  instructions: result.instructions })`.

`PhotoUploadForm.tsx:84-93` confirms the client side never learns of or forwards a storage
path — it only ever sends the raw `File` via `FormData` to `POST /api/recipes`.

Other recipe routes confirmed to never touch `photo_path`: `src/pages/api/recipes/[id]/index.ts`
`PATCH` (validates `name`/`type`/`ingredients`/`instructions` only, calls `edit_recipe` RPC) and
`DELETE` (only sets `deleted_at`); `src/pages/api/recipes/trash.ts`,
`src/pages/api/recipes/[id]/restore.ts`, `src/pages/api/recipes/[id]/type.ts`. The `edit_recipe`
RPC definitions contain no reference to `photo_path` or `storage`.

`src/lib/services/recipe-extraction.ts` never references `photo_path` or storage at all — it
only takes raw bytes + mime type and returns extracted fields.

**Conclusion for #6**: through the app's own UI/API, this is not exploitable today — the write
path never accepts a client-supplied path, and Storage RLS additionally guarantees the uploaded
object's `owner` matches the acting user (a second, independent backstop). But this is **entirely
an application-layer guarantee**. Nothing in the schema would catch a direct insert (bypassing
`POST /api/recipes`) that sets `photo_path` to another user's real object key while satisfying
`recipes_insert_own`'s `user_id = auth.uid()` check — which is exactly the scenario risk #6 and
the change's stated intent (*"even when the insert path is exercised directly"*) ask to be
proven. **A test written against a real Postgres instance, authenticated as user A, inserting a
`recipes` row with `user_id = A` and `photo_path` set to a real object key owned by user B, is
expected to currently succeed** — i.e., the test as scoped will demonstrate the gap is real and
unmitigated at the DB layer, not that it's already blocked. See Open Questions below — this has
a direct consequence for what `/10x-plan` needs to decide.

### Test infrastructure — current state and what's missing for a real-Postgres layer

**Scripts** (`package.json:5-14`): only `"test": "vitest run"` — no unit/integration split, no
watch/coverage scripts.

**Dependencies**: `@supabase/ssr@^0.10.3`, `@supabase/supabase-js@^2.99.1` (dependencies);
`supabase@^2.23.4` (devDependency, the CLI). No admin/service-role client pattern exists
anywhere in `src/` — `service_role` only appears in `context/` planning docs, never in code.

**`vitest.config.ts`** (full, 19 lines): `environment: "node"`, single flat `test` block, no
`include`/`exclude` overrides, no `workspace`/`projects` concept. There is currently **no
mechanism to run a separate config for integration vs. unit tests** — this rollout phase would
need to introduce one from scratch (a Vitest workspace/projects array, a second config file, or
an `include`/`exclude` split on a filename convention such as `*.integration.test.ts`).
`vitest.setup.ts` only wires `@testing-library/jest-dom` + RTL `cleanup()` — nothing
Supabase-related.

**Existing mocked-Supabase convention** (for contrast, per `test-plan.md` §4's note that Phase 2
must *add* a real-Postgres layer *alongside* this, not replace it):
- `src/pages/api/recipes.test.ts:9` — `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))` replaces the entire module. A hand-built `mockSupabaseClient(config)` (`:40-95`) fabricates a strict per-table allowlist mock (`extraction_attempts`, `recipes`, `recipe_ingredients`), each exposing only the methods the route uses, with `mockReturnThis()`/`mockResolvedValue`. Auth is faked via `makeContext()` (`:97-113`) setting `locals.user` directly — real session/cookie handling and RLS are never exercised.
- `src/lib/services/recipe-query.test.ts` — no `vi.mock`; instead a thenable `makeQueryBuilder(result)` (`:9-22`) mock is passed directly into `listRecipes`/`getRecipeDetail` as a parameter. Assertions check that the code *constructs* the right filter calls (`expect(client.builder.eq).toHaveBeenCalledWith("user_id", "user-1")`) — never that Postgres/RLS actually *enforces* anything. This is precisely the gap the new integration layer exists to close.

**`src/lib/supabase.ts`** (full, 25 lines) — single exported `createClient(requestHeaders,
cookies)` factory, requires live `Headers`/`AstroCookies` (SSR request context), uses only the
anon `SUPABASE_KEY`. No admin client, no second-user client factory. Both need to be built from
scratch for a test that authenticates as two distinct users and/or needs to seed data bypassing
RLS.

**Local Supabase stack — never actually exercised**: `supabase/config.toml` (full file read)
has stock CLI-default ports (API 54321, DB 54322, shadow 54320, Studio 54323, major_version 17)
— nothing customized beyond `project_id`. Grep for `supabase start` / `SERVICE_ROLE` across the
repo hits only documentation: `CLAUDE.md:50` and `AGENTS.md:40` ("Local Supabase: `npx supabase
start` (requires Docker)"), and `test-plan.md:92` itself. Every prior Supabase-touching change
(`recipe-data-schema`, `supabase-auth-setup`) explicitly chose the two-hosted-project topology
(`supabase link` + `db push`) and recorded that the local Docker stack "isn't in use here" (e.g.
`context/archive/2026-08-15-supabase-auth-setup/plan.md:31,60,88`). **This rollout phase would
be the first time `npx supabase start` is actually exercised in this repo**, even though Docker
is already documented as an assumed dev-environment capability.

**CI**: `.github/workflows/ci.yml` (full, 45 lines) — `ci` job runs lint + build only (with
`SUPABASE_URL`/`SUPABASE_KEY` secrets for the build step). `npm run test`/`vitest` is never
invoked in CI at all today (confirms test-plan risk #1 — not this phase's job to fix, per
test-plan §3 Phase 4). No Supabase CLI install, no `supabase start`, no migration-apply step.

**Two hosted project refs / dev-user UUID**: confirmed these (`xmyeeuyeszvpvrjszohr`,
`gtrhakzhlammvfifvlyf`, `0501ce12-98e9-4b29-b48c-df74d3a7a41b`) appear only in `context/`
planning docs and `supabase/seed-dev.sql` — never in `.env.example` (3 placeholder lines only),
and there is no `.dev.vars.example` file at all. **Tests must not reuse these identifiers or
target either hosted project** — this matches `test-plan.md`'s own constraint (§4: "tests must
not run against either").

## Code References

- `supabase/migrations/20260815132912_recipe_schema.sql:25-67` — `recipes` table + RLS policies
- `supabase/migrations/20260815132912_recipe_schema.sql:70-132` — `recipe_ingredients` table + RLS policies
- `supabase/migrations/20260815132912_recipe_schema.sql:30` — `photo_path text not null`, no constraint
- `supabase/migrations/20260815134500_recipe_photos_bucket.sql:1-43` — `recipe-photos` bucket + storage RLS
- `supabase/migrations/20260816153000_grant_app_tables_to_authenticated.sql:1-6` — base grants (RLS prerequisite)
- `supabase/migrations/20260816190000_edit_recipe_instructions.sql:8-47` — current `edit_recipe` RPC, `security definer`, manual ownership guard
- `src/pages/api/recipes.ts:20-27` — `photoSchema` (zod), file-only validation
- `src/pages/api/recipes.ts:104` — extraction runs before any Storage write
- `src/pages/api/recipes.ts:116` — server-generated `storagePath` from `user.id` + UUID
- `src/pages/api/recipes.ts:117-119` — Storage upload to that key
- `src/pages/api/recipes.ts:125-135` — `recipes` insert reusing the same `storagePath` variable
- `src/components/recipes/PhotoUploadForm.tsx:84-93` — client posts raw file only, never a path
- `src/lib/supabase.ts` (full, 25 lines) — single anon-key client factory, no admin/second-user variant
- `src/pages/api/recipes.test.ts:9,40-113` — current mocked-Supabase convention (strict per-table allowlist mock)
- `src/lib/services/recipe-query.test.ts:9-33` — thenable query-builder mock, asserts calls not DB state
- `vitest.config.ts` (full, 19 lines) — single flat config, `environment: "node"`, no integration/unit split
- `package.json:5-14` — only `"test": "vitest run"`, no split scripts
- `.github/workflows/ci.yml` (full, 45 lines) — lint + build only, no test step
- `supabase/config.toml:27-48,88-102` — stock local-dev ports, never exercised in practice

## Architecture Insights

- **Two independent, unrelated ownership boundaries protect photo data today**: `recipes.user_id`
  (app-level identity) and `storage.objects.owner` (Supabase Storage's own RLS). Nothing links
  them at the schema level — the only thing keeping them in sync is that one route always
  derives both from the same `user.id` in the same request. This is a "convention, not
  constraint" pattern worth naming explicitly in the test-plan cookbook once this phase lands.
- **`security definer` is this schema's one RLS blind spot.** Both `edit_recipe` variants
  re-implement ownership checks manually rather than relying on RLS (since `security definer`
  bypasses RLS entirely). The current implementation is correct, but nothing forces future edits
  to preserve that — worth a narrow test asserting `edit_recipe` rejects cross-user
  `p_recipe_id`, separate from (but adjacent to) the direct-table RLS tests.
- **This project has never run `npx supabase start`.** Every prior Supabase change opted for the
  two-hosted-project (`db push`) topology instead. The local stack config exists (stock
  defaults) but is completely unexercised — Phase 2 is genuinely greenfield for local-Postgres
  integration testing, not just "add a test file."
- **The mocked-Supabase convention is structurally incapable of testing either risk.** Both
  existing test files replace the query builder with a scripted stand-in that returns whatever
  `{ data, error }` was configured, regardless of the actual filter arguments — there is no real
  SQL evaluation, so RLS enforcement and storage-ownership checks are, by construction, outside
  what these tests could ever catch (matching test-plan §4's explicit note that Phase 2 must
  *add* a layer, not extend the existing one).

## Historical Context (from prior changes)

- `context/archive/2026-08-15-recipe-data-schema/plan.md` — original schema plan; records the
  hosted-only topology decision and the `owner` vs `owner_id` column choice for storage RLS.
- `context/archive/2026-08-15-recipe-data-schema/reviews/impl-review.md:39-53` — finding F2, the
  original recording of the `photo_path` gap, deferred (not fixed) to S-01.
- `context/archive/2026-08-15-photo-to-recipe-save/change.md:21-24` — records how S-01 actually
  "resolved" F2's deferral: purely at the application layer, never in the schema.
- `context/archive/2026-08-15-photo-to-recipe-save/plan.md:85-88` — the extract-before-upload
  ordering decision, which is why `storagePath` is always freshly server-generated rather than
  round-tripped from an earlier client step.
- `context/archive/2026-08-15-supabase-auth-setup/plan.md:31,60,88` — earlier, independent
  confirmation that the local Docker/`supabase start` stack was considered and explicitly not
  used for that change either.
- `context/foundation/test-plan.md` §2 Risk Response Guidance (risks #4, #6) and §4 Stack —
  already names the exact grounding this document confirms: RLS policy definitions, seeding two
  authenticated users, `photo_path`'s end-to-end path, and the need for a local-Postgres layer
  alongside (not replacing) the existing mock convention.

## Related Research

None yet under `context/changes/**/research.md` or `context/archive/**/research.md` — this is
the first `/10x-research` artifact in this project's history (the two prior implemented changes
referenced above, `recipe-data-schema` and `photo-to-recipe-save`, went straight from plan-brief
to plan without a separate research phase).

## Open Questions

1. **Scope decision for #6, direct for `/10x-plan`**: should this rollout phase (a) write a test
   that *characterizes* the current gap (a direct insert with a mismatched-owner `photo_path`
   currently succeeds — the test documents/pins this as a known, accepted risk), or (b) also
   *close* the gap with a DB-level constraint/trigger validating `photo_path` against
   `storage.objects.owner` before the test is written to expect denial? Research only confirms
   there is currently no DB-level protection — which of these the phase delivers is a planning
   call, and changes what "risk #6 is now covered" means in the rollout table.
2. **Local Supabase stack bring-up is itself unproven work**, not just test authoring — first
   invocation of `npx supabase start` against 12 existing migrations (Postgres 17, storage,
   auth) in this environment has no prior track record in this repo. Whether `db.seed.sql_paths
   = ["./seed.sql"]` (config.toml default) matters is worth a quick check during planning —
   `supabase/seed-dev.sql` exists but the configured default seed filename (`./seed.sql`) does
   not, so a plain `supabase db reset` would currently seed nothing (not a blocker, just worth
   knowing before relying on auto-seeding for two test users).
3. **Two-test-user provisioning mechanism is undecided.** No existing helper creates or
   authenticates as a second user anywhere in this repo. Options (Supabase Admin API with a
   service-role key against the local stack; direct `auth.users` seed rows; the CLI's test
   fixtures) weren't evaluated here since that's an implementation choice, not a research
   finding — flagging so `/10x-plan` treats it as a first-class design decision rather than an
   afterthought.
