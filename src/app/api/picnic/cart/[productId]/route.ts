import { NextResponse } from "next/server";
import { removeFromCart, PicnicTwoFactorRequiredError } from "@/lib/picnic";
import { getDb } from "@/lib/db";

export async function DELETE(
  _request: Request,
  { params }: { params: { productId: string } }
) {
  try {
    await removeFromCart(params.productId);

    const db = getDb();
    const row = db.prepare(
      "SELECT id FROM picnic_products WHERE picnic_id = ? AND added_to_cart = 1 LIMIT 1"
    ).get(params.productId) as { id: number } | undefined;
    if (row) {
      db.prepare(
        "UPDATE picnic_products SET added_to_cart = 0 WHERE id = ?"
      ).run(row.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
