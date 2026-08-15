# Supabase Auth Setup Implementation Plan

## Overview

Roadmap item **F-01**: the Supabase project has valid, working credentials in both local dev
and the deployed environment; sign-up and sign-in succeed end-to-end; an authenticated user is
resolvable via `context.locals.user`. The auth *code* already exists and follows this repo's
conventions — this plan wires real credentials and verifies the flow, it does not build new
auth functionality.

## Current State Analysis

- **Code**: `src/lib/supabase.ts` (SSR client via `@supabase/ssr`), `src/middleware.ts`
  (resolves `context.locals.user`, redirects unauthenticated users away from `/dashboard`),
  `src/pages/api/auth/{signin,signup,signout}.ts`, and `src/pages/auth/{signin,signup,confirm-email}.astro`
  are all present and already gracefully degrade with a "Supabase not configured" banner
  (`src/lib/config-status.ts`, rendered from `src/layouts/Layout.astro`) when credentials are
  missing.
- **Local dev is broken**: `.dev.vars` — the file `npm run dev` actually reads, since this
  project's dev server runs on the Cloudflare workerd runtime — still holds the `###`
  placeholder values from `.env.example`. `.env` (a separate, Node-style file) does hold
  real-looking credentials, but that's not the file the Cloudflare dev runtime consults.
- **Production already appears configured**: a direct check of
  `https://snap-recipe.dragonow34.workers.dev/auth/signin` and `/auth/signup` shows no
  "not configured" banner, so the deployed Worker already has *some* `SUPABASE_URL`/
  `SUPABASE_KEY` set. Which of the two hosted projects those values point to hasn't been
  confirmed from outside — that needs a dashboard check, not an assumption.
- **Two hosted Supabase projects exist**: `SnapRecipe` (dev) and `SnapRecipe_live` (prod).
  No local Docker Supabase is in use — `supabase/config.toml` was scaffolded by the starter
  but its `[auth]` block (`enable_confirmations = false`, `site_url`) only applies to a local
  `supabase start` stack, which this plan does not use.
- **No migrations**: `supabase/` has no `migrations/` directory yet — schema work is a
  separate roadmap item (F-02), out of scope here.

## Desired End State

Both environments authenticate real users without the "not configured" banner:

- Local dev (`npm run dev`, credentials from the `SnapRecipe` project): sign-up → sign-in →
  `/dashboard` works end-to-end.
- Production (`https://snap-recipe.dragonow34.workers.dev`, credentials confirmed to be from
  the `SnapRecipe_live` project): the same flow works end-to-end.
- Email confirmation is disabled in both projects' dashboards, so sign-up produces an
  immediately-usable account.
- A smoke script can verify "not configured" is absent in either environment on demand.

### Key Discoveries:

- `npm run dev` reads `.dev.vars`, not `.env` — editing `.env` alone does not fix local dev
  (`src/lib/supabase.ts:3`, `astro.config.mjs` `env.schema`, both `SUPABASE_URL`/`SUPABASE_KEY`
  declared `context: "server"`).
- The "not configured" banner is rendered globally via `src/layouts/Layout.astro:23`, so any
  page (signin, signup, dashboard) surfaces missing config — useful as the smoke-script signal.
- `src/pages/auth/confirm-email.astro` branches purely on `import.meta.env.DEV`, not on the
  Supabase project's actual email-confirmation setting — the "check your email" copy always
  shows in production regardless of whether confirmation is actually required.

## What We're NOT Doing

- Not standing up a local Docker Supabase stack (`supabase start`) — both environments use
  hosted projects per the chosen topology.
- Not configuring SMTP / enabling real email confirmation — confirmations stay disabled in
  both projects, per PRD scope (FR-001/FR-002 don't require email verification) and the
  two-person MVP launch.
- Not adding CI-based `wrangler secret` automation — production secrets already appear to be
  set; this plan verifies/corrects them, it doesn't change how they're delivered.
- Not touching `supabase/config.toml`'s `[auth]` block — it's inert for this topology (no
  local Docker stack).
- Not building recipe schema, OAuth/social login, or any UI beyond what already exists.

## Implementation Approach

Treat this as configuration + verification, not development: populate the two credential
files/dashboards that are actually missing values, confirm the one dashboard setting whose
state is currently unknown (which project production points to), then add a cheap automated
guard against this exact class of regression recurring silently.

## Critical Implementation Details

- **Env var resolution differs by runtime.** `.dev.vars` feeds the Cloudflare workerd runtime
  that `npm run dev` actually runs on; `.env` is a separate Node-style file. Both should be set
  to the same `SnapRecipe` (dev) values for consistency across any Node-based tooling, but
  `.dev.vars` is the one that fixes `npm run dev` — don't stop after editing only `.env`.
- **Email confirmation is a per-project dashboard toggle, not a repo file.** Each hosted
  Supabase project (`SnapRecipe`, `SnapRecipe_live`) has its own Authentication → Sign In /
  Up → "Confirm email" setting in the Supabase dashboard. `supabase/config.toml`'s
  `enable_confirmations = false` has no effect on either hosted project — it only governs a
  local `supabase start` stack, which isn't in use here.

## Phase 1: Local dev wiring

### Overview

Get `npm run dev` fully working against the `SnapRecipe` (dev) project.

### Changes Required:

#### 1. Local dev credentials

**File**: `.dev.vars`

**Intent**: Replace the `###` placeholder `SUPABASE_URL`/`SUPABASE_KEY` values with the real
`SnapRecipe` (dev) project's URL and publishable/anon key, so the Cloudflare workerd dev
runtime resolves `astro:env/server` correctly.

**Contract**: Two `KEY=VALUE` lines, same shape as `.env.example`.

#### 2. Node-tooling credentials

**File**: `.env`

**Intent**: Align with the same `SnapRecipe` (dev) project credentials, for consistency with
any Node-based tooling that reads `process.env` directly (e.g. `astro sync`).

**Contract**: Same two keys as `.dev.vars`.

#### 3. Disable email confirmation (dev project)

**File**: n/a — Supabase dashboard, `SnapRecipe` project, Authentication → Sign In / Up settings

**Intent**: Turn off "Confirm email" so sign-up completes without a real email round-trip,
matching the `enable_confirmations = false` convention already established for local dev.

**Contract**: Confirm email toggle = off.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds locally with `.dev.vars` populated
- `npm run lint` passes

#### Manual Verification:

- `npm run dev`, visit `/auth/signin` and `/auth/signup` — no "Supabase nie jest
  skonfigurowany" banner
- Sign up with a test account; redirected to `/auth/confirm-email` showing the DEV
  auto-confirmed variant
- Sign in with that account; redirected to `/dashboard` and the page renders (not bounced
  back to `/auth/signin`)

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 2: Production verification/fix

### Overview

Confirm (and correct if needed) that the deployed Worker's Supabase credentials point at
`SnapRecipe_live`, and disable email confirmation there too.

### Changes Required:

#### 1. Confirm/correct production secret values

**File**: n/a — Cloudflare dashboard, Workers & Pages → `snap-recipe` → Settings → Variables
and Secrets

**Intent**: Verify the currently-set `SUPABASE_URL`/`SUPABASE_KEY` match the `SnapRecipe_live`
project (not the dev project); correct them if they don't.

**Contract**: Worker secret values equal `SnapRecipe_live` project's URL + publishable key.

#### 2. Disable email confirmation (live project)

**File**: n/a — Supabase dashboard, `SnapRecipe_live` project, Authentication → Sign In / Up
settings

**Intent**: Same as Phase 1 item 3, for the live project.

**Contract**: Confirm email toggle = off.

### Success Criteria:

#### Manual Verification:

- Visit `https://snap-recipe.dragonow34.workers.dev/auth/signin` and `/auth/signup` — confirm
  no "not configured" banner (re-verify after any secret correction)
- Sign up with a test account against production; the PROD variant of the confirm-email page
  displays but does not block sign-in (confirmation is disabled, so the account is immediately
  usable)
- Sign in with that account; redirected to `/dashboard`

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful
before proceeding to the next phase.

---

## Phase 3: Smoke script + doc note

### Overview

Add a one-command way to catch this exact class of regression (missing/placeholder
credentials) automatically, and record the two-project topology for future work.

### Changes Required:

#### 1. Smoke check script

**File**: `scripts/check-auth-config.mjs`

**Intent**: Fetch `/auth/signin` from a given base URL and fail (non-zero exit) if the
response body contains the Supabase-"not configured" message, so this regression is caught
with one command instead of manually hunting for the banner.

**Contract**: Accepts a base URL as its CLI arg (default `http://localhost:4321`, Astro's
default dev port); exits `1` if the banner text is found, `0` otherwise.

#### 2. Record project topology

**File**: `CLAUDE.md`

**Intent**: Note the two-Supabase-project split (`SnapRecipe` dev vs. `SnapRecipe_live` prod)
under the existing `### Environment` section, so future foundation work (e.g. F-02 schema
migrations) targets the correct project per environment.

**Contract**: Short addition to the `### Environment` section — no restructuring.

### Success Criteria:

#### Automated Verification:

- `node scripts/check-auth-config.mjs http://localhost:4321` exits `0` (with `npm run dev`
  running)
- `node scripts/check-auth-config.mjs https://snap-recipe.dragonow34.workers.dev` exits `0`

#### Manual Verification:

- Review the `CLAUDE.md` diff for accuracy

---

## Testing Strategy

### Manual Testing Steps:

1. Local: sign up → confirm-email (dev variant) → sign in → `/dashboard` renders
2. Production: sign up → confirm-email (prod variant, non-blocking) → sign in → `/dashboard`
   renders
3. Run the smoke script against both base URLs and confirm exit code `0`

## Performance Considerations

Not applicable — configuration-only change, no new code paths under load.

## Migration Notes

Not applicable — no schema or data changes in this plan (see F-02 for schema work).

## References

- Roadmap item: `context/foundation/roadmap.md` (F-01)
- PRD refs: FR-001, FR-002 (`context/foundation/prd.md`)
- Deployed Worker: `https://snap-recipe.dragonow34.workers.dev`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Local dev wiring

#### Automated

- [x] 1.1 `npm run build` succeeds locally with `.dev.vars` populated
- [x] 1.2 `npm run lint` passes

#### Manual

- [x] 1.3 No "not configured" banner on `/auth/signin` and `/auth/signup` locally
- [x] 1.4 Sign-up redirects to `/auth/confirm-email` (DEV variant)
- [x] 1.5 Sign-in redirects to `/dashboard` and the page renders

### Phase 2: Production verification/fix

#### Manual

- [ ] 2.1 No "not configured" banner on the deployed signin/signup pages
- [ ] 2.2 Sign-up against production succeeds (PROD confirm-email variant, non-blocking)
- [ ] 2.3 Sign-in against production redirects to `/dashboard`

### Phase 3: Smoke script + doc note

#### Automated

- [ ] 3.1 Smoke script exits `0` against `http://localhost:4321`
- [ ] 3.2 Smoke script exits `0` against `https://snap-recipe.dragonow34.workers.dev`

#### Manual

- [ ] 3.3 `CLAUDE.md` diff reviewed for accuracy
