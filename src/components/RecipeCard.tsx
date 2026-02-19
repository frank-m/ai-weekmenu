"use client";

import { useState } from "react";
import { Recipe } from "@/lib/types";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import IngredientList from "./IngredientList";
import IngredientRow from "./IngredientRow";
import RecipeDetail from "./RecipeDetail";

interface RecipeCardProps {
  recipe: Recipe;
  onCartUpdate: () => void;
  onAddAll: (recipeId: number) => void;
  addingAll: boolean;
  leftovers?: string[];
  onRegenerate?: (recipeId: number) => void;
  regenerating?: boolean;
}

export default function RecipeCard({
  recipe,
  onCartUpdate,
  onAddAll,
  addingAll,
  leftovers,
  onRegenerate,
  regenerating,
}: RecipeCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const [showStaples, setShowStaples] = useState(false);
  const ingredients = recipe.ingredients || [];
  const isLeftover = (name: string) => {
    const n = name.toLowerCase();
    return leftovers?.some((l) => n.includes(l) || l.includes(n)) ?? false;
  };
  const nonStaples = ingredients.filter((i) => !i.is_staple && !isLeftover(i.name));
  const staples = ingredients.filter((i) => i.is_staple && !isLeftover(i.name));
  const leftoverIngredients = ingredients.filter((i) => isLeftover(i.name));
  const hasUnaddedProducts = nonStaples.some(
    (i) => i.picnic_product && !i.picnic_product.added_to_cart
  );

  const recipeTotal = nonStaples.reduce((sum, i) => {
    if (i.picnic_product) return sum + i.picnic_product.price;
    return sum;
  }, 0);

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-5">
          <div className="flex items-start justify-between mb-2">
            <div>
              <span className="text-xs font-medium text-green-600 mb-1 block">
                Night {recipe.night_number}
              </span>
              <h3 className="font-semibold text-gray-900">{recipe.title}</h3>
            </div>
            <div className="flex gap-1">
              <Badge color="blue">{recipe.prep_time}</Badge>
              {recipe.calories_per_serving > 0 && (
                <Badge color="orange">{recipe.calories_per_serving} kcal</Badge>
              )}
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-4 line-clamp-2">
            {recipe.description}
          </p>

          <IngredientList
            ingredients={nonStaples}
            onCartUpdate={onCartUpdate}
          />

          {recipeTotal > 0 && (
            <div className="text-sm font-medium text-gray-700 mt-2">
              Est. &euro;{(recipeTotal / 100).toFixed(2)}
            </div>
          )}

          {leftoverIngredients.length > 0 && (
            <div className="mt-3 bg-green-50 rounded-lg border border-green-200 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-green-800 mb-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Leftovers ({leftoverIngredients.length})
              </div>
              <div className="space-y-1">
                {leftoverIngredients.map((ing) => (
                  <div key={ing.id} className="flex items-center gap-2 text-sm text-green-800">
                    <span className="font-medium">{ing.name}</span>
                    <span className="text-green-600 text-xs">{ing.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {staples.length > 0 && (
            <div className="mt-3 bg-amber-50 rounded-lg border border-amber-200 p-3">
              <button
                onClick={() => setShowStaples(!showStaples)}
                className="flex items-center gap-2 text-xs font-semibold text-amber-800"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${showStaples ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                Staples ({staples.length})
              </button>
              {showStaples && (
                <div className="mt-2 divide-y divide-amber-100">
                  {staples.map((ing) => (
                    <IngredientRow
                      key={ing.id}
                      ingredient={ing}
                      onCartUpdate={onCartUpdate}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mt-4 pt-3 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetail(true)}
            >
              View Recipe
            </Button>
            {onRegenerate && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRegenerate(recipe.id)}
                disabled={regenerating}
              >
                {regenerating ? "Regenerating..." : "Regenerate"}
              </Button>
            )}
            {hasUnaddedProducts && (
              <Button
                size="sm"
                onClick={() => onAddAll(recipe.id)}
                disabled={addingAll}
              >
                {addingAll ? "Adding..." : "Add All to Cart"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {showDetail && (
        <RecipeDetail recipe={recipe} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
}
