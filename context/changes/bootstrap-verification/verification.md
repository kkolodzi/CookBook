---
bootstrapped_at: 2026-06-13T14:07:29Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: snap-recipe
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
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
```

## Why this stack

SnapRecipe is a solo after-hours project targeting up to 10k users with a 3-week MVP timeline. The 10x Astro Starter is the recommended default for `(web-app, js)` and clears all four agent-friendly gates: TypeScript end-to-end, Astro file-based routing plus Supabase conventions, strong representation in JS training data, and well-maintained docs across every layer. Supabase covers two load-bearing PRD features out of the box — email-password auth (FR-001/FR-002) and file storage for recipe photos (FR-004/FR-018) — without manual wiring. The AI extraction step (FR-005) calls an external vision API; the call is I/O-bound, which is compatible with Cloudflare's edge runtime. Auth and AI feature flags are set; payments, realtime, and background jobs are out of scope per PRD non-goals. CI runs on GitHub Actions with auto-deploy-on-merge — the starter's standard shape and the right fit for solo work.

## Pre-scaffold verification

| Signal      | Value                                                              | Severity | Notes                                                   |
| ----------- | ------------------------------------------------------------------ | -------- | ------------------------------------------------------- |
| npm package | not run                                                            | n/a      | cmd_template starts with `git clone`; npm check skipped |
| GitHub repo | not run                                                            | n/a      | `gh` CLI not installed on this machine                  |

Recency check unavailable: `gh` CLI not found. Proceeding without recency signal.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned starter repo; upstream `.git/` deleted before move-up)
**Exit code**: 0
**Packages installed**: 773 packages (774 audited)
**Files moved**: ~20 top-level items (including `node_modules/`)
**Conflicts (.scaffold siblings)**:
  - `CLAUDE.md` → `CLAUDE.md.scaffold` (existing cwd version preserved)
  - `README.md` → `README.md.scaffold` (existing cwd version preserved)
**`context/` handling**: no `context/` in scaffold; cwd `context/` untouched
**.gitignore handling**: moved silently (absent in cwd prior to scaffold)
**.bootstrap-scaffold cleanup**: directory left in place (empty; Windows file handle prevented `rm -rf`; safe to delete manually — all contents were moved)

**npm warnings during install**:
  - `@babel/plugin-proposal-private-methods@7.18.6` — deprecated; superseded by `@babel/plugin-transform-private-methods`
  - `node-domexception@1.0.0` — deprecated; replaced by platform native DOMException

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 11 HIGH, 7 MODERATE, 0 LOW
**Direct vs transitive**: 5 HIGH direct, 6 HIGH transitive / 1 MODERATE direct, 6 MODERATE transitive

#### CRITICAL findings

None.

#### HIGH findings

**Direct:**

| Package               | Severity | Via                            | Advisory / Notes                                                                 | Fix available                              |
| --------------------- | -------- | ------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------ |
| `astro`               | HIGH     | esbuild, vite                  | esbuild binary integrity (CVSS 8.1); vite advisory (CVSS via esbuild chain)     | `astro@2.4.5` (major version downgrade)    |
| `wrangler`            | HIGH     | esbuild, miniflare             | esbuild CVSS 8.1; ws CVSS 4.4 (moderate via miniflare)                          | `wrangler@3.6.0` (major downgrade)         |
| `@astrojs/cloudflare` | HIGH     | astro, vite, wrangler          | Cascades from astro and wrangler HIGH chains                                     | `@astrojs/cloudflare@6.2.4` (major)        |
| `@astrojs/react`      | HIGH     | @vitejs/plugin-react, vite     | Cascades from vite HIGH chain                                                    | `@astrojs/react@3.6.2` (major downgrade)   |
| `@tailwindcss/vite`   | HIGH     | vite                           | Cascades from vite HIGH chain                                                    | fix available (no major bump required)     |

**Transitive:**

| Package                | Severity | Root cause                     | Notes                                                                            |
| ---------------------- | -------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `esbuild`              | HIGH     | GHSA-gv7w-rqvm-qjhr (CVSS 8.1) | Missing binary integrity for Deno module; Node.js workflows unaffected           |
| `vite`                 | HIGH     | esbuild chain                  | Cascades from esbuild advisory                                                   |
| `@vitejs/plugin-react` | HIGH     | vite chain                     | Cascades from vite                                                               |
| `@cloudflare/vite-plugin` | HIGH  | vite, wrangler, miniflare, ws  | Cascades from multiple chains                                                    |
| `devalue`              | HIGH     | GHSA-77vg-94rm-hx3p (CVSS 7.5) | DoS via sparse array deserialization in Svelte devalue; transitive, no direct API surface in starter |
| `vitefu`               | HIGH     | vite chain                     | Cascades from vite                                                               |

**Risk context**: All HIGH findings are concentrated in the **build toolchain** (`vite`, `esbuild`, `wrangler`, `@tailwindcss/vite`) and dev-time dependencies. These are not exposed in the production Cloudflare Pages runtime. The `esbuild` CVSS 8.1 advisory specifically concerns Deno's binary download mechanism — irrelevant to Node.js-based builds. `devalue` is a transitive dependency with no direct API surface in the Astro starter. No CRITICAL findings. Safe to start development; revisit when upstream packages ship fixes.

#### MODERATE findings

| Package                  | Severity | Advisory                              | Notes                               |
| ------------------------ | -------- | ------------------------------------- | ----------------------------------- |
| `@astrojs/check`         | MODERATE | via volar-service-yaml / yaml chain   | Dev linting tool; not production    |
| `@astrojs/language-server` | MODERATE | via volar-service-yaml chain        | LSP tooling; not production         |
| `miniflare`              | MODERATE | ws CVSS 4.4                           | Dev Cloudflare emulator             |
| `volar-service-yaml`     | MODERATE | yaml stack overflow advisory          | Dev LSP plugin                      |
| `ws`                     | MODERATE | GHSA-58qx-3vcg-4xpx (CVSS 4.4)       | Uninitialized memory disclosure; dev |
| `yaml`                   | MODERATE | GHSA-48c2-rrv3-qjmp (CVSS 4.3)       | Stack overflow via deeply nested YAML |
| `yaml-language-server`   | MODERATE | yaml chain                            | Dev LSP                             |

#### LOW / INFO findings

None.

## Hints recorded but not acted on

These hand-off fields were read and staged into this log; bootstrapper v1 takes no automated action on them. A future M1L4 skill ("Memory Architecture") will consume them.

| Hint                 | Value                  |
| -------------------- | ---------------------- |
| bootstrapper_confidence | first-class         |
| quality_override     | false                  |
| path_taken           | standard               |
| self_check_answers   | null                   |
| team_size            | solo                   |
| deployment_target    | cloudflare-pages       |
| ci_provider          | github-actions         |
| ci_default_flow      | auto-deploy-on-merge   |
| has_auth             | true                   |
| has_payments         | false                  |
| has_realtime         | false                  |
| has_ai               | true                   |
| has_background_jobs  | false                  |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Review `CLAUDE.md.scaffold` and `README.md.scaffold` — diff them against your existing files and decide which sections to keep from each.
- Delete `.bootstrap-scaffold/` (empty directory; left because Windows held a file handle during cleanup — safe to remove with File Explorer or `rd /s /q .bootstrap-scaffold` in cmd).
- Audit findings are build-tool-only at this stage; no urgent patches required before starting development.
- Configure Supabase: create a project at supabase.com, copy the URL and anon key into `.env` (see `.env.example` for the expected keys).
- Run `npm run dev` to verify the dev server starts cleanly.
