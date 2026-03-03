// eslint-disable-next-line @typescript-eslint/no-require-imports
const PicnicClient = require("picnic-api");
import { getSetting, setSetting } from "./db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;
let authenticated = false;
let needsTwoFactor = false;

export class PicnicTwoFactorRequiredError extends Error {
  constructor() {
    super("Picnic two-factor authentication required. Go to Settings → Picnic to verify.");
    this.name = "PicnicTwoFactorRequiredError";
  }
}

export function getPicnicAuthState() {
  return { authenticated, needsTwoFactor, hasClient: !!client };
}

function getCredentials() {
  return {
    username: getSetting("picnic_username") || process.env.PICNIC_USERNAME || "",
    password: getSetting("picnic_password") || process.env.PICNIC_PASSWORD || "",
    countryCode:
      getSetting("picnic_country_code") ||
      process.env.PICNIC_COUNTRY_CODE ||
      "NL",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPicnicClient(): Promise<any> {
  const creds = getCredentials();
  console.log("[picnic] getPicnicClient called, authenticated:", authenticated, "needsTwoFactor:", needsTwoFactor, "hasClient:", !!client);
  console.log("[picnic] credentials present — username:", !!creds.username, "password:", !!creds.password, "country:", creds.countryCode);

  if (!creds.username || !creds.password) {
    throw new Error(
      "Picnic credentials not configured. Set them in Settings or .env.local"
    );
  }

  // If client exists but is awaiting 2FA, surface that immediately
  if (client && needsTwoFactor) {
    throw new PicnicTwoFactorRequiredError();
  }

  if (!client || !authenticated) {
    // Try to restore a previously persisted auth key (survives hot-reloads and
    // worker restarts — avoids triggering a fresh login + 2FA cycle).
    const storedAuthKey = getSetting("picnic_auth_key");
    if (storedAuthKey) {
      console.log("[picnic] restoring session from stored auth key");
      client = new PicnicClient({ countryCode: creds.countryCode, authKey: storedAuthKey });
      authenticated = true;
      needsTwoFactor = false;
      return client;
    }

    console.log("[picnic] creating new PicnicClient and logging in...");
    client = new PicnicClient({
      countryCode: creds.countryCode,
    });
    try {
      const loginResult = await client.login(creds.username, creds.password);
      if (loginResult?.second_factor_authentication_required) {
        console.log("[picnic] login requires 2FA");
        needsTwoFactor = true;
        authenticated = false;
        throw new PicnicTwoFactorRequiredError();
      }
      authenticated = true;
      needsTwoFactor = false;
      // Persist auth key so it survives module reloads
      setSetting("picnic_auth_key", client.authKey);
      console.log("[picnic] login successful");
    } catch (err) {
      if (err instanceof PicnicTwoFactorRequiredError) throw err;
      console.error("[picnic] login failed:", err);
      client = null;
      authenticated = false;
      needsTwoFactor = false;
      throw err;
    }
  }

  return client;
}

export function resetPicnicClient(): void {
  client = null;
  authenticated = false;
  needsTwoFactor = false;
  try { setSetting("picnic_auth_key", ""); } catch { /* ignore — db may not be ready */ }
}

/** Logs in (if needed) and generates a 2FA SMS code. */
export async function generatePicnicTwoFactor(): Promise<void> {
  const creds = getCredentials();
  if (!creds.username || !creds.password) {
    throw new Error("Picnic credentials not configured.");
  }

  // Ensure we have a pre-2FA client
  if (!client || (!authenticated && !needsTwoFactor)) {
    client = new PicnicClient({ countryCode: creds.countryCode });
    const loginResult = await client.login(creds.username, creds.password);
    if (!loginResult?.second_factor_authentication_required) {
      // Already authenticated without 2FA
      authenticated = true;
      needsTwoFactor = false;
      return;
    }
    needsTwoFactor = true;
    authenticated = false;
  }

  // Direct fetch — picnic's /user/2fa/generate returns HTTP 200 with an empty body.
  // Using client.generate2FACode() would call response.json() on that empty body
  // and throw a SyntaxError. We skip body parsing entirely here.
  const generateResponse = await fetch(`${client.url}/user/2fa/generate`, {
    method: "POST",
    headers: {
      "User-Agent": "okhttp/3.12.2",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": client.authKey,
      "x-picnic-agent": "30100;1.15.232-15154",
      "x-picnic-did": "3C417201548B2E3B",
    },
    body: JSON.stringify({ channel: "SMS" }),
  });
  if (!generateResponse.ok) {
    const text = await generateResponse.text().catch(() => "");
    throw new Error(
      `Failed to send 2FA code: ${generateResponse.status} ${generateResponse.statusText}${text ? ` — ${text}` : ""}`
    );
  }
  // Success — do NOT call response.json() as the body may be empty
  console.log("[picnic] 2FA SMS code generated");
}

/** Verifies a 2FA code and marks the session as authenticated. */
export async function verifyPicnicTwoFactor(code: string): Promise<void> {
  if (!client) {
    throw new Error("No Picnic session. Generate a 2FA code first.");
  }
  // Direct fetch — we need to capture the updated x-picnic-auth header that
  // Picnic issues after 2FA verification (JWT gains pc:2fa: VERIFIED claim).
  // client.verify2FACode() discards response headers, leaving the old token.
  const verifyResponse = await fetch(`${client.url}/user/2fa/verify`, {
    method: "POST",
    headers: {
      "User-Agent": "okhttp/3.12.2",
      "Content-Type": "application/json; charset=UTF-8",
      "x-picnic-auth": client.authKey,
      "x-picnic-agent": "30100;1.15.232-15154",
      "x-picnic-did": "3C417201548B2E3B",
    },
    body: JSON.stringify({ otp: code }),
  });
  if (!verifyResponse.ok) {
    const text = await verifyResponse.text().catch(() => "");
    throw new Error(
      `Verification failed: ${verifyResponse.status} ${verifyResponse.statusText}${text ? ` — ${text}` : ""}`
    );
  }
  // Capture the updated auth token if Picnic issues one post-verification
  const newAuthKey = verifyResponse.headers.get("x-picnic-auth");
  if (newAuthKey) {
    client.authKey = newAuthKey;
    console.log("[picnic] 2FA verify returned updated auth key");
  }
  authenticated = true;
  needsTwoFactor = false;
  // Persist auth key so the session survives hot-reloads and worker restarts
  setSetting("picnic_auth_key", client.authKey);
  console.log("[picnic] 2FA verified, session is now active");
}

export interface MatchedProduct {
  picnic_id: string;
  name: string;
  image_id: string;
  price: number;
  unit_quantity: string;
}

export interface RawSearchResult {
  id: string;
  name: string;
  price: number;
  image_id: string;
  unit_quantity: string;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchSearch(query: string): Promise<any[]> {
  const picnic = await getPicnicClient();
  try {
    const results = await picnic.search(query);
    return Array.isArray(results) ? results : [];
  } catch (err: unknown) {
    // 401 = expired session → reset and re-auth, then retry once
    if (err instanceof Error && err.message.includes("401")) {
      resetPicnicClient();
      const retryClient = await getPicnicClient();
      const results = await retryClient.search(query);
      return Array.isArray(results) ? results : [];
    }
    // 403 = rate limit → wait 5s and retry once
    if (err instanceof Error && err.message.includes("403")) {
      console.warn("[picnic] 403 rate limit, waiting 5s before retry...", err.message);
      await delay(5000);
      const retryResult = await picnic.search(query);
      return Array.isArray(retryResult) ? retryResult : [];
    }
    throw err;
  }
}

export async function rawSearch(query: string, limit: number = 5): Promise<RawSearchResult[]> {
  console.log("[picnic] rawSearch called with query:", query);
  const items = await fetchSearch(query);
  console.log("[picnic] rawSearch results count:", items.length);
  console.log("[picnic] rawSearch results count:", items.length);

  const maxResults = Math.min(Math.max(limit, 1), 20);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return items.slice(0, maxResults).map((item: any) => ({
    id: String(item.id),
    name: item.name || "",
    price: parseInt(item.display_price) || 0,
    image_id: item.image_id || "",
    unit_quantity: item.unit_quantity || "",
  }));
}

export async function searchProduct(
  query: string
): Promise<MatchedProduct | null> {
  console.log("[picnic] searchProduct called with query:", query);
  const items = await fetchSearch(query);
  console.log("[picnic] results count:", items.length);

  if (items.length > 0) {
    const item = items[0];
    console.log("[picnic] matched product:", item.name, "id:", item.id, "price:", item.display_price);
    return {
      picnic_id: String(item.id),
      name: item.name || "",
      image_id: item.image_id || "",
      price: parseInt(item.display_price) || 0,
      unit_quantity: item.unit_quantity || "",
    };
  }

  console.log("[picnic] no products found for:", query);
  return null;
}

export async function addToCart(
  productId: string,
  count: number = 1
): Promise<void> {
  const picnic = await getPicnicClient();
  await picnic.addProductToShoppingCart(productId, count);
}

export async function removeFromCart(productId: string): Promise<void> {
  const picnic = await getPicnicClient();
  await picnic.removeProductFromShoppingCart(productId);
}

export async function getCart(): Promise<unknown> {
  const picnic = await getPicnicClient();
  return picnic.getShoppingCart();
}

export async function clearCart(): Promise<void> {
  const picnic = await getPicnicClient();
  await picnic.clearShoppingCart();
}

async function fetchPDP(productId: string): Promise<unknown> {
  const picnic = await getPicnicClient();
  try {
    return await picnic.getProductDetailsPage(productId);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("401")) {
      resetPicnicClient();
      const retryClient = await getPicnicClient();
      return retryClient.getProductDetailsPage(productId);
    }
    throw err;
  }
}

export async function getProductBundles(productId: string): Promise<import("./types").BundleOption[]> {
  const { extractBundlesFromPDP } = await import("./pdp-parser");
  const pdp = await fetchPDP(productId);
  return extractBundlesFromPDP(pdp);
}

export async function getProductPromoLabel(productId: string): Promise<string | null> {
  const { extractPromoLabel } = await import("./pdp-parser");
  const pdp = await fetchPDP(productId);
  return extractPromoLabel(pdp, productId);
}

export async function getPromoProductsFromPDP(productId: string): Promise<{
  selfLabel: string | null;
  promoProducts: import("./types").PromoProduct[];
}> {
  const { extractPromoLabel, extractPromoProducts } = await import("./pdp-parser");
  const pdp = await fetchPDP(productId);
  return {
    selfLabel: extractPromoLabel(pdp, productId),
    promoProducts: extractPromoProducts(pdp),
  };
}
