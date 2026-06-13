---
project: SnapRecipe
researched_at: 2026-06-13
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6
  runtime: Cloudflare workerd (edge)
  database: Supabase (external)
---

## Recommendation

**Deploy on Cloudflare Workers.**

SnapRecipe's tech stack was built from the ground up for Cloudflare's workerd runtime — the `@astrojs/cloudflare` adapter, `astro:env/server` bindings, and `wrangler.jsonc` are all already present. Switching to any other platform requires replacing the adapter, rewriting environment variable access, and reconfiguring CI. Cloudflare Workers scores 5/5 Pass against the agent-friendly criteria (CLI-first wrangler, managed serverless, llms.txt docs, stable `wrangler deploy` API, GA MCP server). One critical nuance: **the project was bootstrapped for Cloudflare Pages, which has soft-deprecated SSR** — the first deploy step is migrating the config to Workers format (see Getting Started). The free tier's 10ms CPU cap is insufficient for SSR; the $5/mo paid tier (50ms CPU) is recommended from day one.

## Platform Comparison

| Kryterium | Cloudflare Workers | Netlify | Vercel | Fly.io | Railway | Render |
|---|---|---|---|---|---|---|
| CLI-first | **Pass** | Partial | Pass | Pass | Pass | Partial |
| Managed/Serverless | **Pass** | Pass | Pass | Partial | Pass | Pass |
| Agent-readable docs | **Pass** | Partial | Fail | Pass | Partial | Fail |
| Stable deploy API | **Pass** | Pass | Pass | Pass | Pass | Pass |
| MCP / Integration | **Pass** | Pass | Partial | Partial | Partial | Pass |
| **Wynik** | **5 Pass** | 3P 2Pa | 3P 1Pa 1F | 3P 1Pa 1F | 3P 2Pa | 3P 1Pa 1F |
| **Free tier** | 100K req/day (paid $5 for SSR) | ~1.5M req/mo | 100 GB BW | ~$2-5/mo | $5/mo min | Spin-down (free) / $7/mo |
| Zmiana adaptera wymagana | **Nie** | Tak | Tak | Tak | Tak | Tak |

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Natively supports the project's existing Cloudflare adapter, wrangler CLI, and workerd runtime. The only platform where zero adapter changes are needed. CLI covers the full operational loop: `wrangler deploy`, `wrangler rollback`, `wrangler tail`. Docs published as `llms.txt` and per-product markdown — best agent-readable coverage of all candidates. Official MCP server GA since May 2026. Gap vs. free-tier ideal: 10ms CPU cap requires $5/mo paid plan for SSR workloads.

#### 2. Netlify

Most generous free tier by raw request count (~1.5M req/mo on 300 free credits). Official `@astrojs/netlify` adapter GA for Astro 6 since March 10, 2026. Official MCP server with 9 tools including rollback (GA June 2025). Main gaps: no CLI rollback (UI-only), 10-second function timeout on free tier (may bite on slow AI extraction calls), no llms.txt, adapter swap from Cloudflare required.

#### 3. Vercel

Solid free tier (100GB bandwidth), Astro 6 SSR supported via `@astrojs/vercel`. MCP server in public beta (2026). Drops to third due to: no llms.txt (web-only docs), known Astro 6 + adapter build regression from April 2026 (verify resolution before committing), and MCP in beta rather than GA. Adapter swap required.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Słabości

1. **Pages → Workers migracja wymagana od razu.** `wrangler.jsonc` z bootstrappera jest w formacie Pages (`pages_build_output_dir`). Pierwsze wdrożenie wymaga przepisania konfiguracji na Workers (`assets { directory }`). `tech-stack.md` mówi `cloudflare-pages`, ale ten target jest soft-deprecated od Q1 2026.
2. **10ms CPU cap na free tierze uniemożliwia SSR produkcyjny.** Render strony z auth Supabase SSR (2 roundtrips) + formatowanie danych przekracza 10ms CPU. Paid plan ($5/mo, 50ms limit) jest niemal pewny od dnia wdrożenia — wbrew preferencji "minimize cost."
3. **Limit 50 subrequestów per request.** Strona z równoległymi zapytaniami do Supabase + wywołaniem vision API zbliża się do limitu; szczególnie przy dodaniu cache lookups.
4. **Node.js compatibility gaps.** `nodejs_compat` flag nie pokrywa natywnych addonów. Biblioteki do przetwarzania obrazów (`sharp`) zawiodą w runtime — konieczny audit zależności przed deploym.
5. **Auto Minify w dashboardzie niszczy React 19 hydration.** Włączenie tej opcji (domyślne przy podpięciu domeny) psuje client-side islands w React 19. Bug niewidoczny w `wrangler dev`.

### Pre-Mortem — Jak mogło się nie udać

Projekt wdrożony na Workers, trzy miesiące po launchu pojawia się seria nawarstwiających się problemów. Wdrożenie startuje ze zgrzytem: `wrangler.jsonc` jest w formacie Pages, a nowa dokumentacja Workers częściowo koliduje z tym, co zostało wygenerowane przez bootstrapper. Pierwsze deploye kończą się błędem konfiguracji środowisk.

Po uruchomieniu aplikacja sporadycznie zwraca `CPU time limit exceeded` przy normalnym ruchu na stronie listy przepisów — SSR + auth cookie z Supabase = ~80-120ms CPU per request, triple wolniej niż limit free tiera. Upgrade do paid tiera ($5/mo) rozwiązuje problem, ale narusza założenie "minimize cost."

W miesiącu 2 developer próbuje zoptymalizować zdjęcia przed wysłaniem do vision API. Każda sensowna biblioteka (`sharp`) crashuje na Workers z powodu natywnych addonów. Zdjęcia trafiają do API bez obróbki, co pogarsza jakość ekstrakcji składników.

W miesiącu 3 subtelny bug: sesja Supabase SSR wygasa zbyt wcześnie na urządzeniach mobilnych z powodu edge-runtime-specific cookie handling. Fix istnieje, ale diagnostyka zajmuje tydzień.

### Unknown Unknowns

- **`npm run dev` może używać `wrangler pages dev`** (Pages format) zamiast `wrangler dev` (Workers format). Po migracji ten skrypt wymaga aktualizacji — inaczej dev != prod.
- **Brak domyślnego log retention.** `wrangler tail` strumieniuje logi na żywo, ale bez Logpush (płatny) nie ma dostępu do historycznych logów. Debugowanie produkcyjnych bugów wymaga bycia online w momencie błędu lub konfiguracji Logpush.
- **Pages daje `<project>.pages.dev`, Workers daje `<worker>.<subdomain>.workers.dev`.** Inne URL preview, inne środowiska w dashboardzie — dezorientacja przy migrowaniu.
- **GitHub Actions CI wymaga konfiguracji dla Workers.** Pages miało zero-config GitHub integration; Workers wymaga dodania `wrangler` action do `.github/workflows/ci.yml` — nie jest automatyczne.
- **Cloudflare Auto Minify** — włączyć po podpięciu domeny produkcyjnej i React 19 islands przestają działać. Wyłączyć w dashboardzie: Speed → Optimization → Content Optimization → Auto Minify (JavaScript: off).

## Operational Story

- **Preview deploys**: `wrangler deploy --env preview` (lub branch deploy przez Cloudflare CI). Preview URL format: `<hash>.<worker>.<subdomain>.workers.dev`. Chronić przez Cloudflare Access jeśli preview ma być prywatny.
- **Secrets**: `wrangler secret put SUPABASE_URL` i `SUPABASE_KEY` per środowisko. Sekrety nie są widoczne po ustawieniu — tylko hash. Rotacja: `wrangler secret put <NAME>` nadpisuje.
- **Rollback**: `wrangler deployments list` → `wrangler rollback <deployment-id>`. Czas powrotu: ~30 sekund. Uwaga: migracje Supabase nie cofają się automatycznie — oddzielny krok.
- **Approval**: agent może: `wrangler deploy`, `wrangler rollback`, `wrangler tail`. Agent NIE powinien bez nadzoru: `wrangler secret put` (rotacja sekretów produkcyjnych), `wrangler delete` (usunięcie workera). Każda zmiana konfiguracji bindings (`wrangler.jsonc`) wymaga człowieka.
- **Logs**: `wrangler tail` (live feed). Dla historycznych logów: Cloudflare Dashboard → Workers → twój worker → Logs (7 dni, wymaga Logpush lub Workers Trace Events, beta).

## Risk Register

| Ryzyko | Źródło | Prawdopodobieństwo | Wpływ | Mitygacja |
|---|---|---|---|---|
| Pages config wymaga migracji do Workers przed pierwszym deploym | Research finding | Wysoki | Średni | Pierwsza akcja w Getting Started: zaktualizuj `wrangler.jsonc` z `pages_build_output_dir` na `assets { directory = "dist/client" }` |
| 10ms CPU cap na free tierze blokuje SSR produkcyjny | Devil's advocate | Wysoki | Wysoki | Przejdź na Workers paid plan ($5/mo) przed pierwszym wdrożeniem produkcyjnym |
| Auto Minify niszczy React 19 hydration po podpięciu domeny | Unknown unknowns | Średni | Wysoki | Wyłącz Auto Minify zaraz po podpięciu domeny: Dashboard → Speed → Auto Minify → JS: off |
| Brak historycznych logów bez Logpush | Unknown unknowns | Wysoki | Średni | Skonfiguruj Cloudflare Workers Logpush do R2 lub zewnętrznego loggera przy pierwszym incydencie produkcyjnym |
| Node.js native addons (np. `sharp`) failują w runtime | Devil's advocate | Średni | Średni | Przed deploym: uruchom `wrangler deploy --dry-run`, sprawdź bundle. Użyj pure-JS alternatyw do przetwarzania obrazów |
| subrequest limit 50/req przy równoległych wywołaniach Supabase + vision API | Devil's advocate | Niski | Sredni | Ogranicz równoległe fetch'e na poziomie SSR; sekwencjonuj Supabase auth + data query jeśli potrzeba |
| GitHub Actions CI nie działa automatycznie dla Workers (wymaga konfiguracji) | Unknown unknowns | Wysoki | Niski | Dodaj `cloudflare/wrangler-action` do `.github/workflows/ci.yml` — patrz Getting Started |

## Getting Started

1. **Zaktualizuj `wrangler.jsonc`** — zmień format z Pages na Workers. Zamień `pages_build_output_dir: "dist"` na:
   ```json
   "assets": { "directory": "./dist/client" }
   ```
   Usuń `compatibility_flags` związane z Pages jeśli istnieją; dodaj `"nodejs_compat": true` do `compatibility_flags`.

2. **Ustaw sekrety dla środowiska produkcyjnego:**
   ```
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```

3. **Skonfiguruj Workers paid plan** ($5/mo) przez Cloudflare Dashboard przed wdrożeniem produkcyjnym — free tier (10ms CPU) nie wystarcza dla SSR.

4. **Dodaj Wrangler Action do CI** — zaktualizuj `.github/workflows/ci.yml`, dodając krok deploy:
   ```yaml
   - name: Deploy
     uses: cloudflare/wrangler-action@v3
     with:
       apiToken: ${{ secrets.CF_API_TOKEN }}
   ```

5. **Po podpięciu domeny: wyłącz Auto Minify** w Cloudflare Dashboard → Speed → Optimization → Content Optimization → Auto Minify → JavaScript: Off.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup beyond wrangler-action pointer
- Production-scale architecture (multi-region, HA, DR)
