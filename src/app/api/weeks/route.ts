import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateRecipes, matchIngredientsToProducts } from "@/lib/gemini";
import { searchProduct } from "@/lib/picnic";
import { CreateWeekRequest, Recipe, Week } from "@/lib/types";
import { DEFAULT_STAPLES } from "@/lib/staples";

export async function GET() {
  try {
    const db = getDb();
    const weeks = db
      .prepare("SELECT * FROM weeks ORDER BY created_at DESC")
      .all() as Array<Omit<Week, "preferences"> & { preferences: string }>;

    return NextResponse.json(
      weeks.map((w) => ({
        ...w,
        preferences: JSON.parse(w.preferences),
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

    // 1. Create week
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
    const weekId = weekResult.lastInsertRowid as number;

    // 2. Handle reused recipes
    const reusedRecipes: Recipe[] = [];
    if (body.reused_recipe_ids && body.reused_recipe_ids.length > 0) {
      for (let i = 0; i < body.reused_recipe_ids.length; i++) {
        const sourceId = body.reused_recipe_ids[i];
        const sourceRecipe = db
          .prepare("SELECT * FROM recipes WHERE id = ?")
          .get(sourceId) as Recipe | undefined;

        if (!sourceRecipe) continue;

        const recipeResult = db
          .prepare(
            "INSERT INTO recipes (week_id, title, description, servings, prep_time, instructions, night_number, source_recipe_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            weekId,
            sourceRecipe.title,
            sourceRecipe.description,
            body.servings,
            sourceRecipe.prep_time,
            sourceRecipe.instructions,
            i + 1,
            sourceId
          );
        const newRecipeId = recipeResult.lastInsertRowid as number;

        // Copy ingredients
        const sourceIngredients = db
          .prepare("SELECT * FROM ingredients WHERE recipe_id = ?")
          .all(sourceId) as Array<{
          name: string;
          quantity: string;
          is_staple: number;
          category: string;
        }>;

        for (const ing of sourceIngredients) {
          const isActualStaple = DEFAULT_STAPLES.some(
            (s) =>
              ing.name.toLowerCase().includes(s) ||
              s.includes(ing.name.toLowerCase())
          );
          db.prepare(
            "INSERT INTO ingredients (recipe_id, name, quantity, is_staple, category) VALUES (?, ?, ?, ?, ?)"
          ).run(newRecipeId, ing.name, ing.quantity, isActualStaple ? 1 : 0, ing.category);
        }

        reusedRecipes.push({
          ...sourceRecipe,
          id: newRecipeId,
          week_id: weekId,
          night_number: i + 1,
        });
      }
    }

    // 3. Generate remaining recipes
    const numToGenerate = body.num_nights - reusedRecipes.length;
    if (numToGenerate > 0) {
      const existingTitles = reusedRecipes.map((r) => r.title);
      const generated = await generateRecipes(
        numToGenerate,
        body.servings,
        body.preferences,
        existingTitles
      );

      for (let i = 0; i < generated.length; i++) {
        const recipe = generated[i];
        const nightNumber = reusedRecipes.length + i + 1;

        const recipeResult = db
          .prepare(
            "INSERT INTO recipes (week_id, title, description, servings, prep_time, instructions, night_number) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            weekId,
            recipe.title,
            recipe.description,
            recipe.servings,
            recipe.prep_time,
            recipe.instructions,
            nightNumber
          );
        const recipeId = recipeResult.lastInsertRowid as number;

        for (const ing of recipe.ingredients) {
          db.prepare(
            "INSERT INTO ingredients (recipe_id, name, quantity, is_staple, category) VALUES (?, ?, ?, ?, ?)"
          ).run(recipeId, ing.name, ing.quantity, ing.is_staple ? 1 : 0, ing.category);
        }
      }
    }

    // 4. Match ingredients to Picnic products
    const allIngredients = db
      .prepare(
        `SELECT i.id, i.name FROM ingredients i
         JOIN recipes r ON i.recipe_id = r.id
         WHERE r.week_id = ?`
      )
      .all(weekId) as Array<{ id: number; name: string }>;

    // Match ingredients to Picnic products via LLM-powered search
    const uniqueNames = Array.from(
      new Set(allIngredients.map((i) => i.name.toLowerCase().trim()))
    );

    let productMap: Record<string, { picnic_id: string; name: string; image_id: string; price: number; unit_quantity: string } | null> = {};
    try {
      productMap = await matchIngredientsToProducts(uniqueNames);
      console.log("[weeks] LLM matched products:", Object.keys(productMap).length);
    } catch (err) {
      console.error("[weeks] LLM matching failed, falling back to direct search:", err);
      // Graceful fallback: search directly for each unique ingredient
      for (const name of uniqueNames) {
        try {
          productMap[name] = await searchProduct(name);
        } catch {
          productMap[name] = null;
        }
      }
    }

    for (const ing of allIngredients) {
      const normalizedName = ing.name.toLowerCase().trim();
      const product = productMap[normalizedName];
      if (product) {
        db.prepare(
          "INSERT INTO picnic_products (ingredient_id, picnic_id, name, image_id, price, unit_quantity) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(
          ing.id,
          product.picnic_id,
          product.name,
          product.image_id,
          product.price,
          product.unit_quantity
        );
      }
    }

    return NextResponse.json({ id: weekId }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
