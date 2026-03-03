import { NextResponse } from "next/server";
import { addToCart, delay, PicnicTwoFactorRequiredError } from "@/lib/picnic";
import { getDb } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body: {
      items: Array<{ product_id: string; picnic_product_db_id?: number }>;
    } = await request.json();

    const db = getDb();
    const results: Array<{ product_id: string; success: boolean }> = [];

    for (const item of body.items) {
      try {
        await addToCart(item.product_id);
        if (item.picnic_product_db_id) {
          db.prepare(
            "UPDATE picnic_products SET added_to_cart = 1 WHERE id = ?"
          ).run(item.picnic_product_db_id);
        }
        results.push({ product_id: item.product_id, success: true });
      } catch (err) {
        if (err instanceof PicnicTwoFactorRequiredError) throw err;
        results.push({ product_id: item.product_id, success: false });
      }
      await delay(250);
    }

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
