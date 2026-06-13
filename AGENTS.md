# Repository Guidelines

SnapRecipe is an AI-powered recipe-saving web app built on Astro 6 SSR with React 19 islands, Tailwind 4, Supabase auth, deployed to Cloudflare Workers.

## Hard Rules

- Full SSR mode (`output: "server"`): every API route must export `const prerender = false`.
- Never manually concatenate Tailwind class strings — use `cn()` from `@/lib/utils`.
- No Next.js directives (`"use client"`, `"use server"`) anywhere in the codebase.
- `SUPABASE_URL` and `SUPABASE_KEY` are server-only secrets declared via `astro:env/server` in `astro.config.mjs` — never reference them in client-side code.
- Use Astro components for static content and layout; create React components only when interactivity is needed.

## Project Structure

Source lives in `src/`: shadcn/ui components in `components/ui/` (new-york style); React hooks in `components/hooks/`; helpers in `lib/` and business logic in `lib/services/`; auth API endpoints in `pages/api/auth/`; Supabase migrations in `supabase/migrations/` named `YYYYMMDDHHmmss_description.sql`. Shared entities and DTOs go in `src/types.ts`. Path alias `@/*` resolves to `./src/*`.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production SSR build via `@astrojs/cloudflare`
- `npm run lint` / `npm run lint:fix` — ESLint with type-checked rules
- `npm run format` — Prettier (printWidth 120, astro + tailwindcss plugins)

CI gate (`.github/workflows/ci.yml`): lint then build on every push/PR to `master`; requires `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets. Pre-commit hook: ESLint fix on `*.{ts,tsx,astro}`, Prettier on `*.{json,css,md}`.

## Coding Conventions

- Add shadcn/ui components with `npx shadcn@latest add [name]`; they land in `src/components/ui/`.
- API routes export uppercase `GET`, `POST`, etc.; validate request bodies with zod.
- New Supabase tables must enable RLS with per-operation, per-role policies.

## Auth

Auth state flows through `src/middleware.ts` → `context.locals.user`. Protected pages rely on middleware redirects — do not add duplicate auth checks in page frontmatter. See `@src/lib/supabase.ts` for the SSR client pattern and `@src/middleware.ts` for the `PROTECTED_ROUTES` list.

## Environment

- Local Node dev: copy `.env.example` → `.env`
- Cloudflare local dev: use `.dev.vars` (gitignored)
- Local Supabase: `npx supabase start` (requires Docker)
- Deploy: `npx wrangler deploy`
