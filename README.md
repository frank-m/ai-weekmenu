# Weekmenu

A web app that generates weekly dinner menus using Gemini AI, matches ingredients against [Picnic](https://picnic.app/) grocery delivery (Dutch market), and lets you add items to your Picnic cart directly. Built for personal/household use.

## Vibecoded

Note: This app was fully vibecoded and is not meant to be ran in a production scenario. It has not been audited for security issues and is only meant to use at home to simplify ordering groceries. The app comes without any warranty or liability.

## Features

- **AI recipe generation** — Gemini generates dinner recipes with Dutch ingredient names, respecting cuisine style, budget, and health preferences
- **Picnic product matching** — each ingredient is automatically searched and matched to a Picnic product with price and image
- **Cart integration** — add matched products to your Picnic cart individually or in bulk
- **Custom recipes** — create your own recipes with ingredients and Picnic product matching, reuse them in any week
- **Recipe reuse** — browse previous weeks and custom recipes, reuse favourites in new menus
- **Configurable staples** — customize which ingredients are considered pantry staples (e.g. salt, oil, pasta) so the AI classifies them correctly
- **Portion sizes** — set a default calorie target in settings and choose per-week portion sizes (light, normal, large) in the creation wizard
- **Frequent items** — save commonly purchased products for quick access outside of recipes, with live promo badges showing active Picnic deals
- **Bundle selection** — ingredient rows and frequent items support a bundle picker to choose multi-pack variants (e.g. 6-pack vs single)
- **Leftover tracking** — tell the AI what leftovers you have so it incorporates them into new recipes
- **Recipe regeneration** — regenerate individual recipes without recreating the entire week

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
git clone <repo-url> && cd picnic-cc
npm install
```

Create `.env.local` in the project root:

```
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.0-flash-preview
PICNIC_USERNAME=your-picnic-email
PICNIC_PASSWORD=your-picnic-password
PICNIC_COUNTRY_CODE=NL
```

All settings can also be configured in the UI via the Settings modal (gear icon). Settings entered in the UI take priority over environment variables.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Docker

```bash
docker build -t weekmenu .

docker run -p 3000:3000 \
  -v weekmenu-data:/app/data \
  -e DB_PATH=/app/data/weekmenu.db \
  weekmenu
```

Environment variables can be passed with `-e`. Mount a volume to `/app/data` to persist the database across container restarts.

A GitHub Actions workflow publishes the image to `ghcr.io` on push to `main` or version tags.

## Architecture Overview

- **Next.js 14** (App Router) with TypeScript
- **SQLite** (better-sqlite3) for all persistent data
- **Gemini API** (`@google/genai`) for structured recipe generation and ingredient matching
- **Picnic API** (`picnic-api`) for product search and cart management
- **Tailwind CSS** for responsive, mobile-first UI

### LLM-driven ingredient matching

The app uses Gemini's function calling to create a clean separation between the LLM and the Picnic API. Rather than doing naive keyword searches for each ingredient, Gemini is given a `search_picnic` tool and decides autonomously how to search:

1. The app sends a list of recipe ingredients to Gemini along with the `search_picnic` tool definition
2. Gemini makes tool calls with simplified Dutch queries (stripping adjectives, quantities, and prep methods)
3. The app executes each search against the Picnic API and returns the results to Gemini
4. Gemini evaluates the results, retries with different queries if needed, and returns the final ingredient-to-product mapping

This multi-turn tool-use loop means the LLM handles the intelligence (query simplification, result evaluation, retry logic) while the Picnic API stays a simple search backend. The same pattern is used for the `mcp-picnic` MCP server configured for development with Claude Code.

See [CLAUDE.md](CLAUDE.md) for detailed architecture, database schema, and API route documentation.

## Data & Privacy

### What stays local (SQLite)

All recipes, ingredients, preferences, meal history, frequent items, shopping cart state, and matched product info. Nothing is shared externally beyond what is listed below.

### What is sent to Gemini (Google)

- Number of recipes and servings requested
- Cuisine preferences (style, budget, healthy, portion size)
- Leftover ingredient names and quantities
- Existing recipe titles (to avoid duplicates)

No personal data, credentials, or browsing history is sent.

### What is sent to the Picnic API

- Login credentials (username/password) for authentication
- Search queries (Dutch ingredient names)
- Cart operations (product IDs and quantities)

This is equivalent to using the Picnic app directly.

### Nothing else leaves the server

No analytics, no telemetry, no third-party tracking.

## Security

- **No built-in web authentication** — designed for single-user or trusted-network use
- **Encryption at rest** — sensitive settings (Gemini API key, Picnic password) are encrypted using Cryptr with a per-instance key stored in `.encryption-key` (mode 0600) or via the `ENCRYPTION_KEY` env var
- **Masked API responses** — the settings API masks sensitive values (API key shows first 8 chars, password shows `********`)
- **Docker** — runs as non-root user (uid 1001)
- **Dev container** — default-deny firewall with explicit domain allowlist

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API key | — |
| `GEMINI_MODEL` | Gemini model to use | `gemini-3.0-flash-preview` |
| `PICNIC_USERNAME` | Picnic account email | — |
| `PICNIC_PASSWORD` | Picnic account password | — |
| `PICNIC_COUNTRY_CODE` | Picnic country | `NL` |
| `DB_PATH` | SQLite database file location | `./weekmenu.db` |
| `ENCRYPTION_KEY` | Key for encrypting sensitive settings | auto-generated |

## License

MIT
