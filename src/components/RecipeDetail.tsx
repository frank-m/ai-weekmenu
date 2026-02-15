"use client";

import { Recipe } from "@/lib/types";
import Badge from "./ui/Badge";

interface RecipeDetailProps {
  recipe: Recipe;
  onClose: () => void;
}

export default function RecipeDetail({ recipe, onClose }: RecipeDetailProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-semibold">{recipe.title}</h2>
            <div className="flex gap-2 mt-1">
              <Badge color="blue">{recipe.prep_time}</Badge>
              <Badge color="gray">{recipe.servings} servings</Badge>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          <p className="text-gray-600">{recipe.description}</p>

          {recipe.ingredients && recipe.ingredients.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Ingredients</h3>
              <ul className="space-y-1">
                {recipe.ingredients.map((ing) => (
                  <li key={ing.id} className="text-sm text-gray-700 flex gap-2">
                    <span className="text-gray-400">&bull;</span>
                    <span>
                      {ing.quantity} {ing.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Instructions</h3>
            <div className="space-y-2">
              {(() => {
                const lines = recipe.instructions.split("\n").map(l => l.trim()).filter(Boolean);
                if (lines.length <= 1 && recipe.instructions.match(/\d+\.\s/g)) {
                  return recipe.instructions.split(/(?=\d+\.\s)/).map(l => l.trim()).filter(Boolean);
                }
                return lines;
              })().map((line, i) => {
                  const numbered = line.match(/^(\d+)\.\s*(.*)/);
                  const stepNum = numbered ? numbered[1] : i + 1;
                  const stepText = numbered ? numbered[2] : line;
                  return (
                    <div
                      key={i}
                      className={`flex gap-3 p-3 rounded-lg ${
                        i % 2 === 0 ? "bg-gray-50" : "bg-white"
                      }`}
                    >
                      <span className="shrink-0 w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-sm font-semibold">
                        {stepNum}
                      </span>
                      <p className="text-sm text-gray-700 pt-1">{stepText}</p>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
