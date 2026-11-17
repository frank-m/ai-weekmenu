/**
 * Minimal Picnic API diagnostic script.
 * Run with: npx tsx scripts/test-picnic.ts
 *
 * Tests login, session, search, product page and promotions in sequence.
 * Reads credentials from SQLite DB (weekmenu.db) automatically. Reuses the
 * app's stored session (picnic_auth_key) when present, so it doesn't trigger a
 * new login + 2FA SMS; pass --fresh-login to force a password login.
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

// Load credentials from SQLite settings DB
function getSettingFromDb(key: string): string | undefined {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "weekmenu.db");
  if (!fs.existsSync(dbPath)) return undefined;
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  db.close();
  if (!row) return undefined;
  if (key === "picnic_password" || key === "picnic_auth_key") {
    try { return decryptValue(row.value); } catch { return row.value; }
  }
  return row.value;
}

const username = getSettingFromDb("picnic_username") || process.env.PICNIC_USERNAME || "";
const password = getSettingFromDb("picnic_password") || process.env.PICNIC_PASSWORD || "";
const countryCode = getSettingFromDb("picnic_country_code") || process.env.PICNIC_COUNTRY_CODE || "NL";

// Patch fetch to intercept raw HTTP status codes before picnic-api parses them
const originalFetch = globalThis.fetch;
let lastHttpStatus: number | null = null;
let lastHttpStatusText: string | null = null;

globalThis.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  const response = await originalFetch(input, init);
  lastHttpStatus = response.status;
  lastHttpStatusText = response.statusText;
  if (!response.ok) {
    console.log(`  [HTTP] ${init?.method || "GET"} ${url} → ${response.status} ${response.statusText}`);
  }
  return response;
};

import PicnicClient from "picnic-api";

const storedAuthKey = process.argv.includes("--fresh-login") ? "" : getSettingFromDb("picnic_auth_key") || "";

/** Prints Picnic's error body too — it usually says *why* (e.g. a 422 code). */
function report(step: string, err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ❌ ${step} FAILED: ${msg}`);
  console.log(`  Raw HTTP status: ${lastHttpStatus} ${lastHttpStatusText}`);
  if (PicnicClient.isPicnicApiError(err)) {
    console.log(`  Picnic error code: ${err.code ?? "(none)"}`);
    console.log(`  Picnic error body: ${err.body.slice(0, 500)}`);
  }
  console.log(`\n❌ FAILED at ${step} — stopping.`);
  process.exit(1);
}

async function run() {
  console.log("=== Picnic API Diagnostic ===\n");
  console.log(`Username: ${username ? "(set)" : "(empty)"}`);
  console.log(`Password: ${password ? "(set)" : "(empty)"}`);
  console.log(`Country:  ${countryCode}\n`);

  const picnic = new PicnicClient({
    countryCode: countryCode as PicnicClient.Types.common.CountryCode,
    ...(storedAuthKey ? { authKey: storedAuthKey } : {}),
  });
  console.log(`Agent:    ${picnic.agent}\n`);

  // Test 1: Login (skipped when reusing the app's stored session)
  if (storedAuthKey) {
    console.log("Test 1: Login skipped — reusing the app's stored session (use --fresh-login to test login)\n");
  } else {
    if (!username || !password) {
      console.log("❌ FAILED: No credentials found. Check weekmenu.db settings or .env.local.");
      process.exit(1);
    }
    console.log("Test 1: Login...");
    try {
      const loginResult = await picnic.auth.login(username, password);
      if (loginResult.secondFactorAuthenticationRequired) {
        console.log("  ⚠️  2FA REQUIRED — verify via the app's Settings → Picnic before API calls work.");
      }
      console.log("  ✅ Login succeeded\n");
    } catch (err) {
      if (lastHttpStatus === 401) console.log("  → Bad credentials (wrong username/password).");
      report("Login", err);
    }
  }

  // Test 2: getUser — confirms the session is live (needs 2FA to be verified first)
  console.log("Test 2: user.getUser()...");
  try {
    await picnic.user.getUser();
    console.log("  ✅ Session active\n");
  } catch (err) {
    if (lastHttpStatus === 401 || lastHttpStatus === 403) {
      console.log("  → Session not valid: complete 2FA in the app (Settings → Picnic), or run with --fresh-login.");
    }
    report("getUser", err);
  }

  // Test 3: search
  console.log('Test 3: catalog.getSearchResults("melk")...');
  let firstProductId: string | null = null;
  try {
    const results = await picnic.catalog.getSearchResults("melk");
    const tiles = (results.products?.sections ?? []).flatMap((s) => s.products);
    if (tiles.length === 0) {
      console.log("  ⚠️  Search returned 0 results (unexpected for 'melk')");
    } else {
      firstProductId = tiles[0].id;
      console.log(`  ✅ ${tiles.length} result(s) — first: "${tiles[0].name}" (${tiles[0].id}, ${tiles[0].unitPrice ?? "no unit price"})\n`);
    }
  } catch (err) {
    report("search", err);
  }

  // Test 4: product page
  if (firstProductId) {
    console.log(`Test 4: catalog.getProduct("${firstProductId}")...`);
    try {
      const product = await picnic.catalog.getProduct(firstProductId);
      console.log(`  ✅ "${product.name}" — tiers: ${product.priceRanges?.length ?? 0}, promotion: ${product.promotion?.label ?? "none"}\n`);
    } catch (err) {
      report("getProduct", err);
    }
  } else {
    console.log("Test 4: Skipped (no product ID from search)\n");
  }

  // Test 5: promotions page (Deals)
  console.log("Test 5: catalog.getPromotions()...");
  try {
    const promotions = await picnic.catalog.getPromotions();
    const products = promotions.sections.reduce((n, s) => n + s.products.length, 0);
    const groups = promotions.sections.reduce((n, s) => n + s.groups.length, 0);
    console.log(`  ✅ ${promotions.sections.length} sections, ${products} products, ${groups} promotion groups\n`);
  } catch (err) {
    report("getPromotions", err);
  }

  console.log("✅ ALL TESTS PASSED");
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
