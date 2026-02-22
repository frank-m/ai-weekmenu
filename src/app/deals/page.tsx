"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";

const PRODUCT_IMAGE_BASE =
  "https://storefront-prod.nl.picnicinternational.com/static/images";

interface DealItem {
  picnic_id: string;
  name: string;
  image_id: string;
  price: number;
  promo_label: string;
  fetched_at: number;
}

interface DealsResponse {
  items: DealItem[];
  lastRefreshed: number | null;
  knownPromotionCount: number;
}

function formatRelativeTime(unixTs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function DealsPage() {
  const [items, setItems] = useState<DealItem[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [knownPromotionCount, setKnownPromotionCount] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const loadDeals = useCallback(async () => {
    try {
      const [dealsRes, settingsRes] = await Promise.all([
        fetch("/api/picnic/deals"),
        fetch("/api/settings"),
      ]);
      const data: DealsResponse = await dealsRes.json();
      const settings = await settingsRes.json();
      setEnabled(settings?.deals_enabled === "true");
      setItems(Array.isArray(data.items) ? data.items : []);
      setLastRefreshed(data.lastRefreshed ?? null);
      setKnownPromotionCount(data.knownPromotionCount ?? 0);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const res = await fetch("/api/picnic/deals/refresh", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setRefreshResult(`Error: ${data.error}`);
      } else {
        const msg = `Found ${data.items_found} deals across ${data.promotions_checked} promotion groups (${data.calls_made} API calls).`;
        setRefreshResult(
          data.capped
            ? `${msg} Call limit reached — refresh again to check remaining promotions.`
            : msg
        );
        await loadDeals();
      }
    } catch {
      setRefreshResult("Refresh failed. Check your Picnic connection.");
    }
    setRefreshing(false);
  };

  const handleAddToCart = async (item: DealItem) => {
    setAddingId(item.picnic_id);
    try {
      await fetch("/api/picnic/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: item.picnic_id }),
      });
      setAddedIds((prev) => new Set(prev).add(item.picnic_id));
    } catch {
      // ignore
    }
    setAddingId(null);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">
          &larr; Home
        </Link>
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg font-medium mb-2">Deals is an experimental feature</p>
          <p className="text-sm">
            Enable it in <strong>Settings → Experimental Features</strong> to use it.
          </p>
        </div>
      </div>
    );
  }

  // Group by promo_label
  const groups = new Map<string, DealItem[]>();
  for (const item of items) {
    const group = groups.get(item.promo_label) ?? [];
    group.push(item);
    groups.set(item.promo_label, group);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
        >
          &larr; Home
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Deals</h1>
            <p className="text-sm text-gray-500 mt-1">
              Picnic products currently on sale, used during meal planning.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Button onClick={handleRefresh} disabled={refreshing} size="md">
              {refreshing ? "Refreshing..." : "Refresh Deals"}
            </Button>
            {lastRefreshed && (
              <span className="text-xs text-gray-400">
                Last refreshed {formatRelativeTime(lastRefreshed)}
              </span>
            )}
            {knownPromotionCount > 0 && (
              <span className="text-xs text-gray-400">
                {knownPromotionCount} known promotion group
                {knownPromotionCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Refresh result message */}
      {refreshResult && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          {refreshResult}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg font-medium mb-2">No deals cached yet</p>
          <p className="text-sm mb-6">
            Click &ldquo;Refresh Deals&rdquo; to scan your frequent items for active
            promotions.
          </p>
          <p className="text-xs text-gray-400">
            Deals are discovered from your Frequent Items and grow over time as
            more promotion groups are found.
          </p>
        </div>
      )}

      {/* Deal groups */}
      {Array.from(groups.entries()).map(([label, groupItems]) => (
        <div key={label} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Badge color="yellow">{label}</Badge>
            <span className="text-xs text-gray-400">
              {groupItems.length} product{groupItems.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {groupItems.map((item) => {
              const added = addedIds.has(item.picnic_id);
              return (
                <div
                  key={item.picnic_id}
                  className="flex items-center gap-3 p-3 sm:p-4"
                >
                  {item.image_id && (
                    <img
                      src={`${PRODUCT_IMAGE_BASE}/${item.image_id}/small.png`}
                      alt={item.name}
                      className="w-12 h-12 object-contain shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {item.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      &euro;{(item.price / 100).toFixed(2)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleAddToCart(item)}
                    disabled={addingId === item.picnic_id || added}
                  >
                    {added
                      ? "Added"
                      : addingId === item.picnic_id
                      ? "Adding..."
                      : "+ Cart"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
