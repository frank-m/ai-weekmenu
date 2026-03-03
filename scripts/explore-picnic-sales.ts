/**
 * Explore Picnic API for sales/promotions data.
 * Run with: npx tsx scripts/explore-picnic-sales.ts
 *
 * Uses credentials from .env.local or the SQLite settings DB.
 */

import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { decryptValue } from "../src/lib/encryption";

// Load .env.local
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

// Try to read credentials from the settings DB
function getSettingFromDb(key: string): string | undefined {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "weekmenu.db");
  if (!fs.existsSync(dbPath)) return undefined;
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  db.close();
  if (!row) return undefined;
  if (key === "picnic_password") {
    try { return decryptValue(row.value); } catch { return row.value; }
  }
  return row.value;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PicnicClient = require("picnic-api");

const username = process.env.PICNIC_USERNAME || getSettingFromDb("picnic_username") || "";
const password = process.env.PICNIC_PASSWORD || getSettingFromDb("picnic_password") || "";
const countryCode = process.env.PICNIC_COUNTRY_CODE || getSettingFromDb("picnic_country_code") || "NL";

function truncate(obj: unknown, maxDepth = 5, depth = 0): unknown {
  if (depth >= maxDepth) return "[...]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj.length > 300 ? obj.slice(0, 300) + "..." : obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    const shown = obj.slice(0, 8).map((x) => truncate(x, maxDepth, depth + 1));
    if (obj.length > 8) shown.push(`... (${obj.length - 8} more)`);
    return shown;
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = truncate(v, maxDepth, depth + 1);
  }
  return result;
}

function log(label: string, data: unknown) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("=".repeat(60));
  console.log(JSON.stringify(truncate(data, 6), null, 2));
}

async function tryCall<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn();
    log(label, result);
    return result;
  } catch (err: any) {
    console.log(`\n[FAILED] ${label}: ${err?.message || err}`);
    return null;
  }
}

async function main() {
  if (!username || !password) {
    console.error("Missing PICNIC_USERNAME or PICNIC_PASSWORD");
    process.exit(1);
  }

  // Try multiple API versions
  for (const apiVersion of ["17", "15"]) {
    console.log(`\n${"#".repeat(60)}`);
    console.log(`  TRYING API VERSION: ${apiVersion}`);
    console.log(`${"#".repeat(60)}`);

    const client = new PicnicClient({ countryCode, apiVersion });
    console.log("Logging in...");
    try {
      await client.login(username, password);
    } catch (err: any) {
      console.log(`Login failed with API v${apiVersion}: ${err?.message || err}`);
      continue;
    }
    console.log("Logged in successfully.");

    // 1. getCategories depth=0
    const store: any = await tryCall("getCategories(0)", () => client.getCategories(0));

    if (store) {
      log("Catalog category names + IDs",
        store.catalog?.map((c: any) => ({
          id: c.id, name: c.name, type: c.type,
          itemCount: c.items?.length,
          decoratorTypes: c.decorators?.map((d: any) => d.type),
        }))
      );

      // Look for promo categories
      const promoCandidates = (store.catalog || []).filter((c: any) => {
        const name = (c.name || "").toLowerCase();
        return name.includes("aanbieding") || name.includes("promo") || name.includes("sale")
          || name.includes("bonus") || name.includes("korting") || name.includes("actie")
          || name.includes("nieuw") || name.includes("new");
      });

      if (promoCandidates.length > 0) {
        log("Promotion-related categories", promoCandidates.map((c: any) => ({ id: c.id, name: c.name })));
      } else {
        console.log("\n[INFO] No promotion categories found by name matching.");
        // Show ALL category names for manual inspection
        log("ALL category names",
          store.catalog?.map((c: any) => c.name)
        );
      }

      if (store.content && store.content.length > 0) {
        log("Content sections (display_position, types)", store.content);
      }
    }

    // 2. getCategories depth=2 — get products inside categories
    const storeDeep: any = await tryCall("getCategories(2) — first 2 cats", async () => {
      const s = await client.getCategories(2);
      return s.catalog?.slice(0, 2).map((c: any) => ({
        id: c.id, name: c.name,
        subcategories: c.items?.slice(0, 3).map((sub: any) => ({
          id: sub.id, name: sub.name,
          products: sub.items?.slice(0, 3).map((p: any) => ({
            id: p.id, name: p.name, type: p.type,
            decorators: p.decorators,
          })),
        })),
      }));
    });

    // 3. Try getLists
    await tryCall("getLists(0)", async () => {
      const lists = await client.getLists(0);
      return Array.isArray(lists) ? lists.map((l: any) => ({
        id: l.id, name: l.name, type: l.type, itemCount: l.items?.length,
        decoratorTypes: l.decorators?.map((d: any) => d.type),
      })) : lists;
    });

    await tryCall("getLists(1) — with items", async () => {
      const lists = await client.getLists(1);
      return Array.isArray(lists) ? lists.slice(0, 5).map((l: any) => ({
        id: l.id, name: l.name,
        items: l.items?.slice(0, 3).map((i: any) => ({
          id: i.id, name: i.name, type: i.type,
          decoratorTypes: i.decorators?.map((d: any) => d.type),
        })),
      })) : lists;
    });

    // 4. Try raw promotion endpoints
    for (const p of [
      "/promotions",
      "/promotion",
      "/my_store?depth=0",
    ]) {
      await tryCall(`sendRequest GET ${p}`, () => client.sendRequest("GET", p));
    }

    // 5. Search for products and inspect decorators
    await tryCall("search('aanbieding')", () => client.search("aanbieding"));

    const searchResults: any = await tryCall("search('melk') — check decorators", () => client.search("melk"));

    // 6. Find a product with promo decorators
    if (searchResults && searchResults.length > 0) {
      // Check all results for any with LABEL or promo-looking decorators
      const withPromo = searchResults.filter((r: any) =>
        r.decorators?.some((d: any) =>
          d.type === "LABEL" || d.type === "VALIDITY_LABEL" || d.type === "BANNERS"
        )
      );
      if (withPromo.length > 0) {
        log("Products with promo decorators", withPromo.slice(0, 3));
      }

      // Get article details for first result
      const articleId = searchResults[0].id;
      await tryCall(`getArticle('${articleId}') — full details`, async () => {
        const a = await client.getArticle(articleId);
        return {
          id: a.id, name: a.name,
          price_info: a.price_info,
          labels: a.labels,
          decorators: a.decorators,
          highlights: a.highlights,
        };
      });
    }

    // 7. Try getProductDetailsPage for a search result
    if (searchResults && searchResults.length > 0) {
      await tryCall(`getProductDetailsPage('${searchResults[0].id}')`, () =>
        client.getProductDetailsPage(searchResults[0].id)
      );
    }

    // If search worked, no need to try another API version
    if (searchResults && searchResults.length > 0) break;
  }

  console.log("\n\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
