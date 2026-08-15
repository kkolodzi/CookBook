---
change_id: recipe-data-schema
title: Recipe data schema — tables, storage bucket, RLS, generated types
status: archived
created: 2026-08-15
updated: 2026-08-15
archived_at: 2026-08-15T12:10:01Z
---

## Notes

Roadmap item F-02 (`context/foundation/roadmap.md`). Depends on F-01 (done) — Supabase auth
is live so RLS policies can key off a real `auth.uid()`. Two hosted Supabase projects in use
(no local Docker): `SnapRecipe` (dev) and `SnapRecipe_live` (prod) — this change migrates
both. Existing dev user for seed/manual testing: `0501ce12-98e9-4b29-b48c-df74d3a7a41b`.

**Parked idea (not in scope for this change or current PRD):** during planning, the builder
raised the idea of an opt-in "global" shared pool for recipes a user deletes, instead of pure
soft-delete. Currently out of scope — the PRD explicitly makes collections private in MVP
("No sharing between users... deferred to v2"), and the idea raises real open questions
(consent — did the user agree to donate it? and copyright — many source photos are pages
from actual cookbooks or other people's printed recipes, so redistributing that content
even post-"deletion" needs real legal/product thought, not a schema-level decision). Revisit
via `/10x-shape` if this direction is worth pursuing for v2.

**Deferred to S-01 (impl review F2):** `recipes.photo_path` has no constraint tying it to a
storage object the calling user actually owns. RLS on `recipes` and `storage.objects`
independently prevents any real cross-user leak, but nothing validates the reference at
insert time. Not a schema concern — `photo_path` is first written/read in S-01 (photo upload),
so decide there whether API-layer validation is worth adding.
