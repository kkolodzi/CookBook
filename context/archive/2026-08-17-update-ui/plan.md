# SnapRecipe UI & Navigation Cleanup — Implementation Plan

## Overview

Replace the app's leftover Astro-starter identity with a cookbook-appropriate one, make `/recipes`
the true post-login home instead of the placeholder `/dashboard` "select action" screen, put a
logout affordance on every authenticated page (not just `/dashboard`), show a thumbnail of the
just-uploaded photo in the post-upload confirmation, and fix the stale-recipe-list bug by giving
`PhotoUploadForm` a real way back to the list. No database changes — this is purely
routing/UI/one-API-field.

## Current State Analysis

- `src/pages/index.astro` renders `Welcome.astro`, which is the **unmodified Astro starter
  template**: "10x Astro Starter" hero, "Authentication Ready / Modern Stack / Developer
  Experience" feature cards — nothing cookbook-related anywhere.
- `src/layouts/Layout.astro:10` defaults `title` to `"10x Astro Starter"`.
- The PRD (`context/foundation/prd.md:2,19`) already names the product **"SnapRecipe"**; that
  name has never been surfaced in any UI text.
- `src/components/Topbar.astro` is the only place with a logout button + nav, and it's rendered
  **only on the landing page** (`Welcome.astro`) — nowhere else. Its authenticated branch links
  to `/dashboard` (lines 13-15).
- `src/pages/dashboard.astro` is a placeholder: welcome text + two links (`/recipes`,
  `/recipes/new`) + a sign-out form. Nothing redirects a user *to* `/dashboard` automatically —
  `src/pages/api/auth/signin.ts:19` already redirects to `/` on success, not `/dashboard`.
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/recipes"]`; no rule redirects an
  already-authenticated visitor away from `/`.
- `src/components/recipes/PhotoUploadForm.tsx` has **no redirect and no link back to `/recipes`**
  after a successful save — only a "Dodaj kolejny przepis" (reset-in-place) button. The only way
  back to the list is the browser Back button, which — combined with the app setting no
  `Cache-Control` headers anywhere — very plausibly serves a bfcache'd stale snapshot of
  `/recipes` instead of a fresh server request. `RecipeEditForm.tsx` already sidesteps this same
  class of problem with `window.location.href = "/recipes"` (a full navigation) after a
  successful edit.
- `src/pages/recipes/index.astro` does fresh SSR on every real request (`listRecipes()` called
  server-side each load, lines 8-16) — the list itself isn't the bug; the missing path back to
  it is.
- `POST /api/recipes` (`src/pages/api/recipes.ts:171-184`) returns
  `{ id, name, type, ingredients, instructions }` — **no photo URL**, even though the photo was
  just uploaded to the `recipe-photos` bucket at `storagePath` (line 116). The recipe **list**
  view (`RecipeCard.tsx`) already renders thumbnails fine via `RecipeSummaryDto.photoUrl`
  (populated by `listRecipes()`'s existing signed-URL batching) — the gap is specifically the
  post-upload confirmation card.
- `src/lib/services/recipe-query.ts:6-7` already has `RECIPE_PHOTOS_BUCKET` and
  `SIGNED_URL_TTL_SECONDS` constants (module-private) used by both `listRecipes()` and
  `getRecipeDetail()`'s signed-URL calls.
- `src/components/recipes/PhotoUploadForm.tsx:129-134` already conditionally renders an
  instructions block in the success card when non-null — the thumbnail follows the same pattern.
- `src/components/recipes/TypeConfirmationNudge.tsx` renders inside the success card when
  `typeUnconfirmed` is true, letting the user pick the correct type with one click
  (`PATCH /api/recipes/[id]/type`). This is interactive and must not be cut off by an
  auto-redirect.

## Desired End State

- `/` shows a SnapRecipe-branded landing page for logged-out visitors; an already-authenticated
  visitor hitting `/` lands on `/recipes` instead.
- Signing in takes the user straight to `/recipes` (via the existing `/` → `/recipes` redirect,
  no `/dashboard` step).
- `/dashboard` no longer exists.
- Every authenticated recipe page (`/recipes`, `/recipes/new`, `/recipes/[id]`,
  `/recipes/[id]/edit`) has a small header with the app name (linking to `/recipes`), the user's
  email, and a sign-out button.
- After a successful photo upload, the confirmation card shows a thumbnail of the uploaded photo,
  and — once there's nothing left needing the user's attention (i.e. the type didn't need
  confirming, or they just confirmed it) — the page automatically navigates back to `/recipes`,
  which now reliably shows the new recipe.

Verify by: visiting `/` logged out (see SnapRecipe branding) and logged in (redirected to
`/recipes`); confirming `/dashboard` 404s; confirming logout is reachable from all four recipe
pages; uploading a photo and seeing its thumbnail in the confirmation card, then landing back on
`/recipes` with the new recipe visible without a manual refresh.

### Key Discoveries:

- `signin.ts` already redirects to `/` — so a single middleware rule ("authenticated + `/` →
  `/recipes`") satisfies both "make `/recipes` the post-login destination" and "don't show a
  marketing page to a returning logged-in user," with no change needed to the sign-in flow itself.
- `Topbar.astro` is reusable as-is on every recipe page (it reads `Astro.locals.user` internally,
  takes no props) once its `/dashboard` link is repointed — one component edit, then import it in
  four places.
- The existing contextual back-links (`[id].astro`'s "← Twoje przepisy",
  `edit.astro`'s "← Wróć do przepisu") serve a different purpose than the new header (going back
  to *this specific* recipe vs. reaching *the list + logout* from anywhere) — both stay, additively.

## What We're NOT Doing

- Not adding `Cache-Control` headers to protected routes — the chosen fix for the stale-list bug
  is giving `PhotoUploadForm` an explicit redirect, not a broader caching policy change.
- Not adding a local (pre-upload) file preview — only the post-upload confirmation thumbnail, per
  the reported gap.
- Not redesigning the recipe list, detail, or edit pages beyond adding the shared header.
- Not keeping `/dashboard` as a redirect stub — it's deleted outright.
- Not changing `RecipeBrowser.tsx`'s fetch/search logic — the list's own data-fetching was never
  the problem, the missing path back to it was.
- Not touching the signup/confirm-email flow — it already redirects sensibly and isn't part of
  the reported gaps.

## Implementation Approach

Five additive-ish phases, no shared risk between them: a content-only rebrand (Phase 1), a small
middleware/routing change plus a file deletion (Phase 2), one component reused across four pages
(Phase 3), one API field plus its UI consumer (Phase 4), and one client-side navigation addition
with an interactive-nudge exception (Phase 5). No new endpoints, tables, or migrations.

## Phase 1: Landing page rebrand

### Overview

Replace the Astro-starter branding on the logged-out landing page and default page title with
SnapRecipe-appropriate content, and repoint `Topbar.astro`'s dashboard link now that
`/dashboard` is going away (deleted in Phase 2).

### Changes Required:

#### 1. Landing page content

**File**: `src/components/Welcome.astro`

**Intent**: Replace the hero headline/subhead and the three feature cards with cookbook-relevant
copy — e.g. a hero about turning a photo of a recipe into a saved, searchable recipe, and cards
covering photo-to-recipe extraction, ingredient search, and edit/organize. Keep the existing
cosmic background, layout structure, and the Sign In / Sign Up CTA buttons (still correct for a
logged-out visitor) — only the copy and icons change.

**Contract**: `<h1>` (line 35), subhead `<p>` (line 37-39), and the three `<h3>`/`<p>` pairs
inside the feature cards (lines 74-77, 97-100, 119-122) are rewritten. No structural/class changes
required beyond what the new copy needs.

#### 2. Default page title

**File**: `src/layouts/Layout.astro`

**Intent**: Stop defaulting every page's browser-tab title to the starter kit's name.

**Contract**: `const { title = "10x Astro Starter" } = Astro.props;` (line 10) → default becomes
`"SnapRecipe"`.

#### 3. Topbar brand link

**File**: `src/components/Topbar.astro`

**Intent**: Replace the soon-to-be-dead `/dashboard` link with an app-name/logo link to
`/recipes`, and add a matching brand link in the unauthenticated branch so the header reads
consistently (brand on the left, actions on the right) in both states.

**Contract**: Authenticated branch's `<a href="/dashboard">Dashboard</a>` (lines 13-15) becomes
`<a href="/recipes">SnapRecipe</a>`. Unauthenticated branch (lines 24-34) gains a matching
`<a href="/">SnapRecipe</a>` before the "Not signed in" text.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification:

- Visit `/` while logged out; confirm the hero and feature cards read as a cookbook app, not the
  Astro starter kit
- Confirm the browser tab title reads "SnapRecipe" on a page that doesn't override `title`

---

## Phase 2: Root redirect + dashboard removal

### Overview

Make an authenticated visit to `/` land on `/recipes`, and remove the now-fully-redundant
`/dashboard` page.

### Changes Required:

#### 1. Middleware redirect rule

**File**: `src/middleware.ts`

**Intent**: Send an already-authenticated visitor straight to their recipes instead of the
marketing landing page, and stop treating `/dashboard` as a protected route since the page will
no longer exist.

**Contract**: `PROTECTED_ROUTES` (line 4) drops `"/dashboard"`, becoming `["/recipes"]`. After the
existing protected-route check (lines 18-22), add: if `context.url.pathname === "/"` and
`context.locals.user` is truthy, `return context.redirect("/recipes")`.

#### 2. Remove the dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Delete — its content (welcome text, links to `/recipes`/`/recipes/new`, sign-out) is
now redundant with the landing redirect (→ `/recipes`) and the shared header (Phase 3, which
carries sign-out to every recipe page).

**Contract**: Delete the file.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification:

- While logged in, visit `/`; confirm it redirects to `/recipes`
- Visit `/dashboard`; confirm it 404s
- While logged out, visit `/recipes`; confirm it still redirects to `/auth/signin` (protected-route
  behavior unchanged)

---

## Phase 3: Shared header on recipe pages

### Overview

Render the (now `/recipes`-pointing) `Topbar` on every authenticated recipe page, so logout and a
way back to the list are always reachable — additive to each page's existing contextual
back-links.

### Changes Required:

#### 1. Recipe list page

**File**: `src/pages/recipes/index.astro`

**Intent**: Add the shared header above the page's existing "Twoje przepisy" title/actions row.

**Contract**: Import `Topbar` from `@/components/Topbar.astro`; render `<Topbar />` as the first
child inside the `mx-auto max-w-4xl` container (before line 22's header row).

#### 2. New recipe page

**File**: `src/pages/recipes/new.astro`

**Intent**: Add the shared header above the centered upload card.

**Contract**: Import and render `<Topbar />` above the centered card; adjust the outer flex
layout as needed so the header and the centered card both sit sensibly (the header need not be
vertically centered along with the card).

#### 3. Recipe detail page

**File**: `src/pages/recipes/[id].astro`

**Intent**: Add the shared header above the existing "← Twoje przepisy" back-link.

**Contract**: Import and render `<Topbar />` as the first child inside the `mx-auto max-w-2xl`
container, before the existing back-link (line 36).

#### 4. Recipe edit page

**File**: `src/pages/recipes/[id]/edit.astro`

**Intent**: Add the shared header above the centered edit card.

**Contract**: Import and render `<Topbar />` above the centered card, same layout treatment as
`new.astro`.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification:

- From `/recipes`, `/recipes/new`, a recipe's detail page, and its edit page, confirm the header
  (app name + email + sign out) is visible and sign-out works from each
- Confirm each page's existing contextual back-link/actions still work unchanged

---

## Phase 4: Photo thumbnail on upload confirmation

### Overview

Return a signed URL for the just-uploaded photo from `POST /api/recipes`, and render it as a
thumbnail in the post-upload success card.

### Changes Required:

#### 1. Export shared signing constants

**File**: `src/lib/services/recipe-query.ts`

**Intent**: Let `recipes.ts` reuse the same bucket name and TTL `getRecipeDetail()`/`listRecipes()`
already sign photo URLs with, instead of duplicating the literals.

**Contract**: `RECIPE_PHOTOS_BUCKET` and `SIGNED_URL_TTL_SECONDS` (lines 6-7) gain `export`.

#### 2. Sign and return the photo URL

**File**: `src/pages/api/recipes.ts`

**Intent**: Sign the photo at `storagePath` (already uploaded earlier in the handler) and include
it in the success response so the client can render a thumbnail. A signing failure degrades to
`null` — same non-blocking treatment `recipe-query.ts` already uses for signed URLs — it must
never fail the whole request.

**Contract**: Import `RECIPE_PHOTOS_BUCKET`/`SIGNED_URL_TTL_SECONDS` from `recipe-query.ts`; after
the recipe row is confirmed saved, call
`supabase.storage.from(RECIPE_PHOTOS_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)`.
The response `recipe` object (lines 174-180) gains `photoUrl: <signedUrl or null>`.

#### 3. Update API route tests

**File**: `src/pages/api/recipes.test.ts`

**Intent**: Cover the new field the same way `instructions` is covered today.

**Contract**: Extend the mock Supabase client's `storage.from()` return value with a
`createSignedUrl` mock; extend `"persists recipe, ingredients, photo, and a success attempt log
on a successful extraction"` and `"falls back to 'other' and flags typeUnconfirmed..."` to assert
`photoUrl` in the response.

#### 4. Render the thumbnail

**File**: `src/components/recipes/PhotoUploadForm.tsx`

**Intent**: Show the uploaded photo in the success card, following the same
image-or-placeholder-icon treatment `RecipeCard.tsx` already uses for the list view, so the
visual language matches across the app.

**Contract**: `SavedRecipe` (lines 16-22) gains `photoUrl: string | null`. Success card (around
lines 121-135) gains a thumbnail block — an `<img>` when `photoUrl` is set, otherwise an
`ImageOff`-style placeholder — positioned above or alongside the name/type.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes (`src/pages/api/recipes.test.ts`)
- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification:

- Upload a recipe photo; confirm the post-upload confirmation card shows a thumbnail of that
  exact photo

---

## Phase 5: Auto-redirect after upload (fixes stale list)

### Overview

Give `PhotoUploadForm` an explicit path back to `/recipes` after a successful save — fixing the
stale-list bug at its source — while keeping the type-confirmation nudge fully usable when it
appears.

### Changes Required:

#### 1. Redirect after success

**File**: `src/components/recipes/PhotoUploadForm.tsx`

**Intent**: After a successful save, if nothing needs the user's attention (the type was
confidently assigned), automatically navigate back to `/recipes` — via a full page navigation
(not client-side routing), matching `RecipeEditForm.tsx`'s existing post-save pattern, so the
list page always does a fresh server fetch. Use a longer delay than `RecipeEditForm`'s 700ms
(there's more to glance at here: thumbnail, ingredients, instructions) — 2000ms. If the type
*does* need confirming, skip the auto-redirect entirely so `TypeConfirmationNudge` stays
interactive; once the user picks a type there, redirect then instead.

**Contract**: In `handleSubmit`'s success branch (lines 85-88), after `setSuccessData`/
`setStatus("success")`, when `body.typeUnconfirmed` is `false`, schedule
`window.setTimeout(() => { window.location.href = "/recipes"; }, 2000)`. When `typeUnconfirmed`
is `true`, don't schedule it there — instead, `TypeConfirmationNudge`'s `onConfirmed` callback
(lines 139-141) additionally schedules the same delayed redirect after it updates `successData`.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds
- `npm run lint` passes

#### Manual Verification:

- Upload a photo that gets a confidently-assigned type; confirm the page auto-navigates to
  `/recipes` a couple seconds after the success card appears, and the new recipe is visible
  immediately (no manual refresh needed)
- Upload a photo that leaves the type unconfirmed; confirm the page does NOT auto-redirect while
  the type nudge is showing, and confirm picking a type there triggers the redirect afterward
- Confirm navigating back to `/recipes` via the shared header (Phase 3) or browser Back button
  also shows the freshly added recipe (no stale list)

---

## Testing Strategy

### Unit Tests:

- `POST /api/recipes`: response includes `photoUrl` (signed and null-on-failure cases)

### Integration Tests:

- Existing `recipes.test.ts` coverage extended, not duplicated

### Manual Testing Steps:

1. Visit `/` logged out — confirm SnapRecipe branding, not the Astro starter kit
2. Sign in — confirm landing on `/recipes` directly, no `/dashboard` step
3. Visit `/dashboard` directly — confirm 404
4. From each of `/recipes`, `/recipes/new`, a recipe detail page, and its edit page — confirm the
   header shows app name + email + working sign-out
5. Upload a recipe photo with a confidently-assigned type — confirm the thumbnail appears in the
   confirmation card, then the page auto-redirects to `/recipes` after ~2s showing the new recipe
6. Upload a recipe photo where the type isn't confidently assigned — confirm no auto-redirect
   until the type is picked via the nudge, then it redirects

## Performance Considerations

None — one additional signed-URL call (same pattern already used elsewhere), no new queries, no
new endpoints.

## Migration Notes

None — no schema or data changes in this plan.

## References

- Prior UI patterns: `src/components/recipes/RecipeCard.tsx` (thumbnail treatment),
  `src/components/recipes/RecipeEditForm.tsx` (post-save redirect pattern)
- PRD: `context/foundation/prd.md` (product name "SnapRecipe")
- Roadmap candidate ideas: `context/foundation/roadmap.md` ("No photo thumbnail shown after
  upload", "Recipe list doesn't reflect a just-added recipe", "Dashboard is a redundant middle
  step")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Landing page rebrand

#### Automated

- [x] 1.1 npm run build succeeds — 82f8cbf
- [x] 1.2 npm run lint passes — 82f8cbf

#### Manual

- [x] 1.3 Landing page reads as SnapRecipe, not the Astro starter kit
- [x] 1.4 Browser tab title reads "SnapRecipe" by default

### Phase 2: Root redirect + dashboard removal

#### Automated

- [x] 2.1 npm run build succeeds — c85f2da
- [x] 2.2 npm run lint passes — c85f2da

#### Manual

- [x] 2.3 Logged-in visit to / redirects to /recipes
- [x] 2.4 /dashboard 404s
- [x] 2.5 Logged-out visit to /recipes still redirects to /auth/signin

### Phase 3: Shared header on recipe pages

#### Automated

- [x] 3.1 npm run build succeeds — 99971e6
- [x] 3.2 npm run lint passes — 99971e6

#### Manual

- [x] 3.3 Header (name + email + sign out) visible and working on all four recipe pages
- [x] 3.4 Existing contextual back-links/actions on each page still work

### Phase 4: Photo thumbnail on upload confirmation

#### Automated

- [x] 4.1 npm run test passes (recipes.test.ts) — b6b13c3
- [x] 4.2 npm run build succeeds — b6b13c3
- [x] 4.3 npm run lint passes — b6b13c3

#### Manual

- [x] 4.4 Post-upload confirmation card shows the uploaded photo's thumbnail

### Phase 5: Auto-redirect after upload (fixes stale list)

#### Automated

- [x] 5.1 npm run build succeeds — ebb4ec3
- [x] 5.2 npm run lint passes — ebb4ec3

#### Manual

- [x] 5.3 Confidently-typed upload auto-redirects to /recipes showing the new recipe
- [x] 5.4 Unconfirmed-type upload does not auto-redirect until type is picked, then redirects
- [x] 5.5 Navigating to /recipes via header or Back button shows the new recipe (no staleness)
