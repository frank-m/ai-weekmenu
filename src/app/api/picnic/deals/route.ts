import { NextResponse } from "next/server";
import { getDeals, PicnicTwoFactorRequiredError } from "@/lib/picnic";

export const dynamic = "force-dynamic";

/**
 * Current Picnic promotions, read live from the promotions page (cached in
 * memory for 15 minutes; `?fresh=1` bypasses that). Returns the page's own
 * deals plus the multi-product promotion groups, whose products are loaded on
 * demand via /api/picnic/deals/groups/[groupId].
 */
export async function GET(request: Request) {
  try {
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const deals = await getDeals({ fresh });
    return NextResponse.json({
      items: deals.products,
      groups: deals.groups,
      fetched_at: deals.fetchedAt,
    });
  } catch (err) {
    if (err instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    console.error("[deals] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
