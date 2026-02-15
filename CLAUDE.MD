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
1. User fills wizard: num nights, servings, style/budget/healthy preferences
2. Optionally reuses recipes from previous weeks or custom recipes
3. Remaining slots filled by Gemini API (structured JSON, Dutch ingredient names)
4. Each unique ingredient searched against Picnic API → best match stored
5. Everything saved to SQLite → redirect to week detail

### Gemini Integration (lib/gemini.ts)
- Uses `responseMimeType: 'application/json'` + `responseSchema` for guaranteed structured output
- Default model: `gemini-2.5-flash` (configurable in settings)
- API key: settings DB → `GEMINI_API_KEY` env var fallback

### Picnic Integration (lib/picnic.ts)
- Singleton PicnicClient with lazy auth
- Search → take first result; on no results → simplify query (strip adjectives) → retry
- 250ms delay between searches to avoid rate limiting
- Product images: `https://storefront-prod.nl.picnicinternational.com/static/images/{image_id}/small.png`
- Credentials from settings DB or env vars (`PICNIC_USERNAME`, `PICNIC_PASSWORD`, `PICNIC_COUNTRY_CODE`)

### Database Schema (SQLite)
- **weeks**: id, title, created_at, num_nights, servings, preferences (JSON)
- **recipes**: id, week_id (FK, nullable — NULL for custom recipes), title, description, servings, prep_time, instructions, night_number, source_recipe_id (nullable)
- **ingredients**: id, recipe_id (FK), name, quantity, is_staple (bool), category
- **picnic_products**: id, ingredient_id (FK), picnic_id, name, image_id, price (cents), unit_quantity, quantity, added_to_cart (bool)
- **settings**: key (PK), value — stores gemini_api_key, gemini_model, picnic_username, picnic_password, picnic_country_code
- **frequent_items**: id, picnic_id, name, image_id, price (cents), unit_quantity, quantity

### API Routes
- `api/settings` — GET/PUT settings
- `api/weeks` — GET list, POST create (main orchestration)
- `api/weeks/[weekId]` — GET week detail
- `api/recipes/custom` — GET list custom recipes, POST create custom recipe
- `api/recipes/custom/[recipeId]` — GET single, PUT update, DELETE remove custom recipe
- `api/recipes/generate` — POST preview generation
- `api/picnic/search` — POST product search
- `api/picnic/cart` — GET cart, POST add to cart
- `api/picnic/cart/bulk` — POST add multiple items
- `api/picnic/cart/[productId]` — DELETE remove from cart
- `api/frequent-items` — GET list, POST add, PUT update quantity, DELETE remove
- `api/recipes/[recipeId]/regenerate` — POST regenerate a single recipe

## Design Conventions

- English UI text, Dutch ingredient names (for Picnic search compatibility)
- Card-based responsive layouts with Tailwind
- Loading spinners during AI generation and Picnic matching
- Ingredient rows show: name + quantity | matched Picnic product + price + image | add-to-cart button

## Environment Variables (.env.local)

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
PICNIC_USERNAME=
PICNIC_PASSWORD=
PICNIC_COUNTRY_CODE=NL
```

## Docker

Dockerfile uses multi-stage build (deps → builder → runner). Runs as non-root user (uid 1001). GitHub Actions workflow (`.github/workflows/publish.yml`) publishes to ghcr.io on push to main or version tags.

## Dev Container

The `.devcontainer/` config provides a sandboxed environment with firewall rules, Node.js, and Claude Code pre-installed. Workspace mounts at `/workspace`.

## Maintaining Documentation

After completing work in this codebase, review and update these files if your changes affect them:
- `README.md` — user-facing docs (features, setup, data/privacy, security)
- `CLAUDE.md` — developer/AI context (architecture, schema, routes, conventions)

Keep both files accurate and concise. Only update sections affected by your changes.
