import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Week, Recipe, Ingredient, PicnicProduct } from "@/lib/types";
import { getCart } from "@/lib/picnic";

export async function GET(
  _request: Request,
  { params }: { params: { weekId: string } }
) {
  try {
    const db = getDb();
    const weekId = parseInt(params.weekId);

    const week = db.prepare("SELECT * FROM weeks WHERE id = ?").get(weekId) as
      | (Omit<Week, "preferences"> & { preferences: string })
      | undefined;

    if (!week) {
      return NextResponse.json({ error: "Week not found" }, { status: 404 });
    }

    const recipes = db
      .prepare(
        "SELECT * FROM recipes WHERE week_id = ? ORDER BY night_number ASC"
      )
      .all(weekId) as Recipe[];

    // Sync added_to_cart flags with actual Picnic cart (quantity-aware)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cart: any = await getCart();
      // Build a map of picnic product id → quantity in cart
      const cartQuantities = new Map<string, number>();
      if (cart?.items) {
        for (const line of cart.items) {
          const article = line.items?.[0];
          if (!article?.id) continue;
          // QUANTITY decorator is on the article
          const qtyDecorator = article.decorators?.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (d: any) => d.type === "QUANTITY"
          );
          const qty = qtyDecorator?.quantity ?? 1;
          const articleId = String(article.id);
          cartQuantities.set(articleId, (cartQuantities.get(articleId) || 0) + qty);
        }
      }

      // Get all picnic_products for this week, grouped by picnic_id
      const weekProducts = db
        .prepare(
          `SELECT pp.id, pp.picnic_id, pp.added_to_cart FROM picnic_products pp
           JOIN ingredients i ON pp.ingredient_id = i.id
           JOIN recipes r ON i.recipe_id = r.id
           WHERE r.week_id = ?`
        )
        .all(weekId) as Array<{ id: number; picnic_id: string; added_to_cart: number }>;

      // Group DB rows by picnic_id, with already-added rows first
      const rowsByProduct = new Map<string, Array<{ id: number; added: boolean }>>();
      for (const wp of weekProducts) {
        const rows = rowsByProduct.get(wp.picnic_id) || [];
        rows.push({ id: wp.id, added: !!wp.added_to_cart });
        rowsByProduct.set(wp.picnic_id, rows);
      }

      // For each product, mark up to cartQuantity rows as added_to_cart
      for (const [picnicId, rows] of Array.from(rowsByProduct.entries())) {
        const inCartQty = cartQuantities.get(picnicId) || 0;
        // Sort: already-added rows first so we don't flip-flop unnecessarily
        rows.sort((a, b) => (a.added === b.added ? 0 : a.added ? -1 : 1));
        for (let i = 0; i < rows.length; i++) {
          const shouldBeInCart = i < inCartQty ? 1 : 0;
          db.prepare("UPDATE picnic_products SET added_to_cart = ? WHERE id = ?").run(shouldBeInCart, rows[i].id);
        }
      }
    } catch (err) {
      console.error("[weeks/weekId] Failed to sync cart state:", err);
    }

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

    return NextResponse.json({
      ...week,
      preferences: JSON.parse(week.preferences),
      recipes: recipesWithIngredients,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { weekId: string } }
) {
  try {
    const db = getDb();
    const weekId = parseInt(params.weekId);

    const week = db.prepare("SELECT id FROM weeks WHERE id = ?").get(weekId);
    if (!week) {
      return NextResponse.json({ error: "Week not found" }, { status: 404 });
    }

    // Delete in order: picnic_products → ingredients → recipes → week
    const recipeIds = db
      .prepare("SELECT id FROM recipes WHERE week_id = ?")
      .all(weekId) as { id: number }[];

    for (const recipe of recipeIds) {
      const ingredientIds = db
        .prepare("SELECT id FROM ingredients WHERE recipe_id = ?")
        .all(recipe.id) as { id: number }[];

      for (const ing of ingredientIds) {
        db.prepare("DELETE FROM picnic_products WHERE ingredient_id = ?").run(ing.id);
      }
      db.prepare("DELETE FROM ingredients WHERE recipe_id = ?").run(recipe.id);
    }

    db.prepare("DELETE FROM recipes WHERE week_id = ?").run(weekId);
    db.prepare("DELETE FROM weeks WHERE id = ?").run(weekId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
