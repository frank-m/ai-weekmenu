"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Week, LeftoverItem, FrequentItem, BundleOption } from "@/lib/types";
import RecipeCard from "@/components/RecipeCard";
import CartSidebar from "@/components/CartSidebar";
import Spinner from "@/components/ui/Spinner";
import Badge from "@/components/ui/Badge";
import BundleModal from "@/components/BundleModal";

export default function WeekDetailPage() {
  const params = useParams();
  const router = useRouter();
  const weekId = params.weekId as string;
  const [week, setWeek] = useState<Week | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cartRefresh, setCartRefresh] = useState(0);
  const [addingAllForRecipe, setAddingAllForRecipe] = useState<number | null>(
    null
  );
  const [regeneratingRecipe, setRegeneratingRecipe] = useState<number | null>(
    null
  );
  const [frequentItems, setFrequentItems] = useState<FrequentItem[]>([]);
  const [addedFrequentIds, setAddedFrequentIds] = useState<Set<number>>(
    new Set()
  );
  const [addingFrequentId, setAddingFrequentId] = useState<number | null>(null);
  const [frequentQuantityOverrides, setFrequentQuantityOverrides] = useState<Record<number, number>>({});
  const [frequentPromos, setFrequentPromos] = useState<Record<string, string | null>>({});
  const [bundleModalItem, setBundleModalItem] = useState<FrequentItem | null>(null);

  const loadWeek = useCallback(async () => {
    try {
      const res = await fetch(`/api/weeks/${weekId}`);
      if (!res.ok) {
        setError("Week not found");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setWeek(data);
    } catch {
      setError("Failed to load week");
    }
    setLoading(false);
  }, [weekId]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  useEffect(() => {
    fetch("/api/frequent-items")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setFrequentItems(data);
          const ids = data.map((i: FrequentItem) => i.picnic_id);
          if (ids.length > 0) {
            fetch("/api/picnic/promos", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ product_ids: ids }),
            })
              .then((r) => r.json())
              .then((d) => {
                if (d.promos) setFrequentPromos(d.promos);
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleCartUpdate = () => {
    setCartRefresh((n) => n + 1);
    loadWeek();
  };

  const handleDeleteWeek = async () => {
    if (!confirm("Are you sure you want to delete this week? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/weeks/${weekId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/");
      } else {
        setError("Failed to delete week");
        setDeleting(false);
      }
    } catch {
      setError("Failed to delete week");
      setDeleting(false);
    }
  };

  const parseLeftovers = (raw: string | LeftoverItem[] | undefined): string[] => {
    if (!raw) return [];
    if (typeof raw === "string") {
      return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
    return raw.map((item) => item.name.trim().toLowerCase()).filter(Boolean);
  };

  const leftovers = parseLeftovers(week?.preferences?.leftovers);

  const isLeftoverIngredient = (ingredientName: string): boolean => {
    const name = ingredientName.toLowerCase();
    return leftovers.some((l) => name.includes(l) || l.includes(name));
  };

  const handleAddAllForRecipe = async (recipeId: number) => {
    const recipe = week?.recipes?.find((r) => r.id === recipeId);
    if (!recipe?.ingredients) return;

    setAddingAllForRecipe(recipeId);
    const items = recipe.ingredients
      .filter((i) => !i.is_staple && i.picnic_product && !i.picnic_product.added_to_cart && !isLeftoverIngredient(i.name))
      .map((i) => ({
        product_id: i.picnic_product!.picnic_id,
        picnic_product_db_id: i.picnic_product!.id,
      }));

    if (items.length > 0) {
      await fetch("/api/picnic/cart/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      handleCartUpdate();
    }
    setAddingAllForRecipe(null);
  };

  const handleRegenerate = async (recipeId: number) => {
    if (!confirm("Regenerate this recipe? The current recipe will be replaced.")) return;
    setRegeneratingRecipe(recipeId);
    try {
      const res = await fetch(`/api/recipes/${recipeId}/regenerate`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to regenerate recipe");
      }
      await loadWeek();
    } catch {
      setError("Failed to regenerate recipe");
    }
    setRegeneratingRecipe(null);
  };

  const getFrequentQuantity = (item: FrequentItem) =>
    frequentQuantityOverrides[item.id] ?? item.quantity;

  const handleFrequentQuantityChange = (itemId: number, delta: number) => {
    setFrequentQuantityOverrides((prev) => {
      const current = prev[itemId] ?? frequentItems.find((i) => i.id === itemId)?.quantity ?? 1;
      const newQty = Math.max(1, current + delta);
      return { ...prev, [itemId]: newQty };
    });
  };

  const handleAddFrequentToCart = async (item: FrequentItem) => {
    const qty = getFrequentQuantity(item);
    setAddingFrequentId(item.id);
    try {
      for (let i = 0; i < qty; i++) {
        await fetch("/api/picnic/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_id: item.picnic_id }),
        });
      }
      setAddedFrequentIds((prev) => new Set(prev).add(item.id));
      handleCartUpdate();
    } catch {
      // ignore
    }
    setAddingFrequentId(null);
  };

  const handleFrequentBundleSelect = async (bundle: BundleOption) => {
    if (!bundleModalItem) return;
    try {
      await fetch(`/api/frequent-items`, {
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
      setBundleModalItem(null);
      setFrequentItems((prev) =>
        prev.map((i) =>
          i.id === bundleModalItem.id
            ? { ...i, picnic_id: bundle.id, name: bundle.name, image_id: bundle.image_id, price: bundle.price, unit_quantity: bundle.unit_quantity }
            : i
        )
      );
    } catch {
      // ignore
    }
  };

  const weekTotal = (week?.recipes || []).reduce((sum, recipe) => {
    return sum + (recipe.ingredients || [])
      .filter((i) => !i.is_staple && i.picnic_product)
      .reduce((s, i) => s + i.picnic_product!.price, 0);
  }, 0);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (error || !week) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">{error || "Week not found"}</p>
        <Link href="/" className="text-green-600 hover:text-green-700">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
        >
          &larr; All Weeks
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{week.title}</h1>
          <button
            onClick={handleDeleteWeek}
            disabled={deleting}
            className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete Week"}
          </button>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-sm text-gray-600">
            {week.num_nights} nights &middot; {week.servings} servings
          </span>
          {week.preferences?.style && (
            <Badge color="blue">{week.preferences.style}</Badge>
          )}
          {week.preferences?.budget && (
            <Badge color="yellow">{week.preferences.budget}</Badge>
          )}
          {week.preferences?.healthy && (
            <Badge color="green">{week.preferences.healthy}</Badge>
          )}
          {weekTotal > 0 && (
            <span className="text-sm font-medium text-green-700">
              Estimated total: &euro;{(weekTotal / 100).toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex gap-6 flex-col lg:flex-row">
        {/* Recipes */}
        <div className="flex-1 space-y-4">
          {(week.recipes || []).map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onCartUpdate={handleCartUpdate}
              onAddAll={handleAddAllForRecipe}
              addingAll={addingAllForRecipe === recipe.id}
              leftovers={leftovers}
              onRegenerate={handleRegenerate}
              regenerating={regeneratingRecipe === recipe.id}
            />
          ))}

          {/* Frequently Ordered */}
          {frequentItems.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">
                    Frequently Ordered
                  </h3>
                  <Link
                    href="/frequent-items"
                    className="text-xs text-green-600 hover:text-green-700"
                  >
                    Edit list
                  </Link>
                </div>
                <div className="divide-y divide-gray-100">
                  {frequentItems.map((item) => {
                    const added = addedFrequentIds.has(item.id);
                    const adding = addingFrequentId === item.id;
                    const qty = getFrequentQuantity(item);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 py-2"
                      >
                        {item.image_id && (
                          <img
                            src={`https://storefront-prod.nl.picnicinternational.com/static/images/${item.image_id}/small.png`}
                            alt={item.name}
                            className="w-10 h-10 object-contain"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {item.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {item.unit_quantity}{" "}
                            &middot; &euro;
                            {((item.price * qty) / 100).toFixed(2)}
                            {frequentPromos[item.picnic_id] && (
                              <> <Badge color="yellow">{frequentPromos[item.picnic_id]}</Badge></>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleFrequentQuantityChange(item.id, -1)}
                            disabled={qty <= 1}
                            className="w-6 h-6 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center text-xs disabled:opacity-30"
                          >
                            -
                          </button>
                          <span className="text-sm font-medium w-5 text-center">
                            {qty}
                          </span>
                          <button
                            onClick={() => handleFrequentQuantityChange(item.id, 1)}
                            className="w-6 h-6 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center text-xs"
                          >
                            +
                          </button>
                        </div>
                        <button
                          onClick={() => setBundleModalItem(item)}
                          className="text-xs text-blue-500 hover:text-blue-700 px-1"
                          title="Bundle variants"
                        >
                          Bundles
                        </button>
                        <button
                          onClick={() => handleAddFrequentToCart(item)}
                          disabled={adding || added}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                            added
                              ? "bg-green-100 text-green-700"
                              : "bg-green-600 text-white hover:bg-green-700"
                          } disabled:opacity-50`}
                        >
                          {adding
                            ? "Adding..."
                            : added
                              ? "Added"
                              : "Add to Cart"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Cart sidebar */}
        <div className="lg:w-80 shrink-0">
          <div className="lg:sticky lg:top-24">
            <CartSidebar refreshTrigger={cartRefresh} onCartUpdate={handleCartUpdate} />
          </div>
        </div>
      </div>

      {bundleModalItem && (
        <BundleModal
          productId={bundleModalItem.picnic_id}
          productName={bundleModalItem.name}
          currentBundleId={bundleModalItem.picnic_id}
          onClose={() => setBundleModalItem(null)}
          onSelect={handleFrequentBundleSelect}
        />
      )}
    </div>
  );
}
