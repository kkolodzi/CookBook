<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Reversible Removal Correctness

- **Plan**: context/changes/testing-reversible-removal-correctness/plan.md
- **Scope**: Full plan (Phases 1-3 of 3)
- **Date**: 2026-08-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Unchecked `.single()` error before reading `deleted_at` in the round-trip test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test correctness / flakiness risk)
- **Location**: tests/integration/trash-restore-roundtrip.test.ts:82-83
- **Detail**: `const { data: trashedRow } = await user.client.from("recipes").select("deleted_at").eq("id", recipe.id).single();` discards `error`. If this verification read silently fails (transient error, RLS hiccup), `trashedRow` is `undefined`, so `trashedRow?.deleted_at` is also `undefined`, and `expect(undefined).not.toBeNull()` passes vacuously — the test can no longer distinguish "trash actually succeeded" from "the verification read itself failed." Every other read in this file that matters to an assertion checks `error` first (e.g. line 79-80); this one line skipped that discipline.
- **Fix**: Destructure `error` alongside `data` and assert it's `null` before checking `trashedRow?.deleted_at`, matching the pattern already used elsewhere in the same file.
- **Decision**: FIXED

### F2 — Same unchecked-`.single()` pattern in the double-trash guard-rejection test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test correctness / flakiness risk)
- **Location**: tests/integration/trash-restore-roundtrip.test.ts:146-151, 157-158
- **Detail**: `afterFirstTrash` and `stillTrashed` are both read via unchecked `.single()` calls, then compared with `expect(stillTrashed?.deleted_at).toBe(firstDeletedAt)`. If both selects fail identically (e.g. both resolve `data: undefined`), the comparison passes vacuously (`undefined === undefined`) despite the actual invariant — "the second trash call didn't change the recipe's `deleted_at`" — never having been verified against real data.
- **Fix**: Check `error` on both selects before using their values, same as F1.
- **Decision**: FIXED

### F3 — `edit_recipe` RPC call omits `p_instructions`, silently nulling `instructions`

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Test coverage gap
- **Location**: tests/integration/trash-restore-roundtrip.test.ts:110-115
- **Detail**: The `edit_recipe` RPC (per `supabase/migrations/20260816190000_edit_recipe_instructions.sql`) sets `instructions = p_instructions` unconditionally, defaulting to `null` when omitted. This test's edit-then-trash-then-restore case doesn't pass `p_instructions`, so the call always wipes the recipe's `instructions` to `null` — unlike the real PATCH endpoint, which always passes it explicitly. The test's own assertions (name, type only, line 130-134) never examine `instructions`, so this doesn't produce a false pass, but the RPC call shape doesn't mirror the real caller and silently changes state the test never looks at. This same omission already exists in the pre-existing `cross-user-rls.test.ts`, so it's a pre-existing pattern, not something newly introduced by this phase.
- **Fix**: Either assert `instructions` explicitly (documenting the null-out as intended for this test) or pass `p_instructions` if true round-trip field preservation through an edit is the intended claim. Optional — informational only, matches an existing pattern in the codebase.
- **Decision**: FIXED
