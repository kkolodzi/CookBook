---
change_id: update-ui
title: Update ui
status: implementing
created: 2026-08-17
updated: 2026-08-17
archived_at: null
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
