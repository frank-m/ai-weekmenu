/**
 * Deep dive: explore Picnic product details page and store browsing for promo data.
 * Run with: npx tsx scripts/explore-picnic-sales2.ts
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

// Deep JSON search: find all objects matching a predicate
function findAll(obj: any, predicate: (val: any) => boolean, results: any[] = [], depth = 0): any[] {
  if (depth > 20 || !obj) return results;
  if (predicate(obj)) results.push(obj);
  if (typeof obj === "object") {
    for (const val of Object.values(obj)) {
      findAll(val, predicate, results, depth + 1);
    }
  }
  return results;
}

// Find all string values containing a substring
function findStrings(obj: any, substr: string, results: string[] = [], depth = 0): string[] {
  if (depth > 20 || !obj) return results;
  if (typeof obj === "string" && obj.toLowerCase().includes(substr.toLowerCase())) {
    results.push(obj);
  }
  if (typeof obj === "object") {
    for (const val of Object.values(obj)) {
      findStrings(val, substr, results, depth + 1);
    }
  }
  return results;
}

async function main() {
  if (!username || !password) { console.error("Missing credentials"); process.exit(1); }

  const client = new PicnicClient({ countryCode, apiVersion: "15" });
  await client.login(username, password);
  console.log("Logged in.\n");

  // 1. Get full product details page and dump it fully
  console.log("=== PRODUCT DETAILS PAGE (full dump) ===");
  const pdp = await client.getProductDetailsPage("s1002130");
  // Write full response to file for inspection
  fs.writeFileSync("scripts/pdp-response.json", JSON.stringify(pdp, null, 2));
  console.log("Full PDP response written to scripts/pdp-response.json");

  // Search for price-related data in the PDP
  const priceObjects = findAll(pdp, (o) => typeof o === "object" && o !== null && ("price" in o || "display_price" in o || "original_price" in o));
  console.log("\nPrice-related objects found in PDP:", priceObjects.length);
  for (const p of priceObjects.slice(0, 5)) {
    console.log(JSON.stringify(p, null, 2).slice(0, 500));
  }

  // Search for "promo", "korting", "aanbieding" strings
  for (const term of ["promo", "korting", "aanbieding", "actie", "sale", "original"]) {
    const found = findStrings(pdp, term);
    if (found.length > 0) {
      console.log(`\nStrings containing '${term}':`, found.slice(0, 5));
    }
  }

  // 2. Try several browsing endpoints with sendRequest
  console.log("\n=== BROWSING ENDPOINTS ===");

  for (const p of [
    "/my_store?depth=0",
    "/my_store?depth=1",
    "/my_store?depth=2",
    "/lists?depth=0",
    "/lists?depth=1",
    "/search?search_term=aanbieding",
  ]) {
    try {
      console.log(`\nGET ${p}...`);
      const resp = await client.sendRequest("GET", p);
      // Write to file
      const filename = `scripts/resp-${p.replace(/[/?=&]/g, "_")}.json`;
      fs.writeFileSync(filename, JSON.stringify(resp, null, 2));
      console.log(`  Written to ${filename}`);

      // Quick summary
      if (resp && typeof resp === "object") {
        if (resp.catalog) {
          console.log(`  Catalog categories: ${resp.catalog.length}`);
          for (const c of resp.catalog.slice(0, 10)) {
            console.log(`    - ${c.name} (${c.id}) [${c.items?.length || 0} items]`);
          }
        }
        if (Array.isArray(resp)) {
          console.log(`  Array with ${resp.length} items`);
          for (const item of resp.slice(0, 5)) {
            console.log(`    - ${item.name || item.id || JSON.stringify(item).slice(0, 80)}`);
          }
        }
      }
    } catch (err: any) {
      console.log(`  Failed: ${err?.message || err}`);
    }
  }

  // 3. Try to find promotions by browsing category deeplinks
  // The promotion endpoint needs a promotionId — let's search for it in store content
  try {
    console.log("\n=== LOOKING FOR PROMOTION IDS ===");
    const storeResp = JSON.parse(fs.readFileSync("scripts/resp-_my_store_depth_1.json", "utf-8"));
    const deeplinks = findStrings(storeResp, "promotion");
    console.log("Deeplinks containing 'promotion':", deeplinks.slice(0, 10));

    // Also look for category IDs that might be promos
    const allIds = findAll(storeResp, (o) => typeof o === "object" && o?.id && typeof o.id === "string");
    const promoIds = allIds.filter((o) => o.id.includes("promo") || o.name?.toLowerCase?.().includes("aanbieding"));
    console.log("Objects with promo-related IDs:", promoIds.slice(0, 10).map((o: any) => ({ id: o.id, name: o.name })));
  } catch (err: any) {
    console.log("Could not analyze store response:", err?.message);
  }

  console.log("\nDone!");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
