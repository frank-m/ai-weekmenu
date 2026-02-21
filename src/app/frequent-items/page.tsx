"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { FrequentItem, BundleOption } from "@/lib/types";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import BundleModal from "@/components/BundleModal";

const PRODUCT_IMAGE_BASE =
  "https://storefront-prod.nl.picnicinternational.com/static/images";

const RESULTS_PER_PAGE = 5;

interface SearchResult {
  id: string;
  name: string;
  image_id: string;
  price: number;
  unit_quantity: string;
}

export default function FrequentItemsPage() {
  const [items, setItems] = useState<FrequentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [visibleCount, setVisibleCount] = useState(RESULTS_PER_PAGE);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [bundleModalItem, setBundleModalItem] = useState<FrequentItem | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/frequent-items");
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    setVisibleCount(RESULTS_PER_PAGE);
    try {
      const res = await fetch("/api/picnic/search/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery }),
      });
      const data = await res.json();
      if (Array.isArray(data.products)) {
        setSearchResults(data.products);
      }
    } catch {
      // ignore
    }
    setSearching(false);
  };

  const handleClearSearch = () => {
    setSearchResults([]);
    setSearchQuery("");
    setVisibleCount(RESULTS_PER_PAGE);
  };

  const handleAdd = async (product: SearchResult) => {
    setAddingId(product.id);
    try {
      await fetch("/api/frequent-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          picnic_id: product.id,
          name: product.name,
          image_id: product.image_id,
          price: product.price,
          unit_quantity: product.unit_quantity,
        }),
      });
      await loadItems();
    } catch {
      // ignore
    }
    setAddingId(null);
  };

  const handleUpdateQuantity = async (item: FrequentItem, delta: number) => {
    const newQty = item.quantity + delta;
    setUpdatingId(item.id);
    try {
      if (newQty < 1) {
        await fetch(`/api/frequent-items?id=${item.id}`, { method: "DELETE" });
      } else {
        await fetch("/api/frequent-items", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, quantity: newQty }),
        });
      }
      await loadItems();
    } catch {
      // ignore
    }
    setUpdatingId(null);
  };

  const handleRemove = async (id: number) => {
    setUpdatingId(id);
    try {
      await fetch(`/api/frequent-items?id=${id}`, { method: "DELETE" });
      await loadItems();
    } catch {
      // ignore
    }
    setUpdatingId(null);
  };

  const handleBundleSelect = async (bundle: BundleOption) => {
    if (!bundleModalItem) return;
    setUpdatingId(bundleModalItem.id);
    setBundleModalItem(null);
    try {
      await fetch("/api/frequent-items", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: bundleModalItem.id,
          picnic_id: bundle.id,
          name: bundle.name,
          image_id: bundle.image_id,
          price: bundle.price,
          unit_quantity: bundle.unit_quantity,
        }),
      });
      await loadItems();
    } catch {
      // ignore
    }
    setUpdatingId(null);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const visibleResults = searchResults.slice(0, visibleCount);
  const hasMore = visibleCount < searchResults.length;
  const existingPicnicIds = new Set(items.map((i) => i.picnic_id));

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
        >
          &larr; Home
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          Frequently Ordered Items
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Items you order regularly. These appear on every week page for quick
          ordering.
        </p>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <label className="text-sm font-medium text-gray-700 mb-2 block">
          Search Picnic to add items
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="e.g. brood, melk, appels..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <Button onClick={handleSearch} disabled={searching} size="md">
            {searching ? "Searching..." : "Search"}
          </Button>
        </div>

        {searchResults.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={handleClearSearch}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear results
              </button>
            </div>
            <div className="space-y-2">
              {visibleResults.map((product) => {
                const alreadyAdded = existingPicnicIds.has(product.id);
                return (
                  <div
                    key={product.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-gray-50"
                  >
                    {product.image_id && (
                      <img
                        src={`${PRODUCT_IMAGE_BASE}/${product.image_id}/small.png`}
                        alt={product.name}
                        className="w-10 h-10 object-contain"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {product.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {product.unit_quantity} &middot; &euro;
                        {(product.price / 100).toFixed(2)}
                      </div>
                    </div>
                    {alreadyAdded ? (
                      <span className="text-xs text-gray-400 px-3 py-1.5">
                        Already added
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleAdd(product)}
                        disabled={addingId === product.id}
                      >
                        {addingId === product.id ? "Adding..." : "Add"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            {hasMore && (
              <button
                onClick={() => setVisibleCount((n) => n + RESULTS_PER_PAGE)}
                className="mt-3 w-full text-sm text-green-600 hover:text-green-700 font-medium py-2"
              >
                Show more ({searchResults.length - visibleCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Current items */}
      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No frequent items yet. Search above to add some.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 p-4"
            >
              {item.image_id && (
                <img
                  src={`${PRODUCT_IMAGE_BASE}/${item.image_id}/small.png`}
                  alt={item.name}
                  className="w-12 h-12 object-contain"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {item.name}
                </div>
                <div className="text-xs text-gray-500">
                  {item.unit_quantity} &middot; &euro;
                  {(item.price / 100).toFixed(2)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleUpdateQuantity(item, -1)}
                  disabled={updatingId === item.id}
                  className="w-7 h-7 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center text-sm disabled:opacity-50"
                >
                  -
                </button>
                <span className="text-sm font-medium w-6 text-center">
                  {item.quantity}
                </span>
                <button
                  onClick={() => handleUpdateQuantity(item, 1)}
                  disabled={updatingId === item.id}
                  className="w-7 h-7 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center text-sm disabled:opacity-50"
                >
                  +
                </button>
              </div>
              <button
                onClick={() => setBundleModalItem(item)}
                disabled={updatingId === item.id}
                className="text-xs text-blue-500 hover:text-blue-700 px-1.5 py-1 disabled:opacity-50"
                title="View bundles"
              >
                Bundles
              </button>
              <button
                onClick={() => handleRemove(item.id)}
                disabled={updatingId === item.id}
                className="text-red-400 hover:text-red-600 p-1 disabled:opacity-50"
                title="Remove"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {bundleModalItem && (
        <BundleModal
          productId={bundleModalItem.picnic_id}
          productName={bundleModalItem.name}
          currentBundleId={bundleModalItem.picnic_id}
          onClose={() => setBundleModalItem(null)}
          onSelect={handleBundleSelect}
        />
      )}
    </div>
  );
}
