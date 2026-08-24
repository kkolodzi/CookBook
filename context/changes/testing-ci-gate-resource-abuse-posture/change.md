---
change_id: testing-ci-gate-resource-abuse-posture
title: CI gate & resource-abuse posture (wire test suite into CI, assess extraction cost controls)
status: implemented
created: 2026-08-23
updated: 2026-08-23
archived_at: null
---

## Notes

Rollout Phase 4 of context/foundation/test-plan.md: "CI gate & resource-abuse posture".
Risks covered: #1 (regressions ship undetected because the existing test suite never runs in CI), #7 (unbounded or repeated AI extraction calls create uncontrolled cost exposure). Test types planned: gates + research.
Risk response intent:
- #1: prove `npm run test` runs on every PR and blocks merge on failure - decide whether wiring the gate itself is in scope for this phase, or only naming the requirement; also determine whether the deploy job should gate on it too.
- #7: research-first - do not invent a rate-limit/cost-control test for a safeguard that may not exist; first establish whether any request throttling, quota, or cost cap exists today for the extraction call path, then decide what (if anything) is testable.
