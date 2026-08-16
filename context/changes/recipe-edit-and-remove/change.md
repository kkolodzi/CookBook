---
change_id: recipe-edit-and-remove
title: Edit and reversibly remove saved recipes
status: implemented
created: 2026-08-16
updated: 2026-08-16
archived_at: null
---

## Notes

edit a saved recipe's name, ingredient list, and type, and remove a recipe reversibly with a recovery window (FR-019, FR-020)

**Rebase reconciliation with S-02 (2026-08-16):** by the time this branch rebased onto `main`, `recipe-search-and-browse` (S-02) had already merged its own richer `/recipes` (browse/search, `RecipeBrowser`/`RecipeCard`) and `/recipes/[id]` (read-only detail with photo) pages — the exact routes this plan's Phase 2-3 built minimal versions of. Reconciled by keeping S-02's pages as the canonical `/recipes` and `/recipes/[id]`, moving this change's edit form to a new `/recipes/[id]/edit` route linked from the detail page, and adding a `RecipeRemoveButton` (confirm dialog + `DELETE`) to the detail page instead of this change's original standalone list. The original `RecipeList.tsx` (superseded) was deleted; `TrashList.tsx`/`/recipes/trash` were unaffected (S-02 has no trash view) and kept as-is, with a link added from `/recipes`.
