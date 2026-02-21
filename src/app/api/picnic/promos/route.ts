import { NextResponse } from "next/server";
import { getProductPromoLabel, delay } from "@/lib/picnic";

export async function POST(request: Request) {
  try {
    const { product_ids } = await request.json();
    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      return NextResponse.json({ promos: {} });
    }

    const promos: Record<string, string | null> = {};
    for (let i = 0; i < product_ids.length; i++) {
      const id = product_ids[i];
      try {
        promos[id] = await getProductPromoLabel(id);
      } catch {
        promos[id] = null;
      }
      if (i < product_ids.length - 1) {
        await delay(250);
      }
    }

    return NextResponse.json({ promos });
  } catch (err) {
    console.error("[promos] error:", err);
    return NextResponse.json({ error: "Failed to fetch promos" }, { status: 500 });
  }
}
