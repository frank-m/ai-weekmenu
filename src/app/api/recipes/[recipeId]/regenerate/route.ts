import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateRecipes, matchIngredientsToProducts } from "@/lib/gemini";
import { searchProduct } from "@/lib/picnic";
import { Recipe, Week, WeekPreferences } from "@/lib/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ recipeId: string }> }
) {
  try {
    const { recipeId } = await params;
    const db = getDb();

    // 1. Look up recipe
    const recipe = db
      .prepare("SELECT * FROM recipes WHERE id = ?")
      .get(recipeId) as Recipe | undefined;

    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    // 2. Load week
    const week = db
      .prepare("SELECT * FROM weeks WHERE id = ?")
      .get(recipe.week_id) as (Omit<Week, "preferences"> & { preferences: string }) | undefined;

    if (!week) {
      return NextResponse.json({ error: "Week not found" }, { status: 404 });
    }

    const preferences: WeekPreferences = JSON.parse(week.preferences);

    // 3. Get sibling recipe titles (to avoid duplicates)
    const siblingTitles = (
      db
        .prepare("SELECT title FROM recipes WHERE week_id = ? AND id != ?")
        .all(recipe.week_id, recipeId) as { title: string }[]
    ).map((r) => r.title);

    // 4. Generate one new recipe
    const generated = await generateRecipes(1, week.servings, preferences, siblingTitles);
    if (!generated.length) {
      return NextResponse.json({ error: "Failed to generate recipe" }, { status: 500 });
    }
    const newRecipe = generated[0];

    // 5. Delete old data: picnic_products → ingredients, then update recipe row
    const oldIngredientIds = (
      db
        .prepare("SELECT id FROM ingredients WHERE recipe_id = ?")
        .all(recipeId) as { id: number }[]
    ).map((i) => i.id);

    if (oldIngredientIds.length > 0) {
      db.prepare(
        `DELETE FROM picnic_products WHERE ingredient_id IN (${oldIngredientIds.join(",")})`
      ).run();
    }
    db.prepare("DELETE FROM ingredients WHERE recipe_id = ?").run(recipeId);

    db.prepare(
      "UPDATE recipes SET title = ?, description = ?, servings = ?, prep_time = ?, instructions = ?, calories_per_serving = ?, source_recipe_id = NULL WHERE id = ?"
    ).run(
      newRecipe.title,
      newRecipe.description,
      newRecipe.servings,
      newRecipe.prep_time,
      newRecipe.instructions,
      newRecipe.calories_per_serving || 0,
      recipeId
    );

    // 6. Insert new ingredients
    for (const ing of newRecipe.ingredients) {
      db.prepare(
        "INSERT INTO ingredients (recipe_id, name, quantity, is_staple, category) VALUES (?, ?, ?, ?, ?)"
      ).run(recipeId, ing.name, ing.quantity, ing.is_staple ? 1 : 0, ing.category);
    }

    // 7. Match new ingredients to Picnic products
    const newIngredients = db
      .prepare("SELECT id, name, quantity FROM ingredients WHERE recipe_id = ?")
      .all(recipeId) as { id: number; name: string; quantity: string }[];

    const seenNames = new Map<string, string>();
    for (const ing of newIngredients) {
      const key = ing.name.toLowerCase().trim();
      if (!seenNames.has(key)) seenNames.set(key, ing.quantity || "");
    }
    const uniqueIngredients = Array.from(seenNames.entries()).map(
      ([name, quantity]) => ({ name, quantity })
    );

    let productMap: Record<string, { picnic_id: string; name: string; image_id: string; price: number; unit_quantity: string } | null> = {};
    try {
      productMap = await matchIngredientsToProducts(uniqueIngredients);
    } catch {
      for (const { name } of uniqueIngredients) {
        try {
          productMap[name] = await searchProduct(name);
        } catch {
          productMap[name] = null;
        }
      }
    }

    for (const ing of newIngredients) {
      const normalizedName = ing.name.toLowerCase().trim();
      const product = productMap[normalizedName];
      if (product) {
        db.prepare(
          "INSERT INTO picnic_products (ingredient_id, picnic_id, name, image_id, price, unit_quantity) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(ing.id, product.picnic_id, product.name, product.image_id, product.price, product.unit_quantity);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[regenerate] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
