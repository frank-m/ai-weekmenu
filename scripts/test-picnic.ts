/**
 * Minimal Picnic API diagnostic script.
 * Run with: npx tsx scripts/test-picnic.ts
 *
 * Tests login, session, search, and PDP in sequence.
 * Reads credentials from SQLite DB (weekmenu.db) automatically.
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
  if (key === "picnic_password") {
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PicnicClient = require("picnic-api");

async function run() {
  console.log("=== Picnic API Diagnostic ===\n");
  console.log(`Credentials source: DB / env`);
  console.log(`Username: ${username || "(empty)"}`);
  console.log(`Password: ${password ? "***" + password.slice(-2) : "(empty)"}`);
  console.log(`Country:  ${countryCode}\n`);

  if (!username || !password) {
    console.log("❌ FAILED: No credentials found. Check weekmenu.db settings or .env.local.");
    process.exit(1);
  }

  // No apiVersion → defaults to "15" (same as the app)
  const picnic = new PicnicClient({ countryCode });

  // Test 1: Login
  console.log("Test 1: Login...");
  try {
    const loginResult = await picnic.login(username, password);
    console.log("  Login response:", JSON.stringify(loginResult));
    if (loginResult?.second_factor_authentication_required) {
      console.log("  ⚠️  2FA REQUIRED — account needs two-factor authentication before API calls work.");
    }
    console.log("  ✅ Login succeeded\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ Login FAILED: ${msg}`);
    console.log(`  Raw HTTP status: ${lastHttpStatus} ${lastHttpStatusText}`);
    if (lastHttpStatus === 403) {
      console.log("  → IP may be rate-limited/blocked by Picnic, or credentials are wrong.");
    } else if (lastHttpStatus === 401) {
      console.log("  → Bad credentials (wrong username/password).");
    }
    console.log("\n❌ FAILED at Login — stopping.");
    process.exit(1);
  }

  // Test 2: getUserDetails — confirms session is live (needs 2FA to be verified first)
  console.log("Test 2: getUserDetails()...");
  try {
    const details = await picnic.getUserDetails();
    const name = details?.firstname || details?.first_name || "(unknown)";
    const email = details?.contact_email || details?.email || "(unknown)";
    console.log(`  ✅ Session active — user: ${name} (${email})\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ getUserDetails FAILED: ${msg}`);
    console.log(`  Raw HTTP status: ${lastHttpStatus} ${lastHttpStatusText}`);
    if (lastHttpStatus === 403) {
      console.log("\n  ROOT CAUSE: Picnic account requires 2FA verification.");
      console.log("  Login succeeded but the session token is blocked until 2FA is completed.");
      console.log("\n  FIX: Open the app → Settings → Picnic section → click 'Send SMS code' → enter code → 'Verify'.");
      console.log("  The app now supports 2FA verification in the Settings modal.");
    }
    console.log("\n❌ FAILED at getUserDetails — stopping.");
    process.exit(1);
  }

  // Test 3: search("melk")
  console.log('Test 3: search("melk")...');
  let firstProductId: string | null = null;
  try {
    const results = await picnic.search("melk");
    const items = Array.isArray(results) ? results : [];
    if (items.length === 0) {
      console.log("  ⚠️  Search returned 0 results (unexpected for 'melk')");
    } else {
      const first = items[0];
      firstProductId = first?.id || first?.items?.[0]?.id || null;
      const name = first?.name || first?.items?.[0]?.name || "(unknown)";
      console.log(`  ✅ Search returned ${items.length} result(s) — first: "${name}" (id: ${firstProductId})\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ search FAILED: ${msg}`);
    console.log(`  Raw HTTP status: ${lastHttpStatus} ${lastHttpStatusText}`);
    if (lastHttpStatus === 403) {
      console.log("  → Search endpoint is rate-limited or blocked.");
    }
    console.log("\n❌ FAILED at search — stopping.");
    process.exit(1);
  }

  // Test 4: getProductDetailsPage
  if (firstProductId) {
    console.log(`Test 4: getProductDetailsPage("${firstProductId}")...`);
    try {
      const pdp = await picnic.getProductDetailsPage(firstProductId);
      const hasBody = pdp && typeof pdp === "object";
      console.log(`  ✅ PDP returned ${hasBody ? "data" : "empty response"}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ❌ getProductDetailsPage FAILED: ${msg}`);
      console.log(`  Raw HTTP status: ${lastHttpStatus} ${lastHttpStatusText}`);
      console.log("\n❌ FAILED at getProductDetailsPage — stopping.");
      process.exit(1);
    }
  } else {
    console.log("Test 4: Skipped (no product ID from search)\n");
  }

  console.log("✅ ALL TESTS PASSED");
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
