import PicnicClient from "picnic-api";
import { getSetting, setSetting } from "./db";
import type { BundleOption, PromoProduct } from "./types";

type Client = InstanceType<typeof PicnicClient>;
type ProductTile = PicnicClient.Types.catalog.ProductTile;
type CountryCode = PicnicClient.Types.common.CountryCode;

let client: Client | null = null;
let authenticated = false;
let needsTwoFactor = false;
let loginInFlight: Promise<Client> | null = null;

/** HTTP status of a Picnic API error, or null for anything else. */
function picnicStatus(err: unknown): number | null {
  if (PicnicClient.isPicnicApiError(err)) return err.status;
  return null;
}

/**
 * Whether Picnic rejected the session itself (expired key, or 2FA not completed
 * for this key) rather than the request. Picnic answers 401 for an expired key
 * but 403 "User is not authenticated" for a key that lacks 2FA verification —
 * while plain 403s are rate limiting. Both session cases need a fresh login,
 * which then surfaces the 2FA flow if Picnic requires it.
 */
function isSessionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Match on the message as well as the status: the status Picnic uses for
  // this has varied, and the message is what identifies it
  if (/not authenticated|unauthori[sz]ed|invalid (auth|token|session)/i.test(err.message)) return true;
  if (!PicnicClient.isPicnicApiError(err)) return false;
  if (err.status === 401) return true;
  return err.status === 403 && /auth/i.test(err.code ?? "");
}

function describePicnicError(err: unknown): string {
  if (!PicnicClient.isPicnicApiError(err)) return err instanceof Error ? err.message : String(err);
  return `${err.status} code=${err.code ?? "-"} message=${err.message} body=${err.body.slice(0, 300)}`;
}

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
    countryCode: (getSetting("picnic_country_code") ||
      process.env.PICNIC_COUNTRY_CODE ||
      "NL") as CountryCode,
  };
}

export async function getPicnicClient(): Promise<Client> {
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

    // Deduplicate concurrent logins — two parallel requests would otherwise
    // both call login(), and Picnic may invalidate the first session.
    if (!loginInFlight) {
      loginInFlight = doLogin(creds).finally(() => {
        loginInFlight = null;
      });
    }
    return loginInFlight;
  }

  return client;
}

async function doLogin(creds: ReturnType<typeof getCredentials>): Promise<Client> {
  console.log("[picnic] creating new PicnicClient and logging in...");
  const fresh = new PicnicClient({ countryCode: creds.countryCode });
  client = fresh;
  try {
    const loginResult = await fresh.auth.login(creds.username, creds.password);
    if (loginResult.secondFactorAuthenticationRequired) {
      console.log("[picnic] login requires 2FA");
      needsTwoFactor = true;
      authenticated = false;
      throw new PicnicTwoFactorRequiredError();
    }
    authenticated = true;
    needsTwoFactor = false;
    // Persist auth key so it survives module reloads
    setSetting("picnic_auth_key", fresh.authKey ?? "");
    console.log("[picnic] login successful");
    return fresh;
  } catch (err) {
    if (err instanceof PicnicTwoFactorRequiredError) throw err;
    console.error("[picnic] login failed:", err);
    client = null;
    authenticated = false;
    needsTwoFactor = false;
    throw err;
  }
}

/**
 * Runs a Picnic call, resetting the client and retrying once on a 401
 * (expired/invalid session — common when a stale stored auth key was restored).
 */
async function withAuthRetry<T>(fn: (picnic: Client) => Promise<T>): Promise<T> {
  const picnic = await getPicnicClient();
  try {
    return await fn(picnic);
  } catch (err: unknown) {
    console.warn("[picnic] call failed:", describePicnicError(err));
    if (isSessionError(err)) {
      console.warn("[picnic] session rejected — resetting and logging in again:", describePicnicError(err));
      resetPicnicClient();
      const retryClient = await getPicnicClient();
      return fn(retryClient);
    }
    throw err;
  }
}

export interface PicnicConnectionState {
  authenticated: boolean;
  needsTwoFactor: boolean;
  hasClient: boolean;
  error?: string;
}

/**
 * Verifies the Picnic session actually works by making a cheap authenticated
 * call. A restored auth key is trusted optimistically elsewhere; this is the
 * one place that proves it. Never throws — returns state for the UI.
 */
export async function checkPicnicConnection(): Promise<PicnicConnectionState> {
  try {
    await withAuthRetry((picnic) => picnic.user.getUser());
    return { ...getPicnicAuthState() };
  } catch (err) {
    if (err instanceof PicnicTwoFactorRequiredError) {
      return { ...getPicnicAuthState() };
    }
    console.error("[picnic] connection check failed:", describePicnicError(err));
    return {
      ...getPicnicAuthState(),
      authenticated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function resetPicnicClient(): void {
  client = null;
  authenticated = false;
  needsTwoFactor = false;
  try { setSetting("picnic_auth_key", ""); } catch { /* ignore — db may not be ready */ }
}

/**
 * Headers for the 2FA calls, taken from the library so the app version
 * (`x-picnic-agent`) stays current — Picnic rejects outdated agents.
 */
function twoFactorHeaders(picnic: Client): Record<string, string> {
  return { ...picnic.baseHeaders, ...picnic.picnicHeaders };
}

/** Logs in (if needed) and generates a 2FA SMS code. */
export async function generatePicnicTwoFactor(): Promise<void> {
  const creds = getCredentials();
  if (!creds.username || !creds.password) {
    throw new Error("Picnic credentials not configured.");
  }

  // Ensure we have a pre-2FA client
  if (!client || (!authenticated && !needsTwoFactor)) {
    const fresh = new PicnicClient({ countryCode: creds.countryCode });
    client = fresh;
    const loginResult = await fresh.auth.login(creds.username, creds.password);
    if (!loginResult.secondFactorAuthenticationRequired) {
      // Already authenticated without 2FA
      authenticated = true;
      needsTwoFactor = false;
      setSetting("picnic_auth_key", fresh.authKey ?? "");
      return;
    }
    needsTwoFactor = true;
    authenticated = false;
  }

  // Direct fetch — /user/2fa/generate can answer 200 with an empty body, which
  // the library's JSON body parsing would choke on. We skip body parsing.
  const generateResponse = await fetch(`${client.url}/user/2fa/generate`, {
    method: "POST",
    headers: twoFactorHeaders(client),
    body: JSON.stringify({ channel: "SMS" }),
  });
  if (!generateResponse.ok) {
    const text = await generateResponse.text().catch(() => "");
    throw new Error(
      `Failed to send 2FA code: ${generateResponse.status} ${generateResponse.statusText}${text ? ` — ${text}` : ""}`
    );
  }
  console.log("[picnic] 2FA SMS code generated");
}

/** Verifies a 2FA code and marks the session as authenticated. */
export async function verifyPicnicTwoFactor(code: string): Promise<void> {
  if (!client) {
    throw new Error("No Picnic session. Generate a 2FA code first.");
  }
  // Direct fetch rather than client.auth.verify2FACode(): the library throws
  // when Picnic doesn't send a new x-picnic-auth header, but the old key is
  // still valid then, so we keep it instead of failing the verification.
  const verifyResponse = await fetch(`${client.url}/user/2fa/verify`, {
    method: "POST",
    headers: twoFactorHeaders(client),
    body: JSON.stringify({ otp: code }),
  });
  if (!verifyResponse.ok) {
    const text = await verifyResponse.text().catch(() => "");
    throw new Error(
      `Verification failed: ${verifyResponse.status} ${verifyResponse.statusText}${text ? ` — ${text}` : ""}`
    );
  }
  // Picnic issues an updated token after verification (JWT gains the 2FA claim)
  const newAuthKey = verifyResponse.headers.get("x-picnic-auth");
  if (newAuthKey) {
    client.authKey = newAuthKey;
    console.log("[picnic] 2FA verify returned updated auth key");
  }
  authenticated = true;
  needsTwoFactor = false;
  // Persist auth key so the session survives hot-reloads and worker restarts
  setSetting("picnic_auth_key", client.authKey ?? "");
  console.log("[picnic] 2FA verified, session is now active");
}

export interface MatchedProduct {
  picnic_id: string;
  name: string;
  image_id: string;
  price: number;
  unit_quantity: string;
  quantity: number;
  /** Set by matchIngredientsWithFallback when the product came from a plain first-result search */
  auto_matched?: boolean;
}

export interface RawSearchResult {
  id: string;
  name: string;
  price: number;
  image_id: string;
  unit_quantity: string;
  /** Price per kg / litre / piece as Picnic shows it, e.g. "€1,26/l" — helps pick package sizes */
  unit_price: string | null;
  /** Active promotion label on the tile, e.g. "1+1 gratis" */
  promo_label: string | null;
}

export interface CartItem {
  id: string;
  name: string;
  /** Price per unit in cents */
  price: number;
  quantity: number;
  image_id: string;
  unit_quantity: string;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tilePromoLabel(tile: ProductTile): string | null {
  const promo = tile.labels.find((l) => l.type === "PROMO" && l.text) ?? null;
  return promo?.text ?? null;
}

/**
 * Searches the way the Picnic app does. Results come in sections — typically
 * "Opnieuw bestellen" (products bought before) first, then product groups — so
 * flattening them in order naturally prefers what the household already buys.
 */
async function fetchSearch(query: string): Promise<ProductTile[]> {
  const run = async (picnic: Client) => {
    const results = await picnic.catalog.getSearchResults(query);
    const seen = new Set<string>();
    const tiles: ProductTile[] = [];
    for (const section of results.products?.sections ?? []) {
      for (const tile of section.products) {
        if (seen.has(tile.id) || tile.isUnavailable) continue;
        seen.add(tile.id);
        tiles.push(tile);
      }
    }
    return tiles;
  };
  try {
    return await withAuthRetry(run);
  } catch (err: unknown) {
    // 403 = rate limit → wait 5s and retry once (session 403s were already
    // handled by withAuthRetry)
    if (picnicStatus(err) === 403 && !isSessionError(err)) {
      console.warn("[picnic] 403 rate limit, waiting 5s before retry...", describePicnicError(err));
      await delay(5000);
      return run(await getPicnicClient());
    }
    throw err;
  }
}

function tileToRaw(tile: ProductTile): RawSearchResult {
  return {
    id: tile.id,
    name: tile.brand ? `${tile.brand} ${tile.name}` : tile.name,
    price: tile.displayPrice,
    image_id: tile.imageId ?? "",
    unit_quantity: tile.unitQuantity,
    unit_price: tile.unitPrice,
    promo_label: tilePromoLabel(tile),
  };
}

export async function rawSearch(query: string, limit: number = 5): Promise<RawSearchResult[]> {
  console.log("[picnic] rawSearch called with query:", query);
  const tiles = await fetchSearch(query);
  console.log("[picnic] rawSearch results count:", tiles.length);
  const maxResults = Math.min(Math.max(limit, 1), 20);
  return tiles.slice(0, maxResults).map(tileToRaw);
}

export async function searchProduct(query: string): Promise<MatchedProduct | null> {
  console.log("[picnic] searchProduct called with query:", query);
  const tiles = await fetchSearch(query);
  console.log("[picnic] results count:", tiles.length);
  if (tiles.length === 0) {
    console.log("[picnic] no products found for:", query);
    return null;
  }
  const r = tileToRaw(tiles[0]);
  console.log("[picnic] matched product:", r.name, "id:", r.id, "price:", r.price);
  return {
    picnic_id: r.id,
    name: r.name,
    image_id: r.image_id,
    price: r.price,
    unit_quantity: r.unit_quantity,
    quantity: 1,
  };
}

export async function addToCart(productId: string, count: number = 1): Promise<void> {
  await withAuthRetry((picnic) => picnic.cart.addProductToCart(productId, count));
}

export async function removeFromCart(productId: string, count: number = 1): Promise<void> {
  await withAuthRetry((picnic) => picnic.cart.removeProductFromCart(productId, count));
}

/** The Picnic cart as a flat list of products with per-unit prices. */
export async function getCart(): Promise<CartItem[]> {
  const cart = await withAuthRetry((picnic) => picnic.cart.getCart());
  // A product can be on several lines (e.g. once loose, once for a recipe) — merge them
  const byProduct = new Map<string, CartItem>();
  for (const line of cart.items) {
    const quantity = Math.max(line.quantity, 1);
    const existing = byProduct.get(line.productId);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }
    byProduct.set(line.productId, {
      id: line.productId,
      name: line.name,
      // displayPrice is the line total after discounts
      price: Math.round(line.displayPrice / quantity),
      quantity,
      image_id: line.imageId ?? "",
      unit_quantity: line.unitQuantity,
    });
  }
  return Array.from(byProduct.values());
}

export async function clearCart(): Promise<void> {
  await withAuthRetry((picnic) => picnic.cart.clearCart());
}

function formatEuro(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * Bundle offers of a product. Picnic now models these as price tiers on the
 * product itself ("1 stuk €2,75 · vanaf 2 €2,69"), so each option is the same
 * product bought at a minimum quantity.
 */
export async function getProductBundles(productId: string): Promise<BundleOption[]> {
  const product = await withAuthRetry((picnic) => picnic.catalog.getProduct(productId));
  const tiers = [...(product.priceRanges ?? [])].sort((a, b) => a.from_quantity - b.from_quantity);
  if (tiers.length < 2) return [];
  const basePrice = tiers[0].price;
  const name = product.brand ? `${product.brand} ${product.name}` : product.name;
  return tiers.map((tier) => {
    const saving = (basePrice - tier.price) * tier.from_quantity;
    return {
      id: product.id,
      name,
      image_id: product.imageIds[0] ?? "",
      price: tier.price,
      unit_quantity:
        tier.from_quantity > 1
          ? `${tier.from_quantity}x · ${product.unitQuantity}`
          : product.unitQuantity,
      min_quantity: tier.from_quantity,
      promo_label: saving > 0 ? `Bespaar ${formatEuro(saving)}` : undefined,
    };
  });
}

export async function getProductPromoLabel(productId: string): Promise<string | null> {
  try {
    const product = await withAuthRetry((picnic) => picnic.catalog.getProduct(productId));
    return product.promotion?.label ?? null;
  } catch (err) {
    if (PicnicClient.isProductNotFoundError(err)) return null;
    throw err;
  }
}

export interface PromotionsOverview {
  /** Products shown directly on the promotions page */
  products: PromoProduct[];
  /** Promotions spanning several products; their products need a separate call */
  groups: { id: string; name: string; label: string }[];
}

/** Reads Picnic's promotions page ("Acties") — the source for the Deals feature. */
export async function getPromotionsOverview(): Promise<PromotionsOverview> {
  const promotions = await withAuthRetry((picnic) => picnic.catalog.getPromotions());
  const products = new Map<string, PromoProduct>();
  const groups = new Map<string, { id: string; name: string; label: string }>();
  for (const section of promotions.sections) {
    for (const tile of section.products) {
      const label = tilePromoLabel(tile);
      if (!label || products.has(tile.id)) continue;
      products.set(tile.id, {
        ...tileToPromoBase(tile),
        promotion_id: section.id,
        promo_label: label,
      });
    }
    for (const group of section.groups) {
      if (!groups.has(group.id)) {
        groups.set(group.id, { id: group.id, name: group.name, label: group.label ?? "" });
      }
    }
  }
  return { products: Array.from(products.values()), groups: Array.from(groups.values()) };
}

/** Products in a multi-product promotion, e.g. "Korting op Alpro". */
export async function getPromotionGroupProducts(group: {
  id: string;
  label: string;
}): Promise<PromoProduct[]> {
  const result = await withAuthRetry((picnic) => picnic.catalog.getPromotionGroup(group.id));
  return result.products.map((tile) => ({
    ...tileToPromoBase(tile),
    promotion_id: group.id,
    promo_label: tilePromoLabel(tile) ?? group.label,
  }));
}

function tileToPromoBase(tile: ProductTile) {
  return {
    picnic_id: tile.id,
    name: tile.brand ? `${tile.brand} ${tile.name}` : tile.name,
    image_id: tile.imageId ?? "",
    price: tile.displayPrice,
  };
}

// ── Live deals with a short in-memory cache ─────────────────────────────────
// Deals are read live from Picnic (no DB cache); this only avoids calling Picnic
// on every deals page view / week generation. Kept on globalThis because Next
// bundles each route separately.

const DEALS_TTL_MS = 15 * 60 * 1000;

interface Cached<T> {
  value: T;
  at: number;
}

const dealsCache = ((globalThis as typeof globalThis & {
  __picnicDeals?: {
    overview: Cached<PromotionsOverview> | null;
    overviewInFlight: Promise<Cached<PromotionsOverview>> | null;
    groups: Map<string, Cached<PromoProduct[]>>;
  };
}).__picnicDeals ??= { overview: null, overviewInFlight: null, groups: new Map() });

export interface LiveDeals extends PromotionsOverview {
  /** When this data was fetched from Picnic (ms since epoch) */
  fetchedAt: number;
}

/** Current Picnic promotions; `fresh` bypasses the 15-minute cache. */
export async function getDeals({ fresh = false } = {}): Promise<LiveDeals> {
  const cached = dealsCache.overview;
  if (!fresh && cached && Date.now() - cached.at < DEALS_TTL_MS) {
    return { ...cached.value, fetchedAt: cached.at };
  }
  // Concurrent callers (deals page + generation) share one request
  dealsCache.overviewInFlight ??= getPromotionsOverview()
    .then((value) => {
      const entry = { value, at: Date.now() };
      dealsCache.overview = entry;
      // Group contents are part of the same snapshot — start them over too
      dealsCache.groups.clear();
      return entry;
    })
    .finally(() => {
      dealsCache.overviewInFlight = null;
    });
  const entry = await dealsCache.overviewInFlight;
  return { ...entry.value, fetchedAt: entry.at };
}

/** Products of one promotion group, fetched when the user opens it. */
export async function getDealGroup(groupId: string): Promise<PromoProduct[] | null> {
  const cached = dealsCache.groups.get(groupId);
  if (cached && Date.now() - cached.at < DEALS_TTL_MS) return cached.value;
  const { groups } = await getDeals();
  const group = groups.find((g) => g.id === groupId);
  if (!group) return null;
  const products = await getPromotionGroupProducts(group);
  dealsCache.groups.set(groupId, { value: products, at: Date.now() });
  return products;
}
