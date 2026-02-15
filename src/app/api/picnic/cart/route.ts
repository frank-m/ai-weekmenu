import { NextResponse } from "next/server";
import { addToCart, getCart, clearCart } from "@/lib/picnic";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cart: any = await getCart();
    console.log("[api/picnic/cart] GET raw cart structure:", JSON.stringify(cart, null, 2).slice(0, 2000));

    // Parse OrderLine[] into a flat list with quantities
    const items: Array<{
      id: string;
      name: string;
      price: number;
      quantity: number;
      image_id?: string;
      unit_quantity?: string;
    }> = [];

    if (cart?.items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const line of cart.items) {
        const article = line.items?.[0];
        if (!article) continue;
        // QUANTITY decorator is on the article, not the line
        const qtyDecorator = article.decorators?.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (d: any) => d.type === "QUANTITY"
        );
        const quantity = qtyDecorator?.quantity ?? 1;

        items.push({
          id: String(article.id || ""),
          name: article.name || "",
          price: article.price || 0,
          quantity,
          image_id: article.image_ids?.[0] || "",
          unit_quantity: article.unit_quantity || "",
        });
      }
    }

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: { product_id: string; picnic_product_db_id?: number } =
      await request.json();

    console.log("[api/picnic/cart] POST adding product:", body.product_id, "db_id:", body.picnic_product_db_id);
    await addToCart(body.product_id);

    // Only mark this specific row as added to cart
    if (body.picnic_product_db_id) {
      const db = getDb();
      db.prepare(
        "UPDATE picnic_products SET added_to_cart = 1 WHERE id = ?"
      ).run(body.picnic_product_db_id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/picnic/cart] POST error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await clearCart();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/picnic/cart] DELETE error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
