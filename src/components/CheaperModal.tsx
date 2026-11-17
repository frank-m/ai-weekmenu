"use client";

import { useState, useEffect } from "react";
import type { CheaperOption } from "@/lib/picnic";
import Button from "./ui/Button";
import Spinner from "./ui/Spinner";

const PRODUCT_IMAGE_BASE =
  "https://storefront-prod.nl.picnicinternational.com/static/images";

interface CheaperModalProps {
  productId: string;
  productName: string;
  onClose: () => void;
  /** Resolves when the swap is done (the parent closes the modal on success) */
  onSelect: (option: CheaperOption) => Promise<void>;
}

/** Similar products that are cheaper per kg / litre / piece, cheapest first. */
export default function CheaperModal({ productId, productName, onClose, onSelect }: CheaperModalProps) {
  const [options, setOptions] = useState<CheaperOption[]>([]);
  const [currentUnitPrice, setCurrentUnitPrice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/picnic/cheaper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error === "picnic_2fa_required") {
          window.dispatchEvent(new CustomEvent("picnic:2fa-required"));
          setError("Picnic needs two-factor verification.");
        } else if (data.error) {
          setError("Could not load cheaper options.");
        }
        setOptions(Array.isArray(data.options) ? data.options : []);
        setCurrentUnitPrice(data.unit_price ?? null);
      })
      .catch(() => setError("Could not load cheaper options."))
      .finally(() => setLoading(false));
  }, [productId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl w-full max-w-md max-h-[80vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Cheaper options</h2>
            <p className="text-sm text-gray-500 truncate">
              {productName}
              {currentUnitPrice && <span className="text-gray-400"> · {currentUnitPrice}</span>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 p-1">
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
          {error && !loading && <p className="text-sm text-red-500 text-center py-4">{error}</p>}
          {!loading && !error && options.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              This is already the cheapest of the similar products Picnic shows.
            </p>
          )}
          {!loading && options.length > 0 && (
            <div className="space-y-2">
              {options.map((option) => (
                <div
                  key={option.picnic_id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-gray-50"
                >
                  {option.image_id && (
                    <img
                      src={`${PRODUCT_IMAGE_BASE}/${option.image_id}/small.png`}
                      alt={option.name}
                      className="w-12 h-12 object-contain shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{option.name}</div>
                    <div className="text-xs text-gray-500">
                      {option.unit_quantity} · {option.unit_price}
                    </div>
                    {option.saving_per_unit && (
                      <div className="text-xs font-medium text-green-700">
                        {option.saving_per_unit} cheaper
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1">
                    <span className="text-sm font-semibold text-gray-900">
                      &euro;{(option.price / 100).toFixed(2)}
                    </span>
                    <Button
                      size="sm"
                      disabled={selecting !== null}
                      onClick={async () => {
                        setSelecting(option.picnic_id);
                        await onSelect(option);
                        setSelecting(null);
                      }}
                    >
                      {selecting === option.picnic_id ? "Swapping..." : "Use"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
