---
change_id: photo-to-recipe-save
title: Photo upload → AI extraction → recipe save
status: impl_reviewed
created: 2026-08-15
updated: 2026-08-16
---

## Notes

Roadmap item S-01 (`context/foundation/roadmap.md`) — the north star slice. Was blocked on
"which vision API provider to use" (Open Roadmap Question 1); resolved during planning as
OpenRouter (model-agnostic gateway) rather than a direct single-provider SDK, so the model
can be swapped without rewriting the integration.

Depends on F-01 (done — Supabase auth live) and F-02 (done — `recipes` / `recipe_ingredients`
schema + `recipe-photos` Storage bucket live in both `SnapRecipe` dev and `SnapRecipe_live`
prod projects).

**Resolves a deferral from F-02's impl review**: `recipes.photo_path` had no constraint tying
it to a storage object the calling user actually owns. This plan's persistence phase always
derives `photo_path` from the Storage upload response completed earlier in the same request —
never from client input — so no additional validation is needed at the API layer.

Dev user for manual testing: `0501ce12-98e9-4b29-b48c-df74d3a7a41b`.
