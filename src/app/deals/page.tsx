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
}

interface DealGroup {
  id: string;
  name: string;
  label: string;
}

interface DealsResponse {
  items?: DealItem[];
  groups?: DealGroup[];
  fetched_at?: number;
  error?: string;
}

/** Products of an expanded promotion group, loaded on demand */
type GroupState = { loading: boolean; items: DealItem[]; error?: string };

function formatRelativeTime(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function DealsPage() {
  const [items, setItems] = useState<DealItem[]>([]);
  const [dealGroups, setDealGroups] = useState<DealGroup[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, GroupState>>({});
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState("");

  const loadDeals = useCallback(async (fresh = false) => {
    setLoadError(null);
    try {
      const settings = await fetch("/api/settings").then((r) => r.json());
      const isEnabled = settings?.deals_enabled === "true";
      setEnabled(isEnabled);
      if (!isEnabled) return;

      const res = await fetch(`/api/picnic/deals${fresh ? "?fresh=1" : ""}`);
      const data: DealsResponse = await res.json();
      if (!res.ok || data.error) {
        if (data.error === "picnic_2fa_required") {
          window.dispatchEvent(new CustomEvent("picnic:2fa-required"));
          setLoadError("Picnic needs two-factor verification — Settings will open.");
        } else {
          setLoadError("Could not load deals from Picnic. Check your Picnic connection.");
        }
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setDealGroups(Array.isArray(data.groups) ? data.groups : []);
      setFetchedAt(data.fetched_at ?? null);
      // Group contents belong to the previous snapshot
      if (fresh) setOpenGroups({});
    } catch {
      setLoadError("Could not load deals from Picnic. Check your Picnic connection.");
    }
  }, []);

  useEffect(() => {
    loadDeals().finally(() => setLoading(false));
  }, [loadDeals]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDeals(true);
    setRefreshing(false);
  };

  const toggleGroup = async (group: DealGroup) => {
    if (openGroups[group.id]) {
      setOpenGroups(({ [group.id]: _closed, ...rest }) => rest);
      return;
    }
    setOpenGroups((prev) => ({ ...prev, [group.id]: { loading: true, items: [] } }));
    let next: GroupState;
    try {
      const res = await fetch(`/api/picnic/deals/groups/${encodeURIComponent(group.id)}`);
      const data = await res.json();
      if (data.error === "picnic_2fa_required") {
        window.dispatchEvent(new CustomEvent("picnic:2fa-required"));
      }
      next = res.ok
        ? { loading: false, items: Array.isArray(data.items) ? data.items : [] }
        : { loading: false, items: [], error: data.error === "picnic_2fa_required" ? "Picnic needs two-factor verification." : data.error || "Could not load products" };
    } catch {
      next = { loading: false, items: [], error: "Could not load products" };
    }
    // Ignore if the user collapsed it meanwhile
    setOpenGroups((prev) => (prev[group.id] ? { ...prev, [group.id]: next } : prev));
  };

  const handleAddToCart = async (item: DealItem) => {
    setAddingId(item.picnic_id);
    setAddError("");
    try {
      const res = await fetch("/api/picnic/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: item.picnic_id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "picnic_2fa_required") {
          window.dispatchEvent(new CustomEvent("picnic:2fa-required"));
          setAddError("Picnic needs two-factor verification.");
        } else {
          setAddError(`Could not add "${item.name}" to the cart.`);
        }
      } else {
        setAddedIds((prev) => new Set(prev).add(item.picnic_id));
      }
    } catch {
      setAddError(`Could not add "${item.name}" to the cart.`);
    }
    setAddingId(null);
  };

  const renderDealRow = (item: DealItem, showLabel = false) => {
    const added = addedIds.has(item.picnic_id);
    return (
      <div key={item.picnic_id} className="flex items-center gap-3 p-3 sm:p-4">
        {item.image_id && (
          <img
            src={`${PRODUCT_IMAGE_BASE}/${item.image_id}/small.png`}
            alt={item.name}
            className="w-12 h-12 object-contain shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">{item.name}</div>
          <div className="text-xs text-gray-500">
            &euro;{(item.price / 100).toFixed(2)}
            {showLabel && item.promo_label && <span className="ml-2 text-orange-600">{item.promo_label}</span>}
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => handleAddToCart(item)}
          disabled={addingId === item.picnic_id || added}
        >
          {added ? "Added" : addingId === item.picnic_id ? "Adding..." : "+ Cart"}
        </Button>
      </div>
    );
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
              Picnic products currently on sale, read live from Picnic&apos;s promotions page and used during meal planning.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Button onClick={handleRefresh} disabled={refreshing} size="md">
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
            {fetchedAt && (
              <span className="text-xs text-gray-400">
                Updated {formatRelativeTime(fetchedAt)}
              </span>
            )}
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 p-3 rounded-lg text-sm border bg-red-50 border-red-200 text-red-800">
          {loadError}
        </div>
      )}

      {addError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {addError}
        </div>
      )}

      {/* Empty state */}
      {!loadError && items.length === 0 && dealGroups.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg font-medium mb-2">No deals right now</p>
          <p className="text-sm">Picnic&apos;s promotions page is empty. Try again later.</p>
        </div>
      )}

      {/* Promotions on several products — products load when opened */}
      {dealGroups.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Promotions on several products ({dealGroups.length})
          </h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {dealGroups.map((group) => {
              const state = openGroups[group.id];
              return (
                <div key={group.id}>
                  <button
                    onClick={() => toggleGroup(group)}
                    aria-expanded={!!state}
                    className="w-full flex items-center gap-3 p-3 sm:p-4 text-left hover:bg-gray-50"
                  >
                    <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">
                      {group.name}
                    </span>
                    {group.label && <Badge color="yellow">{group.label}</Badge>}
                    <span className="text-gray-400 text-xs shrink-0">{state ? "▲" : "▼"}</span>
                  </button>
                  {state && (
                    <div className="px-3 pb-3 sm:px-4">
                      {state.loading && (
                        <div className="flex justify-center py-4">
                          <Spinner />
                        </div>
                      )}
                      {state.error && <p className="text-sm text-red-600 py-2">{state.error}</p>}
                      {!state.loading && !state.error && state.items.length === 0 && (
                        <p className="text-sm text-gray-500 py-2">No products found.</p>
                      )}
                      {state.items.length > 0 && (
                        <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
                          {state.items.map((item) => renderDealRow(item, true))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
            {groupItems.map((item) => renderDealRow(item))}
          </div>
        </div>
      ))}
    </div>
  );
}
