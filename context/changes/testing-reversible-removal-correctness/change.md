---
change_id: testing-reversible-removal-correctness
title: Reversible removal correctness (trash/restore round-trip integrity)
status: impl_reviewed
created: 2026-08-21
updated: 2026-08-23
archived_at: null
---

## Notes

Rollout Phase 3 of context/foundation/test-plan.md: "Reversible removal correctness".
Risks covered: #5 (reversible recipe removal (trash/restore) loses data or leaves it unrecoverable). Test types planned: integration.
Risk response intent: #5: prove a full trash → restore round-trip preserves every field, including edit-then-remove-then-restore sequences - do not assume restore is the exact inverse of trash without checking whether partial/concurrent states are reachable.
