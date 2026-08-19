---
change_id: testing-cross-user-access-integrity
title: Cross-user access and reference integrity testing
status: implementing
created: 2026-08-19
updated: 2026-08-19
archived_at: null
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Cross-user access & reference integrity".
Risks covered: #4 (a user reaches another user's recipe or photo via an RLS gap), #6 (a recipe's photo reference points at a storage object the owning user never actually uploaded).
Risk response intent:
- #4: prove that cross-user reads/writes against recipes and storage objects are denied by the database itself, verified without mocking Supabase (integration test against local Supabase, real Postgres + policies) - do not treat today's mocked-Supabase convention as sufficient coverage for this risk.
- #6: prove a recipe's photo_path cannot be set to point at a storage object the acting user doesn't own, even when the insert path is exercised directly - do not assume "RLS covers it" without a test proving this specific insert path is subject to the same policy.
After creating the folder, follow the downstream continuation rule (suggest /10x-research next unless blocked).
