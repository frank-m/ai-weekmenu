# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Weekmenu: a web app that generates weekly dinner menus using Gemini AI, matches ingredients against Picnic grocery delivery (Dutch), and lets users add items to their Picnic cart. Stores previous weeks for recipe reuse. Separates staple pantry items from recipe-specific ingredients.

## Tech Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS (responsive, mobile-first)
- SQLite via better-sqlite3 for persistence
- `@google/genai` (Gemini) for recipe generation with structured JSON output
- `picnic-api` (pinned to an exact 5.x version) for grocery integration — the library reads Picnic's app pages, which Picnic keeps changing (Fusion → RSC formats), so expect to bump it regularly
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
5. Each unique ingredient matched via `matchIngredientsWithFallback` (lib/gemini.ts): the Gemini tool-loop matcher first, then a plain first-result `searchProduct` for every ingredient it left null (or all of them if it threw). Fallback matches are stored with `picnic_products.auto_matched = 1` and shown as "Auto-matched · check" in the ingredient row; picking a product manually / swapping a bundle clears the flag. Matching failures do NOT fail the request — the response includes `picnic_matching: "ok" | "2fa_required" | "failed"`, and the week detail page shows an unmatched-ingredients banner with a "Retry matching" action (POST /api/weeks/[weekId]/rematch)
6. Redirect to week detail

### Gemini Integration (lib/gemini.ts)
- Uses `responseMimeType: 'application/json'` + `responseSchema` for guaranteed structured output; temperature left at the Gemini 3 default (1.0) per Google's guidance — variety comes from the prompt avoid-lists
- Two models (both configurable in settings / env): `gemini_model` (`GEMINI_MODEL`, default `gemini-3.8-flash`) for recipe generation; `gemini_matching_model` (`GEMINI_MATCHING_MODEL`, default `gemini-3.5-flash-lite`, `thinkingLevel: LOW`) for the `matchIngredientsToProducts` tool loop, which dominates token usage. `testApiKey` uses the Lite default
- Model fallback: every Gemini call goes through `ModelRunner` (lib/gemini.ts), following Google's guidance for 503 "high demand" errors (they're capacity, not quota): exponential backoff with jitter (~1s, ~2s, ±50%) and per-request timeouts (`httpOptions.timeout`) that grow per attempt — `RECIPE_RETRY` 90/120/150s, `MATCHING_RETRY` 30/45/60s per loop step. The configured model gets 3 attempts, then the runner walks the chain in `lib/gemini-models.ts` (recipes: 3.8 Flash → 3.6 Flash → 3.5 Flash-Lite; matching: Flash-Lite → 3.6 → 3.8, 2 attempts each) and stays on the model that worked for the rest of the matching loop. Retried: `ApiError` 429/500/502/503/504, UNAVAILABLE / RESOURCE_EXHAUSTED / "high demand" messages, and timeouts (AbortError); anything else (bad key, bad request) fails immediately. The SDK's own `retryOptions` is deliberately not used: it retries silently (no progress messages) and replaces Gemini's error with a generic "Retryable HTTP Error". Model ids, labels and chains live in the client-safe `lib/gemini-models.ts` (also used by SettingsModal). Batch API not used: every Gemini call here is interactive
- Progress messages: long requests (POST /api/weeks, regenerate, rematch) accept an `x-progress-id` header; `progressReporter(request)` (lib/progress.ts, in-memory on `globalThis`, 10 min TTL) records status lines ("Generating 5 recipes…", "… is busy, switching to …", "Searching Picnic directly…") that the client polls via `useProgress()` (lib/use-progress.ts) → `GET /api/progress/[id]` and shows in the loading indicator
- `migrateDeprecatedGeminiModel` (db.ts) clears saved deprecated model IDs on startup so they fall back to the current defaults; extend `DEPRECATED_GEMINI_MODELS` when Google retires models
- API key: settings DB → `GEMINI_API_KEY` env var fallback
- Seasonal produce: when `preferences.seasonal !== false`, injects current Dutch season's produce list as a soft preference (see `lib/seasonal.ts`)
- Variety: `getVarietyContext()` collects the last ~40 recipe titles across weeks (soft avoid) and all 👎-rated titles (hard avoid); regeneration additionally passes `rejected_titles` accumulated client-side per session so repeated regenerations don't bounce back to earlier suggestions
- `matchIngredientsToProducts` rethrows `PicnicTwoFactorRequiredError` from tool calls (instead of feeding error strings back to the model) so auth failures surface rather than producing all-null "successful" matches

### Picnic Integration (lib/picnic.ts)
- Singleton PicnicClient with lazy auth; state: `authenticated`, `needsTwoFactor`, `hasClient`; concurrent logins are deduplicated via an in-flight promise
- A persisted auth key (settings `picnic_auth_key`, never returned by GET /api/settings) is restored optimistically; `checkPicnicConnection()` validates it with a cheap `user.getUser()` call — used by `POST /api/picnic/2fa` and the Navbar status pill
- All library access is wrapped in lib/picnic.ts, which maps library models (camelCase) to the app's snake_case shapes (`RawSearchResult`, `MatchedProduct`, `CartItem`, `BundleOption`, `PromoProduct`); routes never touch the client directly
- Search uses `catalog.getSearchResults`, flattening the result sections in order ("Opnieuw bestellen" — previously bought — comes first) and skipping unavailable products; results carry `unit_price` and `promo_label`, which the Gemini matcher is told to use
- 500ms delay between searches; 500ms delay between promotion-group calls (deals refresh) to avoid rate limiting
- Picnic returns 401 for expired sessions, 403 "User is not authenticated" for a session key without completed 2FA, and plain 403 for rate limiting. ALL client calls go through `withAuthRetry`, which on a session error (`isSessionError`: a "not authenticated"-style message, a 401, or a 403 with an auth error code) resets + re-authenticates and retries once — a re-login that needs 2FA then surfaces as `PicnicTwoFactorRequiredError`. Every failed call and failed connection check is logged with Picnic's status, code and body (`[picnic] call failed:`). 403 in `fetchSearch` retries once after a 5s wait; other 403s are not retried — back off and try again later.
- Settings PUT only calls `resetPicnicClient()` when a `picnic_*` value actually *changed* — an unconditional reset used to wipe the stored auth key on every settings save, silently logging the user out
- **Two-factor authentication (2FA)**: Picnic may enable mandatory 2FA on accounts. Login detects `second_factor_authentication_required: true` → sets `needsTwoFactor = true` → throws `PicnicTwoFactorRequiredError`. The app exposes a 2FA flow in Settings: send SMS code → verify code. Routes: `GET /api/picnic/2fa` (state), `POST /api/picnic/2fa/generate` (send SMS), `POST /api/picnic/2fa/verify` (verify code). The 2FA calls are direct fetches using the library's `baseHeaders` + `picnicHeaders`, so the `x-picnic-agent` app version stays current (an outdated agent got 422s). Diagnostic: `npx tsx scripts/test-picnic.ts` (reuses the stored session; `--fresh-login` tests login and prints Picnic's error body)
- Product images: `https://storefront-prod.nl.picnicinternational.com/static/images/{image_id}/small.png`
- Credentials from settings DB or env vars (`PICNIC_USERNAME`, `PICNIC_PASSWORD`, `PICNIC_COUNTRY_CODE`)
- Bundles & promo labels: see `docs/picnic-bundles-spec.md` — **always read this file** before working on Picnic product/bundle/promo features. Bundles are now price tiers (`Product.priceRanges`) on one product: choosing one sets `quantity` to at least the tier minimum

### Database Schema (SQLite)
- **weeks**: id, title, created_at, num_nights, servings, preferences (JSON)
- **recipes**: id, week_id (FK, nullable — NULL for custom recipes), title, description, servings, prep_time, instructions, night_number, source_recipe_id (nullable), calories_per_serving, rating (nullable integer: 1=thumbs up, -1=thumbs down, NULL=unrated)
- **ingredients**: id, recipe_id (FK), name, quantity, is_staple (bool), category
- **picnic_products**: id, ingredient_id (FK), picnic_id, name, image_id, price (cents), unit_quantity, quantity, added_to_cart (bool), auto_matched (bool — unvetted first-result fallback match)
- **settings**: key (PK), value — stores gemini_api_key, gemini_model, gemini_matching_model, picnic_username, picnic_password, picnic_country_code, default_num_nights, default_servings, default_calories, week_title_format, exclude_staples_from_budget, deals_enabled; internal keys: picnic_auth_key (encrypted session token), staples_seeded (one-time seed flag)
- **frequent_items**: id, picnic_id, name, image_id, price (cents), unit_quantity, quantity
- **staples**: id, name (unique) — user-editable list of staple pantry ingredients, seeded with defaults exactly once (tracked via `staples_seeded` settings key, so an intentionally emptied list stays empty)
- **exclusions**: id, name (unique) — user-editable list of ingredients/dishes Gemini must never include in generated recipes
- **sale_cache**: picnic_id (PK), name, image_id, price (cents), promo_label, fetched_at (unix ts) — cached on-sale products; stale after 48h
- **known_promotions**: promotion_id (PK), seed_picnic_id, label, first_seen_at, last_seen_at, active — multi-product promotion groups seen on the promotions page; `active` = listed on the last refresh; `last_seen_at` orders groups when the per-run cap applies

### API Routes
- `api/settings` — GET/PUT settings (GET masks secrets and strips `picnic_auth_key`)
- `api/weeks` — GET list (`?include=recipes` adds lightweight recipe lists for the reuse picker), POST create (main orchestration; returns `picnic_matching` status)
- `api/weeks/[weekId]` — GET week detail, DELETE week
- `api/weeks/[weekId]/rematch` — POST retry Picnic matching for ingredients without a matched product
- `api/recipes/custom` — GET list custom recipes, POST create custom recipe
- `api/recipes/custom/[recipeId]` — GET single, PUT update, DELETE remove custom recipe
- `api/recipes/generate` — POST preview generation
- `api/picnic/search` — POST product search, PUT update matched product (product or bundle-tier swap; optional `quantity`)
- `api/picnic/search/products` — POST raw product search (up to 20 results)
- `api/picnic/bundles` — POST fetch bundle price tiers via `catalog.getProduct`
- `api/picnic/2fa` — GET in-memory auth state (authenticated/needsTwoFactor/hasClient/configured); POST verifies the connection end-to-end (login if needed + `user.getUser` probe)
- `api/picnic/2fa/generate` — POST send 2FA SMS code
- `api/picnic/2fa/verify` — POST verify 2FA code `{code}`
- `api/picnic/cart` — GET cart, POST add to cart, DELETE clear entire cart
- `api/picnic/cart/bulk` — POST add multiple items
- `api/picnic/cart/[productId]` — DELETE remove from cart
- `api/picnic/promos` — POST batch promo label lookup (fetched live via `catalog.getProduct`)
- `api/picnic/deals` — GET cached deals (sale_cache, max 48h stale)
- `api/picnic/deals/refresh` — POST refresh from the promotions page + its promotion groups; replaces sale_cache, upserts known_promotions
- `api/frequent-items` — GET list, POST add, PUT update quantity, DELETE remove
- `api/staples` — GET list, POST add, DELETE remove staple ingredients
- `api/exclusions` — GET list, POST add, DELETE remove excluded ingredients/dishes
- `api/recipes/[recipeId]/regenerate` — POST regenerate a single recipe; body accepts `{rejected_titles: string[]}` (session-accumulated avoid list); returns `picnic_matching` status
- `api/recipes/[recipeId]/rating` — PATCH set recipe rating (1=👍, -1=👎, null=clear)
- `api/progress/[id]` — GET latest progress message of a running request (`{message: string | null}`)

## Design Conventions

- English UI text, Dutch ingredient names (for Picnic search compatibility)
- Card-based responsive layouts with Tailwind
- Navbar hosts the section links (My Recipes, Deals, Frequent Items, Staples, Exclusions — hamburger menu on mobile) and a Picnic connection status pill (green=connected, amber=2FA, red=offline, gray=unconfigured) that opens Settings; components dispatch `picnic:2fa-required` (opens Settings) and `picnic:status-changed` (re-checks the pill) window events
- Picnic failures are surfaced, not swallowed: ingredient rows flash inline errors, the week page shows an unmatched-ingredients banner with "Retry matching", and the cart sidebar shows action errors
- Loading spinners during AI generation and Picnic matching, with live progress text (incl. model fallback notices) in the create wizard, the Regenerate button area and the "Retry matching" banner
- Ingredient rows show: name + quantity | matched Picnic product + price + image | add-to-cart button (stacked vertically on mobile, horizontal on sm+)
- Staple classification uses a user-editable DB list (`staples` table) instead of a hardcoded array; the list is included in the Gemini prompt
- Calorie targets are configurable: `default_calories` setting + per-week portion size preference (light/normal/large)
- Deals (experimental, `deals_enabled` setting): read from Picnic's promotions page (`catalog.getPromotions()`, the app's "Acties" tab) — tiles with a `PROMO` label go into `sale_cache`; multi-product promotion groups are expanded with `catalog.getPromotionGroup()` (max 40 calls per run, 500ms delay, most-recently-seen groups first)
  - Each refresh replaces `sale_cache`: the promotions page is the complete list, so anything not on it has ended
  - Active deals injected into Gemini prompt only when `deals_enabled=true`

## Environment Variables (.env.local)

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
GEMINI_MATCHING_MODEL=gemini-3.5-flash-lite
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
