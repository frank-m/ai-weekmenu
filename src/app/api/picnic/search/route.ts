import { NextResponse } from "next/server";
import { matchIngredientsToProducts } from "@/lib/gemini";
import { searchProduct } from "@/lib/picnic";
import { getDb } from "@/lib/db";

export async function PUT(request: Request) {
  try {
    const { ingredient_id, picnic_id, name, image_id, price, unit_quantity } =
      await request.json();

    if (!ingredient_id || !picnic_id) {
      return NextResponse.json(
        { error: "ingredient_id and picnic_id are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    db.prepare(
      "UPDATE picnic_products SET picnic_id = ?, name = ?, image_id = ?, price = ?, unit_quantity = ? WHERE ingredient_id = ?"
    ).run(picnic_id, name, image_id, price, unit_quantity, ingredient_id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/picnic/search] PUT error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: { query: string; ingredient_id?: number } = await request.json();
    console.log("[api/picnic/search] request body:", JSON.stringify(body));

    // Use LLM-powered matching, with direct search fallback
    let match = null;
    try {
      const results = await matchIngredientsToProducts([{ name: body.query, quantity: "" }]);
      match = results[body.query] || null;
      console.log("[api/picnic/search] LLM match result:", match ? match.name : "null");
    } catch (err) {
      console.error("[api/picnic/search] LLM matching failed, falling back to direct search:", err);
      match = await searchProduct(body.query);
    }

    if (!match) {
      return NextResponse.json({ product: null });
    }

    // If ingredient_id provided, update the stored product
    if (body.ingredient_id) {
      const db = getDb();
      // Remove old product for this ingredient
      db.prepare("DELETE FROM picnic_products WHERE ingredient_id = ?").run(
        body.ingredient_id
      );
      // Insert new match
      db.prepare(
        "INSERT INTO picnic_products (ingredient_id, picnic_id, name, image_id, price, unit_quantity) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(
        body.ingredient_id,
        match.picnic_id,
        match.name,
        match.image_id,
        match.price,
        match.unit_quantity
      );
    }

    return NextResponse.json({ product: match });
  } catch (error) {
    console.error("[api/picnic/search] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
