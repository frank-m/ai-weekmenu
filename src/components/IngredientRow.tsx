"use client";

import { useState } from "react";
import { Ingredient, BundleOption } from "@/lib/types";
import Button from "./ui/Button";
import BundleModal from "./BundleModal";

interface IngredientRowProps {
  ingredient: Ingredient;
  onCartUpdate: () => void;
}

const PICNIC_IMAGE_BASE =
  "https://storefront-prod.nl.picnicinternational.com/static/images";

export default function IngredientRow({
  ingredient,
  onCartUpdate,
}: IngredientRowProps) {
  const [adding, setAdding] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showBundleModal, setShowBundleModal] = useState(false);
  const product = ingredient.picnic_product;

  const handleAddToCart = async () => {
    if (!product) return;
    setAdding(true);
    try {
      await fetch("/api/picnic/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: product.picnic_id,
          picnic_product_db_id: product.id,
        }),
      });
      onCartUpdate();
    } catch {
      // ignore
    }
    setAdding(false);
  };

  const handleBundleSelect = async (bundle: BundleOption) => {
    try {
      await fetch("/api/picnic/search", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredient_id: ingredient.id,
          picnic_id: bundle.id,
          name: bundle.name,
          image_id: bundle.image_id,
          price: bundle.price,
          unit_quantity: bundle.unit_quantity,
        }),
      });
      setShowBundleModal(false);
      onCartUpdate();
    } catch {
      // ignore
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      await fetch("/api/picnic/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery,
          ingredient_id: ingredient.id,
        }),
      });
      onCartUpdate();
      setShowSearch(false);
      setSearchQuery("");
    } catch {
      // ignore
    }
    setSearching(false);
  };

  return (
    <div className="relative flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 py-2 px-3 rounded-lg hover:bg-gray-50">
      {/* Ingredient info */}
      <div className="sm:flex-1 sm:min-w-0">
        <div className="text-sm font-medium text-gray-900 sm:truncate">
          {ingredient.name}
        </div>
        <div className="text-xs text-gray-500">{ingredient.quantity}</div>
      </div>

      {product ? (
        <div className="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
          {product.image_id && (
            <img
              src={`${PICNIC_IMAGE_BASE}/${product.image_id}/small.png`}
              alt={product.name}
              className="w-10 h-10 object-contain rounded"
            />
          )}
          <div className="text-right flex-1 sm:flex-none">
            <div className="text-xs text-gray-700 max-w-[120px] truncate">
              {product.name}
            </div>
            {product.unit_quantity && (
              <div className="text-xs text-gray-400">{product.unit_quantity}</div>
            )}
            <div className="text-xs font-medium text-green-700">
              &euro;{(product.price / 100).toFixed(2)}
            </div>
          </div>
          {product.added_to_cart ? (
            <span className="text-xs text-green-600 font-medium px-2">
              In cart
            </span>
          ) : (
            <Button
              size="sm"
              onClick={handleAddToCart}
              disabled={adding}
            >
              {adding ? "..." : "+"}
            </Button>
          )}
          <button
            onClick={() => setShowBundleModal(true)}
            className="text-xs text-blue-500 hover:text-blue-700 px-1"
            title="Bundle variants"
          >
            Bundles
          </button>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="text-gray-400 hover:text-gray-600 p-1"
            title="Search different product"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
          <span className="text-xs text-gray-400">No match</span>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="text-gray-400 hover:text-gray-600 p-1"
            title="Search product"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
      )}

      {/* Inline search */}
      {showSearch && (
        <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg p-2 flex gap-2 z-10">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search Picnic..."
            className="px-2 py-1 border rounded text-sm w-40"
          />
          <Button size="sm" onClick={handleSearch} disabled={searching}>
            {searching ? "..." : "Go"}
          </Button>
        </div>
      )}

      {showBundleModal && product && (
        <BundleModal
          productId={product.picnic_id}
          productName={product.name}
          currentBundleId={product.picnic_id}
          onClose={() => setShowBundleModal(false)}
          onSelect={handleBundleSelect}
        />
      )}
    </div>
  );
}
