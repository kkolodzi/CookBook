# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Always attach a kill date to every feature flag

- **Context**: Any phase that introduces or modifies a feature flag in the codebase.
- **Problem**: Dead flags pile up, adding dead code paths and making future refactors risky.
- **Rule**: Always attach a kill date (or cleanup ticket) to every feature flag at creation time.
- **Applies to**: plan, implement, impl-review
