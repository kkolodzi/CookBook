# SnapRecipe UI & Navigation Cleanup — Plan Brief

> Full plan: `context/changes/update-ui/plan.md`

## What & Why

The app still looks and routes like the unmodified Astro starter kit: the landing page pitches
"10x Astro Starter," and signing in drops the user on a placeholder `/dashboard` "select action"
screen instead of their recipes. Two smaller UX gaps compound this: no thumbnail confirms which
photo was just uploaded, and the recipe list can look stale after adding one. This plan rebrands
the app as SnapRecipe, makes `/recipes` the true post-login home, gives logout a permanent place,
and fixes both reported gaps.

## Starting Point

`Welcome.astro` (the `/` page) is the stock Astro starter template. `Topbar.astro` — the only
component with a logout button — renders only on that landing page. `/dashboard` is a placeholder
nobody actually needs to redirect to (sign-in already lands on `/`). `PhotoUploadForm` has no path
back to `/recipes` after a save, which is the likely root cause of the stale-list report (browser
Back button serving a cached page, since the app sets no cache headers). `POST /api/recipes`
never returns a photo URL, even though the list view already shows thumbnails fine.

## Desired End State

A logged-out visitor sees a SnapRecipe-branded landing page; a logged-in visitor (or one who just
signed in) lands straight on `/recipes`. `/dashboard` is gone. Every recipe page has a small
header with the app name, the user's email, and sign-out. Uploading a photo shows its thumbnail
in the confirmation, then auto-navigates back to a `/recipes` list that actually shows the new
recipe.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| App name | SnapRecipe | Already the PRD's product name, just never surfaced in the UI | Plan (question round) |
| Root route (`/`) for logged-in users | Redirect to `/recipes` | A returning user shouldn't see a sign-up pitch for their own app | Plan (question round) |
| Landing page scope | Full content rewrite | The 3 existing feature cards (auth/stack/DX) are dev-tooling copy, irrelevant to an end user | Plan (question round) |
| `/dashboard`'s fate | Delete entirely | Nothing links to it once post-login goes to `/recipes` and logout lives in the shared header | Plan (question round) |
| Where logout/nav lives | Shared header on all 4 recipe pages | Logout must be reachable no matter which recipe page a user lands on directly | Plan (question round) |
| Stale-list fix | Explicit redirect from `PhotoUploadForm`, not cache headers | Directly fixes the reported symptom, matches `RecipeEditForm`'s proven pattern; simpler than a caching-policy change | Plan (question round) |
| Thumbnail scope | Post-upload confirmation card only | List view (`RecipeCard`) already shows thumbnails — only the confirmation card was missing one | Plan (question round) |
| Post-upload navigation | Auto-redirect after ~2s | Consistent with the edit form's existing UX; user still gets a moment to see the confirmation | Plan (question round) |
| Type-nudge interaction | Skip auto-redirect while the nudge is showing | Auto-navigating away would cut off an action the user still needs to take | Plan (follow-up question) |

## Scope

**In scope:**
- Landing page (`Welcome.astro`) content rewrite + default page title
- `Topbar.astro` repointed and reused across all 4 recipe pages
- Middleware: authenticated `/` → `/recipes`; `/dashboard` deleted
- `POST /api/recipes` returns a signed photo URL; `PhotoUploadForm` renders it
- `PhotoUploadForm` auto-redirects to `/recipes` after a successful, fully-confirmed save

**Out of scope:**
- `Cache-Control` header changes
- Pre-upload local file preview
- Any redesign of the list/detail/edit pages beyond the header
- Keeping `/dashboard` as a redirect stub
- `RecipeBrowser.tsx`'s search/fetch logic

## Architecture / Approach

No database changes. Five small, mostly-independent phases: content rewrite, one middleware rule
+ one file deletion, one component reused in four places, one API field + its UI consumer, and
one client-side navigation addition with a documented exception for the type-confirmation nudge.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Landing page rebrand | SnapRecipe-branded `/`, default page title | None — content only |
| 2. Root redirect + dashboard removal | `/` → `/recipes` when logged in; `/dashboard` gone | Low — one middleware rule, one deletion |
| 3. Shared header on recipe pages | Logout reachable from every recipe page | None — additive component reuse |
| 4. Photo thumbnail on upload confirmation | Confirmation card shows the uploaded photo | None — mirrors existing signed-URL pattern |
| 5. Auto-redirect after upload | Stale-list bug fixed at its source | Low — mitigated by skipping redirect during the type nudge |

**Prerequisites:** None — all four prerequisite slices (S-01 through S-04) are already merged.
**Estimated effort:** Small — 5 phases, no schema changes, mostly UI wiring.

## Open Risks & Assumptions

- The stale-list root cause is a strong hypothesis (no redirect path + no cache headers → bfcache
  on Back navigation), not confirmed via direct reproduction — Phase 5's manual verification is
  the actual test of whether the fix resolves it.

## Success Criteria (Summary)

- A logged-out visitor sees SnapRecipe branding at `/`; a logged-in one is redirected to `/recipes`
- Logout works from every recipe page; `/dashboard` no longer exists
- The post-upload confirmation shows a thumbnail and the user lands back on an up-to-date
  `/recipes` list without a manual refresh
