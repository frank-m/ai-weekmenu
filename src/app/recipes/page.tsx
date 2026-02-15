"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Recipe } from "@/lib/types";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import RecipeDetail from "@/components/RecipeDetail";

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

  const loadRecipes = async () => {
    try {
      const res = await fetch("/api/recipes/custom");
      const data = await res.json();
      setRecipes(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => {
    loadRecipes();
  }, []);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await fetch(`/api/recipes/custom/${id}`, { method: "DELETE" });
      await loadRecipes();
    } catch {
      // ignore
    }
    setDeletingId(null);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
        >
          &larr; Home
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">My Recipes</h1>
          <Link href="/create-recipe">
            <Button>+ New Recipe</Button>
          </Link>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Custom recipes you can reuse when creating weekly menus.
        </p>
      </div>

      {recipes.length === 0 ? (
        <div className="text-center py-20">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            No custom recipes yet
          </h2>
          <p className="text-gray-500 mb-6">
            Create your own recipes to reuse across weekly menus.
          </p>
          <Link href="/create-recipe">
            <Button size="lg">Create Your First Recipe</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {recipes.map((recipe) => (
            <div
              key={recipe.id}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow cursor-pointer"
              onClick={() => setSelectedRecipe(recipe)}
            >
              <h3 className="font-semibold text-gray-900">{recipe.title}</h3>
              {recipe.description && (
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                  {recipe.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
                {recipe.prep_time && <span>{recipe.prep_time}</span>}
                <span>{recipe.servings} servings</span>
                {recipe.ingredients && (
                  <span>{recipe.ingredients.length} ingredients</span>
                )}
              </div>
              <div
                className="mt-3 pt-3 border-t border-gray-100 flex justify-end gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <Link href={`/create-recipe?edit=${recipe.id}`}>
                  <Button variant="secondary" size="sm">
                    Edit
                  </Button>
                </Link>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleDelete(recipe.id)}
                  disabled={deletingId === recipe.id}
                >
                  {deletingId === recipe.id ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedRecipe && (
        <RecipeDetail
          recipe={selectedRecipe}
          onClose={() => setSelectedRecipe(null)}
        />
      )}
    </div>
  );
}
