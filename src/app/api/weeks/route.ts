import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  generateRecipes,
  matchIngredientsWithFallback,
  getVarietyContext,
} from "@/lib/gemini";
import { PicnicTwoFactorRequiredError } from "@/lib/picnic";
import { CreateWeekRequest, GeneratedRecipe, Recipe, Week } from "@/lib/types";
import { getStaples } from "@/lib/staples";

export async function GET(request: Request) {
  try {
    const db = getDb();
    const includeRecipes =
      new URL(request.url).searchParams.get("include") === "recipes";
    const weeks = db
      .prepare("SELECT * FROM weeks ORDER BY created_at DESC")
      .all() as Array<Omit<Week, "preferences"> & { preferences: string }>;

    return NextResponse.json(
      weeks.map((w) => ({
        ...w,
        preferences: JSON.parse(w.preferences),
        // Lightweight recipe list (no ingredients/products, no cart sync) —
        // used by the recipe reuse picker instead of N detail requests
        ...(includeRecipes
          ? {
              recipes: db
                .prepare(
                  "SELECT id, title, prep_time, rating, night_number FROM recipes WHERE week_id = ? ORDER BY night_number ASC"
                )
                .all(w.id),
            }
          : {}),
      }))
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: CreateWeekRequest = await request.json();
    const db = getDb();

    // 1. Load reused source recipes (read-only — nothing written yet, so a
    // failed Gemini call below can't leave an orphaned half-created week)
    const reusedSources: Array<{ recipe: Recipe; ingredients: Array<{ name: string; quantity: string; is_staple: number; category: string }> }> = [];
    if (body.reused_recipe_ids && body.reused_recipe_ids.length > 0) {
      for (const sourceId of body.reused_recipe_ids) {
        const sourceRecipe = db
          .prepare("SELECT * FROM recipes WHERE id = ?")
          .get(sourceId) as Recipe | undefined;
        if (!sourceRecipe) continue;
        const sourceIngredients = db
          .prepare("SELECT * FROM ingredients WHERE recipe_id = ?")
          .all(sourceId) as Array<{
          name: string;
          quantity: string;
          is_staple: number;
          category: string;
        }>;
        reusedSources.push({ recipe: sourceRecipe, ingredients: sourceIngredients });
      }
    }

    // 2. Generate remaining recipes, steering away from recent and disliked
    // dishes so consecutive weeks don't look alike
    const numToGenerate = body.num_nights - reusedSources.length;
    let generated: GeneratedRecipe[] = [];
    if (numToGenerate > 0) {
      const existingTitles = reusedSources.map((s) => s.recipe.title);
      generated = await generateRecipes(
        numToGenerate,
        body.servings,
        body.preferences,
        existingTitles,
        undefined,
        getVarietyContext()
      );
    }

    // 3. Write week + recipes + ingredients atomically
    const staplesList = getStaples();
    const weekId = db.transaction(() => {
      const weekResult = db
        .prepare(
          "INSERT INTO weeks (title, num_nights, servings, preferences) VALUES (?, ?, ?, ?)"
        )
        .run(
          body.title,
          body.num_nights,
          body.servings,
          JSON.stringify(body.preferences)
        );
      const newWeekId = weekResult.lastInsertRowid as number;

      reusedSources.forEach(({ recipe: sourceRecipe, ingredients }, i) => {
        const recipeResult = db
          .prepare(
            "INSERT INTO recipes (week_id, title, description, servings, prep_time, instructions, night_number, source_recipe_id, calories_per_serving) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            newWeekId,
            sourceRecipe.title,
            sourceRecipe.description,
            body.servings,
            sourceRecipe.prep_time,
            sourceRecipe.instructions,
            i + 1,
            sourceRecipe.id,
            sourceRecipe.calories_per_serving || 0
          );
        const newRecipeId = recipeResult.lastInsertRowid as number;

        for (const ing of ingredients) {
          const isActualStaple = staplesList.some(
            (s) =>
              ing.name.toLowerCase().includes(s) ||
              s.includes(ing.name.toLowerCase())
          );
          db.prepare(
            "INSERT INTO ingredients (recipe_id, name, quantity, is_staple, category) VALUES (?, ?, ?, ?, ?)"
          ).run(newRecipeId, ing.name, ing.quantity, isActualStaple ? 1 : 0, ing.category);
        }
      });

      generated.forEach((recipe, i) => {
        const nightNumber = reusedSources.length + i + 1;
        const recipeResult = db
          .prepare(
            "INSERT INTO recipes (week_id, title, description, servings, prep_time, instructions, night_number, calories_per_serving) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            newWeekId,
            recipe.title,
            recipe.description,
            recipe.servings,
            recipe.prep_time,
            recipe.instructions,
            nightNumber,
            recipe.calories_per_serving || 0
          );
        const recipeId = recipeResult.lastInsertRowid as number;

        for (const ing of recipe.ingredients) {
          db.prepare(
            "INSERT INTO ingredients (recipe_id, name, quantity, is_staple, category) VALUES (?, ?, ?, ?, ?)"
          ).run(recipeId, ing.name, ing.quantity, ing.is_staple ? 1 : 0, ing.category);
        }
      });

      return newWeekId;
    })();

    // 4. Match ingredients to Picnic products. The week already exists — a
    // matching failure must not fail the request. We report the outcome so
    // the UI can show a banner and offer a rematch.
    let matchingStatus: "ok" | "2fa_required" | "failed" = "ok";
    try {
      const allIngredients = db
        .prepare(
          `SELECT i.id, i.name, i.quantity FROM ingredients i
           JOIN recipes r ON i.recipe_id = r.id
           WHERE r.week_id = ?`
        )
        .all(weekId) as Array<{ id: number; name: string; quantity: string }>;

      // Deduplicate by name, keeping first quantity seen
      const seenNames = new Map<string, string>();
      for (const ing of allIngredients) {
        const key = ing.name.toLowerCase().trim();
        if (!seenNames.has(key)) seenNames.set(key, ing.quantity || "");
      }
      const uniqueIngredients = Array.from(seenNames.entries()).map(
        ([name, quantity]) => ({ name, quantity })
      );

      const productMap = await matchIngredientsWithFallback(uniqueIngredients);
      console.log("[weeks] matched products:", Object.keys(productMap).length);

      for (const ing of allIngredients) {
        const normalizedName = ing.name.toLowerCase().trim();
        const product = productMap[normalizedName];
        if (product) {
          db.prepare(
            "INSERT INTO picnic_products (ingredient_id, picnic_id, name, image_id, price, unit_quantity, quantity) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).run(
            ing.id,
            product.picnic_id,
            product.name,
            product.image_id,
            product.price,
            product.unit_quantity,
            product.quantity ?? 1
          );
        }
      }
    } catch (err) {
      matchingStatus = err instanceof PicnicTwoFactorRequiredError ? "2fa_required" : "failed";
      console.error("[weeks] Picnic matching skipped:", err);
    }

    return NextResponse.json({ id: weekId, picnic_matching: matchingStatus }, { status: 201 });
  } catch (error) {
    if (error instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
