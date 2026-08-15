# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Always attach a kill date to every feature flag

- **Context**: Any phase that introduces or modifies a feature flag in the codebase.
- **Problem**: Dead flags pile up, adding dead code paths and making future refactors risky.
- **Rule**: Always attach a kill date (or cleanup ticket) to every feature flag at creation time.
- **Applies to**: plan, implement, impl-review

## When a phase adds a file needing new ESLint scoping, name it explicitly

- **Context**: Any phase whose Changes Required lists a primary file (a new script, a
  generated file) that requires an `eslint.config.js` change to pass lint — Node globals for
  a new `scripts/` file, or excluding a generated file's non-conforming shape.
- **Problem**: Happened twice in one session — `supabase-auth-setup` Phase 3
  (`scripts/check-auth-config.mjs` needed Node-globals scoping) and `recipe-data-schema`
  Phase 3 (generated `src/types.ts` needed a lint ignore). Both times the `eslint.config.js`
  edit was undocumented in the plan, only surfacing as a review finding after implementation.
- **Rule**: When planning a phase that introduces a file requiring new ESLint scoping (a new
  Node-context script, a generated/vendor file whose style won't match project lint rules),
  name the `eslint.config.js` change explicitly in that phase's Changes Required — don't leave
  it to be discovered during implementation.
- **Applies to**: plan, implement
