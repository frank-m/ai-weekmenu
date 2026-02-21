import { BundleOption } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findBlockById(node: any, prefix: string): any | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = findBlockById(item, prefix);
      if (r) return r;
    }
    return null;
  }
  if (typeof node.id === "string" && node.id.startsWith(prefix)) {
    return node;
  }
  for (const val of Object.values(node)) {
    if (val && typeof val === "object") {
      const r = findBlockById(val, prefix);
      if (r) return r;
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findBundlesBlock(node: any): any | null {
  return findBlockById(node, "product-page-bundles");
}

function cleanMarkdown(md: string): string {
  // Remove PML color codes like #(#333333)
  return md.replace(/#\([^)]+\)/g, "").trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectFromPml(node: any): {
  markdowns: string[];
  price: number | null;
  accessibilityLabel: string | null;
} {
  const result = { markdowns: [] as string[], price: null as number | null, accessibilityLabel: null as string | null };
  if (!node || typeof node !== "object") return result;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = collectFromPml(item);
      result.markdowns.push(...r.markdowns);
      if (r.price !== null) result.price = r.price;
      if (r.accessibilityLabel) result.accessibilityLabel = r.accessibilityLabel;
    }
    return result;
  }
  if (node.type === "RICH_TEXT" && typeof node.markdown === "string") {
    result.markdowns.push(cleanMarkdown(node.markdown));
  }
  if (node.type === "PRICE" && typeof node.price === "number") {
    result.price = node.price;
  }
  if (typeof node.accessibilityLabel === "string" && node.accessibilityLabel.includes("€")) {
    result.accessibilityLabel = node.accessibilityLabel;
  }
  for (const val of Object.values(node)) {
    if (val && typeof val === "object") {
      const r = collectFromPml(val);
      result.markdowns.push(...r.markdowns);
      if (r.price !== null) result.price = r.price;
      if (r.accessibilityLabel) result.accessibilityLabel = r.accessibilityLabel;
    }
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractBundlesFromPDP(pdpResponse: any): BundleOption[] {
  if (!pdpResponse) return [];

  const bundlesBlock = findBundlesBlock(pdpResponse);
  if (!bundlesBlock) return [];

  const children = bundlesBlock.children || [];
  const bundles: BundleOption[] = [];

  for (const child of children) {
    try {
      // Each child is a STATE_BOUNDARY with child.content.sellingUnit
      const su = child?.child?.content?.sellingUnit;
      if (!su?.id) continue;

      const pmlData = collectFromPml(child);

      // Find unit quantity (e.g. "1,5 liter"), unit price (e.g. "€1.93/l"),
      // multiplier (e.g. "4", "6"), and promo text (contains "Bespaar" or "korting")
      let volume = "";
      let unitPrice = "";
      let multiplier = "";
      let promoLabel: string | undefined;

      for (const md of pmlData.markdowns) {
        if (/bespaar|korting/i.test(md)) {
          promoLabel = md;
        } else if (/\d[\d,.]*\s*(?:liter|l|ml|gram|gr|g|kg|stuks?|st)\b/i.test(md)) {
          volume = md;
        } else if (/€[\d.,]+\/\w+/.test(md)) {
          unitPrice = md;
        } else if (/^\d+$/.test(md)) {
          multiplier = md;
        }
      }

      // Build display: "1,5 liter", "4x • €1.86/l", "6x • €1.79/l"
      let displayQty: string;
      if (multiplier) {
        displayQty = unitPrice ? `${multiplier}x \u00B7 ${unitPrice}` : `${multiplier}x`;
      } else {
        const parts = [volume, unitPrice].filter(Boolean);
        displayQty = parts.join(" \u00B7 ");
      }

      bundles.push({
        id: su.id,
        name: su.name || "",
        image_id: su.image_id || "",
        price: pmlData.price ?? 0,
        unit_quantity: displayQty,
        promo_label: promoLabel,
      });
    } catch {
      // Skip malformed entries
    }
  }

  return bundles;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractPromoLabel(pdpResponse: any, sellingUnitId: string): string | null {
  if (!pdpResponse) return null;
  const labelsBlock = findBlockById(pdpResponse, `product-page-labels-${sellingUnitId}`);
  if (!labelsBlock) return null;
  const data = collectFromPml(labelsBlock);
  const promoTexts = data.markdowns.filter((t) => t.length > 0);
  return promoTexts.length > 0 ? promoTexts[0] : null;
}
