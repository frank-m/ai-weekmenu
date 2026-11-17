import { NextResponse } from "next/server";
import { getDealGroup, PicnicTwoFactorRequiredError } from "@/lib/picnic";

export const dynamic = "force-dynamic";

/** Products of one multi-product promotion group, e.g. "Korting op Alpro". */
export async function GET(_request: Request, { params }: { params: { groupId: string } }) {
  try {
    const items = await getDealGroup(params.groupId);
    if (!items) {
      return NextResponse.json({ error: "Promotion not found (it may have ended)" }, { status: 404 });
    }
    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof PicnicTwoFactorRequiredError) {
      return NextResponse.json({ error: "picnic_2fa_required" }, { status: 401 });
    }
    console.error("[deals/groups] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
