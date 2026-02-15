"use client";

import { Ingredient } from "@/lib/types";
import IngredientRow from "./IngredientRow";

interface IngredientListProps {
  ingredients: Ingredient[];
  onCartUpdate: () => void;
}

export default function IngredientList({
  ingredients,
  onCartUpdate,
}: IngredientListProps) {
  if (ingredients.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-2">No ingredients listed</p>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {ingredients.map((ing) => (
        <IngredientRow
          key={ing.id}
          ingredient={ing}
          onCartUpdate={onCartUpdate}
        />
      ))}
    </div>
  );
}
