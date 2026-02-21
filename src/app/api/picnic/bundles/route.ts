import { NextResponse } from "next/server";
import { getProductBundles } from "@/lib/picnic";

export async function POST(request: Request) {
  try {
    const body: { product_id: string } = await request.json();
    if (!body.product_id) {
      return NextResponse.json({ error: "Missing product_id" }, { status: 400 });
    }

    const bundles = await getProductBundles(body.product_id);
    return NextResponse.json({ bundles });
  } catch (error) {
    console.error("[bundles] Error fetching bundles:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
