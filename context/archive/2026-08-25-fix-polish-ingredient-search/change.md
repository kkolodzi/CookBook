---
change_id: fix-polish-ingredient-search
title: Fix Polish ingredient search to match grammatical-case variants
status: archived
created: 2026-08-25
updated: 2026-08-25
archived_at: 2026-08-25T14:59:55Z
---

## Notes

Roadmap S-05 (M-02: Search and list quality hardening), north star. Ingredient
search (FR-015) is a plain substring `ilike` match with no stemming, so it
fails whenever the searched word and the stored word differ by Polish noun
declension (e.g. "cukier" doesn't match "cukru"). See
`context/foundation/roadmap.md` S-05 for the full risk/PRD-refs writeup.
