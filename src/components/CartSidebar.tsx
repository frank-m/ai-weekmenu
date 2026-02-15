"use client";

import { useEffect, useState, useCallback } from "react";
import Spinner from "./ui/Spinner";

interface CartSidebarProps {
  refreshTrigger: number;
  onCartUpdate?: () => void;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image_id?: string;
  unit_quantity?: string;
}

const PICNIC_IMAGE_BASE =
  "https://storefront-prod.nl.picnicinternational.com/static/images";

export default function CartSidebar({ refreshTrigger, onCartUpdate }: CartSidebarProps) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const loadCart = useCallback(async () => {
    try {
      const res = await fetch("/api/picnic/cart");
      if (!res.ok) {
        setError("Could not load cart");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setItems(data.items || []);
      setError("");
    } catch {
      setError("Could not connect to Picnic");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCart();
  }, [loadCart, refreshTrigger]);

  const handleAdd = async (productId: string) => {
    setBusyItem(productId);
    try {
      await fetch("/api/picnic/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId }),
      });
      await loadCart();
      onCartUpdate?.();
    } finally {
      setBusyItem(null);
    }
  };

  const handleRemove = async (productId: string) => {
    setBusyItem(productId);
    try {
      await fetch(`/api/picnic/cart/${productId}`, { method: "DELETE" });
      await loadCart();
      onCartUpdate?.();
    } finally {
      setBusyItem(null);
    }
  };

  const handleClearCart = async () => {
    if (!confirm("Clear entire Picnic cart?")) return;
    setClearing(true);
    try {
      await fetch("/api/picnic/cart", { method: "DELETE" });
      await loadCart();
      onCartUpdate?.();
    } finally {
      setClearing(false);
    }
  };

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
        </svg>
        Picnic Cart
      </h3>

      {loading ? (
        <Spinner size="sm" />
      ) : error ? (
        <p className="text-xs text-gray-400">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">Cart is empty</p>
      ) : (
        <>
          <div className="space-y-2 max-h-60 overflow-y-auto mb-3">
            {items.map((item, i) => {
              const busy = busyItem === item.id;
              return (
                <div key={`${item.id}-${i}`} className="flex items-center gap-2 text-sm">
                  {item.image_id && (
                    <img
                      src={`${PICNIC_IMAGE_BASE}/${item.image_id}/small.png`}
                      alt=""
                      className="w-8 h-8 object-contain rounded shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="block truncate text-gray-700">
                      {item.name}
                    </span>
                    {item.unit_quantity && (
                      <span className="block text-xs text-gray-400">{item.unit_quantity}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleRemove(item.id)}
                      disabled={busy}
                      className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-40"
                      title="Remove one"
                    >
                      &minus;
                    </button>
                    <span className="w-5 text-center text-xs font-medium">{item.quantity}</span>
                    <button
                      onClick={() => handleAdd(item.id)}
                      disabled={busy}
                      className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-40"
                      title="Add one"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-gray-500 shrink-0 w-14 text-right">
                    &euro;{((item.price * item.quantity) / 100).toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="pt-2 border-t flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span className="text-green-700">
              &euro;{(total / 100).toFixed(2)}
            </span>
          </div>
          <button
            onClick={handleClearCart}
            disabled={clearing}
            className="mt-2 w-full text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            {clearing ? "Clearing..." : "Clear Cart"}
          </button>
        </>
      )}
    </div>
  );
}
