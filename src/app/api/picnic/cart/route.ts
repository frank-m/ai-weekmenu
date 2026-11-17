import { NextResponse } from "next/server";
import { addToCart, getCart, clearCart, PicnicTwoFactorRequiredError } from "@/lib/picnic";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const items = await getCart();

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: { product_id: string; picnic_product_db_id?: number } =
      await request.json();

    console.log("[api/picnic/cart] POST adding product:", body.product_id, "db_id:", body.picnic_product_db_id);
    let count = 1;
    if (body.picnic_product_db_id) {
      const db = getDb();
      const row = db.prepare("SELECT quantity FROM picnic_products WHERE id = ?").get(body.picnic_product_db_id) as { quantity: number } | undefined;
      count = row?.quantity ?? 1;
    }
    await addToCart(body.product_id, count);

    // Only mark this specific row as added to cart
    if (body.picnic_product_db_id) {
      const db = getDb();
      db.prepare(
        "UPDATE picnic_products SET added_to_cart = 1 WHERE id = ?"
      ).run(body.picnic_product_db_id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    console.error("[api/picnic/cart] POST error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await clearCart();
    // Keep local "in cart" flags in sync with the now-empty Picnic cart
    getDb().prepare("UPDATE picnic_products SET added_to_cart = 0").run();
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    console.error("[api/picnic/cart] DELETE error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
