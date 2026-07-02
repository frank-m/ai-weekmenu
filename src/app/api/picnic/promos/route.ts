import { NextResponse } from "next/server";
import { getProductPromoLabel, delay, PicnicTwoFactorRequiredError } from "@/lib/picnic";

export async function POST(request: Request) {
  try {
    const { product_ids: requestedIds } = await request.json();
    if (!Array.isArray(requestedIds) || requestedIds.length === 0) {
      return NextResponse.json({ promos: {} });
    }
    // Each lookup is a serialized PDP fetch — cap the batch to keep one
    // request from hammering Picnic (403 rate limits) or timing out
    const product_ids = requestedIds.slice(0, 20);

    const promos: Record<string, string | null> = {};
    for (let i = 0; i < product_ids.length; i++) {
      const id = product_ids[i];
      try {
        promos[id] = await getProductPromoLabel(id);
      } catch (err) {
        if (err instanceof PicnicTwoFactorRequiredError) throw err;
        promos[id] = null;
      }
      if (i < product_ids.length - 1) {
        await delay(250);
      }
    }

    return NextResponse.json({ promos });
  } catch (err) {
    if (err instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    console.error("[promos] error:", err);
    return NextResponse.json({ error: "Failed to fetch promos" }, { status: 500 });
  }
}
