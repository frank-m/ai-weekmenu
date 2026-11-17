import { NextResponse } from "next/server";
import { getCheaperOptions, PicnicTwoFactorRequiredError } from "@/lib/picnic";

/** Cheaper similar products (per kg / litre / piece) for a product. */
export async function POST(request: Request) {
  try {
    const body: { product_id?: string } = await request.json();
    if (!body.product_id) {
      return NextResponse.json({ error: "Missing product_id" }, { status: 400 });
    }
    return NextResponse.json(await getCheaperOptions(body.product_id));
  } catch (error) {
    if (error instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    console.error("[cheaper] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
