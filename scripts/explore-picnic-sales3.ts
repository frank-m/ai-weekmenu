/**
 * Try Picnic promotion endpoint + explore store page structure.
 * Run with: npx tsx scripts/explore-picnic-sales3.ts
 */

import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { decryptValue } from "../src/lib/encryption";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

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

const PicnicClient = require("picnic-api");
const username = process.env.PICNIC_USERNAME || getSettingFromDb("picnic_username") || "";
const password = process.env.PICNIC_PASSWORD || getSettingFromDb("picnic_password") || "";
const countryCode = process.env.PICNIC_COUNTRY_CODE || getSettingFromDb("picnic_country_code") || "NL";

function findAll(obj: any, predicate: (val: any) => boolean, results: any[] = [], depth = 0): any[] {
  if (depth > 30 || !obj) return results;
  if (predicate(obj)) results.push(obj);
  if (typeof obj === "object") {
    for (const val of Object.values(obj)) {
      findAll(val, predicate, results, depth + 1);
    }
  }
  return results;
}

async function main() {
  if (!username || !password) { console.error("Missing credentials"); process.exit(1); }

  const client = new PicnicClient({ countryCode, apiVersion: "15" });
  await client.login(username, password);
  console.log("Logged in.\n");

  const promoId = "a8bab856-9b35-4d42-abfd-e5318211352d";

  // 1. Try the promotion category endpoint
  console.log("=== PROMOTION ENDPOINT ===");
  for (const p of [
    `/promotion/${promoId}/category`,
    `/promotion/${promoId}/category?depth=0`,
    `/promotion/${promoId}/category?depth=2`,
    `/promotion/${promoId}`,
    `/promotions`,
    `/promotions?depth=0`,
  ]) {
    try {
      console.log(`\nGET ${p}...`);
      const resp = await client.sendRequest("GET", p);
      const filename = `scripts/promo-resp-${p.replace(/[/?=&{}]/g, "_").slice(0, 60)}.json`;
      fs.writeFileSync(filename, JSON.stringify(resp, null, 2));
      console.log(`  OK — written to ${filename}`);
      if (resp && typeof resp === "object") {
        console.log(`  Type: ${resp.type || typeof resp}`);
        if (resp.items) console.log(`  Items: ${resp.items.length}`);
        if (resp.catalog) console.log(`  Catalog: ${resp.catalog.length} categories`);
        if (Array.isArray(resp)) console.log(`  Array: ${resp.length} items`);
      }
    } catch (err: any) {
      console.log(`  Failed: ${err?.message || err}`);
    }
  }

  // 2. Try the "pages" endpoints (Picnic has a server-driven UI)
  console.log("\n=== PAGES / LANDING ENDPOINTS ===");
  for (const p of [
    "/pages/my-store",
    "/pages/landing",
    "/pages/promotions",
    "/landing-page",
    "/home",
    "/start-page",
  ]) {
    try {
      console.log(`\nGET ${p}...`);
      const resp = await client.sendRequest("GET", p);
      const filename = `scripts/page-resp-${p.replace(/[/?=&]/g, "_")}.json`;
      fs.writeFileSync(filename, JSON.stringify(resp, null, 2));
      console.log(`  OK — written to ${filename}`);

      // Search for promo-related content
      const promoObjects = findAll(resp, (o) =>
        typeof o === "object" && o !== null && (
          o.promotion_id || o.promotion_label ||
          (typeof o.name === "string" && (o.name.toLowerCase().includes("aanbieding") || o.name.toLowerCase().includes("korting") || o.name.toLowerCase().includes("promo")))
        )
      );
      if (promoObjects.length > 0) {
        console.log(`  Found ${promoObjects.length} promo-related objects`);
        for (const p of promoObjects.slice(0, 5)) {
          console.log(`    `, JSON.stringify({ id: p.id, name: p.name, promotion_id: p.promotion_id, promotion_label: p.promotion_label }).slice(0, 200));
        }
      }
    } catch (err: any) {
      console.log(`  Failed: ${err?.message || err}`);
    }
  }

  // 3. Also try search with the Picnic headers flag (the app sets custom headers)
  console.log("\n=== SEARCH WITH PICNIC HEADERS ===");
  try {
    const resp = await client.sendRequest("GET", "/search?search_term=aanbieding", null, true);
    console.log("  Search with headers:", Array.isArray(resp) ? `${resp.length} results` : typeof resp);
    if (Array.isArray(resp) && resp.length > 0) {
      for (const r of resp.slice(0, 3)) {
        console.log(`  - ${r.name} (${r.id}) €${r.display_price} decorators:${r.decorators?.length}`);
      }
    }
  } catch (err: any) {
    console.log(`  Failed: ${err?.message || err}`);
  }

  // 4. Search a few common grocery items and check for promotion labels
  console.log("\n=== SEARCHING COMMON ITEMS FOR PROMO DECORATORS ===");
  for (const query of ["kaas", "bier", "chips", "pizza", "cola"]) {
    try {
      const results = await client.search(query);
      const withPromo = (results || []).filter((r: any) =>
        r.decorators?.some((d: any) => d.type === "LABEL" || d.type === "VALIDITY_LABEL" || d.type === "BANNERS")
      );
      if (withPromo.length > 0) {
        console.log(`\n'${query}': ${withPromo.length}/${results.length} products with promo decorators`);
        for (const r of withPromo.slice(0, 3)) {
          const labels = r.decorators.filter((d: any) => d.type === "LABEL").map((d: any) => d.text);
          console.log(`  - ${r.name}: €${r.display_price} labels: ${JSON.stringify(labels)}`);
        }
      } else {
        console.log(`'${query}': ${results?.length || 0} results, 0 with promo decorators`);
      }
    } catch (err: any) {
      console.log(`'${query}': Failed — ${err?.message}`);
    }
  }

  // 5. Get article details for a few products to check price_info.original_price
  console.log("\n=== CHECKING getArticle FOR PRICE_INFO ===");
  const searchResults = await client.search("kaas");
  for (const item of (searchResults || []).slice(0, 5)) {
    try {
      const article = await client.getArticle(item.id);
      if (article.price_info?.original_price || article.labels?.promo) {
        console.log(`  ${article.name}: price=${article.price_info.price} original=${article.price_info.original_price} promo=${article.labels?.promo?.text}`);
      }
    } catch {
      // getArticle may 404 on v15
    }
    // Also try getProductDetailsPage
    try {
      const pdp = await client.getProductDetailsPage(item.id);
      const promos = findAll(pdp, (o) => typeof o === "object" && o !== null && o.promotion_id);
      if (promos.length > 0) {
        console.log(`  PDP ${item.name}: ${promos.length} promo objects — ${promos[0].promotion_label} (${promos[0].promotion_id})`);
      }
    } catch {
      // skip
    }
  }

  console.log("\nDone!");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
