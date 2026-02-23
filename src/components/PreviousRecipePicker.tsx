"use client";

import { useEffect, useState } from "react";
import { Week, Recipe } from "@/lib/types";
import Spinner from "./ui/Spinner";

const PAGE_SIZE = 10;

interface PreviousRecipePickerProps {
  selectedIds: number[];
  onToggle: (recipeId: number) => void;
  maxSelectable: number;
}

export default function PreviousRecipePicker({
  selectedIds,
  onToggle,
  maxSelectable,
}: PreviousRecipePickerProps) {
  const [weeks, setWeeks] = useState<(Week & { recipes?: Recipe[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const [customRecipes, setCustomRecipes] = useState<
    (Recipe & { weekTitle: string })[]
  >([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [weeksRes, customRes] = await Promise.all([
          fetch("/api/weeks"),
          fetch("/api/recipes/custom"),
        ]);
        const weekList: Week[] = await weeksRes.json();
        const custom: Recipe[] = await customRes.json();
        // Load recipes for each week
        const withRecipes = await Promise.all(
          weekList.map(async (w) => {
            const detail = await fetch(`/api/weeks/${w.id}`);
            return detail.json();
          })
        );
        setWeeks(withRecipes);
        setCustomRecipes(
          (Array.isArray(custom) ? custom : []).map((r) => ({
            ...r,
            weekTitle: "Your Recipe",
          }))
        );
      } catch {
        // ignore
      }
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <Spinner />;

  const combined = [
    ...customRecipes,
    ...weeks.flatMap((w) =>
      (w.recipes || []).map((r) => ({ ...r, weekTitle: w.title }))
    ),
  ];

  const ratingOrder = (r: { rating?: number | null }) => {
    if (r.rating === 1) return 0;
    if (r.rating === -1) return 2;
    return 1;
  };

  const allRecipes = [...combined].sort(
    (a, b) => ratingOrder(a) - ratingOrder(b)
  );

  if (allRecipes.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-4">
        No previous recipes to reuse yet.
      </p>
    );
  }

  const query = search.toLowerCase();
  const filtered = query
    ? allRecipes.filter(
        (r) =>
          r.title.toLowerCase().includes(query) ||
          r.weekTitle.toLowerCase().includes(query)
      )
    : allRecipes;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE
  );

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        placeholder="Search recipes..."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
      />

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {paginated.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            No recipes match your search.
          </p>
        ) : (
          paginated.map((recipe) => {
            const isSelected = selectedIds.includes(recipe.id);
            const isDisabled =
              !isSelected && selectedIds.length >= maxSelectable;

            return (
              <button
                key={recipe.id}
                type="button"
                onClick={() => !isDisabled && onToggle(recipe.id)}
                disabled={isDisabled}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  isSelected
                    ? "border-green-500 bg-green-50"
                    : isDisabled
                      ? "border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed"
                      : "border-gray-200 hover:border-green-300"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-sm">{recipe.title}</span>
                  {recipe.rating === 1 && <span className="text-xs">👍</span>}
                  {recipe.rating === -1 && <span className="text-xs">👎</span>}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  from {recipe.weekTitle} &middot; {recipe.prep_time}
                </div>
              </button>
            );
          })
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            &laquo; Previous
          </button>
          <span className="text-xs text-gray-500">
            Page {safePage + 1} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next &raquo;
          </button>
        </div>
      )}
    </div>
  );
}
