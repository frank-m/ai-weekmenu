import { NextResponse } from "next/server";
import { generatePicnicTwoFactor } from "@/lib/picnic";

export async function POST() {
  try {
    await generatePicnicTwoFactor();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
