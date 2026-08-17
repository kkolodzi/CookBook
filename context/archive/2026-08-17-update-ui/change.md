---
change_id: update-ui
title: Update ui
status: archived
created: 2026-08-17
updated: 2026-08-17
archived_at: 2026-08-17T13:46:58Z
---

## Notes

User intent (verbatim, 2026-08-17): "yeah those two things i mentinoed earlier but first screen
should be more releated to cook book rather than astro and after login it should be
yourRecipts list rather htan select action does it make sense? also there should be an option
to log out there. i just want to get rid of default landing pages and make it more adjusted!"

Bundles four UI items:
1. Photo thumbnail shown after upload (candidate idea from S-04 testing, roadmap.md)
2. Recipe list not reflecting a just-added recipe (candidate idea/bug from S-04 testing, roadmap.md)
3. Landing page (`/`) still looks like the default Astro starter — should read as a cookbook app
4. Post-login destination should be the recipe list, not the placeholder `/dashboard`
   "select action" screen — and that destination needs a logout affordance since `/dashboard`
   currently hosts sign-out.

**Post-implementation correction (2026-08-17)**, after manual testing of all 5 phases: two fixes,
rest confirmed OK.
- Topbar rendered at a different width per page (it inherited whatever container it was nested
  in — 4xl on the list, 2xl on detail, unconstrained on new/edit). Fixed: Topbar now owns its own
  `mx-auto max-w-4xl`, and is rendered as a sibling before each page's content wrapper instead of
  nested inside it, so its width is constant everywhere.
- Photo feedback was reconsidered: instead of a small thumbnail in the post-upload confirmation
  card (gone within ~2s once Phase 5's auto-redirect fires), show a normal-sized local preview
  immediately when the file is picked — visible through the whole idle → loading → success flow,
  not just briefly at the end. `PhotoUploadForm` now creates an object URL from the selected
  `File` on selection (revoked on replace/reset/unmount) and renders it in place of the upload
  icon; the post-upload success card's thumbnail block is removed. `POST /api/recipes`'s
  `photoUrl` response field is left as-is (harmless, matches the project's existing "kept in sync
  anyway" precedent for unused-but-consistent API fields — see `GET /api/recipes/[id]`).
- Follow-up: Topbar was still narrower than other pages on `/recipes/new` after the first fix —
  root cause was relying on flexbox's implicit stretch to reach full width before `max-w-4xl`
  clamped it, which didn't hold reliably on the flex-col pages (`new.astro`, `edit.astro`).
  Added `w-full` to make the stretch explicit. Confirmed matching by the user afterward.

**Implemented 2026-08-17** — All 5 phases shipped and manually verified, including two
post-implementation correction rounds above. No database changes anywhere in this change.

Next step: `/10x-archive update-ui`.
