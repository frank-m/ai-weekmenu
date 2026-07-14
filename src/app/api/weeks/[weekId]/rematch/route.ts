import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { matchIngredientsWithFallback } from "@/lib/gemini";
import { PicnicTwoFactorRequiredError } from "@/lib/picnic";

/**
 * Retries Picnic matching for all ingredients of a week that have no matched
 * product — the recovery path when the original matching ran while Picnic was
 * disconnected.
 */
export async function POST(
  _request: Request,
  { params }: { params: { weekId: string } }
) {
  try {
    const db = getDb();
    const weekId = parseInt(params.weekId);
    if (isNaN(weekId)) {
      return NextResponse.json({ error: "Invalid week id" }, { status: 400 });
    }

    const week = db.prepare("SELECT id FROM weeks WHERE id = ?").get(weekId);
    if (!week) {
      return NextResponse.json({ error: "Week not found" }, { status: 404 });
    }

    const unmatched = db
      .prepare(
        `SELECT i.id, i.name, i.quantity FROM ingredients i
         JOIN recipes r ON i.recipe_id = r.id
         LEFT JOIN picnic_products pp ON pp.ingredient_id = i.id
         WHERE r.week_id = ? AND pp.id IS NULL`
      )
      .all(weekId) as Array<{ id: number; name: string; quantity: string }>;

    if (unmatched.length === 0) {
      return NextResponse.json({ matched: 0, remaining: 0 });
    }

    // Deduplicate by name, keeping first quantity seen
    const seenNames = new Map<string, string>();
    for (const ing of unmatched) {
      const key = ing.name.toLowerCase().trim();
      if (!seenNames.has(key)) seenNames.set(key, ing.quantity || "");
    }
    const uniqueIngredients = Array.from(seenNames.entries()).map(
      ([name, quantity]) => ({ name, quantity })
    );

    const productMap = await matchIngredientsWithFallback(uniqueIngredients);

    let matchedCount = 0;
    for (const ing of unmatched) {
      const product = productMap[ing.name.toLowerCase().trim()];
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
        matchedCount++;
      }
    }

    return NextResponse.json({
      matched: matchedCount,
      remaining: unmatched.length - matchedCount,
    });
  } catch (error) {
    if (error instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    console.error("[rematch] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
