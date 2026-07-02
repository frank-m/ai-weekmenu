# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Weekmenu: a web app that generates weekly dinner menus using Gemini AI, matches ingredients against Picnic grocery delivery (Dutch), and lets users add items to their Picnic cart. Stores previous weeks for recipe reuse. Separates staple pantry items from recipe-specific ingredients.

## Tech Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS (responsive, mobile-first)
- SQLite via better-sqlite3 for persistence
- `@google/genai` (Gemini) for recipe generation with structured JSON output
- `picnic-api` for grocery integration
- `mcp-picnic` configured as MCP server for development

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint
```

## Architecture

### General
- `output: "standalone"` in next.config.mjs enables Docker deployment
- `DB_PATH` env var configures SQLite database location (default: `./weekmenu.db`)

### Configuration Priority
Settings DB (SQLite) > environment variables (.env.local) > hardcoded defaults. Settings are managed via a key/value `settings` table and a SettingsModal in the UI.

### Key Data Flow: Week Creation (POST /api/weeks)
1. User fills wizard: num nights, servings, style/budget/healthy/portions/seasonal preferences
2. Optionally reuses recipes from previous weeks or custom recipes
3. Remaining slots filled by Gemini API (structured JSON, Dutch ingredient names); recent weeks' titles and 👎-rated titles are passed as avoid-lists for variety
4. Week + recipes + ingredients written in a single transaction (generation happens *before* any DB write, so a Gemini failure leaves no orphan week)
5. Each unique ingredient searched against Picnic API → best match stored. Matching failures do NOT fail the request — the response includes `picnic_matching: "ok" | "2fa_required" | "failed"`, and the week detail page shows an unmatched-ingredients banner with a "Retry matching" action (POST /api/weeks/[weekId]/rematch)
6. Redirect to week detail

### Gemini Integration (lib/gemini.ts)
- Uses `responseMimeType: 'application/json'` + `responseSchema` for guaranteed structured output, `temperature: 1.2` for variety
- Default model: `gemini-3.0-flash-preview` (configurable in settings)
- API key: settings DB → `GEMINI_API_KEY` env var fallback
- Seasonal produce: when `preferences.seasonal !== false`, injects current Dutch season's produce list as a soft preference (see `lib/seasonal.ts`)
- Variety: `getVarietyContext()` collects the last ~40 recipe titles across weeks (soft avoid) and all 👎-rated titles (hard avoid); regeneration additionally passes `rejected_titles` accumulated client-side per session so repeated regenerations don't bounce back to earlier suggestions
- `matchIngredientsToProducts` rethrows `PicnicTwoFactorRequiredError` from tool calls (instead of feeding error strings back to the model) so auth failures surface rather than producing all-null "successful" matches

### Picnic Integration (lib/picnic.ts)
- Singleton PicnicClient with lazy auth; state: `authenticated`, `needsTwoFactor`, `hasClient`; concurrent logins are deduplicated via an in-flight promise
- A persisted auth key (settings `picnic_auth_key`, never returned by GET /api/settings) is restored optimistically; `checkPicnicConnection()` validates it with a cheap `getUserDetails()` call — used by `POST /api/picnic/2fa` and the Navbar status pill
- 500ms delay between searches; 500ms delay between PDP calls (deals refresh) to avoid rate limiting
- Picnic returns 403 for rate limiting and 401 for expired sessions; ALL client calls (search, PDP, cart ops) go through `withAuthRetry`, which resets + re-authenticates and retries once on 401. 403 in `fetchSearch` retries once after a 5s wait; 403 in `fetchPDP` is not retried — back off and try again later.
- Settings PUT only calls `resetPicnicClient()` when a `picnic_*` value actually *changed* — an unconditional reset used to wipe the stored auth key on every settings save, silently logging the user out
- **Two-factor authentication (2FA)**: Picnic may enable mandatory 2FA on accounts. Login detects `second_factor_authentication_required: true` → sets `needsTwoFactor = true` → throws `PicnicTwoFactorRequiredError`. The app exposes a 2FA flow in Settings: send SMS code → verify code. Routes: `GET /api/picnic/2fa` (state), `POST /api/picnic/2fa/generate` (send SMS), `POST /api/picnic/2fa/verify` (verify code). Diagnostic: `npx tsx scripts/test-picnic.ts`
- Product images: `https://storefront-prod.nl.picnicinternational.com/static/images/{image_id}/small.png`
- Credentials from settings DB or env vars (`PICNIC_USERNAME`, `PICNIC_PASSWORD`, `PICNIC_COUNTRY_CODE`)
- PDP bundles & promo labels: see `docs/picnic-bundles-spec.md` — **always read this file** before working on Picnic product/bundle/promo features

### Database Schema (SQLite)
- **weeks**: id, title, created_at, num_nights, servings, preferences (JSON)
- **recipes**: id, week_id (FK, nullable — NULL for custom recipes), title, description, servings, prep_time, instructions, night_number, source_recipe_id (nullable), calories_per_serving, rating (nullable integer: 1=thumbs up, -1=thumbs down, NULL=unrated)
- **ingredients**: id, recipe_id (FK), name, quantity, is_staple (bool), category
- **picnic_products**: id, ingredient_id (FK), picnic_id, name, image_id, price (cents), unit_quantity, quantity, added_to_cart (bool)
- **settings**: key (PK), value — stores gemini_api_key, gemini_model, picnic_username, picnic_password, picnic_country_code, default_num_nights, default_servings, default_calories, week_title_format, exclude_staples_from_budget, deals_enabled; internal keys: picnic_auth_key (encrypted session token), staples_seeded (one-time seed flag)
- **frequent_items**: id, picnic_id, name, image_id, price (cents), unit_quantity, quantity
- **staples**: id, name (unique) — user-editable list of staple pantry ingredients, seeded with defaults exactly once (tracked via `staples_seeded` settings key, so an intentionally emptied list stays empty)
- **exclusions**: id, name (unique) — user-editable list of ingredients/dishes Gemini must never include in generated recipes
- **sale_cache**: picnic_id (PK), name, image_id, price (cents), promo_label, fetched_at (unix ts) — cached on-sale products; stale after 48h
- **known_promotions**: promotion_id (PK), seed_picnic_id, label, first_seen_at, last_seen_at, active — accumulates all ever-seen Picnic promotion UUIDs; used as seeds for future deal refreshes

### API Routes
- `api/settings` — GET/PUT settings (GET masks secrets and strips `picnic_auth_key`)
- `api/weeks` — GET list (`?include=recipes` adds lightweight recipe lists for the reuse picker), POST create (main orchestration; returns `picnic_matching` status)
- `api/weeks/[weekId]` — GET week detail, DELETE week
- `api/weeks/[weekId]/rematch` — POST retry Picnic matching for ingredients without a matched product
- `api/recipes/custom` — GET list custom recipes, POST create custom recipe
- `api/recipes/custom/[recipeId]` — GET single, PUT update, DELETE remove custom recipe
- `api/recipes/generate` — POST preview generation
- `api/picnic/search` — POST product search, PUT update matched product (bundle swap)
- `api/picnic/search/products` — POST raw product search (up to 20 results)
- `api/picnic/bundles` — POST fetch bundle variants via PDP
- `api/picnic/2fa` — GET in-memory auth state (authenticated/needsTwoFactor/hasClient/configured); POST verifies the connection end-to-end (login if needed + `getUserDetails` probe)
- `api/picnic/2fa/generate` — POST send 2FA SMS code
- `api/picnic/2fa/verify` — POST verify 2FA code `{code}`
- `api/picnic/cart` — GET cart, POST add to cart, DELETE clear entire cart
- `api/picnic/cart/bulk` — POST add multiple items
- `api/picnic/cart/[productId]` — DELETE remove from cart
- `api/picnic/promos` — POST batch promo label lookup (fetched live from PDP)
- `api/picnic/deals` — GET cached deals (sale_cache, max 48h stale)
- `api/picnic/deals/refresh` — POST two-phase refresh: seeds from frequent_items + all known_promotions; upserts sale_cache + known_promotions
- `api/frequent-items` — GET list, POST add, PUT update quantity, DELETE remove
- `api/staples` — GET list, POST add, DELETE remove staple ingredients
- `api/exclusions` — GET list, POST add, DELETE remove excluded ingredients/dishes
- `api/recipes/[recipeId]/regenerate` — POST regenerate a single recipe; body accepts `{rejected_titles: string[]}` (session-accumulated avoid list); returns `picnic_matching` status
- `api/recipes/[recipeId]/rating` — PATCH set recipe rating (1=👍, -1=👎, null=clear)

## Design Conventions

- English UI text, Dutch ingredient names (for Picnic search compatibility)
- Card-based responsive layouts with Tailwind
- Navbar hosts the section links (My Recipes, Deals, Frequent Items, Staples, Exclusions — hamburger menu on mobile) and a Picnic connection status pill (green=connected, amber=2FA, red=offline, gray=unconfigured) that opens Settings; components dispatch `picnic:2fa-required` (opens Settings) and `picnic:status-changed` (re-checks the pill) window events
- Picnic failures are surfaced, not swallowed: ingredient rows flash inline errors, the week page shows an unmatched-ingredients banner with "Retry matching", and the cart sidebar shows action errors
- Loading spinners during AI generation and Picnic matching
- Ingredient rows show: name + quantity | matched Picnic product + price + image | add-to-cart button (stacked vertically on mobile, horizontal on sm+)
- Staple classification uses a user-editable DB list (`staples` table) instead of a hardcoded array; the list is included in the Gemini prompt
- Calorie targets are configurable: `default_calories` setting + per-week portion size preference (light/normal/large)
- Deals (experimental, `deals_enabled` setting): no bulk Picnic promo endpoint exists. Discovery uses two sources:
  1. PDP "Meer met korting" section — each PDP exposes up to ~18 products sharing the same `promotion_id` UUID; these are harvested into `sale_cache` and the promotion UUID stored in `known_promotions` with a seed product ID
  2. Known promotion UUIDs from `known_promotions` are re-seeded on every refresh (even inactive ones — promotions rotate and can reactivate)
  - Refresh cap: 40 PDP calls per run, 500ms delay; Phase 1 skips frequent items already found via another item's promo group; Phase 2 processes most-recently-active promotions first
  - False positive: `product-page-labels-*` also contains cart quantity labels ("X in bestelling"); filtered out in `extractPromoLabel` with `/\bin bestelling\b/i`
  - Active deals injected into Gemini prompt only when `deals_enabled=true`

## Environment Variables (.env.local)

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.0-flash-preview
PICNIC_USERNAME=
PICNIC_PASSWORD=
PICNIC_COUNTRY_CODE=NL
```

## Docker

Dockerfile uses multi-stage build (deps → builder → runner). Runs as non-root user (uid 1001). GitHub Actions workflow (`.github/workflows/publish.yml`) publishes to ghcr.io on push to main or version tags.

## Maintaining Documentation

After completing work in this codebase, review and update these files if your changes affect them:
- `README.md` — user-facing docs (features, setup, data/privacy, security)
- `CLAUDE.md` — developer/AI context (architecture, schema, routes, conventions)

Keep both files accurate and concise. Only update sections affected by your changes.
