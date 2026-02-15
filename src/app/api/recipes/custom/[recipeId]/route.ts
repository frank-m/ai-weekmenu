import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Recipe, Ingredient, PicnicProduct } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: { recipeId: string } }
) {
  try {
    const db = getDb();
    const recipeId = parseInt(params.recipeId);

    const recipe = db
      .prepare("SELECT * FROM recipes WHERE id = ? AND week_id IS NULL")
      .get(recipeId) as Recipe | undefined;

    if (!recipe) {
      return NextResponse.json(
        { error: "Custom recipe not found" },
        { status: 404 }
      );
    }

    const ingredients = db
      .prepare("SELECT * FROM ingredients WHERE recipe_id = ?")
      .all(recipeId) as (Omit<Ingredient, "is_staple"> & {
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

    return NextResponse.json({ ...recipe, ingredients: ingredientsWithProducts });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { recipeId: string } }
) {
  try {
    const db = getDb();
    const recipeId = parseInt(params.recipeId);

    const recipe = db
      .prepare("SELECT id FROM recipes WHERE id = ? AND week_id IS NULL")
      .get(recipeId) as { id: number } | undefined;

    if (!recipe) {
      return NextResponse.json(
        { error: "Custom recipe not found" },
        { status: 404 }
      );
    }

    // Delete cascade: picnic_products → ingredients → recipe
    const ingredientIds = db
      .prepare("SELECT id FROM ingredients WHERE recipe_id = ?")
      .all(recipeId) as { id: number }[];

    for (const ing of ingredientIds) {
      db.prepare("DELETE FROM picnic_products WHERE ingredient_id = ?").run(
        ing.id
      );
    }
    db.prepare("DELETE FROM ingredients WHERE recipe_id = ?").run(recipeId);
    db.prepare("DELETE FROM recipes WHERE id = ?").run(recipeId);

    return NextResponse.json({ success: true });
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

interface UpdateRecipeBody {
  title: string;
  description: string;
  servings: number;
  prep_time: string;
  instructions: string;
  ingredients: IngredientInput[];
}

export async function PUT(
  request: Request,
  { params }: { params: { recipeId: string } }
) {
  try {
    const db = getDb();
    const recipeId = parseInt(params.recipeId);
    const body: UpdateRecipeBody = await request.json();

    const recipe = db
      .prepare("SELECT id FROM recipes WHERE id = ? AND week_id IS NULL")
      .get(recipeId) as { id: number } | undefined;

    if (!recipe) {
      return NextResponse.json(
        { error: "Custom recipe not found" },
        { status: 404 }
      );
    }

    // Update recipe fields
    db.prepare(
      `UPDATE recipes SET title = ?, description = ?, servings = ?, prep_time = ?, instructions = ?
       WHERE id = ?`
    ).run(
      body.title,
      body.description || "",
      body.servings,
      body.prep_time || "",
      body.instructions || "",
      recipeId
    );

    // Delete old ingredients and products
    const oldIngredientIds = db
      .prepare("SELECT id FROM ingredients WHERE recipe_id = ?")
      .all(recipeId) as { id: number }[];

    for (const ing of oldIngredientIds) {
      db.prepare("DELETE FROM picnic_products WHERE ingredient_id = ?").run(
        ing.id
      );
    }
    db.prepare("DELETE FROM ingredients WHERE recipe_id = ?").run(recipeId);

    // Re-insert ingredients
    for (const ing of body.ingredients) {
      const ingResult = db
        .prepare(
          `INSERT INTO ingredients (recipe_id, name, quantity, is_staple, category)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          recipeId,
          ing.name,
          ing.quantity || "",
          ing.is_staple ? 1 : 0,
          ing.category || ""
        );

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

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
