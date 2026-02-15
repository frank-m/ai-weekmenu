"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import NumberStepper from "@/components/ui/NumberStepper";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import { Recipe } from "@/lib/types";

const PRODUCT_IMAGE_BASE =
  "https://storefront-prod.nl.picnicinternational.com/static/images";

const CATEGORIES = [
  "groenten",
  "fruit",
  "vlees",
  "vis",
  "zuivel",
  "bakkerij",
  "kruiden",
  "overig",
];

const RESULTS_PER_PAGE = 5;

interface SearchResult {
  id: string;
  name: string;
  image_id: string;
  price: number;
  unit_quantity: string;
}

interface SelectedProduct {
  picnic_id: string;
  name: string;
  image_id: string;
  price: number;
  unit_quantity: string;
}

interface IngredientRow {
  name: string;
  quantity: string;
  category: string;
  is_staple: boolean;
  picnic_product?: SelectedProduct;
  searchResults: SearchResult[];
  visibleCount: number;
  searching: boolean;
}

function emptyIngredient(): IngredientRow {
  return {
    name: "",
    quantity: "",
    category: "overig",
    is_staple: false,
    searchResults: [],
    visibleCount: RESULTS_PER_PAGE,
    searching: false,
  };
}

export default function CreateRecipePageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Spinner /></div>}>
      <CreateRecipePage />
    </Suspense>
  );
}

function CreateRecipePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const isEditMode = !!editId;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [servings, setServings] = useState(4);
  const [prepTime, setPrepTime] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    emptyIngredient(),
  ]);
  const [saving, setSaving] = useState(false);
  const [loadingRecipe, setLoadingRecipe] = useState(isEditMode);

  useEffect(() => {
    if (!editId) return;

    const loadRecipe = async () => {
      try {
        const res = await fetch(`/api/recipes/custom/${editId}`);
        if (!res.ok) {
          router.push("/recipes");
          return;
        }
        const recipe: Recipe = await res.json();

        setTitle(recipe.title);
        setDescription(recipe.description || "");
        setServings(recipe.servings);
        setPrepTime(recipe.prep_time || "");

        // Parse instructions back into steps
        if (recipe.instructions) {
          const lines = recipe.instructions
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => l.replace(/^\d+\.\s*/, ""));
          setSteps(lines.length > 0 ? lines : [""]);
        }

        // Map ingredients
        if (recipe.ingredients && recipe.ingredients.length > 0) {
          setIngredients(
            recipe.ingredients.map((ing) => ({
              name: ing.name,
              quantity: ing.quantity,
              category: ing.category || "overig",
              is_staple: ing.is_staple,
              picnic_product: ing.picnic_product
                ? {
                    picnic_id: ing.picnic_product.picnic_id,
                    name: ing.picnic_product.name,
                    image_id: ing.picnic_product.image_id,
                    price: ing.picnic_product.price,
                    unit_quantity: ing.picnic_product.unit_quantity,
                  }
                : undefined,
              searchResults: [],
              visibleCount: RESULTS_PER_PAGE,
              searching: false,
            }))
          );
        }
      } catch {
        router.push("/recipes");
        return;
      }
      setLoadingRecipe(false);
    };

    loadRecipe();
  }, [editId, router]);

  const updateStep = (index: number, value: string) => {
    const next = [...steps];
    next[index] = value;
    setSteps(next);
  };

  const addStep = () => setSteps([...steps, ""]);

  const removeStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps(steps.filter((_, i) => i !== index));
  };

  const updateIngredient = (
    index: number,
    field: keyof IngredientRow,
    value: string | boolean
  ) => {
    const next = [...ingredients];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (next[index] as any)[field] = value;
    setIngredients(next);
  };

  const addIngredient = () =>
    setIngredients([...ingredients, emptyIngredient()]);

  const removeIngredient = (index: number) => {
    if (ingredients.length <= 1) return;
    setIngredients(ingredients.filter((_, i) => i !== index));
  };

  const searchPicnic = async (index: number) => {
    const ing = ingredients[index];
    if (!ing.name.trim()) return;

    const next = [...ingredients];
    next[index] = { ...next[index], searching: true, searchResults: [], visibleCount: RESULTS_PER_PAGE };
    setIngredients(next);

    try {
      const res = await fetch("/api/picnic/search/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: ing.name }),
      });
      const data = await res.json();
      const updated = [...ingredients];
      updated[index] = {
        ...updated[index],
        searching: false,
        searchResults: Array.isArray(data.products) ? data.products : [],
        visibleCount: RESULTS_PER_PAGE,
      };
      setIngredients(updated);
    } catch {
      const updated = [...ingredients];
      updated[index] = { ...updated[index], searching: false };
      setIngredients(updated);
    }
  };

  const selectProduct = (ingIndex: number, product: SearchResult) => {
    const next = [...ingredients];
    next[ingIndex] = {
      ...next[ingIndex],
      picnic_product: {
        picnic_id: product.id,
        name: product.name,
        image_id: product.image_id,
        price: product.price,
        unit_quantity: product.unit_quantity,
      },
      searchResults: [],
    };
    setIngredients(next);
  };

  const clearProduct = (index: number) => {
    const next = [...ingredients];
    next[index] = { ...next[index], picnic_product: undefined };
    setIngredients(next);
  };

  const showMore = (index: number) => {
    const next = [...ingredients];
    next[index] = {
      ...next[index],
      visibleCount: next[index].visibleCount + RESULTS_PER_PAGE,
    };
    setIngredients(next);
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);

    const instructions = steps
      .filter((s) => s.trim())
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n");

    const body = {
      title: title.trim(),
      description: description.trim(),
      servings,
      prep_time: prepTime.trim(),
      instructions,
      ingredients: ingredients
        .filter((ing) => ing.name.trim())
        .map((ing) => ({
          name: ing.name.trim(),
          quantity: ing.quantity.trim(),
          is_staple: ing.is_staple,
          category: ing.category,
          picnic_product: ing.picnic_product,
        })),
    };

    try {
      const url = isEditMode
        ? `/api/recipes/custom/${editId}`
        : "/api/recipes/custom";
      const method = isEditMode ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        router.push("/recipes");
      }
    } catch {
      // ignore
    }
    setSaving(false);
  };

  if (loadingRecipe) {
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
          href="/recipes"
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
        >
          &larr; My Recipes
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          {isEditMode ? "Edit Recipe" : "Create Recipe"}
        </h1>
      </div>

      <div className="space-y-6">
        {/* Basic Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Pasta Carbonara"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of the dish"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          <div className="flex flex-wrap gap-6">
            <NumberStepper
              value={servings}
              onChange={setServings}
              min={1}
              max={12}
              label="Servings"
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Prep Time
              </label>
              <input
                type="text"
                value={prepTime}
                onChange={(e) => setPrepTime(e.target.value)}
                placeholder="e.g. 30 min"
                className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">
            Instructions
          </h2>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-sm text-gray-400 mt-2 w-6 text-right shrink-0">
                  {i + 1}.
                </span>
                <input
                  type="text"
                  value={step}
                  onChange={(e) => updateStep(i, e.target.value)}
                  placeholder={`Step ${i + 1}`}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStep(i)}
                    className="text-red-400 hover:text-red-600 p-2 shrink-0"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addStep}
            className="mt-3 text-sm text-green-600 hover:text-green-700 font-medium"
          >
            + Add step
          </button>
        </div>

        {/* Ingredients */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">
            Ingredients
          </h2>
          <div className="space-y-4">
            {ingredients.map((ing, i) => (
              <div
                key={i}
                className="border border-gray-100 rounded-lg p-3 space-y-3"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={ing.name}
                      onChange={(e) =>
                        updateIngredient(i, "name", e.target.value)
                      }
                      placeholder="Ingredient name (Dutch)"
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={ing.quantity}
                      onChange={(e) =>
                        updateIngredient(i, "quantity", e.target.value)
                      }
                      placeholder="e.g. 200g, 2 stuks"
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                  {ingredients.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeIngredient(i)}
                      className="text-red-400 hover:text-red-600 p-2 shrink-0"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={ing.category}
                    onChange={(e) =>
                      updateIngredient(i, "category", e.target.value)
                    }
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>

                  <label className="flex items-center gap-1.5 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={ing.is_staple}
                      onChange={(e) =>
                        updateIngredient(i, "is_staple", e.target.checked)
                      }
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    Staple
                  </label>

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => searchPicnic(i)}
                    disabled={ing.searching || !ing.name.trim()}
                  >
                    {ing.searching ? "Searching..." : "Search Picnic"}
                  </Button>
                </div>

                {/* Selected product */}
                {ing.picnic_product && (
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-green-50 border border-green-200">
                    {ing.picnic_product.image_id && (
                      <img
                        src={`${PRODUCT_IMAGE_BASE}/${ing.picnic_product.image_id}/small.png`}
                        alt={ing.picnic_product.name}
                        className="w-10 h-10 object-contain"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {ing.picnic_product.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {ing.picnic_product.unit_quantity} &middot; &euro;
                        {(ing.picnic_product.price / 100).toFixed(2)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => clearProduct(i)}
                      className="text-red-400 hover:text-red-600 p-1"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                )}

                {/* Search results */}
                {ing.searchResults.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-xs text-gray-500">
                      {ing.searchResults.length} result
                      {ing.searchResults.length !== 1 ? "s" : ""}
                    </span>
                    {ing.searchResults
                      .slice(0, ing.visibleCount)
                      .map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => selectProduct(i, product)}
                          className="w-full flex items-center gap-3 p-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-left transition-colors"
                        >
                          {product.image_id && (
                            <img
                              src={`${PRODUCT_IMAGE_BASE}/${product.image_id}/small.png`}
                              alt={product.name}
                              className="w-10 h-10 object-contain"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {product.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {product.unit_quantity} &middot; &euro;
                              {(product.price / 100).toFixed(2)}
                            </div>
                          </div>
                        </button>
                      ))}
                    {ing.visibleCount < ing.searchResults.length && (
                      <button
                        type="button"
                        onClick={() => showMore(i)}
                        className="w-full text-sm text-green-600 hover:text-green-700 font-medium py-2"
                      >
                        Show more (
                        {ing.searchResults.length - ing.visibleCount} remaining)
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addIngredient}
            className="mt-3 text-sm text-green-600 hover:text-green-700 font-medium"
          >
            + Add ingredient
          </button>
        </div>

        {/* Save */}
        <div className="flex justify-end gap-3">
          <Link href="/recipes">
            <Button variant="secondary">Cancel</Button>
          </Link>
          <Button
            onClick={handleSave}
            disabled={saving || !title.trim()}
          >
            {saving ? "Saving..." : isEditMode ? "Update Recipe" : "Save Recipe"}
          </Button>
        </div>
      </div>
    </div>
  );
}
