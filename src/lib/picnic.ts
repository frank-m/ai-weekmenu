// eslint-disable-next-line @typescript-eslint/no-require-imports
const PicnicClient = require("picnic-api");
import { getSetting } from "./db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;
let authenticated = false;

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
  console.log("[picnic] getPicnicClient called, authenticated:", authenticated, "hasClient:", !!client);
  console.log("[picnic] credentials present — username:", !!creds.username, "password:", !!creds.password, "country:", creds.countryCode);

  if (!creds.username || !creds.password) {
    throw new Error(
      "Picnic credentials not configured. Set them in Settings or .env.local"
    );
  }

  if (!client || !authenticated) {
    console.log("[picnic] creating new PicnicClient and logging in...");
    client = new PicnicClient({
      countryCode: creds.countryCode,
    });
    try {
      await client.login(creds.username, creds.password);
      authenticated = true;
      console.log("[picnic] login successful");
    } catch (err) {
      console.error("[picnic] login failed:", err);
      client = null;
      authenticated = false;
      throw err;
    }
  }

  return client;
}

export function resetPicnicClient(): void {
  client = null;
  authenticated = false;
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

export async function rawSearch(query: string, limit: number = 5): Promise<RawSearchResult[]> {
  console.log("[picnic] rawSearch called with query:", query);
  const picnic = await getPicnicClient();
  const results = await picnic.search(query);
  const items = Array.isArray(results) ? results : [];
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
  const picnic = await getPicnicClient();
  const results = await picnic.search(query);
  const items = Array.isArray(results) ? results : [];
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

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
