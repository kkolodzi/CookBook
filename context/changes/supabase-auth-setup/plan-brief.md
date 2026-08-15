# Supabase Auth Setup — Plan Brief

> Full plan: `context/changes/supabase-auth-setup/plan.md`

## What & Why

Roadmap item F-01: make Supabase auth actually work end-to-end (sign-up, sign-in, session
resolution via `context.locals.user`) in both local dev and production. This is the first
foundation slice — nothing else on the roadmap (schema, photo-save, search, edit) can be built
or verified without a real authenticated user.

## Starting Point

The auth *code* is already fully built and follows this repo's conventions: SSR Supabase
client, middleware protecting `/dashboard`, sign-in/up/out API routes, and auth pages all
exist and gracefully degrade with a "not configured" banner when credentials are missing.
That banner is currently showing locally (`.dev.vars` still has placeholder `###` values —
`npm run dev` runs on the Cloudflare workerd runtime and reads `.dev.vars`, not `.env`) but is
absent on the deployed Worker, meaning production already has *some* credentials wired — just
unconfirmed which of the two hosted projects they point to.

## Desired End State

Sign-up → sign-in → `/dashboard` works cleanly in both local dev (against the `SnapRecipe` dev
project) and production (confirmed against `SnapRecipe_live`), with email confirmation
disabled in both, and a one-command smoke check to catch this class of regression in future.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Project topology | Two separate hosted Supabase projects (`SnapRecipe` dev, `SnapRecipe_live` prod) | User already has both provisioned; keeps dev data isolated from real users | Plan (user-stated) |
| Existing `.env` credentials | Verify which project they belong to during implementation, don't assume | Avoids wiring a stale/wrong project | Plan |
| Production secret delivery | Leave as-is (already manually wired); verify/correct via Cloudflare dashboard | Direct check showed no "not configured" banner already — no need to add CI automation | Plan |
| Email confirmation | Disabled in both projects | Matches local `config.toml` convention and PRD scope (FR-001/FR-002 don't require it); fastest path for a 2-person MVP launch | Plan |
| Verification | Manual walkthrough (both envs) + lightweight smoke script | Config-only task doesn't warrant a full test suite, but this exact regression (silently missing env vars) is cheap to guard against | Plan |

## Scope

**In scope:**
- Real credentials in `.dev.vars` and `.env` (dev project)
- Confirming/correcting production Worker secrets (live project)
- Disabling email confirmation in both Supabase project dashboards
- A smoke script + a short `CLAUDE.md` note on the two-project topology

**Out of scope:**
- Local Docker Supabase (`supabase start`)
- SMTP / real email confirmation
- CI-based `wrangler secret` automation
- Recipe schema (F-02), OAuth/social login, any new UI

## Architecture / Approach

No new architecture — this is credential wiring across two runtimes (Cloudflare workerd dev
via `.dev.vars`, deployed Worker via Cloudflare-managed secrets) against two hosted Supabase
projects, plus one dashboard toggle per project and a cheap automated guard.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Local dev wiring | `npm run dev` fully authenticates against `SnapRecipe` | Wrong/stale credentials copied from `.env` |
| 2. Production verification/fix | Deployed Worker confirmed (or corrected) to use `SnapRecipe_live` | Can't inspect Worker secrets without dashboard access — must verify manually |
| 3. Smoke script + doc note | One-command regression check + topology recorded for future work | Low risk — additive only |

**Prerequisites:** Access to both Supabase project dashboards and the Cloudflare dashboard for `snap-recipe`.
**Estimated effort:** ~1 session, 3 phases — this is configuration, not development.

## Open Risks & Assumptions

- Assuming production's currently-set credentials point at *some* valid project (confirmed via
  absent banner) but not yet confirmed to be `SnapRecipe_live` specifically — Phase 2 resolves
  this.
- Assuming the `.env` file's existing credentials belong to one of the two known projects
  (`SnapRecipe` or `SnapRecipe_live`) rather than a third, forgotten project — worth a quick
  sanity check against the dashboard during Phase 1.

## Success Criteria (Summary)

- A user can sign up and sign in locally and in production, landing on `/dashboard` with a
  resolved `context.locals.user`.
- Neither environment shows the "Supabase not configured" banner.
- `node scripts/check-auth-config.mjs <url>` exits `0` for both environments.
