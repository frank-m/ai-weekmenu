import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Recipe, Ingredient, PicnicProduct } from "@/lib/types";

export async function GET() {
  try {
    const db = getDb();

    const recipes = db
      .prepare(
        "SELECT * FROM recipes WHERE week_id IS NULL ORDER BY id DESC"
      )
      .all() as Recipe[];

    const recipesWithIngredients = recipes.map((recipe) => {
      const ingredients = db
        .prepare("SELECT * FROM ingredients WHERE recipe_id = ?")
        .all(recipe.id) as (Omit<Ingredient, "is_staple"> & {
        is_staple: number;
      })[];

      const ingredientsWithProducts = ingredients.map((ing) => {
        const product = db
          .prepare("SELECT * FROM picnic_products WHERE ingredient_id = ?")
          .get(ing.id) as
          | (Omit<PicnicProduct, "added_to_cart"> & { added_to_cart: number })
          | undefined;

        return {
          ...ing,
          is_staple: !!ing.is_staple,
          picnic_product: product
            ? { ...product, added_to_cart: !!product.added_to_cart }
            : null,
        };
      });

      return { ...recipe, ingredients: ingredientsWithProducts };
    });

    return NextResponse.json(recipesWithIngredients);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

interface IngredientInput {
  name: string;
  quantity: string;
  is_staple: boolean;
  category: string;
  picnic_product?: {
    picnic_id: string;
    name: string;
    image_id: string;
    price: number;
    unit_quantity: string;
  };
}

interface CreateRecipeBody {
  title: string;
  description: string;
  servings: number;
  prep_time: string;
  instructions: string;
  ingredients: IngredientInput[];
}

export async function POST(request: Request) {
  try {
    const body: CreateRecipeBody = await request.json();
    const db = getDb();

    const result = db
      .prepare(
        `INSERT INTO recipes (week_id, title, description, servings, prep_time, instructions, night_number)
         VALUES (NULL, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        body.title,
        body.description || "",
        body.servings,
        body.prep_time || "",
        body.instructions || ""
      );

    const recipeId = result.lastInsertRowid as number;

    for (const ing of body.ingredients) {
      const ingResult = db
        .prepare(
          `INSERT INTO ingredients (recipe_id, name, quantity, is_staple, category)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(recipeId, ing.name, ing.quantity || "", ing.is_staple ? 1 : 0, ing.category || "");

      if (ing.picnic_product) {
        const ingredientId = ingResult.lastInsertRowid as number;
        db.prepare(
          `INSERT INTO picnic_products (ingredient_id, picnic_id, name, image_id, price, unit_quantity)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          ingredientId,
          ing.picnic_product.picnic_id,
          ing.picnic_product.name,
          ing.picnic_product.image_id || "",
          ing.picnic_product.price || 0,
          ing.picnic_product.unit_quantity || ""
        );
      }
    }

    return NextResponse.json({ id: recipeId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
