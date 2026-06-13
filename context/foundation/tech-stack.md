---
starter_id: 10x-astro-starter
package_manager: npm
project_name: snap-recipe
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

SnapRecipe is a solo after-hours project targeting up to 10k users with a 3-week MVP timeline. The 10x Astro Starter is the recommended default for `(web-app, js)` and clears all four agent-friendly gates: TypeScript end-to-end, Astro file-based routing plus Supabase conventions, strong representation in JS training data, and well-maintained docs across every layer. Supabase covers two load-bearing PRD features out of the box — email-password auth (FR-001/FR-002) and file storage for recipe photos (FR-004/FR-018) — without manual wiring. The AI extraction step (FR-005) calls an external vision API; the call is I/O-bound, which is compatible with Cloudflare's edge runtime. Auth and AI feature flags are set; payments, realtime, and background jobs are out of scope per PRD non-goals. CI runs on GitHub Actions with auto-deploy-on-merge — the starter's standard shape and the right fit for solo work.
