import { NextResponse } from "next/server";
import { getPicnicAuthState, getPicnicClient, PicnicTwoFactorRequiredError } from "@/lib/picnic";

export async function GET() {
  const state = getPicnicAuthState();
  return NextResponse.json(state);
}

/** Proactively trigger login so we can detect whether 2FA is required. */
export async function POST() {
  try {
    await getPicnicClient();
  } catch (err) {
    if (!(err instanceof PicnicTwoFactorRequiredError)) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
    // PicnicTwoFactorRequiredError is expected — fall through and return state
  }
  return NextResponse.json(getPicnicAuthState());
}
