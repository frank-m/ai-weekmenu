import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateRecipes, matchIngredientsToProducts, getVarietyContext } from "@/lib/gemini";
import { searchProduct, delay, PicnicTwoFactorRequiredError } from "@/lib/picnic";
import { Recipe, Week, WeekPreferences, LeftoverItem } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ recipeId: string }> }
) {
  try {
    const { recipeId } = await params;
    const db = getDb();

    // Titles the user already rejected in this regenerate session (kept by
    // the client) — prevents bouncing back to an earlier suggestion
    let rejectedTitles: string[] = [];
    try {
      const body = await request.json();
      if (Array.isArray(body?.rejected_titles)) {
        rejectedTitles = body.rejected_titles.filter(
          (t: unknown): t is string => typeof t === "string"
        );
      }
    } catch {
      // No/invalid body — fine, it's optional
    }

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

    // 3b. Determine which leftover ingredients are already covered by sibling recipes
    let filteredPreferences = preferences;
    if (Array.isArray(preferences.leftovers) && preferences.leftovers.length > 0) {
      const siblingIngNames = (
        db
          .prepare(
            `SELECT DISTINCT i.name FROM ingredients i
             JOIN recipes r ON i.recipe_id = r.id
             WHERE r.week_id = ? AND r.id != ?`
          )
          .all(recipe.week_id, recipeId) as { name: string }[]
      ).map((r) => r.name.toLowerCase().trim());

      const uncovered = (preferences.leftovers as LeftoverItem[]).filter((l) => {
        const lname = l.name.toLowerCase().trim();
        return !siblingIngNames.some(
          (s) => s.includes(lname) || lname.includes(s)
        );
      });
      filteredPreferences = { ...preferences, leftovers: uncovered };
    } else if (typeof preferences.leftovers === "string") {
      // Legacy string format — can't be filtered; strip it to avoid the same bug
      filteredPreferences = { ...preferences, leftovers: undefined };
    }

    // 4. Generate one new recipe, avoiding recent weeks' dishes, disliked
    // dishes, and anything already rejected in this session
    const variety = getVarietyContext(recipe.week_id ?? undefined);
    variety.rejectedTitles = rejectedTitles;
    const generated = await generateRecipes(
      1,
      week.servings,
      filteredPreferences,
      siblingTitles,
      recipe.title,
      variety
    );
    if (!generated.length) {
      return NextResponse.json({ error: "Failed to generate recipe" }, { status: 500 });
    }
    const newRecipe = generated[0];

    // 5+6. Swap old recipe data for the new one atomically
    db.transaction(() => {
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
        "UPDATE recipes SET title = ?, description = ?, servings = ?, prep_time = ?, instructions = ?, calories_per_serving = ?, source_recipe_id = NULL, rating = NULL WHERE id = ?"
      ).run(
        newRecipe.title,
        newRecipe.description,
        newRecipe.servings,
        newRecipe.prep_time,
        newRecipe.instructions,
        newRecipe.calories_per_serving || 0,
        recipeId
      );

      for (const ing of newRecipe.ingredients) {
        db.prepare(
          "INSERT INTO ingredients (recipe_id, name, quantity, is_staple, category) VALUES (?, ?, ?, ?, ?)"
        ).run(recipeId, ing.name, ing.quantity, ing.is_staple ? 1 : 0, ing.category);
      }
    })();

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

    // Matching failures must not fail the request — the recipe swap is done;
    // the week page shows a banner with a rematch option for the rest.
    let matchingStatus: "ok" | "2fa_required" | "failed" = "ok";
    let productMap: Record<string, { picnic_id: string; name: string; image_id: string; price: number; unit_quantity: string; quantity?: number } | null> = {};
    try {
      try {
        productMap = await matchIngredientsToProducts(uniqueIngredients);
      } catch (err) {
        if (err instanceof PicnicTwoFactorRequiredError) throw err;
        for (const { name } of uniqueIngredients) {
          await delay(500);
          try {
            productMap[name] = await searchProduct(name);
          } catch (searchErr) {
            if (searchErr instanceof PicnicTwoFactorRequiredError) throw searchErr;
            productMap[name] = null;
          }
        }
      }
    } catch (err) {
      matchingStatus = err instanceof PicnicTwoFactorRequiredError ? "2fa_required" : "failed";
      console.error("[regenerate] Picnic matching skipped:", err);
    }

    for (const ing of newIngredients) {
      const normalizedName = ing.name.toLowerCase().trim();
      const product = productMap[normalizedName];
      if (product) {
        db.prepare(
          "INSERT INTO picnic_products (ingredient_id, picnic_id, name, image_id, price, unit_quantity, quantity) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(ing.id, product.picnic_id, product.name, product.image_id, product.price, product.unit_quantity, product.quantity ?? 1);
      }
    }

    return NextResponse.json({ success: true, picnic_matching: matchingStatus });
  } catch (error) {
    console.error("[regenerate] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
