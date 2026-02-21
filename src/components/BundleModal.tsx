"use client";

import { useState, useEffect } from "react";
import { BundleOption } from "@/lib/types";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";

const PRODUCT_IMAGE_BASE =
  "https://storefront-prod.nl.picnicinternational.com/static/images";

interface BundleModalProps {
  productId: string;
  productName: string;
  currentBundleId: string;
  onClose: () => void;
  onSelect: (bundle: BundleOption) => void;
}

export default function BundleModal({
  productId,
  productName,
  currentBundleId,
  onClose,
  onSelect,
}: BundleModalProps) {
  const [bundles, setBundles] = useState<BundleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/picnic/bundles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId }),
    })
      .then((r) => r.json())
      .then((data) => {
        setBundles(Array.isArray(data.bundles) ? data.bundles : []);
        if (data.error) setError(data.error);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [productId]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md max-h-[80vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Bundles</h2>
            <p className="text-sm text-gray-500 truncate">{productName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4">
          {loading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}

          {error && !loading && (
            <p className="text-sm text-red-500 text-center py-4">{error}</p>
          )}

          {!loading && !error && bundles.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              No bundles available for this product.
            </p>
          )}

          {!loading && bundles.length > 0 && (
            <div className="space-y-2">
              {bundles.map((bundle) => {
                const isCurrent = bundle.id === currentBundleId;
                return (
                  <button
                    key={bundle.id}
                    onClick={() => !isCurrent && onSelect(bundle)}
                    disabled={isCurrent}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                      isCurrent
                        ? "bg-green-50 border-2 border-green-500"
                        : "bg-gray-50 hover:bg-gray-100 border-2 border-transparent"
                    }`}
                  >
                    {bundle.image_id && (
                      <img
                        src={`${PRODUCT_IMAGE_BASE}/${bundle.image_id}/small.png`}
                        alt={bundle.name}
                        className="w-12 h-12 object-contain flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {bundle.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {bundle.promo_label && (
                          <span className="text-xs font-medium text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">
                            {bundle.promo_label}
                          </span>
                        )}
                        {bundle.unit_quantity && (
                          <span className="text-xs text-gray-500">
                            {bundle.unit_quantity}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-gray-900">
                        &euro;{(bundle.price / 100).toFixed(2)}
                      </div>
                      {isCurrent && (
                        <span className="text-xs text-green-600">Current</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200">
          <Button onClick={onClose} variant="secondary" className="w-full">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
