<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Recipe Search, Type Filter, and Detail View

- **Plan**: context/changes/recipe-search-and-browse/plan.md
- **Scope**: Phase 1 of 3 (full plan review — all phases implemented)
- **Date**: 2026-08-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated verification (re-run at review time)

- `npm run lint` — pass (0 errors, 4 pre-existing unrelated warnings in `scripts/check-auth-config.mjs`)
- `npm run build` — pass
- `npm run test` — pass (35/35, including the review-fix regression test added below)

## Manual verification

All manual checklist items across Phases 1-3 remain `- [ ]` in `plan.md`'s Progress section by design — per this run's directive, manual testing is batched into a single pass by the user now that every phase has landed, rather than gated between phases.

## Plan Drift Detection

No drift. Every planned file in Phases 1-3's "Changes Required" sections matches the plan's stated Intent/Contract, verified line-by-line against the actual code (query chains, status codes, debounce timing, empty-state selection logic, DTO shapes). No unplanned files, no scope creep. `src/lib/services/recipe-query.test.ts` exists as a dedicated service-level test file not explicitly named in the plan's Phase 1 file list — this is welcome additional coverage consistent with the plan's own testing-strategy intent, not scope creep (the query-building logic moved into a service module partway through Phase 1, so unit tests naturally followed it there instead of only testing it indirectly through the route).

"What We're NOT Doing" is fully respected: no name search, no sort toggle, no pagination UI, no new search index/migration, no `note` field, no standalone `GET /api/recipes/[id]`, no edit/remove UI.

**Phase 3 404-mechanism deviation** (documented, verified functionally correct): the plan suggested `Astro.rewrite` or a top-level `return new Response(null, {status:404})`, with an explicit "otherwise a minimal 404 page is acceptable" escape hatch. The actual implementation in `src/pages/recipes/[id].astro` uses `Astro.response.status = status` plus conditional template rendering instead, because a top-level `return new Response()` after a preceding top-level `await` crashes `astro-eslint-parser`'s `no-misused-promises` rule (confirmed reproducible and isolated to that exact pattern during Phase 3 implementation). `Astro.response.status` is Astro's own documented mechanism for setting a custom SSR status code, confirmed against Astro's docs and cross-checked for this repo's `output: "server"` + Cloudflare adapter setup. Functionally equivalent: correct 401/503/404 codes, and `getRecipeDetail`'s `user_id` + `deleted_at is null` scoping means a foreign or soft-deleted recipe always renders the generic "Nie znaleziono przepisu" body under a 404, never leaking another user's data.

## Safety, Quality & Pattern Compliance

No CRITICAL findings. No security holes, no missing auth/ownership scoping, no manual Tailwind string concatenation (`cn()` used correctly throughout), no English strings in any new UI copy. Every new query scopes `.eq("user_id", userId)` + `.is("deleted_at", null)` (RLS does not filter soft-deleted rows in this schema, so this is required, not redundant). Signed-URL failures degrade gracefully to `null` photos rather than failing the request, in both `listRecipes` (batch) and `getRecipeDetail` (single) — covered by dedicated tests. `[id].astro`'s status-setting approach was independently confirmed against Astro's official docs to be correct for `output: "server"`.

## Findings

### F1 — Unescaped `%`/`_` wildcards in ingredient search

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: `src/lib/services/recipe-query.ts` (`listRecipes`, ilike pattern construction)
- **Detail**: The user's raw search text was interpolated directly into an `ilike` pattern (`%${trimmedQuery}%`) without escaping SQL `LIKE` wildcard characters (`%`, `_`). Not an injection risk (PostgREST parameterizes the value) and scoped only to the searching user's own data, but a query containing a literal `%` or `_` would silently match more broadly than the user typed (e.g. searching `%` would match every ingredient), changing search semantics unexpectedly.
- **Fix**: Escape `\`, `%`, and `_` in the trimmed query before interpolating into the `ilike` pattern.
- **Decision**: FIXED — `src/lib/services/recipe-query.ts` now escapes `\`, `%`, `_` via `.replace(/[\\%_]/g, (m) => \`\\${m}\`)` before building the pattern; regression test added in `recipe-query.test.ts` ("escapes ilike wildcard characters in the search query").

### F2 — `listRecipes` swallows query errors into an empty result, inconsistent with `POST`'s fail-loud style

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision, but the tradeoff is real
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: `src/lib/services/recipe-query.ts` (`listRecipes`, error branch); `src/pages/api/recipes.ts` (`GET` handler)
- **Detail**: On a Supabase query error, `listRecipes` returns `[]` rather than propagating the error, so `GET /api/recipes` always responds `200 {recipes: []}` even on a genuine backend failure — indistinguishable from a real zero-result search. This differs from `POST`'s convention in the same file, which maps Supabase errors to `500`.
- **Fix considered**: Have `listRecipes` throw/propagate on error, with the `GET` handler mapping it to `500` (matching `POST`).
- **Decision**: ACCEPTED, not fixed. `listRecipes` is called from two places with different failure tolerance: the SSR browse page (`src/pages/recipes/index.astro`), where a hard throw would crash the entire page render on a transient DB hiccup, and the `GET` API route, which could reasonably surface a `500`. Giving the shared service two different error-handling contracts for its two callers adds real complexity (a second return shape, or a thrown-error contract the SSR page would need to defensively catch anyway) to fix a low-severity, low-likelihood gap (transient backend failure presenting as "no results" rather than an explicit error) in a low-QPS, personal-collection app. Revisit only if this proves to be a real support/debugging pain point in practice.

## Summary

Fixed: F1 (1)
Accepted: F2 (1)

The recipe-search-and-browse change is implementation-complete across all 3 phases, all automated verification passes, and this review found no critical, drift, or scope issues. Manual verification (mobile one-handed usability, cross-user isolation, empty-state copy, end-to-end search/filter/detail flow) is intentionally left for a single batched pass by the user.
